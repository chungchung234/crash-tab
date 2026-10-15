// ── SPEC-arsenal §C 상호작용 무기 (충격포 · 견인 광선 · 고무탄) · §D 예능 무기 (뿅망치 · 물총 · 나팔 · 고무 치킨) ──
  /* =====================================================================
   * 10.55 Interaction weapons — 8단계
   *
   * 사용자: "예능 무기도 넣어줘 뿅망치나 물총 같은거 그리고 컴포넌트들
   *          혹은 프레임과 상호작용되는 무기들도 팅긴다거나 밀친다거나
   *          땅긴다거나"
   *
   * Everything in here is built on the displacement system (§E of
   * SPEC-combat, src/67-displace.js). That module owns the bodies, the
   * integrator, the collision pass and — above all — the promise that a
   * borrowed `transform` goes back to the value it was found at. Nothing
   * below ever writes `transform` on a page element itself: it asks
   * displaceEl() for an impulse and lets §E do the physics.
   *
   * §C — 상호작용 셋. One verb each:
   *   충격포     민다    반경 260 을 바깥으로. 직접 피해 10뿐 — 피해는 부딪혀서 나온다
   *   견인 광선  당긴다  하나를 붙잡아 커서를 따라오게 하고, 떼면 그 속도로 날아간다
   *   고무탄     튕긴다  맞은 것이 6초간 중력과 반발 0.85 를 얻어 당구공이 된다
   *
   * §D — 예능 넷. 밴드에서 빠지는 대신 각자 피해가 아닌 효과를 하나씩 갖는다
   * (`WEAPONS[id].quirk` — 표가 아니라 필드다):
   *   뿅망치     squash   찌그러졌다 튀어오른다
   *   물총       wet      젖음 8초 — 불을 끄고, 냉각을 2.5배로 만들고, 더 멀리 미끄러진다
   *   나팔       reflect  90도 원뿔을 밀고 적의 탄환 방향을 뒤집는다
   *   고무 치킨  bouncy   20% 확률로 고무탄과 같은 상태를 건다
   *
   * 물총이 이 묶음의 중심이다. 혼자서는 거의 아무것도 못 하지만 젖은 것은
   * 불이 안 붙고, 2.5배로 얼고, 밀면 훨씬 멀리 간다 — 다른 무기를 강하게
   * 만드는 준비 도구다 (물총 → 냉각총(9단계) → 망치).
   *
   * THE ONE STRUCTURAL RULE HERE: the two states this module owns on a PAGE
   * element — 젖음's inline `filter` and the bouncy flag — are each written
   * through one function and taken back through one function, and both are
   * emptied by restore(). 연소(§F, src/77-burn.js) also borrows `filter`, so
   * the two never hold it at once: igniteEl() is wrapped below to drop the
   * wet look BEFORE the fire saves what it finds, and the wet look is never
   * written onto something that is already burning. Getting that order wrong
   * leaves a wet filter behind the moment a fire goes out, which is exactly
   * the kind of trace CLAUDE.md forbids.
   * ===================================================================== */

  /* SPEC-weapon-identity §C3 (MINIMAL EDIT, 보고에 적었다): 아래 두 곳의 applyHit 에 `weapon: W.id` 를
   * 더했다. 등급 계수의 임자는 **쏜 무기**이고(src/72-roles.js), 충격포와 나팔은 디버그 훅으로도
   * 발사되어 action() 을 지나지 않는 경로가 있다 — 그 경로에서는 손에 든 다른 무기의 계수가 붙었다.
   * 둘 다 §C3 의 표에 없으므로(기본 1.0) 이 한 단어가 그 사고를 구조적으로 막는다. */
  /* ── the table extras ─────────────────────────────────────────────────────
   * DESTRUCTION (src/66-fracture.js) and CH_SHAPES (src/51-crosshair.js) are plain objects declared EARLIER
   * in the bundle, so the new rows are added here rather than by editing two files this workstream only
   * reads — the same device SPEC-arsenal §B used for the laser and the minigun. src/66's
   * `for (const id of WEAPON_IDS) WEAPONS[id].destruction = DESTRUCTION[id]` has already run and wrote
   * `undefined` for these seven ids; the lines below are what fill them in.
   * INTERPRETATION (reported): §C and §D name no destruction profile, only the verb. The profiles follow the
   * verb — a shove bursts, a tow drops a slab, rubber and the chicken throw wedges outward, the squeaky
   * hammer and the horn shred in strips (nothing with that little force cuts), and water just drops. */
  DESTRUCTION.shockwave = { shape: 'wedge', separation: 'burst',  finish: 'none', particles: 'dust',  delayMs: 0,  vaporise: 0 };
  DESTRUCTION.tractor   = { shape: 'slab',  separation: 'drop',   finish: 'none', particles: 'none',  delayMs: 0,  vaporise: 0 };
  DESTRUCTION.rubber    = { shape: 'wedge', separation: 'radial', finish: 'none', particles: 'dust',  delayMs: 0,  vaporise: 0 };
  DESTRUCTION.squeaky   = { shape: 'strip', separation: 'radial', finish: 'none', particles: 'dust',  delayMs: 80, vaporise: 0 };
  DESTRUCTION.watergun  = { shape: 'ash',   separation: 'drop',   finish: 'none', particles: 'none',  delayMs: 0,  vaporise: 0 };
  DESTRUCTION.horn      = { shape: 'strip', separation: 'burst',  finish: 'none', particles: 'dust',  delayMs: 0,  vaporise: 0 };
  DESTRUCTION.chicken   = { shape: 'wedge', separation: 'burst',  finish: 'none', particles: 'spark', delayMs: 0,  vaporise: 0 };
  for (const id of ['shockwave', 'tractor', 'rubber', 'squeaky', 'watergun', 'horn', 'chicken']) WEAPONS[id].destruction = DESTRUCTION[id];

  /* §A4 of SPEC-crosshair: every weapon has a shape. 충격포 is the blast circle (its radius IS the push
   * radius, read from the weapon table by chBlastRadius()); 견인 광선 is an open ring with a dot in it — a
   * grab point, not an aim point; 고무탄 a small bouncing ring; 뿅망치 a fat soft arc; 물총 a two-arm squirt;
   * 나팔 the cone the flamethrower already speaks; 고무 치킨 a loose diagonal, because nothing it does is
   * straight. */
  CH_SHAPES.shockwave = { arms: 4, dot: false, armLen: 5, blast: true, parts: [{ cls: 'crs-ch-circle', size: 22, w: 2, rot: 0 }] };
  CH_SHAPES.tractor   = { arms: 4, dot: true,  armLen: 3, thin: true, parts: [{ cls: 'crs-ch-circle', size: 28, w: 1, rot: 0 }] };
  CH_SHAPES.rubber    = { arms: 4, dot: true,  armLen: 4, parts: [{ cls: 'crs-ch-circle', size: 13, w: 2, rot: 0 }] };
  CH_SHAPES.squeaky   = { arms: 0, dot: false, armLen: 0, parts: [{ cls: 'crs-ch-arc crs-ch-arc-fat', size: 28, w: 4, rot: -30 }] };
  CH_SHAPES.watergun  = { arms: 4, dot: true,  armLen: 6, thin: true, parts: [] };
  CH_SHAPES.horn      = { arms: 0, dot: false, armLen: 0, cone: true, parts: [] };
  CH_SHAPES.chicken   = { arms: 0, dot: true,  armLen: 0, parts: [{ cls: 'crs-ch-slash', size: 22, w: 2, rot: 28 }] };

  /* ── constants ──────────────────────────────────────────────────────────── */
  const IX_MAX_SPEED = 2800;          // px/s — no impulse here may out-run the integrator's own collision pass
  const IX_TICK_MS = 100;             // the 젖음 / bouncy expiry heartbeat (one self-rescheduling chain, never setInterval)
  const IX_WET_FILTER = 'saturate(.42) blur(.6px) brightness(.94)';   // §D 물총: 글자가 번지고 색이 빠진다
  const IX_WET_COOL_MUL = 2.5;        // §D 물총: 냉각 2.5배 (9단계 냉각총이 읽을 규칙)
  const IX_STAR_MS = 520;             // §D 뿅망치: 별 입자 수명
  const IX_HORN_FLIP_PAD = 60;        // 나팔의 원뿔 판정에 주는 여유 — 탄환은 점이라 가장자리에서 아슬아슬하게 빠진다

  /* ── §D 젖음 · §C 고무 — the two per-element states this module owns ────────
   * Maps, not WeakMaps: the heartbeat below has to WALK them. Both are emptied by restore(). */
  const ixWetEls = new Map();         // el -> { until, filterSaved, filterPriority, wrote, owns }
  const ixBouncyEls = new Map();      // el -> until
  let ixTimer = 0;

  function ixArm() {
    if (ixTimer || !state.active) return;
    if (!ixWetEls.size && !ixBouncyEls.size) return;
    ixTimer = later(ixStep, IX_TICK_MS);
  }
  function ixStep() {
    ixTimer = 0;
    if (!state.active) { ixClearStates(); return; }
    const t = now();
    for (const [el, rec] of Array.from(ixWetEls)) {
      let gone = false;
      try { gone = !el.isConnected || el.hasAttribute('data-crs-broken'); } catch (e) { gone = true; }
      if (gone || t >= rec.until) { ixUnwet(el); continue; }
      ixWetPaint(el, rec);
    }
    for (const [el, until] of Array.from(ixBouncyEls)) {
      let gone = false;
      try { gone = !el.isConnected || el.hasAttribute('data-crs-broken'); } catch (e) { gone = true; }
      if (gone || t >= until) { ixUnbounce(el); continue; }
    }
    ixArm();
  }

  /* ── §D 물총 젖음 ──────────────────────────────────────────────────────────
   * The look is an inline `filter`, so the original value AND its priority are saved before the first write
   * and put back on expiry — 빈 문자열이 아니라 원래 값으로 (CLAUDE.md). `filter` carries no !important
   * anywhere in content.css for page elements, which is why this is allowed to be a plain write at all. */
  function ixWetPaint(el, rec) {
    if (isBurning(el)) { ixWetUnpaint(el, rec); return; }      // 연소가 filter 를 쓰고 있다 — 양보한다
    if (rec.owns && rec.wrote === IX_WET_FILTER) return;
    if (!rec.owns) {
      try { rec.filterSaved = el.style.getPropertyValue('filter') || ''; rec.filterPriority = el.style.getPropertyPriority('filter') || ''; }
      catch (e) { rec.filterSaved = ''; rec.filterPriority = ''; }
      rec.owns = true;
    }
    try { el.style.setProperty('filter', IX_WET_FILTER); rec.wrote = IX_WET_FILTER; } catch (e) { /* ignore */ }
  }
  function ixWetUnpaint(el, rec) {
    if (!rec.owns) return;
    rec.owns = false; rec.wrote = '';
    try {
      if (rec.filterSaved) el.style.setProperty('filter', rec.filterSaved, rec.filterPriority);
      else el.style.removeProperty('filter');
    } catch (e) { /* ignore */ }
  }
  /* The ONE way anything gets wet. ms defaults to the water pistol's 8 s (§D). */
  function ixWet(el, ms) {
    if (!el || el.nodeType !== 1 || !state.active || isOurs(el)) return null;
    try { if (!el.isConnected || el.hasAttribute('data-crs-broken')) return null; } catch (e) { return null; }
    const dur = scaleMs(ms > 0 ? ms : WEAPONS.watergun.wetMs);
    let rec = ixWetEls.get(el);
    if (!rec) { rec = { until: 0, filterSaved: '', filterPriority: '', wrote: '', owns: false }; ixWetEls.set(el, rec); }
    rec.until = Math.max(rec.until, now() + dur);
    /* §F4 of SPEC-destruction already has the whole 젖음 ↔ 불 table — it reads `chilled`, so the water
     * pistol does not get a second ledger of its own, it fills in the one the burn system is already
     * consulting. This is literally the line step 6 said step 8 would write. */
    try { chillOf(el).wet = dur; } catch (e) { /* ignore */ }
    const b = state.moved.get(el);
    if (b && !b.released) b.wet = true;                       // §E2 중력 + §C의 낮은 마찰 — 처지고 미끄러진다
    ixWetPaint(el, rec);
    ixArm();
    return rec;
  }
  function ixUnwet(el) {
    const rec = ixWetEls.get(el);
    if (!rec) return false;
    ixWetEls.delete(el);
    ixWetUnpaint(el, rec);
    try { const c = chilled.get(el); if (c) c.wet = 0; } catch (e) { /* ignore */ }
    const b = state.moved.get(el);
    if (b && !b.released) b.wet = false;
    return true;
  }
  function ixIsWet(el) {
    const rec = el && ixWetEls.get(el);
    return !!(rec && now() < rec.until);
  }
  /* §D 물총: "냉각 2.5배". The freeze gun itself is 9단계 (§E), so what lands now is the RULE and the one
   * entry point it will call — exactly how step 6 landed 젖음 and 빙결 with no weapon behind them.
   * INTERPRETATION (reported): §D's "냉각 2.5배" is read as "젖은 것은 빙결이 2.5배로 쌓인다", which is what
   * makes the 물총 → 냉각총 → 망치 chain the brief names the strongest one in the game. */
  function ixCoolMul(el) { return ixIsWet(el) ? IX_WET_COOL_MUL : 1; }
  function ixFreeze(el, amount) {
    if (!el || !(amount > 0)) return null;
    let c = null;
    try { c = chillOf(el); } catch (e) { return null; }
    c.frozen = clamp(c.frozen + amount * ixCoolMul(el), 0, BURN_FROZEN_FULL);
    return c.frozen;
  }

  /* ── §C 고무탄 / §D 고무 치킨 — bouncy ─────────────────────────────────────
   * A bouncy body is given gravity and restitution 0.85 by the integrator (src/67-displace.js); all this
   * does is turn the flag on, make sure a body exists to carry it, and take it off again after 6 s. */
  function ixMakeBouncy(el, ms) {
    if (!el || !state.active) return null;
    const b = displaceEl(el, 0, 0, { bouncy: true });
    if (!b) return null;
    ixBouncyEls.set(el, now() + scaleMs(ms > 0 ? ms : WEAPONS.rubber.bouncyMs));
    ixArm();
    kick();
    return b;
  }
  function ixUnbounce(el) {
    if (!ixBouncyEls.has(el)) return false;
    ixBouncyEls.delete(el);
    const b = state.moved.get(el);
    if (b && !b.released) b.bouncy = false;
    return true;
  }
  function ixIsBouncy(el) {
    const until = el && ixBouncyEls.get(el);
    return !!(until && now() < until);
  }
  /* §D 고무 치킨's 20 %. The two debug switches are the same escape hatch noCrit / forceCrit are: a chance
   * nothing can pin down is a chance nothing can assert either. */
  function ixRollQuirk(p) { return debug.forceQuirk ? true : (debug.noQuirk ? false : Math.random() < p); }

  /* ── pushing ──────────────────────────────────────────────────────────────
   * §C 충격포: 충격량 900 × (1 − d/R), outward from the impact point. aoeCandidates() is reused whole so the
   * push finds exactly the elements an explosion of the same radius would — including the ones behind cover,
   * because a pressure wave does not care what is in front of what. */
  function ixElCentre(el, fallbackX, fallbackY) {
    const r = rectOf(el);
    if (!r || r.width < 1 || r.height < 1) return { x: fallbackX, y: fallbackY };
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function ixClampImpulse(ix, iy) {
    const m = Math.hypot(ix, iy);
    const cap = IX_MAX_SPEED * 6;                 // mass is ≥ 0.6, so this is the ceiling on the resulting speed
    if (!(m > cap)) return { ix, iy };
    return { ix: ix * cap / m, iy: iy * cap / m };
  }
  function ixPushRadial(x, y, R, impulse, opts) {
    const W = WEAPONS.shockwave;
    const cands = aoeCandidates(x, y, R, (opts && opts.maxTargets) || W.maxTargets, W.rings, true);
    const out = [];
    for (const c of cands) {
      const q = ixElCentre(c.el, x, y);
      let dx = q.x - x, dy = q.y - y;
      let L = Math.hypot(dx, dy);
      if (!(L > 1)) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); L = 1; }
      const k = Math.max(0, 1 - clamp(c.d, 0, R) / R);        // §C: 900 × (1 − d/R) — d 는 가장자리까지의 거리
      const mag = impulse * k;
      if (!(mag > 0)) continue;
      const imp = ixClampImpulse((dx / L) * mag, (dy / L) * mag);
      const b = displaceEl(c.el, imp.ix, imp.iy, opts);
      if (b) out.push(c.el);
    }
    return out;
  }
  /* §D 나팔: a 90° wedge. INTERPRETATION (reported): §D gives the cone an angle and a reach but not an apex.
   * The apex is the AIM POINT and the axis is the direction the blast travels (origin → aim), because every
   * other weapon in this product happens at the aim point, and an apex at the player's feet would put most
   * of a 420 px cone inside the bottom bezel. Everything inside is pushed the SAME way — along the axis —
   * since a horn blows forward, it does not scatter. */
  function ixOrigin() {
    if (state.avatar && isFinite(state.player.x)) return { x: state.player.x, y: state.player.y };
    return { x: viewW() / 2, y: viewH() + 8 };
  }
  function ixInCone(px0, py0, ang, R, halfDeg, qx, qy, pad) {
    const dx = qx - px0, dy = qy - py0, L = Math.hypot(dx, dy);
    if (L > R + (pad || 0)) return false;
    if (L < 1) return true;
    let d = Math.atan2(dy, dx) - ang;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d) <= halfDeg * DEG;
  }
  function ixPushCone(x, y, ang, R, coneDeg, impulse) {
    const W = WEAPONS.horn;
    const half = coneDeg / 2;
    const cands = aoeCandidates(x, y, R, W.maxTargets, W.rings, true);
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const out = [];
    for (const c of cands) {
      const q = ixElCentre(c.el, x, y);
      if (!ixInCone(x, y, ang, R, half, q.x, q.y, 0)) continue;
      const k = Math.max(0.15, 1 - clamp(c.d, 0, R) / R);
      const imp = ixClampImpulse(ux * impulse * k, uy * impulse * k);
      const b = displaceEl(c.el, imp.ix, imp.iy, { spin: rand(-120, 120) });
      if (b) out.push(c.el);
    }
    return out;
  }
  /* §D 나팔의 고유 효과: "적의 탄환 방향을 뒤집는다 — 유일하게 전투 효용이 분명하다." A projectile still in
   * its wind-up has no velocity to reverse, so it is launched first and then turned around: the shot was
   * fired, it simply goes the other way. */
  function ixFlipOrbs(x, y, ang, R, coneDeg) {
    const half = coneDeg / 2;
    let n = 0;
    for (const o of state.orbs.slice()) {
      if (!ixInCone(x, y, ang, R, half, o.x, o.y, IX_HORN_FLIP_PAD)) continue;
      if (!o.launched) { try { launchOrb(o); } catch (e) { continue; } }
      if (o.kind === 'mortar') continue;                       // 포물선탄은 착탄 지점이 발사 때 고정된다 — 뒤집을 속도가 없다
      o.vx = -o.vx; o.vy = -o.vy;
      o.flipped = true;
      o.launchAt = now();                                      // 3초 수명을 다시 센다: 되돌아가는 탄도 날아갈 시간이 있어야 한다
      n++;
    }
    if (n) kick();
    return n;
  }

  /* ── §D 뿅망치 — 찌그러졌다 튀어오른다 + 별 입자 ──────────────────────────
   * A Web Animation with fill:'none' on the page element itself: it writes NO inline style, so there is
   * nothing to put back afterwards, and trackAnim() hands it to restore()'s cancelAnims(). A displaced
   * element is the one case it cannot show — §E writes `transform` inline with !important, which beats a
   * WAAPI animation — and that is the right answer anyway: a thing in flight is not sitting there wobbling. */
  function ixSquash(el) {
    if (!el || reducedMotion()) return false;
    try { if (!el.isConnected || el.hasAttribute('data-crs-broken')) return false; } catch (e) { return false; }
    const ms = Math.max(60, scaleMs(WEAPONS.squeaky.squashMs));
    try {
      /* `composite: 'add'`, and it MUST be called after applyHit(), not before. reactDamage()
       * (src/70-break.js) opens with cancelAnimsOf(el) and then plays the hit jolt with composite 'add' —
       * a squash started first is simply cancelled, which is exactly what happened the first time (the test
       * found one animation on the element and it was the jolt). Added rather than replacing, so the jolt
       * and the squash are both still there: the thing is knocked back AND squashed. */
      trackAnim(el.animate([
        { transform: 'scale(1, 1)', offset: 0 },
        { transform: 'scale(1.24, .6)', offset: 0.22 },
        { transform: 'scale(.9, 1.17)', offset: 0.5 },
        { transform: 'scale(1.06, .95)', offset: 0.74 },
        { transform: 'scale(1, 1)', offset: 1 }
      ], { duration: ms, easing: 'ease-out', fill: 'none', composite: 'add' }));
    } catch (e) { return false; }
    return true;
  }
  function ixStars(x, y, count) {
    if (!root || reducedMotion()) return 0;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const s = rand(9, 17);
      const node = mk('div', 'crs-star');
      node.style.left = px(x - s / 2); node.style.top = px(y - s / 2);
      node.style.width = px(s); node.style.height = px(s);
      root.append(node);
      state.fire.push(node);
      while (state.fire.length > particleCap()) { const old = state.fire.shift(); try { old.remove(); } catch (e) { /* ignore */ } }
      const kill = () => { try { node.remove(); } catch (e) { /* ignore */ } const k = state.fire.indexOf(node); if (k >= 0) state.fire.splice(k, 1); };
      const a = rand(0, Math.PI * 2), d = rand(26, 62);
      try {
        const an = trackAnim(node.animate([
          { transform: 'translate(0px, 0px) rotate(0deg) scale(.5)', opacity: 1 },
          { transform: 'translate(' + px(Math.cos(a) * d) + ', ' + px(Math.sin(a) * d - 14) + ') rotate(' + Math.round(rand(-220, 220)) + 'deg) scale(1.1)', opacity: 0 }
        ], { duration: scaleMs(IX_STAR_MS), easing: 'ease-out', fill: 'forwards' }));
        an.addEventListener('finish', kill);
      } catch (e) { /* ignore */ }
      later(kill, IX_STAR_MS + 350);
      n++;
    }
    return n;
  }
  /* §D 물총의 물방울. Same ledger as the fire particles (state.fire), so the particle cap, the restore()
   * sweep and the "흔적 없음" assertions all cover them with no second bookkeeping. */
  function ixSplash(x, y, count) {
    if (!root || reducedMotion()) return 0;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const s = rand(5, 11);
      const node = mk('div', 'crs-splash');
      node.style.left = px(x - s / 2); node.style.top = px(y - s / 2);
      node.style.width = px(s); node.style.height = px(s);
      root.append(node);
      state.fire.push(node);
      while (state.fire.length > particleCap()) { const old = state.fire.shift(); try { old.remove(); } catch (e) { /* ignore */ } }
      const kill = () => { try { node.remove(); } catch (e) { /* ignore */ } const k = state.fire.indexOf(node); if (k >= 0) state.fire.splice(k, 1); };
      try {
        const an = trackAnim(node.animate([
          { transform: 'translate(0px, 0px) scale(1)', opacity: 0.9 },
          { transform: 'translate(' + px(rand(-26, 26)) + ', ' + px(rand(10, 44)) + ') scale(.4)', opacity: 0 }
        ], { duration: scaleMs(rand(260, 420)), easing: 'ease-in', fill: 'forwards' }));
        an.addEventListener('finish', kill);
      } catch (e) { /* ignore */ }
      later(kill, 900);
      n++;
    }
    return n;
  }
  /* §D 나팔의 원뿔 — two edges and a sweep, drawn as divs (no canvas, §금지 목록). */
  function ixConeFx(x, y, ang, R, coneDeg) {
    if (!root) return null;
    const node = mk('div', 'crs-horn-cone');
    node.style.left = px(x); node.style.top = px(y);
    node.style.width = px(R); node.style.height = px(2 * R * Math.tan((coneDeg / 2) * DEG));
    node.style.transformOrigin = '0 50%';
    node.style.transform = 'translateY(-50%) rotate(' + ang.toFixed(4) + 'rad)';
    root.append(node);
    const kill = () => { try { node.remove(); } catch (e) { /* ignore */ } };
    try {
      const an = trackAnim(node.animate([
        { opacity: 0.85, transform: 'translateY(-50%) rotate(' + ang.toFixed(4) + 'rad) scaleX(.25)' },
        { opacity: 0, transform: 'translateY(-50%) rotate(' + ang.toFixed(4) + 'rad) scaleX(1)' }
      ], { duration: reducedMotion() ? 90 : 260, easing: 'ease-out', fill: 'forwards' }));
      an.addEventListener('finish', kill);
    } catch (e) { /* ignore */ }
    later(kill, 700);
    return node;
  }

  /* ── §C 견인 광선 ─────────────────────────────────────────────────────────
   * 길게 눌러 하나를 붙잡는다. 커서를 따라오고(스프링 추종) 떼면 그 속도로 날아간다. mass > 4 는 못 잡는다.
   * 잡힌 적은 공격을 멈춘다.
   *
   * The follow is written as a VELOCITY, not as a position: the body stays a body in §E's integrator, so it
   * still collides with everything on the way (which is most of the fun), and "떼면 그 속도로 날아간다" needs
   * no special case at all — letting go simply stops writing the velocity and the last one is still there. */
  const tb = { el: null, body: null, at: 0, beam: null, grip: null, grabs: 0, refusals: 0, lastRefusal: '', peak: 0 };
  function tbHeld() { return !!(tb.el && tb.body && !tb.body.released); }
  function tbMassOf(el) {
    const r = rectOf(el);
    if (!r || r.width < 1 || r.height < 1) return Infinity;
    return movedMass(r);
  }
  function tbGrab(x, y) {
    if (tbHeld()) return tb.el;
    const el = pickTarget(x, y);
    if (!el) { tb.refusals++; tb.lastRefusal = 'nothing'; return null; }
    if (!movedEligible(el)) { tb.refusals++; tb.lastRefusal = 'ineligible'; return null; }
    /* §C: "mass > 4 는 못 잡는다." Measured BEFORE anything is created — a refused grab must not leave a
     * displacement body (and therefore a borrowed transform) behind on an element it never moved. */
    const m = tbMassOf(el);
    if (!(m <= WEAPONS.tractor.grabMaxMass)) { tb.refusals++; tb.lastRefusal = 'mass'; sfx('clack'); return null; }
    const b = displaceEl(el, 0, 0, {});
    if (!b) { tb.refusals++; tb.lastRefusal = 'nobody'; return null; }
    tb.el = el; tb.body = b; tb.at = now(); tb.grabs++; tb.peak = 0;
    b.resting = false;
    sfx('tractor');
    tbDraw();
    kick();
    return el;
  }
  function tbRelease(silent) {
    const held = tbHeld();
    const el = tb.el;
    tb.el = null; tb.body = null;
    tbClearNodes();
    if (!held) return false;
    if (!silent) { sfx('tractorOff'); startCooldown('tractor', WEAPONS.tractor.releaseCdMs); }
    kick();
    return !!el;
  }
  /* Runs from the wrapped stepMoved() below — the SAME frame the integrator uses, so the spring is solved
   * against the position the body is actually at rather than one frame behind it. */
  function tbStep(t, dt) {
    if (!tbHeld()) return;
    const b = tb.body;
    let gone = false;
    try { gone = !tb.el.isConnected || tb.el.hasAttribute('data-crs-broken'); } catch (e) { gone = true; }
    if (gone) { tbRelease(true); return; }
    const q = ixElCentre(tb.el, state.hoverX, state.hoverY);
    const k = WEAPONS.tractor.grabK;
    let vx = (state.hoverX - q.x) * k, vy = (state.hoverY - q.y) * k;
    const sp = Math.hypot(vx, vy);
    if (sp > IX_MAX_SPEED) { vx = vx * IX_MAX_SPEED / sp; vy = vy * IX_MAX_SPEED / sp; }
    b.vx = vx; b.vy = vy; b.resting = false;
    if (sp > tb.peak) tb.peak = Math.min(sp, IX_MAX_SPEED);
    tbDraw();
  }
  function tbDraw() {
    if (!root || !tbHeld()) return;
    const o = ixOrigin();
    const q = ixElCentre(tb.el, state.hoverX, state.hoverY);
    if (!tb.beam || !tb.beam.isConnected) { tb.beam = mk('div', 'crs-tractor-beam'); root.append(tb.beam); }
    if (!tb.grip || !tb.grip.isConnected) {
      tb.grip = mk('div', 'crs-tractor-grip');
      for (let i = 0; i < 4; i++) tb.grip.append(mk('span', 'crs-tractor-grip-c crs-tractor-grip-c' + i));
      root.append(tb.grip);
    }
    const len = Math.hypot(q.x - o.x, q.y - o.y), ang = Math.atan2(q.y - o.y, q.x - o.x);
    try {
      tb.beam.style.left = px(o.x); tb.beam.style.top = px(o.y);
      tb.beam.style.width = px(len); tb.beam.style.height = '16px';
      tb.beam.style.transformOrigin = '0 50%';
      tb.beam.style.transform = 'translateY(-8px) rotate(' + ang.toFixed(4) + 'rad)';
      const r = rectOf(tb.el);
      if (r) {
        tb.grip.style.left = px(r.left); tb.grip.style.top = px(r.top);
        tb.grip.style.width = px(r.width); tb.grip.style.height = px(r.height);
      }
    } catch (e) { /* ignore */ }
  }
  /* One hold tick. The first one takes hold of something; every one after it is the beam staying on, which
   * is why it costs nothing and does no damage — the carrying is tbStep()'s job on the integrator's frame. */
  function tbTick(x, y) {
    if (!tbHeld()) return tbGrab(x, y);
    tbDraw();
    return tb.el;
  }
  function tbClearNodes() {
    for (const k of ['beam', 'grip']) {
      const n = tb[k];
      tb[k] = null;
      if (n) { try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } }
    }
  }

  /* ── §C 충격포 / §D 나팔 — the two area pushes, as plain functions the fire() entries call ───────────── */
  function ixShockwaveAt(x, y) {
    const W = WEAPONS.shockwave;
    interceptOrbsWithin(x, y, W.radius);
    sfx('shockwave');
    flash(x, y, 'bomb', { size: W.radius, dur: 110 });
    ring(x, y, { r: W.radius });
    shake('bomb', { amp: 8, dur: 300 });
    blastMark(x, y, W.radius, 0.35, { ink: 0.35, weapon: W });
    const pushed = ixPushRadial(x, y, W.radius, W.impulse, {});
    /* §C: "직접 피해 10뿐 — 피해는 부딪혀서 나온다." The 10 is flat, with no falloff: there is nothing left
     * to taper. Every point of real damage this weapon deals comes from movedCollide() in src/67. */
    let hurt = 0;
    for (const el of pushed) {
      if (!el.isConnected) continue;
      const crit = rollCrit('shockwave');
      if (applyHit(el, rollDamage(W.damage, crit), 'bomb', x, y, { crit, aoe: true, weapon: W.id, radius: W.radius, toward: { x, y } }) !== 'none') hurt++;
    }
    kick();
    return { pushed: pushed.length, hurt };
  }
  function ixHornAt(x, y, scale) {
    const W = WEAPONS.horn;
    const o = ixOrigin();
    let ang = Math.atan2(y - o.y, x - o.x);
    if (!isFinite(ang)) ang = -Math.PI / 2;
    const R = W.radius * (scale > 0 ? scale : 1);
    sfx('horn');
    ixConeFx(x, y, ang, R, W.coneDeg);
    shake('gun', { amp: 3.4 });
    const pushed = ixPushCone(x, y, ang, R, W.coneDeg, W.coneImpulse * (scale > 0 ? scale : 1));
    const flipped = ixFlipOrbs(x, y, ang, R, W.coneDeg);
    let hurt = 0;
    for (const el of pushed) {
      if (!el.isConnected) continue;
      const crit = rollCrit('horn');
      if (applyHit(el, rollDamage(W.damage, crit), 'gun', x, y, { crit, aoe: true, weapon: W.id, toward: { x, y } }) !== 'none') hurt++;
    }
    kick();
    return { pushed: pushed.length, flipped, hurt, angle: ang, radius: R, coneDeg: W.coneDeg };
  }

  /* ===================================================================== */
  /* wiring — every one of these is a WRAP, never a fork                     */
  /* ===================================================================== */
  /* A body created AFTER the element was already wet / bouncy must still carry the flag: movedBody() mints a
   * fresh record with both off, and §E is not this workstream's file. displaceEl() is §E's one entry point,
   * so one wrapper covers every caller there will ever be. */
  const ixDisplaceBase = displaceEl;
  displaceEl = function (el, ix, iy, opts) {
    const b = ixDisplaceBase(el, ix, iy, opts);
    if (b) {
      if (ixIsWet(el)) b.wet = true;
      if (ixIsBouncy(el)) b.bouncy = true;
    }
    return b;
  };
  /* The tractor's spring is solved on the integrator's own frame, immediately before it runs. */
  const ixStepMovedBase = stepMoved;
  stepMoved = function (t, dt) {
    if (tbHeld()) tbStep(t, dt);
    return ixStepMovedBase(t, dt);
  };
  /* §C 견인 광선: "잡힌 적은 공격을 멈춘다." The gate goes where every other attack gate already lives — the
   * attack is RESCHEDULED rather than dropped, so the enemy picks straight back up when it is let go. */
  const ixHostileAttackBase = hostileAttack;
  hostileAttack = function (rec, forced) {
    if (rec && rec.el && tb.el === rec.el && tbHeld()) {
      try { scheduleAttack(rec, attackInterval(rec)); } catch (e) { /* ignore */ }
      return false;
    }
    return ixHostileAttackBase(rec, forced);
  };
  /* 연소 and 젖음 both borrow the element's inline `filter`. The fire is about to save whatever it finds, so
   * the wet look has to be off the element BEFORE that — otherwise burnUntint() would one day "restore" a
   * wet filter onto a dry element, which is a trace. */
  const ixIgniteBase = igniteEl;
  igniteEl = function (el, stacks) {
    const rec = el && ixWetEls.get(el);
    if (rec && rec.owns) ixWetUnpaint(el, rec);
    return ixIgniteBase(el, stacks);
  };
  /* A hold that ends — pointer up, weapon swap, KO, restore — lets go of whatever the beam was carrying. */
  const ixStopHoldBase = stopHold;
  stopHold = function (silent) {
    const h = state.hold;
    const wasTractor = !!(h && h.id === 'tractor');
    const r = ixStopHoldBase(silent);
    if (wasTractor) tbRelease(!!silent);
    return r;
  };
  /* restore() (Z / Escape / deactivate) must leave NOTHING of ours: no node, no timer, no borrowed filter,
   * no state flag. It runs BEFORE the base so the base's own node sweep and clearMoved() see an already
   * quiet module — and the wet filter is put back while the element is still the element we saved it from. */
  const ixRestoreBase = restore;
  restore = function () { ixResetAll(); return ixRestoreBase(); };
  function ixClearStates() {
    for (const el of Array.from(ixWetEls.keys())) ixUnwet(el);
    ixWetEls.clear();
    for (const el of Array.from(ixBouncyEls.keys())) ixUnbounce(el);
    ixBouncyEls.clear();
    untrack(ixTimer); ixTimer = 0;
  }
  function ixResetAll() {
    tbRelease(true);
    tbClearNodes();
    tb.grabs = 0; tb.refusals = 0; tb.lastRefusal = ''; tb.peak = 0;
    ixClearStates();
    if (root) {
      let leftovers = [];
      try { leftovers = root.querySelectorAll('.crs-star, .crs-splash, .crs-horn-cone, .crs-tractor-beam, .crs-tractor-grip'); } catch (e) { leftovers = []; }
      for (const n of leftovers) { try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } }
    }
  }

  /* ---- debug surface (the suite is written against these) ------------------------------------------ */
  Object.assign(debug, { forceQuirk: false, noQuirk: false });
  debug.wetOf = (el) => {
    const rec = el && ixWetEls.get(el);
    if (!rec) return null;
    let filter = '';
    try { filter = el.style.getPropertyValue('filter') || ''; } catch (e) { filter = ''; }
    return { msLeft: Math.max(0, Math.round(rec.until - now())), owns: !!rec.owns, filter, coolMul: ixCoolMul(el), saved: rec.filterSaved };
  };
  debug.bouncyOf = (el) => {
    const until = el && ixBouncyEls.get(el);
    if (!until) return null;
    const b = state.moved.get(el);
    return { msLeft: Math.max(0, Math.round(until - now())), flag: !!(b && b.bouncy) };
  };
  debug.wet = (el, ms) => { const r = ixWet(el, ms); return r ? Math.round(r.until - now()) : null; };
  debug.unwet = (el) => ixUnwet(el);
  debug.bouncy = (el, ms) => !!ixMakeBouncy(el, ms);
  debug.freeze = (el, n) => ixFreeze(el, n == null ? 10 : +n);
  debug.coolMul = (el) => ixCoolMul(el);
  debug.shockwave = (x, y) => ixShockwaveAt(+x, +y);
  debug.horn = (x, y) => ixHornAt(+x, +y, 1);
  debug.tractor = () => ({
    held: tbHeld(), id: (tb.el && tb.el.id) || '', tag: tagOf(tb.el),
    grabs: tb.grabs, refusals: tb.refusals, lastRefusal: tb.lastRefusal,
    mass: tb.body ? +tb.body.mass.toFixed(3) : 0, peak: Math.round(tb.peak), maxMass: WEAPONS.tractor.grabMaxMass,
    beam: !!(tb.beam && tb.beam.isConnected), grip: !!(tb.grip && tb.grip.isConnected),
    v: tb.body ? { vx: Math.round(tb.body.vx), vy: Math.round(tb.body.vy) } : null
  });
  debug.tractorGrab = (x, y) => !!tbGrab(+x, +y);
  debug.tractorRelease = () => tbRelease(false);
  debug.interaction = () => ({
    wet: ixWetEls.size, bouncy: ixBouncyEls.size, timer: !!ixTimer,
    stars: root ? root.querySelectorAll('.crs-star').length : 0,
    splash: root ? root.querySelectorAll('.crs-splash').length : 0,
    cones: root ? root.querySelectorAll('.crs-horn-cone').length : 0,
    beams: root ? root.querySelectorAll('.crs-tractor-beam, .crs-tractor-grip').length : 0
  });
  debug.ixConst = () => ({
    wetFilter: IX_WET_FILTER, coolMul: IX_WET_COOL_MUL, tickMs: IX_TICK_MS, maxSpeed: IX_MAX_SPEED,
    shockR: WEAPONS.shockwave.radius, shockImpulse: WEAPONS.shockwave.impulse, shockDamage: WEAPONS.shockwave.damage,
    grabMaxMass: WEAPONS.tractor.grabMaxMass, bouncyMs: WEAPONS.rubber.bouncyMs, bounceRest: WEAPONS.rubber.bounceRest,
    collisionMul: WEAPONS.rubber.collisionMul, wetMs: WEAPONS.watergun.wetMs, coneDeg: WEAPONS.horn.coneDeg,
    coneR: WEAPONS.horn.radius, bouncyChance: WEAPONS.chicken.bouncyChance
  });
  /* §D's band rule ("실효 화력이 중앙값의 25~50%") is arithmetic over numbers the weapon table already
   * publishes, and §F — where the formula itself lives — is 9단계. So the product hands over the INPUTS and
   * nothing else: the quirk field, and the seven numbers §F3's `effective` is made of. The arithmetic and
   * the category grouping are the suite's. */
  debug.weaponBand = () => WEAPON_IDS.map((id) => {
    const W = WEAPONS[id];
    return {
      id, quirk: W.quirk || null, damage: W.damage, cooldownMs: W.cooldownMs || 0, tickMs: W.tickMs || 0,
      hold: !!W.hold, mag: W.mag == null ? null : W.mag, reloadMs: W.reloadMs == null ? null : W.reloadMs,
      swapMs: W.swapMs || SWAP_MS, moveSpeed: W.moveSpeed == null ? 1 : W.moveSpeed, bloom: W.bloom || 0,
      radius: isFinite(W.radius) ? W.radius : null, maxTargets: W.maxTargets || 1
    };
  });
  /* 젖음 / bouncy / 견인 are all things that move every frame, and sampling them over CDP measures the
   * protocol rather than the product (25–40 ms a round trip). One hop, real animation frames, inside the
   * page — exactly the shape debug.altSamples() already established. */
  debug.ixSamples = (ms, sel) => new Promise((resolve) => {
    const out = [], t0 = now(), want = clamp(+ms || 400, 50, 6000);
    let el = null;
    try { el = sel ? doc.querySelector(sel) : null; } catch (e) { el = null; }
    const step = () => {
      const b = el ? state.moved.get(el) : null;
      const r = el ? rectOf(el) : null;
      out.push({
        t: Math.round(now() - t0),
        x: b ? +b.x.toFixed(2) : null, y: b ? +b.y.toFixed(2) : null,
        vx: b ? Math.round(b.vx) : null, vy: b ? Math.round(b.vy) : null,
        resting: b ? !!b.resting : null, wet: b ? !!b.wet : null, bouncy: b ? !!b.bouncy : null,
        top: r ? +r.top.toFixed(1) : null, left: r ? +r.left.toFixed(1) : null,
        held: tbHeld(), heldSame: !!(el && tb.el === el), bodies: state.movedList.length
      });
      if (now() - t0 >= want) { resolve(out); return; }
      raf(step);
    };
    raf(step);
  });
