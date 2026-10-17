// FC27 Trader : outils communs (prix EA, stockage, interception réseau, API Web App, garde-fous, journal)
(function () {
  const X = (globalThis.__fc27 = {});

  // Clés localStorage : préfixes des deux anciennes extensions conservés (filtres, sets, statistiques repris tels quels)
  X.SNIPE_NS = 'snipefc27';
  X.ALBUM_NS = 'albumfc27';
  X.APP = 'FC27 Trader';
  X.VERSION = '1.4.3';

  // ---------- Prix EA ----------

  const step = (p) => (p < 1e3 ? 50 : p < 1e4 ? 100 : p < 5e4 ? 250 : p < 1e5 ? 500 : 1e3);
  const nextPrice = (p) => p + step(p);
  const priceDown = (p) => Math.max(150, p - step(p - 1));
  const roundUp = (p) => Math.max(200, Math.ceil(p / step(p)) * step(p));
  const net = (p) => Math.floor(p * 0.95);
  const profitOf = (buy, sell) => (buy && sell ? net(sell) - buy : 0);
  const perHour = (v, ms) => (ms >= 3e5 ? Math.round((v * 36e5) / ms) : null);
  // Prix de vente minimal sans perte (taxe EA 5 % comprise)
  const breakEven = (p) => roundUp(p / 0.95);
  const roundPrice = (p) => Math.max(0, Math.round(p / step(p)) * step(p));
  const tickUp = (p) => roundPrice(p + step(p));
  const tickDown = (p) => Math.max(0, roundPrice(p - step(p - 1)));

  // Prix du sniper : achat un palier sous la moins chère, baissé jusqu'au profit visé (2 % du prix, 150 min, ou profit min choisi)
  function computePrices({ lowestOnMarket, minPrice, minProfit }) {
    const sell = priceDown(lowestOnMarket);
    const s = step(lowestOnMarket);
    const target = minProfit > 0 ? Math.round(minProfit) : Math.max(150, Math.round((lowestOnMarket * 0.02) / s) * s);
    const floor = minPrice ? nextPrice(minPrice) : 0;
    const base = { status: 'ok', buyPrice: sell, sellPrice: sell, targetProfit: target, profit: 0 };
    if (minPrice && sell < floor) return { ...base, status: 'belowListable' };
    let buy = sell;
    for (let i = 0; i < 5e3 && buy > Math.max(floor, 150) && profitOf(buy, sell) < target; i++) buy = priceDown(buy);
    const profit = profitOf(buy, sell);
    return { ...base, status: profit > 0 ? 'ok' : 'noProfit', buyPrice: buy, profit };
  }

  const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('fr-FR'));
  const fmtSigned = (n) => `${n > 0 ? '+' : ''}${fmt(n)}`;
  const rand = (a, b) => a + Math.random() * Math.max(0, b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const clockIn = (ms) => hm(Date.now() + ms);
  const pad = (n) => String(n).padStart(2, '0');
  const fmtMin = (ms) => {
    const m = Math.ceil(ms / 6e4);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  };
  const fmtClock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1e3));
    const h = Math.floor(s / 3600);
    return h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
  };
  const fmtWait = (ms) => {
    const sec = Math.max(0, Math.ceil(ms / 1e3));
    return sec >= 60 ? `${Math.floor(sec / 60)} min ${pad(sec % 60)} s` : `${sec} s`;
  };
  const errText = (e) => {
    if (e == null || e === '') return '';
    try {
      return ` [${(typeof e === 'string' ? e : JSON.stringify(e)).slice(0, 200)}]`;
    } catch {
      return '';
    }
  };
  const errMsg = (e) => (e instanceof Error ? e.message : String(e));

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
      return true;
    } catch {
      return false;
    }
  }

  Object.assign(X, { step, nextPrice, priceDown, roundUp, net, profitOf, perHour, breakEven, roundPrice, tickUp, tickDown, computePrices });
  Object.assign(X, { fmt, fmtSigned, rand, randInt, sleep, hm, clockIn, fmtMin, fmtClock, fmtWait, errText, errMsg, load, save });

  // ---------- Préréglages (moteur SnipeFC27) ----------

  X.LIMIT_PRESETS = {
    prudent: { label: 'Prudent', info: '600 / h, 3 000 / 24 h', searchesHour: 600, searchesDay: 3e3, bidsHour: 120, bidsDay: 600 },
    stevie: { label: 'Stevie', info: '900 / h, 4 500 / 24 h', searchesHour: 900, searchesDay: 4500, bidsHour: 180, bidsDay: 900 },
    nolimit: { label: 'No limit', info: 'aucun plafond, risque de ban élevé', searchesHour: Infinity, searchesDay: Infinity, bidsHour: Infinity, bidsDay: Infinity },
  };
  X.limitsOf = (k) => {
    const { searchesHour, searchesDay, bidsHour, bidsDay } = X.LIMIT_PRESETS[k] ?? X.LIMIT_PRESETS.prudent;
    return { searchesHour, searchesDay, bidsHour, bidsDay };
  };
  X.DELAY_PRESETS = {
    safest: { label: 'Long', info: '4-6 s', min: 4e3, max: 6e3 },
    safe: { label: 'Normal', info: '3-5 s', min: 3e3, max: 5e3 },
    risky: { label: 'Risqué', info: '2-3 s', min: 2e3, max: 3e3 },
    dangerous: { label: 'Dangereux', info: '1-2 s', min: 1e3, max: 2e3 },
  };
  X.BREAK_PRESETS = {
    safest: { label: 'Long', info: 'pause 5-10 min toutes les 3-8 min, 20-40 min toutes les 60-90 min', every: [180, 480], rest: [300, 600], longEvery: [3600, 5400], longRest: [1200, 2400] },
    safe: { label: 'Normal', info: 'pause 3-5 min toutes les 5-10 min, 15-30 min toutes les 90-120 min', every: [300, 600], rest: [180, 300], longEvery: [5400, 7200], longRest: [900, 1800] },
    risky: { label: 'Risqué', info: 'pause 1-3 min toutes les 8-15 min, 10-20 min toutes les 2-3 h', every: [480, 900], rest: [60, 180], longEvery: [7200, 10800], longRest: [600, 1200] },
    dangerous: { label: 'Dangereux', info: 'aucune pause', every: null, rest: null, longEvery: null, longRest: null },
  };
  X.AFTER_BUY = { keep: 'Garder au club', relist: "Revendre au prix d'achat", markup: 'Revendre avec marge' };

  // ---------- Réglages (un seul objet, enregistré sous la clé de SnipeFC27) ----------

  X.DEFAULTS = {
    snipeFilters: '[]',
    activeFilter: 0,
    sellAfterSnipe: true,
    rotate: false,
    breakPreset: 'safe',
    delayPreset: 'safe',
    mistakePrevention: true,
    recheckEvery: 50,
    minProfit: 0,
    snipeSound: true,
    limitsPreset: 'prudent',
    maxBuysPerSearch: 2,
    tolerance: 3,
    toleranceAuto: true,
    afterBuy: 'relist',
    markupPct: 5,
    autoCatalog: true,
    levelTarget: 3e6,
    levelScore: 0,
    levelBudget: 0,
    tab: 'snipe',
  };
  const K_CONFIG = `${X.SNIPE_NS}:config`;
  X.loadConfig = () => {
    const raw = load(K_CONFIG, {}) ?? {};
    const out = { ...X.DEFAULTS };
    for (const k of Object.keys(X.DEFAULTS)) if (typeof raw[k] === typeof X.DEFAULTS[k]) out[k] = raw[k];
    // Première ouverture : réglages Galerie repris d'AlbumFC27, mode nuit actif = alternance des cibles
    if (!raw.merged) {
      const a = load(`${X.ALBUM_NS}:config`, null);
      if (a) {
        if (Number.isFinite(Number(a.tolerance))) out.tolerance = Math.min(10, Math.max(0, Math.floor(Number(a.tolerance))));
        if (typeof a.toleranceAuto === 'boolean') out.toleranceAuto = a.toleranceAuto;
        if (X.AFTER_BUY[a.afterBuy]) out.afterBuy = a.afterBuy;
        if (Number.isFinite(Number(a.markupPct))) out.markupPct = Math.min(100, Math.max(0, Number(a.markupPct)));
        if (typeof a.autoCatalog === 'boolean') out.autoCatalog = a.autoCatalog;
      }
      if (load(`${X.SNIPE_NS}:night`, false) === true) out.rotate = true;
      save(K_CONFIG, { ...out, merged: true });
    }
    if (!X.DELAY_PRESETS[out.delayPreset]) out.delayPreset = 'safe';
    if (!X.BREAK_PRESETS[out.breakPreset]) out.breakPreset = 'safe';
    return out;
  };
  X.saveConfig = (cfg) => save(K_CONFIG, { ...cfg, merged: true });
  X.parseFilters = (json) => {
    try {
      const v = JSON.parse(json);
      return Array.isArray(v) ? v.filter((f) => f && typeof f.id === 'string') : [];
    } catch {
      return [];
    }
  };

  // ---------- Interception réseau ----------
  // Liste de transferts (ventes), statut Galerie (isCollected) et session EA (remise en vente par identifiant)

  const PILE_RE = /\/tradepile(\?|$)/i;
  let lastPile = null;
  const pileListeners = [];
  X.netItems = new Map();
  X.eaApi = { base: null, headers: {} };
  X.lastPile = () => lastPile;
  X.onPile = (cb) => pileListeners.push(cb);

  // Attributs utiles à la Galerie (note, rareté, ligue, club, nation), depuis un itemData EA ou une carte Web App
  X.attrsFrom = (it) => {
    if (!it || typeof it !== 'object') return null;
    const pos = (v) => (Number(v) > 0 ? Number(v) : 0);
    const f = Number(it.rareflag ?? it._rareflag);
    return {
      r: pos(it.rating ?? it._rating),
      f: it.rareflag == null && it._rareflag == null ? null : Number.isFinite(f) ? f : null,
      l: pos(it.leagueId ?? it._leagueId),
      c: pos(it.teamId ?? it.teamid ?? it._teamId),
      n: pos(it.nationId ?? it.nation ?? it._nationId),
    };
  };
  function recordItems(j) {
    const list = [...(Array.isArray(j.itemData) ? j.itemData : []), ...(Array.isArray(j.auctionInfo) ? j.auctionInfo.map((a) => a?.itemData) : [])];
    for (const it of list) {
      const defId = Number(it?.resourceId ?? 0);
      if (!defId || it.itemType !== 'player') continue;
      X.netItems.set(defId, { ...X.attrsFrom(it), collected: it.isCollected === true || !!X.netItems.get(defId)?.collected });
    }
  }
  X.defidPages = new Map();
  // Diagnostic Galerie : dernières réponses EA dont l'URL évoque la Galerie (format FC 27 non documenté)
  X.galleryDiag = [];
  // Score et niveau Galerie s'ils passent dans une réponse EA (format non documenté : champs cherchés par nom)
  X.galleryLive = null;
  function recordGallery(url, j) {
    const found = { score: 0, level: 0 };
    const walk = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 4) return;
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'number' && v > 0) {
          if (/^(gallery|total|overall)?_?score$/i.test(k) && v > found.score) found.score = v;
          else if (/^(gallery|player)?_?level$/i.test(k) && v <= 100 && v > found.level) found.level = v;
        } else walk(v, depth + 1);
      }
    };
    walk(j, 0);
    try {
      X.galleryDiag = [{ url: String(url).replace(/\?.*$/, ''), at: Date.now(), body: JSON.stringify(j).slice(0, 4e3) }, ...X.galleryDiag].slice(0, 12);
    } catch {}
    if (found.score || found.level) X.galleryLive = { ...found, url: String(url).replace(/\?.*$/, ''), at: Date.now() };
  }
  function onResponse(url, status, body) {
    if (status !== 200) return;
    const text = typeof body === 'string' ? body : null;
    let j = typeof body === 'object' && body ? body : null;
    if (/\/ut\/game\/[^?]*(gallery|collection|album)/i.test(url)) {
      try {
        j ??= JSON.parse(text);
        recordGallery(url, j);
      } catch {}
    }
    // Page de la recherche « concept » (base complète des joueurs) : /defid?start=… sans defId
    if (/\/ut\/game\/[^/]+\/defid\?/i.test(url)) {
      try {
        const u = new URL(url, location.href);
        if (!u.searchParams.has('defId')) {
          j ??= JSON.parse(text);
          X.defidPages.set(Number(u.searchParams.get('start')) || 0, { at: Date.now(), items: Array.isArray(j?.itemData) ? j.itemData : [] });
        }
      } catch {}
    }
    if (/\/ut\/game\//i.test(url) && (j || /"itemData"/.test(text ?? ''))) {
      try {
        j ??= JSON.parse(text);
        recordItems(j);
      } catch {}
    }
    if (PILE_RE.test(url)) {
      try {
        j ??= JSON.parse(text);
        if (!Array.isArray(j?.auctionInfo)) return;
        lastPile = { at: Date.now(), auctions: j.auctionInfo };
      } catch {
        return;
      }
      for (const cb of pileListeners)
        try {
          cb(lastPile.auctions);
        } catch {}
    }
  }
  function noteUrl(url) {
    try {
      const m = new URL(String(url), location.href).href.match(/^(https?:\/\/[^?#]*?\/ut\/game\/[^/?#]+\/)/i);
      if (m) X.eaApi.base = m[1];
    } catch {}
  }
  function noteHeader(name, value) {
    if (/^x-ut-/i.test(String(name)) && value) X.eaApi.headers[String(name)] = String(value);
  }
  X.installNetHooks = () => {
    const P = XMLHttpRequest.prototype;
    const open = P.open;
    const setHeader = P.setRequestHeader;
    P.setRequestHeader = function (name, value) {
      noteHeader(name, value);
      return setHeader.call(this, name, value);
    };
    P.open = function (method, url, ...rest) {
      noteUrl(url);
      this.addEventListener('readystatechange', () => {
        if (this.readyState !== 4) return;
        if (this.responseType === '' || this.responseType === 'text') onResponse(String(url), this.status, this.responseText);
        else if (this.responseType === 'json') onResponse(String(url), this.status, this.response);
      });
      return open.call(this, method, url, ...rest);
    };
    const f = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/\/ut\//i.test(url)) {
        noteUrl(url);
        try {
          new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).forEach((v, k) => noteHeader(k, v));
        } catch {}
      }
      const res = await f.call(this, input, init);
      if (/\/ut\//i.test(url))
        res
          .clone()
          .text()
          .then((t) => onResponse(url, res.status, t))
          .catch(() => {});
      return res;
    };
  };

  // ---------- API Web App ----------

  X.BAD_STATUS = new Set([426, 429, 458, 460, 494, 512, 521]);
  X.MISS_STATUS = new Set([403, 461, 478]);
  X.PILE_MAX = 100;

  X.webAppReady = () => {
    try {
      return typeof services !== 'undefined' && !!services.Item && !!services.User?.getUser?.();
    } catch {
      return false;
    }
  };
  // Appel Web App (observable) : 20 s sans réponse = échec
  X.observe = (obs) =>
    new Promise((resolve) => {
      if (typeof obs?.observe !== 'function') return resolve({ success: false, status: -1, data: undefined, error: 'fonction Web App introuvable' });
      const timer = setTimeout(() => resolve({ success: false, status: -2, data: undefined, error: 'pas de réponse' }), 2e4);
      obs.observe(undefined, (_, r) => {
        clearTimeout(timer);
        resolve({
          success: !!r?.success,
          status: Number((!r?.success && r?.error?.code) || r?.status || 0),
          data: r?.data,
          response: r?.response,
          error: r?.error ?? r?.data?.reason ?? r?.data?.message,
        });
      });
    });
  X.coins = () => {
    try {
      return Number(services.User.getUser().coins.amount);
    } catch {
      return null;
    }
  };
  X.refreshCoins = async () => {
    await X.observe(services.User.requestCurrencies?.());
    return X.coins();
  };
  X.staticName = (i, fallback) => {
    const s = i?._staticData ?? i?.getStaticData?.() ?? {};
    return String(s.name || [s.firstName, s.lastName].filter(Boolean).join(' ') || fallback || i?.definitionId || '?');
  };
  X.mapItem = (i) => {
    const a = i._auction ?? i.getAuctionData?.() ?? {};
    const lim = i._itemPriceLimits;
    const defId = Number(i.definitionId ?? 0);
    let sr = NaN;
    try {
      sr = Number(typeof a.getSecondsRemaining === 'function' ? a.getSecondsRemaining() : a.expires);
    } catch {}
    return {
      raw: i,
      tradeId: Number(a.tradeId),
      buyNow: Number(a.buyNowPrice),
      rating: Number(i.rating ?? i._rating ?? 0),
      name: X.staticName(i),
      expires: Number(a.expires ?? 0),
      sr,
      defId,
      minPrice: lim && Number(lim.minimum) > 0 ? Number(lim.minimum) : null,
      collected: X.netItems.get(defId)?.collected === true,
    };
  };
  // Recherche du sniper : filtre (joueur ou critères copiés de la Web App), bornes de prix variées pour éviter le cache EA
  X.searchFilter = async (filter, range) => {
    const c = X.newCriteria();
    if (filter.criteria) Object.assign(c, filter.criteria);
    else {
      c.type = typeof SearchType !== 'undefined' ? SearchType.PLAYER : 'player';
      if (filter.defId) c.defId = [filter.defId];
    }
    c.minBuy = range.minBuy ?? 0;
    c.maxBuy = range.maxBuy ?? 0;
    c.minBid = range.minBid ?? 0;
    c.maxBid = range.maxBid ?? 0;
    services.Item.clearTransferMarketCache?.();
    const r = await X.observe(services.Item.searchTransferMarket(c, 1));
    return { ...r, data: (r.data?.items ?? []).map(X.mapItem) };
  };
  // Recherche Galerie : carte exacte, 21 annonces demandées
  X.PAGE_COUNT = 21;
  X.PAGE_FULL = 20;
  X.searchCard = async (defId, { minBuy = 0, maxBuy = 0, minBid = 0 } = {}) => {
    const c = X.newCriteria();
    c.type = typeof SearchType !== 'undefined' ? SearchType.PLAYER : 'player';
    c.defId = [defId];
    c.count = X.PAGE_COUNT;
    if (minBuy > 0) c.minBuy = minBuy;
    if (maxBuy > 0) c.maxBuy = maxBuy;
    if (minBid > 0) c.minBid = minBid;
    services.Item.clearTransferMarketCache?.();
    const r = await X.observe(services.Item.searchTransferMarket(c, 1));
    return { ...r, data: (r.data?.items ?? []).map(X.mapItem) };
  };
  X.bid = (item) => X.observe(services.Item.bid(item.raw, item.buyNow));
  X.toTransfer = (raw) => X.observe(services.Item.move(raw, ItemPile.TRANSFER));
  X.toClub = (raw) => X.observe(services.Item.move(raw, ItemPile.CLUB));
  // Mise en vente 1 h, enchère de départ un palier sous le prix
  X.listAt = (raw, price) => X.observe(services.Item.list(raw, priceDown(price), price, 3600));
  // Mise en vente bornée à la fourchette EA de la carte (demandée si absente) ; renvoie le prix retenu
  X.listClamped = async (raw, buyNow) => {
    let sell = buyNow;
    let lim = null;
    try {
      if (!raw.hasPriceLimits?.()) await X.observe(services.Item.requestMarketData(raw));
      const l = raw.getPriceLimits?.();
      if (l && l.maximum > 0) lim = { min: Number(l.minimum), max: Number(l.maximum) };
    } catch {}
    if (lim) sell = Math.min(Math.max(sell, lim.min), lim.max);
    let start = tickDown(sell);
    if (lim && start < lim.min) start = lim.min;
    if (start >= sell) start = priceDown(sell);
    const r = await X.observe(services.Item.list(raw, start, sell, 3600));
    return { ...r, price: sell };
  };
  // Même requête que la Web App (POST auctionhouse), pour une carte que la Web App n'a pas chargée
  X.listById = (id, buyNow) =>
    new Promise((resolve) => {
      const api = X.eaApi;
      if (!api.base || !Object.keys(api.headers).length) return resolve({ success: false, status: -1, error: 'session EA pas encore vue : ouvre la liste de transferts puis relance' });
      const x = new XMLHttpRequest();
      x.open('POST', `${api.base}auctionhouse`);
      for (const [k, v] of Object.entries(api.headers)) x.setRequestHeader(k, v);
      x.setRequestHeader('Content-Type', 'application/json');
      x.onload = () => resolve({ success: x.status >= 200 && x.status < 300, status: x.status, error: x.status >= 300 ? String(x.responseText || '').slice(0, 200) : undefined });
      x.onerror = () => resolve({ success: false, status: 0, error: 'réseau' });
      x.send(JSON.stringify({ itemData: { id: Number(id) }, startingBid: priceDown(buyNow), duration: 3600, buyNowPrice: buyNow }));
    });
  X.pileFull = () => {
    try {
      return !!repositories.Item.isPileFull(ItemPile.TRANSFER);
    } catch {
      return false;
    }
  };
  X.transferCount = () => {
    try {
      const n = repositories?.Item?.getTransferItems?.()?.length;
      return typeof n === 'number' ? n : null;
    } catch {
      return null;
    }
  };
  const transferItems = () => {
    try {
      const v = repositories?.Item?.getTransferItems?.();
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  X.tradeState = (s, cur) => (s === 'closed' && cur > 0 ? 'sold' : s === 'expired' || s === 'closed' ? 'expired' : s === 'active' ? 'active' : 'unlisted');
  const mapAuctions = (auctions, byId) =>
    auctions.map((a) => {
      const id = Number(a.itemData?.id);
      const raw = byId.get(id);
      return {
        raw,
        id,
        tradeId: Number(a.tradeId ?? 0),
        defId: Number(raw?.definitionId ?? a.itemData?.resourceId ?? 0),
        type: String(a.itemData?.itemType ?? raw?.type ?? 'player'),
        name: X.staticName(raw, a.itemData?.resourceId ?? id),
        state: X.tradeState(String(a.tradeState ?? ''), Number(a.currentBid ?? 0)),
        soldPrice: Number(a.currentBid ?? 0),
        buyNow: Number(a.buyNowPrice ?? 0),
      };
    });
  X.soldFromAuctions = (auctions) =>
    mapAuctions(auctions, new Map(transferItems().filter((i) => i?.id).map((i) => [Number(i.id), i]))).filter((i) => i.state === 'sold');
  // Cartes Web App de la liste de transferts : selon la version, dans data.items, response.items ou le dépôt local
  function transferEntities(r) {
    const isItem = (x) => x && typeof x === 'object' && Number(x.id) > 0 && ('definitionId' in x || typeof x.getAuctionData === 'function');
    const lists = [r?.data?.items, r?.response?.items, r?.data?.response?.items, Array.isArray(r?.data) ? r.data : null];
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
  // Liste de transferts : réponse réseau fraîche si vue, sinon cache Web App (annonce active sans temps restant = expirée)
  X.readTradePile = async () => {
    try {
      repositories?.Item?.setDirty?.(ItemPile.TRANSFER);
    } catch {}
    const t0 = Date.now();
    const r = await X.observe(services.Item.requestTransferItems?.());
    const items = transferEntities(r);
    const byId = new Map(items.map((i) => [Number(i.id), i]));
    let pile = lastPile;
    for (let n = 0; n < 10 && !(pile && pile.at >= t0); n++) {
      await sleep(50);
      pile = lastPile;
    }
    if (pile && pile.at >= t0) return { success: true, status: 200, fresh: true, complete: true, data: mapAuctions(pile.auctions, byId) };
    return {
      ...r,
      fresh: false,
      complete: r.success && items.length > 0,
      data: items.map((i) => {
        const a = i._auction ?? i.getAuctionData?.() ?? {};
        const cur = Number(a.currentBid ?? 0);
        let state = X.tradeState(String(a.tradeState ?? ''), cur);
        if (state === 'active' && Number(a.expires ?? 1) <= 0) state = 'expired';
        return { raw: i, id: Number(i.id), tradeId: Number(a.tradeId ?? 0), defId: Number(i.definitionId ?? 0), type: String(i.type ?? 'player'), name: X.staticName(i), state, soldPrice: cur, buyNow: Number(a.buyNowPrice ?? 0) };
      }),
    };
  };
  X.requestUnassigned = async () => {
    try {
      repositories?.Item?.setDirty?.(ItemPile.PURCHASED);
    } catch {}
    const r = await X.observe(services.Item.requestUnassignedItems?.());
    return { ...r, data: r.data?.items ?? [] };
  };
  // Critères de recherche de la Web App : classe globale, sinon retrouvée par ses méthodes (nom minifié selon les versions)
  let Criteria = null;
  X.newCriteria = () => {
    if (!Criteria) {
      if (typeof UTSearchCriteriaDTO === 'function') Criteria = UTSearchCriteriaDTO;
      else
        for (const k of Object.getOwnPropertyNames(window))
          try {
            const v = window[k];
            if (typeof v === 'function' && v.prototype && 'hasValidDefId' in v.prototype && 'resetDefId' in v.prototype) {
              Criteria = v;
              break;
            }
          } catch {}
    }
    if (!Criteria) throw new Error('classe de critères de recherche introuvable dans la Web App');
    return new Criteria();
  };
  // Base complète des joueurs du jeu, 200 par page ; la réponse EA (/defid) donne isCollected (Galerie) et les attributs de chaque carte
  X.CONCEPT_PAGE = 200;
  X.searchConcept = async (offset) => {
    if (typeof services.Item.searchConceptItems !== 'function') return { success: false, status: -1, error: 'recherche « concept » absente de cette version de la Web App', items: null };
    const c = X.newCriteria();
    c.type = typeof SearchType !== 'undefined' ? SearchType.PLAYER : 'player';
    c.sort = 'desc';
    c.count = X.CONCEPT_PAGE;
    c.offset = offset;
    try {
      Object.defineProperty(c, 'cacheable', { value: false });
    } catch {}
    X.defidPages.delete(offset);
    const r = await X.observe(services.Item.searchConceptItems(c));
    for (let n = 0; n < 40 && !X.defidPages.has(offset); n++) await sleep(50);
    return { ...r, items: X.defidPages.get(offset)?.items ?? null };
  };
  // Club : joueurs possédés, page par page (même recherche que l'écran Club de la Web App)
  X.CLUB_PAGE = 91;
  X.searchClub = async (offset) => {
    const c = X.newCriteria();
    c.type = typeof SearchType !== 'undefined' ? SearchType.PLAYER : 'player';
    c.offset = offset;
    c.count = X.CLUB_PAGE;
    const r = await X.observe(services.Club?.search?.(c));
    const res = r.response ?? r.data ?? {};
    const items = Array.isArray(res.items) ? res.items : [];
    return { ...r, items, all: res.retrievedAll === true || items.length < X.CLUB_PAGE };
  };
  X.clearSold = () => X.observe(services.Item.clearSoldItems?.());
  X.relistExpired = () => X.observe(services.Item.relistExpiredAuctions?.());

  // Statut Galerie par definitionId : GET /ut/game/<jeu>/defid?type=player&defId=… (250 par requête)
  X.DEFID_CHUNK = 250;
  X.requestDefIds = (ids) =>
    new Promise((resolve) => {
      const Req = window.UTHttpRequest;
      const queue = window.services?.UTUtasRequestQueue;
      const dao = window.services?.Item?.itemDao;
      if (!Req || !queue || !dao) return resolve({ success: false, status: -1, error: 'requête Galerie indisponible dans cette version de la Web App' });
      const game = typeof window.GAME_NAME === 'string' && window.GAME_NAME ? window.GAME_NAME : `fc${String(window.fut_year || '2027').slice(-2)}`;
      try {
        const req = new Req(dao.authDelegate);
        req.setPath(`/ut/game/${game}/defid`);
        req.setUrlVariables({ count: X.DEFID_CHUNK, sort: 'desc', start: 0, type: 'player', defId: ids });
        const tag = {};
        const timer = setTimeout(() => resolve({ success: false, status: 0, error: 'pas de réponse EA en 20 s' }), 2e4);
        queue.send(req).observe(tag, (obs, r) => {
          clearTimeout(timer);
          obs.unobserve?.(tag);
          resolve(r?.success && Array.isArray(r.response?.itemData) ? { success: true, items: r.response.itemData } : { success: false, status: Number(r?.status ?? 0), error: r?.error });
        });
      } catch (err) {
        resolve({ success: false, status: -1, error: errMsg(err) });
      }
    });

  // Filtre réglé dans la recherche du marché de la Web App
  const isCriteria = (c) => c && typeof c === 'object' && typeof c.maskedDefId === 'number' && typeof c._type === 'string';
  X.liveCriteria = () => {
    try {
      const ctl = globalThis.getAppMain?.()?.getRootViewController?.()?.getPresentedViewController?.()?.getCurrentViewController?.()?.getCurrentController?.();
      const c = ctl?.viewmodel?.searchCriteria ?? ctl?._viewmodel?.searchCriteria;
      if (!isCriteria(c)) return null;
      const out = {};
      for (const [k, v] of Object.entries(c))
        if (!['minBuy', 'maxBuy', 'minBid', 'maxBid'].includes(k) && (['number', 'string', 'boolean'].includes(typeof v) || (Array.isArray(v) && v.every((x) => typeof x !== 'object')))) out[k] = v;
      return out;
    } catch {
      return null;
    }
  };
  X.emptyCriteria = (c) =>
    c._type === 'player' &&
    !(Array.isArray(c.rarities) && c.rarities.length) &&
    Object.entries({ maskedDefId: 0, league: -1, level: 'any', playStyle: -1, nation: -1, _position: 'any', icontraits: 'any' }).every(([k, v]) => c[k] === undefined || c[k] === v);

  // Base joueurs de la Web App (players.json), pour chercher une cible par nom
  let players = null;
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  X.loadPlayers = async () => {
    if (players) return players;
    const url = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .find((n) => /\/players\.json(\?|$)/.test(n));
    if (!url) throw new Error('base joueurs non chargée par la Web App : ouvre une recherche de joueur sur le marché puis réessaie');
    const r = await fetch(url);
    if (!r.ok) throw new Error(`base joueurs inaccessible (HTTP ${r.status})`);
    const j = await r.json();
    players = [...(j.Players ?? []).map((p) => ({ ...p, legend: false })), ...(j.LegendsPlayers ?? []).map((p) => ({ ...p, legend: true }))]
      .filter((p) => p.id)
      .map((p) => {
        const full = [p.f, p.l].filter(Boolean).join(' ');
        return { id: p.id, name: p.c || full || String(p.id), rating: p.r ?? 0, search: norm(`${full} ${p.c ?? ''}`), legend: p.legend };
      });
    return players;
  };
  X.findPlayers = (list, q, n = 8) => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return words.length ? list.filter((p) => words.every((w) => p.search.includes(w))).sort((a, b) => b.rating - a.rating).slice(0, n) : [];
  };

  // ---------- Son ----------

  let audio = null;
  X.unlockAudio = () => {
    try {
      audio ??= new AudioContext();
      if (audio.state === 'suspended') audio.resume();
    } catch {}
  };
  X.beep = () => {
    try {
      X.unlockAudio();
      const t = audio.currentTime;
      for (const [freq, at, len] of [
        [988, 0, 0.08],
        [1319, 0.08, 0.4],
      ]) {
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.type = 'square';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.08, t + at);
        g.gain.exponentialRampToValueAtTime(0.001, t + at + len);
        o.connect(g).connect(audio.destination);
        o.start(t + at);
        o.stop(t + at + len);
      }
    } catch {}
  };

  // ---------- Garde-fous : quotas anti-ban et pause après captcha / limite EA (communs à toutes les tâches) ----------

  const HOUR = 36e5;
  const DAY = 24 * HOUR;
  X.HOUR = HOUR;
  X.DAY = DAY;
  // Pause courte après un refus EA : 30-60 min, doublée si ça se répète dans les 24 h, plafond 4 h
  X.LOCK_BASE = [30 * 6e4, 60 * 6e4];
  X.LOCK_CAP = 4 * HOUR;
  const K_GUARD = `${X.SNIPE_NS}:guard`;
  const waitFor = (arr, win, max) => {
    const now = Date.now();
    const inWin = arr.filter((t) => now - t < win);
    const first = inWin[Math.max(0, inWin.length - max)] ?? now;
    return Math.max(6e4, first + win - now + 5e3);
  };
  X.Guard = class {
    constructor(getMax) {
      this.getMax = getMax;
      this.s = { searches: [], purchases: [], lockedUntil: 0, lockStreak: 0, lastLockAt: 0, ...load(K_GUARD, {}) };
      // Ancien verrou de 12 h de SnipeFC27 ramené à la pause courte
      if (this.s.lockedUntil - Date.now() > X.LOCK_BASE[1]) this.s.lockedUntil = Date.now() + X.LOCK_BASE[1];
      // Historique d'AlbumFC27 fusionné une fois (quotas cumulés)
      const old = load(`${X.ALBUM_NS}:guard`, null);
      if (old) {
        this.s.searches = [...this.s.searches, ...(old.searches ?? [])].sort((a, b) => a - b);
        this.s.purchases = [...this.s.purchases, ...(old.purchases ?? [])].sort((a, b) => a - b);
        try {
          localStorage.removeItem(`${X.ALBUM_NS}:guard`);
        } catch {}
      }
      this.save();
    }
    save() {
      const now = Date.now();
      this.s.searches = this.s.searches.filter((t) => now - t < DAY);
      this.s.purchases = this.s.purchases.filter((t) => now - t < DAY);
      save(K_GUARD, this.s);
    }
    lockRemainingMs() {
      return Math.max(0, this.s.lockedUntil - Date.now());
    }
    lockedUntil() {
      return this.lockRemainingMs() > 0 ? this.s.lockedUntil : 0;
    }
    unlock() {
      this.s.lockedUntil = 0;
      this.save();
    }
    lockPause() {
      const now = Date.now();
      this.s.lockStreak = now - (this.s.lastLockAt ?? 0) < DAY ? (this.s.lockStreak ?? 0) + 1 : 0;
      this.s.lastLockAt = now;
      const ms = Math.min(X.LOCK_CAP, rand(...X.LOCK_BASE) * 2 ** this.s.lockStreak);
      this.s.lockedUntil = Math.max(this.s.lockedUntil, now + ms);
      this.save();
      return this.s.lockedUntil - now;
    }
    recordSearch() {
      this.s.searches.push(Date.now());
      this.save();
    }
    recordPurchase() {
      this.s.purchases.push(Date.now());
      this.save();
    }
    limits() {
      const now = Date.now();
      const within = (arr, win) => arr.filter((t) => now - t < win);
      const end = (arr, win) => (arr.length ? arr[0] + win : null);
      const sh = within(this.s.searches, HOUR);
      const sd = within(this.s.searches, DAY);
      const bh = within(this.s.purchases, HOUR);
      const bd = within(this.s.purchases, DAY);
      return {
        searchesHour: sh.length,
        searchesDay: sd.length,
        bidsHour: bh.length,
        bidsDay: bd.length,
        searchesHourEnd: end(sh, HOUR),
        searchesDayEnd: end(sd, DAY),
        bidsHourEnd: end(bh, HOUR),
        bidsDayEnd: end(bd, DAY),
        max: this.getMax(),
      };
    }
    checkBid() {
      const l = this.limits();
      if (l.bidsDay >= l.max.bidsDay) return { ok: false, waitMs: waitFor(this.s.purchases, DAY, l.max.bidsDay), reason: `Limite de ${l.max.bidsDay} achats / 24 h atteinte` };
      if (l.bidsHour >= l.max.bidsHour) return { ok: false, waitMs: waitFor(this.s.purchases, HOUR, l.max.bidsHour), reason: `Limite de ${l.max.bidsHour} achats / h atteinte` };
      return { ok: true };
    }
    check() {
      const lock = this.lockRemainingMs();
      if (lock > 0) return { ok: false, locked: true, waitMs: lock, reason: `Pause anti-captcha encore ${fmtMin(lock)}` };
      const l = this.limits();
      if (l.searchesDay >= l.max.searchesDay) {
        const w = waitFor(this.s.searches, DAY, l.max.searchesDay);
        return { ok: false, waitMs: w, reason: `Quota journalier de recherches atteint (${l.searchesDay}), reprise dans ${fmtMin(w)}` };
      }
      if (l.searchesHour >= l.max.searchesHour) {
        const w = waitFor(this.s.searches, HOUR, l.max.searchesHour);
        return { ok: false, waitMs: w, reason: `Quota horaire atteint (${l.searchesHour}), reprise dans ${fmtMin(w)}` };
      }
      return { ok: true };
    }
  };

  // ---------- Journal unique ----------

  const K_EVENTS = `${X.ALBUM_NS}:events`;
  const EVENT_RULES = [
    [/^(Acheté|Snipé) /, 'buy'],
    [/^Vendu /, 'sell'],
    [/mis en vente à|relisté à|gardé au club|[Mm]is en vente /, 'list'],
    [/prix relevé/, 'warn'],
    [/^Raté |aucune annonce|non trouvé/i, 'miss'],
    [/captcha|Statut EA|Limite EA|anti-ban/i, 'lock'],
    [/erreur|échou|impossible|refusée/i, 'error'],
    [/quota|insuffisants|pleine|relevé|manque/i, 'warn'],
  ];
  X.journal = {
    events: load(K_EVENTS, []) ?? [],
    seq: 0,
    timer: null,
    add(msg, type, major = true) {
      const ev = { id: ++this.seq, t: Date.now(), type: type ?? EVENT_RULES.find(([re]) => re.test(msg))?.[1] ?? (major ? 'info' : 'step'), msg, major };
      this.events = [ev, ...this.events].slice(0, 500);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => save(K_EVENTS, this.events.slice(0, 300)), 1500);
      return ev;
    },
    clear() {
      this.events = [];
      save(K_EVENTS, []);
    },
  };
  X.journal.seq = X.journal.events[0]?.id ?? 0;

  // Notification système (via le service worker)
  let lastNotify = 0;
  X.notify = (title, message, force = false) => {
    if (!force && Date.now() - lastNotify < 10 * 6e4) return;
    lastNotify = Date.now();
    try {
      window.postMessage({ ns: X.ALBUM_NS, dir: 'to-ext', notify: { title, message } }, window.location.origin);
    } catch {}
  };

  // ---------- Activité du marché (heure de Londres) ----------

  const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const CONTENT = ['Mini-sortie, récompenses Weekend League', 'SBC d’amélioration', '', 'Équipe de la semaine', '', 'Nouvelles promos, récompenses Weekend League', 'Récompenses Weekend League'];
  function london(t) {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(t);
    return { day: DAYS_EN.indexOf(p.find((x) => x.type === 'weekday')?.value ?? 'Sun'), hour: Number(p.find((x) => x.type === 'hour')?.value ?? 0) };
  }
  function slot(day, hour) {
    const calm = { level: 'inactive', label: 'Marché calme', detail: 'Nuit en Europe', best: false, cell: 'Marché calme (nuit)' };
    if (hour < 4) return calm;
    if (hour < 8)
      return day === 4
        ? { level: 'active', label: 'Marché actif', detail: 'Récompenses Division Rivals (8 h à Londres)', best: false, cell: 'Récompenses Division Rivals' }
        : day === 0
          ? { level: 'active', label: 'Marché actif', detail: 'Récompenses Squad Battles (8 h à Londres)', best: false, cell: 'Récompenses Squad Battles' }
          : calm;
    if (hour < 12) return { level: 'semi', label: 'Marché moyen', detail: 'Joueurs au travail ou à l’école', best: false, cell: 'Marché calme (travail, école)' };
    if (hour < 16) return { level: 'semi', label: 'Marché moyen', detail: 'Le marché reprend un peu', best: false, cell: 'Le marché reprend un peu' };
    if (hour < 20) {
      const best = hour === 18;
      return {
        level: 'active',
        label: best ? 'Meilleur moment pour sniper' : 'Marché actif',
        detail: `${CONTENT[day] ? `Contenu : ${CONTENT[day]}` : 'Sortie de contenu'}${day === 3 || day === 5 ? ' · jour le plus rentable' : ''}`,
        best,
        cell: CONTENT[day] ? `Contenu (${CONTENT[day]})` : 'Contenu',
      };
    }
    return { level: 'active', label: 'Marché actif', detail: 'Filtres d’interception actifs, contenu si intéressant', best: false, cell: 'Filtres d’interception actifs, contenu si intéressant' };
  }
  const slotAt = (t) => {
    const { day, hour } = london(t);
    return { ...slot(day, hour), key: `${day}-${Math.floor(hour / 4)}` };
  };
  X.marketNow = (t = Date.now()) => {
    const cur = slotAt(t);
    const q = 9e5;
    const start = Math.ceil(t / q) * q;
    let until = start + 864e5;
    let next = null;
    for (let x = start; x <= start + 864e5; x += q) {
      const s = slotAt(x);
      if (until > x && (s.key !== cur.key || s.best !== cur.best)) until = x;
      if (s.level !== cur.level) {
        next = { level: s.level, at: x };
        break;
      }
    }
    return { level: cur.level, label: cur.label, detail: cur.detail, best: cur.best, until, next };
  };
  X.MARKET_WORD = { inactive: 'calme', semi: 'moyen', active: 'actif' };
  function londonOffset(t) {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t);
    const lon = Number(p.find((x) => x.type === 'hour')?.value ?? 0) * 60 + Number(p.find((x) => x.type === 'minute')?.value ?? 0);
    const d = new Date(t);
    return ((((d.getHours() * 60 + d.getMinutes() - lon) % 1440) + 1440 + 720) % 1440) - 720;
  }
  X.marketCalendar = (t = Date.now()) => {
    const off = londonOffset(t);
    const { day, hour } = london(t);
    const local = (m) => {
      const v = (((m + off) % 1440) + 1440) % 1440;
      return `${pad(Math.floor(v / 60))}:${pad(v % 60)}`;
    };
    return {
      rows: [0, 4, 8, 12, 16, 20].map((h0) => ({
        label: `${local(h0 * 60)}-${local((h0 + 4) * 60)}`,
        cells: [1, 2, 3, 4, 5, 6, 0].map((d) => {
          const s = slot(d, h0);
          return { level: s.level, text: s.cell, now: d === day && Math.floor(hour / 4) === h0 / 4 };
        }),
      })),
      offset: off,
    };
  };
  X.MARKET_TIP = 'Meilleur moment pour sniper : 18 h à Londres chaque jour, plus rentable le mercredi et le vendredi. Achat-revente intéressant aux récompenses Division Rivals et Squad Battles : les prix chutent puis remontent.';
})();
