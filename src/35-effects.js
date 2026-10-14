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
  /* One rising puff of smoke. SPEC-destruction §E4 ("60~500ms 중심에서 연기가 피어오른다") and §F3
   * ("연기가 피어오른다 — 요소당 초당 1.5개") are the same thing seen twice, so they share one node type.
   * Tracked in `state.fire` so the existing particle cap, the restore() sweep and the §9 "흔적 없음"
   * assertions all cover it without a second ledger. */
  function smokePuff(x, y, opts) {
    if (!root || reducedMotion()) return null;
    opts = opts || {};
    const s = opts.size || rand(14, 30);
    const n = mk('div', 'crs-smoke');
    n.style.left = px(x - s / 2); n.style.top = px(y - s / 2);
    n.style.width = px(s); n.style.height = px(s); n.style.borderRadius = '50%';
    n.style.background = 'radial-gradient(circle, rgba(58,52,48,.5) 0%, rgba(58,52,48,.26) 50%, rgba(58,52,48,0) 72%)';
    root.append(n);
    state.fire.push(n);
    while (state.fire.length > particleCap()) { const old = state.fire.shift(); try { old.remove(); } catch (e) { /* ignore */ } }
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } const k = state.fire.indexOf(n); if (k >= 0) state.fire.splice(k, 1); };
    const dur = opts.dur || rand(600, 1000);
    try {
      const a = trackAnim(n.animate([
        { transform: 'translateY(0px) scale(.6)', opacity: 0.55 },
        { transform: 'translateY(' + px(-rand(34, 72)) + ') scale(1.5)', opacity: 0 }
      ], { duration: dur, easing: 'ease-out', fill: 'forwards' }));
      a.addEventListener('finish', kill);
    } catch (e) { /* ignore */ }
    later(kill, dur + 400);
    return n;
  }
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
