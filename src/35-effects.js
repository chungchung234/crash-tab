  /* ===================================================================== */
  /* 4. Effects: flash, ring, shake, swing cursor                            */
  /* ===================================================================== */
  function flash(x, y, mode, opts) {
    const size = (opts && opts.size) || (mode === 'bomb' || mode === 'collapse' ? 420 : (mode === 'gun' ? 48 : 140));
    const dur = (opts && opts.dur) || (mode === 'bomb' || mode === 'collapse' ? 380 : (mode === 'gun' ? 140 : 260));
    const n = mk('div', 'crs-fx-flash');
    n.style.left = px(x); n.style.top = px(y); n.style.width = px(size); n.style.height = px(size);
    n.style.animationDuration = dur + 'ms';
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
    n.addEventListener('animationend', kill);
    later(kill, 1000);
    root.append(n);
  }
  /* SPEC-destruction §E4: "충격파 링이 0 에서 R 까지 260ms 에 걸쳐 퍼진다". The fixed 480 px ring (and the
   * rocket's fixed 960 px one) are gone: the FINAL radius is written here from the weapon's own radius, so
   * 조준점의 점선 원 = 링 최종 반지름 = WEAPONS[id].radius (§E5). `.crs-fx-ring`'s width / height carry no
   * `!important` in content.css for exactly this reason — a USER-origin !important would beat this write and
   * every blast would silently be 480 px again (CLAUDE.md: USER 오리진 CSS 함정). */
  const RING_MS = 260;
  function ring(x, y, opts) {
    const n = mk('div', 'crs-fx-ring');
    const R = (opts && isFinite(opts.r) && opts.r > 0) ? opts.r : BOMB_RADIUS;
    n.style.left = px(x); n.style.top = px(y);
    n.style.width = px(2 * R); n.style.height = px(2 * R);
    n.style.animationDuration = Math.round(scaleMs(RING_MS)) + 'ms';
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
    n.addEventListener('animationend', kill);
    later(kill, 1200);
    root.append(n);
  }
  /* ===================================================================== */
  /* fxNode — the one way a short-lived effect node is born, tracked and killed */
  /* ===================================================================== */
  /* Nine effect functions used to carry their own copy of "make the node, append it, push it on a ledger,
   * trim the ledger to a cap, build a kill closure, trackAnim(node.animate(...)) with a finish listener, and
   * later(kill, dur + N)". The copies had drifted apart in three ways (docs: SPEC-settings §2.2 caps, §3.1):
   *   · the 40-node cap was written three times and only one of them asked performance mode;
   *   · one ledger (`archNodes`) had no cap at all;
   *   · some copies handed `scaleMs(dur)` to the animation and others handed it the raw `dur` while the kill
   *     timer — later() — always scales, so under `debug.timeScale = 0.2` the node was removed before its
   *     animation was half over.
   * Here the animation length and the safety timer are scaled by the SAME call, always, so they cannot disagree.
   *
   *   cls       class name (mk() adds data-crs)
   *   o.style   { left: '12px', 'font-size': … } — CSSOM only (camelCase keys by assignment, dashed keys by
   *             setProperty), never setAttribute('style') (CLAUDE.md: 금지 목록)
   *   o.setup   fn(node) run before the node is appended (text content and the like)
   *   o.ledger  array the node is pushed on and spliced out of; o.cap is a number or a function returning one
   *             (omit it for an uncapped ledger). The OLDEST nodes are dropped to make room.
   *   o.keyframes / o.dur / o.easing   the animation. `dur` is AUTHORED milliseconds and is scaled here.
   *   o.linger  extra authored ms the safety timer waits past `dur` before removing a node whose finish event
   *             never came (default 300).
   * Returns the node, or null with no root. The caller owns any reduced-motion decision. */
  function fxNode(cls, o) {
    if (!root) return null;
    const n = mk('div', cls);
    const st = o.style;
    if (st) for (const k in st) { if (k.indexOf('-') >= 0) n.style.setProperty(k, st[k]); else n.style[k] = st[k]; }
    if (o.setup) o.setup(n);
    root.append(n);
    const ledger = o.ledger;
    if (ledger) {
      ledger.push(n);
      const cap = typeof o.cap === 'function' ? o.cap() : o.cap;
      if (cap > 0) while (ledger.length > cap) { const old = ledger.shift(); try { old.remove(); } catch (e) { /* ignore */ } }
    }
    const kill = () => {
      try { n.remove(); } catch (e) { /* ignore */ }
      if (ledger) { const k = ledger.indexOf(n); if (k >= 0) ledger.splice(k, 1); }
    };
    const dur = o.dur > 0 ? o.dur : 400;
    try {
      const a = trackAnim(n.animate(o.keyframes, { duration: scaleMs(dur), easing: o.easing || 'ease-out', fill: 'forwards' }));
      a.addEventListener('finish', kill);
    } catch (e) { /* ignore */ }
    later(kill, dur + (o.linger != null ? o.linger : 300));
    return n;
  }
  /* The one puff routine. A material's break dust (src/32-material.js) and the weapon's own particle kind
   * (src/66-fracture.js) were the same function with different numbers; those numbers are the arguments now.
   *   P  { n: [lo, hi], size: [lo, hi], rise: [lo, hi], life: [lo, hi], color, round }
   *   o  { cls, ledger, cap, blur (px), scatter (± px at birth), drift (± px sideways), grow: [lo, hi] (end
   *        scale), alpha (start opacity), reduced: 'skip' | 'mote' }
   * Reduced motion (SPEC-settings §3.1): 'skip' makes nothing; 'mote' makes ONE static mote that only fades.
   * Returns how many particles were made. */
  function fxPuff(P, x, y, o) {
    if (!root || !P) return 0;
    const reduced = reducedMotion();
    if (reduced && o.reduced === 'skip') return 0;
    const n = reduced ? 1 : randInt(P.n[0], P.n[1]);
    for (let i = 0; i < n; i++) {
      const s = rand(P.size[0], P.size[1]);
      const style = {
        left: px(x + (reduced ? 0 : rand(-o.scatter, o.scatter)) - s / 2),
        top: px(y + (reduced ? 0 : rand(-o.scatter, o.scatter)) - s / 2),
        width: px(s), height: px(s), borderRadius: P.round ? '50%' : '1px', background: P.color
      };
      if (o.blur > 0) style.filter = 'blur(' + o.blur + 'px)';
      const kf = reduced
        ? [{ opacity: 0.8 }, { opacity: 0 }]
        : [{ transform: 'translate(0px, 0px) scale(1)', opacity: o.alpha },
          { transform: 'translate(' + px(rand(-o.drift, o.drift)) + ', ' + px(-rand(P.rise[0], P.rise[1])) + ') scale(' + rand(o.grow[0], o.grow[1]).toFixed(2) + ')', opacity: 0 }];
      fxNode(o.cls, { style, ledger: o.ledger, cap: o.cap, keyframes: kf, dur: rand(P.life[0], P.life[1]) });
    }
    return n;
  }
  /* One rising puff of smoke. SPEC-destruction §E4 ("60~500ms 중심에서 연기가 피어오른다") and §F3
   * ("연기가 피어오른다 — 요소당 초당 1.5개") are the same thing seen twice, so they share one node type.
   * Tracked in `state.fire` so the existing particle cap, the restore() sweep and the §9 "흔적 없음"
   * assertions all cover it without a second ledger. */
  function smokePuff(x, y, opts) {
    if (!root || reducedMotion()) return null;
    opts = opts || {};
    const s = opts.size || rand(14, 30);
    return fxNode('crs-smoke', {
      style: {
        left: px(x - s / 2), top: px(y - s / 2), width: px(s), height: px(s), borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(58,52,48,.5) 0%, rgba(58,52,48,.26) 50%, rgba(58,52,48,0) 72%)'
      },
      ledger: state.fire, cap: particleCap,
      keyframes: [
        { transform: 'translateY(0px) scale(.6)', opacity: 0.55 },
        { transform: 'translateY(' + px(-rand(34, 72)) + ') scale(1.5)', opacity: 0 }
      ],
      dur: opts.dur || rand(600, 1000), linger: 400
    });
  }
  /* Test-only read-back and driver for the effect ledgers (same family as debug.perf / debug.burning). Lengths,
   * not node counts, so a test can compare a ledger with the cap that is supposed to bound it. */
  debug.fxLedgers = () => ({
    fire: state.fire.length, matFx: matFx.length, dmg: state.dmgNodes.length, arch: archNodes.length, frag: fragFx.length,
    particleCap: particleCap(), fragCap: fragCap()
  });
  /* kind: 'fire' | 'mat' | 'dmg' | 'frag' | 'row' (`sel` picks the row element a flash covers). Makes `count`
   * of that effect at (x, y) through the same functions the product calls. Returns the number asked for. */
  debug.fxSpawn = (kind, count, x, y, sel) => {
    const row = kind === 'row' ? doc.querySelector(sel || 'body *') : null;
    for (let i = 0; i < count; i++) {
      if (kind === 'fire') spawnFire(x, y, 1);
      else if (kind === 'mat') matBurst('panel', x, y);
      else if (kind === 'dmg') spawnDmg(x, y, 1, false);
      else if (kind === 'frag') fracParticles('dust', x, y);
      else if (kind === 'row') flashRow(row);
    }
    return count;
  };
  function shake(mode, opts) {
    let a = (opts && opts.amp != null) ? opts.amp : (mode === 'bomb' || mode === 'collapse' ? 12 : (mode === 'gun' ? 2 : 6));
    if (reducedMotion()) a = 0;   // SPEC-settings §3.1: reduced motion means amplitude 0, OS- or setting-driven
    if (!a || !root) return;
    try { if (state.shake) state.shake.cancel(); } catch (e) { /* ignore */ }
    const ang = rand(0, Math.PI * 2), ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux;
    const offs = [1, -0.7, 0.45, -0.25, 0.1, 0], times = [0, 0.15, 0.35, 0.55, 0.8, 1];
    const kf = offs.map((k, i) => ({
      transform: 'translate(' + px(ux * a * k + vx * 0.4 * a * k) + ',' + px(uy * a * k + vy * 0.4 * a * k) + ')',
      offset: times[i]
    }));
    try {
      state.shake = root.animate(kf, { duration: (opts && opts.dur) || (mode === 'bomb' || mode === 'collapse' ? 420 : 240), easing: 'linear' });
      trackAnim(state.shake);
    } catch (e) { state.shake = null; }
  }
  function swingCursor() {
    try { docEl.classList.add('crs-swing'); } catch (e) { /* ignore */ }
    untrack(state.swingTimer);
    state.swingTimer = later(() => { state.swingTimer = 0; try { docEl.classList.remove('crs-swing'); } catch (e) { /* ignore */ } }, 120);
  }
