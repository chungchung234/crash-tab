  /* ===================================================================== */
  /* 3. Damage marks (SPEC-material §2–§4)                                   */
  /*    Rewritten from the viewport-fixed crack canvas. Nothing is painted    */
  /*    on the screen any more: every mark is composited into the decal of    */
  /*    the element it landed on (src/31-decal.js), in that element's own     */
  /*    local coordinates, and is therefore clipped to its bounds and         */
  /*    carried by it when the page scrolls or reflows.                       */
  /* ===================================================================== */
  /* setupCanvas()/clearCanvas() keep their names and their call sites (activate, onResize, restore):
   * "set the marks up for the current layout" and "take every mark away" are still the two operations,
   * they just act on a set of per-element decals instead of one shared bitmap. */
  function setupCanvas() { syncDecals(); }
  function clearCanvas() {
    state.fxQueue.length = 0;
    clearDecals();
    clearMatFx();
    clearFracFx();     // SPEC-destruction §B3: the shared particle pool and the ember trails
    clearPartials();   // SPEC-destruction §C3: every borrowed `clip-path` goes back to its original value
    fracSetCurve(null);
  }

  /* Per-WEAPON profile: how big the mark is and how many strands it has (unchanged from v1). */
  const CRACK = {
    hammer: { rays: [9, 14], len: [90, 190], rings: [0.3, 0.62], w0: 2.0, w1: 0.6, alpha: 0.55 },
    bomb: { rays: [14, 22], len: [220, 420], rings: [0.28, 0.55, 0.8], w0: 2.6, w1: 0.7, alpha: 0.55 },
    gun: { rays: [5, 8], len: [22, 60], rings: [0.18, 0.35, 0.6], w0: 1.3, w1: 0.4, alpha: 0.4 },
    smg: { rays: [3, 5], len: [8, 20], rings: [0.3, 0.6], w0: 1.0, w1: 0.35, alpha: 0.4 }   // per smg shot (A6)
  };
  /* Per-MATERIAL profile (§4): the weapon says how hard it was hit, the material says what that leaves
   * behind. Glass radiates and sparkles; a panel dents and splits into a few blunt fractures; paper tears
   * along a short, very ragged line; plastic whitens around a stubby crack; metal dents and scratches and
   * barely cracks at all. `jag` feeds the per-step deviation of a strand, so paper wanders and metal does not. */
  const MARK = {
    glass:   { rayMul: 1.00, lenMul: 1.00, branches: 2, jag: 1.0, rings: true,  dust: true,  sheen: true,  dent: 0,    scratch: 0, blotch: 0,    core: 'spark' },
    panel:   { rayMul: 0.50, lenMul: 0.60, branches: 1, jag: 0.6, rings: true,  dust: false, sheen: false, dent: 0.55, scratch: 0, blotch: 0.30, core: 'dent' },
    paper:   { rayMul: 0.60, lenMul: 0.75, branches: 2, jag: 2.2, rings: false, dust: false, sheen: false, dent: 0,    scratch: 0, blotch: 0,    core: 'tear' },
    plastic: { rayMul: 0.45, lenMul: 0.55, branches: 1, jag: 0.8, rings: false, dust: false, sheen: false, dent: 0.35, scratch: 0, blotch: 0.85, core: 'dent' },
    metal:   { rayMul: 0.28, lenMul: 0.35, branches: 0, jag: 0.5, rings: false, dust: false, sheen: true,  dent: 1.00, scratch: 1, blotch: 0,    core: 'dent' }
  };
  function markOf(mat) { return MARK[mat] || MARK.panel; }

  function makeRay(base, len, jag) {
    const j = (jag == null || !(jag > 0)) ? 1 : jag;
    const pts = [[0, 0]], cum = [0];
    let x = 0, y = 0, dev = 0, traveled = 0, heading = base;
    let guard = 0;
    while (traveled < len && guard++ < 400) {
      const step = Math.min(rand(8, 18) / Math.max(0.6, j), len - traveled + 0.01);
      dev += rand(-14, 14) * j * DEG; dev *= 0.7;
      heading = base + clamp(dev, -32 * j * DEG, 32 * j * DEG);
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

  /* Build one mark tile for one material, as an offscreen bitmap at device resolution. Returns
   * { off, minX, minY, bw, bh, maxLen } in CSS px relative to the impact point, or null. */
  function buildMarkTile(kind, mat, opts) {
    const P = CRACK[kind] || CRACK.hammer;
    const M = markOf(mat);
    const ink = matOf(mat);
    const raysR = opts.rays || P.rays, lenScale = opts.lenScale || 1, lenR = opts.len || P.len;
    const gunlike = kind === 'gun' || kind === 'smg';
    const nRays = Math.max(2, Math.round(randInt(raysR[0], raysR[1]) * M.rayMul * crackRayMul()));   // SPEC-settings §2.2: ×0.7 in performance mode
    const rays = [], branches = [];
    let maxLen = 0;
    for (let i = 0; i < nRays; i++) {
      const base = (i / nRays) * Math.PI * 2 + rand(-1, 1) * (Math.PI / nRays) * 0.6;
      const r = makeRay(base, rand(lenR[0], lenR[1]) * lenScale * M.lenMul, M.jag);
      rays.push(r); maxLen = Math.max(maxLen, r.len);
      const nb = M.branches ? randInt(0, M.branches) : 0;
      for (let b = 0; b < nb; b++) {
        const start = pointAt(r, rand(0.35, 0.75));
        const ang = start[2] + (Math.random() < 0.5 ? -1 : 1) * rand(30, 60) * DEG;
        const br = makeRay(ang, r.len * rand(0.25, 0.55), M.jag);
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
    const D = decalDpr();
    let off, octx;
    try {
      off = doc.createElement('canvas');
      off.width = Math.max(1, Math.min(DECAL_MAX_PX, Math.round(bw * D)));
      off.height = Math.max(1, Math.min(DECAL_MAX_PX, Math.round(bh * D)));
      octx = off.getContext('2d');
      if (!octx) return null;
      octx.setTransform(D, 0, 0, D, -minX * D, -minY * D);
    } catch (e) { return null; }
    octx.lineCap = 'round'; octx.lineJoin = 'round';
    // bomb scorch under the mark
    if (kind === 'bomb') {
      const g = octx.createRadialGradient(0, 0, 0, 0, 0, 90);
      g.addColorStop(0, 'rgba(20,15,10,0.45)'); g.addColorStop(1, 'rgba(20,15,10,0)');
      octx.fillStyle = g; octx.beginPath(); octx.arc(0, 0, 90, 0, Math.PI * 2); octx.fill();
    }
    // §4 plastic / panel: the material whitens around the impact before it cracks
    if (M.blotch > 0) {
      const r0 = Math.max(12, maxLen * 0.45);
      const g = octx.createRadialGradient(0, 0, 0, 0, 0, r0);
      g.addColorStop(0, 'rgba(255,255,255,' + (0.30 * M.blotch).toFixed(3) + ')');
      g.addColorStop(0.6, 'rgba(255,255,255,' + (0.12 * M.blotch).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      octx.fillStyle = g; octx.beginPath(); octx.arc(0, 0, r0, 0, Math.PI * 2); octx.fill();
    }
    // §4 metal / panel: a dent — a dark crescent with a lit rim, no glass at all
    if (M.dent > 0) {
      const rd = Math.max(7, maxLen * 0.3 * M.dent);
      const a = rand(0, Math.PI * 2);
      const g = octx.createRadialGradient(Math.cos(a) * rd * 0.3, Math.sin(a) * rd * 0.3, 0, 0, 0, rd);
      g.addColorStop(0, 'rgba(10,14,20,' + (0.34 * M.dent).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(10,14,20,0)');
      octx.fillStyle = g; octx.beginPath(); octx.arc(0, 0, rd, 0, Math.PI * 2); octx.fill();
      octx.strokeStyle = ink.light; octx.lineWidth = 1;
      octx.beginPath(); octx.arc(0, 0, rd * 0.8, a - 1.1, a + 1.1); octx.stroke();
    }
    // sheen wedges between random adjacent ray pairs, out to ring 2 (glass / metal only)
    if (M.sheen && nRays > 1) {
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
    }
    // accumulate strokes into width buckets (taper w0 → w1)
    const wMid = (P.w0 + P.w1) / 2;
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
    if (M.rings) {
      for (const f0 of P.rings) {
        const ringPts = rays.map((r) => pointAt(r, f0 * rand(0.88, 1.12)));
        ringPts.push(ringPts[0]);
        addPoly(buckets[4][0], ringPts, 0, 0);
      }
    }
    // §4 metal: short straight scratches instead of a web
    if (M.scratch > 0) {
      const ns = randInt(3, 6);
      for (let i = 0; i < ns; i++) {
        const a = rand(0, Math.PI * 2), d0 = rand(3, Math.max(6, maxLen * 0.4)), L = rand(6, Math.max(10, maxLen * 0.6));
        const sxp = Math.cos(a) * d0, syp = Math.sin(a) * d0;
        buckets[4][0].moveTo(sxp, syp);
        buckets[4][0].lineTo(sxp + Math.cos(a) * L, syp + Math.sin(a) * L);
      }
    }
    const alpha = P.alpha * Math.max(0.35, 1 - state.crackInk / 60);
    octx.shadowColor = 'rgba(0,0,0,0.35)'; octx.shadowBlur = 2;
    octx.strokeStyle = ink.light.replace(/[\d.]+\)$/, alpha.toFixed(3) + ')');
    for (const [path, w] of buckets) { octx.lineWidth = w * 2.4; octx.stroke(path); }
    octx.shadowBlur = 0; octx.shadowColor = 'rgba(0,0,0,0)';
    octx.strokeStyle = ink.ink;
    for (const [path, w] of buckets) { octx.lineWidth = w; octx.stroke(path); }
    // §4 glass: the dust of a shattered pane
    if (M.dust) {
      const nd = randInt(10, 25);
      octx.fillStyle = 'rgba(255,255,255,0.7)';
      for (let i = 0; i < nd; i++) {
        const a = rand(0, Math.PI * 2), d = rand(4, Math.max(6, maxLen * 0.5)), s = rand(1, 2);
        octx.fillRect(Math.cos(a) * d, Math.sin(a) * d, s, s);
      }
    }
    // the impact core
    if (gunlike) {
      const g = octx.createRadialGradient(0, 0, 0, 0, 0, 7);
      g.addColorStop(0, '#111'); g.addColorStop(0.7, 'rgba(17,17,17,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      octx.fillStyle = g; octx.beginPath(); octx.arc(0, 0, 7, 0, Math.PI * 2); octx.fill();
      octx.strokeStyle = 'rgba(255,255,255,0.8)'; octx.lineWidth = 0.8; octx.beginPath(); octx.arc(0, 0, 8, 0, Math.PI * 2); octx.stroke();
    } else if (M.core === 'spark') {
      const r0 = kind === 'bomb' ? 26 : 14;
      const g = octx.createRadialGradient(0, 0, 0, 0, 0, r0);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      octx.fillStyle = g; octx.beginPath(); octx.arc(0, 0, r0, 0, Math.PI * 2); octx.fill();
    } else if (M.core === 'tear') {
      // paper: the hole itself, a ragged opening with a pale torn lip
      const n = randInt(7, 11), rr = Math.max(4, maxLen * 0.12);
      octx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2, d = rr * rand(0.5, 1.5);
        const xx = Math.cos(a) * d, yy = Math.sin(a) * d;
        if (i === 0) octx.moveTo(xx, yy); else octx.lineTo(xx, yy);
      }
      octx.closePath();
      octx.fillStyle = ink.ink; octx.fill();
      octx.strokeStyle = ink.light; octx.lineWidth = 1.2; octx.stroke();
    }
    return { off, minX, minY, bw, bh, maxLen };
  }

  /* ── which elements one shot marks ──
   * A point weapon marks exactly the element it hit. A blast marks the elements it actually DAMAGED: the
   * same aoeCandidates() set the weapon itself resolves, so the mark and the damage agree, and the blast
   * breaks along the real boundaries between things instead of being painted over them (§3). */
  function blastWeapon() {
    const W = WEAPONS[state.weapon];
    const ok = W && typeof W.radius === 'number' && isFinite(W.radius) && W.radius > 0 && Array.isArray(W.rings);
    return ok ? W : WEAPONS.bomb;   // collapse's radius is Infinity: fall back to the bomb's 240 px
  }
  function decalTargetsForBlast(x, y) {
    const W = blastWeapon();
    let cands = [];
    try { cands = aoeCandidates(x, y, W.radius, Math.min(W.maxTargets || 10, DECAL_MAX_TARGETS), W.rings, true); } catch (e) { cands = []; }
    const out = [];
    for (const c of cands) { const rec = ensureDecal(c.el); if (rec) out.push(rec); }
    if (!out.length) { const rec0 = ensureDecal(decalTargetAt(x, y)); if (rec0) out.push(rec0); }
    return out;
  }
  function decalTargetsFor(x, y, radius) {
    if (radius > 0) return decalTargetsForBlast(x, y);
    const rec = ensureDecal(decalTargetAt(x, y));
    return rec ? [rec] : [];
  }

  /* opts (v1.1 A10): { rays: [min, max], lenScale, len, ink, radius }. `cracks` counts every drawn mark (A3);
   * `crackInk` (hammer/axe/bomb/rocket 1, pistol/smg .25, sword .5) drives the light-pass fade.
   * The mark is cut per ELEMENT: every element the shot reaches gets the mark in its own material, drawn in
   * its own local space, so a blast splits along the real boundaries between things (§3). */
  function drawCrack(x, y, kind, opts) {
    opts = opts || {};
    state.cracks++;
    state.crackInk += (opts.ink != null ? opts.ink : 1);
    if (!root) return;
    const radius = opts.radius != null ? opts.radius : (kind === 'bomb' ? BOMB_RADIUS : 0);
    const recs = decalTargetsFor(x, y, radius);
    if (!recs.length) return;
    const tiles = new Map();      // material id -> tile
    let pushed = 0;
    for (const rec of recs) {
      const mat = materialOf(rec.el);
      let tile = tiles.get(mat);
      if (tile === undefined) { tile = buildMarkTile(kind, mat, opts); tiles.set(mat, tile); }
      if (!tile) continue;
      const lx = x - rec.left, ly = y - rec.top;
      state.fxQueue.push({
        rec, off: tile.off, lx, ly,
        bx: lx + tile.minX, by: ly + tile.minY, bw: tile.bw, bh: tile.bh,
        radii: [tile.maxLen * 0.4, tile.maxLen * 0.75, Infinity], stage: 0
      });
      /* SPEC-destruction §A: the material's crack web says what the SURFACE did; this says what the WEAPON
       * did — the hole, the spall cone, the axe's cut, the soot. It is painted straight into the decal (not
       * through the staged fx queue) because it is the part of the mark the shot is actually aimed at, and
       * it ACCUMULATES: four shots leave four holes. */
      weaponMark(rec, lx, ly, x, y, opts);
      pushed++;
    }
    if (!pushed) return;
    runFx();      // the impact core lands in the same task as the hit; the web grows over the next two frames
    kick();
  }
  function runFx() {
    if (!state.fxQueue.length) return;
    for (let i = state.fxQueue.length - 1; i >= 0; i--) {
      const f = state.fxQueue[i];
      const rec = f.rec;
      if (!rec || !rec.ctx || !rec.node.isConnected || decals.get(rec.el) !== rec) { state.fxQueue.splice(i, 1); continue; }
      const rIn = f.stage === 0 ? 0 : f.radii[f.stage - 1];
      const rOut = f.radii[f.stage];
      try {
        const c = rec.ctx;
        c.save();
        c.beginPath();
        if (rOut === Infinity) c.rect(f.bx - 1, f.by - 1, f.bw + 2, f.bh + 2); else c.arc(f.lx, f.ly, rOut, 0, Math.PI * 2);
        if (rIn > 0) c.arc(f.lx, f.ly, rIn, 0, Math.PI * 2, true);
        c.clip('evenodd');
        c.drawImage(f.off, f.bx, f.by, f.bw, f.bh);
        c.restore();
      } catch (e) { /* ignore */ }
      f.stage++;
      if (f.stage >= f.radii.length) state.fxQueue.splice(i, 1);
    }
  }
  /* Katana cut (A8 + SPEC-destruction §A / §D2): the cut is drawn into every decal it crosses, each in that
   * element's own local space, so one drag across three cards leaves three cuts that stop at the cards'
   * edges. §D2 changed WHAT is drawn and WHEN:
   *   · one DARK arc that follows the blade's curve — rgba(18,20,26,.55), 1.2 px tapering to 0.4 px at the
   *     tips. No bright line: "실제로는 번쩍인 뒤 어두운 칼자국이 남는다" (§D1).
   *   · no perpendicular ticks at all — they read as a saw, not a blade (§D1).
   *   · it appears at 180 ms, once the crescent afterimage has gone, and then stays.
   * `state.cracks` still moves in the same synchronous task as the swing, so the counter means "this swing
   * drew a mark" exactly as it did before. */
  const SLASH_SCAR_MS = 180;
  function drawSlash(x1, y1, x2, y2) {
    state.cracks++; state.crackInk += 0.5;
    if (!root) return;
    const cu = fracGetCurve() || fracMakeCurve(x1, y1, x2, y2, null);
    const samples = fracCurveSamples(cu, 18);
    const seen = new Set(), els = [];
    for (const s of samples) {
      const el = decalTargetAt(s.x, s.y);
      if (!el || seen.has(el)) continue;
      seen.add(el); els.push(el);
      if (els.length >= 6) break;
    }
    if (!els.length) return;
    const paint = () => {
      if (!state.active || !root) return;
      for (const el of els) {
        const rec = ensureDecal(el);
        if (!rec || !rec.ctx) continue;
        const ox = rec.left, oy = rec.top;
        try {
          const c = rec.ctx;
          c.save();
          c.lineCap = 'round'; c.lineJoin = 'round';
          c.strokeStyle = 'rgba(18,20,26,.55)';
          // tapered: the belly of the arc is 1.2 px, both tips 0.4 px — three passes over the same curve
          for (const [a, b, w] of [[0, 1, 0.4], [0.12, 0.88, 0.8], [0.3, 0.7, 1.2]]) {
            c.lineWidth = w;
            c.beginPath();
            const n = 24;
            for (let i = 0; i <= n; i++) {
              const p = fracCurveAt(cu, a + (b - a) * (i / n));
              if (i === 0) c.moveTo(p.x - ox, p.y - oy); else c.lineTo(p.x - ox, p.y - oy);
            }
            c.stroke();
          }
          c.restore();
        } catch (e) { /* ignore */ }
      }
      kick();
    };
    later(paint, SLASH_SCAR_MS);
  }
  /* Scorch dab (flame every 4th tick r 24 / rocket impact r 140, A7 / A9) — burnt into the elements it
   * touches, never onto the page behind them. */
  function scorchDab(x, y, r, a) {
    if (!root) return;
    const recs = decalTargetsFor(x, y, r > 60 ? r : 0);
    for (const rec of recs) {
      try {
        const c = rec.ctx;
        const lx = x - rec.left, ly = y - rec.top;
        const g = c.createRadialGradient(lx, ly, 0, lx, ly, r);
        g.addColorStop(0, 'rgba(30,20,10,' + a + ')'); g.addColorStop(1, 'rgba(30,20,10,0)');
        c.fillStyle = g; c.beginPath(); c.arc(lx, ly, r, 0, Math.PI * 2); c.fill();
      } catch (e) { /* ignore */ }
    }
  }
