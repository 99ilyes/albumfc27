// Démarrage et coordination : une seule tâche EA à la fois. Une tâche Galerie suspend le sniper, qui reprend ensuite.
(function () {
  const X = globalThis.__fc27;
  const { load, save, rand } = X;
  const NS = X.ALBUM_NS;

  X.installNetHooks();

  // Écoute posée dès le chargement : l'import fut.gg peut arriver avant que la Web App soit prête
  let onCommand = null;
  const pendingCmds = [];
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.ns !== NS || e.data.dir !== 'to-page' || !e.data.cmd) return;
    onCommand ? onCommand(e.data.cmd) : pendingCmds.push(e.data.cmd);
  });

  function init() {
    let ui = null;
    let statsTimer = null;
    let resumeTimer = null;
    const postStats = () => {
      statsTimer ??= setTimeout(() => {
        statsTimer = null;
        const s = sniper.snapshot();
        delete s.searchLog;
        window.postMessage({ ns: NS, dir: 'to-ext', stats: { sniper: s, album: album.snapshot(), status: ui?.statusText() ?? '', market: X.marketNow(), at: Date.now() } }, window.location.origin);
      }, 500);
    };
    const onUpdate = () => {
      ui?.update();
      postStats();
    };

    const app = {
      cfg: X.loadConfig(),
      setConfig(patch) {
        this.cfg = { ...this.cfg, ...patch };
        X.saveConfig(this.cfg);
        onUpdate();
      },
      // Cibles : copie du sniper pendant qu'il tourne, sinon celles des réglages
      targets() {
        return sniper.running && sniper.task === 'snipe' ? sniper.filters : X.parseFilters(this.cfg.snipeFilters);
      },
      editTargets(fn) {
        const live = sniper.running && sniper.task === 'snipe';
        const list = live ? sniper.filters : X.parseFilters(this.cfg.snipeFilters);
        let active = live ? sniper.idx : this.cfg.activeFilter;
        active = fn(list, active) ?? active;
        active = Math.max(0, Math.min(active, list.length - 1));
        if (live) {
          sniper.idx = active;
          sniper.saveFilters();
        } else this.setConfig({ snipeFilters: JSON.stringify(list), activeFilter: active });
      },
      newTarget: (t) => ({ ...t, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, auto: true, buyPrice: 0, sellPrice: 0 }),
      addTarget(t) {
        this.editTargets((list, active) => {
          const n = list.findIndex((f) => f.label === t.label);
          if (n >= 0) return sniper.running ? active : n;
          list.push(this.newTarget(t));
          return sniper.running ? active : list.length - 1;
        });
      },
      removeTarget(id) {
        this.editTargets((list, active) => {
          const n = list.findIndex((f) => f.id === id);
          if (n < 0 || (sniper.running && sniper.task === 'snipe' && n === active)) return active;
          list.splice(n, 1);
          return n < active ? active - 1 : active;
        });
      },
      setActiveTarget(n) {
        if (!sniper.running) this.setConfig({ activeFilter: n });
      },
      patchTarget(id, patch) {
        if (sniper.running && sniper.task === 'snipe') return;
        this.editTargets((list) => {
          const f = list.find((x) => x.id === id);
          if (f) Object.assign(f, patch);
        });
      },
      // Cartes manquantes de la Galerie ajoutées aux cibles du sniper ; renvoie le nombre ajouté
      addAlbumTargets(defIds) {
        let added = 0;
        this.editTargets((list) => {
          const have = new Set(list.filter((f) => f.defId && !f.criteria).map((f) => Number(f.defId)));
          for (const id of defIds.map(Number)) {
            const p = album.findPlayer(id);
            if (!p || album.isCollected(id) || have.has(id)) continue;
            list.push(this.newTarget({ label: `${p.name}${p.rating ? ` ${p.rating}` : ''}`, defId: id, criteria: null, album: true }));
            have.add(id);
            added++;
          }
        });
        if (added) album.log(`${added} carte(s) Galerie ajoutée(s) aux cibles du sniper`);
        return added;
      },
      removeAlbumTarget(defId) {
        const f = this.targets().find((x) => x.album && Number(x.defId) === Number(defId));
        if (f) this.removeTarget(f.id);
      },
      clearAlbumTargets() {
        if (sniper.running) return;
        this.editTargets((list) => {
          const keep = list.filter((f) => !f.album);
          list.splice(0, list.length, ...keep);
          return 0;
        });
      },
      // « Sniper » depuis la Galerie : cibles ajoutées, alternance activée s'il y en a plusieurs, sniper lancé
      snipeSelection(defIds) {
        this.addAlbumTargets(defIds);
        for (const id of defIds) album.setSelected(id, false);
        album.touch();
        if (this.targets().length > 1 && !this.cfg.rotate) this.setConfig({ rotate: true });
        ui.show('snipe');
        if (!sniper.running) this.startSniper();
      },
      startSniper() {
        X.unlockAudio();
        void sniper.start();
      },
      stopSniper() {
        sniper.stop('Sniper : arrêt demandé', true);
      },
      stopAll() {
        album.stop('Arrêt demandé', true);
        sniper.stop('Arrêt demandé', true);
      },
      relist() {
        void sniper.relistTransferList();
      },
      unlock() {
        sniper.unlock();
        if (load(X.ALBUM_KEYS.K_LOCK_RESUME, null)) {
          clearTimeout(album.resumeTimer);
          void album.autoResume();
        }
        this.resume();
      },
      // Fin d'une tâche : le sniper reprend s'il doit tourner
      resume() {
        clearTimeout(resumeTimer);
        resumeTimer = setTimeout(() => {
          if (X.reloading || sniper.running || album.running || !sniper.on) return;
          void sniper.start();
        }, rand(3e3, 6e3));
      },
    };

    const sniper = new X.Sniper(
      () => app.cfg,
      onUpdate,
      (patch) => app.setConfig(patch),
      {
        onSnipe: (defId, raw) => album.onSnipe(defId, raw),
        isCollected: (defId) => album.isCollected(defId),
        albumSold: (i) => album.recordSold(i),
        albumPrice: (id) => album.bought[id]?.price ?? 0,
        albumOnSale: () => Object.values(album.bought).filter((b) => b.state === 'active').length,
        onListed: (id, price) => album.onListed(id, price),
        otherBusy: () => album.running,
        afterTask: () => app.resume(),
      },
    );
    const album = new X.Album(() => app.cfg, onUpdate, {
      guard: sniper.guard,
      delay: () => sniper.searchDelay().ms,
      beforeTask: async () => {
        if (!sniper.running) return;
        await sniper.suspend('Sniper suspendu pendant la tâche Galerie, reprise ensuite');
      },
      afterTask: () => app.resume(),
      onSold: (items) => sniper.recordSales(items),
    });
    // Chaque lecture réseau de la liste de transferts (sniper, Galerie ou Web App) recale le suivi des cartes Galerie
    X.onPile((auctions) =>
      album.reconcile(auctions.map((a) => ({ id: Number(a.itemData?.id), state: X.tradeState(String(a.tradeState ?? ''), Number(a.currentBid ?? 0)), buyNow: Number(a.buyNowPrice ?? 0) }))),
    );
    app.refreshPile = () => {
      if (album.running || sniper.task === 'relist') return;
      void album.refreshPile();
    };
    app.sniper = sniper;
    app.album = album;
    ui = new X.UI(app);
    X.app = app;

    const n = album.setList().length;
    album.log(`${X.APP} prêt${n ? ` (${n} set${n > 1 ? 's' : ''} Galerie)` : ''}`);
    if (n) setTimeout(() => !album.running && void album.syncGallery(), 5e3);
    // Lecture fut.gg enrichie (joueurs requis, seuils de grade) : catalogue relu une fois après la mise à jour
    if (Number(load(`${NS}:parseV`, 0)) < 2) {
      save(`${NS}:parseV`, 2);
      if (n) album.requestCatalog(true);
    } else if (app.cfg.autoCatalog) album.requestCatalog(false);
    // Suivi des cartes Galerie recalé sur la vraie liste de transferts au démarrage
    if (Object.keys(album.bought).length) setTimeout(() => !album.running && !sniper.running && app.refreshPile(), 8e3);

    // Reprises : achats Galerie interrompus (rechargement, pause), puis sniper
    const { K_RESUME, K_ACTIVE, K_LOCK_RESUME } = X.ALBUM_KEYS;
    const at = Number(load(K_RESUME, 0));
    save(K_RESUME, 0);
    let albumResumes = false;
    if (load(K_LOCK_RESUME, null)) {
      album.scheduleResume();
      albumResumes = true;
    } else if ((at && Date.now() - at < 9e5) || load(K_ACTIVE, false)) {
      if (album.queue.some(X.isOpen)) {
        album.log('Reprise automatique des achats Galerie dans 10 s');
        setTimeout(() => void album.runQueue(), 1e4);
        albumResumes = true;
      } else save(K_ACTIVE, false);
    }
    try {
      const r = load(X.SNIPE_RESUME_KEY, null);
      localStorage.removeItem(X.SNIPE_RESUME_KEY);
      if (r && Date.now() - r.at < 9e5) sniper.setOn(true);
    } catch {}
    if (sniper.on && !albumResumes) {
      sniper.note('Sniper : reprise automatique dans 5 s');
      setTimeout(() => !sniper.running && !album.running && void sniper.start(), 5e3);
    }

    onCommand = (cmd) => {
      if (cmd.type === 'stop') app.stopAll();
      else if (cmd.type === 'start') app.startSniper();
      else if (cmd.type === 'sniper-stop') app.stopSniper();
      else if (cmd.type === 'rotate') app.setConfig({ rotate: !!cmd.on });
      else if (cmd.type === 'toggle-panel') ui.toggle();
      else if (cmd.type === 'relist') app.relist();
      else if (cmd.type === 'catalog-progress') album.catalogStatus({ busy: true, text: `Catalogue fut.gg : ${cmd.text}` });
      else if (cmd.type === 'catalog-fresh') album.catalogStatus({ busy: false, text: '', at: Number(cmd.at) || album.catalog.at });
      else if (cmd.type === 'catalog-error') {
        album.catalogStatus({ busy: false, text: '' });
        album.log(`Catalogue fut.gg indisponible (${String(cmd.error || 'erreur').slice(0, 120)}) : import manuel possible`, 'warn');
      } else if (cmd.type === 'catalog') {
        const keys = album.importCatalog(cmd.sets, Number(cmd.at) || Date.now(), Number(cmd.failed) || 0);
        if (keys.length && !album.running) void album.syncGallery(keys);
      } else if (cmd.type === 'import' && Number(cmd.data?.at) > Number(load(X.ALBUM_KEYS.K_IMPORT_AT, 0))) {
        save(X.ALBUM_KEYS.K_IMPORT_AT, Number(cmd.data.at));
        const key = album.importSet(cmd.data);
        if (key) {
          ui.show('gallery');
          ui.openSet(key);
        }
      }
    };
    pendingCmds.splice(0).forEach(onCommand);
    onUpdate();
  }

  // Reprise attendue (rechargement après 401, sniper actif, achats en cours) : clic sur le bouton de connexion
  // de la Web App (session déjà ouverte côté EA ; aucun identifiant n'est saisi)
  const LOGIN_RE = /^\s*(log ?in|se connecter|connexion|ouvrir une session|anmelden|iniciar sesión|accedi)\s*$/i;
  const resumeExpected = () =>
    load(`${X.SNIPE_NS}:on`, false) === true ||
    !!load(X.SNIPE_RESUME_KEY ?? `${X.SNIPE_NS}:resume`, null) ||
    Number(load(`${NS}:resume`, 0)) > Date.now() - 9e5 ||
    load(`${NS}:active`, false) ||
    !!load(`${NS}:lockResume`, null);
  let clicks = 0;
  let lastClick = 0;
  const bootAt = Date.now();
  const boot = setInterval(() => {
    if (X.webAppReady()) {
      clearInterval(boot);
      try {
        init();
      } catch (err) {
        console.error(`[${X.APP}]`, err);
      }
      return;
    }
    if (clicks < 3 && Date.now() - bootAt > 4e3 && Date.now() - bootAt < 3e5 && Date.now() - lastClick > 15e3 && resumeExpected()) {
      const b = [...document.querySelectorAll('button, a.btn-standard, .btn-standard')].find((x) => LOGIN_RE.test(x.textContent ?? '') && x.offsetParent !== null && !x.disabled);
      if (b) {
        lastClick = Date.now();
        clicks++;
        setTimeout(() => b.click(), 2e3 + Math.random() * 3e3);
      }
    }
  }, 1e3);
})();
