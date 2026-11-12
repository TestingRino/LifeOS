/* Contact page: shows the support email from js/config.js when one is set. */
(function () {
  const e = (window.LIFEOS_CONFIG || {}).supportEmail;
  if (!e) return;
  document.getElementById('mailLink').textContent = e;
  document.getElementById('mailLink').href = 'mailto:' + e;
  document.getElementById('mailRow').hidden = false;
})();
