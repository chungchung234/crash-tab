  /* ===================================================================== */
  /* 8. Geometry: polygon splitting                                          */
  /* ===================================================================== */
  function polyInfo(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
      const cr = p[0] * q[1] - q[0] * p[1];
      a += cr; cx += (p[0] + q[0]) * cr; cy += (p[1] + q[1]) * cr;
    }
    if (Math.abs(a) < 1e-6) { cx = (minX + maxX) / 2; cy = (minY + maxY) / 2; } else { cx /= (3 * a); cy /= (3 * a); }
    return { pts, minX, minY, maxX, maxY, cx, cy };
  }
  function rayExit(w, h, cx, cy, a) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let t = Infinity;
    if (dx > 1e-9) t = Math.min(t, (w - cx) / dx); else if (dx < -1e-9) t = Math.min(t, -cx / dx);
    if (dy > 1e-9) t = Math.min(t, (h - cy) / dy); else if (dy < -1e-9) t = Math.min(t, -cy / dy);
    if (!isFinite(t)) t = 0;
    return { x: clamp(cx + dx * t, 0, w), y: clamp(cy + dy * t, 0, h), L: t };
  }
  function perim(w, h, x, y) {
    const e = 0.01;
    if (Math.abs(y) < e) return x;
    if (Math.abs(x - w) < e) return w + y;
    if (Math.abs(y - h) < e) return w + h + (w - x);
    return 2 * w + h + (h - y);
  }
  function pieSplit(w, h, cx, cy, angles) {
    const P = 2 * (w + h);
    const rays = angles.map((a0) => {
      const a = ((a0 % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const e = rayExit(w, h, cx, cy, a);
      const fr = Math.random() < 0.5 ? [rand(0.35, 0.65)] : [rand(0.25, 0.45), rand(0.6, 0.8)];
      const nx = -Math.sin(a), ny = Math.cos(a);
      const pts = fr.map((f) => {
        const off = rand(-0.08, 0.08) * e.L;
        return [clamp(cx + Math.cos(a) * f * e.L + nx * off, 0.5, w - 0.5), clamp(cy + Math.sin(a) * f * e.L + ny * off, 0.5, h - 0.5)];
      });
      return { a, pts, ex: e.x, ey: e.y, t: perim(w, h, e.x, e.y) };
    }).sort((p, q) => p.a - q.a);
    const corners = [[0, 0, 0], [w, 0, w], [w, h, w + h], [0, h, 2 * w + h]];
    const out = [];
    for (let i = 0; i < rays.length; i++) {
      const r1 = rays[i], r2 = rays[(i + 1) % rays.length];
      const poly = [[cx, cy]].concat(r1.pts, [[r1.ex, r1.ey]]);
      const span = rays.length === 1 ? P : ((((r2.t - r1.t) % P) + P) % P || P);
      const dist = (t) => (((t - r1.t) % P) + P) % P;
      const cs = corners.filter((c) => { const d = dist(c[2]); return d > 1e-6 && d < span - 1e-6; }).sort((p, q) => dist(p[2]) - dist(q[2]));
      for (const c of cs) poly.push([c[0], c[1]]);
      poly.push([r2.ex, r2.ey]);
      for (let k = r2.pts.length - 1; k >= 0; k--) poly.push(r2.pts[k]);
      out.push(polyInfo(poly));
    }
    return out;
  }
  function gridSplit(w, h, cols, rows) {
    const cw = w / cols, ch = h / rows, V = [];
    for (let j = 0; j <= rows; j++) {
      V.push([]);
      for (let i = 0; i <= cols; i++) {
        let x = i * cw, y = j * ch;
        const ex = i === 0 || i === cols, ey = j === 0 || j === rows;
        if (!ex) x += rand(-0.12, 0.12) * cw;
        if (!ey) y += rand(-0.12, 0.12) * ch;
        V[j].push([x, y]);
      }
    }
    const out = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push(polyInfo([V[j][i], V[j][i + 1], V[j + 1][i + 1], V[j + 1][i]]));
    return out;
  }
  function splitRect(w, h, n, ix, iy, splitLine) {
    if (n <= 1 || w < 2 || h < 2) return [polyInfo([[0, 0], [w, 0], [w, h], [0, h]])];
    if (n === 2 && splitLine) {   // axe / sword (A8): forced angle, pivot clamped to [2, w−2] × [2, h−2]
      const a = splitLine.angle;
      const cx = clamp(splitLine.cx, Math.min(2, w / 2), Math.max(w - 2, w / 2));
      const cy = clamp(splitLine.cy, Math.min(2, h / 2), Math.max(h - 2, h / 2));
      return pieSplit(w, h, cx, cy, [a, a + Math.PI]);
    }
    if (n === 6) return gridSplit(w, h, 3, 2);
    if (n === 8) return gridSplit(w, h, 4, 2);
    if (n === 4) {
      return pieSplit(w, h, clamp(ix, w * 0.25, w * 0.75), clamp(iy, h * 0.25, h * 0.75), [0, 90, 180, 270].map((d) => (d + rand(-25, 25)) * DEG));
    }
    const a = rand(0, Math.PI * 2);
    return pieSplit(w, h, clamp(ix + rand(-0.1, 0.1) * w, w * 0.3, w * 0.7), clamp(iy + rand(-0.1, 0.1) * h, h * 0.3, h * 0.7), [a + rand(-8, 8) * DEG, a + Math.PI + rand(-8, 8) * DEG]);
  }
  function polyToClip(poly) { return 'polygon(' + poly.pts.map((p) => px(p[0]) + ' ' + px(p[1])).join(',') + ')'; }
