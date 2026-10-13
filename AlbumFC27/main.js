(function () {
  const NS = 'albumfc27';
  const SNIPE_NS = 'snipefc27';
  const EA_TAX = 0.05;
  const BAD_STATUS = new Set([426, 429, 458, 460, 494, 512, 521]);
  // Limites de débit (trop de requêtes) : pause courte ; les autres statuts demandent une vérification (captcha)
  const SOFT_STATUS = new Set([426, 429, 512, 521]);
  const HOUR = 36e5;
  const DAY = 24 * HOUR;
  const SOFT_PAUSE_MIN = 3;
  const HARD_PAUSE_MIN = 30;
  const SOFT_CAP = 30 * 6e4;
  const HARD_CAP = 2 * HOUR;
  const CALM_MS = 30 * 6e4;
  const LIMITS = { searchesPerHour: 300, searchesPerDay: 1500, purchasesPerDay: 150 };
  const DELAY = [4e3, 8e3];
  const PILE_MAX = 100;
  const PAGE_SIZE = 20;
  const PROBE_PAGES = 3;
  const MAX_SEARCHES = 30;
  const MAX_MISSES = 8;
  const MAX_LIST_FAILS = 3;
  const FEED_SIZE = 30;
  const EVENT_MAX = 400;
  const DEFAULT_RAISE = 30;
  const FUTGG_GALLERY = 'https://www.fut.gg/fut-gallery/';

  const step = (p) => (p < 1e3 ? 50 : p < 1e4 ? 100 : p < 5e4 ? 250 : p < 1e5 ? 500 : 1e3);
  const priceDown = (p) => Math.max(150, p - step(p - 1));
  const roundUp = (p) => Math.max(200, Math.ceil(p / step(p)) * step(p));
  // Hausse progressive : +5 % arrondi au palier EA (au moins un palier), sans dépasser le plafond
  const raisePrice = (p, cap) => Math.min(cap, Math.max(p + step(p), roundUp(p * 1.05)));
  const capFor = (start, pct) => (start > 0 && pct > 0 ? Math.max(start, roundUp(start * (1 + pct / 100))) : start);
  const netOf = (p) => Math.floor(p * (1 - EA_TAX));
  const taxOf = (p) => p - netOf(p);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * Math.max(0, b - a);
  const fmtNum = (n) => Number(n || 0).toLocaleString('fr-FR');
  const fmtMin = (ms) => {
    const m = Math.ceil(ms / 6e4);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  };
  const fmtWait = (ms) => {
    const sec = Math.max(0, Math.ceil(ms / 1e3));
    return sec >= 60 ? `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, '0')} s` : `${sec} s`;
  };
  const hm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const clock = (ms) => hm(Date.now() + ms);
  const errText = (e) => {
    if (e == null || e === '') return '';
    try {
      return ` [${(typeof e === 'string' ? e : JSON.stringify(e)).slice(0, 200)}]`;
    } catch {
      return '';
    }
  };
  const validId = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

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

  // ---------- Interception réseau : isCollected par definitionId ----------

  const PILE_RE = /\/tradepile(\?|$)/i;
  let lastPile = null;
  const netItems = new Map();

  function recordItems(j) {
    const list = [...(Array.isArray(j.itemData) ? j.itemData : []), ...(Array.isArray(j.auctionInfo) ? j.auctionInfo.map((a) => a?.itemData) : [])];
    for (const it of list) {
      const defId = Number(it?.resourceId ?? 0);
      if (!defId || it.itemType !== 'player') continue;
      netItems.set(defId, { collected: it.isCollected === true || !!netItems.get(defId)?.collected });
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

  function staticName(i) {
    const s = i?._staticData ?? i?.getStaticData?.() ?? {};
    return String(s.name || [s.firstName, s.lastName].filter(Boolean).join(' ') || i?.definitionId || '?');
  }

  function mapItem(i) {
    const a = i._auction ?? i.getAuctionData?.() ?? {};
    const defId = Number(i.definitionId ?? 0);
    return { raw: i, tradeId: Number(a.tradeId), buyNow: Number(a.buyNowPrice), expires: Number(a.expires ?? 0), defId, name: staticName(i), collected: netItems.get(defId)?.collected === true };
  }

  async function searchMarket(defId, minBuy, maxBuy) {
    const c = new UTSearchCriteriaDTO();
    c.type = typeof SearchType !== 'undefined' ? SearchType.PLAYER : 'player';
    c.defId = [defId];
    if (minBuy > 0) c.minBuy = minBuy;
    if (maxBuy > 0) c.maxBuy = maxBuy;
    services.Item.clearTransferMarketCache?.();
    const r = await observe(services.Item.searchTransferMarket(c, 1));
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
      return { searches: [], purchases: [], ...load(`${SNIPE_NS}:guard`, {}) };
    }
    lockedUntil() {
      return this.s.lockedUntil;
    }
    lockKind() {
      return this.s.lockedUntil > Date.now() ? (this.s.lockKind ?? 'hard') : null;
    }
    unlock() {
      this.s.lockedUntil = 0;
      this.persist();
    }
    // Captcha : 30 min, doublée à chaque nouveau blocage dans les 24 h, plafond 2 h
    lock() {
      const now = Date.now();
      this.s.lockStreak = now - this.s.lastLockAt < DAY ? this.s.lockStreak + 1 : 0;
      this.s.lastLockAt = now;
      const ms = Math.min(HARD_CAP, HARD_PAUSE_MIN * 6e4 * 2 ** this.s.lockStreak);
      this.s.lockedUntil = now + ms;
      this.s.lockKind = 'hard';
      this.persist();
      return ms;
    }
    // Limite de débit : 3 min, doublée si ça se répète dans les 30 min (plafond 30 min), rythme ×1,5 (plafond ×4)
    lockSoft() {
      const now = Date.now();
      const calm = now - (this.s.lastSoftAt ?? 0) > CALM_MS;
      this.s.softStreak = calm ? 0 : (this.s.softStreak ?? 0) + 1;
      this.s.pace = Math.min(4, (calm ? 1 : (this.s.pace ?? 1)) * 1.5);
      this.s.lastSoftAt = now;
      const ms = Math.min(SOFT_CAP, SOFT_PAUSE_MIN * 6e4 * 2 ** this.s.softStreak);
      this.s.lockedUntil = now + ms;
      this.s.lockKind = 'soft';
      this.persist();
      return ms;
    }
    pace() {
      return Date.now() - (this.s.lastSoftAt ?? 0) > CALM_MS ? 1 : (this.s.pace ?? 1);
    }
    record(kind) {
      this.s[kind].push(Date.now());
      this.persist();
    }
    all(kind) {
      return [...this.s[kind], ...(this.other()[kind] ?? [])].sort((a, b) => a - b);
    }
    check() {
      const lockMs = this.s.lockedUntil - Date.now();
      if (lockMs > 0) return { ok: false, locked: true, stop: `${this.lockKind() === 'soft' ? 'Pause limite EA' : 'Pause anti-captcha'} encore ${fmtMin(lockMs)}` };
      const now = Date.now();
      const searches = this.all('searches').filter((t) => now - t < DAY);
      const purchases = this.all('purchases').filter((t) => now - t < DAY);
      const dayWait = (arr, what, max) => {
        const w = Math.max(6e4, arr[arr.length - max] + DAY - now + 5e3);
        return { ok: false, waitMs: w, reason: `Quota journalier ${what} atteint (max ${max}, partagé avec SnipeFC27), reprise dans ${fmtMin(w)}` };
      };
      if (searches.length >= LIMITS.searchesPerDay) return dayWait(searches, 'de recherches', LIMITS.searchesPerDay);
      if (purchases.length >= LIMITS.purchasesPerDay) return dayWait(purchases, "d'achats", LIMITS.purchasesPerDay);
      const hour = searches.filter((t) => now - t < HOUR);
      if (hour.length >= LIMITS.searchesPerHour) {
        const w = hour[0] + HOUR - now + 5e3;
        return { ok: false, waitMs: w, reason: `Quota horaire de recherches atteint (max ${LIMITS.searchesPerHour}), reprise dans ${fmtMin(w)}` };
      }
      return { ok: true };
    }
  }

  // ---------- Moteur ----------

  const K_CONFIG = `${NS}:config`;
  const K_SETS = `${NS}:sets`;
  const K_SEL = `${NS}:pick`;
  const K_QUEUE = `${NS}:queue2`;
  const K_DONE = `${NS}:done`;
  const K_BOUGHT = `${NS}:bought`;
  const K_PILE = `${NS}:pile`;
  const K_ACTIVE = `${NS}:active`;
  const K_RESUME = `${NS}:resume`;
  const K_TOTAL = `${NS}:total`;
  const K_LOCK_RESUME = `${NS}:lockResume`;
  const K_EVENTS = `${NS}:events`;
  const K_IMPORT_AT = `${NS}:importAt`;

  // Type d'un évènement du journal, déduit du message quand il n'est pas donné
  const EVENT_RULES = [
    [/^Acheté /, 'buy'],
    [/^Vendu /, 'sell'],
    [/remis en vente à|relisté à/, 'list'],
    [/prix relevé/, 'warn'],
    [/^Raté |aucune annonce|non trouvé/i, 'miss'],
    [/captcha|Pause limite|Statut EA|Limite EA/i, 'lock'],
    [/erreur|échou|impossible|refusée/i, 'error'],
    [/quota|insuffisants|pleine|relevé|SnipeFC27 tourne|manque/i, 'warn'],
  ];
  const eventType = (msg) => EVENT_RULES.find(([re]) => re.test(msg))?.[1];

  function loadConfig() {
    const raw = load(K_CONFIG, {});
    const pct = Number(raw.raisePct);
    return { raisePct: Number.isFinite(pct) && pct >= 0 ? pct : DEFAULT_RAISE };
  }

  // Ancien format (nombre = prix d'achat) vers { price, sell, defId, name }
  function loadBought() {
    const out = {};
    for (const [id, b] of Object.entries(load(K_BOUGHT, {}) ?? {})) {
      if (typeof b === 'number' && b > 0) out[id] = { price: b, sell: b, defId: 0, name: `#${id}` };
      else if (b?.price > 0) out[id] = { ...b, sell: b.sell || b.price };
    }
    return out;
  }

  const STATUS_LABEL = {
    pending: 'en attente',
    searching: 'recherche…',
    listed: 'acheté',
    bought: 'acheté, mise en vente échouée',
    skipped: 'déjà dans la Galerie',
    notfound: 'non trouvé',
    nocoins: 'crédits insuffisants',
  };
  const isDone = (q) => q.status === 'listed' || q.status === 'bought' || q.status === 'skipped';
  const isFailed = (q) => q.status === 'notfound' || q.status === 'nocoins';
  const isOpen = (q) => q.status === 'pending' || q.status === 'searching';
  const isUnsold = (b) => b.state === 'expired' || b.state === 'unlisted';
  const EMPTY_TOTAL = { bought: 0, spent: 0, sold: 0, received: 0, tax: 0, lost: 0 };

  class Engine {
    mode = null; // 'buy' | 'relist' | null
    stopRequested = false;
    activityText = '';
    lastMessage = '';
    feedLines = [];
    guard = new Guard();
    sets = load(K_SETS, {}) ?? {};
    selection = load(K_SEL, {}) ?? {}; // defId -> prix de départ (0 = sondage du marché)
    queue = load(K_QUEUE, []) ?? [];
    done = new Set(load(K_DONE, []));
    bought = loadBought();
    total = { ...EMPTY_TOTAL, ...load(K_TOTAL, {}) };
    pile = load(K_PILE, null);
    pileCount = 0;
    misses = 0;
    listFails = 0;
    nonce = 0;
    wake = null;
    releaseLock = null;
    resumeTimer = null;
    resumeAt = 0;
    version = 0;
    events = load(K_EVENTS, []);
    eventSeq = this.events[0]?.id ?? 0;
    waitUntil = 0;
    waitLabel = '';

    constructor(getConfig, onUpdate) {
      this.getConfig = getConfig;
      this.onUpdate = onUpdate;
    }
    get running() {
      return this.mode !== null;
    }

    snapshot() {
      const q = this.queue;
      const onSale = Object.values(this.bought);
      return {
        running: this.running,
        mode: this.mode,
        activity: this.activityText,
        lastMessage: this.lastMessage,
        feed: this.feedLines,
        coins: coins(),
        sets: this.setList().map((s) => s.name),
        queue: { total: q.length, done: q.filter(isDone).length, failed: q.filter(isFailed).length, open: q.filter(isOpen).length },
        total: { ...this.total },
        pendingLoss: this.pendingLoss(),
        onSale: onSale.length,
        unsold: onSale.filter(isUnsold).length,
        lockedUntil: this.guard.lockedUntil(),
        lockKind: this.guard.lockKind(),
        resumeAt: this.resumeAt,
        version: this.version,
        lastEventId: this.eventSeq,
        waitUntil: this.waitUntil,
        waitLabel: this.waitLabel,
      };
    }
    touch() {
      this.version++;
    }
    emit() {
      this.onUpdate(this.snapshot());
    }
    // Journal : { id, t, type, msg, major } ; major = évènement important, sinon étape
    record(msg, type, major) {
      const ev = { id: ++this.eventSeq, t: Date.now(), type: type ?? eventType(msg) ?? (major ? 'info' : 'step'), msg, major };
      this.events = [ev, ...this.events].slice(0, EVENT_MAX);
      clearTimeout(this.saveEventsTimer);
      this.saveEventsTimer = setTimeout(() => save(K_EVENTS, this.events.slice(0, 200)), 1500);
    }
    log(msg, type) {
      this.lastMessage = msg;
      this.record(msg, type, true);
      this.emit();
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
      this.emit();
    }
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
    saveBought() {
      save(K_BOUGHT, this.bought);
    }
    // Perte si les joueurs encore en vente partent au prix affiché
    pendingLoss() {
      return Object.values(this.bought).reduce((s, b) => s + b.price - netOf(b.sell || b.price), 0);
    }
    resetTotals() {
      this.total = { ...EMPTY_TOTAL };
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
    isSelected(defId) {
      return Object.prototype.hasOwnProperty.call(this.selection, defId);
    }
    // price : prix de départ saisi ; absent = valeur existante ou prix fut.gg ; 0 = sondage
    setSelected(defId, on, price) {
      if (on) this.selection[defId] = price !== undefined ? price : (this.selection[defId] ?? this.findPlayer(defId)?.minPrice ?? 0);
      else delete this.selection[defId];
      save(K_SEL, this.selection);
    }
    removeSet(key) {
      const set = this.sets[key];
      if (!set) return;
      delete this.sets[key];
      const still = new Set(Object.values(this.sets).flatMap((s) => Object.keys(s.players ?? {})));
      for (const id of Object.keys(this.selection)) if (!still.has(id)) delete this.selection[id];
      save(K_SEL, this.selection);
      this.saveSets();
      this.log(`Set « ${set.name} » retiré`);
    }

    // Sélection dédoublonnée entre sets, avec projection (revente au prix d'achat : coût = taxe 5 %)
    picks() {
      const pct = this.getConfig().raisePct;
      const list = [];
      const unpriced = [];
      for (const [id, v] of Object.entries(this.selection)) {
        const p = this.findPlayer(id);
        if (!p || this.refreshCollected(p).collected) continue;
        const start = Number(v) >= 200 ? Math.floor(Number(v)) : 0;
        if (!start) {
          unpriced.push(p);
          continue;
        }
        const cap = capFor(start, pct);
        list.push({ p, start, cap });
      }
      const sum = (f) => list.reduce((s, x) => s + f(x), 0);
      return {
        list,
        unpriced,
        count: list.length + unpriced.length,
        spend: sum((x) => x.start),
        capSpend: sum((x) => x.cap),
        tax: sum((x) => taxOf(x.start)),
        capTax: sum((x) => taxOf(x.cap)),
      };
    }

    // Set envoyé depuis une page Galerie de fut.gg (joueurs, defId, prix fut.gg)
    importSet(data) {
      const list = Array.isArray(data?.players) ? data.players : [];
      const players = {};
      for (const x of list) {
        const defId = validId(x?.defId);
        if (!defId || players[defId]) continue;
        players[defId] = {
          defId,
          name: String(x.name || defId).slice(0, 60),
          rating: Number(x.rating) || 0,
          minPrice: Number(x.price) >= 150 ? Math.round(Number(x.price)) : 0,
          collected: netItems.get(defId)?.collected === true || this.done.has(defId),
        };
      }
      if (!Object.keys(players).length) return this.log('Import fut.gg : aucun joueur lu sur la page'), null;
      const slug = String(data.slug || data.name || 'set');
      const set = { kind: 'futgg', slug, key: `futgg:${slug}`, name: String(data.name || 'Set fut.gg').slice(0, 60), url: String(data.url || ''), needed: Number(data.needed) || 0, source: 'futgg', at: Date.now() };
      const again = !!this.sets[set.key];
      this.sets[set.key] = { ...set, players };
      this.saveSets();
      const all = Object.values(players);
      const priced = all.filter((p) => p.minPrice).length;
      this.log(`Set « ${set.name} » ${again ? 'mis à jour' : 'importé'} : ${all.length} joueur(s), ${all.filter((p) => p.collected).length} déjà collecté(s)${priced < all.length ? `, ${all.length - priced} sans prix (sondage)` : ''}`);
      return set.key;
    }

    // --- Contrôles communs ---

    stop(msg = 'Arrêt demandé', byUser = false) {
      if (byUser) {
        save(K_ACTIVE, false);
        this.cancelResume();
      }
      this.stopRequested = true;
      this.wake?.();
      this.log(msg);
    }
    lockout(msg, soft = false) {
      const mode = this.mode;
      this.stopRequested = true;
      this.wake?.();
      const ms = soft ? this.guard.lockSoft() : this.guard.lock();
      if (mode) {
        save(K_LOCK_RESUME, { mode });
        this.scheduleResume();
      }
      if (soft) {
        const pace = this.guard.pace();
        this.log(`${msg} : pause de ${fmtMin(ms)}${pace > 1 ? `, rythme ralenti ×${pace.toFixed(1).replace('.', ',')}` : ''}${mode ? ', reprise automatique' : ''}`, 'lock');
        return;
      }
      this.log(`${msg} : pause de ${fmtMin(ms)}${mode ? ', reprise automatique ensuite' : ''}. Si EA affiche un captcha, le résoudre dans la Web App.`, 'lock');
      this.notify('AlbumFC27 : pause anti-captcha', `${msg}. Reprise vers ${clock(ms)}. Si EA affiche un captcha, résous-le dans la Web App.`);
    }
    scheduleResume() {
      if (!load(K_LOCK_RESUME, null)) return;
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
      this.log('Fin de la pause : reprise automatique');
      if (intent.mode === 'buy' && this.queue.some(isOpen)) await this.runQueue();
      else if (intent.mode === 'relist') await this.relist();
    }
    sessionExpired() {
      const d = rand(6e4, 12e4);
      const mode = this.mode;
      this.stop(`Session expirée (401) : rechargement de la Web App dans ${Math.round(d / 1e3)} s${mode === 'buy' ? ' puis reprise' : ''}`);
      if (mode === 'buy') save(K_RESUME, Date.now() + d);
      setTimeout(() => location.reload(), d);
    }
    unlock() {
      this.guard.unlock();
      this.log('Pause levée manuellement');
      if (load(K_LOCK_RESUME, null)) {
        clearTimeout(this.resumeTimer);
        void this.autoResume();
      }
    }

    // Erreur EA commune : true si la tâche doit s'arrêter
    fatal(r, what) {
      if (r.status === 401) return this.sessionExpired(), true;
      if (SOFT_STATUS.has(r.status)) return this.lockout(`Limite EA ${r.status} (trop de requêtes)`, true), true;
      if (BAD_STATUS.has(r.status)) return this.lockout(`Statut EA ${r.status} (vérification / captcha)`), true;
      if (r.status === 403 && what === 'search') return this.stop(`Recherche refusée (403)${errText(r.error)}`), true;
      return false;
    }

    // Attend que les quotas le permettent ; false si arrêt ou pause
    async waitGuard() {
      while (!this.stopRequested) {
        const g = this.guard.check();
        if (g.ok) return true;
        if (g.locked) {
          const mode = this.mode;
          this.stopRequested = true;
          this.log(`${g.stop} : reprise automatique à la fin`);
          if (mode) {
            save(K_LOCK_RESUME, { mode });
            this.scheduleResume();
          }
          return false;
        }
        this.log(g.reason);
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
      const g = this.guard.check();
      if (g.locked) {
        save(K_LOCK_RESUME, { mode });
        this.scheduleResume();
        this.log(`${g.stop} : démarrage automatique à la fin`);
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
      this.activityText = '';
      this.releaseLock?.();
      this.releaseLock = null;
      this.touch();
      this.emit();
    }
    delay() {
      return rand(...DELAY) * this.guard.pace();
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

    // --- Sondage du marché : annonces les moins chères d'un joueur ---
    // Résultats triés par expiration côté EA : page pleine = il peut exister moins cher, on redescend sous le minimum vu.
    async probe(defId, max) {
      let items = [];
      let lowest = 0;
      let cur = max;
      let searches = 0;
      for (let page = 0; page < PROBE_PAGES; page++) {
        if (page) await this.sleep(this.delay(), 'Sondage : recherche plus basse');
        if (this.stopRequested || !(await this.waitGuard())) return { stop: true, searches };
        // minBuy alterné : contourne le cache EA sans exclure d'annonce (prix mini 200)
        const res = await searchMarket(defId, this.nonce++ % 2 ? 150 : 0, cur);
        searches++;
        this.guard.record('searches');
        if (!res.success) {
          if (this.fatal(res, 'search')) return { stop: true, searches };
          return { items, lowest, searches, error: res.status };
        }
        const mine = res.data.filter((x) => x.defId === defId);
        if (mine.some((x) => x.collected)) return { collected: true, searches };
        const found = mine.filter((x) => x.buyNow > 0 && (!cur || x.buyNow <= cur));
        if (!found.length) break;
        items = found;
        lowest = Math.min(...found.map((x) => x.buyNow));
        if (res.data.length < PAGE_SIZE || lowest <= 200) break;
        cur = priceDown(lowest);
      }
      return { items, lowest, searches };
    }

    // --- Achat au prix le plus bas, hausse progressive, revente au prix d'achat ---

    async validate() {
      if (this.running) return;
      const pk = this.picks();
      if (!pk.count) return this.log('Aucun joueur coché');
      const pct = this.getConfig().raisePct;
      const setOf = (defId) => this.setList().find((s) => s.players?.[defId])?.name ?? '';
      const entry = (p, start) => ({ defId: p.defId, name: p.name, rating: p.rating, set: setOf(p.defId), start, max: start, cap: capFor(start, pct), status: 'pending', searches: 0, price: 0, sell: 0 });
      this.queue = [...pk.list.map((x) => entry(x.p, x.start)), ...pk.unpriced.map((p) => entry(p, 0))];
      save(K_QUEUE, this.queue);
      this.touch();
      await this.runQueue();
    }

    saveQueue() {
      save(K_QUEUE, this.queue);
      this.touch();
      this.emit();
    }

    async runQueue() {
      if (!this.queue.some(isOpen)) return this.log('Rien à acheter');
      if (!(await this.enter('buy'))) return;
      save(K_ACTIVE, true);
      const n = this.queue.length;
      this.log(`Achat de ${n} joueur(s) au prix le plus bas (hausse jusqu'à +${this.getConfig().raisePct} % si introuvable), revente au prix d'achat`);
      try {
        await this.syncPile();
        for (const e of this.queue) {
          if (this.stopRequested) break;
          if (e.status === 'searching') e.status = 'pending';
          if (e.status !== 'pending') continue;
          await this.buyOne(e);
          this.saveQueue();
          if (this.queue.some(isOpen)) await this.sleep(this.delay(), 'Joueur suivant');
        }
        if (!this.stopRequested) {
          save(K_ACTIVE, false);
          const got = this.queue.filter((q) => q.price > 0);
          const spent = got.reduce((s, q) => s + q.price, 0);
          const tax = got.reduce((s, q) => s + taxOf(q.price), 0);
          const fail = this.queue.filter(isFailed).length;
          this.log(`Achats terminés : ${got.length}/${n} achetés et remis en vente, ${fmtNum(spent)} dépensés, coût réel ~${fmtNum(tax)}${fail ? `. ${fail} non trouvé(s), toujours coché(s) : relance possible` : ''}`, 'buy');
          this.notify('AlbumFC27 : achats terminés', `${got.length}/${n} achetés, coût réel ~${fmtNum(tax)} crédits${fail ? `, ${fail} non trouvé(s)` : ''}.`);
        }
      } catch (err) {
        this.log(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        for (const e of this.queue) if (e.status === 'searching') e.status = 'pending';
        save(K_QUEUE, this.queue);
        this.leave();
      }
    }

    giveUp(e, status, why) {
      e.status = status;
      e.note = why;
      this.feed(`${e.name} : ${why}`, 'miss');
    }

    async buyOne(e) {
      let errors = 0;
      while (!this.stopRequested) {
        if (this.pileCount >= PILE_MAX) {
          this.log('Liste de transferts pleine (100) : attente de ventes, nouvel essai dans 2 min');
          await this.sleep(12e4, 'Liste de transferts pleine, nouvel essai');
          if (!this.stopRequested) await this.syncPile();
          continue;
        }
        const wallet = coins();
        const available = wallet === null ? Infinity : wallet;
        if (available < 200) return this.giveUp(e, 'nocoins', `crédits insuffisants (${fmtNum(wallet)})`);
        if (e.searches >= MAX_SEARCHES) return this.giveUp(e, 'notfound', `non trouvé après ${e.searches} recherches`);
        e.status = 'searching';
        this.activity(e.max ? `${e.name} : recherche ≤ ${fmtNum(e.max)}${e.max > e.start ? ` (relevé, plafond ${fmtNum(e.cap)})` : ''}` : `${e.name} : sondage du prix le plus bas`);
        const r = await this.probe(e.defId, e.max);
        e.searches += r.searches;
        if (r.stop) return;
        if (r.collected) {
          e.status = 'skipped';
          this.markCollected(e.defId);
          this.setSelected(e.defId, false);
          return this.feed(`${e.name} : déjà dans la Galerie, ignoré`);
        }
        if (r.error) {
          this.feed(`${e.name} : recherche en échec (statut ${r.error})`, 'error');
          if (++errors >= 3) return this.giveUp(e, 'notfound', 'recherches en échec');
          await this.sleep(this.delay(), `Nouvel essai pour ${e.name}`);
          continue;
        }
        if (!r.items.length) {
          if (!e.max) return this.giveUp(e, 'notfound', 'aucune annonce sur le marché');
          if (e.max >= e.cap) return this.giveUp(e, 'notfound', `aucune annonce ≤ ${fmtNum(e.max)} (plafond atteint)`);
          const prev = e.max;
          e.max = raisePrice(e.max, e.cap);
          this.feed(`${e.name} : aucune annonce ≤ ${fmtNum(prev)}, prix relevé à ${fmtNum(e.max)}${e.max >= e.cap ? ' (plafond)' : ''}`);
          await this.sleep(this.delay(), `Recherche plus haute pour ${e.name}`);
          continue;
        }
        if (!e.start) {
          e.start = e.max = r.lowest;
          e.cap = capFor(r.lowest, this.getConfig().raisePct);
          this.feed(`${e.name} : prix le plus bas trouvé ${fmtNum(r.lowest)}`);
        }
        const cands = r.items
          .filter((x) => x.buyNow <= available && !(x.expires > 0 && x.expires <= 3))
          .sort((a, b) => a.buyNow - b.buyNow)
          .slice(0, 2);
        if (!cands.length) return this.giveUp(e, 'nocoins', `crédits insuffisants pour ${fmtNum(r.lowest)} (${fmtNum(wallet)} disponibles)`);
        for (const it of cands) {
          const res = await this.buyAndList(it, e);
          if (res === 'stop' || res === 'ok') return;
        }
        await this.sleep(this.delay(), `Nouvel essai pour ${e.name}`);
      }
    }

    markCollected(defId) {
      this.done.add(defId);
      save(K_DONE, [...this.done]);
      for (const s of Object.values(this.sets)) if (s.players?.[defId]) s.players[defId].collected = true;
      this.saveSets();
    }

    async buyAndList(it, e) {
      await sleep(rand(300, 900));
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
      const price = it.buyNow;
      e.price = price;
      e.status = 'bought';
      this.markCollected(e.defId);
      this.setSelected(e.defId, false);
      this.addTotal('bought', 1);
      this.addTotal('spent', price);
      this.log(`Acheté ${name} à ${fmtNum(price)}${e.set ? ` (${e.set})` : ''}`);
      const id = Number(it.raw?.id);
      if (id) {
        this.bought[id] = { price, sell: price, defId: e.defId, name, state: 'unlisted', at: Date.now() };
        this.saveBought();
      }
      // Revente immédiate au prix d'achat (prix le plus bas trouvé), même si un arrêt est demandé
      await sleep(rand(800, 1600));
      const l = await moveAndList(it.raw, price);
      if (l.success) {
        this.listFails = 0;
        this.pileCount++;
        e.status = 'listed';
        e.sell = price;
        if (this.bought[id]) {
          this.bought[id].state = 'active';
          this.saveBought();
        }
        this.feed(`${name} remis en vente à ${fmtNum(price)} (prix d'achat, coût ${fmtNum(taxOf(price))})`);
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

    // --- Liste de transferts : encaissement des ventes, état des annonces ---

    async syncPile() {
      this.activity('Lecture de la liste de transferts');
      const pile = await readTransferPile();
      if (!pile.success) {
        if (!this.fatal(pile, 'pile')) this.log(`Lecture de la liste de transferts impossible (statut ${pile.status})${errText(pile.error)}`);
        return null;
      }
      const sold = pile.data.filter((i) => i.state === 'sold');
      for (const i of sold) {
        const net = netOf(i.soldPrice);
        const b = this.bought[i.id];
        let result = '';
        if (b) {
          const loss = b.price - net;
          this.addTotal('tax', i.soldPrice - net);
          this.addTotal('lost', loss);
          this.addTotal('received', net);
          this.addTotal('sold', 1);
          delete this.bought[i.id];
          result = loss >= 0 ? `, perte ${fmtNum(loss)}` : `, gain ${fmtNum(-loss)}`;
        }
        this.feed(`Vendu ${i.name} à ${fmtNum(i.soldPrice)} (net ${fmtNum(net)}${result})`);
      }
      if (sold.length) {
        await sleep(rand(500, 1200));
        const c = await observe(services.Item.clearSoldItems?.());
        if (!c.success) this.log(`Encaissement des ventes échoué (statut ${c.status})${errText(c.error)}`);
      }
      const rest = pile.data.filter((i) => i.state !== 'sold');
      const byId = new Map(rest.map((i) => [String(i.id), i]));
      // Joueurs vendus ou retirés hors extension : plus suivis
      for (const [id, b] of Object.entries(this.bought)) {
        const i = byId.get(id);
        if (!i) delete this.bought[id];
        else {
          b.state = i.state;
          if (i.buyNow > 0) b.sell = i.buyNow;
        }
      }
      this.saveBought();
      this.pileCount = rest.length;
      this.pile = { at: Date.now(), active: rest.filter((i) => i.state === 'active').length, unsold: rest.filter((i) => i.state !== 'active').length, sold: sold.length };
      save(K_PILE, this.pile);
      await observe(services.User.requestCurrencies?.());
      this.touch();
      this.activity('');
      return rest;
    }

    // --- Relister : chaque invendu au prix de l'annonce la moins chère trouvée par sondage ---

    async relist() {
      if (!(await this.enter('relist'))) return;
      try {
        const items = await this.syncPile();
        if (!items) return;
        const unsold = items.filter((i) => i.state !== 'active' && i.raw);
        const todo = unsold.filter((i) => this.bought[i.id]);
        const ignored = unsold.length - todo.length;
        if (!todo.length) return this.log(`Aucun invendu à relister${ignored ? ` (${ignored} invendu(s) non achetés par AlbumFC27, laissés tels quels)` : ''}`);
        this.log(`Relister ${todo.length} invendu(s) au prix le plus bas du marché`);
        let ok = 0;
        let diff = 0;
        for (const [n, i] of todo.entries()) {
          if (this.stopRequested) break;
          if (n) await this.sleep(this.delay(), 'Invendu suivant');
          if (this.stopRequested) break;
          const b = this.bought[i.id];
          const cur = i.buyNow || b.sell || b.price;
          this.activity(`${i.name} : sondage du prix (acheté ${fmtNum(b.price)}, était à ${fmtNum(cur)})`);
          const r = await this.probe(b.defId || i.defId, 0);
          if (r.stop) break;
          if (r.collected) continue;
          const price = r.lowest >= 200 ? r.lowest : cur;
          await sleep(rand(500, 1200));
          const l = await listItem(i.raw, price);
          if (!l.success) {
            if (this.fatal(l, 'list')) break;
            this.feed(`Remise en vente de ${i.name} échouée (statut ${l.status})${errText(l.error)}`, 'error');
            continue;
          }
          ok++;
          diff += price - cur;
          b.sell = price;
          b.state = 'active';
          this.saveBought();
          const loss = b.price - netOf(price);
          this.feed(`${i.name} relisté à ${fmtNum(price)} (${r.lowest ? `annonce la moins chère ${fmtNum(r.lowest)}` : 'aucune autre annonce, prix inchangé'}, ${loss >= 0 ? `perte si vendu ${fmtNum(loss)}` : `gain si vendu ${fmtNum(-loss)}`})`);
        }
        if (this.pile && ok) {
          this.pile = { ...this.pile, active: this.pile.active + ok, unsold: Math.max(0, this.pile.unsold - ok) };
          save(K_PILE, this.pile);
        }
        if (!this.stopRequested) this.log(`Relister terminé : ${ok}/${todo.length} remis en vente${diff ? `, prix ${diff < 0 ? 'baissés' : 'montés'} de ${fmtNum(Math.abs(diff))} au total` : ''}. Perte en attente ${fmtNum(this.pendingLoss())}`, 'list');
      } catch (err) {
        this.log(`Relister : ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.leave();
      }
    }
  }

  // ---------- Panneau ----------

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.box { position: fixed; top: 64px; left: 16px; z-index: 2147483647; width: 420px; max-height: min(820px, 92vh);
  display: flex; flex-direction: column; font: 12px/1.4 system-ui, sans-serif; color: #e6e7eb;
  background: #14161b; border: 1px solid #2a2e38; border-radius: 12px; box-shadow: 0 10px 30px #000a; overflow: hidden; }
.box.hidden { display: none; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px; cursor: move; user-select: none; }
header .title { font-weight: 700; font-size: 13px; }
header .coins { margin-left: auto; font-size: 12px; font-weight: 700; color: #ffe066; background: #1e2129; padding: 2px 9px; border-radius: 10px; font-variant-numeric: tabular-nums; }
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
nav button { background: none; border-radius: 0; padding: 7px 12px; color: #8a8f9c; font-weight: 600; border-bottom: 2px solid transparent; }
nav button.on { color: #e6e7eb; border-bottom-color: #4c6ef5; }
nav button .badge { margin-left: 5px; padding: 0 6px; border-radius: 8px; background: #5c4012; color: #ffd8a8; font-size: 10px; }
.body { flex: 1 1 auto; min-height: 140px; overflow-y: auto; padding: 10px 12px; }
.tab { display: none; flex-direction: column; gap: 10px; } .tab.on { display: flex; }
h4 { margin: 0; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #7c8190; }
input { background: #0d0f13; color: inherit; border: 1px solid #2a2e38; border-radius: 6px; padding: 5px 7px; font: inherit; min-width: 0; }
input:focus { outline: none; border-color: #4c6ef5; }
input[type=number] { font-variant-numeric: tabular-nums; }
button { border: 0; border-radius: 6px; padding: 6px 10px; font: inherit; font-weight: 600; cursor: pointer; background: #262a33; color: #e6e7eb; }
button:hover:not(:disabled) { filter: brightness(1.18); }
button:disabled { opacity: .4; cursor: default; }
.row { display: flex; gap: 6px; align-items: center; }
.grow { flex: 1; width: 0; }
.blue { background: #364fc7; color: #fff; } .go { background: #2f9e44; color: #fff; } .stop { background: #c92a2a; color: #fff; }
.small { padding: 3px 8px; font-size: 11px; font-weight: 500; }
.ghost { background: none; color: #8a8f9c; font-weight: 500; }
.hint { font-size: 11px; color: #8a8f9c; line-height: 1.5; } .hint:empty { display: none; }
.empty { color: #9aa0ad; font-size: 12px; line-height: 1.7; padding: 4px 2px; }
.empty b { color: #e6e7eb; }
.empty ol { margin: 6px 0 0; padding-left: 18px; }
.filters { display: flex; gap: 6px; align-items: center; font-size: 11px; color: #a9aebb; }
.filters label { display: flex; gap: 4px; align-items: center; white-space: nowrap; }
.sets { display: flex; flex-direction: column; gap: 6px; }
.set { border: 1px solid #2a2e38; border-radius: 8px; overflow: hidden; }
.shead { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 4px 8px; padding: 7px 8px; background: #1b1e25; cursor: pointer; user-select: none; }
.shead .nm { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shead .nm::before { content: '▸'; display: inline-block; width: 12px; color: #7c8190; transition: transform .15s; transform-origin: 3px 50%; }
.set.open .shead .nm::before { transform: rotate(90deg); }
.shead .prog { grid-column: 2 / span 2; display: flex; align-items: center; gap: 8px; font-size: 11px; color: #8a8f9c; }
.shead .prog .bar { flex: 0 0 70px; }
.shead input { grid-row: 1 / span 2; }
.sbody { display: none; padding: 4px; flex-direction: column; gap: 2px; }
.set.open .sbody { display: flex; }
.p { display: grid; grid-template-columns: auto 1fr auto; align-items: center; column-gap: 8px; padding: 5px 6px; border-radius: 6px; }
.p:hover { background: #1b1e25; }
.p.got { opacity: .45; }
.p.sel { background: #18233a; }
.p .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.p .n i { font-style: normal; color: #ffd43b; margin-right: 5px; }
.p .m { grid-column: 2; font-size: 11px; color: #8a8f9c; }
.p .m .loss { color: #ffa8a8; }
.p .st { grid-column: 2; font-size: 11px; color: #74c0fc; }
.p .st.ok { color: #51cf66; } .p .st.ko { color: #ff8787; }
.p > input[type=checkbox] { grid-row: 1 / span 3; }
.p > input[type=number] { grid-row: 1 / span 3; grid-column: 3; width: 84px; text-align: right; }
.bar { height: 6px; background: #0d0f13; border-radius: 3px; overflow: hidden; display: flex; }
.bar > span { height: 100%; transition: width .4s; }
.bar .ok { background: #2f9e44; } .bar .use { background: #4c6ef5; } .bar .cap { background: repeating-linear-gradient(45deg, #4c6ef5 0 3px, #2a3570 3px 6px); } .bar .over { background: #e03131; }
footer { border-top: 1px solid #2a2e38; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; background: #171a20; }
footer.hidden { display: none; }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.tile { background: #1e2129; border-radius: 8px; padding: 6px 8px; min-width: 0; }
.tile span { display: block; font-size: 10px; color: #8a8f9c; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
.tile b { display: block; font-size: 15px; font-variant-numeric: tabular-nums; }
.tile small { display: block; font-size: 10px; color: #8a8f9c; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile.neg b { color: #ff8787; } .tile.pos b { color: #51cf66; } .tile.warn b { color: #ffa94d; }
.wallet { display: flex; flex-direction: column; gap: 4px; }
.wallet .bar { height: 10px; border-radius: 5px; }
.legend { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: #a9aebb; font-variant-numeric: tabular-nums; }
.legend i { font-style: normal; display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: 0; }
.note { font-size: 11px; color: #8a8f9c; line-height: 1.5; } .note:empty { display: none; }
.note.warn { color: #ffa94d; }
.raise { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #a9aebb; }
.raise input { width: 52px; text-align: right; }
button.big { width: 100%; padding: 10px; font-size: 13px; }
.hero { background: #1b1e25; border-radius: 10px; padding: 10px 12px; display: flex; align-items: baseline; gap: 10px; }
.hero span { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #8a8f9c; }
.hero b { font-size: 22px; font-variant-numeric: tabular-nums; }
.hero b.neg { color: #ff8787; } .hero b.pos { color: #51cf66; }
.hero small { margin-left: auto; font-size: 11px; color: #8a8f9c; text-align: right; }
.sale { display: grid; grid-template-columns: 1fr auto; gap: 1px 8px; padding: 6px 8px; border-radius: 6px; background: #1b1e25; }
.sale.unsold { box-shadow: inset 3px 0 #fd7e14; }
.sale .m { font-size: 11px; color: #8a8f9c; }
.sale .tag { font-size: 10px; padding: 0 6px; border-radius: 8px; background: #22284a; color: #a5b4fc; align-self: center; }
.sale.unsold .tag { background: #3b2a12; color: #ffd8a8; }
.salelist { display: flex; flex-direction: column; gap: 3px; }
.live { border-top: 1px solid #2a2e38; background: #111318; display: flex; flex-direction: column; }
.live.hidden { display: none; }
.live .lhead { display: flex; align-items: center; gap: 8px; padding: 6px 12px; cursor: pointer; user-select: none; font-size: 11px; color: #a9aebb; }
.live .lhead b { color: #e6e7eb; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
.live .dot { width: 7px; height: 7px; border-radius: 50%; background: #5c6170; }
.live.on .dot { background: #51cf66; animation: pulse 1.2s ease-in-out infinite; }
.live .cd { margin-left: auto; color: #74c0fc; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px; }
.live .lbody { max-height: 110px; overflow-y: auto; padding: 0 8px 6px; }
.live.closed .lbody { display: none; }
.ev { display: grid; grid-template-columns: 52px 14px 1fr; gap: 4px; padding: 2px 4px; border-radius: 4px; font-size: 11px; line-height: 1.45; color: #c9ccd4; animation: fadein .35s ease-out; }
.ev .tm { color: #6c7180; font-variant-numeric: tabular-nums; }
.ev .ic { text-align: center; font-weight: 700; }
.ev.step { color: #7c8190; } .ev.step .ic { color: #5c6170; }
.ev.major { color: #e6e7eb; }
.ev.buy .ic, .ev.buy.major { color: #69db7c; } .ev.sell .ic { color: #ffd43b; } .ev.sell { color: #ffe066; }
.ev.list .ic { color: #74c0fc; } .ev.miss .ic, .ev.error .ic { color: #ff8787; } .ev.error { color: #ffa8a8; }
.ev.lock { color: #ffc078; background: #2b2012; } .ev.lock .ic, .ev.warn .ic { color: #ffa94d; }
@keyframes fadein { from { background: #2a3a5a; } }
.jtools { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.jtools .chipbtn { padding: 3px 8px; font-size: 11px; font-weight: 500; background: #1e2129; }
.jtools .chipbtn.on { background: #364fc7; color: #fff; }
.jlist { background: #0d0f13; border-radius: 6px; padding: 4px; min-height: 200px; max-height: 480px; overflow-y: auto; }
`;

  function h(tag, props = {}, ...children) {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...children.filter((c) => c !== null && c !== undefined && c !== false && c !== ''));
    return n;
  }

  // Barre segmentée : [[classe, valeur], ...] sur une échelle donnée
  function bar(segments, scale) {
    return h('div', { className: 'bar' }, ...segments.filter(([, v]) => v > 0).map(([cls, v]) => h('span', { className: cls, style: `width:${Math.min(100, (v / Math.max(1, scale)) * 100)}%` })));
  }

  function tile(label, value, sub, cls = '') {
    return h('div', { className: `tile ${cls}` }, h('span', { textContent: label }), h('b', { textContent: value }), sub ? h('small', { textContent: sub, title: sub }) : null);
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
    filter = { text: '', showCollected: false };
    open = new Set();
    tab = 'buy';
    lastSig = '';
    jfilter = 'all';
    shownEventId = 0;

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
      this.coinsEl = h('span', { className: 'coins', title: 'Crédits disponibles' });
      const header = h('header', {}, h('span', { className: 'title', textContent: 'AlbumFC27' }), this.pill, this.coinsEl, h('button', { className: 'x', textContent: '×', title: 'Masquer', onclick: () => this.toggle() }));
      this.draggable(header);
      this.activityEl = h('div', { className: 'activity' });
      this.bannerEl = h('div', { className: 'banner' });
      this.tabs = { buy: this.buildBuyTab(), sales: this.buildSalesTab(), log: this.buildLogTab() };
      this.tabBtns = {};
      const nav = h('nav');
      for (const [id, label] of [['buy', 'Achats'], ['sales', 'Ventes'], ['log', 'Journal']]) {
        this.tabBtns[id] = h('button', { textContent: label, onclick: () => this.showTab(id) });
        nav.append(this.tabBtns[id]);
      }
      this.salesBadge = h('span', { className: 'badge' });
      this.footer = this.buildFooter();
      this.live = this.buildLive();
      this.box.append(header, this.bannerEl, this.activityEl, nav, h('div', { className: 'body' }, ...Object.values(this.tabs)), this.live, this.footer);
      this.showTab('buy');
      this.renderEvents(true);
      this.baseTitle = document.title;
      setInterval(() => this.tick(), 1e3);
    }

    showTab(id) {
      this.tab = id;
      for (const [k, el] of Object.entries(this.tabs)) el.classList.toggle('on', k === id);
      for (const [k, b] of Object.entries(this.tabBtns)) b.classList.toggle('on', k === id);
      this.footer.classList.toggle('hidden', id !== 'buy');
      this.live.classList.toggle('hidden', id === 'log');
      if (id === 'sales') this.renderSales();
    }

    // --- Onglet Achats ---

    buildBuyTab() {
      const importBtn = h('button', { className: 'blue', textContent: '+ Importer un set fut.gg', onclick: () => window.open(FUTGG_GALLERY, '_blank', 'noopener') });
      const search = h('input', { type: 'search', placeholder: 'Filtrer par nom', className: 'grow' });
      search.oninput = () => ((this.filter.text = search.value.trim().toLowerCase()), this.renderSets());
      const showCol = h('input', { type: 'checkbox' });
      showCol.onchange = () => ((this.filter.showCollected = showCol.checked), this.renderSets());
      this.filtersEl = h(
        'div',
        { className: 'filters' },
        search,
        h('label', { title: 'Afficher aussi les joueurs déjà dans la Galerie' }, showCol, 'collectés'),
        h('button', { className: 'small', textContent: 'Tout', title: 'Cocher tous les manquants affichés', onclick: () => this.checkVisible(true) }),
        h('button', { className: 'small', textContent: 'Aucun', onclick: () => this.checkVisible(false) }),
      );
      this.setsEl = h('div', { className: 'sets' });
      return h('section', { className: 'tab' }, h('div', { className: 'row' }, importBtn), this.filtersEl, this.setsEl);
    }

    visibleIn(set, inQueue) {
      const t = this.filter.text;
      return this.engine.setPlayers(set).filter((p) => (this.filter.showCollected || !p.collected || inQueue.has(p.defId)) && (!t || p.name.toLowerCase().includes(t)));
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
            h('b', { textContent: 'Aucun set importé.' }),
            h(
              'ol',
              {},
              h('li', { textContent: '« Importer un set fut.gg » : ouvre un set de la Galerie, clique le bouton vert « Envoyer à AlbumFC27 ».' }),
              h('li', { textContent: 'Coche les joueurs manquants (prix de départ = prix fut.gg, modifiable).' }),
              h('li', { textContent: '« Acheter » : chaque joueur est acheté au prix le plus bas puis remis en vente au même prix. Coût réel = taxe EA 5 %.' }),
              h('li', { textContent: 'Onglet Ventes : « Relister » remet les invendus au prix le plus bas du marché.' }),
            ),
          ),
        );
        this.renderFooter();
        return;
      }
      const statusOf = new Map(e.queue.map((q) => [q.defId, q]));
      const inQueue = new Set(statusOf.keys());
      this.setsEl.replaceChildren(...sets.map((s) => this.renderSet(s, statusOf, inQueue)));
      this.renderFooter();
    }

    setCounts(s) {
      const e = this.engine;
      const all = e.setPlayers(s);
      const missing = all.filter((p) => !p.collected);
      const sel = missing.filter((p) => e.isSelected(p.defId));
      const cost = sel.reduce((t, p) => t + (Number(e.selection[p.defId]) || 0), 0);
      return { all, missing, sel, cost };
    }

    setProgress(s, c) {
      const got = c.all.length - c.missing.length;
      const parts = [`${got}/${c.all.length} collectés`, s.needed ? `${s.needed} requis` : '', c.sel.length ? `${c.sel.length} coché(s) ~${fmtNum(c.cost)}` : ''];
      return [bar([['ok', got]], c.all.length), h('span', { textContent: parts.filter(Boolean).join(' · ') })];
    }

    renderSet(s, statusOf, inQueue) {
      const e = this.engine;
      const busy = e.mode === 'buy';
      const c = this.setCounts(s);
      const isOpenSet = this.open.has(s.key) || !!this.filter.text;
      const allBox = h('input', { type: 'checkbox', title: 'Cocher tous les manquants', checked: c.missing.length > 0 && c.sel.length === c.missing.length, disabled: busy || !c.missing.length });
      allBox.indeterminate = c.sel.length > 0 && c.sel.length < c.missing.length;
      allBox.onclick = (ev) => ev.stopPropagation();
      allBox.onchange = () => this.checkVisible(allBox.checked, s);
      const tools = h('span', { className: 'row' });
      if (s.url) tools.append(h('button', { className: 'small', textContent: '↗', title: 'Ouvrir sur fut.gg (renvoyer pour mettre à jour)', onclick: (ev) => (ev.stopPropagation(), window.open(s.url, '_blank', 'noopener')) }));
      tools.append(h('button', { className: 'small', textContent: '×', title: 'Retirer le set', disabled: busy, onclick: (ev) => (ev.stopPropagation(), confirm(`Retirer le set « ${s.name} » ?`) && e.removeSet(s.key)) }));
      const prog = h('div', { className: 'prog' }, ...this.setProgress(s, c));
      const head = h('div', { className: 'shead' }, allBox, h('span', { className: 'nm', textContent: s.name, title: s.name }), tools, prog);
      const wrap = h('div', { className: `set${isOpenSet ? ' open' : ''}` }, head);
      wrap.dataset.key = s.key;
      head.onclick = () => {
        if (this.open.has(s.key)) this.open.delete(s.key);
        else this.open.add(s.key);
        wrap.classList.toggle('open');
        if (wrap.classList.contains('open') && !wrap.querySelector('.sbody')) wrap.append(this.renderRows(this.visibleIn(s, inQueue), statusOf));
      };
      if (isOpenSet) wrap.append(this.renderRows(this.visibleIn(s, inQueue), statusOf));
      return wrap;
    }

    rowMeta(p, start, selected, q) {
      if (p.collected) return q ? [] : ['déjà dans la Galerie'];
      const ref = p.minPrice ? `fut.gg ${fmtNum(p.minPrice)}` : 'pas de prix fut.gg';
      if (!start) return [`${ref} · ${selected ? 'prix trouvé par sondage au lancement' : 'saisir un prix ou laisser vide (sondage)'}`];
      const cap = capFor(start, this.config.raisePct);
      return [`${start !== p.minPrice ? `${ref} · ` : ''}${fmtNum(start)}${cap > start ? ` → max ${fmtNum(cap)}` : ''} · `, h('span', { className: 'loss', textContent: `coût ${fmtNum(taxOf(start))}` })];
    }

    renderRows(visible, statusOf) {
      const e = this.engine;
      const busy = e.mode === 'buy';
      const rows = visible.map((p) => {
        const selected = e.isSelected(p.defId) && !p.collected;
        const q = statusOf.get(p.defId);
        const startOf = () => (selected ? Number(e.selection[p.defId]) || 0 : p.minPrice || 0);
        const cb = h('input', { type: 'checkbox', checked: selected, disabled: busy || p.collected });
        const price = h('input', { type: 'number', min: '200', step: String(step(p.minPrice || 200)), value: startOf() ? String(startOf()) : '', placeholder: 'sondage', disabled: busy || p.collected, title: 'Prix de départ (vide = sondage du marché)' });
        const meta = h('span', { className: 'm' }, ...this.rowMeta(p, startOf(), selected, q));
        const row = h('div', { className: `p${p.collected && !q ? ' got' : ''}${selected ? ' sel' : ''}` });
        const changed = () => {
          meta.replaceChildren(...this.rowMeta(p, cb.checked ? Number(e.selection[p.defId]) || 0 : Number(price.value) || 0, cb.checked, q));
          row.classList.toggle('sel', cb.checked);
          this.renderFooter();
          this.refreshSetHeads();
        };
        cb.onchange = () => {
          e.setSelected(p.defId, cb.checked, Math.floor(Number(price.value)) >= 200 ? Math.floor(Number(price.value)) : 0);
          changed();
        };
        price.onchange = () => {
          const v = Math.floor(Number(price.value)) > 0 ? Math.max(200, Math.floor(Number(price.value))) : 0;
          price.value = v ? String(v) : '';
          cb.checked = true;
          e.setSelected(p.defId, true, v);
          changed();
        };
        row.append(cb, h('span', { className: 'n' }, p.rating ? h('i', { textContent: String(p.rating) }) : null, p.name), price, meta);
        if (q) {
          const parts = [STATUS_LABEL[q.status] ?? q.status];
          if (q.price) parts.push(`à ${fmtNum(q.price)}${q.sell ? ', en vente au même prix' : ''}`);
          else if (isOpen(q) && q.max > q.start) parts.push(`prix relevé à ${fmtNum(q.max)}`);
          if (isFailed(q) && q.note) parts.push(q.note);
          row.append(h('span', { className: `st${isDone(q) ? ' ok' : isFailed(q) ? ' ko' : ''}`, textContent: parts.join(' · ') }));
        }
        return row;
      });
      if (!rows.length) rows.push(h('div', { className: 'empty', textContent: 'Aucun joueur à afficher (tous collectés ou filtrés).' }));
      return h('div', { className: 'sbody' }, ...rows);
    }

    // Met à jour les en-têtes de sets sans reconstruire les lignes (garde le focus)
    refreshSetHeads() {
      const e = this.engine;
      for (const el of this.setsEl.querySelectorAll('.set')) {
        const s = e.sets[el.dataset.key];
        if (!s) continue;
        const c = this.setCounts(s);
        const box = el.querySelector('.shead input[type=checkbox]');
        if (box) {
          box.checked = c.missing.length > 0 && c.sel.length === c.missing.length;
          box.indeterminate = c.sel.length > 0 && c.sel.length < c.missing.length;
        }
        el.querySelector('.shead .prog')?.replaceChildren(...this.setProgress(s, c));
      }
    }

    // --- Pied de l'onglet Achats : projection, crédits, bouton principal ---

    buildFooter() {
      this.recapEl = h('div', { style: 'display:flex;flex-direction:column;gap:8px' });
      this.raiseInput = h('input', { type: 'number', min: '0', max: '300', step: '5', value: String(this.config.raisePct) });
      this.raiseInput.onchange = () => {
        const v = Math.min(300, Math.max(0, Math.floor(Number(this.raiseInput.value) || 0)));
        this.raiseInput.value = String(v);
        this.setConfig({ raisePct: v });
        this.renderSets();
      };
      this.raiseRow = h('label', { className: 'raise', title: 'Si aucune annonce au prix de départ, le prix monte par paliers de 5 % jusqu’à ce plafond' }, 'Si introuvable, monter jusqu’à +', this.raiseInput, '% du prix de départ');
      this.mainBtn = h('button', { className: 'big go' });
      this.mainBtn.onclick = () => (this.engine.mode === 'buy' ? this.engine.stop('Achats arrêtés', true) : void this.engine.validate());
      this.resumeBtn = h('button', { className: 'big', onclick: () => void this.engine.runQueue() });
      return h('footer', {}, this.recapEl, this.raiseRow, this.mainBtn, this.resumeBtn);
    }

    renderFooter() {
      const e = this.engine;
      const buying = e.mode === 'buy';
      this.recapEl.replaceChildren(...(buying ? this.progressView() : this.recapView()));
      const pk = e.picks();
      this.raiseRow.style.display = buying ? 'none' : '';
      this.mainBtn.className = buying ? 'big stop' : 'big go';
      this.mainBtn.textContent = buying ? 'Arrêter les achats' : pk.count ? `Acheter ${pk.count} joueur${pk.count > 1 ? 's' : ''} et revendre au prix d'achat` : 'Coche des joueurs à acheter';
      this.mainBtn.disabled = e.mode === 'relist' || (!buying && !pk.count);
      const open = e.queue.filter(isOpen).length;
      this.resumeBtn.style.display = !e.running && open ? '' : 'none';
      this.resumeBtn.textContent = `Reprendre le lot en cours (${open} restant${open > 1 ? 's' : ''})`;
    }

    recapView() {
      const e = this.engine;
      const pk = e.picks();
      if (!pk.count) {
        const last = e.queue.length ? this.lastRunLine() : '';
        return [h('div', { className: 'note', textContent: last || 'Coche des joueurs pour voir les crédits nécessaires et la perte projetée.' })];
      }
      const wallet = coins();
      const tight = wallet !== null && pk.spend > wallet;
      const out = [
        h(
          'div',
          { className: 'tiles' },
          tile('À dépenser', `${fmtNum(pk.spend)}`, pk.capSpend > pk.spend ? `jusqu'à ${fmtNum(pk.capSpend)} si hausse` : `${pk.list.length} joueur(s)`, tight ? 'warn' : ''),
          tile('Récupéré', `${fmtNum(pk.spend - pk.tax)}`, 'net, à la revente'),
          tile('Coût réel', `${fmtNum(pk.tax)}`, pk.capTax > pk.tax ? `jusqu'à ${fmtNum(pk.capTax)} si hausse` : 'taxe EA 5 %', 'neg'),
        ),
      ];
      if (wallet !== null) {
        const scale = Math.max(wallet, pk.capSpend);
        const use = Math.min(pk.spend, wallet);
        out.push(
          h(
            'div',
            { className: 'wallet' },
            bar([['use', use], ['cap', Math.max(0, Math.min(pk.capSpend, wallet) - use)], ['over', Math.max(0, pk.capSpend - Math.max(wallet, use))]], scale),
            h(
              'div',
              { className: 'legend' },
              h('span', {}, h('i', { style: 'background:#4c6ef5' }), `engagé ${fmtNum(pk.spend)}`),
              h('span', {}, h('i', { style: 'background:#2a3570' }), 'hausse possible'),
              h('span', { textContent: tight ? `manque ${fmtNum(pk.spend - wallet)}` : `reste ${fmtNum(wallet - pk.spend)} / ${fmtNum(wallet)}` }),
            ),
          ),
        );
      }
      const notes = [];
      if (pk.unpriced.length) notes.push(`${pk.unpriced.length} joueur(s) sans prix : prix le plus bas trouvé par sondage au lancement, non compté ci-dessus.`);
      if (tight) notes.push('Crédits insuffisants pour tout acheter : les derniers joueurs seront sautés (ils restent cochés).');
      if (notes.length) out.push(h('div', { className: `note${tight ? ' warn' : ''}`, textContent: notes.join(' ') }));
      return out;
    }

    lastRunLine() {
      const q = this.engine.queue;
      const got = q.filter((x) => x.price > 0);
      const fail = q.filter(isFailed).length;
      return `Dernier lot : ${got.length}/${q.length} achetés, ${fmtNum(got.reduce((s, x) => s + x.price, 0))} dépensés, coût réel ~${fmtNum(got.reduce((s, x) => s + taxOf(x.price), 0))}${fail ? `, ${fail} non trouvé(s) (toujours cochés)` : ''}.`;
    }

    progressView() {
      const q = this.engine.queue;
      const got = q.filter((x) => x.price > 0);
      const fail = q.filter(isFailed).length;
      const open = q.filter(isOpen).length;
      const spent = got.reduce((s, x) => s + x.price, 0);
      const planned = q.reduce((s, x) => s + (x.price || x.start || 0), 0);
      const cur = q.find((x) => x.status === 'searching');
      return [
        h(
          'div',
          { className: 'tiles' },
          tile('Achetés', `${got.length} / ${q.length}`, `${open} restant(s)${fail ? `, ${fail} non trouvé(s)` : ''}`, 'pos'),
          tile('Dépensé', fmtNum(spent), `prévu ~${fmtNum(planned)}`),
          tile('Coût réel', fmtNum(got.reduce((s, x) => s + taxOf(x.price), 0)), 'taxe à la revente', 'neg'),
        ),
        bar([['ok', got.length], ['over', fail]], q.length),
        cur ? h('div', { className: 'note', textContent: `En cours : ${cur.name}${cur.max ? ` ≤ ${fmtNum(cur.max)}${cur.max > cur.start ? ` (relevé, plafond ${fmtNum(cur.cap)})` : ''}` : ' (sondage)'}` }) : null,
      ].filter(Boolean);
    }

    // --- Onglet Ventes ---

    buildSalesTab() {
      this.heroEl = h('div', { className: 'hero' });
      this.statsEl = h('div', { className: 'tiles' });
      this.relistBtn = h('button', { className: 'big go' });
      this.relistBtn.onclick = () => (this.engine.mode === 'relist' ? this.engine.stop('Relister arrêté', true) : void this.engine.relist());
      this.pileEl = h('div', { className: 'hint' });
      this.salesEl = h('div', { className: 'salelist' });
      const reset = h('button', { className: 'small ghost', textContent: 'Remettre les compteurs à zéro' });
      reset.onclick = () => confirm('Remettre à zéro dépensé, vendus, perte réalisée et taxe ?') && this.engine.resetTotals();
      return h(
        'section',
        { className: 'tab' },
        this.heroEl,
        this.statsEl,
        this.relistBtn,
        h('div', { className: 'hint', textContent: "Relister : encaisse les ventes, puis sonde le marché pour chaque invendu acheté par AlbumFC27 et le remet en vente au prix de l'annonce la moins chère trouvée (plus haut ou plus bas qu'avant)." }),
        this.pileEl,
        h('h4', { textContent: 'Joueurs achetés encore en vente' }),
        this.salesEl,
        h('div', { className: 'row' }, h('span', { className: 'grow' }), reset),
      );
    }

    renderSales(s = this.engine.snapshot()) {
      const e = this.engine;
      const t = s.total;
      const real = t.lost + s.pendingLoss;
      this.heroEl.replaceChildren(
        h('span', { textContent: 'Coût réel' }),
        h('b', { className: real > 0 ? 'neg' : real < 0 ? 'pos' : '', textContent: real < 0 ? `+${fmtNum(-real)}` : fmtNum(real) }),
        h('small', { textContent: `réalisé ${t.lost < 0 ? `+${fmtNum(-t.lost)}` : fmtNum(t.lost)} · en attente ${fmtNum(s.pendingLoss)}` }),
      );
      const items = Object.values(e.bought);
      const value = items.reduce((v, b) => v + (b.sell || b.price), 0);
      this.statsEl.replaceChildren(
        tile('En vente', `${items.length}`, `valeur ${fmtNum(value)}${s.unsold ? `, ${s.unsold} invendu(s)` : ''}`, s.unsold ? 'warn' : ''),
        tile('Vendus', `${fmtNum(t.sold)} / ${fmtNum(t.bought)}`, `récupéré ${fmtNum(t.received)}`),
        tile('Dépensé', fmtNum(t.spent), `taxe payée ${fmtNum(t.tax)}`),
      );
      const relisting = e.mode === 'relist';
      this.relistBtn.className = relisting ? 'big stop' : 'big go';
      this.relistBtn.textContent = relisting ? 'Arrêter' : `Relister les invendus${s.unsold ? ` (${s.unsold})` : ''}`;
      this.relistBtn.disabled = e.mode === 'buy';
      const p = e.pile;
      this.pileEl.textContent = p ? `Liste de transferts lue à ${hm(p.at)} : ${p.active} en vente, ${p.unsold} invendu(s), ${p.sold} vente(s) encaissée(s).` : '';
      const sorted = items.sort((a, b) => Number(isUnsold(b)) - Number(isUnsold(a)) || (b.at ?? 0) - (a.at ?? 0));
      this.salesEl.replaceChildren(
        ...(sorted.length
          ? sorted.map((b) => {
              const sell = b.sell || b.price;
              const loss = b.price - netOf(sell);
              return h(
                'div',
                { className: `sale${isUnsold(b) ? ' unsold' : ''}` },
                h('b', { textContent: b.name || `#${b.defId}` }),
                h('span', { className: 'tag', textContent: isUnsold(b) ? 'invendu' : 'en vente' }),
                h('span', { className: 'm', textContent: `acheté ${fmtNum(b.price)} → affiché ${fmtNum(sell)}` }),
                h('span', { className: 'm', textContent: loss >= 0 ? `perte ${fmtNum(loss)}` : `gain ${fmtNum(-loss)}` }),
              );
            })
          : [h('div', { className: 'empty', textContent: 'Aucun joueur acheté en vente.' })]),
      );
    }

    // --- Bandeau « En direct » et journal ---

    buildLive() {
      this.liveDot = h('span', { className: 'dot' });
      this.liveCd = h('span', { className: 'cd' });
      this.liveList = h('div');
      const wrap = h('div', { className: `live${load(`${NS}:liveClosed`, false) ? ' closed' : ''}` });
      const head = h('div', { className: 'lhead', title: 'Afficher / masquer' }, this.liveDot, h('b', { textContent: 'En direct' }), this.liveCd);
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
      this.activityEl.textContent = e.running ? txt : e.lastMessage;
    }

    eventRow(ev) {
      const icons = { buy: '✓', sell: '€', list: '↗', miss: '✗', lock: '⏸', error: '!', warn: '!', info: '•', step: '·' };
      const tm = new Date(ev.t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      return h('div', { className: `ev ${ev.type}${ev.major ? ' major' : ''}` }, h('span', { className: 'tm', textContent: tm }), h('span', { className: 'ic', textContent: icons[ev.type] ?? '•' }), h('span', { textContent: ev.msg }));
    }

    eventMatches(ev) {
      const f = this.jfilter;
      if (f === 'all') return true;
      if (f === 'main') return ev.type !== 'step';
      if (f === 'trade') return ev.type === 'buy' || ev.type === 'sell' || ev.type === 'list';
      return ev.type === 'miss' || ev.type === 'error' || ev.type === 'warn' || ev.type === 'lock';
    }

    renderEvents(full = false) {
      const evs = this.engine.events;
      const newest = evs[0]?.id ?? 0;
      if (full || newest < this.shownEventId) {
        this.liveList.replaceChildren(...evs.slice(0, 6).map((ev) => this.eventRow(ev)));
        this.jList.replaceChildren(...evs.filter((ev) => this.eventMatches(ev)).slice(0, 300).map((ev) => this.eventRow(ev)));
      } else {
        const fresh = evs.filter((ev) => ev.id > this.shownEventId).reverse();
        if (fresh.length) this.jList.querySelector('.empty')?.remove();
        for (const ev of fresh) {
          this.liveList.prepend(this.eventRow(ev));
          if (this.eventMatches(ev)) this.jList.prepend(this.eventRow(ev));
        }
        while (this.liveList.childElementCount > 6) this.liveList.lastChild.remove();
        while (this.jList.childElementCount > 300) this.jList.lastChild.remove();
      }
      if (!evs.length) this.jList.replaceChildren(h('div', { className: 'empty', textContent: 'Journal vide.' }));
      this.shownEventId = newest;
    }

    buildLogTab() {
      this.jList = h('div', { className: 'jlist' });
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
      copy.onclick = async () => {
        const ok = await copyText(this.engine.events.map((ev) => `${new Date(ev.t).toLocaleString()} [${ev.type}] ${ev.msg}`).join('\n'));
        copy.textContent = ok ? 'Copié' : 'Échec';
        setTimeout(() => (copy.textContent = 'Copier'), 1500);
      };
      const clear = h('button', { className: 'small', textContent: 'Effacer', onclick: () => this.engine.clearEvents() });
      return h('section', { className: 'tab' }, h('div', { className: 'jtools' }, ...chips, h('span', { style: 'flex:1' }), copy, clear), this.jList);
    }

    // --- Mise à jour ---

    update(s) {
      const locked = s.lockedUntil > Date.now();
      this.pill.className = `pill${s.running ? ' on' : locked ? ' lock' : ''}`;
      this.pill.textContent = s.mode === 'buy' ? 'Achats' : s.mode === 'relist' ? 'Relister' : locked ? 'Pause' : 'Prêt';
      this.coinsEl.textContent = s.coins == null ? '? crédits' : `${fmtNum(s.coins)} crédits`;
      if (locked) {
        const what = s.lockKind === 'soft' ? 'Pause limite EA (trop de requêtes)' : 'Pause anti-captcha';
        const btn = h('button', { textContent: 'Lever', onclick: () => confirm('Lever la pause ? Seulement si aucun captcha n’est affiché.') && this.engine.unlock() });
        this.bannerEl.replaceChildren(h('span', { textContent: `${what} jusqu'à ${hm(s.lockedUntil)}${s.resumeAt ? `, reprise automatique vers ${hm(s.resumeAt)}` : ''}` }), btn);
        document.title = `⏸ ${s.lockKind === 'soft' ? 'Pause limite' : 'Pause captcha'} · ${this.baseTitle}`;
      } else {
        this.bannerEl.replaceChildren();
        if (this.baseTitle && document.title.startsWith('⏸')) document.title = this.baseTitle;
      }
      this.salesBadge.textContent = String(s.unsold);
      if (s.unsold) this.tabBtns.sales.append(this.salesBadge);
      else this.salesBadge.remove();
      if (s.lastEventId !== this.shownEventId) this.renderEvents();
      this.live.classList.toggle('on', s.running);
      this.tick();
      const sig = `${s.mode}|${s.version}`;
      if (sig !== this.lastSig) {
        this.lastSig = sig;
        this.renderSets();
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
  let onCommand = null;
  const pendingCmds = [];
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.ns !== NS || e.data.dir !== 'to-page' || !e.data.cmd) return;
    onCommand ? onCommand(e.data.cmd) : pendingCmds.push(e.data.cmd);
  });

  const postStats = (stats) => window.postMessage({ ns: NS, dir: 'to-ext', stats }, window.location.origin);

  function init() {
    let panel = null;
    const engine = new Engine(
      () => panel?.config ?? loadConfig(),
      (s) => {
        panel?.update(s);
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
    onCommand = (cmd) => {
      if (cmd.type === 'stop') engine.stop('Arrêt demandé', true);
      else if (cmd.type === 'toggle-panel') panel.toggle();
      else if (cmd.type === 'relist') void engine.relist();
      else if (cmd.type === 'import' && Number(cmd.data?.at) > Number(load(K_IMPORT_AT, 0))) {
        save(K_IMPORT_AT, Number(cmd.data.at));
        const key = engine.importSet(cmd.data);
        if (key) {
          panel.open.add(key);
          panel.showTab('buy');
          panel.show();
          engine.emit();
        }
      }
    };
    pendingCmds.splice(0).forEach(onCommand);
  }

  // Reprise attendue (rechargement après 401, achats en cours) : clic automatique sur le bouton de connexion
  // de la Web App (session déjà ouverte côté EA ; aucun identifiant n'est saisi)
  const LOGIN_RE = /^\s*(log ?in|se connecter|connexion|ouvrir une session|anmelden|iniciar sesión|accedi)\s*$/i;
  const resumeExpected = () => Number(load(K_RESUME, 0)) > Date.now() - 9e5 || load(K_ACTIVE, false) || !!load(K_LOCK_RESUME, null);
  let loginClicks = 0;
  let lastClick = 0;
  const bootAt = Date.now();
  const boot = setInterval(() => {
    if (webAppReady()) {
      clearInterval(boot);
      init();
      return;
    }
    if (loginClicks < 3 && Date.now() - bootAt > 4e3 && Date.now() - bootAt < 3e5 && resumeExpected()) {
      const btn = [...document.querySelectorAll('button, a.btn-standard, .btn-standard')].find((b) => LOGIN_RE.test(b.textContent ?? '') && b.offsetParent !== null && !b.disabled);
      if (btn && Date.now() - lastClick > 15e3) {
        lastClick = Date.now();
        loginClicks++;
        btn.click();
      }
    }
  }, 1e3);
})();
