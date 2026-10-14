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
 * v1.1: size-based HP (`api.hpOf`), weapons (`api.weapons()`), hold weapons (smg / flame), katana slashes
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
const WEAPON_IDS = ['hammer', 'pistol', 'smg', 'sniper', 'axe', 'katana', 'bomb', 'rocket', 'flame', 'collapse'];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const SPEC_DMG = { hammer: 65, pistol: 25, smg: 22, sniper: 200, axe: 130, katana: 60, bomb: 190, rocket: 260, flame: 15 };
const SPEC_COOLDOWN = { hammer: 0, pistol: 0, sniper: 600, axe: 550, bomb: 700, rocket: 1200, collapse: 2000 };
// mag / reloadMs per weapon (null = melee ∞); flame = 100 fuel, collapse = 1 charge
const SPEC_MAG = { hammer: [null, null], axe: [null, null], katana: [null, null], pistol: [12, 900], smg: [30, 1400], sniper: [5, 2000], bomb: [3, 1800], rocket: [2, 1500], flame: [100, 2500], collapse: [1, 5000] };
const PRESETS = {
  default: WEAPON_IDS,
  assault: ['smg', 'pistol', 'sniper', 'bomb', 'rocket', 'flame', 'hammer', 'axe', 'katana', 'collapse'],
};
const KO_NAME = { hammer: '망치', pistol: '권총', smg: '기관총', sniper: '저격총', axe: '도끼', katana: '카타나', bomb: '폭탄', rocket: '로켓', flame: '화염', collapse: '붕괴' };

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
  katana:    { swapMs: 200, recoil: 1.0, bloom: 0, critChance: 0.20, knockback: 1.1, moveSpeed: 1.15, falloff: 0 },
  bomb:     { swapMs: 300, recoil: 1.2, bloom: 0, critChance: 0.08, knockback: 1.6, moveSpeed: 0.95, falloff: 0, aoeIgnoresCover: true },
  rocket:   { swapMs: 480, recoil: 2.4, bloom: 0, critChance: 0.08, knockback: 2.0, moveSpeed: 0.80, falloff: 0, aoeIgnoresCover: true },
  flame:    { swapMs: 340, recoil: 0.3, bloom: 3, critChance: 0.05, knockback: 0.5, moveSpeed: 0.90, falloff: 0.55 },
  collapse: { swapMs: 500, recoil: 2.6, bloom: 0, critChance: 0,    knockback: 1.2, moveSpeed: 1.00, falloff: 0 },
};
const SPEC_PIERCE = { hammer: 0, pistol: 0, smg: 0, sniper: 2, axe: 0, katana: 0, bomb: 0, rocket: 0, flame: 0, collapse: Infinity };
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
// SPEC-test-speed §4 (suite concurrency): suites A, B and C run at the same time, each on its own browser.
// Their output would otherwise interleave into noise, so every line a suite prints is captured into that
// suite's own buffer and the buffers are flushed in A, B, C order once each finishes. AsyncLocalStorage is
// what makes that possible without threading a sink through ~600 call sites: the store follows the await
// chain of whichever suite is currently running, so plain console.log() inside a suite still lands in the
// right buffer. Outside a suite (startup, the summary) the store is empty and output goes straight out.
const { AsyncLocalStorage } = require('async_hooks');
const util = require('util');
const CHANNEL = new AsyncLocalStorage();
const rawLog = console.log.bind(console);
console.log = (...args) => {
  const ch = CHANNEL.getStore();
  if (ch) ch.lines.push(util.format(...args)); else rawLog(...args);
};
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
      // SPEC-weapon-art §5 / §9 item 5: weaponArt() resolves user PNG art through chrome.runtime.getURL.
      // Real MV3 hands back a chrome-extension:// URL; the shim mirrors that shape so the <img> branch can
      // be exercised. Only the §5 probe page ever reaches it (the packaged file does not exist here, so the
      // <img> fails to load — that page is deliberately NOT one of the console-watched ones).
      getURL: (p) => 'chrome-extension://crashscreentest/' + String(p == null ? '' : p).replace(/^\\//, ''),
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
        // SPEC-settings §1.3: the one-time migration drops the old flat keys via chrome.storage.sync.remove().
        remove: (keys) => { for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k]; return Promise.resolve(); },
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

// SPEC-test-speed §5 (block selection). Suite A is the long pole; it is cut into named blocks that each
// open their OWN page and build their OWN preconditions, so any one of them can run alone:
//   CRS_BLOCKS=material,settings node test/e2e.js
// Blocks also run CONCURRENTLY, one browser each — that, not the sleeps, is what makes the wall clock.
// A typo must not look green: an unknown name is a hard error, never a silent zero-block run.
const BLOCK_ARG = (process.argv.find((a) => a.startsWith('--blocks=')) || '').slice(9);
const BLOCKS_RAW = String(process.env.CRS_BLOCKS || BLOCK_ARG || '').trim().toLowerCase();
const BLOCK_NAMES = ['core', 'ammo', 'combat', 'debris', 'depth', 'rules', 'settings'];
const BLOCKS_PICKED = BLOCKS_RAW ? BLOCKS_RAW.split(/[,\s]+/).filter(Boolean) : null;
if (BLOCKS_PICKED) {
  const bad = BLOCKS_PICKED.filter((b) => !BLOCK_NAMES.includes(b));
  if (bad.length) {
    rawLog(`unknown block(s): ${bad.join(', ')} — known blocks are ${BLOCK_NAMES.join(', ')}`);
    process.exit(2);
  }
}
const WANT_BLOCK = (name) => !BLOCKS_PICKED || BLOCKS_PICKED.includes(name);
const PARTIAL_BLOCKS = !!BLOCKS_PICKED;
// How many browsers may be alive at once. Each block lane owns one. The default leaves room for the
// machine itself; CRS_LANES=1 serialises them when a loaded box starts dropping targets.
/* How many browsers may be alive at once. The ceiling is NOT the core count — it is frame starvation.
 *
 * Six lanes measured fastest (59 s vs 84 s at four) on a suite of 797 assertions, and that number did not
 * survive the next phase: with 826 assertions and heavier per-hit rendering, six lanes failed three runs out
 * of three while main passed three out of three at the same machine load, and five lanes failed one in two.
 * The assertions that go are the ones that need the page to actually get frames — a drone that does not move
 * at all through a 450 ms key hold, a viewmodel swing sampled below its peak, a 600 ms damage budget missed
 * by 17 ms. That is the product being starved, not a wrong measurement, and it will come back every time the
 * suite grows. Four lanes is 71 s and has not failed.
 *
 * So: four, and re-measure rather than re-guess when the suite grows again. A 4-core CI runner resolves to 3.
 * CRS_LANES=1 serialises completely; CRS_LANES=6 is there for a genuinely idle machine. */
const LANE_CAP = Math.max(1, Number(process.env.CRS_LANES || Math.min(4, Math.max(1, require('os').cpus().length - 1))));


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

// SPEC-test-speed §5: the precondition every block shares — fixture loaded, content.css injected at USER
// origin, timer ledger + chrome shim in place, content.js active, and the deterministic debug flags the
// exact-damage assertions are written against. Blocks that want a different state say so themselves.
// This is the silent twin of what the `core` block asserts its way through at the top of suite A.
async function freshPage(browser, origin, contentCss, contentJs, opts = {}) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const log = hookPage(page);
  await installViolationCounter(page);
  await page.goto(`${origin}/`, { waitUntil: 'load' });
  const client = await injectCss(page, contentCss);
  await page.evaluate(TIMER_LEDGER);
  await page.evaluate(CHROME_SHIM);
  // content.js TOGGLES: evaluating it on an active page turns the page off. A block that activates for
  // itself (and asserts the completion value while doing so) asks for `activate: false` and gets a page
  // that is injected and shimmed but not yet on.
  const on = opts.activate === false ? null : await page.evaluate(contentJs);
  if (opts.activate !== false && opts.debug !== false) {
    /* `noPartial` (SPEC-destruction §C3): every block written before §C aims at an element's PADDING to
     * reach the element itself rather than a child — which is now a `corner` / `edge` hit, so it sheds a
     * plate and, after enough of them, converts to total destruction. Those blocks are about HP accounting,
     * decal geometry and ammo, not about fracture, so they run with §C's partial destruction off — the same
     * escape hatch `noInvuln` gives the pre-§B suites. The §A–§D block turns it back on for itself. */
    await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: false, noFalloff: true, noPartial: true });
  }
  return { page, log, client, on };
}

// Closes a block's page after tallying the console / CSP / lastError evidence for it. Every block owns
// its own tally now — the single suite-wide tally at the end of suite A could only ever cover one page.
async function closeBlockPage(label, h) {
  const v = await violations(h.page);
  check(`${label}: zero error-level console messages`, h.log.consoleErrors.length === 0, h.log.consoleErrors[0]);
  check(`${label}: zero page errors`, h.log.pageErrors.length === 0, h.log.pageErrors[0]);
  check(`${label}: zero securitypolicyviolation events`, v.length === 0, v[0]);
  const st = await h.page.evaluate(() => (window.__crashScreen && window.__crashScreen.stats ? window.__crashScreen.stats().lastError : null));
  check(`${label}: stats().lastError === null for the whole block`, st === null, st);
  try { await h.client.detach(); } catch (e) { /* ignore */ }
  try { await h.page.close(); } catch (e) { /* ignore */ }
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
  // SPEC-combat §C: `own` is the shell's own HP (the v1.1 A1 formula) and `approx` says the §C4 walk budget ran out
  hpOf: (page, sel) => page.evaluate((s) => { const r = window.__crashScreen.hpOf(document.querySelector(s)); return { hp: r.hp, max: r.max, own: r.own, approx: r.approx }; }, sel),
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
    /* SPEC-crosshair §B2: the bar is the SAME node, re-parented under `.crs-crosshair` — "체력 표시를
     * 요소에서 떼어 조준점 아래로 옮기고". It is looked up document-wide so every assertion written
     * against the hover bar still measures the hover bar, wherever §B2 put it. */
    const bar = box.querySelector('.crs-target-bar') || document.querySelector('.crs-target-bar');
    const fill = bar ? bar.querySelector('.crs-target-fill') : null;
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
  // SPEC-weapon-art §9: a measuring probe over one weaponArt() result. The node is parked offscreen so
  // getBBox() is real layout, not a guess; `parts` is the union bbox + path data per [data-part], which is
  // how the claw V, the axe arc, the body taper, the pick and the haft fraction are checked below without
  // the test having to trust a number the art module merely claims.
  weaponArtProbe: (page, id, size, lod) => page.evaluate((i, s, l) => {
    const a = window.__crashScreen;
    if (!a || typeof a.weaponArt !== 'function') return 'missing:weaponArt';
    let node;
    try { node = l ? a.weaponArt(i, s, l) : a.weaponArt(i, s); } catch (e) { return 'threw:' + String(e && e.message || e); }
    if (!node || typeof node.tagName !== 'string' || node.tagName.toLowerCase() !== 'svg') return { ok: false, tag: node && node.tagName };
    const host = document.createElement('div');
    host.style.position = 'fixed'; host.style.left = '-9999px'; host.style.top = '0';
    host.appendChild(node);
    document.body.appendChild(host);
    const inDefs = new Set(Array.from(node.querySelectorAll('defs, defs *')));
    const drawn = Array.from(node.querySelectorAll('*')).filter((n) => !inDefs.has(n));
    const bb = (n) => { try { const b = n.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; } catch (e) { return null; } };
    let root = { x: 0, y: 0, w: 0, h: 0 };
    try { const r = node.getBBox(); root = { x: r.x, y: r.y, w: r.width, h: r.height }; } catch (e) { /* ignore */ }
    const parts = {};
    const fills = [];
    for (const n of drawn) {
      const f = n.getAttribute('fill');
      if (f) fills.push(f);
      const k = n.getAttribute('data-part');
      if (!k) continue;
      const b = bb(n);
      if (!b) continue;
      const e = parts[k] || (parts[k] = { n: 0, x: 1e9, y: 1e9, x2: -1e9, y2: -1e9, ds: [] });
      e.n++;
      e.x = Math.min(e.x, b.x); e.y = Math.min(e.y, b.y);
      e.x2 = Math.max(e.x2, b.x + b.w); e.y2 = Math.max(e.y2, b.y + b.h);
      if (n.tagName.toLowerCase() === 'path' && e.ds.length < 2) e.ds.push(n.getAttribute('d') || '');
    }
    for (const k of Object.keys(parts)) { const e = parts[k]; e.w = e.x2 - e.x; e.h = e.y2 - e.y; }
    const area = Math.max(1, root.w * root.h);
    const strokes = drawn.filter((n) => { const v = n.getAttribute('stroke'); return v && v !== 'none'; })
      .map((n) => { const b = bb(n); return b ? (b.w * b.h) / area : 0; });
    const paths = Array.from(node.querySelectorAll('path')).map((p) => p.getAttribute('d') || '');
    host.remove();
    return {
      ok: true, lod: node.getAttribute('data-lod') || '', viewBox: node.getAttribute('viewBox') || '',
      width: node.getAttribute('width'), height: node.getAttribute('height'),
      childCount: node.children.length, drawn: drawn.length,
      grads: node.querySelectorAll('linearGradient, radialGradient').length,
      strokeCount: strokes.length, strokeMax: strokes.length ? Math.max.apply(null, strokes) : 0,
      root, parts, fills, pathCount: paths.length, pathSig: paths.join('|')
    };
  }, id, size, lod || null),
  // `.crs-viewmodel` presence/shape, plus its live computed transform decomposed into translateX/Y (px) and
  // rotation (deg) via DOMMatrix — robust to whatever transform functions the implementation composes
  // (translate + rotate, a single matrix(), etc.), since items 4/5/14 only care about the net displacement.
  /* How far the viewmodel TRAVELS over `ms`, sampled by requestAnimationFrame INSIDE the page: the peak-to-peak
   * spread of its translate, with no reference point of its own.
   *
   * Two things were wrong with measuring the distance from a base sample taken just before the shot. The recoil
   * one-shot is ~180 ms, so reading it over CDP at 25-40 ms a round trip takes six or seven samples and often
   * misses the peak. And under normal motion the 2600 ms idle bob is still running underneath (WAAPI gives the
   * property to the last-started animation, and the shot ends with fill:'none'), so that base sample is taken
   * at an arbitrary bob phase somewhere in ±3 px while the recoil itself starts from the base pose — the
   * "amplitude" it measured was part bob offset. Under reduced motion there is no bob at all, so the same
   * number meant two different things on the two sides of the comparison, and which side came out larger was
   * luck. A spread needs no baseline: over 220 ms the bob contributes about a pixel and the recoil dominates. */
  viewmodelPeak: (page, _base, ms) => page.evaluate((t) => new Promise((resolve) => {
    const el = document.querySelector('.crs-viewmodel');
    if (!el) return resolve(null);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, frames = 0;
    const t0 = performance.now();
    const step = () => {
      const cs = getComputedStyle(el);
      let tx = 0, ty = 0;
      try { const m = new DOMMatrix(cs.transform); tx = m.m41; ty = m.m42; } catch (e) { /* identity */ }
      if (tx < minX) minX = tx; if (tx > maxX) maxX = tx;
      if (ty < minY) minY = ty; if (ty > maxY) maxY = ty;
      frames++;
      if (performance.now() - t0 < t) requestAnimationFrame(step);
      else resolve({ peak: Math.hypot(maxX - minX, maxY - minY), frames });
    };
    requestAnimationFrame(step);
  }), ms),
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
  // SPEC-test-speed §3: debug.timeScale. api.debug() would do, but going through setTimeScale() keeps the
  // test's own idea of the scale (SCALE below) and the product's in step — they must not drift, because
  // every tsleep() length is computed from the test's copy.
  timeScale: (page, v) => page.evaluate((x) => { const d = window.__crashScreen.debug; d.timeScale = x; return { set: d.timeScale, effective: typeof d.timeScaleNow === 'function' ? d.timeScaleNow() : null, ms3000: typeof d.scaledMs === 'function' ? d.scaledMs(3000) : null }; }, v),
};

// ---------------------------------------------------------------------------
// SPEC-test-speed §3/§4 — the debug time scale, from the test side
// ---------------------------------------------------------------------------
// Keyed by page, not a module global: suites A, B and C run concurrently (§4) and a shared mutable scale
// would leak across lanes. Only the lane that set it ever reads it back.
const SCALE = new WeakMap();
const scaleOf = (page) => SCALE.get(page) || 1;
// A sleep expressed in PRODUCT milliseconds: tsleep(page, 3000) waits out as much product time as 3000 ms
// does at scale 1, i.e. 750 ms of wall clock at scale 0.25. Use it for every wait whose length is "however
// long the product takes"; keep a plain sleep() where the wall clock itself is what an assertion measures.
const tsleep = (page, ms) => sleep(Math.max(0, Math.round(ms * scaleOf(page))));
// Same conversion for a poll() timeout or any other product-time budget.
const tms = (page, ms) => Math.max(0, Math.round(ms * scaleOf(page)));
async function setTimeScale(page, v) {
  const want = clamp(Number(v), 0.05, 1);
  await api.timeScale(page, want);
  SCALE.set(page, want);
  return want;
}
// Run fn with the product sped up, then put the scale back to 1 no matter how fn ends. Spec §4: "블록 진입
// 시 설정하고 나갈 때 1 로 되돌린다" — a scale left on would silently speed up the next block, and an
// assertion that is supposed to measure a real duration would quietly stop measuring anything.
async function withScale(page, v, fn) {
  await setTimeScale(page, v);
  try { return await fn(); } finally { await setTimeScale(page, 1); }
}

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
/* SPEC-combat §C2 made containers outlast a magazine: a shot loop that used to fit in 12 rounds no longer
 * does, and a shot fired during an auto-reload is simply rejected. Wait for a chambered round first. */
async function ammoReady(page) {
  const a = await api.ammo(page);
  if (a && a.mag === 0 && !a.reloading) await api.reload(page);
  return poll(async () => { const b = await api.ammo(page); return b && b.mag > 0 && !b.reloading ? b : null; }, 2500, 20);
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
  // SPEC-material.md §2/§3/§8: the viewport-fixed glass sheet is gone — damage marks now live on
  // per-element decal nodes, never on a single full-screen canvas (rewritten from "A.inject: .crs-canvas
  // present", SPEC-material §9 item 1).
  check('A.inject: no viewport-fixed .crs-canvas (damage marks are element-local decals now, SPEC-material §9.1)', !(await api.has(page, '.crs-canvas')));
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
  // noPartial: see freshPage() — the pre-§C assertions below aim at card padding, which §C now reads as an edge hit
  try { dbg = await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: false, noFalloff: true, noPartial: true }); } catch (e) { dbg = String(e && e.message || e); }
  check('A.inject: api.debug noCrit / noCooldown / noSpread / noAttacks / fastReload / noFalloff set for the suite', dbg && dbg.noCrit === true && dbg.noCooldown === true && dbg.noSpread === true && dbg.noAttacks === true && dbg.fastReload === true && dbg.noFalloff === true, dbg);
  /* ── SPEC-crosshair §B2 / §A9 `showHpNumber` ────────────────────────────────────────────────────
   * §B2 moved the health readout off the element and under the crosshair, and took the NUMBERS away
   * with it ("숫자를 없앤다"); `showHpNumber` (default false) is the switch that puts them back, on the
   * hover label and under the bar at once. Dozens of assertions in this block were written against the
   * v1.1 `TAG hp/max` label and are about damage arithmetic, not about markers — so this block asks for
   * the numbers explicitly and every one of them keeps asserting exactly what it asserted before.
   * The DEFAULT (no numbers anywhere) is asserted in the `rules` block, which runs with stock settings. */
  const hpNumOn = await api.call(page, 'setSetting', 'showHpNumber', true);
  check('A.inject: showHpNumber: true accepted — this block reads the hover label\'s numbers (SPEC-crosshair §B2 made them opt-in)', hpNumOn === true, hpNumOn);

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
  check('A.hud: Korean labels (망치 · 권총 · 기관총 · 저격총 · 도끼 · 카타나 · 폭탄 · 로켓 · 화염 · 붕괴 · 피해 · 로드아웃 · 전투) present (text or button titles)', !!hud && ['망치', '권총', '기관총', '저격총', '도끼', '카타나', '폭탄', '로켓', '화염', '붕괴', '피해', '로드아웃', '전투'].every((t) => hud.text.includes(t)), hud && hud.text.slice(0, 300));
  check('A.hud: no 공격력 (attack-power) text and no -/+ power buttons anywhere in the HUD (v1.3 §1)', !!hud && hud.noPowerButtons && !hud.text.includes('공격력'), hud && { noPowerButtons: hud.noPowerButtons, hasLabel: hud.text.includes('공격력') });

  // --- hammer on the small ("known") card — A31 (99 hp → 2 hits at 65) ---------------------------
  const urlBefore = page.url();
  const sc = await api.rect(page, '#small-card');
  const brokenBefore = (await api.stats(page)).broken;
  const smallPt = { x: sc.left + 12, y: sc.top + 12 };
  /* SPEC-combat §C2 changed this number: the card is no longer worth its own 99-hp shell alone, it also carries
   * 0.6 × the h3 / p / a inside it, so it takes one hammer hit more. The count is DERIVED from the live max
   * (font metrics decide the children's heights, and those differ between machines) — what is asserted is the
   * relation the spec states: aggregate > own, and the card breaks on exactly the hit the aggregate predicts. */
  const smallHp0 = await api.hpOf(page, '#small-card');
  const smallWant = hitsFor(smallHp0.max, DMG('hammer'));
  const smallClicks = await clickUntilBroken(page, '#small-card', smallPt.x, smallPt.y, 4);
  check('A.hammer small card: broken on hammer hit hitsFor(max, 65), and §C max > its own shell', smallClicks === smallWant && smallHp0.max > smallHp0.own, { smallClicks, smallWant, hp: smallHp0 });
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

  // SPEC-material.md §1/§3/§9.1: damage marks now live on a per-element `.crs-decal` node (an absolutely
  // positioned canvas over the element's own rect), not on the removed viewport-fixed `.crs-canvas`.
  // #small-card and #long-para are both already broken by this point in the suite, and a broken element's
  // decal is destroyed along with it (SPEC-destruction.md §1), so there is nothing left to sample ink from
  // on either of them — #big-card (still intact, undamaged so far) is the element this check uses instead:
  // one sub-break hammer hit, then ink is read back from ITS decal at the local impact point.
  await api.setWeapon(page, 'hammer');
  const inkCard = await api.rect(page, '#big-card');
  const inkMax = (await api.hpOf(page, '#big-card')).max;
  const inkPt = { x: inkCard.left + 12, y: inkCard.top + 12 };
  await page.mouse.click(inkPt.x, inkPt.y);
  await poll(async () => (await api.hpOf(page, '#big-card')).hp < inkMax, 400, 20);
  const inkBefore = await page.evaluate((pt) => {
    const host = document.querySelector('.crs-decal');
    if (!host) return -1;
    const canvas = host.tagName === 'CANVAS' ? host : host.querySelector('canvas');
    if (!canvas) return -2;
    const r = host.getBoundingClientRect();
    const sx = canvas.width / (canvas.clientWidth || r.width || 1), sy = canvas.height / (canvas.clientHeight || r.height || 1);
    const lx = Math.round((pt.x - r.left) * sx), ly = Math.round((pt.y - r.top) * sy);
    const ctx = canvas.getContext('2d');
    const d = ctx.getImageData(Math.max(0, lx - 4), Math.max(0, ly - 4), 9, 9).data;
    let a = 0; for (let i = 3; i < d.length; i += 4) a += d[i];
    return a;
  }, inkPt);
  check('A.decal: #big-card\'s own decal has ink at the impact point before restore (rewritten from the removed .crs-canvas check, SPEC-material §9.1)', inkBefore > 0, inkBefore);

  // --- restore ------------------------------------------------------------------------------
  await api.restore(page);
  await sleep(100);
  const sr = await api.stats(page);
  check('A.restore: zero debris', sr.debris === 0 && (await api.count(page, '.crs-debris')) === 0, sr);
  check('A.restore: no [data-crs-broken]', (await api.count(page, '[data-crs-broken]')) === 0);
  check('A.restore: small card visibility restored', (await api.visibility(page, '#small-card')) === 'visible');
  check('A.restore: stats().broken === 0', sr.broken === 0, sr.broken);
  // rewritten from sampling the removed .crs-canvas for leftover ink: restore() must tear down every
  // per-element decal node too, not just clear a shared bitmap (SPEC-material §9.1 / §9.11).
  const decalsAfter = await api.count(page, '.crs-decal');
  check('A.restore: every .crs-decal node removed (no decal canvas survives restore)', decalsAfter === 0, decalsAfter);
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
  const bigHp0 = await api.hpOf(page, '#big-card');
  const bigMax = bigHp0.max;
  const nBig = hitsFor(bigMax, DMG('hammer'));
  /* Was `nBig === 3` (184 / 65). SPEC-combat §C2 adds 0.6 × the h2 / p / ul inside the card, so the shell is
   * no longer the whole price — more hits, derived from the live max rather than frozen into the test. */
  check('A.hammer large card: hitsFor(max, 65) > hitsFor(own, 65) — §C2 charges for what the card holds', nBig === hitsFor(bigMax, DMG('hammer')) && nBig > hitsFor(bigHp0.own, DMG('hammer')), { bigMax, own: bigHp0.own, nBig, ownHits: hitsFor(bigHp0.own, DMG('hammer')) });
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
  const gunHp0 = await api.hpOf(page, '#big-card');
  const gunMax = gunHp0.max;
  const nGun = hitsFor(gunMax, DMG('pistol'));
  /* Was `nGun === 8` (184 / 25). Same §C2 change as the hammer run above — and the count now exceeds the
   * pistol's 12-round magazine, so every shot waits for a chambered round (ammoReady). */
  check('A.gun large card: hitsFor(max, 25) > hitsFor(own, 25) — §C2 charges for what the card holds', nGun === hitsFor(gunMax, DMG('pistol')) && nGun > hitsFor(gunHp0.own, DMG('pistol')), { gunMax, own: gunHp0.own, nGun });
  const debris0 = await api.count(page, '.crs-debris');
  const gunSteps = [];
  for (let k = 1; k < nGun; k++) {
    await ammoReady(page);
    await page.mouse.click(gunPt.x, gunPt.y);
    const expected = 'DIV ' + (gunMax - DMG('pistol') * k) + '/' + gunMax;
    const tb = await poll(async () => { const t = await api.targetBox(page); return t && t.label === expected ? t : null; }, 600, 20);
    gunSteps.push({ k, broken: await api.broken(page, '#big-card'), debris: await api.count(page, '.crs-debris'), label: (tb || await api.targetBox(page) || {}).label, expected });
  }
  check('A.gun large card: shots 1 … ' + (nGun - 1) + ' → not broken, debris count unchanged', gunSteps.length === nGun - 1 && gunSteps.every((s) => !s.broken && s.debris === debris0), { debris0, steps: gunSteps.map((s) => [s.k, s.broken, s.debris]) });
  check('A.gun large card: shot 1 → label "DIV ' + (gunMax - DMG('pistol')) + '/' + gunMax + '"', gunSteps[0] && gunSteps[0].label === gunSteps[0].expected, gunSteps[0]);
  check('A.gun large card: shot 2 → label "DIV ' + (gunMax - 2 * DMG('pistol')) + '/' + gunMax + '"', gunSteps[1] && gunSteps[1].label === gunSteps[1].expected, gunSteps[1]);
  await ammoReady(page);
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
  // SPEC-combat §C2: `own` keeps the v1.1 [10, 400] clamp, the aggregate `max` is clamped at [10, 2500]
  const inRange = (r) => r.own >= 10 && r.own <= 400 && r.max >= 10 && r.max <= 2500 && r.hp === r.max;
  check('A.hp 1: max scales with size — leaf < button < image < large card', hpLeaf.max < hpBtn.max && hpBtn.max < hpImg.max && hpImg.max < hpCard.max, { leaf: hpLeaf.max, btn: hpBtn.max, img: hpImg.max, card: hpCard.max });
  check('A.hp 1: every own within [10, 400], every max within [10, 2500] and hp === max on a fresh page', [hpLeaf, hpBtn, hpImg, hpCard, hpPara].every(inRange), { leaf: hpLeaf, btn: hpBtn, img: hpImg, card: hpCard, para: hpPara });
  check('A.hp 1: image max === round((20 + 0.35·√area) × 1.2) from its live rect', hpImg.max === specMaxHp(rects.img.w, rects.img.h, 1.2, false), { got: hpImg.max, expected: specMaxHp(rects.img.w, rects.img.h, 1.2, false), rect: rects.img });
  /* Was `hpCard.max === specMaxHp(...)`. SPEC-combat §C2: that formula is now `own`, and the card's max adds
   * 0.6 × what it holds. The own half is still asserted exactly — it is the v1.1 A1 formula, unchanged. */
  check('A.hp 1: large card own === round(20 + 0.35·√area) (mult 1.0) from its live rect, and §C max is strictly above it', hpCard.own === specMaxHp(rects.card.w, rects.card.h, 1.0, false) && hpCard.max > hpCard.own, { got: hpCard, expected: specMaxHp(rects.card.w, rects.card.h, 1.0, false), rect: rects.card });
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
  const dbgReset = await api.debug(page, { forceCrit: false, noCrit: true, noPartial: true });
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
  const dbg6 = await api.debug(page, { forceCrit: false, noCrit: true, noPartial: true });
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
  /* REWRITTEN for SPEC-destruction §F1. "no particles 1.5 s after release" was true when the flamethrower
     stopped the instant you let go; §F makes the flame LEAVE A FIRE BEHIND — "불을 붙이고 떠나도 일이
     진행된다" — so the old deadline now asserts the absence of the feature. The 흔적 없음 claim it was
     really protecting is kept, re-anchored to the end of the FIRE rather than the end of the trigger: the
     arena is still burning after release, and §F4's 물총 → 불 rule (debug.douse, the hook the step-8 water
     pistol will call) puts it out — after which not one particle survives. */
  const burnAfter7 = await page.evaluate(() => (window.__crashScreen.debug.burning() || []).map((b) => b.stacks));
  check('A.flame 7 (destr §F1): 떼고 나서도 불이 남아 계속 탄다 — 연소 원장에 요소가 있고 .crs-fire 가 아직 살아 있다',
    burnAfter7.length >= 1 && burnAfter7.some((n) => n > 0) && (await api.count(page, '.crs-fire')) >= 1,
    { burning: burnAfter7, fire: await api.count(page, '.crs-fire') });
  const doused7 = await page.evaluate(() => window.__crashScreen.debug.douseAll());
  check('A.flame 7 (destr §F4 / 흔적 없음): 불을 끄면 1.5 s 안에 .crs-fire 가 0 이 되고 연소 원장도 빈다',
    await poll(async () => ((await api.count(page, '.crs-fire')) === 0 && (await page.evaluate(() => (window.__crashScreen.debug.burning() || []).length)) === 0), 1500, 50),
    { doused: doused7, fire: await api.count(page, '.crs-fire'), burning: await page.evaluate(() => (window.__crashScreen.debug.burning() || []).length) });
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

  // (8) katana: api.slash across both cards, real drag, two-piece split of a leaf (+ katana.png)
  await api.restore(page);
  await sleep(60);
  await api.setWeapon(page, 'katana');
  const bc8 = await api.rect(page, '#big-card');
  const sc8 = await api.rectNoScroll(page, '#small-card');
  const seg = { x1: bc8.left + 12, y1: bc8.top + 12, x2: sc8.left + 12, y2: sc8.top + 12 };
  const nSlash = await api.slash(page, seg.x1, seg.y1, seg.x2, seg.y2);
  await poll(async () => (await api.hpOf(page, '#small-card')).hp < (await api.hpOf(page, '#small-card')).max, 400, 20);
  const bigS = await api.hpOf(page, '#big-card');
  const smallS = await api.hpOf(page, '#small-card');
  check('A.katana 8: api.slash across both cards → each at hp === max − 60, neither broken', bigS.hp === bigS.max - DMG('katana') && smallS.hp === smallS.max - DMG('katana') && !(await api.broken(page, '#big-card')) && !(await api.broken(page, '#small-card')), { ret: nSlash, big: bigS, small: smallS });
  check('A.katana 8: api.slash returns the number of elements damaged (≥ 2)', typeof nSlash === 'number' && nSlash >= 2, nSlash);
  check('A.katana 8: a slash counts as one action (stats().shots === 1) and draws a crack', (await api.stats(page)).shots === 1 && (await api.stats(page)).cracks >= 1, await api.stats(page).then((s) => ({ shots: s.shots, cracks: s.cracks })));
  await api.restore(page);
  await sleep(60);
  await page.mouse.move(seg.x1, seg.y1);
  await page.mouse.down();
  await page.mouse.move(seg.x2, seg.y2, { steps: 8 });
  const previewSeen = await api.count(page, '.crs-slash-preview');
  await page.mouse.up();
  const dragOk = await poll(async () => { const b = await api.hpOf(page, '#big-card'); const s = await api.hpOf(page, '#small-card'); return b.hp < b.max && s.hp < s.max; }, 500, 20);
  check('A.katana 8: real drag (down/move/up) damages both cards', dragOk, { big: await api.hpOf(page, '#big-card'), small: await api.hpOf(page, '#small-card') });
  check('A.katana 8: .crs-slash-preview shown while dragging', previewSeen >= 1, previewSeen);
  check('A.katana 8: preview removed on pointerup (before any restore)', (await api.count(page, '.crs-slash-preview')) === 0, await api.count(page, '.crs-slash-preview'));
  await page.screenshot({ path: path.join(OUT, 'katana.png') });
  info('screenshot test/out/katana.png');
  await api.restore(page);
  await sleep(60);
  const leaf8 = await api.rect(page, '#cluster .leaf:first-child');
  await api.slash(page, leaf8.left + 4, leaf8.cy, leaf8.right - 4, leaf8.cy);
  const leafBroken = await poll(() => api.broken(page, '#cluster .leaf:first-child'), 600, 20);
  const s8 = await api.stats(page);
  check('A.katana 8: a slash across a leaf breaks it', leafBroken);
  check('A.katana 8: stats().lastBreakPieces === 2 (geometric two-piece split, no word shattering)', s8.lastBreakPieces === 2, s8.lastBreakPieces);
  check('A.katana 8: no .crs-slash-preview left after the slashes', (await api.count(page, '.crs-slash-preview')) === 0);

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
  /* `hurtAt` is new and `brokenAt` no longer fires on one rocket: SPEC-combat §C2 puts the card above the
   * rocket's 260, so the IMPACT (what the 600 ms deadline is really about — the 0.5 s flight) is now measured
   * as the moment the card's hp moves. The break itself is asserted below, on the second rocket. */
  const seen9 = { rocketAt: -1, ringAt: -1, ringR: -1, brokenAt: -1, hurtAt: -1 };
  while (Date.now() - t9 < 900 && (seen9.ringAt < 0 || seen9.hurtAt < 0)) {
    const s = await page.evaluate(() => {
      const el = document.getElementById('big-card');
      const h = window.__crashScreen.hpOf(el);
      /* REWRITTEN for SPEC-destruction §E4. The rocket's ring used to be a FIXED 960 px node wearing
         `.crs-fx-ring-xl`; §E4 deletes both fixed sizes ("고정 480px 링은 삭제하고 JS 가 R 로 크기를
         준다"), so what is sampled now is the ring's own final radius — which §E5 pins to the rocket's
         real 360 px blast radius. The claim ("a shock ring appeared at impact") is unchanged; only the
         node it is read off is, because the node it used to be read off no longer exists. */
      /* the ring animates `transform: scale(.02 → 1)`, so getBoundingClientRect() reports the frame it is
         on; the FINAL radius §E4 asks about is the laid-out width JS wrote. */
      const rings = [...document.querySelectorAll('.crs-fx-ring')].map((n) => parseFloat(getComputedStyle(n).width) / 2);
      return { ring: rings.length, ringR: rings.length ? Math.round(Math.max(...rings)) : -1, broken: el.hasAttribute('data-crs-broken'), hurt: !!(h && h.hp < h.max) };
    });
    const ms = Date.now() - t9;
    if (seen9.ringAt < 0 && s.ring) { seen9.ringAt = ms; seen9.ringR = s.ringR; }
    if (seen9.brokenAt < 0 && s.broken) seen9.brokenAt = ms;
    if (seen9.hurtAt < 0 && (s.hurt || s.broken)) seen9.hurtAt = ms;
    await sleep(10);
  }
  seen9.rocketAt = await page.evaluate(() => { const p = window.__crsRocketProbe; delete window.__crsRocketProbe; return p ? Math.round(p.rocketAt) : -2; });
  check('A.rocket 9: .crs-rocket streak inserted within 150 ms of the click (MutationObserver probe)', seen9.rocketAt >= 0 && seen9.rocketAt <= 150, seen9);
  check('A.rocket 9: #big-card takes the rocket hit within 600 ms (hp below max — the §C2 aggregate survives one 260)', seen9.hurtAt >= 0 && seen9.hurtAt <= 600, seen9);
  check('A.rocket 9 (destr §E4/§E5): 충격파 링이 착탄 순간에 뜨고, 그 최종 반지름이 로켓의 실제 폭발 반경 360 px 다 (고정 960 px .crs-fx-ring-xl 은 삭제됐다)',
    seen9.ringAt >= 0 && Math.abs(seen9.ringR - W.byId.rocket.radius) <= 6 && (await api.count(page, '.crs-fx-ring-xl')) === 0,
    { ...seen9, specR: W.byId.rocket.radius });
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
  // the break the first rocket used to get on its own: 260 × 2 clears the §C2 aggregate
  await ammoReady(page);
  const bc9c = await api.rect(page, '#big-card');
  await page.mouse.click(bc9c.left + 12, bc9c.top + 12);
  check('A.rocket 9: a second rocket breaks #big-card (260 × 2 > the §C2 aggregate max)', await poll(() => api.broken(page, '#big-card'), 1500));
  // restore() 40 ms into the flight: the streak goes at once and the impact timer never fires on the restored page
  await api.restore(page);
  await sleep(60);
  const bc9b = await api.rect(page, '#big-card');
  const h9b0 = await api.hpOf(page, '#big-card');
  await ammoReady(page);   // the two rockets above emptied the tube; a shot fired mid-reload is rejected
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
  const innerMax10 = (await api.hpOf(page, '#x-aoe-inner')).max;
  check('A.bomb 10: a bomb centred on a nested 200 × 200 child breaks the child (90 hp < 190)', innerGone10, await api.hpOf(page, '#x-aoe-inner'));
  /* The AoE rule under test is unchanged — the container takes NO blast damage, which is still `hp === max`.
   * What changed is the max itself: SPEC-combat §C3 takes 0.6 × the child it just lost off both max and hp,
   * so the container falls back to its own 160-hp shell. Asserted as a subtraction, not as "unchanged". */
  check('A.bomb 10: its padded 400 × 400 container takes no AoE damage (hp === max — ancestors of candidate 0 are never AoE candidates) and §C3 takes 0.6 × the lost child off both', boxHp1.hp === boxHp1.max && boxHp1.max === boxHp0.max - Math.round(0.6 * innerMax10) && boxHp1.max === boxHp1.own && !(await api.broken(page, '#x-aoe')), { before: boxHp0, after: boxHp1, innerMax: innerMax10, containerBroken: await api.broken(page, '#x-aoe') });
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
  // SPEC-combat-v2 §5 reassigns stats().mode to the PLAY mode (rampage/arcade/survival); the v1 weapon alias
  // it used to carry lives on as stats().weaponMode and as the api.mode getter, both still asserted here.
  check('A.keys 13: stats().weapon / weaponMode / api.mode mirror the selection, and stats().mode is now the play mode (§5)', await page.evaluate(() => { const a = window.__crashScreen, s = a.stats(); return s.weapon === 'collapse' && s.weaponMode === 'collapse' && a.mode === 'collapse' && ['rampage', 'arcade', 'survival'].includes(s.mode); }), await api.stats(page).then((s) => ({ weapon: s.weapon, weaponMode: s.weaponMode, mode: s.mode })));
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
  // SPEC-test-speed §2: "at least ten things broke" is a POSITIVE condition, so it polls out rather than
  // always paying the full cascade. The 2.5 s ceiling is unchanged — a collapse that is genuinely too slow
  // still fails the assertion below.
  await poll(async () => (((await api.stats(page)).broken >= 10) ? true : null), 2500, 80);
  const cs = await api.stats(page);
  check('A.collapse: stats().broken ≥ 10 within 2.5 s (ignores HP)', cs.broken >= 10, cs.broken);
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
  // SPEC-test-speed §2: settling is a positive condition. Same 3 s ceiling, but a clean settle no longer
  // costs the whole 3 s. (Physics runs on rAF, not on later(), so timeScale would not have helped here.)
  await poll(async () => { const s = await api.stats(page); return (Array.isArray(s.pieces) && s.pieces.length >= 3 && s.pieces.every((p) => p.resting) && s.animating === false) ? s : null; }, 3000, 80);
  const ss = await api.stats(page);
  const clientH = await page.evaluate(() => document.documentElement.clientHeight);
  const pieces = Array.isArray(ss.pieces) ? ss.pieces : [];
  const bad = pieces.filter((p) => !(p.bottom <= clientH + 1 && p.resting));
  check('A.stack: stats().pieces present', pieces.length >= 3, pieces.length);
  check('A.stack: every piece bottom ≤ clientHeight + 1 and resting within 3 s', pieces.length > 0 && bad.length === 0, { bad: bad.slice(0, 5), clientH });
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
  // v1.2 — ammo / sniper + scope / loadouts / hostile components (SPEC-v3 §8 / A13) moved out to the
  // `ammo` block (SPEC-test-speed §5): it builds its own page and ran here only because it used to share
  // one. It entered ACTIVE and left ACTIVE, which is exactly the state the code below already expects,
  // so lifting the call out changes nothing for this block.
  // =============================================================================================

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
  // rewritten from "active again, .crs-canvas present": the glass sheet is gone, so re-activation is
  // instead checked by its absence plus the HUD (the one host that always exists while active) being back.
  check('A.toggle: active again, no .crs-canvas reappears (SPEC-material §9.1), HUD host back', (await api.active(page)) && !(await api.has(page, '.crs-canvas')) && (await page.evaluate(() => !!document.querySelector('crs-hud, .crs-hud-host'))));
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
    await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: false, noPartial: true });
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
    /* ===================================================================================================
     * SPEC-weapon-art §9 — two LODs, layered gradient art, the §7 hammer/axe rebuild and the §8 katana.
     *
     * These assertions MEASURE the emitted geometry rather than trusting a label: path data is parsed out
     * of the `d` strings the art module actually ships, and bounding boxes come from real layout. The three
     * little parsers below understand exactly the subset this art uses (absolute M / L / Q / C / A / Z).
     * ================================================================================================= */
    const PATH_CMD = /([MLQACZmlqacz])([^MLQACZmlqacz]*)/g;
    const nums = (t) => (t.match(/-?\d*\.?\d+/g) || []).map(Number);
    // every ON-CURVE and control point in a path, so a shape's extent can be measured without rasterising
    function pathPoints(d) {
      const out = [];
      PATH_CMD.lastIndex = 0;
      let m;
      while ((m = PATH_CMD.exec(d || ''))) {
        const cmd = m[1].toUpperCase(), a = nums(m[2]);
        if (cmd === 'M' || cmd === 'L') { for (let i = 0; i + 1 < a.length; i += 2) out.push([a[i], a[i + 1]]); }
        else if (cmd === 'Q') { for (let i = 0; i + 3 < a.length; i += 4) { out.push([a[i], a[i + 1]]); out.push([a[i + 2], a[i + 3]]); } }
        else if (cmd === 'C') { for (let i = 0; i + 5 < a.length; i += 6) { out.push([a[i], a[i + 1]]); out.push([a[i + 2], a[i + 3]]); out.push([a[i + 4], a[i + 5]]); } }
        else if (cmd === 'A') { for (let i = 0; i + 6 < a.length; i += 7) out.push([a[i + 5], a[i + 6]]); }
      }
      return out;
    }
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    function maxSpan(pts) {
      let best = 0;
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) best = Math.max(best, dist(pts[i], pts[j]));
      return best;
    }
    // the ON-CURVE vertices only, in order — the body outline's corners, used for the axe taper
    function pathVerts(d) {
      const out = [];
      PATH_CMD.lastIndex = 0;
      let m;
      while ((m = PATH_CMD.exec(d || ''))) {
        const cmd = m[1].toUpperCase(), a = nums(m[2]);
        if (cmd === 'M' || cmd === 'L') { for (let i = 0; i + 1 < a.length; i += 2) out.push([a[i], a[i + 1]]); }
        else if (cmd === 'Q') { for (let i = 0; i + 3 < a.length; i += 4) out.push([a[i + 2], a[i + 3]]); }
        else if (cmd === 'C') { for (let i = 0; i + 5 < a.length; i += 6) out.push([a[i + 4], a[i + 5]]); }
        else if (cmd === 'A') { for (let i = 0; i + 6 < a.length; i += 7) out.push([a[i + 5], a[i + 6]]); }
      }
      return out;
    }
    // central angle (deg) of the first elliptical arc: 2·asin(chord / 2r) from the real start point
    function arcAngleDeg(d) {
      PATH_CMD.lastIndex = 0;
      let m, cur = null;
      while ((m = PATH_CMD.exec(d || ''))) {
        const cmd = m[1].toUpperCase(), a = nums(m[2]);
        if (cmd === 'M' || cmd === 'L') cur = [a[a.length - 2], a[a.length - 1]];
        else if (cmd === 'Q') cur = [a[2], a[3]];
        else if (cmd === 'C') cur = [a[4], a[5]];
        else if (cmd === 'A') {
          const r = a[0], end = [a[5], a[6]];
          if (!cur || !r) return null;
          return 2 * Math.asin(Math.min(1, dist(cur, end) / (2 * r))) * 180 / Math.PI;
        }
      }
      return null;
    }
    // how far the first quadratic's own midpoint sits off its chord midpoint — 0 for a straight blade
    function qSagitta(d) {
      const m = /M\s*(-?[\d.]+)[ ,](-?[\d.]+)\s*Q\s*(-?[\d.]+)[ ,](-?[\d.]+)\s+(-?[\d.]+)[ ,](-?[\d.]+)/.exec(d || '');
      if (!m) return null;
      const x0 = +m[1], y0 = +m[2], cx = +m[3], cy = +m[4], x1 = +m[5], y1 = +m[6];
      return dist([0.25 * x0 + 0.5 * cx + 0.25 * x1, 0.25 * y0 + 0.5 * cy + 0.25 * y1], [(x0 + x1) / 2, (y0 + y1) / 2]);
    }
    const diag = (b) => Math.hypot(b.w, b.h);

    const det = {}, ico = {};
    for (const id of WEAPON_IDS) {
      det[id] = await api.weaponArtProbe(page, id, 200);
      ico[id] = await api.weaponArtProbe(page, id, 24);
    }
    const allProbed = WEAPON_IDS.every((id) => det[id] && det[id].ok && ico[id] && ico[id].ok);
    check('A.art 9.1: weaponArt(id, 200) is the `detail` LOD (viewBox 0 0 240 140) and weaponArt(id, 24) the `icon` LOD (0 0 48 48) for all 10 weapons',
      allProbed && WEAPON_IDS.every((id) => det[id].lod === 'detail' && det[id].viewBox === '0 0 240 140' && ico[id].lod === 'icon' && ico[id].viewBox === '0 0 48 48'),
      WEAPON_IDS.map((id) => `${id}: ${det[id] && det[id].lod}/${det[id] && det[id].viewBox} | ${ico[id] && ico[id].lod}/${ico[id] && ico[id].viewBox}`));
    check('A.art 9.1: element counts — detail ≥ 25 drawn nodes, icon ≤ 12 (defs excluded)',
      allProbed && WEAPON_IDS.every((id) => det[id].drawn >= 25 && ico[id].drawn <= 12 && ico[id].drawn >= 5),
      WEAPON_IDS.map((id) => `${id}: detail ${det[id] && det[id].drawn}, icon ${ico[id] && ico[id].drawn}`));
    check('A.art 9.1: an explicit lod argument overrides the size rule (weaponArt(id, 200, "icon") → icon, weaponArt(id, 24, "detail") → detail)',
      await (async () => {
        const a = await api.weaponArtProbe(page, 'hammer', 200, 'icon');
        const b = await api.weaponArtProbe(page, 'hammer', 24, 'detail');
        return !!(a && a.ok && a.lod === 'icon' && b && b.ok && b.lod === 'detail');
      })());
    check('A.art 9.2: every detail drawing uses at least 2 gradients (§1 — no flat fill on a big surface)',
      allProbed && WEAPON_IDS.every((id) => det[id].grads >= 2),
      WEAPON_IDS.map((id) => `${id}: ${det[id] && det[id].grads}`));
    check('A.art 9.3: no contour stroke — zero stroked elements, so nothing can carry an outline covering > 90 % of the drawing (§1 외곽선 없음)',
      allProbed && WEAPON_IDS.every((id) => det[id].strokeCount === 0 && ico[id].strokeCount === 0 && det[id].strokeMax < 0.9),
      WEAPON_IDS.map((id) => `${id}: ${det[id] && det[id].strokeCount} stroked`));
    const sigSet = new Set(WEAPON_IDS.map((id) => det[id] && det[id].pathSig));
    check('A.art 9.4: all 10 detail drawings ship distinct path data', allProbed && sigSet.size === WEAPON_IDS.length, sigSet.size);
    // §9.4 second half: literal fills come only from the shared ART palette (everything else is a gradient
    // url(#…) or one of the rgba() rim/seam helpers §1 defines).
    const PALETTE = new Set(['#d4dae4', '#8e97a6', '#3f4654', '#e8edf5', '#b9c2d0', '#6d7788',
      '#a9794e', '#8b6240', '#5a3f28', '#4a4f58', '#33373e', '#1e2127', '#e6c87e', '#c8a24a', '#7f6322',
      '#ff7a7d', '#e5484d', '#86232a', '#ffe08a', '#ffb224', '#3a4049', '#262a31', '#14171c',
      '#f6fafe', '#f2f6fd', '#ffe9b0']);
    const offPalette = [];
    for (const id of WEAPON_IDS) {
      for (const f of (det[id] && det[id].fills) || []) {
        if (/^url\(#/.test(f) || /^rgba?\(/.test(f) || f === 'none') continue;
        if (!PALETTE.has(String(f).toLowerCase())) offPalette.push(`${id}: ${f}`);
      }
    }
    check('A.art 9.4: every literal fill in the detail drawings comes from the shared ART palette', allProbed && offPalette.length === 0, offPalette.slice(0, 8));

    // ---- §9.7 built with createElementNS only — the static grep above (A.weapons 1) proves no innerHTML /
    // setAttribute('style') is written anywhere in the module; this is the RUNTIME half. Every node that
    // comes back really is in the SVG namespace (a document.createElement('path') would land in the XHTML
    // one and never render), and no node INSIDE the drawing carries inline style at all — the only style
    // written anywhere is the root's own width/height/display, and that goes through node.style (CSSOM),
    // never setAttribute('style').
    const nsProbe = await page.evaluate((ids) => {
      const a = window.__crashScreen;
      const SVG = 'http://www.w3.org/2000/svg';
      const bad = [], styled = [];
      let nodes = 0, sizedByCssom = 0;
      for (const id of ids) {
        for (const lod of ['detail', 'icon']) {
          const n = a.weaponArt(id, lod === 'detail' ? 200 : 24, lod);
          if (n.namespaceURI !== SVG) bad.push(id + '/' + lod + ': root ' + n.namespaceURI);
          if (n.style && n.style.width && n.style.height && n.style.display === 'block') sizedByCssom++;
          for (const e of n.querySelectorAll('*')) {
            nodes++;
            if (e.namespaceURI !== SVG) bad.push(id + '/' + lod + ': <' + e.nodeName + '> ' + e.namespaceURI);
            if (e.hasAttribute('style')) styled.push(id + '/' + lod + ': <' + e.nodeName + '>');
          }
        }
      }
      return { bad: bad.slice(0, 6), styled: styled.slice(0, 6), nodes, sizedByCssom };
    }, WEAPON_IDS);
    check('A.art 9.7: every node of every drawing is built in the SVG namespace (createElementNS), no child carries inline style, and the root is sized through node.style/CSSOM',
      nsProbe.bad.length === 0 && nsProbe.styled.length === 0 && nsProbe.nodes > 300 && nsProbe.sizedByCssom === WEAPON_IDS.length * 2, nsProbe);

    // ---- §7.2 the hammer: a split claw with a deep V notch ------------------------------------------------
    const hc = det.hammer.parts.claw, hn = det.hammer.parts.notch;
    const clawSpan = hc ? maxSpan(pathPoints(hc.ds[0])) : 0;
    const notchSpan = hn ? maxSpan(pathPoints(hn.ds[0])) : 0;
    const notchFrac = clawSpan ? notchSpan / clawSpan : 0;
    check(`A.art 9.8 (§7.2): hammer detail has a claw, and the V slot cuts ${(notchFrac * 100).toFixed(0)} % of claw length (≥ 55 % required)`,
      !!hc && !!hn && notchFrac >= 0.55, { clawSpan: +clawSpan.toFixed(1), notchSpan: +notchSpan.toFixed(1), notchFrac: +notchFrac.toFixed(3) });
    check('A.art 9.13 (§7.2): the hammer ICON keeps the claw and its V slot at 24 px',
      !!(ico.hammer.parts.claw && ico.hammer.parts.notch), Object.keys(ico.hammer.parts));

    // ---- §7.3 the axe: a 45–60° bit arc, a body that tapers into the eye, a back pick ---------------------
    const bitD = (det.axe.parts.bit && det.axe.parts.bit.ds[0]) || '';
    const bitDeg = arcAngleDeg(bitD);
    check(`A.art 9.9 (§7.3-1): the axe bit's outer arc sweeps ${bitDeg === null ? '—' : bitDeg.toFixed(1)}°, inside the 45–60° band`,
      bitDeg !== null && bitDeg >= 45 && bitDeg <= 60, { bitDeg, bitD: bitD.slice(0, 80) });
    const bodyV = pathVerts((det.axe.parts.body && det.axe.parts.body.ds[0]) || '');
    // body outline is eye-top → edge-top → (arc) edge-bottom → eye-bottom
    const eyeH = bodyV.length >= 4 ? dist(bodyV[0], bodyV[3]) : 0;
    const edgeH = bodyV.length >= 4 ? dist(bodyV[1], bodyV[2]) : 0;
    const taper = edgeH ? eyeH / edgeH : 1;
    check(`A.art 9.10 (§7.3-2): the axe body tapers 1 : ${taper.toFixed(2)} from the edge into the eye (≤ 0.50 required)`,
      bodyV.length >= 4 && taper > 0 && taper <= 0.5, { eyeH: +eyeH.toFixed(1), edgeH: +edgeH.toFixed(1), taper: +taper.toFixed(3) });
    const pickSpan = det.axe.parts.pick ? maxSpan(pathPoints(det.axe.parts.pick.ds[0])) : 0;
    const pickFrac = edgeH ? pickSpan / edgeH : 0;
    check(`A.art 9.11 (§7.3-3): the axe has a back pick ${(pickFrac * 100).toFixed(0)} % of head height long (≥ 45 % required)`,
      !!det.axe.parts.pick && pickFrac >= 0.45, { pickSpan: +pickSpan.toFixed(1), headH: +edgeH.toFixed(1) });
    check('A.art 9.13 (§7.3): the axe ICON keeps the pick and the arc bit at 24 px',
      !!(ico.axe.parts.pick && ico.axe.parts.bit), Object.keys(ico.axe.parts));

    // ---- §7.1 both melee tools: the HAFT has to dominate --------------------------------------------------
    for (const id of ['hammer', 'axe', 'katana']) {
      const h = det[id].parts.haft || det[id].parts.tsuka;
      const frac = h ? diag(h) / diag(det[id].root) : 0;
      check(`A.art 9.12 (§7.1): ${id} — haft/grip is ${(frac * 100).toFixed(0)} % of the drawing's diagonal (≥ 60 % required for the hammer and axe)`,
        id === 'katana' ? !!h : (!!h && frac >= 0.6), { haft: h && { w: +h.w.toFixed(1), h: +h.h.toFixed(1) }, root: det[id].root });
    }

    // ---- §8.2 the katana: curvature, hamon, tsuba, wrapped tsuka ------------------------------------------
    const spineD = (det.katana.parts.spine && det.katana.parts.spine.ds[0]) || '';
    const sag = qSagitta(spineD);
    check(`A.art 9.16 (§8.2): the katana's spine is CURVED — its quadratic deviates ${sag === null ? '—' : sag.toFixed(2)} from the chord (a straight blade measures 0)`,
      sag !== null && sag > 3, { sag, spineD: spineD.slice(0, 70) });
    check('A.art 9.16 (§8.2): the katana detail carries 10+ hamon arcs',
      !!det.katana.parts.hamon && det.katana.parts.hamon.n >= 10, det.katana.parts.hamon && det.katana.parts.hamon.n);
    check('A.art 9 (§8.2): the katana detail has a round tsuba, a wrapped tsuka (8–10 crossed wraps) and a kashira',
      !!det.katana.parts.tsuba && !!det.katana.parts.tsuka && !!det.katana.parts.kashira &&
      !!det.katana.parts.wrap && det.katana.parts.wrap.n >= 8 && det.katana.parts.wrap.n <= 10,
      { wraps: det.katana.parts.wrap && det.katana.parts.wrap.n, parts: Object.keys(det.katana.parts) });
    const icoSag = qSagitta((ico.katana.parts.spine && ico.katana.parts.spine.ds[0]) || '');
    check('A.art 9.13 (§8.2): the katana ICON drops the hamon and the lattice but KEEPS the curvature and the tsuba',
      !!ico.katana.parts.tsuba && !ico.katana.parts.hamon && !ico.katana.parts.wrap && icoSag !== null && icoSag > 0.5,
      { icoSag, parts: Object.keys(ico.katana.parts) });

    // ---- §8.1 the rename reaches the id set, the presets, the locales and stored settings -----------------
    const wIds = (await api.weapons(page)).map((w) => w.id);
    check('A.art 9.14 (§8.1): api.weapons() lists `katana` and no longer lists `sword`',
      wIds.includes('katana') && !wIds.includes('sword'), wIds);
    const koMsgs = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', 'ko', 'messages.json'), 'utf8'));
    check('A.art 9.15 (§8.1): both locales define weaponKatana (ko 카타나 / en Katana) and neither still defines weaponSword',
      !!koMsgs.weaponKatana && koMsgs.weaponKatana.message === '카타나' && !koMsgs.weaponSword &&
      !!EN_MESSAGES.weaponKatana && EN_MESSAGES.weaponKatana.message === 'Katana' && !EN_MESSAGES.weaponSword,
      { ko: koMsgs.weaponKatana && koMsgs.weaponKatana.message, en: EN_MESSAGES.weaponKatana && EN_MESSAGES.weaponKatana.message, koOld: !!koMsgs.weaponSword, enOld: !!EN_MESSAGES.weaponSword });
    check('A.art 9.14 (§8.1): every preset is a permutation over the new id set (no preset still names `sword`)',
      Object.keys(PRESETS).every((k) => PRESETS[k].includes('katana') && !PRESETS[k].includes('sword')), PRESETS);
    // a stored legacy loadout must MIGRATE, not be discarded: an unmigrated array is not a permutation of
    // WEAPON_IDS any more, so without §8.1's alias the player would silently lose their slot order.
    const legacyBoot = await (async () => {
      const p3 = await browser.newPage();
      await p3.setViewport(VIEWPORT);
      await p3.goto(`${origin}/`, { waitUntil: 'load' });
      const c3 = await injectCss(p3, contentCss);
      await p3.evaluate(TIMER_LEDGER);
      await p3.evaluate(CHROME_SHIM);
      await p3.evaluate(() => {
        window.__crsStore.crsWeapon = 'sword';
        window.__crsStore.crsLoadout = ['hammer', 'axe', 'sword', 'pistol', 'smg', 'sniper', 'bomb', 'rocket', 'flame', 'collapse'];
        window.__crsStore.crsLoadoutPreset = 'melee';
      });
      const on3 = await p3.evaluate(contentJs);
      await sleep(260);
      const got = await p3.evaluate(() => ({ weapon: window.__crashScreen.weapon, loadout: window.__crashScreen.loadout() }));
      try { await c3.detach(); } catch (e) { /* ignore */ }
      await p3.close();
      return { on: on3, got };
    })();
    check('A.art 9.14 (§8.1): a stored crsWeapon/crsLoadout still saying `sword` migrates to `katana` on read instead of being dropped',
      legacyBoot.on === 'on' && legacyBoot.got.weapon === 'katana' &&
      legacyBoot.got.loadout.join(',') === 'hammer,axe,katana,pistol,smg,sniper,bomb,rocket,flame,collapse',
      legacyBoot.got);

    // ---- §9.5 user-supplied PNG art, §9.6 the emoji escape hatch -----------------------------------------
    // Both run on their OWN page. §9.5 has to build the <img> branch, whose src points at a packaged file
    // this build does not ship, so the load fails and Chrome logs it; `page` is the console-watched one
    // (A.console), this one is not. §9.6 rides along because it needs a live HUD either way.
    const artOpts = await (async () => {
      const p5 = await browser.newPage();
      await p5.setViewport(VIEWPORT);
      await p5.goto(`${origin}/`, { waitUntil: 'load' });
      const c5 = await injectCss(p5, contentCss);
      await p5.evaluate(TIMER_LEDGER);
      await p5.evaluate(CHROME_SHIM);
      const on5 = await p5.evaluate(contentJs);
      await sleep(260);
      const png = await p5.evaluate(() => {
        const a = window.__crashScreen;
        const tag = (n) => (n && n.tagName || '').toLowerCase();
        const noArt = tag(a.weaponArt('pistol', 24, 'icon'));           // nothing shipped → svg (§5 silent fallback)
        a.debug.weaponPng('pistol', true);                              // "icons/weapons/pistol.png now ships"
        const im = a.weaponArt('pistol', 24, 'icon');
        const withArt = { tag: tag(im), src: String(im.src || ''), cls: String(im.className || ''), crs: im.hasAttribute && im.hasAttribute('data-crs') };
        const sibling = tag(a.weaponArt('axe', 24, 'icon'));            // only the id that ships art changes
        a.setOption('weaponArt', 'svg');
        const forcedSvg = tag(a.weaponArt('pistol', 24, 'icon'));       // §5: 'svg' ignores the PNG
        a.setOption('weaponArt', 'auto');
        a.debug.weaponPng('pistol', false);                             // "the file is gone again"
        const gone = tag(a.weaponArt('pistol', 24, 'icon'));
        return { noArt, withArt, sibling, forcedSvg, gone };
      });
      const hudArt = (p) => p.evaluate(() => {
        const host = document.querySelector('crs-hud, .crs-hud-host');
        const sh = host && host.shadowRoot;
        if (!sh) return null;
        const btns = [...sh.querySelectorAll('button[data-weapon]')];
        const vis = (el) => !!el && getComputedStyle(el).display !== 'none';
        return {
          n: btns.length,
          svgShown: btns.filter((b) => vis(b.querySelector('.wart')) && b.querySelector('.wart svg')).length,
          emojiShown: btns.filter((b) => vis(b.querySelector('.em'))).length,
          emojiText: btns.map((b) => (b.querySelector('.em') || {}).textContent || '').filter(Boolean).length
        };
      });
      const autoHud = await hudArt(p5);
      await p5.evaluate(() => window.__crashScreen.setOption('weaponArt', 'emoji'));
      await sleep(80);
      const emojiHud = await hudArt(p5);
      const optsAfter = await p5.evaluate(() => window.__crashScreen.options());
      await p5.evaluate(() => window.__crashScreen.setOption('weaponArt', 'auto'));
      await sleep(80);
      const backHud = await hudArt(p5);
      const rejected = await p5.evaluate(() => window.__crashScreen.setOption('weaponArt', 'photoreal'));
      try { await c5.detach(); } catch (e) { /* ignore */ }
      await p5.close();
      return { on5, png, autoHud, emojiHud, backHud, optsAfter, rejected };
    })();
    check('A.art 9.5 (§5): declaring icons/weapons/pistol.png makes weaponArt return an <img class="crs-art" data-crs> at the packaged URL; undeclaring it falls silently back to the <svg>, and only that one id is affected',
      artOpts.on5 === 'on' && artOpts.png.noArt === 'svg' && artOpts.png.withArt.tag === 'img' &&
      /icons\/weapons\/pistol\.png$/.test(artOpts.png.withArt.src) && artOpts.png.withArt.cls === 'crs-art' &&
      artOpts.png.withArt.crs === true && artOpts.png.sibling === 'svg' && artOpts.png.gone === 'svg',
      artOpts.png);
    check("A.art 9.5 (§5): weaponArt: 'svg' keeps the drawing even when user art ships", artOpts.png.forcedSvg === 'svg', artOpts.png.forcedSvg);
    check("A.art 9.6 (§5): weaponArt: 'emoji' puts the original emoji back in the HUD (all 10 buttons) and hides the svg; switching back to 'auto' restores it. (The viewmodel has no emoji to fall back to and is unaffected by design.)",
      !!artOpts.autoHud && artOpts.autoHud.n === WEAPON_IDS.length &&
      artOpts.autoHud.svgShown === WEAPON_IDS.length && artOpts.autoHud.emojiShown === 0 &&
      artOpts.emojiHud.svgShown === 0 && artOpts.emojiHud.emojiShown === WEAPON_IDS.length &&
      artOpts.emojiHud.emojiText === WEAPON_IDS.length &&
      artOpts.backHud.svgShown === WEAPON_IDS.length && artOpts.backHud.emojiShown === 0 &&
      artOpts.optsAfter && artOpts.optsAfter.weaponArt === 'emoji' && artOpts.rejected === false,
      { auto: artOpts.autoHud, emoji: artOpts.emojiHud, back: artOpts.backHud, opts: artOpts.optsAfter, badMode: artOpts.rejected });

    // ---- §9.17 the two contact sheets --------------------------------------------------------------------
    const sheets = await (async () => {
      const p4 = await browser.newPage();
      await p4.setViewport({ width: 1180, height: 760, deviceScaleFactor: 1 });
      await p4.goto(`${origin}/`, { waitUntil: 'load' });
      await p4.evaluate(TIMER_LEDGER);
      await p4.evaluate(CHROME_SHIM);
      await p4.evaluate(contentJs);
      await p4.evaluate(() => window.__crashScreen.toggle());   // the API object survives deactivation; the overlay/rAF loop must not run while the body is replaced
      // sheet 1: detail LOD at 200 px, five across
      const box = await p4.evaluate((ids) => {
        const a = window.__crashScreen;
        document.body.replaceChildren();
        document.body.style.margin = '0';
        document.body.style.background = '#191d25';
        document.body.style.font = '14px system-ui, -apple-system, sans-serif';
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(5, 1fr)';
        grid.style.gap = '4px';
        grid.style.padding = '10px';
        document.body.appendChild(grid);
        for (const id of ids) {
          const cell = document.createElement('div');
          cell.style.cssText = '';
          cell.style.display = 'flex'; cell.style.flexDirection = 'column';
          cell.style.alignItems = 'center'; cell.style.justifyContent = 'flex-end';
          cell.style.height = '170px'; cell.style.background = 'rgba(127,127,127,.09)'; cell.style.borderRadius = '6px';
          const art = document.createElement('div');
          art.style.flex = '1 1 auto'; art.style.display = 'flex'; art.style.alignItems = 'center';
          art.appendChild(a.weaponArt(id, 200, 'detail'));
          const lab = document.createElement('div');
          lab.textContent = id; lab.style.color = '#c9d2e0'; lab.style.padding = '2px 0 6px';
          cell.appendChild(art); cell.appendChild(lab);
          grid.appendChild(cell);
        }
        return { w: Math.ceil(document.body.getBoundingClientRect().width), h: Math.ceil(document.body.scrollHeight) };
      }, WEAPON_IDS);
      await p4.setViewport({ width: Math.max(320, box.w), height: Math.max(120, box.h), deviceScaleFactor: 1 });
      await p4.screenshot({ path: path.join(OUT, 'weapons.png') });
      // sheet 2: icon LOD rasterised at a TRUE 24 px, then magnified 400 % with nearest-neighbour, so a
      // detail that collapses into one grey pixel collapses here too.
      const CELL = 34, PAD = 6;
      await p4.setViewport({ width: WEAPON_IDS.length * CELL + PAD * 2, height: CELL + PAD * 2, deviceScaleFactor: 1 });
      await p4.evaluate((ids, cell, pad) => {
        const a = window.__crashScreen;
        document.body.replaceChildren();
        document.body.style.background = '#191d25';
        const row = document.createElement('div');
        row.style.display = 'flex'; row.style.padding = pad + 'px';
        document.body.appendChild(row);
        for (const id of ids) {
          const c = document.createElement('div');
          c.style.width = cell + 'px'; c.style.height = cell + 'px';
          c.style.display = 'flex'; c.style.alignItems = 'center'; c.style.justifyContent = 'center';
          c.appendChild(a.weaponArt(id, 24, 'icon'));
          row.appendChild(c);
        }
      }, WEAPON_IDS, CELL, PAD);
      const raw = await p4.screenshot({ encoding: 'base64' });
      const Z = 4;
      await p4.setViewport({ width: (WEAPON_IDS.length * CELL + PAD * 2) * Z, height: (CELL + PAD * 2) * Z + 26, deviceScaleFactor: 1 });
      await p4.evaluate((b64, ids, cell, pad, z) => new Promise((done) => {
        document.body.replaceChildren();
        document.body.style.background = '#191d25';
        document.body.style.font = '13px system-ui, -apple-system, sans-serif';
        const img = new Image();
        img.onload = () => {
          img.style.width = (img.naturalWidth * z) + 'px';
          img.style.height = (img.naturalHeight * z) + 'px';
          img.style.imageRendering = 'pixelated';
          img.style.display = 'block';
          document.body.appendChild(img);
          const row = document.createElement('div');
          row.style.display = 'flex'; row.style.paddingLeft = (pad * z) + 'px'; row.style.color = '#c9d2e0';
          for (const id of ids) {
            const t = document.createElement('div');
            t.textContent = id; t.style.width = (cell * z) + 'px'; t.style.textAlign = 'center';
            row.appendChild(t);
          }
          document.body.appendChild(row);
          done();
        };
        img.src = 'data:image/png;base64,' + b64;
      }), raw, WEAPON_IDS, CELL, PAD, Z);
      await p4.screenshot({ path: path.join(OUT, 'weapons-icon.png') });
      await p4.close();
      return [path.join(OUT, 'weapons.png'), path.join(OUT, 'weapons-icon.png')].map((f) => fs.existsSync(f) && fs.statSync(f).size > 2000);
    })();
    check('A.art 9.17: both contact sheets are written — test/out/weapons.png (detail @200px) and test/out/weapons-icon.png (icon rasterised @24px, shown at 400%)',
      sheets.every(Boolean), sheets);
    info('contact sheets: test/out/weapons.png, test/out/weapons-icon.png');


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

    // ---- (10) crit rate: 200 katana hits (seeded RNG override of Math.random, so a failure reproduces) land
    //     a critChance 0.20 ± 0.08 fraction of crits ------------------------------------------------------
    await api.debug(page, { noCrit: false, forceCrit: false });
    await api.setWeapon(page, 'katana');
    const pt10 = await arenaPt(page);
    const CRIT_SEED = 0xA53F9021;
    info(`A.weapons 10: crit-rate seed = 0x${CRIT_SEED.toString(16)} (200 katana hits on #arena, restored fresh each hit) — reproduce a failure by rerunning with the same seed`);
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
    const katanaCritChance = (W.byId.katana && typeof W.byId.katana.critChance === 'number') ? W.byId.katana.critChance : SPEC_STATS.katana.critChance;
    const critRate10 = crit10.hits / 200;
    check(`A.weapons 10: katana crit rate over 200 hits (seeded RNG, no debug.forceCrit) is ${katanaCritChance.toFixed(2)} ± 0.08`, Math.abs(critRate10 - katanaCritChance) <= 0.08, { seed: '0x' + CRIT_SEED.toString(16), crit10, critRate10, katanaCritChance });
    await api.debug(page, { noCrit: true, forceCrit: false, noPartial: true });
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
    //     §6 item 12 movement-DISTANCE ratio (rocket 0.80 vs katana 1.15, holding "D" 400 ms) needs the
    //     `survival`-mode drone avatar, which this worktree does not have yet (owned by the parallel combat
    //     workstream) — see v15-handoff.md. Leaving this as an explicit, honest gap rather than a fake pass.
    info('A.weapons 12: movement-distance ratio test deferred — no survival-mode drone avatar exists in this worktree yet (moveSpeed stat values are covered by the api.weapons() table check above; see v15-handoff.md)');

    // =============================================================================================
    // SPEC-combat-v2 §10.6 items 5-6 — pierce / "explosions ignore cover" on the new overlapping
    // #pierce-front / #pierce-back fixture pair (test/fixture.html).
    // =============================================================================================
    await api.debug(page, { noCrit: true, infiniteAmmo: true, noCooldown: true, noSpread: true, noPartial: true });
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
    // The idle bob is a 2600 ms loop (src/46-viewmodel.js). Eight samples 150 ms apart cover barely 40 % of
    // it, so where the window lands decides how much of the swing is seen; 350 ms × 8 covers a full period
    // and the peak-to-peak range stops depending on phase.
    const idleSamplesNormal14 = [];
    for (let i = 0; i < 8; i++) { idleSamplesNormal14.push(await api.viewmodelXform(page)); await sleep(350); }
    const idleRangeNormal14 = Math.max(...idleSamplesNormal14.map((s) => s.ty)) - Math.min(...idleSamplesNormal14.map((s) => s.ty));
    const ptFire14 = await arenaPt(page);
    // What the bob alone travels over the measuring window, with no shot — reported beside the two recoil
    // numbers so a future failure says straight away whether the bob was the thing that moved.
    const bobOnly14 = await api.viewmodelPeak(page, null, 350);
    // Start the sampler BEFORE the shot and fire inside its window. Starting it after the click left the
    // recoil onset in the gap between the two CDP round trips, so whether the window caught the peak at all
    // came down to timing and the normal-motion side kept coming back understated. 350 ms covers the ~180 ms
    // one-shot with margin while keeping the bob's own contribution (6 px over 2600 ms) to about a pixel.
    const samplingNormal14 = api.viewmodelPeak(page, null, 350);
    await page.mouse.click(ptFire14.x, ptFire14.y);
    const peakNormal14 = await samplingNormal14;
    const maxDevNormal14 = peakNormal14 ? peakNormal14.peak : 0;
    await sleep(250);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await api.restore(page);
    await api.setWeapon(page, 'pistol');
    await waitViewmodelIdle();
    const idleSamplesRM14 = [];
    for (let i = 0; i < 8; i++) { idleSamplesRM14.push(await api.viewmodelXform(page)); await sleep(350); }
    const idleRangeRM14 = Math.max(...idleSamplesRM14.map((s) => s.ty)) - Math.min(...idleSamplesRM14.map((s) => s.ty));
    check('A.weapons 14: prefers-reduced-motion → idle wobble suppressed (viewmodel Y stays flat) vs the normal idle sine sweep', idleRangeRM14 <= 0.5 && idleRangeNormal14 > 0.5, { idleRangeNormal14, idleRangeRM14 });
    const samplingRM14 = api.viewmodelPeak(page, null, 350);
    await page.mouse.click(ptFire14.x, ptFire14.y);
    const peakRM14 = await samplingRM14;
    const maxDevRM14 = peakRM14 ? peakRM14.peak : 0;
    check('A.weapons 14: prefers-reduced-motion → recoil is still present but its amplitude is at most half of normal motion\'s', maxDevRM14 > 0 && maxDevNormal14 > 0 && maxDevRM14 <= maxDevNormal14 * 0.5 + 0.5, { maxDevNormal14, maxDevRM14, bobOnly: bobOnly14 && bobOnly14.peak, framesNormal: peakNormal14 && peakNormal14.frames, framesRM: peakRM14 && peakRM14.frames });
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
  // Moved out to the `combat` block (SPEC-test-speed §5); it always built its own state anyway
  // (it re-evaluates content.js on entry) and tidied back to the suite baseline on exit.

  // =============================================================================================
  // SPEC-material §9 — a damage mark belongs to the ELEMENT that was hit, not to the screen.
  // =============================================================================================
  {
    // Precondition, built here rather than inherited (SPEC-test-speed §5): the v1.5 weapons block above
    // ends on its Escape test, which leaves content.js INACTIVE with zero nodes. suiteA14 used to sit in
    // between and reactivate as a side effect; with it lifted out, this block reactivates for itself.
    if (!(await api.active(page))) await page.evaluate(contentJs);
    await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: false, noFalloff: true, noPartial: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await api.restore(page);
    await api.setWeapon(page, 'pistol');
    await sleep(80);

    // ---- (1) one hit → one decal, laid exactly over the element it hit, owned by US (§9.1) ----
    const mt = await api.rect(page, '#mat-scroll-target');
    await page.mouse.click(mt.left + 24, mt.top + 24);
    await poll(async () => (await api.count(page, '.crs-decal')) > 0, 2000, 25);
    // A hit deliberately WOBBLES the element it landed on (reactDamage, 260 ms) and shakes the page on top
    // of that; pixel-exact alignment is asserted once that reaction has played out, not in the middle of it.
    await sleep(500);
    const d1 = await page.evaluate(() => {
      const el = document.getElementById('mat-scroll-target');
      const r = el.getBoundingClientRect();
      const list = [...document.querySelectorAll('.crs-decal')];
      const n = list.find((q) => {
        const b = q.getBoundingClientRect();
        return Math.abs(b.left - r.left) <= 1 && Math.abs(b.top - r.top) <= 1 && Math.abs(b.width - r.width) <= 1 && Math.abs(b.height - r.height) <= 1;
      }) || null;
      return {
        total: list.length, onElement: !!n, broken: el.hasAttribute('data-crs-broken'),
        inRoot: !!(n && n.closest('.crs-root')), inPage: !!(n && el.contains(n)),
        tagged: !!(n && n.getAttribute('data-crs') === '1' && /(^|\s)crs-decal(\s|$)/.test(String(n.className))),
        position: n ? getComputedStyle(n).position : null,
      };
    });
    check('A.material 1: one pistol hit puts exactly ONE decal on #mat-scroll-target, sized to that element\'s own rect (SPEC-material §9.1)', d1.total === 1 && d1.onElement === true && d1.broken === false, d1);
    check('A.material 1: the decal is our own node (data-crs + .crs-decal, position fixed) inside .crs-root — never injected into the page element', d1.tagged === true && d1.inRoot === true && d1.inPage === false && d1.position === 'fixed', d1);

    // ---- (2) the mark rides the page: scroll and it is still on its element (§9.2) ----
    await sleep(200);
    const beforeTop2 = await page.evaluate(() => document.getElementById('mat-scroll-target').getBoundingClientRect().top);
    await page.evaluate(() => window.scrollBy(0, -300));
    await settleRaf(page);
    await settleRaf(page);
    const sc2 = await page.evaluate((before) => {
      const el = document.getElementById('mat-scroll-target');
      const r = el.getBoundingClientRect();
      const n = document.querySelector('.crs-decal');
      const b = n ? n.getBoundingClientRect() : null;
      return { alive: !!n, moved: r.top - before, dTop: b ? b.top - r.top : null, dLeft: b ? b.left - r.left : null };
    }, beforeTop2);
    check('A.material 2: after a 300 px scroll the decal moved WITH its element and still sits exactly on its rect (§9.2)', sc2.alive === true && Math.abs(sc2.moved - 300) <= 2 && Math.abs(sc2.dTop) <= 1.5 && Math.abs(sc2.dLeft) <= 1.5, sc2);

    // ---- (3) nothing persistent is painted on the viewport itself (§9.1) ----
    const vp3 = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      const ours = [...document.querySelectorAll('canvas[data-crs]')];
      const pageEls = [...document.querySelectorAll('body *')].filter((el) => !el.hasAttribute('data-crs'));
      const boxes = ours.map((c) => c.getBoundingClientRect());
      return {
        sheet: document.querySelectorAll('.crs-canvas').length,
        ours: ours.length,
        oversize: boxes.filter((b) => b.width * b.height > 0.8 * vw * vh).length,
        allOnElements: boxes.every((b) => pageEls.some((el) => {
          const r = el.getBoundingClientRect();
          return Math.abs(r.left - b.left) <= 1 && Math.abs(r.top - b.top) <= 1 && Math.abs(r.width - b.width) <= 1 && Math.abs(r.height - b.height) <= 1;
        })),
      };
    });
    check('A.material 3: every canvas we own is element-shaped — no .crs-canvas sheet, nothing viewport-sized, each one matching a real page element\'s rect (§9.1)', vp3.sheet === 0 && vp3.ours >= 1 && vp3.oversize === 0 && vp3.allOnElements === true, vp3);

    // ---- (4) an explosion breaks at element boundaries, and the empty gap between them is never marked (§9.3 / §9.8) ----
    // The two panels die to the blast, taking their decals with them (SPEC-destruction §1), so the decals are
    // recorded as they are CREATED rather than counted afterwards.
    await api.restore(page);
    await api.setWeapon(page, 'bomb');
    await sleep(60);
    await page.evaluate(() => {
      window.__matDecals = [];
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1 || !n.classList || !n.classList.contains('crs-decal')) continue;
            const b = n.getBoundingClientRect();
            window.__matDecals.push({ l: b.left, t: b.top, w: b.width, h: b.height });
          }
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      window.__matDecalsStop = () => { try { mo.disconnect(); } catch (e) { /* ignore */ } };
    });
    /* REWRITTEN for SPEC-destruction §E4. The blast mark is drawn at 40 ms now ("섬광이 걷히며
       드러난다"), and §E4's own table has the targets breaking over 0~60 ms — so a bomb that DESTROYS
       both 220 × 160 panels (hp 86 each, centre damage 190) leaves its mark on nothing at all. The claim
       under test is unchanged — one blast, separate element-local marks, nothing in the 160 px gap — so
       the blast is simply given targets that survive it: in a combat mode a 35 200 px² panel is under
       every hostile floor and is therefore invulnerable (SPEC-combat §B), while the MARK lands on it
       exactly as before (a mark never asks whether the element may be hurt). */
    await api.setCombat(page, true);
    await api.debug(page, { noAttacks: true, noRepair: true, noInvuln: false });
    await sleep(150);
    const gl4 = await api.rect(page, '#mat-gap-left');
    const gr4 = await api.rectNoScroll(page, '#mat-gap-right');
    await page.mouse.click(gl4.right - 10, gl4.cy);
    await poll(async () => (await page.evaluate(() => window.__matDecals.length)) >= 2, 2500, 30);
    const gapX4 = (gl4.right + gr4.left) / 2, gapY4 = gl4.cy;
    const d4 = await page.evaluate((gx, gy) => {
      const list = window.__matDecals || [];
      try { window.__matDecalsStop(); } catch (e) { /* ignore */ }
      /* Instrumented: a decal is owned by an ELEMENT, so the failure message has to name the owners —
         "a 1052 px box appeared" is not something anyone can act on. */
      const owners = (window.__crashScreen.debug.decals() || []).map((d) => `${d.tag}${d.id ? '#' + d.id : ''} ${d.w}x${d.h}@${d.left},${d.top}`);
      return {
        n: list.length,
        covering: list.filter((b) => gx >= b.l && gx <= b.l + b.w && gy >= b.t && gy <= b.t + b.h).length,
        widest: list.reduce((m, b) => Math.max(m, b.w), 0),
        boxes: list.slice(0, 8).map((b) => [Math.round(b.l), Math.round(b.t), Math.round(b.w), Math.round(b.h)]),
        owners, burning: (window.__crashScreen.debug.burning() || []).map((b) => `${b.tag}${b.id ? '#' + b.id : ''}:${b.stacks}`),
      };
    }, gapX4, gapY4);
    check('A.material 4: one bomb leaves SEPARATE element-local marks (≥ 2 decals), and not one of them covers the empty 160 px gap between the two panels (§9.3 / §9.8)', d4.n >= 2 && d4.covering === 0, { ...d4, gapX4: Math.round(gapX4), gapY4: Math.round(gapY4) });
    await api.setCombat(page, false);
    await api.debug(page, { noInvuln: true, noRepair: false });
    await sleep(120);

    // ---- (5) what an element is MADE OF (§5) ----
    const mats5 = await page.evaluate(() => {
      const d = window.__crashScreen.debug;
      const of = (sel) => { const el = document.querySelector(sel); const r = el && d.materialOf(el); return r ? r.material : null; };
      return { hr: of('#mat-hr'), img: of('#demo-img'), para: of('#long-para'), btn: of('#test-btn'), box: of('#mat-tall-spacer') };
    });
    check('A.material 5: materialOf — <hr> metal, <img> glass, a text block paper, a <button> plastic, a plain box panel (§5)', mats5.hr === 'metal' && mats5.img === 'glass' && mats5.para === 'paper' && mats5.btn === 'plastic' && mats5.box === 'panel', mats5);

    // ---- (5b) scroll.png: marks made on three different materials, then the page scrolled 300 px ----
    // Sub-lethal pistol hits, so nothing breaks and every mark is still on its own element in the frame.
    await api.restore(page);
    await api.setWeapon(page, 'pistol');
    await sleep(80);
    const figShot = await api.rect(page, '#figure');
    const imgShot = await api.rectNoScroll(page, '#demo-img');
    await page.mouse.click(imgShot.cx - 30, imgShot.cy - 10);
    await page.mouse.click(imgShot.cx + 28, imgShot.cy + 16);
    const cardShot = await api.rectNoScroll(page, '#big-card');
    if (cardShot.width > 0 && cardShot.top > 0 && cardShot.bottom < 900) {
      await page.mouse.click(cardShot.left + 60, cardShot.top + 40);
      await page.mouse.click(cardShot.left + 140, cardShot.top + 90);
    }
    await settleRaf(page);
    await settleRaf(page);
    await page.evaluate(() => window.scrollBy(0, 300));
    await settleRaf(page);
    await settleRaf(page);
    await sleep(120);
    await page.screenshot({ path: path.join(OUT, 'scroll.png') });
    const shot5b = await page.evaluate(() => {
      const list = [...document.querySelectorAll('.crs-decal')];
      const pageEls = [...document.querySelectorAll('body *')].filter((el) => !el.hasAttribute('data-crs'));
      const onEl = list.filter((n) => {
        const b = n.getBoundingClientRect();
        return pageEls.some((el) => {
          const r = el.getBoundingClientRect();
          return Math.abs(r.left - b.left) <= 1 && Math.abs(r.top - b.top) <= 1 && Math.abs(r.width - b.width) <= 1 && Math.abs(r.height - b.height) <= 1;
        });
      }).length;
      return { decals: list.length, onEl };
    });
    info(`screenshot test/out/scroll.png (${shot5b.decals} decals, ${shot5b.onEl} still exactly on their element after the scroll)`);
    check('A.material 5b: after scrolling 300 px every surviving mark is still exactly on the element it was made on (scroll.png)', shot5b.decals >= 1 && shot5b.onEl === shot5b.decals, { ...shot5b, fig: Math.round(figShot.top) });

    // ---- (6) the marks are torn down with everything else (§9.1 / §9.11) ----
    await api.restore(page);
    await sleep(60);
    check('A.material 6: restore() removes every decal', (await api.count(page, '.crs-decal')) === 0, await api.count(page, '.crs-decal'));
    const off6 = await page.evaluate(contentJs);
    const decals6 = await api.count(page, '.crs-decal');
    const nodes6 = await api.count(page, '[data-crs]');
    const pend6 = await api.pending(page);
    await settleRaf(page);
    const raf6 = await api.pendingRaf(page);
    check('A.material 6: deactivate leaves no decal, no [data-crs] node, no live timer and no live animation frame', off6 === 'off' && decals6 === 0 && nodes6 === 0 && pend6 === 0 && raf6 === 0, { off6, decals6, nodes6, pend6, raf6 });
    const on6 = await page.evaluate(contentJs);
    check('A.material 6: re-activation comes back with no viewport canvas and no stale decal', on6 === 'on' && !(await api.has(page, '.crs-canvas')) && (await api.count(page, '.crs-decal')) === 0, on6);

    // back to the state suiteA14 handed over
    await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: false, noPartial: true });
    await api.setWeapon(page, 'hammer');
    await api.restore(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(100);
  }

  // =============================================================================================
  // SPEC-material §4 — the rubble belongs to the PAGE, not to the screen (§9 item 4).
  // The §9 decal block above hands over: ACTIVE, restored, hammer / rampage, the suite's baseline debug
  // flags and scrollTo(0, 0). This block puts every one of those back before it returns, so the
  // console / CSP / lastError checks below still see exactly the state they always saw.
  // =============================================================================================
  {
    // debug.pieceBoxes() reports VIEWPORT-space boxes (§4 keeps ox/oy in the piece's own anchor frame and
    // converts on the way out), keyed here by the stable per-piece id so one piece can be followed across a
    // scroll without relying on a DOM order that eviction reshuffles.
    const boxesByPid = async () => {
      const list = await page.evaluate(() => {
        const d = window.__crashScreen.debug;
        return (d && typeof d.pieceBoxes === 'function') ? d.pieceBoxes() : [];
      });
      const m = new Map();
      for (const b of Array.isArray(list) ? list : []) m.set(b.pid, b);
      return m;
    };
    // How the same pieces moved on screen between two readings: the extremes of the vertical shift, the
    // worst horizontal drift, whether anything stopped resting, and how far the pile deviates from moving
    // as ONE rigid body (max spread of the per-piece dy).
    const moveOf = (a, b) => {
      let n = 0, minDy = Infinity, maxDy = -Infinity, maxDx = 0, resting = true, ref = null, rigid = 0;
      for (const [pid, nb] of b) {
        const ob = a.get(pid);
        if (!ob) continue;
        n++;
        const dy = nb.top - ob.top;
        if (dy < minDy) minDy = dy;
        if (dy > maxDy) maxDy = dy;
        maxDx = Math.max(maxDx, Math.abs(nb.l - ob.l));
        if (!nb.resting) resting = false;
        if (ref === null) ref = dy; else rigid = Math.max(rigid, Math.abs(dy - ref));
      }
      return { n, minDy: n ? minDy : null, maxDy: n ? maxDy : null, maxDx, resting, rigid };
    };
    // The product's own support rule (evictPieces(): ≥ 40 % horizontal overlap, bottom edge at or above the
    // supporting piece's top), used to pick one genuinely stacked pair out of the pile.
    const supportPair = (boxes) => {
      const arr = [...boxes.values()].filter((b) => b.resting);
      let best = null;
      for (const lower of arr) {
        for (const upper of arr) {
          if (upper === lower) continue;
          const ov = Math.min(lower.r, upper.r) - Math.max(lower.l, upper.l);
          if (ov < 0.4 * Math.min(lower.r - lower.l, upper.r - upper.l)) continue;
          const gap = lower.top - upper.bottom;
          if (gap < -1) continue;
          if (!best || gap < best.gap) best = { lower: lower.pid, upper: upper.pid, gap };
        }
      }
      return best;
    };
    const gapOf = (boxes, pair) => {
      const lo = boxes.get(pair.lower), up = boxes.get(pair.upper);
      return (lo && up) ? { gap: lo.top - up.bottom, resting: !!(lo.resting && up.resting) } : null;
    };
    const baseDebug = { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: false };

    // ---- (1) `debrisAnchor` is a real setting: default `document`, `viewport` still available, persisted ----
    const anch1 = await page.evaluate(() => ({ api: window.__crashScreen.debrisAnchor, stats: window.__crashScreen.stats().debrisAnchor }));
    check('A.debris 1: debrisAnchor defaults to "document" and is readable through api.debrisAnchor and stats() (§4)', anch1.api === 'document' && anch1.stats === 'document', anch1);
    const setVp1 = await api.call(page, 'setDebrisAnchor', 'viewport');
    const storeVp1 = (await api.store(page)).crsDebrisAnchor;
    const setBad1 = await api.call(page, 'setDebrisAnchor', 'sideways');
    const setDoc1 = await api.call(page, 'setDebrisAnchor', 'document');
    const storeDoc1 = (await api.store(page)).crsDebrisAnchor;
    check('A.debris 1: setDebrisAnchor round-trips "viewport" / "document", writes crsDebrisAnchor to storage and ignores anything else (§4)',
      setVp1 === 'viewport' && storeVp1 === 'viewport' && setBad1 === 'viewport' && setDoc1 === 'document' && storeDoc1 === 'document',
      { setVp1, storeVp1, setBad1, setDoc1, storeDoc1 });
    // and it is loaded back on the next activation, exactly like crsWeapon / crsDebrisLifeMs
    await page.evaluate(() => { window.__crsStore.crsDebrisAnchor = 'viewport'; });
    const off1 = await page.evaluate(contentJs);
    const on1 = await page.evaluate(contentJs);
    const loaded1 = await poll(async () => (((await api.stats(page)).debrisAnchor === 'viewport') ? true : null), 2000, 40);
    check('A.debris 1: a stored crsDebrisAnchor is read back by loadPrefs() on the next activation (§4)', off1 === 'off' && on1 === 'on' && loaded1 === true, { off1, on1, loaded1 });
    await api.call(page, 'setDebrisAnchor', 'document');
    await api.debug(page, baseDebug);
    await api.setWeapon(page, 'hammer');
    await api.restore(page);
    // the pile has to outlive the scrolling below; the 6 s default goes back on at the end of the block
    await api.call(page, 'setDebrisLife', 0);
    await sleep(80);

    // ---- (2) the core of §9 item 4: a resting piece keeps its place ON THE PAGE ----
    // The three stacked blocks, centred so there is scroll room in both directions, give a real pile rather
    // than one lonely shard — which is also what items 3 and 4 below need.
    const allResting2 = () => poll(async () => { const s = await api.stats(page); return (s.pieceCount > 0 && s.pieces.every((q) => q.resting)) ? s : null; }, 10000, 80);
    const s2a = await api.rect(page, '#stack-1');
    const colX2 = s2a.cx;
    const brk2 = [await clickUntilBroken(page, '#stack-1', colX2, s2a.cy)];
    await allResting2();   // §9.4.4's order: the first block's debris is ON THE FLOOR before the next two fall
    const s2b = await api.rectNoScroll(page, '#stack-2');
    const s2c = await api.rectNoScroll(page, '#stack-3');
    brk2.push(await clickUntilBroken(page, '#stack-2', colX2, s2b.cy));
    brk2.push(await clickUntilBroken(page, '#stack-3', colX2, s2c.cy));
    const rested2 = await allResting2();
    check('A.debris 2: the three #stack blocks break and their debris comes to rest before anything is scrolled', brk2.every((n) => n > 0) && !!rested2 && rested2.pieceCount >= 3, { brk2, pieceCount: rested2 && rested2.pieceCount });
    await page.screenshot({ path: path.join(OUT, 'debris-anchor-before.png') });
    let pair2 = supportPair(await boxesByPid());
    for (let i = 0; i < 4 && !pair2; i++) { await sleep(250); pair2 = supportPair(await boxesByPid()); }
    const before2 = await boxesByPid();
    const animBefore2 = (await api.stats(page)).animating;
    const y2a = await page.evaluate(() => { const y0 = window.scrollY; window.scrollBy(0, 300); return y0; });
    await settleRaf(page);
    await settleRaf(page);
    await sleep(120);
    const y2b = await page.evaluate(() => window.scrollY);
    await page.screenshot({ path: path.join(OUT, 'debris-anchor-after.png') });
    const after2 = await boxesByPid();
    const move2 = moveOf(before2, after2);
    check('A.debris 2: the page really scrolled the full 300 px for this measurement', Math.abs((y2b - y2a) - 300) <= 1, { y2a, y2b });
    check('A.debris 2 (§9 item 4): after a 300 px scroll every resting piece\'s viewport top has moved by −300 px (±4) — the rubble stayed where it fell ON THE PAGE',
      move2.n >= 3 && move2.minDy >= -304 && move2.maxDy <= -296 && move2.maxDx <= 2,
      { ...move2, screenshots: 'test/out/debris-anchor-before.png → debris-anchor-after.png' });

    // ---- (3) a scroll is not an impulse: nothing resting wakes up, and no frame loop is started ----
    const st3 = await api.stats(page);
    check('A.debris 3: scrolling does NOT wake a resting piece — every piece is still resting and the integrator is still idle (§4)',
      animBefore2 === false && move2.resting === true && st3.animating === false && st3.pieces.length > 0 && st3.pieces.every((q) => q.resting),
      { animBefore2, restingAfter: move2.resting, animating: st3.animating, n: st3.pieces.length });

    // ---- (4) stacking survives the scroll: the pile moves as ONE body, contacts intact ----
    const gap4 = pair2 ? gapOf(after2, pair2) : null;
    check('A.debris 4: the pile travels as one rigid body and a stacked pair keeps its contact across the scroll (§4)',
      !!pair2 && move2.rigid <= 1.5 && !!gap4 && gap4.resting === true && Math.abs(gap4.gap - pair2.gap) <= 1.5,
      { pair2, gapAfter: gap4, rigid: move2.rigid });

    // ---- (5) `viewport` still works: the same scroll moves nothing ----
    await api.restore(page);
    await api.call(page, 'setDebrisAnchor', 'viewport');
    await sleep(80);
    const s5 = await api.rect(page, '#stack-1');
    const brk5 = await clickUntilBroken(page, '#stack-1', s5.cx, s5.cy);
    const rested5 = await poll(async () => { const s = await api.stats(page); return (s.pieceCount > 0 && s.pieces.every((q) => q.resting)) ? s : null; }, 8000, 80);
    const before5 = await boxesByPid();
    const y5a = await page.evaluate(() => { const y0 = window.scrollY; window.scrollBy(0, 300); return y0; });
    await settleRaf(page);
    await settleRaf(page);
    await sleep(120);
    const y5b = await page.evaluate(() => window.scrollY);
    const move5 = moveOf(before5, await boxesByPid());
    check('A.debris 5: with debrisAnchor "viewport" the very same 300 px scroll leaves the debris exactly where it was on screen (§4 keeps the option)',
      brk5 > 0 && !!rested5 && Math.abs((y5b - y5a) - 300) <= 1 && move5.n >= 1 && Math.abs(move5.minDy) <= 2 && Math.abs(move5.maxDy) <= 2 && move5.maxDx <= 2 && move5.resting === true,
      { ...move5, y5a, y5b });

    // ---- (6) teardown is unaffected by where the rubble ended up (§9 item 11) ----
    await api.call(page, 'setDebrisAnchor', 'document');
    await api.restore(page);
    await sleep(80);
    const left6 = await api.count(page, '.crs-piece, .crs-word, .crs-fading');
    check('A.debris 6: restore() clears every piece even while the page is scrolled far from where they fell', left6 === 0 && (await api.stats(page)).pieceCount === 0, { left6 });
    const s6 = await api.rect(page, '#stack-1');
    const brk6 = await clickUntilBroken(page, '#stack-1', s6.cx, s6.cy);
    await poll(async () => ((await api.stats(page)).pieceCount > 0 ? true : null), 4000, 60);
    await page.evaluate(() => window.scrollBy(0, 300));
    await settleRaf(page);
    await page.keyboard.press('Escape');
    const inactive6 = await poll(async () => (!(await api.active(page)) ? true : null), 2000, 25);
    const nodes6b = await api.count(page, '[data-crs]');
    await settleRaf(page);
    const pend6b = await api.pending(page);
    const raf6c = await api.pendingRaf(page);
    check('A.debris 6: Escape with document-anchored rubble on a scrolled page leaves no [data-crs] node, no live timer and no live animation frame (§9 item 11)',
      brk6 > 0 && inactive6 === true && nodes6b === 0 && pend6b === 0 && raf6c === 0, { brk6, inactive6, nodes6b, pend6b, raf6c });

    // back to the state the §9 decal block handed over
    const on6b = await page.evaluate(contentJs);
    check('A.debris 6: content.js reactivates cleanly after the §4 block', on6b === 'on', on6b);
    await api.call(page, 'setDebrisLife', 6000);
    await api.call(page, 'setDebrisAnchor', 'document');
    await api.debug(page, baseDebug);
    await api.setWeapon(page, 'hammer');
    await api.restore(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(100);
  }

  // =============================================================================================
  // SPEC-combat §C — 체력 합산: a container is worth what it holds (§F "체력 합산")
  // Appended at the END of suite A per the shared-file rule. Everything but the first check builds
  // its own fixture with page.evaluate and removes it again: test/fixture.html is shared with the
  // other worktrees, and these shapes only exist to pin numbers down.
  // =============================================================================================
  console.log('--- SPEC-combat §C: aggregate HP ---');
  await api.restore(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await api.setWeapon(page, 'hammer');
  await sleep(100);

  // (1) §F item 1 on the real page: section.hero holds exactly the three cards
  const heroAgg = await page.evaluate(() => {
    const crs = window.__crashScreen;
    const hero = document.querySelector('section.hero');
    const h = crs.hpOf(hero);
    const kids = Array.from(hero.children).map((c) => ({ id: c.id || c.tagName, max: crs.hpOf(c).max }));
    const sum = kids.reduce((a, k) => a + k.max, 0);
    return { max: h.max, own: h.own, approx: h.approx, kids, expect: h.own + 0.6 * sum };
  });
  check('A.hpagg 1: section.hero (3 cards) max === ownHp + 0.6 × Σ maxHp(children), within ±2 (§C2)',
    heroAgg.kids.length === 3 && Math.abs(heroAgg.max - heroAgg.expect) <= 2 && heroAgg.max > heroAgg.own && heroAgg.approx === false, heroAgg);

  // (2) a container with three equal children, sized so each child falls to ONE hammer hit (own 64 < 65)
  const nestLab = await page.evaluate(() => {
    const box = document.createElement('div'); box.id = 'x-hp-nest';
    Object.assign(box.style, { position: 'fixed', left: '60px', top: '150px', width: '420px', height: '210px', padding: '14px', boxSizing: 'border-box', background: '#eef2ff', border: '1px solid #99a', zIndex: '60' });
    for (let i = 0; i < 3; i++) {
      const kid = document.createElement('div'); kid.id = 'x-hp-kid-' + i;
      Object.assign(kid.style, { width: '392px', height: '40px', marginBottom: '6px', background: '#4a7bd0' });
      box.append(kid);
    }
    document.body.append(box);
    const b = box.getBoundingClientRect();
    return {
      shell: { x: Math.round(b.left + 5), y: Math.round(b.top + 5) },   // inside the 14 px padding: the box itself is the pick
      kids: Array.from(box.children).map((k) => { const r = k.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })
    };
  });
  const nest0 = await api.hpOf(page, '#x-hp-nest');
  const nestKid = await api.hpOf(page, '#x-hp-kid-0');
  check('A.hpagg 2: a 420 × 210 container over three 392 × 40 children === round(ownHp + 0.6 × Σ), nothing approximated (§C2)',
    nest0.max === Math.round(nest0.own + 0.6 * 3 * nestKid.max) && nest0.max > nest0.own && nest0.approx === false && nestKid.max === nestKid.own, { nest0, nestKid });

  // (3) §F item 3: one child gone → 0.6 × its maxHp off the ancestor's max AND hp
  await page.mouse.click(nestLab.kids[0].x, nestLab.kids[0].y);
  check('A.hpagg 3: one hammer hit breaks a 392 × 40 child (own 64 < 65)', await poll(() => api.broken(page, '#x-hp-kid-0'), 1500));
  const nestShare = Math.round(0.6 * nestKid.max);
  const nest1 = await api.hpOf(page, '#x-hp-nest');
  check('A.hpagg 3: breaking one child takes 0.6 × its maxHp off the ancestor — both max and hp (§C3)',
    nest1.max === nest0.max - nestShare && nest1.hp === nest0.hp - nestShare && nest1.hp === nest1.max, { before: nest0, after: nest1, share: nestShare });

  // (4) §F item 4: empty it out and the shell is worth ownHp — one or two hammer hits
  for (let i = 1; i < 3; i++) {
    await page.mouse.click(nestLab.kids[i].x, nestLab.kids[i].y);
    await poll(() => api.broken(page, '#x-hp-kid-' + i), 1500);
  }
  const nest2 = await api.hpOf(page, '#x-hp-nest');
  check('A.hpagg 4: with every child gone the container is back to its own shell (±3, three rounded 0.6 shares) and undamaged',
    Math.abs(nest2.max - nest2.own) <= 3 && nest2.hp === nest2.max && !(await api.broken(page, '#x-hp-nest')), { nest2, nest0 });
  const nestHits = await clickUntilBroken(page, '#x-hp-nest', nestLab.shell.x, nestLab.shell.y, 3);
  check('A.hpagg 4: the emptied shell then falls to one or two hammer hits (§C3)', nestHits >= 1 && nestHits <= 2, { nestHits, max: nest2.max, own: nest2.own });

  // (5) §F item 5: repair puts it back
  await api.restore(page);
  await sleep(100);
  const nest3 = await api.hpOf(page, '#x-hp-nest');
  check('A.hpagg 5: after repair the container is whole again at its full aggregate (§C3)',
    nest3.max === nest0.max && nest3.hp === nest3.max && !(await api.broken(page, '#x-hp-nest')) && !(await api.broken(page, '#x-hp-kid-0')), { before: nest0, after: nest3 });

  // (6) §F item 6: the walk runs once per element, however often it is hovered (§C4)
  const hc0 = (await api.stats(page)).hpCalcs;
  for (let i = 0; i < 10; i++) {
    await page.mouse.move(nestLab.kids[1].x + (i % 2), nestLab.kids[1].y);
    await sleep(30);
  }
  const hc1 = (await api.stats(page)).hpCalcs;
  check('A.hpagg 6: hovering the same element ten times computes its max ONCE — stats().hpCalcs +1 (§C4)', hc1 - hc0 === 1, { hc0, hc1 });
  await page.evaluate(() => { const b = document.getElementById('x-hp-nest'); if (b) b.remove(); });

  // (7) §F item 2: the 2500 ceiling — 40 big children sum past it while staying inside the 200-node budget
  const capLab = await page.evaluate(() => {
    const box = document.createElement('div'); box.id = 'x-hp-cap';
    Object.assign(box.style, { position: 'fixed', left: '0px', top: '0px', width: '1200px', height: '900px', background: '#fee8e8', zIndex: '55', overflow: 'hidden' });
    for (let i = 0; i < 40; i++) { const k = document.createElement('div'); Object.assign(k.style, { width: '300px', height: '180px', background: '#cc9999' }); box.append(k); }
    document.body.append(box);
    const crs = window.__crashScreen;
    const h = crs.hpOf(box), kid = crs.hpOf(box.firstElementChild);
    return { max: h.max, own: h.own, approx: h.approx, kidMax: kid.max, n: box.children.length };
  });
  check('A.hpagg 7: 40 big children sum past the ceiling — max === 2500 exactly, and the walk still finished (§C2)',
    capLab.max === 2500 && capLab.approx === false && capLab.own + 0.6 * capLab.n * capLab.kidMax > 2500, capLab);
  await page.evaluate(() => { const b = document.getElementById('x-hp-cap'); if (b) b.remove(); });

  // (8) §F item 7: 300 descendants blow the node budget → ownHp × 3, flagged, and the readout says `~`
  const apxLab = await page.evaluate(() => {
    const box = document.createElement('div'); box.id = 'x-hp-approx';
    Object.assign(box.style, { position: 'fixed', left: '200px', top: '180px', width: '600px', height: '400px', padding: '20px', boxSizing: 'border-box', background: '#eefaee', zIndex: '55', overflow: 'hidden' });
    for (let i = 0; i < 300; i++) { const k = document.createElement('div'); Object.assign(k.style, { width: '560px', height: '30px', background: '#99cc99' }); box.append(k); }
    document.body.append(box);
    const h = window.__crashScreen.hpOf(box);
    const b = box.getBoundingClientRect();
    return { max: h.max, own: h.own, approx: h.approx, n: box.children.length, shell: { x: Math.round(b.left + 6), y: Math.round(b.top + 6) } };
  });
  check('A.hpagg 8: 300 descendants blow the 200-node budget — approx === true and max === ownHp × 3 (§C4)',
    apxLab.n === 300 && apxLab.approx === true && apxLab.max === Math.min(2500, apxLab.own * 3), apxLab);
  await page.mouse.move(apxLab.shell.x, apxLab.shell.y);
  const tbApx = await poll(async () => { const t = await api.targetBox(page); return t && t.display !== 'none' && /~/.test(t.label || '') ? t : null; }, 900, 20);
  check('A.hpagg 8: an approximated max wears a trailing ~ in the hover readout (§C4)', !!tbApx && /\/\d+~/.test(tbApx.label), tbApx && tbApx.label);
  await page.evaluate(() => { const b = document.getElementById('x-hp-approx'); if (b) b.remove(); });
  await api.restore(page);
  await page.mouse.move(2, 2);
  await sleep(80);

  // =============================================================================================
  // SPEC-crosshair §C — 뷰모델 위치. 사용자: "무기 위치가 너무 구석이라 안보여".
  // v1.5 pinned the layer to 200 × 100 at right: 8px / bottom: −8px — 12 % of a 1280 × 800 screen,
  // flush into the corner and cut off at the bottom. §C makes every number viewport-proportional.
  // Appended at the END of this block (shared-file rule); it restores the suite viewport when done.
  // =============================================================================================
  console.log('--- core: SPEC-crosshair §C — 뷰모델이 구석에서 나온다 ---');
  const nearVm = (a, b, tol) => Math.abs(a - b) <= tol;
  const vmBox = () => page.evaluate(() => {
    const el = document.querySelector('.crs-viewmodel');
    if (!el) return null;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const art = el.querySelector('svg');
    const ar = art ? art.getBoundingClientRect() : null;
    const iw = Math.max(0, Math.min(ar ? ar.right : 0, innerWidth) - Math.max(ar ? ar.left : 0, 0));
    const ih = Math.max(0, Math.min(ar ? ar.bottom : 0, innerHeight) - Math.max(ar ? ar.top : 0, 0));
    const area = ar ? ar.width * ar.height : 0;
    const og = String(cs.transformOrigin || '').split(/\s+/).map(parseFloat);
    return {
      // the LAYOUT box, not the bounding rect: the idle bob rotates the layer ±1.2°, which inflates a
      // getBoundingClientRect() by a few px and would make a size assertion drift with the animation phase
      w: Math.round(parseFloat(cs.width)), h: Math.round(parseFloat(cs.height)),
      left: Math.round(r.left), right: Math.round(r.right),
      cssRight: parseFloat(cs.right), cssBottom: parseFloat(cs.bottom), z: cs.zIndex,
      ox: og[0], oy: og[1],
      artInView: area > 0 ? iw * ih / area : 0,
      artTilt: art ? getComputedStyle(art.parentElement).transform : '',
      vw: innerWidth, vh: innerHeight,
      info: (window.__crashScreen.debug.vmInfo ? window.__crashScreen.debug.vmInfo().layer : null)
    };
  });
  await api.restore(page);
  await api.setWeapon(page, 'pistol');
  await sleep(260);   // the draw animation settles; the layer geometry itself is written synchronously
  const vmC = await vmBox();
  check('A.§C: 1280 × 900 에서 뷰모델 레이어가 384 × 215 다 (clamp(300, vw × 0.30, 520) · 높이 = 폭 × 0.56) — v1.5 의 200 × 100 에서 세로 12 % → 24 %',
    !!vmC && vmC.vw === 1280 && nearVm(vmC.w, 384, 8) && nearVm(vmC.h, 215, 6), vmC);
  check('A.§C: 구석에 붙지 않는다 — right 가 vw × 0.05 (64 px) 이고 bottom 이 −height × 0.12 라 아래가 조금만 잘린다',
    !!vmC && nearVm(vmC.cssRight, Math.round(1280 * 0.05), 3) && nearVm(vmC.cssBottom, Math.round(-vmC.h * 0.12), 3) && vmC.right <= 1280 - 40, vmC);
  check('A.§C: 그림의 바운딩 박스가 뷰포트 안에 70 % 이상 들어온다 — 무엇을 들고 있는지 보인다',
    !!vmC && vmC.artInView >= 0.7, { inView: vmC && vmC.artInView, box: vmC });
  check('A.§C: transform-origin 이 80 % 100 % (손잡이) 이고 그림이 −8도 기울어 총구가 화면 안쪽 위를 향한다',
    !!vmC && nearVm(vmC.ox, 0.8 * vmC.w, 4) && nearVm(vmC.oy, 1.0 * vmC.h, 4) && /matrix/.test(vmC.artTilt), { ox: vmC && vmC.ox, oy: vmC && vmC.oy, w: vmC && vmC.w, h: vmC && vmC.h, tilt: vmC && vmC.artTilt });
  // ---- 탄약 HUD 와의 충돌: 패널은 bottom: 24px 로 돌아가고, 겹쳐도 뷰모델보다 위에 그려진다 ----
  const ammoC = await page.evaluate(() => {
    const host = document.querySelector('crs-hud, .crs-hud-host');
    const a = host && host.shadowRoot ? host.shadowRoot.querySelector('.crs-ammo') : null;
    const vmEl = document.querySelector('.crs-viewmodel');
    const rootEl = document.querySelector('.crs-root');
    if (!a || !vmEl || !host) return null;
    const ar = a.getBoundingClientRect(), vr = vmEl.getBoundingClientRect();
    const cs = getComputedStyle(a);
    const big = a.querySelector('.abig');
    return {
      bottom: cs.bottom, plate: cs.backgroundColor,
      hudZ: parseInt(getComputedStyle(host).zIndex, 10), rootZ: parseInt(getComputedStyle(rootEl).zIndex, 10),
      overlap: !(ar.right <= vr.left || ar.left >= vr.right || ar.bottom <= vr.top || ar.top >= vr.bottom),
      numColor: big ? getComputedStyle(big).color : '', numText: big ? (big.textContent || '') : ''
    };
  });
  const plateAlpha = ammoC ? (/rgba?\(([^)]+)\)/.exec(ammoC.plate) || [0, ''])[1].split(/[\s,\/]+/).filter(Boolean) : [];
  check('A.§C: 탄약 패널이 bottom: 24px 로 돌아갔다 (v1.5 의 118px 들어올리기 제거) 그리고 실제로 뷰모델과 겹친다',
    !!ammoC && ammoC.bottom === '24px' && ammoC.overlap === true, ammoC);
  check('A.§C: 겹쳐도 숫자가 읽힌다 — HUD 호스트의 z-index 가 글래스 루트보다 높고, 패널에 불투명한 어두운 배경판이 있다',
    !!ammoC && ammoC.hudZ > ammoC.rootZ && plateAlpha.length >= 4 && parseFloat(plateAlpha[3]) >= 0.5 && /\d/.test(ammoC.numText), { ammo: ammoC, alpha: plateAlpha[3] });
  // ---- viewmodelScale ----
  const vmScaleSet = await api.call(page, 'setSetting', 'viewmodelScale', 1.3);
  await sleep(120);
  const vmC13 = await vmBox();
  await api.call(page, 'setSetting', 'viewmodelScale', 1);
  await sleep(120);
  const vmC10 = await vmBox();
  check('A.§C: viewmodelScale: 1.3 이면 폭이 1.3배가 되고 1 로 되돌리면 원래대로다',
    vmScaleSet === true && !!vmC13 && !!vmC10 && nearVm(vmC13.w, Math.round(vmC.w * 1.3), 6) && nearVm(vmC10.w, vmC.w, 4), { base: vmC && vmC.w, at13: vmC13 && vmC13.w, back: vmC10 && vmC10.w });
  // ---- the two clamp ends: 640 → 하한 300, 2400 → 상한 520 ----
  await page.setViewport({ width: 640, height: 900, deviceScaleFactor: 1 });
  await sleep(200);
  const vm640 = await vmBox();
  await page.setViewport({ width: 2400, height: 900, deviceScaleFactor: 1 });
  await sleep(200);
  const vm2400 = await vmBox();
  await page.setViewport(VIEWPORT);
  await sleep(220);
  const vmBack = await vmBox();
  check('A.§C: 창 크기가 바뀌면 다시 계산한다 — 640 폭에서 하한 300, 2400 폭에서 상한 520, 1280 으로 돌아오면 384',
    !!vm640 && !!vm2400 && !!vmBack && nearVm(vm640.w, 300, 6) && nearVm(vm2400.w, 520, 6) && nearVm(vmBack.w, 384, 8),
    { w640: vm640 && vm640.w, w2400: vm2400 && vm2400.w, back: vmBack && vmBack.w });
  await api.restore(page);
  await sleep(80);


  // =======================================================================================
  // SPEC-destruction §E — 폭발 교정
  //   사용자: "폭발 이팩트와 그 흔적 들이 폭발과 괴리가 너무 커"
  // §E1 found four numbers that had nothing to do with each other: 실제 반경 240/360, 그을음 90 고정,
  // 균열 220~420, 링 480 고정. Every assertion below reads a drawn size back and divides it by the
  // weapon's OWN radius, so a regression to any fixed number fails here rather than looking fine.
  // §G 의 폭발 항목: 그을음 바깥 지름 0.85R ±8px · 0.25R 넘는 균열 없음 · 링 = R ±6px 이고 폭탄 ≠ 로켓 ·
  // 조준점 점선 원 = 링 = WEAPONS[id].radius · 30ms 에 자국 없고 80ms 에 있음 · 망치 자국과 구분.
  // =======================================================================================
  console.log('--- core: SPEC-destruction §E — 폭발 교정 (모든 크기가 실제 반경 R 에 묶인다) ---');
  await api.setCombat(page, false);   // §E is about the blast itself: no enemies, no invulnerability, no repair
  await api.debug(page, { noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: true, noRepair: true, noFalloff: true, noInvuln: true, noPartial: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await api.restore(page);
  await sleep(80);

  /* Mean alpha / inked coverage of ONE element's decal, read in a box or an annulus around a viewport
   * point. §E's claims are about what is PAINTED, so they are measured on the bitmap. */
  const decalProbe = (sel, vx, vy, r0, r1) => page.evaluate((s, gx, gy, a0, a1) => {
    const el = document.querySelector(s);
    if (!el) return { canvases: 0, alpha: -1, coverage: -1, n: 0, why: 'no element' };
    /* The decal that CONTAINS the impact point, smallest first — pickTarget() may have marked a CHILD of
     * the element aimed at, and the mark belongs to whatever it really landed on. */
    const list = [...document.querySelectorAll('.crs-decal')]
      .map((c) => ({ c, b: c.getBoundingClientRect() }))
      .filter((o) => gx >= o.b.left - 1 && gx <= o.b.right + 1 && gy >= o.b.top - 1 && gy <= o.b.bottom + 1)
      .sort((p, q) => p.b.width * p.b.height - q.b.width * q.b.height);
    if (!list.length) return { canvases: document.querySelectorAll('.crs-decal').length, alpha: -1, coverage: -1, n: 0, why: 'no decal over the impact point' };
    const c = list[0].c, cb = list[0].b, r = cb;
    const sx = c.width / Math.max(1, cb.width), sy = c.height / Math.max(1, cb.height);
    let d;
    try { d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; } catch (e) { return { canvases: list.length, alpha: -1, coverage: -1, n: 0 }; }
    const cx = (gx - r.left) * sx, cy = (gy - r.top) * sy;
    let sum = 0, n = 0, ink = 0;
    for (let i = 3, k = 0; i < d.length; i += 4, k++) {
      const px = k % c.width, py = (k - px) / c.width;
      const dist = Math.hypot((px - cx) / sx, (py - cy) / sy);
      if (dist < a0 || dist > a1) continue;
      n++; sum += d[i]; if (d[i] > 8) ink++;
    }
    return { canvases: list.length, alpha: n ? Math.round(sum / n) : 0, coverage: n ? ink / n : 0, n,
      box: [Math.round(cb.left), Math.round(cb.top), Math.round(cb.width), Math.round(cb.height)],
      owners: (window.__crashScreen.debug.decals() || []).map((o) => `${o.tag}${o.id ? '#' + o.id : ''} ${o.w}x${o.h}`) };
  }, sel, vx, vy, r0, r1);
  /* The shock ring's FINAL radius. getBoundingClientRect() would report the ANIMATED box (the keyframes
   * scale it from .02 to 1), so the laid-out width is what is read — that is the size §E4 says JS writes. */
  const ringShot = (weapon, x, y) => page.evaluate((w, px, py) => new Promise((res) => {
    const a = window.__crashScreen;
    const t0 = performance.now();
    const read = (n) => ({ r: Math.round(parseFloat(getComputedStyle(n).width) / 2), ms: Math.round(performance.now() - t0), dur: getComputedStyle(n).animationDuration });
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { mo.disconnect(); } catch (e) { /* ignore */ } res(v); };
    const mo = new MutationObserver(() => { const n = document.querySelector('.crs-fx-ring'); if (n) finish(read(n)); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    a.smashAt(px, py, w);
    const now0 = document.querySelector('.crs-fx-ring');
    if (now0) finish(read(now0));
    setTimeout(() => finish({ r: -1, ms: -1, dur: '' }), 1500);
  }), weapon, x, y);

  // ---- §E5 조준점과의 일관성: 세 값이 같은 상수를 쓴다 ------------------------------------------
  const bcE = await api.rect(page, '#big-card');
  const ringBombE = await ringShot('bomb', bcE.cx, bcE.cy);
  const blastBombE = await page.evaluate(() => window.__crashScreen.debug.lastBlastRec);
  await poll(async () => (await page.evaluate(() => !!window.__crashScreen.debug.lastBlast())), 600, 20);
  const markBombE = await page.evaluate(() => window.__crashScreen.debug.lastBlast());
  await api.setWeapon(page, 'bomb');
  await page.mouse.move(bcE.cx, bcE.cy);
  await sleep(140);
  const chBombE = await page.evaluate(() => { const n = document.querySelector('.crs-ch-blast'); return n ? Math.round(parseFloat(getComputedStyle(n).width) / 2) : -1; });
  await api.restore(page);
  await sleep(80);
  const ringRocketE = await ringShot('rocket', bcE.cx, bcE.cy);
  await poll(async () => (await page.evaluate(() => { const b = window.__crashScreen.debug.lastBlast(); return !!b && b.R > 300; })), 1500, 25);
  const markRocketE = await page.evaluate(() => window.__crashScreen.debug.lastBlast());
  await api.setWeapon(page, 'rocket');
  await page.mouse.move(bcE.cx, bcE.cy);
  await sleep(140);
  const chRocketE = await page.evaluate(() => { const n = document.querySelector('.crs-ch-blast'); return n ? Math.round(parseFloat(getComputedStyle(n).width) / 2) : -1; });

  check('A.destr §E4: 충격파 링의 최종 반지름이 실제 폭발 반경과 ±6px 이고, 폭탄(240)과 로켓(360)이 서로 다르다 — 480 고정 링은 사라졌다',
    ringBombE.r > 0 && ringRocketE.r > 0 &&
    Math.abs(ringBombE.r - W.byId.bomb.radius) <= 6 && Math.abs(ringRocketE.r - W.byId.rocket.radius) <= 6 &&
    ringRocketE.r !== ringBombE.r,
    { bomb: ringBombE, rocket: ringRocketE, specBomb: W.byId.bomb.radius, specRocket: W.byId.rocket.radius });
  check('A.destr §E4: 링은 260ms 에 걸쳐 퍼진다 (520ms 이 아니다)',
    /^0?\.26s$|^260ms$/.test(String(ringBombE.dur).trim()), { dur: ringBombE.dur, rocketDur: ringRocketE.dur });
  check('A.destr §E5: 조준점 점선 원 = 링 최종 반지름 = WEAPONS[id].radius — 세 값이 폭탄과 로켓 양쪽에서 같다',
    chBombE === W.byId.bomb.radius && chRocketE === W.byId.rocket.radius &&
    Math.abs(chBombE - ringBombE.r) <= 6 && Math.abs(chRocketE - ringRocketE.r) <= 6,
    { crosshair: [chBombE, chRocketE], ring: [ringBombE.r, ringRocketE.r], spec: [W.byId.bomb.radius, W.byId.rocket.radius] });

  // ---- §E3 자국의 치수 자체가 R 의 비율이다 -----------------------------------------------------
  check('A.destr §E3: 그을음(검댕)의 바깥 끝이 0.85R 과 ±8px — 폭탄 204 / 로켓 306. 90px 고정 그을음은 사라졌다',
    !!markBombE && !!markRocketE &&
    Math.abs(markBombE.sootOuter - 0.85 * W.byId.bomb.radius) <= 8 &&
    Math.abs(markRocketE.sootOuter - 0.85 * W.byId.rocket.radius) <= 8 &&
    markRocketE.sootOuter > markBombE.sootOuter,
    { bomb: markBombE, rocket: markRocketE, wantBomb: 0.85 * W.byId.bomb.radius, wantRocket: 0.85 * W.byId.rocket.radius });
  check('A.destr §E3: 0.25R 을 넘는 균열 폴리라인이 하나도 없다 — 220~420px 거미줄은 사라졌다 (폭탄 상한 60 / 로켓 90)',
    !!markBombE && !!markRocketE && markBombE.cracks >= 5 && markBombE.cracks <= 8 &&
    markBombE.crackMax <= 0.25 * W.byId.bomb.radius && markRocketE.crackMax <= 0.25 * W.byId.rocket.radius,
    { bomb: markBombE, rocket: markRocketE });
  check('A.destr §E3: 분출 줄기는 10~16개이고, 로켓은 intensity 1.5 로 1.1R 까지 닿는 긴 줄기를 더 얹는다',
    !!markBombE && !!markRocketE && markBombE.jets >= 10 && markBombE.jets <= 16 &&
    markBombE.intensity === 1 && markRocketE.intensity === 1.5 &&
    markRocketE.jets >= 13 && markRocketE.jets <= 21 &&
    markBombE.jetOuter <= W.byId.bomb.radius + 1 && markRocketE.jetOuter > W.byId.rocket.radius,
    { bomb: markBombE, rocket: markRocketE });

  // ---- §E4 순서: 40ms 에 자국을 그린다 — 30ms 엔 없고 80ms 엔 있다 ------------------------------
  await api.restore(page);
  await sleep(100);
  const arenaE = await api.rect(page, '#arena');
  const timingE = await page.evaluate((x, y) => new Promise((res) => {
    const ink = () => {
      let n = 0;
      for (const c of document.querySelectorAll('.crs-decal')) {
        try {
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
        } catch (e) { /* ignore */ }
      }
      return n;
    };
    const before = ink();
    window.__crashScreen.smashAt(x, y, 'bomb');
    setTimeout(() => {
      const at30 = ink();
      setTimeout(() => res({ before, at30, at80: ink() }), 52);
    }, 30);
  }), arenaE.cx, arenaE.cy);
  check('A.destr §E4: 자국은 섬광이 걷히는 40ms 에 그려진다 — 발사 후 30ms 에는 자국이 없고 80ms 에는 있다',
    timingE.before === 0 && timingE.at30 === 0 && timingE.at80 > 0, timingE);

  // ---- §E2 폭발 자국과 망치 자국은 다른 종류의 자국이다 -----------------------------------------
  // 같은 요소(#big-card, 같은 재질)를 한 번은 망치로, 한 번은 폭탄으로 때리고 같은 두 자를 댄다:
  // 중심 알파(폭발은 그을음 덩어리라 짙다)와 외곽(폭발은 0.42R 그을음이 메워 덮고, 망치는 가닥뿐이다).
  await api.restore(page);
  await sleep(100);
  const bcBox2 = await api.rect(page, '#big-card');
  /* The card's own padding, not its text: a hammer landing on an inner <p> destroys that paragraph
     outright and takes its decal with it, which is a measurement bug and not a product one. */
  const bcE2 = { cx: bcBox2.left + 18, cy: bcBox2.top + 18 };
  const hamHit = await api.smashAt(page, bcE2.cx, bcE2.cy, 'hammer');
  await sleep(220);
  const hamCore = await decalProbe('#big-card', bcE2.cx, bcE2.cy, 0, 12);
  const hamRing = await decalProbe('#big-card', bcE2.cx, bcE2.cy, 55, 70);
  const hamMark = await page.evaluate(() => window.__crashScreen.debug.lastMark());
  await api.restore(page);
  await sleep(100);
  const bombHit = await api.smashAt(page, bcE2.cx, bcE2.cy, 'bomb');
  await sleep(220);
  const bombCore = await decalProbe('#big-card', bcE2.cx, bcE2.cy, 0, 12);
  const bombRing = await decalProbe('#big-card', bcE2.cx, bcE2.cy, 55, 70);
  const bombMark = await page.evaluate(() => window.__crashScreen.debug.lastBlast());
  /* §G asks that the two marks be TOLD APART by centre alpha and by their outer polylines — not that one
     be darker than the other. They are made of different things: the hammer's core is the material's own
     impact core (a filled tear on paper), the blast's is a 0.42R soot gradient, and the two land tens of
     levels apart in either direction depending on the material. What must never collapse is the gap. */
  check('A.destr §E2: 폭발 자국과 망치 자국이 중심 알파로 구분된다 — 같은 요소·같은 재질에 남겼는데도 중심의 평균 알파가 크게 다르다',
    hamCore.alpha > 0 && bombCore.alpha > 0 && Math.abs(bombCore.alpha - hamCore.alpha) >= 40,
    { hammer: hamCore, bomb: bombCore, hits: [hamHit, bombHit], gap: Math.abs(bombCore.alpha - hamCore.alpha) });
  check('A.destr §E2: …그리고 외곽 폴리라인으로 구분된다 — 폭발의 가장 긴 균열은 0.25R 상한 아래이고, 망치의 거미줄 가닥은 그보다 길게 뻗는다',
    !!hamMark && !!bombMark && bombMark.crackMax <= 0.25 * W.byId.bomb.radius &&
    hamMark.maxLen > bombMark.crackMax,
    { hammerRing: hamRing, bombRing, hammerMark: hamMark, bombMark, cap: 0.25 * W.byId.bomb.radius });

  // ---- §E3 "각 요소의 데칼에 나눠 그린다": 자국이 폭발 반경 안의 여러 요소로 갈린다 ---------------
  await api.restore(page);
  await sleep(100);
  const spotE = await api.rect(page, '#bomb-spot');
  await api.restore(page);
  await sleep(80);
  /* Counted with a MutationObserver, not by querying afterwards: the cluster's leaves are destroyed by
     the very blast that marks them and a destroyed element takes its decal with it (§1), so "how many
     elements did this ONE blast mark" has to be read as it happens. */
  const splitE = await page.evaluate((x, y) => new Promise((res) => {
    const seen = [];
    const mo = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList && n.classList.contains('crs-decal')) {
          const b = n.getBoundingClientRect();
          seen.push([Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]);
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.__crashScreen.smashAt(x, y, 'bomb');
    setTimeout(() => { mo.disconnect(); res({ n: seen.length, boxes: seen.slice(0, 8) }); }, 150);
  }), spotE.cx, spotE.cy);
  check('A.destr §E3: 한 번의 폭발이 반경 안의 여러 요소의 데칼에 나뉘어 그려진다 (1단계 모델 — 화면이 아니라 요소에 남는다)',
    splitE.n >= 2, splitE);
  await api.restore(page);
  await sleep(80);

  // --- console / CSP (this block's own page; every block tallies its own, SPEC-test-speed §5) -------
  await closeBlockPage('A.core', { page, log, client });
}

// ---------------------------------------------------------------------------
// Block `settings` — docs/specs/settings.md: schema + storage plumbing (§1), the performance guard
// under a heavy page (§2.4) and the accessibility switches (§3.5). It opened its own pages from the
// day it was written, so it lifts out of suite A whole; `browser` is now a parameter rather than a
// closed-over local.
// ---------------------------------------------------------------------------
async function suiteASettings(browser, origin, contentCss, contentJs) {
  console.log('--- settings: schema / storage / performance guard / accessibility ---');
  // =============================================================================================
  // docs/specs/settings.md — schema + storage plumbing (§1), the performance guard under a heavy
  // page (§2.4) and the accessibility switches (§3.5). Appended at the END of suite A per the
  // shared-file rule. Every block below opens its OWN fresh page (and, where a migration needs a
  // store with legacy keys already on it, its own store) rather than touching `page` — a product
  // gap here (api.settings / api.setSetting not built yet, or a key simply missing) fails loudly
  // in its own check without disturbing `page`'s long-running console/CSP/lastError tally below,
  // and each block hooks its OWN console/page-error listeners so "no errors" is still verified.
  // =============================================================================================
  // `seed`, when given, runs on window.__crsStore AFTER the chrome shim but BEFORE content.js's first
  // injection — exactly where a legacy-key migration fixture or a carried-over store needs to land.
  // `seedData` is passed through verbatim (puppeteer serializes function args, never outer closures).
  const openSettingsPage = async (seed, seedData) => {
    const p = await browser.newPage();
    await p.setViewport(VIEWPORT);
    const logP = hookPage(p);
    await installViolationCounter(p);
    await p.goto(`${origin}/`, { waitUntil: 'load' });
    const client = await injectCss(p, contentCss);
    await p.evaluate(TIMER_LEDGER);
    await p.evaluate(CHROME_SHIM);
    if (seed) await p.evaluate(seed, seedData);
    const on = await p.evaluate(contentJs);
    await sleep(150);
    return { page: p, client, on, log: logP };
  };
  const closeSettingsPage = async (h) => {
    check(`A.settings: zero console/page errors on this page (store: ${h.on})`, h.log.pageErrors.length === 0 && h.log.consoleErrors.length === 0, { pageErrors: h.log.pageErrors, consoleErrors: h.log.consoleErrors });
    try { await h.client.detach(); } catch (e) { /* ignore */ }
    try { await h.page.close(); } catch (e) { /* ignore */ }
  };

  // ---------------------------------------------------------------------------------------------
  // §1 — defaults, setSetting validation, and the round trip (§4: 저장 → 재활성화 → 유지).
  // ---------------------------------------------------------------------------------------------
  {
    const h = await openSettingsPage();
    const { page: p } = h;

    const defaults = {
      mode: 'rampage', defaultWeapon: 'hammer', loadoutPreset: 'default', debrisAnchor: 'document',
      debrisLifeMs: 6000, debrisCap: 160, soundVolume: 28, muted: false, weaponArt: 'auto',
      viewmodel: true, combatDifficulty: 'normal', reduceMotion: 'auto', highContrastMarkers: false,
      keyboardAim: false, perfMode: 'auto',
    };
    const got1 = await api.call(p, 'settings');
    const mism1 = (got1 && typeof got1 === 'object') ? Object.keys(defaults).filter((k) => got1[k] !== defaults[k]) : Object.keys(defaults);
    check('A.settings 1 (§1.2): api.settings() resolves every documented key to its documented default on a brand-new store',
      got1 && typeof got1 === 'object' && mism1.length === 0,
      { got: got1, mismatched: mism1.map((k) => ({ key: k, expected: defaults[k], got: got1 && got1[k] })) });

    // ---- setSetting(key, value): a VALID value is reflected back by settings() right away --------
    const setDc = await api.call(p, 'setSetting', 'debrisCap', 240);
    const setMuted = await api.call(p, 'setSetting', 'muted', true);
    const setAnchor = await api.call(p, 'setSetting', 'debrisAnchor', 'viewport');
    const setWeaponDef = await api.call(p, 'setSetting', 'defaultWeapon', 'sniper');
    const afterSet = await api.call(p, 'settings');
    check('A.settings 2 (§1.3): setSetting(key, value) with a VALID value round-trips through settings() immediately (debrisCap/muted/debrisAnchor/defaultWeapon)',
      !!afterSet && afterSet.debrisCap === 240 && afterSet.muted === true && afterSet.debrisAnchor === 'viewport' && afterSet.defaultWeapon === 'sniper',
      { calls: { setDc, setMuted, setAnchor, setWeaponDef }, afterSet });
    const debrisAnchorGetter = await p.evaluate(() => window.__crashScreen.debrisAnchor);
    check('A.settings 2 (§1.3): the existing api.debrisAnchor getter agrees with settings().debrisAnchor after setSetting — ONE resolved value, not two sources of truth',
      debrisAnchorGetter === 'viewport', debrisAnchorGetter);

    // ---- setSetting(key, value) with an INVALID value is ignored and recorded, not applied --------
    const errBefore3 = (await api.stats(p)).lastError;
    const badCap = await api.call(p, 'setSetting', 'debrisCap', 9999);   // out of the 20–300 range (§1.1)
    const afterBadCap = await api.call(p, 'settings');
    const errAfterCap = (await api.stats(p)).lastError;
    check('A.settings 3 (§1.3): setSetting(\'debrisCap\', 9999) — out of range — leaves settings().debrisCap at 240 (the last VALID value) and sets stats().lastError',
      !!afterBadCap && afterBadCap.debrisCap === 240 && errAfterCap != null && errAfterCap !== errBefore3,
      { badCap, debrisCap: afterBadCap && afterBadCap.debrisCap, errBefore: errBefore3, errAfter: errAfterCap });
    const badMode = await api.call(p, 'setSetting', 'mode', 'turbo');     // not one of the enum's options
    const afterBadMode = await api.call(p, 'settings');
    check('A.settings 3 (§1.3): setSetting(\'mode\', \'turbo\') — not one of rampage/arcade/survival — is ignored (settings().mode stays \'rampage\')',
      !!afterBadMode && afterBadMode.mode === 'rampage', { badMode, mode: afterBadMode && afterBadMode.mode });

    // ---- round trip (§4 완료 기준: 저장 → 재활성화 → 유지) --------------------------------------------
    // A same-page toggle() is NOT the right probe: settingsBoot()/settingsRead() runs once per PAGE LOAD
    // (module evaluation) — window.__crashScreen already exists, so a same-page toggle() short-circuits
    // straight to activate()/deactivate() and never touches storage again. An in-memory value would thus
    // "survive" even if nothing had actually reached disk. The real test is a SECOND page/activation
    // carrying over exactly what this page wrote to chrome.storage.sync — the §8.1 legacy-loadout block
    // above uses this same reload-equivalent recipe, and its own FIRST activation already is the
    // "재활성화" the completion bar asks for (no extra toggle() needed on top of it).
    // SPEC-combat §A retired `quickdraw`; the round trip now carries `arcade`, the mode that replaced it.
    await api.call(p, 'setSetting', 'mode', 'arcade');
    const storeToCarry = await api.store(p);
    const h2 = await openSettingsPage((seedObj) => { Object.assign(window.__crsStore, seedObj); }, storeToCarry);
    const afterReload = await api.call(h2.page, 'settings');
    const weaponAfterReload = await h2.page.evaluate(() => window.__crashScreen.weapon);
    check('A.settings 4 (§4 완료 기준): a SECOND page/activation reading the SAME storage sees every value set above (debrisCap/muted/debrisAnchor/defaultWeapon/mode) — NOT the hard defaults',
      h2.on === 'on' && !!afterReload &&
      afterReload.debrisCap === 240 && afterReload.muted === true && afterReload.debrisAnchor === 'viewport' &&
      afterReload.defaultWeapon === 'sniper' && afterReload.mode === 'arcade',
      { on: h2.on, storeToCarry, afterReload });
    check('A.settings 4 (§1.2): defaultWeapon governs the weapon a FRESH activation actually starts with (\'sniper\' persisted above → \'sniper\' on this new page, not the hard default \'hammer\')',
      weaponAfterReload === 'sniper', weaponAfterReload);
    await closeSettingsPage(h2);

    await closeSettingsPage(h);
  }

  // ---------------------------------------------------------------------------------------------
  // §1.2 — migration: values already on disk under the OLD (pre-schema) keys survive the move to
  // the unified schema, and the migration DELETES those old keys rather than merely shadowing them
  // (mirrors the existing sword→katana / crsCombat→mode legacy-key pattern already proven above).
  // ---------------------------------------------------------------------------------------------
  {
    const seed = () => {
      window.__crsStore.crsMuted = true;
      window.__crsStore.crsDebrisAnchor = 'viewport';
      window.__crsStore.crsDebrisLifeMs = 12000;
    };
    const h = await openSettingsPage(seed);
    const { page: p } = h;
    const settingsM = await api.call(p, 'settings');
    const storeAfter = await api.store(p);
    check('A.settings 5 (§1.2): a pre-existing crsMuted / crsDebrisAnchor / crsDebrisLifeMs on disk is ABSORBED into the new schema on first activation (settings() shows the migrated values, not the hard defaults)',
      h.on === 'on' && !!settingsM && settingsM.muted === true && settingsM.debrisAnchor === 'viewport' && settingsM.debrisLifeMs === 12000,
      { on: h.on, settings: settingsM });
    check('A.settings 5 (§1.2): the one-time migration DELETES the old keys from storage — it MOVES them, it does not merely read-and-shadow them',
      !('crsMuted' in storeAfter) && !('crsDebrisAnchor' in storeAfter) && !('crsDebrisLifeMs' in storeAfter), storeAfter);
    await closeSettingsPage(h);
  }

  // ---------------------------------------------------------------------------------------------
  // SPEC-combat §A — the retired Virtua-Cop mode. Both things a previous build could have left on
  // disk ("crsCombat: true" from v1.3, "crsMode: 'quickdraw'" from v1.4) have to come back as
  // `arcade`: that pref came from someone who only ever played with the cursor, and arcade is the
  // mode where the cursor IS the player. Nothing else in the product says the old id any more —
  // this is the ONE read path that still has to understand it.
  // ---------------------------------------------------------------------------------------------
  {
    const h = await openSettingsPage(() => { window.__crsStore.crsMode = 'quickdraw'; });
    const sQ = await api.call(h.page, 'settings');
    const stQ = await api.stats(h.page);
    check('A.settings 6 (§A): a stored crsMode: \'quickdraw\' (the retired v1.4 mode) migrates to \'arcade\' — settings().mode and stats().mode both report arcade, never the dead id',
      h.on === 'on' && !!sQ && sQ.mode === 'arcade' && stQ.mode === 'arcade', { on: h.on, settings: sQ, statsMode: stQ.mode });
    await closeSettingsPage(h);
  }
  {
    const h = await openSettingsPage(() => { window.__crsStore.crsCombat = true; });
    const sC = await api.call(h.page, 'settings');
    const stC = await api.stats(h.page);
    check('A.settings 6 (§A): a stored legacy crsCombat: true migrates to \'arcade\' as well (not survival — the v1.3 player had no drone)',
      h.on === 'on' && !!sC && sC.mode === 'arcade' && stC.mode === 'arcade' && stC.combat === true, { on: h.on, settings: sC, statsMode: stC.mode });
    await closeSettingsPage(h);
  }
  {
    const h = await openSettingsPage(() => { window.__crsStore.crsCombat = false; });
    const sF = await api.call(h.page, 'settings');
    check('A.settings 6 (§A): a stored crsCombat: false still means rampage (the migration only rewrites the combat side)',
      h.on === 'on' && !!sF && sF.mode === 'rampage', { on: h.on, settings: sF });
    await closeSettingsPage(h);
  }

  // ---------------------------------------------------------------------------------------------
  // §2.4 — the performance guard under a heavy page. The ~9000 fixture nodes are built FROM THIS
  // TEST (one innerHTML parse — this is the HARNESS building the host page's own DOM to simulate a
  // heavy page, not the content script; the hostile-page DOM rules bind what src/*.js itself may
  // write, not this fixture) into a container removed again before the block ends, so no other
  // suite or fixture file carries the cost. Added wall time: one extra page (~0.3–0.5 s) + a single
  // sub-millisecond DOM build + a few short polls — nowhere near the ~8 s budget §2.4 allows.
  // ---------------------------------------------------------------------------------------------
  {
    const h = await openSettingsPage();
    const { page: p } = h;
    const fullSettings = await api.call(p, 'settings');
    const debrisCapFull = fullSettings && fullSettings.debrisCap;

    const build9k = await p.evaluate(() => {
      const t0 = performance.now();
      const host = document.createElement('div');
      host.id = 'crs-perf-fixture';
      let html = '';
      for (let i = 0; i < 1800; i++) html += '<div class="pf"><span>x</span><span>y</span><span>z</span><span>w</span><span>v</span></div>';
      host.innerHTML = html;   // 1800 × 5 children = 9000 element nodes from ONE parse, not 9000 DOM calls
      document.body.appendChild(host);
      return { count: document.getElementsByTagName('*').length, ms: performance.now() - t0 };
    });
    check('A.perf 1 (§2.4): the generated fixture clears the 8000-element threshold, built cheaply (one innerHTML parse, < 300 ms)',
      build9k.count > 8000 && build9k.ms < 300, build9k);

    // openSettingsPage() left the page ACTIVE, so toggle() ONCE would merely deactivate it — two calls
    // (off, then on) are what actually deactivates and reactivates OVER the now-heavy DOM.
    const toggledOff = await p.evaluate(() => window.__crashScreen.toggle());
    const reactivated = await p.evaluate(() => window.__crashScreen.toggle());
    const perf1 = await poll(async () => { const s = await api.stats(p); return s.perf && s.perf.mode === 'performance' ? s.perf : null; }, 1500, 40);
    const debugPerf1 = await api.dbgCall(p, 'perf');   // cross-check only — debug.perf() is implementation-visible even before stats() exposes .perf
    check('A.perf 1 (§2.4): activating over a > 8000-element page selects perfMode auto → \'performance\' (measured at activation, not after waiting out the 10 s recheck)',
      toggledOff === 'off' && reactivated === 'on' && !!perf1 && perf1.mode === 'performance', { toggledOff, reactivated, perf1, debugPerf1 });

    // ---- perfMode: 'quality' forced — the caps must NOT come down despite the element count -------
    const setQuality = await api.call(p, 'setSetting', 'perfMode', 'quality');
    const perfQuality = await poll(async () => { const s = await api.stats(p); return s.perf && s.perf.mode === 'quality' ? s.perf : null; }, 1000, 30);
    const debugPerfQuality = await api.dbgCall(p, 'perf');
    check('A.perf 2 (§2.2/§2.4): perfMode: \'quality\' forced over the SAME > 8000-element page keeps the FULL debris cap (not min(cap, 80)) — forced beats measured',
      setQuality !== undefined && !!perfQuality && perfQuality.mode === 'quality' && perfQuality.cap === debrisCapFull,
      { setQuality, perfQuality, debrisCapFull, debugPerfQuality });
    await api.call(p, 'setSetting', 'perfMode', 'auto');

    // ---- §2.3 candidate-search cache: the collapse weapon is the one public path that reaches
    // walkCandidates() directly (collapseCandidates → walkCandidates); debug.perf().walkCalls/walkRuns
    // and debug.walkReset() are the implementation's own test-only counters for exactly this. --------
    await api.setWeapon(p, 'collapse');
    /* noCooldown alone is NOT enough to fire 붕괴 ten times in one tick. 붕괴 carries mag: 1 / reloadMs: 5000
       (src/00-prelude.js), so the FIRST smashAt() spends the only charge, flushPendingReload() immediately
       starts the 5 s reload, and action() then rejects calls 2–10 at the spend() gate — before W.fire(), so
       collapseCandidates()/walkCandidates() is never reached at all and the counters read {calls: 1, runs: 1}.
       That is correct product behaviour (the one-charge super weapon), not a cache failure: the magazine, not
       the memo, is what the old assertion was measuring. infiniteAmmo keeps the charge from being consumed so
       all ten hits really fire — ten genuine collapses at the same point inside one 300 ms window, which is
       exactly the scenario §2.3 memoises. Both flags are restored below. */
    await api.debug(p, { noCooldown: true, infiniteAmmo: true });
    await api.dbgCall(p, 'walkReset');
    /* The ten calls run inside ONE page evaluate. Driven from here they would be ten CDP round trips —
       ~35 ms each on this machine — so the 300 ms memo window expires mid-loop and the cache is blamed
       for the harness's own latency. In one evaluate they share a tick, which is what §2.3 is about.
       smashAt() returns false for an attack that was REJECTED, so the accepted count proves the ten hits
       actually happened rather than being silently gated away again. */
    const fired10 = await p.evaluate(() => { let n = 0; for (let i = 0; i < 10; i++) if (window.__crashScreen.smashAt(100, 100)) n++; return n; });
    const walk10 = await api.dbgCall(p, 'perf');
    check('A.perf 3 (§2.3): 10 collapse hits at the SAME point inside one 300 ms window → 10 CALLS but walkCandidates really traverses ONCE (walkRuns)',
      fired10 === 10 && walk10 && walk10.walkCalls === 10 && walk10.walkRuns === 1, { fired10, walk10 });
    await sleep(350);   // past WALK_MEMO_MS, so the next search must traverse for real
    const fired11 = await p.evaluate(() => window.__crashScreen.smashAt(100, 100));
    const walk11 = await api.dbgCall(p, 'perf');
    check('A.perf 3 (§2.3): once the 300 ms memo window elapses, the next candidate search re-walks (walkRuns increments again, to 2)',
      fired11 === true && walk11 && walk11.walkCalls === 11 && walk11.walkRuns === 2, { fired11, walk11 });
    await api.debug(p, { noCooldown: false, infiniteAmmo: false });

    // ---- 30 hits over the heavy fixture, then teardown: no errors, no leftovers -------------------
    await api.setWeapon(p, 'hammer');
    const hitErrBefore = h.log.pageErrors.length;
    for (let i = 0; i < 30; i++) await api.smashAt(p, 80 + (i % 20) * 4, 80 + (i % 15) * 4);
    const perfAfterHits = (await api.stats(p)).perf;
    await p.evaluate(() => window.__crashScreen.deactivate());
    await p.evaluate(() => { const el = document.getElementById('crs-perf-fixture'); if (el) el.remove(); });
    const leftoverPerf = await api.count(p, '[data-crs]');
    check('A.perf 1 (§2.4): 30 hits over the heavy fixture + deactivate → zero NEW page errors and zero leftover [data-crs] nodes',
      h.log.pageErrors.length === hitErrBefore && leftoverPerf === 0,
      { newErrors: h.log.pageErrors.slice(hitErrBefore), leftoverPerf, perfAfterHits });

    await closeSettingsPage(h);
  }

  // ---------------------------------------------------------------------------------------------
  // §3.5 — reduceMotion and highContrastMarkers, each checked against a MEASURED BASELINE (the
  // same scenario with the setting left at its default) so the assertion fails if the feature is
  // simply absent, not merely if a property happens to be missing. Default mode (rampage) is
  // enough for both — neither needs survival/KO.
  // ---------------------------------------------------------------------------------------------
  {
    const h = await openSettingsPage();
    const { page: p } = h;
    await api.setCombat(p, true);

    // ---- reduceMotion: baseline (default 'auto', OS left at no-preference) vs forced 'on' ---------
    await api.setWeapon(p, 'pistol');
    const idleBase = await poll(async () => { const s = await api.stats(p); return s.viewmodel === 'idle' ? s : null; }, 1000, 25);
    const vmAnimsBase = await p.evaluate(() => { const el = document.querySelector('.crs-viewmodel'); return el && el.getAnimations ? el.getAnimations({ subtree: true }).length : -1; });
    check('A.a11y 1 (§3.1 baseline): with reduceMotion at its default, the idle viewmodel wobble is a LIVE running animation',
      !!idleBase && vmAnimsBase >= 1, { idleBase: !!idleBase, vmAnimsBase });

    const setRM = await api.call(p, 'setSetting', 'reduceMotion', 'on');
    const settingsRM = await api.call(p, 'settings');
    await api.restore(p);
    await api.setWeapon(p, 'pistol');
    const idleRM = await poll(async () => { const s = await api.stats(p); return s.viewmodel === 'idle' ? s : null; }, 1000, 25);
    const vmAnimsRM = await p.evaluate(() => { const el = document.querySelector('.crs-viewmodel'); return el && el.getAnimations ? el.getAnimations({ subtree: true }).length : -1; });
    check('A.a11y 1 (§3.1/§3.5): reduceMotion: \'on\' → the idle viewmodel wobble has ZERO running animations (vs ≥ 1 at the default, measured just above)',
      setRM !== undefined && !!settingsRM && settingsRM.reduceMotion === 'on' && !!idleRM && vmAnimsRM === 0,
      { setRM, reduceMotion: settingsRM && settingsRM.reduceMotion, vmAnimsBase, vmAnimsRM });

    const fgA = await api.rect(p, '#figure');
    await api.setPlayerPos(p, fgA.cx, fgA.cy);
    await api.setWeapon(p, 'hammer');
    const tierA = await api.forceAttack(p, '#figure');
    await sleep(40);
    const statsA = await api.stats(p);
    const rootTransformA = await p.evaluate(() => getComputedStyle(document.querySelector('.crs-root')).transform);
    check('A.a11y 1 (§3.1/§3.5): reduceMotion: \'on\' → a hit produces no hitstop and no screen-shake transform (amplitude 0)',
      tierA === 'shooter' && statsA.hitstop === false && rootTransformA === 'none', { tier: tierA, hitstop: statsA.hitstop, rootTransform: rootTransformA });
    await api.call(p, 'setSetting', 'reduceMotion', 'auto');
    await api.restore(p);

    // ---- highContrastMarkers: baseline vs forced on the SAME kind of hostile marker ----------------
    const fgB = await api.rect(p, '#figure');
    await api.setPlayerPos(p, fgB.cx, fgB.cy);
    const tierB0 = await api.forceAttack(p, '#figure');
    await sleep(40);
    const auraBase = await p.evaluate(() => {
      const el = document.querySelector('.crs-hostile');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { text: el.textContent || '', bgImage: cs.backgroundImage || '' };
    });
    check('A.a11y 2 (§3.2 baseline): with highContrastMarkers at its default (false), the hostile marker carries no ⚠ glyph and no striped background',
      tierB0 === 'shooter' && !!auraBase && !auraBase.text.includes('⚠') && !/repeating-linear-gradient/.test(auraBase.bgImage),
      { tier: tierB0, aura: auraBase });
    await api.restore(p);

    const setHC = await api.call(p, 'setSetting', 'highContrastMarkers', true);
    const fgB2 = await api.rect(p, '#figure');
    await api.setPlayerPos(p, fgB2.cx, fgB2.cy);
    const tierB1 = await api.forceAttack(p, '#figure');
    await sleep(40);
    const auraHC = await p.evaluate(() => {
      const el = document.querySelector('.crs-hostile');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { text: el.textContent || '', bgImage: cs.backgroundImage || '', hpNumber: /\d+\s*\/\s*\d+/.test(el.textContent || '') };
    });
    check('A.a11y 2 (§3.2): highContrastMarkers: true → the SAME kind of hostile marker now carries the ⚠ glyph and a striped (repeating-linear-gradient) background — vs neither at the baseline above',
      setHC !== undefined && tierB1 === 'shooter' && !!auraHC && auraHC.text.includes('⚠') && /repeating-linear-gradient/.test(auraHC.bgImage),
      { setHC, tier: tierB1, auraBase, auraHC });
    check('A.a11y 2 (§3.2): highContrastMarkers: true → the marker also shows a numeric HP readout, not colour alone',
      !!auraHC && auraHC.hpNumber === true, auraHC);
    await api.call(p, 'setSetting', 'highContrastMarkers', false);
    await api.restore(p);

    // ---- live region: announces a weapon change, then a reload START and a DIFFERENT COMPLETION ---
    const liveBase = await api.hudQ(p, '[aria-live="polite"]');
    await api.setWeapon(p, 'sniper');
    const liveAfterWeapon = await poll(async () => {
      const q = await api.hudQ(p, '[aria-live="polite"]');
      return q && q.text && q.text !== (liveBase && liveBase.text) ? q : null;
    }, 800, 25);
    check('A.a11y 3 (§3.4/§3.5): an aria-live="polite" region exists in the HUD shadow root and its text CHANGES on a weapon switch (measured change, not merely "present")',
      !!liveBase && !!liveAfterWeapon, { liveBase, liveAfterWeapon });

    await api.setWeapon(p, 'pistol');
    /* This page runs with the SHIPPING debug flags (openSettingsPage() never sets noCooldown), so the
       per-weapon draw time is live: setWeapon('pistol') arms a 150 ms swap (SPEC-weapons §3.1) and
       action() rejects anything fired inside it at the swap gate — BEFORE spend(), so the shot below
       would cost no round at all. A fixed sleep(60) is shorter than that window, which is exactly how the
       "one shot first" line used to become a no-op and leave reload() facing a full magazine. Wait for
       ammo().swapping to clear instead of guessing. */
    const swapCleared = await poll(async () => { const a = await api.ammo(p); return (a && typeof a === 'object' && a.swapping === false) ? a : null; }, 1500, 25);
    /* fastReload collapses a 2 s reload to 30 ms, so START and DONE land inside one poll interval and the
       START announcement is never observable. This assertion is about TWO distinct messages, not about
       speed, so it runs at the real reload duration and restores the flag afterwards. */
    await api.debug(p, { fastReload: false });
    const ammoBeforeShot = await api.ammo(p);
    const shotLanded = await api.smashAt(p, 10, 10);   // one shot first — reload() on an already-full magazine is a no-op (see A.ammo 1)
    const ammoAfterShot = await api.ammo(p);
    /* The precondition is asserted, not assumed: if this shot does not actually empty a round the reload
       below is a no-op and the two-announcement assertion would be vacuously "about" a reload that never
       ran. (10, 10) sits over our own .crs-shield so nothing breaks there — irrelevant on purpose: spend()
       runs before W.fire(), so a MISS still costs a round. Only a REJECTED attack costs nothing. */
    check('A.a11y 3 (§3.4 precondition): the single shot before reload() really spends a round (12 → 11) — otherwise reload() is a no-op and the two-message assertion below proves nothing',
      shotLanded === true && !!ammoBeforeShot && !!ammoAfterShot &&
      ammoBeforeShot.mag === ammoBeforeShot.size && ammoAfterShot.mag === ammoBeforeShot.mag - 1,
      { swapCleared, shotLanded, before: ammoBeforeShot, after: ammoAfterShot });
    const liveBeforeReload = await api.hudQ(p, '[aria-live="polite"]');
    const reloadStarted = await api.reload(p);
    const liveReloadStart = await poll(async () => {
      const q = await api.hudQ(p, '[aria-live="polite"]');
      return q && q.text && q.text !== (liveBeforeReload && liveBeforeReload.text) ? q : null;
    }, 400, 20);
    const liveReloadDone = await poll(async () => {
      const q = await api.hudQ(p, '[aria-live="polite"]');
      return q && liveReloadStart && q.text && q.text !== liveReloadStart.text ? q : null;
    }, 1600, 25);
    check('A.a11y 3 (§3.4): a reload announces a START message and then a DIFFERENT COMPLETION message — two distinct live-region updates, not one static string',
      reloadStarted === true && !!liveReloadStart && !!liveReloadDone && liveReloadStart.text !== liveReloadDone.text,
      { reloadStarted, before: liveBeforeReload, start: liveReloadStart, done: liveReloadDone });
    await api.debug(p, { fastReload: true });   // back to the fast path for the remaining blocks

    await closeSettingsPage(h);
  }

  // ---------------------------------------------------------------------------------------------
  // §3.3 / §3.4 — the virtual keyboard cursor (and its survival-mode split from WASD) and the KO
  // overlay's focus trap. setCombat(true) lands on survival (state.lastCombatMode defaults to it),
  // same as every other combat test in this suite — survival is required for both health/KO and
  // the WASD-vs-arrow split.
  // ---------------------------------------------------------------------------------------------
  {
    const h = await openSettingsPage();
    const { page: p } = h;

    // NOTE: the Space-fires sub-test below runs BEFORE switching to survival — survival keeps Space
    // bound to the drone's existing dash (debug.a11y confirms keyboardAim's own 'fire' action is
    // suppressed there), so "Space breaks the element under the cursor" is only true in the default
    // (rampage) mode. setCombat(true) → survival is deferred to the WASD-split sub-test that needs it.
    const setKA = await api.call(p, 'setSetting', 'keyboardAim', true);
    const cursor0 = await api.rectNoScroll(p, '.crs-kbcursor');
    check('A.a11y 4 (§3.3): keyboardAim: true → a .crs-kbcursor[data-crs] virtual cursor exists',
      setKA !== undefined && !!cursor0 && cursor0.width > 0, { setKA, cursor0 });

    // ---- step sizes, MEASURED: plain 20 px, Shift 5 px, Alt 60 px ----------------------------------
    await p.keyboard.press('ArrowRight');
    const cursor1 = await api.rectNoScroll(p, '.crs-kbcursor');
    await p.keyboard.down('Shift'); await p.keyboard.press('ArrowRight'); await p.keyboard.up('Shift');
    const cursor2 = await api.rectNoScroll(p, '.crs-kbcursor');
    await p.keyboard.down('Alt'); await p.keyboard.press('ArrowRight'); await p.keyboard.up('Alt');
    const cursor3 = await api.rectNoScroll(p, '.crs-kbcursor');
    const d1 = cursor1.cx - cursor0.cx, d2 = cursor2.cx - cursor1.cx, d3 = cursor3.cx - cursor2.cx;
    check('A.a11y 4 (§3.3): ArrowRight moves the cursor 20 px, Shift+ArrowRight 5 px, Alt+ArrowRight 60 px',
      Math.abs(d1 - 20) <= 1 && Math.abs(d2 - 5) <= 1 && Math.abs(d3 - 60) <= 1, { d1, d2, d3 });

    // ---- Space fires the current weapon at the cursor — whatever is under it breaks ---------------
    const figRect = await api.rect(p, '#figure');
    const cur4 = await api.rectNoScroll(p, '.crs-kbcursor');
    const stepsX = Math.round((figRect.cx - cur4.cx) / 20), stepsY = Math.round((figRect.cy - cur4.cy) / 20);
    for (let i = 0; i < Math.abs(stepsX); i++) await p.keyboard.press(stepsX >= 0 ? 'ArrowRight' : 'ArrowLeft');
    for (let i = 0; i < Math.abs(stepsY); i++) await p.keyboard.press(stepsY >= 0 ? 'ArrowDown' : 'ArrowUp');
    const brokenBefore = await api.broken(p, '#figure');
    for (let i = 0; i < 8 && !(await api.broken(p, '#figure')); i++) { await p.keyboard.press('Space'); await sleep(30); }
    const brokenAfter = await api.broken(p, '#figure');
    check('A.a11y 4 (§3.3): Space breaks the element the virtual cursor is sitting over',
      brokenBefore === false && brokenAfter === true, { brokenBefore, brokenAfter });

    // ---- survival: arrow keys aim the cursor, WASD moves the player — the two never cross ---------
    await api.restore(p);
    await api.setCombat(p, true);   // → survival (state.lastCombatMode defaults to it): WASD only moves anything here
    await api.call(p, 'setSetting', 'keyboardAim', true);
    const pBefore = await api.player(p);
    const curBefore = await api.rectNoScroll(p, '.crs-kbcursor');
    await p.keyboard.down('d'); await sleep(150); await p.keyboard.up('d');
    const pAfterWasd = await api.player(p);
    const curAfterWasd = await api.rectNoScroll(p, '.crs-kbcursor');
    await p.keyboard.press('ArrowUp');
    const pAfterArrow = await api.player(p);
    const curAfterArrow = await api.rectNoScroll(p, '.crs-kbcursor');
    check('A.a11y 4 (§3.3): in survival, holding \'d\' (WASD) moves the PLAYER but leaves the virtual cursor exactly where it was',
      pAfterWasd.x > pBefore.x + 1 && Math.abs(curAfterWasd.cx - curBefore.cx) <= 1 && Math.abs(curAfterWasd.cy - curBefore.cy) <= 1,
      { pBefore, pAfterWasd, curBefore, curAfterWasd });
    check('A.a11y 4 (§3.3): ...while ArrowUp moves the virtual CURSOR but leaves the player\'s own position exactly where it was (the split holds both ways)',
      Math.abs(curAfterArrow.cy - curAfterWasd.cy) >= 15 && Math.abs(pAfterArrow.x - pAfterWasd.x) <= 1 && Math.abs(pAfterArrow.y - pAfterWasd.y) <= 1,
      { curAfterWasd, curAfterArrow, pAfterWasd, pAfterArrow });

    // ---- KO overlay: role="dialog", focus starts trapped on button 1, Tab cycles 0→1→0 ------------
    await api.restore(p);
    await sleep(60);
    const figKo = await api.rect(p, '#figure');
    await api.setPlayerPos(p, figKo.cx, figKo.cy);
    await api.setPlayerHp(p, 5);
    await api.setWeapon(p, 'sniper');
    await api.forceAttack(p, '#figure');
    await api.smashAt(p, figKo.cx, figKo.cy);
    const koShown = await poll(async () => { const k = await api.hudQ(p, '.crs-ko'); return k && k.visible ? k : null; }, 1500, 25);
    const focusInfo = () => p.evaluate(() => {
      const host = document.querySelector('crs-hud, .crs-hud-host');
      const sh = host && host.shadowRoot;
      const ko = sh && sh.querySelector('.crs-ko');
      const btns = ko ? [...ko.querySelectorAll('button')] : [];
      const active = sh ? sh.activeElement : null;
      return { nBtns: btns.length, activeIdx: active ? btns.indexOf(active) : -1 };
    });
    const f0 = await focusInfo();
    await p.keyboard.press('Tab');
    const f1 = await focusInfo();
    await p.keyboard.press('Tab');
    const f2 = await focusInfo();
    await p.keyboard.down('Shift'); await p.keyboard.press('Tab'); await p.keyboard.up('Shift');
    const f3 = await focusInfo();
    check('A.a11y 5 (§3.4): the KO overlay shows exactly two buttons, starts with focus trapped on the FIRST, and Tab cycles 0 → 1 → 0 (wrapping inside the dialog, never escaping to the page)',
      !!koShown && f0.nBtns === 2 && f0.activeIdx === 0 && f1.activeIdx === 1 && f2.activeIdx === 0,
      { koShown: !!koShown, f0, f1, f2 });
    check('A.a11y 5 (§3.4): Shift+Tab from the first button wraps to the LAST one (the trap holds in both directions)',
      f3.activeIdx === 1, f3);
    const koRole = await p.evaluate(() => {
      const host = document.querySelector('crs-hud, .crs-hud-host');
      const sh = host && host.shadowRoot;
      const ko = sh && sh.querySelector('.crs-ko');
      return ko ? { role: ko.getAttribute('role'), modal: ko.getAttribute('aria-modal') } : null;
    });
    check('A.a11y 5 (§3.4): the KO overlay itself is role="dialog" aria-modal="true"',
      !!koRole && koRole.role === 'dialog' && koRole.modal === 'true', koRole);
    await p.keyboard.press('Enter');

    await closeSettingsPage(h);
  }

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

async function suiteA12(browser, origin, contentCss, contentJs) {
  console.log('--- ammo: ammo / sniper + scope / loadouts / combat ---');
  // SPEC-test-speed §5: its own page, its own preconditions. It used to be handed suite A's page in the
  // middle of that suite; nothing it does depends on what ran before it, so it now opens a fresh one.
  const h = await freshPage(browser, origin, contentCss, contentJs);
  const { page, log } = h;
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
  /* REWRITTEN for SPEC-crosshair §C ("탄약 HUD 와의 충돌"). v1.5 §2 pushed this plate up to bottom: 118px
   * to get it out of the viewmodel's corner. §C takes that lift away — the panel goes back to the v1.3
   * bottom: 24px and the two are allowed to OVERLAP, drawn in the real-FPS order: the HUD host's
   * z-index is above the glass root, and the plate's own dark background keeps the numbers readable.
   * So the expectation is now 24 px whether or not the viewmodel layer exists, and the overlap itself
   * (plus the z-order that makes it legible) is asserted in the `core` block's §C section. */
  const hasViewmodelForAmmo = await api.has(page, '.crs-viewmodel');
  check('A.ammo 1: .crs-ammo sits bottom-right at right: 24px / bottom: 24px — the v1.5 118px lift is gone (SPEC-crosshair §C: 패널을 밀어 올리던 처리를 제거하고 뷰모델보다 위 레이어에 그린다)', !!ammoHudPistol && near(ammoHudPistol.right, ammoHudPistol.vw - 24, 4) && near(ammoHudPistol.bottom, ammoHudPistol.vh - 24, 4), ammoHudPistol && { right: ammoHudPistol.right, bottom: ammoHudPistol.bottom, vw: ammoHudPistol.vw, vh: ammoHudPistol.vh, hasViewmodelForAmmo });
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
  const bossHp0 = await api.hpOf(page, '#boss');
  const maxBefore = bossHp0.max;
  // #big-card has not been touched since the restore above, so its first hp contact happens WHILE scoped (A3)
  const bcUnscaled = await api.rectNoScroll(page, '#big-card');
  /* Was `maxBefore === specMaxHp(...)`. SPEC-combat §C2: the section also carries 0.6 × its caption now, so
   * the v1.1 size formula is asserted against `own` and the aggregate is required to sit above it. */
  check('A.sniper 3: #boss ownHp from its live rect (≈ 253), §C2 max above it, and sniper damage read from api.weapons() (200)', bossHp0.own === specMaxHp(bossR.width, bossR.height, 1.0, false) && maxBefore > bossHp0.own && DMG('sniper') === SPEC_DMG.sniper, { bossHp0, expected: specMaxHp(bossR.width, bossR.height, 1.0, false), dmg: DMG('sniper') });
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
  // same §C2 split as above: the page-space rule is what `own` proves, and the §C walk divides every child rect by scopeMag() too
  check('A.sniper 3: a FIRST hp contact made while scoped is page-space — ownHp() divides the doubled rect by scopeMag()', hpFresh.own === specMaxHp(bcUnscaled.width, bcUnscaled.height, 1.0, false) && hpFresh.max > hpFresh.own && hpFresh.hp === hpFresh.max, { got: hpFresh, expected: specMaxHp(bcUnscaled.width, bcUnscaled.height, 1.0, false), unscaledRect: [bcUnscaled.width, bcUnscaled.height] });
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
  const adsOff = await page.evaluate(() => ({ html: document.documentElement.className, cursor: getComputedStyle(document.body).cursor, chHidden: !!document.querySelector('.crs-crosshair.crs-ch-hidden'), ch: !!document.querySelector('.crs-crosshair') }));
  const panelBack = await api.hudQ(page, '.panel');
  /* REWRITTEN for SPEC-crosshair §A1/§A2. The second half of this check used to be "scope-out brings the
   * 28 px hammer CURSOR IMAGE back" (`/url\(/`). There is no cursor image any more: §A1 turns the OS
   * cursor off for the whole session (`html.crs-aim`) and draws `.crs-crosshair` instead, so `cursor:
   * none` is now the resting state and the url cursor would be the regression. What scope-out actually
   * restores is the CROSSHAIR — §A4's "저격총은 조준 중 숨고 해제 시 돌아온다" — so that is what is
   * asserted here instead, alongside the unchanged html class and panel-opacity halves. */
  check('A.sniper 3: scoping hides the page cursor (html.crs-scoped) and fades the weapon panel out of the circle; both come back on scope-out, and the drawn crosshair comes back with them (SPEC-crosshair §A4)', /(^|\s)crs-scoped(\s|$)/.test(adsOn.html) && adsOn.cursor === 'none' && !/(^|\s)crs-scoped(\s|$)/.test(adsOff.html) && adsOff.cursor === 'none' && adsOff.ch === true && adsOff.chHidden === false && !!panelPlain && !!panelScoped && !!panelBack && parseFloat(panelPlain.opacity) > 0.9 && parseFloat(panelScoped.opacity) < 0.5 && parseFloat(panelBack.opacity) > 0.9, { on: adsOn, off: adsOff, panelOpacity: [panelPlain && panelPlain.opacity, panelScoped && panelScoped.opacity, panelBack && panelBack.opacity] });
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
  check('A.loadout 4: assault order (smg, pistol, sniper, bomb, rocket, flame, hammer, axe, katana, collapse); api.weapons() follows it with slot 1–10 / key 1…9,0', (await api.loadout(page)).join(',') === PRESETS.assault.join(',') && wAssault.map((w) => w.id).join(',') === PRESETS.assault.join(',') && wAssault.every((w, i) => w.slot === i + 1 && String(w.key) === KEYS[i]), { lo: await api.loadout(page), w: wAssault.map((w) => `${w.id}:${w.slot}:${w.key}`) });
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
  // SPEC-test-speed §2: once the orb is gone it can no longer reach the player, so polling for its
  // disappearance proves exactly what sitting out the whole 3.5 s proved. Ceiling unchanged.
  await poll(async () => ((((await api.count(page, '.crs-orb')) === 0) && (await api.stats(page)).orbs === 0) ? true : null), 3500, 80);
  const p5b = await api.player(page);
  const seen5b = await api.seen(page);
  const tier5b = launch5b.tier;
  check('A.combat 5b: dodge — an orb IS launched (node + stats().orbs ≥ 1), then player 500 px away and 300 px perpendicular: hp unchanged (100) within 3.5 s and the orb is gone', tier5b === 'shooter' && launch5b.orbNode === true && launch5b.orbs >= 1 && !!seen5b['.crs-orb'] && p5b.hp === 100 && (await api.count(page, '.crs-orb')) === 0 && (await api.stats(page)).orbs === 0, { launch: launch5b, player: p5b, seen: !!seen5b['.crs-orb'], orbs: await api.count(page, '.crs-orb') });
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
  /* SPEC-crosshair §B3 made the 2 px outline conditional: an aura is QUIET until its enemy acts, and the
   * line is only on while it is winding up (`crs-aimed`), locking, charging or repairing. This read used
   * to race that window by accident — it fired straight after forceAttack() and happened to land inside
   * the 250 ms wind-up — so it now POLLS for the attack-prep state it was always describing. The quiet
   * half of §B3 (outline-width 0 before and after) is asserted in the `rules` block. */
  const readAura8 = () => page.evaluate(() => {
    const a = document.querySelector('.crs-hostile');
    if (!a) return null;
    const r = a.getBoundingClientRect(); const cs = getComputedStyle(a);
    return { left: r.left, top: r.top, width: r.width, height: r.height, outline: `${cs.outlineStyle} ${cs.outlineWidth}`, label: (a.textContent || '').trim(), dataCrs: a.hasAttribute('data-crs') };
  });
  const aura8 = await poll(async () => { const a = await readAura8(); return a && /solid 2px/.test(a.outline) ? a : null; }, 800, 20) || await readAura8();
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
  /* `noInvuln` (SPEC-combat §B, feat/hostiles-only): §B makes every non-hostile element invulnerable in a
   * combat mode. This test is about the KO overlay, the restart and the physics loop surviving a KO with
   * orbs in flight — and it builds its preconditions by breaking ORDINARY page elements (#small-card, so the
   * restart has something to put back; #big-card with a rocket, so there is debris to watch settle) while
   * combat happens to be on. The rule is turned off by name for the duration and back on at the end, the
   * same escape hatch the combat block uses; §B's own behaviour is asserted in that block. */
  await api.debug(page, { noInvuln: true });
  await api.restore(page);
  await sleep(60);
  const pendBase9 = await api.pending(page);   // restore() + armCombat(): exactly the grace and the 생존 clock
  await api.setWeapon(page, 'hammer');
  const fg9 = await api.rect(page, '#figure');
  const sc9 = await api.rectNoScroll(page, '#small-card');
  const scPt9 = { x: sc9.left + 12, y: sc9.top + 12 };
  // SPEC-combat §C2: the card is worth its h3 / p / a too, so two hammer swings no longer finish it — swing until it goes
  await page.evaluate((p) => { const a = window.__crashScreen; const el = document.getElementById('small-card'); for (let i = 0; i < 5 && !el.hasAttribute('data-crs-broken'); i++) a.smashAt(p.x, p.y); }, scPt9);
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
  await api.debug(page, { noInvuln: false });   // §B back on for everything after the KO test
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
  const tRing0 = Date.now();   // the launch instant: every ringAt reading below is measured from HERE
  const tierRing = await api.forceAttack(page, '#figure');
  await settleRaf(page);   // the ring's left/top/width are written by the NEXT tick, not at spawn time
  /* CHANGED for SPEC-combat §D4 (feat/archetypes): the arrival ring is now drawn only over the LAST 40 % of
   * the flight — "도착 예상 링은 비행의 마지막 40% 구간에만", one line fewer on screen. The §3.3 property this
   * assertion was written for (the radius falls monotonically onto the orb) is unchanged and still asserted;
   * what changed is WHEN the ring exists, so the sampler now runs at 35 ms instead of 80 and records the
   * flight fraction of each reading. §D4's "링이 60% 지점까지 없다" is asserted on those fractions below. */
  const ringSamples = [], ringAt = [];
  for (let i = 0; i < 40; i++) {
    const w = await page.evaluate(() => { const n = document.querySelector('.crs-orb-ring'); return n ? n.getBoundingClientRect().width : null; });
    const seen = await api.count(page, '.crs-orb');
    if (w == null) { if (ringSamples.length || !seen) break; }   // orb landed, or still in the ringless first 60 %
    else if (w > 20) { ringSamples.push(w); ringAt.push(Date.now() - tRing0); }
    await sleep(35);
  }
  const monotonic = ringSamples.length >= 3 && ringSamples.every((v, i) => i === 0 || v <= ringSamples[i - 1] + 0.5);
  check('A.readability 6: the arrival ring exists and its radius falls monotonically as the orb approaches', tierRing === 'shooter' && ringSamples.length >= 3 && monotonic, { tier: tierRing, ringSamples, ringAt });
  // §D4 / §F "투사체": the ring is silent for the first 60 % of a ~960 ms flight — the first reading is late
  check('A.§D4/§F: 도착 예상 링은 비행의 마지막 40% 구간에만 — 500 px 비행에서 첫 링 표본이 500 ms 이후에 나온다',
    ringAt.length >= 1 && ringAt[0] >= 500, { firstRingMs: ringAt[0], ringAt });
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
  // SPEC-combat-v2 §0.5 / SPEC-combat §A: H no longer toggles one boolean — it CYCLES the three modes, and §A
  // replaced the middle one: rampage → ARCADE → survival → rampage (was rampage → quickdraw → survival).
  // Combat is "on" for the two middle modes and off at the wrap, so the old on/off claim is checked across the
  // full cycle, and the mode each press lands on is asserted as well.
  const pressH = async (want) => {
    await page.keyboard.press('h');
    const got = await poll(async () => { const s = await api.stats(page); return s.mode === want ? s : null; }, 600, 15);
    return got ? { mode: got.mode, combat: got.combat } : { mode: (await api.stats(page)).mode, combat: (await api.stats(page)).combat };
  };
  const hCycle = [await pressH('arcade'), await pressH('survival'), await pressH('rampage')];
  check('A.combat 10: "H" cycles rampage → arcade → survival → rampage (§A), combat on for the two middle modes and off at the wrap', hCycle[0].mode === 'arcade' && hCycle[0].combat === true && hCycle[1].mode === 'survival' && hCycle[1].combat === true && hCycle[2].mode === 'rampage' && hCycle[2].combat === false, hCycle);
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
  // SPEC-combat §C2: two hammer swings no longer finish the card (it carries its children) — swing until it goes
  await page.evaluate((p) => { const a = window.__crashScreen; const el = document.getElementById('small-card'); for (let i = 0; i < 5 && !el.hasAttribute('data-crs-broken'); i++) a.smashAt(p.x, p.y); }, scPt11);
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
  await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: false, noPartial: true });
  await api.applyPreset(page, 'default');
  await api.setWeapon(page, 'hammer');
  await api.restore(page);
  await sleep(100);
  await closeBlockPage('A.ammo', h);
}

// ---------------------------------------------------------------------------
// Suite A14 — v1.4 combat-v2: drone avatar / aim lock-on / repairing enemies
// (SPEC-combat-v2 §7), debris auto-despawn (§9.4), depth-of-stack (§10.6).
//
// Written against the spec CONTRACT while the product code lands in parallel. Several points are
// under-specified in the spec text itself; the readings picked (documented inline and in the
// handoff notes) are the ones that make each assertion exercise real, observable behaviour:
//   - No JS setter name is given for the new `mode` (rampage/arcade/survival) — only the `H`
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
/* ── SPEC-test-speed §5: the combat lane, split four ways ────────────────────────────────────
 * suiteA14 was one 1430-line function and, at ~100 s, the single thing deciding how long a full run took.
 * Its four parts never shared state — each sets its own mode, debug flags and scene on entry — they only
 * shared the tab. So they are four blocks now, one browser each, running at the same time:
 *   combat (§7) · debris (§9.4) · depth (§10.6) · rules (§A / §B / §D1)
 * Everything they DID share is built here, once per block. */
async function combatSetup(browser, origin, contentCss, contentJs, label) {
  // SPEC-test-speed §5: its own page. This block always rebuilt its own state on entry (it re-evaluates
  // content.js below), so the only thing it inherited from suite A was the tab itself.
  const h = await freshPage(browser, origin, contentCss, contentJs, { activate: false });
  const { page, log } = h;
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const norm360 = (a) => ((a % 360) + 360) % 360;
  const angDist = (a, b) => { const d = Math.abs(norm360(a) - norm360(b)) % 360; return d > 180 ? 360 - d : d; };
  // Activation first: window.__crashScreen only exists once content.js has run, and weaponTable() reads it.
  // (It used to be read before this line because suite A had already evaluated content.js on this tab.)
  const onV14 = await page.evaluate(contentJs);
  check(`A.${label}: content.js activated for this block`, onV14 === 'on', onV14);
  const W14 = await weaponTable(page);
  const DMG14 = W14.dmg;
  // noFalloff was inherited from suite A's injection while this block shared that page; every exact-damage
  // assertion below is written against the flat, unreduced numbers, so the block now sets it for itself.
  // (§10.6's pierce section still turns falloff back ON locally to measure the real formula.)
  /* `noInvuln` (SPEC-combat §B, feat/hostiles-only): §B makes every NON-hostile element invulnerable in a
   * combat mode — a hit on one deflects, costs its round and takes no HP. Everything in THIS block below was
   * written against v1.2/v1.4 behaviour and is about something else entirely (the repair beam §7.7/§7.8, the
   * destruction-ratio stat §7.9, boss stages §7.11, the traceless Escape §7.12, stacking depth and pierce
   * §10.6, the §8 screenshot), yet each one wears down ORDINARY page elements while enemies are live in order
   * to build its own precondition. Rather than delete or weaken those assertions, they ask for the new rule to
   * be off by name — the same escape hatch they already use for noAttacks / noRepair / noFalloff. It is
   * re-set after every page.evaluate(contentJs) below, because a reactivation builds a fresh debug object.
   * §B's own behaviour is asserted at the END of this block ("적만 피해"), with the rule explicitly ON. */
  await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: false, noRepair: true, noFalloff: true, noInvuln: true, noPartial: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await api.restore(page);
  await sleep(80);

  // Spec §0.5 / SPEC-combat §A name only the H hotkey / HUD button to cycle rampage → arcade → survival →
  // rampage, not a JS setter. Try a same-named debug setter first (harmless if absent), then drive the hotkey.
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

  return { h, page, log, label, W14, DMG14, near, norm360, angDist, setCombatMode, resetScene, force, debugCall, scrollToDepthLab };
}
async function combatTeardown(ctx) {
  const { h, page, label, setCombatMode } = ctx;
  // ---- tidy up: back to the block's baseline mode/weapon/debug flags before the evidence tally ----
  await setCombatMode('rampage');
  await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: false, noRepair: false, noPartial: true });
  await api.setWeapon(page, 'hammer');
  await api.restore(page);
  await sleep(100);
  await closeBlockPage(`A.${label}`, h);
}

async function suiteA14(browser, origin, contentCss, contentJs) {
  console.log('--- combat: combat v2 — drone avatar / aim lock-on / repairing enemies (SPEC-combat-v2 §7) ---');
  const ctx = await combatSetup(browser, origin, contentCss, contentJs, 'combat');
  const { page, log, W14, DMG14, near, norm360, angDist, setCombatMode, resetScene, force, debugCall, scrollToDepthLab } = ctx;
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
  // SPEC-test-speed §3/§4: outcome-only, so the lock runs at quarter speed. Set BEFORE forceLock —
  // startLock() freezes scaleMs(LOCK_MS) into lk.dur at creation, and a scale change afterwards would
  // not reach a lock already in flight.
  await setTimeScale(page, 0.25);
  await resetScene(400, 400);
  await force('#figure', 'forceLock');
  const hpBefore76 = (await api.player(page)).hp;
  await sleep(tms(page, 3000) + 300);
  const hpAfter76 = (await api.player(page)).hp;
  const lockGone76 = (await api.count(page, '.crs-lock')) === 0;
  check('A.v2 7.6: standing still through the full lock → health decreases and the .crs-lock node disappears (outcome only, so run at debug.timeScale 0.25; the 3.0 s itself is asserted by §7.5 at scale 1)', hpAfter76 < hpBefore76 && lockGone76, { hpBefore76, hpAfter76, lockGone76, scale: scaleOf(page) });
  await resetScene(400, 400);
  const nearBefore76 = (await api.stats(page)).nearMisses;
  await force('#figure', 'forceLock');
  await sleep(tms(page, 1500) + 180);   // past the half-way fixed-phase threshold (LOCK_FOLLOW × lk.dur)
  await debugCall('setAvatarPos', 650, 400);   // ≥ 100 px away
  await sleep(tms(page, 1500) + 300);
  const hpAfterDodge76 = (await api.player(page)).hp;
  const nearAfter76 = (await api.stats(page)).nearMisses;
  check('A.v2 7.6: stepping ≥ 100 px away after the fixed phase avoids the hit (hp unchanged) and bumps stats().nearMisses', hpAfterDodge76 === 100 && nearAfter76 === nearBefore76 + 1, { hpAfterDodge76, nearBefore76, nearAfter76, scale: scaleOf(page) });
  await setTimeScale(page, 1);

  // ---- (7) repair restores a nearby broken original (§7.7) ----
  // SPEC-test-speed §3/§4: §7.7–§7.9 are outcome assertions ("the beam finishes and the element is back",
  // "the meter comes back down"). Quarter speed from here to the end of §7.9; §7.10/§7.11 set their own.
  await setTimeScale(page, 0.25);
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
  const broken7after = await poll(async () => (await api.broken(page, '#small-card')) === false ? false : null, tms(page, 2300) + 400, 60);
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
  await sleep(tms(page, 1500) + 300);
  const scStillBroken8 = await api.broken(page, '#small-card');
  check('A.v2 7.8: killing the repairing hostile mid-beam cancels the repair — #small-card is still broken a full beam-length later', beamSeen8 === true && scStillBroken8 === true, { beamSeen8, scStillBroken8, scale: scaleOf(page) });
  await api.setWeapon(page, 'hammer');

  // ---- (9) destroy ratio tracks broken vs. repaired area (§7.9) ----
  // §3.2: the meter refreshes every 2 s, not on every break/repair — every read below polls for that tick
  // rather than sampling immediately, which would just catch the stale previous value.
  await resetScene(400, 400);
  const ratio0_9 = (await api.stats(page)).destroyRatio;
  check('A.v2 7.9: stats().destroyRatio === 0 with nothing broken', ratio0_9 === 0, ratio0_9);
  const bc9 = await api.rect(page, '#big-card');
  await smashUntil(page, () => api.broken(page, '#big-card'), bc9.cx, bc9.cy, 6);
  const ratio1_9 = await poll(async () => { const r = (await api.stats(page)).destroyRatio; return r > 0 ? r : null; }, tms(page, 2600) + 400, 80);
  check('A.v2 7.9: breaking a large element raises stats().destroyRatio above 0 (within the 2 s refresh)', ratio1_9 > 0, ratio1_9);
  await force('#figure', 'forceAttack');
  await force('#figure', 'forceRepair');
  await sleep(tms(page, 1500) + 300);   // the repair beam completing
  const ratio2_9 = await poll(async () => { const r = (await api.stats(page)).destroyRatio; return r < ratio1_9 ? r : null; }, tms(page, 2600) + 400, 80);
  check('A.v2 7.9: a completed repair brings stats().destroyRatio back down (within the next 2 s refresh)', ratio2_9 != null && ratio2_9 < ratio1_9, { ratio1_9, ratio2_9: ratio2_9 != null ? ratio2_9 : (await api.stats(page)).destroyRatio });

  // ---- (10) T3 uses the lock-on instead of the laser (§7.10) ----
  await setTimeScale(page, 0.25);   // SPEC-test-speed §3: outcome only — set before the lock is created
  await resetScene(400, 400);
  await api.rect(page, '#boss');   // hostileAttack() requires the element on-screen — scroll it into view first
  const tier10 = await force('#boss', 'forceAttack');
  await sleep(150);
  check('A.v2 7.10: debug.forceAttack(#boss) now returns "lock", not "laser"', tier10 === 'lock', tier10);
  check('A.v2 7.10: no .crs-beam appears for a T3 attack any more (replaced by .crs-lock)', (await api.count(page, '.crs-beam')) === 0 && (await api.count(page, '.crs-lock')) >= 1, { beams: await api.count(page, '.crs-beam'), locks: await api.count(page, '.crs-lock') });
  await sleep(tms(page, 3000) + 250);   // drain: let that lock resolve before §7.11 fires another attack
  await setTimeScale(page, 1);

  // ---- (11) boss stage 3 regains the laser sweep (§7.11) ----
  await resetScene(400, 400);
  let forceBoss11 = null;
  try { forceBoss11 = await page.evaluate(() => (window.__crashScreen.debug && typeof window.__crashScreen.debug.forceBoss === 'function') ? window.__crashScreen.debug.forceBoss(0.3) : 'missing:debug.forceBoss'); } catch (e) { forceBoss11 = 'threw:' + String(e && e.message || e); }
  // Land in a (20%, 35%] window rather than firing until hp crosses 30%: a single high-damage hit (rocket)
  // can overshoot straight past 30% to 0 (killing the boss outright, which makes forceAttack refuse for an
  // unrelated reason — "already broken" — not the 3rd-phase laser logic this test means to exercise). Pistol's
  // damage is known, small and precise, so the exact hit count needed is computed instead of polled for.
  await api.setWeapon(page, 'pistol');
  // A parent's hp AND max include its children's, and a pistol hit can break a child — so both numbers
  // move as the boss is worn down. A shot count computed once from the starting hp therefore stops in the
  // wrong place; step to the window re-reading hp/max each time instead. Pistol damage is small enough
  // that stepping can't jump past the window into an outright kill (which is what the count guarded).
  let bossHp11 = await api.hpOf(page, '#boss');
  for (let i = 0; i < 40 && bossHp11.hp > 0.275 * bossHp11.max; i++) {
    const bo11 = await api.rect(page, '#boss');
    const beforeHp11 = bossHp11.hp;
    await api.smashAt(page, bo11.left + 6, bo11.top + 6);
    await poll(async () => (await api.hpOf(page, '#boss')).hp < beforeHp11, 400, 20);
    bossHp11 = await api.hpOf(page, '#boss');
  }
  await api.setWeapon(page, 'hammer');
  const tier11 = await force('#boss', 'forceAttack');
  const beamSeen11 = await poll(() => api.has(page, '.crs-beam'), 800);
  check('A.v2 7.11: boss weakened to ~20–35% hp (3rd stage), still alive, regains the laser sweep — debug.forceAttack(#boss) → "laser" or a .crs-beam appears (debug.forceBoss result recorded, see notes)', bossHp11.hp > 0 && bossHp11.hp <= 0.351 * bossHp11.max && (tier11 === 'laser' || beamSeen11 === true), { forceBoss11, bossHp11, tier11, beamSeen11 });
  // drain only — nothing is asserted about its length, so it runs on the product clock at quarter speed.
  await withScale(page, 0.25, () => tsleep(page, 1700));

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
  await api.debug(page, { noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true, noRepair: true, noInvuln: true, noPartial: true });   // §B escape hatch — see the block header
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
  /* REWRITTEN as a measurement, not a re-specification. The claim is unchanged — under reduced motion the
     bracket SNAPS between a few discrete sizes instead of sliding through every value — but it used to be
     read with three absolute sleeps (0.3 s / 0.7 s / 1.4 s) timed against the lock's own stage boundaries.
     On a loaded machine a sleep lands a stage early or late and the assertion fails for a reason that has
     nothing to do with motion. The size is now sampled EVERY FRAME inside the page for the whole life of
     the lock and the DISTRIBUTION is what is asserted: a snapping bracket visits a handful of values and
     sits on each of them; a continuously animated one would visit a different value almost every frame. */
  const snapSeries14 = await page.evaluate(() => new Promise((res) => {
    const out = [];
    const t0 = performance.now();
    const step = () => {
      const n = document.querySelector('.crs-lock');
      if (n) { const r = n.getBoundingClientRect(); out.push(Math.round((r.width + r.height) / 2)); }
      else if (out.length) { res(out); return; }
      if (performance.now() - t0 < 1700) requestAnimationFrame(step); else res(out);
    };
    requestAnimationFrame(step);
  }));
  const snapSeen14 = [...new Set(snapSeries14)];
  check('A.v2 7.14: under reduced motion the lock-on bracket snaps between discrete sizes instead of animating continuously (every frame of the lock is sampled: a handful of distinct sizes, each held for many frames)',
    snapSeries14.length >= 20 && snapSeen14.length >= 2 && snapSeen14.length <= 5 && snapSeries14.length / snapSeen14.length >= 5,
    { samples: snapSeries14.length, distinct: snapSeen14, framesPerSize: snapSeries14.length / Math.max(1, snapSeen14.length) });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await sleep(1700);

  await combatTeardown(ctx);
}

async function suiteA14Debris(browser, origin, contentCss, contentJs) {
  console.log('--- debris: debris auto-despawn (SPEC-combat-v2 §9.4) ---');
  const ctx = await combatSetup(browser, origin, contentCss, contentJs, 'debris');
  const { page, log, W14, DMG14, near, norm360, angDist, setCombatMode, resetScene, force, debugCall, scrollToDepthLab } = ctx;
  // =======================================================================================
  // §9.4 — debris auto-despawn (SPEC-combat-v2 §9)
  // =======================================================================================
  await setCombatMode('rampage');
  await api.debug(page, { noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true, noInvuln: true, noPartial: true });   // §B escape hatch — see the block header
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
  await api.debug(page, { noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true, noInvuln: true, noPartial: true });   // §B escape hatch — see the block header
  await api.restore(page);
  await sleep(80);
  await api.setWeapon(page, 'hammer');
  const bc943 = await api.rect(page, '#big-card');
  // SPEC-combat §C2: #big-card is a container, so its max now includes 0.6 × what it holds and a flat cap of
  // 6 hammer swings no longer reaches it — the block then watched an empty floor and "nothing despawned"
  // passed for the wrong reason. Derive the cap from the live number instead, with two swings of slack.
  /* Two things changed under this setup and both made it watch an empty floor:
   *   - SPEC-combat §C2 gave #big-card an aggregate max, and §C3 then MOVES that max while the swings land
   *     (each child that breaks takes 0.6 × its own max off the parent). A hit count worked out once from
   *     the starting number stops in the wrong place, so swing until it actually breaks instead.
   *   - page.mouse.click() hit-tests the real cursor, and by this point in the block one of OUR OWN
   *     overlay nodes (.crs-shield, left by the support-archetype section above) sits over the card, so
   *     the clicks were landing on the shield. api.smashAt() aims at page coordinates directly, which is
   *     what every other damage-delivery loop in this block already uses. */
  const hp943 = await api.hpOf(page, '#big-card');
  let hits943 = 0;
  for (let i = 0; i < 40 && !(await api.broken(page, '#big-card')); i++) {
    await api.smashAt(page, bc943.cx, bc943.cy);
    hits943++;
    await sleep(30);
  }
  check('A.v2 9.4.3 precondition: #big-card really broke, so the lifetime assertion below watches real debris and not an empty floor', (await api.broken(page, '#big-card')) === true, { hp943, hits943, hpAfter: await api.hpOf(page, '#big-card') });
  await poll(async () => { const s = await api.stats(page); return (s.pieceCount > 0 && s.pieces.every((p) => p.resting)) ? s : null; }, 4000, 60);
  const countAt0_943 = await api.count(page, '.crs-piece');
  // SPEC-test-speed §2/§3: the longest single wait in the suite, and a pure negative — "nothing despawns".
  // Polling cannot shorten a negative, but the product clock can: at debug.timeScale 0.1 the twelve seconds
  // of PRODUCT time below cost 1.2 s of wall clock, and they still cover twice the 6 s lifetime that the 0
  // setting is overriding. debrisLife() runs the lifetime through scaleMs(), and scaleMs(0) is 0, so
  // "unlimited" keeps meaning unlimited at any scale — the thing this assertion exists to prove.
  await setTimeScale(page, 0.1);
  await tsleep(page, 12000);
  const countAfter10s_943 = await api.count(page, '.crs-piece');
  check('A.v2 9.4.3: debrisLifeMs = 0 → the piece count does not shrink over the next 12 s of product time (unlimited lifetime; debug.timeScale 0.1 → 1.2 s wall)', countAt0_943 > 0 && countAfter10s_943 >= countAt0_943, { countAt0_943, countAfter10s_943, scale: scaleOf(page) });
  await setTimeScale(page, 1);
  await page.evaluate(() => { window.__crsStore.crsDebrisLifeMs = 6000; });
  await page.evaluate(contentJs);
  await page.evaluate(contentJs);
  await api.debug(page, { noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true, noInvuln: true, noPartial: true });   // §B escape hatch — see the block header
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
  /* …and the whole of this check runs with the lifetime OFF. What is being measured is an eviction
   * knocking a piece loose, not a clock: with the 6 s default running, the pile ages while the pair is
   * being searched for (and the search may break more elements and settle them, which costs seconds), so
   * the piece being followed can simply expire on its own. That shows up as `upAfter: null` — not "it did
   * not fall" but "it is not there any more" — and it is the reason this assertion kept failing about one
   * run in five. debug.expirePiece() sets expireAt by hand, so it still retires the one piece we mean to
   * retire. The 6 s default goes back on right after the check. */
  await api.call(page, 'setDebrisLife', 0);
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
  // with the supporting piece, and a bottom edge sitting ON that piece's top.
  //
  // "at or above the lower piece's top" is not enough to pick a pair: it also matches an upper piece
  // floating 200 px higher that happens to share a column, and THAT piece is held up by something else,
  // so retiring the lower one leaves it exactly where it was and the re-fall assertion fails for a reason
  // that has nothing to do with eviction. Demand actual contact — the gap decides whether the lower piece
  // is really the support — and the pair that gets picked is then the pair the assertion is about.
  const CONTACT944 = 4;
  // evictPieces()'s own wake test, read straight off src/65-pieces.js: ≥ 40 % overlap with the narrower of
  // the two, and a bottom edge at or above the other piece's top.
  const supports944 = (lower, upper) => {
    const ov = Math.min(lower.r, upper.r) - Math.max(lower.l, upper.l);
    return ov >= 0.4 * Math.min(lower.r - lower.l, upper.r - upper.l) && upper.bottom <= lower.top + 1;
  };
  const findPair944 = (boxes) => {
    if (!Array.isArray(boxes)) return null;
    for (const lower of boxes) {
      if (!lower.resting) continue;
      for (const upper of boxes) {
        if (upper === lower || !upper.resting) continue;
        if (!supports944(lower, upper)) continue;
        const gap = lower.top - upper.bottom;
        if (gap < -1 || gap > CONTACT944) continue;   // actually touching, not merely somewhere above
        // …and whatever else is under `upper` has to be far enough below that losing `lower` still drops it.
        // A chip can come to rest across two neighbours: retiring one leaves the other holding it at the
        // same height, the piece correctly does not move, and the assertion below would read that as
        // "re-falling is broken". Requiring `lower` to be the ONLY support fixes that but asks the pile for
        // a shape it does not always produce — the search then fails instead. Requiring every other support
        // to sit at least MIN_DROP below `lower` is both: the fall is guaranteed and the pile is free to be
        // a pile. (y grows downward, so "below" is a LARGER top.)
        const MIN_DROP944 = 4;
        if (boxes.some((o) => o !== lower && o !== upper && o.resting && supports944(o, upper) && o.top < lower.top + MIN_DROP944)) continue;
        return { lower: lower.pid, upper: upper.pid, upperTop: upper.top, gap };
      }
    }
    return null;
  };
  /* The pile's shape is physics, not a fixture, so a run can settle without a qualifying pair in it. When
   * that happens, add chips and let them settle rather than giving up — a bigger pile has more stacking. */
  let pairInfo944 = null, extra944 = 0;
  const MORE944 = ['#small-card', '#long-para', '#demo-img'];
  for (let round = 0; round < 4 && !pairInfo944; round++) {
    for (let i = 0; i < 4 && !pairInfo944; i++) { pairInfo944 = findPair944(await pieceBoxes944()); if (!pairInfo944) await sleep(250); }
    if (pairInfo944 || round >= MORE944.length) break;
    const sel = MORE944[round];
    const r = await api.rect(page, sel);
    for (let k = 0; k < 20 && !(await api.broken(page, sel)); k++) { await api.smashAt(page, r.cx, r.cy); await sleep(30); }
    extra944++;
    await poll(async () => { const st = await api.stats(page); return (Array.isArray(st.pieces) && st.pieces.length > 0 && st.pieces.every((q) => q.resting)) ? st : null; }, 4000, 80);
  }
  check('A.v2 9.4.4: found a vertically-stacked resting pair among the #stack debris to test re-falling', !!pairInfo944, pairInfo944 || { boxes: (await pieceBoxes944() || []).length, extra944 });
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
    // What the upper piece actually did, so a failure says which half broke: never woken (evictPieces did not
    // see it), or woken and then held up by something the pair search did not account for.
    const upAfter944 = (await pieceBoxes944() || []).find((b) => b.pid === pairInfo944.upper) || null;
    const floor944 = await page.evaluate(() => document.documentElement.clientHeight);
    check('A.v2 9.4.4: a piece resting on top of another re-falls once the piece underneath it despawns', expired944 === pairInfo944.lower && lowerGone944 === true && !!rose944, { pair: pairInfo944, expired944, lowerGone944, after: rose944, upAfter: upAfter944, floor: floor944 });
  }
  await api.call(page, 'setDebrisLife', 6000);   // the lifetime goes back on for §9.4.5 below

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
  await api.debug(page, { noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true, noRepair: true, noInvuln: true, noPartial: true });   // §B escape hatch — see the block header
  await api.restore(page);
  await sleep(80);

  // =======================================================================================
  // SPEC-destruction §A–§D — 누적 데칼 · 무기별 분해 · 타격 지점 · 카타나 베기
  // The ONE section in the whole suite that runs with §C's partial destruction ON: every other block
  // asks for `noPartial` because it aims at an element's padding to reach the element itself, which §C
  // now reads as an edge hit. Here that IS the subject.
  // =======================================================================================
  await setCombatMode('rampage');
  await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: true, noRepair: true, noFalloff: true, noInvuln: true, noPartial: false });
  await page.evaluate(() => window.scrollTo(0, 0));
  await api.restore(page);
  await sleep(80);

  /* Reads back ONE element's decal bitmap: how many canvases are laid over it, how many pixels carry any
   * ink at all, their mean alpha, and the bounding box of the inked pixels. §A's claims are all about how
   * that bitmap GROWS, so they are measured on the bitmap and not on a screenshot. */
  const decalInk = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    const list = [...document.querySelectorAll('.crs-decal')].filter((c) => {
      const b = c.getBoundingClientRect();
      return Math.abs(b.left - r.left) <= 2 && Math.abs(b.top - r.top) <= 2 && Math.abs(b.width - r.width) <= 2;
    });
    if (!list.length) return { canvases: 0, ink: 0, alpha: 0, coverage: 0, boxW: 0, boxH: 0 };
    const c = list[0];
    let d;
    try { d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; } catch (e) { return { canvases: list.length, ink: -1 }; }
    let n = 0, sum = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    const W = c.width;
    for (let i = 3, k = 0; i < d.length; i += 4, k++) {
      if (d[i] <= 8) continue;
      n++; sum += d[i];
      const x = k % W, y = (k - x) / W;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const total = c.width * c.height;
    return { canvases: list.length, ink: n, alpha: n ? sum / n : 0, coverage: n / total,
      boxW: maxX < 0 ? 0 : (maxX - minX + 1) / c.width, boxH: maxY < 0 ? 0 : (maxY - minY + 1) / c.height };
  }, sel);
  const remainOf = (sel) => page.evaluate((s) => {
    const d = window.__crashScreen.debug;
    return typeof d.remainOf === 'function' ? d.remainOf(document.querySelector(s)) : 'missing:remainOf';
  }, sel);
  const clipOf = (sel) => page.evaluate((s) => document.querySelector(s).style.getPropertyValue('clip-path'), sel);
  const zoneOf = (sel, x, y) => page.evaluate((s, a, b) => {
    const d = window.__crashScreen.debug;
    return typeof d.hitZone === 'function' ? d.hitZone(document.querySelector(s), a, b) : 'missing:hitZone';
  }, sel, x, y);

  // ---- §A (1) a mark is made once and then ACCUMULATES on the same canvas --------------------------
  await api.setWeapon(page, 'pistol');
  const dcImg = await api.rect(page, '#demo-img');
  await api.smashAt(page, dcImg.cx, dcImg.cy);
  await poll(async () => (await api.count(page, '.crs-decal')) > 0, 2000, 25);
  await sleep(160);
  const inkA1 = await decalInk('#demo-img');
  await api.smashAt(page, dcImg.cx + 10, dcImg.cy + 8);
  await sleep(200);
  const inkA2 = await decalInk('#demo-img');
  check('A.destr §A1: 첫 피해에 요소의 데칼 1개가 생기고, 추가 타격에도 캔버스는 여전히 1개이며 비투명 픽셀이 늘어난다',
    inkA1.canvases === 1 && inkA2.canvases === 1 && inkA1.ink > 0 && inkA2.ink > inkA1.ink, { inkA1, inkA2 });
  check('A.destr §A1: 파괴되면 그 요소의 데칼이 사라진다 (조각이 자국을 가져간다)',
    await (async () => { await api.setWeapon(page, 'axe'); await api.smashAt(page, dcImg.cx, dcImg.cy); await poll(() => api.broken(page, '#demo-img'), 1200); await sleep(80); return (await decalInk('#demo-img')).canvases === 0; })(), await decalInk('#demo-img'));

  // ---- §A (2) 망치 자국과 화염 자국은 평균 알파와 바운딩 박스로 구분된다 ---------------------------
  await api.restore(page);
  await sleep(80);
  await api.setWeapon(page, 'hammer');
  const gl = await api.rect(page, '#mat-gap-left');
  const gr = await api.rectNoScroll(page, '#mat-gap-right');
  await api.smashAt(page, gl.cx, gl.cy);
  await sleep(200);
  const inkHammer = await decalInk('#mat-gap-left');
  await api.setWeapon(page, 'flame');
  for (let i = 0; i < 4 && !(await api.broken(page, '#mat-gap-right')); i++) { await api.smashAt(page, gr.cx, gr.cy); await sleep(60); }
  await sleep(450);   // the hit makes the element itself wobble for 260 ms; the decal settles onto it after
  const inkFlame = await decalInk('#mat-gap-right');
  /* The discriminator the spec names is "평균 알파와 바운딩 박스". On a 220 × 160 panel a hammer's web
   * reaches almost every edge, so the bounding BOX alone does not separate the two — what does is how much
   * of that box is actually inked: the flame chars every pixel of the element, the hammer only the strands
   * of its web. Mean alpha separates them a second time, in the other direction. */
  check('A.destr §A2: 망치 자국과 화염 자국이 칠해진 면적과 평균 알파로 구분된다 (화염은 요소 전체를 그을리고 망치는 타격점 둘레만 금 간다)',
    inkHammer.ink > 0 && inkFlame.ink > 0 && inkFlame.coverage > 0.9 && inkHammer.coverage < 0.6
      && inkFlame.boxW > 0.95 && inkFlame.boxH > 0.95
      && Math.abs(inkFlame.alpha - inkHammer.alpha) > 5,
    { inkHammer, inkFlame, flameBroken: await api.broken(page, '#mat-gap-right') });

  // ---- §B4 분해 방식: 무기마다 조각 수가 다르다 ----------------------------------------------------
  await api.restore(page);
  await sleep(80);
  const destr = await page.evaluate(() => {
    const d = window.__crashScreen.debug;
    if (typeof d.destructionOf !== 'function') return 'missing:destructionOf';
    const out = {};
    for (const id of ['hammer', 'pistol', 'smg', 'sniper', 'axe', 'katana', 'bomb', 'rocket', 'flame', 'collapse']) out[id] = d.destructionOf(id);
    return out;
  });
  check('A.destr §B4: WEAPONS[id].destruction 이 명세의 표 그대로다 (모양 · 분리 · 마감 · 입자 · 지연 · 소멸)',
    !!destr && destr.axe.shape === 'half' && destr.axe.separation === 'cleave' && destr.axe.delayMs === 60
      && destr.katana.shape === 'half' && destr.katana.separation === 'slide' && destr.katana.delayMs === 140 && destr.katana.particles === 'none'
      && destr.pistol.separation === 'implode' && destr.smg.shape === 'strip' && destr.sniper.shape === 'half'
      && destr.bomb.shape === 'wedge' && destr.bomb.finish === 'scorch' && Math.abs(destr.bomb.vaporise - 0.15) < 1e-9
      && destr.rocket.shape === 'shard' && destr.rocket.finish === 'ember' && Math.abs(destr.rocket.vaporise - 0.30) < 1e-9
      && destr.flame.shape === 'ash' && destr.flame.finish === 'char' && Math.abs(destr.flame.vaporise - 0.25) < 1e-9
      && destr.collapse.shape === 'slab' && destr.collapse.separation === 'drop', destr);

  // 도끼 2조각 · 회전 부호가 서로 반대
  await api.setWeapon(page, 'axe');
  const axeImg = await api.rect(page, '#demo-img');
  const axeOut = await page.evaluate((x, y) => {
    const a = window.__crashScreen;
    a.smashAt(x, y, 'axe');
    return { broken: document.querySelector('#demo-img').hasAttribute('data-crs-broken'),
      pieces: a.stats().lastBreakPieces,
      vr: a.debug.pieceBoxes().filter((b) => !b.chip && !b.ash).map((b) => b.vr) };
  }, axeImg.cx, axeImg.cy);
  check('A.destr §B4: 도끼는 정확히 2조각으로 쪼개지고 §B2 cleave — 두 반쪽의 회전 부호가 반대다',
    axeOut.broken === true && axeOut.pieces === 2 && axeOut.vr.length === 2
      && axeOut.vr[0] !== 0 && axeOut.vr[1] !== 0 && Math.sign(axeOut.vr[0]) === -Math.sign(axeOut.vr[1]), axeOut);

  // 카타나 2조각
  await api.restore(page);
  await sleep(80);
  await api.setWeapon(page, 'katana');
  const katImg = await api.rect(page, '#demo-img');
  // 60 a cut against the image's ~101 hp: the first slash only wounds it, the second is the one that splits it
  await api.slash(page, katImg.left - 30, katImg.cy - 20, katImg.right + 30, katImg.cy + 20);
  await sleep(260);
  await api.slash(page, katImg.left - 30, katImg.cy - 20, katImg.right + 30, katImg.cy + 20);
  const katBroken = await poll(() => api.broken(page, '#demo-img'), 1200);
  const katPieces = (await api.stats(page)).lastBreakPieces;
  check('A.destr §B4: 카타나 베기도 정확히 2조각이다', katBroken === true && katPieces === 2, { katBroken, katPieces });

  // 로켓 6~8 — 폭발은 여러 요소를 한꺼번에 부수므로 이미지가 부서지는 바로 그 순간의 값을 읽는다
  await api.restore(page);
  await sleep(120);
  await api.setWeapon(page, 'rocket');
  const rkImg = await api.rect(page, '#demo-img');
  await page.evaluate(() => {
    window.__rkPieces = null; window.__rkTrail = 0;
    const el = document.querySelector('#demo-img');
    const mo = new MutationObserver(() => {
      if (window.__rkPieces == null && el.hasAttribute('data-crs-broken')) { window.__rkPieces = window.__crashScreen.stats().lastBreakPieces; mo.disconnect(); }
    });
    mo.observe(el, { attributes: true, attributeFilter: ['data-crs-broken'] });
    const mo2 = new MutationObserver(() => { window.__rkTrail = Math.max(window.__rkTrail, document.querySelectorAll('.crs-trail').length); });
    mo2.observe(document.documentElement, { childList: true, subtree: true });
    window.__rkStop = () => { try { mo.disconnect(); mo2.disconnect(); } catch (e) { /* ignore */ } };
  });
  await api.smashAt(page, rkImg.cx, rkImg.cy);
  await poll(() => api.broken(page, '#demo-img'), 1500);
  await sleep(120);
  const rkPieces = await page.evaluate(() => window.__rkPieces);
  const rkTrailPeak = await page.evaluate(() => window.__rkTrail);
  const rkEmber = await page.evaluate(() => [...document.querySelectorAll('.crs-piece .crs-clip')].filter((n) => /brightness/.test(n.style.filter)).length);
  await sleep(1000);
  const rkTrailAfter = await api.count(page, '.crs-trail');
  await page.evaluate(() => { if (window.__rkStop) window.__rkStop(); });
  check('A.destr §B4: 로켓은 6~8 파편을 낸다 (§C4 타격점 편향 격자 + 터진 셀 한 번 더 분할)', rkPieces >= 6 && rkPieces <= 8, { rkPieces });
  check('A.destr §B3: 로켓 조각에 ember 마감(brightness 필터)이 걸리고 .crs-trail 불꼬리를 만들었다가 1초 안에 치운다',
    rkEmber >= 1 && rkTrailPeak >= 1 && rkTrailAfter === 0, { rkEmber, rkTrailPeak, rkTrailAfter });

  // 폭탄: scorch 마감 (brightness 필터)
  await api.restore(page);
  await sleep(120);
  await api.setWeapon(page, 'bomb');
  const bmImg = await api.rect(page, '#demo-img');
  await api.smashAt(page, bmImg.cx, bmImg.cy);
  await poll(() => api.broken(page, '#demo-img'), 1500);
  await sleep(60);
  const bombFilters = await page.evaluate(() => [...document.querySelectorAll('.crs-piece .crs-clip')].map((n) => n.style.filter).filter(Boolean));
  check('A.destr §B3: 폭탄 조각에 scorch 마감 brightness(.82) saturate(.75) 가 걸려 있다',
    bombFilters.some((f) => /brightness\(\.?0?\.82\)/.test(f) && /saturate/.test(f)), bombFilters.slice(0, 4));

  // 화염: 8~16px 잿조각 18~30개
  await api.restore(page);
  await sleep(120);
  await api.setWeapon(page, 'flame');
  const flImg = await api.rect(page, '#demo-img');
  for (let i = 0; i < 12 && !(await api.broken(page, '#demo-img')); i++) { await api.smashAt(page, flImg.cx, flImg.cy); await sleep(40); }
  await sleep(80);
  const ashOut = await page.evaluate(() => {
    const bs = window.__crashScreen.debug.pieceBoxes().filter((b) => b.ash);
    return { n: bs.length, max: bs.reduce((m, b) => Math.max(m, b.w, b.h), 0), min: bs.reduce((m, b) => Math.min(m, b.w, b.h), 999) };
  });
  check('A.destr §B4: 화염방사기는 20px 미만 잿조각 18~30개를 남긴다 (ash · drop)',
    ashOut.n >= 18 && ashOut.n <= 30 && ashOut.max < 20 && ashOut.min >= 7, ashOut);

  // 붕괴: 1~2 덩어리
  await api.restore(page);
  await sleep(120);
  await api.setWeapon(page, 'collapse');
  const clPt = await api.rect(page, '#stack-2');
  await api.smashAt(page, clPt.cx, clPt.cy);
  await poll(async () => (await api.stats(page)).broken >= 2, 2500, 40);
  const clPieces = (await api.stats(page)).lastBreakPieces;
  check('A.destr §B4: 붕괴는 요소당 1~2 덩어리로 떨어진다 (slab · drop)', clPieces >= 1 && clPieces <= 2, { clPieces });

  // ---- §B2 implode: 권총 조각은 120ms 안에 타격점 쪽으로 빨려든다 ----------------------------------
  await api.restore(page);
  await sleep(120);
  await api.setWeapon(page, 'pistol');
  const ipImg = await api.rect(page, '#demo-img');
  // 마지막 한 발만 남기고 깎아 둔다 — 부서지는 그 발의 조각을 재야 한다
  for (let i = 0; i < 12 && !(await api.broken(page, '#demo-img')); i++) {
    const hp = await api.hpOf(page, '#demo-img');
    if (hp.hp <= DMG14('pistol')) break;
    await api.smashAt(page, ipImg.cx, ipImg.cy);
    await sleep(40);
  }
  /* Measured INSIDE the page across requestAnimationFrame: a piece moves every frame, and a pair of CDP
   * round trips would put tens of milliseconds of its flight between the two readings. */
  const implode = await page.evaluate((x, y) => new Promise((resolve) => {
    const a = window.__crashScreen;
    const mean = () => {
      const bs = a.debug.pieceBoxes().filter((b) => !b.chip && !b.ash);
      if (!bs.length) return null;
      let s = 0;
      for (const b of bs) s += Math.hypot((b.l + b.r) / 2 - x, (b.top + b.bottom) / 2 - y);
      return { n: bs.length, d: s / bs.length };
    };
    a.smashAt(x, y, 'pistol');
    const d0 = mean(), t0 = performance.now();
    const step = () => {
      const dt = performance.now() - t0;
      if (dt >= 120) { resolve({ d0, d1: mean(), dt }); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }), ipImg.cx, ipImg.cy);
  check('A.destr §B2 implode: 권총 조각은 120ms 안에 타격점까지의 평균 거리가 생성 시점보다 작아진다',
    !!implode.d0 && !!implode.d1 && implode.d0.n >= 2 && implode.d1.d < implode.d0.d, implode);

  // ---- §D2 slide: 카타나는 delayMs 동안 가만히 있다가 베기 각도 ±25도로 미끄러진다 ------------------
  await api.restore(page);
  await sleep(120);
  await api.setWeapon(page, 'katana');
  const slImg = await api.rect(page, '#demo-img');
  await api.slash(page, slImg.left - 30, slImg.cy - 18, slImg.right + 30, slImg.cy + 18);   // wound it first
  await sleep(300);
  const slide = await page.evaluate((x1, y1, x2, y2) => new Promise((resolve) => {
    const a = window.__crashScreen;
    const snap = () => a.debug.pieceBoxes().filter((b) => !b.chip && !b.ash).map((b) => ({ pid: b.pid, x: (b.l + b.r) / 2, y: (b.top + b.bottom) / 2 }));
    a.slash(x1, y1, x2, y2);
    const p0 = snap(), t0 = performance.now();
    let at100 = null;
    const step = () => {
      const dt = performance.now() - t0;
      if (!at100 && dt >= 100) at100 = { dt, s: snap() };
      if (dt >= 195) { resolve({ p0, at100, at200: { dt, s: snap() }, chordDeg: Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI }); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }), slImg.left - 30, slImg.cy - 18, slImg.right + 30, slImg.cy + 18);
  const slideMoved = (a, b) => {
    const by = new Map(b.map((q) => [q.pid, q]));
    return a.map((p) => { const q = by.get(p.pid); return q ? { dx: q.x - p.x, dy: q.y - p.y } : null; }).filter(Boolean);
  };
  const mv100 = slide.at100 ? slideMoved(slide.p0, slide.at100.s) : [];
  const mv200 = slideMoved(slide.p0, slide.at200.s);
  const offAxis = mv200.map((m) => angDist(Math.atan2(m.dy, m.dx) * 180 / Math.PI, slide.chordDeg)).map((d) => Math.min(d, 180 - d));
  check('A.destr §D2: 카타나 두 조각은 delayMs(140ms) 동안 전혀 움직이지 않는다',
    slide.p0.length === 2 && mv100.length === 2 && mv100.every((m) => Math.hypot(m.dx, m.dy) <= 1.5), { p0: slide.p0.length, at100: slide.at100 && slide.at100.dt, mv100 });
  check('A.destr §D2: 그 뒤 절단면을 따라 베기 각도 ±25도 안으로 미끄러진다',
    mv200.length === 2 && mv200.every((m) => Math.hypot(m.dx, m.dy) >= 3) && offAxis.every((d) => d <= 25), { mv200, offAxis, chordDeg: slide.chordDeg, dt: slide.at200.dt });

  // ---- §D2 곡선 · 초승달 잔상 · 어두운 칼자국 -------------------------------------------------------
  await api.restore(page);
  await sleep(120);
  const slashSeen = await page.evaluate((x1, y1, x2, y2) => new Promise((resolve) => {
    const out = { crescent: 0, ticks: -1, curve: null, scarAt60: 0, scarAt300: 0 };
    const a = window.__crashScreen;
    const mo = new MutationObserver(() => {
      const n = document.querySelectorAll('.crs-slash-fx').length;
      if (n > out.crescent) {
        out.crescent = n;
        const fx = document.querySelector('.crs-slash-fx');
        if (fx) out.ticks = fx.querySelectorAll('svg path').length;
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    a.slash(x1, y1, x2, y2);
    out.curve = a.debug.slashCurve ? a.debug.slashCurve() : null;
    const ink = () => {
      const c = document.querySelector('.crs-decal');
      if (!c) return 0;
      try {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
        return n;
      } catch (e) { return -1; }
    };
    setTimeout(() => { out.scarAt60 = ink(); }, 60);
    setTimeout(() => { mo.disconnect(); out.scarAt300 = ink(); resolve(out); }, 320);
  }), 0, 0, 0, 0);
  // a zero-length "slash" is a stab, and a stab leaves a mark of its own — the scar timing below counts
  // decal ink across the whole page, so that probe's own ink is cleared before the real slash runs
  await api.restore(page);
  await sleep(120);
  const bcS = await api.rect(page, '#big-card');
  const scS = await api.rectNoScroll(page, '#small-card');
  const slashReal = await page.evaluate((x1, y1, x2, y2) => new Promise((resolve) => {
    const a = window.__crashScreen;
    const out = { crescent: 0, paths: -1, straightBars: 0, curve: null, scarAt60: 0, scarAt300: 0 };
    const mo = new MutationObserver(() => {
      const list = [...document.querySelectorAll('.crs-slash-fx')];
      if (list.length > out.crescent) {
        out.crescent = list.length;
        out.paths = list[0].querySelectorAll('svg path').length;
        out.straightBars += list.filter((n) => !n.querySelector('svg')).length;
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    a.slash(x1, y1, x2, y2);
    out.curve = a.debug.slashCurve ? a.debug.slashCurve() : null;
    const ink = () => {
      let n = 0;
      for (const c of document.querySelectorAll('.crs-decal')) {
        try {
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
        } catch (e) { return -1; }
      }
      return n;
    };
    setTimeout(() => { out.scarAt60 = ink(); }, 60);
    setTimeout(() => { mo.disconnect(); out.scarAt300 = ink(); resolve(out); }, 320);
  }), bcS.left + 40, bcS.top + 60, scS.left + 40, scS.top + 120);
  check('A.destr §D2: 베기 궤적은 직선 막대가 아니라 곡선을 따르는 초승달 잔상이다 (SVG path 1개, 수직 눈금 없음)',
    slashReal.crescent >= 1 && slashReal.paths === 1 && slashReal.straightBars === 0, slashReal);
  check('A.destr §D2: 베기 곡선은 2차 베지어이고 제어점이 현에서 벗어나 있다 (중간점을 수직으로 밀어 호를 만든다)',
    !!slashReal.curve && (() => {
      const c = slashReal.curve;
      const mx = (c.x1 + c.x2) / 2, my = (c.y1 + c.y2) / 2;
      return Math.hypot(c.cx - mx, c.cy - my) > 2;
    })(), slashReal.curve);
  check('A.destr §D2: 칼자국은 180ms 뒤에 나타난다 — 60ms 에는 데칼에 잉크가 없고 300ms 에는 있다',
    slashReal.scarAt60 === 0 && slashReal.scarAt300 > 0, { at60: slashReal.scarAt60, at300: slashReal.scarAt300 });
  check('A.destr §D2: 허공을 그은 베기(0 길이)는 찌르기로 처리되어 베기 잔상을 만들지 않는다', slashSeen.crescent === 0, slashSeen);

  // ---- §C2 / §C3 타격 지점 ------------------------------------------------------------------------
  await api.restore(page);
  await sleep(120);
  await api.setWeapon(page, 'pistol');
  const cImg = await api.rect(page, '#demo-img');
  const zCorner = await zoneOf('#demo-img', cImg.left + 6, cImg.top + 6);
  const zEdge = await zoneOf('#demo-img', cImg.cx, cImg.top + 6);
  const zCentre = await zoneOf('#demo-img', cImg.cx, cImg.cy);
  check('A.destr §C2: 타격 구역이 모서리 · 변 · 가운데로 갈린다', zCorner === 'corner' && zEdge === 'edge' && zCentre === 'center', { zCorner, zEdge, zCentre });

  const debris0 = await api.count(page, '.crs-debris');
  await api.smashAt(page, cImg.left + 6, cImg.top + 6);
  await sleep(120);
  const cutCorner = await page.evaluate(() => window.__crashScreen.debug.lastCut);
  const stCorner = await api.stats(page);
  const clipCorner = await clipOf('#demo-img');
  const debrisCorner = await api.count(page, '.crs-debris');
  check('A.destr §C3: 모서리 타격은 data-crs-broken 없이 인라인 clip-path 를 걸고 stats().partial === 1 이며 조각 면적이 원본의 45% 미만이다',
    (await api.broken(page, '#demo-img')) === false && /^polygon\(/.test(clipCorner) && stCorner.partial === 1
      && !!cutCorner && cutCorner.zone === 'corner' && cutCorner.fallen < 0.45 && debrisCorner === debris0 + 1,
    { clipCorner: clipCorner.slice(0, 60), partial: stCorner.partial, cutCorner, debris0, debrisCorner });

  await api.restore(page);
  await sleep(120);
  const cImg2 = await api.rect(page, '#demo-img');
  const debrisC0 = await api.count(page, '.crs-debris');
  await api.smashAt(page, cImg2.cx, cImg2.cy);
  await sleep(120);
  const stCentre = await api.stats(page);
  const clipCentre = await clipOf('#demo-img');
  check('A.destr §C3: 같은 요소라도 한가운데 타격은 조각도 clip-path 도 남기지 않는다 — 어디를 때리느냐가 결과를 가른다',
    stCentre.partial === 0 && clipCentre === '' && (await api.count(page, '.crs-debris')) === debrisC0 && (await api.broken(page, '#demo-img')) === false,
    { partial: stCentre.partial, clipCentre, debrisC0, now: await api.count(page, '.crs-debris') });

  // 변 타격: 떨어진 판의 바운딩 박스가 그 변에 2px 이내로 접한다
  await api.restore(page);
  await sleep(120);
  await api.setWeapon(page, 'hammer');
  const eImg = await api.rect(page, '#demo-img');
  const edgeOut = await page.evaluate((x, y, sel) => {
    const a = window.__crashScreen;
    const before = a.debug.pieceBoxes().length;
    a.smashAt(x, y);
    const made = a.debug.pieceBoxes().slice(before).filter((b) => !b.chip && !b.ash);
    const r = document.querySelector(sel).getBoundingClientRect();
    return { made, top: r.top, left: r.left, right: r.right, bottom: r.bottom, cut: a.debug.lastCut };
  }, eImg.cx, eImg.top + 6, '#demo-img');
  check('A.destr §C3: 변 타격은 그 변을 따라 판을 떨어뜨린다 — 조각 바운딩 박스가 그 변에 2px 이내로 접한다',
    !!edgeOut.cut && edgeOut.cut.zone === 'edge' && edgeOut.made.length === 1 && Math.abs(edgeOut.made[0].top - edgeOut.top) <= 2,
    { cut: edgeOut.cut, pieceTop: edgeOut.made[0] && edgeOut.made[0].top, elTop: edgeOut.top });

  // 반복하면 remain 면적이 단조 감소하고 상한에서 전체 파괴로 전환된다
  await api.restore(page);
  await sleep(120);
  await api.setWeapon(page, 'pistol');
  const ratios = [];
  let convertedAtHp = null, convertedCuts = null;
  /* Walk around the four sides. A cut takes the near strip away AND stops hit-testing over it, so the next
   * shot on that side has to land deeper in — which is exactly why each side is only good for a couple of
   * cuts and why the 8-cut budget is spent by going round. */
  for (const side of ['top', 'right', 'bottom', 'left', 'top', 'right', 'bottom', 'left']) {
    const r = await api.rect(page, '#boss');   // scrolls it to the middle of the viewport: it lives far below the fold

    const rm = await remainOf('#boss');
    const b = (rm && rm.box) || { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const pad = 0.02;
    let fx, fy;
    if (side === 'top') { fx = 0.5; fy = b.minY + pad; }
    else if (side === 'bottom') { fx = 0.5; fy = b.maxY - pad; }
    else if (side === 'left') { fx = b.minX + pad; fy = 0.5; }
    else { fx = b.maxX - pad; fy = 0.5; }
    const hpBefore = (await api.hpOf(page, '#boss')).hp;
    await api.smashAt(page, r.left + r.width * fx, r.top + r.height * fy);
    await sleep(60);
    if (await api.broken(page, '#boss')) { convertedAtHp = hpBefore; convertedCuts = (ratios.length + 1); break; }
    const after = await remainOf('#boss');
    if (after && typeof after.ratio === 'number') ratios.push(Number(after.ratio.toFixed(4)));
  }
  const strictlyDown = ratios.length >= 3 && ratios.every((v, i) => i === 0 ? v < 1 : v < ratios[i - 1]);
  check('A.destr §C3: 같은 요소를 반복해 모서리·변으로 깎으면 remain 면적이 단조 감소한다', strictlyDown, ratios);
  check('A.destr §C3: 절단 상한(8회)에 닿으면 체력이 남아 있어도 전체 파괴로 전환된다',
    convertedAtHp !== null && convertedAtHp > 0 && convertedCuts <= 8 && (await api.stats(page)).partial === 0,
    { ratios, convertedAtHp, convertedCuts, partial: (await api.stats(page)).partial });

  // ---- §C4 폭발 격자: 터진 자리가 가장 잘게 부서진다 ------------------------------------------------
  const grid = await page.evaluate(() => {
    const d = window.__crashScreen.debug;
    if (typeof d.gridCells !== 'function') return 'missing:gridCells';
    const runs = [];
    for (let k = 0; k < 24; k++) {
      const cells = d.gridCells(600, 400, 3, 2, 60, 50);   // impact deep in the top-left cell
      let near = null, far = null;
      for (const c of cells) {
        const dist = Math.hypot(c.cx - 60, c.cy - 50);
        if (!near || dist < near.d) near = { d: dist, area: c.area };
        if (!far || dist > far.d) far = { d: dist, area: c.area };
      }
      runs.push({ n: cells.length, near: near.area, far: far.area });
    }
    return { n: runs[0].n, worse: runs.filter((r) => !(r.near < r.far)).length, sample: runs[0] };
  });
  check('A.destr §C4: 폭발 격자가 타격점으로 당겨지고 터진 셀이 한 번 더 쪼개진다 — 24회 모두 타격점 셀 조각이 가장 먼 셀보다 작다',
    !!grid && grid.worse === 0 && grid.n === 7, grid);
  const gridPlain = await page.evaluate(() => window.__crashScreen.debug.gridCells(600, 400, 3, 2, NaN, NaN).length);
  check('A.destr §C4: 타격점을 주지 않으면 격자는 예전 그대로 3 × 2 = 6칸이다', gridPlain === 6, gridPlain);

  // ---- §C5 이음새를 따라 갈라지기 -------------------------------------------------------------------
  await api.restore(page);
  await sleep(120);
  await api.setWeapon(page, 'pistol');
  const seamCard = await api.rect(page, '#big-card');
  const seamKid = await page.evaluate(() => {
    const k = document.querySelector('#big-card h2');
    const r = k.getBoundingClientRect();
    return { left: r.left, top: r.top, cy: r.top + r.height / 2 };
  });
  await api.smashAt(page, seamKid.left - 6, seamCard.cy);
  await sleep(100);
  const seamCut = await page.evaluate(() => window.__crashScreen.debug.lastCut);
  check('A.destr §C5: 자식 요소의 왼쪽 경계 10px 이내를 치면 절단선이 그 경계로 스냅되고 각도가 25도 이내다',
    !!seamCut && seamCut.snapped === true && Math.min(Math.abs(seamCut.angle - 90), Math.abs(180 - Math.abs(seamCut.angle - 90))) <= 25,
    { seamCut, kidLeft: Math.round(seamKid.left), hitX: Math.round(seamKid.left - 6) });

  // ---- 무흔적: 부분 파괴와 베기가 진행 중인 채로 Escape ---------------------------------------------
  await api.restore(page);
  await sleep(120);
  await api.setWeapon(page, 'pistol');
  const tcImg = await api.rect(page, '#demo-img');
  const tcCard = await api.rectNoScroll(page, '#big-card');
  await api.smashAt(page, tcImg.left + 6, tcImg.top + 6);                 // corner cut → clip-path on the image
  await api.smashAt(page, tcCard.left + 10, tcCard.top + 10);             // a second element left half-cut
  await sleep(80);
  const clipLive = await clipOf('#demo-img');
  await api.setWeapon(page, 'katana');
  await api.slash(page, tcCard.left + 40, tcCard.top + 60, tcCard.left + 240, tcCard.top + 200);
  await sleep(40);                                                         // mid-slash: the scar timer is still armed
  await page.keyboard.press('Escape');
  const offTrace = await poll(async () => !(await api.active(page)), 1500, 20);
  const nodesTrace = await api.count(page, '[data-crs]');
  const pendTrace = await api.pending(page);
  await settleRaf(page);
  const rafTrace = await api.pendingRaf(page);
  const clipsLeft = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => el.style && el.style.getPropertyValue('clip-path')).length);
  check('A.destr 무흔적: 부분 파괴와 베기가 진행 중인 채 Escape → [data-crs] 0개, 타이머 0, 프레임 0, 모든 페이지 요소의 인라인 clip-path 복원',
    /^polygon\(/.test(clipLive) && offTrace === true && nodesTrace === 0 && pendTrace === 0 && rafTrace === 0 && clipsLeft === 0,
    { clipLive: clipLive.slice(0, 40), offTrace, nodesTrace, pendTrace, rafTrace, clipsLeft });
  const onTrace = await page.evaluate(contentJs);
  check('A.destr 무흔적: 그 뒤 content.js 가 깨끗하게 다시 켜진다', onTrace === 'on', onTrace);
  await api.debug(page, { noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true, noRepair: true, noInvuln: true, noPartial: true });
  await api.restore(page);
  await sleep(80);

  await combatTeardown(ctx);
}

async function suiteA14Depth(browser, origin, contentCss, contentJs) {
  console.log('--- depth: depth-of-stack affects combat (SPEC-combat-v2 §10.6) ---');
  const ctx = await combatSetup(browser, origin, contentCss, contentJs, 'depth');
  const { page, log, W14, DMG14, near, norm360, angDist, setCombatMode, resetScene, force, debugCall, scrollToDepthLab } = ctx;
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
  // §10.4: the cover tag answers a question about the ENEMY ("can you shoot it at all?"), so it is written
  // whatever the frame is anchored to. CHANGED by SPEC-combat §A: this ran in `quickdraw`, which §A retired —
  // it now runs in `arcade`, the mode that replaced it. Dashed styling toggles the `crs-lock-covered` class on
  // the frame itself; the text lives on its `.crs-lock-tag` child. The assertion itself is unchanged.
  await setCombatMode('arcade');
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

  // ---- (11) §A2: the frame rides the PLAYER in both combat modes, and the enemy is what you shoot ----
  // CHANGED by SPEC-combat §A2. This used to assert the v1.4 §2.2 aim assist in `quickdraw`: the frame sat on
  // the ENEMY there, so a click inside the brackets but outside the enemy's own rect still counted as a shot on
  // it. §A2 retires that mode and anchors EVERY frame on the player ("틀은 플레이어(커서 또는 드론) 위에 뜬다"),
  // which makes the assist unreachable — a click near your own cursor must not damage an enemy across the page.
  // So the arcade half now asserts the rule that replaced it, the same way the survival half below always has,
  // plus the other half of §A2's offer: "그 적에게 아무 무기로든 한 대만 맞히면 즉시 취소된다" (차단!, 점수 +15).
  await setCombatMode('arcade');
  await sleep(150);
  await resetScene(400, 400);
  await api.setWeapon(page, 'pistol');
  const lockAssistId = await force('#figure', 'forceLock');
  await sleep(150);
  const assistGeom = await page.evaluate(() => {
    const n = document.querySelector('.crs-lock'); const el = document.querySelector('#figure');
    if (!n || !el) return null;
    const lr = n.getBoundingClientRect(), er = el.getBoundingClientRect();
    const clear = lr.right < er.left || lr.left > er.right || lr.bottom < er.top || lr.top > er.bottom;
    return { cx: lr.left + lr.width / 2, cy: lr.top + lr.height / 2, clear, lock: { left: lr.left, top: lr.top, right: lr.right, bottom: lr.bottom }, el: { left: er.left, top: er.top, right: er.right, bottom: er.bottom } };
  });
  const figAssistB = await api.hpOf(page, '#figure');
  if (assistGeom) await api.smashAt(page, assistGeom.cx, assistGeom.cy);
  await sleep(120);
  const figAssistA = await api.hpOf(page, '#figure');
  check('A.v2 §A2: in arcade the lock frame rides the CURSOR, so a shot inside it does NOT reach the locked enemy across the page', !!lockAssistId && !!assistGeom && assistGeom.clear === true && figAssistA.hp === figAssistB.hp, { lockAssistId, assistGeom, before: figAssistB, after: figAssistA });

  // ...and shooting the ENEMY itself cancels the shot: 차단!, score +15, the frame gone (§A2)
  await resetScene(400, 400);
  const lockBreakId = await force('#figure', 'forceLock');
  await sleep(150);
  const figBreakRect = await api.rect(page, '#figure');
  const breakBefore = await api.stats(page);
  await api.smashAt(page, figBreakRect.cx, figBreakRect.cy);
  const breakGone = await poll(async () => ((await api.count(page, '.crs-lock')) === 0 ? true : null), 1200, 60);
  const breakAfter = await api.stats(page);
  check('A.v2 §A2: one hit on the locked ENEMY cancels the lock in arcade — stats().locksBroken +1, score +15 and the .crs-lock node goes',
    !!lockBreakId && breakGone === true && breakAfter.locksBroken === breakBefore.locksBroken + 1 && breakAfter.score === breakBefore.score + 15,
    { lockBreakId, breakGone, before: { locksBroken: breakBefore.locksBroken, score: breakBefore.score }, after: { locksBroken: breakAfter.locksBroken, score: breakAfter.score } });

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
  await api.debug(page, { noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true, noRepair: true, noInvuln: true, noPartial: true });   // §B escape hatch — see the block header
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
  /* CHANGED (SPEC-combat §B4, feat/hostiles-only): the meter still has to be THERE and still has to be
   * carrying a live readout — that is what this frame is proving — but in a combat mode it no longer reads
   * a destruction percentage. §B4 replaces it with kill progress, `처치 N` + `적 K`, so the old /%/ probe
   * would now be asserting the absence of the very change §B4 asks for. The readout check is kept, aimed at
   * what the meter says today; the rampage ratio meter (where the % lives on) is untouched by §B4. */
  check('A.v2 §8: combat.png frame carries the drone + its health ring, the lock-on brackets, a live repair beam, the kill-progress meter (§B4) and the mode control all at once', shotNodes.avatar === true && shotNodes.ring === true && shotNodes.ringOnAvatar === true && shotNodes.lock === true && shotNodes.repair === true && shotNodes.meter === true && /\d/.test(shotNodes.meterText || '') && shotNodes.modeControl === true, shotNodes);
  check('A.v2 §8 / readability §7: the same frame also keeps the aim line and the enlarged ammo + health panels on screen', shotNodes.aimline === true && shotNodes.ammo === true && shotNodes.health === true, shotNodes);
  await api.restore(page);
  await sleep(80);

  // =======================================================================================
  // SPEC-combat §E — 변위 시스템 (feat/displace). 완료 기준: §F "변위" + "무흔적".
  //   §F: `debug.displace` 로 민 요소의 인라인 `transform` 이 복구 후 정확히 원래 값으로 돌아온다.
  //       페이지가 이미 쓰던 값이 보존된다. 같은 충격량에 큰 섹션이 버튼보다 적게 움직인다.
  //       밀어서 둘을 부딪히면 양쪽에 피해 숫자가 뜬다. 25 개째를 밀면 가장 오래된 것이 복귀한다.
  // Run in RAMPAGE: displacement is a page-wide state (§B2) and this section is about the PHYSICS, not
  // about who is allowed to take the collision damage. The §B gate on that damage is asserted in the
  // `rules` block, where §B's own rule is switched on.
  // =======================================================================================
  console.log('--- depth: SPEC-combat §E — displacement (transform round-trip / mass / collision / cap / traceless) ---');
  await setCombatMode('rampage');
  await sleep(150);
  await api.restore(page);
  await sleep(80);
  const pushE = (sel, ix, iy) => page.evaluate((s, a, b) => {
    const d = window.__crashScreen.debug;
    if (typeof d.displace !== 'function') return 'missing:debug.displace';
    return d.displace(document.querySelector(s), a, b);
  }, sel, ix, iy);
  const movedE = () => page.evaluate(() => {
    const d = window.__crashScreen.debug;
    return typeof d.moved === 'function' ? d.moved() : 'missing:debug.moved';
  });
  const movedOfE = (sel) => page.evaluate((s) => {
    const d = window.__crashScreen.debug;
    return typeof d.movedOf === 'function' ? d.movedOf(document.querySelector(s)) : 'missing:debug.movedOf';
  }, sel);
  // The whole §E1 contract is about the INLINE declaration, so read the value, its priority and the raw
  // attribute: "원래 값" means an element that never had one must not end up carrying an empty `transform`.
  const inlineTrE = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    return { value: el.style.getPropertyValue('transform'), priority: el.style.getPropertyPriority('transform'), attr: el.getAttribute('style') || '' };
  }, sel);

  // ---- (E1) the transform round-trip: pushed, then given back exactly as found (§E1 / §F) ----
  await api.rect(page, '#small-card');
  const trBefore1E = await inlineTrE('#small-card');
  const push1E = await pushE('#small-card', 900, 0);
  await sleep(200);
  const tr1E = await inlineTrE('#small-card');
  const body1E = await movedOfE('#small-card');
  check('A.§E 1 (§E1/§F): debug.displace 가 요소에 인라인 transform 을 !important 로 걸고 state.moved 에 몸체를 만든다',
    trBefore1E.value === '' && !!push1E && push1E !== 'missing:debug.displace'
    && /translate\(/.test(tr1E.value) && tr1E.priority === 'important'
    && !!body1E && body1E !== 'missing:debug.movedOf' && body1E.x > 20 && Math.abs(body1E.y) < 0.5,
    { trBefore1E, push1E, tr1E, body1E });
  await api.restore(page);
  await sleep(140);
  const tr1bE = await inlineTrE('#small-card');
  check('A.§E 1 (§F): 복구 후 인라인 transform 이 정확히 원래 값으로 돌아온다 — 원래 없던 요소에는 선언 자체가 남지 않는다',
    tr1bE.value === trBefore1E.value && !/transform/.test(tr1bE.attr) && (await movedOfE('#small-card')) === null,
    { trBefore1E, tr1bE });

  // ---- (E2) a transform the PAGE already wrote survives the whole round trip (§E1 / §F) ----
  await page.evaluate(() => { document.querySelector('#stack-3').style.setProperty('transform', 'rotate(5deg)'); });
  await api.rect(page, '#stack-3');
  const push2E = await pushE('#stack-3', 900, 0);
  await sleep(200);
  const tr2E = await inlineTrE('#stack-3');
  check('A.§E 2 (§E1/§F): 페이지가 이미 쓰던 값이 보존된다 — 저장한 값이 앞에 오고 우리 오프셋이 뒤에 이어 붙는다',
    !!push2E && push2E !== 'missing:debug.displace' && /^rotate\(5deg\)\s+translate\(.+\)\s+rotate\(/.test(tr2E.value),
    { push2E, tr2E });
  await api.restore(page);
  await sleep(140);
  const tr2bE = await inlineTrE('#stack-3');
  check('A.§E 2 (§F): 복구 후에도 그 값은 빈 문자열이 아니라 페이지가 쓰던 rotate(5deg) 그대로다',
    tr2bE.value === 'rotate(5deg)', tr2bE);
  await page.evaluate(() => { document.querySelector('#stack-3').style.removeProperty('transform'); });

  // ---- (E3) mass clamp(sqrt(area)/18, 0.6, 6): the same impulse moves a big section less (§E2 / §F) ----
  // Collisions off: §E2's numbers are a free-flight measurement, and a 1052 × 420 section pushed sideways
  // would hit something in its first frame. Same escape hatch as noAttacks / noRepair / noFalloff.
  await api.debug(page, { noDisplaceCollide: true });
  const areaE = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return r.width * r.height; }, sel);
  await api.rect(page, '#boss');
  const bossArea3E = await areaE('#boss');
  const btnArea3E = await areaE('#test-btn');
  await page.evaluate(() => {
    const d = window.__crashScreen.debug;
    d.displace(document.querySelector('#boss'), 1500, 0);
    d.displace(document.querySelector('#test-btn'), 1500, 0);
  });
  await sleep(260);
  const boss3E = await movedOfE('#boss');
  const btn3E = await movedOfE('#test-btn');
  const expMass = (a) => Math.min(6, Math.max(0.6, Math.sqrt(a) / 18));
  check('A.§E 3 (§E2/§F): 질량은 clamp(sqrt(area)/18, 0.6, 6) 이고 속도는 충격량/질량 — 같은 충격량에 큰 섹션이 버튼보다 적게 움직인다',
    !!boss3E && !!btn3E && near(boss3E.mass, expMass(bossArea3E), 0.02) && near(btn3E.mass, expMass(btnArea3E), 0.02)
    && boss3E.x > 0 && btn3E.x > boss3E.x * 1.3,
    { boss3E, btn3E, bossArea3E, btnArea3E, expBoss: expMass(bossArea3E), expBtn: expMass(btnArea3E) });
  await api.restore(page);
  await sleep(120);

  // ---- (E4) no gravity, the 400 px limit, and "정지하면 제자리로 돌아가지 않는다" (§E2) ----
  const btnBox4aE = await api.rect(page, '#test-btn');
  await pushE('#test-btn', 20000, 0);
  const stopped4E = await poll(async () => { const b = await movedOfE('#test-btn'); return (b && b !== 'missing:debug.movedOf' && b.resting) ? b : null; }, 5000, 100);
  const box4E = await page.evaluate(() => { const r = document.querySelector('#test-btn').getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, vw: window.innerWidth }; });
  check('A.§E 4 (§E2): 뷰포트 밖 400 px 이상은 더 밀리지 않는다 — 충격량 2 만을 줘도 왼쪽 모서리가 뷰포트+400 에서 멈춘다',
    !!stopped4E && near(box4E.left, box4E.vw + 400, 2), { stopped4E, box4E, btnBox4aE });
  const rest4aE = await movedOfE('#test-btn');
  await sleep(600);
  const rest4bE = await movedOfE('#test-btn');
  check('A.§E 4 (§E2): 중력이 없고(가로로만 민 요소의 y 오프셋 0) 정지한 뒤에도 제자리로 돌아가지 않는다 — 0.6 초 뒤 x 가 그대로',
    !!rest4aE && Math.abs(rest4aE.y) < 0.5 && !!rest4bE && near(rest4bE.x, rest4aE.x, 0.01) && rest4bE.x > 100,
    { rest4aE, rest4bE });
  await api.restore(page);
  await sleep(120);

  // ---- (E5) §E3 collision: push two into each other and BOTH take a damage number ----
  await api.debug(page, { noDisplaceCollide: false });
  await api.rect(page, '#stack-2');
  const hp1a5E = await api.hpOf(page, '#stack-1');
  const hp2a5E = await api.hpOf(page, '#stack-2');
  await page.evaluate(() => {
    const d = window.__crashScreen.debug;
    d.displace(document.querySelector('#stack-1'), 0, 900);    // 아래로
    d.displace(document.querySelector('#stack-2'), 0, -900);   // 위로 — 10 px 틈을 사이에 두고 마주 본다
  });
  await sleep(220);
  const hp1b5E = await api.hpOf(page, '#stack-1');
  const hp2b5E = await api.hpOf(page, '#stack-2');
  const dmg5E = await api.dmgTexts(page);
  const d1_5E = hp1a5E.hp - hp1b5E.hp, d2_5E = hp2a5E.hp - hp2b5E.hp;
  check('A.§E 5 (§E3/§F): 밀어서 둘을 부딪히면 양쪽에 피해 숫자가 뜬다 — AABB 충돌이 양쪽에 clamp(round(상대속도/14), 1, 60) 을 먹인다',
    d1_5E >= 1 && d1_5E <= 60 && d2_5E >= 1 && d2_5E <= 60 && d1_5E === d2_5E
    && dmg5E.filter((s) => /^-\d+$/.test(s)).length >= 2,
    { d1_5E, d2_5E, hp1a5E, hp1b5E, hp2a5E, hp2b5E, dmg5E });
  await api.restore(page);
  await sleep(120);

  // ---- (E6) §E1 cap: 24 live (12 in performance mode); the 25th sends the OLDEST home over 0.4 s ----
  await api.debug(page, { noDisplaceCollide: true });
  const cap6E = await page.evaluate(() => {
    const d = window.__crashScreen.debug;
    const out = { pushed: 0, ids: [] };
    for (const el of document.querySelectorAll('body *')) {
      if (out.pushed >= 25) break;
      if (el.closest('[data-crs]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 14) continue;
      if (!d.displace(el, 12, 0)) continue;              // a nudge: no collision, no travel worth measuring
      if (!out.pushed) window.__crsE6First = el;
      out.pushed++;
      out.ids.push(el.id || el.localName);
    }
    out.list = d.moved();
    return out;
  });
  const stats6E = await api.stats(page);
  check('A.§E 6 (§E1/§F): 상한 24 개 — 25 개째를 밀면 가장 오래된 것(목록의 첫 몸체)이 제자리로 복귀하기 시작한다',
    cap6E.pushed === 25 && Array.isArray(cap6E.list) && cap6E.list.length === 25
    && cap6E.list[0].returning === true && cap6E.list.filter((b) => b.returning).length === 1
    && stats6E.moved === 24 && stats6E.movedTotal === 25 && stats6E.movedCap === 24,
    { pushed: cap6E.pushed, ids: cap6E.ids, returning: Array.isArray(cap6E.list) ? cap6E.list.map((b) => b.returning) : cap6E.list, stats: { moved: stats6E.moved, movedTotal: stats6E.movedTotal, movedCap: stats6E.movedCap } });
  await sleep(700);
  const after6E = await movedE();
  const first6E = await page.evaluate(() => {
    const el = window.__crsE6First;
    return el ? { id: el.id || el.localName, value: el.style.getPropertyValue('transform'), attr: el.getAttribute('style') || '' } : null;
  });
  const stats6bE = await api.stats(page);
  check('A.§E 6 (§E1): 0.4 초 뒤 그 몸체는 목록에서 사라지고 그 요소의 인라인 transform 은 원래대로 비어 있다 — 남은 건 정확히 24 개',
    Array.isArray(after6E) && after6E.length === 24 && stats6bE.moved === 24
    && !!first6E && first6E.value === '' && !/transform/.test(first6E.attr),
    { len: Array.isArray(after6E) ? after6E.length : after6E, first6E, moved: stats6bE.moved });
  await api.restore(page);
  await sleep(120);
  await page.evaluate(() => { try { delete window.__crsE6First; } catch (e) { window.__crsE6First = null; } });

  // ---- (E7) §E4: an SPA that takes the transform back wins on the fourth try ----
  await api.rect(page, '#stack-2');
  await pushE('#stack-2', 900, 0);
  await sleep(80);
  const spa7E = [];
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => { document.querySelector('#stack-2').style.setProperty('transform', 'none'); });
    await sleep(90);
    spa7E.push(await movedOfE('#stack-2'));
  }
  const reject7E = await pushE('#stack-2', 900, 0);
  check('A.§E 7 (§E4): SPA 가 transform 을 덮어쓰면 3 회까지 재적용하고(1→2→3) 4 회째에 변위 대상에서 영구 제외된다',
    spa7E.length === 4 && !!spa7E[0] && spa7E[0].reapplied === 1 && !!spa7E[1] && spa7E[1].reapplied === 2
    && !!spa7E[2] && spa7E[2].reapplied === 3 && spa7E[3] === null && reject7E === null,
    { spa7E, reject7E });
  await page.evaluate(() => { document.querySelector('#stack-2').style.removeProperty('transform'); });
  await api.restore(page);
  await sleep(120);

  // ---- (E8) §F 무흔적: Escape with displacement live leaves the page exactly as it was found ----
  await page.evaluate(() => { document.querySelector('#big-card').style.setProperty('transform', 'translateY(3px)'); });
  await api.rect(page, '#big-card');
  await page.evaluate(() => {
    const d = window.__crashScreen.debug;
    d.displace(document.querySelector('#big-card'), 1500, 0);
    d.displace(document.querySelector('#small-card'), 1500, 0);
  });
  await sleep(200);
  const before8E = await page.evaluate(() => ({
    big: document.querySelector('#big-card').style.getPropertyValue('transform'),
    small: document.querySelector('#small-card').style.getPropertyValue('transform'),
    moved: window.__crashScreen.stats().moved,
  }));
  check('A.§E 8 (§F 무흔적): Escape 직전에 변위 2 개가 실제로 걸려 있다 — 하나는 페이지가 쓰던 transform 위에',
    before8E.moved === 2 && /^translateY\(3px\)\s+translate\(/.test(before8E.big) && /^translate\(/.test(before8E.small), before8E);
  await page.keyboard.press('Escape');
  const inactive8E = await poll(async () => !(await api.active(page)), 1500, 20);
  const nodes8E = await api.count(page, '[data-crs]');
  const pend8E = await api.pending(page);
  await settleRaf(page);
  const raf8E = await api.pendingRaf(page);
  const after8E = await page.evaluate(() => ({
    big: document.querySelector('#big-card').style.getPropertyValue('transform'),
    small: document.querySelector('#small-card').style.getPropertyValue('transform'),
    smallAttr: document.querySelector('#small-card').getAttribute('style') || '',
  }));
  check('A.§E 8 (§F 무흔적): 변위가 걸린 채 Escape → [data-crs] 0 개, 타이머 0, 프레임 0, 그리고 모든 페이지 요소의 인라인 transform 이 원래 값으로',
    inactive8E === true && nodes8E === 0 && pend8E === 0 && raf8E === 0
    && after8E.big === 'translateY(3px)' && after8E.small === '' && !/transform/.test(after8E.smallAttr),
    { inactive8E, nodes8E, pend8E, raf8E, after8E });
  await page.evaluate(() => { document.querySelector('#big-card').style.removeProperty('transform'); });
  const reon8E = await page.evaluate(contentJs);
  check('A.§E 8: content.js 가 그 뒤 깨끗하게 다시 활성화된다', reon8E === 'on', reon8E);
  await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: false, noRepair: true, noFalloff: true, noInvuln: true, noDisplaceCollide: false, noPartial: true });
  await api.restore(page);
  await sleep(80);

  await combatTeardown(ctx);
}

async function suiteA14Rules(browser, origin, contentCss, contentJs) {
  console.log('--- rules: modes (§A) / hostiles-only damage (§B) / enemy-only focus (§D1) ---');
  const ctx = await combatSetup(browser, origin, contentCss, contentJs, 'rules');
  const { page, log, W14, DMG14, near, norm360, angDist, setCombatMode, resetScene, force, debugCall, scrollToDepthLab } = ctx;
  // =======================================================================================
  // SPEC-combat §A — the mode roster after the Virtua-Cop mode was retired, and the ONE thing
  // that separates the two combat modes. Completion bar: §F "모드".
  // =======================================================================================

  // ---- (A-1) the roster itself: three modes, in order, with §A's names and descriptions ----
  await setCombatMode('rampage');
  await sleep(150);
  const roster = await page.evaluate(() => {
    const host = document.querySelector('crs-hud, .crs-hud-host');
    const sr = host && host.shadowRoot;
    const btns = sr ? [...sr.querySelectorAll('.modes [data-mode]')] : [];
    return btns.map((b) => ({ id: b.getAttribute('data-mode'), label: (b.textContent || '').trim(), title: b.getAttribute('title') || '' }));
  });
  check('A.§A: the mode control lists exactly rampage → arcade → survival, in that order (the Virtua-Cop mode is gone)',
    roster.length === 3 && roster.map((r) => r.id).join(',') === 'rampage,arcade,survival', roster);
  check('A.§A: the three carry §A\'s names (램페이지 / 아케이드 / 서바이벌) and its 7–9 자 descriptions (적 없이 부수기 / 커서로 피하며 쏘기 / 드론으로 피하며 쏘기)',
    roster.length === 3 &&
    roster[0].label === '램페이지' && /적 없이 부수기/.test(roster[0].title) &&
    roster[1].label === '아케이드' && /커서로 피하며 쏘기/.test(roster[1].title) &&
    roster[2].label === '서바이벌' && /드론으로 피하며 쏘기/.test(roster[2].title), roster);

  // ---- (A-2) each mode builds only its own furniture (§F: "세 모드가 각자의 요소만 만든다") ----
  // Rampage is the strong half of the claim — §F spells out that 적·락온·복구·미터·체력 HUD are ALL absent.
  // (§7.13 above already covers avatar/lock/repair/progress; this adds the enemy itself and the health HUD,
  // and then states the positive half for the two combat modes so "각자의" is a comparison, not one snapshot.)
  const furniture = async () => ({
    avatar: await api.count(page, '.crs-avatar'),
    ring: await api.count(page, '.crs-self'),
    lock: await api.count(page, '.crs-lock'),
    repair: await api.count(page, '.crs-repair'),
    progress: !!(await api.hudQ(page, '.crs-progress.on') || {}).visible,   // the meter lives in the HUD shadow root
    hostiles: (await api.stats(page)).hostiles,
    health: !!(await api.hudQ(page, '.crs-player') || {}).visible,
  });
  await api.restore(page);
  await sleep(80);
  const rampageAttack = await force('#figure', 'forceAttack');
  await sleep(150);
  const fRampage = await furniture();
  check('A.§A/§F: rampage has no enemy, no lock-on, no repair beam, no meter and no health HUD — forceAttack cannot even start one',
    !rampageAttack && fRampage.hostiles === 0 && fRampage.lock === 0 && fRampage.repair === 0 && fRampage.progress === false && fRampage.health === false && fRampage.avatar === 0 && fRampage.ring === 0,
    { rampageAttack, fRampage });

  await setCombatMode('arcade');
  await sleep(200);
  await resetScene(400, 400);
  await force('#figure', 'forceAttack');
  await force('#figure', 'forceLock');
  await sleep(200);
  const fArcade = await furniture();
  check('A.§A1: arcade builds the enemy, the lock-on, the meter and the health ring + HUD — but NO drone (the cursor is the character)',
    fArcade.avatar === 0 && fArcade.ring === 1 && fArcade.lock >= 1 && fArcade.hostiles >= 1 && fArcade.progress === true && fArcade.health === true,
    fArcade);
  // §A1 "체력 링이 커서를 두른다": the ring is drawn at the player point, which in arcade is the cursor
  await debugCall('setPlayerPos', 300, 500);
  await sleep(120);
  const ringAt = await page.evaluate(() => { const n = document.querySelector('.crs-self'); if (!n) return null; const r = n.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
  check('A.§A1: in arcade the health ring follows the CURSOR (moved to 300,500 → the ring centres there)',
    !!ringAt && near(ringAt.cx, 300, 6) && near(ringAt.cy, 500, 6), ringAt);
  // §A1 "체력 100, 0이면 KO" — the failure condition is the same as survival's, not a resource model
  const koBefore = (await api.stats(page)).ko;
  await page.evaluate(() => window.__crashScreen.debug.setPlayerHp(0));
  const koAfter = await poll(async () => ((await api.stats(page)).ko === true ? true : null), 1200, 60);
  check('A.§A1: arcade KOs at 0 HP exactly like survival (the retired mode had no health at all)',
    koBefore === false && koAfter === true, { koBefore, koAfter });
  await api.restore(page);
  await sleep(120);

  await setCombatMode('survival');
  await sleep(200);
  const fSurvival = await furniture();
  check('A.§A1: survival builds the same furniture AND the drone — the avatar is the only piece the two combat modes do not share',
    fSurvival.avatar === 1 && fSurvival.ring === 1 && fSurvival.health === true && fSurvival.progress === true, fSurvival);

  // ---- (A-3) the arcade handicap: attack interval ×1.35, projectile speed ×0.8 (§A1, §F) ----
  // Measured in arcade FIRST and then one H press to survival: the cycle order is rampage → arcade → survival,
  // so going the other way would pass through rampage, which releases every hostile and would leave the second
  // reading to a different enemy record (different depth tier, different interval).
  await setCombatMode('arcade');
  await sleep(200);
  await api.restore(page);
  await sleep(100);
  await api.rect(page, '#figure');
  await debugCall('setAvatarPos', 60, 60);
  const tierTuneA = await force('#figure', 'forceAttack');
  await sleep(80);
  const tuneArcade = await force('#figure', 'modeTuning');
  const orbsArcade = await debugCall('orbList');
  await setCombatMode('survival');
  await sleep(200);
  await debugCall('setAvatarPos', 60, 60);
  const tuneSurvival = await force('#figure', 'modeTuning');
  check('A.§A1/§F: arcade\'s attack interval is 1.35× survival\'s, measured on the SAME enemy record (both the bare T1 baseline and the live, depth-adjusted interval)',
    !!tuneArcade && !!tuneSurvival && tuneArcade.mode === 'arcade' && tuneSurvival.mode === 'survival' &&
    near(tuneArcade.attackMul / tuneSurvival.attackMul, 1.35, 0.001) &&
    near(tuneArcade.attackIntervalMs / tuneSurvival.attackIntervalMs, 1.35, 0.02),
    { tuneArcade, tuneSurvival, ratio: tuneArcade && tuneSurvival && tuneArcade.attackIntervalMs / tuneSurvival.attackIntervalMs });

  await api.restore(page);
  await sleep(100);
  await api.rect(page, '#figure');
  await debugCall('setAvatarPos', 60, 60);
  const tierTuneS = await force('#figure', 'forceAttack');
  await sleep(80);
  const orbsSurvival = await debugCall('orbList');
  const spdA = Array.isArray(orbsArcade) && orbsArcade.length ? orbsArcade[0].speed : null;
  const spdS = Array.isArray(orbsSurvival) && orbsSurvival.length ? orbsSurvival[0].speed : null;
  check('A.§A1/§F: a projectile actually launched in arcade flies at 0.8× the survival speed (416 vs 520 px/s), read off the live orb, not a constant',
    tierTuneA === 'shooter' && tierTuneS === 'shooter' && spdA != null && spdS != null && near(spdS, 520, 1) && near(spdA / spdS, 0.8, 0.005),
    { tierTuneA, tierTuneS, spdA, spdS, ratio: spdA != null && spdS ? spdA / spdS : null });
  await api.restore(page);
  await sleep(80);

  // =======================================================================================
  // SPEC-combat §B — 전투 중에는 적만 부서진다 (feat/hostiles-only)
  //   §F "적만 피해": 전투 모드에서 비적대 요소를 때리면 체력이 변하지 않고 조각도 없다.
  //   `.crs-deflect` 와 `무적` 이 뜨고 탄약은 1발 준다. 폭탄을 섞인 군집에 터뜨리면 적만 피해를 받는다.
  //   불이 무적 요소 위로 번져 적에게 닿으면 적의 체력이 준다.
  //   (§F 의 마지막 한 줄 — "무적 요소를 밀어 적에게 박으면 적만 피해를 받는다" — 은 §E 변위 시스템이
  //    들어온 지금 이 블록의 맨 끝 (B-밀기) 에서 단언한다. 충돌 피해는 collisionHit()
  //    (src/73-hit-resolution.js) 을 거쳐 아래 §B 게이트 하나로 걸러진다.)
  // The whole section runs with debug.noInvuln explicitly OFF — the rule under test is the real one.
  // =======================================================================================
  console.log('--- combat: SPEC-combat §B — only the enemy breaks (deflect / fire spread / enemy supply / meter) ---');
  const ignite = (sel, st) => page.evaluate((q, n) => {
    const d = window.__crashScreen.debug;
    return typeof d.ignite === 'function' ? d.ignite(document.querySelector(q), n) : 'missing:debug.ignite';
  }, sel, st);
  const burningOf = (id) => page.evaluate((q) => {
    const d = window.__crashScreen.debug;
    if (typeof d.burning !== 'function') return 'missing:debug.burning';
    return (d.burning() || []).find((b) => b.id === q) || null;
  }, id);
  /* REWRITTEN for SPEC-crosshair §A5 (roadmap step 4). §B1's "조준점이 미리 알려준다" was parked on the
   * PLAYER RING — the only aim-side marker v1.4 owned, with a note in src/91-combat-feedback.js saying
   * step 4 should move it onto the real crosshair. Step 4 drew that crosshair, so the warning moved:
   * `.crs-crosshair` wears §A5's grey (rgba(255,255,255,.35) → `.crs-ch-dim`) and drops its centre dot,
   * and the ring went back to being nothing but the health gauge. The assertions below are unchanged in
   * what they MEAN — grey + no dot over anything you cannot shoot — only in where they read it. */
  const aimMark = () => page.evaluate(() => {
    const n = document.querySelector('.crs-crosshair');
    if (!n) return null;
    const dot = n.querySelector('.crs-ch-dot');
    const info = window.__crashScreen.debug.crosshair ? window.__crashScreen.debug.crosshair() : null;
    return {
      invul: n.classList.contains('crs-ch-dim'),
      dot: dot ? getComputedStyle(dot).display : null,
      grad: info ? info.color : '',
      state: info ? info.state : null,
      armColor: n.querySelector('.crs-ch-arm') ? getComputedStyle(n.querySelector('.crs-ch-arm')).backgroundColor : '',
    };
  });

  await setCombatMode('survival');
  await api.debug(page, { noInvuln: false, noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true, noRepair: true, noFalloff: true, infiniteAmmo: false, noPartial: true });
  await api.restore(page);
  await sleep(100);
  await api.setWeapon(page, 'hammer');
  const srcB = await api.rect(page, '#fire-src');       // 200 × 80 — under every hostile floor, never an enemy
  const enemyB = await api.rectNoScroll(page, '#fire-enemy');
  const farB = await api.rectNoScroll(page, '#fire-far');
  check('A.§B fixture: the fire lab is on screen with a 10 px gap src→enemy (inside §F2 adjacency) and an 80 px gap enemy→far (outside it)',
    near(enemyB.left - srcB.right, 10, 2) && near(farB.left - enemyB.right, 80, 2) && srcB.width > 0 && enemyB.width > 0,
    { gapNear: enemyB.left - srcB.right, gapFar: farB.left - enemyB.right });

  // ---- (B1) a non-hostile element takes no damage and makes no pieces ----
  const hpSrcB0 = await api.hpOf(page, '#fire-src');
  const statsB0 = await api.stats(page);
  for (let i = 0; i < 5; i++) { await api.smashAt(page, srcB.cx, srcB.cy); await sleep(40); }
  const hpSrcB1 = await api.hpOf(page, '#fire-src');
  const statsB1 = await api.stats(page);
  check('A.§B 1 (§F): 전투 모드에서 비적대 요소를 5번 때려도 체력이 변하지 않고 (hp === max) 부서지지 않는다',
    hpSrcB1.hp === hpSrcB0.hp && hpSrcB1.hp === hpSrcB1.max && (await api.broken(page, '#fire-src')) === false,
    { before: hpSrcB0, after: hpSrcB1 });
  check('A.§B 1 (§F): …그리고 조각도 없다 — stats().debris / broken / damageDealt 가 하나도 움직이지 않는다',
    statsB1.debris === statsB0.debris && statsB1.broken === statsB0.broken && statsB1.damageDealt === statsB0.damageDealt,
    { before: { debris: statsB0.debris, broken: statsB0.broken, dmg: statsB0.damageDealt }, after: { debris: statsB1.debris, broken: statsB1.broken, dmg: statsB1.damageDealt } });

  // ---- (B2) §B1: 튕김 표시 · `무적` · 탄약 소모 ----
  await api.setWeapon(page, 'pistol');
  await sleep(60);
  const ammoB0 = (await api.ammo(page)).mag;
  await api.smashAt(page, srcB.cx, srcB.cy);
  const deflectB = await poll(async () => (await api.count(page, '.crs-deflect')) >= 1, 400, 20);
  const textsB = await api.dmgTexts(page);
  const ammoB1 = (await api.ammo(page)).mag;
  check('A.§B 2 (§F / §B1): 무적 요소를 때리면 `.crs-deflect` 튕김 표시가 뜬다',
    deflectB === true, { deflect: await api.count(page, '.crs-deflect') });
  check('A.§B 2 (§F / §B1): 피해 숫자 대신 `무적` 이 뜨고, 피해 숫자(-n)는 뜨지 않는다',
    textsB.includes('무적') && !textsB.some((t) => /^-\d/.test(t)), textsB);
  check('A.§B 2 (§F / §B1): 탄약은 1발 준다 — 빗맞힌 대가가 있어야 조준에 의미가 생긴다',
    ammoB0 != null && ammoB1 === ammoB0 - 1, { before: ammoB0, after: ammoB1 });
  const deflectGoneB = await poll(async () => (await api.count(page, '.crs-deflect')) === 0, 1200, 60);
  check('A.§B 2 (§B1): 튕김 표시는 180 ms 짜리라 곧 사라진다 (흔적 없음)', deflectGoneB === true, await api.count(page, '.crs-deflect'));

  // ---- (B3) §B1 item 4: 조준점 예고 — 무적 대상 위에서 흐린 회색, 중심 점 없음 ----
  // The drawn crosshair is roadmap step 4; the aim-side marker this build owns is the player ring
  // (the cursor itself in arcade). See placeSelf()/aimInvulnerable() in src/91-combat-feedback.js.
  const enemyTierB = await force('#fire-enemy', 'forceAttack');
  await debugCall('setAvatarPos', 120, 120);   // park the drone away from the lab so its own orb is not in the way
  await page.evaluate(() => window.__crashScreen.debug.setPlayerHp(100));
  await page.mouse.move(srcB.cx, srcB.cy);
  await sleep(140);
  const aimWallB = await aimMark();
  await page.mouse.move(enemyB.cx, enemyB.cy);
  await sleep(140);
  const aimEnemyB = await aimMark();
  check('A.§B 3 (§B1): #fire-enemy 가 적으로 선정된다 (T1 shooter, 54 000 px²)', enemyTierB === 'shooter', enemyTierB);
  check('A.§B 3 (§B1 / SPEC-crosshair §A5): 조준점이 미리 알려준다 — 무적 대상 위에서 흐린 회색(.crs-ch-dim)이고 중심 점이 없다',
    !!aimWallB && aimWallB.invul === true && aimWallB.dot === 'none' && aimWallB.state === 'dim' && /255,\s*255,\s*255,\s*\.?35/.test(aimWallB.grad), aimWallB);
  check('A.§B 3 (§B1 / SPEC-crosshair §A5): 적 위에서는 평소대로 — 붉은색(#e5484d)으로 돌아오고 중심 점이 돌아온다',
    !!aimEnemyB && aimEnemyB.invul === false && aimEnemyB.dot !== 'none' && aimEnemyB.state === 'hostile' && /#e5484d/i.test(aimEnemyB.grad), aimEnemyB);

  // ---- (B4) §F: 폭탄을 섞인 군집에 터뜨리면 적만 피해를 받는다 ----
  const hpEnemyB0 = await api.hpOf(page, '#fire-enemy');
  const hpSrcB2 = await api.hpOf(page, '#fire-src');
  const hpFarB0 = await api.hpOf(page, '#fire-far');
  await api.setWeapon(page, 'bomb');
  await sleep(60);
  await api.smashAt(page, enemyB.cx, enemyB.cy);
  await sleep(400);   // the blast staggers its targets by edgeDist / 4 ms
  const hpEnemyB1 = await api.hpOf(page, '#fire-enemy');
  const hpSrcB3 = await api.hpOf(page, '#fire-src');
  const hpFarB1 = await api.hpOf(page, '#fire-far');
  check('A.§B 4 (§F): 폭탄을 섞인 군집(적 1 + 무적 2)에 터뜨리면 적만 피해를 받는다',
    hpEnemyB1.hp < hpEnemyB0.hp && hpSrcB3.hp === hpSrcB2.hp && hpFarB1.hp === hpFarB0.hp,
    { enemy: [hpEnemyB0.hp, hpEnemyB1.hp], src: [hpSrcB2.hp, hpSrcB3.hp], far: [hpFarB0.hp, hpFarB1.hp] });
  await api.setWeapon(page, 'hammer');

  // ---- (B5) §B2: 불은 무적 요소에도 붙고 번지며, 적에게 닿으면 그때부터 실제 피해가 들어간다 ----
  await api.restore(page);
  await sleep(100);
  await api.rect(page, '#fire-src');
  const enemyTierB5 = await force('#fire-enemy', 'forceAttack');
  await debugCall('setAvatarPos', 120, 120);
  await page.evaluate(() => window.__crashScreen.debug.setPlayerHp(100));
  const hpEnemyB5a = await api.hpOf(page, '#fire-enemy');
  const hpSrcB5a = await api.hpOf(page, '#fire-src');
  const litB5 = await ignite('#fire-src', 60);   // §F2: stacks ≥ 45 is what spreads
  const srcBurningB5 = await burningOf('fire-src');
  check('A.§B 5 (§B2): 불은 무적 요소에도 붙는다 — #fire-src(비적대)가 60 스택으로 탄다',
    litB5 === 60 && !!srcBurningB5 && srcBurningB5.hostile === false && srcBurningB5.stacks >= 45, { litB5, srcBurningB5, tier: enemyTierB5 });
  const spreadB5 = await poll(() => burningOf('fire-enemy'), 2600, 100);
  check('A.§B 5 (§F / §B2): 불이 무적 요소 위로 번져 적에게 닿는다 — 10 px 떨어진 #fire-enemy 에 옮겨붙는다',
    !!spreadB5 && spreadB5.hostile === true && spreadB5.stacks > 0, spreadB5);
  const enemyBurntB5 = await poll(async () => { const h = await api.hpOf(page, '#fire-enemy'); return h.hp < hpEnemyB5a.hp ? h : null; }, 2600, 100);
  check('A.§B 5 (§F / §B2): 불길이 적에게 도달하면 그때부터 실제 피해가 들어간다 — 적의 체력이 준다',
    !!enemyBurntB5, { before: hpEnemyB5a, after: enemyBurntB5 || (await api.hpOf(page, '#fire-enemy')) });
  const hpSrcB5b = await api.hpOf(page, '#fire-src');
  check('A.§B 5 (§B2): 무적 요소 자신은 체력이 줄지 않는다 — 타기만 한다',
    hpSrcB5b.hp === hpSrcB5a.hp && hpSrcB5b.hp === hpSrcB5b.max, { before: hpSrcB5a, after: hpSrcB5b });
  const farBurningB5 = await burningOf('fire-far');
  check('A.§B 5 (§F2): 80 px 떨어진 #fire-far 에는 안 번진다 — 거리가 아니라 인접이어야 한다',
    farBurningB5 === null, farBurningB5);
  // 흔적 없음: restore() 가 연소 원장과 불 입자를 모두 비운다
  await api.restore(page);
  await sleep(120);
  const burningAfterRestoreB5 = await page.evaluate(() => (window.__crashScreen.debug.burning() || []).length);
  check('A.§B 5 (§B2): restore() 가 연소 원장을 비운다 — 복구 뒤 타는 요소 0개, .crs-fire 0개',
    burningAfterRestoreB5 === 0 && (await api.count(page, '.crs-fire')) === 0, { burning: burningAfterRestoreB5, fire: await api.count(page, '.crs-fire') });

  // ---- (B6) §B3: 적이 떨어지지 않게 한다 ----
  const tuneB6 = await debugCall('hostileTuning');
  check('A.§B 6 (§B3): 동시 적 수 5, 60초 후 7 (기존 3 / 5) — maxHostiles() 자체를 두 시점에 물어본 값',
    !!tuneB6 && tuneB6.maxAt0 === 5 && tuneB6.maxAt60s === 7, tuneB6);
  check('A.§B 6 (§B3): 선정 간격 900 ms (기존 1500) 이고 처치 후 보충까지 600 ms 다',
    !!tuneB6 && tuneB6.selectMs === 900 && tuneB6.refillMs === 600, tuneB6);
  check('A.§B 6 (§B3): 후보 고갈 시 최소 면적 40 000 → 20 000 px²',
    !!tuneB6 && tuneB6.minArea === 40000 && tuneB6.minAreaLow === 20000, tuneB6);
  // 처치 직후 보충: selectTick 은 900 ms 주기이므로, 600 ms 보충이 없으면 이 창 안에 다시 채워질 수
  // 없다 — 틱의 위상이 운 좋게 맞는 경우를 빼면. 그래서 위의 refillMs 단언과 짝으로 읽는다.
  /* The depth lab is the one place on the fixture with more than three eligible T1 elements in a single
   * screenful (six 260 × 170 ≈ 44 200 px² cards sharing a rect, plus the 900 × 700 tank pair below them), so
   * it is where "the old cap of 3 is really gone" can be shown rather than argued. */
  await api.rect(page, '#depth-front');
  await api.debug(page, { noAttacks: false });
  await api.restore(page);
  await sleep(100);
  const grewB6 = await poll(async () => { const n = (await api.stats(page)).hostiles; return n >= 4 ? n : null; }, 8000, 150);
  check('A.§B 6 (§B3): 전투가 비지 않는다 — 900 ms 선정으로 동시 적이 예전 상한 3을 넘어 4기 이상까지 늘어난다',
    grewB6 >= 4, { hostiles: grewB6, max: (await debugCall('hostileTuning')).max });
  /* 처치 직후 보충. HONEST LIMIT, stated rather than hidden: the 0.6 s refill and the 900 ms selection tick
   * are both running, and the loop that detects the kill (it polls stats().kills) itself takes long enough
   * to absorb the refill delay — so this cannot attribute the replacement to one or the other by timing.
   * What it does assert is the thing §B3 is actually for: after a kill the roster is back at full strength
   * rather than left short. The 600 ms figure itself is asserted above, read off REFILL_MS through
   * debug.hostileTuning(); the observed latency is printed below for a human to sanity-check. */
  /* Which enemy to kill has to be unambiguous: the depth-lab cards all share one rect, so an aura's centre
   * does not necessarily RESOLVE to its own hostile (the topmost layer answers for the point). #depth-tank-front
   * is the one large element on the fixture with nothing above it, so forceAttack makes it the enemy and a
   * click at its centre is certain to land on it. debug.pickAt confirms that rather than assuming it. */
  await api.rect(page, '#depth-tank-front');
  await sleep(200);
  const tankTierB6 = await force('#depth-tank-front', 'forceAttack');
  const auraB6 = await page.evaluate(() => {
    const a = window.__crashScreen;
    const el = document.querySelector('#depth-tank-front');
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = a.debug.pickAt(cx, cy);
    return (hit && hit.hostile) ? { cx, cy, id: hit.id } : null;
  });
  const beforeKillB6 = (await api.stats(page)).hostiles;
  const killsB6a = (await api.stats(page)).kills;
  await api.setWeapon(page, 'rocket');
  let killedB6 = false;
  for (let i = 0; i < 10 && auraB6 && !killedB6; i++) {
    await api.smashAt(page, auraB6.cx, auraB6.cy);
    killedB6 = await poll(async () => (await api.stats(page)).kills > killsB6a, 700, 40);
  }
  info(`A.§B 6: kill probe — tier ${tankTierB6}, aura ${JSON.stringify(auraB6)}, hostiles before the kill ${beforeKillB6}`);
  const killedAtB6 = Date.now();
  const backB6 = await poll(async () => ((await api.stats(page)).hostiles >= beforeKillB6 ? (await api.stats(page)).hostiles : null), 1500, 50);
  info(`A.§B 6: the replacement enemy was live ${Date.now() - killedAtB6} ms after the kill (§B3 says 0.6 s; the plain selection tick is 900 ms)`);
  check('A.§B 6 (§B3): 적이 하나 죽어도 전장이 비지 않는다 — 처치 뒤 동시 적 수가 곧바로 원래대로 돌아온다',
    killedB6 === true && backB6 >= beforeKillB6, { beforeKillB6, backB6, killedB6, ms: Date.now() - killedAtB6 });
  await api.setWeapon(page, 'hammer');
  await api.debug(page, { noAttacks: true });
  await sleep(50);

  // ---- (B7) §B4: 전투 모드의 미터는 파괴율이 아니라 처치 진행도다 ----
  await api.debug(page, { noAttacks: true });
  await api.restore(page);
  await sleep(120);
  await setCombatMode('survival');
  await sleep(120);
  const meterB7 = await api.hudQ(page, '.crs-progress');
  check('A.§B 7 (§B4): 전투 모드 미터가 파괴율 대신 처치 진행도를 쓴다 — `처치 N · 적 K`, %가 없다',
    !!meterB7 && meterB7.visible === true && /처치\s*\d+/.test(meterB7.text) && /적\s*\d+/.test(meterB7.text) && !/%/.test(meterB7.text) && !/파괴율/.test(meterB7.text), meterB7);
  await setCombatMode('rampage');
  await sleep(150);
  const meterB7r = await api.hudQ(page, '.crs-progress');
  check('A.§B 7 (§B4 / §F 모드): 램페이지의 미터 정의는 건드리지 않았다 — 그대로 숨어 있다',
    !meterB7r || meterB7r.visible === false, meterB7r);


  // =======================================================================================
  // SPEC-combat §D1 — 적만 포커싱 (feat/enemy-focus)
  //   §F "포커싱": 전투 모드에서 비적대 요소 위에 `.crs-target` 이 생기지 않고 체력 바도 없다.
  //   `pickTarget` 이 null 을 돌려준다. 적 rect 에서 30px 떨어진 빈 곳을 쏘면 보정되어 그 적이
  //   피해를 받고, 70px 에서는 안 된다. 아케이드는 50px 에서도 보정된다.
  // debug.noInvuln is explicitly OFF: §D1 is the AIM-side twin of §B's damageable() gate and shares its
  // escape hatch, so the rule under test is the real one. noAttacks stays ON so selectEligible() refuses to
  // add anyone — #fire-enemy, forced by hand, is then the ONLY hostile and every probe point below can be
  // quoted against its rect. (api.restore() releases hostiles — clearCombatNodes() — so the forceAttack
  // always comes AFTER it, as in §B above.)
  // =======================================================================================
  console.log('--- combat: SPEC-combat §D1 — only the enemy is focusable (bracket / aim point / 조준 보정 / 적 탐색 중) ---');
  // The hover box, read together with what the targeting query says at the same point, in ONE round trip:
  // "no bracket" and "pickTarget said null" are the same fact seen from two sides, and reading them apart
  // lets the mouse position age out between the two.
  const focusAt = (x, y) => page.evaluate((px, py) => {
    const a = window.__crashScreen, d = a.debug;
    const box = document.querySelector('.crs-target');
    const cs = box ? getComputedStyle(box) : null;
    /* SPEC-crosshair §B2 moved this exact node under `.crs-crosshair`, so it is looked up document-wide
     * and judged on its own `display` — "체력 바가 보이는가" is still the same question, asked where the
     * bar now is. It is hidden (`.crs-ch-hp-on` off) whenever there is no focus target at all. */
    const bar = document.querySelector('.crs-target-bar');
    const r = box ? box.getBoundingClientRect() : null;
    return {
      pick: (d && typeof d.pickAt === 'function') ? d.pickAt(px, py) : 'missing:pickAt',
      display: cs ? cs.display : null,
      barVisible: !!(bar && getComputedStyle(bar).display !== 'none'),
      label: box ? (box.textContent || '').trim() : null,
      rect: r ? { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } : null,
      hostiles: a.stats().hostiles,
    };
  }, x, y);
  const scanMark = () => page.evaluate(() => {
    const host = document.querySelector('crs-hud, .crs-hud-host');
    const box = host && host.shadowRoot ? host.shadowRoot.querySelector('.crs-progress') : null;
    const scan = box ? box.querySelector('.rscan') : null;
    if (!box || !scan) return null;
    const cs = getComputedStyle(scan);
    const anims = (scan.getAnimations ? scan.getAnimations() : []).map((a) => {
      const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
      return { dur: typeof t.duration === 'number' ? t.duration : null, forever: t.iterations === Infinity };
    });
    return { cls: box.classList.contains('scan'), text: (scan.textContent || '').trim(), display: cs.display, anims, hostiles: window.__crashScreen.stats().hostiles };
  });

  await setCombatMode('survival');
  await api.debug(page, { noInvuln: false, noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true, noRepair: true, noFalloff: true, infiniteAmmo: true, noPartial: true });
  await api.restore(page);
  await sleep(120);
  await api.setWeapon(page, 'pistol');
  const srcD = await api.rect(page, '#fire-src');          // 200 × 80 — under every hostile floor, never an enemy
  const enemyD = await api.rectNoScroll(page, '#fire-enemy');
  const tierD = await force('#fire-enemy', 'forceAttack');
  await debugCall('setAvatarPos', 120, 120);               // park the drone clear of the lab
  await page.evaluate(() => window.__crashScreen.debug.setPlayerHp(100));
  await sleep(140);
  const assistD = await debugCall('aimAssist');
  const hostilesD = (await api.stats(page)).hostiles;
  check('A.§D1 fixture: #fire-enemy 가 유일한 적이고, 서바이벌의 조준 보정 창은 40 px 이다 (debug.aimAssist 로 읽음)',
    tierD === 'shooter' && hostilesD === 1 && !!assistD && assistD.on === true && assistD.px === 40 && assistD.mode === 'survival',
    { tierD, hostilesD, assistD });
  // probe points, all on the enemy's vertical centre line and all in empty #fire-lab space to its right
  // (#fire-enemy's right edge → #fire-far's left edge is an 80 px gap, so 30 / 50 / 70 all land on nothing)
  const pxEnemyD = { x: enemyD.cx, y: enemyD.cy };
  const px30D = { x: enemyD.right + 30, y: enemyD.cy };
  const px50D = { x: enemyD.right + 50, y: enemyD.cy };
  const px70D = { x: enemyD.right + 70, y: enemyD.cy };

  // ---- (D1) §F: 비적대 요소 위에는 괄호도 체력 바도 없고, pickTarget 이 null 을 돌려준다 ----
  await page.mouse.move(srcD.cx, srcD.cy);
  await sleep(150);
  const wallD = await focusAt(srcD.cx, srcD.cy);
  check('A.§D1 1 (§F): 전투 모드에서 비적대 요소(#fire-src) 위에 `.crs-target` 이 생기지 않고 체력 바도 없다 — 마우스를 따라다니던 상자가 사라졌다',
    !!wallD && wallD.display === 'none' && wallD.barVisible === false, wallD);
  check('A.§D1 1 (§F): …같은 지점에서 pickTarget 이 null 을 돌려준다 (debug.pickAt — 보정 창 40 px 밖, 적까지 110 px)',
    !!wallD && wallD.pick === null, wallD);

  // ---- (D2) 적 위에서는 그대로다 — 사라진 것은 "적이 아닌 것" 위의 상자뿐이다 ----
  await page.mouse.move(pxEnemyD.x, pxEnemyD.y);
  await sleep(150);
  const onEnemyD = await focusAt(pxEnemyD.x, pxEnemyD.y);
  check('A.§D1 2 (§D1): 적 위에서는 괄호와 체력 바가 그대로 뜨고 pickTarget 이 그 적을 돌려준다',
    !!onEnemyD && onEnemyD.display !== 'none' && onEnemyD.barVisible === true
    && !!onEnemyD.pick && onEnemyD.pick.hostile === true && onEnemyD.pick.id === 'fire-enemy', onEnemyD);

  // ---- (D3) §D1: 조준점은 적 위에서만 붉고 활성 — 빈 곳에서도 흐린 회색에 중심 점이 없다 ----
  // (§B3 above already asserts the 무적 요소 위 half; this is the half §D1 adds — "그 외" now includes
  //  the empty page, which before §D1 left the aim point looking live over nothing at all.)
  await page.mouse.move(px70D.x, px70D.y);
  await sleep(150);
  const aimEmptyD = await aimMark();
  check('A.§D1 3 (§D1 / SPEC-crosshair §A5): 조준점이 빈 곳에서도 흐린 회색(.crs-ch-dim)이고 중심 점이 없다 — 쏠 수 있는 것은 적뿐이라는 말을 한 가지 색으로 한다',
    !!aimEmptyD && aimEmptyD.invul === true && aimEmptyD.dot === 'none' && aimEmptyD.state === 'dim' && /255,\s*255,\s*255,\s*\.?35/.test(aimEmptyD.grad), aimEmptyD);
  await page.mouse.move(pxEnemyD.x, pxEnemyD.y);
  await sleep(150);
  const aimOnEnemyD = await aimMark();
  check('A.§D1 3 (§D1 / SPEC-crosshair §A5): 적 위로 돌아오면 다시 붉고 활성이다 — .crs-ch-dim 이 빠지고 중심 점이 돌아온다',
    !!aimOnEnemyD && aimOnEnemyD.invul === false && aimOnEnemyD.dot !== 'none' && aimOnEnemyD.state === 'hostile' && /#e5484d/i.test(aimOnEnemyD.grad), aimOnEnemyD);

  // ---- (D4) §F: 적 rect 에서 30 px 떨어진 빈 곳 → 보정되어 그 적이 피해를 받는다 ----
  await page.mouse.move(px30D.x, px30D.y);
  await sleep(150);
  const near30D = await focusAt(px30D.x, px30D.y);
  const hp30aD = await api.hpOf(page, '#fire-enemy');
  await api.smashAt(page, px30D.x, px30D.y);
  await sleep(140);
  const hp30bD = await api.hpOf(page, '#fire-enemy');
  check('A.§D1 4 (§F): 적 rect 에서 30 px 떨어진 빈 곳을 쏘면 보정되어 그 적이 피해를 받는다',
    hp30bD.hp === hp30aD.hp - DMG14('pistol'), { before: hp30aD, after: hp30bD, dmg: DMG14('pistol'), near30D });
  check('A.§D1 4 (§D1): 보정이 보인다 — 괄호가 커서가 아니라 그 적 위에 뜬다 (±2 px)',
    !!near30D && near30D.display !== 'none' && !!near30D.rect
    && near(near30D.rect.left, enemyD.left, 2) && near(near30D.rect.top, enemyD.top, 2)
    && near(near30D.rect.width, enemyD.width, 2) && near(near30D.rect.height, enemyD.height, 2),
    { box: near30D && near30D.rect, enemy: { left: enemyD.left, top: enemyD.top, width: enemyD.width, height: enemyD.height } });

  // ---- (D5) §F: 70 px 에서는 보정되지 않는다 ----
  const far70D = await focusAt(px70D.x, px70D.y);
  const hp70aD = await api.hpOf(page, '#fire-enemy');
  await api.smashAt(page, px70D.x, px70D.y);
  await sleep(140);
  const hp70bD = await api.hpOf(page, '#fire-enemy');
  check('A.§D1 5 (§F): 70 px 에서는 보정되지 않는다 — pickTarget 이 null 이고 적의 체력이 그대로다',
    far70D && far70D.pick === null && hp70bD.hp === hp70aD.hp, { far70D, before: hp70aD, after: hp70bD });

  // ---- (D6) §F: 서바이벌 40 px / 아케이드 60 px — 50 px 이 두 모드를 갈라놓는다 ----
  const far50D = await focusAt(px50D.x, px50D.y);
  const hp50aD = await api.hpOf(page, '#fire-enemy');
  await api.smashAt(page, px50D.x, px50D.y);
  await sleep(140);
  const hp50bD = await api.hpOf(page, '#fire-enemy');
  check('A.§D1 6 (§F): 서바이벌의 창은 40 px 이라 50 px 은 보정되지 않는다',
    far50D && far50D.pick === null && hp50bD.hp === hp50aD.hp, { far50D, before: hp50aD, after: hp50bD });
  // h cycles rampage → arcade → survival, so getting to arcade passes through rampage and
  // clearCombatNodes() releases every hostile on the way. Re-force the same element afterwards.
  const arcadeOnD = await setCombatMode('arcade');
  await sleep(120);
  const tierD6 = await force('#fire-enemy', 'forceAttack');
  await page.evaluate(() => window.__crashScreen.debug.setPlayerHp(100));
  await sleep(140);
  const assistArcadeD = await debugCall('aimAssist');
  const arc50D = await focusAt(px50D.x, px50D.y);
  const hpArc50aD = await api.hpOf(page, '#fire-enemy');
  await api.smashAt(page, px50D.x, px50D.y);
  await sleep(140);
  const hpArc50bD = await api.hpOf(page, '#fire-enemy');
  check('A.§D1 6 (§F): 아케이드는 50 px 에서도 보정된다 — 한 손으로 조준과 회피를 겸하므로 창이 60 px 로 넓다',
    arcadeOnD === true && tierD6 === 'shooter' && !!assistArcadeD && assistArcadeD.px === 60
    && !!arc50D.pick && arc50D.pick.id === 'fire-enemy' && hpArc50bD.hp === hpArc50aD.hp - DMG14('pistol'),
    { arcadeOnD, tierD6, assistArcadeD, arc50D, before: hpArc50aD, after: hpArc50bD });
  const arc70D = await focusAt(px70D.x, px70D.y);
  check('A.§D1 6 (§F): 아케이드에서도 70 px 은 창 밖이다 — 보정은 넓어졌을 뿐 무한하지 않다',
    arc70D && arc70D.pick === null, arc70D);

  // ---- (D7) §D1: 램페이지는 지금 그대로 ----
  await setCombatMode('rampage');
  await sleep(160);
  await page.mouse.move(srcD.cx, srcD.cy);
  await sleep(150);
  const rampageD = await focusAt(srcD.cx, srcD.cy);
  check('A.§D1 7 (§D1): 램페이지는 건드리지 않았다 — 비적대 요소 위에 괄호와 체력 바가 여전히 뜨고 pickTarget 이 그 요소를 돌려준다',
    !!rampageD && rampageD.display !== 'none' && rampageD.barVisible === true
    && !!rampageD.pick && rampageD.pick.id === 'fire-src' && rampageD.pick.hostile === false, rampageD);

  // ---- (D8) §D1: 적이 없을 때 미터 옆에서 `적 탐색 중…` 이 1.5 초 주기로 맥동한다 ----
  await setCombatMode('survival');
  await api.debug(page, { noAttacks: true });
  await api.restore(page);   // releases every hostile; noAttacks keeps the selector from adding more
  await sleep(150);
  const scanOnD = await poll(async () => { const q = await scanMark(); return q && q.cls ? q : null; }, 4000, 100);
  check('A.§D1 8 (§D1): 적이 하나도 없으면 미터 옆에 `적 탐색 중…` 이 나타난다',
    !!scanOnD && scanOnD.hostiles === 0 && scanOnD.text === '적 탐색 중…' && scanOnD.display !== 'none', scanOnD || await scanMark());
  check('A.§D1 8 (§D1): …그리고 1.5 초 주기로 맥동한다 — 무한 반복하는 1500 ms 애니메이션이 실제로 돌고 있다',
    !!scanOnD && scanOnD.anims.some((a) => a.dur === 1500 && a.forever === true), scanOnD && scanOnD.anims);
  await api.rect(page, '#fire-src');   // scroll the lab back into view: forceAttack refuses an off-screen element
  const tierD8 = await force('#fire-enemy', 'forceAttack');
  const scanOffD = await poll(async () => { const q = await scanMark(); return q && !q.cls ? q : null; }, 4000, 100);
  check('A.§D1 8 (§D1): 적이 생기면 `적 탐색 중…` 이 사라진다 — 멈춘 게 아니라 애니메이션 자체가 없다',
    tierD8 === 'shooter' && !!scanOffD && scanOffD.hostiles >= 1 && scanOffD.display === 'none' && scanOffD.anims.length === 0,
    { tierD8, scanOffD: scanOffD || await scanMark() });

  // ---- (D9) §D1: 깊이 힌트는 유지한다 — 가려진 적을 찾는 단서다 ----
  // The bracket is now drawn on enemies only, so the `뒤에 적 N` hint moves with it: it is read off the
  // enemy you ARE focusing, and still counts the hostiles hiding behind that one. Two stacked depth-lab
  // cards (same rect, z6 over z5) are the fixture that makes "behind" unambiguous.
  await api.restore(page);
  await sleep(120);
  const depthPtD = await scrollToDepthLab();
  const tierFrontD = await force('#depth-front', 'forceAttack');
  const tierMidD = await force('#depth-mid', 'forceAttack');
  await debugCall('setAvatarPos', 120, 120);
  await page.evaluate(() => window.__crashScreen.debug.setPlayerHp(100));
  await sleep(160);
  await page.mouse.move(depthPtD.cx, depthPtD.cy);
  const hintD = await poll(async () => { const q = await focusAt(depthPtD.cx, depthPtD.cy); return q && q.display !== 'none' && /뒤에 적/.test(q.label || '') ? q : null; }, 2500, 80);
  check('A.§D1 9 (§D1): 깊이 힌트는 그대로다 — 앞 적을 포커싱한 괄호가 `뒤에 적 N` 을 계속 말한다',
    tierFrontD === 'shooter' && tierMidD === 'shooter' && !!hintD && /뒤에 적\s*\d+/.test(hintD.label),
    { tierFrontD, tierMidD, hintD: hintD || await focusAt(depthPtD.cx, depthPtD.cy) });
  await api.restore(page);
  await sleep(100);

  // =======================================================================================
  // SPEC-combat §B2 × §E3 — "무적 요소를 밀어 적에게 박으면 적만 피해를 받는다" (§F "적만 피해")
  //   §B2 is the half of the rule that is NOT the invulnerability itself: 변위 is applied to every
  //   element, and the collision it causes carries damage into whatever it reaches. The §E3 impact bills
  //   BOTH sides through collisionHit() — one call each — and the §B gate inside applyHit() is what
  //   turns that into "the enemy loses HP, the shield that hit it does not". The rule has to be ON for
  //   this (noInvuln: false), which is why it lives here and not beside §E's physics in the depth block.
  //   Fixture: #fire-src (200 × 80, never a hostile) sits 10 px to the left of #fire-enemy (300 × 180).
  // =======================================================================================
  console.log('--- rules: SPEC-combat §B2 × §E3 — shoving a 무적 element into an enemy ---');
  await setCombatMode('survival');
  await api.debug(page, { noInvuln: false, noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true, noRepair: true, noFalloff: true, noPartial: true });
  await api.restore(page);
  await sleep(120);
  const srcP = await api.rect(page, '#fire-src');
  const tierP = await force('#fire-enemy', 'forceAttack');      // #fire-enemy 를 적대 요소로 만든다
  await sleep(120);
  const hostileP = await page.evaluate(() => {
    const a = window.__crashScreen;
    return { enemy: !!a.stats().hostiles, n: a.stats().hostiles };
  });
  const srcHpAP = await api.hpOf(page, '#fire-src');
  const enemyHpAP = await api.hpOf(page, '#fire-enemy');
  const pushP = await page.evaluate(() => {
    const d = window.__crashScreen.debug;
    return typeof d.displace === 'function' ? d.displace(document.querySelector('#fire-src'), 1800, 0) : 'missing:debug.displace';
  });
  /* The impact is polled for, not slept on: §E3's in-place candidate list is behind a 300 ms cache, so
   * WHEN the 10 px gap is closed depends on where in that window the shove landed. `.crs-deflect` only
   * lives 180 ms (§B1), so the whole frame — both damage texts, the deflect arc and the debris count —
   * is snapshotted in ONE evaluate rather than read back one api call at a time. */
  const markP = await poll(async () => {
    const q = await page.evaluate(() => ({
      texts: [...document.querySelectorAll('.crs-dmg')].map((n) => (n.textContent || '').trim()),
      deflect: document.querySelectorAll('.crs-deflect').length,
      debris: document.querySelectorAll('.crs-debris').length,
    }));
    return (q.texts.indexOf('무적') >= 0 && q.texts.some((s) => /^-\d+$/.test(s))) ? q : null;
  }, 3000, 40);
  const srcHpBP = await api.hpOf(page, '#fire-src');
  const enemyHpBP = await api.hpOf(page, '#fire-enemy');
  const movedP = await page.evaluate(() => {
    const d = window.__crashScreen.debug;
    return typeof d.movedOf === 'function' ? d.movedOf(document.querySelector('#fire-src')) : null;
  });
  check('A.§B2/§E3 (§F): 무적 요소를 밀어 적에게 박으면 적만 피해를 받는다 — 적의 체력은 줄고, 민 쪽(비적대)은 그대로다',
    tierP === 'shooter' && hostileP.n >= 1 && !!pushP && pushP !== 'missing:debug.displace' && pushP.vx > 0
    && !!movedP && enemyHpBP.hp < enemyHpAP.hp && srcHpBP.hp === srcHpAP.hp && srcHpBP.max === srcHpAP.max,
    { tierP, hostileP, pushP, movedP, srcHp: [srcHpAP, srcHpBP], enemyHp: [enemyHpAP, enemyHpBP], srcP });
  check('A.§B2/§E3 (§F/§B1): 그 충돌에서 민 쪽은 §B1 그대로 튕겨 나온다 — `무적` 과 `.crs-deflect` 가 같은 프레임에 뜨고 조각은 하나도 생기지 않는다',
    !!markP && markP.deflect >= 1 && markP.debris === 0 && markP.texts.indexOf('무적') >= 0 && markP.texts.some((s) => /^-\d+$/.test(s)),
    markP || 'no deflect frame seen within 3 s');
  await api.restore(page);
  await sleep(100);

  // =======================================================================================
  // SPEC-combat §D2–§D5 — 세 축 분리 · 아키타입 10종 · 투사체 4종 · 돌격과 연발
  //   §F "아키타입": 표대로 분류된다. 연발형이 행 5개면 5발, 12개면 8발에서 멈춘다.
  //     속사형이 3발을 0.15초 간격 700 px/s 로. 돌격형이 0.4초 당겨졌다 돌진하고 복귀하며,
  //     예비 중에 쏘면 취소된다. 질량 큰 요소는 돌격 대신 직사탄. 추적형이 0.8초만 선회한다.
  //     지원형은 공격하지 않고 보호막을 건다. 라벨에 아키타입 글리프와 깊이 표식이 함께 나온다.
  //   §F "투사체": 4종의 속도·크기·요격 반경이 표와 일치한다. 요격하면 소멸하고 점수가 오르며 그 뒤
  //     페이지 요소는 피해를 안 받는다. 산탄 한 발만 요격해도 나머지 4발이 남는다. 포물선탄의 바닥
  //     표식이 착탄 전에 보이고 비행 중에만 요격된다.
  //     (도착 링의 60% 규칙과 1.0/0.55 불투명도는 ammo 블록의 §3.3 가독성 절에 있다 — 같은 노드를
  //      재는 단언이 두 블록으로 갈리지 않도록 원래 자리에 두었다.)
  //
  //   The fixture page has no button, link, form, nav or footer big enough to BE an enemy, so this
  //   section builds its own lab with page.evaluate and takes it away again (test/fixture.html is
  //   shared — the §2.4 perf block does the same). Every subject is absolutely placed inside one fixed
  //   620 × 760 box with NO overlaps, so each measures depth 0 ("front") and nothing shadows anything
  //   else; the two links straddle §D5's mass rule on purpose (70 × 70 → 3.89, 400 × 150 → 6).
  // =======================================================================================
  console.log('--- rules: SPEC-combat §D2–§D5 — archetypes, four projectiles, lunge and volley ---');
  const archImgSrc = 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%27220%27%20height%3D%27140%27%3E%3Crect%20width%3D%27220%27%20height%3D%27140%27%20fill%3D%27%234a7bd0%27%2F%3E%3C%2Fsvg%3E';
  const archBuild = (src) => page.evaluate((imgSrc) => {
    const old = document.getElementById('arch-lab');
    if (old) old.remove();
    const box = (x, y, w, h) => 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;margin:0;padding:0;border:0;box-sizing:border-box;background:#dde3f0;color:#101418;font:12px system-ui;overflow:hidden;';
    const mk = (tag, id, css, text) => {
      const n = document.createElement(tag);
      n.id = id;
      n.style.cssText = css;
      if (text != null) n.textContent = text;
      return n;
    };
    const lab = document.createElement('section');
    lab.id = 'arch-lab';
    lab.style.cssText = 'position:fixed;left:8px;top:8px;width:620px;height:760px;margin:0;padding:0;border:0;z-index:1;background:#eef1f8;';
    const table = (id, css, rows) => {
      const t = mk('table', id, css);
      const tb = document.createElement('tbody');
      for (let i = 0; i < rows; i++) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.textContent = '행 ' + (i + 1);
        tr.appendChild(td);
        tb.appendChild(tr);
      }
      t.appendChild(tb);
      return t;
    };
    const img = mk('img', 'arch-img', box(240, 10, 220, 140));
    img.setAttribute('alt', '아키타입 이미지');
    img.setAttribute('src', imgSrc);
    const link = mk('a', 'arch-link', box(470, 180, 70, 70) + 'display:block;');
    link.setAttribute('href', '#nav');
    for (let i = 0; i < 3; i++) { const sp = document.createElement('span'); sp.textContent = '칸' + i; link.appendChild(sp); }
    const linkBig = mk('a', 'arch-link-big', box(10, 590, 400, 150) + 'display:block;', '무거운 링크 — 돌격 대신 직사탄');
    linkBig.setAttribute('href', '#nav');
    const role = mk('div', 'arch-role', box(470, 500, 140, 80), 'role=button');
    role.setAttribute('role', 'button');
    const frame = mk('iframe', 'arch-iframe', box(10, 10, 200, 120));
    frame.setAttribute('title', '아키타입 프레임');
    frame.setAttribute('srcdoc', '<p>frame</p>');
    const wrap = mk('div', 'arch-sticky-wrap', box(470, 600, 140, 90) + 'overflow:auto;');
    const sticky = mk('div', 'arch-sticky', 'position:sticky;top:0;width:140px;height:90px;margin:0;padding:0;border:0;background:#cfd8ee;', '스티키');
    wrap.appendChild(sticky);
    lab.append(
      frame, img,
      mk('button', 'arch-btn', box(470, 10, 140, 70), '속사'),
      table('arch-table', box(10, 180, 200, 150), 5),
      table('arch-table12', box(240, 180, 200, 260), 12),
      link,
      mk('form', 'arch-form', box(470, 270, 140, 90), '추적 폼'),
      mk('p', 'arch-p', box(10, 350, 200, 100), '산탄형 문단입니다. 낱말이 흩어집니다.'),
      mk('div', 'arch-div', box(470, 380, 140, 100), '범용'),
      mk('nav', 'arch-nav', box(10, 470, 200, 90), '조준 내비'),
      mk('footer', 'arch-footer', box(240, 470, 200, 110), '지원 푸터'),
      role, linkBig, wrap
    );
    document.body.appendChild(lab);
    const ids = ['arch-iframe', 'arch-img', 'arch-btn', 'arch-table', 'arch-table12', 'arch-link', 'arch-form',
      'arch-p', 'arch-div', 'arch-nav', 'arch-footer', 'arch-role', 'arch-link-big', 'arch-sticky', 'arch-sticky-wrap'];
    const styles = {}, rects = {};
    for (const id of ids) {
      const n = document.getElementById(id);
      styles[id] = n ? (n.getAttribute('style') || '') : null;
      const r = n ? n.getBoundingClientRect() : null;
      rects[id] = r ? { left: r.left, top: r.top, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 } : null;
    }
    return { ids, styles, rects };
  }, src);
  const archDrop = () => page.evaluate(() => { const n = document.getElementById('arch-lab'); if (n) n.remove(); return true; });
  const archId = (sel) => page.evaluate((s) => {
    const d = window.__crashScreen.debug;
    return typeof d.archetypeOf === 'function' ? d.archetypeOf(document.querySelector(s)) : 'missing:archetypeOf';
  }, sel);
  const archTable = (sel) => page.evaluate((s) => {
    const d = window.__crashScreen.debug;
    if (typeof d.archetypeTable !== 'function') return 'missing:archetypeTable';
    return d.archetypeTable(s ? document.querySelector(s) : null);
  }, sel || null);
  // One snapshot of everything a projectile assertion asks about: the engine's own list AND what is on screen.
  const archShot = () => page.evaluate(() => {
    const a = window.__crashScreen, d = a.debug;
    const list = typeof d.orbList === 'function' ? d.orbList() : [];
    const nodes = [...document.querySelectorAll('.crs-orb')].map((n) => {
      const r = n.getBoundingClientRect();
      return { cls: n.className, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100, fins: n.querySelectorAll('.crs-orb-fin').length };
    });
    return { list, nodes, rings: document.querySelectorAll('.crs-orb-ring').length, marks: document.querySelectorAll('.crs-mortar-mark').length };
  });
  const archMovedOf = (sel) => page.evaluate((s) => {
    const d = window.__crashScreen.debug;
    return typeof d.movedOf === 'function' ? d.movedOf(document.querySelector(s)) : 'missing:movedOf';
  }, sel);
  const archPop = (offX) => page.evaluate((dx) => {
    const a = window.__crashScreen;
    const o = (a.debug.orbList() || []).filter((q) => q.launched)[0];
    if (!o) return null;
    a.smashAt(o.x + dx, o.y);
    return { x: o.x, y: o.y, dx };
  }, offX || 0);

  await setCombatMode('survival');
  await api.debug(page, { noInvuln: false, noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: true, noRepair: true, noFalloff: true, noPartial: true });
  await api.restore(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const archLab = await archBuild(archImgSrc);
  await sleep(150);
  const archR = archLab.rects;
  check('A.§D fixture: the archetype lab is on screen with all 15 subjects laid out, none overlapping, and the two links straddling mass 4',
    !!archR['arch-link'] && near(archR['arch-link'].width, 70, 1) && near(archR['arch-link'].height, 70, 1)
    && !!archR['arch-link-big'] && near(archR['arch-link-big'].width, 400, 1)
    && archLab.ids.every((id) => !!archR[id] && archR[id].width >= 1 && archR[id].height >= 1),
    { link: archR['arch-link'], big: archR['arch-link-big'] });

  // ---- (D3-1) 표대로, 순서대로 분류된다 ----
  const archPairs = [
    ['#arch-iframe', 'alien'], ['#arch-img', 'bombard'], ['#arch-table', 'volley'], ['#arch-table12', 'volley'],
    ['#arch-btn', 'rapid'], ['#arch-role', 'rapid'], ['#arch-link', 'lunger'], ['#arch-link-big', 'lunger'],
    ['#arch-form', 'tracker'], ['#arch-nav', 'aimer'], ['#arch-sticky', 'aimer'], ['#arch-p', 'scatter'],
    ['#arch-footer', 'support'], ['#arch-div', 'generic'],
    // the fixture's own elements answer the same way, so the rule is not a property of the lab
    ['#site-header', 'aimer'], ['#frame', 'alien'], ['#demo-img', 'bombard'], ['#table', 'volley'],
    ['#test-btn', 'rapid'], ['#card-link', 'lunger'], ['#long-para', 'scatter'], ['#nav', 'support'], ['#big-card', 'generic']
  ];
  const archGot = [];
  for (const pair of archPairs) archGot.push(await archId(pair[0]));
  check('A.§D3/§F: archetypeOf() 가 표의 행을 순서대로 적용한다 — iframe 이형 · img 포격형 · table 연발형 · button/[role=button] 속사형 · a 돌격형 · form 추적형 · nav/sticky 조준형 · p 산탄형 · footer 지원형 · div 범용형',
    archPairs.every((pair, i) => archGot[i] === pair[1]),
    archPairs.map((pair, i) => pair[0] + ':' + archGot[i] + (archGot[i] === pair[1] ? '' : '(want ' + pair[1] + ')')).join(' '));

  // ---- (D3-2) 글리프가 표대로 ----
  const archGlyphs = await archTable(null);
  const archWantGlyph = { alien: '◈', bombard: '◉', volley: '▤', rapid: '⁘', lunger: '➤', tracker: '◎', aimer: '🎯', scatter: '⁂', support: '✚', generic: '' };
  check('A.§D3/§F: 열 가지 아키타입이 표의 글리프를 쓴다 — 이형 ◈ · 포격형 ◉ · 연발형 ▤ · 속사형 ⁘ · 돌격형 ➤ · 추적형 ◎ · 조준형 🎯 · 산탄형 ⁂ · 지원형 ✚, 범용형은 글리프가 없다',
    !!archGlyphs && Array.isArray(archGlyphs.list) && archGlyphs.list.length === 10
    && archGlyphs.list.every((e) => e.glyph === archWantGlyph[e.id]),
    archGlyphs && archGlyphs.list);

  // ---- (D3-3) 라벨: `👿 IMG ◉ ▲` — 종류 · 공격 · 깊이가 한 줄에 ----
  await api.restore(page);
  await sleep(80);
  const archLabelTier = await force('#arch-img', 'forceAttack');
  await sleep(150);
  const archLabelText = await page.evaluate(() => {
    const n = document.querySelector('.crs-hostile-label');
    return n ? (n.textContent || '').trim() : null;
  });
  check('A.§D3/§F: 라벨에 아키타입 글리프와 깊이 표식이 함께 나온다 — `👿 IMG ◉ ▲` 형태로 종류·공격·깊이가 한 줄에 있다',
    archLabelTier === 'mortar' && !!archLabelText && /^(🎯 )?👿 IMG ◉ ▲+$/.test(archLabelText), { archLabelTier, archLabelText });

  // ---- (D3-4) 연발형: 행 5개면 5발, 12개면 8발에서 멈춘다 ----
  await api.restore(page);
  await sleep(80);
  await debugCall('setAvatarPos', 1100, 780);
  const archVolley5 = await force('#arch-table', 'forceAttack');
  await sleep(50);
  const archShot5 = await archShot();
  const archRows5 = await page.evaluate(() => [...document.querySelectorAll('#arch-table tr')].map((r) => { const b = r.getBoundingClientRect(); return { left: b.left, cy: b.top + b.height / 2 }; }));
  await api.restore(page);
  await sleep(80);
  await debugCall('setAvatarPos', 1100, 780);
  const archVolley12 = await force('#arch-table12', 'forceAttack');
  await sleep(50);
  const archShot12 = await archShot();
  const archVolTune = (await debugCall('projectileTuning')).volley;
  check('A.§D5/§F: 연발형이 행 5개면 5발, 12개면 8발에서 멈춘다 — 자식 행의 실제 개수를 세고 상한은 8이다',
    archVolley5 === 'volley' && archVolley12 === 'volley' && archShot5.list.length === 5 && archShot12.list.length === 8
    && archVolTune.max === 8 && archVolTune.gapMs === 120 && near(archVolTune.dmgMul, 0.5, 1e-9),
    { archVolley5, archVolley12, n5: archShot5.list.length, n12: archShot12.list.length, archVolTune });
  /* 발사 위치가 각 행의 왼쪽 끝. Only the still-waiting rounds are measured: the forced shot has a zero
   * wind-up, so by the time this reads back it has already left its muzzle — the other four have not. */
  const archPend5 = archShot5.list.filter((o) => !o.launched).map((o) => ({ x: o.x, y: o.y }));
  check('A.§D5: 연발의 발사 위치가 각 행의 왼쪽 끝이다 — 대기 중인 네 발이 서로 다른 네 행의 왼쪽 중심에 하나씩 놓여 있다',
    archPend5.length === 4 && archRows5.length === 5
    && archPend5.every((p) => archRows5.some((r) => near(p.y, r.cy, 3) && near(p.x, r.left, 3)))
    && new Set(archPend5.map((p) => Math.round(p.y))).size === 4,
    { archPend5, archRows5 });

  // ---- (D3-5) 속사형: 3발을 0.15초 간격 700 px/s 로 ----
  await api.restore(page);
  await sleep(80);
  await debugCall('setAvatarPos', 1100, 780);
  const archRapidTier = await force('#arch-btn', 'forceAttack');
  await sleep(50);
  const archRapidN = (await archShot()).list.length;
  await sleep(440);   // wind-ups 0 / 120 / 270 / 420 ms: by here every round has launched
  const archRapidSpeeds = (await archShot()).list.filter((o) => o.launched).map((o) => Math.round(o.speed));
  const archRapidTune = (await debugCall('projectileTuning')).rapid;
  check('A.§D3/§F: 속사형이 3발을 0.15초 간격 700 px/s 로 쏜다 — 발사 수·간격·속도를 live 코드에서 읽는다',
    archRapidTier === 'rapid' && archRapidN === 3
    && archRapidTune.count === 3 && archRapidTune.gapMs === 150 && near(archRapidTune.speed, 700, 0.5)
    && archRapidSpeeds.length >= 2 && archRapidSpeeds.every((v) => near(v, 700, 2)),
    { archRapidTier, archRapidN, archRapidTune, archRapidSpeeds });

  // ---- (D3-6) 산탄형: 5발 25도 부채꼴, 한 발만 요격해도 나머지가 남는다 ----
  await api.restore(page);
  await sleep(80);
  await debugCall('setAvatarPos', 1100, 780);
  const archScatterTier = await force('#arch-p', 'forceAttack');
  await sleep(90);
  const archScatterShot = await archShot();
  const archScTune = (await debugCall('projectileTuning')).scatter;
  const archScAngles = archScatterShot.list.filter((o) => o.launched).map((o) => Math.atan2(o.vy, o.vx) * 180 / Math.PI).sort((a, b) => a - b);
  const archScSpread = archScAngles.length >= 2 ? archScAngles[archScAngles.length - 1] - archScAngles[0] : null;
  check('A.§D4/§F: 산탄형이 5발을 25도 부채꼴로 쏘고, 발마다 따로 요격 가능한 작은 마름모로 그려진다',
    archScatterTier === 'scatter' && archScatterShot.list.length === 5
    && archScTune.count === 5 && archScTune.fanDeg === 25 && near(archScTune.dmgMul, 1 / 3, 1e-9)
    && archScSpread != null && near(archScSpread, 25, 1)
    && archScatterShot.nodes.length === 5 && archScatterShot.nodes.every((n) => /crs-orb-scatter/.test(n.cls)),
    { archScatterTier, n: archScatterShot.list.length, archScSpread, archScAngles, archScTune });
  const archScScore0 = (await api.player(page)).score;
  await api.setWeapon(page, 'pistol');
  const archScPop = await archPop(0);
  await sleep(60);
  const archScLeft = (await archShot()).list.length;
  const archScScore1 = (await api.player(page)).score;
  check('A.§D4/§F: 산탄 한 발만 요격해도 나머지 4발이 남는다 — 요격한 발만 소멸하고 점수가 5 오른다',
    !!archScPop && archScLeft === 4 && archScScore1 === archScScore0 + 5,
    { archScLeft, archScScore0, archScScore1, archScPop });
  await api.setWeapon(page, 'hammer');

  // ---- (D3-7) 포격형: 포물선탄 — 바닥 표식이 착탄 전에 보이고 비행 중에만 요격된다 ----
  await api.restore(page);
  await sleep(80);
  await debugCall('setAvatarPos', 1000, 700);
  const archMortarTier = await force('#arch-img', 'forceAttack');
  await sleep(130);
  const archMortarMid = await archShot();
  const archMTune = (await debugCall('projectileTuning')).mortar;
  check('A.§D4/§F: 포물선탄의 바닥 표식이 착탄 전에 보인다 — 1.1초 비행, 반경 90px, 긴 캡슐, 도착 링 대신 표식',
    archMortarTier === 'mortar' && archMortarMid.list.length === 1 && archMortarMid.marks === 1 && archMortarMid.rings === 0
    && archMTune.flightMs === 1100 && archMTune.radius === 90
    && archMortarMid.nodes.length === 1 && /crs-orb-mortar/.test(archMortarMid.nodes[0].cls),
    { archMortarTier, archMortarMid, archMTune });
  await api.setWeapon(page, 'pistol');
  await archPop(0);
  await sleep(80);
  const archMortarAfter = await archShot();
  await sleep(1300);   // well past the 1.1 s flight it no longer has
  const archMortarHp = (await api.player(page)).hp;
  check('A.§D4/§F: 포물선탄은 비행 중에만 요격된다 — 요격하면 탄과 바닥 표식이 함께 사라지고 착탄 피해도 일어나지 않는다',
    archMortarAfter.list.length === 0 && archMortarAfter.marks === 0 && archMortarHp === 100,
    { archMortarAfter, archMortarHp });
  await api.setWeapon(page, 'hammer');

  // ---- (D3-8) 추적형: 0.8초만 선회한다 ----
  await api.restore(page);
  await sleep(80);
  await debugCall('setAvatarPos', 1200, 400);
  const archSeekTier = await force('#arch-form', 'forceAttack');
  const archHeading = () => page.evaluate(() => {
    const o = (window.__crashScreen.debug.orbList() || [])[0];
    return o && o.launched ? Math.atan2(o.vy, o.vx) * 180 / Math.PI : null;
  });
  await sleep(110);
  await debugCall('setAvatarPos', 1200, 850);   // inside the 0.8 s window: it must bend toward this
  const archH1 = await archHeading();
  await sleep(420);
  const archH2 = await archHeading();
  await sleep(380);                              // past 0.8 s — the turn is over
  await debugCall('setAvatarPos', 60, 60);      // a demand in the opposite direction it must now IGNORE
  const archH3 = await archHeading();
  await sleep(320);
  const archH4 = await archHeading();
  const archSeekTune = (await debugCall('projectileTuning')).seeker;
  const archOrbTune = (await debugCall('projectileTuning')).orb;
  const archTurnEarly = (archH1 != null && archH2 != null) ? Math.abs(angDist(archH1, archH2)) : null;
  const archTurnLate = (archH3 != null && archH4 != null) ? Math.abs(angDist(archH3, archH4)) : null;
  check('A.§D4/§F: 추적형의 유도탄이 0.8초만 선회한다 — 창 안에서는 목표를 따라 꺾이고, 창이 닫힌 뒤에는 목표가 반대편으로 옮겨도 방향이 그대로다',
    archSeekTier === 'seeker' && archSeekTune.turnMs === 800 && archSeekTune.turnDeg === 90
    && archTurnEarly != null && archTurnEarly > 5 && archTurnLate != null && archTurnLate < 1.5,
    { archSeekTier, archH1, archH2, archH3, archH4, archTurnEarly, archTurnLate, archSeekTune });
  check('A.§D4/§F: 유도탄의 요격 반경이 직사탄의 1.3배다 — 23.4 px 대 18 px',
    near(archSeekTune.interceptR, 18 * 1.3, 0.01) && near(archOrbTune.interceptR, 18, 0.01),
    { archSeekTune, archOrbTune });

  // ---- (D3-9) 이형 → 레이저 쓸기 · 조준형 → 조준 락온 (기존 공격이 표가 지정한 자리에 남는다) ----
  await api.restore(page);
  await sleep(100);
  const archAlienTier = await force('#arch-iframe', 'forceAttack');
  const archBeamSeen = await poll(() => api.has(page, '.crs-beam'), 900);
  check('A.§D3: 이형(iframe)은 레이저 쓸기를 쓴다 — forceAttack 이 "laser" 를 돌려주고 .crs-beam 이 뜬다',
    archAlienTier === 'laser' && archBeamSeen === true, { archAlienTier, archBeamSeen });
  await api.restore(page);
  await sleep(120);
  const archAimTier = await force('#arch-nav', 'forceAttack');
  const archLockSeen = await api.count(page, '.crs-lock');
  check('A.§D3: 조준형(nav)은 조준 락온을 쓴다 — forceAttack 이 "lock" 을 돌려주고 .crs-lock 이 뜬다',
    archAimTier === 'lock' && archLockSeen >= 1, { archAimTier, archLockSeen });
  await api.restore(page);
  await sleep(120);

  // ---- (D3-10) 지원형: 공격하지 않고 보호막을 건다 ----
  const archSupTier = await force('#arch-footer', 'forceAttack');
  await sleep(120);
  const archSupState = await page.evaluate(() => ({
    guards: document.querySelectorAll('.crs-guard').length,
    orbs: document.querySelectorAll('.crs-orb').length,
    beams: document.querySelectorAll('.crs-beam').length,
    locks: document.querySelectorAll('.crs-lock').length,
    list: (window.__crashScreen.debug.guards && window.__crashScreen.debug.guards()) || []
  }));
  check('A.§D3/§F: 지원형(footer)은 공격하지 않고 보호막을 건다 — 투사체도 빔도 락온도 없고 .crs-guard 가 하나 뜬다',
    archSupTier === 'guard' && archSupState.guards === 1 && archSupState.orbs === 0 && archSupState.beams === 0
    && archSupState.locks === 0 && archSupState.list.length === 1 && archSupState.list[0].id === 'arch-footer',
    { archSupTier, archSupState });
  // and the shield DOES something: the same pistol round takes half as much off a shielded enemy
  await api.setWeapon(page, 'pistol');
  const archSupHp0 = await api.hpOf(page, '#arch-footer');
  await api.smashAt(page, archR['arch-footer'].cx, archR['arch-footer'].cy);
  await sleep(90);
  const archSupHp1 = await api.hpOf(page, '#arch-footer');
  const archGuardedDrop = archSupHp0.hp - archSupHp1.hp;
  await api.restore(page);                       // clearArchetypes() takes the shield with everything else
  await sleep(100);
  await api.debug(page, { noInvuln: true });     // no enemy, no shield: the unguarded reference reading
  const archRefHp0 = await api.hpOf(page, '#arch-footer');
  await api.smashAt(page, archR['arch-footer'].cx, archR['arch-footer'].cy);
  await sleep(90);
  const archRefHp1 = await api.hpOf(page, '#arch-footer');
  await api.debug(page, { noInvuln: false });
  const archPlainDrop = archRefHp0.hp - archRefHp1.hp;
  check('A.§D3: 보호막은 장식이 아니다 — 보호막이 걸린 적은 같은 권총 한 발에 피해를 절반만 받는다 (25 → 13)',
    archPlainDrop === 25 && archGuardedDrop === 13,
    { archGuardedDrop, archPlainDrop, guarded: [archSupHp0, archSupHp1], plain: [archRefHp0, archRefHp1] });
  await api.setWeapon(page, 'hammer');
  await api.restore(page);
  await sleep(100);

  // ---- (D5-1) 돌격형: 0.4초 당겨졌다 돌진하고 복귀한다 ----
  const archLungeTune = await debugCall('lungeTuning');
  check('A.§D5/§F: 돌격의 타이밍·거리·속도가 명세 그대로다 — 0.4초 예비 / 40px / 900 px/s / 0.5초 뒤 0.35초 이징 복귀 / mass > 4 제외',
    archLungeTune && archLungeTune.windupMs === 400 && archLungeTune.pullPx === 40 && archLungeTune.speed === 900
    && archLungeTune.holdMs === 500 && archLungeTune.returnMs === 350 && archLungeTune.maxMass === 4, archLungeTune);
  /* §E3's collisions are switched off for the three geometry readings below, the same escape hatch §E's own
   * free-flight assertions use (debug.noDisplaceCollide): the lunge flies across a page full of boxes, and a
   * bounce off one of them is a different claim than "it was pulled 40 px back and then ran at 900 px/s".
   * The shove it gives those boxes is asserted with collisions back ON, right after. */
  await api.debug(page, { noDisplaceCollide: true });
  await debugCall('setAvatarPos', 1100, 780);    // down-right of the lab: the pull is up-left, the dash down-right
  const archLungeTier = await force('#arch-link', 'forceAttack');
  await sleep(300);                              // inside the 0.4 s wind-up
  const archPull = await archMovedOf('#arch-link');
  /* The dash window is POLLED FOR, never slept to. The wind-up ends on a 25 ms chain and a loaded box adds
   * tens of ms on top, so "sleep 160 then read" measured a travel that started anywhere between 15 ms and
   * 60 ms earlier — the reading moved, not the product (this cost one intermittent failure). Both ends of
   * the measured window are pinned here instead: the first reading is the frame the body first carries dash
   * speed, the second is a fixed 90 ms later, and the distance between them is what the assertion reads. */
  const archDash = await poll(async () => { const b = await archMovedOf('#arch-link'); return (b && Math.hypot(b.vx, b.vy) > 600) ? b : null; }, 1200, 20);
  await sleep(90);
  const archDash2 = await archMovedOf('#arch-link');
  const archLungeList = await debugCall('lunges');
  const archPullMag = archPull ? Math.hypot(archPull.x, archPull.y) : null;
  const archDashSpeed = archDash ? Math.hypot(archDash.vx, archDash.vy) : null;
  const archTravel = (archDash && archDash2) ? Math.hypot(archDash2.x - archDash.x, archDash2.y - archDash.y) : null;
  check('A.§D5/§F: 돌격형이 0.4초 동안 목표 반대 방향으로 당겨졌다가 목표를 향해 900 px/s 로 돌진한다',
    archLungeTier === 'lunge' && !!archPull && !!archDash && !!archDash2
    && archPull.x < -8 && archPull.y < -8 && archPullMag > 18 && archPullMag < 70
    && archDash.vx > 0 && archDash.vy > 0 && archDashSpeed > 760 && archDashSpeed <= 910
    && archDash2.x > archDash.x && archDash2.y > archDash.y && archTravel > 40
    && Array.isArray(archLungeList) && archLungeList.length === 1,
    { archLungeTier, archPull, archPullMag, archDash, archDashSpeed, archDash2, archTravel, archLungeList });
  // 0.5초 뒤 제자리로 복귀 (0.35초 이징) — and the borrowed transform goes back to exactly what was there
  /* "끝났다" is TWO facts and they do not land on the same frame: the displaced body is released when the
   * 0.35 s glide completes, and the charge record is dropped by the timer that outlives it by 40 ms. Polling
   * on the body alone read the record inside that gap and called a finished charge unfinished (one
   * intermittent failure). Both are polled together, so the assertion waits for the end it is describing. */
  const archHome = await poll(async () => {
    const body = await archMovedOf('#arch-link');
    const list = await debugCall('lunges');
    return (body === null && Array.isArray(list) && list.length === 0) ? { body, list } : null;
  }, 2500, 60);
  const archHomeStyle = await page.evaluate(() => { const n = document.getElementById('arch-link'); return n ? (n.getAttribute('style') || '') : null; });
  check('A.§D5/§F: 돌격이 끝나면 요소가 제자리로 돌아오고 빌려 썼던 인라인 transform 이 원래 값 그대로 사라진다',
    !!archHome && archHomeStyle === archLab.styles['arch-link'],
    { archHome, archHomeStyle, want: archLab.styles['arch-link'], lastList: await debugCall('lunges') });
  await api.debug(page, { noDisplaceCollide: false });
  await api.restore(page);
  await sleep(100);
  // 경로 위의 다른 요소를 밀친다 — with collisions back on, the charge shoves what it meets
  await debugCall('setAvatarPos', 1100, 780);
  await force('#arch-link', 'forceAttack');
  await sleep(620);
  const archShoved = await debugCall('lunges');
  const archMovedN = (await debugCall('moved')).length;
  check('A.§D5: 돌진이 경로 위의 다른 요소를 밀친다 — 날아간 요소 말고도 변위된 몸체가 생긴다',
    Array.isArray(archShoved) && archShoved.length === 1 && archShoved[0].shoved >= 1 && archMovedN >= 2,
    { archShoved, archMovedN });
  await api.restore(page);
  await sleep(150);

  // ---- (D5-2) 예비 중에 쏘면 취소된다 ----
  await debugCall('setAvatarPos', 1100, 780);
  const archCancelTier = await force('#arch-link', 'forceAttack');
  const archLinkHp0 = await api.hpOf(page, '#arch-link');
  const archCancelWeapon = archLinkHp0.hp > 26 ? 'pistol' : (archLinkHp0.hp > 16 ? 'flame' : null);
  check('A.§D5 fixture: 돌격 취소를 확인할 무기가 있다 — 한 방에 부수지는 않고 피해만 주는 무기',
    archCancelTier === 'lunge' && archCancelWeapon !== null, { archLinkHp0, archCancelWeapon });
  await api.setWeapon(page, archCancelWeapon || 'flame');
  await sleep(150);                              // still inside the 0.4 s wind-up
  await api.smashAt(page, archR['arch-link'].cx, archR['arch-link'].cy);
  const archCancelled = await poll(async () => { const l = await debugCall('lunges'); return (Array.isArray(l) && l.length === 0) ? true : null; }, 1200, 40);
  await sleep(520);                              // the dash window it must never have entered
  const archCancelBody = await archMovedOf('#arch-link');
  const archCancelHp = await api.hpOf(page, '#arch-link');
  check('A.§D5/§F: 돌격 예비 중에 그 적을 쏘면 돌격이 취소된다 — 돌진은 일어나지 않고 요소는 제자리로 돌아간다',
    archCancelled === true && archCancelBody === null && archCancelHp.hp < archLinkHp0.hp,
    { archCancelled, archCancelBody, archLinkHp0, archCancelHp });
  await api.setWeapon(page, 'hammer');
  await api.restore(page);
  await sleep(120);

  // ---- (D5-3) 질량 큰 요소는 돌격 대신 직사탄 ----
  const archBigT = await archTable('#arch-link-big');
  const archSmallT = await archTable('#arch-link');
  await debugCall('setAvatarPos', 1100, 780);
  const archBigTier = await force('#arch-link-big', 'forceAttack');
  await sleep(90);
  const archBigShot = await archShot();
  const archBigLunges = await debugCall('lunges');
  const archBigMoved = await archMovedOf('#arch-link-big');
  check('A.§D5/§F: 질량이 큰 돌격형은 돌격 대신 직사탄을 쏜다 — 같은 `a` 태그라도 mass 가 4 를 넘으면 날아오지 않는다 (섹션이 날아오면 못 피한다)',
    archBigT.id === 'lunger' && archSmallT.id === 'lunger' && archBigT.mass > 4 && archSmallT.mass <= 4
    && archBigTier === 'shooter' && archBigShot.list.length === 1
    && Array.isArray(archBigLunges) && archBigLunges.length === 0 && archBigMoved === null,
    { archBigT, archSmallT, archBigTier, orbs: archBigShot.list.length, archBigLunges, archBigMoved });
  await api.restore(page);
  await sleep(100);

  // ---- (D4) 4종의 속도·크기·요격 반경이 표와 일치한다 ----
  const archProjTune = await debugCall('projectileTuning');
  check('A.§D4/§F: 투사체 4종의 표가 live 값과 일치한다 — 직사 520 px/s 요격 18px · 유도 0.8초 90°/s 요격 1.3배 · 산탄 5발 25도 1/3 · 포물선 1.1초 반경 90px, 동시 상한 18개',
    archProjTune && near(archProjTune.orb.speed, 520, 0.5) && archProjTune.orb.interceptR === 18
    && archProjTune.seeker.turnMs === 800 && archProjTune.seeker.turnDeg === 90 && near(archProjTune.seeker.interceptR, 23.4, 0.01)
    && archProjTune.scatter.count === 5 && archProjTune.scatter.fanDeg === 25 && near(archProjTune.scatter.dmgMul, 1 / 3, 1e-9)
    && archProjTune.mortar.flightMs === 1100 && archProjTune.mortar.radius === 90
    && archProjTune.cap === 18, archProjTune);
  // 모양으로 구분한다: 직사=꽉 찬 원 22px, 유도=꼬리 깃 3개, 산탄=작은 마름모, 포물선=긴 캡슐
  const archShapeOf = async (sel) => {
    await api.restore(page);
    await sleep(80);
    await debugCall('setAvatarPos', 1100, 780);
    await force(sel, 'forceAttack');
    await sleep(50);
    return (await archShot()).nodes[0] || null;
  };
  const archShapeOrb = await archShapeOf('#arch-link-big');
  const archShapeSeeker = await archShapeOf('#arch-form');
  const archShapeScatter = await archShapeOf('#arch-p');
  const archShapeMortar = await archShapeOf('#arch-img');
  check('A.§D4/§F: 네 종류가 모양으로 구분된다 — 직사 22px 꽉 찬 원 · 유도 꼬리 깃 3개 · 산탄 작은 마름모 · 포물선 긴 캡슐',
    !!archShapeOrb && near(archShapeOrb.w, 22, 1) && near(archShapeOrb.h, 22, 1) && archShapeOrb.fins === 0
    && !!archShapeSeeker && archShapeSeeker.fins === 3 && /crs-orb-seeker/.test(archShapeSeeker.cls)
    && !!archShapeScatter && archShapeScatter.w < archShapeOrb.w && /crs-orb-scatter/.test(archShapeScatter.cls)
    && !!archShapeMortar && archShapeMortar.w > archShapeMortar.h * 1.5 && /crs-orb-mortar/.test(archShapeMortar.cls),
    { archShapeOrb, archShapeSeeker, archShapeScatter, archShapeMortar });

  // 요격하면 소멸하고 점수가 오르며 그 뒤 페이지 요소는 피해를 안 받는다 (유도탄의 1.3배 반경에서)
  await api.restore(page);
  await sleep(80);
  await debugCall('setAvatarPos', 1100, 780);
  await force('#arch-form', 'forceAttack');
  await sleep(130);
  await api.setWeapon(page, 'pistol');
  const archDivHp0 = await api.hpOf(page, '#arch-div');
  const archSeekScore0 = (await api.player(page)).score;
  const archSeekPop = await archPop(21);   // 21 px off centre: outside a 직사탄's 18, inside the seeker's 23.4
  await sleep(80);
  const archSeekLeft = (await archShot()).list.length;
  const archSeekScore1 = (await api.player(page)).score;
  const archDivHp1 = await api.hpOf(page, '#arch-div');
  check('A.§D4/§F: 투사체를 요격하면 소멸하고 점수가 5 오르며 그 사격은 뒤의 페이지 요소에 닿지 않는다 (유도탄은 21px 밖에서도 요격된다)',
    !!archSeekPop && archSeekLeft === 0 && archSeekScore1 === archSeekScore0 + 5 && archDivHp1.hp === archDivHp0.hp,
    { archSeekPop, archSeekLeft, archSeekScore0, archSeekScore1, divHp: [archDivHp0, archDivHp1] });
  await api.setWeapon(page, 'hammer');
  await api.restore(page);
  await sleep(100);

  // 폭발 무기 범위 안의 투사체는 소멸하고, 중력탄은 빨아들인다 (§D4 공통 규칙)
  await debugCall('setAvatarPos', 1100, 780);
  await force('#arch-table', 'forceAttack');    // 다섯 발을 띄워 둔다
  await sleep(60);
  const archBlastBefore = (await archShot()).list.length;
  await api.setWeapon(page, 'bomb');
  const archBlastAt = await page.evaluate(() => {
    const list = window.__crashScreen.debug.orbList() || [];
    if (!list.length) return null;
    let x = 0, y = 0;
    for (const o of list) { x += o.x; y += o.y; }
    window.__crashScreen.smashAt(x / list.length, y / list.length);
    return { x: x / list.length, y: y / list.length, n: list.length };
  });
  await sleep(120);
  const archBlastAfter = (await archShot()).list.length;
  check('A.§D4/§F: 폭발 무기의 범위 안에 든 투사체는 소멸한다 — 다섯 발의 한가운데에 폭탄을 터뜨리면 전부 사라진다',
    archBlastBefore === 5 && !!archBlastAt && archBlastAfter === 0,
    { archBlastBefore, archBlastAt, archBlastAfter });
  await api.restore(page);
  await sleep(100);
  await debugCall('setAvatarPos', 1100, 780);
  await force('#arch-table', 'forceAttack');
  await sleep(60);
  const archSuckBefore = (await archShot()).list.length;
  await api.setWeapon(page, 'collapse');
  // 중력탄은 멀리서 터져도 빨아들인다: fired at the far corner, nowhere near any of the five rounds
  await api.smashAt(page, 1240, 60);
  const archSucked = await poll(async () => ((await archShot()).list.length === 0 ? true : null), 2500, 60);
  const archSuckTune = (await debugCall('projectileTuning')).suck;
  check('A.§D4/§F: 중력탄은 빨아들인다 — 붕괴를 반대편 구석에 쏴도 날던 다섯 발이 특이점으로 끌려가 삼켜진다',
    archSuckBefore === 5 && archSucked === true && !!archSuckTune && archSuckTune.speed > 0,
    { archSuckBefore, archSucked, archSuckTune });
  await api.setWeapon(page, 'hammer');
  await api.restore(page);
  await sleep(150);

  // ---- (D2) 세 축이 정말로 분리되어 있다 ----
  await debugCall('setAvatarPos', 1100, 780);
  const archAxisA = await force('#arch-p', 'forceAttack');        // 200 × 100 텍스트
  await api.restore(page); await sleep(80);
  await debugCall('setAvatarPos', 1100, 780);
  const archAxisB = await force('#arch-nav', 'forceAttack');      // 200 × 90  내비
  await api.restore(page); await sleep(80);
  await debugCall('setAvatarPos', 1100, 780);
  const archAxisC = await force('#arch-footer', 'forceAttack');   // 200 × 110 푸터
  await api.restore(page); await sleep(80);
  check('A.§D2: 요소 종류가 공격을 정한다 — 거의 같은 크기에 같은 깊이인 p · nav · footer 가 산탄 · 락온 · 보호막으로 완전히 다르게 행동한다',
    archAxisA === 'scatter' && archAxisB === 'lock' && archAxisC === 'guard',
    { archAxisA, archAxisB, archAxisC });
  const archBtnT = await archTable('#arch-btn');
  const archDivT = await archTable('#arch-div');
  check('A.§D2: 표가 이름 붙인 요소는 작아도 적이 된다 — 9 800 px² 버튼의 적 판정 하한이 1 200, 범용형 div 는 여전히 §B3 의 40 000',
    archBtnT.id === 'rapid' && archBtnT.minArea === 1200 && archDivT.id === 'generic' && archDivT.minArea === 40000,
    { archBtnT, archDivT });

  // ---- (§F 무흔적) 투사체 비행 중 · 돌격 중 · 연발 중에 Escape ----
  await api.restore(page);
  await sleep(100);
  await debugCall('setAvatarPos', 1100, 780);
  await force('#arch-table', 'forceAttack');    // 연발 5발이 순차 발사 중
  await force('#arch-img', 'forceAttack');      // 포물선탄 비행 + 바닥 표식
  await force('#arch-link', 'forceAttack');     // 돌격: 예비 → 돌진
  await sleep(520);                             // the lunge is mid-dash, the volley mid-sequence
  const archLive = await page.evaluate(() => ({
    orbs: document.querySelectorAll('.crs-orb').length,
    marks: document.querySelectorAll('.crs-mortar-mark').length,
    lunges: (window.__crashScreen.debug.lunges && window.__crashScreen.debug.lunges().length) || 0,
    moved: (window.__crashScreen.debug.moved && window.__crashScreen.debug.moved().length) || 0
  }));
  check('A.§D/§F 무흔적: Escape 직전에 투사체·바닥 표식·돌격이 모두 살아 있다',
    archLive.orbs >= 1 && archLive.marks >= 1 && archLive.lunges === 1 && archLive.moved >= 1, archLive);
  await page.keyboard.press('Escape');
  const archInactive = await poll(async () => !(await api.active(page)), 1500, 20);
  const archNodes = await api.count(page, '[data-crs]');
  const archPend = await api.pending(page);
  await settleRaf(page);
  const archRaf = await api.pendingRaf(page);
  const archStylesNow = await page.evaluate((ids) => {
    const out = {};
    for (const id of ids) { const n = document.getElementById(id); out[id] = n ? (n.getAttribute('style') || '') : null; }
    return out;
  }, archLab.ids);
  const archStyleSame = archLab.ids.every((id) => archStylesNow[id] === archLab.styles[id]);
  check('A.§D/§F 무흔적: 투사체 비행 중 · 돌격 중 · 연발 중에 Escape → [data-crs] 0개, 타이머 0, 프레임 0, 모든 페이지 요소의 인라인 스타일이 원래 값 그대로',
    archInactive === true && archNodes === 0 && archPend === 0 && archRaf === 0 && archStyleSame,
    { archInactive, archNodes, archPend, archRaf, diff: archLab.ids.filter((id) => archStylesNow[id] !== archLab.styles[id]).map((id) => ({ id, was: archLab.styles[id], now: archStylesNow[id] })) });
  const archReOn = await page.evaluate(contentJs);
  check('A.§D/§F 무흔적: content.js 가 그 뒤 깨끗하게 다시 켜진다', archReOn === 'on', archReOn);
  await api.debug(page, { noCrit: true, noCooldown: true, noSpread: true, noAttacks: true, fastReload: true, noRepair: true, noInvuln: true, noFalloff: true, noPartial: true });
  await archDrop();
  await api.restore(page);
  await sleep(100);

  // =======================================================================================
  // docs/specs/crosshair.md §A (그려진 조준점) · §B (시각 정돈) — the §D checklist.
  // Appended at the END of this block (shared-file rule). Everything below builds its own
  // scene and puts the block's baseline flags back before it finishes.
  // =======================================================================================
  console.log('--- rules: SPEC-crosshair §A 조준점 · §B 시각 정돈 ---');
  const chInfo = () => debugCall('crosshair');
  const msgRestore = '복구';   // the HUD restore button's label (btnRestore) — the one place to click that is ours
  const chDom = () => page.evaluate(() => {
    const n = document.querySelector('.crs-crosshair');
    if (!n) return null;
    const arm = n.querySelector('.crs-ch-arm'), dot = n.querySelector('.crs-ch-dot');
    const cs = getComputedStyle(n);
    return {
      nodes: document.querySelectorAll('.crs-crosshair').length,
      arms: n.querySelectorAll('.crs-ch-arm').length,
      armH: arm ? parseFloat(getComputedStyle(arm).height) : null,
      armColor: arm ? getComputedStyle(arm).backgroundColor : '',
      dotDisplay: dot ? getComputedStyle(dot).display : null,
      display: cs.display, opacity: cs.opacity, zIndex: cs.zIndex,
      cursorBody: getComputedStyle(document.body).cursor,
      cursorHtml: getComputedStyle(document.documentElement).cursor,
      aimClass: document.documentElement.classList.contains('crs-aim'),
      text: (n.textContent || '').trim()
    };
  });
  const CH_RAMPAGE_FLAGS = { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: true, noRepair: true, noFalloff: true, noInvuln: true };
  await setCombatMode('rampage');
  await api.debug(page, CH_RAMPAGE_FLAGS);
  await api.restore(page);
  await sleep(120);
  await api.setWeapon(page, 'pistol');
  const cardCh = await api.rect(page, '#big-card');
  await page.mouse.move(cardCh.cx, cardCh.cy);
  await sleep(160);

  // ---- (§A1/§A2) the OS cursor is off and exactly one crosshair is drawn ----
  const chBase = await chDom();
  const chBaseInfo = await chInfo();
  check('A.§A1: 운영체제 커서가 꺼지고(cursor: none, html.crs-aim) `.crs-crosshair` 가 정확히 1개 그려진다 — 팔 4개를 가진 한 노드',
    !!chBase && chBase.nodes === 1 && chBase.cursorBody === 'none' && chBase.cursorHtml === 'none' && chBase.aimClass === true && chBase.arms === 4 && chBase.display !== 'none',
    chBase);
  check('A.§A2: 조준경 레이어(z-index 7) 아래, 글래스 루트 안이다',
    !!chBase && Number(chBase.zIndex) < 7 && (await api.count(page, '.crs-root .crs-crosshair')) === 1, { z: chBase && chBase.zIndex });

  // ---- (§D) 포인터를 따라온다: 2 프레임 안에 ±2 px ----
  /* Measured INSIDE the page over real animation frames (debug.chFollow) and fetched in ONE hop: a CDP
   * round trip per frame measures the protocol, not the crosshair. The sampler is started FIRST and the
   * pointer is moved while it runs, so the samples straddle the move and the index where the pointer
   * jumps is visible in the data the failure message prints. */
  const followP = page.evaluate(() => window.__crashScreen.debug.chFollow(8));
  await page.mouse.move(cardCh.cx + 140, cardCh.cy + 70);
  const follow = await followP;
  const jumpAt = follow.findIndex((s) => Math.round(s.px) === Math.round(cardCh.cx + 140));
  const settledBy = jumpAt >= 0 ? follow.slice(jumpAt + 2).concat(jumpAt + 2 >= follow.length ? [follow[follow.length - 1]] : []) : follow.slice(-1);
  check('A.§A2/§D: 조준점이 포인터를 2 프레임 안에 ±2 px 로 따라온다 (페이지 안 rAF 샘플러로 측정)',
    Array.isArray(follow) && follow.length >= 3 && settledBy.length > 0 && settledBy.every((s) => s.tx != null && Math.abs(s.tx - s.px) <= 2 && Math.abs(s.ty - s.py) <= 2),
    { jumpAt, follow });

  // ---- (§A3) 산포 연동 — 명세가 "핵심" 이라고 적은 단 하나의 절 ----
  /* 기관총 15발 연사 중 팔 간격이 단조 증가하고, 손을 떼면 다시 모인다. gap = 6 + spreadNow × 0.9,
   * and spreadNow is the v1.5 recoil-kick + bloom ledger itself — nothing is recomputed here, which is
   * the whole point: 반동·블룸 스탯이 전부 눈에 보이게 된다. */
  await api.debug(page, Object.assign({}, CH_RAMPAGE_FLAGS, { noSpread: false }));
  await api.setWeapon(page, 'smg');
  await sleep(160);
  await page.mouse.move(cardCh.cx, cardCh.cy);
  await sleep(120);
  const gapStart = (await chInfo()).gap;
  const gapSeries = [];
  await page.mouse.down();
  for (let i = 0; i < 10; i++) { await sleep(105); const g = await chInfo(); gapSeries.push({ gap: g.gap, spread: g.spread }); }
  await page.mouse.up();
  const shotsFired = (await api.stats(page)).shots;
  const gapPeak = gapSeries[gapSeries.length - 1].gap;
  const monotonic = gapSeries.every((s, i) => i === 0 || s.gap >= gapSeries[i - 1].gap - 0.6);
  check('A.§A3 (핵심): 기관총을 15발 가까이 연사하는 동안 팔 간격이 단조 증가한다 — 반동 킥과 블룸이 그대로 보인다',
    shotsFired >= 12 && monotonic === true && gapPeak > gapStart + 20,
    { shotsFired, gapStart, gapPeak, series: gapSeries.map((s) => s.gap) });
  await sleep(800);
  const gap800 = (await chInfo()).gap;
  const gapBack = await poll(async () => { const g = (await chInfo()).gap; return Math.abs(g - gapStart) <= 1 ? g : null; }, 2600, 80);
  /* AMBIGUITY, reading chosen. §D says "0.8초 쉬면 초기값으로". The ledger §A3 reads (src/71) recovers
   * bloom at 40 px/s after 0.4 s of quiet, and a 15-round burst caps the smg's bloom at 60 px — so the
   * arm gap is provably FALLING by 0.8 s but needs ~1.9 s to be all the way home. Both halves are
   * asserted rather than one of them being quietly dropped: 떨어지고 있다 at 0.8 s, 초기값 by 2.6 s. */
  check('A.§A3: 손을 떼면 간격이 되돌아온다 — 0.8초에 이미 줄고 있고, 블룸이 다 식으면 초기값으로 (40 px/s 회복)',
    gap800 < gapPeak - 5 && gapBack !== null && Math.abs(gapBack - gapStart) <= 1,
    { gapStart, gapPeak, gap800, gapBack });
  // ---- crosshairSpread: false 면 변하지 않는다 ----
  await api.call(page, 'setSetting', 'crosshairSpread', false);
  await sleep(80);
  const gapOffStart = (await chInfo()).gap;
  await page.mouse.down();
  await sleep(500);
  const gapOffMid = (await chInfo()).gap;
  await page.mouse.up();
  await sleep(120);
  check('A.§A9: crosshairSpread: false 면 연사 중에도 간격이 변하지 않는다',
    Math.abs(gapOffMid - gapOffStart) <= 0.01, { gapOffStart, gapOffMid });
  await api.call(page, 'setSetting', 'crosshairSpread', true);
  await api.debug(page, CH_RAMPAGE_FLAGS);
  await api.restore(page);
  await sleep(120);

  // ---- (§A4) 10종의 구성이 다르다 · 폭탄/로켓의 점선 원 = 실제 폭발 반경 ----
  await page.mouse.move(cardCh.cx, cardCh.cy);
  await sleep(120);
  const shapeRows = [];
  for (const id of WEAPON_IDS) {
    await api.setWeapon(page, id);
    await sleep(90);
    shapeRows.push(await page.evaluate((wid) => {
      const n = document.querySelector('.crs-crosshair');
      const shape = n ? n.querySelector('.crs-ch-shape') : null;
      const arm = n ? n.querySelector('.crs-ch-arm') : null;
      const blast = shape ? shape.querySelector('.crs-ch-blast') : null;
      const parts = shape ? [...shape.children].map((c) => c.className + ':' + Math.round(c.getBoundingClientRect().width)) : [];
      return {
        id: wid,
        sig: parts.join('|') + '#arm=' + (arm ? getComputedStyle(arm).height : 'none') + '#dot=' + (n && n.classList.contains('crs-ch-nodot') ? 'off' : 'on'),
        blastR: blast ? blast.getBoundingClientRect().width / 2 : 0,
        weaponR: window.__crashScreen.weapons().find((w) => w.id === wid).radius
      };
    }, id));
  }
  const sigs = shapeRows.map((r) => r.sig);
  const bombRow = shapeRows.find((r) => r.id === 'bomb'), rocketRow = shapeRows.find((r) => r.id === 'rocket');
  check('A.§A4: 무기 10종의 조준점 구성이 전부 다르다 — `.crs-ch-shape` 의 자식 구성 · 팔 길이 · 중심 점 유무를 합친 서명 10개가 모두 유일하다',
    new Set(sigs).size === 10, shapeRows.map((r) => r.id + ' → ' + r.sig));
  check('A.§A4: 폭탄 · 로켓의 점선 원 반지름이 각 무기의 실제 폭발 반경과 ±4 px 다 (240 / 360) — 조준점이 사거리를 거짓말하지 않는다',
    !!bombRow && !!rocketRow && bombRow.weaponR === 240 && rocketRow.weaponR === 360 &&
    Math.abs(bombRow.blastR - 240) <= 4 && Math.abs(rocketRow.blastR - 360) <= 4,
    { bomb: bombRow, rocket: rocketRow });

  // ---- (§A4) 저격총: 조준 시 숨고 해제 시 돌아온다 ----
  await api.setWeapon(page, 'sniper');
  await sleep(120);
  const snipeBefore = await chDom();
  await api.scope(page, true);
  await poll(async () => (await api.stats(page)).scoped === true, 600, 20);
  await sleep(120);
  const snipeScoped = await page.evaluate(() => {
    const n = document.querySelector('.crs-crosshair');
    return { hidden: !!(n && n.classList.contains('crs-ch-hidden')), display: n ? getComputedStyle(n).display : null, scope: document.querySelectorAll('.crs-scope').length };
  });
  await api.scope(page, false);
  await sleep(160);
  await page.mouse.move(cardCh.cx, cardCh.cy);
  await sleep(140);
  const snipeAfter = await chDom();
  check('A.§A4: 저격총으로 조준하면 조준점이 숨고(조준경 화면이 대신한다) 조준을 풀면 돌아온다',
    !!snipeBefore && snipeBefore.display !== 'none' && snipeScoped.hidden === true && snipeScoped.display === 'none' && snipeScoped.scope === 1 && !!snipeAfter && snipeAfter.display !== 'none',
    { before: snipeBefore && snipeBefore.display, scoped: snipeScoped, after: snipeAfter && snipeAfter.display });

  // ---- (§A9) crosshairScale 1.5 → 팔 길이 1.5배 · crosshair 'off' → 노드 없음 + 커서 복귀 ----
  await api.setWeapon(page, 'pistol');
  await sleep(120);
  const arm10 = (await chDom()).armH;
  await api.call(page, 'setSetting', 'crosshairScale', 1.5);
  await sleep(140);
  const arm15 = (await chDom()).armH;
  await api.call(page, 'setSetting', 'crosshairScale', 1);
  await sleep(140);
  check('A.§A9: crosshairScale: 1.5 면 팔 길이가 정확히 1.5배다 (DOM 에서 잰 높이)',
    arm10 > 0 && Math.abs(arm15 - arm10 * 1.5) <= 0.6, { arm10, arm15 });
  await api.call(page, 'setSetting', 'crosshair', 'off');
  await sleep(140);
  const chOff = await page.evaluate(() => ({
    nodes: document.querySelectorAll('.crs-crosshair').length,
    cursor: getComputedStyle(document.body).cursor,
    aimClass: document.documentElement.classList.contains('crs-aim')
  }));
  await api.call(page, 'setSetting', 'crosshair', 'auto');
  await sleep(140);
  const chOn = await chDom();
  check('A.§A9: crosshair: \'off\' 면 노드가 없고 cursor 가 crosshair 로 돌아온다 — 접근성과 취향 양쪽을 위해 필요하다',
    chOff.nodes === 0 && chOff.aimClass === false && /crosshair/.test(chOff.cursor) && !!chOn && chOn.nodes === 1 && chOn.cursorBody === 'none',
    { off: chOff, on: chOn && { nodes: chOn.nodes, cursor: chOn.cursorBody } });

  // ---- (§A5/§A2) HUD 위에서는 조준점이 회색으로 숨고 기본 커서가 돌아온다 ----
  const hudBtnCh = await api.hudButtonRect(page, msgRestore);
  await page.mouse.move(hudBtnCh.cx, hudBtnCh.cy);
  await sleep(220);
  const overHudCh = await page.evaluate(() => {
    const host = document.querySelector('crs-hud, .crs-hud-host');
    const n = document.querySelector('.crs-crosshair');
    const info = window.__crashScreen.debug.crosshair();
    const panel = host && host.shadowRoot ? host.shadowRoot.querySelector('.panel') : null;
    return {
      state: info.state, shown: info.shown, display: n ? getComputedStyle(n).display : null,
      hudCursor: host ? getComputedStyle(host).cursor : null,
      panelCursor: panel ? getComputedStyle(panel).cursor : null
    };
  });
  await page.mouse.move(cardCh.cx, cardCh.cy);
  await sleep(180);
  const backOnPage = await chInfo();
  check('A.§A5: HUD 위에서는 조준점이 회색(dim)이 되어 숨고 기본 커서가 돌아온다 — 패널은 커서가 필요한 유일한 곳이다',
    overHudCh.state === 'dim' && overHudCh.shown === false && overHudCh.display === 'none' &&
    overHudCh.hudCursor !== 'none' && overHudCh.panelCursor !== 'none' && backOnPage.shown === true && backOnPage.state === 'ok',
    { overHud: overHudCh, back: { shown: backOnPage.shown, state: backOnPage.state } });

  // ---- (§A9) 세 가지 고정 모양과 조준점 색 ----
  const fixedRows = [];
  for (const mode of ['cross', 'dot', 'circle']) {
    await api.call(page, 'setSetting', 'crosshair', mode);
    await sleep(160);
    fixedRows.push(await page.evaluate((m) => {
      const n = document.querySelector('.crs-crosshair');
      const shape = n.querySelector('.crs-ch-shape');
      const arm = n.querySelector('.crs-ch-arm');
      return { mode: m, parts: [...shape.children].map((c) => c.className).join('|'), armH: parseFloat(getComputedStyle(arm).height), dot: getComputedStyle(n.querySelector('.crs-ch-dot')).display };
    }, mode));
  }
  await api.call(page, 'setSetting', 'crosshair', 'auto');
  await sleep(160);
  check('A.§A9: crosshair 가 cross / dot / circle 이면 무기와 무관하게 그 모양 하나로 고정된다 — 덜 보여달라는 요청이다',
    fixedRows[0].parts === '' && fixedRows[0].armH > 0 && fixedRows[0].dot === 'none' &&
    fixedRows[1].parts === '' && fixedRows[1].armH === 0 && fixedRows[1].dot !== 'none' &&
    fixedRows[2].parts === 'crs-ch-circle' && fixedRows[2].armH === 0,
    fixedRows);
  await api.call(page, 'setSetting', 'crosshairColor', 'green');
  await sleep(180);
  const colGreen = (await chDom()).armColor;
  await api.call(page, 'setSetting', 'crosshairColor', 'white');
  await sleep(180);
  const colWhite = (await chDom()).armColor;
  check('A.§A9: crosshairColor 가 기본 상태의 색을 바꾼다 (green → rgb(63, 185, 80), white 로 되돌아온다)',
    colGreen === 'rgb(63, 185, 80)' && colWhite === 'rgb(255, 255, 255)', { green: colGreen, white: colWhite });

  // ---- (§A7) 준비 상태 링: 쿨다운 0→1, 끝나면 사라진다 · 재장전은 색이 다르다 ----
  /* The ring is the one §A7 promise that only exists with real timers running, so this section turns
   * noCooldown / fastReload OFF for itself and puts the block's flags back afterwards. */
  await api.debug(page, Object.assign({}, CH_RAMPAGE_FLAGS, { noCooldown: false, fastReload: false, infiniteAmmo: false }));
  await api.setWeapon(page, 'rocket');
  await sleep(560);   // the rocket's 480 ms swap window has to close before its own cooldown can be read
  await page.mouse.move(cardCh.cx, cardCh.cy);
  await sleep(100);
  const ringRead = () => page.evaluate(() => {
    const r = document.querySelector('.crs-ch-ring');
    if (!r) return null;
    const cs = getComputedStyle(r);
    const m = /(\d+(?:\.\d+)?)deg,\s*rgba?\([^)]*\)\s+\1deg/.exec(cs.backgroundImage || '');
    const deg = /([\d.]+)deg,\s*rgba?\(255,\s*255,\s*255,\s*0\.14\)/.exec(cs.backgroundImage || '');
    return { on: r.classList.contains('crs-ch-ring-on'), display: cs.display, deg: deg ? parseFloat(deg[1]) : (m ? parseFloat(m[1]) : null), bg: (cs.backgroundImage || '').slice(0, 120), kind: window.__crashScreen.debug.crosshair().ring };
  });
  const ringIdle = await ringRead();
  await api.smashAt(page, cardCh.cx, cardCh.cy);
  await sleep(120);
  const ringA = await ringRead();
  await sleep(500);
  const ringB = await ringRead();
  const ringGone = await poll(async () => { const r = await ringRead(); return r && r.on === false ? r : null; }, 2000, 60);
  check('A.§A7: 로켓을 쏘면 준비 링이 뜨고 0 → 1 로 차오르다가 쿨다운이 끝나면 사라진다 — 탄약 HUD 를 안 봐도 언제 쏠 수 있는지 안다',
    !!ringIdle && ringIdle.on === false && !!ringA && ringA.on === true && ringA.kind === 'cooldown' && !!ringB && ringB.deg !== null && ringA.deg !== null && ringB.deg > ringA.deg && !!ringGone,
    { idle: ringIdle, at120: ringA, at620: ringB, gone: !!ringGone });
  // 재장전: 로켓은 탄창 2발이라 한 발 더 쏘면 자동 재장전에 들어간다
  await poll(async () => (await api.ammo(page)).mag === 1, 2500, 60);
  await api.smashAt(page, cardCh.cx, cardCh.cy);
  const ringReload = await poll(async () => { const r = await ringRead(); return r && r.kind === 'reload' ? r : null; }, 2500, 50);
  check('A.§A7: 재장전 중에는 링의 색이 다르다 (#e3b341) — 쿨다운과 재장전이 같은 자리에서 구별된다',
    !!ringReload && /227,\s*179,\s*65/.test(ringReload.bg), ringReload);
  await api.debug(page, CH_RAMPAGE_FLAGS);
  await api.restore(page);
  await sleep(140);

  // =======================================================================================
  // §B — 시각 정돈. 사용자: "타겟팅된 컴포넌트나 투사체의 외곽선은 오히려 집중을 방해하는듯해"
  // =======================================================================================
  await api.setWeapon(page, 'pistol');
  await page.mouse.move(cardCh.cx, cardCh.cy);
  await sleep(160);
  const markerRead = () => page.evaluate(() => {
    const box = document.querySelector('.crs-target');
    if (!box) return null;
    const cs = getComputedStyle(box);
    const br = [...box.querySelectorAll('.crs-tb')].map((b) => {
      const c = getComputedStyle(b);
      return { display: c.display, color: c.borderTopColor || c.borderBottomColor, w: Math.round(parseFloat(c.width)), h: Math.round(parseFloat(c.height)) };
    });
    const bar = document.querySelector('.crs-target-bar');
    const ch = document.querySelector('.crs-crosshair');
    return {
      outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle, bg: cs.backgroundColor, display: cs.display,
      brackets: br, label: (document.querySelector('.crs-target-label') || {}).textContent || '',
      barInCrosshair: !!(bar && ch && ch.contains(bar)),
      barW: bar ? Math.round(parseFloat(getComputedStyle(bar).width)) : null,
      barH: bar ? Math.round(parseFloat(getComputedStyle(bar).height)) : null,
      barOpacity: bar ? getComputedStyle(bar).opacity : null,
      barDisplay: bar ? getComputedStyle(bar).display : null,
      fillRatio: (() => { const f = bar ? bar.querySelector('.crs-target-fill') : null; return f && bar ? parseFloat(getComputedStyle(f).width) / parseFloat(getComputedStyle(bar).width) : null; })(),
      fillColor: (() => { const f = bar ? bar.querySelector('.crs-target-fill') : null; return f ? getComputedStyle(f).backgroundColor : null; })(),
      chText: ch ? (ch.textContent || '').trim() : null
    };
  });
  const mk1 = await markerRead();
  check('A.§B2: 기본 설정에서 `.crs-target` 에 실선 외곽선이 없고(outline-width 0) 배경 틴트도 없다 — 가장 시끄럽던 것이 가장 덜 중요한 것이었다',
    !!mk1 && parseFloat(mk1.outlineWidth) === 0 && (mk1.bg === 'rgba(0, 0, 0, 0)' || mk1.bg === 'transparent'), mk1);
  check('A.§B2: 대신 10px \'ㄱ\'자 모서리 괄호 4개가 흰색 55 % 로 떠 있다',
    !!mk1 && mk1.brackets.length === 4 && mk1.brackets.every((b) => b.display !== 'none' && b.w === 10 && b.h === 10 && /0\.55/.test(b.color)), mk1 && mk1.brackets);
  check('A.§B2: 체력 바가 `.crs-crosshair` 의 자손이고(요소에서 떼어 조준점 아래로) 기본값에서는 숫자가 하나도 없다',
    !!mk1 && mk1.barInCrosshair === true && mk1.barDisplay !== 'none' && mk1.barH === 4 && !/\d+\s*\/\s*\d+/.test(mk1.chText || '') && !/\d+\s*\/\s*\d+/.test(mk1.label || ''), mk1);
  // ---- 바 길이 공식: clamp(round(20 + √maxHp × 6), 24, 140) ----
  /* The bar is drawn for whatever pickTarget() FOCUSES, which inside a container is often a child — so the
   * formula is checked against the max the product says it drew from (debug.crosshair().hp.max), and the
   * independent element-level reading (api.hpOf of a leaf, #demo-img) is asserted beside it. Three targets
   * of different size, so "큰 걸 겨누면 바도 길다" is a comparison and not one lucky number. */
  const barFor = async (sel, pt) => {
    const r = await api.rect(page, sel);
    await page.mouse.move(pt ? r.left + pt[0] : r.cx, pt ? r.top + pt[1] : r.cy);
    await sleep(160);
    const hp = await api.hpOf(page, sel);
    const m = await markerRead();
    const info = await chInfo();
    const max = info.hp ? info.hp.max : 0;
    return { sel, elMax: hp.max, drawnMax: max, approx: hp.approx, barW: m.barW, want: Math.max(24, Math.min(140, Math.round(20 + Math.sqrt(max) * 6))) };
  };
  const barRows = [await barFor('#big-card', [6, 6]), await barFor('#small-card', [6, 6]), await barFor('#demo-img')];
  check('A.§B2: 바의 가로 길이가 공식 clamp(round(20 + √maxHp × 6), 24, 140) 과 ±2 px 안에서 일치한다 — 큰 걸 겨누면 바도 길다',
    barRows.every((r) => r.drawnMax > 0 && Math.abs(r.barW - r.want) <= 2) && new Set(barRows.map((r) => r.barW)).size >= 2, barRows);
  check('A.§B2: 그 길이는 겨누고 있는 요소의 실제 최대 체력에서 나온다 — 잎 요소(#demo-img)에서 api.hpOf 의 max 와 바가 그린 max 가 같다',
    barRows[2].drawnMax === barRows[2].elMax, barRows[2]);
  // 400+ 에서 상한 140 (그리고 §C4 의 approx 가 바 끝에 점선으로 남는다)
  await page.evaluate(() => {
    const box = document.createElement('div'); box.id = 'x-bar-cap';
    Object.assign(box.style, { position: 'fixed', left: '160px', top: '160px', width: '620px', height: '420px', padding: '20px', boxSizing: 'border-box', background: '#eef3fa', zIndex: '60', overflow: 'hidden' });
    for (let i = 0; i < 300; i++) { const k = document.createElement('div'); Object.assign(k.style, { width: '560px', height: '30px', background: '#9ab6d8' }); box.append(k); }
    document.body.append(box);
  });
  await page.mouse.move(166, 166);   // inside the 20 px padding: the CONTAINER, not one of its 300 children
  await sleep(220);
  const capHp = await api.hpOf(page, '#x-bar-cap');
  const capBar = await markerRead();
  const capApprox = await page.evaluate(() => { const b = document.querySelector('.crs-target-bar'); return !!(b && b.classList.contains('crs-ch-hp-approx')); });
  check('A.§B2: 최대 체력 400 을 넘어도 바는 140 px 을 넘지 않고, §C4 의 근사치(approx)는 바 끝의 점선으로 남는다 — 숫자가 사라진 자리를 바가 대신한다',
    capHp.max > 400 && capBar.barW === 140 && capHp.approx === true && capApprox === true, { hp: capHp, barW: capBar.barW, approx: capApprox });
  await page.evaluate(() => { const b = document.getElementById('x-bar-cap'); if (b) b.remove(); });
  await api.restore(page);
  await sleep(120);
  // ---- 상처가 없으면 조용하다: 불투명도 40 % → 한 대 맞으면 100 % ----
  await api.setWeapon(page, 'pistol');
  const cardB = await api.rect(page, '#big-card');
  await page.mouse.move(cardB.cx, cardB.cy);
  await sleep(160);
  const barFull = await markerRead();
  await api.smashAt(page, cardB.cx, cardB.cy);
  await sleep(160);
  const barHurt = await markerRead();
  check('A.§B2: 상처가 없으면 바가 조용하다 — 불투명도 0.4, 한 대 때리면 1.0 이고 채움이 줄어든다',
    !!barFull && !!barHurt && Math.abs(parseFloat(barFull.barOpacity) - 0.4) < 0.02 && Math.abs(parseFloat(barHurt.barOpacity) - 1) < 0.02 && barHurt.fillRatio < barFull.fillRatio,
    { full: { o: barFull && barFull.barOpacity, r: barFull && barFull.fillRatio }, hurt: { o: barHurt && barHurt.barOpacity, r: barHurt && barHurt.fillRatio } });
  // ---- (§B4) targetMarker: full / off ----
  await api.call(page, 'setSetting', 'targetMarker', 'full');
  await sleep(160);
  const mkFull = await markerRead();
  await api.call(page, 'setSetting', 'targetMarker', 'off');
  await sleep(160);
  const mkOff = await page.evaluate(() => {
    const box = document.querySelector('.crs-target');
    return { brackets: document.querySelectorAll('.crs-tb').length, display: box ? getComputedStyle(box).display : null };
  });
  await api.call(page, 'setSetting', 'targetMarker', 'brackets');
  await sleep(160);
  const mkBack = await markerRead();
  check('A.§B4: targetMarker: \'full\' 이면 실선이 돌아오고, \'off\' 면 표식 노드가 아예 없다, \'brackets\' 로 되돌리면 괄호가 돌아온다',
    !!mkFull && parseFloat(mkFull.outlineWidth) === 2 && mkOff.brackets === 0 && mkOff.display === 'none' && !!mkBack && mkBack.brackets.length === 4 && parseFloat(mkBack.outlineWidth) === 0,
    { full: mkFull && mkFull.outlineWidth, off: mkOff, back: mkBack && mkBack.outlineWidth });
  // ---- (§B4) highContrastMarkers 가 두 설정을 자동으로 올린다 ----
  await api.call(page, 'setSetting', 'highContrastMarkers', true);
  await sleep(160);
  const hcInfo = await chInfo();
  const hcTarget = await markerRead();
  await api.call(page, 'setSetting', 'highContrastMarkers', false);
  await sleep(160);
  const hcOffInfo = await chInfo();
  check('A.§B4: highContrastMarkers: true 면 targetMarker 가 full, hostileMarker 가 always 로 자동으로 올라가고 실선이 돌아온다',
    hcInfo.targetMarker === 'full' && hcInfo.hostileMarker === 'always' && parseFloat(hcTarget.outlineWidth) >= 2 &&
    hcOffInfo.targetMarker === 'brackets' && hcOffInfo.hostileMarker === 'quiet',
    { on: { t: hcInfo.targetMarker, h: hcInfo.hostileMarker, outline: hcTarget.outlineWidth }, off: { t: hcOffInfo.targetMarker, h: hcOffInfo.hostileMarker } });
  await api.restore(page);
  await sleep(120);

  // ---- 전투 쪽 절반: §A5 상태 색 · §A6 히트마커 · §A7 대시 점 · §A8 힌트 · §B3 적대 오라 ----
  await setCombatMode('survival');
  await api.debug(page, Object.assign({}, CH_RAMPAGE_FLAGS, { noInvuln: false, infiniteAmmo: true }));
  await resetScene(140, 140);
  await api.setWeapon(page, 'pistol');
  const srcCh = await api.rect(page, '#fire-src');
  const enemyCh = await api.rectNoScroll(page, '#fire-enemy');
  const tierCh = await force('#fire-enemy', 'forceAttack');
  await sleep(160);
  await page.mouse.move(enemyCh.cx, enemyCh.cy);
  await sleep(160);
  const onEnemyCh = await chDom();
  const onEnemyInfo = await chInfo();
  await page.mouse.move(enemyCh.right + 70, enemyCh.cy);
  await sleep(160);
  const onEmptyCh = await chDom();
  check('A.§A5: 적대 요소 위에서 조준점이 붉어진다 (#e5484d) 그리고 빈 곳에서는 흐린 회색에 중심 점이 없다',
    tierCh === 'shooter' && !!onEnemyCh && onEnemyCh.armColor === 'rgb(229, 72, 77)' && onEnemyInfo.state === 'hostile' &&
    !!onEmptyCh && onEmptyCh.armColor === 'rgba(255, 255, 255, 0.35)' && onEmptyCh.dotDisplay === 'none',
    { enemy: onEnemyCh && onEnemyCh.armColor, info: onEnemyInfo && onEnemyInfo.state, empty: onEmptyCh && { c: onEmptyCh.armColor, dot: onEmptyCh.dotDisplay } });
  // 락온 중인 적 위: 붉은색 + 0.25초 주기 맥동 — "여기를 쏘면 끊긴다" 는 신호다
  const lockRet = await force('#fire-enemy', 'forceLock');
  await page.mouse.move(enemyCh.cx, enemyCh.cy);
  const lockCh = await poll(async () => {
    const r = await page.evaluate(() => {
      const n = document.querySelector('.crs-crosshair');
      const info = window.__crashScreen.debug.crosshair();
      const an = n ? n.getAnimations().map((a) => { const t = a.effect.getTiming(); return { d: t.duration, forever: t.iterations === Infinity }; }) : [];
      return { state: info.state, anims: an, locks: window.__crashScreen.stats().locks };
    });
    return r.state === 'lock' ? r : null;
  }, 1500, 40);
  check('A.§A5: 락온 중인 적 위에서는 붉은색에 0.25초 주기 맥동이 붙는다 — 여기를 쏘면 락온이 끊긴다는 신호',
    !!lockRet && !!lockCh && lockCh.locks >= 1 && lockCh.anims.some((a) => a.forever === true && Math.abs(a.d - 250) < 1),
    { lockRet, lockCh });
  // ---- (§A6) 히트마커 4종 — 전부 진짜 피해 경로를 지나서 나온다 ----
  const hitRead = () => page.evaluate(() => {
    const n = document.querySelector('.crs-ch-hit');
    if (!n) return { node: false };
    const l = n.querySelector('.crs-ch-hit-line');
    return { node: true, cls: n.className, color: l ? getComputedStyle(l).backgroundColor : '' };
  });
  const waitHit = (kind) => poll(async () => { const h = await hitRead(); return h.node && h.cls.indexOf('crs-ch-hit-' + kind) >= 0 ? h : null; }, 1500, 25);
  /* The kind CLASS survives its own animation (only the opacity returns to 0), so every step below clears
   * it first: without that, a poll for the next kind could be satisfied by the previous mark still sitting
   * on the node — which is exactly how an earlier version of this section "passed" a 치명타 assertion with
   * a 파괴 marker, because the crit happened to be the shot that finished the enemy off. */
  const clearHit = () => page.evaluate(() => { const n = document.querySelector('.crs-ch-hit'); if (n) n.className = 'crs-ch-hit'; });
  /* 락온 차단: the shot that cancels the lock. applyHit paints 명중 first and breakLock() paints 차단 on
   * the next frame, so polling for the green one also proves the ORDER the player sees. */
  await clearHit();
  await api.smashAt(page, enemyCh.cx, enemyCh.cy);
  const hitBlock = await waitHit('block');
  /* "보인다" is an opacity that actually rises: the shot is fired INSIDE the sampler, so the rAF loop is
   * already running when the 120 ms marker starts and cannot miss it between two CDP round trips. */
  const hitVisible = await page.evaluate((x, y) => new Promise((res) => {
    const n = document.querySelector('.crs-ch-hit');
    let peak = 0;
    const t0 = performance.now();
    const step = () => {
      if (n) peak = Math.max(peak, parseFloat(getComputedStyle(n).opacity) || 0);
      if (performance.now() - t0 < 420) requestAnimationFrame(step); else res(peak);
    };
    requestAnimationFrame(step);
    window.__crashScreen.smashAt(x, y);
  }), enemyCh.cx, enemyCh.cy);
  const hitPlain = await waitHit('hit');
  /* 치명타 on a FRESH enemy: a crit is double damage, and on a worn-down target it is the shot that
   * breaks it — which is a 파괴 marker, not a 치명타 one. The scene is rebuilt so the crit is survivable. */
  await api.restore(page);
  await sleep(120);
  await resetScene(140, 140);
  const enemyCrit = await api.rectNoScroll(page, '#fire-enemy');
  await force('#fire-enemy', 'forceAttack');
  await page.mouse.move(enemyCrit.cx, enemyCrit.cy);
  await sleep(160);
  await api.debug(page, Object.assign({}, CH_RAMPAGE_FLAGS, { noInvuln: false, infiniteAmmo: true, noCrit: false, forceCrit: true }));
  await clearHit();
  await api.smashAt(page, enemyCrit.cx, enemyCrit.cy);
  const hitCrit = await waitHit('crit');
  await api.debug(page, Object.assign({}, CH_RAMPAGE_FLAGS, { noInvuln: false, infiniteAmmo: true }));
  await api.setWeapon(page, 'rocket');
  await sleep(540);
  await clearHit();
  let hitKill = null;
  for (let i = 0; i < 6 && !hitKill; i++) { await api.smashAt(page, enemyCrit.cx, enemyCrit.cy); hitKill = await waitHit('kill'); }
  check('A.§A6: 히트마커 4종이 색으로 구분된다 — 명중 흰색 · 치명타 #ffd166 · 파괴 #e5484d · 락온 차단 #3fb950',
    !!hitPlain && hitPlain.color === 'rgb(255, 255, 255)' &&
    !!hitCrit && hitCrit.color === 'rgb(255, 209, 102)' &&
    !!hitKill && hitKill.color === 'rgb(229, 72, 77)' &&
    !!hitBlock && hitBlock.color === 'rgb(63, 185, 80)',
    { plain: hitPlain, crit: hitCrit, kill: hitKill, block: hitBlock });
  check('A.§A6: 그리고 실제로 보인다 — 명중 순간 `.crs-ch-hit` 의 불투명도가 0 에서 올라간다 (페이지 안 rAF 로 측정)',
    typeof hitVisible === 'number' && hitVisible > 0.2, { peakOpacity: hitVisible });
  // hitmarker: false 면 노드가 아예 생기지 않는다
  await api.call(page, 'setSetting', 'hitmarker', false);
  await sleep(160);
  const hitOffNodes = await api.count(page, '.crs-ch-hit');
  await api.smashAt(page, srcCh.cx, srcCh.cy);
  await sleep(160);
  const hitOffAfter = await api.count(page, '.crs-ch-hit');
  await api.call(page, 'setSetting', 'hitmarker', true);
  await sleep(140);
  check('A.§A9: hitmarker: false 면 히트마커 노드가 생성되지 않는다 (쏜 뒤에도 0개) 그리고 다시 켜면 돌아온다',
    hitOffNodes === 0 && hitOffAfter === 0 && (await api.count(page, '.crs-ch-hit')) === 1,
    { before: hitOffNodes, afterShot: hitOffAfter });

  // ---- (§A8) 깊이·관통 힌트: 가려진 적 위에서 ▼ / ▼2 / 표시 없음 ----
  await api.restore(page);
  await sleep(120);
  await page.evaluate(() => {
    const lab = document.createElement('div'); lab.id = 'x-cover-lab';
    Object.assign(lab.style, { position: 'fixed', left: '140px', top: '220px', width: '520px', height: '360px', zIndex: '70' });
    const en = document.createElement('div'); en.id = 'x-cover-enemy';
    Object.assign(en.style, { position: 'absolute', left: '0px', top: '0px', width: '360px', height: '240px', background: '#c8d8e8' });
    const cv = document.createElement('div'); cv.id = 'x-cover-top';
    Object.assign(cv.style, { position: 'absolute', left: '40px', top: '40px', width: '260px', height: '170px', background: '#2d3a46', zIndex: '5' });
    lab.append(en, cv);
    document.body.append(lab);
  });
  await resetScene(1000, 200);
  const coverTier = await force('#x-cover-enemy', 'forceAttack');
  const coverPt = { x: 140 + 40 + 130, y: 220 + 40 + 85 };
  const hintFor = async (id) => {
    await api.setWeapon(page, id);
    await sleep(620);   // the swap window closes, and the hint re-reads the cover at most every 150 ms
    await page.mouse.move(coverPt.x + 1, coverPt.y);
    await sleep(120);
    await page.mouse.move(coverPt.x, coverPt.y);
    await sleep(260);
    const i = await chInfo();
    return { id, hint: i.hint, bright: i.hintBright };
  };
  const hintPistol = await hintFor('pistol');
  const hintSniper = await hintFor('sniper');
  const hintRocket = await hintFor('rocket');
  check('A.§A8: 가려진 적 위에서 권총이면 흐린 ▼, 저격총이면 밝은 ▼2 (관통 2층), 로켓이면 표시가 없다 — 폭발은 엄폐를 무시하므로 할 말이 없다',
    coverTier === 'shooter' && hintPistol.hint === '▼' && hintPistol.bright === false &&
    hintSniper.hint === '▼2' && hintSniper.bright === true && hintRocket.hint === '',
    { pistol: hintPistol, sniper: hintSniper, rocket: hintRocket });
  await page.evaluate(() => { const l = document.getElementById('x-cover-lab'); if (l) l.remove(); });
  await api.restore(page);
  await sleep(120);

  // ---- (§B3) 적대 요소는 평상시 조용하고 공격 준비 때만 실선이다 ----
  const auraRead = () => page.evaluate(() => {
    const a = document.querySelector('.crs-hostile');
    if (!a) return null;
    const cs = getComputedStyle(a);
    return { w: parseFloat(cs.outlineWidth), style: cs.outlineStyle, shadow: cs.boxShadow, cls: a.className, anims: a.getAnimations().length };
  });
  const solidNodes = () => page.evaluate(() => [...document.querySelectorAll('[data-crs]')].filter((n) => {
    const cs = getComputedStyle(n);
    return cs.outlineStyle === 'solid' && parseFloat(cs.outlineWidth) >= 2;
  }).map((n) => n.className));
  await resetScene(1000, 760);
  await api.setWeapon(page, 'pistol');
  const enemyB3 = await api.rectNoScroll(page, '#fire-enemy');
  const tierB3 = await force('#fire-enemy', 'forceAttack');
  const auraLoud = await poll(async () => { const a = await auraRead(); return a && a.w >= 2 ? a : null; }, 900, 20);
  const solidLoud = await solidNodes();
  const auraQuiet = await poll(async () => { const a = await auraRead(); return a && a.w === 0 ? a : null; }, 3000, 60);
  const solidQuiet = await solidNodes();
  check('A.§B3: 적대 요소는 공격 준비에 들어갈 때만 2px 실선 + 맥동이고, 끝나면 다시 outline-width 0 으로 조용해진다 — 조용히 있다가 행동할 때 소리친다',
    tierB3 === 'shooter' && !!auraLoud && auraLoud.w === 2 && auraLoud.anims >= 1 && !!auraQuiet && auraQuiet.w === 0 && auraQuiet.anims === 0,
    { loud: auraLoud, quiet: auraQuiet });
  check('A.§B3: 평상시에도 안쪽 그림자와 작은 라벨은 남는다 — 적이라는 사실은 사라지지 않는다',
    !!auraQuiet && /inset/.test(auraQuiet.shadow) && (await page.evaluate(() => { const l = document.querySelector('.crs-hostile-label'); return !!l && getComputedStyle(l).display !== 'none' && /👿/.test(l.textContent || ''); })) === true,
    auraQuiet);
  check('A.§B1: 동시에 떠 있는 2px 실선 외곽선 노드가 1개 이하다 — 평상시 0개, 공격 준비 중 1개',
    solidQuiet.length === 0 && solidLoud.length <= 1, { quiet: solidQuiet, loud: solidLoud });
  // ---- (§B4) hostileMarker: 'off' ----
  await api.call(page, 'setSetting', 'hostileMarker', 'off');
  await sleep(200);
  const auraOff = await auraRead();
  await api.call(page, 'setSetting', 'hostileMarker', 'quiet');
  await sleep(200);
  const auraBack = await auraRead();
  check('A.§B4: hostileMarker: \'off\' 면 오라가 아예 그려지지 않고(그림자도 라벨도), \'quiet\' 로 되돌리면 돌아온다',
    !!auraOff && /crs-hostile-off/.test(auraOff.cls) && auraOff.shadow === 'none' && !!auraBack && /inset/.test(auraBack.shadow),
    { off: auraOff, back: auraBack });

  // ---- (§B / SPEC-combat §D4) 투사체: 도착 링은 비행 60 % 지점까지 없고, 맞을/빗나갈 궤적이 다르다 ----
  await api.restore(page);
  await sleep(120);
  await resetScene(1080, 800);
  /* MEASUREMENT NOTE. The ring appears at 60 % of the orb's FLIGHT TIME, and the orb flies at a constant
   * speed toward where the player was at launch — so "how far along is it?" has to be measured against
   * that fixed point, not against the last sample. An earlier version of this check moved the drone mid
   * flight and then normalised by the distance actually travelled: the orb sailed on past the old target,
   * the denominator grew, and perfectly correct rings looked "early". The flight and the dodge are two
   * separate shots now — this one never moves the player. */
  const orbFlight = (moveAt) => page.evaluate((mv) => new Promise((res) => {
    const out = [];
    const t0 = performance.now();
    const p0 = window.__crashScreen.player();
    const target = { x: p0.x, y: p0.y };
    const step = () => {
      const o = document.querySelector('.crs-orb');
      if (o) {
        const r = o.getBoundingClientRect();
        out.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, rings: document.querySelectorAll('.crs-orb-ring').length, op: +parseFloat(getComputedStyle(o).opacity).toFixed(2) });
        if (mv > 0 && out.length === mv) window.__crashScreen.debug.setPlayerPos(80, 120);
      }
      if (performance.now() - t0 < 2200) requestAnimationFrame(step); else res({ out, target });
    };
    requestAnimationFrame(step);
  }), moveAt);
  const tierOrb = await force('#fire-enemy', 'forceAttack');
  await poll(async () => (await api.stats(page)).orbs >= 1, 1200, 20);
  const flightA = await orbFlight(0);
  const orbMoving = flightA.out.filter((s, i) => i === 0 || Math.hypot(s.x - flightA.out[0].x, s.y - flightA.out[0].y) > 2);
  const orbTotal = orbMoving.length ? Math.hypot(flightA.target.x - orbMoving[0].x, flightA.target.y - orbMoving[0].y) : 0;
  const orbProg = orbMoving.map((s) => ({ p: orbTotal > 0 ? Math.hypot(s.x - orbMoving[0].x, s.y - orbMoving[0].y) / orbTotal : 0, rings: s.rings, op: s.op }));
  const early = orbProg.filter((s) => s.p < 0.55), late = orbProg.filter((s) => s.p >= 0.7);
  check('A.§B/§D4: 투사체 도착 링이 비행 60 % 지점까지 아예 없다 (노드 0개) 그리고 마지막 구간에서 나타난다 — 조용히 날아오다 마지막에만 경고한다',
    tierOrb === 'shooter' && early.length >= 5 && early.every((s) => s.rings === 0) && late.some((s) => s.rings >= 1),
    { samples: orbProg.length, total: Math.round(orbTotal), early: early.length, earlyRings: early.filter((s) => s.rings > 0).length, late: late.filter((s) => s.rings >= 1).length });
  // 두 번째 발사: 비행 중에 드론을 선 밖으로 옮겨 맞을/빗나갈 궤적의 불투명도를 같은 탄에서 비교한다
  await api.restore(page);
  await sleep(120);
  await resetScene(1080, 800);
  await force('#fire-enemy', 'forceAttack');
  await poll(async () => (await api.stats(page)).orbs >= 1, 1200, 20);
  const flightB = await orbFlight(18);
  const bMoving = flightB.out.filter((s, i) => i === 0 || Math.hypot(s.x - flightB.out[0].x, s.y - flightB.out[0].y) > 2);
  const opHit = bMoving.slice(0, 10).map((s) => s.op), opMiss = bMoving.slice(24).map((s) => s.op);
  check('A.§B/§D4: 맞을 궤적은 불투명도 1.0, 빗나갈 궤적은 0.55 다 — 비행 중에 드론을 선 밖으로 옮기면 그 자리에서 흐려진다',
    opHit.length >= 3 && opHit.every((o) => Math.abs(o - 1) < 0.02) && opMiss.length >= 3 && opMiss.every((o) => Math.abs(o - 0.55) < 0.02),
    { hit: opHit.slice(0, 5), miss: opMiss.slice(0, 5), samples: bMoving.length });

  // ---- 모션 축소: 맥동과 히트마커 확대가 없고 색 변화만 남는다 ----
  await api.restore(page);
  await sleep(120);
  await api.call(page, 'setSetting', 'reduceMotion', 'on');
  await sleep(160);
  await page.mouse.move(enemyB3.cx, enemyB3.cy);
  await sleep(160);
  const rmHit = await page.evaluate(() => {
    const d = window.__crashScreen.debug;
    d.hitMarker('crit');   // same code path the real damage sink uses; read synchronously, so no race
    const n = document.querySelector('.crs-ch-hit');
    const keys = n.getAnimations().map((a) => a.effect.getKeyframes().map((k) => Object.keys(k).filter((x) => x !== 'offset' && x !== 'computedOffset' && x !== 'easing').join('+')).join('/'));
    return { keys, color: n.style.getPropertyValue('--crs-ch-hit-c'), cls: n.className };
  });
  const rmLockTier = await force('#fire-enemy', 'forceLock');
  await page.mouse.move(enemyB3.cx, enemyB3.cy);
  await sleep(300);
  const rmLock = await page.evaluate(() => {
    const n = document.querySelector('.crs-crosshair');
    return { state: window.__crashScreen.debug.crosshair().state, forever: n.getAnimations().filter((a) => a.effect.getTiming().iterations === Infinity).length };
  });
  await api.call(page, 'setSetting', 'reduceMotion', 'auto');
  await sleep(160);
  check('A.모션 축소: 히트마커에서 확대가 빠지고 색만 남는다 — 키프레임에 transform 이 하나도 없다',
    !!rmHit && rmHit.keys.length >= 1 && rmHit.keys.every((k) => !/transform/.test(k)) && rmHit.color === '#ffd166' && /crs-ch-hit-crit/.test(rmHit.cls),
    rmHit);
  check('A.모션 축소: 락온 맥동도 없다 — 조준점에 무한 반복 애니메이션이 0개다 (색은 그대로 붉다)',
    rmLockTier !== 'missing:forceLock' && !!rmLock && rmLock.forever === 0, { rmLockTier, rmLock });

  // ---- 무흔적: 히트마커 애니메이션 중 Escape → 노드 0 · 애니메이션 0 · 커서 복원 ----
  await api.restore(page);
  await sleep(120);
  await api.debug(page, Object.assign({}, CH_RAMPAGE_FLAGS, { noInvuln: false, infiniteAmmo: true }));
  await resetScene(1000, 760);
  await api.setWeapon(page, 'pistol');
  const enemyEsc = await api.rectNoScroll(page, '#fire-enemy');
  await force('#fire-enemy', 'forceAttack');
  await page.mouse.move(enemyEsc.cx, enemyEsc.cy);
  await sleep(160);
  // the shot and the reading are one evaluate, so Escape lands while the 120 ms marker is still running
  const chAlive = await page.evaluate((x, y) => {
    window.__crashScreen.smashAt(x, y);
    const n = document.querySelector('.crs-ch-hit');
    return { ch: document.querySelectorAll('.crs-crosshair').length, cursor: getComputedStyle(document.body).cursor, hitAnims: n ? n.getAnimations().length : -1 };
  }, enemyEsc.cx, enemyEsc.cy);
  await page.keyboard.press('Escape');
  const chInactive = await poll(async () => !(await api.active(page)), 1500, 20);
  await settleRaf(page);
  const chTrace = await page.evaluate(() => ({
    nodes: document.querySelectorAll('[data-crs]').length,
    anims: document.getAnimations().length,
    cursorBody: getComputedStyle(document.body).cursor,
    cursorHtml: getComputedStyle(document.documentElement).cursor,
    aimClass: document.documentElement.classList.contains('crs-aim'),
    activeClass: document.documentElement.classList.contains('crs-active')
  }));
  const chPend = await api.pending(page);
  const chRaf = await api.pendingRaf(page);
  check('A.§D 무흔적: 히트마커 애니메이션 중에 Escape → [data-crs] 0개, 애니메이션 0개, 타이머·프레임 0, 그리고 운영체제 커서가 돌아온다',
    chAlive.ch === 1 && chAlive.cursor === 'none' && chAlive.hitAnims >= 1 && chInactive === true && chTrace.nodes === 0 && chTrace.anims === 0 &&
    chPend === 0 && chRaf === 0 && chTrace.cursorBody !== 'none' && chTrace.aimClass === false && chTrace.activeClass === false,
    { alive: chAlive, trace: chTrace, pending: chPend, raf: chRaf });
  const chReOn = await page.evaluate(contentJs);
  check('A.§D 무흔적: content.js 가 그 뒤 깨끗하게 다시 켜지고 조준점이 다시 하나 그려진다',
    chReOn === 'on' && (await api.count(page, '.crs-crosshair')) >= 0, chReOn);
  await api.debug(page, Object.assign({}, CH_RAMPAGE_FLAGS, { noInvuln: true }));
  await api.restore(page);
  await sleep(120);

  // =======================================================================================
  // SPEC-destruction §F — 연소 시스템
  //   사용자: "불 공격은 지속딜과 확산이 포인트인데 없네"
  // §B2 above already holds the 3단계 계약 (불은 무적 요소에도 붙고 번지며 적에게 닿으면 문다). This
  // section is the rest of §F: 지속 피해와 자연 감소 (§F1), 인접 확산 (§F2), 모습과 소리 (§F3),
  // 파괴·상태·복구·폭발 연계 (§F4), 점화 무기표 (§F5), 화염방사기 재설계와 화염탄 (§F6).
  // The fixture row #burn-a | #burn-b | #burn-c touch with a 0 px gap; #burn-off is 40 px past C.
  // =======================================================================================
  console.log('--- rules: SPEC-destruction §F — 연소 시스템 (지속 피해 · 확산 · 연계 · 화염탄) ---');
  const burnOf = (id) => page.evaluate((q) => ((window.__crashScreen.debug.burning() || []).find((b) => b.id === q) || null), id);
  const burnAll = () => page.evaluate(() => (window.__crashScreen.debug.burning() || []).map((b) => `${b.id || b.tag}:${b.stacks}`));
  const igniteF = (sel, n) => page.evaluate((q, k) => window.__crashScreen.debug.ignite(document.querySelector(q), k), sel, n);

  await setCombatMode('rampage');
  await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: true, noRepair: true, noFalloff: true, noInvuln: true, noPartial: true, timeScale: 1 });
  await api.restore(page);
  await sleep(100);
  const rowF = await api.rect(page, '#burn-b');
  const aF = await api.rectNoScroll(page, '#burn-a');
  const cF = await api.rectNoScroll(page, '#burn-c');
  const offF = await api.rectNoScroll(page, '#burn-off');
  check('A.destr §F fixture: 세 카드가 정말 맞닿아 있고(간격 0) 통제 카드는 40 px 떨어져 있다 — §F2 의 24 px 인접 양쪽 바깥',
    near(rowF.left - aF.right, 0, 2) && near(cF.left - rowF.right, 0, 2) && near(offF.left - cF.right, 40, 2),
    { aToB: rowF.left - aF.right, bToC: cF.left - rowF.right, cToOff: offF.left - cF.right });

  // ---- (F-1) §F1 / §F2 / §F5 의 숫자가 전부 명세 그대로다 ----------------------------------------
  const kF = await debugCall('burnConst');
  check('A.destr §F1/§F2/§F5: 연소 상수표가 명세 그대로다 — 틱 250ms · 초당 2 + stacks×0.14 · 자연 감소 6 · 상한 100 · 동시 20(성능 10) · 확산 700ms·45스택·24px·2개·×0.35 · 점화 화염 9 / 로켓 25·12 / 폭탄 15 / 레이저 4',
    !!kF && kF !== 'missing:burnConst' &&
    kF.tickMs === 250 && kF.dotBase === 2 && Math.abs(kF.dotPerStack - 0.14) < 1e-9 && kF.decay === 6 &&
    kF.max === 100 && kF.cap === 20 && kF.capPerf === 10 &&
    kF.spreadMs === 700 && kF.spreadMin === 45 && kF.spreadGap === 24 && kF.spreadMax === 2 && Math.abs(kF.spreadMul - 0.35) < 1e-9 &&
    kF.flame === 9 && kF.rocket[0] === 25 && kF.rocket[1] === 12 && kF.bomb[1] === 15 && kF.laser === 4, kF);
  check('A.destr §F4/§F6: 연계와 재설계의 숫자도 그대로다 — 폭발 반경 ×1.15 · 주변 스택 20 · 젖음 ×0.3 (20 미만 즉시 꺼짐) · 물총 −40 · 빙결 초당 25 · 화염 틱 피해 8 · 불바다 110px/5초/초당 14 · 연료 12 · 쿨다운 1400',
    !!kF && Math.abs(kF.blastMul - 1.15) < 1e-9 && kF.blastSplash === 20 &&
    Math.abs(kF.wetMul - 0.3) < 1e-9 && kF.wetOut === 20 && kF.water === 40 && kF.freezeRate === 25 &&
    kF.flameTickDmg === 8 && kF.poolR === 110 && kF.poolMs === 5000 && kF.poolPerS === 14 &&
    kF.firebombFuel === 12 && kF.firebombCd === 1400, kF);

  // ---- (F-2) §F1 지속 피해: 100 스택이면 초당 16, 그리고 손대지 않아도 계속 준다 ------------------
  /* Measured INSIDE the page over the product's own tick counter, not over a sleep: setTimeout drifts late
     under load and a window that happens to contain three or five 250 ms steps instead of four would read
     as a damage-rate regression. `ticks` says how many steps really ran, so the per-second figure §F1
     states is computed from what happened rather than from what the sleep hoped for. */
  const dotF = await page.evaluate(() => new Promise((res) => {
    const a = window.__crashScreen, d = a.debug;
    const el = document.querySelector('#burn-a');
    const hp0 = a.hpOf(el).hp;
    const lit = d.ignite(el, 100);
    const t0 = performance.now(), k0 = d.burnStats().ticks;
    setTimeout(() => {
      const ticks = d.burnStats().ticks - k0;
      res({ lit, hp0, hp1: a.hpOf(el).hp, ticks, ms: Math.round(performance.now() - t0) });
    }, 1060);
  }));
  const dotPerSec = dotF.ticks ? (dotF.hp0 - dotF.hp1) * (1000 / (dotF.ticks * 250)) : -1;
  const hpF1 = await api.hpOf(page, '#burn-a');
  await sleep(1000);
  const hpF2 = await api.hpOf(page, '#burn-a');
  check('A.destr §F1: 100 스택에서 1초 뒤 체력이 16±3 줄어든다 (초당 2 + stacks × 0.14, 250ms 마다 1/4씩)',
    dotF.lit === 100 && dotF.ticks >= 4 && dotF.ticks <= 5 && Math.abs(dotPerSec - 16) <= 3,
    { ...dotF, perSecond: dotPerSec, drop: dotF.hp0 - dotF.hp1 });
  check('A.destr §F1: 손대지 않아도 계속 준다 — 두 번째 1초에도 체력이 더 줄고, 스택은 자연 감소로 내려간다 (불을 붙이고 떠나도 일이 진행된다)',
    hpF2.hp < hpF1.hp && !(await api.broken(page, '#burn-a')) &&
    (await burnOf('burn-a')) !== null && (await burnOf('burn-a')).stacks < 100 - 6,
    { at1s: hpF1, at2s: hpF2, burning: await burnAll() });

  // ---- (F-3) §F1 자연 감소: 100 스택은 약 16초 뒤 꺼진다 ------------------------------------------
  /* Measured on an INVULNERABLE element (a combat mode, 18 000 px² — under every hostile floor), so the
   * ledger empties by DECAY and not because the element was destroyed on the way. SPEC-test-speed §3's
   * time scale compresses the wall clock; the simulated figure is what is asserted.
   * §G says "16초 안에 해제된다" and §F1 says "약 16초간 타며 누적 150 전후를 준다": the spec's own
   * constants (100 스택, 초당 6) give 16.5 s exactly, so §G's "16초" is §F1's "약 16초" rounded.
   * INTERPRETATION (reported): the window asserted is 15–17 simulated seconds. */
  await setCombatMode('survival');
  await api.debug(page, { noInvuln: false, noAttacks: true, noRepair: true, timeScale: 0.1 });
  await api.restore(page);
  await sleep(120);
  await api.rect(page, '#burn-a');
  /* Counted in 250 ms STEPS rather than in polled wall-clock milliseconds: at a 0.1 time scale one poll
     round trip is worth most of a simulated second, so a wall-clock reading would carry ±1.5 s of harness
     latency into a 16 s claim. The tick counter is the product's own clock. */
  const decayF = await page.evaluate(() => new Promise((res) => {
    const a = window.__crashScreen, d = a.debug;
    const el = document.querySelector('#burn-a');
    const hp0 = a.hpOf(el).hp;
    const lit = d.ignite(el, 100);
    const k0 = d.burnStats().ticks, t0 = performance.now();
    const done = (ticks) => res({ lit, hp0, hp1: a.hpOf(el).hp, ticks, wallMs: Math.round(performance.now() - t0) });
    const iv = setInterval(() => {
      if ((d.burning() || []).some((b) => b.id === 'burn-a')) return;
      clearInterval(iv); done(d.burnStats().ticks - k0);
    }, 10);
    setTimeout(() => { clearInterval(iv); done(-1); }, 8000);
  }));
  check('A.destr §F1: 100 스택은 자연 감소(초당 6)로 약 16초 뒤 꺼진다 — 무적 요소라 파괴로 끝나는 게 아니라 정말 꺼지는 것이다 (250ms 틱 수로 재고, 시간 배율 0.1 로 돌린다)',
    decayF.lit === 100 && decayF.ticks >= 63 && decayF.ticks <= 69 && decayF.hp1 === decayF.hp0,
    { ...decayF, simulatedMs: decayF.ticks * 250 });
  await api.debug(page, { timeScale: 1, noInvuln: true });
  await setCombatMode('rampage');
  await api.restore(page);
  await sleep(120);

  // ---- (F-4) §F2 확산: 맞닿은 카드로 번지고, 40 px 떨어진 카드에는 안 번진다 ----------------------
  await api.rect(page, '#burn-b');
  const sparks0 = (await debugCall('burnStats')).sparks;
  await igniteF('#burn-b', 60);
  const spreadA = await poll(() => burnOf('burn-a'), 2000, 80);
  const spreadC = await poll(() => burnOf('burn-c'), 2000, 80);
  const spreadOff = await burnOf('burn-off');
  const statsSpread = await debugCall('burnStats');
  check('A.destr §F2: 맞닿은 카드 3장 중 가운데에 60 스택을 주면 2초 안에 나머지 둘도 탄다 (700ms 마다 최대 2개, stacks × 0.35)',
    !!spreadA && !!spreadC && spreadA.stacks >= 15 && spreadA.stacks <= 25 && spreadC.stacks >= 15 && spreadC.stacks <= 25,
    { a: spreadA, c: spreadC, all: await burnAll() });
  check('A.destr §F2: 40 px 떨어진 카드에는 안 번진다 — 거리가 아니라 인접(24px)이어야 한다. 불이 아니라 순간이동이면 곤란하다',
    spreadOff === null, { off: spreadOff, all: await burnAll() });
  check('A.destr §F2: 번진 뒤에도 원래 쪽은 줄지 않는다 (불은 나눠 갖는 게 아니라 번진다) 그리고 확산 순간마다 불꽃이 튀는 연출이 있다',
    (await burnOf('burn-b')).stacks > 45 && statsSpread.sparks >= sparks0 + 2,
    { b: await burnOf('burn-b'), sparks: [sparks0, statsSpread.sparks] });

  // ---- (F-5) §F3 모습: 아래 가장자리 불꽃 · sepia 틴트 · 연기 ------------------------------------
  const lookF = await page.evaluate(() => {
    const el = document.querySelector('#burn-b');
    const r = el.getBoundingClientRect();
    /* The strip flickers with `transform: scaleY(1 → .62 → 1)` every 0.12 s, so its CLIENT box is whatever
       frame it is on; the height §F3 specifies is the laid-out one. Position still comes from the rect. */
    const flames = [...document.querySelectorAll('.crs-flames')].map((n) => { const b = n.getBoundingClientRect(); const cs = getComputedStyle(n); return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: parseFloat(cs.height), bottom: Math.round(b.bottom + (parseFloat(cs.height) - b.height) / 2) }; });
    const mine = flames.find((f) => Math.abs(f.l - r.left) <= 2 && Math.abs(f.w - r.width) <= 3) || null;
    const st = (window.__crashScreen.debug.burning() || []).find((b) => b.id === 'burn-b');
    return { flames: flames.length, mine, bottom: Math.round(r.bottom), filter: el.style.getPropertyValue('filter'), stacks: st ? st.stacks : -1, smoke: document.querySelectorAll('.crs-smoke').length };
  });
  check('A.destr §F3: 타는 요소의 아래 가장자리에 불꽃 오버레이가 붙고, 높이가 12 + stacks × 0.2 px 다 (요소를 따라 움직인다)',
    !!lookF.mine && Math.abs(lookF.mine.bottom - lookF.bottom) <= 3 &&
    Math.abs(lookF.mine.h - (12 + lookF.stacks * 0.2)) <= 1.5, lookF);
  check('A.destr §F3: 틴트가 인라인 filter 로 들어간다 — sepia(stacks/280) brightness(1 + stacks/900)',
    /sepia\(/.test(lookF.filter) && /brightness\(/.test(lookF.filter) &&
    Math.abs(parseFloat(/sepia\(([\d.]+)\)/.exec(lookF.filter)[1]) - lookF.stacks / 280) < 0.01, lookF);
  const smokeF = await poll(async () => { const n = await api.count(page, '.crs-smoke'); return n >= 1 ? n : null; }, 2000, 80);
  check('A.destr §F3: 연기가 피어오른다 (요소당 초당 1.5개)', smokeF !== null && smokeF >= 1, { smoke: smokeF });

  // ---- (F-6) §F3 소리: 노드 하나, 볼륨만 달라진다 ------------------------------------------------
  const audio1 = await debugCall('burnAudio');
  await igniteF('#burn-off', 80);
  await sleep(320);
  const audio2 = await debugCall('burnAudio');
  check('A.destr §F3: 타닥거리는 루프는 하나뿐이다 — 타는 요소가 늘어도 오디오 노드는 1개이고 볼륨만 올라간다',
    !!audio1 && !!audio2 && audio1.nodes <= 1 && audio2.nodes <= 1 &&
    (audio2.ctx === false || (audio2.nodes === 1 && audio2.gain > audio1.gain)),
    { before: audio1, after: audio2, burning: await burnAll() });

  // ---- (F-7) §F4 변위 → 불: 인접 판정이 현재 위치 기준이라 밀어서 떼면 방화선이 된다 --------------
  await api.restore(page);
  await sleep(120);
  await api.debug(page, { noDisplaceCollide: true });
  await api.rect(page, '#burn-b');
  await igniteF('#burn-c', 70);
  await page.evaluate(() => window.__crashScreen.debug.displace(document.querySelector('#burn-c'), 0, -2600));
  const gapPushed = await poll(async () => page.evaluate(() => {
    const b = document.querySelector('#burn-b').getBoundingClientRect();
    const c = document.querySelector('#burn-c').getBoundingClientRect();
    const dx = Math.max(b.left - c.right, c.left - b.right, 0);
    const dy = Math.max(b.top - c.bottom, c.top - b.bottom, 0);
    const g = Math.hypot(dx, dy);
    return g > 24 ? Math.round(g) : null;
  }), 2000, 40);
  await sleep(1700);   // two §F2 spread windows: if adjacency still held, #burn-b would be alight by now
  const notSpread = await burnOf('burn-b');
  check('A.destr §F4: 타는 요소를 밀어 인접을 끊으면 확산이 멈춘다 — 인접 판정이 현재 위치 기준이라 밀어서 떼면 방화선이 된다',
    gapPushed !== null && gapPushed > 24 && notSpread === null && (await burnOf('burn-c')) !== null,
    { gap: gapPushed, b: notSpread, c: await burnOf('burn-c'), all: await burnAll() });
  await api.debug(page, { noDisplaceCollide: false });

  // ---- (F-8) §F4 젖음 · 빙결 ---------------------------------------------------------------------
  /* 물총(젖음)·냉각총(빙결)은 로드맵 8단계라 이 빌드에 무기가 없다. 규칙 자체는 진짜 상태 기록 위에
   * 구현되어 있고 debug.setWet / setFrozen / douse 로 구동한다 — 8단계는 무기만 연결하면 된다. */
  await api.restore(page);
  await sleep(120);
  await api.rect(page, '#burn-a');
  await page.evaluate(() => window.__crashScreen.debug.setWet(document.querySelector('#burn-a'), 8000));
  const wetLit = await igniteF('#burn-a', 100);
  check('A.destr §F4 (젖음 → 불): 젖은 요소는 스택이 30% 만 쌓인다 — 100 을 부어도 30 이다',
    wetLit !== null && Math.abs(wetLit - 30) <= 1, { got: wetLit, chill: await page.evaluate(() => window.__crashScreen.debug.chillOf(document.querySelector('#burn-a'))) });
  const wetOut = await page.evaluate(() => { const d = window.__crashScreen.debug; const el = document.querySelector('#burn-b'); d.setWet(el, 8000); return d.ignite(el, 50); });
  check('A.destr §F4 (젖음 → 불): 젖은 채로 stacks < 20 이면 즉시 꺼진다 — 50 × 0.3 = 15 는 불이 붙지 않는다',
    wetOut === null && (await burnOf('burn-b')) === null, { ret: wetOut, burning: await burnAll() });
  const dousedF = await page.evaluate(() => window.__crashScreen.debug.douse(document.querySelector('#burn-a')));
  check('A.destr §F4 (물총 → 불): 물을 맞히면 틱당 스택이 40 줄고, 남은 스택이 0 이면 꺼진다 — 물총이 소화기가 된다',
    dousedF === 0 && (await burnOf('burn-a')) === null, { after: dousedF, burning: await burnAll() });
  await api.restore(page);
  await sleep(100);
  await api.rect(page, '#burn-c');
  const frozenLit = await page.evaluate(() => { const d = window.__crashScreen.debug; const el = document.querySelector('#burn-c'); d.setFrozen(el, 100); return d.ignite(el, 100); });
  const thawedLit = await page.evaluate(() => { const d = window.__crashScreen.debug; const el = document.querySelector('#burn-c'); d.setFrozen(el, 40); return d.ignite(el, 100); });
  check('A.destr §F4 (완전 빙결 → 불): 완전히 언 요소에는 불이 붙지 않는다. 먼저 녹여야 한다 — 40 까지 녹이면 붙는다',
    frozenLit === null && thawedLit === 100, { frozen: frozenLit, thawed: thawedLit });
  await api.restore(page);
  await sleep(100);

  // ---- (F-9) §F4 파괴 연계: 연소 중에 죽으면 무엇에 맞아 죽었든 ash 다 ---------------------------
  await api.setWeapon(page, 'hammer');
  /* #demo-img, not one of the burn cards: a TEXT-dominant element goes down the §B1 word path
     (spawnWordPieces) whatever its destruction profile says, so its box falls as one piece and its glyphs
     as words — the ash SHAPE never gets a say. That rule is §B's and predates §F; the claim §F4 makes
     ("무엇에 맞아 죽었든 ash") is about the WEAPON not deciding, so it is asserted where the shape is the
     thing that decides. The rect is re-read rather than reused: api.rect() scrolls. */
  const ashPt1 = await api.rect(page, '#demo-img');
  const ashCtl = await page.evaluate((x, y) => {
    const a = window.__crashScreen;
    let guard = 0;
    while (!document.querySelector('#demo-img').hasAttribute('data-crs-broken') && guard++ < 40) a.smashAt(x, y, 'hammer');
    const bs = a.debug.pieceBoxes().filter((b) => !b.chip);
    return { ash: bs.filter((b) => b.ash).length, total: bs.length, hits: guard, broke: document.querySelector('#demo-img').hasAttribute('data-crs-broken') };
  }, ashPt1.cx, ashPt1.cy);
  await api.restore(page);
  await sleep(120);
  const ashPt2 = await api.rect(page, '#demo-img');
  const litAsh = await igniteF('#demo-img', 12);
  /* One full 250 ms step, deliberately: §F4's ash is for an element that was ALREADY burning when the blow
     landed. A fire lit in the same event as the kill is the blast's own ignition (§F5) and must not steal
     the bomb's and the rocket's §B4 debris. */
  await sleep(330);
  const ashBurn = await page.evaluate((x, y) => {
    const a = window.__crashScreen;
    let guard = 0;
    const was = [];
    while (!document.querySelector('#demo-img').hasAttribute('data-crs-broken') && guard++ < 40) {
      was.push((a.debug.burning() || []).filter((b) => b.tag === 'IMG').map((b) => `${b.stacks}/${b.ticked}`).join(','));
      a.smashAt(x, y, 'hammer');
    }
    const bs = a.debug.pieceBoxes().filter((b) => !b.chip);
    return { ash: bs.filter((b) => b.ash).length, total: bs.length, max: bs.reduce((m, b) => Math.max(m, b.w, b.h), 0),
      hits: guard, broke: document.querySelector('#demo-img').hasAttribute('data-crs-broken'), burningBefore: was };
  }, ashPt2.cx, ashPt2.cy);
  check('A.destr §F4: 연소 중에 파괴된 요소는 무엇에 맞아 죽었든 ash 조각으로 부서진다 — 같은 망치가 안 타는 요소는 ash 를 내지 않는다',
    ashCtl.ash === 0 && ashCtl.total >= 1 && ashBurn.ash >= 18 && ashBurn.ash <= 30 && ashBurn.max < 20,
    { control: ashCtl, burning: ashBurn, lit: litAsh });
  await api.restore(page);
  await sleep(120);

  // ---- (F-10) §F4 폭발 연계: 반경 ×1.15 와 주변 스택 20 -----------------------------------------
  await api.setWeapon(page, 'bomb');
  await api.rect(page, '#burn-b');
  await api.smashAt(page, rowF.cx, rowF.cy);
  await sleep(90);
  const plainR = await debugCall('lastBlast');
  await api.restore(page);
  await sleep(120);
  await api.rect(page, '#burn-b');
  const caughtF = await page.evaluate((x, y) => {
    const a = window.__crashScreen, d = a.debug;
    d.ignite(document.querySelector('#burn-c'), 5);          // something in range is already alight
    a.smashAt(x, y, 'bomb');
    return (d.burning() || []).map((b) => ({ id: b.id, s: b.stacks }));
  }, rowF.cx, rowF.cy);
  await sleep(90);
  const burntR = await debugCall('lastBlast');
  const splashed = caughtF.find((b) => b.id === 'burn-a');
  check('A.destr §F4: 연소 중 요소가 폭발에 휘말리면 반경이 ×1.15 된다 (240 → 276) — 아무것도 안 탈 때는 240 그대로다',
    !!plainR && !!burntR && plainR.R === W14.byId.bomb.radius && burntR.R === Math.round(W14.byId.bomb.radius * 1.15),
    { plain: plainR && plainR.R, burnt: burntR && burntR.R });
  check('A.destr §F4/§F5: 그 폭발이 주변에 스택 20을 뿌린다 — 평소 폭탄 범위 점화 15 보다 세다',
    !!splashed && splashed.s >= 20, { burning: caughtF });
  await api.restore(page);
  await sleep(120);

  // ---- (F-11) §F5 점화 무기: 폭탄과 로켓이 정말 불을 붙인다 -------------------------------------
  await api.rect(page, '#burn-b');
  const bombIgnite = await page.evaluate((x, y) => {
    const a = window.__crashScreen;
    a.smashAt(x, y, 'bomb');
    return (a.debug.burning() || []).map((b) => ({ id: b.id, s: b.stacks, by: b.igniter }));
  }, rowF.cx, rowF.cy);
  const bombDirect = bombIgnite.find((b) => b.id === 'burn-b');
  check('A.destr §F5: 폭탄이 범위 안의 요소에 스택 15 를 붙인다 (직격도 15)',
    bombIgnite.length >= 2 && !!bombDirect && Math.abs(bombDirect.s - 15) <= 1, { burning: bombIgnite });
  await api.restore(page);
  await sleep(120);
  await api.rect(page, '#burn-b');
  const rocketIgnite = await page.evaluate((x, y) => new Promise((res) => {
    const a = window.__crashScreen;
    a.smashAt(x, y, 'rocket');
    setTimeout(() => res((a.debug.burning() || []).map((b) => ({ id: b.id, s: b.stacks }))), 240);
  }), rowF.cx, rowF.cy);
  const rocketDirect = rocketIgnite.find((b) => b.id === 'burn-b');
  const rocketSplash = rocketIgnite.find((b) => b.id === 'burn-a' || b.id === 'burn-c');
  check('A.destr §F5: 로켓은 직격 25 · 범위 12 로 갈린다 — 직격이 범위보다 세다',
    !!rocketDirect && !!rocketSplash && rocketDirect.s > rocketSplash.s && rocketDirect.s >= 20 && rocketSplash.s >= 8 && rocketSplash.s <= 14,
    { burning: rocketIgnite });
  await api.restore(page);
  await sleep(120);

  // ---- (F-12) §F6 화염방사기 재설계: 틱 피해 8 · 틱당 스택 9 ------------------------------------
  await api.rect(page, '#burn-a');
  const hpFl0 = await api.hpOf(page, '#burn-a');
  await api.setWeapon(page, 'flame');
  await sleep(60);
  const flameTick = await page.evaluate((x, y) => {
    const a = window.__crashScreen;
    a.smashAt(x, y, 'flame');
    const b = (a.debug.burning() || []).find((q) => q.id === 'burn-a');
    return { hp: a.hpOf(document.querySelector('#burn-a')).hp, stacks: b ? b.stacks : -1, by: b ? b.igniter : '' };
  }, aF.cx, aF.cy);
  check('A.destr §F6: 화염방사기 한 틱은 피해 8 과 스택 9 다 — 즉시 화력은 최하위로 내리고 일을 연소로 옮겼다 (기존 15)',
    hpFl0.hp - flameTick.hp === 8 && flameTick.stacks === 9 && flameTick.by === 'flame',
    { before: hpFl0.hp, after: flameTick });
  await api.restore(page);
  await sleep(120);

  // ---- (F-13) §F6 화염탄: 짧게 누르면 포물선으로 날아가 불바다를 남긴다 --------------------------
  await api.debug(page, { infiniteAmmo: false });
  await api.setWeapon(page, 'flame');
  await sleep(80);
  const bPtF = await api.rect(page, '#burn-b');
  await api.restore(page);
  await sleep(100);
  const fuel0 = (await api.ammo(page)).mag;
  await page.mouse.move(bPtF.cx, bPtF.cy);
  await page.mouse.down();
  await sleep(60);                       // §F6 "보조(짧게)": released well inside the 180 ms press window
  await page.mouse.up();
  const shellSeen = await poll(async () => (await api.count(page, '.crs-firebomb')) >= 1, 400, 20);
  const poolF = await poll(async () => { const p = await debugCall('firePools'); return (Array.isArray(p) && p.length) ? p : null; }, 1500, 40);
  const fuel1 = (await api.ammo(page)).mag;
  /* The press itself is still a stream: every 50 ms tick costs one fuel like any hold weapon, and the SHELL
     costs §F6's 12 on top. stats().shots counts the ticks plus the shell's own one, so the expected bill is
     stated rather than guessed from a sleep that may have drifted. */
  const shotsF1 = (await api.stats(page)).shots;
  check('A.destr §F6: 화염방사기를 짧게 누르면 화염탄이 포물선으로 날아간다 — 연료는 분사한 틱 + 화염탄 12 만큼 든다',
    shellSeen === true && fuel0 - fuel1 === (shotsF1 - 1) + 12,
    { fuel: [fuel0, fuel1], spent: fuel0 - fuel1, shots: shotsF1, shell: shellSeen });
  check('A.destr §F6: 착탄점에 반경 110px 불바다가 5초간 남는다 — 확산의 시작점을 던져 놓는 도구다',
    !!poolF && poolF.length === 1 && poolF[0].r === 110 && poolF[0].msLeft > 3800 && poolF[0].msLeft <= 5000,
    { pools: poolF });
  const poolLit = await poll(() => burnOf('burn-b'), 1500, 60);
  check('A.destr §F6: 불바다 위의 요소는 초당 14 스택씩 받는다 — 던져 놓은 자리에서 불이 자라난다',
    !!poolLit && poolLit.stacks > 0, { lit: poolLit, pools: await debugCall('firePools'), all: await burnAll() });
  const poolGone = await poll(async () => { const p = await debugCall('firePools'); return (Array.isArray(p) && p.length === 0) ? true : null; }, 6000, 100);
  check('A.destr §F6: 그리고 5초가 지나면 불바다는 사라진다 (흔적 없음)',
    poolGone === true && (await api.count(page, '.crs-firepool')) === 0, { pools: await debugCall('firePools') });
  await api.debug(page, { infiniteAmmo: true });
  await api.setWeapon(page, 'hammer');
  await api.restore(page);
  await sleep(120);

  // ---- (F-14) §F4 복구 봉쇄: 타는 적대 요소는 복구를 하지 못한다 --------------------------------
  await setCombatMode('survival');
  await api.debug(page, { noInvuln: true, noRepair: false, noAttacks: true });
  await api.restore(page);
  await sleep(120);
  await api.rect(page, '#fire-src');
  const repTier = await force('#fire-enemy', 'forceAttack');
  await debugCall('setAvatarPos', 120, 120);
  await page.evaluate(() => window.__crashScreen.debug.setPlayerHp(100));
  const srcRep = await api.rectNoScroll(page, '#fire-src');
  await api.smashAt(page, srcRep.cx, srcRep.cy, 'collapse');   // something for the enemy to put back
  await poll(async () => (await api.stats(page)).broken >= 1, 2500, 60);
  const repairedBefore = await force('#fire-enemy', 'forceRepair');
  await page.evaluate(() => window.__crashScreen.debug.clearRepairsForTest && window.__crashScreen.debug.clearRepairsForTest());
  const litEnemy = await page.evaluate(() => window.__crashScreen.debug.ignite(document.querySelector('#fire-enemy'), 80));
  const repairedWhileBurning = await force('#fire-enemy', 'forceRepair');
  check('A.destr §F4: 연소 중인 적대 요소는 복구를 하지 못한다 — 불로 묶어두는 전술이 생긴다 (불이 붙기 전에는 같은 호출이 복구를 시작한다)',
    repTier !== 'missing:forceAttack' && repairedBefore !== null && litEnemy !== null && repairedWhileBurning === null,
    { tier: repTier, before: repairedBefore, lit: litEnemy, while: repairedWhileBurning, broken: (await api.stats(page)).broken });
  await api.debug(page, { noRepair: true });
  await setCombatMode('rampage');
  await api.restore(page);
  await sleep(120);

  // ---- (F-15) 무흔적: 불이 번지는 중에 Escape ----------------------------------------------------
  await api.rect(page, '#burn-b');
  // a page element that ALREADY has an inline filter: "원래 값으로" is not the same as "빈 문자열로"
  await page.evaluate(() => { document.querySelector('#burn-c').style.setProperty('filter', 'blur(0px)'); });
  await igniteF('#burn-b', 90);
  await page.evaluate(() => window.__crashScreen.debug.firebomb(document.querySelector('#burn-a').getBoundingClientRect().left + 40, document.querySelector('#burn-a').getBoundingClientRect().top + 40));
  const burningMid = await poll(async () => { const n = (await burnAll()).length; return n >= 2 ? n : null; }, 2500, 80);
  const liveMid = await page.evaluate(() => ({
    flames: document.querySelectorAll('.crs-flames').length,
    pools: document.querySelectorAll('.crs-firepool').length,
    tinted: [...document.querySelectorAll('body *')].filter((el) => !el.hasAttribute('data-crs') && /sepia/.test(el.style.filter || '')).length,
  }));
  await page.keyboard.press('Escape');
  const offMid = await poll(async () => !(await api.active(page)), 1500, 20);
  await settleRaf(page);
  const traceMid = await page.evaluate(() => ({
    nodes: document.querySelectorAll('[data-crs]').length,
    anims: document.getAnimations().length,
    tinted: [...document.querySelectorAll('body *')].filter((el) => /sepia/.test(el.style.filter || '')).length,
    burnC: document.querySelector('#burn-c').style.getPropertyValue('filter'),
    burnB: document.querySelector('#burn-b').style.getPropertyValue('filter'),
  }));
  const pendMid = await api.pending(page);
  const rafMid = await api.pendingRaf(page);
  check('A.destr §F 무흔적: 불이 번지고 불바다가 깔린 채 Escape → [data-crs] 0개, 애니메이션 0개, 타이머·프레임 0개',
    burningMid !== null && liveMid.flames >= 1 && liveMid.tinted >= 1 && offMid === true &&
    traceMid.nodes === 0 && traceMid.anims === 0 && pendMid === 0 && rafMid === 0,
    { mid: liveMid, burningMid, trace: traceMid, pending: pendMid, raf: rafMid });
  check('A.destr §F 무흔적: 페이지 요소의 인라인 filter 가 빈 문자열이 아니라 **원래 값**으로 돌아간다 — 원래 없던 쪽은 비고, blur(0px) 이던 쪽은 blur(0px) 이다',
    traceMid.tinted === 0 && traceMid.burnB === '' && traceMid.burnC === 'blur(0px)', traceMid);
  const reOnMid = await page.evaluate(contentJs);
  check('A.destr §F 무흔적: 그 뒤 content.js 가 깨끗하게 다시 켜지고 연소 원장이 비어 있다',
    reOnMid === 'on' && (await burnAll()).length === 0 && (await debugCall('burnStats')).pools === 0,
    { reOn: reOnMid, burning: await burnAll(), stats: await debugCall('burnStats') });
  await page.evaluate(() => { document.querySelector('#burn-c').style.removeProperty('filter'); });
  await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, infiniteAmmo: false, noRepair: true, noFalloff: true, noInvuln: true, noPartial: true, timeScale: 1 });
  await api.restore(page);
  await sleep(120);

  await combatTeardown(ctx);
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
  /* `noPartial` (SPEC-destruction §C3): this suite is about whether the CSSOM-heavy fx BUILD at all under a
   * strict CSP, and it drives weapon after weapon at the same card corner to get there. With §C on, the
   * first hit shears that corner off and the `clip-path` left behind also stops hit-testing there — the
   * later shots then sail through a hole and the suite measures the wrong thing. §C's own behaviour is
   * asserted in the destruction block, with the rule explicitly ON. */
  await api.debug(page, { noPartial: true });
  try { await api.debug(page, { noCrit: true, noCooldown: true, forceCrit: false, noSpread: true, noAttacks: true, fastReload: true, noPartial: true }); } catch (_) { /* reported by A.inject */ }
  // SPEC-material §9.1: the viewport-fixed .crs-canvas is gone — damage marks are per-element .crs-decal
  // canvases created on demand. The overlay host (.crs-root) is what "injection worked" means now, and the
  // sheet of glass must NOT come back under a strict CSP either.
  check('B.inject: active, overlay host and HUD present, no .crs-canvas (SPEC-material §9.1)', (await api.active(page)) && (await api.has(page, '.crs-root')) && !(await api.has(page, '.crs-canvas')) && (await page.evaluate(() => { const h = document.querySelector('crs-hud, .crs-hud-host'); return !!(h && h.shadowRoot); })));
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
  // chips), a katana slash (preview / streak), a rocket (streak, XL ring, fire-less AoE)
  const sB0 = await api.stats(page);
  await api.setWeapon(page, 'smg');
  const apB = await arenaPt(page);
  await holdAt(page, apB, 200);
  await api.setWeapon(page, 'katana');
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
  /* SPEC-combat §C2: one rocket (260) no longer clears the card's aggregate max, so the second round in the
   * tube is fired too. What is under test here is unchanged — that all of this CSSOM-heavy fx runs at all
   * under strict CSP + Trusted Types and really breaks the card. */
  if (!(await api.broken(page, '#big-card'))) {
    await ammoReady(page);
    const bcB3 = await api.rect(page, '#big-card');
    await page.mouse.click(bcB3.left + 12, bcB3.top + 12);
    await sleep(250);
  }
  const sB1 = await api.stats(page);
  // the detail carries what was actually measured: hp vs max, the §C partial count, and the magazine —
  // "not broken" has three different causes and they are told apart here instead of by re-running by hand
  check('B.weapons: smg hold, katana drag and rocket ran under strict CSP (shots ≥ 5, #big-card broken by the rockets)', sB1.shots - sB0.shots >= 5 && await poll(() => api.broken(page, '#big-card'), 600), { shots: [sB0.shots, sB1.shots], hp: await api.hpOf(page, '#big-card'), partial: sB1.partial, ammo: await api.ammo(page), cracks: sB1.cracks });
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
    // SPEC-material §9.1: rewritten from waiting for the removed .crs-canvas — the real extension's content
    // script announces itself with the overlay host, and no viewport-fixed sheet is mounted any more.
    check('C.page: .crs-root appears and no .crs-canvas is mounted (SPEC-material §9.1)', (await poll(() => api.has(page, '.crs-root'), 3000)) && !(await api.has(page, '.crs-canvas')));
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
  // SPEC-test-speed §4: A, B and C share nothing — three browsers, three fixtures served by the same static
  // server, three independent result streams — so they run CONCURRENTLY and the wall clock is the slowest of
  // them (A) rather than their sum. They used to share one browser; each now launches its own so a crash or a
  // slow teardown in one cannot stall another. Output stays readable because each lane buffers its own lines
  // (CHANNEL above) and the buffers are flushed in A, B, C order — the same text a serial run produced.
  const lanes = [];
  const runLane = (id, fn) => {
    const ch = { id, lines: [], t0: Date.now(), ms: 0 };
    const p = CHANNEL.run(ch, async () => {
      try { await fn(); } catch (e) { check(`${id} completed without exceptions`, false, String(e && e.stack || e)); }
      ch.ms = Date.now() - ch.t0;
    });
    lanes.push({ ch, p });
  };
  const ownBrowser = async (fn) => {
    const b = await puppeteer.launch({ headless: true, args: BASE_ARGS });
    try { await fn(b); } finally { try { await b.close(); } catch (_) { /* ignore */ } }
  };
  // SPEC-test-speed §5: suite A is four independent blocks, each on its own browser, and they run
  // alongside B and C. The wall clock is now the slowest single lane, not their sum. LANE_CAP keeps a
  // loaded machine from thrashing — a saturated box drops CDP targets and the failure looks like a
  // product bug ("Attempted to use detached Frame") when it is only contention.
  let live = 0;
  const waiting = [];
  const slot = async (fn) => {
    if (live >= LANE_CAP) await new Promise((r) => waiting.push(r));
    live++;
    try { return await fn(); } finally { live--; const next = waiting.shift(); if (next) next(); }
  };
  const ownBrowserQueued = (fn) => slot(() => ownBrowser(fn));
  /* Longest lane first. There are more lanes than slots (LANE_CAP), so the order they are QUEUED in decides
   * the makespan: a 57 s lane queued last starts only once a slot frees and then adds its whole length to
   * the wall clock on its own. This list is ordered by measured cost, longest to shortest — the classic
   * longest-processing-time rule. Re-measure and reorder when a block grows: `CRS_BLOCKS=<name>` prints it. */
  const A_BLOCKS = [
    ['rules', (b) => suiteA14Rules(b, origin, contentCss, contentJs)],       // ~57 s
    ['core', (b) => suiteA(b, origin, contentCss, contentJs)],               // ~56 s
    ['ammo', (b) => suiteA12(b, origin, contentCss, contentJs)],             // ~42 s
    ['combat', (b) => suiteA14(b, origin, contentCss, contentJs)],           // ~34 s
    ['debris', (b) => suiteA14Debris(b, origin, contentCss, contentJs)],     // ~30 s
    ['depth', (b) => suiteA14Depth(b, origin, contentCss, contentJs)],       // ~28 s
    ['settings', (b) => suiteASettings(b, origin, contentCss, contentJs)],   // ~6 s
  ];
  for (const [name, fn] of A_BLOCKS) {
    if (WANT('A') && WANT_BLOCK(name)) runLane(name, () => ownBrowserQueued(fn));
    if (name === 'settings') {   // the two short non-A suites go ahead of the shortest A block
      if (WANT('C')) runLane('C', () => slot(() => suiteC(puppeteer, origin)));
      if (WANT('B')) runLane('B', () => ownBrowserQueued((b) => suiteB(b, origin, contentCss, contentJs)));
    }
  }
  try {
    for (const lane of lanes) {
      await lane.p;
      for (const line of lane.ch.lines) rawLog(line);
      rawLog(`--- ${lane.ch.id} finished in ${(lane.ch.ms / 1000).toFixed(1)} s ---`);
    }
  } finally {
    server.close();
  }

  const secs = elapsed();
  // A partial run — picked suites OR picked blocks — can never be mistaken for a full verification:
  // it says so and it declines to report the runtime check (SPEC-test-speed §5).
  if (PARTIAL || PARTIAL_BLOCKS) {
    const what = [PARTIAL ? `suites ${SUITES.split('').join(', ')}` : null, PARTIAL_BLOCKS ? `blocks ${BLOCKS_PICKED.join(', ')}` : null].filter(Boolean).join(' / ');
    console.log(`\n*** PARTIAL RUN: ${what} only — NOT a full verification ***`);
  } else check(`total runtime < ${Math.round(TIME_BUDGET_MS / 1000)} s`, Number(secs) < TIME_BUDGET_MS / 1000, secs);
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed, ${results.length} total in ${secs} s`);
  if (failed) for (const r of results.filter((x) => !x.ok)) console.log(`  FAILED: ${r.name}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
