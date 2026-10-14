// ── the nine fire() entries (melee/gun/bomb/rocket/flame/katana) + collapse chain ──
  /* --- fire(x, y, ctx) entries. ctx.hold: fired by a hold tick (ctx.h = the hold session); each returns the element hit --- */
  function fireHammer(x, y) {
    state.shots++;
    if (interceptOrb(x, y)) return null;   // v1.2 A9: an orb within 18 px absorbs the blow, the page is untouched
    const el = pickTarget(x, y);
    const crit = el ? rollCrit('hammer') : false;
    const dmg = rollDamage(WEAPONS.hammer.damage, crit, falloffMul('hammer', x, y));
    sfx(!el || willBreak(el, dmg) ? 'hammer' : 'thump', { crit });   // thump only when merely dented (A24)
    flash(x, y, 'hammer'); shake('hammer', { amp: crit ? 8.4 : 6 });
    drawCrack(x, y, 'hammer', { ink: 1 });
    if (el) applyHit(el, dmg, 'hammer', x, y, { crit });
    return el;
  }
  function firePistol(x, y) {
    state.shots++;
    // v1.5 §3.2: the aim point is shaken by spread + the previous shot's recoil kick + bloom, then this shot's
    // own kick is recorded for the next one. §3: damage falls off with distance from the aim origin.
    const p = shotPoint(x, y, 'pistol');
    x = p.x; y = p.y;
    noteShot('pistol');
    if (interceptOrb(x, y)) return null;
    const el = pickTarget(x, y);
    const crit = el ? rollCrit('pistol') : false;
    const dmg = rollDamage(WEAPONS.pistol.damage, crit, falloffMul('pistol', x, y));
    sfx('gun', { crit });
    flash(x, y, 'gun'); shake('gun', { amp: crit ? 2.8 : 2 });
    drawCrack(x, y, 'gun', { ink: 0.25 });
    spawnChips(x, y, randInt(3, 5));
    if (el) applyHit(el, dmg, 'gun', x, y, { crit });
    // pierce: nothing to do here — interceptOrb() above already handed the shot to schedulePierce()
    // (src/87-depth.js), the single entry point into applyPierce(). The pistol's pierce is 0 anyway.
    return el;
  }
  function fireSmg(x, y, c) {
    state.shots++;
    const h = (c && c.hold && c.h) || null;
    const n = h ? h.tick : 1;
    x += rand(-9, 9); y += rand(-9, 9);
    const sp = shotPoint(x, y, 'smg');   // v1.5 §3.2: recoil kick + bloom on top of the mechanical ±9 px
    x = sp.x; y = sp.y;
    noteShot('smg');
    if (interceptOrb(x, y)) return null;   // v1.2 A9: the tick is consumed by the orb
    const el = pickTarget(x, y, h ? h.cache : undefined);
    let dmg = 0, crit = false, win = null;
    if (el) {
      if (h) { win = holdWindow(el); crit = win.crit; } else crit = rollCrit('smg');
      dmg = rollDamage(WEAPONS.smg.damage, crit, falloffMul('smg', x, y));
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
    const crit = el ? rollCrit('axe') : false;
    const dmg = rollDamage(WEAPONS.axe.damage, crit);
    sfx(!el || willBreak(el, dmg) ? 'hammer' : 'thump', { crit, pitch: 0.75, gain: 1.15 });
    flash(x, y, 'hammer', { size: 190, dur: 300 }); shake('hammer', { amp: crit ? 9.8 : 7 });
    drawCrack(x, y, 'hammer', { rays: [5, 7], lenScale: 1.3, ink: 1 });
    // a broken element splits in two along a jagged near-vertical line through the impact (A8)
    if (el) applyHit(el, dmg, 'hammer', x, y, { crit, pieces: 2, textSplit: false, splitLine: { angle: (90 + rand(-15, 15)) * DEG, cx: x, cy: y } });
    return el;
  }
  function fireStab(x, y) {   // katana click / drag shorter than 12 px
    state.shots++;
    if (interceptOrb(x, y)) return null;
    const el = pickTarget(x, y);
    const crit = el ? rollCrit('katana') : false;
    const dmg = rollDamage(WEAPONS.katana.damage, crit);
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
  /* SPEC-destruction §D2: the streak is a CRESCENT that follows the blade's arc (0–180 ms), not a straight
   * bright bar with saw teeth — see fracCrescent() in src/66-fracture.js. The straight bar is still what a
   * slash with no curve gets, which in practice is only a degenerate zero-length segment. */
  function slashFx(x1, y1, x2, y2) {
    if (!root) return;
    const cu = fracGetCurve();
    if (cu && fracCrescent(cu)) return;
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
  /* Slash (A8 + SPEC-destruction §D2): the blade travels on a quadratic Bézier through the drag's start,
   * middle and end, and the hit test samples THAT curve every 24 px. Unique targets (≤ 12) each take the
   * katana's damage (crit per element); a broken element splits in two along the curve. Returns the number
   * of elements damaged. */
  function doSlash(x1, y1, x2, y2, mid) {
    state.shots++;
    const cu = fracSetCurve(fracMakeCurve(x1, y1, x2, y2, mid));
    const angle = fracCurveAngle(cu, 0.5);
    const cache = new Map(), seen = new Set(), hits = [];
    const vw = viewW(), vh = viewH();
    const samples = fracCurveSamples(cu, 24);   // §D2: 24 px along the curve, both ends included
    for (const s of samples) {
      if (hits.length >= 12) break;
      if (s.x < 0 || s.y < 0 || s.x > vw || s.y > vh) continue;
      const el = pickTarget(s.x, s.y, cache);
      if (el && !seen.has(el)) { seen.add(el); hits.push(el); }
    }
    interceptOrbsAlong(x1, y1, x2, y2, 18);   // v1.2 A9: orbs within 18 px of the segment pop; the page is still hit
    // roll every element's crit before any sound / effect (A4) so the swish can carry the crit sparkle
    const plan = hits.map((el) => { const crit = rollCrit('katana'); return { el, crit, dmg: rollDamage(WEAPONS.katana.damage, crit) }; });
    /* §D2's three layers: the draw (metal on air), the air being cut, and — only when something was really
     * cut — the ring of contact. Slicing thin air has no ring, and that difference is the whole feel. */
    sfx('katanaDraw', { crit: plan.some((p) => p.crit) });
    sfx('katanaAir');
    if (plan.length) later(() => sfx('katanaRing', { gain: 0.9 }), 40);
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
    /* The curve belongs to ONE slash: everything that reads it — the crescent, the scar, the curved cut —
     * has run by now, and a later break must not be cut along a slash that is over. */
    later(() => { if (fracGetCurve() === cu) fracSetCurve(null); }, 0);
    return hits.length;
  }
  /* ══ SPEC-destruction §E4 — 순서가 있는 연출 ═══════════════════════════════════════════════════
   * | 0ms | 흰 섬광(반지름 0.5R, 90ms), 흔들림 시작 · 충격파 링이 0 에서 R 까지 260ms 에 걸쳐 퍼진다
   * | 0~60ms | 대상들이 차례로 부서진다 (aoeHit 의 edgeDist/4 스태거가 그대로 그 창이다)
   * | 40ms | blastMark 를 그린다. 섬광이 걷히며 드러난다
   * | 60~500ms | 중심에서 연기가 피어오른다
   * Every size is R. `flash`'s `size` is a DIAMETER, so 반지름 0.5R 은 size R 이다. */
  function blastFx(x, y, R, k, shakeOpts, W) {
    flash(x, y, 'bomb', { size: R, dur: 90 });
    ring(x, y, { r: R });
    shake('bomb', shakeOpts);
    later(() => { if (state.active) blastMark(x, y, R, k, { ink: 1, weapon: W || null }); }, 40);
    for (let i = 0, n = reducedMotion() ? 0 : randInt(4, 7); i < n; i++) {
      later(() => { if (state.active) smokePuff(x + rand(-0.12, 0.12) * R, y + rand(-0.12, 0.12) * R, { size: rand(0.12, 0.26) * R }); }, rand(60, 500));
    }
  }
  /* §F4: 연소 중 요소가 폭발에 휘말리면 반경 ×1.15. The rings scale with it so the candidate sampling stays
   * proportional; the weapon table itself is never written to — aoeHit() is handed a copy. */
  function blastWeaponAt(x, y, W) {
    const R = burnBlastRadius(x, y, W.radius);
    if (R === W.radius) return W;
    const k = R / W.radius;
    return Object.assign({}, W, { radius: R, rings: (W.rings || []).map((r) => r * k) });
  }
  function fireBomb(x, y) {
    state.shots++;
    const W = blastWeaponAt(x, y, WEAPONS.bomb);
    interceptOrbsWithin(x, y, W.radius);   // v1.2 A9: every orb in the blast pops (+5 each) AND the page is hit
    sfx('bomb');
    blastFx(x, y, W.radius, 1, undefined, W);
    /* §F5 (폭탄 범위 15) BEFORE the damage: aoeHit() destroys its nearest targets synchronously, and
     * asking aoeCandidates() a second time afterwards would resolve the blast CENTRE to whatever is left
     * under the point — usually the dead element's own container, which would then catch fire and char
     * right across the gaps between its children. The fire is laid on the page the blast actually found. */
    blastIgnite(x, y, W, BURN_BOMB_DIRECT, BURN_BOMB_SPLASH);
    aoeHit(x, y, W);
    return null;
  }
  function rocketImpact(x, y) {
    if (!state.active) return;
    const W = blastWeaponAt(x, y, WEAPONS.rocket);
    interceptOrbsWithin(x, y, W.radius);
    sfx('bomb', { gain: 1.3 });
    blastFx(x, y, W.radius, 1.5, { amp: 16, dur: 480 }, W);   // §E3: 로켓은 intensity 1.5
    blastIgnite(x, y, W, BURN_ROCKET_DIRECT, BURN_ROCKET_SPLASH);   // §F5: 로켓 직격 25 · 범위 12 (see fireBomb for the order)
    aoeHit(x, y, W);
    scheduleHud(); kick();
  }
  /* Rocket (A7): a bright capsule streaks from bottom-centre to the click point over 150 ms (WAAPI, tracked),
   * impact via later() so restore()/deactivate() cancel both. Cooldown counts from the click. */
  function fireRocket(x, y) {
    state.shots++;
    sfx('whoosh');
    if (!root) { rocketImpact(x, y); return null; }
    const sx = viewW() / 2, sy = viewH() + 20;
    const flightMs = reducedMotion() ? 40 : 150;   // SPEC-settings §3.1: the flight is shortened, never skipped
    const ang = Math.atan2(y - sy, x - sx);
    const n = mk('div', 'crs-rocket');
    n.style.left = px(sx); n.style.top = px(sy); n.style.width = '28px'; n.style.height = '8px';
    n.style.borderRadius = '4px';
    n.style.background = 'linear-gradient(90deg, rgba(255,209,102,0), #ffd166 35%, #fff)';
    n.style.boxShadow = '0 0 10px 3px rgba(255,209,102,.75)';
    const rot = ' translate(-50%, -50%) rotate(' + ang.toFixed(4) + 'rad)';
    n.style.transform = 'translate(0px, 0px)' + rot;
    root.append(n);
    try { trackAnim(n.animate([{ transform: 'translate(0px, 0px)' + rot }, { transform: 'translate(' + px(x - sx) + ', ' + px(y - sy) + ')' + rot }], { duration: flightMs, easing: 'ease-in', fill: 'forwards' })); } catch (e) { /* ignore */ }
    later(() => { try { n.remove(); } catch (e) { /* ignore */ } rocketImpact(x, y); }, flightMs);
    return null;
  }
  /* Fire particles (A9): 12–26 px radial gradients rising 30–60 px over 350–500 ms, cap 40 live
   * (30 in performance mode, SPEC-settings §2.2; the COUNT is halved under reduced motion, §3.1). */
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
      while (state.fire.length > particleCap()) { const old = state.fire.shift(); try { old.remove(); } catch (e) { /* ignore */ } }
      const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } const k = state.fire.indexOf(n); if (k >= 0) state.fire.splice(k, 1); };
      try {
        const an = trackAnim(n.animate([{ transform: 'translateY(0px) scale(1)', opacity: 0.95 }, { transform: 'translateY(' + px(-rand(30, 60)) + ') scale(.4)', opacity: 0 }], { duration: rand(350, 500), easing: 'ease-out', fill: 'forwards' }));
        an.addEventListener('finish', kill);
      } catch (e) { /* ignore */ }
      later(kill, 1000);
    }
  }
  /* SPEC-destruction §F6: 화염방사기는 틱 피해 15 → 8, 틱당 스택 9. "즉시 화력 최하위, 20초 누적 화력
   * 최상위" — the damage the trigger does NOW is halved and the work is moved into the burn. The weapon
   * table keeps its published `damage` (15) because that is what the HUD, the balance readout and
   * api.weapons() mean by it; this is the per-tick number the flame actually applies. */
  const FLAME_TICK_DMG = 8;
  function fireFlame(x, y, c) {
    state.shots++;
    const h = (c && c.hold && c.h) || null;
    const n = h ? h.tick : 1;
    const fp = shotPoint(x, y, 'flame');   // v1.5 §3.2: bloom widens the cone the longer the trigger is held
    x = fp.x; y = fp.y;
    noteShot('flame');
    if (interceptOrb(x, y)) return null;   // v1.2 A9: a flame tick that intercepts is consumed
    const el = pickTarget(x, y, h ? h.cache : undefined);
    let crit = false, win = null, dmg = 0;
    if (el) {   // roll before any sound / effect (A4)
      if (h) { win = holdWindow(el); crit = win.crit; } else crit = rollCrit('flame');
      dmg = rollDamage(FLAME_TICK_DMG, crit, falloffMul('flame', x, y));   // §F6: 15 → 8
    }
    spawnFire(x, y, 2);
    // §E3: 화염방사기의 기존 그을음은 blastMark(x, y, 24, 0.25) 로 통일한다 — no second scorch routine in the build
    if (!h || n % 4 === 0) { blastMark(x, y, 24, 0.25, { count: false }); state.scorch++; }
    if (!h) sfx('puff', { crit });
    if (el) applyHit(el, dmg, 'gun', x, y, { crit, hold: !!h, win, burnt: true });
    /* §F5 불을 붙이는 무기: 화염방사기 틱당 9. SPEC-combat §B2 scoped this to the combat modes because
     * the general case was step 6's to decide; step 6 decided — §F is the system, and fire burns in rampage
     * too. (§F6 pays for it in the same breath by dropping the tick damage to 8.) */
    if (el) igniteEl(el, BURN_FLAME_STACKS);
    return el;
  }

  /* One BFS for collapse AND the hostile picker (v1.2 A7). opts: { limit: max area to COLLECT, minArea,
   * descendCollected: keep walking into collected elements (hostile: nested cards), skip(el) }. Same visited
   * cap 2000 / out cap 60 / viewport-intersection and visibility rules as the v1 collapseCandidates. */
  /* The RAW traversal. src/22-perf.js wraps it as walkCandidates() with the §2.3 300 ms memo — every
   * caller keeps calling walkCandidates() and gets the cache for free. */
  function walkCandidatesRaw(x, y, opts) {
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
        // `r` rides along so the §2.3 memo can re-measure the distance from a new point without re-walking
        if (area >= minArea && !(skip && skip(el))) out.push({ el, d: edgeDist(r, x, y), cx: r.left + r.width / 2, cy: r.top + r.height / 2, area, r: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } });
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
    pullOrbsIn(x, y);   // SPEC-combat §D4: 중력탄은 빨아들인다 (src/88-archetypes.js)
    flash(x, y, 'collapse'); ring(x, y, { r: BOMB_RADIUS }); shake('collapse');
    /* §E2: the collapse used to draw the (now deleted) `bomb` crack web. §A's table gives 붕괴 no mark of
     * its own ("없음(즉시 파괴)"), but it has always left ONE on the page and `stats().cracks` counts it, so
     * it keeps a mark and takes the blast one — INTERPRETATION, reported. Its radius is Infinity, so it
     * borrows the bomb's 240 px exactly as blastWeapon() already did for its decal targets. */
    blastMark(x, y, BOMB_RADIUS, 0.9, { ink: 1 });
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
