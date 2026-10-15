(function () {
  const toPage = (cmd) => window.postMessage({ ns: 'albumfc27', dir: 'to-page', cmd }, window.location.origin);
  chrome.runtime.onMessage.addListener((cmd) => toPage(cmd));
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.ns !== 'albumfc27' || e.data.dir !== 'to-ext') return;
    if (e.data.stats) chrome.storage.local.set({ albumStats: e.data.stats });
    if (e.data.notify) chrome.runtime.sendMessage({ type: 'notify', ...e.data.notify }).catch(() => {});
    if (e.data.catalog) void syncCatalog(!!e.data.catalog.force);
  });
  // Set envoyé depuis fut.gg : transmis au panneau (au chargement et à chaque nouvel envoi)
  chrome.storage.local.get('albumImport').then(({ albumImport }) => albumImport && toPage({ type: 'import', data: albumImport }));
  chrome.storage.local.onChanged.addListener((c) => c.albumImport?.newValue && toPage({ type: 'import', data: c.albumImport.newValue }));

  // --- Catalogue : tous les sets de la Galerie fut.gg, relus au plus toutes les 6 h ---

  const F = globalThis.AlbumFutgg;
  const CATALOG_TTL = 6 * 36e5;
  const MAX_SETS = 400;
  const MAX_PAGES = 30;
  const GAP_MS = 250;
  let syncing = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const progress = (text) => toPage({ type: 'catalog-progress', text });

  async function fetchDoc(url) {
    const r = await chrome.runtime.sendMessage({ type: 'futgg-fetch', url });
    if (!r?.ok) throw new Error(r?.status ? `statut ${r.status}` : r?.error || 'fut.gg injoignable');
    const doc = new DOMParser().parseFromString(r.html, 'text/html');
    doc.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
    return doc;
  }

  // Joueurs d'un set, pages suivantes comprises
  async function readSet(url) {
    const first = await fetchDoc(url);
    const byId = new Map(F.players(first).map((p) => [p.defId, p]));
    const todo = F.pageLinks(first, url);
    const seen = new Set([url, ...todo]);
    for (let n = 0; todo.length && n < MAX_PAGES; n++) {
      await wait(GAP_MS);
      const doc = await fetchDoc(todo.shift()).catch(() => null);
      if (!doc) continue;
      for (const p of F.players(doc)) if (!byId.has(p.defId)) byId.set(p.defId, p);
      for (const u of F.pageLinks(doc, url)) if (!seen.has(u)) seen.add(u), todo.push(u);
    }
    return F.setData(first, url, [...byId.values()]);
  }

  async function syncCatalog(force) {
    if (syncing) return;
    let at = 0;
    try {
      at = Number((await chrome.storage.local.get('albumCatalogAt')).albumCatalogAt) || 0;
    } catch {
      return toPage({ type: 'catalog-error', error: 'extension mise à jour, recharger la Web App' });
    }
    if (!force && Date.now() - at < CATALOG_TTL) return toPage({ type: 'catalog-fresh', at });
    syncing = true;
    try {
      progress('lecture de la Galerie fut.gg…');
      const index = await fetchDoc(F.GALLERY_URL);
      const urls = new Set(F.setLinks(index));
      // Sets regroupés par catégorie (/fut-gallery/<catégorie>/) : chaque catégorie est lue
      for (const c of F.categoryLinks(index)) {
        await wait(GAP_MS);
        const doc = await fetchDoc(c).catch(() => null);
        if (doc) F.setLinks(doc).forEach((u) => urls.add(u));
      }
      const list = [...urls].slice(0, MAX_SETS);
      if (!list.length) throw new Error('aucun set trouvé sur la page Galerie');
      const sets = [];
      let failed = 0;
      for (const [i, url] of list.entries()) {
        progress(`set ${i + 1} / ${list.length}…`);
        await wait(GAP_MS);
        const data = await readSet(url).catch(() => null);
        if (data?.players.length) sets.push(data);
        else failed++;
      }
      if (!sets.length) throw new Error('aucun joueur lu dans les sets');
      const now = Date.now();
      await chrome.storage.local.set({ albumCatalogAt: now });
      toPage({ type: 'catalog', at: now, sets, failed });
    } catch (e) {
      toPage({ type: 'catalog-error', error: String(e?.message || e) });
    } finally {
      syncing = false;
    }
  }
})();
