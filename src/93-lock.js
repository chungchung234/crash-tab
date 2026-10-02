// ── v1.4 §2: the Virtua Cop lock-on — a frame that closes on a target, and you shoot it open again ──
  /* The user was explicit: "the aim lock I meant is the Virtua Cop idea". In Virtua Cop a red frame snaps around
   * the enemy that is drawing on you and closes over a couple of seconds; you shoot THAT ENEMY before the frame
   * shuts and the shot never happens. So this is not a dodging device, it is an aiming device: the threat and
   * the target are the same object, and the player only ever has one job — point and shoot.
   *
   *   quickdraw  the frame sits on the ENEMY and shooting it is the only answer (there is nothing to dodge)
   *   survival   the frame sits on the DRONE, stops following at 1.0 s, so you may shoot the enemy OR fly out
   *
   * Breaking it needs one point of damage from any weapon, not a kill. We detect that by watching the enemy's
   * hp in the frame loop rather than by hooking the damage sink, so every weapon — hitscan, hold tick, AoE,
   * slash, collapse — breaks a lock identically, with no special case anywhere in the weapon code. */

  function lockDuration(rec) { return (rec && rec.dtier === 'front') ? LOCK_MS_FRONT : LOCK_MS; }
  function lockPhaseOf(k) { return k < LOCK_P1 ? 'warn' : (k < LOCK_P2 ? 'close' : 'imminent'); }
  /* Bracket distance in px for a normalised progress k, reduced motion snapping it to the three readings. */
  function lockGap(k) {
    if (reducedMotion()) return k < LOCK_P1 ? LOCK_GAP0 : (k < LOCK_P2 ? LOCK_GAP1 : LOCK_GAP2);
    if (k < LOCK_P1) return LOCK_GAP0;
    if (k < LOCK_P2) return LOCK_GAP0 + (LOCK_GAP1 - LOCK_GAP0) * ((k - LOCK_P1) / (LOCK_P2 - LOCK_P1));
    return LOCK_GAP1 + (LOCK_GAP2 - LOCK_GAP1) * clamp((k - LOCK_P2) / (1 - LOCK_P2), 0, 1);
  }
  function lockColor(phase) { return phase === 'warn' ? 'rgba(255,255,255,.7)' : (phase === 'close' ? '#e3b341' : '#e5484d'); }

  function buildLock() {
    const node = mk('div', 'crs-lock');
    const ring = mk('div', 'crs-lock-ring');
    const tag = mk('span', 'crs-lock-tag');
    const brackets = [];
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      const b = mk('div', 'crs-lock-bracket');
      try { b.classList.add('crs-lock-' + corner); } catch (e) { /* ignore */ }
      brackets.push(b);
      node.append(b);
    }
    node.append(ring, tag);
    return { node, ring, tag, brackets };
  }
  /* Where the frame is anchored this frame. quickdraw: the enemy rect. survival: the drone, until it freezes. */
  function lockAnchor(lk) {
    if (lk.onEnemy) {
      const r = rectOf(lk.rec.el);
      if (!r) return null;
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
    }
    const p = state.player;
    return { cx: p.x, cy: p.y, w: 0, h: 0 };
  }
  function placeLock(lk, k) {
    const gap = lockGap(k);
    const halfW = lk.w / 2 + gap, halfH = lk.h / 2 + gap;
    const s = lk.node.style;
    s.left = px(lk.cx - halfW); s.top = px(lk.cy - halfH);
    s.width = px(2 * halfW); s.height = px(2 * halfH);
    const color = lockColor(lk.phase);
    for (const b of lk.brackets) { try { b.style.borderColor = color; } catch (e) { /* ignore */ } }
    try { lk.ring.style.borderColor = color; } catch (e) { /* ignore */ } 
  }
  /* §10.4: a covered enemy cannot be shot, so its frame is dashed and says so — unless the weapon in hand can
   * punch through cover, in which case it says THAT instead. The answer holds for the enemy whether the frame is
   * drawn on it (quickdraw) or on the drone (survival): either way it tells you whether shooting is an option.
   * isCovered() runs a real hit test, so it is sampled a few times a second rather than every frame, and always
   * the moment the weapon changes — which is exactly when the answer can flip. */
  function lockCoverTag(lk, t) {
    const weapon = state.weapon;
    if (lk.coverAt && weapon === lk.tagWeapon && (t || now()) - lk.coverAt < 100) return;
    lk.coverAt = t || now();
    lk.tagWeapon = weapon;
    const covered = isCovered(lk.rec.el);
    const want = covered ? (canPierceNow() ? msg('hintPierce') : msg('hintCovered')) : '';
    if (lk.tagText !== want) { lk.tagText = want; try { lk.tag.textContent = want; } catch (e) { /* ignore */ } }
    if (lk.coveredNow !== covered) {
      lk.coveredNow = covered;
      try { lk.node.classList.toggle('crs-lock-covered', covered); } catch (e) { /* ignore */ }
    }
  }
  /* `forced` (debug.forceLock) always runs the canonical 3.0 s timeline: the §10.2 shortening is a balance rule
   * for enemies the game picked, and a debug hook that silently ran 2.4 s on some elements and 3.0 s on others
   * would make every timing inspection depend on where the element happened to sit in the stack. */
  function startLock(rec, forced) {
    if (!root || !state.active || !modeHasEnemies() || state.paused || state.ko) return null;
    if (!rec || !rec.el || !rec.el.isConnected) return null;
    if (rec.lock) return rec.lock;
    if (!forced && now() < (rec.lockReadyAt || 0)) return null;
    if (state.locks.length >= LOCK_MAX) return null;   // §2.2: three at a time, the oldest ones finish first
    const parts = buildLock();
    const lk = Object.assign({ id: ++state.lockSeq, rec, startedAt: now(), dur: forced ? LOCK_MS : lockDuration(rec), phase: 'warn',
      onEnemy: modeLockOnEnemy(), frozen: false, cx: 0, cy: 0, w: 0, h: 0, beeped: '', done: false, forced: !!forced, coverAt: 0, tagWeapon: null,
      hp0: hpOf(rec.el).hp, tagText: null, coveredNow: null }, parts);
    const a = lockAnchor(lk);
    if (!a) { try { parts.node.remove(); } catch (e) { /* ignore */ } return null; }
    lk.cx = a.cx; lk.cy = a.cy; lk.w = a.w; lk.h = a.h;
    rec.lock = lk;
    rec.phase = 'lock';
    state.locks.push(lk);
    root.append(lk.node);
    placeLock(lk, 0);
    lockCoverTag(lk);
    addAimLine(rec);         // v1.3 §3.2 still answers "which one, right now"
    csfx('lockWarn');
    kick();
    return lk;
  }
  function removeLock(lk, keepRecover) {
    const i = state.locks.indexOf(lk);
    if (i >= 0) state.locks.splice(i, 1);
    const rec = lk.rec;
    if (rec && rec.lock === lk) {
      rec.lock = null;
      if (rec.phase === 'lock') rec.phase = 'idle';
      dropAimLine(rec);
      try { rec.aura.classList.remove('crs-lock-imminent'); } catch (e) { /* ignore */ }
      if (keepRecover) rec.lockReadyAt = now() + LOCK_RECOVER_MS;
    }
    try { cancelAnimsOf(lk.node); lk.node.remove(); } catch (e) { /* ignore */ }
  }
  function clearLocks() { for (const lk of state.locks.slice()) removeLock(lk, false); }
  function dropLock(rec) { if (rec && rec.lock) removeLock(rec.lock, false); }
  /* §2.2: one point of damage is enough. The brackets snap OUTWARD (the opposite of closing) so the cancel
   * reads as the frame being blown open, 차단! holds for a second, and the enemy cannot re-arm for 1.5 s. */
  function breakLock(lk) {
    if (lk.done) return;
    lk.done = true;
    const rec = lk.rec;
    state.locksBroken++;
    state.player.score += 15;
    csfx('lockBreak');
    try {
      lk.tag.textContent = msg('lockBlocked');
      lk.node.classList.add('crs-lock-broken');
      if (!reducedMotion()) trackAnim(lk.node.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 320, easing: 'ease-out', fill: 'forwards' }));
    } catch (e) { /* ignore */ }
    if (root && rec) {
      const n = mk('div', 'crs-dmg');
      n.style.left = px(lk.cx); n.style.top = px(lk.cy - 26);
      n.style.font = '800 20px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      n.style.color = '#7ee787';
      n.style.textShadow = '0 1px 3px rgba(0,0,0,.9)';
      n.style.transform = 'translate(-50%, -50%)';
      n.textContent = msg('lockBlocked');
      root.append(n);
      const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
      try { const a = trackAnim(n.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 1000, easing: 'ease-out', fill: 'forwards' })); a.addEventListener('finish', kill); } catch (e) { /* ignore */ }
      later(kill, 1200);
    }
    const r = rec;
    later(() => { removeLock(lk, true); if (r && state.hostiles.get(r.el) === r) scheduleAttack(r, attackInterval(r)); }, 320);
    updatePlayerHud(); scheduleHud();
  }
  /* §2.3 — what failing costs, which is the whole difference between the two combat modes. */
  function fireLock(lk) {
    if (lk.done) return;
    lk.done = true;
    const rec = lk.rec;
    csfx('lockFire');
    if (lk.onEnemy) {
      // quickdraw: no health to lose, so the enemy spends the shot UNDOING one of your kills (§3)
      edgeFlash();
      tryRepair(rec, true);
    } else {
      const p = state.player;
      const d = Math.hypot(p.x - lk.cx, p.y - lk.cy);
      if (d <= LOCK_HIT_R && now() >= state.invulUntil) {
        damagePlayer(26 + Math.round(Math.sqrt(rec.area || 40000) / 70), { from: { x: lk.cx, y: lk.cy } });
      } else {
        state.nearMisses++;
        selfGraze({ x: lk.cx, y: lk.cy });
        sfx('whiff');
      }
    }
    const r = rec;
    removeLock(lk, false);
    if (r) { r.lockReadyAt = now() + LOCK_RECOVER_MS; if (state.hostiles.get(r.el) === r) scheduleAttack(r, attackInterval(r)); }
  }
  /* A 150 ms red rim at the edge of the screen: quickdraw has no health bar to flash, so the failure still has
   * to land somewhere the player is looking. */
  function edgeFlash() {
    if (!root) return;
    const n = mk('div', 'crs-vignette crs-vignette-edge');
    root.append(n);
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
    try { const a = trackAnim(n.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 150, easing: 'ease-out', fill: 'forwards' })); a.addEventListener('finish', kill); } catch (e) { /* ignore */ }
    later(kill, 400);
  }
  /* The frame loop. Runs from tickFrame(), so it inherits the hitstop and stops with everything else. */
  function stepLocks(t) {
    for (const lk of state.locks.slice()) {
      if (lk.done) continue;
      const rec = lk.rec;
      // the enemy went away (killed, restored, released, scrolled off) — the frame cannot outlive it
      if (!rec || !rec.el || !rec.el.isConnected || state.hostiles.get(rec.el) !== rec) { removeLock(lk, false); continue; }
      try { if (rec.el.hasAttribute('data-crs-broken')) { removeLock(lk, false); continue; } } catch (e) { removeLock(lk, false); continue; }
      // §2.2 the break condition: ANY damage to this enemy, from any weapon, cancels the shot
      const hp = hpOf(rec.el).hp;
      if (hp < lk.hp0) { breakLock(lk); continue; }
      const k = clamp((t - lk.startedAt) / lk.dur, 0, 1);
      const phase = lockPhaseOf(k);
      if (phase !== lk.phase) {
        lk.phase = phase;
        if (phase === 'close') csfx('lockClose');
        else if (phase === 'imminent') { csfx('lockImminent'); try { rec.aura.classList.add('crs-lock-imminent'); } catch (e) { /* ignore */ } }
      }
      // survival: the frame follows the drone for the first third, then freezes — that freeze IS the dodge window
      if (!lk.onEnemy && !lk.frozen && k >= LOCK_FOLLOW) lk.frozen = true;
      if (lk.onEnemy || !lk.frozen) {
        const a = lockAnchor(lk);
        if (a) { lk.cx = a.cx; lk.cy = a.cy; lk.w = a.w; lk.h = a.h; }
      }
      placeLock(lk, k);
      lockCoverTag(lk, t);
      // 0.2 s blink through the imminent phase (held steady under reduced motion, where blinking is the problem)
      try { lk.node.style.opacity = (phase === 'imminent' && !reducedMotion() && Math.floor((t - lk.startedAt) / 200) % 2) ? '0.45' : '1'; } catch (e) { /* ignore */ }
      if (k >= 1) fireLock(lk);
    }
  }
  /* §2.2 aim assist: a click anywhere inside a closing frame is a click on that enemy, not on whatever child
   * element happens to be under the pointer. pickTarget() asks this before it returns. */
  function lockAt(x, y) {
    for (const lk of state.locks) {
      if (lk.done || !lk.rec || !lk.rec.el || !lk.rec.el.isConnected) continue;
      const r = rectOf(lk.node);
      if (!r) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return lk;
    }
    return null;
  }
  debug.forceLock = (el) => {
    if (!state.active || !modeHasEnemies() || state.paused || state.ko) return null;
    bringIntoView(el);
    const existing = state.hostiles.get(el) || null;
    let rec = existing;
    if (!rec) { const area = hostileArea(el); if (area == null) return null; rec = markHostile(el, area); }
    if (!rec) return null;
    untrack(rec.timer); rec.timer = 0;
    clearPhase(rec);
    const lk = startLock(rec, true);
    if (!lk && !existing && state.hostiles.get(el) === rec) releaseHostile(el);
    return lk ? lk.id : null;
  };
