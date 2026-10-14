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
      busy = state.tickErrors < 120 && !!(state.pieces.length || state.movedList.length || state.orbs.length || state.beams.length || state.fxQueue.length || state.scoped || state.avatar || state.locks.length || state.repairs.length);
    }
    if (busy && state.active) state.rafId = raf(tick); else state.animating = false;
  }
  function tickFrame(t) {
    let dt = clamp((t - state.lastT) / 1000, 0, 0.05);
    state.lastT = t;
    const W = viewW(), H = viewH();
    // SPEC-material §4: one reading per frame feeds every piece's anchor-frame → screen conversion below
    if (state.pieces.length) readScroll(true);
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
      /* SPEC-material §5: a piece falls as the thing it came off. gMul / hdrag / bounce default to the old
       * single profile (1 / 0.6 / 0.32 — `panel`), so an element whose material was never resolved behaves
       * exactly as it did before. `flutter` is the lateral sway of something light: it moves the piece
       * sideways without touching vx, so the resting test (|vx| and |vr| near zero) is unchanged. */
      if (!p.grounded) p.vy += GRAVITY * (p.gMul || 1) * dt;
      p.vx *= Math.pow(p.hdrag != null ? p.hdrag : 0.6, dt);
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.flutter && !p.grounded) p.x += Math.sin(((t - p.bornAt) / p.flutter.period) * Math.PI * 2) * p.flutter.amp * dt;
      const newBottom = p.oy + p.y + p.bb.maxY;
      const pl = p.ox + p.x + p.bb.minX, pr = p.ox + p.x + p.bb.maxX, pw = pr - pl;
      /* SPEC-material §4: the floor is the document position the viewport bottom had when THIS piece
       * spawned (p.sy + H); a viewport-anchored piece has p.sy = 0, so it is the live bottom as before. */
      let support = p.sy + H;
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
        if (p.vy > 30) { p.vy = -p.vy * (p.bounce != null ? p.bounce : 0.32); p.vx *= 0.75; p.vr *= 0.45; p.grounded = false; }
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
      const wallL = p.sx, wallR = p.sx + W;   // §4: the walls are that spawn moment's viewport edges
      const left = p.ox + p.x + p.bb.minX;
      if (left < wallL) { p.x -= (left - wallL); p.vx = -p.vx * 0.5; }
      const right = p.ox + p.x + p.bb.maxX;
      if (right > wallR) { p.x -= (right - wallR); p.vx = -p.vx * 0.5; }
      if (t - p.bornAt > 6000 && Math.abs(p.vy) < 60 && Math.abs(p.vx) < 20) { restPiece(p); resting.push(p); continue; }
      applyTransform(p);
    }
    /* SPEC-combat §E2: the displaced PAGE ELEMENTS are a second body set on this very loop — no second
     * RAF. They are integrated after the pieces so a frame's collision pass sees every body's final
     * position for that frame, and before the fx queue so a damage number spawned by an impact is drawn
     * in the same frame it happened. */
    if (state.movedList.length) { if (stepMoved(t, dt)) busy = true; }
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
    /* SPEC-material §3: while the loop is already awake, every decal re-reads its element's rect, so a mark
     * also follows an element that is being animated, repaired or reflowed — not just one that scrolled.
     * It deliberately does NOT set `busy`: decals alone never keep a frame loop alive. */
    if (decalCount()) { syncDecals(); if (decalBusy()) busy = true; }
    return busy;
  }
  function onResize() {
    if (state.resizeRaf) return;
    state.resizeRaf = raf(() => {
      state.resizeRaf = 0;
      if (!state.active) return;
      setupCanvas();      // SPEC-material §3: every decal re-reads its element's new rect
      applyZoom();
      const W = viewW(), H = viewH();
      readScroll(true);   // SPEC-material §4: a resize moves the page under the rubble as well
      for (const p of state.pieces) {
        // §4: walls and floor in the piece's own anchor frame (p.sx = p.sy = 0 for a viewport-anchored one)
        const wallL = p.sx, wallR = p.sx + W, floor = p.sy + H;
        const left = p.ox + p.x + p.bb.minX, right = p.ox + p.x + p.bb.maxX;
        if (right > wallR) p.x -= (right - wallR);
        if (left < wallL) p.x -= (left - wallL);
        if (p.oy + p.y + p.bb.maxY > floor) { p.y = floor - p.oy - p.bb.maxY; }
        else if (p.resting && p.oy + p.y + p.bb.maxY < floor - 1) { wakePiece(p); }
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
