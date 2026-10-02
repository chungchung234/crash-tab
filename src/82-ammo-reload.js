// ── ammo & reload: magazine spend, auto/manual reload state machine, ammo HUD ──
  /* ===================================================================== */
  /* 12b. v1.2: ammo / reload, scope + sniper, loadouts, combat, toasts         */
  /* ===================================================================== */
  function slotKey(slot) { return slot === 10 ? '0' : String(slot); }
  function slotOf(id) { return state.loadout.indexOf(id) + 1; }

  /* --- ammo (A5): state.ammo[id] rounds, reserve ∞, later()-chained reload, swap delay --- */
  function initAmmo() { state.pendingReload = null; for (const id of WEAPON_IDS) state.ammo[id] = WEAPONS[id].mag == null ? null : WEAPONS[id].mag; }
  function isReloading(id) { return !!(state.reload && state.reload.id === id); }
  function swapActive() { return !debug.noCooldown && now() < state.swapUntil; }
  function emptyClick() {   // at most once per 300 ms
    const t = now();
    if (t - state.lastEmptyAt >= 300) { state.lastEmptyAt = t; sfx('empty'); }
  }
  function spend(id) {
    const W = WEAPONS[id];
    if (!W || W.mag == null) return true;
    if (isReloading(id)) { emptyClick(); return false; }
    if (swapActive()) return false;
    if (!(state.ammo[id] > 0)) { emptyClick(); if (!state.reload) startReload(id, false); return false; }   // dead click: no shot to protect
    if (!debug.infiniteAmmo) state.ammo[id]--;
    if (state.ammo[id] <= 0) state.pendingReload = id;   // armed now, started by flushPendingReload() right after the shot
    return true;
  }
  /* The magazine-emptying round still auto-reloads inside the same action (no dead click), but only AFTER it was
   * fired: startReload() scopes out, and a scoped sniper shot must stay exact (A4). */
  function flushPendingReload() {
    const id = state.pendingReload;
    if (!id) return;
    state.pendingReload = null;
    startReload(id, false);
  }
  function startReload(id, manual) {
    const W = WEAPONS[id];
    if (!state.active || !W || W.mag == null || state.reload) return false;
    if (state.ammo[id] >= W.mag) return false;
    scopeOff();
    const ms = debug.fastReload ? 30 : W.reloadMs;
    const rec = { id, startedAt: now(), ms, timer: 0, magTimer: 0 };
    state.reload = rec;
    sfx('magout');
    rec.magTimer = later(() => { rec.magTimer = 0; if (state.reload === rec) sfx('magin'); }, Math.round(ms * 0.8));
    rec.timer = later(() => {
      rec.timer = 0;
      if (state.reload !== rec) return;
      state.reload = null;
      untrack(rec.magTimer); rec.magTimer = 0;
      state.ammo[id] = W.mag;
      updateAmmoHud(); scheduleHud();
      syncScope();   // A2: the chord may still be held — the scope comes back the moment the magazine is full
    }, ms);
    if (ms >= 500) { try { const b = weaponBtn(id); if (b) trackAnim(b.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: ms, easing: 'linear' })); } catch (e) { /* ignore */ } }
    if (manual) toast(msg('toastReload') + '…');
    updateAmmoHud();
    return true;
  }
  function stopReload() {
    const r = state.reload;
    if (!r) return;
    state.reload = null;
    untrack(r.timer); untrack(r.magTimer);
    updateAmmoHud();
  }
  function reloadNow() { return startReload(state.weapon, true); }
  function ammoInfo() {
    const id = state.weapon, W = WEAPONS[id], r = state.reload;
    const size = W.mag == null ? null : W.mag;
    const reloading = isReloading(id);
    return { mag: size == null ? null : state.ammo[id], size, reloading, reloadProgress: reloading ? clamp((now() - r.startedAt) / r.ms, 0, 1) : 0, swapping: swapActive() };
  }
  function updateAmmoHud() {
    const a = hudEls.ammo;
    if (!a) return;
    try {
      const id = state.weapon, W = WEAPONS[id], size = W.mag;
      hudEls.aEmoji.textContent = W.emoji;
      const big = hudEls.aBig;
      let promptOn = false;
      if (swapActive()) { big.textContent = msg('labelSwapping'); hudEls.aDim.textContent = ''; big.classList.remove('low'); }
      else if (size == null) { big.textContent = '∞'; hudEls.aDim.textContent = ''; big.classList.remove('low'); }
      else {
        const mag = state.ammo[id];
        big.textContent = String(mag); hudEls.aDim.textContent = ' / ∞';
        big.classList.toggle('low', mag <= 0.2 * size);
        promptOn = mag <= 0;
      }
      hudEls.aPrompt.classList.toggle('on', promptOn);
      if (hudEls.fallback) hudEls.aPrompt.style.display = promptOn ? 'block' : 'none';
      if (promptOn) {
        if (!hudEls.aBlink || hudEls.aBlink.playState !== 'running') hudEls.aBlink = trackAnim(hudEls.aPrompt.animate([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], { duration: 800, iterations: Infinity }));
      } else if (hudEls.aBlink) { try { hudEls.aBlink.cancel(); } catch (e) { /* ignore */ } hudEls.aBlink = null; }
      const r = state.reload, reloading = !!(r && r.id === id);
      hudEls.aBar.classList.toggle('on', reloading);
      if (hudEls.fallback) hudEls.aBar.style.display = reloading ? 'block' : 'none';
      if (reloading) {
        if (hudEls.aFillFor !== r) {
          hudEls.aFillFor = r;
          cancelAnimsOf(hudEls.aFill);
          const start = clamp((now() - r.startedAt) / r.ms, 0, 1);
          trackAnim(hudEls.aFill.animate([{ width: (start * 100).toFixed(1) + '%' }, { width: '100%' }], { duration: Math.max(1, r.ms - (now() - r.startedAt)), easing: 'linear', fill: 'forwards' }));
        }
      } else if (hudEls.aFillFor) { hudEls.aFillFor = null; cancelAnimsOf(hudEls.aFill); }
    } catch (e) { /* ignore */ }
  }
