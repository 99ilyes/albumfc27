(function () {
  chrome.runtime.onMessage.addListener((cmd) => {
    window.postMessage({ ns: 'albumfc27', dir: 'to-page', cmd }, window.location.origin);
  });
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data?.ns === 'albumfc27' && e.data.dir === 'to-ext') {
      chrome.storage.local.set({ albumStats: e.data.stats });
    }
  });
})();
