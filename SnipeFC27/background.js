// Notifications système (pause anti-captcha, achats album terminés) : aucune action requise
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'notify') return;
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon-128.png',
    title: String(msg.title || 'SnipeFC27').slice(0, 80),
    message: String(msg.message || '').slice(0, 300),
    priority: 1,
  });
});
