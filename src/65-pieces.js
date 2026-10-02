  /* ===================================================================== */
  /* 10. Pieces, physics state, eviction                                      */
  /* ===================================================================== */
  function velocityFor(mode, ix, iy, cx, cy, opts) {
    const dx = cx - ix, dy = cy - iy, dist = Math.hypot(dx, dy);
    const s = Math.sign(dx) || (Math.random() < 0.5 ? -1 : 1);
    let vx, vy, vr;
    if (mode === 'bomb') {
      const R = (opts && opts.radius) || BOMB_RADIUS;   // rocket passes 360 (A7)
      const sp = clamp(900 * (1 - dist / R) + 250, 250, 1100);
      const ux = dist ? dx / dist : 0, uy = dist ? dy / dist : -1;
      vx = ux * sp; vy = uy * sp - 300; vr = rand(-540, 540);
    } else {
      vx = s * rand(140, 300) + rand(-60, 60);
      vy = -rand(300, 680) * (1 - 0.35 * Math.min(dist, 300) / 300);
      vr = s * rand(120, 320);
      if (mode === 'gun') { vx *= 0.5; vy *= 0.5; vr *= 0.5; }
      if (mode === 'collapse' && opts && opts.away) { vx += opts.away.x * 180; vy += opts.away.y * 180; }
    }
    if (opts && opts.word) { const k = 1 + 0.6 * (1 - Math.min(dist, 200) / 200); vx *= k; vy *= k; }
    return { vx, vy, vr, dist };
  }
  function debrisCount() {
    let n = 0;
    for (const p of state.pieces) if (!p.chip) n++;
    return n;
  }
  function addPiece(node, p) {
    const t = now();
    const dpr = Math.min(win.devicePixelRatio || 1, 2);
    p.node = node; p.x = 0; p.y = 0; p.rot = 0; p.resting = false; p.grounded = false;
    p.bornAt = t; if (p.launchAt == null) p.launchAt = t;
    p.tilt = rand(-12, 12);
    p.gpu = p.w * p.h * dpr * dpr;
    p.big = p.w * p.h > 200000;
    // clip the AABB to the viewport at spawn (A12)
    const W = viewW(), H = viewH();
    p.bb = { minX: Math.max(p.bb.minX, -p.ox), minY: Math.max(p.bb.minY, -p.oy), maxX: Math.min(p.bb.maxX, W - p.ox), maxY: Math.min(p.bb.maxY, H - p.oy) };
    if (p.bb.maxX < p.bb.minX) p.bb.maxX = p.bb.minX; if (p.bb.maxY < p.bb.minY) p.bb.maxY = p.bb.minY;
    node.style.willChange = p.big ? 'auto' : 'transform';
    node.style.contain = 'layout paint';
    node.style.transform = 'translate(0px, 0px) rotate(0deg)';
    const area = (p.bb.maxX - p.bb.minX) * (p.bb.maxY - p.bb.minY);
    const shadow = (!p.word && area > 2500) ? 'drop-shadow(0 3px 4px rgba(0,0,0,.35))' : '';
    if (shadow) node.style.filter = shadow;
    if (!node.isConnected) root.append(node);
    try {
      trackAnim(node.animate([{ filter: (shadow ? shadow + ' ' : '') + 'brightness(1.7)' }, { filter: (shadow ? shadow + ' ' : '') + 'brightness(1)' }], { duration: 90, easing: 'ease-out' }));
    } catch (e) { /* ignore */ }
    state.pieces.push(p); state.gpuSum += p.gpu;
    return p;
  }
  function applyTransform(p) {
    p.node.style.transform = 'translate(' + p.x.toFixed(2) + 'px, ' + p.y.toFixed(2) + 'px) rotate(' + p.rot.toFixed(2) + 'deg)';
  }
  function restPiece(p) {
    p.resting = true; p.grounded = true; p.vx = 0; p.vy = 0; p.vr = 0;
    p.rot = Math.round(p.rot / 180) * 180 + p.tilt;
    applyTransform(p);
    p.node.style.willChange = 'auto'; p.node.style.contain = 'strict';
  }
  function wakePiece(p) {
    if (!p.resting) return;
    p.resting = false; p.grounded = false; p.vy = 0;
    p.node.style.willChange = p.big ? 'auto' : 'transform'; p.node.style.contain = 'layout paint';
  }
  function evictPieces(victims, silent) {
    if (!victims.length) return;
    const evictedBoxes = [];
    for (const p of victims) {
      const i = state.pieces.indexOf(p); if (i >= 0) state.pieces.splice(i, 1);
      state.gpuSum -= p.gpu;
      evictedBoxes.push({ l: p.ox + p.x + p.bb.minX, r: p.ox + p.x + p.bb.maxX, top: p.oy + p.y + p.bb.minY });
      const node = p.node;
      try { node.classList.remove('crs-debris', 'crs-chip'); node.classList.add('crs-fading'); } catch (e) { /* ignore */ }
      if (silent) { try { node.remove(); } catch (e) { /* ignore */ } continue; }
      let done = false;
      const kill = () => { if (done) return; done = true; try { node.remove(); } catch (e) { /* ignore */ } };
      try {
        const a = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, easing: 'ease-in', fill: 'forwards' });
        trackAnim(a); a.addEventListener('finish', kill); a.addEventListener('cancel', kill);
      } catch (e) { /* ignore */ }
      later(kill, 500);
    }
    // wake resting pieces that were supported by an evicted piece (A1)
    for (const q of state.pieces) {
      if (!q.resting) continue;
      const ql = q.ox + q.x + q.bb.minX, qr = q.ox + q.x + q.bb.maxX, qb = q.oy + q.y + q.bb.maxY;
      for (const b of evictedBoxes) {
        const ov = Math.min(qr, b.r) - Math.max(ql, b.l);
        if (ov >= 0.4 * Math.min(qr - ql, b.r - b.l) && qb <= b.top + 1) { wakePiece(q); break; }
      }
    }
    kick();
  }
  /* GPU cost (w·h·dpr², as addPiece charges it) of a batch of [node, p] pairs about to be added. */
  function batchGpu(nodes) {
    const dpr = Math.min(win.devicePixelRatio || 1, 2);
    let s = 0;
    for (const [, p] of nodes) s += p.w * p.h * dpr * dpr;
    return s;
  }
  function enforceCap(incoming, incomingGpu) {
    let need = state.pieces.length + incoming - CAP;
    let gpu = state.gpuSum + (incomingGpu || 0);   // include the batch being added, not only what is live
    const overGpu = gpu > GPU_BUDGET;
    if (need <= 0 && !overGpu) return;
    const t = now();
    const sorted = state.pieces.slice().sort((a, b) => ((b.resting ? 1 : 0) - (a.resting ? 1 : 0)) || (a.bornAt - b.bornAt));
    const victims = [];
    const take = (p) => { victims.push(p); gpu -= p.gpu; };
    for (const p of sorted) { if (victims.length >= need && gpu <= GPU_BUDGET) break; if (t - p.bornAt >= MIN_EVICT_AGE) take(p); }
    // The cap is hard: if everything is younger than 800 ms, evict the oldest anyway.
    if (victims.length < need) { for (const p of sorted) { if (victims.length >= need) break; if (!victims.includes(p)) take(p); } }
    evictPieces(victims, false);
  }
  function makeWrapper(rect, ow, oh, sx, sy, poly, clipped) {
    const piece = mk('div', 'crs-piece crs-debris');
    piece.style.left = px(rect.left); piece.style.top = px(rect.top);
    piece.style.width = px(rect.width); piece.style.height = px(rect.height);
    piece.style.transformOrigin = px(poly.cx * sx) + ' ' + px(poly.cy * sy);
    const clip = mk('div', 'crs-clip');
    clip.style.width = px(ow); clip.style.height = px(oh);
    if (clipped) clip.style.clipPath = polyToClip(poly);
    if (Math.abs(sx - 1) > 0.02 || Math.abs(sy - 1) > 0.02) { clip.style.transform = 'scale(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ')'; clip.style.transformOrigin = '0 0'; }
    piece.append(clip);
    return { piece, clip };
  }
