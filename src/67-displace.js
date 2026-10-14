  /* ===================================================================== */
  /* 10.5 Displacement — SPEC-combat §E (로드맵 3.5)                          */
  /*                                                                        */
  /* A SECOND BODY SET on the existing piece integrator (src/92-tick.js),    */
  /* not a loop of its own (§E2). A piece is a dead clone we own; a          */
  /* displaced body is a LIVE PAGE ELEMENT we are only borrowing a           */
  /* `transform` on — so every rule below is really one rule: give the       */
  /* element back exactly as it was found.                                   */
  /* ===================================================================== */

  /* §E1: the state. `moved` is the WeakMap the spec names (element → body); `movedList` is the same
   * set in insertion order, because every frame has to iterate it and a WeakMap cannot be walked. */
  state.moved = new WeakMap();
  state.movedList = [];
  /* §E4: an element whose `transform` the page kept taking back is retired from displacement for the
   * rest of the session. A WeakSet, so a page that churns nodes does not leak through us. */
  const movedExcluded = new WeakSet();

  const MOVED_CAP = 24;              // §E1
  const MOVED_CAP_PERF = 12;         // §E1, performance mode (src/22-perf.js)
  const MOVED_FRICTION = 0.86;       // §E2, per second
  const MOVED_ROT_FRICTION = 0.80;   // §E2, per second
  const MOVED_GRAVITY = 1200;        // §E2, ONLY while wet / bouncy
  const MOVED_OUT_MARGIN = 400;      // §E2, px past a viewport edge
  const MOVED_BOUNCE = 0.45;         // §E3, restitution
  const MOVED_STATIC_MS = 300;       // §E3, the in-place candidate cache
  const MOVED_RETURN_MS = 400;       // §E1, the over-cap glide home
  const MOVED_REAPPLY_MAX = 3;       // §E4, reapply three times, then give up on the element
  /* Interpretations (the spec does not name these three; see README / the report):
   *  SLEEP_V / SLEEP_R  what "정지" means for a body that will never touch a floor — below these it is
   *                     parked, which is also what stops the frame loop. Picked an order of magnitude
   *                     under the slowest shove that still reads as motion.
   *  HIT_MIN_SPEED      §E3 damages at clamp(round(rel/14), 1, 60), so an arbitrarily slow touch would
   *                     still take a point. A body drifting to a halt against its neighbour is not a
   *                     collision; below this it just resolves the overlap.
   *  HIT_GAP_MS         one pair, one hit per this window. Without it an overlap that outlives the
   *                     bounce bills damage every frame. */
  const MOVED_SLEEP_V = 5;
  const MOVED_SLEEP_R = 8;
  const MOVED_HIT_MIN_SPEED = 20;
  const MOVED_HIT_GAP_MS = 250;

  function movedCap() { return perfOn() ? MOVED_CAP_PERF : MOVED_CAP; }
  /* §E2: mass clamp(sqrt(area)/18, 0.6, 6) — a 1052 × 420 section is 6, a 90 × 30 button is 0.6, so the
   * same impulse moves the button an order of magnitude further. */
  function movedMass(rect) {
    const area = rect ? Math.max(1, rect.width * rect.height) : 1;
    return clamp(Math.sqrt(area) / 18, 0.6, 6);
  }
  function movedTransform(b) {
    const own = 'translate(' + b.x.toFixed(2) + 'px, ' + b.y.toFixed(2) + 'px) rotate(' + b.rot.toFixed(2) + 'deg)';
    /* §E1: "페이지가 이미 쓰고 있으면 저장한 값 앞에 이어 붙인다" — the page's own transform stays in
     * front, so our offset is applied inside the frame the page asked for and its value is never lost.
     * `none` is the one value that cannot be joined: `none translate(…)` is not a transform list, the
     * whole declaration would be dropped and the element would silently stop moving. It is also exactly
     * what a framework writes when it resets a style, so this is not a corner case. */
    const base = (b.saved && b.saved.trim().toLowerCase() !== 'none') ? b.saved : '';
    return base ? base + ' ' + own : own;
  }
  /* TWO strings, and they are not the same one — this cost an afternoon:
   *   b.want   what we last asked for ('translate(1.00px, 0.00px) rotate(0.00deg)'). The frame loop
   *            compares against this, so a parked body costs no style write at all.
   *   b.wrote  what the CSSOM says after the write ('translate(1px, 0px) rotate(0deg)'). The browser
   *            re-serialises the declaration, so the observer below MUST compare against the readback.
   *            Comparing it against `want` makes every one of our own writes look like the page taking
   *            the transform away, and §E4 then retires the element on its first frame. */
  function writeMoved(b) {
    const v = movedTransform(b);
    if (v === b.want) return;
    try {
      b.el.style.setProperty('transform', v, 'important');
      b.want = v;
      b.wrote = b.el.style.getPropertyValue('transform');
    } catch (e) { /* ignore */ }
  }
  /* The no-trace contract (CLAUDE.md): the inline style goes back to its ORIGINAL VALUE, not to empty.
   * `saved` is '' for the overwhelmingly common element that had no inline transform at all, and that
   * case removes the property rather than leaving `transform: ;` behind. */
  function releaseMoved(b) {
    if (b.released) return;
    b.released = true;
    try { if (b.mo) b.mo.disconnect(); } catch (e) { /* ignore */ }
    b.mo = null;
    try {
      if (b.saved) b.el.style.setProperty('transform', b.saved, b.savedPriority);
      else b.el.style.removeProperty('transform');
    } catch (e) { /* ignore */ }
    try { state.moved.delete(b.el); } catch (e) { /* ignore */ }
    const i = state.movedList.indexOf(b);
    if (i >= 0) state.movedList.splice(i, 1);
  }
  function clearMoved() {
    for (const b of state.movedList.slice()) releaseMoved(b);
    state.movedList.length = 0;
    state.moved = new WeakMap();
    movedStatic.at = -1e9; movedStatic.list = [];
  }
  /* §E4: 복구(Z) and the enemy repair beam put a displacement back. `el` answers for its subtree, because
   * repairing a card has to bring back the button inside it too. */
  function undisplace(el) {
    if (!el) return 0;
    let n = 0;
    for (const b of state.movedList.slice()) {
      let mine = b.el === el;
      if (!mine) { try { mine = el.contains(b.el); } catch (e) { mine = false; } }
      if (mine) { releaseMoved(b); n++; }
    }
    return n;
  }
  /* §E1: over the cap the OLDEST glides home over 0.4 s rather than snapping — the element is still on
   * the page and a snap would read as a layout bug. `b.retMs` lets a caller retime that one glide —
   * SPEC-combat §D5's 돌격 comes home over 0.35 s — and everything else keeps MOVED_RETURN_MS. */
  function startMovedReturn(b) {
    if (b.returning) return;
    b.returning = true;
    b.retAt = now();
    b.retX = b.x; b.retY = b.y; b.retRot = b.rot;
    b.vx = 0; b.vy = 0; b.vr = 0; b.resting = false;
  }
  function movedActive() {
    let n = 0;
    for (const b of state.movedList) if (!b.returning) n++;
    return n;
  }
  function enforceMovedCap() {
    const cap = movedCap();
    while (movedActive() > cap) {
      let oldest = null;
      for (const b of state.movedList) { if (b.returning) continue; if (!oldest || b.bornAt < oldest.bornAt) oldest = b; }
      if (!oldest) break;
      startMovedReturn(oldest);
    }
  }
  function movedEligible(el) {
    if (!el || el.nodeType !== 1 || !state.active) return false;
    if (movedExcluded.has(el)) return false;                       // §E4: the page won this one already
    if (el === doc.body || el === docEl) return false;             // a transform on body re-frames every fixed child
    if (SKIP_WALK_TAGS.has(tagOf(el)) || isOurs(el)) return false;
    try { if (!el.isConnected || el.hasAttribute('data-crs-broken')) return false; } catch (e) { return false; }
    return true;
  }
  function movedBody(el) {
    let b = state.moved.get(el);
    if (b && !b.released) { if (b.returning) { b.returning = false; b.resting = false; } return b; }
    const rect = rectOf(el);
    if (!rect || rect.width < 1 || rect.height < 1) return null;
    let saved = '', priority = '';
    try { saved = el.style.getPropertyValue('transform') || ''; priority = el.style.getPropertyPriority('transform') || ''; } catch (e) { saved = ''; priority = ''; }
    b = {
      el, x: 0, y: 0, rot: 0, vx: 0, vy: 0, vr: 0, resting: false, bornAt: now(),
      wet: false, bouncy: false,
      mass: movedMass(rect), saved, savedPriority: priority, want: '', wrote: '', reapplied: 0,
      mo: null, released: false, returning: false, retAt: 0, retX: 0, retY: 0, retRot: 0, retMs: 0,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      hitAt: new WeakMap()
    };
    state.moved.set(el, b);
    state.movedList.push(b);
    /* §E4: an SPA that re-renders inline styles takes our transform away. Reapply three times; the
     * fourth overwrite means the page genuinely owns that attribute and we stop fighting it. Same shape
     * as hideOriginal()'s observer in src/70-break.js, with the page's newest value adopted as the base
     * so its own transform is never the thing we throw away. */
    try {
      b.mo = new MutationObserver(() => {
        if (b.released || !state.active) return;
        let cur = '';
        try { cur = b.el.style.getPropertyValue('transform') || ''; } catch (e) { return; }
        if (cur === b.wrote) return;                 // our own write, or nothing changed
        if (b.reapplied >= MOVED_REAPPLY_MAX) { movedExcluded.add(b.el); releaseMoved(b); return; }
        b.reapplied++;
        b.saved = cur;
        try { b.savedPriority = b.el.style.getPropertyPriority('transform') || ''; } catch (e) { /* keep */ }
        writeMoved(b);
      });
      b.mo.observe(el, { attributes: true, attributeFilter: ['style'] });
    } catch (e) { b.mo = null; }
    writeMoved(b);
    enforceMovedCap();
    return b;
  }
  /* The ONE entry point. §D5 (돌격) and the step-8 interaction weapons push through here: an impulse in
   * px·mass/s, turned into velocity by §E2's `충격량 / 질량`. opts: { wet, bouncy } (§E2 gravity) and
   * { spin } (deg/s, opt-in — see below). Returns the body, or null when the element is not
   * displaceable (ours, broken, body/html, or retired by §E4). */
  function displaceEl(el, ix, iy, opts) {
    if (!movedEligible(el)) return null;
    const b = movedBody(el);
    if (!b) return null;
    opts = opts || {};
    if (opts.wet) b.wet = true;
    if (opts.bouncy) b.bouncy = true;
    b.vx += (+ix || 0) / b.mass;
    b.vy += (+iy || 0) / b.mass;
    /* §E2 gives `vr` a friction (0.80/s) but never says an impulse induces spin, and §E1's hook is
     * (el, impulseX, impulseY) — no third axis. So a plain shove does NOT rotate: a caller that wants
     * tumble asks for it by name. (돌격 §D5 and the step-8 weapons are the callers that will.) */
    if (opts.spin != null) b.vr += +opts.spin;
    b.resting = false;
    kick();
    return b;
  }

  /* ---- §E3 collision ------------------------------------------------------------------------------ */
  /* The in-place candidates, behind the 300 ms cache the spec asks for. walkCandidatesRaw() is used
   * directly rather than the memoised walkCandidates(): that memo holds four signatures and this would
   * be a fifth, evicting the hover / AoE / ratio entries every frame and turning their cache hits into
   * real page walks. `descendCollected` is on because the interesting neighbours — the sibling card, the
   * button beside the one you pushed — live INSIDE a collected container. */
  const movedStatic = { at: -1e9, list: [] };
  function movedStaticCandidates() {
    const t = now();
    if (t - movedStatic.at <= MOVED_STATIC_MS) return movedStatic.list;
    movedStatic.at = t;
    let out = [];
    try { out = walkCandidatesRaw(viewW() / 2, viewH() / 2, { limit: 0.7 * viewW() * viewH(), minArea: 400, descendCollected: true }); } catch (e) { out = []; }
    movedStatic.list = out;
    return out;
  }
  function aabbHit(a, c) { return a.left < c.right && a.right > c.left && a.top < c.bottom && a.bottom > c.top; }
  /* Minimum-translation axis of an overlap: the cheapest way out is the shallowest penetration.
   * The normal points FROM a TOWARDS c — the direction c has to be pushed to clear a — and every caller
   * below reads it that way (c moves along +n, a along -n, and an approach is a NEGATIVE (vc-va)·n).
   * dxL small means a's left edge is inside c, i.e. a is to the RIGHT of c, so c is pushed LEFT. */
  function aabbPush(a, c) {
    const dxL = c.right - a.left, dxR = a.right - c.left;
    const dyT = c.bottom - a.top, dyB = a.bottom - c.top;
    const penX = Math.min(dxL, dxR), penY = Math.min(dyT, dyB);
    if (penX < penY) return { nx: dxL < dxR ? -1 : 1, ny: 0, depth: penX };
    return { nx: 0, ny: dyT < dyB ? -1 : 1, depth: penY };
  }
  function movedCanHit(b, el, t) {
    const last = b.hitAt.get(el) || 0;
    if (t - last < MOVED_HIT_GAP_MS) return false;
    b.hitAt.set(el, t);
    return true;
  }
  /* §E3 damage. It goes through collisionHit() (src/73-hit-resolution.js) and NOT through applyHit():
   * §B2 wants displacement on every element while the collision damage lands on hostiles only, and that
   * gate lives in exactly one place. */
  function movedCollisionDamage(el, relSpeed, x, y) {
    if (!el || !el.isConnected) return;
    try { if (el.hasAttribute('data-crs-broken')) return; } catch (e) { return; }
    try { collisionHit(el, relSpeed, x, y); } catch (e) { state.lastError = String((e && e.stack) || e); }
  }
  function movedCollide(t, rects) {
    const live = [];
    for (const b of state.movedList) { if (!b.returning && rects.get(b)) live.push(b); }
    // ---- displaced ↔ displaced ----
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], c = live[j];
        try { if (a.el.contains(c.el) || c.el.contains(a.el)) continue; } catch (e) { continue; }
        const ra = rects.get(a), rc = rects.get(c);
        if (!aabbHit(ra, rc)) continue;
        const n = aabbPush(ra, rc);
        const rvx = c.vx - a.vx, rvy = c.vy - a.vy;
        const along = rvx * n.nx + rvy * n.ny;
        if (along >= 0) continue;                       // already separating — one impact, not a grind
        const relSpeed = Math.hypot(rvx, rvy);
        const imp2 = -(1 + MOVED_BOUNCE) * along / (1 / a.mass + 1 / c.mass);
        a.vx -= imp2 * n.nx / a.mass; a.vy -= imp2 * n.ny / a.mass;
        c.vx += imp2 * n.nx / c.mass; c.vy += imp2 * n.ny / c.mass;
        const half = n.depth / 2;
        a.x -= n.nx * half; a.y -= n.ny * half;
        c.x += n.nx * half; c.y += n.ny * half;
        a.resting = false; c.resting = false;
        if (relSpeed < MOVED_HIT_MIN_SPEED) continue;
        if (!movedCanHit(a, c.el, t) || !movedCanHit(c, a.el, t)) continue;
        const cx = (Math.max(ra.left, rc.left) + Math.min(ra.right, rc.right)) / 2;
        const cy = (Math.max(ra.top, rc.top) + Math.min(ra.bottom, rc.bottom)) / 2;
        movedCollisionDamage(a.el, relSpeed, cx, cy);
        movedCollisionDamage(c.el, relSpeed, cx, cy);
      }
    }
    // ---- displaced ↔ in place ----
    let cands = null;
    for (const b of live) {
      const speed = Math.hypot(b.vx, b.vy);
      if (speed < MOVED_HIT_MIN_SPEED) continue;
      if (!cands) cands = movedStaticCandidates();
      const rb = rects.get(b);
      for (const cand of cands) {
        const el = cand.el;
        if (!el || el === b.el || state.moved.has(el)) continue;
        try { if (!el.isConnected || el.contains(b.el) || b.el.contains(el)) continue; } catch (e) { continue; }
        const rc = rectOf(el);
        if (!rc || rc.width < 1 || rc.height < 1 || !aabbHit(rb, rc)) continue;
        const n = aabbPush(rb, rc);
        const along = b.vx * n.nx + b.vy * n.ny;
        if (along <= 0) continue;                       // moving away from it
        b.x -= n.nx * n.depth; b.y -= n.ny * n.depth;
        b.vx -= (1 + MOVED_BOUNCE) * along * n.nx;
        b.vy -= (1 + MOVED_BOUNCE) * along * n.ny;
        rb.left -= n.nx * n.depth; rb.right -= n.nx * n.depth;
        rb.top -= n.ny * n.depth; rb.bottom -= n.ny * n.depth;
        if (!movedCanHit(b, el, t)) continue;
        const cx = (Math.max(rb.left, rc.left) + Math.min(rb.right, rc.right)) / 2;
        const cy = (Math.max(rb.top, rc.top) + Math.min(rb.bottom, rc.bottom)) / 2;
        movedCollisionDamage(b.el, speed, cx, cy);
        movedCollisionDamage(el, speed, cx, cy);
        break;                                          // one in-place impact per body per frame
      }
    }
  }

  /* ---- §E2 integration — called from tickFrame() (src/92-tick.js), never from a loop of its own ---- */
  function stepMoved(t, dt) {
    if (!state.movedList.length) return false;
    let busy = false;
    const rects = new Map();
    const vw = viewW(), vh = viewH();
    for (const b of state.movedList.slice()) {
      /* An element that was destroyed or detached under us is given its transform back and dropped —
       * the pieces were already spawned from the displaced rect, so nothing moves on screen. */
      let gone = false;
      try { gone = !b.el.isConnected || b.el.hasAttribute('data-crs-broken'); } catch (e) { gone = true; }
      if (gone) { releaseMoved(b); continue; }
      if (b.returning) {
        busy = true;
        const k = clamp((t - b.retAt) / scaleMs(b.retMs || MOVED_RETURN_MS), 0, 1);
        const e = 1 - Math.pow(1 - k, 3);              // ease-out, same feel as the repair fly-home
        b.x = b.retX * (1 - e); b.y = b.retY * (1 - e); b.rot = b.retRot * (1 - e);
        if (k >= 1) { releaseMoved(b); continue; }
        writeMoved(b);
        continue;
      }
      if (!b.resting) {
        busy = true;
        // §E2: no gravity. A displaced element was SHOVED, it is not falling — unless it is wet or bouncy.
        if (b.wet || b.bouncy) b.vy += MOVED_GRAVITY * dt;
        b.vx *= Math.pow(MOVED_FRICTION, dt);
        b.vy *= Math.pow(MOVED_FRICTION, dt);
        b.vr *= Math.pow(MOVED_ROT_FRICTION, dt);
        b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vr * dt;
      }
      const r = rectOf(b.el);
      if (!r) { releaseMoved(b); continue; }
      const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      /* §E2: nothing is pushed more than 400 px past a viewport edge. Measured on the LIVE rect, so a
       * scroll or a reflow under the element corrects itself on the next frame instead of drifting. */
      const overL = (-MOVED_OUT_MARGIN) - box.right;
      const overR = box.left - (vw + MOVED_OUT_MARGIN);
      const overT = (-MOVED_OUT_MARGIN) - box.bottom;
      const overB = box.top - (vh + MOVED_OUT_MARGIN);
      if (overL > 0) { b.x += overL; box.left += overL; box.right += overL; if (b.vx < 0) b.vx = 0; }
      if (overR > 0) { b.x -= overR; box.left -= overR; box.right -= overR; if (b.vx > 0) b.vx = 0; }
      if (overT > 0) { b.y += overT; box.top += overT; box.bottom += overT; if (b.vy < 0) b.vy = 0; }
      if (overB > 0) { b.y -= overB; box.top -= overB; box.bottom -= overB; if (b.vy > 0) b.vy = 0; }
      rects.set(b, box);
      // §E2: 정지하면 제자리로 돌아가지 않는다 — it parks where it stopped; only 복구 brings it back.
      if (!b.resting && Math.abs(b.vx) < MOVED_SLEEP_V && Math.abs(b.vy) < MOVED_SLEEP_V && Math.abs(b.vr) < MOVED_SLEEP_R) {
        b.vx = 0; b.vy = 0; b.vr = 0; b.resting = true;
      }
      writeMoved(b);
    }
    if (rects.size && !debug.noDisplaceCollide) movedCollide(t, rects);
    return busy;
  }

  /* ---- debug hooks (§F needs a way to push something without a weapon that does it yet) ---- */
  /* Same escape hatch as noAttacks / noRepair / noInvuln: §E2's numbers (mass, friction, the 400 px
   * limit) are measured on a body in free flight, and §E3's own assertions want the collisions back.
   * Nothing in the product reads it. */
  debug.noDisplaceCollide = false;
  debug.displace = (el, ix, iy, opts) => {
    const b = displaceEl(el, ix, iy, opts);
    return b ? { x: b.x, y: b.y, rot: b.rot, vx: b.vx, vy: b.vy, vr: b.vr, mass: b.mass, resting: !!b.resting } : null;
  };
  debug.moved = () => state.movedList.map((b) => ({
    id: (b.el && b.el.id) || '', tag: tagOf(b.el),
    x: b.x, y: b.y, rot: b.rot, vx: b.vx, vy: b.vy,
    resting: !!b.resting, returning: !!b.returning, mass: b.mass, reapplied: b.reapplied
  }));
  debug.movedOf = (el) => {
    const b = el && state.moved.get(el);
    return b ? { x: b.x, y: b.y, rot: b.rot, vx: b.vx, vy: b.vy, resting: !!b.resting, returning: !!b.returning, mass: b.mass, reapplied: b.reapplied } : null;
  };
  debug.undisplace = (el) => undisplace(el);
