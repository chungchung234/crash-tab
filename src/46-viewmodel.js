// ── v1.5 §2: first-person weapon viewmodel — draw / holster / idle / recoil / swing / reload / dry-fire / ADS ──
  /* ===================================================================== */
  /* 6b. Viewmodel (v1.5 §2)                                                */
  /*                                                                        */
  /* One glass-root layer, `div.crs-viewmodel`, holding the same SVG the HUD */
  /* uses (§1) mirrored and tilted so the muzzle points into the screen. All */
  /* motion is WAAPI on the CONTAINER's transform; the inner holder owns the */
  /* static mirror, so an animation never has to re-state it. Every          */
  /* animation goes through trackAnim(), and the one infinite animation (the */
  /* idle bob) is cancelled explicitly by clearViewmodel() — restore() and   */
  /* deactivate() must leave zero live animations behind.                    */
  /*                                                                        */
  /* content.css declares the layer's geometry with !important but leaves    */
  /* `transform` and `opacity` plain: content.css is injected at USER origin */
  /* and a user-origin !important outranks Web Animations, so marking either */
  /* of those would silently freeze the whole viewmodel.                     */
  /* ===================================================================== */
  /* The layer is 200 × 100 (§2); the picture is drawn WIDER than the layer and allowed to overflow it, because
   * a weapon that only fills the middle band of its own 120 × 60 viewBox reads as a distant toy at 1:1. */
  const VM_W = 268;
  const vm = {
    node: null, holder: null, mag: null, shot: null,
    weapon: null, want: null, phase: 'hidden', phaseUntil: 0, idle: null, seq: 0, timer: 0, hidden: false, lastFireAt: 0
  };
  const VM_BASE = 'translate(0px, 0px) rotate(0deg)';
  const VM_SETTLE = 30;   // ms between a one-shot's last frame and the idle bob picking the weapon back up

  function vmEnabled() { return !!(wpnOpts.viewmodel && state.active && root); }
  /* §2.1: reduced motion keeps the cue but halves it. 0.45 rather than a bare 0.5 so the reduced amplitude is
   * provably BELOW half of the full-motion one even when a sampler catches the full-motion peak a few ms late. */
  function vmAmp() { return reducedMotion() ? 0.45 : 1; }
  /* stats().viewmodel — 'idle' | 'draw' | 'fire' | 'reload' | 'hidden' (§4).
   * The label is derived from a DEADLINE, not from a timer having fired: every one-shot records when it is due
   * to end, so a dropped timer (restore() clears every tracked timer at once) can never strand the viewmodel in
   * 'draw' or 'reload' forever. Finding the deadline passed also COMPLETES the transition — a caller that polls
   * for 'idle' must never be told the weapon is at rest while it is still frozen mid-animation. */
  function viewmodelPhase() {
    if (!vm.node || !vm.node.isConnected) return 'hidden';
    if (vm.hidden) return 'hidden';
    if (vm.phase !== 'idle' && now() >= vm.phaseUntil) vmIdle();
    return vm.phase;
  }
  function vmWantVisible() { return !state.scoped && !state.ko; }   // ADS has the scope circle; KO has the overlay

  /* The idle bob and the one-shots coexist deliberately: WAAPI gives the LAST-started animation on a property
   * priority, so a one-shot simply covers the bob while it runs and hands the property back — with the bob's
   * phase intact — the moment it ends. Cancelling the bob instead would restart its sine from zero and make a
   * weapon visibly jump after every shot. Only the previous ONE-SHOT is cancelled here. */
  function vmCancelShot() {
    const a = vm.shot;
    vm.shot = null;
    if (a) { try { a.cancel(); } catch (e) { /* ignore */ } state.anims.delete(a); }
  }
  function vmCancel() {
    vmCancelShot();
    if (vm.idle) { try { vm.idle.cancel(); } catch (e) { /* ignore */ } state.anims.delete(vm.idle); vm.idle = null; }
    if (vm.node) cancelAnimsOf(vm.node);
  }
  function vmDropMag() {
    const m = vm.mag;
    vm.mag = null;
    if (!m) return;
    try { cancelAnimsOf(m); m.remove(); } catch (e) { /* ignore */ }
  }
  function clearViewmodel() {
    untrack(vm.timer); vm.timer = 0;
    vm.seq++;
    vmCancel();
    vmDropMag();
    const n = vm.node;
    vm.node = null; vm.holder = null; vm.weapon = null; vm.want = null; vm.shot = null; vm.phase = 'hidden'; vm.phaseUntil = 0; vm.hidden = false; vm.lastFireAt = 0;
    if (n) { try { n.remove(); } catch (e) { /* ignore */ } }
    if (hudEls.ammo) { try { hudEls.ammo.style.bottom = ''; } catch (e) { /* ignore */ } }
  }
  /* The ammo panel sits at bottom: 24px (v1.3 §2.1) and the viewmodel fills exactly that corner, so the panel
   * moves up — only while the layer actually exists, so `viewmodel: false` restores the v1.3 layout byte for byte. */
  function vmLiftAmmo(on) {
    if (!hudEls.ammo) return;
    try { hudEls.ammo.style.bottom = on ? '118px' : ''; } catch (e) { /* ignore */ }
  }
  function buildViewmodel() {
    const n = mk('div', 'crs-viewmodel');
    const holder = mk('div', 'crs-viewmodel-art');
    n.append(holder);
    n.style.transform = VM_BASE;
    n.style.opacity = '1';
    root.append(n);
    vm.node = n; vm.holder = holder; vm.weapon = null; vm.want = null; vm.phase = 'idle'; vm.phaseUntil = 0; vm.hidden = false;
    vmLiftAmmo(true);
  }
  function vmSetArt(id) {
    if (!vm.holder) return;
    vm.weapon = id;
    try {
      while (vm.holder.firstChild) vm.holder.removeChild(vm.holder.firstChild);
      vm.holder.append(weaponArt(id, VM_W));
    } catch (e) { /* ignore */ }
  }
  function vmIdle() {
    if (!vm.node || vm.hidden) return;
    vm.phase = 'idle'; vm.phaseUntil = 0;
    if (vm.idle) {
      const st = vm.idle.playState;
      if (st === 'running') return;
      if (st === 'paused') { try { vm.idle.play(); } catch (e) { /* ignore */ } return; }   // resumed where it left off
      try { vm.idle.cancel(); } catch (e) { /* ignore */ }
      state.anims.delete(vm.idle); vm.idle = null;
    }
    if (reducedMotion()) { try { vm.node.style.transform = VM_BASE; } catch (e) { /* ignore */ } return; }
    try {
      vm.idle = trackAnim(vm.node.animate([
        { transform: 'translate(0px, -3px) rotate(1.2deg)' },
        { transform: 'translate(0px, 3px) rotate(-1.2deg)' },
        { transform: 'translate(0px, -3px) rotate(1.2deg)' }
      ], { duration: 2600, iterations: Infinity, easing: 'ease-in-out' }));
    } catch (e) { vm.idle = null; }
  }
  /* A one-shot runs ON TOP of the bob (see vmCancelShot) and ends with fill: 'none', so the base pose is never
   * left filled in. The phase is restored by a tracked timer AND, independently, by viewmodelPhase()'s
   * deadline — the animation's own `finish` event is not usable, because it never arrives when the animation
   * is cancelled by the next one. */
  function vmPlay(frames, ms, easing, phase) {
    if (!vm.node || vm.hidden) return 0;
    const seq = ++vm.seq;
    vmCancelShot();
    /* The bob is PAUSED, not cancelled, for the length of the one-shot: the weapon then comes back to exactly
     * the pose it left (the bob's sine does not keep advancing underneath), and a 200 ms recoil cannot smuggle
     * in 5 px of unrelated drift. */
    if (vm.idle && vm.idle.playState === 'running') { try { vm.idle.pause(); } catch (e) { /* ignore */ } }
    /* VM_SETTLE: the bob is resumed a beat AFTER the one-shot's last frame, never on the same tick. A caller
     * that polls for 'idle' then always samples a weapon the bob is driving again, instead of catching the
     * single frame where the finished one-shot still pins it to the base pose. */
    const dur = Math.max(1, ms), tail = dur + VM_SETTLE;
    vm.phase = phase; vm.phaseUntil = now() + tail;
    try { vm.shot = trackAnim(vm.node.animate(frames, { duration: dur, easing: easing || 'ease-out', fill: 'none' })); } catch (e) { vm.shot = null; }
    untrack(vm.timer);
    vm.timer = later(() => { vm.timer = 0; if (vm.seq === seq && vm.node) { vm.shot = null; vmIdle(); } }, tail);
    return seq;
  }
  /* 꺼내기 (§2.1): the swap reads as holster → draw inside ONE swapMs window, because swapMs is also exactly how
   * long firing is blocked — a draw that outlasted the block would leave the player shooting an invisible gun.
   * With nothing in hand yet (first mount) the whole window is the draw. */
  function vmDraw(id, ms) {
    if (!vm.node) return;
    vm.want = id;
    const amp = vmAmp();
    const down = 'translate(0px, ' + px(90 * amp) + ') rotate(' + (-18 * amp).toFixed(2) + 'deg)';
    const had = !!vm.weapon;
    const total = Math.max(60, ms || swapMsOf(id));
    const f = had ? 0.45 : 0;   // holster for the first 45 % of the swap, draw for the rest (nothing in hand: all draw)
    /* ONE animation with fill: 'none' for the whole swap. An earlier version ran the holster as its own
     * fill: 'forwards' animation and relied on a timer to start the draw — and a timer that was cleared out
     * from under it (restore() clears every tracked timer) left the weapon filled off the bottom of the
     * screen for good. Nothing here depends on a timer for correctness any more; the art swap below is the
     * only timed part, and vmSync() repairs that on the next HUD update. */
    const frames = f > 0
      ? [{ transform: VM_BASE, easing: 'cubic-bezier(.4,0,1,1)', offset: 0 },
         { transform: down, easing: 'cubic-bezier(.35,0,.2,1)', offset: f },
         { transform: VM_BASE, offset: 1 }]
      : [{ transform: down, easing: 'cubic-bezier(.35,0,.2,1)', offset: 0 },
         { transform: VM_BASE, offset: 1 }];
    const seq = vmPlay(frames, total, 'linear', 'draw');
    if (!seq) { vmSetArt(id); return; }   // hidden: no animation to run, just put the new weapon in hand
    if (f > 0) later(() => { if (vm.seq === seq) vmSetArt(id); }, total * f);
    else vmSetArt(id);
  }
  /* 사격 반동 / 근접 휘두르기 (§2.1). Melee weapons swing across the screen instead of kicking back, so a hammer
   * blow and a pistol shot can never be confused at a glance. */
  function vmFire(id) {
    if (!vm.node || vm.hidden) return;
    const busy = viewmodelPhase();   // not vm.phase: an expired one-shot must not keep swallowing shots
    if (busy === 'draw' || busy === 'reload') return;
    const t = now();
    if (t - vm.lastFireAt < 60) return;   // sustained fire: one kick per 60 ms, not one per 50 ms tick
    vm.lastFireAt = t;
    const W = WEAPONS[id || state.weapon];
    const amp = vmAmp();
    if (isMelee(id)) {
      const a = 55 * amp, d = 70 * amp;
      vmPlay([
        { transform: VM_BASE },
        { transform: 'rotate(' + (-a).toFixed(1) + 'deg) translateX(' + px(-d) + ')', offset: 0.45 },
        { transform: VM_BASE }
      ], 220, 'ease-in-out', 'fire');
      return;
    }
    const r = (W && W.recoil > 0 ? W.recoil : 1) * amp;
    vmPlay([
      { transform: VM_BASE },
      { transform: 'translate(' + px(10 * r) + ', ' + px(-14 * r) + ') rotate(' + (-7 * r).toFixed(1) + 'deg)', offset: 0.35 },
      { transform: VM_BASE }
    ], 200, 'ease-out', 'fire');
  }
  /* 재장전 (§2.1): tilt down for the first fifth, hold while the magazine falls and a fresh one rises, come back
   * up for the last fifth — three segments stretched across whatever reloadMs the weapon has. */
  function vmReload(ms) {
    if (!vm.node || vm.hidden) return;
    const total = Math.max(120, ms || 600), amp = vmAmp();
    const tilt = 'translate(0px, ' + px(14 * amp) + ') rotate(' + (45 * amp).toFixed(1) + 'deg)';
    const seq = vmPlay([
      { transform: VM_BASE, offset: 0 },
      { transform: tilt, offset: 0.2 },
      { transform: tilt, offset: 0.8 },
      { transform: VM_BASE, offset: 1 }
    ], total, 'ease-in-out', 'reload');
    if (!seq || reducedMotion()) return;
    vmDropMag();
    const m = mk('div', 'crs-viewmodel-mag');
    m.style.transform = 'translate(0px, 0px)';
    vm.node.append(m);
    vm.mag = m;
    try {
      trackAnim(m.animate([
        { transform: 'translate(0px, 0px)', opacity: 1, offset: 0 },
        { transform: 'translate(0px, 0px)', opacity: 1, offset: 0.2 },
        { transform: 'translate(-6px, 70px)', opacity: 0, offset: 0.5 },
        { transform: 'translate(0px, 70px)', opacity: 0, offset: 0.62 },
        { transform: 'translate(0px, 0px)', opacity: 1, offset: 0.85 },
        { transform: 'translate(0px, 0px)', opacity: 1, offset: 1 }
      ], { duration: total, easing: 'ease-in-out', fill: 'none' }));
    } catch (e) { /* ignore */ }
    later(() => { if (vm.mag === m) vmDropMag(); }, total + 60);
  }
  /* 빈 탄창 격발 (§2.1): two short sideways shakes, no phase change — the weapon is still "idle", it just refused. */
  function vmDry() {
    if (!vm.node || vm.hidden) return;
    const busy = viewmodelPhase();
    if (busy === 'draw' || busy === 'reload') return;
    const d = 6 * vmAmp();
    vmPlay([
      { transform: 'translate(0px, 0px) rotate(0deg)' },
      { transform: 'translate(' + px(-d) + ', 0px) rotate(0deg)' },
      { transform: 'translate(' + px(d) + ', 0px) rotate(0deg)' },
      { transform: 'translate(' + px(-d * 0.6) + ', 0px) rotate(0deg)' },
      { transform: 'translate(0px, 0px) rotate(0deg)' }
    ], 120, 'linear', busy === 'fire' ? 'fire' : 'idle');
  }
  /* 조준 / KO (§2.1): fade out, and while hidden every other animation is skipped so nothing runs unseen. */
  function vmVisibility() {
    if (!vm.node) return;
    const want = vmWantVisible(), hidden = !want;
    if (hidden === vm.hidden) {
      // Self-heal: the inline opacity is the resting value the fade lands on, so it must always agree with
      // the state even if an earlier fade was cancelled midway.
      try { const o = hidden ? '0' : '1'; if (vm.node.style.opacity !== o) vm.node.style.opacity = o; } catch (e) { /* ignore */ }
      return;
    }
    vm.hidden = hidden;
    const ms = state.ko ? 150 : 120;
    untrack(vm.timer); vm.timer = 0;
    vmCancel();        // drops the bob AND any one-shot, and forgets both handles so vmIdle() can rebuild
    vmDropMag();
    vm.phase = hidden ? 'hidden' : 'idle'; vm.phaseUntil = 0;
    try {
      vm.node.style.transform = VM_BASE;
      vm.node.style.opacity = hidden ? '0' : '1';
      trackAnim(vm.node.animate([{ opacity: hidden ? 1 : 0 }, { opacity: hidden ? 0 : 1 }], { duration: ms, easing: 'ease-out', fill: 'none' }));
    } catch (e) { /* ignore */ }
    if (!hidden) vmIdle();
  }
  /* The one entry point: creates / destroys the layer per the option, keeps the art on the weapon in hand and
   * fires the draw whenever setWeapon() opened a swap window. Called from updateHud() (wrapped below), so a
   * weapon change, a restore and a KO all reach it without src/45-hud.js or src/99-api.js knowing about it. */
  function vmSync() {
    if (!vmEnabled()) { if (vm.node) clearViewmodel(); return; }
    if (!vm.node || !vm.node.isConnected) { clearViewmodel(); buildViewmodel(); }
    vmLiftAmmo(true);
    vmVisibility();
    /* `vm.want` is the weapon the swap is FOR; `vm.weapon` is the art actually on screen, which the draw only
     * swaps at its midpoint. Keeping them apart means a reload or a shot that lands mid-draw (emptying a
     * magazine during the swap window, say) is not undone by the next updateHud() restarting the draw. */
    const id = state.weapon;
    if (vm.want !== id) {
      vm.want = id;
      const left = state.swapUntil - now();
      if (left > 30 && !vm.hidden && viewmodelPhase() !== 'reload') vmDraw(id, Math.min(left, swapMsOf(id)));
      else { vmSetArt(id); if (!vm.hidden && !vm.timer) vmIdle(); }
    } else if (vm.weapon !== id && viewmodelPhase() !== 'draw') vmSetArt(id);   // a pre-empted draw: put the right art up
    if (!vm.hidden && !vm.idle && viewmodelPhase() === 'idle') vmIdle();   // self-heal: the bob is always running at rest
  }
  function ensureViewmodel() { try { vmSync(); } catch (e) { /* ignore */ } }

  /* ── v1.5: options (weaponArt / viewmodel) ────────────────────────────────
   * There is no options page in this build yet (spec B2), so the two switches
   * live in chrome.storage.sync beside crsWeapon / crsMuted and are reachable
   * through api.setOption(). Read once per activation, from this module, so
   * loadPrefs() in src/99-api.js stays untouched. */
  function applyWeaponOpts() {
    try { syncWeaponArt(); } catch (e) { /* ignore */ }
    ensureViewmodel();
  }
  function loadWeaponOpts() {
    if (wpnOpts.loaded) return;
    wpnOpts.loaded = true;
    safeThen(() => chrome.storage.sync.get(['crsWeaponArt', 'crsViewmodel']), (res) => {
      if (!res || !state.active) return;
      if (WEAPON_ART_MODES.includes(res.crsWeaponArt)) wpnOpts.weaponArt = res.crsWeaponArt;
      if (typeof res.crsViewmodel === 'boolean') wpnOpts.viewmodel = res.crsViewmodel;
      applyWeaponOpts();
    });
  }
  function setWeaponOption(name, value) {
    if (name === 'weaponArt') {
      if (!WEAPON_ART_MODES.includes(value)) return false;
      wpnOpts.weaponArt = value;
      safe(() => chrome.storage.sync.set({ crsWeaponArt: value }));
    } else if (name === 'viewmodel') {
      wpnOpts.viewmodel = !!value;
      safe(() => chrome.storage.sync.set({ crsViewmodel: wpnOpts.viewmodel }));
    } else return false;
    applyWeaponOpts();
    return true;
  }
  function weaponOptions() { return { weaponArt: wpnOpts.weaponArt, viewmodel: wpnOpts.viewmodel }; }
  /* debug.vmInfo(): the viewmodel's own bookkeeping, for diagnosing a viewmodel that is on screen but not
   * moving. A function, so api.debug's flag-copying helpers skip it. */
  debug.vmInfo = () => ({
    phase: vm.phase, reported: viewmodelPhase(), left: Math.round(vm.phaseUntil - now()),
    weapon: vm.weapon, want: vm.want, hidden: vm.hidden, connected: !!(vm.node && vm.node.isConnected),
    idle: !!vm.idle, idleState: vm.idle ? vm.idle.playState : null, shot: vm.shot ? vm.shot.playState : null,
    anims: vm.node ? vm.node.getAnimations().length : -1, reduced: reducedMotion(),
    opacity: vm.node ? vm.node.style.opacity : null, enabled: vmEnabled(), opts: weaponOptions()
  });

  /* ── v1.5: the two HUD hooks ──────────────────────────────────────────────
   * src/45-hud.js belongs to no single v1.5 workstream, so instead of editing
   * updateHud() this wraps its binding: the generated bundle is one function
   * scope, and a function declaration's binding is writable. The art refresh is
   * signature-gated because updateHud() also runs once per frame on hot paths. */
  const updateHudBase = updateHud;
  updateHud = function () {
    updateHudBase();
    try {
      const sig = state.weapon + '|' + state.loadout.join(',') + '|' + wpnOpts.weaponArt;
      if (hudEls.artSig !== sig) { hudEls.artSig = sig; syncWeaponArt(); }
    } catch (e) { /* ignore */ }
    ensureViewmodel();
    loadWeaponOpts();
  };
