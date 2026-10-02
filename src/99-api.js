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
    for (const rec of state.hostiles.values()) rec.timer = 0;
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
    cancelAnims();
    // debris + fx nodes
    for (const p of state.pieces) { try { p.node.remove(); } catch (e) { /* ignore */ } }
    state.pieces.length = 0; state.gpuSum = 0;
    if (root) {
      let leftovers = [];
      try { leftovers = root.querySelectorAll('.crs-piece, .crs-word, .crs-fading, .crs-fx-flash, .crs-fx-ring, .crs-dmg, .crs-hit, .crs-fire, .crs-rocket, .crs-slash-preview, .crs-slash-fx, .crs-scope, .crs-tracer, .crs-hostile, .crs-orb, .crs-orb-trail, .crs-orb-ring, .crs-warn, .crs-beam, .crs-beam-mark, .crs-vignette, .crs-self, .crs-selfbox, .crs-aimline'); } catch (e) { leftovers = []; }
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
    resetPlayer(); hideKo(); hideToast();
    clearCanvas();
    try { if (docEl.classList.contains('crs-swing')) docEl.classList.remove('crs-swing'); } catch (e) { /* ignore */ }
    if (hudEls.last) hudEls.last.textContent = '';
    updateHud();
    updateAmmoHud();
    updatePlayerHud();
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
    safeThen(() => chrome.storage.sync.get(['crsWeapon', 'crsMode', 'crsPower', 'crsMuted', 'crsLoadout', 'crsLoadoutPreset', 'crsCombat']), (res) => {
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
      if (!state.combatTouched && typeof res.crsCombat === 'boolean' && res.crsCombat !== state.combat) setCombat(res.crsCombat, { silent: true });
      updateHud();
      updateAmmoHud();
      updatePlayerHud();
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
    if (wasActive) sendState(false);
  }
  function toggle() {
    if (state.active) { deactivate(); return 'off'; }
    try { activate(); return 'on'; } catch (e) { return 'off'; }
  }
  function stats() {
    const id = state.weapon;
    return {
      active: state.active, weapon: state.weapon, mode: state.weapon,
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
      hitstop: now() < state.hitstopUntil
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
    player: playerInfo, setCombat: (v) => setCombat(v)
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
