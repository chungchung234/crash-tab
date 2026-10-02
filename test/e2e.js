#!/usr/bin/env node
/*
 * 화면부수기 (Crash Screen) — end-to-end tests (spec §9, §12.8, §13 A28–A31, A33; v1.1 addendum §7 / A15–A16).
 *
 * Zero npm dependencies. Puppeteer is resolved from PUPPETEER_PATH, then from the npx cache
 * (~/.npm/_npx/<hash>/node_modules/puppeteer), then from a plain require('puppeteer').
 *
 * Suites:
 *   A. content harness   — fixture on "/", content.css via CDP (CSS.createStyleSheet), chrome shim,
 *                          content.js via page.evaluate(source) (CSP-exempt like a real content script)
 *   B. strict CSP + TT   — fixture on "/strict" (default-src 'self'; require-trusted-types-for 'script')
 *   C. real extension    — copy of the extension with host_permissions for 127.0.0.1, service worker toggle
 *
 * v1.1: size-based HP (`api.hpOf`), weapons (`api.weapons()`), hold weapons (smg / flame), sword slashes
 * (`api.slash`), rocket AoE, hit feedback (.crs-dmg / .crs-hit).
 * v1.2 (SPEC-v3 §8 / A13): ten weapons incl. the sniper (`api.scope`, RMB / Shift chord, spread, bolt action),
 * ammo + reload (`api.ammo` / `api.reload`, `R`), loadouts (`api.loadout` / `setLoadout` / `applyPreset`, keys
 * 1–9,0 / Q / E / Shift+digit / drag), hostile components (`api.setCombat`, `api.player`, debug.forceAttack /
 * setPlayerPos / setPlayerHp, T1 orb / T2 slam / T3 laser, KO + Enter), `Z` restore, pause on blur, exit.
 * Suite A runs with `api.debug = { noCrit, noCooldown, noSpread, noAttacks, fastReload }` all true (flags
 * flipped per block and restored afterwards); every damage number is read from `api.weapons()`.
 *
 * Output: one PASS/FAIL line per assertion, a summary line, exit code 0/1 (2 = puppeteer missing).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = __dirname;
const OUT = path.join(TEST_DIR, 'out');
const VIEWPORT = { width: 1280, height: 900, deviceScaleFactor: 1 };
const STRICT_CSP = "default-src 'self'; style-src 'self'; img-src 'self' data:; require-trusted-types-for 'script'";
const T0 = Date.now();

// v1.2 weapon table (SPEC-v3 A1 / A6) — WEAPON_IDS is the DEFAULT PRESET order (slots 1–10 → keys 1…9, 0);
// damages / cooldowns / magazines are cross-checked against api.weapons()
const WEAPON_IDS = ['hammer', 'pistol', 'smg', 'sniper', 'axe', 'sword', 'bomb', 'rocket', 'flame', 'collapse'];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const SPEC_DMG = { hammer: 65, pistol: 25, smg: 22, sniper: 200, axe: 130, sword: 60, bomb: 190, rocket: 260, flame: 15 };
const SPEC_COOLDOWN = { hammer: 0, pistol: 0, sniper: 600, axe: 550, bomb: 700, rocket: 1200, collapse: 2000 };
// mag / reloadMs per weapon (null = melee ∞); flame = 100 fuel, collapse = 1 charge
const SPEC_MAG = { hammer: [null, null], axe: [null, null], sword: [null, null], pistol: [12, 900], smg: [30, 1400], sniper: [5, 2000], bomb: [3, 1800], rocket: [2, 1500], flame: [100, 2500], collapse: [1, 5000] };
const PRESETS = {
  default: WEAPON_IDS,
  assault: ['smg', 'pistol', 'sniper', 'bomb', 'rocket', 'flame', 'hammer', 'axe', 'sword', 'collapse'],
};
const KO_NAME = { hammer: '망치', pistol: '권총', smg: '기관총', sniper: '저격총', axe: '도끼', sword: '검', bomb: '폭탄', rocket: '로켓', flame: '화염', collapse: '붕괴' };

// v1.5 per-weapon stats (SPEC-weapons §3.1) read back from api.weapons(); sniper critChance is the
// UNSCOPED base value (0.10 — the 0.25-while-aiming bonus is behavioural, not a static field, and is not
// asserted here). collapse.pierce is "전부" (all) — represented as Infinity by convention; a product that
// instead uses a large sentinel integer or the literal string 'all' is accepted (see PIERCE_ALL below).
const SPEC_STATS = {
  hammer:   { swapMs: 220, recoil: 1.4, bloom: 0, critChance: 0.12, knockback: 1.0, moveSpeed: 1.00, falloff: 0 },
  pistol:   { swapMs: 150, recoil: 0.7, bloom: 0, critChance: 0.10, knockback: 0.7, moveSpeed: 1.10, falloff: 0.25 },
  smg:      { swapMs: 260, recoil: 0.5, bloom: 6, critChance: 0.06, knockback: 0.6, moveSpeed: 0.95, falloff: 0.40 },
  sniper:   { swapMs: 420, recoil: 2.0, bloom: 0, critChance: 0.10, knockback: 1.3, moveSpeed: 0.75, falloff: 0 },
  axe:      { swapMs: 400, recoil: 1.8, bloom: 0, critChance: 0.15, knockback: 1.4, moveSpeed: 0.85, falloff: 0 },
  sword:    { swapMs: 200, recoil: 1.0, bloom: 0, critChance: 0.20, knockback: 1.1, moveSpeed: 1.15, falloff: 0 },
  bomb:     { swapMs: 300, recoil: 1.2, bloom: 0, critChance: 0.08, knockback: 1.6, moveSpeed: 0.95, falloff: 0, aoeIgnoresCover: true },
  rocket:   { swapMs: 480, recoil: 2.4, bloom: 0, critChance: 0.08, knockback: 2.0, moveSpeed: 0.80, falloff: 0, aoeIgnoresCover: true },
  flame:    { swapMs: 340, recoil: 0.3, bloom: 3, critChance: 0.05, knockback: 0.5, moveSpeed: 0.90, falloff: 0.55 },
  collapse: { swapMs: 500, recoil: 2.6, bloom: 0, critChance: 0,    knockback: 1.2, moveSpeed: 1.00, falloff: 0 },
};
const SPEC_PIERCE = { hammer: 0, pistol: 0, smg: 0, sniper: 2, axe: 0, sword: 0, bomb: 0, rocket: 0, flame: 0, collapse: Infinity };
const pierceMatches = (got, want) => (want === Infinity ? (got === Infinity || got === 'all' || (typeof got === 'number' && got >= 999)) : got === want);

// ---------------------------------------------------------------------------
// puppeteer resolution
// ---------------------------------------------------------------------------
function resolvePuppeteer() {
  const candidates = [];
  if (process.env.PUPPETEER_PATH) candidates.push(process.env.PUPPETEER_PATH);
  const npx = path.join(os.homedir(), '.npm', '_npx');
  try {
    for (const dir of fs.readdirSync(npx)) {
      const p = path.join(npx, dir, 'node_modules', 'puppeteer');
      if (fs.existsSync(path.join(p, 'package.json'))) candidates.push(p);
    }
  } catch (_) { /* no npx cache */ }
  for (const c of candidates) {
    try { return { puppeteer: require(c), from: c }; } catch (e) { console.log(`note: puppeteer at ${c} failed to load: ${e.message}`); }
  }
  try { return { puppeteer: require('puppeteer'), from: 'require("puppeteer")' }; } catch (_) { /* fallthrough */ }
  return null;
}

// ---------------------------------------------------------------------------
// tiny test harness
// ---------------------------------------------------------------------------
const results = [];
function check(name, cond, detail) {
  const ok = !!cond;
  results.push({ name, ok, detail });
  let line = `${ok ? 'PASS' : 'FAIL'} ${name}`;
  if (!ok && detail !== undefined) line += ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(line);
  return ok;
}
function info(msg) { console.log(`     ${msg}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, timeout = 3000, interval = 40) {
  const start = Date.now();
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() - start >= timeout) return last;
    await sleep(interval);
  }
}
function elapsed() { return ((Date.now() - T0) / 1000).toFixed(1); }
const hitsFor = (max, dmg) => Math.ceil(max / dmg);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// addendum A1 formula from a live rect (text-ish elements: mult 0.6 and cap 60)
function specMaxHp(w, h, mult, textish) {
  const base = 20 + 0.35 * Math.sqrt(Math.max(1, w * h));
  return textish ? clamp(Math.min(60, Math.round(base * 0.6)), 10, 400) : clamp(Math.round(base * mult), 10, 400);
}

// ---------------------------------------------------------------------------
// static server: "/" and "/strict" → fixture.html (CSP header only on /strict), /fixture.css, /fixture.js
// ---------------------------------------------------------------------------
function startServer() {
  const files = {
    '/fixture.css': { file: path.join(TEST_DIR, 'fixture.css'), type: 'text/css; charset=utf-8' },
    '/fixture.js': { file: path.join(TEST_DIR, 'fixture.js'), type: 'text/javascript; charset=utf-8' },
  };
  const html = fs.readFileSync(path.join(TEST_DIR, 'fixture.html'));
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    const headers = { 'Cache-Control': 'no-store' };
    if (url === '/' || url === '/strict') {
      headers['Content-Type'] = 'text/html; charset=utf-8';
      if (url === '/strict') headers['Content-Security-Policy'] = STRICT_CSP;
      res.writeHead(200, headers);
      res.end(html);
      return;
    }
    if (files[url]) {
      headers['Content-Type'] = files[url].type;
      res.writeHead(200, headers);
      res.end(fs.readFileSync(files[url].file));
      return;
    }
    if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

// ---------------------------------------------------------------------------
// page helpers (suites A/B — content script lives in the main world here)
// ---------------------------------------------------------------------------
// `msgs` = parsed _locales/<lang>/messages.json ({} → content.js falls back to its hard-coded Korean strings)
const chromeShim = (msgs) => `(() => {
  const store = {};
  const messages = [];
  const MSGS = ${JSON.stringify(msgs || {})};
  const shim = {
    runtime: {
      id: 'test',
      lastError: undefined,
      sendMessage: (m) => { messages.push(m); return Promise.resolve(undefined); },
      onMessage: { addListener() {}, removeListener() {} },
    },
    storage: {
      sync: {
        get: (keys) => {
          const out = {};
          const list = keys == null ? Object.keys(store) : (Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys)));
          for (const k of list) if (k in store) out[k] = store[k];
          if (keys && typeof keys === 'object' && !Array.isArray(keys)) for (const k of Object.keys(keys)) if (!(k in out)) out[k] = keys[k];
          return Promise.resolve(out);
        },
        set: (obj) => { Object.assign(store, obj); return Promise.resolve(); },
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
    i18n: { getMessage: (k) => (MSGS[k] && MSGS[k].message) || '' },
  };
  window.__crsMessages = messages;
  window.__crsStore = store;
  try { Object.defineProperty(window, 'chrome', { value: shim, configurable: true, writable: true }); }
  catch (e) { window.chrome = shim; }
  return 'shim';
})()`;
const CHROME_SHIM = chromeShim({});
// Timer ledger (G8): installed BEFORE content.js, which binds setTimeout/clearTimeout once at load, so every
// later() timer is tracked; window.__crsPending.size === live content-script timers (0 after deactivate).
const TIMER_LEDGER = `(() => {
  const pending = new Set();
  const st = window.setTimeout, ct = window.clearTimeout;
  window.setTimeout = function (fn, ms, ...args) {
    let id = 0;
    const wrapped = typeof fn === 'function' ? function () { pending.delete(id); return fn.apply(this, arguments); } : fn;
    id = st.call(window, wrapped, ms, ...args);
    pending.add(id);
    return id;
  };
  window.clearTimeout = function (id) { pending.delete(id); return ct.call(window, id); };
  // intervals never self-clear, so a leaked one stays in the ledger until clearInterval (hard rule: none may outlive deactivate)
  const si = window.setInterval, ci = window.clearInterval;
  window.setInterval = function (fn, ms, ...args) { const id = si.call(window, fn, ms, ...args); pending.add(id); return id; };
  window.clearInterval = function (id) { pending.delete(id); return ci.call(window, id); };
  // RAF ledger: content.js binds requestAnimationFrame / cancelAnimationFrame once at load, so every frame it
  // schedules passes through here; a self-rescheduling loop that survived deactivate shows up as a live id.
  const pendingRaf = new Set();
  const rf = window.requestAnimationFrame, cf = window.cancelAnimationFrame;
  window.requestAnimationFrame = function (fn) {
    let id = 0;
    const wrapped = typeof fn === 'function' ? function () { pendingRaf.delete(id); return fn.apply(this, arguments); } : fn;
    id = rf.call(window, wrapped);
    pendingRaf.add(id);
    return id;
  };
  window.cancelAnimationFrame = function (id) { pendingRaf.delete(id); return cf.call(window, id); };
  window.__crsPending = pending;
  window.__crsPendingRaf = pendingRaf;
  // settleRaf() waits on a frame itself; it must use the UNWRAPPED rAF, or the harness's own probe frames would
  // show up in __crsPendingRaf and be read as a content-script loop that outlived deactivate.
  window.__crsRawRaf = (fn) => rf.call(window, fn);
  window.__crsRawCaf = (id) => cf.call(window, id);
  window.__crsRawTimeout = (fn, ms) => st.call(window, fn, ms);
  window.__crsRawClear = (id) => ct.call(window, id);
  // Headless Chrome parks its BeginFrame source once nothing is asking for frames, and a freshly scheduled rAF does
  // not reliably restart it — frames then stop for the rest of the session, the content script's one-shot rAFs
  // (hover, aura, HUD) never run, and every frame-dependent wait below blocks. One heartbeat on the UNWRAPPED rAF
  // keeps the source alive for the whole suite. It is invisible to the ledger, so "zero live animation frames"
  // keeps meaning zero CONTENT-SCRIPT frames.
  const beat = () => { window.__crsFrames = (window.__crsFrames || 0) + 1; rf.call(window, beat); };
  rf.call(window, beat);
  return 'ledger';
})()`;
const EN_MESSAGES = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', 'en', 'messages.json'), 'utf8'));
// Chrome on GitHub-hosted Ubuntu runners cannot use its sandbox (unprivileged user namespaces are
// disabled by AppArmor), and /dev/shm is small in containers. Both flags are CI-only so local runs keep
// the sandbox. CRS_TIME_BUDGET_MS lets a slower runner have a longer, still-explicit budget.
const CI = !!process.env.CI;
const BASE_ARGS = ['--no-first-run', '--no-default-browser-check']
  .concat(CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []);
// v1.4 raised this from 100 s. SPEC-combat-v2 adds assertions whose cost is wall-clock by definition and
// cannot be polled away: a lock-on runs a fixed 3.0 s (§7.5, §7.6, §7.10), a repair beam 1.5 s plus a 600 ms
// piece return (§7.7, §7.8), the debris lifetime is 6 s (§9.4.1) and `debrisLifeMs = 0` has to be watched
// doing nothing for a full 10 s (§9.4.3). Those sleeps alone are over a minute. A full green run measures
// ~173 s locally, so the budget is set with enough headroom for a loaded or CI runner to stay honest while
// still catching a suite that has genuinely run away. CRS_TIME_BUDGET_MS overrides it.
const TIME_BUDGET_MS = Number(process.env.CRS_TIME_BUDGET_MS || 240000);
// Iteration speed knob. `CRS_SUITES=A node test/e2e.js` (or --suite=A, comma-separated) runs only the
// named suites, so an agent fixing suite A pays ~165 s instead of the full ~173 s per attempt. The full
// suite is still what gates a commit and what CI runs; a partial run says so in its summary and refuses to
// report the runtime check, so a green partial run can never be mistaken for a green full run.
const SUITE_ARG = (process.argv.find((a) => a.startsWith('--suite=')) || '').slice(8);
const SUITES = String(process.env.CRS_SUITES || SUITE_ARG || 'ABC').toUpperCase();
const PARTIAL = SUITES !== 'ABC';
const WANT = (id) => SUITES.includes(id);


function hookPage(page) {
  const log = { pageErrors: [], consoleErrors: [] };
  page.on('pageerror', (e) => log.pageErrors.push(String(e && e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') log.consoleErrors.push(m.text()); });
  return log;
}

async function installViolationCounter(page) {
  // window-level listener (A29) installed before any page script runs, so load-time violations count too
  await page.evaluateOnNewDocument(() => {
    window.__cspViolations = [];
    window.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push(`${e.violatedDirective} blocked=${e.blockedURI || ''} sample=${(e.sample || '').slice(0, 80)}`);
    });
  });
}
const violations = (page) => page.evaluate(() => window.__cspViolations || []);

// Let every already-queued animation frame run, so __crsPendingRaf only holds frames that were (re)scheduled after.
// Two details, both learned the hard way:
//   * the probe frame goes through __crsRawRaf, so it never lands in the ledger it is meant to measure;
//   * it is raced against a 400 ms timer. Headless Chrome parks its BeginFrame source when no page is asking for
//     frames, and a freshly scheduled rAF does not always restart it — an unbounded wait then blocks until the CDP
//     protocol timeout (180 s each, twice) and silently eats the suite's whole time budget.
async function settleRaf(page) {
  for (let i = 0; i < 2; i++) {
    try {
      await page.evaluate(() => new Promise((r) => {
        const raf = window.__crsRawRaf || requestAnimationFrame;
        const to = window.__crsRawTimeout || setTimeout, clr = window.__crsRawClear || clearTimeout;
        let done = false, id = 0;
        const fin = () => { if (done) return; done = true; clr(id); r(null); };
        raf(fin);
        id = to(fin, 400);
      }));
    } catch (e) { /* ignore */ }
  }
}

async function injectCss(page, cssText) {
  const client = await page.createCDPSession();
  await client.send('DOM.enable');
  await client.send('CSS.enable');
  const { frameTree } = await client.send('Page.getFrameTree');
  const { styleSheetId } = await client.send('CSS.createStyleSheet', { frameId: frameTree.frame.id });
  await client.send('CSS.setStyleSheetText', { styleSheetId, text: cssText });
  return client;
}

const api = {
  stats: (page) => page.evaluate(() => window.__crashScreen.stats()),
  active: (page) => page.evaluate(() => !!(window.__crashScreen && window.__crashScreen.active)),
  restore: (page) => page.evaluate(() => window.__crashScreen.restore()),
  setMode: (page, mode) => page.evaluate((m) => window.__crashScreen.setMode(m), mode),
  mode: (page) => page.evaluate(() => window.__crashScreen.mode),
  setWeapon: (page, id) => page.evaluate((w) => window.__crashScreen.setWeapon(w), id),
  weapon: (page) => page.evaluate(() => window.__crashScreen.weapon),
  weapons: (page) => page.evaluate(() => window.__crashScreen.weapons()),
  // v1.3 §1: the power multiplier is gone — no setPower / power wrappers any more.
  slash: (page, x1, y1, x2, y2) => page.evaluate((a, b, c, d) => window.__crashScreen.slash(a, b, c, d), x1, y1, x2, y2),
  // merge `patch` into api.debug (a plain object per A12) and return a copy of the whole flag set (A11; functions dropped)
  debug: (page, patch) => page.evaluate((p) => { const d = window.__crashScreen.debug; Object.assign(d, p || {}); const out = {}; for (const k of Object.keys(d)) if (typeof d[k] !== 'function') out[k] = d[k]; return out; }, patch || {}),
  hpOf: (page, sel) => page.evaluate((s) => { const r = window.__crashScreen.hpOf(document.querySelector(s)); return { hp: r.hp, max: r.max }; }, sel),
  store: (page) => page.evaluate(() => Object.assign({}, window.__crsStore || {})),
  pending: (page) => page.evaluate(() => (window.__crsPending ? window.__crsPending.size : -1)),
  pendingRaf: (page) => page.evaluate(() => (window.__crsPendingRaf ? window.__crsPendingRaf.size : -1)),
  count: (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel),
  has: (page, sel) => page.evaluate((s) => !!document.querySelector(s), sel),
  broken: (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!(el && el.hasAttribute('data-crs-broken')); }, sel),
  visibility: (page, sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).visibility, sel),
  dmgTexts: (page) => page.evaluate(() => [...document.querySelectorAll('.crs-dmg')].map((n) => (n.textContent || '').trim())),
  fx: (page) => page.evaluate(() => {
    const c = (s) => document.querySelectorAll(s).length;
    return { dmg: c('.crs-dmg'), hit: c('.crs-hit'), fire: c('.crs-fire'), rocket: c('.crs-rocket'), preview: c('.crs-slash-preview'), slashFx: c('.crs-slash-fx'), ring: c('.crs-fx-ring'), ringXl: c('.crs-fx-ring.crs-fx-ring-xl'), debris: c('.crs-debris'),
      orb: c('.crs-orb'), beam: c('.crs-beam'), warn: c('.crs-warn'), hostile: c('.crs-hostile'), tracer: c('.crs-tracer'), scope: c('.crs-scope'), vignette: c('.crs-vignette') };
  }),
  // scroll the element to the vertical centre of the viewport and return its viewport rect
  rect: (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }, sel),
  rectNoScroll: (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }, sel),
  // hover box: label text (`TAG hp/max`), plus the A11 health bar (fill/track width ratio and fill colour)
  targetBox: (page) => page.evaluate(() => {
    const box = document.querySelector('.crs-target');
    if (!box) return null;
    const cs = getComputedStyle(box);
    const r = box.getBoundingClientRect();
    const label = box.querySelector('.crs-target-label') || box.querySelector('span');
    const bar = box.querySelector('.crs-target-bar');
    const fill = box.querySelector('.crs-target-fill');
    let ratio = null, fillColor = null, barW = null;
    if (bar && fill) {
      barW = parseFloat(getComputedStyle(bar).width);
      const fw = parseFloat(getComputedStyle(fill).width);
      ratio = barW > 0 ? fw / barW : null;
      fillColor = getComputedStyle(fill).backgroundColor;
    }
    return { display: cs.display, visibility: cs.visibility, left: r.left, top: r.top, width: r.width, height: r.height, label: label ? label.textContent.trim() : '', hasBar: !!(bar && fill), barW, ratio, fillColor };
  }),
  // a HUD button whose textContent OR title / aria-label includes `text` (A6: compact grid buttons carry the name in `title`)
  hudButtonRect: (page, text) => page.evaluate((t) => {
    const host = document.querySelector('crs-hud, .crs-hud-host');
    if (!host || !host.shadowRoot) return null;
    const btn = [...host.shadowRoot.querySelectorAll('button')].find((b) => (b.textContent || '').includes(t) || (b.title || '').includes(t) || (b.getAttribute('aria-label') || '').includes(t));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, width: r.width, height: r.height };
  }, text),
  hudWeaponBtnRect: (page, id) => page.evaluate((w) => {
    const host = document.querySelector('crs-hud, .crs-hud-host');
    const btn = host && host.shadowRoot ? host.shadowRoot.querySelector(`button[data-weapon="${w}"]`) : null;
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, width: r.width, height: r.height };
  }, id),
  // ---- v1.2 (SPEC-v3 A11): shadow-root nodes, api surface, debug hooks ----
  // `document.querySelector("crs-hud").shadowRoot.querySelector(sel)` → text / visibility / rect, or null
  hudQ: (page, sel) => page.evaluate((s) => {
    const host = document.querySelector('crs-hud, .crs-hud-host');
    const el = host && host.shadowRoot ? host.shadowRoot.querySelector(s) : null;
    if (!el) return null;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05 && r.width > 0 && r.height > 0 && !el.hidden;
    return { text: (el.textContent || '').replace(/\s+/g, ' ').trim(), visible, display: cs.display, visibility: cs.visibility, opacity: cs.opacity, left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom, vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight };
  }, sel),
  // the "R 재장전" / "R Reload" prompt inside .crs-ammo: the deepest element carrying that text, with its own visibility
  ammoPrompt: (page) => page.evaluate(() => {
    const host = document.querySelector('crs-hud, .crs-hud-host');
    const ammo = host && host.shadowRoot ? host.shadowRoot.querySelector('.crs-ammo') : null;
    if (!ammo) return null;
    const re = /재장전|Reload/;
    const all = [ammo, ...ammo.querySelectorAll('*')].filter((el) => re.test(el.textContent || ''));
    const el = all.length ? all[all.length - 1] : null;
    if (!el) return { text: (ammo.textContent || '').trim(), visible: false, found: false };
    let visible = true;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) <= 0.05 || n.hidden) { visible = false; break; }
    }
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) visible = false;
    return { text: (el.textContent || '').replace(/\s+/g, ' ').trim(), visible, found: true, opacity: getComputedStyle(el).opacity };
  }),
  // api methods that may not exist yet: a missing method yields a 'missing:<name>' string instead of a thrown error
  call: (page, name, ...args) => page.evaluate((n, a) => {
    const api = window.__crashScreen; const f = api && api[n];
    if (typeof f !== 'function') return 'missing:' + n;
    try { return f.apply(api, a); } catch (e) { return 'threw:' + String(e && e.message || e); }
  }, name, args),
  ammo: (page) => api.call(page, 'ammo'),
  reload: (page) => api.call(page, 'reload'),
  scope: (page, on) => api.call(page, 'scope', on),
  loadout: (page) => api.call(page, 'loadout'),
  setLoadout: (page, ids) => api.call(page, 'setLoadout', ids),
  applyPreset: (page, name) => api.call(page, 'applyPreset', name),
  setCombat: (page, on) => api.call(page, 'setCombat', on),
  player: (page) => api.call(page, 'player'),
  combat: (page) => page.evaluate(() => window.__crashScreen.combat),
  smashAt: (page, x, y, w) => page.evaluate((a, b, c) => window.__crashScreen.smashAt(a, b, c === null ? undefined : c), x, y, w === undefined ? null : w),
  dbgCall: (page, name, ...args) => page.evaluate((n, a) => {
    const d = window.__crashScreen.debug; const f = d && d[n];
    if (typeof f !== 'function') return 'missing:debug.' + n;
    try { return f.apply(d, a); } catch (e) { return 'threw:' + String(e && e.message || e); }
  }, name, args),
  forceAttack: (page, sel) => page.evaluate((s) => {
    const d = window.__crashScreen.debug;
    if (!d || typeof d.forceAttack !== 'function') return 'missing:debug.forceAttack';
    try { return d.forceAttack(document.querySelector(s)); } catch (e) { return 'threw:' + String(e && e.message || e); }
  }, sel),
  // SPEC-combat-v2 §4 moves the T3 laser sweep onto the boss's 3rd stage, so a plain forceAttack on a healthy
  // T3 element now draws a lock frame (§7.10 asserts exactly that). The sweep itself is unchanged and reachable
  // through debug.forceLaser, which is how the v1.2/v1.3 laser behaviour below is still exercised verbatim.
  forceLaser: (page, sel) => page.evaluate((s) => {
    const d = window.__crashScreen.debug;
    if (!d || typeof d.forceLaser !== 'function') return 'missing:debug.forceLaser';
    try { return d.forceLaser(document.querySelector(s)); } catch (e) { return 'threw:' + String(e && e.message || e); }
  }, sel),
  setPlayerPos: (page, x, y) => api.dbgCall(page, 'setPlayerPos', x, y),
  setPlayerHp: (page, n) => api.dbgCall(page, 'setPlayerHp', n),
  bodyInline: (page) => page.evaluate(() => { const st = document.body.style; return { transform: st.transform, transformOrigin: st.transformOrigin, willChange: st.willChange, priority: st.getPropertyPriority('transform') }; }),
  seen: (page) => page.evaluate(() => Object.assign({}, window.__crsSeen || {})),
  seenReset: (page) => page.evaluate(() => { if (window.__crsSeenReset) window.__crsSeenReset(); }),
  // loadout HUD: data-weapon ids in grid order, slot badges, titles, preset buttons (aria-pressed), custom tag
  hudLoadout: (page) => page.evaluate(() => {
    const host = document.querySelector('crs-hud, .crs-hud-host'); const sh = host && host.shadowRoot;
    if (!sh) return null;
    const btns = [...sh.querySelectorAll('button[data-weapon]')];
    const presets = [...sh.querySelectorAll('.presets button')];
    return {
      ids: btns.map((b) => b.getAttribute('data-weapon')),
      badges: btns.map((b) => { const g = b.querySelector('.badge'); return g ? (g.textContent || '').trim() : null; }),
      titles: btns.map((b) => b.title || b.getAttribute('aria-label') || ''),
      presetCount: presets.length,
      pressed: presets.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => (b.textContent || '').trim()),
      customTag: /사용자 지정|Custom/.test(sh.textContent || ''),
      cur: ((sh.querySelector('.cur') || {}).textContent || '').trim(),
    };
  }),
  // ── v1.5: weapon art / viewmodel / pierce test helpers (SPEC-weapons §1-§4, SPEC-combat-v2 §10.3/§10.6) ──
  // window.__crashScreen.weaponArt(id, size) → an <svg>; a DOM node cannot cross page.evaluate's JSON
  // serialization boundary, so this extracts just what the assertions need (tag, child/path counts, a
  // signature string of every path's "d" attribute so two weapons can be compared for distinctness).
  weaponArtInfo: (page, id, size) => page.evaluate((i, s) => {
    const a = window.__crashScreen;
    if (!a || typeof a.weaponArt !== 'function') return 'missing:weaponArt';
    let node;
    try { node = a.weaponArt(i, s); } catch (e) { return 'threw:' + String(e && e.message || e); }
    if (!node || typeof node !== 'object' || typeof node.tagName !== 'string') return { ok: false, got: String(node) };
    const tag = node.tagName.toLowerCase();
    if (tag !== 'svg') return { ok: false, tag };
    const paths = [...node.querySelectorAll('path')].map((p) => p.getAttribute('d') || '');
    return { ok: true, tag, childCount: node.children.length, viewBox: node.getAttribute('viewBox') || '', pathCount: paths.length, pathSig: paths.join('|') };
  }, id, size),
  // `.crs-viewmodel` presence/shape, plus its live computed transform decomposed into translateX/Y (px) and
  // rotation (deg) via DOMMatrix — robust to whatever transform functions the implementation composes
  // (translate + rotate, a single matrix(), etc.), since items 4/5/14 only care about the net displacement.
  viewmodelXform: (page) => page.evaluate(() => {
    const el = document.querySelector('.crs-viewmodel');
    if (!el) return null;
    const cs = getComputedStyle(el);
    let tx = 0, ty = 0, angle = 0;
    try { const m = new DOMMatrix(cs.transform); tx = m.m41; ty = m.m42; angle = Math.atan2(m.b, m.a) * 180 / Math.PI; } catch (e) { /* identity */ }
    const svgCount = el.querySelectorAll('svg').length;
    const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05 && !el.hidden;
    return { raw: cs.transform, tx, ty, angle, opacity: parseFloat(cs.opacity), visibility: cs.visibility, hidden: !!el.hidden, visible, svgCount, dataCrs: el.hasAttribute('data-crs'), count: document.querySelectorAll('.crs-viewmodel').length };
  }),
  // currently-running Web Animations API animations (document.getAnimations() only counts ones whose target
  // is still in the document — once deactivate() removes the glass root, any WAAPI animation on it drops
  // out on its own, independent of the setTimeout/RAF ledger).
  animCount: (page) => page.evaluate(() => (document.getAnimations ? document.getAnimations().length : -1)),
};

// Click until the element reports data-crs-broken (hp-aware), at most `max` clicks.
async function clickUntilBroken(page, sel, x, y, max = 3) {
  return smashUntil(page, () => api.broken(page, sel), x, y, max);
}
// Same loop with a predicate (shadow-root targets etc.).
async function smashUntil(page, isBroken, x, y, max = 3) {
  for (let i = 0; i < max; i++) {
    await page.mouse.click(x, y);
    const ok = await poll(() => isBroken(), 400);
    if (ok) return i + 1;
  }
  return 0;
}
// Damage numbers from api.weapons() (fallback: the A2 table) keyed by id.
async function weaponTable(page) {
  let list = [];
  try { list = await api.weapons(page); } catch (_) { list = []; }
  const byId = {};
  for (const w of Array.isArray(list) ? list : []) if (w && w.id) byId[w.id] = w;
  const dmg = (id) => (byId[id] && typeof byId[id].damage === 'number' ? byId[id].damage : SPEC_DMG[id]);
  return { list: Array.isArray(list) ? list : [], byId, dmg };
}
// Fresh target (restore between checks), then a click with the given weapon; resolves once hp dropped.
async function hitFresh(page, weaponId, pt, sel) {
  await api.restore(page);
  await sleep(60);
  await api.setWeapon(page, weaponId);
  const before = await api.hpOf(page, sel);
  await page.mouse.click(pt.x, pt.y);
  const after = await poll(async () => { const r = await api.hpOf(page, sel); return r.hp < before.max ? r : null; }, 600, 20);
  return { max: before.max, hp: (after || await api.hpOf(page, sel)).hp, broken: await api.broken(page, sel) };
}
// Scroll #arena into view and return the A15 hold/click point (top-left padding zone).
async function arenaPt(page) {
  const r = await api.rect(page, '#arena');
  return { x: r.left + 40, y: r.top + 40 };
}
// Hold the primary button at `pt` for `ms`; `sampler(elapsedMs)` runs every ~20 ms while held.
async function holdAt(page, pt, ms, sampler) {
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  const t = Date.now();
  const samples = [];
  while (Date.now() - t < ms) {
    if (sampler) samples.push(await sampler(Date.now() - t));
    await sleep(20);
  }
  await page.mouse.up();
  return samples;
}

// ---------------------------------------------------------------------------
// Suite A — content harness
// ---------------------------------------------------------------------------
async function suiteA(browser, origin, contentCss, contentJs) {
  console.log('\n=== Suite A: content harness (/) ===');
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const log = hookPage(page);
  await installViolationCounter(page);
  await page.goto(`${origin}/`, { waitUntil: 'load' });

  // fixture sanity (12.8 / A28 / A15)
  const fx = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('body *')].filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'inline' || cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).length;
    const big = document.getElementById('big-card').getBoundingClientRect();
    const small = document.getElementById('small-card').getBoundingClientRect();
    const words = document.getElementById('long-para').textContent.trim().split(/\s+/).length;
    const spot = document.getElementById('bomb-spot').getBoundingClientRect();
    const leaves = [...document.querySelectorAll('#cluster .leaf')].filter((p) => {
      const r = p.getBoundingClientRect();
      return Math.hypot(r.left + r.width / 2 - (spot.left + spot.width / 2), r.top + r.height / 2 - (spot.top + spot.height / 2)) <= 120;
    }).length;
    const stackX = ['#stack-1', '#stack-2', '#stack-3'].map((s) => document.querySelector(s).getBoundingClientRect().left);
    const arenaEl = document.getElementById('arena');
    const arena = arenaEl ? arenaEl.getBoundingClientRect() : null;
    const overlaps = arena ? [...document.querySelectorAll('main > *')].filter((el) => {
      if (el === arenaEl) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.left < arena.right && r.right > arena.left && r.top < arena.bottom && r.bottom > arena.top;
    }).map((el) => el.tagName + (el.id ? '#' + el.id : '')) : ['no #arena'];
    // v1.2: section#boss (T3 ≥ 1000 × 420) after #arena, #figure (T1 window) and #demo-img (240 × 140) unchanged
    const bossEl = document.getElementById('boss');
    const boss = bossEl ? bossEl.getBoundingClientRect() : null;
    const bossOverlaps = boss ? [...document.querySelectorAll('main > *')].filter((el) => {
      if (el === bossEl) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.left < boss.right && r.right > boss.left && r.top < boss.bottom && r.bottom > boss.top;
    }).map((el) => el.tagName + (el.id ? '#' + el.id : '')) : ['no #boss'];
    // v1.5: a pierce/depth fixture section was appended between #boss and footer#nav (shared-file rule:
    // additions go at the end, before the footer), so #boss's nextElementSibling is no longer literally
    // footer#nav — only that nav still comes somewhere AFTER boss in document order, which is all this
    // check ever meant to guarantee (boss is the last of the "weapon test arenas", nav is the page footer).
    const navEl = document.getElementById('nav');
    const bossAfterArena = !!(arenaEl && bossEl && navEl && (arenaEl.compareDocumentPosition(bossEl) & Node.DOCUMENT_POSITION_FOLLOWING) && boss.top >= arena.bottom && (bossEl.compareDocumentPosition(navEl) & Node.DOCUMENT_POSITION_FOLLOWING));
    const figR = document.getElementById('figure').getBoundingClientRect();
    const imgR = document.getElementById('demo-img').getBoundingClientRect();
    return {
      vis, bigW: big.width, bigH: big.height, bigArea: big.width * big.height, smallArea: small.width * small.height, words, leaves,
      stackSameX: stackX.every((x) => Math.abs(x - stackX[0]) < 1),
      sticky: getComputedStyle(document.getElementById('site-header')).position === 'sticky',
      btnClicks: window.__btnClicks, inputVal: document.getElementById('text-input').value.length,
      arenaW: arena ? arena.width : 0, arenaH: arena ? arena.height : 0, arenaCaption: !!(arenaEl && arenaEl.querySelector('.arena-caption')), overlaps,
      bossW: boss ? boss.width : 0, bossH: boss ? boss.height : 0, bossCaption: !!(bossEl && bossEl.querySelector('.boss-caption')), bossOverlaps, bossAfterArena,
      figArea: figR.width * figR.height, imgW: imgR.width, imgH: imgR.height, imgInFigure: !!document.querySelector('figure#figure > img#demo-img'),
    };
  });
  check('A.fixture: ≥ 25 visible block elements', fx.vis >= 25, fx);
  check('A.fixture: large card ≥ 500×320 and area ≥ 160 000', fx.bigW >= 500 && fx.bigH >= 320 && fx.bigArea >= 160000, fx);
  check('A.fixture: small card area < 150 000', fx.smallArea < 150000, fx);
  check('A.fixture: long paragraph ≥ 25 words', fx.words >= 25, fx.words);
  check('A.fixture: ≥ 3 text leaves within 120 px of #bomb-spot', fx.leaves >= 3, fx.leaves);
  check('A.fixture: stacked blocks share x, sticky header, prefilled input, fixture.js ran', fx.stackSameX && fx.sticky && fx.inputVal > 0 && fx.btnClicks === 0, fx);
  check('A.fixture: section#arena ≥ 900×240 with a caption, overlapping no other target', fx.arenaW >= 900 && fx.arenaH >= 240 && fx.arenaCaption && fx.overlaps.length === 0, { w: fx.arenaW, h: fx.arenaH, overlaps: fx.overlaps });
  check('A.fixture: section#boss ≥ 1000×420 with a caption, after #arena and before footer#nav, overlapping no other target', fx.bossW >= 1000 && fx.bossH >= 420 && fx.bossCaption && fx.bossAfterArena && fx.bossOverlaps.length === 0, { w: fx.bossW, h: fx.bossH, after: fx.bossAfterArena, overlaps: fx.bossOverlaps });
  check('A.fixture: #boss area in the T3 window (> 400 000 and ≤ 0.7 × viewport), #figure in the T1 window (40 000–150 000)', fx.bossW * fx.bossH > 400000 && fx.bossW * fx.bossH <= 0.7 * VIEWPORT.width * VIEWPORT.height && fx.figArea >= 40000 && fx.figArea < 150000, { boss: fx.bossW * fx.bossH, fig: fx.figArea });
  check('A.fixture: #demo-img still 240×140 inside figure#figure', fx.imgW === 240 && fx.imgH === 140 && fx.imgInFigure, { w: fx.imgW, h: fx.imgH, inFigure: fx.imgInFigure });

  // injection (A29)
  const client = await injectCss(page, contentCss);
  check('A.inject: timer ledger installed before content.js', (await page.evaluate(TIMER_LEDGER)) === 'ledger');
  await page.evaluate(CHROME_SHIM);
  const r1 = await page.evaluate(contentJs);
  check('A.inject: content.js completion value is "on"', r1 === 'on', r1);
  check('A.inject: window.__crashScreen.active === true', await api.active(page));
  check('A.inject: .crs-canvas present', await api.has(page, '.crs-canvas'));
  check('A.inject: HUD host present with open shadow root', await page.evaluate(() => {
    const h = document.querySelector('crs-hud[data-crs], .crs-hud-host[data-crs]');
    return !!(h && h.shadowRoot);
  }));
  check('A.inject: crash:state active:true message sent', await page.evaluate(() => (window.__crsMessages || []).some((m) => m && m.type === 'crash:state' && m.active === true)));
  // v1.1 / v1.2 setup (A16 / A13): deterministic damage, no cooldowns, no spread, no hostile attacks, fast reloads.
  // v1.5: distance falloff (SPEC-weapons §3) is live by default and deliberately NOT coupled to noSpread —
  // it has its own switch, debug.noFalloff — so every exact-damage assertion before the v1.5 block (which
  // predates falloff and expects the flat, unreduced numbers) needs it off too; only SPEC-weapons §6 item 11
  // and the SPEC-combat-v2 §10.6 pierce block turn it back on locally to measure the real formula.
  let dbg = null;
  try { dbg = await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: false, noFalloff: true }); } catch (e) { dbg = String(e && e.message || e); }
  check('A.inject: api.debug noCrit / noCooldown / noSpread / noAttacks / fastReload / noFalloff set for the suite', dbg && dbg.noCrit === true && dbg.noCooldown === true && dbg.noSpread === true && dbg.noAttacks === true && dbg.fastReload === true && dbg.noFalloff === true, dbg);

  // --- weapon table / HUD contract (§5, §6, A2) -----------------------------------------------
  const W = await weaponTable(page);
  const DMG = W.dmg;
  check('A.weapons: api.weapons() lists the 10 ids in default-loadout order with slot 1–10 and keys 1–9, 0', W.list.map((w) => w.id).join(',') === WEAPON_IDS.join(',') && W.list.every((w, i) => String(w.key) === KEYS[i] && w.slot === i + 1), W.list.map((w) => `${w && w.id}:${w && w.slot}:${w && w.key}`));
  check('A.weapons: damages match the A1/A2 table (65/25/22/200/130/60/190/260/15)', Object.keys(SPEC_DMG).every((id) => W.byId[id] && W.byId[id].damage === SPEC_DMG[id]), Object.keys(SPEC_DMG).map((id) => `${id}=${W.byId[id] && W.byId[id].damage}`));
  check('A.weapons: cooldownMs hammer 0 / pistol 0 / sniper 600 / axe 550 / bomb 700 / rocket 1200 / collapse 2000; smg & flame are hold weapons', Object.keys(SPEC_COOLDOWN).every((id) => W.byId[id] && W.byId[id].cooldownMs === SPEC_COOLDOWN[id]) && !!(W.byId.smg && W.byId.smg.hold) && !!(W.byId.flame && W.byId.flame.hold) && WEAPON_IDS.filter((id) => id !== 'smg' && id !== 'flame').every((id) => !(W.byId[id] && W.byId[id].hold)), Object.keys(SPEC_COOLDOWN).map((id) => `${id}=${W.byId[id] && W.byId[id].cooldownMs}`));
  check('A.weapons: mag / reloadMs per weapon (pistol 12/900, smg 30/1400, sniper 5/2000, bomb 3/1800, rocket 2/1500, flame 100/2500, collapse 1/5000; melee null/null)', Object.keys(SPEC_MAG).every((id) => W.byId[id] && W.byId[id].mag === SPEC_MAG[id][0] && W.byId[id].reloadMs === SPEC_MAG[id][1]), Object.keys(SPEC_MAG).map((id) => `${id}=${W.byId[id] && W.byId[id].mag}/${W.byId[id] && W.byId[id].reloadMs}`));
  check('A.weapons: sniper { kind: "gun", spread: 25, scope: true, emoji 🎯, name 저격총 }; every other weapon spread null / scope false', !!W.byId.sniper && W.byId.sniper.kind === 'gun' && W.byId.sniper.spread === 25 && W.byId.sniper.scope === true && W.byId.sniper.emoji === '🎯' && W.byId.sniper.name === '저격총' && WEAPON_IDS.filter((id) => id !== 'sniper').every((id) => W.byId[id] && W.byId[id].spread === null && W.byId[id].scope === false), W.byId.sniper);
  const hud = await page.evaluate(() => {
    const h = document.querySelector('crs-hud, .crs-hud-host');
    if (!h || !h.shadowRoot) return null;
    const sh = h.shadowRoot;
    const btns = [...sh.querySelectorAll('button[data-weapon]')];
    const cols = getComputedStyle(sh.querySelector('.grid') || sh.querySelector('button[data-weapon]').parentElement).gridTemplateColumns.split(/\s+/).filter(Boolean).length;
    return {
      ids: btns.map((b) => b.getAttribute('data-weapon')),
      pressed: btns.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('data-weapon')),
      // v1.3 §1: the power row (-/+ buttons) is gone — no .crs-power-down / .crs-power-up should exist
      noPowerButtons: !sh.querySelector('.crs-power-down') && !sh.querySelector('.crs-power-up'),
      badges: btns.map((b) => { const g = b.querySelector('.badge'); return g ? (g.textContent || '').trim() : null; }),
      cols,
      // compact grid (A6): names live in the button title / aria-label, the readout and the panel text
      text: (sh.textContent || '') + ' ' + btns.map((b) => (b.title || '') + ' ' + (b.getAttribute('aria-label') || '')).join(' '),
    };
  });
  check('A.hud: 10 weapon buttons carry data-weapon ids in default-loadout order, hammer aria-pressed', !!hud && hud.ids.join(',') === WEAPON_IDS.join(',') && hud.pressed.join(',') === 'hammer', hud && { ids: hud.ids, pressed: hud.pressed });
  check('A.hud: grid is 2 × 5 (5 columns) and every button shows its slot badge 1…9, 0', !!hud && hud.cols === 5 && hud.badges.join(',') === KEYS.join(','), hud && { cols: hud.cols, badges: hud.badges });
  check('A.hud: Korean labels (망치 · 권총 · 기관총 · 저격총 · 도끼 · 검 · 폭탄 · 로켓 · 화염 · 붕괴 · 피해 · 로드아웃 · 전투) present (text or button titles)', !!hud && ['망치', '권총', '기관총', '저격총', '도끼', '검', '폭탄', '로켓', '화염', '붕괴', '피해', '로드아웃', '전투'].every((t) => hud.text.includes(t)), hud && hud.text.slice(0, 300));
  check('A.hud: no 공격력 (attack-power) text and no -/+ power buttons anywhere in the HUD (v1.3 §1)', !!hud && hud.noPowerButtons && !hud.text.includes('공격력'), hud && { noPowerButtons: hud.noPowerButtons, hasLabel: hud.text.includes('공격력') });

  // --- hammer on the small ("known") card — A31 (99 hp → 2 hits at 65) ---------------------------
  const urlBefore = page.url();
  const sc = await api.rect(page, '#small-card');
  const brokenBefore = (await api.stats(page)).broken;
  const smallPt = { x: sc.left + 12, y: sc.top + 12 };
  const smallClicks = await clickUntilBroken(page, '#small-card', smallPt.x, smallPt.y, 3);
  check('A.hammer small card: broken on the 2nd hammer hit (99 hp / 65)', smallClicks === 2, smallClicks);
  const s1 = await api.stats(page);
  check('A.hammer small card: stats().broken ≥ 1', s1.broken >= brokenBefore + 1 && s1.broken >= 1, s1.broken);
  check('A.hammer small card: .crs-debris count ≥ 1', (await api.count(page, '.crs-debris')) >= 1);
  check('A.hammer small card: original has data-crs-broken', await api.broken(page, '#small-card'));
  check('A.hammer small card: computed visibility hidden', (await api.visibility(page, '#small-card')) === 'hidden');
  check('A.hammer small card: link not navigated (URL unchanged)', page.url() === urlBefore && (await page.evaluate(() => location.hash === '' && !window.__linkClicks)), page.url());
  check('A.hammer small card: stats().cracks ≥ 1', s1.cracks >= 1, s1.cracks);

  // --- hammer on the long paragraph → word pieces (12.8; text cap 60 < 65 → one click) ------------
  const lp = await api.rect(page, '#long-para');
  await page.mouse.click(lp.cx, lp.cy);
  await poll(() => api.broken(page, '#long-para'), 1500);
  check('A.hammer paragraph: data-crs-broken', await api.broken(page, '#long-para'));
  const words = await api.count(page, '.crs-word');
  check('A.hammer paragraph: .crs-word count ≥ 5', words >= 5, words);
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, 'hammer.png') });
  info(`screenshot test/out/hammer.png (${words} word pieces)`);

  // canvas has ink at the small-card impact point before restore
  const inkBefore = await page.evaluate((pt) => {
    const c = document.querySelector('.crs-canvas');
    const ctx = c.getContext('2d');
    const sx = c.width / c.clientWidth, sy = c.height / c.clientHeight;
    const d = ctx.getImageData(Math.round(pt.x * sx) - 4, Math.round(pt.y * sy) - 4, 9, 9).data;
    let a = 0; for (let i = 3; i < d.length; i += 4) a += d[i];
    return a;
  }, smallPt);
  check('A.canvas: crack drawn at impact point (alpha > 0)', inkBefore > 0, inkBefore);

  // --- restore ------------------------------------------------------------------------------
  await api.restore(page);
  await sleep(100);
  const sr = await api.stats(page);
  check('A.restore: zero debris', sr.debris === 0 && (await api.count(page, '.crs-debris')) === 0, sr);
  check('A.restore: no [data-crs-broken]', (await api.count(page, '[data-crs-broken]')) === 0);
  check('A.restore: small card visibility restored', (await api.visibility(page, '#small-card')) === 'visible');
  check('A.restore: stats().broken === 0', sr.broken === 0, sr.broken);
  const inkAfter = await page.evaluate(() => {
    const c = document.querySelector('.crs-canvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return d[i];
    return 0;
  });
  check('A.restore: canvas cleared (every sampled pixel transparent)', inkAfter === 0, inkAfter);
  check('A.restore: still active', await api.active(page));

  // --- hammer ON the small card's link: smashed (card is the pick target), never followed (§9A / A31) ---
  const lk = await api.rect(page, '#card-link');
  await clickUntilBroken(page, '#small-card', lk.cx, lk.cy, 3);
  check('A.hammer link: clicks on <a> break the card instead of following the link', await api.broken(page, '#small-card'));
  check('A.hammer link: URL unchanged, hash empty, link handler not run', page.url() === urlBefore && (await page.evaluate(() => location.hash === '' && !window.__linkClicks)), { url: page.url(), hash: await page.evaluate(() => location.hash) });
  await api.restore(page);
  await sleep(100);

  // --- hammer on the large card: 184 hp → label DIV 119/184 → DIV 54/184 → broken (12.8 + A16) ------
  await api.setWeapon(page, 'hammer');
  const bc = await api.rect(page, '#big-card');
  const bigPt = { x: bc.left + 12, y: bc.top + 12 };
  const bigMax = (await api.hpOf(page, '#big-card')).max;
  const nBig = hitsFor(bigMax, DMG('hammer'));
  check('A.hammer large card: hitsFor(max, 65) === 3', nBig === 3, { bigMax, nBig });
  const b0 = (await api.stats(page)).broken;
  let bigOk = true;
  const bigSteps = [];
  for (let k = 1; k < nBig; k++) {
    await page.mouse.click(bigPt.x, bigPt.y);
    const expected = 'DIV ' + (bigMax - DMG('hammer') * k) + '/' + bigMax;
    const tb = await poll(async () => { const t = await api.targetBox(page); return t && t.label === expected ? t : null; }, 600, 20);
    const step = { k, broken: await api.broken(page, '#big-card'), count: (await api.stats(page)).broken, label: (tb || await api.targetBox(page) || {}).label, expected };
    bigSteps.push(step);
    check(`A.hammer large card: click ${k} → NOT broken, stats().broken unchanged`, !step.broken && step.count === b0, step);
    check(`A.hammer large card: label shows DIV <hp>/<max> after click ${k}`, step.label === expected, step);
    if (step.broken) bigOk = false;
  }
  await page.mouse.click(bigPt.x, bigPt.y);
  check(`A.hammer large card: click ${nBig} → broken`, bigOk && await poll(() => api.broken(page, '#big-card'), 1500));
  await api.restore(page);
  await sleep(100);

  // --- pistol on the large card: 8 shots (A16; setMode('gun') alias) -------------------------------
  await api.setMode(page, 'gun');
  check('A.gun: setMode("gun") → api.mode === "pistol" and api.weapon === "pistol" (legacy alias)', (await api.mode(page)) === 'pistol' && (await api.weapon(page)) === 'pistol', { mode: await api.mode(page), weapon: await api.weapon(page) });
  const gc = await api.rect(page, '#big-card');
  const gunPt = { x: gc.left + 12, y: gc.top + 12 };
  const gunMax = (await api.hpOf(page, '#big-card')).max;
  const nGun = hitsFor(gunMax, DMG('pistol'));
  check('A.gun large card: hitsFor(max, 25) === 8', nGun === 8, { gunMax, nGun });
  const debris0 = await api.count(page, '.crs-debris');
  const gunSteps = [];
  for (let k = 1; k < nGun; k++) {
    await page.mouse.click(gunPt.x, gunPt.y);
    const expected = 'DIV ' + (gunMax - DMG('pistol') * k) + '/' + gunMax;
    const tb = await poll(async () => { const t = await api.targetBox(page); return t && t.label === expected ? t : null; }, 600, 20);
    gunSteps.push({ k, broken: await api.broken(page, '#big-card'), debris: await api.count(page, '.crs-debris'), label: (tb || await api.targetBox(page) || {}).label, expected });
  }
  check('A.gun large card: shots 1 … 7 → not broken, debris count unchanged', gunSteps.length === nGun - 1 && gunSteps.every((s) => !s.broken && s.debris === debris0), { debris0, steps: gunSteps.map((s) => [s.k, s.broken, s.debris]) });
  check('A.gun large card: shot 1 → label "DIV ' + (gunMax - DMG('pistol')) + '/' + gunMax + '"', gunSteps[0] && gunSteps[0].label === gunSteps[0].expected, gunSteps[0]);
  check('A.gun large card: shot 2 → label "DIV ' + (gunMax - 2 * DMG('pistol')) + '/' + gunMax + '"', gunSteps[1] && gunSteps[1].label === gunSteps[1].expected, gunSteps[1]);
  await page.mouse.click(gunPt.x, gunPt.y);
  check(`A.gun large card: shot ${nGun} → broken`, await poll(() => api.broken(page, '#big-card'), 1500));

  // --- pistol on the image: 5 shots (12.8 / A16) ---------------------------------------------------
  // v1.2 (A1/A5): the pistol magazine holds 12 rounds and the emptying shot starts an auto-reload during
  // which every shot is rejected. The 8 large-card shots above left 4 rounds, so top the magazine up first
  // (manual reload, fastReload = 30 ms) — the 5 image shots then run on one full magazine, deterministically.
  const imgReload = await api.reload(page);
  const imgAmmo = await poll(async () => { const a = await api.ammo(page); return a && a.mag === a.size && !a.reloading ? a : null; }, 1500, 20);
  check('A.gun image: pistol magazine refilled before the image shots (reload() → true, then mag === size and not reloading)', imgReload === true && !!imgAmmo && imgAmmo.size === 12, { imgReload, imgAmmo });
  const ic = await api.rect(page, '#demo-img');
  const imgMax = (await api.hpOf(page, '#demo-img')).max;
  const nImg = hitsFor(imgMax, DMG('pistol'));
  check('A.gun image: hitsFor(max, 25) === 5', nImg === 5, { imgMax, nImg });
  const i1 = { broken: false, debris: 0 };
  for (let k = 1; k < nImg; k++) {
    await page.mouse.click(ic.cx, ic.cy);
    await poll(async () => (await api.hpOf(page, '#demo-img')).hp <= imgMax - DMG('pistol') * k, 400, 20);
    if (await api.broken(page, '#demo-img')) i1.broken = true;
  }
  i1.debris = await api.count(page, '.crs-debris');
  check(`A.gun image: shots 1 … ${nImg - 1} → not broken`, !i1.broken);
  await page.mouse.click(ic.cx, ic.cy);
  const imgBroken = await poll(() => api.broken(page, '#demo-img'), 1500);
  const i2 = await api.count(page, '.crs-debris');
  check(`A.gun image: shot ${nImg} → broken`, imgBroken);
  check(`A.gun image: shot ${nImg} → .crs-debris count increased`, i2 > i1.debris, { before: i1.debris, after: i2 });
  await api.restore(page);
  await sleep(100);

  // --- bomb via the HUD button (A31) ----------------------------------------------------------
  const hb = await api.hudButtonRect(page, '폭탄');
  check('A.bomb: HUD "폭탄" button found in shadow root', !!hb, hb);
  if (hb) await page.mouse.click(hb.cx, hb.cy);
  check('A.bomb: clicking HUD 폭탄 switches the weapon to "bomb"', await poll(async () => (await api.mode(page)) === 'bomb' && (await api.weapon(page)) === 'bomb', 1000));
  check('A.bomb: HUD click did not smash anything', (await api.stats(page)).broken === 0);
  const spot = await api.rect(page, '#bomb-spot');
  const tClick = Date.now();
  await page.mouse.click(spot.cx, spot.cy);
  const leavesBroken = await poll(async () => {
    const n = await api.count(page, '#cluster .leaf[data-crs-broken]');
    return n >= 2 ? n : 0;
  }, 200, 20);
  check('A.bomb: ≥ 2 cluster leaves broken within 200 ms', leavesBroken >= 2, { leavesBroken: await api.count(page, '#cluster .leaf[data-crs-broken]'), ms: Date.now() - tClick });
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, 'bomb.png') });
  info('screenshot test/out/bomb.png');
  await api.restore(page);

  // --- hover target box over the image (12.8 + A31) --------------------------------------------
  await api.setWeapon(page, 'hammer');
  const hr = await api.rect(page, '#demo-img');
  await sleep(550);
  await page.mouse.move(hr.cx, hr.cy);
  await sleep(150);
  const hv = await api.targetBox(page);
  const within = (a, b) => Math.abs(a - b) <= 3;
  check('A.hover: .crs-target visible over image', hv && hv.display !== 'none' && hv.visibility !== 'hidden', hv);
  check('A.hover: target rect within ±3 px of image rect', hv && within(hv.left, hr.left) && within(hv.top, hr.top) && within(hv.width, hr.width) && within(hv.height, hr.height), { box: hv, img: hr });
  check('A.hover: label matches /^IMG \\d+\\/\\d+$/', hv && /^IMG \d+\/\d+$/.test(hv.label), hv && hv.label);
  // hover over the HUD hides the box
  const hudPos = await api.hudButtonRect(page, '망치');
  check('A.hover: HUD "망치" button found in shadow root', !!hudPos, hudPos);
  if (hudPos) {
    await page.mouse.move(hudPos.cx, hudPos.cy);
    await sleep(150);
    const hvHud = await api.targetBox(page);
    check('A.hover: target box hidden while pointer is over the HUD', !hvHud || hvHud.display === 'none', hvHud);
  }

  // =============================================================================================
  // v1.1 — size-based HP, weapons, power, hit feedback (addendum §7 / A16, numbering kept)
  // =============================================================================================
  console.log('--- v1.1: size-based HP / weapons ---');
  await api.restore(page);
  await sleep(60);

  // (1) HP scales with size + exact A1 formula from the live rects
  const hpLeaf = await api.hpOf(page, '#cluster .leaf:first-child');
  const hpBtn = await api.hpOf(page, '#test-btn');
  const hpImg = await api.hpOf(page, '#demo-img');
  const hpCard = await api.hpOf(page, '#big-card');
  const hpPara = await api.hpOf(page, '#long-para');
  const rects = await page.evaluate(() => {
    const R = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { w: r.width, h: r.height }; };
    return { img: R('#demo-img'), card: R('#big-card') };
  });
  const inRange = (r) => r.max >= 10 && r.max <= 400 && r.hp === r.max;
  check('A.hp 1: max scales with size — leaf < button < image < large card', hpLeaf.max < hpBtn.max && hpBtn.max < hpImg.max && hpImg.max < hpCard.max, { leaf: hpLeaf.max, btn: hpBtn.max, img: hpImg.max, card: hpCard.max });
  check('A.hp 1: every max within [10, 400] and hp === max on a fresh page', [hpLeaf, hpBtn, hpImg, hpCard, hpPara].every(inRange), { leaf: hpLeaf, btn: hpBtn, img: hpImg, card: hpCard, para: hpPara });
  check('A.hp 1: image max === round((20 + 0.35·√area) × 1.2) from its live rect', hpImg.max === specMaxHp(rects.img.w, rects.img.h, 1.2, false), { got: hpImg.max, expected: specMaxHp(rects.img.w, rects.img.h, 1.2, false), rect: rects.img });
  check('A.hp 1: large card max === round(20 + 0.35·√area) (mult 1.0) from its live rect', hpCard.max === specMaxHp(rects.card.w, rects.card.h, 1.0, false), { got: hpCard.max, expected: specMaxHp(rects.card.w, rects.card.h, 1.0, false), rect: rects.card });
  check('A.hp 1: long paragraph (text-ish) max === 60 (cap)', hpPara.max === 60, hpPara);

  // (2) fresh large card: hammer −65, pistol −25, axe −130 (restore between checks)
  const bcc = await api.rect(page, '#big-card');
  const cardPt = { x: bcc.left + 12, y: bcc.top + 12 };
  const h2 = await hitFresh(page, 'hammer', cardPt, '#big-card');
  check('A.hp 2: hammer on a fresh large card → hp === max − 65, not broken', h2.hp === h2.max - DMG('hammer') && !h2.broken, h2);
  const p2 = await hitFresh(page, 'pistol', cardPt, '#big-card');
  check('A.hp 2: pistol on a fresh large card → hp === max − 25', p2.hp === p2.max - DMG('pistol') && !p2.broken, p2);
  const a2 = await hitFresh(page, 'axe', cardPt, '#big-card');
  check('A.hp 2: axe on a fresh large card → hp === max − 130 (54 left), not broken', a2.hp === a2.max - DMG('axe') && !a2.broken, a2);

  // (A3) cooldown gate: with noCooldown OFF, a second axe click inside 550 ms is rejected — no counter, no crack,
  // no damage (the suite otherwise runs with noCooldown = true, so this is the only place the gate executes)
  await api.debug(page, { noCooldown: false });
  await api.restore(page);
  await sleep(60);
  await api.setWeapon(page, 'axe');
  const sCd0 = await api.stats(page);
  const hCd0 = await api.hpOf(page, '#big-card');
  await page.mouse.click(cardPt.x, cardPt.y);
  await page.mouse.click(cardPt.x, cardPt.y);
  const rejected = await page.evaluate((p) => window.__crashScreen.smashAt(p.x, p.y, 'axe'), cardPt);
  await poll(async () => (await api.hpOf(page, '#big-card')).hp < hCd0.max, 400, 20);
  await sleep(100);
  const sCd1 = await api.stats(page);
  const hCd1 = await api.hpOf(page, '#big-card');
  check('A.cooldown: 2nd axe click within 550 ms is rejected — hp === max − 130 (one hit), card not broken', hCd1.hp === hCd1.max - DMG('axe') && !(await api.broken(page, '#big-card')), { before: hCd0, after: hCd1 });
  check('A.cooldown: rejected clicks change no counter (shots +1, cracks +1)', sCd1.shots === sCd0.shots + 1 && sCd1.cracks === sCd0.cracks + 1, { shots: [sCd0.shots, sCd1.shots], cracks: [sCd0.cracks, sCd1.cracks] });
  check('A.cooldown: api.smashAt(x, y, "axe") returns false while the axe is cooling down', rejected === false, rejected);
  const dbgCd = await api.debug(page, { noCooldown: true });
  check('A.cooldown: noCooldown re-enabled for the rest of the suite', dbgCd.noCooldown === true, dbgCd);

  // (3) v1.3 §1 / SPEC-readability §6 assertion 1: the attack-power multiplier is REMOVED, not weakened —
  // api.setPower / api.power / stats().power are gone, the HUD −/+ row is gone, "-"/"=" (and the other old
  // power hotkeys) are no-ops, labelPower is unreachable, and a single hammer hit always deals the flat 65.
  const powerGone = await page.evaluate(() => ({
    setPower: typeof window.__crashScreen.setPower,
    power: typeof window.__crashScreen.power,
    statsHasPower: 'power' in window.__crashScreen.stats(),
  }));
  check('A.power 3: api.setPower / api.power are undefined and stats() carries no "power" field', powerGone.setPower === 'undefined' && powerGone.power === 'undefined' && powerGone.statsHasPower === false, powerGone);
  const beforeKeys3 = await api.stats(page);
  await page.keyboard.press('-');
  await page.keyboard.press('_');
  await page.keyboard.press('=');
  await page.keyboard.press('+');
  await page.keyboard.press(']');
  await page.keyboard.press('[');
  await sleep(100);
  const afterKeys3 = await api.stats(page);
  check('A.power 3: "-" / "_" / "[" / "=" / "+" / "]" are no-ops — stats() carries no "power" field and is otherwise unchanged', !('power' in afterKeys3) && afterKeys3.weapon === beforeKeys3.weapon && afterKeys3.combo === beforeKeys3.combo && afterKeys3.cracks === beforeKeys3.cracks, { before: beforeKeys3, after: afterKeys3 });
  check('A.power 3: the locale key "labelPower" is unreachable — no quoted/property reference to it survives in content.js (comments mentioning its removal are fine)', !/['"]labelPower['"]|\.labelPower\b/.test(contentJs), null);
  const h3 = await hitFresh(page, 'hammer', cardPt, '#big-card');
  check('A.power 3: a single hammer hit deals exactly 65 (max − 65) — no multiplier applies', h3.hp === h3.max - DMG('hammer'), h3);

  // (4) forced crit: 130 and a "-130!" floating number
  await api.debug(page, { forceCrit: true, noCrit: false });
  const c4 = await hitFresh(page, 'hammer', cardPt, '#big-card');
  const critText = await poll(async () => { const t = await api.dmgTexts(page); return t.includes('-' + 2 * DMG('hammer') + '!') ? t : null; }, 300, 15);
  check('A.crit 4: debug.forceCrit → hammer deals 130', c4.hp === c4.max - 2 * DMG('hammer'), c4);
  check('A.crit 4: a .crs-dmg with text "-130!" appears', !!critText, await api.dmgTexts(page));
  const dbgReset = await api.debug(page, { forceCrit: false, noCrit: true });
  check('A.crit 4: debug flags reset (forceCrit false, noCrit true)', dbgReset.forceCrit === false && dbgReset.noCrit === true, dbgReset);
  check('A.crit 4: stats().crits ≥ 1 after the forced crit', (await api.stats(page)).crits >= 1, (await api.stats(page)).crits);

  // (5) floating number + hit tint on a normal hammer hit
  await api.restore(page);
  await sleep(60);
  await api.setWeapon(page, 'hammer');
  await page.mouse.click(cardPt.x, cardPt.y);
  const seen5 = { dmg: false, hit: false, dmgAt: -1, hitAt: -1 };
  const t5 = Date.now();
  while (Date.now() - t5 < 300 && !(seen5.dmg && seen5.hit)) {
    const s = await page.evaluate(() => ({ dmg: [...document.querySelectorAll('.crs-dmg')].map((n) => (n.textContent || '').trim()), hit: document.querySelectorAll('.crs-hit').length }));
    if (!seen5.dmg && s.dmg.includes('-' + DMG('hammer'))) { seen5.dmg = true; seen5.dmgAt = Date.now() - t5; }
    if (!seen5.hit && s.hit >= 1) { seen5.hit = true; seen5.hitAt = Date.now() - t5; }
    await sleep(10);
  }
  check('A.fx 5: a .crs-dmg with text "-65" exists within 300 ms of a hammer hit', seen5.dmg, seen5);
  check('A.fx 5: a .crs-hit tint appears on the hit', seen5.hit, seen5);
  check('A.fx 5: .crs-hit gone within 1 s', await poll(async () => (await api.count(page, '.crs-hit')) === 0, 1000, 30), await api.count(page, '.crs-hit'));
  check('A.fx 5: "-65" number gone within 2.5 s', await poll(async () => !(await api.dmgTexts(page)).includes('-' + DMG('hammer')), 2500, 50), await api.dmgTexts(page));
  const st5 = await api.stats(page);
  check('A.fx 5: stats().damageDealt === 65 and shots === 1 for the single hit', st5.damageDealt === DMG('hammer') && st5.shots === 1, { damageDealt: st5.damageDealt, shots: st5.shots });

  // (14) restore() resets HP, counters and every feedback node
  await page.mouse.click(cardPt.x, cardPt.y);   // leaves a live .crs-dmg / .crs-hit
  const fxPre14 = await api.fx(page);
  check('A.restore 14: a live .crs-dmg exists before restore() (precondition, so the "none left" check is not vacuous)', fxPre14.dmg >= 1, fxPre14);
  await api.restore(page);
  const h14 = await api.hpOf(page, '#big-card');
  const s14 = await api.stats(page);
  const fx14 = await api.fx(page);
  check('A.restore 14: hpOf(card).hp === max again after restore()', h14.hp === h14.max, h14);
  check('A.restore 14: shots / damageDealt / crits / scorch === 0', s14.shots === 0 && s14.damageDealt === 0 && s14.crits === 0 && s14.scorch === 0, s14);
  check('A.restore 14: no .crs-dmg / .crs-hit / .crs-fire / .crs-rocket / .crs-slash-preview left', fx14.dmg === 0 && fx14.hit === 0 && fx14.fire === 0 && fx14.rocket === 0 && fx14.preview === 0, fx14);
  check('A.restore 14: no .crs-orb / .crs-beam / .crs-warn / .crs-hostile / .crs-tracer / .crs-scope / .crs-vignette left', fx14.orb === 0 && fx14.beam === 0 && fx14.warn === 0 && fx14.hostile === 0 && fx14.tracer === 0 && fx14.scope === 0 && fx14.vignette === 0, fx14);

  // (6) smg hold on the arena
  await api.setWeapon(page, 'smg');
  check('A.smg 6: setWeapon("smg") → api.weapon === "smg"', (await api.weapon(page)) === 'smg');
  let ap = await arenaPt(page);
  const s6a = await api.stats(page);
  const h6a = await api.hpOf(page, '#arena');
  const samples6 = await holdAt(page, ap, 400, async () => { const s = await api.stats(page); return { combo: s.combo, holding: s.holding }; });
  const s6b = await api.stats(page);
  const h6b = await api.hpOf(page, '#arena');
  check('A.smg 6: 400 ms hold → stats().shots increased by ≥ 4', s6b.shots - s6a.shots >= 4, { before: s6a.shots, after: s6b.shots });
  check('A.smg 6: arena hp decreased by ≥ 28 (and not broken)', h6a.hp - h6b.hp >= 28 && !(await api.broken(page, '#arena')), { before: h6a, after: h6b });
  check('A.smg 6: stats().holding === true while held', samples6.some((s) => s.holding === true), samples6.slice(0, 4));
  check('A.smg 6: stats().combo never exceeded 1 during the hold', samples6.every((s) => s.combo <= 1) && s6b.combo <= 1, { max: Math.max(...samples6.map((s) => s.combo), s6b.combo) });
  await sleep(200);
  const s6c = await api.stats(page);
  check('A.smg 6: holding === false 200 ms after mouse.up', s6c.holding === false, s6c.holding);
  await sleep(200);
  const s6d = await api.stats(page);
  check('A.smg 6: shots stop increasing after release', s6d.shots === s6c.shots, { at200: s6c.shots, at400: s6d.shots });

  // (A4) hold crit window: forceCrit → every 150 ms window rolls a crit, its number reads "-<sum>!" and crits counts windows
  await api.debug(page, { forceCrit: true, noCrit: false });
  await api.restore(page);
  await sleep(60);
  await api.setWeapon(page, 'smg');
  ap = await arenaPt(page);
  const h6c0 = await api.hpOf(page, '#arena');
  let goldSeen = null;
  await holdAt(page, ap, 300, async () => { if (!goldSeen) { const t = (await api.dmgTexts(page)).find((s) => /^-\d+!$/.test(s)); if (t) goldSeen = t; } });
  const s6crit = await api.stats(page);
  const h6c1 = await api.hpOf(page, '#arena');
  check('A.smg crit: a gold "-<sum>!" window number appears during a forced-crit smg hold', !!goldSeen, await api.dmgTexts(page));
  check('A.smg crit: the window sum is a multiple of the crit shot (44 = 22 × 2)', !!goldSeen && parseInt(goldSeen.slice(1), 10) % (2 * DMG('smg')) === 0, goldSeen);
  check('A.smg crit: stats().crits ≥ 1 (one per window) and arena lost ≥ 2 crit shots (≥ 88)', s6crit.crits >= 1 && h6c0.hp - h6c1.hp >= 2 * 2 * DMG('smg'), { crits: s6crit.crits, lost: h6c0.hp - h6c1.hp });
  const dbg6 = await api.debug(page, { forceCrit: false, noCrit: true });
  check('A.smg crit: debug flags reset (forceCrit false, noCrit true)', dbg6.forceCrit === false && dbg6.noCrit === true, dbg6);

  // (7) flame hold on the arena (+ flame.png during the hold)
  await api.restore(page);
  await sleep(60);
  await api.setWeapon(page, 'flame');
  ap = await arenaPt(page);
  const s7a = await api.stats(page);
  const h7a = await api.hpOf(page, '#arena');
  let fireSeen = 0, flameShot = false;
  await holdAt(page, ap, 400, async (ms) => {
    const n = await api.count(page, '.crs-fire');
    if (n > fireSeen) fireSeen = n;
    if (!flameShot && ms >= 200) { flameShot = true; await page.screenshot({ path: path.join(OUT, 'flame.png') }); }
  });
  const s7b = await api.stats(page);
  const h7b = await api.hpOf(page, '#arena');
  info(`screenshot test/out/flame.png (${fireSeen} fire particles seen at peak)`);
  check('A.flame 7: 400 ms hold → arena hp decreased by ≥ 30', h7a.hp - h7b.hp >= 30, { before: h7a, after: h7b });
  check('A.flame 7: .crs-fire particles observed during the hold', fireSeen >= 1, fireSeen);
  check('A.flame 7: stats().scorch ≥ 1', s7b.scorch >= 1, s7b.scorch);
  check('A.flame 7: stats().cracks unchanged by the hold (no crack per tick)', s7b.cracks === s7a.cracks, { before: s7a.cracks, after: s7b.cracks });
  check('A.flame 7: holding === false after release', await poll(async () => (await api.stats(page)).holding === false, 300, 20), (await api.stats(page)).holding);
  check('A.flame 7: no .crs-fire left 1.5 s after release', await poll(async () => (await api.count(page, '.crs-fire')) === 0, 1500, 50), await api.count(page, '.crs-fire'));
  // restore() WHILE the button is still down: the hold stops at once, every particle is swept, no further ticks
  await api.restore(page);
  await sleep(60);
  ap = await arenaPt(page);
  await page.mouse.move(ap.x, ap.y);
  await page.mouse.down();
  await sleep(120);
  const fireLive = await poll(async () => { const f = await api.fx(page); return f.fire >= 1 ? f.fire : 0; }, 300, 20);
  check('A.flame 7: .crs-fire particles live 120 ms into a hold (precondition for the mid-hold restore)', fireLive >= 1, fireLive);
  await api.restore(page);
  const midHold = { holding: (await api.stats(page)).holding, fire: (await api.fx(page)).fire, shots: (await api.stats(page)).shots };
  await sleep(200);
  const midHold2 = await api.stats(page);
  check('A.flame 7: restore() during the hold → holding === false and .crs-fire === 0 immediately', midHold.holding === false && midHold.fire === 0, midHold);
  check('A.flame 7: no further ticks after the mid-hold restore (shots stays 0 over 200 ms)', midHold.shots === 0 && midHold2.shots === 0 && midHold2.holding === false, { at0: midHold.shots, at200: midHold2.shots });
  await page.mouse.up();

  // (8) sword: api.slash across both cards, real drag, two-piece split of a leaf (+ sword.png)
  await api.restore(page);
  await sleep(60);
  await api.setWeapon(page, 'sword');
  const bc8 = await api.rect(page, '#big-card');
  const sc8 = await api.rectNoScroll(page, '#small-card');
  const seg = { x1: bc8.left + 12, y1: bc8.top + 12, x2: sc8.left + 12, y2: sc8.top + 12 };
  const nSlash = await api.slash(page, seg.x1, seg.y1, seg.x2, seg.y2);
  await poll(async () => (await api.hpOf(page, '#small-card')).hp < (await api.hpOf(page, '#small-card')).max, 400, 20);
  const bigS = await api.hpOf(page, '#big-card');
  const smallS = await api.hpOf(page, '#small-card');
  check('A.sword 8: api.slash across both cards → each at hp === max − 60, neither broken', bigS.hp === bigS.max - DMG('sword') && smallS.hp === smallS.max - DMG('sword') && !(await api.broken(page, '#big-card')) && !(await api.broken(page, '#small-card')), { ret: nSlash, big: bigS, small: smallS });
  check('A.sword 8: api.slash returns the number of elements damaged (≥ 2)', typeof nSlash === 'number' && nSlash >= 2, nSlash);
  check('A.sword 8: a slash counts as one action (stats().shots === 1) and draws a crack', (await api.stats(page)).shots === 1 && (await api.stats(page)).cracks >= 1, await api.stats(page).then((s) => ({ shots: s.shots, cracks: s.cracks })));
  await api.restore(page);
  await sleep(60);
  await page.mouse.move(seg.x1, seg.y1);
  await page.mouse.down();
  await page.mouse.move(seg.x2, seg.y2, { steps: 8 });
  const previewSeen = await api.count(page, '.crs-slash-preview');
  await page.mouse.up();
  const dragOk = await poll(async () => { const b = await api.hpOf(page, '#big-card'); const s = await api.hpOf(page, '#small-card'); return b.hp < b.max && s.hp < s.max; }, 500, 20);
  check('A.sword 8: real drag (down/move/up) damages both cards', dragOk, { big: await api.hpOf(page, '#big-card'), small: await api.hpOf(page, '#small-card') });
  check('A.sword 8: .crs-slash-preview shown while dragging', previewSeen >= 1, previewSeen);
  check('A.sword 8: preview removed on pointerup (before any restore)', (await api.count(page, '.crs-slash-preview')) === 0, await api.count(page, '.crs-slash-preview'));
  await page.screenshot({ path: path.join(OUT, 'sword.png') });
  info('screenshot test/out/sword.png');
  await api.restore(page);
  await sleep(60);
  const leaf8 = await api.rect(page, '#cluster .leaf:first-child');
  await api.slash(page, leaf8.left + 4, leaf8.cy, leaf8.right - 4, leaf8.cy);
  const leafBroken = await poll(() => api.broken(page, '#cluster .leaf:first-child'), 600, 20);
  const s8 = await api.stats(page);
  check('A.sword 8: a slash across a leaf breaks it', leafBroken);
  check('A.sword 8: stats().lastBreakPieces === 2 (geometric two-piece split, no word shattering)', s8.lastBreakPieces === 2, s8.lastBreakPieces);
  check('A.sword 8: no .crs-slash-preview left after the slashes', (await api.count(page, '.crs-slash-preview')) === 0);

  // (9) rocket: streak during travel, card broken within 600 ms, XL ring, AoE neighbours (+ rocket.png)
  await api.restore(page);
  await sleep(60);
  await api.setWeapon(page, 'rocket');
  const bc9 = await api.rect(page, '#big-card');
  const rocketPt = { x: bc9.left + 12, y: bc9.top + 12 };
  // The streak lives only 150 ms, so a sampling loop could miss it: a MutationObserver installed before the click
  // records the insertion time against a page-side anchor taken just before the click is sent.
  await page.evaluate(() => {
    const rec = { t0: performance.now(), rocketAt: -1 };
    const mo = new MutationObserver(() => { if (rec.rocketAt < 0 && document.querySelector('.crs-rocket')) { rec.rocketAt = performance.now() - rec.t0; mo.disconnect(); } });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.__crsRocketProbe = rec;
  });
  const t9 = Date.now();   // anchored BEFORE the click round-trip
  await page.mouse.click(rocketPt.x, rocketPt.y);
  const seen9 = { rocketAt: -1, ringAt: -1, brokenAt: -1 };
  while (Date.now() - t9 < 900 && (seen9.ringAt < 0 || seen9.brokenAt < 0)) {
    const s = await page.evaluate(() => ({ ring: document.querySelectorAll('.crs-fx-ring.crs-fx-ring-xl').length, broken: document.getElementById('big-card').hasAttribute('data-crs-broken') }));
    const ms = Date.now() - t9;
    if (seen9.ringAt < 0 && s.ring) seen9.ringAt = ms;
    if (seen9.brokenAt < 0 && s.broken) seen9.brokenAt = ms;
    await sleep(10);
  }
  seen9.rocketAt = await page.evaluate(() => { const p = window.__crsRocketProbe; delete window.__crsRocketProbe; return p ? Math.round(p.rocketAt) : -2; });
  check('A.rocket 9: .crs-rocket streak inserted within 150 ms of the click (MutationObserver probe)', seen9.rocketAt >= 0 && seen9.rocketAt <= 150, seen9);
  check('A.rocket 9: #big-card broken within 600 ms', seen9.brokenAt >= 0 && seen9.brokenAt <= 600, seen9);
  check('A.rocket 9: .crs-fx-ring.crs-fx-ring-xl seen at impact', seen9.ringAt >= 0, seen9);
  const aoe = await poll(async () => {
    const r = await page.evaluate(() => {
      const api = window.__crashScreen;
      const els = [document.getElementById('intro'), document.querySelector('.tags'), ...document.querySelectorAll('.tag'), document.getElementById('title'), document.querySelector('section.hero')].filter(Boolean);
      return els.map((el) => { const h = api.hpOf(el); return { tag: el.tagName + (el.id ? '#' + el.id : '.' + el.className), hp: h.hp, max: h.max, broken: el.hasAttribute('data-crs-broken') }; }).filter((e) => e.hp < e.max || e.broken);
    });
    return r.length ? r : null;
  }, 400, 20);
  check('A.rocket 9: AoE — at least one neighbour (#intro / .tags / .tag / #title / section.hero) damaged or broken within 400 ms', !!aoe && aoe.length >= 1, aoe);
  await page.screenshot({ path: path.join(OUT, 'rocket.png') });
  info('screenshot test/out/rocket.png');
  check('A.rocket 9: no .crs-rocket left after impact', await poll(async () => (await api.count(page, '.crs-rocket')) === 0, 500, 20));
  // restore() 40 ms into the flight: the streak goes at once and the impact timer never fires on the restored page
  await api.restore(page);
  await sleep(60);
  const bc9b = await api.rect(page, '#big-card');
  const h9b0 = await api.hpOf(page, '#big-card');
  await page.mouse.click(bc9b.left + 12, bc9b.top + 12);
  await sleep(40);
  await api.restore(page);
  const fx9mid = await api.fx(page);
  check('A.rocket 9: restore() mid-flight removes the .crs-rocket streak immediately', fx9mid.rocket === 0, fx9mid);
  await sleep(250);
  const fx9after = await api.fx(page);
  const s9after = await api.stats(page);
  const h9b1 = await api.hpOf(page, '#big-card');
  check('A.rocket 9: no impact after a mid-flight restore (no XL ring, nothing broken, card hp === max 250 ms later)', fx9after.ring === 0 && fx9after.ringXl === 0 && s9after.broken === 0 && h9b1.hp === h9b0.max, { fx: fx9after, broken: s9after.broken, hp: h9b1 });

  // (10) bomb on the arena: exactly 190 at the centre, ≥ 2 damage numbers
  await api.restore(page);
  await sleep(60);
  await api.setWeapon(page, 'bomb');
  ap = await arenaPt(page);
  const h10a = await api.hpOf(page, '#arena');
  await page.mouse.click(ap.x, ap.y);
  const dmg10 = await poll(async () => { const n = await api.count(page, '.crs-dmg'); return n >= 2 ? n : 0; }, 200, 10);
  const h10b = await poll(async () => { const r = await api.hpOf(page, '#arena'); return r.hp < r.max ? r : null; }, 300, 20) || await api.hpOf(page, '#arena');
  check('A.bomb 10: arena takes exactly 190 at the blast centre (hp === max − 190), not broken', h10b.hp === h10a.max - DMG('bomb') && !(await api.broken(page, '#arena')), { before: h10a, after: h10b });
  check('A.bomb 10: ≥ 2 .crs-dmg numbers within 200 ms (arena + a neighbour above it)', dmg10 >= 2, await api.count(page, '.crs-dmg'));
  // (A7) a blast centred on a nested element never hits its ANCESTORS at centre damage (v1 bombCandidates rule):
  // a 400 × 400 padded container (160 hp) around a 200 × 200 child (90 hp) — the only element the ring samples
  // land on inside the box is the container itself, so without the rule it would take 190 (edgeDist 0) and break
  await api.restore(page);
  await sleep(60);
  const nest10 = await page.evaluate(() => {
    const box = document.createElement('div'); box.id = 'x-aoe';
    Object.assign(box.style, { position: 'fixed', left: '60px', top: '240px', width: '400px', height: '400px', padding: '100px', boxSizing: 'border-box', background: '#eef2ff', border: '1px solid #99a', zIndex: '40' });
    const inner = document.createElement('div'); inner.id = 'x-aoe-inner';
    Object.assign(inner.style, { width: '200px', height: '200px', background: '#4a7bd0', borderRadius: '8px' });
    box.append(inner); document.body.append(box);
    const r = inner.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  const boxHp0 = await api.hpOf(page, '#x-aoe');
  await page.mouse.click(nest10.cx, nest10.cy);
  const innerGone10 = await poll(() => api.broken(page, '#x-aoe-inner'), 400, 20);
  await sleep(120);   // the AoE stagger is ≤ 90 ms (edgeDist / 4)
  const boxHp1 = await api.hpOf(page, '#x-aoe');
  check('A.bomb 10: a bomb centred on a nested 200 × 200 child breaks the child (90 hp < 190)', innerGone10, await api.hpOf(page, '#x-aoe-inner'));
  check('A.bomb 10: its padded 400 × 400 container keeps full hp — ancestors of candidate 0 are never AoE candidates', boxHp1.hp === boxHp1.max && boxHp1.max === boxHp0.max && !(await api.broken(page, '#x-aoe')), { before: boxHp0, after: boxHp1, containerBroken: await api.broken(page, '#x-aoe') });
  await api.restore(page);
  await page.evaluate(() => { const b = document.getElementById('x-aoe'); if (b) b.remove(); });

  // (12) hover label + health bar over the image, red fill below 30 %
  await api.restore(page);
  await sleep(60);
  await api.setWeapon(page, 'pistol');
  const ir = await api.rect(page, '#demo-img');
  await sleep(550);
  await page.mouse.move(ir.cx, ir.cy);
  await sleep(150);
  const tb12 = await api.targetBox(page);
  const hp12 = await api.hpOf(page, '#demo-img');
  check('A.bar 12: hover label matches /^IMG \\d+\\/\\d+$/ and equals "IMG hp/max"', tb12 && /^IMG \d+\/\d+$/.test(tb12.label) && tb12.label === `IMG ${hp12.hp}/${hp12.max}`, { box: tb12 && tb12.label, hp: hp12 });
  check('A.bar 12: .crs-target-bar / .crs-target-fill present, fill ratio ≈ hp/max (± 8 %)', tb12 && tb12.hasBar && tb12.ratio !== null && Math.abs(tb12.ratio - hp12.hp / hp12.max) <= 0.08, { ratio: tb12 && tb12.ratio, expected: hp12.hp / hp12.max, color: tb12 && tb12.fillColor });
  check('A.bar 12: fill colour green (rgb(63, 185, 80)) at full hp', tb12 && tb12.fillColor === 'rgb(63, 185, 80)', tb12 && tb12.fillColor);
  for (let k = 1; k <= 3; k++) {
    await page.mouse.click(ir.cx, ir.cy);
    await poll(async () => (await api.hpOf(page, '#demo-img')).hp <= hp12.max - DMG('pistol') * k, 400, 20);
  }
  const hp12b = await api.hpOf(page, '#demo-img');
  const tb12b = await poll(async () => { const t = await api.targetBox(page); return t && t.label === `IMG ${hp12b.hp}/${hp12b.max}` ? t : null; }, 400, 20) || await api.targetBox(page);
  check('A.bar 12: after 3 pistol shots hp === max − 75 (ratio ≈ 0.26) and the label follows', hp12b.hp === hp12.max - 3 * DMG('pistol') && tb12b && tb12b.label === `IMG ${hp12b.hp}/${hp12b.max}`, { hp: hp12b, label: tb12b && tb12b.label });
  check('A.bar 12: fill ratio ≈ hp/max (± 8 %) after the shots', tb12b && tb12b.ratio !== null && Math.abs(tb12b.ratio - hp12b.hp / hp12b.max) <= 0.08, { ratio: tb12b && tb12b.ratio, expected: hp12b.hp / hp12b.max });
  check('A.bar 12: fill colour turns red (rgb(229, 72, 77)) below 30 %', tb12b && tb12b.fillColor === 'rgb(229, 72, 77)', tb12b && tb12b.fillColor);
  await page.mouse.move(10, VIEWPORT.height / 2);   // park the pointer off the image (and off the HUD)

  // (13) hotkeys 1–9 then 0 select the ids in default-loadout order; setMode('gun') → pistol
  await api.restore(page);
  const keyed = [];
  for (let i = 0; i < KEYS.length; i++) {
    await page.keyboard.press(KEYS[i]);
    const want = WEAPON_IDS[i];
    const got = await poll(async () => ((await api.weapon(page)) === want ? want : null), 400, 20);
    keyed.push({ key: KEYS[i], want, got: got || await api.weapon(page) });
  }
  check('A.keys 13: keys 1–9, 0 select hammer … collapse in default-loadout order', keyed.every((k) => k.got === k.want), keyed);
  // SPEC-combat-v2 §5 reassigns stats().mode to the PLAY mode (rampage/quickdraw/survival); the v1 weapon alias
  // it used to carry lives on as stats().weaponMode and as the api.mode getter, both still asserted here.
  check('A.keys 13: stats().weapon / weaponMode / api.mode mirror the selection, and stats().mode is now the play mode (§5)', await page.evaluate(() => { const a = window.__crashScreen, s = a.stats(); return s.weapon === 'collapse' && s.weaponMode === 'collapse' && a.mode === 'collapse' && ['rampage', 'quickdraw', 'survival'].includes(s.mode); }), await api.stats(page).then((s) => ({ weapon: s.weapon, weaponMode: s.weaponMode, mode: s.mode })));
  await api.setMode(page, 'gun');
  check('A.keys 13: setMode("gun") → api.weapon === "pistol"', (await api.weapon(page)) === 'pistol' && (await api.mode(page)) === 'pistol', { weapon: await api.weapon(page), mode: await api.mode(page) });
  check('A.keys 13: crsWeapon persisted in the shim storage', (await api.store(page)).crsWeapon === 'pistol', await api.store(page));
  await api.setWeapon(page, 'hammer');
  await api.restore(page);
  await sleep(60);

  // --- collapse (12.8; §7 test 11 unchanged) -----------------------------------------------------
  await api.setWeapon(page, 'collapse');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(100);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await sleep(2500);
  const cs = await api.stats(page);
  check('A.collapse: stats().broken ≥ 10 after 2.5 s (ignores HP)', cs.broken >= 10, cs.broken);
  check('A.collapse: stats().lastError === null (no swallowed exception)', cs.lastError === null, cs.lastError);
  await api.restore(page);
  await sleep(100);
  const cr = await api.stats(page);
  check('A.collapse: restore → 0 broken, 0 [data-crs-broken]', cr.broken === 0 && (await api.count(page, '[data-crs-broken]')) === 0, cr.broken);

  // --- stacking / settling (A31) ---------------------------------------------------------------
  await api.setWeapon(page, 'hammer');
  const st1 = await api.rect(page, '#stack-1');
  const st2 = await api.rectNoScroll(page, '#stack-2');
  const st3 = await api.rectNoScroll(page, '#stack-3');
  const sx = st1.cx;
  const c1 = await clickUntilBroken(page, '#stack-1', sx, st1.cy);
  const c2 = await clickUntilBroken(page, '#stack-2', sx, st2.cy);
  const c3 = await clickUntilBroken(page, '#stack-3', sx, st3.cy);
  check('A.stack: three stacked blocks broken at the same x', c1 && c2 && c3, { c1, c2, c3 });
  await sleep(3000);
  const ss = await api.stats(page);
  const clientH = await page.evaluate(() => document.documentElement.clientHeight);
  const pieces = Array.isArray(ss.pieces) ? ss.pieces : [];
  const bad = pieces.filter((p) => !(p.bottom <= clientH + 1 && p.resting));
  check('A.stack: stats().pieces present', pieces.length >= 3, pieces.length);
  check('A.stack: every piece bottom ≤ clientHeight + 1 and resting after 3 s', pieces.length > 0 && bad.length === 0, { bad: bad.slice(0, 5), clientH });
  check('A.stack: stats().animating === false', ss.animating === false, ss.animating);
  check('A.stats: cap === 160', ss.cap === 160, ss.cap);
  check('A.stats: pieceCount === pieces.length', ss.pieceCount === pieces.length, { pieceCount: ss.pieceCount, len: pieces.length });
  await api.restore(page);

  // --- stress (12.8 / §7 test 15): 30 hammer clicks, then 1 s smg + 1 s flame holds (v1.3 §1: no power ×4) --
  const errBefore = log.pageErrors.length;
  // seeded LCG so a failing run can be replayed with CRS_SEED=<n>
  const seed0 = Number(process.env.CRS_SEED) || 1234;
  let seed = seed0;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  // keep away from the HUD: a click on the panel is a HUD event (§5 / A3 — never an attack, so no crack).
  // v1.2 adds fixed-position shadow children (ammo HUD bottom-right, player HUD bottom-left, toast top-centre,
  // A11), so measure the live host rect plus every shadow-root child and resample any seeded point inside one.
  const hudBoxes = await page.evaluate((vp) => {
    const out = [];
    const add = (el) => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) out.push({ left: r.left - 8, top: r.top - 8, right: r.right + 8, bottom: r.bottom + 8 }); };
    const h = document.querySelector('crs-hud, .crs-hud-host');
    if (h) { add(h); if (h.shadowRoot) for (const el of h.shadowRoot.children) if (el.tagName !== 'STYLE') add(el); }
    if (!out.length) out.push({ left: vp.width - 348, top: -8, right: vp.width + 8, bottom: 228 });
    return out;
  }, VIEWPORT);
  const inHud = (x, y) => hudBoxes.some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom);
  const stressPts = [];
  const tStress = Date.now();
  for (let i = 0; i < 30; i++) {
    let x = 20 + rnd() * (VIEWPORT.width - 40);
    let y = 20 + rnd() * (VIEWPORT.height - 40);
    for (let guard = 0; inHud(x, y) && guard < 50; guard++) {
      x = 20 + rnd() * (VIEWPORT.width - 40);
      y = 20 + rnd() * (VIEWPORT.height - 40);
    }
    stressPts.push([Math.round(x), Math.round(y)]);
    await page.mouse.click(x, y);
  }
  const stressMs = Date.now() - tStress;
  info(`stress: 30 clicks dispatched in ${stressMs} ms (CRS_SEED=${seed0}; points ${JSON.stringify(stressPts)})`);
  await sleep(300);
  const debrisStress = await api.count(page, '.crs-debris');
  const stStress = await api.stats(page);
  check('A.stress: 30 clicks dispatched within 2 s', stressMs < 2000, stressMs);
  check('A.stress: no page errors during 30 hammer clicks', log.pageErrors.length === errBefore, log.pageErrors.slice(errBefore, errBefore + 2));
  check('A.stress: stats().lastError === null (smashAt swallows exceptions there)', stStress.lastError === null, stStress.lastError);
  check('A.stress: every click produced a crack (stats().cracks === 30)', stStress.cracks === 30, stStress.cracks);
  check('A.stress: at least one element broken by the 30 clicks', stStress.broken >= 1, stStress.broken);
  check('A.stress: .crs-debris count ≤ 160', debrisStress <= 160, debrisStress);
  check('A.stress: stats().debris ≤ cap', stStress.debris <= 160, stStress.debris);
  await api.restore(page);
  await sleep(60);
  await api.setWeapon(page, 'smg');
  ap = await arenaPt(page);
  const smgHold = await holdAt(page, ap, 1000, async () => api.fx(page));
  const smgPeak = smgHold.reduce((m, f) => ({ dmg: Math.max(m.dmg, f.dmg), debris: Math.max(m.debris, f.debris) }), { dmg: 0, debris: 0 });
  const smgAfter = await api.stats(page);
  await api.restore(page);
  await sleep(60);
  await api.setWeapon(page, 'flame');
  ap = await arenaPt(page);
  const flameHold = await holdAt(page, ap, 1000, async () => api.fx(page));
  const flamePeak = flameHold.reduce((m, f) => ({ dmg: Math.max(m.dmg, f.dmg), fire: Math.max(m.fire, f.fire), debris: Math.max(m.debris, f.debris) }), { dmg: 0, fire: 0, debris: 0 });
  const fxHold = await api.fx(page);
  const stHold = await api.stats(page);
  info(`stress holds: smg shots ${smgAfter.shots}, flame shots ${stHold.shots}, peaks ${JSON.stringify({ smg: smgPeak, flame: flamePeak })}`);
  check('A.stress: no page errors during the 1 s smg + 1 s flame holds', log.pageErrors.length === errBefore, log.pageErrors.slice(errBefore, errBefore + 2));
  check('A.stress: stats().lastError === null after the holds', stHold.lastError === null, stHold.lastError);
  check('A.stress: smg hold fired ≥ 10 shots, flame hold ≥ 15 ticks', smgAfter.shots >= 10 && stHold.shots >= 15, { smg: smgAfter.shots, flame: stHold.shots });
  check('A.stress: .crs-debris ≤ 160 throughout the holds', fxHold.debris <= 160 && smgPeak.debris <= 160 && flamePeak.debris <= 160, { now: fxHold.debris, smgPeak, flamePeak });
  check('A.stress: .crs-fire ≤ 40 throughout the flame hold', fxHold.fire <= 40 && flamePeak.fire <= 40, { now: fxHold.fire, peak: flamePeak.fire });
  check('A.stress: .crs-dmg ≤ 40 throughout the holds', fxHold.dmg <= 40 && smgPeak.dmg <= 40 && flamePeak.dmg <= 40, { now: fxHold.dmg, smgPeak, flamePeak });
  check('A.stress: holding === false after the holds', stHold.holding === false, stHold.holding);
  await api.setWeapon(page, 'hammer');
  await api.restore(page);
  await sleep(100);

  // --- hostile DOM, part 1: full-viewport transparent shadow host (Ionic/Lit/Stencil-style app root) --------
  // document.elementsFromPoint only ever returns the host; the cards live in its open shadow root.
  await api.setWeapon(page, 'hammer');
  await page.evaluate(() => window.scrollTo(0, 0));
  const xcard = await page.evaluate(() => {
    const host = document.createElement('x-app');
    host.id = 'x-app';
    Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh', display: 'block', zIndex: '50' });
    const sh = host.attachShadow({ mode: 'open' });
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%' });
    sh.append(wrap);
    for (let i = 0; i < 3; i++) {
      const c = document.createElement('div');
      c.className = 'xcard';
      Object.assign(c.style, { position: 'absolute', left: (40 + i * 230) + 'px', top: '640px', width: '200px', height: '80px', background: '#fff', border: '1px solid #99a', borderRadius: '8px', padding: '12px', boxSizing: 'border-box', font: '16px sans-serif', color: '#223' });
      c.textContent = '쉐도우 카드 ' + (i + 1);
      wrap.append(c);
    }
    document.body.append(host);
    const r = sh.querySelector('.xcard').getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  await sleep(550);
  await page.mouse.move(xcard.cx, xcard.cy);
  await sleep(150);
  const hvShadow = await api.targetBox(page);
  check('A.shadow: hover over a card inside a full-viewport transparent shadow host → label "DIV hp/max"', hvShadow && hvShadow.display !== 'none' && /^DIV \d+\/\d+$/.test(hvShadow.label), hvShadow);
  const shadowIsBroken = () => page.evaluate(() => {
    const h = document.getElementById('x-app');
    return !!(h && h.shadowRoot.querySelector('.xcard').hasAttribute('data-crs-broken'));
  });
  const shadowClicks = await smashUntil(page, shadowIsBroken, xcard.cx, xcard.cy, 3);
  check('A.shadow: hammer clicks break the shadow card (data-crs-broken inside the shadow root)', shadowClicks >= 1 && await shadowIsBroken(), shadowClicks);
  check('A.shadow: debris spawned, nothing in the light DOM broken instead', (await api.count(page, '.crs-debris')) >= 1 && (await api.count(page, '[data-crs-broken]')) === 0, { debris: await api.count(page, '.crs-debris'), lightBroken: await api.count(page, '[data-crs-broken]') });
  await api.restore(page);
  await sleep(100);
  await api.setWeapon(page, 'collapse');
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  const shadowCollapsed = await poll(() => page.evaluate(() => {
    const h = document.getElementById('x-app');
    return h ? h.shadowRoot.querySelectorAll('.xcard[data-crs-broken]').length : 0;
  }), 3000);
  check('A.shadow: collapse reaches elements inside the shadow root', shadowCollapsed >= 1, shadowCollapsed);
  await api.restore(page);
  await sleep(100);
  await page.evaluate(() => { const h = document.getElementById('x-app'); if (h) h.remove(); });
  await api.setWeapon(page, 'hammer');

  // --- hostile DOM, part 2: opacity:0 hover overlay, scaled ancestor, <audio>, nested broken attribute ------
  const hd = await page.evaluate(() => {
    const fixed = (tag, st, parent) => { const n = document.createElement(tag); Object.assign(n.style, st); (parent || document.body).append(n); return n; };
    const layer = fixed('div', { position: 'fixed', left: '0', top: '0', width: '0', height: '0', zIndex: '60' });
    layer.id = 'x-layer';
    // product-card pattern: image + opacity:0 overlay with a "quick view" button (no pointer-events:none)
    const card = fixed('div', { position: 'fixed', left: '40px', top: '600px', width: '200px', height: '120px' }, layer);
    const img = fixed('img', { display: 'block', width: '200px', height: '120px' }, card);
    img.id = 'x-img';
    img.src = document.getElementById('demo-img').src;
    const ov = fixed('div', { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', opacity: '0', background: 'rgba(0,0,0,.6)' }, card);
    const qv = fixed('button', { position: 'absolute', left: '50px', top: '40px', padding: '8px 16px' }, ov);
    qv.id = 'x-qv'; qv.type = 'button'; qv.textContent = 'Quick view';
    // paragraph under transform: scale(1.5)
    const sc = fixed('div', { position: 'fixed', left: '300px', top: '600px', width: '280px', transform: 'scale(1.5)', transformOrigin: '0 0' }, layer);
    const p = fixed('p', { margin: '0', padding: '8px', background: '#fff', font: '16px/1.4 sans-serif', color: '#223' }, sc);
    p.id = 'x-scaled';
    p.textContent = '확대된 문단의 단어들은 원래 크기로 떨어져야 합니다';
    // text box containing an <audio controls>
    const ab = fixed('div', { position: 'fixed', left: '760px', top: '600px', width: '320px', padding: '12px', background: '#fde', font: '15px sans-serif', color: '#223' }, layer);
    ab.id = 'x-audio-box';
    ab.append(document.createTextNode('오디오가 들어 있는 상자 '));
    const au = fixed('audio', { display: 'block', width: '280px' }, ab);
    au.controls = true;
    // nested: a heading broken first, then its container
    const nest = fixed('div', { position: 'fixed', left: '760px', top: '740px', width: '320px', padding: '16px', background: '#eef', font: '15px sans-serif', color: '#223' }, layer);
    nest.id = 'x-nest';
    const h = fixed('h3', { margin: '0 0 6px', font: '700 18px sans-serif' }, nest);
    h.id = 'x-nest-h'; h.textContent = '중첩 제목';
    const np = fixed('p', { margin: '0' }, nest); np.textContent = '컨테이너 본문 텍스트';
    const R = (el) => { const r = el.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, left: r.left, top: r.top, w: r.width, h: r.height }; };
    const rg = document.createRange(); rg.setStart(p.firstChild, 0); rg.setEnd(p.firstChild, 3);
    return { img: R(img), p: R(p), pFont: getComputedStyle(p).fontSize, word0H: rg.getBoundingClientRect().height, ab: R(ab), h: R(h), nest: R(nest) };
  });
  await sleep(550);
  await page.mouse.move(hd.img.cx, hd.img.cy);
  await sleep(150);
  const hvOv = await api.targetBox(page);
  check('A.overlay: invisible (opacity:0 ancestor) quick-view button is skipped → label "IMG hp/max"', hvOv && hvOv.display !== 'none' && /^IMG \d+\/\d+$/.test(hvOv.label), hvOv);
  await clickUntilBroken(page, '#x-img', hd.img.cx, hd.img.cy, 3);
  check('A.overlay: the image breaks, the hidden button does not', (await api.broken(page, '#x-img')) && !(await api.broken(page, '#x-qv')), { img: await api.broken(page, '#x-img'), qv: await api.broken(page, '#x-qv') });
  await page.mouse.click(hd.p.cx, hd.p.cy);
  check('A.scaled: paragraph under transform: scale(1.5) breaks into word pieces', await poll(() => api.broken(page, '#x-scaled'), 1500));
  const scaledWords = await page.evaluate(() => [...document.querySelectorAll('.crs-word')].map((w) => { const cs = getComputedStyle(w); return { fs: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight), h: w.getBoundingClientRect().height }; }));
  const pFont = parseFloat(hd.pFont);
  check('A.scaled: word pieces carry the scaled font size (≈ 1.5 × paragraph font, ±1 px)', scaledWords.length >= 3 && scaledWords.every((w) => Math.abs(w.fs - 1.5 * pFont) <= 1), { pFont, sample: scaledWords.slice(0, 3) });
  check('A.scaled: word piece line-height equals the piece box height', scaledWords.every((w) => Math.abs(w.lh - w.h) <= 1), scaledWords.slice(0, 3));
  await clickUntilBroken(page, '#x-audio-box', hd.ab.left + 6, hd.ab.top + 6, 3);
  check('A.audio: text box containing <audio> breaks', await api.broken(page, '#x-audio-box'));
  check('A.audio: no <audio> element is cloned into the debris', (await api.count(page, '.crs-root audio')) === 0, await api.count(page, '.crs-root audio'));
  await page.mouse.click(hd.h.cx, hd.h.cy);
  check('A.nested: heading broken first', await poll(() => api.broken(page, '#x-nest-h'), 1500));
  await clickUntilBroken(page, '#x-nest', hd.nest.left + 6, hd.nest.top + 6, 3);
  const nestState = { containerBroken: await api.broken(page, '#x-nest'), attrs: await api.count(page, '[data-crs-broken]'), broken: (await api.stats(page)).broken, inPieces: await api.count(page, '.crs-root [data-crs-broken]') };
  check('A.nested: container broken after its heading; [data-crs-broken] count === stats().broken (no copies in the clones)', nestState.containerBroken && nestState.attrs === nestState.broken && nestState.inPieces === 0, nestState);
  await api.restore(page);
  await sleep(100);
  await page.evaluate(() => { const l = document.getElementById('x-layer'); if (l) l.remove(); });
  check('A.hostile: restore left no [data-crs-broken] and no debris', (await api.count(page, '[data-crs-broken]')) === 0 && (await api.count(page, '.crs-debris')) === 0);

  // --- button handler blocked while active (44 hp → one hammer hit) ------------------------------------
  const btn = await api.rect(page, '#test-btn');
  const btnClicks = await clickUntilBroken(page, '#test-btn', btn.cx, btn.cy, 3);
  check('A.button: BUTTON smashed on the first hammer hit (44 hp < 65)', btnClicks === 1, btnClicks);
  check('A.button: click handler NOT invoked while active', (await page.evaluate(() => window.__btnClicks)) === 0, await page.evaluate(() => window.__btnClicks));

  // =============================================================================================
  // v1.2 — ammo / sniper + scope / loadouts / hostile components (SPEC-v3 §8 / A13; ends with the exit test
  // and re-activates the page)
  // =============================================================================================
  await suiteA12(page, log, contentJs);

  // --- (16) Escape DURING an smg hold exits cleanly: no nodes, no intervals, shots stop -------------------
  await api.setWeapon(page, 'smg');
  ap = await arenaPt(page);
  await page.mouse.move(ap.x, ap.y);
  await page.mouse.down();
  await sleep(150);
  const holdingBefore = (await api.stats(page)).holding;
  await page.keyboard.press('Escape');
  check('A.escape 16: active === false after Escape during the hold', await poll(async () => !(await api.active(page)), 1500));
  check('A.escape 16: no [data-crs] nodes remain', (await api.count(page, '[data-crs]')) === 0);
  const sEsc = await api.stats(page);
  check('A.escape 16: holding was true during the hold and is false after Escape', holdingBefore === true && sEsc.holding === false, { before: holdingBefore, after: sEsc.holding });
  const pendEsc = await api.pending(page);
  check('A.escape 16: zero live content-script timers right after Escape (ledger: hold chain + safety timer cancelled)', pendEsc === 0, pendEsc);
  check('A.escape 16: stats().shots === 0 right after Escape (restore contract)', sEsc.shots === 0, sEsc.shots);
  await sleep(200);
  const sEsc2 = await api.stats(page);
  const pendEsc2 = await api.pending(page);
  check('A.escape 16: stats().shots unchanged over the next 200 ms (hold chain stopped)', sEsc2.shots === sEsc.shots, { at0: sEsc.shots, at200: sEsc2.shots });
  check('A.escape 16: still zero live timers 200 ms later (nothing rescheduled itself)', pendEsc2 === 0, pendEsc2);
  await settleRaf(page);
  const rafEsc = await api.pendingRaf(page);
  check('A.escape 16: zero live animation frames after two rAF turns (no self-rescheduling RAF loop survived the exit)', rafEsc === 0, rafEsc);
  await page.mouse.up();
  check('A.escape: html lacks crs-active class', await page.evaluate(() => !document.documentElement.classList.contains('crs-active')));
  check('A.escape: crash:state active:false message sent', await page.evaluate(() => (window.__crsMessages || []).some((m) => m && m.type === 'crash:state' && m.active === false)));
  check('A.escape: still no [data-crs] nodes after the late mouse.up', (await api.count(page, '[data-crs]')) === 0);
  const btn2 = await api.rect(page, '#test-btn');
  await page.mouse.click(btn2.cx, btn2.cy);
  check('A.escape: button click handler runs after exit (listeners gone)', await poll(() => page.evaluate(() => window.__btnClicks === 1), 1000), await page.evaluate(() => window.__btnClicks));
  const lk2 = await api.rect(page, '#card-link');
  await page.mouse.click(lk2.cx, lk2.cy);
  check('A.escape: link click navigates after exit (hash "#nav", handler ran once)', await poll(() => page.evaluate(() => location.hash === '#nav' && window.__linkClicks === 1), 1000), await page.evaluate(() => ({ hash: location.hash, clicks: window.__linkClicks })));
  await page.evaluate(() => { history.replaceState(null, '', location.pathname); window.scrollTo(0, 0); });

  // --- re-evaluate toggles ----------------------------------------------------------------------
  const r2 = await page.evaluate(contentJs);
  check('A.toggle: re-evaluating content.js returns "on"', r2 === 'on', r2);
  check('A.toggle: active again, .crs-canvas present', (await api.active(page)) && (await api.has(page, '.crs-canvas')));
  check('A.toggle: api.debug flags survive the toggle (plain object, A12)', await page.evaluate(() => { const d = window.__crashScreen.debug; return !!d && d.noCrit === true && d.noCooldown === true; }));
  const r3 = await page.evaluate(contentJs);
  check('A.toggle: evaluating again returns "off"', r3 === 'off', r3);
  check('A.toggle: no [data-crs] nodes after off', (await api.count(page, '[data-crs]')) === 0);
  check('A.toggle: zero live content-script timers after off (ledger)', (await api.pending(page)) === 0, await api.pending(page));
  await settleRaf(page);
  check('A.toggle: zero live animation frames after off (RAF ledger)', (await api.pendingRaf(page)) === 0, await api.pendingRaf(page));

  // ======================================================================================  // v1.5 — weapon art / viewmodel / per-weapon stats / pierce (SPEC-weapons §6 items 1-14; SPEC-combat-v2
  // §10.6 items 5-6). Wrapped in its own block so locals (W, DMG, near, …) don't collide with same-named
  // consts already bound earlier in this function. Content.js was left INACTIVE by the "A.toggle" block
  // right above (the r2/r3 sequence) — reactivate first, run everything active, and end on the §6 item 13
  // Escape test so the suite-closing console/CSP checks below find exactly the same (inactive, 0 nodes)
  // state those checks already relied on before this block existed.
  // =============================================================================================
  {
    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    // A flat sleep() assumes the draw/holster WAAPI one-shot has already handed back to the idle bob by
    // the time it elapses; under this suite's cumulative load (~90 s of DOM/animation work by the time this
    // block runs) that is not always true within the nominal swapMs window. Polling the actual phase is the
    // robust version of the same wait — same pattern item 3 already uses for its own draw/idle checks.
    const waitViewmodelIdle = (timeout) => poll(async () => { const s = await api.stats(page); return s.viewmodel === 'idle' ? s : null; }, timeout || 800, 20);
    const rOnV15 = await page.evaluate(contentJs);
    check('A.weapons 0: content.js reactivated for the v1.5 weapon/viewmodel/pierce block', rOnV15 === 'on', rOnV15);
    await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: false });
    await api.applyPreset(page, 'default');
    await api.setWeapon(page, 'hammer');
    await api.restore(page);
    await sleep(100);
    const W = await weaponTable(page);
    const DMG = W.dmg;

    // ---- (1) weaponArt(id, size): an <svg> per weapon, 10 distinct silhouettes, no innerHTML anywhere ----
    const WEAPON_SVG_IDS = WEAPON_IDS;   // the same 10 ids, default-preset order
    const artInfos = {};
    for (const id of WEAPON_SVG_IDS) artInfos[id] = await api.weaponArtInfo(page, id, 120);
    const artOk = WEAPON_SVG_IDS.every((id) => artInfos[id] && artInfos[id].ok === true && artInfos[id].childCount >= 3);
    check('A.weapons 1: weaponArt(id, 120) returns an <svg> with ≥ 3 child nodes for all 10 weapons', artOk, artInfos);
    const sigs = WEAPON_SVG_IDS.map((id) => artInfos[id] && artInfos[id].pathSig).filter((s) => typeof s === 'string' && s.length);
    check('A.weapons 1: all 10 weapons render a distinct set of path shapes (silhouettes differ)', artOk && new Set(sigs).size === WEAPON_SVG_IDS.length, sigs.map((s) => s.length));
    // static grep (SPEC §6 item 1): the weapon-art/viewmodel/weapon modules never use innerHTML / outerHTML /
    // insertAdjacentHTML / document.write / eval( / new Function / setAttribute('style' — same patterns
    // tools/validate.js's FORBIDDEN_INJECTED rule enforces repo-wide; re-checked here, scoped to the modules
    // this v1.5 task owns, so this assertion stands on its own even before `node tools/validate.js` runs.
    const V15_SRC_FILES = ['44-weapon-art.js', '46-viewmodel.js', '71-weapon-helpers.js', '73-hit-resolution.js', '76-weapon-fire.js', '79-weapon-actions.js', '82-ammo-reload.js', '83-scope.js', '84-sniper.js'];
    const BANNED_PATTERNS = [
      { label: 'innerHTML', re: /\binnerHTML\b/ },
      { label: 'outerHTML', re: /\bouterHTML\b/ },
      { label: 'insertAdjacentHTML', re: /\binsertAdjacentHTML\b/ },
      { label: 'document.write', re: /\bdocument\s*\.\s*write\b/ },
      { label: 'eval(', re: /\beval\s*\(/ },
      { label: 'new Function', re: /\bnew\s+Function\b/ },
      { label: "setAttribute('style'", re: /setAttribute\s*\(\s*['"]style['"]/ },
    ];
    // Comment-aware strip (string literals are left intact — the setAttribute('style') pattern needs its
    // quoted argument to still match) so an explanatory comment that merely NAMES a banned call (e.g.
    // "never setAttribute('style')", written as prose) can't trip this as a false positive — only
    // non-comment text is matched. Not a full JS parser (a regex literal containing "//" is the one known
    // blind spot), but good enough for this codebase's style.
    function stripJsComments(src) {
      let out = '', mode = null;
      for (let i = 0; i < src.length; i++) {
        const c = src[i], c2 = src[i + 1];
        if (mode === 'line') { if (c === '\n') { mode = null; out += c; } continue; }
        if (mode === 'block') { if (c === '*' && c2 === '/') { mode = null; i++; } continue; }
        if (mode === 'sq' || mode === 'dq' || mode === 'tpl') {
          out += c;
          if (c === '\\') { out += src[i + 1] || ''; i++; continue; }
          if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = null;
          continue;
        }
        if (c === '/' && c2 === '/') { mode = 'line'; i++; continue; }
        if (c === '/' && c2 === '*') { mode = 'block'; i++; continue; }
        if (c === "'") { mode = 'sq'; out += c; continue; }
        if (c === '"') { mode = 'dq'; out += c; continue; }
        if (c === '`') { mode = 'tpl'; out += c; continue; }
        out += c;
      }
      return out;
    }
    const srcDirV15 = path.join(ROOT, 'src');
    const presentFiles = V15_SRC_FILES.filter((f) => fs.existsSync(path.join(srcDirV15, f)));
    const bannedHits = [];
    for (const f of presentFiles) {
      const code = stripJsComments(fs.readFileSync(path.join(srcDirV15, f), 'utf8'));
      for (const pat of BANNED_PATTERNS) if (pat.re.test(code)) bannedHits.push(`${f}: ${pat.label}`);
    }
    if (presentFiles.length === 0) info('A.weapons 1: static grep skipped — none of the v1.5 weapon modules exist in src/ yet (product not implemented in this worktree snapshot)');
    check('A.weapons 1: static grep — no innerHTML/outerHTML/insertAdjacentHTML/document.write/eval/new Function/setAttribute("style") in the weapon-art/viewmodel/weapon modules that exist so far', bannedHits.length === 0, presentFiles.length ? bannedHits : 'no v1.5 src files present yet');

    // ---- api.weapons() stat-table contract (SPEC §3.1): swapMs/recoil/bloom/critChance/knockback/moveSpeed/
    // falloff/pierce/aoeIgnoresCover for all 10 weapons. moveSpeed is checked as a STAT VALUE ONLY — the
    // `survival`-mode drone avatar it is meant to drive does not exist in this worktree yet (see
    // v15-handoff.md), so §6 item 12's movement-DISTANCE assertion is deliberately not written here.
    const statFields = ['swapMs', 'recoil', 'bloom', 'critChance', 'knockback', 'moveSpeed', 'falloff'];
    const statMismatches = [];
    for (const id of WEAPON_IDS) {
      const got = W.byId[id] || {};
      const want = SPEC_STATS[id];
      for (const f of statFields) if (!(typeof got[f] === 'number' && Math.abs(got[f] - want[f]) < 0.005)) statMismatches.push(`${id}.${f}: got ${got[f]}, want ${want[f]}`);
      if (!pierceMatches(got.pierce, SPEC_PIERCE[id])) statMismatches.push(`${id}.pierce: got ${got.pierce}, want ${SPEC_PIERCE[id] === Infinity ? "'all'" : SPEC_PIERCE[id]}`);
    }
    check('A.weapons 1/3.1: api.weapons() exposes swapMs/recoil/bloom/critChance/knockback/moveSpeed/falloff/pierce matching SPEC-weapons §3.1 for all 10 weapons (moveSpeed: stat value only, not yet wired to movement)', statMismatches.length === 0, statMismatches);
    check('A.weapons 3.1: api.weapons() marks rocket and bomb aoeIgnoresCover === true (explosions ignore cover/depth per SPEC-combat-v2 §10.3-3)', (W.byId.rocket && W.byId.rocket.aoeIgnoresCover === true) && (W.byId.bomb && W.byId.bomb.aoeIgnoresCover === true), { rocket: W.byId.rocket && W.byId.rocket.aoeIgnoresCover, bomb: W.byId.bomb && W.byId.bomb.aoeIgnoresCover });

    // ---- (2) viewmodel existence: default (true) → exactly 1 .crs-viewmodel with 1 <svg>; off → 0 -----------
    // No options page exists in this worktree yet (SPEC-weapons §3.3's comparison table is a later addition),
    // so the `viewmodel: bool` option is reached the same way every other boolean setting in this codebase
    // is reached pre-options-page: a chrome.storage.sync key read once at content.js's first-ever injection
    // on a page. Assumed key name `crsViewmodel` (camelCase `crs<Thing>`, matching crsWeapon/crsMode/crsPower/
    // crsMuted/crsLoadout/crsLoadoutPreset/crsCombat already in content.js) — flagged here since the spec
    // itself doesn't name a storage key; a differently-named key is a TEST-SIDE fix once the product exists.
    // Run on throwaway pages (fresh goto + chrome shim + first injection) so the main suite page's live
    // content-script instance (settings read once, not on toggle) is never disturbed.
    async function bootViewmodelPage(viewmodelOff) {
      const p2 = await browser.newPage();
      await p2.setViewport(VIEWPORT);
      await p2.goto(`${origin}/`, { waitUntil: 'load' });
      const c2 = await injectCss(p2, contentCss);
      await p2.evaluate(TIMER_LEDGER);
      await p2.evaluate(CHROME_SHIM);
      if (viewmodelOff) await p2.evaluate(() => { window.__crsStore.crsViewmodel = false; });
      const onRet = await p2.evaluate(contentJs);
      await sleep(350);   // let the draw-in animation settle into steady idle
      const info2 = await p2.evaluate(() => {
        const nodes = document.querySelectorAll('.crs-viewmodel');
        const svgs = nodes.length === 1 ? nodes[0].querySelectorAll('svg').length : -1;
        return { count: nodes.length, svgCount: svgs };
      });
      try { await c2.detach(); } catch (e) { /* ignore */ }
      await p2.close();
      return { on: onRet, count: info2.count, svgCount: info2.svgCount };
    }
    const vmDefault = await bootViewmodelPage(false);
    check('A.weapons 2: default settings (viewmodel: true) → exactly one .crs-viewmodel containing exactly one <svg>', vmDefault.on === 'on' && vmDefault.count === 1 && vmDefault.svgCount === 1, vmDefault);
    const vmOff = await bootViewmodelPage(true);
    check('A.weapons 2: viewmodel option off (crsViewmodel: false in storage, assumed key — see note above) → zero .crs-viewmodel nodes', vmOff.on === 'on' && vmOff.count === 0, vmOff);

    // ---- (3) draw: switching weapon → viewmodel "draw" within 150 ms, smashAt() false meanwhile, "idle"
    //     again once swapMs has elapsed -------------------------------------------------------------------
    // The swap/draw gate (swapActive()) is itself wired to debug.noCooldown ("!debug.noCooldown && now() <
    // state.swapUntil" — the same flag also used for the ordinary post-shot cooldown), so the suite's
    // baseline noCooldown:true would silently bypass it and let smashAt() fire immediately regardless of
    // the draw. Turn it off for just this gate check, restore the baseline after.
    await api.debug(page, { noCooldown: false });
    await api.restore(page);
    await api.setWeapon(page, 'hammer');
    await sleep(600);
    const rocketSwapMs = (W.byId.rocket && typeof W.byId.rocket.swapMs === 'number') ? W.byId.rocket.swapMs : SPEC_STATS.rocket.swapMs;
    await api.setWeapon(page, 'rocket');
    const drawState = await poll(async () => { const s = await api.stats(page); return s.viewmodel === 'draw' ? s : null; }, 150, 10);
    check('A.weapons 3: switching weapon enters stats().viewmodel === "draw" within 150 ms', !!drawState, drawState);
    const pt3 = await arenaPt(page);
    const duringDraw = await api.smashAt(page, pt3.x, pt3.y, null);
    check('A.weapons 3: smashAt() returns false while still drawing (cannot fire during the swap)', duringDraw === false, duringDraw);
    await sleep(rocketSwapMs + 80);
    const idleAfterDraw = await poll(async () => { const s = await api.stats(page); return s.viewmodel === 'idle' ? s : null; }, 300, 20);
    check(`A.weapons 3: once swapMs (${rocketSwapMs} ms) has elapsed, stats().viewmodel returns to "idle"`, !!idleAfterDraw, idleAfterDraw);
    await api.debug(page, { noCooldown: true });

    // ---- (4) recoil: firing → viewmodel "fire" + transform differs from idle; 200 ms later, back within
    //     ±2 px ---------------------------------------------------------------------------------------------
    await api.restore(page);
    await api.setWeapon(page, 'pistol');
    const settled4 = await waitViewmodelIdle();
    check('A.weapons 4 setup: viewmodel reaches "idle" after the pistol draw (precondition for the recoil measurement below)', !!settled4, settled4);
    const base4 = await api.viewmodelXform(page);
    const pt4 = await arenaPt(page);
    await page.mouse.click(pt4.x, pt4.y);
    const fireState4 = await poll(async () => { const s = await api.stats(page); return s.viewmodel === 'fire' ? s : null; }, 150, 5);
    const duringFire4 = await api.viewmodelXform(page);
    const moved4 = !!(base4 && duringFire4 && (Math.abs(duringFire4.tx - base4.tx) > 1 || Math.abs(duringFire4.ty - base4.ty) > 1 || Math.abs(duringFire4.angle - base4.angle) > 1));
    check('A.weapons 4: firing → stats().viewmodel === "fire" and the viewmodel transform differs from its pre-fire pose', !!fireState4 && moved4, { fireState4, base4, duringFire4 });
    await waitViewmodelIdle();
    const after4 = await api.viewmodelXform(page);
    check('A.weapons 4: 200 ms after the shot, the viewmodel is back within ±2 px of its pre-fire translate', !!after4 && near(after4.tx, base4.tx, 2) && near(after4.ty, base4.ty, 2), { base4, after4 });

    // ---- (5) melee swing: a hammer shot rotates the viewmodel past 30° at some frame (the swing, not the
    //     ~7° gun recoil) ----------------------------------------------------------------------------------
    await api.restore(page);
    await api.setWeapon(page, 'hammer');
    await waitViewmodelIdle();
    const pt5 = await arenaPt(page);
    await page.mouse.click(pt5.x, pt5.y);
    let maxAngle5 = 0;
    const t5 = Date.now();
    while (Date.now() - t5 < 260) {
      const x = await api.viewmodelXform(page);
      if (x) maxAngle5 = Math.max(maxAngle5, Math.abs(x.angle));
      await sleep(15);
    }
    check('A.weapons 5: a hammer hit rotates the viewmodel past 30° at some sampled frame (melee swing, well beyond the ~7° gun-recoil rotation)', maxAngle5 > 30, { maxAngle5 });

    // ---- (6) reload: emptying the pistol's magazine → viewmodel "reload" during the reload, "idle" once
    //     it finishes ------------------------------------------------------------------------------------
    await api.debug(page, { fastReload: false, infiniteAmmo: false });
    await api.restore(page);
    await api.setWeapon(page, 'pistol');
    await api.reload(page);
    await poll(async () => { const m = await api.ammo(page); return m && m.mag === 12 && !m.reloading; }, 1200, 20);
    const pt6 = await arenaPt(page);
    // The 12th shot's spend() → startReload() → vmReload() chain is fully synchronous (confirmed by reading
    // stats().viewmodel back inside this SAME evaluate call), so phase 'reload' is already set by the time
    // this promise resolves; the poll below exists only as a safety margin against CDP round-trip jitter.
    const loopResult6 = await page.evaluate((p) => { const a = window.__crashScreen; for (let i = 0; i < 12; i++) a.smashAt(p.x, p.y); return { ammo: a.ammo(), viewmodel: a.stats().viewmodel }; }, pt6);
    const reloadState6 = await poll(async () => { const s = await api.stats(page); return s.viewmodel === 'reload' ? s : null; }, 400, 15);
    check('A.weapons 6: emptying the pistol magazine triggers an auto-reload during which stats().viewmodel === "reload"', !!reloadState6, { reloadState6, loopResult6 });
    const idleAfterReload6 = await poll(async () => { const m = await api.ammo(page); const s = await api.stats(page); return (m && m.mag === 12 && !m.reloading && s.viewmodel === 'idle') ? { m, s } : null; }, 1300, 20);
    check('A.weapons 6: once the reload finishes (magazine full again), stats().viewmodel returns to "idle"', !!idleAfterReload6, idleAfterReload6);
    await api.debug(page, { fastReload: true });

    // ---- (7) scope: scoping in with the sniper hides the viewmodel; scoping out shows it again -----------
    await api.restore(page);
    await api.setWeapon(page, 'sniper');
    await waitViewmodelIdle();
    const beforeScope7 = await api.viewmodelXform(page);
    await api.scope(page, true);
    const scopedHidden7 = await poll(async () => {
      const s = await api.stats(page); const x = await api.viewmodelXform(page);
      return (s.viewmodel === 'hidden' || (x && (x.hidden || x.opacity <= 0.05 || x.visibility === 'hidden'))) ? { s, x } : null;
    }, 500, 15);
    check('A.weapons 7: scoping in with the sniper hides .crs-viewmodel (stats().viewmodel === "hidden", or opacity 0 / [hidden]) within ~500 ms', !!scopedHidden7, { beforeScope7, scopedHidden7 });
    await api.scope(page, false);
    const unscopedVisible7 = await poll(async () => { const x = await api.viewmodelXform(page); return (x && !x.hidden && x.opacity > 0.5 && x.visibility !== 'hidden') ? x : null; }, 500, 15);
    check('A.weapons 7: scoping back out shows the viewmodel again', !!unscopedVisible7, unscopedVisible7);

    // ---- (8) swapMs: switching to rocket (480 ms) takes ≥ 250 ms longer to become shootable than switching
    //     to pistol (150 ms) ------------------------------------------------------------------------------
    async function timeToFirable(weaponId, pt) {
      await api.setWeapon(page, weaponId);
      const t0 = Date.now();
      for (;;) {
        const ok = await api.smashAt(page, pt.x, pt.y, null);
        if (ok) return Date.now() - t0;
        if (Date.now() - t0 > 1200) return null;
        await sleep(8);
      }
    }
    // Same swapActive()/debug.noCooldown coupling as item 3 — off for the measurement, back on after.
    await api.debug(page, { noCooldown: false });
    await api.restore(page);
    const pt8 = await arenaPt(page);
    await api.setWeapon(page, 'hammer'); await sleep(50);
    const tPistol8 = await timeToFirable('pistol', pt8);
    await sleep(300);
    await api.setWeapon(page, 'hammer'); await sleep(50);
    const tRocket8 = await timeToFirable('rocket', pt8);
    const diff8 = (tRocket8 != null && tPistol8 != null) ? tRocket8 - tPistol8 : null;
    check('A.weapons 8: swapMs — time-to-first-shot after switching to rocket (480 ms) is at least 250 ms longer than switching to pistol (150 ms)', tPistol8 != null && tRocket8 != null && diff8 >= 250, { tPistol8, tRocket8, diff8 });
    await api.debug(page, { noCooldown: true });

    // ---- (9) spread/bloom: holding the smg → bloomNow rises and caps at bloom×10, then decays to ~0 after
    //     resting; a scoped sniper reads spreadNow === 0 ---------------------------------------------------
    await api.debug(page, { noSpread: false });
    await api.restore(page);
    await api.setWeapon(page, 'smg');
    await sleep(300);
    const pt9 = await arenaPt(page);
    await page.mouse.move(pt9.x, pt9.y);
    await page.mouse.down();
    const bloomSamples9 = [];
    for (let i = 0; i < 20; i++) { await sleep(75); bloomSamples9.push((await api.stats(page)).bloomNow); }
    await page.mouse.up();
    const smgBloom = (W.byId.smg && typeof W.byId.smg.bloom === 'number') ? W.byId.smg.bloom : SPEC_STATS.smg.bloom;
    const bloomCap9 = smgBloom * 10;
    const nonDecreasing9 = bloomSamples9.every((v, i) => i === 0 || typeof v !== 'number' || typeof bloomSamples9[i - 1] !== 'number' || v >= bloomSamples9[i - 1] - 0.01);
    const peak9 = Math.max(...bloomSamples9.filter((v) => typeof v === 'number'));
    check('A.weapons 9: holding the smg → stats().bloomNow rises (non-decreasing) and caps at bloom × 10', nonDecreasing9 && peak9 > 0 && peak9 <= bloomCap9 + 0.5, { bloomSamples9, bloomCap9, peak9 });
    await sleep(2200);   // > 0.4 s grace + time to decay bloom×10 px at 40 px/s
    const restedBloom9 = (await api.stats(page)).bloomNow;
    check('A.weapons 9: after resting well past the 0.4 s grace, bloomNow has decayed back to ~0', typeof restedBloom9 === 'number' && restedBloom9 <= 2, restedBloom9);
    await api.setWeapon(page, 'sniper');
    await sleep(500);
    await api.scope(page, true);
    await poll(async () => (await api.stats(page)).scoped === true, 300, 15);
    const sniperSpreadNow9 = (await api.stats(page)).spreadNow;
    check('A.weapons 9: a scoped sniper reads stats().spreadNow === 0', sniperSpreadNow9 === 0, sniperSpreadNow9);
    await api.scope(page, false);
    await api.debug(page, { noSpread: true });

    // ---- (10) crit rate: 200 sword hits (seeded RNG override of Math.random, so a failure reproduces) land
    //     a critChance 0.20 ± 0.08 fraction of crits ------------------------------------------------------
    await api.debug(page, { noCrit: false, forceCrit: false });
    await api.setWeapon(page, 'sword');
    const pt10 = await arenaPt(page);
    const CRIT_SEED = 0xA53F9021;
    info(`A.weapons 10: crit-rate seed = 0x${CRIT_SEED.toString(16)} (200 sword hits on #arena, restored fresh each hit) — reproduce a failure by rerunning with the same seed`);
    // restore() zeroes state.crits (it is a per-session counter, reset for every fresh target along with
    // shots/damageDealt/etc.), so a naive before/after read across the WHOLE loop would only ever see the
    // last iteration's 0-or-1 — each hit's crit flag is read and accumulated BEFORE the next restore() wipes it.
    const crit10 = await page.evaluate((seed, pt) => {
      const a = window.__crashScreen;
      let s = (seed >>> 0) || 1;
      const realRandom = Math.random;
      Math.random = function () {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        return (s >>> 0) / 4294967296;
      };
      let hits = 0;
      for (let i = 0; i < 200; i++) {
        a.restore();
        a.smashAt(pt.x, pt.y);
        hits += a.stats().crits;   // 0 or 1 — restore() hasn't run again yet, so this iteration's flag is still intact
      }
      Math.random = realRandom;
      return { hits };
    }, CRIT_SEED, pt10);
    const swordCritChance = (W.byId.sword && typeof W.byId.sword.critChance === 'number') ? W.byId.sword.critChance : SPEC_STATS.sword.critChance;
    const critRate10 = crit10.hits / 200;
    check(`A.weapons 10: sword crit rate over 200 hits (seeded RNG, no debug.forceCrit) is ${swordCritChance.toFixed(2)} ± 0.08`, Math.abs(critRate10 - swordCritChance) <= 0.08, { seed: '0x' + CRIT_SEED.toString(16), crit10, critRate10, swordCritChance });
    await api.debug(page, { noCrit: true, forceCrit: false });
    await api.restore(page);

    // ---- (11) falloff: pistol hit near screen-centre vs far from it does different damage (±1 of the
    //     1 − falloff·min(dist,900)/900 formula); hammer (falloff 0) is identical at both distances.
    //     Falloff is origin-gated by BOTH debug.noSpread and debug.noFalloff (either one forces mult 1), so
    //     the suite's baseline noSpread:true — which would otherwise silently zero this whole test — is
    //     turned off for just this block. Pistol's own `spread` stat is unset (0) and each hit is taken via
    //     hitFresh() on a freshly-restored target (no prior shot to leave a recoilKick behind), so the aim
    //     still lands exactly on the clicked point even with noSpread off. -----------------------------------
    await api.debug(page, { infiniteAmmo: true, noSpread: false, noFalloff: false });
    const rArena11 = await api.rect(page, '#arena');
    const viewDims11 = await page.evaluate(() => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }));
    const centreX11 = viewDims11.w / 2, centreY11 = viewDims11.h / 2;
    const nearPt11 = { x: rArena11.cx, y: rArena11.cy };
    const farPt11 = { x: rArena11.left + 20, y: rArena11.cy };
    const distNear11 = Math.hypot(nearPt11.x - centreX11, nearPt11.y - centreY11);
    const distFar11 = Math.hypot(farPt11.x - centreX11, farPt11.y - centreY11);
    const falloffMult = (f, d) => 1 - f * Math.min(d, 900) / 900;
    const pistolFalloff11 = (W.byId.pistol && typeof W.byId.pistol.falloff === 'number') ? W.byId.pistol.falloff : SPEC_STATS.pistol.falloff;
    const pistolDmg11 = DMG('pistol');
    const expNear11 = Math.round(pistolDmg11 * falloffMult(pistolFalloff11, distNear11));
    const expFar11 = Math.round(pistolDmg11 * falloffMult(pistolFalloff11, distFar11));
    const hitNearP11 = await hitFresh(page, 'pistol', nearPt11, '#arena');
    const hitFarP11 = await hitFresh(page, 'pistol', farPt11, '#arena');
    const dmgNearP11 = hitNearP11.max - hitNearP11.hp;
    const dmgFarP11 = hitFarP11.max - hitFarP11.hp;
    check('A.weapons 11: pistol falloff — a far-from-centre hit does less damage than a near-centre hit, both within ±1 of the 1 − falloff·min(dist,900)/900 formula', dmgFarP11 < dmgNearP11 && Math.abs(dmgNearP11 - expNear11) <= 1 && Math.abs(dmgFarP11 - expFar11) <= 1, { dmgNearP11, dmgFarP11, expNear11, expFar11, distNear11, distFar11, pistolFalloff11 });
    const hammerFalloff11 = (W.byId.hammer && typeof W.byId.hammer.falloff === 'number') ? W.byId.hammer.falloff : SPEC_STATS.hammer.falloff;
    const hitNearH11 = await hitFresh(page, 'hammer', nearPt11, '#arena');
    const hitFarH11 = await hitFresh(page, 'hammer', farPt11, '#arena');
    const dmgNearH11 = hitNearH11.max - hitNearH11.hp;
    const dmgFarH11 = hitFarH11.max - hitFarH11.hp;
    check('A.weapons 11: hammer (falloff 0) deals identical damage near and far from centre', hammerFalloff11 === 0 && dmgNearH11 === dmgFarH11, { dmgNearH11, dmgFarH11, hammerFalloff11 });
    await api.debug(page, { infiniteAmmo: false, noSpread: true, noFalloff: true });

    // ---- (12) moveSpeed — already asserted as a STAT above (see the api.weapons() stat-table check); the
    //     §6 item 12 movement-DISTANCE ratio (rocket 0.80 vs sword 1.15, holding "D" 400 ms) needs the
    //     `survival`-mode drone avatar, which this worktree does not have yet (owned by the parallel combat
    //     workstream) — see v15-handoff.md. Leaving this as an explicit, honest gap rather than a fake pass.
    info('A.weapons 12: movement-distance ratio test deferred — no survival-mode drone avatar exists in this worktree yet (moveSpeed stat values are covered by the api.weapons() table check above; see v15-handoff.md)');

    // =============================================================================================
    // SPEC-combat-v2 §10.6 items 5-6 — pierce / "explosions ignore cover" on the new overlapping
    // #pierce-front / #pierce-back fixture pair (test/fixture.html).
    // =============================================================================================
    await api.debug(page, { noCrit: true, infiniteAmmo: true, noCooldown: true, noSpread: true });
    await api.restore(page);
    const rFrontP = await api.rect(page, '#pierce-front');
    const rBackP = await api.rectNoScroll(page, '#pierce-back');
    const ovLeft = Math.max(rFrontP.left, rBackP.left), ovRight = Math.min(rFrontP.right, rBackP.right);
    const ovTop = Math.max(rFrontP.top, rBackP.top), ovBottom = Math.min(rFrontP.bottom, rBackP.bottom);
    const ovPt = { x: (ovLeft + ovRight) / 2, y: (ovTop + ovBottom) / 2 };
    check('A.pierce setup: #pierce-front and #pierce-back genuinely overlap on screen (positive-area overlap rect)', ovRight > ovLeft && ovBottom > ovTop, { rFrontP, rBackP, ovPt });

    const sniperDmg56 = DMG('sniper');
    const hitFrontSniper56 = await hitFresh(page, 'sniper', ovPt, '#pierce-front');
    const hitBackSniper56 = await hitFresh(page, 'sniper', ovPt, '#pierce-back');
    const dmgFrontSniper56 = hitFrontSniper56.max - hitFrontSniper56.hp;
    const dmgBackSniper56 = hitBackSniper56.max - hitBackSniper56.hp;
    const expectedBackSniper56 = Math.round(sniperDmg56 * 0.6);
    check('A.combat-v2 §10.6-5: sniper (pierce 2) at the overlap point → front card takes full damage, back card takes ~60% (pierce layer 1, ×0.6)', dmgFrontSniper56 === sniperDmg56 && Math.abs(dmgBackSniper56 - expectedBackSniper56) <= 1, { dmgFrontSniper56, dmgBackSniper56, sniperDmg56, expectedBackSniper56 });

    const pistolDmg56 = DMG('pistol');
    const hitFrontPistol56 = await hitFresh(page, 'pistol', ovPt, '#pierce-front');
    const hitBackPistol56 = await hitFresh(page, 'pistol', ovPt, '#pierce-back');
    const dmgFrontPistol56 = hitFrontPistol56.max - hitFrontPistol56.hp;
    const dmgBackPistol56 = hitBackPistol56.max - hitBackPistol56.hp;
    check('A.combat-v2 §10.6-5: pistol (pierce 0) at the same overlap point → front still takes full damage, back takes 0 (no pierce)', dmgFrontPistol56 === pistolDmg56 && dmgBackPistol56 === 0, { dmgFrontPistol56, dmgBackPistol56, pistolDmg56 });

    const hitBackRocket56 = await hitFresh(page, 'rocket', ovPt, '#pierce-back');
    const dmgBackRocket56 = hitBackRocket56.max - hitBackRocket56.hp;
    const hitFrontRocket56 = await hitFresh(page, 'rocket', ovPt, '#pierce-front');
    const dmgFrontRocket56 = hitFrontRocket56.max - hitFrontRocket56.hp;
    check('A.combat-v2 §10.6-6: a rocket aimed at the overlap point damages the occluded back card (AoE ignores cover/depth — aoeIgnoresCover)', dmgBackRocket56 > 0, hitBackRocket56);
    check('A.combat-v2 §10.6-6: the same rocket also damages the unoccluded front card at that point', dmgFrontRocket56 > 0, hitFrontRocket56);
    await api.debug(page, { infiniteAmmo: false, noSpread: true, noFalloff: true });

    // ---- (14) motion reduced: no idle wobble; recoil amplitude ≤ half of normal-motion recoil (still non-
    //     zero — information must still read) --------------------------------------------------------------
    await api.restore(page);
    await api.setWeapon(page, 'pistol');
    await waitViewmodelIdle();
    const idleSamplesNormal14 = [];
    for (let i = 0; i < 8; i++) { idleSamplesNormal14.push(await api.viewmodelXform(page)); await sleep(150); }
    const idleRangeNormal14 = Math.max(...idleSamplesNormal14.map((s) => s.ty)) - Math.min(...idleSamplesNormal14.map((s) => s.ty));
    const baseIdle14 = await api.viewmodelXform(page);
    const ptFire14 = await arenaPt(page);
    await page.mouse.click(ptFire14.x, ptFire14.y);
    let maxDevNormal14 = 0;
    const tN14 = Date.now();
    while (Date.now() - tN14 < 220) { const x = await api.viewmodelXform(page); if (x && baseIdle14) maxDevNormal14 = Math.max(maxDevNormal14, Math.hypot(x.tx - baseIdle14.tx, x.ty - baseIdle14.ty)); await sleep(12); }
    await sleep(250);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await api.restore(page);
    await api.setWeapon(page, 'pistol');
    await waitViewmodelIdle();
    const idleSamplesRM14 = [];
    for (let i = 0; i < 8; i++) { idleSamplesRM14.push(await api.viewmodelXform(page)); await sleep(150); }
    const idleRangeRM14 = Math.max(...idleSamplesRM14.map((s) => s.ty)) - Math.min(...idleSamplesRM14.map((s) => s.ty));
    check('A.weapons 14: prefers-reduced-motion → idle wobble suppressed (viewmodel Y stays flat) vs the normal idle sine sweep', idleRangeRM14 <= 0.5 && idleRangeNormal14 > 0.5, { idleRangeNormal14, idleRangeRM14 });
    const baseIdleRM14 = await api.viewmodelXform(page);
    await page.mouse.click(ptFire14.x, ptFire14.y);
    let maxDevRM14 = 0;
    const tR14 = Date.now();
    while (Date.now() - tR14 < 220) { const x = await api.viewmodelXform(page); if (x && baseIdleRM14) maxDevRM14 = Math.max(maxDevRM14, Math.hypot(x.tx - baseIdleRM14.tx, x.ty - baseIdleRM14.ty)); await sleep(12); }
    check('A.weapons 14: prefers-reduced-motion → recoil is still present but its amplitude is at most half of normal motion\'s', maxDevRM14 > 0 && maxDevRM14 <= maxDevNormal14 * 0.5 + 0.5, { maxDevNormal14, maxDevRM14 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

    // ---- (13) traceless: Escape while the viewmodel idle animation is running → inactive, zero [data-crs]
    //     nodes, zero live timers/RAF, zero running WAAPI animations (this is the LAST test in this block —
    //     it leaves the page inactive, matching the state the "A.toggle"/"console/CSP" checks below already
    //     expect) -----------------------------------------------------------------------------------------
    await api.restore(page);
    await api.setWeapon(page, 'pistol');
    await waitViewmodelIdle();
    const vmBefore13 = await api.has(page, '.crs-viewmodel');
    const animsBefore13 = await api.animCount(page);
    check('A.weapons 13: before Escape, the viewmodel idle wobble is a live WAAPI animation (.crs-viewmodel present, ≥ 1 running animation)', vmBefore13 === true && animsBefore13 >= 1, { vmBefore13, animsBefore13 });
    await page.keyboard.press('Escape');
    const inactive13 = await poll(async () => !(await api.active(page)), 1500, 20);
    const nodes13 = await api.count(page, '[data-crs]');
    await settleRaf(page);
    const pend13 = await api.pending(page);
    const raf13 = await api.pendingRaf(page);
    const anims13 = await api.animCount(page);
    check('A.weapons 13: Escape during the viewmodel idle animation → inactive, zero [data-crs] nodes, zero live timers/RAF frames, zero running animations', inactive13 === true && nodes13 === 0 && pend13 === 0 && raf13 === 0 && anims13 === 0, { inactive13, nodes13, pend13, raf13, anims13 });
  }
  // --- v1.4: combat v2 / debris lifetime / depth-of-stack (SPEC-combat-v2 §7, §9.4, §10.6) -----------
  await suiteA14(page, log, contentJs);

  // --- console / CSP -----------------------------------------------------------------------------
  const v = await violations(page);
  check('A.console: zero error-level console messages', log.consoleErrors.length === 0, log.consoleErrors[0]);
  check('A.console: zero page errors', log.pageErrors.length === 0, log.pageErrors[0]);
  check('A.csp: zero securitypolicyviolation events', v.length === 0, v[0]);
  check('A.stats: stats().lastError === null for the whole suite', (await api.stats(page)).lastError === null, (await api.stats(page)).lastError);

  try { await client.detach(); } catch (_) { /* ignore */ }
  await page.close();
}

// ---------------------------------------------------------------------------
// v1.2 — FPS layer (SPEC-v3 §8 as amended by A13): ammo / reload, swap delay, sniper + scope, loadouts,
// hostile components, KO, pause and exit. Runs inside suite A between the hostile-DOM blocks and the
// v1 Escape test; it ends inactive (test 12) and re-evaluates content.js so the v1 blocks after it still run.
// ---------------------------------------------------------------------------
// MutationObserver ledger for transient glass-root nodes (orbs can live a single frame): first-seen times per
// selector plus every .crs-dmg text, so "seen" assertions never depend on polling luck.
async function installWatcher(page) {
  await page.evaluate(() => {
    if (window.__crsSeen) return;
    const SELS = ['.crs-orb', '.crs-vignette', '.crs-warn', '.crs-beam', '.crs-beam.telegraph', '.crs-beam.crs-beam-lock', '.crs-beam.fire', '.crs-tracer', '.crs-hostile', '.crs-scope'];
    const seen = { dmgTexts: [] };
    const noteDmg = (el) => {
      const list = el.matches('.crs-dmg') ? [el] : [...el.querySelectorAll('.crs-dmg')];
      if (!list.length) return;
      queueMicrotask(() => { for (const d of list) { const t = (d.textContent || '').trim(); if (t && !seen.dmgTexts.includes(t) && seen.dmgTexts.length < 300) seen.dmgTexts.push(t); } });
    };
    const note = (el) => {
      for (const s of SELS) { if (seen[s]) continue; try { if (el.matches(s) || el.querySelector(s)) seen[s] = Math.round(performance.now()); } catch (e) { /* ignore */ } }
      try { noteDmg(el); } catch (e) { /* ignore */ }
    };
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') { if (m.target && m.target.nodeType === 1) note(m.target); continue; }
        for (const n of m.addedNodes) if (n.nodeType === 1) note(n);
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    window.__crsSeen = seen;
    window.__crsSeenReset = () => { for (const k of Object.keys(seen)) if (k !== 'dmgTexts') delete seen[k]; seen.dmgTexts.length = 0; };
  });
}

async function suiteA12(page, log, contentJs) {
  console.log('--- v1.2: ammo / sniper + scope / loadouts / combat ---');
  const W = await weaponTable(page);
  const DMG = W.dmg;
  const errBefore = log.pageErrors.length;
  const conBefore = log.consoleErrors.length;
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  await installWatcher(page);
  // the figure centre + 500 px must stay inside the viewport (the figure sits on the right half at 1280 wide)
  const sideOf = (r) => (r.cx + 500 <= VIEWPORT.width - 10 ? 1 : -1);

  // ---- (1) ammo and reloading --------------------------------------------------------------------------
  await api.debug(page, { fastReload: false, infiniteAmmo: false });
  await api.restore(page);
  await sleep(60);
  let ap = await arenaPt(page);
  const a1 = await page.evaluate((p) => {
    const a = window.__crashScreen;
    if (typeof a.ammo !== 'function') return { missing: 'ammo' };
    a.setWeapon('pistol');
    const full = a.ammo();
    const shots = []; let after12 = null;
    for (let i = 1; i <= 13; i++) { shots.push(a.smashAt(p.x, p.y)); if (i === 12) after12 = a.ammo(); }
    return { full, shots, after12, after13: a.ammo(), stats: { mag: a.stats().mag, reloading: a.stats().reloading } };
  }, ap);
  check('A.ammo 1: pistol ammo() starts at { mag: 12, size: 12, reloading: false, swapping: false }', !!a1.full && a1.full.mag === 12 && a1.full.size === 12 && a1.full.reloading === false && a1.full.swapping === false, a1.full || a1);
  check('A.ammo 1: shots 1–12 on #arena return true, the 13th (empty magazine) returns false', Array.isArray(a1.shots) && a1.shots.slice(0, 12).every((s) => s === true) && a1.shots[12] === false, a1.shots);
  check('A.ammo 1: ammo() after the 12th shot → { mag: 0, reloading: true } (auto-reload starts on the emptying shot), reloadProgress in [0, 1]', !!a1.after12 && a1.after12.mag === 0 && a1.after12.reloading === true && typeof a1.after12.reloadProgress === 'number' && a1.after12.reloadProgress >= 0 && a1.after12.reloadProgress <= 1, a1.after12);
  check('A.ammo 1: stats().mag / stats().reloading mirror ammo() during the reload', !!a1.stats && a1.stats.mag === 0 && a1.stats.reloading === true, a1.stats);
  const reloaded1 = await poll(async () => { const m = await api.ammo(page); return m && m.mag === 12 && !m.reloading ? m : null; }, 1200, 30);
  check('A.ammo 1: magazine back to 12 and not reloading within 1.2 s (pistol reloadMs 900)', !!reloaded1, await api.ammo(page));
  check('A.ammo 1: reload() with a full magazine → false', (await api.reload(page)) === false, await api.ammo(page));
  const rk = await page.evaluate((p) => { const a = window.__crashScreen; a.smashAt(p.x, p.y); return a.ammo(); }, ap);
  await page.keyboard.press('r');
  const rkReload = await poll(async () => { const m = await api.ammo(page); return m && m.reloading ? m : null; }, 500, 15);
  check('A.ammo 1: "R" with a partly empty pistol (11/12) starts a manual reload (ammo().reloading === true)', rk.mag === 11 && !!rkReload, { before: rk, after: rkReload || await api.ammo(page) });
  // switching weapon cancels the reload: the pistol keeps its 11 rounds, still 11 one second later
  await api.setWeapon(page, 'smg');
  const smgAmmo = await api.ammo(page);
  await api.setWeapon(page, 'pistol');
  const cancel0 = await api.ammo(page);
  await sleep(1000);
  const cancel1 = await api.ammo(page);
  check('A.ammo 1: setWeapon("smg") during the pistol reload cancels it — pistol mag unchanged (11) after switching back and still 11 a second later', !!smgAmmo && smgAmmo.size === 30 && cancel0.mag === 11 && cancel0.reloading === false && cancel1.mag === 11 && cancel1.reloading === false, { smg: smgAmmo, back: cancel0, later: cancel1 });
  await api.debug(page, { fastReload: true });
  check('A.ammo 1: reload() on the 11/12 pistol → true', (await api.reload(page)) === true);
  const refilled = await poll(async () => { const m = await api.ammo(page); return m.mag === 12 && !m.reloading ? m : null; }, 600, 15);
  check('A.ammo 1: debug.fastReload → magazine full again within 600 ms', !!refilled, await api.ammo(page));
  await api.debug(page, { infiniteAmmo: true });
  const inf = await page.evaluate((p) => { const a = window.__crashScreen; const r = []; for (let i = 0; i < 20; i++) r.push(a.smashAt(p.x, p.y)); return { shots: r, ammo: a.ammo() }; }, ap);
  check('A.ammo 1: debug.infiniteAmmo → 20 shots all true and mag === size (12)', inf.shots.every((s) => s === true) && inf.ammo.mag === inf.ammo.size && inf.ammo.size === 12, inf.ammo);
  await api.debug(page, { infiniteAmmo: false });
  const ammoHudPistol = await api.hudQ(page, '.crs-ammo');
  check('A.ammo 1: .crs-ammo HUD (HUD shadow root, bottom-right) shows "12 / ∞" for a full pistol', !!ammoHudPistol && ammoHudPistol.visible && /12\s*\/\s*∞/.test(ammoHudPistol.text), ammoHudPistol);
  // v1.5 §2 (last bullet): the viewmodel layer and the ammo plate occupy the same bottom-right corner, so
  // while `.crs-viewmodel` exists (the default) the plate is lifted to bottom: 118px instead of the v1.3
  // 24px — only while the layer exists, so `viewmodel: false` restores the v1.3 24px exactly (vmLiftAmmo()).
  // right: 24px is unchanged either way.
  const hasViewmodelForAmmo = await api.has(page, '.crs-viewmodel');
  const expectedAmmoBottomMargin = hasViewmodelForAmmo ? 118 : 24;
  check('A.ammo 1: .crs-ammo sits bottom-right (right: 24px always; bottom: 118px while the viewmodel layer exists, else the v1.3 24px)', !!ammoHudPistol && near(ammoHudPistol.right, ammoHudPistol.vw - 24, 4) && near(ammoHudPistol.bottom, ammoHudPistol.vh - expectedAmmoBottomMargin, 4), ammoHudPistol && { right: ammoHudPistol.right, bottom: ammoHudPistol.bottom, vw: ammoHudPistol.vw, vh: ammoHudPistol.vh, hasViewmodelForAmmo, expectedAmmoBottomMargin });
  await api.setWeapon(page, 'hammer');
  const ammoHudHammer = await poll(async () => { const q = await api.hudQ(page, '.crs-ammo'); return q && /∞/.test(q.text) && !/\d+\s*\/\s*∞/.test(q.text) ? q : null; }, 500, 20);
  check('A.ammo 1: .crs-ammo shows "∞" (no "n / ∞") for the hammer (melee)', !!ammoHudHammer, await api.hudQ(page, '.crs-ammo'));
  // empty magazine → the "R 재장전" prompt is visible (fastReload off so the empty state lasts 900 ms).
  // Along the way: test/out/hud.png (ammo panel at ≤ 25%, pulsing red) and test/out/hud-reload.png (mid-reload).
  await api.debug(page, { fastReload: false });
  await api.setWeapon(page, 'pistol');
  await page.evaluate((p) => { const a = window.__crashScreen; for (let i = 0; i < 9; i++) a.smashAt(p.x, p.y); }, ap);
  const lowAmmo = await poll(async () => { const m = await api.ammo(page); return m.mag === 3 ? m : null; }, 400, 15);
  check('A.readability: at 3/12 (25%) the ammo count/pips enter the low (pulsing red) state', !!lowAmmo, lowAmmo || await api.ammo(page));
  await sleep(100);   // let the low-ammo colour + pulse settle before the screenshot
  await page.screenshot({ path: path.join(OUT, 'hud.png') });
  info('screenshot test/out/hud.png (ammo panel at low ammo, ≤ 25%)');
  await page.evaluate((p) => { const a = window.__crashScreen; for (let i = 0; i < 3; i++) a.smashAt(p.x, p.y); }, ap);
  const prompt = await poll(async () => { const q = await api.ammoPrompt(page); return q && q.visible ? q : null; }, 800, 25);
  check('A.ammo 1: empty magazine → the "R 재장전" prompt inside .crs-ammo is visible', !!prompt && /R\s*재장전|Reload/.test(prompt.text), prompt || await api.ammoPrompt(page));
  const reloadingShot = await poll(async () => { const m = await api.ammo(page); return m.reloading ? m : null; }, 400, 15);
  if (reloadingShot) await sleep(150);   // partway through the 900 ms reload, so the progress bar has visibly advanced
  await page.screenshot({ path: path.join(OUT, 'hud-reload.png') });
  info('screenshot test/out/hud-reload.png (ammo panel mid-reload, progress bar visible)');
  // SPEC-readability §6 assertion 2 (bullet 4): the empty-magazine prompt is a 20 px "R" keycap glyph in a
  // white-bordered box, next to the 재장전 text.
  const keycapInfo = await page.evaluate(() => {
    const sh = document.querySelector('crs-hud, .crs-hud-host').shadowRoot;
    const k = sh.querySelector('.crs-ammo .keycap');
    if (!k) return null;
    const cs = getComputedStyle(k);
    return { text: (k.textContent || '').trim(), fontSize: parseFloat(cs.fontSize), borderWidth: parseFloat(cs.borderWidth), borderColor: cs.borderColor };
  });
  check('A.readability 2: the empty-magazine prompt shows a 20 px "R" keycap glyph with a white border box', !!keycapInfo && keycapInfo.text === 'R' && near(keycapInfo.fontSize, 20, 0.5) && keycapInfo.borderWidth >= 1 && /255,\s*255,\s*255/.test(keycapInfo.borderColor), keycapInfo);
  await poll(async () => { const m = await api.ammo(page); return m.mag === 12 && !m.reloading; }, 1300, 30);
  await api.debug(page, { fastReload: true });
  // SPEC-readability §6 assertion 2 (bullets 1–3): a full pistol magazine shows 12 ammo pips (none spent),
  // the round count itself renders at 48 px, 3 shots leave 9 pips filled, and the panel's width is pinned
  // (±1 px) across a weapon swap — 교체 중 may no longer widen it.
  const pipsFull = await page.evaluate(() => {
    const sh = document.querySelector('crs-hud, .crs-hud-host').shadowRoot;
    const big = sh.querySelector('.abig');
    return { total: sh.querySelectorAll('.crs-ammo .apip').length, spent: sh.querySelectorAll('.crs-ammo .apip.spent').length, fontSize: big ? parseFloat(getComputedStyle(big).fontSize) : null };
  });
  check('A.readability 2: a full pistol magazine shows 12 ammo pips (none spent) and the round count renders at 48 px', pipsFull.total === 12 && pipsFull.spent === 0 && near(pipsFull.fontSize, 48, 0.5), pipsFull);
  await page.evaluate((p) => { const a = window.__crashScreen; a.smashAt(p.x, p.y); a.smashAt(p.x, p.y); a.smashAt(p.x, p.y); }, ap);
  const pips3 = await poll(async () => page.evaluate(() => {
    const sh = document.querySelector('crs-hud, .crs-hud-host').shadowRoot;
    return { total: sh.querySelectorAll('.crs-ammo .apip').length, spent: sh.querySelectorAll('.crs-ammo .apip.spent').length };
  }), 500, 15);
  check('A.readability 2: after 3 shots, 9 of the 12 pips are still filled (3 marked spent)', !!pips3 && pips3.total === 12 && pips3.spent === 3, pips3);
  const widthPistol2 = await page.evaluate(() => document.querySelector('crs-hud, .crs-hud-host').shadowRoot.querySelector('.crs-ammo').getBoundingClientRect().width);
  await api.setWeapon(page, 'hammer');
  const widthHammer2 = await page.evaluate(() => document.querySelector('crs-hud, .crs-hud-host').shadowRoot.querySelector('.crs-ammo').getBoundingClientRect().width);
  await api.setWeapon(page, 'pistol');
  check('A.readability 2: .crs-ammo panel width is pinned within ±1 px across a weapon swap (pistol ↔ hammer)', Math.abs(widthPistol2 - widthHammer2) <= 1, { pistol: widthPistol2, hammer: widthHammer2 });
  await api.setWeapon(page, 'rocket');
  const rocketAmmo = await api.ammo(page);
  check('A.ammo 1: setWeapon("rocket") → ammo() { mag: 2, size: 2 } (A1: rocket mag 2 / 1500 ms)', !!rocketAmmo && rocketAmmo.size === 2 && rocketAmmo.mag === 2, rocketAmmo);

  // ---- (2) weapon swap delay ------------------------------------------------------------------------------
  await api.setWeapon(page, 'pistol');
  await sleep(300);
  await api.debug(page, { noCooldown: false });
  const sw = await page.evaluate((p) => {
    const a = window.__crashScreen;
    a.setWeapon('hammer');
    const immediate = a.smashAt(p.x, p.y);
    const am = a.ammo();
    const host = document.querySelector('crs-hud, .crs-hud-host');
    const ammoEl = host && host.shadowRoot ? host.shadowRoot.querySelector('.crs-ammo') : null;
    return { immediate, swapping: am && am.swapping, statsSwapping: a.stats().swapping, hud: ammoEl ? (ammoEl.textContent || '').replace(/\s+/g, ' ').trim() : null };
  }, ap);
  check('A.swap 2: with noCooldown off, setWeapon("hammer") then an immediate smashAt → false (250 ms swap delay)', sw.immediate === false, sw);
  check('A.swap 2: ammo().swapping / stats().swapping === true and the ammo HUD shows 교체 중 during the delay', sw.swapping === true && sw.statsSwapping === true && !!sw.hud && /교체 중|Swapping/.test(sw.hud), sw);
  await sleep(300);
  const sw2 = await page.evaluate((p) => { const a = window.__crashScreen; const late = a.smashAt(p.x, p.y); const sameId = a.setWeapon('hammer'); const same = a.smashAt(p.x, p.y); return { late, sameId, same, swapping: a.ammo().swapping }; }, ap);
  check('A.swap 2: smashAt after 300 ms → true; setWeapon(sameId) sets no delay (immediate smashAt → true, swapping false)', sw2.late === true && sw2.same === true && sw2.swapping === false, sw2);
  const dbg2 = await api.debug(page, { noCooldown: true });
  check('A.swap 2: noCooldown re-enabled for the rest of the block', dbg2.noCooldown === true, dbg2);

  // ---- (3) sniper rifle + scope -------------------------------------------------------------------------
  await api.restore(page);
  await sleep(60);
  await api.setWeapon(page, 'sniper');
  const bossR = await api.rect(page, '#boss');
  const bossPt = { x: bossR.cx, y: bossR.cy };
  const maxBefore = (await api.hpOf(page, '#boss')).max;
  // #big-card has not been touched since the restore above, so its first hp contact happens WHILE scoped (A3)
  const bcUnscaled = await api.rectNoScroll(page, '#big-card');
  check('A.sniper 3: #boss max HP from its live rect (≈ 253) and sniper damage read from api.weapons() (200)', maxBefore === specMaxHp(bossR.width, bossR.height, 1.0, false) && DMG('sniper') === SPEC_DMG.sniper, { maxBefore, expected: specMaxHp(bossR.width, bossR.height, 1.0, false), dmg: DMG('sniper') });
  await page.mouse.move(bossPt.x, bossPt.y);
  await sleep(50);
  const scOn = await api.scope(page, true);
  const sc3 = await poll(async () => { const s = await api.stats(page); return s.scoped ? s : null; }, 500, 15);
  const bodyOn = await api.bodyInline(page);
  const bossScoped = await api.rectNoScroll(page, '#boss');
  const hpScoped = await api.hpOf(page, '#boss');
  const hpFresh = await api.hpOf(page, '#big-card');
  check('A.sniper 3: scope(true) → .crs-scope in the glass root (document.querySelector) and stats().scoped && stats().magnified', (await api.has(page, '.crs-scope')) && !!sc3 && sc3.magnified === true, { ret: scOn, scoped: sc3 && sc3.scoped, magnified: sc3 && sc3.magnified, hasScope: await api.has(page, '.crs-scope') });
  check('A.sniper 3: body inline transform contains scale(2) (CSSOM, !important) and no will-change is set', /scale\(2\)/.test(bodyOn.transform) && bodyOn.willChange === '', bodyOn);
  check('A.sniper 3: #boss getBoundingClientRect doubled under the transform (± 2 px)', near(bossScoped.width, 2 * bossR.width, 2) && near(bossScoped.height, 2 * bossR.height, 2), { before: [bossR.width, bossR.height], scoped: [bossScoped.width, bossScoped.height] });
  check('A.sniper 3: hpOf(#boss).max unchanged while scoped (the cached record survives scope-in)', hpScoped.max === maxBefore && hpScoped.hp === maxBefore, { maxBefore, scoped: hpScoped });
  check('A.sniper 3: a FIRST hp contact made while scoped is page-space — hpMax() divides the doubled rect by scopeMag()', hpFresh.max === specMaxHp(bcUnscaled.width, bcUnscaled.height, 1.0, false) && hpFresh.hp === hpFresh.max, { got: hpFresh, expected: specMaxHp(bcUnscaled.width, bcUnscaled.height, 1.0, false), unscaledRect: [bcUnscaled.width, bcUnscaled.height] });
  const shot3 = await api.smashAt(page, bossPt.x, bossPt.y);
  const hp3 = (await poll(async () => { const r = await api.hpOf(page, '#boss'); return r.hp < r.max ? r : null; }, 500, 15)) || await api.hpOf(page, '#boss');
  check('A.sniper 3: one scoped shot at the boss centre → hp === max − dmg(sniper) (253 → 53)', shot3 === true && hp3.hp === hp3.max - DMG('sniper') && hp3.max === maxBefore, { shot: shot3, hp: hp3, dmg: DMG('sniper') });
  const ls3 = (await api.stats(page)).lastShot;
  check('A.sniper 3: stats().lastShot records the scoped impact { x, y, offsetX: 0, offsetY: 0, scoped: true }', !!ls3 && ls3.scoped === true && ls3.offsetX === 0 && ls3.offsetY === 0 && near(ls3.x, bossPt.x, 1) && near(ls3.y, bossPt.y, 1), ls3);
  await sleep(120);
  await page.screenshot({ path: path.join(OUT, 'sniper.png') });
  info('screenshot test/out/sniper.png (scoped, after a shot)');
  await api.scope(page, false);
  const bodyOff = await api.bodyInline(page);
  check('A.sniper 3: scope(false) → body inline transform / transform-origin / will-change restored to ""', bodyOff.transform === '' && bodyOff.transformOrigin === '' && bodyOff.willChange === '', bodyOff);
  check('A.sniper 3: .crs-scope gone and stats().scoped === false after scope(false)', !(await api.has(page, '.crs-scope')) && (await api.stats(page)).scoped === false, { hasScope: await api.has(page, '.crs-scope'), scoped: (await api.stats(page)).scoped });
  // ADS chrome: the 28 px hammer cursor must not sit on the reticle centre and the opaque panel must not cover the circle
  const panelPlain = await api.hudQ(page, '.panel');
  await api.scope(page, true);
  await poll(async () => (await api.stats(page)).scoped === true, 400, 15);
  await sleep(220);
  const adsOn = await page.evaluate(() => {
    const el = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight / 2));
    return { html: document.documentElement.className, cursor: el ? getComputedStyle(el).cursor : null };
  });
  const panelScoped = await api.hudQ(page, '.panel');
  await api.scope(page, false);
  await sleep(220);
  const adsOff = await page.evaluate(() => ({ html: document.documentElement.className, cursor: getComputedStyle(document.body).cursor }));
  const panelBack = await api.hudQ(page, '.panel');
  check('A.sniper 3: scoping hides the page cursor (html.crs-scoped) and fades the weapon panel out of the circle; both come back on scope-out', /(^|\s)crs-scoped(\s|$)/.test(adsOn.html) && adsOn.cursor === 'none' && !/(^|\s)crs-scoped(\s|$)/.test(adsOff.html) && /url\(/.test(adsOff.cursor) && !!panelPlain && !!panelScoped && !!panelBack && parseFloat(panelPlain.opacity) > 0.9 && parseFloat(panelScoped.opacity) < 0.5 && parseFloat(panelBack.opacity) > 0.9, { on: adsOn, off: adsOff, panelOpacity: [panelPlain && panelPlain.opacity, panelScoped && panelScoped.opacity, panelBack && panelBack.opacity] });
  // chord: right button scopes, a left press while RMB is held fires, an RMB release while LMB is held unscopes
  await api.restore(page);
  await sleep(60);
  const bossR2 = await api.rectNoScroll(page, '#boss');
  await page.mouse.move(bossR2.cx, bossR2.cy);
  const shots0 = (await api.stats(page)).shots;
  await page.mouse.down({ button: 'right' });
  const rmbOn = await poll(async () => (await api.stats(page)).scoped === true, 500, 15);
  await page.mouse.down();
  const chordHit = await poll(async () => { const s = await api.stats(page); const h = await api.hpOf(page, '#boss'); return s.shots === shots0 + 1 && h.hp < h.max ? { shots: s.shots, hp: h } : null; }, 600, 15);
  await page.mouse.up({ button: 'right' });
  const rmbOff = await poll(async () => (await api.stats(page)).scoped === false, 500, 15);
  await page.mouse.up();
  check('A.sniper 3: right mouse button down → scoped (pointer-events chord model)', rmbOn === true, (await api.stats(page)).scoped);
  check('A.sniper 3: left press while RMB is held fires (stats().shots + 1, boss hp decreased)', !!chordHit, chordHit || { shots: [shots0, (await api.stats(page)).shots], hp: await api.hpOf(page, '#boss') });
  check('A.sniper 3: RMB release while the left button is still down → scope off', rmbOff === true, (await api.stats(page)).scoped);
  // Shift: 120 ms hold-delay; a chord key within the delay cancels it
  await page.keyboard.down('Shift');
  await sleep(200);
  const shiftOn = (await api.stats(page)).scoped;
  await page.keyboard.up('Shift');
  const shiftOff = await poll(async () => (await api.stats(page)).scoped === false, 500, 15);
  check('A.sniper 3: Shift held 200 ms → scoped, Shift up → scope off', shiftOn === true && shiftOff === true, { shiftOn, shiftOff });
  // v1.3 §1: the power hotkey is gone — Shift + "=" is now just an arbitrary keypress; it must not flash
  // the scope, and stats() must come out unchanged (no "power" field reappears).
  const statsBeforeEq = await api.stats(page);
  await page.keyboard.down('Shift');
  await page.keyboard.press('=');
  let flashed = false;
  const tS = Date.now();
  while (Date.now() - tS < 350) { if ((await api.stats(page)).scoped) { flashed = true; break; } await sleep(10); }
  await page.keyboard.up('Shift');
  const statsAfterEq = await api.stats(page);
  check('A.sniper 3: Shift + "=" does nothing (the power hotkey is gone) — the scope never flashes and stats() is otherwise unchanged', !flashed && !('power' in statsAfterEq) && statsAfterEq.weapon === statsBeforeEq.weapon && statsAfterEq.shots === statsBeforeEq.shots, { flashed, before: statsBeforeEq, after: statsAfterEq });
  // layered Escape
  await api.scope(page, true);
  await poll(async () => (await api.stats(page)).scoped === true, 300, 15);
  await page.keyboard.press('Escape');
  const escScope = await poll(async () => (await api.stats(page)).scoped === false, 500, 15);
  check('A.sniper 3: Escape while scoped → scope off AND still active (layered Escape)', escScope === true && (await api.active(page)) === true, { scoped: (await api.stats(page)).scoped, active: await api.active(page) });
  // spread (unscoped): 20 shots, lastShot recorded hit or miss
  await api.debug(page, { noSpread: false, infiniteAmmo: true });
  const spread = await page.evaluate((p) => {
    const a = window.__crashScreen; const out = [];
    for (let i = 0; i < 20; i++) { a.smashAt(p.x, p.y); const ls = a.stats().lastShot; out.push(ls ? { ox: ls.offsetX, oy: ls.offsetY, x: ls.x, y: ls.y, scoped: ls.scoped } : null); }
    return out;
  }, bossPt);
  const offs = spread.map((s) => (s ? Math.max(Math.abs(s.ox), Math.abs(s.oy)) : NaN));
  check('A.sniper 3: 20 unscoped shots with spread → every |offset| ≤ 25 px, at least one > 0, lastShot.scoped === false', spread.every((s) => s && s.scoped === false) && offs.every((o) => o <= 25) && offs.some((o) => o > 0), { offs });
  check('A.sniper 3: lastShot.x / y === aim point + offset (clamped impact)', spread.every((s) => s && near(s.x, bossPt.x + s.ox, 0.5) && near(s.y, bossPt.y + s.oy, 0.5)), spread.slice(0, 3));
  await api.debug(page, { noSpread: true });
  const noSp = await page.evaluate((p) => { const a = window.__crashScreen; const out = []; for (let i = 0; i < 5; i++) { a.smashAt(p.x, p.y); const ls = a.stats().lastShot; out.push(ls ? { ox: ls.offsetX, oy: ls.offsetY, x: ls.x, y: ls.y } : null); } return out; }, bossPt);
  check('A.sniper 3: noSpread → offsets 0 and the impact equals the aim point', noSp.every((s) => s && s.ox === 0 && s.oy === 0 && near(s.x, bossPt.x, 0.5) && near(s.y, bossPt.y, 0.5)), noSp);
  // bolt action
  await api.debug(page, { noCooldown: false });
  await sleep(650);
  const bolt = await page.evaluate((p) => { const a = window.__crashScreen; const first = a.smashAt(p.x, p.y); const second = a.smashAt(p.x, p.y); return { first, second }; }, bossPt);
  check('A.sniper 3: bolt action — first shot true, a second within 100 ms false (cooldown 600 ms)', bolt.first === true && bolt.second === false, bolt);
  await api.debug(page, { noCooldown: true });
  // weapon switch while scoped
  await api.scope(page, true);
  await poll(async () => (await api.stats(page)).scoped === true, 300, 15);
  await api.setWeapon(page, 'pistol');
  const swOff = await poll(async () => (await api.stats(page)).scoped === false, 300, 15);
  check('A.sniper 3: switching weapons while scoped → scope off and .crs-scope gone', swOff === true && !(await api.has(page, '.crs-scope')), { scoped: (await api.stats(page)).scoped, hasScope: await api.has(page, '.crs-scope') });
  await api.setWeapon(page, 'sniper');
  await sleep(50);
  // tracer
  await api.seenReset(page);
  await api.smashAt(page, bossPt.x, bossPt.y);
  const tracerSeen = await poll(async () => { const s = await api.seen(page); return s['.crs-tracer'] ? s : null; }, 500, 15);
  check('A.sniper 3: a .crs-tracer line appears after a sniper shot', !!tracerSeen, await api.seen(page));
  // magazine 5
  await api.debug(page, { infiniteAmmo: false });
  await api.restore(page);
  await sleep(60);
  const mag5 = await page.evaluate((p) => { const a = window.__crashScreen; const shots = []; let after5 = null; for (let i = 1; i <= 6; i++) { shots.push(a.smashAt(p.x, p.y)); if (i === 5) after5 = a.ammo(); } return { shots, after5, size: a.ammo().size }; }, bossPt);
  check('A.sniper 3: magazine 5 — shots 1–5 true, ammo() after the 5th { mag: 0, reloading: true }, 6th false', mag5.size === 5 && mag5.shots.slice(0, 5).every((s) => s === true) && !!mag5.after5 && mag5.after5.mag === 0 && mag5.after5.reloading === true && mag5.shots[5] === false, mag5);
  await poll(async () => { const m = await api.ammo(page); return m.mag === 5 && !m.reloading; }, 600, 15);
  // A4 + A5: the magazine-emptying round is still fired SCOPED — the auto-reload (which scopes out) runs after it
  await api.debug(page, { noSpread: false });
  await api.scope(page, true);
  await poll(async () => (await api.stats(page)).scoped === true, 400, 15);
  const magScoped = await page.evaluate((p) => {
    const a = window.__crashScreen; const shots = [];
    for (let i = 1; i <= 5; i++) { a.smashAt(p.x, p.y); const ls = a.stats().lastShot; shots.push(ls ? { scoped: ls.scoped, ox: ls.offsetX, oy: ls.offsetY } : null); }
    return { shots, ammo: a.ammo(), scoped: a.stats().scoped };
  }, bossPt);
  check('A.sniper 3: every round of a scoped magazine — the 5th included — is exact (lastShot.scoped, offset 0); only then does the auto-reload scope out', magScoped.shots.length === 5 && magScoped.shots.every((s) => s && s.scoped === true && s.ox === 0 && s.oy === 0) && !!magScoped.ammo && magScoped.ammo.reloading === true && magScoped.scoped === false, magScoped);
  await api.debug(page, { noSpread: true });
  await poll(async () => { const m = await api.ammo(page); return m.mag === 5 && !m.reloading; }, 600, 15);
  // A2: the reload scopes out, but the chord is still held — the scope must come back when the magazine is full
  await api.restore(page);
  await sleep(60);
  await api.debug(page, { fastReload: false });
  await page.mouse.move(bossPt.x, bossPt.y);
  await page.mouse.down({ button: 'right' });
  const rmbScoped6 = await poll(async () => (await api.stats(page)).scoped === true, 500, 15);
  for (let i = 0; i < 5; i++) { await page.mouse.down(); await page.mouse.up(); }
  const dryScoped = await api.stats(page);
  const reScoped = await poll(async () => { const st = await api.stats(page); const m = await api.ammo(page); return st.scoped === true && m.mag === 5 && !m.reloading; }, 3000, 40);
  await page.mouse.up({ button: 'right' });
  const afterRelease = await poll(async () => (await api.stats(page)).scoped === false, 500, 15);
  check('A.sniper 3: the auto-reload scopes out, the scope comes back when it finishes with RMB still held, and the RMB release scopes out again', rmbScoped6 === true && dryScoped.scoped === false && dryScoped.reloading === true && reScoped === true && afterRelease === true, { rmbScoped6, dry: { scoped: dryScoped.scoped, reloading: dryScoped.reloading }, reScoped, afterRelease });
  await api.debug(page, { fastReload: true });
  // A2: the keyup that releases Shift never reaches a blurred page — the chord must not survive the blur
  await api.restore(page);
  await sleep(60);
  await page.keyboard.down('Shift');
  const shiftScoped = await poll(async () => (await api.stats(page)).scoped === true, 500, 15);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const blurOff = await poll(async () => (await api.stats(page)).scoped === false, 500, 15);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await api.setWeapon(page, 'pistol');
  await api.setWeapon(page, 'sniper');
  await sleep(80);
  const afterBlur = await api.stats(page);
  await page.keyboard.up('Shift');
  const bodyBlur = await api.bodyInline(page);
  check('A.sniper 3: a window blur drops the Shift / RMB chord — a later switch back to the sniper does not re-scope with nothing held', shiftScoped === true && blurOff === true && afterBlur.scoped === false && afterBlur.magnified === false && bodyBlur.transform === '', { shiftScoped, blurOff, after: { scoped: afterBlur.scoped, magnified: afterBlur.magnified }, body: bodyBlur });

  // ---- (4) loadouts and number keys ---------------------------------------------------------------------
  await api.restore(page);
  await sleep(60);
  const okDefault = await api.applyPreset(page, 'default');
  const lo = await api.loadout(page);
  check('A.loadout 4: applyPreset("default") → true and loadout() → 10 unique ids in the default preset order', okDefault === true && Array.isArray(lo) && lo.length === 10 && new Set(lo).size === 10 && lo.join(',') === WEAPON_IDS.join(','), { ret: okDefault, lo });
  await page.keyboard.press('0');
  check('A.loadout 4: key "0" selects slot 10 (collapse)', await poll(async () => (await api.weapon(page)) === 'collapse', 400, 15), await api.weapon(page));
  const okAssault = await api.applyPreset(page, 'assault');
  await page.keyboard.press('1');
  const assaultSel = await poll(async () => (await api.weapon(page)) === 'smg', 400, 15);
  const wAssault = await api.weapons(page);
  check('A.loadout 4: applyPreset("assault") → true, key "1" → smg', okAssault === true && assaultSel === true, { ret: okAssault, weapon: await api.weapon(page) });
  check('A.loadout 4: assault order (smg, pistol, sniper, bomb, rocket, flame, hammer, axe, sword, collapse); api.weapons() follows it with slot 1–10 / key 1…9,0', (await api.loadout(page)).join(',') === PRESETS.assault.join(',') && wAssault.map((w) => w.id).join(',') === PRESETS.assault.join(',') && wAssault.every((w, i) => w.slot === i + 1 && String(w.key) === KEYS[i]), { lo: await api.loadout(page), w: wAssault.map((w) => `${w.id}:${w.slot}:${w.key}`) });
  check('A.loadout 4: crsLoadout / crsLoadoutPreset ("assault") persisted in the shim storage', (await api.store(page)).crsLoadoutPreset === 'assault' && JSON.stringify((await api.store(page)).crsLoadout) === JSON.stringify(PRESETS.assault), await api.store(page));
  const badLo = await page.evaluate((ids) => { const a = window.__crashScreen; return { dup: a.setLoadout(ids.map(() => 'hammer')), short: a.setLoadout(ids.slice(0, 9)), junk: a.setLoadout('hammer'), after: a.loadout() }; }, WEAPON_IDS);
  check('A.loadout 4: setLoadout with a non-permutation (duplicates / 9 ids / non-array) → false, loadout unchanged', badLo.dup === false && badLo.short === false && badLo.junk === false && badLo.after.join(',') === PRESETS.assault.join(','), badLo);
  check('A.loadout 4: applyPreset("nope") → false', (await api.applyPreset(page, 'nope')) === false);
  // Shift+3 moves the current weapon into slot 3 (the old slot-3 weapon takes the current weapon's slot)
  await api.applyPreset(page, 'default');
  await api.setWeapon(page, 'hammer');
  await page.keyboard.down('Shift');
  await page.keyboard.press('3');
  await page.keyboard.up('Shift');
  const lo3 = await poll(async () => { const l = await api.loadout(page); return l[2] === 'hammer' ? l : null; }, 500, 15);
  const toast3 = await poll(async () => { const t = await api.hudQ(page, '.crs-toast'); return t && t.visible && /^3 ←/.test(t.text) ? t : null; }, 500, 20);
  const st3 = await api.store(page);
  check('A.loadout 4: Shift+3 with the hammer current → loadout()[2] === "hammer" and the old slot-3 weapon (smg) takes slot 1', !!lo3 && lo3[0] === 'smg' && lo3[2] === 'hammer', lo3 || await api.loadout(page));
  check('A.loadout 4: preset becomes "custom" and crsLoadout persists the new order', st3.crsLoadoutPreset === 'custom' && Array.isArray(st3.crsLoadout) && st3.crsLoadout.join(',') === (lo3 || []).join(','), { preset: st3.crsLoadoutPreset, crsLoadout: st3.crsLoadout });
  check('A.loadout 4: a .crs-toast whose text starts with "3 ←" is shown', !!toast3, await api.hudQ(page, '.crs-toast'));
  check('A.loadout 4: the current weapon stays hammer after the swap', (await api.weapon(page)) === 'hammer', await api.weapon(page));
  const hudLo = await api.hudLoadout(page);
  check('A.loadout 4: HUD grid shows 10 data-weapon buttons in loadout order with badges 1…9,0', !!hudLo && hudLo.ids.join(',') === (lo3 || []).join(',') && hudLo.badges.join(',') === KEYS.join(','), hudLo && { ids: hudLo.ids, badges: hudLo.badges });
  check('A.loadout 4: every grid button title contains its weapon name', !!hudLo && hudLo.ids.every((id, i) => hudLo.titles[i].includes(KO_NAME[id])), hudLo && hudLo.titles);
  check('A.loadout 4: 5 preset buttons, none aria-pressed while custom, and the 사용자 지정 tag shows', !!hudLo && hudLo.presetCount === 5 && hudLo.pressed.length === 0 && hudLo.customTag, hudLo && { presets: hudLo.presetCount, pressed: hudLo.pressed, customTag: hudLo.customTag });
  await api.applyPreset(page, 'default');
  const hudLo2 = await api.hudLoadout(page);
  check('A.loadout 4: applyPreset("default") → the 기본 preset button is aria-pressed and no custom tag', !!hudLo2 && hudLo2.pressed.length === 1 && /기본|Default/.test(hudLo2.pressed[0]) && !hudLo2.customTag && hudLo2.ids.join(',') === WEAPON_IDS.join(','), hudLo2 && { pressed: hudLo2.pressed, customTag: hudLo2.customTag, ids: hudLo2.ids });
  // Q / E cycle with wrap
  await api.setWeapon(page, 'hammer');
  await page.keyboard.press('q');
  const qWrap = await poll(async () => (await api.weapon(page)) === 'collapse', 400, 15);
  await page.keyboard.press('e');
  const eWrap = await poll(async () => (await api.weapon(page)) === 'hammer', 400, 15);
  await page.keyboard.press('e');
  const eNext = await poll(async () => (await api.weapon(page)) === 'pistol', 400, 15);
  check('A.loadout 4: Q wraps from slot 1 to slot 10 (collapse), E wraps back to hammer, E again → pistol', qWrap === true && eWrap === true && eNext === true, { qWrap, eWrap, eNext, weapon: await api.weapon(page) });
  // drag the hammer button onto the smg button (pointer events inside the shadow DOM)
  const bA = await api.hudWeaponBtnRect(page, 'hammer');
  const bB = await api.hudWeaponBtnRect(page, 'smg');
  check('A.loadout 4: grid buttons for hammer / smg found in the shadow root', !!bA && !!bB, { bA, bB });
  if (bA && bB) {
    await page.mouse.move(bA.cx, bA.cy);
    await page.mouse.down();
    await page.mouse.move(bA.cx + 10, bA.cy + 2, { steps: 2 });
    await page.mouse.move(bB.cx, bB.cy, { steps: 8 });
    await page.mouse.up();
  }
  const loDrag = await poll(async () => { const l = await api.loadout(page); return l[0] === 'smg' && l[2] === 'hammer' ? l : null; }, 600, 20);
  check('A.loadout 4: dragging the hammer button onto the smg button swaps slots 1 and 3', !!loDrag, loDrag || await api.loadout(page));
  check('A.loadout 4: the drag marks the preset custom and suppresses the click (weapon still pistol)', (await api.store(page)).crsLoadoutPreset === 'custom' && (await api.weapon(page)) === 'pistol', { preset: (await api.store(page)).crsLoadoutPreset, weapon: await api.weapon(page) });
  await api.applyPreset(page, 'default');
  await api.setWeapon(page, 'hammer');

  // ---- (5) combat T1 shooter ---------------------------------------------------------------------------
  await api.restore(page);
  await sleep(60);
  const combatOn = await api.setCombat(page, true);
  await api.debug(page, { noAttacks: true });
  const clock0 = await api.hudQ(page, '.crs-player');
  await sleep(1150);
  const clock1 = await api.hudQ(page, '.crs-player');
  check('A.combat 5: the 생존 clock refreshes once a second from activation (not frozen until the first 1.5 s selection tick)', !!clock0 && !!clock1 && /생존 0초/.test(clock0.text) && /생존 1초/.test(clock1.text), { at0: clock0 && clock0.text, at1150: clock1 && clock1.text });
  const fg = await api.rect(page, '#figure');
  const figArea = fg.width * fg.height;
  const playerHud = await api.hudQ(page, '.crs-player');
  check('A.combat 5: #figure is a T1 candidate by page-space area (40 000 ≤ area < 150 000)', figArea >= 40000 && figArea < 150000, { w: fg.width, h: fg.height, area: figArea });
  check('A.combat 5: setCombat(true) → api.combat / stats().combat === true and the player HUD (.crs-player, bottom-left, 24 px margin) is visible', (await api.combat(page)) === true && (await api.stats(page)).combat === true && !!playerHud && playerHud.visible && near(playerHud.left, 24, 4) && near(playerHud.bottom, playerHud.vh - 24, 4), { ret: combatOn, combat: await api.combat(page), hud: playerHud });
  check('A.combat 5: player HUD shows 체력 / 점수 / 처치 / 생존 / 적', !!playerHud && ['체력', '점수', '처치', '생존', '적'].every((t) => playerHud.text.includes(t)), playerHud && playerHud.text);
  // SPEC-readability §6 assertion 3 (bullets 1–3): the health bar is 220 × 16 px over a ten-notch tick
  // overlay, and the label reads the exact "체력 100 / 100" at full health.
  const healthBarInfo = await page.evaluate(() => {
    const sh = document.querySelector('crs-hud, .crs-hud-host').shadowRoot;
    const bar = sh.querySelector('.crs-player .hbar');
    const ticks = sh.querySelector('.crs-player .hticks');
    if (!bar) return null;
    const r = bar.getBoundingClientRect();
    return { width: r.width, height: r.height, ticksBg: ticks ? getComputedStyle(ticks).backgroundImage : '' };
  });
  check('A.readability 3: the health bar is 220 × 16 px with a ten-notch tick overlay (repeating-linear-gradient)', !!healthBarInfo && near(healthBarInfo.width, 220, 1) && near(healthBarInfo.height, 16, 1) && /repeating-linear-gradient/.test(healthBarInfo.ticksBg), healthBarInfo);
  check('A.readability 3: the health label reads exactly "체력 100 / 100" at full health', !!playerHud && /체력\s*100\s*\/\s*100/.test(playerHud.text), playerHud && playerHud.text);
  await api.seenReset(page);
  await api.setPlayerPos(page, fg.cx, fg.cy);
  const p0 = await api.player(page);
  const tier5 = await api.forceAttack(page, '#figure');
  const hit5 = await poll(async () => { const p = await api.player(page); return p.hp < 100 ? p : null; }, 1000, 15);
  const seen5 = await api.seen(page);
  check('A.combat 5: player() → { hp: 100, max: 100, alive: true, score: 0, kills: 0 } at the figure centre', !!p0 && p0.hp === 100 && p0.max === 100 && p0.alive === true && p0.score === 0 && p0.kills === 0 && near(p0.x, fg.cx, 1) && near(p0.y, fg.cy, 1), p0);
  check('A.combat 5: debug.forceAttack(#figure) → "shooter" and a .crs-orb appears', tier5 === 'shooter' && !!seen5['.crs-orb'], { tier: tier5, seen: seen5 });
  check('A.combat 5: within 1 s the player takes damage (hp < 100) and a .crs-vignette was seen', !!hit5 && !!seen5['.crs-vignette'], { player: hit5 || await api.player(page), seen: seen5 });
  check('A.combat 5: orb damage === 8 + round(√area / 60)', !!hit5 && 100 - hit5.hp === 8 + Math.round(Math.sqrt(figArea) / 60), { hp: hit5 && hit5.hp, expected: 8 + Math.round(Math.sqrt(figArea) / 60) });
  check('A.combat 5: a red floating "−N" number appeared for the player damage', seen5.dmgTexts.some((t) => /^[-−]\d+/.test(t)), seen5.dmgTexts);
  // SPEC-readability §6 assertion 3 (bullet 4): the drain-bar animation (250 ms) has settled, so the fill-bar
  // width ratio should track hp/max within ±2 % and the displayed number should have dropped from 100.
  await sleep(320);
  const barRatio5 = await page.evaluate(() => {
    const sh = document.querySelector('crs-hud, .crs-hud-host').shadowRoot;
    const bar = sh.querySelector('.crs-player .hbar'), fill = sh.querySelector('.crs-player .hfill');
    const bw = bar.getBoundingClientRect().width, fw = fill.getBoundingClientRect().width;
    return bw > 0 ? fw / bw : null;
  });
  const playerHudAfterHit = await api.hudQ(page, '.crs-player');
  const hpAfterHit5 = await api.player(page);
  check('A.readability 3: after taking damage, the health number drops below 100 and the fill-bar ratio tracks hp/max within ±2%', hpAfterHit5.hp < 100 && barRatio5 != null && Math.abs(barRatio5 - hpAfterHit5.hp / 100) <= 0.02 && !/체력\s*100\s*\/\s*100/.test(playerHudAfterHit && playerHudAfterHit.text || ''), { hp: hpAfterHit5.hp, ratio: barRatio5, text: playerHudAfterHit && playerHudAfterHit.text });
  // 5b dodge: 500 px to the side, then 300 px perpendicular to the orb's path right after the launch
  await api.restore(page);
  await sleep(60);
  const dir5 = sideOf(fg);
  const far5 = { x: fg.cx + dir5 * 500, y: fg.cy };
  await api.setPlayerPos(page, far5.x, far5.y);
  await api.setPlayerHp(page, 100);
  await api.seenReset(page);
  const launch5b = await page.evaluate((s) => {
    const a = window.__crashScreen;
    const tier = a.debug.forceAttack(document.querySelector(s));
    return { tier, orbNode: !!document.querySelector('.crs-orb'), orbs: a.stats().orbs };
  }, '#figure');
  await api.setPlayerPos(page, far5.x, far5.y + 300);
  await sleep(3500);
  const p5b = await api.player(page);
  const seen5b = await api.seen(page);
  const tier5b = launch5b.tier;
  check('A.combat 5b: dodge — an orb IS launched (node + stats().orbs ≥ 1), then player 500 px away and 300 px perpendicular: hp unchanged (100) after 3.5 s and the orb is gone', tier5b === 'shooter' && launch5b.orbNode === true && launch5b.orbs >= 1 && !!seen5b['.crs-orb'] && p5b.hp === 100 && (await api.count(page, '.crs-orb')) === 0 && (await api.stats(page)).orbs === 0, { launch: launch5b, player: p5b, seen: !!seen5b['.crs-orb'], orbs: await api.count(page, '.crs-orb') });
  // 5c interception: a hammer at the orb centre destroys it and never touches the page under it
  await api.restore(page);
  await sleep(60);
  await api.setWeapon(page, 'hammer');
  await api.setPlayerPos(page, far5.x, far5.y);
  const img0 = await api.hpOf(page, '#demo-img');
  const fig0 = await api.hpOf(page, '#figure');
  const ic = await page.evaluate((sel) => {
    const a = window.__crashScreen; const d = a.debug;
    const score0 = a.player().score; const shots0 = a.stats().shots;
    const tier = d.forceAttack(document.querySelector(sel));
    const orb = document.querySelector('.crs-orb');
    if (!orb) return { tier, orb: false };
    const r = orb.getBoundingClientRect();
    const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const ret = a.smashAt(c.x, c.y);
    return { tier, orb: true, c, ret, orbsAfter: document.querySelectorAll('.crs-orb').length, score: a.player().score - score0, shots: a.stats().shots - shots0, orbsStat: a.stats().orbs };
  }, '#figure');
  const img1 = await api.hpOf(page, '#demo-img');
  const fig1 = await api.hpOf(page, '#figure');
  check('A.combat 5c: hammer smashAt at the orb centre intercepts it — orb removed, score + 5, smashAt true, stats().shots + 1', ic.tier === 'shooter' && ic.orb === true && ic.ret === true && ic.orbsAfter === 0 && ic.score === 5 && ic.shots === 1, ic);
  // #figure is the HOSTILE here, and SPEC-combat-v2 §10.2 re-scales a hostile's max HP by its depth rank the
  // moment it is marked (front ×0.8), so its absolute hp legitimately differs from the pre-combat reading. The
  // claim this check exists to make — "the interception did not damage the page" — is asserted as full health
  // plus not-broken on both elements instead; #demo-img is not a hostile, so its absolute hp must still match.
  const imgBroken5c = await api.broken(page, '#demo-img');
  const figBroken5c = await api.broken(page, '#figure');
  check('A.combat 5c: the page under the orb is untouched (#demo-img hp unchanged; #figure still at full health, neither broken)', img1.hp === img0.hp && img1.hp === img1.max && fig1.hp === fig1.max && !imgBroken5c && !figBroken5c, { img: [img0, img1], fig: [fig0, fig1], imgBroken5c, figBroken5c });

  // ---- (6) combat T2 charger ---------------------------------------------------------------------------
  await api.restore(page);
  await sleep(60);
  const bc6 = await api.rect(page, '#big-card');
  const area6 = bc6.width * bc6.height;
  await api.setPlayerPos(page, bc6.cx, bc6.cy);
  await api.seenReset(page);
  const t6 = Date.now();
  const tier6 = await api.forceAttack(page, '#big-card');
  const hit6 = await poll(async () => { const p = await api.player(page); return p.hp < 100 ? { hp: p.hp, ms: Date.now() - t6 } : null; }, 1600, 15);
  const seen6 = await api.seen(page);
  check('A.combat 6: #big-card (≈ 220 400 px²) → "charger"; the player inside the rect takes damage after the 700 ms telegraph and .crs-warn was seen', tier6 === 'charger' && !!hit6 && !!seen6['.crs-warn'] && area6 >= 150000 && area6 < 400000, { tier: tier6, hit: hit6, seen: seen6, area: area6 });
  check('A.combat 6: slam damage === 18 + round(√area / 50) and lands no earlier than 600 ms', !!hit6 && 100 - hit6.hp === 18 + Math.round(Math.sqrt(area6) / 50) && hit6.ms >= 600, { hit: hit6, expected: 18 + Math.round(Math.sqrt(area6) / 50) });
  await api.restore(page);
  await sleep(60);
  await api.setPlayerPos(page, bc6.right + 50, bc6.cy);   // 50 px out: still INSIDE the 60 px slam band
  const t6c = Date.now();
  const tier6c = await api.forceAttack(page, '#big-card');
  const hit6c = await poll(async () => { const p = await api.player(page); return p.hp < 100 ? { hp: p.hp, ms: Date.now() - t6c } : null; }, 1600, 15);
  check('A.combat 6: player 50 px outside the rect (inside the rect + 60 px band) → slam damage 18 + round(√area / 50)', tier6c === 'charger' && !!hit6c && 100 - hit6c.hp === 18 + Math.round(Math.sqrt(area6) / 50), { tier: tier6c, hit: hit6c, expected: 18 + Math.round(Math.sqrt(area6) / 50) });
  await api.restore(page);
  await sleep(60);
  await api.setPlayerPos(page, bc6.right + 64, bc6.cy);   // 64 px out: 4 px past the boundary
  const tier6b = await api.forceAttack(page, '#big-card');
  const hit6b = await poll(async () => { const p = await api.player(page); return p.hp < 100 ? p : null; }, 1300, 15);
  const p6b = hit6b || await api.player(page);
  check('A.combat 6: player 64 px outside the rect (just past the rect + 60 px band) at slam time → no damage', tier6b === 'charger' && p6b.hp === 100, { tier: tier6b, player: p6b });

  // ---- (7) combat T3 laser -----------------------------------------------------------------------------
  await api.restore(page);
  await sleep(60);
  const bo7 = await api.rect(page, '#boss');
  const area7 = bo7.width * bo7.height;
  check('A.combat 7: #boss area > 400 000 and ≤ 0.7 × viewport area (T3 window)', area7 > 400000 && area7 <= 0.7 * VIEWPORT.width * VIEWPORT.height, { area: area7, limit: 0.7 * VIEWPORT.width * VIEWPORT.height });
  await api.setPlayerPos(page, bo7.cx, bo7.cy);
  await api.seenReset(page);
  const tier7 = await api.forceLaser(page, '#boss');
  const hit7 = await poll(async () => { const p = await api.player(page); return p.hp < 100 ? p : null; }, 1500, 15);
  const seen7 = await api.seen(page);
  check('A.combat 7a: #boss laser sweep (§4: 3rd-stage attack, forced here) → "laser"; the player on the line takes 30 within 1.5 s', tier7 === 'laser' && !!hit7 && hit7.hp === 70, { tier: tier7, player: hit7 || await api.player(page) });
  check('A.combat 7a: .crs-beam telegraph then .fire seen', !!seen7['.crs-beam'] && !!seen7['.crs-beam.telegraph'] && !!seen7['.crs-beam.fire'], seen7);
  await api.restore(page);
  await sleep(60);
  await api.setPlayerPos(page, bo7.cx, bo7.cy);
  await api.seenReset(page);
  const tier7b = await api.forceLaser(page, '#boss');
  const locked7 = await poll(async () => !!(await api.seen(page))['.crs-beam.crs-beam-lock'], 1200, 10);
  await api.setPlayerPos(page, bo7.cx, bo7.cy + 100);
  await sleep(900);
  const p7b = await api.player(page);
  const seen7b = await api.seen(page);
  check('A.combat 7b: dodge — step 100 px off the axis as soon as the beam LOCKS; the beam still fires (.crs-beam.fire seen) and misses (hp unchanged)', tier7b === 'laser' && locked7 === true && !!seen7b['.crs-beam.crs-beam-lock'] && !!seen7b['.crs-beam.fire'] && p7b.hp === 100, { tier: tier7b, locked: locked7, seen: seen7b, player: p7b });

  // ---- (8) hostile aura + kill -------------------------------------------------------------------------
  await api.restore(page);
  await sleep(60);
  const fg8 = await api.rect(page, '#figure');
  await api.setPlayerPos(page, fg8.cx + sideOf(fg8) * 500, fg8.cy);
  await api.setWeapon(page, 'rocket');
  await api.seenReset(page);
  const tier8 = await api.forceAttack(page, '#figure');
  const aura8 = await page.evaluate(() => {
    const a = document.querySelector('.crs-hostile');
    if (!a) return null;
    const r = a.getBoundingClientRect(); const cs = getComputedStyle(a);
    return { left: r.left, top: r.top, width: r.width, height: r.height, outline: `${cs.outlineStyle} ${cs.outlineWidth}`, label: (a.textContent || '').trim(), dataCrs: a.hasAttribute('data-crs') };
  });
  check('A.combat 8: a .crs-hostile aura (glass root, data-crs) covers the hostile #figure rect (± 3 px) with a 2 px outline and the 👿 FIGURE label', tier8 === 'shooter' && !!aura8 && aura8.dataCrs && near(aura8.left, fg8.left, 3) && near(aura8.top, fg8.top, 3) && near(aura8.width, fg8.width, 3) && near(aura8.height, fg8.height, 3) && /solid 2px/.test(aura8.outline) && /👿/.test(aura8.label) && /FIGURE/.test(aura8.label), { tier: tier8, aura: aura8, fig: fg8 });
  check('A.combat 8: stats().hostiles === 1 while the figure is hostile', (await api.stats(page)).hostiles === 1, (await api.stats(page)).hostiles);
  // A3: the glass layer keeps viewport geometry — scope-in / scope-out must re-measure the aura against the 2× page.
  // SPEC-readability §3.5 shakes the WHOLE glass root (up to 8 px) on every player hit, and the shooter above hits
  // the player, so the aura is read in root-local coordinates: subtracting the root's own rect cancels that
  // transient translate and leaves the same ± 3 px geometry assertion on the aura-vs-element placement.
  const auraRect = () => page.evaluate(() => {
    const a = document.querySelector('.crs-hostile'); const el = document.querySelector('#figure');
    const rt = document.querySelector('.crs-root');
    if (!a || !el || !rt) return null;
    const ar = a.getBoundingClientRect(), er = el.getBoundingClientRect(), rr = rt.getBoundingClientRect();
    return { aura: [ar.left - rr.left, ar.top - rr.top, ar.width, ar.height], el: [er.left, er.top, er.width, er.height], shake: [+rr.left.toFixed(2), +rr.top.toFixed(2)] };
  });
  await api.setWeapon(page, 'sniper');
  await page.mouse.move(fg8.cx, fg8.cy);
  await api.scope(page, true);
  await poll(async () => (await api.stats(page)).scoped === true, 400, 15);
  await settleRaf(page);
  const auraScoped = await auraRect();
  await api.scope(page, false);
  await settleRaf(page);
  const auraPlain = await auraRect();
  check('A.combat 8: the hostile aura is re-measured on scope-in and scope-out (A3: it stays on the magnified element rect)', !!auraScoped && !!auraPlain && auraScoped.aura.every((v, i) => near(v, auraScoped.el[i], 3)) && auraPlain.aura.every((v, i) => near(v, auraPlain.el[i], 3)), { scoped: auraScoped, unscoped: auraPlain });
  // §5: a hostile element fights as a unit — a hit on any of its descendants lands on the hostile itself
  await api.setWeapon(page, 'pistol');
  // The forceAttack that opened this section is tier "shooter": it spawns an orb AT #figure's centre, which is
  // where #demo-img sits. A shot that lands on a live orb intercepts the orb instead of the page — that is the
  // v1.3 behaviour §5c above asserts on purpose — so firing before it has cleared tests orb interception a
  // second time and says nothing about descendant routing. noAttacks is already on, so no new orb follows this
  // one; wait for the launched one to reach the player and expire.
  const orbsClear8 = await poll(async () => ((await api.stats(page)).orbs === 0 ? 'clear' : null), 3000, 50);
  check('A.combat 8: the section\'s own in-flight orb has cleared before the descendant-hit shot', orbsClear8 === 'clear', { orbsClear8, orbs: (await api.stats(page)).orbs });
  const imgIn8 = await api.rectNoScroll(page, '#demo-img');
  const figB8 = await api.hpOf(page, '#figure');
  const imgB8 = await api.hpOf(page, '#demo-img');
  // the shot and everything that could explain it going nowhere, read in ONE round trip so nothing can age
  // out between the diagnosis and the hit: what pickTarget resolves at that point, whether the shot was
  // even accepted, and the ammo / pause / KO gates smashAt() returns false on.
  const shot8 = await page.evaluate((x, y) => {
    const a = window.__crashScreen, d = a.debug, s0 = a.stats();
    const pick = (d && typeof d.pickAt === 'function') ? d.pickAt(x, y) : 'missing:pickAt';
    const ret = a.smashAt(x, y);
    return { pick, ret, ammo: a.ammo(), locks: s0.locks, hostiles: s0.hostiles, mode: s0.mode, paused: s0.paused, ko: s0.ko, scoped: s0.scoped, cooling: s0.cooling };
  }, imgIn8.cx, imgIn8.cy);
  await sleep(80);
  const figA8 = await api.hpOf(page, '#figure');
  const imgA8 = await api.hpOf(page, '#demo-img');
  check('A.combat 8: a hit on a DESCENDANT of a hostile lands on the hostile itself (#demo-img → #figure takes the damage, the image is untouched)', figA8.hp === figB8.hp - DMG('pistol') && imgA8.hp === imgB8.hp && imgA8.hp === imgA8.max && !(await api.broken(page, '#demo-img')), { fig: [figB8, figA8], img: [imgB8, imgA8], dmg: DMG('pistol'), shot8 });
  info(`A.combat 8 descendant hit: ${JSON.stringify(shot8)}`);
  await api.setWeapon(page, 'rocket');
  // SPEC-readability §7: combat.png must show the player ring, an aim line, and the enlarged ammo/health
  // panels together in one frame. The scope test just above moved the REAL mouse onto #figure's centre
  // (the player follows the cursor), so re-place the player well clear of the hostile LAST, right before
  // the forced attack — otherwise the ring and the aim line collapse onto the hostile's own position.
  // Everything lands in ONE round trip, immediately followed by the screenshot: the aim line is only held
  // for AIMLINE_MIN_MS (220 ms, §3.2), so extra CDP round trips here can comfortably age it out before the
  // capture (each one costs tens of ms). setPlayerPos must be the LAST position write — the scope test just
  // above moved the REAL mouse onto #figure's centre (the player follows the cursor), so without this the
  // ring and the aim line collapse onto the hostile's own position.
  await page.evaluate((x, y) => {
    const a = window.__crashScreen;
    a.debug.setPlayerHp(55);
    a.setWeapon('pistol');
    a.smashAt(2, 2); a.smashAt(2, 2); a.smashAt(2, 2);
    a.debug.setPlayerPos(x, y);
    a.debug.forceAttack(document.querySelector('#figure'));
  }, fg8.cx + sideOf(fg8) * 500, fg8.cy);
  await page.screenshot({ path: path.join(OUT, 'readability.png') });
  info('screenshot test/out/readability.png (player ring + aim line + enlarged ammo/health HUD)');
  await api.setWeapon(page, 'rocket');
  const max8 = (await api.hpOf(page, '#figure')).max;
  const score8a = (await api.player(page)).score;
  const rocketRet = await api.smashAt(page, fg8.left + 6, fg8.top + 6);
  const killed = await poll(async () => { const p = await api.player(page); return p.kills >= 1 && (await api.broken(page, '#figure')) ? p : null; }, 1200, 20);
  const seen8 = await api.seen(page);
  // stats() and player() must be read in ONE evaluate: the rocket's AoE keeps breaking non-hostile
  // elements for up to 60 ms after the kill, and each of those adds round(maxHp/4) to the score while
  // combat is on. Two separate reads can straddle that and differ by a few points on a slow runner.
  const s8 = await page.evaluate(() => {
    const st = window.__crashScreen.stats(), pl = window.__crashScreen.player();
    return { kills: st.kills, score: st.score, hostiles: st.hostiles, pKills: pl.kills, pScore: pl.score };
  });
  check('A.combat 8: a rocket on the hostile figure (padding zone) breaks it → player().kills === 1 and the aura is gone', rocketRet === true && !!killed && killed.kills === 1 && (await api.count(page, '.crs-hostile')) === 0, { ret: rocketRet, player: killed || await api.player(page), auras: await api.count(page, '.crs-hostile') });
  check('A.combat 8: score increased by at least the hostile\'s max HP', !!killed && killed.score - score8a >= max8, { before: score8a, after: killed && killed.score, max: max8 });
  check('A.combat 8: a .crs-dmg "처치!" floating text was seen', seen8.dmgTexts.some((t) => t.includes('처치')), seen8.dmgTexts);
  check('A.combat 8: stats() mirrors kills / score / hostiles', !!killed && s8.kills === 1 && s8.kills === s8.pKills && s8.score === s8.pScore && s8.score >= killed.score && s8.hostiles === 0, s8);

  // ---- (9) KO ----------------------------------------------------------------------------------------------
  await api.restore(page);
  await sleep(60);
  const pendBase9 = await api.pending(page);   // restore() + armCombat(): exactly the grace and the 생존 clock
  await api.setWeapon(page, 'hammer');
  const fg9 = await api.rect(page, '#figure');
  const sc9 = await api.rectNoScroll(page, '#small-card');
  const scPt9 = { x: sc9.left + 12, y: sc9.top + 12 };
  await page.evaluate((p) => { const a = window.__crashScreen; a.smashAt(p.x, p.y); a.smashAt(p.x, p.y); }, scPt9);
  const brokenPre9 = await poll(() => api.broken(page, '#small-card'), 500, 15);
  await api.setWeapon(page, 'sniper');
  await page.mouse.move(fg9.cx, fg9.cy);   // the scope magnifies around the pointer, so #figure stays on screen
  await api.setPlayerPos(page, fg9.cx, fg9.cy);
  const hp5 = await api.setPlayerHp(page, 5);
  await api.scope(page, true);
  const scopedPre9 = await poll(async () => (await api.stats(page)).scoped === true, 500, 15);
  const tier9 = await api.forceAttack(page, '#figure');
  const ko = await poll(async () => { const k = await api.hudQ(page, '.crs-ko'); return k && k.visible ? k : null; }, 1500, 20);
  const pKo = await api.player(page);
  const smashKo = await api.smashAt(page, fg9.cx, fg9.cy);
  const sKo = await api.stats(page);
  const koScope = await api.has(page, '.crs-scope');
  const koBody = await api.bodyInline(page);
  check('A.ko 9: setPlayerHp(5) + a T1 hit → .crs-ko visible in the HUD shadow root with the 💀 title, score/kills/time line and both buttons', tier9 === 'shooter' && !!ko && /당신은 부서졌습니다|You got smashed/.test(ko.text) && /점수|Score/.test(ko.text) && /다시 시작|Restart/.test(ko.text) && /종료|Exit/.test(ko.text), { tier: tier9, hp5, ko: ko || await api.hudQ(page, '.crs-ko') });
  check('A.ko 9: while KO: smashAt → false, player().alive === false, hp ≤ 0, and showKo() scoped out (stats().scoped false, .crs-scope gone, body transform restored)', smashKo === false && pKo.alive === false && pKo.hp <= 0 && scopedPre9 === true && sKo.scoped === false && koScope === false && koBody.transform === '' && koBody.transformOrigin === '', { smash: smashKo, player: pKo, scopedBefore: scopedPre9, scoped: sKo.scoped, scopeNode: koScope, body: koBody });
  await page.screenshot({ path: path.join(OUT, 'ko.png') });
  info('screenshot test/out/ko.png');
  await page.keyboard.press('Enter');
  const koGone = await poll(async () => { const k = await api.hudQ(page, '.crs-ko'); return !k || !k.visible; }, 800, 20);
  const p9 = await api.player(page);
  const s9 = await api.stats(page);
  const pend9 = await api.pending(page);
  check('A.ko 9: Enter → .crs-ko gone, hp 100, alive, broken 0 (restore ran), combat still on', brokenPre9 === true && koGone === true && p9.hp === 100 && p9.alive === true && s9.broken === 0 && (await api.count(page, '[data-crs-broken]')) === 0 && s9.combat === true, { brokenPre9, koGone, player: p9, broken: s9.broken, combat: s9.combat });
  check('A.ko 9: after the restart exactly the timers a fresh restore() arms are live (same count as the pre-KO baseline)', pend9 === pendBase9 && pendBase9 >= 1, { after: pend9, baseline: pendBase9 });
  // regression: a KO with two orbs in flight used to throw inside the physics loop and freeze debris, orbs,
  // beams and the scope follow for the rest of the session (kick() stayed blocked by state.animating)
  await api.restore(page);
  await sleep(60);
  await api.setWeapon(page, 'hammer');
  const fg9b = await api.rect(page, '#figure');
  await api.setPlayerPos(page, fg9b.cx, fg9b.cy);
  await api.setPlayerHp(page, 5);
  const twoOrbs = await page.evaluate((s) => {
    const a = window.__crashScreen; const el = document.querySelector(s);
    const t1 = a.debug.forceAttack(el);
    const t2 = a.debug.forceAttack(el);
    return { t1, t2, orbs: a.stats().orbs };
  }, '#figure');
  const ko9b = await poll(async () => { const k = await api.hudQ(page, '.crs-ko'); return !!(k && k.visible); }, 1500, 20);
  await page.keyboard.press('Enter');
  await poll(async () => { const k = await api.hudQ(page, '.crs-ko'); return !k || !k.visible; }, 800, 20);
  const s9b = await api.stats(page);
  await api.setWeapon(page, 'rocket');
  const bc9b = await api.rect(page, '#big-card');
  await api.smashAt(page, bc9b.cx, bc9b.cy);
  const settled9 = await poll(async () => { const st = await api.stats(page); return st.pieceCount > 0 && st.pieces.some((p) => p.resting) ? st : null; }, 3000, 60);
  await api.setWeapon(page, 'hammer');
  check('A.ko 9: a KO with two orbs in flight neither throws nor freezes the physics loop (lastError null, animating cleared by the restart, debris still falls and rests)', twoOrbs.t1 === 'shooter' && twoOrbs.t2 === 'shooter' && twoOrbs.orbs >= 2 && ko9b === true && s9b.animating === false && s9b.lastError === null && !!settled9, { orbs: twoOrbs, ko: ko9b, afterRestart: { animating: s9b.animating, lastError: s9b.lastError }, settled: !!settled9 });

  // =============================================================================================
  // v1.3 SPEC-readability §6 (assertions 4–9, 11 — assertion 1 lives with the v1.1 power block,
  // assertion 2 with the ammo block, assertion 3 with combat test (5), assertion 10 with the exit
  // test below): the player health ring, the aim-line telegraph, orb legibility, the near-miss
  // graze, hit feedback (hitstop / directional vignette / damage number), T3 track-vs-lock, and
  // reduced motion.
  // =============================================================================================
  console.log('--- v1.3: readability — player ring / aim line / orbs / near miss / hit feedback ---');

  // ---- (R1) §3.1 player health ring ---------------------------------------------------------------------
  await api.restore(page);
  await sleep(60);
  await api.setCombat(page, true);
  const fgR = await api.rect(page, '#figure');
  await api.setPlayerPos(page, fgR.cx, fgR.cy);
  await page.mouse.move(fgR.cx, fgR.cy);
  await sleep(80);
  const ringR = await page.evaluate(() => {
    const n = document.querySelector('.crs-selfbox');
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
  });
  check('A.readability 4: combat ON → .crs-selfbox sits at the cursor (±2 px) with a 44 px diameter', !!ringR && near(ringR.cx, fgR.cx, 2) && near(ringR.cy, fgR.cy, 2) && near(ringR.w, 44, 1) && near(ringR.h, 44, 1), ringR);
  await api.setCombat(page, false);
  await sleep(60);
  check('A.readability 4: combat OFF → no .crs-selfbox', !(await api.has(page, '.crs-selfbox')), await api.has(page, '.crs-selfbox'));
  await api.setCombat(page, true);
  await sleep(60);
  await page.evaluate(() => window.__crashScreen.debug.setPlayerHp(40));
  await sleep(80);
  const ringAngle = await page.evaluate(() => {
    const n = document.querySelector('.crs-self');
    if (!n) return null;
    const degs = [...(n.style.backgroundImage || '').matchAll(/([\d.]+)deg/g)].map((m) => parseFloat(m[1]));
    return degs.length >= 3 ? degs[2] : null;   // [from-0, colour-start, colour-end(=hp%), track-end, 360]
  });
  check('A.readability 4: debug.setPlayerHp(40) → the ring\'s conic-gradient paints 144° ± 5° (40% of 360°)', ringAngle != null && Math.abs(ringAngle - 144) <= 5, ringAngle);
  await page.evaluate(() => window.__crashScreen.debug.setPlayerHp(100));

  // ---- (R2) §3.2 aim-line telegraph ---------------------------------------------------------------------
  await api.restore(page);
  await sleep(60);
  await api.setCombat(page, true);
  await api.setPlayerPos(page, fgR.cx + 500, fgR.cy);
  const tierAim = await api.forceAttack(page, '#figure');
  const aimR = await page.evaluate(() => {
    const label = document.querySelector('.crs-hostile-label');
    return { aimlines: document.querySelectorAll('.crs-aimline').length, label: label ? label.textContent : null };
  });
  check('A.readability 5: debug.forceAttack → exactly one .crs-aimline and the hostile label gets a 🎯 prefix', tierAim === 'shooter' && aimR.aimlines === 1 && /^🎯/.test(aimR.label || ''), aimR);
  const aimGone = await poll(async () => (await api.count(page, '.crs-aimline')) === 0, 700, 20);
  check('A.readability 5: the aim line disappears again once the shot has gone', aimGone === true, await api.count(page, '.crs-aimline'));

  // ---- (R3) §3.3 orb legibility --------------------------------------------------------------------------
  await api.restore(page);
  await sleep(60);
  await api.setCombat(page, true);
  await api.setPlayerPos(page, fgR.cx, fgR.cy);
  const launchR = await page.evaluate((s) => {
    const a = window.__crashScreen;
    const tier = a.debug.forceAttack(document.querySelector(s));
    const orb = document.querySelector('.crs-orb');
    const r = orb ? orb.getBoundingClientRect() : null;
    return { tier, w: r ? r.width : null, h: r ? r.height : null };
  }, '#figure');
  check('A.readability 6: a T1 orb renders at 22 × 22 px', launchR.tier === 'shooter' && near(launchR.w, 22, 1) && near(launchR.h, 22, 1), launchR);
  // the ring is sampled over a LONG flight (player far from the hostile) so several readings land before impact
  await api.restore(page);
  await sleep(60);
  await api.setCombat(page, true);
  const dirRing = sideOf(fgR);
  const farRing = { x: fgR.cx + dirRing * 500, y: fgR.cy };
  await api.setPlayerPos(page, farRing.x, farRing.y);
  const tierRing = await api.forceAttack(page, '#figure');
  await settleRaf(page);   // the ring's left/top/width are written by the NEXT tick, not at spawn time
  const ringSamples = [];
  for (let i = 0; i < 8; i++) {
    const w = await page.evaluate(() => { const n = document.querySelector('.crs-orb-ring'); return n ? n.getBoundingClientRect().width : null; });
    if (w == null) { if (ringSamples.length) break; }   // orb has landed — stop sampling
    else if (w > 20) ringSamples.push(w);   // ignore a pre-layout read (border-only box, a few px)
    await sleep(80);
  }
  const monotonic = ringSamples.length >= 3 && ringSamples.every((v, i) => i === 0 || v <= ringSamples[i - 1] + 0.5);
  check('A.readability 6: the arrival ring exists and its radius falls monotonically as the orb approaches', tierRing === 'shooter' && ringSamples.length >= 3 && monotonic, { tier: tierRing, ringSamples });
  await api.restore(page);
  await sleep(60);
  await api.setCombat(page, true);
  const dirR = sideOf(fgR);
  const farR = { x: fgR.cx + dirR * 500, y: fgR.cy };
  await api.setPlayerPos(page, farR.x, farR.y);
  const launchBright = await page.evaluate((s) => ({ tier: window.__crashScreen.debug.forceAttack(document.querySelector(s)) }), '#figure');
  await sleep(60);
  const opBright = await page.evaluate(() => { const n = document.querySelector('.crs-orb'); return n ? parseFloat(getComputedStyle(n).opacity) : null; });
  await api.setPlayerPos(page, farR.x, farR.y + 400);   // well clear of the orb's flight line now
  await sleep(90);
  const opDim = await page.evaluate(() => { const n = document.querySelector('.crs-orb'); return n ? parseFloat(getComputedStyle(n).opacity) : null; });
  check('A.readability 6: an orb on a hitting trajectory renders bright (opacity 1) and dims (< 0.6) once the player steps off its path', launchBright.tier === 'shooter' && opBright === 1 && opDim != null && opDim < 0.6, { opBright, opDim });

  // ---- (R4) §3.4 near miss / graze -----------------------------------------------------------------------
  await api.restore(page);
  await sleep(60);
  await api.setCombat(page, true);
  const dirN = sideOf(fgR);
  const farN = { x: fgR.cx + dirN * 500, y: fgR.cy };
  await api.setPlayerPos(page, farN.x, farN.y);
  const nearBefore = (await api.stats(page)).nearMisses;
  const launchN = await page.evaluate((s) => ({ tier: window.__crashScreen.debug.forceAttack(document.querySelector(s)) }), '#figure');
  // hitRadius (22) + 25 px off the straight line: inside the graze band (hitRadius, hitRadius + 45], outside a hit
  await api.setPlayerPos(page, farN.x, farN.y + 47);
  const grazeSeen = await poll(async () => { const s = await api.stats(page); return s.nearMisses > nearBefore ? s : null; }, 2500, 30);
  const tagOpacity = await page.evaluate(() => { const t = document.querySelector('.crs-self-tag'); return t ? parseFloat(getComputedStyle(t).opacity) : null; });
  const pAfterGraze = await api.player(page);
  check('A.readability 7: a graze at hitRadius + 25 px leaves hp unchanged, bumps stats().nearMisses, and shows 회피!', launchN.tier === 'shooter' && !!grazeSeen && pAfterGraze.hp === 100 && tagOpacity != null && tagOpacity > 0.05, { launch: launchN, grazeSeen, player: pAfterGraze, tagOpacity });

  // ---- (R5) §3.5 hit feedback: hitstop / directional vignette / damage number size -----------------------
  await api.restore(page);
  await sleep(60);
  await api.setCombat(page, true);
  await api.debug(page, { hitstop: true });
  const fgH = await api.rect(page, '#figure');
  await api.setPlayerPos(page, fgH.cx, fgH.cy);
  await api.seenReset(page);
  const tierH = await api.forceAttack(page, '#figure');
  const hitstopOn = await poll(async () => (await api.stats(page)).hitstop === true, 600, 10);
  const dirVigSeen = await api.has(page, '.crs-vignette.crs-vignette-dir');
  const hitstopOff = await poll(async () => (await api.stats(page)).hitstop === false, 400, 10);
  const dmgFontH = await page.evaluate(() => {
    const d = [...document.querySelectorAll('.crs-dmg')].find((n) => /^[-−]\d/.test((n.textContent || '').trim()));
    return d ? parseFloat(getComputedStyle(d).fontSize) : null;
  });
  const lastHitFromH = (await api.player(page)).lastHitFrom;
  check('A.readability 8: debug.hitstop (default true) → stats().hitstop turns on at the hit and clears again within ~70 ms', tierH === 'shooter' && hitstopOn === true && hitstopOff === true, { tier: tierH, hitstopOn, hitstopOff });
  check('A.readability 8: a directional vignette (.crs-vignette.crs-vignette-dir) is created, the damage number renders at 24 px, and player().lastHitFrom is recorded', dirVigSeen === true && dmgFontH != null && near(dmgFontH, 24, 0.5) && !!lastHitFromH && isFinite(lastHitFromH.x) && isFinite(lastHitFromH.y), { dirVigSeen, dmgFontH, lastHitFromH });
  await api.debug(page, { hitstop: false });
  await api.restore(page);
  await sleep(60);
  await api.setCombat(page, true);
  await api.setPlayerPos(page, fgH.cx, fgH.cy);
  const tierHoff = await api.forceAttack(page, '#figure');
  let sawHitstop = false;
  const tHoff = Date.now();
  while (Date.now() - tHoff < 300) { if ((await api.stats(page)).hitstop) { sawHitstop = true; break; } await sleep(10); }
  check('A.readability 8: debug.hitstop = false → stats().hitstop never turns on after a hit', tierHoff === 'shooter' && sawHitstop === false, { tier: tierHoff, sawHitstop });
  await api.debug(page, { hitstop: true });

  // ---- (R6) §3.3 T3 laser: TRACK follows the player, LOCK does not ----------------------------------------
  await api.restore(page);
  await sleep(60);
  await api.setCombat(page, true);
  const boT = await api.rect(page, '#boss');
  await api.setPlayerPos(page, boT.cx, boT.cy);
  const tierTrack = await api.forceLaser(page, '#boss');
  await sleep(80);   // inside the 550 ms track phase
  const trackA = await page.evaluate(() => { const b = document.querySelector('.crs-beam'); return b ? parseFloat(b.style.top || b.style.left) : null; });
  await api.setPlayerPos(page, boT.cx, boT.cy + 120);
  await sleep(80);
  const trackB = await page.evaluate(() => { const b = document.querySelector('.crs-beam'); return b ? parseFloat(b.style.top || b.style.left) : null; });
  const locked = await poll(async () => (await api.has(page, '.crs-beam.crs-beam-lock')), 700, 20);
  const lockPos = await page.evaluate(() => { const b = document.querySelector('.crs-beam'); return b ? parseFloat(b.style.top || b.style.left) : null; });
  await api.setPlayerPos(page, boT.cx, boT.cy + 240);
  await sleep(80);
  const afterLockMove = await page.evaluate(() => { const b = document.querySelector('.crs-beam'); return b ? parseFloat(b.style.top || b.style.left) : null; });
  check('A.readability 9: during TRACK the laser line follows the player, but once LOCKED it stops following', tierTrack === 'laser' && trackA !== trackB && locked === true && near(lockPos, afterLockMove, 0.5), { trackA, trackB, lockPos, afterLockMove });

  // ---- (R7) §3.5 reduced motion: hitstop and screen-shake are dropped, the vignette stays -----------------
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await api.restore(page);
  await sleep(60);
  await api.setCombat(page, true);
  await api.debug(page, { hitstop: true });
  const fgRM = await api.rect(page, '#figure');   // re-scroll: §3.3's T3 block (R6) scrolled the page to #boss
  await api.setPlayerPos(page, fgRM.cx, fgRM.cy);
  const tierRM = await api.forceAttack(page, '#figure');
  await sleep(60);
  const statsRM = await api.stats(page);
  const rootTransformRM = await page.evaluate(() => getComputedStyle(document.querySelector('.crs-root')).transform);
  const vigRM = await api.has(page, '.crs-vignette.crs-vignette-dir');
  check('A.readability 11: prefers-reduced-motion → no hitstop and no screen-shake transform on a hit, but the directional vignette still shows', tierRM === 'shooter' && statsRM.hitstop === false && rootTransformRM === 'none' && vigRM === true, { tier: tierRM, hitstop: statsRM.hitstop, rootTransform: rootTransformRM, vig: vigRM });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  // combat stays ON here (section (10) below is the one that tests turning it off) — reduced motion is undone.
  await api.restore(page);
  await sleep(60);

  // ---- (10) combat off / selection tick ----------------------------------------------------------------
  await api.restore(page);
  await sleep(60);
  const fg10 = await api.rect(page, '#figure');
  await api.setPlayerPos(page, fg10.cx + sideOf(fg10) * 500, fg10.cy);
  const tier10 = await api.forceAttack(page, '#figure');
  const hostilesPre = (await api.stats(page)).hostiles;
  const offRet = await api.setCombat(page, false);
  const after10 = await page.evaluate(() => { const c = (s) => document.querySelectorAll(s).length; return { hostile: c('.crs-hostile'), orb: c('.crs-orb'), beam: c('.crs-beam'), warn: c('.crs-warn') }; });
  const playerHud10 = await api.hudQ(page, '.crs-player');
  const s10 = await api.stats(page);
  check('A.combat 10: setCombat(false) → no .crs-hostile / .crs-orb / .crs-beam / .crs-warn, stats().hostiles === 0, combat false', tier10 === 'shooter' && hostilesPre >= 1 && after10.hostile === 0 && after10.orb === 0 && after10.beam === 0 && after10.warn === 0 && s10.hostiles === 0 && s10.combat === false && (await api.combat(page)) === false, { ret: offRet, tier: tier10, hostilesPre, after10, stats: { hostiles: s10.hostiles, combat: s10.combat } });
  check('A.combat 10: player HUD (.crs-player) hidden while combat is off', !playerHud10 || !playerHud10.visible, playerHud10);
  check('A.combat 10: crsCombat === false persisted', (await api.store(page)).crsCombat === false, await api.store(page));
  // SPEC-combat-v2 §0.5: H no longer toggles one boolean — it CYCLES rampage → quickdraw → survival → rampage.
  // Combat is "on" for the two middle modes and off at the wrap, so the old on/off claim is checked across the
  // full cycle, and the mode each press lands on is asserted as well.
  const pressH = async (want) => {
    await page.keyboard.press('h');
    const got = await poll(async () => { const s = await api.stats(page); return s.mode === want ? s : null; }, 600, 15);
    return got ? { mode: got.mode, combat: got.combat } : { mode: (await api.stats(page)).mode, combat: (await api.stats(page)).combat };
  };
  const hCycle = [await pressH('quickdraw'), await pressH('survival'), await pressH('rampage')];
  check('A.combat 10: "H" cycles rampage → quickdraw → survival → rampage (§0.5), combat on for the two middle modes and off at the wrap', hCycle[0].mode === 'quickdraw' && hCycle[0].combat === true && hCycle[1].mode === 'survival' && hCycle[1].combat === true && hCycle[2].mode === 'rampage' && hCycle[2].combat === false, hCycle);
  await api.setCombat(page, true);
  await api.restore(page);
  await page.evaluate(() => { try { window.dispatchEvent(new Event('focus')); } catch (e) { /* ignore */ } });
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  const t10 = Date.now();
  await api.debug(page, { noAttacks: false });
  const sel = await poll(async () => { const s = await api.stats(page); return s.hostiles >= 1 ? { hostiles: s.hostiles, ms: Date.now() - t10 } : null; }, 8000, 100);
  await api.debug(page, { noAttacks: true });
  const auraCount = await api.count(page, '.crs-hostile');
  check('A.combat 10: with noAttacks off the selection tick marks ≥ 1 hostile within 8 s (5 s grace) and draws its aura', !!sel && auraCount >= 1, { sel, auraCount, stats: await api.stats(page).then((s) => ({ hostiles: s.hostiles, paused: s.paused, combat: s.combat })) });
  info(`selection tick: ${sel ? `${sel.hostiles} hostile(s) after ${sel.ms} ms` : 'none within 8 s'}`);
  await api.setCombat(page, false);
  await api.restore(page);
  await sleep(60);

  // ---- (11) Z restores, R reloads ------------------------------------------------------------------------
  await api.setWeapon(page, 'hammer');
  const sc11 = await api.rect(page, '#small-card');
  const scPt11 = { x: sc11.left + 12, y: sc11.top + 12 };
  await page.evaluate((p) => { const a = window.__crashScreen; a.smashAt(p.x, p.y); a.smashAt(p.x, p.y); }, scPt11);
  const broken11 = await poll(() => api.broken(page, '#small-card'), 500, 15);
  await page.keyboard.press('r');
  await sleep(150);
  const stillBroken = await api.broken(page, '#small-card');
  await page.keyboard.press('z');
  const zRestored = await poll(async () => (await api.stats(page)).broken === 0 && !(await api.broken(page, '#small-card')), 800, 20);
  check('A.keys 11: "R" no longer restores (card stays broken); "Z" restores (broken 0, card back)', broken11 === true && stillBroken === true && zRestored === true, { broken11, stillBroken, zRestored });
  const restoreTitle = await page.evaluate(() => { const h = document.querySelector('crs-hud, .crs-hud-host'); const b = h && h.shadowRoot ? [...h.shadowRoot.querySelectorAll('button')].find((x) => /복구|Restore/.test(x.textContent || '')) : null; return b ? b.title : null; });
  check('A.keys 11: HUD 복구 button title reads (Z)', typeof restoreTitle === 'string' && /\(Z\)/.test(restoreTitle), restoreTitle);
  await api.debug(page, { fastReload: false });
  await api.setWeapon(page, 'pistol');
  await api.smashAt(page, scPt11.x, scPt11.y);
  const m11 = await api.ammo(page);
  await page.keyboard.press('r');
  const rl11 = await poll(async () => { const m = await api.ammo(page); return m.reloading ? m : null; }, 500, 15);
  check('A.keys 11: "R" with a partly empty pistol (11/12) → ammo().reloading === true', m11.mag === 11 && !!rl11, { before: m11, after: rl11 || await api.ammo(page) });
  await poll(async () => !(await api.ammo(page)).reloading, 1300, 30);
  await api.debug(page, { fastReload: true });

  // ---- (14) stress: 2 s smg hold + 10 sniper shots + 4 s of live combat ----------------------------------
  await api.setCombat(page, true);
  await api.restore(page);
  await sleep(60);
  await api.debug(page, { infiniteAmmo: true });
  const err14 = log.pageErrors.length;
  let peak14 = 0;
  const sampleNodes = async () => { const n = await api.count(page, '[data-crs]'); if (n > peak14) peak14 = n; return n; };
  await api.setWeapon(page, 'smg');
  ap = await arenaPt(page);
  await holdAt(page, ap, 2000, sampleNodes);
  await api.setWeapon(page, 'sniper');
  const sn14 = await page.evaluate((p) => { const a = window.__crashScreen; let n = 0; for (let i = 0; i < 10; i++) if (a.smashAt(p.x, p.y)) n++; return n; }, ap);
  await api.debug(page, { noAttacks: false });
  const forced14 = [await api.forceAttack(page, '#arena'), await api.forceAttack(page, '#boss')];
  const t14 = Date.now();
  while (Date.now() - t14 < 4000) { await sampleNodes(); await sleep(150); }
  await api.debug(page, { noAttacks: true, infiniteAmmo: false });
  const s14 = await api.stats(page);
  const now14 = await api.count(page, '[data-crs]');
  info(`stress 14: sniper shots ${sn14}/10, forced ${JSON.stringify(forced14)}, hostiles ${s14.hostiles}, orbs ${s14.orbs}, player hp ${(await api.player(page)).hp}, peak [data-crs] ${peak14}`);
  check('A.stress 14: 2 s smg hold + 10 sniper shots + 4 s of live combat → no page errors', log.pageErrors.length === err14, log.pageErrors.slice(err14, err14 + 2));
  check('A.stress 14: stats().lastError === null', s14.lastError === null, s14.lastError);
  check('A.stress 14: [data-crs] nodes ≤ 400 throughout (peak and now)', peak14 <= 400 && now14 <= 400, { peak: peak14, now: now14 });
  await api.restore(page);
  await sleep(60);

  // ---- (12) pause, layered Escape, exit during a hold with combat on --------------------------------------
  await api.setCombat(page, true);
  await api.restore(page);
  await sleep(60);
  await api.setWeapon(page, 'hammer');
  const fg12 = await api.rect(page, '#figure');
  await api.setPlayerPos(page, fg12.cx + sideOf(fg12) * 500, fg12.cy);
  const tier12 = await api.forceAttack(page, '#figure');
  const orbLive = await poll(async () => (await api.count(page, '.crs-orb')) >= 1, 300, 10);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const pausedState = await poll(async () => { const s = await api.stats(page); const n = await api.count(page, '.crs-orb'); return s.paused === true && n === 0 ? { paused: s.paused, orbs: n } : null; }, 100, 10);
  const forcePaused = await api.forceAttack(page, '#figure');
  check('A.pause 12: window blur with an orb in flight → within 100 ms no .crs-orb and stats().paused === true', tier12 === 'shooter' && orbLive === true && !!pausedState, { tier: tier12, orbLive, state: pausedState || { paused: (await api.stats(page)).paused, orbs: await api.count(page, '.crs-orb') } });
  check('A.pause 12: forceAttack while paused → null', forcePaused === null, forcePaused);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const resumed = await poll(async () => (await api.stats(page)).paused === false, 300, 10);
  check('A.pause 12: window focus → stats().paused === false', resumed === true, (await api.stats(page)).paused);
  await api.setWeapon(page, 'sniper');
  await api.scope(page, true);
  await poll(async () => (await api.stats(page)).scoped === true, 300, 15);
  await page.keyboard.press('Escape');
  const esc1 = await poll(async () => (await api.stats(page)).scoped === false, 500, 15);
  check('A.exit 12: Escape while scoped (combat on) → scope off, still active', esc1 === true && (await api.active(page)) === true, { scoped: (await api.stats(page)).scoped, active: await api.active(page) });
  await api.restore(page);   // fresh hostile set (restore keeps the page active)
  await api.setPlayerPos(page, fg12.cx + sideOf(fg12) * 500, fg12.cy);
  const tier12b = await api.forceAttack(page, '#figure');   // an orb in flight at exit time
  await api.setWeapon(page, 'smg');
  ap = await arenaPt(page);
  await page.mouse.move(ap.x, ap.y);
  await page.mouse.down();
  const holding12 = await poll(async () => (await api.stats(page)).holding === true, 300, 10);
  // SPEC-readability §6 assertion 10: force every readability node alive right before Escape — a fresh aim
  // line (forceAttack again), the low-HP vignette (no timer, so it is deterministic), and the player ring
  // (already up since combat is on and the cursor is in the window).
  await page.evaluate(() => window.__crashScreen.debug.setPlayerHp(20));
  // The aim line lives only for the length of a wind-up, and forceAttack() is refused while the hostile is still
  // busy with the previous one, so a single call can land in the gap and leave no telegraph on screen. Retry until
  // all three nodes are genuinely up — the assertion that matters is the one below it (the EXIT clears them all),
  // and it only means anything when every readability node was really alive first.
  let before12r = { self: 0, aim: 0, vig: 0 };
  await poll(async () => {
    before12r = await page.evaluate(() => ({
      self: document.querySelectorAll('.crs-self, .crs-selfbox').length,
      aim: document.querySelectorAll('.crs-aimline').length,
      vig: document.querySelectorAll('.crs-vignette').length,
    }));
    if (before12r.self > 0 && before12r.aim > 0 && before12r.vig > 0) return true;
    await api.forceAttack(page, '#figure');
    return false;
  }, 1500, 50);
  check('A.readability 10: before Escape, combat readability nodes are present (.crs-self / .crs-aimline / .crs-vignette)', before12r.self > 0 && before12r.aim > 0 && before12r.vig > 0, before12r);
  await page.keyboard.press('Escape');
  const inactive12 = await poll(async () => !(await api.active(page)), 1500, 20);
  const nodes12 = await api.count(page, '[data-crs]');
  const after12r = await page.evaluate(() => ({
    self: document.querySelectorAll('.crs-self, .crs-selfbox').length,
    aim: document.querySelectorAll('.crs-aimline').length,
    vig: document.querySelectorAll('.crs-vignette').length,
  }));
  const body12 = await api.bodyInline(page);
  const pend12 = await api.pending(page);
  await page.mouse.up();
  await sleep(2000);
  const orbs12 = await api.count(page, '.crs-orb');
  const pend12b = await api.pending(page);
  await settleRaf(page);
  const raf12 = await api.pendingRaf(page);
  check('A.exit 12: Escape during an smg hold with combat on and an orb in flight → inactive, zero [data-crs] nodes', tier12b === 'shooter' && holding12 === true && inactive12 === true && nodes12 === 0, { tier: tier12b, holding12, inactive12, nodes12 });
  check('A.readability 10: Escape during combat clears every readability node too (.crs-self / .crs-aimline / .crs-vignette all zero, folded into the zero [data-crs] count above)', after12r.self === 0 && after12r.aim === 0 && after12r.vig === 0, after12r);
  check('A.exit 12: body inline transform / transform-origin "" after the exit', body12.transform === '' && body12.transformOrigin === '', body12);
  check('A.exit 12: no .crs-orb 2 s after the exit, zero live timers / intervals (right after and 2 s later) and zero live animation frames', orbs12 === 0 && pend12 === 0 && pend12b === 0 && raf12 === 0, { orbs12, pend12, pend12b, raf12 });
  check('A.exit 12: no console errors and no page errors during the v1.2 block', log.consoleErrors.length === conBefore && log.pageErrors.length === errBefore, { console: log.consoleErrors.slice(conBefore, conBefore + 2), page: log.pageErrors.slice(errBefore, errBefore + 2) });
  // re-activate for the v1 blocks that follow (A.escape 16 needs an active page)
  const rOn = await page.evaluate(contentJs);
  check('A.exit 12: re-evaluating content.js after the exit → "on" again', rOn === 'on', rOn);
  await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: false });
  await api.applyPreset(page, 'default');
  await api.setWeapon(page, 'hammer');
  await api.restore(page);
  await sleep(100);
}

// ---------------------------------------------------------------------------
// Suite A14 — v1.4 combat-v2: drone avatar / aim lock-on / repairing enemies
// (SPEC-combat-v2 §7), debris auto-despawn (§9.4), depth-of-stack (§10.6).
//
// Written against the spec CONTRACT while the product code lands in parallel. Several points are
// under-specified in the spec text itself; the readings picked (documented inline and in the
// handoff notes) are the ones that make each assertion exercise real, observable behaviour:
//   - No JS setter name is given for the new `mode` (rampage/survival/quickdraw) — only the `H`
//     hotkey and a HUD button are named (§0.5). setCombatMode() below tries a same-named debug
//     setter first (future-proofing) and otherwise drives the documented H-cycle.
//   - debug.forceRepair(el)'s `el` is the HOSTILE (the healer), matching debug.forceAttack(el)'s
//     existing convention; its return value is the restored TARGET element (or null).
//   - "대상 요소를 다시 부수면 취소된다" (§3.1) is tested via its unambiguous sibling clause instead
//     ("처치하면"): the healer is killed outright mid-beam, which is unambiguous to assert.
//   - debug.forceBoss's exact signature isn't specified beyond "forceBoss + HP를 30%로 낮춘 뒤
//     공격 강제" (§7.11); it's called if present, then the boss HP is independently driven ≤ 30%
//     by hand as a fallback so the assertion doesn't hinge on guessing that signature.
//   - The avatar's "nose" (§1.1) has no selector in the class-name contract (.crs-avatar only) —
//     resolved via a `.crs-avatar-nose` selector first, else the most-rotated descendant of
//     .crs-avatar as a fallback.
//   - "dash afterimages absent under reduced motion" (§7.14) is approximated by asserting the
//     .crs-avatar node count stays exactly 1 through a dash (no extra same-class ghost copies),
//     since no afterimage class name is in the contract either.
// ---------------------------------------------------------------------------
async function suiteA14(page, log, contentJs) {
  console.log('--- v1.4: combat v2 — drone avatar / aim lock-on / repairing enemies (SPEC-combat-v2 §7), debris lifetime (§9.4), depth-of-stack (§10.6) ---');
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const norm360 = (a) => ((a % 360) + 360) % 360;
  const angDist = (a, b) => { const d = Math.abs(norm360(a) - norm360(b)) % 360; return d > 180 ? 360 - d : d; };
  const W14 = await weaponTable(page);
  const DMG14 = W14.dmg;

  const onV14 = await page.evaluate(contentJs);
  check('A.v2: content.js reactivated for the combat-v2 / debris / depth block', onV14 === 'on', onV14);
  await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: false, noRepair: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await api.restore(page);
  await sleep(80);

  // Spec §0.5 names only the H hotkey / HUD button to cycle rampage → survival → quickdraw → rampage,
  // not a JS setter. Try a same-named debug setter first (harmless if absent), then drive the hotkey.
  async function setCombatMode(target) {
    try { await page.evaluate((m) => { const a = window.__crashScreen; if (a && typeof a.setCombatMode === 'function') a.setCombatMode(m); }, target); } catch (e) { /* ignore */ }
    for (let i = 0; i < 4; i++) {
      const cur = (await api.stats(page)).mode;
      if (cur === target) return true;
      await page.keyboard.press('h');
      await sleep(100);
    }
    return (await api.stats(page)).mode === target;
  }
  async function resetScene(x, y) {
    await api.restore(page);
    await sleep(80);
    await page.evaluate((px, py) => { const a = window.__crashScreen; a.debug.setPlayerHp(100); if (typeof a.debug.setAvatarPos === 'function') a.debug.setAvatarPos(px, py); }, x, y);
  }
  const force = (sel, fn) => page.evaluate((s, f) => { const el = document.querySelector(s); const d = window.__crashScreen.debug; return typeof d[f] === 'function' ? d[f](el) : 'missing:' + f; }, sel, fn);
  // Guards every NEW v1.4 debug hook the same way `force` guards the element-taking ones: while the product
  // lands incrementally, a hook that is not wired up yet must fail the assertion that reads it, not crash the
  // whole suite with a TypeError and take every later assertion down with it.
  const debugCall = (fn, ...args) => page.evaluate((f, a) => {
    const d = window.__crashScreen && window.__crashScreen.debug;
    return (d && typeof d[f] === 'function') ? d[f](...a) : 'missing:' + f;
  }, fn, args);
  // hostileAttack() (90-combat.js) refuses an off-screen element outright (debug.forceAttack then returns
  // null, indistinguishable from "no scheduler for this tier"), and depthOf()/hpOf().depth read the element's
  // live viewport rect — so §10.6's depth-lab fixture (way below the fold) must be scrolled into view before
  // every forceAttack/forceLock/depthOf/hpOf-tier read on it, not just once at the top of that section.
  const scrollToDepthLab = () => api.rect(page, '#depth-front');

  // =======================================================================================
  // §7 — combat v2 (avatar / lock-on / repair) suite A tests 1–14
  // =======================================================================================

  // ---- (1) avatar presence + spawn position (§7.1) ----
  await setCombatMode('rampage');
  await sleep(100);
  check('A.v2 7.1: rampage (no enemies) → zero .crs-avatar', (await api.count(page, '.crs-avatar')) === 0, await api.count(page, '.crs-avatar'));
  const survivalOn1 = await setCombatMode('survival');
  await sleep(200);
  const avatarCount1 = await api.count(page, '.crs-avatar');
  const spawn1 = await page.evaluate(() => {
    const n = document.querySelector('.crs-avatar');
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, vw: innerWidth, vh: innerHeight };
  });
  check('A.v2 7.1: survival mode → exactly one .crs-avatar', survivalOn1 === true && avatarCount1 === 1, { survivalOn1, avatarCount1 });
  check('A.v2 7.1: avatar spawns at viewport centre-bottom (x ≈ vw/2, y ≈ 0.72·vh, ±20 px)', !!spawn1 && near(spawn1.cx, spawn1.vw / 2, 20) && near(spawn1.cy, 0.72 * spawn1.vh, 20), spawn1);

  // ---- (2) WASD movement, friction stop, boundary clamp (§7.2) ----
  await resetScene(200, 400);
  const p0_72 = await api.player(page);
  await page.keyboard.down('d');
  // a little over the spec's 400 ms to absorb CDP round-trip slop in a loaded test run (the ≥ 100 px bar
  // itself is unchanged — this just protects against losing a handful of ms off the held duration).
  await sleep(480);
  await page.keyboard.up('d');
  const p1_72 = await api.player(page);
  // friction is evaluated on velocity, not a fixed-position snapshot: §1.2's 0.86/frame decay still covers a
  // measurable distance before fully stopping, so "stopped" means vx settled near 0, not "didn't move at all".
  const settleStart72 = Date.now();
  const vxSettled72 = await poll(async () => { const p = await api.player(page); return Math.abs(p.vx) <= 5 ? p : null; }, 2000, 60);
  check('A.v2 7.2: holding D for ~450 ms moves the avatar ≥ 100 px right', !!p0_72 && !!p1_72 && (p1_72.x - p0_72.x) >= 100, { before: p0_72 && p0_72.x, after: p1_72 && p1_72.x });
  check('A.v2 7.2: releasing D lets friction bring vx back to ~0 within 2 s (no need to hold D to stay stopped)', !!vxSettled72, { vxAfterRelease: p1_72 && p1_72.vx, msToSettle: Date.now() - settleStart72, settled: vxSettled72 });
  await resetScene(200, 400);
  await page.keyboard.down('d');
  await sleep(2600);
  await page.keyboard.up('d');
  await sleep(400);
  const pEdge72 = await api.player(page);
  check('A.v2 7.2: the avatar cannot be driven past the 20 px viewport margin (x ≤ innerWidth − 20)', !!pEdge72 && pEdge72.x <= VIEWPORT.width - 20 + 1, pEdge72 && pEdge72.x);

  // ---- (3) the avatar's nose rotates toward the cursor (§7.3) ----
  await resetScene(500, 500);
  const readNoseAngle = () => page.evaluate(() => {
    const decode = (t) => {
      if (!t || t === 'none') return null;
      const m = t.match(/matrix\(([^)]+)\)/);
      if (m) { const p = m[1].split(',').map(Number); return Math.atan2(p[1], p[0]) * 180 / Math.PI; }
      const r = t.match(/rotate\(([-\d.]+)deg\)/);
      return r ? parseFloat(r[1]) : null;
    };
    const avatar = document.querySelector('.crs-avatar');
    if (!avatar) return null;
    let nose = avatar.querySelector('.crs-avatar-nose');
    if (!nose) {
      let best = null, bestMag = -1;
      const walk = (el) => { for (const c of el.children) { const a = decode(getComputedStyle(c).transform); if (a != null && Math.abs(a) > bestMag) { bestMag = Math.abs(a); best = c; } walk(c); } };
      walk(avatar);
      nose = best;
    }
    return nose ? decode(getComputedStyle(nose).transform) : null;
  });
  // re-dispatch the move a few times rather than trust one fixed sleep: the nose only repaints on the physics
  // tick that follows the pointermove, and a loaded test run can occasionally miss one frame's window.
  let noseAngle3 = null;
  for (let i = 0; i < 6 && (noseAngle3 == null || angDist(noseAngle3, 180) > 20); i++) {
    await page.mouse.move(500 - 300, 500 + (i % 2));   // the +1/-0 jiggle guarantees a genuinely new coordinate each try
    await sleep(150);
    noseAngle3 = await readNoseAngle();
  }
  check('A.v2 7.3: pointing the mouse to the avatar\'s LEFT rotates its nose to ≈180° (±20°) — see notes on the .crs-avatar-nose assumption', noseAngle3 != null && angDist(noseAngle3, 180) <= 20, noseAngle3);

  // ---- (4) dash: displacement, i-frames, dashReadyAt, cooldown gate (§7.4) ----
  await resetScene(300, 400);
  await debugCall('dashReady');
  const dashBefore4 = await api.player(page);
  await page.keyboard.press('Space');
  await sleep(180);
  const dashAfter4 = await api.player(page);
  const dashDist4 = (dashBefore4 && dashAfter4) ? Math.hypot(dashAfter4.x - dashBefore4.x, dashAfter4.y - dashBefore4.y) : null;
  check('A.v2 7.4: Space dashes the avatar ≈ 180 px within ~160 ms (±30 px)', dashDist4 != null && near(dashDist4, 180, 30), { dashBefore4, dashAfter4, dashDist4 });
  check('A.v2 7.4: dashReadyAt is set to a future timestamp right after dashing', !!dashAfter4 && typeof dashAfter4.dashReadyAt === 'number' && dashAfter4.dashReadyAt > Date.now() - 50, dashAfter4 && dashAfter4.dashReadyAt);
  const lockRet4 = await force('#figure', 'forceLock');
  await sleep(2820);   // just shy of the 3.0 s lock resolve
  const hpBeforeResolve4 = (await api.player(page)).hp;
  await page.keyboard.press('Space');   // dash now straddles the resolve instant with its 220 ms i-frames
  await sleep(500);
  const hpAfterResolve4 = (await api.player(page)).hp;
  check('A.v2 7.4: a lock-on resolving during the dash\'s 220 ms invulnerability window deals zero damage', !!lockRet4 && hpAfterResolve4 === hpBeforeResolve4, { lockRet4, hpBeforeResolve4, hpAfterResolve4 });
  const posAtSecondSpace4 = await api.player(page);
  await page.keyboard.press('Space');   // still on the 1.5 s cooldown
  await sleep(180);
  const posAfterIgnored4 = await api.player(page);
  check('A.v2 7.4: a second Space during the 1.5 s cooldown is ignored (no extra displacement)', !!posAtSecondSpace4 && !!posAfterIgnored4 && Math.hypot(posAfterIgnored4.x - posAtSecondSpace4.x, posAfterIgnored4.y - posAtSecondSpace4.y) <= 5, { posAtSecondSpace4, posAfterIgnored4 });
  await sleep(600);

  // ---- (5) lock-on bracket shrinks monotonically across its three stages; tracks before 1.5 s, fixed after (§7.5) ----
  await resetScene(400, 400);
  const lockId5 = await force('#figure', 'forceLock');
  const sizeAt5 = async (ms) => { await sleep(ms); return page.evaluate(() => { const n = document.querySelector('.crs-lock'); if (!n) return null; const r = n.getBoundingClientRect(); return r.width + r.height; }); };
  const s05_5 = await sizeAt5(500);
  const s18_5 = await sizeAt5(1300);   // cumulative 1.8 s
  const s27_5 = await sizeAt5(900);    // cumulative 2.7 s — a null here (already resolved/removed) still honours
                                        // "shrinks monotonically to nothing", so it is accepted, just not a size that grew back
  check('A.v2 7.5: debug.forceLock produces a .crs-lock node and its bracket size shrinks monotonically (0.5 s > 1.8 s > 2.7 s or gone)', !!lockId5 && s05_5 != null && s18_5 != null && s05_5 > s18_5 && (s27_5 == null || s18_5 > s27_5), { lockId5, s05_5, s18_5, s27_5 });
  await sleep(500);
  await resetScene(400, 400);
  const lockId5b = await force('#figure', 'forceLock');
  await sleep(600);   // before 1.2 s: still tracking
  await debugCall('setAvatarPos', 700, 400);
  await sleep(200);
  const centerTracking5 = await page.evaluate(() => { const n = document.querySelector('.crs-lock'); if (!n) return null; const r = n.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
  await sleep(900);   // now past 1.5 s: fixed phase
  const beforeMoveFixed5 = await page.evaluate(() => { const n = document.querySelector('.crs-lock'); if (!n) return null; const r = n.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
  await debugCall('setAvatarPos', 900, 400);
  await sleep(200);
  const afterMoveFixed5 = await page.evaluate(() => { const n = document.querySelector('.crs-lock'); if (!n) return null; const r = n.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
  check('A.v2 7.5: before 1.5 s the lock-on frame (over the avatar in survival) re-centres as the avatar moves (centre reaches ≈ 700,400)', !!lockId5b && !!centerTracking5 && near(centerTracking5.cx, 700, 50), { lockId5b, centerTracking5 });
  check('A.v2 7.5: after 1.5 s the lock-on frame is fixed — moving the avatar again does not move it', !!beforeMoveFixed5 && !!afterMoveFixed5 && near(beforeMoveFixed5.cx, afterMoveFixed5.cx, 2) && near(beforeMoveFixed5.cy, afterMoveFixed5.cy, 2), { beforeMoveFixed5, afterMoveFixed5 });
  await sleep(1100);

  // ---- (6) lock-on hit vs. evade (§7.6) ----
  await resetScene(400, 400);
  await force('#figure', 'forceLock');
  const hpBefore76 = (await api.player(page)).hp;
  await sleep(3300);
  const hpAfter76 = (await api.player(page)).hp;
  const lockGone76 = (await api.count(page, '.crs-lock')) === 0;
  check('A.v2 7.6: standing still through the full 3.0 s lock → health decreases and the .crs-lock node disappears', hpAfter76 < hpBefore76 && lockGone76, { hpBefore76, hpAfter76, lockGone76 });
  await resetScene(400, 400);
  const nearBefore76 = (await api.stats(page)).nearMisses;
  await force('#figure', 'forceLock');
  await sleep(1600);   // past the 1.5 s fixed-phase threshold
  await debugCall('setAvatarPos', 650, 400);   // ≥ 100 px away
  await sleep(1700);
  const hpAfterDodge76 = (await api.player(page)).hp;
  const nearAfter76 = (await api.stats(page)).nearMisses;
  check('A.v2 7.6: stepping ≥ 100 px away after the 1.5 s fixed phase avoids the hit (hp unchanged) and bumps stats().nearMisses', hpAfterDodge76 === 100 && nearAfter76 === nearBefore76 + 1, { hpAfterDodge76, nearBefore76, nearAfter76 });

  // ---- (7) repair restores a nearby broken original (§7.7) ----
  await resetScene(400, 400);
  await api.setWeapon(page, 'hammer');
  const sc7 = await api.rect(page, '#small-card');
  await clickUntilBroken(page, '#small-card', sc7.cx, sc7.cy, 3);
  check('A.v2 7.7: #small-card is broken before the repair test', await api.broken(page, '#small-card'));
  await force('#figure', 'forceAttack');
  const scoreBefore7 = (await api.player(page)).score;
  const repairTarget7 = await page.evaluate((sel) => {
    const d = window.__crashScreen.debug;
    if (typeof d.forceRepair !== 'function') return 'missing:forceRepair';
    const el = d.forceRepair(document.querySelector(sel));
    return el ? (el.id || el.tagName) : null;
  }, '#figure');
  const beamSeen7 = await poll(() => api.has(page, '.crs-repair'), 500);
  check('A.v2 7.7: debug.forceRepair(#figure) picks the broken #small-card within 600 px and starts a .crs-repair beam', repairTarget7 === 'small-card' && beamSeen7 === true, { repairTarget7, beamSeen7 });
  // §3.1 step 3: the 1.5 s beam is followed by a further 600 ms piece-return animation before the original is
  // actually un-hidden, so this polls out to ~2.3 s rather than stopping right at the beam's own 1.5 s.
  const broken7after = await poll(async () => (await api.broken(page, '#small-card')) === false ? false : null, 2300, 80);
  const vis7after = await api.visibility(page, '#small-card');
  const repaired7 = (await api.stats(page)).repaired;
  const scoreAfter7 = (await api.player(page)).score;
  check('A.v2 7.7: #small-card is un-broken, visible again, stats().repaired === 1 and the score dropped (allowing the 600 ms piece-return animation after the 1.5 s beam)', broken7after === false && vis7after !== 'hidden' && repaired7 === 1 && scoreAfter7 < scoreBefore7, { broken7after, vis7after, repaired7, scoreBefore7, scoreAfter7 });

  // ---- (8) killing the healer mid-beam cancels the repair (§7.8) ----
  await resetScene(400, 400);
  await api.setWeapon(page, 'hammer');
  const sc8 = await api.rect(page, '#small-card');
  await clickUntilBroken(page, '#small-card', sc8.cx, sc8.cy, 3);
  await force('#figure', 'forceAttack');
  await force('#figure', 'forceRepair');
  const beamSeen8 = await poll(() => api.has(page, '.crs-repair'), 500);
  await api.setWeapon(page, 'rocket');
  const fg8 = await api.rect(page, '#figure');
  await smashUntil(page, () => api.broken(page, '#figure'), fg8.left + 6, fg8.top + 6, 6);
  await sleep(1700);
  const scStillBroken8 = await api.broken(page, '#small-card');
  check('A.v2 7.8: killing the repairing hostile mid-beam cancels the repair — #small-card is still broken 1.5+ s later', beamSeen8 === true && scStillBroken8 === true, { beamSeen8, scStillBroken8 });
  await api.setWeapon(page, 'hammer');

  // ---- (9) destroy ratio tracks broken vs. repaired area (§7.9) ----
  // §3.2: the meter refreshes every 2 s, not on every break/repair — every read below polls for that tick
  // rather than sampling immediately, which would just catch the stale previous value.
  await resetScene(400, 400);
  const ratio0_9 = (await api.stats(page)).destroyRatio;
  check('A.v2 7.9: stats().destroyRatio === 0 with nothing broken', ratio0_9 === 0, ratio0_9);
  const bc9 = await api.rect(page, '#big-card');
  await smashUntil(page, () => api.broken(page, '#big-card'), bc9.cx, bc9.cy, 6);
  const ratio1_9 = await poll(async () => { const r = (await api.stats(page)).destroyRatio; return r > 0 ? r : null; }, 2600, 100);
  check('A.v2 7.9: breaking a large element raises stats().destroyRatio above 0 (within the 2 s refresh)', ratio1_9 > 0, ratio1_9);
  await force('#figure', 'forceAttack');
  await force('#figure', 'forceRepair');
  await sleep(1700);   // the 1.5 s repair beam completing
  const ratio2_9 = await poll(async () => { const r = (await api.stats(page)).destroyRatio; return r < ratio1_9 ? r : null; }, 2600, 100);
  check('A.v2 7.9: a completed repair brings stats().destroyRatio back down (within the next 2 s refresh)', ratio2_9 != null && ratio2_9 < ratio1_9, { ratio1_9, ratio2_9: ratio2_9 != null ? ratio2_9 : (await api.stats(page)).destroyRatio });

  // ---- (10) T3 uses the lock-on instead of the laser (§7.10) ----
  await resetScene(400, 400);
  await api.rect(page, '#boss');   // hostileAttack() requires the element on-screen — scroll it into view first
  const tier10 = await force('#boss', 'forceAttack');
  await sleep(150);
  check('A.v2 7.10: debug.forceAttack(#boss) now returns "lock", not "laser"', tier10 === 'lock', tier10);
  check('A.v2 7.10: no .crs-beam appears for a T3 attack any more (replaced by .crs-lock)', (await api.count(page, '.crs-beam')) === 0 && (await api.count(page, '.crs-lock')) >= 1, { beams: await api.count(page, '.crs-beam'), locks: await api.count(page, '.crs-lock') });
  await sleep(3200);

  // ---- (11) boss stage 3 regains the laser sweep (§7.11) ----
  await resetScene(400, 400);
  let forceBoss11 = null;
  try { forceBoss11 = await page.evaluate(() => (window.__crashScreen.debug && typeof window.__crashScreen.debug.forceBoss === 'function') ? window.__crashScreen.debug.forceBoss(0.3) : 'missing:debug.forceBoss'); } catch (e) { forceBoss11 = 'threw:' + String(e && e.message || e); }
  // Land in a (20%, 35%] window rather than firing until hp crosses 30%: a single high-damage hit (rocket)
  // can overshoot straight past 30% to 0 (killing the boss outright, which makes forceAttack refuse for an
  // unrelated reason — "already broken" — not the 3rd-phase laser logic this test means to exercise). Pistol's
  // damage is known, small and precise, so the exact hit count needed is computed instead of polled for.
  await api.setWeapon(page, 'pistol');
  const W11 = await weaponTable(page);
  const bossMax11 = (await api.hpOf(page, '#boss')).max;
  const hp0_11 = (await api.hpOf(page, '#boss')).hp;
  const target11 = 0.275 * bossMax11;   // the middle of (20%, 35%]
  const need11 = hp0_11 > target11 ? Math.round((hp0_11 - target11) / W11.dmg('pistol')) : 0;
  for (let i = 0; i < need11; i++) {
    const bo11 = await api.rect(page, '#boss');
    await api.smashAt(page, bo11.left + 6, bo11.top + 6);
    await poll(async () => (await api.hpOf(page, '#boss')).hp < hp0_11 - i * W11.dmg('pistol'), 400, 20);
  }
  const bossHp11 = await api.hpOf(page, '#boss');
  await api.setWeapon(page, 'hammer');
  const tier11 = await force('#boss', 'forceAttack');
  const beamSeen11 = await poll(() => api.has(page, '.crs-beam'), 800);
  check('A.v2 7.11: boss weakened to ~20–35% hp (3rd stage), still alive, regains the laser sweep — debug.forceAttack(#boss) → "laser" or a .crs-beam appears (debug.forceBoss result recorded, see notes)', bossHp11.hp > 0 && bossHp11.hp <= 0.351 * bossHp11.max && (tier11 === 'laser' || beamSeen11 === true), { forceBoss11, bossHp11, tier11, beamSeen11 });
  await sleep(1700);

  // ---- (12) Escape with avatar + lock + repair all live → fully traceless (§7.12) ----
  await resetScene(400, 400);
  await api.setWeapon(page, 'hammer');
  const sc12 = await api.rect(page, '#small-card');
  await clickUntilBroken(page, '#small-card', sc12.cx, sc12.cy, 3);
  await force('#figure', 'forceAttack');
  await force('#figure', 'forceLock');
  await force('#figure', 'forceRepair');
  await sleep(300);
  const liveBefore12 = { avatar: await api.count(page, '.crs-avatar'), lock: await api.count(page, '.crs-lock'), repair: await api.count(page, '.crs-repair') };
  check('A.v2 7.12: avatar, lock-on and repair beam are all present right before Escape', liveBefore12.avatar >= 1 && liveBefore12.lock >= 1 && liveBefore12.repair >= 1, liveBefore12);
  await page.keyboard.press('Escape');
  const inactive12v2 = await poll(async () => !(await api.active(page)), 1500, 20);
  const nodes12v2 = await api.count(page, '[data-crs]');
  const pend12v2 = await api.pending(page);
  await settleRaf(page);
  const raf12v2 = await api.pendingRaf(page);
  check('A.v2 7.12: Escape with avatar/lock/repair all live → inactive, zero [data-crs] nodes, zero timers, zero animation frames', inactive12v2 === true && nodes12v2 === 0 && pend12v2 === 0 && raf12v2 === 0, { inactive12v2, nodes12v2, pend12v2, raf12v2 });
  const rOn12v2 = await page.evaluate(contentJs);
  check('A.v2 7.12: content.js reactivates cleanly afterwards', rOn12v2 === 'on', rOn12v2);
  await api.debug(page, { noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true, noRepair: true });
  await api.restore(page);
  await sleep(80);

  // ---- (13) rampage mode has none of the combat-v2 UI; WASD reaches page inputs (§7.13) ----
  await setCombatMode('rampage');
  await sleep(200);
  const offNodes13 = { avatar: await api.count(page, '.crs-avatar'), lock: await api.count(page, '.crs-lock'), repair: await api.count(page, '.crs-repair'), progress: await api.count(page, '.crs-progress') };
  check('A.v2 7.13: rampage mode → zero .crs-avatar / .crs-lock / .crs-repair / .crs-progress nodes', Object.values(offNodes13).every((n) => n === 0), offNodes13);
  await page.evaluate(() => { const i = document.getElementById('text-input'); i.value = ''; i.focus(); });
  await page.keyboard.type('wasd');
  const typed13 = await page.evaluate(() => document.getElementById('text-input').value);
  check('A.v2 7.13: with a page input focused, WASD still types normally (not captured as avatar movement) in rampage mode', typed13 === 'wasd', typed13);
  await page.evaluate(() => { const i = document.getElementById('text-input'); i.blur(); i.value = '안녕하세요 화면부수기 테스트 입력값'; });

  // ---- (14) reduced motion: no rotor jitter / dash afterimages, lock-on snaps in discrete steps (§7.14) ----
  // The rotor's wobble animation is only ever (re)started when the avatar is (re)built (avatarWobble() checks
  // reducedMotion() once, at that point) — so the media feature must be flipped BEFORE the avatar exists, same
  // as a real user who already has the OS setting on, not toggled under an avatar that is already spinning.
  await setCombatMode('rampage');
  await sleep(150);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await sleep(100);
  await setCombatMode('survival');
  await sleep(200);
  const rotorAnims14 = await page.evaluate(() => { const a = document.querySelector('.crs-avatar'); if (!a) return -1; let n = 0; for (const el of a.querySelectorAll('*')) n += el.getAnimations ? el.getAnimations().length : 0; return n; });
  check('A.v2 7.14: prefers-reduced-motion → no running Web Animations inside .crs-avatar (rotor jitter stopped)', rotorAnims14 === 0, rotorAnims14);
  await page.evaluate(() => { window.__crashScreen.debug.setPlayerHp(100); });
  await debugCall('setAvatarPos', 400, 400);
  const ghostsBefore14 = await api.count(page, '.crs-avatar');
  await debugCall('dashReady');
  await page.keyboard.press('Space');
  await sleep(250);
  const ghostsAfter14 = await api.count(page, '.crs-avatar');
  check('A.v2 7.14: reduced motion leaves no dash afterimage copies (still exactly one .crs-avatar node — assumes afterimages would otherwise share this class, see notes)', ghostsBefore14 === 1 && ghostsAfter14 === 1, { ghostsBefore14, ghostsAfter14 });
  await api.rect(page, '#figure');   // §7.13 focused a form input further down the page, auto-scrolling it into view
  await force('#figure', 'forceLock');
  const snapSize14 = async (ms) => { await sleep(ms); return page.evaluate(() => { const n = document.querySelector('.crs-lock'); if (!n) return null; const r = n.getBoundingClientRect(); return Math.round((r.width + r.height) / 2); }); };
  const snapA1_14 = await snapSize14(300);
  const snapA2_14 = await snapSize14(400);   // cumulative 0.7 s — still inside the warning stage
  const snapB1_14 = await snapSize14(700);   // cumulative 1.4 s — into the shrink stage
  check('A.v2 7.14: under reduced motion the lock-on bracket snaps between discrete sizes instead of animating continuously (two samples inside the same stage read identical; a later stage differs)', snapA1_14 != null && snapA1_14 === snapA2_14 && snapB1_14 != null && snapB1_14 !== snapA1_14, { snapA1_14, snapA2_14, snapB1_14 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await sleep(1700);

  // =======================================================================================
  // §9.4 — debris auto-despawn (SPEC-combat-v2 §9)
  // =======================================================================================
  await setCombatMode('rampage');
  await api.debug(page, { noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true });
  await api.restore(page);
  await sleep(80);

  // ---- (1) default debrisLifeMs (6000): pieces vanish ~6 s after resting; the original stays broken + hidden (§9.4.1) ----
  // #small-card (2 hits, a handful of pieces) rather than #big-card (29+ pieces): fewer fragments settle in a
  // single clean pass, instead of occasionally nudging each other back out of "resting" as late arrivals land,
  // which — since each piece's own debrisLifeMs clock only starts once IT individually rests — can otherwise
  // push the group's last piece's own expiry well past a window sized for one clean settle.
  await api.setWeapon(page, 'hammer');
  const sc941 = await api.rect(page, '#small-card');
  const broke941 = await smashUntil(page, () => api.broken(page, '#small-card'), sc941.cx, sc941.cy, 4);
  const debrisLifeAt941 = (await api.stats(page)).debrisLifeMs;
  check('A.v2 9.4.1: #small-card actually broke (smashUntil succeeded)', broke941 > 0, { broke941, debrisLifeAt941, hp: await api.hpOf(page, '#small-card') });
  const restedAt941 = await poll(async () => {
    const s = await api.stats(page);
    return (s.pieceCount > 0 && s.pieces.every((p) => p.resting)) ? Date.now() : null;
  }, 4000, 60);
  check('A.v2 9.4.1: #small-card produces resting pieces', !!restedAt941 && (await api.stats(page)).pieceCount > 0, restedAt941);
  const stillBrokenMidway941 = await api.broken(page, '#small-card');
  const stillHiddenMidway941 = await api.visibility(page, '#small-card');
  // ceiling padded well past 6000 (debrisLifeMs) + 400 (±jitter) + 500 (fade): a loaded suite run can lose a
  // few hundred ms of wall-clock margin to CDP round trips between polls.
  const gone941 = await poll(async () => (await api.count(page, '.crs-piece')) === 0 && (await api.count(page, '.crs-word')) === 0, 12000, 100);
  const elapsed941 = restedAt941 ? Date.now() - restedAt941 : null;
  check('A.v2 9.4.1: from the resting moment, all .crs-piece/.crs-word are gone within 6 s – 12 s (default debrisLifeMs 6000 + fade/jitter)', gone941 === true && elapsed941 != null && elapsed941 >= 5800 && elapsed941 <= 12000, { elapsed941, debrisLifeAt941 });
  check('A.v2 9.4.1: the original stayed data-crs-broken and hidden the whole time the pieces were alive', stillBrokenMidway941 === true && stillHiddenMidway941 === 'hidden', { stillBrokenMidway941, stillHiddenMidway941 });

  // ---- (2) restore() after the pieces are already gone still revives the original (§9.4.2) ----
  check('A.v2 9.4.2: #small-card is still marked broken once its pieces have despawned', await api.broken(page, '#small-card'));
  await api.restore(page);
  await sleep(80);
  check('A.v2 9.4.2: restore() after pieces have despawned brings the original back (not broken, visible)', !(await api.broken(page, '#small-card')) && (await api.visibility(page, '#small-card')) !== 'hidden', { broken: await api.broken(page, '#small-card'), vis: await api.visibility(page, '#small-card') });

  // ---- (3) debrisLifeMs = 0 → unlimited lifetime (§9.4.3) ----
  await page.evaluate(() => { window.__crsStore.crsDebrisLifeMs = 0; });
  const off943 = await page.evaluate(contentJs);
  const on943 = await page.evaluate(contentJs);
  check('A.v2 9.4.3: toggled off/on after setting crsDebrisLifeMs = 0 in storage so loadPrefs() re-reads it', off943 === 'off' && on943 === 'on', { off943, on943 });
  await api.debug(page, { noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true });
  await api.restore(page);
  await sleep(80);
  await api.setWeapon(page, 'hammer');
  const bc943 = await api.rect(page, '#big-card');
  await smashUntil(page, () => api.broken(page, '#big-card'), bc943.cx, bc943.cy, 6);
  await poll(async () => { const s = await api.stats(page); return (s.pieceCount > 0 && s.pieces.every((p) => p.resting)) ? s : null; }, 4000, 60);
  const countAt0_943 = await api.count(page, '.crs-piece');
  await sleep(10000);
  const countAfter10s_943 = await api.count(page, '.crs-piece');
  check('A.v2 9.4.3: debrisLifeMs = 0 → the piece count does not shrink over the next 10 s (unlimited lifetime)', countAt0_943 > 0 && countAfter10s_943 >= countAt0_943, { countAt0_943, countAfter10s_943 });
  await page.evaluate(() => { window.__crsStore.crsDebrisLifeMs = 6000; });
  await page.evaluate(contentJs);
  await page.evaluate(contentJs);
  await api.debug(page, { noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true });
  await api.restore(page);
  await sleep(80);

  // ---- (4) a piece resting atop another re-falls once the piece beneath it despawns (§9.4.4) ----
  // Two things made the first cut of this check flaky, both measurement, neither product:
  //   * it scanned `.crs-piece` only, and the #stack blocks are TEXT — most of their debris is `.crs-word`
  //     (§9.1 gives word chips the same lifetime), so it was reading three big shards and calling that a pile;
  //   * it compared getBoundingClientRect()s, and restPiece() snaps every chip to a random ±12° tilt, so the
  //     DOM box is the axis-aligned hull of a rotated rectangle — taller than the chip, which pushed real
  //     pairs outside the gap tolerance at random.
  // debug.pieceBoxes() hands back the geometry evictPieces() itself wakes from (p.ox/p.x/p.bb) plus a stable
  // per-piece id, so the pair is found with the product's own support rule and ONE piece is followed across
  // the eviction by id rather than by a DOM index that shifts the moment a node is removed.
  // debug.expirePiece() retires just the supporting piece: at the default 6 s lifetime a whole freshly-rested
  // pile expires inside one sweep, which would take the piece above along with the one beneath it.
  await api.setWeapon(page, 'hammer');
  const st1_944 = await api.rect(page, '#stack-1');
  const sx944 = st1_944.cx;
  await clickUntilBroken(page, '#stack-1', sx944, st1_944.cy);
  await poll(async () => { const s = await api.stats(page); return (Array.isArray(s.pieces) && s.pieces.length > 0 && s.pieces.every((p) => p.resting)) ? s : null; }, 4000, 80);
  const st2_944 = await api.rectNoScroll(page, '#stack-2');
  const st3_944 = await api.rectNoScroll(page, '#stack-3');
  await clickUntilBroken(page, '#stack-2', sx944, st2_944.cy);
  await clickUntilBroken(page, '#stack-3', sx944, st3_944.cy);
  await poll(async () => { const s = await api.stats(page); return (Array.isArray(s.pieces) && s.pieces.length > 0 && s.pieces.every((p) => p.resting)) ? s : null; }, 4000, 80);
  const pieceBoxes944 = () => page.evaluate(() => {
    const d = window.__crashScreen.debug;
    return (d && typeof d.pieceBoxes === 'function') ? d.pieceBoxes() : null;
  });
  // the same relation evictPieces() uses to decide what an eviction knocks loose: ≥ 40 % horizontal overlap
  // with the supporting piece, and a bottom edge at or above that piece's top.
  const findPair944 = (boxes) => {
    if (!Array.isArray(boxes)) return null;
    for (const lower of boxes) {
      if (!lower.resting) continue;
      for (const upper of boxes) {
        if (upper === lower || !upper.resting) continue;
        const ov = Math.min(lower.r, upper.r) - Math.max(lower.l, upper.l);
        if (ov < 0.4 * Math.min(lower.r - lower.l, upper.r - upper.l)) continue;
        if (upper.bottom <= lower.top + 1) return { lower: lower.pid, upper: upper.pid, upperTop: upper.top };
      }
    }
    return null;
  };
  let pairInfo944 = null;
  for (let i = 0; i < 4 && !pairInfo944; i++) { pairInfo944 = findPair944(await pieceBoxes944()); if (!pairInfo944) await sleep(250); }
  check('A.v2 9.4.4: found a vertically-stacked resting pair among the #stack debris to test re-falling', !!pairInfo944, pairInfo944 || { boxes: (await pieceBoxes944() || []).length });
  if (pairInfo944) {
    const expired944 = await page.evaluate((pid) => window.__crashScreen.debug.expirePiece(pid), pairInfo944.lower);
    const rose944 = await poll(async () => {
      const boxes = await pieceBoxes944();
      const up = Array.isArray(boxes) ? boxes.find((b) => b.pid === pairInfo944.upper) : null;
      if (!up) return null;
      return (up.top - pairInfo944.upperTop > 3) ? up.top : null;
    }, 6000, 100);
    const lowerGone944 = await poll(async () => {
      const boxes = await pieceBoxes944();
      return (Array.isArray(boxes) && !boxes.some((b) => b.pid === pairInfo944.lower)) ? true : null;
    }, 2000, 80);
    check('A.v2 9.4.4: a piece resting on top of another re-falls once the piece underneath it despawns', expired944 === pairInfo944.lower && lowerGone944 === true && !!rose944, { pair: pairInfo944, expired944, lowerGone944, after: rose944 });
  }

  // ---- (5) in-flight pieces do not count toward the debris lifetime (§9.4.5) ----
  await api.restore(page);
  await sleep(80);
  await api.setWeapon(page, 'bomb');
  const spot945 = await api.rect(page, '#bomb-spot');
  await api.smashAt(page, spot945.cx, spot945.cy);
  await sleep(200);
  const countJustAfter945 = await api.count(page, '.crs-piece');
  const flightCheck945 = await poll(async () => {
    const s = await api.stats(page);
    return (Array.isArray(s.pieces) && s.pieces.some((p) => p.resting === false)) ? true : null;
  }, 6800, 100);
  const countAt7s945 = await api.count(page, '.crs-piece');
  check('A.v2 9.4.5: 7 s after a bomb blast, any piece still in flight (resting === false) has not been removed by the debris timer', countJustAfter945 > 0 && (flightCheck945 !== true || countAt7s945 > 0), { countJustAfter945, stillFlying7s: flightCheck945, countAt7s945 });
  await sleep(1000);
  await api.restore(page);
  await sleep(80);
  await api.setWeapon(page, 'hammer');

  // ---- (6) traceless while despawn fade animations are in flight (§9.4.6) ----
  const bc946 = await api.rect(page, '#big-card');
  await smashUntil(page, () => api.broken(page, '#big-card'), bc946.cx, bc946.cy, 6);
  const restedAt946 = await poll(async () => { const s = await api.stats(page); return (s.pieceCount > 0 && s.pieces.every((p) => p.resting)) ? Date.now() : null; }, 4000, 60);
  await sleep(Math.max(0, (restedAt946 ? 6200 - (Date.now() - restedAt946) : 6200)));   // land inside the ~500 ms fade window
  const fadingSeen946 = await api.count(page, '.crs-fading');
  await page.keyboard.press('Escape');
  const inactive946 = await poll(async () => !(await api.active(page)), 1500, 20);
  const nodes946 = await api.count(page, '[data-crs]');
  const pend946 = await api.pending(page);
  await settleRaf(page);
  const raf946 = await api.pendingRaf(page);
  check('A.v2 9.4.6: Escape while debris fade-out animations are in flight still leaves zero [data-crs] nodes, timers and animation frames', inactive946 === true && nodes946 === 0 && pend946 === 0 && raf946 === 0, { fadingSeenBefore: fadingSeen946, inactive946, nodes946, pend946, raf946 });
  const rOn946 = await page.evaluate(contentJs);
  check('A.v2 9.4.6: content.js reactivates cleanly afterwards', rOn946 === 'on', rOn946);
  await api.debug(page, { noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true, noRepair: true });
  await api.restore(page);
  await sleep(80);

  // =======================================================================================
  // §10.6 — depth-of-stack affects combat (SPEC-combat-v2 §10)
  // =======================================================================================
  await setCombatMode('survival');
  await sleep(200);
  await resetScene(400, 400);

  // ---- (1) a front card over a mid-or-deeper card (§10.6.1) ----
  await scrollToDepthLab();
  const tierFront1_106 = await page.evaluate((s) => window.__crashScreen.hpOf(document.querySelector(s)).tier, '#depth-front');
  const tierMid1_106 = await page.evaluate((s) => window.__crashScreen.hpOf(document.querySelector(s)).tier, '#depth-mid');
  check('A.v2 10.6.1: the topmost of two overlapping cards reads tier "front"; the one underneath reads "mid" or deeper', tierFront1_106 === 'front' && (tierMid1_106 === 'mid' || tierMid1_106 === 'back'), { tierFront1_106, tierMid1_106 });

  // ---- (2) a sticky header scrolled over content still measures depth 0 / tier front (§10.6.2) ----
  await page.evaluate(() => window.scrollTo(0, 400));
  await sleep(150);
  const stickyInfo2_106 = await page.evaluate(() => { const r = window.__crashScreen.hpOf(document.querySelector('#site-header')); return { depth: r.depth, tier: r.tier }; });
  check('A.v2 10.6.2: a position:sticky header scrolled over page content → depth === 0 and tier === "front" regardless of what is under it', !!stickyInfo2_106 && stickyInfo2_106.depth === 0 && stickyInfo2_106.tier === 'front', stickyInfo2_106);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(100);

  // ---- (3) a child element's own depth is not inflated by its ancestor (§10.6.3) ----
  await scrollToDepthLab();
  const depthMidParent3_106 = await force('#depth-mid', 'depthOf');
  const depthMidChild3_106 = await force('#depth-mid-child', 'depthOf');
  check('A.v2 10.6.3: a child\'s depthOf() equals its parent\'s (ancestor/descendant exclusion keeps the parent from counting as "in front of" its own child)', depthMidParent3_106 != null && depthMidChild3_106 === depthMidParent3_106, { depthMidParent3_106, depthMidChild3_106 });

  // ---- (4) an occluded element cannot be hit until its occluder is destroyed (§10.6.4) ----
  await api.restore(page);
  await sleep(80);
  const overlapPt4_106 = await api.rect(page, '#depth-front');
  const frontHp4a_106 = await api.hpOf(page, '#depth-front');
  const midHp4a_106 = await api.hpOf(page, '#depth-mid');
  await api.setWeapon(page, 'hammer');
  await api.smashAt(page, overlapPt4_106.cx, overlapPt4_106.cy);
  const frontHp4b_106 = await api.hpOf(page, '#depth-front');
  const midHp4b_106 = await api.hpOf(page, '#depth-mid');
  check('A.v2 10.6.4: a hit at the overlap point damages only the occluder (#depth-front); #depth-mid underneath is untouched', frontHp4b_106.hp < frontHp4a_106.hp && midHp4b_106.hp === midHp4a_106.hp, { front: [frontHp4a_106, frontHp4b_106], mid: [midHp4a_106, midHp4b_106] });
  await smashUntil(page, () => api.broken(page, '#depth-front'), overlapPt4_106.cx, overlapPt4_106.cy, 6);
  const midHp4c_106 = await api.hpOf(page, '#depth-mid');
  await api.smashAt(page, overlapPt4_106.cx, overlapPt4_106.cy);
  const midHp4d_106 = await api.hpOf(page, '#depth-mid');
  check('A.v2 10.6.4: once #depth-front is broken, the same point now reaches #depth-mid underneath', midHp4d_106.hp < midHp4c_106.hp, { midHp4c_106, midHp4d_106 });
  await api.restore(page);
  await sleep(80);

  // ---- (5) sniper pierce vs. pistol no-pierce through the overlap (§10.6.5) ----
  // depth-front/-mid are sized for the T1 hostile window (~94 hp generic) — too little to tell "100 %" apart
  // from "60 % of 200", since either one dies in a single hit and the dealt amount just clamps at its own hp.
  // depth-tank-front/-back is a second, much larger overlapping pair that exists solely so the two damage
  // AMOUNTS stay comparable without either side's hp cap getting in the way.
  const overlapPt5_106 = await api.rect(page, '#depth-tank-front');
  await api.setWeapon(page, 'sniper');
  const frontHp5a_106 = await api.hpOf(page, '#depth-tank-front');
  const midHp5a_106 = await api.hpOf(page, '#depth-tank-back');
  await api.smashAt(page, overlapPt5_106.cx, overlapPt5_106.cy);
  const frontHp5b_106 = await api.hpOf(page, '#depth-tank-front');
  const midHp5b_106 = await api.hpOf(page, '#depth-tank-back');
  const frontDmg5_106 = frontHp5a_106.hp - frontHp5b_106.hp;
  const midDmg5_106 = midHp5a_106.hp - midHp5b_106.hp;
  const sniperDmg5_106 = DMG14('sniper');
  const expectedMid5_106 = Math.round(sniperDmg5_106 * 0.6);
  check('A.v2 10.6.5: a sniper shot through the overlap deals full damage to the front card and ≈ 60% to the one behind it (pierce = 2)', near(frontDmg5_106, sniperDmg5_106, 1) && midDmg5_106 > 0 && near(midDmg5_106, expectedMid5_106, Math.max(2, Math.round(sniperDmg5_106 * 0.1))), { frontDmg5_106, midDmg5_106, sniperDmg5_106, expectedMid5_106, frontHp5a_106, midHp5a_106 });
  await api.restore(page);
  await sleep(80);
  await api.setWeapon(page, 'pistol');
  const frontHp5c_106 = await api.hpOf(page, '#depth-tank-front');
  const midHp5c_106 = await api.hpOf(page, '#depth-tank-back');
  await api.smashAt(page, overlapPt5_106.cx, overlapPt5_106.cy);
  const frontHp5d_106 = await api.hpOf(page, '#depth-tank-front');
  const midHp5d_106 = await api.hpOf(page, '#depth-tank-back');
  check('A.v2 10.6.5: the same shot with a pistol (pierce = 0) hits only the front card; the one behind takes zero damage', frontHp5d_106.hp < frontHp5c_106.hp && midHp5d_106.hp === midHp5c_106.hp, { front: [frontHp5c_106, frontHp5d_106], mid: [midHp5c_106, midHp5d_106] });
  await api.restore(page);
  await sleep(80);

  // ---- (6) an explosive ignores stacking depth entirely (§10.6.6) ----
  await api.setWeapon(page, 'rocket');
  const overlapPt6_106 = await api.rect(page, '#depth-back');
  const backHp6a_106 = await api.hpOf(page, '#depth-back');
  await api.smashAt(page, overlapPt6_106.cx + 4, overlapPt6_106.cy + 4);
  // the explosion has its own brief travel/detonation animation (same as every other AoE hit elsewhere in this
  // suite) — reading hp immediately would just catch the "nothing landed yet" instant.
  const backHp6b_106 = await poll(async () => { const h = await api.hpOf(page, '#depth-back'); return h.hp < backHp6a_106.hp ? h : null; }, 1500, 40) || await api.hpOf(page, '#depth-back');
  check('A.v2 10.6.6: a rocket blast damages the fully-occluded #depth-back (5 layers above it) regardless of depth', backHp6b_106.hp < backHp6a_106.hp, { backHp6a_106, backHp6b_106 });
  await api.restore(page);
  await sleep(80);
  await api.setWeapon(page, 'hammer');

  // ---- (7) a "back" hostile never attacks, and repairs faster than a "mid" one (§10.6.7) ----
  await resetScene(400, 400);
  await scrollToDepthLab();
  const backTier7_106 = await page.evaluate((s) => window.__crashScreen.hpOf(document.querySelector(s)).tier, '#depth-back');
  const attackRet7_106 = await force('#depth-back', 'forceAttack');
  const hostileSeen7_106 = await poll(() => api.has(page, '.crs-hostile'), 500);
  check('A.v2 10.6.7: #depth-back measures tier "back" and debug.forceAttack on it returns null (no attack scheduler for back-tier hostiles)', backTier7_106 === 'back' && attackRet7_106 === null && hostileSeen7_106 === true, { backTier7_106, attackRet7_106, hostileSeen7_106 });
  await api.restore(page);
  await sleep(80);
  await api.debug(page, { noRepair: false });
  // small-card is up near the top of the page — over 600 px from the depth-lab fixture, so it is never a
  // candidate for THESE hostiles' repair (§3.1 step 1 skips the turn with nothing in range). depth-fodder sits
  // right next to depth-lab instead.
  let fodder7_106 = await api.rect(page, '#depth-fodder');
  await clickUntilBroken(page, '#depth-fodder', fodder7_106.cx, fodder7_106.cy, 4);
  await scrollToDepthLab();
  await force('#depth-back', 'forceAttack');
  const backBeamSeen7_106 = await poll(() => api.has(page, '.crs-repair'), 4300, 80);
  check('A.v2 10.6.7: the back-tier hostile starts its own natural repair beam well before the mid-tier ~6 s baseline (×0.6 ≈ 3.6 s)', backBeamSeen7_106 === true, backBeamSeen7_106);
  await api.restore(page);
  await sleep(80);
  fodder7_106 = await api.rect(page, '#depth-fodder');
  await clickUntilBroken(page, '#depth-fodder', fodder7_106.cx, fodder7_106.cy, 4);
  await scrollToDepthLab();
  await force('#depth-mid', 'forceAttack');
  const midBeamEarly7_106 = await poll(() => api.has(page, '.crs-repair'), 4300, 80);
  check('A.v2 10.6.7: ...while the mid-tier hostile has NOT started its repair beam yet at that same 4.3 s mark', midBeamEarly7_106 === false, midBeamEarly7_106);
  const midBeamLater7_106 = await poll(() => api.has(page, '.crs-repair'), 2600, 80);
  check('A.v2 10.6.7: ...but the mid-tier hostile does start it by the ~6 s baseline', midBeamLater7_106 === true, midBeamLater7_106);
  await api.debug(page, { noRepair: true });
  await api.restore(page);
  await sleep(80);

  // ---- (8) a "front" hostile has less max HP than a same-area "mid" one (§10.6.8) ----
  await scrollToDepthLab();
  await force('#depth-front', 'forceAttack');
  await force('#depth-mid', 'forceAttack');
  const frontHp8_106 = await page.evaluate((s) => window.__crashScreen.hpOf(document.querySelector(s)), '#depth-front');
  const midHp8_106 = await page.evaluate((s) => window.__crashScreen.hpOf(document.querySelector(s)), '#depth-mid');
  check('A.v2 10.6.8: a "front" hostile\'s max HP is ≈ 0.8× a same-area "mid" hostile\'s (±2)', frontHp8_106.tier === 'front' && midHp8_106.tier === 'mid' && near(frontHp8_106.max, midHp8_106.max * 0.8, 2), { frontHp8_106, midHp8_106 });
  await api.restore(page);
  await sleep(80);

  // ---- (9) the hostile aura label carries a depth marker: ▲ / ▲▲ / ▲▲▲ (§10.6.9) ----
  const markerFor106 = async (sel) => {
    await api.restore(page);
    await sleep(80);
    await scrollToDepthLab();
    await force(sel, 'forceAttack');
    await sleep(100);
    return page.evaluate(() => { const a = document.querySelector('.crs-hostile'); return a ? (a.textContent || '').trim() : null; });
  };
  const labelFront9_106 = await markerFor106('#depth-front');
  const labelMid9_106 = await markerFor106('#depth-mid');
  const labelBack9_106 = await markerFor106('#depth-back');
  check('A.v2 10.6.9: the hostile aura label shows ▲ for front, ▲▲ for mid and ▲▲▲ for back', /▲(?!▲)/.test(labelFront9_106 || '') && /▲▲(?!▲)/.test(labelMid9_106 || '') && /▲▲▲/.test(labelBack9_106 || ''), { labelFront9_106, labelMid9_106, labelBack9_106 });
  await api.restore(page);
  await sleep(80);

  // ---- (10) an occluded hostile's lock-on frame is dashed and labelled 가려짐 / 관통 가능 (§10.6.10) ----
  // §2.1/§10.4: the "covered" tag is only ever written in quickdraw (modeLockOnEnemy() gates it) — in survival
  // the frame sits over the drone instead and lockCoverTag() returns immediately, leaving it blank. Dashed
  // styling toggles the `crs-lock-covered` class on the frame itself; the text lives on its `.crs-lock-tag` child.
  await setCombatMode('quickdraw');
  await sleep(200);
  await resetScene(400, 400);
  await scrollToDepthLab();
  await api.setWeapon(page, 'hammer');
  const lockBackId10_106 = await force('#depth-back', 'forceLock');
  await sleep(150);
  const lockInfo10a_106 = await page.evaluate(() => {
    const n = document.querySelector('.crs-lock');
    if (!n) return null;
    const tag = n.querySelector('.crs-lock-tag');
    return { covered: n.classList.contains('crs-lock-covered'), text: tag ? (tag.textContent || '').trim() : '' };
  });
  check('A.v2 10.6.10: a fully-occluded hostile\'s lock-on frame is drawn dashed (.crs-lock-covered) and labelled 가려짐', !!lockInfo10a_106 && !!lockBackId10_106 && lockInfo10a_106.covered === true && /가려짐/.test(lockInfo10a_106.text), { lockBackId10_106, lockInfo10a_106 });
  await api.setWeapon(page, 'sniper');
  await sleep(250);
  const lockInfo10b_106 = await page.evaluate(() => { const tag = document.querySelector('.crs-lock .crs-lock-tag'); return tag ? (tag.textContent || '').trim() : null; });
  check('A.v2 10.6.10: switching to a piercing weapon (sniper) relabels it 관통 가능 instead of 가려짐', !!lockInfo10b_106 && /관통 가능/.test(lockInfo10b_106) && !/가려짐/.test(lockInfo10b_106), lockInfo10b_106);
  await api.setWeapon(page, 'hammer');
  await api.restore(page);
  await sleep(80);
  await setCombatMode('survival');
  await sleep(150);

  // ---- (11) §2.2 lock-frame aim assist: only where the frame actually sits ON the enemy ----
  // "락온 틀 안을 클릭하면 자식 요소가 아니라 그 적대 요소가 대상이 된다" — a shot inside the closing brackets
  // counts as a shot on the locked enemy, which is what makes "shoot the lock to break it" playable when the
  // brackets still stand 70 px clear of the enemy's own rect. §2.1 puts that frame on the ENEMY in quickdraw;
  // §2.3 puts it on the DRONE in survival, where the same rule would mean clicking near your own avatar damages
  // an enemy somewhere else entirely — survival gets shoot-or-dodge (§2.3) instead of this assist.
  await setCombatMode('quickdraw');
  await sleep(150);
  await resetScene(400, 400);
  await api.setWeapon(page, 'pistol');
  const lockAssistId = await force('#figure', 'forceLock');
  await sleep(150);
  const assistGeom = await page.evaluate(() => {
    const n = document.querySelector('.crs-lock'); const el = document.querySelector('#figure');
    if (!n || !el) return null;
    const lr = n.getBoundingClientRect(), er = el.getBoundingClientRect();
    return { lock: { left: lr.left, top: lr.top, right: lr.right, bottom: lr.bottom }, el: { left: er.left, top: er.top, right: er.right, bottom: er.bottom } };
  });
  // a point inside the brackets but clear of the enemy's own rect — the gap the assist exists to cover
  const assistPt = assistGeom ? { x: (assistGeom.el.left + assistGeom.el.right) / 2, y: (assistGeom.lock.top + assistGeom.el.top) / 2 } : null;
  const assistOutside = !!(assistGeom && assistPt && assistPt.y < assistGeom.el.top - 2 && assistPt.y > assistGeom.lock.top);
  const figAssistB = await api.hpOf(page, '#figure');
  if (assistPt) await api.smashAt(page, assistPt.x, assistPt.y);
  await sleep(120);
  const figAssistA = await api.hpOf(page, '#figure');
  check('A.v2 §2.2: in quickdraw a shot inside the lock brackets but outside the enemy rect still damages that enemy', !!lockAssistId && assistOutside === true && figAssistA.hp === figAssistB.hp - DMG14('pistol'), { lockAssistId, assistGeom, assistPt, before: figAssistB, after: figAssistA, dmg: DMG14('pistol') });

  await api.restore(page);
  await sleep(80);
  await setCombatMode('survival');
  await sleep(150);
  await resetScene(400, 400);
  await api.setWeapon(page, 'pistol');
  const lockDroneId = await force('#figure', 'forceLock');
  await sleep(150);
  // in survival the frame rides the drone, which resetScene parked at (400, 400) — well clear of #figure
  const droneFrame = await page.evaluate(() => {
    const n = document.querySelector('.crs-lock'); const el = document.querySelector('#figure');
    if (!n || !el) return null;
    const lr = n.getBoundingClientRect(), er = el.getBoundingClientRect();
    const clear = lr.right < er.left || lr.left > er.right || lr.bottom < er.top || lr.top > er.bottom;
    return { cx: lr.left + lr.width / 2, cy: lr.top + lr.height / 2, clear, lock: { left: lr.left, top: lr.top, width: lr.width, height: lr.height }, el: { left: er.left, top: er.top, width: er.width, height: er.height } };
  });
  const figDroneB = await api.hpOf(page, '#figure');
  if (droneFrame) await api.smashAt(page, droneFrame.cx, droneFrame.cy);
  await sleep(120);
  const figDroneA = await api.hpOf(page, '#figure');
  check('A.v2 §2.3: in survival the lock frame rides the drone, so a shot inside it does NOT reach the locked enemy across the page', !!lockDroneId && !!droneFrame && droneFrame.clear === true && figDroneA.hp === figDroneB.hp, { lockDroneId, droneFrame, before: figDroneB, after: figDroneA });
  await api.restore(page);
  await sleep(80);

  // ---- combat.png: SPEC-combat-v2 §8 wants the drone, its health ring, the lock-on brackets, a repair beam
  // and the destruction-ratio meter in ONE frame, and SPEC-readability §7 wants the player ring, an aim line
  // and the enlarged ammo/health panels. Survival is the only mode where all of that can coexist (§0.5: no
  // avatar outside survival), and the v1.3 frame keeps its own artifact as readability.png.
  // Staging notes, all of them timing:
  //   * the §3.2 meter runs on a 2 s clock, so the breaks have to land a refresh BEFORE the capture or the
  //     label still reads the pre-break number;
  //   * the lock-on is captured 1.6 s in — the §2.1 shrink stage, orange and steady. The warning stage is
  //     white at 70 % and barely reads; the imminent stage blinks on a 0.2 s cycle and may be caught dark;
  //   * the repair beam only lives 1.5 s (§3.1), so it is started inside that window, not before it.
  await setCombatMode('survival');
  await api.debug(page, { noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true, noRepair: true });
  await api.restore(page);
  await sleep(80);
  await page.evaluate(() => window.scrollTo(0, 0));
  await api.setWeapon(page, 'hammer');
  const scShot = await api.rect(page, '#small-card');
  await clickUntilBroken(page, '#small-card', scShot.cx, scShot.cy, 4);
  const bcShot = await api.rectNoScroll(page, '#big-card');
  await clickUntilBroken(page, '#big-card', bcShot.cx, bcShot.cy, 5);
  await api.rect(page, '#figure');
  await sleep(2300);
  await page.evaluate((x, y) => {
    const a = window.__crashScreen, d = a.debug;
    d.setPlayerHp(60);
    a.setWeapon('pistol');
    a.smashAt(2, 2); a.smashAt(2, 2); a.smashAt(2, 2);   // burn the magazine down so the ammo panel reads low
    d.setAvatarPos(x, y);
    d.forceLock(document.querySelector('#figure'));
  }, 470, 640);
  await sleep(1150);
  await force('#figure', 'forceRepair');
  await sleep(450);
  const shotNodes = await page.evaluate(() => {
    const hud = document.querySelector('crs-hud, .crs-hud-host');
    const sr = hud && hud.shadowRoot;
    const prog = sr && sr.querySelector('.crs-progress');
    const vis = (n) => { if (!n) return false; const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; };
    const modeOn = sr ? [...sr.querySelectorAll('[aria-pressed="true"]')].map((n) => (n.textContent || '').trim()) : [];
    const av = document.querySelector('.crs-avatar');
    const ring = document.querySelector('.crs-self');   // §1.1: the v1.3 conic-gradient ring, re-anchored to the drone
    const avR = av && av.getBoundingClientRect(), rgR = ring && ring.getBoundingClientRect();
    return {
      avatar: vis(document.querySelector('.crs-avatar-body')),   // .crs-avatar itself is a 0×0 anchor; the 34 px body is the drone
      ring: vis(ring),
      // §1.1 anchors the ring ON the drone: their centres must coincide, not merely both be on screen
      ringOnAvatar: !!(avR && rgR) && Math.abs((avR.left + avR.width / 2) - (rgR.left + rgR.width / 2)) <= 6 && Math.abs((avR.top + avR.height / 2) - (rgR.top + rgR.height / 2)) <= 6,
      lock: vis(document.querySelector('.crs-lock')),
      repair: vis(document.querySelector('.crs-repair')),
      meter: !!(prog && prog.classList.contains('on')) && vis(prog),
      meterText: prog ? (prog.textContent || '').trim() : null,
      modeControl: !!(sr && sr.querySelector('.modes')) && modeOn.length > 0,
      modeOn,
      aimline: vis(document.querySelector('.crs-aimline')),
      ammo: vis(sr && sr.querySelector('.crs-ammo')),
      health: vis(sr && sr.querySelector('.crs-player')),
    };
  });
  await page.screenshot({ path: path.join(OUT, 'combat.png') });
  info(`screenshot test/out/combat.png (${JSON.stringify(shotNodes)})`);
  check('A.v2 §8: combat.png frame carries the drone + its health ring, the lock-on brackets, a live repair beam, the destruction-ratio meter and the mode control all at once', shotNodes.avatar === true && shotNodes.ring === true && shotNodes.ringOnAvatar === true && shotNodes.lock === true && shotNodes.repair === true && shotNodes.meter === true && /%/.test(shotNodes.meterText || '') && shotNodes.modeControl === true, shotNodes);
  check('A.v2 §8 / readability §7: the same frame also keeps the aim line and the enlarged ammo + health panels on screen', shotNodes.aimline === true && shotNodes.ammo === true && shotNodes.health === true, shotNodes);
  await api.restore(page);
  await sleep(80);

  // ---- tidy up: back to the suite's baseline mode/weapon/debug flags ----
  await setCombatMode('rampage');
  await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: false, noRepair: false });
  await api.setWeapon(page, 'hammer');
  await api.restore(page);
  await sleep(100);
}

// ---------------------------------------------------------------------------
// Suite B — strict CSP + Trusted Types
// ---------------------------------------------------------------------------
async function suiteB(browser, origin, contentCss, contentJs) {
  console.log('\n=== Suite B: strict CSP + Trusted Types (/strict) ===');
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const log = hookPage(page);
  await installViolationCounter(page);
  const resp = await page.goto(`${origin}/strict`, { waitUntil: 'load' });
  check('B.route: /strict served with the CSP header', (resp.headers()['content-security-policy'] || '') === STRICT_CSP, resp.headers()['content-security-policy']);
  const styled = await page.evaluate(() => {
    const big = document.getElementById('big-card');
    const cs = getComputedStyle(big);
    return { w: big.getBoundingClientRect().width, radius: cs.borderRadius, btn: window.__btnClicks };
  });
  check('B.route: fixture fully styled under strict CSP (fixture.css applied, fixture.js ran)', styled.w >= 500 && styled.radius !== '0px' && styled.btn === 0, styled);
  const v0 = await violations(page);
  check('B.route: zero securitypolicyviolation events before injection', v0.length === 0, v0[0]);

  const client = await injectCss(page, contentCss);
  await page.evaluate(TIMER_LEDGER);
  await page.evaluate(chromeShim(EN_MESSAGES));   // English locale: the longer labels must fit the HUD (F9)
  const r1 = await page.evaluate(contentJs);
  check('B.inject: content.js returns "on" under strict CSP', r1 === 'on', r1);
  try { await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true }); } catch (_) { /* reported by A.inject */ }
  check('B.inject: active, canvas and HUD present', (await api.active(page)) && (await api.has(page, '.crs-canvas')) && (await page.evaluate(() => { const h = document.querySelector('crs-hud, .crs-hud-host'); return !!(h && h.shadowRoot); })));
  check('B.inject: HUD panel is styled (non-transparent background inside the shadow root)', await page.evaluate(() => {
    const h = document.querySelector('crs-hud, .crs-hud-host');
    if (!h || !h.shadowRoot) return false;
    return [...h.shadowRoot.querySelectorAll('*')].some((el) => { const b = getComputedStyle(el).backgroundColor; return b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent'; });
  }));
  const hudEn = await page.evaluate(() => {
    const h = document.querySelector('crs-hud, .crs-hud-host');
    if (!h || !h.shadowRoot) return null;
    const panel = h.shadowRoot.querySelector('.panel');
    const pr = panel.getBoundingClientRect();
    const btns = [...h.shadowRoot.querySelectorAll('button')];
    return {
      labels: btns.map((b) => `${b.textContent}|${b.title || b.getAttribute('aria-label') || ''}`),
      ids: [...h.shadowRoot.querySelectorAll('button[data-weapon]')].map((b) => b.getAttribute('data-weapon')),
      panelW: pr.width,
      overflow: btns.filter((b) => b.scrollWidth > b.clientWidth || b.getBoundingClientRect().right > pr.right + 0.5 || b.getBoundingClientRect().left < pr.left - 0.5).map((b) => b.textContent),
    };
  });
  check('B.hud: English labels served through chrome.i18n (button text or title: Hammer / Collapse / Sniper)', !!hudEn && hudEn.labels.some((l) => l.includes('Hammer')) && hudEn.labels.some((l) => l.includes('Collapse')) && hudEn.labels.some((l) => l.includes('Sniper')), hudEn && hudEn.labels);
  check('B.hud: 10 weapon buttons in the default loadout order', !!hudEn && hudEn.ids.join(',') === WEAPON_IDS.join(','), hudEn && hudEn.ids);
  check('B.hud: no HUD button overflows its box or the panel in English (panel 284–380 px)', !!hudEn && hudEn.overflow.length === 0 && hudEn.panelW >= 284 && hudEn.panelW <= 380, hudEn);

  // smash a few times with each weapon
  const sc = await api.rect(page, '#small-card');
  await page.mouse.click(sc.left + 12, sc.top + 12);
  const lp = await api.rect(page, '#long-para');
  await page.mouse.click(lp.cx, lp.cy);
  await poll(() => api.broken(page, '#long-para'), 1000);
  const words = await api.count(page, '.crs-word');
  check('B.hammer: paragraph shattered into word pieces', words >= 5, words);
  await api.setMode(page, 'bomb');
  const spot = await api.rect(page, '#bomb-spot');
  await page.mouse.click(spot.cx, spot.cy);
  await poll(async () => (await api.count(page, '#cluster .leaf[data-crs-broken]')) >= 2, 500);
  check('B.bomb: cluster leaves broken', (await api.count(page, '#cluster .leaf[data-crs-broken]')) >= 2);
  await api.setMode(page, 'gun');
  check('B.gun: setMode("gun") → pistol (alias)', (await api.weapon(page)) === 'pistol', await api.weapon(page));
  const ic = await api.rect(page, '#demo-img');
  const imgMax = (await api.hpOf(page, '#demo-img')).max;
  const nImg = hitsFor(imgMax, (await weaponTable(page)).dmg('pistol'));
  for (let k = 0; k < nImg; k++) {
    await page.mouse.click(ic.cx, ic.cy);
    await sleep(120);
  }
  check(`B.gun: image broken after ${nImg} pistol shots (max ${imgMax} / 25)`, await poll(() => api.broken(page, '#demo-img'), 1000));
  // v1.1 nodes whose CSSOM styling would be the first to trip style-src / Trusted Types: smg hold (numbers, tints,
  // chips), a sword slash (preview / streak), a rocket (streak, XL ring, fire-less AoE)
  const sB0 = await api.stats(page);
  await api.setWeapon(page, 'smg');
  const apB = await arenaPt(page);
  await holdAt(page, apB, 200);
  await api.setWeapon(page, 'sword');
  const bcB = await api.rect(page, '#big-card');
  const scB = await api.rectNoScroll(page, '#small-card');
  await page.mouse.move(bcB.left + 12, bcB.top + 12);
  await page.mouse.down();
  await page.mouse.move(scB.left + 12, scB.top + 12, { steps: 6 });
  await page.mouse.up();
  await sleep(300);   // let the slash jolt on #big-card (reactDamage, 260 ms) settle before measuring its rect
  await api.setWeapon(page, 'rocket');
  const bcB2 = await api.rect(page, '#big-card');
  await page.mouse.click(bcB2.left + 12, bcB2.top + 12);
  await sleep(250);
  const sB1 = await api.stats(page);
  check('B.weapons: smg hold, sword drag and rocket ran under strict CSP (shots ≥ 5, #big-card broken by the rocket)', sB1.shots - sB0.shots >= 5 && await poll(() => api.broken(page, '#big-card'), 600), { shots: [sB0.shots, sB1.shots] });
  // v1.2 nodes whose CSSOM styling would be the next to trip style-src / Trusted Types: the scope overlay plus the
  // 2× body transform, the sniper tracer, a hostile aura + orb, the player HUD and the KO overlay
  await api.restore(page);
  await sleep(80);
  await api.setWeapon(page, 'sniper');
  const boB = await api.rect(page, '#boss');
  await page.mouse.move(boB.cx, boB.cy);
  await api.scope(page, true);
  const scopedB = await poll(async () => (await api.stats(page)).scoped === true, 800, 20);
  const bodyBon = await api.bodyInline(page);
  await api.smashAt(page, boB.cx, boB.cy);
  await sleep(80);
  await api.scope(page, false);
  const bodyBoff = await api.bodyInline(page);
  check('B.scope: the scope overlay and the 2× body transform build under strict CSP and restore exactly', scopedB === true && /scale\(2\)/.test(bodyBon.transform) && bodyBoff.transform === '' && bodyBoff.transformOrigin === '' && !(await api.has(page, '.crs-scope')), { scopedB, on: bodyBon, off: bodyBoff });
  await api.setCombat(page, true);
  const fgB = await api.rect(page, '#figure');
  const farB = fgB.cx + 500 <= VIEWPORT.width - 10 ? fgB.cx + 500 : fgB.cx - 500;
  await api.setPlayerPos(page, farB, fgB.cy);
  const tierB = await api.forceAttack(page, '#figure');
  const auraB = await poll(async () => (await api.count(page, '.crs-hostile')) >= 1 && (await api.count(page, '.crs-orb')) >= 1, 1000, 20);
  const playerHudB = await api.hudQ(page, '.crs-player');
  await api.setPlayerPos(page, fgB.cx, fgB.cy);
  await api.setPlayerHp(page, 5);
  await api.forceAttack(page, '#figure');
  const koB = await poll(async () => { const k = await api.hudQ(page, '.crs-ko'); return !!(k && k.visible); }, 2500, 30);
  await page.keyboard.press('Enter');
  const koGoneB = await poll(async () => { const k = await api.hudQ(page, '.crs-ko'); return !k || !k.visible; }, 1200, 20);
  await api.setWeapon(page, 'hammer');
  check('B.combat: hostile aura, orb, player HUD and the KO overlay all build under strict CSP, and Enter restarts', tierB === 'shooter' && auraB === true && !!playerHudB && playerHudB.visible === true && koB === true && koGoneB === true, { tier: tierB, aura: auraB, playerHud: playerHudB && playerHudB.visible, ko: koB, koGone: koGoneB });
  await api.setMode(page, 'collapse');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await sleep(1200);
  check('B.collapse: broke several elements', (await api.stats(page)).broken >= 5, (await api.stats(page)).broken);
  await page.screenshot({ path: path.join(OUT, 'strict.png') });
  await api.restore(page);
  await sleep(100);
  check('B.restore: no debris, no [data-crs-broken]', (await api.count(page, '.crs-debris')) === 0 && (await api.count(page, '[data-crs-broken]')) === 0);
  await page.keyboard.press('Escape');
  check('B.exit: Escape → inactive, no [data-crs] nodes', await poll(async () => !(await api.active(page)) && (await api.count(page, '[data-crs]')) === 0, 1500));
  check('B.exit: zero live content-script timers after Escape (ledger)', (await api.pending(page)) === 0, await api.pending(page));
  await settleRaf(page);
  check('B.exit: zero live animation frames after Escape (RAF ledger)', (await api.pendingRaf(page)) === 0, await api.pendingRaf(page));

  const v = await violations(page);
  check('B.csp: zero securitypolicyviolation events', v.length === 0, v[0]);
  check('B.console: zero page errors', log.pageErrors.length === 0, log.pageErrors[0]);
  check('B.console: zero error-level console messages', log.consoleErrors.length === 0, log.consoleErrors[0]);
  check('B.stats: stats().lastError === null for the whole suite', (await api.stats(page)).lastError === null, (await api.stats(page)).lastError);
  try { await client.detach(); } catch (_) { /* ignore */ }
  await page.close();
}

// ---------------------------------------------------------------------------
// Suite C — real extension wiring
// ---------------------------------------------------------------------------
function prepareExtensionCopy() {
  const dst = path.join(OUT, 'ext');
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  for (const name of ['manifest.json', 'background.js', 'content.js', 'content.css', 'icons', '_locales']) {
    const src = path.join(ROOT, name);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(dst, name), { recursive: true });
  }
  const manifestPath = path.join(dst, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*'];   // ONLY in the test copy (activeTab needs a real gesture)
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dst;
}

async function suiteC(puppeteer, origin) {
  console.log('\n=== Suite C: real extension wiring (test/out/ext) ===');
  const ext = prepareExtensionCopy();
  const browser = await puppeteer.launch({
    headless: true,
    enableExtensions: true,
    args: BASE_ARGS.concat([`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]),
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    const log = hookPage(page);
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 10000 });
    const worker = await swTarget.worker();
    check('C.sw: service worker target found', !!worker);
    const reg = await worker.evaluate(() => ({
      onClicked: chrome.action.onClicked.hasListeners(),
      onMessage: chrome.runtime.onMessage.hasListeners(),
      onUpdated: chrome.tabs.onUpdated.hasListeners(),
    }));
    check('C.sw: action.onClicked / runtime.onMessage / tabs.onUpdated listeners registered', reg.onClicked && reg.onMessage && reg.onUpdated, reg);
    const extManifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
    check('C.manifest: commands._execute_action declared (keyboard shortcut → action.onClicked)', !!(extManifest.commands && extManifest.commands._execute_action), extManifest.commands);

    const tOnC = Date.now();
    const r1 = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
      if (!tab) return { id: null, res: 'no-tab' };
      return { id: tab.id, url: tab.url, res: await self.__crashScreenToggle(tab) };
    });
    check('C.toggle: __crashScreenToggle(tab) → "on"', r1.res === 'on', r1);
    const tabId = r1.id;
    check('C.page: .crs-canvas appears', await poll(() => api.has(page, '.crs-canvas'), 3000));
    const badgeOn = await poll(async () => {
      const b = await worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
      return b === 'ON' ? b : null;
    }, 2000, 50);
    check('C.badge: getBadgeText → "ON"', badgeOn === 'ON', badgeOn);
    check('C.hud: panel background not transparent', await poll(() => page.evaluate(() => {
      const h = document.querySelector('crs-hud, .crs-hud-host');
      if (!h || !h.shadowRoot) return false;
      return [...h.shadowRoot.querySelectorAll('*')].some((el) => { const b = getComputedStyle(el).backgroundColor; return b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent'; });
    }), 2000));

    // one real hammer click on a 25-hp cluster leaf (isolated world: DOM-only assertions)
    const LEAF = '#cluster .leaf:first-child';
    const leaf = await api.rect(page, LEAF);
    await page.mouse.click(leaf.cx, leaf.cy);
    check('C.smash: real pointer click → .crs-debris appears', await poll(async () => (await api.count(page, '.crs-debris')) >= 1, 2000));
    check('C.smash: cluster leaf has data-crs-broken', await api.broken(page, LEAF));
    await sleep(800);
    const graceC = await page.evaluate(() => ({ hostiles: document.querySelectorAll('.crs-hostile').length, orbs: document.querySelectorAll('.crs-orb').length }));
    check('C.grace: the DOM-only assertions and extension.png were taken inside the activation grace (no .crs-hostile / .crs-orb yet)', graceC.hostiles === 0 && graceC.orbs === 0, { ...graceC, msSinceToggleOn: Date.now() - tOnC });
    await page.screenshot({ path: path.join(OUT, 'extension.png') });

    // same-document navigations report tabs.onUpdated status 'loading' too — the badge must survive them
    await page.evaluate(() => { location.hash = 'crs-hash'; });
    await poll(() => worker.evaluate((id) => chrome.tabs.get(id).then((t) => t.status === 'complete' && /#crs-hash/.test(t.url || '')), tabId), 2000, 50);
    await sleep(300);
    const badgeHash = await worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
    check('C.badge: still "ON" after a hash change (onUpdated loading/complete) while active', badgeHash === 'ON' && (await api.has(page, '.crs-root')), { badge: badgeHash, root: await api.has(page, '.crs-root') });
    await page.evaluate(() => { history.pushState({}, '', '/spa-route'); });
    await poll(() => worker.evaluate((id) => chrome.tabs.get(id).then((t) => t.status === 'complete' && /spa-route/.test(t.url || '')), tabId), 2000, 50);
    await sleep(300);
    const badgePush = await worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
    check('C.badge: still "ON" after history.pushState while active', badgePush === 'ON', badgePush);
    await page.evaluate(() => { history.replaceState({}, '', '/'); });

    const r2 = await worker.evaluate(async (id) => {
      const [tab] = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
      return self.__crashScreenToggle(tab || { id });
    }, tabId);
    check('C.toggle: second toggle → "off"', r2 === 'off', r2);
    const badgeOff = await poll(async () => {
      const b = await worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
      return b === '' ? 'cleared' : null;
    }, 2000, 50);
    check('C.badge: getBadgeText → "" after off', badgeOff === 'cleared', badgeOff);
    check('C.page: no [data-crs] nodes after off', await poll(async () => (await api.count(page, '[data-crs]')) === 0, 2000));
    check('C.page: cluster leaf restored (no data-crs-broken, visible)', !(await api.broken(page, LEAF)) && (await api.visibility(page, LEAF)) === 'visible');

    const inj = await worker.evaluate(() => self.__crashScreenIsInjectable('chrome://extensions'));
    check('C.blocked: __crashScreenIsInjectable("chrome://extensions") === false', inj === false, inj);
    const blocked = await worker.evaluate(async (id) => self.__crashScreenToggle({ id, url: 'chrome://extensions' }), tabId);
    check('C.blocked: toggle({id, url:"chrome://extensions"}) → "blocked"', blocked === 'blocked', blocked);
    const flash = await poll(async () => ((await worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)) === '✕' ? '✕' : null), 1000, 50);
    check('C.blocked: badge flashes "✕"', flash === '✕', flash);
    const cleared = await poll(async () => ((await worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)) === '' ? 'cleared' : null), 2500, 50);
    check('C.blocked: "✕" badge cleared within ~1.5 s', cleared === 'cleared', cleared);
    const ping = await worker.evaluate(() => new Promise((res) => {
      try { chrome.runtime.sendMessage({ type: 'crash:ping' }, (r) => res(r)); } catch (e) { res(String(e)); }
    }));
    info(`crash:ping → ${JSON.stringify(ping)} (informational; the worker cannot message itself)`);
    check('C.console: zero page errors', log.pageErrors.length === 0, log.pageErrors[0]);
    check('C.console: zero error-level console messages', log.consoleErrors.length === 0, log.consoleErrors[0]);
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
(async () => {
  const guard = setTimeout(() => {
    console.log(`FAIL runtime budget exceeded (${Math.round(TIME_BUDGET_MS / 1000)} s)`);
    console.log(`SUMMARY: ${results.filter((r) => r.ok).length} passed, ${results.filter((r) => !r.ok).length + 1} failed (timeout)`);
    process.exit(1);
  }, TIME_BUDGET_MS + 20000);
  guard.unref();

  const found = resolvePuppeteer();
  if (!found) {
    console.error('FAIL puppeteer not found. Set PUPPETEER_PATH=/path/to/node_modules/puppeteer (or have it in ~/.npm/_npx/*/node_modules/puppeteer).');
    process.exit(2);
  }
  const { puppeteer } = found;
  console.log(`puppeteer: ${found.from}`);

  fs.mkdirSync(OUT, { recursive: true });
  const missing = ['content.js', 'content.css', 'background.js', 'manifest.json'].filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length) {
    check(`product files present (${missing.join(', ')} missing)`, false);
    console.log(`SUMMARY: 0 passed, 1 failed in ${elapsed()} s`);
    process.exit(1);
  }
  const contentCss = fs.readFileSync(path.join(ROOT, 'content.css'), 'utf8');
  const contentJs = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

  const { server, origin } = await startServer();
  console.log(`server: ${origin}`);
  let browser = null;
  try {
    browser = await puppeteer.launch({ headless: true, args: BASE_ARGS });
    if (WANT('A')) { try { await suiteA(browser, origin, contentCss, contentJs); } catch (e) { check('Suite A completed without exceptions', false, String(e && e.stack || e)); } }
    if (WANT('B')) { try { await suiteB(browser, origin, contentCss, contentJs); } catch (e) { check('Suite B completed without exceptions', false, String(e && e.stack || e)); } }
    await browser.close(); browser = null;
    if (WANT('C')) { try { await suiteC(puppeteer, origin); } catch (e) { check('Suite C completed without exceptions', false, String(e && e.stack || e)); } }
  } finally {
    if (browser) { try { await browser.close(); } catch (_) { /* ignore */ } }
    server.close();
  }

  const secs = elapsed();
  if (PARTIAL) console.log(`\n*** PARTIAL RUN: suites ${SUITES.split('').join(', ')} only — NOT a full verification ***`);
  else check(`total runtime < ${Math.round(TIME_BUDGET_MS / 1000)} s`, Number(secs) < TIME_BUDGET_MS / 1000, secs);
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed, ${results.length} total in ${secs} s`);
  if (failed) for (const r of results.filter((x) => !x.ok)) console.log(`  FAILED: ${r.name}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
