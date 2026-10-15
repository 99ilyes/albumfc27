(function () {
  const NS = 'albumfc27';
  const SNIPE_NS = 'snipefc27';
  const EA_TAX = 0.05;
  const BAD_STATUS = new Set([426, 429, 458, 460, 494, 512, 521]);
  // Limites de débit (trop de requêtes) : pause courte ; les autres statuts demandent une vérification (captcha)
  const SOFT_STATUS = new Set([426, 429, 512, 521]);
  const HOUR = 36e5;
  const DAY = 24 * HOUR;
  const SOFT_CAP = 30 * 6e4;
  const HARD_CAP = 2 * HOUR;
  const CALM_MS = 30 * 6e4;
  // Quotas (0 = illimité), comptés avec SnipeFC27 ; désactivés par défaut
  const QUOTA_DEFAULTS = { quotaSearchHour: 0, quotaSearchDay: 0, quotaBuyDay: 0 };
  // Pauses après un refus EA (min, 0 = aucune : reprise immédiate) ; doublées si ça se répète
  const PAUSE_DEFAULTS = { softPauseMin: 0, captchaPauseMin: 0 };
  const CONFIG_VERSION = 3;
  const SPEED_DEFAULTS = { minDelayMs: 4e3, maxDelayMs: 8e3, buyDelayMinMs: 300, buyDelayMaxMs: 900 };
  // Ralentissement après une limite EA : délais × paceStep à chaque limite, plafond paceMax, retour à ×1 après paceResetMin sans limite
  const PACE_DEFAULTS = { paceStep: 1.5, paceMax: 4, paceResetMin: 30 };
  const SPEED_PRESETS = [
    ['Prudent', { minDelayMs: 7e3, maxDelayMs: 12e3, buyDelayMinMs: 500, buyDelayMaxMs: 1200 }],
    ['Normal', SPEED_DEFAULTS],
    ['Rapide', { minDelayMs: 2e3, maxDelayMs: 4e3, buyDelayMinMs: 150, buyDelayMaxMs: 500 }],
  ];
  const PILE_MAX = 100;
  // 21 annonces demandées ; page pleine dès 20 (selon la version, la Web App renvoie 20 ou 21) : il peut exister moins cher
  const PAGE_COUNT = 21;
  const PAGE_FULL = 20;
  // Achat (méthode FST) : 10 recherches max par joueur, abandon après 6 achats ratés (concurrence)
  const BUY_SEARCHES = 10;
  const MAX_COMPETITION = 6;
  const MAX_MISSES = 8;
  const MAX_LIST_FAILS = 3;
  const FEED_SIZE = 30;
  const EVENT_MAX = 400;
  // Tolérance : paliers EA au-dessus du prix de départ avant d'abandonner (« prix monté »)
  const DEFAULT_TOLERANCE = 3;
  const MAX_TOLERANCE = 10;
  const DEFAULT_MARKUP = 5;
  // Quick snipe (FST) : 4 min, vitesse rapide, achat sous le prix du marché avec 300 crédits de profit minimum, arrêt au premier achat
  const SNIPE_MS = 4 * 6e4;
  const SNIPE_PROFIT = 300;
  const SNIPE_DELAY = [2e3, 4e3];
  const SNIPE_MIN_STEPS = 10;
  const AFTER_BUY = { keep: 'Garder au club', relist: "Revendre au prix d'achat", markup: 'Revendre avec marge' };
  const DEFID_CHUNK = 250;
  const FUTGG_GALLERY = 'https://www.fut.gg/fut-gallery/';

  const step = (p) => (p < 1e3 ? 50 : p < 1e4 ? 100 : p < 5e4 ? 250 : p < 1e5 ? 500 : 1e3);
  const roundPrice = (p) => Math.max(0, Math.round(p / step(p)) * step(p));
  const priceDown = (p) => Math.max(150, p - step(p - 1));
  const tickUp = (p) => roundPrice(p + step(p));
  const roundDown = (p) => (p > 0 ? Math.floor(p / step(p)) * step(p) : 0);
  const tickDown = (p) => Math.max(0, roundPrice(p - step(p - 1)));
  const tolCap = (p, n) => {
    let r = p;
    for (let i = 0; i < n && r > 0; i++) r = tickUp(r);
    return r;
  };
  // Prix plancher du sondage (FST) : or/argent/bronze selon la note pour les cartes communes et rares, 1 000 sinon
  const minPriceFor = (rareflag, rating) => (![0, 1].includes(Number(rareflag ?? 0)) ? 1e3 : Number(rating) >= 75 ? 350 : 200);
  // Marge : arrondi au palier supérieur, au moins un palier au-dessus du prix d'achat
  const markupPrice = (p, pct) => {
    if (pct <= 0) return roundPrice(p);
    const m = p * (1 + pct / 100);
    return Math.max(Math.ceil(m / step(m)) * step(m), tickUp(p));
  };
  const netOf = (p) => Math.floor(p * (1 - EA_TAX));
  // Annonce publiée depuis plus d'une minute (FST écarte les annonces toutes fraîches du prix de référence)
  const DURATIONS = [3600, 10800, 21600, 43200, 86400, 259200];
  const settled = (sr) => !Number.isFinite(sr) || Math.floor(((DURATIONS.find((d) => sr < d) ?? DURATIONS[DURATIONS.length - 1]) - sr) / 60) > 1;

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

  // Session EA vue passer dans les requêtes de la Web App : permet de remettre en vente par identifiant de carte
  const eaApi = { base: null, headers: {} };
  function noteUrl(url) {
    try {
      const m = new URL(String(url), location.href).href.match(/^(https?:\/\/[^?#]*?\/ut\/game\/[^/?#]+\/)/i);
      if (m) eaApi.base = m[1];
    } catch {}
  }
  function noteHeader(name, value) {
    if (/^x-ut-/i.test(String(name)) && value) eaApi.headers[String(name)] = String(value);
  }

  function installNetHooks() {
    const X = XMLHttpRequest.prototype;
    const open = X.open;
    const setHeader = X.setRequestHeader;
    X.setRequestHeader = function (name, value) {
      noteHeader(name, value);
      return setHeader.call(this, name, value);
    };
    X.open = function (method, url, ...rest) {
      noteUrl(url);
      this.addEventListener('readystatechange', () => {
        if (this.readyState === 4 && (this.responseType === '' || this.responseType === 'text')) onResponse(String(url), this.status, this.responseText);
      });
      return open.call(this, method, url, ...rest);
    };
    const f = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/\/ut\//i.test(url)) {
        noteUrl(url);
        try {
          const hs = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          hs.forEach((v, k) => noteHeader(k, v));
        } catch {}
      }
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
        resolve({ success: !!r?.success, status: Number(r?.status ?? 0), data: r?.data, response: r?.response, error: r?.error ?? r?.data?.reason ?? r?.data?.message }),
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

  async function refreshCoins() {
    await observe(services.User.requestCurrencies?.());
    return coins();
  }

  function mapItem(i) {
    const a = i._auction ?? i.getAuctionData?.() ?? {};
    const defId = Number(i.definitionId ?? 0);
    let sr = NaN;
    try {
      sr = Number(typeof a.getSecondsRemaining === 'function' ? a.getSecondsRemaining() : a.expires);
    } catch {}
    return { raw: i, tradeId: Number(a.tradeId), buyNow: Number(a.buyNowPrice), expires: Number(a.expires ?? 0), sr, defId, name: staticName(i), collected: netItems.get(defId)?.collected === true };
  }

  // minBid alterné par l'appelant : contourne le cache EA sans exclure d'annonce
  async function searchMarket(defId, { minBuy = 0, maxBuy = 0, minBid = 0 } = {}) {
    const c = new UTSearchCriteriaDTO();
    c.type = typeof SearchType !== 'undefined' ? SearchType.PLAYER : 'player';
    c.defId = [defId];
    c.count = PAGE_COUNT;
    if (minBuy > 0) c.minBuy = minBuy;
    if (maxBuy > 0) c.maxBuy = maxBuy;
    if (minBid > 0) c.minBid = minBid;
    services.Item.clearTransferMarketCache?.();
    const r = await observe(services.Item.searchTransferMarket(c, 1));
    return { ...r, data: (r.data?.items ?? []).map(mapItem) };
  }

  const bid = (item) => observe(services.Item.bid(item.raw, item.buyNow));

  // Fourchette de prix EA de la carte (demandée si absente), pour borner la mise en vente
  async function priceLimits(raw) {
    try {
      if (!raw.hasPriceLimits?.()) await observe(services.Item.requestMarketData(raw));
      const l = raw.getPriceLimits?.();
      return l && l.maximum > 0 ? { min: Number(l.minimum), max: Number(l.maximum) } : null;
    } catch {
      return null;
    }
  }

  // Mise en vente 1 h, prix borné à la fourchette EA, enchère de départ un palier en dessous ; renvoie aussi le prix retenu
  async function listItem(raw, buyNow) {
    let sell = buyNow;
    const lim = await priceLimits(raw);
    if (lim) sell = Math.min(Math.max(sell, lim.min), lim.max);
    let start = tickDown(sell);
    if (lim && start < lim.min) start = lim.min;
    if (start >= sell) start = priceDown(sell);
    const r = await observe(services.Item.list(raw, start, sell, 3600));
    return { ...r, price: sell };
  }

  const keepInClub = (raw) => observe(services.Item.move(raw, ItemPile.CLUB));

  function pileFull() {
    try {
      return !!repositories.Item.isPileFull(ItemPile.TRANSFER);
    } catch {
      return false;
    }
  }

  // Statut Galerie par definitionId, même requête que FST : GET /ut/game/<jeu>/defid?type=player&defId=…
  function requestDefIds(ids) {
    return new Promise((resolve) => {
      const Req = window.UTHttpRequest;
      const queue = window.services?.UTUtasRequestQueue;
      const dao = window.services?.Item?.itemDao;
      if (!Req || !queue || !dao) return resolve({ success: false, status: -1, error: 'requête Galerie indisponible dans cette version de la Web App' });
      const game = typeof window.GAME_NAME === 'string' && window.GAME_NAME ? window.GAME_NAME : `fc${String(window.fut_year || '2027').slice(-2)}`;
      try {
        const req = new Req(dao.authDelegate);
        req.setPath(`/ut/game/${game}/defid`);
        req.setUrlVariables({ count: DEFID_CHUNK, sort: 'desc', start: 0, type: 'player', defId: ids });
        const tag = {};
        const timer = setTimeout(() => resolve({ success: false, status: 0, error: 'pas de réponse EA en 20 s' }), 2e4);
        queue.send(req).observe(tag, (obs, r) => {
          clearTimeout(timer);
          obs.unobserve?.(tag);
          resolve(r?.success && Array.isArray(r.response?.itemData) ? { success: true, items: r.response.itemData } : { success: false, status: Number(r?.status ?? 0), error: r?.error });
        });
      } catch (err) {
        resolve({ success: false, status: -1, error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  // Même requête que la Web App (POST auctionhouse), pour une carte que la Web App n'a pas chargée
  function listById(id, buyNow) {
    return new Promise((resolve) => {
      if (!eaApi.base || !Object.keys(eaApi.headers).length) return resolve({ success: false, status: -1, error: 'session EA pas encore vue : ouvre la liste de transferts puis relance' });
      const x = new XMLHttpRequest();
      x.open('POST', `${eaApi.base}auctionhouse`);
      for (const [k, v] of Object.entries(eaApi.headers)) x.setRequestHeader(k, v);
      x.setRequestHeader('Content-Type', 'application/json');
      x.onload = () => resolve({ success: x.status >= 200 && x.status < 300, status: x.status, error: x.status >= 300 ? String(x.responseText || '').slice(0, 200) : undefined });
      x.onerror = () => resolve({ success: false, status: 0, error: 'réseau' });
      x.send(JSON.stringify({ itemData: { id: Number(id) }, startingBid: priceDown(buyNow), duration: 3600, buyNowPrice: buyNow }));
    });
  }

  // Cartes de la liste de transferts (objets Web App nécessaires pour remettre en vente) : selon la version,
  // dans data.items, response.items ou le dépôt local de la Web App
  function transferEntities(r) {
    const isItem = (x) => x && typeof x === 'object' && Number(x.id) > 0 && ('definitionId' in x || typeof x.getAuctionData === 'function');
    const lists = [r?.data?.items, r?.response?.items, r?.data?.response?.items];
    try {
      const repo = typeof repositories !== 'undefined' ? repositories.Item : undefined;
      lists.push(repo?.getTransferItems?.(), repo?.transfer?.items, repo?.getPile?.(ItemPile.TRANSFER), repo?.piles?.[ItemPile.TRANSFER]?.items);
    } catch {}
    const out = new Map();
    for (const l of lists) {
      const arr = l instanceof Map ? [...l.values()] : Array.isArray(l) ? l : l && typeof l === 'object' ? Object.values(l) : [];
      for (const x of arr) if (isItem(x) && !out.has(Number(x.id))) out.set(Number(x.id), x);
    }
    return [...out.values()];
  }

  const tradeState = (s, bidV) => (s === 'closed' && bidV > 0 ? 'sold' : s === 'expired' || s === 'closed' ? 'expired' : s === 'active' ? 'active' : 'unlisted');

  async function readTransferPile() {
    try {
      repositories?.Item?.setDirty?.(ItemPile.TRANSFER);
    } catch {}
    const t0 = Date.now();
    const r = await observe(services.Item.requestTransferItems?.());
    const items = transferEntities(r);
    const byId = new Map(items.map((i) => [Number(i.id), i]));
    let pile = lastPile;
    for (let n = 0; n < 10 && !(pile && pile.at >= t0); n++) {
      await sleep(50);
      pile = lastPile;
    }
    if (pile && pile.at >= t0) {
      return {
        success: true,
        fresh: true,
        data: pile.auctions.map((a) => {
          const id = Number(a.itemData?.id);
          const raw = byId.get(id);
          const defId = Number(raw?.definitionId ?? a.itemData?.resourceId ?? 0);
          return { raw, id, defId, type: String(a.itemData?.itemType ?? raw?.type ?? 'player'), name: raw ? staticName(raw) : String(defId || id), state: tradeState(String(a.tradeState ?? ''), Number(a.currentBid ?? 0)), soldPrice: Number(a.currentBid ?? 0), buyNow: Number(a.buyNowPrice ?? 0) };
        }),
      };
    }
    // Données du cache de la Web App (pas de réponse réseau vue) : une annonce « active » sans temps restant est expirée
    return {
      ...r,
      fresh: false,
      data: items.map((i) => {
        const a = i._auction ?? i.getAuctionData?.() ?? {};
        const cur = Number(a.currentBid ?? 0);
        let state = tradeState(String(a.tradeState ?? ''), cur);
        if (state === 'active' && Number(a.expires ?? 1) <= 0) state = 'expired';
        return { raw: i, id: Number(i.id), defId: Number(i.definitionId ?? 0), name: staticName(i), state, soldPrice: cur, buyNow: Number(a.buyNowPrice ?? 0) };
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
    // Captcha : durée réglée, doublée à chaque nouveau blocage dans les 24 h, plafond 2 h
    lock(baseMin) {
      const now = Date.now();
      this.s.lockStreak = now - this.s.lastLockAt < DAY ? this.s.lockStreak + 1 : 0;
      this.s.lastLockAt = now;
      const ms = Math.min(HARD_CAP, baseMin * 6e4 * 2 ** this.s.lockStreak);
      this.s.lockedUntil = ms > 0 ? now + ms : 0;
      this.s.lockKind = 'hard';
      this.persist();
      return ms;
    }
    // Limite de débit : durée réglée, doublée si ça se répète dans les 30 min (plafond 30 min), rythme ralenti selon les réglages
    lockSoft(cfg) {
      const now = Date.now();
      const calm = now - (this.s.lastSoftAt ?? 0) > CALM_MS;
      this.s.softStreak = calm ? 0 : (this.s.softStreak ?? 0) + 1;
      this.s.pace = Math.min(cfg.paceMax, this.pace(cfg) * cfg.paceStep);
      this.s.lastSoftAt = now;
      const ms = Math.min(SOFT_CAP, cfg.softPauseMin * 6e4 * 2 ** this.s.softStreak);
      this.s.lockedUntil = ms > 0 ? now + ms : 0;
      this.s.lockKind = 'soft';
      this.persist();
      return ms;
    }
    pace(cfg) {
      return Date.now() - (this.s.lastSoftAt ?? 0) > cfg.paceResetMin * 6e4 ? 1 : Math.max(1, Math.min(cfg.paceMax, this.s.pace ?? 1));
    }
    paceUntil(cfg) {
      return (this.s.lastSoftAt ?? 0) + cfg.paceResetMin * 6e4;
    }
    resetPace() {
      this.s.pace = 1;
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
      const lockMs = this.s.lockedUntil - Date.now();
      if (lockMs > 0) return { ok: false, locked: true, stop: `${this.lockKind() === 'soft' ? 'Pause limite EA' : 'Pause anti-captcha'} encore ${fmtMin(lockMs)}` };
      const now = Date.now();
      const searches = this.all('searches').filter((t) => now - t < DAY);
      const purchases = this.all('purchases').filter((t) => now - t < DAY);
      const dayWait = (arr, what, max) => {
        const w = Math.max(6e4, arr[arr.length - max] + DAY - now + 5e3);
        return { ok: false, waitMs: w, reason: `Quota journalier ${what} atteint (max ${max}, partagé avec SnipeFC27), reprise dans ${fmtMin(w)}` };
      };
      if (cfg.quotaSearchDay > 0 && searches.length >= cfg.quotaSearchDay) return dayWait(searches, 'de recherches', cfg.quotaSearchDay);
      if (cfg.quotaBuyDay > 0 && purchases.length >= cfg.quotaBuyDay) return dayWait(purchases, "d'achats", cfg.quotaBuyDay);
      const hour = searches.filter((t) => now - t < HOUR);
      if (cfg.quotaSearchHour > 0 && hour.length >= cfg.quotaSearchHour) {
        const w = hour[0] + HOUR - now + 5e3;
        return { ok: false, waitMs: w, reason: `Quota horaire de recherches atteint (max ${cfg.quotaSearchHour}), reprise dans ${fmtMin(w)}` };
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
    [/mis en vente à|relisté à|gardé au club/, 'list'],
    [/prix relevé/, 'warn'],
    [/^Raté |aucune annonce|non trouvé/i, 'miss'],
    [/captcha|Pause limite|Statut EA|Limite EA/i, 'lock'],
    [/erreur|échou|impossible|refusée/i, 'error'],
    [/quota|insuffisants|pleine|relevé|SnipeFC27 tourne|manque/i, 'warn'],
  ];
  const eventType = (msg) => EVENT_RULES.find(([re]) => re.test(msg))?.[1];

  function loadConfig() {
    const raw = load(K_CONFIG, {}) ?? {};
    // v3 : quota horaire désactivé par défaut (l'ancien défaut de 300 était enregistré avec les réglages)
    if (raw.cfgV !== CONFIG_VERSION) delete raw.quotaSearchHour;
    const tol = Number(raw.tolerance);
    const mk = Number(raw.markupPct);
    const cfg = {
      tolerance: Number.isFinite(tol) && tol >= 0 ? Math.min(MAX_TOLERANCE, Math.floor(tol)) : DEFAULT_TOLERANCE,
      toleranceAuto: raw.toleranceAuto !== false,
      afterBuy: AFTER_BUY[raw.afterBuy] ? raw.afterBuy : 'relist',
      markupPct: Number.isFinite(mk) && mk >= 0 ? Math.min(100, mk) : DEFAULT_MARKUP,
      ...SPEED_DEFAULTS,
      ...PACE_DEFAULTS,
      ...QUOTA_DEFAULTS,
      ...PAUSE_DEFAULTS,
      cfgV: CONFIG_VERSION,
    };
    for (const k of Object.keys(SPEED_DEFAULTS)) if (Number.isFinite(raw[k]) && raw[k] >= 0) cfg[k] = raw[k];
    for (const k of Object.keys(PAUSE_DEFAULTS)) if (Number.isFinite(raw[k]) && raw[k] >= 0) cfg[k] = raw[k];
    for (const k of Object.keys(QUOTA_DEFAULTS)) if (Number.isFinite(raw[k]) && raw[k] >= 0) cfg[k] = Math.floor(raw[k]);
    for (const k of Object.keys(PACE_DEFAULTS)) if (Number.isFinite(raw[k]) && raw[k] >= (k === 'paceResetMin' ? 0 : 1)) cfg[k] = raw[k];
    return cfg;
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

  const isDone = (q) => q.status === 'listed' || q.status === 'kept' || q.status === 'bought' || q.status === 'skipped';
  const isFailed = (q) => q.status === 'notfound' || q.status === 'nocoins' || q.status === 'moved';
  // Coût réel d'un achat : prix payé moins le net de la revente (rien de récupéré si la carte n'est pas en vente)
  const costOf = (q) => (q.status === 'listed' ? q.price - netOf(q.sell || q.price) : q.price);
  // Écart max (FST) : Auto = 3 paliers, sinon valeur manuelle
  const tolOf = (cfg) => (cfg.toleranceAuto ? DEFAULT_TOLERANCE : cfg.tolerance);
  // Prix de revente prévu selon le réglage « Après achat »
  const sellFor = (p, cfg) => (cfg.afterBuy === 'keep' ? 0 : cfg.afterBuy === 'markup' ? markupPrice(p, cfg.markupPct) : roundPrice(p));
  const isOpen = (q) => q.status === 'pending' || q.status === 'searching';
  const isUnsold = (b) => b.state === 'expired' || b.state === 'unlisted';
  const EMPTY_TOTAL = { bought: 0, spent: 0, sold: 0, received: 0, tax: 0, lost: 0, kept: 0, keptSpent: 0 };

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
    itemData = new Map(); // defId -> itemData EA (/defid), pour afficher les cartes
    snipeState = null;
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
        pace: this.guard.pace(this.getConfig()),
        paceUntil: this.guard.paceUntil(this.getConfig()),
        resumeAt: this.resumeAt,
        version: this.version,
        lastEventId: this.eventSeq,
        waitUntil: this.waitUntil,
        waitLabel: this.waitLabel,
        snipe: this.snipeState,
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

    // Sélection dédoublonnée entre sets, avec projection selon « Après achat » (revente : coût = taxe 5 % ; club : coût = prix payé)
    picks(defIds) {
      const cfg = this.getConfig();
      const list = [];
      const unpriced = [];
      for (const id of defIds ?? Object.keys(this.selection)) {
        if (!this.isSelected(id)) continue;
        const p = this.findPlayer(id);
        if (!p || this.refreshCollected(p).collected) continue;
        const v = this.selection[id];
        const start = Number(v) >= 150 ? Math.floor(Number(v)) : 0;
        if (!start) {
          unpriced.push(p);
          continue;
        }
        list.push({ p, start, cap: tolCap(start, tolOf(cfg)) });
      }
      const sum = (f) => list.reduce((s, x) => s + f(x), 0);
      const back = (price) => (cfg.afterBuy === 'keep' ? 0 : netOf(sellFor(price, cfg)));
      return {
        list,
        unpriced,
        count: list.length + unpriced.length,
        spend: sum((x) => x.start),
        capSpend: sum((x) => x.cap),
        back: sum((x) => back(x.start)),
        cost: sum((x) => x.start - back(x.start)),
        capCost: sum((x) => x.cap - back(x.cap)),
      };
    }

    // Joueurs cochés encore manquants, dans l'ordre du panneau (un joueur présent dans plusieurs sets compte dans le premier)
    selectedPlayers() {
      const seen = new Set();
      const out = [];
      for (const s of this.setList())
        for (const p of this.setPlayers(s)) {
          if (p.collected || seen.has(p.defId) || !this.isSelected(p.defId)) continue;
          seen.add(p.defId);
          out.push({ p, set: s });
        }
      return out;
    }

    // Statut Galerie lu chez EA (requête /defid, comme FST) : collectés, rareté et note de chaque joueur des sets
    // maxAgeMs : lecture complète récente réutilisée (limite les requêtes EA lors des reprises automatiques)
    async syncGallery(keys, maxAgeMs = 0) {
      if (!keys && maxAgeMs && Date.now() - (this.gallerySyncAt ?? 0) < maxAgeMs) return true;
      const sets = (keys ?? Object.keys(this.sets)).map((k) => this.sets[k]).filter(Boolean);
      const byId = new Map();
      for (const s of sets) for (const p of Object.values(s.players ?? {})) byId.set(p.defId, [...(byId.get(p.defId) ?? []), p]);
      const ids = [...byId.keys()];
      if (!ids.length) return true;
      const seen = new Set();
      const got = new Set();
      const lost = new Set();
      for (let i = 0; i < ids.length; i += DEFID_CHUNK) {
        const r = await requestDefIds(ids.slice(i, i + DEFID_CHUNK));
        if (!r.success) {
          if (!this.fatal(r, 'defid')) this.log(`Lecture de la Galerie EA impossible (statut ${r.status})${errText(r.error)} : statut « collecté » non vérifié`, 'warn');
          return false;
        }
        for (const it of r.items) {
          const defId = Number(it.resourceId || it.assetId || it.id);
          if (byId.has(defId)) this.itemData.set(defId, it);
          for (const p of byId.get(defId) ?? []) {
            seen.add(defId);
            if (Number.isFinite(Number(it.rareflag))) p.rareflag = Number(it.rareflag);
            if (!p.rating && Number(it.rating)) p.rating = Number(it.rating);
            if (typeof it.isCollected !== 'boolean') continue;
            netItems.set(defId, { collected: it.isCollected });
            if (it.isCollected) {
              if (!p.collected) got.add(defId);
              p.collected = true;
            } else if (p.collected) {
              if (this.done.has(defId)) lost.add(p.name);
              p.collected = false;
            }
          }
          if (it.isCollected === false) this.done.delete(defId);
          if (it.isCollected === true && this.isSelected(defId)) this.setSelected(defId, false);
        }
      }
      save(K_DONE, [...this.done]);
      for (const s of sets) s.syncedAt = Date.now();
      this.saveSets();
      if (!keys) this.gallerySyncAt = Date.now();
      this.log(`Galerie EA lue : ${seen.size} joueur(s) vérifié(s)${got.size ? `, ${got.size} nouvellement collecté(s)` : ''}`);
      const names = [...lost];
      if (names.length) this.log(`Achetés mais absents de la Galerie selon EA : ${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''} (de nouveau manquants)`, 'warn');
      this.emit();
      return true;
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
          rareflag: this.findPlayer(defId)?.rareflag ?? null,
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
      const cfg = this.getConfig();
      this.stopRequested = true;
      this.wake?.();
      const ms = soft ? this.guard.lockSoft(cfg) : this.guard.lock(cfg.captchaPauseMin);
      if (mode) {
        save(K_LOCK_RESUME, { mode });
        this.scheduleResume();
      }
      if (ms <= 0) {
        // Aucune pause réglée : reprise après le délai normal entre recherches
        const pace = this.guard.pace(cfg);
        this.log(`${msg} : pas de pause${pace > 1 ? `, rythme ralenti ×${pace.toFixed(1).replace('.', ',')}` : ''}${mode ? ', reprise immédiate' : ''}${soft ? '' : '. Si EA affiche un captcha, le résoudre dans la Web App : le process continue seul ensuite'}`, 'lock');
        if (!soft && Date.now() - (this.captchaNotifiedAt ?? 0) > 10 * 6e4) {
          this.captchaNotifiedAt = Date.now();
          this.notify('AlbumFC27 : captcha EA', `${msg}. Résous le captcha dans la Web App, le process reprend seul.`);
        }
        return;
      }
      if (soft) {
        const pace = this.guard.pace(this.getConfig());
        this.log(`${msg} : pause de ${fmtMin(ms)}${pace > 1 ? `, rythme ralenti ×${pace.toFixed(1).replace('.', ',')}` : ''}${mode ? ', reprise automatique' : ''}`, 'lock');
        return;
      }
      this.log(`${msg} : pause de ${fmtMin(ms)}${mode ? ', reprise automatique ensuite' : ''}. Si EA affiche un captcha, le résoudre dans la Web App.`, 'lock');
      this.notify('AlbumFC27 : pause anti-captcha', `${msg}. Reprise vers ${clock(ms)}. Si EA affiche un captcha, résous-le dans la Web App.`);
    }
    scheduleResume() {
      if (!load(K_LOCK_RESUME, null)) return;
      clearTimeout(this.resumeTimer);
      const locked = this.guard.lockedUntil() > Date.now();
      const wait = locked ? Math.max(5e3, this.guard.lockedUntil() - Date.now() + (this.guard.lockKind() === 'soft' ? rand(5e3, 2e4) : rand(3e4, 9e4))) : this.delay();
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
      // Tâche interrompue encore en train de se terminer : nouvel essai dans 1 s
      if (this.running) return void (this.resumeTimer = setTimeout(() => void this.autoResume(), 1e3));
      save(K_LOCK_RESUME, null);
      this.log('Reprise automatique');
      if (intent.mode === 'buy' && this.queue.some(isOpen)) await this.runQueue();
      else if (intent.mode === 'relist') await this.relist();
      else if (intent.mode === 'check') await this.checkPrices(true);
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
        const g = this.guard.check(this.getConfig());
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
      const g = this.guard.check(this.getConfig());
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
      const c = this.getConfig();
      return rand(c.minDelayMs, c.maxDelayMs) * this.guard.pace(c);
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

    // --- Recherche marché d'un joueur : annonces de cette carte exacte, triées par prix ---
    // anyCollected : ne pas s'arrêter sur une carte déjà collectée (relist d'une carte possédée)
    async search(defId, { anyCollected = false, ...opts } = {}) {
      if (this.stopRequested || !(await this.waitGuard())) return { stop: true };
      const res = await searchMarket(defId, { ...opts, minBid: this.nonce++ % 2 ? 150 : 0 });
      this.guard.record('searches');
      if (!res.success) return this.fatal(res, 'search') ? { stop: true } : { error: res.status || -1 };
      const mine = res.data.filter((x) => x.defId === defId);
      if (!anyCollected && mine.some((x) => x.collected)) return { collected: true };
      return { items: mine.filter((x) => x.buyNow > 0).sort((x, y) => x.buyNow - y.buyNow), full: res.data.length >= PAGE_FULL };
    }

    // Prix de référence (méthode FST) : 4e annonce la moins chère parmi celles publiées depuis plus d'une minute.
    // Page pleine : recherche dichotomique sous ce prix (10 recherches max) tant qu'au moins 4 annonces restent.
    // lowest = annonce la moins chère vue (prix de revente au relist)
    async checkPrice(p, { anyCollected = false } = {}) {
      const floor = minPriceFor(p.rareflag, p.rating);
      const seen = [];
      let n = 0;
      const look = async (max) => {
        if (n++) await this.sleep(this.delay(), `Sondage du prix de ${p.name}`);
        const r = await this.search(p.defId, { maxBuy: max, anyCollected });
        if (r.items) {
          r.prices = r.items.filter((x) => settled(x.sr)).map((x) => x.buyNow);
          seen.push(...r.prices);
        }
        return r;
      };
      const done = (price) => ({ price, lowest: seen.length ? Math.min(...seen, price || Infinity) : price, searches: n });
      let r = await look(0);
      if (!r.items) return { ...r, searches: n };
      if (!r.full) return done(r.prices.length >= 4 ? r.prices[3] : (r.prices[r.prices.length - 1] ?? 0));
      let top = r.prices.length >= 4 ? r.prices[3] : Math.max(...r.items.map((x) => x.buyNow));
      let low = 0;
      for (let i = 0; i < 10; i++) {
        const c = Math.max(low ? roundPrice((top + low) / 2) : roundPrice(0.9 * top), floor);
        if (c >= top || (low && c <= low)) break;
        r = await look(c);
        if (r.stop || r.collected) return { ...r, searches: n };
        if (!r.items) break;
        if (r.prices.length >= 4) {
          top = r.prices[3];
          if (!r.full) break;
        } else low = c;
      }
      return done(top);
    }

    // Annonce la moins chère actuelle (information quand le prix dépasse la tolérance)
    async peek(defId) {
      await this.sleep(this.delay(), 'Relevé du prix actuel');
      const r = await this.search(defId, {});
      return r.items?.[0]?.buyNow ?? null;
    }

    // --- Vérifier les prix : sondage des joueurs cochés, le prix trouvé devient le prix de départ (FST) ---

    // ids : joueurs de la fenêtre d'achat (sinon tous les joueurs cochés)
    async checkPrices(resume = false, ids) {
      this.checkedAt ??= {};
      const only = ids ? new Set(ids.map(Number)) : null;
      const list = this.selectedPlayers().filter(({ p }) => (!only || only.has(p.defId)) && (!resume || Date.now() - (this.checkedAt[p.defId] ?? 0) > 15 * 6e4));
      if (!list.length) return this.log(resume ? 'Vérification des prix : tous les joueurs cochés ont été vérifiés' : 'Aucun joueur coché');
      if (!(await this.enter('check'))) return;
      let ok = 0;
      let none = 0;
      try {
        this.log(`Vérification du prix de ${list.length} joueur(s) sur le marché (4e annonce la moins chère)`);
        for (const [i, { p }] of list.entries()) {
          if (this.stopRequested) break;
          if (i) await this.sleep(this.delay(), 'Joueur suivant');
          if (this.stopRequested) break;
          this.activity(`${p.name} : sondage du prix`);
          const c = await this.checkPrice(p);
          if (c.stop) break;
          if (c.collected) {
            this.markCollected(p.defId);
            this.setSelected(p.defId, false);
            this.feed(`${p.name} : déjà dans la Galerie, décoché`);
            continue;
          }
          if (c.error) {
            this.feed(`${p.name} : sondage en échec (statut ${c.error})`, 'error');
            continue;
          }
          if (!c.price) {
            none++;
            this.feed(`${p.name} : aucune annonce sur le marché`, 'miss');
            continue;
          }
          const old = Number(this.selection[p.defId]) || 0;
          this.setSelected(p.defId, true, c.price);
          this.checkedAt[p.defId] = Date.now();
          ok++;
          this.touch();
          this.feed(`${p.name} : prix du marché ${fmtNum(c.price)}${old && old !== c.price ? ` (était ${fmtNum(old)})` : ''}`);
        }
        if (!this.stopRequested) this.log(`Prix vérifiés : ${ok}/${list.length}${none ? `, ${none} sans annonce` : ''}`);
      } catch (err) {
        this.log(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.leave();
      }
    }

    // --- Achat (méthode FST) : recherche au prix de départ, hausse d'un palier si rien, tolérance en paliers ---

    // defIds : joueurs de la fenêtre d'achat (sinon tous les joueurs cochés)
    async validate(defIds) {
      if (this.running) return;
      const tol = tolOf(this.getConfig());
      const only = defIds ? new Set(defIds.map(Number)) : null;
      const queue = this.selectedPlayers().filter(({ p }) => !only || only.has(p.defId)).map(({ p, set }) => {
        const v = Number(this.selection[p.defId]);
        const start = v >= 150 ? Math.floor(v) : 0;
        return { defId: p.defId, name: p.name, rating: p.rating, rareflag: p.rareflag ?? null, set: set.name, start, max: start, cap: tolCap(start, tol), status: 'pending', searches: 0, price: 0, sell: 0 };
      });
      if (!queue.length) return this.log('Aucun joueur coché');
      this.queue = queue;
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
      const cfg = this.getConfig();
      for (const e of this.queue) if (isOpen(e) && e.start) e.cap = tolCap(e.start, tolOf(cfg));
      const after = cfg.afterBuy === 'keep' ? 'gardés au club' : cfg.afterBuy === 'markup' ? `revendus avec +${cfg.markupPct} %` : "revendus au prix d'achat";
      this.log(`Achat de ${n} joueur(s), écart max ${tolOf(cfg)} palier(s) EA au-dessus du prix de départ, ${after}`);
      try {
        // Statut Galerie relu chez EA avant d'acheter : les joueurs déjà collectés sont sautés
        if (await this.syncGallery(undefined, 5 * 6e4)) {
          for (const e of this.queue) {
            if (isOpen(e) && this.findPlayer(e.defId)?.collected) {
              e.status = 'skipped';
              this.feed(`${e.name} : déjà dans la Galerie, ignoré`);
            }
          }
          this.saveQueue();
        }
        await this.syncPile();
        let curSet = null;
        for (const e of this.queue) {
          if (this.stopRequested) break;
          if (e.status === 'searching') e.status = 'pending';
          if (e.status !== 'pending') continue;
          if (e.set !== curSet) {
            if (curSet !== null) this.setSummary(curSet);
            curSet = e.set;
            const inSet = this.queue.filter((x) => x.set === curSet);
            this.log(`Set « ${curSet} » : ${inSet.filter(isOpen).length} joueur(s) à acheter`);
          }
          await this.buyOne(e);
          this.saveQueue();
          if (this.queue.some(isOpen)) await this.sleep(this.delay(), e.set === this.queue.find(isOpen)?.set ? 'Joueur suivant' : 'Set suivant');
        }
        if (curSet !== null && !this.stopRequested) this.setSummary(curSet);
        if (!this.stopRequested) {
          save(K_ACTIVE, false);
          const got = this.queue.filter((q) => q.price > 0);
          const spent = got.reduce((s, q) => s + q.price, 0);
          const cost = got.reduce((s, q) => s + costOf(q), 0);
          const fail = this.queue.filter(isFailed).length;
          this.log(`Achats terminés : ${got.length}/${n} achetés, ${fmtNum(spent)} dépensés, coût réel ~${fmtNum(cost)}${fail ? `. ${fail} non acheté(s), toujours coché(s) : relance possible` : ''}`, 'buy');
          this.notify('AlbumFC27 : achats terminés', `${got.length}/${n} achetés, coût réel ~${fmtNum(cost)} crédits${fail ? `, ${fail} non acheté(s)` : ''}.`);
        }
      } catch (err) {
        this.log(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        for (const e of this.queue) if (e.status === 'searching') e.status = 'pending';
        save(K_QUEUE, this.queue);
        this.leave();
      }
    }

    setSummary(name) {
      const inSet = this.queue.filter((x) => x.set === name);
      const got = inSet.filter((x) => x.price > 0);
      const fail = inSet.filter(isFailed).length;
      this.log(`Set « ${name} » terminé : ${got.length}/${inSet.length} achetés, ${fmtNum(got.reduce((t, x) => t + x.price, 0))} dépensés${fail ? `, ${fail} non acheté(s)` : ''}`, 'buy');
    }

    giveUp(e, status, why) {
      e.status = status;
      e.note = why;
      this.feed(`${e.name} : ${why}`, 'miss');
    }

    skipCollected(e) {
      e.status = 'skipped';
      this.markCollected(e.defId);
      this.setSelected(e.defId, false);
      this.feed(`${e.name} : déjà dans la Galerie, ignoré`);
    }

    // Crédits suffisants pour price, après relecture du solde si besoin
    async affordable(price) {
      const c = coins();
      return c === null || c >= price || (await refreshCoins()) >= price;
    }

    async buyOne(e) {
      if (!e.start) {
        // Sans prix de départ : prix de référence trouvé par sondage
        e.status = 'searching';
        this.activity(`${e.name} : sondage du prix`);
        const c = await this.checkPrice(e);
        e.searches += c.searches ?? 0;
        if (c.stop) return;
        if (c.collected) return this.skipCollected(e);
        if (c.error) return this.giveUp(e, 'notfound', `sondage en échec (statut ${c.error})`);
        if (!c.price) return this.giveUp(e, 'notfound', 'aucune annonce sur le marché');
        e.start = e.max = c.price;
        e.cap = tolCap(c.price, tolOf(this.getConfig()));
        this.feed(`${e.name} : prix du marché ${fmtNum(c.price)} (4e annonce la moins chère)`);
        await this.sleep(this.delay(), `Achat de ${e.name}`);
      }
      let fails = 0;
      let minBuy = 0;
      for (let n = 0; n < BUY_SEARCHES; n++) {
        if (this.stopRequested) return;
        if (n) await this.sleep(this.delay(), `Nouvelle recherche pour ${e.name}`);
        if (this.stopRequested) return;
        if (e.max > e.cap) {
          const seen = await this.peek(e.defId);
          if (this.stopRequested) return;
          e.seen = seen;
          return this.giveUp(e, 'moved', `prix au-delà de la tolérance (${fmtNum(e.cap)})${seen ? `, annonce la moins chère ${fmtNum(seen)}` : ''} : modifier le prix pour réessayer`);
        }
        if (!(await this.affordable(150))) return this.giveUp(e, 'nocoins', `crédits insuffisants (${fmtNum(coins())})`);
        e.status = 'searching';
        this.activity(`${e.name} : recherche ≤ ${fmtNum(e.max)}${e.max > e.start ? ` (relevé, tolérance ${fmtNum(e.cap)})` : ''}`);
        const r = await this.search(e.defId, { minBuy, maxBuy: e.max });
        e.searches++;
        if (r.stop) return;
        if (r.collected) return this.skipCollected(e);
        if (r.error) {
          this.feed(`${e.name} : recherche en échec (statut ${r.error})`, 'error');
          continue;
        }
        const cands = r.items.slice(0, 2);
        if (!cands.length) {
          const prev = e.max;
          e.max = tickUp(e.max);
          this.feed(`${e.name} : aucune annonce ≤ ${fmtNum(prev)}, prix relevé à ${fmtNum(e.max)}${e.max > e.cap ? ' (tolérance dépassée)' : ''}`);
          continue;
        }
        for (const it of cands) {
          if (!(await this.affordable(it.buyNow))) return this.giveUp(e, 'nocoins', `crédits insuffisants pour ${fmtNum(it.buyNow)} (${fmtNum(coins())} disponibles)`);
          const res = await this.buyAndList(it, e);
          if (res === 'stop' || res === 'ok') return;
          fails++;
          await sleep(rand(900, 1500));
        }
        if (fails >= MAX_COMPETITION) return this.giveUp(e, 'notfound', `${fails} achats ratés (concurrence)`);
        // Deux achats ratés : fenêtre de prix décalée d'un palier
        if (fails % 2 === 0) {
          minBuy = e.max;
          e.max = tickUp(e.max);
        }
      }
      if (!this.stopRequested) this.giveUp(e, 'notfound', `non trouvé ≤ ${fmtNum(e.max)} après ${BUY_SEARCHES} recherches`);
    }

    // « Racheter les sautés au prix vu » (FST) : prix de départ = annonce la moins chère relevée
    async retrySkipped() {
      if (this.running) return;
      const tol = tolOf(this.getConfig());
      let n = 0;
      for (const e of this.queue) {
        if (e.status !== 'moved' || !(e.seen > 0)) continue;
        e.start = e.max = e.seen;
        e.cap = tolCap(e.seen, tol);
        e.status = 'pending';
        e.note = '';
        e.seen = 0;
        this.setSelected(e.defId, true, e.start);
        n++;
      }
      if (!n) return this.log('Aucun joueur sauté à racheter');
      save(K_QUEUE, this.queue);
      this.touch();
      await this.runQueue();
    }

    // Quick snipe (FST) : prix du marché, puis recherches rapides pendant 4 min sous (prix × 0,95 − 300), arrêt au premier achat, mise en vente au prix du marché
    async snipe(defId) {
      const p = this.findPlayer(defId);
      if (!p || this.refreshCollected(p).collected) return;
      if (!(await this.enter('snipe'))) return;
      const st = (this.snipeState = { defId: p.defId, name: p.name, phase: 'price', until: 0, maxBuy: 0, sell: 0, searches: 0 });
      const e = { defId: p.defId, name: p.name, rating: p.rating, rareflag: p.rareflag ?? null, set: '', start: 0, max: 0, cap: 0, status: 'searching', searches: 0, price: 0, sell: 0 };
      let bought = false;
      try {
        this.log(`Quick snipe ${p.name} : vérification du prix du marché`);
        this.activity(`Quick snipe ${p.name} : prix du marché`);
        const c = await this.checkPrice(p);
        if (c.stop) return;
        if (c.collected) return this.skipCollected(e);
        if (!c.price) return this.log(`Quick snipe ${p.name} : ${c.error ? `sondage en échec (statut ${c.error})` : 'aucune annonce sur le marché'}`, 'miss');
        const maxBuy = roundDown(netOf(c.price) - SNIPE_PROFIT);
        if (maxBuy < 150) return this.log(`Quick snipe ${p.name} : marché ${fmtNum(c.price)}, pas de marge possible (profit minimum ${SNIPE_PROFIT})`, 'miss');
        Object.assign(st, { phase: 'run', until: Date.now() + SNIPE_MS, maxBuy, sell: c.price });
        this.log(`Quick snipe ${p.name} : achat ≤ ${fmtNum(maxBuy)}, revente ${fmtNum(c.price)} (profit ${SNIPE_PROFIT}+), 4 min`);
        const seen = new Set();
        let minBuy = 0;
        let steps = 0;
        while (!this.stopRequested && Date.now() < st.until) {
          await this.sleep(rand(...SNIPE_DELAY) * this.guard.pace(this.getConfig()), `Quick snipe ${p.name}`);
          if (this.stopRequested || Date.now() >= st.until) break;
          // Prix min relevé d'un palier à chaque recherche (cache EA), remis à zéro après 10 paliers
          if (++steps > SNIPE_MIN_STEPS || tickUp(minBuy || 150) >= maxBuy) (minBuy = 0), (steps = 0);
          else minBuy = minBuy ? tickUp(minBuy) : 150;
          this.activity(`Quick snipe ${p.name} : recherche ≤ ${fmtNum(maxBuy)}`);
          const r = await this.search(p.defId, { minBuy, maxBuy });
          st.searches++;
          if (r.stop) return;
          if (r.collected) return this.skipCollected(e);
          if (r.error) continue;
          const cands = r.items.filter((x) => x.buyNow <= maxBuy && !seen.has(x.tradeId));
          for (const x of r.items) seen.add(x.tradeId);
          for (const it of cands.slice(0, 2)) {
            if (!(await this.affordable(it.buyNow))) return this.log(`Quick snipe ${p.name} : crédits insuffisants pour ${fmtNum(it.buyNow)}`, 'miss');
            const res = await this.buyAndList(it, e, st.sell);
            if (res === 'stop') return;
            if (res === 'ok') return void (bought = true);
          }
        }
      } catch (err) {
        this.log(`Quick snipe : ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (!bought && !this.stopRequested && st.phase === 'run') this.log(`Quick snipe ${p.name} terminé sans achat (${st.searches} recherches)`, 'miss');
        if (bought) this.log(`Quick snipe ${p.name} : acheté à ${fmtNum(e.price)}${e.sell ? `, en vente à ${fmtNum(e.sell)}` : ''}`, 'buy');
        this.snipeState = null;
        this.leave();
      }
    }

    markCollected(defId) {
      this.done.add(defId);
      save(K_DONE, [...this.done]);
      for (const s of Object.values(this.sets)) if (s.players?.[defId]) s.players[defId].collected = true;
      this.saveSets();
    }

    // listAt : prix de mise en vente imposé (Quick snipe), quel que soit « Après achat »
    async buyAndList(it, e, listAt = 0) {
      const cfg = this.getConfig();
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
      const price = it.buyNow;
      e.price = price;
      e.status = 'bought';
      this.markCollected(e.defId);
      this.setSelected(e.defId, false);
      this.addTotal('bought', 1);
      this.addTotal('spent', price);
      this.log(`Acheté ${name} à ${fmtNum(price)}${e.set ? ` (${e.set})` : ''}`);
      // Après achat (même si un arrêt est demandé) : club, ou mise en vente ; liste pleine ou échec = club (FST)
      await sleep(rand(1200, 1350));
      const keep = async (why) => {
        const m = await keepInClub(it.raw);
        if (m.success) {
          e.status = 'kept';
          this.addTotal('kept', 1);
          this.addTotal('keptSpent', price);
        }
        this.feed(`${name} ${m.success ? 'gardé au club' : 'laissé dans les non-assignés (déplacement au club échoué)'}${why ? ` : ${why}` : ''}`);
      };
      const keepMode = !listAt && cfg.afterBuy === 'keep';
      if (keepMode || this.pileCount >= PILE_MAX || pileFull()) {
        await keep(keepMode ? '' : 'liste de transferts pleine');
        return 'ok';
      }
      const l = await listItem(it.raw, listAt || sellFor(price, cfg));
      if (!l.success) {
        if (this.fatal(l, 'list')) return 'stop';
        await keep(`mise en vente échouée (statut ${l.status})${errText(l.error)}`);
        if (++this.listFails >= MAX_LIST_FAILS) {
          this.stop(`${this.listFails} mises en vente échouées d'affilée, arrêt`);
          return 'stop';
        }
        return 'ok';
      }
      this.listFails = 0;
      this.pileCount++;
      e.status = 'listed';
      e.sell = l.price;
      const id = Number(it.raw?.id);
      if (id) {
        this.bought[id] = { price, sell: l.price, defId: e.defId, name, state: 'active', at: Date.now() };
        this.saveBought();
      }
      const loss = price - netOf(l.price);
      this.feed(`${name} mis en vente à ${fmtNum(l.price)} (${loss >= 0 ? `coût ${fmtNum(loss)}` : `gain ${fmtNum(-loss)}`})`);
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
      for (const i of pile.data) if (!i.raw || /^\d+$/.test(i.name)) i.name = this.bought[i.id]?.name || this.findPlayer(i.defId)?.name || i.name;
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
      this.pileFresh = pile.fresh !== false;
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

    async relistAll(n, why) {
      await sleep(rand(800, 1600));
      const g = await observe(services.Item.relistExpiredAuctions?.());
      if (g.success) {
        this.log(`${n} invendu(s) remis en vente en bloc à leur prix précédent (${why})`, 'list');
        for (const b of Object.values(this.bought)) if (isUnsold(b)) b.state = 'active';
        this.saveBought();
      } else if (!this.fatal(g, 'list')) this.log(`Remise en vente en bloc échouée (statut ${g.status})${errText(g.error)}`, 'error');
    }

    async relist() {
      if (!(await this.enter('relist'))) return;
      try {
        const items = await this.syncPile();
        if (!items) return;
        const players = items.filter((i) => (i.type ?? i.raw?.type ?? 'player') === 'player');
        const active = players.filter((i) => i.state === 'active').length;
        const todo = players.filter((i) => i.state !== 'active');
        const direct = todo.filter((i) => !i.raw).length;
        this.log(`Liste de transferts : ${active} en vente, ${todo.length} invendu(s)${direct ? ` (${direct} remis en vente par requête directe, carte non chargée par la Web App)` : ''}${this.pileFresh ? '' : ' (lue depuis le cache de la Web App : si des invendus manquent, ouvre Transferts > Liste de transferts puis relance)'}`);
        if (!todo.length) {
          this.log(active ? `Aucun invendu. Les ${active} joueur(s) en vente ne peuvent pas être modifiés (règle EA) : relistables à leur expiration (1 h)` : 'Aucun invendu à relister');
          return;
        }
        this.log(`Relister ${todo.length} invendu(s) au prix de l'annonce la moins chère`);
        let ok = 0;
        let failed = 0;
        let diff = 0;
        for (const [n, i] of todo.entries()) {
          if (this.stopRequested) break;
          if (n) await this.sleep(this.delay(), 'Invendu suivant');
          if (this.stopRequested) break;
          const b = this.bought[i.id];
          const defId = b?.defId || i.defId;
          const cur = i.buyNow || b?.sell || b?.price || 0;
          this.activity(`${i.name} : sondage du prix${cur ? ` (était à ${fmtNum(cur)})` : ''}`);
          const ref = this.findPlayer(defId);
          const r = defId ? await this.checkPrice({ defId, name: i.name, rating: ref?.rating || i.raw?._rating || i.raw?.rating || 0, rareflag: ref?.rareflag ?? i.raw?.rareflag ?? i.raw?._rareflag ?? 0 }, { anyCollected: true }) : { lowest: 0 };
          if (r.stop) break;
          const price = r.lowest >= 150 ? r.lowest : cur;
          if (!(price >= 150)) {
            failed++;
            this.feed(`${i.name} : aucune annonce sur le marché et pas de prix précédent, laissé tel quel`, 'miss');
            continue;
          }
          await sleep(rand(500, 1200));
          const l = i.raw ? await listItem(i.raw, price) : { ...(await listById(i.id, price)), price };
          if (!l.success) {
            if (this.fatal(l, 'list')) break;
            failed++;
            this.feed(`Remise en vente de ${i.name} à ${fmtNum(price)} échouée (statut ${l.status})${errText(l.error)}`, 'error');
            continue;
          }
          ok++;
          const listed = l.price || price;
          if (cur) diff += listed - cur;
          const why = r.lowest ? `annonce la moins chère ${fmtNum(r.lowest)}${listed !== price ? `, borné à la fourchette EA` : ''}` : 'aucune autre annonce, prix inchangé';
          if (b) {
            b.sell = listed;
            b.state = 'active';
            this.saveBought();
            const loss = b.price - netOf(listed);
            this.feed(`${i.name} relisté à ${fmtNum(listed)} (${why}, ${loss >= 0 ? `perte si vendu ${fmtNum(loss)}` : `gain si vendu ${fmtNum(-loss)}`})`);
          } else this.feed(`${i.name} relisté à ${fmtNum(listed)} (${why})`);
        }
        // Secours : invendus qui n'ont pas pu être relistés au prix du marché, remis en vente en bloc à leur prix précédent
        if (failed && !this.stopRequested) await this.relistAll(failed, 'échec de la remise en vente au prix du marché');
        try {
          repositories?.Item?.setDirty?.(ItemPile.TRANSFER);
        } catch {}
        if (this.pile && ok) {
          this.pile = { ...this.pile, active: this.pile.active + ok, unsold: Math.max(0, this.pile.unsold - ok) };
          save(K_PILE, this.pile);
        }
        if (!this.stopRequested) this.log(`Relister terminé : ${ok}/${todo.length} remis en vente au prix du marché${diff ? `, prix ${diff < 0 ? 'baissés' : 'montés'} de ${fmtNum(Math.abs(diff))} au total` : ''}. Perte en attente ${fmtNum(this.pendingLoss())}`, 'list');
      } catch (err) {
        this.log(`Relister : ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.leave();
      }
    }
  }

  // ---------- Interface : calque Galerie façon FUT Simple Trader ----------
  // Calque dans le DOM de la page (pas de shadow DOM) : les cartes sont rendues par la Web App avec ses propres styles.
  // Toutes les règles sont préfixées par #afc-root pour ne pas toucher la Web App.

  const PAGE_CARDS = 36;
  const CSS = `
#afc-root { --ac: #00CAF6; --bg: #10151d; --panel: #161d27; --line: rgba(255,255,255,.07); --dim: #949db0; --ink: #fff; --ok: #3ddc84; --ko: #ff6b6b; --warn: #ffb347;
  font: 14px/1.5 Roboto, Arial, sans-serif; color: #dfe4ec; }
#afc-root * { box-sizing: border-box; }
#afc-root .a-launch { position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; display: flex; align-items: center; gap: 8px; max-width: 360px;
  padding: 8px 14px; border-radius: 999px; background: #1f2834; border: 1px solid rgba(255,255,255,.12); color: #fff; font: 600 13px/1.2 Roboto, Arial, sans-serif;
  box-shadow: 0 8px 24px rgba(0,0,0,.45); cursor: pointer; }
#afc-root .a-launch:hover { border-color: var(--ac); }
#afc-root .a-launch small { font-weight: 400; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#afc-root .a-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #5c6170; }
#afc-root .a-dot.on { background: var(--ok); animation: afc-pulse 1.2s ease-in-out infinite; }
#afc-root .a-dot.lock { background: var(--warn); }
@keyframes afc-pulse { 50% { opacity: .3; } }
#afc-root .a-layer { position: fixed; inset: 0; z-index: 2147483001; display: flex; align-items: center; justify-content: center; background: rgba(12,15,20,.7);
  visibility: hidden; opacity: 0; transition: opacity .25s, visibility .25s; }
#afc-root .a-layer.open { visibility: visible; opacity: 1; }
#afc-root .a-layer.a-buy { z-index: 2147483002; }
#afc-root .a-inner { position: relative; display: flex; flex-direction: column; width: calc(100% - 3rem); max-width: 1180px; height: calc(100% - 3rem); max-height: 900px;
  background: rgba(31,40,52,.97); border-radius: .75rem; box-shadow: 0 .5rem 2rem rgba(15,0,0,.2); overflow: hidden; }
#afc-root .a-buy .a-inner { max-width: 600px; height: auto; max-height: calc(100% - 2rem); }
#afc-root .a-head { position: relative; display: flex; align-items: center; gap: .75rem; padding: 1.1rem 3rem 1rem 1.5rem; border-bottom: 1px solid var(--line); flex-shrink: 0; }
#afc-root .a-head .a-text { min-width: 0; flex: 1; }
#afc-root .a-eyebrow { font-size: .62rem; text-transform: uppercase; letter-spacing: .1em; font-weight: 700; color: #8b94a4; }
#afc-root .a-title { font-size: 1.25rem; font-weight: 700; color: #fff; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#afc-root .a-sub { font-size: .78rem; color: var(--dim); margin-top: .2rem; }
#afc-root .a-mark { flex: none; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: var(--ac); color: #0b1118; font-weight: 900; font-size: 15px; }
#afc-root .a-close { position: absolute; top: 50%; right: 1.1rem; transform: translateY(-50%); background: none; border: 0; color: #fff; font-size: 20px; line-height: 1; cursor: pointer; padding: 4px; }
#afc-root .a-close:hover { opacity: .7; }
#afc-root .a-back { flex: none; width: 32px; height: 32px; border-radius: 8px; border: 1px solid rgba(255,255,255,.16); background: none; color: #fff; font-size: 16px; cursor: pointer; }
#afc-root .a-coins { flex: none; font-weight: 700; color: #ffd76a; font-variant-numeric: tabular-nums; font-size: .85rem; }
#afc-root .a-nav { display: flex; gap: .25rem; padding: .5rem 1.5rem 0; border-bottom: 1px solid var(--line); flex-shrink: 0; }
#afc-root .a-nav button { padding: .45rem .9rem; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--dim); font: 600 .8rem Roboto, Arial, sans-serif; cursor: pointer; }
#afc-root .a-nav button.active { color: #fff; border-bottom-color: var(--ac); }
#afc-root .a-nav .badge { margin-left: 5px; padding: 0 6px; border-radius: 8px; background: #5c4012; color: #ffd8a8; font-size: 10px; }
#afc-root .a-strip { display: flex; align-items: center; gap: .6rem; padding: .5rem 1.5rem; background: rgba(0,202,246,.07); border-bottom: 1px solid var(--line); font-size: .78rem; flex-shrink: 0; }
#afc-root .a-strip.lock { background: rgba(255,179,71,.1); color: #ffd8a8; }
#afc-root .a-strip .a-st { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#afc-root .a-strip.hidden { display: none; }
#afc-root .a-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 1.25rem 1.5rem 1.5rem; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #4c5969 transparent; }
#afc-root .a-actionbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; flex-shrink: 0; padding: .75rem 1.5rem; border-top: 1px solid var(--line); background: rgba(16,21,29,.85); }
#afc-root .a-actionbar.hidden { display: none; }
#afc-root .a-count { font-weight: 700; color: #fff; }
#afc-root .a-btn { display: inline-flex; align-items: center; gap: .3rem; padding: .4rem .8rem; border: 1px solid rgba(255,255,255,.18); border-radius: .5rem; background: transparent;
  color: #fff; font: 600 .75rem Roboto, Arial, sans-serif; cursor: pointer; transition: background .18s, border-color .18s; white-space: nowrap; }
#afc-root .a-btn:hover:not(:disabled) { border-color: rgba(255,255,255,.4); }
#afc-root .a-btn:disabled { opacity: .4; cursor: default; }
#afc-root .a-btn.primary { background: var(--ac); border-color: var(--ac); color: #0b1118; }
#afc-root .a-btn.danger { background: #c92a2a; border-color: #c92a2a; }
#afc-root .a-btn.big { width: 100%; justify-content: center; padding: .75rem 1rem; font-size: .9rem; border-radius: .6rem; }
#afc-root .a-btn.small { padding: .25rem .6rem; font-size: .7rem; }
#afc-root .a-btn.ghost { border-color: transparent; color: var(--dim); }
#afc-root .a-link { background: none; border: 0; padding: 0; color: var(--ac); font: inherit; cursor: pointer; }
#afc-root .a-row { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
#afc-root .a-grow { flex: 1; min-width: 0; }
#afc-root .a-pill { display: inline-flex; align-items: center; padding: .15rem .55rem; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; font-size: .68rem; font-weight: 600; color: #dfe4ec; white-space: nowrap; }
#afc-root .a-pill.ok { border-color: rgba(61,220,132,.4); color: var(--ok); }
#afc-root .a-pill.ko { border-color: rgba(255,107,107,.4); color: var(--ko); }
#afc-root .a-pill.ac { border-color: rgba(0,202,246,.5); color: var(--ac); }
#afc-root .a-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: .75rem; }
#afc-root .a-tile { position: relative; display: flex; flex-direction: column; gap: .8rem; min-height: 150px; padding: 1rem 1.1rem; background: var(--panel); border: 1px solid var(--line);
  border-radius: .75rem; cursor: pointer; transition: border-color .18s, transform .18s; }
#afc-root .a-tile:hover { border-color: rgba(255,255,255,.22); transform: translateY(-1px); }
#afc-root .a-tile.add { align-items: center; justify-content: center; text-align: center; border-style: dashed; color: var(--dim); }
#afc-root .a-tile.add b { color: #fff; font-size: 1rem; }
#afc-root .a-tile-top { display: flex; align-items: center; gap: .5rem; }
#afc-root .a-tile-name { flex: 1; min-width: 0; font-size: .95rem; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#afc-root .a-tile-stats { display: flex; flex-wrap: wrap; gap: .4rem .9rem; font-size: .74rem; color: var(--dim); }
#afc-root .a-tile-foot { margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: .5rem; font-size: .75rem; color: var(--ac); font-weight: 600; }
#afc-root .a-x { background: none; border: 0; color: var(--dim); font-size: 15px; cursor: pointer; padding: 0 2px; }
#afc-root .a-x:hover { color: #fff; }
#afc-root .a-bar { height: 6px; background: rgba(255,255,255,.08); border-radius: 3px; overflow: hidden; display: flex; }
#afc-root .a-bar > span { height: 100%; background: var(--ok); transition: width .4s; }
#afc-root .a-bar > span.ac { background: var(--ac); } #afc-root .a-bar > span.ko { background: var(--ko); }
#afc-root .a-tabs { display: inline-flex; gap: .25rem; padding: .25rem; background: var(--panel); border-radius: .6rem; }
#afc-root .a-tabs button { padding: .35rem .75rem; border: 0; border-radius: .45rem; background: transparent; color: var(--dim); font: 600 .78rem Roboto, Arial, sans-serif; cursor: pointer; }
#afc-root .a-tabs button.active { background: rgba(255,255,255,.1); color: #fff; }
#afc-root .a-ctl { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; margin-bottom: 1rem; }
#afc-root input.a-in, #afc-root select.a-in { background: #0d1117; color: #fff; border: 1px solid rgba(255,255,255,.14); border-radius: .45rem; padding: .35rem .6rem; font: .8rem Roboto, Arial, sans-serif; min-width: 0; }
#afc-root input.a-in:focus, #afc-root select.a-in:focus { outline: none; border-color: var(--ac); }
#afc-root input.a-num { width: 64px; text-align: right; font-variant-numeric: tabular-nums; }
#afc-root .a-players { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: .6rem; }
#afc-root .a-player { position: relative; display: flex; flex-direction: column; align-items: center; gap: .3rem; padding: 1.4rem .5rem .75rem; background: var(--panel);
  border: 1px solid var(--line); border-radius: .65rem; min-width: 0; }
#afc-root .a-player.is-collected { border-color: rgba(255,255,255,.12); }
#afc-root .a-player.is-collected .a-card { opacity: .55; }
#afc-root .a-player.is-selectable { cursor: pointer; transition: border-color .15s, background .15s, transform .15s; }
#afc-root .a-player.is-selectable:hover { border-color: rgba(255,255,255,.22); transform: translateY(-1px); }
#afc-root .a-player.is-selected { border-color: var(--ac); background: rgba(0,202,246,.07); }
#afc-root .a-pick { position: absolute; top: .4rem; right: .45rem; width: 16px; height: 16px; border-radius: 999px; border: 1.5px solid rgba(255,255,255,.28); background: rgba(255,255,255,.04);
  display: grid; place-items: center; font-size: 10px; color: transparent; }
#afc-root .a-pick.on { background: var(--ac); border-color: var(--ac); color: #10151d; }
#afc-root .a-got { position: absolute; top: .4rem; right: .45rem; width: 16px; height: 16px; border-radius: 999px; background: var(--ok); color: #10151d; display: grid; place-items: center; font-size: 10px; font-weight: 900; }
#afc-root .a-card { position: relative; display: flex; justify-content: center; align-items: center; width: 80px; min-height: 104px; }
#afc-root .a-card .item.small { margin: 0 auto; }
#afc-root .a-fallback { width: 64px; height: 88px; display: grid; place-items: center; border-radius: .4rem; background: rgba(255,255,255,.06); font-size: 1.1rem; font-weight: 700; color: #fff; }
#afc-root .a-pname { max-width: 100%; font-size: .78rem; font-weight: 700; color: #fff; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#afc-root .a-price { font-size: .7rem; color: var(--dim); text-align: center; }
#afc-root .a-pstate { font-size: .66rem; text-align: center; color: var(--ac); }
#afc-root .a-pstate.ok { color: var(--ok); } #afc-root .a-pstate.ko { color: var(--ko); }
#afc-root .a-pbtn { margin-top: .2rem; padding: .25rem .6rem; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; background: rgba(255,255,255,.04); color: #aab3c2;
  font: 700 .66rem Roboto, Arial, sans-serif; cursor: pointer; }
#afc-root .a-pbtn:hover:not(:disabled), #afc-root .a-pbtn.busy { border-color: var(--ac); background: var(--ac); color: #0b1118; }
#afc-root .a-pbtn:disabled { opacity: .35; cursor: default; }
#afc-root .a-pager { display: flex; align-items: center; justify-content: center; gap: .9rem; margin-top: 1.25rem; font-size: .8rem; }
#afc-root .a-empty { padding: 2rem; text-align: center; color: var(--dim); }
#afc-root .a-empty ol { text-align: left; display: inline-block; margin: .8rem 0 0; line-height: 1.8; }
#afc-root .a-block { display: flex; flex-direction: column; gap: .5rem; padding: .9rem 1rem; border: 1px solid rgba(255,255,255,.1); border-radius: .75rem; background: var(--panel); }
#afc-root .a-block-title { font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; color: #8b94a4; }
#afc-root .a-block-hint { font-size: .72rem; color: var(--dim); line-height: 1.45; }
#afc-root .a-kv { display: flex; justify-content: space-between; gap: 1rem; font-size: .8rem; }
#afc-root .a-kv b { color: #fff; font-variant-numeric: tabular-nums; }
#afc-root .a-kv .warn { color: var(--warn); }
#afc-root .a-seg { display: inline-flex; gap: .25rem; padding: .2rem; background: #0d1117; border-radius: .5rem; }
#afc-root .a-seg button { padding: .3rem .7rem; border: 0; border-radius: .4rem; background: none; color: var(--dim); font: 600 .75rem Roboto, Arial, sans-serif; cursor: pointer; }
#afc-root .a-seg button.active { background: rgba(255,255,255,.12); color: #fff; }
#afc-root .a-opt { display: flex; gap: .6rem; align-items: flex-start; padding: .55rem .6rem; border: 1px solid transparent; border-radius: .55rem; cursor: pointer; }
#afc-root .a-opt.active { border-color: var(--ac); background: rgba(0,202,246,.06); }
#afc-root .a-opt .a-radio { flex: none; margin-top: 3px; width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,.35); }
#afc-root .a-opt.active .a-radio { border-color: var(--ac); background: radial-gradient(var(--ac) 45%, transparent 50%); }
#afc-root .a-opt b { color: #fff; font-size: .82rem; }
#afc-root .a-buybody { display: flex; flex-direction: column; gap: .75rem; padding: 1rem 1.5rem; overflow-y: auto; min-height: 0; flex: 1; scrollbar-width: thin; scrollbar-color: #4c5969 transparent; }
#afc-root .a-brows { display: flex; flex-direction: column; gap: .3rem; max-height: 300px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #4c5969 transparent; }
#afc-root .a-brow { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: .2rem .7rem; padding: .45rem .6rem; border-radius: .5rem; background: #121821; cursor: pointer; }
#afc-root .a-brow.off { opacity: .45; }
#afc-root .a-brow .a-bn { font-weight: 700; color: #fff; font-size: .8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#afc-root .a-brow .a-bn i { font-style: normal; color: #ffd76a; margin-right: .35rem; }
#afc-root .a-brow .a-bs { grid-column: 2 / span 2; font-size: .7rem; color: var(--dim); }
#afc-root .a-brow .a-bs.ok { color: var(--ok); } #afc-root .a-brow .a-bs.ko { color: var(--ko); } #afc-root .a-brow .a-bs.ac { color: var(--ac); }
#afc-root .a-check { width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid rgba(255,255,255,.35); display: grid; place-items: center; font-size: 10px; color: transparent; }
#afc-root .a-check.on { background: var(--ac); border-color: var(--ac); color: #0b1118; }
#afc-root .a-buyfoot { display: flex; flex-direction: column; gap: .5rem; padding: .9rem 1.5rem 1.2rem; border-top: 1px solid var(--line); background: #1f2834; flex-shrink: 0; }
#afc-root .a-cta-sub { text-align: center; font-size: .72rem; color: var(--dim); }
#afc-root .a-sec { display: flex; flex-direction: column; gap: 10px; max-width: 760px; }
#afc-root h4 { margin: 0; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #8b94a4; }
#afc-root .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
#afc-root .tile { background: var(--panel); border-radius: 8px; padding: 8px 10px; min-width: 0; }
#afc-root .tile span { display: block; font-size: 10px; color: var(--dim); text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
#afc-root .tile b { display: block; font-size: 16px; color: #fff; font-variant-numeric: tabular-nums; }
#afc-root .tile small { display: block; font-size: 10px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#afc-root .tile.neg b { color: var(--ko); } #afc-root .tile.pos b { color: var(--ok); } #afc-root .tile.warn b { color: var(--warn); }
#afc-root .hero { background: var(--panel); border-radius: 10px; padding: 10px 12px; display: flex; align-items: baseline; gap: 10px; }
#afc-root .hero span { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); }
#afc-root .hero b { font-size: 22px; color: #fff; font-variant-numeric: tabular-nums; }
#afc-root .hero b.neg { color: var(--ko); } #afc-root .hero b.pos { color: var(--ok); }
#afc-root .hero small { margin-left: auto; font-size: 11px; color: var(--dim); text-align: right; }
#afc-root .hint { font-size: 11px; color: var(--dim); line-height: 1.5; } #afc-root .hint:empty { display: none; }
#afc-root .salelist { display: flex; flex-direction: column; gap: 3px; }
#afc-root .sale { display: grid; grid-template-columns: 1fr auto; gap: 1px 8px; padding: 6px 8px; border-radius: 6px; background: var(--panel); font-size: 12px; }
#afc-root .sale b { color: #fff; }
#afc-root .sale.unsold { box-shadow: inset 3px 0 #fd7e14; }
#afc-root .sale .m { font-size: 11px; color: var(--dim); }
#afc-root .sale .tag { font-size: 10px; padding: 0 6px; border-radius: 8px; background: #22284a; color: #a5b4fc; align-self: center; }
#afc-root .sale.unsold .tag { background: #3b2a12; color: #ffd8a8; }
#afc-root .speed { font-size: 12px; color: #c4cad6; display: flex; flex-direction: column; gap: 4px; }
#afc-root .speed .grid { display: grid; grid-template-columns: 1fr auto; gap: 8px 10px; align-items: center; }
#afc-root .speed .pair { display: flex; align-items: center; gap: 4px; color: var(--dim); }
#afc-root .speed .pair input { width: 64px; }
#afc-root .speed .presets { display: flex; gap: 4px; }
#afc-root .speed .presets .a-btn.on { background: var(--ac); border-color: var(--ac); color: #0b1118; }
#afc-root .ev { display: grid; grid-template-columns: 58px 14px 1fr; gap: 4px; padding: 2px 6px; border-radius: 4px; font-size: 12px; line-height: 1.45; color: #c9ccd4; }
#afc-root .ev .tm { color: #6c7180; font-variant-numeric: tabular-nums; }
#afc-root .ev .ic { text-align: center; font-weight: 700; }
#afc-root .ev.step { color: #7c8190; }
#afc-root .ev.major { color: #e6e7eb; }
#afc-root .ev.buy .ic, #afc-root .ev.buy.major { color: #69db7c; } #afc-root .ev.sell .ic, #afc-root .ev.sell { color: #ffe066; }
#afc-root .ev.list .ic { color: #74c0fc; } #afc-root .ev.miss .ic, #afc-root .ev.error .ic { color: #ff8787; } #afc-root .ev.error { color: #ffa8a8; }
#afc-root .ev.lock { color: #ffc078; background: #2b2012; } #afc-root .ev.lock .ic, #afc-root .ev.warn .ic { color: #ffa94d; }
#afc-root .jtools { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
#afc-root .jlist { background: #0d1117; border-radius: 8px; padding: 4px; }
`;

  function h(tag, props = {}, ...children) {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...children.filter((c) => c !== null && c !== undefined && c !== false && c !== ''));
    return n;
  }
  const btn = (label, onclick, cls = '', extra = {}) => h('button', { type: 'button', className: `a-btn ${cls}`.trim(), textContent: label, onclick, ...extra });

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

  const ago = (t) => {
    const m = Math.floor((Date.now() - t) / 6e4);
    return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.floor(m / 60)} h` : `il y a ${Math.floor(m / 1440)} j`;
  };

  // Carte rendue par la Web App (même méthode que FST) à partir de l'itemData EA ; null si indisponible
  const cardCache = new Map();
  function cardElement(defId, itemData) {
    if (cardCache.has(defId)) return cardCache.get(defId);
    if (!itemData) return null;
    let el = null;
    try {
      const factory = window.factories?.Item;
      const item = factory?.generateItemsFromItemData?.([{ ...itemData, dream: false }])?.[0];
      const VF = window.UTItemViewFactory;
      if (item && VF?.createSmallItem) {
        const view = VF.createSmallItem(item);
        view.init();
        view.supportSecondaryViews = false;
        view.render(item);
        el = view.getRootElement();
      }
    } catch {
      el = null;
    }
    cardCache.set(defId, el);
    return el;
  }

  // Statut d'une ligne d'achat, libellés de FST
  function rowStatus(q) {
    if (!q) return null;
    const m = {
      pending: ['En attente', ''],
      searching: ['Achat…', 'ac'],
      listed: [`Mis en vente à ${fmtNum(q.sell)}`, 'ok'],
      kept: ['Au club', 'ok'],
      bought: ['Acheté · non-assignés', 'ok'],
      skipped: ['Déjà dans la Galerie', 'ok'],
      moved: [`Prix monté${q.seen ? ` · ${fmtNum(q.seen)} maintenant` : ''}`, 'ko'],
      notfound: [/concurrence/.test(q.note ?? '') ? 'Surenchéri' : 'Non trouvé', 'ko'],
      nocoins: ['Crédits insuffisants', 'ko'],
    }[q.status] ?? [q.status, ''];
    if (q.price && (q.status === 'kept' || q.status === 'bought')) m[0] += ` · payé ${fmtNum(q.price)}`;
    return m;
  }

  class Layer {
    config = loadConfig();
    tab = 'gallery';
    setKey = null;
    filter = 'missing';
    text = '';
    page = 0;
    buyKey = null;
    buyRows = [];
    jfilter = 'all';
    shownEventId = 0;
    lastSig = '';
    synced = new Map();

    constructor(engine) {
      this.engine = engine;
      document.getElementById('afc-style')?.remove();
      document.head.append(h('style', { id: 'afc-style', textContent: CSS }));
      this.root = h('div', { id: 'afc-root' });
      // Les raccourcis clavier de la Web App ne doivent pas capter la saisie
      for (const ev of ['keydown', 'keyup', 'keypress']) this.root.addEventListener(ev, (e) => e.stopPropagation());
      document.body.appendChild(this.root);
      this.build();
    }
    setConfig(patch) {
      this.config = { ...this.config, ...patch };
      save(K_CONFIG, this.config);
    }
    get isOpen() {
      return this.layer.classList.contains('open');
    }
    toggle() {
      this.isOpen ? this.close() : this.show();
    }
    show() {
      this.layer.classList.add('open');
      this.launcher.style.display = 'none';
      this.renderAll();
    }
    close() {
      this.layer.classList.remove('open');
      this.launcher.style.display = '';
      this.closeBuy();
    }

    build() {
      this.launchDot = h('span', { className: 'a-dot' });
      this.launchSub = h('small');
      this.launcher = h('div', { className: 'a-launch', title: 'Ouvrir AlbumFC27', onclick: () => this.toggle() }, this.launchDot, h('span', { textContent: 'AlbumFC27' }), this.launchSub);

      this.backBtn = h('button', { type: 'button', className: 'a-back', textContent: '←', title: 'Retour aux sets', onclick: () => this.openSet(null) });
      this.eyebrowEl = h('div', { className: 'a-eyebrow' });
      this.titleEl = h('div', { className: 'a-title' });
      this.subEl = h('div', { className: 'a-sub' });
      this.syncBtn = btn('', () => void this.syncCurrent(), 'small');
      this.coinsEl = h('span', { className: 'a-coins', title: 'Crédits disponibles' });
      const head = h(
        'div',
        { className: 'a-head' },
        this.backBtn,
        h('span', { className: 'a-mark', textContent: 'A' }),
        h('div', { className: 'a-text' }, this.eyebrowEl, this.titleEl, this.subEl),
        this.syncBtn,
        this.coinsEl,
        h('button', { type: 'button', className: 'a-close', textContent: '×', title: 'Fermer', onclick: () => this.close() }),
      );
      this.navBtns = {};
      this.salesBadge = h('span', { className: 'badge' });
      this.nav = h('div', { className: 'a-nav' });
      for (const [id, label] of [['gallery', 'Galerie'], ['sales', 'Ventes'], ['log', 'Journal'], ['settings', 'Réglages']]) {
        this.navBtns[id] = h('button', { type: 'button', textContent: label, onclick: () => this.showTab(id) });
        this.nav.append(this.navBtns[id]);
      }
      this.stripText = h('span', { className: 'a-st' });
      this.stripBtn = h('span');
      this.strip = h('div', { className: 'a-strip hidden' }, h('span', { className: 'a-dot on' }), this.stripText, this.stripBtn);
      this.body = h('div', { className: 'a-body' });
      this.actionbar = h('div', { className: 'a-actionbar hidden' });
      this.inner = h('div', { className: 'a-inner' }, head, this.nav, this.strip, this.body, this.actionbar);
      this.layer = h('div', { className: 'a-layer' }, this.inner);
      this.layer.addEventListener('mousedown', (e) => e.target === this.layer && this.close());

      this.buyInner = h('div', { className: 'a-inner' });
      this.buyLayer = h('div', { className: 'a-layer a-buy' }, this.buyInner);
      this.buyLayer.addEventListener('mousedown', (e) => e.target === this.buyLayer && !this.engine.running && this.closeBuy());

      this.salesSec = this.buildSalesTab();
      this.logSec = this.buildLogTab();
      this.settingsSec = h('div', { className: 'a-sec' });
      this.root.append(this.launcher, this.layer, this.buyLayer);
      this.renderEvents(true);
      this.renderSpeed();
      setInterval(() => this.tick(), 1e3);
      this.renderAll();
    }

    showTab(id) {
      this.tab = id;
      this.body.scrollTop = 0;
      this.renderAll();
    }

    openSet(key) {
      this.setKey = key;
      this.page = 0;
      this.text = '';
      this.tab = 'gallery';
      this.body.scrollTop = 0;
      this.renderAll();
      // Comme FST : statut Galerie relu chez EA à l'entrée du set (si ancien ou cartes non chargées)
      if (key) {
        const s = this.engine.sets[key];
        const stale = !s?.syncedAt || Date.now() - s.syncedAt > 5 * 6e4 || Object.values(s.players ?? {}).some((p) => !this.engine.itemData.has(p.defId));
        if (stale && !this.engine.running && !this.synced.get(key)) void this.syncCurrent();
      }
    }

    async syncCurrent() {
      const key = this.setKey;
      if (this.engine.running) return this.engine.log('Lecture de la Galerie EA : attendre la fin de la tâche en cours');
      this.synced.set(key ?? '*', true);
      this.syncing = true;
      this.renderHead();
      await this.engine.syncGallery(key ? [key] : undefined);
      this.syncing = false;
      this.synced.set(key ?? '*', false);
      this.renderAll();
    }

    // --- Rendu général ---

    renderAll() {
      this.renderHead();
      this.renderStrip();
      this.renderBody();
      this.renderLauncher();
      if (this.buyKey) this.renderBuy();
    }

    renderHead() {
      const e = this.engine;
      const set = this.setKey && this.tab === 'gallery' ? e.sets[this.setKey] : null;
      this.backBtn.style.display = set ? '' : 'none';
      this.eyebrowEl.textContent = set ? 'Gallery Solver · Set' : 'AlbumFC27 · Gallery Solver';
      this.titleEl.textContent = set ? set.name : { gallery: 'Galerie', sales: 'Ventes', log: 'Journal', settings: 'Réglages' }[this.tab];
      if (set) {
        const all = e.setPlayers(set);
        const got = all.filter((p) => p.collected).length;
        this.subEl.textContent = `Collectés ${got} / ${all.length}${set.needed ? ` · ${set.needed} cartes requises` : ''}`;
      } else this.subEl.textContent = this.tab === 'gallery' ? `${e.setList().length} set(s) importé(s) depuis fut.gg` : '';
      this.syncBtn.style.display = this.tab === 'gallery' ? '' : 'none';
      const at = set ? set.syncedAt : e.gallerySyncAt;
      this.syncBtn.textContent = this.syncing ? 'Synchronisation…' : at ? `↻ Synchronisé ${ago(at)}` : '↻ Non synchronisé';
      this.syncBtn.title = 'Relire chez EA les cartes collectées (même requête que FST)';
      this.syncBtn.disabled = this.syncing || e.running;
      const c = coins();
      this.coinsEl.textContent = c == null ? '' : `${fmtNum(c)} crédits`;
      for (const [k, b] of Object.entries(this.navBtns)) b.classList.toggle('active', k === this.tab);
      const unsold = Object.values(e.bought).filter(isUnsold).length;
      this.salesBadge.textContent = String(unsold);
      if (unsold) this.navBtns.sales.append(this.salesBadge);
      else this.salesBadge.remove();
    }

    renderStrip() {
      const e = this.engine;
      const locked = e.guard.lockedUntil() > Date.now();
      this.strip.classList.toggle('hidden', !e.running && !locked);
      this.strip.classList.toggle('lock', locked && !e.running);
      const stopLabel = { buy: 'Arrêter les achats', relist: 'Arrêter le relist', check: 'Arrêter la vérification', snipe: 'Arrêter le snipe' }[e.mode];
      if (e.running) this.stripBtn.replaceChildren(btn(stopLabel ?? 'Arrêter', () => e.stop(`${stopLabel ?? 'Arrêt'} demandé`, true), 'small danger'));
      else if (locked) this.stripBtn.replaceChildren(btn('Lever', () => confirm('Lever la pause ? Seulement si aucun captcha n’est affiché.') && e.unlock(), 'small'));
      else this.stripBtn.replaceChildren();
      this.tick();
    }

    renderLauncher() {
      const e = this.engine;
      const locked = e.guard.lockedUntil() > Date.now();
      this.launchDot.className = `a-dot${e.running ? ' on' : locked ? ' lock' : ''}`;
    }

    tick() {
      const e = this.engine;
      const left = e.waitUntil - Date.now();
      const s = e.snipeState;
      let txt = e.running && left > 0 ? `${e.waitLabel || 'Prochaine action'} dans ${fmtWait(left)}` : e.running ? e.activityText || 'En cours…' : '';
      if (s?.phase === 'run') txt = `Quick snipe ${s.name} : achat ≤ ${fmtNum(s.maxBuy)}, revente ${fmtNum(s.sell)} · ${s.searches} recherche(s) · reste ${fmtWait(s.until - Date.now())}`;
      const locked = e.guard.lockedUntil() > Date.now();
      if (!e.running && locked) txt = `${e.guard.lockKind() === 'soft' ? 'Pause limite EA' : 'Pause anti-captcha'} jusqu'à ${hm(e.guard.lockedUntil())}${e.resumeAt ? `, reprise vers ${hm(e.resumeAt)}` : ''}`;
      this.stripText.textContent = txt;
      this.launchSub.textContent = e.running ? txt : locked ? txt : e.lastMessage;
      if (this.tab === 'gallery' && this.setKey === null && !this.syncing && this.isOpen) {
        const at = e.gallerySyncAt;
        this.syncBtn.textContent = at ? `↻ Synchronisé ${ago(at)}` : '↻ Non synchronisé';
      }
    }

    renderBody() {
      const top = this.body.scrollTop;
      const tab = this.tab;
      if (tab === 'gallery') this.setKey && this.engine.sets[this.setKey] ? this.renderSet() : ((this.setKey = null), this.renderHome());
      else if (tab === 'sales') {
        this.renderSales();
        this.body.replaceChildren(this.salesSec);
      } else if (tab === 'log') this.body.replaceChildren(this.logSec);
      else {
        this.renderSpeed();
        this.body.replaceChildren(this.settingsSec);
      }
      if (tab !== 'gallery' || !this.setKey) this.actionbar.classList.add('hidden');
      this.body.scrollTop = top;
    }

    // --- Accueil : sets importés ---

    renderHome() {
      const e = this.engine;
      const sets = e.setList();
      const add = h(
        'div',
        { className: 'a-tile add', onclick: () => window.open(FUTGG_GALLERY, '_blank', 'noopener') },
        h('b', { textContent: '+ Importer un set fut.gg' }),
        h('span', { className: 'a-block-hint', textContent: 'Ouvre un set de la Galerie sur fut.gg, puis clique « Envoyer à AlbumFC27 ».' }),
      );
      const tiles = sets.map((s) => {
        const all = e.setPlayers(s);
        const got = all.filter((p) => p.collected).length;
        const missing = all.filter((p) => !p.collected);
        const left = missing.reduce((t, p) => t + (p.minPrice || 0), 0);
        const sel = missing.filter((p) => e.isSelected(p.defId)).length;
        return h(
          'div',
          { className: 'a-tile', onclick: () => this.openSet(s.key) },
          h(
            'div',
            { className: 'a-tile-top' },
            h('span', { className: 'a-tile-name', textContent: s.name, title: s.name }),
            s.url ? h('button', { type: 'button', className: 'a-x', textContent: '↗', title: 'Ouvrir sur fut.gg (renvoyer pour mettre à jour)', onclick: (ev) => (ev.stopPropagation(), window.open(s.url, '_blank', 'noopener')) }) : null,
            h('button', { type: 'button', className: 'a-x', textContent: '×', title: 'Retirer le set', disabled: e.running, onclick: (ev) => (ev.stopPropagation(), confirm(`Retirer le set « ${s.name} » ?`) && e.removeSet(s.key)) }),
          ),
          h(
            'div',
            { className: 'a-tile-stats' },
            h('span', { textContent: `${all.length} joueurs` }),
            s.needed ? h('span', { textContent: `${s.needed} cartes requises` }) : null,
            left ? h('span', { textContent: `manquants ~${fmtNum(left)} crédits (fut.gg)` }) : null,
            sel ? h('span', { className: 'a-pill ac', textContent: `${sel} sélectionné(s)` }) : null,
          ),
          h('div', { className: 'a-bar' }, h('span', { style: `width:${all.length ? (got / all.length) * 100 : 0}%` })),
          h('div', { className: 'a-tile-foot' }, h('span', { style: 'color:#dfe4ec;font-weight:400', textContent: `Collectés ${got} / ${all.length}` }), h('span', { textContent: 'Voir les joueurs →' })),
        );
      });
      const intro = sets.length
        ? null
        : h(
            'div',
            { className: 'a-empty' },
            h('b', { style: 'color:#fff', textContent: 'Aucun set importé.' }),
            h(
              'ol',
              {},
              h('li', { textContent: '« + Importer un set fut.gg » : ouvre un set de la Galerie, clique « Envoyer à AlbumFC27 ».' }),
              h('li', { textContent: 'Ouvre le set : les joueurs déjà collectés sont lus chez EA.' }),
              h('li', { textContent: 'Sélectionne les cartes manquantes, puis « Acheter maintenant », ou « Quick snipe » sur une carte.' }),
            ),
          );
      this.body.replaceChildren(...[h('div', { className: 'a-grid' }, ...tiles, add), intro].filter(Boolean));
    }

    // --- Set : joueurs en cartes EA ---

    renderSet() {
      const e = this.engine;
      const set = e.sets[this.setKey];
      const all = e.setPlayers(set);
      const queue = new Map(e.queue.map((q) => [q.defId, q]));
      const lists = { all, collected: all.filter((p) => p.collected), missing: all.filter((p) => !p.collected) };
      const tabs = h(
        'div',
        { className: 'a-tabs' },
        ...[
          ['all', 'Tous'],
          ['collected', 'Collectés'],
          ['missing', 'Manquants'],
        ].map(([id, label]) => h('button', { type: 'button', className: this.filter === id ? 'active' : '', textContent: `${label} ${lists[id].length}`, onclick: () => ((this.filter = id), (this.page = 0), this.renderBody()) })),
      );
      const search = h('input', { type: 'search', className: 'a-in', placeholder: 'Rechercher un joueur', value: this.text });
      search.oninput = () => {
        this.text = search.value.trim().toLowerCase();
        this.page = 0;
        this.renderGrid(lists, queue);
      };
      const busy = e.mode === 'buy' || e.mode === 'check';
      const selAll = btn('Tout sélectionner', () => {
        for (const p of lists.missing) if (!e.isSelected(p.defId)) e.setSelected(p.defId, true);
        this.renderBody();
      }, 'small ghost', { disabled: busy });
      this.gridWrap = h('div');
      this.body.replaceChildren(h('div', { className: 'a-ctl' }, tabs, search, h('span', { className: 'a-grow' }), selAll), this.gridWrap);
      this.renderGrid(lists, queue);
      this.renderActionbar(set);
    }

    renderGrid(lists, queue) {
      const e = this.engine;
      const t = this.text;
      const list = lists[this.filter].filter((p) => !t || p.name.toLowerCase().includes(t));
      const pages = Math.max(1, Math.ceil(list.length / PAGE_CARDS));
      this.page = Math.min(this.page, pages - 1);
      const shown = list.slice(this.page * PAGE_CARDS, (this.page + 1) * PAGE_CARDS);
      const busy = e.mode === 'buy' || e.mode === 'check';
      const cards = shown.map((p) => {
        const sel = !p.collected && e.isSelected(p.defId);
        const selectable = !p.collected && !busy;
        const q = queue.get(p.defId);
        const card = h('div', { className: 'a-card' });
        const el = cardElement(p.defId, e.itemData.get(p.defId));
        card.append(el ?? h('div', { className: 'a-fallback', textContent: p.rating ? String(p.rating) : '?' }));
        const price = Number(e.selection[p.defId]) || p.minPrice || 0;
        const st = q && !p.collected ? rowStatus(q) : q && q.price ? rowStatus(q) : null;
        const sniping = e.snipeState?.defId === p.defId;
        const node = h(
          'div',
          { className: `a-player${p.collected ? ' is-collected' : ''}${selectable ? ' is-selectable' : ''}${sel ? ' is-selected' : ''}` },
          p.collected ? h('span', { className: 'a-got', textContent: '✓', title: 'Collecté' }) : h('span', { className: `a-pick${sel ? ' on' : ''}`, textContent: '✓' }),
          card,
          h('div', { className: 'a-pname', textContent: p.name, title: p.name }),
          h('div', { className: 'a-price', textContent: p.collected ? 'Collecté' : price ? `${fmtNum(price)} crédits${e.selection[p.defId] && Number(e.selection[p.defId]) !== p.minPrice ? '' : ' · fut.gg'}` : 'sans prix' }),
          st ? h('div', { className: `a-pstate ${st[1]}`, textContent: st[0] }) : null,
          !p.collected
            ? h('button', {
                type: 'button',
                className: `a-pbtn${sniping ? ' busy' : ''}`,
                textContent: sniping ? 'Snipe en cours…' : '⚡ Quick snipe',
                title: 'Prix du marché, puis recherches rapides pendant 4 min sous le prix (profit 300+), arrêt au premier achat, mise en vente au prix du marché',
                disabled: e.running,
                onclick: (ev) => (ev.stopPropagation(), void e.snipe(p.defId)),
              })
            : null,
        );
        if (selectable)
          node.onclick = () => {
            e.setSelected(p.defId, !e.isSelected(p.defId));
            this.renderGrid(lists, queue);
            this.renderActionbar(e.sets[this.setKey]);
          };
        return node;
      });
      const pager =
        pages > 1
          ? h(
              'div',
              { className: 'a-pager' },
              btn('‹', () => ((this.page = Math.max(0, this.page - 1)), this.renderGrid(lists, queue)), 'small', { disabled: this.page === 0 }),
              h('span', { textContent: `Page ${this.page + 1} sur ${pages}` }),
              btn('›', () => ((this.page = Math.min(pages - 1, this.page + 1)), this.renderGrid(lists, queue)), 'small', { disabled: this.page >= pages - 1 }),
            )
          : null;
      this.gridWrap.replaceChildren(cards.length ? h('div', { className: 'a-players' }, ...cards) : h('div', { className: 'a-empty', textContent: 'Aucun joueur ici.' }), pager ?? '');
    }

    selectedOf(set) {
      const e = this.engine;
      return e.setPlayers(set).filter((p) => !p.collected && e.isSelected(p.defId));
    }

    renderActionbar(set) {
      const e = this.engine;
      const sel = this.selectedOf(set);
      const pk = e.picks(sel.map((p) => String(p.defId)));
      this.actionbar.classList.remove('hidden');
      this.actionbar.replaceChildren(
        h('div', { className: 'a-row' }, h('span', { className: 'a-count', textContent: `${sel.length} sélectionné(s)` }), sel.length ? h('span', { className: 'a-block-hint', textContent: `~${fmtNum(pk.spend)} crédits${pk.unpriced.length ? `, ${pk.unpriced.length} sans prix` : ''}` }) : null),
        h(
          'div',
          { className: 'a-row' },
          btn('Effacer', () => {
            for (const p of sel) e.setSelected(p.defId, false);
            this.renderBody();
          }, 'ghost', { disabled: !sel.length || e.mode === 'buy' }),
          btn(e.mode === 'buy' ? 'Achats en cours…' : 'Acheter maintenant', () => this.openBuy(set.key), 'primary', { disabled: !sel.length && !(e.mode === 'buy') }),
        ),
      );
    }

    // --- Fenêtre « Acheter des cartes Galerie » (FST) ---

    openBuy(key) {
      const set = this.engine.sets[key];
      if (!set) return;
      this.buyKey = key;
      const running = this.engine.mode === 'buy' || this.engine.mode === 'check';
      // Lignes : cartes sélectionnées du set, ou le lot en cours
      this.buyRows = running || (this.buyRan && this.buyRanKey === key) ? this.engine.queue.map((q) => q.defId) : this.selectedOf(set).map((p) => p.defId);
      if (!running && !(this.buyRan && this.buyRanKey === key)) this.buyRan = false;
      this.buyLayer.classList.add('open');
      this.renderBuy();
    }
    closeBuy() {
      this.buyKey = null;
      this.buyRan = false;
      this.buyLayer.classList.remove('open');
      if (this.isOpen) this.renderBody();
    }

    async runBuy(ids) {
      this.buyRan = true;
      this.buyRanKey = this.buyKey;
      this.buyRows = ids;
      await this.engine.validate(ids);
      this.buyRows = this.engine.queue.map((q) => q.defId);
      this.renderBuy();
    }

    renderBuy() {
      const e = this.engine;
      const set = e.sets[this.buyKey];
      if (!set) return this.closeBuy();
      const cfg = this.config;
      const running = e.mode === 'buy' || e.mode === 'check';
      const queue = new Map(e.queue.map((q) => [q.defId, q]));
      const showRun = running || this.buyRan;
      const rows = this.buyRows.map((id) => ({ id, p: e.findPlayer(id), q: showRun ? queue.get(id) : null })).filter((r) => r.p);
      const on = rows.filter((r) => !r.p.collected && e.isSelected(r.id));
      const pk = e.picks(on.map((r) => String(r.id)));
      const wallet = coins();
      const relist = cfg.afterBuy !== 'keep';

      const head = h(
        'div',
        { className: 'a-head' },
        h('div', { className: 'a-text' }, h('div', { className: 'a-eyebrow', textContent: 'Galerie · Achat' }), h('div', { className: 'a-title', textContent: `Acheter des cartes Galerie · ${set.name}` }), h('div', { className: 'a-sub', textContent: running ? 'Achat des cartes sélectionnées au prix du marché, patiente…' : 'Choisis les cartes, la gestion des prix et ce qui se passe après l’achat. Un seul bouton lance tout.' })),
        h('button', { type: 'button', className: 'a-close', textContent: '×', title: 'Fermer', onclick: () => this.closeBuy(), disabled: running }),
      );

      // Liste des cartes
      const listRows = rows.map(({ id, p, q }) => {
        const inc = !p.collected && e.isSelected(id);
        const v = Number(e.selection[id]) || 0;
        let st = q ? rowStatus(q) : null;
        if (!st) st = p.collected ? ['Déjà dans la Galerie', 'ok'] : v ? [`${fmtNum(v)} crédits${v === p.minPrice ? ' · prix fut.gg' : ''}`, ''] : ['Sans prix · vérifié avant l’achat', 'ac'];
        const price = h('input', { type: 'number', className: 'a-in a-num', min: '150', step: String(step(v || p.minPrice || 200)), value: v ? String(v) : '', placeholder: 'auto', title: 'Prix de départ (vide = vérifié sur le marché)', disabled: running || p.collected || showRun });
        price.onclick = (ev) => ev.stopPropagation();
        price.onchange = () => {
          const raw = Math.floor(Number(price.value));
          const val = raw > 0 ? Math.max(150, Math.floor(raw / step(raw)) * step(raw)) : 0;
          e.setSelected(id, true, val);
          this.renderBuy();
        };
        const row = h(
          'div',
          { className: `a-brow${inc || q ? '' : ' off'}` },
          h('span', { className: `a-check${inc || (q && showRun) ? ' on' : ''}`, textContent: '✓' }),
          h('span', { className: 'a-bn' }, p.rating ? h('i', { textContent: String(p.rating) }) : null, p.name),
          showRun ? h('span') : price,
          h('span', { className: `a-bs ${st[1]}`, textContent: st[0] + (q?.note && isFailed(q) && q.status !== 'moved' ? ` · ${q.note}` : '') }),
        );
        if (!running && !showRun && !p.collected) row.onclick = () => (e.setSelected(id, !inc), this.renderBuy());
        return row;
      });
      const listHead = h(
        'div',
        { className: 'a-row' },
        h('b', { style: 'color:#fff;font-size:.8rem', textContent: showRun ? `${rows.filter((r) => r.q?.price > 0).length} / ${rows.length} achetée(s)` : `${on.length} / ${rows.length} cartes` }),
        !running && !showRun ? h('button', { type: 'button', className: 'a-link', textContent: on.length === rows.length ? 'Tout désélectionner' : 'Tout sélectionner', onclick: () => {
          const all = on.length !== rows.length;
          for (const r of rows) if (!r.p.collected) e.setSelected(r.id, all);
          this.renderBuy();
        } }) : null,
        h('span', { className: 'a-grow' }),
        !showRun ? btn(e.mode === 'check' ? 'Vérification…' : 'Vérifier sur la Web App', () => void this.checkRows(on.map((r) => r.id)), 'small', { disabled: e.running || !on.length, title: 'Sonde le marché : prix de départ = 4e annonce la moins chère' }) : null,
      );
      const listBlock = h('div', { className: 'a-block' }, listHead, !showRun ? h('div', { className: 'a-block-hint', textContent: 'Touche une ligne pour inclure ou retirer une carte.' }) : null, h('div', { className: 'a-brows' }, ...listRows));

      // Résumé
      const tol = tolOf(cfg);
      const over = wallet !== null && pk.spend > wallet;
      const summary = h(
        'div',
        { className: 'a-block' },
        h('div', { className: 'a-block-title', textContent: 'Résumé' }),
        h('div', { className: 'a-kv' }, h('span', { textContent: 'Cartes' }), h('b', { textContent: `${on.length} / ${rows.length}` })),
        h('div', { className: 'a-kv' }, h('span', { textContent: 'Coût' }), h('b', { textContent: `~${fmtNum(pk.spend)} crédits` })),
        pk.capSpend > pk.spend ? h('div', { className: 'a-kv' }, h('span', { textContent: '' }), h('span', { className: 'a-block-hint', textContent: `jusqu'à ${fmtNum(pk.capSpend)} avec la hausse (+${tol} paliers)` })) : null,
        wallet !== null ? h('div', { className: 'a-kv' }, h('span', { textContent: 'Solde' }), h('b', { className: over ? 'warn' : '', textContent: `${fmtNum(wallet)} · ${over ? 'au-delà du solde' : 'dans le solde'}` })) : null,
        h('div', { className: 'a-kv' }, h('span', { textContent: 'Prix' }), h('b', { textContent: pk.unpriced.length ? `fut.gg, ${pk.unpriced.length} vérifié(s) d’abord` : 'prix fut.gg / vérifiés' })),
        over ? h('div', { className: 'a-block-hint', textContent: 'Les cartes que le solde ne couvre pas sont sautées.' }) : null,
      );

      // Écart max
      const tolInput = h('input', { type: 'number', className: 'a-in a-num', min: '0', max: String(MAX_TOLERANCE), value: String(cfg.tolerance), disabled: cfg.toleranceAuto || running });
      tolInput.onchange = () => {
        const v = Math.min(MAX_TOLERANCE, Math.max(0, Math.floor(Number(tolInput.value) || 0)));
        this.setConfig({ tolerance: v });
        this.renderBuy();
      };
      const seg = h(
        'div',
        { className: 'a-seg' },
        h('button', { type: 'button', className: cfg.toleranceAuto ? 'active' : '', textContent: 'Auto', disabled: running, onclick: () => (this.setConfig({ toleranceAuto: true }), this.renderBuy()) }),
        h('button', { type: 'button', className: cfg.toleranceAuto ? '' : 'active', textContent: 'Manuel', disabled: running, onclick: () => (this.setConfig({ toleranceAuto: false }), this.renderBuy()) }),
      );
      const tolBlock = h(
        'div',
        { className: 'a-block' },
        h('div', { className: 'a-row' }, h('span', { className: 'a-block-title a-grow', textContent: 'Écart max' }), seg, h('span', { className: 'a-row', style: 'gap:.3rem' }, tolInput, h('span', { className: 'a-block-hint', textContent: 'paliers' }))),
        h('div', { className: 'a-block-hint', textContent: cfg.toleranceAuto ? 'De combien une carte peut coûter plus que son prix connu. Auto : 3 paliers EA (+150 sur une carte à 500, +3 000 sur une carte à 100k).' : `Une carte peut coûter jusqu’à ${cfg.tolerance} palier(s) EA de plus que son prix connu ; plus chère, elle est sautée et reproposée à la fin.` }),
      );

      // Après achat
      const markInput = h('input', { type: 'number', className: 'a-in a-num', min: '0', max: '100', value: String(cfg.markupPct), disabled: running });
      markInput.onclick = (ev) => ev.stopPropagation();
      markInput.onchange = () => (this.setConfig({ markupPct: Math.min(100, Math.max(0, Number(markInput.value) || 0)) }), this.renderBuy());
      const desc = {
        keep: 'Les cartes sont placées dans ton club après l’achat. Coût = prix payé.',
        relist: 'Chaque carte est remise en vente au prix payé. La taxe EA de 5 % est ce que la carte Galerie te coûte.',
        markup: 'Chaque carte est remise en vente un peu au-dessus du prix payé, ce qui couvre la plus grande partie de la taxe EA de 5 %. Se vend un peu plus lentement.',
      };
      const opts = Object.entries(AFTER_BUY).map(([k, label]) =>
        h(
          'div',
          { className: `a-opt${cfg.afterBuy === k ? ' active' : ''}`, onclick: () => !running && (this.setConfig({ afterBuy: k }), this.renderBuy()) },
          h('span', { className: 'a-radio' }),
          h('div', { className: 'a-grow' }, h('div', { className: 'a-row' }, h('b', { textContent: label }), k === 'markup' ? h('span', { className: 'a-row', style: 'gap:.3rem' }, '+', markInput, '%') : null), cfg.afterBuy === k ? h('div', { className: 'a-block-hint', textContent: desc[k] }) : null),
        ),
      );
      const back = relist ? `Retour après taxe ~${fmtNum(pk.back)} · coût net ${pk.cost < 0 ? `+${fmtNum(-pk.cost)}` : fmtNum(pk.cost)}` : `Coût ${fmtNum(pk.spend)} (cartes gardées)`;
      const afterBlock = h('div', { className: 'a-block' }, h('div', { className: 'a-block-title', textContent: 'Après achat' }), ...opts, on.length ? h('div', { className: 'a-block-hint', style: 'color:#dfe4ec', textContent: back }) : null);

      // Pied : bouton unique, progression, bilan
      const foot = h('div', { className: 'a-buyfoot' });
      if (running) {
        const q = e.queue;
        const done = q.filter((x) => !isOpen(x)).length;
        foot.append(
          ...[
          h('div', { className: 'a-kv' }, h('b', { textContent: e.mode === 'check' ? 'Vérification des prix' : 'Achat des cartes' }), h('span', { textContent: e.mode === 'buy' ? `${done} / ${q.length}` : '' })),
          e.mode === 'buy' ? h('div', { className: 'a-bar' }, h('span', { className: 'ac', style: `width:${q.length ? (done / q.length) * 100 : 0}%` })) : null,
          btn('Arrêter', () => e.stop(e.mode === 'check' ? 'Vérification arrêtée' : 'Achats arrêtés', true), 'big danger'),
          ].filter(Boolean),
        );
      } else if (this.buyRan) {
        const q = e.queue;
        const bought = q.filter((x) => x.price > 0).length;
        const listed = q.filter((x) => x.status === 'listed').length;
        const failed = q.filter(isFailed).length;
        const skipped = q.filter((x) => x.status === 'moved' && x.seen > 0);
        const open = q.filter(isOpen).length;
        foot.append(
          ...[
          h('div', { className: 'a-cta-sub', style: 'color:#fff;font-size:.82rem', textContent: `Achetés ${bought} · mis en vente ${listed} · échecs ${failed}${skipped.length ? ` · sautés ${skipped.length}` : ''}${open ? ' · arrêté avant la fin' : ''}` }),
          skipped.length ? btn(`Racheter ${skipped.length} carte(s) sautée(s) au prix vu`, () => void e.retrySkipped(), 'big primary') : null,
          open ? btn(`Reprendre (${open} restante(s))`, () => void e.runQueue(), 'big primary') : null,
          btn('Terminé', () => this.closeBuy(), `big${skipped.length || open ? '' : ' primary'}`),
          ].filter(Boolean),
        );
      } else {
        const n = on.length;
        const label = pk.unpriced.length ? `Vérifier${relist ? ', acheter & remettre en vente' : ' & acheter'} ${n} carte(s)` : relist ? `Acheter & remettre en vente ${n} carte(s)` : `Acheter ${n} carte(s) · ${fmtNum(pk.spend)}`;
        foot.append(
          btn(label, () => void this.runBuy(on.map((r) => r.id)), 'big primary', { disabled: !n || e.running }),
          h('div', { className: 'a-cta-sub', textContent: pk.unpriced.length ? `les prix manquants sont vérifiés d’abord · ~${fmtNum(pk.spend)} crédits` : `${fmtNum(pk.spend)} crédits en tout` }),
        );
      }
      const top = this.buyBody?.scrollTop ?? 0;
      this.buyBody = h('div', { className: 'a-buybody' }, listBlock, showRun ? null : summary, showRun ? null : tolBlock, showRun ? null : afterBlock);
      this.buyInner.replaceChildren(head, this.buyBody, foot);
      this.buyBody.scrollTop = top;
    }

    async checkRows(ids) {
      if (!ids.length) return;
      await this.engine.checkPrices(false, ids);
      this.renderBuy();
    }

    // --- Ventes ---

    buildSalesTab() {
      this.heroEl = h('div', { className: 'hero' });
      this.statsEl = h('div', { className: 'tiles' });
      this.relistBtn = btn('', () => (this.engine.mode === 'relist' ? this.engine.stop('Relister arrêté', true) : void this.engine.relist()), 'big primary');
      this.pileEl = h('div', { className: 'hint' });
      this.salesEl = h('div', { className: 'salelist' });
      const reset = btn('Remettre les compteurs à zéro', () => confirm('Remettre à zéro dépensé, vendus, perte réalisée et taxe ?') && this.engine.resetTotals(), 'small ghost');
      return h(
        'div',
        { className: 'a-sec' },
        this.heroEl,
        this.statsEl,
        this.relistBtn,
        h('div', { className: 'hint', textContent: "Relister : encaisse les ventes, puis sonde le marché pour chaque invendu de la liste de transferts et le remet en vente au prix de l'annonce la moins chère vue." }),
        this.pileEl,
        h('h4', { textContent: 'Joueurs achetés encore en vente' }),
        this.salesEl,
        h('div', { className: 'a-row' }, h('span', { className: 'a-grow' }), reset),
      );
    }

    renderSales(s = this.engine.snapshot()) {
      const e = this.engine;
      const t = s.total;
      const real = t.lost + s.pendingLoss + (t.keptSpent ?? 0);
      this.heroEl.replaceChildren(
        h('span', { textContent: 'Coût réel' }),
        h('b', { className: real > 0 ? 'neg' : real < 0 ? 'pos' : '', textContent: real < 0 ? `+${fmtNum(-real)}` : fmtNum(real) }),
        h('small', { textContent: `réalisé ${t.lost < 0 ? `+${fmtNum(-t.lost)}` : fmtNum(t.lost)} · en attente ${fmtNum(s.pendingLoss)}${t.keptSpent ? ` · club ${fmtNum(t.keptSpent)}` : ''}` }),
      );
      const items = Object.values(e.bought);
      const value = items.reduce((v, b) => v + (b.sell || b.price), 0);
      this.statsEl.replaceChildren(
        tile('En vente', `${items.length}`, `valeur ${fmtNum(value)}${s.unsold ? `, ${s.unsold} invendu(s)` : ''}`, s.unsold ? 'warn' : ''),
        tile('Vendus', `${fmtNum(t.sold)} / ${fmtNum(t.bought)}`, `récupéré ${fmtNum(t.received)}`),
        tile('Dépensé', fmtNum(t.spent), `taxe payée ${fmtNum(t.tax)}${t.kept ? `, ${fmtNum(t.kept)} gardé(s) au club (${fmtNum(t.keptSpent)})` : ''}`),
      );
      const relisting = e.mode === 'relist';
      this.relistBtn.className = `a-btn big ${relisting ? 'danger' : 'primary'}`;
      this.relistBtn.textContent = relisting ? 'Arrêter' : `Relister les invendus${s.unsold ? ` (${s.unsold})` : ''}`;
      this.relistBtn.disabled = e.running && !relisting;
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
          : [h('div', { className: 'a-empty', textContent: 'Aucun joueur acheté en vente.' })]),
      );
    }

    // --- Journal ---

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
      if (full || newest < this.shownEventId) this.jList.replaceChildren(...evs.filter((ev) => this.eventMatches(ev)).slice(0, 300).map((ev) => this.eventRow(ev)));
      else {
        const fresh = evs.filter((ev) => ev.id > this.shownEventId).reverse();
        if (fresh.length) this.jList.querySelector('.a-empty')?.remove();
        for (const ev of fresh) if (this.eventMatches(ev)) this.jList.prepend(this.eventRow(ev));
        while (this.jList.childElementCount > 300) this.jList.lastChild.remove();
      }
      if (!evs.length) this.jList.replaceChildren(h('div', { className: 'a-empty', textContent: 'Journal vide.' }));
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
        const b = btn(label, () => {
          this.jfilter = id;
          for (const c of chips) c.classList.toggle('primary', c === b);
          this.renderEvents(true);
        }, `small${id === 'all' ? ' primary' : ''}`);
        return b;
      });
      const copy = btn('Copier', async () => {
        const ok = await copyText(this.engine.events.map((ev) => `${new Date(ev.t).toLocaleString()} [${ev.type}] ${ev.msg}`).join('\n'));
        copy.textContent = ok ? 'Copié' : 'Échec';
        setTimeout(() => (copy.textContent = 'Copier'), 1500);
      }, 'small');
      const clear = btn('Effacer', () => this.engine.clearEvents(), 'small');
      return h('div', { className: 'a-sec', style: 'max-width:none' }, h('div', { className: 'jtools' }, ...chips, h('span', { className: 'a-grow' }), copy, clear), this.jList);
    }

    // --- Réglages : vitesse, ralentissement, pauses, quotas (appliqués immédiatement) ---

    renderSpeed() {
      const c = this.config;
      const keys = Object.keys(SPEED_DEFAULTS);
      const active = SPEED_PRESETS.find(([, v]) => keys.every((k) => v[k] === c[k]))?.[0];
      const dec = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
      const pace = this.engine.guard.pace(c);
      // scale : 1e3 pour des secondes stockées en ms ; min : valeur plancher
      const input = (k, stepV, scale = 1, min = 0) => {
        const i = h('input', { type: 'number', className: 'a-in a-num', min: String(min), step: String(stepV), value: String(c[k] / scale) });
        i.onchange = () => {
          const v = Math.round(Math.max(min, Number(String(i.value).replace(',', '.')) || 0) * scale * 10) / 10;
          const patch = { [k]: scale > 1 ? Math.round(v) : v };
          // min ≤ max : la borne modifiée entraîne l'autre
          if (k === 'minDelayMs' && v > c.maxDelayMs) patch.maxDelayMs = v;
          if (k === 'maxDelayMs' && v < c.minDelayMs) patch.minDelayMs = v;
          if (k === 'buyDelayMinMs' && v > c.buyDelayMaxMs) patch.buyDelayMaxMs = v;
          if (k === 'buyDelayMaxMs' && v < c.buyDelayMinMs) patch.buyDelayMinMs = v;
          this.setConfig(patch);
          // Reconstruction différée : retirer le champ encore focalisé pendant son « change » lève une erreur
          setTimeout(() => this.renderSpeed());
        };
        return i;
      };
      const pair = (a, b, stepS) => h('span', { className: 'pair' }, input(a, stepS, 1e3), '–', input(b, stepS, 1e3), 's');
      const presets = SPEED_PRESETS.map(([name, v]) => btn(name, () => (this.setConfig({ ...v }), this.renderSpeed()), `small${name === active ? ' on' : ''}`));
      const off = c.paceStep <= 1 || c.paceMax <= 1 || c.paceResetMin <= 0;
      const paceState = off
        ? 'Ralentissement désactivé : seule la pause après limite EA s’applique.'
        : pace > 1
          ? `Rythme actuel ralenti ×${dec(pace)} (délais ${dec((c.minDelayMs * pace) / 1e3)}–${dec((c.maxDelayMs * pace) / 1e3)} s) jusqu’à ${hm(this.engine.guard.paceUntil(c))} sans nouvelle limite.`
          : 'Rythme normal.';
      const resetBtn = pace > 1 ? btn('Revenir au rythme normal', () => (this.engine.guard.resetPace(), this.engine.log('Rythme remis à la normale'), this.renderSpeed()), 'small') : null;
      const title = (t) => h('h4', { textContent: t, style: 'grid-column:1 / -1;margin-top:8px' });
      this.settingsSec.replaceChildren(
        h(
          'div',
          { className: 'speed' },
          h(
            'div',
            { className: 'grid' },
            title('Vitesse (achats, vérification, relist)'),
            h('span', { textContent: 'Préréglage' }),
            h('span', { className: 'presets' }, ...presets),
            h('span', { textContent: 'Délai entre recherches' }),
            pair('minDelayMs', 'maxDelayMs', 0.5),
            h('span', { textContent: 'Délai avant achat' }),
            pair('buyDelayMinMs', 'buyDelayMaxMs', 0.1),
            title('Ralentissement après limite EA'),
            h('span', { textContent: 'Multiplier les délais à chaque limite (1 = jamais)' }),
            h('span', { className: 'pair' }, '×', input('paceStep', 0.1, 1, 1)),
            h('span', { textContent: 'Ralentissement maximal' }),
            h('span', { className: 'pair' }, '×', input('paceMax', 0.5, 1, 1)),
            h('span', { textContent: 'Retour au rythme normal après (sans limite)' }),
            h('span', { className: 'pair' }, input('paceResetMin', 5), 'min'),
            title('Pauses après refus EA (0 = aucune, reprise immédiate)'),
            h('span', { textContent: 'Après limite EA 426 / 429 / 512 / 521 (min)' }),
            h('span', { className: 'pair' }, input('softPauseMin', 1), 'min'),
            h('span', { textContent: 'Après captcha 458 / 460 / 494 (min)' }),
            h('span', { className: 'pair' }, input('captchaPauseMin', 5), 'min'),
            title('Quotas (0 = illimité, cumulés avec SnipeFC27)'),
            h('span', { textContent: 'Recherches max par heure' }),
            h('span', { className: 'pair' }, input('quotaSearchHour', 50)),
            h('span', { textContent: 'Recherches max par 24 h' }),
            h('span', { className: 'pair' }, input('quotaSearchDay', 100)),
            h('span', { textContent: 'Achats max par 24 h' }),
            h('span', { className: 'pair' }, input('quotaBuyDay', 10)),
          ),
          h('div', { className: 'a-row', style: 'margin-top:8px' }, h('span', { className: 'hint a-grow', textContent: paceState }), resetBtn),
          h('div', { className: 'hint', textContent: `Quick snipe : vitesse rapide fixe (${SNIPE_DELAY[0] / 1e3}–${SNIPE_DELAY[1] / 1e3} s entre recherches, ralentie après une limite EA), 4 min. Plus rapide = plus de risque de limite EA ou de captcha.` }),
        ),
      );
      this.paceShown = pace;
    }

    // --- Mise à jour depuis le moteur ---

    update(s) {
      if (s.lastEventId !== this.shownEventId) this.renderEvents();
      this.renderLauncher();
      if (!this.isOpen) return void this.tick();
      this.renderHead();
      this.renderStrip();
      const sig = `${s.mode}|${s.version}|${s.snipe?.phase ?? ''}`;
      const typing = this.root.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
      if (sig !== this.lastSig && !typing) {
        this.lastSig = sig;
        if (this.tab === 'gallery') this.renderBody();
      }
      if (this.tab === 'sales') this.renderSales(s);
      if (this.tab === 'settings' && s.pace !== this.paceShown && !typing) this.renderSpeed();
      if (this.buyKey && !(typing && this.buyLayer.contains(document.activeElement))) this.renderBuy();
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
    panel = new Layer(engine);
    const n = engine.setList().length;
    engine.log(`Web App détectée, prêt${n ? ` (${n} set${n > 1 ? 's' : ''})` : ''}`);
    // Statut Galerie relu chez EA au démarrage
    if (n) setTimeout(() => !engine.running && void engine.syncGallery(), 5e3);
    const at = Number(load(K_RESUME, 0));
    save(K_RESUME, 0);
    const lockIntent = load(K_LOCK_RESUME, null);
    const cfg0 = loadConfig();
    const kind = engine.guard.lockKind();
    if ((kind === 'soft' && cfg0.softPauseMin <= 0) || (kind === 'hard' && cfg0.captchaPauseMin <= 0)) {
      engine.guard.unlock();
      engine.log('Pause en cours levée (aucune pause réglée)');
    }
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
          panel.show();
          panel.openSet(key);
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
