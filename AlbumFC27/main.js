(function () {
  const NS = 'albumfc27';
  const SNIPE_NS = 'snipefc27';
  const EA_TAX = 0.05;
  const BAD_STATUS = new Set([426, 429, 458, 460, 494, 512, 521]);
  const PILE_MAX = 100;
  const PAGE_SIZE = 20;
  const MAINTAIN_EVERY_MS = 18e4;
  const LOCK_HOURS = 12;
  const MAX_MISSES = 8;
  const MAX_LIST_FAILS = 3;
  const FEED_SIZE = 30;
  const HOUR = 36e5;
  const DAY = 24 * HOUR;

  const DEFAULTS = {
    mode: 'level10',
    galleryScore: 0,
    targetScore: 3e6,
    sets: '[]',
    minDelayMs: 6e3,
    maxDelayMs: 12e3,
    buyDelayMinMs: 300,
    buyDelayMaxMs: 900,
    markupPct: 0,
    maxBuysPerSearch: 3,
    maxCoinsPerPoint: 0,
    maxPagesPerStep: 5,
    dropAfterExpiries: 0,
    coinReserve: 0,
    maxSpend: 0,
    resweepMinutes: 30,
    stopAfterHours: 0,
    skipClubOwned: true,
    autoScanClub: true,
    maxSearchesPerHour: 300,
    maxSearchesPerDay: 1500,
    maxPurchasesPerDay: 150,
    sessionMinutes: 60,
    breakMinutes: 8,
  };

  // Score de base Galerie / SBC simplifiés (valeurs communautaires, hors bonus rareté et tags)
  const GOLD_SCORE = { 75: 90, 76: 100, 77: 120, 78: 140, 79: 160, 80: 180, 81: 280, 82: 340, 83: 410, 84: 830, 85: 2100, 86: 4100, 87: 5500, 88: 8300, 89: 11000, 90: 14000 };
  const itemScore = (r) => (r < 65 ? 20 : r < 75 ? 35 : GOLD_SCORE[Math.min(r, 90)]);

  const step = (p) => (p < 1e3 ? 50 : p < 1e4 ? 100 : p < 5e4 ? 250 : p < 1e5 ? 500 : 1e3);
  const priceDown = (p) => Math.max(150, p - step(p - 1));
  const roundUp = (p) => Math.max(200, Math.ceil(p / step(p)) * step(p));
  const LADDER = [200, 300, 400, 500, 700, 1e3, 1500, 2e3, 3e3, 5e3, 7500, 1e4, 15e3, 2e4, 3e4, 5e4, 75e3, 1e5, 15e4, 2e5, 3e5, 5e5, 1e6, 15e6];
  const ladder = (max, min = 0) => [...LADDER.filter((p) => p > min && p < max), max];
  const sellPriceFor = (buy, markupPct) => (markupPct > 0 ? roundUp(buy * (1 + markupPct / 100)) : Math.max(200, buy));

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

  // ---------- Ensembles ----------

  function parseSets(raw) {
    let list;
    try {
      list = JSON.parse(raw || '[]');
    } catch {
      return { sets: [], error: 'Ensembles illisibles (JSON invalide)' };
    }
    if (!Array.isArray(list)) return { sets: [], error: 'Ensembles illisibles' };
    const sets = [];
    for (const s of list) {
      if (!s || typeof s !== 'object' || typeof s.criteria !== 'object') continue;
      sets.push({
        id: String(s.id ?? Math.random().toString(36).slice(2)),
        label: String(s.label || 'Ensemble'),
        criteria: s.criteria ?? {},
        maxPrice: Math.max(200, Math.floor(Number(s.maxPrice) || 0)),
        minPrice: Math.max(0, Math.floor(Number(s.minPrice) || 0)),
        minRating: Math.floor(Number(s.minRating) || 0),
        maxRating: Math.floor(Number(s.maxRating) || 99),
        enabled: s.enabled !== false,
      });
    }
    return { sets, error: null };
  }

  // Mode niveau 10 : uniquement les cartes or 84+ au meilleur rapport points / crédits
  const LEVEL10_SET = { id: 'level10', label: 'Niveau 10 · Or 84+', criteria: { level: 'gold' }, minPrice: 650, maxPrice: 15000, minRating: 84, maxRating: 99, enabled: true };
  const LEVEL10_RATIO = 1.4;

  const describeCriteria = (c) =>
    Object.entries(c)
      .map(([k, v]) => `${k.replace(/^_/, '')}=${Array.isArray(v) ? v.join('|') : v}`)
      .join(' · ') || 'tous les joueurs';

  // ---------- Interception réseau ----------

  const NET_RE = /\/ut\/game\/|transfermarket|\/trade\//i;
  const PILE_RE = /\/tradepile(\?|$)/i;
  const GALLERY_RE = /galler|collection|album/i;
  let lastPile = null;
  let diagSink = null;
  const galleryCaptures = [];

  // Données Galerie lues dans les réponses EA brutes : isCollected et gradingScore par definitionId
  const netItems = new Map();
  const clubCollected = new Set();
  function recordItems(url, j) {
    const list = [...(Array.isArray(j.itemData) ? j.itemData : []), ...(Array.isArray(j.auctionInfo) ? j.auctionInfo.map((a) => a?.itemData) : [])];
    const club = /\/club(\?|$)/i.test(url);
    for (const it of list) {
      const defId = Number(it?.resourceId ?? 0);
      if (!defId || it.itemType !== 'player') continue;
      const collected = it.isCollected === true;
      const prev = netItems.get(defId);
      netItems.set(defId, { collected: collected || !!prev?.collected, score: Number(it.gradingScore) || prev?.score || 0 });
      if (club && collected) clubCollected.add(defId);
    }
  }

  function onResponse(url, status, text) {
    if (status !== 200) return;
    if (/\/ut\/game\//i.test(url) && /"itemData"/.test(text)) {
      try {
        recordItems(url, JSON.parse(text));
      } catch {}
    }
    if (PILE_RE.test(url)) {
      try {
        const j = JSON.parse(text);
        if (Array.isArray(j.auctionInfo)) lastPile = { at: Date.now(), auctions: j.auctionInfo, credits: typeof j.credits === 'number' ? j.credits : null };
      } catch {}
    } else if (/\/ut\//i.test(url) && (GALLERY_RE.test(url) || /galler|collected/i.test(text))) {
      galleryCaptures.unshift({ at: new Date().toISOString(), url, body: text.slice(0, 2e5) });
      galleryCaptures.length = Math.min(galleryCaptures.length, 10);
      diagSink?.(`[GALERIE] réponse captée ${shortUrl(url)} (${text.length} octets)`);
    }
  }

  function shortUrl(u) {
    try {
      const x = new URL(u, location.href);
      return x.host + x.pathname + x.search;
    } catch {
      return u;
    }
  }

  function installNetHooks() {
    const X = XMLHttpRequest.prototype;
    const open = X.open;
    const send = X.send;
    const meta = new WeakMap();
    X.open = function (method, url, ...rest) {
      meta.set(this, { method, url: String(url), t0: 0 });
      this.addEventListener('readystatechange', () => {
        if (this.readyState === 4 && (this.responseType === '' || this.responseType === 'text')) onResponse(String(url), this.status, this.responseText);
      });
      return open.call(this, method, url, ...rest);
    };
    X.send = function (body) {
      const m = meta.get(this);
      if (m && NET_RE.test(m.url) && diagSink) {
        m.t0 = Date.now();
        this.addEventListener('loadend', () => diagSink?.(`[NET] ${m.method} ${shortUrl(m.url)} → ${this.status} (${Date.now() - m.t0} ms)`));
      }
      return send.call(this, body);
    };
    const f = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const res = await f.call(this, input, init);
      if (PILE_RE.test(url) || /\/ut\//i.test(url)) res.clone().text().then((t) => onResponse(url, res.status, t)).catch(() => {});
      if (NET_RE.test(url)) diagSink?.(`[NET] fetch ${shortUrl(url)} → ${res.status}`);
      return res;
    };
  }

  // ---------- API Web App ----------

  let botSearching = false;
  let lastUiCriteria = null;

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

  const SKIP_KEYS = /^_?(minBuy|maxBuy|minBid|maxBid|offset|count|sortBy|sort)$/i;
  function criteriaDiff(c) {
    const base = new UTSearchCriteriaDTO();
    const out = {};
    for (const k of Object.keys(c)) {
      const v = c[k];
      if (SKIP_KEYS.test(k)) continue;
      const prim = (x) => x === null || ['string', 'number', 'boolean'].includes(typeof x);
      if (!(prim(v) || (Array.isArray(v) && v.every(prim)))) continue;
      if (JSON.stringify(v) !== JSON.stringify(base[k])) out[k] = Array.isArray(v) ? [...v] : v;
    }
    return out;
  }

  function hookUiSearch() {
    const svc = services.Item;
    const orig = svc.searchTransferMarket;
    if (typeof orig !== 'function' || orig.__album) return;
    const wrapped = function (criteria, page) {
      if (!botSearching) {
        try {
          lastUiCriteria = criteriaDiff(criteria);
        } catch {}
      }
      return orig.apply(this, arguments);
    };
    wrapped.__album = true;
    svc.searchTransferMarket = wrapped;
  }

  function mapItem(i) {
    const a = i._auction ?? i.getAuctionData?.() ?? {};
    return {
      raw: i,
      tradeId: Number(a.tradeId),
      buyNow: Number(a.buyNowPrice),
      expires: Number(a.expires ?? 0),
      defId: Number(i.definitionId ?? 0),
      rating: Number(i.rating ?? 0),
      name: String(i._staticData?.name ?? i.getStaticData?.()?.name ?? i.definitionId),
      collected: netItems.get(Number(i.definitionId ?? 0))?.collected === true || collectedFlag(i) === true,
      score: netItems.get(Number(i.definitionId ?? 0))?.score || Number(i.gradingScore) || itemScore(Number(i.rating ?? 0)),
      duplicate: (() => {
        try {
          return i.isDuplicate?.() === true;
        } catch {
          return false;
        }
      })(),
    };
  }

  async function searchMarket(set, minBuy, maxBuy, page) {
    const c = new UTSearchCriteriaDTO();
    Object.assign(c, set.criteria);
    if (!('type' in set.criteria) && !('_type' in set.criteria)) c.type = typeof SearchType !== 'undefined' ? SearchType.PLAYER : 'player';
    if (minBuy > 0) c.minBuy = minBuy;
    c.maxBuy = maxBuy;
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
    const nameOf = (i, d) => String(i?._staticData?.name ?? i?.getStaticData?.()?.name ?? d);
    let pile = lastPile;
    for (let n = 0; n < 10 && !(pile && pile.at >= t0); n++) {
      await sleep(50);
      pile = lastPile;
    }
    if (pile && pile.at >= t0) {
      return {
        success: true,
        status: 200,
        source: 'serveur',
        data: pile.auctions.map((a) => {
          const id = Number(a.itemData?.id);
          const raw = byId.get(id);
          const defId = Number(raw?.definitionId ?? a.itemData?.resourceId ?? a.itemData?.assetId ?? 0);
          return { raw, id, defId, name: nameOf(raw, defId), state: tradeState(String(a.tradeState ?? ''), Number(a.currentBid ?? 0)), soldPrice: Number(a.currentBid ?? 0), buyNow: Number(a.buyNowPrice ?? 0) };
        }),
      };
    }
    return {
      ...r,
      source: 'web app',
      data: items.map((i) => {
        const a = i._auction ?? i.getAuctionData?.() ?? {};
        const cur = Number(a.currentBid ?? 0);
        return { raw: i, id: Number(i.id), defId: Number(i.definitionId), name: nameOf(i, i.definitionId), state: tradeState(String(a.tradeState ?? ''), cur), soldPrice: cur, buyNow: Number(a.buyNowPrice ?? 0) };
      }),
    };
  }

  let clubScanShape = null;
  async function scanClubDefIds(onProgress) {
    if (typeof services.Club?.search !== 'function') throw Error('recherche club indisponible dans cette version de la Web App');
    const ids = new Set();
    const PAGE = 90;
    for (let offset = 0, n = 0; n < 80; offset += PAGE, n++) {
      const c = new UTSearchCriteriaDTO();
      c.type = typeof SearchType !== 'undefined' ? SearchType.PLAYER : 'player';
      c.offset = offset;
      c.count = PAGE;
      const r = await observe(services.Club.search(c));
      if (!r.success) {
        if (!ids.size) throw Error(`statut ${r.status}`);
        break;
      }
      const d = r.data;
      const items = Array.isArray(d) ? d : (d?.items ?? d?.itemData ?? Object.values(d ?? {}).find(Array.isArray) ?? []);
      if (offset === 0) clubScanShape = { status: r.status, dataKeys: Object.keys(d ?? {}), count: items.length, firstItemKeys: Object.keys(items[0] ?? {}).slice(0, 60) };
      const before = ids.size;
      for (const i of items) {
        const id = Number(i?.definitionId ?? i?.resourceId ?? i?.getDefinitionId?.() ?? 0);
        if (id) ids.add(id);
      }
      onProgress?.(ids.size);
      if (!items.length || ids.size === before) break;
      await sleep(rand(800, 1600));
    }
    for (const id of clubCollected) ids.add(id);
    if (!ids.size) throw Error(`aucun joueur lu (statut ${clubScanShape?.status}, clés réponse : ${clubScanShape?.dataKeys.join(', ') || 'aucune'}, ${clubScanShape?.count ?? 0} élément(s))`);
    return ids;
  }

  // ---------- Détection Galerie ----------

  const GAL_API_RE = /galler|album/i;
  const COLLECTED_KEY_RE = /^_?(is)?(gallery)?collected$|^_?(is)?ingallery$/i;
  const galleryReport = { probedAt: null, apis: [], calls: [], itemFlag: null, itemKeys: [], itemMethods: [] };
  let flagKey;

  function methodNames(o) {
    const names = new Set();
    for (let p = o; p && p !== Object.prototype && p !== Function.prototype; p = Object.getPrototypeOf(p)) {
      for (const k of Object.getOwnPropertyNames(p)) if (k !== 'constructor' && typeof Object.getOwnPropertyDescriptor(p, k)?.value === 'function') names.add(k);
    }
    return [...names];
  }

  function safeJson(v, depth = 6, seen = new WeakSet()) {
    if (typeof v === 'function') return undefined;
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v) || depth <= 0) return '[…]';
    seen.add(v);
    if (v instanceof Map) v = Object.fromEntries(v);
    else if (v instanceof Set) v = [...v];
    if (Array.isArray(v)) return [...v.slice(0, 40).map((x) => safeJson(x, depth - 1, seen)), ...(v.length > 40 ? [`… ${v.length - 40} de plus`] : [])];
    const out = {};
    for (const k of Object.keys(v).slice(0, 80)) {
      const r = safeJson(v[k], depth - 1, seen);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }

  const withTimeout = (p) => Promise.race([p, sleep(1e4).then(() => ({ timeout: true }))]);

  // Cherche les services Galerie de la Web App et appelle leurs méthodes de lecture sans argument
  async function probeGallery() {
    const apis = [];
    for (const rootName of ['services', 'repositories', 'factories']) {
      let root;
      try {
        root = window[rootName];
      } catch {}
      if (!root || typeof root !== 'object') continue;
      for (const k of Object.keys(root)) if (GAL_API_RE.test(k)) apis.push({ path: `${rootName}.${k}`, obj: root[k] });
    }
    for (const k of Object.getOwnPropertyNames(window)) {
      if (!GAL_API_RE.test(k)) continue;
      try {
        apis.push({ path: k, obj: window[k] });
      } catch {}
    }
    galleryReport.apis = apis.map((a) => ({ path: a.path, type: typeof a.obj, methods: methodNames(typeof a.obj === 'function' ? a.obj.prototype : a.obj) }));
    galleryReport.calls = [];
    for (const a of apis) {
      if (!/^(services|repositories)\./.test(a.path) || !a.obj) continue;
      for (const m of methodNames(a.obj).filter((n) => /^(request|get|fetch|load)/i.test(n)).slice(0, 12)) {
        const fn = a.obj[m];
        if (typeof fn !== 'function' || fn.length > 0) continue;
        try {
          let r = fn.call(a.obj);
          if (typeof r?.observe === 'function') r = await withTimeout(observe(r));
          else if (typeof r?.then === 'function') r = await withTimeout(r);
          galleryReport.calls.push({ call: `${a.path}.${m}()`, result: safeJson(r) });
        } catch (e) {
          galleryReport.calls.push({ call: `${a.path}.${m}()`, error: String(e?.message ?? e) });
        }
        await sleep(rand(300, 700));
      }
    }
    galleryReport.probedAt = new Date().toISOString();
    return galleryReport;
  }

  // Marqueur « déjà dans la Galerie » porté par les cartes, s'il existe : true / false / null (inconnu)
  function collectedFlag(item) {
    if (flagKey === undefined) {
      const methods = methodNames(item);
      galleryReport.itemKeys = Object.keys(item).slice(0, 120);
      galleryReport.itemMethods = methods.slice(0, 250);
      flagKey = [...Object.keys(item), ...methods].find((k) => COLLECTED_KEY_RE.test(k)) ?? null;
      galleryReport.itemFlag = flagKey;
    }
    if (!flagKey) return null;
    try {
      const v = typeof item[flagKey] === 'function' ? item[flagKey]() : item[flagKey];
      return typeof v === 'boolean' ? v : null;
    } catch {
      return null;
    }
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
    recordSearch() {
      this.s.searches.push(Date.now());
      this.persist();
    }
    recordPurchase() {
      this.s.purchases.push(Date.now());
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
      const split = (kind) => {
        const own = this.s[kind].filter((t) => now - t < DAY).length;
        const snipe = (this.other()[kind] ?? []).filter((t) => now - t < DAY).length;
        return `AlbumFC27 ${own} + SnipeFC27 ${snipe}`;
      };
      const dayWait = (arr, what, kind, max) => {
        const w = Math.max(6e4, arr[arr.length - max] + DAY - now + 5e3);
        return { ok: false, waitMs: w, reason: `Quota journalier ${what} atteint (${split(kind)} sur 24 h, max ${max}), reprise dans ${fmtMin(w)}` };
      };
      if (searches.length >= cfg.maxSearchesPerDay) return dayWait(searches, 'de recherches', 'searches', cfg.maxSearchesPerDay);
      if (purchases.length >= cfg.maxPurchasesPerDay) return dayWait(purchases, "d'achats", 'purchases', cfg.maxPurchasesPerDay);
      const hour = searches.filter((t) => now - t < HOUR);
      if (hour.length >= cfg.maxSearchesPerHour) {
        const w = hour[0] + HOUR - now + 5e3;
        return { ok: false, waitMs: w, reason: `Quota horaire atteint (${hour.length}, max ${cfg.maxSearchesPerHour}), reprise dans ${fmtMin(w)}` };
      }
      return { ok: true };
    }
  }

  // ---------- Moteur ----------

  const K_COLLECTED = `${NS}:collected`;
  const K_CLUB = `${NS}:club`;
  const K_CLUB_AT = `${NS}:clubAt`;
  const K_BOUGHT = `${NS}:bought`;
  const K_EXPIRIES = `${NS}:expiries`;
  const K_SETSTATS = `${NS}:setstats`;
  const K_RESUME = `${NS}:resume`;
  const K_ACTIVE = `${NS}:active`;
  const K_TOTAL = `${NS}:total`;

  const activeSets = (cfg) => (cfg.mode === 'level10' ? [LEVEL10_SET] : parseSets(cfg.sets).sets.filter((s) => s.enabled));
  const maxRatio = (cfg) => (cfg.maxCoinsPerPoint > 0 ? cfg.maxCoinsPerPoint : cfg.mode === 'level10' ? LEVEL10_RATIO : 0);

  const EMPTY_STATS = { running: false, searches: 0, purchases: 0, attempts: 0, spent: 0, scoreAdded: 0, sold: 0, revenue: 0, taxPaid: 0, netCost: 0, listed: null, startedAt: 0, activity: '', feed: [], coins: null, lastMessage: '' };

  class Collector {
    stats = { ...EMPTY_STATS };
    stopRequested = false;
    guard = new Guard();
    collected = new Set(load(K_COLLECTED, []));
    clubOwned = new Set(load(K_CLUB, []));
    bought = load(K_BOUGHT, {});
    expiries = load(K_EXPIRIES, {});
    setStats = load(K_SETSTATS, {});
    total = { score: 0, bought: 0, tax: 0, ...load(K_TOTAL, {}) };
    starting = false;
    seen = new Set();
    cursor = { setId: null, stepIdx: 0, page: 1 };
    pileFull = false;
    misses = 0;
    listFails = 0;
    lastMaintain = 0;
    lastThrottleWarn = 0;
    releaseLock = null;
    wake = null;

    constructor(getConfig, onUpdate) {
      this.getConfig = getConfig;
      this.onUpdate = onUpdate;
    }
    get running() {
      return this.stats.running;
    }
    snapshot() {
      const cfg = this.getConfig();
      return { ...this.stats, coins: coins(), total: { ...this.total }, progress: cfg.galleryScore + this.total.score, target: cfg.targetScore, mode: cfg.mode };
    }
    addTotal(field, n) {
      this.total[field] = (this.total[field] ?? 0) + n;
      save(K_TOTAL, this.total);
    }
    owns(defId) {
      return this.collected.has(defId) || (this.getConfig().skipClubOwned && this.clubOwned.has(defId));
    }
    log(msg) {
      this.stats.lastMessage = msg;
      this.onUpdate(this.snapshot(), `${new Date().toLocaleTimeString()} ${msg}`);
    }
    feed(msg) {
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      this.stats.feed = [`${t} ${msg}`, ...this.stats.feed].slice(0, FEED_SIZE);
      this.onUpdate(this.snapshot());
    }
    activity(msg, toFeed = false) {
      this.stats.activity = msg;
      toFeed ? this.feed(msg) : this.onUpdate(this.snapshot());
    }
    stop(msg = 'Arrêt demandé', byUser = false) {
      if (byUser) save(K_ACTIVE, false);
      this.stopRequested = true;
      this.wake?.();
      this.log(msg);
    }
    unlock() {
      this.guard.unlock();
      this.log('Verrou levé manuellement');
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
      try {
        localStorage.setItem(K_RESUME, String(Date.now() + d));
      } catch {}
      setTimeout(() => location.reload(), d);
    }
    resetCollected() {
      this.collected.clear();
      save(K_COLLECTED, []);
      this.setStats = {};
      save(K_SETSTATS, {});
      this.total = { score: 0, bought: 0, tax: 0 };
      save(K_TOTAL, this.total);
      this.log('Historique des joueurs collectés effacé');
    }
    async scanClub(force = true) {
      if (this.running && force) return this.log("Scan du club impossible pendant que l'album tourne");
      this.log('Scan du club en cours…');
      try {
        const ids = await scanClubDefIds((n) => this.activity(`Scan du club : ${n} joueurs`));
        this.clubOwned = ids;
        save(K_CLUB, [...ids]);
        save(K_CLUB_AT, Date.now());
        this.log(`Scan du club terminé : ${ids.size} joueurs déjà possédés seront ignorés`);
      } catch (e) {
        this.log(`Scan du club impossible : ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        this.activity('');
      }
    }
    bumpSet(setId, field, n) {
      const s = (this.setStats[setId] ??= { bought: 0, score: 0, spent: 0, sweeps: 0 });
      s[field] = (s[field] ?? 0) + n;
      save(K_SETSTATS, this.setStats);
    }

    async otherBotRunning() {
      try {
        const q = await navigator.locks?.query?.();
        return !!q?.held?.some((l) => l.name === `${SNIPE_NS}-running`);
      } catch {
        return false;
      }
    }
    holdWebLock() {
      if (navigator.locks && !this.releaseLock) navigator.locks.request(`${NS}-running`, () => new Promise((r) => (this.releaseLock = r)));
    }

    goalReached(cfg) {
      return cfg.mode === 'level10' && cfg.targetScore > 0 && cfg.galleryScore + this.total.score >= cfg.targetScore;
    }

    validate(cfg, sets) {
      if (!sets.some((s) => s.enabled)) return 'Ajouter ou activer au moins un ensemble';
      if (cfg.minDelayMs < 0 || cfg.maxDelayMs < cfg.minDelayMs) return 'Délais entre recherches invalides (max ≥ min)';
      if (cfg.buyDelayMinMs < 0 || cfg.buyDelayMaxMs < cfg.buyDelayMinMs) return 'Délais avant achat invalides (max ≥ min)';
      if (cfg.maxSearchesPerHour < 1 || cfg.maxSearchesPerDay < 1 || cfg.maxPurchasesPerDay < 1) return 'Quotas invalides (≥ 1)';
      if (cfg.maxBuysPerSearch < 1 || cfg.maxPagesPerStep < 1) return 'Achats par recherche et pages par palier ≥ 1';
      return null;
    }

    async start() {
      if (this.running || this.starting) return;
      this.starting = true;
      try {
        await this.begin();
      } finally {
        this.starting = false;
      }
    }

    async begin() {
      let cfg = this.getConfig();
      const err = (cfg.mode === 'level10' ? null : parseSets(cfg.sets).error) ?? this.validate(cfg, activeSets(cfg));
      if (err) return this.log(err);
      if (this.goalReached(cfg)) return save(K_ACTIVE, false), this.log(`Objectif déjà atteint (${cfg.galleryScore + this.total.score} pts estimés) : vérifie le niveau dans la Galerie`);
      save(K_ACTIVE, true);
      if (await this.otherBotRunning()) {
        this.log('SnipeFC27 tourne : nouvel essai dans 5 min (quotas EA partagés)');
        setTimeout(() => load(K_ACTIVE, false) && this.start(), 3e5);
        return;
      }
      const g = this.guard.check(cfg);
      if (!g.ok && 'stop' in g) return this.log(g.stop);

      this.stats = { ...EMPTY_STATS, running: true, startedAt: Date.now(), feed: this.stats.feed };
      this.stopRequested = false;
      this.seen.clear();
      this.misses = 0;
      this.listFails = 0;
      this.cursor = { setId: null, stepIdx: 0, page: 1 };
      this.holdWebLock();
      const active = activeSets(cfg).length;
      this.log(
        cfg.mode === 'level10'
          ? `Démarrage niveau 10 automatique (${cfg.galleryScore + this.total.score} / ${cfg.targetScore} pts estimés)`
          : `Démarrage album (${active} ensemble${active > 1 ? 's' : ''}, revente ${cfg.markupPct > 0 ? `+${cfg.markupPct} %` : "au prix d'achat"})`,
      );
      if (cfg.skipClubOwned && cfg.autoScanClub && Date.now() - load(K_CLUB_AT, 0) > 12 * HOUR) await this.scanClub(false);
      if (!galleryReport.probedAt) await this.reportGallery();
      if (this.stopRequested) return this.finish();
      await this.maintain();

      let sessionStart = Date.now();
      let sessionLen = cfg.sessionMinutes * 6e4 * rand(0.85, 1.15);
      try {
        while (!this.stopRequested) {
          cfg = this.getConfig();
          const sets = activeSets(cfg);
          if (!sets.length) {
            this.log('Aucun ensemble actif');
            break;
          }
          if (this.goalReached(cfg)) {
            save(K_ACTIVE, false);
            this.log(`Objectif atteint : ${cfg.galleryScore + this.total.score} pts estimés. Vérifie le niveau 10 dans la Galerie et récupère la récompense`);
            break;
          }
          if (cfg.stopAfterHours > 0 && Date.now() - this.stats.startedAt > cfg.stopAfterHours * HOUR) {
            this.log(`Arrêt automatique après ${cfg.stopAfterHours} h`);
            break;
          }
          if (cfg.maxSpend > 0 && this.stats.spent >= cfg.maxSpend) {
            this.log(`Budget de la session atteint (${this.stats.spent} dépensés)`);
            break;
          }
          if (this.pileFull) {
            this.log('Liste de transferts pleine : attente de ventes (2 min)');
            this.activity('Attente de ventes (liste de transferts pleine)');
            await this.sleep(12e4);
            await this.maintain();
            continue;
          }
          const wallet = coins();
          const available = wallet === null ? Infinity : wallet - cfg.coinReserve;
          if (available < 200) {
            this.log(`Crédits disponibles insuffisants (${wallet}) : attente de ventes (5 min)`);
            this.activity('Attente de crédits (ventes en cours)');
            await this.sleep(3e5);
            await this.maintain();
            continue;
          }
          const gc = this.guard.check(cfg);
          if (!gc.ok) {
            if ('stop' in gc) {
              this.log(gc.stop);
              break;
            }
            this.log(gc.reason);
            this.activity(`Quota atteint, reprise à ${clock(gc.waitMs)}`);
            await this.sleep(gc.waitMs);
            continue;
          }
          if (cfg.sessionMinutes > 0 && Date.now() - sessionStart > sessionLen) {
            const b = cfg.breakMinutes * 6e4 * rand(0.6, 1.4);
            this.log(`Fin de session, pause de ${fmtMin(b)}`);
            this.activity(`Pause de session jusqu'à ${clock(b)}`);
            await this.sleep(b);
            sessionStart = Date.now();
            sessionLen = cfg.sessionMinutes * 6e4 * rand(0.85, 1.15);
            continue;
          }

          let idx = sets.findIndex((s) => s.id === this.cursor.setId);
          if (idx < 0) {
            idx = 0;
            this.cursor = { setId: sets[0].id, stepIdx: 0, page: 1 };
          }
          const set = sets[idx];
          const steps = ladder(set.maxPrice, set.minPrice ?? 0);
          const lo = this.cursor.stepIdx > 0 ? steps[this.cursor.stepIdx - 1] : (set.minPrice ?? 0);
          if (lo >= available) {
            this.feed(`${set.label} : paliers suivants au-dessus des crédits disponibles (${Math.floor(available)})`);
            if (await this.nextSet(sets, idx, cfg)) break;
            continue;
          }
          const hi = steps[this.cursor.stepIdx];
          this.activity(`${set.label} : ${lo}–${hi}, page ${this.cursor.page}`);
          const res = await searchMarket(set, lo, hi, this.cursor.page);
          this.stats.searches++;
          this.guard.recordSearch();

          if (!res.success) {
            if (res.status === 401) {
              this.sessionExpired();
              break;
            }
            if (BAD_STATUS.has(res.status)) {
              this.lockout(`Statut EA ${res.status} (captcha ou limite)`);
              break;
            }
            if (res.status === 403) {
              this.stop(`Recherche refusée (403)${errText(res.error)}. Vérifier les critères de l'ensemble « ${set.label} »`);
              break;
            }
            this.log(`Recherche en échec (statut ${res.status})${errText(res.error)}`);
          } else {
            const outcome = await this.handleResults(set, res.data, available, cfg);
            if (outcome === 'stopped' || this.stopRequested) break;
            const more = res.data.length >= PAGE_SIZE && this.cursor.page < cfg.maxPagesPerStep;
            if (outcome === 'again') this.feed(`${set.label} : joueurs manquants restants, même page`);
            else if (more) this.cursor.page++;
            else if (this.cursor.stepIdx + 1 < steps.length) this.cursor = { ...this.cursor, stepIdx: this.cursor.stepIdx + 1, page: 1 };
            else if (await this.nextSet(sets, idx, cfg)) break;
          }
          if (this.stopRequested) break;
          if (Date.now() - this.lastMaintain > MAINTAIN_EVERY_MS) {
            await sleep(rand(600, 1400));
            await this.maintain();
          }
          const d = rand(cfg.minDelayMs, cfg.maxDelayMs);
          this.activity(`Prochaine recherche dans ${Math.round(d / 1e3)} s`);
          await this.sleep(d);
        }
      } catch (e) {
        this.log(`Erreur : ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        this.finish();
      }
    }

    finish() {
      this.stats.running = false;
      this.stats.activity = '';
      this.releaseLock?.();
      this.releaseLock = null;
      this.log('Arrêté');
    }

    async reportGallery() {
      this.activity('Détection de la Galerie');
      try {
        const r = await probeGallery();
        const ok = r.calls.filter((c) => !c.error && !c.result?.timeout).length;
        this.log(
          r.apis.length
            ? `Galerie : ${r.apis.length} module(s) détecté(s) (${r.apis.map((a) => a.path).join(', ')}), ${ok} lecture(s) réussie(s)`
            : 'Galerie : statut collecté et score lus dans les réponses EA de chaque carte',
        );
      } catch (e) {
        this.log(`Détection Galerie impossible : ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Passe à l'ensemble suivant ; renvoie true s'il faut arrêter la boucle.
    async nextSet(sets, idx, cfg) {
      const set = sets[idx];
      this.bumpSet(set.id, 'sweeps', 1);
      const s = this.setStats[set.id] ?? {};
      this.log(`Ensemble « ${set.label} » balayé (${s.bought ?? 0} joueurs collectés au total, score Galerie +${s.score ?? 0})`);
      if (idx + 1 < sets.length) {
        this.cursor = { setId: sets[idx + 1].id, stepIdx: 0, page: 1 };
        return false;
      }
      if (cfg.resweepMinutes <= 0) {
        this.log('Tous les ensembles ont été balayés');
        return true;
      }
      const w = cfg.resweepMinutes * 6e4 * rand(0.85, 1.15);
      this.log(`Tous les ensembles balayés, nouveau passage à ${clock(w)} (nouvelles annonces)`);
      this.activity(`Nouveau passage à ${clock(w)}`);
      this.seen.clear();
      this.cursor = { setId: sets[0].id, stepIdx: 0, page: 1 };
      await this.sleep(w);
      await this.maintain();
      return false;
    }

    async handleResults(set, items, available, cfg) {
      const best = new Map();
      for (const it of items) {
        if (this.seen.has(it.tradeId) || !(it.buyNow > 0) || it.buyNow > set.maxPrice || it.buyNow > available) continue;
        if (it.expires > 0 && it.expires <= 3) continue;
        if (it.rating < set.minRating || it.rating > set.maxRating) continue;
        if (!it.defId || this.owns(it.defId)) continue;
        if (it.collected === true) {
          this.collected.add(it.defId);
          continue;
        }
        if (cfg.skipClubOwned && it.duplicate) {
          this.clubOwned.add(it.defId);
          continue;
        }
        const ratio = maxRatio(cfg);
        if (ratio > 0 && it.buyNow / it.score > ratio) continue;
        const prev = best.get(it.defId);
        if (!prev || it.buyNow < prev.buyNow) best.set(it.defId, it);
      }
      if (flagKey && !this.flagLogged) {
        this.flagLogged = true;
        this.log(`Marqueur Galerie détecté sur les cartes (${flagKey}) : joueurs déjà dans la Galerie ignorés`);
      }
      const picks = [...best.values()].sort((a, b) => b.score / b.buyNow - a.score / a.buyNow).slice(0, cfg.maxBuysPerSearch);
      this.feed(`${set.label} : ${items.length} annonce${items.length > 1 ? 's' : ''}, ${best.size} joueur${best.size > 1 ? 's' : ''} manquant${best.size > 1 ? 's' : ''}${picks.length ? ' → achat' : ''}`);
      let budget = available;
      let tried = 0;
      for (const it of picks) {
        if (this.stopRequested) return 'stopped';
        if (it.buyNow > budget) continue;
        if (cfg.maxSpend > 0 && this.stats.spent + it.buyNow > cfg.maxSpend) break;
        this.seen.add(it.tradeId);
        tried++;
        const r = await this.buyAndList(it, set, cfg);
        if (r === 'stopped') return 'stopped';
        if (r === 'bought') {
          budget -= it.buyNow;
          this.misses = 0;
        } else if (r === 'missed' && ++this.misses >= MAX_MISSES) {
          this.lockout(`${this.misses} achats ratés d'affilée, soft ban probable`);
          return 'stopped';
        }
        await sleep(rand(cfg.buyDelayMinMs, cfg.buyDelayMaxMs));
      }
      // Joueurs manquants restants sur cette page : on la refait avant d'avancer
      return tried > 0 && best.size > tried ? 'again' : 'ok';
    }

    async buyAndList(it, set, cfg) {
      this.activity(`Achat de ${it.name} (${it.rating}) à ${it.buyNow}…`);
      await sleep(rand(cfg.buyDelayMinMs, cfg.buyDelayMaxMs));
      if (this.stopRequested) return 'stopped';
      this.stats.attempts++;
      const r = await bid(it);
      if (!r.success) {
        if (r.status === 401) {
          this.sessionExpired();
          return 'stopped';
        }
        if (BAD_STATUS.has(r.status)) {
          this.lockout(`Statut EA ${r.status} (captcha ou limite)`);
          return 'stopped';
        }
        const why = r.status === 403 ? 'déjà achetée par un autre' : `statut ${r.status}`;
        this.feed(`Raté ${it.name} à ${it.buyNow} (${why})`);
        return 'missed';
      }
      const score = it.score;
      this.stats.purchases++;
      this.stats.spent += it.buyNow;
      this.stats.scoreAdded += score;
      this.addTotal('score', score);
      this.addTotal('bought', 1);
      this.guard.recordPurchase();
      this.collected.add(it.defId);
      save(K_COLLECTED, [...this.collected]);
      this.bumpSet(set.id, 'bought', 1);
      this.bumpSet(set.id, 'score', score);
      this.bumpSet(set.id, 'spent', it.buyNow);
      this.log(`Collecté ${it.name} (${it.rating}) à ${it.buyNow}, +${score} pts Galerie, pour « ${set.label} »`);

      const id = Number(it.raw?.id);
      const sell = sellPriceFor(it.buyNow, cfg.markupPct);
      if (id) {
        this.bought[id] = { price: it.buyNow, defId: it.defId, sell };
        save(K_BOUGHT, this.bought);
      }
      if (this.pileFull) {
        this.log('Liste de transferts pleine : joueur laissé dans les non-assignés (il compte déjà pour la Galerie)');
        return 'bought';
      }
      await sleep(rand(800, 1600));
      const l = await moveAndList(it.raw, sell);
      if (l.success) {
        this.listFails = 0;
        this.feed(`${it.name} remis en vente à ${sell}`);
      } else {
        this.log(`Mise en vente de ${it.name} échouée (statut ${l.status}), joueur dans les non-assignés`);
        if (++this.listFails >= MAX_LIST_FAILS) this.stop(`${this.listFails} mises en vente échouées d'affilée : non-assignés probablement pleins, arrêt`);
      }
      return 'bought';
    }

    async maintain() {
      this.activity('Lecture de la liste de transferts');
      this.lastMaintain = Date.now();
      try {
        const pile = await readTransferPile();
        if (!pile.success) return this.log(`Lecture de la liste de transferts impossible (statut ${pile.status})${errText(pile.error)}`);
        const sold = pile.data.filter((i) => i.state === 'sold');
        const expired = pile.data.filter((i) => i.state === 'expired');
        for (const i of sold) {
          const net = Math.floor(i.soldPrice * (1 - EA_TAX));
          this.stats.sold++;
          this.stats.revenue += net;
          this.stats.taxPaid += i.soldPrice - net;
          if (this.bought[i.id]) this.addTotal('tax', i.soldPrice - net);
          const b = this.bought[i.id];
          if (b) {
            this.stats.netCost += b.price - net;
            delete this.bought[i.id];
            delete this.expiries[i.id];
          }
          this.log(`Vendu ${i.name} à ${i.soldPrice} (net ${net}${b ? `, coût de l'opération ${b.price - net}` : ''})`);
        }
        save(K_BOUGHT, this.bought);
        if (sold.length) {
          await sleep(rand(500, 1200));
          const c = await observe(services.Item.clearSoldItems?.());
          if (!c.success) this.log(`Encaissement des ventes échoué (statut ${c.status})${errText(c.error)}`);
        }

        const cfg = this.getConfig();
        let bulk = 0;
        for (const i of expired) {
          const b = this.bought[i.id];
          const n = b ? (this.expiries[i.id] = (this.expiries[i.id] ?? 0) + 1) : 0;
          if (b && i.raw && cfg.dropAfterExpiries > 0 && n >= cfg.dropAfterExpiries) {
            const cur = i.buyNow || b.sell || b.price;
            const price = Math.max(200, priceDown(cur));
            await sleep(rand(500, 1200));
            const r = await listItem(i.raw, price);
            this.feed(r.success ? `${i.name} invendu ${n} fois, remis à ${price}` : `Remise en vente de ${i.name} échouée (statut ${r.status})`);
            if (r.success) b.sell = price;
          } else bulk++;
        }
        save(K_EXPIRIES, this.expiries);
        save(K_BOUGHT, this.bought);
        if (bulk) {
          await sleep(rand(500, 1200));
          const r = await observe(services.Item.relistExpiredAuctions?.());
          this.log(r.success ? `${bulk} annonce(s) expirée(s) remise(s) en vente au même prix` : `Remise en vente des expirés échouée (statut ${r.status})${errText(r.error)}`);
        }
        const remaining = pile.data.length - sold.length;
        this.stats.listed = pile.data.filter((i) => i.state === 'active' || i.state === 'expired').length;
        this.pileFull = remaining >= PILE_MAX;
        this.feed(`Liste de transferts : ${pile.data.filter((i) => i.state === 'active').length} en vente, ${sold.length} vendu(s), ${expired.length} expiré(s)`);
        await observe(services.User.requestCurrencies?.());
        this.onUpdate(this.snapshot());
      } catch (e) {
        this.log(`Maintenance liste de transferts : ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    async sleep(ms) {
      if (this.stopRequested) return;
      const end = Date.now() + ms;
      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(t);
          this.wake = null;
          resolve();
        };
        const t = setTimeout(done, ms);
        this.wake = done;
      });
      const late = Date.now() - end;
      if (late > 2e4 && Date.now() - this.lastThrottleWarn > 6e5) {
        this.lastThrottleWarn = Date.now();
        this.log(`Attention : pause rallongée de ${Math.round(late / 1e3)} s (onglet en arrière-plan ralenti ou ordinateur en veille)`);
      }
    }
  }

  // ---------- Configuration ----------

  const K_CONFIG = `${NS}:config`;
  function loadConfig() {
    const raw = load(K_CONFIG, {});
    const cfg = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (typeof raw[k] === typeof DEFAULTS[k]) cfg[k] = raw[k];
    return cfg;
  }

  // ---------- Panneau ----------

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.box { position: fixed; top: 80px; left: 16px; z-index: 2147483647; width: 320px; max-height: 85vh;
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
.feed { max-height: 120px; overflow-y: auto; padding: 4px 12px 6px; background: #101216; border-bottom: 1px solid #2c303a;
  font: 11px/1.45 ui-monospace, monospace; color: #99a; }
.feed:empty, .feed.hidden { display: none; }
.feed div:first-child { color: #e8e8e8; }
.body { padding: 10px 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
h4 { margin: 0 0 4px; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #778; }
input, textarea { background: #0e0f12; color: inherit; border: 1px solid #2c303a; border-radius: 6px; padding: 5px 7px; font: inherit; min-width: 0; }
textarea { width: 100%; resize: vertical; font: 11px/1.35 ui-monospace, monospace; }
input:focus, textarea:focus { outline: none; border-color: #4c6ef5; }
button { border: 0; border-radius: 6px; padding: 6px 10px; font: inherit; font-weight: 600; cursor: pointer; background: #2c303a; color: #e8e8e8; }
button:hover:not(:disabled) { filter: brightness(1.15); }
button:disabled { opacity: .4; cursor: default; }
.x { background: none; color: #889; padding: 0 4px; font-size: 14px; }
.row { display: flex; gap: 6px; align-items: center; margin-top: 6px; }
.row > input { flex: 1; width: 0; }
.row > button { flex: 1; }
.hint { font-size: 11px; color: #889; margin-top: 4px; }
.hint:empty { display: none; }
.sets { display: flex; flex-direction: column; gap: 4px; }
.set { display: grid; grid-template-columns: auto 1fr auto; align-items: center; column-gap: 6px; padding: 6px 8px; background: #1d2027; border-radius: 6px; }
.set.off { opacity: .5; }
.set .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.set .meta { grid-column: 2; font-size: 11px; color: #889; overflow-wrap: anywhere; }
.set input[type=checkbox] { grid-row: 1 / span 2; }
.set .x { grid-row: 1 / span 2; grid-column: 3; }
.empty { color: #778; font-size: 11px; }
.setting { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 3px 0; }
.setting input[type=number] { width: 64px; text-align: right; }
.pair { display: flex; align-items: center; gap: 4px; color: #778; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.actions button { flex: 1; padding: 8px; }
.start { background: #2f9e44; color: #fff; } .stop { background: #c92a2a; color: #fff; }
.stats { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; }
.stats b { text-align: right; }
.loghead { display: flex; justify-content: space-between; align-items: center; }
.loghead button { padding: 2px 8px; font-size: 11px; font-weight: 500; }
.log { font: 11px/1.35 ui-monospace, monospace; background: #0e0f12; border-radius: 6px; padding: 6px;
  height: 130px; overflow-y: auto; white-space: pre-wrap; color: #aab; }
details summary { cursor: pointer; color: #889; font-size: 11px; }
details[open] summary { margin-bottom: 6px; }
details .actions button { padding: 5px; font-weight: 500; font-size: 11px; }
.neg { color: #ff6b6b; }
button.big { width: 100%; padding: 12px; font-size: 14px; }
.bar { height: 10px; background: #0e0f12; border-radius: 5px; overflow: hidden; margin: 4px 0; }
.bar .fill { height: 100%; width: 0; background: #2f9e44; transition: width .4s; }
.goaltext { font-size: 11px; color: #aab; }
details { border-top: 1px solid #2c303a; padding-top: 6px; }
details > * + * { margin-top: 6px; }
`;

  const FLOAT_KEYS = new Set(['markupPct', 'maxCoinsPerPoint']);
  const SETTINGS = [
    { key: 'markupPct', label: 'Majoration revente (%, 0 = prix d’achat)' },
    { key: 'maxBuysPerSearch', label: 'Achats max par recherche' },
    { key: 'maxCoinsPerPoint', label: 'Crédits max par point Galerie (0 = sans limite)' },
    { key: 'maxPagesPerStep', label: 'Pages max par palier de prix' },
    { key: 'coinReserve', label: 'Crédits à garder' },
    { key: 'maxSpend', label: 'Dépense max par session (0 = illimitée)' },
    { key: 'resweepMinutes', label: 'Nouveau passage après (min, 0 = arrêt)' },
    { key: 'stopAfterHours', label: 'Arrêt auto après (h, 0 = jamais)' },
  ];
  const ADVANCED = [
    { key: 'dropAfterExpiries', label: 'Baisser d’un palier après N invendus (0 = jamais)' },
    { key: 'maxSearchesPerHour', label: 'Recherches max / heure' },
    { key: 'maxSearchesPerDay', label: 'Recherches max / 24 h' },
    { key: 'maxPurchasesPerDay', label: 'Achats max / 24 h' },
    { key: 'sessionMinutes', label: 'Pause toutes les (min, 0 = jamais)' },
    { key: 'breakMinutes', label: 'Durée de la pause (min)' },
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
    diagOn = false;
    constructor(handlers) {
      this.handlers = handlers;
      const host = document.createElement('div');
      host.id = `${NS}-host`;
      for (const ev of ['keydown', 'keyup', 'keypress']) host.addEventListener(ev, (e) => e.stopPropagation());
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      this.box = h('div', { className: 'box' });
      shadow.append(h('style', { textContent: CSS }), this.box);
      this.render();
    }
    toggle() {
      this.box.classList.toggle('hidden');
    }
    setConfig(patch) {
      this.config = { ...this.config, ...patch };
      save(K_CONFIG, this.config);
    }
    sets() {
      return parseSets(this.config.sets);
    }
    saveSets(sets) {
      this.setConfig({ sets: JSON.stringify(sets) });
      this.renderSets();
    }

    render() {
      const header = h('header', {}, 'AlbumFC27', h('button', { className: 'x', textContent: '×', onclick: () => this.toggle() }));
      this.draggable(header);
      this.activityEl = h('div', { className: 'activity', title: "Afficher / masquer l'historique" });
      this.feedEl = h('div', { className: 'feed hidden' });
      this.activityEl.onclick = () => this.feedEl.classList.toggle('hidden');
      this.setsEl = h('div', { className: 'sets' });
      this.mainBtn = h('button', { className: 'start big', textContent: 'Lancer le niveau 10 automatique', onclick: () => (this.running ? this.handlers.onStop() : this.handlers.onStart()) });
      this.goalTitle = h('h4', { textContent: 'Objectif : Galerie niveau 10' });
      this.barFill = h('div', { className: 'fill' });
      this.goalText = h('div', { className: 'goaltext' });
      this.statsEl = h('div', { className: 'stats' });
      this.logEl = h('div', { className: 'log' });
      const copy = h('button', { textContent: 'Copier' });
      copy.onclick = async () => {
        copy.textContent = (await copyText(this.logEl.textContent ?? '')) ? 'Copié' : 'Échec';
        setTimeout(() => (copy.textContent = 'Copier'), 1500);
      };
      const score = this.numInput('galleryScore');
      score.placeholder = '0';
      const body = h(
        'div',
        { className: 'body' },
        h('div', {}, this.goalTitle, h('div', { className: 'bar' }, this.barFill), this.goalText),
        this.mainBtn,
        h('div', { className: 'setting' }, h('span', { textContent: 'Score Galerie actuel (facultatif, lu dans le jeu)' }), score),
        this.statsEl,
        h('details', {}, h('summary', { textContent: 'Journal' }), h('div', { className: 'loghead' }, h('span'), copy), this.logEl),
        h(
          'details',
          {},
          h('summary', { textContent: 'Avancé' }),
          this.checkSetting('mode', 'Utiliser mes propres ensembles (au lieu du niveau 10)', (on) => (on ? 'custom' : 'level10')),
          this.numSetting({ key: 'targetScore', label: 'Objectif niveau 10 (points)' }),
          h('h4', { textContent: 'Mes ensembles' }),
          this.setsEl,
          this.addForm(),
          h('h4', { textContent: 'Réglages' }),
          this.delayRow('Délai recherches (s)', 'minDelayMs', 'maxDelayMs'),
          this.delayRow('Délai avant achat (s)', 'buyDelayMinMs', 'buyDelayMaxMs', 0.1),
          ...SETTINGS.map((s) => this.numSetting(s)),
          this.checkSetting('skipClubOwned', 'Ignorer les joueurs déjà possédés (club)'),
          this.checkSetting('autoScanClub', 'Scanner le club au démarrage (toutes les 12 h)'),
          this.advanced(),
        ),
      );
      this.box.append(header, this.activityEl, this.feedEl, body);
      this.renderSets();
    }

    addForm() {
      const label = h('input', { placeholder: 'Nom (ex : Ligue 1 or)' });
      const maxPrice = h('input', { type: 'number', min: '200', step: '100', placeholder: 'Prix max / carte' });
      const minR = h('input', { type: 'number', min: '0', max: '99', placeholder: 'Note min' });
      const maxR = h('input', { type: 'number', min: '0', max: '99', placeholder: 'Note max' });
      const crit = h('textarea', { rows: 3, placeholder: 'Critères (remplis par « Capturer »), ex : {"league":16,"level":"gold"}' });
      const hint = h('div', { className: 'hint' });
      const capture = h('button', { textContent: 'Capturer la recherche du marché' });
      capture.onclick = () => {
        const c = this.handlers.lastUiCriteria();
        if (!c) return void (hint.textContent = "Fais d'abord une recherche dans Transferts > Marché avec les filtres de l'ensemble (club, championnat, nation, rareté, qualité…), puis reclique.");
        crit.value = JSON.stringify(c);
        hint.textContent = `Capturé : ${describeCriteria(c)}`;
        if (!label.value) label.focus();
      };
      const add = h('button', { textContent: 'Ajouter l’ensemble' });
      add.onclick = () => {
        let criteria;
        try {
          criteria = JSON.parse(crit.value || '{}');
          if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) throw 0;
        } catch {
          return void (hint.textContent = 'Critères invalides (objet JSON attendu)');
        }
        const price = Math.floor(Number(maxPrice.value));
        if (!(price >= 200)) return void (hint.textContent = 'Prix max par carte requis (min 200)');
        const set = {
          id: Date.now().toString(36),
          label: label.value.trim() || describeCriteria(criteria).slice(0, 40),
          criteria,
          maxPrice: price,
          minRating: Math.floor(Number(minR.value) || 0),
          maxRating: Math.floor(Number(maxR.value) || 99),
          enabled: true,
        };
        this.saveSets([...this.sets().sets, set]);
        label.value = maxPrice.value = minR.value = maxR.value = crit.value = '';
        hint.textContent = `Ensemble « ${set.label} » ajouté`;
      };
      return h(
        'details',
        {},
        h('summary', { textContent: 'Ajouter un ensemble' }),
        h('div', { className: 'row' }, capture),
        crit,
        h('div', { className: 'row' }, label),
        h('div', { className: 'row' }, maxPrice, minR, maxR),
        h('div', { className: 'row' }, add),
        hint,
      );
    }

    renderSets() {
      const { sets, error } = this.sets();
      const st = load(K_SETSTATS, {});
      const rows = sets.map((s) => {
        const cb = h('input', { type: 'checkbox', checked: s.enabled, title: 'Activer / désactiver' });
        cb.onchange = () => this.saveSets(this.sets().sets.map((x) => (x.id === s.id ? { ...x, enabled: cb.checked } : x)));
        const del = h('button', { className: 'x', textContent: '×', title: 'Retirer' });
        del.onclick = () => this.saveSets(this.sets().sets.filter((x) => x.id !== s.id));
        const p = st[s.id];
        const rating = s.minRating > 0 || s.maxRating < 99 ? ` · note ${s.minRating}–${s.maxRating}` : '';
        const prog = p ? ` · ${p.bought} collectés, score ~${p.score}` : '';
        return h(
          'div',
          { className: `set${s.enabled ? '' : ' off'}`, title: JSON.stringify(s.criteria) },
          cb,
          h('span', { className: 'name', textContent: s.label }),
          del,
          h('span', { className: 'meta', textContent: `≤ ${s.maxPrice}${rating} · ${describeCriteria(s.criteria)}${prog}` }),
        );
      });
      if (!rows.length) rows.push(h('div', { className: 'empty', textContent: 'Aucun ensemble : ouvre « Ajouter un ensemble ».' }));
      if (error) rows.push(h('div', { className: 'neg', textContent: error }));
      this.setsEl.replaceChildren(...rows);
    }

    advanced() {
      const diag = h('button', { textContent: 'Diagnostic réseau : off' });
      diag.onclick = () => {
        this.diagOn = !this.diagOn;
        diag.textContent = `Diagnostic réseau : ${this.diagOn ? 'on' : 'off'}`;
        this.handlers.onDiag(this.diagOn);
      };
      const unlock = h('button', { textContent: 'Lever le verrou' });
      unlock.onclick = () => confirm("Lever le verrou anti-captcha ? À ne faire que si EA n'a pas affiché de captcha.") && this.handlers.onUnlock();
      const scan = h('button', { textContent: 'Scanner le club' });
      scan.onclick = () => this.handlers.onScanClub();
      const reset = h('button', { textContent: 'Oublier les collectés' });
      reset.onclick = () => confirm('Effacer la liste des joueurs déjà collectés ? Ils pourront être rachetés.') && (this.handlers.onReset(), this.renderSets());
      const gallery = h('button', { textContent: 'Copier rapport Galerie' });
      gallery.onclick = async () => {
        gallery.textContent = 'Analyse…';
        const data = await this.handlers.galleryReport();
        gallery.textContent = (await copyText(JSON.stringify(data, null, 1))) ? 'Copié' : 'Échec';
        setTimeout(() => (gallery.textContent = 'Copier rapport Galerie'), 1500);
      };
      const exp = h('button', { textContent: 'Exporter ensembles' });
      exp.onclick = async () => {
        exp.textContent = (await copyText(this.config.sets)) ? 'Copié' : 'Échec';
        setTimeout(() => (exp.textContent = 'Exporter ensembles'), 1500);
      };
      const imp = h('button', { textContent: 'Importer ensembles' });
      imp.onclick = () => {
        const raw = prompt('Coller la liste exportée (JSON)');
        if (!raw) return;
        const { sets, error } = parseSets(raw);
        if (error || !sets.length) return alert(error ?? 'Aucun ensemble valide');
        this.saveSets([...this.sets().sets, ...sets]);
      };
      return h(
        'details',
        {},
        h('summary', { textContent: 'Réglages avancés' }),
        ...ADVANCED.map((s) => this.numSetting(s)),
        h('div', { className: 'actions' }, scan, reset),
        h('div', { className: 'actions', style: 'margin-top:6px' }, exp, imp),
        h('div', { className: 'actions', style: 'margin-top:6px' }, diag, gallery, unlock),
      );
    }

    numInput(key, seconds = false, stepS = 0.5) {
      const v = this.config[key];
      const i = h('input', { type: 'number', min: '0', value: String(seconds ? v / 1e3 : v) });
      if (seconds) i.step = String(stepS);
      else if (FLOAT_KEYS.has(key)) i.step = '0.05';
      i.onchange = () => {
        const n = Number(i.value);
        this.setConfig({ [key]: seconds ? Math.round(n * 1e3) : FLOAT_KEYS.has(key) ? Math.max(0, n) : Math.floor(n) });
      };
      return i;
    }
    numSetting(s) {
      return h('div', { className: 'setting' }, h('span', { textContent: s.label }), this.numInput(s.key));
    }
    checkSetting(key, label, map) {
      const cb = h('input', { type: 'checkbox', checked: map ? this.config[key] === map(true) : !!this.config[key] });
      cb.onchange = () => this.setConfig({ [key]: map ? map(cb.checked) : cb.checked });
      return h('label', { className: 'setting' }, h('span', { textContent: label }), cb);
    }
    delayRow(label, a, b, stepS = 0.5) {
      return h('div', { className: 'setting' }, h('span', { textContent: label }), h('span', { className: 'pair' }, this.numInput(a, true, stepS), '–', this.numInput(b, true, stepS)));
    }

    update(s, line) {
      this.running = s.running;
      this.activityEl.classList.toggle('on', s.running);
      this.activityEl.textContent = s.running ? s.activity || 'En cours' : "À l'arrêt";
      this.feedEl.replaceChildren(...s.feed.map((f) => h('div', { textContent: f })));
      const level10 = s.mode !== 'custom';
      this.mainBtn.textContent = s.running ? 'Arrêter' : level10 ? 'Lancer le niveau 10 automatique' : 'Lancer mes ensembles';
      this.mainBtn.className = s.running ? 'stop big' : 'start big';
      const pct = s.target > 0 ? Math.min(100, (s.progress / s.target) * 100) : 0;
      this.goalTitle.textContent = level10 ? 'Objectif : Galerie niveau 10' : 'Mes ensembles';
      this.barFill.style.width = `${pct}%`;
      this.goalText.textContent = `${fmtNum(s.progress)} / ${fmtNum(s.target)} pts estimés (${pct.toFixed(1).replace('.', ',')} %)`;
      const rows = [
        ['Joueurs collectés', fmtNum(s.total.bought)],
        ['Taxe EA payée', fmtNum(s.total.tax)],
        ['En vente', s.listed ?? '?'],
        ['Crédits', s.coins == null ? '?' : fmtNum(s.coins)],
      ];
      this.statsEl.replaceChildren(...rows.flatMap(([k, v]) => [h('span', { textContent: k }), h('b', { textContent: String(v) })]));
      if (line) this.logEl.textContent = `${line}\n${this.logEl.textContent ?? ''}`.split('\n').slice(0, 1e3).join('\n');
      if (s.purchases !== this.lastPurchases) {
        this.lastPurchases = s.purchases;
        this.renderSets();
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

  function postStats(stats) {
    window.postMessage({ ns: NS, dir: 'to-ext', stats }, window.location.origin);
  }

  function init() {
    hookUiSearch();
    const panel = new Panel({
      onStart: () => void bot.start(),
      onStop: () => bot.stop('Arrêt demandé', true),
      onUnlock: () => bot.unlock(),
      onScanClub: () => void bot.scanClub(),
      onReset: () => bot.resetCollected(),
      lastUiCriteria: () => lastUiCriteria,
      galleryReport: async () => {
        if (!galleryReport.probedAt) await probeGallery();
        return { ...galleryReport, clubScan: clubScanShape, responses: galleryCaptures, url: location.href, at: new Date().toISOString() };
      },
      onDiag: (on) => {
        diagSink = on ? (l) => panel.update(bot.snapshot(), `${new Date().toLocaleTimeString()} ${l}`) : null;
        panel.update(bot.snapshot(), on ? 'Diagnostic réseau activé' : 'Diagnostic réseau désactivé');
      },
    });
    const bot = new Collector(
      () => panel.config,
      (s, line) => {
        panel.update(s, line);
        postStats(s);
      },
    );
    panel.update(bot.snapshot(), `Web App détectée, prêt (${bot.collected.size} joueurs déjà collectés, ${bot.clubOwned.size} connus au club)`);
    postStats(bot.snapshot());
    try {
      const at = Number(localStorage.getItem(K_RESUME) ?? 0);
      localStorage.removeItem(K_RESUME);
      if ((at && Date.now() - at < 9e5) || load(K_ACTIVE, false)) {
        panel.update(bot.snapshot(), 'Reprise automatique dans 10 s');
        setTimeout(() => void bot.start(), 1e4);
      }
    } catch {}
    window.addEventListener('message', (e) => {
      if (e.source !== window || e.data?.ns !== NS || e.data.dir !== 'to-page') return;
      const { cmd } = e.data;
      if (cmd.type === 'start') bot.start();
      else if (cmd.type === 'stop') bot.stop('Arrêt demandé', true);
      else if (cmd.type === 'toggle-panel') panel.toggle();
    });
  }

  const boot = setInterval(() => {
    if (webAppReady()) {
      clearInterval(boot);
      init();
    }
  }, 1e3);
})();
