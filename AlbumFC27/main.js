(function () {
  const NS = 'albumfc27';
  const SNIPE_NS = 'snipefc27';
  const EA_TAX = 0.05;
  const BAD_STATUS = new Set([426, 429, 458, 460, 494, 512, 521]);
  // Limites de débit (trop de requêtes) : pause courte et rythme ralenti ; les autres demandent une vérification (captcha)
  const SOFT_STATUS = new Set([426, 429, 512, 521]);
  const SOFT_CAP = 30 * 6e4;
  const CALM_MS = 30 * 6e4;
  const PILE_MAX = 100;
  const PAGE_SIZE = 20;
  const LOCK_HOURS = 12;
  const MAX_MISSES = 8;
  const MAX_LIST_FAILS = 3;
  const FEED_SIZE = 30;
  const HOUR = 36e5;
  const DAY = 24 * HOUR;

  const DEFAULTS = {
    minDelayMs: 5e3,
    maxDelayMs: 9e3,
    buyDelayMinMs: 300,
    buyDelayMaxMs: 900,
    scanMaxPrice: 5e4,
    scanMaxSearches: 30,
    scanPagesPerSlice: 3,
    pricePct: 10,
    triesPerPlayer: 3,
    coinReserve: 0,
    watchMinutes: 5,
    minSellPct: 0,
    lockMinutes: 30,
    softPauseMinutes: 3,
    autoRaisePct: 20,
    retryMinutes: 30,
    retryRounds: 3,
    maxSearchesPerHour: 300,
    maxSearchesPerDay: 1500,
    maxPurchasesPerDay: 150,
  };

  const step = (p) => (p < 1e3 ? 50 : p < 1e4 ? 100 : p < 5e4 ? 250 : p < 1e5 ? 500 : 1e3);
  const priceDown = (p) => Math.max(150, p - step(p - 1));
  const roundUp = (p) => Math.max(200, Math.ceil(p / step(p)) * step(p));
  // Hausse auto : +5 % arrondi au palier EA (au moins un palier), sans dépasser le plafond
  const raisePrice = (p, cap) => Math.min(cap, Math.max(p + step(p), roundUp(p * 1.05)));
  const capFor = (max, pct) => (pct > 0 ? Math.max(max, roundUp(max * (1 + pct / 100))) : max);
  const BOUNDS = [400, 700, 1e3, 1500, 2500, 5e3, 1e4, 25e3, 5e4, 1e5, 2e5, 5e5, 1e6, 15e6];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * Math.max(0, b - a);
  const fmtMin = (ms) => {
    const m = Math.ceil(ms / 6e4);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  };
  const fmtNum = (n) => Number(n || 0).toLocaleString('fr-FR');
  const fmtWait = (ms) => {
    const sec = Math.max(0, Math.ceil(ms / 1e3));
    return sec >= 60 ? `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, '0')} s` : `${sec} s`;
  };
  const fmtSigned = (n) => (n < 0 ? `gain ${fmtNum(-n)}` : fmtNum(n));
  const clock = (ms) => new Date(Date.now() + ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const errText = (e) => {
    if (e == null || e === '') return '';
    try {
      return ` [${(typeof e === 'string' ? e : JSON.stringify(e)).slice(0, 200)}]`;
    } catch {
      return '';
    }
  };

  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  const tierOf = (p) => (p.rare > 1 ? 'special' : !p.rating ? 'unknown' : p.rating >= 75 ? 'gold' : p.rating >= 65 ? 'silver' : 'bronze');
  const TIER_LABEL = { special: 'Spéciale', gold: 'Or', silver: 'Argent', bronze: 'Bronze', unknown: '' };
  const tierText = (p) => (tierOf(p) === 'special' ? 'Spéciale' : `${TIER_LABEL[tierOf(p)]}${p.rare === 1 ? ' rare' : ''}`);
  const setKey = (set) => (set ? (set.kind === 'futgg' ? `futgg:${set.slug}` : `club:${set.club}`) : null);
  const FUTGG_GALLERY = 'https://www.fut.gg/fut-gallery/';

  // ---------- Interception réseau : isCollected, gradingScore, rareflag par definitionId ----------

  const PILE_RE = /\/tradepile(\?|$)/i;
  let lastPile = null;
  const netItems = new Map();

  function recordItems(j) {
    const list = [...(Array.isArray(j.itemData) ? j.itemData : []), ...(Array.isArray(j.auctionInfo) ? j.auctionInfo.map((a) => a?.itemData) : [])];
    for (const it of list) {
      const defId = Number(it?.resourceId ?? 0);
      if (!defId || it.itemType !== 'player') continue;
      const prev = netItems.get(defId);
      netItems.set(defId, {
        collected: it.isCollected === true || !!prev?.collected,
        score: Number(it.gradingScore) || prev?.score || 0,
        rare: Number(it.rareflag ?? prev?.rare ?? 0),
      });
    }
  }

  function onResponse(url, status, text) {
    if (status !== 200) return;
    if (/\/ut\/game\//i.test(url) && /"itemData"/.test(text)) {
      try {
        recordItems(JSON.parse(text));
      } catch {}
    }
    if (PILE_RE.test(url)) {
      try {
        const j = JSON.parse(text);
        if (Array.isArray(j.auctionInfo)) lastPile = { at: Date.now(), auctions: j.auctionInfo };
      } catch {}
    }
  }

  function installNetHooks() {
    const X = XMLHttpRequest.prototype;
    const open = X.open;
    X.open = function (method, url, ...rest) {
      this.addEventListener('readystatechange', () => {
        if (this.readyState === 4 && (this.responseType === '' || this.responseType === 'text')) onResponse(String(url), this.status, this.responseText);
      });
      return open.call(this, method, url, ...rest);
    };
    const f = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const res = await f.call(this, input, init);
      if (/\/ut\//i.test(url)) res.clone().text().then((t) => onResponse(url, res.status, t)).catch(() => {});
      return res;
    };
  }

  // ---------- API Web App ----------

  function webAppReady() {
    try {
      return typeof services !== 'undefined' && !!services.Item && !!services.User?.getUser?.();
    } catch {
      return false;
    }
  }

  function observe(obs) {
    return new Promise((resolve) => {
      if (typeof obs?.observe !== 'function') return resolve({ success: false, status: -1, data: undefined, error: 'fonction Web App introuvable' });
      obs.observe(undefined, (_, r) =>
        resolve({ success: !!r?.success, status: Number(r?.status ?? 0), data: r?.data, error: r?.error ?? r?.data?.reason ?? r?.data?.message }),
      );
    });
  }

  function coins() {
    try {
      return Number(services.User.getUser().coins.amount);
    } catch {
      return null;
    }
  }

  const validId = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

  // Club / championnat de la dernière recherche faite à la main dans le marché
  let lastUiClub = null;
  let botSearching = false;
  function hookUiSearch() {
    const svc = services.Item;
    const orig = svc.searchTransferMarket;
    if (typeof orig !== 'function' || orig.__album) return;
    const wrapped = function (criteria) {
      if (!botSearching) {
        try {
          const club = validId(criteria?.club ?? criteria?._club);
          if (club) lastUiClub = { club, league: validId(criteria?.league ?? criteria?._league) };
        } catch {}
      }
      return orig.apply(this, arguments);
    };
    wrapped.__album = true;
    svc.searchTransferMarket = wrapped;
  }

  function staticName(i) {
    const s = i?._staticData ?? i?.getStaticData?.() ?? {};
    return String(s.name || [s.firstName, s.lastName].filter(Boolean).join(' ') || i?.definitionId || '?');
  }

  function mapItem(i) {
    const a = i._auction ?? i.getAuctionData?.() ?? {};
    const defId = Number(i.definitionId ?? 0);
    const net = netItems.get(defId);
    return {
      raw: i,
      tradeId: Number(a.tradeId),
      buyNow: Number(a.buyNowPrice),
      expires: Number(a.expires ?? 0),
      defId,
      rating: Number(i.rating ?? 0),
      rare: Number(net?.rare ?? i.rareflag ?? 0),
      name: staticName(i),
      collected: net?.collected === true,
      score: net?.score || Number(i.gradingScore) || 0,
    };
  }

  async function searchMarket(criteria, minBuy, maxBuy, page = 1) {
    const c = new UTSearchCriteriaDTO();
    c.type = typeof SearchType !== 'undefined' ? SearchType.PLAYER : 'player';
    Object.assign(c, criteria);
    if (minBuy > 0) c.minBuy = minBuy;
    if (maxBuy > 0) c.maxBuy = maxBuy;
    services.Item.clearTransferMarketCache?.();
    botSearching = true;
    let obs;
    try {
      obs = services.Item.searchTransferMarket(c, page);
    } finally {
      botSearching = false;
    }
    const r = await observe(obs);
    return { ...r, data: (r.data?.items ?? []).map(mapItem) };
  }

  const bid = (item) => observe(services.Item.bid(item.raw, item.buyNow));
  const listItem = (raw, buyNow) => observe(services.Item.list(raw, priceDown(buyNow), buyNow, 3600));

  async function moveAndList(raw, price) {
    const m = await observe(services.Item.move(raw, ItemPile.TRANSFER));
    return m.success ? listItem(raw, price) : m;
  }

  const tradeState = (s, bidV) => (s === 'closed' && bidV > 0 ? 'sold' : s === 'expired' || s === 'closed' ? 'expired' : s === 'active' ? 'active' : 'unlisted');

  async function readTransferPile() {
    try {
      repositories?.Item?.setDirty?.(ItemPile.TRANSFER);
    } catch {}
    const t0 = Date.now();
    const r = await observe(services.Item.requestTransferItems?.());
    const items = r.data?.items ?? [];
    const byId = new Map(items.map((i) => [Number(i.id), i]));
    let pile = lastPile;
    for (let n = 0; n < 10 && !(pile && pile.at >= t0); n++) {
      await sleep(50);
      pile = lastPile;
    }
    if (pile && pile.at >= t0) {
      return {
        success: true,
        data: pile.auctions.map((a) => {
          const id = Number(a.itemData?.id);
          const raw = byId.get(id);
          const defId = Number(raw?.definitionId ?? a.itemData?.resourceId ?? 0);
          return { raw, id, defId, name: raw ? staticName(raw) : String(defId || id), state: tradeState(String(a.tradeState ?? ''), Number(a.currentBid ?? 0)), soldPrice: Number(a.currentBid ?? 0), buyNow: Number(a.buyNowPrice ?? 0) };
        }),
      };
    }
    return {
      ...r,
      data: items.map((i) => {
        const a = i._auction ?? i.getAuctionData?.() ?? {};
        const cur = Number(a.currentBid ?? 0);
        return { raw: i, id: Number(i.id), defId: Number(i.definitionId ?? 0), name: staticName(i), state: tradeState(String(a.tradeState ?? ''), cur), soldPrice: cur, buyNow: Number(a.buyNowPrice ?? 0) };
      }),
    };
  }

  // ---------- Championnats et clubs (données de la Web App) ----------

  // Sans eval (CSP de la Web App) : les globales déclarées en let/const ne sont pas sur window
  const GLOBALS = {
    factories: () => (typeof factories !== 'undefined' ? factories : undefined),
    repositories: () => (typeof repositories !== 'undefined' ? repositories : undefined),
  };
  const globalObj = (name) => {
    try {
      return window[name] ?? GLOBALS[name]?.();
    } catch {
      return undefined;
    }
  };

  function methodNames(o) {
    const names = new Set();
    for (let p = o; p && p !== Object.prototype && p !== Function.prototype; p = Object.getPrototypeOf(p)) {
      for (const k of Object.getOwnPropertyNames(p)) {
        try {
          if (k !== 'constructor' && typeof Object.getOwnPropertyDescriptor(p, k)?.value === 'function') names.add(k);
        } catch {}
      }
    }
    return [...names];
  }

  function asEntries(v) {
    if (v instanceof Map) v = [...v.values()];
    else if (v && typeof v === 'object' && !Array.isArray(v)) v = Object.values(v);
    if (!Array.isArray(v)) return [];
    const out = [];
    for (const x of v) {
      if (!x || typeof x !== 'object') continue;
      const id = validId(x.id ?? x.value ?? x.teamId ?? x.leagueId ?? x.key);
      let name = [x.label, x.name, x.longName, x.fullName, x.text, x.abbrName].find((s) => typeof s === 'string' && s.trim());
      if (!name && typeof x.getName === 'function') {
        try {
          name = x.getName();
        } catch {}
      }
      if (id && name) out.push({ id, name: String(name).trim(), league: validId(x.leagueId ?? x.league) });
    }
    return out;
  }

  const dataSources = () =>
    [
      ['factories.DataProvider', globalObj('factories')?.DataProvider],
      ['repositories.TeamConfig', globalObj('repositories')?.TeamConfig],
    ].filter(([, o]) => o && typeof o === 'object');

  const discovery = { leagues: null, clubs: null, sources: [] };

  // Essaie les accesseurs « get…League… » / « get…Club|Team… » sans effet de bord, garde la première liste plausible
  function findList(kindRe, argSets, accept) {
    for (const [path, obj] of dataSources()) {
      for (const m of methodNames(obj).filter((n) => /^get/i.test(n) && kindRe.test(n))) {
        for (const args of argSets) {
          let list;
          try {
            list = asEntries(obj[m](...args));
          } catch {
            continue;
          }
          const ok = accept(list);
          if (ok?.length) return { via: `${path}.${m}(${args.join(', ')})`, list: ok };
        }
      }
      for (const k of Object.keys(obj).filter((n) => kindRe.test(n))) {
        const ok = accept(asEntries(obj[k]));
        if (ok?.length) return { via: `${path}.${k}`, list: ok };
      }
    }
    return null;
  }

  const byName = (a, b) => a.name.localeCompare(b.name, 'fr');

  function loadLeagues() {
    const r = findList(/league/i, [[], [true], [false]], (l) => (l.length >= 5 ? l : null));
    discovery.leagues = r?.via ?? 'introuvable';
    return r ? [...new Map(r.list.map((x) => [x.id, x])).values()].sort(byName) : [];
  }

  function loadClubs(leagueId) {
    const r = findList(/club|team/i, [[leagueId], [leagueId, true], [leagueId, false], [true, leagueId], [], [true]], (l) => {
      if (!l.length) return null;
      if (l.some((x) => x.league)) return l.filter((x) => x.league === leagueId);
      return l.length < 120 ? l : null;
    });
    discovery.clubs = r?.via ?? 'introuvable';
    return r ? [...new Map(r.list.map((x) => [x.id, x])).values()].sort(byName) : [];
  }

  function diagnosticReport() {
    return {
      at: new Date().toISOString(),
      url: location.href,
      discovery,
      lastUiClub,
      sources: dataSources().map(([path, o]) => ({ path, methods: methodNames(o).slice(0, 200), keys: Object.keys(o).slice(0, 100) })),
    };
  }

  // ---------- Garde-fous (quotas partagés avec SnipeFC27) ----------

  class Guard {
    key = `${NS}:guard`;
    s = { searches: [], purchases: [], lockedUntil: 0, lockStreak: 0, lastLockAt: 0, ...load(this.key, {}) };
    persist() {
      const now = Date.now();
      this.s.searches = this.s.searches.filter((t) => now - t < DAY);
      this.s.purchases = this.s.purchases.filter((t) => now - t < DAY);
      save(this.key, this.s);
    }
    other() {
      return { searches: [], purchases: [], lockedUntil: 0, ...load(`${SNIPE_NS}:guard`, {}) };
    }
    lockedUntil() {
      return Math.max(this.s.lockedUntil, Number(this.other().lockedUntil) || 0);
    }
    unlock() {
      this.s.lockedUntil = 0;
      this.persist();
      const o = this.other();
      if (o.lockedUntil) save(`${SNIPE_NS}:guard`, { ...o, lockedUntil: 0 });
    }
    // Verrou progressif : durée de base doublée à chaque nouveau blocage dans les 24 h, plafond 12 h
    lock(baseMinutes) {
      const now = Date.now();
      this.s.lockStreak = now - this.s.lastLockAt < DAY ? this.s.lockStreak + 1 : 0;
      this.s.lastLockAt = now;
      const ms = baseMinutes > 0 ? Math.min(LOCK_HOURS * HOUR, baseMinutes * 6e4 * 2 ** this.s.lockStreak) : LOCK_HOURS * HOUR;
      this.s.lockedUntil = now + ms;
      this.s.lockKind = 'hard';
      this.persist();
      return ms;
    }
    // Limite de débit : pause courte doublée si ça se répète dans les 30 min (plafond 30 min), rythme x1,5 (plafond x4)
    lockSoft(baseMinutes) {
      const now = Date.now();
      const calm = now - (this.s.lastSoftAt ?? 0) > CALM_MS;
      this.s.softStreak = calm ? 0 : (this.s.softStreak ?? 0) + 1;
      this.s.pace = Math.min(4, (calm ? 1 : this.s.pace ?? 1) * 1.5);
      this.s.lastSoftAt = now;
      const ms = Math.min(SOFT_CAP, Math.max(0.1, baseMinutes) * 6e4 * 2 ** this.s.softStreak);
      this.s.lockedUntil = now + ms;
      this.s.lockKind = 'soft';
      this.persist();
      return ms;
    }
    pace() {
      return Date.now() - (this.s.lastSoftAt ?? 0) > CALM_MS ? 1 : (this.s.pace ?? 1);
    }
    lockKind() {
      return this.s.lockedUntil > Date.now() ? (this.s.lockKind ?? 'hard') : Number(this.other().lockedUntil) > Date.now() ? 'snipe' : null;
    }
    record(kind) {
      this.s[kind].push(Date.now());
      this.persist();
    }
    all(kind) {
      return [...this.s[kind], ...(this.other()[kind] ?? [])].sort((a, b) => a - b);
    }
    check(cfg) {
      const lockMs = this.lockedUntil() - Date.now();
      if (lockMs > 0) return { ok: false, locked: true, stop: `${this.lockKind() === 'soft' ? 'Pause limite EA' : 'Verrou anti-captcha'} actif encore ${fmtMin(lockMs)}` };
      const now = Date.now();
      const searches = this.all('searches').filter((t) => now - t < DAY);
      const purchases = this.all('purchases').filter((t) => now - t < DAY);
      const dayWait = (arr, what, max) => {
        const w = Math.max(6e4, arr[arr.length - max] + DAY - now + 5e3);
        return { ok: false, waitMs: w, reason: `Quota journalier ${what} atteint (AlbumFC27 + SnipeFC27, max ${max}), reprise dans ${fmtMin(w)}` };
      };
      if (searches.length >= cfg.maxSearchesPerDay) return dayWait(searches, 'de recherches', cfg.maxSearchesPerDay);
      if (purchases.length >= cfg.maxPurchasesPerDay) return dayWait(purchases, "d'achats", cfg.maxPurchasesPerDay);
      const hour = searches.filter((t) => now - t < HOUR);
      if (hour.length >= cfg.maxSearchesPerHour) {
        const w = hour[0] + HOUR - now + 5e3;
        return { ok: false, waitMs: w, reason: `Quota horaire atteint (${hour.length}, max ${cfg.maxSearchesPerHour}), reprise dans ${fmtMin(w)}` };
      }
      return { ok: true };
    }
  }

  // ---------- Moteur ----------

  const K_CONFIG = `${NS}:config`;
  const K_SETS = `${NS}:sets`;
  const K_SEL = `${NS}:selection`;
  const K_QUEUE = `${NS}:queue`;
  const K_DONE = `${NS}:done`;
  const K_BOUGHT = `${NS}:bought`;
  const K_ACTIVE = `${NS}:active`;
  const K_RESUME = `${NS}:resume`;
  const K_TOTAL = `${NS}:total`;
  const K_WATCH = `${NS}:watch`;
  const K_LOCK_RESUME = `${NS}:lockResume`;
  const K_EVENTS = `${NS}:events`;

  // Type d'un évènement du journal, déduit du message quand il n'est pas donné
  const EVENT_RULES = [
    [/^Acheté /, 'buy'],
    [/^Vendu /, 'sell'],
    [/remis en vente à|invendu :|remis à /, 'list'],
    [/^Raté |introuvable|aucune annonce/i, 'miss'],
    [/verrou|captcha|anti-captcha|Statut EA|soft ban/i, 'lock'],
    [/erreur|échou|impossible|refusée/i, 'error'],
    [/quota|insuffisants|pleine|relevé|SnipeFC27 tourne/i, 'warn'],
  ];
  const eventType = (msg) => EVENT_RULES.find(([re]) => re.test(msg))?.[1];
  const EVENT_MAX = 400;

  function loadConfig() {
    const raw = load(K_CONFIG, {});
    const cfg = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) cfg[k] = raw[k];
    return cfg;
  }

  // Ancien format (un seul ensemble) vers la liste de sets
  function loadSets() {
    const sets = load(K_SETS, null);
    if (sets && typeof sets === 'object') return sets;
    const old = load(`${NS}:set`, null);
    const scan = load(`${NS}:scan`, null);
    const out = {};
    if (old && scan?.players) {
      const key = setKey(old.kind ? old : { ...old, kind: 'club' });
      out[key] = { ...old, kind: old.kind ?? 'club', key, source: scan.source ?? 'market', at: scan.at ?? Date.now(), partial: !!scan.partial, players: scan.players };
    }
    return out;
  }

  const STATUS_LABEL = {
    pending: 'en attente',
    searching: 'recherche…',
    listed: 'acheté',
    bought: 'acheté, non mis en vente',
    notfound: 'introuvable au prix max',
    nocoins: 'crédits insuffisants',
  };
  const isDone = (q) => q.status === 'listed' || q.status === 'bought';
  const isFailed = (q) => q.status === 'notfound' || q.status === 'nocoins';
  const isOpen = (q) => q.status === 'pending' || q.status === 'searching';

  // Coût d'un aller-retour : achat au prix p, revente à p (seul en vente) ou un palier dessous (concurrence), taxe 5 %
  const roundTrip = (p) => ({ low: p - Math.floor(p * (1 - EA_TAX)), high: p - Math.floor(Math.max(200, priceDown(p)) * (1 - EA_TAX)) });

  class Engine {
    mode = null; // 'scan' | 'buy' | 'watch' | null
    stopRequested = false;
    activityText = '';
    lastMessage = '';
    feedLines = [];
    guard = new Guard();
    sets = loadSets();
    selection = load(K_SEL, {});
    queue = load(K_QUEUE, []);
    done = new Set(load(K_DONE, []));
    bought = load(K_BOUGHT, {});
    total = { bought: 0, spent: 0, tax: 0, lost: 0, sold: 0, ...load(K_TOTAL, {}) };
    scanningKey = null;
    pileCount = 0;
    ownListed = 0;
    misses = 0;
    listFails = 0;
    wake = null;
    releaseLock = null;
    resumeTimer = null;
    resumeAt = 0;
    version = 0;
    events = load(K_EVENTS, []);
    eventSeq = this.events[0]?.id ?? 0;
    waitUntil = 0;
    waitLabel = '';
    retryNow = false;

    constructor(getConfig, onUpdate) {
      this.getConfig = getConfig;
      this.onUpdate = onUpdate;
    }
    get running() {
      return this.mode !== null;
    }
    get busy() {
      return this.mode === 'scan' || this.mode === 'buy';
    }

    snapshot() {
      const q = this.queue;
      return {
        running: this.running,
        mode: this.mode,
        activity: this.activityText,
        lastMessage: this.lastMessage,
        feed: this.feedLines,
        coins: coins(),
        sets: Object.values(this.sets).map((s) => s.name),
        queue: { total: q.length, listed: q.filter(isDone).length, failed: q.filter(isFailed).length, open: q.filter(isOpen).length },
        total: { ...this.total },
        pendingLoss: this.pendingLoss(),
        onSale: Object.keys(this.bought).length,
        lockedUntil: this.guard.lockedUntil(),
        resumeAt: this.resumeAt,
        version: this.version,
        lastEventId: this.eventSeq,
        lockKind: this.guard.lockKind(),
        pace: this.guard.pace(),
        waitUntil: this.waitUntil,
        waitLabel: this.waitLabel,
      };
    }
    touch() {
      this.version++;
    }
    emit(line) {
      this.onUpdate(this.snapshot(), line);
    }
    // Journal structuré : { id, t, type, msg, major } ; major = message de log (gras), sinon étape
    record(msg, type, major) {
      const ev = { id: ++this.eventSeq, t: Date.now(), type: type ?? eventType(msg) ?? (major ? 'info' : 'step'), msg, major };
      this.events = [ev, ...this.events].slice(0, EVENT_MAX);
      clearTimeout(this.saveEventsTimer);
      this.saveEventsTimer = setTimeout(() => save(K_EVENTS, this.events.slice(0, 200)), 1500);
      return ev;
    }
    log(msg, type) {
      this.lastMessage = msg;
      this.record(msg, type, true);
      this.emit(`${new Date().toLocaleTimeString()} ${msg}`);
    }
    feed(msg, type) {
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      this.feedLines = [`${t} ${msg}`, ...this.feedLines].slice(0, FEED_SIZE);
      this.record(msg, type, false);
      this.emit();
    }
    clearEvents() {
      this.events = [];
      save(K_EVENTS, []);
      this.touch();
      this.emit();
    }
    // Notification système (via l'extension), sans action requise
    notify(title, message) {
      try {
        window.postMessage({ ns: NS, dir: 'to-ext', notify: { title, message } }, window.location.origin);
      } catch {}
    }
    activity(msg) {
      this.activityText = msg;
      this.emit();
    }
    addTotal(field, n) {
      this.total[field] = (this.total[field] ?? 0) + n;
      save(K_TOTAL, this.total);
    }
    // Perte si les joueurs encore en vente partent au prix affiché
    pendingLoss() {
      let n = 0;
      for (const b of Object.values(this.bought)) {
        const price = typeof b === 'number' ? b : b.price;
        const sell = typeof b === 'number' ? b : b.sell || b.price;
        n += price - Math.floor(sell * (1 - EA_TAX));
      }
      return n;
    }
    resetTotals() {
      this.total = { bought: 0, spent: 0, tax: 0, lost: 0, sold: 0 };
      save(K_TOTAL, this.total);
      this.log('Compteurs remis à zéro');
    }

    // --- Sets ---

    saveSets() {
      save(K_SETS, this.sets);
      this.touch();
    }
    setList() {
      return Object.values(this.sets).sort((a, b) => b.at - a.at);
    }
    refreshCollected(p) {
      if (!p.collected && (netItems.get(p.defId)?.collected || this.done.has(p.defId))) p.collected = true;
      return p;
    }
    setPlayers(set) {
      return Object.values(set.players ?? {})
        .map((p) => this.refreshCollected(p))
        .sort((a, b) => (a.minPrice || Infinity) - (b.minPrice || Infinity) || b.rating - a.rating);
    }
    findPlayer(defId) {
      for (const s of Object.values(this.sets)) if (s.players?.[defId]) return s.players[defId];
      return null;
    }
    defaultMax(p) {
      return p?.minPrice > 0 ? roundUp(p.minPrice * (1 + this.getConfig().pricePct / 100)) : 0;
    }
    setSelected(defId, on, max) {
      if (on) this.selection[defId] = max || this.selection[defId] || this.defaultMax(this.findPlayer(defId));
      else delete this.selection[defId];
      save(K_SEL, this.selection);
    }
    removeSet(key) {
      if (this.scanningKey === key) return this.log("Set en cours de scan : arrête le scan d'abord");
      const set = this.sets[key];
      if (!set) return;
      delete this.sets[key];
      const still = new Set(Object.values(this.sets).flatMap((s) => Object.keys(s.players ?? {})));
      for (const id of Object.keys(this.selection)) if (!still.has(id)) delete this.selection[id];
      save(K_SEL, this.selection);
      this.saveSets();
      this.log(`Set « ${set.name} » retiré`);
    }

    // Joueurs cochés, dédoublonnés entre sets, avec coût projeté
    picks() {
      const out = [];
      let noPrice = 0;
      for (const [id, max] of Object.entries(this.selection)) {
        const p = this.findPlayer(id);
        if (!p || this.refreshCollected(p).collected) continue;
        if (!(Number(max) >= 200)) {
          noPrice++;
          continue;
        }
        const ref = p.minPrice > 0 ? Math.min(p.minPrice, Number(max)) : Number(max);
        out.push({ p, max: Number(max), ref, ...roundTrip(ref) });
      }
      const sum = (k) => out.reduce((s, x) => s + x[k], 0);
      const pct = this.getConfig().autoRaisePct;
      const capEngaged = out.reduce((s, x) => s + capFor(x.max, pct), 0);
      return { list: out, noPrice, engaged: sum('ref'), maxEngaged: sum('max'), capEngaged, low: sum('low'), high: sum('high') };
    }

    // Set envoyé depuis une page Galerie de fut.gg (joueurs, defId, prix fut.gg)
    importSet(data) {
      const list = Array.isArray(data?.players) ? data.players : [];
      const players = {};
      for (const x of list) {
        const defId = validId(x?.defId);
        if (!defId || players[defId]) continue;
        const net = netItems.get(defId);
        players[defId] = {
          defId,
          name: String(x.name || defId).slice(0, 60),
          rating: Number(x.rating) || 0,
          rare: Number(net?.rare ?? 0),
          minPrice: Number(x.price) >= 150 ? Math.round(Number(x.price)) : 0,
          listings: 0,
          collected: net?.collected === true || this.done.has(defId),
          score: net?.score || 0,
        };
      }
      if (!Object.keys(players).length) return this.log('Import fut.gg : aucun joueur lu sur la page'), null;
      const set = { kind: 'futgg', slug: String(data.slug || data.name || 'set'), name: String(data.name || 'Set fut.gg').slice(0, 60), url: String(data.url || ''), needed: Number(data.needed) || 0, source: 'futgg', at: Date.now(), partial: false };
      set.key = setKey(set);
      const again = !!this.sets[set.key];
      this.sets[set.key] = { ...set, players };
      this.saveSets();
      const priced = Object.values(players).filter((p) => p.minPrice).length;
      this.log(`Set « ${set.name} » ${again ? 'mis à jour' : 'ajouté'} depuis fut.gg : ${Object.keys(players).length} joueur(s), ${priced} avec prix${set.needed ? `, ${set.needed} requis` : ''}`);
      return set.key;
    }

    // --- Contrôles communs ---

    stop(msg = 'Arrêt demandé', byUser = false) {
      if (byUser) {
        save(K_ACTIVE, false);
        save(K_WATCH, false);
        this.cancelResume();
      }
      this.stopRequested = true;
      this.wake?.();
      this.log(msg);
    }
    lockout(msg, soft = false) {
      const cfg = this.getConfig();
      const mode = this.mode;
      this.stopRequested = true;
      this.wake?.();
      if (soft) {
        const ms = this.guard.lockSoft(cfg.softPauseMinutes);
        const pace = this.guard.pace();
        if (mode === 'buy' || mode === 'watch') {
          save(K_LOCK_RESUME, { mode });
          this.scheduleResume();
        }
        this.log(`${msg} : pause de ${fmtMin(ms)}${pace > 1 ? `, rythme ralenti ×${pace.toFixed(1).replace('.', ',')}` : ''}${mode === 'buy' || mode === 'watch' ? ', reprise automatique' : ''}`, 'lock');
        return;
      }
      const ms = this.guard.lock(cfg.lockMinutes);
      if (cfg.lockMinutes > 0 && (mode === 'buy' || mode === 'watch')) {
        save(K_LOCK_RESUME, { mode });
        this.log(`${msg} : pause de ${fmtMin(ms)}, reprise automatique ensuite. Si EA affiche un captcha, le résoudre dans la Web App.`, 'lock');
        this.notify('AlbumFC27 : pause anti-captcha', `${msg}. Reprise automatique vers ${clock(ms)}. Si EA affiche un captcha, résous-le dans la Web App.`);
        this.scheduleResume();
      } else {
        save(K_ACTIVE, false);
        save(K_WATCH, false);
        this.log(`${msg} : arrêt et verrou ${fmtMin(ms)}. Résoudre un éventuel captcha à la main.`, 'lock');
        this.notify('AlbumFC27 : arrêt', `${msg}. Verrou ${fmtMin(ms)}.`);
      }
    }
    // Reprise automatique de la tâche interrompue à la fin du verrou
    scheduleResume() {
      const intent = load(K_LOCK_RESUME, null);
      if (!intent) return;
      clearTimeout(this.resumeTimer);
      const wait = Math.max(5e3, this.guard.lockedUntil() - Date.now() + (this.guard.lockKind() === 'soft' ? rand(5e3, 2e4) : rand(3e4, 9e4)));
      this.resumeAt = Date.now() + wait;
      this.resumeTimer = setTimeout(() => void this.autoResume(), wait);
      this.emit();
    }
    cancelResume() {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
      this.resumeAt = 0;
      save(K_LOCK_RESUME, null);
    }
    async autoResume() {
      const intent = load(K_LOCK_RESUME, null);
      this.resumeAt = 0;
      if (!intent) return;
      if (this.guard.lockedUntil() > Date.now()) return this.scheduleResume();
      if (this.running) return;
      save(K_LOCK_RESUME, null);
      this.log('Fin du verrou : reprise automatique');
      if (intent.mode === 'buy' && this.queue.some(isOpen)) await this.runQueue();
      else await this.watch();
    }
    deferResume(mode) {
      if (mode !== 'buy' && mode !== 'watch') return;
      save(K_LOCK_RESUME, { mode });
      this.scheduleResume();
    }
    sessionExpired() {
      const d = rand(6e4, 12e4);
      this.stop(`Session expirée (401) : rechargement de la Web App dans ${Math.round(d / 1e3)} s puis reprise`);
      if (this.mode === 'buy') save(K_RESUME, Date.now() + d);
      setTimeout(() => location.reload(), d);
    }
    unlock() {
      this.guard.unlock();
      this.log('Verrou levé manuellement');
      if (load(K_LOCK_RESUME, null)) {
        clearTimeout(this.resumeTimer);
        void this.autoResume();
      }
    }

    // Erreur EA commune : renvoie true si la tâche doit s'arrêter
    fatal(r, what) {
      if (r.status === 401) return this.sessionExpired(), true;
      if (SOFT_STATUS.has(r.status)) return this.lockout(`Limite EA ${r.status} (trop de requêtes)`, true), true;
      if (BAD_STATUS.has(r.status)) return this.lockout(`Statut EA ${r.status} (vérification / captcha)`), true;
      if (r.status === 403 && what === 'search') return this.stop(`Recherche refusée (403)${errText(r.error)}`), true;
      return false;
    }

    // Attend que les quotas le permettent ; false si arrêt
    async waitGuard(cfg) {
      while (!this.stopRequested) {
        const g = this.guard.check(cfg);
        if (g.ok) return true;
        if (g.locked) {
          const mode = this.mode;
          this.stopRequested = true;
          this.log(`${g.stop}${mode === 'buy' || mode === 'watch' ? ' : reprise automatique à la fin' : ''}`);
          this.deferResume(mode);
          return false;
        }
        this.log(g.reason);
        this.activity(`Quota atteint, reprise à ${clock(g.waitMs)}`);
        await this.sleep(g.waitMs, 'Quota EA atteint, reprise');
      }
      return false;
    }

    async otherBotRunning() {
      try {
        const q = await navigator.locks?.query?.();
        return !!q?.held?.some((l) => l.name === `${SNIPE_NS}-running`);
      } catch {
        return false;
      }
    }
    async enter(mode) {
      if (this.running) return false;
      if (await this.otherBotRunning()) {
        this.log('SnipeFC27 tourne : arrête-le avant (quotas EA partagés)');
        return false;
      }
      const g = this.guard.check(this.getConfig());
      if (g.locked) {
        this.deferResume(mode);
        this.log(`${g.stop}${mode === 'buy' || mode === 'watch' ? ' : démarrage automatique à la fin' : ''}`);
        return false;
      }
      this.mode = mode;
      this.stopRequested = false;
      this.misses = 0;
      this.listFails = 0;
      if (navigator.locks && !this.releaseLock) navigator.locks.request(`${NS}-running`, () => new Promise((r) => (this.releaseLock = r)));
      this.touch();
      this.emit();
      return true;
    }
    leave() {
      this.mode = null;
      this.scanningKey = null;
      this.activityText = '';
      this.releaseLock?.();
      this.releaseLock = null;
      this.touch();
      this.emit();
    }
    // Interrompt le suivi des ventes pour laisser la place à une autre tâche
    async stopWatch() {
      if (this.mode !== 'watch') return;
      this.stopRequested = true;
      this.wake?.();
      while (this.mode === 'watch') await sleep(200);
    }

    // --- Scan du marché d'un club (secours) ---

    async scanClub(club) {
      await this.stopWatch();
      if (!club?.club) return this.log("Choisis d'abord un club");
      const base = { kind: 'club', club: club.club, league: club.league ?? null, name: club.name, source: 'market', needed: 0 };
      const key = setKey(base);
      if (!(await this.enter('scan'))) return;
      const cfg = this.getConfig();
      const players = {};
      this.sets[key] = { ...base, key, at: Date.now(), partial: true, searches: 0, players };
      this.scanningKey = key;
      this.saveSets();
      const bounds = [...BOUNDS.filter((b) => b < cfg.scanMaxPrice), cfg.scanMaxPrice];
      this.log(`Scan du club « ${club.name} » (${bounds.length} tranches de prix, ${cfg.scanMaxSearches} recherches max)`);
      let searches = 0;
      try {
        outer: for (let s = 0; s < bounds.length; s++) {
          const lo = s === 0 ? 0 : bounds[s - 1];
          const hi = bounds[s];
          for (let page = 1; page <= cfg.scanPagesPerSlice; page++) {
            if (this.stopRequested || searches >= cfg.scanMaxSearches) break outer;
            if (!(await this.waitGuard(cfg))) break outer;
            this.activity(`Scan ${club.name} : ${lo}–${hi}, page ${page} (${searches + 1}/${cfg.scanMaxSearches})`);
            const res = await searchMarket({ club: club.club }, lo, hi, page);
            searches++;
            this.guard.record('searches');
            if (!res.success) {
              if (this.fatal(res, 'search')) break outer;
              this.log(`Recherche en échec (statut ${res.status})${errText(res.error)}`);
              break;
            }
            let fresh = 0;
            for (const it of res.data) {
              if (!it.defId || !(it.buyNow > 0)) continue;
              const p = players[it.defId];
              if (!p) {
                fresh++;
                players[it.defId] = { defId: it.defId, name: it.name, rating: it.rating, rare: it.rare, minPrice: it.buyNow, listings: 1, collected: it.collected, score: it.score };
              } else {
                p.minPrice = Math.min(p.minPrice, it.buyNow);
                p.listings++;
                p.collected ||= it.collected;
                p.score ||= it.score;
              }
            }
            this.sets[key].searches = searches;
            this.saveSets();
            this.feed(`${lo}–${hi} p.${page} : ${res.data.length} annonce(s), ${fresh} nouvelle(s) carte(s)`);
            if (res.data.length < PAGE_SIZE) break;
            await this.sleep(this.delay(cfg), 'Prochaine page');
          }
          if (s + 1 < bounds.length && searches < cfg.scanMaxSearches) await this.sleep(this.delay(cfg), 'Tranche de prix suivante');
        }
        this.sets[key].partial = this.stopRequested || searches >= cfg.scanMaxSearches;
        this.saveSets();
        const list = this.setPlayers(this.sets[key]);
        this.log(`Scan terminé : ${list.length} carte(s) du club sur le marché, ${list.filter((p) => !p.collected).length} manquante(s)${this.sets[key].partial ? ' (scan partiel)' : ''}`);
      } catch (e) {
        this.log(`Erreur scan : ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        this.leave();
      }
    }

    // --- Achat puis remise en vente immédiate, tous sets confondus ---

    async validate() {
      await this.stopWatch();
      if (this.running) return;
      const { list } = this.picks();
      if (!list.length) return this.log('Aucun joueur coché avec un prix max');
      const setOf = (defId) => this.setList().find((s) => s.players?.[defId])?.name ?? '';
      const pct = this.getConfig().autoRaisePct;
      this.queue = list.map(({ p, max }) => ({ defId: p.defId, name: p.name, rating: p.rating, max, max0: max, cap: capFor(max, pct), set: setOf(p.defId), status: 'pending', tries: 0, price: 0, sell: 0 }));
      save(K_QUEUE, this.queue);
      this.touch();
      await this.runQueue();
    }

    async runQueue() {
      await this.stopWatch();
      if (!this.queue.some(isOpen)) return this.log('Rien à acheter');
      if (!(await this.enter('buy'))) return;
      save(K_ACTIVE, true);
      const n = this.queue.length;
      const cfg = this.getConfig();
      const sets = new Set(this.queue.map((q) => q.set).filter(Boolean));
      this.log(`Achat et revente de ${n} joueur(s)${sets.size ? ` (${sets.size} set${sets.size > 1 ? 's' : ''})` : ''}`);
      let completed = false;
      try {
        await this.maintain();
        for (const e of this.queue) {
          if (this.stopRequested) break;
          if (e.status === 'searching') e.status = 'pending';
          if (e.status !== 'pending') continue;
          await this.buyOne(e);
          save(K_QUEUE, this.queue);
          this.touch();
          this.emit();
          if (this.queue.some(isOpen)) await this.sleep(this.delay(cfg), 'Joueur suivant');
        }
        if (!this.stopRequested) {
          save(K_ACTIVE, false);
          const ok = this.queue.filter(isDone).length;
          const fail = this.queue.filter(isFailed).length;
          this.log(`Achats terminés : ${ok}/${n} joueur(s) achetés et remis en vente${fail ? `, ${fail} à relancer automatiquement` : ''}. Vérifie les sets dans la Galerie.`, 'buy');
          this.notify('AlbumFC27 : achats terminés', `${ok}/${n} joueur(s) achetés et remis en vente${fail ? `, ${fail} relancé(s) plus tard` : ''}.`);
          completed = true;
        }
      } catch (err) {
        this.log(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        for (const e of this.queue) if (e.status === 'searching') e.status = 'pending';
        save(K_QUEUE, this.queue);
        this.leave();
      }
      if (completed) await this.watch();
    }

    async buyOne(e) {
      const cfg = this.getConfig();
      e.max0 ??= e.max;
      // Plafond recalculé (files créées avant la hausse auto, réglage modifié)
      e.cap = Math.max(e.cap ?? 0, e.max, capFor(e.max0, cfg.autoRaisePct * ((e.rounds ?? 0) + 1)));
      let raised = false;
      // Essais au prix max courant ; chaque recherche vide relève le max (plafond e.cap) et accorde un essai de plus
      while (!this.stopRequested && (e.tries < cfg.triesPerPlayer || raised)) {
        raised = false;
        if (this.pileCount >= PILE_MAX) {
          this.activity('Liste de transferts pleine : attente de ventes');
          this.log('Liste de transferts pleine (100) : attente de ventes, nouvel essai dans 2 min');
          await this.sleep(12e4, 'Liste de transferts pleine, nouvel essai');
          await this.maintain();
          continue;
        }
        const wallet = coins();
        const available = wallet === null ? Infinity : wallet - cfg.coinReserve;
        if (available < 200) {
          e.status = 'nocoins';
          e.at = Date.now();
          return this.feed(`${e.name} : crédits insuffisants (${fmtNum(wallet)})`);
        }
        if (!(await this.waitGuard(cfg))) return;
        e.status = 'searching';
        e.tries++;
        this.activity(`Recherche ${e.name} ≤ ${fmtNum(e.max)}${e.max > e.max0 ? ` (relevé, plafond ${fmtNum(e.cap)})` : ''}, essai ${e.tries}`);
        // minBuy alterné : contourne le cache EA sans exclure d'annonce (prix mini 200)
        const res = await searchMarket({ defId: [e.defId] }, e.tries % 2 ? 0 : 150, e.max);
        this.guard.record('searches');
        if (!res.success) {
          if (this.fatal(res, 'search')) return;
          this.feed(`${e.name} : recherche en échec (statut ${res.status})`);
        } else {
          if (res.data[0]?.collected) {
            e.status = 'notfound';
            e.collected = true;
            this.markCollected(e.defId);
            return this.feed(`${e.name} : déjà dans la Galerie, ignoré`);
          }
          const cands = res.data
            .filter((it) => it.defId === e.defId && it.buyNow > 0 && it.buyNow <= e.max && it.buyNow <= available && !(it.expires > 0 && it.expires <= 3))
            .sort((a, b) => a.buyNow - b.buyNow)
            .slice(0, 2);
          const missed = new Set();
          for (const it of cands) {
            // Autres annonces encore en vente (hors carte achetée et annonces ratées, parties chez un autre)
            const others = res.data.filter((x) => x.defId === e.defId && x.buyNow > 0 && x.tradeId !== it.tradeId && !missed.has(x.tradeId));
            const r = await this.buyAndList(it, e, cfg, others);
            if (r === 'stop' || r === 'ok') return;
            missed.add(it.tradeId);
          }
          const listed = res.data.some((x) => x.defId === e.defId && x.buyNow > 0 && x.buyNow <= e.max);
          if (!listed && e.max < e.cap) {
            const prev = e.max;
            e.max = raisePrice(e.max, e.cap);
            raised = true;
            this.feed(`${e.name} : aucune annonce ≤ ${fmtNum(prev)}, prix max relevé à ${fmtNum(e.max)}${e.max >= e.cap ? ' (plafond)' : ''}`);
          } else if (!cands.length) this.feed(`${e.name} : aucune annonce ≤ ${fmtNum(e.max)}${listed ? ' achetable (crédits)' : ''}`);
        }
        if (e.tries < cfg.triesPerPlayer || raised) await this.sleep(this.delay(cfg), `Nouvel essai pour ${e.name}`);
      }
      if (!this.stopRequested && isOpen(e)) {
        e.status = 'notfound';
        e.at = Date.now();
        this.log(`${e.name} introuvable ≤ ${fmtNum(e.max)} après ${e.tries} recherche(s)`);
      }
    }

    markCollected(defId) {
      this.done.add(defId);
      save(K_DONE, [...this.done]);
      for (const s of Object.values(this.sets)) if (s.players?.[defId]) s.players[defId].collected = true;
      this.saveSets();
    }

    // Revente : un palier sous la moins chère des autres annonces (50 sous 1 000), sinon prix d'achat
    sellPrice(it, others) {
      if (!others.length) return it.buyNow;
      return Math.max(200, priceDown(Math.min(...others.map((x) => x.buyNow))));
    }

    async buyAndList(it, e, cfg, others = []) {
      await sleep(rand(cfg.buyDelayMinMs, cfg.buyDelayMaxMs));
      if (this.stopRequested) return 'stop';
      const name = e.name || it.name;
      this.activity(`Achat de ${name} à ${fmtNum(it.buyNow)}…`);
      const r = await bid(it);
      if (!r.success) {
        if (this.fatal(r, 'bid')) return 'stop';
        this.feed(`Raté ${name} à ${fmtNum(it.buyNow)} (${r.status === 403 ? 'déjà acheté par un autre' : `statut ${r.status}`})`);
        if (++this.misses >= MAX_MISSES) {
          this.lockout(`${this.misses} achats ratés d'affilée`, true);
          return 'stop';
        }
        return 'miss';
      }
      this.misses = 0;
      this.guard.record('purchases');
      e.price = it.buyNow;
      e.status = 'bought';
      this.markCollected(e.defId);
      this.setSelected(e.defId, false);
      this.addTotal('bought', 1);
      this.addTotal('spent', it.buyNow);
      this.log(`Acheté ${name} à ${fmtNum(it.buyNow)}${e.set ? ` (${e.set})` : ''}`);

      const id = Number(it.raw?.id);
      if (id) {
        this.bought[id] = { price: it.buyNow, sell: 0, defId: e.defId, name };
        save(K_BOUGHT, this.bought);
      }
      await sleep(rand(800, 1600));
      if (this.stopRequested) return 'ok';
      const sell = this.sellPrice(it, others);
      const l = await moveAndList(it.raw, sell);
      if (l.success) {
        this.listFails = 0;
        this.pileCount++;
        e.status = 'listed';
        e.sell = sell;
        if (this.bought[id]) {
          this.bought[id].sell = sell;
          save(K_BOUGHT, this.bought);
        }
        this.feed(`${name} remis en vente à ${fmtNum(sell)} (${others.length ? `${others.length} autre(s) annonce(s), plus basse ${fmtNum(Math.min(...others.map((x) => x.buyNow)))}` : "aucune autre annonce : prix d'achat"})`);
      } else {
        if (this.fatal(l, 'list')) return 'stop';
        this.log(`Mise en vente de ${name} échouée (statut ${l.status})${errText(l.error)} : joueur dans les non-assignés`);
        if (++this.listFails >= MAX_LIST_FAILS) {
          this.stop(`${this.listFails} mises en vente échouées d'affilée, arrêt`);
          return 'stop';
        }
      }
      return 'ok';
    }

    // --- Ventes : encaissement, réajustement des invendus ---

    async maintain() {
      this.activity('Lecture de la liste de transferts');
      try {
        const pile = await readTransferPile();
        if (!pile.success) {
          if (pile.status === 401) return this.sessionExpired();
          return this.log(`Lecture de la liste de transferts impossible (statut ${pile.status})${errText(pile.error)}`);
        }
        const sold = pile.data.filter((i) => i.state === 'sold');
        const expired = pile.data.filter((i) => i.state === 'expired');
        for (const i of sold) {
          const net = Math.floor(i.soldPrice * (1 - EA_TAX));
          const tax = i.soldPrice - net;
          const b = this.bought[i.id];
          let result = '';
          if (b !== undefined) {
            // Perte = prix d'achat - montant net encaissé (négatif = gain)
            const loss = (typeof b === 'number' ? b : b.price) - net;
            this.addTotal('tax', tax);
            this.addTotal('lost', loss);
            this.addTotal('sold', 1);
            delete this.bought[i.id];
            result = loss >= 0 ? `, perte ${fmtNum(loss)}` : `, gain ${fmtNum(-loss)}`;
          }
          this.feed(`Vendu ${i.name} à ${fmtNum(i.soldPrice)} (taxe ${fmtNum(tax)}${result})`);
        }
        save(K_BOUGHT, this.bought);
        if (sold.length) {
          await sleep(rand(500, 1200));
          const c = await observe(services.Item.clearSoldItems?.());
          if (!c.success) this.log(`Encaissement des ventes échoué (statut ${c.status})${errText(c.error)}`);
        }
        const cfg = this.getConfig();
        const adjusted = new Set();
        for (const i of expired) {
          if (this.stopRequested) break;
          const b = this.bought[i.id];
          if (!b || !i.raw) continue;
          const rec = typeof b === 'number' ? (this.bought[i.id] = { price: b, sell: 0, defId: i.defId, name: i.name }) : b;
          const r = await this.readjust(i, rec, cfg);
          if (r === 'stop') return;
          if (r === 'ok') adjusted.add(i.id);
        }
        save(K_BOUGHT, this.bought);
        if (this.stopRequested) return;
        const rest = expired.length - adjusted.size;
        if (rest > 0) {
          await sleep(rand(500, 1200));
          const r = await observe(services.Item.relistExpiredAuctions?.());
          this.feed(r.success ? `${rest} invendu(s) remis en vente au même prix` : `Remise en vente des invendus échouée (statut ${r.status})`);
        }
        this.pileCount = pile.data.length - sold.length;
        const inPile = new Set(pile.data.filter((i) => i.state !== 'sold').map((i) => String(i.id)));
        // Joueurs vendus ou retirés hors extension : plus suivis
        for (const id of Object.keys(this.bought)) if (!inPile.has(id)) delete this.bought[id];
        save(K_BOUGHT, this.bought);
        this.ownListed = Object.keys(this.bought).length;
        this.feed(`Liste de transferts : ${pile.data.filter((i) => i.state === 'active').length} en vente, ${sold.length} vendu(s), ${expired.length} invendu(s)`);
        await observe(services.User.requestCurrencies?.());
      } catch (e) {
        this.log(`Liste de transferts : ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        this.activity('');
      }
    }

    // Invendu acheté par l'extension : un palier sous la moins chère des annonces concurrentes, sinon même prix
    async readjust(i, b, cfg) {
      const cur = i.buyNow || b.sell || b.price;
      const defId = b.defId || i.defId;
      let price = cur;
      let others = 0;
      if (defId) {
        if (!(await this.waitGuard(cfg))) return 'stop';
        await this.sleep(this.delay(cfg), `Contrôle du prix de ${i.name}`);
        if (this.stopRequested) return 'stop';
        this.activity(`Prix de ${i.name} (invendu à ${fmtNum(cur)})`);
        b.checks = (b.checks ?? 0) + 1;
        const res = await searchMarket({ defId: [defId] }, b.checks % 2 ? 0 : 150, cur);
        this.guard.record('searches');
        if (!res.success) {
          if (this.fatal(res, 'search')) return 'stop';
        } else {
          const lows = res.data.filter((x) => x.defId === defId && x.buyNow > 0).map((x) => x.buyNow);
          others = lows.length;
          if (others) price = Math.min(cur, Math.max(200, priceDown(Math.min(...lows))));
        }
      }
      if (cfg.minSellPct > 0) price = Math.max(price, Math.min(cur, roundUp((b.price * cfg.minSellPct) / 100)));
      await sleep(rand(500, 1200));
      const r = await listItem(i.raw, price);
      if (!r.success) {
        if (this.fatal(r, 'list')) return 'stop';
        this.feed(`Remise en vente de ${i.name} échouée (statut ${r.status})`);
        return 'fail';
      }
      b.sell = price;
      this.feed(price < cur ? `${i.name} invendu : ${fmtNum(cur)} → ${fmtNum(price)} (${others} annonce(s) moins chère(s) ou égale(s))` : `${i.name} invendu : remis à ${fmtNum(price)} (personne en dessous)`);
      return 'ok';
    }

    // Suivi des ventes : encaisse et réajuste les invendus jusqu'à ce que tout soit vendu
    async watch() {
      if (this.busy) return;
      if (!(await this.enter('watch'))) return;
      save(K_WATCH, true);
      this.log(`Suivi des ventes : encaissement et réajustement des invendus toutes les ${this.getConfig().watchMinutes} min`);
      this.retryNow = false;
      try {
        while (!this.stopRequested) {
          await this.maintain();
          if (this.stopRequested) break;
          if (this.prepareRetries()) {
            this.retryNow = true;
            break;
          }
          if (!this.ownListed && !this.retryPending()) {
            save(K_WATCH, false);
            this.log('Plus aucun joueur acheté en vente : suivi terminé');
            this.notify('AlbumFC27 : terminé', 'Tous les joueurs achetés sont vendus.');
            break;
          }
          const d = Math.max(1, this.getConfig().watchMinutes) * 6e4 * rand(0.8, 1.2);
          this.activity(`${this.ownListed} joueur(s) en vente${this.retryPending() ? ', relances en attente' : ''}`);
          await this.sleep(d, 'Prochain contrôle des ventes');
        }
      } catch (e) {
        this.log(`Suivi des ventes : ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        this.leave();
      }
      if (this.retryNow) await this.runQueue();
    }

    // Relances sans clic : introuvables après un délai (nombre de tours limité), crédits insuffisants dès que les ventes ont rendu des crédits
    retryPending() {
      const cfg = this.getConfig();
      return this.queue.some((q) => (q.status === 'notfound' && !q.collected && cfg.retryMinutes > 0 && (q.rounds ?? 0) < cfg.retryRounds) || (q.status === 'nocoins' && this.ownListed > 0));
    }
    prepareRetries() {
      const cfg = this.getConfig();
      const wallet = coins();
      const free = wallet === null ? Infinity : wallet - cfg.coinReserve;
      const now = Date.now();
      const due = this.queue.filter((q) => {
        if (q.collected || this.done.has(q.defId)) return false;
        if (q.status === 'nocoins') return q.max <= free;
        return q.status === 'notfound' && cfg.retryMinutes > 0 && (q.rounds ?? 0) < cfg.retryRounds && now - (q.at ?? 0) >= cfg.retryMinutes * 6e4;
      });
      if (!due.length) return false;
      for (const q of due) {
        if (q.status === 'notfound') {
          q.rounds = (q.rounds ?? 0) + 1;
          // Plafond relevé à chaque tour : +autoRaisePct % du prix max initial par tour
          q.max0 ??= q.max;
          q.cap = Math.max(q.cap ?? q.max, capFor(q.max0, cfg.autoRaisePct * (q.rounds + 1)));
        }
        q.status = 'pending';
        q.tries = 0;
      }
      save(K_QUEUE, this.queue);
      this.touch();
      this.log(`Relance automatique de ${due.length} joueur(s) : ${due.map((q) => `${q.name}${q.status === 'pending' && q.rounds ? ` (plafond ${fmtNum(q.cap)})` : ''}`).join(', ')}`, 'warn');
      return true;
    }

    // Délai entre recherches, allongé après une limite EA récente
    delay(cfg) {
      return rand(cfg.minDelayMs, cfg.maxDelayMs) * this.guard.pace();
    }

    async sleep(ms, label) {
      if (this.stopRequested) return;
      this.waitUntil = Date.now() + ms;
      this.waitLabel = label ?? '';
      this.emit();
      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(t);
          this.wake = null;
          this.waitUntil = 0;
          this.waitLabel = '';
          resolve();
        };
        const t = setTimeout(done, ms);
        this.wake = done;
      });
    }
  }

  // ---------- Panneau ----------

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.box { position: fixed; top: 64px; left: 16px; z-index: 2147483647; width: 400px; max-height: min(780px, 90vh);
  display: flex; flex-direction: column; font: 12px/1.4 system-ui, sans-serif; color: #e6e7eb;
  background: #14161b; border: 1px solid #2a2e38; border-radius: 12px; box-shadow: 0 10px 30px #000a; overflow: hidden; }
.box.hidden { display: none; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px; cursor: move; user-select: none; }
header .title { font-weight: 700; font-size: 13px; }
header .coins { margin-left: auto; font-size: 11px; color: #c9ccd4; background: #1e2129; padding: 2px 8px; border-radius: 10px; }
.pill { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: #9aa0ad; }
.pill::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #5c6170; }
.pill.on { color: #d3f9d8; } .pill.on::before { background: #51cf66; animation: pulse 1.2s ease-in-out infinite; }
.pill.lock { color: #ffd8a8; } .pill.lock::before { background: #fd7e14; }
@keyframes pulse { 50% { opacity: .3; } }
.x { background: none; color: #8a8f9c; padding: 0 4px; font-size: 16px; line-height: 1; }
.activity { padding: 0 12px 8px; font-size: 11px; color: #9aa0ad; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 15px; }
.banner { margin: 0 12px 8px; padding: 6px 8px; border-radius: 8px; background: #3b2a12; color: #ffd8a8; font-size: 11px; display: flex; gap: 8px; align-items: center; }
.banner button { margin-left: auto; padding: 3px 8px; font-size: 11px; background: #5c4012; }
.banner:empty { display: none; }
nav { display: flex; gap: 2px; padding: 0 8px; border-bottom: 1px solid #2a2e38; }
nav button { background: none; border-radius: 0; padding: 7px 10px; color: #8a8f9c; font-weight: 600; border-bottom: 2px solid transparent; }
nav button.on { color: #e6e7eb; border-bottom-color: #4c6ef5; }
.body { flex: 1 1 auto; min-height: 120px; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.tab { display: none; flex-direction: column; gap: 10px; } .tab.on { display: flex; }
h4 { margin: 0; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #7c8190; }
input, select { background: #0d0f13; color: inherit; border: 1px solid #2a2e38; border-radius: 6px; padding: 5px 7px; font: inherit; min-width: 0; }
input:focus, select:focus { outline: none; border-color: #4c6ef5; }
button { border: 0; border-radius: 6px; padding: 6px 10px; font: inherit; font-weight: 600; cursor: pointer; background: #262a33; color: #e6e7eb; }
button:hover:not(:disabled) { filter: brightness(1.18); }
button:disabled { opacity: .4; cursor: default; }
.row { display: flex; gap: 6px; align-items: center; }
.row > .grow { flex: 1; width: 0; }
.blue { background: #364fc7; color: #fff; } .go { background: #2f9e44; color: #fff; } .stop { background: #c92a2a; color: #fff; }
.small { padding: 3px 8px; font-size: 11px; font-weight: 500; }
.hint { font-size: 11px; color: #8a8f9c; } .hint:empty { display: none; }
.card { background: #1b1e25; border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.card.hidden { display: none; }
.empty { color: #8a8f9c; font-size: 12px; line-height: 1.6; padding: 6px 2px; }
.empty b { color: #e6e7eb; }
.filters { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 11px; color: #a9aebb; }
.filters input[type=search] { flex: 1; min-width: 120px; }
.filters label { display: flex; gap: 4px; align-items: center; }
.set { border: 1px solid #2a2e38; border-radius: 8px; overflow: hidden; }
.shead { display: grid; grid-template-columns: auto auto 1fr auto auto; align-items: center; gap: 6px; padding: 6px 8px; background: #1b1e25; cursor: pointer; user-select: none; }
.shead .caret { color: #7c8190; width: 10px; transition: transform .15s; }
.set.open .shead .caret { transform: rotate(90deg); }
.shead .nm { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shead .mt { grid-column: 3; font-size: 11px; color: #8a8f9c; }
.shead .src { font-size: 10px; color: #a5b4fc; background: #22284a; padding: 1px 6px; border-radius: 8px; }
.shead button { grid-row: 1 / span 2; }
.shead input[type=checkbox] { grid-row: 1 / span 2; }
.sbody { display: none; padding: 4px; flex-direction: column; gap: 2px; }
.set.open .sbody { display: flex; }
.p { display: grid; grid-template-columns: auto 1fr auto; align-items: center; column-gap: 8px; padding: 5px 6px; border-radius: 6px; }
.p:hover { background: #1b1e25; }
.p.got { opacity: .45; }
.p.sel { background: #18233a; }
.p .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.p .n i { font-style: normal; color: #ffd43b; margin-right: 4px; }
.p .m { grid-column: 2; font-size: 11px; color: #8a8f9c; }
.p .st { grid-column: 2; font-size: 11px; color: #74c0fc; }
.p .st.ok { color: #51cf66; } .p .st.ko { color: #ff8787; }
.p input[type=checkbox] { grid-row: 1 / span 3; }
.p input[type=number] { grid-row: 1 / span 3; grid-column: 3; width: 80px; text-align: right; }
footer { border-top: 1px solid #2a2e38; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; background: #171a20; }
footer.hidden { display: none; }
.cost { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.cost div { background: #1e2129; border-radius: 6px; padding: 5px 6px; }
.cost span { display: block; font-size: 10px; color: #8a8f9c; }
.cost b { font-size: 12px; }
.cost .warn b { color: #ffa94d; }
.note { font-size: 11px; color: #8a8f9c; } .note:empty { display: none; }
.note.warn { color: #ffa94d; }
.bar { height: 6px; background: #0d0f13; border-radius: 3px; overflow: hidden; }
.bar .fill { height: 100%; width: 0; background: #2f9e44; transition: width .4s; }
.bar.hidden { display: none; }
button.big { width: 100%; padding: 10px; font-size: 13px; }
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.stat { background: #1b1e25; border-radius: 8px; padding: 8px; }
.stat span { display: block; font-size: 10px; color: #8a8f9c; text-transform: uppercase; letter-spacing: .04em; }
.stat b { font-size: 15px; }
.stat b.neg { color: #ff8787; } .stat b.pos { color: #51cf66; }
.sale { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; padding: 5px 6px; border-radius: 6px; background: #1b1e25; }
.sale .m { font-size: 11px; color: #8a8f9c; }
.feed { font: 11px/1.5 ui-monospace, monospace; color: #a9aebb; background: #0d0f13; border-radius: 6px; padding: 6px; max-height: 160px; overflow-y: auto; }
.feed div:first-child { color: #e6e7eb; }
.log { font: 11px/1.4 ui-monospace, monospace; background: #0d0f13; border-radius: 6px; padding: 6px; height: 220px; overflow-y: auto; white-space: pre-wrap; color: #a9aebb; }
.live { border-top: 1px solid #2a2e38; background: #111318; display: flex; flex-direction: column; }
.live.hidden { display: none; }
.live .lhead { display: flex; align-items: center; gap: 8px; padding: 6px 12px; cursor: pointer; user-select: none; font-size: 11px; color: #a9aebb; }
.live .lhead b { color: #e6e7eb; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
.live .dot { width: 7px; height: 7px; border-radius: 50%; background: #5c6170; }
.live.on .dot { background: #51cf66; animation: pulse 1.2s ease-in-out infinite; }
.live .chips { display: flex; gap: 6px; }
.live .chip { padding: 1px 6px; border-radius: 8px; background: #1e2129; font-size: 10px; }
.live .cd { margin-left: auto; color: #74c0fc; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px; }
.live .lbody { max-height: 132px; overflow-y: auto; padding: 0 8px 6px; }
.live.closed .lbody { display: none; }
.ev { display: grid; grid-template-columns: 52px 14px 1fr; gap: 4px; padding: 2px 4px; border-radius: 4px; font-size: 11px; line-height: 1.45; color: #c9ccd4; animation: fadein .35s ease-out; }
.ev .tm { color: #6c7180; font-variant-numeric: tabular-nums; }
.ev .ic { text-align: center; font-weight: 700; }
.ev.step { color: #7c8190; } .ev.step .ic { color: #5c6170; }
.ev.major { color: #e6e7eb; }
.ev.buy .ic, .ev.buy.major { color: #69db7c; } .ev.sell .ic { color: #ffd43b; } .ev.sell.major, .ev.sell { color: #ffe066; }
.ev.list .ic { color: #74c0fc; } .ev.miss .ic, .ev.error .ic { color: #ff8787; } .ev.error { color: #ffa8a8; }
.ev.lock { color: #ffc078; background: #2b2012; } .ev.lock .ic, .ev.warn .ic { color: #ffa94d; }
@keyframes fadein { from { background: #2a3a5a; } }
.jtools { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.jtools .chipbtn { padding: 3px 8px; font-size: 11px; font-weight: 500; background: #1e2129; }
.jtools .chipbtn.on { background: #364fc7; color: #fff; }
.jlist { background: #0d0f13; border-radius: 6px; padding: 4px; min-height: 200px; max-height: 460px; overflow-y: auto; }
.setting { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 2px 0; }
.setting input { width: 74px; text-align: right; }
.pair { display: flex; align-items: center; gap: 4px; color: #7c8190; }
.pair input { width: 54px; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.actions button { flex: 1; padding: 6px; font-weight: 500; font-size: 11px; }
`;

  const SETTING_GROUPS = [
    {
      title: 'Achat',
      items: [
        { key: 'pricePct', label: 'Prix max proposé (% au-dessus du prix de référence)' },
        { key: 'autoRaisePct', label: 'Hausse auto si introuvable (% par tour au-dessus du prix max, 0 = non)' },
        { key: 'retryMinutes', label: 'Relance auto des introuvables après (min, 0 = non)' },
        { key: 'retryRounds', label: 'Tours de relance max (plafond relevé à chaque tour)' },
        { key: 'triesPerPlayer', label: 'Recherches max par joueur' },
        { key: 'coinReserve', label: 'Crédits à garder' },
        { delay: ['minDelayMs', 'maxDelayMs'], label: 'Délai entre recherches (s)' },
        { delay: ['buyDelayMinMs', 'buyDelayMaxMs'], label: 'Délai avant achat (s)', step: 0.1 },
      ],
    },
    {
      title: 'Ventes',
      items: [
        { key: 'watchMinutes', label: 'Contrôle des ventes toutes les (min)' },
        { key: 'minSellPct', label: 'Revente plancher (% du prix d’achat, 0 = aucun)' },
      ],
    },
    {
      title: 'Sécurité',
      items: [
        { key: 'softPauseMinutes', label: 'Pause après limite EA 426/429/521 (min, doublée si ça se répète, max 30)' },
        { key: 'lockMinutes', label: 'Pause après captcha 458 (min, doublée si ça se répète, 0 = arrêt 12 h)' },
        { key: 'maxSearchesPerHour', label: 'Recherches max / heure' },
        { key: 'maxSearchesPerDay', label: 'Recherches max / 24 h' },
        { key: 'maxPurchasesPerDay', label: 'Achats max / 24 h' },
      ],
    },
    {
      title: 'Scan marché (secours)',
      items: [
        { key: 'scanMaxPrice', label: 'Prix max des cartes' },
        { key: 'scanMaxSearches', label: 'Recherches max par scan' },
        { key: 'scanPagesPerSlice', label: 'Pages par tranche de prix' },
      ],
    },
  ];

  function h(tag, props = {}, ...children) {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
    return n;
  }

  async function copyText(t) {
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: t });
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  function flash(btn, ok) {
    const t = btn.textContent;
    btn.textContent = ok ? 'Copié' : 'Échec';
    setTimeout(() => (btn.textContent = t), 1500);
  }

  class Panel {
    config = loadConfig();
    filter = { text: '', tier: 'all', showCollected: false };
    open = new Set();
    tab = 'sets';
    leagues = [];
    clubs = [];
    lastSig = '';

    constructor(engine) {
      this.engine = engine;
      const host = document.createElement('div');
      host.id = `${NS}-host`;
      for (const ev of ['keydown', 'keyup', 'keypress']) host.addEventListener(ev, (e) => e.stopPropagation());
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      this.box = h('div', { className: 'box' });
      shadow.append(h('style', { textContent: CSS }), this.box);
      const first = engine.setList()[0];
      if (first) this.open.add(first.key);
      this.build();
    }
    toggle() {
      this.box.classList.toggle('hidden');
    }
    show() {
      this.box.classList.remove('hidden');
    }
    setConfig(patch) {
      this.config = { ...this.config, ...patch };
      save(K_CONFIG, this.config);
    }

    build() {
      this.pill = h('span', { className: 'pill' });
      this.coinsEl = h('span', { className: 'coins' });
      const header = h('header', {}, h('span', { className: 'title', textContent: 'AlbumFC27' }), this.pill, this.coinsEl, h('button', { className: 'x', textContent: '×', title: 'Masquer', onclick: () => this.toggle() }));
      this.draggable(header);
      this.activityEl = h('div', { className: 'activity' });
      this.bannerEl = h('div', { className: 'banner' });

      this.tabs = {};
      this.tabBtns = {};
      const nav = h('nav');
      for (const [id, label] of [['sets', 'Sets'], ['sales', 'Ventes'], ['log', 'Journal'], ['settings', 'Réglages']]) {
        this.tabBtns[id] = h('button', { textContent: label, onclick: () => this.showTab(id) });
        nav.append(this.tabBtns[id]);
      }
      this.tabs.sets = this.buildSetsTab();
      this.tabs.sales = this.buildSalesTab();
      this.tabs.log = this.buildLogTab();
      this.tabs.settings = this.buildSettingsTab();
      const body = h('div', { className: 'body' }, ...Object.values(this.tabs));
      this.footer = this.buildFooter();
      this.live = this.buildLive();
      this.box.append(header, this.activityEl, this.bannerEl, nav, body, this.live, this.footer);
      this.showTab('sets');
      this.renderEvents(true);
      this.baseTitle = document.title;
      // Compte à rebours en direct de la prochaine action
      setInterval(() => this.tick(), 1e3);
    }

    // --- Bandeau « En direct » (toujours visible) ---

    buildLive() {
      this.liveDot = h('span', { className: 'dot' });
      this.liveChips = h('span', { className: 'chips' });
      this.liveCd = h('span', { className: 'cd' });
      this.liveList = h('div');
      const wrap = h('div', { className: `live${load(`${NS}:liveClosed`, false) ? ' closed' : ''}` });
      const head = h('div', { className: 'lhead', title: 'Afficher / masquer' }, this.liveDot, h('b', { textContent: 'En direct' }), this.liveChips, this.liveCd);
      head.onclick = () => {
        wrap.classList.toggle('closed');
        save(`${NS}:liveClosed`, wrap.classList.contains('closed'));
      };
      wrap.append(head, h('div', { className: 'lbody' }, this.liveList));
      return wrap;
    }

    tick() {
      const e = this.engine;
      const left = e.waitUntil - Date.now();
      const txt = e.running && left > 0 ? `${e.waitLabel || 'Prochaine action'} dans ${fmtWait(left)}` : e.running ? e.activityText || 'En cours…' : '';
      this.liveCd.textContent = txt;
      if (e.running) this.activityEl.textContent = txt;
    }

    liveStats(s) {
      const q = s.queue;
      const chips = [];
      if (q.total) chips.push(`${q.listed}/${q.total} achetés`);
      if (q.failed) chips.push(`${q.failed} à relancer`);
      if (s.onSale) chips.push(`${s.onSale} en vente`);
      if (s.total.sold) chips.push(`${s.total.sold} vendus`);
      this.liveChips.replaceChildren(...chips.map((c) => h('span', { className: 'chip', textContent: c })));
      this.live.classList.toggle('on', s.running);
    }

    eventRow(ev) {
      const icons = { buy: '✓', sell: '€', list: '↗', miss: '✗', lock: '⏸', error: '!', warn: '!', info: '•', step: '·' };
      const tm = new Date(ev.t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      return h('div', { className: `ev ${ev.type}${ev.major ? ' major' : ''}` }, h('span', { className: 'tm', textContent: tm }), h('span', { className: 'ic', textContent: icons[ev.type] ?? '•' }), h('span', { textContent: ev.msg }));
    }

    eventMatches(ev) {
      const f = this.jfilter ?? 'all';
      if (f === 'all') return true;
      if (f === 'main') return ev.type !== 'step';
      if (f === 'trade') return ev.type === 'buy' || ev.type === 'sell' || ev.type === 'list';
      return ev.type === 'miss' || ev.type === 'error' || ev.type === 'warn' || ev.type === 'lock';
    }

    // Ajoute les nouveaux évènements en tête (sans tout reconstruire) ; full = reconstruction
    renderEvents(full = false) {
      const evs = this.engine.events;
      const newest = evs[0]?.id ?? 0;
      if (full || newest < (this.shownEventId ?? 0)) {
        this.liveList.replaceChildren(...evs.slice(0, 8).map((ev) => this.eventRow(ev)));
        this.jList.replaceChildren(...evs.filter((ev) => this.eventMatches(ev)).slice(0, 300).map((ev) => this.eventRow(ev)));
      } else {
        const fresh = evs.filter((ev) => ev.id > (this.shownEventId ?? 0)).reverse();
        if (fresh.length) this.jList.querySelector('.empty')?.remove();
        for (const ev of fresh) {
          this.liveList.prepend(this.eventRow(ev));
          if (this.eventMatches(ev)) this.jList.prepend(this.eventRow(ev));
        }
        while (this.liveList.childElementCount > 8) this.liveList.lastChild.remove();
        while (this.jList.childElementCount > 300) this.jList.lastChild.remove();
      }
      if (!evs.length) this.jList.replaceChildren(h('div', { className: 'empty', textContent: 'Journal vide.' }));
      this.shownEventId = newest;
    }

    showTab(id) {
      this.tab = id;
      for (const [k, el] of Object.entries(this.tabs)) el.classList.toggle('on', k === id);
      for (const [k, b] of Object.entries(this.tabBtns)) b.classList.toggle('on', k === id);
      this.footer.classList.toggle('hidden', id !== 'sets');
      this.live?.classList.toggle('hidden', id === 'log');
      if (id === 'sales') this.renderSales();
    }

    // --- Onglet Sets ---

    buildSetsTab() {
      const addFutgg = h('button', { className: 'blue grow', textContent: '+ Set depuis fut.gg', onclick: () => window.open(FUTGG_GALLERY, '_blank', 'noopener') });
      this.clubCard = this.buildClubCard();
      const addClub = h('button', { className: 'grow', textContent: '+ Club via le marché', onclick: () => this.clubCard.classList.toggle('hidden') });

      const search = h('input', { type: 'search', placeholder: 'Rechercher un joueur' });
      search.oninput = () => ((this.filter.text = search.value.trim().toLowerCase()), this.renderSets());
      const tier = h('select');
      for (const [v, t] of [['all', 'Toutes'], ['gold', 'Or'], ['silver', 'Argent'], ['bronze', 'Bronze'], ['special', 'Spéciales'], ['unknown', 'Note ?']]) tier.append(h('option', { value: v, textContent: t }));
      tier.onchange = () => ((this.filter.tier = tier.value), this.renderSets());
      const showCol = h('input', { type: 'checkbox' });
      showCol.onchange = () => ((this.filter.showCollected = showCol.checked), this.renderSets());
      this.filtersEl = h(
        'div',
        { className: 'filters' },
        search,
        tier,
        h('label', {}, showCol, 'collectés'),
        h('button', { className: 'small', textContent: 'Tout cocher', onclick: () => this.checkVisible(true) }),
        h('button', { className: 'small', textContent: 'Aucun', onclick: () => this.checkVisible(false) }),
      );
      this.setsEl = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
      return h('section', { className: 'tab' }, h('div', { className: 'row' }, addFutgg, addClub), this.clubCard, this.filtersEl, this.setsEl);
    }

    buildClubCard() {
      this.leagueSel = h('select', { className: 'grow' });
      this.clubSel = h('select', { className: 'grow' });
      this.leagueSel.onchange = () => this.fillClubs();
      this.clubHint = h('div', { className: 'hint' });
      const reload = h('button', { className: 'small', textContent: '↻', title: 'Recharger les championnats', onclick: () => this.fillLeagues() });
      this.scanBtn = h('button', { className: 'blue grow', textContent: 'Scanner ce club' });
      this.scanBtn.onclick = () => {
        if (this.engine.mode === 'scan') return this.engine.stop('Scan arrêté', true);
        const c = this.clubs.find((x) => x.id === Number(this.clubSel.value));
        if (!c) return void (this.clubHint.textContent = 'Choisis un championnat puis un club.');
        this.open.add(setKey({ kind: 'club', club: c.id }));
        void this.engine.scanClub({ club: c.id, name: c.name, league: Number(this.leagueSel.value) || null });
      };
      const last = h('button', { className: 'grow', textContent: 'Club de ma dernière recherche' });
      last.onclick = () => {
        if (!lastUiClub) return void (this.clubHint.textContent = 'Fais une recherche dans Transferts > Marché filtrée sur le club, puis reclique.');
        const c = (lastUiClub.league ? loadClubs(lastUiClub.league) : []).find((x) => x.id === lastUiClub.club);
        this.open.add(setKey({ kind: 'club', club: lastUiClub.club }));
        void this.engine.scanClub({ club: lastUiClub.club, name: c?.name ?? `Club n° ${lastUiClub.club}`, league: lastUiClub.league });
      };
      const card = h(
        'div',
        { className: 'card hidden' },
        h('h4', { textContent: 'Club via le marché : seules les cartes en vente apparaissent' }),
        h('div', { className: 'row' }, this.leagueSel, reload),
        h('div', { className: 'row' }, this.clubSel),
        h('div', { className: 'row' }, this.scanBtn, last),
        this.clubHint,
      );
      this.fillLeagues();
      return card;
    }

    fillLeagues() {
      this.leagues = loadLeagues();
      this.leagueSel.replaceChildren(h('option', { value: '', textContent: this.leagues.length ? 'Championnat…' : 'Championnats indisponibles' }), ...this.leagues.map((l) => h('option', { value: String(l.id), textContent: l.name })));
      this.leagueSel.disabled = !this.leagues.length;
      this.clubHint.textContent = this.leagues.length ? '' : 'Liste non trouvée dans la Web App : utilise « Club de ma dernière recherche ».';
      this.fillClubs();
    }

    fillClubs() {
      const league = Number(this.leagueSel.value) || 0;
      this.clubs = league ? loadClubs(league) : [];
      this.clubSel.replaceChildren(h('option', { value: '', textContent: league && !this.clubs.length ? 'Clubs indisponibles' : 'Club…' }), ...this.clubs.map((c) => h('option', { value: String(c.id), textContent: c.name })));
      this.clubSel.disabled = !this.clubs.length;
      if (league && !this.clubs.length) this.clubHint.textContent = 'Clubs non trouvés : utilise « Club de ma dernière recherche ».';
    }

    match(p) {
      const f = this.filter;
      return (f.tier === 'all' || tierOf(p) === f.tier) && (!f.text || p.name.toLowerCase().includes(f.text));
    }

    visibleIn(set, inQueue) {
      return this.engine.setPlayers(set).filter((p) => (this.filter.showCollected || !p.collected || inQueue.has(p.defId)) && this.match(p));
    }

    checkVisible(on, onlySet) {
      const e = this.engine;
      const inQueue = new Set(e.queue.map((q) => q.defId));
      for (const s of onlySet ? [onlySet] : e.setList()) for (const p of this.visibleIn(s, inQueue)) if (!p.collected) e.setSelected(p.defId, on);
      this.renderSets();
    }

    renderSets() {
      const e = this.engine;
      const sets = e.setList();
      this.filtersEl.style.display = sets.length ? '' : 'none';
      if (!sets.length) {
        this.setsEl.replaceChildren(
          h(
            'div',
            { className: 'empty' },
            h('b', { textContent: 'Aucun set.' }),
            h('br'),
            '1. « + Set depuis fut.gg » : ouvre un set de la Galerie, clique « Envoyer à AlbumFC27 ». Répète pour plusieurs sets.',
            h('br'),
            '2. Coche les joueurs à acheter, ajuste le prix max.',
            h('br'),
            '3. « Acheter et revendre » : achat puis remise en vente immédiate, coût projeté affiché en bas.',
          ),
        );
        this.renderFooter();
        return;
      }
      const busy = e.busy;
      const statusOf = new Map(e.queue.map((q) => [q.defId, q]));
      const inQueue = new Set(statusOf.keys());
      this.setsEl.replaceChildren(...sets.map((s) => this.renderSet(s, busy, statusOf, inQueue)));
      this.renderFooter();
    }

    renderSet(s, busy, statusOf, inQueue) {
      const e = this.engine;
      const all = e.setPlayers(s);
      const missing = all.filter((p) => !p.collected);
      const selected = missing.filter((p) => e.selection[p.defId] !== undefined).length;
      const visible = this.visibleIn(s, inQueue);
      const isOpen = this.open.has(s.key) || !!this.filter.text;
      const scanning = e.scanningKey === s.key;

      const allBox = h('input', { type: 'checkbox', title: 'Cocher tous les manquants visibles', checked: missing.length > 0 && selected === missing.length, disabled: busy || !missing.length });
      allBox.indeterminate = selected > 0 && selected < missing.length;
      allBox.onclick = (ev) => ev.stopPropagation();
      allBox.onchange = () => this.checkVisible(allBox.checked, s);
      const tools = h('span', { className: 'row' });
      if (s.kind === 'club' && !scanning) tools.append(h('button', { className: 'small', textContent: '↻', title: 'Rescanner le club', disabled: busy, onclick: (ev) => (ev.stopPropagation(), void e.scanClub({ club: s.club, name: s.name, league: s.league })) }));
      if (s.kind === 'futgg' && s.url) tools.append(h('button', { className: 'small', textContent: '↗', title: 'Ouvrir sur fut.gg pour le mettre à jour', onclick: (ev) => (ev.stopPropagation(), window.open(s.url, '_blank', 'noopener')) }));
      tools.append(h('button', { className: 'small', textContent: '×', title: 'Retirer le set', disabled: busy, onclick: (ev) => (ev.stopPropagation(), confirm(`Retirer le set « ${s.name} » ?`) && e.removeSet(s.key)) }));

      const meta = this.setMeta(s, all.length, missing.length, selected);
      const head = h(
        'div',
        { className: 'shead' },
        h('span', { className: 'caret', textContent: '▸' }),
        allBox,
        h('span', { className: 'nm', textContent: s.name }),
        h('span', { className: 'src', textContent: s.source === 'futgg' ? 'fut.gg' : 'marché' }),
        tools,
        h('span', { className: 'mt', textContent: meta }),
      );
      const wrap = h('div', { className: `set${isOpen ? ' open' : ''}` }, head);
      head.onclick = () => {
        if (this.open.has(s.key)) this.open.delete(s.key);
        else this.open.add(s.key);
        wrap.classList.toggle('open');
        if (wrap.classList.contains('open') && !wrap.querySelector('.sbody')) wrap.append(this.renderRows(s, visible, busy, statusOf));
      };
      if (isOpen) wrap.append(this.renderRows(s, visible, busy, statusOf));
      return wrap;
    }

    renderRows(s, visible, busy, statusOf) {
      const e = this.engine;
      const rows = visible.map((p) => {
        const sel = e.selection[p.defId];
        const q = statusOf.get(p.defId);
        const cb = h('input', { type: 'checkbox', checked: sel !== undefined && !p.collected, disabled: busy || p.collected });
        const max = h('input', { type: 'number', min: '200', step: String(step(p.minPrice || 200)), value: String(sel || e.defaultMax(p) || ''), placeholder: 'prix max', disabled: busy || p.collected, title: 'Prix max d’achat' });
        const row = h('div', { className: `p${p.collected && !q ? ' got' : ''}${sel !== undefined && !p.collected ? ' sel' : ''}` });
        cb.onchange = () => {
          e.setSelected(p.defId, cb.checked, Math.floor(Number(max.value)) || e.defaultMax(p));
          row.classList.toggle('sel', cb.checked);
          this.renderFooter();
          this.refreshSetHeads();
        };
        max.onchange = () => {
          const v = Math.floor(Number(max.value)) > 0 ? Math.max(200, Math.floor(Number(max.value))) : 0;
          max.value = v ? String(v) : '';
          if (!cb.checked && v) {
            cb.checked = true;
            row.classList.add('sel');
          }
          if (cb.checked) e.setSelected(p.defId, true, v);
          this.renderFooter();
          this.refreshSetHeads();
        };
        const ref = p.minPrice || Number(sel) || 0;
        const rt = ref ? roundTrip(ref) : null;
        const metaParts = [
          tierText(p),
          !p.minPrice ? 'prix inconnu : saisir un prix max' : s.source === 'futgg' ? `fut.gg ${fmtNum(p.minPrice)}` : `dès ${fmtNum(p.minPrice)} (${p.listings} annonce(s))`,
          rt && !p.collected ? `coût ~${fmtNum(rt.low)}–${fmtNum(rt.high)}` : '',
          p.collected && !q ? 'déjà collecté' : '',
        ];
        const st = q
          ? h('span', { className: `st${isDone(q) ? ' ok' : isFailed(q) ? ' ko' : ''}`, textContent: `${STATUS_LABEL[q.status] ?? q.status}${q.status === 'notfound' && !q.price ? ` (≤ ${fmtNum(q.max)})` : ''}${isOpen(q) && q.max0 && q.max > q.max0 ? ` · max relevé à ${fmtNum(q.max)}` : ''}${q.price ? ` à ${fmtNum(q.price)}` : ''}${q.sell ? `, en vente à ${fmtNum(q.sell)}` : ''}` })
          : null;
        row.append(cb, h('span', { className: 'n' }, p.rating ? h('i', { textContent: String(p.rating) }) : null, p.name), max, h('span', { className: 'm', textContent: metaParts.filter(Boolean).join(' · ') }));
        if (st) row.append(st);
        return row;
      });
      if (!rows.length) rows.push(h('div', { className: 'empty', textContent: 'Aucun joueur pour ces filtres.' }));
      return h('div', { className: 'sbody' }, ...rows);
    }

    setMeta(s, total, missing, selected) {
      const scanning = this.engine.scanningKey === s.key;
      return [`${missing} manquant(s) / ${total}`, s.needed ? `${s.needed} requis` : '', selected ? `${selected} coché(s)` : '', scanning ? 'scan en cours…' : s.partial ? 'scan partiel' : ''].filter(Boolean).join(' · ');
    }

    // Met à jour compteurs et cases « tout » des sets sans reconstruire les lignes (garde le focus)
    refreshSetHeads() {
      const e = this.engine;
      const heads = this.setsEl.querySelectorAll('.set');
      e.setList().forEach((s, i) => {
        const el = heads[i];
        if (!el) return;
        const missing = e.setPlayers(s).filter((p) => !p.collected);
        const selected = missing.filter((p) => e.selection[p.defId] !== undefined).length;
        const box = el.querySelector('.shead input[type=checkbox]');
        if (box) {
          box.checked = missing.length > 0 && selected === missing.length;
          box.indeterminate = selected > 0 && selected < missing.length;
        }
        const mt = el.querySelector('.shead .mt');
        if (mt) mt.textContent = this.setMeta(s, Object.keys(s.players ?? {}).length, missing.length, selected);
      });
    }

    // --- Pied : coût projeté et bouton principal ---

    buildFooter() {
      this.costEl = h('div', { className: 'cost' });
      this.noteEl = h('div', { className: 'note' });
      this.barEl = h('div', { className: 'bar hidden' }, h('div', { className: 'fill' }));
      this.mainBtn = h('button', { className: 'big go' });
      this.mainBtn.onclick = () => (this.engine.mode === 'buy' ? this.engine.stop('Achats arrêtés', true) : void this.engine.validate());
      this.resumeBtn = h('button', { className: 'big', textContent: 'Reprendre les achats en attente', onclick: () => void this.engine.runQueue() });
      return h('footer', {}, this.costEl, this.noteEl, this.barEl, this.mainBtn, this.resumeBtn);
    }

    renderFooter() {
      const e = this.engine;
      const pk = e.picks();
      const wallet = coins();
      const free = wallet === null ? null : wallet - this.config.coinReserve;
      const tight = free !== null && pk.engaged > free;
      const cell = (label, value, warn) => h('div', { className: warn ? 'warn' : '' }, h('span', { textContent: label }), h('b', { textContent: value }));
      this.costEl.replaceChildren(
        cell('Joueurs cochés', `${pk.list.length}`),
        cell('Crédits engagés', pk.list.length ? `~${fmtNum(pk.engaged)}` : '0', tight),
        cell('Coût projeté', pk.list.length ? `${fmtNum(pk.low)}–${fmtNum(pk.high)}` : '0'),
      );
      const notes = [];
      if (pk.list.length) notes.push(`Prix max cumulés ${fmtNum(pk.maxEngaged)}${pk.capEngaged > pk.maxEngaged ? ` (jusqu'à ${fmtNum(pk.capEngaged)} avec la hausse auto)` : ''}. Coût : taxe 5 % si revendu au prix d'achat, plus un palier si revendu sous la concurrence.`);
      if (pk.noPrice) notes.push(`${pk.noPrice} joueur(s) coché(s) sans prix max : ignoré(s).`);
      if (tight) notes.push(`Crédits disponibles ${fmtNum(free)} : les derniers joueurs seront sautés faute de crédits.`);
      this.noteEl.textContent = notes.join(' ');
      this.noteEl.className = `note${tight || pk.noPrice ? ' warn' : ''}`;

      const q = e.queue;
      const treated = q.filter((x) => !isOpen(x)).length;
      const buying = e.mode === 'buy';
      this.barEl.classList.toggle('hidden', !buying);
      if (buying) this.barEl.firstChild.style.width = `${q.length ? (treated / q.length) * 100 : 0}%`;
      this.mainBtn.className = buying ? 'big stop' : 'big go';
      this.mainBtn.textContent = buying ? `Arrêter les achats (${treated}/${q.length})` : `Acheter et revendre (${pk.list.length})`;
      this.mainBtn.disabled = e.mode === 'scan' || (!buying && !pk.list.length);
      this.resumeBtn.style.display = !e.busy && q.some(isOpen) ? '' : 'none';
    }

    // --- Onglet Ventes ---

    buildSalesTab() {
      this.statsEl = h('div', { className: 'stats' });
      this.watchBtn = h('button', { className: 'big', onclick: () => (this.engine.mode === 'watch' ? this.engine.stop('Suivi des ventes arrêté', true) : void this.engine.watch()) });
      this.watchNote = h('div', { className: 'hint' });
      this.salesEl = h('div', { style: 'display:flex;flex-direction:column;gap:3px' });
      return h('section', { className: 'tab' }, this.statsEl, this.watchBtn, this.watchNote, h('h4', { textContent: 'Joueurs achetés encore en vente' }), this.salesEl);
    }

    renderSales(s = this.engine.snapshot()) {
      const e = this.engine;
      const lost = s.total.lost ?? 0;
      const stat = (label, value, cls = '') => h('div', { className: 'stat' }, h('span', { textContent: label }), h('b', { className: cls, textContent: value }));
      this.statsEl.replaceChildren(
        stat('Crédits perdus', lost < 0 ? `+${fmtNum(-lost)}` : fmtNum(lost), lost > 0 ? 'neg' : lost < 0 ? 'pos' : ''),
        stat(`Perte estimée (${s.onSale} en vente)`, fmtNum(s.pendingLoss), s.pendingLoss > 0 ? 'neg' : ''),
        stat('Achetés / revendus', `${fmtNum(s.total.bought)} / ${fmtNum(s.total.sold)}`),
        stat('Taxe EA payée', fmtNum(s.total.tax)),
      );
      const watching = e.mode === 'watch';
      this.watchBtn.textContent = watching ? 'Arrêter le suivi des ventes' : 'Suivre les ventes (réajuste les invendus)';
      this.watchBtn.className = watching ? 'big stop' : 'big';
      this.watchBtn.disabled = e.busy;
      this.watchNote.textContent = `Toutes les ${this.config.watchMinutes} min : encaisse les ventes, remet chaque invendu un palier sous la concurrence (ou au même prix). Démarre seul après les achats.`;
      const items = Object.values(e.bought).filter((b) => typeof b === 'object');
      this.salesEl.replaceChildren(
        ...(items.length
          ? items.map((b) => {
              const loss = b.price - Math.floor((b.sell || b.price) * (1 - EA_TAX));
              return h('div', { className: 'sale' }, h('b', { textContent: b.name || `#${b.defId}` }), h('span', { textContent: fmtNum(b.sell || b.price) }), h('span', { className: 'm', textContent: `acheté ${fmtNum(b.price)} · perte si vendu ${fmtNum(loss)}` }));
            })
          : [h('div', { className: 'empty', textContent: 'Aucun joueur acheté en vente.' })]),
      );
    }

    // --- Onglet Journal ---

    buildLogTab() {
      this.jList = h('div', { className: 'jlist' });
      this.jfilter = 'all';
      const chips = [
        ['all', 'Tout'],
        ['main', 'Essentiel'],
        ['trade', 'Achats / ventes'],
        ['issues', 'Problèmes'],
      ].map(([id, label]) => {
        const b = h('button', { className: `chipbtn${id === 'all' ? ' on' : ''}`, textContent: label });
        b.onclick = () => {
          this.jfilter = id;
          for (const c of chips) c.classList.toggle('on', c === b);
          this.renderEvents(true);
        };
        return b;
      });
      const copy = h('button', { className: 'small', textContent: 'Copier' });
      copy.onclick = async () =>
        flash(copy, await copyText(this.engine.events.map((ev) => `${new Date(ev.t).toLocaleString()} [${ev.type}] ${ev.msg}`).join('\n')));
      const clear = h('button', { className: 'small', textContent: 'Effacer', onclick: () => this.engine.clearEvents() });
      return h('section', { className: 'tab' }, h('div', { className: 'jtools' }, ...chips, h('span', { style: 'flex:1' }), copy, clear), this.jList);
    }

    // --- Onglet Réglages ---

    buildSettingsTab() {
      const groups = SETTING_GROUPS.map((g) => h('div', { className: 'card' }, h('h4', { textContent: g.title }), ...g.items.map((s) => (s.delay ? this.delayRow(s.label, ...s.delay, s.step) : this.numSetting(s)))));
      const unlock = h('button', { textContent: 'Lever le verrou maintenant' });
      unlock.onclick = () => confirm('Lever le verrou ? À faire seulement si aucun captcha n’est affiché.') && this.engine.unlock();
      const reset = h('button', { textContent: 'Remettre les compteurs à zéro' });
      reset.onclick = () => confirm('Remettre à zéro achetés, revendus, crédits perdus et taxe ?') && this.engine.resetTotals();
      const diag = h('button', { textContent: 'Copier diagnostic clubs' });
      diag.onclick = async () => flash(diag, await copyText(JSON.stringify(diagnosticReport(), null, 1)));
      return h('section', { className: 'tab' }, ...groups, h('div', { className: 'card' }, h('h4', { textContent: 'Outils' }), h('div', { className: 'actions' }, unlock, reset, diag)));
    }

    numInput(key, seconds = false, stepS = 0.5) {
      const v = this.config[key];
      const i = h('input', { type: 'number', min: '0', value: String(seconds ? v / 1e3 : v) });
      if (seconds) i.step = String(stepS);
      i.onchange = () => {
        const n = Math.max(0, Number(i.value) || 0);
        this.setConfig({ [key]: seconds ? Math.round(n * 1e3) : Math.floor(n) });
        if (key === 'pricePct' || key === 'coinReserve') this.renderSets();
      };
      return i;
    }
    numSetting(s) {
      return h('div', { className: 'setting' }, h('span', { textContent: s.label }), this.numInput(s.key));
    }
    delayRow(label, a, b, stepS = 0.5) {
      return h('div', { className: 'setting' }, h('span', { textContent: label }), h('span', { className: 'pair' }, this.numInput(a, true, stepS), '–', this.numInput(b, true, stepS)));
    }

    // --- Mise à jour ---

    update(s, line) {
      const locked = s.lockedUntil > Date.now();
      this.pill.className = `pill${s.running ? ' on' : locked ? ' lock' : ''}`;
      this.pill.textContent = s.mode === 'scan' ? 'Scan' : s.mode === 'buy' ? 'Achats' : s.mode === 'watch' ? 'Suivi des ventes' : locked ? 'Verrou' : 'Prêt';
      this.coinsEl.textContent = s.coins == null ? '? crédits' : `${fmtNum(s.coins)} crédits`;
      this.activityEl.textContent = s.running ? s.activity || 'En cours…' : s.lastMessage || '';
      if (locked) {
        const until = new Date(s.lockedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const resume = s.resumeAt ? `, reprise automatique vers ${new Date(s.resumeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
        const btn = h('button', { textContent: 'Lever', onclick: () => confirm('Lever le verrou ? À faire seulement si aucun captcha n’est affiché.') && this.engine.unlock() });
        const what = s.lockKind === 'soft' ? 'Pause limite EA (trop de requêtes)' : s.lockKind === 'snipe' ? 'Verrou posé par SnipeFC27' : 'Pause anti-captcha';
        this.bannerEl.replaceChildren(h('span', { textContent: `${what} jusqu'à ${until}${resume}` }), btn);
        document.title = `⏸ ${s.lockKind === 'soft' ? 'Pause limite' : 'Pause captcha'} · ${this.baseTitle}`;
      } else {
        this.bannerEl.replaceChildren();
        if (this.baseTitle && document.title !== this.baseTitle && document.title.startsWith('⏸')) document.title = this.baseTitle;
      }
      if (s.lastEventId !== this.shownEventId) this.renderEvents();
      this.liveStats(s);
      this.tick();
      const sig = `${s.mode}|${s.version}`;
      if (sig !== this.lastSig) {
        this.lastSig = sig;
        this.renderSets();
        this.scanBtn.textContent = s.mode === 'scan' ? 'Arrêter le scan' : 'Scanner ce club';
        this.scanBtn.className = s.mode === 'scan' ? 'stop grow' : 'blue grow';
        this.scanBtn.disabled = s.mode === 'buy';
      } else this.renderFooter();
      if (this.tab === 'sales') this.renderSales(s);
    }

    draggable(header) {
      header.onpointerdown = (e) => {
        if (e.target.tagName === 'BUTTON') return;
        const r = this.box.getBoundingClientRect();
        const dx = e.clientX - r.left;
        const dy = e.clientY - r.top;
        const move = (ev) => {
          this.box.style.left = `${Math.max(0, ev.clientX - dx)}px`;
          this.box.style.top = `${Math.max(0, ev.clientY - dy)}px`;
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      };
    }
  }

  // ---------- Démarrage ----------

  installNetHooks();

  // Écoute posée dès le chargement : l'import fut.gg peut arriver avant que la Web App soit prête
  const K_IMPORT_AT = `${NS}:importAt`;
  let onCommand = null;
  const pendingCmds = [];
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.ns !== NS || e.data.dir !== 'to-page' || !e.data.cmd) return;
    onCommand ? onCommand(e.data.cmd) : pendingCmds.push(e.data.cmd);
  });

  const postStats = (stats) => window.postMessage({ ns: NS, dir: 'to-ext', stats }, window.location.origin);

  function init() {
    hookUiSearch();
    let panel = null;
    const engine = new Engine(
      () => panel?.config ?? loadConfig(),
      (s, line) => {
        panel?.update(s, line);
        postStats(s);
      },
    );
    panel = new Panel(engine);
    const n = engine.setList().length;
    engine.log(`Web App détectée, prêt${n ? ` (${n} set${n > 1 ? 's' : ''})` : ''}`);
    const at = Number(load(K_RESUME, 0));
    save(K_RESUME, 0);
    const lockIntent = load(K_LOCK_RESUME, null);
    if (lockIntent) engine.scheduleResume();
    else if ((at && Date.now() - at < 9e5) || load(K_ACTIVE, false)) {
      if (engine.queue.some(isOpen)) {
        engine.log('Reprise automatique des achats dans 10 s');
        setTimeout(() => void engine.runQueue(), 1e4);
      } else save(K_ACTIVE, false);
    }
    if (!lockIntent && load(K_WATCH, false) && !load(K_ACTIVE, false)) {
      engine.log('Reprise du suivi des ventes dans 10 s');
      setTimeout(() => void engine.watch(), 1e4);
    }
    onCommand = (cmd) => {
      if (cmd.type === 'stop') engine.stop('Arrêt demandé', true);
      else if (cmd.type === 'toggle-panel') panel.toggle();
      else if (cmd.type === 'import' && Number(cmd.data?.at) > Number(load(K_IMPORT_AT, 0))) {
        save(K_IMPORT_AT, Number(cmd.data.at));
        const key = engine.importSet(cmd.data);
        if (key) {
          panel.open.add(key);
          panel.showTab('sets');
          panel.show();
          engine.emit();
        }
      }
    };
    pendingCmds.splice(0).forEach(onCommand);
  }

  // Reprise attendue (rechargement après 401, achats ou suivi en cours) : clic automatique sur le bouton de connexion
  // de la Web App (session déjà ouverte côté EA ; aucun identifiant n'est saisi)
  const LOGIN_RE = /^\s*(log ?in|se connecter|connexion|ouvrir une session|anmelden|iniciar sesión|accedi)\s*$/i;
  const resumeExpected = () => Number(load(K_RESUME, 0)) > Date.now() - 9e5 || load(K_ACTIVE, false) || load(K_WATCH, false) || !!load(K_LOCK_RESUME, null);
  let loginClicks = 0;
  const bootAt = Date.now();
  const boot = setInterval(() => {
    if (webAppReady()) {
      clearInterval(boot);
      init();
      return;
    }
    if (loginClicks < 3 && Date.now() - bootAt > 4e3 && Date.now() - bootAt < 3e5 && resumeExpected()) {
      const btn = [...document.querySelectorAll('button, a.btn-standard, .btn-standard')].find((b) => LOGIN_RE.test(b.textContent ?? '') && b.offsetParent !== null && !b.disabled);
      if (btn && Date.now() - (boot.lastClick ?? 0) > 15e3) {
        boot.lastClick = Date.now();
        loginClicks++;
        btn.click();
      }
    }
  }, 1e3);
})();
