// Galerie : sets fut.gg, scan du club et sets proposés selon le solde, statut Galerie lu chez EA, achat direct au prix du marché (méthode FST)
// Garde-fous, délais et pause anti-captcha : ceux du moteur de sniping (communs)
(function () {
  const X = globalThis.__fc27;
  const { fmt: fmtNum, rand, sleep, load, save, errText, errMsg, roundPrice, tickUp, net: netOf } = X;
  const NS = X.ALBUM_NS;
  const BUY_SEARCHES = 10;
  const MAX_COMPETITION = 6;
  const MAX_MISSES = 8;
  const MAX_LIST_FAILS = 3;
  const FEED_SIZE = 30;
  const DEFAULT_TOLERANCE = 3;

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
  const K_IMPORT_AT = `${NS}:importAt`;
  const K_HIDDEN = `${NS}:hiddenSets`;
  const K_CATALOG_AT = `${NS}:catalogAt`;
  const K_CLUB = `${NS}:club`;
  const CLUB_PAGES = 120;
  X.ALBUM_KEYS = { K_RESUME, K_ACTIVE, K_LOCK_RESUME, K_IMPORT_AT };

  const tolCap = (p, n) => {
    let r = p;
    for (let i = 0; i < n && r > 0; i++) r = tickUp(r);
    return r;
  };
  // Prix plancher du sondage (FST) : or/argent/bronze selon la note pour les cartes communes et rares, 1 000 sinon
  const minPriceFor = (rareflag, rating) => (![0, 1].includes(Number(rareflag ?? 0)) ? 1e3 : Number(rating) >= 75 ? 350 : 200);
  const markupPrice = (p, pct) => {
    if (pct <= 0) return roundPrice(p);
    const m = p * (1 + pct / 100);
    return Math.max(Math.ceil(m / X.step(m)) * X.step(m), tickUp(p));
  };
  // Annonce publiée depuis plus d'une minute (FST écarte les annonces toutes fraîches du prix de référence)
  const DURATIONS = [3600, 10800, 21600, 43200, 86400, 259200];
  const settled = (sr) => !Number.isFinite(sr) || Math.floor(((DURATIONS.find((d) => sr < d) ?? DURATIONS[DURATIONS.length - 1]) - sr) / 60) > 1;
  // Score Galerie d'une carte : barème communautaire FC 27 (non publié par EA, ajustable en cours de saison).
  // Or 75-99 selon la note, argent 35, bronze 20 ; rareté spéciale x1,25 (estimation). Bonus de tags non comptés.
  const GOLD_SCORE = { 75: 90, 76: 100, 77: 120, 78: 140, 79: 160, 80: 180, 81: 280, 82: 340, 83: 410, 84: 830, 85: 2100, 86: 4100, 87: 5500, 88: 8300, 89: 11e3, 90: 14e3, 91: 19e3, 92: 2e4, 93: 25e3, 94: 3e4, 95: 4e4, 96: 55e3, 97: 85e3, 98: 9e4, 99: 1e5 };
  const itemScore = (rating, rareflag) => {
    const r = Math.floor(Number(rating) || 0);
    if (r < 40) return 0;
    const base = r >= 99 ? 1e5 : r >= 75 ? GOLD_SCORE[r] : r >= 65 ? 35 : 20;
    return Math.round(base * (Number(rareflag) > 1 ? 1.25 : 1));
  };
  X.itemScore = itemScore;
  const validId = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

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
  const costOf = (q) => (q.status === 'listed' ? q.price - netOf(q.sell || q.price) : q.price);
  const tolOf = (cfg) => (cfg.toleranceAuto ? DEFAULT_TOLERANCE : cfg.tolerance);
  const sellFor = (p, cfg) => (cfg.afterBuy === 'keep' ? 0 : cfg.afterBuy === 'markup' ? markupPrice(p, cfg.markupPct) : roundPrice(p));
  const isOpen = (q) => q.status === 'pending' || q.status === 'searching';
  const isUnsold = (b) => b.state === 'expired' || b.state === 'unlisted';
  const EMPTY_TOTAL = { bought: 0, spent: 0, sold: 0, received: 0, tax: 0, lost: 0, kept: 0, keptSpent: 0 };
  Object.assign(X, { isDone, isFailed, isOpen, isUnsold, tolOf, netOf, step: X.step });

  X.Album = class {
    mode = null; // 'buy' | 'check' | null
    stopRequested = false;
    activityText = '';
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
    itemData = new Map(); // defId -> itemData EA (/defid), pour afficher les cartes
    hiddenSets = new Set(load(K_HIDDEN, []));
    catalog = { busy: false, text: '', at: Number(load(K_CATALOG_AT, 0)) || 0 };
    clubIds = new Set(load(K_CLUB, null)?.ids ?? []); // joueurs présents au club au dernier scan
    clubAt = Number(load(K_CLUB, null)?.at) || 0;
    waitUntil = 0;
    waitLabel = '';

    // ctx : { guard, delay(), beforeTask(), afterTask(), onSold(items) }
    constructor(getConfig, onUpdate, ctx) {
      this.getConfig = getConfig;
      this.onUpdate = onUpdate;
      this.ctx = ctx;
    }
    get guard() {
      return this.ctx.guard;
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
        sets: this.setList().length,
        queue: { total: q.length, done: q.filter(isDone).length, failed: q.filter(isFailed).length, open: q.filter(isOpen).length },
        total: { ...this.total },
        pendingLoss: this.pendingLoss(),
        onSale: onSale.length,
        unsold: onSale.filter(isUnsold).length,
        resumeAt: this.resumeAt,
      };
    }
    touch() {
      this.version++;
    }
    emit() {
      this.onUpdate();
    }
    log(msg, type) {
      this.lastMessage = msg;
      X.journal.add(msg, type, true);
      this.emit();
    }
    feed(msg, type) {
      const t = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      this.feedLines = [`${t} ${msg}`, ...this.feedLines].slice(0, FEED_SIZE);
      X.journal.add(msg, type, false);
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
    saveBought() {
      save(K_BOUGHT, this.bought);
    }
    pendingLoss() {
      return Object.values(this.bought).reduce((s, b) => s + b.price - netOf(b.sell || b.price), 0);
    }
    resetTotals() {
      this.total = { ...EMPTY_TOTAL };
      save(K_TOTAL, this.total);
      this.log('Compteurs Galerie remis à zéro');
    }

    // --- Sets ---

    saveSets() {
      this.touch();
      return save(K_SETS, this.sets);
    }
    setList() {
      return Object.values(this.sets).sort((a, b) => b.at - a.at);
    }
    refreshCollected(p) {
      if (!p.collected && (X.netItems.get(p.defId)?.collected || this.done.has(p.defId) || this.clubIds.has(p.defId))) p.collected = true;
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
    isCollected(defId) {
      const p = this.findPlayer(defId);
      return p ? this.refreshCollected(p).collected : this.done.has(Number(defId));
    }
    isSelected(defId) {
      return Object.prototype.hasOwnProperty.call(this.selection, defId);
    }
    setSelected(defId, on, price) {
      if (on) this.selection[defId] = price !== undefined ? price : (this.selection[defId] ?? this.findPlayer(defId)?.minPrice ?? 0);
      else delete this.selection[defId];
      save(K_SEL, this.selection);
    }
    removeSet(key) {
      const set = this.sets[key];
      if (!set) return;
      delete this.sets[key];
      this.hiddenSets.add(key);
      save(K_HIDDEN, [...this.hiddenSets]);
      const still = new Set(Object.values(this.sets).flatMap((s) => Object.keys(s.players ?? {})));
      for (const id of Object.keys(this.selection)) if (!still.has(id)) delete this.selection[id];
      save(K_SEL, this.selection);
      this.saveSets();
      this.log(`Set « ${set.name} » retiré`);
    }

    // Projection de coût selon « Après achat » (revente : coût = taxe 5 % ; club : coût = prix payé)
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
      const w = X.coins();
      let fit = list.length;
      if (w !== null) {
        let left = w;
        fit = 0;
        for (const x of list) {
          if (x.start > left) break;
          left -= x.start;
          fit++;
        }
      }
      return {
        list,
        unpriced,
        count: list.length + unpriced.length,
        spend: sum((x) => x.start),
        capSpend: sum((x) => x.cap),
        back: sum((x) => back(x.start)),
        tax: cfg.afterBuy === 'keep' ? 0 : sum((x) => sellFor(x.start, cfg) - back(x.start)),
        fit,
        cost: sum((x) => x.start - back(x.start)),
        capCost: sum((x) => x.cap - back(x.cap)),
      };
    }

    // --- Sets à faire : scan du club, coût pour finir chaque set, sets proposés selon le solde ---

    priceOf(p) {
      const v = Number(this.selection[p.defId]);
      return v >= 150 ? Math.floor(v) : p.minPrice || 0;
    }
    // Coût réel d'une carte selon « Après achat » (revente : taxe ; club : prix payé)
    costFor(price) {
      const cfg = this.getConfig();
      return price - (cfg.afterBuy === 'keep' ? 0 : netOf(sellFor(price, cfg)));
    }
    // Cartes à acheter pour finir un set : les manquantes, ou les moins chères si le set n'en demande qu'une partie
    toFinish(set) {
      const all = this.setPlayers(set);
      const missing = all.filter((p) => !p.collected).sort((x, y) => (this.priceOf(x) || Infinity) - (this.priceOf(y) || Infinity));
      const req = set.needed > 0 && set.needed < all.length ? set.needed : all.length;
      return missing.slice(0, Math.max(0, req - (all.length - missing.length)));
    }
    // Ordre glouton : à chaque tour le set le moins cher à finir, joueurs communs déjà prévus comptés une fois.
    // Avec budget : seuls les sets entièrement chiffrés qui tiennent dans ce qui reste du solde (sets proposés)
    planSets(keys, budget = null) {
      const left = keys
        .map((k) => this.sets[k])
        .filter(Boolean)
        .map((s) => ({ s, need: this.toFinish(s) }))
        .filter((x) => x.need.length);
      const covered = new Set();
      const out = [];
      let rest = budget ?? Infinity;
      while (left.length) {
        let best = null;
        for (const [i, x] of left.entries()) {
          const cards = x.need.filter((p) => !covered.has(p.defId));
          const unpriced = cards.filter((p) => !this.priceOf(p)).length;
          const spend = cards.reduce((t, p) => t + this.priceOf(p), 0);
          if (budget !== null && (unpriced || spend > rest)) continue;
          const rank = unpriced * 1e12 + spend;
          if (!best || rank < best.rank) best = { i, x, cards, unpriced, spend, rank };
        }
        if (!best) break;
        left.splice(best.i, 1);
        for (const p of best.cards) covered.add(p.defId);
        rest -= best.spend;
        const { s, need } = best.x;
        out.push({ key: s.key, name: s.name, need: need.length, cards: best.cards, spend: best.spend, unpriced: best.unpriced, cost: best.cards.reduce((t, p) => t + this.costFor(this.priceOf(p)), 0) });
      }
      return out;
    }
    proposedSets() {
      const c = X.coins();
      return c === null ? [] : this.planSets(this.setList().map((s) => s.key), c);
    }

    // --- Objectif niveau Galerie : points estimés gagnés par carte achetée ---

    scoreOf(p) {
      return itemScore(p.rating, p.rareflag);
    }
    // Emplacements d'un set : cartes requises, sinon tous ses joueurs
    slotsOf(set) {
      const n = Object.keys(set.players ?? {}).length;
      return set.needed > 0 && set.needed < n ? set.needed : n;
    }
    // Meilleurs scores collectés de chaque set, dans la limite de ses emplacements
    levelState() {
      const state = new Map();
      for (const s of this.setList()) {
        const slots = this.slotsOf(s);
        const top = this.setPlayers(s)
          .filter((p) => p.collected)
          .map((p) => this.scoreOf(p))
          .sort((x, y) => y - x)
          .slice(0, slots);
        state.set(s.key, { slots, top });
      }
      return state;
    }
    estimatedScore() {
      let t = 0;
      for (const { top } of this.levelState().values()) for (const v of top) t += v;
      return t;
    }
    // Glouton paresseux sur points / crédit : une carte compte dans chaque set où elle entre (ou remplace une carte plus faible).
    // need : points à gagner ; budget : crédits engagés au plus (achats successifs, sans compter les reventes)
    planLevel(need, budget) {
      const state = this.levelState();
      const where = new Map();
      for (const s of this.setList())
        for (const p of Object.values(s.players ?? {})) {
          if (this.refreshCollected(p).collected || !this.priceOf(p) || !this.scoreOf(p)) continue;
          const w = where.get(p.defId) ?? { p, keys: [], price: this.priceOf(p), score: this.scoreOf(p) };
          w.keys.push(s.key);
          where.set(p.defId, w);
        }
      const gainOf = (w) =>
        w.keys.reduce((t, k) => {
          const st = state.get(k);
          return t + (st.top.length < st.slots ? w.score : Math.max(0, w.score - st.top[st.top.length - 1]));
        }, 0);
      const ratio = (x) => x.gain / x.w.price;
      const heap = [...where.values()].map((w) => ({ w, gain: gainOf(w) })).filter((x) => x.gain > 0);
      heap.sort((a, b) => ratio(b) - ratio(a));
      const picks = [];
      let spend = 0;
      let gain = 0;
      while (heap.length && gain < need && budget - spend >= 150) {
        const x = heap.shift();
        const g = gainOf(x.w);
        if (g < x.gain) {
          x.gain = g;
          if (g > 0) {
            let i = heap.findIndex((y) => ratio(y) < ratio(x));
            heap.splice(i < 0 ? heap.length : i, 0, x);
          }
          continue;
        }
        if (spend + x.w.price > budget) continue;
        picks.push({ p: x.w.p, price: x.w.price, gain: g, keys: x.w.keys });
        spend += x.w.price;
        gain += g;
        for (const k of x.w.keys) {
          const st = state.get(k);
          st.top.push(x.w.score);
          st.top.sort((a, b) => b - a);
          if (st.top.length > st.slots) st.top.pop();
        }
      }
      return { picks, spend, gain, cost: picks.reduce((t, x) => t + this.costFor(x.price), 0), candidates: where.size };
    }
    async buyLevel(picks) {
      if (this.running) return;
      const tol = tolOf(this.getConfig());
      const queue = picks.map(({ p }) => {
        this.setSelected(p.defId, true);
        return this.entryOf(p, 'Objectif niveau', tol);
      });
      if (!queue.length) return this.log('Objectif niveau : aucune carte à acheter');
      const gain = picks.reduce((t, x) => t + x.gain, 0);
      this.log(`Objectif niveau : ${queue.length} carte(s) pour ~${fmtNum(gain)} points estimés, de la plus rentable (points / crédit) à la moins rentable`);
      this.queue = queue;
      save(K_QUEUE, this.queue);
      this.touch();
      await this.runQueue();
    }

    // Joueurs présents au club (scan page par page) puis Galerie EA (joueurs passés) ; true si mené à terme
    async scanClub() {
      if (!this.setList().length) {
        this.requestCatalog(true);
        this.log('Scan du club : aucun set importé, lecture du catalogue fut.gg lancée, relancer le scan ensuite', 'warn');
        return false;
      }
      if (!(await this.enter('scan'))) return false;
      const ids = new Set();
      try {
        let full = false;
        for (let page = 0; page < CLUB_PAGES && !this.stopRequested; page++) {
          if (page) await this.sleep(rand(1200, 2500), 'Scan du club, page suivante');
          if (this.stopRequested) break;
          this.activity(`Scan du club : page ${page + 1}, ${ids.size} joueur(s)`);
          const r = await X.searchClub(page * X.CLUB_PAGE);
          if (!r.success) {
            if (!this.fatal(r, 'club')) this.log(`Lecture du club impossible (statut ${r.status})${errText(r.error)}`, 'error');
            break;
          }
          for (const it of r.items) {
            const t = it?.type ?? it?.itemType;
            const d = Number(it?.definitionId ?? it?.resourceId ?? 0);
            if (d > 0 && (!t || t === 'player')) ids.add(d);
          }
          if (r.all) {
            full = true;
            break;
          }
        }
        // Lecture partielle : joueurs vus ajoutés, aucun retiré
        this.clubIds = full ? ids : new Set([...this.clubIds, ...ids]);
        if (full) this.clubAt = Date.now();
        save(K_CLUB, { at: this.clubAt, ids: [...this.clubIds] });
        const got = new Set();
        for (const s of Object.values(this.sets))
          for (const p of Object.values(s.players ?? {}))
            if (this.clubIds.has(p.defId) && !p.collected) {
              p.collected = true;
              got.add(p.defId);
            }
        this.saveSets();
        if (ids.size || full) this.log(`Club ${full ? 'scanné' : 'lu en partie'} : ${ids.size} joueur(s) présent(s)${got.size ? `, ${got.size} carte(s) de set marquée(s) collectée(s)` : ''}`);
        if (!this.stopRequested) {
          this.activity('Galerie EA : joueurs passés au club');
          await this.syncGallery();
        }
        if (this.stopRequested) return false;
        const done = this.setList().filter((s) => !this.toFinish(s).length).length;
        const prop = this.proposedSets();
        const c = X.coins();
        this.log(
          `Sets : ${done} complet(s) sur ${this.setList().length}${c === null ? '' : `, ${prop.length} faisable(s) avec ${fmtNum(c)} crédits (~${fmtNum(prop.reduce((t, x) => t + x.spend, 0))})`}`,
        );
        return true;
      } catch (err) {
        this.log(`Erreur : ${errMsg(err)}`, 'error');
        return false;
      } finally {
        this.leave();
      }
    }

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

    // Statut Galerie lu chez EA (requête /defid) ; maxAgeMs : lecture complète récente réutilisée
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
      for (let i = 0; i < ids.length; i += X.DEFID_CHUNK) {
        const r = await X.requestDefIds(ids.slice(i, i + X.DEFID_CHUNK));
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
            X.netItems.set(defId, { collected: it.isCollected });
            if (it.isCollected) {
              if (!p.collected) got.add(defId);
              p.collected = true;
            } else if (p.collected && !this.clubIds.has(defId)) {
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

    buildSet(data) {
      const list = Array.isArray(data?.players) ? data.players : [];
      const slug = String(data?.slug || data?.name || 'set');
      const key = `futgg:${slug}`;
      const prev = this.sets[key]?.players ?? {};
      const players = {};
      for (const x of list) {
        const defId = validId(x?.defId);
        if (!defId || players[defId]) continue;
        const nc = X.netItems.get(defId)?.collected;
        players[defId] = {
          defId,
          name: String(x.name || defId).slice(0, 60),
          rating: Number(x.rating) || prev[defId]?.rating || 0,
          minPrice: Number(x.price) >= 150 ? Math.round(Number(x.price)) : 0,
          rareflag: this.findPlayer(defId)?.rareflag ?? null,
          collected: nc === true || this.done.has(defId) || (nc === undefined && prev[defId]?.collected === true),
        };
      }
      if (!Object.keys(players).length) return null;
      return { kind: 'futgg', slug, key, name: String(data.name || 'Set fut.gg').slice(0, 60), url: String(data.url || ''), needed: Number(data.needed) || 0, source: 'futgg', at: Date.now(), players };
    }
    importSet(data) {
      const set = this.buildSet(data);
      if (!set) return this.log('Import fut.gg : aucun joueur lu sur la page'), null;
      const again = !!this.sets[set.key];
      this.sets[set.key] = set;
      if (this.hiddenSets.delete(set.key)) save(K_HIDDEN, [...this.hiddenSets]);
      if (!this.saveSets()) this.log('Stockage local plein : set non enregistré (perdu au rechargement)', 'warn');
      const all = Object.values(set.players);
      const priced = all.filter((p) => p.minPrice).length;
      this.log(`Set « ${set.name} » ${again ? 'mis à jour' : 'importé'} : ${all.length} joueur(s), ${all.filter((p) => p.collected).length} déjà collecté(s)${priced < all.length ? `, ${all.length - priced} sans prix (sondage)` : ''}`);
      return set.key;
    }
    requestCatalog(force) {
      if (this.catalog.busy) return;
      this.catalog = { ...this.catalog, busy: true, text: 'démarrage…' };
      window.postMessage({ ns: NS, dir: 'to-ext', catalog: { force } }, window.location.origin);
      this.touch();
      this.emit();
    }
    catalogStatus(patch) {
      this.catalog = { ...this.catalog, ...patch };
      if (patch.at) save(K_CATALOG_AT, patch.at);
      if (!patch.busy) this.touch();
      this.emit();
    }
    importCatalog(list, at, failed = 0) {
      const base = Date.now();
      const keys = [];
      let added = 0;
      let hidden = 0;
      (Array.isArray(list) ? list : []).forEach((data, i) => {
        const set = this.buildSet(data);
        if (!set) return;
        if (this.hiddenSets.has(set.key)) return void hidden++;
        const prev = this.sets[set.key];
        this.sets[set.key] = { ...set, at: prev?.at ?? base - i, syncedAt: prev?.syncedAt };
        if (!prev) added++;
        keys.push(set.key);
      });
      const stored = this.saveSets();
      this.catalogStatus({ busy: false, text: '', at });
      this.log(`Catalogue fut.gg : ${keys.length} set(s) (${added} nouveau(x), ${keys.length - added} mis à jour)${hidden ? `, ${hidden} retiré(s) à la main ignoré(s)` : ''}${failed ? `, ${failed} page(s) sans joueur` : ''}`);
      if (!stored) this.log('Stockage local plein : catalogue non enregistré, perdu au rechargement (retirer des sets puis « Réimporter »)', 'warn');
      return keys;
    }

    // --- Liens avec le sniper ---

    // Carte snipée : comptée pour la Galerie si elle manquait ; true si c'était une carte manquante
    onSnipe(defId) {
      const p = this.findPlayer(defId);
      if (!p || this.refreshCollected(p).collected) return false;
      this.markCollected(defId);
      this.setSelected(defId, false);
      this.log(`${p.name} obtenu par snipe pour la Galerie`, 'buy');
      return true;
    }
    // Vente d'une carte achetée pour la Galerie : décomptée ici (le sniper l'affiche dans les ventes)
    recordSold(i) {
      const b = this.bought[i.id];
      if (!b) return null;
      const n = netOf(i.soldPrice);
      this.addTotal('tax', i.soldPrice - n);
      this.addTotal('lost', b.price - n);
      this.addTotal('received', n);
      this.addTotal('sold', 1);
      delete this.bought[i.id];
      this.saveBought();
      this.touch();
      return { name: b.name || i.name, buy: b.price, profit: n - b.price };
    }
    // Liste de transferts complète lue : cartes absentes (vendues, retirées, déplacées hors extension) plus suivies
    reconcile(items) {
      const byId = new Map(items.map((i) => [String(i.id), i]));
      let gone = 0;
      for (const [id, b] of Object.entries(this.bought)) {
        const i = byId.get(id);
        if (!i) {
          delete this.bought[id];
          gone++;
        } else if (i.state !== 'sold') {
          b.state = i.state;
          if (i.buyNow > 0) b.sell = i.buyNow;
        }
      }
      this.saveBought();
      if (gone) {
        this.touch();
        this.log(`${gone} carte(s) Galerie absente(s) de la liste de transferts : retirée(s) du suivi`);
      }
      return gone;
    }
    // Relecture de la liste de transferts hors tâche (ouverture, bouton Actualiser)
    async refreshPile() {
      const r = await X.readTradePile();
      if (!r.success) return this.log(`Lecture de la liste de transferts impossible (statut ${r.status})${errText(r.error)}`, 'error');
      if (!r.fresh && !r.data.length) return this.log('Liste de transferts non lue par la Web App : ouvre Transferts > Liste de transferts puis « Actualiser »', 'warn');
      this.ctx.onSold(r.data.filter((i) => i.state === 'sold'));
      const rest = r.data.filter((i) => i.state !== 'sold');
      this.reconcile(rest);
      this.pile = { at: Date.now(), active: rest.filter((i) => i.state === 'active').length, unsold: rest.filter((i) => i.state !== 'active').length, sold: r.data.length - rest.length };
      save(K_PILE, this.pile);
      this.touch();
      this.emit();
    }
    onListed(id, price) {
      const b = this.bought[id];
      if (!b) return;
      b.sell = price;
      b.state = 'active';
      this.saveBought();
      this.touch();
    }

    // --- Contrôles communs ---

    stop(msg = 'Arrêt demandé', byUser = false) {
      if (byUser) {
        save(K_ACTIVE, false);
        this.cancelResume();
      }
      if (!this.running) return;
      this.stopRequested = true;
      this.wake?.();
      this.log(msg);
    }
    // Captcha ou limite EA : pause courte commune, reprise automatique de la tâche ensuite
    lockout(msg) {
      const mode = this.mode;
      this.stopRequested = true;
      this.wake?.();
      const ms = this.guard.lockPause();
      if (mode) save(K_LOCK_RESUME, { mode });
      this.log(`${msg} : pause jusqu'à ${X.clockIn(ms)}${mode ? ', reprise automatique ensuite' : ''}. Si EA affiche un captcha, le résoudre dans la Web App.`, 'lock');
      X.notify(`${X.APP} : pause anti-captcha`, `${msg}. Reprise vers ${X.clockIn(ms)}.`);
      if (mode) this.scheduleResume();
    }
    scheduleResume() {
      if (!load(K_LOCK_RESUME, null)) return;
      clearTimeout(this.resumeTimer);
      const left = this.guard.lockRemainingMs();
      const wait = left > 0 ? left + rand(3e4, 9e4) : this.ctx.delay();
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
      if (this.guard.lockRemainingMs() > 0) return this.scheduleResume();
      if (this.running) return void (this.resumeTimer = setTimeout(() => void this.autoResume(), 1e3));
      save(K_LOCK_RESUME, null);
      this.log('Galerie : reprise automatique');
      if (intent.mode === 'buy' && this.queue.some(isOpen)) await this.runQueue();
      else if (intent.mode === 'check') await this.checkPrices(true);
      else if (intent.mode === 'scan') await this.scanClub();
    }
    sessionExpired() {
      const d = rand(6e4, 12e4);
      const mode = this.mode;
      X.reloading = true;
      this.stop(`Session expirée (401) : rechargement de la Web App dans ${Math.round(d / 1e3)} s${mode === 'buy' ? ' puis reprise' : ''}`);
      if (mode === 'buy') save(K_RESUME, Date.now() + d);
      setTimeout(() => location.reload(), d);
    }
    fatal(r, what) {
      if (r.status === 401) return this.sessionExpired(), true;
      if (X.BAD_STATUS.has(r.status)) return this.lockout(`Statut EA ${r.status} (captcha ou limite)`), true;
      if (r.status === 403 && what === 'search') return this.stop(`Recherche refusée (403)${errText(r.error)}`), true;
      return false;
    }
    // Quotas anti-ban communs (recherches ; achats si bid) ; false si arrêt ou pause
    async waitGuard(bidToo = false) {
      while (!this.stopRequested) {
        const g = [this.guard.check(), bidToo ? this.guard.checkBid() : { ok: true }].find((x) => !x.ok);
        if (!g) return true;
        if (g.locked) {
          const mode = this.mode;
          this.stopRequested = true;
          this.log(`${g.reason} : reprise automatique à la fin`);
          if (mode) {
            save(K_LOCK_RESUME, { mode });
            this.scheduleResume();
          }
          return false;
        }
        this.log(g.reason, 'warn');
        await this.sleep(g.waitMs, 'Limite anti-ban, reprise');
      }
      return false;
    }
    async enter(mode) {
      if (this.running) return false;
      this.mode = mode;
      this.stopRequested = false;
      // Sniper suspendu le temps de la tâche, reprise ensuite
      await this.ctx.beforeTask();
      const g = this.guard.check();
      if (g.locked) {
        this.mode = null;
        save(K_LOCK_RESUME, { mode });
        this.scheduleResume();
        this.log(`${g.reason} : démarrage automatique à la fin`);
        this.ctx.afterTask();
        return false;
      }
      this.misses = 0;
      this.listFails = 0;
      this.touch();
      this.emit();
      return true;
    }
    leave() {
      this.mode = null;
      this.activityText = '';
      this.touch();
      this.emit();
      this.ctx.afterTask();
    }
    delay() {
      return this.ctx.delay();
    }
    async sleep(ms, lbl) {
      if (this.stopRequested) return;
      this.waitUntil = Date.now() + ms;
      this.waitLabel = lbl ?? '';
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

    // Annonces de cette carte exacte, triées par prix ; anyCollected : ne pas s'arrêter sur une carte déjà collectée
    async search(defId, { anyCollected = false, ...opts } = {}) {
      if (this.stopRequested || !(await this.waitGuard())) return { stop: true };
      const res = await X.searchCard(defId, { ...opts, minBid: this.nonce++ % 2 ? 150 : 0 });
      this.guard.recordSearch();
      if (!res.success) return this.fatal(res, 'search') ? { stop: true } : { error: res.status || -1 };
      const mine = res.data.filter((x) => x.defId === defId);
      if (!anyCollected && mine.some((x) => x.collected)) return { collected: true };
      return { items: mine.filter((x) => x.buyNow > 0).sort((x, y) => x.buyNow - y.buyNow), full: res.data.length >= X.PAGE_FULL };
    }

    // Prix de référence (FST) : 4e annonce la moins chère parmi celles publiées depuis plus d'une minute
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
    async peek(defId) {
      await this.sleep(this.delay(), 'Relevé du prix actuel');
      const r = await this.search(defId, {});
      return r.items?.[0]?.buyNow ?? null;
    }

    // --- Vérifier les prix : le prix trouvé devient le prix de départ ---

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
        this.log(`Erreur : ${errMsg(err)}`, 'error');
      } finally {
        this.leave();
      }
    }

    // --- Achat direct (FST) : recherche au prix de départ, hausse d'un palier si rien, tolérance en paliers ---

    async validate(defIds) {
      if (this.running) return;
      const tol = tolOf(this.getConfig());
      const only = defIds ? new Set(defIds.map(Number)) : null;
      const queue = this.selectedPlayers()
        .filter(({ p }) => !only || only.has(p.defId))
        .map(({ p, set }) => this.entryOf(p, set.name, tol));
      if (!queue.length) return this.log('Aucun joueur coché');
      this.queue = queue;
      save(K_QUEUE, this.queue);
      this.touch();
      await this.runQueue();
    }
    entryOf(p, set, tol) {
      const v = Number(this.selection[p.defId]);
      const start = v >= 150 ? Math.floor(v) : 0;
      return { defId: p.defId, name: p.name, rating: p.rating, rareflag: p.rareflag ?? null, set, start, max: start, cap: tolCap(start, tol), status: 'pending', searches: 0, price: 0, sell: 0 };
    }
    // Sets cochés : cartes à acheter pour les finir, set par set du moins cher au plus cher
    async completeSets(keys) {
      if (this.running) return;
      const tol = tolOf(this.getConfig());
      const plan = this.planSets(keys);
      const queue = plan.flatMap(({ name, cards }) =>
        cards.map((p) => {
          this.setSelected(p.defId, true);
          return this.entryOf(p, name, tol);
        }),
      );
      if (!queue.length) return this.log('Sets cochés déjà complets : rien à acheter');
      this.log(`Sets à faire (${plan.length}) : ${plan.map((x) => `« ${x.name} » ${x.cards.length} carte(s)`).join(', ')}`);
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
        if (await this.syncGallery(undefined, 5 * 6e4)) {
          for (const e of this.queue)
            if (isOpen(e) && this.findPlayer(e.defId)?.collected) {
              e.status = 'skipped';
              this.feed(`${e.name} : déjà dans la Galerie, ignoré`);
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
            this.log(`Set « ${curSet} » : ${this.queue.filter((x) => x.set === curSet && isOpen(x)).length} joueur(s) à acheter`);
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
          X.notify(`${X.APP} : achats terminés`, `${got.length}/${n} achetés, coût réel ~${fmtNum(cost)} crédits${fail ? `, ${fail} non acheté(s)` : ''}.`, true);
        }
      } catch (err) {
        this.log(`Erreur : ${errMsg(err)}`, 'error');
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
    async affordable(price) {
      const c = X.coins();
      return c === null || c >= price || (await X.refreshCoins()) >= price;
    }
    // Crédits insuffisants : encaisse les ventes toutes les minutes jusqu'à couvrir need ; false si rien n'est en vente
    async waitCredits(need, name) {
      while (!this.stopRequested) {
        const rest = await this.syncPile();
        if (!rest) return false;
        const c = X.coins();
        if (c === null || c >= need) return true;
        const active = rest.filter((i) => i.state === 'active');
        if (!active.length) {
          const unsold = rest.filter((i) => i.state !== 'active').length;
          this.log(`Crédits insuffisants pour ${name} (${fmtNum(c)} / ${fmtNum(need)}) et aucune carte en vente${unsold ? ` (${unsold} invendu(s) : « Relister » dans l'onglet Ventes)` : ''}`, 'warn');
          return false;
        }
        const pending = active.reduce((t, i) => t + netOf(i.buyNow || 0), 0);
        this.log(`Crédits insuffisants pour ${name} (${fmtNum(c)} / ${fmtNum(need)}) : attente des ventes (${active.length} en vente, ~${fmtNum(pending)} nets attendus), nouvel essai dans 1 min`, 'warn');
        await this.sleep(rand(6e4, 8e4), `Attente des ventes pour ${name}`);
      }
      return false;
    }
    async buyOne(e) {
      if (!e.start) {
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
      search: for (let n = 0; n < BUY_SEARCHES; n++) {
        if (this.stopRequested) return;
        if (n) await this.sleep(this.delay(), `Nouvelle recherche pour ${e.name}`);
        if (this.stopRequested) return;
        if (e.max > e.cap) {
          const seen = await this.peek(e.defId);
          if (this.stopRequested) return;
          e.seen = seen;
          return this.giveUp(e, 'moved', `prix au-delà de la tolérance (${fmtNum(e.cap)})${seen ? `, annonce la moins chère ${fmtNum(seen)}` : ''} : modifier le prix pour réessayer`);
        }
        if (!(await this.affordable(150)) && !(await this.waitCredits(150, e.name))) return this.stopRequested ? undefined : this.giveUp(e, 'nocoins', `crédits insuffisants (${fmtNum(X.coins())})`);
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
          if (!(await this.affordable(it.buyNow))) {
            if (await this.waitCredits(it.buyNow, e.name)) {
              n--;
              continue search;
            }
            return this.stopRequested ? undefined : this.giveUp(e, 'nocoins', `crédits insuffisants pour ${fmtNum(it.buyNow)} (${fmtNum(X.coins())} disponibles)`);
          }
          const res = await this.buyAndList(it, e);
          if (res === 'stop' || res === 'ok') return;
          fails++;
          await sleep(rand(900, 1500));
        }
        if (fails >= MAX_COMPETITION) return this.giveUp(e, 'notfound', `${fails} achats ratés (concurrence)`);
        if (fails % 2 === 0) {
          minBuy = e.max;
          e.max = tickUp(e.max);
        }
      }
      if (!this.stopRequested) this.giveUp(e, 'notfound', `non trouvé ≤ ${fmtNum(e.max)} après ${BUY_SEARCHES} recherches`);
    }
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
    markCollected(defId) {
      this.done.add(Number(defId));
      save(K_DONE, [...this.done]);
      for (const s of Object.values(this.sets)) if (s.players?.[defId]) s.players[defId].collected = true;
      this.saveSets();
    }
    async buyAndList(it, e) {
      const cfg = this.getConfig();
      if (!(await this.waitGuard(true))) return 'stop';
      await sleep(rand(300, 900));
      if (this.stopRequested) return 'stop';
      const name = e.name || it.name;
      this.activity(`Achat de ${name} à ${fmtNum(it.buyNow)}…`);
      const r = await X.bid(it);
      this.guard.recordPurchase();
      if (!r.success) {
        if (this.fatal(r, 'bid')) return 'stop';
        this.feed(`Raté ${name} à ${fmtNum(it.buyNow)} (${r.status === 403 ? 'déjà acheté par un autre' : `statut ${r.status}`})`);
        if (++this.misses >= MAX_MISSES) {
          this.lockout(`${this.misses} achats ratés d'affilée`);
          return 'stop';
        }
        return 'miss';
      }
      this.misses = 0;
      const price = it.buyNow;
      e.price = price;
      e.status = 'bought';
      this.markCollected(e.defId);
      this.setSelected(e.defId, false);
      this.addTotal('bought', 1);
      this.addTotal('spent', price);
      this.log(`Acheté ${name} à ${fmtNum(price)}${e.set ? ` (${e.set})` : ''}`);
      await sleep(rand(1200, 1350));
      const keep = async (why) => {
        const m = await X.toClub(it.raw);
        if (m.success) {
          e.status = 'kept';
          this.addTotal('kept', 1);
          this.addTotal('keptSpent', price);
        }
        this.feed(`${name} ${m.success ? 'gardé au club' : 'laissé dans les non-assignés (déplacement au club échoué)'}${why ? ` : ${why}` : ''}`);
      };
      const keepMode = cfg.afterBuy === 'keep';
      if (keepMode || this.pileCount >= X.PILE_MAX || X.pileFull()) {
        await keep(keepMode ? '' : 'liste de transferts pleine');
        return 'ok';
      }
      const l = await X.listClamped(it.raw, sellFor(price, cfg));
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

    // Liste de transferts : ventes encaissées (décompte commun avec le sniper), état des annonces
    async syncPile() {
      this.activity('Lecture de la liste de transferts');
      const pile = await X.readTradePile();
      if (!pile.success) {
        if (!this.fatal(pile, 'pile')) this.log(`Lecture de la liste de transferts impossible (statut ${pile.status})${errText(pile.error)}`, 'error');
        return null;
      }
      for (const i of pile.data) if (!i.raw || /^\d+$/.test(i.name)) i.name = this.bought[i.id]?.name || this.findPlayer(i.defId)?.name || i.name;
      const sold = pile.data.filter((i) => i.state === 'sold');
      this.ctx.onSold(sold);
      if (sold.length) {
        await sleep(rand(500, 1200));
        const c = await X.clearSold();
        if (!c.success) this.log(`Encaissement des ventes échoué (statut ${c.status})${errText(c.error)}`, 'error');
      }
      const rest = pile.data.filter((i) => i.state !== 'sold');
      this.reconcile(rest);
      this.pileCount = rest.length;
      this.pile = { at: Date.now(), active: rest.filter((i) => i.state === 'active').length, unsold: rest.filter((i) => i.state !== 'active').length, sold: sold.length };
      save(K_PILE, this.pile);
      await X.refreshCoins();
      this.touch();
      this.activity('');
      return rest;
    }
  };
})();
