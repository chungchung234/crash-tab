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
      dmg = rollDamage(WEAPONS.flame.damage, crit, falloffMul('flame', x, y));
    }
    spawnFire(x, y, 2);
    if (!h || n % 4 === 0) { scorchDab(x, y, 24, 0.08); state.scorch++; }   // the glass blackens over time; no crack (A3/A9)
    if (!h) sfx('puff', { crit });
    if (el) applyHit(el, dmg, 'gun', x, y, { crit, hold: !!h, win, burnt: true });
    /* SPEC-combat §B2: in a combat mode the flame LEAVES something behind — see the burning block below
     * for why the ignition is scoped to the combat modes and not (yet) switched on in rampage. */
    if (el && modeHasEnemies()) igniteEl(el, BURN_FLAME_STACKS);
    return el;
  }

  /* ══ SPEC-combat §B2: 상태 효과는 그대로 퍼진다 ═══════════════════════════════════════════
   * 무적은 **피해에만** 적용된다. 불은 무적 요소에도 붙고 그 위로 번진다. 체력이 줄지 않으니 타기만
   * 하지만, 불길이 **적에게 도달하면** 그때부터 실제 피해가 들어간다 — 불을 길처럼 깔아 적을 태우는
   * 플레이가 성립하고, 무적이 플레이를 좁히는 대신 간접 공격 수단을 만든다.
   *
   * SCOPE — this is the SEED of SPEC-destruction §F (연소 시스템, 로드맵 6단계), not that system.
   * What is here is the minimum §B2 actually claims, with §F's own names and numbers so step 6 extends
   * rather than replaces: stacks 0–100, 지속 피해 초당 2 + stacks × 0.14 at 250 ms, 자연 감소 초당 6,
   * 동시 연소 상한 20 (성능 모드 10), 확산 700 ms · stacks ≥ 45 · 24 px 인접 · 최대 2개 · ×0.35.
   * What is NOT here, and is step 6's: §F3's flame overlay / scorch ramp / smoke / crackle loop, §F4's
   * ash debris and the wet · frozen interaction table (neither state exists in this build — the water
   * pistol and the freeze gun are roadmap step 8), §F5's per-weapon ignition table, §F6's 화염탄.
   *
   * TWO READINGS CHOSEN, both because §B2 is about combat and step 6 owns the general case:
   *   · ignition is wired to the flamethrower ONLY, and only while modeHasEnemies(). Turning §F5's full
   *     table on everywhere would re-balance rampage's flamethrower (a DoT on top of its unreduced 15
   *     per tick — §F6 drops that to 8 in the same breath), and that trade is step 6's to make, not §B's.
   *   · fire does not spread into an element's own ancestors or descendants. They are always "맞닿은"
   *     by rect, so without this a single tick on a card would climb its whole wrapper chain in 700 ms.
   *     §F2 says 인접 — "번진다", not "번져 올라간다" — so it spreads sideways.
   *
   * No page element is given an inline style by any of this (CLAUDE.md: 흔적을 남기지 않는다). The fire is
   * drawn with the existing `.crs-fire` particles, which restore() already sweeps, and the ledger below is
   * emptied by clearBurning() from clearCombatNodes(). */
  const BURN_TICK_MS = 250;                              // §F1: 250 ms 마다 1/4씩
  const BURN_DOT_BASE = 2, BURN_DOT_PER_STACK = 0.14;    // §F1: 지속 피해 초당 2 + stacks × 0.14
  const BURN_DECAY = 6;                                  // §F1: 자연 감소 초당 6
  const BURN_MAX = 100, BURN_MIN = 1;                    // §F1: stacks 0~100
  const BURN_CAP = 20, BURN_CAP_PERF = 10;               // §F1: 동시 연소 상한 20 (성능 모드 10)
  const BURN_SPREAD_MS = 700;                            // §F2: 700ms 마다 번질 곳을 찾는다
  const BURN_SPREAD_MIN = 45;                            // §F2: stacks >= 45 일 때만
  const BURN_SPREAD_GAP = 24;                            // §F2: rect 가 24px 이내로 맞닿거나 겹칠 것
  const BURN_SPREAD_MAX = 2, BURN_SPREAD_MUL = 0.35;     // §F2: 최대 2개, stacks × 0.35, 원래 쪽은 줄지 않는다
  const BURN_FLAME_STACKS = 9;                           // §F5: 화염방사기 틱당 9
  /* A Map, not a WeakMap: every tick walks the whole set, so it has to be enumerable (§F1). */
  const burning = new Map();
  let burnTimer = 0;
  function burnCap() { return perfOn() ? BURN_CAP_PERF : BURN_CAP; }
  function burnAlive(el) {
    if (!el || el.nodeType !== 1 || !el.isConnected || isOurs(el)) return false;
    try { return !el.hasAttribute('data-crs-broken'); } catch (e) { return false; }
  }
  function igniteEl(el, stacks) {
    if (!state.active || !burnAlive(el) || !(stacks > 0)) return null;
    let rec = burning.get(el);
    if (!rec) {
      if (burning.size >= burnCap()) return null;
      rec = { stacks: 0, spreadAt: now() };
      burning.set(el, rec);
    }
    rec.stacks = clamp(rec.stacks + stacks, 0, BURN_MAX);
    armBurn();
    return rec;
  }
  function armBurn() {
    if (burnTimer || !burning.size || !state.active) return;
    burnTimer = later(burnStep, BURN_TICK_MS);
  }
  function clearBurning() { untrack(burnTimer); burnTimer = 0; burning.clear(); }
  /* Gap between two rects — 0 when they touch or overlap. §F2 wants ADJACENCY, not distance between
   * centres: fire that jumps a gap is teleportation, not fire. */
  function rectGap(a, b) {
    const dx = Math.max(a.left - b.right, b.left - a.right, 0);
    const dy = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
    return Math.hypot(dx, dy);
  }
  /* §F2: the three sparks that make the jump visible. Drawn with the flame particles already in use. */
  function spreadSparks(a, b) {
    const x = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2;
    const y = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
    if (isFinite(x) && isFinite(y) && !reducedMotion()) spawnFire(x, y, 3);
  }
  function burnSpread(el, rec, r) {
    if (burning.size >= burnCap()) return;
    /* descendCollected: a collected container is still walked INTO. Without it the walk stops at the first
     * box under the limit — a section, say — and the cards inside it, which are the things that are actually
     * 맞닿은, are never candidates at all. (§F2 names the 300 ms memo; walkCandidates keys it on these very
     * options, so this stays a separate, correctly-cached signature.) */
    const cands = walkCandidates(r.left + r.width / 2, r.top + r.height / 2, { limit: 0.7 * viewW() * viewH(), minArea: 1200, descendCollected: true });
    let n = 0;
    for (const c of cands) {
      if (n >= BURN_SPREAD_MAX || burning.size >= burnCap()) break;
      const o = c.el;
      if (o === el || burning.has(o) || !burnAlive(o)) continue;
      try { if (o.contains(el) || el.contains(o)) continue; } catch (e) { continue; }   // reading chosen: sideways only
      if (rectGap(r, c.r) > BURN_SPREAD_GAP) continue;
      if (igniteEl(o, rec.stacks * BURN_SPREAD_MUL)) { n++; spreadSparks(r, c.r); }
    }
  }
  function burnStep() {
    burnTimer = 0;
    if (!state.active) { burning.clear(); return; }
    const t = now(), dt = BURN_TICK_MS / 1000;
    for (const [el, rec] of Array.from(burning)) {
      if (!burnAlive(el)) { burning.delete(el); continue; }
      const r = rectOf(el);
      if (r && r.width >= 1 && r.height >= 1) {
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        /* THE §B2 LINE. The element burns whatever it is; only the DAMAGE asks whether it may be hurt.
         * An invulnerable element just chars, and the moment the fire has reached an enemy it bites —
         * which is the whole indirect-attack route §B2 is paying for. */
        if (damageable(el)) {
          applyHit(el, Math.max(1, Math.round((BURN_DOT_BASE + rec.stacks * BURN_DOT_PER_STACK) * dt)), 'gun', cx, cy, { burnt: true, aoe: true, toward: { x: cx, y: cy } });
        }
        if (!reducedMotion() && state.fire.length < particleCap()) spawnFire(cx + rand(-r.width / 3, r.width / 3), cy + rand(-r.height / 3, r.height / 3), 1);
        if (rec.stacks >= BURN_SPREAD_MIN && t - rec.spreadAt >= BURN_SPREAD_MS) { rec.spreadAt = t; burnSpread(el, rec, r); }
      }
      rec.stacks -= BURN_DECAY * dt;
      if (rec.stacks < BURN_MIN) burning.delete(el);
    }
    if (burning.size) { burnTimer = later(burnStep, BURN_TICK_MS); kick(); }
  }
  /* §5 debug hooks: what is on fire, how hot, and whether the thing burning is the enemy or a wall. */
  debug.burning = () => Array.from(burning, ([el, rec]) => ({
    tag: tagOf(el).toUpperCase(), id: el.id || null, stacks: Math.round(rec.stacks), hostile: hostileUnit(el)
  }));
  debug.ignite = (el, stacks) => { const r = igniteEl(el, stacks == null ? 60 : +stacks); return r ? Math.round(r.stacks) : null; };
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
