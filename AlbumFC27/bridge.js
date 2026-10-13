(function () {
  const toPage = (cmd) => window.postMessage({ ns: 'albumfc27', dir: 'to-page', cmd }, window.location.origin);
  chrome.runtime.onMessage.addListener((cmd) => toPage(cmd));
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data?.ns === 'albumfc27' && e.data.dir === 'to-ext') {
      chrome.storage.local.set({ albumStats: e.data.stats });
    }
  });
  // Set envoyé depuis fut.gg : transmis au panneau (au chargement et à chaque nouvel envoi)
  chrome.storage.local.get('albumImport').then(({ albumImport }) => albumImport && toPage({ type: 'import', data: albumImport }));
  chrome.storage.local.onChanged.addListener((c) => c.albumImport?.newValue && toPage({ type: 'import', data: c.albumImport.newValue }));
})();
