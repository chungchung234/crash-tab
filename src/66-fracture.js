  /* ===================================================================== */
  /* 10.4 Fracture — SPEC-destruction §A–§D                                  */
  /*                                                                        */
  /* Three things live here and they are one idea: WHERE a thing was hit      */
  /* decides what is left of it.                                             */
  /*   §A  the weapon-specific mark that accumulates on the element's decal   */
  /*   §B  the per-weapon destruction profile (shape · separation · finish ·  */
  /*       particles · delay · vaporise) every break is cut from              */
  /*   §C  the hit ZONE (corner / edge / centre) and partial destruction —    */
  /*       a corner hit sheds a corner and the element stays up               */
  /*   §D  the katana's curve: the Bézier a drag really drew                  */
  /*                                                                         */
  /* §E (폭발 교정) and §F (연소) are NOT here — they are the next step's.     */
  /* ===================================================================== */

  /* ── §B4: the destruction table ────────────────────────────────────────────
   * Merged INTO WEAPONS (the one-line-per-weapon table in 00-prelude.js stays as it was), exactly the way
   * WEAPON_STATS is merged in src/71-weapon-helpers.js. Every field is read by real play code below. */
  const DESTRUCTION = {
    hammer:   { shape: 'wedge', separation: 'radial',  finish: 'none',   particles: 'dust',  delayMs: 0,   vaporise: 0 },
    pistol:   { shape: 'wedge', separation: 'implode', finish: 'none',   particles: 'spark', delayMs: 0,   vaporise: 0 },
    smg:      { shape: 'strip', separation: 'radial',  finish: 'none',   particles: 'spark', delayMs: 0,   vaporise: 0 },
    sniper:   { shape: 'half',  separation: 'radial',  finish: 'none',   particles: 'spark', delayMs: 0,   vaporise: 0 },
    axe:      { shape: 'half',  separation: 'cleave',  finish: 'none',   particles: 'dust',  delayMs: 60,  vaporise: 0 },
    katana:   { shape: 'half',  separation: 'slide',   finish: 'none',   particles: 'none',  delayMs: 140, vaporise: 0 },
    bomb:     { shape: 'wedge', separation: 'burst',   finish: 'scorch', particles: 'smoke', delayMs: 0,   vaporise: 0.15 },
    rocket:   { shape: 'shard', separation: 'burst',   finish: 'ember',  particles: 'smoke', delayMs: 0,   vaporise: 0.30 },
    flame:    { shape: 'ash',   separation: 'drop',    finish: 'char',   particles: 'ash',   delayMs: 0,   vaporise: 0.25 },
    collapse: { shape: 'slab',  separation: 'drop',    finish: 'none',   particles: 'dust',  delayMs: 0,   vaporise: 0 }
  };
  for (const id of WEAPON_IDS) WEAPONS[id].destruction = DESTRUCTION[id];
  /* §B3 finish filters. `ember` is char plus the 350 ms tail spawned in spawnGeometric(). */
  const FINISH_FILTER = { scorch: 'brightness(.82) saturate(.75)', char: 'brightness(.45) sepia(.65)', ember: 'brightness(.45) sepia(.65)' };
  function finishFilter(id) { return FINISH_FILTER[id] || ''; }

  /* breakElement() is handed a `mode` (the v1 kind vocabulary), not a weapon id — applyHit() and the
   * collapse chain both speak kinds. The weapon in hand answers for the profile whenever its own kind
   * matches what landed; anything else falls back to the kind's representative weapon. A break the FIRE
   * finished is ash whatever is in hand (§B4 / §F4). */
  function destructionOf(mode, opts) {
    if (opts && opts.burnt) return DESTRUCTION.flame;
    const W = WEAPONS[state.weapon];
    if (W && W.kind === mode && DESTRUCTION[state.weapon]) return DESTRUCTION[state.weapon];
    if (mode === 'bomb') return DESTRUCTION.bomb;
    if (mode === 'collapse') return DESTRUCTION.collapse;
    if (mode === 'gun') return DESTRUCTION.pistol;
    return DESTRUCTION.hammer;
  }

  /* ===================================================================== */
  /* Polygon plumbing (§C3 Sutherland–Hodgman, one half-plane at a time)     */
  /* ===================================================================== */
  /* Keep the side `nx·x + ny·y <= d`. One half-plane is all §C3 ever needs ("타격 1회 = 반평면 절단 1회"),
   * it always returns a valid polygon, and the discarded side is the same call with the normal flipped. */
  function fracClipHalf(pts, nx, ny, d) {
    const out = [], n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const da = nx * a[0] + ny * a[1] - d, db = nx * b[0] + ny * b[1] - d;
      if (da <= 0) out.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  }
  function fracArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
    return Math.abs(a) / 2;
  }
  function fracProj(pts, nx, ny) {
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { const v = nx * p[0] + ny * p[1]; if (v < lo) lo = v; if (v > hi) hi = v; }
    return { lo, hi };
  }

  /* ===================================================================== */
  /* §B1 shapes                                                             */
  /* ===================================================================== */
  /* Parallel bands with normal (nx, ny): `n` slabs cut across the sheet, the cut lines leaning 30 % of the
   * way toward the impact (§C4's rule, applied to strips as well as to the blast grid). */
  function fracBands(w, h, nx, ny, n, hxp, hyp) {
    const rect = [[0, 0], [w, 0], [w, h], [0, h]];
    const { lo, hi } = fracProj(rect, nx, ny);
    const span = hi - lo;
    if (!(span > 1) || n <= 1) return [polyInfo(rect)];
    const hf = clamp((nx * hxp + ny * hyp - lo) / span, 0, 1);
    const cuts = [];
    for (let i = 1; i < n; i++) {
      const f = i / n;
      cuts.push(lo + span * clamp(f + (hf - f) * 0.3 + rand(-0.04, 0.04), 0.04, 0.96));
    }
    cuts.sort((a, b) => a - b);
    const out = [];
    let cur = rect;
    for (const d of cuts) {
      if (cur.length < 3) break;
      const front = fracClipHalf(cur, nx, ny, d);
      const back = fracClipHalf(cur, -nx, -ny, -d);
      if (front.length >= 3 && fracArea(front) > 1) out.push(front);
      cur = back;
    }
    if (cur.length >= 3 && fracArea(cur) > 1) out.push(cur);
    return (out.length ? out : [rect]).map(polyInfo);
  }
  /* §B1 `wedge`: 4–6 radial wedges straight out of the impact point. */
  function fracWedges(w, h, cx, cy, n) {
    const a0 = rand(0, Math.PI * 2), angles = [];
    for (let i = 0; i < n; i++) angles.push(a0 + (i / n) * Math.PI * 2 + rand(-0.5, 0.5) * (Math.PI / n));
    return pieSplit(w, h, cx, cy, angles);
  }

  /* ── §B5: which way the hit came from ─────────────────────────────────────
   * Guns fire from the aim origin toward the impact; the axe swings near-vertically; a blast pushes out from
   * its centre; hammer / collapse / flame have no direction at all. INTERPRETATION (reported): fireAxe()
   * rolls its own 90° ± 15° swing inside src/76-weapon-fire.js and does not publish it, so the axe's MARK
   * re-rolls the same distribution rather than reading the exact swing of that one blow. */
  function fracHitAngle(id, x, y) {
    if (id === 'pistol' || id === 'smg' || id === 'sniper') {
      const o = aimOrigin();
      const dx = x - o.x, dy = y - o.y;
      return (Math.abs(dx) + Math.abs(dy) > 1) ? Math.atan2(dy, dx) : Math.PI / 2;
    }
    if (id === 'axe') return (90 + rand(-15, 15)) * DEG;
    if (id === 'katana') return fracCurve ? fracCurveAngle(fracCurve, 0.5) : null;
    return null;
  }

  /* ── the piece budget (§B1 counts, under the v1 cost guards) ──────────────
   * pieceCount() still answers "how much can this element afford?" — it is the clone cost that makes a
   * break expensive, and a 1 500 × 900 section cloned six times is a dropped frame. The SHAPE says how many
   * it wants; the budget caps it. Ash is exempt: flakes are plain divs, not clones (see spawnAshFlakes). */
  function fracPieceCount(el, mode, rect, descendants, opts) {
    const base = pieceCount(el, mode, rect, descendants, opts.pieces);
    if (opts.pieces != null) return base;                       // explicit override (axe / katana / collapse / tests)
    const D = destructionOf(mode, opts);
    if (D.shape === 'half') return 2;                           // §B1: exactly two, whatever the element costs
    let want;
    if (D.shape === 'ash') want = randInt(18, 30);
    else if (D.shape === 'shard') want = 7;                     // 3 × 2 grid + the impact cell halved — see fracPolys
    else if (D.shape === 'strip') want = randInt(3, 5);
    else if (D.shape === 'slab') want = randInt(1, 2);
    else want = randInt(4, 6);                                  // wedge
    if (perfOn()) want = Math.max(1, Math.round(want / 2));     // SPEC-settings §2.2
    if (D.shape === 'ash') return want;
    if (base <= 1) return Math.min(want, 2);
    if (base <= 2) return Math.min(want, 4);
    return want;
  }
  /* The one entry point breakElement() cuts every element with. Local (offset-box) coordinates throughout —
   * the same frame `clip-path` and makeWrapper() use. */
  function fracPolys(shape, w, h, hx, hy, n, splitLine, opts) {
    if (w < 2 || h < 2 || n <= 1) return [polyInfo([[0, 0], [w, 0], [w, h], [0, h]])];
    const cx = clamp(hx, 4, Math.max(4, w - 4)), cy = clamp(hy, 4, Math.max(4, h - 4));
    if (shape === 'half') return splitRect(w, h, 2, hx, hy, splitLine || { angle: rand(0, Math.PI * 2), cx, cy });
    if (shape === 'slab') return fracBands(w, h, 0, 1, n, cx, cy);
    if (shape === 'strip') {
      const a = (opts && isFinite(opts.markAngle)) ? opts.markAngle : 0;   // the line the holes are strung along
      return fracBands(w, h, Math.cos(a), Math.sin(a), n, cx, cy);
    }
    if (shape === 'shard') return gridSplit(w, h, 3, 2, cx, cy);
    return fracWedges(w, h, cx, cy, n);
  }

  /* ===================================================================== */
  /* §B2 separation — the velocity a piece leaves with                       */
  /* ===================================================================== */
  /* velocityFor() (src/65-pieces.js) calls this when `opts.sep` is set; everything else keeps the v1 radial
   * behaviour verbatim. Returns { vx, vy, vr } or null for "use radial". */
  function fracSeparation(sep, ix, iy, cx, cy, opts) {
    const dx = cx - ix, dy = cy - iy, dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    if (sep === 'implode') {
      /* §B2: sucked toward the last bullet hole for 90 ms, then gravity takes over. The speed is the one
       * that covers the distance in that window, so a piece born 20 px out does not rocket across the page. */
      const sp = clamp(dist / 0.09, 150, 1200);
      return { vx: -ux * sp, vy: -uy * sp - 40, vr: rand(-160, 160) };
    }
    if (sep === 'burst') {
      const sp = rand(600, 1100);
      return { vx: ux * sp, vy: uy * sp - 240, vr: rand(-620, 620) };
    }
    if (sep === 'drop') {
      /* §B2: almost no sideways speed, tipping INWARD as it goes down. */
      return { vx: -ux * rand(10, 40), vy: -rand(0, 60), vr: -Math.sign(ux || 1) * rand(30, 90) };
    }
    if (sep === 'cleave') {
      /* §B2: the two halves turn in OPPOSITE directions about the axis above the cut — a split log.
       * `opts.side` is +1 / −1, handed in by spawnGeometric from which side of the cut the piece is on. */
      const s = opts && opts.side ? opts.side : (ux >= 0 ? 1 : -1);
      return { vx: s * rand(130, 260), vy: -rand(140, 300), vr: s * rand(240, 430) };
    }
    if (sep === 'slide') {
      /* §D2: after `delayMs` the halves slide along the CUT TANGENT at 170–230 px/s. `opts.tangent` is the
       * slash direction, so the travel stays inside §G's ±25° of the cut. */
      const a = (opts && isFinite(opts.tangent)) ? opts.tangent : Math.atan2(uy, ux);
      const s = opts && opts.side ? opts.side : 1;
      const sp = rand(170, 230);
      return { vx: Math.cos(a) * sp * s, vy: Math.sin(a) * sp * s, vr: s * rand(20, 60) };
    }
    return null;
  }

  /* ===================================================================== */
  /* §B3 particles — one shared pool for every weapon                        */
  /* ===================================================================== */
  const FRAG_CAP = 60, FRAG_CAP_PERF = 30;        // §B3: 전체 상한 60, 성능 모드 절반
  const FRAG_KIND = {
    dust:  { n: [6, 10], size: [5, 12], rise: [10, 26], life: [420, 700], color: 'rgba(206,202,192,.70)', round: true,  blur: 1.6 },
    smoke: { n: [7, 12], size: [16, 34], rise: [26, 60], life: [620, 950], color: 'rgba(64,60,56,.52)',   round: true,  blur: 4 },
    spark: { n: [5, 9],  size: [2, 4],  rise: [-6, 14], life: [180, 320], color: 'rgba(255,224,150,.95)', round: false, blur: 0 },
    ash:   { n: [8, 14], size: [3, 7],  rise: [8, 22],  life: [520, 900], color: 'rgba(40,36,32,.75)',    round: false, blur: 0.6 }
  };
  const fragFx = [];
  function fragCap() { return perfOn() ? FRAG_CAP_PERF : FRAG_CAP; }
  function clearFracFx() {
    for (const n of fragFx) { try { n.remove(); } catch (e) { /* ignore */ } }
    fragFx.length = 0;
  }
  function fragTrim() {
    while (fragFx.length > fragCap()) { const old = fragFx.shift(); try { old.remove(); } catch (e) { /* ignore */ } }
  }
  /* §B3 + SPEC-settings §3.1: reduced motion gets ONE static mote that just fades — the break still reads as
   * dusty, nothing travels. */
  function fracParticles(kind, x, y) {
    const P = FRAG_KIND[kind];
    if (!root || !P) return 0;
    const reduced = reducedMotion();
    const n = reduced ? 1 : randInt(P.n[0], P.n[1]);
    for (let i = 0; i < n; i++) {
      const s = rand(P.size[0], P.size[1]);
      const node = mk('div', 'crs-frag');
      node.style.left = px(x + (reduced ? 0 : rand(-16, 16)) - s / 2);
      node.style.top = px(y + (reduced ? 0 : rand(-16, 16)) - s / 2);
      node.style.width = px(s); node.style.height = px(s);
      node.style.borderRadius = P.round ? '50%' : '1px';
      node.style.background = P.color;
      if (P.blur > 0) node.style.filter = 'blur(' + P.blur + 'px)';
      root.append(node);
      fragFx.push(node);
      fragTrim();
      const kill = () => { try { node.remove(); } catch (e) { /* ignore */ } const k = fragFx.indexOf(node); if (k >= 0) fragFx.splice(k, 1); };
      const dur = rand(P.life[0], P.life[1]);
      try {
        const kf = reduced
          ? [{ opacity: 0.8 }, { opacity: 0 }]
          : [{ transform: 'translate(0px, 0px) scale(1)', opacity: 0.92 },
            { transform: 'translate(' + px(rand(-26, 26)) + ', ' + px(-rand(P.rise[0], P.rise[1])) + ') scale(' + rand(0.35, 1.5).toFixed(2) + ')', opacity: 0 }];
        const a = trackAnim(node.animate(kf, { duration: dur, easing: 'ease-out', fill: 'forwards' }));
        a.addEventListener('finish', kill);
      } catch (e) { /* ignore */ }
      later(kill, dur + 300);
    }
    return n;
  }
  /* §B3 `ember`: a 350 ms tail behind a rocket shard. Its own node so the piece's transform stays the
   * physics transform and nothing competes for it. */
  function fracTrail(x, y) {
    if (!root || reducedMotion()) return null;
    const n = mk('div', 'crs-trail');
    const s = rand(10, 20);
    n.style.left = px(x - s / 2); n.style.top = px(y - s / 2);
    n.style.width = px(s); n.style.height = px(s * 2.2);
    n.style.borderRadius = '50%';
    n.style.background = 'radial-gradient(circle, rgba(255,209,102,.95) 0%, rgba(255,107,53,.75) 45%, rgba(255,107,53,0) 72%)';
    root.append(n);
    fragFx.push(n); fragTrim();
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } const k = fragFx.indexOf(n); if (k >= 0) fragFx.splice(k, 1); };
    try {
      const a = trackAnim(n.animate([{ opacity: 0.95, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.3) translateY(14px)' }], { duration: 350, easing: 'ease-out', fill: 'forwards' }));
      a.addEventListener('finish', kill);
    } catch (e) { /* ignore */ }
    later(kill, 700);
    return n;
  }

  /* ===================================================================== */
  /* §C2 the hit zone, §C3 partial destruction                               */
  /* ===================================================================== */
  debug.noPartial = false;   // escape hatch for the suites written against the pre-§C break model
  /* INTERPRETATIONS (reported):
   *  · a blast and a collapse have no 타격 구역 — their "impact point" is the centre of an explosion that may
   *    be nowhere near the element — so §C3 is for the point weapons only. §C4's hit-biased grid is what
   *    gives a blast its own hit sensitivity.
   *  · an impact OUTSIDE the element's box reads as `center` for the same reason.
   *  · a burn tick chars, it does not shear. */
  function fracZone(rect, ix, iy) {
    const w = rect.width, h = rect.height;
    if (!(w > 0 && h > 0)) return 'center';
    if (Math.min(w, h) < 40) return 'center';           // §C2: 짧은 변 40px 미만은 항상 center
    const u = (ix - rect.left) / w, v = (iy - rect.top) / h;
    if (u < 0 || u > 1 || v < 0 || v > 1) return 'center';
    const B = clamp(0.18, 12 / Math.min(w, h), 0.35);   // §C2: 변 띠 두께
    const ou = u < B || u > 1 - B, ov = v < B || v > 1 - B;
    if (ou && ov) return 'corner';
    if (ou || ov) return 'edge';
    return 'center';
  }
  /* §C5: the cut follows a seam when there is one. Child boxes are axis-aligned, so a seam is either
   * horizontal or vertical — the 40 px search and the 25° tolerance are the spec's own. */
  function fracSeamAngle(el, ix, iy, angle) {
    let kids = [];
    try { kids = el.querySelectorAll('*'); } catch (e) { kids = []; }
    const lim = Math.min(kids.length, 40);              // §C5: 자식 40개까지만 훑음
    let best = null, bestD = 26 * DEG;
    const consider = (a) => {
      let d = Math.abs(((angle - a + Math.PI / 2) % Math.PI + Math.PI) % Math.PI - Math.PI / 2);
      if (d < bestD) { bestD = d; best = a; }
    };
    for (let i = 0; i < lim; i++) {
      const r = rectOf(kids[i]);
      if (!r || r.width < 4 || r.height < 4) continue;
      const nearV = (Math.abs(ix - r.left) <= 40 || Math.abs(ix - r.right) <= 40) && iy >= r.top - 40 && iy <= r.bottom + 40;
      const nearH = (Math.abs(iy - r.top) <= 40 || Math.abs(iy - r.bottom) <= 40) && ix >= r.left - 40 && ix <= r.right + 40;
      if (nearV) consider(Math.PI / 2);
      if (nearH) consider(0);
    }
    return best == null ? { angle, snapped: false } : { angle: best, snapped: true };
  }

  /* The ledger. One record per element that has been CUT but not destroyed: the remaining polygon in the
   * element's own offset-box coordinates, how many half-planes have gone through it, and the inline
   * `clip-path` it had before we borrowed it — saved value AND priority, exactly as hideOriginal() saves
   * `visibility` (CLAUDE.md: 흔적을 남기지 않는다). */
  state.partials = [];
  const partialOf = new WeakMap();
  function partialCount() { return state.partials.length; }
  function partialRec(el, ow, oh) {
    let rec = partialOf.get(el);
    if (rec) return rec;
    rec = { el, poly: [[0, 0], [ow, 0], [ow, oh], [0, oh]], area0: ow * oh, cuts: 0,
      saved: { value: el.style.getPropertyValue('clip-path'), priority: el.style.getPropertyPriority('clip-path') } };
    partialOf.set(el, rec);
    state.partials.push(rec);
    return rec;
  }
  /* Give the element its own clip-path back. Called when it is finally destroyed (so the clone that becomes
   * the debris is not clipped twice) and by restore(). */
  function releasePartial(el) {
    const rec = partialOf.get(el);
    if (!rec) return null;
    partialOf.delete(el);
    const i = state.partials.indexOf(rec);
    if (i >= 0) state.partials.splice(i, 1);
    try {
      if (rec.saved.value) el.style.setProperty('clip-path', rec.saved.value, rec.saved.priority);
      else el.style.removeProperty('clip-path');
    } catch (e) { /* ignore */ }
    return rec;
  }
  function clearPartials() {
    for (const rec of state.partials.slice()) releasePartial(rec.el);
    state.partials.length = 0;
  }
  /* §C3 "남은 모양을 원본에 clip-path 로 건다". NOT !important: a page that fights us for the property wins,
   * and that is better than a page we have permanently reshaped. */
  function writeRemain(el, poly, ow, oh) {
    const pct = poly.map((p) => ((clamp(p[0], 0, ow) / Math.max(1, ow)) * 100).toFixed(3) + '% ' + ((clamp(p[1], 0, oh) / Math.max(1, oh)) * 100).toFixed(3) + '%').join(',');
    try { el.style.setProperty('clip-path', 'polygon(' + pct + ')'); } catch (e) { /* ignore */ }
  }

  debug.lastCut = null;
  const PARTIAL_MAX_CUTS = 8;        // §C3: 요소당 반평면 절단 8회
  const PARTIAL_MIN_REMAIN = 0.35;   // §C3: 35% 미만이면 전체 파괴로 전환
  /* One hit, one half-plane. Returns 'cut' (a piece came off and the element is still standing),
   * 'full' (this hit converts to total destruction) or null (nothing to do). */
  function fracPartialHit(el, dmg, mode, ix, iy, opts) {
    if (debug.noPartial || !state.active) return null;
    if (mode === 'bomb' || mode === 'collapse' || opts.aoe || opts.burnt) return null;
    if (!el || !el.isConnected) return null;
    try { if (el.hasAttribute('data-crs-broken')) return null; } catch (e) { return null; }
    const rect = rectOf(el);
    if (!rect || rect.width < 1 || rect.height < 1) return null;
    const zone = fracZone(rect, ix, iy);
    if (zone === 'center') return null;                 // §C2: the whole thing shatters — that is breakElement's job
    const ow = (el.offsetWidth || rect.width) || 1, oh = (el.offsetHeight || rect.height) || 1;
    const sx = rect.width / ow || 1, sy = rect.height / oh || 1;
    const hx = (ix - rect.left) / sx, hy = (iy - rect.top) / sy;
    const rec = partialRec(el, ow, oh);
    if (rec.cuts >= PARTIAL_MAX_CUTS) return 'full';
    // ── the cut line ────────────────────────────────────────────────────────────────────────────────
    let nx, ny;
    if (zone === 'corner') {
      const cxn = hx < ow / 2 ? 0 : ow, cyn = hy < oh / 2 ? 0 : oh;
      let dx = hx - cxn, dy = hy - cyn;
      if (Math.hypot(dx, dy) < 1) { dx = (cxn === 0 ? 1 : -1); dy = (cyn === 0 ? 1 : -1); }
      const L = Math.hypot(dx, dy) || 1; nx = dx / L; ny = dy / L;
    } else {
      // the one band the impact is in: the plate comes off along THAT edge
      const dL = hx, dR = ow - hx, dT = hy, dB = oh - hy;
      const m = Math.min(dL, dR, dT, dB);
      nx = m === dL ? 1 : (m === dR ? -1 : 0);
      ny = m === dT ? 1 : (m === dB ? -1 : 0);
      if (nx === 0 && ny === 0) ny = 1;
    }
    // §C5: snap the cut to a child boundary within 40 px when there is one inside 25°
    const cutAngle = Math.atan2(ny, nx) + Math.PI / 2;
    const snap = fracSeamAngle(el, ix, iy, cutAngle);
    if (snap.snapped) {
      const a = snap.angle - Math.PI / 2;
      let sxn = Math.cos(a), syn = Math.sin(a);
      if (sxn * nx + syn * ny < 0) { sxn = -sxn; syn = -syn; }   // keep pointing INTO the element
      nx = sxn; ny = syn;
    }
    // ── how deep ────────────────────────────────────────────────────────────────────────────────────
    /* §C3's cutDepth is a FRACTION, and the thing it is a fraction OF is the part still standing: measured
     * against the original box instead, a second hit on the same corner would be a no-op and §G's "반복하면
     * remain 면적이 단조 감소" could never be reached. Eight cuts of 12 % therefore land just under the 35 %
     * transition, which is exactly the budget §C3 gives an element. */
    const maxHp = Math.max(1, (hpOf(el) || {}).max || 1);
    const depth = clamp(dmg / maxHp, 0.12, 0.45);
    const { lo, hi } = fracProj(rec.poly, nx, ny);
    if (!(hi - lo > 2)) return 'full';
    const d = lo + (hi - lo) * depth;
    const fallen = fracClipHalf(rec.poly, nx, ny, d);
    const remain = fracClipHalf(rec.poly, -nx, -ny, -d);
    const fallenArea = fallen.length >= 3 ? fracArea(fallen) : 0;
    const remainArea = remain.length >= 3 ? fracArea(remain) : 0;
    const lineDeg = (((Math.atan2(ny, nx) + Math.PI / 2) / DEG) % 180 + 180) % 180;   // the CUT LINE, 0–180°
    debug.lastCut = { zone, angle: Math.round(lineDeg), snapped: snap.snapped, cuts: rec.cuts + 1, remain: remainArea / rec.area0, fallen: fallenArea / rec.area0 };
    if (remainArea < PARTIAL_MIN_REMAIN * rec.area0) return 'full';      // §C3 전체 파괴 전환
    if (fallenArea < 0.004 * rec.area0) return null;                     // nothing worth separating
    rec.poly = remain; rec.cuts++;
    writeRemain(el, remain, ow, oh);
    spawnPartialPiece(el, rect, ow, oh, sx, sy, fallen, ix, iy, mode, opts);
    kick();
    /* §C3's budget — "상한: 요소당 반평면 절단 8회" — is spent BY this cut, so the eighth one is also the
     * last thing the element survives: it sheds its plate and then goes. Checking the cap on the NEXT hit
     * instead would need a ninth landable shot, and there is rarely one: the `clip-path` left behind also
     * stops hit-testing over what fell off, so every following shot has to land deeper in, and by cut eight
     * the whole 18 % edge band has already gone. */
    return rec.cuts >= PARTIAL_MAX_CUTS ? 'full' : 'cut';
  }
  debug.hitZone = (el, x, y) => { const r = el && rectOf(el); return r ? fracZone(r, +x, +y) : null; };
  /* §C4 read-back: the blast grid as pure geometry, so "터진 자리가 가장 잘게 부서진다" can be measured
   * without first having to isolate one element's debris out of a whole explosion. */
  debug.gridCells = (w, h, cols, rows, hx, hy) => gridSplit(+w, +h, +cols, +rows, +hx, +hy).map((p) => ({ cx: p.cx, cy: p.cy, area: fracArea(p.pts) }));
  debug.destructionOf = (id) => (DESTRUCTION[id] ? Object.assign({}, DESTRUCTION[id]) : null);
  debug.remainOf = (el) => {
    const rec = el && partialOf.get(el);
    if (!rec) return null;
    const ow = (el.offsetWidth || 1), oh = (el.offsetHeight || 1);
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const p of rec.poly) {
      const u = p[0] / ow, v = p[1] / oh;
      if (u < minX) minX = u; if (u > maxX) maxX = u;
      if (v < minY) minY = v; if (v > maxY) maxY = v;
    }
    /* `box` is the remaining shape's bounding box as a fraction of the element — what is still THERE to be
     * hit, which is not the element's rect any more once a plate has come off. */
    return { cuts: rec.cuts, ratio: fracArea(rec.poly) / rec.area0, box: { minX, minY, maxX, maxY }, clip: el.style.getPropertyValue('clip-path') || '' };
  };

  /* ===================================================================== */
  /* §A weapon marks — the damage that ACCUMULATES on an element's decal      */
  /* ===================================================================== */
  /* drawCrack() (src/30-canvas.js) paints the material's crack web; this paints what the WEAPON leaves on
   * top of it, in the same element-local space, straight into the decal bitmap. A mark is permanent until
   * the element is repaired or destroyed, so hitting the same card four times really does pile up. */
  const SPALL_MIN = 60, SPALL_MAX = 110;   // §A sniper: 탄도 반대쪽 60~110px 파편 원뿔
  function markHole(c, lx, ly, r, ink) {
    c.beginPath(); c.arc(lx, ly, r, 0, Math.PI * 2);
    c.fillStyle = 'rgba(10,12,16,.88)'; c.fill();
    c.lineWidth = 1; c.strokeStyle = ink.light; c.stroke();
  }
  function markLines(c, lx, ly, n, lo, hi, w, color) {
    c.lineWidth = w; c.strokeStyle = color; c.lineCap = 'round';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), L = rand(lo, hi);
      c.moveTo(lx + Math.cos(a) * 2, ly + Math.sin(a) * 2);
      c.lineTo(lx + Math.cos(a) * L, ly + Math.sin(a) * L);
    }
    c.stroke();
  }
  function weaponMark(rec, lx, ly, x, y, opts) {
    if (!rec || !rec.ctx) return null;
    const id = (opts && opts.weapon) || state.weapon;
    const ink = matOf(materialOf(rec.el));
    const c = rec.ctx;
    const dmg = (opts && opts.dmg) || (WEAPONS[id] ? WEAPONS[id].damage : 65);
    if (!rec.holes) rec.holes = [];
    try {
      c.save();
      c.lineJoin = 'round'; c.lineCap = 'round';
      if (id === 'hammer') {
        /* §A 망치: 거미줄 균열 반지름 18 + 10×(dmg/65), 6~9 짧은 가지 + 옅은 흰 멍 */
        const R = 18 + 10 * (clamp(dmg, 0, 400) / 65);
        const g = c.createRadialGradient(lx, ly, 0, lx, ly, R);
        g.addColorStop(0, 'rgba(255,255,255,.26)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.beginPath(); c.arc(lx, ly, R, 0, Math.PI * 2); c.fill();
        markLines(c, lx, ly, randInt(6, 9), R * 0.35, R, 1.1, ink.ink);
      } else if (id === 'pistol' || id === 'sniper') {
        /* §A 권총: 5px 구멍 + 1px 밝은 테두리 + 3~5 실금 / 저격총: 9px 구멍 + 파편 원뿔 + 4~7 긴 가지 */
        const sniper = id === 'sniper';
        if (sniper) {
          const a = fracHitAngle('sniper', x, y) + Math.PI;    // §A: the cone opens AWAY from the bullet's path
          const R = rand(SPALL_MIN, SPALL_MAX), half = 22 * DEG;
          c.beginPath(); c.moveTo(lx, ly);
          c.arc(lx, ly, R, a - half, a + half);
          c.closePath();
          const g = c.createRadialGradient(lx, ly, 0, lx, ly, R);
          g.addColorStop(0, 'rgba(255,255,255,.34)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          c.fillStyle = g; c.fill();
          markLines(c, lx, ly, randInt(4, 7), R * 0.4, R, 1.2, ink.ink);
        } else markLines(c, lx, ly, randInt(3, 5), 6, 18, 0.8, ink.ink);
        markHole(c, lx, ly, sniper ? 4.5 : 2.5, ink);
        rec.holes.push([lx, ly]);
      } else if (id === 'smg') {
        /* §A 기관총: 3px 구멍이 뭉치고, 40px 안에 6개 이상이면 잇는 찢김선 */
        markHole(c, lx, ly, 1.5, ink);
        rec.holes.push([lx, ly]);
        if (rec.holes.length > 80) rec.holes.splice(0, rec.holes.length - 80);
        const near = rec.holes.filter((h) => Math.hypot(h[0] - lx, h[1] - ly) <= 40);
        if (near.length >= 6) {
          c.lineWidth = 1.6; c.strokeStyle = ink.ink; c.beginPath();
          for (const h of near) { c.moveTo(lx, ly); c.lineTo(h[0], h[1]); }
          c.stroke();
        }
      } else if (id === 'axe') {
        /* §A 도끼: 스윙 각도를 따르는 2~3px 베인 자국 + 4~8 쪼개짐 눈금 */
        const a = fracHitAngle('axe', x, y), L = rand(34, 62);
        const dx = Math.cos(a) * L, dy = Math.sin(a) * L;
        c.lineWidth = rand(2, 3); c.strokeStyle = ink.ink;
        c.beginPath(); c.moveTo(lx - dx, ly - dy); c.lineTo(lx + dx, ly + dy); c.stroke();
        const nx = -Math.sin(a), ny = Math.cos(a);
        c.lineWidth = 1; c.beginPath();
        for (let i = 0, n = randInt(4, 8); i < n; i++) {
          const f = rand(-0.9, 0.9), s = Math.random() < 0.5 ? -1 : 1, t = rand(3, 9);
          c.moveTo(lx + dx * f, ly + dy * f);
          c.lineTo(lx + dx * f + nx * t * s, ly + dy * f + ny * t * s);
        }
        c.stroke();
      } else if (id === 'bomb' || id === 'rocket') {
        /* §A 폭탄: 그을음 + 검댕 흩뿌림 / 로켓: 1.6배 + 분출 줄기 */
        const k = id === 'rocket' ? 1.6 : 1;
        const R = 54 * k;
        const g = c.createRadialGradient(lx, ly, 0, lx, ly, R);
        g.addColorStop(0, 'rgba(22,16,11,.5)'); g.addColorStop(1, 'rgba(22,16,11,0)');
        c.fillStyle = g; c.beginPath(); c.arc(lx, ly, R, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(20,15,10,.55)';
        for (let i = 0, n = randInt(14, 26); i < n; i++) {
          const a = rand(0, Math.PI * 2), d = rand(R * 0.3, R * 1.3), s = rand(1, 3.2);
          c.fillRect(lx + Math.cos(a) * d, ly + Math.sin(a) * d, s, s);
        }
        if (id === 'rocket') markLines(c, lx, ly, randInt(5, 8), R * 0.5, R * 1.5, 2.2, 'rgba(20,15,10,.45)');
      }
      c.restore();
    } catch (e) { /* ignore */ }
    return id;
  }
  /* §A 화염방사기: "전체가 점점 그을린다. charLevel = 1 − hp/max". The whole decal darkens; only the
   * DIFFERENCE since the last tick is laid down, so the ramp is smooth instead of saturating in a second. */
  function charDecal(el) {
    const rec = ensureDecal(el);
    if (!rec || !rec.ctx) return 0;
    const h = state.hp.get(el);
    const level = (h && h.max > 0) ? clamp(1 - h.hp / h.max, 0, 1) : 0;
    const prev = rec.char || 0;
    if (level <= prev + 0.02) return prev;
    rec.char = level;
    try {
      const c = rec.ctx;
      c.save();
      c.fillStyle = 'rgba(26,18,12,' + ((level - prev) * 0.55).toFixed(3) + ')';
      c.fillRect(0, 0, rec.cssW, rec.cssH);
      c.restore();
    } catch (e) { /* ignore */ }
    return level;
  }
  debug.charOf = (el) => { const rec = el && decals.get(el); return rec ? (rec.char || 0) : null; };

  /* ===================================================================== */
  /* §D the katana's curve                                                   */
  /* ===================================================================== */
  /* `fracCurve` is the quadratic Bézier of the slash currently being resolved: the drag's start, middle and
   * end, with the middle pushed len × 0.12 along the perpendicular so the blade really arcs (§D2). It is set
   * by doSlash() for the length of one slash and read by the afterimage, the scar and the split line. */
  let fracCurve = null;
  function fracMakeCurve(x1, y1, x2, y2, mid) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    // the recorded middle of the drag, or the straight midpoint when the slash came in through api.slash()
    const mx = (mid && isFinite(mid.x)) ? mid.x : (x1 + x2) / 2;
    const my = (mid && isFinite(mid.y)) ? mid.y : (y1 + y2) / 2;
    const bow = len * 0.12;
    // control point of the quadratic through (x1,y1) → (mx,my) → (x2,y2), bowed along the normal
    const side = ((mx - x1) * ny - (my - y1) * nx) >= 0 ? -1 : 1;
    return { x1, y1, x2, y2, len,
      cx: 2 * mx - (x1 + x2) / 2 + nx * bow * side,
      cy: 2 * my - (y1 + y2) / 2 + ny * bow * side };
  }
  function fracCurveAt(cu, t) {
    const u = 1 - t;
    return { x: u * u * cu.x1 + 2 * u * t * cu.cx + t * t * cu.x2, y: u * u * cu.y1 + 2 * u * t * cu.cy + t * t * cu.y2 };
  }
  function fracCurveAngle(cu, t) {
    const u = 1 - t;
    return Math.atan2(2 * u * (cu.cy - cu.y1) + 2 * t * (cu.y2 - cu.cy), 2 * u * (cu.cx - cu.x1) + 2 * t * (cu.x2 - cu.cx));
  }
  /* §D2: "판정은 이 곡선을 24px 간격으로 샘플링한다" — the samples the slash hit-tests and marks along. */
  function fracCurveSamples(cu, stepPx) {
    const n = Math.max(2, Math.ceil(cu.len / (stepPx || 24)) + 1), out = [];
    for (let i = 0; i < n; i++) out.push(fracCurveAt(cu, i / (n - 1)));
    return out;
  }
  /* §D2: "splitRect 의 직선 절단을 곡선 절단으로 확장한다 (베지어를 10개 선분으로 근사해 폴리곤을 자른다)".
   * The chord is cut with one half-plane first — that is what guarantees two valid, tiling polygons — and the
   * shared edge is then BOWED onto the ten-segment approximation of the Bézier. Both halves get the same
   * displaced boundary (walked in opposite directions), so the cut surfaces still match tooth for tooth.
   * `toLocal` maps a viewport point into the element's own offset-box frame. */
  function fracCurveSplit(w, h, cu, toLocal) {
    if (!cu || w < 2 || h < 2) return null;
    const P = [];
    for (let i = 0; i <= 10; i++) P.push(toLocal(fracCurveAt(cu, i / 10)));
    const a = P[0], b = P[10];
    let ux = b.x - a.x, uy = b.y - a.y;
    const L = Math.hypot(ux, uy);
    if (!(L > 2)) return null;
    ux /= L; uy /= L;
    const nx = -uy, ny = ux, d = nx * a.x + ny * a.y;
    const ss = P.map((p) => ux * (p.x - a.x) + uy * (p.y - a.y));
    const dv = P.map((p) => nx * p.x + ny * p.y - d);
    const dev = (s) => {
      if (s <= ss[0] || s >= ss[10]) return 0;
      for (let i = 1; i <= 10; i++) if (s <= ss[i]) { const t = (s - ss[i - 1]) / Math.max(1e-6, ss[i] - ss[i - 1]); return dv[i - 1] + (dv[i] - dv[i - 1]) * t; }
      return 0;
    };
    const rect = [[0, 0], [w, 0], [w, h], [0, h]];
    const A = fracClipHalf(rect, nx, ny, d), B = fracClipHalf(rect, -nx, -ny, -d);
    if (A.length < 3 || B.length < 3 || fracArea(A) < 9 || fracArea(B) < 9) return null;
    const bow = (pts) => {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        out.push(p);
        if (Math.abs(nx * p[0] + ny * p[1] - d) > 0.05 || Math.abs(nx * q[0] + ny * q[1] - d) > 0.05) continue;
        const sp = ux * (p[0] - a.x) + uy * (p[1] - a.y), sq = ux * (q[0] - a.x) + uy * (q[1] - a.y);
        for (let k = 1; k < 10; k++) {
          const s = sp + (sq - sp) * (k / 10), e = dev(s);
          out.push([clamp(a.x + ux * s + nx * e, 0, w), clamp(a.y + uy * s + ny * e, 0, h)]);
        }
      }
      return out;
    };
    return [polyInfo(bow(A)), polyInfo(bow(B))];
  }
  /* §D2: "절단면에 1프레임 흰 테두리" — the instant the two halves start to slide, the freshly exposed cut
   * face catches the light for a frame. Ridden on the filter chain addPiece() already owns, so it composites
   * over the drop shadow and the material sheen instead of replacing them. */
  function fracCutFlash(p) {
    if (!p || !p.node || reducedMotion()) return;
    const base = p.node.style.filter || '';
    try {
      trackAnim(p.node.animate([
        { filter: (base ? base + ' ' : '') + 'drop-shadow(0 0 2px rgba(255,255,255,.95))' },
        { filter: (base ? base + ' ' : '') + 'drop-shadow(0 0 0 rgba(255,255,255,0))' }
      ], { duration: 70, easing: 'ease-out' }));
    } catch (e) { /* ignore */ }
  }
  function fracSetCurve(cu) { fracCurve = cu; return cu; }
  function fracGetCurve() { return fracCurve; }
  debug.slashCurve = () => (fracCurve ? { x1: Math.round(fracCurve.x1), y1: Math.round(fracCurve.y1), cx: Math.round(fracCurve.cx), cy: Math.round(fracCurve.cy), x2: Math.round(fracCurve.x2), y2: Math.round(fracCurve.y2) } : null);

  /* §D2 "잔상 0~180ms": a crescent that follows the curve — 18 px through the middle, tapering to nothing at
   * both tips, drawn 0–60 ms and gone by 180 ms. No ticks: a tick mark reads as a saw, not a blade. */
  function fracCrescent(cu) {
    if (!root || !cu) return null;
    const n = mk('div', 'crs-slash-fx');
    const pad = 24;
    const minX = Math.min(cu.x1, cu.x2, cu.cx) - pad, minY = Math.min(cu.y1, cu.y2, cu.cy) - pad;
    const maxX = Math.max(cu.x1, cu.x2, cu.cx) + pad, maxY = Math.max(cu.y1, cu.y2, cu.cy) + pad;
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    n.style.left = px(minX); n.style.top = px(minY); n.style.width = px(w); n.style.height = px(h);
    let svg;
    try {
      svg = doc.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('width', String(Math.round(w)));
      svg.setAttribute('height', String(Math.round(h)));
      svg.setAttribute('viewBox', '0 0 ' + Math.round(w) + ' ' + Math.round(h));
      const defs = doc.createElementNS(SVG_NS, 'defs');
      const grad = doc.createElementNS(SVG_NS, 'linearGradient');
      const gid = 'crs-cres-' + Math.round(rand(1e6, 9e6));
      grad.setAttribute('id', gid);
      grad.setAttribute('gradientUnits', 'userSpaceOnUse');
      grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
      grad.setAttribute('x2', '0'); grad.setAttribute('y2', String(Math.round(h)));
      for (const [off, col] of [['0', 'rgba(255,255,255,.95)'], ['1', 'rgba(255,255,255,0)']]) {
        const s = doc.createElementNS(SVG_NS, 'stop');
        s.setAttribute('offset', off); s.setAttribute('stop-color', col);
        grad.append(s);
      }
      defs.append(grad); svg.append(defs);
      // the crescent itself: the curve out, and the same curve back with an 18 px belly
      const bx = (cu.cx - minX), by = (cu.cy - minY);
      const a = Math.atan2(cu.y2 - cu.y1, cu.x2 - cu.x1);
      const ox = -Math.sin(a) * 18, oy = Math.cos(a) * 18;
      const path = doc.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', 'M' + (cu.x1 - minX).toFixed(1) + ',' + (cu.y1 - minY).toFixed(1) +
        ' Q' + bx.toFixed(1) + ',' + by.toFixed(1) + ' ' + (cu.x2 - minX).toFixed(1) + ',' + (cu.y2 - minY).toFixed(1) +
        ' Q' + (bx + ox).toFixed(1) + ',' + (by + oy).toFixed(1) + ' ' + (cu.x1 - minX).toFixed(1) + ',' + (cu.y1 - minY).toFixed(1) + ' Z');
      path.setAttribute('fill', 'url(#' + gid + ')');
      svg.append(path);
      n.append(svg);
    } catch (e) { return null; }
    root.append(n);
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
    try {
      const an = trackAnim(n.animate([{ opacity: 0.2 }, { opacity: 1, offset: 0.33 }, { opacity: 0 }], { duration: 180, easing: 'ease-out', fill: 'forwards' }));
      an.addEventListener('finish', kill);
    } catch (e) { /* ignore */ }
    later(kill, 400);
    return n;
  }

  /* ===================================================================== */
  /* Wiring                                                                  */
  /* ===================================================================== */
  /* applyHit() is the single damage sink (src/73-hit-resolution.js), so this is the single place a hit that
   * did NOT kill can shed a corner (§C3) or deepen a burn's char (§A). Wrapped rather than edited, the same
   * way src/71 wraps velocityFor() and src/22 wraps tickFrame(): one closure, declarations hoisted. */
  const applyHitFrac = applyHit;
  applyHit = function (el, dmg, kind, ix, iy, opts) {
    opts = opts || {};
    const out = applyHitFrac(el, dmg, kind, ix, iy, opts);
    if (out !== 'damaged') return out;
    try {
      if (opts.burnt) charDecal(el);
      else if (fracPartialHit(el, dmg, kind, ix, iy, opts) === 'full') {
        breakElement(el, ix, iy, Object.assign({}, opts, { mode: kind }));
        refreshHover();
        return 'broken';
      }
    } catch (e) { state.lastError = String((e && e.stack) || e); }
    return out;
  };
