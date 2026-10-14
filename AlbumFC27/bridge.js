// Relais entre la page (main.js) et l'extension : commandes du popup, statistiques, notifications, sets envoyés depuis fut.gg
(function () {
  const NS = 'albumfc27';
  const toPage = (cmd) => window.postMessage({ ns: NS, dir: 'to-page', cmd }, window.location.origin);
  chrome.runtime.onMessage.addListener((cmd) => toPage(cmd));
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.ns !== NS || e.data.dir !== 'to-ext') return;
    if (e.data.stats) chrome.storage.local.set({ stats: e.data.stats });
    if (e.data.albumStats) chrome.storage.local.set({ albumStats: e.data.albumStats });
    if (e.data.notify) chrome.runtime.sendMessage({ type: 'notify', ...e.data.notify }).catch(() => {});
  });
  chrome.storage.local.get('albumImport').then(({ albumImport }) => albumImport && toPage({ type: 'import', data: albumImport }));
  chrome.storage.local.onChanged.addListener((c) => c.albumImport?.newValue && toPage({ type: 'import', data: c.albumImport.newValue }));
})();
