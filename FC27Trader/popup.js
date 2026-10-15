const WEB_APP = /^https:\/\/www\.ea\.com\/([a-z-]+\/)?ea-sports-fc\/ultimate-team\/web-app\//;
const root = document.getElementById('root');
let tabId = null;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== ''));
  return node;
}
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('fr-FR'));
const signed = (n) => `${n > 0 ? '+' : ''}${fmt(n)}`;
const hm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const send = (cmd) => tabId !== null && chrome.tabs.sendMessage(tabId, cmd);

function render(st) {
  if (tabId === null) {
    root.replaceChildren(el('h1', { textContent: 'FC27 Trader' }), el('p', { className: 'muted', textContent: "Ouvre la Web App FC 27 dans l'onglet actif." }));
    return;
  }
  const s = st?.sniper ?? {};
  const a = st?.album ?? {};
  const ses = s.session ?? {};
  const snipe = s.running && s.task === 'snipe';
  const locked = (s.lockedUntil ?? 0) > Date.now();
  const busy = s.running || a.running;
  const perH = ses.activeMs >= 3e5 ? Math.round((ses.realized * 36e5) / ses.activeMs) : null;
  const m = st?.market;
  const t = a.total ?? {};
  const albumCost = (t.lost ?? 0) + (a.pendingLoss ?? 0) + (t.keptSpent ?? 0);
  root.replaceChildren(
    el('h1', {}, el('span', { className: `dot${locked ? ' lock' : busy ? ' on' : ''}` }), 'FC27 Trader'),
    el('p', { className: 'activity', textContent: st?.status || (s.on ? 'Sniper : reprise imminente' : 'À l’arrêt') }),
    m ? el('p', { className: `market ${m.level}`, textContent: `${m.label} jusqu’à ${hm(m.until)} · ${m.detail}` }) : null,
    el(
      'dl',
      {},
      ...[
        ['Crédits', fmt(s.coins)],
        ['Cible', s.filter ? `${s.filter}${s.buyPrice ? ` ≤ ${fmt(s.buyPrice)}` : ''}` : `${s.targets ?? 0} cible(s)`],
        ['Snipes / ratés', `${ses.snipes ?? 0} / ${ses.misses ?? 0}`],
        ['Profit réel · par heure', `${signed(ses.realized ?? 0)}${perH === null ? '' : ` · ${signed(perH)} / h`}`],
        ['En attente de vente', `${s.pending?.count ?? 0} (${signed(s.pending?.expected ?? 0)})`],
        ['Recherches 24 h', `${s.limits?.searchesDay ?? 0} / ${s.limits?.max ? (s.limits.max.searchesDay ?? '∞') : '—'}`],
        ['Galerie : coût réel', albumCost < 0 ? `gain ${fmt(-albumCost)}` : fmt(albumCost)],
      ].flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: String(v) })]),
    ),
    el(
      'div',
      { className: 'row' },
      el('button', { className: snipe ? 'stop' : 'go', textContent: snipe ? 'Arrêter le sniper' : 'Lancer le sniper', disabled: s.running && !snipe, onclick: () => send({ type: snipe ? 'sniper-stop' : 'start' }) }),
      el('button', { className: s.rotate ? 'on-btn' : '', textContent: `Alterner : ${s.rotate ? 'oui' : 'non'}`, title: 'Alterner entre toutes les cibles et groupes, ou seulement la cible ou le groupe sélectionné', onclick: () => send({ type: 'rotate', on: !s.rotate }) }),
    ),
    el(
      'div',
      { className: 'row' },
      busy ? el('button', { className: 'stop', textContent: 'Tout arrêter', onclick: () => send({ type: 'stop' }) }) : el('button', { textContent: `Relister${a.unsold ? ` (${a.unsold})` : ''}`, onclick: () => send({ type: 'relist' }) }),
      el('button', { className: 'ghost', textContent: 'Ouvrir / fermer', onclick: () => send({ type: 'toggle-panel' }) }),
    ),
  );
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.url && WEB_APP.test(tab.url) ? tab.id : null;
  const { fc27Stats } = await chrome.storage.local.get('fc27Stats');
  render(fc27Stats);
  chrome.storage.local.onChanged.addListener((c) => c.fc27Stats?.newValue && render(c.fc27Stats.newValue));
})();
