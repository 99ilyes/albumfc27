// Page d'un set Galerie sur fut.gg : bouton « Envoyer à AlbumFC27 » (lecture de la page affichée uniquement)
(function () {
  const F = globalThis.AlbumFutgg;

  function toast(text) {
    document.querySelector('.albumfc27-toast')?.remove();
    const t = Object.assign(document.createElement('div'), { className: 'albumfc27-toast', textContent: text });
    t.style.cssText = 'position:fixed;right:20px;bottom:76px;z-index:2147483647;background:#15171c;color:#e8e8e8;border:1px solid #2c303a;border-radius:8px;padding:8px 12px;font:13px system-ui,sans-serif;max-width:320px';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  let btn = null;
  function ensureButton() {
    if (!F.GALLERY_RE.test(location.pathname)) {
      btn?.remove();
      btn = null;
      return;
    }
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;background:#2f9e44;color:#fff;border:0;border-radius:8px;padding:10px 14px;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px #0007';
      btn.onclick = async () => {
        const list = F.players(document);
        if (!list.length) return toast('Aucun joueur trouvé sur cette page');
        const data = F.setData(document, location.href, list);
        try {
          await chrome.storage.local.set({ albumImport: data });
        } catch {
          return toast('Extension mise à jour : recharge cette page');
        }
        const noPrice = list.filter((p) => !p.price).length;
        toast(`Envoyé à AlbumFC27 : ${list.length} joueur(s)${noPrice ? `, ${noPrice} sans prix` : ''}. Va dans l'onglet de la Web App.`);
      };
      document.body.appendChild(btn);
    }
    const n = F.players(document).length;
    const label = `Envoyer à AlbumFC27 (${n})`;
    if (btn.textContent !== label) btn.textContent = label;
    btn.disabled = n === 0;
  }

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      ensureButton();
    }, 400);
  }).observe(document.body, { childList: true, subtree: true });
  ensureButton();
})();
