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
  const AFTER_BUY = { relist: "Revendre au prix d'achat", markup: 'Revendre avec marge', keep: 'Garder au club' };
  const DEFID_CHUNK = 250;
  const FUTGG_GALLERY = 'https://www.fut.gg/fut-gallery/';

  const step = (p) => (p < 1e3 ? 50 : p < 1e4 ? 100 : p < 5e4 ? 250 : p < 1e5 ? 500 : 1e3);
  const roundPrice = (p) => Math.max(0, Math.round(p / step(p)) * step(p));
  const priceDown = (p) => Math.max(150, p - step(p - 1));
  const tickUp = (p) => roundPrice(p + step(p));
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

  const STATUS_LABEL = {
    pending: 'en attente',
    searching: 'recherche…',
    listed: 'acheté',
    kept: 'acheté, gardé au club',
    bought: 'acheté, resté dans les non-assignés',
    skipped: 'déjà dans la Galerie',
    moved: 'prix monté',
    notfound: 'non trouvé',
    nocoins: 'crédits insuffisants',
  };
  const isDone = (q) => q.status === 'listed' || q.status === 'kept' || q.status === 'bought' || q.status === 'skipped';
  const isFailed = (q) => q.status === 'notfound' || q.status === 'nocoins' || q.status === 'moved';
  // Coût réel d'un achat : prix payé moins le net de la revente (rien de récupéré si la carte n'est pas en vente)
  const costOf = (q) => (q.status === 'listed' ? q.price - netOf(q.sell || q.price) : q.price);
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
    picks() {
      const cfg = this.getConfig();
      const list = [];
      const unpriced = [];
      for (const [id, v] of Object.entries(this.selection)) {
        const p = this.findPlayer(id);
        if (!p || this.refreshCollected(p).collected) continue;
        const start = Number(v) >= 150 ? Math.floor(Number(v)) : 0;
        if (!start) {
          unpriced.push(p);
          continue;
        }
        list.push({ p, start, cap: tolCap(start, cfg.tolerance) });
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

    async checkPrices(resume = false) {
      this.checkedAt ??= {};
      const list = this.selectedPlayers().filter(({ p }) => !resume || Date.now() - (this.checkedAt[p.defId] ?? 0) > 15 * 6e4);
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

    async validate() {
      if (this.running) return;
      const tol = this.getConfig().tolerance;
      const queue = this.selectedPlayers().map(({ p, set }) => {
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
      for (const e of this.queue) if (isOpen(e) && e.start) e.cap = tolCap(e.start, cfg.tolerance);
      const after = cfg.afterBuy === 'keep' ? 'gardés au club' : cfg.afterBuy === 'markup' ? `revendus avec +${cfg.markupPct} %` : "revendus au prix d'achat";
      this.log(`Achat de ${n} joueur(s), tolérance ${cfg.tolerance} palier(s) EA au-dessus du prix de départ, ${after}`);
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
        e.cap = tolCap(c.price, this.getConfig().tolerance);
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

    markCollected(defId) {
      this.done.add(defId);
      save(K_DONE, [...this.done]);
      for (const s of Object.values(this.sets)) if (s.players?.[defId]) s.players[defId].collected = true;
      this.saveSets();
    }

    async buyAndList(it, e) {
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
      if (cfg.afterBuy === 'keep' || this.pileCount >= PILE_MAX || pileFull()) {
        await keep(cfg.afterBuy === 'keep' ? '' : 'liste de transferts pleine');
        return 'ok';
      }
      const l = await listItem(it.raw, sellFor(price, cfg));
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

  // ---------- Panneau ----------

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.box { position: fixed; top: 64px; left: 16px; z-index: 2147483647; width: 420px; max-height: calc(100vh - 76px);
  display: flex; flex-direction: column; font: 12px/1.4 system-ui, sans-serif; color: #e6e7eb;
  background: #14161b; border: 1px solid #2a2e38; border-radius: 12px; box-shadow: 0 10px 30px #000a; overflow: hidden; }
.box.hidden { display: none; }
header, nav, .banner, .activity { flex: none; }
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
.body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 10px 12px; }
.tab { display: none; flex-direction: column; gap: 10px; } .tab.on { display: flex; }
h4 { margin: 0; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #7c8190; }
input, select { background: #0d0f13; color: inherit; border: 1px solid #2a2e38; border-radius: 6px; padding: 5px 7px; font: inherit; min-width: 0; }
input:focus, select:focus { outline: none; border-color: #4c6ef5; }
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
footer { border-top: 1px solid #2a2e38; padding: 8px 12px 10px; display: flex; flex-direction: column; gap: 6px; background: #171a20; flex: none; }
.recap { background: #1b1e25; border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
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
.opts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.speed { font-size: 11px; color: #a9aebb; display: flex; flex-direction: column; gap: 4px; }
.speed .grid { display: grid; grid-template-columns: 1fr auto; gap: 6px 8px; align-items: center; }
.speed .pair { display: flex; align-items: center; gap: 4px; color: #7c8190; }
.speed .pair input { width: 60px; text-align: right; }
.speed .presets { display: flex; gap: 4px; }
.speed .presets button.on { background: #364fc7; color: #fff; }
.speedline { background: none; padding: 0; font-size: 11px; font-weight: 500; color: #a9aebb; text-align: left; }
.speedline:hover { color: #e6e7eb; }
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
.live { flex: none; }
.live .lbody { padding: 0 8px 6px; }
.live .lbody .ev span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
.jlist { background: #0d0f13; border-radius: 6px; padding: 4px; }
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
      this.tabs = { buy: this.buildBuyTab(), sales: this.buildSalesTab(), log: this.buildLogTab(), settings: this.buildSettingsTab() };
      this.tabBtns = {};
      const nav = h('nav');
      for (const [id, label] of [['buy', 'Achats'], ['sales', 'Ventes'], ['log', 'Journal'], ['settings', 'Réglages']]) {
        this.tabBtns[id] = h('button', { textContent: label, onclick: () => this.showTab(id) });
        nav.append(this.tabBtns[id]);
      }
      this.salesBadge = h('span', { className: 'badge' });
      this.footer = this.buildFooter();
      this.live = this.buildLive();
      this.bodyEl = h('div', { className: 'body' }, ...Object.values(this.tabs));
      this.box.append(header, this.bannerEl, this.activityEl, nav, this.bodyEl, this.live, this.footer);
      this.showTab('buy');
      this.renderEvents(true);
      this.baseTitle = document.title;
      setInterval(() => this.tick(), 1e3);
      window.addEventListener('resize', () => this.fit());
      this.fit();
    }

    showTab(id) {
      this.tab = id;
      for (const [k, el] of Object.entries(this.tabs)) el.classList.toggle('on', k === id);
      for (const [k, b] of Object.entries(this.tabBtns)) b.classList.toggle('on', k === id);
      this.bodyEl.scrollTop = 0;
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
      this.recapEl = h('div', { style: 'display:flex;flex-direction:column;gap:8px' });
      const syncBtn = h('button', { textContent: '↻ Galerie EA', title: 'Relire chez EA les joueurs déjà collectés (même requête que FUT Simple Trader)' });
      syncBtn.onclick = async () => {
        if (this.engine.running) return this.engine.log('Lecture de la Galerie EA : attendre la fin de la tâche en cours (faite aussi avant chaque lot d’achats)');
        syncBtn.disabled = true;
        await this.engine.syncGallery();
        syncBtn.disabled = false;
      };
      const tolInput = h('input', { type: 'number', min: '0', max: String(MAX_TOLERANCE), step: '1', value: String(this.config.tolerance) });
      tolInput.onchange = () => {
        const v = Math.min(MAX_TOLERANCE, Math.max(0, Math.floor(Number(tolInput.value) || 0)));
        tolInput.value = String(v);
        this.setConfig({ tolerance: v });
        this.renderSets();
      };
      const afterSel = h('select', {}, ...Object.entries(AFTER_BUY).map(([v, label]) => h('option', { value: v, textContent: label, selected: v === this.config.afterBuy })));
      const markInput = h('input', { type: 'number', min: '0', max: '100', step: '1', value: String(this.config.markupPct) });
      const markWrap = h('span', { className: 'pair' }, '+', markInput, '%');
      const showMark = () => (markWrap.style.display = this.config.afterBuy === 'markup' ? '' : 'none');
      afterSel.onchange = () => (this.setConfig({ afterBuy: afterSel.value }), showMark(), this.renderSets());
      markInput.onchange = () => {
        const v = Math.min(100, Math.max(0, Number(markInput.value) || 0));
        markInput.value = String(v);
        this.setConfig({ markupPct: v });
        this.renderSets();
      };
      showMark();
      this.checkBtn = h('button', { className: 'small', onclick: () => (this.engine.mode === 'check' ? this.engine.stop('Vérification arrêtée', true) : void this.engine.checkPrices()) });
      this.raiseRow = h(
        'div',
        { className: 'opts' },
        h('label', { className: 'raise', title: 'Aucune annonce au prix de départ : le prix monte d’un palier EA par recherche, jusqu’à ce nombre de paliers. Au-delà : « prix monté », joueur sauté' }, 'Tolérance', tolInput, 'palier(s) EA'),
        h('label', { className: 'raise' }, 'Après achat', afterSel, markWrap),
        this.checkBtn,
      );
      this.speedLine = h('button', { className: 'speedline', title: 'Ouvrir les réglages', onclick: () => this.showTab('settings') });
      const recap = h('div', { className: 'recap' }, this.recapEl, this.raiseRow, this.speedLine);
      return h('section', { className: 'tab' }, h('div', { className: 'row' }, importBtn, syncBtn), recap, this.filtersEl, this.setsEl);
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
              h('li', { textContent: '« Vérifier les prix » (facultatif) : prix de départ = 4e annonce la moins chère du marché.' }),
              h('li', { textContent: '« Acheter » : achat de l’annonce la moins chère sous le prix de départ (+ tolérance en paliers EA), puis revente ou club selon « Après achat ».' }),
              h('li', { textContent: 'Onglet Ventes : « Relister » remet les invendus au prix le plus bas du marché.' }),
            ),
          ),
        );
        this.renderFooter();
        return;
      }
      const statusOf = new Map(e.queue.map((q) => [q.defId, q]));
      const inQueue = new Set(statusOf.keys());
      const top = this.bodyEl?.scrollTop ?? 0;
      this.setsEl.replaceChildren(...sets.map((s) => this.renderSet(s, statusOf, inQueue)));
      if (this.bodyEl) this.bodyEl.scrollTop = top;
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
      const busy = e.mode === 'buy' || e.mode === 'check';
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
      const cap = tolCap(start, this.config.tolerance);
      const cost = start - (this.config.afterBuy === 'keep' ? 0 : netOf(sellFor(start, this.config)));
      return [`${start !== p.minPrice ? `${ref} · ` : ''}${fmtNum(start)}${cap > start ? ` → max ${fmtNum(cap)}` : ''} · `, h('span', { className: 'loss', textContent: cost >= 0 ? `coût ${fmtNum(cost)}` : `gain ${fmtNum(-cost)}` })];
    }

    renderRows(visible, statusOf) {
      const e = this.engine;
      const busy = e.mode === 'buy' || e.mode === 'check';
      const rows = visible.map((p) => {
        const selected = e.isSelected(p.defId) && !p.collected;
        const q = statusOf.get(p.defId);
        const startOf = () => (selected ? Number(e.selection[p.defId]) || 0 : p.minPrice || 0);
        const cb = h('input', { type: 'checkbox', checked: selected, disabled: busy || p.collected });
        const price = h('input', { type: 'number', min: '150', step: String(step(p.minPrice || 200)), value: startOf() ? String(startOf()) : '', placeholder: 'sondage', disabled: busy || p.collected, title: 'Prix de départ (vide = sondage du marché)' });
        const meta = h('span', { className: 'm' }, ...this.rowMeta(p, startOf(), selected, q));
        const row = h('div', { className: `p${p.collected && !q ? ' got' : ''}${selected ? ' sel' : ''}` });
        const changed = () => {
          meta.replaceChildren(...this.rowMeta(p, cb.checked ? Number(e.selection[p.defId]) || 0 : Number(price.value) || 0, cb.checked, q));
          row.classList.toggle('sel', cb.checked);
          this.renderFooter();
          this.refreshSetHeads();
        };
        cb.onchange = () => {
          e.setSelected(p.defId, cb.checked, Math.floor(Number(price.value)) >= 150 ? Math.floor(Number(price.value)) : 0);
          changed();
        };
        price.onchange = () => {
          const raw = Math.floor(Number(price.value));
          const v = raw > 0 ? Math.max(150, Math.floor(raw / step(raw)) * step(raw)) : 0;
          price.value = v ? String(v) : '';
          cb.checked = true;
          e.setSelected(p.defId, true, v);
          changed();
        };
        row.append(cb, h('span', { className: 'n' }, p.rating ? h('i', { textContent: String(p.rating) }) : null, p.name), price, meta);
        if (q) {
          const parts = [STATUS_LABEL[q.status] ?? q.status];
          if (q.price) parts.push(`à ${fmtNum(q.price)}${q.sell ? `, en vente à ${fmtNum(q.sell)}` : ''}`);
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
      this.progressBar = h('div');
      this.mainBtn = h('button', { className: 'big go' });
      this.mainBtn.onclick = () => (this.engine.mode === 'buy' ? this.engine.stop('Achats arrêtés', true) : void this.engine.validate());
      this.resumeBtn = h('button', { className: 'big', onclick: () => void this.engine.runQueue() });
      // Pied fixe : seulement l'action principale (le récapitulatif est en haut de l'onglet Achats)
      return h('footer', {}, this.progressBar, this.mainBtn, this.resumeBtn);
    }

    // --- Onglet Réglages : vitesse, ralentissement, pauses, quotas ---

    buildSettingsTab() {
      this.speedEl = h('div', { className: 'speed' });
      this.renderSpeed();
      return h('section', { className: 'tab' }, this.speedEl);
    }

    // Réglages de vitesse : préréglages, délais (s), ralentissement après limite EA ; appliqués immédiatement
    renderSpeed() {
      const c = this.config;
      const keys = Object.keys(SPEED_DEFAULTS);
      const active = SPEED_PRESETS.find(([, v]) => keys.every((k) => v[k] === c[k]))?.[0];
      const dec = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
      const pace = this.engine.guard.pace(c);
      // scale : 1e3 pour des secondes stockées en ms ; min : valeur plancher
      const input = (k, stepV, scale = 1, min = 0) => {
        const i = h('input', { type: 'number', min: String(min), step: String(stepV), value: String(c[k] / scale) });
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
      const presets = SPEED_PRESETS.map(([name, v]) =>
        h('button', { className: `small${name === active ? ' on' : ''}`, textContent: name, onclick: () => (this.setConfig({ ...v }), this.renderSpeed()) }),
      );
      const off = c.paceStep <= 1 || c.paceMax <= 1 || c.paceResetMin <= 0;
      const paceState = off
        ? 'Ralentissement désactivé : seule la pause après limite EA s’applique.'
        : pace > 1
          ? `Rythme actuel ralenti ×${dec(pace)} (délais ${dec((c.minDelayMs * pace) / 1e3)}–${dec((c.maxDelayMs * pace) / 1e3)} s) jusqu’à ${hm(this.engine.guard.paceUntil(c))} sans nouvelle limite.`
          : 'Rythme normal.';
      const resetBtn = pace > 1 ? h('button', { className: 'small', textContent: 'Revenir au rythme normal', onclick: () => (this.engine.guard.resetPace(), this.engine.log('Rythme remis à la normale'), this.renderSpeed()) }) : null;
      const summary = `Vitesse : ${active ?? 'personnalisée'} (${dec(c.minDelayMs / 1e3)}–${dec(c.maxDelayMs / 1e3)} s entre recherches)${pace > 1 ? ` · ralenti ×${dec(pace)}` : ''}`;
      this.speedLine.textContent = `${summary} ›`;
      this.speedEl.replaceChildren(
        h(
          'div',
          { className: 'grid' },
          h('h4', { textContent: 'Vitesse', style: 'grid-column:1 / -1;margin-top:4px' }),
          h('span', { textContent: 'Préréglage' }),
          h('span', { className: 'presets' }, ...presets),
          h('span', { textContent: 'Délai entre recherches' }),
          pair('minDelayMs', 'maxDelayMs', 0.5),
          h('span', { textContent: 'Délai avant achat' }),
          pair('buyDelayMinMs', 'buyDelayMaxMs', 0.1),
          h('h4', { textContent: 'Ralentissement après limite EA', style: 'grid-column:1 / -1;margin-top:4px' }),
          h('span', { textContent: 'Multiplier les délais à chaque limite (1 = jamais)' }),
          h('span', { className: 'pair' }, '×', input('paceStep', 0.1, 1, 1)),
          h('span', { textContent: 'Ralentissement maximal' }),
          h('span', { className: 'pair' }, '×', input('paceMax', 0.5, 1, 1)),
          h('span', { textContent: 'Retour au rythme normal après (sans limite)' }),
          h('span', { className: 'pair' }, input('paceResetMin', 5), 'min'),
          h('h4', { textContent: 'Pauses après refus EA (0 = aucune, reprise immédiate)', style: 'grid-column:1 / -1;margin-top:4px' }),
          h('span', { textContent: 'Après limite EA 426 / 429 / 512 / 521 (min)' }),
          h('span', { className: 'pair' }, input('softPauseMin', 1), 'min'),
          h('span', { textContent: 'Après captcha 458 / 460 / 494 (min)' }),
          h('span', { className: 'pair' }, input('captchaPauseMin', 5), 'min'),
          h('h4', { textContent: 'Quotas (0 = illimité, cumulés avec SnipeFC27)', style: 'grid-column:1 / -1;margin-top:4px' }),
          h('span', { textContent: 'Recherches max par heure' }),
          h('span', { className: 'pair' }, input('quotaSearchHour', 50)),
          h('span', { textContent: 'Recherches max par 24 h' }),
          h('span', { className: 'pair' }, input('quotaSearchDay', 100)),
          h('span', { textContent: 'Achats max par 24 h' }),
          h('span', { className: 'pair' }, input('quotaBuyDay', 10)),
        ),
        h('div', { className: 'row', style: 'margin-top:6px' }, h('span', { className: 'note grow', textContent: paceState }), resetBtn),
        h('div', { className: 'note', style: 'margin-top:4px', textContent: 'Plus rapide = plus de risque de limite EA ou de captcha.' }),
      );
      this.paceShown = pace;
    }

    renderFooter() {
      const e = this.engine;
      const buying = e.mode === 'buy';
      this.recapEl.replaceChildren(...(buying ? this.progressView() : this.recapView()));
      const pk = e.picks();
      this.raiseRow.style.display = buying ? 'none' : '';
      const checking = e.mode === 'check';
      this.checkBtn.textContent = checking ? 'Arrêter la vérification' : 'Vérifier les prix';
      this.checkBtn.title = 'Sonde le marché pour chaque joueur coché : prix de départ = 4e annonce la moins chère (méthode FUT Simple Trader)';
      this.checkBtn.disabled = (e.running && !checking) || (!checking && !pk.count);
      this.mainBtn.className = buying ? 'big stop' : 'big go';
      const q = e.queue;
      const treated = q.filter((x) => !isOpen(x)).length;
      this.progressBar.replaceChildren(...(buying ? [bar([['ok', q.filter((x) => x.price > 0).length], ['over', q.filter(isFailed).length]], q.length)] : []));
      this.mainBtn.textContent = buying
        ? `Arrêter les achats (${treated}/${q.length})`
        : pk.count
          ? `Acheter ${pk.count} joueur${pk.count > 1 ? 's' : ''} · ~${fmtNum(pk.spend)} crédits · ${pk.cost < 0 ? `gain ~${fmtNum(-pk.cost)}` : `coût ~${fmtNum(pk.cost)}`}`
          : 'Coche des joueurs à acheter';
      this.mainBtn.disabled = e.mode === 'relist' || e.mode === 'check' || (!buying && !pk.count);
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
          tile('À dépenser', `${fmtNum(pk.spend)}`, pk.capSpend > pk.spend ? `jusqu'à ${fmtNum(pk.capSpend)} avec tolérance` : `${pk.list.length} joueur(s)`, tight ? 'warn' : ''),
          tile('Récupéré', `${fmtNum(pk.back)}`, this.config.afterBuy === 'keep' ? 'gardés au club' : 'net, à la revente'),
          tile('Coût réel', pk.cost < 0 ? `+${fmtNum(-pk.cost)}` : `${fmtNum(pk.cost)}`, pk.capCost > pk.cost ? `jusqu'à ${fmtNum(pk.capCost)} avec tolérance` : this.config.afterBuy === 'keep' ? 'prix payé' : 'taxe EA 5 %', pk.cost < 0 ? 'pos' : 'neg'),
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
              h('span', {}, h('i', { style: 'background:#2a3570' }), 'tolérance'),
              h('span', { textContent: tight ? `manque ${fmtNum(pk.spend - wallet)}` : `reste ${fmtNum(wallet - pk.spend)} / ${fmtNum(wallet)}` }),
            ),
          ),
        );
      }
      const notes = [];
      if (pk.unpriced.length) notes.push(`${pk.unpriced.length} joueur(s) sans prix : prix trouvé par sondage au lancement (ou « Vérifier les prix »), non compté ci-dessus.`);
      if (tight) notes.push('Crédits insuffisants pour tout acheter : les derniers joueurs seront sautés (ils restent cochés).');
      if (notes.length) out.push(h('div', { className: `note${tight ? ' warn' : ''}`, textContent: notes.join(' ') }));
      return out;
    }

    lastRunLine() {
      const q = this.engine.queue;
      const got = q.filter((x) => x.price > 0);
      const fail = q.filter(isFailed).length;
      return `Dernier lot : ${got.length}/${q.length} achetés, ${fmtNum(got.reduce((s, x) => s + x.price, 0))} dépensés, coût réel ~${fmtNum(got.reduce((s, x) => s + costOf(x), 0))}${fail ? `, ${fail} non acheté(s) (toujours cochés)` : ''}.`;
    }

    progressView() {
      const q = this.engine.queue;
      const got = q.filter((x) => x.price > 0);
      const fail = q.filter(isFailed).length;
      const open = q.filter(isOpen).length;
      const spent = got.reduce((s, x) => s + x.price, 0);
      const planned = q.reduce((s, x) => s + (x.price || x.start || 0), 0);
      const cur = q.find((x) => x.status === 'searching') ?? q.find(isOpen);
      const sets = [...new Set(q.map((x) => x.set))];
      const setLine = cur
        ? (() => {
            const inSet = q.filter((x) => x.set === cur.set);
            return `Set ${sets.indexOf(cur.set) + 1}/${sets.length} « ${cur.set} » : ${inSet.filter((x) => !isOpen(x)).length}/${inSet.length} traités`;
          })()
        : '';
      return [
        h(
          'div',
          { className: 'tiles' },
          tile('Achetés', `${got.length} / ${q.length}`, `${open} restant(s)${fail ? `, ${fail} non acheté(s)` : ''}`, 'pos'),
          tile('Dépensé', fmtNum(spent), `prévu ~${fmtNum(planned)}`),
          tile('Coût réel', fmtNum(got.reduce((s, x) => s + costOf(x), 0)), 'après revente / club', 'neg'),
        ),
        bar([['ok', got.length], ['over', fail]], q.length),
        setLine ? h('div', { className: 'note', style: 'color:#e6e7eb', textContent: setLine }) : null,
        cur ? h('div', { className: 'note', textContent: `En cours : ${cur.name}${cur.max ? ` ≤ ${fmtNum(cur.max)}${cur.max > cur.start ? ` (relevé, tolérance ${fmtNum(cur.cap)})` : ''}` : ' (sondage)'}` }) : null,
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
      this.relistBtn.className = relisting ? 'big stop' : 'big go';
      this.relistBtn.textContent = relisting ? 'Arrêter' : `Relister les invendus${s.unsold ? ` (${s.unsold})` : ''}`;
      this.relistBtn.disabled = e.mode === 'buy' || e.mode === 'check';
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
        this.liveList.replaceChildren(...evs.slice(0, 3).map((ev) => this.eventRow(ev)));
        this.jList.replaceChildren(...evs.filter((ev) => this.eventMatches(ev)).slice(0, 300).map((ev) => this.eventRow(ev)));
      } else {
        const fresh = evs.filter((ev) => ev.id > this.shownEventId).reverse();
        if (fresh.length) this.jList.querySelector('.empty')?.remove();
        for (const ev of fresh) {
          this.liveList.prepend(this.eventRow(ev));
          if (this.eventMatches(ev)) this.jList.prepend(this.eventRow(ev));
        }
        while (this.liveList.childElementCount > 3) this.liveList.lastChild.remove();
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
      // Les re-rendus ne doivent pas faire sauter la position de défilement
      const top = this.bodyEl.scrollTop;
      this.render(s);
      if (this.bodyEl.scrollTop !== top) this.bodyEl.scrollTop = top;
    }

    render(s) {
      const locked = s.lockedUntil > Date.now();
      this.pill.className = `pill${s.running ? ' on' : locked ? ' lock' : ''}`;
      this.pill.textContent = s.mode === 'buy' ? 'Achats' : s.mode === 'relist' ? 'Relister' : s.mode === 'check' ? 'Prix' : locked ? 'Pause' : 'Prêt';
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
      if (s.pace !== this.paceShown && !this.speedEl.contains(this.speedEl.getRootNode().activeElement)) this.renderSpeed();
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

    // Le panneau tient toujours dans la fenêtre : hauteur max = espace sous son bord haut
    fit() {
      const top = Math.min(Math.max(0, this.box.getBoundingClientRect().top), Math.max(0, window.innerHeight - 200));
      this.box.style.top = `${top}px`;
      this.box.style.maxHeight = `${Math.max(200, window.innerHeight - top - 12)}px`;
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
          this.fit();
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
          if (!engine.running) void engine.syncGallery([key]);
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
