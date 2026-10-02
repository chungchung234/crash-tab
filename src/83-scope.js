// ── scope: ADS reticle build/show/hide, 2x body magnification, sway/recoil step (v1.3 §3.1: ADS dims the player ring) ──
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
    placeSelf();   // v1.3 §3.1: ADS drops the player ring to 20 % so it cannot cover the reticle
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
    if (state.active) { placeSelf(); scheduleAura(); sfx('scopeOut'); refreshHover(); }   // A3: rects are back to 1× — re-place the auras
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
