  /* ===================================================================== */
  /* 11. Breaking elements                                                    */
  /* ===================================================================== */
  function hideOriginal(el) {
    const saved = [];
    const hideOne = (node) => {
      for (const p of ['visibility', 'opacity', 'pointer-events']) {
        saved.push({ node, prop: p, value: node.style.getPropertyValue(p), priority: node.style.getPropertyPriority(p) });
      }
      imp(node, 'visibility', 'hidden'); imp(node, 'opacity', '0'); imp(node, 'pointer-events', 'none');
    };
    hideOne(el);
    try {
      for (const ch of el.children) { const s = gcs(ch); if (s && s.visibility === 'visible') hideOne(ch); }
    } catch (e) { /* ignore */ }
    try { el.setAttribute('data-crs-broken', '1'); } catch (e) { /* ignore */ }
    const rec = { el, saved, mo: null, reapplied: 0, wasPlaying: false };
    try {
      rec.mo = new MutationObserver(() => {
        if (rec.reapplied >= 5 || !state.active) return;
        if (el.style.getPropertyValue('visibility') === 'hidden') return;
        rec.reapplied++;
        imp(el, 'visibility', 'hidden'); imp(el, 'opacity', '0'); imp(el, 'pointer-events', 'none');
      });
      rec.mo.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    } catch (e) { rec.mo = null; }
    state.broken.push(rec);
    return rec;
  }
  function textDominant(el) {
    if (el.shadowRoot) return false;
    const tag = tagOf(el);
    if (REPLACED_TAGS.has(tag) || tag === 'table') return false;
    const txt = (el.textContent || '').trim();
    if (txt.length < 2) return false;
    try { if (el.querySelector('img,video,canvas,svg,iframe,table,input,textarea,select,object,embed,picture')) return false; } catch (e) { return false; }
    if (countDescendants(el, 41) > 40) return false;
    if (txt.split(/\s+/).length > textTokenCap()) return false;   // SPEC-settings §2.2: 80 tokens, 40 in performance mode
    return true;
  }
  function boxVisible(el) {
    const s = gcs(el); if (!s) return false;
    if (alphaOf(s.backgroundColor) > 0) return true;
    if (s.backgroundImage && s.backgroundImage !== 'none') return true;
    return ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'].some((p) => parseFloat(s.getPropertyValue(p)) > 0);
  }
  function pieceCount(el, mode, rect, descendants, forced) {
    if (forced != null) return forced;
    const area = rect.width * rect.height;
    const tag = tagOf(el);
    if (area < 1200) return 1;
    if (state.lastBreakMs > 25) return 1;
    if (MEDIA_TAGS.has(tag) && descendants <= 1) {
      if (area > 300000) return 2;
      return mode === 'hammer' ? 6 : (mode === 'bomb' ? 8 : 2);
    }
    const big = area > 300000 || descendants > 120;
    let n;
    if (mode === 'bomb') n = area <= 160000 ? 6 : (area <= 600000 ? 4 : (area <= 1200000 ? 2 : 1));
    else if (mode === 'gun' || mode === 'collapse') n = area <= 600000 ? 2 : 1;
    else n = (area <= 160000 && descendants <= 120) ? 4 : (area <= 600000 ? 2 : 1);
    if (big) n = Math.min(n, 2);
    return n;
  }
  /* SPEC-destruction §B: the shape the element comes apart in, the way the pieces leave, how they are
   * finished and what they throw off are all read from WEAPONS[id].destruction (src/66-fracture.js). The v1
   * machinery below — one cloneTree per piece, the replayed style plan, the GPU budget — is untouched. */
  function spawnGeometric(el, rect, ix, iy, mode, n, opts) {
    const D = destructionOf(mode, opts);
    if (D.shape === 'ash' && !opts.textTransparent) return spawnAshFlakes(el, rect, ix, iy, mode, n, D);
    const mp = matPieceProps(materialOf(el));   // SPEC-material §5: the debris falls as what it was made of
    const ow = (el.offsetWidth || rect.width) || 1, oh = (el.offsetHeight || rect.height) || 1;
    const sx = rect.width / ow || 1, sy = rect.height / oh || 1;
    const sl = opts.splitLine ? { angle: opts.splitLine.angle, cx: (opts.splitLine.cx - rect.left) / sx, cy: (opts.splitLine.cy - rect.top) / sy } : null;
    const hx = (ix - rect.left) / sx, hy = (iy - rect.top) / sy;
    const curve = (D.separation === 'slide') ? fracGetCurve() : null;   // §D2: the katana cuts along its arc
    let polys = null;
    if (curve) polys = fracCurveSplit(ow, oh, curve, (p) => ({ x: (p.x - rect.left) / sx, y: (p.y - rect.top) / sy }));
    if (!polys) polys = fracPolys(D.shape, ow, oh, hx, hy, n, sl, opts);
    polys = fracClipToRemain(opts.remain, polys);
    const cap = cloneCapFor(opts.cloneCap || (n >= 4 ? 150 : 400));   // SPEC-settings §2.2: 400 descendants, 150 in performance mode
    // Every piece gets its own cloneTree (a deep DOM copy would carry style attributes,
    // which a strict style-src CSP rejects on insertion); the computed-style diff of the
    // first piece is replayed on its siblings.
    const finish = finishFilter(D.finish);
    const delay = scaleMs(D.delayMs || 0);
    const tangent = curve ? fracCurveAngle(curve, 0.5) : (sl ? sl.angle : null);
    let plan = null, made = 0;
    const nodes = [];
    for (let i = 0; i < polys.length; i++) {
      const poly = polys[i];
      const { piece, clip } = makeWrapper(rect, ow, oh, sx, sy, poly, polys.length > 1);
      root.append(piece);
      const b = buildStyledClone(el, ow, oh, cap, clip, plan);
      if (!b) { piece.remove(); continue; }
      plan = b.plan;
      if (opts.textTransparent) makeTextTransparent(b);
      if (opts.burnt) clip.style.filter = BURNT_FILTER;   // flame (A9): on the clip node, never the wrapper
      else if (finish) clip.style.filter = finish;        // §B3 scorch / char / ember, same node for the same reason
      const cx = rect.left + poly.cx * sx, cy = rect.top + poly.cy * sy;
      /* §B2: which side of the cut this piece is on — the cleave turns the two halves opposite ways and
       * the katana slides them apart along the cut, so both need the sign and not just the position. */
      const side = fracCutSide(poly, sl, curve, rect, sx, sy, hx, hy);
      const v = velocityFor(mode, ix, iy, cx, cy, Object.assign({ sep: D.separation, side, tangent }, opts));
      const p = Object.assign({ ox: rect.left, oy: rect.top, w: rect.width, h: rect.height, vx: v.vx, vy: v.vy, vr: v.vr, cx: poly.cx * sx, cy: poly.cy * sy,
        bb: { minX: poly.minX * sx, minY: poly.minY * sy, maxX: poly.maxX * sx, maxY: poly.maxY * sy } }, mp);
      /* §B4 delayMs: the katana's two halves hang for 140 ms before anything moves — "벤 직후엔 아무 일도
       * 없다가 뒤늦게 미끄러져 분리되는 게 칼이다" (§D1). §D2 then gives them 80 ms of pure slide before
       * gravity joins in. */
      if (delay > 0) p.launchAt = now() + delay;
      if (D.separation === 'slide') p.noGravUntil = now() + delay + scaleMs(80);
      nodes.push([piece, p]); made++;
    }
    enforceCap(nodes.length, batchGpu(nodes));
    for (const [node, p] of nodes) addPiece(node, p);
    fracFinishPieces(nodes, D);
    return made;
  }
  /* §B4 `vaporise` + §B3 `ember`: applied once the pieces are live, so the trail hangs where the shard
   * actually is and the fade runs on a piece that is still being integrated. */
  function fracFinishPieces(nodes, D) {
    if (D.finish === 'ember') for (const [, p] of nodes) fracTrail(p.ox + p.cx, p.oy + p.cy);
    // §D2: the cut face flashes white for a frame at the moment the two halves actually start to move
    if (D.separation === 'slide') for (const [, p] of nodes) later(() => fracCutFlash(p), D.delayMs || 0);
    if (!(D.vaporise > 0)) return;
    for (const [, p] of nodes) if (Math.random() < D.vaporise) vaporisePiece(p);
  }
  /* §C3: once an element has already shed a corner, whatever is left of it is all there is to break — a
   * piece generated outside the remaining polygon would be a corner that fell twice. */
  function fracClipToRemain(remain, polys) {
    if (!remain || remain.length < 3) return polys;
    const out = [];
    for (const poly of polys) {
      let pts = poly.pts;
      for (let i = 0; i < remain.length && pts.length >= 3; i++) {
        const a = remain[i], b = remain[(i + 1) % remain.length];
        let nx = -(b[1] - a[1]), ny = b[0] - a[0];
        const L = Math.hypot(nx, ny); if (!(L > 1e-6)) continue;
        nx /= L; ny /= L;
        pts = fracClipHalf(pts, -nx, -ny, -(nx * a[0] + ny * a[1]));
      }
      if (pts.length >= 3 && fracArea(pts) > 4) out.push(polyInfo(pts));
    }
    return out.length ? out : polys;
  }
  /* Which side of the cut a piece's centroid is on: +1 / −1, or 0 when there is no single cut line. */
  function fracCutSide(poly, sl, curve, rect, sx, sy, hx, hy) {
    if (curve) {
      const a = { x: (curve.x1 - rect.left) / sx, y: (curve.y1 - rect.top) / sy };
      const b = { x: (curve.x2 - rect.left) / sx, y: (curve.y2 - rect.top) / sy };
      return ((b.x - a.x) * (poly.cy - a.y) - (b.y - a.y) * (poly.cx - a.x)) >= 0 ? 1 : -1;
    }
    if (sl) {
      const ux = Math.cos(sl.angle), uy = Math.sin(sl.angle);
      return (ux * (poly.cy - sl.cy) - uy * (poly.cx - sl.cx)) >= 0 ? 1 : -1;
    }
    return (poly.cx - hx) >= 0 ? 1 : -1;
  }
  /* §B1 `ash`: "큰 조각 없이 8~16px 잿조각 18~30개". These are NOT clones — a charred flake has nothing
   * left to read, and thirty cloneTrees of a card is a dropped frame. Plain jagged divs that fall, count as
   * debris, and are swept by every path that sweeps debris. */
  function spawnAshFlakes(el, rect, ix, iy, mode, n, D) {
    const mp = matPieceProps(materialOf(el));
    const made = [];
    const count = clamp(n, 1, 30);
    for (let i = 0; i < count; i++) {
      const s = rand(8, 16);
      const x = rect.left + rand(0, Math.max(1, rect.width - s));
      const y = rect.top + rand(0, Math.max(1, rect.height - s));
      const node = mk('div', 'crs-piece crs-debris crs-ash');
      node.style.left = px(x); node.style.top = px(y);
      node.style.width = px(s); node.style.height = px(s);
      node.style.background = 'rgba(38,33,29,.92)';
      node.style.clipPath = 'polygon(' + px(rand(0, s * 0.35)) + ' 0px, ' + px(s) + ' ' + px(rand(0, s * 0.4)) + ', ' + px(rand(s * 0.4, s)) + ' ' + px(s) + ', 0px ' + px(rand(s * 0.5, s)) + ')';
      node.style.transformOrigin = px(s / 2) + ' ' + px(s / 2);
      const v = velocityFor(mode, ix, iy, x + s / 2, y + s / 2, { sep: D.separation });
      made.push([node, Object.assign({ ox: x, oy: y, w: s, h: s, vx: v.vx, vy: v.vy, vr: v.vr, cx: s / 2, cy: s / 2,
        bb: { minX: 0, minY: 0, maxX: s, maxY: s }, ash: true }, mp)]);
    }
    if (!made.length) return 0;
    enforceCap(made.length, batchGpu(made));
    for (const [node, p] of made) addPiece(node, p);
    fracFinishPieces(made, D);
    return made.length;
  }
  /* §C3: the plate or corner that comes off a hit which did NOT destroy the element. One piece, cut to the
   * polygon the half-plane took away, with the element itself left standing behind it. */
  function spawnPartialPiece(el, rect, ow, oh, sx, sy, fallen, ix, iy, mode, opts) {
    if (!root || fallen.length < 3) return 0;
    const poly = polyInfo(fallen);
    const mp = matPieceProps(materialOf(el));
    const D = destructionOf(mode, opts);
    const { piece, clip } = makeWrapper(rect, ow, oh, sx, sy, poly, true);
    root.append(piece);
    const b = buildStyledClone(el, ow, oh, cloneCapFor(300), clip, null);
    if (!b) { try { piece.remove(); } catch (e) { /* ignore */ } return 0; }
    const finish = finishFilter(D.finish);
    if (finish) clip.style.filter = finish;
    const cx = rect.left + poly.cx * sx, cy = rect.top + poly.cy * sy;
    const v = velocityFor(mode, ix, iy, cx, cy, Object.assign({ sep: D.separation }, opts));
    const p = Object.assign({ ox: rect.left, oy: rect.top, w: rect.width, h: rect.height, vx: v.vx, vy: v.vy, vr: v.vr, cx: poly.cx * sx, cy: poly.cy * sy,
      bb: { minX: poly.minX * sx, minY: poly.minY * sy, maxX: poly.maxX * sx, maxY: poly.maxY * sy } }, mp);
    enforceCap(1, batchGpu([[piece, p]]));
    addPiece(piece, p);
    try { matSfx(materialOf(el), { gain: 0.32 }); } catch (e) { /* ignore */ }
    if (D.particles && D.particles !== 'none') fracParticles(D.particles, ix, iy);
    return 1;
  }

  /* --- text shattering (§12.2 / A23) --- */
  /* SPEC-material §5: word pieces only exist for text-dominant elements, which are paper by definition —
   * they sway down instead of dropping like a pane. Read once per build rather than per word. */
  function wordMatProps() { return matPieceProps('paper'); }
  const CJK_RE = /[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯豈-﫿]/;
  function graphemes(text) {
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        return Array.from(seg.segment(text), (s) => s.segment);
      }
    } catch (e) { /* fall through */ }
    return Array.from(text);
  }
  function tokenize(text, perChar) {
    const out = [];
    if (perChar) {
      let idx = 0;
      for (const g of graphemes(text)) { if (g.trim()) out.push({ s: idx, e: idx + g.length }); idx += g.length; }
      return out;
    }
    const re = /\S+/g; let m;
    while ((m = re.exec(text))) {
      const tok = m[0];
      if (tok.length >= 12 && (tok.match(CJK_RE) || []).length && !/\s/.test(tok) && CJK_RE.test(tok.slice(0, 1))) {
        let i = 0;
        const gs = graphemes(tok);
        while (i < gs.length) { const k = Math.min(gs.length - i, randInt(2, 4)); const chunk = gs.slice(i, i + k).join(''); const start = m.index + gs.slice(0, i).join('').length; out.push({ s: start, e: start + chunk.length }); i += k; }
      } else out.push({ s: m.index, e: m.index + tok.length });
    }
    return out;
  }
  function intersectRect(a, b) {
    const l = Math.max(a.left, b.left), t = Math.max(a.top, b.top), r = Math.min(a.right, b.right), btm = Math.min(a.bottom, b.bottom);
    return { left: l, top: t, right: r, bottom: btm, width: Math.max(0, r - l), height: Math.max(0, btm - t) };
  }
  function clipRectFor(el, rect) {
    const s = gcs(el);
    let clip = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    if (s) {
      clip = { left: rect.left + (parseFloat(s.borderLeftWidth) || 0), top: rect.top + (parseFloat(s.borderTopWidth) || 0),
        right: rect.right - (parseFloat(s.borderRightWidth) || 0), bottom: rect.bottom - (parseFloat(s.borderBottomWidth) || 0) };
    }
    let a = parentOf(el), guard = 0;
    while (a && a !== docEl && a !== doc.body && guard++ < 60) {
      const as = gcs(a);
      if (as && (as.overflowX !== 'visible' || as.overflowY !== 'visible')) { const ar = rectOf(a); if (ar) clip = intersectRect(clip, ar); break; }
      a = parentOf(a);
    }
    clip = intersectRect(clip, { left: 0, top: 0, right: viewW(), bottom: viewH() });
    return clip;
  }
  /* Light text (relative luminance > 0.6, alpha ≥ 0.5) — such words vanish over a light page once they leave their dark box. */
  function isLightColor(color) {
    const m = /rgba?\(([^)]+)\)/.exec(color || '');
    if (!m) return false;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || (p.length >= 4 && p[3] < 0.5)) return false;
    const lin = (c) => { c = clamp(c, 0, 255) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]) > 0.6;
  }
  /* A23 piece styling. `scaleY` = rect.height / offsetHeight of the target (≠ 1 under transform: scale /
   * html zoom ancestors): the span lives in our unscaled root, so the font metrics themselves are scaled
   * (font-size, letter-/word-spacing) instead of a transform — the physics transform (translate+rotate)
   * is rewritten every frame and would clobber a scale() anyway. */
  function styleWordPiece(span, cs, rect, scaleY) {
    const k = (isFinite(scaleY) && scaleY > 0) ? scaleY : 1;
    const len = (v) => { const n = parseFloat(v); return (k !== 1 && isFinite(n)) ? px(n * k) : v; };
    try {
      span.style.font = cs.font;
      span.style.fontStyle = cs.fontStyle; span.style.fontVariant = cs.fontVariant; span.style.fontWeight = cs.fontWeight;
      span.style.fontSize = len(cs.fontSize); span.style.fontFamily = cs.fontFamily;
      span.style.fontStretch = cs.fontStretch; span.style.fontFeatureSettings = cs.fontFeatureSettings;
      span.style.fontVariationSettings = cs.fontVariationSettings; span.style.fontOpticalSizing = cs.fontOpticalSizing;
      span.style.lineHeight = px(rect.height);
      span.style.letterSpacing = len(cs.letterSpacing); span.style.wordSpacing = len(cs.wordSpacing);
      span.style.textRendering = cs.textRendering; span.style.fontKerning = cs.fontKerning;
      span.style.color = cs.color; span.style.webkitTextFillColor = cs.webkitTextFillColor;
      span.style.textDecoration = cs.textDecoration; span.style.textDecorationColor = cs.textDecorationColor;
      span.style.textTransform = cs.textTransform;
      span.style.textShadow = (cs.textShadow === 'none' && isLightColor(cs.color)) ? '0 0 2px rgba(0,0,0,.55)' : cs.textShadow;
      span.style.webkitTextStroke = cs.webkitTextStroke;
    } catch (e) { /* ignore */ }
  }
  function spawnWordPieces(el, rect, ix, iy, mode, opts) {
    const wordMat = wordMatProps();
    const txt = (el.textContent || '').trim();
    const tag = tagOf(el);
    const len = graphemes(txt).length;
    const perChar = !opts.forceWords && ((tag === 'h1' || tag === 'h2' || tag === 'h3') || len <= 24) && len <= 60;
    const clip = clipRectFor(el, rect);
    const range = doc.createRange();
    const csCache = new Map();
    const items = [];
    const maxTokens = opts.maxTokens || 120;
    let walker;
    try { walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT); } catch (e) { return 0; }
    let node;
    while ((node = walker.nextNode()) && items.length < maxTokens) {
      const parent = node.parentElement; if (!parent) continue;
      const ptag = tagOf(parent); if (ptag === 'script' || ptag === 'style') continue;
      let cs = csCache.get(parent);
      if (!cs) { cs = gcs(parent); if (!cs) continue; csCache.set(parent, cs); }
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const text = node.data; if (!text || !text.trim()) continue;
      for (const tok of tokenize(text, perChar)) {
        if (items.length >= maxTokens) break;
        let rects;
        try { range.setStart(node, tok.s); range.setEnd(node, tok.e); rects = range.getClientRects(); } catch (e) { continue; }
        if (!rects || !rects.length) continue;
        if (rects.length === 1) { items.push({ node, s: tok.s, e: tok.e, rect: rects[0], cs }); continue; }
        // wrapped token: one piece per client rect (≤ 3), advancing the end offset character by character
        let a = tok.s, emitted = 0;
        while (a < tok.e && emitted < 3) {
          let b = a + 1, last = null;
          try {
            range.setStart(node, a); range.setEnd(node, b); last = range.getClientRects()[0];
            while (b < tok.e) { range.setEnd(node, b + 1); const rs = range.getClientRects(); if (rs.length > 1) break; b++; last = rs[0]; }
          } catch (e) { break; }
          if (last) { items.push({ node, s: a, e: b, rect: last, cs }); emitted++; }
          a = b;
        }
      }
    }
    if (!items.length) return 0;
    const sy = (el.offsetHeight && rect.height) ? rect.height / el.offsetHeight : 1;
    const scaled = Math.abs(sy - 1) > 0.02;
    const made = [];
    for (const it of items) {
      const r = it.rect;
      if (r.width <= 0 || r.height <= 0) continue;
      const vis = intersectRect(r, clip);
      if (vis.width * vis.height < 0.5 * r.width * r.height) continue;
      const clipped = vis.width < r.width - 0.5 || vis.height < r.height - 0.5;
      const span = mk('span', 'crs-debris crs-word');
      span.textContent = it.node.data.slice(it.s, it.e);
      span.style.left = px(vis.left); span.style.top = px(vis.top); span.style.width = px(vis.width); span.style.height = px(vis.height);
      styleWordPiece(span, it.cs, r, scaled ? sy : 1);
      if (clipped) span.style.overflow = 'hidden';
      if (opts.burnt) span.style.filter = BURNT_FILTER;
      const cx = vis.left + vis.width / 2, cy = vis.top + vis.height / 2;
      const v = velocityFor(mode, ix, iy, cx, cy, Object.assign({ word: true }, opts));
      const p = Object.assign({ ox: vis.left, oy: vis.top, w: vis.width, h: vis.height, vx: v.vx, vy: v.vy, vr: v.vr, cx: vis.width / 2, cy: vis.height / 2,
        bb: { minX: 0, minY: 0, maxX: vis.width, maxY: vis.height }, word: true, launchAt: now() + Math.min(v.dist, 240) / 2 }, wordMat);
      made.push([span, p]);
    }
    if (!made.length) return 0;
    enforceCap(made.length, batchGpu(made));
    for (const [span, p] of made) addPiece(span, p);
    return made.length;
  }
  function spawnFieldSpill(el, rect, ix, iy, mode, opts) {
    const wordMat = wordMatProps();
    const tag = tagOf(el);
    let value = '';
    try { value = String(el.value || ''); } catch (e) { value = ''; }
    if (!value.trim() || (tag === 'input' && el.type === 'password')) return 0;
    const cs = gcs(el); if (!cs) return 0;
    let meas;
    try { meas = doc.createElement('canvas').getContext('2d'); meas.font = cs.font || (cs.fontSize + ' ' + cs.fontFamily); } catch (e) { return 0; }
    const fontSize = parseFloat(cs.fontSize) || 14;
    const lineH = tag === 'textarea' ? (parseFloat(cs.lineHeight) || fontSize * 1.2) : fontSize * 1.2;
    const x0 = rect.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
    const xMax = rect.right - (parseFloat(cs.borderRightWidth) || 0) - (parseFloat(cs.paddingRight) || 0);
    let y = tag === 'textarea' ? rect.top + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0) : rect.top + (rect.height - lineH) / 2;
    const spaceW = meas.measureText(' ').width;
    const lines = tag === 'textarea' ? value.split('\n') : [value];
    const made = [];
    for (const line of lines) {
      if (made.length >= 40 || y + lineH > rect.bottom + 1) break;
      let x = x0;
      for (const tok of line.split(/\s+/).filter(Boolean)) {
        if (made.length >= 40) break;
        const w = meas.measureText(tok).width;
        if (x + w > xMax + 1) break;
        const span = mk('span', 'crs-debris crs-word');
        span.textContent = tok;
        span.style.left = px(x); span.style.top = px(y); span.style.width = px(w); span.style.height = px(lineH);
        styleWordPiece(span, cs, { height: lineH }, 1);
        if (opts && opts.burnt) span.style.filter = BURNT_FILTER;
        const v = velocityFor(mode, ix, iy, x + w / 2, y + lineH / 2, { word: true });
        made.push([span, Object.assign({ ox: x, oy: y, w, h: lineH, vx: v.vx, vy: v.vy, vr: v.vr, cx: w / 2, cy: lineH / 2, bb: { minX: 0, minY: 0, maxX: w, maxY: lineH }, word: true, launchAt: now() + Math.min(v.dist, 240) / 2 }, wordMat)]);
        x += w + spaceW;
      }
      y += lineH;
    }
    if (!made.length) return 0;
    enforceCap(made.length, batchGpu(made));
    for (const [span, p] of made) addPiece(span, p);
    return made.length;
  }

  function breakElement(el, ix, iy, opts) {
    opts = opts || {};
    const mode = opts.mode || WEAPONS[state.weapon].kind;
    if (!el || !el.isConnected || el.hasAttribute('data-crs-broken')) return false;
    /* SPEC-destruction §F4: "연소 중에 파괴된 요소는 **무엇에 맞아 죽었든** ash 조각 + char 마감으로
     * 부서진다." destructionOf() already answers `flame` for opts.burnt, so the ledger is asked here —
     * the one place every break passes through — rather than at each of the ten weapons. */
    if (!opts.burnt && burnEstablished(el)) opts.burnt = true;
    cancelAnimsOf(el);
    /* SPEC-destruction §C3: an element that had already shed a corner gets its own `clip-path` back BEFORE
     * anything is cloned off it — otherwise every piece would carry the remaining shape as a second clip. */
    const freed = releasePartial(el);
    if (freed && freed.cuts > 0) opts.remain = freed.poly;
    const rect = rectOf(el);
    if (!rect || rect.width < 1 || rect.height < 1) return false;
    const t0 = now();
    const tag = tagOf(el);
    const descendants = countDescendants(el, textDescendantCap() + 1);   // SPEC-settings §2.2: 200, 120 in performance mode
    const wantText = opts.textSplit !== false && textDominant(el);
    const D = destructionOf(mode, opts);
    // §B1 `strip`: the bands run across the line the holes are strung along — §B5's hit direction
    if (opts.markAngle == null) { const a = fracHitAngle(state.weapon, ix, iy); if (a != null) opts.markAngle = a; }
    let made = 0;
    if (tag === 'video') { try { opts.wasPlaying = !el.paused; el.pause(); } catch (e) { /* ignore */ } }
    if (wantText) {
      // box (background/border) falls as one piece underneath; words fall on top
      if (boxVisible(el)) made += spawnGeometric(el, rect, ix, iy, mode, 1, Object.assign({}, opts, { textTransparent: true }));
      const words = spawnWordPieces(el, rect, ix, iy, mode, opts);
      if (!words && !made) made += spawnGeometric(el, rect, ix, iy, mode, fracPieceCount(el, mode, rect, descendants, opts), opts);
      made += words;
    } else {
      made += spawnGeometric(el, rect, ix, iy, mode, fracPieceCount(el, mode, rect, descendants, opts), opts);
      if ((tag === 'input' || tag === 'textarea')) made += spawnFieldSpill(el, rect, ix, iy, mode, opts);
    }
    // §B3: the puff the weapon itself throws off, on top of the material's own (matBurst below)
    if (D.particles && D.particles !== 'none') fracParticles(D.particles, ix, iy);
    /* SPEC-material §5 / SPEC-destruction §1: the break SOUNDS and PUFFS like what it was made of, and the
     * element's damage decal dies with it — the marks are on the falling pieces now, not on a sheet of
     * glass left hanging in front of the hole. */
    const matId = materialOf(el);
    dropDecal(el);
    try { matSfx(matId, { gain: 0.5 }); } catch (e) { /* ignore */ }
    try { matBurst(matId, ix, iy); } catch (e) { /* ignore */ }
    // hide the original in the same synchronous task (A17)
    const rec = hideOriginal(el);
    rec.wasPlaying = !!opts.wasPlaying;
    state.lastBreakMs = now() - t0;
    state.lastBreakPieces = made;
    // v1.2 A8 / A10: the single kill hook — hostile → kill (score max / ×1.5 clutch), else round(max/4) while combat is on
    try {
      const max = hpOf(el).max;
      if (state.hostiles.has(el)) hostileKilled(el, max);
      else if (state.combat) { state.player.score += Math.round(max / 4); updatePlayerHud(); }
    } catch (e) { state.lastError = String((e && e.stack) || e); }
    /* SPEC-combat §C3: everything above this element just got weaker by 0.6 × what it was worth — and an
     * ancestor that was already hurt that much goes down with it. Runs AFTER hideOriginal(), so a recount
     * started from up there can no longer see what has just left. */
    try { hpDescendantBroken(el, ix, iy, mode); } catch (e) { state.lastError = String((e && e.stack) || e); }
    kick();
    return made > 0;
  }

  /* --- durability / damage reactions (A22) --- */
  function reactDamage(el, ix, iy, rect) {
    const s = gcs(el); if (!s) return;
    if (s.display === 'inline' || s.display.startsWith('table-')) return;
    let all = [];
    try { all = el.querySelectorAll('*'); } catch (e) { all = []; }
    if (all.length > 200) return;
    for (let i = 0; i < all.length; i++) { const ps = gcs(all[i]); if (ps && (ps.position === 'fixed' || ps.position === 'sticky')) return; }
    cancelAnimsOf(el);
    const tag = tagOf(el);
    const dent = FORM_TAGS.has(tag) || tag === 'summary' || el.getAttribute('role') === 'button';
    try {
      let a;
      if (dent) {
        const rz = (Math.random() < 0.5 ? -2 : 2);
        a = el.animate([{ transform: 'scale(1) rotate(0deg)' }, { transform: 'scale(.93) rotate(' + rz + 'deg)' }, { transform: 'scale(1) rotate(0deg)' }], { duration: 180, composite: 'add', easing: 'ease-out' });
      } else {
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        let dx = ix - cx, dy = iy - cy; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
        const amp = clamp(0.02 * Math.sqrt(rect.width * rect.height), 3, 10);
        const rotA = 1.5 * Math.min(1, 240 / Math.max(rect.width, rect.height, 1));
        const offs = [1, -0.6, 0.3, -0.12, 0];
        const kf = offs.map((k, i) => ({ transform: 'translate(' + px(dx * amp * k) + ', ' + px(dy * amp * k) + ') rotate(' + (i === 4 ? 0 : (i % 2 ? -rotA : rotA)).toFixed(2) + 'deg)', easing: 'ease-out' }));
        a = el.animate(kf, { duration: 260, composite: 'add' });
      }
      trackAnim(a);
    } catch (e) { /* ignore */ }
  }
