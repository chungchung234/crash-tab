  /* ===================================================================== */
  /* 1c. Performance guard (SPEC-settings §2)                               */
  /*                                                                        */
  /* Three parts: a cheap measurement (§2.1), one table of things that come  */
  /* down in `performance` mode (§2.2), and a memoised candidate walk with   */
  /* a MutationObserver behind it (§2.3). Every consumer asks a function     */
  /* here instead of reading a constant, so the guard never has to reach     */
  /* into another module's state.                                           */
  /* ===================================================================== */
  const PERF_SAMPLE_MS = 10000;      // §2.1: re-measure every 10 s while active
  const PERF_FRAMES = 30;            // §2.1: average tick() cost over the last 30 frames
  const PERF_ELEMENTS = 8000;        // §2.1: element count above which `auto` picks performance
  const PERF_TICK_MS = 8;            // §2.1: average tick cost above which `auto` picks performance
  /* §2.2 — the downgrade table. Where the current default already differs from the figure the spec quotes
   * in its "기본" column, the DEFAULT is left exactly as it ships (changing it would be a behaviour change,
   * not a performance guard) and only the `performance` figure is applied:
   *   piece cap        the debrisCap setting (160)      → min(setting, 80)
   *   decal cap        40                               → 12      (src/31-decal.js)
   *   text split       descendants 200 / tokens 80      → 120 / 40
   *   clone compare    400 descendants                  → 150
   *   enemy selection  900 ms (SPEC-combat §B3 — was 1500) → 2500 ms
   *   concurrent enemies  up to 7 (§B3 — was 5)         → 2
   *   particles        40 live (ships as 40, not 60)    → 30
   *   crack strands    ×1.0                             → ×0.7
   *   canvas DPR       max 2                            → max 1.5                                        */
  const PERF_PIECE_CAP = 80;
  const PERF_TEXT_DESCENDANTS = 120, TEXT_DESCENDANTS = 200;
  const PERF_TEXT_TOKENS = 40, TEXT_TOKENS = 80;
  const PERF_CLONE_CAP = 150;
  const PERF_SELECT_MS = 2500, SELECT_MS = 900;   // SPEC-combat §B3: 선정 간격 1500 → 900 ms
  const PERF_MAX_HOSTILES = 2;
  const PERF_PARTICLE_CAP = 30, PARTICLE_CAP = 40;
  const PERF_CRACK_MUL = 0.7;
  const PERF_DPR = 1.5, QUALITY_DPR = 2;

  /* `state.perf` is the published reading (src/31-decal.js already consults it). `mode` is the EFFECTIVE
   * mode — what everything downgrades against — while the setting stays auto | quality | performance. */
  state.perf = { mode: 'quality', elements: 0, avgTickMs: 0, auto: 'quality' };
  state.perfTimer = 0;
  const perfFrames = new Float64Array(PERF_FRAMES);
  let perfFrameN = 0, perfFrameI = 0;

  function perfMode() { return state.perf.mode; }
  function perfOn() { return state.perf.mode === 'performance'; }
  function perfAvgTick() {
    if (!perfFrameN) return 0;
    let s = 0;
    const n = Math.min(perfFrameN, PERF_FRAMES);
    for (let i = 0; i < n; i++) s += perfFrames[i];
    return s / n;
  }
  /* Every frame feeds the average. tickFrame() is wrapped rather than edited so src/92-tick.js stays the
   * physics loop and nothing else; a frame that throws still records its cost (try/finally) and still throws. */
  const tickFrameBase = tickFrame;
  tickFrame = function (t) {
    const t0 = now();
    try { return tickFrameBase(t); }
    finally {
      perfFrames[perfFrameI] = now() - t0;
      perfFrameI = (perfFrameI + 1) % PERF_FRAMES;
      perfFrameN++;
    }
  };

  function perfElements() {
    try { return doc.getElementsByTagName('*').length; } catch (e) { return 0; }
  }
  /* §2.1: auto picks performance above 8000 elements OR above an 8 ms average tick; quality / performance
   * are forced values. Returns true when the effective mode changed. */
  function perfResolve(remeasure) {
    const p = state.perf;
    if (remeasure) { p.elements = perfElements(); p.avgTickMs = perfAvgTick(); }
    /* the 8 ms rule is an average over 30 frames (§2.1) — judging it on three noisy ones would flip the
     * whole page into performance mode because one frame happened to be descheduled */
    const tickSays = perfFrameN >= PERF_FRAMES && p.avgTickMs > PERF_TICK_MS;
    p.auto = (p.elements > PERF_ELEMENTS || tickSays) ? 'performance' : 'quality';
    const want = settingsGet('perfMode');
    const next = (want === 'quality' || want === 'performance') ? want : p.auto;
    if (next === p.mode) { perfBadgeSync(); return false; }
    p.mode = next;
    perfBadgeSync();
    /* the piece cap may have just come down; evict down to it rather than waiting for the next break */
    try { enforceCap(0, 0); } catch (e) { /* ignore */ }
    try { updateHud(); } catch (e) { /* ignore */ }
    return true;
  }
  function perfTick() {
    state.perfTimer = 0;
    if (!state.active) return;
    perfResolve(true);
    state.perfTimer = later(perfTick, PERF_SAMPLE_MS);
  }
  function perfArm() {
    untrack(state.perfTimer); state.perfTimer = 0;
    if (!state.active) return;
    state.perfTimer = later(perfTick, PERF_SAMPLE_MS);
  }
  function perfStart() {
    perfFrameN = 0; perfFrameI = 0;
    perfResolve(true);          // §2.1: measured once at activation, then every 10 s
    walkObserve();
    perfArm();
  }
  function perfStop() {
    untrack(state.perfTimer); state.perfTimer = 0;
    walkUnobserve();
    perfBadgeDrop();
  }
  function perfInfo() {
    return { mode: state.perf.mode, elements: state.perf.elements, avgTickMs: Math.round(state.perf.avgTickMs * 100) / 100, cap: pieceCap() };
  }

  /* ---- §2.2 the downgrade table, one accessor per row ---- */
  function pieceCap() {
    const want = settingsGet('debrisCap');
    const base = (typeof want === 'number' && want > 0) ? want : CAP;
    return perfOn() ? Math.min(base, PERF_PIECE_CAP) : base;
  }
  function textDescendantCap() { return perfOn() ? PERF_TEXT_DESCENDANTS : TEXT_DESCENDANTS; }
  function textTokenCap() { return perfOn() ? PERF_TEXT_TOKENS : TEXT_TOKENS; }
  function cloneCapFor(base) { return perfOn() ? Math.min(base, PERF_CLONE_CAP) : base; }
  function selectIntervalMs() { return perfOn() ? PERF_SELECT_MS : SELECT_MS; }
  function particleCap() { return perfOn() ? PERF_PARTICLE_CAP : PARTICLE_CAP; }
  function crackRayMul() { return perfOn() ? PERF_CRACK_MUL : 1; }
  function perfDprMax() { return perfOn() ? PERF_DPR : QUALITY_DPR; }

  /* ---- §2.3 the memoised candidate walk --------------------------------------
   * walkCandidates() is the single most expensive thing the extension does on a big page: one BFS over the
   * document per collapse, per enemy-selection tick and per repair pick. The TRAVERSAL is memoised for
   * 300 ms, keyed by viewport size + round(scrollY / 100) (plus the option signature, because the three
   * callers ask for different areas and a shared cache would hand one of them the other's answer). The
   * distance to the impact point is NOT cached — it is recomputed per call from the cached rect, so a
   * second call at a different point still sorts correctly while the walk itself runs once.
   *
   * A MutationObserver on document.body (childList + subtree, counter only) invalidates the cache the
   * moment the page's structure changes, and deactivate() disconnects it. Our own nodes live under
   * documentElement, not body, so debris never invalidates the cache it is not part of. */
  const WALK_MEMO_MS = 300;
  const WALK_MEMO_MAX = 4;
  const walkMemo = new Map();          // sig -> { key, at, out }
  const walkSkipIds = new WeakMap();
  let walkSkipSeq = 0, walkEpoch = 0, walkMo = null;
  /* Counters for the §2.4 cache assertion: calls vs. real traversals. `debug.scanCount` is the same
   * number on the public debug object — a plain integer, so api.debug()'s flag copy picks it up — and it
   * increments once per REAL traversal and never on a cache hit. */
  const walkCount = { calls: 0, runs: 0 };
  debug.scanCount = 0;

  function walkSig(opts) {
    let sid = 0;
    const skip = opts && opts.skip;
    if (skip) {
      sid = walkSkipIds.get(skip) || 0;
      if (!sid) { sid = ++walkSkipSeq; walkSkipIds.set(skip, sid); }
    }
    return Math.round((opts && opts.limit) || 0) + ':' + ((opts && opts.minArea) || 0) + ':' + (opts && opts.descendCollected ? 1 : 0) + ':' + sid;
  }
  function walkKey() {
    let sy = 0;
    try { sy = win.scrollY || win.pageYOffset || 0; } catch (e) { sy = 0; }
    /* a skip() predicate reads live state (hostileSkip reads state.hostiles), so its answer changes when
     * that set does — fold the size in so a stale list can never be handed back */
    return viewW() + 'x' + viewH() + '@' + Math.round(sy / 100) + '#' + walkEpoch + '/' + state.hostiles.size;
  }
  function walkObserve() {
    if (walkMo) return;
    const body = doc.body;
    if (!body) return;
    try {
      /* A COUNTER, as §2.3 asks — the records are never inspected. Our own nodes cannot reach it: the
       * shield, the fx root and the HUD are all mounted on documentElement, not on body, so debris,
       * decals and HUD churn never invalidate a cache they are not part of. */
      walkMo = new MutationObserver(() => { walkEpoch++; });
      walkMo.observe(body, { childList: true, subtree: true });
    } catch (e) { walkMo = null; }
  }
  function walkUnobserve() {
    if (walkMo) { try { walkMo.disconnect(); } catch (e) { /* ignore */ } walkMo = null; }
    walkMemo.clear();
  }
  function walkCandidates(x, y, opts) {
    opts = opts || {};
    walkCount.calls++;
    const sig = walkSig(opts), key = walkKey(), t = now();
    let rec = walkMemo.get(sig);
    if (!rec || rec.key !== key || t - rec.at > WALK_MEMO_MS) {
      walkCount.runs++; debug.scanCount = (debug.scanCount || 0) + 1;
      rec = { key, at: t, out: walkCandidatesRaw(x, y, opts) };
      walkMemo.set(sig, rec);
      while (walkMemo.size > WALK_MEMO_MAX) { const first = walkMemo.keys().next(); if (first.done) break; walkMemo.delete(first.value); }
      /* the fresh walk already measured distance from (x, y) — hand the caller its own copy */
      return rec.out.map(walkCopy);
    }
    const out = rec.out.map((c) => {
      const o = walkCopy(c);
      if (c.r) o.d = edgeDist(c.r, x, y);
      return o;
    });
    out.sort((a, b) => a.d - b.d);
    return out;
  }
  /* A fresh object per call: src/90-combat.js writes `c.w` onto the entries it is given. */
  function walkCopy(c) { return { el: c.el, d: c.d, cx: c.cx, cy: c.cy, area: c.area, r: c.r }; }

  /* ---- §2.3 the HUD badge shown while the guard has us in performance mode ---- */
  function perfBadgeSync() {
    const title = hudEls.title;
    if (!title) return;
    if (!perfOn()) { perfBadgeDrop(); return; }
    let b = hudEls.perfBadge;
    if (!b || !b.isConnected) {
      try {
        b = doc.createElement('span');
        b.className = 'crs-perfbadge';
        const s = b.style;
        s.marginLeft = 'auto'; s.padding = '1px 6px'; s.borderRadius = '7px';
        s.fontSize = '10px'; s.fontWeight = '700'; s.letterSpacing = '.2px';
        s.background = 'rgba(255,178,36,.22)'; s.color = '#ffb224';
        s.border = '1px solid rgba(255,178,36,.5)'; s.whiteSpace = 'nowrap';
        title.append(b);
        hudEls.perfBadge = b;
      } catch (e) { return; }
    }
    try { b.textContent = '⚡ ' + msg('perfBadge'); b.title = msg('setPerfMode'); } catch (e) { /* ignore */ }
  }
  function perfBadgeDrop() {
    const b = hudEls.perfBadge;
    if (b) { try { b.remove(); } catch (e) { /* ignore */ } }
    hudEls.perfBadge = null;
  }

  /* debug.perf(): the measurement and the cache counters in one place, for diagnosing a page that sits in
   * the wrong mode. A function, so api.debug's flag-copying helpers skip it. */
  debug.perf = () => Object.assign(perfInfo(), {
    setting: settingsGet('perfMode'), auto: state.perf.auto,
    walkCalls: walkCount.calls, walkRuns: walkCount.runs, walkCached: walkMemo.size, observing: !!walkMo
  });
  debug.perfResolve = () => perfResolve(true);
  debug.walkReset = () => { walkCount.calls = 0; walkCount.runs = 0; debug.scanCount = 0; walkMemo.clear(); };
