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
    // v1.2: combat (A7–A10)
    combat: true, combatTouched: false, combatTimer: 0, clockTimer: 0, regenTimer: 0, toastTimer: 0, auraRaf: 0,
    hostiles: new Map(), orbs: [], beams: [], warns: [], paused: false, ko: false, graceUntil: 0,
    // v1.3: player marker / aim lines / near-miss / hitstop (§3)
    self: null, aimlines: [], nearMisses: 0, nearShown: [], hitstopUntil: 0, lowVig: null, hpRatio: 1,
    player: { x: 0, y: 0, hp: 100, max: 100, score: 0, kills: 0, alive: true, startedAt: 0, pausedAt: 0, pausedTotal: 0, lastDamageAt: 0, lastRegenAt: 0, inWindow: true, lastHitFrom: null }
  };
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
