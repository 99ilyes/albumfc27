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
  const t = s.total ?? {};
  const real = (t.lost ?? 0) + (s.pendingLoss ?? 0) + (t.keptSpent ?? 0);
  const locked = (s.lockedUntil ?? 0) > Date.now();
  const hm = (x) => new Date(x).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const rows = [
    ['Crédits', s.coins == null ? '?' : fmt(s.coins)],
    ['Sets', s.sets?.length ? s.sets.join(', ') : '-'],
    ['Dernier lot', q.total ? `${fmt(q.done)} / ${fmt(q.total)}${q.failed ? ` (${q.failed} non acheté)` : ''}` : '-'],
    ['En vente', `${fmt(s.onSale)}${s.unsold ? ` (${s.unsold} invendu)` : ''}`],
    ['Coût réel', real < 0 ? `gain ${fmt(-real)}` : fmt(real)],
  ];
  if (locked) rows.unshift(['Pause', `jusqu'à ${hm(s.lockedUntil)}${s.resumeAt ? `, reprise ${hm(s.resumeAt)}` : ''}`]);
  root.replaceChildren(
    el('h1', {}, 'AlbumFC27 ', el('span', { className: s.running ? 'dot on' : 'dot' })),
    el('p', { className: 'activity', textContent: s.running ? s.activity || 'En cours' : s.lastMessage || "À l'arrêt" }),
    el('dl', {}, ...rows.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: String(v) })])),
    s.feed?.length ? el('ul', { className: 'feed' }, ...s.feed.slice(0, 6).map((f) => el('li', { textContent: f }))) : '',
    el(
      'div',
      { className: 'row' },
      s.running
        ? el('button', { className: 'stop', textContent: 'Arrêter', onclick: () => send({ type: 'stop' }) })
        : el('button', { className: 'start', textContent: `Relister les invendus${s.unsold ? ` (${s.unsold})` : ''}`, onclick: () => send({ type: 'relist' }) }),
    ),
    el('button', { className: 'ghost', textContent: 'Ouvrir / fermer AlbumFC27', onclick: () => send({ type: 'toggle-panel' }) }),
  );
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.url && WEB_APP.test(tab.url) ? tab.id : null;
  const { albumStats } = await chrome.storage.local.get('albumStats');
  render(albumStats);
  chrome.storage.local.onChanged.addListener((c) => c.albumStats?.newValue && render(c.albumStats.newValue));
})();
