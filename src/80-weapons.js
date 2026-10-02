  /* ===================================================================== */
  /* 12. Weapons (v1.1): damage roll, hit feedback, the nine fire() entries, actions   */
  /* ===================================================================== */
  function rollCrit() { return debug.forceCrit ? true : (debug.noCrit ? false : Math.random() < 0.1); }
  function rollSniperCrit(scoped) { return debug.forceCrit ? true : (debug.noCrit ? false : Math.random() < (scoped ? 0.25 : 0.1)); }   // 헤드샷 (v1.2 §2)
  function rollDamage(base, crit) { return Math.max(1, Math.round(base * state.power * (crit ? 2 : 1))); }
  function reducedMotion() { try { return win.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function weaponBtn(id) { return (hudEls.weaponBtns && hudEls.weaponBtns[id]) || null; }
  function willBreak(el, dmg) { if (!el) return false; const r = state.hp.get(el); return (r ? r.hp : hpMax(el)) - dmg <= 0; }

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

  /* --- fire(x, y, ctx) entries. ctx.hold: fired by a hold tick (ctx.h = the hold session); each returns the element hit --- */
  function fireHammer(x, y) {
    state.shots++;
    if (interceptOrb(x, y)) return null;   // v1.2 A9: an orb within 18 px absorbs the blow, the page is untouched
    const el = pickTarget(x, y);
    const crit = el ? rollCrit() : false;
    const dmg = rollDamage(WEAPONS.hammer.damage, crit);
    sfx(!el || willBreak(el, dmg) ? 'hammer' : 'thump', { crit });   // thump only when merely dented (A24)
    flash(x, y, 'hammer'); shake('hammer', { amp: crit ? 8.4 : 6 });
    drawCrack(x, y, 'hammer', { ink: 1 });
    if (el) applyHit(el, dmg, 'hammer', x, y, { crit });
    return el;
  }
  function firePistol(x, y) {
    state.shots++;
    if (interceptOrb(x, y)) return null;
    const el = pickTarget(x, y);
    const crit = el ? rollCrit() : false;
    const dmg = rollDamage(WEAPONS.pistol.damage, crit);
    sfx('gun', { crit });
    flash(x, y, 'gun'); shake('gun', { amp: crit ? 2.8 : 2 });
    drawCrack(x, y, 'gun', { ink: 0.25 });
    spawnChips(x, y, randInt(3, 5));
    if (el) applyHit(el, dmg, 'gun', x, y, { crit });
    return el;
  }
  function fireSmg(x, y, c) {
    state.shots++;
    const h = (c && c.hold && c.h) || null;
    const n = h ? h.tick : 1;
    x += rand(-9, 9); y += rand(-9, 9);
    if (interceptOrb(x, y)) return null;   // v1.2 A9: the tick is consumed by the orb
    const el = pickTarget(x, y, h ? h.cache : undefined);
    let dmg = 0, crit = false, win = null;
    if (el) {
      if (h) { win = holdWindow(el); crit = win.crit; } else crit = rollCrit();
      dmg = rollDamage(WEAPONS.smg.damage, crit);
    }
    if (!h || n % 2 === 1) sfx('gun', { gain: 0.6, crit: !h && crit });   // one sound per 2 shots; a hold window's crit cue comes from holdWindow()
    flash(x, y, 'gun', { size: 32, dur: 100 });
    if (!h || n % 3 === 0) { shake('gun', { amp: 1 }); spawnChips(x, y, randInt(1, 2)); }   // every 3rd shot
    drawCrack(x, y, 'smg', { ink: 0.25 });
    if (el) applyHit(el, dmg, 'gun', x, y, { crit, hold: !!h, win });
    return el;
  }
  function fireAxe(x, y) {
    state.shots++;
    if (interceptOrb(x, y)) return null;
    const el = pickTarget(x, y);
    const crit = el ? rollCrit() : false;
    const dmg = rollDamage(WEAPONS.axe.damage, crit);
    sfx(!el || willBreak(el, dmg) ? 'hammer' : 'thump', { crit, pitch: 0.75, gain: 1.15 });
    flash(x, y, 'hammer', { size: 190, dur: 300 }); shake('hammer', { amp: crit ? 9.8 : 7 });
    drawCrack(x, y, 'hammer', { rays: [5, 7], lenScale: 1.3, ink: 1 });
    // a broken element splits in two along a jagged near-vertical line through the impact (A8)
    if (el) applyHit(el, dmg, 'hammer', x, y, { crit, pieces: 2, textSplit: false, splitLine: { angle: (90 + rand(-15, 15)) * DEG, cx: x, cy: y } });
    return el;
  }
  function fireStab(x, y) {   // sword click / drag shorter than 12 px
    state.shots++;
    if (interceptOrb(x, y)) return null;
    const el = pickTarget(x, y);
    const crit = el ? rollCrit() : false;
    const dmg = rollDamage(WEAPONS.sword.damage, crit);
    sfx('swish', { crit });
    flash(x, y, 'hammer', { size: 90, dur: 200 }); shake('hammer', { amp: crit ? 4.2 : 3 });
    drawCrack(x, y, 'hammer', { rays: [4, 6], lenScale: 0.45, ink: 0.5 });
    if (el) applyHit(el, dmg, 'hammer', x, y, { crit, pieces: 2, textSplit: false, splitLine: { angle: rand(0, Math.PI * 2), cx: x, cy: y } });
    return el;
  }
  /* Liang–Barsky: the part of segment (x1,y1)→(x2,y2) inside rect r, or null when they do not intersect. */
  function clipSegment(x1, y1, x2, y2, r) {
    const dx = x2 - x1, dy = y2 - y1;
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dy, dy], q = [x1 - r.left, r.right - x1, y1 - r.top, r.bottom - y1];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return null; continue; }
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
      else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
    return { x1: x1 + dx * t0, y1: y1 + dy * t0, x2: x1 + dx * t1, y2: y1 + dy * t1 };
  }
  function nearestOnSegment(ax, ay, bx, by, pxv, pyv) {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? clamp(((pxv - ax) * dx + (pyv - ay) * dy) / L2, 0, 1) : 0;
    return { x: ax + dx * t, y: ay + dy * t };
  }
  function slashFx(x1, y1, x2, y2) {   // 160 ms bright streak along the segment
    if (!root) return;
    const n = mk('div', 'crs-slash-fx');
    const len = Math.hypot(x2 - x1, y2 - y1), a = Math.atan2(y2 - y1, x2 - x1);
    n.style.left = px(x1); n.style.top = px(y1); n.style.width = px(len); n.style.height = '4px';
    n.style.transformOrigin = '0 50%'; n.style.transform = 'translateY(-2px) rotate(' + a.toFixed(4) + 'rad)';
    n.style.borderRadius = '2px';
    n.style.background = 'linear-gradient(90deg, rgba(255,255,255,0), #fff 18%, #fff 82%, rgba(255,255,255,0))';
    n.style.boxShadow = '0 0 0 1px rgba(15,25,35,.45), 0 0 8px 2px rgba(255,255,255,.75)';   // dark halo so the streak reads on light pages
    root.append(n);
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
    try { const an = trackAnim(n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' })); an.addEventListener('finish', kill); } catch (e) { /* ignore */ }
    later(kill, 400);
  }
  /* Slash (A8): samples every 24 px (both ends), unique targets (≤ 12) each take 60 × power (crit per element);
   * a broken element splits in two along the slash line. Returns the number of elements damaged. */
  function doSlash(x1, y1, x2, y2) {
    state.shots++;
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const n = Math.max(2, Math.ceil(len / 24) + 1);
    const cache = new Map(), seen = new Set(), hits = [];
    const vw = viewW(), vh = viewH();
    for (let i = 0; i < n && hits.length < 12; i++) {
      const f = i / (n - 1), sx = x1 + dx * f, sy = y1 + dy * f;
      if (sx < 0 || sy < 0 || sx > vw || sy > vh) continue;
      const el = pickTarget(sx, sy, cache);
      if (el && !seen.has(el)) { seen.add(el); hits.push(el); }
    }
    interceptOrbsAlong(x1, y1, x2, y2, 18);   // v1.2 A9: orbs within 18 px of the segment pop; the page is still hit
    // roll every element's crit before any sound / effect (A4) so the swish can carry the crit sparkle
    const plan = hits.map((el) => { const crit = rollCrit(); return { el, crit, dmg: rollDamage(WEAPONS.sword.damage, crit) }; });
    sfx('swish', { crit: plan.some((p) => p.crit) });
    slashFx(x1, y1, x2, y2);
    drawSlash(x1, y1, x2, y2);
    shake('hammer', { amp: 3 });
    for (const { el, crit, dmg } of plan) {
      const r = rectOf(el);
      let pv = { x: x2, y: y2 }, q = pv;
      if (r) {
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        // pivot = the point of the slash INSIDE the box nearest its centre (the chord, Liang–Barsky); a corner
        // cut therefore splits along the visible cut. No intersection → the box centre, same angle (A8).
        const chord = clipSegment(x1, y1, x2, y2, r);
        q = chord ? nearestOnSegment(chord.x1, chord.y1, chord.x2, chord.y2, cx, cy) : nearestOnSegment(x1, y1, x2, y2, cx, cy);
        pv = chord ? q : { x: cx, y: cy };
      }
      applyHit(el, dmg, 'hammer', pv.x, pv.y, { crit, slash: true, pieces: 2, textSplit: false, splitLine: { angle, cx: pv.x, cy: pv.y }, toward: q });
    }
    return hits.length;
  }
  function fireBomb(x, y) {
    state.shots++;
    interceptOrbsWithin(x, y, WEAPONS.bomb.radius);   // v1.2 A9: every orb in the blast pops (+5 each) AND the page is hit
    sfx('bomb');
    flash(x, y, 'bomb'); ring(x, y); shake('bomb');
    drawCrack(x, y, 'bomb', { ink: 1 });
    aoeHit(x, y, WEAPONS.bomb);
    return null;
  }
  function rocketImpact(x, y) {
    if (!state.active) return;
    interceptOrbsWithin(x, y, WEAPONS.rocket.radius);
    sfx('bomb', { gain: 1.3 });
    flash(x, y, 'bomb'); ring(x, y, { xl: true }); shake('bomb', { amp: 16, dur: 480 });
    scorchDab(x, y, 140, 0.45);
    drawCrack(x, y, 'bomb', { lenScale: 1.3, ink: 1 });
    aoeHit(x, y, WEAPONS.rocket);
    scheduleHud(); kick();
  }
  /* Rocket (A7): a bright capsule streaks from bottom-centre to the click point over 150 ms (WAAPI, tracked),
   * impact via later() so restore()/deactivate() cancel both. Cooldown counts from the click. */
  function fireRocket(x, y) {
    state.shots++;
    sfx('whoosh');
    if (!root) { rocketImpact(x, y); return null; }
    const sx = viewW() / 2, sy = viewH() + 20;
    const ang = Math.atan2(y - sy, x - sx);
    const n = mk('div', 'crs-rocket');
    n.style.left = px(sx); n.style.top = px(sy); n.style.width = '28px'; n.style.height = '8px';
    n.style.borderRadius = '4px';
    n.style.background = 'linear-gradient(90deg, rgba(255,209,102,0), #ffd166 35%, #fff)';
    n.style.boxShadow = '0 0 10px 3px rgba(255,209,102,.75)';
    const rot = ' translate(-50%, -50%) rotate(' + ang.toFixed(4) + 'rad)';
    n.style.transform = 'translate(0px, 0px)' + rot;
    root.append(n);
    try { trackAnim(n.animate([{ transform: 'translate(0px, 0px)' + rot }, { transform: 'translate(' + px(x - sx) + ', ' + px(y - sy) + ')' + rot }], { duration: 150, easing: 'ease-in', fill: 'forwards' })); } catch (e) { /* ignore */ }
    later(() => { try { n.remove(); } catch (e) { /* ignore */ } rocketImpact(x, y); }, 150);
    return null;
  }
  /* Fire particles (A9): 12–26 px radial gradients rising 30–60 px over 350–500 ms, cap 40 live. */
  function spawnFire(x, y, count) {
    if (!root) return;
    for (let i = 0; i < count; i++) {
      const s = rand(12, 26);
      const n = mk('div', 'crs-fire');
      n.style.left = px(x + rand(-10, 10) - s / 2); n.style.top = px(y + rand(-10, 10) - s / 2);
      n.style.width = px(s); n.style.height = px(s); n.style.borderRadius = '50%';
      n.style.background = 'radial-gradient(circle, #ffd166 0%, #ff6b35 45%, rgba(255,107,53,0) 72%)';
      root.append(n);
      state.fire.push(n);
      while (state.fire.length > 40) { const old = state.fire.shift(); try { old.remove(); } catch (e) { /* ignore */ } }
      const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } const k = state.fire.indexOf(n); if (k >= 0) state.fire.splice(k, 1); };
      try {
        const an = trackAnim(n.animate([{ transform: 'translateY(0px) scale(1)', opacity: 0.95 }, { transform: 'translateY(' + px(-rand(30, 60)) + ') scale(.4)', opacity: 0 }], { duration: rand(350, 500), easing: 'ease-out', fill: 'forwards' }));
        an.addEventListener('finish', kill);
      } catch (e) { /* ignore */ }
      later(kill, 1000);
    }
  }
  function fireFlame(x, y, c) {
    state.shots++;
    const h = (c && c.hold && c.h) || null;
    const n = h ? h.tick : 1;
    if (interceptOrb(x, y)) return null;   // v1.2 A9: a flame tick that intercepts is consumed
    const el = pickTarget(x, y, h ? h.cache : undefined);
    let crit = false, win = null, dmg = 0;
    if (el) {   // roll before any sound / effect (A4)
      if (h) { win = holdWindow(el); crit = win.crit; } else crit = rollCrit();
      dmg = rollDamage(WEAPONS.flame.damage, crit);
    }
    spawnFire(x, y, 2);
    if (!h || n % 4 === 0) { scorchDab(x, y, 24, 0.08); state.scorch++; }   // the glass blackens over time; no crack (A3/A9)
    if (!h) sfx('puff', { crit });
    if (el) applyHit(el, dmg, 'gun', x, y, { crit, hold: !!h, win, burnt: true });
    return el;
  }
  /* One BFS for collapse AND the hostile picker (v1.2 A7). opts: { limit: max area to COLLECT, minArea,
   * descendCollected: keep walking into collected elements (hostile: nested cards), skip(el) }. Same visited
   * cap 2000 / out cap 60 / viewport-intersection and visibility rules as the v1 collapseCandidates. */
  function walkCandidates(x, y, opts) {
    const vw = viewW(), vh = viewH();
    const limit = opts.limit, minArea = opts.minArea || 0, deep = !!opts.descendCollected, skip = opts.skip || null;
    const out = [], queue = [];
    const body = doc.body; if (!body) return out;
    const descend = (el) => {   // light children + open shadow children (web-component pages, F23)
      try { if (el.shadowRoot) for (const c of el.shadowRoot.children) queue.push(c); } catch (e) { /* ignore */ }
      for (const c of el.children) queue.push(c);
    };
    for (const ch of body.children) queue.push(ch);
    let visited = 0;
    while (queue.length && out.length < 60 && visited < 2000) {
      const el = queue.shift(); visited++;
      if (!el || el.nodeType !== 1) continue;
      const tag = tagOf(el);
      if (SKIP_WALK_TAGS.has(tag) || isOurs(el) || el.hasAttribute('data-crs-broken')) continue;
      const s = gcs(el); if (!s || s.display === 'none' || parseFloat(s.opacity) < 0.05) continue;   // invisible subtree: nothing to show
      const r = rectOf(el); if (!r) continue;
      const empty = r.width < 1 || r.height < 1;
      if (empty || s.display === 'contents' || s.visibility === 'hidden') { descend(el); continue; }
      if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
      const area = r.width * r.height;
      if (area <= limit) {
        if (area >= minArea && !(skip && skip(el))) out.push({ el, d: edgeDist(r, x, y), cx: r.left + r.width / 2, cy: r.top + r.height / 2, area });
        if (deep) descend(el);
        continue;
      }
      descend(el);
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }
  function collapseCandidates(x, y) { return walkCandidates(x, y, { limit: 0.25 * viewW() * viewH() }); }
  function doCollapse(x, y) {
    cancelCollapse();
    sfx('rumble');
    flash(x, y, 'collapse'); ring(x, y); shake('collapse');
    drawCrack(x, y, 'bomb');
    const cands = collapseCandidates(x, y);
    const textIdx = new Set();
    for (const c of cands) { if (textIdx.size >= 8) break; if (textDominant(c.el)) textIdx.add(c.el); }
    const chain = { timer: 0, i: 0, extra: 0, start: now(), thumps: 0, thumpTimer: 0, done: false };
    state.collapse = chain;
    const thump = () => { if (chain.done || !state.active) return; if (chain.thumps++ < 12) sfx('thump', { gain: 0.9 }); chain.thumpTimer = later(thump, 90); };
    chain.thumpTimer = later(thump, 90);
    const finish = () => { chain.done = true; untrack(chain.thumpTimer); chain.thumpTimer = 0; if (state.collapse === chain) state.collapse = null; state.hintCollapse = true; updateHud(); };
    const step = () => {
      chain.timer = 0;
      if (chain.done || !state.active) return;
      if (chain.i >= cands.length) { finish(); return; }
      const c = cands[chain.i++];
      const t0 = now();
      if (c.el.isConnected && !c.el.hasAttribute('data-crs-broken')) {
        const r = rectOf(c.el);
        if (r && r.width >= 1 && r.height >= 1) {
          const dx = c.cx - x, dy = c.cy - y, L = Math.hypot(dx, dy) || 1;
          breakElement(c.el, x, y, { mode: 'collapse', pieces: r.width * r.height < 40000 ? 2 : 1, cloneCap: 300, textSplit: textIdx.has(c.el), forceWords: true, maxTokens: 12, away: { x: dx / L, y: dy / L } });
          state.hp.delete(c.el);
        }
      }
      if (now() - t0 > 16) chain.extra += 16;
      updateHud();
      refreshHover();
      schedule();
    };
    const schedule = () => {
      if (chain.i >= cands.length) { finish(); return; }
      const c = cands[chain.i];
      const at = chain.start + c.d / 1.1 + chain.i * 6 + chain.extra;
      chain.timer = later(step, Math.max(0, at - now()));
    };
    if (!cands.length) finish(); else schedule();
  }
  function cancelCollapse() {
    const c = state.collapse;
    if (!c) return;
    c.done = true;
    untrack(c.timer); untrack(c.thumpTimer); c.timer = 0; c.thumpTimer = 0;
    state.collapse = null;
  }


  WEAPONS.hammer.fire = fireHammer; WEAPONS.pistol.fire = firePistol; WEAPONS.smg.fire = fireSmg; WEAPONS.axe.fire = fireAxe;
  WEAPONS.sword.fire = fireStab; WEAPONS.bomb.fire = fireBomb; WEAPONS.rocket.fire = fireRocket; WEAPONS.flame.fire = fireFlame;
  WEAPONS.sniper.fire = fireSniper;
  WEAPONS.collapse.fire = (x, y) => { state.shots++; doCollapse(x, y); return null; };

  /* --- actions (A3 ordering + v1.2 A5 gates): mount → cooldown → swap delay → spend → counters/combo/swing → fire → HUD --- */
  function action(id, x, y, run) {
    if (!state.active || state.ko) return undefined;   // KO screen: smashing disabled (v1.2 §5)
    ensureMounted();
    reraiseAll();
    blurFrame();
    if (onCooldown()) { swingCursor(); cooldownFeedback(); return undefined; }   // rejected: no counter, crack or damage
    if (swapActive()) { cooldownFeedback(); return undefined; }                   // weapon swap delay (A5)
    if (!spend(id)) { updateAmmoHud(); return undefined; }                        // empty / reloading: rejected, auto-reload running
    state.hintCollapse = false;
    state.hoverX = x; state.hoverY = y;
    bumpCombo();
    swingCursor();
    let out = null;
    try { out = run(); } catch (e) { state.lastError = String((e && e.stack) || e); }
    flushPendingReload();   // A5: the emptying round reloads right after it was fired (A4: scoped shots stay exact)
    updateHud();
    updateAmmoHud();
    kick();
    return out === undefined ? null : out;
  }
  /* Single attack at (x, y): click weapons, one tick for smg/flame, a stab for the sword. true if an attack happened. */
  function smashAt(x, y, weaponId) {
    if (!state.active) return false;
    x = +x; y = +y;
    if (!isFinite(x) || !isFinite(y)) return false;
    const wid = weaponId === 'gun' ? 'pistol' : weaponId;   // legacy v1 alias, same as setMode() (A12)
    const id = WEAPON_IDS.includes(wid) ? wid : state.weapon;
    const W = WEAPONS[id];
    const r = action(id, x, y, () => {
      const hit = W.fire(x, y, { hold: false });
      startCooldown(id, id === 'sword' ? W.stabCooldownMs : W.cooldownMs);
      return hit;
    });
    return r !== undefined;
  }
  /* Sword segment (pointer release or api.slash): < 12 px → stab, else slash. Returns elements damaged. */
  function slashSegment(x1, y1, x2, y2) {
    if (!state.active) return 0;
    x1 = +x1; y1 = +y1; x2 = +x2; y2 = +y2;
    if (!(isFinite(x1) && isFinite(y1) && isFinite(x2) && isFinite(y2))) return 0;
    if (Math.hypot(x2 - x1, y2 - y1) < 12) {
      const r = action('sword', x1, y1, () => { const hit = fireStab(x1, y1); startCooldown('sword', WEAPONS.sword.stabCooldownMs); return hit; });
      return r ? 1 : 0;
    }
    const n = action('sword', x2, y2, () => doSlash(x1, y1, x2, y2));
    return n || 0;
  }

  /* --- hold weapons (A6): a self-rescheduling later() chain, never setInterval --- */
  function startHold(id, x, y, pointerId) {
    if (!state.active) return false;
    const W = WEAPONS[id];
    if (!W || !W.hold) return false;
    if (state.ko) return false;
    if (state.hold) stopHold();
    if (state.slash) cancelSlash();
    ensureMounted();
    reraiseAll();
    blurFrame();
    if (swapActive()) { cooldownFeedback(); return false; }     // v1.2 A5: swap gate before the first tick
    if (!spend(id)) { updateAmmoHud(); return false; }          // empty / reloading: no hold starts
    try { if (shield && pointerId != null) shield.setPointerCapture(pointerId); } catch (e) { /* ignore */ }
    state.hintCollapse = false;
    if (isFinite(x) && isFinite(y)) { state.hoverX = x; state.hoverY = y; }
    bumpCombo();
    swingCursor();
    const h = { id, pointerId: pointerId == null ? null : pointerId, startedAt: now(), tick: 0, timer: 0, safety: 0, cache: new Map(), cacheAt: now(), open: new Set(), tintEls: new Set() };
    state.hold = h;
    h.safety = later(() => { if (state.hold === h) stopHold(); }, 10000);
    if (id === 'flame') { ensureAudio(); startLoop(); }
    try { const b = weaponBtn(id); if (b) b.classList.add('holding'); } catch (e) { /* ignore */ }
    updateHud();
    holdStep();
    return true;
  }
  function holdStep() {
    const h = state.hold;
    if (!h || !state.active) return;
    h.timer = 0;
    const t = now();
    if (t - h.cacheAt >= HOLD_WINDOW) { h.cache = new Map(); h.cacheAt = t; }
    if (h.tick > 0 && !spend(h.id)) { stopHold(); updateAmmoHud(); return; }   // v1.2 A5: a hold that runs dry stops (auto-reload keeps running)
    h.tick++;
    let hit = null;
    try { hit = WEAPONS[h.id].fire(state.hoverX, state.hoverY, { hold: true, h }) || null; } catch (e) { state.lastError = String((e && e.stack) || e); }
    flushPendingReload();
    if (state.hold !== h) return;   // the tick itself ended the hold (deactivate from a page handler)
    for (const el of Array.from(h.tintEls)) if (el !== hit) { fadeTint(el); h.tintEls.delete(el); }
    if (hit && !hit.hasAttribute('data-crs-broken')) h.tintEls.add(hit);
    for (const el of Array.from(h.open)) { const w = state.dmgAgg.get(el); if (!w || t - w.at >= HOLD_WINDOW) flushWindow(el, w); }
    scheduleHud();
    kick();
    h.timer = later(holdStep, WEAPONS[h.id].tickMs);
  }
  function stopHold(silent) {
    const h = state.hold;
    if (!h) return;
    state.hold = null;   // first: stats().holding is already false
    untrack(h.timer); untrack(h.safety); h.timer = 0; h.safety = 0;
    stopLoop();
    for (const el of Array.from(h.tintEls)) fadeTint(el);
    for (const el of Array.from(h.open)) { const w = state.dmgAgg.get(el); if (silent) state.dmgAgg.delete(el); else flushWindow(el, w); }
    try { const b = weaponBtn(h.id); if (b) b.classList.remove('holding'); } catch (e) { /* ignore */ }
    try { if (shield && h.pointerId != null && shield.hasPointerCapture(h.pointerId)) shield.releasePointerCapture(h.pointerId); } catch (e) { /* ignore */ }
    if (!silent) scheduleHud();
  }

  /* --- sword drag (A8): preview line from pointerdown, resolved on release --- */
  function startSlash(x, y, pointerId) {
    if (!state.active || !root) return false;
    if (state.hold) stopHold();
    if (state.slash) cancelSlash();
    ensureMounted();
    reraiseAll();
    blurFrame();
    try { if (shield && pointerId != null) shield.setPointerCapture(pointerId); } catch (e) { /* ignore */ }
    state.hoverX = x; state.hoverY = y;
    const n = mk('div', 'crs-slash-preview');
    n.style.left = px(x); n.style.top = px(y); n.style.width = '0px'; n.style.height = '2px';
    n.style.background = 'rgba(255,255,255,.7)'; n.style.borderRadius = '1px';
    n.style.boxShadow = '0 0 0 1px rgba(15,25,35,.55), 0 0 4px rgba(255,255,255,.5)';   // dark halo: readable on white pages too (same dark pass as drawSlash)
    n.style.transformOrigin = '0 50%'; n.style.transform = 'translateY(-1px) rotate(0rad)';
    root.append(n);
    state.slash = { x1: x, y1: y, x2: x, y2: y, node: n, pointerId: pointerId == null ? null : pointerId };
    return true;
  }
  function updateSlash(x, y) {
    const s = state.slash;
    if (!s) return;
    s.x2 = x; s.y2 = y;
    const dx = x - s.x1, dy = y - s.y1;
    s.node.style.width = px(Math.hypot(dx, dy));
    s.node.style.transform = 'translateY(-1px) rotate(' + Math.atan2(dy, dx).toFixed(4) + 'rad)';
  }
  function cancelSlash() {
    const s = state.slash;
    if (!s) return null;
    state.slash = null;
    try { s.node.remove(); } catch (e) { /* ignore */ }
    try { if (shield && s.pointerId != null && shield.hasPointerCapture(s.pointerId)) shield.releasePointerCapture(s.pointerId); } catch (e) { /* ignore */ }
    return s;
  }
  function resolveSlash(x, y) {
    const s = cancelSlash();
    if (!s) return 0;
    if (isFinite(x) && isFinite(y)) { s.x2 = x; s.y2 = y; }
    return slashSegment(s.x1, s.y1, s.x2, s.y2);
  }
