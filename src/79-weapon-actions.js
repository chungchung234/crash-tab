// ── action dispatch: cooldown/swap/ammo gating, smashAt/slashSegment, hold weapons, katana drag, WEAPONS.*.fire wiring ──

  WEAPONS.hammer.fire = fireHammer; WEAPONS.pistol.fire = firePistol; WEAPONS.smg.fire = fireSmg; WEAPONS.axe.fire = fireAxe;
  WEAPONS.katana.fire = fireStab; WEAPONS.bomb.fire = fireBomb; WEAPONS.rocket.fire = fireRocket; WEAPONS.flame.fire = fireFlame;
  WEAPONS.sniper.fire = fireSniper;
  WEAPONS.collapse.fire = (x, y) => { state.shots++; doCollapse(x, y); return null; };
  // ── SPEC-arsenal §B: the two weapons the arsenal grew by ──
  WEAPONS.laser.fire = fireLaser; WEAPONS.minigun.fire = fireMinigun;
  /* ── SPEC-arsenal §C 상호작용 (충격포 · 견인 광선 · 고무탄) · §D 예능 (뿅망치 · 물총 · 나팔 · 고무 치킨) ── */
  WEAPONS.shockwave.fire = fireShockwave; WEAPONS.tractor.fire = fireTractor; WEAPONS.rubber.fire = fireRubber;
  WEAPONS.squeaky.fire = fireSqueaky; WEAPONS.watergun.fire = fireWater; WEAPONS.horn.fire = fireHorn;
  WEAPONS.chicken.fire = fireChicken;

  /* --- actions (A3 ordering + v1.2 A5 gates): mount → cooldown → swap delay → spend → counters/combo/swing → fire → HUD --- */
  function action(id, x, y, run) {
    if (!state.active || state.ko) return undefined;   // KO screen: smashing disabled (v1.2 §5)
    ensureMounted();
    reraiseAll();
    blurFrame();
    if (onCooldown()) { swingCursor(); cooldownFeedback(); return undefined; }   // rejected: no counter, crack or damage
    if (swapActive()) { cooldownFeedback(); return undefined; }                   // weapon swap delay (A5)
    if (!spend(id)) { updateAmmoHud(); return undefined; }                        // empty / reloading: rejected, auto-reload running
    state.hintCollapse = false;
    state.hoverX = x; state.hoverY = y;
    bumpCombo();
    swingCursor();
    let out = null;
    try { out = run(); } catch (e) { state.lastError = String((e && e.stack) || e); }
    vmFire(id);   // ── v1.5 §2.1: recoil (guns) or the melee swing — only for an attack that was NOT rejected ──
    flushPendingReload();   // A5: the emptying round reloads right after it was fired (A4: scoped shots stay exact)
    updateHud();
    updateAmmoHud();
    kick();
    return out === undefined ? null : out;
  }
  /* Single attack at (x, y): click weapons, one tick for smg/flame, a stab for the katana. true if an attack happened. */
  function smashAt(x, y, weaponId) {
    if (!state.active) return false;
    x = +x; y = +y;
    if (!isFinite(x) || !isFinite(y)) return false;
    const wid = weaponId === 'gun' ? 'pistol' : weaponId;   // legacy v1 alias, same as setMode() (A12)
    const id = WEAPON_IDS.includes(wid) ? wid : state.weapon;
    const W = WEAPONS[id];
    const r = action(id, x, y, () => {
      const hit = W.fire(x, y, { hold: false });
      startCooldown(id, id === 'katana' ? W.stabCooldownMs : W.cooldownMs);
      return hit;
    });
    return r !== undefined;
  }
  /* Katana segment (pointer release or api.slash): < 12 px → stab, else slash. Returns elements damaged.
   * SPEC-destruction §D2: `mid` is the MIDDLE of the drag path, the third point of the quadratic Bézier the
   * blade really travelled; api.slash() passes none and the curve is then bowed off the straight chord. */
  function slashSegment(x1, y1, x2, y2, mid) {
    if (!state.active) return 0;
    x1 = +x1; y1 = +y1; x2 = +x2; y2 = +y2;
    if (!(isFinite(x1) && isFinite(y1) && isFinite(x2) && isFinite(y2))) return 0;
    if (Math.hypot(x2 - x1, y2 - y1) < 12) {
      const r = action('katana', x1, y1, () => { const hit = fireStab(x1, y1); startCooldown('katana', WEAPONS.katana.stabCooldownMs); return hit; });
      return r ? 1 : 0;
    }
    const n = action('katana', x2, y2, () => doSlash(x1, y1, x2, y2, mid));
    return n || 0;
  }

  /* --- hold weapons (A6): a self-rescheduling later() chain, never setInterval --- */
  function startHold(id, x, y, pointerId) {
    if (!state.active) return false;
    const W = WEAPONS[id];
    if (!W || !W.hold) return false;
    if (state.ko) return false;
    if (state.hold) stopHold();
    if (state.slash) cancelSlash();
    ensureMounted();
    reraiseAll();
    blurFrame();
    if (swapActive()) { cooldownFeedback(); return false; }     // v1.2 A5: swap gate before the first tick
    if (!spend(id)) { updateAmmoHud(); return false; }          // empty / reloading: no hold starts
    try { if (shield && pointerId != null) shield.setPointerCapture(pointerId); } catch (e) { /* ignore */ }
    state.hintCollapse = false;
    if (isFinite(x) && isFinite(y)) { state.hoverX = x; state.hoverY = y; }
    bumpCombo();
    swingCursor();
    const h = { id, pointerId: pointerId == null ? null : pointerId, startedAt: now(), tick: 0, timer: 0, safety: 0, cache: new Map(), cacheAt: now(), open: new Set(), tintEls: new Set() };
    state.hold = h;
    h.safety = later(() => { if (state.hold === h) stopHold(); }, 10000);
    if (id === 'flame') { ensureAudio(); startLoop(); }
    try { const b = weaponBtn(id); if (b) b.classList.add('holding'); } catch (e) { /* ignore */ }
    updateHud();
    holdStep();
    return true;
  }
  function holdStep() {
    const h = state.hold;
    if (!h || !state.active) return;
    h.timer = 0;
    const t = now();
    if (t - h.cacheAt >= HOLD_WINDOW) { h.cache = new Map(); h.cacheAt = t; }
    if (h.tick > 0 && !spend(h.id)) { stopHold(); updateAmmoHud(); return; }   // v1.2 A5: a hold that runs dry stops (auto-reload keeps running)
    h.tick++;
    let hit = null;
    try { hit = WEAPONS[h.id].fire(state.hoverX, state.hoverY, { hold: true, h }) || null; } catch (e) { state.lastError = String((e && e.stack) || e); }
    vmFire(h.id);   // ── v1.5 §2.1: sustained fire kicks too (vmFire throttles itself to one per 60 ms) ──
    flushPendingReload();
    if (state.hold !== h) return;   // the tick itself ended the hold (deactivate from a page handler)
    for (const el of Array.from(h.tintEls)) if (el !== hit) { fadeTint(el); h.tintEls.delete(el); }
    if (hit && !hit.hasAttribute('data-crs-broken')) h.tintEls.add(hit);
    for (const el of Array.from(h.open)) { const w = state.dmgAgg.get(el); if (!w || t - w.at >= HOLD_WINDOW) flushWindow(el, w); }
    scheduleHud();
    kick();
    h.timer = later(holdStep, WEAPONS[h.id].tickMs);
  }
  function stopHold(silent) {
    const h = state.hold;
    if (!h) return;
    state.hold = null;   // first: stats().holding is already false
    untrack(h.timer); untrack(h.safety); h.timer = 0; h.safety = 0;
    stopLoop();
    for (const el of Array.from(h.tintEls)) fadeTint(el);
    for (const el of Array.from(h.open)) { const w = state.dmgAgg.get(el); if (silent) state.dmgAgg.delete(el); else flushWindow(el, w); }
    try { const b = weaponBtn(h.id); if (b) b.classList.remove('holding'); } catch (e) { /* ignore */ }
    try { if (shield && h.pointerId != null && shield.hasPointerCapture(h.pointerId)) shield.releasePointerCapture(h.pointerId); } catch (e) { /* ignore */ }
    /* SPEC-destruction §F6: 화염방사기의 보조는 **짧게 누르는 것**이다 — a press let go before the stream
     * has really started throws a 화염탄 instead of being one wasted tick. INTERPRETATION (reported): the
     * general 보조 공격 system is roadmap step 7, so this is wired to the one gesture §F6 itself names
     * ("보조(짧게)") rather than inventing a second input for it. A silent stop — restore(), deactivate(),
     * a weapon swap — is not a release and throws nothing. */
    if (!silent && h.id === 'flame' && now() - h.startedAt < FIREBOMB_PRESS_MS) throwFireBomb(state.hoverX, state.hoverY);
    if (!silent) scheduleHud();
  }

  /* --- katana drag (A8): preview line from pointerdown, resolved on release --- */
  function startSlash(x, y, pointerId) {
    if (!state.active || !root) return false;
    if (state.hold) stopHold();
    if (state.slash) cancelSlash();
    ensureMounted();
    reraiseAll();
    blurFrame();
    try { if (shield && pointerId != null) shield.setPointerCapture(pointerId); } catch (e) { /* ignore */ }
    state.hoverX = x; state.hoverY = y;
    const n = mk('div', 'crs-slash-preview');
    n.style.left = px(x); n.style.top = px(y); n.style.width = '0px'; n.style.height = '2px';
    n.style.background = 'rgba(255,255,255,.7)'; n.style.borderRadius = '1px';
    n.style.boxShadow = '0 0 0 1px rgba(15,25,35,.55), 0 0 4px rgba(255,255,255,.5)';   // dark halo: readable on white pages too (same dark pass as drawSlash)
    n.style.transformOrigin = '0 50%'; n.style.transform = 'translateY(-1px) rotate(0rad)';
    root.append(n);
    /* SPEC-destruction §D2: the path is recorded, not just its two ends — `path` keeps a handful of samples
     * so the middle of the real drag can become the Bézier's third point on release. Capped at 32: a drag
     * across a page can fire hundreds of pointermove events and only the middle one is ever read. */
    state.slash = { x1: x, y1: y, x2: x, y2: y, node: n, pointerId: pointerId == null ? null : pointerId, path: [{ x, y }] };
    return true;
  }
  function slashMid(s) {
    if (!s || !s.path || s.path.length < 3) return null;
    return s.path[Math.floor(s.path.length / 2)];
  }
  function updateSlash(x, y) {
    const s = state.slash;
    if (!s) return;
    s.x2 = x; s.y2 = y;
    if (s.path.length < 32) s.path.push({ x, y });
    else s.path[31] = { x, y };
    const dx = x - s.x1, dy = y - s.y1;
    s.node.style.width = px(Math.hypot(dx, dy));
    s.node.style.transform = 'translateY(-1px) rotate(' + Math.atan2(dy, dx).toFixed(4) + 'rad)';
  }
  function cancelSlash() {
    const s = state.slash;
    if (!s) return null;
    state.slash = null;
    try { s.node.remove(); } catch (e) { /* ignore */ }
    try { if (shield && s.pointerId != null && shield.hasPointerCapture(s.pointerId)) shield.releasePointerCapture(s.pointerId); } catch (e) { /* ignore */ }
    return s;
  }
  function resolveSlash(x, y) {
    const s = cancelSlash();
    if (!s) return 0;
    if (isFinite(x) && isFinite(y)) { s.x2 = x; s.y2 = y; }
    return slashSegment(s.x1, s.y1, s.x2, s.y2, slashMid(s));
  }
