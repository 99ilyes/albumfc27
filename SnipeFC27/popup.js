const WEB_APP = /^https:\/\/www\.ea\.com\/([a-z-]+\/)?ea-sports-fc\/ultimate-team\/web-app\//;
const LIMITS = { searchesHour: 900, searchesDay: 9e3, bidsHour: 180, bidsDay: 1800 };
const EMPTY = {
  running: false,
  night: false,
  task: null,
  activity: '',
  coins: null,
  filter: '',
  session: { since: 0, searches: 0, snipes: 0, misses: 0, profit: 0, realized: 0, sales: 0, timeMs: 0 },
  limits: { searchesHour: 0, searchesDay: 0, bidsHour: 0, bidsDay: 0 },
};
const root = document.getElementById('root');
let tabId;
let stats = EMPTY;
let album = null;

function el(tag, props = {}, ...children) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children.filter((c) => c !== null && c !== undefined && c !== false && c !== ''));
  return n;
}
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('fr-FR'));
const hm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const send = (cmd) => tabId && chrome.tabs.sendMessage(tabId, cmd);
const rows = (list) => el('dl', {}, ...list.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: String(v) })]));

// Activité du marché (heure de Londres), identique au panneau
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CONTENT = ['Mini-sortie, récompenses Weekend League', 'SBC d’amélioration', '', 'Équipe de la semaine', '', 'Nouvelles promos, récompenses Weekend League', 'Récompenses Weekend League'];
function market(t = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(t);
  const day = WEEKDAYS.indexOf(parts.find((p) => p.type === 'weekday')?.value ?? 'Sun');
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  if (hour < 4) return { level: 'inactive', label: 'Marché calme', detail: 'Nuit en Europe' };
  if (hour < 8) {
    if (day === 4) return { level: 'active', label: 'Marché actif', detail: 'Récompenses Division Rivals (8 h à Londres)' };
    if (day === 0) return { level: 'active', label: 'Marché actif', detail: 'Récompenses Squad Battles (8 h à Londres)' };
    return { level: 'inactive', label: 'Marché calme', detail: 'Nuit en Europe' };
  }
  if (hour < 12) return { level: 'semi', label: 'Marché moyen', detail: 'Joueurs au travail ou à l’école' };
  if (hour < 16) return { level: 'semi', label: 'Marché moyen', detail: 'Le marché reprend un peu' };
  if (hour < 20) {
    const content = CONTENT[day] ? `Contenu : ${CONTENT[day]}` : 'Sortie de contenu';
    return { level: 'active', label: hour === 18 ? 'Meilleur moment pour sniper' : 'Marché actif', detail: `${content}${day === 3 || day === 5 ? ' · jour le plus rentable' : ''}` };
  }
  return { level: 'active', label: 'Marché actif', detail: 'Filtres d’interception actifs, contenu si intéressant' };
}

function albumSection(a, busy) {
  if (!a) return [];
  const q = a.queue ?? {};
  const t = a.total ?? {};
  const real = (t.lost ?? 0) + (a.pendingLoss ?? 0);
  const locked = (a.lockedUntil ?? 0) > Date.now();
  const status = a.running ? a.activity || 'Achats en cours' : a.lastMessage || 'À l’arrêt';
  return [
    el('h2', {}, 'Album ', el('span', { className: a.running ? 'dot on' : 'dot' })),
    el('p', { className: 'activity', textContent: status }),
    locked ? el('p', { className: 'lock', textContent: `Pause jusqu'à ${hm(a.lockedUntil)}${a.resumeAt ? `, reprise ${hm(a.resumeAt)}` : ''}` }) : null,
    rows([
      ['Sets', a.sets?.length ? a.sets.join(', ') : '—'],
      ['Dernier lot', q.total ? `${fmt(q.done)} / ${fmt(q.total)}${q.failed ? ` (${q.failed} non trouvé)` : ''}` : '—'],
      ['En vente', `${fmt(a.onSale)}${a.unsold ? ` (${a.unsold} invendu)` : ''}`],
      ['Coût réel', real < 0 ? `gain ${fmt(-real)}` : fmt(real)],
    ]),
    tabId === null ? null : el('button', { className: 'ghost', textContent: `Relister les invendus${a.unsold ? ` (${a.unsold})` : ''}`, disabled: busy, onclick: () => send({ type: 'relist' }) }),
  ];
}

function render() {
  if (tabId === undefined) return;
  const s = stats;
  const a = album;
  const se = s.session;
  const m = market();
  const busy = s.running || !!a?.running;
  const children = [
    el('h1', {}, 'SnipeFC27 ', el('span', { className: s.running ? 'dot on' : 'dot' })),
    el('p', { className: 'activity', textContent: s.running ? s.activity || 'En cours' : "À l'arrêt" }),
    el('p', { className: `market ${m.level}` }, `${m.label} · ${m.detail}`),
    rows([
      ['Filtre', s.filter || '—'],
      ['Crédits', fmt(s.coins)],
      ['Snipes / ratés', `${se.snipes} / ${se.misses}`],
      ['Profit estimé · réalisé', `${fmt(se.profit)} · ${fmt(se.realized)}`],
      ['Recherches 24 h', `${s.limits.searchesDay}/${LIMITS.searchesDay}`],
    ]),
    ...(tabId === null
      ? [el('p', { className: 'muted', textContent: "Ouvre la Web App FC 27 dans l'onglet actif." })]
      : [
          el(
            'div',
            { className: 'grid' },
            el('button', { className: busy ? 'stop' : 'start', textContent: busy ? 'STOP' : 'LANCER', onclick: () => send(busy ? { type: 'stop' } : { type: 'start' }) }),
            el('button', { className: s.night ? 'night' : '', textContent: `Mode nuit : ${s.night ? 'ON' : 'OFF'}`, disabled: !!a?.running, onclick: () => send({ type: 'night', on: !s.night }) }),
          ),
        ]),
    ...albumSection(a, busy),
    tabId === null ? null : el('button', { className: 'ghost', textContent: 'Afficher / masquer le panneau', onclick: () => send({ type: 'toggle-panel' }) }),
  ];
  root.replaceChildren(...children.filter(Boolean));
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.url && WEB_APP.test(tab.url) ? tab.id : null;
  const got = await chrome.storage.local.get(['stats', 'albumStats']);
  if (got.stats) stats = { ...EMPTY, ...got.stats };
  album = got.albumStats ?? null;
  render();
  chrome.storage.local.onChanged.addListener((c) => {
    if (c.stats?.newValue) stats = { ...EMPTY, ...c.stats.newValue };
    if (c.albumStats?.newValue) album = c.albumStats.newValue;
    if (c.stats || c.albumStats) render();
  });
})();
