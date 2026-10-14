  /* ===================================================================== */
  /* 10. Pieces, physics state, eviction                                      */
  /* ===================================================================== */
  function velocityFor(mode, ix, iy, cx, cy, opts) {
    const dx = cx - ix, dy = cy - iy, dist = Math.hypot(dx, dy);
    const s = Math.sign(dx) || (Math.random() < 0.5 ? -1 : 1);
    let vx, vy, vr;
    /* SPEC-destruction §B2: the weapon's own separation (implode · cleave · slide · burst · drop) answers
     * first; `radial` and everything with no profile fall through to the v1 behaviour below, unchanged. */
    const sep = opts && opts.sep;
    if (sep && sep !== 'radial') {
      const v = fracSeparation(sep, ix, iy, cx, cy, opts);
      if (v) { if (opts && opts.word) { const k = 1 + 0.6 * (1 - Math.min(dist, 200) / 200); v.vx *= k; v.vy *= k; } v.dist = dist; return v; }
    }
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
  let pieceSeq = 0;   // v1.4 §9.3: per-session piece ids for debug.pieceBoxes() below
  function debrisCount() {
    let n = 0;
    for (const p of state.pieces) if (!p.chip) n++;
    return n;
  }
  /* ── SPEC-material §4: the rubble belongs to the PAGE, not to the screen ──────────────────────────────
   * A piece's ox/oy are expressed in its own anchor frame, named once at spawn by `p.docAnchor`:
   *   document (the default)  ox/oy are DOCUMENT coordinates and p.sx/p.sy hold the scroll the frame was
   *                           captured at, so the floor it falls to — `p.sy + viewH()` — is the document
   *                           position the viewport bottom had AT SPAWN, exactly as §4 asks. Scroll down
   *                           and the pile near the top rides up out of view.
   *   viewport                p.sx = p.sy = 0, so every term below collapses to the pre-§4 H / 0 / W and
   *                           the old behaviour is bit-for-bit intact.
   * The node keeps the `left`/`top` it was born with; only the translate carries the scroll delta, so a
   * scroll costs ONE transform write per piece — no layout, no second RAF loop, no per-piece listener. */
  let scrollReadAt = -1e9;
  function readScroll(force) {
    /* Reading window.scrollY can flush layout, and addPiece() runs in batches of dozens with a style write
     * between every call — so the un-forced reading is throttled to once per 4 ms. Everything that must be
     * exact (the frame loop, the scroll handler, the public readers) passes force. */
    const t = now();
    if (!force && t - scrollReadAt < 4) return state.scrollY;
    scrollReadAt = t;
    try {
      state.scrollX = win.scrollX || win.pageXOffset || 0;
      state.scrollY = win.scrollY || win.pageYOffset || 0;
    } catch (e) { /* keep the previous reading */ }
    return state.scrollY;
  }
  /* Two different deltas, and they are NOT the same number — keep them apart:
   *  trackDx/trackDy  what the TRANSFORM must carry. The node's left/top is the viewport spot the piece was
   *                   born at, so the translate has to make up the page travel since: p.sx - scrollNow.
   *  viewOx/viewOy    the piece's origin ON SCREEN. ox/oy are document coordinates for a document-anchored
   *                   piece, so getting to the viewport is a plain subtraction of the live scroll.
   * Both collapse to the pre-§4 identity for a viewport-anchored piece (p.sx = p.sy = 0). */
  function trackDx(p) { return p.docAnchor ? p.sx - state.scrollX : 0; }
  function trackDy(p) { return p.docAnchor ? p.sy - state.scrollY : 0; }
  function viewOx(p) { return p.docAnchor ? p.ox - state.scrollX : p.ox; }
  function viewOy(p) { return p.docAnchor ? p.oy - state.scrollY : p.oy; }
  /* Where a piece is ON SCREEN right now. stats() and debug.pieceBoxes() report this, so every reader
   * outside the integrator keeps seeing viewport numbers exactly as it did before §4. */
  function pieceBox(p) {
    const ox = viewOx(p), oy = viewOy(p);
    return { l: ox + p.x + p.bb.minX, r: ox + p.x + p.bb.maxX, top: oy + p.y + p.bb.minY, bottom: oy + p.y + p.bb.maxY };
  }
  /* The ONE passive scroll handler (src/95-events.js) lands here. It rewrites transforms and nothing else:
   * scrolling a page is not an impulse, so a piece that has come to rest stays resting. */
  function anchorPieces() {
    readScroll(true);
    for (const p of state.pieces) if (p.docAnchor) applyTransform(p);
  }
  /* SPEC-material §4: the anchor is a persisted setting. Flipping it while rubble is on the floor re-frames
   * every live piece WITHOUT moving it on screen — ox/oy and x/y change together so the rendered position is
   * identical on both sides of the switch. */
  function setDebrisAnchor(v, silent) {
    const want = v === 'viewport' ? 'viewport' : (v === 'document' ? 'document' : null);
    if (!want) return state.debrisAnchor;
    if (want !== state.debrisAnchor) {
      state.debrisAnchor = want;
      readScroll(true);
      const toDoc = want === 'document';
      for (const p of state.pieces) {
        if (!!p.docAnchor === toDoc) continue;
        if (toDoc) { p.sx = state.scrollX; p.sy = state.scrollY; p.ox += p.sx; p.oy += p.sy; p.docAnchor = true; }
        else { p.x += p.sx - state.scrollX; p.y += p.sy - state.scrollY; p.ox -= p.sx; p.oy -= p.sy; p.sx = 0; p.sy = 0; p.docAnchor = false; }
        applyTransform(p);
      }
    }
    if (!silent) safe(() => chrome.storage.sync.set({ crsDebrisAnchor: want }));
    return state.debrisAnchor;
  }
  function addPiece(node, p) {
    const t = now();
    const dpr = Math.min(win.devicePixelRatio || 1, 2);
    p.node = node; p.x = 0; p.y = 0; p.rot = 0; p.resting = false; p.grounded = false;
    p.pid = ++pieceSeq;   // v1.4 §9.3: stable identity, so a test can follow ONE piece across an eviction
    p.bornAt = t; if (p.launchAt == null) p.launchAt = t;
    p.tilt = rand(-12, 12);
    p.gpu = p.w * p.h * dpr * dpr;
    p.big = p.w * p.h > 200000;
    /* SPEC-material §4: adopt the anchor frame BEFORE anything else reads ox/oy. The callers hand ox/oy in
     * viewport coordinates; a document-anchored piece carries the spawn scroll from here on. */
    readScroll();
    p.docAnchor = state.debrisAnchor !== 'viewport';
    p.sx = p.docAnchor ? state.scrollX : 0; p.sy = p.docAnchor ? state.scrollY : 0;
    p.ox += p.sx; p.oy += p.sy;
    // clip the AABB to the viewport at spawn (A12) — the viewport edges in the piece's own frame
    const W = viewW(), H = viewH();
    p.bb = { minX: Math.max(p.bb.minX, p.sx - p.ox), minY: Math.max(p.bb.minY, p.sy - p.oy), maxX: Math.min(p.bb.maxX, p.sx + W - p.ox), maxY: Math.min(p.bb.maxY, p.sy + H - p.oy) };
    if (p.bb.maxX < p.bb.minX) p.bb.maxX = p.bb.minX; if (p.bb.maxY < p.bb.minY) p.bb.maxY = p.bb.minY;
    node.style.willChange = p.big ? 'auto' : 'transform';
    node.style.contain = 'layout paint';
    node.style.transform = 'translate(0px, 0px) rotate(0deg)';
    const area = (p.bb.maxX - p.bb.minX) * (p.bb.maxY - p.bb.minY);
    const shadow = (!p.word && area > 2500) ? 'drop-shadow(0 3px 4px rgba(0,0,0,.35))' : '';
    /* SPEC-material §5: the material's own sheen (glass rims, metal's cold edge, a panel's paper-white lip)
     * rides the SAME filter chain as the drop shadow, so the flash animation below still composites both. */
    const base = [shadow, p.matFilter || ''].filter(Boolean).join(' ');
    if (base) node.style.filter = base;
    if (!node.isConnected) root.append(node);
    try {
      trackAnim(node.animate([{ filter: (base ? base + ' ' : '') + 'brightness(1.7)' }, { filter: (base ? base + ' ' : '') + 'brightness(1)' }], { duration: 90, easing: 'ease-out' }));
    } catch (e) { /* ignore */ }
    // v1.4 §9.1: a piece that is still flying has no lifetime; the hard cut-off only stops one escaping forever
    p.expireAt = 0; p.restedFirstAt = 0; p.jitter = null; p.hardExpireAt = t + DEBRIS_HARD_MS;
    state.pieces.push(p); state.gpuSum += p.gpu;
    scheduleDebrisSweep();
    return p;
  }
  function applyTransform(p) {
    // SPEC-material §4: the node's left/top is where the piece was BORN on screen; the delta rides the translate
    const tx = p.x + trackDx(p), ty = p.y + trackDy(p);
    p.node.style.transform = 'translate(' + tx.toFixed(2) + 'px, ' + ty.toFixed(2) + 'px) rotate(' + p.rot.toFixed(2) + 'deg)';
  }
  function restPiece(p) {
    p.resting = true; p.grounded = true; p.vx = 0; p.vy = 0; p.vr = 0;
    p.rot = Math.round(p.rot / 180) * 180 + p.tilt;
    applyTransform(p);
    p.node.style.willChange = 'auto'; p.node.style.contain = 'strict';
    /* v1.4 §9.1: the clock starts the moment the piece FIRST settles, jittered so a whole wall does not blink
      * out at once. First, not latest: §9.3 wakes whatever was stacked on a piece that just despawned, and
      * restarting the clock on every re-settle would make a tall pile take a multiple of the lifetime to clear. */
    const life = debrisLife();
    if (!p.restedFirstAt) p.restedFirstAt = now();
    if (p.jitter == null) p.jitter = rand(-DEBRIS_JITTER, DEBRIS_JITTER);
    p.expireAt = life > 0 ? p.restedFirstAt + life + p.jitter : 0;
    scheduleDebrisSweep();
  }
  function wakePiece(p) {
    if (!p.resting) return;
    p.resting = false; p.grounded = false; p.vy = 0;
    p.expireAt = 0;   // v1.4 §9.1: knocked loose again, so it is flying again and its lifetime is off
    p.node.style.willChange = p.big ? 'auto' : 'transform'; p.node.style.contain = 'layout paint';
  }
  /* ── v1.4 §9.3: the support relation, read in the product's own geometry ──
   * restPiece() snaps a chip to a random ±12° tilt, so its DOM bounding box is the axis-aligned hull of a
   * rotated rectangle — several pixels taller than the chip itself. Asking "is B resting on A?" from
   * getBoundingClientRect() therefore misses real pairs at random. evictPieces() wakes a piece from
   * p.ox/p.x/p.bb, and this hook hands a test exactly those numbers plus a stable per-piece id, so the
   * §9.4.4 check can follow one identified piece across the eviction of the piece under it. */
  debug.pieceBoxes = () => {
    readScroll(true);   // SPEC-material §4: ox/oy are anchor-frame, so report what is actually on screen
    return state.pieces.map((p) => {
      const b = pieceBox(p);
      /* SPEC-destruction §B/§C add `w`/`h` (the piece's own size, which never changes) and `cx`/`cy` (the
       * centre it was BORN at). A reader comparing "the cell the blast went off in" with a far one, or the
       * average distance of imploding debris, must not be fooled by how far each piece has since flown. */
      /* evictPieces() decides what an eviction knocks loose in the piece's OWN anchor frame (p.ox/p.oy, no
       * scroll applied), while l/r/top/bottom above are viewport boxes. For one anchor the two differ by a
       * constant and relative comparisons agree, but a reader asking "would this eviction wake that piece?"
       * should ask in the frame the product answers in — so the raw numbers are published too. */
      return { pid: p.pid, resting: !!p.resting, anchor: p.docAnchor ? 'document' : 'viewport', l: b.l, r: b.r, top: b.top, bottom: b.bottom,
        rawL: p.ox + p.x + p.bb.minX, rawR: p.ox + p.x + p.bb.maxX, rawTop: p.oy + p.y + p.bb.minY, rawBottom: p.oy + p.y + p.bb.maxY,
        w: p.bb.maxX - p.bb.minX, h: p.bb.maxY - p.bb.minY, cx: viewOx(p) + p.cx, cy: viewOy(p) + p.cy, chip: !!p.chip, ash: !!p.ash,
        vx: p.vx, vy: p.vy, vr: p.vr, rot: p.rot };
    });
  };
  /* Retire ONE identified piece on the next sweep, as if its §9.1 lifetime had just run out. §9.4.1 already
   * covers the clock; this is how §9.3's "wake whatever was stacked on it" is checked without the pieces above
   * expiring in the very same batch. */
  debug.expirePiece = (pid) => {
    for (const p of state.pieces) {
      if (p.pid !== pid) continue;
      p.expireAt = now() - 1;
      p.hardExpireAt = p.expireAt;
      scheduleDebrisSweep();
      return pid;
    }
    return null;
  };
  /* ── v1.4 §9: debris stops piling up ──
   * The floor used to fill with debris that only the 160-piece cap or a manual restore ever cleared. Now a piece
   * that has come to rest fades out after `debrisLifeMs` (0 = the old behaviour), while the original stays hidden
   * — the page is NOT put back, only the litter is taken away. Under memory pressure a lifetime of "forever" is
   * still capped, because that is exactly when the floor is fullest. */
  function debrisLife() {
    const pressure = state.pieces.length > pieceCap() * 0.75 || state.gpuSum > GPU_BUDGET * 0.75;
    const want = state.debrisLifeMs;
    // SPEC-test-speed §3: "파편 수명" — expireAt is a timestamp comparison, not a later(), so it needs the scale
    // of its own. 0 means "unlimited" and scaleMs(0) is 0, so that branch keeps its meaning.
    if (pressure) return scaleMs(want > 0 ? Math.min(want, DEBRIS_PERF_MS) : DEBRIS_PERF_MS);
    return scaleMs(want);
  }
  function scheduleDebrisSweep() {
    if (state.debrisTimer || !state.active) return;
    state.debrisTimer = later(debrisSweep, DEBRIS_SWEEP_MS);
  }
  function debrisSweep() {
    state.debrisTimer = 0;
    if (!state.active || !state.pieces.length) return;
    const t = now();
    const victims = [], lost = [];
    /* SPEC-material §4: rubble the page has been scrolled away from is retired here rather than integrated,
     * frame after frame, for nobody. The margin is a whole viewport past each edge (and never less than
     * 1200 px), so debris that is merely just-off-screen — one flick of the wheel from being seen again —
     * is kept. Only a document-anchored piece can ever leave the screen. It goes SILENTLY (there is no one
     * to watch it fade) and without the support pass: the pile it was part of is off-screen with it, so
     * nothing visible is standing on it. */
    readScroll(true);
    const vh = viewH(), margin = Math.max(1200, vh);
    for (const p of state.pieces) {
      if (victims.length + lost.length >= DEBRIS_BATCH) break;   // §9.1: at most twelve at a time, so no frame carries them all
      if (p.docAnchor) {
        const b = pieceBox(p);
        if (b.bottom < -margin || b.top > vh + margin) { lost.push(p); continue; }
      }
      if ((p.expireAt && t >= p.expireAt) || (p.hardExpireAt && t >= p.hardExpireAt)) victims.push(p);
    }
    if (lost.length) evictPieces(lost, true, { noWake: true });
    if (victims.length) evictPieces(victims, false, { dur: DEBRIS_FADE_MS, shrink: true });
    scheduleDebrisSweep();
  }
  /* opts (v1.4 §9.1): { dur, shrink } — a lifetime expiry fades over 500 ms AND shrinks to 0.88. The scale is a
   * separate composite:'add' animation so it stacks onto the inline translate/rotate instead of replacing it.
   * SPEC-material §4 adds { noWake }: skip the support pass for rubble that left the screen rather than the pile. */
  function evictPieces(victims, silent, opts) {
    if (!victims.length) return;
    const dur = (opts && opts.dur) || 350;
    const shrink = !!(opts && opts.shrink);
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
        const a = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: 'ease-in', fill: 'forwards' });
        trackAnim(a); a.addEventListener('finish', kill); a.addEventListener('cancel', kill);
        if (shrink && !reducedMotion()) trackAnim(node.animate([{ transform: 'scale(1)' }, { transform: 'scale(.88)' }], { duration: dur, easing: 'ease-in', fill: 'forwards', composite: 'add' }));
      } catch (e) { /* ignore */ }
      later(kill, dur + 150);
    }
    // wake resting pieces that were supported by an evicted piece (A1)
    if (opts && opts.noWake) { kick(); return; }
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
  /* SPEC-destruction §B4 `vaporise`: that share of a blast's debris never lands — it fades out over
   * 400–700 ms WHILE STILL IN THE AIR, which is what stops a rocket from burying the page in rubble. The
   * piece keeps being integrated the whole time; only its opacity is animated, and the node goes silently
   * at the end (there is nothing left to watch fade a second time). */
  function vaporisePiece(p) {
    if (!p || !p.node) return;
    p.vapour = true;
    const dur = rand(400, 700);
    try { trackAnim(p.node.animate([{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], { duration: dur, easing: 'ease-in', fill: 'forwards' })); } catch (e) { /* ignore */ }
    later(() => { if (state.pieces.indexOf(p) >= 0) evictPieces([p], true); }, dur);
  }
  /* GPU cost (w·h·dpr², as addPiece charges it) of a batch of [node, p] pairs about to be added. */
  function batchGpu(nodes) {
    const dpr = Math.min(win.devicePixelRatio || 1, 2);
    let s = 0;
    for (const [, p] of nodes) s += p.w * p.h * dpr * dpr;
    return s;
  }
  function enforceCap(incoming, incomingGpu) {
    let need = state.pieces.length + incoming - pieceCap();   // SPEC-settings §1.2 debrisCap / §2.2 min(setting, 80)
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
