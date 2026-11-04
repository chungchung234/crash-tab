  /* Small helpers + the Korean fallback strings. v1.3 §1 drops labelPower / btnPowerDown / btnPowerUp;
   * §3.4 adds dodgeLabel (the 회피! call-out beside the player ring). */
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const px = (v) => (Math.round(v * 100) / 100) + 'px';

  /* ── SPEC-test-speed §3: the debug time scale ──────────────────────────────
   * Spec names this pair `dur()`; it is `scaleMs()` here because `dur` is already a local variable in five
   * product functions (32-material, 35-effects, 40-audio, 46-viewmodel, 65-pieces) and every fragment shares
   * ONE closure — a top-level `dur` would be shadowed inside exactly the functions that schedule timers.
   * Clamped to [0.05, 1]: a test may speed the product up, never slow it down. Non-numeric / NaN reads as 1. */
  function timeScale() {
    const s = Number(debug.timeScale);
    return isFinite(s) ? clamp(s, 0.05, 1) : 1;
  }
  function scaleMs(ms) { return (typeof ms === 'number' && isFinite(ms)) ? ms * timeScale() : ms; }
  /* Read-back for SPEC-test-speed §8 test 2: debug.scaledMs(3000) reports what the clamp actually applied,
   * so a test can prove `timeScale = 2` behaves as 1 without timing a three-second lock to find out. */
  debug.scaledMs = (ms) => scaleMs(ms);
  debug.timeScaleNow = () => timeScale();

  /* safe(): run fn in try/catch; swallow promise rejections too (A3). */
  function safe(fn) {
    try {
      const r = fn();
      if (r && typeof r.then === 'function') r.then(null, () => {});
      return r;
    } catch (e) { return undefined; }
  }
  function safeThen(fn, cb) {
    const r = safe(fn);
    if (r && typeof r.then === 'function') r.then((v) => { try { cb(v); } catch (e) { /* ignore */ } }, () => {});
    else if (r !== undefined) { try { cb(r); } catch (e) { /* ignore */ } }
  }
  function gcs(el) { try { return gcsRaw(el); } catch (e) { return null; } }
  function rectOf(el) { try { return el.getBoundingClientRect(); } catch (e) { return null; } }
  function tagOf(el) { return (el && el.localName) ? String(el.localName).toLowerCase() : ''; }
  function parentOf(el) { return el ? (el.parentElement || (el.parentNode && el.parentNode.host) || null) : null; }
  function viewW() { return docEl.clientWidth || win.innerWidth; }
  function viewH() { return docEl.clientHeight || win.innerHeight; }
  function isOurs(n) { return !!(n && n.nodeType === 1 && n.closest && n.closest('[data-crs]')); }
  /* One reader for a computed `rgb()` / `rgba()` string (comma or space syntax): { r, g, b, a } with `a` 1 when
   * absent or unreadable, or null when it is not a colour function with three finite channels. */
  function parseColor(str) {
    const m = /rgba?\(([^)]+)\)/.exec(str || '');
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || !isFinite(p[0]) || !isFinite(p[1]) || !isFinite(p[2])) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length >= 4 && isFinite(p[3]) ? p[3] : 1 };
  }
  /* WCAG 2.x relative luminance of { r, g, b } (0–255), exactly as the recommendation states it. */
  function relLuminance(c) {
    const f = (v) => { v = clamp(v, 0, 255) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function alphaOf(color) {
    if (!color) return 1;
    if (color === 'transparent') return 0;
    const c = parseColor(color);
    return c ? c.a : 1;
  }
  function mk(tag, cls) {
    const n = doc.createElement(tag);
    n.className = cls;
    n.setAttribute('data-crs', '1');
    return n;
  }
  function imp(node, prop, val) { try { node.style.setProperty(prop, val, 'important'); } catch (e) { /* ignore */ } }
  function countDescendants(el, cap) {
    let n = 0;
    try {
      const w = doc.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
      while (w.nextNode()) { if (++n >= cap) break; }
    } catch (e) { /* ignore */ }
    return n;
  }

  /* i18n with hard-coded Korean fallbacks.
   * Every string the product renders has a Korean fallback here: chrome.i18n is unavailable in a page whose
   * extension context has gone away (and in the e2e harness's shim), and a HUD that prints its own message
   * keys is a broken HUD. The table is GENERATED: tools/build.js reads _locales/ko/messages.json and writes
   * the keys listed in src/ko-fallback-keys.json at the marker below, so the strings live in exactly one
   * place. Do not type Korean strings here; add the key to the locale and to that list, then rebuild.
   * (node tools/build.js --check and validate rule R19 fail when content.js and the locale disagree.) */
  const KO = Object.assign({}, /*@KO_FALLBACK@*/);
  function msg(key) {
    const s = safe(() => chrome.i18n.getMessage(key));
    return (typeof s === 'string' && s) ? s : (KO[key] || key);
  }
