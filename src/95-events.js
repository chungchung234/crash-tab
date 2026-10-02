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
  function trackPlayer(e) {
    if (typeof e.clientX !== 'number') return;
    state.player.x = e.clientX; state.player.y = e.clientY; state.player.inWindow = true;
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
      const W = WEAPONS[state.weapon];
      if (W.hold) startHold(state.weapon, e.clientX, e.clientY, e.pointerId);
      else if (W.input === 'drag') startSlash(e.clientX, e.clientY, e.pointerId);
      else smashAt(e.clientX, e.clientY);
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
  function onWindowBlur() { stopHold(); cancelSlash(); resetChord(); scopeOff(); pauseCombat(); }
  function onWindowFocus() { resumeCombat(); }
  function onVisibility() {
    if (doc.visibilityState === 'hidden') { stopHold(); cancelSlash(); resetChord(); scopeOff(); pauseCombat(); }
    else resumeCombat();
  }
  function onPointerLeave(e) { if (state.active && e.relatedTarget == null) state.player.inWindow = false; }
  function onPointerEnter() { if (state.active) state.player.inWindow = true; }
  function onScroll() { if (state.active && state.hostiles.size) scheduleAura(); }
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
    if (!state.active || !isShiftKey(e)) return;
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
        else if ((c === 'Enter' || k === 'Enter') && state.ko) action = 'restart';
      }
    }
    if (!action) return;
    handledKeys.add(e);
    try { e.preventDefault(); e.stopImmediatePropagation(); } catch (err) { /* ignore */ }
    if (e.repeat && (action === 'shift' || action === 'mute' || action === 'combat' || action === 'restore' || action === 'prev' || action === 'next' || action === 'restart')) return;
    if (action === 'escape') {   // layered (A2): scope-out if scoped, else exit (stops holds and the KO screen)
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
    else if (action === 'combat') setCombat(!state.combat);
    else if (action === 'restart') restartFromKo();
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
  }
  function unbindEvents() {
    for (const [t, type, fn, opts] of state.listeners) { try { t.removeEventListener(type, fn, opts); } catch (e) { /* ignore */ } }
    state.listeners.length = 0;
  }
