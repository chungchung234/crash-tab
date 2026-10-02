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
  function attackInterval(rec) { return TIER_BASE[rec.tier] * Math.max(0.5, 1 - combatElapsed() / 120000); }
  function resetPlayer() {
    const p = state.player;
    p.hp = p.max; p.score = 0; p.kills = 0; p.alive = true; p.startedAt = now(); p.pausedAt = state.paused ? now() : 0; p.pausedTotal = 0; p.lastDamageAt = 0; p.lastRegenAt = 0; p.lastHitFrom = null;
  }
  function playerInfo() {
    const p = state.player;
    return { hp: Math.max(0, Math.round(p.hp)), max: p.max, score: p.score, kills: p.kills, alive: p.alive, elapsedMs: Math.round(combatElapsed()), x: p.x, y: p.y,
      lastHitFrom: p.lastHitFrom ? { x: p.lastHitFrom.x, y: p.lastHitFrom.y } : null };   // v1.3 §5: where the last hit came from
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
    label.textContent = '👿 ' + tagOf(el).toUpperCase();
    aura.append(label);
    root.append(aura);
    const rec = { el, tier, area, aura, label, phase: 'idle', timer: 0, nodes: [], pulse: null, beam: null, aim: null, offscreenSince: 0, nextAttackAt: 0, markedAt: now() };
    state.hostiles.set(el, rec);
    hpOf(el);   // page-space max HP cached now (scope never runs the picker)
    placeAura(rec);
    setAuraPulse(rec, 900);
    scheduleAttack(rec, attackInterval(rec));
    scheduleAura();
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
  }
  /* true only when one of the three attacks actually started (debug.forceAttack reports the tier off this). */
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
    if (!forced && (debug.noAttacks || !state.player.inWindow || !state.player.alive)) { scheduleAttack(rec, attackInterval(rec)); return false; }
    if (forced) { untrack(rec.timer); rec.timer = 0; clearPhase(rec); }
    scheduleAura();
    if (rec.tier === 'shooter') attackShooter(rec, r, forced);
    else if (rec.tier === 'charger') attackCharger(rec, r);
    else attackLaser(rec, r);
    return true;
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
    for (const o of state.orbs.slice()) { if (Math.hypot(o.x - x, o.y - y) <= 18) { popOrb(o); return true; } }
    return false;
  }
  function interceptOrbsWithin(x, y, R) {
    let n = 0;
    for (const o of state.orbs.slice()) { if (Math.hypot(o.x - x, o.y - y) <= R) { popOrb(o); n++; } }
    return n;
  }
  function interceptOrbsAlong(x1, y1, x2, y2, R) {
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
  function setCombat(v, opts) {
    const silent = !!(opts && opts.silent);
    const on = !!v, changed = on !== state.combat;
    state.combat = on;
    if (!silent) state.combatTouched = true;
    if (!on) {
      untrack(state.combatTimer); state.combatTimer = 0;
      untrack(state.clockTimer); state.clockTimer = 0;
      untrack(state.regenTimer); state.regenTimer = 0;
      clearCombatNodes();   // auras / orbs / beams / warn rings go, the score stays
      if (silent) hideToast(false); else if (changed) toast(msg('toastCombatOff'));
    } else {
      if (changed || !state.combatTimer) armCombat();
      if (!silent && changed) toast(msg('toastCombatOn'));
      if (state.player.hp < state.player.max) startRegen();
    }
    if (!silent) safe(() => chrome.storage.sync.set({ crsCombat: on }));
    updateHud(); updatePlayerHud();
    return on;
  }
  /* Pause (A7): blur / hidden → cancel every combat timer, drop in-flight orbs / beams / rings, freeze the clock. */
  function pauseCombat() {
    if (state.paused) return;
    state.paused = true;
    state.player.pausedAt = now();
    untrack(state.combatTimer); state.combatTimer = 0;
    untrack(state.clockTimer); state.clockTimer = 0;
    untrack(state.regenTimer); state.regenTimer = 0;
    for (const rec of state.hostiles.values()) { untrack(rec.timer); rec.timer = 0; clearPhase(rec); }
    clearOrbs(); clearBeams(); clearWarns(); clearAimLines();
  }
  function resumeCombat() {
    if (!state.paused) return;
    state.paused = false;
    state.player.pausedTotal += now() - state.player.pausedAt;
    if (!state.active || !state.combat) return;
    state.combatTimer = later(selectTick, Math.max(1000, state.graceUntil - now()));
    untrack(state.clockTimer); state.clockTimer = later(clockTick, 1000);
    for (const rec of state.hostiles.values()) scheduleAttack(rec, Math.max(1000, attackInterval(rec)));
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
  debug.forceAttack = (el) => {   // same eligibility as the picker; works under noAttacks, null while paused / KO
    if (!state.active || !state.combat || state.paused || state.ko || !state.player.alive) return null;
    const existing = state.hostiles.get(el) || null;
    let rec = existing;
    if (!rec) { const area = hostileArea(el); if (area == null) return null; rec = markHostile(el, area); }
    if (!rec) return null;
    const ran = hostileAttack(rec, true);
    if (!ran && !existing && state.hostiles.get(el) === rec) releaseHostile(el);   // a no-op must not consume a hostile slot
    return ran ? rec.tier : null;
  };
