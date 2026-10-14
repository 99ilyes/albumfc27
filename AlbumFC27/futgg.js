// Page d'un set Galerie sur fut.gg : bouton « Envoyer à AlbumFC27 » (lecture de la page affichée uniquement)
(function () {
  const PLAYER_RE = /\/players\/(\d+)-([a-z0-9-]+)\/(\d{2})-(\d+)/i;
  const GALLERY_RE = /^\/fut-gallery\/[^/]+\/([^/]+)\/?$/;
  const PRICE_RE = /^(\d{1,3}(?:[.,\s]\d{3})+|\d+(?:[.,]\d+)?)\s*([km])?$/i;

  const toName = (slug) =>
    slug
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

  function parsePrice(text) {
    const m = text.replace(/\s+/g, ' ').trim().match(PRICE_RE);
    if (!m) return null;
    const [, num, suffix] = m;
    const v = suffix ? parseFloat(num.replace(',', '.')) * (suffix.toLowerCase() === 'k' ? 1e3 : 1e6) : parseInt(num.replace(/[.,\s]/g, ''), 10);
    return Number.isFinite(v) && v >= 150 ? Math.round(v) : null;
  }

  // Remonte jusqu'au bloc de la carte (le plus grand parent qui ne contient qu'un joueur)
  function cardScope(a) {
    let scope = a;
    for (let i = 0; i < 6; i++) {
      const up = scope.parentElement;
      if (!up || up.querySelectorAll('a[href*="/players/"]').length > 1) break;
      scope = up;
    }
    return scope;
  }

  function readPrice(a) {
    const coin = cardScope(a).querySelector('img[src*="coin" i], img[alt="Coin" i]');
    return coin ? parsePrice(coin.parentElement?.textContent || '') : null;
  }

  function readRating(a) {
    for (const img of a.querySelectorAll('img[alt]')) {
      const m = img.alt.match(/\b([4-9]\d)\b/);
      if (m) return Number(m[1]);
    }
    return 0;
  }

  function players() {
    const seen = new Set();
    const out = [];
    for (const a of document.querySelectorAll('a[href*="/players/"]')) {
      if (a.origin !== location.origin) continue;
      const m = a.pathname.match(PLAYER_RE);
      if (!m) continue;
      const defId = Number(m[4]);
      if (!defId || seen.has(defId)) continue;
      seen.add(defId);
      out.push({ defId, name: toName(m[2]), price: readPrice(a), rating: readRating(a) });
    }
    return out;
  }

  function setName() {
    const h1 = document.querySelector('h1')?.textContent?.trim();
    const slug = location.pathname.match(GALLERY_RE)?.[1] ?? '';
    return h1 && h1.length <= 60 ? h1 : toName(slug);
  }

  function needed() {
    const t = document.body.innerText || document.body.textContent || '';
    const m = t.match(/(\d{1,3})\s+(?:players?\s+)?(?:needed|required|requis|nécessaires)/i) || t.match(/(?:players? needed|required players?)\s*:?\s*(\d{1,3})/i);
    return m ? Number(m[1]) : 0;
  }

  function toast(text) {
    document.querySelector('.albumfc27-toast')?.remove();
    const t = Object.assign(document.createElement('div'), { className: 'albumfc27-toast', textContent: text });
    t.style.cssText = 'position:fixed;right:20px;bottom:76px;z-index:2147483647;background:#14161b;color:#e8e8e8;border:1px solid #2a2e37;border-radius:8px;padding:8px 12px;font:13px system-ui,sans-serif;max-width:320px';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  let btn = null;
  function ensureButton() {
    const slug = location.pathname.match(GALLERY_RE)?.[1];
    if (!slug) {
      btn?.remove();
      btn = null;
      return;
    }
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;background:#63e64b;color:#0d1a09;border:0;border-radius:8px;padding:10px 14px;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px #0007';
      btn.onclick = async () => {
        const list = players();
        if (!list.length) return toast('Aucun joueur trouvé sur cette page');
        const data = { at: Date.now(), slug: location.pathname.match(GALLERY_RE)?.[1] ?? 'set', name: setName(), url: location.href, needed: needed(), players: list };
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
    const n = players().length;
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
