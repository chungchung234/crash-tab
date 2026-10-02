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
  function ring(x, y, opts) {
    const n = mk('div', 'crs-fx-ring');
    if (opts && opts.xl) n.classList.add('crs-fx-ring-xl');   // rocket: 2× ring (A7)
    n.style.left = px(x); n.style.top = px(y);
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
    n.addEventListener('animationend', kill);
    later(kill, 1200);
    root.append(n);
  }
  function shake(mode, opts) {
    let a = (opts && opts.amp != null) ? opts.amp : (mode === 'bomb' || mode === 'collapse' ? 12 : (mode === 'gun' ? 2 : 6));
    try { if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) a = 0; } catch (e) { /* ignore */ }
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
