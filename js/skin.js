/* Applies the chosen skin before the page paints, so there is no flash of the default look.
   The landing page and the first-run, tour and setup pages always keep the classic look (the app does the same on every route change). */
(function () {
  try {
    var s = localStorage.getItem('lifeos.skin'); if (['leather', 'fabric', 'minimal'].indexOf(s) < 0) return;
    var h = location.hash || '', bare = h.replace(/^#\/?/, '') === '';
    var neutral = /^#\/(landing|landing-v1|welcome|demo|setup|quick|start|begin|why-telos)(\/|$)/.test(h) ||
      (bare && !localStorage.getItem('account_mode') && !localStorage.getItem('login_prompt_seen'));
    if (!neutral) document.documentElement.setAttribute('data-skin', s);
  } catch (e) { /* storage unavailable */ }
})();
