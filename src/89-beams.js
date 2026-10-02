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
