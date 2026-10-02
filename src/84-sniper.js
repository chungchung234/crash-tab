// ── sniper: tracer fx + hitscan fire with headshot crit ──
  /* --- sniper (A4): hitscan with ±25 px unscoped spread, tracer, bolt, headshots --- */
  function tracerFx(x, y) {
    if (!root) return;
    const sx = viewW() - 80, sy = viewH() - 40;
    const n = mk('div', 'crs-tracer');
    const len = Math.hypot(x - sx, y - sy), a = Math.atan2(y - sy, x - sx);
    n.style.left = px(sx); n.style.top = px(sy); n.style.width = px(len); n.style.height = '2px';
    n.style.transformOrigin = '0 50%'; n.style.transform = 'translateY(-1px) rotate(' + a.toFixed(4) + 'rad)';
    root.append(n);
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
    try { const an = trackAnim(n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out', fill: 'forwards' })); an.addEventListener('finish', kill); } catch (e) { /* ignore */ }
    later(kill, 400);
  }
  function fireSniper(x, y) {
    state.shots++;
    const scoped = state.scoped, S = WEAPONS.sniper.spread;
    let ix = x, iy = y;
    if (!scoped && !debug.noSpread) { ix += rand(-S, S); iy += rand(-S, S); }
    ix = clamp(ix, 0, viewW()); iy = clamp(iy, 0, viewH());
    state.lastShot = { x: ix, y: iy, offsetX: ix - x, offsetY: iy - y, scoped };   // recorded hit or miss, before interception
    if (scoped) state.scope.recoilAt = now();
    if (audio.ctx && !state.muted) { later(() => sfx('clack'), 350); later(() => sfx('clack'), 500); }   // bolt action
    tracerFx(ix, iy);
    if (interceptOrb(ix, iy)) { sfx('sniper'); return null; }
    const el = pickTarget(ix, iy);
    const crit = el ? rollSniperCrit(scoped) : false;
    const dmg = rollDamage(WEAPONS.sniper.damage, crit);
    sfx('sniper', { crit });
    flash(ix, iy, 'gun', { size: 90, dur: 160 }); shake('gun', { amp: crit ? 8 : 6 });
    drawCrack(ix, iy, 'gun', { rays: [6, 9], len: [30, 70], ink: 0.5 });
    spawnChips(ix, iy, randInt(4, 7));
    if (el) applyHit(el, dmg, 'gun', ix, iy, { crit, headshot: true });
    return el;
  }
