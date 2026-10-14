  /* --- combat (A7–A10): player, selection tick, hostiles, attacks, orbs, KO ---
   * v1.3: the T3 laser lives in 89-beams.js and everything about how an attack READS — the player ring, the aim
   * lines, orb legibility, near misses, the hit reaction and the player HUD — lives in 91-combat-feedback.js. The
   * patterns, intervals, damage values, tiers and scoring in this file are untouched (SPEC-readability §4). */
  function combatElapsed() {
    const p = state.player;
    if (!p.startedAt) return 0;
    return Math.max(0, (state.paused ? p.pausedAt : now()) - p.startedAt - p.pausedTotal);
  }
  /* ── SPEC-combat §B3: 적이 떨어지지 않게 한다 ──────────────────────────────────────────
   * 동시 적 수 3 (60초 후 5) → **5 (60초 후 7)**. 선정 간격 1500 → **900 ms** (src/22-perf.js).
   * 처치 후 다음 틱을 기다리지 않고 **0.6초 뒤 즉시 1기** 보충 (scheduleRefill, 아래).
   * 후보가 고갈되면 최소 면적 40 000 → 20 000 px².
   * Now that only the enemy is destructible (§B), an empty page is not "a quiet moment" any more — it is
   * nothing to shoot at. SPEC-settings §2.2 still holds performance mode to two live enemies. */
  function maxHostilesAt(ms) { const n = ms >= 60000 ? 7 : 5; return perfOn() ? Math.min(n, PERF_MAX_HOSTILES) : n; }
  function maxHostiles() { return maxHostilesAt(combatElapsed()); }
  /* §B3's relaxed floor. hostileArea() and tierFor() read the SAME live value — a relaxed pick that tierFor()
   * then refused ('shooter' needs ≥ 40 000) would silently select nothing at all. selectOne() is the only
   * writer, and it puts it back on the next line, so the loosened floor can never leak into forceAttack(). */
  const HOSTILE_AREA = 40000, HOSTILE_AREA_LOW = 20000;
  let hostileFloor = HOSTILE_AREA;
  function tierFor(area) { return area > 400000 ? 'laser' : (area >= 150000 ? 'charger' : (area >= hostileFloor ? 'shooter' : null)); }
  /* v1.4 §10.2: a `front` enemy attacks 30 % more often; a `back` enemy never attacks at all (mul 0).
   * SPEC-combat §A1: arcade stretches every interval by ×1.35 — the hand that dodges is the hand that aims. */
  /* SPEC-product §4: a boss in its THIRD stage attacks twice as often ("마지막엔 간격이 절반"), and
   * SPEC-product §3's 생존 challenge ramps every enemy's interval down as the run goes on
   * (chalIntervalMul(), src/97-challenge.js — 1 whenever no challenge is running). Both are multipliers on
   * the one interval every scheduler already reads, so nothing else had to learn about either. */
  function attackInterval(rec) { return TIER_BASE[rec.tier] * Math.max(0.5, 1 - combatElapsed() / 120000) * (depthAttackMul(rec) || 1) * modeAttackMul() * bossIntervalMul(rec) * chalIntervalMul(); }
  function resetPlayer() {
    const p = state.player;
    p.hp = p.max; p.score = 0; p.kills = 0; p.alive = true; p.startedAt = now(); p.pausedAt = state.paused ? now() : 0; p.pausedTotal = 0; p.lastDamageAt = 0; p.lastRegenAt = 0; p.lastHitFrom = null;
    // v1.4 §1.2: in survival the player IS the drone, so a reset parks it centre-bottom with no momentum
    state.dashUntil = 0; state.dashReadyAt = 0; state.invulUntil = 0; state.dashVx = 0; state.dashVy = 0;
    p.vx = 0; p.vy = 0;
    if (modeHasAvatar()) avatarStart();
  }
  function playerInfo() {
    const p = state.player;
    return { hp: Math.max(0, Math.round(p.hp)), max: p.max, score: p.score, kills: p.kills, alive: p.alive, elapsedMs: Math.round(combatElapsed()), x: p.x, y: p.y,
      lastHitFrom: p.lastHitFrom ? { x: p.lastHitFrom.x, y: p.lastHitFrom.y } : null,   // v1.3 §5: where the last hit came from
      // v1.4 §5: x / y are now the DRONE's centre in survival; the velocity and dash cooldown come with them
      vx: p.vx || 0, vy: p.vy || 0, dashReadyAt: dashReadyWallClock(), hitRadius: AV_HIT_R, mode: state.mode };
  }
  function hostileSkip(el) {
    if (state.hostiles.has(el)) return true;
    for (const h of state.hostiles.keys()) { try { if (h.contains(el) || el.contains(h)) return true; } catch (e) { /* ignore */ } }
    return false;
  }
  /* Page-space area when `el` is a valid hostile candidate right now, else null (selectTick and forceAttack share it). */
  function hostileArea(el) {
    if (!el || el.nodeType !== 1 || !el.isConnected || isOurs(el)) return null;
    try { if (el.hasAttribute('data-crs-broken')) return null; } catch (e) { return null; }
    if (SKIP_WALK_TAGS.has(tagOf(el)) || hostileSkip(el)) return null;
    const s = gcs(el); if (!s || s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) return null;
    const r = rectOf(el); if (!r || r.width < 1 || r.height < 1) return null;
    const vw = viewW(), vh = viewH();
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return null;
    const m = scopeMag();
    const area = (r.width / m) * (r.height / m);
    /* SPEC-combat §D2: 요소 종류가 적을 정한다. An element the §D3 table NAMES — a button, a link, a
     * paragraph, a table — is an enemy for WHAT IT IS, so it clears a much lower floor (archMinArea,
     * src/88-archetypes.js); 범용형 ("그 외") has no identity of its own and still answers to §B3's.
     * Only forceAttack() and makeBoss() read this; the §B3 SELECTION ladder is in selectOne() below. */
    if (area < Math.min(hostileFloor, archMinArea(el)) || area > 0.7 * vw * vh) return null;
    return area;
  }
  /* SPEC-product §4: the boss scheduler keeps its handles beside the other combat timers rather than in a
   * module of its own, so clearTimers() / pauseCombat() reach them exactly like every other one. */
  state.bossTimer = 0; state.bossRespawnAt = 0; state.bossNodes = null; state.slowmoUntil = 0;
  function armCombat() {
    untrack(state.combatTimer); state.combatTimer = 0;
    untrack(state.clockTimer); state.clockTimer = 0;
    if (!state.active || !state.combat || state.paused) return;
    armBossTick();   // SPEC-product §4
    state.graceUntil = now() + scaleMs(GRACE_MS);   // SPEC-test-speed §3: "전투 유예" is a deadline, not a later()
    state.combatTimer = later(selectTick, GRACE_MS);
    state.clockTimer = later(clockTick, 1000);
    armDepthTick();          // v1.4 §10.1
    syncRatioMeter(false);   // v1.4 §3.2
    if (modeHasAvatar()) ensureAvatar();   // v1.4 §1
  }
  /* The 생존 counter is a visible clock: the 1.5 s selection tick alone leaves it frozen through the whole
   * grace and then skips seconds, so the player HUD gets its own 1 s refresh chain (never setInterval). */
  function clockTick() {
    state.clockTimer = 0;
    if (!state.active || !state.combat || state.paused) return;
    updatePlayerHud();
    state.clockTimer = later(clockTick, 1000);
  }
  function selectTick() {
    state.combatTimer = 0;
    if (!state.active || !state.combat || state.paused) return;
    state.combatTimer = later(selectTick, selectIntervalMs());   // §B3: 900 ms, 2500 ms in performance mode (SPEC-settings §2.2)
    updatePlayerHud();
    if (!selectEligible()) return;
    selectOne();
  }
  /* Every reason NOT to put another enemy on the page right now. Shared by the 900 ms tick and §B3's
   * post-kill refill, so the two can never disagree about when the fight is allowed to grow. */
  function selectEligible() {
    const p = state.player;
    if (!state.active || !state.combat || state.paused) return false;
    if (state.ko || !p.alive || debug.noAttacks || state.scoped || !p.inWindow) return false;
    try { if (doc.visibilityState === 'hidden') return false; } catch (e) { /* ignore */ }
    return state.hostiles.size < maxHostiles();
  }
  function hostileWalk(x, y, minArea) {
    return walkCandidates(x, y, { limit: 0.7 * viewW() * viewH(), minArea, descendCollected: true, skip: hostileSkip });
  }
  /* One weighted pick (by sqrt(area), as v1.2). §B3: if nothing clears the 40 000 px² floor — a page of small
   * boxes, or one whose big elements are all hostile already — the floor drops to 20 000 for THIS pick only. */
  function selectOne() {
    const p = state.player;
    let floor = HOSTILE_AREA;
    let cands = hostileWalk(p.x, p.y, floor);
    if (!cands.length) { floor = HOSTILE_AREA_LOW; cands = hostileWalk(p.x, p.y, floor); }
    /* SPEC-combat §D2, last rung of §B3's ladder: a page whose biggest box is a button still has to have
     * enemies, and §D3 says a button IS one. Only elements the table NAMES qualify down here — 범용형 keeps
     * the 20 000 px² floor above — so this can never fire on a page that has anything big to shoot. */
    if (!cands.length) {
      floor = ARCH_MIN_AREA;
      cands = hostileWalk(p.x, p.y, floor).filter((c) => archetypeOf(c.el) !== 'generic');
    }
    if (!cands.length) return false;
    let total = 0;
    for (const c of cands) { c.w = Math.sqrt(c.area); total += c.w; }
    let r = Math.random() * total, pick = cands[cands.length - 1];
    for (const c of cands) { r -= c.w; if (r <= 0) { pick = c; break; } }
    hostileFloor = floor;
    const rec = markHostile(pick.el, pick.area);
    hostileFloor = HOSTILE_AREA;
    return !!rec;
  }
  /* §B3: 처치 후 0.6초 뒤 즉시 1기. The 900 ms tick alone leaves a hole right after the kill — the one
   * moment the player is looking for the next target. Tracked by later(), so restore() cancels it. */
  const REFILL_MS = 600;
  function scheduleRefill() {
    if (!state.active || !state.combat) return;
    later(() => { if (selectEligible()) selectOne(); }, REFILL_MS);
  }
  function placeAura(rec) {
    const r = rectOf(rec.el); if (!r) return;
    const a = rec.aura.style;
    a.left = px(r.left); a.top = px(r.top); a.width = px(r.width); a.height = px(r.height);
  }
  function setAuraPulse(rec, ms) {
    if (reducedMotion()) ms = Math.max(ms, 900);   // the warn ring still telegraphs the slam
    try {
      if (rec.pulse) { rec.pulse.cancel(); state.anims.delete(rec.pulse); }
      rec.pulse = trackAnim(rec.aura.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: ms, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' }));
    } catch (e) { rec.pulse = null; }
  }
  /* One-shot RAF (pattern of scheduleHover) from scroll / resize / attacks: auras follow the element rects; a hostile
   * fully off-screen for > 2 s is released (no kill, no score). */
  function scheduleAura() {
    if (state.auraRaf || !state.active) return;
    state.auraRaf = raf(() => {
      state.auraRaf = 0;
      const vw = viewW(), vh = viewH(), t = now();
      for (const rec of Array.from(state.hostiles.values())) {
        const r = rectOf(rec.el);
        const onScreen = !!(r && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh);
        if (!onScreen) { if (!rec.offscreenSince) rec.offscreenSince = t; else if (t - rec.offscreenSince > 2000) { releaseHostile(rec.el); continue; } }
        else rec.offscreenSince = 0;
        placeAura(rec);
      }
      placeGuards();   // SPEC-combat §D3: 지원형's shield follows the ally it is on
    });
  }
  function markHostile(el, area) {
    if (!root || state.hostiles.has(el)) return state.hostiles.get(el) || null;
    /* §D2: the tier is now the SIZE axis only (attack interval, damage, HP). An element that got here under
     * §D3's lowered floor is below every tier boundary, and "no tier" must not mean "not an enemy" any more —
     * it is the smallest kind of enemy there is. */
    const tier = tierFor(area) || (area >= archMinArea(el) ? 'shooter' : null);
    if (!tier) return null;
    const aura = mk('div', 'crs-hostile');
    const label = mk('span', 'crs-hostile-label');
    label.textContent = '👿 ' + tagOf(el).toUpperCase();   // recomposed with the ▲ depth mark below
    aura.append(label);
    root.append(aura);
    const rec = { el, tier, area, aura, label, phase: 'idle', timer: 0, nodes: [], pulse: null, beam: null, aim: null, offscreenSince: 0, nextAttackAt: 0, markedAt: now(),
      // v1.4: depth role (§10), the lock frame it owns (§2) and its repair schedule (§3)
      depth: 0, dtier: 'mid', depthAt: 0, lock: null, lockReadyAt: 0, repairTimer: 0,
      /* SPEC-combat §D2/§D3: WHAT this enemy does, decided once from the tag. `archSeq` is 범용형's
       * 직사탄 ↔ 돌격 alternation counter and `lunge` the §D5 charge it currently owns. */
      arch: archetypeOf(el), archSeq: 0, lunge: null };
    state.hostiles.set(el, rec);
    measureDepth(rec);           // v1.4 §10.1: once on selection, then every 2 s
    applyDepthLook(rec);
    /* v1.4 §10.2: front ×0.8, mid ×1.0, back ×1.2. Applied whenever an element becomes hostile — an element's
     * depth role IS part of what it is as an enemy, and it has to hold whether or not the element happened to be
     * hovered first (a hover caches HP too, so keying this off "first contact" made the role come and go). */
    hpOf(el);   // page-space max HP cached now (scope never runs the picker)
    applyDepthHp(el, rec.dtier);
    placeAura(rec);
    setAuraPulse(rec, 900);
    scheduleAttack(rec, attackInterval(rec));
    scheduleRepair(rec);         // v1.4 §3.1
    scheduleAura();
    armDepthTick();
    updatePlayerHud();
    kick();
    return rec;
  }
  function scheduleAttack(rec, ms) {
    untrack(rec.timer);
    rec.nextAttackAt = now() + ms;
    rec.timer = later(() => { rec.timer = 0; hostileAttack(rec, false); }, ms);
  }
  function clearPhase(rec) {   // telegraph / beam / warn / lock-mark nodes of this hostile; pulse back to idle
    dropAimLine(rec);   // v1.3 §3.2: the "aiming at you" line never outlives the wind-up it belongs to
    dropLock(rec);      // v1.4 §2: so does the lock frame
    cancelLunge(rec);   // SPEC-combat §D5: nor does a charge — the element goes back where it was standing
    for (const n of rec.nodes) { try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } const i = state.warns.indexOf(n); if (i >= 0) state.warns.splice(i, 1); }
    rec.nodes.length = 0;
    if (rec.beam) { removeBeam(rec.beam); rec.beam = null; }
    if (rec.phase === 'telegraph' && state.hostiles.get(rec.el) === rec) setAuraPulse(rec, 900);
    rec.phase = 'idle';
  }
  function releaseHostile(el) {
    const rec = state.hostiles.get(el);
    if (!rec) return;
    state.hostiles.delete(el);
    untrack(rec.timer); rec.timer = 0;
    untrack(rec.repairTimer); rec.repairTimer = 0;   // v1.4 §3.1
    dropRepairsOf(rec);                              // a beam cannot outlive the enemy casting it
    clearPhase(rec);
    dropAimLine(rec, true);   // the hostile itself is going — its line cannot linger
    try { if (rec.pulse) { rec.pulse.cancel(); state.anims.delete(rec.pulse); } } catch (e) { /* ignore */ }
    try { rec.aura.remove(); } catch (e) { /* ignore */ }
    if (rec.boss) bossBarSync();   // SPEC-product §4: the bar never outlives the boss it belongs to
    updatePlayerHud();
  }
  function hostileKilled(el, max) {
    const rec = state.hostiles.get(el);
    if (!rec) return;
    const clutch = rec.phase !== 'idle';   // mid-telegraph / wind-up / track / lock / fire → ×1.5 (A10)
    const wasBoss = isBoss(rec);           // SPEC-product §4: read BEFORE releaseHostile() drops the record
    const r = rectOf(el);
    releaseHostile(el);
    const p = state.player;
    /* SPEC-product §4: "처치 시 점수 ×3". The ×3 is applied to whatever the kill was already worth, so a
     * clutch kill on a boss still pays its ×1.5 on top rather than being quietly replaced by the ×3. */
    p.score += Math.round((clutch ? max * 1.5 : max) * (wasBoss ? 3 : 1));
    p.kills++;
    if (r) { const v = intersectRect(r, { left: 0, top: 0, right: viewW(), bottom: viewH() }); spawnDmg(v.left + v.width / 2, v.top + v.height / 2, 0, true, { text: msg('killLabel'), color: '#7ee787' }); }
    sfx('kill');
    if (wasBoss) bossKilled(r);   // SPEC-product §4: 1 s slow motion, extra fragments, a new boss in 15 s
    scheduleRefill();   // SPEC-combat §B3
    updatePlayerHud(); scheduleHud();
  }
  function clearCombatNodes() {
    for (const el of Array.from(state.hostiles.keys())) releaseHostile(el);
    clearOrbs(); clearBeams(); clearWarns(); clearAimLines();
    clearLocks(); clearRepairs();   // v1.4 §2 / §3
    /* ── SPEC-combat §B ──
     * restore() and deactivate() both come through here, which is why the two things §B put on the page
     * clean up from here rather than from a class sweep: the deflect marks (§B1) and everything still
     * burning (§B2). hostileFloor goes back to the strict value with them (§B3). */
    clearDeflects(); clearBurning();
    /* SPEC-combat §D5: a charge in flight, a shield still up and the row flashes of a volley. clearLunges()
     * puts every borrowed `transform` back through undisplace() (§E), so the Escape path stays traceless with
     * an enemy frozen mid-lunge. */
    clearArchetypes();
    hostileFloor = HOSTILE_AREA;
    bossBarSync();   // SPEC-product §4: every boss just went with them
  }
  /* Returns the attack that actually started ('shooter' | 'charger' | 'lock') or false; debug.forceAttack
   * reports exactly that. v1.4 §4: T3 everywhere draws a lock instead of the laser, §10.2 silences the back
   * rank entirely, and §A1 gives arcade and survival the same repertoire — only the timing differs. */
  function hostileAttack(rec, forced) {
    if (!state.active || !state.combat || state.hostiles.get(rec.el) !== rec || state.paused || state.ko) return false;
    const el = rec.el;
    if (!el.isConnected || el.hasAttribute('data-crs-broken')) { releaseHostile(el); return false; }
    const r = rectOf(el), vw = viewW(), vh = viewH();
    const onScreen = !!(r && r.width >= 1 && r.height >= 1 && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh);
    if (!onScreen) {   // off-screen: skipped (re-armed); released after > 2 s
      const t = now();
      if (!rec.offscreenSince) rec.offscreenSince = t;
      if (t - rec.offscreenSince > 2000) { releaseHostile(el); return false; }
      scheduleAttack(rec, attackInterval(rec));
      return false;
    }
    rec.offscreenSince = 0;
    // v1.4 §1.2: the drone stays whether or not the pointer is in the window, so inWindow no longer gates it
    const awake = modeHasAvatar() ? state.player.alive : (state.player.inWindow && state.player.alive);
    if (!forced && (debug.noAttacks || !awake)) { scheduleAttack(rec, attackInterval(rec)); return false; }
    if (forced) { untrack(rec.timer); rec.timer = 0; clearPhase(rec); }
    scheduleAura();
    // §10.2: the back rank is support — it repairs, it never shoots
    if (!depthAttackMul(rec)) { if (!forced) scheduleAttack(rec, attackInterval(rec)); return false; }
    /* §4 boss: 1st stage orbs, 2nd adds the slam, 3rd brings back the T3 LASER SWEEP (89-beams.js, kept for
     * exactly this). A boss locks on as well — the sweep is what the third stage ADDS, not what it replaces. */
    if (isBoss(rec) && modeHasProjectiles()) {
      const phase = bossPhase(rec);
      if (phase >= 3) { attackLaser(rec, r); return 'laser'; }
      if (phase >= 2 && Math.random() < 0.5) { attackCharger(rec, r); return 'charger'; }
      if (Math.random() < 0.6) { attackShooter(rec, r, forced); return 'shooter'; }
      return startLock(rec, forced) ? 'lock' : false;
    }
    /* SPEC-combat §D2/§D3: from here the ATTACK comes from the element's kind, not from its size tier. The
     * dispatcher lives in src/88-archetypes.js; 범용형 ("그 외") is the one archetype that still falls back to
     * the tier ladder this line used to BE — see reading 1 in that file. §A1's "both combat modes get the
     * same repertoire" is unchanged: only the timing differs, and that is attackInterval()'s business. */
    return archetypeAttack(rec, r, forced);
  }
  /* T1 shooter: wind-up 250 ms at the element centre (forced: none), then an orb toward the player at
   * orbSpeed() px/s — 520 in survival, ×0.8 in arcade (§A1). */
  function attackShooter(rec, r, forced) {
    spawnOrb(rec, r.left + r.width / 2, r.top + r.height / 2, forced ? 0 : 250);
    scheduleAttack(rec, attackInterval(rec));
  }
  /* SPEC-combat §D4: one projectile record covers all four kinds. `opts` — { kind, dmg, baseSpeed, angleOff,
   * row } — defaults to exactly the v1.3 직사탄, so every existing caller is unchanged. */
  function spawnOrb(rec, x, y, windup, opts) {
    if (!root) return null;
    opts = opts || {};
    if (state.orbs.length >= projCap()) return null;   // §D4: 동시 상한 18개 (성능 모드 10)
    const kind = opts.kind || 'orb';
    const n = mk('div', 'crs-orb' + (kind === 'orb' ? '' : ' crs-orb-' + kind));
    n.style.left = px(x - ORB_R); n.style.top = px(y - ORB_R);   // v1.3 §3.3: 22 px, so it can be seen coming
    root.append(n);
    const t = now();
    const o = { node: n, rec, kind, x, y, x0: x, y0: y, vx: 0, vy: 0, bornAt: t, launchAt: t + windup, launched: false,
      dmg: opts.dmg != null ? opts.dmg : 8 + Math.round(Math.sqrt(rec.area) / 60),
      baseSpeed: opts.baseSpeed || 0, angleOff: opts.angleOff || 0, row: opts.row || null,
      sx: x, sy: y, tx: x, ty: y, arc: 0, mark: null,
      ring: null, trail: null, hist: null, flightMs: 0, minD: Infinity, minAt: null, nearDone: false };
    state.orbs.push(o);
    orbVisuals(o);
    addAimLine(rec);   // §3.2 — also for a forced (zero wind-up) shot, which the min hold time keeps visible
    if (windup > 0) { if (rec.phase === 'idle') rec.phase = 'windup'; n.style.transform = 'scale(.3)'; } else launchOrb(o);
    kick();
    return o;
  }
  function launchOrb(o) {
    const p = state.player;
    const dx = p.x - o.x, dy = p.y - o.y, L = Math.hypot(dx, dy) || 1;
    /* §A1: the speed is read HERE, at launch, not baked into the orb at spawn — so a mode switch mid-wind-up
     * launches at the new mode's speed rather than at the one the enemy was aiming with. §D4 adds a per-kind
     * base speed (속사형 700) and a per-pellet fan angle (산탄 25도); both ride the same mode multiplier. */
    const sp = orbSpeedOf(o);
    o.launched = true; o.launchAt = now();
    if (o.kind === 'mortar') {
      // 포물선탄: 1.1초 비행 — the landing point is where the player stands AT LAUNCH, and the floor mark says so
      o.sx = o.x; o.sy = o.y; o.tx = p.x; o.ty = p.y;
      o.arc = Math.max(60, L * 0.35);
      o.flightMs = scaleMs(MORTAR_MS);
      o.vx = (o.tx - o.sx) / (o.flightMs / 1000); o.vy = (o.ty - o.sy) / (o.flightMs / 1000);
      mortarMark(o);
    } else {
      const a = Math.atan2(dy, dx) + (o.angleOff || 0);
      o.vx = Math.cos(a) * sp; o.vy = Math.sin(a) * sp;
      o.flightMs = Math.max(1, L / sp * 1000);   // the arrival ring closes over exactly this long (§3.3)
    }
    o.node.style.transform = 'translate(0px, 0px)';
    if (o.rec && o.rec.phase === 'windup') o.rec.phase = 'idle';
    dropAimLine(o.rec);   // the line goes with the shot
  }
  /* A10: the clutch bonus reads rec.phase, and only launchOrb() clears 'windup' — an orb that is removed before it
   * ever launches (interception, KO, restore) must put its hostile back to idle. */
  function orbGone(o) { if (!o) return; orbVisualsRemove(o); if (o.rec && !o.launched && o.rec.phase === 'windup') o.rec.phase = 'idle'; }
  /* §D4 "폭발 무기의 범위 안에 든 투사체는 소멸한다" and "전부 요격 가능하다" both come down to one radius per
   * kind — 유도탄's is 1.3× (src/88-archetypes.js), everything else keeps the 18 px this build shipped. */
  function orbHitRadius(o) { return orbInterceptR(o); }
  function removeOrbAt(i) { const o = state.orbs[i]; state.orbs.splice(i, 1); orbGone(o); try { o.node.remove(); } catch (e) { /* ignore */ } }
  function clearOrbs() { for (const o of state.orbs) { orbGone(o); try { o.node.remove(); } catch (e) { /* ignore */ } } state.orbs.length = 0; }
  function orbStep(t, dt) {
    const p = state.player, W = viewW(), H = viewH();
    for (let i = state.orbs.length - 1; i >= 0; i--) {
      const o = state.orbs[i];
      if (!o) continue;   // the array can shrink under us (a hit that KOs the player clears every orb)
      if (!o.launched) {
        if (t < o.launchAt) { const k = 0.3 + 0.7 * clamp((t - o.bornAt) / Math.max(1, o.launchAt - o.bornAt), 0, 1); o.node.style.transform = 'scale(' + k.toFixed(3) + ')'; continue; }
        launchOrb(o);
      }
      /* §D4 "중력탄은 빨아들인다": a projectile caught by 붕괴 stops obeying its own kind and is dragged to
       * the singularity, where it is swallowed exactly as an interception swallows it. */
      if (o.sucked) {
        if (stepSucked(o, dt)) { popOrb(o); if (!state.orbs.length) return; continue; }
        o.node.style.transform = 'translate(' + px(o.x - o.x0) + ', ' + px(o.y - o.y0) + ')';
        orbReadability(o, t);
        continue;
      }
      /* §D4 포물선탄: a parabola to a point fixed at launch, not a straight line. Its damage is the 90 px
       * blast at the landing mark, so it has no swept-segment test of its own. */
      if (o.kind === 'mortar') {
        const q = mortarAt(o, t);
        o.x = q.x; o.y = q.y;
        if (q.k >= 1) {
          removeOrbAt(i);
          const koed = mortarLand(o);
          if (koed && (state.ko || !state.orbs.length)) return;
          continue;
        }
        o.node.style.transform = 'translate(' + px(o.x - o.x0) + ', ' + px(o.y - o.y0) + ')';
        orbReadability(o, t);
        continue;
      }
      if (o.kind === 'seeker') steerSeeker(o, t, dt);   // §D4: 0.8초만 최대 90°/s
      const nx = o.x + o.vx * dt, ny = o.y + o.vy * dt;
      if (p.alive && !state.ko) {   // swept segment hit (no tunnelling at low frame rates)
        const q = nearestOnSegment(o.x, o.y, nx, ny, p.x, p.y);
        // damagePlayer() may KO the player, and showKo() → clearOrbs() empties state.orbs while we are iterating it
        if (Math.hypot(q.x - p.x, q.y - p.y) < ORB_HIT_R) { removeOrbAt(i); damagePlayer(o.dmg, { from: q }); if (state.ko || !state.orbs.length) return; continue; }
      }
      o.x = nx; o.y = ny;
      if (t - o.launchAt > 3000 || nx < -20 || ny < -20 || nx > W + 20 || ny > H + 20) { removeOrbAt(i); continue; }
      o.node.style.transform = 'translate(' + px(nx - o.x0) + ', ' + px(ny - o.y0) + ')';
      orbReadability(o, t);   // v1.3 §3.3 / §3.4: arrival ring, afterimages, will-hit tint, graze detection
    }
  }
  function popOrb(o) {
    const i = state.orbs.indexOf(o);
    if (i >= 0) state.orbs.splice(i, 1);
    orbGone(o);
    try { o.node.remove(); } catch (e) { /* ignore */ }
    state.player.score += 5;
    sfx('pop');
    flash(o.x, o.y, 'gun', { size: 44, dur: 120 });
    if (o.row) flashRow(o.row);   // §D5 연발: 요격하면 그 행이 깜빡인다
    updatePlayerHud(); scheduleHud();
  }
  function interceptOrb(x, y) {
    hitRepairBeams(x, y, 14);   // v1.4 §3.1: a shot across a repair beam delays it 0.4 s — it never absorbs the shot
    for (const o of state.orbs.slice()) { if (Math.hypot(o.x - x, o.y - y) <= orbHitRadius(o)) { popOrb(o); return true; } }
    schedulePierce(x, y);       // v1.4 §10.3: the shot reaches the page, so it can also go THROUGH it
    return false;
  }
  function interceptOrbsWithin(x, y, R) {
    hitRepairBeamsWithin(x, y, R);      // v1.4 §3.1
    scheduleBlastThroughCover(x, y, R); // v1.4 §10.3: a blast reaches what is hiding behind cover
    let n = 0;
    for (const o of state.orbs.slice()) { if (Math.hypot(o.x - x, o.y - y) <= R + (orbHitRadius(o) - ORB_INTERCEPT_R)) { popOrb(o); n++; } }
    return n;
  }
  function interceptOrbsAlong(x1, y1, x2, y2, R) {
    hitRepairBeamsAlong(x1, y1, x2, y2, R);   // v1.4 §3.1
    let n = 0;
    for (const o of state.orbs.slice()) { const q = nearestOnSegment(x1, y1, x2, y2, o.x, o.y); if (Math.hypot(q.x - o.x, q.y - o.y) <= R + (orbHitRadius(o) - ORB_INTERCEPT_R)) { popOrb(o); n++; } }
    return n;
  }
  /* T2 charger: 700 ms telegraph (aura pulse 150 ms + expanding warn ring), then SLAM (rect + 60 px). */
  function attackCharger(rec, r) {
    rec.phase = 'telegraph';
    setAuraPulse(rec, 150);
    addAimLine(rec);
    /* v1.3 §3.3: the warn ring now CLOSES onto the real hit boundary (rect + 60 px) instead of blooming past it,
     * so the edge the player has to be outside of is the edge they can see. */
    const ex = { left: r.left - 60, top: r.top - 60, w: r.width + 120, h: r.height + 120 };
    const warn = mk('div', 'crs-warn crs-slam');
    warn.style.left = px(ex.left); warn.style.top = px(ex.top); warn.style.width = px(ex.w); warn.style.height = px(ex.h);
    root.append(warn); rec.nodes.push(warn); state.warns.push(warn);
    try {
      trackAnim(warn.animate([
        { left: px(ex.left - 130), top: px(ex.top - 130), width: px(ex.w + 260), height: px(ex.h + 260), opacity: 0.3, borderWidth: '6px' },
        { left: px(ex.left), top: px(ex.top), width: px(ex.w), height: px(ex.h), opacity: 1, borderWidth: '3px' }
      ], { duration: 700, easing: 'ease-in', fill: 'forwards' }));
    } catch (e) { /* ignore */ }
    sfx('thump', { gain: 0.5 });
    rec.timer = later(() => { rec.timer = 0; chargerSlam(rec); }, 700);
  }
  function chargerSlam(rec) {
    clearPhase(rec);
    const r = rectOf(rec.el);
    if (!r || !rec.el.isConnected) { scheduleAttack(rec, attackInterval(rec)); return; }
    const p = state.player;
    const ex = { left: r.left - 60, top: r.top - 60, right: r.right + 60, bottom: r.bottom + 60 };
    const inside = p.x >= ex.left && p.x <= ex.right && p.y >= ex.top && p.y <= ex.bottom;
    const cx = (ex.left + ex.right) / 2, cy = (ex.top + ex.bottom) / 2;
    const near = Math.abs(p.x - cx) <= (ex.right - ex.left) && Math.abs(p.y - cy) <= (ex.bottom - ex.top);   // within 2× the expanded rect
    if (root) {   // shockwave ring from the rect to +60 px over 300 ms
      const ring = mk('div', 'crs-warn crs-slam');
      ring.style.left = px(r.left); ring.style.top = px(r.top); ring.style.width = px(r.width); ring.style.height = px(r.height);
      root.append(ring); state.warns.push(ring);
      const kill = () => { try { ring.remove(); } catch (e) { /* ignore */ } const i = state.warns.indexOf(ring); if (i >= 0) state.warns.splice(i, 1); };
      try {
        const a = trackAnim(ring.animate([{ left: px(r.left), top: px(r.top), width: px(r.width), height: px(r.height), opacity: 0.95 }, { left: px(r.left - 60), top: px(r.top - 60), width: px(r.width + 120), height: px(r.height + 120), opacity: 0 }], { duration: 300, easing: 'ease-out', fill: 'forwards' }));
        a.addEventListener('finish', kill);
      } catch (e) { /* ignore */ }
      later(kill, 600);
    }
    shake('bomb', { amp: near ? 10 : 3, dur: 300 });
    sfx('rumble', { gain: near ? 1 : 0.5 });
    if (inside) damagePlayer(18 + Math.round(Math.sqrt(rec.area) / 50), { from: { x: cx, y: cy } });
    scheduleAttack(rec, attackInterval(rec));
  }
  /* --- player regen, KO --- (vignette / damagePlayer / updatePlayerHud moved to 91-combat-feedback.js) */
  function startRegen() {   // 500 ms later() chain while hp < max (tick() also regens while the loop is busy)
    if (state.regenTimer || !state.active || !state.combat || state.paused) return;
    const p = state.player;
    if (!p.alive || p.hp >= p.max) return;
    state.regenTimer = later(regenChain, 500);
  }
  function regenChain() {
    state.regenTimer = 0;
    regenStep();
    const p = state.player;
    if (state.active && state.combat && !state.paused && p.alive && p.hp < p.max) state.regenTimer = later(regenChain, 500);
  }
  function regenStep() {   // 3 HP/s after 3 s without damage (A7)
    const p = state.player, t = now();
    if (!p.alive || p.hp >= p.max || t - p.lastDamageAt < 3000) { p.lastRegenAt = t; return; }
    const dt = (t - (p.lastRegenAt || t)) / 1000;
    p.lastRegenAt = t;
    if (dt <= 0) return;
    p.hp = Math.min(p.max, p.hp + 3 * dt);
    updatePlayerHud();
  }
  function showKo() {
    if (!modeHasHealth()) return;   // §A1: both combat modes KO at 0; rampage has no health at all
    const p = state.player;
    p.alive = false; state.ko = true;
    resetChord(); scopeOff(); stopHold(); cancelSlash();
    untrack(state.regenTimer); state.regenTimer = 0;
    for (const rec of state.hostiles.values()) { untrack(rec.timer); rec.timer = 0; clearPhase(rec); }
    clearOrbs(); clearBeams(); clearWarns(); clearAimLines();
    // KO overlay (A11): built on demand inside the HUD shadow root; ordinary shadow buttons, so isHudEvent() lets clicks through
    if (hudEls.mount && !hudEls.ko) {
      try {
        const ko = mk('div', 'crs-ko');
        const kt = doc.createElement('div'); kt.className = 'kt'; kt.textContent = '💀 ' + msg('koTitle');
        const ks = doc.createElement('div'); ks.className = 'ks';
        ks.textContent = msg('labelScore') + ' ' + p.score + ' · ' + msg('labelKills') + ' ' + p.kills + ' · ' + msg('labelTime') + ' ' + Math.floor(combatElapsed() / 1000) + msg('unitSec');
        const kb = doc.createElement('div'); kb.className = 'kb';
        kb.append(hudButton(msg('koRestart') + ' (Enter)', msg('koRestart') + ' (Enter)', () => restartFromKo()), hudButton(msg('koExit') + ' (Esc)', msg('koExit') + ' (Esc)', () => deactivate()));
        ko.append(kt, ks, kb);
        ko.classList.add('show');
        if (hudEls.fallback) {
          const s = ko.style; s.position = 'fixed'; s.left = '0'; s.top = '0'; s.right = '0'; s.bottom = '0'; s.background = 'rgba(0,0,0,.78)'; s.color = '#fff'; s.display = 'flex'; s.alignItems = 'center'; s.justifyContent = 'center'; s.flexDirection = 'column'; s.pointerEvents = 'auto'; s.font = '16px system-ui, sans-serif';
          for (const b of ko.querySelectorAll('button')) { b.style.margin = '4px'; b.style.padding = '6px 12px'; b.style.color = '#fff'; b.style.background = 'rgba(255,255,255,.15)'; b.style.border = '1px solid rgba(255,255,255,.3)'; b.style.borderRadius = '8px'; b.style.cursor = 'pointer'; }
        }
        hudEls.mount.append(ko);
        hudEls.ko = ko;
      } catch (e) { /* ignore */ }
    }
    toast('💀 ' + msg('koTitle'));
    updateHud(); updatePlayerHud();
  }
  function hideKo() {
    state.ko = false;
    const k = hudEls.ko;
    if (k) { try { k.remove(); } catch (e) { /* ignore */ } hudEls.ko = null; }
  }
  function restartFromKo() {
    if (!state.ko) return false;
    restore();   // player reset + grace (A8)
    return true;
  }
  /* setCombat() / setMode() live in 86-modes.js from v1.4 on — one mode switch, one place. */
  /* Pause (A7): blur / hidden → cancel every combat timer, drop in-flight orbs / beams / rings, freeze the clock. */
  function pauseCombat() {
    if (state.paused) return;
    state.paused = true;
    state.player.pausedAt = now();
    untrack(state.combatTimer); state.combatTimer = 0;
    untrack(state.clockTimer); state.clockTimer = 0;
    untrack(state.regenTimer); state.regenTimer = 0;
    untrack(state.depthTimer); state.depthTimer = 0;
    untrack(state.ratioTimer); state.ratioTimer = 0;
    untrack(state.bossTimer); state.bossTimer = 0;   // SPEC-product §4
    for (const rec of state.hostiles.values()) { untrack(rec.timer); rec.timer = 0; untrack(rec.repairTimer); rec.repairTimer = 0; clearPhase(rec); }
    clearOrbs(); clearBeams(); clearWarns(); clearAimLines();
    clearLocks(); clearRepairs();   // v1.4 §2 / §3
    clearArchetypes();              // SPEC-combat §D5: a pause drops a charge in flight like every other attack
  }
  function resumeCombat() {
    if (!state.paused) return;
    state.paused = false;
    state.player.pausedTotal += now() - state.player.pausedAt;
    if (!state.active || !state.combat) return;
    state.combatTimer = laterRaw(selectTick, Math.max(scaleMs(1000), state.graceUntil - now()));   // remainder already scaled
    untrack(state.clockTimer); state.clockTimer = later(clockTick, 1000);
    for (const rec of state.hostiles.values()) { scheduleAttack(rec, Math.max(1000, attackInterval(rec))); scheduleRepair(rec); }
    armDepthTick(); armRatioTick();   // v1.4 §10.1 / §3.2
    armBossTick();                    // SPEC-product §4
    if (modeHasAvatar()) ensureAvatar();
    if (state.player.hp < state.player.max) startRegen();
  }
  /* --- debug hooks (§5) --- */
  debug.setPlayerHp = (n) => {
    const p = state.player;
    n = +n;
    if (!isFinite(n)) return Math.round(p.hp);
    p.hp = clamp(n, 0, p.max);
    /* A hard set, not a hit. A §2.2 drain still in flight from an earlier hit animates width AND background on
     * the same node, and an animation outranks the inline style updatePlayerHud() is about to write — the bar
     * would keep showing the OLD length and colour next to the NEW number for up to 250 ms. Snap it instead. */
    if (hudEls.pFill) cancelAnimsOf(hudEls.pFill);
    updatePlayerHud();
    if (p.hp <= 0 && p.alive && state.combat && state.active) showKo();
    else if (p.hp < p.max) startRegen();
    return Math.round(p.hp);
  };
  debug.setPlayerPos = (x, y) => {
    x = +x; y = +y;
    if (isFinite(x) && isFinite(y)) { state.player.x = x; state.player.y = y; state.player.inWindow = true; placeSelf(); }
    return { x: state.player.x, y: state.player.y };
  };
  /* SPEC-combat §A1 / §F: the two numbers that ARE the arcade handicap, read off the live code paths rather
   * than restated — `attackIntervalMs` is what scheduleAttack() would be given for `el` RIGHT NOW (same tier,
   * same depth tier, same clock), and `orbSpeed` is what launchOrb() would use this frame. Without `el` the
   * interval is the bare T1 baseline, so the two modes can still be compared with no hostile on the page. */
  debug.modeTuning = (el) => {
    const rec = (el && el.nodeType === 1) ? state.hostiles.get(el) : null;
    return {
      mode: state.mode,
      attackMul: modeAttackMul(), projectileMul: modeProjectileMul(),
      orbSpeed: orbSpeed(),
      attackIntervalMs: rec ? attackInterval(rec) : TIER_BASE.shooter * modeAttackMul()
    };
  };
  /* SPEC-combat §B3 / §F: the four numbers that decide whether the fight runs dry, read off the LIVE code
   * paths rather than restated — maxHostilesAt() is the real ladder asked at two points on the clock, selectMs
   * is what selectTick() would arm right now (performance mode included), and the two floors are the ones
   * selectOne() and hostileArea() actually compare against. Same shape as debug.modeTuning above. */
  debug.hostileTuning = () => ({
    live: state.hostiles.size, max: maxHostiles(), maxAt0: maxHostilesAt(0), maxAt60s: maxHostilesAt(60000),
    selectMs: selectIntervalMs(), refillMs: REFILL_MS, minArea: HOSTILE_AREA, minAreaLow: HOSTILE_AREA_LOW,
    elapsedMs: Math.round(combatElapsed())
  });
  /* The live orbs, velocity included — `speed` is the §A1 projectile speed as actually launched, not a constant. */
  debug.orbList = () => state.orbs.map((o) => ({ x: o.x, y: o.y, vx: o.vx, vy: o.vy, speed: Math.hypot(o.vx, o.vy), launched: !!o.launched, dmg: o.dmg }));
  /* v1.4: the forced hooks bring a target that has been scrolled away back into view first. The picker only ever
   * chooses on-screen elements, so this is the one place an off-screen element is a legitimate subject, and
   * scrolling to the thing you asked about is what a reader of the hook means. */
  function bringIntoView(el) {
    if (!el || el.nodeType !== 1) return;
    const r = rectOf(el);
    if (r && r.right > 0 && r.bottom > 0 && r.left < viewW() && r.top < viewH()) return;
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) { /* ignore */ }
    scheduleAura();
  }
  debug.forceAttack = (el) => {   // same eligibility as the picker; works under noAttacks, null while paused / KO
    if (!state.active || !state.combat || state.paused || state.ko || !state.player.alive) return null;
    bringIntoView(el);
    const existing = state.hostiles.get(el) || null;
    let rec = existing;
    if (!rec) { const area = hostileArea(el); if (area == null) return null; rec = markHostile(el, area); }
    if (!rec) return null;
    const ran = hostileAttack(rec, true);
    /* A no-op must not consume a hostile slot — EXCEPT for the back rank, whose "no-op" is the whole point of
     * §10.2: it is a real hostile that simply never attacks, and its aura has to stay up. */
    if (!ran && !existing && depthAttackMul(rec) && state.hostiles.get(el) === rec) releaseHostile(el);
    return ran || null;   // v1.4: 'shooter' | 'charger' | 'lock' | 'laser'
  };
  /* §5: the caller lives in wall-clock time, the engine in performance.now() time. */
  function dashReadyWallClock() {
    if (!state.dashReadyAt) return 0;
    return Date.now() + Math.round(state.dashReadyAt - now());
  }
  /* §4 boss stages, read straight off its remaining HP. debug.forceBoss() takes an element (that one becomes a
   * boss) or a number (every T3 hostile does), so a test can reach the third stage without guessing a signature. */
  function isBoss(rec) { return !!(rec && (rec.boss || (state.bossMode && rec.tier === 'laser'))); }
  function bossPhase(rec) {
    const h = state.hp.get(rec.el);
    const ratio = (h && h.max > 0) ? clamp(h.hp / h.max, 0, 1) : 1;
    return ratio > 0.66 ? 1 : (ratio > 0.33 ? 2 : 3);
  }
  /* The biggest T3-sized element on the page, viewport or not — the thing a reader of forceBoss() means by
   * "the boss". Capped scan, and only ever run from a debug hook. */
  function biggestBossCandidate() {
    let best = null, bestArea = 0, seen = 0;
    let all = [];
    try { all = doc.body.getElementsByTagName('*'); } catch (e) { return null; }
    for (const el of all) {
      if (++seen > 3000) break;
      if (isOurs(el) || SKIP_WALK_TAGS.has(tagOf(el))) continue;
      if ((el.offsetWidth || 0) < 300 || (el.offsetHeight || 0) < 200) continue;
      const r = rectOf(el);
      if (!r) continue;
      const area = r.width * r.height;
      if (tierFor(area) !== 'laser' || area > 0.7 * viewW() * viewH()) continue;
      if (area > bestArea) { bestArea = area; best = el; }
    }
    return best;
  }
  function makeBoss(el, ratio) {
    if (!el) return null;
    bringIntoView(el);
    const area = hostileArea(el);
    const rec = state.hostiles.get(el) || (area != null ? markHostile(el, area) : null);
    if (!rec) return null;
    state.bossMode = true;
    /* SPEC-product §4: forceBoss() has to produce a REAL boss — ×3 max HP, the crown, the double border and
     * the bar — not just the flag the v1.4 attack ladder reads. bossPromote() is the one place that does all
     * of it; it sets rec.boss itself and is a no-op on an element that is already the boss. */
    bossPromote(rec);
    rec.boss = true;
    if (ratio != null && isFinite(ratio) && ratio >= 0 && ratio <= 1) {
      const h = hpOf(el);
      // floor, so the caller's "drive it to 30 %" loop sees a value that is already AT or BELOW the threshold
      h.hp = Math.max(1, Math.floor(h.max * ratio));
      refreshHover(); scheduleHud();
    }
    return rec;
  }
  /* forceBoss(el) makes that element a boss; forceBoss(0.3) makes the page's biggest T3 element a boss already
   * down to 30 % HP — its third stage (§4), where the laser sweep comes back. */
  debug.forceBoss = (arg) => {
    if (arg && arg.nodeType === 1) return makeBoss(arg, null) ? true : null;
    const ratio = (typeof arg === 'number' && isFinite(arg)) ? arg : null;
    const rec = makeBoss(biggestBossCandidate(), ratio);
    if (rec) return true;
    state.bossMode = true;   // nothing eligible on screen: every T3 hostile still fights as a boss
    for (const r of state.hostiles.values()) if (r.tier === 'laser') r.boss = true;
    return true;
  };
  /* ═════════════════════════════════════════════════════════════════════════════════════════════════
   * SPEC-product §4 보스전 — 승격 · 체력 바 · 3단계 · 처치 보상 · 15초 뒤 재승격
   *
   * v1.4 already shipped the READING half of this (isBoss / bossPhase / the three-stage attack ladder in
   * hostileAttack(), and debug.forceBoss to reach it). What §4 adds is everything around it: the automatic
   * PROMOTION, the ×3 max HP, the fixed bar at the top of the screen, the crown and the double border, the
   * kill reward, and the 15-second wait before a new boss is crowned.
   *
   * AMBIGUITY, reading chosen (reported). §4 says "전투 중 가장 큰 자격 요소를 보스로 승격" without saying
   * where that element comes from. Read as: the biggest of the enemies ALREADY IN THE FIGHT. The selection
   * ladder (selectOne(), §B3) is the one place that decides what is "자격" — area floors, archetype floors,
   * viewport, skip rules — and running a second, different scan here would mean two answers to one question.
   * It also means a boss is always something the player can already see attacking them. When no enemy is
   * live the tick simply waits; selectTick() puts one up within 900 ms.
   *
   * The scheduler is gated by bossEligible(), which is selectEligible()'s list plus `debug.noBoss` — so a
   * suite that runs with `noAttacks: true` (every combat block does) sees no promotion at all, exactly as it
   * sees no selection. ═════════════════════════════════════════════════════════════════════════════════ */
  const BOSS_HP_MUL = 3;              // §4 "maxHp ×3"
  const BOSS_RESPAWN_MS = 15000;      // §4 "15초 뒤 새 보스"
  const BOSS_SCAN_MS = 1000;          // how often the scheduler looks for something to crown
  const BOSS_SLOWMO_MS = 1000;        // §4 "1초 슬로모션"
  const BOSS_SLOWMO_RATE = 0.25;      // how much of real time the integrator advances while it lasts
  const BOSS_PHASE3_MUL = 0.5;        // §4 "마지막엔 간격이 절반"
  debug.noBoss = false;               // the escape hatch, named like noAttacks / noRepair / noInvuln
  function bossIntervalMul(rec) { return (isBoss(rec) && bossPhase(rec) >= 3) ? BOSS_PHASE3_MUL : 1; }
  function bossRec() {
    for (const rec of state.hostiles.values()) if (isBoss(rec)) return rec;
    return null;
  }
  function bossAlive() { const rec = bossRec(); return !!(rec && rec.el && rec.el.isConnected); }
  function bossEligible() {
    const p = state.player;
    if (!state.active || !state.combat || state.paused) return false;
    if (!modeHasProjectiles() || debug.noBoss || debug.noAttacks) return false;
    if (state.ko || !p.alive) return false;
    if (state.bossRespawnAt && now() < state.bossRespawnAt) return false;   // §4: the 15 s wait
    return true;
  }
  /* §4 "maxHp ×3". Same shape as applyDepthHp() (src/87-depth.js): the ratio is preserved, the scaling is
   * recorded so it can never be applied twice, and nothing else in the HP pipeline had to change. */
  function applyBossHp(el) {
    const rec = state.hp.get(el) || hpOf(el);
    if (!rec || rec.bossScaled) return;
    const ratio = rec.max > 0 ? clamp(rec.hp / rec.max, 0, 1) : 1;
    rec.max = Math.round(rec.max * BOSS_HP_MUL);
    rec.hp = Math.max(1, Math.round(rec.max * ratio));
    rec.bossScaled = true;
  }
  /* §4 "이중 테두리와 👑". The border is content.css (`.crs-hostile.crs-boss`); the crown is composed into
   * the aura label, which src/87-depth.js rebuilds from parts — so it is added by WRAPPING that one
   * composer rather than by appending to a string somebody else owns. */
  const setHostileLabelBoss = setHostileLabel;
  setHostileLabel = function (rec) {
    setHostileLabelBoss(rec);
    if (!rec || !rec.label || !isBoss(rec)) return;
    try { rec.label.textContent = '👑 ' + rec.label.textContent; } catch (e) { /* ignore */ }
  };
  function bossPromote(rec) {
    if (!rec || !rec.el || !rec.el.isConnected || rec.boss) return null;
    rec.boss = true;
    applyBossHp(rec.el);
    try { rec.aura.classList.add('crs-boss'); } catch (e) { /* ignore */ }
    setHostileLabel(rec);
    setAuraPulse(rec, 900);
    bossBarSync();
    refreshHover(); scheduleHud(); updatePlayerHud();
    toast(msg('bossArrived'));
    sfx('rumble', { gain: 0.8 });
    return rec;
  }
  /* The biggest enemy currently in the fight — see the reading above. */
  function bossCandidate() {
    let best = null, bestArea = 0;
    for (const rec of state.hostiles.values()) {
      const el = rec.el;
      if (!el || !el.isConnected) continue;
      try { if (el.hasAttribute('data-crs-broken')) continue; } catch (e) { continue; }
      const r = rectOf(el);
      if (!r || r.width < 1 || r.height < 1) continue;
      const a = r.width * r.height;
      if (a > bestArea) { bestArea = a; best = rec; }
    }
    return best;
  }
  function bossTick() {
    state.bossTimer = 0;
    if (!state.active || !state.combat || state.paused) return;
    if (!bossAlive() && bossEligible()) { const rec = bossCandidate(); if (rec) bossPromote(rec); }
    bossBarSync();
    state.bossTimer = later(bossTick, BOSS_SCAN_MS);
  }
  function armBossTick() {
    if (state.bossTimer || !state.active || !state.combat || !modeHasProjectiles()) return;
    state.bossTimer = later(bossTick, BOSS_SCAN_MS);
  }
  /* §4 "처치 시 점수 ×3 (hostileKilled), 1초 슬로모션, 추가 파편. 15초 뒤 새 보스."
   * INTERPRETATION (reported): "추가 파편" is read as fragments thrown ON TOP of whatever the weapon's own
   * break already produced — the element has already been broken by the time this runs, so adding pieces to
   * it is not available any more; three extra particle bursts at the kill point are. */
  function bossKilled(r) {
    state.bossRespawnAt = now() + scaleMs(BOSS_RESPAWN_MS);
    state.slowmoUntil = now() + scaleMs(BOSS_SLOWMO_MS);
    const cx = r ? clamp(r.left + r.width / 2, 0, viewW()) : viewW() / 2;
    const cy = r ? clamp(r.top + r.height / 2, 0, viewH()) : viewH() / 2;
    let frags = 0;
    for (const kind of ['dust', 'spark', 'smoke']) { try { frags += fracParticles(kind, cx, cy) || 0; } catch (e) { /* ignore */ } }
    state.bossFrags = frags;
    try { shake('bomb', { amp: 12, dur: 420 }); } catch (e) { /* ignore */ }
    try { flash(cx, cy, 'bomb', { size: 220, dur: 320 }); } catch (e) { /* ignore */ }
    toast(msg('bossDown'));
    bossBarSync();
    kick();
    untrack(state.bossTimer); state.bossTimer = 0;
    state.bossTimer = later(bossTick, BOSS_RESPAWN_MS + 50);
  }
  /* §4 "상단 중앙에 고정 체력 바". The nodes live in the HUD shadow root (src/45-hud.js) beside the KO
   * curtain and the ratio meter, so they go away with the HUD and leave nothing on the page. */
  let bossBarOn = false;
  function bossBarSync() {
    const n = state.bossNodes;
    if (!n || !n.box) { bossBarOn = false; return; }
    const rec = state.active ? bossRec() : null;
    if (!rec && !bossBarOn) return;   // updateHud() runs once a frame: say nothing when there is nothing to say
    bossBarOn = !!rec;
    try {
      if (!rec) {
        n.box.classList.remove('on');
        if (hudEls.host) hudEls.host.classList.remove('crs-boss-on');
        if (hudEls.fallback) n.box.style.display = 'none';
        return;
      }
      if (hudEls.host) hudEls.host.classList.add('crs-boss-on');
      const h = state.hp.get(rec.el) || hpOf(rec.el);
      const ratio = h && h.max > 0 ? clamp(h.hp / h.max, 0, 1) : 1;
      n.box.classList.add('on');
      if (hudEls.fallback) n.box.style.display = 'block';
      n.label.textContent = '👑 ' + msg('labelBoss') + ' · ' + tagOf(rec.el).toUpperCase() + ' · ' + Math.max(0, Math.round(h.hp)) + '/' + h.max;
      n.fill.style.width = (ratio * 100).toFixed(1) + '%';
      n.box.setAttribute('data-phase', String(bossPhase(rec)));
    } catch (e) { /* ignore */ }
  }
  /* §4 "1초 슬로모션". The integrator reads ONE number, `state.lastT`; pulling it toward the current frame
   * time is a time dilation for every body on the loop at once (pieces, orbs, displaced elements, the drone)
   * with no second clock and nothing to unwind afterwards. */
  const tickFrameBoss = tickFrame;
  tickFrame = function (t) {
    const slow = state.slowmoUntil > t;
    if (slow && state.lastT) state.lastT = t - (t - state.lastT) * BOSS_SLOWMO_RATE;
    else if (!slow && state.slowmoUntil) state.slowmoUntil = 0;
    const busy = tickFrameBoss(t);
    return slow ? true : busy;
  };
  debug.bossInfo = () => {
    const rec = bossRec();
    if (!rec) return { live: false, respawnInMs: state.bossRespawnAt ? Math.max(0, Math.round(state.bossRespawnAt - now())) : 0, frags: state.bossFrags || 0, slowmo: state.slowmoUntil > now() };
    const h = state.hp.get(rec.el) || hpOf(rec.el);
    const r = rectOf(rec.el) || { left: 0, top: 0, width: 0, height: 0 };
    return {
      live: true, tag: tagOf(rec.el).toUpperCase(), tier: rec.tier, phase: bossPhase(rec),
      id: rec.el.id || null, rect: { left: r.left, top: r.top, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 },
      hp: Math.max(0, Math.round(h.hp)), max: h.max, scaled: !!h.bossScaled,
      intervalMs: attackInterval(rec), baseIntervalMs: attackInterval(rec) / bossIntervalMul(rec),
      respawnInMs: state.bossRespawnAt ? Math.max(0, Math.round(state.bossRespawnAt - now())) : 0,
      frags: state.bossFrags || 0, slowmo: state.slowmoUntil > now()
    };
  };
  /* The scheduler is normally gated by bossEligible() (noAttacks off, a live enemy, no 15 s wait in
   * progress). This runs ONE promotion pass with that gate lifted, which is what a test of "승격" means. */
  debug.bossPromote = () => {
    const rec = bossCandidate();
    if (!rec) return null;
    return bossPromote(rec) ? debug.bossInfo() : null;
  };
  debug.bossRespawnNow = () => { state.bossRespawnAt = 0; untrack(state.bossTimer); state.bossTimer = 0; bossTick(); return debug.bossInfo(); };
  /* Drives the LIVE boss's remaining HP to a fraction of its max — the counterpart of forceBoss(ratio) for a
   * boss the scheduler crowned on its own, whose element the caller has no name for. */
  debug.bossWeaken = (ratio) => {
    const rec = bossRec();
    if (!rec) return null;
    const r = Number(ratio);
    if (!isFinite(r) || r < 0 || r > 1) return debug.bossInfo();
    const h = state.hp.get(rec.el) || hpOf(rec.el);
    h.hp = Math.max(1, Math.floor(h.max * r));
    refreshHover(); scheduleHud(); bossBarSync();
    return debug.bossInfo();
  };
  debug.setAvatarPos = (x, y) => {
    x = +x; y = +y;
    const p = state.player;
    if (isFinite(x) && isFinite(y)) { p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.inWindow = true; placeAvatar(); placeSelf(); }
    return { x: p.x, y: p.y };
  };
  debug.dashReady = () => { state.dashReadyAt = 0; updateDashDot(); return true; };
