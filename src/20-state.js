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
    // ── SPEC-combat §A: three modes (rampage · arcade · survival) replace the combat boolean ──
    mode: 'rampage', lastCombatMode: 'survival',
    // §1 drone avatar (survival only): keys held, physics, dash window, afterimages
    avatar: null, keys: { up: false, down: false, left: false, right: false },
    dashUntil: 0, dashReadyAt: 0, invulUntil: 0, help: null, seenHelp: false,
    seenIntro: false,   // SPEC-launch §3: 첫 활성화 안내를 봤는가 (crsSeenIntro, local, 기기마다 한 번)
    // §2 Virtua-Cop lock-ons, §3 repair beams + destruction-ratio meter
    locks: [], lockSeq: 0, locksBroken: 0,
    repairs: [], repaired: 0, ratio: 0, ratioTimer: 0, ratioNodes: null,
    // §9 debris lifetime (0 = keep until the cap evicts, as before)
    debrisLifeMs: 6000, debrisTimer: 0,
    /* SPEC-material §4: debris is nailed to the DOCUMENT by default — a piece keeps the place it fell on the
     * page and scrolls out of view with everything else. 'viewport' is the old sheet-of-glass behaviour, kept
     * as an option. scrollX/scrollY are the last reading of the page scroll, taken by readScroll(). */
    debrisAnchor: 'document', scrollX: 0, scrollY: 0,
    // §10 depth tiers, §4 boss stages, §3.2 ratio freshness
    depthTimer: 0, bossMode: false, ratioDirty: true, ratioAt: 0, ratioBrokenN: -1
  };
  /* §A: every v1.2/v1.3 call site reads `state.combat` as "are enemies live?". It stays exactly that, derived
   * from the mode, so none of that code had to change. The setter keeps the legacy boolean writable: true picks
   * the last combat mode the player actually used (survival until they pick otherwise), false is rampage. */
  Object.defineProperty(state, 'combat', {
    configurable: true,
    enumerable: false,
    get() { return state.mode !== 'rampage'; },
    set(v) { state.mode = v ? (state.lastCombatMode || 'survival') : 'rampage'; }
  });
  /* ── SPEC-weapon-art §8.1: the stored `sword` id ──────────────────────────
   * The weapon was renamed sword → katana. Anything already in chrome.storage.sync (crsWeapon, and every
   * entry of crsLoadout) still says `sword`, and an unmigrated loadout is not a permutation of WEAPON_IDS
   * any more, so it would be silently DISCARDED and the player would lose their slot order on upgrade.
   * Both read paths in src/99-api.js go through these two, and nothing writes `sword` ever again. */
  const WEAPON_ID_ALIASES = { sword: 'katana' };
  function migrateWeaponId(id) {
    return (typeof id === 'string' && WEAPON_ID_ALIASES[id]) || id;
  }
  function migrateWeaponIds(ids) {
    return Array.isArray(ids) ? ids.map(migrateWeaponId) : ids;
  }

  const handledEvents = new WeakSet();
  const handledKeys = new WeakSet();

  // DOM we own
  let shield = null, root = null, canvas = null, ctx = null, targetBox = null, targetLabel = null, targetBar = null, targetFill = null, hud = null, hudShadow = null;
  const hudEls = {};
  let canvasCssW = 0, canvasCssH = 0, canvasSX = 1, canvasSY = 1;

  function track(timerId) { state.timers.add(timerId); return timerId; }
  /* laterRaw() takes a delay that is ALREADY in real milliseconds — a remaining time computed against a
   * deadline that scaleMs() has already shortened (reload progress, repair beams, the combat grace). Passing
   * one of those through later() would scale it a second time. Everything else uses later(). */
  function laterRaw(fn, ms) {
    const id = setT(() => { state.timers.delete(id); try { fn(); } catch (e) { state.lastError = String((e && e.stack) || e); } }, ms);   // deferred paths surface in stats().lastError too
    return track(id);
  }
  /* SPEC-test-speed §3: the single choke point for the product's 76 timers. */
  function later(fn, ms) { return laterRaw(fn, scaleMs(ms)); }
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

  /* ===================================================================== */
  /* 1.5 생애 주기 등록부 — restore() 와 deactivate()                        */
  /* ===================================================================== */
  /* 이 둘은 "치워라" 라는 **한 가지 일**이고, 뒤에 실리는 모듈들은 전부 "내 것도 치워
   * 줘" 를 말한다. 예전에는 그것을 **바인딩 재할당**으로 말했다 — 번들이 하나의 클로저라
   * 뒤 모듈이 앞 모듈의 함수를 감쌀 수 있기 때문이다. restore 는 8겹, deactivate 는
   * 5겹까지 쌓였고 두 가지가 나빴다.
   *   1. 누가 바깥인지를 modules.json 의 순서가 정했다 — 파일 하나를 옮기면 실행 순서가
   *      조용히 뒤집힌다. 아무도 그걸 적어 두지 않았다.
   *   2. 중간에서 하나가 던지면 바깥쪽 겹이 통째로 돌지 않았다. 이 둘은 **무흔적 계약**의
   *      핵심이므로, 그건 곧 페이지에 흔적이 남는다는 뜻이다.
   *
   * 래퍼가 아니라 콜백 목록이 맞다. 단계는 둘이고, 그 둘이 예전 체인의 안/밖을 그대로
   * 옮긴 것이다 (재할당 체인에 추적을 박아 실측한 순서와 같다):
   *
   *   onRestore / onDeactivate       — 본체 **앞**. **적재 역순**으로 돈다. 나중에 올라온
   *       층이 먼저 내려간다 — 생성의 역순 해체다. 예전 체인에서 가장 바깥 래퍼(= 가장
   *       늦게 실린 모듈)의 선작업이 먼저 돌던 것과 같은 순서다.
   *   afterRestore / afterDeactivate — 본체 **뒤**. **적재 순서**로 돈다. 가장 안쪽 래퍼의
   *       후작업이 먼저 돌던 것과 같다. 본체가 던져도 돈다(finally) — src/96.2 의 통계
   *       표본이 try/finally 로 그렇게 하고 있었고, 이제 전부가 그렇다.
   *
   * 콜백 하나가 던져도 나머지는 전부 돈다. 던진 것은 state.lastError 에 남는다.
   * 래퍼 체인은 이걸 못 했다 — 그게 1번보다 조용한 고장이었다.
   *
   * 본체는 src/99-api.js 의 restoreCore() / deactivateCore() 다 (선언이므로 호이스팅된다.
   * src/22-perf.js 가 src/92-tick.js 의 tickFrame 을 집는 것과 같은 장치다). */
  const LIFE_HOOKS = { restore: [], restoreAfter: [], deactivate: [], deactivateAfter: [], probe: null, ran: [] };
  function hookAdd(phase, tag, fn) { LIFE_HOOKS[phase].push({ tag, fn }); return fn; }
  function onRestore(tag, fn) { return hookAdd('restore', tag, fn); }
  function afterRestore(tag, fn) { return hookAdd('restoreAfter', tag, fn); }
  function onDeactivate(tag, fn) { return hookAdd('deactivate', tag, fn); }
  function afterDeactivate(tag, fn) { return hookAdd('deactivateAfter', tag, fn); }
  /* down=true 는 적재 역순(해체), false 는 적재 순서(재무장). 하나가 던져도 나머지가 돈다. */
  function hookRun(phase, down, arg) {
    const list = LIFE_HOOKS[phase];
    const n = list.length;
    for (let k = 0; k < n; k++) {
      const h = list[down ? n - 1 - k : k];
      try { h.fn(arg); } catch (e) { state.lastError = String((e && e.stack) || e); }
    }
  }
  function restore() {
    hookRun('restore', true);
    try { return restoreCore(); }
    finally { hookRun('restoreAfter', false); }
  }
  function deactivate(silent) {
    hookRun('deactivate', true, silent);
    try { return deactivateCore(silent); }
    finally { hookRun('deactivateAfter', false, silent); }
  }
  /* ── 단언이 보는 창 ───────────────────────────────────────────────────────
   * hooks(): 각 단계를 **실행 순서대로** 이름으로 돌려준다. 등록이 하나라도 빠지면 길이가
   * 어긋나고, 순서가 뒤집히면 이름 차례가 어긋난다 — 옮기다 흘린 것을 단언이 직접 잡는다. */
  debug.hooks = () => ({
    restore: LIFE_HOOKS.restore.map((h) => h.tag).reverse(),
    restoreAfter: LIFE_HOOKS.restoreAfter.map((h) => h.tag),
    deactivate: LIFE_HOOKS.deactivate.map((h) => h.tag).reverse(),
    deactivateAfter: LIFE_HOOKS.deactivateAfter.map((h) => h.tag)
  });
  /* 던지는 콜백 하나가 나머지를 막지 않는다는 것도 단언이 **직접** 보게 한다: 한 단계에
   * 표식 · 던지는 것 · 표식 셋을 끼우고, 실제로 돈 것을 순서대로 돌려준다. 떼어낼 수 있으므로
   * 등록 수 단언과 서로 방해하지 않는다. */
  debug.hookProbeOn = (phase) => {
    debug.hookProbeOff();
    if (!Array.isArray(LIFE_HOOKS[phase])) return null;
    hookAdd(phase, 'probe-1', () => { LIFE_HOOKS.ran.push('one'); });
    hookAdd(phase, 'probe-throw', () => { LIFE_HOOKS.ran.push('throw'); throw new Error('crs hook probe'); });
    hookAdd(phase, 'probe-2', () => { LIFE_HOOKS.ran.push('two'); });
    LIFE_HOOKS.probe = { phase, n: 3 };
    return debug.hooks();
  };
  debug.hookProbeRan = () => LIFE_HOOKS.ran.slice();
  debug.hookProbeOff = () => {
    const p = LIFE_HOOKS.probe;
    if (p) LIFE_HOOKS[p.phase].splice(LIFE_HOOKS[p.phase].length - p.n, p.n);
    LIFE_HOOKS.probe = null;
    LIFE_HOOKS.ran = [];
    return debug.hooks();
  };
