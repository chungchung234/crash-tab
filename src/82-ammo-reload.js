// ── ammo & reload: magazine spend, auto/manual reload state machine, ammo HUD (v1.3 §2.1: pips, 48 px count, pinned width) ──
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
  /* v1.3 §2.1: magazine pips. One 7 × 4 bar per round up to 30; past that the magazine is bucketed into tens
   * (flame: 100 rounds → 10 pips). Nodes are reused, so a hold weapon firing every 50 ms does not churn the DOM. */
  function renderPips(size, left) {
    const list = hudEls.aPipList, box = hudEls.aPips;
    if (!list || !box) return;
    const per = (size == null || size <= 30) ? 1 : 10;
    const total = size == null ? 0 : Math.ceil(size / per);
    const full = size == null ? 0 : clamp(Math.ceil(left / per), 0, total);
    while (list.length > total) { const n = list.pop(); try { n.remove(); } catch (e) { /* ignore */ } }
    while (list.length < total) { const n = doc.createElement('span'); n.className = 'apip'; list.push(n); box.append(n); }
    for (let i = 0; i < list.length; i++) list[i].classList.toggle('spent', i >= full);
  }
  /* The two attention pulses of the ammo panel (low magazine 0.9 s, empty magazine 1.1 s). One WAAPI animation at a
   * time, held in hudEls.aPulse so cancelAnims() / restore() can stop it; `key` keeps it from restarting every frame. */
  function setAmmoPulse(key, node, ms) {
    if (hudEls.aPulseKey === key && hudEls.aPulse && hudEls.aPulse.playState === 'running') return;
    if (hudEls.aPulse) { try { hudEls.aPulse.cancel(); } catch (e) { /* ignore */ } state.anims.delete(hudEls.aPulse); hudEls.aPulse = null; }
    hudEls.aPulseKey = key;
    if (!key || !node || reducedMotion()) return;
    try { hudEls.aPulse = trackAnim(node.animate([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], { duration: ms, iterations: Infinity })); } catch (e) { hudEls.aPulse = null; }
  }
  function updateAmmoHud() {
    const a = hudEls.ammo;
    if (!a) return;
    try {
      const id = state.weapon, W = WEAPONS[id], size = W.mag;
      hudEls.aEmoji.textContent = W.emoji;
      const big = hudEls.aBig, swapping = swapActive();
      const r = state.reload, reloading = !!(r && r.id === id);
      const mag = size == null ? null : state.ammo[id];
      const empty = size != null && !(mag > 0) && !swapping;
      const low = size != null && !empty && mag <= 0.25 * size;
      // the count line: 교체 중 renders at 20 px inside the SAME 196 px plate, so a swap no longer moves the panel
      big.classList.toggle('swap', swapping);
      big.classList.toggle('low', low);
      big.classList.toggle('dim', reloading && !empty);
      if (swapping) { big.textContent = msg('labelSwapping'); hudEls.aDim.textContent = ''; }
      else if (size == null) { big.textContent = '∞'; hudEls.aDim.textContent = ''; }
      else { big.textContent = String(mag); hudEls.aDim.textContent = ' / ∞'; }
      big.style.display = empty ? 'none' : '';
      hudEls.aDim.style.display = empty ? 'none' : '';
      hudEls.aPrompt.classList.toggle('on', empty);
      if (hudEls.fallback) hudEls.aPrompt.style.display = empty ? 'flex' : 'none';
      renderPips(swapping || size == null ? null : size, mag || 0);
      setAmmoPulse(empty ? 'empty' : (low ? 'low' : ''), empty ? hudEls.aPrompt : hudEls.aPips, empty ? 1100 : 900);
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
