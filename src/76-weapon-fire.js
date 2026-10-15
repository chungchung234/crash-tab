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
    /* SPEC-weapon-identity §C4 내리찍기 파동: 명중 지점에서 바깥으로 80px. **피해는 없다** — 이웃이
     * 흔들릴 뿐이다. 변위 시스템(src/67-displace.js) 위에 그대로 올라가므로 새 물리 루프는 없고,
     * 맞은 요소 자신은 뺀다(그쪽은 피해와 reactDamage 가 이미 맡고 있다). 피해 **뒤**에 거는 이유는
     * 뿅망치의 찌그러짐과 같다: reactDamage() 가 cancelAnimsOf(el) 로 시작한다. */
    rlWave(x, y, RL_WAVE_R, RL_WAVE_PUSH_PX, el);
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
    /* SPEC-weapon-identity §C4 연사 누적: 같은 요소를 연속으로 맞히면 탄마다 +8%, 5발까지. 표적이
     * 바뀌거나 빗나가면(el === null) 장부가 0 으로 돌아간다 — 그래서 한 틱에 **정확히 한 번** 부른다. */
    const stack = rlStreakMul(el);
    let dmg = 0, crit = false, win = null;
    if (el) {
      if (h) { win = holdWindow(el); crit = win.crit; } else crit = rollCrit('smg');
      dmg = rollDamage(WEAPONS.smg.damage, crit, falloffMul('smg', x, y) * stack);
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

  /* ══ SPEC-arsenal §B2 레이저 커터 — the sustained beam ════════════════════════════════════════════
   * 틱당 11 / 50ms (초당 220). No magazine: the resource is HEAT, and the heat ledger, the beam drawing and
   * the cut line all live in src/78-altfire.js — this is only the tick. The cut line is what makes the
   * weapon itself: "다른 무기는 어디를 맞히는가지만 레이저는 어디를 따라 지나가는가다." */
  function fireLaser(x, y, c) {
    state.shots++;
    const h = (c && c.hold && c.h) || null;
    const W = WEAPONS.laser;
    const fp = shotPoint(x, y, 'laser');
    x = fp.x; y = fp.y;
    noteShot('laser');
    lzBeamOn(x, y);                 // §B2: the beam is divs, rotated and stretched — never a canvas
    lzCutPoint(x, y);               // §B2: 충돌 지점의 궤적을 기록해(최대 60점) 절단선을 그린다
    if (interceptOrb(x, y)) return null;   // this is also the one entry point into the pierce (§B2 관통 무제한)
    const el = pickTarget(x, y, h ? h.cache : undefined);
    lzSeverAt(el, x, y);                   // the element the beam just LEFT is the one whose crossing is complete
    if (!el) { rlDwellClear(); return null; }
    /* §B2 "누적 절단선이 요소를 가로지르면 그 궤적을 따라 나뉜다." Checked BEFORE the damage tick: a sever is
     * the cut finishing its job, not a coincidence of the element running out of hit points at that moment. */
    if (lzTrySever(el, x, y)) { rlDwellClear(); return null; }
    /* SPEC-weapon-identity §C4 지속 절단: 같은 지점을 0.4초 유지하면 **그 선을 따라** 분리한다.
     * §B2 의 절단선이 "지나간 자취" 를 자르는 것과 짝이 되는 동작이다 — 저쪽은 끌어서, 이쪽은 버텨서.
     * 멈추면(지점이나 표적이 바뀌면) rlDwellTick() 이 0 부터 다시 센다. */
    if (rlDwellTick(el, x, y) >= rlDwellMs() && damageable(el)) { rlDwellClear(); rlLaserSever(el, x, y); return null; }
    let crit = false, win = null;
    if (h) { win = holdWindow(el); crit = win.crit; } else crit = rollCrit('laser');
    const dmg = rollDamage(W.damage, crit, falloffMul('laser', x, y));
    if (!h || h.tick % 6 === 1) sfx('laserLoop', { gain: 0.5 });
    applyHit(el, dmg, 'gun', x, y, { crit, hold: !!h, win });
    return el;
  }
  /* ══ SPEC-arsenal §B3 미니건 — 예열이 끝난 뒤의 연사 ══════════════════════════════════════════════
   * 26 / 60ms = 433 a second. SPEC-weapon-identity §B2 로 그 값을 사는 블룸이 14 → 2.2 px/발 이 됐다 —
   * 상한 140px 에서 버튼을 4% 로 맞히던 것이 22px 에서 68% 가 된다. The 0.8 s 예열 and the 0.6 s 공회전 유예
   * are in the hold chain (src/78-altfire.js); by the time this runs the barrels are already up to speed. */
  function fireMinigun(x, y, c) {
    state.shots++;
    const h = (c && c.hold && c.h) || null;
    const n = h ? h.tick : 1;
    x += rand(-7, 7); y += rand(-7, 7);
    const sp = shotPoint(x, y, 'minigun');
    x = sp.x; y = sp.y;
    noteShot('minigun');
    if (interceptOrb(x, y)) return null;
    const el = pickTarget(x, y, h ? h.cache : undefined);
    let dmg = 0, crit = false, win = null;
    if (el) {
      /* SPEC-weapon-identity §C4 갈아내기: 명중할 때마다 그 요소의 `max` 를 0.6%씩, 최대 30% 깎는다.
       * 피해 **앞**에 둔다 — 깎인 그릇이 이번 탄의 판정에도 쓰여야 "오래 갈면 작아진다" 가 느껴진다.
       * 페이지에는 아무것도 쓰지 않는다: state.hp 의 숫자 하나이고, restore() 가 그 맵을 통째로 새로
       * 만들면서 원래 값으로 돌아온다. */
      rlGrind(el);
      if (h) { win = holdWindow(el); crit = win.crit; } else crit = rollCrit('minigun');
      dmg = rollDamage(WEAPONS.minigun.damage, crit, falloffMul('minigun', x, y));
    }
    if (!h || n % 2 === 1) sfx('gun', { gain: 0.72, pitch: 0.86, crit: !h && crit });
    flash(x, y, 'gun', { size: 38, dur: 110 });
    if (!h || n % 3 === 0) { shake('gun', { amp: 1.6 }); spawnChips(x, y, randInt(1, 3)); }
    drawCrack(x, y, 'smg', { ink: 0.3 });
    if (el) applyHit(el, dmg, 'gun', x, y, { crit, hold: !!h, win });
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

  /* ══ SPEC-arsenal §C 상호작용 무기 · §D 예능 무기 — the seven fire() entries ═══════════════════════
   * The mechanics all live in src/68-interaction.js (and the physics under them in src/67-displace.js);
   * these are only the triggers, written in exactly the shape the other nine already have. */

  /* §C 충격포: 단발, 반경 260px 를 바깥으로 민다. 직접 피해 10뿐 — 피해는 부딪혀서 나온다. */
  function fireShockwave(x, y) {
    state.shots++;
    ixShockwaveAt(x, y);
    return null;
  }
  /* §C 견인 광선: 길게 눌러 하나를 붙잡는다. A hold weapon whose ticks do no damage at all — the first tick
   * takes hold of something and every tick after it is the beam staying on. The carrying itself is done by
   * tbStep() on the integrator's frame, not here: a 60 ms tick is far too coarse to follow a cursor. */
  function fireTractor(x, y) {
    state.shots++;
    return tbTick(x, y);
  }
  /* §C 고무탄: 맞은 요소가 6초간 bouncy. 중력과 반발 0.85 를 얻어 당구공이 된다. */
  function fireRubber(x, y) {
    state.shots++;
    const W = WEAPONS.rubber;
    const p = shotPoint(x, y, 'rubber');
    x = p.x; y = p.y;
    noteShot('rubber');
    if (interceptOrb(x, y)) return null;
    const el = pickTarget(x, y);
    const crit = el ? rollCrit('rubber') : false;
    const dmg = rollDamage(W.damage, crit, falloffMul('rubber', x, y));
    sfx('boing', { crit });
    flash(x, y, 'gun', { size: 40, dur: 130 });
    shake('gun', { amp: 2.2 });
    drawCrack(x, y, 'gun', { ink: 0.2 });
    spawnChips(x, y, randInt(2, 4));
    if (el) {
      applyHit(el, dmg, 'gun', x, y, { crit });
      /* The state is put on AFTER the damage: an element the round just destroyed has nothing to bounce,
       * and ixMakeBouncy() would otherwise mint a displacement body on a corpse. */
      let alive = false;
      try { alive = el.isConnected && !el.hasAttribute('data-crs-broken'); } catch (e) { alive = false; }
      if (alive) ixMakeBouncy(el, W.bouncyMs);
    }
    /* SPEC-weapon-identity §C4 도탄: **맞은 지점**에서 가장 가까운 다른 요소로 한 번 튕긴다, 피해 60%.
     * 한 번뿐이다 — 튕긴 탄은 다시 튕기지 않는다. 아무것도 맞히지 못한 사격은 튕기지 않는다: 튕길
     * 바닥이 없다. (명세의 "맞은 지점" 을 그대로 읽었다.) */
    if (el) rlRicochet(el, x, y);
    return el;
  }
  /* §D 뿅망치: 피해 8. 맞은 요소가 찌그러졌다 튀어오른다. "뿅" 소리와 별 입자. 가장 빠르게 휘두른다. */
  function fireSqueaky(x, y) {
    state.shots++;
    if (interceptOrb(x, y)) return null;
    const el = pickTarget(x, y);
    const crit = el ? rollCrit('squeaky') : false;
    const dmg = rollDamage(WEAPONS.squeaky.damage, crit);
    sfx('squeak', { crit });
    flash(x, y, 'hammer', { size: 76, dur: 170 });
    shake('hammer', { amp: crit ? 2.6 : 1.8 });
    ixStars(x, y, randInt(4, 7));
    // 찌그러짐은 피해 **뒤**에 건다 — reactDamage() 가 cancelAnimsOf(el) 로 시작하기 때문이다 (ixSquash 주석)
    if (el) {
      applyHit(el, dmg, 'hammer', x, y, { crit });
      ixSquash(el);
      /* SPEC-weapon-identity §C4 튕겨내기: "피해 8 + 맞은 요소가 **반대로 날아간다**(변위 강함)."
       * §D 의 찌그러짐은 그대로 두고 밀어내기를 얹는다 — 뿅망치는 이제 피해를 주는 도구가 아니라
       * **치워 내는** 장난감이다. 변위가 인라인 transform 을 빌리므로 §D 가 적었던 "인라인 transform 은
       * 건드리지 않는다" 는 더 이상 참이 아니다; 그 자리는 clearMoved() 가 원래 값으로 되돌린다. */
      let alive = false;
      try { alive = el.isConnected && !el.hasAttribute('data-crs-broken'); } catch (e) { alive = false; }
      if (alive) rlFling(el, x, y, RL_FLING_IMPULSE);
    }
    return el;
  }
  /* §D 물총: 3/틱. 젖음 8초 — 처지고 글자가 번지고 색이 빠진다. 냉각 2.5배, 더 멀리 미끄러짐. 불을 끈다. */
  function fireWater(x, y, c) {
    state.shots++;
    const W = WEAPONS.watergun;
    const h = (c && c.hold && c.h) || null;
    const n = h ? h.tick : 1;
    const fp = shotPoint(x, y, 'watergun');
    x = fp.x; y = fp.y;
    noteShot('watergun');
    ixSplash(x, y, 2);
    if (interceptOrb(x, y)) return null;
    const el = pickTarget(x, y, h ? h.cache : undefined);
    if (!h || n % 3 === 1) sfx('water', { gain: 0.6 });
    if (!el) return null;
    let crit = false, win = null;
    if (h) { win = holdWindow(el); crit = win.crit; } else crit = rollCrit('watergun');
    const dmg = rollDamage(W.damage, crit, falloffMul('watergun', x, y));
    applyHit(el, dmg, 'gun', x, y, { crit, hold: !!h, win });
    /* The two halves of the quirk, in the order §F4 of SPEC-destruction wants them: the water puts the fire
     * out first (틱당 스택 −40) and what is left is a wet element that the next fire will barely take. */
    try { douseEl(el, BURN_WATER_STACKS); } catch (e) { /* ignore */ }
    let alive = false;
    try { alive = el.isConnected && !el.hasAttribute('data-crs-broken'); } catch (e) { alive = false; }
    if (alive) ixWet(el, W.wetMs);
    return el;
  }
  /* §D 나팔: 피해 5. 90도 원뿔 420px 를 민다. 적의 탄환 방향을 뒤집는다. */
  function fireHorn(x, y) {
    state.shots++;
    ixHornAt(x, y, 1);
    return null;
  }
  /* §D 고무 치킨: 피해 12. 20% 확률로 bouncy 부여. 가장 빠르고 가볍고 예측 불가. */
  function fireChicken(x, y) {
    state.shots++;
    if (interceptOrb(x, y)) return null;
    const el = pickTarget(x, y);
    const crit = el ? rollCrit('chicken') : false;
    const dmg = rollDamage(WEAPONS.chicken.damage, crit);
    sfx('chicken', { crit });
    flash(x, y, 'hammer', { size: 58, dur: 150 });
    shake('hammer', { amp: 1.6 });
    if (el) {
      applyHit(el, dmg, 'hammer', x, y, { crit });
      let alive = false;
      try { alive = el.isConnected && !el.hasAttribute('data-crs-broken'); } catch (e) { alive = false; }
      if (alive && ixRollQuirk(WEAPONS.chicken.bouncyChance)) ixMakeBouncy(el, WEAPONS.rubber.bouncyMs);
    }
    return el;
  }

  /* ══ SPEC-arsenal §E 무기 다양화 (9단계) ══════════════════════════════════════════════════════════
   * 네 개의 fire() 는 전부 얇다 — 새 동사의 본체는 src/69-utility.js 에 있고 여기서는 그것을 제품의
   * 공격 한 번으로 묶을 뿐이다. §C/§D 의 일곱이 그랬던 것과 같은 모양이다. */

  /* 샷건: "펠릿 9발 원뿔. 밀집한 작은 요소를 한 번에."
   * 펠릿은 각자 자기 pickTarget 을 돈다 — 그래야 "한 번에 여럿" 이 연출이 아니라 사실이 된다. 캐시를
   * 한 개 공유하므로 아홉 번의 적중 판정이 한 번의 레이아웃 읽기 비용으로 끝난다. 사거리 감쇠는
   * falloff 0.86 으로 무기고 최대다(§E). */
  function fireShotgun(x, y) {
    state.shots++;
    const W = WEAPONS.shotgun;
    const sp = shotPoint(x, y, 'shotgun');
    x = sp.x; y = sp.y;
    noteShot('shotgun');
    sfx('shotgun');
    flash(x, y, 'gun', { size: 72, dur: 150 });
    shake('gun', { amp: 4.6 });
    drawCrack(x, y, 'gun', { ink: 0.4 });
    spawnChips(x, y, randInt(5, 8));
    if (interceptOrb(x, y)) return null;
    const cache = new Map();
    const R = W.pelletSpread;
    const hit = new Map();
    let first = null;
    for (let i = 0; i < W.pellets; i++) {
      /* 첫 펠릿은 조준점 그대로, 나머지 여덟은 반경 R 의 원 안에 고르게 — 면적 균등이므로 sqrt.
       * SPEC-weapon-identity §C4 펠릿 산개: 아홉이 **서로 다른 요소를 찾는다**. 이미 맞힌 요소에
       * 떨어진 펠릿은 원뿔을 조금씩 넓히며 최대 네 번까지 다시 고른다 — 그래도 못 찾으면 거기 맞는다.
       * 다시 고르는 것이지 없던 사거리를 주는 것이 아니다. */
      let el = null, px0 = x, py0 = y;
      for (let tries = 0; tries < 4; tries++) {
        const exact = i === 0 && tries === 0;   // 바깥의 `first`(처음 맞은 요소)와 다른 것이다 — 가리지 않게 이름을 달리한다
        const a = exact ? 0 : rand(0, Math.PI * 2), d = exact ? 0 : R * Math.sqrt(Math.random()) * (1 + tries * 0.3);
        px0 = clamp(x + Math.cos(a) * d, 0, viewW()); py0 = clamp(y + Math.sin(a) * d, 0, viewH());
        const cand = pickTarget(px0, py0, cache);
        if (!cand) continue;
        el = cand;
        if (!hit.has(cand)) break;
      }
      if (!el) continue;
      if (!first) first = el;
      const crit = rollCrit('shotgun');
      const dmg = rollDamage(W.damage, crit, falloffMul('shotgun', px0, py0));
      applyHit(el, dmg, 'gun', px0, py0, { crit });
      hit.set(el, (hit.get(el) || 0) + 1);
    }
    state.lastShotgunSpread = hit.size;    // §E: "밀집한 작은 요소를 한 번에" — 몇 개를 한 번에 쳤는가
    return first;
  }
  /* 못총: "고정. 맞은 조각이 그 자리에 박힌다." 피해는 평범한 연사고, 새로운 것은 pnPinAt() 하나다. */
  function fireNailgun(x, y, c) {
    state.shots++;
    const h = (c && c.hold && c.h) || null;
    const W = WEAPONS.nailgun;
    const sp = shotPoint(x, y, 'nailgun');
    x = sp.x; y = sp.y;
    noteShot('nailgun');
    if (!h || h.tick % 2 === 1) sfx('nail');
    flash(x, y, 'gun', { size: 30, dur: 90 });
    drawCrack(x, y, 'gun', { ink: 0.22 });
    /* 못은 조각을 먼저 잡는다. 때려서 생긴 조각이 아니라 **이미 날고 있는** 조각을 박는 무기이기 때문에,
     * 이 순서가 바뀌면 방금 만든 조각이 태어나기도 전에 고정 대상을 찾게 된다. */
    const pinned = pnPinAt(x, y, W.pinRadius, W.pinMax);
    if (pinned) pnNailFx(x, y);
    if (interceptOrb(x, y)) return null;
    const el = pickTarget(x, y, h ? h.cache : undefined);
    if (!el) return null;
    let crit = false, win = null;
    if (h) { win = holdWindow(el); crit = win.crit; } else crit = rollCrit('nailgun');
    const dmg = rollDamage(W.damage, crit, falloffMul('nailgun', x, y));
    /* SPEC-weapon-identity §C4 못 박기: 같은 요소에 못 **3개**를 박으면 맞닿은 이웃과 꿰맨다 —
     * 그 뒤로는 둘이 같이 부서진다(실을 당기는 쪽은 applyHit 의 래퍼, src/72-roles.js). 부서진 요소에는
     * 못을 박을 수 없으므로 'damaged' 일 때만 센다. */
    if (applyHit(el, dmg, 'gun', x, y, { crit, hold: !!h, win }) === 'damaged') rlNailHit(el);
    return el;
  }
  /* 냉각총: "빙결. 받는 피해 ×1.8, 조각 수 ×2.5, 적은 2초 정지."
   * 피해 4 가 전부다 — §E 가 "혼자 쓰면 가장 약하다" 고 적었고 그 말이 숫자로 지켜져야 조합이 뜻을
   * 갖는다. 얼리는 양은 ixFreeze() 를 통과하므로 젖은 표적에서는 자동으로 2.5배가 된다(8단계 §D). */
  function fireFreezegun(x, y, c) {
    state.shots++;
    const h = (c && c.hold && c.h) || null;
    const W = WEAPONS.freezegun;
    const sp = shotPoint(x, y, 'freezegun');
    x = sp.x; y = sp.y;
    noteShot('freezegun');
    if (!h || h.tick % 4 === 1) sfx('freeze', { gain: 0.6 });
    flash(x, y, 'gun', { size: 26, dur: 80 });
    if (interceptOrb(x, y)) return null;
    const el = pickTarget(x, y, h ? h.cache : undefined);
    if (!el) return null;
    let crit = false, win = null;
    if (h) { win = holdWindow(el); crit = win.crit; } else crit = rollCrit('freezegun');
    const dmg = rollDamage(W.damage, crit, falloffMul('freezegun', x, y));
    /* 얼리는 것이 먼저다. applyHit() 은 빙결 배수를 읽으므로, 이 순서라야 같은 틱의 4 도 ×1.8 을 받는다
     * — "받는 피해 ×1.8" 에 예외를 두지 않는다는 뜻이다. */
    /* SPEC-weapon-identity §C4 서리 전파: **이미 얼어 있는** 요소에 맞히면 맞닿은 이웃으로 번진다.
     * 얼리기 전에 묻는다 — 이번 틱이 처음 얼린 요소는 아직 "얼린 것을 또 때렸다" 가 아니다. */
    const wasFrozen = fzIsFrozen(el);
    fzFreeze(el, W.freezePerTick, 0);
    if (wasFrozen) rlFrostSpread(el, W);
    applyHit(el, dmg, 'gun', x, y, { crit, hold: !!h, win });
    return el;
  }
  /* 중력탄: "끌어모으기. 조각과 적의 탄환을 빨아들인다. 직접 피해 0."
   * applyHit() 을 한 번도 부르지 않는다. 이 무기의 피해는 0 이고, 그건 버그가 아니라 §E 의 문장이다. */
  function fireGravity(x, y) {
    state.shots++;
    const W = WEAPONS.gravity;
    sfx('gravity');
    flash(x, y, 'bomb', { size: W.radius * 0.5, dur: 160 });
    ring(x, y, { r: W.radius });
    shake('bomb', { amp: 3, dur: 220 });
    gwSpawn(x, y, W.radius, W.wellMs, 1);
    scheduleHud();
    return null;
  }
