// 화면부수기 e2e fixture script — served as /fixture.js (no inline scripts under strict CSP)
(function () {
  'use strict';
  window.__btnClicks = 0;
  function init() {
    var btn = document.getElementById('test-btn');
    var out = document.getElementById('btn-count');
    if (btn) {
      btn.addEventListener('click', function () {
        window.__btnClicks += 1;
        if (out) out.textContent = String(window.__btnClicks);
      });
    }
    var link = document.querySelector('#small-card a');
    if (link) {
      link.addEventListener('click', function () { window.__linkClicks = (window.__linkClicks || 0) + 1; });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
