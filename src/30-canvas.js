  /* ===================================================================== */
  /* 3. Crack canvas (persistent, DPR aware, resize-preserving)             */
  /* ===================================================================== */
  function setupCanvas(preserve) {
    const dpr = Math.min(win.devicePixelRatio || 1, 2);
    const cssW = viewW(), cssH = viewH();
    const bw = Math.max(1, Math.min(4096, Math.round(cssW * dpr)));
    const bh = Math.max(1, Math.min(4096, Math.round(cssH * dpr)));
    let tmp = null;
    if (preserve && ctx && canvas.width > 0 && canvas.height > 0) {
      try {
        tmp = doc.createElement('canvas');
        tmp.width = canvas.width; tmp.height = canvas.height;
        tmp.getContext('2d').drawImage(canvas, 0, 0);
      } catch (e) { tmp = null; }
    }
    const oldW = canvas.width, oldH = canvas.height;
    const oldCssW = canvasCssW || cssW, oldCssH = canvasCssH || cssH;   // CSS size the old bitmap covered
    canvas.width = bw; canvas.height = bh;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx = canvas.getContext('2d');
    canvasCssW = cssW; canvasCssH = cssH;
    canvasSX = bw / cssW; canvasSY = bh / cssH;
    if (tmp && ctx) {
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // destination in NEW device px: the old CSS area at the new ratio (a DPR change would otherwise rescale the cracks)
        ctx.drawImage(tmp, 0, 0, oldW, oldH, 0, 0, Math.max(1, Math.round(oldCssW * canvasSX)), Math.max(1, Math.round(oldCssH * canvasSY)));
      } catch (e) { /* ignore */ }
    }
    if (ctx) ctx.setTransform(canvasSX, 0, 0, canvasSY, 0, 0);
  }
  function clearCanvas() {
    if (!ctx) return;
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(canvasSX, 0, 0, canvasSY, 0, 0);
    } catch (e) { /* ignore */ }
    state.fxQueue.length = 0;
  }

  const CRACK = {
    hammer: { rays: [9, 14], len: [90, 190], rings: [0.3, 0.62], w0: 2.0, w1: 0.6, alpha: 0.55 },
    bomb: { rays: [14, 22], len: [220, 420], rings: [0.28, 0.55, 0.8], w0: 2.6, w1: 0.7, alpha: 0.55 },
    gun: { rays: [5, 8], len: [22, 60], rings: [0.18, 0.35, 0.6], w0: 1.3, w1: 0.4, alpha: 0.4 },
    smg: { rays: [3, 5], len: [8, 20], rings: [0.3, 0.6], w0: 1.0, w1: 0.35, alpha: 0.4 }   // per smg shot (A6)
  };
  function makeRay(base, len) {
    const pts = [[0, 0]], cum = [0];
    let x = 0, y = 0, dev = 0, traveled = 0, heading = base;
    while (traveled < len) {
      const step = Math.min(rand(8, 18), len - traveled + 0.01);
      dev += rand(-14, 14) * DEG; dev *= 0.7;
      heading = base + clamp(dev, -32 * DEG, 32 * DEG);
      x += Math.cos(heading) * step; y += Math.sin(heading) * step; traveled += step;
      pts.push([x, y]); cum.push(traveled);
    }
    return { pts, cum, len: traveled, base, heading };
  }
  function pointAt(ray, f) {
    const d = clamp(f, 0, 1) * ray.len;
    for (let i = 1; i < ray.pts.length; i++) {
      if (ray.cum[i] >= d) {
        const t = (d - ray.cum[i - 1]) / Math.max(1e-6, ray.cum[i] - ray.cum[i - 1]);
        const a = ray.pts[i - 1], b = ray.pts[i];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])];
      }
    }
    const l = ray.pts[ray.pts.length - 1];
    return [l[0], l[1], ray.heading];
  }
  /* opts (v1.1 A10): { rays: [min, max], lenScale, ink }. `cracks` counts every drawn crack (A3);
   * `crackInk` (hammer/axe/bomb/rocket 1, pistol/smg .25, sword .5) drives the light-pass fade instead of `cracks`. */
  function drawCrack(x, y, kind, opts) {
    opts = opts || {};
    state.cracks++;
    state.crackInk += (opts.ink != null ? opts.ink : 1);
    if (!ctx) return;
    const P = CRACK[kind] || CRACK.hammer;
    const raysR = opts.rays || P.rays, lenScale = opts.lenScale || 1, lenR = opts.len || P.len;   // len: sniper 30–70 (v1.2 §2)
    const gunlike = kind === 'gun' || kind === 'smg';
    const nRays = randInt(raysR[0], raysR[1]);
    const rays = [], branches = [];
    let maxLen = 0;
    for (let i = 0; i < nRays; i++) {
      const base = (i / nRays) * Math.PI * 2 + rand(-1, 1) * (Math.PI / nRays) * 0.6;
      const r = makeRay(base, rand(lenR[0], lenR[1]) * lenScale);
      rays.push(r); maxLen = Math.max(maxLen, r.len);
      const nb = randInt(0, 2);
      for (let b = 0; b < nb; b++) {
        const start = pointAt(r, rand(0.35, 0.75));
        const ang = start[2] + (Math.random() < 0.5 ? -1 : 1) * rand(30, 60) * DEG;
        const br = makeRay(ang, r.len * rand(0.25, 0.55));
        br.ox = start[0]; br.oy = start[1];
        branches.push(br);
      }
    }
    // bounding box (CSS px, relative to the impact point)
    let minX = 0, minY = 0, maxX = 0, maxY = 0;
    const grow = (pxv, pyv) => { if (pxv < minX) minX = pxv; if (pxv > maxX) maxX = pxv; if (pyv < minY) minY = pyv; if (pyv > maxY) maxY = pyv; };
    for (const r of rays) for (const p of r.pts) grow(p[0], p[1]);
    for (const b of branches) for (const p of b.pts) grow(b.ox + p[0], b.oy + p[1]);
    const margin = (kind === 'bomb' ? 96 : 20);
    minX -= margin; minY -= margin; maxX += margin; maxY += margin;
    const bw = Math.ceil(maxX - minX), bh = Math.ceil(maxY - minY);
    let off, octx;
    try {
      off = doc.createElement('canvas');
      off.width = Math.max(1, Math.round(bw * canvasSX)); off.height = Math.max(1, Math.round(bh * canvasSY));
      octx = off.getContext('2d');
      octx.setTransform(canvasSX, 0, 0, canvasSY, -minX * canvasSX, -minY * canvasSY);
    } catch (e) { return; }
    octx.lineCap = 'round'; octx.lineJoin = 'round';
    // bomb scorch under the cracks
    if (kind === 'bomb') {
      const g = octx.createRadialGradient(0, 0, 0, 0, 0, 90);
      g.addColorStop(0, 'rgba(20,15,10,0.45)'); g.addColorStop(1, 'rgba(20,15,10,0)');
      octx.fillStyle = g; octx.beginPath(); octx.arc(0, 0, 90, 0, Math.PI * 2); octx.fill();
    }
    // sheen wedges between random adjacent ray pairs, out to ring 2
    const ringF2 = P.rings[Math.min(1, P.rings.length - 1)];
    const nW = randInt(2, 3);
    octx.fillStyle = 'rgba(255,255,255,0.07)';
    for (let k = 0; k < nW; k++) {
      const i = randInt(0, nRays - 1), r1 = rays[i], r2 = rays[(i + 1) % nRays];
      octx.beginPath(); octx.moveTo(0, 0);
      for (let f = 0.1; f <= ringF2 + 1e-6; f += 0.1) { const p = pointAt(r1, f); octx.lineTo(p[0], p[1]); }
      for (let f = ringF2; f >= 0.1 - 1e-6; f -= 0.1) { const p = pointAt(r2, f); octx.lineTo(p[0], p[1]); }
      octx.closePath(); octx.fill();
    }
    // accumulate strokes into width buckets (taper w0 → w1)
    const wMid = (P.w0 + P.w1) / 2;
    // branches/rings keep a >= 0.8-0.9 px dark stroke: sub-pixel widths rasterise as faint dashes at 1x DPR
    const buckets = [[new Path2D(), P.w0], [new Path2D(), wMid], [new Path2D(), P.w1], [new Path2D(), Math.max(0.9, P.w1 * 0.9)], [new Path2D(), Math.max(0.8, P.w1 * 0.7)]];
    const addPoly = (path, pts, ox, oy) => { path.moveTo(ox + pts[0][0], oy + pts[0][1]); for (let i = 1; i < pts.length; i++) path.lineTo(ox + pts[i][0], oy + pts[i][1]); };
    for (const r of rays) {
      const n = r.pts.length;
      const segs = [[], [], []];
      for (let i = 0; i < n; i++) {
        const f = r.cum[i] / Math.max(1, r.len);
        const b = f < 1 / 3 ? 0 : (f < 2 / 3 ? 1 : 2);
        segs[b].push(r.pts[i]);
        if (b > 0 && segs[b].length === 1 && i > 0) segs[b].unshift(r.pts[i - 1]);
      }
      for (let b = 0; b < 3; b++) if (segs[b].length > 1) addPoly(buckets[b][0], segs[b], 0, 0);
    }
    for (const b of branches) addPoly(buckets[3][0], b.pts, b.ox, b.oy);
    for (const f0 of P.rings) {
      const ringPts = rays.map((r) => pointAt(r, f0 * rand(0.88, 1.12)));
      ringPts.push(ringPts[0]);
      addPoly(buckets[4][0], ringPts, 0, 0);
    }
    const alpha = P.alpha * Math.max(0.35, 1 - state.crackInk / 60);
    octx.shadowColor = 'rgba(0,0,0,0.35)'; octx.shadowBlur = 2;
    octx.strokeStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
    for (const [path, w] of buckets) { octx.lineWidth = w * 2.4; octx.stroke(path); }
    octx.shadowBlur = 0; octx.shadowColor = 'rgba(0,0,0,0)';
    octx.strokeStyle = 'rgba(15,25,35,0.75)';
    for (const [path, w] of buckets) { octx.lineWidth = w; octx.stroke(path); }
    // glass dust
    const nd = randInt(10, 25);
    octx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < nd; i++) {
      const a = rand(0, Math.PI * 2), d = rand(4, maxLen * 0.5), s = rand(1, 2);
      octx.fillRect(Math.cos(a) * d, Math.sin(a) * d, s, s);
    }
    // centre
    if (gunlike) {
      const g = octx.createRadialGradient(0, 0, 0, 0, 0, 7);
      g.addColorStop(0, '#111'); g.addColorStop(0.7, 'rgba(17,17,17,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      octx.fillStyle = g; octx.beginPath(); octx.arc(0, 0, 7, 0, Math.PI * 2); octx.fill();
      octx.strokeStyle = 'rgba(255,255,255,0.8)'; octx.lineWidth = 0.8; octx.beginPath(); octx.arc(0, 0, 8, 0, Math.PI * 2); octx.stroke();
    } else {
      const r0 = kind === 'bomb' ? 26 : 14;
      const g = octx.createRadialGradient(0, 0, 0, 0, 0, r0);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      octx.fillStyle = g; octx.beginPath(); octx.arc(0, 0, r0, 0, Math.PI * 2); octx.fill();
    }
    // grow over three frames through annulus clips (A18)
    state.fxQueue.push({ off, x, y, bx: x + minX, by: y + minY, bw, bh, radii: [maxLen * 0.4, maxLen * 0.75, Infinity], stage: 0 });
    kick();
  }
  function runFx() {
    if (!ctx) { state.fxQueue.length = 0; return; }
    for (let i = state.fxQueue.length - 1; i >= 0; i--) {
      const f = state.fxQueue[i];
      const rIn = f.stage === 0 ? 0 : f.radii[f.stage - 1];
      const rOut = f.radii[f.stage];
      try {
        ctx.save();
        ctx.beginPath();
        if (rOut === Infinity) ctx.rect(f.bx - 1, f.by - 1, f.bw + 2, f.bh + 2); else ctx.arc(f.x, f.y, rOut, 0, Math.PI * 2);
        if (rIn > 0) ctx.arc(f.x, f.y, rIn, 0, Math.PI * 2, true);
        ctx.clip('evenodd');
        ctx.drawImage(f.off, f.bx, f.by, f.bw, f.bh);
        ctx.restore();
      } catch (e) { /* ignore */ }
      f.stage++;
      if (f.stage >= f.radii.length) state.fxQueue.splice(i, 1);
    }
  }
  /* Sword slash (A8): drawn straight on the persistent ctx — light underlay, dark line, perpendicular ticks. */
  function drawSlash(x1, y1, x2, y2) {
    state.cracks++; state.crackInk += 0.5;
    if (!ctx) return;
    try {
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
      const ticks = [];
      const nt = randInt(6, 14);
      for (let i = 0; i < nt; i++) {
        const f = rand(0.04, 0.96), L = rand(4, 10), s = Math.random() < 0.5 ? -1 : 1;
        const bx = x1 + dx * f, by = y1 + dy * f;
        ticks.push([bx, by, bx + nx * L * s, by + ny * L * s]);
      }
      ctx.save();
      ctx.lineCap = 'round';
      const pass = (color, w) => {
        ctx.strokeStyle = color; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        for (const t of ticks) { ctx.moveTo(t[0], t[1]); ctx.lineTo(t[2], t[3]); }
        ctx.stroke();
      };
      pass('rgba(255,255,255,0.7)', 2.4);
      pass('rgba(15,25,35,0.75)', 1.0);
      ctx.restore();
    } catch (e) { /* ignore */ }
  }
  /* Scorch dab on the persistent canvas (flame every 4th tick r 24 / rocket impact r 140, A7 / A9). */
  function scorchDab(x, y, r, a) {
    if (!ctx) return;
    try {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(30,20,10,' + a + ')'); g.addColorStop(1, 'rgba(30,20,10,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    } catch (e) { /* ignore */ }
  }
