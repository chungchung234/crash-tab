// ── SPEC-arsenal §E 무기 다양화 (샷건 · 못총 · 냉각총 · 중력탄) ──
  /* =====================================================================
   * 10.6 Utility weapons — 9단계
   *
   * §E 는 무기를 더 넣는 기준을 "피해량이 다른가" 가 아니라 **"할 수 있는 일이
   * 다른가"** 로 못박았다. 그래서 이 파일에 피해 계산은 거의 없다. 네 개의 새
   * 동사가 전부다.
   *
   *   샷건    밀집한 작은 요소를 한 번에   — 펠릿 아홉이 각자 자기 표적을 찾는다
   *   못총    고정                          — 맞은 조각이 그 자리에 박힌다
   *   냉각총  빙결                          — 받는 피해 ×1.8, 조각 수 ×2.5, 적 2초 정지
   *   중력탄  끌어모으기                    — 조각과 적의 탄환을 빨아들인다. 직접 피해 0
   *
   * **냉각총이 이 묶음의 중심이다.** 혼자 쓰면 무기고에서 가장 약하다(틱당 4).
   * 8단계가 물총의 젖음과 `ixFreeze` 자리를 만들어 두었으므로 (src/68-interaction.js)
   * 물총 → 냉각총 → 망치가 가장 센 연계가 된다: 젖은 것은 `ixCoolMul` 로 2.5배 빨리
   * 얼고, 언 것은 1.8배로 맞고 2.5배로 부서진다. 로드아웃 구성에 처음으로 조합이라는
   * 개념이 생긴다 — `PRESETS.combo` 가 그 조합이다.
   *
   * THE STRUCTURAL RULE, same as §C/§D's: every state this module puts on a PAGE
   * element goes on through ONE function and comes off through ONE function, and
   * restore() empties the lot. 빙결은 페이지 요소의 인라인 `animation-play-state`
   * 와 `transition` 두 개만 빌리고(원래 값과 우선순위를 먼저 저장한다), 보이는
   * 서리는 `[data-crs]` 오버레이라 페이지 요소에는 아무것도 안 쓴다. 젖음(§D)이
   * 빌리는 `filter` 와 연소(§F)가 빌리는 `filter` 에는 손대지 않는다 — 셋이 같은
   * 속성을 두고 다투면 되돌릴 원래 값이 누구 것인지 알 수 없게 된다.
   * ===================================================================== */

  /* ── the table extras ─────────────────────────────────────────────────────
   * DESTRUCTION (src/66-fracture.js) and CH_SHAPES (src/51-crosshair.js) are plain objects declared EARLIER
   * in the bundle; the rows are added from here rather than by editing two files this workstream only reads,
   * exactly as §B and §C/§D did. src/66's `for (const id of WEAPON_IDS) WEAPONS[id].destruction =
   * DESTRUCTION[id]` has already run and wrote `undefined` for these four ids.
   * INTERPRETATION (reported): §E names no destruction profile, only the verb — so the profile follows the
   * verb. 샷건은 여러 점을 한꺼번에 때리므로 파편이 터져 나가고, 못총은 박아 넣으므로 안으로 모이고,
   * 냉각총은 언 것이 **깨져 떨어지고**(얼음이므로 파편 shard), 중력탄은 빨려 들어가므로 implode 다. */
  DESTRUCTION.shotgun   = { shape: 'shard', separation: 'burst',   finish: 'none', particles: 'spark', delayMs: 0,  vaporise: 0 };
  DESTRUCTION.nailgun   = { shape: 'strip', separation: 'implode', finish: 'none', particles: 'spark', delayMs: 0,  vaporise: 0 };
  DESTRUCTION.freezegun = { shape: 'shard', separation: 'drop',    finish: 'none', particles: 'dust',  delayMs: 60, vaporise: 0 };
  DESTRUCTION.gravity   = { shape: 'wedge', separation: 'implode', finish: 'none', particles: 'dust',  delayMs: 0,  vaporise: 0 };
  for (const id of ['shotgun', 'nailgun', 'freezegun', 'gravity']) WEAPONS[id].destruction = DESTRUCTION[id];

  /* §A4 of SPEC-crosshair: every weapon has a shape, added from outside the same way.
   * 샷건은 펠릿이 퍼지는 넓은 원, 못총은 못 한 자루라 가늘고 긴 수직 획에 점 하나, 냉각총은 서리 결정
   * 두 획, 중력탄은 안으로 빨려 드는 점선 원(`blast` 가 WEAPONS[id].radius 를 읽는다). */
  CH_SHAPES.shotgun   = { arms: 4, dot: false, armLen: 9, parts: [{ cls: 'crs-ch-circle', size: 34, w: 1, rot: 0 }] };
  CH_SHAPES.nailgun   = { arms: 4, dot: true,  armLen: 4, thin: true, parts: [{ cls: 'crs-ch-slash', size: 18, w: 2, rot: 0 }] };
  CH_SHAPES.freezegun = { arms: 0, dot: true,  armLen: 0, parts: [{ cls: 'crs-ch-slash', size: 22, w: 2, rot: 30 }, { cls: 'crs-ch-slash', size: 22, w: 2, rot: -30 }] };
  CH_SHAPES.gravity   = { arms: 0, dot: true,  armLen: 0, blast: true, parts: [{ cls: 'crs-ch-circle', size: 16, w: 2, rot: 0 }] };

  /* ── constants ──────────────────────────────────────────────────────────── */
  const UT_FROST_TICK_MS = 120;        // 빙결 만료 / 서리 추종의 심장 박동 (self-rescheduling later(), never setInterval)
  const UT_FROST_MIN = 12;             // 이 아래의 `frozen` 은 "얼었다" 로 치지 않는다 — 녹는 중의 꼬리
  const UT_PIN_FLASH_MS = 260;         // 못이 박힐 때의 섬광
  const UT_WELL_STEP_CAP = 0.05;       // s — 중력장 적분의 dt 상한 (tickFrame 과 같은 값)

  /* ===================================================================== */
  /* §E 냉각총 — 빙결                                                        */
  /* ===================================================================== */
  /*
   * `chilled` (src/77-burn.js) 는 이미 `frozen` 0~100 을 들고 있고 §F4 의 불 ↔ 얼음 규칙이 그 위에서
   * 돈다. 냉각총은 새 장부를 만들지 않는다 — ixFreeze() (src/68) 하나로 그 장부에 쌓고, 여기서는
   * "얼어 있는 동안 무엇이 달라지는가" 만 본다. 그래서 물총의 ixCoolMul ×2.5 가 공짜로 따라온다.
   *
   * INTERPRETATION (reported): §E 의 "SPA 리렌더도 묶는다" 를 **얼어 있는 동안 그 요소 자신의 애니메이션과
   * 전이가 멈춘다** 로 읽었다. 임의의 페이지의 리렌더를 가로막는 것은 (a) MutationObserver 로 DOM 을
   * 되돌린다는 뜻이고 그건 적대적 페이지에서 무한 루프가 되며, (b) 우리가 되돌릴 "원래 값" 을 영원히
   * 알 수 없게 만든다. 읽을 수 있는 쪽, 되돌릴 수 있는 쪽, 그리고 화면에서 실제로 "묶였다" 로 보이는
   * 쪽은 인라인 CSSOM 두 줄이다. 저장 → 쓰기 → 원래 값으로 복구가 전부 한 쌍의 함수 안에 있다.
   */
  const utFrozenEls = new Map();      // el -> { until, frostNode, saved: [{prop, value, priority}], owns, stunUntil }
  let utFrostTimer = 0;

  function fzLevel(el) {
    if (!el) return 0;
    let c = null;
    try { c = chilled.get(el); } catch (e) { c = null; }
    return c ? c.frozen : 0;
  }
  function fzIsFrozen(el) { return fzLevel(el) >= UT_FROST_MIN; }
  function fzMul(el) { return fzIsFrozen(el) ? (WEAPONS.freezegun.freezeMul || 1) : 1; }

  function utFrostArm() {
    if (utFrostTimer || !state.active || !utFrozenEls.size) return;
    utFrostTimer = later(utFrostStep, UT_FROST_TICK_MS);
  }
  function utFrostStep() {
    utFrostTimer = 0;
    if (!state.active) { utFrostClear(); return; }
    const t = now();
    for (const [el, rec] of Array.from(utFrozenEls)) {
      let gone = false;
      try { gone = !el.isConnected || el.hasAttribute('data-crs-broken'); } catch (e) { gone = true; }
      if (gone || t >= rec.until || !fzIsFrozen(el)) { fzUnfreezeEl(el); continue; }
      utFrostFollow(el, rec);
    }
    utFrostArm();
  }

  /* 서리는 `[data-crs]` 오버레이다 — 페이지 요소에는 한 글자도 쓰지 않는다. 연소의 불꽃 띠가 요소를
   * 따라 움직이는 것과 같은 모양이고, 같은 이유로 restore() 의 노드 쓸기에 그냥 걸린다. */
  function utFrostFollow(el, rec) {
    const r = rectOf(el);
    const n = rec.frostNode;
    if (!n || !n.isConnected || !r) return;
    try {
      n.style.left = px(r.left); n.style.top = px(r.top);
      n.style.width = px(r.width); n.style.height = px(r.height);
      n.style.opacity = String(0.25 + 0.5 * clamp(fzLevel(el) / BURN_FROZEN_FULL, 0, 1));
    } catch (e) { /* ignore */ }
  }
  function utFrostNode(el) {
    if (!root) return null;
    const n = mk('div', 'crs-frost');
    root.append(n);
    for (let i = 0; i < 3; i++) n.append(mk('span', 'crs-frost-x crs-frost-x' + i));
    return n;
  }

  /* 페이지 요소에서 빌리는 두 속성. 원래 값과 **우선순위까지** 저장한다 (빈 문자열이 아니라 원래 값). */
  const UT_FREEZE_PROPS = [['animation-play-state', 'paused'], ['transition', 'none']];
  function utFreezePaint(el, rec) {
    if (rec.owns) return;
    rec.saved = [];
    for (const [prop] of UT_FREEZE_PROPS) {
      let value = '', priority = '';
      try { value = el.style.getPropertyValue(prop) || ''; priority = el.style.getPropertyPriority(prop) || ''; } catch (e) { value = ''; priority = ''; }
      rec.saved.push({ prop, value, priority });
    }
    rec.owns = true;
    for (const [prop, want] of UT_FREEZE_PROPS) { try { el.style.setProperty(prop, want); } catch (e) { /* ignore */ } }
  }
  function utFreezeUnpaint(el, rec) {
    if (!rec.owns) return;
    rec.owns = false;
    for (const s of rec.saved || []) {
      try {
        if (s.value) el.style.setProperty(s.prop, s.value, s.priority);
        else el.style.removeProperty(s.prop);
      } catch (e) { /* ignore */ }
    }
    rec.saved = [];
  }

  /* The ONE way anything freezes. `amount` goes through ixFreeze() so 젖음의 ×2.5 는 자동으로 붙는다. */
  function fzFreeze(el, amount, ms) {
    if (!el || el.nodeType !== 1 || !state.active || isOurs(el)) return null;
    try { if (!el.isConnected || el.hasAttribute('data-crs-broken')) return null; } catch (e) { return null; }
    const level = ixFreeze(el, amount > 0 ? amount : WEAPONS.freezegun.freezePerTick);
    if (!(level >= UT_FROST_MIN)) return null;
    let rec = utFrozenEls.get(el);
    if (!rec) {
      rec = { until: 0, frostNode: utFrostNode(el), saved: [], owns: false, stunUntil: 0 };
      utFrozenEls.set(el, rec);
    }
    const dur = scaleMs(ms > 0 ? ms : WEAPONS.freezegun.frostMs);
    rec.until = Math.max(rec.until, now() + dur);
    /* §E: "적은 2초 정지." The stun rides the same record, so letting go of the freeze also lets go of it. */
    rec.stunUntil = Math.max(rec.stunUntil, now() + scaleMs(WEAPONS.freezegun.stunMs));
    utFreezePaint(el, rec);
    utFrostFollow(el, rec);
    utFrostArm();
    kick();
    return level;
  }
  function fzUnfreezeEl(el) {
    const rec = utFrozenEls.get(el);
    if (!rec) return false;
    utFrozenEls.delete(el);
    utFreezeUnpaint(el, rec);
    const n = rec.frostNode;
    rec.frostNode = null;
    if (n) { try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } }
    try { const c = chilled.get(el); if (c) c.frozen = 0; } catch (e) { /* ignore */ }
    return true;
  }
  function fzStunned(el) {
    const rec = el && utFrozenEls.get(el);
    return !!(rec && now() < rec.stunUntil && fzIsFrozen(el));
  }
  function utFrostClear() {
    for (const el of Array.from(utFrozenEls.keys())) fzUnfreezeEl(el);
    utFrozenEls.clear();
    untrack(utFrostTimer); utFrostTimer = 0;
  }

  /* ===================================================================== */
  /* §E 못총 — 고정                                                          */
  /* ===================================================================== */
  /*
   * "맞은 조각이 그 자리에 박힌다. 공중에서 멈추고 수명의 영향을 받지 않는다."
   *
   * 조각의 적분은 `if (p.resting) continue` 한 줄로 건너뛴다 (src/92-tick.js). 그래서 고정은 새 물리가
   * 아니라 **그 한 줄을 영구히 참으로 만드는 것**이다: 속도를 0 으로, resting 을 켜고, 수명 두 개를 모두
   * 지운다. restPiece() 를 쓰지 않는 이유는 그것이 회전을 바닥에 눕히고(±12° tilt) 수명을 다시 켜기
   * 때문이다 — 공중에 박힌 못은 눕지 않는다.
   */
  const utPinned = new Set();
  const utNails = [];

  function pnPinPiece(p) {
    if (!p || p.pinned || utPinned.has(p)) return false;
    p.pinned = true;
    p.vx = 0; p.vy = 0; p.vr = 0;
    p.resting = true; p.grounded = true;
    p.expireAt = 0; p.hardExpireAt = 0;      // §E: 수명의 영향을 받지 않는다
    p.restedFirstAt = 0;
    try { applyTransform(p); } catch (e) { /* ignore */ }
    try { p.node.style.willChange = 'auto'; } catch (e) { /* ignore */ }
    utPinned.add(p);
    return true;
  }
  function pnUnpin(p) {
    if (!p || !utPinned.has(p)) return false;
    utPinned.delete(p);
    p.pinned = false;
    return true;
  }
  function pnPinnedCount() {
    let n = 0;
    for (const p of state.pieces) if (p.pinned) n++;
    return n;
  }
  /* 못 한 자루가 반경 `pinRadius` 안의 조각을 최대 `pinMax` 개까지 잡는다. 가까운 것부터. */
  function pnPinAt(x, y, radius, max) {
    const R = radius > 0 ? radius : WEAPONS.nailgun.pinRadius;
    const cap = max > 0 ? max : WEAPONS.nailgun.pinMax;
    const near = [];
    for (const p of state.pieces) {
      if (p.pinned) continue;
      let b = null;
      try { b = pieceBox(p); } catch (e) { b = null; }
      if (!b) continue;
      const cx = (b.l + b.r) / 2, cy = (b.top + b.bottom) / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d <= R) near.push({ p, d });
    }
    near.sort((a, b) => a.d - b.d);
    let n = 0;
    for (const q of near) { if (n >= cap) break; if (pnPinPiece(q.p)) n++; }
    return n;
  }
  /* 박힌 자리에 남는 못 머리. `[data-crs]` 노드이고 restore() 가 쓸어 간다. */
  function pnNailFx(x, y) {
    if (!root || reducedMotion()) return null;
    const n = mk('div', 'crs-nail');
    n.style.left = px(x - 3); n.style.top = px(y - 3);
    root.append(n);
    utNails.push(n);
    while (utNails.length > 40) { const old = utNails.shift(); try { old.remove(); } catch (e) { /* ignore */ } }
    try {
      trackAnim(n.animate([{ transform: 'scale(2.2)', opacity: 0.1 }, { transform: 'scale(1)', opacity: 1 }],
        { duration: scaleMs(UT_PIN_FLASH_MS), easing: 'ease-out', fill: 'none' }));
    } catch (e) { /* ignore */ }
    return n;
  }
  function pnClearNails() {
    while (utNails.length) { const n = utNails.pop(); try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } }
  }

  /* ===================================================================== */
  /* §E 중력탄 — 끌어모으기                                                   */
  /* ===================================================================== */
  /*
   * "조각과 적의 탄환을 빨아들인다. 직접 피해 0."
   *
   * 중력장은 **tickFrame 위에 올라탄다** — 자기 RAF 를 열지 않는다. 그래야 히트스톱, 일시정지,
   * restore() 가 전부 공짜로 적용되고 "살아있는 RAF 0개" 가 깨지지 않는다. 적분은 가속도이지 위치가
   * 아니다: 조각은 빨려 들어가는 동안에도 서로, 그리고 바닥과 부딪힌다.
   */
  const utWells = [];                 // { x, y, R, until, pull, orbPull, node, pulled }
  let utWellLastT = 0;

  function gwActive() { return utWells.length > 0; }
  function gwSpawn(x, y, R, ms, pullMul) {
    const W = WEAPONS.gravity;
    const w = {
      x, y,
      R: R > 0 ? R : W.radius,
      until: now() + scaleMs(ms > 0 ? ms : W.wellMs),
      pull: W.wellPull * (pullMul > 0 ? pullMul : 1),
      orbPull: W.wellOrbPull * (pullMul > 0 ? pullMul : 1),
      node: null, pulled: 0, orbs: 0
    };
    if (root) {
      const n = mk('div', 'crs-well');
      n.style.left = px(w.x - w.R); n.style.top = px(w.y - w.R);
      n.style.width = px(2 * w.R); n.style.height = px(2 * w.R);
      root.append(n);
      w.node = n;
      if (!reducedMotion()) {
        try {
          trackAnim(n.animate([{ transform: 'scale(1)', opacity: 0.85 }, { transform: 'scale(.18)', opacity: 0.35 }],
            { duration: Math.max(80, w.until - now()), easing: 'ease-in', fill: 'forwards' }));
        } catch (e) { /* ignore */ }
      }
    }
    utWells.push(w);
    utWellLastT = 0;
    kick();
    return w;
  }
  function gwKill(w) {
    const i = utWells.indexOf(w);
    if (i >= 0) utWells.splice(i, 1);
    const n = w.node;
    w.node = null;
    if (n) { try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } }
  }
  function gwClear() { for (const w of utWells.slice()) gwKill(w); utWells.length = 0; utWellLastT = 0; }

  /* 끌어모으기는 **가속**이 아니라 **속도 추종**이다. 가속으로 당기면 조각이 중심을 지나쳐 반대쪽으로
   * 날아가고, 평균 거리가 오히려 멀어진다 (첫 측정이 그랬다: 269 → 305 px). 목표 속도를 거리에
   * 비례시켜 두면 가까워질수록 느려져 가운데에 **모인다** — 그게 §E 가 적은 동사다.
   * 돌아오는 값은 새 속도이지 가속도가 아니다. */
  function gwSeek(w, cx, cy, vx, vy, dt, maxSpeed) {
    const dx = w.x - cx, dy = w.y - cy;
    const d = Math.hypot(dx, dy);
    if (!(d > 0.5) || d > w.R) return null;
    const k = 1 - d / w.R;                      // 가장자리에서 0, 중심에서 1
    const want = Math.min(maxSpeed * k, d * 5); // 가까울수록 느리게 — 지나치지 않는다
    const f = Math.min(1, 12 * dt);             // 추종의 세기 (1/s)
    return { vx: vx + ((dx / d) * want - vx) * f, vy: vy + ((dy / d) * want - vy) * f };
  }
  /* 탄환은 멈추는 게 아니라 **휘어야** 하므로 가속 모델 그대로다. */
  function gwBend(w, cx, cy, dt, strength) {
    const dx = w.x - cx, dy = w.y - cy;
    const d = Math.hypot(dx, dy);
    if (!(d > 1) || d > w.R) return null;
    const a = strength * (1 - d / w.R) * dt;
    return { ax: (dx / d) * a, ay: (dy / d) * a };
  }
  function gwStep(t, dt) {
    if (!utWells.length) return false;
    const expired = [];
    for (const w of utWells) {
      if (t >= w.until) { expired.push(w); continue; }
      /* 조각 — 쉬고 있던 것은 깨워서 끌어올린다. 못으로 박아 둔 것은 **움직이지 않는다**:
       * 고정이 끌어모으기를 이긴다. 그래야 두 무기가 서로 다른 일을 하는 것이 눈에 보인다. */
      for (const p of state.pieces) {
        if (p.pinned) continue;
        let b = null;
        try { b = pieceBox(p); } catch (e) { b = null; }
        if (!b) continue;
        const g = gwSeek(w, (b.l + b.r) / 2, (b.top + b.bottom) / 2, p.vx, p.vy, dt, w.pull);
        if (!g) continue;
        if (p.resting) wakePiece(p);
        p.vx = g.vx; p.vy = g.vy;
        p.noGravUntil = t + 120;                // 빨려 들어가는 동안에는 중력에 지지 않는다
        w.pulled++;
      }
      /* 밀려나 있는 페이지 요소 — §E 의 변위 몸체도 조각과 같이 끌린다. 질량이 있으므로 절반 속도로. */
      for (const b of state.movedList) {
        if (!b || b.released) continue;
        const g = gwSeek(w, b.x + (b.w || 0) / 2, b.y + (b.h || 0) / 2, b.vx, b.vy, dt, w.pull * 0.5);
        if (!g) continue;
        b.vx = g.vx; b.vy = g.vy; b.resting = false;
      }
      /* 적의 탄환 — §E 가 직접 적은 둘째 대상. 아직 발사 전인 것은 건드리지 않는다(속도가 없다). */
      for (const o of state.orbs) {
        if (!o || !o.launched || o.kind === 'mortar') continue;
        const g = gwBend(w, o.x, o.y, dt, w.orbPull);
        if (!g) continue;
        o.vx += g.ax; o.vy += g.ay;
        w.orbs++;
      }
    }
    for (const w of expired) {
      /* 꺼질 때 한 번 더 세게 당긴다 (`collapseMul`) — 중력장이 닫히는 순간이 가장 세다. */
      for (const p of state.pieces) {
        if (p.pinned) continue;
        let b = null;
        try { b = pieceBox(p); } catch (e) { b = null; }
        if (!b) continue;
        const g = gwSeek(w, (b.l + b.r) / 2, (b.top + b.bottom) / 2, p.vx, p.vy, 0.05, w.pull * (WEAPONS.gravity.collapseMul || 1));
        if (!g) continue;
        if (p.resting) wakePiece(p);
        p.vx = g.vx; p.vy = g.vy;
      }
      gwKill(w);
    }
    return utWells.length > 0;
  }

  /* ===================================================================== */
  /* §E 샷건 — 한 발씩 장전                                                   */
  /* ===================================================================== */
  /*
   * "한 발씩 장전." src/82-ammo-reload.js 의 startReload() 는 한 번의 대기 끝에 탄창을 통째로 채운다 —
   * 샷건은 그 모양이 아니다. 그래서 그 파일을 고치는 대신 여기서 **감싸고**, 샷건일 때만 한 발짜리
   * 체인을 돌린다. 체인은 매 발마다 새 `state.reload` 레코드를 만든다: HUD 의 재장전 막대는
   * `hudEls.aFillFor !== r` 로 다시 그리므로, 레코드가 바뀌어야 막대가 한 발마다 다시 찬다.
   * 중간에 끊기면(무기 교체 · KO · restore) stopReload() 가 state.reload 를 비우고, 체인은 다음
   * 깨어남에서 `state.reload !== rec` 를 보고 조용히 멈춘다 — **그때까지 채운 발은 남는다.**
   */
  function sgShellStep(manual) {
    const id = 'shotgun', W = WEAPONS[id];
    const ms = scaleMs(debug.fastReload ? 30 : W.reloadMs);
    const rec = { id, startedAt: now(), ms, timer: 0, magTimer: 0, shell: true };
    state.reload = rec;
    sfx('shell');
    rec.timer = laterRaw(() => {
      rec.timer = 0;
      if (state.reload !== rec) return;
      state.reload = null;
      state.ammo[id] = Math.min(W.mag, (state.ammo[id] || 0) + 1);
      updateAmmoHud(); scheduleHud();
      if (state.active && state.ammo[id] < W.mag) sgShellStep(false);
      else syncScope();
    }, ms);
    updateAmmoHud();
    if (manual) toast(msg('toastReload') + '…');
  }

  /* ===================================================================== */
  /* wiring — every one of these is a WRAP, never a fork                     */
  /* ===================================================================== */

  /* §E 냉각총: "받는 피해 ×1.8." applyHit() is the ONE damage sink every weapon goes through (src/73), so
   * one wrapper covers hitscan, AoE, burn ticks, collision damage and anything added later. */
  const utApplyHitBase = applyHit;
  applyHit = function (el, dmg, kind, ix, iy, opts) {
    const m = fzMul(el);
    return utApplyHitBase(el, m === 1 ? dmg : Math.max(1, Math.round(dmg * m)), kind, ix, iy, opts);
  };
  /* §E 냉각총: "조각 수 ×2.5."
   * The wrap goes on fracPieceCount() (src/66-fracture.js), not on pieceCount() (src/70-break.js): breakElement()
   * asks fracPieceCount(), and that function barely uses pieceCount's answer — the DESTRUCTION shape decides the
   * count and `base` only caps it (§B1). Wrapping the inner one moved almost nothing, which is exactly what the
   * first measurement showed (6 pieces frozen, 6 pieces not).
   * `opts.pieces` (an explicit override: axe / katana / collapse / tests) is honoured by the base and must stay
   * honoured — a caller that asks for exactly n gets n, frozen or not.
   * INTERPRETATION (reported): 글자가 지배하는 요소는 단어 단위로 흩어지고(spawnWordPieces) 그 수는 단어
   * 수가 정한다 — 거기에 2.5 를 곱하면 단어를 쪼개야 한다. 그래서 ×2.5 는 **기하 분해**에만 걸린다. */
  const utFracPieceCountBase = fracPieceCount;
  fracPieceCount = function (el, mode, rect, descendants, opts) {
    const n = utFracPieceCountBase(el, mode, rect, descendants, opts);
    if ((opts && opts.pieces != null) || !fzIsFrozen(el)) return n;
    return Math.max(n + 1, Math.round(n * (WEAPONS.freezegun.pieceMul || 1)));
  };
  /* §E 냉각총: "적은 2초 정지." Same gate the tractor beam uses — the attack is RESCHEDULED, not dropped,
   * so the enemy picks straight back up when it thaws. */
  const utHostileAttackBase = hostileAttack;
  hostileAttack = function (rec, forced) {
    if (rec && rec.el && fzStunned(rec.el)) {
      try { scheduleAttack(rec, attackInterval(rec)); } catch (e) { /* ignore */ }
      return false;
    }
    return utHostileAttackBase(rec, forced);
  };
  /* §E 못총: a pinned piece is never woken — not by the eviction support pass, not by a resize. That is
   * the whole of "공중에서 멈춘다": the integrator skips resting pieces, and nothing un-rests this one. */
  const utWakePieceBase = wakePiece;
  wakePiece = function (p) {
    if (p && p.pinned) return;
    return utWakePieceBase(p);
  };
  /* §E 중력탄: the well rides the product's one frame loop. `busy` is OR-ed so an open well keeps the
   * loop awake by itself — a page with nothing else moving still gets its debris pulled in. */
  const utTickFrameBase = tickFrame;
  tickFrame = function (t) {
    let busy = utTickFrameBase(t);
    if (utWells.length) {
      const dt = utWellLastT ? clamp((t - utWellLastT) / 1000, 0, UT_WELL_STEP_CAP) : 0;
      if (gwStep(t, dt)) busy = true;
    }
    utWellLastT = t;
    return busy;
  };
  /* §E 샷건: 한 발씩 장전. Every other weapon falls straight through to the base. */
  const utStartReloadBase = startReload;
  startReload = function (id, manual) {
    if (id !== 'shotgun') return utStartReloadBase(id, manual);
    const W = WEAPONS.shotgun;
    if (!state.active || !W || state.reload) return false;
    if (state.ammo[id] >= W.mag) return false;
    scopeOff();
    sgShellStep(!!manual);
    return true;
  };
  /* §E 샷건: 한 발씩 장전은 **끊을 수 있어야** 뜻이 있다 — 두 발만 채우고 쏘는 것이 그 장전 방식의
   * 전부다. spend() 는 재장전 중이면 빈 클릭을 내므로, 샷건이고 쏠 탄이 한 발이라도 있으면 체인을
   * 먼저 멈춘다. 그때까지 채운 발은 남는다. 다른 무기는 그대로 base 로 떨어진다. */
  const utSpendBase = spend;
  spend = function (id) {
    if (id === 'shotgun' && isReloading(id) && state.ammo[id] > 0) stopReload();
    return utSpendBase(id);
  };
  /* restore() (Z / Escape / deactivate) must leave NOTHING of ours: no node, no timer, no borrowed
   * property, no pinned piece. It runs BEFORE the base so the base's own node sweep and piece sweep see an
   * already quiet module — and the frozen element's two inline properties go back while it is still the
   * element we saved them from. */
  const utRestoreBase = restore;
  restore = function () { utResetAll(); return utRestoreBase(); };
  function utResetAll() {
    utFrostClear();
    gwClear();
    for (const p of Array.from(utPinned)) pnUnpin(p);
    utPinned.clear();
    pnClearNails();
    if (root) {
      let leftovers = [];
      try { leftovers = root.querySelectorAll('.crs-frost, .crs-well, .crs-nail, .crs-pellet'); } catch (e) { leftovers = []; }
      for (const n of leftovers) { try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } }
    }
  }

  /* ---- debug surface (the suite is written against these) ------------------------------------------ */
  debug.frozenOf = (el) => {
    const rec = el && utFrozenEls.get(el);
    if (!rec) return null;
    let paused = '', trans = '';
    try { paused = el.style.getPropertyValue('animation-play-state') || ''; trans = el.style.getPropertyValue('transition') || ''; } catch (e) { /* ignore */ }
    return {
      level: Math.round(fzLevel(el)), frozen: fzIsFrozen(el), msLeft: Math.max(0, Math.round(rec.until - now())),
      stunMsLeft: Math.max(0, Math.round(rec.stunUntil - now())), mul: fzMul(el),
      owns: !!rec.owns, paused, transition: trans, saved: (rec.saved || []).map((s) => s.prop + '=' + s.value),
      frost: !!(rec.frostNode && rec.frostNode.isConnected)
    };
  };
  debug.freeze2 = (el, n, ms) => fzFreeze(el, n == null ? WEAPONS.freezegun.freezePerTick : +n, ms);
  debug.unfreeze = (el) => fzUnfreezeEl(el);
  debug.pins = () => ({
    pinned: pnPinnedCount(), tracked: utPinned.size,
    nails: root ? root.querySelectorAll('.crs-nail').length : 0,
    ids: state.pieces.filter((p) => p.pinned).map((p) => p.pid)
  });
  debug.pinAt = (x, y, r, max) => pnPinAt(+x, +y, r == null ? 0 : +r, max == null ? 0 : +max);
  /* §E "수명의 영향을 받지 않는다" 는 장부 위의 사실이다 — 박힌 조각은 만료 시각 두 개가 모두 0 이고,
   * debrisSweep() 은 `(p.expireAt && t >= p.expireAt) || (p.hardExpireAt && t >= p.hardExpireAt)` 로만
   * 거둬 간다. 그래서 그 두 숫자를 그대로 내보낸다. */
  debug.pieceLife = (pid) => {
    for (const p of state.pieces) {
      if (p.pid !== pid) continue;
      return { pid, pinned: !!p.pinned, resting: !!p.resting, expireAt: Math.round(p.expireAt || 0), hardExpireAt: Math.round(p.hardExpireAt || 0), alive: true };
    }
    return null;
  };
  debug.wells = () => utWells.map((w) => ({
    x: Math.round(w.x), y: Math.round(w.y), r: Math.round(w.R),
    msLeft: Math.max(0, Math.round(w.until - now())), pulled: w.pulled, orbs: w.orbs,
    node: !!(w.node && w.node.isConnected)
  }));
  debug.gravityAt = (x, y) => { const w = gwSpawn(+x, +y, 0, 0, 1); return { r: Math.round(w.R), msLeft: Math.max(0, Math.round(w.until - now())) }; };
  debug.utility = () => ({
    frozen: utFrozenEls.size, wells: utWells.length, pinned: pnPinnedCount(), nails: utNails.length,
    lastSpread: state.lastShotgunSpread || 0,
    frostTimer: !!utFrostTimer,
    frostNodes: root ? root.querySelectorAll('.crs-frost').length : 0,
    wellNodes: root ? root.querySelectorAll('.crs-well').length : 0
  });
  /* §E 의 네 수치를 제품이 직접 발행한다 — 표가 아니라 필드여야 검사가 된다. */
  debug.utConst = () => ({
    pellets: WEAPONS.shotgun.pellets, pelletCone: WEAPONS.shotgun.pelletCone, shellMs: WEAPONS.shotgun.reloadMs,
    shellReload: !!WEAPONS.shotgun.shellReload, slugDamage: WEAPONS.shotgun.slugDamage,
    pinRadius: WEAPONS.nailgun.pinRadius, pinMax: WEAPONS.nailgun.pinMax,
    freezeMul: WEAPONS.freezegun.freezeMul, pieceMul: WEAPONS.freezegun.pieceMul, stunMs: WEAPONS.freezegun.stunMs,
    freezePerTick: WEAPONS.freezegun.freezePerTick, frostMin: UT_FROST_MIN,
    wellMs: WEAPONS.gravity.wellMs, wellR: WEAPONS.gravity.radius, gravityDamage: WEAPONS.gravity.damage
  });
  /* §F4 · §F5: the band tool reads the SOURCE, the suite reads the PRODUCT, and this is where the two
   * meet — `debug.weaponBand()` (src/68-interaction.js) publishes the §F3 inputs and the wrap below adds
   * the three fields §F4/§F5 turned into table columns. Wrapped rather than edited: src/68 is not this
   * workstream's file. */
  const utWeaponBandBase = debug.weaponBand;
  debug.weaponBand = () => utWeaponBandBase().map((w) => {
    const W = WEAPONS[w.id];
    return Object.assign(w, {
      cat: W.cat || null, role: W.role || null, utility: W.utility || 0,
      pellets: W.pellets || 1, shellReload: !!W.shellReload,
      stabCooldownMs: W.stabCooldownMs || 0, spread: W.spread || 0
    });
  });
