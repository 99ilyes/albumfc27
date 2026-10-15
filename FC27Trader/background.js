chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  // Page fut.gg récupérée pour le catalogue de sets (la Web App ne peut pas la lire elle-même : CORS)
  if (msg?.type === 'futgg-fetch') {
    const url = String(msg.url || '');
    if (!url.startsWith('https://www.fut.gg/')) return void reply({ ok: false, status: 0 });
    fetch(url, { credentials: 'include' })
      .then(async (r) => reply({ ok: r.ok, status: r.status, html: r.ok ? await r.text() : '' }))
      .catch((e) => reply({ ok: false, status: 0, error: String(e?.message || e) }));
    return true;
  }
  // Notifications système (pause anti-captcha, achats terminés) : aucune action requise
  if (msg?.type !== 'notify') return;
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon-128.png',
    title: String(msg.title || 'FC27 Trader').slice(0, 80),
    message: String(msg.message || '').slice(0, 300),
    priority: 1,
  });
});
