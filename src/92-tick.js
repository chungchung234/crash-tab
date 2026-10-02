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
      busy = state.tickErrors < 120 && !!(state.pieces.length || state.orbs.length || state.beams.length || state.fxQueue.length || state.scoped);
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
      kick();
    });
  }
