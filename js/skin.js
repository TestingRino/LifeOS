/* Applies the chosen skin before the page paints, so there is no flash of the default look. */
(function () {
  try { var s = localStorage.getItem('lifeos.skin'); if (['leather', 'fabric', 'minimal'].indexOf(s) >= 0) document.documentElement.setAttribute('data-skin', s); } catch (e) { /* storage unavailable */ }
})();
