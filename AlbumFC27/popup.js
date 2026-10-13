const WEB_APP = /^https:\/\/www\.ea\.com\/([a-z-]+\/)?ea-sports-fc\/ultimate-team\/web-app\//;
const root = document.getElementById('root');
let tabId = null;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

function send(cmd) {
  if (tabId !== null) chrome.tabs.sendMessage(tabId, cmd);
}

function render(s) {
  if (tabId === null) {
    root.replaceChildren(el('h1', { textContent: 'AlbumFC27' }), el('p', { className: 'muted', textContent: "Ouvre la Web App FC 27 dans l'onglet actif." }));
    return;
  }
  s ??= {};
  const q = s.queue ?? {};
  const total = s.total ?? {};
  const rows = [
    ['Ensemble', s.club ?? '?'],
    ['Achats en cours', q.total ? `${fmt(q.listed)} / ${fmt(q.total)}${q.failed ? ` (${q.failed} échec)` : ''}` : '-'],
    ['Joueurs achetés (total)', fmt(total.bought)],
    ['Crédits perdus', (total.lost ?? 0) < 0 ? `gain ${fmt(-total.lost)}` : fmt(total.lost)],
    ['Perte estimée en vente', fmt(s.pendingLoss)],
    ['Crédits', s.coins == null ? '?' : fmt(s.coins)],
  ];
  root.replaceChildren(
    el('h1', {}, 'AlbumFC27 ', el('span', { className: s.running ? 'dot on' : 'dot' })),
    el('p', { className: 'activity', textContent: s.running ? s.activity || 'En cours' : s.lastMessage || "À l'arrêt" }),
    el('dl', {}, ...rows.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: String(v) })])),
    s.feed?.length ? el('ul', { className: 'feed' }, ...s.feed.slice(0, 6).map((f) => el('li', { textContent: f }))) : '',
    s.running ? el('div', { className: 'row' }, el('button', { className: 'stop', textContent: 'Arrêter', onclick: () => send({ type: 'stop' }) })) : '',
    el('button', { className: 'ghost', textContent: 'Afficher / masquer le panneau', onclick: () => send({ type: 'toggle-panel' }) }),
  );
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.url && WEB_APP.test(tab.url) ? tab.id : null;
  const { albumStats } = await chrome.storage.local.get('albumStats');
  render(albumStats);
  chrome.storage.local.onChanged.addListener((c) => c.albumStats?.newValue && render(c.albumStats.newValue));
})();
