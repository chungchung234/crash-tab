// ── hit resolution: floating damage numbers, hit tint, hold-window aggregation, applyHit, bullet chips, AoE candidates/falloff ──
  /* --- cooldown (A3): one global timestamp, set only when an attack actually happened --- */
  function onCooldown() { return !debug.noCooldown && now() < state.cooldownUntil; }
  function startCooldown(id, ms) {
    if (!(ms > 0) || debug.noCooldown) return;   // nothing recorded while cooldowns are disabled (a later flip starts clean)
    state.cooldownUntil = now() + ms;
    if (ms < 500) return;   // the dim reads as a real timer only on axe / bomb / rocket / collapse
    try { const b = weaponBtn(id); if (b) trackAnim(b.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: ms, easing: 'linear' })); } catch (e) { /* ignore */ }
  }
  function cooldownFeedback() {   // a click during cooldown is never silent
    sfx('clack');
    if (reducedMotion()) return;
    try { const b = weaponBtn(state.weapon); if (b) trackAnim(b.animate([{ borderColor: '#ff6b6b' }, { borderColor: 'rgba(255,255,255,.1)' }], { duration: 120 })); } catch (e) { /* ignore */ }
  }

  /* --- floating damage numbers (A5 item 1): "-65", crit "-130!" in gold, rise 44 px over 650 ms, cap 40 --- */
  function dmgText(n, dmg, crit, tag) { n.textContent = (tag ? tag + ' ' : '') + '-' + dmg + (crit ? '!' : ''); }
  /* opts (v1.2): { tag: '헤드샷!' prefix, color, text: literal text instead of "-dmg" (kill / player damage) } */
  function spawnDmg(x, y, dmg, crit, opts) {
    if (!root) return null;
    opts = opts || {};
    const n = mk('div', 'crs-dmg');
    if (opts.text != null) n.textContent = opts.text; else dmgText(n, dmg, crit, opts.tag);
    n.style.left = px(x); n.style.top = px(y);
    n.style.font = '700 ' + (crit ? 18 : 14) + 'px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    n.style.color = opts.color || (crit ? '#ffd166' : '#fff');
    n.style.textShadow = '0 1px 2px rgba(0,0,0,.8)';
    n.style.transform = 'translate(-50%, -50%)';
    root.append(n);
    state.dmgNodes.push(n);
    while (state.dmgNodes.length > 40) { const old = state.dmgNodes.shift(); try { old.remove(); } catch (e) { /* ignore */ } }
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } const i = state.dmgNodes.indexOf(n); if (i >= 0) state.dmgNodes.splice(i, 1); };
    try {
      const base = 'translate(-50%, -50%) ';
      const kf = crit
        ? [{ transform: base + 'translateY(0px) scale(1.4)', opacity: 1, offset: 0 }, { transform: base + 'translateY(-8px) scale(1)', opacity: 0.95, offset: 0.18 }, { transform: base + 'translateY(-44px) scale(1)', opacity: 0, offset: 1 }]
        : [{ transform: base + 'translateY(0px)', opacity: 1 }, { transform: base + 'translateY(-44px)', opacity: 0 }];
      const a = trackAnim(n.animate(kf, { duration: 650, easing: 'ease-out', fill: 'forwards' }));
      a.addEventListener('finish', kill);
    } catch (e) { /* ignore */ }
    later(kill, 1500);
    return n;
  }
  /* Where a number goes: pointer ± 8 px (click), alternating 24 px left/right of the pointer (hold windows; ≥ 42 px
   * between consecutive centres so a 25 px glyph run never collides with the previous window's number),
   * centre of rect ∩ viewport nudged 10 px toward the blast / slash (AoE, slash). */
  function dmgPos(el, ix, iy, opts) {
    if (opts.aoe || opts.slash) {
      const r = rectOf(el);
      if (r) {
        const v = intersectRect(r, { left: 0, top: 0, right: viewW(), bottom: viewH() });
        let x = v.left + v.width / 2, y = v.top + v.height / 2;
        if (opts.toward) { const dx = opts.toward.x - x, dy = opts.toward.y - y, L = Math.hypot(dx, dy); if (L > 1) { x += dx / L * 10; y += dy / L * 10; } }
        return { x: x + rand(-8, 8), y: y + rand(-8, 8) };
      }
    }
    if (opts.win) return { x: ix + opts.win.side * 24 + rand(-3, 3), y: iy - 4 + rand(-3, 3) };
    return { x: ix + rand(-8, 8), y: iy + rand(-8, 8) };
  }

  /* --- hit tint (A5 item 2): a radial splash on the element rect, one node per element --- */
  function tintGradient(rect, ix, iy) {
    const R = clamp(0.5 * Math.sqrt(Math.max(1, rect.width * rect.height)), 60, 220);
    return 'radial-gradient(circle at ' + px(ix - rect.left) + ' ' + px(iy - rect.top) + ', rgba(229,72,77,.30) 0px, rgba(229,72,77,.22) 40%, rgba(229,72,77,0) ' + px(R) + ')';
  }
  function removeTint(el) {
    const t = state.tints.get(el);
    if (!t) return;
    state.tints.delete(el);
    untrack(t.timer);
    try { if (t.anim) t.anim.cancel(); } catch (e) { /* ignore */ }
    try { t.node.remove(); } catch (e) { /* ignore */ }
  }
  function tintFade(el, t, from) {
    const n = t.node;
    if (reducedMotion()) { n.style.opacity = '0.1'; t.timer = later(() => removeTint(el), 180); return; }
    n.style.opacity = String(from);
    try {
      t.anim = trackAnim(n.animate([{ opacity: from }, { opacity: 0 }], { duration: 180, easing: 'ease-out', fill: 'forwards' }));
      t.anim.addEventListener('finish', () => removeTint(el));
    } catch (e) { /* ignore */ }
    t.timer = later(() => removeTint(el), 400);
  }
  function showTint(el, rect, ix, iy, hold) {
    if (!root) return;
    let t = state.tints.get(el);
    if (!t) {
      const n = mk('div', 'crs-hit');
      const s = gcs(el); if (s) n.style.borderRadius = s.borderRadius;
      root.append(n);
      t = { node: n, anim: null, timer: 0, hold: false };
      state.tints.set(el, t);
    }
    const n = t.node;
    n.style.left = px(rect.left); n.style.top = px(rect.top); n.style.width = px(rect.width); n.style.height = px(rect.height);
    n.style.background = tintGradient(rect, ix, iy);
    if (hold && t.hold) return;   // persistent hold tint: re-centred, never re-flashed
    try { if (t.anim) { t.anim.cancel(); t.anim = null; } } catch (e) { /* ignore */ }
    untrack(t.timer); t.timer = 0;
    if (hold) { t.hold = true; n.style.opacity = reducedMotion() ? '0.1' : '0.14'; return; }
    t.hold = false;
    tintFade(el, t, 1);
  }
  function moveTint(el, rect, ix, iy) {   // hold ticks between fx windows: the gradient centre follows the pointer
    const t = state.tints.get(el);
    if (!t || !t.hold) return;
    t.node.style.left = px(rect.left); t.node.style.top = px(rect.top); t.node.style.width = px(rect.width); t.node.style.height = px(rect.height);
    t.node.style.background = tintGradient(rect, ix, iy);
  }
  function fadeTint(el) {   // hold released / target changed
    const t = state.tints.get(el);
    if (!t || !t.hold) return;
    t.hold = false;
    tintFade(el, t, reducedMotion() ? 0.1 : 0.14);
  }

  /* --- hold aggregation windows (A4 / A5): one crit roll + one number + one HUD line per 150 ms per element --- */
  function holdWindow(el) {
    const t = now();
    let w = state.dmgAgg.get(el);
    if (w && t - w.at >= HOLD_WINDOW) { flushWindow(el, w); w = null; }
    if (!w) {
      const rec = hpOf(el);
      const crit = rollCrit();
      if (crit) { state.crits++; sfx('crit', { gain: 0.7 }); }   // one audible cue per crit window (A4); the per-tick gun sound stays plain
      rec.side = rec.side === 1 ? -1 : 1;
      w = { el, at: t, sum: 0, crit, side: rec.side, node: null };
      state.dmgAgg.set(el, w);
      if (state.hold) state.hold.open.add(el);
    }
    return w;
  }
  function flushWindow(el, w) {
    if (state.dmgAgg.get(el) === w) state.dmgAgg.delete(el);
    if (state.hold) state.hold.open.delete(el);
    const rec = state.hp.get(el);
    if (w && rec && w.sum > 0) hudLastHit(el, w.sum, rec.hp, rec.max, w.crit);
  }

  /* applyHit — the single damage sink. opts: { crit, hold, win, aoe, slash, toward, pieces, textSplit, splitLine,
   * burnt, radius }. Returns 'broken' | 'damaged' | 'none'. */
  function applyHit(el, dmg, kind, ix, iy, opts) {
    opts = opts || {};
    if (!el) return 'none';
    try { if (el.hasAttribute('data-crs-broken')) return 'none'; } catch (e) { return 'none'; }   // broken meanwhile (staggered AoE, hold tick, collapse chain)
    const rec = hpOf(el);
    rec.hp -= dmg;
    state.damageDealt += dmg;
    const crit = !!opts.crit;
    const broken = rec.hp <= 0;
    const win = opts.hold ? opts.win : null;
    if (win) {
      win.sum += dmg;
      if (win.node && win.node.isConnected) dmgText(win.node, win.sum, win.crit);
      else { const p = dmgPos(el, ix, iy, opts); win.node = spawnDmg(p.x, p.y, win.sum, win.crit); }
      if (broken) flushWindow(el, win);
    } else {
      if (crit) state.crits++;
      const p = dmgPos(el, ix, iy, opts);
      spawnDmg(p.x, p.y, dmg, crit, crit && opts.headshot ? { tag: msg('headshotLabel') } : null);
      hudLastHit(el, dmg, rec.hp, rec.max, crit, !!opts.headshot);
    }
    if (broken) {
      removeTint(el);   // pieces are already flying
      breakElement(el, ix, iy, Object.assign({ mode: kind }, opts));
      refreshHover();
      return 'broken';
    }
    const t = now();
    const rect = rectOf(el);
    const fxOk = !opts.hold || t - (rec.lastFxAt || 0) >= HOLD_WINDOW;
    if (fxOk) {
      rec.lastFxAt = t;
      if (rect) { reactDamage(el, ix, iy, rect); showTint(el, rect, ix, iy, !!opts.hold); }
    } else if (rect) moveTint(el, rect, ix, iy);
    if (state.hoverEl === el) showTarget(el); else refreshHover();
    if (fxOk) pulseTarget();
    if (crit && state.hoverEl === el && (!win || win.sum === dmg)) critFlashFill();   // once per crit (first tick of a hold window), not per tick
    return 'damaged';
  }

  /* Bullet-hole glass chips (A18): ordinary physics pieces (cap, eviction,
   * stats().pieces) but NOT element debris — they carry crs-chip instead of
   * crs-debris and are excluded from stats().debris, because A31 requires the
   * debris count to stay unchanged on a damage-only gun shot. */
  function spawnChips(x, y, count) {
    const n = count || randInt(3, 5), made = [];
    for (let i = 0; i < n; i++) {
      const s = rand(6, 10);
      const node = mk('div', 'crs-piece crs-chip');
      node.style.left = px(x - s / 2); node.style.top = px(y - s / 2); node.style.width = px(s); node.style.height = px(s);
      node.style.background = 'rgba(236,243,255,.92)'; node.style.boxShadow = '0 0 1px rgba(0,0,0,.6)';
      node.style.clipPath = 'polygon(' + px(rand(0, s * 0.3)) + ' 0px, ' + px(s) + ' ' + px(rand(0, s * 0.4)) + ', ' + px(rand(s * 0.4, s)) + ' ' + px(s) + ', 0px ' + px(rand(s * 0.5, s)) + ')';
      node.style.transformOrigin = px(s / 2) + ' ' + px(s / 2);
      const v = velocityFor('gun', x, y, x + rand(-4, 4), y + rand(-4, 4), null);
      made.push([node, { ox: x - s / 2, oy: y - s / 2, w: s, h: s, vx: v.vx * 1.4, vy: v.vy * 1.4 - 60, vr: v.vr * 2, cx: s / 2, cy: s / 2, bb: { minX: 0, minY: 0, maxX: s, maxY: s }, word: true, chip: true }]);
    }
    enforceCap(made.length, batchGpu(made));
    for (const [node, p] of made) addPiece(node, p);
  }
  function edgeDist(rect, x, y) {
    const dx = Math.max(rect.left - x, 0, x - rect.right), dy = Math.max(rect.top - y, 0, y - rect.bottom);
    return Math.hypot(dx, dy);
  }
  /* AoE candidates (A7): the element under the blast centre is always candidate 0 (edgeDist 0); ring samples
   * drop its descendants AND its ancestors (the centre is the only candidate on its chain, exactly as v1
   * bombCandidates — where the blast point itself fed the ancestor filter), then the v1 ancestor filter over the
   * remaining samples; sort by edge distance, keep maxTargets. */
  function aoeCandidates(x, y, R, maxTargets, rings) {
    const seen = new Set(), list = [], cache = new Map();
    const centre = pickTarget(x, y, cache);
    const vw = viewW(), vh = viewH();
    for (const r of rings) {
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4, pxv = x + Math.cos(a) * r, pyv = y + Math.sin(a) * r;
        if (pxv < 0 || pyv < 0 || pxv > vw || pyv > vh) continue;
        const el = pickTarget(pxv, pyv, cache);
        if (!el || el === centre || seen.has(el)) continue;
        if (centre && (centre.contains(el) || el.contains(centre))) continue;
        seen.add(el); list.push(el);
      }
    }
    const filtered = list.filter((el) => !list.some((o) => o !== el && el.contains(o)));
    const out = [];
    if (centre) out.push({ el: centre, d: 0 });
    for (const el of filtered) {
      const r = rectOf(el); if (!r) continue;
      const d = edgeDist(r, x, y);
      if (d <= R) out.push({ el, d });
    }
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, maxTargets);
  }
  /* Falloff damage round(centre · (1 − 0.73·t)), t = edgeDist / R → centre 100 %, edge 27 %; stagger edgeDist / 4 ms. */
  function aoeHit(x, y, W) {
    const R = W.radius;
    const cands = aoeCandidates(x, y, R, W.maxTargets, W.rings);
    const plan = cands.map((c, i) => { const crit = rollCrit(); return { c, i, crit, dmg: rollDamage(Math.round(W.damage * (1 - 0.73 * clamp(c.d / R, 0, 1))), crit) }; });
    if (plan.some((p) => p.crit)) sfx('crit', { gain: 0.9 });   // the blast sound has already played; add the ×1.5 sparkle once (A4)
    for (const { c, i, crit, dmg } of plan) {
      const fire = () => { if (state.active && c.el.isConnected) applyHit(c.el, dmg, 'bomb', x, y, { textSplit: i === 0, aoe: true, crit, radius: R, toward: { x, y } }); scheduleHud(); };
      const delay = c.d / 4;
      if (delay < 1) fire(); else later(fire, delay);
    }
  }
