// SnipeFC27 : sniper + album (sets de la Galerie importés depuis fut.gg), dans un seul panneau
(function () {
  const NS = 'snipefc27';
  const ALBUM_NS = 'albumfc27';

  // ---------- Réglages du sniper ----------

  const SNIPE_DEFAULTS = {
    snipeFilters: '[]',
    activeFilter: 0,
    sellAfterSnipe: true,
    breakPreset: 'safe',
    delayPreset: 'safe',
    nightBreakPreset: 'safest',
    nightDelayPreset: 'safest',
    mistakePrevention: true,
    recheckEvery: 50,
    minProfit: 0,
    snipeSound: true,
  };
  const LIMITS = { searchesHour: 900, searchesDay: 9e3, bidsHour: 180, bidsDay: 1800 };
  const DELAY_PRESETS = {
    safest: { label: 'Long', info: '4-6 s', min: 4e3, max: 6e3 },
    safe: { label: 'Normal', info: '3-5 s', min: 3e3, max: 5e3 },
    risky: { label: 'Risqué', info: '2-3 s', min: 2e3, max: 3e3 },
    dangerous: { label: 'Dangereux', info: '1-2 s', min: 1e3, max: 2e3 },
  };
  const BREAK_PRESETS = {
    safest: { label: 'Long', info: 'pause 5-10 min toutes les 3-8 min', every: [180, 480], rest: [300, 600] },
    safe: { label: 'Normal', info: 'pause 3-5 min toutes les 5-10 min', every: [300, 600], rest: [180, 300] },
    risky: { label: 'Risqué', info: 'pause 1-3 min toutes les 8-15 min', every: [480, 900], rest: [60, 180] },
    dangerous: { label: 'Dangereux', info: 'aucune pause', every: null, rest: null },
  };

  function parseFilters(json) {
    try {
      const v = JSON.parse(json);
      return Array.isArray(v) ? v.filter((f) => f && typeof f.id === 'string') : [];
    } catch {
      return [];
    }
  }

  const EMPTY_SESSION = { since: 0, searches: 0, snipes: 0, misses: 0, profit: 0, realized: 0, sales: 0, timeMs: 0 };

  // ---------- Prix EA ----------

  const EA_TAX = 0.05;
  const step = (p) => (p < 1e3 ? 50 : p < 1e4 ? 100 : p < 5e4 ? 250 : p < 1e5 ? 500 : 1e3);
  const priceUp = (p) => p + step(p);
  const priceDown = (p) => Math.max(150, p - step(p - 1));
  const roundUp = (p) => Math.max(200, Math.ceil(p / step(p)) * step(p));
  const profitOf = (buy, sell) => (buy && sell ? Math.round(sell * (1 - EA_TAX) - buy) : 0);
  // Prix de vente minimal pour récupérer le prix d'achat après taxe
  const breakEven = (p) => roundUp(p / (1 - EA_TAX));
  const netOf = (p) => Math.floor(p * (1 - EA_TAX));
  const taxOf = (p) => p - netOf(p);
  // Album : hausse progressive (+5 % arrondi au palier EA, au moins un palier), sans dépasser le plafond
  const raisePrice = (p, cap) => Math.min(cap, Math.max(p + step(p), roundUp(p * 1.05)));
  const capFor = (start, pct) => (start > 0 && pct > 0 ? Math.max(start, roundUp(start * (1 + pct / 100))) : start);

  // Prix d'achat et de vente d'un filtre automatique : vente un palier sous la moins chère, achat pour le profit visé
  function computePrices(o) {
    const sell = priceDown(o.lowestOnMarket);
    const st = step(o.lowestOnMarket);
    const target = o.minProfit > 0 ? Math.round(o.minProfit) : Math.max(150, Math.round((o.lowestOnMarket * 0.02) / st) * st);
    const floor = o.minPrice ? priceUp(o.minPrice) : 0;
    const base = { status: 'ok', buyPrice: sell, sellPrice: sell, targetProfit: target, profit: 0 };
    if (o.minPrice && sell < floor) return { ...base, status: 'belowListable' };
    let buy = sell;
    for (let i = 0; i < 5e3 && buy > Math.max(floor, 150) && profitOf(buy, sell) < target; i++) buy = priceDown(buy);
    const profit = profitOf(buy, sell);
    return { ...base, status: profit > 0 ? 'ok' : 'noProfit', buyPrice: buy, profit };
  }

  // ---------- Utilitaires ----------

  const HOUR = 36e5;
  const DAY = 24 * HOUR;
  const fmt = (n) => (n == null ? '—' : n.toLocaleString('fr-FR'));
  const fmtNum = (n) => Number(n || 0).toLocaleString('fr-FR');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * Math.max(0, b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const fmtMin = (ms) => {
    const m = Math.ceil(ms / 6e4);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  };
  const fmtWait = (ms) => {
    const sec = Math.max(0, Math.ceil(ms / 1e3));
    return sec >= 60 ? `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, '0')} s` : `${sec} s`;
  };
  const hm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  // Heure qu'il sera dans ms
  const clockAt = (ms) => new Date(Date.now() + ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const errText = (e) => {
    if (e == null || e === '') return '';
    try {
      return ` [${(typeof e === 'string' ? e : JSON.stringify(e)).slice(0, 200)}]`;
    } catch {
      return '';
    }
  };
  const errMsg = (e) => (e instanceof Error ? e.message : String(e));
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

  // ---------- Interception réseau : liste de transferts, isCollected, session EA ----------

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

  function onResponse(url, status, body) {
    if (status !== 200) return;
    let j = typeof body === 'string' ? null : body;
    const parse = () => {
      if (j === null) j = JSON.parse(body);
      return j;
    };
    try {
      if (/\/ut\/game\//i.test(url) && (typeof body !== 'string' || /"itemData"/.test(body))) recordItems(parse() ?? {});
      if (PILE_RE.test(url) && Array.isArray(parse()?.auctionInfo)) lastPile = { at: Date.now(), auctions: j.auctionInfo };
    } catch {}
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
          const hs = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          hs.forEach((v, k) => noteHeader(k, v));
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
  }

  // ---------- API Web App ----------

  const BAD_STATUS = new Set([426, 429, 458, 460, 494, 512, 521]);
  // Limites de débit (trop de requêtes) ; les autres statuts de BAD_STATUS demandent une vérification (captcha)
  const SOFT_STATUS = new Set([426, 429, 512, 521]);
  const MISS_STATUS = new Set([403, 461, 478]);

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
        resolve({
          success: !!r?.success,
          status: Number((!r?.success && r?.error?.code) || r?.status || 0),
          data: r?.data,
          response: r?.response,
          error: r?.error ?? r?.data?.reason ?? r?.data?.message,
        }),
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
    const limits = i._itemPriceLimits;
    const defId = Number(i.definitionId ?? 0);
    return {
      raw: i,
      tradeId: Number(a.tradeId),
      buyNow: Number(a.buyNowPrice),
      rating: Number(i.rating ?? i._rating ?? 0),
      name: staticName(i),
      expires: Number(a.expires ?? 0),
      defId,
      minPrice: limits && Number(limits.minimum) > 0 ? Number(limits.minimum) : null,
      collected: netItems.get(defId)?.collected === true,
    };
  }

  // Recherche sur le marché : filtre { defId } ou critères copiés de la Web App
  async function searchMarket(filter, p) {
    const c = new UTSearchCriteriaDTO();
    if (filter.criteria) Object.assign(c, filter.criteria);
    else {
      c.type = typeof SearchType !== 'undefined' ? SearchType.PLAYER : 'player';
      if (filter.defId) c.defId = [filter.defId];
    }
    c.minBuy = p.minBuy ?? 0;
    c.maxBuy = p.maxBuy ?? 0;
    c.minBid = p.minBid ?? 0;
    c.maxBid = p.maxBid ?? 0;
    services.Item.clearTransferMarketCache?.();
    const r = await observe(services.Item.searchTransferMarket(c, 1));
    return { ...r, data: (r.data?.items ?? []).map(mapItem) };
  }

  const bid = (item) => observe(services.Item.bid(item.raw, item.buyNow));
  const moveToTransfer = (raw) => observe(services.Item.move(raw, ItemPile.TRANSFER));
  const listItem = (raw, buyNow) => observe(services.Item.list(raw, priceDown(buyNow), buyNow, 3600));

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

  // Critères de la recherche affichée dans la Web App (sans les prix)
  const isCriteria = (c) => c && typeof c === 'object' && typeof c.maskedDefId === 'number' && typeof c._type === 'string';
  function readLiveCriteria() {
    try {
      const ctrl = globalThis.getAppMain?.()?.getRootViewController?.()?.getPresentedViewController?.()?.getCurrentViewController?.()?.getCurrentController?.();
      const sc = ctrl?.viewmodel?.searchCriteria ?? ctrl?._viewmodel?.searchCriteria;
      if (!isCriteria(sc)) return null;
      const out = {};
      for (const [k, v] of Object.entries(sc)) {
        if (['minBuy', 'maxBuy', 'minBid', 'maxBid'].includes(k)) continue;
        if (['number', 'string', 'boolean'].includes(typeof v) || (Array.isArray(v) && v.every((x) => typeof x !== 'object'))) out[k] = v;
      }
      return out;
    } catch {
      return null;
    }
  }
  function isEmptyCriteria(c) {
    if (c._type !== 'player' || (Array.isArray(c.rarities) && c.rarities.length)) return false;
    return Object.entries({ maskedDefId: 0, league: -1, level: 'any', playStyle: -1, nation: -1, _position: 'any', icontraits: 'any' }).every(([k, v]) => c[k] === undefined || c[k] === v);
  }

  function transferCount() {
    try {
      const n = repositories?.Item?.getTransferItems?.()?.length;
      return typeof n === 'number' ? n : null;
    } catch {
      return null;
    }
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
          return {
            raw,
            id,
            defId,
            type: String(a.itemData?.itemType ?? raw?.type ?? 'player'),
            name: raw ? staticName(raw) : String(defId || id),
            state: tradeState(String(a.tradeState ?? ''), Number(a.currentBid ?? 0)),
            soldPrice: Number(a.currentBid ?? 0),
            buyNow: Number(a.buyNowPrice ?? 0),
          };
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
        return { raw: i, id: Number(i.id), defId: Number(i.definitionId ?? 0), type: String(i.type ?? 'player'), name: staticName(i), state, soldPrice: cur, buyNow: Number(a.buyNowPrice ?? 0) };
      }),
    };
  }

  async function unassignedItems() {
    try {
      repositories?.Item?.setDirty?.(ItemPile.PURCHASED);
    } catch {}
    const r = await observe(services.Item.requestUnassignedItems?.());
    return { ...r, data: r.data?.items ?? [] };
  }
  const clearSold = () => observe(services.Item.clearSoldItems?.());
  const requestCurrencies = () => observe(services.User.requestCurrencies?.());

  // ---------- Garde-fous communs (sniper et album) : compteurs, limites, verrou anti-captcha ----------

  const GUARD_KEY = `${NS}:guard`;

  class Guard {
    s = { searches: [], purchases: [], lockedUntil: 0, ...load(GUARD_KEY, {}) };
    save() {
      const now = Date.now();
      this.s.searches = this.s.searches.filter((t) => now - t < DAY);
      this.s.purchases = this.s.purchases.filter((t) => now - t < DAY);
      save(GUARD_KEY, this.s);
    }
    lockRemainingMs() {
      return Math.max(0, this.s.lockedUntil - Date.now());
    }
    unlock() {
      this.s.lockedUntil = 0;
      this.save();
    }
    lock(hours) {
      this.s.lockedUntil = Date.now() + hours * HOUR;
      this.save();
    }
    recordSearch() {
      this.s.searches.push(Date.now());
      this.save();
    }
    recordPurchase() {
      this.s.purchases.push(Date.now());
      this.save();
    }
    usage() {
      const now = Date.now();
      return { searchesHour: this.s.searches.filter((t) => now - t < HOUR).length, searchesDay: this.s.searches.filter((t) => now - t < DAY).length };
    }
    limits() {
      const now = Date.now();
      const within = (arr, span) => arr.filter((t) => now - t < span);
      const end = (arr, span) => (arr.length ? arr[0] + span : null);
      const sh = within(this.s.searches, HOUR);
      const sd = within(this.s.searches, DAY);
      const bh = within(this.s.purchases, HOUR);
      const bd = within(this.s.purchases, DAY);
      return { searchesHour: sh.length, searchesDay: sd.length, bidsHour: bh.length, bidsDay: bd.length, searchesHourEnd: end(sh, HOUR), searchesDayEnd: end(sd, DAY), bidsHourEnd: end(bh, HOUR), bidsDayEnd: end(bd, DAY) };
    }
    checkBid() {
      const l = this.limits();
      if (l.bidsDay >= LIMITS.bidsDay) return { ok: false, waitMs: Math.max(6e4, (l.bidsDayEnd ?? 0) - Date.now() + 5e3), reason: `Limite de ${LIMITS.bidsDay} snipes / 24 h atteinte` };
      if (l.bidsHour >= LIMITS.bidsHour) return { ok: false, waitMs: Math.max(6e4, (l.bidsHourEnd ?? 0) - Date.now() + 5e3), reason: `Limite de ${LIMITS.bidsHour} snipes / h atteinte` };
      return { ok: true };
    }
    dayWait(arr, what) {
      const now = Date.now();
      const first = arr.filter((t) => now - t < DAY)[0] ?? now;
      const w = Math.max(6e4, first + DAY - now + 5e3);
      return { ok: false, waitMs: w, reason: `Quota journalier ${what} atteint, reprise dans ${fmtMin(w)}` };
    }
    check() {
      const lock = this.lockRemainingMs();
      if (lock > 0) return { ok: false, stop: `Verrou anti-captcha actif encore ${fmtMin(lock)}` };
      const now = Date.now();
      const u = this.usage();
      if (u.searchesDay >= LIMITS.searchesDay) return this.dayWait(this.s.searches, 'de recherches');
      if (u.searchesHour >= LIMITS.searchesHour) {
        const w = this.s.searches.filter((t) => now - t < HOUR)[0] + HOUR - now + 5e3;
        return { ok: false, waitMs: w, reason: `Quota horaire atteint (${u.searchesHour}), reprise dans ${fmtMin(w)}` };
      }
      return { ok: true };
    }
  }

  // Album : pauses après refus EA (réglables, 0 = aucune), ralentissement, quotas réglables sur les compteurs communs.
  // Le verrou anti-captcha du sniper bloque aussi l'album.
  const SOFT_CAP = 30 * 6e4;
  const HARD_CAP = 2 * HOUR;
  const CALM_MS = 30 * 6e4;

  class AlbumGuard {
    key = `${ALBUM_NS}:guard`;
    s = { lockedUntil: 0, lockStreak: 0, lastLockAt: 0, ...load(this.key, {}) };
    constructor(shared) {
      this.shared = shared;
    }
    persist() {
      // Compteurs des versions AlbumFC27 séparées : remplacés par les compteurs communs
      delete this.s.searches;
      delete this.s.purchases;
      save(this.key, this.s);
    }
    ownKind() {
      return this.s.lockedUntil > Date.now() ? (this.s.lockKind ?? 'hard') : null;
    }
    lockedUntil() {
      const own = this.s.lockedUntil > Date.now() ? this.s.lockedUntil : 0;
      return Math.max(own, this.shared.s.lockedUntil);
    }
    lockKind() {
      return this.ownKind() ?? (this.shared.lockRemainingMs() > 0 ? 'snipe' : null);
    }
    unlockOwn() {
      this.s.lockedUntil = 0;
      this.persist();
    }
    unlock() {
      this.unlockOwn();
      this.shared.unlock();
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
      if (kind === 'searches') this.shared.recordSearch();
      else this.shared.recordPurchase();
    }
    check(cfg) {
      const lockMs = this.lockedUntil() - Date.now();
      if (lockMs > 0) {
        const kind = this.lockKind();
        return { ok: false, locked: true, stop: `${kind === 'soft' ? 'Pause limite EA' : kind === 'snipe' ? 'Verrou anti-captcha du sniper' : 'Pause anti-captcha'} encore ${fmtMin(lockMs)}` };
      }
      const now = Date.now();
      const searches = this.shared.s.searches.filter((t) => now - t < DAY);
      const purchases = this.shared.s.purchases.filter((t) => now - t < DAY);
      const dayWait = (arr, what, max) => {
        const w = Math.max(6e4, arr[arr.length - max] + DAY - now + 5e3);
        return { ok: false, waitMs: w, reason: `Quota journalier ${what} atteint (max ${max}, sniper compris), reprise dans ${fmtMin(w)}` };
      };
      if (cfg.quotaSearchDay > 0 && searches.length >= cfg.quotaSearchDay) return dayWait(searches, 'de recherches', cfg.quotaSearchDay);
      if (cfg.quotaBuyDay > 0 && purchases.length >= cfg.quotaBuyDay) return dayWait(purchases, "d'achats", cfg.quotaBuyDay);
      const hour = searches.filter((t) => now - t < HOUR);
      if (cfg.quotaSearchHour > 0 && hour.length >= cfg.quotaSearchHour) {
        const w = hour[hour.length - cfg.quotaSearchHour] + HOUR - now + 5e3;
        return { ok: false, waitMs: w, reason: `Quota horaire de recherches atteint (max ${cfg.quotaSearchHour}), reprise dans ${fmtMin(w)}` };
      }
      return { ok: true };
    }
  }

  // ---------- Moteur du sniper (et relist de la liste de transferts) ----------

  const K_RESUME = `${NS}:resume`;
  const K_NIGHT = `${NS}:night`;
  const K_SNIPES = `${NS}:snipes`;
  const K_SESSION = `${NS}:session`;
  const K_LOG = `${NS}:log`;
  const K_BREAK = `${NS}:break`;
  const LOCK_HOURS = 12;
  const CACHE_MS = 31e3;
  const MAX_SEARCH_ERRORS = 3;
  const MISTAKE_MAX = 15;
  const PILE_MAX = 100;
  const PRICE_TTL = 36e5;
  const LOG_SIZE = 300;
  const SEARCHLOG_SIZE = 100;
  const ROTATE = [450, 900];
  const BLOCKED_WAIT = [48e4, 72e4];
  const ERROR_WAIT = [24e4, 36e4];
  const MAX_UNEXPECTED = 5;

  const nightOn = () => load(K_NIGHT, false);
  const setNight = (on) => save(K_NIGHT, on);

  // Variation des prix min/max pour contourner le cache EA (résultats identiques pendant ~30 s)
  function bustCriteria(buyPrice, n, start) {
    if (Date.now() - start > CACHE_MS) return { reset: true, minBid: null, minBuy: null, maxBid: null, maxBuy: buyPrice };
    const v = (i) => (i % 6 < 2 ? null : 50 * Math.floor(i / 6) + 150);
    const minBuy = n >= 2 ? v(n - 2) : null;
    return { reset: false, minBid: v(n), maxBid: n % 2 === 0 ? null : priceDown(buyPrice), minBuy: minBuy ? minBuy + 50 : null, maxBuy: buyPrice };
  }
  function criteriaValid(buyPrice, c) {
    const below = priceDown(buyPrice);
    if (c.minBid && c.maxBid && c.minBid === c.maxBid) return false;
    return !((c.maxBid ?? 0) > below || (c.minBid ?? 0) > priceDown(below) || (c.minBuy ?? 0) > below);
  }
  // Annonces achetables, sans celles mises en vente à l'instant (durée exacte), de la moins chère à la plus chère
  function listable(items) {
    const durations = [1, 3, 6, 12, 24, 72].map((h) => h * 3600);
    return items.filter((i) => !durations.some((d) => i.expires >= d - 120 && i.expires <= d)).sort((a, b) => a.buyNow - b.buyNow);
  }

  class StopSignal extends Error {}

  class SnipeEngine {
    running = false;
    task = null; // 'snipe' | 'relist'
    relistProgress = null;
    night = false;
    phase = 'idle';
    activity = '';
    filters = [];
    idx = 0;
    run = { startedAt: 0, searches: 0, snipes: 0, misses: 0, profit: 0 };
    session = load(K_SESSION, { ...EMPTY_SESSION, since: Date.now() });
    log = load(K_LOG, []);
    searchLog = [];
    breakAt = null;
    breakUntil = null;
    brk = load(K_BREAK, { preset: '', worked: 0, target: 0, until: 0, stoppedAt: 0 });
    segStart = 0;
    rotateAt = 0;
    snipes = load(K_SNIPES, {});
    prices = {};
    seen = new Set();
    pileCheck = { at: 0, total: 0 };
    stopRequested = false;
    wake = null;
    releaseLock = null;
    lastTick = 0;
    album = null; // moteur album, branché au démarrage

    constructor(getConfig, onUpdate, patchConfig, guard) {
      this.getConfig = getConfig;
      this.onUpdate = onUpdate;
      this.patchConfig = patchConfig;
      this.guard = guard;
    }
    get nightOn() {
      return nightOn();
    }
    get cfg() {
      return this.getConfig();
    }
    get filter() {
      return this.filters[this.idx];
    }

    snapshot() {
      const f = this.running ? this.filter : parseFilters(this.cfg.snipeFilters)[this.cfg.activeFilter];
      return {
        running: this.running,
        task: this.running ? this.task : null,
        relist: this.relistProgress,
        night: nightOn(),
        phase: this.phase,
        activity: this.activity,
        coins: coins(),
        filter: f?.label ?? '',
        buyPrice: f?.buyPrice ?? 0,
        sellPrice: f?.sellPrice ?? 0,
        run: { ...this.run },
        session: { ...this.session },
        breakAt: this.breakAt,
        breakUntil: this.breakUntil,
        rotationIn: this.running && this.night && this.filters.length > 1 ? Math.max(0, this.rotateAt - this.run.searches) : null,
        lockedUntil: Date.now() + this.guard.lockRemainingMs(),
        limits: this.guard.limits(),
        log: this.log.slice(0, 120),
        searchLog: this.searchLog,
        updatedAt: Date.now(),
      };
    }
    emit() {
      if (this.running && this.task === 'snipe') {
        const now = Date.now();
        this.session.timeMs += now - this.lastTick;
        this.lastTick = now;
        save(K_SESSION, this.session);
      }
      this.onUpdate(this.snapshot());
    }
    note(text, kind = 'info') {
      this.log = [{ at: Date.now(), kind, text }, ...this.log].slice(0, LOG_SIZE);
      save(K_LOG, this.log);
      this.emit();
    }
    searchNote(text) {
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      this.searchLog = [`${t} ${text}`, ...this.searchLog].slice(0, SEARCHLOG_SIZE);
    }
    setActivity(text, phase = this.phase) {
      this.activity = text;
      this.phase = phase;
      this.emit();
    }
    resetSession() {
      this.session = { ...EMPTY_SESSION, since: Date.now() };
      save(K_SESSION, this.session);
      this.emit();
    }
    clearLog() {
      this.log = [];
      save(K_LOG, this.log);
      this.emit();
    }
    unlock() {
      this.guard.unlock();
      this.note('Verrou levé manuellement');
    }
    // Une seule tâche à la fois sur le marché : sniper, relist ou achats album
    albumBusy() {
      if (!this.album?.running) return false;
      this.note('Achats album en cours : les arrêter avant', 'error');
      return true;
    }

    async start(night) {
      if (this.running) return;
      if (this.albumBusy()) return (setNight(false), this.emit());
      const lock = this.guard.lockRemainingMs();
      if (lock > 0) return (setNight(false), this.note(`Verrou anti-captcha actif encore ${fmtMin(lock)}`, 'error'));
      this.filters = parseFilters(this.cfg.snipeFilters);
      if (!this.filters.length) return (setNight(false), this.note('Aucun filtre : ajouter un joueur ou le filtre de la Web App', 'error'));
      this.idx = Math.min(Math.max(0, this.cfg.activeFilter), this.filters.length - 1);
      this.running = true;
      this.task = 'snipe';
      this.night = night;
      this.stopRequested = false;
      this.seen.clear();
      this.searchLog = [];
      this.run = { startedAt: Date.now(), searches: 0, snipes: 0, misses: 0, profit: 0 };
      this.lastTick = Date.now();
      this.holdWebLock();
      this.note(night ? 'Mode nuit : démarrage' : 'Sniper : démarrage');
      if (night && this.filters.length < 2) this.note('Un seul filtre : en ajouter un 2e pour changer de filtre toutes les 450 à 900 recherches');
      let errors = 0;
      try {
        for (;;) {
          try {
            await this.loop();
            break;
          } catch (err) {
            if (err instanceof StopSignal || !this.night || ++errors > MAX_UNEXPECTED) throw err;
            this.pauseClock();
            this.note(`Erreur imprévue (${errMsg(err)}), reprise dans 2 min`, 'error');
            await this.wait(12e4);
          }
        }
      } catch (err) {
        if (!(err instanceof StopSignal)) this.note(`Erreur : ${errMsg(err)}`, 'error');
      } finally {
        this.emit();
        this.pauseClock();
        this.brk.stoppedAt = Date.now();
        save(K_BREAK, this.brk);
        this.running = false;
        this.task = null;
        this.phase = 'idle';
        this.activity = '';
        this.breakAt = this.breakUntil = null;
        this.releaseLock?.();
        this.releaseLock = null;
        this.note('Arrêté');
      }
    }

    // Prix de remise en vente d'une carte de la liste de transferts :
    // carte de l'album = annonce la moins chère ; carte snipée = un palier dessous, jamais sous le prix d'achat taxe comprise ;
    // autre carte = un palier sous la moins chère. Aucune annonce : prix précédent.
    relistPrice(c, pc) {
      const s = this.snipes[c.id];
      const a = this.album?.bought[c.id];
      const floor = s ? breakEven(s.price) : 0;
      if (pc) {
        const base = a ? pc.lowest : priceDown(pc.lowest);
        if (pc.minPrice && base < pc.minPrice) return { price: 0, why: 'prix sous le minimum EA' };
        const price = Math.max(base, floor);
        return { price, why: a ? `annonce la moins chère ${fmt(pc.lowest)}` : price > base ? 'prix d’achat taxe comprise' : `un palier sous ${fmt(pc.lowest)}` };
      }
      const prev = c.buyNow || a?.sell || 0;
      return prev >= 200 ? { price: Math.max(prev, floor), why: 'aucune annonce, prix précédent' } : { price: 0, why: 'prix introuvable' };
    }

    async relistTransferList() {
      if (this.running || this.albumBusy()) return;
      const lock = this.guard.lockRemainingMs();
      if (lock > 0) return this.note(`Verrou anti-captcha actif encore ${fmtMin(lock)}`, 'error');
      this.running = true;
      this.task = 'relist';
      this.night = false;
      this.stopRequested = false;
      this.run = { startedAt: Date.now(), searches: 0, snipes: 0, misses: 0, profit: 0 };
      this.lastTick = Date.now();
      this.holdWebLock();
      this.note('Reliste de la liste de transferts : démarrage');
      let ok = 0;
      const failed = [];
      try {
        this.setActivity('Lecture de la liste de transferts', 'price');
        const pile = await this.syncTradePile();
        if (!pile) return;
        const count = (st) => pile.items.filter((i) => i.state === st).length;
        const summary = `${pile.items.length} carte(s) lue(s) : ${count('active')} en vente, ${count('expired')} expirée(s), ${count('unlisted')} non listée(s)${pile.fresh ? '' : ', depuis le cache de la Web App (si des invendus manquent, ouvrir Transferts > Liste de transferts puis relancer)'}`;
        const unsold = pile.items.filter((i) => i.state === 'expired' || i.state === 'unlisted');
        const todo = unsold.filter((i) => (i.type ?? i.raw?.type ?? 'player') === 'player');
        if (!todo.length) {
          const active = count('active');
          return this.note(`Rien à relister (${summary})${active ? '. Les annonces en cours ne peuvent pas être modifiées (règle EA) : relistables à leur expiration' : ''}`);
        }
        const direct = todo.filter((i) => !i.raw).length;
        this.note(`${summary}${direct ? `. ${direct} carte(s) non chargée(s) par la Web App : remise en vente par requête directe` : ''}`);
        this.relistProgress = { done: 0, total: todo.length };
        const groups = new Map();
        for (const i of todo) groups.set(i.defId, [...(groups.get(i.defId) ?? []), i]);
        for (const [defId, cards] of groups) {
          const label = this.snipes[cards[0].id]?.label ?? cards[0].name;
          const g = this.guard.check();
          if (!g.ok) {
            this.note('stop' in g ? g.stop : `${g.reason} : reliste interrompue`, 'error');
            break;
          }
          const pc = defId ? await this.priceCheck({ defId, criteria: null }, label) : null;
          if (pc) this.prices[defId] = { ...pc, at: Date.now() };
          for (const c of cards) {
            this.checkStop();
            const { price, why } = this.relistPrice(c, pc);
            if (!price) {
              failed.push(c);
              this.relistProgress.done++;
              this.note(`${label} : ${why}, remise en vente au prix précédent en fin de reliste`, 'error');
              continue;
            }
            this.setActivity(`Mise en vente de ${label} à ${fmt(price)}`, 'price');
            if (await this.listCard(c, label, price)) {
              ok++;
              this.note(`${c.state === 'expired' ? 'Remis' : 'Mis'} en vente ${label} à ${fmt(price)} (${why})`);
              this.album?.afterRelist(c.id, price, why);
            } else failed.push(c);
            this.relistProgress.done++;
            await this.wait(rand(400, 900));
          }
        }
        // Secours : cartes non relistées au prix du marché, remises en vente en bloc à leur prix précédent
        if (failed.length && !this.stopRequested) {
          await this.wait(rand(800, 1600));
          const r = await observe(services.Item.relistExpiredAuctions?.());
          if (r.success) {
            this.note(`${failed.length} carte(s) remise(s) en vente en bloc à leur prix précédent`);
            this.album?.afterBulkRelist(failed.map((c) => c.id));
          } else {
            if (BAD_STATUS.has(r.status)) this.lockout(`Statut EA ${r.status} (captcha ou limite)`);
            this.note(`Remise en vente en bloc échouée (statut ${r.status})${errText(r.error)}`, 'error');
          }
        }
        try {
          repositories?.Item?.setDirty?.(ItemPile.TRANSFER);
        } catch {}
      } catch (err) {
        if (!(err instanceof StopSignal)) this.note(`Erreur : ${errMsg(err)}`, 'error');
      } finally {
        this.emit();
        this.running = false;
        this.task = null;
        this.relistProgress = null;
        this.phase = 'idle';
        this.activity = '';
        this.releaseLock?.();
        this.releaseLock = null;
        this.note(`Reliste terminée : ${ok} carte(s) mise(s) en vente au prix du marché${failed.length ? `, ${failed.length} au prix précédent ou laissée(s) telle(s) quelle(s)` : ''}`);
        this.album?.touch();
        this.album?.emit();
        if (nightOn()) this.start(true);
      }
    }

    setNightMode(on) {
      setNight(on);
      if (!on) {
        if (this.running && this.night) this.stop('Mode nuit arrêté');
        else this.emit();
      } else if (this.running && this.task === 'snipe') {
        this.night = true;
        this.note('Mode nuit activé sur le sniper en cours');
      } else {
        if (this.running) return this.note('Mode nuit : démarrage à la fin de la reliste en cours');
        this.start(true);
      }
    }
    stop(msg = 'Arrêt demandé') {
      setNight(false);
      if (!this.running) return this.emit();
      this.stopRequested = true;
      this.wake?.();
      this.note(msg);
    }
    holdWebLock() {
      if (navigator.locks && !this.releaseLock) navigator.locks.request(`${NS}-running`, () => new Promise((r) => (this.releaseLock = r)));
    }
    checkStop() {
      if (this.stopRequested) throw new StopSignal();
    }
    async wait(ms) {
      this.checkStop();
      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(t);
          this.wake = null;
          resolve();
        };
        const t = setTimeout(done, ms);
        this.wake = done;
      });
      this.checkStop();
    }
    lockout(msg) {
      setNight(false);
      this.guard.lock(LOCK_HOURS);
      this.stopRequested = true;
      this.note(`${msg} : arrêt et verrou ${LOCK_HOURS} h. Ne pas utiliser le marché tout de suite.`, 'error');
      throw new StopSignal();
    }
    sessionExpired() {
      const d = rand(6e4, 12e4);
      this.stopRequested = true;
      this.note(`Session expirée (401) : rechargement dans ${Math.round(d / 1e3)} s puis reprise`, 'error');
      save(K_RESUME, { at: Date.now() + d, night: this.night });
      setTimeout(() => location.reload(), d);
      throw new StopSignal();
    }
    async blocked(msg, range = BLOCKED_WAIT) {
      if (!this.night) return (this.note(`${msg} : sniper arrêté`, 'error'), 'stop');
      const d = rand(...range);
      this.note(`${msg} : nouvel essai à ${clockAt(d)}`, 'error');
      this.setActivity(`${msg}, reprise à ${clockAt(d)}`, 'wait');
      await this.wait(d);
      await this.upkeep();
      return 'retry';
    }
    delayPreset() {
      return DELAY_PRESETS[this.night ? this.cfg.nightDelayPreset : this.cfg.delayPreset] ?? DELAY_PRESETS.safe;
    }
    breakPresetKey() {
      const k = this.night ? this.cfg.nightBreakPreset : this.cfg.breakPreset;
      return BREAK_PRESETS[k] ? k : 'safe';
    }
    newBreakTarget(key) {
      const every = BREAK_PRESETS[key].every;
      this.brk = { preset: key, worked: 0, target: every ? rand(every[0], every[1]) * 1e3 : 0, until: 0, stoppedAt: 0 };
    }
    pauseClock() {
      if (this.segStart) this.brk.worked += Date.now() - this.segStart;
      this.segStart = 0;
      this.breakAt = null;
      save(K_BREAK, this.brk);
    }
    resumeClock() {
      this.segStart = Date.now();
      this.breakAt = this.brk.target ? this.segStart + Math.max(0, this.brk.target - this.brk.worked) : null;
      save(K_BREAK, this.brk);
    }
    async restoreBreakClock(key) {
      const rest = BREAK_PRESETS[key].rest;
      const now = Date.now();
      if (this.brk.until > now && rest) {
        this.breakUntil = this.brk.until;
        this.note(`Pause en cours jusqu'à ${clockAt(this.brk.until - now)}`);
        this.setActivity(`Pause jusqu'à ${clockAt(this.brk.until - now)}`, 'break');
        await this.wait(this.brk.until - now);
        this.breakUntil = null;
        this.newBreakTarget(key);
      } else if (this.brk.preset !== key || (!this.brk.target && rest) || this.brk.until || (rest && this.brk.stoppedAt && now - this.brk.stoppedAt >= rest[0] * 1e3)) this.newBreakTarget(key);
      this.brk.until = 0;
      this.brk.stoppedAt = 0;
      this.resumeClock();
    }

    async loop() {
      if (!(await this.prepareFilter())) return;
      let key = this.breakPresetKey();
      await this.restoreBreakClock(key);
      this.rotateAt = this.run.searches + randInt(...ROTATE);
      let win = { n: 0, start: Date.now() };
      let sinceRecheck = 0;
      let errors = 0;
      for (;;) {
        this.checkStop();
        const cfg = this.cfg;
        if (key !== this.breakPresetKey()) {
          key = this.breakPresetKey();
          this.pauseClock();
          const worked = this.brk.worked;
          this.newBreakTarget(key);
          this.brk.worked = worked;
          this.resumeClock();
        }
        const rest = BREAK_PRESETS[key].rest;
        if (this.breakAt && rest && Date.now() >= this.breakAt) {
          this.pauseClock();
          const d = rand(rest[0], rest[1]) * 1e3;
          this.breakUntil = this.brk.until = Date.now() + d;
          save(K_BREAK, this.brk);
          this.note(`Pause jusqu'à ${clockAt(d)}`);
          this.setActivity(`Pause jusqu'à ${clockAt(d)}`, 'break');
          await this.upkeep();
          this.setActivity(`Pause jusqu'à ${clockAt(this.brk.until - Date.now())}`, 'break');
          await this.wait(Math.max(0, this.brk.until - Date.now()));
          this.breakUntil = null;
          this.newBreakTarget(key);
          this.resumeClock();
          win = { n: 0, start: Date.now() };
        }
        if (this.night && this.filters.length > 1 && this.run.searches >= this.rotateAt) {
          this.idx = (this.idx + 1) % this.filters.length;
          this.saveFilters();
          this.note(`Changement de filtre : ${this.filter.label}`);
          if (!(await this.prepareFilter())) return;
          this.rotateAt = this.run.searches + randInt(...ROTATE);
          sinceRecheck = 0;
          win = { n: 0, start: Date.now() };
        }
        const f = this.filter;
        if (await this.transferListFull()) {
          if ((await this.blocked('Liste de transferts pleine')) === 'stop') return;
          continue;
        }
        const wallet = coins();
        if (wallet !== null && wallet < f.buyPrice) {
          if ((await this.blocked(`Crédits insuffisants (${fmt(wallet)} < ${fmt(f.buyPrice)})`)) === 'stop') return;
          continue;
        }
        const g = [this.guard.check(), this.guard.checkBid()].find((x) => !x.ok);
        if (g && !g.ok) {
          if ('stop' in g) return this.note(g.stop, 'error');
          if (!this.night) return this.note(`${g.reason} : ne pas utiliser le marché avant ${clockAt(g.waitMs)}`, 'error');
          this.note(`${g.reason}, reprise à ${clockAt(g.waitMs)}`, 'error');
          this.setActivity(`Limite anti-ban, reprise à ${clockAt(g.waitMs)}`, 'wait');
          await this.wait(g.waitMs);
          continue;
        }
        let c = bustCriteria(f.buyPrice, win.n, win.start);
        if (c.reset) {
          win = { n: 0, start: Date.now() };
          c = bustCriteria(f.buyPrice, 0, win.start);
        }
        if (!criteriaValid(f.buyPrice, c)) {
          const d = win.start + CACHE_MS + 1e3 - Date.now();
          this.setActivity(`Attente de résultats frais (${Math.ceil(d / 1e3)} s)`, 'wait');
          await this.wait(Math.max(0, d));
          win = { n: 0, start: Date.now() };
          continue;
        }
        this.setActivity(`Recherche ${f.label} ≤ ${fmt(f.buyPrice)}`, 'search');
        const res = await searchMarket(f, c);
        const sorted = res.success ? [...res.data].sort((a, b) => a.buyNow - b.buyNow || b.rating - a.rating) : [];
        const tooMany = cfg.mistakePrevention && sorted.length > MISTAKE_MAX;
        const target = !tooMany && sorted[0] && sorted[0].buyNow <= f.buyPrice && !this.seen.has(sorted[0].tradeId) ? sorted[0] : null;
        // Achat lancé tout de suite, avant toute écriture
        const pending = target ? bid(target) : null;
        this.guard.recordSearch();
        this.run.searches++;
        this.session.searches++;
        win.n++;
        sinceRecheck++;
        if (res.success) {
          errors = 0;
          this.searchNote(`#${this.run.searches} ≤ ${fmt(f.buyPrice)} : ${sorted.length ? `${sorted.length} résultat(s), dès ${fmt(sorted[0].buyNow)}` : 'rien'}${tooMany ? ' (plus de 15 : pas d’achat)' : target ? ' → achat' : ''}`);
          if (tooMany) this.note(`${sorted.length} résultats : pas d'achat (prévention des erreurs, prix d'achat trop haut ?)`);
          if (target && pending) await this.snipe(target, pending);
        } else {
          if (res.status === 401) this.sessionExpired();
          if (BAD_STATUS.has(res.status)) this.lockout(`Statut EA ${res.status} (captcha ou limite)`);
          errors++;
          this.searchNote(`#${this.run.searches} erreur ${res.status}`);
          this.note(`Erreur de recherche (statut ${res.status}), encore ${Math.max(0, MAX_SEARCH_ERRORS - errors)} essai(s)`, 'error');
          if (errors >= MAX_SEARCH_ERRORS) {
            errors = 0;
            if ((await this.blocked(`${MAX_SEARCH_ERRORS} erreurs de recherche d'affilée`, ERROR_WAIT)) === 'stop') return;
            continue;
          }
        }
        if (f.auto && cfg.recheckEvery > 0 && sinceRecheck >= cfg.recheckEvery) {
          sinceRecheck = 0;
          this.note(`Revérification des prix après ${cfg.recheckEvery} recherches`);
          if (!(await this.priceFilter(f))) this.note('Revérification échouée : prix actuels conservés', 'error');
          win = { n: 0, start: Date.now() };
        }
        const p = this.delayPreset();
        const d = rand(p.min, p.max);
        this.setActivity(`Prochaine recherche dans ${(d / 1e3).toFixed(1).replace('.', ',')} s`, 'search');
        await this.wait(d);
      }
    }

    saveFilters() {
      this.patchConfig({ snipeFilters: JSON.stringify(this.filters), activeFilter: this.idx });
    }
    async prepareFilter() {
      for (let i = 0; i < this.filters.length; i++) {
        const f = this.filter;
        this.emit();
        const err = this.checkFilter(f);
        if (!err && (!f.auto || (await this.priceFilter(f)))) return true;
        const msg = err ?? `${f.label} : pas de prix rentable trouvé`;
        if (!this.night) return (this.note(msg, 'error'), false);
        this.note(`${msg}, filtre suivant`, 'error');
        this.idx = (this.idx + 1) % this.filters.length;
      }
      return (await this.blocked('Aucun filtre utilisable')) !== 'stop' && this.prepareFilter();
    }
    checkFilter(f) {
      if (f.auto) return null;
      if (!(f.buyPrice > 150)) return `${f.label} : prix d'achat à renseigner (plus de 150)`;
      if (this.cfg.sellAfterSnipe && !f.sellPrice) return `${f.label} : prix de vente à renseigner`;
      if (this.cfg.sellAfterSnipe && profitOf(f.buyPrice, f.sellPrice) <= 0) return `${f.label} : aucun profit au prix de vente choisi`;
      return null;
    }

    // Prix de la moins chère : recherches de plus en plus basses jusqu'à ne plus rien trouver
    async priceCheck(f, label) {
      let maxBuy = null;
      let lowest = null;
      let minPrice = null;
      this.setActivity(`Vérification du prix de ${label}`, 'price');
      for (let i = 0; i < 15; i++) {
        await this.wait(rand(1e3, 3e3));
        const g = this.guard.check();
        if (!g.ok) {
          if ('stop' in g) this.lockout(g.stop);
          if (!this.night) return null;
          await this.wait(g.waitMs);
        }
        const res = await searchMarket(f, { minBuy: null, maxBuy, minBid: null, maxBid: null });
        this.guard.recordSearch();
        if (!res.success) {
          if (res.status === 401) this.sessionExpired();
          if (BAD_STATUS.has(res.status)) this.lockout(`Statut EA ${res.status} (captcha ou limite)`);
          this.note(`Vérification du prix de ${label} : erreur (statut ${res.status})`, 'error');
          return null;
        }
        const list = listable(res.data);
        if (!list.length) {
          if (lowest === null) return (this.note(`${label} : aucune annonce, carte peut-être introuvable${this.task === 'snipe' ? ' (passer en prix fixés)' : ''}`, 'error'), null);
          break;
        }
        lowest = list[0].buyNow;
        minPrice = list[0].minPrice ?? minPrice;
        if (lowest <= 200) break;
        maxBuy = priceDown(lowest);
      }
      if (lowest === null) return null;
      this.note(`${label} : vente immédiate ${fmt(priceDown(lowest))}, moins chère du marché ${fmt(lowest)}`);
      return { lowest, minPrice };
    }
    computePrices(lowest, minPrice) {
      return computePrices({ lowestOnMarket: lowest, minPrice, minProfit: this.cfg.minProfit });
    }
    async priceFilter(f) {
      const r = await this.priceCheck(f, f.label);
      if (!r) return false;
      if (f.defId) this.prices[f.defId] = { ...r, at: Date.now() };
      return this.applyPrices(f, r.lowest, r.minPrice);
    }
    applyPrices(f, lowest, minPrice) {
      const r = this.computePrices(lowest, minPrice);
      if (r.status !== 'ok') return (this.note(r.status === 'belowListable' ? `${f.label} : prix sous le minimum EA` : `${f.label} : aucun prix d'achat rentable`, 'error'), false);
      f.buyPrice = r.buyPrice;
      f.sellPrice = r.sellPrice;
      this.saveFilters();
      const why = this.cfg.minProfit > 0 ? 'profit min choisi' : '2 % du prix, 150 minimum';
      this.note(`Achat jusqu'à ${fmt(r.buyPrice)}, vente ${fmt(r.sellPrice)} (${why} : ${fmt(r.targetProfit)}${r.profit < r.targetProfit ? `, profit réduit à ${fmt(r.profit)}` : ''})`);
      return true;
    }

    async snipe(item, pending) {
      const f = this.filter;
      this.seen.add(item.tradeId);
      this.guard.recordPurchase();
      const label = `${item.rating ? `${item.rating} ` : ''}${item.name}`;
      this.setActivity(`Achat de ${label} à ${fmt(item.buyNow)}…`);
      const r = await pending;
      if (!r.success) {
        if (r.status === 401) this.sessionExpired();
        if (BAD_STATUS.has(r.status)) this.lockout(`Statut EA ${r.status} (captcha ou limite)`);
        if (MISS_STATUS.has(r.status)) {
          this.run.misses++;
          this.session.misses++;
          this.note(`Raté de peu : ${label} à ${fmt(item.buyNow)}`, 'miss');
        } else if (r.status === 470) this.note(`Crédits insuffisants pour ${label} à ${fmt(item.buyNow)}`, 'error');
        else this.note(`Erreur ${r.status} à l'achat de ${label}`, 'error');
        return;
      }
      this.run.snipes++;
      this.session.snipes++;
      const id = Number(item.raw?.id);
      const defId = item.defId || f.defId || 0;
      if (id) {
        this.snipes[id] = { defId, label, price: item.buyNow, at: Date.now() };
        save(K_SNIPES, this.snipes);
      }
      this.note(`Snipé ${label} à ${fmt(item.buyNow)} !`, 'snipe');
      if (!this.cfg.sellAfterSnipe) return void (await this.toTransfer(item.raw, label));
      let sell = f.sellPrice;
      if (f.auto) {
        const pc = defId ? await this.priceCheck({ defId, criteria: null }, label) : null;
        if (pc) this.prices[defId] = { ...pc, at: Date.now() };
        if (pc && f.defId === defId) this.applyPrices(f, pc.lowest, pc.minPrice);
        const cp = pc ? this.computePrices(pc.lowest, pc.minPrice) : null;
        sell = cp && cp.status !== 'belowListable' ? cp.sellPrice : 0;
      }
      if (profitOf(item.buyNow, sell) <= 0) await this.toTransfer(item.raw, label, sell ? `${fmt(sell)} ne ferait pas de profit` : 'prix de vente introuvable');
      else if ((await this.toTransfer(item.raw, label)) && (await this.list(item.raw, label, sell))) {
        const p = profitOf(item.buyNow, sell);
        this.run.profit += p;
        this.session.profit += p;
        this.note(`Mis en vente ${label} à ${fmt(sell)} (profit ${fmt(p)})`);
      }
    }
    async toTransfer(raw, label, why = '') {
      const r = await moveToTransfer(raw);
      if (!r.success) this.note(`${label} laissé dans les non-assignés (statut ${r.status})`, 'error');
      else if (why) this.note(`${label} gardé en liste de transferts (${why})`);
      return r.success;
    }
    // Carte chargée par la Web App : mise en vente par la Web App ; sinon requête directe par identifiant
    async listCard(c, label, price) {
      const r = c.raw ? await listItem(c.raw, price) : await listById(c.id, price);
      if (r.success) return true;
      if (r.status === 401) this.sessionExpired();
      if (BAD_STATUS.has(r.status)) this.lockout(`Statut EA ${r.status} (captcha ou limite)`);
      this.note(`Mise en vente de ${label} échouée (statut ${r.status}${r.status === 461 ? ', prix hors fourchette EA' : ''})${errText(c.raw ? '' : r.error)}`, 'error');
      return false;
    }
    list(raw, label, price) {
      return this.listCard({ raw }, label, price);
    }

    // Liste de transferts : encaisse les ventes (sniper et album), renvoie les cartes restantes
    async syncTradePile() {
      const pile = await readTransferPile();
      if (!pile.success) return (this.note(`Lecture de la liste de transferts impossible (statut ${pile.status})${errText(pile.error)}`, 'error'), null);
      for (const i of pile.data) if (!i.raw || /^\d+$/.test(i.name)) i.name = this.snipes[i.id]?.label || this.album?.nameOf(i) || i.name;
      const sold = pile.data.filter((i) => i.state === 'sold');
      for (const i of sold) {
        const s = this.snipes[i.id];
        if (s) {
          const p = Math.floor(i.soldPrice * (1 - EA_TAX)) - s.price;
          this.session.realized += p;
          this.session.sales++;
          delete this.snipes[i.id];
          this.note(`Vendu ${s.label} à ${fmt(i.soldPrice)} (profit ${fmt(p)})`, 'sale');
        } else if (!this.album?.recordSale(i)) this.note(`Vendu ${i.name} à ${fmt(i.soldPrice)}`, 'sale');
      }
      save(K_SNIPES, this.snipes);
      let total = pile.data.length;
      if (sold.length && (await clearSold()).success) total -= sold.length;
      await requestCurrencies();
      this.pileCheck = { at: Date.now(), total };
      const items = pile.data.filter((i) => i.state !== 'sold');
      this.album?.onPile(items, sold.length);
      this.emit();
      return { items, total, fresh: pile.fresh !== false };
    }
    async transferListFull() {
      let n = transferCount();
      if (n === null || n >= PILE_MAX) n = Date.now() - this.pileCheck.at < 12e4 ? this.pileCheck.total : ((await this.syncTradePile())?.total ?? n);
      return (n ?? 0) >= PILE_MAX;
    }
    // Pendant les pauses et attentes : ventes encaissées, non-assignés rangés, cartes snipées expirées remises en vente
    async upkeep() {
      const p = await this.syncTradePile();
      if (!p) return;
      let free = PILE_MAX - p.total;
      const un = free > 0 ? await unassignedItems() : null;
      for (const it of un?.success ? un.data : []) {
        if (free <= 0 || !(await moveToTransfer(it)).success) break;
        free--;
        const s = this.snipes[Number(it.id)];
        this.note(`Non-assigné rangé en liste de transferts${s ? ` : ${s.label}` : ''}`);
        if (s) await this.relist(it, s, false);
      }
      const expired = p.items.filter((i) => this.snipes[i.id] && i.raw && (i.state === 'expired' || i.state === 'unlisted'));
      for (const i of expired.slice(0, 10)) {
        this.checkStop();
        await this.relist(i.raw, this.snipes[i.id], i.state === 'expired');
      }
    }
    async relist(raw, s, again) {
      let pr = this.prices[s.defId];
      if (!pr || Date.now() - pr.at > PRICE_TTL) {
        const pc = s.defId ? await this.priceCheck({ defId: s.defId, criteria: null }, s.label) : null;
        if (pc) pr = this.prices[s.defId] = { ...pc, at: Date.now() };
      }
      if (!pr) return;
      const price = Math.max(priceDown(pr.lowest), breakEven(s.price));
      if (await this.list(raw, s.label, price)) this.note(`${again ? 'Remis' : 'Mis'} en vente ${s.label} à ${fmt(price)}`);
    }
  }

  // ---------- Moteur de l'album : sets fut.gg, achat au plus bas, revente au prix d'achat ----------

  // Quotas (0 = illimité), comptés avec le sniper ; désactivés par défaut
  const QUOTA_DEFAULTS = { quotaSearchHour: 0, quotaSearchDay: 0, quotaBuyDay: 0 };
  // Pauses après un refus EA (min, 0 = aucune : reprise immédiate) ; doublées si ça se répète
  const PAUSE_DEFAULTS = { softPauseMin: 0, captchaPauseMin: 0 };
  const ALBUM_CONFIG_VERSION = 3;
  const SPEED_DEFAULTS = { minDelayMs: 4e3, maxDelayMs: 8e3, buyDelayMinMs: 300, buyDelayMaxMs: 900 };
  // Ralentissement après une limite EA : délais × paceStep à chaque limite, plafond paceMax, retour à ×1 après paceResetMin sans limite
  const PACE_DEFAULTS = { paceStep: 1.5, paceMax: 4, paceResetMin: 30 };
  const SPEED_PRESETS = [
    ['Prudent', { minDelayMs: 7e3, maxDelayMs: 12e3, buyDelayMinMs: 500, buyDelayMaxMs: 1200 }],
    ['Normal', SPEED_DEFAULTS],
    ['Rapide', { minDelayMs: 2e3, maxDelayMs: 4e3, buyDelayMinMs: 150, buyDelayMaxMs: 500 }],
  ];
  const PAGE_SIZE = 20;
  const PROBE_PAGES = 3;
  const MAX_SEARCHES = 30;
  const MAX_MISSES = 8;
  const MAX_LIST_FAILS = 3;
  const FEED_SIZE = 30;
  const EVENT_MAX = 400;
  const DEFAULT_RAISE = 30;
  const FUTGG_GALLERY = 'https://www.fut.gg/fut-gallery/';

  const K_ACONFIG = `${ALBUM_NS}:config`;
  const K_SETS = `${ALBUM_NS}:sets`;
  const K_SEL = `${ALBUM_NS}:pick`;
  const K_QUEUE = `${ALBUM_NS}:queue2`;
  const K_DONE = `${ALBUM_NS}:done`;
  const K_BOUGHT = `${ALBUM_NS}:bought`;
  const K_PILE = `${ALBUM_NS}:pile`;
  const K_ACTIVE = `${ALBUM_NS}:active`;
  const K_ARESUME = `${ALBUM_NS}:resume`;
  const K_TOTAL = `${ALBUM_NS}:total`;
  const K_LOCK_RESUME = `${ALBUM_NS}:lockResume`;
  const K_EVENTS = `${ALBUM_NS}:events`;
  const K_IMPORT_AT = `${ALBUM_NS}:importAt`;

  // Type d'un évènement du journal, déduit du message quand il n'est pas donné
  const EVENT_RULES = [
    [/^Acheté /, 'buy'],
    [/^Vendu /, 'sell'],
    [/remis en vente à|relisté à/, 'list'],
    [/prix relevé/, 'warn'],
    [/^Raté |aucune annonce|non trouvé/i, 'miss'],
    [/captcha|Pause limite|Statut EA|Limite EA|Verrou/i, 'lock'],
    [/erreur|échou|impossible|refusée/i, 'error'],
    [/quota|insuffisants|pleine|relevé|sniper|manque/i, 'warn'],
  ];
  const eventType = (msg) => EVENT_RULES.find(([re]) => re.test(msg))?.[1];

  function loadAlbumConfig() {
    const raw = load(K_ACONFIG, {}) ?? {};
    // v3 : quota horaire désactivé par défaut (l'ancien défaut de 300 était enregistré avec les réglages)
    if (raw.cfgV !== ALBUM_CONFIG_VERSION) delete raw.quotaSearchHour;
    const pct = Number(raw.raisePct);
    const cfg = { raisePct: Number.isFinite(pct) && pct >= 0 ? pct : DEFAULT_RAISE, ...SPEED_DEFAULTS, ...PACE_DEFAULTS, ...QUOTA_DEFAULTS, ...PAUSE_DEFAULTS, cfgV: ALBUM_CONFIG_VERSION };
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

  class AlbumEngine {
    mode = null; // 'buy' | null
    stopRequested = false;
    activityText = '';
    phase = 'idle';
    startedAt = 0;
    lastMessage = '';
    feedLines = [];
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
    resumeTimer = null;
    resumeAt = 0;
    version = 0;
    events = load(K_EVENTS, []);
    eventSeq = this.events[0]?.id ?? 0;
    waitUntil = 0;
    waitLabel = '';

    constructor(getConfig, onUpdate, guard, snipe) {
      this.getConfig = getConfig;
      this.onUpdate = onUpdate;
      this.guard = new AlbumGuard(guard);
      this.snipe = snipe;
    }
    get running() {
      return this.mode !== null;
    }

    snapshot() {
      const q = this.queue;
      const onSale = Object.values(this.bought);
      const cfg = this.getConfig();
      return {
        running: this.running,
        mode: this.mode,
        activity: this.activityText,
        phase: this.phase,
        startedAt: this.startedAt,
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
        pace: this.guard.pace(cfg),
        paceUntil: this.guard.paceUntil(cfg),
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
    activity(msg, phase = this.phase) {
      this.activityText = msg;
      this.phase = phase;
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
    nameOf(i) {
      return this.bought[i.id]?.name || this.findPlayer(i.defId)?.name || '';
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
        list.push({ p, start, cap: capFor(start, pct) });
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
      if (!Object.keys(players).length) return (this.log('Import fut.gg : aucun joueur lu sur la page'), null);
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

    // --- Liste de transferts (lue par le moteur commun) ---

    recordSale(i) {
      const b = this.bought[i.id];
      if (!b) return false;
      const net = netOf(i.soldPrice);
      const loss = b.price - net;
      this.addTotal('tax', i.soldPrice - net);
      this.addTotal('lost', loss);
      this.addTotal('received', net);
      this.addTotal('sold', 1);
      delete this.bought[i.id];
      this.saveBought();
      this.feed(`Vendu ${b.name || i.name} à ${fmtNum(i.soldPrice)} (net ${fmtNum(net)}, ${loss >= 0 ? `perte ${fmtNum(loss)}` : `gain ${fmtNum(-loss)}`})`);
      return true;
    }
    onPile(rest, soldCount) {
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
      this.pile = { at: Date.now(), active: rest.filter((i) => i.state === 'active').length, unsold: rest.filter((i) => i.state !== 'active').length, sold: soldCount };
      save(K_PILE, this.pile);
      this.touch();
    }
    afterRelist(id, price, why) {
      const b = this.bought[id];
      if (!b) return;
      b.sell = price;
      b.state = 'active';
      this.saveBought();
      const loss = b.price - netOf(price);
      this.feed(`${b.name} relisté à ${fmtNum(price)} (${why}, ${loss >= 0 ? `perte si vendu ${fmtNum(loss)}` : `gain si vendu ${fmtNum(-loss)}`})`);
    }
    afterBulkRelist(ids) {
      for (const id of ids) if (this.bought[id]?.state === 'expired') this.bought[id].state = 'active';
      this.saveBought();
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
      const pace = this.guard.pace(cfg);
      const slowed = pace > 1 ? `, rythme ralenti ×${pace.toFixed(1).replace('.', ',')}` : '';
      if (ms <= 0) {
        // Aucune pause réglée : reprise après le délai normal entre recherches
        this.log(`${msg} : pas de pause${slowed}${mode ? ', reprise immédiate' : ''}${soft ? '' : '. Si EA affiche un captcha, le résoudre dans la Web App : le process continue seul ensuite'}`, 'lock');
        if (!soft && Date.now() - (this.captchaNotifiedAt ?? 0) > 10 * 6e4) {
          this.captchaNotifiedAt = Date.now();
          this.notify('SnipeFC27 Album : captcha EA', `${msg}. Résous le captcha dans la Web App, le process reprend seul.`);
        }
        return;
      }
      if (soft) return this.log(`${msg} : pause de ${fmtMin(ms)}${slowed}${mode ? ', reprise automatique' : ''}`, 'lock');
      this.log(`${msg} : pause de ${fmtMin(ms)}${mode ? ', reprise automatique ensuite' : ''}. Si EA affiche un captcha, le résoudre dans la Web App.`, 'lock');
      this.notify('SnipeFC27 Album : pause anti-captcha', `${msg}. Reprise vers ${clockAt(ms)}. Si EA affiche un captcha, résous-le dans la Web App.`);
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
    resumePending() {
      return !!load(K_LOCK_RESUME, null);
    }
    async autoResume() {
      const intent = load(K_LOCK_RESUME, null);
      this.resumeAt = 0;
      if (!intent) return;
      if (this.guard.lockedUntil() > Date.now()) return this.scheduleResume();
      // Tâche interrompue encore en train de se terminer (ou sniper en cours) : nouvel essai plus tard
      if (this.running || this.snipe.running) return void (this.resumeTimer = setTimeout(() => void this.autoResume(), this.running ? 1e3 : 6e4));
      save(K_LOCK_RESUME, null);
      if (intent.mode === 'buy' && this.queue.some(isOpen)) {
        this.log('Reprise automatique');
        await this.runQueue();
      } else this.emit();
    }
    sessionExpired() {
      const d = rand(6e4, 12e4);
      this.stop(`Session expirée (401) : rechargement de la Web App dans ${Math.round(d / 1e3)} s puis reprise`);
      save(K_ARESUME, Date.now() + d);
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
      if (r.status === 401) return (this.sessionExpired(), true);
      if (SOFT_STATUS.has(r.status)) return (this.lockout(`Limite EA ${r.status} (trop de requêtes)`, true), true);
      if (BAD_STATUS.has(r.status)) return (this.lockout(`Statut EA ${r.status} (vérification / captcha)`), true);
      if (r.status === 403 && what === 'search') return (this.stop(`Recherche refusée (403)${errText(r.error)}`), true);
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

    enter(mode) {
      if (this.running) return false;
      if (this.snipe.running) {
        this.log(`${this.snipe.task === 'relist' ? 'Reliste' : 'Sniper'} en cours : l'arrêter avant (une tâche à la fois sur le marché)`);
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
      this.startedAt = Date.now();
      this.misses = 0;
      this.listFails = 0;
      this.snipe.holdWebLock();
      this.touch();
      this.emit();
      return true;
    }
    leave() {
      this.mode = null;
      this.activityText = '';
      this.phase = 'idle';
      this.snipe.releaseLock?.();
      this.snipe.releaseLock = null;
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
      this.phase = 'wait';
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
        this.phase = 'search';
        // minBuy alterné : contourne le cache EA sans exclure d'annonce (prix mini 200)
        const res = await searchMarket({ defId, criteria: null }, { minBuy: this.nonce++ % 2 ? 150 : 0, maxBuy: cur || 0 });
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
      const pct = this.getConfig().raisePct;
      // Ordre du panneau : set par set, joueurs dans l'ordre de la liste ; un joueur présent dans plusieurs sets est acheté dans le premier
      const seen = new Set();
      const queue = [];
      for (const s of this.setList()) {
        for (const p of this.setPlayers(s)) {
          if (p.collected || seen.has(p.defId) || !this.isSelected(p.defId)) continue;
          seen.add(p.defId);
          const v = Number(this.selection[p.defId]);
          const start = v >= 200 ? Math.floor(v) : 0;
          queue.push({ defId: p.defId, name: p.name, rating: p.rating, set: s.name, start, max: start, cap: capFor(start, pct), status: 'pending', searches: 0, price: 0, sell: 0 });
        }
      }
      if (!queue.length) return this.log('Aucun joueur coché');
      if (this.snipe.running) return this.log(`${this.snipe.task === 'relist' ? 'Reliste' : 'Sniper'} en cours : l'arrêter avant (une tâche à la fois sur le marché)`);
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
      if (!this.enter('buy')) return;
      save(K_ACTIVE, true);
      const n = this.queue.length;
      this.log(`Achat de ${n} joueur(s) au prix le plus bas (hausse jusqu'à +${this.getConfig().raisePct} % si introuvable), revente au prix d'achat`);
      try {
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
          const tax = got.reduce((s, q) => s + taxOf(q.price), 0);
          const fail = this.queue.filter(isFailed).length;
          this.log(`Achats terminés : ${got.length}/${n} achetés et remis en vente, ${fmtNum(spent)} dépensés, coût réel ~${fmtNum(tax)}${fail ? `. ${fail} non trouvé(s), toujours coché(s) : relance possible` : ''}`, 'buy');
          this.notify('SnipeFC27 Album : achats terminés', `${got.length}/${n} achetés, coût réel ~${fmtNum(tax)} crédits${fail ? `, ${fail} non trouvé(s)` : ''}.`);
        }
      } catch (err) {
        this.log(`Erreur : ${errMsg(err)}`);
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
      this.log(`Set « ${name} » terminé : ${got.length}/${inSet.length} achetés, ${fmtNum(got.reduce((t, x) => t + x.price, 0))} dépensés${fail ? `, ${fail} non trouvé(s)` : ''}`, 'buy');
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
        this.activity(e.max ? `${e.name} : recherche ≤ ${fmtNum(e.max)}${e.max > e.start ? ` (relevé, plafond ${fmtNum(e.cap)})` : ''}` : `${e.name} : sondage du prix le plus bas`, 'search');
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
      await sleep(rand(this.getConfig().buyDelayMinMs, this.getConfig().buyDelayMaxMs));
      if (this.stopRequested) return 'stop';
      const name = e.name || it.name;
      this.activity(`Achat de ${name} à ${fmtNum(it.buyNow)}…`, 'buy');
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
      this.activity(`Mise en vente de ${name} à ${fmtNum(price)}`, 'list');
      await sleep(rand(800, 1600));
      const m = await moveToTransfer(it.raw);
      const l = m.success ? await listItem(it.raw, price) : m;
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

    // Encaissement des ventes et état des annonces, par le moteur commun
    async syncPile() {
      this.activity('Lecture de la liste de transferts', 'list');
      const p = await this.snipe.syncTradePile();
      this.activity('');
      return p;
    }
  }

  // ---------- Activité du marché (heure de Londres) ----------

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const CONTENT = ['Mini-sortie, récompenses Weekend League', 'SBC d’amélioration', '', 'Équipe de la semaine', '', 'Nouvelles promos, récompenses Weekend League', 'Récompenses Weekend League'];

  function londonTime(t) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(t);
    return { day: WEEKDAYS.indexOf(parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'), hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0) };
  }
  function marketAt(t) {
    const { day, hour } = londonTime(t);
    const key = `${day}-${Math.floor(hour / 4)}`;
    if (hour < 4) return { key, level: 'inactive', label: 'Marché calme', detail: 'Nuit en Europe', best: false };
    if (hour < 8) {
      if (day === 4) return { key, level: 'active', label: 'Marché actif', detail: 'Récompenses Division Rivals (8 h à Londres)', best: false };
      if (day === 0) return { key, level: 'active', label: 'Marché actif', detail: 'Récompenses Squad Battles (8 h à Londres)', best: false };
      return { key, level: 'inactive', label: 'Marché calme', detail: 'Nuit en Europe', best: false };
    }
    if (hour < 12) return { key, level: 'semi', label: 'Marché moyen', detail: 'Joueurs au travail ou à l’école', best: false };
    if (hour < 16) return { key, level: 'semi', label: 'Marché moyen', detail: 'Le marché reprend un peu', best: false };
    if (hour < 20) {
      const best = hour === 18;
      const content = CONTENT[day] ? `Contenu : ${CONTENT[day]}` : 'Sortie de contenu';
      return { key, level: 'active', label: best ? 'Meilleur moment pour sniper' : 'Marché actif', detail: `${content}${day === 3 || day === 5 ? ' · jour le plus rentable' : ''}`, best };
    }
    return { key, level: 'active', label: 'Marché actif', detail: 'Filtres d’interception actifs, contenu si intéressant', best: false };
  }
  function marketNow(now = Date.now()) {
    const cur = marketAt(now);
    const q = 9e5;
    const from = Math.ceil(now / q) * q;
    let until = from + 864e5;
    let next = null;
    for (let t = from; t <= from + 864e5; t += q) {
      const m = marketAt(t);
      if (until > t && (m.key !== cur.key || m.best !== cur.best)) until = t;
      if (m.level !== cur.level) {
        next = { level: m.level, at: t };
        break;
      }
    }
    return { level: cur.level, label: cur.label, detail: cur.detail, best: cur.best, until, next };
  }
  const LEVEL_LABEL = { inactive: 'calme', semi: 'moyen', active: 'actif' };

  // ---------- Son ----------

  let audio = null;
  function unlockAudio() {
    try {
      audio ??= new AudioContext();
      if (audio.state === 'suspended') audio.resume();
    } catch {}
  }
  function beep() {
    try {
      unlockAudio();
      const t0 = audio.currentTime;
      for (const [freq, at, dur] of [
        [988, 0, 0.08],
        [1319, 0.08, 0.4],
      ]) {
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.type = 'square';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.08, t0 + at);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + at + dur);
        o.connect(g).connect(audio.destination);
        o.start(t0 + at);
        o.stop(t0 + at + dur);
      }
    } catch {}
  }

  // ---------- Base joueurs de la Web App (recherche par nom) ----------

  let playersDb = null;
  const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function playersUrl() {
    return (
      performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .find((n) => /\/players\.json(\?|$)/.test(n)) ?? null
    );
  }
  async function loadPlayers() {
    if (playersDb) return playersDb;
    const url = playersUrl();
    if (!url) throw Error('base joueurs non chargée par la Web App : ouvre une recherche de joueur sur le marché puis réessaie');
    const r = await fetch(url);
    if (!r.ok) throw Error(`base joueurs inaccessible (HTTP ${r.status})`);
    const j = await r.json();
    playersDb = [...(j.Players ?? []).map((p) => ({ ...p, legend: false })), ...(j.LegendsPlayers ?? []).map((p) => ({ ...p, legend: true }))]
      .filter((p) => p.id)
      .map((p) => {
        const full = [p.f, p.l].filter(Boolean).join(' ');
        return { id: p.id, name: p.c || full || String(p.id), rating: p.r ?? 0, search: normalize(`${full} ${p.c ?? ''}`), legend: p.legend };
      });
    return playersDb;
  }
  function findPlayers(db, text, max = 8) {
    const words = normalize(text).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return db
      .filter((p) => words.every((w) => p.search.includes(w)))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, max);
  }

  // ---------- Réglages du sniper (stockage) ----------

  const K_CONFIG = `${NS}:config`;
  function loadSnipeConfig() {
    try {
      const raw = JSON.parse(localStorage.getItem(K_CONFIG) ?? '{}');
      const cfg = { ...SNIPE_DEFAULTS };
      for (const k of Object.keys(SNIPE_DEFAULTS)) if (typeof raw[k] === typeof SNIPE_DEFAULTS[k]) cfg[k] = raw[k];
      return cfg;
    } catch {
      return { ...SNIPE_DEFAULTS };
    }
  }
  function saveSnipeConfig(cfg) {
    try {
      localStorage.setItem(K_CONFIG, JSON.stringify(cfg));
    } catch {}
  }

  // ---------- Panneau ----------

  function el(tag, props = {}, ...children) {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...children.filter((c) => c !== null && c !== undefined && c !== false && c !== ''));
    return n;
  }
  const pad = (n) => String(n).padStart(2, '0');
  function hms(ms) {
    const s = Math.max(0, Math.floor(ms / 1e3));
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  }
  function dur(ms) {
    const s = Math.max(0, Math.floor(ms / 1e3));
    const h = Math.floor(s / 3600);
    return h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
  }
  const timeOf = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dec = (n) => String(Math.round(n * 10) / 10).replace('.', ',');

  // Barre segmentée : [[classe, valeur], ...] sur une échelle donnée
  function bar(segments, scale) {
    return el('div', { className: 'bar' }, ...segments.filter(([, v]) => v > 0).map(([cls, v]) => el('span', { className: cls, style: `width:${Math.min(100, (v / Math.max(1, scale)) * 100)}%` })));
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

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.dock { position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483646; width: 380px; display: flex; flex-direction: column;
  font: 13px/1.4 system-ui, sans-serif; color: #e8e8e8; background: #14161b; border-left: 1px solid #2a2e37; }
.dock.hidden, .overlay.hidden { display: none; }
.scroll { flex: 1; overflow-y: auto; padding: 10px; }
.view { display: none; flex-direction: column; gap: 8px; } .view.on { display: flex; }
.top { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #2a2e37; }
.top b { font-size: 14px; } .coins { color: #a9b1c2; font-size: 12px; }
.tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 8px 10px 0; }
.tabs button { background: #1b1e25; color: #a9b1c2; padding: 8px; display: flex; align-items: center; justify-content: center; gap: 6px; }
.tabs button.on { background: #63e64b; color: #0d1a09; }
.tabs .count { font-size: 11px; font-weight: 600; padding: 0 7px; border-radius: 999px; background: #e0c341; color: #14161b; }
.tabs .live { width: 8px; height: 8px; border-radius: 50%; background: #63e64b; animation: blink 1.2s ease-in-out infinite; }
.tabs button.on .live { background: #0d1a09; }
@keyframes blink { 50% { opacity: .3; } }
.status { margin: 8px 10px 0; padding: 6px 8px; border-radius: 6px; background: #1b1e25; font-size: 12px; color: #c9cfdb; cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status.hidden { display: none; }
.card { background: #1b1e25; border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.card h3 { margin: 0; font-size: 13px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.limits { display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr); gap: 8px 14px; font-size: 12px; color: #a9b1c2;
  font-variant-numeric: tabular-nums; align-items: center; }
.limits > * { min-width: 0; white-space: nowrap; }
.limits .head { font-weight: 600; color: #e8e8e8; }
.limits .col { font-size: 11px; color: #8a92a3; text-align: right; }
.limits .lim { display: flex; flex-direction: column; gap: 3px; text-align: right; }
.limits b { color: #e8e8e8; }
.limits .bar { height: 4px; border-radius: 2px; background: #2a2e37; overflow: hidden; }
.limits .bar i { display: block; height: 100%; background: #63e64b; }
.limits .warn .bar i { background: #e0c341; } .limits .full .bar i { background: #ff5c5c; }
.limits small { font-size: 11px; color: #8a92a3; white-space: normal; } .limits .full small { color: #ff8a8a; }
.lock { background: #3b1d1d; color: #ffb4b4; }
.market { flex-direction: row; align-items: center; gap: 10px; border-left: 4px solid; }
.market.inactive { border-color: #ff5c5c; } .market.semi { border-color: #e0c341; } .market.active { border-color: #63e64b; }
.market .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.market.inactive .dot { background: #ff5c5c; } .market.semi .dot { background: #e0c341; } .market.active .dot { background: #63e64b; }
.market.best { background: #1f2f1b; }
button { border: 0; border-radius: 6px; padding: 6px 10px; font: inherit; font-weight: 600; cursor: pointer; background: #2a2e37; color: #e8e8e8; }
button:hover:not(:disabled) { filter: brightness(1.15); }
button:disabled { opacity: .4; cursor: default; }
.x { background: none; color: #8a92a3; padding: 0 4px; font-size: 16px; }
.link { background: none; color: #8a92a3; font-weight: 400; text-decoration: underline; padding: 0; font-size: 12px; }
input, select { background: #0f1115; color: inherit; border: 1px solid #2a2e37; border-radius: 6px; padding: 6px 8px; font: inherit; min-width: 0; }
input:focus, select:focus { outline: none; border-color: #63e64b; }
input[type=checkbox] { accent-color: #63e64b; width: 15px; height: 15px; margin: 0; }
select { width: 100%; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { border: 1px solid #3a3f4b; border-radius: 999px; padding: 3px 10px; background: none; font-weight: 500; font-size: 12px; color: #c9cfdb; }
.chip.active { background: #63e64b; border-color: #63e64b; color: #0d1a09; }
.chip .rm { margin-left: 6px; opacity: .6; }
.results { display: flex; flex-direction: column; border-radius: 6px; overflow: hidden; }
.results:empty { display: none; }
.result { text-align: left; background: #232731; font-weight: 500; border-radius: 0; }
.muted { color: #8a92a3; font-size: 12px; } .muted:empty { display: none; }
.muted.warn { color: #ffd166; }
.row { display: flex; gap: 6px; align-items: flex-start; }
.prices { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 6px; align-items: center; }
.prices input { width: 100%; text-align: right; }
.switch { position: relative; width: 38px; height: 22px; flex: 0 0 38px; display: inline-block; }
.switch input { opacity: 0; width: 0; height: 0; }
.switch span { position: absolute; inset: 0; background: #3a3f4b; border-radius: 22px; cursor: pointer; transition: .15s; }
.switch span::before { content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: .15s; }
.switch input:checked + span { background: #63e64b; }
.switch input:checked + span::before { transform: translateX(16px); }
.setting { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.setting input[type=number] { width: 80px; text-align: right; }
.setting .pair { display: flex; align-items: center; gap: 4px; color: #8a92a3; flex: none; }
.setting .pair input[type=number] { width: 58px; }
details summary { cursor: pointer; list-style: none; }
details summary::-webkit-details-marker { display: none; }
details[open] > summary { margin-bottom: 6px; }
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.tiles.three { grid-template-columns: repeat(3, 1fr); }
.tile { background: #232731; border-radius: 8px; padding: 8px 10px; min-width: 0; }
.tile .k { font-size: 12px; color: #a9b1c2; } .tile .v { font-size: 20px; font-weight: 700; } .tile .s { font-size: 11px; color: #8a92a3; min-height: 1em; }
.tiles.three .tile { padding: 6px 8px; } .tiles.three .tile .v { font-size: 16px; }
.tiles.three .tile .s { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile.neg .v { color: #ff8a8a; } .tile.pos .v { color: #8cf27a; } .tile.warn .v { color: #ffd166; }
.log { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; }
.line { background: #232731; border-radius: 6px; padding: 5px 8px; font-size: 12px; display: flex; gap: 6px; }
.line .t { color: #8a92a3; flex: none; }
.line.snipe { color: #8cf27a; } .line.sale { color: #7fd1ff; } .line.miss { color: #ffd166; } .line.error { color: #ff8a8a; }
.line.buy { color: #8cf27a; } .line.sell { color: #7fd1ff; } .line.list { color: #b9c8ff; } .line.warn { color: #ffd166; }
.line.lock { color: #ffb4b4; background: #3b1d1d; } .line.step { color: #8a92a3; background: #1f2229; }
.actions { padding: 10px; border-top: 1px solid #2a2e37; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.actions.hidden { display: none; }
.go { background: #63e64b; color: #0d1a09; font-size: 15px; padding: 11px; letter-spacing: .04em; }
.go.stop { background: #ff5c5c; color: #fff; }
.night { padding: 11px; font-size: 13px; }
.night.on { background: #6d4ae0; color: #fff; }
.overlay { position: fixed; top: 0; bottom: 0; left: 0; right: 380px; z-index: 2147483645; background: #0009; display: flex; align-items: center; justify-content: center;
  font: 13px/1.4 system-ui, sans-serif; color: #e8e8e8; }
.modal { width: min(640px, 92%); max-height: 90vh; background: #14161b; border: 1px solid #63e64b; border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.title { display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 24px; font-weight: 800; letter-spacing: .08em; }
.spin { width: 28px; height: 28px; border-radius: 50%; border: 5px solid #63e64b44; border-top-color: #63e64b; animation: spin 1s linear infinite; }
.spin.pause { animation: none; border-color: #ffd166; }
@keyframes spin { to { transform: rotate(360deg); } }
.badge { font-size: 11px; background: #6d4ae0; padding: 2px 8px; border-radius: 999px; letter-spacing: .04em; }
.badge.album { background: #2f6d25; }
.info { text-align: center; color: #a9b1c2; }
.searchlog { background: #0f1115; border: 1px solid #2a2e37; border-radius: 8px; padding: 8px; height: 260px; overflow-y: auto;
  font: 12px/1.5 ui-monospace, monospace; color: #c9cfdb; }
.searchlog div:first-child { color: #fff; }
.modal .go { width: 100%; }
.modal .link { align-self: center; }
.bar { height: 6px; background: #0f1115; border-radius: 3px; overflow: hidden; display: flex; }
.bar > span { height: 100%; transition: width .4s; }
.bar .ok { background: #63e64b; } .bar .use { background: #7fd1ff; } .bar .over { background: #ff5c5c; }
.bar .cap { background: repeating-linear-gradient(45deg, #7fd1ff 0 3px, #2a4a5e 3px 6px); }
.wallet { display: flex; flex-direction: column; gap: 4px; }
.wallet .bar { height: 10px; border-radius: 5px; }
.legend { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: #a9b1c2; font-variant-numeric: tabular-nums; }
.legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; }
.filters { display: flex; gap: 6px; align-items: center; font-size: 12px; color: #a9b1c2; }
.filters input[type=search] { flex: 1; width: 0; }
.filters label { display: flex; gap: 4px; align-items: center; white-space: nowrap; }
.small { padding: 4px 8px; font-size: 12px; font-weight: 500; }
.sets { display: flex; flex-direction: column; gap: 6px; }
.set { background: #232731; border-radius: 6px; overflow: hidden; }
.shead { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 4px 8px; padding: 7px 8px; cursor: pointer; user-select: none; }
.shead .nm { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shead .nm::before { content: '▸'; display: inline-block; width: 12px; color: #8a92a3; transition: transform .15s; transform-origin: 3px 50%; }
.set.open .shead .nm::before { transform: rotate(90deg); }
.shead .prog { grid-column: 2 / span 2; display: flex; align-items: center; gap: 8px; font-size: 11px; color: #8a92a3; }
.shead .prog .bar { flex: 0 0 70px; }
.shead input { grid-row: 1 / span 2; }
.shead .tools { display: flex; gap: 4px; }
.shead .tools button { padding: 2px 7px; font-size: 12px; background: #2f343f; }
.sbody { display: none; padding: 4px; flex-direction: column; gap: 2px; background: #1b1e25; }
.set.open .sbody { display: flex; }
.p { display: grid; grid-template-columns: auto 1fr auto; align-items: center; column-gap: 8px; padding: 5px 6px; border-radius: 6px; }
.p:hover { background: #232731; }
.p.got { opacity: .45; }
.p.sel { background: #1f2f1b; }
.p .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 12px; }
.p .n i { font-style: normal; color: #e0c341; margin-right: 5px; }
.p .m { grid-column: 2; font-size: 11px; color: #8a92a3; }
.p .m .loss { color: #ff8a8a; }
.p .st { grid-column: 2; font-size: 11px; color: #7fd1ff; }
.p .st.ok { color: #8cf27a; } .p .st.ko { color: #ff8a8a; }
.p > input[type=checkbox] { grid-row: 1 / span 3; }
.p > input[type=number] { grid-row: 1 / span 3; grid-column: 3; width: 84px; text-align: right; padding: 4px 6px; }
.empty { color: #a9b1c2; font-size: 12px; line-height: 1.7; }
.empty ol { margin: 6px 0 0; padding-left: 18px; }
.hero { display: flex; align-items: baseline; gap: 10px; }
.hero span { font-size: 12px; color: #a9b1c2; }
.hero b { font-size: 22px; font-variant-numeric: tabular-nums; }
.hero b.neg { color: #ff8a8a; } .hero b.pos { color: #8cf27a; }
.hero small { margin-left: auto; font-size: 11px; color: #8a92a3; text-align: right; }
.salelist { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; }
.sale { display: grid; grid-template-columns: 1fr auto; gap: 1px 8px; padding: 5px 8px; border-radius: 6px; background: #232731; font-size: 12px; }
.sale.unsold { box-shadow: inset 3px 0 #e0c341; }
.sale .m { font-size: 11px; color: #8a92a3; }
.sale .tag { font-size: 11px; padding: 0 8px; border-radius: 999px; border: 1px solid #3a3f4b; color: #c9cfdb; align-self: center; }
.sale.unsold .tag { border-color: #e0c341; color: #ffd166; }
.speedline { background: none; padding: 0; font-size: 12px; font-weight: 400; color: #a9b1c2; text-align: left; }
.speedline:hover { color: #e8e8e8; }
`;

  class Panel {
    coinsEl = el('span', { className: 'coins' });
    limitsEl = el('div', { className: 'limits' });
    lockEl = el('div', { className: 'card lock' });
    marketEl = el('div', { className: 'card market' });
    filterEl = el('div', { className: 'chips' });
    filterHint = el('div', { className: 'muted' });
    pricesEl = el('div', { className: 'card' });
    breakChips = el('span', { className: 'chips' });
    tilesEl = el('div', { className: 'tiles' });
    logEl = el('div', { className: 'log' });
    goBtn = el('button', { className: 'go' });
    relistBtn = el('button', { textContent: 'Relister au prix du marché' });
    nightBtn = el('button', { className: 'night' });
    modalEl = el('div', { className: 'modal' });
    last = null;
    lastPricesKey = '';
    config = loadSnipeConfig();
    // Album
    aConfig = loadAlbumConfig();
    aLast = null;
    aFilter = { text: '', showCollected: false };
    aOpen = new Set();
    aSig = '';
    jfilter = 'all';
    shownEventId = -1;
    view = load(`${NS}:view`, 'snipe') === 'album' ? 'album' : 'snipe';
    minimized = false;
    overlayKey = '';

    constructor(handlers, album) {
      this.handlers = handlers;
      this.album = album;
      const host = document.createElement('div');
      host.id = `${NS}-host`;
      for (const ev of ['keydown', 'keyup', 'keypress']) host.addEventListener(ev, (e) => e.stopPropagation());
      document.body.appendChild(host);
      this.root = host.attachShadow({ mode: 'open' });
      this.dock = el('div', { className: 'dock' });
      this.overlay = el('div', { className: 'overlay hidden' }, this.modalEl);
      this.root.append(el('style', { textContent: CSS }), this.overlay, this.dock);
      const first = album.setList()[0];
      if (first) this.aOpen.add(first.key);
      this.render();
      this.baseTitle = document.title;
      setInterval(() => this.last && this.renderLive(this.last), 1e3);
    }
    toggle() {
      this.dock.classList.toggle('hidden');
    }
    show() {
      this.dock.classList.remove('hidden');
    }
    setConfig(patch) {
      this.config = { ...this.config, ...patch };
      saveSnipeConfig(this.config);
      this.handlers.onChange();
    }
    patchConfig(patch) {
      this.setConfig(patch);
    }
    setAlbumConfig(patch) {
      this.aConfig = { ...this.aConfig, ...patch };
      save(K_ACONFIG, this.aConfig);
    }
    editing() {
      const a = this.root.activeElement;
      return !!a && (a.tagName === 'INPUT' || a.tagName === 'SELECT');
    }

    render() {
      const close = el('button', { className: 'x', textContent: '×', title: 'Masquer (icône de l’extension pour réafficher)', onclick: () => this.toggle() });
      const top = el('div', { className: 'top' }, el('b', { textContent: 'SnipeFC27' }), this.coinsEl, close);
      this.tabSnipe = el('button', { onclick: () => this.showView('snipe') });
      this.tabAlbum = el('button', { onclick: () => this.showView('album') });
      this.statusEl = el('div', { className: 'status hidden', title: 'Afficher la progression', onclick: () => ((this.minimized = false), this.last && this.renderLive(this.last)) });
      this.scrollEl = el('div', { className: 'scroll' }, (this.snipeView = this.buildSnipeView()), (this.albumView = this.buildAlbumView()));
      this.snipeActions = el('div', { className: 'actions' }, this.goBtn, this.nightBtn);
      this.albumActions = this.buildAlbumActions();
      this.dock.append(top, el('div', { className: 'tabs' }, this.tabSnipe, this.tabAlbum), this.statusEl, this.scrollEl, this.snipeActions, this.albumActions);
      this.showView(this.view);
      this.renderEvents(true);
    }

    showView(v) {
      this.view = v;
      save(`${NS}:view`, v);
      this.snipeView.classList.toggle('on', v === 'snipe');
      this.albumView.classList.toggle('on', v === 'album');
      this.snipeActions.classList.toggle('hidden', v !== 'snipe');
      this.albumActions.classList.toggle('hidden', v !== 'album');
      this.scrollEl.scrollTop = 0;
      this.renderTabs();
      if (v === 'album') this.renderAlbum(true);
    }
    renderTabs() {
      const s = this.last;
      const a = this.aLast;
      this.tabSnipe.replaceChildren(...['Snipe', s?.running ? el('span', { className: 'live', title: s.task === 'relist' ? 'Reliste en cours' : 'Sniper en cours' }) : null].filter(Boolean));
      this.tabAlbum.replaceChildren(
        ...['Album', a?.running ? el('span', { className: 'live', title: 'Achats en cours' }) : a?.unsold ? el('span', { className: 'count', textContent: String(a.unsold), title: 'Invendus de l’album' }) : null].filter(Boolean),
      );
      this.tabSnipe.classList.toggle('on', this.view === 'snipe');
      this.tabAlbum.classList.toggle('on', this.view === 'album');
    }

    // ===== Volet Snipe =====

    buildSnipeView() {
      const liveBtn = el('button', { textContent: 'Filtre de la Web App', title: 'Copie le filtre réglé dans la recherche du marché' });
      liveBtn.onclick = () => void this.addLiveFilter();
      const filterCard = el('div', { className: 'card' }, el('h3', { textContent: '1. Filtre' }), this.filterEl, el('div', { className: 'row' }, this.searchBox(), liveBtn), this.filterHint);
      const sellSel = this.select('sellAfterSnipe', [
        ['true', 'Revendre (recommandé)'],
        ['false', 'Garder en liste de transferts'],
      ]);
      const afterCard = el('div', { className: 'card' }, el('h3', { textContent: '2. Après un snipe' }), sellSel);
      const opts = (presets) => Object.entries(presets).map(([k, v]) => [k, `${v.label} : ${v.info}`]);
      const breakCard = el(
        'details',
        { className: 'card' },
        el('summary', {}, el('h3', {}, 'Pause et délai', this.breakChips)),
        el('div', { className: 'muted', textContent: 'Pause (fréquence et durée)' }),
        this.select('breakPreset', opts(BREAK_PRESETS)),
        el('div', { className: 'muted', textContent: 'Délai entre recherches' }),
        this.select('delayPreset', opts(DELAY_PRESETS)),
        el('div', {
          className: 'muted',
          textContent: 'Normal (conseillé) : le plus humain, pour le snipe courant. Risqué / Dangereux : occasions rapides (erreurs de prix EA), peut déclencher l’anti-ban, à utiliser rarement. Long : longues sessions sur des cartes chères.',
        }),
        el('div', { className: 'muted', textContent: 'Mode nuit : pause puis délai' }),
        this.select('nightBreakPreset', opts(BREAK_PRESETS)),
        this.select('nightDelayPreset', opts(DELAY_PRESETS)),
      );
      const mistake = this.switchInput(this.config.mistakePrevention, (v) => this.setConfig({ mistakePrevention: v }));
      const sound = this.switchInput(this.config.snipeSound, (v) => {
        this.setConfig({ snipeSound: v });
        if (v) beep();
      });
      const advCard = el(
        'details',
        { className: 'card' },
        el('summary', {}, el('h3', { textContent: 'Avancé' })),
        el(
          'div',
          { className: 'setting', title: 'Pas d’achat si la recherche renvoie plus de 15 résultats (prix d’achat trop haut ou filtre trop large).' },
          el('span', { textContent: 'Prévention des erreurs (plus de 15 résultats : pas d’achat)' }),
          mistake,
        ),
        el('div', { className: 'setting' }, el('span', { textContent: 'Son à chaque snipe réussi' }), sound),
        this.numSetting('recheckEvery', 'Revérifier les prix toutes les N recherches (0 = jamais)'),
        this.numSetting('minProfit', 'Profit min par carte (0 = 2 % du prix, 150 min)'),
      );
      this.relistBtn.onclick = () => this.handlers.onCommand({ type: 'relist' });
      const pileCard = el(
        'div',
        { className: 'card' },
        el('h3', { textContent: 'Liste de transferts' }),
        this.relistBtn,
        el('div', {
          className: 'muted',
          textContent:
            'Remet en vente les cartes expirées ou non listées, un palier sous la moins chère du marché (prix vérifié pour chaque joueur). Une carte snipée n’est jamais listée sous son prix d’achat taxe comprise ; une carte de l’album est remise au prix de la moins chère.',
        }),
      );
      const sessionCard = el('div', { className: 'card' }, el('h3', {}, 'Suivi de session', el('button', { className: 'link', textContent: 'Réinitialiser', onclick: () => this.handlers.onResetSession() })), this.tilesEl);
      const logCard = el('div', { className: 'card' }, el('h3', {}, 'Journal', el('button', { className: 'link', textContent: 'Effacer', onclick: () => this.handlers.onClearLog() })), this.logEl);
      this.goBtn.onclick = () => {
        unlockAudio();
        this.handlers.onCommand(this.last?.running ? { type: 'stop' } : { type: 'start' });
      };
      this.nightBtn.onclick = () => {
        unlockAudio();
        this.handlers.onCommand({ type: 'night', on: !this.last?.night });
      };
      this.nightBtn.title = 'Tourne sans surveillance : reprend seul après rechargement, attend au lieu de s’arrêter, change de filtre toutes les 450 à 900 recherches.';
      return el('div', { className: 'view' }, el('div', { className: 'card' }, this.limitsEl), this.marketEl, this.lockEl, filterCard, afterCard, this.pricesEl, breakCard, advCard, pileCard, sessionCard, logCard);
    }

    switchInput(checked, onChange) {
      const i = el('input', { type: 'checkbox', checked });
      i.onchange = () => onChange(i.checked);
      return el('label', { className: 'switch' }, i, el('span'));
    }
    select(key, options) {
      const s = el('select');
      const cur = String(this.config[key]);
      s.append(...options.map(([v, t]) => el('option', { value: v, textContent: t, selected: cur === v })));
      s.onchange = () => this.setConfig({ [key]: key === 'sellAfterSnipe' ? s.value === 'true' : s.value });
      return s;
    }
    numSetting(key, label) {
      const i = el('input', { type: 'number', min: '0', value: String(this.config[key]) });
      i.onchange = () => this.setConfig({ [key]: Math.max(0, Math.floor(Number(i.value) || 0)) });
      return el('div', { className: 'setting' }, el('span', { textContent: label }), i);
    }
    filters() {
      return parseFilters(this.config.snipeFilters);
    }
    saveFilters(list, active = this.config.activeFilter) {
      this.setConfig({ snipeFilters: JSON.stringify(list), activeFilter: Math.max(0, Math.min(active, list.length - 1)) });
    }
    addFilter(f) {
      const list = this.filters();
      this.filterHint.textContent = '';
      const i = list.findIndex((x) => x.label === f.label);
      if (i >= 0) return this.saveFilters(list, i);
      list.push({ ...f, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, auto: true, buyPrice: 0, sellPrice: 0 });
      this.saveFilters(list, list.length - 1);
    }
    async addLiveFilter() {
      const c = readLiveCriteria();
      if (!c) return void (this.filterHint.textContent = 'Ouvrir la recherche du marché de la Web App, régler le filtre, puis réessayer.');
      if (isEmptyCriteria(c)) return void (this.filterHint.textContent = 'Filtre vide : choisir au moins un joueur, une rareté, une ligue…');
      const parts = [];
      const defId = Number(c.maskedDefId) || 0;
      if (defId) {
        const p = await loadPlayers()
          .then((db) => db.find((x) => x.id === defId))
          .catch(() => undefined);
        parts.push(p ? `${p.name} ${p.rating}` : `joueur ${defId}`);
      }
      for (const [k, label] of Object.entries({ level: 'niveau', league: 'ligue', nation: 'nation', club: 'club', _position: 'poste', playStyle: 'style' })) {
        const v = c[k];
        if (v !== undefined && v !== -1 && v !== 'any' && v !== '-1') parts.push(`${label} ${v}`);
      }
      if (Array.isArray(c.rarities) && c.rarities.length) parts.push(`rareté ${c.rarities.join('/')}`);
      this.addFilter({ label: parts.join(', ') || String(c._type), defId: defId || null, criteria: c });
    }
    searchBox() {
      const input = el('input', { type: 'search', placeholder: 'Ajouter un joueur' });
      const results = el('div', { className: 'results' });
      let db = null;
      let timer;
      input.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          try {
            db ??= await loadPlayers();
          } catch (e) {
            this.filterHint.textContent = errMsg(e);
            return;
          }
          const found = findPlayers(db, input.value);
          this.filterHint.textContent = input.value.trim() && !found.length ? 'Aucun joueur trouvé' : '';
          results.replaceChildren(
            ...found.map((p) =>
              el('button', {
                className: 'result',
                textContent: `${p.rating}  ${p.name}`,
                onclick: () => {
                  results.replaceChildren();
                  input.value = '';
                  this.addFilter({ label: `${p.name} ${p.rating}`, defId: p.id, criteria: null });
                },
              }),
            ),
          );
        }, 200);
      };
      const wrap = el('div', {}, input, results);
      wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:4px;min-width:0';
      return wrap;
    }
    renderFilters(busy) {
      const chips = this.filters().map((f, i) => {
        const active = i === this.config.activeFilter;
        const chip = el('button', { className: `chip ${active ? 'active' : ''}`, textContent: f.label, disabled: busy && !active });
        chip.onclick = () => !busy && this.saveFilters(this.filters(), i);
        if (!busy) {
          const rm = el('span', { className: 'rm', textContent: '×', title: 'Retirer' });
          rm.onclick = (ev) => {
            ev.stopPropagation();
            const cur = this.config.activeFilter;
            this.saveFilters(
              this.filters().filter((x) => x.id !== f.id),
              i < cur ? cur - 1 : cur,
            );
          };
          chip.append(rm);
        }
        return chip;
      });
      this.filterEl.replaceChildren(...(chips.length ? chips : [el('span', { className: 'muted', textContent: 'Aucun filtre : chercher un joueur ou copier le filtre de la Web App.' })]));
    }
    renderPrices(busy) {
      const f = this.filters()[this.config.activeFilter];
      const key = JSON.stringify([f, busy, this.config.recheckEvery, this.config.sellAfterSnipe]);
      if (key === this.lastPricesKey) return;
      this.lastPricesKey = key;
      const h3 = el('h3', {}, '3. Prix');
      if (!f) return this.pricesEl.replaceChildren(h3, el('div', { className: 'muted', textContent: 'Choisir un filtre.' }));
      const patch = (p) => this.saveFilters(this.filters().map((x) => (x.id === f.id ? { ...x, ...p } : x)));
      const auto = this.switchInput(f.auto, (v) => patch({ auto: v }));
      auto.firstChild.disabled = busy;
      h3.append(el('span', { className: 'row' }, el('span', { className: 'muted', textContent: 'Automatique' }), auto));
      const profit = f.buyPrice && f.sellPrice ? profitOf(f.buyPrice, f.sellPrice) : null;
      const line = el('div', { textContent: f.buyPrice ? `Achat : ${fmt(f.buyPrice)} · Vente : ${fmt(f.sellPrice)}${profit === null ? '' : ` · Profit : ${fmt(profit)}`}` : 'Prix calculés au lancement' });
      if (f.auto) {
        const every = this.config.recheckEvery > 0 ? `toutes les ${this.config.recheckEvery} recherches et ` : '';
        return this.pricesEl.replaceChildren(h3, line, el('div', { className: 'muted', textContent: `Prix revérifiés ${every}après chaque snipe (réglable dans Avancé).` }));
      }
      const input = (k) => {
        const i = el('input', { type: 'number', min: '0', step: '50', value: String(f[k] || ''), disabled: busy });
        i.onchange = () => patch({ [k]: Math.max(0, Math.floor(Number(i.value) || 0)) });
        return i;
      };
      const grid = this.config.sellAfterSnipe ? el('div', { className: 'prices' }, 'Achat', input('buyPrice'), 'Vente', input('sellPrice')) : el('div', { className: 'prices' }, 'Achat', input('buyPrice'));
      this.pricesEl.replaceChildren(h3, grid, line);
    }

    update(s) {
      if (this.config.snipeSound && this.last && s.session.snipes > this.last.session.snipes) beep();
      this.last = s;
      const albumBusy = !!this.aLast?.running;
      this.goBtn.textContent = s.running ? 'STOP' : 'LANCER';
      this.goBtn.className = `go ${s.running ? 'stop' : ''}`;
      this.goBtn.disabled = albumBusy && !s.running;
      this.goBtn.title = this.goBtn.disabled ? 'Achats album en cours' : '';
      this.nightBtn.textContent = `Mode nuit : ${s.night ? 'ON' : 'OFF'}`;
      this.nightBtn.className = `night ${s.night ? 'on' : ''}`;
      this.coinsEl.textContent = `${fmt(s.coins)} crédits`;
      this.relistBtn.disabled = s.running || albumBusy;
      const bp = BREAK_PRESETS[this.config.breakPreset];
      const dp = DELAY_PRESETS[this.config.delayPreset];
      this.breakChips.replaceChildren(el('span', { className: 'chip', textContent: `Pause : ${bp?.label}` }), el('span', { className: 'chip', textContent: `Délai : ${dp?.label}` }));
      if (!this.editing()) {
        this.renderFilters(s.running);
        this.renderPrices(s.running);
      }
      this.logEl.replaceChildren(
        ...(s.log.length ? s.log.map((l) => el('div', { className: `line ${l.kind}` }, el('span', { className: 't', textContent: timeOf(l.at) }), l.text)) : [el('div', { className: 'muted', textContent: 'Aucun message.' })]),
      );
      this.renderAlbumActions();
      this.renderLive(s);
    }
    tile(k, v, sub, cls = '') {
      return el('div', { className: `tile ${cls}` }, el('div', { className: 'k', textContent: k }), el('div', { className: 'v', textContent: v }), el('div', { className: 's', textContent: sub, title: sub }));
    }
    renderLive(s) {
      const now = Date.now();
      const l = s.limits;
      const lim = (n, max, end) => {
        const ratio = Math.min(1, n / max);
        const cls = n >= max ? 'full' : ratio >= 0.8 ? 'warn' : '';
        const fill = el('i');
        fill.style.width = `${ratio * 100}%`;
        const free = cls && end ? el('small', { textContent: `${n >= max ? 'plein, ' : ''}libre dans ${dur(end - now)}` }) : null;
        return el('div', { className: `lim ${cls}` }, el('span', {}, el('b', { textContent: fmt(n) }), ` / ${fmt(max)}`), el('div', { className: 'bar' }, fill), free);
      };
      this.limitsEl.replaceChildren(
        el('span', { className: 'head', textContent: 'Limites anti-ban' }),
        el('span', { className: 'col', textContent: 'sur 24 h' }),
        el('span', { className: 'col', textContent: 'sur 1 h' }),
        el('span', { textContent: 'Recherches' }),
        lim(l.searchesDay, LIMITS.searchesDay, l.searchesDayEnd),
        lim(l.searchesHour, LIMITS.searchesHour, l.searchesHourEnd),
        el('span', { textContent: 'Achats' }),
        lim(l.bidsDay, LIMITS.bidsDay, l.bidsDayEnd),
        lim(l.bidsHour, LIMITS.bidsHour, l.bidsHourEnd),
      );
      this.renderMarket(now);
      const locked = s.lockedUntil > now + 1e3;
      this.lockEl.style.display = locked ? '' : 'none';
      if (locked) {
        const b = el('button', { textContent: 'Lever le verrou' });
        b.onclick = () => confirm('Lever le verrou ? Seulement si EA n’affiche plus de captcha et que le marché fonctionne à la main.') && this.handlers.onUnlock();
        this.lockEl.replaceChildren(el('div', { textContent: `Captcha ou limite EA : verrou encore ${hms(s.lockedUntil - now)}` }), b);
      }
      const se = s.session;
      const time = se.timeMs + (s.running ? now - s.updatedAt : 0);
      this.tilesEl.replaceChildren(
        this.tile('Profit estimé', fmt(se.profit), `réalisé ${fmt(se.realized)} · ${se.sales} vente(s)`),
        this.tile('Recherches', fmt(se.searches), ''),
        this.tile('Snipes', String(se.snipes), `${se.misses} raté(s) de peu`),
        this.tile('Temps de recherche', dur(time), se.since ? `${dur(now - se.since)} depuis la réinitialisation` : ''),
      );
      this.renderTabs();
      this.renderStatus(s, now);
      this.renderAlbumLock(now);
      this.renderOverlay(s, now);
    }
    renderMarket(now) {
      const m = marketNow(now);
      const t = (x) => new Date(x).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const next = m.next ? ` · marché ${LEVEL_LABEL[m.next.level]} à ${t(m.next.at)}` : '';
      this.marketEl.className = `card market ${m.level} ${m.best ? 'best' : ''}`;
      this.marketEl.replaceChildren(
        el('span', { className: 'dot' }),
        el('div', {}, el('div', {}, el('b', { textContent: m.label }), el('span', { className: 'muted', textContent: ` jusqu’à ${t(m.until)}` })), el('div', { className: 'muted', textContent: `${m.detail}${next}` })),
      );
    }
    // Ligne d'état sous les onglets : tâche en cours (cliquable si la progression est réduite)
    renderStatus(s, now) {
      const a = this.aLast;
      let text = '';
      if (a?.running) text = `Album : ${a.waitUntil > now ? `${a.waitLabel || 'Prochaine action'} dans ${fmtWait(a.waitUntil - now)}` : a.activity || 'en cours…'}`;
      else if (s.running) text = `${s.task === 'relist' ? 'Reliste' : 'Sniper'} : ${s.activity || 'en cours…'}`;
      this.statusEl.classList.toggle('hidden', !text);
      this.statusEl.textContent = this.minimized ? `${text} · afficher` : text;
    }
    renderOverlay(s, now) {
      const a = this.aLast;
      const key = s.running ? `s:${s.task}:${s.run.startedAt}` : a?.running ? `a:${a.startedAt}` : '';
      if (key !== this.overlayKey) {
        this.overlayKey = key;
        this.minimized = false;
      }
      const show = !!key && !this.minimized;
      this.overlay.classList.toggle('hidden', !show);
      if (!show) return;
      const stop = el('button', { className: 'go stop', textContent: 'STOP', onclick: () => this.handlers.onCommand({ type: 'stop' }) });
      const reduce = el('button', { className: 'link', textContent: 'Réduire (le process continue)', onclick: () => ((this.minimized = true), this.renderLive(s)) });
      if (!s.running) return this.renderAlbumOverlay(a, now, stop, reduce);
      if (s.task === 'relist') {
        const r = s.relist;
        this.modalEl.replaceChildren(
          el('div', { className: 'title' }, el('div', { className: 'spin' }), 'RELISTE'),
          el('div', { className: 'info', textContent: r ? `${r.done} / ${r.total} carte(s) traitée(s)` : 'Lecture de la liste de transferts' }),
          el('div', { className: 'info', textContent: s.activity }),
          el('div', { className: 'searchlog' }, ...s.log.slice(0, 40).map((l) => el('div', { textContent: `${timeOf(l.at)} ${l.text}` }))),
          stop,
          reduce,
        );
        return;
      }
      const r = s.run;
      const title = el(
        'div',
        { className: 'title' },
        el('div', { className: `spin ${s.phase === 'break' || s.phase === 'wait' ? 'pause' : ''}` }),
        { idle: 'DÉMARRAGE', search: 'RECHERCHE', price: 'VÉRIFICATION DU PRIX', break: 'PAUSE', wait: 'EN ATTENTE' }[s.phase],
      );
      if (s.night) title.append(el('span', { className: 'badge', textContent: 'MODE NUIT' }));
      const brk = s.breakUntil ? `pause encore ${dur(s.breakUntil - now)}` : s.breakAt ? `prochaine pause dans ${dur(s.breakAt - now)}` : 'pas de pause';
      const scroll = this.modalEl.querySelector('.searchlog')?.scrollTop ?? 0;
      const log = el('div', { className: 'searchlog' }, ...(s.searchLog.length ? s.searchLog.map((x) => el('div', { textContent: x })) : [el('div', { textContent: 'Aucune recherche pour l’instant' })]));
      const rot = s.rotationIn === null ? '' : ` · changement de filtre dans ${s.rotationIn} recherches`;
      this.modalEl.replaceChildren(
        title,
        el('div', { className: 'info', textContent: `${s.filter} · achat ≤ ${fmt(s.buyPrice)} · vente ${fmt(s.sellPrice)}${rot}` }),
        el(
          'div',
          { className: 'tiles' },
          this.tile('Profit estimé', fmt(r.profit), ''),
          this.tile('Recherches', String(r.searches), ''),
          this.tile('Snipes', String(r.snipes), `${r.misses} raté(s) de peu`),
          this.tile('Durée', dur(now - r.startedAt), brk),
        ),
        el('div', { className: 'info', textContent: s.activity }),
        log,
        stop,
        reduce,
      );
      log.scrollTop = scroll;
    }

    // ===== Volet Album =====

    buildAlbumView() {
      this.aLockEl = el('div', { className: 'card lock' });
      this.aLockEl.style.display = 'none';
      // Récapitulatif : projection, crédits, hausse, vitesse
      this.recapEl = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
      this.raiseInput = el('input', { type: 'number', min: '0', max: '300', step: '5', value: String(this.aConfig.raisePct) });
      this.raiseInput.onchange = () => {
        const v = Math.min(300, Math.max(0, Math.floor(Number(this.raiseInput.value) || 0)));
        this.raiseInput.value = String(v);
        this.setAlbumConfig({ raisePct: v });
        this.renderSets();
      };
      this.raiseRow = el(
        'div',
        { className: 'setting', title: 'Si aucune annonce au prix de départ, le prix monte par paliers de 5 % jusqu’à ce plafond' },
        el('span', { textContent: 'Si introuvable, monter jusqu’à' }),
        el('span', { className: 'pair' }, '+', this.raiseInput, '%'),
      );
      this.resumeBtn = el('button', { className: 'link', onclick: () => void this.album.runQueue() });
      this.speedLine = el('button', { className: 'speedline', title: 'Ouvrir les réglages de vitesse', onclick: () => ((this.speedCard.open = true), this.speedCard.scrollIntoView({ block: 'nearest' })) });
      const recapCard = el('div', { className: 'card' }, el('h3', { textContent: 'Récapitulatif' }), this.recapEl, this.raiseRow, this.resumeBtn, this.speedLine);
      // Sets importés depuis fut.gg
      const importBtn = el('button', { className: 'small', textContent: '+ Importer un set fut.gg', onclick: () => window.open(FUTGG_GALLERY, '_blank', 'noopener') });
      const search = el('input', { type: 'search', placeholder: 'Filtrer par nom' });
      search.oninput = () => ((this.aFilter.text = search.value.trim().toLowerCase()), this.renderSets());
      const showCol = el('input', { type: 'checkbox' });
      showCol.onchange = () => ((this.aFilter.showCollected = showCol.checked), this.renderSets());
      this.aFiltersEl = el(
        'div',
        { className: 'filters' },
        search,
        el('label', { title: 'Afficher aussi les joueurs déjà dans la Galerie' }, showCol, 'collectés'),
        el('button', { className: 'small', textContent: 'Tout', title: 'Cocher tous les manquants affichés', onclick: () => this.checkVisible(true) }),
        el('button', { className: 'small', textContent: 'Aucun', onclick: () => this.checkVisible(false) }),
      );
      this.setsEl = el('div', { className: 'sets' });
      const setsCard = el('div', { className: 'card' }, el('h3', {}, 'Sets de la Galerie', importBtn), this.aFiltersEl, this.setsEl);
      // Vitesse, ralentissement, pauses, quotas
      this.speedChips = el('span', { className: 'chips' });
      this.speedEl = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
      this.speedCard = el('details', { className: 'card' }, el('summary', {}, el('h3', {}, 'Vitesse et pauses', this.speedChips)), this.speedEl);
      this.renderSpeed();
      // Ventes
      this.heroEl = el('div', { className: 'hero' });
      this.statsEl = el('div', { className: 'tiles three' });
      this.pileEl = el('div', { className: 'muted' });
      this.salesEl = el('div', { className: 'salelist' });
      const reset = el('button', { className: 'link', textContent: 'Remettre à zéro', onclick: () => confirm('Remettre à zéro dépensé, vendus, perte réalisée et taxe ?') && this.album.resetTotals() });
      const salesCard = el(
        'div',
        { className: 'card' },
        el('h3', {}, 'Ventes de l’album', reset),
        this.heroEl,
        this.statsEl,
        this.pileEl,
        el('div', {
          className: 'muted',
          textContent:
            'Relister : encaisse les ventes, puis remet chaque invendu au prix de l’annonce la moins chère trouvée (plus haut ou plus bas qu’avant). Une carte non chargée par la Web App est remise en vente par requête directe ; en cas d’échec, remise en bloc au prix précédent.',
        }),
        this.salesEl,
      );
      // Journal de l'album
      this.jList = el('div', { className: 'log' });
      const chips = [
        ['all', 'Tout'],
        ['main', 'Essentiel'],
        ['trade', 'Achats / ventes'],
        ['issues', 'Problèmes'],
      ].map(([id, label]) => {
        const b = el('button', { className: `chip${id === this.jfilter ? ' active' : ''}`, textContent: label });
        b.onclick = () => {
          this.jfilter = id;
          for (const c of chips) c.classList.toggle('active', c === b);
          this.renderEvents(true);
        };
        return b;
      });
      const copy = el('button', { className: 'link', textContent: 'Copier' });
      copy.onclick = async () => {
        const ok = await copyText(this.album.events.map((ev) => `${new Date(ev.t).toLocaleString()} [${ev.type}] ${ev.msg}`).join('\n'));
        copy.textContent = ok ? 'Copié' : 'Échec';
        setTimeout(() => (copy.textContent = 'Copier'), 1500);
      };
      const clear = el('button', { className: 'link', textContent: 'Effacer', onclick: () => this.album.clearEvents() });
      const logCard = el('div', { className: 'card' }, el('h3', {}, 'Journal', el('span', { className: 'row' }, copy, clear)), el('div', { className: 'chips' }, ...chips), this.jList);
      return el('div', { className: 'view' }, this.aLockEl, recapCard, setsCard, this.speedCard, salesCard, logCard);
    }

    buildAlbumActions() {
      this.buyBtn = el('button', { className: 'go' });
      this.buyBtn.onclick = () => (this.album.mode === 'buy' ? this.album.stop('Achats arrêtés', true) : void this.album.validate());
      this.aRelistBtn = el('button', { className: 'night', onclick: () => this.handlers.onCommand({ type: 'relist' }) });
      return el('div', { className: 'actions' }, this.buyBtn, this.aRelistBtn);
    }

    renderAlbumActions() {
      if (!this.buyBtn) return;
      const e = this.album;
      const buying = e.mode === 'buy';
      const snipeBusy = !!this.last?.running;
      const pk = e.picks();
      this.buyBtn.className = `go ${buying ? 'stop' : ''}`;
      this.buyBtn.textContent = buying ? 'STOP' : pk.count ? `ACHETER (${pk.count})` : 'ACHETER';
      this.buyBtn.disabled = !buying && (!pk.count || snipeBusy);
      this.buyBtn.title = buying ? '' : snipeBusy ? `${this.last.task === 'relist' ? 'Reliste' : 'Sniper'} en cours` : pk.count ? `~${fmtNum(pk.spend)} crédits, coût ~${fmtNum(pk.tax)}` : 'Coche des joueurs à acheter';
      const unsold = this.aLast?.unsold ?? 0;
      this.aRelistBtn.textContent = this.last?.task === 'relist' ? 'Reliste en cours…' : `Relister${unsold ? ` (${unsold})` : ''}`;
      this.aRelistBtn.disabled = buying || snipeBusy;
      this.aRelistBtn.title = 'Relister la liste de transferts au prix du marché';
    }

    updateAlbum(s) {
      this.aLast = s;
      if (!this.setsEl) return;
      this.coinsEl.textContent = `${fmt(s.coins)} crédits`;
      this.renderAlbum(false);
      if (this.last) {
        this.goBtn.disabled = s.running && !this.last.running;
        this.relistBtn.disabled = this.last.running || s.running;
        this.renderTabs();
        this.renderStatus(this.last, Date.now());
        this.renderAlbumLock(Date.now());
        this.renderOverlay(this.last, Date.now());
      }
    }

    renderAlbum(force) {
      const s = this.aLast ?? this.album.snapshot();
      const top = this.scrollEl.scrollTop;
      if (s.pace !== this.paceShown && !this.speedEl.contains(this.root.activeElement)) this.renderSpeed();
      if (s.lastEventId !== this.shownEventId) this.renderEvents();
      const sig = `${s.mode}|${s.version}`;
      const editingSets = this.setsEl.contains(this.root.activeElement) && this.root.activeElement.tagName === 'INPUT' && this.root.activeElement.type === 'number';
      if ((force || sig !== this.aSig) && !editingSets) {
        this.aSig = sig;
        this.renderSets();
      } else this.renderRecap();
      if (this.view === 'album') this.renderSales(s);
      if (this.scrollEl.scrollTop !== top) this.scrollEl.scrollTop = top;
    }

    renderAlbumLock(now) {
      const s = this.aLast;
      if (!s || !this.aLockEl) return;
      const until = this.album.guard.lockedUntil();
      const locked = until > now;
      this.aLockEl.style.display = locked ? '' : 'none';
      const kind = this.album.guard.lockKind();
      if (locked) {
        const what = kind === 'soft' ? 'Pause limite EA (trop de requêtes)' : kind === 'snipe' ? 'Verrou anti-captcha (sniper)' : 'Pause anti-captcha';
        const b = el('button', { textContent: 'Lever', onclick: () => confirm('Lever la pause ? Seulement si aucun captcha n’est affiché.') && this.album.unlock() });
        this.aLockEl.replaceChildren(el('div', { textContent: `${what} jusqu'à ${hm(until)}${s.resumeAt ? `, reprise automatique vers ${hm(s.resumeAt)}` : ''}` }), b);
        if (!document.title.startsWith('⏸')) document.title = `⏸ ${kind === 'soft' ? 'Pause limite' : 'Pause captcha'} · ${this.baseTitle}`;
      } else if (this.baseTitle && document.title.startsWith('⏸')) document.title = this.baseTitle;
    }

    // --- Sets ---

    visibleIn(set, inQueue) {
      const t = this.aFilter.text;
      return this.album.setPlayers(set).filter((p) => (this.aFilter.showCollected || !p.collected || inQueue.has(p.defId)) && (!t || p.name.toLowerCase().includes(t)));
    }
    checkVisible(on, onlySet) {
      const e = this.album;
      const inQueue = new Set(e.queue.map((q) => q.defId));
      for (const s of onlySet ? [onlySet] : e.setList()) for (const p of this.visibleIn(s, inQueue)) if (!p.collected) e.setSelected(p.defId, on);
      this.renderSets();
    }
    renderSets() {
      const e = this.album;
      const sets = e.setList();
      this.aFiltersEl.style.display = sets.length ? '' : 'none';
      if (!sets.length) {
        this.setsEl.replaceChildren(
          el(
            'div',
            { className: 'empty' },
            el('b', { textContent: 'Aucun set importé.' }),
            el(
              'ol',
              {},
              el('li', { textContent: '« Importer un set fut.gg » : ouvre un set de la Galerie, clique le bouton vert « Envoyer à SnipeFC27 ».' }),
              el('li', { textContent: 'Coche les joueurs manquants (prix de départ = prix fut.gg, modifiable).' }),
              el('li', { textContent: '« Acheter » : chaque joueur est acheté au prix le plus bas puis remis en vente au même prix. Coût réel = taxe EA 5 %.' }),
              el('li', { textContent: '« Relister » remet les invendus au prix le plus bas du marché.' }),
            ),
          ),
        );
        this.renderRecap();
        return;
      }
      const statusOf = new Map(e.queue.map((q) => [q.defId, q]));
      const inQueue = new Set(statusOf.keys());
      this.setsEl.replaceChildren(...sets.map((s) => this.renderSet(s, statusOf, inQueue)));
      this.renderRecap();
    }
    setCounts(s) {
      const e = this.album;
      const all = e.setPlayers(s);
      const missing = all.filter((p) => !p.collected);
      const sel = missing.filter((p) => e.isSelected(p.defId));
      const cost = sel.reduce((t, p) => t + (Number(e.selection[p.defId]) || 0), 0);
      return { all, missing, sel, cost };
    }
    setProgress(s, c) {
      const got = c.all.length - c.missing.length;
      const parts = [`${got}/${c.all.length} collectés`, s.needed ? `${s.needed} requis` : '', c.sel.length ? `${c.sel.length} coché(s) ~${fmtNum(c.cost)}` : ''];
      return [bar([['ok', got]], c.all.length), el('span', { textContent: parts.filter(Boolean).join(' · ') })];
    }
    renderSet(s, statusOf, inQueue) {
      const e = this.album;
      const busy = e.mode === 'buy';
      const c = this.setCounts(s);
      const open = this.aOpen.has(s.key) || !!this.aFilter.text;
      const allBox = el('input', { type: 'checkbox', title: 'Cocher tous les manquants', checked: c.missing.length > 0 && c.sel.length === c.missing.length, disabled: busy || !c.missing.length });
      allBox.indeterminate = c.sel.length > 0 && c.sel.length < c.missing.length;
      allBox.onclick = (ev) => ev.stopPropagation();
      allBox.onchange = () => this.checkVisible(allBox.checked, s);
      const tools = el('span', { className: 'tools' });
      if (s.url) tools.append(el('button', { textContent: '↗', title: 'Ouvrir sur fut.gg (renvoyer pour mettre à jour)', onclick: (ev) => (ev.stopPropagation(), window.open(s.url, '_blank', 'noopener')) }));
      tools.append(el('button', { textContent: '×', title: 'Retirer le set', disabled: busy, onclick: (ev) => (ev.stopPropagation(), confirm(`Retirer le set « ${s.name} » ?`) && e.removeSet(s.key)) }));
      const prog = el('div', { className: 'prog' }, ...this.setProgress(s, c));
      const head = el('div', { className: 'shead' }, allBox, el('span', { className: 'nm', textContent: s.name, title: s.name }), tools, prog);
      const wrap = el('div', { className: `set${open ? ' open' : ''}` }, head);
      wrap.dataset.key = s.key;
      head.onclick = () => {
        if (this.aOpen.has(s.key)) this.aOpen.delete(s.key);
        else this.aOpen.add(s.key);
        wrap.classList.toggle('open');
        if (wrap.classList.contains('open') && !wrap.querySelector('.sbody')) wrap.append(this.renderRows(this.visibleIn(s, inQueue), statusOf));
      };
      if (open) wrap.append(this.renderRows(this.visibleIn(s, inQueue), statusOf));
      return wrap;
    }
    rowMeta(p, start, selected, q) {
      if (p.collected) return q ? [] : ['déjà dans la Galerie'];
      const ref = p.minPrice ? `fut.gg ${fmtNum(p.minPrice)}` : 'pas de prix fut.gg';
      if (!start) return [`${ref} · ${selected ? 'prix trouvé par sondage au lancement' : 'saisir un prix ou laisser vide (sondage)'}`];
      const cap = capFor(start, this.aConfig.raisePct);
      return [`${start !== p.minPrice ? `${ref} · ` : ''}${fmtNum(start)}${cap > start ? ` → max ${fmtNum(cap)}` : ''} · `, el('span', { className: 'loss', textContent: `coût ${fmtNum(taxOf(start))}` })];
    }
    renderRows(visible, statusOf) {
      const e = this.album;
      const busy = e.mode === 'buy';
      const rows = visible.map((p) => {
        const selected = e.isSelected(p.defId) && !p.collected;
        const q = statusOf.get(p.defId);
        const startOf = () => (selected ? Number(e.selection[p.defId]) || 0 : p.minPrice || 0);
        const cb = el('input', { type: 'checkbox', checked: selected, disabled: busy || p.collected });
        const price = el('input', {
          type: 'number',
          min: '200',
          step: String(step(p.minPrice || 200)),
          value: startOf() ? String(startOf()) : '',
          placeholder: 'sondage',
          disabled: busy || p.collected,
          title: 'Prix de départ (vide = sondage du marché)',
        });
        const meta = el('span', { className: 'm' }, ...this.rowMeta(p, startOf(), selected, q));
        const row = el('div', { className: `p${p.collected && !q ? ' got' : ''}${selected ? ' sel' : ''}` });
        const changed = () => {
          meta.replaceChildren(...this.rowMeta(p, cb.checked ? Number(e.selection[p.defId]) || 0 : Number(price.value) || 0, cb.checked, q));
          row.classList.toggle('sel', cb.checked);
          this.renderRecap();
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
        row.append(cb, el('span', { className: 'n' }, p.rating ? el('i', { textContent: String(p.rating) }) : null, p.name), price, meta);
        if (q) {
          const parts = [STATUS_LABEL[q.status] ?? q.status];
          if (q.price) parts.push(`à ${fmtNum(q.price)}${q.sell ? ', en vente au même prix' : ''}`);
          else if (isOpen(q) && q.max > q.start) parts.push(`prix relevé à ${fmtNum(q.max)}`);
          if (isFailed(q) && q.note) parts.push(q.note);
          row.append(el('span', { className: `st${isDone(q) ? ' ok' : isFailed(q) ? ' ko' : ''}`, textContent: parts.join(' · ') }));
        }
        return row;
      });
      if (!rows.length) rows.push(el('div', { className: 'empty', textContent: 'Aucun joueur à afficher (tous collectés ou filtrés).' }));
      return el('div', { className: 'sbody' }, ...rows);
    }
    // Met à jour les en-têtes de sets sans reconstruire les lignes (garde le focus)
    refreshSetHeads() {
      const e = this.album;
      for (const node of this.setsEl.querySelectorAll('.set')) {
        const s = e.sets[node.dataset.key];
        if (!s) continue;
        const c = this.setCounts(s);
        const box = node.querySelector('.shead input[type=checkbox]');
        if (box) {
          box.checked = c.missing.length > 0 && c.sel.length === c.missing.length;
          box.indeterminate = c.sel.length > 0 && c.sel.length < c.missing.length;
        }
        node.querySelector('.shead .prog')?.replaceChildren(...this.setProgress(s, c));
      }
    }

    // --- Récapitulatif ---

    renderRecap() {
      const e = this.album;
      const buying = e.mode === 'buy';
      this.recapEl.replaceChildren(...(buying ? this.progressView() : this.recapView()));
      this.raiseRow.style.display = buying ? 'none' : '';
      const open = e.queue.filter(isOpen).length;
      this.resumeBtn.style.display = !e.running && open ? '' : 'none';
      this.resumeBtn.textContent = `Reprendre le lot en cours (${open} restant${open > 1 ? 's' : ''})`;
      this.resumeBtn.disabled = !!this.last?.running;
      this.renderAlbumActions();
    }
    recapView() {
      const e = this.album;
      const pk = e.picks();
      if (!pk.count) {
        const last = e.queue.length ? this.lastRunLine() : '';
        return [el('div', { className: 'muted', textContent: last || 'Coche des joueurs pour voir les crédits nécessaires et la perte projetée.' })];
      }
      const wallet = coins();
      const tight = wallet !== null && pk.spend > wallet;
      const out = [
        el(
          'div',
          { className: 'tiles three' },
          this.tile('À dépenser', fmtNum(pk.spend), pk.capSpend > pk.spend ? `jusqu'à ${fmtNum(pk.capSpend)} si hausse` : `${pk.list.length} joueur(s)`, tight ? 'warn' : ''),
          this.tile('Récupéré', fmtNum(pk.spend - pk.tax), 'net, à la revente'),
          this.tile('Coût réel', fmtNum(pk.tax), pk.capTax > pk.tax ? `jusqu'à ${fmtNum(pk.capTax)} si hausse` : 'taxe EA 5 %', 'neg'),
        ),
      ];
      if (wallet !== null) {
        const scale = Math.max(wallet, pk.capSpend);
        const use = Math.min(pk.spend, wallet);
        out.push(
          el(
            'div',
            { className: 'wallet' },
            bar(
              [
                ['use', use],
                ['cap', Math.max(0, Math.min(pk.capSpend, wallet) - use)],
                ['over', Math.max(0, pk.capSpend - Math.max(wallet, use))],
              ],
              scale,
            ),
            el(
              'div',
              { className: 'legend' },
              el('span', {}, el('i', { style: 'background:#7fd1ff' }), `engagé ${fmtNum(pk.spend)}`),
              el('span', {}, el('i', { style: 'background:#2a4a5e' }), 'hausse possible'),
              el('span', { textContent: tight ? `manque ${fmtNum(pk.spend - wallet)}` : `reste ${fmtNum(wallet - pk.spend)} / ${fmtNum(wallet)}` }),
            ),
          ),
        );
      }
      const notes = [];
      if (pk.unpriced.length) notes.push(`${pk.unpriced.length} joueur(s) sans prix : prix le plus bas trouvé par sondage au lancement, non compté ci-dessus.`);
      if (tight) notes.push('Crédits insuffisants pour tout acheter : les derniers joueurs seront sautés (ils restent cochés).');
      if (notes.length) out.push(el('div', { className: `muted${tight ? ' warn' : ''}`, textContent: notes.join(' ') }));
      return out;
    }
    lastRunLine() {
      const q = this.album.queue;
      const got = q.filter((x) => x.price > 0);
      const fail = q.filter(isFailed).length;
      return `Dernier lot : ${got.length}/${q.length} achetés, ${fmtNum(got.reduce((s, x) => s + x.price, 0))} dépensés, coût réel ~${fmtNum(got.reduce((s, x) => s + taxOf(x.price), 0))}${fail ? `, ${fail} non trouvé(s) (toujours cochés)` : ''}.`;
    }
    queueStats() {
      const q = this.album.queue;
      const got = q.filter((x) => x.price > 0);
      const cur = q.find((x) => x.status === 'searching') ?? q.find(isOpen);
      const sets = [...new Set(q.map((x) => x.set))];
      let setLine = '';
      if (cur) {
        const inSet = q.filter((x) => x.set === cur.set);
        setLine = `Set ${sets.indexOf(cur.set) + 1}/${sets.length} « ${cur.set} » : ${inSet.filter((x) => !isOpen(x)).length}/${inSet.length} traités`;
      }
      return {
        q,
        got,
        fail: q.filter(isFailed).length,
        open: q.filter(isOpen).length,
        spent: got.reduce((s, x) => s + x.price, 0),
        planned: q.reduce((s, x) => s + (x.price || x.start || 0), 0),
        tax: got.reduce((s, x) => s + taxOf(x.price), 0),
        cur,
        setLine,
        curLine: cur ? `En cours : ${cur.name}${cur.max ? ` ≤ ${fmtNum(cur.max)}${cur.max > cur.start ? ` (relevé, plafond ${fmtNum(cur.cap)})` : ''}` : ' (sondage)'}` : '',
      };
    }
    progressView() {
      const st = this.queueStats();
      return [
        el(
          'div',
          { className: 'tiles three' },
          this.tile('Achetés', `${st.got.length} / ${st.q.length}`, `${st.open} restant(s)${st.fail ? `, ${st.fail} non trouvé(s)` : ''}`, 'pos'),
          this.tile('Dépensé', fmtNum(st.spent), `prévu ~${fmtNum(st.planned)}`),
          this.tile('Coût réel', fmtNum(st.tax), 'taxe à la revente', 'neg'),
        ),
        bar(
          [
            ['ok', st.got.length],
            ['over', st.fail],
          ],
          st.q.length,
        ),
        st.setLine ? el('div', { textContent: st.setLine }) : null,
        st.curLine ? el('div', { className: 'muted', textContent: st.curLine }) : null,
      ].filter(Boolean);
    }
    renderAlbumOverlay(a, now, stop, reduce) {
      const st = this.queueStats();
      const waiting = a.waitUntil > now;
      const phase = waiting ? 'wait' : a.phase;
      const title = el(
        'div',
        { className: 'title' },
        el('div', { className: `spin ${waiting ? 'pause' : ''}` }),
        { search: 'RECHERCHE', buy: 'ACHAT', list: 'MISE EN VENTE', wait: 'EN ATTENTE' }[phase] ?? 'DÉMARRAGE',
        el('span', { className: 'badge album', textContent: 'ALBUM' }),
      );
      const pace = this.album.guard.pace(this.aConfig);
      const scroll = this.modalEl.querySelector('.searchlog')?.scrollTop ?? 0;
      const log = el('div', { className: 'searchlog' }, ...(a.feed.length ? a.feed.map((x) => el('div', { textContent: x })) : [el('div', { textContent: 'Aucune recherche pour l’instant' })]));
      this.modalEl.replaceChildren(
        title,
        el('div', { className: 'info', textContent: [st.setLine, st.curLine].filter(Boolean).join(' · ') || 'Lecture de la liste de transferts' }),
        el(
          'div',
          { className: 'tiles' },
          this.tile('Achetés', `${st.got.length} / ${st.q.length}`, `${st.open} restant(s)${st.fail ? `, ${st.fail} non trouvé(s)` : ''}`, 'pos'),
          this.tile('Dépensé', fmtNum(st.spent), `prévu ~${fmtNum(st.planned)}`),
          this.tile('Coût réel', fmtNum(st.tax), 'taxe EA 5 % à la revente', 'neg'),
          this.tile('Durée', dur(now - a.startedAt), `vitesse ${this.speedName()}${pace > 1 ? `, ralentie ×${dec(pace)}` : ''}`),
        ),
        bar(
          [
            ['ok', st.got.length],
            ['over', st.fail],
          ],
          st.q.length,
        ),
        el('div', { className: 'info', textContent: waiting ? `${a.waitLabel || 'Prochaine action'} dans ${fmtWait(a.waitUntil - now)}` : a.activity }),
        log,
        stop,
        reduce,
      );
      log.scrollTop = scroll;
    }

    // --- Vitesse : préréglages, délais (s), ralentissement après limite EA, pauses, quotas ; appliqués immédiatement ---

    speedName() {
      const c = this.aConfig;
      const keys = Object.keys(SPEED_DEFAULTS);
      return SPEED_PRESETS.find(([, v]) => keys.every((k) => v[k] === c[k]))?.[0] ?? 'personnalisée';
    }
    renderSpeed() {
      const c = this.aConfig;
      const active = this.speedName();
      const pace = this.album.guard.pace(c);
      // scale : 1e3 pour des secondes stockées en ms ; min : valeur plancher
      const input = (k, stepV, scale = 1, min = 0) => {
        const i = el('input', { type: 'number', min: String(min), step: String(stepV), value: String(c[k] / scale) });
        i.onchange = () => {
          const v = Math.round(Math.max(min, Number(String(i.value).replace(',', '.')) || 0) * scale * 10) / 10;
          const patch = { [k]: scale > 1 ? Math.round(v) : v };
          // min ≤ max : la borne modifiée entraîne l'autre
          if (k === 'minDelayMs' && v > c.maxDelayMs) patch.maxDelayMs = v;
          if (k === 'maxDelayMs' && v < c.minDelayMs) patch.minDelayMs = v;
          if (k === 'buyDelayMinMs' && v > c.buyDelayMaxMs) patch.buyDelayMaxMs = v;
          if (k === 'buyDelayMaxMs' && v < c.buyDelayMinMs) patch.buyDelayMinMs = v;
          this.setAlbumConfig(patch);
          // Reconstruction différée : retirer le champ encore focalisé pendant son « change » lève une erreur
          setTimeout(() => this.renderSpeed());
        };
        return i;
      };
      const row = (label, ...ctrl) => el('div', { className: 'setting' }, el('span', { textContent: label }), el('span', { className: 'pair' }, ...ctrl));
      const pair = (a, b, stepS) => [input(a, stepS, 1e3), '–', input(b, stepS, 1e3), 's'];
      const presets = SPEED_PRESETS.map(([name, v]) =>
        el('button', { className: `chip${name === active ? ' active' : ''}`, textContent: `${name} ${dec(v.minDelayMs / 1e3)}–${dec(v.maxDelayMs / 1e3)} s`, onclick: () => (this.setAlbumConfig({ ...v }), this.renderSpeed()) }),
      );
      const off = c.paceStep <= 1 || c.paceMax <= 1 || c.paceResetMin <= 0;
      const paceState = off
        ? 'Ralentissement désactivé : seule la pause après limite EA s’applique.'
        : pace > 1
          ? `Rythme actuel ralenti ×${dec(pace)} (délais ${dec((c.minDelayMs * pace) / 1e3)}–${dec((c.maxDelayMs * pace) / 1e3)} s) jusqu’à ${hm(this.album.guard.paceUntil(c))} sans nouvelle limite.`
          : 'Rythme normal.';
      const resetBtn = pace > 1 ? el('button', { className: 'link', textContent: 'Revenir au rythme normal', onclick: () => (this.album.guard.resetPace(), this.album.log('Rythme remis à la normale'), this.renderSpeed()) }) : null;
      this.speedChips.replaceChildren(...[el('span', { className: 'chip', textContent: `Vitesse : ${active}` }), pace > 1 ? el('span', { className: 'chip', textContent: `×${dec(pace)}` }) : null].filter(Boolean));
      this.speedLine.textContent = `Vitesse : ${active} (${dec(c.minDelayMs / 1e3)}–${dec(c.maxDelayMs / 1e3)} s entre recherches)${pace > 1 ? ` · ralenti ×${dec(pace)}` : ''} ›`;
      const head = (t) => el('div', { className: 'muted', textContent: t, style: 'margin-top:4px' });
      this.speedEl.replaceChildren(
        head('Préréglage (délai entre recherches)'),
        el('div', { className: 'chips' }, ...presets),
        row('Délai entre recherches', ...pair('minDelayMs', 'maxDelayMs', 0.5)),
        row('Délai avant achat', ...pair('buyDelayMinMs', 'buyDelayMaxMs', 0.1)),
        head('Ralentissement après limite EA'),
        row('Multiplier les délais à chaque limite (1 = jamais)', '×', input('paceStep', 0.1, 1, 1)),
        row('Ralentissement maximal', '×', input('paceMax', 0.5, 1, 1)),
        row('Retour au rythme normal après (sans limite)', input('paceResetMin', 5), 'min'),
        el('div', { className: 'row' }, el('span', { className: 'muted', style: 'flex:1', textContent: paceState }), resetBtn),
        head('Pauses après refus EA (0 = aucune, reprise immédiate)'),
        row('Après limite EA 426 / 429 / 512 / 521', input('softPauseMin', 1), 'min'),
        row('Après captcha 458 / 460 / 494', input('captchaPauseMin', 5), 'min'),
        head('Quotas (0 = illimité, sniper compris)'),
        row('Recherches max par heure', input('quotaSearchHour', 50)),
        row('Recherches max par 24 h', input('quotaSearchDay', 100)),
        row('Achats max par 24 h', input('quotaBuyDay', 10)),
        el('div', { className: 'muted', textContent: 'Plus rapide = plus de risque de limite EA ou de captcha. Le verrou anti-captcha du sniper (12 h) bloque aussi l’album.' }),
      );
      this.paceShown = pace;
    }

    // --- Ventes ---

    renderSales(s) {
      const e = this.album;
      const t = s.total;
      const real = t.lost + s.pendingLoss;
      this.heroEl.replaceChildren(
        el('span', { textContent: 'Coût réel' }),
        el('b', { className: real > 0 ? 'neg' : real < 0 ? 'pos' : '', textContent: real < 0 ? `+${fmtNum(-real)}` : fmtNum(real) }),
        el('small', { textContent: `réalisé ${t.lost < 0 ? `+${fmtNum(-t.lost)}` : fmtNum(t.lost)} · en attente ${fmtNum(s.pendingLoss)}` }),
      );
      const items = Object.values(e.bought);
      const value = items.reduce((v, b) => v + (b.sell || b.price), 0);
      this.statsEl.replaceChildren(
        this.tile('En vente', `${items.length}`, `valeur ${fmtNum(value)}${s.unsold ? `, ${s.unsold} invendu(s)` : ''}`, s.unsold ? 'warn' : ''),
        this.tile('Vendus', `${fmtNum(t.sold)} / ${fmtNum(t.bought)}`, `récupéré ${fmtNum(t.received)}`),
        this.tile('Dépensé', fmtNum(t.spent), `taxe payée ${fmtNum(t.tax)}`),
      );
      const p = e.pile;
      this.pileEl.textContent = p ? `Liste de transferts lue à ${hm(p.at)} : ${p.active} en vente, ${p.unsold} invendu(s), ${p.sold} vente(s) encaissée(s).` : '';
      const sorted = items.sort((a, b) => Number(isUnsold(b)) - Number(isUnsold(a)) || (b.at ?? 0) - (a.at ?? 0));
      this.salesEl.replaceChildren(
        ...(sorted.length
          ? sorted.map((b) => {
              const sell = b.sell || b.price;
              const loss = b.price - netOf(sell);
              return el(
                'div',
                { className: `sale${isUnsold(b) ? ' unsold' : ''}` },
                el('b', { textContent: b.name || `#${b.defId}` }),
                el('span', { className: 'tag', textContent: isUnsold(b) ? 'invendu' : 'en vente' }),
                el('span', { className: 'm', textContent: `acheté ${fmtNum(b.price)} → affiché ${fmtNum(sell)}` }),
                el('span', { className: 'm', textContent: loss >= 0 ? `perte ${fmtNum(loss)}` : `gain ${fmtNum(-loss)}` }),
              );
            })
          : [el('div', { className: 'muted', textContent: 'Aucun joueur de l’album en vente.' })]),
      );
    }

    // --- Journal de l'album ---

    eventRow(ev) {
      const tm = new Date(ev.t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      return el('div', { className: `line ${ev.type}` }, el('span', { className: 't', textContent: tm }), ev.msg);
    }
    eventMatches(ev) {
      const f = this.jfilter;
      if (f === 'all') return true;
      if (f === 'main') return ev.type !== 'step';
      if (f === 'trade') return ev.type === 'buy' || ev.type === 'sell' || ev.type === 'list';
      return ev.type === 'miss' || ev.type === 'error' || ev.type === 'warn' || ev.type === 'lock';
    }
    renderEvents(full = false) {
      const evs = this.album.events;
      const newest = evs[0]?.id ?? 0;
      if (full || newest < this.shownEventId || this.shownEventId < 0) {
        this.jList.replaceChildren(
          ...evs
            .filter((ev) => this.eventMatches(ev))
            .slice(0, 300)
            .map((ev) => this.eventRow(ev)),
        );
      } else {
        const fresh = evs.filter((ev) => ev.id > this.shownEventId).reverse();
        if (fresh.length) this.jList.querySelector('.empty')?.remove();
        for (const ev of fresh) if (this.eventMatches(ev)) this.jList.prepend(this.eventRow(ev));
        while (this.jList.childElementCount > 300) this.jList.lastChild.remove();
      }
      if (!this.jList.childElementCount) this.jList.replaceChildren(el('div', { className: 'muted empty', textContent: evs.length ? 'Aucun message pour ce filtre.' : 'Aucun message.' }));
      this.shownEventId = newest;
    }
  }

  // ---------- Démarrage ----------

  installNetHooks();

  // Écoute posée dès le chargement : l'import fut.gg peut arriver avant que la Web App soit prête
  let onCommand = null;
  const pendingCmds = [];
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.ns !== NS || e.data.dir !== 'to-page' || !e.data.cmd) return;
    if (onCommand) onCommand(e.data.cmd);
    else pendingCmds.push(e.data.cmd);
  });

  const post = (data) => window.postMessage({ ns: NS, dir: 'to-ext', ...data }, window.location.origin);

  function init() {
    let panel = null;
    const guard = new Guard();
    const snipe = new SnipeEngine(
      () => panel?.config ?? loadSnipeConfig(),
      (s) => {
        panel?.update(s);
        post({ stats: s });
      },
      (p) => panel?.patchConfig(p),
      guard,
    );
    const album = new AlbumEngine(
      () => panel?.aConfig ?? loadAlbumConfig(),
      (s) => {
        panel?.updateAlbum(s);
        post({ albumStats: s });
      },
      guard,
      snipe,
    );
    snipe.album = album;
    onCommand = (cmd) => {
      if (cmd.type === 'start') snipe.start(false);
      else if (cmd.type === 'night') snipe.setNightMode(cmd.on);
      else if (cmd.type === 'relist') snipe.relistTransferList();
      else if (cmd.type === 'stop') {
        if (album.running || album.resumePending()) album.stop('Arrêt demandé', true);
        snipe.stop();
      } else if (cmd.type === 'album-buy') void album.validate();
      else if (cmd.type === 'import') {
        if (!(Number(cmd.data?.at) > Number(load(K_IMPORT_AT, 0)))) return;
        save(K_IMPORT_AT, Number(cmd.data.at));
        const key = album.importSet(cmd.data);
        if (key) {
          panel.aOpen.add(key);
          panel.show();
          panel.showView('album');
          album.emit();
        }
      } else panel.toggle();
    };
    panel = new Panel(
      {
        onCommand,
        onUnlock: () => snipe.unlock(),
        onResetSession: () => snipe.resetSession(),
        onClearLog: () => snipe.clearLog(),
        onChange: () => {
          const s = snipe.snapshot();
          panel.update(s);
          post({ stats: s });
        },
      },
      album,
    );
    album.emit();
    snipe.emit();
    const n = album.setList().length;
    album.log(`Web App détectée, prêt${n ? ` (${n} set${n > 1 ? 's' : ''})` : ''}`);

    // Album : pause enregistrée alors qu'aucune n'est réglée, levée ; reprise des achats interrompus
    const cfg = loadAlbumConfig();
    const kind = album.guard.ownKind();
    if ((kind === 'soft' && cfg.softPauseMin <= 0) || (kind === 'hard' && cfg.captchaPauseMin <= 0)) {
      album.guard.unlockOwn();
      album.log('Pause en cours levée (aucune pause réglée)');
    }
    const albumAt = Number(load(K_ARESUME, 0));
    save(K_ARESUME, 0);
    let albumResume = false;
    if (album.resumePending()) album.scheduleResume();
    else if ((albumAt && Date.now() - albumAt < 9e5) || load(K_ACTIVE, false)) {
      if (album.queue.some(isOpen)) {
        albumResume = true;
        album.log('Reprise automatique des achats dans 10 s');
        setTimeout(() => void album.runQueue(), 1e4);
      } else save(K_ACTIVE, false);
    }
    // Sniper : reprise après rechargement (401) ou mode nuit
    try {
      const r = load(K_RESUME, null);
      localStorage.removeItem(K_RESUME);
      if (!albumResume && r && Date.now() - r.at < 9e5) setTimeout(() => (r.night ? snipe.setNightMode(true) : void snipe.start(false)), 5e3);
      else if (!albumResume && snipe.nightOn) setTimeout(() => snipe.setNightMode(true), 5e3);
    } catch {}
    pendingCmds.splice(0).forEach(onCommand);
  }

  // Reprise attendue (rechargement après 401, mode nuit, achats album en cours) : clic automatique sur le bouton
  // de connexion de la Web App (session déjà ouverte côté EA ; aucun identifiant n'est saisi)
  const LOGIN_RE = /^\s*(log ?in|se connecter|connexion|ouvrir une session|anmelden|iniciar sesión|accedi)\s*$/i;
  const resumeExpected = () => nightOn() || Number(load(K_ARESUME, 0)) > Date.now() - 9e5 || load(K_ACTIVE, false) || !!load(K_LOCK_RESUME, null) || (load(K_RESUME, null)?.at ?? 0) > Date.now() - 9e5;
  let loginClicks = 0;
  let lastClick = 0;
  const bootAt = Date.now();
  const boot = setInterval(() => {
    if (webAppReady()) {
      clearInterval(boot);
      init();
      return;
    }
    if (loginClicks < 3 && Date.now() - bootAt > 4e3 && Date.now() - bootAt < 3e5 && Date.now() - lastClick > 15e3 && resumeExpected()) {
      const btn = [...document.querySelectorAll('button, a.btn-standard, .btn-standard')].find((b) => LOGIN_RE.test(b.textContent ?? '') && b.offsetParent !== null && !b.disabled);
      if (btn) {
        lastClick = Date.now();
        loginClicks++;
        setTimeout(() => btn.click(), 2e3 + Math.random() * 3e3);
      }
    }
  }, 1e3);
})();
