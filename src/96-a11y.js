  /* ===================================================================== */
  /* 14b. Accessibility (SPEC-settings §3)                                  */
  /*                                                                        */
  /* §3.1 reduced motion, §3.2 markers that do not depend on colour,        */
  /* §3.3 the keyboard aim cursor, §3.4 the screen-reader live region and   */
  /* the KO dialog. Everything here is driven by three settings and is      */
  /* fully reversible: deactivate() takes the cursor, the live region and   */
  /* the document classes away with the rest of the HUD.                    */
  /* ===================================================================== */

  /* ---- §3.1 reduced motion ---------------------------------------------------
   * `reducedMotion()` (src/71-weapon-helpers.js) is the ONE question thirty call sites ask, and it now asks
   * this: the setting is auto | on | off, and `auto` is what the OS says. Nothing else had to change — the
   * whole §3.1 list is already routed through that single predicate. */
  function motionReduced() {
    const want = settingsGet('reduceMotion');
    if (want === 'on') return true;
    if (want === 'off') return false;
    try { return win.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  /* Anything that CACHED the answer has to be told. The frame-driven effects (shake, hitstop, damage numbers,
   * rocket flight, fire particles, scope sway, lock brackets) re-ask on their next run and need nothing. */
  function a11yMotionChanged() {
    if (!state.active) return;
    try { if (state.avatar) avatarWobble(state.avatar); } catch (e) { /* ignore */ }
    try { ensureViewmodel(); } catch (e) { /* ignore */ }
    try { for (const rec of state.hostiles.values()) if (rec.aura && rec.pulse !== undefined) setAuraPulse(rec, 900); } catch (e) { /* ignore */ }
    try { if (reducedMotion()) { state.hitstopUntil = 0; if (state.shake) { state.shake.cancel(); state.shake = null; } } } catch (e) { /* ignore */ }
  }
  /* §3.1 "적대 오라 맥동이 정적 표시로": under reduced motion the aura stops breathing and simply stands at
   * full strength — the information (this element is hostile) survives, the animation does not. */
  const setAuraPulseBase = setAuraPulse;
  setAuraPulse = function (rec, ms) {
    if (!reducedMotion()) return setAuraPulseBase(rec, ms);
    try {
      if (rec.pulse) { rec.pulse.cancel(); state.anims.delete(rec.pulse); }
      rec.pulse = null;
      if (rec.aura) rec.aura.style.opacity = '1';
    } catch (e) { rec.pulse = null; }
  };
  /* §3.1 "불꽃 입자 절반" — halved at the source, so every caller (flame tick, rocket impact) is covered. */
  const spawnFireBase = spawnFire;
  spawnFire = function (x, y, count) {
    const n = reducedMotion() ? Math.max(1, Math.round(count / 2)) : count;
    return spawnFireBase(x, y, n);
  };

  /* ---- §3.2 markers that do not depend on colour -----------------------------
   * One class on <html> drives the stripe pattern and the solid hover / hostile outlines (content.css,
   * `/* settings *\/` block); the ⚠ glyph and the always-visible health numbers are composed here. */
  const HC_CLASS = 'crs-hcm';
  function highContrast() { return settingBool('highContrastMarkers'); }
  function a11yContrastSync() {
    try { docEl.classList.toggle(HC_CLASS, !!(state.active && highContrast())); } catch (e) { /* ignore */ }
  }
  function a11yContrastChanged() {
    a11yContrastSync();
    try { for (const rec of state.hostiles.values()) setHostileLabel(rec); } catch (e) { /* ignore */ }
    try { refreshHover(); } catch (e) { /* ignore */ }
  }
  /* The aura label is composed in ONE place (src/87-depth.js), so the ⚠ and the hp readout go on there. */
  const setHostileLabelBase = setHostileLabel;
  setHostileLabel = function (rec) {
    setHostileLabelBase(rec);
    if (!rec || !rec.label) return;
    try {
      if (!highContrast()) { if (rec.aura) rec.aura.classList.remove('crs-hc'); return; }
      if (rec.aura) rec.aura.classList.add('crs-hc');
      const h = hpOf(rec.el);
      rec.label.textContent = '⚠ ' + rec.label.textContent + ' ' + Math.max(0, Math.round(h.hp)) + '/' + h.max;
    } catch (e) { /* ignore */ }
  };

  /* ---- §3.3 the keyboard aim cursor ------------------------------------------
   * A virtual cursor the arrow keys drive. It is the POINTER: everything downstream (hover highlight, the
   * weapons, and in a mode where the cursor is the player, dodging) already reads state.hoverX/Y and
   * state.player.x/y, so moving those two pairs is the whole feature.
   *
   * Survival is the collision §3.3 calls out: WASD already flies the drone there. When both are live the
   * arrows aim and WASD moves — so the arrows are claimed here BEFORE src/95-events.js can read them as
   * movement, and WASD is left alone. */
  const KB_STEP = 20, KB_STEP_FINE = 5, KB_STEP_COARSE = 60;
  const kbAim = { node: null, x: 0, y: 0, order: [], at: -1 };

  function keyboardAim() { return settingBool('keyboardAim'); }
  function kbArrowOf(c, k) {
    if (c === 'ArrowUp' || k === 'ArrowUp') return 'up';
    if (c === 'ArrowDown' || k === 'ArrowDown') return 'down';
    if (c === 'ArrowLeft' || k === 'ArrowLeft') return 'left';
    if (c === 'ArrowRight' || k === 'ArrowRight') return 'right';
    return null;
  }
  function kbBuild() {
    if (kbAim.node && kbAim.node.isConnected) return kbAim.node;
    if (!root) return null;
    const n = mk('div', 'crs-kbcursor');
    root.append(n);
    kbAim.node = n;
    if (!(kbAim.x > 0) && !(kbAim.y > 0)) { kbAim.x = viewW() / 2; kbAim.y = viewH() / 2; }
    kbPlace();
    return n;
  }
  function kbClear() {
    if (kbAim.node) { try { kbAim.node.remove(); } catch (e) { /* ignore */ } }
    kbAim.node = null; kbAim.order.length = 0; kbAim.at = -1;
  }
  function kbPlace() {
    const n = kbAim.node;
    if (!n) return;
    kbAim.x = clamp(kbAim.x, 0, Math.max(0, viewW() - 1));
    kbAim.y = clamp(kbAim.y, 0, Math.max(0, viewH() - 1));
    try { n.style.left = px(kbAim.x); n.style.top = px(kbAim.y); } catch (e) { /* ignore */ }
    state.hoverX = kbAim.x; state.hoverY = kbAim.y;
    state.overHud = false;
    /* §3.3: "전투 모드에서는 이 가상 커서가 플레이어 위치가 되어 회피가 성립한다" — but only where the
     * cursor IS the player. In survival the drone is, and trackPlayer() makes the same exception. */
    if (!state.avatar) { state.player.x = kbAim.x; state.player.y = kbAim.y; state.player.inWindow = true; }
    scheduleHover();
  }
  function kbMove(dir, e) {
    const step = e && e.shiftKey ? KB_STEP_FINE : (e && e.altKey ? KB_STEP_COARSE : KB_STEP);
    if (dir === 'up') kbAim.y -= step;
    else if (dir === 'down') kbAim.y += step;
    else if (dir === 'left') kbAim.x -= step;
    else if (dir === 'right') kbAim.x += step;
    kbAim.at = -1;
    kbPlace();
  }
  /* Tab / Shift+Tab walk the aimable candidates in DOCUMENT order and snap the cursor to the middle of each. */
  function kbTargets() {
    const out = [];
    const vw = viewW(), vh = viewH();
    let list = [];
    try { list = doc.body ? doc.body.querySelectorAll('*') : []; } catch (e) { list = []; }
    for (const el of list) {
      if (out.length >= 200) break;
      if (isOurs(el) || SKIP_WALK_TAGS.has(tagOf(el))) continue;
      try { if (el.hasAttribute('data-crs-broken')) continue; } catch (e) { continue; }
      const r = rectOf(el);
      if (!r || r.width < 24 || r.height < 14) continue;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
      if (r.width * r.height > 0.8 * vw * vh) continue;
      const s = gcs(el);
      if (!s || s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) continue;
      out.push(el);
    }
    return out;
  }
  function kbCycle(back) {
    if (!kbAim.order.length || kbAim.at < 0) { kbAim.order = kbTargets(); kbAim.at = back ? kbAim.order.length : -1; }
    if (!kbAim.order.length) return;
    kbAim.at = ((kbAim.at + (back ? -1 : 1)) % kbAim.order.length + kbAim.order.length) % kbAim.order.length;
    const el = kbAim.order[kbAim.at];
    const r = rectOf(el);
    if (!r) { kbAim.at = -1; return; }
    kbAim.x = r.left + r.width / 2;
    kbAim.y = r.top + r.height / 2;
    kbPlace();
  }
  function kbFire() {
    if (state.ko) return;
    const W = WEAPONS[state.weapon];
    ensureAudio();
    if (W.input === 'drag') { startSlash(kbAim.x - 24, kbAim.y, null); resolveSlash(kbAim.x + 24, kbAim.y); return; }
    smashAt(kbAim.x, kbAim.y);
  }
  function a11yAimChanged() {
    if (!state.active) { kbClear(); return; }
    if (keyboardAim()) { kbBuild(); toast('⌨️ ' + msg('toastKeyboardAim')); announce(msg('toastKeyboardAim')); }
    else kbClear();
  }
  /* Claimed ahead of src/95-events.js' own handler, which is why this wraps onKey() rather than adding a
   * second listener: one handler, one preventDefault, no chance of both reading the same arrow key. */
  const onKeyBase = onKey;
  onKey = function (e) {
    /* never while the KO dialog is up: Tab belongs to its focus trap then, and nothing may fire */
    if (state.active && !state.ko && keyboardAim() && !handledKeys.has(e)) {
      let claimed = false;
      try { claimed = kbHandle(e); } catch (err) { state.lastError = String((err && err.stack) || err); }
      if (claimed) return;
    }
    return onKeyBase(e);
  };
  /* Returns true when the keystroke belonged to the virtual cursor. A hostile page can make any DOM read
   * throw, so the caller runs this inside a try — an exception here must never reach window.onerror. */
  function kbHandle(e) {
    let path = null;
    try { path = e.composedPath ? e.composedPath()[0] : e.target; } catch (err) { path = e.target; }
    if (isEditable(path) || e.ctrlKey || e.metaKey) return false;
    const dir = kbArrowOf(e.code, e.key);
    let action = null;
    if (dir) action = 'aim';
    else if (isSpaceKey(e.code, e.key) && !modeHasAvatar()) action = 'fire';   // survival keeps Space for the dash
    else if (e.code === 'Enter' || e.key === 'Enter') action = 'scope';
    else if (e.code === 'Tab' || e.key === 'Tab') action = 'cycle';
    if (!action) return false;
    handledKeys.add(e);
    try { e.preventDefault(); e.stopImmediatePropagation(); } catch (err) { /* ignore */ }
    kbBuild();
    if (action === 'aim') kbMove(dir, e);
    else if (action === 'fire') { if (!e.repeat) kbFire(); }
    else if (action === 'scope') { if (!e.repeat) { if (state.scoped) scopeOff(); else scopeOn(); } }
    else if (action === 'cycle') kbCycle(!!e.shiftKey);
    return true;
  }

  /* ---- §3.4 the screen-reader live region ------------------------------------
   * Visually hidden, inside the HUD shadow root, polite. Everything the player would otherwise only learn
   * from a colour, an icon or a sound is written here as text. */
  const A11Y_CSS = [
    '.crs-live{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}',
    /* §3.4: a focus ring every HUD button shows, at ≥ 3:1 against both HUD plates and the KO curtain */
    'button:focus-visible{outline:3px solid #fff;outline-offset:2px;box-shadow:0 0 0 6px rgba(229,72,77,.65)}',
    '.crs-ko{outline:none}'
  ].join('\n');
  let a11yLive = null, a11yLast = '';

  function a11yAugmentHud() {
    const mount = hudEls.mount;
    if (!mount) return;
    let styled = false;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(A11Y_CSS);
      mount.adoptedStyleSheets = (mount.adoptedStyleSheets || []).concat([sheet]);
      styled = true;
    } catch (e) { styled = false; }
    if (!styled) { try { const st = doc.createElement('style'); st.textContent = A11Y_CSS; mount.append(st); } catch (e) { /* ignore */ } }
    try {
      const live = doc.createElement('div');
      live.className = 'crs-live';
      live.setAttribute('aria-live', 'polite');
      live.setAttribute('aria-atomic', 'true');
      live.setAttribute('role', 'status');
      mount.append(live);
      a11yLive = live;
      hudEls.live = live;
    } catch (e) { a11yLive = null; }
  }
  const buildHudBase = buildHud;
  buildHud = function () {
    const host = buildHudBase();
    try { a11yAugmentHud(); } catch (e) { /* ignore */ }
    return host;
  };
  /* The same text twice in a row is not an announcement, so a repeat is nudged with a trailing space —
   * that is the standard trick for making a live region re-read an identical string. */
  function announce(text) {
    if (!a11yLive || !text) return;
    try {
      const s = String(text);
      a11yLive.textContent = (s === a11yLast) ? s + ' ' : s;
      a11yLast = a11yLive.textContent;
    } catch (e) { /* ignore */ }
  }
  function announceWeapon(id) {
    const W = WEAPONS[id];
    if (W) announce(msg('a11yWeapon') + ': ' + msg(W.name));
  }
  function announceMode(id) { announce(msg('a11yMode') + ': ' + modeLabel(id)); }
  /* Roadmap step 11 adds challenges; the two strings and the call shape are settled here so that step only
   * has to call it. Reachable now through debug so it is exercised rather than dead. */
  function announceChallenge(started) { announce(started ? msg('a11yChallengeStart') : msg('a11yChallengeEnd')); }
  debug.announceChallenge = (started) => announceChallenge(!!started);

  const startReloadBase = startReload;
  startReload = function (id, manual) {
    const r = startReloadBase(id, manual);
    if (r) announce(msg('a11yReloadStart') + ': ' + msg((WEAPONS[id] || WEAPONS[state.weapon]).name));
    return r;
  };
  /* Completion happens inside startReload()'s own timer, so it is read off the ammo HUD refresh that the
   * timer makes anyway: the reload record went away AND the magazine came back full. stopReload() (a weapon
   * swap, a scope-out) also clears the record but leaves the magazine short, so it says nothing. */
  let a11yReload = null;
  const updateAmmoHudBase = updateAmmoHud;
  updateAmmoHud = function () {
    const r = state.reload;
    if (a11yReload && a11yReload !== r) {
      const W = WEAPONS[a11yReload.id];
      if (W && W.mag != null && state.ammo[a11yReload.id] >= W.mag) announce(msg('a11yReloadDone') + ': ' + msg(W.name));
    }
    a11yReload = r;
    return updateAmmoHudBase();
  };
  const completeRepairBase = completeRepair;
  completeRepair = function (rp) {
    const before = state.repaired;
    const out = completeRepairBase(rp);
    if (state.repaired > before) announce(msg('a11yRepair'));
    return out;
  };

  /* ---- §3.4 the KO overlay as a modal dialog ---------------------------------
   * role=dialog + aria-modal, focus moved in and TRAPPED between the two buttons, and the focus that was
   * there before handed back when it closes. */
  let koReturnFocus = null, koTrapBound = false;
  function koButtons() {
    const ko = hudEls.ko;
    if (!ko) return [];
    try { return Array.prototype.slice.call(ko.querySelectorAll('button')); } catch (e) { return []; }
  }
  function koTrap(e) {
    const ko = hudEls.ko;
    if (!ko || !state.ko) return;
    if (!(e.code === 'Tab' || e.key === 'Tab')) return;
    const btns = koButtons();
    if (!btns.length) return;
    try { e.preventDefault(); e.stopImmediatePropagation(); } catch (err) { /* ignore */ }
    handledKeys.add(e);
    let i = 0;
    try {
      const active = (hudShadow && hudShadow.activeElement) || doc.activeElement;
      i = Math.max(0, btns.indexOf(active));
    } catch (err) { i = 0; }
    const next = btns[((i + (e.shiftKey ? -1 : 1)) % btns.length + btns.length) % btns.length];
    try { next.focus(); } catch (err) { /* ignore */ }
  }
  const showKoBase = showKo;
  showKo = function () {
    const had = !!hudEls.ko;
    showKoBase();
    const ko = hudEls.ko;
    if (!ko || had) return;
    try {
      ko.setAttribute('role', 'dialog');
      ko.setAttribute('aria-modal', 'true');
      ko.setAttribute('tabindex', '-1');
      const kt = ko.querySelector('.kt');
      ko.setAttribute('aria-label', (kt && kt.textContent) || msg('koTitle'));
    } catch (e) { /* ignore */ }
    /* §3.1: "KO 오버레이가 확대 없이 페이드" — the curtain still arrives, it just stops zooming. No
     * fill, so the overlay settles back onto its own stylesheet rule instead of holding a transform. */
    try {
      const rm = reducedMotion();
      trackAnim(ko.animate(
        rm ? [{ opacity: 0 }, { opacity: 1 }]
           : [{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: rm ? 140 : 180, easing: 'ease-out' }
      ));
    } catch (e) { /* ignore */ }
    try { koReturnFocus = doc.activeElement; } catch (e) { koReturnFocus = null; }
    /* bound once per activation — unbindEvents() takes it away with every other listener */
    if (!koTrapBound) { koTrapBound = true; listen(win, 'keydown', koTrap, { capture: true }); }
    const btns = koButtons();
    if (btns.length) { try { btns[0].focus(); } catch (e) { /* ignore */ } }
    announce(msg('a11yKo'));
  };
  const hideKoBase = hideKo;
  hideKo = function () {
    const had = !!hudEls.ko;
    hideKoBase();
    if (!had) return;
    const back = koReturnFocus;
    koReturnFocus = null;
    if (back && back.isConnected && typeof back.focus === 'function') { try { back.focus(); } catch (e) { /* ignore */ } }
  };

  /* ---- lifecycle ---- */
  function a11yStart() {
    a11yLast = '';
    a11yContrastSync();
    if (keyboardAim()) kbBuild();
  }
  function a11yStop() {
    kbClear();
    koReturnFocus = null; koTrapBound = false; a11yReload = null;
    a11yLive = null; a11yLast = '';
    try { docEl.classList.remove(HC_CLASS); } catch (e) { /* ignore */ }
  }
  debug.a11y = () => ({
    reduced: reducedMotion(), setting: settingsGet('reduceMotion'),
    highContrast: highContrast(), keyboardAim: keyboardAim(),
    cursor: kbAim.node && kbAim.node.isConnected ? { x: Math.round(kbAim.x), y: Math.round(kbAim.y) } : null,
    live: a11yLive ? a11yLive.textContent : null,
    koDialog: hudEls.ko ? hudEls.ko.getAttribute('role') : null
  });
