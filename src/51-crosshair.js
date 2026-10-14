// ── SPEC-crosshair §A: the drawn crosshair · §B: fewer outlines · the one aim-side surface ──
  /* =====================================================================
   * 7b. Crosshair (SPEC-crosshair §A) + the §B marker policy
   *
   * Until now the aim point WAS the operating-system cursor image
   * (`cursor: url(hammer.svg)`), so it could not animate, could not say
   * which of the ten weapons was in hand, and could not answer "did that
   * hit?" where the eye already is. §A turns the OS cursor off and draws
   * the thing ourselves, in the glass root, under the scope layer.
   *
   * THE POINT OF THE WHOLE SECTION is §A3: the four arms are `6 + spreadNow
   * × 0.9` px from the centre, so every recoil kick and every bloom step the
   * v1.5 ledger already computes becomes something the player can SEE. The
   * crosshair is information, not decoration.
   *
   * USER-ORIGIN TRAP (CLAUDE.md): content.css is injected at USER origin, so
   * a `!important` there outranks both inline styles and Web Animations.
   * Everything this module writes or animates — the root `transform`, each
   * arm's `transform`/`height`, the ring's `background-image`, the health
   * bar's `width`, every `opacity` a hit marker touches — is declared in
   * content.css WITHOUT `!important`. The COLOUR goes the other way round:
   * it is published as the custom property `--crs-ch-c` from here and read
   * by `!important` declarations there, which is safe because a custom
   * property set inline is not what the `!important` is fighting.
   *
   * No RAF loop of its own (§A2): the position rides scheduleHover()'s
   * existing one-shot frame and tickFrame(), which this module wraps.
   * ===================================================================== */

  /* ── §A4: what each weapon's crosshair IS ──────────────────────────────
   * `arms` / `dot` / `armLen` drive the four §A3 arms; everything else is a
   * child of `.crs-ch-shape`. `radius` is NOT a number typed twice: it is
   * read from the weapon table below, so §A4's "이 반지름은 … 실제 폭발
   * 반경과 같아야 한다" is a link rather than a promise. */
  const CH_SHAPES = {
    hammer:   { arms: 0, dot: false, armLen: 0,  parts: [{ cls: 'crs-ch-arc', size: 30, w: 2, rot: -40 }] },
    pistol:   { arms: 4, dot: true,  armLen: 6,  parts: [] },
    smg:      { arms: 4, dot: false, armLen: 5,  parts: [] },
    sniper:   { arms: 4, dot: true,  armLen: 10, thin: true, hideScoped: true, parts: [] },
    axe:      { arms: 0, dot: false, armLen: 0,  parts: [{ cls: 'crs-ch-arc crs-ch-arc-fat', size: 46, w: 4, rot: -55 }] },
    katana:   { arms: 0, dot: false, armLen: 0,  parts: [{ cls: 'crs-ch-slash', size: 34, w: 2, rot: -45 }] },
    bomb:     { arms: 4, dot: false, armLen: 6,  blast: true, parts: [] },
    rocket:   { arms: 4, dot: false, armLen: 6,  blast: true, corners: 14, parts: [] },
    flame:    { arms: 0, dot: false, armLen: 0,  cone: true, parts: [] },
    collapse: { arms: 0, dot: false, armLen: 0,  corners: 26, parts: [] }
  };
  /* §A9 `crosshair`: auto (the table above) / cross / dot / circle / off. The three explicit shapes are
   * deliberately plain — someone who picks one is asking for LESS, not for a different weapon language. */
  const CH_FIXED = {
    cross:  { arms: 4, dot: false, armLen: 7, parts: [] },
    dot:    { arms: 0, dot: true,  armLen: 0, parts: [] },
    circle: { arms: 0, dot: false, armLen: 0, parts: [{ cls: 'crs-ch-circle', size: 18, w: 2, rot: 0 }] }
  };
  const CH_COLORS = { white: '#ffffff', green: '#3fb950', cyan: '#4ad8e6', magenta: '#ff6ad5' };
  const CH_DIM = 'rgba(255, 255, 255, .35)';
  const CH_HOSTILE = '#e5484d';
  const CH_GAP_BASE = 6;             // §A3: gap = 6 + spreadNow × 0.9
  const CH_GAP_PER_SPREAD = 0.9;
  const CH_MOVE_GAP = 4;             // §A3: +4 px while the survival drone is moving
  /* The three offsets §A/§B give in pixels — the health bar 14 px under the centre (§B2), the ▼ hint
   * 10 px under it (§A8) and the 26 px readiness ring (§A7) — are pure geometry nothing here measures,
   * so they live ONCE, in content.css, rather than as constants that could drift from the rules. */
  const CH_HINT_MS = 150;            // the cover test is a pickTarget sweep: recomputed at most this often
  /* §A6 hit markers: shape is the class, colour and duration are here. 빗나감 has no entry — no mark at all. */
  const CH_HITS = {
    hit:   { color: '#ffffff', ms: 120 },
    crit:  { color: '#ffd166', ms: 160 },
    kill:  { color: '#e5484d', ms: 200 },
    block: { color: '#3fb950', ms: 240 }
  };
  const CH_KEYS = ['crosshair', 'crosshairColor', 'crosshairScale', 'hitmarker', 'crosshairSpread',
    'showHpNumber', 'targetMarker', 'hostileMarker', 'highContrastMarkers', 'viewmodelScale'];

  const xhair = {
    node: null, arms: [], dot: null, ring: null, dash: null, shape: null, hit: null, hitLines: [], hitRing: null,
    hint: null, hpNum: null,
    sig: '', state: '', color: '', gap: -1, armLen: -1, x: -1, y: -1, shown: false, pulse: null, pulseOn: false,
    ringOn: false, ringKind: '', hintAt: 0, hintText: '', hintBright: false, radius: 0, shapeKind: '', hpMax: 0, hpNow: 0
  };

  /* ---- settings (every one of them §A9 / §B4) ---------------------------------------------------- */
  function chMode() { const v = settingsGet('crosshair'); return v || 'auto'; }
  function chScale() { const v = +settingsGet('crosshairScale'); return isFinite(v) && v > 0 ? v : 1; }
  function chUserColor() { return CH_COLORS[settingsGet('crosshairColor')] || CH_COLORS.white; }
  function chSpreadOn() { return settingsGet('crosshairSpread') !== false; }
  function chHitmarkerOn() { return settingsGet('hitmarker') !== false; }
  function chHpNumberOn() { return settingsGet('showHpNumber') === true; }
  /* §B4: 고대비 표식이 켜져 있으면 두 설정이 자동으로 올라간다 — the accessibility switch WINS over the
   * quiet defaults, because someone who asked for high contrast asked for the loud markers on purpose. */
  function chHighContrast() { return settingBool('highContrastMarkers'); }
  function targetMarkerMode() { return chHighContrast() ? 'full' : (settingsGet('targetMarker') || 'brackets'); }
  function hostileMarkerMode() { return chHighContrast() ? 'always' : (settingsGet('hostileMarker') || 'quiet'); }

  /* ---- the shape in force ------------------------------------------------------------------------ */
  function chShapeFor(id) {
    const mode = chMode();
    if (CH_FIXED[mode]) return CH_FIXED[mode];
    return CH_SHAPES[id] || CH_SHAPES.pistol;
  }
  /* §A4: 폭탄 240 / 로켓 360 — the dashed circle is the weapon's OWN radius, never a second copy of it. */
  function chBlastRadius(id) {
    const W = WEAPONS[id];
    const r = W ? W.radius : 0;
    return (isFinite(r) && r > 0) ? r : 0;
  }

  /* ---- build / teardown -------------------------------------------------------------------------- */
  function buildCrosshair() {
    clearCrosshair();
    const n = mk('div', 'crs-crosshair');
    xhair.arms = [];
    for (let i = 0; i < 4; i++) { const a = mk('div', 'crs-ch-arm'); n.append(a); xhair.arms.push(a); }
    xhair.dot = mk('div', 'crs-ch-dot');
    xhair.ring = mk('div', 'crs-ch-ring');
    xhair.dash = mk('div', 'crs-ch-dash');
    xhair.shape = mk('div', 'crs-ch-shape');
    xhair.hint = mk('span', 'crs-ch-hint');
    n.append(xhair.dot, xhair.ring, xhair.dash, xhair.shape, xhair.hint);
    /* §A6: the marker node exists only when the setting allows one, so `hitmarker: false` is "no node",
     * not "a node that never animates" — a count is a far harder assertion than an opacity. */
    if (chHitmarkerOn()) {
      xhair.hit = mk('div', 'crs-ch-hit');
      xhair.hitLines = [];
      for (let i = 0; i < 4; i++) { const l = mk('span', 'crs-ch-hit-line'); xhair.hit.append(l); xhair.hitLines.push(l); }
      xhair.hitRing = mk('div', 'crs-ch-hit-ring');
      xhair.hit.append(xhair.hitRing);
      n.append(xhair.hit);
    }
    /* §B2: the health bar is the hover target's, but it is drawn HERE — "체력 표시를 요소에서 떼어
     * 조준점 아래로 옮기고". The very same two nodes mountHosts() built inside `.crs-target` are
     * re-parented rather than rebuilt, so `targetFill` (and critFlashFill(), which animates it) keeps
     * pointing at the live bar and src/25-layers.js needs no edit at all. */
    if (targetBar) {
      try {
        targetBar.classList.add('crs-ch-hp');
        if (targetFill) targetFill.classList.add('crs-ch-hp-fill');
        n.append(targetBar);
      } catch (e) { /* ignore */ }
    }
    xhair.hpNum = mk('span', 'crs-ch-hpnum');
    n.append(xhair.hpNum);
    n.style.transform = 'translate3d(-9999px, -9999px, 0)';
    try { root.append(n); } catch (e) { /* ignore */ }
    xhair.node = n;
    xhair.sig = ''; xhair.state = ''; xhair.gap = -1; xhair.armLen = -1; xhair.shown = false;
    xhair.ringOn = false; xhair.ringKind = ''; xhair.hintAt = 0; xhair.hintText = ''; xhair.shapeKind = '';
    return n;
  }
  function chSetPulse(on) {
    if (on === xhair.pulseOn && (!on || (xhair.pulse && xhair.pulse.playState === 'running'))) return;
    xhair.pulseOn = on;
    if (xhair.pulse) { try { xhair.pulse.cancel(); } catch (e) { /* ignore */ } state.anims.delete(xhair.pulse); xhair.pulse = null; }
    if (!on || reducedMotion() || !xhair.node) return;   // SPEC-settings §3.1: reduced motion keeps the colour, drops the beat
    /* §A5: 락온 중인 적 위 — 0.25초 주기 맥동. "여기를 쏘면 끊긴다"는 신호다. */
    try { xhair.pulse = trackAnim(xhair.node.animate([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], { duration: 250, iterations: Infinity })); } catch (e) { xhair.pulse = null; }
  }
  function clearCrosshair() {
    chSetPulse(false);
    const n = xhair.node;
    xhair.node = null; xhair.arms = []; xhair.dot = null; xhair.ring = null; xhair.dash = null;
    xhair.shape = null; xhair.hit = null; xhair.hitLines = []; xhair.hitRing = null; xhair.hint = null; xhair.hpNum = null;
    xhair.sig = ''; xhair.state = ''; xhair.shown = false; xhair.gap = -1; xhair.armLen = -1; xhair.shapeKind = '';
    /* The health bar belongs to `.crs-target` when there is no crosshair to hang it under — put it back
     * before the node goes, or `crosshair: 'off'` would destroy it along with the drawing. */
    if (targetBar && targetBox) {
      try { targetBar.classList.remove('crs-ch-hp'); if (targetFill) targetFill.classList.remove('crs-ch-hp-fill'); targetBox.append(targetBar); } catch (e) { /* ignore */ }
    }
    if (n) { try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } }
    chSyncCursor();
  }
  /* §A2 / §A9: `cursor: none` rides a class on <html>, and `off` takes the class away so the operating
   * system cursor comes back — "접근성과 취향 양쪽을 위해 필요하다". The class is OURS, so it is removed
   * with everything else on deactivate (see the wrapper at the bottom of this module). */
  function chSyncCursor() {
    try { docEl.classList.toggle('crs-aim', !!(state.active && xhair.node && xhair.node.isConnected)); } catch (e) { /* ignore */ }
  }
  function chEnabled() { return !!(state.active && root && chMode() !== 'off'); }
  function ensureCrosshair() {
    if (!chEnabled()) { if (xhair.node) clearCrosshair(); return null; }
    if (!xhair.node || !xhair.node.isConnected) buildCrosshair();
    chSyncShape();
    chSyncCursor();
    /* The arms, the state colour and the centre dot are written by placeCrosshair(), which otherwise only
     * runs on a pointer frame or a physics frame. A weapon switch, a settings write or a mode change can
     * all happen with the mouse standing perfectly still — and without this line the crosshair would keep
     * the PREVIOUS weapon's arm length and the previous target's colour until something moved. */
    placeCrosshair();
    return xhair.node;
  }

  /* ---- §A4 per-weapon composition --------------------------------------------------------------- */
  function chSyncShape() {
    const id = state.weapon, sh = chShapeFor(id), sc = chScale();
    const radius = sh.blast ? chBlastRadius(id) : 0;
    const sig = chMode() + '|' + id + '|' + sc + '|' + radius;
    if (xhair.sig === sig) return;
    xhair.sig = sig;
    xhair.radius = radius;
    xhair.shapeKind = CH_FIXED[chMode()] ? chMode() : id;
    const shape = xhair.shape;
    if (!shape) return;
    try { while (shape.firstChild) shape.removeChild(shape.firstChild); } catch (e) { /* ignore */ }
    for (const p of sh.parts || []) {
      const n = mk('div', p.cls);
      n.style.width = px(p.size * sc);
      n.style.height = px((p.cls.indexOf('crs-ch-slash') === 0 ? p.w : p.size) * sc);
      n.style.transform = 'translate(-50%, -50%) rotate(' + p.rot + 'deg)';
      shape.append(n);
    }
    /* §A4 폭탄·로켓: 반지름 = 실제 폭발 반경. opacity .35 lives in content.css — a solid circle following
     * the cursor is exactly the kind of noise §B is here to remove. */
    if (radius > 0) {
      const c = mk('div', 'crs-ch-blast');
      c.style.width = px(2 * radius); c.style.height = px(2 * radius);
      c.style.transform = 'translate(-50%, -50%)';
      shape.append(c);
    }
    if (sh.corners) {
      for (let i = 0; i < 4; i++) {
        const b = mk('div', 'crs-ch-corner crs-ch-corner-' + i);
        const d = sh.corners * sc;
        b.style.width = px(Math.max(8, d * 0.45)); b.style.height = px(Math.max(8, d * 0.45));
        b.style.transform = 'translate(' + px(i % 2 ? d : -d - Math.max(8, d * 0.45)) + ', ' + px(i < 2 ? -d - Math.max(8, d * 0.45) : d) + ')';
        shape.append(b);
      }
    }
    /* §A4 화염방사기: 벌어진 원뿔 2선. The half-angle is written per frame by chPlaceCone() — bloom is
     * what opens it, so this is the one shape whose geometry is live. */
    if (sh.cone) {
      for (let i = 0; i < 2; i++) { const l = mk('div', 'crs-ch-cone'); l.style.height = px(2); l.style.width = px(26 * sc); shape.append(l); }
    }
    try { xhair.node.classList.toggle('crs-ch-thin', !!sh.thin); } catch (e) { /* ignore */ }
    xhair.gap = -1; xhair.armLen = -1;   // force the arms to be rewritten on the next frame
  }

  /* ---- §A3 산포 연동 — the core of the whole section --------------------------------------------- */
  function chSpreadNow() {
    if (!chSpreadOn()) return 0;
    const s = spreadNow(state.weapon);
    return isFinite(s) && s > 0 ? s : 0;
  }
  function chGap() {
    let g = CH_GAP_BASE + chSpreadNow() * CH_GAP_PER_SPREAD;
    // §A3: 서바이벌에서 드론이 움직이는 동안 +4px — moving costs accuracy, and the crosshair says so
    if (chSpreadOn() && modeHasAvatar() && avatarMoving()) g += CH_MOVE_GAP;
    return g * chScale();
  }
  function chPlaceArms() {
    const sh = chShapeFor(state.weapon), sc = chScale();
    const gap = chGap(), len = (sh.armLen || 0) * sc;
    if (Math.abs(gap - xhair.gap) < 0.2 && Math.abs(len - xhair.armLen) < 0.2) return;
    xhair.gap = gap; xhair.armLen = len;
    const on = (sh.arms || 0) > 0 && len > 0;
    for (let i = 0; i < xhair.arms.length; i++) {
      const a = xhair.arms[i];
      if (!on) { a.style.height = '0px'; a.style.transform = 'translate(-50%, -50%) scale(0)'; continue; }
      a.style.height = px(len);
      a.style.transform = 'translate(-50%, -50%) rotate(' + (i * 90) + 'deg) translateY(' + px(-(gap + len / 2)) + ')';
    }
  }
  function chPlaceCone() {
    const sh = chShapeFor(state.weapon);
    if (!sh.cone || !xhair.shape) return;
    const lines = xhair.shape.querySelectorAll('.crs-ch-cone');
    if (lines.length < 2) return;
    // bloom opens the cone: 14° at rest, up to 38° with the flamer's 30 px of bloom behind it
    const half = 14 + clamp(chSpreadNow(), 0, 30) * 0.8;
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? -1 : 1;
      lines[i].style.transform = 'translate(-50%, -50%) rotate(' + (sgn * half).toFixed(2) + 'deg) translateX(' + px(13 * chScale()) + ')';
    }
  }

  /* ---- §A5 state colours -------------------------------------------------------------------------- */
  /* The one question every colour below answers: can I shoot THIS, right now?
   *   hostile / lock — yes, and the lock says shooting it also cancels the shot aimed at you
   *   ok             — yes (rampage: anything destructible)
   *   dim            — no: invulnerable, the HUD, or empty page. §A5 also takes the centre dot away,
   *                    because a dot over something you cannot hurt is a lie about where the shot goes. */
  function chStateNow() {
    if (!state.active) return 'dim';
    if (state.overHud || state.ko || state.hoverX < 0) return 'dim';
    const el = state.hoverEl;
    /* aimInvulnerable() (src/91-combat-feedback.js) is SPEC-combat §B1's own question — "is the thing
     * under the pointer something I cannot hurt?" — and it is deliberately not re-implemented here: the
     * aim-side warning and the damage rule have to agree by construction, not by coincidence. */
    if (modeHasEnemies() && !debug.noInvuln) {
      if (aimInvulnerable()) return 'dim';
      const rec = state.hostiles.get(el);
      return (rec && rec.lock) ? 'lock' : 'hostile';
    }
    return el ? 'ok' : 'dim';
  }
  function chColorFor(st) {
    if (st === 'dim') return CH_DIM;
    if (st === 'hostile' || st === 'lock') return CH_HOSTILE;
    return chUserColor();
  }
  function chApplyState() {
    const n = xhair.node;
    if (!n) return;
    const st = chStateNow();
    const col = chColorFor(st);
    /* The COLOUR is tracked beside the state, not derived from it: `crosshairColor` (§A9) changes the
     * colour with the state standing still, and keying the write on the state alone left a green
     * crosshair white until the player happened to aim at something else. */
    if (st !== xhair.state || col !== xhair.color) {
      xhair.state = st; xhair.color = col;
      try {
        n.classList.toggle('crs-ch-dim', st === 'dim');
        n.classList.toggle('crs-ch-hostile', st === 'hostile' || st === 'lock');
        n.classList.toggle('crs-ch-lock', st === 'lock');
        n.style.setProperty('--crs-ch-c', col);
      } catch (e) { /* ignore */ }
    }
    const sh = chShapeFor(state.weapon);
    const wantDot = !!sh.dot && st !== 'dim';
    try { n.classList.toggle('crs-ch-nodot', !wantDot); } catch (e) { /* ignore */ }
    chSetPulse(st === 'lock');
  }

  /* ---- §A7 the readiness ring --------------------------------------------------------------------- */
  /* 쿨다운은 0→1 로 채워지고, 재장전은 #e3b341, 교체는 흰색 40%. "탄약 HUD 를 안 봐도 언제 쏠 수 있는지
   * 안다" — which is the whole reason it is drawn at the aim point and not on the panel. */
  function chRingNow(t) {
    const id = state.weapon, W = WEAPONS[id];
    const r = state.reload;
    if (r && r.id === id && r.ms > 0) return { kind: 'reload', p: clamp((t - r.startedAt) / r.ms, 0, 1), color: '#e3b341' };
    if (swapActive()) {
      const total = Math.max(1, scaleMs(swapMsOf(id)));
      return { kind: 'swap', p: clamp(1 - (state.swapUntil - t) / total, 0, 1), color: 'rgba(255, 255, 255, .4)' };
    }
    if (onCooldown() && W && W.cooldownMs > 0) {
      const total = Math.max(1, scaleMs(W.cooldownMs));
      return { kind: 'cooldown', p: clamp(1 - (state.cooldownUntil - t) / total, 0, 1), color: chColorFor(xhair.state || 'ok') };
    }
    return null;
  }
  function chSyncRing(t) {
    const ring = xhair.ring;
    if (!ring) return false;
    const rs = chRingNow(t);
    if (!rs) {
      if (xhair.ringOn) { xhair.ringOn = false; xhair.ringKind = ''; try { xhair.node.classList.remove('crs-ch-busy'); ring.classList.remove('crs-ch-ring-on'); } catch (e) { /* ignore */ } }
      return false;
    }
    if (!xhair.ringOn) { xhair.ringOn = true; try { xhair.node.classList.add('crs-ch-busy'); ring.classList.add('crs-ch-ring-on'); } catch (e) { /* ignore */ } }
    xhair.ringKind = rs.kind;
    const deg = (clamp(rs.p, 0, 1) * 360).toFixed(2);
    try {
      ring.style.backgroundImage = 'conic-gradient(from 0deg, ' + rs.color + ' 0deg, ' + rs.color + ' ' + deg + 'deg, rgba(255,255,255,.14) ' + deg + 'deg, rgba(255,255,255,.14) 360deg)';
    } catch (e) { /* ignore */ }
    return true;
  }
  /* §A7 마지막 줄: 대시 쿨다운(서바이벌)은 링 바깥의 작은 점. */
  function chSyncDash() {
    const d = xhair.dash;
    if (!d) return;
    try {
      const on = modeHasAvatar();
      d.classList.toggle('crs-ch-dash-on', on);
      if (on) d.classList.toggle('crs-ch-dash-ready', now() >= state.dashReadyAt);
    } catch (e) { /* ignore */ }
  }

  /* ---- §A8 depth / pierce hint -------------------------------------------------------------------- */
  /* 커서 아래 요소가 적대 요소를 가리고 있을 때만. The test is the honest one — what pickTarget() says is
   * really under the point (noLock: the PAGE answer, not the fight's) — and it is a rect sweep, so it is
   * recomputed at most every CH_HINT_MS rather than every frame. */
  function chHintNow() {
    if (!modeHasEnemies() || state.hoverX < 0 || state.overHud) return null;
    const W = WEAPONS[state.weapon];
    if (W && W.kind === 'bomb') return null;   // §A8: 폭발 무기면 범위가 엄폐를 무시하므로 표시하지 않는다
    let el = null;
    try { el = pickTarget(state.hoverX, state.hoverY, null, { noLock: true }); } catch (e) { el = null; }
    if (!el || hostileUnit(el)) return null;
    if (!hostilesBehind(el)) return null;
    const n = pierceOf(state.weapon);
    return n > 0 ? { text: '▼' + n, bright: true } : { text: '▼', bright: false };
  }
  function chSyncHint(t) {
    const h = xhair.hint;
    if (!h) return;
    if (t - xhair.hintAt < CH_HINT_MS) return;
    xhair.hintAt = t;
    const info = chHintNow();
    const text = info ? info.text : '';
    const bright = !!(info && info.bright);
    if (text === xhair.hintText && bright === xhair.hintBright) return;
    xhair.hintText = text; xhair.hintBright = bright;
    try {
      h.textContent = text;
      h.classList.toggle('crs-ch-hint-on', !!text);
      h.classList.toggle('crs-ch-hint-bright', bright);
    } catch (e) { /* ignore */ }
  }

  /* ---- §B2 the health bar under the crosshair ----------------------------------------------------- */
  /* barW = clamp(round(20 + √maxHp × 6), 24, 140). 제곱근을 쓰는 이유는 최대 체력 자체가 면적의 제곱근에
   * 비례하기 때문이고, 그래서 바 길이가 결국 요소의 한 변 길이에 대략 비례한다 — 큰 걸 겨누면 바도 길다. */
  function chBarWidth(maxHp) {
    return clamp(Math.round(20 + Math.sqrt(Math.max(0, maxHp)) * 6), 24, 140);
  }
  function chSetHp(rec) {
    const bar = targetBar, fill = targetFill;
    if (!bar) return;
    if (!rec) {
      try { bar.classList.remove('crs-ch-hp-on'); } catch (e) { /* ignore */ }
      if (xhair.hpNum) { try { xhair.hpNum.textContent = ''; xhair.hpNum.classList.remove('crs-ch-hpnum-on'); } catch (e) { /* ignore */ } }
      return;
    }
    const hp = Math.max(0, rec.hp), max = Math.max(1, rec.max);
    const ratio = clamp(hp / max, 0, 1);
    xhair.hpMax = max; xhair.hpNow = hp;   // what the bar was actually drawn from (debug.crosshair().hp)
    /* `crosshair: 'off'` leaves the bar where v1.1 had it — on the element, under the label — because the
     * place §B2 moves it to does not exist then. The fill is written either way; only the §B2 geometry
     * (length = max HP, centred, quiet while unhurt) belongs to the crosshair version. */
    const underCrosshair = !!(xhair.node && bar.parentNode === xhair.node);
    try {
      bar.classList.toggle('crs-ch-hp-on', underCrosshair);
      if (underCrosshair) {
        bar.style.width = px(chBarWidth(max));
        bar.style.marginLeft = px(-chBarWidth(max) / 2);
        /* §B2: 상처가 없으면 조용하다 — 불투명도 40%, 피해를 입으면 100%. */
        bar.style.opacity = hp >= max ? '0.4' : '1';
      }
      /* SPEC-combat §C4: an approximated max used to wear a `~` on the number. The number is gone by
       * default now (§B2), so the uncertainty moves onto the BAR, which is the readout: a dashed right
       * edge says "this end is an estimate". The tilde comes back with the number under showHpNumber. */
      bar.classList.toggle('crs-ch-hp-approx', !!rec.approx);
      if (fill) { fill.style.width = (100 * ratio).toFixed(1) + '%'; fill.style.background = fillColor(ratio); }
    } catch (e) { /* ignore */ }
    if (xhair.hpNum) {
      try {
        const want = chHpNumberOn() ? (hp + '/' + rec.max + (rec.approx ? '~' : '')) : '';
        if (xhair.hpNum.textContent !== want) xhair.hpNum.textContent = want;
        xhair.hpNum.classList.toggle('crs-ch-hpnum-on', !!want);
      } catch (e) { /* ignore */ }
    }
  }

  /* ---- §A6 hit markers ---------------------------------------------------------------------------- */
  /* 사격이 피해를 입혔을 때 조준점 중앙에 짧게. 시선이 이미 거기 있으므로 가장 빠른 피드백이다.
   * One node, reused: 연사 중에는 같은 노드를 재사용하고 애니메이션을 재시작한다. */
  function chHitMarker(kind) {
    const def = CH_HITS[kind];
    const n = xhair.hit;
    if (!def || !n || !xhair.node || !xhair.node.isConnected || !xhair.shown) return false;
    const rm = reducedMotion();
    try {
      n.classList.remove('crs-ch-hit-hit', 'crs-ch-hit-crit', 'crs-ch-hit-kill', 'crs-ch-hit-block');
      n.classList.add('crs-ch-hit-' + kind);
      n.style.setProperty('--crs-ch-hit-c', def.color);
      cancelAnimsOf(n);
      for (const l of xhair.hitLines) cancelAnimsOf(l);
      if (xhair.hitRing) cancelAnimsOf(xhair.hitRing);
      /* SPEC-settings §3.1 / SPEC-crosshair §D: 모션 축소에서는 확대가 없고 색 변화만 남는다. */
      const frames = rm
        ? [{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }]
        : [{ opacity: 1, transform: 'scale(.75)' }, { opacity: 1, transform: 'scale(1.1)', offset: 0.45 }, { opacity: 0, transform: 'scale(1.25)' }];
      trackAnim(n.animate(frames, { duration: def.ms, easing: 'ease-out', fill: 'none' }));
      // 파괴: X + 수축하는 원 · 락온 차단: 네 괄호가 바깥으로 튕김
      if (xhair.hitRing && !rm) {
        if (kind === 'kill') trackAnim(xhair.hitRing.animate([{ transform: 'translate(-50%, -50%) scale(1.8)', opacity: .9 }, { transform: 'translate(-50%, -50%) scale(.35)', opacity: 0 }], { duration: def.ms, easing: 'ease-out', fill: 'none' }));
        else if (kind === 'crit') trackAnim(xhair.hitRing.animate([{ transform: 'translate(-50%, -50%) scale(.9)', opacity: .95 }, { transform: 'translate(-50%, -50%) scale(1.35)', opacity: 0 }], { duration: def.ms, easing: 'ease-out', fill: 'none' }));
      }
      if (kind === 'block' && !rm) {
        for (let i = 0; i < xhair.hitLines.length; i++) {
          const l = xhair.hitLines[i];
          const base = 'translate(-50%, -50%) rotate(' + (45 + i * 90) + 'deg) ';
          trackAnim(l.animate([{ transform: base + 'translateY(-9px)' }, { transform: base + 'translateY(-26px)' }], { duration: def.ms, easing: 'ease-out', fill: 'none' }));
        }
      }
    } catch (e) { return false; }
    return true;
  }

  /* ---- placement (§A2: no loop of its own) -------------------------------------------------------- */
  function chWantShown() {
    if (!xhair.node) return false;
    if (state.hoverX < 0 || state.hoverY < 0) return false;
    if (state.overHud) return false;          // §A2: HUD 위에서는 조준점을 숨기고 기본 커서를 되살린다
    if (state.ko) return false;
    const sh = chShapeFor(state.weapon);
    if (state.scoped && sh.hideScoped) return false;   // §A4 저격총: 조준 중에는 조준경 화면이 대신한다
    if (state.scoped) return false;
    return true;
  }
  function placeCrosshair() {
    const n = xhair.node;
    if (!n || !n.isConnected) return;
    const show = chWantShown();
    if (show !== xhair.shown) {
      xhair.shown = show;
      try { n.classList.toggle('crs-ch-hidden', !show); } catch (e) { /* ignore */ }
      if (!show) chSetPulse(false);
    }
    /* The state is resolved even while the crosshair is HIDDEN. §A5 says the HUD reads grey, and §A2 says
     * it is hidden there — both at once — so a hidden crosshair that kept the colour of whatever was
     * under the pointer a moment ago would be reporting the wrong answer to anything that asks. */
    chApplyState();
    if (!show) return;
    const x = state.hoverX, y = state.hoverY;
    if (x !== xhair.x || y !== xhair.y) {
      xhair.x = x; xhair.y = y;
      try { n.style.transform = 'translate3d(' + px(x) + ', ' + px(y) + ', 0)'; } catch (e) { /* ignore */ }
    }
    chPlaceArms();
    chPlaceCone();
  }
  /* Called by refreshHover() (src/50-target.js) — the one place that already knows the hover changed. */
  function crosshairHover() {
    if (!ensureCrosshair()) return;
    placeCrosshair();
    chSyncDash();
    chSyncHint(now());
  }
  /* The per-frame half, folded into tickFrame() by the wrapper below. Returns `busy`: true only while
   * something is actually moving (a recoil kick or bloom decaying, a cooldown / reload / swap ring
   * filling), never merely because a crosshair exists — an idle crosshair must cost zero frames. */
  function crosshairStep(t) {
    const n = xhair.node;
    if (!n || !n.isConnected) return false;
    placeCrosshair();
    const ringBusy = chSyncRing(t);
    chSyncDash();
    chSyncHint(t);
    auraPulseSync();   // §B3: the beat belongs to the outline, and four modules can turn that outline on
    const kick = recoilKickNow(t), bloom = bloomNow(t);
    return !!(ringBusy || kick > 0.05 || bloom > 0.05);
  }

  /* ---- §B2 the hover bracket ---------------------------------------------------------------------- */
  /* 전체를 두르는 2px 실선을 없앤다. 네 모서리에 10px 'ㄱ'자 괄호 4개만, 흰색 55%, 바깥으로 2px.
   * The brackets are built once, lazily, and then only MOVED: "이동할 때 괄호는 위치만 옮기고 다시
   * 나타나는 애니메이션을 하지 않는다. 깜빡임이 피로의 원인이다." */
  function ensureBrackets() {
    if (!targetBox) return null;
    let list = targetBox.__crsBrackets;
    if (list && list.length === 4 && list[0].isConnected) return list;
    list = [];
    for (let i = 0; i < 4; i++) {
      const b = mk('div', 'crs-tb crs-tb-' + i);
      targetBox.append(b);
      list.push(b);
    }
    targetBox.__crsBrackets = list;
    return list;
  }
  function dropBrackets() {
    const list = targetBox && targetBox.__crsBrackets;
    if (!list) return;
    targetBox.__crsBrackets = null;
    for (const b of list) { try { cancelAnimsOf(b); b.remove(); } catch (e) { /* ignore */ } }
  }
  function syncTargetMarker() {
    if (!targetBox) return;
    const mode = targetMarkerMode();
    try {
      targetBox.classList.toggle('crs-target-brackets', mode === 'brackets');
      targetBox.classList.toggle('crs-target-full', mode === 'full');
      targetBox.classList.toggle('crs-target-off', mode === 'off');
    } catch (e) { /* ignore */ }
    // §B4 `off` means no marker AT ALL — the nodes go, rather than being left behind invisible.
    if (mode === 'off') dropBrackets(); else ensureBrackets();
  }

  /* ---- §B3 the hostile aura ----------------------------------------------------------------------- */
  /* 평상시: 실선 테두리를 없앤다 — inset glow + the small label only, and no pulse either. 공격 준비에
   * 들어갈 때만 2px 실선과 맥동이 켜진다. "조용히 있다가 행동할 때 소리친다."
   *
   * The LOUD set is expressed as classes that already exist and are already toggled by the code that owns
   * each behaviour: `crs-aimed` (a wind-up aim line, src/91), `crs-lock-imminent` (src/93), `crs-lunging`
   * (§D5 charge, src/88) and `crs-repairing` (src/94 — §B3: 복구 빔을 쏘는 동안에도 켠다). So §B3 needed
   * no new state anywhere: content.css gives the outline to those four, and this wrapper is only here to
   * stop the IDLE pulse that setAuraPulse() used to start unconditionally.
   *
   * AMBIGUITY, reading chosen — §B3 gives two inset strengths, .30 평상시 and .42 전투 모드. An aura only
   * ever exists in a combat mode (markHostile() runs nowhere else), so the two can never be observed
   * apart: content.css carries the .42 and the .30 is recorded here as the number it would have been had
   * rampage ever grown enemies. */
  function auraLoud(rec) {
    const a = rec && rec.aura;
    if (!a) return false;
    try { return a.classList.contains('crs-aimed') || a.classList.contains('crs-lock-imminent') || a.classList.contains('crs-lunging') || a.classList.contains('crs-repairing'); } catch (e) { return false; }
  }
  const setAuraPulseChBase = setAuraPulse;
  setAuraPulse = function (rec, ms) {
    if (!rec) return;
    if (!auraLoud(rec)) {
      // §B3: 맥동도 없앤다. A quiet enemy is a still one; the beat is reserved for "지금 나를 해치려는 것".
      if (rec.pulse) { try { rec.pulse.cancel(); } catch (e) { /* ignore */ } state.anims.delete(rec.pulse); rec.pulse = null; }
      try { rec.aura.style.opacity = '1'; } catch (e) { /* ignore */ }
      return;
    }
    setAuraPulseChBase(rec, ms);
  };
  /* The loud classes are added and removed by four different modules; each of them already calls one of
   * these two, so re-running the pulse decision here is enough to keep the beat in step with the outline. */
  function auraSync(rec) {
    if (!rec || !rec.aura || !state.hostiles.size) return;
    placeAura(rec);        // carries the §B4 `hostileMarker: 'off'` class (see the wrapper below)
    setAuraPulse(rec, 900);
  }
  function auraSyncAll() { for (const rec of state.hostiles.values()) auraSync(rec); }
  /* The four loud classes are added by four different modules and only two of them (the aim line and the
   * §D5 charge) pass through setAuraPulse() on the way. Rather than wrap all four, the beat is brought
   * back into step on the frames the loop is already awake for — a classList read per live enemy, at most
   * seven of them, and only when the state actually disagrees (setAuraPulse RESTARTS the animation, so
   * calling it unconditionally would reset the phase every frame). Reduced motion has no pulses at all
   * (src/96-a11y.js), so there is nothing to keep in step there. */
  function auraPulseSync() {
    if (!state.hostiles.size || reducedMotion()) return;
    for (const rec of state.hostiles.values()) {
      const want = auraLoud(rec);
      const have = !!(rec.pulse && rec.pulse.playState === 'running');
      if (want !== have) setAuraPulse(rec, 900);
    }
  }
  /* §B4 `hostileMarker`: quiet (default) / always / off. The first two are the §B3 rules above — an
   * aura is quiet until it acts — so only `off` needs a switch, and it hangs off placeAura() because
   * that is the one call every aura passes through on every frame it is re-measured, reduced motion
   * included (src/96-a11y.js short-circuits setAuraPulse() there, so this could not live in it). */
  const placeAuraChBase = placeAura;
  placeAura = function (rec) {
    placeAuraChBase(rec);
    if (!rec || !rec.aura) return;
    const off = hostileMarkerMode() === 'off';
    if (rec.chOff === off) return;
    rec.chOff = off;
    try { rec.aura.classList.toggle('crs-hostile-off', off); } catch (e) { /* ignore */ }
  };

  /* ---- wiring ------------------------------------------------------------------------------------- */
  /* Every hook below wraps a binding instead of editing the module that owns it: the bundle is ONE
   * closure and a function declaration's binding is writable, which is how src/46 and src/71 already
   * reach into src/45 and src/65. */
  const tickFrameChBase = tickFrame;
  tickFrame = function (t) {
    let busy = tickFrameChBase(t);
    try { if (crosshairStep(t)) busy = true; } catch (e) { state.lastError = String((e && e.stack) || e); }
    return busy;
  };
  /* §A6: the hit marker rides the ONE damage sink, so every weapon — click, hold, blast, pierce, burn —
   * reports through it with no per-weapon code. 'none' (a deflected hit on an invulnerable element, or a
   * miss) deliberately produces nothing: §A6's 빗나감 row is "표시 없음". */
  const applyHitBase = applyHit;
  applyHit = function (el, dmg, kind, ix, iy, opts) {
    const res = applyHitBase(el, dmg, kind, ix, iy, opts);
    try {
      if (res === 'broken') chHitMarker('kill');
      else if (res === 'damaged') chHitMarker((opts && (opts.crit || (opts.win && opts.win.crit))) ? 'crit' : 'hit');
    } catch (e) { /* ignore */ }
    return res;
  };
  // §A6 락온 차단: the green bracket burst belongs to the shot that cancelled the lock, not to the damage.
  const breakLockBase = breakLock;
  breakLock = function (lk) {
    const fresh = !!(lk && !lk.done);
    breakLockBase(lk);
    if (fresh) { try { chHitMarker('block'); } catch (e) { /* ignore */ } }
  };
  // The aim line is the §B3 "공격 준비" signal: its arrival and departure are the outline's two edges.
  const addAimLineBase = addAimLine;
  addAimLine = function (rec) { addAimLineBase(rec); try { auraSync(rec); } catch (e) { /* ignore */ } };
  const removeAimLineBase = removeAimLine;
  removeAimLine = function (a) { const rec = a && a.rec; removeAimLineBase(a); try { auraSync(rec); } catch (e) { /* ignore */ } };
  /* updateHud() is the one call every weapon change, mode change, restore and KO already passes through
   * (src/46 wraps it for the viewmodel for exactly the same reason). */
  const updateHudChBase = updateHud;
  updateHud = function () {
    updateHudChBase();
    try { ensureCrosshair(); syncTargetMarker(); } catch (e) { /* ignore */ }
  };
  /* A settings write has to land on a live page without re-activation (SPEC-settings §1.3). The settings
   * module's own dispatcher has no branch for these keys, so the branch is added from here. */
  const settingApplyChBase = settingApply;
  settingApply = function (key, value) {
    settingApplyChBase(key, value);
    if (CH_KEYS.indexOf(key) === -1) return;
    try {
      if (key === 'crosshair' || key === 'hitmarker') { clearCrosshair(); ensureCrosshair(); }
      else ensureCrosshair();
      xhair.sig = '';
      chSyncShape();
      syncTargetMarker();
      auraSyncAll();
      if (key === 'viewmodelScale') vmPlace();
      refreshHover();
    } catch (e) { /* ignore */ }
  };
  // The <html> class is ours, so it goes when we do — nothing of ours may outlive a deactivate.
  /* AFTER the base, never before: deactivate() runs restore() while `state.active` is still true, and
   * restore()'s updateHud() would build the crosshair (and re-add the class) all over again. */
  const deactivateChBase = deactivate;
  deactivate = function (silent) {
    const r = deactivateChBase(silent);
    try { clearCrosshair(); } catch (e) { /* ignore */ }
    try { docEl.classList.remove('crs-aim'); } catch (e) { /* ignore */ }
    return r;
  };

  /* ---- debug surface (SPEC-crosshair §D is written against these) --------------------------------- */
  debug.crosshair = () => {
    const n = xhair.node;
    const sh = chShapeFor(state.weapon);
    const bar = targetBar;
    const barOn = !!(bar && n && bar.parentNode === n && bar.classList.contains('crs-ch-hp-on'));
    return {
      node: !!(n && n.isConnected), shown: xhair.shown, x: xhair.x, y: xhair.y,
      state: xhair.state, color: chColorFor(xhair.state || 'ok'),
      gap: +chGap().toFixed(2), armLen: +((sh.armLen || 0) * chScale()).toFixed(2), arms: sh.arms || 0,
      dot: !!sh.dot && xhair.state !== 'dim', shape: xhair.shapeKind, radius: xhair.radius,
      spread: +chSpreadNow().toFixed(2), scale: chScale(), mode: chMode(),
      ring: xhair.ringOn ? xhair.ringKind : null, hint: xhair.hintText, hintBright: xhair.hintBright,
      hit: !!xhair.hit, hp: barOn ? { w: Math.round(parseFloat(bar.style.width) || 0), max: xhair.hpMax, now: xhair.hpNow, approx: bar.classList.contains('crs-ch-hp-approx'), opacity: bar.style.opacity } : null,
      hpNumber: xhair.hpNum ? xhair.hpNum.textContent : '',
      targetMarker: targetMarkerMode(), hostileMarker: hostileMarkerMode()
    };
  };
  /* §D "포인터를 따라온다(2프레임 내 ±2px)": measured INSIDE the page over real animation frames and
   * returned in one hop. A CDP round trip per frame measures the protocol, not the crosshair. */
  debug.chFollow = (frames) => new Promise((resolve) => {
    const out = [];
    const want = clamp(+frames || 3, 1, 20);
    const step = () => {
      const n = xhair.node;
      let tx = null, ty = null;
      if (n) {
        try {
          const m = new DOMMatrixReadOnly(gcsRaw(n).transform);
          tx = m.m41; ty = m.m42;
        } catch (e) { tx = null; ty = null; }
      }
      out.push({ tx, ty, px: state.hoverX, py: state.hoverY });
      if (out.length >= want) { resolve(out); return; }
      raf(step);
    };
    raf(step);
  });
  debug.hitMarker = (kind) => chHitMarker(String(kind));
  debug.barWidth = (maxHp) => chBarWidth(+maxHp);
