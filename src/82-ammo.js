  /* ===================================================================== */
  /* 12b. v1.2: ammo / reload, scope + sniper, loadouts, combat, toasts         */
  /* ===================================================================== */
  function slotKey(slot) { return slot === 10 ? '0' : String(slot); }
  function slotOf(id) { return state.loadout.indexOf(id) + 1; }

  /* --- ammo (A5): state.ammo[id] rounds, reserve ∞, later()-chained reload, swap delay --- */
  function initAmmo() { state.pendingReload = null; for (const id of WEAPON_IDS) state.ammo[id] = WEAPONS[id].mag == null ? null : WEAPONS[id].mag; }
  function isReloading(id) { return !!(state.reload && state.reload.id === id); }
  function swapActive() { return !debug.noCooldown && now() < state.swapUntil; }
  function emptyClick() {   // at most once per 300 ms
    const t = now();
    if (t - state.lastEmptyAt >= 300) { state.lastEmptyAt = t; sfx('empty'); }
  }
  function spend(id) {
    const W = WEAPONS[id];
    if (!W || W.mag == null) return true;
    if (isReloading(id)) { emptyClick(); return false; }
    if (swapActive()) return false;
    if (!(state.ammo[id] > 0)) { emptyClick(); if (!state.reload) startReload(id, false); return false; }   // dead click: no shot to protect
    if (!debug.infiniteAmmo) state.ammo[id]--;
    if (state.ammo[id] <= 0) state.pendingReload = id;   // armed now, started by flushPendingReload() right after the shot
    return true;
  }
  /* The magazine-emptying round still auto-reloads inside the same action (no dead click), but only AFTER it was
   * fired: startReload() scopes out, and a scoped sniper shot must stay exact (A4). */
  function flushPendingReload() {
    const id = state.pendingReload;
    if (!id) return;
    state.pendingReload = null;
    startReload(id, false);
  }
  function startReload(id, manual) {
    const W = WEAPONS[id];
    if (!state.active || !W || W.mag == null || state.reload) return false;
    if (state.ammo[id] >= W.mag) return false;
    scopeOff();
    const ms = debug.fastReload ? 30 : W.reloadMs;
    const rec = { id, startedAt: now(), ms, timer: 0, magTimer: 0 };
    state.reload = rec;
    sfx('magout');
    rec.magTimer = later(() => { rec.magTimer = 0; if (state.reload === rec) sfx('magin'); }, Math.round(ms * 0.8));
    rec.timer = later(() => {
      rec.timer = 0;
      if (state.reload !== rec) return;
      state.reload = null;
      untrack(rec.magTimer); rec.magTimer = 0;
      state.ammo[id] = W.mag;
      updateAmmoHud(); scheduleHud();
      syncScope();   // A2: the chord may still be held — the scope comes back the moment the magazine is full
    }, ms);
    if (ms >= 500) { try { const b = weaponBtn(id); if (b) trackAnim(b.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: ms, easing: 'linear' })); } catch (e) { /* ignore */ } }
    if (manual) toast(msg('toastReload') + '…');
    updateAmmoHud();
    return true;
  }
  function stopReload() {
    const r = state.reload;
    if (!r) return;
    state.reload = null;
    untrack(r.timer); untrack(r.magTimer);
    updateAmmoHud();
  }
  function reloadNow() { return startReload(state.weapon, true); }
  function ammoInfo() {
    const id = state.weapon, W = WEAPONS[id], r = state.reload;
    const size = W.mag == null ? null : W.mag;
    const reloading = isReloading(id);
    return { mag: size == null ? null : state.ammo[id], size, reloading, reloadProgress: reloading ? clamp((now() - r.startedAt) / r.ms, 0, 1) : 0, swapping: swapActive() };
  }
  function updateAmmoHud() {
    const a = hudEls.ammo;
    if (!a) return;
    try {
      const id = state.weapon, W = WEAPONS[id], size = W.mag;
      hudEls.aEmoji.textContent = W.emoji;
      const big = hudEls.aBig;
      let promptOn = false;
      if (swapActive()) { big.textContent = msg('labelSwapping'); hudEls.aDim.textContent = ''; big.classList.remove('low'); }
      else if (size == null) { big.textContent = '∞'; hudEls.aDim.textContent = ''; big.classList.remove('low'); }
      else {
        const mag = state.ammo[id];
        big.textContent = String(mag); hudEls.aDim.textContent = ' / ∞';
        big.classList.toggle('low', mag <= 0.2 * size);
        promptOn = mag <= 0;
      }
      hudEls.aPrompt.classList.toggle('on', promptOn);
      if (hudEls.fallback) hudEls.aPrompt.style.display = promptOn ? 'block' : 'none';
      if (promptOn) {
        if (!hudEls.aBlink || hudEls.aBlink.playState !== 'running') hudEls.aBlink = trackAnim(hudEls.aPrompt.animate([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], { duration: 800, iterations: Infinity }));
      } else if (hudEls.aBlink) { try { hudEls.aBlink.cancel(); } catch (e) { /* ignore */ } hudEls.aBlink = null; }
      const r = state.reload, reloading = !!(r && r.id === id);
      hudEls.aBar.classList.toggle('on', reloading);
      if (hudEls.fallback) hudEls.aBar.style.display = reloading ? 'block' : 'none';
      if (reloading) {
        if (hudEls.aFillFor !== r) {
          hudEls.aFillFor = r;
          cancelAnimsOf(hudEls.aFill);
          const start = clamp((now() - r.startedAt) / r.ms, 0, 1);
          trackAnim(hudEls.aFill.animate([{ width: (start * 100).toFixed(1) + '%' }, { width: '100%' }], { duration: Math.max(1, r.ms - (now() - r.startedAt)), easing: 'linear', fill: 'forwards' }));
        }
      } else if (hudEls.aFillFor) { hudEls.aFillFor = null; cancelAnimsOf(hudEls.aFill); }
    } catch (e) { /* ignore */ }
  }

  /* --- scope (A2–A4): visual layer in the glass root + 2× body transform saved/restored exactly --- */
  function scopeMag() { return (state.scoped && state.scope.magnified) ? 2 : 1; }
  function scopeRadius() { return 0.42 * Math.min(viewW(), viewH()); }
  function buildScopeNode() {
    const n = mk('div', 'crs-scope');
    const ret = mk('div', 'crs-scope-reticle');
    const R = scopeRadius();
    const lines = [];
    const line = (l, t, w, h) => { const d = mk('div', 'crs-scope-line'); d.style.left = px(l); d.style.top = px(t); d.style.width = px(w); d.style.height = px(h); lines.push(d); ret.append(d); };
    line(-R, -0.5, R - 10, 1); line(10, -0.5, R - 10, 1); line(-0.5, -R, 1, R - 10); line(-0.5, 10, 1, R - 10);   // 10 px centre gap
    for (const k of [-2, -1, 1, 2]) {   // mil-dots every R/4 along each axis
      const d = k * R / 4;
      const h = mk('div', 'crs-scope-dot'); h.style.left = px(d - 2); h.style.top = px(-2); ret.append(h);
      const v = mk('div', 'crs-scope-dot'); v.style.left = px(-2); v.style.top = px(d - 2); ret.append(v);
    }
    const ring = mk('div', 'crs-scope-ring');
    ring.style.left = px(-(R - 6)); ring.style.top = px(-(R - 6)); ring.style.width = px(2 * (R - 6)); ring.style.height = px(2 * (R - 6));
    ret.append(ring);
    n.append(ret);
    state.scope.reticle = ret; state.scope.lines = lines;
    return n;
  }
  function scopeOn() {
    if (state.scoped || !state.active || !root || state.ko || state.weapon !== 'sniper') return false;
    const sc = state.scope;
    state.scoped = true;
    try { docEl.classList.add('crs-scoped'); } catch (e) { /* ignore */ }   // ADS: the page cursor is hidden so it cannot cover the reticle
    try { if (hud) hud.classList.add('crs-scoped'); } catch (e) { /* ignore */ }   // and the weapon panel fades out of the circle
    const x = state.hoverX >= 0 ? state.hoverX : viewW() / 2, y = state.hoverY >= 0 ? state.hoverY : viewH() / 2;
    sc.cx = x; sc.cy = y; sc.startedAt = now(); sc.recoilAt = 0; sc.hot = false;
    sc.node = buildScopeNode();
    root.append(sc.node);
    sc.magnified = false; sc.saved = null;
    try {   // skip the transform when body is missing / already transformed / html { zoom } / reduced motion (A3)
      const body = doc.body;
      let z = 1;
      try { z = parseFloat(gcsRaw(docEl).zoom); if (!isFinite(z)) z = 1; } catch (e) { z = 1; }
      const bs = body ? gcs(body) : null;
      const bb = body ? rectOf(body) : null;
      if (body && bs && bb && bs.transform === 'none' && z === 1 && !reducedMotion()) {
        sc.saved = ['transform', 'transform-origin'].map((p) => ({ prop: p, value: body.style.getPropertyValue(p), priority: body.style.getPropertyPriority(p) }));
        imp(body, 'transform', 'scale(2)');
        // transform-origin is body-local: subtract the (untransformed, scrolled) body rect so the point under the pointer stays put
        imp(body, 'transform-origin', px(x - bb.left) + ' ' + px(y - bb.top));
        sc.magnified = true;
      }
    } catch (e) { sc.magnified = false; }
    scopeStep(now());
    scheduleAura();   // A3: every page rect just changed under the 2× transform — hostile auras must follow
    sfx('scopeIn');
    kick();
    refreshHover();
    return true;
  }
  function scopeOff() {
    if (!state.scoped) return false;
    const sc = state.scope;
    state.scoped = false;
    try { docEl.classList.remove('crs-scoped'); } catch (e) { /* ignore */ }
    try { if (hud) hud.classList.remove('crs-scoped'); } catch (e) { /* ignore */ }
    if (sc.node) { try { sc.node.remove(); } catch (e) { /* ignore */ } sc.node = null; sc.reticle = null; sc.lines = []; }
    if (sc.magnified) {
      try {
        const body = doc.body;
        if (body && sc.saved) for (const s of sc.saved) { if (s.value) body.style.setProperty(s.prop, s.value, s.priority); else body.style.removeProperty(s.prop); }
      } catch (e) { /* ignore */ }
    }
    sc.magnified = false; sc.saved = null;
    if (state.active) { scheduleAura(); sfx('scopeOut'); refreshHover(); }   // A3: rects are back to 1× — re-place the auras
    return true;
  }
  /* RMB (chord model) OR Shift (after its 120 ms delay) want the scope while the sniper is selected. */
  function syncScope() {
    const sc = state.scope;
    const want = state.active && !state.ko && state.weapon === 'sniper' && (sc.rmb || sc.shiftWant);
    if (want && !state.scoped) scopeOn();
    else if (!want && state.scoped) scopeOff();
  }
  function scopeStep(t) {   // circle follow + sway + recoil, inside tick() (A4 / A8)
    const sc = state.scope;
    if (!sc.node || !sc.reticle) return;
    const R = scopeRadius();
    const tx = state.hoverX >= 0 ? state.hoverX : viewW() / 2, ty = state.hoverY >= 0 ? state.hoverY : viewH() / 2;
    const ph = ((t - sc.startedAt) / 2200) * Math.PI * 2;
    let sx = 3 * Math.sin(ph), sy = 3 * Math.sin(ph * 0.8 + 1.2);
    if (reducedMotion()) { sx = 0; sy = 0; }
    let ry = 0;
    if (sc.recoilAt) { const p = clamp((t - sc.recoilAt) / 250, 0, 1); ry = -40 * (1 - p) * (1 - p); if (p >= 1) sc.recoilAt = 0; }
    const cx = tx + sx, cy = ty + sy + ry;
    sc.cx = cx; sc.cy = cy;
    sc.node.style.background = 'radial-gradient(circle at ' + px(cx) + ' ' + px(cy) + ', transparent ' + px(R) + ', rgba(0,0,0,.92) ' + px(R + 2) + ')';
    sc.reticle.style.transform = 'translate(' + px(cx) + ', ' + px(cy) + ')';
    const hot = !!(state.hoverEl && state.hostiles.has(state.hoverEl));
    if (hot !== sc.hot) { sc.hot = hot; try { sc.node.classList.toggle('crs-scope-hot', hot); } catch (e) { /* ignore */ } }
  }

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
