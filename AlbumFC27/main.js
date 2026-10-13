(function () {
  const NS = 'albumfc27';
  const SNIPE_NS = 'snipefc27';
  const EA_TAX = 0.05;
  const BAD_STATUS = new Set([426, 429, 458, 460, 494, 512, 521]);
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
    maxSearchesPerHour: 300,
    maxSearchesPerDay: 1500,
    maxPurchasesPerDay: 150,
  };

  const step = (p) => (p < 1e3 ? 50 : p < 1e4 ? 100 : p < 5e4 ? 250 : p < 1e5 ? 500 : 1e3);
  const priceDown = (p) => Math.max(150, p - step(p - 1));
  const roundUp = (p) => Math.max(200, Math.ceil(p / step(p)) * step(p));
  const BOUNDS = [400, 700, 1e3, 1500, 2500, 5e3, 1e4, 25e3, 5e4, 1e5, 2e5, 5e5, 1e6, 15e6];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * Math.max(0, b - a);
  const fmtMin = (ms) => {
    const m = Math.ceil(ms / 6e4);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  };
  const fmtNum = (n) => Number(n || 0).toLocaleString('fr-FR');
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
          return { raw, id, name: raw ? staticName(raw) : String(a.itemData?.resourceId ?? id), state: tradeState(String(a.tradeState ?? ''), Number(a.currentBid ?? 0)), soldPrice: Number(a.currentBid ?? 0) };
        }),
      };
    }
    return {
      ...r,
      data: items.map((i) => {
        const a = i._auction ?? i.getAuctionData?.() ?? {};
        const cur = Number(a.currentBid ?? 0);
        return { raw: i, id: Number(i.id), name: staticName(i), state: tradeState(String(a.tradeState ?? ''), cur), soldPrice: cur };
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
    s = { searches: [], purchases: [], lockedUntil: 0, ...load(this.key, {}) };
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
    lock(hours) {
      this.s.lockedUntil = Date.now() + hours * HOUR;
      this.persist();
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
      if (lockMs > 0) return { ok: false, stop: `Verrou anti-captcha actif encore ${fmtMin(lockMs)}` };
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
  const K_SET = `${NS}:set`;
  const K_SCAN = `${NS}:scan`;
  const K_SEL = `${NS}:selection`;
  const K_QUEUE = `${NS}:queue`;
  const K_DONE = `${NS}:done`;
  const K_BOUGHT = `${NS}:bought`;
  const K_ACTIVE = `${NS}:active`;
  const K_RESUME = `${NS}:resume`;
  const K_TOTAL = `${NS}:total`;

  function loadConfig() {
    const raw = load(K_CONFIG, {});
    const cfg = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) cfg[k] = raw[k];
    return cfg;
  }

  const STATUS_LABEL = {
    pending: 'en attente',
    searching: 'recherche…',
    listed: 'acheté, en vente',
    bought: 'acheté, non mis en vente',
    notfound: 'introuvable au prix max',
    nocoins: 'crédits insuffisants',
  };

  class Engine {
    mode = null; // 'scan' | 'buy' | null
    stopRequested = false;
    activityText = '';
    lastMessage = '';
    feedLines = [];
    guard = new Guard();
    set = load(K_SET, null);
    scan = load(K_SCAN, null);
    selection = load(K_SEL, {});
    queue = load(K_QUEUE, []);
    done = new Set(load(K_DONE, []));
    bought = load(K_BOUGHT, {});
    total = { bought: 0, spent: 0, tax: 0, ...load(K_TOTAL, {}) };
    pileCount = 0;
    misses = 0;
    listFails = 0;
    wake = null;
    releaseLock = null;

    constructor(getConfig, onUpdate) {
      this.getConfig = getConfig;
      this.onUpdate = onUpdate;
    }
    get running() {
      return this.mode !== null;
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
        club: this.set?.name ?? null,
        queue: { total: q.length, listed: q.filter((e) => e.status === 'listed' || e.status === 'bought').length, failed: q.filter((e) => e.status === 'notfound' || e.status === 'nocoins').length },
        total: { ...this.total },
      };
    }
    emit(line) {
      this.onUpdate(this.snapshot(), line);
    }
    log(msg) {
      this.lastMessage = msg;
      this.emit(`${new Date().toLocaleTimeString()} ${msg}`);
    }
    feed(msg) {
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      this.feedLines = [`${t} ${msg}`, ...this.feedLines].slice(0, FEED_SIZE);
      this.emit();
    }
    activity(msg) {
      this.activityText = msg;
      this.emit();
    }
    addTotal(field, n) {
      this.total[field] = (this.total[field] ?? 0) + n;
      save(K_TOTAL, this.total);
    }

    // --- Ensemble ---

    setClub(set) {
      if (this.running) return;
      this.set = { kind: 'club', ...set };
      save(K_SET, this.set);
      if (this.scan?.key !== setKey(this.set)) {
        this.scan = null;
        save(K_SCAN, null);
        this.selection = {};
        save(K_SEL, {});
      }
      this.emit();
    }

    players() {
      const list = Object.values(this.scan?.players ?? {});
      for (const p of list) {
        const net = netItems.get(p.defId);
        if (net?.collected || this.done.has(p.defId)) p.collected = true;
      }
      return list.sort((a, b) => (a.minPrice || Infinity) - (b.minPrice || Infinity) || b.rating - a.rating);
    }
    defaultMax(p) {
      return p.minPrice > 0 ? roundUp(p.minPrice * (1 + this.getConfig().pricePct / 100)) : 0;
    }

    // Set envoyé depuis une page Galerie de fut.gg (joueurs, defId, prix fut.gg)
    importSet(data) {
      if (this.running) return this.log('Import fut.gg reçu pendant une tâche en cours : arrête-la puis renvoie le set');
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
      if (!Object.keys(players).length) return this.log('Import fut.gg : aucun joueur lu sur la page');
      this.set = { kind: 'futgg', slug: String(data.slug || data.name || 'set'), name: String(data.name || 'Set fut.gg').slice(0, 60), url: String(data.url || ''), needed: Number(data.needed) || 0 };
      save(K_SET, this.set);
      this.scan = { key: setKey(this.set), at: Date.now(), players, searches: 0, partial: false, source: 'futgg' };
      save(K_SCAN, this.scan);
      this.selection = {};
      save(K_SEL, {});
      const priced = Object.values(players).filter((p) => p.minPrice).length;
      this.log(`Set « ${this.set.name} » importé depuis fut.gg : ${Object.keys(players).length} joueur(s), ${priced} avec prix${this.set.needed ? `, ${this.set.needed} requis` : ''}`);
    }
    setSelected(defId, on, max) {
      if (on) this.selection[defId] = max || this.selection[defId] || this.defaultMax(this.scan.players[defId]);
      else delete this.selection[defId];
      save(K_SEL, this.selection);
    }

    // --- Contrôles communs ---

    stop(msg = 'Arrêt demandé', byUser = false) {
      if (byUser) save(K_ACTIVE, false);
      this.stopRequested = true;
      this.wake?.();
      this.log(msg);
    }
    lockout(msg) {
      save(K_ACTIVE, false);
      this.guard.lock(LOCK_HOURS);
      this.stopRequested = true;
      this.wake?.();
      this.log(`${msg} : arrêt et verrou ${LOCK_HOURS} h. Résoudre un éventuel captcha à la main, ne pas relancer tout de suite.`);
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
    }

    // Erreur EA commune : renvoie true si la tâche doit s'arrêter
    fatal(r, what) {
      if (r.status === 401) return this.sessionExpired(), true;
      if (BAD_STATUS.has(r.status)) return this.lockout(`Statut EA ${r.status} (captcha ou limite)`), true;
      if (r.status === 403 && what === 'search') return this.stop(`Recherche refusée (403)${errText(r.error)}`), true;
      return false;
    }

    // Attend que les quotas le permettent ; false si arrêt
    async waitGuard(cfg) {
      while (!this.stopRequested) {
        const g = this.guard.check(cfg);
        if (g.ok) return true;
        if ('stop' in g) {
          this.log(g.stop);
          return false;
        }
        this.log(g.reason);
        this.activity(`Quota atteint, reprise à ${clock(g.waitMs)}`);
        await this.sleep(g.waitMs);
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
      if ('stop' in g) {
        this.log(g.stop);
        return false;
      }
      this.mode = mode;
      this.stopRequested = false;
      this.misses = 0;
      this.listFails = 0;
      if (navigator.locks && !this.releaseLock) navigator.locks.request(`${NS}-running`, () => new Promise((r) => (this.releaseLock = r)));
      this.emit();
      return true;
    }
    leave() {
      this.mode = null;
      this.activityText = '';
      this.releaseLock?.();
      this.releaseLock = null;
      this.emit();
    }

    // --- 1. Scan du club : joueurs disponibles sur le marché, regroupés par carte ---

    async scanClub() {
      if (this.set?.kind !== 'club' || !this.set.club) return this.log("Choisis d'abord un club");
      if (!(await this.enter('scan'))) return;
      const cfg = this.getConfig();
      const set = this.set;
      const players = {};
      this.scan = { key: setKey(set), at: Date.now(), players, searches: 0, partial: true, source: 'market' };
      const bounds = [...BOUNDS.filter((b) => b < cfg.scanMaxPrice), cfg.scanMaxPrice];
      this.log(`Scan du club « ${set.name} » (${bounds.length} tranches de prix, ${cfg.scanMaxSearches} recherches max)`);
      let searches = 0;
      try {
        outer: for (let s = 0; s < bounds.length; s++) {
          const lo = s === 0 ? 0 : bounds[s - 1];
          const hi = bounds[s];
          for (let page = 1; page <= cfg.scanPagesPerSlice; page++) {
            if (this.stopRequested || searches >= cfg.scanMaxSearches) break outer;
            if (!(await this.waitGuard(cfg))) break outer;
            this.activity(`Scan ${set.name} : ${lo}–${hi}, page ${page} (${searches + 1}/${cfg.scanMaxSearches})`);
            const res = await searchMarket({ club: set.club }, lo, hi, page);
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
            this.scan.searches = searches;
            save(K_SCAN, this.scan);
            this.feed(`${lo}–${hi} p.${page} : ${res.data.length} annonce(s), ${fresh} nouvelle(s) carte(s)`);
            if (res.data.length < PAGE_SIZE) break;
            await this.sleep(rand(cfg.minDelayMs, cfg.maxDelayMs));
          }
          if (s + 1 < bounds.length && searches < cfg.scanMaxSearches) await this.sleep(rand(cfg.minDelayMs, cfg.maxDelayMs));
        }
        this.scan.partial = this.stopRequested || searches >= cfg.scanMaxSearches;
        save(K_SCAN, this.scan);
        const list = this.players();
        const missing = list.filter((p) => !p.collected).length;
        this.log(`Scan terminé : ${list.length} carte(s) du club sur le marché, ${missing} manquante(s) dans la Galerie${this.scan.partial ? ' (scan partiel)' : ''}`);
      } catch (e) {
        this.log(`Erreur scan : ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        this.leave();
      }
    }

    // --- 2. Achat puis remise en vente immédiate au prix d'achat ---

    async validate() {
      if (this.running) return;
      const picks = Object.entries(this.selection)
        .map(([id, max]) => ({ p: this.scan?.players?.[id], max: Number(max) }))
        .filter(({ p, max }) => p && !p.collected && max >= 200);
      if (!picks.length) return this.log('Aucun joueur sélectionné');
      this.queue = picks.map(({ p, max }) => ({ defId: p.defId, name: p.name, rating: p.rating, max, status: 'pending', tries: 0, price: 0 }));
      save(K_QUEUE, this.queue);
      await this.runQueue();
    }

    async runQueue() {
      if (!this.queue.some((e) => e.status === 'pending' || e.status === 'searching')) return this.log('Rien à acheter');
      if (!(await this.enter('buy'))) return;
      save(K_ACTIVE, true);
      const n = this.queue.length;
      const cfg = this.getConfig();
      this.log(`Achat et revente de ${n} joueur(s) pour « ${this.set?.name ?? 'ensemble'} »`);
      try {
        await this.maintain();
        for (const e of this.queue) {
          if (this.stopRequested) break;
          if (e.status === 'searching') e.status = 'pending';
          if (e.status !== 'pending') continue;
          await this.buyOne(e);
          save(K_QUEUE, this.queue);
          this.emit();
          await this.sleep(rand(cfg.minDelayMs, cfg.maxDelayMs));
        }
        if (!this.stopRequested) {
          save(K_ACTIVE, false);
          const ok = this.queue.filter((e) => e.status === 'listed' || e.status === 'bought').length;
          this.log(`Terminé : ${ok}/${n} joueur(s) achetés et remis en vente. Vérifie l'ensemble dans la Galerie.`);
          await this.sleep(rand(1e3, 2e3));
          await this.maintain();
        }
      } catch (err) {
        this.log(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        for (const e of this.queue) if (e.status === 'searching') e.status = 'pending';
        save(K_QUEUE, this.queue);
        this.leave();
      }
    }

    async buyOne(e) {
      const cfg = this.getConfig();
      while (!this.stopRequested && e.tries < cfg.triesPerPlayer) {
        if (this.pileCount >= PILE_MAX) {
          this.activity('Liste de transferts pleine : attente de ventes');
          this.log('Liste de transferts pleine (100) : attente de ventes, nouvel essai dans 2 min');
          await this.sleep(12e4);
          await this.maintain();
          continue;
        }
        const wallet = coins();
        const available = wallet === null ? Infinity : wallet - cfg.coinReserve;
        if (available < 200) {
          e.status = 'nocoins';
          return this.feed(`${e.name} : crédits insuffisants (${fmtNum(wallet)})`);
        }
        if (!(await this.waitGuard(cfg))) return;
        e.status = 'searching';
        e.tries++;
        this.activity(`Recherche ${e.name} (${e.rating}) ≤ ${fmtNum(e.max)}, essai ${e.tries}/${cfg.triesPerPlayer}`);
        // minBuy alterné : contourne le cache EA sans exclure d'annonce (prix mini 200)
        const res = await searchMarket({ defId: [e.defId] }, e.tries % 2 ? 0 : 150, e.max);
        this.guard.record('searches');
        if (!res.success) {
          if (this.fatal(res, 'search')) return;
          this.feed(`${e.name} : recherche en échec (statut ${res.status})`);
        } else {
          const cands = res.data
            .filter((it) => it.defId === e.defId && it.buyNow > 0 && it.buyNow <= e.max && it.buyNow <= available && !(it.expires > 0 && it.expires <= 3))
            .sort((a, b) => a.buyNow - b.buyNow)
            .slice(0, 2);
          if (res.data[0]?.collected) {
            e.status = 'notfound';
            this.done.add(e.defId);
            save(K_DONE, [...this.done]);
            return this.feed(`${e.name} : déjà dans la Galerie, ignoré`);
          }
          for (const it of cands) {
            const r = await this.buyAndList(it, e, cfg);
            if (r === 'stop' || r === 'ok') return;
          }
          if (!cands.length) this.feed(`${e.name} : aucune annonce ≤ ${fmtNum(e.max)}`);
        }
        if (e.tries < cfg.triesPerPlayer) await this.sleep(rand(cfg.minDelayMs, cfg.maxDelayMs));
      }
      if (!this.stopRequested && (e.status === 'searching' || e.status === 'pending')) {
        e.status = 'notfound';
        this.log(`${e.name} introuvable ≤ ${fmtNum(e.max)} après ${e.tries} recherche(s)`);
      }
    }

    async buyAndList(it, e, cfg) {
      await sleep(rand(cfg.buyDelayMinMs, cfg.buyDelayMaxMs));
      if (this.stopRequested) return 'stop';
      this.activity(`Achat de ${it.name} à ${fmtNum(it.buyNow)}…`);
      const r = await bid(it);
      if (!r.success) {
        if (this.fatal(r, 'bid')) return 'stop';
        this.feed(`Raté ${it.name} à ${fmtNum(it.buyNow)} (${r.status === 403 ? 'déjà acheté par un autre' : `statut ${r.status}`})`);
        if (++this.misses >= MAX_MISSES) {
          this.lockout(`${this.misses} achats ratés d'affilée, soft ban probable`);
          return 'stop';
        }
        return 'miss';
      }
      this.misses = 0;
      this.guard.record('purchases');
      e.price = it.buyNow;
      e.status = 'bought';
      this.done.add(e.defId);
      save(K_DONE, [...this.done]);
      if (this.scan?.players?.[e.defId]) {
        this.scan.players[e.defId].collected = true;
        save(K_SCAN, this.scan);
      }
      this.setSelected(e.defId, false);
      this.addTotal('bought', 1);
      this.addTotal('spent', it.buyNow);
      this.log(`Acheté ${it.name} (${it.rating}) à ${fmtNum(it.buyNow)}`);

      const id = Number(it.raw?.id);
      if (id) {
        this.bought[id] = it.buyNow;
        save(K_BOUGHT, this.bought);
      }
      await sleep(rand(800, 1600));
      if (this.stopRequested) return 'ok';
      const l = await moveAndList(it.raw, it.buyNow);
      if (l.success) {
        this.listFails = 0;
        this.pileCount++;
        e.status = 'listed';
        this.feed(`${it.name} remis en vente à ${fmtNum(it.buyNow)}`);
      } else {
        if (this.fatal(l, 'list')) return 'stop';
        this.log(`Mise en vente de ${it.name} échouée (statut ${l.status})${errText(l.error)} : joueur dans les non-assignés`);
        if (++this.listFails >= MAX_LIST_FAILS) {
          this.stop(`${this.listFails} mises en vente échouées d'affilée, arrêt`);
          return 'stop';
        }
      }
      return 'ok';
    }

    // Encaisse les ventes et remet les invendus au même prix
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
          const tax = i.soldPrice - Math.floor(i.soldPrice * (1 - EA_TAX));
          if (this.bought[i.id] !== undefined) {
            this.addTotal('tax', tax);
            delete this.bought[i.id];
          }
          this.feed(`Vendu ${i.name} à ${fmtNum(i.soldPrice)} (taxe ${fmtNum(tax)})`);
        }
        save(K_BOUGHT, this.bought);
        if (sold.length) {
          await sleep(rand(500, 1200));
          const c = await observe(services.Item.clearSoldItems?.());
          if (!c.success) this.log(`Encaissement des ventes échoué (statut ${c.status})${errText(c.error)}`);
        }
        if (expired.length) {
          await sleep(rand(500, 1200));
          const r = await observe(services.Item.relistExpiredAuctions?.());
          this.feed(r.success ? `${expired.length} invendu(s) remis en vente au même prix` : `Remise en vente des invendus échouée (statut ${r.status})`);
        }
        this.pileCount = pile.data.length - sold.length;
        this.feed(`Liste de transferts : ${pile.data.filter((i) => i.state === 'active').length} en vente, ${sold.length} vendu(s), ${expired.length} invendu(s)`);
        await observe(services.User.requestCurrencies?.());
      } catch (e) {
        this.log(`Liste de transferts : ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        this.activity('');
      }
    }

    async maintainOnly() {
      if (!(await this.enter('buy'))) return;
      try {
        await this.maintain();
      } finally {
        this.leave();
      }
    }

    async sleep(ms) {
      if (this.stopRequested) return;
      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(t);
          this.wake = null;
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
.box { position: fixed; top: 70px; left: 16px; z-index: 2147483647; width: 380px; max-height: 88vh;
  display: flex; flex-direction: column; font: 12px/1.4 system-ui, sans-serif; color: #e8e8e8;
  background: #15171c; border: 1px solid #2c303a; border-radius: 10px; box-shadow: 0 8px 24px #0008; overflow: hidden; }
.box.hidden { display: none; }
header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; font-weight: 600; cursor: move; user-select: none; }
.activity { display: flex; align-items: center; gap: 6px; padding: 6px 12px; font-size: 11px; color: #889; cursor: pointer;
  background: #101216; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.activity::before { content: ''; flex: 0 0 8px; height: 8px; border-radius: 50%; background: #555; }
.activity.on { color: #e8e8e8; }
.activity.on::before { background: #51cf66; animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .3; } }
.feed { max-height: 110px; overflow-y: auto; padding: 4px 12px 6px; background: #101216; border-bottom: 1px solid #2c303a;
  font: 11px/1.45 ui-monospace, monospace; color: #99a; }
.feed:empty, .feed.hidden { display: none; }
.feed div:first-child { color: #e8e8e8; }
.body { padding: 10px 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
h4 { margin: 0 0 4px; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #778; }
input, select { background: #0e0f12; color: inherit; border: 1px solid #2c303a; border-radius: 6px; padding: 5px 7px; font: inherit; min-width: 0; }
input:focus, select:focus { outline: none; border-color: #4c6ef5; }
button { border: 0; border-radius: 6px; padding: 6px 10px; font: inherit; font-weight: 600; cursor: pointer; background: #2c303a; color: #e8e8e8; }
button:hover:not(:disabled) { filter: brightness(1.15); }
button:disabled { opacity: .4; cursor: default; }
.x { background: none; color: #889; padding: 0 4px; font-size: 14px; }
.row { display: flex; gap: 6px; align-items: center; }
.row > select, .row > button { flex: 1; width: 0; }
.hint { font-size: 11px; color: #889; }
.hint:empty { display: none; }
.club { font-weight: 600; font-size: 13px; }
button.big { width: 100%; padding: 10px; font-size: 13px; }
.go { background: #2f9e44; color: #fff; } .stop { background: #c92a2a; color: #fff; } .blue { background: #364fc7; color: #fff; }
.tools { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 11px; color: #aab; }
.tools button { padding: 3px 8px; font-size: 11px; font-weight: 500; }
.tools label { display: flex; gap: 4px; align-items: center; }
.list { display: flex; flex-direction: column; gap: 2px; max-height: 300px; overflow-y: auto; }
.p { display: grid; grid-template-columns: auto 1fr auto; align-items: center; column-gap: 8px; padding: 4px 6px; background: #1d2027; border-radius: 6px; }
.p.got { opacity: .45; }
.p .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.p .m { grid-column: 2; font-size: 11px; color: #889; }
.p .st { grid-column: 2; font-size: 11px; color: #74c0fc; }
.p .st.ok { color: #51cf66; } .p .st.ko { color: #ff8787; }
.p input[type=checkbox] { grid-row: 1 / span 3; }
.p input[type=number] { grid-row: 1 / span 3; grid-column: 3; width: 78px; text-align: right; }
.sum { font-size: 11px; color: #cfd2da; }
.empty { color: #778; font-size: 11px; }
.setting { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 3px 0; }
.setting input { width: 72px; text-align: right; }
.pair { display: flex; align-items: center; gap: 4px; color: #778; }
.pair input { width: 52px; }
.stats { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; }
.stats b { text-align: right; }
.log { font: 11px/1.35 ui-monospace, monospace; background: #0e0f12; border-radius: 6px; padding: 6px;
  height: 130px; overflow-y: auto; white-space: pre-wrap; color: #aab; }
details { border-top: 1px solid #2c303a; padding-top: 6px; }
details summary { cursor: pointer; color: #889; font-size: 11px; }
details > * + * { margin-top: 6px; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.actions button { flex: 1; padding: 5px; font-weight: 500; font-size: 11px; }
`;

  const SETTINGS = [
    { key: 'pricePct', label: 'Prix max proposé (% au-dessus du plus bas vu)' },
    { key: 'triesPerPlayer', label: 'Recherches max par joueur' },
    { key: 'coinReserve', label: 'Crédits à garder' },
    { key: 'scanMaxPrice', label: 'Scan : prix max des cartes' },
    { key: 'scanMaxSearches', label: 'Scan : recherches max' },
    { key: 'scanPagesPerSlice', label: 'Scan : pages par tranche de prix' },
    { key: 'maxSearchesPerHour', label: 'Recherches max / heure' },
    { key: 'maxSearchesPerDay', label: 'Recherches max / 24 h' },
    { key: 'maxPurchasesPerDay', label: 'Achats max / 24 h' },
  ];

  function h(tag, props = {}, ...children) {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...children);
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

  class Panel {
    config = loadConfig();
    filter = { tier: 'all', showCollected: false };
    leagues = [];
    clubs = [];

    constructor(engine) {
      this.engine = engine;
      const host = document.createElement('div');
      host.id = `${NS}-host`;
      for (const ev of ['keydown', 'keyup', 'keypress']) host.addEventListener(ev, (e) => e.stopPropagation());
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      this.box = h('div', { className: 'box' });
      shadow.append(h('style', { textContent: CSS }), this.box);
      this.build();
    }
    toggle() {
      this.box.classList.toggle('hidden');
    }
    setConfig(patch) {
      this.config = { ...this.config, ...patch };
      save(K_CONFIG, this.config);
    }

    build() {
      const header = h('header', {}, 'AlbumFC27', h('button', { className: 'x', textContent: '×', onclick: () => this.toggle() }));
      this.draggable(header);
      this.activityEl = h('div', { className: 'activity', title: "Afficher / masquer l'historique" });
      this.feedEl = h('div', { className: 'feed hidden' });
      this.activityEl.onclick = () => this.feedEl.classList.toggle('hidden');

      // 1. Ensemble
      this.leagueSel = h('select');
      this.clubSel = h('select');
      this.leagueSel.onchange = () => this.fillClubs();
      this.clubSel.onchange = () => {
        const c = this.clubs.find((x) => x.id === Number(this.clubSel.value));
        if (c) this.engine.setClub({ club: c.id, name: c.name, league: Number(this.leagueSel.value) || null });
        this.refresh();
      };
      this.pickHint = h('div', { className: 'hint' });
      const capture = h('button', { textContent: 'Club de ma dernière recherche marché' });
      capture.onclick = () => {
        if (!lastUiClub) return void (this.pickHint.textContent = "Fais une recherche dans Transferts > Marché filtrée sur le club voulu, puis reclique.");
        const c = (lastUiClub.league ? loadClubs(lastUiClub.league) : []).find((x) => x.id === lastUiClub.club);
        this.engine.setClub({ club: lastUiClub.club, name: c?.name ?? `Club n° ${lastUiClub.club}`, league: lastUiClub.league });
        this.pickHint.textContent = '';
        this.refresh();
      };
      const reload = h('button', { textContent: '↻', title: 'Recharger les championnats', onclick: () => this.fillLeagues() });
      reload.style.flex = '0 0 auto';
      reload.style.width = 'auto';
      this.clubEl = h('div', { className: 'club' });
      const futgg = h('button', { className: 'blue', textContent: 'Choisir un set sur fut.gg', onclick: () => window.open(FUTGG_GALLERY, '_blank', 'noopener') });

      // 2. Scan
      this.scanBtn = h('button', { className: 'big blue', onclick: () => (this.engine.mode === 'scan' ? this.engine.stop('Scan arrêté', true) : this.engine.scanClub()) });

      // 3. Liste
      const tierSel = h('select');
      for (const [v, t] of [['all', 'Toutes'], ['gold', 'Or'], ['silver', 'Argent'], ['bronze', 'Bronze'], ['special', 'Spéciales'], ['unknown', 'Note inconnue']]) tierSel.append(h('option', { value: v, textContent: t }));
      tierSel.onchange = () => ((this.filter.tier = tierSel.value), this.renderList());
      const showCol = h('input', { type: 'checkbox' });
      showCol.onchange = () => ((this.filter.showCollected = showCol.checked), this.renderList());
      const all = h('button', { textContent: 'Tout cocher', onclick: () => this.checkAll(true) });
      const none = h('button', { textContent: 'Aucun', onclick: () => this.checkAll(false) });
      this.listTools = h('div', { className: 'tools' }, tierSel, all, none, h('label', {}, showCol, 'collectés'));
      this.listEl = h('div', { className: 'list' });
      this.sumEl = h('div', { className: 'sum' });
      this.buyBtn = h('button', { className: 'big go', onclick: () => (this.engine.mode === 'buy' ? this.engine.stop('Arrêt demandé', true) : this.engine.validate()) });
      this.resumeBtn = h('button', { className: 'big', textContent: 'Reprendre les achats en attente', onclick: () => this.engine.runQueue() });

      // Journal / réglages
      this.statsEl = h('div', { className: 'stats' });
      this.logEl = h('div', { className: 'log' });
      const copy = h('button', { textContent: 'Copier le journal' });
      copy.onclick = async () => {
        copy.textContent = (await copyText(this.logEl.textContent ?? '')) ? 'Copié' : 'Échec';
        setTimeout(() => (copy.textContent = 'Copier le journal'), 1500);
      };
      const diag = h('button', { textContent: 'Copier diagnostic clubs' });
      diag.onclick = async () => {
        diag.textContent = (await copyText(JSON.stringify(diagnosticReport(), null, 1))) ? 'Copié' : 'Échec';
        setTimeout(() => (diag.textContent = 'Copier diagnostic clubs'), 1500);
      };
      const pile = h('button', { textContent: 'Encaisser / remettre invendus', onclick: () => this.engine.maintainOnly() });
      const unlock = h('button', { textContent: 'Lever le verrou' });
      unlock.onclick = () => confirm("Lever le verrou anti-captcha ? À ne faire que si EA n'a pas affiché de captcha.") && this.engine.unlock();

      const body = h(
        'div',
        { className: 'body' },
        h(
          'div',
          {},
          h('h4', { textContent: '1. Ensemble à compléter' }),
          h('div', { className: 'row' }, futgg),
          h('div', { className: 'hint', textContent: 'Sur fut.gg, ouvre le set voulu puis clique « Envoyer à AlbumFC27 » : ses joueurs arrivent ici.' }),
          h(
            'details',
            { style: 'margin-top:6px' },
            h('summary', { textContent: 'En secours : un club, joueurs lus sur le marché' }),
            h('div', { className: 'row' }, this.leagueSel, reload),
            h('div', { className: 'row' }, this.clubSel),
            h('div', { className: 'row' }, capture),
            this.pickHint,
            this.scanBtn,
          ),
          h('div', { style: 'margin-top:6px' }, this.clubEl),
        ),
        h('div', {}, h('h4', { textContent: '2. Joueurs manquants' }), this.listTools, h('div', { style: 'margin-top:6px' }, this.listEl), h('div', { style: 'margin-top:6px' }, this.sumEl)),
        this.buyBtn,
        this.resumeBtn,
        this.statsEl,
        h('details', {}, h('summary', { textContent: 'Journal' }), h('div', { className: 'actions' }, copy), this.logEl),
        h(
          'details',
          {},
          h('summary', { textContent: 'Réglages' }),
          this.delayRow('Délai entre recherches (s)', 'minDelayMs', 'maxDelayMs'),
          this.delayRow('Délai avant achat (s)', 'buyDelayMinMs', 'buyDelayMaxMs', 0.1),
          ...SETTINGS.map((s) => this.numSetting(s)),
          h('div', { className: 'actions' }, pile, unlock, diag),
        ),
      );
      this.box.append(header, this.activityEl, this.feedEl, body);
      this.fillLeagues();
      this.refresh();
    }

    fillLeagues() {
      this.leagues = loadLeagues();
      const cur = this.engine.set?.league;
      this.leagueSel.replaceChildren(h('option', { value: '', textContent: this.leagues.length ? 'Championnat…' : 'Championnats indisponibles' }), ...this.leagues.map((l) => h('option', { value: String(l.id), textContent: l.name, selected: l.id === cur })));
      this.leagueSel.disabled = !this.leagues.length;
      this.pickHint.textContent = this.leagues.length ? '' : 'Liste des championnats non trouvée dans la Web App : utilise « Club de ma dernière recherche marché ».';
      this.fillClubs();
    }

    fillClubs() {
      const league = Number(this.leagueSel.value) || 0;
      this.clubs = league ? loadClubs(league) : [];
      const cur = this.engine.set?.club;
      this.clubSel.replaceChildren(h('option', { value: '', textContent: league ? (this.clubs.length ? 'Club…' : 'Clubs indisponibles') : 'Club…' }), ...this.clubs.map((c) => h('option', { value: String(c.id), textContent: c.name, selected: c.id === cur })));
      this.clubSel.disabled = !this.clubs.length;
      if (league && !this.clubs.length) this.pickHint.textContent = 'Clubs de ce championnat non trouvés : utilise « Club de ma dernière recherche marché ».';
    }

    visible() {
      const inQueue = new Set(this.engine.queue.map((q) => q.defId));
      return this.engine.players().filter((p) => (this.filter.showCollected || !p.collected || inQueue.has(p.defId)) && (this.filter.tier === 'all' || tierOf(p) === this.filter.tier));
    }

    checkAll(on) {
      for (const p of this.visible()) if (!p.collected) this.engine.setSelected(p.defId, on);
      this.renderList();
    }

    renderList() {
      const e = this.engine;
      const busy = e.running;
      const statusOf = new Map(e.queue.map((q) => [q.defId, q]));
      if (!e.scan) {
        this.listEl.replaceChildren(h('div', { className: 'empty', textContent: e.set?.kind === 'club' ? 'Lance la recherche des joueurs du club.' : 'Choisis un set sur fut.gg.' }));
        this.listTools.style.display = 'none';
        this.sumEl.textContent = '';
        return;
      }
      this.listTools.style.display = '';
      const list = this.visible();
      const rows = list.map((p) => {
        const sel = e.selection[p.defId];
        const q = statusOf.get(p.defId);
        const cb = h('input', { type: 'checkbox', checked: sel !== undefined && !p.collected, disabled: busy || p.collected });
        const max = h('input', { type: 'number', min: '200', step: String(step(p.minPrice || 200)), value: String(sel ?? (e.defaultMax(p) || '')), placeholder: 'prix max', disabled: busy || p.collected, title: 'Prix max d’achat (= prix de revente)' });
        cb.onchange = () => {
          e.setSelected(p.defId, cb.checked, Math.floor(Number(max.value)) || e.defaultMax(p));
          this.renderSummary();
        };
        max.onchange = () => {
          const v = Math.floor(Number(max.value)) > 0 ? Math.max(200, Math.floor(Number(max.value))) : 0;
          max.value = v ? String(v) : '';
          if (cb.checked) e.setSelected(p.defId, true, v);
          this.renderSummary();
        };
        const st = q ? h('span', { className: `st${q.status === 'listed' ? ' ok' : q.status === 'notfound' || q.status === 'nocoins' ? ' ko' : ''}`, textContent: `${STATUS_LABEL[q.status] ?? q.status}${q.price ? ` à ${fmtNum(q.price)}` : ''}` }) : '';
        return h(
          'div',
          { className: `p${p.collected ? ' got' : ''}` },
          cb,
          h('span', { className: 'n', textContent: `${p.rating ? `${p.rating} ` : ''}${p.name}` }),
          max,
          h('span', {
            className: 'm',
            textContent: [
              tierText(p),
              !p.minPrice ? 'prix inconnu : saisir un prix max' : e.scan.source === 'futgg' ? `fut.gg ${fmtNum(p.minPrice)}` : `dès ${fmtNum(p.minPrice)} · ${p.listings} annonce(s)`,
              p.score ? `${fmtNum(p.score)} pts` : '',
              p.collected && !q ? 'déjà collecté' : '',
            ]
              .filter(Boolean)
              .join(' · '),
          }),
          st,
        );
      });
      const total = e.players();
      const missing = total.filter((p) => !p.collected).length;
      if (!rows.length) rows.push(h('div', { className: 'empty', textContent: missing ? 'Aucun joueur pour ce filtre.' : 'Aucun joueur manquant trouvé sur le marché pour ce club.' }));
      this.listEl.replaceChildren(...rows);
      this.renderSummary(missing, total.length);
    }

    renderSummary(missing, seen) {
      const e = this.engine;
      const all = Object.entries(e.selection).filter(([id]) => e.scan?.players?.[id] && !e.scan.players[id].collected);
      const picks = all.filter(([, m]) => Number(m) >= 200);
      const noPrice = all.length - picks.length;
      const cost = picks.reduce((s, [, m]) => s + Number(m), 0);
      if (missing !== undefined) {
        const where = e.scan?.source === 'futgg' ? 'dans le set' : 'vue(s) sur le marché';
        this.counts = `${missing} manquant(s) sur ${seen} carte(s) ${where}${e.scan?.partial ? ' (scan partiel)' : ''}${e.set?.needed ? `, ${e.set.needed} requis` : ''}`;
      }
      this.sumEl.textContent = `${this.counts ?? ''} · sélection : ${picks.length} joueur(s), ${fmtNum(cost)} crédits max, taxe ~${fmtNum(Math.ceil(cost * EA_TAX))}${noPrice ? ` · ${noPrice} sans prix max (ignoré(s))` : ''}`;
      this.buyBtn.textContent = e.mode === 'buy' ? 'Arrêter' : `3. Valider : acheter puis revendre (${picks.length})`;
      this.buyBtn.className = e.mode === 'buy' ? 'big stop' : 'big go';
      this.buyBtn.disabled = e.mode === 'scan' || (e.mode !== 'buy' && !picks.length);
    }

    refresh() {
      const e = this.engine;
      this.clubEl.textContent = e.set ? `Ensemble : ${e.set.name}${e.set.kind === 'futgg' ? ' (fut.gg)' : ' (marché)'}` : '';
      this.scanBtn.textContent = e.mode === 'scan' ? 'Arrêter le scan' : e.scan ? 'Relancer la recherche des joueurs du club' : 'Chercher les joueurs du club';
      this.scanBtn.className = e.mode === 'scan' ? 'big stop' : 'big blue';
      this.scanBtn.disabled = e.set?.kind !== 'club' || e.mode === 'buy';
      this.leagueSel.disabled = this.clubSel.disabled = e.running;
      if (!e.running) {
        this.leagueSel.disabled = !this.leagues.length;
        this.clubSel.disabled = !this.clubs.length;
      }
      const pending = !e.running && e.queue.some((q) => q.status === 'pending' || q.status === 'searching');
      this.resumeBtn.style.display = pending ? '' : 'none';
      this.renderList();
    }

    numInput(key, seconds = false, stepS = 0.5) {
      const v = this.config[key];
      const i = h('input', { type: 'number', min: '0', value: String(seconds ? v / 1e3 : v) });
      if (seconds) i.step = String(stepS);
      i.onchange = () => {
        const n = Math.max(0, Number(i.value) || 0);
        this.setConfig({ [key]: seconds ? Math.round(n * 1e3) : Math.floor(n) });
      };
      return i;
    }
    numSetting(s) {
      return h('div', { className: 'setting' }, h('span', { textContent: s.label }), this.numInput(s.key));
    }
    delayRow(label, a, b, stepS = 0.5) {
      return h('div', { className: 'setting' }, h('span', { textContent: label }), h('span', { className: 'pair' }, this.numInput(a, true, stepS), '–', this.numInput(b, true, stepS)));
    }

    update(s, line) {
      this.activityEl.classList.toggle('on', s.running);
      this.activityEl.textContent = s.running ? s.activity || 'En cours' : s.lastMessage || "À l'arrêt";
      this.feedEl.replaceChildren(...s.feed.map((f) => h('div', { textContent: f })));
      const rows = [
        ['Joueurs achetés (total)', fmtNum(s.total.bought)],
        ['Taxe EA payée', fmtNum(s.total.tax)],
        ['Crédits', s.coins == null ? '?' : fmtNum(s.coins)],
      ];
      this.statsEl.replaceChildren(...rows.flatMap(([k, v]) => [h('span', { textContent: k }), h('b', { textContent: String(v) })]));
      if (line) this.logEl.textContent = `${line}\n${this.logEl.textContent ?? ''}`.split('\n').slice(0, 1e3).join('\n');
      const sig = `${s.mode}|${setKey(this.engine.set)}|${this.engine.scan?.searches}|${this.engine.scan?.at}|${this.engine.queue.map((q) => q.status).join()}`;
      if (sig !== this.lastSig) {
        this.lastSig = sig;
        this.refresh();
      }
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
    engine.log(`Web App détectée, prêt${engine.set ? ` (ensemble : ${engine.set.name})` : ''}`);
    const at = Number(load(K_RESUME, 0));
    save(K_RESUME, 0);
    if ((at && Date.now() - at < 9e5) || load(K_ACTIVE, false)) {
      if (engine.queue.some((q) => q.status === 'pending' || q.status === 'searching')) {
        engine.log('Reprise automatique des achats dans 10 s');
        setTimeout(() => void engine.runQueue(), 1e4);
      } else save(K_ACTIVE, false);
    }
    onCommand = (cmd) => {
      if (cmd.type === 'stop') engine.stop('Arrêt demandé', true);
      else if (cmd.type === 'toggle-panel') panel.toggle();
      else if (cmd.type === 'import' && Number(cmd.data?.at) > Number(load(K_IMPORT_AT, 0))) {
        save(K_IMPORT_AT, Number(cmd.data.at));
        engine.importSet(cmd.data);
        panel.box.classList.remove('hidden');
      }
    };
    pendingCmds.splice(0).forEach(onCommand);
  }

  const boot = setInterval(() => {
    if (webAppReady()) {
      clearInterval(boot);
      init();
    }
  }, 1e3);
})();
