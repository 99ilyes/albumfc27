// Lecture d'une page Galerie fut.gg : page affichée (futgg.js) ou HTML récupéré par le service worker (bridge.js)
globalThis.AlbumFutgg = (() => {
  const ORIGIN = 'https://www.fut.gg';
  const GALLERY_URL = `${ORIGIN}/fut-gallery/`;
  const PLAYER_RE = /\/players\/(\d+)-([a-z0-9-]+)\/(\d{2})-(\d+)/i;
  const GALLERY_RE = /^\/fut-gallery\/[^/]+\/([^/]+)\/?$/;
  const CATEGORY_RE = /^\/fut-gallery\/([^/]+)\/?$/;
  const PRICE_RE = /^(\d{1,3}(?:[.,\s]\d{3})+|\d+(?:[.,]\d+)?)\s*([km])?$/i;

  const toName = (slug) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const urlOf = (a) => {
    try {
      return new URL(a.getAttribute('href') || '', ORIGIN);
    } catch {
      return null;
    }
  };

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

  function players(doc) {
    const seen = new Set();
    const out = [];
    for (const a of doc.querySelectorAll('a[href*="/players/"]')) {
      const u = urlOf(a);
      if (u?.origin !== ORIGIN) continue;
      const m = u.pathname.match(PLAYER_RE);
      if (!m) continue;
      const defId = Number(m[4]);
      if (!defId || seen.has(defId)) continue;
      seen.add(defId);
      out.push({ defId, name: toName(m[2]), price: readPrice(a), rating: readRating(a) });
    }
    return out;
  }

  function setName(doc, path) {
    const h1 = doc.querySelector('h1')?.textContent?.trim();
    const slug = path.match(GALLERY_RE)?.[1] ?? '';
    return h1 && h1.length <= 60 ? h1 : toName(slug);
  }

  // Texte de la page, nœuds séparés par des espaces (textContent les colle bout à bout dans un document non affiché)
  function pageText(doc) {
    const out = [];
    const w = doc.createTreeWalker(doc.body ?? doc, 4);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const v = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (v) out.push(v);
    }
    return out.join(' ');
  }

  // Places du set : « requires 20 Arsenal Men's or Women's players to complete », « needs 30 Premier League players », « Players needed: 20 »
  function needed(doc) {
    const t = pageText(doc);
    const m =
      t.match(/\b(?:requires?|needs?)\s+(\d{1,3})\s+(?:[^.\d]{0,60}?\s)?players?\b/i) ||
      t.match(/(\d{1,3})\s+(?:players?\s+)?(?:needed|required|requis|nécessaires)/i) ||
      t.match(/(?:players? needed|required players?)\s*:?\s*(\d{1,3})/i);
    return m ? Number(m[1]) : 0;
  }

  const num = (v) => {
    const m = String(v).trim().match(/^(\d+(?:[.,]\d+)?)\s*([km])$/i);
    if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * (m[2].toLowerCase() === 'k' ? 1e3 : 1e6));
    return parseInt(String(v).replace(/[^\d]/g, ''), 10);
  };
  // Seuils de grade (score de set) du tableau « Grade requirements » : D < C < B < A < S, sinon null
  function grades(doc) {
    const t = pageText(doc);
    const at = [/grade requirements?/i, /requirements?/i, /grades?/i].map((re) => t.search(re)).find((i) => i >= 0) ?? 0;
    const sec = t.slice(at, at + 4e3);
    const out = {};
    let from = 0;
    for (const g of ['D', 'C', 'B', 'A', 'S']) {
      const re = new RegExp(`(?:^|[^A-Za-z])${g}(?![A-Za-z])[^\\d]{0,30}?(\\d{1,3}(?:[ ,.]\\d{3})+|\\d+(?:[.,]\\d+)?\\s*[kKmM](?![A-Za-z])|\\d+)`, 'g');
      re.lastIndex = from;
      const m = re.exec(sec);
      if (!m) return null;
      out[g] = num(m[1]);
      from = re.lastIndex;
    }
    const v = Object.values(out);
    return v.every((x, i) => Number.isFinite(x) && x > 0 && (!i || x > v[i - 1])) ? out : null;
  }

  // Liens fut.gg de la page qui vérifient re (pathname), sans doublon
  function links(doc, re) {
    const out = new Set();
    for (const a of doc.querySelectorAll('a[href*="/fut-gallery/"]')) {
      const u = urlOf(a);
      if (u?.origin === ORIGIN && re.test(u.pathname)) out.add(`${ORIGIN}${u.pathname.replace(/\/?$/, '/')}`);
    }
    return [...out];
  }

  // Pages suivantes d'un set (même chemin, paramètre page)
  function pageLinks(doc, url) {
    const path = new URL(url).pathname.replace(/\/?$/, '/');
    const out = new Set();
    for (const a of doc.querySelectorAll('a[href*="page="]')) {
      const u = urlOf(a);
      if (u?.origin === ORIGIN && u.pathname.replace(/\/?$/, '/') === path && u.searchParams.get('page')) out.add(u.href);
    }
    return [...out];
  }

  // Même format que l'envoi depuis la page fut.gg (commande « import » du panneau)
  function setData(doc, url, list) {
    const path = new URL(url).pathname;
    return { at: Date.now(), slug: path.match(GALLERY_RE)?.[1] ?? 'set', name: setName(doc, path), url, needed: needed(doc), grades: grades(doc), players: list };
  }

  return {
    GALLERY_URL,
    GALLERY_RE,
    players,
    setData,
    pageLinks,
    setLinks: (doc) => links(doc, GALLERY_RE),
    categoryLinks: (doc) => links(doc, CATEGORY_RE),
  };
})();
