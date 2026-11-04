/* =========================================================
   LegalCraft — Light / Dark mode toggle
   - Pilihan disimpan di localStorage ('lc_theme')
   - Default mengikuti setelan perangkat (prefers-color-scheme)
   - Tombol: elemen apa pun dengan atribut [data-theme-toggle]
     (jika halaman tidak punya, tombol melayang otomatis dibuat)
   ========================================================= */
(function () {
  'use strict';
  var KEY = 'lc_theme';
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  var stored = function () { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  var current = function () { return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; };

  var syncUI = function () {
    var dark = current() === 'dark';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0B1329' : '#17517E');
    var btns = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', String(dark));
      btns[i].setAttribute('aria-label', dark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap');
      btns[i].setAttribute('title', dark ? 'Mode terang' : 'Mode gelap');
    }
  };

  var apply = function (theme, animate) {
    if (animate) {
      root.classList.add('theme-anim');
      clearTimeout(apply._t);
      apply._t = setTimeout(function () { root.classList.remove('theme-anim'); }, 450);
    }
    root.setAttribute('data-theme', theme);
    syncUI();
    try { window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme } })); } catch (e) {}
  };

  var toggle = function () {
    var next = current() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) {}
    apply(next, true);
  };

  var ICONS = '<i class="fa-solid fa-moon" aria-hidden="true"></i><i class="fa-solid fa-sun" aria-hidden="true"></i>';

  var init = function () {
    var btns = document.querySelectorAll('[data-theme-toggle]');
    if (!btns.length) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'theme-toggle floating';
      b.setAttribute('data-theme-toggle', '');
      document.body.appendChild(b);
      btns = [b];
    }
    for (var i = 0; i < btns.length; i++) if (!btns[i].innerHTML.trim()) btns[i].innerHTML = ICONS;
    syncUI();
  };

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-theme-toggle]')) { e.preventDefault(); toggle(); }
  });

  // Ikuti perubahan setelan perangkat selama user belum memilih manual
  if (mq) {
    var onChange = function (ev) { if (!stored()) apply(ev.matches ? 'dark' : 'light', true); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }

  // Sinkron antar-tab
  window.addEventListener('storage', function (e) { if (e.key === KEY && e.newValue) apply(e.newValue, true); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.LegalCraftTheme = { toggle: toggle, set: function (t) { try { localStorage.setItem(KEY, t); } catch (e) {} apply(t, true); }, get: current };
})();
