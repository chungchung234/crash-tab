// ── §A: the three modes (rampage · arcade · survival) and everything that switches between them ──
  /* v1.3 shipped ONE boolean, `combat`. v1.4 split it three ways, and SPEC-combat §A now RETIRES the Virtua-Cop
   * mode outright ("버추어 캅 개념은 빼줘. 커서가 캐릭터 / wasd로 조종하는 캐릭터 두 개만"). What is left is one
   * axis — what the player is driving — and the two combat modes differ in CONTROL ONLY:
   *
   *   rampage   mouse only                      no enemies at all; v1.2's pure demolition tool
   *   arcade    the CURSOR is the character     one mouse aims AND dodges
   *   survival  mouse aims, WASD flies a drone  the drone is the character, dodging is its own input
   *
   * §A1: failure conditions and enemy behaviour are IDENTICAL across arcade and survival — 100 HP, KO at 0,
   * enemies attack and repair. Arcade pays for doing two jobs with one hand with a handicap on the enemy side:
   * attack interval ×1.35 and projectile speed ×0.8. Without it the original complaint ("피하면 조준이 풀린다")
   * comes straight back.
   *
   * `state.combat` survives as a derived getter (20-state.js), so the whole v1.2/v1.3 combat body still reads
   * "are enemies live?" from one place and needed no edit. The per-mode differences are asked here, by name. */

  debug.difficulty = 'normal';   // 'easy' ×1.5 | 'normal' ×1 | 'hard' ×0.7 repair interval (§3.1)
  const MODES = ['rampage', 'arcade', 'survival'];
  const MODE_NAME = { rampage: 'modeRampage', arcade: 'modeArcade', survival: 'modeSurvival' };
  const MODE_DESC = { rampage: 'modeRampageDesc', arcade: 'modeArcadeDesc', survival: 'modeSurvivalDesc' };
  /* §A1 the arcade handicap. These two numbers ARE the mode difference — everything else is identical. */
  const ARCADE_ATTACK_MUL = 1.35;      // enemies attack 35 % less often
  const ARCADE_PROJECTILE_MUL = 0.8;   // and what they throw flies at 80 % speed
  const ORB_SPEED = 520;               // px/s, the survival baseline (v1.2 §5); arcade scales it

  /* §1.2 drone avatar */
  const AV_R = 17;                   // 34 px body
  const AV_RING_R = 23;              // 46 px health ring (the v1.3 ring, re-anchored)
  const AV_ACCEL = 2800;             // px/s²
  const AV_MAX_SPEED = 420;          // px/s
  const AV_FRICTION = 0.86;          // per frame, applied at 60 fps and time-corrected
  const AV_MARGIN = 20;              // viewport inset the drone is clamped to
  const AV_HIT_R = 18;               // enemy hit radius against the drone
  const DASH_PX = 180, DASH_MS = 160, DASH_CD = 1500, DASH_IFRAME = 220, DASH_GHOSTS = 3;
  /* §A2 the lock-on — an ATTACK now, not a mode. The frame always sits on the player (cursor or drone). */
  const LOCK_MS = 3000;              // full lock; §10.2 shortens a `front` enemy to 2400
  const LOCK_MS_FRONT = 2400;
  const LOCK_P1 = 1 / 3;             // 추적 → 고정  (1.0 s of 3.0 s)
  const LOCK_P2 = 11 / 15;           // 고정 → 임박  (2.2 s of 3.0 s)
  const LOCK_FOLLOW = 1 / 3;         // the frame stops following the player at 1.0 s — that freeze IS the dodge window
  /* SPEC-combat §A2 names the stage boundaries (1.0 s / 2.2 s) and the BEEPS (0 s / 1.2 s / 2.4 s) as two
   * separate lists, and they do not line up. Reading chosen: they really are separate — the brackets change
   * at 1.0/2.2 and a three-beep countdown runs underneath at 0/1.2/2.4, which puts the last warning a steady
   * 0.6 s before the shot. (The alternative — beeps welded to the stage changes, as v1.4 shipped them — would
   * make the "0초·1.2초·2.4초" sentence say nothing the previous one had not already said.) */
  const LOCK_BEEPS = [0, 0.4, 0.8];  // fractions of the lock duration: 0 s / 1.2 s / 2.4 s of 3.0 s
  const LOCK_GAP0 = 70, LOCK_GAP1 = 24, LOCK_GAP2 = 4;   // bracket size / thickness (20 / 3 px) are in content.css
  const LOCK_MAX = 3;                // at most three concurrent locks (§A2)
  const LOCK_RECOVER_MS = 1500;      // a broken lock cannot re-arm for this long
  const LOCK_HIT_R = 56;             // how far from the frozen centre still counts as a hit
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

  /* ---- what exists in which mode (§A / §A1) ----
   * Only ONE of these separates arcade from survival — the avatar. §A1 is explicit that everything else about
   * the fight (health, KO, enemy attacks, projectiles, repair, the meter) is the same in both; what differs is
   * how the player moves, and the two handicap numbers below that pay for it. */
  function modeHasEnemies() { return state.mode !== 'rampage'; }
  function modeHasAvatar() { return state.mode === 'survival'; }
  function modeHasHealth() { return state.mode !== 'rampage'; }        // §A1: 체력 100, 0이면 KO — in BOTH combat modes
  function modeHasProjectiles() { return state.mode !== 'rampage'; }   // §A1: 적의 행동은 동일하다
  function modeHasRepair() { return state.mode !== 'rampage'; }
  function modeHasRatio() { return state.mode !== 'rampage'; }
  /* §A1 the arcade handicap: the enemy side is slowed down, the player side is untouched. Asked for by name at
   * the two places it can be felt — when the next attack is scheduled, and when a projectile is launched. */
  function modeAttackMul() { return state.mode === 'arcade' ? ARCADE_ATTACK_MUL : 1; }
  function modeProjectileMul() { return state.mode === 'arcade' ? ARCADE_PROJECTILE_MUL : 1; }
  function orbSpeed() { return ORB_SPEED * modeProjectileMul(); }
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
   * arcade, a health bar where there is no health).
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
  /* Legacy boolean (api.setCombat / the v1.3 e2e): true means the mode the player last fought in (survival
   * until they pick otherwise), false is rampage. A STORED crsCombat migrates differently — §A sends it to
   * ARCADE, because that pref came from someone who only ever played with the cursor. */
  function setCombat(v, opts) {
    setPlayMode(v ? (state.lastCombatMode || 'survival') : 'rampage', opts);
    return state.combat;
  }
  function persistMode() {
    safe(() => chrome.storage.sync.set({ crsMode: state.mode, crsCombat: state.mode !== 'rampage' }));
  }
  /* loadPrefs (99-api.js) hands us whatever was stored; crsMode wins, then the two §A migrations.
   * MODE_ALIASES is the one place the retired mode id is still SPOKEN: the string is gone from the product,
   * but it is still sitting in the sync storage of everyone who ran v1.4, so it still has to be READ. */
  const MODE_ALIASES = { quickdraw: 'arcade' };   // §A: 구 `quickdraw` 저장값 → `arcade`
  function migrateModeId(id) { return (typeof id === 'string' && MODE_ALIASES[id]) || id; }
  function modeFromPrefs(res) {
    if (!res) return null;
    const m = migrateModeId(res.crsMode);
    if (MODES.includes(m)) return m;
    if (typeof res.crsCombat === 'boolean') return res.crsCombat ? 'arcade' : 'rampage';   // §A: crsCombat:true → arcade
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
