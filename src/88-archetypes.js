// ── SPEC-combat §D2–§D5: 세 축 분리 · 아키타입 10종 · 투사체 4종 · 돌격과 연발 ──
  /* §D2 names three axes and this module owns the first of them:
   *
   *   요소 종류 → 무슨 공격을 하는가   ← archetypeOf() below, and nothing else decides it
   *   깊이      → 공격 빈도 / 역할      ← src/87-depth.js (DEPTH_ATTACK / DEPTH_REPAIR), untouched
   *   크기      → 피해량 · 체력 · 투사체 개수 ← the √area damage formulas and DEPTH_HP, untouched
   *
   * Before this stage the ATTACK came from the size tier (T1 orb / T2 slam / T3 lock), which is exactly the
   * confusion §D2 pulls apart: "앞쪽의 큰 이미지"와 "뒤쪽의 작은 버튼"이 같은 적이었다. From here the tier
   * still sets the attack INTERVAL (TIER_BASE) and the damage numbers; what is fired comes from the tag.
   *
   * ── READINGS CHOSEN WHERE THE SPEC IS SILENT (CLAUDE.md: write them down) ───────────────────────────
   *  1. 범용형 ("그 외", 기본값) alternates its DEFAULT attack with 돌격, and that default is the size tier
   *     ladder this build already had (T1 직사탄 / T2 슬램 / T3 락온). The table gives 범용형 no glyph and
   *     calls it 기본값; reading its "직사탄" as *always a plain orb* would retire the slam outright, and the
   *     brief is explicit that 레이저 쓸기 · 락온 · 슬램 all stay where the table puts them. Every NAMED
   *     archetype overrides the tier completely — only the nameless fallback keeps it.
   *  2. §D5's `mass > 4` makes 돌격 unreachable for anything over ~72 × 72 px, and §B3's hostile floor is
   *     20 000 px². So a lunging enemy can only exist if an element qualifies as an enemy for being a BUTTON
   *     rather than for being big — which is §D2's own claim. archMinArea() therefore lowers the floor for
   *     every element the table NAMES (a button, a link, a paragraph, a table), and leaves 범용형 on §B3's
   *     floor, because "그 외" has no identity of its own to qualify on. The §B3 SELECTION ladder is
   *     untouched above its last rung (see selectOne() in src/90-combat.js).
   *  3. 지원형's 보호막 has no numbers in the spec: 3 s, incoming damage ×0.5, cast on the nearest other live
   *     enemy (on itself when it is alone). 복구 is the repair it already does (src/94-repair.js, §3).
   *  4. 돌격 피해 uses the slam's size formula (18 + √area/50) — it is a body slam, the spec gives it no
   *     number of its own, and §D2 says 크기가 피해량을 정한다.
   *  5. 포물선탄 draws the 바닥 표식 §D4 asks for INSTEAD of the arrival ring; the ring is the cue for the
   *     projectiles that have no landing mark.
   *  6. Per-ROUND damage where the spec gives a share but no base: 산탄 1/3 and 연발 1/2 are the spec's own
   *     numbers, applied to orbBaseDamage() (the §D2 size axis, unchanged). 속사 has no share printed, so a
   *     round is 0.6 × base — three of them come to 1.8 × one 직사탄, which is what "빠르고 딸깍거린다"
   *     should be worth against a single heavy shot. 포물선 and 유도 fire one round at the full base.
   *  7. A charging element takes no §E3 collision damage from its own charge — see lungeImmune() below for
   *     why that has to be said. */

  /* ---- §D3 the table, checked IN THE ORDER THE SPEC PRINTS IT -------------------------------------- */
  const ARCH_ALIEN_TAGS = new Set(['iframe', 'embed', 'object']);
  const ARCH_BOMBARD_TAGS = new Set(['img', 'picture', 'video', 'canvas', 'svg']);
  const ARCH_VOLLEY_TAGS = new Set(['table', 'ul', 'ol', 'dl']);
  const ARCH_RAPID_TAGS = new Set(['button', 'input', 'select', 'textarea', 'summary']);
  const ARCH_TRACK_TAGS = new Set(['form', 'fieldset']);
  const ARCH_AIM_TAGS = new Set(['nav', 'header']);
  /* "텍스트 지배(`p`,`h1`~`h6`,`li`,`td`…)" — the spec's own list plus the rest of the block-level text
   * leaves. Deliberately TAG-based, and NOT this build's textDominant() (src/70-break.js): that predicate
   * answers "can this be shattered word by word?" and says yes to any `div` holding a line of text, which
   * would turn every card and panel on a page into a 산탄형 and leave 범용형 ("그 외") with almost nothing.
   * The spec prints a list of TAGS here, so a card stays a card and a paragraph is the text enemy. */
  const ARCH_TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'dt', 'dd',
    'blockquote', 'figcaption', 'caption', 'pre', 'label', 'address']);
  const ARCH_SUPPORT_TAGS = new Set(['footer', 'aside']);
  /* 라벨 글리프 (§D3). 범용형 has none in the table, so it contributes nothing to the label. */
  const ARCH_GLYPH = {
    alien: '◈', bombard: '◉', volley: '▤', rapid: '⁘', lunger: '➤',
    tracker: '◎', aimer: '🎯', scatter: '⁂', support: '✚', generic: ''
  };
  const ARCH_IDS = ['alien', 'bombard', 'volley', 'rapid', 'lunger', 'tracker', 'aimer', 'scatter', 'support', 'generic'];
  // reading 2 above: an element the table NAMES is an enemy for what it IS, not for how big it is
  const ARCH_MIN_AREA = 1200;

  function archetypeOf(el) {
    if (!el || el.nodeType !== 1) return 'generic';
    const tag = tagOf(el);
    if (ARCH_ALIEN_TAGS.has(tag)) return 'alien';
    if (ARCH_BOMBARD_TAGS.has(tag)) return 'bombard';
    if (ARCH_VOLLEY_TAGS.has(tag)) return 'volley';
    if (ARCH_RAPID_TAGS.has(tag)) return 'rapid';
    try { if ((el.getAttribute('role') || '').toLowerCase() === 'button') return 'rapid'; } catch (e) { /* ignore */ }
    if (tag === 'a') return 'lunger';
    if (ARCH_TRACK_TAGS.has(tag)) return 'tracker';
    if (ARCH_AIM_TAGS.has(tag)) return 'aimer';
    /* "sticky 요소" — and `fixed` with it: both are the thing that stays on top of the page while everything
     * else scrolls under it, which is the row's reason ("늘 위에서 내려다본다"). depthOf() already treats the
     * two as one case (src/87-depth.js). */
    const s = gcs(el);
    if (s && (s.position === 'sticky' || s.position === 'fixed')) return 'aimer';
    if (ARCH_TEXT_TAGS.has(tag)) return 'scatter';
    if (ARCH_SUPPORT_TAGS.has(tag)) return 'support';
    return 'generic';
  }
  function archGlyph(a) { const g = ARCH_GLYPH[a]; return g == null ? '' : g; }
  /* What src/87-depth.js's setHostileLabel() appends: `👿 IMG ◉ ▲▲` — 종류 · 공격 · 깊이 on one line. */
  function archGlyphMark(rec) {
    const g = archGlyph(rec && rec.arch);
    return g ? ' ' + g : '';
  }
  function archMinArea(el) {
    return archetypeOf(el) === 'generic' ? HOSTILE_AREA : ARCH_MIN_AREA;
  }

  /* ---- §D4 투사체 4종 ------------------------------------------------------------------------------ */
  const PROJ_CAP = 18, PROJ_CAP_PERF = 10;          // 동시 상한 18개 (성능 모드 10)
  const SEEK_TURN_MS = 800;                         // 유도탄: 0.8초만 선회한다
  const SEEK_TURN_DEG = 90;                         // 최대 90°/s
  const SEEK_HIT_MUL = 1.3;                         // 요격 판정 1.3배
  const SCATTER_N = 5, SCATTER_FAN = 25, SCATTER_DMG = 1 / 3;   // 5발, 25도 부채꼴, 발당 1/3
  const MORTAR_MS = 1100, MORTAR_R = 90;            // 1.1초 비행, 반경 90px
  const RAPID_N = 3, RAPID_GAP = 150, RAPID_SPEED = 700;        // 빠른 직선 3연사 (§F: 0.15초 간격 700 px/s)
  const VOLLEY_MAX = 8, VOLLEY_GAP = 120, VOLLEY_DMG = 0.5;     // 최대 8발, 0.12초 간격, 발당 1/2
  const ORB_INTERCEPT_R = 18;                       // the radius interceptOrb() has always used
  const ORB_HIT_ALPHA = 1, ORB_MISS_ALPHA = 0.55;   // §D4: 밝기 1.0 대 0.55
  const ORB_HIT_PX = 22, ORB_MISS_PX = 18;          // §D4: 22px 대 18px (applied as a scale, so every shape obeys)
  const ORB_RING_FROM = 0.6;                        // 도착 예상 링은 비행의 마지막 40% 구간에만

  const SUCK_SPEED = 1500, SUCK_EAT_R = 26;          // §D4: 중력탄은 빨아들인다
  function projCap() { return perfOn() ? PROJ_CAP_PERF : PROJ_CAP; }
  /* §D4 "전부 요격 가능하다" — one radius per kind, read by every interceptor in src/90-combat.js. */
  function orbInterceptR(o) { return ORB_INTERCEPT_R * (o && o.kind === 'seeker' ? SEEK_HIT_MUL : 1); }
  function orbSpeedOf(o) { return ((o && o.baseSpeed) || ORB_SPEED) * modeProjectileMul(); }
  function orbBaseDamage(rec) { return 8 + Math.round(Math.sqrt(rec.area || 40000) / 60); }
  function slamDamage(rec) { return 18 + Math.round(Math.sqrt(rec.area || 40000) / 50); }

  /* ---- §D4 공통: "폭발 무기의 범위 안에 든 투사체는 소멸한다. 중력탄은 빨아들인다." ----
   * The blast half is interceptOrbsWithin() (src/90-combat.js), which bomb and rocket already call. The
   * gravity half is this: 붕괴 does not pop a projectile where it flies — it drags every one of them to the
   * singularity and swallows it there, which is the whole reading of "빨아들인다". doCollapse()
   * (src/76-weapon-fire.js) is the single call site; orbStep() runs the drag on the frame loop that is
   * already carrying the projectile, so nothing new is scheduled. */
  function pullOrbsIn(x, y) {
    let n = 0;
    for (const o of state.orbs) { o.sucked = { x, y }; n++; }
    if (n) kick();
    return n;
  }
  /* One frame of the drag. True once the projectile has reached the singularity and should be swallowed. */
  function stepSucked(o, dt) {
    const dx = o.sucked.x - o.x, dy = o.sucked.y - o.y, L = Math.hypot(dx, dy);
    if (L <= SUCK_EAT_R) return true;
    const sp = Math.min(SUCK_SPEED, L / Math.max(dt, 1 / 120));
    o.vx = dx / (L || 1) * sp; o.vy = dy / (L || 1) * sp;
    o.x += o.vx * dt; o.y += o.vy * dt;
    return false;
  }

  /* ---- §D4 유도탄: 0.8초만 최대 90°/s 로 선회한 뒤 그 방향으로 직진 ---- */
  function steerSeeker(o, t, dt) {
    if (t - o.launchAt > scaleMs(SEEK_TURN_MS)) return;
    const p = state.player;
    if (!p.alive) return;
    const want = Math.atan2(p.y - o.y, p.x - o.x);
    let cur = Math.atan2(o.vy, o.vx);
    let d = want - cur;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const max = SEEK_TURN_DEG * DEG * dt;
    cur += clamp(d, -max, max);
    const sp = Math.hypot(o.vx, o.vy) || orbSpeedOf(o);
    o.vx = Math.cos(cur) * sp; o.vy = Math.sin(cur) * sp;
  }

  /* ---- §D4 포물선탄: 착탄 예정 지점에 바닥 표식이 미리 보이고, 반경 90px 범위 피해 ---- */
  function mortarMark(o) {
    if (!root) return;
    const n = mk('div', 'crs-mortar-mark');
    n.style.left = px(o.tx - MORTAR_R); n.style.top = px(o.ty - MORTAR_R);
    n.style.width = px(2 * MORTAR_R); n.style.height = px(2 * MORTAR_R);
    root.append(n);
    o.mark = n;
    if (reducedMotion()) return;
    try { trackAnim(n.animate([{ opacity: 0.45 }, { opacity: 0.95 }], { duration: 260, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' })); } catch (e) { /* ignore */ }
  }
  function mortarAt(o, t) {
    const k = clamp((t - o.launchAt) / Math.max(1, o.flightMs), 0, 1);
    const x = o.sx + (o.tx - o.sx) * k;
    const y = o.sy + (o.ty - o.sy) * k - o.arc * 4 * k * (1 - k);
    return { x, y, k };
  }
  /* The impact. Returns true when the player was inside the blast, so orbStep() can stop iterating if the
   * hit KO'd them (showKo() empties state.orbs under us). */
  function mortarLand(o) {
    const p = state.player;
    flash(o.tx, o.ty, 'bomb', { size: 2 * MORTAR_R, dur: 220 });
    shake('bomb', { amp: 7, dur: 240 });
    sfx('rumble', { gain: 0.6 });
    if (!p.alive || state.ko) return false;
    if (Math.hypot(p.x - o.tx, p.y - o.ty) > MORTAR_R) return false;
    damagePlayer(o.dmg, { from: { x: o.tx, y: o.ty } });
    return true;
  }

  /* ---- §D5 돌격 (lunge) — 변위 시스템(§E)을 쓴다. 적대 요소 자신이 날아온다 ---- */
  const LUNGE_WINDUP = 400;      // 0.4초 예비: 목표 반대 방향으로 40px 당겨지며 붉게 밝아진다
  const LUNGE_PULL = 40;         // px
  const LUNGE_SPEED = 900;       // px/s 돌진
  const LUNGE_HOLD = 500;        // 0.5초 뒤 제자리로 복귀
  const LUNGE_RETURN = 350;      // 0.35초 이징
  const LUNGE_STEP = 25;         // ms between hit / shove probes while the body is in flight
  const LUNGE_MAX_MASS = 4;      // 질량이 큰 요소는 돌격 대신 직사탄 (섹션이 날아오면 피할 수 없다)
  const LUNGE_SHOVE_MAX = 3;     // 경로 위의 다른 요소를 밀친다 — at most this many per lunge
  const LUNGE_SHOVE_IMPULSE = 520;
  const lunges = [];

  /* The impulse that travels `px` under §E2's friction in `ms`: ∫v₀·f^t dt = v₀·(f^T − 1)/ln f.
   * Written out rather than guessed, so "40px 당겨진다" is the distance the element actually covers. */
  function impulseForDistance(px0, ms, mass) {
    const T = ms / 1000, f = MOVED_FRICTION;
    const travel = (Math.pow(f, T) - 1) / Math.log(f);
    return (px0 / Math.max(1e-6, travel)) * mass;
  }
  function lungeMassOf(el) {
    const r = rectOf(el);
    return movedMass(r);
  }
  function dropLunge(lg, snapHome) {
    const i = lunges.indexOf(lg);
    if (i >= 0) lunges.splice(i, 1);
    untrack(lg.timer); lg.timer = 0;
    if (lg.rec && lg.rec.lunge === lg) lg.rec.lunge = null;
    try { if (lg.rec && lg.rec.aura) lg.rec.aura.classList.remove('crs-lunging'); } catch (e) { /* ignore */ }
    if (snapHome) undisplace(lg.el);
  }
  function clearLunges() { for (const lg of lunges.slice()) dropLunge(lg, true); }
  /* §D5 reading (the spec does not say it, and the first run proved it has to be said): a charging element is
   * the thing DOING the pushing — "경로 위의 다른 요소를 밀친다" — so it does not take §E3's own collision
   * damage from its charge. Without this a 900 px/s impact bills clamp(round(900/14),1,60) = 60 against the
   * charger, which kills a link on the first box it meets and the 0.5 s charge never completes once. What it
   * runs INTO is billed as usual (and still goes through §B's hostiles-only gate), so the charge is still a
   * way to make enemies collide — it just does not suicide. collisionHit() (src/73-hit-resolution.js) is the
   * single place §E3 damage is minted, which is why the exemption lives at that one call. */
  function lungeImmune(el) {
    if (!el || !lunges.length) return false;
    for (const lg of lunges) if (lg.el === el) return true;
    return false;
  }
  /* §D5 "이때 쏘면 취소된다". Like §A2's lock-break (src/93-lock.js), the cancel watches the enemy's HP rather
   * than hooking the damage sink, so EVERY weapon — hitscan, hold tick, AoE, slash, collapse — cancels a
   * charge identically with no special case in the weapon code. clearPhase() is the other caller. */
  function cancelLunge(rec) {
    const lg = rec && rec.lunge;
    if (!lg) return false;
    dropLunge(lg, true);
    if (rec.phase === 'telegraph' || rec.phase === 'lunge') rec.phase = 'idle';
    return true;
  }
  function lungeWasShot(lg) {
    try { return hpOf(lg.el).hp < lg.hp0; } catch (e) { return false; }
  }
  function lungeWindup(lg) {
    lg.timer = 0;
    const rec = lg.rec;
    if (!state.active || !state.combat || state.paused || state.ko || !rec || state.hostiles.get(rec.el) !== rec) { dropLunge(lg, true); return; }
    if (lungeWasShot(lg)) {   // 예비 중에 쏘면 취소된다 — and the next attack is scheduled as a normal miss
      cancelLunge(rec);
      sfx('whiff');
      if (state.hostiles.get(rec.el) === rec) scheduleAttack(rec, attackInterval(rec));
      return;
    }
    if (now() >= lg.dashAt) { lungeDash(lg); return; }
    lg.timer = later(() => lungeWindup(lg), LUNGE_STEP);
  }
  /* §D5 "경로 위의 다른 요소를 밀친다": the leading edge of the flying element shoves whatever it meets, and
   * that shove goes through §E's one entry point so the pushed element is an ordinary displaced body (and its
   * collision damage still runs the §B hostiles-only gate). */
  function lungeShove(lg, r) {
    if (lg.shoved >= LUNGE_SHOVE_MAX) return;
    const ex = r.left + r.width / 2 + lg.ux * (r.width / 2 + 8);
    const ey = r.top + r.height / 2 + lg.uy * (r.height / 2 + 8);
    if (ex < 0 || ey < 0 || ex > viewW() || ey > viewH()) return;
    let list = [];
    try { list = doc.elementsFromPoint(ex, ey); } catch (e) { return; }
    for (const c of list) {
      if (!c || c.nodeType !== 1 || isOurs(c) || c === lg.el) continue;
      try { if (c.contains(lg.el) || lg.el.contains(c)) continue; } catch (e) { continue; }
      if (lg.hitEls.has(c)) continue;
      const b = displaceEl(c, lg.ux * LUNGE_SHOVE_IMPULSE, lg.uy * LUNGE_SHOVE_IMPULSE, { spin: lg.ux * 60 });
      if (!b) continue;
      lg.hitEls.add(c);
      lg.shoved++;
      return;
    }
  }
  function lungeTick(lg) {
    lg.timer = 0;
    if (!state.active || !state.combat || state.paused || state.ko) { dropLunge(lg, true); return; }
    const rec = lg.rec;
    if (!rec || state.hostiles.get(rec.el) !== rec) { dropLunge(lg, true); return; }
    const r = rectOf(lg.el);
    if (!r) { dropLunge(lg, true); return; }
    const p = state.player;
    // 명중 판정은 1회만 — and only while the body is dashing, never on the way home
    if (!lg.hit && p.alive && !state.ko && now() >= state.invulUntil) {
      const qx = clamp(p.x, r.left, r.right), qy = clamp(p.y, r.top, r.bottom);
      if (Math.hypot(p.x - qx, p.y - qy) <= AV_HIT_R) {
        lg.hit = true;
        damagePlayer(lg.dmg, { from: { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
      }
    }
    lungeShove(lg, r);
    if (now() >= lg.endAt) { lungeReturn(lg); return; }
    lg.timer = later(() => lungeTick(lg), LUNGE_STEP);
  }
  function lungeReturn(lg) {
    untrack(lg.timer); lg.timer = 0;
    const b = state.moved.get(lg.el);
    if (b) { b.retMs = LUNGE_RETURN; startMovedReturn(b); }   // §D5: 0.35초 이징 (§E1's glide, retimed)
    if (lg.rec && lg.rec.phase === 'lunge') lg.rec.phase = 'idle';
    try { if (lg.rec && lg.rec.aura) lg.rec.aura.classList.remove('crs-lunging'); } catch (e) { /* ignore */ }
    const rec = lg.rec;
    lg.timer = later(() => {
      lg.timer = 0;
      dropLunge(lg, true);
      if (rec && state.hostiles.get(rec.el) === rec) scheduleAttack(rec, attackInterval(rec));
    }, LUNGE_RETURN + 40);
  }
  function lungeDash(lg) {
    lg.timer = 0;
    const rec = lg.rec;
    if (!state.active || !state.combat || state.paused || state.ko || !rec || state.hostiles.get(rec.el) !== rec) { dropLunge(lg, true); return; }
    const r = rectOf(lg.el);
    if (!r) { dropLunge(lg, true); return; }
    const p = state.player;
    const dx = p.x - (r.left + r.width / 2), dy = p.y - (r.top + r.height / 2), L = Math.hypot(dx, dy) || 1;
    lg.ux = dx / L; lg.uy = dy / L;
    const b = state.moved.get(lg.el);
    const mass = b ? b.mass : lungeMassOf(lg.el);
    const vx0 = b ? b.vx : 0, vy0 = b ? b.vy : 0;
    // §E1's entry point, asked for exactly LUNGE_SPEED along the heading: impulse = (want − have) · mass
    displaceEl(lg.el, (lg.ux * LUNGE_SPEED - vx0) * mass, (lg.uy * LUNGE_SPEED - vy0) * mass);
    rec.phase = 'lunge';
    lg.endAt = now() + scaleMs(LUNGE_HOLD);
    sfx('whoosh');
    kick();
    lg.timer = later(() => lungeTick(lg), LUNGE_STEP);
  }
  /* §D5 돌격. Returns 'lunge', or null when the element cannot be displaced at all (the caller then shoots). */
  function startLunge(rec) {
    const el = rec.el;
    const r = rectOf(el);
    if (!r) return null;
    const p = state.player;
    const dx = p.x - (r.left + r.width / 2), dy = p.y - (r.top + r.height / 2), L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const mass = lungeMassOf(el);
    // 0.4초 예비: 목표 반대 방향으로 40px 당겨진다. 이때 쏘면 취소된다 (clearPhase → dropLunge).
    const pull = impulseForDistance(LUNGE_PULL, LUNGE_WINDUP, mass);
    const b = displaceEl(el, -ux * pull, -uy * pull);
    if (!b) return null;
    let hp0 = Infinity;
    try { hp0 = hpOf(el).hp; } catch (e) { hp0 = Infinity; }
    const lg = { rec, el, ux, uy, hit: false, shoved: 0, hitEls: new WeakSet(), timer: 0, endAt: 0,
      dmg: slamDamage(rec), bornAt: now(), hp0, dashAt: now() + scaleMs(LUNGE_WINDUP) };
    rec.lunge = lg;
    rec.phase = 'telegraph';   // A10's clutch bonus and clearPhase() both read this
    lunges.push(lg);
    addAimLine(rec);
    setAuraPulse(rec, 150);
    try { rec.aura.classList.add('crs-lunging'); } catch (e) { /* ignore */ }   // 붉게 밝아진다
    sfx('thump', { gain: 0.4 });
    lg.timer = later(() => lungeWindup(lg), LUNGE_STEP);
    kick();
    return 'lunge';
  }

  /* ---- §D5 연발 (volley) — 자기 행을 한 줄씩 쏜다 ---- */
  function volleyRows(el) {
    const tag = tagOf(el);
    let rows = [];
    try {
      if (tag === 'table') rows = Array.from(el.querySelectorAll('tr'));
      else if (tag === 'ul' || tag === 'ol') rows = Array.from(el.querySelectorAll(':scope > li'));
      else if (tag === 'dl') rows = Array.from(el.querySelectorAll(':scope > dt, :scope > dd'));
      else rows = Array.from(el.children);
    } catch (e) { rows = []; }
    const out = [];
    for (const n of rows) {
      const r = rectOf(n);
      if (r && r.width >= 1 && r.height >= 1) out.push(n);
    }
    return out;
  }
  /* 요격하면 그 행이 깜빡인다 — our own overlay over the row, never a style on the page element. */
  function flashRow(row) {
    if (!root || !row) return;
    const r = rectOf(row);
    if (!r || r.width < 1) return;
    const n = mk('div', 'crs-row-flash');
    n.style.left = px(r.left); n.style.top = px(r.top); n.style.width = px(r.width); n.style.height = px(r.height);
    root.append(n);
    archNodes.push(n);
    const kill = () => { const i = archNodes.indexOf(n); if (i >= 0) archNodes.splice(i, 1); try { n.remove(); } catch (e) { /* ignore */ } };
    try {
      const a = trackAnim(n.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 260, easing: 'ease-out', fill: 'forwards' }));
      a.addEventListener('finish', kill);
    } catch (e) { /* ignore */ }
    later(kill, 500);
  }

  /* ---- §D3 지원형: 공격 안 함. 복구 + 보호막 ---- */
  const GUARD_MS = 3000, GUARD_MUL = 0.5;
  const guards = [];
  function guardOf(el) {
    for (const g of guards) if (g.el === el) return g;
    return null;
  }
  function dropGuard(g) {
    const i = guards.indexOf(g);
    if (i >= 0) guards.splice(i, 1);
    untrack(g.timer); g.timer = 0;
    try { cancelAnimsOf(g.node); g.node.remove(); } catch (e) { /* ignore */ }
  }
  function clearGuards() { for (const g of guards.slice()) dropGuard(g); }
  /* Called from applyHit() (src/73-hit-resolution.js) — the ONE damage sink, so every weapon obeys the shield
   * with no special case anywhere in the weapon code. A plain pass-through when nothing is shielded. */
  function guardedDamage(el, dmg) {
    if (!guards.length || !(dmg > 0)) return dmg;
    for (const g of guards) {
      if (g.el === el) return Math.max(1, Math.round(dmg * GUARD_MUL));
      try { if (g.el.contains(el)) return Math.max(1, Math.round(dmg * GUARD_MUL)); } catch (e) { /* ignore */ }
    }
    return dmg;
  }
  function placeGuards() {
    for (const g of guards.slice()) {
      const r = rectOf(g.el);
      if (!r || !g.el.isConnected) { dropGuard(g); continue; }
      const s = g.node.style;
      s.left = px(r.left - 6); s.top = px(r.top - 6); s.width = px(r.width + 12); s.height = px(r.height + 12);
    }
  }
  function castGuard(rec) {
    if (!root) return null;
    // the nearest OTHER live enemy; alone, it shields itself — a support with nobody to support still supports
    const r0 = rectOf(rec.el);
    let target = rec.el, best = Infinity;
    if (r0) {
      const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
      for (const other of state.hostiles.values()) {
        if (other === rec) continue;
        const r = rectOf(other.el);
        if (!r) continue;
        const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
        if (d < best) { best = d; target = other.el; }
      }
    }
    const existing = guardOf(target);
    if (existing) dropGuard(existing);
    const node = mk('div', 'crs-guard');
    root.append(node);
    const g = { el: target, node, timer: 0, bornAt: now() };
    guards.push(g);
    placeGuards();
    g.timer = later(() => { g.timer = 0; dropGuard(g); }, GUARD_MS);
    csfx('repair');
    scheduleAttack(rec, attackInterval(rec));
    kick();
    return g;
  }

  /* ---- the archetype attacks ----------------------------------------------------------------------- */
  /* 속사형: 빠른 직선 3연사 (0.15초 간격, 700 px/s) */
  function attackRapid(rec, r, forced) {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dmg = Math.max(1, Math.round(orbBaseDamage(rec) * 0.6));
    for (let i = 0; i < RAPID_N; i++) {
      const wind = (forced && i === 0) ? 0 : (i === 0 ? 120 : 120 + i * RAPID_GAP);
      spawnOrb(rec, cx, cy, wind, { kind: 'orb', dmg, baseSpeed: RAPID_SPEED });
    }
    scheduleAttack(rec, attackInterval(rec));
    return 'rapid';
  }
  /* 산탄형: 산탄 5발 25도 부채꼴, 발당 피해 1/3 */
  function attackScatter(rec, r, forced) {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dmg = Math.max(1, Math.round(orbBaseDamage(rec) * SCATTER_DMG));
    for (let i = 0; i < SCATTER_N; i++) {
      const off = (-SCATTER_FAN / 2 + SCATTER_FAN * (i / (SCATTER_N - 1))) * DEG;
      spawnOrb(rec, cx, cy, forced ? 0 : 220, { kind: 'scatter', dmg, angleOff: off });
    }
    scheduleAttack(rec, attackInterval(rec));
    return 'scatter';
  }
  /* 추적형: 잠깐 따라오는 유도탄 */
  function attackSeeker(rec, r, forced) {
    spawnOrb(rec, r.left + r.width / 2, r.top + r.height / 2, forced ? 0 : 250, { kind: 'seeker' });
    scheduleAttack(rec, attackInterval(rec));
    return 'seeker';
  }
  /* 포격형: 포물선탄 */
  function attackMortar(rec, r, forced) {
    spawnOrb(rec, r.left + r.width / 2, r.top + r.height / 2, forced ? 0 : 260, { kind: 'mortar' });
    scheduleAttack(rec, attackInterval(rec));
    return 'mortar';
  }
  /* 연발형: 행/항목 수만큼(최대 8) 0.12초 간격으로 한 발씩, 각 행의 왼쪽 끝에서 */
  function attackVolley(rec, r, forced) {
    const rows = volleyRows(rec.el);
    const n = Math.min(VOLLEY_MAX, rows.length);
    const dmg = Math.max(1, Math.round(orbBaseDamage(rec) * VOLLEY_DMG));
    if (!n) { attackShooter(rec, r, forced); return 'shooter'; }
    for (let i = 0; i < n; i++) {
      const rr = rectOf(rows[i]);
      const x = rr ? rr.left : r.left;
      const y = rr ? rr.top + rr.height / 2 : r.top + r.height / 2;
      spawnOrb(rec, x, y, (forced ? 0 : 160) + i * VOLLEY_GAP, { kind: 'orb', dmg, row: rows[i] });
    }
    scheduleAttack(rec, attackInterval(rec));
    return 'volley';
  }
  /* 돌격형: 요소 자신이 달려든다 — 질량이 큰 요소(mass > 4)는 돌격 대신 직사탄 */
  function attackLunge(rec, r, forced) {
    if (rec.lunge) return false;
    if (lungeMassOf(rec.el) > LUNGE_MAX_MASS) { attackShooter(rec, r, forced); return 'shooter'; }
    const ran = startLunge(rec);
    if (ran) return ran;
    attackShooter(rec, r, forced);
    return 'shooter';
  }
  /* 범용형 (reading 1 above): the size tier this build already had, alternating with 돌격. */
  function attackTier(rec, r, forced) {
    if (!modeHasProjectiles() || rec.tier === 'laser') return startLock(rec, forced) ? 'lock' : false;
    if (rec.tier === 'shooter') { attackShooter(rec, r, forced); return 'shooter'; }
    attackCharger(rec, r);
    return 'charger';
  }
  function attackGeneric(rec, r, forced) {
    const n = rec.archSeq || 0;
    rec.archSeq = n + 1;
    if ((n % 2) === 1 && lungeMassOf(rec.el) <= LUNGE_MAX_MASS && !rec.lunge) {
      const ran = startLunge(rec);
      if (ran) return ran;
    }
    return attackTier(rec, r, forced);
  }
  /* The one dispatcher. hostileAttack() (src/90-combat.js) hands every NON-boss attack to it; §4's boss ladder
   * is a rule of its own and the table does not govern it. */
  function archetypeAttack(rec, r, forced) {
    const a = rec.arch || 'generic';
    if (!modeHasProjectiles()) return startLock(rec, forced) ? 'lock' : false;
    if (a === 'alien') { attackLaser(rec, r); return 'laser'; }
    if (a === 'bombard') return attackMortar(rec, r, forced);
    if (a === 'volley') return attackVolley(rec, r, forced);
    if (a === 'rapid') return attackRapid(rec, r, forced);
    if (a === 'lunger') return attackLunge(rec, r, forced);
    if (a === 'tracker') return attackSeeker(rec, r, forced);
    if (a === 'aimer') {
      if (startLock(rec, forced)) return 'lock';
      if (!forced) scheduleAttack(rec, attackInterval(rec));   // a refused lock must not silence the enemy forever
      return false;
    }
    if (a === 'scatter') return attackScatter(rec, r, forced);
    if (a === 'support') return castGuard(rec) ? 'guard' : false;
    return attackGeneric(rec, r, forced);
  }

  /* ---- teardown. clearCombatNodes() / pauseCombat() (src/90-combat.js) are the only callers ---- */
  const archNodes = [];
  function clearArchNodes() {
    for (const n of archNodes.slice()) { try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } }
    archNodes.length = 0;
  }
  function clearArchetypes() { clearLunges(); clearGuards(); clearArchNodes(); }

  /* ---- §F debug hooks ------------------------------------------------------------------------------ */
  debug.archetypeOf = (el) => (el && el.nodeType === 1 ? archetypeOf(el) : null);
  /* The §D3/§D4 table, read off the LIVE code paths rather than restated (same shape as debug.modeTuning).
   * `glyph` is the one the label actually prints and `minArea` the floor forceAttack really compares against. */
  debug.archetypeTable = (el) => {
    const list = ARCH_IDS.map((id) => ({ id, glyph: archGlyph(id) }));
    if (!el || el.nodeType !== 1) return { list };
    const a = archetypeOf(el);
    return { list, id: a, glyph: archGlyph(a), minArea: archMinArea(el), mass: lungeMassOf(el), tag: tagOf(el) };
  };
  debug.projectileTuning = () => ({
    cap: projCap(), live: state.orbs.length,
    orb: { speed: ORB_SPEED * modeProjectileMul(), interceptR: ORB_INTERCEPT_R },
    seeker: { speed: ORB_SPEED * modeProjectileMul(), turnMs: SEEK_TURN_MS, turnDeg: SEEK_TURN_DEG, interceptR: ORB_INTERCEPT_R * SEEK_HIT_MUL },
    scatter: { count: SCATTER_N, fanDeg: SCATTER_FAN, dmgMul: SCATTER_DMG, interceptR: ORB_INTERCEPT_R },
    suck: { speed: SUCK_SPEED, eatR: SUCK_EAT_R },
    mortar: { flightMs: MORTAR_MS, radius: MORTAR_R, interceptR: ORB_INTERCEPT_R },
    rapid: { count: RAPID_N, gapMs: RAPID_GAP, speed: RAPID_SPEED * modeProjectileMul() },
    volley: { max: VOLLEY_MAX, gapMs: VOLLEY_GAP, dmgMul: VOLLEY_DMG },
    ringFrom: ORB_RING_FROM, hitAlpha: ORB_HIT_ALPHA, missAlpha: ORB_MISS_ALPHA, hitPx: ORB_HIT_PX, missPx: ORB_MISS_PX
  });
  debug.lungeTuning = () => ({
    windupMs: LUNGE_WINDUP, pullPx: LUNGE_PULL, speed: LUNGE_SPEED, holdMs: LUNGE_HOLD, returnMs: LUNGE_RETURN, maxMass: LUNGE_MAX_MASS
  });
  debug.lunges = () => lunges.map((lg) => ({
    id: (lg.el && lg.el.id) || '', tag: tagOf(lg.el), phase: (lg.rec && lg.rec.phase) || '',
    hit: !!lg.hit, shoved: lg.shoved, dmg: lg.dmg
  }));
  debug.guards = () => guards.map((g) => ({ id: (g.el && g.el.id) || '', tag: tagOf(g.el), ageMs: Math.round(now() - g.bornAt) }));
