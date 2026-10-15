// ── SPEC-weapon-identity §C: 표적 등급 계수(§C2 · §C3)와 §C4 가 템플릿 둘을 가른 동사들 ──
  /* =====================================================================
   * 11단계 §C — 개성
   *
   * §C1: "무기의 정체성은 '무엇을 잘하는가'가 아니라 **'무엇을 못하는가'** 다."
   *
   * 이 모듈은 두 가지를 한다.
   *   1. §C2 의 네 등급(면적으로 가른다)과 §C3 의 계수를 **피해에 곱한다**. 곱하는 자리는
   *      applyHit() 하나다 — 냉각총의 ×1.8 이 이미 그 자리를 쓰고 있고(src/69-utility.js),
   *      같은 이유로 히트스캔 · 범위 · 관통 · 보조 공격이 한 줄로 전부 따라온다.
   *   2. §C4 의 동사들이 쓰는 **장부**를 연다 — 연사 누적 · 갈아내기 · 지속 절단 · 못 꿰맴.
   *      동사 자체는 각 fire() 안에 있고(src/76-weapon-fire.js) 여기 있는 것은 상태와 그 상태를
   *      읽고 쓰는 함수뿐이다. 새 물리 루프는 하나도 만들지 않는다: 변위는 src/67-displace.js,
   *      확산은 src/77-burn.js 의 인접 판정, 분해는 src/66-fracture.js 를 그대로 쓴다.
   *
   * 무흔적: 여기서 페이지 요소에 **쓰는 것은 하나도 없다**. 갈아내기는 state.hp 의 `max` 를 깎고,
   * 그 맵은 restore() 가 통째로 새로 만든다(src/99-api.js) — `max` 는 다음 접촉에서 DOM 으로부터
   * 다시 계산되어 원래 값으로 돌아온다. 아래 rlResetAll() 은 이 모듈의 장부와 꿰맨 자국만 치운다.
   * ===================================================================== */

  /* §C2 표적 등급. 면적은 **페이지 좌표계**다 — 조준경 배율 아래에서 rect 는 2배가 되므로
   * ownHp() (src/50-target.js) 와 똑같이 scopeMag() 로 나눈다. 그래야 조준경을 들여다보는 것만으로
   * 버튼이 카드가 되지 않는다. */
  const RL_GRADES = [
    { key: 'word', maxArea: 3000 },
    { key: 'small', maxArea: 20000 },
    { key: 'mid', maxArea: 150000 },
    { key: 'large', maxArea: Infinity }
  ];
  function rlAreaOf(el) {
    const r = el && el.nodeType === 1 ? rectOf(el) : null;
    if (!r || r.width < 1 || r.height < 1) return 0;
    const m = scopeMag();
    return (r.width / m) * (r.height / m);
  }
  function rlGradeOf(el) {
    const a = rlAreaOf(el);
    for (const g of RL_GRADES) if (a <= g.maxArea) return g.key;
    return 'large';
  }
  /* **지금 쏜 무기**. `state.weapon` 은 손에 든 무기이고 그 둘은 늘 같지는 않다 — `smashAt(x, y, id)` 는
   * 들고 있지 않은 무기로도 한 방을 쏘고(src/79-weapon-actions.js), 범위 무기의 피해는 later() 로 몇
   * 프레임 뒤에 들어온다. 그 사이에 손에 든 무기가 바뀌면 등급 계수가 남의 것이 된다. action() 과
   * holdStep() 이 여기에 적어 두고, 지우지 않는다 — "마지막으로 쏜 무기" 가 늦게 도착하는 피해의
   * 임자이기 때문이다. */
  let rlFiring = '';
  function rlSetFiring(id) { if (id && WEAPONS[id]) rlFiring = id; }
  /* 무기를 **바꾸면** 그 장부는 지운다. 그러지 않으면 손에 든 것과 다른 무기로 쏜 한 방이 그 뒤의
   * 모든 피해의 임자로 남는다 — 디버그 훅(debug.shockwave 등)처럼 action() 을 지나지 않는 경로가
   * 그 자리를 그대로 밟았다. 지우면 `state.weapon` 으로 되돌아가고, 그게 맞는 답이다. */
  const rlSetWeaponBase = setWeapon;
  setWeapon = function (rawId, opts) { rlFiring = ''; rlStreakClear(); rlDwellClear(); return rlSetWeaponBase(rawId, opts); };
  /* §C3: `WEAPONS[id].vs[등급]`, 기본 1.0. 표가 없는 무기(붕괴 · 특수 · 예능 · 사용자 정의)는 1.0 이다 —
   * §C3 자신이 "기본 1.0" 이라고 적었다. */
  function rlVsMul(el, id) {
    const W = WEAPONS[id || rlFiring || state.weapon];
    const t = W && W.vs;
    if (!t || !el || el.nodeType !== 1) return 1;
    const v = t[rlGradeOf(el)];
    return typeof v === 'number' && isFinite(v) && v > 0 ? v : 1;
  }

  /* ── §C4 장부 ─────────────────────────────────────────────────────────── */
  /* 기관단총 연사 누적: "같은 요소를 연속으로 맞히면 탄마다 +8% (5발까지, 표적을 바꾸면 초기화)."
   * §D 가 "5발째 1.4배" 라고 못박았으므로 n 번째 명중의 배수는 1 + 0.08 × min(n, 5) 이다
   * (5발째 = 1 + 0.40). 첫 발이 1.08 인 것은 그 식의 결과이고, §D 의 숫자가 이 식을 고른다. */
  const RL_STREAK_STEP = 0.08;
  const RL_STREAK_CAP = 5;
  const rlStreak = { el: null, n: 0 };
  function rlStreakMul(el) {
    if (!el) { rlStreak.el = null; rlStreak.n = 0; return 1; }
    if (rlStreak.el !== el) { rlStreak.el = el; rlStreak.n = 0; }
    rlStreak.n = Math.min(rlStreak.n + 1, RL_STREAK_CAP);
    return 1 + RL_STREAK_STEP * rlStreak.n;
  }
  function rlStreakClear() { rlStreak.el = null; rlStreak.n = 0; }

  /* 미니건 갈아내기: "명중 시 그 요소의 max 를 0.6%씩 깎는다(최대 30%)."
   * 원래 max 를 장부에 적어 두고 거기서 비례로 깎는다 — 매번 현재값의 0.6% 를 깎으면 복리가 되어
   * 30% 라는 상한이 뜻을 잃는다. `hp` 가 새 `max` 보다 크면 같이 내린다: 체력이 그릇보다 많을 수는 없다. */
  const RL_GRIND_PER_HIT = 0.006;
  const RL_GRIND_CAP = 0.30;
  const RL_GRIND_STEPS = Math.round(RL_GRIND_CAP / RL_GRIND_PER_HIT);   // 50
  let rlGround = new WeakMap();        // el -> { max0, n } — restore() 에서 새로 연다 (아래 rlResetAll)
  function rlGrind(el) {
    if (!el || el.nodeType !== 1) return 0;
    let rec = null;
    try { rec = hpOf(el); } catch (e) { rec = null; }
    if (!rec || !(rec.max > 0)) return 0;
    let g = rlGround.get(el);
    if (!g) { g = { max0: rec.max, n: 0 }; rlGround.set(el, g); }
    if (g.n >= RL_GRIND_STEPS) return g.n;
    g.n++;
    rec.max = Math.max(1, Math.round(g.max0 * (1 - RL_GRIND_PER_HIT * g.n)));
    if (rec.hp > rec.max) rec.hp = rec.max;
    return g.n;
  }
  function rlGroundOf(el) { const g = el && rlGround.get(el); return g ? { max0: g.max0, steps: g.n } : null; }

  /* 레이저 지속 절단: "같은 지점을 0.4초 유지하면 그 선을 따라 분리한다. 멈추면 처음부터."
   * 여기 있는 것은 **머문 시간**을 세는 장부뿐이고, 자르는 일 자체는 6단계의 분해(breakElement 의
   * splitLine)를 그대로 쓴다. "같은 지점" 의 허용 반경 10px 은 조준점이 가만히 있어도 블룸 · 손떨림이
   * 그 정도는 흔든다는 뜻이다 — 더 좁히면 사람이 성공시킬 수 없는 동작이 된다. (해석, 보고에 적었다.) */
  const RL_DWELL_MS = 400;
  const RL_DWELL_R = 10;
  const rlDwell = { el: null, x: 0, y: 0, at: 0 };
  /* 머문 시간(ms)을 돌려준다. 표적이나 지점이 바뀌면 0 에서 다시 센다. */
  function rlDwellTick(el, x, y) {
    const t = now();
    if (!el) { rlDwell.el = null; rlDwell.at = 0; return 0; }
    if (rlDwell.el !== el || Math.hypot(x - rlDwell.x, y - rlDwell.y) > RL_DWELL_R) {
      rlDwell.el = el; rlDwell.x = x; rlDwell.y = y; rlDwell.at = t;
      return 0;
    }
    return t - rlDwell.at;
  }
  function rlDwellClear() { rlDwell.el = null; rlDwell.at = 0; }
  function rlDwellMs() { return scaleMs(RL_DWELL_MS); }

  /* 못총 꿰매기: "같은 요소에 못 3개를 박으면 이웃 요소와 꿰맨다 — 둘이 같이 부서진다." */
  const RL_NAILS_TO_STITCH = 3;
  let rlNails = new WeakMap();         // el -> 명중 횟수
  let rlSewn = new WeakMap();          // el -> 짝
  const rlSeams = [];                  // [data-crs] 실밥 노드
  function rlNailCount(el) { return (el && rlNails.get(el)) || 0; }
  function rlSewnMate(el) {
    const m = el && rlSewn.get(el);
    if (!m) return null;
    try { if (!m.isConnected || m.hasAttribute('data-crs-broken')) return null; } catch (e) { return null; }
    return m;
  }

  /* ── 이웃 찾기 ────────────────────────────────────────────────────────────
   * §F2 확산(src/77-burn.js)이 쓰는 인접 판정을 그대로 빌린다: 맞닿은 것만 이웃이고, 다른 후보를
   * 품고 있는 것은 컨테이너이지 이웃이 아니다. 거기 있는 rectGap() 을 그대로 부른다 — 번지는 규칙이
   * 둘이 되면 불과 서리가 다른 페이지를 보게 된다. */
  const RL_NEIGHBOUR_GAP = 8;
  function rlNeighbours(el, gap, max) {
    const out = [];
    const r = el && rectOf(el);
    if (!r || r.width < 1 || r.height < 1) return out;
    const lim = gap > 0 ? gap : RL_NEIGHBOUR_GAP;
    let cands = [];
    try { cands = walkCandidates(r.left + r.width / 2, r.top + r.height / 2, { limit: 0.7 * viewW() * viewH(), minArea: 1200, descendCollected: true }); }
    catch (e) { return out; }
    const wrap = new Set();
    for (const a of cands) for (const b of cands) { if (a !== b) { try { if (a.el.contains(b.el)) { wrap.add(a.el); break; } } catch (e) { /* ignore */ } } }
    const scored = [];
    for (const c of cands) {
      const o = c.el;
      if (o === el || wrap.has(o) || isOurs(o)) continue;
      try { if (!o.isConnected || o.hasAttribute('data-crs-broken')) continue; } catch (e) { continue; }
      try { if (o.contains(el) || el.contains(o)) continue; } catch (e) { continue; }   // 옆으로만 — 자기 계보는 이웃이 아니다
      const or = rectOf(o);
      if (!or || or.width < 1 || or.height < 1) continue;
      const g = rectGap(r, or);
      if (g > lim) continue;
      scored.push({ el: o, gap: g });
    }
    scored.sort((a, b) => a.gap - b.gap);
    for (const s of scored) { if (out.length >= (max > 0 ? max : 6)) break; out.push(s.el); }
    return out;
  }
  /* 도탄이 찾는 것은 "맞닿은" 이웃이 아니라 **가장 가까운 다른 요소**다 — 공은 틈을 건넌다. */
  function rlNearestOther(el, x, y, maxDist) {
    let cands = [];
    try { cands = walkCandidates(x, y, { limit: 0.7 * viewW() * viewH(), minArea: 600, descendCollected: true }); }
    catch (e) { return null; }
    const lim = maxDist > 0 ? maxDist : 420;
    let best = null, bestD = Infinity;
    for (const c of cands) {
      const o = c.el;
      if (!o || o === el || isOurs(o)) continue;
      try { if (!o.isConnected || o.hasAttribute('data-crs-broken')) continue; } catch (e) { continue; }
      if (el) { try { if (o.contains(el) || el.contains(o)) continue; } catch (e) { continue; } }
      const r = rectOf(o);
      if (!r || r.width < 1 || r.height < 1) continue;
      const d = edgeDist(r, x, y);
      if (d < bestD && d <= lim) { bestD = d; best = o; }
    }
    return best;
  }

  /* 꿰맨 자국: 두 요소 사이를 잇는 [data-crs] 실밥. 페이지에는 한 글자도 쓰지 않는다. */
  function rlSeamFx(a, b) {
    if (!root || reducedMotion()) return null;
    const ra = rectOf(a), rb = rectOf(b);
    if (!ra || !rb) return null;
    const ax = ra.left + ra.width / 2, ay = ra.top + ra.height / 2;
    const bx = rb.left + rb.width / 2, by = rb.top + rb.height / 2;
    const n = mk('div', 'crs-seam');
    const len = Math.hypot(bx - ax, by - ay), ang = Math.atan2(by - ay, bx - ax);
    n.style.left = px(ax); n.style.top = px(ay); n.style.width = px(len);
    n.style.transformOrigin = '0 50%';
    n.style.transform = 'translateY(-1px) rotate(' + ang.toFixed(4) + 'rad)';
    root.append(n);
    rlSeams.push(n);
    while (rlSeams.length > 24) { const old = rlSeams.shift(); try { cancelAnimsOf(old); old.remove(); } catch (e) { /* ignore */ } }
    return n;
  }
  function rlClearSeams() {
    while (rlSeams.length) { const n = rlSeams.pop(); try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } }
  }
  /* 세 번째 못. 짝을 찾아 꿰매고 그 짝을 돌려준다. */
  function rlNailHit(el) {
    if (!el || el.nodeType !== 1) return null;
    const n = rlNailCount(el) + 1;
    rlNails.set(el, n);
    if (n < RL_NAILS_TO_STITCH || rlSewn.has(el)) return null;
    const mate = rlNeighbours(el, RL_NEIGHBOUR_GAP, 1)[0] || null;
    if (!mate || rlSewn.has(mate)) return null;
    rlSewn.set(el, mate); rlSewn.set(mate, el);
    rlSeamFx(el, mate);
    sfx('nail', { pitch: 0.8, gain: 0.8 });
    return mate;
  }
  /* "둘이 같이 부서진다." applyHit() 의 래퍼가 'broken' 을 보면 짝도 같이 간다. 짝의 짝으로 되돌아오는
   * 일이 없도록 양쪽 장부를 먼저 지운다 — 꿰맨 실은 한 번만 당겨진다. */
  function rlStitchBreak(el, ix, iy) {
    const mate = rlSewnMate(el);
    rlSewn.delete(el);
    if (!mate) return null;
    rlSewn.delete(mate);
    const r = rectOf(mate);
    const cx = r ? r.left + r.width / 2 : ix;
    const cy = r ? r.top + r.height / 2 : iy;
    try {
      breakElement(mate, cx, cy, { mode: 'gun', pieces: 2, textSplit: false, toward: { x: ix, y: iy } });
      state.hp.delete(mate);
    } catch (e) { return null; }
    refreshHover();
    scheduleHud();
    return mate;
  }

  /* ── §C4 망치 내리찍기 파동 · 뿅망치 튕겨내기 ─────────────────────────────
   * 둘 다 **변위 시스템**(src/67-displace.js) 위에 올린다. 새 물리는 없다: displaceEl() 에 충격량을
   * 넘기는 것이 전부이고, 중력 · 반발 · 충돌은 이미 거기 있다. 망치의 파동은 **피해가 없다** —
   * §C4 가 "이웃이 흔들린다(변위, 피해 없음)" 라고 못박았다. */
  const RL_WAVE_R = 80;
  /* "이웃이 **흔들린다**(변위, **피해 없음**)" — 세 낱말이 전부 설계다.
   *   · 흔들린다 → 밀렸다가 **돌아온다**. §E1 이 이미 제자리로 미끄러져 돌아오는 길을 들고 있으므로
   *     (startMovedReturn, src/67-displace.js) 그것을 그대로 쓴다. 속도를 주고 마찰에 맡기면 0.86/s 로는
   *     37px/s 가 잠들기 문턱(5px/s)까지 내려가는 데 15초가 걸린다 — 망치 한 번에 페이지가 15초 동안
   *     떨리는 것은 파동이 아니라 고장이다.
   *   · 피해 없음 → **돌아오는 중인 몸체는 충돌 판정에서 빠진다**(movedCollide 의 `!b.returning`).
   *     속도를 주는 방식으로는 그 몸체가 §E3 의 충돌 피해를 내고(처음 측정에서 컨테이너가 2 를 더 잃었다)
   *     §C4 가 "피해 없음" 이라고 적은 문장이 거짓이 된다. 밀어서 **놓는** 것이 아니라 밀었다가 당긴다.
   *   · 변위 → 새 물리 루프가 아니다. displaceEl() 로 몸체를 만들고 그 몸체의 좌표를 옮긴다.
   * (셋 다 해석이 들어갔다 — 보고에 적었다.) */
  const RL_WAVE_PUSH_PX = 14;
  const RL_WAVE_RETURN_MS = 260;
  const RL_FLING_IMPULSE = 1500;
  /* `skipEl` 은 맞은 요소다. **없으면 파동도 없다** — 아무것도 맞히지 못한 헛스윙이 페이지를 흔들 이유가
   * 없다. 그리고 §F2 확산이 쓰는 것과 같은 규칙으로 **옆으로만** 간다: 맞은 요소를 품고 있는 조상은
   * 이웃이 아니라 내가 서 있는 바닥이다. 이 줄이 없을 때 망치 한 번이 카드를 품은 **섹션 전체**를
   * 14px 밀어 그 안의 다른 요소들이 전부 같이 움직였고, 그 뒤의 조준이 빗나갔다 (실제로 당했다 —
   * 로켓 열두 발이 적을 한 번도 못 맞혔다). (보고에 적었다.) */
  function rlWave(x, y, R, impulse, skipEl) {
    if (!state.active || !skipEl) return [];
    const out = [];
    let cands = [];
    /* 엄폐를 무시하지 않는다(마지막 인자 false): 망치는 압력파가 아니라 **때린 것**이고, 카드 뒤에
     * 숨은 것까지 흔들리면 충격포와 구별되지 않는다. */
    try { cands = aoeCandidates(x, y, R, 10, [Math.round(R * 0.5), R], false); } catch (e) { return out; }
    for (const c of cands) {
      const el = c.el;
      if (!el || el === skipEl) continue;
      try { if (el.contains(skipEl) || skipEl.contains(el)) continue; } catch (e) { continue; }   // 옆으로만
      const r = rectOf(el);
      const qx = r ? r.left + r.width / 2 : x, qy = r ? r.top + r.height / 2 : y;
      let dx = qx - x, dy = qy - y, L = Math.hypot(dx, dy);
      if (!(L > 1)) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); L = 1; }
      const k = Math.max(0, 1 - clamp(c.d, 0, R) / R);
      const mag = (impulse > 0 ? impulse : RL_WAVE_PUSH_PX) * k;
      if (!(mag > 0)) continue;
      /* 이미 몸체를 가진 요소는 건드리지 않는다. 고무탄이 걸어 둔 bouncy 나 견인 광선이 들고 있는 것을
       * 망치 한 방이 제자리로 끌어다 놓으면 그 무기들이 한 일이 지워진다. */
      if (state.moved.has(el)) continue;
      const b = displaceEl(el, 0, 0, null);
      if (!b) continue;
      b.vx = 0; b.vy = 0; b.vr = 0;
      b.x += (dx / L) * mag; b.y += (dy / L) * mag;
      b.rot += rand(-0.015, 0.015);
      b.retMs = RL_WAVE_RETURN_MS;
      startMovedReturn(b);
      out.push(el);
    }
    return out;
  }
  /* 뿅망치: 맞은 요소 **하나**가 반대로 날아간다. 파동이 아니라 밀어내기다. */
  function rlFling(el, x, y, impulse) {
    if (!el) return null;
    const r = rectOf(el);
    const qx = r ? r.left + r.width / 2 : x, qy = r ? r.top + r.height / 2 : y;
    let dx = qx - x, dy = qy - y, L = Math.hypot(dx, dy);
    if (!(L > 1)) { dx = 0; dy = -1; L = 1; }
    return displaceEl(el, (dx / L) * (impulse > 0 ? impulse : RL_FLING_IMPULSE), (dy / L) * (impulse > 0 ? impulse : RL_FLING_IMPULSE) - 220, { spin: rand(-260, 260) });
  }

  /* 레이저 지속 절단의 분리 — 6단계 분해를 그대로 쓴다. 자르는 선은 **빔의 선**이다: 발사 원점에서
   * 머물고 있는 지점으로 가는 직선이 곧 "그 선" 이다(lzOrigin, src/78-altfire.js). */
  function rlLaserSever(el, x, y) {
    if (!el) return false;
    try { if (!el.isConnected || el.hasAttribute('data-crs-broken')) return false; } catch (e) { return false; }
    let o = null;
    try { o = lzOrigin(); } catch (e) { o = null; }
    if (!o) o = { x: viewW() / 2, y: viewH() + 8 };
    const angle = Math.atan2(y - o.y, x - o.x);
    sfx('katanaRing', { gain: 0.7 });
    try {
      breakElement(el, x, y, { mode: 'gun', pieces: 2, textSplit: false, cloneCap: 300, splitLine: { angle, cx: x, cy: y } });
      state.hp.delete(el);
    } catch (e) { return false; }
    refreshHover();
    scheduleHud();
    return true;
  }

  /* 고무탄 도탄: 맞은 지점에서 가장 가까운 다른 요소로 **한 번**, 피해 60%. */
  const RL_RICOCHET_MUL = 0.6;
  const RL_RICOCHET_R = 420;
  function rlRicochet(el, x, y) {
    if (!state.active) return null;
    const W = WEAPONS.rubber;
    const mate = rlNearestOther(el, x, y, RL_RICOCHET_R);
    if (!mate) return null;
    const r = rectOf(mate);
    const mx = r ? clamp(r.left + r.width / 2, 0, viewW()) : x;
    const my = r ? clamp(r.top + r.height / 2, 0, viewH()) : y;
    const crit = rollCrit('rubber');
    sfx('boing', { gain: 0.55, pitch: 1.25 });
    applyHit(mate, rollDamage(W.damage, crit, RL_RICOCHET_MUL * falloffMul('rubber', mx, my)), 'gun', mx, my, { crit });
    return mate;
  }

  /* 냉각총 서리 전파. 번지는 규칙은 §F2 의 불 확산 그대로다 — 같은 인접 판정, 같은 최대 2개, 같은
   * ×0.35. 다만 얼어붙는 데에는 문턱(UT_FROST_MIN)이 있어 7 × 0.35 = 2.45 로는 넘지 못하므로, 번지는
   * 양은 "한 번에 얼어붙을 만큼" 으로 둔다 — 불이 스택을 나눠 주는 것과 달리 서리는 **붙거나 안 붙거나**
   * 이기 때문이다. (해석, 보고에 적었다.) */
  const RL_FROST_SPREAD_MAX = 2;
  const RL_FROST_SPREAD_FLOOR = 14;
  function rlFrostSpread(el, W) {
    if (!state.active) return [];
    const per = (W && W.freezePerTick) || WEAPONS.freezegun.freezePerTick || 7;
    const amount = Math.max(RL_FROST_SPREAD_FLOOR, per * BURN_SPREAD_MUL);
    const out = [];
    for (const o of rlNeighbours(el, BURN_SPREAD_GAP, RL_FROST_SPREAD_MAX)) {
      if (fzFreeze(o, amount, 0)) out.push(o);
    }
    if (out.length) sfx('freeze', { gain: 0.45, pitch: 1.2 });
    return out;
  }

  /* ── §C3 을 피해에 곱한다 ─────────────────────────────────────────────────
   * applyHit() 은 히트스캔 · 범위 · 관통 · 연소 · 충돌이 전부 지나가는 **하나의 피해 싱크**다.
   * `opts.noVs` 는 그 중 **무기의 공격이 아닌** 둘을 뺀다: 변위 충돌(§E3, 물리가 내는 피해)과
   * 연소 지속 피해(불은 요소에 붙어 있는 것이지 지금 든 무기가 쏘는 것이 아니다). 그 둘에 지금 든
   * 무기의 등급 계수를 곱하면 무기를 바꾸는 것만으로 이미 붙은 불의 세기가 달라진다. */
  const rlApplyHitBase = applyHit;
  applyHit = function (el, dmg, kind, ix, iy, opts) {
    const o = opts || {};
    let d = dmg;
    if (!o.noVs && isFinite(dmg)) {
      const m = rlVsMul(el, o.weapon || rlFiring || state.weapon);
      if (m !== 1) d = Math.max(1, Math.round(dmg * m));
    }
    const r = rlApplyHitBase(el, d, kind, ix, iy, opts);
    if (r === 'broken') rlStitchBreak(el, ix, iy);
    return r;
  };

  /* ── 무흔적 ───────────────────────────────────────────────────────────────
   * restore() 보다 먼저 돌아 장부와 실밥을 치운다. 갈아낸 `max` 는 restore() 가 state.hp 를 통째로
   * 새 WeakMap 으로 바꾸면서 사라지고, 다음 접촉에서 DOM 으로부터 다시 계산된다 — §D 의
   * "`max` 가 원래 값으로" 가 그렇게 성립한다. */
  const rlRestoreBase = restore;
  restore = function () { rlResetAll(); return rlRestoreBase(); };
  function rlResetAll() {
    rlFiring = '';
    rlStreakClear();
    rlDwellClear();
    rlClearSeams();
    /* 장부 셋은 **버린다**. WeakMap 을 그대로 두면 복구 뒤에도 "이미 20걸음 갈아냈다" 가 남아
     * 다음 한 발이 원래 값에서 시작하지 않는다 — §D 의 "`max` 가 원래 값으로" 는 그 다음 한 발까지
     * 포함해서 참이어야 한다. 못 횟수와 꿰맨 짝도 같은 이유로 버린다. */
    rlGround = new WeakMap();
    rlNails = new WeakMap();
    rlSewn = new WeakMap();
    if (root) {
      let leftovers = [];
      try { leftovers = root.querySelectorAll('.crs-seam'); } catch (e) { leftovers = []; }
      for (const n of leftovers) { try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } }
    }
  }

  /* ---- debug surface (the suite is written against these) ------------------------------------------ */
  debug.gradeOf = (el) => (el && el.nodeType === 1 ? { grade: rlGradeOf(el), area: Math.round(rlAreaOf(el)) } : null);
  debug.vsOf = (el, id) => (el && el.nodeType === 1 ? rlVsMul(el, id) : 1);
  debug.vsTable = () => {
    const out = {};
    for (const id of WEAPON_IDS) out[id] = WEAPONS[id].vs ? Object.assign({}, WEAPONS[id].vs) : null;
    return out;
  };
  debug.roles = () => ({
    grades: RL_GRADES.map((g) => ({ key: g.key, maxArea: isFinite(g.maxArea) ? g.maxArea : null })),
    streak: { el: !!rlStreak.el, n: rlStreak.n, step: RL_STREAK_STEP, cap: RL_STREAK_CAP },
    dwellMs: RL_DWELL_MS, dwellR: RL_DWELL_R,
    grind: { perHit: RL_GRIND_PER_HIT, cap: RL_GRIND_CAP, steps: RL_GRIND_STEPS },
    firing: rlFiring, nailsToStitch: RL_NAILS_TO_STITCH, seams: rlSeams.length,
    ricochetMul: RL_RICOCHET_MUL, frostSpreadMax: RL_FROST_SPREAD_MAX,
    waveR: RL_WAVE_R, wavePushPx: RL_WAVE_PUSH_PX, waveReturnMs: RL_WAVE_RETURN_MS,
    flingImpulse: RL_FLING_IMPULSE
  });
  debug.groundOf = (el) => rlGroundOf(el);
  /* 갈아내기만 떼어서 부르는 길. 상한(30% · 50걸음)은 1800 이 넘는 피해를 쏟아부어야 닿는데 그걸
   * 견디는 요소가 페이지에 없다 — 검사는 **깎는 쪽**만 보면 되고, 쏘는 쪽은 위의 실측이 이미 본다.
   * debug.freeze2 / debug.ignite 와 같은 모양의 훅이다. */
  debug.grind = (el, n) => {
    let steps = 0;
    for (let i = 0, k = n > 0 ? n : 1; i < k; i++) steps = rlGrind(el);
    return { steps, max: el ? hpOf(el).max : 0, max0: rlGroundOf(el) ? rlGroundOf(el).max0 : 0 };
  };
  debug.nailsOf = (el) => rlNailCount(el);
  debug.sewnOf = (el) => rlSewnMate(el);
