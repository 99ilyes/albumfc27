// Moteur de sniping (SnipeFC27 0.6.2, logique conservée) : sans mode nuit, toujours en fonctionnement continu
// (attend au lieu de s'arrêter, reprend après rechargement), alternance des cibles en option, pause courte après captcha.
(function () {
  const X = globalThis.__fc27;
  const { fmt, rand, randInt, clockIn, load, save, priceDown, profitOf, breakEven, net, errMsg } = X;
  const NS = X.SNIPE_NS;
  const K_RESUME = `${NS}:resume`;
  const K_ON = `${NS}:on`;
  const K_SNIPES = `${NS}:snipes`;
  const K_SESSION = `${NS}:session`;
  const K_BREAK = `${NS}:break`;
  const K_SALES = `${NS}:sales`;
  const K_COUNTED = `${NS}:counted`;
  const FRESH_MS = 31e3;
  const MAX_ERRORS = 3;
  const MISTAKE = 15;
  const RELIST_PRICE_TTL = 36e5;
  const SEARCHLOG = 100;
  const SALES = 50;
  const PRUNE_MS = 6e5;
  const ROTATE = [450, 900];
  const BLOCKED_WAIT = [48e4, 72e4];
  const ERROR_WAIT = [24e4, 36e4];
  const MAX_RETRIES = 5;
  const RECHECK_MS = 9e5;
  const PRICE_FRESH = 3e5;
  // Relecture de la liste de transferts pendant le sniping (cartes en vente) et pendant une attente de vente
  const PILE_EVERY = [12e4, 24e4];
  const SALE_POLL = [6e4, 1e5];
  // Hésitation : 8 % des recherches, +0,5 à 1,5 s
  const HESITATION = [500, 1500];
  const BREAK0 = { preset: '', worked: 0, target: 0, until: 0, stoppedAt: 0, sinceLong: 0, longTarget: 0 };
  const EMPTY_SESSION = { since: 0, searches: 0, otherSearches: 0, snipes: 0, misses: 0, realized: 0, sales: 0, timeMs: 0, activeMs: 0 };

  // Bornes de prix variées dans la fenêtre de 31 s : résultats frais malgré le cache EA
  function rangeVariants(buy) {
    const out = [];
    const maxBids = [null, priceDown(buy)];
    const push = (minBuy, minBid, maxBid) => {
      if ((minBid && maxBid && minBid >= maxBid) || (minBuy && minBuy >= buy)) return;
      out.push({ minBuy, maxBuy: buy, minBid, maxBid });
    };
    for (const a of [null, 200]) for (const b of [null, 150]) for (const c of maxBids) push(a, b, c);
    const top = Math.min(priceDown(buy), Math.floor(buy * 0.1));
    for (let a = 250; a <= top; a = X.nextPrice(a)) for (const c of maxBids) push(a, null, c);
    return out;
  }
  const DURATIONS = [1, 3, 6, 12, 24, 72].map((h) => h * 3600);
  // Annonces publiées depuis plus de 2 min (les toutes fraîches faussent le prix), triées par prix
  const settledListings = (items) => items.filter((i) => !DURATIONS.some((d) => i.expires >= d - 120 && i.expires <= d)).sort((a, b) => a.buyNow - b.buyNow);
  const ageText = (exp) => {
    const d = DURATIONS.find((x) => exp <= x && exp > x - 600);
    return d === undefined ? 'annonce ancienne' : `publiée il y a ${d - exp} s`;
  };
  const label = (i) => `${i.rating ? `${i.rating} ` : ''}${i.name}`;

  class Stop extends Error {}
  // Captcha ou limite EA : pause courte puis reprise
  class LockPause extends Stop {}
  X.Stop = Stop;

  X.Sniper = class {
    running = false;
    task = null; // 'snipe' | 'relist'
    relistProgress = null;
    phase = 'idle';
    activity = '';
    filters = [];
    idx = 0;
    run = { startedAt: 0, searches: 0, snipes: 0, misses: 0, profit: 0 };
    session = { ...EMPTY_SESSION, since: Date.now(), ...load(K_SESSION, {}) };
    sales = load(K_SALES, []);
    counted = load(K_COUNTED, []);
    stats = new X.SnipeStats();
    searchLog = [];
    breakAt = null;
    breakUntil = null;
    brk = { ...BREAK0, ...load(K_BREAK, {}) };
    segStart = 0;
    rotateAt = 0;
    snipes = load(K_SNIPES, {});
    prices = {};
    seen = new Set();
    pileCheck = { at: 0, total: 0 };
    stopRequested = false;
    wake = null;
    reloadTimer = null;
    lastTick = 0;
    tickPhase = 'idle';
    pricedAt = 0;
    tooManyNoted = false;
    albumDone = false;
    nextPileAt = 0;

    // hooks : { onSnipe(defId, raw), isCollected(defId), albumSold(item), albumPrice(id), albumOnSale(), onListed(id, price), otherBusy(), afterTask() }
    constructor(getConfig, onUpdate, patchConfig, hooks) {
      this.getConfig = getConfig;
      this.onUpdate = onUpdate;
      this.patchConfig = patchConfig;
      this.hooks = hooks;
      this.guard = new X.Guard(() => X.limitsOf(this.cfg.limitsPreset));
      if (load(`${NS}:night`, null) !== null) {
        if (load(`${NS}:night`, false) === true) save(K_ON, true);
        try {
          localStorage.removeItem(`${NS}:night`);
        } catch {}
      }
      X.onPile((auctions) => this.recordSales(X.soldFromAuctions(auctions)));
    }
    get cfg() {
      return this.getConfig();
    }
    get filter() {
      return this.filters[this.idx];
    }
    // Sniper voulu actif : reprise après rechargement, après une tâche Galerie ou une pause
    get on() {
      return load(K_ON, false) === true;
    }
    setOn(v) {
      save(K_ON, !!v);
    }

    snapshot() {
      const f = this.running && this.task === 'snipe' ? this.filter : X.parseFilters(this.cfg.snipeFilters)[this.cfg.activeFilter];
      return {
        running: this.running,
        task: this.running ? this.task : null,
        on: this.on,
        rotate: this.cfg.rotate,
        relist: this.relistProgress,
        phase: this.phase,
        activity: this.activity,
        coins: X.coins(),
        filter: f?.label ?? '',
        filterAlbum: !!f?.album,
        buyPrice: f?.buyPrice ?? 0,
        sellPrice: f?.sellPrice ?? 0,
        targets: X.parseFilters(this.cfg.snipeFilters).length,
        run: { ...this.run },
        session: { ...this.session },
        current: this.stats.current ? { ...this.stats.current, targets: undefined } : null,
        pending: this.pending(),
        sales: this.sales.slice(0, 20),
        breakAt: this.breakAt,
        breakUntil: this.breakUntil,
        rotationIn: this.running && this.task === 'snipe' && this.cfg.rotate && this.filters.length > 1 ? Math.max(0, this.rotateAt - this.run.searches) : null,
        lockedUntil: this.guard.lockedUntil(),
        limits: this.guard.limits(),
        searchLog: this.searchLog,
        updatedAt: Date.now(),
      };
    }
    pending() {
      const all = Object.values(this.snipes);
      const listed = all.filter((s) => s.listPrice);
      return { count: all.length, listed: listed.length, invested: all.reduce((t, s) => t + s.price, 0), expected: listed.reduce((t, s) => t + profitOf(s.price, s.listPrice ?? 0), 0) };
    }
    // Snipes en attente de vente regroupés par session d'achat ou par joueur
    pendingBy(keyOf) {
      const out = new Map();
      for (const s of Object.values(this.snipes)) {
        const k = keyOf(s);
        const o = out.get(k) ?? { count: 0, invested: 0, expected: 0 };
        o.count++;
        o.invested += s.price;
        if (s.listPrice) o.expected += profitOf(s.price, s.listPrice);
        out.set(k, o);
      }
      return out;
    }
    emit() {
      if (this.running && this.task === 'snipe') {
        const now = Date.now();
        const d = now - this.lastTick;
        const working = this.tickPhase !== 'break' && this.tickPhase !== 'wait';
        this.session.activeMs += d;
        if (working) this.session.timeMs += d;
        this.stats.tick(d, working);
        this.lastTick = now;
        this.tickPhase = this.phase;
        save(K_SESSION, this.session);
      }
      this.onUpdate();
    }
    note(text, kind = 'info') {
      const type = { snipe: 'buy', sale: 'sell', miss: 'miss', error: 'error', lock: 'lock', info: undefined }[kind];
      X.journal.add(text, type, true);
      this.emit();
    }
    searchNote(text) {
      const t = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      this.searchLog = [`${t} ${text}`, ...this.searchLog].slice(0, SEARCHLOG);
    }
    setActivity(text, phase = this.phase) {
      this.activity = text;
      this.phase = phase;
      this.emit();
    }
    resetSession() {
      this.session = { ...EMPTY_SESSION, since: Date.now() };
      this.sales = [];
      this.stats.reset();
      if (this.running && this.task === 'snipe') this.stats.begin();
      save(K_SESSION, this.session);
      save(K_SALES, this.sales);
      this.emit();
    }
    unlock() {
      this.guard.unlock();
      this.wake?.();
      this.note('Pause anti-captcha levée manuellement');
    }

    async start() {
      if (this.running) return;
      this.setOn(true);
      if (this.hooks.otherBusy()) return this.note('Sniper : démarrage à la fin de la tâche Galerie en cours');
      this.filters = X.parseFilters(this.cfg.snipeFilters);
      if (!this.filters.length) {
        this.setOn(false);
        return this.note('Aucune cible : ajouter un joueur, le filtre de la Web App ou des cartes de la Galerie', 'error');
      }
      this.idx = Math.min(Math.max(0, this.cfg.activeFilter), this.filters.length - 1);
      this.running = true;
      this.task = 'snipe';
      this.stopRequested = false;
      this.seen.clear();
      this.searchLog = [];
      this.run = { startedAt: Date.now(), searches: 0, snipes: 0, misses: 0, profit: 0 };
      this.lastTick = Date.now();
      this.tickPhase = 'idle';
      this.pricedAt = 0;
      this.tooManyNoted = false;
      const resumed = this.stats.current;
      const cur = this.stats.begin();
      if (resumed && resumed !== cur) this.note('Plus de 30 min d’interruption : nouvelle session de suivi');
      this.note(`Sniper : démarrage${this.cfg.rotate ? ', alternance des cibles' : ''}`);
      if (this.cfg.rotate && this.filters.length < 2) this.note('Une seule cible : en ajouter une 2e pour alterner toutes les 450 à 900 recherches');
      let retries = 0;
      let lastErr = 0;
      try {
        for (;;)
          try {
            await this.pauseIfLocked();
            await this.loop();
            break;
          } catch (err) {
            if (err instanceof LockPause) continue;
            if (Date.now() - lastErr > 36e5) retries = 0;
            lastErr = Date.now();
            if (err instanceof Stop || ++retries > MAX_RETRIES) throw err;
            this.pauseClock();
            this.note(`Erreur imprévue (${errMsg(err)}), reprise dans 2 min`, 'error');
            await this.wait(12e4);
          }
      } catch (err) {
        if (!(err instanceof Stop)) {
          this.setOn(false);
          this.note(`Erreur : ${errMsg(err)}`, 'error');
        }
      } finally {
        this.emit();
        this.pauseClock();
        // Arrêt voulu (ou plus de cible) : session close ; suspension Galerie ou rechargement : session continuée
        if (!this.on) this.stats.end();
        this.stats.flush();
        this.brk.stoppedAt = Date.now();
        save(K_BREAK, this.brk);
        this.running = false;
        this.task = null;
        this.phase = 'idle';
        this.activity = '';
        this.breakAt = this.breakUntil = null;
        this.note('Sniper arrêté');
        this.hooks.afterTask();
      }
    }

    // Pause anti-captcha en cours : attente puis reprise (bouton Arrêter toujours actif)
    async pauseIfLocked() {
      const ms = this.guard.lockRemainingMs();
      if (!ms) return;
      this.pauseClock();
      const extra = rand(5e3, 3e4);
      this.setActivity(`Pause anti-captcha, reprise à ${clockIn(ms + extra)}`, 'wait');
      await this.wait(ms + extra);
      this.note('Fin de la pause anti-captcha, reprise');
    }

    async relistTransferList() {
      if (this.running) return;
      if (this.hooks.otherBusy()) return this.note('Relister : attendre la fin de la tâche Galerie en cours', 'error');
      const lock = this.guard.lockRemainingMs();
      if (lock > 0) return this.note(`Pause anti-captcha encore ${X.fmtMin(lock)} : relister plus tard`, 'error');
      this.running = true;
      this.task = 'relist';
      this.stopRequested = false;
      this.run = { startedAt: Date.now(), searches: 0, snipes: 0, misses: 0, profit: 0 };
      this.lastTick = Date.now();
      this.note('Relister la liste de transferts : démarrage');
      let ok = 0;
      let left = 0;
      try {
        this.setActivity('Lecture de la liste de transferts', 'price');
        const pile = await this.syncTradePile();
        if (!pile) return;
        const todo = pile.items.filter((i) => (i.state === 'expired' || i.state === 'unlisted') && i.type === 'player');
        const usable = todo.filter((i) => i.defId && (i.raw || i.id));
        if (!usable.length) {
          const n = (s) => pile.items.filter((i) => i.state === s).length;
          const info = `${pile.items.length} carte(s) lue(s) : ${n('active')} en vente, ${n('expired')} expirée(s), ${n('unlisted')} non listée(s)`;
          return this.note(todo.length ? `Relister impossible, ${todo.length} carte(s) introuvable(s) dans la Web App (${info})` : `Rien à relister (${info})`, todo.length ? 'error' : 'info');
        }
        this.relistProgress = { done: 0, total: usable.length };
        const groups = new Map();
        for (const i of usable) groups.set(i.defId, [...(groups.get(i.defId) ?? []), i]);
        for (const [defId, cards] of groups) {
          const name = this.snipes[cards[0].id]?.label ?? cards[0].name;
          const g = this.guard.check();
          if (!g.ok) {
            this.note(`${g.reason} : relister interrompu`, 'error');
            break;
          }
          const p = await this.priceCheck({ defId, criteria: null }, name);
          if (p) this.prices[defId] = { ...p, at: Date.now() };
          const sell = p ? priceDown(p.lowest) : 0;
          if (!p || (p.minPrice && sell < p.minPrice)) {
            left += cards.length;
            this.relistProgress.done += cards.length;
            this.note(`${name} : ${p ? 'prix sous le minimum EA' : 'prix introuvable'}, laissé tel quel`, 'error');
            continue;
          }
          for (const c of cards) {
            this.checkStop();
            const sn = this.snipes[c.id];
            // Plancher : prix d'achat taxe comprise (snipe), prix payé (achat Galerie)
            const floor = sn ? breakEven(sn.price) : this.hooks.albumPrice(c.id);
            const price = Math.max(sell, floor);
            this.setActivity(`Mise en vente de ${name} à ${fmt(price)}`, 'price');
            const done = c.raw ? await this.list(c.raw, name, price) : await this.listId(c.id, name, price);
            if (done) {
              ok++;
              this.markListed(c.id, price);
              this.hooks.onListed(c.id, price);
              this.note(`${c.state === 'expired' ? 'Remis' : 'Mis'} en vente ${name} à ${fmt(price)}${price > sell ? ' (plancher : prix d’achat)' : ''}`);
            } else left++;
            this.relistProgress.done++;
            await this.wait(rand(400, 900));
          }
        }
      } catch (err) {
        if (!(err instanceof Stop)) this.note(`Erreur : ${errMsg(err)}`, 'error');
      } finally {
        this.emit();
        this.running = false;
        this.task = null;
        this.relistProgress = null;
        this.phase = 'idle';
        this.activity = '';
        this.note(`Relister terminé : ${ok} carte(s) mise(s) en vente${left ? `, ${left} laissée(s) telle(s) quelle(s)` : ''}`, 'list');
        this.hooks.afterTask();
      }
    }

    // byUser : le sniper ne reprend plus seul ; sinon (tâche Galerie) il reprend ensuite
    stop(msg = 'Arrêt demandé', byUser = true) {
      if (byUser) {
        this.setOn(false);
        if (this.reloadTimer) {
          clearTimeout(this.reloadTimer);
          this.reloadTimer = null;
          localStorage.removeItem(K_RESUME);
          this.note('Rechargement et reprise annulés');
        }
      }
      if (!this.running) {
        if (byUser) this.stats.end();
        return this.emit();
      }
      this.stopRequested = true;
      this.wake?.();
      this.note(msg);
    }
    // Arrêt le temps d'une tâche Galerie (achat en vol terminé avant)
    async suspend(why) {
      if (!this.running) return;
      this.stop(why, false);
      for (let i = 0; i < 600 && this.running; i++) await X.sleep(100);
    }
    checkStop() {
      if (this.stopRequested) throw new Stop();
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
    lockout(reason) {
      const ms = this.guard.lockPause();
      this.note(`${reason} : pause jusqu'à ${clockIn(ms)} puis reprise automatique. Si EA affiche un captcha, le résoudre dans la Web App.`, 'lock');
      X.notify(`${X.APP} : pause anti-captcha`, `${reason}. Reprise vers ${clockIn(ms)}.`);
      throw new LockPause();
    }
    sessionExpired() {
      const d = rand(6e4, 12e4);
      this.stopRequested = true;
      X.reloading = true;
      this.note(`Session expirée (401) : rechargement dans ${Math.round(d / 1e3)} s puis reprise`, 'error');
      save(K_RESUME, { at: Date.now() + d });
      this.reloadTimer = setTimeout(() => location.reload(), d);
      throw new Stop();
    }
    async blocked(reason, range = BLOCKED_WAIT) {
      const ms = rand(...range);
      this.note(`${reason} : nouvel essai à ${clockIn(ms)}`, 'error');
      this.setActivity(`${reason}, reprise à ${clockIn(ms)}`, 'wait');
      await this.idle(ms);
      await this.upkeep();
    }
    // Cartes en vente suivies (snipes ou achats Galerie) : la liste de transferts mérite d'être relue
    hasListings() {
      return Object.values(this.snipes).some((s) => s.listPrice) || this.hooks.albumOnSale() > 0;
    }
    // Liste pleine ou crédits insuffisants : ventes relues toutes les 1 à 2 min, reprise dès que ok() ;
    // entretien complet (invendus remis en vente, non-assignés rangés) au début puis toutes les 8 à 12 min
    async waitForSales(reason, ok) {
      this.note(`${reason} : attente des ventes, liste de transferts relue toutes les 1 à 2 min`, 'error');
      let upkeepAt = 0;
      for (;;) {
        if (Date.now() >= upkeepAt) {
          this.setActivity(`${reason} : entretien de la liste de transferts`, 'wait');
          await this.upkeep();
          upkeepAt = Date.now() + rand(...BLOCKED_WAIT);
        } else await this.syncTradePile();
        if (await ok()) return this.note(`${reason.split(' (')[0]} : levé, reprise`);
        const ms = rand(...SALE_POLL);
        this.setActivity(`${reason}, ventes relues à ${clockIn(ms)}`, 'wait');
        await this.idle(ms);
      }
    }
    async idle(ms) {
      const counting = !!this.segStart;
      if (counting) this.pauseClock();
      await this.wait(ms);
      if (counting) this.resumeClock();
    }
    delayPreset() {
      return X.DELAY_PRESETS[this.cfg.delayPreset] ?? X.DELAY_PRESETS.safe;
    }
    searchDelay() {
      const p = this.delayPreset();
      const hesitation = p !== X.DELAY_PRESETS.dangerous && Math.random() < 0.08;
      return { ms: rand(p.min, p.max) + (hesitation ? rand(...HESITATION) : 0), hesitation };
    }
    breakKey() {
      return X.BREAK_PRESETS[this.cfg.breakPreset] ? this.cfg.breakPreset : 'safe';
    }
    newBreakTarget(key, resetLong = false) {
      const { every, longEvery } = X.BREAK_PRESETS[key];
      const keep = !resetLong && this.brk.preset === key && this.brk.longTarget > 0;
      this.brk = {
        preset: key,
        worked: 0,
        target: every ? rand(every[0], every[1]) * 1e3 : 0,
        until: 0,
        stoppedAt: 0,
        sinceLong: keep ? this.brk.sinceLong : 0,
        longTarget: keep ? this.brk.longTarget : longEvery ? rand(longEvery[0], longEvery[1]) * 1e3 : 0,
      };
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
    // Pause interrompue par un arrêt ou un rechargement : terminée, ou nouvelle cible de pause selon le temps écoulé
    async restoreBreakClock(key) {
      const { rest, longRest } = X.BREAK_PRESETS[key];
      const now = Date.now();
      const off = this.brk.stoppedAt ? now - this.brk.stoppedAt : 0;
      if (this.brk.until > now && rest) {
        this.breakUntil = this.brk.until;
        this.note(`Pause en cours jusqu'à ${clockIn(this.brk.until - now)}`);
        this.setActivity(`Pause jusqu'à ${clockIn(this.brk.until - now)}`, 'break');
        await this.wait(this.brk.until - now);
        this.breakUntil = null;
        this.newBreakTarget(key);
      } else if (this.brk.preset !== key || (!this.brk.target && rest) || this.brk.until) this.newBreakTarget(key, this.brk.preset !== key);
      else if (longRest && off >= longRest[0] * 1e3) this.newBreakTarget(key, true);
      else if (rest && off >= rest[0] * 1e3) this.newBreakTarget(key);
      this.brk.until = 0;
      this.brk.stoppedAt = 0;
      this.resumeClock();
    }

    async loop() {
      if (!(await this.prepareFilter())) return;
      let key = this.breakKey();
      await this.restoreBreakClock(key);
      this.rotateAt = this.run.searches + randInt(...ROTATE);
      let win = { n: 0, start: Date.now() };
      let sinceCheck = 0;
      let errors = 0;
      for (;;) {
        this.checkStop();
        const cfg = this.cfg;
        if (key !== this.breakKey()) {
          key = this.breakKey();
          this.pauseClock();
          const worked = this.brk.worked;
          this.newBreakTarget(key);
          this.brk.worked = worked;
          this.resumeClock();
        }
        const { rest, longRest } = X.BREAK_PRESETS[key];
        if (this.breakAt && rest && Date.now() >= this.breakAt) {
          this.pauseClock();
          this.brk.sinceLong += this.brk.worked;
          const long = !!longRest && this.brk.longTarget > 0 && this.brk.sinceLong >= this.brk.longTarget;
          const r = long && longRest ? longRest : rest;
          const ms = rand(r[0], r[1]) * 1e3;
          this.breakUntil = this.brk.until = Date.now() + ms;
          save(K_BREAK, this.brk);
          const what = long ? 'Pause longue' : 'Pause';
          this.note(`${what} jusqu'à ${clockIn(ms)}`);
          this.setActivity(`${what} jusqu'à ${clockIn(ms)}`, 'break');
          await this.upkeep();
          this.setActivity(`${what} jusqu'à ${clockIn(this.brk.until - Date.now())}`, 'break');
          await this.wait(Math.max(0, this.brk.until - Date.now()));
          this.breakUntil = null;
          this.newBreakTarget(key, long);
          this.resumeClock();
          win = { n: 0, start: Date.now() };
        }
        // Cible Galerie achetée : retirée, cible suivante
        if (this.albumDone) {
          this.albumDone = false;
          if (!this.dropFilter(this.idx, 'carte obtenue pour la Galerie')) return;
          if (!(await this.prepareFilter())) return;
          this.rotateAt = this.run.searches + randInt(...ROTATE);
          sinceCheck = 0;
          win = { n: 0, start: Date.now() };
        }
        if (cfg.rotate && this.filters.length > 1 && this.run.searches >= this.rotateAt) {
          this.idx = (this.idx + 1) % this.filters.length;
          this.saveFilters();
          this.note(`Changement de cible : ${this.filter.label}`);
          if (!(await this.prepareFilter())) return;
          this.rotateAt = this.run.searches + randInt(...ROTATE);
          sinceCheck = 0;
          win = { n: 0, start: Date.now() };
        }
        const f = this.filter;
        if (Date.now() >= this.nextPileAt && this.hasListings()) {
          this.setActivity('Lecture des ventes', 'price');
          await this.syncTradePile();
        }
        if (await this.transferListFull()) {
          await this.waitForSales('Liste de transferts pleine', async () => !(await this.transferListFull()));
          win = { n: 0, start: Date.now() };
          continue;
        }
        const c0 = X.coins();
        if (c0 !== null && c0 < f.buyPrice) {
          await this.waitForSales(`Crédits insuffisants (${fmt(c0)} < ${fmt(f.buyPrice)})`, async () => (X.coins() ?? Infinity) >= this.filter.buyPrice);
          win = { n: 0, start: Date.now() };
          continue;
        }
        const g = [this.guard.check(), this.guard.checkBid()].find((x) => !x.ok);
        if (g) {
          if (g.locked) throw new LockPause();
          this.note(`${g.reason}, reprise à ${clockIn(g.waitMs)}`, 'error');
          this.setActivity(`Limite anti-ban, reprise à ${clockIn(g.waitMs)}`, 'wait');
          await this.idle(g.waitMs);
          continue;
        }
        if (Date.now() - win.start > FRESH_MS) win = { n: 0, start: Date.now() };
        const range = rangeVariants(f.buyPrice)[win.n];
        if (!range) {
          const ms = win.start + FRESH_MS + 1e3 - Date.now();
          this.setActivity(`Attente de résultats frais (${Math.ceil(ms / 1e3)} s)`, 'wait');
          await this.wait(Math.max(0, ms));
          win = { n: 0, start: Date.now() };
          continue;
        }
        const budget = this.buyBudget();
        let wallet = X.coins() ?? Infinity;
        this.setActivity(`Recherche ${f.label} ≤ ${fmt(f.buyPrice)}`, 'search');
        const res = await X.searchFilter(f, range);
        const items = res.success ? [...res.data].sort((a, b) => a.buyNow - b.buyNow || b.rating - a.rating) : [];
        const tooMany = cfg.mistakePrevention && items.length > MISTAKE;
        const cheap = tooMany ? [] : items.filter((i) => i.buyNow > 0 && i.buyNow <= f.buyPrice && !this.seen.has(i.tradeId));
        const buys = [];
        for (const i of cheap) {
          if (buys.length >= budget) break;
          if (i.buyNow > wallet) continue;
          wallet -= i.buyNow;
          buys.push(i);
        }
        const t0 = performance.now();
        const bids = buys.map((i) => X.bid(i).then((r) => ({ res: r, ms: Math.round(performance.now() - t0) })));
        for (const i of buys) this.seen.add(i.tradeId), this.guard.recordPurchase();
        this.guard.recordSearch();
        this.run.searches++;
        this.session.searches++;
        this.stats.search(f);
        win.n++;
        sinceCheck++;
        if (res.success) {
          errors = 0;
          this.searchNote(
            `#${this.run.searches} ≤ ${fmt(f.buyPrice)} : ${items.length ? `${items.length} résultat(s), dès ${fmt(items[0].buyNow)}` : 'rien'}${tooMany ? ' (plus de 15 : pas d’achat)' : buys.length > 1 ? ` → ${buys.length} achats` : buys.length ? ' → achat' : ''}`,
          );
          if (tooMany && !this.tooManyNoted) {
            this.tooManyNoted = true;
            this.note(`${items.length} résultats : pas d'achat (prévention des erreurs, prix d'achat trop haut ?)${f.auto ? ', revérification des prix' : ''}`);
          }
          if (tooMany && f.auto) sinceCheck = Infinity;
          const got = buys.length ? await this.settleBids(buys, bids) : [];
          const checked = new Set();
          let repriced = false;
          for (const i of got) if (await this.afterSnipe(i, cheap.length === 1, checked)) repriced = true;
          if (repriced) sinceCheck = 0;
          else if (f.auto && cheap.length >= 3) sinceCheck = Infinity;
        } else {
          if (res.status === 401) this.sessionExpired();
          if (X.BAD_STATUS.has(res.status)) this.lockout(`Statut EA ${res.status} (captcha ou limite)`);
          errors++;
          this.searchNote(`#${this.run.searches} erreur ${res.status}`);
          this.note(`Erreur de recherche (statut ${res.status}), encore ${Math.max(0, MAX_ERRORS - errors)} essai(s)`, 'error');
          if (errors >= MAX_ERRORS) {
            errors = 0;
            await this.blocked(`${MAX_ERRORS} erreurs de recherche d'affilée`, ERROR_WAIT);
            continue;
          }
        }
        const old = Date.now() - this.pricedAt > RECHECK_MS;
        if (f.auto && (sinceCheck === Infinity || (cfg.recheckEvery > 0 && sinceCheck >= cfg.recheckEvery) || old)) {
          this.note(sinceCheck === Infinity ? 'Revérification des prix' : old ? 'Revérification des prix (plus de 15 min)' : `Revérification des prix après ${cfg.recheckEvery} recherches`);
          sinceCheck = 0;
          if (await this.priceFilter(f)) this.tooManyNoted = false;
          else {
            this.pricedAt = Date.now();
            this.note('Revérification échouée : prix actuels conservés', 'error');
          }
          win = { n: 0, start: Date.now() };
        }
        const { ms, hesitation } = this.searchDelay();
        this.setActivity(`Prochaine recherche dans ${(ms / 1e3).toFixed(1).replace('.', ',')} s${hesitation ? ' (hésitation)' : ''}`, 'search');
        await this.wait(ms);
      }
    }
    buyBudget() {
      const l = this.guard.limits();
      const bids = Math.min(l.max.bidsHour - l.bidsHour, l.max.bidsDay - l.bidsDay);
      const room = X.PILE_MAX - (X.transferCount() ?? this.pileCheck.total);
      const max = Math.min(5, Math.max(1, Math.floor(this.cfg.maxBuysPerSearch)));
      return Math.max(1, Math.min(max, bids, room));
    }
    saveFilters() {
      this.patchConfig({ snipeFilters: JSON.stringify(this.filters), activeFilter: this.idx });
    }
    // Retire la cible n ; false s'il n'en reste aucune
    dropFilter(n, why) {
      const [f] = this.filters.splice(n, 1);
      if (f) this.note(`Cible retirée : ${f.label} (${why})`);
      if (this.idx >= this.filters.length) this.idx = 0;
      this.saveFilters();
      if (this.filters.length) return true;
      this.setOn(false);
      this.note('Plus aucune cible : sniper arrêté');
      return false;
    }
    // Cible utilisable (prix calculés) ; sinon cible suivante, puis attente si aucune
    async prepareFilter() {
      for (;;) {
        for (let n = 0; n < this.filters.length; n++) {
          const f = this.filter;
          if (f.album && f.defId && this.hooks.isCollected(f.defId)) {
            if (!this.dropFilter(this.idx, 'déjà dans la Galerie')) return false;
            n--;
            continue;
          }
          this.emit();
          const bad = this.checkFilter(f);
          if (!bad && (!f.auto || (await this.priceFilter(f)))) return (this.tooManyNoted = false), true;
          this.note(`${bad ?? `${f.label} : pas de prix rentable trouvé`}, cible suivante`, 'error');
          this.idx = (this.idx + 1) % this.filters.length;
        }
        if (!this.filters.length) return false;
        await this.blocked('Aucune cible utilisable');
      }
    }
    checkFilter(f) {
      if (f.auto) return null;
      if (!(f.buyPrice > 150)) return `${f.label} : prix d'achat à renseigner (plus de 150)`;
      if (this.cfg.sellAfterSnipe && !f.sellPrice) return `${f.label} : prix de vente à renseigner`;
      if (this.cfg.sellAfterSnipe && profitOf(f.buyPrice, f.sellPrice) <= 0) return `${f.label} : aucun profit au prix de vente choisi`;
      return null;
    }
    // Moins chère du marché (annonces publiées depuis plus de 2 min), par descente du prix max
    async priceCheck(filter, name) {
      let maxBuy = null;
      let lowest = null;
      let minPrice = null;
      this.setActivity(`Vérification du prix de ${name}`, 'price');
      for (let n = 0; n < 15; n++) {
        await this.wait(this.priceDelay());
        if (!(await this.guardOk())) return null;
        const r = await this.search(filter, { minBuy: null, maxBuy, minBid: null, maxBid: null });
        if (!r.success) return this.note(`Vérification du prix de ${name} : erreur (statut ${r.status})`, 'error'), null;
        const list = settledListings(r.data);
        if (!list.length) {
          if (lowest === null) {
            if (!r.data.length) await this.softBanCheck();
            this.note(`${name} : aucune annonce${r.data.length ? ' hors annonces tout juste publiées' : ''}, carte peut-être introuvable (passer en prix fixés)`, 'error');
            return null;
          }
          break;
        }
        lowest = list[0].buyNow;
        minPrice = list[0].minPrice ?? minPrice;
        if (lowest <= 200) break;
        maxBuy = priceDown(lowest);
      }
      if (lowest === null) return null;
      this.note(`${name} : vente immédiate ${fmt(priceDown(lowest))}, moins chère du marché ${fmt(lowest)}`);
      return { lowest, minPrice };
    }
    priceDelay() {
      const p = this.delayPreset();
      return rand(Math.max(1e3, p.min - 1e3), Math.max(3e3, p.max - 1e3));
    }
    async guardOk() {
      for (;;) {
        const g = this.guard.check();
        if (g.ok) return true;
        if (g.locked) throw new LockPause();
        this.setActivity(`Limite anti-ban, reprise à ${clockIn(g.waitMs)}`, 'wait');
        await this.idle(g.waitMs);
      }
    }
    async search(filter, range) {
      const r = await X.searchFilter(filter, range);
      this.guard.recordSearch();
      this.session.otherSearches++;
      if (!r.success) {
        if (r.status === 401) this.sessionExpired();
        if (X.BAD_STATUS.has(r.status)) this.lockout(`Statut EA ${r.status} (captcha ou limite)`);
      }
      return r;
    }
    async softBanCheck() {
      await this.wait(this.priceDelay());
      const r = await this.search({ defId: null, criteria: null }, { minBuy: null, maxBuy: null, minBid: null, maxBid: null });
      if (r.success && !r.data.length) this.lockout('Aucune annonce même sans filtre : marché restreint par EA (soft ban probable)');
    }
    computePrices(lowest, minPrice) {
      return X.computePrices({ lowestOnMarket: lowest, minPrice, minProfit: this.cfg.minProfit });
    }
    async priceFilter(f) {
      const p = await this.priceCheck(f, f.label);
      if (!p) return false;
      if (f.defId) this.prices[f.defId] = { ...p, at: Date.now() };
      return this.applyPrices(f, p.lowest, p.minPrice);
    }
    applyPrices(f, lowest, minPrice) {
      this.pricedAt = Date.now();
      const r = this.computePrices(lowest, minPrice);
      if (r.status !== 'ok') {
        this.note(r.status === 'belowListable' ? `${f.label} : prix sous le minimum EA` : `${f.label} : aucun prix d'achat rentable`, 'error');
        return false;
      }
      f.buyPrice = r.buyPrice;
      f.sellPrice = r.sellPrice;
      this.saveFilters();
      const how = this.cfg.minProfit > 0 ? 'profit min choisi' : '2 % du prix, 150 minimum';
      this.note(`Achat jusqu'à ${fmt(r.buyPrice)}, vente ${fmt(r.sellPrice)} (${how} : ${fmt(r.targetProfit)}${r.profit < r.targetProfit ? `, profit réduit à ${fmt(r.profit)}` : ''})`);
      return true;
    }
    async settleBids(items, bids) {
      this.setActivity(items.length > 1 ? `Achat de ${items.length} cartes…` : `Achat de ${label(items[0])} à ${fmt(items[0].buyNow)}…`);
      const results = await Promise.all(bids);
      const won = [];
      let fatal = null;
      results.forEach(({ res, ms }, n) => {
        const it = items[n];
        const name = label(it);
        if (res.success) {
          this.run.snipes++;
          this.session.snipes++;
          const id = Number(it.raw?.id);
          const defId = it.defId || this.filter.defId || 0;
          const sid = this.stats.snipe(defId, name, it.buyNow);
          if (id) {
            this.snipes[id] = { defId, label: name, price: it.buyNow, at: Date.now(), sid };
            save(K_SNIPES, this.snipes);
          }
          this.note(`Snipé ${name} à ${fmt(it.buyNow)} ! (${ageText(it.expires)}, réponse en ${ms} ms)`, 'snipe');
          if (this.cfg.snipeSound) X.beep();
          if (defId && this.hooks.onSnipe(defId, it.raw) && this.filter.album && this.filter.defId === defId) this.albumDone = true;
          won.push(it);
        } else if (res.status === 401 || X.BAD_STATUS.has(res.status)) fatal ??= res.status;
        else if (X.MISS_STATUS.has(res.status)) {
          this.run.misses++;
          this.session.misses++;
          this.stats.miss(it.defId || this.filter.defId || 0, name);
          this.note(`Raté de peu : ${name} à ${fmt(it.buyNow)} (${ageText(it.expires)}, réponse en ${ms} ms)`, 'miss');
        } else {
          this.seen.delete(it.tradeId);
          if (res.status === 470) this.note(`Crédits insuffisants pour ${name} à ${fmt(it.buyNow)}`, 'error');
          else if (res.status === -2) this.note(`Achat de ${name} sans réponse : vérifier les non-assignés`, 'error');
          else this.note(`Erreur ${res.status} à l'achat de ${name}`, 'error');
        }
      });
      if (fatal === 401) this.sessionExpired();
      if (fatal !== null) this.lockout(`Statut EA ${fatal} (captcha ou limite)`);
      return won;
    }
    // Après un snipe : revente au prix calculé (prix revérifié si la carte diffère de la cible ou si le prix date)
    async afterSnipe(it, single, checked) {
      const f = this.filter;
      const name = label(it);
      const defId = it.defId || f.defId || 0;
      if (!this.cfg.sellAfterSnipe) return await this.moveTransfer(it.raw, name), false;
      let sell = f.sellPrice;
      let repriced = false;
      if (f.auto) {
        const known = defId ? this.prices[defId] : undefined;
        let p = known && (checked.has(defId) || (single && Date.now() - known.at < PRICE_FRESH)) ? known : null;
        if (!p && defId) {
          p = await this.priceCheck({ defId, criteria: null }, name);
          checked.add(defId);
          if (p) this.prices[defId] = { ...p, at: Date.now() };
          if (p && f.defId === defId) repriced = this.applyPrices(f, p.lowest, p.minPrice);
        }
        const r = p ? this.computePrices(p.lowest, p.minPrice) : null;
        sell = r && r.status !== 'belowListable' ? r.sellPrice : 0;
      }
      if (profitOf(it.buyNow, sell) <= 0) return await this.moveTransfer(it.raw, name, sell ? `${fmt(sell)} ne ferait pas de profit` : 'prix de vente introuvable'), repriced;
      if (!(await this.moveTransfer(it.raw, name))) return repriced;
      if (await this.list(it.raw, name, sell)) {
        const gain = profitOf(it.buyNow, sell);
        this.run.profit += gain;
        this.markListed(Number(it.raw?.id), sell);
        this.note(`Mis en vente ${name} à ${fmt(sell)} (profit attendu ${fmt(gain)})`);
      }
      return repriced;
    }
    async moveTransfer(raw, name, why = '') {
      const r = await X.toTransfer(raw);
      if (r.success) {
        if (why) this.note(`${name} gardé en liste de transferts (${why})`);
      } else this.note(`${name} laissé dans les non-assignés (statut ${r.status})`, 'error');
      return r.success;
    }
    async list(raw, name, price) {
      const r = await X.listAt(raw, price);
      if (r.success) return true;
      if (X.BAD_STATUS.has(r.status)) this.lockout(`Statut EA ${r.status} (captcha ou limite)`);
      this.note(`Mise en vente de ${name} échouée (statut ${r.status}${r.status === 461 ? ', prix hors fourchette EA' : ''})`, 'error');
      return false;
    }
    // Carte que la Web App n'a pas chargée : même requête que la Web App, par identifiant
    async listId(id, name, price) {
      const r = await X.listById(id, price);
      if (r.success) return true;
      if (X.BAD_STATUS.has(r.status)) this.lockout(`Statut EA ${r.status} (captcha ou limite)`);
      this.note(`Mise en vente de ${name} échouée (statut ${r.status})${X.errText(r.error)}`, 'error');
      return false;
    }
    async syncTradePile() {
      const r = await X.readTradePile();
      if (!r.success) return this.note(`Lecture de la liste de transferts impossible (statut ${r.status})`, 'error'), null;
      const sold = r.data.filter((i) => i.state === 'sold');
      this.recordSales(sold);
      let total = r.data.length;
      if (sold.length && (await X.clearSold()).success) total -= sold.length;
      await X.refreshCoins();
      this.pileCheck = { at: Date.now(), total };
      this.nextPileAt = Date.now() + rand(...PILE_EVERY);
      this.emit();
      return { items: r.data.filter((i) => i.state !== 'sold'), total, complete: r.complete };
    }
    // Ventes : profit des snipes ; les cartes achetées pour la Galerie sont décomptées côté Galerie
    recordSales(items) {
      const fresh = items.filter((i) => !this.counted.includes(i.tradeId || -i.id));
      if (!fresh.length) return;
      for (const i of fresh) {
        const sn = this.snipes[i.id];
        let profit = sn ? net(i.soldPrice) - sn.price : null;
        let buy = sn?.price ?? null;
        let name = sn?.label ?? i.name;
        const held = sn?.at ? Date.now() - sn.at : null;
        if (sn) {
          this.stats.sale(sn, i.soldPrice);
          this.session.realized += profit;
          this.session.sales++;
          delete this.snipes[i.id];
        } else {
          const a = this.hooks.albumSold(i);
          if (a) ({ name, buy, profit } = a);
        }
        this.counted.push(i.tradeId || -i.id);
        this.sales = [{ at: Date.now(), label: name, price: i.soldPrice, buy, profit, album: !sn && buy !== null, held }, ...this.sales].slice(0, SALES);
        this.note(`Vendu ${name} à ${fmt(i.soldPrice)}${profit === null ? '' : ` (${profit >= 0 ? 'profit' : 'perte'} ${fmt(Math.abs(profit))})`}`, 'sale');
      }
      this.counted = this.counted.slice(-500);
      save(K_COUNTED, this.counted);
      save(K_SALES, this.sales);
      save(K_SNIPES, this.snipes);
      save(K_SESSION, this.session);
    }
    markListed(id, price) {
      const s = this.snipes[id];
      if (s) {
        s.listPrice = price;
        save(K_SNIPES, this.snipes);
      }
    }
    pruneSnipes(present) {
      const now = Date.now();
      const gone = Object.keys(this.snipes).filter((id) => !present.has(Number(id)) && now - this.snipes[id].at > PRUNE_MS);
      if (!gone.length) return;
      for (const id of gone) delete this.snipes[id];
      save(K_SNIPES, this.snipes);
      this.note(`${gone.length} carte(s) snipée(s) absente(s) de la liste de transferts et des non-assignés : retirée(s) du suivi des ventes`);
    }
    async transferListFull() {
      let n = X.transferCount();
      if (n === null || n >= X.PILE_MAX) n = Date.now() - this.pileCheck.at < 12e4 ? this.pileCheck.total : ((await this.syncTradePile())?.total ?? n);
      return (n ?? 0) >= X.PILE_MAX;
    }
    // Pendant les pauses : ventes encaissées, non-assignés rangés, snipes invendus remis en vente
    async upkeep() {
      const pile = await this.syncTradePile();
      if (!pile) return;
      let room = X.PILE_MAX - pile.total;
      const un = room > 0 ? await X.requestUnassigned() : null;
      const loose = un?.success ? un.data : [];
      if (pile.complete && un?.success) this.pruneSnipes(new Set([...pile.items.map((i) => i.id), ...loose.map((i) => Number(i.id))]));
      for (const raw of loose) {
        if (room <= 0 || !(await X.toTransfer(raw)).success) break;
        room--;
        const sn = this.snipes[Number(raw.id)];
        this.note(`Non-assigné rangé en liste de transferts${sn ? ` : ${sn.label}` : ''}`);
        if (sn && this.cfg.sellAfterSnipe) await this.relist(raw, Number(raw.id), false);
      }
      if (!this.cfg.sellAfterSnipe) return;
      const unsold = pile.items.filter((i) => this.snipes[i.id] && i.raw && (i.state === 'expired' || i.state === 'unlisted'));
      for (const i of unsold.slice(0, 10)) {
        this.checkStop();
        await this.relist(i.raw, i.id, i.state === 'expired');
      }
    }
    async relist(raw, id, expired) {
      const sn = this.snipes[id];
      if (!sn) return;
      let p = this.prices[sn.defId];
      if (!p || Date.now() - p.at > RELIST_PRICE_TTL) {
        const c = sn.defId ? await this.priceCheck({ defId: sn.defId, criteria: null }, sn.label) : null;
        if (c) p = this.prices[sn.defId] = { ...c, at: Date.now() };
      }
      if (!p) return;
      const price = Math.max(priceDown(p.lowest), breakEven(sn.price));
      if (await this.list(raw, sn.label, price)) {
        this.markListed(id, price);
        this.note(`${expired ? 'Remis' : 'Mis'} en vente ${sn.label} à ${fmt(price)}`);
      }
    }
  };
  X.SNIPE_RESUME_KEY = K_RESUME;
})();
