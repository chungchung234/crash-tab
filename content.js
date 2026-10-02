/* AUTO-GENERATED FILE — DO NOT EDIT — generated from src/ by tools/build.js.
 *
 * To change behaviour, edit the module files under src/ (their order is
 * declared in src/modules.json) and regenerate with:
 *
 *   node tools/build.js
 *
 * Hand edits to this file will be silently overwritten by the next build,
 * and `node tools/build.js --check` (run in CI) fails while they stand.
 */
(() => {
  'use strict';
  if (window.__crashScreen) { return window.__crashScreen.toggle(); }

// ── 00-prelude.js ──
  /* ===================================================================== */
  /* 0. Captured globals, constants, generic helpers                        */
  /*    v1.3: POWERS is gone (§1) and the readability numbers of §3 land here */
  /* ===================================================================== */
  const win = window;
  const doc = document;
  const docEl = doc.documentElement;
  const raf = win.requestAnimationFrame.bind(win);
  const caf = win.cancelAnimationFrame.bind(win);
  const setT = win.setTimeout.bind(win);
  const clearT = win.clearTimeout.bind(win);
  const gcsRaw = win.getComputedStyle.bind(win);
  const now = () => win.performance.now();

  const VERSION = '1.2.0';
  /* Weapon table (SPEC-v2 A2 numbers + v1.2 A1 ammo fields). `kind` is the v1 mode vocabulary every primitive
   * consumes (CRACK / flash / shake / sfx / velocityFor / pieceCount / breakElement opts.mode — A10).
   * `mag` = magazine size (null = ∞ / melee), `reloadMs` (null for melee); the slot KEY is no longer a table
   * field: it comes from the loadout order (v1.2 A6). `fire(x, y, ctx)` entries are attached in section 12.
   * WEAPON_IDS is the canonical SET (validation / persistence); `state.loadout` is the ORDER. */
  const WEAPON_IDS = ['hammer', 'pistol', 'smg', 'sniper', 'axe', 'sword', 'bomb', 'rocket', 'flame', 'collapse'];
  const WEAPONS = {
    hammer:   { id: 'hammer',   emoji: '🔨', name: 'weaponHammer',   kind: 'hammer',   damage: 65,  cooldownMs: 0,    radius: 0,   hold: false, input: 'click', mag: null, reloadMs: null },
    pistol:   { id: 'pistol',   emoji: '🔫', name: 'weaponPistol',   kind: 'gun',      damage: 25,  cooldownMs: 0,    radius: 0,   hold: false, input: 'click', mag: 12, reloadMs: 900 },
    smg:      { id: 'smg',      emoji: '💥', name: 'weaponSmg',      kind: 'gun',      damage: 22,  cooldownMs: 0,    radius: 0,   hold: true,  input: 'hold', tickMs: 70, mag: 30, reloadMs: 1400 },
    sniper:   { id: 'sniper',   emoji: '🎯', name: 'weaponSniper',   kind: 'gun',      damage: 200, cooldownMs: 600,  radius: 0,   hold: false, input: 'click', mag: 5, reloadMs: 2000, spread: 25, scope: true },
    axe:      { id: 'axe',      emoji: '🪓', name: 'weaponAxe',      kind: 'hammer',   damage: 130, cooldownMs: 550,  radius: 0,   hold: false, input: 'click', mag: null, reloadMs: null },
    sword:    { id: 'sword',    emoji: '🗡️', name: 'weaponSword',    kind: 'hammer',   damage: 60,  cooldownMs: 0,    radius: 0,   hold: false, input: 'drag', stabCooldownMs: 120, mag: null, reloadMs: null },
    bomb:     { id: 'bomb',     emoji: '💣', name: 'weaponBomb',     kind: 'bomb',     damage: 190, cooldownMs: 700,  radius: 240, hold: false, input: 'click', rings: [60, 130, 210], maxTargets: 10, mag: 3, reloadMs: 1800 },
    rocket:   { id: 'rocket',   emoji: '🚀', name: 'weaponRocket',   kind: 'bomb',     damage: 260, cooldownMs: 1200, radius: 360, hold: false, input: 'click', rings: [70, 150, 230, 320], maxTargets: 14, mag: 2, reloadMs: 1500 },
    flame:    { id: 'flame',    emoji: '🔥', name: 'weaponFlame',    kind: 'gun',      damage: 15,  cooldownMs: 0,    radius: 0,   hold: true,  input: 'hold', tickMs: 50, mag: 100, reloadMs: 2500 },
    collapse: { id: 'collapse', emoji: '🌪️', name: 'weaponCollapse', kind: 'collapse', damage: Infinity, cooldownMs: 2000, radius: Infinity, hold: false, input: 'click', mag: 1, reloadMs: 5000 }
  };
  /* Loadout presets (v1.2 §4): permutations of WEAPON_IDS mapped onto keys 1 2 3 4 5 6 7 8 9 0. */
  const PRESETS = {
    default:   ['hammer', 'pistol', 'smg', 'sniper', 'axe', 'sword', 'bomb', 'rocket', 'flame', 'collapse'],
    assault:   ['smg', 'pistol', 'sniper', 'bomb', 'rocket', 'flame', 'hammer', 'axe', 'sword', 'collapse'],
    sniper:    ['sniper', 'pistol', 'hammer', 'sword', 'axe', 'smg', 'bomb', 'rocket', 'flame', 'collapse'],
    explosive: ['rocket', 'bomb', 'flame', 'collapse', 'smg', 'pistol', 'sniper', 'hammer', 'axe', 'sword'],
    melee:     ['hammer', 'axe', 'sword', 'pistol', 'smg', 'sniper', 'bomb', 'rocket', 'flame', 'collapse']
  };
  const PRESET_KEYS = { default: 'presetDefault', assault: 'presetAssault', sniper: 'presetSniper', explosive: 'presetExplosive', melee: 'presetMelee' };
  const HOLD_WINDOW = 150;           // ms: hold-weapon damage aggregation / fx throttle window (A4, A5)
  const BURNT_FILTER = 'brightness(.55) sepia(.6)';   // flame-broken pieces (A9)
  const SWAP_MS = 250;               // weapon swap delay (v1.2 A5)
  const GRACE_MS = 5000;             // combat activation grace (v1.2 A7)
  const TIER_BASE = { shooter: 1800, charger: 3000, laser: 4500 };   // attack intervals (v1.2 §5)
  /* v1.3 readability (§3): player marker / orb / near-miss / hitstop numbers. ORB_HIT_R is the ONE radius the
   * orb sweep test and the near-miss band both read — the damage rule itself is unchanged (v1.3 §4). */
  const SELF_R = 22;                 // player ring radius (44 px diameter)
  const SELF_HIT_R = 32;             // ring radius at the peak of the on-hit punch (64 px diameter)
  const ORB_R = 11;                  // orb radius (22 px diameter)
  const ORB_HIT_R = 22;              // orb → player hit radius
  const NEAR_MISS_BAND = 45;         // px beyond ORB_HIT_R that still counts as a graze (§3.4)
  const HITSTOP_MS = 70;             // physics dt is clamped to 0 for this long after a hit (§3.5)
  const ORB_TRAIL = 6;               // afterimage samples behind each orb
  const AIMLINE_MIN_MS = 220;        // an aim line stays visible at least this long (forced / zero wind-up)
  /* api.debug (A12): one plain object, survives toggles. v1.2 adds noSpread / noAttacks / fastReload /
   * infiniteAmmo and the hooks setPlayerHp / setPlayerPos / forceAttack (attached in section 12b). */
  const debug = { noCrit: false, forceCrit: false, noCooldown: false, noSpread: false, noAttacks: false, fastReload: false, infiniteAmmo: false, hitstop: true };
  const CAP = 160;                 // live debris pieces (A1)
  const MIN_EVICT_AGE = 800;       // ms (A1)
  const GPU_BUDGET = 64e6;         // sum of w*h*dpr^2 over live pieces (A1)
  const BOMB_RADIUS = 240;         // px (A14)
  const GRAVITY = 2400;            // px/s^2
  const DEG = Math.PI / 180;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const MEDIA_TAGS = new Set(['img', 'picture', 'svg', 'video', 'canvas']);
  const FORM_TAGS = new Set(['button', 'input', 'select', 'textarea']);
  const REPLACED_TAGS = new Set(['img', 'svg', 'video', 'canvas', 'iframe', 'input', 'button', 'select', 'textarea', 'picture', 'object', 'embed']);
  const TEXTISH_TAGS = new Set(['p', 'span', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'label', 'small', 'em', 'strong', 'b', 'i', 'code', 'blockquote', 'dt', 'dd', 'figcaption', 'pre']);
  const DROP_TAGS = new Set(['script', 'style', 'link', 'template', 'noscript', 'meta', 'title', 'head']);
  const SKIP_WALK_TAGS = new Set(['script', 'style', 'link', 'meta', 'template', 'noscript']);
  const STRIP_ATTRS = new Set(['id', 'name', 'is', 'for', 'form', 'autofocus', 'tabindex', 'contenteditable', 'draggable', 'aria-live', 'srcdoc', 'style', 'loading', 'slot', 'popover', 'inert', 'open', 'autoplay', 'loop', 'data-crs-broken']);
  const ROOT_INLINE_SKIP = new Set(['transform', 'transition', 'animation', 'position', 'inset', 'top', 'left', 'right', 'bottom', 'margin', 'margin-top', 'margin-left', 'margin-right', 'margin-bottom', 'translate', 'rotate', 'scale']);

  // Computed-style properties copied to clones (A10). ★ = reduced set used below depth 2.
  const STYLE_STAR = ['display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-color', 'background-image', 'visibility'];
  const STYLE_FULL = STYLE_STAR.concat(['min-width', 'max-width', 'min-height', 'max-height', 'box-sizing', 'z-index', 'transform', 'transform-origin',
    'overflow-x', 'overflow-y', 'text-overflow', 'float', 'clear', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
    'justify-content', 'align-items', 'align-self', 'gap', 'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows',
    'grid-column', 'grid-row', 'place-items', 'columns', 'aspect-ratio', 'border-collapse', 'border-spacing', 'table-layout',
    'font-style', 'font-variant', 'font-kerning', 'font-feature-settings', 'letter-spacing', 'word-spacing', 'text-align',
    'text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'text-transform', 'text-shadow', 'white-space',
    'word-break', 'direction', 'vertical-align', 'list-style-type', 'list-style-position', '-webkit-text-fill-color',
    '-webkit-text-stroke', 'background-size', 'background-position', 'background-repeat',
    'border-top-width', 'border-top-style', 'border-top-color', 'border-right-width', 'border-right-style', 'border-right-color',
    'border-bottom-width', 'border-bottom-style', 'border-bottom-color', 'border-left-width', 'border-left-style', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'box-shadow', 'opacity', 'object-fit', 'fill', 'stroke', 'stroke-width']);
  const STYLE_SVG_EXTRA = ['fill', 'stroke', 'stroke-width', 'opacity'];

// ── 10-util.js ──
  /* Small helpers + the Korean fallback strings. v1.3 §1 drops labelPower / btnPowerDown / btnPowerUp;
   * §3.4 adds dodgeLabel (the 회피! call-out beside the player ring). */
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const px = (v) => (Math.round(v * 100) / 100) + 'px';

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
  function alphaOf(color) {
    if (!color) return 1;
    if (color === 'transparent') return 0;
    const m = /rgba?\(([^)]+)\)/.exec(color);
    if (!m) return 1;
    const parts = m[1].split(/[\s,\/]+/).filter(Boolean);
    return parts.length >= 4 ? parseFloat(parts[3]) : 1;
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

  /* i18n with hard-coded Korean fallbacks */
  const KO = {
    hudTitle: '화면부수기',
    weaponHammer: '망치', weaponPistol: '권총', weaponSmg: '기관총', weaponSniper: '저격총', weaponAxe: '도끼', weaponSword: '검', weaponBomb: '폭탄',
    weaponRocket: '로켓', weaponFlame: '화염방사기', weaponFlameShort: '화염', weaponCollapse: '붕괴',
    hudDamage: '피해', critLabel: '치명타!', headshotLabel: '헤드샷!', unitPerShot: '/발', unitPerTick: '/틱',
    btnSound: '소리', btnMute: '음소거', btnRestore: '복구', btnExit: '종료',
    hudHint: '클릭해서 화면을 부수세요', hudHintHold: '꾹 눌러서 발사', hudHintDrag: '드래그해서 베기',
    hudHintCollapse: '복구(Z)로 되돌릴 수 있어요', hudHintScope: '클릭해서 발사 · 오른쪽 버튼이나 Shift로 조준해요',
    hudPieces: '조각', hudCracks: '균열',
    // v1.2
    labelLoadout: '로드아웃', presetDefault: '기본', presetAssault: '돌격', presetSniper: '저격', presetExplosive: '폭발', presetMelee: '근접', presetCustom: '사용자 지정',
    labelCombat: '전투', labelHealth: '체력', labelScore: '점수', labelKills: '처치', labelTime: '생존', labelEnemies: '적',
    koTitle: '당신은 부서졌습니다', koRestart: '다시 시작', koExit: '종료', killLabel: '처치!',
    toastCombatOn: '⚔️ 전투 모드: 큰 요소들이 반격해요 (H로 끄기)', toastCombatOff: '전투 모드 꺼짐', toastReload: '재장전', labelSwapping: '교체 중',
    // v1.3 (§2 / §3.4): the dodge call-out next to the player ring
    dodgeLabel: '회피!',
    unitSec: '초',
    // ── v1.4: the three modes, the lock-on, the repair meter, the depth tags and the control card ──
    modeRampage: '램페이지', modeQuickdraw: '퀵드로우', modeSurvival: '서바이벌',
    modeRampageDesc: '적 없이 부수기', modeQuickdrawDesc: '먼저 쏘아 끊기', modeSurvivalDesc: '피하며 버티기',
    lockBlocked: '차단!', labelRatio: '파괴율', labelDominating: '제압!',
    hintCovered: '가려짐', hintPierce: '관통 가능', hintEnemyBehind: '뒤에 적',
    helpMove: '이동', helpDash: '대시', helpAim: '마우스로 조준',
    setDebrisLife: '파편이 사라지는 시간'
  };
  function msg(key) {
    const s = safe(() => chrome.i18n.getMessage(key));
    return (typeof s === 'string' && s) ? s : (KO[key] || key);
  }

// ── 20-state.js ──
  /* ===================================================================== */
  /* 1. State                                                               */
  /*    v1.3: state.power / powerTouched removed (§1); the player marker,     */
  /*    aim lines, near misses, hitstop and the low-HP vignette added (§3).   */
  /* ===================================================================== */
  const state = {
    active: false, weapon: 'hammer', muted: false, weaponTouched: false,
    cracks: 0, crackInk: 0, broken: [], pieces: [], hp: new WeakMap(),
    anims: new Set(), timers: new Set(), listeners: [],
    rafId: 0, moveRaf: 0, resizeRaf: 0, hudRaf: 0, animating: false, lastT: 0, tickErrors: 0,
    combo: 0, lastHitAt: 0, comboTimer: 0, lastBreakMs: 0, lastBreakPieces: 0,
    collapse: null, gpuSum: 0, fxQueue: [], hintCollapse: false,
    hoverX: -1, hoverY: -1, hoverEl: null, overHud: false, shake: null,
    audio: null, swingTimer: 0, lastError: null, lastHitTimer: 0,
    // v1.1: cooldown, counters, hold / slash sessions, feedback nodes
    cooldownUntil: 0, shots: 0, damageDealt: 0, crits: 0, scorch: 0,
    hold: null, slash: null, dmgNodes: [], fire: [], tints: new WeakMap(), dmgAgg: new WeakMap(),
    // v1.2: ammo / reload / swap delay (A5)
    ammo: {}, reload: null, pendingReload: null, swapUntil: 0, swapTimer: 0, lastEmptyAt: 0, lastShot: null,
    // v1.2: loadout order + preset (A6)
    loadout: PRESETS.default.slice(), preset: 'default', loadoutTouched: false,
    // v1.2: scope (A2–A4)
    scoped: false, scope: { node: null, reticle: null, lines: [], cx: 0, cy: 0, startedAt: 0, recoilAt: 0, magnified: false, saved: null, rmb: false, shiftDown: false, shiftWant: false, shiftTimer: 0, hot: false },
    // v1.2: combat (A7–A10) — v1.4 §0.5: the `combat` BOOLEAN is now derived from `mode` (see below)
    combatTouched: false, combatTimer: 0, clockTimer: 0, regenTimer: 0, toastTimer: 0, auraRaf: 0,
    hostiles: new Map(), orbs: [], beams: [], warns: [], paused: false, ko: false, graceUntil: 0,
    // v1.3: player marker / aim lines / near-miss / hitstop (§3)
    self: null, aimlines: [], nearMisses: 0, nearShown: [], hitstopUntil: 0, lowVig: null, hpRatio: 1,
    player: { x: 0, y: 0, hp: 100, max: 100, score: 0, kills: 0, alive: true, startedAt: 0, pausedAt: 0, pausedTotal: 0, lastDamageAt: 0, lastRegenAt: 0, inWindow: true, lastHitFrom: null },
    // ── v1.4 §0.5: three modes (rampage · quickdraw · survival) replace the combat boolean ──
    mode: 'rampage', lastCombatMode: 'survival',
    // §1 drone avatar (survival only): keys held, physics, dash window, afterimages
    avatar: null, keys: { up: false, down: false, left: false, right: false },
    dashUntil: 0, dashReadyAt: 0, invulUntil: 0, help: null, seenHelp: false,
    // §2 Virtua-Cop lock-ons, §3 repair beams + destruction-ratio meter
    locks: [], lockSeq: 0, locksBroken: 0,
    repairs: [], repaired: 0, ratio: 0, ratioTimer: 0, ratioNodes: null,
    // §9 debris lifetime (0 = keep until the cap evicts, as before)
    debrisLifeMs: 6000, debrisTimer: 0,
    // §10 depth tiers, §4 boss stages, §3.2 ratio freshness
    depthTimer: 0, bossMode: false, ratioDirty: true, ratioAt: 0, ratioBrokenN: -1
  };
  /* §0.5: every v1.2/v1.3 call site reads `state.combat` as "are enemies live?". It stays exactly that, derived
   * from the mode, so none of that code had to change. The setter keeps the legacy boolean writable: true picks
   * the last combat mode the player actually used (survival unless they chose quickdraw), false is rampage. */
  Object.defineProperty(state, 'combat', {
    configurable: true,
    enumerable: false,
    get() { return state.mode !== 'rampage'; },
    set(v) { state.mode = v ? (state.lastCombatMode || 'survival') : 'rampage'; }
  });
  const handledEvents = new WeakSet();
  const handledKeys = new WeakSet();

  // DOM we own
  let shield = null, root = null, canvas = null, ctx = null, targetBox = null, targetLabel = null, targetBar = null, targetFill = null, hud = null, hudShadow = null;
  const hudEls = {};
  let canvasCssW = 0, canvasCssH = 0, canvasSX = 1, canvasSY = 1;

  function track(timerId) { state.timers.add(timerId); return timerId; }
  function later(fn, ms) {
    const id = setT(() => { state.timers.delete(id); try { fn(); } catch (e) { state.lastError = String((e && e.stack) || e); } }, ms);   // deferred paths surface in stats().lastError too
    return track(id);
  }
  /* Cancel a timer created by later() and forget its id (plain clearT() would leave the id in the Set). */
  function untrack(id) {
    if (!id) return;
    try { clearT(id); } catch (e) { /* ignore */ }
    state.timers.delete(id);
  }
  function trackAnim(a) {
    if (!a) return a;
    state.anims.add(a);
    const drop = () => state.anims.delete(a);
    try { a.addEventListener('finish', drop); a.addEventListener('cancel', drop); } catch (e) { /* ignore */ }
    return a;
  }
  function cancelAnimsOf(el) {
    for (const a of Array.from(state.anims)) {
      try { if (a.effect && a.effect.target === el) { a.cancel(); state.anims.delete(a); } } catch (e) { /* ignore */ }
    }
  }
  function sendState(active) { safe(() => chrome.runtime.sendMessage({ type: 'crash:state', active: !!active })); }

// ── 25-layers.js ──
  /* ===================================================================== */
  /* 2. Mount points, top layer, zoom                                       */
  /* ===================================================================== */
  function raise(host) {
    try { host.popover = 'manual'; host.showPopover(); } catch (e) {
      try { host.removeAttribute('popover'); } catch (e2) { /* ignore */ }
    }
  }
  function lower(host) {
    try { if (host.matches(':popover-open')) host.hidePopover(); } catch (e) { /* ignore */ }
  }
  function reraiseAll() {
    for (const h of [shield, root, hud]) {
      if (!h) continue;
      try { if (h.matches(':popover-open')) { h.hidePopover(); h.showPopover(); } } catch (e) { /* ignore */ }
    }
  }
  function ensureMounted() {
    for (const h of [shield, root, hud]) {
      if (h && !h.isConnected) { try { docEl.append(h); raise(h); } catch (e) { /* ignore */ } }
    }
  }
  function applyZoom() {
    let z = 1;
    try { z = parseFloat(gcsRaw(docEl).zoom) || 1; } catch (e) { z = 1; }
    for (const h of [shield, root, hud]) {
      if (!h) continue;
      if (Math.abs(z - 1) > 0.001) imp(h, 'zoom', String(1 / z)); else { try { h.style.removeProperty('zoom'); } catch (e) { /* ignore */ } }
    }
  }
  function mountHosts() {
    shield = mk('div', 'crs-shield');
    shield.setAttribute('aria-hidden', 'true');
    root = mk('div', 'crs-root');
    root.setAttribute('aria-hidden', 'true');
    targetBox = mk('div', 'crs-target');
    targetLabel = mk('span', 'crs-target-label');
    targetBar = mk('div', 'crs-target-bar');       // health bar under the label (A11)
    targetFill = mk('div', 'crs-target-fill');
    targetBar.append(targetFill);
    targetBox.append(targetLabel, targetBar);
    targetBox.style.display = 'none';
    canvas = mk('canvas', 'crs-canvas');
    root.append(targetBox, canvas);
    hud = buildHud();
    docEl.append(shield, root, hud);
    raise(shield); raise(root); raise(hud);
    applyZoom();
    hudFallbackCheck();
  }

// ── 30-canvas.js ──
  /* ===================================================================== */
  /* 3. Crack canvas (persistent, DPR aware, resize-preserving)             */
  /* ===================================================================== */
  function setupCanvas(preserve) {
    const dpr = Math.min(win.devicePixelRatio || 1, 2);
    const cssW = viewW(), cssH = viewH();
    const bw = Math.max(1, Math.min(4096, Math.round(cssW * dpr)));
    const bh = Math.max(1, Math.min(4096, Math.round(cssH * dpr)));
    let tmp = null;
    if (preserve && ctx && canvas.width > 0 && canvas.height > 0) {
      try {
        tmp = doc.createElement('canvas');
        tmp.width = canvas.width; tmp.height = canvas.height;
        tmp.getContext('2d').drawImage(canvas, 0, 0);
      } catch (e) { tmp = null; }
    }
    const oldW = canvas.width, oldH = canvas.height;
    const oldCssW = canvasCssW || cssW, oldCssH = canvasCssH || cssH;   // CSS size the old bitmap covered
    canvas.width = bw; canvas.height = bh;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx = canvas.getContext('2d');
    canvasCssW = cssW; canvasCssH = cssH;
    canvasSX = bw / cssW; canvasSY = bh / cssH;
    if (tmp && ctx) {
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // destination in NEW device px: the old CSS area at the new ratio (a DPR change would otherwise rescale the cracks)
        ctx.drawImage(tmp, 0, 0, oldW, oldH, 0, 0, Math.max(1, Math.round(oldCssW * canvasSX)), Math.max(1, Math.round(oldCssH * canvasSY)));
      } catch (e) { /* ignore */ }
    }
    if (ctx) ctx.setTransform(canvasSX, 0, 0, canvasSY, 0, 0);
  }
  function clearCanvas() {
    if (!ctx) return;
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(canvasSX, 0, 0, canvasSY, 0, 0);
    } catch (e) { /* ignore */ }
    state.fxQueue.length = 0;
  }

  const CRACK = {
    hammer: { rays: [9, 14], len: [90, 190], rings: [0.3, 0.62], w0: 2.0, w1: 0.6, alpha: 0.55 },
    bomb: { rays: [14, 22], len: [220, 420], rings: [0.28, 0.55, 0.8], w0: 2.6, w1: 0.7, alpha: 0.55 },
    gun: { rays: [5, 8], len: [22, 60], rings: [0.18, 0.35, 0.6], w0: 1.3, w1: 0.4, alpha: 0.4 },
    smg: { rays: [3, 5], len: [8, 20], rings: [0.3, 0.6], w0: 1.0, w1: 0.35, alpha: 0.4 }   // per smg shot (A6)
  };
  function makeRay(base, len) {
    const pts = [[0, 0]], cum = [0];
    let x = 0, y = 0, dev = 0, traveled = 0, heading = base;
    while (traveled < len) {
      const step = Math.min(rand(8, 18), len - traveled + 0.01);
      dev += rand(-14, 14) * DEG; dev *= 0.7;
      heading = base + clamp(dev, -32 * DEG, 32 * DEG);
      x += Math.cos(heading) * step; y += Math.sin(heading) * step; traveled += step;
      pts.push([x, y]); cum.push(traveled);
    }
    return { pts, cum, len: traveled, base, heading };
  }
  function pointAt(ray, f) {
    const d = clamp(f, 0, 1) * ray.len;
    for (let i = 1; i < ray.pts.length; i++) {
      if (ray.cum[i] >= d) {
        const t = (d - ray.cum[i - 1]) / Math.max(1e-6, ray.cum[i] - ray.cum[i - 1]);
        const a = ray.pts[i - 1], b = ray.pts[i];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])];
      }
    }
    const l = ray.pts[ray.pts.length - 1];
    return [l[0], l[1], ray.heading];
  }
  /* opts (v1.1 A10): { rays: [min, max], lenScale, ink }. `cracks` counts every drawn crack (A3);
   * `crackInk` (hammer/axe/bomb/rocket 1, pistol/smg .25, sword .5) drives the light-pass fade instead of `cracks`. */
  function drawCrack(x, y, kind, opts) {
    opts = opts || {};
    state.cracks++;
    state.crackInk += (opts.ink != null ? opts.ink : 1);
    if (!ctx) return;
    const P = CRACK[kind] || CRACK.hammer;
    const raysR = opts.rays || P.rays, lenScale = opts.lenScale || 1, lenR = opts.len || P.len;   // len: sniper 30–70 (v1.2 §2)
    const gunlike = kind === 'gun' || kind === 'smg';
    const nRays = randInt(raysR[0], raysR[1]);
    const rays = [], branches = [];
    let maxLen = 0;
    for (let i = 0; i < nRays; i++) {
      const base = (i / nRays) * Math.PI * 2 + rand(-1, 1) * (Math.PI / nRays) * 0.6;
      const r = makeRay(base, rand(lenR[0], lenR[1]) * lenScale);
      rays.push(r); maxLen = Math.max(maxLen, r.len);
      const nb = randInt(0, 2);
      for (let b = 0; b < nb; b++) {
        const start = pointAt(r, rand(0.35, 0.75));
        const ang = start[2] + (Math.random() < 0.5 ? -1 : 1) * rand(30, 60) * DEG;
        const br = makeRay(ang, r.len * rand(0.25, 0.55));
        br.ox = start[0]; br.oy = start[1];
        branches.push(br);
      }
    }
    // bounding box (CSS px, relative to the impact point)
    let minX = 0, minY = 0, maxX = 0, maxY = 0;
    const grow = (pxv, pyv) => { if (pxv < minX) minX = pxv; if (pxv > maxX) maxX = pxv; if (pyv < minY) minY = pyv; if (pyv > maxY) maxY = pyv; };
    for (const r of rays) for (const p of r.pts) grow(p[0], p[1]);
    for (const b of branches) for (const p of b.pts) grow(b.ox + p[0], b.oy + p[1]);
    const margin = (kind === 'bomb' ? 96 : 20);
    minX -= margin; minY -= margin; maxX += margin; maxY += margin;
    const bw = Math.ceil(maxX - minX), bh = Math.ceil(maxY - minY);
    let off, octx;
    try {
      off = doc.createElement('canvas');
      off.width = Math.max(1, Math.round(bw * canvasSX)); off.height = Math.max(1, Math.round(bh * canvasSY));
      octx = off.getContext('2d');
      octx.setTransform(canvasSX, 0, 0, canvasSY, -minX * canvasSX, -minY * canvasSY);
    } catch (e) { return; }
    octx.lineCap = 'round'; octx.lineJoin = 'round';
    // bomb scorch under the cracks
    if (kind === 'bomb') {
      const g = octx.createRadialGradient(0, 0, 0, 0, 0, 90);
      g.addColorStop(0, 'rgba(20,15,10,0.45)'); g.addColorStop(1, 'rgba(20,15,10,0)');
      octx.fillStyle = g; octx.beginPath(); octx.arc(0, 0, 90, 0, Math.PI * 2); octx.fill();
    }
    // sheen wedges between random adjacent ray pairs, out to ring 2
    const ringF2 = P.rings[Math.min(1, P.rings.length - 1)];
    const nW = randInt(2, 3);
    octx.fillStyle = 'rgba(255,255,255,0.07)';
    for (let k = 0; k < nW; k++) {
      const i = randInt(0, nRays - 1), r1 = rays[i], r2 = rays[(i + 1) % nRays];
      octx.beginPath(); octx.moveTo(0, 0);
      for (let f = 0.1; f <= ringF2 + 1e-6; f += 0.1) { const p = pointAt(r1, f); octx.lineTo(p[0], p[1]); }
      for (let f = ringF2; f >= 0.1 - 1e-6; f -= 0.1) { const p = pointAt(r2, f); octx.lineTo(p[0], p[1]); }
      octx.closePath(); octx.fill();
    }
    // accumulate strokes into width buckets (taper w0 → w1)
    const wMid = (P.w0 + P.w1) / 2;
    // branches/rings keep a >= 0.8-0.9 px dark stroke: sub-pixel widths rasterise as faint dashes at 1x DPR
    const buckets = [[new Path2D(), P.w0], [new Path2D(), wMid], [new Path2D(), P.w1], [new Path2D(), Math.max(0.9, P.w1 * 0.9)], [new Path2D(), Math.max(0.8, P.w1 * 0.7)]];
    const addPoly = (path, pts, ox, oy) => { path.moveTo(ox + pts[0][0], oy + pts[0][1]); for (let i = 1; i < pts.length; i++) path.lineTo(ox + pts[i][0], oy + pts[i][1]); };
    for (const r of rays) {
      const n = r.pts.length;
      const segs = [[], [], []];
      for (let i = 0; i < n; i++) {
        const f = r.cum[i] / Math.max(1, r.len);
        const b = f < 1 / 3 ? 0 : (f < 2 / 3 ? 1 : 2);
        segs[b].push(r.pts[i]);
        if (b > 0 && segs[b].length === 1 && i > 0) segs[b].unshift(r.pts[i - 1]);
      }
      for (let b = 0; b < 3; b++) if (segs[b].length > 1) addPoly(buckets[b][0], segs[b], 0, 0);
    }
    for (const b of branches) addPoly(buckets[3][0], b.pts, b.ox, b.oy);
    for (const f0 of P.rings) {
      const ringPts = rays.map((r) => pointAt(r, f0 * rand(0.88, 1.12)));
      ringPts.push(ringPts[0]);
      addPoly(buckets[4][0], ringPts, 0, 0);
    }
    const alpha = P.alpha * Math.max(0.35, 1 - state.crackInk / 60);
    octx.shadowColor = 'rgba(0,0,0,0.35)'; octx.shadowBlur = 2;
    octx.strokeStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
    for (const [path, w] of buckets) { octx.lineWidth = w * 2.4; octx.stroke(path); }
    octx.shadowBlur = 0; octx.shadowColor = 'rgba(0,0,0,0)';
    octx.strokeStyle = 'rgba(15,25,35,0.75)';
    for (const [path, w] of buckets) { octx.lineWidth = w; octx.stroke(path); }
    // glass dust
    const nd = randInt(10, 25);
    octx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < nd; i++) {
      const a = rand(0, Math.PI * 2), d = rand(4, maxLen * 0.5), s = rand(1, 2);
      octx.fillRect(Math.cos(a) * d, Math.sin(a) * d, s, s);
    }
    // centre
    if (gunlike) {
      const g = octx.createRadialGradient(0, 0, 0, 0, 0, 7);
      g.addColorStop(0, '#111'); g.addColorStop(0.7, 'rgba(17,17,17,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      octx.fillStyle = g; octx.beginPath(); octx.arc(0, 0, 7, 0, Math.PI * 2); octx.fill();
      octx.strokeStyle = 'rgba(255,255,255,0.8)'; octx.lineWidth = 0.8; octx.beginPath(); octx.arc(0, 0, 8, 0, Math.PI * 2); octx.stroke();
    } else {
      const r0 = kind === 'bomb' ? 26 : 14;
      const g = octx.createRadialGradient(0, 0, 0, 0, 0, r0);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      octx.fillStyle = g; octx.beginPath(); octx.arc(0, 0, r0, 0, Math.PI * 2); octx.fill();
    }
    // grow over three frames through annulus clips (A18)
    state.fxQueue.push({ off, x, y, bx: x + minX, by: y + minY, bw, bh, radii: [maxLen * 0.4, maxLen * 0.75, Infinity], stage: 0 });
    kick();
  }
  function runFx() {
    if (!ctx) { state.fxQueue.length = 0; return; }
    for (let i = state.fxQueue.length - 1; i >= 0; i--) {
      const f = state.fxQueue[i];
      const rIn = f.stage === 0 ? 0 : f.radii[f.stage - 1];
      const rOut = f.radii[f.stage];
      try {
        ctx.save();
        ctx.beginPath();
        if (rOut === Infinity) ctx.rect(f.bx - 1, f.by - 1, f.bw + 2, f.bh + 2); else ctx.arc(f.x, f.y, rOut, 0, Math.PI * 2);
        if (rIn > 0) ctx.arc(f.x, f.y, rIn, 0, Math.PI * 2, true);
        ctx.clip('evenodd');
        ctx.drawImage(f.off, f.bx, f.by, f.bw, f.bh);
        ctx.restore();
      } catch (e) { /* ignore */ }
      f.stage++;
      if (f.stage >= f.radii.length) state.fxQueue.splice(i, 1);
    }
  }
  /* Sword slash (A8): drawn straight on the persistent ctx — light underlay, dark line, perpendicular ticks. */
  function drawSlash(x1, y1, x2, y2) {
    state.cracks++; state.crackInk += 0.5;
    if (!ctx) return;
    try {
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
      const ticks = [];
      const nt = randInt(6, 14);
      for (let i = 0; i < nt; i++) {
        const f = rand(0.04, 0.96), L = rand(4, 10), s = Math.random() < 0.5 ? -1 : 1;
        const bx = x1 + dx * f, by = y1 + dy * f;
        ticks.push([bx, by, bx + nx * L * s, by + ny * L * s]);
      }
      ctx.save();
      ctx.lineCap = 'round';
      const pass = (color, w) => {
        ctx.strokeStyle = color; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        for (const t of ticks) { ctx.moveTo(t[0], t[1]); ctx.lineTo(t[2], t[3]); }
        ctx.stroke();
      };
      pass('rgba(255,255,255,0.7)', 2.4);
      pass('rgba(15,25,35,0.75)', 1.0);
      ctx.restore();
    } catch (e) { /* ignore */ }
  }
  /* Scorch dab on the persistent canvas (flame every 4th tick r 24 / rocket impact r 140, A7 / A9). */
  function scorchDab(x, y, r, a) {
    if (!ctx) return;
    try {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(30,20,10,' + a + ')'); g.addColorStop(1, 'rgba(30,20,10,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    } catch (e) { /* ignore */ }
  }

// ── 35-effects.js ──
  /* ===================================================================== */
  /* 4. Effects: flash, ring, shake, swing cursor                            */
  /* ===================================================================== */
  function flash(x, y, mode, opts) {
    const size = (opts && opts.size) || (mode === 'bomb' || mode === 'collapse' ? 420 : (mode === 'gun' ? 48 : 140));
    const dur = (opts && opts.dur) || (mode === 'bomb' || mode === 'collapse' ? 380 : (mode === 'gun' ? 140 : 260));
    const n = mk('div', 'crs-fx-flash');
    n.style.left = px(x); n.style.top = px(y); n.style.width = px(size); n.style.height = px(size);
    n.style.animationDuration = dur + 'ms';
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
    n.addEventListener('animationend', kill);
    later(kill, 1000);
    root.append(n);
  }
  function ring(x, y, opts) {
    const n = mk('div', 'crs-fx-ring');
    if (opts && opts.xl) n.classList.add('crs-fx-ring-xl');   // rocket: 2× ring (A7)
    n.style.left = px(x); n.style.top = px(y);
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
    n.addEventListener('animationend', kill);
    later(kill, 1200);
    root.append(n);
  }
  function shake(mode, opts) {
    let a = (opts && opts.amp != null) ? opts.amp : (mode === 'bomb' || mode === 'collapse' ? 12 : (mode === 'gun' ? 2 : 6));
    try { if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) a = 0; } catch (e) { /* ignore */ }
    if (!a || !root) return;
    try { if (state.shake) state.shake.cancel(); } catch (e) { /* ignore */ }
    const ang = rand(0, Math.PI * 2), ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux;
    const offs = [1, -0.7, 0.45, -0.25, 0.1, 0], times = [0, 0.15, 0.35, 0.55, 0.8, 1];
    const kf = offs.map((k, i) => ({
      transform: 'translate(' + px(ux * a * k + vx * 0.4 * a * k) + ',' + px(uy * a * k + vy * 0.4 * a * k) + ')',
      offset: times[i]
    }));
    try {
      state.shake = root.animate(kf, { duration: (opts && opts.dur) || (mode === 'bomb' || mode === 'collapse' ? 420 : 240), easing: 'linear' });
      trackAnim(state.shake);
    } catch (e) { state.shake = null; }
  }
  function swingCursor() {
    try { docEl.classList.add('crs-swing'); } catch (e) { /* ignore */ }
    untrack(state.swingTimer);
    state.swingTimer = later(() => { state.swingTimer = 0; try { docEl.classList.remove('crs-swing'); } catch (e) { /* ignore */ } }, 120);
  }

// ── 40-audio.js ──
  /* ===================================================================== */
  /* 5. Sound (Web Audio, synthesized)                                      */
  /*    v1.3 adds alert / whiff / hurtbig — the three cues of §3.2, §3.4, §3.5 */
  /* ===================================================================== */
  const audio = { ctx: null, master: null, noise: null, boomAt: [], loop: null };   // boomAt: start times of recent boom voices (A24 cap 2); loop: flame noise (v1.1)
  function ensureAudio() {
    if (audio.ctx) { try { if (audio.ctx.state === 'suspended') safe(() => audio.ctx.resume()); } catch (e) { /* ignore */ } return; }
    try {
      const AC = win.AudioContext || win.webkitAudioContext;
      if (!AC) return;
      const c = new AC();
      const master = c.createGain(); master.gain.value = 0.28;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 6;
      master.connect(comp); comp.connect(c.destination);
      const len = Math.floor(c.sampleRate * 1.0);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      audio.ctx = c; audio.master = master; audio.noise = buf;
      if (c.state === 'suspended') safe(() => c.resume());
    } catch (e) { audio.ctx = null; }
  }
  function env(c, t0, g, decay) {
    const gn = c.createGain();
    gn.gain.setValueAtTime(Math.max(0.0001, g), t0);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    gn.connect(audio.master);
    return gn;
  }
  function noiseBurst(t0, dur, filt, g, decay) {
    const c = audio.ctx;
    const src = c.createBufferSource(); src.buffer = audio.noise;
    src.playbackRate.value = rand(0.92, 1.08);
    let node = src;
    if (filt) { const f = c.createBiquadFilter(); f.type = filt.type; f.frequency.value = filt.freq; f.Q.value = filt.Q || 0.8; src.connect(f); node = f; }
    node.connect(env(c, t0, g, decay));
    src.start(t0); src.stop(t0 + dur + 0.02);
  }
  /* Filtered noise whose cutoff sweeps f0 → f1 over dur (sword swish, rocket whoosh — v1.1 A10). */
  function noiseSweep(t0, dur, type, f0, f1, g) {
    const c = audio.ctx;
    const src = c.createBufferSource(); src.buffer = audio.noise;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    src.connect(f); f.connect(env(c, t0, g, dur));
    src.start(t0); src.stop(t0 + dur + 0.02);
  }
  /* Flamethrower loop: looping lowpass noise, started on hold start, stopped on hold end / mute / deactivate. */
  function startLoop() {
    if (!audio.ctx || audio.loop || state.muted) return;
    try {
      const c = audio.ctx;
      if (c.state === 'suspended') safe(() => c.resume());
      const src = c.createBufferSource(); src.buffer = audio.noise; src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const g = c.createGain(); g.gain.value = 0.12;
      src.connect(f); f.connect(g); g.connect(audio.master);
      src.start();
      audio.loop = { src, g };
    } catch (e) { audio.loop = null; }
  }
  function stopLoop() {
    const l = audio.loop;
    if (!l) return;
    audio.loop = null;
    try { l.src.stop(); } catch (e) { /* ignore */ }
    try { l.src.disconnect(); l.g.disconnect(); } catch (e) { /* ignore */ }
  }
  function tone(t0, type, f0, f1, dur, g, decay) {
    const c = audio.ctx;
    const o = c.createOscillator(); o.type = type;
    const k = rand(0.92, 1.08);
    o.frequency.setValueAtTime(f0 * k, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * k), t0 + dur);
    o.connect(env(c, t0, g, decay || dur));
    o.start(t0); o.stop(t0 + Math.max(dur, decay || 0) + 0.05);
  }
  function sfx(kind, opts) {
    if (state.muted || !audio.ctx) return;
    const c = audio.ctx;
    try {
      if (c.state === 'suspended') { safe(() => c.resume()); }
      const t = c.currentTime + 0.001;
      const gm = rand(0.85, 1.15) * ((opts && opts.gain) || 1);
      const pitch = (opts && opts.pitch) || 1;          // axe 0.75: thump 110→45 becomes ≈ 82→34 Hz (A10)
      const crit = !!(opts && opts.crit) || kind === 'crit';
      const critK = crit ? 1.5 : 1;                     // crit feel (A4): tink partials ×1.5
      const comboK = 1 + 0.03 * Math.min(12, Math.max(0, state.combo - 1));
      const thump = (g) => tone(t, 'sine', 110 * comboK * pitch, 45 * pitch, 0.14, g, 0.16);
      const tinks = (n, stagger, g) => { for (let i = 0; i < n; i++) { tone(t + i * stagger, 'triangle', (i % 2 ? 4600 : 3100) * critK, (i % 2 ? 4400 : 3000) * critK, 0.07, g, 0.07); } };
      const glass = () => noiseBurst(t, 0.06, { type: 'highpass', freq: 5000, Q: 0.7 }, 0.12 * gm, 0.06);
      if (kind === 'hammer') { noiseBurst(t, 0.15, { type: 'bandpass', freq: 1800, Q: 0.8 }, 0.9 * gm, 0.12); thump(0.8 * gm); tinks(2, 0.012, 0.08 * gm); glass(); }
      else if (kind === 'thump') { thump(0.6 * gm); noiseBurst(t, 0.08, { type: 'bandpass', freq: 900, Q: 0.9 }, 0.3 * gm, 0.07); if (crit) tinks(2, 0.012, 0.08 * gm); }   // a dent that crits still sparkles (A4)
      else if (kind === 'gun') { noiseBurst(t, 0.045, { type: 'highpass', freq: 2500, Q: 0.7 }, 0.8 * gm, 0.045); tone(t, 'square', 1000, 900, 0.01, 0.25 * gm, 0.012); glass(); if (crit) tinks(1, 0, 0.07 * gm); }
      else if (kind === 'bomb' || kind === 'rumble') {
        const t0 = now();
        audio.boomAt = audio.boomAt.filter((x) => t0 - x < 700);
        if (audio.boomAt.length < 2) {
          audio.boomAt.push(t0);
          tone(t, 'sine', 70, 24, 0.7, (kind === 'rumble' ? 0.6 : 1) * 1.2 * gm, 0.7);
          noiseBurst(t, 0.55, { type: 'lowpass', freq: 420, Q: 0.8 }, (kind === 'rumble' ? 0.6 : 1) * 0.9 * gm, 0.5);
        }
        if (kind === 'bomb') { tinks(3, 0.03, 0.1 * gm); glass(); }
      }
      else if (kind === 'swish') { noiseSweep(t, 0.09, 'highpass', 2000, 6000, 0.5 * gm); tinks(1, 0, 0.08 * gm); }   // sword
      else if (kind === 'whoosh') { noiseSweep(t, 0.15, 'bandpass', 200, 1200, 0.6 * gm); }                            // rocket travel
      else if (kind === 'puff') { noiseBurst(t, 0.09, { type: 'lowpass', freq: 900, Q: 0.8 }, 0.3 * gm, 0.09); if (crit) tinks(1, 0, 0.06 * gm); }      // single flame tick
      else if (kind === 'clack') { tone(t, 'square', 320, 300, 0.03, 0.15, 0.03); }                                   // cooldown reject (A3) / bolt clicks
      else if (kind === 'crit') { tinks(2, 0.012, 0.08 * gm); }   // the ×1.5 sparkle on its own: per-element AoE crits and hold-window crits (A4)
      // v1.2 (A5): tone / noise combos only, no new audio graph
      else if (kind === 'sniper') { noiseBurst(t, 0.12, { type: 'highpass', freq: 1800, Q: 0.7 }, 1.1 * gm, 0.12); tone(t, 'sine', 55, 40, 0.35, 0.9 * gm, 0.35); glass(); if (crit) tinks(2, 0.012, 0.08 * gm); }
      else if (kind === 'empty') { tone(t, 'square', 180, 120, 0.03, 0.18, 0.03); }
      else if (kind === 'magout') { tone(t, 'square', 260, 200, 0.04, 0.16, 0.05); noiseBurst(t, 0.03, { type: 'bandpass', freq: 1200, Q: 1 }, 0.2 * gm, 0.03); }
      else if (kind === 'magin') { tone(t, 'square', 420, 360, 0.04, 0.18, 0.05); noiseBurst(t, 0.03, { type: 'bandpass', freq: 2200, Q: 1 }, 0.25 * gm, 0.03); }
      else if (kind === 'scopeIn') { tone(t, 'square', 900, 800, 0.02, 0.12, 0.03); noiseBurst(t + 0.03, 0.3, { type: 'lowpass', freq: 600, Q: 0.6 }, 0.08 * gm, 0.3); }
      else if (kind === 'scopeOut') { tone(t, 'square', 700, 600, 0.02, 0.12, 0.03); }
      else if (kind === 'kill') { tone(t, 'triangle', 500, 1400, 0.18, 0.25 * gm, 0.2); tone(t + 0.08, 'triangle', 800, 1800, 0.14, 0.2 * gm, 0.16); }
      else if (kind === 'hurt') { tone(t, 'sine', 90, 40, 0.2, 0.8 * gm, 0.22); noiseBurst(t, 0.12, { type: 'lowpass', freq: 500, Q: 0.8 }, 0.4 * gm, 0.12); }
      else if (kind === 'pop') { tone(t, 'sine', 600, 200, 0.06, 0.3 * gm, 0.08); noiseBurst(t, 0.03, { type: 'highpass', freq: 3000, Q: 0.7 }, 0.2 * gm, 0.03); }
      // v1.3 §3.2 / §3.4 / §3.5: "something is aiming at you", "that one went past you", "that one hit you"
      else if (kind === 'alert') { tone(t, 'sine', 220, 220, 0.12, 0.32 * gm, 0.14); }
      else if (kind === 'whiff') { noiseSweep(t, 0.09, 'highpass', 900, 7000, 0.45 * gm); }
      else if (kind === 'hurtbig') { tone(t, 'sine', 90, 40, 0.25, 1.15 * gm, 0.28); noiseBurst(t, 0.08, { type: 'lowpass', freq: 420, Q: 0.9 }, 0.6 * gm, 0.09); }
      else if (kind === 'laser') { noiseSweep(t, 0.4, 'bandpass', 3000, 600, 0.5 * gm); tone(t, 'sawtooth', 220, 180, 0.4, 0.15 * gm, 0.4); }
    } catch (e) { /* ignore */ }
  }

// ── 45-hud.js ──
  /* ===================================================================== */
  /* 6. HUD (shadow DOM, constructed stylesheet)                            */
  /*                                                                        */
  /* v1.3 §1/§2: the 공격력 ×N row is gone, and the two panels the player    */
  /* actually reads mid-fight — ammo (bottom-right) and health (bottom-left) */
  /* — sit on their own dark, blurred plates at 24 px so they stop           */
  /* disappearing into bright pages. Both are width-stable: the ammo panel   */
  /* is pinned to 196 px so 교체 중 can no longer make it jump.               */
  /* ===================================================================== */
  const HUD_CSS = [
    ':host{all:initial;display:block;cursor:default;color-scheme:dark}',
    '*{box-sizing:border-box}',
    '.panel{font:13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#fff;background:rgba(18,18,22,.86);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.14);border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.45);padding:10px 12px;width:max-content;min-width:300px;max-width:380px;user-select:none;-webkit-user-select:none}',
    '.title{display:flex;align-items:center;gap:6px;font-weight:700;font-size:14px;cursor:grab;touch-action:none;padding:2px 2px 8px;letter-spacing:.2px}',
    // v1.2: ADS fades the weapon panel (ammo / player HUD / toast stay) so it never covers the scope circle
    ':host(.crs-scoped) .panel{opacity:.12;pointer-events:none;transition:opacity .15s ease-out}',
    '.title:active{cursor:grabbing}',
    '.row{display:flex;gap:6px;margin-top:6px}',
    // v1.2 A6: compact 2 × 5 grid — slot badge + emoji only; name / damage live in title, aria-label and the .cur readout
    '.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin-top:6px}',
    'button{all:unset;display:inline-flex;align-items:center;justify-content:center;gap:4px;flex:1 1 0;min-width:max-content;height:30px;padding:0 6px;border-radius:9px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);color:#fff;font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap;text-align:center;transition:background .12s}',
    '.grid button{position:relative;min-width:0;flex:none;justify-content:center;gap:0;padding:0;overflow:hidden;font-size:16px;touch-action:none}',
    '.grid button.dragging{opacity:.6;transform:scale(.94)}',
    '.badge{position:absolute;top:2px;left:4px;font-size:9px;line-height:1.3;padding:0 3px;border-radius:4px;background:rgba(255,255,255,.18);font-weight:700}',
    '.cur{margin-top:6px;font-size:12.5px;color:rgba(255,255,255,.92);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.presets{display:flex;align-items:center;gap:3px;margin-top:6px}',
    '.presets .plabel{flex:none;font-size:11.5px;color:rgba(255,255,255,.7);white-space:nowrap;margin-right:2px}',
    '.presets button{flex:0 0 auto;min-width:max-content;height:24px;padding:0 4px;font-size:11px;border-radius:7px}',
    '.presets .custom{flex:none;font-size:10.5px;color:#ffb224;white-space:nowrap}',
    'button:hover{background:rgba(255,255,255,.16)}',
    'button:focus-visible{outline:2px solid #e5484d;outline-offset:1px}',
    'button[aria-pressed="true"]{background:#e5484d;border-color:#e5484d}',
    'button.holding{animation:crs-hold 700ms ease-in-out infinite alternate}',
    '@keyframes crs-hold{from{border-color:rgba(255,255,255,.3)}to{border-color:#ffb224}}',
    '.status{contain:inline-size;margin-top:8px;font-size:12px;color:rgba(255,255,255,.78);display:flex;flex-wrap:wrap;align-items:center;gap:0 6px;min-height:17px}',
    '.hint{flex:1 1 100%;color:rgba(255,255,255,.62)}',
    '.combo{display:inline-block;color:#ffb224;font-weight:700}',
    '.combo.pop{animation:pop .15s ease-out}',
    '.last{flex:1 1 100%;min-height:17px;color:#ffe9a8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '@keyframes pop{from{transform:scale(1.4)}to{transform:scale(1)}}',
    // v1.2 A11: ammo HUD / player HUD / toast / KO live in this shadow root as siblings of .panel (host pins transform: none)
    '.crs-ammo,.crs-player,.crs-toast,.crs-ko{font:13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#fff;user-select:none;-webkit-user-select:none}',
    // v1.3 §2: one shared plate for both read-at-a-glance panels — dark, blurred, bordered, 24 px from the corner
    '.crs-plate{background:rgba(12,12,16,.72);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.16);border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.45);padding:10px 12px}',
    '.crs-num{font-variant-numeric:tabular-nums;text-shadow:0 1px 3px rgba(0,0,0,.9)}',
    // ammo (bottom-right). The width is PINNED: 교체 중 / ∞ / 100 all render inside 196 px, so swapping never shifts it.
    '.crs-ammo{position:fixed;right:24px;bottom:24px;pointer-events:none;text-align:right;min-width:196px;max-width:196px}',
    '.crs-ammo .apips{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:3px;min-height:4px;margin-bottom:6px}',
    '.crs-ammo .apip{flex:none;width:7px;height:4px;border-radius:1px;background:#fff}',
    '.crs-ammo .apip.spent{background:rgba(255,255,255,.22)}',
    '.crs-ammo .aline{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-height:48px}',
    '.crs-ammo .aemoji{font-size:30px;line-height:1}',
    '.crs-ammo .abig{font-size:48px;font-weight:800;line-height:1}',
    '.crs-ammo .abig.low{color:#e5484d}',
    '.crs-ammo .abig.dim{color:rgba(255,255,255,.4)}',
    '.crs-ammo .abig.swap{font-size:20px;font-weight:700;color:rgba(255,255,255,.72)}',
    '.crs-ammo .adim{font-size:16px;color:rgba(255,255,255,.55)}',
    '.crs-ammo .abar{width:180px;height:8px;background:rgba(255,255,255,.22);border-radius:4px;margin:6px 0 0 auto;overflow:hidden;display:none}',
    '.crs-ammo .abar.on{display:block}',
    '.crs-ammo .afill{height:100%;width:0;background:#ffb224;border-radius:4px}',
    '.crs-ammo .aprompt{display:none;align-items:center;justify-content:flex-end;gap:7px;font-size:18px;font-weight:700;color:#e5484d;text-shadow:0 1px 3px rgba(0,0,0,.9)}',
    '.crs-ammo .aprompt.on{display:flex}',
    '.crs-ammo .keycap{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:26px;padding:0 4px;border:1.5px solid rgba(255,255,255,.9);border-radius:6px;font-size:20px;font-weight:800;line-height:1;color:#fff}',
    // health (bottom-left): 220 × 16 bar, ten notches, label above it
    '.crs-player{position:fixed;left:24px;bottom:24px;pointer-events:none;display:none}',
    '.crs-player.on{display:block}',
    '.crs-player .php{display:block;font-size:16px;font-weight:700;white-space:nowrap;margin-bottom:5px}',
    '.crs-player .hbar{position:relative;width:220px;height:16px;background:rgba(255,255,255,.18);border-radius:8px;overflow:hidden}',
    '.crs-player .hfill{height:100%;width:100%;background:#3fb950;border-radius:8px}',
    '.crs-player .hticks{position:absolute;left:0;top:0;right:0;bottom:0;background-image:repeating-linear-gradient(90deg,transparent 0 21px,rgba(0,0,0,.5) 21px 22px)}',
    '.crs-player .pstats{margin-top:6px;font-size:12px;color:rgba(255,255,255,.85);white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.9)}',
    '.crs-toast{position:fixed;left:50%;top:14px;transform:translate(-50%,0);background:rgba(18,18,22,.92);padding:7px 14px;border-radius:999px;pointer-events:none;display:none;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.14);z-index:6}',
    '.crs-toast.show{display:block}',
    '.crs-ko{position:fixed;inset:0;background:rgba(0,0,0,.78);pointer-events:auto;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;z-index:5}',
    '.crs-ko.show{display:flex}',
    '.crs-ko .kt{font-size:30px;font-weight:800;letter-spacing:.3px}',
    '.crs-ko .ks{font-size:15px;color:rgba(255,255,255,.85)}',
    '.crs-ko .kb{display:flex;gap:10px;margin-top:8px}',
    '.crs-ko button{flex:none;height:38px;padding:0 18px;font-size:14px;background:rgba(255,255,255,.12)}',
    // ── v1.4: the three-way mode control (§0.5), the destruction-ratio meter (§3.2) and the dash dot (§1.2) ──
    '.modes{display:flex;align-items:center;gap:3px;margin-top:6px}',
    '.modes .mlabel{flex:none;font-size:11.5px;color:rgba(255,255,255,.7);white-space:nowrap;margin-right:2px}',
    '.modes button{flex:1 1 0;min-width:0;height:26px;padding:0 4px;font-size:11.5px;border-radius:7px}',
    '.modes button[aria-pressed="true"]{background:#e5484d;border-color:#e5484d}',
    '.mdesc{margin-top:4px;font-size:11px;color:rgba(255,255,255,.62);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.crs-progress{position:fixed;left:50%;top:52px;transform:translate(-50%,0);pointer-events:none;display:none;font:13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#fff;z-index:4}',
    '.crs-progress.on{display:block}',
    '.crs-progress .rlabel{display:block;font-size:13px;font-weight:700;text-align:center;margin-bottom:4px;white-space:nowrap}',
    '.crs-progress .rbar{width:220px;height:10px;background:rgba(255,255,255,.2);border-radius:5px;overflow:hidden}',
    '.crs-progress .rfill{height:100%;width:0;background:#e5484d;border-radius:5px}',
    '.crs-player .pdash{display:none;width:10px;height:10px;margin-left:8px;border-radius:50%;vertical-align:-1px;background:rgba(255,255,255,.22);box-shadow:0 0 0 1px rgba(255,255,255,.35) inset}',
    '.crs-player .pdash.ready{background:#58a6ff;box-shadow:0 0 6px 1px rgba(88,166,255,.75)}'
  ].join('\n');

  function hudButton(label, title, onClick) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', (e) => { e.preventDefault(); try { onClick(); } catch (err) { /* ignore */ } });
    return b;
  }
  function buildHud() {
    const host = mk('crs-hud', 'crs-hud-host');
    let shadow = null;
    try { shadow = host.attachShadow({ mode: 'open' }); } catch (e) { shadow = null; }
    const mountPoint = shadow || host;
    let styled = false;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(HUD_CSS);
      mountPoint.adoptedStyleSheets = [sheet];
      styled = true;
    } catch (e) { styled = false; }
    if (!styled) {
      try { const st = doc.createElement('style'); st.textContent = HUD_CSS; mountPoint.append(st); } catch (e) { /* ignore */ }
    }
    const panel = doc.createElement('div'); panel.className = 'panel';
    const title = doc.createElement('div'); title.className = 'title';
    title.textContent = '🔨 ' + msg('hudTitle');
    // weapons: 2 × 5 compact grid in loadout order — slot badge + emoji (v1.2 A6); created once, re-appended on reorder
    const grid = doc.createElement('div'); grid.className = 'grid';
    hudEls.grid = grid;
    hudEls.weaponBtns = {}; hudEls.badges = {};
    let gridDrag = null, suppressClick = false;
    for (const id of WEAPON_IDS) {
      const W = WEAPONS[id];
      const b = doc.createElement('button');
      b.type = 'button';
      b.setAttribute('data-weapon', id);
      b.setAttribute('aria-pressed', 'false');
      const badge = doc.createElement('span'); badge.className = 'badge';
      const em = doc.createElement('span'); em.className = 'em'; em.textContent = W.emoji;
      b.append(badge, em);
      b.addEventListener('click', (e) => {
        e.preventDefault();
        if (suppressClick) { suppressClick = false; return; }   // the click that follows a drag
        try { setWeapon(id); } catch (err) { /* ignore */ }
      });
      // drag reorder (A6): pointer capture on the pressed button, 6 px threshold, drop via shadowRoot.elementFromPoint
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        suppressClick = false;
        gridDrag = { id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, dragging: false };
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });
      b.addEventListener('pointermove', (e) => {
        if (!gridDrag || gridDrag.id !== id || gridDrag.dragging) return;
        if (Math.hypot(e.clientX - gridDrag.x, e.clientY - gridDrag.y) >= 6) { gridDrag.dragging = true; try { b.classList.add('dragging'); } catch (err) { /* ignore */ } }
      });
      const endDrag = (e) => {
        if (!gridDrag || gridDrag.id !== id) return;
        const d = gridDrag; gridDrag = null;
        try { b.releasePointerCapture(d.pointerId); } catch (err) { /* ignore */ }
        try { b.classList.remove('dragging'); } catch (err) { /* ignore */ }
        if (!d.dragging) return;
        suppressClick = true;
        if (e.type !== 'pointerup') return;
        let target = null;
        try { target = (hudShadow || doc).elementFromPoint(e.clientX, e.clientY); } catch (err) { target = null; }
        const drop = target && target.closest ? target.closest('button[data-weapon]') : null;
        const dropId = drop ? drop.getAttribute('data-weapon') : null;
        if (dropId && dropId !== id) { try { moveToSlot(id, slotOf(dropId)); } catch (err) { /* ignore */ } }
      };
      b.addEventListener('pointerup', endDrag);
      b.addEventListener('pointercancel', endDrag);
      hudEls.weaponBtns[id] = b; hudEls.badges[id] = badge;
      grid.append(b);
    }
    // preset row (A6): 로드아웃 [기본][돌격][저격][폭발][근접] (사용자 지정)
    const presets = doc.createElement('div'); presets.className = 'presets';
    const plabel = doc.createElement('span'); plabel.className = 'plabel'; plabel.textContent = msg('labelLoadout');
    presets.append(plabel);
    hudEls.presetBtns = {};
    for (const name of Object.keys(PRESETS)) {
      const pb = hudButton(msg(PRESET_KEYS[name]), msg('labelLoadout') + ': ' + msg(PRESET_KEYS[name]), () => applyPreset(name));
      pb.setAttribute('data-preset', name);
      pb.setAttribute('aria-pressed', 'false');
      hudEls.presetBtns[name] = pb;
      presets.append(pb);
    }
    hudEls.customTag = doc.createElement('span'); hudEls.customTag.className = 'custom'; hudEls.customTag.textContent = msg('presetCustom');
    presets.append(hudEls.customTag);
    // active weapon readout
    hudEls.cur = doc.createElement('div'); hudEls.cur.className = 'cur';
    const actions = doc.createElement('div'); actions.className = 'row';
    hudEls.sound = hudButton('🔊 ' + msg('btnSound'), msg('btnSound') + ' (M)', () => setMuted(!state.muted));
    hudEls.restore = hudButton('↺ ' + msg('btnRestore'), msg('btnRestore') + ' (Z)', () => restore());
    hudEls.combatBtn = hudButton('⚔️ ' + msg('labelCombat') + ' ON', msg('labelCombat') + ' (H)', () => setCombat(!state.combat));
    hudEls.combatBtn.className = 'crs-combat-toggle';
    hudEls.exit = hudButton('✕ ' + msg('btnExit'), msg('btnExit') + ' (Esc)', () => deactivate());
    actions.append(hudEls.sound, hudEls.restore, hudEls.combatBtn, hudEls.exit);
    const status = doc.createElement('div'); status.className = 'status';
    hudEls.hint = doc.createElement('span'); hudEls.hint.className = 'hint';
    hudEls.pieces = doc.createElement('span');
    hudEls.cracks = doc.createElement('span');
    hudEls.damage = doc.createElement('span');
    hudEls.score = doc.createElement('span');   // "· 점수 N" while combat is on (v1.2 §7)
    hudEls.combo = doc.createElement('span'); hudEls.combo.className = 'combo';
    hudEls.last = doc.createElement('span'); hudEls.last.className = 'last';
    status.append(hudEls.hint, hudEls.pieces, hudEls.cracks, hudEls.damage, hudEls.score, hudEls.combo, hudEls.last);
    panel.append(title, grid, presets, hudEls.cur, actions, status);
    mountPoint.append(panel);
    hudEls.panel = panel; hudEls.title = title;
    // v1.2 A11: ammo HUD (bottom-right), player HUD (bottom-left), toast (top-centre), KO overlay — shadow siblings of .panel
    const ammo = mk('div', 'crs-ammo'); ammo.classList.add('crs-plate');
    hudEls.aPips = doc.createElement('div'); hudEls.aPips.className = 'apips';   // v1.3 §2.1: one bar per round, read without the number
    hudEls.aPipList = [];
    const aline = doc.createElement('div'); aline.className = 'aline';
    hudEls.aEmoji = doc.createElement('span'); hudEls.aEmoji.className = 'aemoji';
    hudEls.aBig = doc.createElement('span'); hudEls.aBig.className = 'abig crs-num';
    hudEls.aDim = doc.createElement('span'); hudEls.aDim.className = 'adim crs-num';
    // the empty-magazine prompt takes the NUMBER's place (§2.1): "⌨R 재장전"
    hudEls.aPrompt = doc.createElement('span'); hudEls.aPrompt.className = 'aprompt';
    const keycap = doc.createElement('span'); keycap.className = 'keycap'; keycap.textContent = 'R';
    // the label is a bare text node, so .aprompt is the deepest element reading "R 재장전" as one string
    hudEls.aPrompt.append(keycap, doc.createTextNode(msg('toastReload')));
    aline.append(hudEls.aEmoji, hudEls.aBig, hudEls.aDim, hudEls.aPrompt);
    hudEls.aBar = doc.createElement('div'); hudEls.aBar.className = 'abar';
    hudEls.aFill = doc.createElement('div'); hudEls.aFill.className = 'afill';
    hudEls.aBar.append(hudEls.aFill);
    ammo.append(hudEls.aPips, aline, hudEls.aBar);
    hudEls.ammo = ammo;
    const player = mk('div', 'crs-player'); player.classList.add('crs-plate');
    hudEls.pHp = doc.createElement('span'); hudEls.pHp.className = 'php crs-num';
    const hbar = doc.createElement('div'); hbar.className = 'hbar';
    hudEls.pFill = doc.createElement('div'); hudEls.pFill.className = 'hfill';
    const hticks = doc.createElement('div'); hticks.className = 'hticks';   // ten notches: one cell per 10 % (§2.2)
    hbar.append(hudEls.pFill, hticks);
    hudEls.pBar = hbar;
    hudEls.pStats = doc.createElement('div'); hudEls.pStats.className = 'pstats';
    player.append(hudEls.pHp, hbar, hudEls.pStats);
    hudEls.player = player;
    hudEls.toast = mk('div', 'crs-toast');
    hudEls.mount = mountPoint;   // the KO overlay (`.crs-ko`) is built on demand by showKo() and removed by hideKo()
    mountPoint.append(ammo, player, hudEls.toast);
    reorderHud();
    hudShadow = shadow;
    // drag by the title bar (clamped to the viewport)
    let drag = null;
    title.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = host.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
      try { title.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    });
    title.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const l = clamp(e.clientX - drag.dx, 0, Math.max(0, viewW() - drag.w));
      const t = clamp(e.clientY - drag.dy, 0, Math.max(0, viewH() - drag.h));
      host.style.setProperty('--crs-hud-left', px(l));
      host.style.setProperty('--crs-hud-top', px(t));
      host.style.setProperty('--crs-hud-right', 'auto');
    });
    const endDrag = (e) => { if (!drag) return; drag = null; try { title.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ } };
    title.addEventListener('pointerup', endDrag);
    title.addEventListener('pointercancel', endDrag);

    // ── v1.4 §0.5: the three-way mode control replaces the single 전투 ON/OFF button ──
    /* The old button is kept alive but taken out of the row, so every v1.3 line that still writes to it keeps
     * working untouched while the player sees one segmented control listing rampage · quickdraw · survival. */
    const modes = doc.createElement('div'); modes.className = 'modes';
    const mlabel = doc.createElement('span'); mlabel.className = 'mlabel'; mlabel.textContent = msg('labelCombat');
    modes.append(mlabel);
    hudEls.modeBtns = {};
    for (const id of MODES) {
      const mb = hudButton(modeLabel(id), modeLabel(id) + ' · ' + modeDesc(id) + ' (H)', () => setPlayMode(id));
      mb.setAttribute('data-mode', id);
      mb.setAttribute('aria-pressed', 'false');
      hudEls.modeBtns[id] = mb;
      modes.append(mb);
    }
    hudEls.modes = modes;
    hudEls.modeDesc = doc.createElement('div'); hudEls.modeDesc.className = 'mdesc';
    try { panel.insertBefore(modes, actions); panel.insertBefore(hudEls.modeDesc, actions); } catch (err) { panel.append(modes, hudEls.modeDesc); }
    try { if (hudEls.combatBtn && hudEls.combatBtn.parentNode) hudEls.combatBtn.parentNode.removeChild(hudEls.combatBtn); } catch (err) { /* ignore */ }

    // ── v1.4 §3.2: the destruction-ratio meter, top centre under the toast ──
    const prog = mk('div', 'crs-progress');
    const rlabel = doc.createElement('span'); rlabel.className = 'rlabel crs-num';
    const rbar = doc.createElement('div'); rbar.className = 'rbar';
    const rfill = doc.createElement('div'); rfill.className = 'rfill';
    rbar.append(rfill);
    prog.append(rlabel, rbar);
    mountPoint.append(prog);
    state.ratioNodes = { box: prog, label: rlabel, fill: rfill };

    // ── v1.4 §1.2: one dash-cooldown dot on the health panel ──
    hudEls.dashDot = doc.createElement('span'); hudEls.dashDot.className = 'pdash';
    try { hudEls.pStats.append(hudEls.dashDot); } catch (err) { /* ignore */ }
    return host;
  }
  function hudFallbackCheck() {
    // If neither adoptedStyleSheets nor the <style> fallback took effect (CSP), style minimally via CSSOM.
    try {
      const bg = gcsRaw(hudEls.panel).backgroundColor;
      if (alphaOf(bg) < 0.05) {
        const p = hudEls.panel.style;
        p.background = 'rgba(18,18,22,.92)'; p.color = '#fff'; p.padding = '10px 12px'; p.borderRadius = '14px';
        p.font = '13px system-ui, sans-serif'; p.width = 'max-content'; p.minWidth = '300px'; p.maxWidth = '380px'; p.boxShadow = '0 10px 30px rgba(0,0,0,.45)';
        for (const b of hudEls.panel.querySelectorAll('button')) { b.style.margin = '2px'; b.style.padding = '4px 6px'; b.style.color = '#fff'; b.style.background = 'rgba(255,255,255,.12)'; b.style.border = '1px solid rgba(255,255,255,.2)'; b.style.borderRadius = '8px'; b.style.cursor = 'pointer'; }
        // v1.2 A11: the shadow siblings get a minimal fixed placement too (their .on / .show classes are mirrored by style.display)
        const fixed = (n, l, r, t, b) => { const s = n.style; s.position = 'fixed'; s.left = l; s.right = r; s.top = t; s.bottom = b; s.color = '#fff'; s.background = 'rgba(12,12,16,.85)'; s.padding = '10px 12px'; s.borderRadius = '14px'; s.font = '13px system-ui, sans-serif'; s.pointerEvents = 'none'; };
        if (hudEls.ammo) { fixed(hudEls.ammo, 'auto', '24px', 'auto', '24px'); hudEls.ammo.style.minWidth = '196px'; hudEls.ammo.style.maxWidth = '196px'; hudEls.ammo.style.textAlign = 'right'; }
        if (hudEls.aBig) { hudEls.aBig.style.fontSize = '48px'; hudEls.aBig.style.fontWeight = '800'; }
        if (hudEls.aPrompt) hudEls.aPrompt.style.display = 'none';
        if (hudEls.player) { fixed(hudEls.player, '24px', 'auto', 'auto', '24px'); hudEls.player.style.display = state.combat ? 'block' : 'none'; }
        if (hudEls.pBar) { const b = hudEls.pBar.style; b.position = 'relative'; b.width = '220px'; b.height = '16px'; b.borderRadius = '8px'; b.overflow = 'hidden'; b.background = 'rgba(255,255,255,.18)'; }
        if (hudEls.pFill) { hudEls.pFill.style.height = '100%'; hudEls.pFill.style.background = '#3fb950'; }
        if (hudEls.toast) { fixed(hudEls.toast, '50%', 'auto', '14px', 'auto'); hudEls.toast.style.transform = 'translate(-50%, 0)'; hudEls.toast.style.display = 'none'; }
        // v1.4: the ratio meter needs the same minimal fixed placement as the other shadow siblings
        if (state.ratioNodes && state.ratioNodes.box) {
          fixed(state.ratioNodes.box, '50%', 'auto', '52px', 'auto');
          state.ratioNodes.box.style.transform = 'translate(-50%, 0)';
          state.ratioNodes.box.style.display = 'none';
          const rb = state.ratioNodes.fill.parentNode;
          if (rb) { rb.style.width = '220px'; rb.style.height = '10px'; rb.style.background = 'rgba(255,255,255,.2)'; rb.style.borderRadius = '5px'; rb.style.overflow = 'hidden'; }
          state.ratioNodes.fill.style.height = '100%'; state.ratioNodes.fill.style.background = '#e5484d';
        }
        hudEls.fallback = true;   // showKo() styles the on-demand KO overlay the same way
      }
    } catch (e) { /* ignore */ }
  }
  function weaponLabel(W) {
    if (W.id === 'smg') return W.damage + msg('unitPerShot');
    if (W.id === 'flame') return W.damage + msg('unitPerTick');
    if (W.id === 'collapse') return '∞';
    return String(W.damage);
  }
  function updateHud() {
    if (!hudEls.panel) return;
    try {
      for (const id of WEAPON_IDS) {
        const b = hudEls.weaponBtns[id];
        if (b) b.setAttribute('aria-pressed', state.weapon === id ? 'true' : 'false');
      }
      hudEls.sound.textContent = state.muted ? '🔇 ' + msg('btnMute') : '🔊 ' + msg('btnSound');
      hudEls.sound.title = (state.muted ? msg('btnMute') : msg('btnSound')) + ' (M)';
      hudEls.sound.setAttribute('aria-pressed', state.muted ? 'true' : 'false');
      const W = WEAPONS[state.weapon];
      hudEls.hint.textContent = state.hintCollapse ? msg('hudHintCollapse') : (W.hold ? msg('hudHintHold') : (W.input === 'drag' ? msg('hudHintDrag') : (W.scope ? msg('hudHintScope') : msg('hudHint'))));
      hudEls.pieces.textContent = msg('hudPieces') + ' ' + debrisCount();
      hudEls.cracks.textContent = '· ' + msg('hudCracks') + ' ' + state.cracks;
      hudEls.damage.textContent = '· ' + msg('hudDamage') + ' ' + state.damageDealt;
      hudEls.score.textContent = state.combat ? '· ' + msg('labelScore') + ' ' + state.player.score : '';
      hudEls.combo.textContent = state.combo >= 2 ? '· x' + state.combo : '';
      // v1.2: readout, preset row, combat toggle
      hudEls.cur.textContent = W.emoji + ' ' + msg(W.name) + ' · ' + weaponLabel(W);
      for (const name of Object.keys(PRESETS)) { const pb = hudEls.presetBtns[name]; if (pb) pb.setAttribute('aria-pressed', state.preset === name ? 'true' : 'false'); }
      const custom = state.preset === 'custom';
      hudEls.customTag.textContent = custom ? msg('presetCustom') : '';   // text only while custom (the tag "shows")
      hudEls.customTag.style.display = custom ? 'inline' : 'none';
      hudEls.combatBtn.textContent = '⚔️ ' + msg('labelCombat') + ' ' + (state.combat ? 'ON' : 'OFF');
      hudEls.combatBtn.title = msg('labelCombat') + ' ' + (state.combat ? 'ON' : 'OFF') + ' (H)';
      hudEls.combatBtn.setAttribute('aria-pressed', state.combat ? 'true' : 'false');
      updateModeHud();   // ── v1.4 §0.5 ──
    } catch (e) { /* ignore */ }
  }
  // ── v1.4 §0.5: which of the three is pressed, and the one-line description under them ──
  function updateModeHud() {
    if (!hudEls.modeBtns) return;
    try {
      for (const id of MODES) {
        const b = hudEls.modeBtns[id];
        if (b) b.setAttribute('aria-pressed', state.mode === id ? 'true' : 'false');
      }
      if (hudEls.modeDesc) hudEls.modeDesc.textContent = modeDesc(state.mode);
    } catch (e) { /* ignore */ }
  }
  /* Hot paths (hold ticks, staggered AoE hits) refresh the counters at most once per frame (A5 item 4). */
  function scheduleHud() {
    if (state.hudRaf || !state.active) return;
    state.hudRaf = raf(() => { state.hudRaf = 0; updateHud(); updateAmmoHud(); });
  }
  /* Grid order follows the loadout (v1.2 A6): the existing button nodes are re-appended; badge + title rewritten. */
  function reorderHud() {
    const grid = hudEls.grid;
    if (!grid || !hudEls.weaponBtns) return;
    try {
      state.loadout.forEach((id, i) => {
        const b = hudEls.weaponBtns[id]; if (!b) return;
        const W = WEAPONS[id], key = slotKey(i + 1);
        hudEls.badges[id].textContent = key;
        const t = key + ' · ' + msg(W.name) + ' · ' + weaponLabel(W);
        b.title = t; b.setAttribute('aria-label', t);
        grid.append(b);
      });
    } catch (e) { /* ignore */ }
  }
  function pulseBadge(id) {
    const badge = hudEls.badges && hudEls.badges[id];
    if (!badge || reducedMotion()) return;
    try { trackAnim(badge.animate([{ transform: 'scale(1.7)', background: '#ffb224', color: '#000' }, { transform: 'scale(1)', background: 'rgba(255,255,255,.18)', color: '#fff' }], { duration: 450, easing: 'ease-out' })); } catch (e) { /* ignore */ }
  }
  /* "IMG -65 (62/127)" for 1.2 s on its own reserved line (fixed height, so the panel never resizes under the
   * player's hand); "치명타! " prefix on crit (A5 item 4). */
  function hudLastHit(el, dmg, hp, max, crit, headshot) {
    try {
      hudEls.last.textContent = (crit ? msg(headshot ? 'headshotLabel' : 'critLabel') + ' ' : '') + tagOf(el).toUpperCase() + ' -' + dmg + ' (' + Math.max(0, hp) + '/' + max + ')';
      untrack(state.lastHitTimer);
      state.lastHitTimer = later(() => { state.lastHitTimer = 0; hudEls.last.textContent = ''; }, 1200);
    } catch (e) { /* ignore */ }
  }
  function bumpCombo() {
    const t = now();
    state.combo = (t - state.lastHitAt <= 700) ? state.combo + 1 : 1;
    state.lastHitAt = t;
    untrack(state.comboTimer);
    state.comboTimer = later(() => { state.comboTimer = 0; state.combo = 0; updateHud(); }, 700);
    try {
      hudEls.combo.classList.remove('pop');
      void hudEls.combo.offsetWidth;
      if (state.combo >= 2) hudEls.combo.classList.add('pop');
    } catch (e) { /* ignore */ }
  }

// ── 50-target.js ──
  /* ===================================================================== */
  /* 7. Target picking + hover highlight                                    */
  /*    v1.3 §3.1: scheduleHover()'s frame also carries the player ring      */
  /* ===================================================================== */
  /* Effective opacity = product of computed opacity up the (shadow-crossing) ancestor chain, ≤ 40 levels.
   * Hit testing ignores opacity, so an opacity:0 hover overlay (quick-view buttons, gallery captions)
   * would otherwise be picked ahead of the visible image beneath it. Memoised per pick in `cache`. */
  function effectiveOpacity(el, cache, depth) {
    if (cache.has(el)) return cache.get(el);
    const s = gcs(el);
    let own = s ? parseFloat(s.opacity) : 1;
    if (!isFinite(own)) own = 1;
    let v = own;
    if (own > 0 && depth < 40) {
      const p = parentOf(el);
      if (p && p !== docEl && p.nodeType === 1) v = own * effectiveOpacity(p, cache, depth + 1);
    }
    cache.set(el, v);
    return v;
  }
  /* A8 step 1 rules (a)–(c): not ours, not inert, non-empty rect, effective opacity ≥ 0.05. */
  function visibleCandidate(el, env) {
    if (!el || el.nodeType !== 1) return false;
    if (isOurs(el)) return false;
    try { if (el.closest('[inert]')) return false; } catch (e) { /* ignore */ }
    const r = rectOf(el); if (!r || r.width <= 0 || r.height <= 0) return false;
    if (effectiveOpacity(el, env.op, 0) < 0.05) return false;
    return true;
  }
  /* A8 step 1 rule (d): a full-viewport transparent overlay. */
  function isOverlay(el, env) {
    const r = rectOf(el), s = gcs(el);
    const m2 = scopeMag() * scopeMag();   // page rects are 2× while magnified (v1.2 A3)
    return !!(r && s && r.width * r.height > 0.8 * env.vw * env.vh * m2 && alphaOf(s.backgroundColor) === 0 && s.backgroundImage === 'none');
  }
  /* First entry of `list` (restricted to `rootNode` when given) that passes (a)–(c). A shadow host is
   * descended (A8 step 2, ≤ 5 levels) BEFORE rule (d) is applied to it, so a full-viewport transparent
   * root host (Ionic / Lit / Stencil / Angular ShadowDom apps) still yields its inner element. */
  function pickFromList(list, rootNode, x, y, env, depth) {
    for (const c of list) {
      if (rootNode && !(c.getRootNode && c.getRootNode() === rootNode)) continue;
      if (!visibleCandidate(c, env)) continue;
      if (c.shadowRoot && depth < 5) {
        let inner = null;
        try { inner = pickFromList(c.shadowRoot.elementsFromPoint(x, y), c.shadowRoot, x, y, env, depth + 1); } catch (e) { inner = null; }
        if (inner) return inner;
      }
      if (isOverlay(c, env)) continue;
      return c;
    }
    return null;
  }
  /* opts.noLock (v1.4): skip the lock-frame aim assist below. isCovered() asks that, because it needs the raw
   * answer "what would a click here really hit?" — with the assist on, a locked enemy would always look clear. */
  function pickTarget(x, y, cache, opts) {
    const env = { vw: viewW(), vh: viewH(), op: cache || new Map() };
    /* v1.4 §2.2 aim assist: a click inside a closing lock frame is a click on THAT enemy, not on a child of it.
     * Only for a frame that is actually drawn ON the enemy (quickdraw, lk.onEnemy). In survival the frame rides
     * the DRONE and then freezes wherever the drone was, so the same rule would teleport damage to an enemy the
     * player never aimed at — §2.2's wording ("자식 요소가 아니라 그 적대 요소") presumes the frame sits on the
     * enemy, and §2.3 gives survival shoot-or-dodge instead of this assist. */
    if (!(opts && opts.noLock) && state.locks.length) {
      const lk = lockAt(x, y);
      if (lk && lk.onEnemy && lk.rec && lk.rec.el && lk.rec.el.isConnected) {
        try { if (!lk.rec.el.hasAttribute('data-crs-broken')) return lk.rec.el; } catch (e) { /* ignore */ }
      }
    }
    let list;
    try { list = doc.elementsFromPoint(x, y); } catch (e) { return null; }
    let el = pickFromList(list, null, x, y, env, 0);
    if (!el) return null;
    const vw = env.vw, vh = env.vh;
    const mag = scopeMag(), mag2 = mag * mag;   // thresholds scale with the 2× body transform (v1.2 A3)
    // SVG: treat the outermost <svg> atomically
    if (el.ownerSVGElement) { let s = el; while (s.ownerSVGElement) s = s.ownerSVGElement; el = s; }
    const body = doc.body;
    // walk-up rules
    for (let guard = 0; guard < 40 && el; guard++) {
      const p = parentOf(el);
      if (!p || p === body || p === docEl || p.nodeType !== 1) break;
      const r = rectOf(el); if (!r) break;
      if (r.width < 24 * mag || r.height < 14 * mag) { el = p; continue; }
      const s = gcs(el);
      if (s && s.display === 'inline' && !REPLACED_TAGS.has(tagOf(el))) {
        // find the nearest block ancestor; take it if it is small
        let blk = p, bs = gcs(blk);
        while (blk && blk !== body && blk !== docEl && bs && bs.display === 'inline') { blk = parentOf(blk); bs = blk ? gcs(blk) : null; }
        if (blk && blk !== body && blk !== docEl) {
          const br = rectOf(blk);
          if (br && br.width * br.height < 60000 * mag2) { el = blk; continue; }
        }
      }
      break;
    }
    if (!el || el === body || el === docEl) return null;
    // v1.2: a hostile element fights as a unit — a hit on any of its descendants lands on the hostile itself
    if (state.hostiles.size) { for (const h of state.hostiles.keys()) { if (h !== el && h.contains(el)) { el = h; break; } } }
    const r = rectOf(el);
    if (!r || r.width * r.height > 0.8 * vw * vh * mag2) return null;
    if (el.hasAttribute('data-crs-broken')) return null;
    return el;
  }
  /* Size-based max HP (v1.1 A1): base = 20 + 0.35·sqrt(area); media ×1.2, controls ×1, text-ish ×0.6 capped
   * at 60 (a hammer always one-shots text), containers ×1; clamp [10, 400]. Computed once per element on
   * first contact (hover or hit) and cached in the WeakMap by hpOf(). */
  function hpMax(el) {
    const tag = tagOf(el);
    const r = rectOf(el) || { width: 0, height: 0 };
    const m = scopeMag();   // page-space area: rects are 2× under the scope transform (v1.2 A3)
    const area = Math.max(1, (r.width / m) * (r.height / m));
    const base = 20 + 0.35 * Math.sqrt(area);
    let role = null;
    try { role = el.getAttribute('role'); } catch (e) { role = null; }
    let v;
    if (MEDIA_TAGS.has(tag)) v = Math.round(base * 1.2);
    else if (FORM_TAGS.has(tag) || tag === 'summary' || role === 'button') v = Math.round(base);
    else if (TEXTISH_TAGS.has(tag)) v = Math.min(60, Math.round(base * 0.6));
    else v = Math.round(base);
    return clamp(v, 10, 400);
  }
  function hpOf(el) {
    let rec = state.hp.get(el);
    if (!rec) { const m = hpMax(el); rec = { hp: m, max: m, lastFxAt: 0, side: 1 }; state.hp.set(el, rec); }
    return rec;
  }
  function hpOfPublic(el) {
    if (!el || el.nodeType !== 1) return null;
    const rec = hpOf(el);
    // v1.4 §10.5: depth comes from the live hostile record when there is one, else it is measured on the spot
    const h = state.hostiles.get(el);
    const depth = h ? h.depth : depthOf(el);
    return { hp: Math.max(0, rec.hp), max: rec.max, depth, tier: h ? h.dtier : depthTier(depth) };
  }
  function fillColor(ratio) { return ratio > 0.6 ? '#3fb950' : (ratio > 0.3 ? '#e3b341' : '#e5484d'); }
  function showTarget(el) {
    state.hoverEl = el || null;
    if (!el || !targetBox) { if (targetBox) targetBox.style.display = 'none'; return; }
    const r = rectOf(el);
    if (!r) { targetBox.style.display = 'none'; return; }
    targetBox.style.display = 'block';
    targetBox.style.left = px(r.left); targetBox.style.top = px(r.top);
    targetBox.style.width = px(r.width); targetBox.style.height = px(r.height);
    const rec = hpOf(el);
    const hp = Math.max(0, rec.hp), ratio = rec.max > 0 ? clamp(hp / rec.max, 0, 1) : 0;
    // v1.4 §10.4: when the thing under the cursor is COVER, say how much is hiding behind it
    const behind = modeHasEnemies() ? hostilesBehind(el) : 0;
    targetLabel.textContent = tagOf(el).toUpperCase() + ' ' + hp + '/' + rec.max + (behind ? ' · ' + msg('hintEnemyBehind') + ' ' + behind : '');
    if (targetFill) { targetFill.style.width = (100 * ratio).toFixed(1) + '%'; targetFill.style.background = fillColor(ratio); }
  }
  /* Crit landed on the hovered element: the fill flashes white for 80 ms (A4). */
  function critFlashFill() {
    if (!targetFill || !targetBox || targetBox.style.display === 'none') return;
    try { trackAnim(targetFill.animate([{ backgroundColor: '#fff' }, { backgroundColor: targetFill.style.background || '#e5484d' }], { duration: 80 })); } catch (e) { /* ignore */ }
  }
  function refreshHover() {
    if (!state.active) return;
    if (state.overHud || state.hoverX < 0) { showTarget(null); return; }
    showTarget(pickTarget(state.hoverX, state.hoverY));
  }
  function scheduleHover() {
    if (state.moveRaf) return;
    // v1.3 §3.1: the player ring is repositioned on the frame the pointer move already schedules
    // v1.4: and the drone's nose, which tracks the crosshair even while the drone itself is parked
    state.moveRaf = raf(() => { state.moveRaf = 0; refreshHover(); if (state.self) selfStep(); if (state.avatar) placeAvatar(); });
  }
  function pulseTarget() {
    if (!targetBox || targetBox.style.display === 'none') return;
    try {
      trackAnim(targetBox.animate([{ backgroundColor: 'rgba(229,72,77,.35)' }, { backgroundColor: 'rgba(229,72,77,.06)' }], { duration: 200 }));
      trackAnim(targetLabel.animate([{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: 150, easing: 'ease-out' }));
    } catch (e) { /* ignore */ }
  }

  /* ── v1.4: what would a click at this point actually hit? ──
   * pickTarget() is where the hostile-unit rule (§5), the §2.2 lock aim assist and the §10 depth/occlusion
   * rules all land, so "the shot went nowhere" has several possible causes that look identical from outside.
   * This reports the resolved element without firing anything, so a failing assertion can say which rule ran. */
  debug.pickAt = (x, y) => {
    const el = pickTarget(+x, +y);
    if (!el) return null;
    const r = rectOf(el) || { left: 0, top: 0, width: 0, height: 0 };
    let cls = '';
    try { cls = typeof el.className === 'string' ? el.className : ''; } catch (e) { cls = ''; }
    return {
      tag: tagOf(el).toUpperCase(),
      id: el.id || null,
      cls: cls.slice(0, 60),
      hostile: state.hostiles.has(el),
      broken: el.hasAttribute('data-crs-broken'),
      rect: { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
    };
  };

// ── 55-geometry.js ──
  /* ===================================================================== */
  /* 8. Geometry: polygon splitting                                          */
  /* ===================================================================== */
  function polyInfo(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
      const cr = p[0] * q[1] - q[0] * p[1];
      a += cr; cx += (p[0] + q[0]) * cr; cy += (p[1] + q[1]) * cr;
    }
    if (Math.abs(a) < 1e-6) { cx = (minX + maxX) / 2; cy = (minY + maxY) / 2; } else { cx /= (3 * a); cy /= (3 * a); }
    return { pts, minX, minY, maxX, maxY, cx, cy };
  }
  function rayExit(w, h, cx, cy, a) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let t = Infinity;
    if (dx > 1e-9) t = Math.min(t, (w - cx) / dx); else if (dx < -1e-9) t = Math.min(t, -cx / dx);
    if (dy > 1e-9) t = Math.min(t, (h - cy) / dy); else if (dy < -1e-9) t = Math.min(t, -cy / dy);
    if (!isFinite(t)) t = 0;
    return { x: clamp(cx + dx * t, 0, w), y: clamp(cy + dy * t, 0, h), L: t };
  }
  function perim(w, h, x, y) {
    const e = 0.01;
    if (Math.abs(y) < e) return x;
    if (Math.abs(x - w) < e) return w + y;
    if (Math.abs(y - h) < e) return w + h + (w - x);
    return 2 * w + h + (h - y);
  }
  function pieSplit(w, h, cx, cy, angles) {
    const P = 2 * (w + h);
    const rays = angles.map((a0) => {
      const a = ((a0 % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const e = rayExit(w, h, cx, cy, a);
      const fr = Math.random() < 0.5 ? [rand(0.35, 0.65)] : [rand(0.25, 0.45), rand(0.6, 0.8)];
      const nx = -Math.sin(a), ny = Math.cos(a);
      const pts = fr.map((f) => {
        const off = rand(-0.08, 0.08) * e.L;
        return [clamp(cx + Math.cos(a) * f * e.L + nx * off, 0.5, w - 0.5), clamp(cy + Math.sin(a) * f * e.L + ny * off, 0.5, h - 0.5)];
      });
      return { a, pts, ex: e.x, ey: e.y, t: perim(w, h, e.x, e.y) };
    }).sort((p, q) => p.a - q.a);
    const corners = [[0, 0, 0], [w, 0, w], [w, h, w + h], [0, h, 2 * w + h]];
    const out = [];
    for (let i = 0; i < rays.length; i++) {
      const r1 = rays[i], r2 = rays[(i + 1) % rays.length];
      const poly = [[cx, cy]].concat(r1.pts, [[r1.ex, r1.ey]]);
      const span = rays.length === 1 ? P : ((((r2.t - r1.t) % P) + P) % P || P);
      const dist = (t) => (((t - r1.t) % P) + P) % P;
      const cs = corners.filter((c) => { const d = dist(c[2]); return d > 1e-6 && d < span - 1e-6; }).sort((p, q) => dist(p[2]) - dist(q[2]));
      for (const c of cs) poly.push([c[0], c[1]]);
      poly.push([r2.ex, r2.ey]);
      for (let k = r2.pts.length - 1; k >= 0; k--) poly.push(r2.pts[k]);
      out.push(polyInfo(poly));
    }
    return out;
  }
  function gridSplit(w, h, cols, rows) {
    const cw = w / cols, ch = h / rows, V = [];
    for (let j = 0; j <= rows; j++) {
      V.push([]);
      for (let i = 0; i <= cols; i++) {
        let x = i * cw, y = j * ch;
        const ex = i === 0 || i === cols, ey = j === 0 || j === rows;
        if (!ex) x += rand(-0.12, 0.12) * cw;
        if (!ey) y += rand(-0.12, 0.12) * ch;
        V[j].push([x, y]);
      }
    }
    const out = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push(polyInfo([V[j][i], V[j][i + 1], V[j + 1][i + 1], V[j + 1][i]]));
    return out;
  }
  function splitRect(w, h, n, ix, iy, splitLine) {
    if (n <= 1 || w < 2 || h < 2) return [polyInfo([[0, 0], [w, 0], [w, h], [0, h]])];
    if (n === 2 && splitLine) {   // axe / sword (A8): forced angle, pivot clamped to [2, w−2] × [2, h−2]
      const a = splitLine.angle;
      const cx = clamp(splitLine.cx, Math.min(2, w / 2), Math.max(w - 2, w / 2));
      const cy = clamp(splitLine.cy, Math.min(2, h / 2), Math.max(h - 2, h / 2));
      return pieSplit(w, h, cx, cy, [a, a + Math.PI]);
    }
    if (n === 6) return gridSplit(w, h, 3, 2);
    if (n === 8) return gridSplit(w, h, 4, 2);
    if (n === 4) {
      return pieSplit(w, h, clamp(ix, w * 0.25, w * 0.75), clamp(iy, h * 0.25, h * 0.75), [0, 90, 180, 270].map((d) => (d + rand(-25, 25)) * DEG));
    }
    const a = rand(0, Math.PI * 2);
    return pieSplit(w, h, clamp(ix + rand(-0.1, 0.1) * w, w * 0.3, w * 0.7), clamp(iy + rand(-0.1, 0.1) * h, h * 0.3, h * 0.7), [a + rand(-8, 8) * DEG, a + Math.PI + rand(-8, 8) * DEG]);
  }
  function polyToClip(poly) { return 'polygon(' + poly.pts.map((p) => px(p[0]) + ' ' + px(p[1])).join(',') + ')'; }

// ── 60-clone.js ──
  /* ===================================================================== */
  /* 9. Cloning (recursive cloneTree + computed-style diff)                  */
  /* ===================================================================== */
  function substitute(src) {
    const d = doc.createElement('div');
    const s = gcs(src);
    const bg = s ? s.backgroundColor : '';
    d.style.backgroundColor = (bg && alphaOf(bg) > 0) ? bg : '#e8e8e8';
    d.style.border = '1px solid rgba(0,0,0,.15)';
    d.style.boxSizing = 'border-box';
    return d;
  }
  function canvasOf(src, w, h) {
    try {
      const c = doc.createElement('canvas');
      c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
      c.style.width = px(w); c.style.height = px(h);
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      return c;
    } catch (e) { return null; }
  }
  function copyAttrs(src, clone) {
    const attrs = src.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i], n = a.name;
      if (STRIP_ATTRS.has(n) || n.startsWith('on') || (n === 'role' && a.value === 'alert')) continue;
      try { if (a.namespaceURI) clone.setAttributeNS(a.namespaceURI, n, a.value); else clone.setAttribute(n, a.value); } catch (e) { /* ignore */ }
    }
    if (src.hasAttribute('open') && tagOf(src) === 'details') { try { clone.setAttribute('open', ''); } catch (e) { /* ignore */ } }
  }
  function copyInlineStyle(src, clone, isRoot) {
    try {
      const st = src.style;
      if (!st) return;
      for (let i = 0; i < st.length; i++) {
        const p = st[i];
        if (isRoot && (ROOT_INLINE_SKIP.has(p) || p.startsWith('transition') || p.startsWith('animation'))) continue;
        clone.style.setProperty(p, st.getPropertyValue(p), st.getPropertyPriority(p));
      }
    } catch (e) { /* ignore */ }
  }
  function copyFormState(src, clone) {
    const tag = tagOf(src);
    try {
      if (tag === 'input') { if (src.type !== 'file') clone.value = src.value; clone.checked = src.checked; }
      else if (tag === 'textarea') clone.value = src.value;
      else if (tag === 'select') clone.selectedIndex = src.selectedIndex;
    } catch (e) { /* ignore */ }
  }
  function cloneTree(src, st, depth, inShadow) {
    if (st.count >= st.cap) return null;
    if (src.nodeType === 3) { st.count++; return doc.createTextNode(src.data); }
    if (src.nodeType !== 1) return null;
    const tag = tagOf(src);
    if (DROP_TAGS.has(tag) && !(inShadow && (tag === 'style' || tag === 'link'))) return null;
    st.count++;
    const isSvg = src.namespaceURI === SVG_NS;
    let clone = null, atomic = false;
    if (tag === 'iframe' || tag === 'object' || tag === 'embed' || tag === 'audio') { clone = substitute(src); atomic = true; }   // audio: a live clone would start another playback (§12.6)
    else if (tag === 'canvas' || tag === 'video') {
      const w = depth === 0 ? st.rootW : (src.offsetWidth || (rectOf(src) || {}).width || 1);
      const h = depth === 0 ? st.rootH : (src.offsetHeight || (rectOf(src) || {}).height || 1);
      clone = canvasOf(src, w, h);
      if (clone) { clone.setAttribute('data-crs-cv', String(st.canvases.length)); st.canvases.push({ src, w, h }); }
      else clone = substitute(src);
      atomic = true;
    } else if (tag.indexOf('-') >= 0 && !src.shadowRoot && src.childNodes.length === 0) { clone = substitute(src); atomic = true; }
    else {
      try {
        if (isSvg) clone = doc.createElementNS(SVG_NS, src.localName || tag);   // keep camelCase (foreignObject, linearGradient, clipPath…)
        else if (tag.indexOf('-') >= 0 || (typeof HTMLUnknownElement !== 'undefined' && src instanceof HTMLUnknownElement)) clone = doc.createElement('div');
        else clone = doc.createElement(tag);
      } catch (e) { clone = doc.createElement('div'); }
      copyAttrs(src, clone);
    }
    copyInlineStyle(src, clone, depth === 0);
    st.pairs.push([src, clone, depth, isSvg]);
    if (atomic) return clone;
    if (FORM_TAGS.has(tag)) copyFormState(src, clone);
    if (depth >= st.maxDepth) return clone;
    if (src.shadowRoot) {
      let sh = null;
      try { sh = clone.attachShadow({ mode: 'open' }); } catch (e) { sh = null; }
      if (sh) {
        st.hasShadow = true;
        try { sh.adoptedStyleSheets = src.shadowRoot.adoptedStyleSheets; } catch (e) { /* ignore */ }
        for (const ch of src.shadowRoot.childNodes) { const c = cloneTree(ch, st, depth + 1, true); if (c) sh.append(c); }
      }
    }
    for (const ch of src.childNodes) { const c = cloneTree(ch, st, depth + 1, inShadow); if (c) clone.append(c); }
    if (tag === 'select') copyFormState(src, clone);
    return clone;
  }
  /* Diff computed styles of each original/clone pair and set only the differing
   * properties (important). Returns a replayable plan so sibling pieces (same
   * cloneTree traversal → same pair order) can skip the computed-style reads. */
  function diffStyles(st) {
    const plan = { n: st.pairs.length, tags: [], ops: [] };
    for (let k = 0; k < st.pairs.length; k++) {
      const [orig, clone, depth, isSvg] = st.pairs[k];
      plan.tags.push(tagOf(clone));
      const co = gcs(orig), cc = gcs(clone);
      if (!co || !cc) continue;
      let list = depth <= 2 ? STYLE_FULL : STYLE_STAR;
      if (isSvg && depth > 2) list = list.concat(STYLE_SVG_EXTRA);
      const vals = new Array(list.length);
      for (let i = 0; i < list.length; i++) vals[i] = co.getPropertyValue(list[i]);
      const diffs = [];
      for (let i = 0; i < list.length; i++) { if (vals[i] !== cc.getPropertyValue(list[i])) diffs.push(i); }
      for (const i of diffs) {
        const p = list[i];
        if (depth === 0 && (p === 'transform' || p === 'transform-origin' || p === 'position' || p === 'top' || p === 'left' || p === 'right' || p === 'bottom' || p === 'width' || p === 'height' || p.startsWith('margin'))) continue;
        let v = vals[i];
        if (depth === 0 && p === 'display' && v === 'inline') v = 'inline-block';
        imp(clone, p, v);
        plan.ops.push([k, p, v]);
      }
    }
    return plan;
  }
  function replayPlan(st, plan) {
    if (!plan || plan.n !== st.pairs.length) return false;
    for (let k = 0; k < plan.n; k++) if (tagOf(st.pairs[k][1]) !== plan.tags[k]) return false;
    for (const [k, p, v] of plan.ops) imp(st.pairs[k][1], p, v);
    return true;
  }
  function normalizeRoot(clone) {
    const pairs = [['position', 'relative'], ['inset', 'auto'], ['margin', '0'], ['transform', 'none'], ['translate', 'none'], ['rotate', 'none'], ['scale', 'none'],
      ['transition', 'none'], ['animation', 'none'], ['visibility', 'visible'], ['width', '100%'], ['height', '100%'], ['max-width', 'none'], ['max-height', 'none'],
      ['min-width', '0'], ['min-height', '0'], ['box-sizing', 'border-box'], ['pointer-events', 'none'], ['opacity', '1']];
    for (const [p, v] of pairs) imp(clone, p, v);
  }
  function buildStyledClone(el, rootW, rootH, cap, pieceClipHost, plan) {
    const st = { count: 0, cap, maxDepth: 6, pairs: [], canvases: [], hasShadow: false, rootW, rootH };
    const clone = cloneTree(el, st, 0, false);
    if (!clone) return null;
    pieceClipHost.append(clone);          // lay the clone out inside our subtree first
    st.plan = (plan && replayPlan(st, plan)) ? plan : diffStyles(st);
    normalizeRoot(clone);
    st.root = clone;
    return st;
  }
  function makeTextTransparent(st) {
    for (const [, clone] of st.pairs) { imp(clone, 'color', 'transparent'); imp(clone, '-webkit-text-fill-color', 'transparent'); imp(clone, 'text-shadow', 'none'); }
  }

// ── 65-pieces.js ──
  /* ===================================================================== */
  /* 10. Pieces, physics state, eviction                                      */
  /* ===================================================================== */
  function velocityFor(mode, ix, iy, cx, cy, opts) {
    const dx = cx - ix, dy = cy - iy, dist = Math.hypot(dx, dy);
    const s = Math.sign(dx) || (Math.random() < 0.5 ? -1 : 1);
    let vx, vy, vr;
    if (mode === 'bomb') {
      const R = (opts && opts.radius) || BOMB_RADIUS;   // rocket passes 360 (A7)
      const sp = clamp(900 * (1 - dist / R) + 250, 250, 1100);
      const ux = dist ? dx / dist : 0, uy = dist ? dy / dist : -1;
      vx = ux * sp; vy = uy * sp - 300; vr = rand(-540, 540);
    } else {
      vx = s * rand(140, 300) + rand(-60, 60);
      vy = -rand(300, 680) * (1 - 0.35 * Math.min(dist, 300) / 300);
      vr = s * rand(120, 320);
      if (mode === 'gun') { vx *= 0.5; vy *= 0.5; vr *= 0.5; }
      if (mode === 'collapse' && opts && opts.away) { vx += opts.away.x * 180; vy += opts.away.y * 180; }
    }
    if (opts && opts.word) { const k = 1 + 0.6 * (1 - Math.min(dist, 200) / 200); vx *= k; vy *= k; }
    return { vx, vy, vr, dist };
  }
  let pieceSeq = 0;   // v1.4 §9.3: per-session piece ids for debug.pieceBoxes() below
  function debrisCount() {
    let n = 0;
    for (const p of state.pieces) if (!p.chip) n++;
    return n;
  }
  function addPiece(node, p) {
    const t = now();
    const dpr = Math.min(win.devicePixelRatio || 1, 2);
    p.node = node; p.x = 0; p.y = 0; p.rot = 0; p.resting = false; p.grounded = false;
    p.pid = ++pieceSeq;   // v1.4 §9.3: stable identity, so a test can follow ONE piece across an eviction
    p.bornAt = t; if (p.launchAt == null) p.launchAt = t;
    p.tilt = rand(-12, 12);
    p.gpu = p.w * p.h * dpr * dpr;
    p.big = p.w * p.h > 200000;
    // clip the AABB to the viewport at spawn (A12)
    const W = viewW(), H = viewH();
    p.bb = { minX: Math.max(p.bb.minX, -p.ox), minY: Math.max(p.bb.minY, -p.oy), maxX: Math.min(p.bb.maxX, W - p.ox), maxY: Math.min(p.bb.maxY, H - p.oy) };
    if (p.bb.maxX < p.bb.minX) p.bb.maxX = p.bb.minX; if (p.bb.maxY < p.bb.minY) p.bb.maxY = p.bb.minY;
    node.style.willChange = p.big ? 'auto' : 'transform';
    node.style.contain = 'layout paint';
    node.style.transform = 'translate(0px, 0px) rotate(0deg)';
    const area = (p.bb.maxX - p.bb.minX) * (p.bb.maxY - p.bb.minY);
    const shadow = (!p.word && area > 2500) ? 'drop-shadow(0 3px 4px rgba(0,0,0,.35))' : '';
    if (shadow) node.style.filter = shadow;
    if (!node.isConnected) root.append(node);
    try {
      trackAnim(node.animate([{ filter: (shadow ? shadow + ' ' : '') + 'brightness(1.7)' }, { filter: (shadow ? shadow + ' ' : '') + 'brightness(1)' }], { duration: 90, easing: 'ease-out' }));
    } catch (e) { /* ignore */ }
    // v1.4 §9.1: a piece that is still flying has no lifetime; the hard cut-off only stops one escaping forever
    p.expireAt = 0; p.restedFirstAt = 0; p.jitter = null; p.hardExpireAt = t + DEBRIS_HARD_MS;
    state.pieces.push(p); state.gpuSum += p.gpu;
    scheduleDebrisSweep();
    return p;
  }
  function applyTransform(p) {
    p.node.style.transform = 'translate(' + p.x.toFixed(2) + 'px, ' + p.y.toFixed(2) + 'px) rotate(' + p.rot.toFixed(2) + 'deg)';
  }
  function restPiece(p) {
    p.resting = true; p.grounded = true; p.vx = 0; p.vy = 0; p.vr = 0;
    p.rot = Math.round(p.rot / 180) * 180 + p.tilt;
    applyTransform(p);
    p.node.style.willChange = 'auto'; p.node.style.contain = 'strict';
    /* v1.4 §9.1: the clock starts the moment the piece FIRST settles, jittered so a whole wall does not blink
      * out at once. First, not latest: §9.3 wakes whatever was stacked on a piece that just despawned, and
      * restarting the clock on every re-settle would make a tall pile take a multiple of the lifetime to clear. */
    const life = debrisLife();
    if (!p.restedFirstAt) p.restedFirstAt = now();
    if (p.jitter == null) p.jitter = rand(-DEBRIS_JITTER, DEBRIS_JITTER);
    p.expireAt = life > 0 ? p.restedFirstAt + life + p.jitter : 0;
    scheduleDebrisSweep();
  }
  function wakePiece(p) {
    if (!p.resting) return;
    p.resting = false; p.grounded = false; p.vy = 0;
    p.expireAt = 0;   // v1.4 §9.1: knocked loose again, so it is flying again and its lifetime is off
    p.node.style.willChange = p.big ? 'auto' : 'transform'; p.node.style.contain = 'layout paint';
  }
  /* ── v1.4 §9.3: the support relation, read in the product's own geometry ──
   * restPiece() snaps a chip to a random ±12° tilt, so its DOM bounding box is the axis-aligned hull of a
   * rotated rectangle — several pixels taller than the chip itself. Asking "is B resting on A?" from
   * getBoundingClientRect() therefore misses real pairs at random. evictPieces() wakes a piece from
   * p.ox/p.x/p.bb, and this hook hands a test exactly those numbers plus a stable per-piece id, so the
   * §9.4.4 check can follow one identified piece across the eviction of the piece under it. */
  debug.pieceBoxes = () => state.pieces.map((p) => ({
    pid: p.pid,
    resting: !!p.resting,
    l: p.ox + p.x + p.bb.minX,
    r: p.ox + p.x + p.bb.maxX,
    top: p.oy + p.y + p.bb.minY,
    bottom: p.oy + p.y + p.bb.maxY,
  }));
  /* Retire ONE identified piece on the next sweep, as if its §9.1 lifetime had just run out. §9.4.1 already
   * covers the clock; this is how §9.3's "wake whatever was stacked on it" is checked without the pieces above
   * expiring in the very same batch. */
  debug.expirePiece = (pid) => {
    for (const p of state.pieces) {
      if (p.pid !== pid) continue;
      p.expireAt = now() - 1;
      p.hardExpireAt = p.expireAt;
      scheduleDebrisSweep();
      return pid;
    }
    return null;
  };
  /* ── v1.4 §9: debris stops piling up ──
   * The floor used to fill with debris that only the 160-piece cap or a manual restore ever cleared. Now a piece
   * that has come to rest fades out after `debrisLifeMs` (0 = the old behaviour), while the original stays hidden
   * — the page is NOT put back, only the litter is taken away. Under memory pressure a lifetime of "forever" is
   * still capped, because that is exactly when the floor is fullest. */
  function debrisLife() {
    const pressure = state.pieces.length > CAP * 0.75 || state.gpuSum > GPU_BUDGET * 0.75;
    const want = state.debrisLifeMs;
    if (pressure) return want > 0 ? Math.min(want, DEBRIS_PERF_MS) : DEBRIS_PERF_MS;
    return want;
  }
  function scheduleDebrisSweep() {
    if (state.debrisTimer || !state.active) return;
    state.debrisTimer = later(debrisSweep, DEBRIS_SWEEP_MS);
  }
  function debrisSweep() {
    state.debrisTimer = 0;
    if (!state.active || !state.pieces.length) return;
    const t = now();
    const victims = [];
    for (const p of state.pieces) {
      if (victims.length >= DEBRIS_BATCH) break;   // §9.1: at most twelve at a time, so no frame carries them all
      if ((p.expireAt && t >= p.expireAt) || (p.hardExpireAt && t >= p.hardExpireAt)) victims.push(p);
    }
    if (victims.length) evictPieces(victims, false, { dur: DEBRIS_FADE_MS, shrink: true });
    scheduleDebrisSweep();
  }
  /* opts (v1.4 §9.1): { dur, shrink } — a lifetime expiry fades over 500 ms AND shrinks to 0.88. The scale is a
   * separate composite:'add' animation so it stacks onto the inline translate/rotate instead of replacing it. */
  function evictPieces(victims, silent, opts) {
    if (!victims.length) return;
    const dur = (opts && opts.dur) || 350;
    const shrink = !!(opts && opts.shrink);
    const evictedBoxes = [];
    for (const p of victims) {
      const i = state.pieces.indexOf(p); if (i >= 0) state.pieces.splice(i, 1);
      state.gpuSum -= p.gpu;
      evictedBoxes.push({ l: p.ox + p.x + p.bb.minX, r: p.ox + p.x + p.bb.maxX, top: p.oy + p.y + p.bb.minY });
      const node = p.node;
      try { node.classList.remove('crs-debris', 'crs-chip'); node.classList.add('crs-fading'); } catch (e) { /* ignore */ }
      if (silent) { try { node.remove(); } catch (e) { /* ignore */ } continue; }
      let done = false;
      const kill = () => { if (done) return; done = true; try { node.remove(); } catch (e) { /* ignore */ } };
      try {
        const a = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: 'ease-in', fill: 'forwards' });
        trackAnim(a); a.addEventListener('finish', kill); a.addEventListener('cancel', kill);
        if (shrink && !reducedMotion()) trackAnim(node.animate([{ transform: 'scale(1)' }, { transform: 'scale(.88)' }], { duration: dur, easing: 'ease-in', fill: 'forwards', composite: 'add' }));
      } catch (e) { /* ignore */ }
      later(kill, dur + 150);
    }
    // wake resting pieces that were supported by an evicted piece (A1)
    for (const q of state.pieces) {
      if (!q.resting) continue;
      const ql = q.ox + q.x + q.bb.minX, qr = q.ox + q.x + q.bb.maxX, qb = q.oy + q.y + q.bb.maxY;
      for (const b of evictedBoxes) {
        const ov = Math.min(qr, b.r) - Math.max(ql, b.l);
        if (ov >= 0.4 * Math.min(qr - ql, b.r - b.l) && qb <= b.top + 1) { wakePiece(q); break; }
      }
    }
    kick();
  }
  /* GPU cost (w·h·dpr², as addPiece charges it) of a batch of [node, p] pairs about to be added. */
  function batchGpu(nodes) {
    const dpr = Math.min(win.devicePixelRatio || 1, 2);
    let s = 0;
    for (const [, p] of nodes) s += p.w * p.h * dpr * dpr;
    return s;
  }
  function enforceCap(incoming, incomingGpu) {
    let need = state.pieces.length + incoming - CAP;
    let gpu = state.gpuSum + (incomingGpu || 0);   // include the batch being added, not only what is live
    const overGpu = gpu > GPU_BUDGET;
    if (need <= 0 && !overGpu) return;
    const t = now();
    const sorted = state.pieces.slice().sort((a, b) => ((b.resting ? 1 : 0) - (a.resting ? 1 : 0)) || (a.bornAt - b.bornAt));
    const victims = [];
    const take = (p) => { victims.push(p); gpu -= p.gpu; };
    for (const p of sorted) { if (victims.length >= need && gpu <= GPU_BUDGET) break; if (t - p.bornAt >= MIN_EVICT_AGE) take(p); }
    // The cap is hard: if everything is younger than 800 ms, evict the oldest anyway.
    if (victims.length < need) { for (const p of sorted) { if (victims.length >= need) break; if (!victims.includes(p)) take(p); } }
    evictPieces(victims, false);
  }
  function makeWrapper(rect, ow, oh, sx, sy, poly, clipped) {
    const piece = mk('div', 'crs-piece crs-debris');
    piece.style.left = px(rect.left); piece.style.top = px(rect.top);
    piece.style.width = px(rect.width); piece.style.height = px(rect.height);
    piece.style.transformOrigin = px(poly.cx * sx) + ' ' + px(poly.cy * sy);
    const clip = mk('div', 'crs-clip');
    clip.style.width = px(ow); clip.style.height = px(oh);
    if (clipped) clip.style.clipPath = polyToClip(poly);
    if (Math.abs(sx - 1) > 0.02 || Math.abs(sy - 1) > 0.02) { clip.style.transform = 'scale(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ')'; clip.style.transformOrigin = '0 0'; }
    piece.append(clip);
    return { piece, clip };
  }

// ── 70-break.js ──
  /* ===================================================================== */
  /* 11. Breaking elements                                                    */
  /* ===================================================================== */
  function hideOriginal(el) {
    const saved = [];
    const hideOne = (node) => {
      for (const p of ['visibility', 'opacity', 'pointer-events']) {
        saved.push({ node, prop: p, value: node.style.getPropertyValue(p), priority: node.style.getPropertyPriority(p) });
      }
      imp(node, 'visibility', 'hidden'); imp(node, 'opacity', '0'); imp(node, 'pointer-events', 'none');
    };
    hideOne(el);
    try {
      for (const ch of el.children) { const s = gcs(ch); if (s && s.visibility === 'visible') hideOne(ch); }
    } catch (e) { /* ignore */ }
    try { el.setAttribute('data-crs-broken', '1'); } catch (e) { /* ignore */ }
    const rec = { el, saved, mo: null, reapplied: 0, wasPlaying: false };
    try {
      rec.mo = new MutationObserver(() => {
        if (rec.reapplied >= 5 || !state.active) return;
        if (el.style.getPropertyValue('visibility') === 'hidden') return;
        rec.reapplied++;
        imp(el, 'visibility', 'hidden'); imp(el, 'opacity', '0'); imp(el, 'pointer-events', 'none');
      });
      rec.mo.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    } catch (e) { rec.mo = null; }
    state.broken.push(rec);
    return rec;
  }
  function textDominant(el) {
    if (el.shadowRoot) return false;
    const tag = tagOf(el);
    if (REPLACED_TAGS.has(tag) || tag === 'table') return false;
    const txt = (el.textContent || '').trim();
    if (txt.length < 2) return false;
    try { if (el.querySelector('img,video,canvas,svg,iframe,table,input,textarea,select,object,embed,picture')) return false; } catch (e) { return false; }
    if (countDescendants(el, 41) > 40) return false;
    if (txt.split(/\s+/).length > 80) return false;
    return true;
  }
  function boxVisible(el) {
    const s = gcs(el); if (!s) return false;
    if (alphaOf(s.backgroundColor) > 0) return true;
    if (s.backgroundImage && s.backgroundImage !== 'none') return true;
    return ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'].some((p) => parseFloat(s.getPropertyValue(p)) > 0);
  }
  function pieceCount(el, mode, rect, descendants, forced) {
    if (forced != null) return forced;
    const area = rect.width * rect.height;
    const tag = tagOf(el);
    if (area < 1200) return 1;
    if (state.lastBreakMs > 25) return 1;
    if (MEDIA_TAGS.has(tag) && descendants <= 1) {
      if (area > 300000) return 2;
      return mode === 'hammer' ? 6 : (mode === 'bomb' ? 8 : 2);
    }
    const big = area > 300000 || descendants > 120;
    let n;
    if (mode === 'bomb') n = area <= 160000 ? 6 : (area <= 600000 ? 4 : (area <= 1200000 ? 2 : 1));
    else if (mode === 'gun' || mode === 'collapse') n = area <= 600000 ? 2 : 1;
    else n = (area <= 160000 && descendants <= 120) ? 4 : (area <= 600000 ? 2 : 1);
    if (big) n = Math.min(n, 2);
    return n;
  }
  function spawnGeometric(el, rect, ix, iy, mode, n, opts) {
    const ow = (el.offsetWidth || rect.width) || 1, oh = (el.offsetHeight || rect.height) || 1;
    const sx = rect.width / ow || 1, sy = rect.height / oh || 1;
    const sl = opts.splitLine ? { angle: opts.splitLine.angle, cx: (opts.splitLine.cx - rect.left) / sx, cy: (opts.splitLine.cy - rect.top) / sy } : null;
    const polys = splitRect(ow, oh, n, (ix - rect.left) / sx, (iy - rect.top) / sy, sl);
    const cap = opts.cloneCap || (n >= 4 ? 150 : 400);
    // Every piece gets its own cloneTree (a deep DOM copy would carry style attributes,
    // which a strict style-src CSP rejects on insertion); the computed-style diff of the
    // first piece is replayed on its siblings.
    let plan = null, made = 0;
    const nodes = [];
    for (let i = 0; i < polys.length; i++) {
      const poly = polys[i];
      const { piece, clip } = makeWrapper(rect, ow, oh, sx, sy, poly, polys.length > 1);
      root.append(piece);
      const b = buildStyledClone(el, ow, oh, cap, clip, plan);
      if (!b) { piece.remove(); continue; }
      plan = b.plan;
      if (opts.textTransparent) makeTextTransparent(b);
      if (opts.burnt) clip.style.filter = BURNT_FILTER;   // flame (A9): on the clip node, never the wrapper
      const cx = rect.left + poly.cx * sx, cy = rect.top + poly.cy * sy;
      const v = velocityFor(mode, ix, iy, cx, cy, opts);
      const p = { ox: rect.left, oy: rect.top, w: rect.width, h: rect.height, vx: v.vx, vy: v.vy, vr: v.vr, cx: poly.cx * sx, cy: poly.cy * sy,
        bb: { minX: poly.minX * sx, minY: poly.minY * sy, maxX: poly.maxX * sx, maxY: poly.maxY * sy } };
      nodes.push([piece, p]); made++;
    }
    enforceCap(nodes.length, batchGpu(nodes));
    for (const [node, p] of nodes) addPiece(node, p);
    return made;
  }

  /* --- text shattering (§12.2 / A23) --- */
  const CJK_RE = /[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯豈-﫿]/;
  function graphemes(text) {
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        return Array.from(seg.segment(text), (s) => s.segment);
      }
    } catch (e) { /* fall through */ }
    return Array.from(text);
  }
  function tokenize(text, perChar) {
    const out = [];
    if (perChar) {
      let idx = 0;
      for (const g of graphemes(text)) { if (g.trim()) out.push({ s: idx, e: idx + g.length }); idx += g.length; }
      return out;
    }
    const re = /\S+/g; let m;
    while ((m = re.exec(text))) {
      const tok = m[0];
      if (tok.length >= 12 && (tok.match(CJK_RE) || []).length && !/\s/.test(tok) && CJK_RE.test(tok.slice(0, 1))) {
        let i = 0;
        const gs = graphemes(tok);
        while (i < gs.length) { const k = Math.min(gs.length - i, randInt(2, 4)); const chunk = gs.slice(i, i + k).join(''); const start = m.index + gs.slice(0, i).join('').length; out.push({ s: start, e: start + chunk.length }); i += k; }
      } else out.push({ s: m.index, e: m.index + tok.length });
    }
    return out;
  }
  function intersectRect(a, b) {
    const l = Math.max(a.left, b.left), t = Math.max(a.top, b.top), r = Math.min(a.right, b.right), btm = Math.min(a.bottom, b.bottom);
    return { left: l, top: t, right: r, bottom: btm, width: Math.max(0, r - l), height: Math.max(0, btm - t) };
  }
  function clipRectFor(el, rect) {
    const s = gcs(el);
    let clip = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    if (s) {
      clip = { left: rect.left + (parseFloat(s.borderLeftWidth) || 0), top: rect.top + (parseFloat(s.borderTopWidth) || 0),
        right: rect.right - (parseFloat(s.borderRightWidth) || 0), bottom: rect.bottom - (parseFloat(s.borderBottomWidth) || 0) };
    }
    let a = parentOf(el), guard = 0;
    while (a && a !== docEl && a !== doc.body && guard++ < 60) {
      const as = gcs(a);
      if (as && (as.overflowX !== 'visible' || as.overflowY !== 'visible')) { const ar = rectOf(a); if (ar) clip = intersectRect(clip, ar); break; }
      a = parentOf(a);
    }
    clip = intersectRect(clip, { left: 0, top: 0, right: viewW(), bottom: viewH() });
    return clip;
  }
  /* Light text (relative luminance > 0.6, alpha ≥ 0.5) — such words vanish over a light page once they leave their dark box. */
  function isLightColor(color) {
    const m = /rgba?\(([^)]+)\)/.exec(color || '');
    if (!m) return false;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || (p.length >= 4 && p[3] < 0.5)) return false;
    const lin = (c) => { c = clamp(c, 0, 255) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]) > 0.6;
  }
  /* A23 piece styling. `scaleY` = rect.height / offsetHeight of the target (≠ 1 under transform: scale /
   * html zoom ancestors): the span lives in our unscaled root, so the font metrics themselves are scaled
   * (font-size, letter-/word-spacing) instead of a transform — the physics transform (translate+rotate)
   * is rewritten every frame and would clobber a scale() anyway. */
  function styleWordPiece(span, cs, rect, scaleY) {
    const k = (isFinite(scaleY) && scaleY > 0) ? scaleY : 1;
    const len = (v) => { const n = parseFloat(v); return (k !== 1 && isFinite(n)) ? px(n * k) : v; };
    try {
      span.style.font = cs.font;
      span.style.fontStyle = cs.fontStyle; span.style.fontVariant = cs.fontVariant; span.style.fontWeight = cs.fontWeight;
      span.style.fontSize = len(cs.fontSize); span.style.fontFamily = cs.fontFamily;
      span.style.fontStretch = cs.fontStretch; span.style.fontFeatureSettings = cs.fontFeatureSettings;
      span.style.fontVariationSettings = cs.fontVariationSettings; span.style.fontOpticalSizing = cs.fontOpticalSizing;
      span.style.lineHeight = px(rect.height);
      span.style.letterSpacing = len(cs.letterSpacing); span.style.wordSpacing = len(cs.wordSpacing);
      span.style.textRendering = cs.textRendering; span.style.fontKerning = cs.fontKerning;
      span.style.color = cs.color; span.style.webkitTextFillColor = cs.webkitTextFillColor;
      span.style.textDecoration = cs.textDecoration; span.style.textDecorationColor = cs.textDecorationColor;
      span.style.textTransform = cs.textTransform;
      span.style.textShadow = (cs.textShadow === 'none' && isLightColor(cs.color)) ? '0 0 2px rgba(0,0,0,.55)' : cs.textShadow;
      span.style.webkitTextStroke = cs.webkitTextStroke;
    } catch (e) { /* ignore */ }
  }
  function spawnWordPieces(el, rect, ix, iy, mode, opts) {
    const txt = (el.textContent || '').trim();
    const tag = tagOf(el);
    const len = graphemes(txt).length;
    const perChar = !opts.forceWords && ((tag === 'h1' || tag === 'h2' || tag === 'h3') || len <= 24) && len <= 60;
    const clip = clipRectFor(el, rect);
    const range = doc.createRange();
    const csCache = new Map();
    const items = [];
    const maxTokens = opts.maxTokens || 120;
    let walker;
    try { walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT); } catch (e) { return 0; }
    let node;
    while ((node = walker.nextNode()) && items.length < maxTokens) {
      const parent = node.parentElement; if (!parent) continue;
      const ptag = tagOf(parent); if (ptag === 'script' || ptag === 'style') continue;
      let cs = csCache.get(parent);
      if (!cs) { cs = gcs(parent); if (!cs) continue; csCache.set(parent, cs); }
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const text = node.data; if (!text || !text.trim()) continue;
      for (const tok of tokenize(text, perChar)) {
        if (items.length >= maxTokens) break;
        let rects;
        try { range.setStart(node, tok.s); range.setEnd(node, tok.e); rects = range.getClientRects(); } catch (e) { continue; }
        if (!rects || !rects.length) continue;
        if (rects.length === 1) { items.push({ node, s: tok.s, e: tok.e, rect: rects[0], cs }); continue; }
        // wrapped token: one piece per client rect (≤ 3), advancing the end offset character by character
        let a = tok.s, emitted = 0;
        while (a < tok.e && emitted < 3) {
          let b = a + 1, last = null;
          try {
            range.setStart(node, a); range.setEnd(node, b); last = range.getClientRects()[0];
            while (b < tok.e) { range.setEnd(node, b + 1); const rs = range.getClientRects(); if (rs.length > 1) break; b++; last = rs[0]; }
          } catch (e) { break; }
          if (last) { items.push({ node, s: a, e: b, rect: last, cs }); emitted++; }
          a = b;
        }
      }
    }
    if (!items.length) return 0;
    const sy = (el.offsetHeight && rect.height) ? rect.height / el.offsetHeight : 1;
    const scaled = Math.abs(sy - 1) > 0.02;
    const made = [];
    for (const it of items) {
      const r = it.rect;
      if (r.width <= 0 || r.height <= 0) continue;
      const vis = intersectRect(r, clip);
      if (vis.width * vis.height < 0.5 * r.width * r.height) continue;
      const clipped = vis.width < r.width - 0.5 || vis.height < r.height - 0.5;
      const span = mk('span', 'crs-debris crs-word');
      span.textContent = it.node.data.slice(it.s, it.e);
      span.style.left = px(vis.left); span.style.top = px(vis.top); span.style.width = px(vis.width); span.style.height = px(vis.height);
      styleWordPiece(span, it.cs, r, scaled ? sy : 1);
      if (clipped) span.style.overflow = 'hidden';
      if (opts.burnt) span.style.filter = BURNT_FILTER;
      const cx = vis.left + vis.width / 2, cy = vis.top + vis.height / 2;
      const v = velocityFor(mode, ix, iy, cx, cy, Object.assign({ word: true }, opts));
      const p = { ox: vis.left, oy: vis.top, w: vis.width, h: vis.height, vx: v.vx, vy: v.vy, vr: v.vr, cx: vis.width / 2, cy: vis.height / 2,
        bb: { minX: 0, minY: 0, maxX: vis.width, maxY: vis.height }, word: true, launchAt: now() + Math.min(v.dist, 240) / 2 };
      made.push([span, p]);
    }
    if (!made.length) return 0;
    enforceCap(made.length, batchGpu(made));
    for (const [span, p] of made) addPiece(span, p);
    return made.length;
  }
  function spawnFieldSpill(el, rect, ix, iy, mode, opts) {
    const tag = tagOf(el);
    let value = '';
    try { value = String(el.value || ''); } catch (e) { value = ''; }
    if (!value.trim() || (tag === 'input' && el.type === 'password')) return 0;
    const cs = gcs(el); if (!cs) return 0;
    let meas;
    try { meas = doc.createElement('canvas').getContext('2d'); meas.font = cs.font || (cs.fontSize + ' ' + cs.fontFamily); } catch (e) { return 0; }
    const fontSize = parseFloat(cs.fontSize) || 14;
    const lineH = tag === 'textarea' ? (parseFloat(cs.lineHeight) || fontSize * 1.2) : fontSize * 1.2;
    const x0 = rect.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
    const xMax = rect.right - (parseFloat(cs.borderRightWidth) || 0) - (parseFloat(cs.paddingRight) || 0);
    let y = tag === 'textarea' ? rect.top + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0) : rect.top + (rect.height - lineH) / 2;
    const spaceW = meas.measureText(' ').width;
    const lines = tag === 'textarea' ? value.split('\n') : [value];
    const made = [];
    for (const line of lines) {
      if (made.length >= 40 || y + lineH > rect.bottom + 1) break;
      let x = x0;
      for (const tok of line.split(/\s+/).filter(Boolean)) {
        if (made.length >= 40) break;
        const w = meas.measureText(tok).width;
        if (x + w > xMax + 1) break;
        const span = mk('span', 'crs-debris crs-word');
        span.textContent = tok;
        span.style.left = px(x); span.style.top = px(y); span.style.width = px(w); span.style.height = px(lineH);
        styleWordPiece(span, cs, { height: lineH }, 1);
        if (opts && opts.burnt) span.style.filter = BURNT_FILTER;
        const v = velocityFor(mode, ix, iy, x + w / 2, y + lineH / 2, { word: true });
        made.push([span, { ox: x, oy: y, w, h: lineH, vx: v.vx, vy: v.vy, vr: v.vr, cx: w / 2, cy: lineH / 2, bb: { minX: 0, minY: 0, maxX: w, maxY: lineH }, word: true, launchAt: now() + Math.min(v.dist, 240) / 2 }]);
        x += w + spaceW;
      }
      y += lineH;
    }
    if (!made.length) return 0;
    enforceCap(made.length, batchGpu(made));
    for (const [span, p] of made) addPiece(span, p);
    return made.length;
  }

  function breakElement(el, ix, iy, opts) {
    opts = opts || {};
    const mode = opts.mode || WEAPONS[state.weapon].kind;
    if (!el || !el.isConnected || el.hasAttribute('data-crs-broken')) return false;
    cancelAnimsOf(el);
    const rect = rectOf(el);
    if (!rect || rect.width < 1 || rect.height < 1) return false;
    const t0 = now();
    const tag = tagOf(el);
    const descendants = countDescendants(el, 201);
    const wantText = opts.textSplit !== false && textDominant(el);
    let made = 0;
    if (tag === 'video') { try { opts.wasPlaying = !el.paused; el.pause(); } catch (e) { /* ignore */ } }
    if (wantText) {
      // box (background/border) falls as one piece underneath; words fall on top
      if (boxVisible(el)) made += spawnGeometric(el, rect, ix, iy, mode, 1, Object.assign({}, opts, { textTransparent: true }));
      const words = spawnWordPieces(el, rect, ix, iy, mode, opts);
      if (!words && !made) made += spawnGeometric(el, rect, ix, iy, mode, pieceCount(el, mode, rect, descendants, opts.pieces), opts);
      made += words;
    } else {
      made += spawnGeometric(el, rect, ix, iy, mode, pieceCount(el, mode, rect, descendants, opts.pieces), opts);
      if ((tag === 'input' || tag === 'textarea')) made += spawnFieldSpill(el, rect, ix, iy, mode, opts);
    }
    // hide the original in the same synchronous task (A17)
    const rec = hideOriginal(el);
    rec.wasPlaying = !!opts.wasPlaying;
    state.lastBreakMs = now() - t0;
    state.lastBreakPieces = made;
    // v1.2 A8 / A10: the single kill hook — hostile → kill (score max / ×1.5 clutch), else round(max/4) while combat is on
    try {
      const max = hpOf(el).max;
      if (state.hostiles.has(el)) hostileKilled(el, max);
      else if (state.combat) { state.player.score += Math.round(max / 4); updatePlayerHud(); }
    } catch (e) { state.lastError = String((e && e.stack) || e); }
    kick();
    return made > 0;
  }

  /* --- durability / damage reactions (A22) --- */
  function reactDamage(el, ix, iy, rect) {
    const s = gcs(el); if (!s) return;
    if (s.display === 'inline' || s.display.startsWith('table-')) return;
    let all = [];
    try { all = el.querySelectorAll('*'); } catch (e) { all = []; }
    if (all.length > 200) return;
    for (let i = 0; i < all.length; i++) { const ps = gcs(all[i]); if (ps && (ps.position === 'fixed' || ps.position === 'sticky')) return; }
    cancelAnimsOf(el);
    const tag = tagOf(el);
    const dent = FORM_TAGS.has(tag) || tag === 'summary' || el.getAttribute('role') === 'button';
    try {
      let a;
      if (dent) {
        const rz = (Math.random() < 0.5 ? -2 : 2);
        a = el.animate([{ transform: 'scale(1) rotate(0deg)' }, { transform: 'scale(.93) rotate(' + rz + 'deg)' }, { transform: 'scale(1) rotate(0deg)' }], { duration: 180, composite: 'add', easing: 'ease-out' });
      } else {
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        let dx = ix - cx, dy = iy - cy; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
        const amp = clamp(0.02 * Math.sqrt(rect.width * rect.height), 3, 10);
        const rotA = 1.5 * Math.min(1, 240 / Math.max(rect.width, rect.height, 1));
        const offs = [1, -0.6, 0.3, -0.12, 0];
        const kf = offs.map((k, i) => ({ transform: 'translate(' + px(dx * amp * k) + ', ' + px(dy * amp * k) + ') rotate(' + (i === 4 ? 0 : (i % 2 ? -rotA : rotA)).toFixed(2) + 'deg)', easing: 'ease-out' }));
        a = el.animate(kf, { duration: 260, composite: 'add' });
      }
      trackAnim(a);
    } catch (e) { /* ignore */ }
  }

// ── 71-weapon-helpers.js ──
// ── shared combat helpers: crit/damage rolls (v1.3 §1: no power multiplier), cooldown gate, HUD weapon-button lookup ──
  /* ===================================================================== */
  /* 12. Weapons (v1.1): damage roll, hit feedback, the nine fire() entries, actions   */
  /* ===================================================================== */
  function rollCrit() { return debug.forceCrit ? true : (debug.noCrit ? false : Math.random() < 0.1); }
  function rollSniperCrit(scoped) { return debug.forceCrit ? true : (debug.noCrit ? false : Math.random() < (scoped ? 0.25 : 0.1)); }   // 헤드샷 (v1.2 §2)
  function rollDamage(base, crit) { return Math.max(1, Math.round(base * (crit ? 2 : 1))); }   // v1.3 §1: the power multiplier is gone
  function reducedMotion() { try { return win.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function weaponBtn(id) { return (hudEls.weaponBtns && hudEls.weaponBtns[id]) || null; }
  function willBreak(el, dmg) { if (!el) return false; const r = state.hp.get(el); return (r ? r.hp : hpMax(el)) - dmg <= 0; }

// ── 73-hit-resolution.js ──
// ── hit resolution: floating damage numbers (v1.3 §3.5: opts.size), hit tint, hold-window aggregation, applyHit, bullet chips, AoE candidates/falloff ──
  /* --- cooldown (A3): one global timestamp, set only when an attack actually happened --- */
  function onCooldown() { return !debug.noCooldown && now() < state.cooldownUntil; }
  function startCooldown(id, ms) {
    if (!(ms > 0) || debug.noCooldown) return;   // nothing recorded while cooldowns are disabled (a later flip starts clean)
    state.cooldownUntil = now() + ms;
    if (ms < 500) return;   // the dim reads as a real timer only on axe / bomb / rocket / collapse
    try { const b = weaponBtn(id); if (b) trackAnim(b.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: ms, easing: 'linear' })); } catch (e) { /* ignore */ }
  }
  function cooldownFeedback() {   // a click during cooldown is never silent
    sfx('clack');
    if (reducedMotion()) return;
    try { const b = weaponBtn(state.weapon); if (b) trackAnim(b.animate([{ borderColor: '#ff6b6b' }, { borderColor: 'rgba(255,255,255,.1)' }], { duration: 120 })); } catch (e) { /* ignore */ }
  }

  /* --- floating damage numbers (A5 item 1): "-65", crit "-130!" in gold, rise 44 px over 650 ms, cap 40 --- */
  function dmgText(n, dmg, crit, tag) { n.textContent = (tag ? tag + ' ' : '') + '-' + dmg + (crit ? '!' : ''); }
  /* opts (v1.2): { tag: '헤드샷!' prefix, color, text: literal text instead of "-dmg" (kill / player damage) }
   * opts.size (v1.3 §3.5): explicit px — player damage is drawn at 24 px, not the 14 px of a chip of page. */
  function spawnDmg(x, y, dmg, crit, opts) {
    if (!root) return null;
    opts = opts || {};
    const n = mk('div', 'crs-dmg');
    if (opts.text != null) n.textContent = opts.text; else dmgText(n, dmg, crit, opts.tag);
    n.style.left = px(x); n.style.top = px(y);
    n.style.font = '700 ' + (opts.size || (crit ? 18 : 14)) + 'px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    n.style.color = opts.color || (crit ? '#ffd166' : '#fff');
    n.style.textShadow = '0 1px 2px rgba(0,0,0,.8)';
    n.style.transform = 'translate(-50%, -50%)';
    root.append(n);
    state.dmgNodes.push(n);
    while (state.dmgNodes.length > 40) { const old = state.dmgNodes.shift(); try { old.remove(); } catch (e) { /* ignore */ } }
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } const i = state.dmgNodes.indexOf(n); if (i >= 0) state.dmgNodes.splice(i, 1); };
    try {
      const base = 'translate(-50%, -50%) ';
      const kf = crit
        ? [{ transform: base + 'translateY(0px) scale(1.4)', opacity: 1, offset: 0 }, { transform: base + 'translateY(-8px) scale(1)', opacity: 0.95, offset: 0.18 }, { transform: base + 'translateY(-44px) scale(1)', opacity: 0, offset: 1 }]
        : [{ transform: base + 'translateY(0px)', opacity: 1 }, { transform: base + 'translateY(-44px)', opacity: 0 }];
      const a = trackAnim(n.animate(kf, { duration: 650, easing: 'ease-out', fill: 'forwards' }));
      a.addEventListener('finish', kill);
    } catch (e) { /* ignore */ }
    later(kill, 1500);
    return n;
  }
  /* Where a number goes: pointer ± 8 px (click), alternating 24 px left/right of the pointer (hold windows; ≥ 42 px
   * between consecutive centres so a 25 px glyph run never collides with the previous window's number),
   * centre of rect ∩ viewport nudged 10 px toward the blast / slash (AoE, slash). */
  function dmgPos(el, ix, iy, opts) {
    if (opts.aoe || opts.slash) {
      const r = rectOf(el);
      if (r) {
        const v = intersectRect(r, { left: 0, top: 0, right: viewW(), bottom: viewH() });
        let x = v.left + v.width / 2, y = v.top + v.height / 2;
        if (opts.toward) { const dx = opts.toward.x - x, dy = opts.toward.y - y, L = Math.hypot(dx, dy); if (L > 1) { x += dx / L * 10; y += dy / L * 10; } }
        return { x: x + rand(-8, 8), y: y + rand(-8, 8) };
      }
    }
    if (opts.win) return { x: ix + opts.win.side * 24 + rand(-3, 3), y: iy - 4 + rand(-3, 3) };
    return { x: ix + rand(-8, 8), y: iy + rand(-8, 8) };
  }

  /* --- hit tint (A5 item 2): a radial splash on the element rect, one node per element --- */
  function tintGradient(rect, ix, iy) {
    const R = clamp(0.5 * Math.sqrt(Math.max(1, rect.width * rect.height)), 60, 220);
    return 'radial-gradient(circle at ' + px(ix - rect.left) + ' ' + px(iy - rect.top) + ', rgba(229,72,77,.30) 0px, rgba(229,72,77,.22) 40%, rgba(229,72,77,0) ' + px(R) + ')';
  }
  function removeTint(el) {
    const t = state.tints.get(el);
    if (!t) return;
    state.tints.delete(el);
    untrack(t.timer);
    try { if (t.anim) t.anim.cancel(); } catch (e) { /* ignore */ }
    try { t.node.remove(); } catch (e) { /* ignore */ }
  }
  function tintFade(el, t, from) {
    const n = t.node;
    if (reducedMotion()) { n.style.opacity = '0.1'; t.timer = later(() => removeTint(el), 180); return; }
    n.style.opacity = String(from);
    try {
      t.anim = trackAnim(n.animate([{ opacity: from }, { opacity: 0 }], { duration: 180, easing: 'ease-out', fill: 'forwards' }));
      t.anim.addEventListener('finish', () => removeTint(el));
    } catch (e) { /* ignore */ }
    t.timer = later(() => removeTint(el), 400);
  }
  function showTint(el, rect, ix, iy, hold) {
    if (!root) return;
    let t = state.tints.get(el);
    if (!t) {
      const n = mk('div', 'crs-hit');
      const s = gcs(el); if (s) n.style.borderRadius = s.borderRadius;
      root.append(n);
      t = { node: n, anim: null, timer: 0, hold: false };
      state.tints.set(el, t);
    }
    const n = t.node;
    n.style.left = px(rect.left); n.style.top = px(rect.top); n.style.width = px(rect.width); n.style.height = px(rect.height);
    n.style.background = tintGradient(rect, ix, iy);
    if (hold && t.hold) return;   // persistent hold tint: re-centred, never re-flashed
    try { if (t.anim) { t.anim.cancel(); t.anim = null; } } catch (e) { /* ignore */ }
    untrack(t.timer); t.timer = 0;
    if (hold) { t.hold = true; n.style.opacity = reducedMotion() ? '0.1' : '0.14'; return; }
    t.hold = false;
    tintFade(el, t, 1);
  }
  function moveTint(el, rect, ix, iy) {   // hold ticks between fx windows: the gradient centre follows the pointer
    const t = state.tints.get(el);
    if (!t || !t.hold) return;
    t.node.style.left = px(rect.left); t.node.style.top = px(rect.top); t.node.style.width = px(rect.width); t.node.style.height = px(rect.height);
    t.node.style.background = tintGradient(rect, ix, iy);
  }
  function fadeTint(el) {   // hold released / target changed
    const t = state.tints.get(el);
    if (!t || !t.hold) return;
    t.hold = false;
    tintFade(el, t, reducedMotion() ? 0.1 : 0.14);
  }

  /* --- hold aggregation windows (A4 / A5): one crit roll + one number + one HUD line per 150 ms per element --- */
  function holdWindow(el) {
    const t = now();
    let w = state.dmgAgg.get(el);
    if (w && t - w.at >= HOLD_WINDOW) { flushWindow(el, w); w = null; }
    if (!w) {
      const rec = hpOf(el);
      const crit = rollCrit();
      if (crit) { state.crits++; sfx('crit', { gain: 0.7 }); }   // one audible cue per crit window (A4); the per-tick gun sound stays plain
      rec.side = rec.side === 1 ? -1 : 1;
      w = { el, at: t, sum: 0, crit, side: rec.side, node: null };
      state.dmgAgg.set(el, w);
      if (state.hold) state.hold.open.add(el);
    }
    return w;
  }
  function flushWindow(el, w) {
    if (state.dmgAgg.get(el) === w) state.dmgAgg.delete(el);
    if (state.hold) state.hold.open.delete(el);
    const rec = state.hp.get(el);
    if (w && rec && w.sum > 0) hudLastHit(el, w.sum, rec.hp, rec.max, w.crit);
  }

  /* applyHit — the single damage sink. opts: { crit, hold, win, aoe, slash, toward, pieces, textSplit, splitLine,
   * burnt, radius }. Returns 'broken' | 'damaged' | 'none'. */
  function applyHit(el, dmg, kind, ix, iy, opts) {
    opts = opts || {};
    if (!el) return 'none';
    try { if (el.hasAttribute('data-crs-broken')) return 'none'; } catch (e) { return 'none'; }   // broken meanwhile (staggered AoE, hold tick, collapse chain)
    const rec = hpOf(el);
    rec.hp -= dmg;
    state.damageDealt += dmg;
    const crit = !!opts.crit;
    const broken = rec.hp <= 0;
    const win = opts.hold ? opts.win : null;
    if (win) {
      win.sum += dmg;
      if (win.node && win.node.isConnected) dmgText(win.node, win.sum, win.crit);
      else { const p = dmgPos(el, ix, iy, opts); win.node = spawnDmg(p.x, p.y, win.sum, win.crit); }
      if (broken) flushWindow(el, win);
    } else {
      if (crit) state.crits++;
      const p = dmgPos(el, ix, iy, opts);
      spawnDmg(p.x, p.y, dmg, crit, crit && opts.headshot ? { tag: msg('headshotLabel') } : null);
      hudLastHit(el, dmg, rec.hp, rec.max, crit, !!opts.headshot);
    }
    if (broken) {
      removeTint(el);   // pieces are already flying
      breakElement(el, ix, iy, Object.assign({ mode: kind }, opts));
      refreshHover();
      return 'broken';
    }
    const t = now();
    const rect = rectOf(el);
    const fxOk = !opts.hold || t - (rec.lastFxAt || 0) >= HOLD_WINDOW;
    if (fxOk) {
      rec.lastFxAt = t;
      if (rect) { reactDamage(el, ix, iy, rect); showTint(el, rect, ix, iy, !!opts.hold); }
    } else if (rect) moveTint(el, rect, ix, iy);
    if (state.hoverEl === el) showTarget(el); else refreshHover();
    if (fxOk) pulseTarget();
    if (crit && state.hoverEl === el && (!win || win.sum === dmg)) critFlashFill();   // once per crit (first tick of a hold window), not per tick
    return 'damaged';
  }

  /* Bullet-hole glass chips (A18): ordinary physics pieces (cap, eviction,
   * stats().pieces) but NOT element debris — they carry crs-chip instead of
   * crs-debris and are excluded from stats().debris, because A31 requires the
   * debris count to stay unchanged on a damage-only gun shot. */
  function spawnChips(x, y, count) {
    const n = count || randInt(3, 5), made = [];
    for (let i = 0; i < n; i++) {
      const s = rand(6, 10);
      const node = mk('div', 'crs-piece crs-chip');
      node.style.left = px(x - s / 2); node.style.top = px(y - s / 2); node.style.width = px(s); node.style.height = px(s);
      node.style.background = 'rgba(236,243,255,.92)'; node.style.boxShadow = '0 0 1px rgba(0,0,0,.6)';
      node.style.clipPath = 'polygon(' + px(rand(0, s * 0.3)) + ' 0px, ' + px(s) + ' ' + px(rand(0, s * 0.4)) + ', ' + px(rand(s * 0.4, s)) + ' ' + px(s) + ', 0px ' + px(rand(s * 0.5, s)) + ')';
      node.style.transformOrigin = px(s / 2) + ' ' + px(s / 2);
      const v = velocityFor('gun', x, y, x + rand(-4, 4), y + rand(-4, 4), null);
      made.push([node, { ox: x - s / 2, oy: y - s / 2, w: s, h: s, vx: v.vx * 1.4, vy: v.vy * 1.4 - 60, vr: v.vr * 2, cx: s / 2, cy: s / 2, bb: { minX: 0, minY: 0, maxX: s, maxY: s }, word: true, chip: true }]);
    }
    enforceCap(made.length, batchGpu(made));
    for (const [node, p] of made) addPiece(node, p);
  }
  function edgeDist(rect, x, y) {
    const dx = Math.max(rect.left - x, 0, x - rect.right), dy = Math.max(rect.top - y, 0, y - rect.bottom);
    return Math.hypot(dx, dy);
  }
  /* AoE candidates (A7): the element under the blast centre is always candidate 0 (edgeDist 0); ring samples
   * drop its descendants AND its ancestors (the centre is the only candidate on its chain, exactly as v1
   * bombCandidates — where the blast point itself fed the ancestor filter), then the v1 ancestor filter over the
   * remaining samples; sort by edge distance, keep maxTargets. */
  function aoeCandidates(x, y, R, maxTargets, rings) {
    const seen = new Set(), list = [], cache = new Map();
    const centre = pickTarget(x, y, cache);
    const vw = viewW(), vh = viewH();
    for (const r of rings) {
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4, pxv = x + Math.cos(a) * r, pyv = y + Math.sin(a) * r;
        if (pxv < 0 || pyv < 0 || pxv > vw || pyv > vh) continue;
        const el = pickTarget(pxv, pyv, cache);
        if (!el || el === centre || seen.has(el)) continue;
        if (centre && (centre.contains(el) || el.contains(centre))) continue;
        seen.add(el); list.push(el);
      }
    }
    const filtered = list.filter((el) => !list.some((o) => o !== el && el.contains(o)));
    const out = [];
    if (centre) out.push({ el: centre, d: 0 });
    for (const el of filtered) {
      const r = rectOf(el); if (!r) continue;
      const d = edgeDist(r, x, y);
      if (d <= R) out.push({ el, d });
    }
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, maxTargets);
  }
  /* Falloff damage round(centre · (1 − 0.73·t)), t = edgeDist / R → centre 100 %, edge 27 %; stagger edgeDist / 4 ms. */
  function aoeHit(x, y, W) {
    const R = W.radius;
    const cands = aoeCandidates(x, y, R, W.maxTargets, W.rings);
    const plan = cands.map((c, i) => { const crit = rollCrit(); return { c, i, crit, dmg: rollDamage(Math.round(W.damage * (1 - 0.73 * clamp(c.d / R, 0, 1))), crit) }; });
    if (plan.some((p) => p.crit)) sfx('crit', { gain: 0.9 });   // the blast sound has already played; add the ×1.5 sparkle once (A4)
    for (const { c, i, crit, dmg } of plan) {
      const fire = () => { if (state.active && c.el.isConnected) applyHit(c.el, dmg, 'bomb', x, y, { textSplit: i === 0, aoe: true, crit, radius: R, toward: { x, y } }); scheduleHud(); };
      const delay = c.d / 4;
      if (delay < 1) fire(); else later(fire, delay);
    }
  }

// ── 76-weapon-fire.js ──
// ── the nine fire() entries (melee/gun/bomb/rocket/flame/sword) + collapse chain ──
  /* --- fire(x, y, ctx) entries. ctx.hold: fired by a hold tick (ctx.h = the hold session); each returns the element hit --- */
  function fireHammer(x, y) {
    state.shots++;
    if (interceptOrb(x, y)) return null;   // v1.2 A9: an orb within 18 px absorbs the blow, the page is untouched
    const el = pickTarget(x, y);
    const crit = el ? rollCrit() : false;
    const dmg = rollDamage(WEAPONS.hammer.damage, crit);
    sfx(!el || willBreak(el, dmg) ? 'hammer' : 'thump', { crit });   // thump only when merely dented (A24)
    flash(x, y, 'hammer'); shake('hammer', { amp: crit ? 8.4 : 6 });
    drawCrack(x, y, 'hammer', { ink: 1 });
    if (el) applyHit(el, dmg, 'hammer', x, y, { crit });
    return el;
  }
  function firePistol(x, y) {
    state.shots++;
    if (interceptOrb(x, y)) return null;
    const el = pickTarget(x, y);
    const crit = el ? rollCrit() : false;
    const dmg = rollDamage(WEAPONS.pistol.damage, crit);
    sfx('gun', { crit });
    flash(x, y, 'gun'); shake('gun', { amp: crit ? 2.8 : 2 });
    drawCrack(x, y, 'gun', { ink: 0.25 });
    spawnChips(x, y, randInt(3, 5));
    if (el) applyHit(el, dmg, 'gun', x, y, { crit });
    return el;
  }
  function fireSmg(x, y, c) {
    state.shots++;
    const h = (c && c.hold && c.h) || null;
    const n = h ? h.tick : 1;
    x += rand(-9, 9); y += rand(-9, 9);
    if (interceptOrb(x, y)) return null;   // v1.2 A9: the tick is consumed by the orb
    const el = pickTarget(x, y, h ? h.cache : undefined);
    let dmg = 0, crit = false, win = null;
    if (el) {
      if (h) { win = holdWindow(el); crit = win.crit; } else crit = rollCrit();
      dmg = rollDamage(WEAPONS.smg.damage, crit);
    }
    if (!h || n % 2 === 1) sfx('gun', { gain: 0.6, crit: !h && crit });   // one sound per 2 shots; a hold window's crit cue comes from holdWindow()
    flash(x, y, 'gun', { size: 32, dur: 100 });
    if (!h || n % 3 === 0) { shake('gun', { amp: 1 }); spawnChips(x, y, randInt(1, 2)); }   // every 3rd shot
    drawCrack(x, y, 'smg', { ink: 0.25 });
    if (el) applyHit(el, dmg, 'gun', x, y, { crit, hold: !!h, win });
    return el;
  }
  function fireAxe(x, y) {
    state.shots++;
    if (interceptOrb(x, y)) return null;
    const el = pickTarget(x, y);
    const crit = el ? rollCrit() : false;
    const dmg = rollDamage(WEAPONS.axe.damage, crit);
    sfx(!el || willBreak(el, dmg) ? 'hammer' : 'thump', { crit, pitch: 0.75, gain: 1.15 });
    flash(x, y, 'hammer', { size: 190, dur: 300 }); shake('hammer', { amp: crit ? 9.8 : 7 });
    drawCrack(x, y, 'hammer', { rays: [5, 7], lenScale: 1.3, ink: 1 });
    // a broken element splits in two along a jagged near-vertical line through the impact (A8)
    if (el) applyHit(el, dmg, 'hammer', x, y, { crit, pieces: 2, textSplit: false, splitLine: { angle: (90 + rand(-15, 15)) * DEG, cx: x, cy: y } });
    return el;
  }
  function fireStab(x, y) {   // sword click / drag shorter than 12 px
    state.shots++;
    if (interceptOrb(x, y)) return null;
    const el = pickTarget(x, y);
    const crit = el ? rollCrit() : false;
    const dmg = rollDamage(WEAPONS.sword.damage, crit);
    sfx('swish', { crit });
    flash(x, y, 'hammer', { size: 90, dur: 200 }); shake('hammer', { amp: crit ? 4.2 : 3 });
    drawCrack(x, y, 'hammer', { rays: [4, 6], lenScale: 0.45, ink: 0.5 });
    if (el) applyHit(el, dmg, 'hammer', x, y, { crit, pieces: 2, textSplit: false, splitLine: { angle: rand(0, Math.PI * 2), cx: x, cy: y } });
    return el;
  }
  /* Liang–Barsky: the part of segment (x1,y1)→(x2,y2) inside rect r, or null when they do not intersect. */
  function clipSegment(x1, y1, x2, y2, r) {
    const dx = x2 - x1, dy = y2 - y1;
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dy, dy], q = [x1 - r.left, r.right - x1, y1 - r.top, r.bottom - y1];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return null; continue; }
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
      else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
    return { x1: x1 + dx * t0, y1: y1 + dy * t0, x2: x1 + dx * t1, y2: y1 + dy * t1 };
  }
  function nearestOnSegment(ax, ay, bx, by, pxv, pyv) {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? clamp(((pxv - ax) * dx + (pyv - ay) * dy) / L2, 0, 1) : 0;
    return { x: ax + dx * t, y: ay + dy * t };
  }
  function slashFx(x1, y1, x2, y2) {   // 160 ms bright streak along the segment
    if (!root) return;
    const n = mk('div', 'crs-slash-fx');
    const len = Math.hypot(x2 - x1, y2 - y1), a = Math.atan2(y2 - y1, x2 - x1);
    n.style.left = px(x1); n.style.top = px(y1); n.style.width = px(len); n.style.height = '4px';
    n.style.transformOrigin = '0 50%'; n.style.transform = 'translateY(-2px) rotate(' + a.toFixed(4) + 'rad)';
    n.style.borderRadius = '2px';
    n.style.background = 'linear-gradient(90deg, rgba(255,255,255,0), #fff 18%, #fff 82%, rgba(255,255,255,0))';
    n.style.boxShadow = '0 0 0 1px rgba(15,25,35,.45), 0 0 8px 2px rgba(255,255,255,.75)';   // dark halo so the streak reads on light pages
    root.append(n);
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
    try { const an = trackAnim(n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' })); an.addEventListener('finish', kill); } catch (e) { /* ignore */ }
    later(kill, 400);
  }
  /* Slash (A8): samples every 24 px (both ends), unique targets (≤ 12) each take 60 × power (crit per element);
   * a broken element splits in two along the slash line. Returns the number of elements damaged. */
  function doSlash(x1, y1, x2, y2) {
    state.shots++;
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const n = Math.max(2, Math.ceil(len / 24) + 1);
    const cache = new Map(), seen = new Set(), hits = [];
    const vw = viewW(), vh = viewH();
    for (let i = 0; i < n && hits.length < 12; i++) {
      const f = i / (n - 1), sx = x1 + dx * f, sy = y1 + dy * f;
      if (sx < 0 || sy < 0 || sx > vw || sy > vh) continue;
      const el = pickTarget(sx, sy, cache);
      if (el && !seen.has(el)) { seen.add(el); hits.push(el); }
    }
    interceptOrbsAlong(x1, y1, x2, y2, 18);   // v1.2 A9: orbs within 18 px of the segment pop; the page is still hit
    // roll every element's crit before any sound / effect (A4) so the swish can carry the crit sparkle
    const plan = hits.map((el) => { const crit = rollCrit(); return { el, crit, dmg: rollDamage(WEAPONS.sword.damage, crit) }; });
    sfx('swish', { crit: plan.some((p) => p.crit) });
    slashFx(x1, y1, x2, y2);
    drawSlash(x1, y1, x2, y2);
    shake('hammer', { amp: 3 });
    for (const { el, crit, dmg } of plan) {
      const r = rectOf(el);
      let pv = { x: x2, y: y2 }, q = pv;
      if (r) {
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        // pivot = the point of the slash INSIDE the box nearest its centre (the chord, Liang–Barsky); a corner
        // cut therefore splits along the visible cut. No intersection → the box centre, same angle (A8).
        const chord = clipSegment(x1, y1, x2, y2, r);
        q = chord ? nearestOnSegment(chord.x1, chord.y1, chord.x2, chord.y2, cx, cy) : nearestOnSegment(x1, y1, x2, y2, cx, cy);
        pv = chord ? q : { x: cx, y: cy };
      }
      applyHit(el, dmg, 'hammer', pv.x, pv.y, { crit, slash: true, pieces: 2, textSplit: false, splitLine: { angle, cx: pv.x, cy: pv.y }, toward: q });
    }
    return hits.length;
  }
  function fireBomb(x, y) {
    state.shots++;
    interceptOrbsWithin(x, y, WEAPONS.bomb.radius);   // v1.2 A9: every orb in the blast pops (+5 each) AND the page is hit
    sfx('bomb');
    flash(x, y, 'bomb'); ring(x, y); shake('bomb');
    drawCrack(x, y, 'bomb', { ink: 1 });
    aoeHit(x, y, WEAPONS.bomb);
    return null;
  }
  function rocketImpact(x, y) {
    if (!state.active) return;
    interceptOrbsWithin(x, y, WEAPONS.rocket.radius);
    sfx('bomb', { gain: 1.3 });
    flash(x, y, 'bomb'); ring(x, y, { xl: true }); shake('bomb', { amp: 16, dur: 480 });
    scorchDab(x, y, 140, 0.45);
    drawCrack(x, y, 'bomb', { lenScale: 1.3, ink: 1 });
    aoeHit(x, y, WEAPONS.rocket);
    scheduleHud(); kick();
  }
  /* Rocket (A7): a bright capsule streaks from bottom-centre to the click point over 150 ms (WAAPI, tracked),
   * impact via later() so restore()/deactivate() cancel both. Cooldown counts from the click. */
  function fireRocket(x, y) {
    state.shots++;
    sfx('whoosh');
    if (!root) { rocketImpact(x, y); return null; }
    const sx = viewW() / 2, sy = viewH() + 20;
    const ang = Math.atan2(y - sy, x - sx);
    const n = mk('div', 'crs-rocket');
    n.style.left = px(sx); n.style.top = px(sy); n.style.width = '28px'; n.style.height = '8px';
    n.style.borderRadius = '4px';
    n.style.background = 'linear-gradient(90deg, rgba(255,209,102,0), #ffd166 35%, #fff)';
    n.style.boxShadow = '0 0 10px 3px rgba(255,209,102,.75)';
    const rot = ' translate(-50%, -50%) rotate(' + ang.toFixed(4) + 'rad)';
    n.style.transform = 'translate(0px, 0px)' + rot;
    root.append(n);
    try { trackAnim(n.animate([{ transform: 'translate(0px, 0px)' + rot }, { transform: 'translate(' + px(x - sx) + ', ' + px(y - sy) + ')' + rot }], { duration: 150, easing: 'ease-in', fill: 'forwards' })); } catch (e) { /* ignore */ }
    later(() => { try { n.remove(); } catch (e) { /* ignore */ } rocketImpact(x, y); }, 150);
    return null;
  }
  /* Fire particles (A9): 12–26 px radial gradients rising 30–60 px over 350–500 ms, cap 40 live. */
  function spawnFire(x, y, count) {
    if (!root) return;
    for (let i = 0; i < count; i++) {
      const s = rand(12, 26);
      const n = mk('div', 'crs-fire');
      n.style.left = px(x + rand(-10, 10) - s / 2); n.style.top = px(y + rand(-10, 10) - s / 2);
      n.style.width = px(s); n.style.height = px(s); n.style.borderRadius = '50%';
      n.style.background = 'radial-gradient(circle, #ffd166 0%, #ff6b35 45%, rgba(255,107,53,0) 72%)';
      root.append(n);
      state.fire.push(n);
      while (state.fire.length > 40) { const old = state.fire.shift(); try { old.remove(); } catch (e) { /* ignore */ } }
      const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } const k = state.fire.indexOf(n); if (k >= 0) state.fire.splice(k, 1); };
      try {
        const an = trackAnim(n.animate([{ transform: 'translateY(0px) scale(1)', opacity: 0.95 }, { transform: 'translateY(' + px(-rand(30, 60)) + ') scale(.4)', opacity: 0 }], { duration: rand(350, 500), easing: 'ease-out', fill: 'forwards' }));
        an.addEventListener('finish', kill);
      } catch (e) { /* ignore */ }
      later(kill, 1000);
    }
  }
  function fireFlame(x, y, c) {
    state.shots++;
    const h = (c && c.hold && c.h) || null;
    const n = h ? h.tick : 1;
    if (interceptOrb(x, y)) return null;   // v1.2 A9: a flame tick that intercepts is consumed
    const el = pickTarget(x, y, h ? h.cache : undefined);
    let crit = false, win = null, dmg = 0;
    if (el) {   // roll before any sound / effect (A4)
      if (h) { win = holdWindow(el); crit = win.crit; } else crit = rollCrit();
      dmg = rollDamage(WEAPONS.flame.damage, crit);
    }
    spawnFire(x, y, 2);
    if (!h || n % 4 === 0) { scorchDab(x, y, 24, 0.08); state.scorch++; }   // the glass blackens over time; no crack (A3/A9)
    if (!h) sfx('puff', { crit });
    if (el) applyHit(el, dmg, 'gun', x, y, { crit, hold: !!h, win, burnt: true });
    return el;
  }
  /* One BFS for collapse AND the hostile picker (v1.2 A7). opts: { limit: max area to COLLECT, minArea,
   * descendCollected: keep walking into collected elements (hostile: nested cards), skip(el) }. Same visited
   * cap 2000 / out cap 60 / viewport-intersection and visibility rules as the v1 collapseCandidates. */
  function walkCandidates(x, y, opts) {
    const vw = viewW(), vh = viewH();
    const limit = opts.limit, minArea = opts.minArea || 0, deep = !!opts.descendCollected, skip = opts.skip || null;
    const out = [], queue = [];
    const body = doc.body; if (!body) return out;
    const descend = (el) => {   // light children + open shadow children (web-component pages, F23)
      try { if (el.shadowRoot) for (const c of el.shadowRoot.children) queue.push(c); } catch (e) { /* ignore */ }
      for (const c of el.children) queue.push(c);
    };
    for (const ch of body.children) queue.push(ch);
    let visited = 0;
    while (queue.length && out.length < 60 && visited < 2000) {
      const el = queue.shift(); visited++;
      if (!el || el.nodeType !== 1) continue;
      const tag = tagOf(el);
      if (SKIP_WALK_TAGS.has(tag) || isOurs(el) || el.hasAttribute('data-crs-broken')) continue;
      const s = gcs(el); if (!s || s.display === 'none' || parseFloat(s.opacity) < 0.05) continue;   // invisible subtree: nothing to show
      const r = rectOf(el); if (!r) continue;
      const empty = r.width < 1 || r.height < 1;
      if (empty || s.display === 'contents' || s.visibility === 'hidden') { descend(el); continue; }
      if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
      const area = r.width * r.height;
      if (area <= limit) {
        if (area >= minArea && !(skip && skip(el))) out.push({ el, d: edgeDist(r, x, y), cx: r.left + r.width / 2, cy: r.top + r.height / 2, area });
        if (deep) descend(el);
        continue;
      }
      descend(el);
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }
  function collapseCandidates(x, y) { return walkCandidates(x, y, { limit: 0.25 * viewW() * viewH() }); }
  function doCollapse(x, y) {
    cancelCollapse();
    sfx('rumble');
    flash(x, y, 'collapse'); ring(x, y); shake('collapse');
    drawCrack(x, y, 'bomb');
    const cands = collapseCandidates(x, y);
    const textIdx = new Set();
    for (const c of cands) { if (textIdx.size >= 8) break; if (textDominant(c.el)) textIdx.add(c.el); }
    const chain = { timer: 0, i: 0, extra: 0, start: now(), thumps: 0, thumpTimer: 0, done: false };
    state.collapse = chain;
    const thump = () => { if (chain.done || !state.active) return; if (chain.thumps++ < 12) sfx('thump', { gain: 0.9 }); chain.thumpTimer = later(thump, 90); };
    chain.thumpTimer = later(thump, 90);
    const finish = () => { chain.done = true; untrack(chain.thumpTimer); chain.thumpTimer = 0; if (state.collapse === chain) state.collapse = null; state.hintCollapse = true; updateHud(); };
    const step = () => {
      chain.timer = 0;
      if (chain.done || !state.active) return;
      if (chain.i >= cands.length) { finish(); return; }
      const c = cands[chain.i++];
      const t0 = now();
      if (c.el.isConnected && !c.el.hasAttribute('data-crs-broken')) {
        const r = rectOf(c.el);
        if (r && r.width >= 1 && r.height >= 1) {
          const dx = c.cx - x, dy = c.cy - y, L = Math.hypot(dx, dy) || 1;
          breakElement(c.el, x, y, { mode: 'collapse', pieces: r.width * r.height < 40000 ? 2 : 1, cloneCap: 300, textSplit: textIdx.has(c.el), forceWords: true, maxTokens: 12, away: { x: dx / L, y: dy / L } });
          state.hp.delete(c.el);
        }
      }
      if (now() - t0 > 16) chain.extra += 16;
      updateHud();
      refreshHover();
      schedule();
    };
    const schedule = () => {
      if (chain.i >= cands.length) { finish(); return; }
      const c = cands[chain.i];
      const at = chain.start + c.d / 1.1 + chain.i * 6 + chain.extra;
      chain.timer = later(step, Math.max(0, at - now()));
    };
    if (!cands.length) finish(); else schedule();
  }
  function cancelCollapse() {
    const c = state.collapse;
    if (!c) return;
    c.done = true;
    untrack(c.timer); untrack(c.thumpTimer); c.timer = 0; c.thumpTimer = 0;
    state.collapse = null;
  }

// ── 79-weapon-actions.js ──
// ── action dispatch: cooldown/swap/ammo gating, smashAt/slashSegment, hold weapons, sword drag, WEAPONS.*.fire wiring ──

  WEAPONS.hammer.fire = fireHammer; WEAPONS.pistol.fire = firePistol; WEAPONS.smg.fire = fireSmg; WEAPONS.axe.fire = fireAxe;
  WEAPONS.sword.fire = fireStab; WEAPONS.bomb.fire = fireBomb; WEAPONS.rocket.fire = fireRocket; WEAPONS.flame.fire = fireFlame;
  WEAPONS.sniper.fire = fireSniper;
  WEAPONS.collapse.fire = (x, y) => { state.shots++; doCollapse(x, y); return null; };

  /* --- actions (A3 ordering + v1.2 A5 gates): mount → cooldown → swap delay → spend → counters/combo/swing → fire → HUD --- */
  function action(id, x, y, run) {
    if (!state.active || state.ko) return undefined;   // KO screen: smashing disabled (v1.2 §5)
    ensureMounted();
    reraiseAll();
    blurFrame();
    if (onCooldown()) { swingCursor(); cooldownFeedback(); return undefined; }   // rejected: no counter, crack or damage
    if (swapActive()) { cooldownFeedback(); return undefined; }                   // weapon swap delay (A5)
    if (!spend(id)) { updateAmmoHud(); return undefined; }                        // empty / reloading: rejected, auto-reload running
    state.hintCollapse = false;
    state.hoverX = x; state.hoverY = y;
    bumpCombo();
    swingCursor();
    let out = null;
    try { out = run(); } catch (e) { state.lastError = String((e && e.stack) || e); }
    flushPendingReload();   // A5: the emptying round reloads right after it was fired (A4: scoped shots stay exact)
    updateHud();
    updateAmmoHud();
    kick();
    return out === undefined ? null : out;
  }
  /* Single attack at (x, y): click weapons, one tick for smg/flame, a stab for the sword. true if an attack happened. */
  function smashAt(x, y, weaponId) {
    if (!state.active) return false;
    x = +x; y = +y;
    if (!isFinite(x) || !isFinite(y)) return false;
    const wid = weaponId === 'gun' ? 'pistol' : weaponId;   // legacy v1 alias, same as setMode() (A12)
    const id = WEAPON_IDS.includes(wid) ? wid : state.weapon;
    const W = WEAPONS[id];
    const r = action(id, x, y, () => {
      const hit = W.fire(x, y, { hold: false });
      startCooldown(id, id === 'sword' ? W.stabCooldownMs : W.cooldownMs);
      return hit;
    });
    return r !== undefined;
  }
  /* Sword segment (pointer release or api.slash): < 12 px → stab, else slash. Returns elements damaged. */
  function slashSegment(x1, y1, x2, y2) {
    if (!state.active) return 0;
    x1 = +x1; y1 = +y1; x2 = +x2; y2 = +y2;
    if (!(isFinite(x1) && isFinite(y1) && isFinite(x2) && isFinite(y2))) return 0;
    if (Math.hypot(x2 - x1, y2 - y1) < 12) {
      const r = action('sword', x1, y1, () => { const hit = fireStab(x1, y1); startCooldown('sword', WEAPONS.sword.stabCooldownMs); return hit; });
      return r ? 1 : 0;
    }
    const n = action('sword', x2, y2, () => doSlash(x1, y1, x2, y2));
    return n || 0;
  }

  /* --- hold weapons (A6): a self-rescheduling later() chain, never setInterval --- */
  function startHold(id, x, y, pointerId) {
    if (!state.active) return false;
    const W = WEAPONS[id];
    if (!W || !W.hold) return false;
    if (state.ko) return false;
    if (state.hold) stopHold();
    if (state.slash) cancelSlash();
    ensureMounted();
    reraiseAll();
    blurFrame();
    if (swapActive()) { cooldownFeedback(); return false; }     // v1.2 A5: swap gate before the first tick
    if (!spend(id)) { updateAmmoHud(); return false; }          // empty / reloading: no hold starts
    try { if (shield && pointerId != null) shield.setPointerCapture(pointerId); } catch (e) { /* ignore */ }
    state.hintCollapse = false;
    if (isFinite(x) && isFinite(y)) { state.hoverX = x; state.hoverY = y; }
    bumpCombo();
    swingCursor();
    const h = { id, pointerId: pointerId == null ? null : pointerId, startedAt: now(), tick: 0, timer: 0, safety: 0, cache: new Map(), cacheAt: now(), open: new Set(), tintEls: new Set() };
    state.hold = h;
    h.safety = later(() => { if (state.hold === h) stopHold(); }, 10000);
    if (id === 'flame') { ensureAudio(); startLoop(); }
    try { const b = weaponBtn(id); if (b) b.classList.add('holding'); } catch (e) { /* ignore */ }
    updateHud();
    holdStep();
    return true;
  }
  function holdStep() {
    const h = state.hold;
    if (!h || !state.active) return;
    h.timer = 0;
    const t = now();
    if (t - h.cacheAt >= HOLD_WINDOW) { h.cache = new Map(); h.cacheAt = t; }
    if (h.tick > 0 && !spend(h.id)) { stopHold(); updateAmmoHud(); return; }   // v1.2 A5: a hold that runs dry stops (auto-reload keeps running)
    h.tick++;
    let hit = null;
    try { hit = WEAPONS[h.id].fire(state.hoverX, state.hoverY, { hold: true, h }) || null; } catch (e) { state.lastError = String((e && e.stack) || e); }
    flushPendingReload();
    if (state.hold !== h) return;   // the tick itself ended the hold (deactivate from a page handler)
    for (const el of Array.from(h.tintEls)) if (el !== hit) { fadeTint(el); h.tintEls.delete(el); }
    if (hit && !hit.hasAttribute('data-crs-broken')) h.tintEls.add(hit);
    for (const el of Array.from(h.open)) { const w = state.dmgAgg.get(el); if (!w || t - w.at >= HOLD_WINDOW) flushWindow(el, w); }
    scheduleHud();
    kick();
    h.timer = later(holdStep, WEAPONS[h.id].tickMs);
  }
  function stopHold(silent) {
    const h = state.hold;
    if (!h) return;
    state.hold = null;   // first: stats().holding is already false
    untrack(h.timer); untrack(h.safety); h.timer = 0; h.safety = 0;
    stopLoop();
    for (const el of Array.from(h.tintEls)) fadeTint(el);
    for (const el of Array.from(h.open)) { const w = state.dmgAgg.get(el); if (silent) state.dmgAgg.delete(el); else flushWindow(el, w); }
    try { const b = weaponBtn(h.id); if (b) b.classList.remove('holding'); } catch (e) { /* ignore */ }
    try { if (shield && h.pointerId != null && shield.hasPointerCapture(h.pointerId)) shield.releasePointerCapture(h.pointerId); } catch (e) { /* ignore */ }
    if (!silent) scheduleHud();
  }

  /* --- sword drag (A8): preview line from pointerdown, resolved on release --- */
  function startSlash(x, y, pointerId) {
    if (!state.active || !root) return false;
    if (state.hold) stopHold();
    if (state.slash) cancelSlash();
    ensureMounted();
    reraiseAll();
    blurFrame();
    try { if (shield && pointerId != null) shield.setPointerCapture(pointerId); } catch (e) { /* ignore */ }
    state.hoverX = x; state.hoverY = y;
    const n = mk('div', 'crs-slash-preview');
    n.style.left = px(x); n.style.top = px(y); n.style.width = '0px'; n.style.height = '2px';
    n.style.background = 'rgba(255,255,255,.7)'; n.style.borderRadius = '1px';
    n.style.boxShadow = '0 0 0 1px rgba(15,25,35,.55), 0 0 4px rgba(255,255,255,.5)';   // dark halo: readable on white pages too (same dark pass as drawSlash)
    n.style.transformOrigin = '0 50%'; n.style.transform = 'translateY(-1px) rotate(0rad)';
    root.append(n);
    state.slash = { x1: x, y1: y, x2: x, y2: y, node: n, pointerId: pointerId == null ? null : pointerId };
    return true;
  }
  function updateSlash(x, y) {
    const s = state.slash;
    if (!s) return;
    s.x2 = x; s.y2 = y;
    const dx = x - s.x1, dy = y - s.y1;
    s.node.style.width = px(Math.hypot(dx, dy));
    s.node.style.transform = 'translateY(-1px) rotate(' + Math.atan2(dy, dx).toFixed(4) + 'rad)';
  }
  function cancelSlash() {
    const s = state.slash;
    if (!s) return null;
    state.slash = null;
    try { s.node.remove(); } catch (e) { /* ignore */ }
    try { if (shield && s.pointerId != null && shield.hasPointerCapture(s.pointerId)) shield.releasePointerCapture(s.pointerId); } catch (e) { /* ignore */ }
    return s;
  }
  function resolveSlash(x, y) {
    const s = cancelSlash();
    if (!s) return 0;
    if (isFinite(x) && isFinite(y)) { s.x2 = x; s.y2 = y; }
    return slashSegment(s.x1, s.y1, s.x2, s.y2);
  }

// ── 82-ammo-reload.js ──
// ── ammo & reload: magazine spend, auto/manual reload state machine, ammo HUD (v1.3 §2.1: pips, 48 px count, pinned width) ──
  /* ===================================================================== */
  /* 12b. v1.2: ammo / reload, scope + sniper, loadouts, combat, toasts         */
  /* ===================================================================== */
  function slotKey(slot) { return slot === 10 ? '0' : String(slot); }
  function slotOf(id) { return state.loadout.indexOf(id) + 1; }

  /* --- ammo (A5): state.ammo[id] rounds, reserve ∞, later()-chained reload, swap delay --- */
  function initAmmo() { state.pendingReload = null; for (const id of WEAPON_IDS) state.ammo[id] = WEAPONS[id].mag == null ? null : WEAPONS[id].mag; }
  function isReloading(id) { return !!(state.reload && state.reload.id === id); }
  function swapActive() { return !debug.noCooldown && now() < state.swapUntil; }
  function emptyClick() {   // at most once per 300 ms
    const t = now();
    if (t - state.lastEmptyAt >= 300) { state.lastEmptyAt = t; sfx('empty'); }
  }
  function spend(id) {
    const W = WEAPONS[id];
    if (!W || W.mag == null) return true;
    if (isReloading(id)) { emptyClick(); return false; }
    if (swapActive()) return false;
    if (!(state.ammo[id] > 0)) { emptyClick(); if (!state.reload) startReload(id, false); return false; }   // dead click: no shot to protect
    if (!debug.infiniteAmmo) state.ammo[id]--;
    if (state.ammo[id] <= 0) state.pendingReload = id;   // armed now, started by flushPendingReload() right after the shot
    return true;
  }
  /* The magazine-emptying round still auto-reloads inside the same action (no dead click), but only AFTER it was
   * fired: startReload() scopes out, and a scoped sniper shot must stay exact (A4). */
  function flushPendingReload() {
    const id = state.pendingReload;
    if (!id) return;
    state.pendingReload = null;
    startReload(id, false);
  }
  function startReload(id, manual) {
    const W = WEAPONS[id];
    if (!state.active || !W || W.mag == null || state.reload) return false;
    if (state.ammo[id] >= W.mag) return false;
    scopeOff();
    const ms = debug.fastReload ? 30 : W.reloadMs;
    const rec = { id, startedAt: now(), ms, timer: 0, magTimer: 0 };
    state.reload = rec;
    sfx('magout');
    rec.magTimer = later(() => { rec.magTimer = 0; if (state.reload === rec) sfx('magin'); }, Math.round(ms * 0.8));
    rec.timer = later(() => {
      rec.timer = 0;
      if (state.reload !== rec) return;
      state.reload = null;
      untrack(rec.magTimer); rec.magTimer = 0;
      state.ammo[id] = W.mag;
      updateAmmoHud(); scheduleHud();
      syncScope();   // A2: the chord may still be held — the scope comes back the moment the magazine is full
    }, ms);
    if (ms >= 500) { try { const b = weaponBtn(id); if (b) trackAnim(b.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: ms, easing: 'linear' })); } catch (e) { /* ignore */ } }
    if (manual) toast(msg('toastReload') + '…');
    updateAmmoHud();
    return true;
  }
  function stopReload() {
    const r = state.reload;
    if (!r) return;
    state.reload = null;
    untrack(r.timer); untrack(r.magTimer);
    updateAmmoHud();
  }
  function reloadNow() { return startReload(state.weapon, true); }
  function ammoInfo() {
    const id = state.weapon, W = WEAPONS[id], r = state.reload;
    const size = W.mag == null ? null : W.mag;
    const reloading = isReloading(id);
    return { mag: size == null ? null : state.ammo[id], size, reloading, reloadProgress: reloading ? clamp((now() - r.startedAt) / r.ms, 0, 1) : 0, swapping: swapActive() };
  }
  /* v1.3 §2.1: magazine pips. One 7 × 4 bar per round up to 30; past that the magazine is bucketed into tens
   * (flame: 100 rounds → 10 pips). Nodes are reused, so a hold weapon firing every 50 ms does not churn the DOM. */
  function renderPips(size, left) {
    const list = hudEls.aPipList, box = hudEls.aPips;
    if (!list || !box) return;
    const per = (size == null || size <= 30) ? 1 : 10;
    const total = size == null ? 0 : Math.ceil(size / per);
    const full = size == null ? 0 : clamp(Math.ceil(left / per), 0, total);
    while (list.length > total) { const n = list.pop(); try { n.remove(); } catch (e) { /* ignore */ } }
    while (list.length < total) { const n = doc.createElement('span'); n.className = 'apip'; list.push(n); box.append(n); }
    for (let i = 0; i < list.length; i++) list[i].classList.toggle('spent', i >= full);
  }
  /* The two attention pulses of the ammo panel (low magazine 0.9 s, empty magazine 1.1 s). One WAAPI animation at a
   * time, held in hudEls.aPulse so cancelAnims() / restore() can stop it; `key` keeps it from restarting every frame. */
  function setAmmoPulse(key, node, ms) {
    if (hudEls.aPulseKey === key && hudEls.aPulse && hudEls.aPulse.playState === 'running') return;
    if (hudEls.aPulse) { try { hudEls.aPulse.cancel(); } catch (e) { /* ignore */ } state.anims.delete(hudEls.aPulse); hudEls.aPulse = null; }
    hudEls.aPulseKey = key;
    if (!key || !node || reducedMotion()) return;
    try { hudEls.aPulse = trackAnim(node.animate([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], { duration: ms, iterations: Infinity })); } catch (e) { hudEls.aPulse = null; }
  }
  function updateAmmoHud() {
    const a = hudEls.ammo;
    if (!a) return;
    try {
      const id = state.weapon, W = WEAPONS[id], size = W.mag;
      hudEls.aEmoji.textContent = W.emoji;
      const big = hudEls.aBig, swapping = swapActive();
      const r = state.reload, reloading = !!(r && r.id === id);
      const mag = size == null ? null : state.ammo[id];
      const empty = size != null && !(mag > 0) && !swapping;
      const low = size != null && !empty && mag <= 0.25 * size;
      // the count line: 교체 중 renders at 20 px inside the SAME 196 px plate, so a swap no longer moves the panel
      big.classList.toggle('swap', swapping);
      big.classList.toggle('low', low);
      big.classList.toggle('dim', reloading && !empty);
      if (swapping) { big.textContent = msg('labelSwapping'); hudEls.aDim.textContent = ''; }
      else if (size == null) { big.textContent = '∞'; hudEls.aDim.textContent = ''; }
      else { big.textContent = String(mag); hudEls.aDim.textContent = ' / ∞'; }
      big.style.display = empty ? 'none' : '';
      hudEls.aDim.style.display = empty ? 'none' : '';
      hudEls.aPrompt.classList.toggle('on', empty);
      if (hudEls.fallback) hudEls.aPrompt.style.display = empty ? 'flex' : 'none';
      renderPips(swapping || size == null ? null : size, mag || 0);
      setAmmoPulse(empty ? 'empty' : (low ? 'low' : ''), empty ? hudEls.aPrompt : hudEls.aPips, empty ? 1100 : 900);
      hudEls.aBar.classList.toggle('on', reloading);
      if (hudEls.fallback) hudEls.aBar.style.display = reloading ? 'block' : 'none';
      if (reloading) {
        if (hudEls.aFillFor !== r) {
          hudEls.aFillFor = r;
          cancelAnimsOf(hudEls.aFill);
          const start = clamp((now() - r.startedAt) / r.ms, 0, 1);
          trackAnim(hudEls.aFill.animate([{ width: (start * 100).toFixed(1) + '%' }, { width: '100%' }], { duration: Math.max(1, r.ms - (now() - r.startedAt)), easing: 'linear', fill: 'forwards' }));
        }
      } else if (hudEls.aFillFor) { hudEls.aFillFor = null; cancelAnimsOf(hudEls.aFill); }
    } catch (e) { /* ignore */ }
  }

// ── 83-scope.js ──
// ── scope: ADS reticle build/show/hide, 2x body magnification, sway/recoil step (v1.3 §3.1: ADS dims the player ring) ──
  /* --- scope (A2–A4): visual layer in the glass root + 2× body transform saved/restored exactly --- */
  function scopeMag() { return (state.scoped && state.scope.magnified) ? 2 : 1; }
  function scopeRadius() { return 0.42 * Math.min(viewW(), viewH()); }
  function buildScopeNode() {
    const n = mk('div', 'crs-scope');
    const ret = mk('div', 'crs-scope-reticle');
    const R = scopeRadius();
    const lines = [];
    const line = (l, t, w, h) => { const d = mk('div', 'crs-scope-line'); d.style.left = px(l); d.style.top = px(t); d.style.width = px(w); d.style.height = px(h); lines.push(d); ret.append(d); };
    line(-R, -0.5, R - 10, 1); line(10, -0.5, R - 10, 1); line(-0.5, -R, 1, R - 10); line(-0.5, 10, 1, R - 10);   // 10 px centre gap
    for (const k of [-2, -1, 1, 2]) {   // mil-dots every R/4 along each axis
      const d = k * R / 4;
      const h = mk('div', 'crs-scope-dot'); h.style.left = px(d - 2); h.style.top = px(-2); ret.append(h);
      const v = mk('div', 'crs-scope-dot'); v.style.left = px(-2); v.style.top = px(d - 2); ret.append(v);
    }
    const ring = mk('div', 'crs-scope-ring');
    ring.style.left = px(-(R - 6)); ring.style.top = px(-(R - 6)); ring.style.width = px(2 * (R - 6)); ring.style.height = px(2 * (R - 6));
    ret.append(ring);
    n.append(ret);
    state.scope.reticle = ret; state.scope.lines = lines;
    return n;
  }
  function scopeOn() {
    if (state.scoped || !state.active || !root || state.ko || state.weapon !== 'sniper') return false;
    const sc = state.scope;
    state.scoped = true;
    try { docEl.classList.add('crs-scoped'); } catch (e) { /* ignore */ }   // ADS: the page cursor is hidden so it cannot cover the reticle
    try { if (hud) hud.classList.add('crs-scoped'); } catch (e) { /* ignore */ }   // and the weapon panel fades out of the circle
    const x = state.hoverX >= 0 ? state.hoverX : viewW() / 2, y = state.hoverY >= 0 ? state.hoverY : viewH() / 2;
    sc.cx = x; sc.cy = y; sc.startedAt = now(); sc.recoilAt = 0; sc.hot = false;
    sc.node = buildScopeNode();
    root.append(sc.node);
    sc.magnified = false; sc.saved = null;
    try {   // skip the transform when body is missing / already transformed / html { zoom } / reduced motion (A3)
      const body = doc.body;
      let z = 1;
      try { z = parseFloat(gcsRaw(docEl).zoom); if (!isFinite(z)) z = 1; } catch (e) { z = 1; }
      const bs = body ? gcs(body) : null;
      const bb = body ? rectOf(body) : null;
      if (body && bs && bb && bs.transform === 'none' && z === 1 && !reducedMotion()) {
        sc.saved = ['transform', 'transform-origin'].map((p) => ({ prop: p, value: body.style.getPropertyValue(p), priority: body.style.getPropertyPriority(p) }));
        imp(body, 'transform', 'scale(2)');
        // transform-origin is body-local: subtract the (untransformed, scrolled) body rect so the point under the pointer stays put
        imp(body, 'transform-origin', px(x - bb.left) + ' ' + px(y - bb.top));
        sc.magnified = true;
      }
    } catch (e) { sc.magnified = false; }
    scopeStep(now());
    placeSelf();   // v1.3 §3.1: ADS drops the player ring to 20 % so it cannot cover the reticle
    scheduleAura();   // A3: every page rect just changed under the 2× transform — hostile auras must follow
    sfx('scopeIn');
    kick();
    refreshHover();
    return true;
  }
  function scopeOff() {
    if (!state.scoped) return false;
    const sc = state.scope;
    state.scoped = false;
    try { docEl.classList.remove('crs-scoped'); } catch (e) { /* ignore */ }
    try { if (hud) hud.classList.remove('crs-scoped'); } catch (e) { /* ignore */ }
    if (sc.node) { try { sc.node.remove(); } catch (e) { /* ignore */ } sc.node = null; sc.reticle = null; sc.lines = []; }
    if (sc.magnified) {
      try {
        const body = doc.body;
        if (body && sc.saved) for (const s of sc.saved) { if (s.value) body.style.setProperty(s.prop, s.value, s.priority); else body.style.removeProperty(s.prop); }
      } catch (e) { /* ignore */ }
    }
    sc.magnified = false; sc.saved = null;
    if (state.active) { placeSelf(); scheduleAura(); sfx('scopeOut'); refreshHover(); }   // A3: rects are back to 1× — re-place the auras
    return true;
  }
  /* RMB (chord model) OR Shift (after its 120 ms delay) want the scope while the sniper is selected. */
  function syncScope() {
    const sc = state.scope;
    const want = state.active && !state.ko && state.weapon === 'sniper' && (sc.rmb || sc.shiftWant);
    if (want && !state.scoped) scopeOn();
    else if (!want && state.scoped) scopeOff();
  }
  function scopeStep(t) {   // circle follow + sway + recoil, inside tick() (A4 / A8)
    const sc = state.scope;
    if (!sc.node || !sc.reticle) return;
    const R = scopeRadius();
    const tx = state.hoverX >= 0 ? state.hoverX : viewW() / 2, ty = state.hoverY >= 0 ? state.hoverY : viewH() / 2;
    const ph = ((t - sc.startedAt) / 2200) * Math.PI * 2;
    let sx = 3 * Math.sin(ph), sy = 3 * Math.sin(ph * 0.8 + 1.2);
    if (reducedMotion()) { sx = 0; sy = 0; }
    let ry = 0;
    if (sc.recoilAt) { const p = clamp((t - sc.recoilAt) / 250, 0, 1); ry = -40 * (1 - p) * (1 - p); if (p >= 1) sc.recoilAt = 0; }
    const cx = tx + sx, cy = ty + sy + ry;
    sc.cx = cx; sc.cy = cy;
    sc.node.style.background = 'radial-gradient(circle at ' + px(cx) + ' ' + px(cy) + ', transparent ' + px(R) + ', rgba(0,0,0,.92) ' + px(R + 2) + ')';
    sc.reticle.style.transform = 'translate(' + px(cx) + ', ' + px(cy) + ')';
    const hot = !!(state.hoverEl && state.hostiles.has(state.hoverEl));
    if (hot !== sc.hot) { sc.hot = hot; try { sc.node.classList.toggle('crs-scope-hot', hot); } catch (e) { /* ignore */ } }
  }

// ── 84-sniper.js ──
// ── sniper: tracer fx + hitscan fire with headshot crit ──
  /* --- sniper (A4): hitscan with ±25 px unscoped spread, tracer, bolt, headshots --- */
  function tracerFx(x, y) {
    if (!root) return;
    const sx = viewW() - 80, sy = viewH() - 40;
    const n = mk('div', 'crs-tracer');
    const len = Math.hypot(x - sx, y - sy), a = Math.atan2(y - sy, x - sx);
    n.style.left = px(sx); n.style.top = px(sy); n.style.width = px(len); n.style.height = '2px';
    n.style.transformOrigin = '0 50%'; n.style.transform = 'translateY(-1px) rotate(' + a.toFixed(4) + 'rad)';
    root.append(n);
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
    try { const an = trackAnim(n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out', fill: 'forwards' })); an.addEventListener('finish', kill); } catch (e) { /* ignore */ }
    later(kill, 400);
  }
  function fireSniper(x, y) {
    state.shots++;
    const scoped = state.scoped, S = WEAPONS.sniper.spread;
    let ix = x, iy = y;
    if (!scoped && !debug.noSpread) { ix += rand(-S, S); iy += rand(-S, S); }
    ix = clamp(ix, 0, viewW()); iy = clamp(iy, 0, viewH());
    state.lastShot = { x: ix, y: iy, offsetX: ix - x, offsetY: iy - y, scoped };   // recorded hit or miss, before interception
    if (scoped) state.scope.recoilAt = now();
    if (audio.ctx && !state.muted) { later(() => sfx('clack'), 350); later(() => sfx('clack'), 500); }   // bolt action
    tracerFx(ix, iy);
    if (interceptOrb(ix, iy)) { sfx('sniper'); return null; }
    const el = pickTarget(ix, iy);
    const crit = el ? rollSniperCrit(scoped) : false;
    const dmg = rollDamage(WEAPONS.sniper.damage, crit);
    sfx('sniper', { crit });
    flash(ix, iy, 'gun', { size: 90, dur: 160 }); shake('gun', { amp: crit ? 8 : 6 });
    drawCrack(ix, iy, 'gun', { rays: [6, 9], len: [30, 70], ink: 0.5 });
    spawnChips(ix, iy, randInt(4, 7));
    if (el) applyHit(el, dmg, 'gun', ix, iy, { crit, headshot: true });
    return el;
  }

// ── 85-loadout.js ──
  /* --- loadouts (A6) --- */
  function isPermutation(ids) {
    if (!Array.isArray(ids) || ids.length !== WEAPON_IDS.length) return false;
    const seen = new Set();
    for (const id of ids) { if (!WEAPON_IDS.includes(id) || seen.has(id)) return false; seen.add(id); }
    return true;
  }
  function setLoadout(ids, opts) {
    if (!isPermutation(ids)) return false;
    const silent = !!(opts && opts.silent);
    state.loadout = ids.slice();
    state.preset = (opts && opts.preset) || 'custom';
    if (!silent) { state.loadoutTouched = true; safe(() => chrome.storage.sync.set({ crsLoadout: state.loadout.slice(), crsLoadoutPreset: state.preset })); }
    reorderHud();
    updateHud();
    return true;
  }
  function applyPreset(name) {
    if (!PRESETS[name]) return false;
    setLoadout(PRESETS[name], { preset: name });
    toast(msg('labelLoadout') + ': ' + msg(PRESET_KEYS[name]));
    return true;
  }
  /* Shift+digit / drag: the weapon takes `slot`, the slot's previous weapon takes the old slot. */
  function moveToSlot(id, slot) {
    const i = state.loadout.indexOf(id), j = slot - 1;
    if (i < 0 || j < 0 || j >= state.loadout.length) return false;
    const other = state.loadout[j];
    if (i !== j) { const arr = state.loadout.slice(); arr[j] = id; arr[i] = other; setLoadout(arr); }
    const W = WEAPONS[id];
    toast(slotKey(slot) + ' ← ' + W.emoji + ' ' + msg(W.name));
    pulseBadge(id); if (other !== id) pulseBadge(other);
    return true;
  }
  function stepSlot(dir) {
    const n = state.loadout.length, i = state.loadout.indexOf(state.weapon);
    return setWeapon(state.loadout[((((i < 0 ? 0 : i) + dir) % n) + n) % n]);
  }

// ── 86-modes.js ──
// ── v1.4 §0.5: the three modes (rampage · quickdraw · survival) and everything that switches between them ──
  /* v1.3 shipped ONE boolean, `combat`. v1.4 splits it on the axis the player actually feels — how the mouse is
   * shared between aiming and dodging:
   *
   *   rampage    mouse only                      no enemies at all; v1.2's pure demolition tool
   *   quickdraw  one mouse (the cursor IS you)   enemies only ever lock on; you shoot the lock before it closes
   *   survival   mouse aims, WASD flies a drone  orbs, slams and locks — and now dodging is a real input
   *
   * `state.combat` survives as a derived getter (20-state.js), so the whole v1.2/v1.3 combat body still reads
   * "are enemies live?" from one place and needed no edit. The per-mode differences are asked here, by name. */

  debug.difficulty = 'normal';   // 'easy' ×1.5 | 'normal' ×1 | 'hard' ×0.7 repair interval (§3.1)
  const MODES = ['rampage', 'quickdraw', 'survival'];
  const MODE_NAME = { rampage: 'modeRampage', quickdraw: 'modeQuickdraw', survival: 'modeSurvival' };
  const MODE_DESC = { rampage: 'modeRampageDesc', quickdraw: 'modeQuickdrawDesc', survival: 'modeSurvivalDesc' };

  /* §1.2 drone avatar */
  const AV_R = 17;                   // 34 px body
  const AV_RING_R = 23;              // 46 px health ring (the v1.3 ring, re-anchored)
  const AV_ACCEL = 2800;             // px/s²
  const AV_MAX_SPEED = 420;          // px/s
  const AV_FRICTION = 0.86;          // per frame, applied at 60 fps and time-corrected
  const AV_MARGIN = 20;              // viewport inset the drone is clamped to
  const AV_HIT_R = 18;               // enemy hit radius against the drone
  const DASH_PX = 180, DASH_MS = 160, DASH_CD = 1500, DASH_IFRAME = 220, DASH_GHOSTS = 3;
  /* §2 Virtua-Cop lock-on */
  const LOCK_MS = 3000;              // full lock; §10.2 shortens a `front` enemy to 2400
  const LOCK_MS_FRONT = 2400;
  const LOCK_P1 = 1 / 3;             // warn → close  (1.0 s of 3.0 s)
  const LOCK_P2 = 11 / 15;           // close → imminent (2.2 s of 3.0 s)
  const LOCK_FOLLOW = 1 / 3;         // survival: the frame stops following the drone at 1.0 s
  const LOCK_GAP0 = 70, LOCK_GAP1 = 24, LOCK_GAP2 = 4;   // bracket size / thickness (20 / 3 px) are in content.css
  const LOCK_MAX = 3;                // at most three concurrent locks (§2.2)
  const LOCK_RECOVER_MS = 1500;      // a broken lock cannot re-arm for this long
  const LOCK_HIT_R = 56;             // survival: how far from the frozen centre still counts as a hit
  /* §3 repairing enemies + the destruction-ratio meter */
  const REPAIR_MS = { shooter: 6000, charger: 5000, laser: 4000, boss: 2500 };
  const REPAIR_BEAM_MS = 1500, REPAIR_RANGE = 600, REPAIR_PIECE_MS = 600;
  const REPAIR_DELAY_MS = 400, REPAIR_DELAY_MAX = 2, REPAIR_FADE_IN_MS = 400;
  const RATIO_REFRESH_MS = 2000, RATIO_DOMINATE = 0.8, RATIO_DROP_MS = 400;
  const DIFF_MUL = { easy: 1.5, normal: 1, hard: 0.7 };
  /* §9 debris lifetime */
  const DEBRIS_JITTER = 400, DEBRIS_FADE_MS = 500, DEBRIS_HARD_MS = 20000;
  const DEBRIS_BATCH = 12, DEBRIS_SWEEP_MS = 250, DEBRIS_PERF_MS = 3000;
  /* §10 depth */
  const DEPTH_MIN_AREA = 2000, DEPTH_REFRESH_MS = 2000;
  const DEPTH_HP = { front: 0.8, mid: 1, back: 1.2 };
  const DEPTH_ATTACK = { front: 0.7, mid: 1, back: 0 };     // 0 = this tier never attacks
  const DEPTH_REPAIR = { front: 0, mid: 1, back: 0.6 };     // 0 = this tier never repairs

  /* ---- what exists in which mode (§0.5 / §6) ---- */
  function modeHasEnemies() { return state.mode !== 'rampage'; }
  function modeHasAvatar() { return state.mode === 'survival'; }
  function modeHasHealth() { return state.mode === 'survival'; }     // health HUD, KO, the drone health ring
  function modeHasProjectiles() { return state.mode === 'survival'; }   // §4: orbs and slams are survival-only
  function modeHasRepair() { return state.mode !== 'rampage'; }
  function modeHasRatio() { return state.mode !== 'rampage'; }
  function modeLockOnEnemy() { return state.mode === 'quickdraw'; }   // the frame sits on the enemy, not the drone
  /* §3.1 scales the repair interval by difficulty. There is no difficulty setting in this build yet, so the
   * knob lives on `debug` where it is reachable and documented rather than being silently dead. */
  function difficultyMul() { return DIFF_MUL[debug.difficulty] || 1; }

  /* ── v1.4 cues ──
   * The lock beeps (660 / 880 / 1100 Hz), the block chime, the failed shot, the repair hum and the dash whoosh.
   * Built straight on the existing tone / noise primitives rather than extending sfx()'s chain, so the v1.4
   * sounds live with the v1.4 code and 40-audio.js keeps exactly the voices it shipped with. */
  function csfx(kind) {
    if (state.muted || !audio.ctx) return;
    const c = audio.ctx;
    try {
      if (c.state === 'suspended') safe(() => c.resume());
      const t = c.currentTime + 0.001;
      if (kind === 'lockWarn') tone(t, 'square', 660, 660, 0.09, 0.14, 0.1);
      else if (kind === 'lockClose') tone(t, 'square', 880, 880, 0.09, 0.16, 0.1);
      else if (kind === 'lockImminent') tone(t, 'square', 1100, 1100, 0.1, 0.18, 0.12);
      else if (kind === 'lockBreak') { tone(t, 'triangle', 700, 1500, 0.12, 0.24, 0.14); tone(t + 0.06, 'triangle', 1100, 2000, 0.1, 0.18, 0.12); }
      else if (kind === 'lockFire') { tone(t, 'sawtooth', 300, 90, 0.22, 0.45, 0.24); noiseBurst(t, 0.1, { type: 'lowpass', freq: 500, Q: 0.9 }, 0.35, 0.1); }
      else if (kind === 'repair') tone(t, 'sine', 420, 620, 0.25, 0.12, 0.28);
      else if (kind === 'repairDone') { tone(t, 'sine', 620, 320, 0.22, 0.2, 0.26); tone(t + 0.05, 'sine', 420, 220, 0.2, 0.14, 0.22); }
      else if (kind === 'dash') noiseSweep(t, 0.16, 'bandpass', 600, 3200, 0.28);
    } catch (e) { /* ignore */ }
  }
  function modeLabel(id) { return msg(MODE_NAME[id] || 'modeRampage'); }
  function modeDesc(id) { return msg(MODE_DESC[id] || 'modeRampageDesc'); }

  /* The single entry point. Everything that only exists in some modes is torn down / stood up from here, so a
   * mode switch can never leave another mode's machinery running (a lock frame in rampage, a drone in
   * quickdraw, a health bar where there is no health).
   * Named setPlayMode, not setMode: `setMode` is taken by the v1 WEAPON alias in 99-api.js, and two function
   * declarations of one name in this IIFE would silently leave only the last one. */
  function setPlayMode(id, opts) {
    if (!MODES.includes(id)) return state.mode;
    const silent = !!(opts && opts.silent);
    const prev = state.mode, changed = id !== prev;
    state.mode = id;
    if (id !== 'rampage') state.lastCombatMode = id;
    if (!silent) state.combatTouched = true;
    if (changed) {
      clearLocks();
      clearRepairs();
      if (id === 'rampage' || prev === 'rampage') clearCombatNodes();
    }
    if (!modeHasAvatar()) clearAvatar(); else ensureAvatar();
    if (!modeHasHealth()) hideKo();
    if (!modeHasRatio()) clearRatioMeter(); else syncRatioMeter(true);
    if (id === 'rampage') {
      untrack(state.combatTimer); state.combatTimer = 0;
      untrack(state.clockTimer); state.clockTimer = 0;
      untrack(state.regenTimer); state.regenTimer = 0;
      untrack(state.depthTimer); state.depthTimer = 0;
      if (silent) hideToast(false); else if (changed) toast(msg('toastCombatOff'));
    } else {
      if (changed || !state.combatTimer) armCombat();
      if (!silent && changed) toast(modeLabel(id) + ' · ' + modeDesc(id));
      if (state.player.hp < state.player.max) startRegen();
      if (modeHasAvatar() && !silent) maybeShowCombatHelp();
    }
    if (!silent) persistMode();
    updateHud(); updateModeHud(); updatePlayerHud(); updateRatioHud();
    return state.mode;
  }
  function cycleMode() { return setPlayMode(MODES[(MODES.indexOf(state.mode) + 1) % MODES.length]); }
  /* Legacy boolean (api.setCombat / the v1.3 e2e): true means the mode the player last fought in — survival
   * unless they explicitly chose quickdraw — and false is rampage. The STORED crsCombat migrates differently
   * (§0.5: true → quickdraw), because a stored pref comes from someone who only ever used the cursor. */
  function setCombat(v, opts) {
    setPlayMode(v ? (state.lastCombatMode || 'survival') : 'rampage', opts);
    return state.combat;
  }
  function persistMode() {
    safe(() => chrome.storage.sync.set({ crsMode: state.mode, crsCombat: state.mode !== 'rampage' }));
  }
  /* loadPrefs (99-api.js) hands us whatever was stored; crsMode wins, a legacy crsCombat boolean migrates. */
  function modeFromPrefs(res) {
    if (!res) return null;
    if (MODES.includes(res.crsMode)) return res.crsMode;
    if (typeof res.crsCombat === 'boolean') return res.crsCombat ? 'quickdraw' : 'rampage';
    return null;
  }

  /* ---- §1.3 the one-time control overlay (survival only, once per session) ---- */
  function keycap(text) {
    const n = mk('span', 'crs-help-key');
    n.textContent = text;
    return n;
  }
  function maybeShowCombatHelp() {
    if (state.seenHelp || !root || state.help) return;
    state.seenHelp = true;
    safe(() => chrome.storage.local.set({ crsSeenCombatHelp: true }));
    const box = mk('div', 'crs-help');
    const row = mk('div', 'crs-help-row');
    for (const k of ['W', 'A', 'S', 'D']) row.append(keycap(k));
    const t1 = mk('span', 'crs-help-text'); t1.textContent = msg('helpMove');
    const sp = keycap('Space');
    const t2 = mk('span', 'crs-help-text'); t2.textContent = msg('helpDash');
    const t3 = mk('span', 'crs-help-text'); t3.textContent = msg('helpAim');
    row.append(t1, sp, t2, t3);
    box.append(row);
    root.append(box);
    state.help = box;
    const kill = () => { if (state.help === box) state.help = null; try { cancelAnimsOf(box); box.remove(); } catch (e) { /* ignore */ } };
    try {
      const a = trackAnim(box.animate([{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: 3000, easing: 'linear', fill: 'forwards' }));
      a.addEventListener('finish', kill);
    } catch (e) { /* ignore */ }
    later(kill, 3200);
  }
  function clearHelp() {
    const n = state.help;
    state.help = null;
    if (n) { try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } }
  }

// ── 87-depth.js ──
// ── v1.4 §10: reading the page's own depth (stacking order) and turning it into combat roles ──
  /* A web page already HAS depth: z-index, stacking contexts, overlaps, sticky headers, modals. We never have to
   * invent it — `document.elementsFromPoint()` returns the whole stack at a point FRONT FIRST, so our element's
   * index in that list IS its depth. Measured only for hostile elements (five samples, median), so the cost is
   * five hit tests per hostile every two seconds.
   *
   * The roles that fall out of it (§10.2) are the point: the enemy that UNDOES your work sits at the back where
   * it is hard to reach, and the enemy that hurts you sits at the front where it dies fast. Clearing the front
   * is how you reach the back — no extra code, that is just what pickTarget already does. */

  function depthSamples(r) {
    return [
      { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 },
      { x: r.left + r.width * 0.25, y: r.top + r.height * 0.25 },
      { x: r.left + r.width * 0.75, y: r.top + r.height * 0.25 },
      { x: r.left + r.width * 0.25, y: r.top + r.height * 0.75 },
      { x: r.left + r.width * 0.75, y: r.top + r.height * 0.75 }
    ];
  }
  /* One sample: how many qualifying elements are painted in front of `el` at this point, or null when the sample
   * does not actually land on `el` (clipped away, scrolled out, covered by something that swallowed the hit). */
  function depthAt(el, x, y) {
    const vw = viewW(), vh = viewH();
    if (x < 0 || y < 0 || x > vw || y > vh) return null;
    let list;
    try { list = doc.elementsFromPoint(x, y); } catch (e) { return null; }
    if (!list || !list.length) return null;
    let n = 0;
    for (const c of list) {
      if (c === el) return n;
      if (!c || c.nodeType !== 1) continue;
      if (isOurs(c)) continue;                                    // our own glass-root nodes are not page depth
      try { if (c.contains(el) || el.contains(c)) continue; } catch (e) { continue; }   // ancestors and descendants
      const cr = rectOf(c);
      if (!cr || cr.width * cr.height < DEPTH_MIN_AREA) continue;   // decorative slivers are not cover
      n++;
    }
    return null;   // `el` was never reached: this sample missed it
  }
  function depthOf(el) {
    if (!el || el.nodeType !== 1 || !el.isConnected) return 0;
    const s = gcs(el);
    // a fixed / sticky element really is drawn on top of the flow it overlaps, whatever the hit test says
    if (s && (s.position === 'fixed' || s.position === 'sticky')) return 0;
    const r = rectOf(el);
    if (!r || r.width < 1 || r.height < 1) return 0;
    const vals = [];
    for (const p of depthSamples(r)) { const d = depthAt(el, p.x, p.y); if (d != null) vals.push(d); }
    if (!vals.length) return depthFromStacking(el, 0);   // scrolled out of view: elementsFromPoint cannot help
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];   // median, so one odd overlay cannot move a whole enemy to the back
  }
  /* Fallback when the element is not in the viewport (an API call about something scrolled away). Same question,
   * asked of the stacking rules instead of the hit test: at each level, how many overlapping siblings paint in
   * front of us — higher z-index, or equal z-index and later in the document — plus whatever is in front of our
   * parent. A child with no siblings of its own therefore inherits its parent's depth, which is right: it is
   * buried exactly as deep as the box it lives in. */
  function zOf(el) { const s = gcs(el); const z = s ? parseInt(s.zIndex, 10) : NaN; return isFinite(z) ? z : 0; }
  function frontSiblings(el) {
    const r = rectOf(el), parent = parentOf(el);
    if (!r || !parent) return 0;
    let kids = [];
    try { kids = Array.from(parent.children); } catch (e) { return 0; }
    const z = zOf(el);
    let n = 0;
    for (const c of kids) {
      if (c === el || !c || c.nodeType !== 1 || isOurs(c)) continue;
      try { if (c.contains(el) || el.contains(c)) continue; } catch (e) { continue; }
      const cr = rectOf(c);
      if (!cr || cr.width * cr.height < DEPTH_MIN_AREA) continue;
      if (cr.right <= r.left || cr.left >= r.right || cr.bottom <= r.top || cr.top >= r.bottom) continue;
      const cz = zOf(c);
      let later = false;
      try { later = !!(c.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING); } catch (e) { later = false; }
      if (cz > z || (cz === z && later)) n++;
    }
    return n;
  }
  function depthFromStacking(el, guard) {
    if (!el || el === doc.body || el === docEl || (guard || 0) > 8) return 0;
    const p = parentOf(el);
    return frontSiblings(el) + ((p && p !== doc.body && p !== docEl) ? depthFromStacking(p, (guard || 0) + 1) : 0);
  }
  function depthTier(d) { return d <= 0 ? 'front' : (d <= 2 ? 'mid' : 'back'); }
  function depthMark(tier) { return tier === 'front' ? '▲' : (tier === 'back' ? '▲▲▲' : '▲▲'); }

  /* The aura label is composed from parts, never appended to: the 🎯 of an aim line (§3.2) and the ▲ depth mark
   * both live in it and each is rewritten independently. */
  function setHostileLabel(rec) {
    if (!rec || !rec.label) return;
    try {
      rec.label.textContent = (rec.aim ? '🎯 ' : '') + '👿 ' + tagOf(rec.el).toUpperCase() + ' ' + depthMark(rec.dtier || 'mid');
    } catch (e) { /* ignore */ }
  }
  /* back enemies read as "further away": blurred, desaturated, dashed. While one is actually repairing (§10.4)
   * the blur comes OFF and the aura brightens — the enemy undoing your work has to be visible to be worth the trip. */
  function applyDepthLook(rec) {
    if (!rec || !rec.aura) return;
    try {
      rec.aura.classList.toggle('crs-depth-front', rec.dtier === 'front');
      rec.aura.classList.toggle('crs-depth-back', rec.dtier === 'back');
    } catch (e) { /* ignore */ }
    setHostileLabel(rec);
  }
  function measureDepth(rec) {
    if (!rec || !rec.el) return;
    rec.depth = depthOf(rec.el);
    const t = depthTier(rec.depth);
    if (t !== rec.dtier) { rec.dtier = t; applyDepthLook(rec); }
    rec.depthAt = now();
  }
  /* §10.1 item 6: once on selection, then every two seconds for every live hostile. One later() chain, never a
   * setInterval, so clearTimers() takes it with everything else. */
  function depthTick() {
    state.depthTimer = 0;
    if (!state.active || !modeHasEnemies() || state.paused) return;
    for (const rec of state.hostiles.values()) measureDepth(rec);
    state.depthTimer = later(depthTick, DEPTH_REFRESH_MS);
  }
  function armDepthTick() {
    if (state.depthTimer || !state.active || !modeHasEnemies()) return;
    state.depthTimer = later(depthTick, DEPTH_REFRESH_MS);
  }
  function hostilesByTier() {
    const out = { front: 0, mid: 0, back: 0 };
    for (const rec of state.hostiles.values()) out[rec.dtier || 'mid']++;
    return out;
  }
  /* §10.2 role multipliers. A zero means "this tier never does that at all". */
  function depthAttackMul(rec) { const k = DEPTH_ATTACK[(rec && rec.dtier) || 'mid']; return k == null ? 1 : k; }
  function depthRepairMul(rec) { const k = DEPTH_REPAIR[(rec && rec.dtier) || 'mid']; return k == null ? 1 : k; }
  function depthHpMul(tier) { const k = DEPTH_HP[tier || 'mid']; return k == null ? 1 : k; }
  /* Applied once, when the element becomes hostile: hpOf() may already have cached a plain max from a hover. */
  function applyDepthHp(el, tier) {
    const rec = state.hp.get(el);
    if (!rec || rec.depthScaled === tier) return;
    const base = rec.baseMax != null ? rec.baseMax : (rec.baseMax = rec.max);
    const ratio = rec.max > 0 ? clamp(rec.hp / rec.max, 0, 1) : 1;
    rec.max = clamp(Math.round(base * depthHpMul(tier)), 10, 400);
    rec.hp = Math.max(1, Math.round(rec.max * ratio));
    rec.depthScaled = tier;
  }

  /* §10.4: is this enemy actually shootable right now, or is something painted over it? The honest test is the
   * one the player's click will run — pickTarget at the enemy centre. */
  function isCovered(el) {
    const r = rectOf(el);
    if (!r || r.width < 1 || r.height < 1) return false;
    const picked = pickTarget(r.left + r.width / 2, r.top + r.height / 2, null, { noLock: true });
    if (!picked) return true;
    if (picked === el) return false;
    try { return !el.contains(picked); } catch (e) { return true; }
  }
  /* §10.3 item 2. The table entry is read defensively so this works whether or not the weapon stats carry
   * `pierce` yet — the sniper is the one hitscan weapon the spec gives a value to. */
  function pierceOf(id) {
    const W = WEAPONS[id];
    if (W && typeof W.pierce === 'number') return W.pierce;
    return id === 'sniper' ? 2 : 0;
  }
  function canPierceNow() { return pierceOf(state.weapon) > 0; }
  /* ── §10.3 item 2: PIERCE ──
   * A hitscan weapon with `pierce` keeps going after its front target, hitting the next qualifying elements down
   * the same stack at ×0.6 per layer. It hangs off interceptOrb(), which every click weapon already calls with
   * the exact impact point BEFORE the page is hit — so the primary hit stays entirely in the weapon code and
   * the only thing living here is what happens behind it. Deferred by one task so the front target has already
   * resolved (and possibly broken) before we look at what is behind it.
   * §10.3 item 3 (aoeIgnoresCover) needs no code: aoeCandidates() samples rings of POINTS, so a blast already
   * reaches whatever is inside its radius no matter how many layers are painted over it. */
  function schedulePierce(x, y) {
    const n = pierceOf(state.weapon);
    if (!n || !state.active) return;
    const W = WEAPONS[state.weapon];
    const base = W ? W.damage : 0;
    if (!(base > 0) || !isFinite(base)) return;
    const front = pickTarget(x, y, null, { noLock: true });
    later(() => applyPierce(x, y, front, n, base), 0);
  }
  function applyPierce(x, y, front, n, base) {
    if (!state.active) return;
    let list = [];
    try { list = doc.elementsFromPoint(x, y); } catch (e) { return; }
    let layer = 0;
    for (const c of list) {
      if (layer >= n) break;
      if (!c || c.nodeType !== 1 || isOurs(c) || c === doc.body || c === docEl) continue;
      if (c === front) continue;
      try { if (front && (c.contains(front) || front.contains(c))) continue; } catch (e) { continue; }
      try { if (c.hasAttribute('data-crs-broken')) continue; } catch (e) { continue; }
      if (SKIP_WALK_TAGS.has(tagOf(c))) continue;
      const r = rectOf(c);
      if (!r || r.width * r.height < DEPTH_MIN_AREA) continue;
      layer++;
      pierceMark(r);
      applyHit(c, Math.max(1, Math.round(base * Math.pow(0.6, layer))), 'gun', x, y, { pierce: true });
    }
  }
  /* ── §10.3 item 3: explosions ignore cover ──
   * aoeCandidates() samples rings of POINTS and keeps only what pickTarget() returns at each — the topmost
   * element. That makes a blast respect cover, which is the opposite of what §10.3 promises. This pass walks the
   * SAME points and picks up what is behind the front element at each one, so a rocket reaches the back rank
   * whatever is painted over it. Deferred one task, so the ordinary blast has already resolved and this only
   * adds the layers it could not see; `aoeIgnoresCover` is the flag that documents it.
   * Nothing is double-hit: anything pickTarget() would have returned is skipped, as is its own subtree. */
  const aoeIgnoresCover = true;
  function scheduleBlastThroughCover(x, y, R) {
    const W = WEAPONS[state.weapon];
    if (!aoeIgnoresCover || !W || W.kind !== 'bomb' || !(W.damage > 0) || !isFinite(W.damage)) return;
    later(() => blastThroughCover(x, y, R, W.damage, W.maxTargets || 10), 0);
  }
  function blastThroughCover(x, y, R, damage, maxTargets) {
    if (!state.active || !(R > 0)) return;
    const points = [{ x, y }];
    for (const k of [0.35, 0.7, 1]) {
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; points.push({ x: x + Math.cos(a) * k * R, y: y + Math.sin(a) * k * R }); }
    }
    const cache = new Map(), seen = new Set();
    const vw = viewW(), vh = viewH();
    let hits = 0;
    for (const p of points) {
      if (hits >= maxTargets) break;
      if (p.x < 0 || p.y < 0 || p.x > vw || p.y > vh) continue;
      const front = pickTarget(p.x, p.y, cache, { noLock: true });
      let list = [];
      try { list = doc.elementsFromPoint(p.x, p.y); } catch (e) { continue; }
      for (const c of list) {
        if (hits >= maxTargets) break;
        if (!c || c.nodeType !== 1 || isOurs(c) || c === doc.body || c === docEl) continue;
        if (c === front || seen.has(c) || SKIP_WALK_TAGS.has(tagOf(c))) continue;
        try { if (front && (c.contains(front) || front.contains(c))) continue; } catch (e) { continue; }
        try { if (c.hasAttribute('data-crs-broken')) continue; } catch (e) { continue; }
        const cr = rectOf(c);
        if (!cr || cr.width * cr.height < DEPTH_MIN_AREA) continue;
        const d = edgeDist(cr, x, y);
        if (d > R) continue;
        seen.add(c);
        hits++;
        applyHit(c, Math.max(1, Math.round(damage * (1 - 0.73 * clamp(d / R, 0, 1)))), 'bomb', x, y, { aoe: true, radius: R, toward: { x, y } });
      }
    }
  }
  /* A thin white line across each pierced element for 0.2 s — the shot went THROUGH, and you can see where. */
  function pierceMark(r) {
    if (!root || reducedMotion()) return;
    const n = mk('div', 'crs-pierce');
    n.style.left = px(r.left); n.style.top = px(r.top + r.height / 2); n.style.width = px(r.width); n.style.height = '2px';
    root.append(n);
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
    try { const a = trackAnim(n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' })); a.addEventListener('finish', kill); } catch (e) { /* ignore */ }
    later(kill, 400);
  }
  /* §10.4: "뒤에 적 N" on the target box — the thing under your cursor is cover, and this says how much. */
  function hostilesBehind(el) {
    if (!el || !state.hostiles.size) return 0;
    const r = rectOf(el);
    if (!r) return 0;
    let n = 0;
    for (const rec of state.hostiles.values()) {
      const h = rec.el;
      if (h === el) continue;
      try { if (h.contains(el) || el.contains(h)) continue; } catch (e) { continue; }
      const hr = rectOf(h);
      if (!hr || hr.right <= r.left || hr.left >= r.right || hr.bottom <= r.top || hr.top >= r.bottom) continue;
      if ((rec.depth || 0) > 0 || isCovered(h)) n++;
    }
    return n;
  }

// ── 88-toast.js ──
  /* --- toast (§7 / A11): one node in the HUD shadow root, textContent swapped, hide timer in state.toastTimer --- */
  function toast(text) {
    const n = hudEls.toast;
    if (!n) return;
    try {
      n.textContent = text;
      n.classList.add('show');
      if (hudEls.fallback) n.style.display = 'block';
      cancelAnimsOf(n);
      trackAnim(n.animate([{ opacity: 0, transform: 'translate(-50%, -8px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 220, easing: 'ease-out', fill: 'forwards' }));
    } catch (e) { /* ignore */ }
    untrack(state.toastTimer);
    state.toastTimer = later(() => { state.toastTimer = 0; hideToast(true); }, 220 + 1800);
  }
  function hideToast(fade) {
    const n = hudEls.toast;
    if (!n) return;
    untrack(state.toastTimer); state.toastTimer = 0;
    const off = () => { try { n.classList.remove('show'); } catch (e) { /* ignore */ } if (hudEls.fallback) n.style.display = 'none'; };
    cancelAnimsOf(n);
    if (!fade || reducedMotion()) { off(); return; }
    try { const a = trackAnim(n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' })); a.addEventListener('finish', off); a.addEventListener('cancel', off); } catch (e) { off(); }
  }

// ── 89-beams.js ──
// ── T3 laser beams: track / lock / fire phases, lock-in markers, beam hit test ──
  /* Split out of 90-combat.js in v1.3 so both files stay readable.
   *
   * v1.3 §3.3 makes the three phases tell the player what to do:
   *   track (550 ms)  thin red DASHES that follow the player — "it is finding you"
   *   lock  (250 ms)  tracking STOPS and the line turns a solid ORANGE, with two markers
   *                   sliding inward from the ends — "this is where it will hit, move"
   *   fire  (400 ms)  thick red line, 16 px hit band, 30 damage once
   * Timings, damage and the hit band are unchanged (§4) — only the reading of them is. */
  function attackLaser(rec, r) {
    if (!root) { scheduleAttack(rec, attackInterval(rec)); return; }
    rec.phase = 'track';
    addAimLine(rec);   // v1.3 §3.2: "this one is aiming at me"
    const horizontal = r.width >= r.height;
    const node = mk('div', 'crs-beam crs-beam-telegraph telegraph');
    const b = { rec, node, horizontal, pos: horizontal ? state.player.y : state.player.x, phase: 'track', hit: false };
    rec.beam = b;
    state.beams.push(b);
    root.append(node);
    placeBeam(b);
    rec.timer = later(() => {
      rec.timer = 0;
      b.phase = 'lock'; rec.phase = 'lock';
      try { node.classList.add('crs-beam-lock'); } catch (e) { /* ignore */ }
      placeBeam(b);
      lockMarks(b);   // the "it stopped following you" cue
      rec.timer = later(() => { rec.timer = 0; fireBeam(b); }, 250);
    }, 550);
    kick();
  }
  /* Two markers that slide from the ends of the locked line toward its middle over 250 ms. They are rec.nodes, so
   * clearPhase() / releaseHostile() / pauseCombat() take them with everything else. */
  function lockMarks(b) {
    const rec = b.rec;
    if (!root || reducedMotion()) return;
    const W = viewW(), H = viewH(), L = b.horizontal ? W : H, reach = L * 0.42;
    for (const dir of [1, -1]) {
      const n = mk('div', 'crs-beam-mark');
      if (b.horizontal) { n.style.left = px(dir > 0 ? 0 : W - 16); n.style.top = px(b.pos - 8); }
      else { n.style.left = px(b.pos - 8); n.style.top = px(dir > 0 ? 0 : H - 16); }
      root.append(n);
      rec.nodes.push(n);
      const to = b.horizontal ? 'translate(' + px(dir * reach) + ', 0px)' : 'translate(0px, ' + px(dir * reach) + ')';
      try { trackAnim(n.animate([{ transform: 'translate(0px, 0px)', opacity: 1 }, { transform: to, opacity: 0 }], { duration: 250, easing: 'ease-in', fill: 'forwards' })); } catch (e) { /* ignore */ }
    }
  }
  function placeBeam(b) {
    const s = b.node.style, th = b.phase === 'fire' ? 6 : (b.phase === 'lock' ? 3 : 2);
    if (b.horizontal) { s.left = '0px'; s.top = px(b.pos - th / 2); s.width = px(viewW()); s.height = px(th); }
    else { s.top = '0px'; s.left = px(b.pos - th / 2); s.height = px(viewH()); s.width = px(th); }
    s.backgroundImage = b.phase === 'track' ? 'repeating-linear-gradient(' + (b.horizontal ? '90deg' : '180deg') + ', rgba(255,60,60,.85) 0 10px, transparent 10px 18px)' : 'none';
  }
  function fireBeam(b) {
    const rec = b.rec;
    if (state.beams.indexOf(b) < 0) return;
    b.phase = 'fire'; rec.phase = 'fire';
    b.node.className = 'crs-beam crs-beam-fire fire';
    placeBeam(b);
    dropAimLine(rec);
    sfx('laser');
    checkBeamHit(b);
    rec.timer = later(() => { rec.timer = 0; removeBeam(b); rec.phase = 'idle'; scheduleAttack(rec, attackInterval(rec)); }, 400);
    kick();
  }
  function checkBeamHit(b) {
    if (b.hit || b.phase !== 'fire') return;
    const p = state.player;
    if (!p.alive || state.ko) return;
    const d = b.horizontal ? Math.abs(p.y - b.pos) : Math.abs(p.x - b.pos);
    // the damage source is the point of the line nearest the player, so the directional vignette points at the beam
    if (d <= 16) { b.hit = true; vignette(true); damagePlayer(30, { from: b.horizontal ? { x: p.x, y: b.pos } : { x: b.pos, y: p.y } }); }
  }
  function beamStep() {
    for (const b of state.beams.slice()) {
      if (b.phase === 'track') { b.pos = b.horizontal ? state.player.y : state.player.x; placeBeam(b); }
      else if (b.phase === 'fire') checkBeamHit(b);
    }
  }
  function removeBeam(b) {
    const i = state.beams.indexOf(b);
    if (i >= 0) state.beams.splice(i, 1);
    if (b.rec && b.rec.beam === b) b.rec.beam = null;
    try { cancelAnimsOf(b.node); b.node.remove(); } catch (e) { /* ignore */ }
  }
  function clearBeams() { for (const b of state.beams.slice()) removeBeam(b); }
  function clearWarns() { for (const n of state.warns) { try { n.remove(); } catch (e) { /* ignore */ } } state.warns.length = 0; }

  // ── v1.4 §4: T3 now draws a lock frame instead of a laser, so the sweep is kept for the boss's third phase ──
  /* The laser code above is unchanged and still reachable: §4 moves it onto the boss (phase 3, "레이저 쓸기")
   * rather than deleting it. Until the boss lands, this hook is how the sweep is exercised. */
  debug.forceLaser = (el) => {
    if (!state.active || !modeHasEnemies() || state.paused || state.ko) return null;
    bringIntoView(el);
    const existing = state.hostiles.get(el) || null;
    let rec = existing;
    if (!rec) { const area = hostileArea(el); if (area == null) return null; rec = markHostile(el, area); }
    if (!rec) return null;
    const r = rectOf(rec.el);
    if (!r) return null;
    untrack(rec.timer); rec.timer = 0;
    clearPhase(rec);
    attackLaser(rec, r);
    return 'laser';
  };

// ── 90-combat.js ──
  /* --- combat (A7–A10): player, selection tick, hostiles, attacks, orbs, KO ---
   * v1.3: the T3 laser lives in 89-beams.js and everything about how an attack READS — the player ring, the aim
   * lines, orb legibility, near misses, the hit reaction and the player HUD — lives in 91-combat-feedback.js. The
   * patterns, intervals, damage values, tiers and scoring in this file are untouched (SPEC-readability §4). */
  function combatElapsed() {
    const p = state.player;
    if (!p.startedAt) return 0;
    return Math.max(0, (state.paused ? p.pausedAt : now()) - p.startedAt - p.pausedTotal);
  }
  function maxHostiles() { return combatElapsed() >= 60000 ? 5 : 3; }
  function tierFor(area) { return area > 400000 ? 'laser' : (area >= 150000 ? 'charger' : (area >= 40000 ? 'shooter' : null)); }
  /* v1.4 §10.2: a `front` enemy attacks 30 % more often; a `back` enemy never attacks at all (mul 0). */
  function attackInterval(rec) { return TIER_BASE[rec.tier] * Math.max(0.5, 1 - combatElapsed() / 120000) * (depthAttackMul(rec) || 1); }
  function resetPlayer() {
    const p = state.player;
    p.hp = p.max; p.score = 0; p.kills = 0; p.alive = true; p.startedAt = now(); p.pausedAt = state.paused ? now() : 0; p.pausedTotal = 0; p.lastDamageAt = 0; p.lastRegenAt = 0; p.lastHitFrom = null;
    // v1.4 §1.2: in survival the player IS the drone, so a reset parks it centre-bottom with no momentum
    state.dashUntil = 0; state.dashReadyAt = 0; state.invulUntil = 0; state.dashVx = 0; state.dashVy = 0;
    p.vx = 0; p.vy = 0;
    if (modeHasAvatar()) avatarStart();
  }
  function playerInfo() {
    const p = state.player;
    return { hp: Math.max(0, Math.round(p.hp)), max: p.max, score: p.score, kills: p.kills, alive: p.alive, elapsedMs: Math.round(combatElapsed()), x: p.x, y: p.y,
      lastHitFrom: p.lastHitFrom ? { x: p.lastHitFrom.x, y: p.lastHitFrom.y } : null,   // v1.3 §5: where the last hit came from
      // v1.4 §5: x / y are now the DRONE's centre in survival; the velocity and dash cooldown come with them
      vx: p.vx || 0, vy: p.vy || 0, dashReadyAt: dashReadyWallClock(), hitRadius: AV_HIT_R, mode: state.mode };
  }
  function hostileSkip(el) {
    if (state.hostiles.has(el)) return true;
    for (const h of state.hostiles.keys()) { try { if (h.contains(el) || el.contains(h)) return true; } catch (e) { /* ignore */ } }
    return false;
  }
  /* Page-space area when `el` is a valid hostile candidate right now, else null (selectTick and forceAttack share it). */
  function hostileArea(el) {
    if (!el || el.nodeType !== 1 || !el.isConnected || isOurs(el)) return null;
    try { if (el.hasAttribute('data-crs-broken')) return null; } catch (e) { return null; }
    if (SKIP_WALK_TAGS.has(tagOf(el)) || hostileSkip(el)) return null;
    const s = gcs(el); if (!s || s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) return null;
    const r = rectOf(el); if (!r || r.width < 1 || r.height < 1) return null;
    const vw = viewW(), vh = viewH();
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return null;
    const m = scopeMag();
    const area = (r.width / m) * (r.height / m);
    if (area < 40000 || area > 0.7 * vw * vh) return null;
    return area;
  }
  function armCombat() {
    untrack(state.combatTimer); state.combatTimer = 0;
    untrack(state.clockTimer); state.clockTimer = 0;
    if (!state.active || !state.combat || state.paused) return;
    state.graceUntil = now() + GRACE_MS;
    state.combatTimer = later(selectTick, GRACE_MS);
    state.clockTimer = later(clockTick, 1000);
    armDepthTick();          // v1.4 §10.1
    syncRatioMeter(false);   // v1.4 §3.2
    if (modeHasAvatar()) ensureAvatar();   // v1.4 §1
  }
  /* The 생존 counter is a visible clock: the 1.5 s selection tick alone leaves it frozen through the whole
   * grace and then skips seconds, so the player HUD gets its own 1 s refresh chain (never setInterval). */
  function clockTick() {
    state.clockTimer = 0;
    if (!state.active || !state.combat || state.paused) return;
    updatePlayerHud();
    state.clockTimer = later(clockTick, 1000);
  }
  function selectTick() {
    state.combatTimer = 0;
    if (!state.active || !state.combat || state.paused) return;
    state.combatTimer = later(selectTick, 1500);
    updatePlayerHud();
    const p = state.player;
    if (state.ko || !p.alive || debug.noAttacks || state.scoped || !p.inWindow) return;
    try { if (doc.visibilityState === 'hidden') return; } catch (e) { /* ignore */ }
    if (state.hostiles.size >= maxHostiles()) return;
    const cands = walkCandidates(p.x, p.y, { limit: 0.7 * viewW() * viewH(), minArea: 40000, descendCollected: true, skip: hostileSkip });
    if (!cands.length) return;
    let total = 0;
    for (const c of cands) { c.w = Math.sqrt(c.area); total += c.w; }   // weighted by sqrt(area)
    let r = Math.random() * total, pick = cands[cands.length - 1];
    for (const c of cands) { r -= c.w; if (r <= 0) { pick = c; break; } }
    markHostile(pick.el, pick.area);
  }
  function placeAura(rec) {
    const r = rectOf(rec.el); if (!r) return;
    const a = rec.aura.style;
    a.left = px(r.left); a.top = px(r.top); a.width = px(r.width); a.height = px(r.height);
  }
  function setAuraPulse(rec, ms) {
    if (reducedMotion()) ms = Math.max(ms, 900);   // the warn ring still telegraphs the slam
    try {
      if (rec.pulse) { rec.pulse.cancel(); state.anims.delete(rec.pulse); }
      rec.pulse = trackAnim(rec.aura.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: ms, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' }));
    } catch (e) { rec.pulse = null; }
  }
  /* One-shot RAF (pattern of scheduleHover) from scroll / resize / attacks: auras follow the element rects; a hostile
   * fully off-screen for > 2 s is released (no kill, no score). */
  function scheduleAura() {
    if (state.auraRaf || !state.active) return;
    state.auraRaf = raf(() => {
      state.auraRaf = 0;
      const vw = viewW(), vh = viewH(), t = now();
      for (const rec of Array.from(state.hostiles.values())) {
        const r = rectOf(rec.el);
        const onScreen = !!(r && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh);
        if (!onScreen) { if (!rec.offscreenSince) rec.offscreenSince = t; else if (t - rec.offscreenSince > 2000) { releaseHostile(rec.el); continue; } }
        else rec.offscreenSince = 0;
        placeAura(rec);
      }
    });
  }
  function markHostile(el, area) {
    if (!root || state.hostiles.has(el)) return state.hostiles.get(el) || null;
    const tier = tierFor(area);
    if (!tier) return null;
    const aura = mk('div', 'crs-hostile');
    const label = mk('span', 'crs-hostile-label');
    label.textContent = '👿 ' + tagOf(el).toUpperCase();   // recomposed with the ▲ depth mark below
    aura.append(label);
    root.append(aura);
    const rec = { el, tier, area, aura, label, phase: 'idle', timer: 0, nodes: [], pulse: null, beam: null, aim: null, offscreenSince: 0, nextAttackAt: 0, markedAt: now(),
      // v1.4: depth role (§10), the lock frame it owns (§2) and its repair schedule (§3)
      depth: 0, dtier: 'mid', depthAt: 0, lock: null, lockReadyAt: 0, repairTimer: 0 };
    state.hostiles.set(el, rec);
    measureDepth(rec);           // v1.4 §10.1: once on selection, then every 2 s
    applyDepthLook(rec);
    /* v1.4 §10.2: front ×0.8, mid ×1.0, back ×1.2. Applied whenever an element becomes hostile — an element's
     * depth role IS part of what it is as an enemy, and it has to hold whether or not the element happened to be
     * hovered first (a hover caches HP too, so keying this off "first contact" made the role come and go). */
    hpOf(el);   // page-space max HP cached now (scope never runs the picker)
    applyDepthHp(el, rec.dtier);
    placeAura(rec);
    setAuraPulse(rec, 900);
    scheduleAttack(rec, attackInterval(rec));
    scheduleRepair(rec);         // v1.4 §3.1
    scheduleAura();
    armDepthTick();
    updatePlayerHud();
    kick();
    return rec;
  }
  function scheduleAttack(rec, ms) {
    untrack(rec.timer);
    rec.nextAttackAt = now() + ms;
    rec.timer = later(() => { rec.timer = 0; hostileAttack(rec, false); }, ms);
  }
  function clearPhase(rec) {   // telegraph / beam / warn / lock-mark nodes of this hostile; pulse back to idle
    dropAimLine(rec);   // v1.3 §3.2: the "aiming at you" line never outlives the wind-up it belongs to
    dropLock(rec);      // v1.4 §2: so does the lock frame
    for (const n of rec.nodes) { try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } const i = state.warns.indexOf(n); if (i >= 0) state.warns.splice(i, 1); }
    rec.nodes.length = 0;
    if (rec.beam) { removeBeam(rec.beam); rec.beam = null; }
    if (rec.phase === 'telegraph' && state.hostiles.get(rec.el) === rec) setAuraPulse(rec, 900);
    rec.phase = 'idle';
  }
  function releaseHostile(el) {
    const rec = state.hostiles.get(el);
    if (!rec) return;
    state.hostiles.delete(el);
    untrack(rec.timer); rec.timer = 0;
    untrack(rec.repairTimer); rec.repairTimer = 0;   // v1.4 §3.1
    dropRepairsOf(rec);                              // a beam cannot outlive the enemy casting it
    clearPhase(rec);
    dropAimLine(rec, true);   // the hostile itself is going — its line cannot linger
    try { if (rec.pulse) { rec.pulse.cancel(); state.anims.delete(rec.pulse); } } catch (e) { /* ignore */ }
    try { rec.aura.remove(); } catch (e) { /* ignore */ }
    updatePlayerHud();
  }
  function hostileKilled(el, max) {
    const rec = state.hostiles.get(el);
    if (!rec) return;
    const clutch = rec.phase !== 'idle';   // mid-telegraph / wind-up / track / lock / fire → ×1.5 (A10)
    const r = rectOf(el);
    releaseHostile(el);
    const p = state.player;
    p.score += clutch ? Math.round(max * 1.5) : max;
    p.kills++;
    if (r) { const v = intersectRect(r, { left: 0, top: 0, right: viewW(), bottom: viewH() }); spawnDmg(v.left + v.width / 2, v.top + v.height / 2, 0, true, { text: msg('killLabel'), color: '#7ee787' }); }
    sfx('kill');
    updatePlayerHud(); scheduleHud();
  }
  function clearCombatNodes() {
    for (const el of Array.from(state.hostiles.keys())) releaseHostile(el);
    clearOrbs(); clearBeams(); clearWarns(); clearAimLines();
    clearLocks(); clearRepairs();   // v1.4 §2 / §3
  }
  /* Returns the attack that actually started ('shooter' | 'charger' | 'lock') or false; debug.forceAttack
   * reports exactly that. v1.4 §4: quickdraw enemies only ever lock on, T3 everywhere is a lock instead of the
   * laser, and §10.2 silences the back rank entirely. */
  function hostileAttack(rec, forced) {
    if (!state.active || !state.combat || state.hostiles.get(rec.el) !== rec || state.paused || state.ko) return false;
    const el = rec.el;
    if (!el.isConnected || el.hasAttribute('data-crs-broken')) { releaseHostile(el); return false; }
    const r = rectOf(el), vw = viewW(), vh = viewH();
    const onScreen = !!(r && r.width >= 1 && r.height >= 1 && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh);
    if (!onScreen) {   // off-screen: skipped (re-armed); released after > 2 s
      const t = now();
      if (!rec.offscreenSince) rec.offscreenSince = t;
      if (t - rec.offscreenSince > 2000) { releaseHostile(el); return false; }
      scheduleAttack(rec, attackInterval(rec));
      return false;
    }
    rec.offscreenSince = 0;
    // v1.4 §1.2: the drone stays whether or not the pointer is in the window, so inWindow no longer gates it
    const awake = modeHasAvatar() ? state.player.alive : (state.player.inWindow && state.player.alive);
    if (!forced && (debug.noAttacks || !awake)) { scheduleAttack(rec, attackInterval(rec)); return false; }
    if (forced) { untrack(rec.timer); rec.timer = 0; clearPhase(rec); }
    scheduleAura();
    // §10.2: the back rank is support — it repairs, it never shoots
    if (!depthAttackMul(rec)) { if (!forced) scheduleAttack(rec, attackInterval(rec)); return false; }
    /* §4 boss: 1st stage orbs, 2nd adds the slam, 3rd brings back the T3 LASER SWEEP (89-beams.js, kept for
     * exactly this). A boss locks on as well — the sweep is what the third stage ADDS, not what it replaces. */
    if (isBoss(rec) && modeHasProjectiles()) {
      const phase = bossPhase(rec);
      if (phase >= 3) { attackLaser(rec, r); return 'laser'; }
      if (phase >= 2 && Math.random() < 0.5) { attackCharger(rec, r); return 'charger'; }
      if (Math.random() < 0.6) { attackShooter(rec, r, forced); return 'shooter'; }
      return startLock(rec, forced) ? 'lock' : false;
    }
    // §4: orbs and slams are survival-only; everything else (and every T3) draws a lock instead
    if (!modeHasProjectiles() || rec.tier === 'laser') return startLock(rec, forced) ? 'lock' : false;
    if (rec.tier === 'shooter') attackShooter(rec, r, forced);
    else attackCharger(rec, r);
    return rec.tier;
  }
  /* T1 shooter: wind-up 250 ms at the element centre (forced: none), then an orb toward the player at 520 px/s. */
  function attackShooter(rec, r, forced) {
    spawnOrb(rec, r.left + r.width / 2, r.top + r.height / 2, forced ? 0 : 250);
    scheduleAttack(rec, attackInterval(rec));
  }
  function spawnOrb(rec, x, y, windup) {
    if (!root) return null;
    const n = mk('div', 'crs-orb');
    n.style.left = px(x - ORB_R); n.style.top = px(y - ORB_R);   // v1.3 §3.3: 22 px, so it can be seen coming
    root.append(n);
    const t = now();
    const o = { node: n, rec, x, y, x0: x, y0: y, vx: 0, vy: 0, bornAt: t, launchAt: t + windup, launched: false, dmg: 8 + Math.round(Math.sqrt(rec.area) / 60),
      ring: null, trail: null, hist: null, flightMs: 0, minD: Infinity, minAt: null, nearDone: false };
    state.orbs.push(o);
    orbVisuals(o);
    addAimLine(rec);   // §3.2 — also for a forced (zero wind-up) shot, which the min hold time keeps visible
    if (windup > 0) { rec.phase = 'windup'; n.style.transform = 'scale(.3)'; } else launchOrb(o);
    kick();
    return o;
  }
  function launchOrb(o) {
    const p = state.player;
    const dx = p.x - o.x, dy = p.y - o.y, L = Math.hypot(dx, dy) || 1;
    o.vx = dx / L * 520; o.vy = dy / L * 520; o.launched = true; o.launchAt = now();
    o.flightMs = Math.max(1, L / 520 * 1000);   // the arrival ring shrinks over exactly this long (§3.3)
    o.node.style.transform = 'translate(0px, 0px)';
    if (o.rec && o.rec.phase === 'windup') o.rec.phase = 'idle';
    dropAimLine(o.rec);   // the line goes with the shot
  }
  /* A10: the clutch bonus reads rec.phase, and only launchOrb() clears 'windup' — an orb that is removed before it
   * ever launches (interception, KO, restore) must put its hostile back to idle. */
  function orbGone(o) { if (!o) return; orbVisualsRemove(o); if (o.rec && !o.launched && o.rec.phase === 'windup') o.rec.phase = 'idle'; }
  function removeOrbAt(i) { const o = state.orbs[i]; state.orbs.splice(i, 1); orbGone(o); try { o.node.remove(); } catch (e) { /* ignore */ } }
  function clearOrbs() { for (const o of state.orbs) { orbGone(o); try { o.node.remove(); } catch (e) { /* ignore */ } } state.orbs.length = 0; }
  function orbStep(t, dt) {
    const p = state.player, W = viewW(), H = viewH();
    for (let i = state.orbs.length - 1; i >= 0; i--) {
      const o = state.orbs[i];
      if (!o) continue;   // the array can shrink under us (a hit that KOs the player clears every orb)
      if (!o.launched) {
        if (t < o.launchAt) { const k = 0.3 + 0.7 * clamp((t - o.bornAt) / Math.max(1, o.launchAt - o.bornAt), 0, 1); o.node.style.transform = 'scale(' + k.toFixed(3) + ')'; continue; }
        launchOrb(o);
      }
      const nx = o.x + o.vx * dt, ny = o.y + o.vy * dt;
      if (p.alive && !state.ko) {   // swept segment hit (no tunnelling at low frame rates)
        const q = nearestOnSegment(o.x, o.y, nx, ny, p.x, p.y);
        // damagePlayer() may KO the player, and showKo() → clearOrbs() empties state.orbs while we are iterating it
        if (Math.hypot(q.x - p.x, q.y - p.y) < ORB_HIT_R) { removeOrbAt(i); damagePlayer(o.dmg, { from: q }); if (state.ko || !state.orbs.length) return; continue; }
      }
      o.x = nx; o.y = ny;
      if (t - o.launchAt > 3000 || nx < -20 || ny < -20 || nx > W + 20 || ny > H + 20) { removeOrbAt(i); continue; }
      o.node.style.transform = 'translate(' + px(nx - o.x0) + ', ' + px(ny - o.y0) + ')';
      orbReadability(o, t);   // v1.3 §3.3 / §3.4: arrival ring, afterimages, will-hit tint, graze detection
    }
  }
  function popOrb(o) {
    const i = state.orbs.indexOf(o);
    if (i >= 0) state.orbs.splice(i, 1);
    orbGone(o);
    try { o.node.remove(); } catch (e) { /* ignore */ }
    state.player.score += 5;
    sfx('pop');
    flash(o.x, o.y, 'gun', { size: 44, dur: 120 });
    updatePlayerHud(); scheduleHud();
  }
  function interceptOrb(x, y) {
    hitRepairBeams(x, y, 14);   // v1.4 §3.1: a shot across a repair beam delays it 0.4 s — it never absorbs the shot
    for (const o of state.orbs.slice()) { if (Math.hypot(o.x - x, o.y - y) <= 18) { popOrb(o); return true; } }
    schedulePierce(x, y);       // v1.4 §10.3: the shot reaches the page, so it can also go THROUGH it
    return false;
  }
  function interceptOrbsWithin(x, y, R) {
    hitRepairBeamsWithin(x, y, R);      // v1.4 §3.1
    scheduleBlastThroughCover(x, y, R); // v1.4 §10.3: a blast reaches what is hiding behind cover
    let n = 0;
    for (const o of state.orbs.slice()) { if (Math.hypot(o.x - x, o.y - y) <= R) { popOrb(o); n++; } }
    return n;
  }
  function interceptOrbsAlong(x1, y1, x2, y2, R) {
    hitRepairBeamsAlong(x1, y1, x2, y2, R);   // v1.4 §3.1
    let n = 0;
    for (const o of state.orbs.slice()) { const q = nearestOnSegment(x1, y1, x2, y2, o.x, o.y); if (Math.hypot(q.x - o.x, q.y - o.y) <= R) { popOrb(o); n++; } }
    return n;
  }
  /* T2 charger: 700 ms telegraph (aura pulse 150 ms + expanding warn ring), then SLAM (rect + 60 px). */
  function attackCharger(rec, r) {
    rec.phase = 'telegraph';
    setAuraPulse(rec, 150);
    addAimLine(rec);
    /* v1.3 §3.3: the warn ring now CLOSES onto the real hit boundary (rect + 60 px) instead of blooming past it,
     * so the edge the player has to be outside of is the edge they can see. */
    const ex = { left: r.left - 60, top: r.top - 60, w: r.width + 120, h: r.height + 120 };
    const warn = mk('div', 'crs-warn crs-slam');
    warn.style.left = px(ex.left); warn.style.top = px(ex.top); warn.style.width = px(ex.w); warn.style.height = px(ex.h);
    root.append(warn); rec.nodes.push(warn); state.warns.push(warn);
    try {
      trackAnim(warn.animate([
        { left: px(ex.left - 130), top: px(ex.top - 130), width: px(ex.w + 260), height: px(ex.h + 260), opacity: 0.3, borderWidth: '6px' },
        { left: px(ex.left), top: px(ex.top), width: px(ex.w), height: px(ex.h), opacity: 1, borderWidth: '3px' }
      ], { duration: 700, easing: 'ease-in', fill: 'forwards' }));
    } catch (e) { /* ignore */ }
    sfx('thump', { gain: 0.5 });
    rec.timer = later(() => { rec.timer = 0; chargerSlam(rec); }, 700);
  }
  function chargerSlam(rec) {
    clearPhase(rec);
    const r = rectOf(rec.el);
    if (!r || !rec.el.isConnected) { scheduleAttack(rec, attackInterval(rec)); return; }
    const p = state.player;
    const ex = { left: r.left - 60, top: r.top - 60, right: r.right + 60, bottom: r.bottom + 60 };
    const inside = p.x >= ex.left && p.x <= ex.right && p.y >= ex.top && p.y <= ex.bottom;
    const cx = (ex.left + ex.right) / 2, cy = (ex.top + ex.bottom) / 2;
    const near = Math.abs(p.x - cx) <= (ex.right - ex.left) && Math.abs(p.y - cy) <= (ex.bottom - ex.top);   // within 2× the expanded rect
    if (root) {   // shockwave ring from the rect to +60 px over 300 ms
      const ring = mk('div', 'crs-warn crs-slam');
      ring.style.left = px(r.left); ring.style.top = px(r.top); ring.style.width = px(r.width); ring.style.height = px(r.height);
      root.append(ring); state.warns.push(ring);
      const kill = () => { try { ring.remove(); } catch (e) { /* ignore */ } const i = state.warns.indexOf(ring); if (i >= 0) state.warns.splice(i, 1); };
      try {
        const a = trackAnim(ring.animate([{ left: px(r.left), top: px(r.top), width: px(r.width), height: px(r.height), opacity: 0.95 }, { left: px(r.left - 60), top: px(r.top - 60), width: px(r.width + 120), height: px(r.height + 120), opacity: 0 }], { duration: 300, easing: 'ease-out', fill: 'forwards' }));
        a.addEventListener('finish', kill);
      } catch (e) { /* ignore */ }
      later(kill, 600);
    }
    shake('bomb', { amp: near ? 10 : 3, dur: 300 });
    sfx('rumble', { gain: near ? 1 : 0.5 });
    if (inside) damagePlayer(18 + Math.round(Math.sqrt(rec.area) / 50), { from: { x: cx, y: cy } });
    scheduleAttack(rec, attackInterval(rec));
  }
  /* --- player regen, KO --- (vignette / damagePlayer / updatePlayerHud moved to 91-combat-feedback.js) */
  function startRegen() {   // 500 ms later() chain while hp < max (tick() also regens while the loop is busy)
    if (state.regenTimer || !state.active || !state.combat || state.paused) return;
    const p = state.player;
    if (!p.alive || p.hp >= p.max) return;
    state.regenTimer = later(regenChain, 500);
  }
  function regenChain() {
    state.regenTimer = 0;
    regenStep();
    const p = state.player;
    if (state.active && state.combat && !state.paused && p.alive && p.hp < p.max) state.regenTimer = later(regenChain, 500);
  }
  function regenStep() {   // 3 HP/s after 3 s without damage (A7)
    const p = state.player, t = now();
    if (!p.alive || p.hp >= p.max || t - p.lastDamageAt < 3000) { p.lastRegenAt = t; return; }
    const dt = (t - (p.lastRegenAt || t)) / 1000;
    p.lastRegenAt = t;
    if (dt <= 0) return;
    p.hp = Math.min(p.max, p.hp + 3 * dt);
    updatePlayerHud();
  }
  function showKo() {
    if (!modeHasHealth()) return;   // v1.4 §0.5: quickdraw and rampage have no health, so no KO
    const p = state.player;
    p.alive = false; state.ko = true;
    resetChord(); scopeOff(); stopHold(); cancelSlash();
    untrack(state.regenTimer); state.regenTimer = 0;
    for (const rec of state.hostiles.values()) { untrack(rec.timer); rec.timer = 0; clearPhase(rec); }
    clearOrbs(); clearBeams(); clearWarns(); clearAimLines();
    // KO overlay (A11): built on demand inside the HUD shadow root; ordinary shadow buttons, so isHudEvent() lets clicks through
    if (hudEls.mount && !hudEls.ko) {
      try {
        const ko = mk('div', 'crs-ko');
        const kt = doc.createElement('div'); kt.className = 'kt'; kt.textContent = '💀 ' + msg('koTitle');
        const ks = doc.createElement('div'); ks.className = 'ks';
        ks.textContent = msg('labelScore') + ' ' + p.score + ' · ' + msg('labelKills') + ' ' + p.kills + ' · ' + msg('labelTime') + ' ' + Math.floor(combatElapsed() / 1000) + msg('unitSec');
        const kb = doc.createElement('div'); kb.className = 'kb';
        kb.append(hudButton(msg('koRestart') + ' (Enter)', msg('koRestart') + ' (Enter)', () => restartFromKo()), hudButton(msg('koExit') + ' (Esc)', msg('koExit') + ' (Esc)', () => deactivate()));
        ko.append(kt, ks, kb);
        ko.classList.add('show');
        if (hudEls.fallback) {
          const s = ko.style; s.position = 'fixed'; s.left = '0'; s.top = '0'; s.right = '0'; s.bottom = '0'; s.background = 'rgba(0,0,0,.78)'; s.color = '#fff'; s.display = 'flex'; s.alignItems = 'center'; s.justifyContent = 'center'; s.flexDirection = 'column'; s.pointerEvents = 'auto'; s.font = '16px system-ui, sans-serif';
          for (const b of ko.querySelectorAll('button')) { b.style.margin = '4px'; b.style.padding = '6px 12px'; b.style.color = '#fff'; b.style.background = 'rgba(255,255,255,.15)'; b.style.border = '1px solid rgba(255,255,255,.3)'; b.style.borderRadius = '8px'; b.style.cursor = 'pointer'; }
        }
        hudEls.mount.append(ko);
        hudEls.ko = ko;
      } catch (e) { /* ignore */ }
    }
    toast('💀 ' + msg('koTitle'));
    updateHud(); updatePlayerHud();
  }
  function hideKo() {
    state.ko = false;
    const k = hudEls.ko;
    if (k) { try { k.remove(); } catch (e) { /* ignore */ } hudEls.ko = null; }
  }
  function restartFromKo() {
    if (!state.ko) return false;
    restore();   // player reset + grace (A8)
    return true;
  }
  /* setCombat() / setMode() live in 86-modes.js from v1.4 on — one mode switch, one place. */
  /* Pause (A7): blur / hidden → cancel every combat timer, drop in-flight orbs / beams / rings, freeze the clock. */
  function pauseCombat() {
    if (state.paused) return;
    state.paused = true;
    state.player.pausedAt = now();
    untrack(state.combatTimer); state.combatTimer = 0;
    untrack(state.clockTimer); state.clockTimer = 0;
    untrack(state.regenTimer); state.regenTimer = 0;
    untrack(state.depthTimer); state.depthTimer = 0;
    untrack(state.ratioTimer); state.ratioTimer = 0;
    for (const rec of state.hostiles.values()) { untrack(rec.timer); rec.timer = 0; untrack(rec.repairTimer); rec.repairTimer = 0; clearPhase(rec); }
    clearOrbs(); clearBeams(); clearWarns(); clearAimLines();
    clearLocks(); clearRepairs();   // v1.4 §2 / §3
  }
  function resumeCombat() {
    if (!state.paused) return;
    state.paused = false;
    state.player.pausedTotal += now() - state.player.pausedAt;
    if (!state.active || !state.combat) return;
    state.combatTimer = later(selectTick, Math.max(1000, state.graceUntil - now()));
    untrack(state.clockTimer); state.clockTimer = later(clockTick, 1000);
    for (const rec of state.hostiles.values()) { scheduleAttack(rec, Math.max(1000, attackInterval(rec))); scheduleRepair(rec); }
    armDepthTick(); armRatioTick();   // v1.4 §10.1 / §3.2
    if (modeHasAvatar()) ensureAvatar();
    if (state.player.hp < state.player.max) startRegen();
  }
  /* --- debug hooks (§5) --- */
  debug.setPlayerHp = (n) => {
    const p = state.player;
    n = +n;
    if (!isFinite(n)) return Math.round(p.hp);
    p.hp = clamp(n, 0, p.max);
    /* A hard set, not a hit. A §2.2 drain still in flight from an earlier hit animates width AND background on
     * the same node, and an animation outranks the inline style updatePlayerHud() is about to write — the bar
     * would keep showing the OLD length and colour next to the NEW number for up to 250 ms. Snap it instead. */
    if (hudEls.pFill) cancelAnimsOf(hudEls.pFill);
    updatePlayerHud();
    if (p.hp <= 0 && p.alive && state.combat && state.active) showKo();
    else if (p.hp < p.max) startRegen();
    return Math.round(p.hp);
  };
  debug.setPlayerPos = (x, y) => {
    x = +x; y = +y;
    if (isFinite(x) && isFinite(y)) { state.player.x = x; state.player.y = y; state.player.inWindow = true; placeSelf(); }
    return { x: state.player.x, y: state.player.y };
  };
  /* v1.4: the forced hooks bring a target that has been scrolled away back into view first. The picker only ever
   * chooses on-screen elements, so this is the one place an off-screen element is a legitimate subject, and
   * scrolling to the thing you asked about is what a reader of the hook means. */
  function bringIntoView(el) {
    if (!el || el.nodeType !== 1) return;
    const r = rectOf(el);
    if (r && r.right > 0 && r.bottom > 0 && r.left < viewW() && r.top < viewH()) return;
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) { /* ignore */ }
    scheduleAura();
  }
  debug.forceAttack = (el) => {   // same eligibility as the picker; works under noAttacks, null while paused / KO
    if (!state.active || !state.combat || state.paused || state.ko || !state.player.alive) return null;
    bringIntoView(el);
    const existing = state.hostiles.get(el) || null;
    let rec = existing;
    if (!rec) { const area = hostileArea(el); if (area == null) return null; rec = markHostile(el, area); }
    if (!rec) return null;
    const ran = hostileAttack(rec, true);
    /* A no-op must not consume a hostile slot — EXCEPT for the back rank, whose "no-op" is the whole point of
     * §10.2: it is a real hostile that simply never attacks, and its aura has to stay up. */
    if (!ran && !existing && depthAttackMul(rec) && state.hostiles.get(el) === rec) releaseHostile(el);
    return ran || null;   // v1.4: 'shooter' | 'charger' | 'lock' | 'laser'
  };
  /* §5: the caller lives in wall-clock time, the engine in performance.now() time. */
  function dashReadyWallClock() {
    if (!state.dashReadyAt) return 0;
    return Date.now() + Math.round(state.dashReadyAt - now());
  }
  /* §4 boss stages, read straight off its remaining HP. debug.forceBoss() takes an element (that one becomes a
   * boss) or a number (every T3 hostile does), so a test can reach the third stage without guessing a signature. */
  function isBoss(rec) { return !!(rec && (rec.boss || (state.bossMode && rec.tier === 'laser'))); }
  function bossPhase(rec) {
    const h = state.hp.get(rec.el);
    const ratio = (h && h.max > 0) ? clamp(h.hp / h.max, 0, 1) : 1;
    return ratio > 0.66 ? 1 : (ratio > 0.33 ? 2 : 3);
  }
  /* The biggest T3-sized element on the page, viewport or not — the thing a reader of forceBoss() means by
   * "the boss". Capped scan, and only ever run from a debug hook. */
  function biggestBossCandidate() {
    let best = null, bestArea = 0, seen = 0;
    let all = [];
    try { all = doc.body.getElementsByTagName('*'); } catch (e) { return null; }
    for (const el of all) {
      if (++seen > 3000) break;
      if (isOurs(el) || SKIP_WALK_TAGS.has(tagOf(el))) continue;
      if ((el.offsetWidth || 0) < 300 || (el.offsetHeight || 0) < 200) continue;
      const r = rectOf(el);
      if (!r) continue;
      const area = r.width * r.height;
      if (tierFor(area) !== 'laser' || area > 0.7 * viewW() * viewH()) continue;
      if (area > bestArea) { bestArea = area; best = el; }
    }
    return best;
  }
  function makeBoss(el, ratio) {
    if (!el) return null;
    bringIntoView(el);
    const area = hostileArea(el);
    const rec = state.hostiles.get(el) || (area != null ? markHostile(el, area) : null);
    if (!rec) return null;
    rec.boss = true;
    state.bossMode = true;
    if (ratio != null && isFinite(ratio) && ratio >= 0 && ratio <= 1) {
      const h = hpOf(el);
      // floor, so the caller's "drive it to 30 %" loop sees a value that is already AT or BELOW the threshold
      h.hp = Math.max(1, Math.floor(h.max * ratio));
      refreshHover(); scheduleHud();
    }
    return rec;
  }
  /* forceBoss(el) makes that element a boss; forceBoss(0.3) makes the page's biggest T3 element a boss already
   * down to 30 % HP — its third stage (§4), where the laser sweep comes back. */
  debug.forceBoss = (arg) => {
    if (arg && arg.nodeType === 1) return makeBoss(arg, null) ? true : null;
    const ratio = (typeof arg === 'number' && isFinite(arg)) ? arg : null;
    const rec = makeBoss(biggestBossCandidate(), ratio);
    if (rec) return true;
    state.bossMode = true;   // nothing eligible on screen: every T3 hostile still fights as a boss
    for (const r of state.hostiles.values()) if (r.tier === 'laser') r.boss = true;
    return true;
  };
  debug.setAvatarPos = (x, y) => {
    x = +x; y = +y;
    const p = state.player;
    if (isFinite(x) && isFinite(y)) { p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.inWindow = true; placeAvatar(); placeSelf(); }
    return { x: p.x, y: p.y };
  };
  debug.dashReady = () => { state.dashReadyAt = 0; updateDashDot(); return true; };

// ── 91-combat-feedback.js ──
// ── v1.3 combat readability: player ring, aim-line telegraph, orb legibility, near-miss, hit feedback ──
  /* The whole of SPEC-readability §3 lives here, plus the player health HUD (§2.2) that the ring mirrors.
   *
   * The complaint this file answers: "the attacks feel good, but I cannot tell that something is attacking ME,
   * whether I can dodge, or that I am taking damage." The player IS the mouse cursor and the cursor carried no
   * mark at all, so none of those three questions had anywhere to be answered. In order:
   *
   *   §3.1  the cursor gets a 44 px health RING — the player, drawn where the player is already looking
   *   §3.2  a dashed AIM LINE from the attacker to that ring the moment a wind-up starts — "this one, right now"
   *   §3.3  bigger orbs with a shrinking arrival ring, bright when they will hit and dim when they will not
   *   §3.4  a near-miss graze that proves dodging works
   *   §3.5  hitstop + a vignette aimed at the damage source + a 24 px number — "you were hit, from there"
   *
   * Nothing here changes a pattern, an interval, a damage value, a tier or a score (§4). Every node is made with
   * mk() (data-crs + a crs- class), every timer goes through later(), every animation through trackAnim(), so
   * restore() and deactivate() sweep all of it. */

  /* ===================================================================== */
  /* vignettes (§3.5 directional, §2.2 low-HP)                              */
  /* ===================================================================== */
  function vignette(white) {
    if (!root) return;
    const n = mk('div', white ? 'crs-vignette crs-flash-white' : 'crs-vignette');
    root.append(n);
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
    try { const a = trackAnim(n.animate([{ opacity: white ? 0.85 : 0.8 }, { opacity: 0 }], { duration: white ? 300 : 400, easing: 'ease-out', fill: 'forwards' })); a.addEventListener('finish', kill); } catch (e) { /* ignore */ }
    later(kill, 700);
  }
  /* §3.5: a red wash concentrated on the side the damage came from, 450 ms. An even border said "something
   * happened"; this says "something hit you FROM THERE", which is the half the player was missing. */
  function dirVignette(from) {
    if (!root) return;
    const W = viewW(), H = viewH();
    const p = state.player;
    let fx = from && isFinite(from.x) ? from.x : p.x, fy = from && isFinite(from.y) ? from.y : p.y;
    let dx = fx - p.x, dy = fy - p.y;
    const L = Math.hypot(dx, dy);
    if (L < 1) { dx = 0; dy = -1; } else { dx /= L; dy /= L; }
    // project the direction onto the viewport edge and bias the gradient centre well outside it
    const cx = clamp(50 + dx * 85, -45, 145), cy = clamp(50 + dy * 85, -45, 145);
    const n = mk('div', 'crs-vignette crs-vignette-dir');
    n.style.backgroundImage = 'radial-gradient(ellipse ' + px(W * 0.95) + ' ' + px(H * 0.95) + ' at ' + cx.toFixed(1) + '% ' + cy.toFixed(1) + '%, rgba(229,72,77,.85) 0%, rgba(229,72,77,.45) 28%, rgba(229,72,77,0) 62%)';
    root.append(n);
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
    try { const a = trackAnim(n.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0 }], { duration: 450, easing: 'ease-out', fill: 'forwards' })); a.addEventListener('finish', kill); } catch (e) { /* ignore */ }
    later(kill, 800);
  }
  /* §2.2: below 30 % HP a faint red rim stays up for as long as the player is in danger (no animation, no timer). */
  function lowVignette(ratio) {
    const want = state.active && modeHasHealth() && !state.ko && state.player.alive && ratio < 0.3;
    if (!want) { clearLowVignette(); return; }
    if (state.lowVig && state.lowVig.isConnected) return;
    if (!root) return;
    const n = mk('div', 'crs-vignette crs-vignette-low');
    n.style.opacity = '0.55';
    root.append(n);
    state.lowVig = n;
  }
  function clearLowVignette() {
    const n = state.lowVig;
    state.lowVig = null;
    if (n) { try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } }
  }

  /* ===================================================================== */
  /* §3.1 player marker / health ring                                       */
  /* ===================================================================== */
  /* Geometry: a `.crs-selfbox` wrapper is translated onto the pointer and holds four same-sized layers. The RING
   * itself is `.crs-self` — a conic-gradient disc with its middle punched out by a radial-gradient mask, so the
   * painted arc runs clockwise from 12 o'clock for exactly hp/max of the circle. CSSOM only; no SVG. */
  function selfColor(ratio) { return fillColor(ratio); }
  function ringGradient(ratio) {
    const deg = clamp(ratio, 0, 1) * 360;
    const c = selfColor(ratio);
    return 'conic-gradient(from 0deg, ' + c + ' 0deg, ' + c + ' ' + deg.toFixed(2) + 'deg, rgba(255,255,255,.16) ' + deg.toFixed(2) + 'deg, rgba(255,255,255,.16) 360deg)';
  }
  /* A 60°-wide (or `span`-wide) coloured window centred on `deg`, used for the damage wedge and the graze arc. */
  function wedgeGradient(deg, span, color) {
    const a = ((deg - span / 2) % 360 + 360) % 360;
    return 'conic-gradient(from ' + a.toFixed(2) + 'deg, ' + color + ' 0deg, ' + color + ' ' + span.toFixed(2) + 'deg, rgba(0,0,0,0) ' + span.toFixed(2) + 'deg, rgba(0,0,0,0) 360deg)';
  }
  /* CSS conic-gradient angles start at 12 o'clock and grow clockwise; screen y grows downward. */
  function angleTo(x, y) {
    const p = state.player;
    const dx = x - p.x, dy = y - p.y;
    if (!isFinite(dx) || !isFinite(dy) || (dx === 0 && dy === 0)) return 0;
    return (Math.atan2(dx, -dy) / DEG + 360) % 360;
  }
  function buildSelf() {
    const box = mk('div', 'crs-selfbox');
    const ring = mk('div', 'crs-self');
    const wedge = mk('div', 'crs-self-wedge');
    const arc = mk('div', 'crs-self-arc');
    const dot = mk('div', 'crs-self-dot');
    const tag = mk('span', 'crs-self-tag');
    tag.textContent = msg('dodgeLabel');
    box.append(ring, wedge, arc, dot, tag);
    return { box, ring, wedge, arc, dot, tag, pulse: null, lowOn: false, ratio: -1 };
  }
  /* v1.4 §0.5: the ring is a HEALTH gauge, so it exists only where health does — survival. In quickdraw the
   * cursor is the player and there is nothing to drain; in rampage there is no combat at all. */
  function selfShouldShow() { return !!(state.active && modeHasHealth() && !state.ko && root); }
  /* Mount / unmount + repaint. Called from updatePlayerHud(), so every hp change and every combat toggle lands. */
  function syncSelf() {
    if (!selfShouldShow()) { clearSelf(); return; }
    let s = state.self;
    if (!s || !s.box.isConnected) { s = buildSelf(); state.self = s; try { root.append(s.box); } catch (e) { /* ignore */ } }
    const ratio = clamp(state.player.hp / state.player.max, 0, 1);
    if (Math.abs(ratio - s.ratio) > 0.0005) { s.ratio = ratio; s.ring.style.backgroundImage = ringGradient(ratio); }
    setSelfLowPulse(s, ratio < 0.3);
    placeSelf();
  }
  function setSelfLowPulse(s, on) {
    if (on === s.lowOn && (!on || (s.pulse && s.pulse.playState === 'running'))) return;
    s.lowOn = on;
    if (s.pulse) { try { s.pulse.cancel(); } catch (e) { /* ignore */ } state.anims.delete(s.pulse); s.pulse = null; }
    if (!on || reducedMotion()) return;
    try { s.pulse = trackAnim(s.ring.animate([{ opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }], { duration: 1200, iterations: Infinity })); } catch (e) { s.pulse = null; }
  }
  /* The ring rides the pointer from the frames that already exist — scheduleHover()'s one-shot RAF on every
   * pointermove, and tickFrame() while anything else is live. It never owns a loop of its own. */
  function placeSelf() {
    const s = state.self;
    if (!s || !s.box.isConnected) return;
    const p = state.player;
    s.box.style.left = px(p.x);
    s.box.style.top = px(p.y);
    // ADS: drop the ring to 20 % so it cannot compete with the reticle (§3.1)
    s.box.style.opacity = state.scoped ? '0.2' : '1';
  }
  function selfStep() { placeSelf(); }
  function clearSelf() {
    const s = state.self;
    state.self = null;
    if (!s) return;
    if (s.pulse) { try { s.pulse.cancel(); } catch (e) { /* ignore */ } state.anims.delete(s.pulse); }
    try { cancelAnimsOf(s.box); cancelAnimsOf(s.ring); cancelAnimsOf(s.wedge); cancelAnimsOf(s.arc); cancelAnimsOf(s.tag); s.box.remove(); } catch (e) { /* ignore */ }
  }
  function selfRingInfo() {
    const s = state.self;
    return { shown: !!(s && s.box && s.box.isConnected), hpRatio: clamp(state.player.hp / state.player.max, 0, 1) };
  }
  /* Hit: the ring punches out to 64 px and settles back over 200 ms while flashing red, and a 60° wedge points at
   * the damage source for 350 ms. Reduced motion keeps the colour cues and drops the punch. */
  function selfHit(from) {
    const s = state.self;
    if (!s || !s.box.isConnected) return;
    const rm = reducedMotion();
    try {
      if (!rm) trackAnim(s.box.animate([{ transform: 'translate(-50%, -50%) scale(' + (SELF_HIT_R / SELF_R).toFixed(3) + ')' }, { transform: 'translate(-50%, -50%) scale(1)' }], { duration: 200, easing: 'ease-out' }));
      trackAnim(s.ring.animate([{ filter: 'brightness(2.6) drop-shadow(0 0 6px rgba(255,80,80,.95))' }, { filter: 'brightness(1) drop-shadow(0 1px 3px rgba(0,0,0,.85))' }], { duration: 200, easing: 'ease-out' }));
    } catch (e) { /* ignore */ }
    if (!from) return;
    try {
      s.wedge.style.backgroundImage = wedgeGradient(angleTo(from.x, from.y), 60, 'rgba(255,70,70,.95)');
      cancelAnimsOf(s.wedge);
      trackAnim(s.wedge.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: 350, easing: 'ease-out', fill: 'forwards' }));
    } catch (e) { /* ignore */ }
  }
  /* Graze: a white arc on the side the shot went past, plus 회피! beside the ring (§3.4). */
  function selfGraze(from) {
    const s = state.self;
    if (!s || !s.box.isConnected) return;
    if (!from) from = { x: state.player.x, y: state.player.y - 1 };
    try {
      s.arc.style.backgroundImage = wedgeGradient(angleTo(from.x, from.y), 40, 'rgba(255,255,255,.95)');
      cancelAnimsOf(s.arc);
      trackAnim(s.arc.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' }));
    } catch (e) { /* ignore */ }
    try {
      cancelAnimsOf(s.tag);
      trackAnim(s.tag.animate([{ opacity: 0.7 }, { opacity: 0.7, offset: 0.7 }, { opacity: 0 }], { duration: 500, easing: 'ease-out', fill: 'forwards' }));
    } catch (e) { /* ignore */ }
  }

  /* ===================================================================== */
  /* §3.2 aim lines — "that one is attacking ME, right now"                 */
  /* ===================================================================== */
  function aimPoint(rec) {   // the point on the hostile's border nearest the player
    const r = rectOf(rec.el);
    if (!r) return null;
    const p = state.player;
    return { x: clamp(p.x, r.left, r.right), y: clamp(p.y, r.top, r.bottom) };
  }
  function placeAimLine(a) {
    const from = aimPoint(a.rec);
    if (!from) return;
    const p = state.player;
    const len = Math.hypot(p.x - from.x, p.y - from.y);
    const ang = Math.atan2(p.y - from.y, p.x - from.x);
    const s = a.node.style;
    s.left = px(from.x); s.top = px(from.y); s.width = px(len); s.height = '2px';
    s.transform = 'translateY(-1px) rotate(' + ang.toFixed(4) + 'rad)';
  }
  function addAimLine(rec) {
    if (!root || !rec || rec.aim) return;
    const node = mk('div', 'crs-aimline');
    node.style.transformOrigin = '0 50%';
    root.append(node);
    const a = { rec, node, bornAt: now(), timer: 0 };
    rec.aim = a;
    state.aimlines.push(a);
    placeAimLine(a);
    try { trackAnim(node.animate([{ backgroundPosition: '0px 0px' }, { backgroundPosition: '18px 0px' }], { duration: 420, iterations: Infinity, easing: 'linear' })); } catch (e) { /* ignore */ }
    try { rec.aura.classList.add('crs-aimed'); } catch (e) { /* ignore */ }
    setHostileLabel(rec);   // v1.4 §10.4: 🎯 and the ▲ depth mark share one composed label
    sfx('alert');
    kick();
  }
  function removeAimLine(a) {
    const i = state.aimlines.indexOf(a);
    if (i >= 0) state.aimlines.splice(i, 1);
    untrack(a.timer); a.timer = 0;
    if (a.rec && a.rec.aim === a) {
      a.rec.aim = null;
      try { a.rec.aura.classList.remove('crs-aimed'); } catch (e) { /* ignore */ }
      setHostileLabel(a.rec);
    }
    try { cancelAnimsOf(a.node); a.node.remove(); } catch (e) { /* ignore */ }
  }
  /* The line goes with the shot. A wind-up of zero (debug.forceAttack on a shooter) would otherwise create and
   * destroy it inside one frame, so it is always held for AIMLINE_MIN_MS first. */
  function dropAimLine(rec, immediate) {
    const a = rec && rec.aim;
    if (!a) return;
    if (immediate) { removeAimLine(a); return; }
    if (a.timer) return;
    const wait = Math.max(0, AIMLINE_MIN_MS - (now() - a.bornAt));
    if (wait <= 0) { removeAimLine(a); return; }
    a.timer = later(() => { a.timer = 0; removeAimLine(a); }, wait);
  }
  function stepAimLines() { for (const a of state.aimlines) placeAimLine(a); }
  function clearAimLines() { for (const a of state.aimlines.slice()) removeAimLine(a); }

  /* ===================================================================== */
  /* §3.3 orb legibility + §3.4 near miss                                   */
  /* ===================================================================== */
  /* Each orb gets an arrival ring that shrinks onto it and six afterimages behind it. The ring's radius is driven
   * by elapsed/predicted flight time, so it falls monotonically and reaches orb size at the predicted impact. */
  function orbVisuals(o) {
    if (!root) return;
    const ring = mk('div', 'crs-orb-ring');
    root.append(ring);
    o.ring = ring;
    o.trail = [];
    o.hist = [];
    if (reducedMotion()) return;
    for (let i = 0; i < ORB_TRAIL; i++) {
      const n = mk('div', 'crs-orb-trail');
      const k = 1 - i / ORB_TRAIL;
      const sz = Math.max(4, Math.round(2 * ORB_R * k * 0.72));
      n.style.width = px(sz); n.style.height = px(sz);
      n.style.opacity = (0.42 * k).toFixed(3);
      root.append(n);
      o.trail.push(n);
    }
  }
  function orbVisualsRemove(o) {
    if (!o) return;
    if (o.ring) { try { cancelAnimsOf(o.ring); o.ring.remove(); } catch (e) { /* ignore */ } o.ring = null; }
    if (o.trail) { for (const n of o.trail) { try { n.remove(); } catch (e) { /* ignore */ } } o.trail.length = 0; }
  }
  /* Will this orb, on its current heading, reach the player? The answer is what decides bright vs. dim, and it is
   * recomputed every frame — moving the cursor off the line dims the orb where it flies, which is the lesson. */
  function orbWillHit(o) {
    const p = state.player;
    if (!p.alive || !p.inWindow) return false;
    const q = nearestOnSegment(o.x, o.y, o.x + o.vx * 3, o.y + o.vy * 3, p.x, p.y);
    return Math.hypot(q.x - p.x, q.y - p.y) < ORB_HIT_R;
  }
  function orbReadability(o, t) {
    const p = state.player;
    const hit = orbWillHit(o);
    try { o.node.style.opacity = hit ? '1' : '0.4'; } catch (e) { /* ignore */ }
    if (o.ring) {
      const k = o.flightMs > 0 ? clamp(1 - (t - o.launchAt) / o.flightMs, 0, 1) : 0;
      const R = ORB_R + 34 * k;
      const s = o.ring.style;
      s.left = px(o.x - R); s.top = px(o.y - R); s.width = px(2 * R); s.height = px(2 * R);
      s.borderColor = hit ? 'rgba(255,90,90,.95)' : 'rgba(255,255,255,.35)';
      s.opacity = hit ? '1' : '0.45';
    }
    if (o.trail && o.trail.length) {
      o.hist.unshift(o.x, o.y);
      if (o.hist.length > 2 * (ORB_TRAIL + 1) * 2) o.hist.length = 2 * (ORB_TRAIL + 1) * 2;
      for (let i = 0; i < o.trail.length; i++) {
        const j = 2 * ((i + 1) * 2);
        if (j + 1 >= o.hist.length) break;
        const n = o.trail[i], w = parseFloat(n.style.width) || 8;
        n.style.left = px(o.hist[j] - w / 2);
        n.style.top = px(o.hist[j + 1] - w / 2);
      }
    }
    // §3.4: the closest approach. Between ORB_HIT_R and ORB_HIT_R + 45 px it is a graze, and the player is told so.
    if (!o.nearDone && p.alive && !state.ko) {
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < o.minD) { o.minD = d; o.minAt = { x: o.x, y: o.y }; }
      else if (d > o.minD + 6 && o.minD <= ORB_HIT_R + NEAR_MISS_BAND && o.minD > ORB_HIT_R) { o.nearDone = true; nearMiss(o.minAt); }
    }
  }
  function nearMiss(from) {
    state.nearMisses++;
    const t = now();
    state.nearShown = state.nearShown.filter((x) => t - x < 2000);
    if (state.nearShown.length >= 3) return;   // at most three call-outs per 2 s (§3.4)
    state.nearShown.push(t);
    selfGraze(from || { x: state.player.x, y: state.player.y - 1 });
    sfx('whiff');
  }

  /* ===================================================================== */
  /* §3.5 taking damage                                                     */
  /* ===================================================================== */
  /* Hitstop: tickFrame() clamps dt to 0 while this window is open. Frames keep running and keep being counted —
   * the integrator simply advances no time — so nothing accumulates and nothing is skipped. */
  function hitstop() {
    if (!debug.hitstop || reducedMotion()) return;
    state.hitstopUntil = now() + HITSTOP_MS;
    kick();
  }
  function damagePlayer(n, opts) {
    const p = state.player;
    if (!state.active || !modeHasHealth() || !p.alive || state.ko || !(n > 0)) return;
    if (now() < state.invulUntil) { selfGraze(opts && opts.from ? opts.from : null); return; }   // v1.4 §1.2: dash i-frames
    const from = (opts && opts.from && isFinite(opts.from.x) && isFinite(opts.from.y)) ? { x: opts.from.x, y: opts.from.y } : null;
    const before = clamp(p.hp / p.max, 0, 1);
    p.hp = Math.max(0, p.hp - n);
    p.lastDamageAt = now(); p.lastRegenAt = p.lastDamageAt;
    p.lastHitFrom = from;
    hitstop();
    dirVignette(from);
    shake('bomb', { amp: 8, dur: 260 });
    sfx('hurtbig');
    spawnDmg(p.x + rand(-10, 10), p.y - 30, Math.round(n), false, { color: '#ff6b6b', size: 24 });
    selfHit(from);
    updatePlayerHud();
    drainBar(before);
    if (p.hp <= 0) showKo(); else startRegen();
  }
  /* §2.2: the bar flashes white for a frame, the lost slice drains over 250 ms, and the panel takes a 6 px knock. */
  function drainBar(before) {
    if (!hudEls.pFill || !hudEls.player) return;
    const after = clamp(state.player.hp / state.player.max, 0, 1);
    try {
      cancelAnimsOf(hudEls.pFill);
      trackAnim(hudEls.pFill.animate([{ width: (before * 100).toFixed(1) + '%' }, { width: (after * 100).toFixed(1) + '%' }], { duration: 250, easing: 'ease-out' }));
      trackAnim(hudEls.pFill.animate([{ backgroundColor: '#fff' }, { backgroundColor: '#fff', offset: 0.08 }, { backgroundColor: fillColor(after) }], { duration: 250, easing: 'ease-out' }));
    } catch (e) { /* ignore */ }
    if (reducedMotion()) return;
    try { trackAnim(hudEls.player.animate([{ transform: 'translate(0px, 0px)' }, { transform: 'translate(-6px, 3px)' }, { transform: 'translate(6px, -3px)' }, { transform: 'translate(-3px, 1px)' }, { transform: 'translate(0px, 0px)' }], { duration: 260 })); } catch (e) { /* ignore */ }
  }
  function setBarPulse(on) {
    const bar = hudEls.pBar;
    if (!bar) return;
    if (on === !!hudEls.pPulseOn && (!on || (hudEls.pPulse && hudEls.pPulse.playState === 'running'))) return;
    hudEls.pPulseOn = on;
    if (hudEls.pPulse) { try { hudEls.pPulse.cancel(); } catch (e) { /* ignore */ } state.anims.delete(hudEls.pPulse); hudEls.pPulse = null; }
    if (!on || reducedMotion()) return;
    try { hudEls.pPulse = trackAnim(bar.animate([{ boxShadow: '0 0 0 0 rgba(229,72,77,0)' }, { boxShadow: '0 0 0 3px rgba(229,72,77,.6)' }, { boxShadow: '0 0 0 0 rgba(229,72,77,0)' }], { duration: 1200, iterations: Infinity })); } catch (e) { hudEls.pPulse = null; }
  }
  /* §2.2 player HUD + the ring that mirrors it. Called from every path that can move hp or toggle combat. */
  function updatePlayerHud() {
    state.ratioDirty = true;   // v1.4 §3.2: every break, kill and repair passes through here
    const p = state.player, ratio = clamp(p.hp / p.max, 0, 1);
    const h = hudEls.player;
    if (h) {
      try {
        const showHp = modeHasHealth();   // v1.4 §0.5: no health bar where there is no health
        h.classList.toggle('on', showHp);
        if (hudEls.fallback) h.style.display = showHp ? 'block' : 'none';
        hudEls.pFill.style.width = (ratio * 100).toFixed(1) + '%';
        hudEls.pFill.style.background = fillColor(ratio);
        hudEls.pHp.textContent = msg('labelHealth') + ' ' + Math.max(0, Math.round(p.hp)) + ' / ' + p.max;
        hudEls.pStats.textContent = msg('labelScore') + ' ' + p.score + ' · ' + msg('labelKills') + ' ' + p.kills + ' · ' + msg('labelTime') + ' ' + Math.floor(combatElapsed() / 1000) + msg('unitSec') + ' · ' + msg('labelEnemies') + ' ' + state.hostiles.size;
        setBarPulse(showHp && p.alive && ratio < 0.3);
        updateDashDot();
      } catch (e) { /* ignore */ }
    }
    state.hpRatio = ratio;
    syncSelf();
    lowVignette(ratio);
  }

  /* ===================================================================== */
  /* ── v1.4 §1: the drone avatar — the half of the input that was missing ─ */
  /* ===================================================================== */
  /* With the cursor as the player, one mouse had to aim AND dodge: move to dodge and the aim is gone, hold still
   * to aim and you get hit. Survival splits them. The mouse keeps aiming (nothing about shooting changes) and
   * WASD flies this drone, so dodging finally costs nothing you were already spending.
   *
   * `state.player.x / y` simply BECOMES the drone centre, which is why no enemy code had to change: every
   * targeting, hit and near-miss test already read exactly those two numbers. The v1.3 health ring is re-anchored
   * here rather than rebuilt — it rides state.player too, so it followed the drone for free. */

  function avatarStart() {
    const p = state.player;
    p.x = viewW() / 2; p.y = viewH() * 0.72;   // §1.2: centre, lower third
    p.vx = 0; p.vy = 0;
  }
  function buildAvatar() {
    const box = mk('div', 'crs-avatar');
    const body = mk('div', 'crs-avatar-body');
    const nose = mk('div', 'crs-avatar-nose');
    const rotorL = mk('div', 'crs-avatar-rotor crs-avatar-rotor-l');
    const rotorR = mk('div', 'crs-avatar-rotor crs-avatar-rotor-r');
    box.append(body, rotorL, rotorR, nose);
    return { box, body, nose, rotors: [rotorL, rotorR], wobble: [], ang: null };
  }
  function avatarWobble(a) {
    for (const w of a.wobble) { try { w.cancel(); } catch (e) { /* ignore */ } state.anims.delete(w); }
    a.wobble.length = 0;
    if (reducedMotion()) return;
    for (let i = 0; i < a.rotors.length; i++) {
      try {
        a.wobble.push(trackAnim(a.rotors[i].animate(
          [{ transform: 'translateY(-50%) scaleY(1)' }, { transform: 'translateY(-50%) scaleY(.55)' }],
          { duration: 600, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out', delay: i * 120 }
        )));
      } catch (e) { /* ignore */ }
    }
  }
  function ensureAvatar() {
    if (!modeHasAvatar() || !state.active || !root) { clearAvatar(); return null; }
    let a = state.avatar;
    if (a && a.box.isConnected) return a;
    a = buildAvatar();
    state.avatar = a;
    try { root.append(a.box); } catch (e) { /* ignore */ }
    avatarStart();
    avatarWobble(a);
    placeAvatar();   // no kick(): a parked drone needs no frames, and keydown / startDash() arm the loop
    return a;
  }
  function clearAvatar() {
    const a = state.avatar;
    state.avatar = null;
    state.keys.up = state.keys.down = state.keys.left = state.keys.right = false;
    state.dashUntil = 0; state.invulUntil = 0;
    if (!a) return;
    for (const w of a.wobble) { try { w.cancel(); } catch (e) { /* ignore */ } state.anims.delete(w); }
    try { cancelAnimsOf(a.box); a.box.remove(); } catch (e) { /* ignore */ }
  }
  /* The nose points at the crosshair, so the drone always shows where the mouse half of the input is looking.
   * Zero degrees is "to the right" (the triangle is drawn pointing right), which is what the §7.3 reading of the
   * transform expects: the mouse directly left of the drone reads 180°. */
  function placeAvatar() {
    const a = state.avatar;
    if (!a || !a.box.isConnected) return;
    const p = state.player;
    a.box.style.left = px(p.x);
    a.box.style.top = px(p.y);
    const tx = state.hoverX >= 0 ? state.hoverX : p.x + 1, ty = state.hoverY >= 0 ? state.hoverY : p.y;
    let ang = Math.atan2(ty - p.y, tx - p.x) / DEG;
    if (!isFinite(ang)) ang = 0;
    if (a.ang == null || Math.abs(ang - a.ang) > 0.4) {
      a.ang = ang;
      try { a.nose.style.transform = 'rotate(' + ang.toFixed(2) + 'deg) translate(' + px(AV_R) + ', -5px)'; } catch (e) { /* ignore */ }
    }
  }
  /* §1.2 physics: snappy acceleration with a little slide, capped speed, clamped 20 px inside the viewport. */
  function avatarStep(t, dt) {
    const a = state.avatar;
    if (!a) return;
    // the motion preference can be flipped after the drone was built (settings, or a test), so re-read it
    if (t - (a.rmAt || 0) > 400) { a.rmAt = t; const rm = reducedMotion(); if (rm !== a.rm) { a.rm = rm; avatarWobble(a); } }
    const p = state.player;
    if (dt > 0) {
      const dashing = t < state.dashUntil;
      if (dashing) { p.vx = state.dashVx || 0; p.vy = state.dashVy || 0; }
      else {
        let ax = 0, ay = 0;
        if (state.keys.left) ax -= 1;
        if (state.keys.right) ax += 1;
        if (state.keys.up) ay -= 1;
        if (state.keys.down) ay += 1;
        const L = Math.hypot(ax, ay);
        if (L > 0) { p.vx += (ax / L) * AV_ACCEL * dt; p.vy += (ay / L) * AV_ACCEL * dt; }
        /* Friction is DRAG, not braking: it only bites once the keys are let go. Applying it while a direction
          * is held would fight the 2800 px/s² accelerator to a standstill around 287 px/s and the 420 px/s top
          * speed could never be reached.
          * On release it is applied hard enough to settle inside one frame. A literal 0.86-per-frame decay
          * coasts ~50 px past the key, which reads as the drone ignoring you; the contract the suite holds this
          * to is "position stable ~500 ms after release", and a drone that stops when you stop is the version
          * that makes dodging feel like an input rather than a suggestion. */
        else {
          const f = Math.pow(AV_FRICTION, dt * 60);
          p.vx *= f; p.vy *= f;
          if (Math.hypot(p.vx, p.vy) < AV_MAX_SPEED) { p.vx = 0; p.vy = 0; }
        }
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > AV_MAX_SPEED) { p.vx = p.vx / sp * AV_MAX_SPEED; p.vy = p.vy / sp * AV_MAX_SPEED; }
        if (!L) { if (Math.abs(p.vx) < 1) p.vx = 0; if (Math.abs(p.vy) < 1) p.vy = 0; }
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const W = viewW(), H = viewH();
      if (p.x < AV_MARGIN) { p.x = AV_MARGIN; p.vx = 0; }
      if (p.x > W - AV_MARGIN) { p.x = W - AV_MARGIN; p.vx = 0; }
      if (p.y < AV_MARGIN) { p.y = AV_MARGIN; p.vy = 0; }
      if (p.y > H - AV_MARGIN) { p.y = H - AV_MARGIN; p.vy = 0; }
      p.inWindow = true;   // §1.2: the drone stays whether or not the pointer is over the window
    }
    placeAvatar();
    placeSelf();
  }
  function avatarMoving() {
    return !!(state.avatar && (state.keys.up || state.keys.down || state.keys.left || state.keys.right ||
      now() < state.dashUntil || Math.abs(state.player.vx) > 0.5 || Math.abs(state.player.vy) > 0.5));
  }
  function dashGhost() {
    if (!root || reducedMotion()) return;
    const p = state.player;
    const n = mk('div', 'crs-avatar-ghost');
    n.style.left = px(p.x); n.style.top = px(p.y);
    root.append(n);
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
    try { const an = trackAnim(n.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: 300, easing: 'ease-out', fill: 'forwards' })); an.addEventListener('finish', kill); } catch (e) { /* ignore */ }
    later(kill, 500);
  }
  function startDash() {
    const t = now();
    if (!modeHasAvatar() || !state.avatar || state.ko || !state.player.alive) return false;
    if (t < state.dashReadyAt) return false;   // §7.4: a second Space inside the cooldown is simply ignored
    const p = state.player;
    let dx = 0, dy = 0;
    if (state.keys.left) dx -= 1;
    if (state.keys.right) dx += 1;
    if (state.keys.up) dy -= 1;
    if (state.keys.down) dy += 1;
    if (!dx && !dy) {   // no direction held: dash toward the crosshair
      dx = (state.hoverX >= 0 ? state.hoverX : p.x + 1) - p.x;
      dy = (state.hoverY >= 0 ? state.hoverY : p.y) - p.y;
    }
    const L = Math.hypot(dx, dy) || 1;
    const sp = DASH_PX / (DASH_MS / 1000);
    state.dashVx = dx / L * sp; state.dashVy = dy / L * sp;
    p.vx = state.dashVx; p.vy = state.dashVy;
    state.dashUntil = t + DASH_MS;
    state.dashReadyAt = t + DASH_CD;
    state.invulUntil = t + DASH_IFRAME;
    for (let i = 0; i < DASH_GHOSTS; i++) later(dashGhost, i * (DASH_MS / DASH_GHOSTS));
    csfx('dash');
    updateDashDot();
    kick();
    return true;
  }
  /* One dot on the health panel: lit when the dash is ready, dim while it is not. */
  function updateDashDot() {
    const d = hudEls.dashDot;
    if (!d) return;
    try {
      const show = modeHasAvatar();
      d.style.display = show ? 'inline-block' : 'none';
      if (!show) return;
      d.classList.toggle('ready', now() >= state.dashReadyAt);
    } catch (e) { /* ignore */ }
  }
  function avatarInfo() {
    const p = state.player;
    return { x: p.x, y: p.y, dashing: now() < state.dashUntil };
  }

// ── 92-tick.js ──
  /* ===================================================================== */
  /* 13. Physics loop                                                         */
  /*     v1.3: the §3.5 hitstop clamps dt here, and the §3.1 player ring /     */
  /*     §3.2 aim lines ride this frame rather than owning loops of their own. */
  /* ===================================================================== */
  function kick() {
    if (!state.active || state.animating) return;
    state.animating = true;
    state.lastT = now();
    state.rafId = raf(tick);
  }
  /* A frame that throws must not kill the loop for the rest of the session: the error is recorded in
   * stats().lastError and the next frame is re-armed while anything is still live. */
  function tick(t) {
    state.rafId = 0;
    if (!state.active) { state.animating = false; return; }
    let busy = false;
    try { busy = tickFrame(t); state.tickErrors = 0; }
    catch (e) {
      state.lastError = String((e && e.stack) || e);
      state.tickErrors++;
      busy = state.tickErrors < 120 && !!(state.pieces.length || state.orbs.length || state.beams.length || state.fxQueue.length || state.scoped || state.avatar || state.locks.length || state.repairs.length);
    }
    if (busy && state.active) state.rafId = raf(tick); else state.animating = false;
  }
  function tickFrame(t) {
    let dt = clamp((t - state.lastT) / 1000, 0, 0.05);
    state.lastT = t;
    const W = viewW(), H = viewH();
    let busy = false;
    /* v1.3 §3.5 hitstop: for 70 ms after the player is hit the integrator advances NO time. Frames still run and
     * still consume their timestamps — dt is clamped to zero rather than the frame being skipped — so pieces,
     * orbs and beams resume from exactly where they stopped instead of jumping a window's worth of motion. */
    if (state.hitstopUntil > t) { dt = 0; busy = true; }
    else if (state.hitstopUntil) state.hitstopUntil = 0;
    const resting = [];
    for (const q of state.pieces) if (q.resting) resting.push(q);
    for (const p of state.pieces) {
      if (p.resting) continue;
      busy = true;
      if (t < p.launchAt) continue;
      const prevBottom = p.oy + p.y + p.bb.maxY;
      if (!p.grounded) p.vy += GRAVITY * dt;
      p.vx *= Math.pow(0.6, dt);
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const newBottom = p.oy + p.y + p.bb.maxY;
      const pl = p.ox + p.x + p.bb.minX, pr = p.ox + p.x + p.bb.maxX, pw = pr - pl;
      let support = H;
      for (const q of resting) {
        if (q === p) continue;
        const ql = q.ox + q.x + q.bb.minX, qr = q.ox + q.x + q.bb.maxX;
        const ov = Math.min(pr, qr) - Math.max(pl, ql);
        if (ov < 0.4 * Math.min(pw, qr - ql)) continue;
        const top = q.oy + q.y + q.bb.minY;
        if (prevBottom <= top + 1 && newBottom >= top && top < support) support = top;
      }
      if (newBottom >= support) {
        p.y = support - p.oy - p.bb.maxY;
        if (p.vy > 30) { p.vy = -p.vy * 0.32; p.vx *= 0.75; p.vr *= 0.45; p.grounded = false; }
        else {
          p.vy = 0; p.grounded = true;
          p.vx *= Math.pow(0.001, dt); p.vr *= Math.pow(0.0005, dt);
          const target = Math.round(p.rot / 180) * 180 + p.tilt;
          p.rot += (target - p.rot) * (1 - Math.pow(0.001, dt));
          if (Math.abs(p.vx) < 6) p.vx = 0;
          if (Math.abs(p.vr) < 8) p.vr = 0;
          if (p.vx === 0 && p.vr === 0) { restPiece(p); resting.push(p); continue; }
        }
      } else p.grounded = false;
      const left = p.ox + p.x + p.bb.minX;
      if (left < 0) { p.x -= left; p.vx = -p.vx * 0.5; }
      const right = p.ox + p.x + p.bb.maxX;
      if (right > W) { p.x -= (right - W); p.vx = -p.vx * 0.5; }
      if (t - p.bornAt > 6000 && Math.abs(p.vy) < 60 && Math.abs(p.vx) < 20) { restPiece(p); resting.push(p); continue; }
      applyTransform(p);
    }
    if (state.fxQueue.length) { runFx(); busy = busy || state.fxQueue.length > 0; }
    // v1.2 A8: continuous combat / scope motion is folded into this single loop (no extra RAF handles)
    if (state.orbs.length) { orbStep(t, dt); busy = busy || state.orbs.length > 0; }
    if (state.beams.length) { beamStep(); busy = true; }
    if (state.scoped) { scopeStep(t); busy = true; }
    /* ── v1.4 ──
     * The drone (§1), the lock frames (§2) and the repair beams (§3) all ride THIS loop too. A PARKED drone does
     * not keep the loop awake — keydown and startDash() both kick() it, and scheduleHover()'s existing move frame
     * carries the nose — so standing still costs no frames at all, exactly like v1.3. */
    if (state.avatar) { avatarStep(t, dt); if (avatarMoving()) busy = true; }
    if (state.locks.length) { stepLocks(t); busy = true; }
    if (state.repairs.length) { stepRepairs(); busy = true; }
    // v1.3 §3.1 / §3.2: the player ring rides this loop (and scheduleHover()'s RAF) — it never owns one
    if (state.self) selfStep();
    if (state.aimlines.length) { stepAimLines(); busy = true; }
    if (busy && state.combat && !state.paused && state.player.hp < state.player.max) regenStep();
    return busy;
  }
  function onResize() {
    if (state.resizeRaf) return;
    state.resizeRaf = raf(() => {
      state.resizeRaf = 0;
      if (!state.active) return;
      setupCanvas(true);
      applyZoom();
      const W = viewW(), H = viewH();
      for (const p of state.pieces) {
        const left = p.ox + p.x + p.bb.minX, right = p.ox + p.x + p.bb.maxX;
        if (right > W) p.x -= (right - W);
        if (left < 0) p.x -= left;
        if (p.oy + p.y + p.bb.maxY > H) { p.y = H - p.oy - p.bb.maxY; }
        else if (p.resting && p.oy + p.y + p.bb.maxY < H - 1) { wakePiece(p); }
        applyTransform(p);
      }
      refreshHover();
      scheduleAura();
      if (state.avatar) {   // v1.4 §1.2: the drone lives in screen space, so a resize re-clamps it
        const p = state.player;
        p.x = clamp(p.x, AV_MARGIN, Math.max(AV_MARGIN, W - AV_MARGIN));
        p.y = clamp(p.y, AV_MARGIN, Math.max(AV_MARGIN, H - AV_MARGIN));
        placeAvatar(); placeSelf();
      }
      kick();
    });
  }

// ── 93-lock.js ──
// ── v1.4 §2: the Virtua Cop lock-on — a frame that closes on a target, and you shoot it open again ──
  /* The user was explicit: "the aim lock I meant is the Virtua Cop idea". In Virtua Cop a red frame snaps around
   * the enemy that is drawing on you and closes over a couple of seconds; you shoot THAT ENEMY before the frame
   * shuts and the shot never happens. So this is not a dodging device, it is an aiming device: the threat and
   * the target are the same object, and the player only ever has one job — point and shoot.
   *
   *   quickdraw  the frame sits on the ENEMY and shooting it is the only answer (there is nothing to dodge)
   *   survival   the frame sits on the DRONE, stops following at 1.0 s, so you may shoot the enemy OR fly out
   *
   * Breaking it needs one point of damage from any weapon, not a kill. We detect that by watching the enemy's
   * hp in the frame loop rather than by hooking the damage sink, so every weapon — hitscan, hold tick, AoE,
   * slash, collapse — breaks a lock identically, with no special case anywhere in the weapon code. */

  function lockDuration(rec) { return (rec && rec.dtier === 'front') ? LOCK_MS_FRONT : LOCK_MS; }
  function lockPhaseOf(k) { return k < LOCK_P1 ? 'warn' : (k < LOCK_P2 ? 'close' : 'imminent'); }
  /* Bracket distance in px for a normalised progress k, reduced motion snapping it to the three readings. */
  function lockGap(k) {
    if (reducedMotion()) return k < LOCK_P1 ? LOCK_GAP0 : (k < LOCK_P2 ? LOCK_GAP1 : LOCK_GAP2);
    if (k < LOCK_P1) return LOCK_GAP0;
    if (k < LOCK_P2) return LOCK_GAP0 + (LOCK_GAP1 - LOCK_GAP0) * ((k - LOCK_P1) / (LOCK_P2 - LOCK_P1));
    return LOCK_GAP1 + (LOCK_GAP2 - LOCK_GAP1) * clamp((k - LOCK_P2) / (1 - LOCK_P2), 0, 1);
  }
  function lockColor(phase) { return phase === 'warn' ? 'rgba(255,255,255,.7)' : (phase === 'close' ? '#e3b341' : '#e5484d'); }

  function buildLock() {
    const node = mk('div', 'crs-lock');
    const ring = mk('div', 'crs-lock-ring');
    const tag = mk('span', 'crs-lock-tag');
    const brackets = [];
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      const b = mk('div', 'crs-lock-bracket');
      try { b.classList.add('crs-lock-' + corner); } catch (e) { /* ignore */ }
      brackets.push(b);
      node.append(b);
    }
    node.append(ring, tag);
    return { node, ring, tag, brackets };
  }
  /* Where the frame is anchored this frame. quickdraw: the enemy rect. survival: the drone, until it freezes. */
  function lockAnchor(lk) {
    if (lk.onEnemy) {
      const r = rectOf(lk.rec.el);
      if (!r) return null;
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
    }
    const p = state.player;
    return { cx: p.x, cy: p.y, w: 0, h: 0 };
  }
  function placeLock(lk, k) {
    const gap = lockGap(k);
    const halfW = lk.w / 2 + gap, halfH = lk.h / 2 + gap;
    const s = lk.node.style;
    s.left = px(lk.cx - halfW); s.top = px(lk.cy - halfH);
    s.width = px(2 * halfW); s.height = px(2 * halfH);
    const color = lockColor(lk.phase);
    for (const b of lk.brackets) { try { b.style.borderColor = color; } catch (e) { /* ignore */ } }
    try { lk.ring.style.borderColor = color; } catch (e) { /* ignore */ } 
  }
  /* §10.4: a covered enemy cannot be shot, so its frame is dashed and says so — unless the weapon in hand can
   * punch through cover, in which case it says THAT instead. The answer holds for the enemy whether the frame is
   * drawn on it (quickdraw) or on the drone (survival): either way it tells you whether shooting is an option.
   * isCovered() runs a real hit test, so it is sampled a few times a second rather than every frame, and always
   * the moment the weapon changes — which is exactly when the answer can flip. */
  function lockCoverTag(lk, t) {
    const weapon = state.weapon;
    if (lk.coverAt && weapon === lk.tagWeapon && (t || now()) - lk.coverAt < 100) return;
    lk.coverAt = t || now();
    lk.tagWeapon = weapon;
    const covered = isCovered(lk.rec.el);
    const want = covered ? (canPierceNow() ? msg('hintPierce') : msg('hintCovered')) : '';
    if (lk.tagText !== want) { lk.tagText = want; try { lk.tag.textContent = want; } catch (e) { /* ignore */ } }
    if (lk.coveredNow !== covered) {
      lk.coveredNow = covered;
      try { lk.node.classList.toggle('crs-lock-covered', covered); } catch (e) { /* ignore */ }
    }
  }
  /* `forced` (debug.forceLock) always runs the canonical 3.0 s timeline: the §10.2 shortening is a balance rule
   * for enemies the game picked, and a debug hook that silently ran 2.4 s on some elements and 3.0 s on others
   * would make every timing inspection depend on where the element happened to sit in the stack. */
  function startLock(rec, forced) {
    if (!root || !state.active || !modeHasEnemies() || state.paused || state.ko) return null;
    if (!rec || !rec.el || !rec.el.isConnected) return null;
    if (rec.lock) return rec.lock;
    if (!forced && now() < (rec.lockReadyAt || 0)) return null;
    if (state.locks.length >= LOCK_MAX) return null;   // §2.2: three at a time, the oldest ones finish first
    const parts = buildLock();
    const lk = Object.assign({ id: ++state.lockSeq, rec, startedAt: now(), dur: forced ? LOCK_MS : lockDuration(rec), phase: 'warn',
      onEnemy: modeLockOnEnemy(), frozen: false, cx: 0, cy: 0, w: 0, h: 0, beeped: '', done: false, forced: !!forced, coverAt: 0, tagWeapon: null,
      hp0: hpOf(rec.el).hp, tagText: null, coveredNow: null }, parts);
    const a = lockAnchor(lk);
    if (!a) { try { parts.node.remove(); } catch (e) { /* ignore */ } return null; }
    lk.cx = a.cx; lk.cy = a.cy; lk.w = a.w; lk.h = a.h;
    rec.lock = lk;
    rec.phase = 'lock';
    state.locks.push(lk);
    root.append(lk.node);
    placeLock(lk, 0);
    lockCoverTag(lk);
    addAimLine(rec);         // v1.3 §3.2 still answers "which one, right now"
    csfx('lockWarn');
    kick();
    return lk;
  }
  function removeLock(lk, keepRecover) {
    const i = state.locks.indexOf(lk);
    if (i >= 0) state.locks.splice(i, 1);
    const rec = lk.rec;
    if (rec && rec.lock === lk) {
      rec.lock = null;
      if (rec.phase === 'lock') rec.phase = 'idle';
      dropAimLine(rec);
      try { rec.aura.classList.remove('crs-lock-imminent'); } catch (e) { /* ignore */ }
      if (keepRecover) rec.lockReadyAt = now() + LOCK_RECOVER_MS;
    }
    try { cancelAnimsOf(lk.node); lk.node.remove(); } catch (e) { /* ignore */ }
  }
  function clearLocks() { for (const lk of state.locks.slice()) removeLock(lk, false); }
  function dropLock(rec) { if (rec && rec.lock) removeLock(rec.lock, false); }
  /* §2.2: one point of damage is enough. The brackets snap OUTWARD (the opposite of closing) so the cancel
   * reads as the frame being blown open, 차단! holds for a second, and the enemy cannot re-arm for 1.5 s. */
  function breakLock(lk) {
    if (lk.done) return;
    lk.done = true;
    const rec = lk.rec;
    state.locksBroken++;
    state.player.score += 15;
    csfx('lockBreak');
    try {
      lk.tag.textContent = msg('lockBlocked');
      lk.node.classList.add('crs-lock-broken');
      if (!reducedMotion()) trackAnim(lk.node.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 320, easing: 'ease-out', fill: 'forwards' }));
    } catch (e) { /* ignore */ }
    if (root && rec) {
      const n = mk('div', 'crs-dmg');
      n.style.left = px(lk.cx); n.style.top = px(lk.cy - 26);
      n.style.font = '800 20px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      n.style.color = '#7ee787';
      n.style.textShadow = '0 1px 3px rgba(0,0,0,.9)';
      n.style.transform = 'translate(-50%, -50%)';
      n.textContent = msg('lockBlocked');
      root.append(n);
      const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
      try { const a = trackAnim(n.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 1000, easing: 'ease-out', fill: 'forwards' })); a.addEventListener('finish', kill); } catch (e) { /* ignore */ }
      later(kill, 1200);
    }
    const r = rec;
    later(() => { removeLock(lk, true); if (r && state.hostiles.get(r.el) === r) scheduleAttack(r, attackInterval(r)); }, 320);
    updatePlayerHud(); scheduleHud();
  }
  /* §2.3 — what failing costs, which is the whole difference between the two combat modes. */
  function fireLock(lk) {
    if (lk.done) return;
    lk.done = true;
    const rec = lk.rec;
    csfx('lockFire');
    if (lk.onEnemy) {
      // quickdraw: no health to lose, so the enemy spends the shot UNDOING one of your kills (§3)
      edgeFlash();
      tryRepair(rec, true);
    } else {
      const p = state.player;
      const d = Math.hypot(p.x - lk.cx, p.y - lk.cy);
      if (d <= LOCK_HIT_R && now() >= state.invulUntil) {
        damagePlayer(26 + Math.round(Math.sqrt(rec.area || 40000) / 70), { from: { x: lk.cx, y: lk.cy } });
      } else {
        state.nearMisses++;
        selfGraze({ x: lk.cx, y: lk.cy });
        sfx('whiff');
      }
    }
    const r = rec;
    removeLock(lk, false);
    if (r) { r.lockReadyAt = now() + LOCK_RECOVER_MS; if (state.hostiles.get(r.el) === r) scheduleAttack(r, attackInterval(r)); }
  }
  /* A 150 ms red rim at the edge of the screen: quickdraw has no health bar to flash, so the failure still has
   * to land somewhere the player is looking. */
  function edgeFlash() {
    if (!root) return;
    const n = mk('div', 'crs-vignette crs-vignette-edge');
    root.append(n);
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
    try { const a = trackAnim(n.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 150, easing: 'ease-out', fill: 'forwards' })); a.addEventListener('finish', kill); } catch (e) { /* ignore */ }
    later(kill, 400);
  }
  /* The frame loop. Runs from tickFrame(), so it inherits the hitstop and stops with everything else. */
  function stepLocks(t) {
    for (const lk of state.locks.slice()) {
      if (lk.done) continue;
      const rec = lk.rec;
      // the enemy went away (killed, restored, released, scrolled off) — the frame cannot outlive it
      if (!rec || !rec.el || !rec.el.isConnected || state.hostiles.get(rec.el) !== rec) { removeLock(lk, false); continue; }
      try { if (rec.el.hasAttribute('data-crs-broken')) { removeLock(lk, false); continue; } } catch (e) { removeLock(lk, false); continue; }
      // §2.2 the break condition: ANY damage to this enemy, from any weapon, cancels the shot
      const hp = hpOf(rec.el).hp;
      if (hp < lk.hp0) { breakLock(lk); continue; }
      const k = clamp((t - lk.startedAt) / lk.dur, 0, 1);
      const phase = lockPhaseOf(k);
      if (phase !== lk.phase) {
        lk.phase = phase;
        if (phase === 'close') csfx('lockClose');
        else if (phase === 'imminent') { csfx('lockImminent'); try { rec.aura.classList.add('crs-lock-imminent'); } catch (e) { /* ignore */ } }
      }
      // survival: the frame follows the drone for the first third, then freezes — that freeze IS the dodge window
      if (!lk.onEnemy && !lk.frozen && k >= LOCK_FOLLOW) lk.frozen = true;
      if (lk.onEnemy || !lk.frozen) {
        const a = lockAnchor(lk);
        if (a) { lk.cx = a.cx; lk.cy = a.cy; lk.w = a.w; lk.h = a.h; }
      }
      placeLock(lk, k);
      lockCoverTag(lk, t);
      // 0.2 s blink through the imminent phase (held steady under reduced motion, where blinking is the problem)
      try { lk.node.style.opacity = (phase === 'imminent' && !reducedMotion() && Math.floor((t - lk.startedAt) / 200) % 2) ? '0.45' : '1'; } catch (e) { /* ignore */ }
      if (k >= 1) fireLock(lk);
    }
  }
  /* §2.2 aim assist: a click anywhere inside a closing frame is a click on that enemy, not on whatever child
   * element happens to be under the pointer. pickTarget() asks this before it returns. */
  function lockAt(x, y) {
    for (const lk of state.locks) {
      if (lk.done || !lk.rec || !lk.rec.el || !lk.rec.el.isConnected) continue;
      const r = rectOf(lk.node);
      if (!r) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return lk;
    }
    return null;
  }
  debug.forceLock = (el) => {
    if (!state.active || !modeHasEnemies() || state.paused || state.ko) return null;
    bringIntoView(el);
    const existing = state.hostiles.get(el) || null;
    let rec = existing;
    if (!rec) { const area = hostileArea(el); if (area == null) return null; rec = markHostile(el, area); }
    if (!rec) return null;
    untrack(rec.timer); rec.timer = 0;
    clearPhase(rec);
    const lk = startLock(rec, true);
    if (!lk && !existing && state.hostiles.get(el) === rec) releaseHostile(el);
    return lk ? lk.id : null;
  };

// ── 94-repair.js ──
// ── v1.4 §3: enemies that REPAIR the page, and the destruction-ratio meter that makes it matter ──
  /* Until now breaking something was permanent, so combat had no objective: you could ignore every enemy and
   * still "win". Now each hostile periodically pulls one of your kills back — a cyan beam reaches from it to the
   * nearest broken element, and 1.5 s later the debris flies back into place and the element is whole again.
   * The destruction-ratio meter turns that into a number you are fighting over.
   *
   * Which pieces belong to the element being repaired is worked out geometrically, from where each piece SPAWNED
   * (`ox + cx`, `oy + cy`) against the element's box. A hidden element keeps its layout box, so that box is still
   * exactly the one the pieces came from, and no piece has to carry a back-reference. */

  function repairIntervalOf(rec) {
    const base = REPAIR_MS[rec && rec.tier] || REPAIR_MS.shooter;
    const k = depthRepairMul(rec);
    if (!k) return 0;                       // §10.2: `front` enemies attack, they do not repair
    return base * k * difficultyMul();
  }
  function scheduleRepair(rec) {
    untrack(rec.repairTimer); rec.repairTimer = 0;
    if (!modeHasRepair() || debug.noRepair) return;
    const ms = repairIntervalOf(rec);
    if (!(ms > 0)) return;
    rec.repairTimer = later(() => { rec.repairTimer = 0; tryRepair(rec, false); scheduleRepair(rec); }, ms);
  }
  function repairBusy(el) { for (const rp of state.repairs) if (rp.el === el) return true; return false; }
  /* Nearest broken original within 600 px of the enemy centre; nothing in range means this turn is skipped. */
  function repairCandidate(rec) {
    const r = rectOf(rec.el);
    if (!r) return null;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bestD = Infinity;
    /* A hammer that breaks a card often breaks a child first, so `state.broken` can hold both. Rebuilding the
      * inner one would leave the card still gone — the outermost broken element is the one worth putting back. */
    const nested = new Set();
    for (const a of state.broken) {
      for (const b of state.broken) {
        if (a === b || !a.el || !b.el) continue;
        try { if (a.el.contains(b.el)) nested.add(b.el); } catch (e) { /* ignore */ }
      }
    }
    for (const b of state.broken) {
      const el = b.el;
      if (!el || !el.isConnected || el === rec.el || repairBusy(el) || nested.has(el)) continue;
      const er = rectOf(el);
      if (!er || er.width < 1 || er.height < 1) continue;
      const d = Math.hypot(er.left + er.width / 2 - cx, er.top + er.height / 2 - cy);
      if (d <= REPAIR_RANGE && d < bestD) { bestD = d; best = el; }
    }
    return best;
  }
  function placeRepairBeam(rp) {
    const r = rectOf(rp.rec.el), er = rectOf(rp.el);
    if (!r || !er) return;
    const tx = er.left + er.width / 2, ty = er.top + er.height / 2;
    const from = { x: clamp(tx, r.left, r.right), y: clamp(ty, r.top, r.bottom) };
    const len = Math.hypot(tx - from.x, ty - from.y);
    const ang = Math.atan2(ty - from.y, tx - from.x);
    const s = rp.node.style;
    s.left = px(from.x); s.top = px(from.y); s.width = px(len); s.height = '3px';
    s.transform = 'translateY(-1.5px) rotate(' + ang.toFixed(4) + 'rad)';
    rp.x1 = from.x; rp.y1 = from.y; rp.x2 = tx; rp.y2 = ty;
    const g = rp.ghost.style;
    g.left = px(er.left); g.top = px(er.top); g.width = px(er.width); g.height = px(er.height);
  }
  function tryRepair(rec, forced) {
    if (!root || !state.active || !modeHasRepair() || state.paused) return null;
    if (!forced && debug.noRepair) return null;
    if (!rec || !rec.el || !rec.el.isConnected || state.hostiles.get(rec.el) !== rec) return null;
    const el = repairCandidate(rec);
    if (!el) return null;
    const node = mk('div', 'crs-repair');
    node.style.transformOrigin = '0 50%';
    const ghost = mk('div', 'crs-repair-ghost');
    root.append(node, ghost);
    const rp = { rec, el, node, ghost, startedAt: now(), dur: REPAIR_BEAM_MS, delays: 0, timer: 0, done: false, x1: 0, y1: 0, x2: 0, y2: 0 };
    state.repairs.push(rp);
    placeRepairBeam(rp);
    // §10.4: a back-rank enemy drops its blur while it works, so you can see who is undoing your kills
    try { rec.aura.classList.add('crs-repairing'); } catch (e) { /* ignore */ }
    try { trackAnim(node.animate([{ backgroundPosition: '0px 0px' }, { backgroundPosition: '20px 0px' }], { duration: 500, iterations: Infinity, easing: 'linear' })); } catch (e) { /* ignore */ }
    csfx('repair');
    armRepairTimer(rp);
    kick();
    return el;
  }
  function armRepairTimer(rp) {
    untrack(rp.timer);
    rp.timer = later(() => { rp.timer = 0; completeRepair(rp); }, Math.max(0, rp.startedAt + rp.dur - now()));
  }
  function removeRepair(rp) {
    const i = state.repairs.indexOf(rp);
    if (i >= 0) state.repairs.splice(i, 1);
    untrack(rp.timer); rp.timer = 0;
    try { if (rp.rec && rp.rec.aura && !state.repairs.some((o) => o.rec === rp.rec)) rp.rec.aura.classList.remove('crs-repairing'); } catch (e) { /* ignore */ }
    try { cancelAnimsOf(rp.node); rp.node.remove(); } catch (e) { /* ignore */ }
    try { cancelAnimsOf(rp.ghost); rp.ghost.remove(); } catch (e) { /* ignore */ }
  }
  function clearRepairs() { for (const rp of state.repairs.slice()) removeRepair(rp); }
  function dropRepairsOf(rec) { for (const rp of state.repairs.slice()) if (rp.rec === rec) removeRepair(rp); }
  /* §3.1: shooting the beam itself buys you 0.4 s, twice. It never absorbs the shot — the page is still hit. */
  function delayRepair(rp) {
    if (rp.done || rp.delays >= REPAIR_DELAY_MAX) return false;
    rp.delays++;
    rp.dur += REPAIR_DELAY_MS;
    armRepairTimer(rp);
    try { trackAnim(rp.node.animate([{ filter: 'brightness(2.4)' }, { filter: 'brightness(1)' }], { duration: 180, easing: 'ease-out' })); } catch (e) { /* ignore */ }
    sfx('clack');
    return true;
  }
  function hitRepairBeams(x, y, R) {
    let n = 0;
    for (const rp of state.repairs.slice()) {
      const q = nearestOnSegment(rp.x1, rp.y1, rp.x2, rp.y2, x, y);
      if (Math.hypot(q.x - x, q.y - y) <= R && delayRepair(rp)) n++;
    }
    return n;
  }
  function hitRepairBeamsWithin(x, y, R) { return hitRepairBeams(x, y, R); }
  function hitRepairBeamsAlong(x1, y1, x2, y2, R) {
    let n = 0;
    for (const rp of state.repairs.slice()) {
      const a = nearestOnSegment(x1, y1, x2, y2, rp.x1, rp.y1);
      const b = nearestOnSegment(x1, y1, x2, y2, rp.x2, rp.y2);
      const m = nearestOnSegment(x1, y1, x2, y2, (rp.x1 + rp.x2) / 2, (rp.y1 + rp.y2) / 2);
      const d = Math.min(Math.hypot(a.x - rp.x1, a.y - rp.y1), Math.hypot(b.x - rp.x2, b.y - rp.y2), Math.hypot(m.x - (rp.x1 + rp.x2) / 2, m.y - (rp.y1 + rp.y2) / 2));
      if (d <= R && delayRepair(rp)) n++;
    }
    return n;
  }
  function stepRepairs() { for (const rp of state.repairs) if (!rp.done) placeRepairBeam(rp); }

  /* ---- putting ONE element back (the existing restore(), narrowed to a single target) ---- */
  /* The piece flies back to where it spawned (translate 0 / rotate 0 in its own frame) over 600 ms and fades. */
  function flyPieceHome(p) {
    const node = p.node;
    try { node.classList.remove('crs-debris', 'crs-chip'); node.classList.add('crs-fading'); } catch (e) { /* ignore */ }
    const kill = () => { try { node.remove(); } catch (e) { /* ignore */ } };
    if (reducedMotion()) { kill(); return; }
    try {
      const a = trackAnim(node.animate([
        { transform: 'translate(' + p.x.toFixed(2) + 'px, ' + p.y.toFixed(2) + 'px) rotate(' + p.rot.toFixed(2) + 'deg)', opacity: 1 },
        { transform: 'translate(0px, 0px) rotate(0deg)', opacity: 0 }
      ], { duration: REPAIR_PIECE_MS, easing: 'ease-in-out', fill: 'forwards' }));
      a.addEventListener('finish', kill); a.addEventListener('cancel', kill);
    } catch (e) { kill(); return; }
    later(kill, REPAIR_PIECE_MS + 200);
  }
  /* §9.3: if the debris already expired there is nothing to fly back, so the element itself fades in instead. */
  function fadeInOriginal(el) {
    if (reducedMotion()) return;
    try { trackAnim(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: REPAIR_FADE_IN_MS, easing: 'ease-out' })); } catch (e) { /* ignore */ }
  }
  function piecesOf(el) {
    const r = rectOf(el);
    const out = [];
    if (!r || r.width < 1 || r.height < 1) return out;
    for (const p of state.pieces) {
      const sx = p.ox + p.cx, sy = p.oy + p.cy;
      if (sx >= r.left - 2 && sx <= r.right + 2 && sy >= r.top - 2 && sy <= r.bottom + 2) out.push(p);
    }
    return out;
  }
  function restoreOne(el) {
    let idx = -1;
    for (let i = 0; i < state.broken.length; i++) { if (state.broken[i].el === el) { idx = i; break; } }
    if (idx < 0) return false;
    const brec = state.broken[idx];
    state.broken.splice(idx, 1);
    try { if (brec.mo) brec.mo.disconnect(); } catch (e) { /* ignore */ }
    const mine = piecesOf(el);
    for (const p of mine) {
      const i = state.pieces.indexOf(p);
      if (i >= 0) state.pieces.splice(i, 1);
      state.gpuSum -= p.gpu;
      cancelAnimsOf(p.node);
      flyPieceHome(p);
    }
    for (const s of brec.saved) {
      try { if (s.value) s.node.style.setProperty(s.prop, s.value, s.priority); else s.node.style.removeProperty(s.prop); } catch (e) { /* ignore */ }
    }
    try { el.removeAttribute('data-crs-broken'); } catch (e) { /* ignore */ }
    const hrec = state.hp.get(el);
    if (hrec) hrec.hp = hrec.max;   // §3.1 item 4: it comes back whole
    if (!mine.length) fadeInOriginal(el);
    return true;
  }
  function completeRepair(rp) {
    if (rp.done) return;
    rp.done = true;
    const el = rp.el, rec = rp.rec;
    removeRepair(rp);
    // cancelled: the enemy died, was released, or the target is already whole again
    if (!el || !el.isConnected || !state.active) return;
    if (!rec || state.hostiles.get(rec.el) !== rec) return;
    let broken = false;
    try { broken = el.hasAttribute('data-crs-broken'); } catch (e) { broken = false; }
    if (!broken) return;
    if (!restoreOne(el)) return;
    state.repaired++;
    const max = (state.hp.get(el) || {}).max || hpMax(el);
    state.player.score -= Math.round(max / 2);
    csfx('repairDone');
    syncRatioMeter(true);
    updatePlayerHud(); scheduleHud(); refreshHover();
    kick();
  }

  /* ---- §3.2 destruction-ratio meter ---- */
  function destroyRatio() {
    const vw = viewW(), vh = viewH();
    let brokenArea = 0;
    for (const b of state.broken) {
      const el = b.el;
      if (!el || !el.isConnected) continue;
      const r = rectOf(el);
      if (!r || r.width < 1 || r.height < 1) continue;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
      brokenArea += r.width * r.height;
    }
    let liveArea = 0;
    const cands = walkCandidates(vw / 2, vh / 2, { limit: 0.7 * vw * vh, minArea: 1200, descendCollected: false });
    for (const c of cands) liveArea += c.area;
    const total = brokenArea + liveArea;
    return total > 0 ? clamp(brokenArea / total, 0, 1) : 0;
  }
  function updateRatioHud() {
    const n = state.ratioNodes;
    if (!n) return;
    const on = !!(state.active && modeHasRatio());
    try {
      n.box.classList.toggle('on', on);
      if (hudEls.fallback) n.box.style.display = on ? 'block' : 'none';
      if (!on) return;
      const pct = Math.round(state.ratio * 100);
      n.label.textContent = msg('labelRatio') + ' ' + pct + '%' + (state.ratio >= RATIO_DOMINATE ? ' · ' + msg('labelDominating') : '');
      n.fill.style.width = (state.ratio * 100).toFixed(1) + '%';
      n.fill.style.background = state.ratio >= RATIO_DOMINATE ? '#ffd166' : '#e5484d';
    } catch (e) { /* ignore */ }
  }
  /* `drop` animates the bar leftwards so a repair is impossible to miss (§3.2). */
  function syncRatioMeter(drop) {
    if (!modeHasRatio()) { clearRatioMeter(); return; }
    const before = state.ratio;
    state.ratio = destroyRatio();
    state.ratioDirty = false; state.ratioAt = now(); state.ratioBrokenN = state.broken.length;
    if (drop && state.ratioNodes && state.ratio < before - 0.002 && !reducedMotion()) {
      try { trackAnim(state.ratioNodes.fill.animate([{ width: (before * 100).toFixed(1) + '%' }, { width: (state.ratio * 100).toFixed(1) + '%' }], { duration: RATIO_DROP_MS, easing: 'ease-out' })); } catch (e) { /* ignore */ }
    }
    updateRatioHud();
    armRatioTick();
  }
  function ratioTick() {
    state.ratioTimer = 0;
    if (!state.active || !modeHasRatio()) return;
    state.ratio = destroyRatio();
    state.ratioDirty = false; state.ratioAt = now(); state.ratioBrokenN = state.broken.length;
    updateRatioHud();
    state.ratioTimer = later(ratioTick, RATIO_REFRESH_MS);
  }
  /* The HUD bar is happy on a 2 s clock (§3.2), but a reader of stats() asking right after a break must not get
   * the number from before it. Recompute on demand when something has changed since the last measurement. */
  /* Throttled, because stats() can be read many times a second and destroyRatio() walks the page. The one case
   * that must never be stale is the one every caller actually asks about — something was broken or put back —
   * so a change in the broken count always forces a fresh measurement, whatever the throttle says. */
  const RATIO_MIN_GAP = 250;
  function ratioNow() {
    if (!modeHasRatio()) return 0;
    const changed = state.broken.length !== state.ratioBrokenN;
    if (changed || (state.ratioDirty && now() - state.ratioAt >= RATIO_MIN_GAP) || now() - state.ratioAt > RATIO_REFRESH_MS) {
      state.ratio = destroyRatio();
      state.ratioDirty = false; state.ratioAt = now(); state.ratioBrokenN = state.broken.length;
    }
    return state.ratio;
  }
  function armRatioTick() {
    if (state.ratioTimer || !state.active || !modeHasRatio()) return;
    state.ratioTimer = later(ratioTick, RATIO_REFRESH_MS);
  }
  function clearRatioMeter() {
    untrack(state.ratioTimer); state.ratioTimer = 0;
    state.ratio = 0;
    updateRatioHud();
  }
  debug.noRepair = false;
  debug.forceRepair = (el) => {
    const rec = state.hostiles.get(el);
    if (!rec) return null;
    return tryRepair(rec, true);
  };
  debug.depthOf = (el) => depthOf(el);

// ── 95-events.js ──
  /* ===================================================================== */
  /* 14. Events                                                               */
  /*     v1.3 §1: the - / _ / [ and = / + / ] power hotkeys are gone.          */
  /* ===================================================================== */
  const SWALLOW = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'selectstart', 'dragstart'];
  function isHudEvent(e) {
    if (!hud) return false;
    try {
      const t = e.target;
      if (t && t.nodeType && hud.contains(t)) return true;
      if (e.composedPath && e.composedPath().includes(hud)) return true;
    } catch (err) { /* ignore */ }
    return false;
  }
  function isEditable(t) {
    if (!t || t.nodeType !== 1) return false;
    const tag = tagOf(t);
    return tag === 'input' || tag === 'textarea' || tag === 'select' || !!t.isContentEditable;
  }
  /* v1.2 A2: scope state follows the right button through the Pointer Events chord model — `buttons` is read on
   * pointerdown, pointerup AND pointermove (a left press while RMB is held is only a pointermove). */
  function rmbSync(e) {
    const rmb = (e.buttons & 2) !== 0;
    const sc = state.scope;
    if (rmb === sc.rmb) return;
    sc.rmb = rmb;
    syncScope();
  }
  /* A2: the keyup / pointerup that releases Shift or RMB never reaches a blurred page, so the chord would stay
   * "held" and re-scope on the next weapon switch with nothing pressed. rmbSync() re-learns the real button state
   * from the next pointer event and Shift re-arms on its next keydown. */
  function resetChord() {
    const sc = state.scope;
    sc.rmb = false; sc.shiftDown = false; sc.shiftWant = false;
    untrack(sc.shiftTimer); sc.shiftTimer = 0;
  }
  /* v1.4 §1.2: once a drone exists the mouse stops BEING the player and only aims. state.player.x/y is the
   * drone's centre from then on — which is the whole point of the split — so the pointer must not write it. */
  function trackPlayer(e) {
    if (typeof e.clientX !== 'number') return;
    state.player.inWindow = true;
    if (state.avatar) return;
    state.player.x = e.clientX; state.player.y = e.clientY;
  }
  function onSwallow(e) {
    if (!state.active) return;
    if (isHudEvent(e)) return;
    if (handledEvents.has(e)) return;
    handledEvents.add(e);
    try { e.preventDefault(); } catch (err) { /* ignore */ }
    try { e.stopImmediatePropagation(); } catch (err) { /* ignore */ }
    if (e.type === 'pointerdown' || e.type === 'pointerup') { ensureAudio(); trackPlayer(e); rmbSync(e); }
    if (e.type === 'pointerdown' && e.button === 0 && e.isPrimary !== false) {
      if (state.ko) return;   // KO screen: holds / slashes / shots disabled
      const W = WEAPONS[state.weapon];
      if (W.hold) startHold(state.weapon, e.clientX, e.clientY, e.pointerId);
      else if (W.input === 'drag') startSlash(e.clientX, e.clientY, e.pointerId);
      else smashAt(e.clientX, e.clientY);
    }
  }
  /* Hold stop / slash resolve (A6). Registered BEFORE the swallow listeners so it runs ahead of their
   * stopImmediatePropagation and the HUD early-return; it never preventDefaults. A pointerup of a button other
   * than the primary one (RMB scope release) is ignored (v1.2 A2); pointercancel / lostpointercapture (button −1) stop. */
  function onHoldEnd(e) {
    if (!state.active) return;
    if (e.type === 'pointerup' && e.button !== 0) return;
    if (e.type === 'pointercancel' && state.scope.rmb) { state.scope.rmb = false; syncScope(); }
    const h = state.hold;
    if (h && (h.pointerId == null || e.pointerId == null || e.pointerId === h.pointerId)) stopHold();
    const s = state.slash;
    if (s && (s.pointerId == null || e.pointerId == null || e.pointerId === s.pointerId)) {
      if (e.type === 'pointerup') resolveSlash(e.clientX, e.clientY); else resolveSlash();
    }
  }
  /* ── v1.4 §1.2: WASD / arrows drive the drone, Space dashes ──
   * Claimed ONLY while a drone exists (survival) and never while a form field has focus, so in rampage and
   * quickdraw — and in any text box anywhere — these keys still belong to the page, exactly as §7.13 requires. */
  function moveDirOf(c, k) {
    if (c === 'KeyW' || k === 'w' || k === 'W' || c === 'ArrowUp' || k === 'ArrowUp') return 'up';
    if (c === 'KeyS' || k === 's' || k === 'S' || c === 'ArrowDown' || k === 'ArrowDown') return 'down';
    if (c === 'KeyA' || k === 'a' || k === 'A' || c === 'ArrowLeft' || k === 'ArrowLeft') return 'left';
    if (c === 'KeyD' || k === 'd' || k === 'D' || c === 'ArrowRight' || k === 'ArrowRight') return 'right';
    return null;
  }
  function isSpaceKey(c, k) { return c === 'Space' || k === ' ' || k === 'Spacebar'; }
  function releaseKeys() { state.keys.up = state.keys.down = state.keys.left = state.keys.right = false; }
  function onWindowBlur() { stopHold(); cancelSlash(); resetChord(); scopeOff(); releaseKeys(); pauseCombat(); }
  function onWindowFocus() { resumeCombat(); }
  function onMotionPref() { if (state.avatar) avatarWobble(state.avatar); }
  function onVisibility() {
    if (doc.visibilityState === 'hidden') { stopHold(); cancelSlash(); resetChord(); scopeOff(); releaseKeys(); pauseCombat(); }
    else resumeCombat();
  }
  function onPointerLeave(e) { if (state.active && e.relatedTarget == null) state.player.inWindow = false; }
  function onPointerEnter() { if (state.active) state.player.inWindow = true; }
  function onScroll() { if (state.active && state.hostiles.size) scheduleAura(); }
  function onMove(e) {
    if (!state.active) return;
    state.hoverX = e.clientX; state.hoverY = e.clientY;   // hold ticks fire here
    state.overHud = isHudEvent(e);
    trackPlayer(e);
    rmbSync(e);
    // A2: LMB pressed while RMB is held arrives as a button-state-change move (button 0, buttons & 1); click weapons fire
    if (e.button === 0 && (e.buttons & 1) && !handledEvents.has(e) && !state.overHud) {
      handledEvents.add(e);
      ensureAudio();
      const W = WEAPONS[state.weapon];
      if (!W.hold && W.input !== 'drag' && !state.ko) smashAt(e.clientX, e.clientY);
    }
    if (state.slash) updateSlash(e.clientX, e.clientY);
    scheduleHover();
  }
  /* Shift scope-in with a 120 ms hold-delay (A2): any other keydown while armed cancels it, keyup Shift scopes out. */
  function armShift() {
    const sc = state.scope;
    sc.shiftDown = true;
    if (sc.shiftTimer || sc.shiftWant) return;
    sc.shiftTimer = later(() => { sc.shiftTimer = 0; if (sc.shiftDown) { sc.shiftWant = true; syncScope(); } }, 120);
  }
  function isShiftKey(e) { return e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.key === 'Shift'; }
  function onKeyUp(e) {
    if (!state.active) return;
    const dir = moveDirOf(e.code, e.key);   // v1.4: released whatever the mode, so a mode switch cannot strand a key
    if (dir && state.keys[dir]) state.keys[dir] = false;
    if (!isShiftKey(e)) return;
    const sc = state.scope;
    sc.shiftDown = false; sc.shiftWant = false;
    untrack(sc.shiftTimer); sc.shiftTimer = 0;
    syncScope();
  }
  /* Hotkeys (v1.2 A12): e.code first, then e.key (Korean IME layouts put Hangul / "Process" in e.key). */
  function onKey(e) {
    if (!state.active || handledKeys.has(e)) return;
    const k = e.key, c = e.code;
    const isEsc = k === 'Escape' || c === 'Escape';
    if (!isEsc && (e.ctrlKey || e.metaKey || e.altKey)) return;
    let path = null;
    try { path = e.composedPath ? e.composedPath()[0] : e.target; } catch (err) { path = e.target; }
    const editable = isEditable(path);
    const sc = state.scope;
    let action = null, arg = null;
    if (isEsc) action = 'escape';
    else if (!editable) {
      if (isShiftKey(e)) action = 'shift';
      else {
        if (sc.shiftTimer) { untrack(sc.shiftTimer); sc.shiftTimer = 0; }   // +, _, Shift+digit never flash the 2× zoom
        let d = -1;
        if (/^Digit\d$/.test(c)) d = parseInt(c.slice(5), 10);
        else if (/^\d$/.test(k)) d = parseInt(k, 10);
        if (d >= 0) { arg = d === 0 ? 10 : d; action = (e.shiftKey && /^Digit\d$/.test(c)) ? 'moveSlot' : 'slot'; }
        else if (c === 'KeyQ' || k === 'q' || k === 'Q') action = 'prev';
        else if (c === 'KeyE' || k === 'e' || k === 'E') action = 'next';
        else if (c === 'KeyR' || k === 'r' || k === 'R') action = 'reload';
        else if (c === 'KeyZ' || k === 'z' || k === 'Z') action = 'restore';
        else if (c === 'KeyM' || k === 'm' || k === 'M') action = 'mute';
        else if (c === 'KeyH' || k === 'h' || k === 'H') action = 'combat';
        else if ((c === 'Enter' || k === 'Enter') && state.ko) action = 'restart';
        else if (modeHasAvatar() && isSpaceKey(c, k)) action = 'dash';          // v1.4 §1.2
        else if (modeHasAvatar() && moveDirOf(c, k)) { action = 'move'; arg = moveDirOf(c, k); }
      }
    }
    if (!action) return;
    handledKeys.add(e);
    try { e.preventDefault(); e.stopImmediatePropagation(); } catch (err) { /* ignore */ }
    if (action === 'move') { state.keys[arg] = true; kick(); return; }   // v1.4: a held key is simply a held key
    if (e.repeat && (action === 'shift' || action === 'mute' || action === 'combat' || action === 'restore' || action === 'prev' || action === 'next' || action === 'restart' || action === 'dash')) return;
    if (action === 'escape') {   // layered (A2): scope-out if scoped, else exit (stops holds and the KO screen)
      if (state.scoped) { scopeOff(); return; }
      stopHold(); cancelSlash(); deactivate();
    }
    else if (action === 'shift') armShift();
    else if (action === 'slot') setWeapon(state.loadout[arg - 1]);
    else if (action === 'moveSlot') moveToSlot(state.weapon, arg);
    else if (action === 'prev') stepSlot(-1);
    else if (action === 'next') stepSlot(1);
    else if (action === 'reload') reloadNow();
    else if (action === 'restore') restore();
    else if (action === 'mute') setMuted(!state.muted);
    else if (action === 'combat') cycleMode();   // v1.4 §0.5: H cycles rampage → quickdraw → survival
    else if (action === 'restart') restartFromKo();
    else if (action === 'dash') startDash();
  }
  function onWheel(e) {
    if (!state.active) return;
    let list = [];
    try { list = doc.elementsFromPoint(e.clientX, e.clientY); } catch (err) { return; }
    const k = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? viewH() : 1);
    for (const el of list) {
      if (isOurs(el)) continue;
      let n = el, guard = 0;
      while (n && n !== doc.body && n !== docEl && guard++ < 80) {
        const s = gcs(n);
        if (s) {
          const sy = /(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1;
          const sx = /(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1;
          if (sy || sx) { try { n.scrollBy(sx ? e.deltaX * k : 0, sy ? e.deltaY * k : 0); e.preventDefault(); } catch (err) { /* ignore */ } return; }
        }
        n = parentOf(n);
      }
      break;
    }
  }
  function onToggleEvt(e) {
    if (!state.active) return;
    if (isOurs(e.target)) return;
    reraiseAll();
  }
  /* A focused <iframe>/<frame> receives keydown instead of the top document, and the shield's
   * preventDefault on pointerdown stops a click from moving focus back — so take it back ourselves. */
  function blurFrame() {
    try {
      const ae = doc.activeElement, t = tagOf(ae);
      if (ae && (t === 'iframe' || t === 'frame') && typeof ae.blur === 'function') ae.blur();
    } catch (e) { /* ignore */ }
  }
  function listen(target, type, fn, opts) {
    try { target.addEventListener(type, fn, opts); state.listeners.push([target, type, fn, opts]); } catch (e) { /* ignore */ }
  }
  function bindEvents() {
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(win, t, onHoldEnd, { capture: true });
    for (const t of SWALLOW) { listen(win, t, onSwallow, { capture: true, passive: false }); listen(shield, t, onSwallow, { passive: false }); }
    listen(win, 'pointermove', onMove, { capture: true, passive: true });
    listen(win, 'keydown', onKey, { capture: true });
    listen(doc, 'keydown', onKey, { capture: true });
    listen(win, 'keyup', onKeyUp, { capture: true });          // v1.2 A2: Shift scope-out
    listen(shield, 'wheel', onWheel, { passive: false });
    listen(win, 'resize', onResize, { passive: true });
    listen(win, 'scroll', onScroll, { capture: true, passive: true });   // v1.2 A8: hostile auras follow the page
    listen(doc, 'toggle', onToggleEvt, { capture: true });
    listen(win, 'blur', onWindowBlur);
    listen(win, 'focus', onWindowFocus);                       // v1.2 A7: combat pause / resume
    listen(doc, 'visibilitychange', onVisibility);
    listen(docEl, 'pointerleave', onPointerLeave);             // v1.2 A7: pointer outside the window
    listen(docEl, 'pointerenter', onPointerEnter);
    // v1.4: a parked drone arms no frames, so the reduced-motion preference has to come to US
    try { const mq = win.matchMedia('(prefers-reduced-motion: reduce)'); if (mq && mq.addEventListener) listen(mq, 'change', onMotionPref); } catch (e) { /* ignore */ }
  }
  function unbindEvents() {
    for (const [t, type, fn, opts] of state.listeners) { try { t.removeEventListener(type, fn, opts); } catch (e) { /* ignore */ } }
    state.listeners.length = 0;
  }

// ── 99-api.js ──
  /* ===================================================================== */
  /* 15. Public API: restore / activate / deactivate / toggle / prefs         */
  /*     v1.3 §1/§5: setPower / power / stats().power removed, a stored        */
  /*     crsPower is dropped on sight; stats() gains selfRing / aimlines /      */
  /*     nearMisses / hitstop and player() gains lastHitFrom.                  */
  /* ===================================================================== */
  function clearTimers() {
    for (const id of state.timers) { try { clearT(id); } catch (e) { /* ignore */ } }
    state.timers.clear();
    state.comboTimer = 0; state.lastHitTimer = 0; state.swingTimer = 0;
    state.combatTimer = 0; state.clockTimer = 0; state.regenTimer = 0; state.toastTimer = 0; state.swapTimer = 0; state.scope.shiftTimer = 0;
    // ── v1.4: the depth refresh, the ratio refresh, the debris sweep and every per-enemy repair timer ──
    state.depthTimer = 0; state.ratioTimer = 0; state.debrisTimer = 0;
    for (const rec of state.hostiles.values()) { rec.timer = 0; rec.repairTimer = 0; }
    for (const rp of state.repairs) rp.timer = 0;
    for (const lk of state.locks) lk.timer = 0;
    if (state.reload) { state.reload.timer = 0; state.reload.magTimer = 0; state.reload = null; }
  }
  function cancelAnims() {
    for (const a of state.anims) { try { a.cancel(); } catch (e) { /* ignore */ } }
    state.anims.clear();
    state.shake = null;
    if (hudEls.aFillFor) hudEls.aFillFor = null;
    // v1.3: the looping attention pulses are cancelled above with everything else — forget their handles
    hudEls.aPulse = null; hudEls.aPulseKey = '';
    hudEls.pPulse = null; hudEls.pPulseOn = false;
  }
  function restore() {
    stopHold(true);
    cancelSlash();
    cancelCollapse();
    resetChord();
    scopeOff();
    stopReload();
    clearTimers();
    // a frame that threw must never leave kick() permanently disabled
    if (state.rafId) { try { caf(state.rafId); } catch (e) { /* ignore */ } }
    state.rafId = 0; state.animating = false; state.tickErrors = 0;
    clearCombatNodes();   // hostiles / orbs / beams / warn rings / aim lines (no kills, no score) — v1.2 A8
    clearSelf(); clearLowVignette();   // v1.3 §3: the player marker and the low-HP vignette are rebuilt by updatePlayerHud()
    clearAvatar(); clearHelp();        // ── v1.4 §1: the drone and its one-time control card ──
    cancelAnims();
    // debris + fx nodes
    for (const p of state.pieces) { try { p.node.remove(); } catch (e) { /* ignore */ } }
    state.pieces.length = 0; state.gpuSum = 0;
    if (root) {
      let leftovers = [];
      try { leftovers = root.querySelectorAll('.crs-piece, .crs-word, .crs-fading, .crs-fx-flash, .crs-fx-ring, .crs-dmg, .crs-hit, .crs-fire, .crs-rocket, .crs-slash-preview, .crs-slash-fx, .crs-scope, .crs-tracer, .crs-hostile, .crs-orb, .crs-orb-trail, .crs-orb-ring, .crs-warn, .crs-beam, .crs-beam-mark, .crs-vignette, .crs-self, .crs-selfbox, .crs-aimline, .crs-lock, .crs-repair, .crs-repair-ghost, .crs-avatar, .crs-avatar-ghost, .crs-help, .crs-pierce'); } catch (e) { leftovers = []; }
      for (const n of leftovers) { try { n.remove(); } catch (e) { /* ignore */ } }
    }
    // originals
    for (const rec of state.broken) {
      try { if (rec.mo) rec.mo.disconnect(); } catch (e) { /* ignore */ }
      if (!rec.el) continue;   // detached originals are restored too: pages that detach() and re-insert nodes would otherwise get them back hidden
      for (const s of rec.saved) {
        try { if (s.value) s.node.style.setProperty(s.prop, s.value, s.priority); else s.node.style.removeProperty(s.prop); } catch (e) { /* ignore */ }
      }
      try { rec.el.removeAttribute('data-crs-broken'); } catch (e) { /* ignore */ }
    }
    state.broken.length = 0;
    state.hp = new WeakMap(); state.tints = new WeakMap(); state.dmgAgg = new WeakMap();
    state.dmgNodes.length = 0; state.fire.length = 0;
    state.cracks = 0; state.crackInk = 0; state.combo = 0; state.lastHitAt = 0; state.hintCollapse = false; state.lastBreakMs = 0;
    state.cooldownUntil = 0; state.shots = 0; state.damageDealt = 0; state.crits = 0; state.scorch = 0; state.lastBreakPieces = 0;
    // v1.2: magazines refilled, player reset, KO / toast hidden
    initAmmo(); state.swapUntil = 0; state.lastEmptyAt = 0; state.lastShot = null;
    state.nearMisses = 0; state.nearShown.length = 0; state.hitstopUntil = 0; state.hpRatio = 1;
    // ── v1.4: locks, repairs and the ratio meter all reset with the page ──
    state.locks.length = 0; state.repairs.length = 0; state.locksBroken = 0; state.repaired = 0; state.ratio = 0;
    state.ratioDirty = true; state.ratioAt = 0; state.bossMode = false;
    state.dashUntil = 0; state.dashReadyAt = 0; state.invulUntil = 0; state.dashVx = 0; state.dashVy = 0;
    state.keys.up = state.keys.down = state.keys.left = state.keys.right = false;
    resetPlayer(); hideKo(); hideToast();
    clearCanvas();
    try { if (docEl.classList.contains('crs-swing')) docEl.classList.remove('crs-swing'); } catch (e) { /* ignore */ }
    if (hudEls.last) hudEls.last.textContent = '';
    updateHud();
    updateAmmoHud();
    updatePlayerHud();
    updateModeHud(); updateRatioHud();   // ── v1.4 ──
    refreshHover();
    armCombat();   // END: the grace restarts while active with combat on (A8)
  }
  /* setWeapon (v1.2 A5): a CHANGE that is user-driven cancels the reload and the scope and starts the 250 ms swap
   * delay; `{ silent: true }` (loadPrefs) sets no delay; the same id is a no-op. */
  function setWeapon(id, opts) {
    if (!WEAPON_IDS.includes(id)) return false;
    const silent = !!(opts && opts.silent);
    if (id === state.weapon) { if (!silent) state.weaponTouched = true; return id; }
    if (state.hold) stopHold();
    if (state.slash && id !== 'sword') cancelSlash();   // a drag in progress must not fire on release under the new weapon
    if (WEAPONS[id].hold || WEAPONS[id].input === 'drag') state.hintCollapse = false;   // the hold / drag instruction beats the lingering collapse hint
    if (!silent) {
      stopReload();
      scopeOff();
      state.swapUntil = now() + SWAP_MS;
      untrack(state.swapTimer); state.swapTimer = 0;
      if (!debug.noCooldown) state.swapTimer = later(() => { state.swapTimer = 0; updateAmmoHud(); }, SWAP_MS + 5);   // clears the 교체 중 readout
    }
    state.weapon = id;
    if (!silent) state.weaponTouched = true;
    updateHud();
    updateAmmoHud();
    syncScope();   // RMB already held when the sniper comes up → scope in
    if (!silent) safe(() => chrome.storage.sync.set({ crsWeapon: id }));
    return id;
  }
  /* Legacy alias (A12): v1 'gun' → 'pistol'; the other v1 ids are weapon ids already. */
  function setMode(m) { return setWeapon(m === 'gun' ? 'pistol' : m); }
  function setMuted(v) {
    state.muted = !!v;
    if (state.muted) stopLoop(); else if (state.hold && state.hold.id === 'flame') { ensureAudio(); startLoop(); }
    updateHud();
    safe(() => chrome.storage.sync.set({ crsMuted: state.muted }));
  }
  function loadPrefs() {
    // ── v1.4 §5: crsSeenCombatHelp is a LOCAL flag (the control card is shown once per machine, not synced) ──
    safeThen(() => chrome.storage.local.get(['crsSeenCombatHelp']), (loc) => { if (loc && loc.crsSeenCombatHelp) state.seenHelp = true; });
    safeThen(() => chrome.storage.sync.get(['crsWeapon', 'crsMode', 'crsPower', 'crsMuted', 'crsLoadout', 'crsLoadoutPreset', 'crsCombat', 'crsDebrisLifeMs', 'crsDebrisLife']), (res) => {
      if (!res || !state.active) return;
      if (!state.loadoutTouched && isPermutation(res.crsLoadout)) {   // a stored array that is not a valid permutation is ignored (A6)
        const p = res.crsLoadoutPreset;
        setLoadout(res.crsLoadout, { preset: (p === 'custom' || PRESETS[p]) ? p : 'custom', silent: true });
      }
      if (!state.weaponTouched) {   // crsWeapon wins; a legacy crsMode 'gun' maps to 'pistol'
        let w = res.crsWeapon;
        if (!WEAPON_IDS.includes(w)) w = res.crsMode === 'gun' ? 'pistol' : res.crsMode;
        if (WEAPON_IDS.includes(w)) setWeapon(w, { silent: true });   // no swap delay, no reload cancel, no scope-out (A5)
      }
      if (res.crsPower !== undefined) safe(() => chrome.storage.sync.remove('crsPower'));   // v1.3 §1: never read, dropped on sight
      if (typeof res.crsMuted === 'boolean') state.muted = res.crsMuted;
      /* ── v1.4 §0.5 ──
       * `crsMode` is the real setting now. A stored v1.3 `crsCombat: true` migrates to QUICKDRAW, not survival:
       * it came from someone who only ever played with the cursor, and quickdraw is the mode that keeps the
       * cursor as the player. (`crsMode` here is the combat mode; the legacy weapon alias is `crsWeapon`.) */
      if (!state.combatTouched) { const m = modeFromPrefs(res); if (m && m !== state.mode) setPlayMode(m, { silent: true }); }
      // §9.2: crsDebrisLifeMs is the setting; crsDebrisLife is read too so an early build's key still loads
      const dl = (typeof res.crsDebrisLifeMs === 'number') ? res.crsDebrisLifeMs : res.crsDebrisLife;
      if (typeof dl === 'number' && dl >= 0) state.debrisLifeMs = dl;
      updateHud();
      updateAmmoHud();
      updatePlayerHud();
      updateModeHud(); updateRatioHud();
    });
  }
  function sweepLeftovers() {
    let nodes = [];
    try { nodes = doc.querySelectorAll('[data-crs]'); } catch (e) { nodes = []; }
    for (const n of nodes) { lower(n); try { n.remove(); } catch (e) { /* ignore */ } }
    let brokenEls = [];
    try { brokenEls = doc.querySelectorAll('[data-crs-broken]'); } catch (e) { brokenEls = []; }
    for (const el of brokenEls) {
      for (const p of ['visibility', 'opacity', 'pointer-events']) { try { el.style.removeProperty(p); } catch (e) { /* ignore */ } }
      try { el.removeAttribute('data-crs-broken'); } catch (e) { /* ignore */ }
    }
    try { docEl.classList.remove('crs-active', 'crs-swing', 'crs-scoped'); } catch (e) { /* ignore */ }
  }
  function activate() {
    if (state.active) return;
    try {
      try { doc.dispatchEvent(new CustomEvent('crs:teardown')); } catch (e) { /* ignore */ }
      sweepLeftovers();
      state.active = true;
      state.paused = false; state.ko = false; state.scoped = false;
      state.scope.rmb = false; state.scope.shiftDown = false; state.scope.shiftWant = false; state.scope.magnified = false; state.scope.saved = null; state.scope.node = null;
      state.player.x = viewW() / 2; state.player.y = viewH() / 2; state.player.inWindow = true;
      initAmmo(); resetPlayer();
      mountHosts();
      setupCanvas(false);
      bindEvents();
      blurFrame();
      try { docEl.classList.add('crs-active'); } catch (e) { /* ignore */ }
      loadPrefs();
      updateHud();
      updateAmmoHud();
      updatePlayerHud();
      armCombat();   // synchronous with the default combat = true; loadPrefs may turn it off (A8)
      if (state.combat) toast(msg('toastCombatOn'));
      sendState(true);
    } catch (e) {
      try { deactivate(true); } catch (e2) { /* ignore */ }
      throw e;
    }
  }
  function deactivate(silent) {
    if (!state.active && !shield) return;
    const wasActive = state.active;
    cancelCollapse();
    if (state.rafId) { caf(state.rafId); state.rafId = 0; }
    if (state.moveRaf) { caf(state.moveRaf); state.moveRaf = 0; }
    if (state.resizeRaf) { caf(state.resizeRaf); state.resizeRaf = 0; }
    if (state.hudRaf) { caf(state.hudRaf); state.hudRaf = 0; }
    if (state.auraRaf) { caf(state.auraRaf); state.auraRaf = 0; }
    state.animating = false;
    try { restore(); } catch (e) { /* ignore */ }
    try { scopeOff(); } catch (e) { /* ignore */ }   // belt and braces: the body transform never outlives us
    clearTimers();   // restore() re-armed the combat grace while still active; nothing may outlive deactivate
    unbindEvents();
    for (const h of [shield, root, hud]) { if (!h) continue; lower(h); try { h.remove(); } catch (e) { /* ignore */ } }
    shield = root = canvas = ctx = targetBox = targetLabel = targetBar = targetFill = hud = hudShadow = null;
    for (const k of Object.keys(hudEls)) delete hudEls[k];
    try { docEl.classList.remove('crs-active', 'crs-swing', 'crs-scoped'); } catch (e) { /* ignore */ }
    stopLoop();
    if (audio.ctx) { const c = audio.ctx; audio.ctx = null; audio.master = null; audio.noise = null; audio.boomAt = []; safe(() => c.close()); }
    state.active = false; state.hoverEl = null; state.hoverX = -1; state.hoverY = -1; state.overHud = false;
    state.paused = false; state.ko = false; state.scope.rmb = false; state.scope.shiftDown = false; state.scope.shiftWant = false;
    state.hostiles.clear(); state.orbs.length = 0; state.beams.length = 0; state.warns.length = 0;
    state.self = null; state.lowVig = null; state.aimlines.length = 0; state.hitstopUntil = 0;
    // ── v1.4: drone, locks, repair beams, the ratio meter and the control card are all gone with the hosts ──
    state.avatar = null; state.help = null; state.ratioNodes = null;
    state.locks.length = 0; state.repairs.length = 0; state.ratio = 0;
    state.keys.up = state.keys.down = state.keys.left = state.keys.right = false;
    state.dashUntil = 0; state.invulUntil = 0; state.depthTimer = 0; state.ratioTimer = 0; state.debrisTimer = 0;
    if (wasActive) sendState(false);
  }
  function toggle() {
    if (state.active) { deactivate(); return 'off'; }
    try { activate(); return 'on'; } catch (e) { return 'off'; }
  }
  function stats() {
    const id = state.weapon;
    return {
      active: state.active, weapon: state.weapon,
      cracks: state.cracks, debris: debrisCount(), broken: state.broken.length,
      animating: state.animating, cap: CAP, combo: state.combo, holding: !!state.hold,
      shots: state.shots, damageDealt: state.damageDealt, crits: state.crits, scorch: state.scorch,
      lastBreakPieces: state.lastBreakPieces, lastError: state.lastError || null,
      pieces: state.pieces.map((p) => ({ bottom: p.oy + p.y + p.bb.maxY, resting: p.resting })),
      pieceCount: state.pieces.length,
      // v1.2
      mag: WEAPONS[id].mag == null ? null : state.ammo[id], reloading: isReloading(id), swapping: swapActive(),
      scoped: state.scoped, magnified: !!(state.scoped && state.scope.magnified),
      lastShot: state.lastShot ? Object.assign({}, state.lastShot) : null,
      combat: state.combat, hostiles: state.hostiles.size, orbs: state.orbs.length, beams: state.beams.length,
      playerHp: Math.max(0, Math.round(state.player.hp)), score: state.player.score, kills: state.player.kills,
      paused: state.paused, ko: state.ko, loadout: state.loadout.slice(), preset: state.preset,
      // v1.3 §5: the player marker, the "who is aiming at me" lines, and the graze counter
      selfRing: selfRingInfo(), aimlines: state.aimlines.length, nearMisses: state.nearMisses,
      hitstop: now() < state.hitstopUntil,
      /* ── v1.4 §5 / §10.5 ──
       * `mode` is the combat mode from here on (rampage | quickdraw | survival). The v1 alias that used to sit
       * on this key — the weapon id — is still readable as stats().weapon and as api.mode / api.setMode. */
      mode: state.mode, weaponMode: state.weapon,
      locks: state.locks.length, locksBroken: state.locksBroken,
      repairs: state.repairs.length, repaired: state.repaired,
      destroyRatio: ratioNow(), hostilesByTier: hostilesByTier(),
      avatar: state.avatar ? avatarInfo() : null, debrisLifeMs: state.debrisLifeMs,
      dashReadyAt: dashReadyWallClock()
    };
  }
  /* api.weapons(): entries in CURRENT loadout order with slot 1–10 / key "1"…"9","0" (v1.2 A1 / A6). */
  function weaponList() {
    return state.loadout.map((id, i) => {
      const W = WEAPONS[id];
      return { id, slot: i + 1, key: slotKey(i + 1), emoji: W.emoji, name: msg(W.name), kind: W.kind, damage: W.damage, cooldownMs: W.cooldownMs, radius: W.radius, hold: W.hold, input: W.input, label: weaponLabel(W),
        mag: W.mag == null ? null : W.mag, reloadMs: W.reloadMs == null ? null : W.reloadMs, spread: W.spread || null, scope: !!W.scope };
    });
  }

  /* ---- lifecycle (kept registered for the life of the page) ---- */
  try { doc.addEventListener('crs:teardown', () => { try { deactivate(true); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }
  try { win.addEventListener('pagehide', () => { try { deactivate(true); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }
  try { win.addEventListener('pageshow', () => sendState(state.active)); } catch (e) { /* ignore */ }
  // background.js asks { type: 'crash:query' } on tabs.onUpdated (hash change / pushState also report
  // status 'loading'); answering keeps the ON badge while the document is still alive.
  safe(() => chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
    try { if (m && m.type === 'crash:query') sendResponse({ active: state.active }); } catch (e) { /* ignore */ }
    return false;
  }));
  try { doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') sendState(state.active); }); } catch (e) { /* ignore */ }

  const api = {
    version: VERSION,
    debug,
    get active() { return state.active; },
    get weapon() { return state.weapon; },
    get mode() { return state.weapon; },
    get combat() { return state.combat; },
    toggle, activate, deactivate: () => deactivate(false), restore,
    setWeapon: (id) => setWeapon(id), setMode, weapons: weaponList, hpOf: hpOfPublic, smashAt, slash: slashSegment, stats,
    // v1.2
    ammo: ammoInfo, reload: reloadNow,
    loadout: () => state.loadout.slice(), setLoadout: (ids) => setLoadout(ids), applyPreset,
    scope: (on) => { if (on) scopeOn(); else scopeOff(); return state.scoped; },
    player: playerInfo, setCombat: (v) => setCombat(v),
    // ── v1.4 §0.5 / §9.2: the mode setting and the debris lifetime ──
    // (api.mode / api.setMode stay the v1 WEAPON alias; the combat mode has its own pair.)
    get combatMode() { return state.mode; },
    setCombatMode: (id) => setPlayMode(id),
    cycleMode,
    setDebrisLife: (ms) => {
      ms = +ms;
      if (!isFinite(ms) || ms < 0) return state.debrisLifeMs;
      state.debrisLifeMs = ms;
      for (const p of state.pieces) if (p.resting) p.expireAt = ms > 0 ? now() + ms + rand(-DEBRIS_JITTER, DEBRIS_JITTER) : 0;
      scheduleDebrisSweep();
      safe(() => chrome.storage.sync.set({ crsDebrisLifeMs: ms, crsDebrisLife: ms }));
      return state.debrisLifeMs;
    }
  };
  window.__crashScreen = api;
  try {
    activate();
    return 'on';
  } catch (e) {
    try { deactivate(true); } catch (e2) { /* ignore */ }
    try { delete window.__crashScreen; } catch (e3) { /* ignore */ }
    return 'off';
  }
})();
