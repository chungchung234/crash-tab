  /* ===================================================================== */
  /* 14. Events                                                               */
  /*     v1.3 §1: the - / _ / [ and = / + / ] power hotkeys are gone.          */
  /* ===================================================================== */
  const SWALLOW = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'selectstart', 'dragstart'];
  function isHudEvent(e) {
    if (!hud) return false;
    try {
      const t = e.target;
      if (t && t.nodeType && hud.contains(t)) return true;
      if (e.composedPath && e.composedPath().includes(hud)) return true;
    } catch (err) { /* ignore */ }
    return false;
  }
  function isEditable(t) {
    if (!t || t.nodeType !== 1) return false;
    const tag = tagOf(t);
    return tag === 'input' || tag === 'textarea' || tag === 'select' || !!t.isContentEditable;
  }
  /* v1.2 A2: scope state follows the right button through the Pointer Events chord model — `buttons` is read on
   * pointerdown, pointerup AND pointermove (a left press while RMB is held is only a pointermove). */
  function rmbSync(e) {
    const rmb = (e.buttons & 2) !== 0;
    const sc = state.scope;
    if (rmb === sc.rmb) return;
    sc.rmb = rmb;
    syncScope();
  }
  /* A2: the keyup / pointerup that releases Shift or RMB never reaches a blurred page, so the chord would stay
   * "held" and re-scope on the next weapon switch with nothing pressed. rmbSync() re-learns the real button state
   * from the next pointer event and Shift re-arms on its next keydown. */
  function resetChord() {
    const sc = state.scope;
    sc.rmb = false; sc.shiftDown = false; sc.shiftWant = false;
    untrack(sc.shiftTimer); sc.shiftTimer = 0;
  }
  /* v1.4 §1.2: once a drone exists the mouse stops BEING the player and only aims. state.player.x/y is the
   * drone's centre from then on — which is the whole point of the split — so the pointer must not write it. */
  function trackPlayer(e) {
    if (typeof e.clientX !== 'number') return;
    state.player.inWindow = true;
    if (state.avatar) return;
    state.player.x = e.clientX; state.player.y = e.clientY;
  }
  function onSwallow(e) {
    if (!state.active) return;
    if (isHudEvent(e)) return;
    if (handledEvents.has(e)) return;
    handledEvents.add(e);
    try { e.preventDefault(); } catch (err) { /* ignore */ }
    try { e.stopImmediatePropagation(); } catch (err) { /* ignore */ }
    if (e.type === 'pointerdown' || e.type === 'pointerup') { ensureAudio(); trackPlayer(e); rmbSync(e); }
    if (e.type === 'pointerdown' && e.button === 0 && e.isPrimary !== false) {
      if (state.ko) return;   // KO screen: holds / slashes / shots disabled
      // SPEC-product §5: 재생 중에는 입력을 무시한다 — the press is still swallowed, it just does nothing
      if (replayPlaying()) return;
      /* SPEC-product §5: 인스펙터에서 "클릭하면 선택자를 복사한다", and nothing else happens at all —
       * this returns before the one entry point every weapon's press goes through. */
      if (inspectActive()) { inspectCopy(); return; }
      /* SPEC-arsenal §A1: the three-way branch that used to live here (hold / drag / click) IS the problem
       * §A sets out to fix — "지금은 무기마다 누르는 의미가 다르다". Every press now goes to ONE entry point
       * which starts a charge, a hold or a marquee as the weapon asks, and the RELEASE decides what comes
       * out. The old branch still exists, unchanged, inside altPressDown() (src/78-altfire.js). */
      altPressDown(state.weapon, e.clientX, e.clientY, e.pointerId);
    }
  }
  /* Hold stop / slash resolve (A6). Registered BEFORE the swallow listeners so it runs ahead of their
   * stopImmediatePropagation and the HUD early-return; it never preventDefaults. A pointerup of a button other
   * than the primary one (RMB scope release) is ignored (v1.2 A2); pointercancel / lostpointercapture (button −1) stop. */
  function onHoldEnd(e) {
    if (!state.active) return;
    if (e.type === 'pointerup' && e.button !== 0) return;
    if (e.type === 'pointercancel' && state.scope.rmb) { state.scope.rmb = false; syncScope(); }
    const h = state.hold;
    if (h && (h.pointerId == null || e.pointerId == null || e.pointerId === h.pointerId)) stopHold();
    const s = state.slash;
    if (s && (s.pointerId == null || e.pointerId == null || e.pointerId === s.pointerId)) {
      if (e.type === 'pointerup') resolveSlash(e.clientX, e.clientY); else resolveSlash();
    }
  }
  /* ── v1.4 §1.2: WASD / arrows drive the drone, Space dashes ──
   * Claimed ONLY while a drone exists (survival) and never while a form field has focus, so in rampage and
   * arcade — and in any text box anywhere — these keys still belong to the page, exactly as §7.13 requires. */
  function moveDirOf(c, k) {
    if (c === 'KeyW' || k === 'w' || k === 'W' || c === 'ArrowUp' || k === 'ArrowUp') return 'up';
    if (c === 'KeyS' || k === 's' || k === 'S' || c === 'ArrowDown' || k === 'ArrowDown') return 'down';
    if (c === 'KeyA' || k === 'a' || k === 'A' || c === 'ArrowLeft' || k === 'ArrowLeft') return 'left';
    if (c === 'KeyD' || k === 'd' || k === 'D' || c === 'ArrowRight' || k === 'ArrowRight') return 'right';
    return null;
  }
  function isSpaceKey(c, k) { return c === 'Space' || k === ' ' || k === 'Spacebar'; }
  function releaseKeys() { state.keys.up = state.keys.down = state.keys.left = state.keys.right = false; }
  function onWindowBlur() { stopHold(); cancelSlash(); resetChord(); scopeOff(); releaseKeys(); pauseCombat(); }
  function onWindowFocus() { resumeCombat(); }
  function onMotionPref() { if (state.avatar) avatarWobble(state.avatar); }
  function onVisibility() {
    if (doc.visibilityState === 'hidden') { stopHold(); cancelSlash(); resetChord(); scopeOff(); releaseKeys(); pauseCombat(); }
    else resumeCombat();
  }
  function onPointerLeave(e) { if (state.active && e.relatedTarget == null) state.player.inWindow = false; }
  function onPointerEnter() { if (state.active) state.player.inWindow = true; }
  /* SPEC-material §3: scrolling moves the ELEMENTS, so every decal re-reads its element's rect here —
   * that is what makes a damage mark ride the page instead of staying put on the screen. */
  /* SPEC-material §4: the SAME passive handler moves the rubble. anchorPieces() only rewrites transforms —
   * a resting piece is never woken by a scroll — and the integrator is not kicked, so scrolling past a
   * settled pile costs no frames at all. */
  function onScroll() { if (!state.active) return; anchorPieces(); scheduleDecalSync(); if (state.hostiles.size) scheduleAura(); }
  function onMove(e) {
    if (!state.active) return;
    state.hoverX = e.clientX; state.hoverY = e.clientY;   // hold ticks fire here
    state.overHud = isHudEvent(e);
    trackPlayer(e);
    rmbSync(e);
    // A2: LMB pressed while RMB is held arrives as a button-state-change move (button 0, buttons & 1); click weapons fire
    if (e.button === 0 && (e.buttons & 1) && !handledEvents.has(e) && !state.overHud) {
      handledEvents.add(e);
      ensureAudio();
      const W = WEAPONS[state.weapon];
      if (!W.hold && W.input !== 'drag' && !state.ko) smashAt(e.clientX, e.clientY);
    }
    if (state.slash) updateSlash(e.clientX, e.clientY);
    scheduleHover();
  }
  /* Shift scope-in with a 120 ms hold-delay (A2): any other keydown while armed cancels it, keyup Shift scopes out. */
  function armShift() {
    const sc = state.scope;
    sc.shiftDown = true;
    if (sc.shiftTimer || sc.shiftWant) return;
    sc.shiftTimer = later(() => { sc.shiftTimer = 0; if (sc.shiftDown) { sc.shiftWant = true; syncScope(); } }, 120);
  }
  function isShiftKey(e) { return e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.key === 'Shift'; }
  function onKeyUp(e) {
    if (!state.active) return;
    const dir = moveDirOf(e.code, e.key);   // v1.4: released whatever the mode, so a mode switch cannot strand a key
    if (dir && state.keys[dir]) state.keys[dir] = false;
    if (!isShiftKey(e)) return;
    const sc = state.scope;
    sc.shiftDown = false; sc.shiftWant = false;
    untrack(sc.shiftTimer); sc.shiftTimer = 0;
    syncScope();
  }
  /* Hotkeys (v1.2 A12): e.code first, then e.key (Korean IME layouts put Hangul / "Process" in e.key). */
  function onKey(e) {
    if (!state.active || handledKeys.has(e)) return;
    const k = e.key, c = e.code;
    const isEsc = k === 'Escape' || c === 'Escape';
    if (!isEsc && (e.ctrlKey || e.metaKey || e.altKey)) return;
    let path = null;
    try { path = e.composedPath ? e.composedPath()[0] : e.target; } catch (err) { path = e.target; }
    const editable = isEditable(path);
    const sc = state.scope;
    let action = null, arg = null;
    if (isEsc) action = 'escape';
    else if (!editable) {
      if (isShiftKey(e)) action = 'shift';
      else {
        if (sc.shiftTimer) { untrack(sc.shiftTimer); sc.shiftTimer = 0; }   // +, _, Shift+digit never flash the 2× zoom
        let d = -1;
        if (/^Digit\d$/.test(c)) d = parseInt(c.slice(5), 10);
        else if (/^\d$/.test(k)) d = parseInt(k, 10);
        if (d >= 0) { arg = d === 0 ? 10 : d; action = (e.shiftKey && /^Digit\d$/.test(c)) ? 'moveSlot' : 'slot'; }
        else if (c === 'KeyQ' || k === 'q' || k === 'Q') action = 'prev';
        else if (c === 'KeyE' || k === 'e' || k === 'E') action = 'next';
        else if (c === 'KeyR' || k === 'r' || k === 'R') action = 'reload';
        else if (c === 'KeyZ' || k === 'z' || k === 'Z') action = 'restore';
        else if (c === 'KeyM' || k === 'm' || k === 'M') action = 'mute';
        else if (c === 'KeyH' || k === 'h' || k === 'H') action = 'combat';
        // ── SPEC-product §3 챌린지 순환 (C) · §5 인스펙터 (I) · §5 공유 (P) ──
        else if (c === 'KeyC' || k === 'c' || k === 'C') action = 'challenge';
        else if (c === 'KeyI' || k === 'i' || k === 'I') action = 'inspect';
        else if (c === 'KeyP' || k === 'p' || k === 'P') action = 'share';
        else if ((c === 'Enter' || k === 'Enter') && chalResultOpen()) action = 'chalRetry';
        else if ((c === 'Enter' || k === 'Enter') && state.ko) action = 'restart';
        else if (modeHasAvatar() && isSpaceKey(c, k)) action = 'dash';          // v1.4 §1.2
        else if (modeHasAvatar() && moveDirOf(c, k)) { action = 'move'; arg = moveDirOf(c, k); }
      }
    }
    if (!action) return;
    /* SPEC-product §5: "재생 중에는 입력을 무시한다." Escape is the ONE exception — a replay must never be
     * able to trap the player on a page they are trying to leave, and §7's traceless test presses exactly
     * that key with a replay in flight. */
    if (replayPlaying() && action !== 'escape') { handledKeys.add(e); try { e.preventDefault(); e.stopImmediatePropagation(); } catch (err) { /* ignore */ } return; }
    handledKeys.add(e);
    try { e.preventDefault(); e.stopImmediatePropagation(); } catch (err) { /* ignore */ }
    if (action === 'move') { state.keys[arg] = true; kick(); return; }   // v1.4: a held key is simply a held key
    if (e.repeat && (action === 'shift' || action === 'mute' || action === 'combat' || action === 'restore' || action === 'prev' || action === 'next' || action === 'restart' || action === 'dash' || action === 'challenge' || action === 'inspect' || action === 'share' || action === 'chalRetry')) return;
    if (action === 'escape') {   // layered (A2): scope-out if scoped, else exit (stops holds and the KO screen)
      /* SPEC-arsenal §A5 lists Escape among the 중단 조건 (전부 취소 + 환불). It is layered like the rest:
       * a charge in progress is the innermost layer, so the first Escape gives the rounds back rather than
       * tearing the whole overlay down under the player's hand. */
      if (altEscape()) return;
      /* SPEC-product §3: the result overlay's own `닫기 (Esc)`. It is an innermost layer like the charge
       * refund above — closing a card the player is reading must not tear the whole overlay down.
       * The inspector and a replay in flight are deliberately NOT layers here: §7 requires ONE Escape to
       * leave no trace while either is live, so Escape still exits outright and deactivate() ends them. */
      if (chalResultOpen()) { chalResultClose(); return; }
      if (state.scoped) { scopeOff(); return; }
      stopHold(); cancelSlash(); deactivate();
    }
    else if (action === 'shift') armShift();
    else if (action === 'slot') setWeapon(state.loadout[arg - 1]);
    else if (action === 'moveSlot') moveToSlot(state.weapon, arg);
    else if (action === 'prev') stepSlot(-1);
    else if (action === 'next') stepSlot(1);
    else if (action === 'reload') reloadNow();
    else if (action === 'restore') restore();
    else if (action === 'mute') setMuted(!state.muted);
    else if (action === 'combat') cycleMode();   // SPEC-combat §A: H cycles rampage → arcade → survival
    else if (action === 'restart') restartFromKo();
    else if (action === 'dash') startDash();
    else if (action === 'challenge') challengeCycle();   // SPEC-product §3: C cycles off → 타임어택 → 목표 돌파 → 생존 → off
    else if (action === 'inspect') inspectToggle();      // SPEC-product §5
    else if (action === 'share') shareNow();             // SPEC-product §5
    else if (action === 'chalRetry') chalRetry();        // SPEC-product §3: 결과 오버레이의 `다시 (Enter)`
  }
  function onWheel(e) {
    if (!state.active) return;
    let list = [];
    try { list = doc.elementsFromPoint(e.clientX, e.clientY); } catch (err) { return; }
    const k = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? viewH() : 1);
    for (const el of list) {
      if (isOurs(el)) continue;
      let n = el, guard = 0;
      while (n && n !== doc.body && n !== docEl && guard++ < 80) {
        const s = gcs(n);
        if (s) {
          const sy = /(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1;
          const sx = /(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1;
          if (sy || sx) { try { n.scrollBy(sx ? e.deltaX * k : 0, sy ? e.deltaY * k : 0); e.preventDefault(); } catch (err) { /* ignore */ } return; }
        }
        n = parentOf(n);
      }
      break;
    }
  }
  function onToggleEvt(e) {
    if (!state.active) return;
    if (isOurs(e.target)) return;
    reraiseAll();
  }
  /* A focused <iframe>/<frame> receives keydown instead of the top document, and the shield's
   * preventDefault on pointerdown stops a click from moving focus back — so take it back ourselves. */
  function blurFrame() {
    try {
      const ae = doc.activeElement, t = tagOf(ae);
      if (ae && (t === 'iframe' || t === 'frame') && typeof ae.blur === 'function') ae.blur();
    } catch (e) { /* ignore */ }
  }
  function listen(target, type, fn, opts) {
    try { target.addEventListener(type, fn, opts); state.listeners.push([target, type, fn, opts]); } catch (e) { /* ignore */ }
  }
  function bindEvents() {
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(win, t, onHoldEnd, { capture: true });
    for (const t of SWALLOW) { listen(win, t, onSwallow, { capture: true, passive: false }); listen(shield, t, onSwallow, { passive: false }); }
    listen(win, 'pointermove', onMove, { capture: true, passive: true });
    listen(win, 'keydown', onKey, { capture: true });
    listen(doc, 'keydown', onKey, { capture: true });
    listen(win, 'keyup', onKeyUp, { capture: true });          // v1.2 A2: Shift scope-out
    listen(shield, 'wheel', onWheel, { passive: false });
    listen(win, 'resize', onResize, { passive: true });
    listen(win, 'scroll', onScroll, { capture: true, passive: true });   // v1.2 A8: hostile auras follow the page
    listen(doc, 'toggle', onToggleEvt, { capture: true });
    listen(win, 'blur', onWindowBlur);
    listen(win, 'focus', onWindowFocus);                       // v1.2 A7: combat pause / resume
    listen(doc, 'visibilitychange', onVisibility);
    listen(docEl, 'pointerleave', onPointerLeave);             // v1.2 A7: pointer outside the window
    listen(docEl, 'pointerenter', onPointerEnter);
    // v1.4: a parked drone arms no frames, so the reduced-motion preference has to come to US
    try { const mq = win.matchMedia('(prefers-reduced-motion: reduce)'); if (mq && mq.addEventListener) listen(mq, 'change', onMotionPref); } catch (e) { /* ignore */ }
  }
  function unbindEvents() {
    for (const [t, type, fn, opts] of state.listeners) { try { t.removeEventListener(type, fn, opts); } catch (e) { /* ignore */ } }
    state.listeners.length = 0;
  }
