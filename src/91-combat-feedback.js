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
    const want = state.active && state.combat && !state.ko && state.player.alive && ratio < 0.3;
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
  function selfShouldShow() { return !!(state.active && state.combat && !state.ko && root); }
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
    try { rec.label.textContent = '🎯 ' + rec.label.textContent; } catch (e) { /* ignore */ }
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
      try { a.rec.label.textContent = a.rec.label.textContent.replace(/^🎯\s*/, ''); } catch (e) { /* ignore */ }
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
    if (!state.active || !state.combat || !p.alive || state.ko || !(n > 0)) return;
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
    const p = state.player, ratio = clamp(p.hp / p.max, 0, 1);
    const h = hudEls.player;
    if (h) {
      try {
        h.classList.toggle('on', !!state.combat);
        if (hudEls.fallback) h.style.display = state.combat ? 'block' : 'none';
        hudEls.pFill.style.width = (ratio * 100).toFixed(1) + '%';
        hudEls.pFill.style.background = fillColor(ratio);
        hudEls.pHp.textContent = msg('labelHealth') + ' ' + Math.max(0, Math.round(p.hp)) + ' / ' + p.max;
        hudEls.pStats.textContent = msg('labelScore') + ' ' + p.score + ' · ' + msg('labelKills') + ' ' + p.kills + ' · ' + msg('labelTime') + ' ' + Math.floor(combatElapsed() / 1000) + msg('unitSec') + ' · ' + msg('labelEnemies') + ' ' + state.hostiles.size;
        setBarPulse(state.combat && p.alive && ratio < 0.3);
      } catch (e) { /* ignore */ }
    }
    state.hpRatio = ratio;
    syncSelf();
    lowVignette(ratio);
  }
