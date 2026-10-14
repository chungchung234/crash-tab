// ── SPEC-arsenal §A 보조 공격 (문법 하나로 통일) · §B 무기고 확장 (레이저 커터 · 미니건) ──
  /* =====================================================================
   * 10.6 Alt fire — "길게 누르면 모으고, 떼면 나간다"
   *
   * §A1's whole point is that there is ONE grammar. Before this module the
   * press meant something different on every weapon (망치는 클릭, 기관총은
   * 길게, 카타나는 드래그) and none of it transferred. From here on a press
   * is a CHARGE on every weapon, and the four that spend the press on sustained
   * fire instead (기관총 · 화염방사기 and the two §B adds, 레이저 · 미니건) are
   * the mirror image: the SHORT press is their restrained attack.
   *
   * The three safety rules of §A1 are not decorations — they are what makes
   * the grammar safe to learn by accident:
   *   · < 120 ms  → the ordinary attack, so a fumbled long press costs nothing
   *   · past full charge nothing improves (the ring flashes and says so)
   *   · a cancel REFUNDS the ammo the charge reserved
   *
   * Everything here is built on the input that already existed — startHold /
   * holdStep / stopHold, startSlash / resolveSlash, the pointer capture on
   * the shield — by WRAPPING those bindings rather than forking them. The
   * bundle is one closure and a function declaration's binding is writable,
   * which is the same device src/46 and src/71 already use.
   *
   * §B lives here too, because the two new weapons ARE alt-fire weapons:
   * 레이저 커터 is a hold weapon whose resource is heat and whose short press
   * is a pulse, 미니건 is a hold weapon with a spin-up whose short press is
   * 고정 사격. Their primary fire() entries are in src/76-weapon-fire.js.
   * ===================================================================== */

  /* ── §B: the two new weapons' table extras ────────────────────────────────
   * DESTRUCTION (src/66-fracture.js) and CH_SHAPES (src/51-crosshair.js) are both plain objects declared
   * EARLIER in the bundle, so the new rows are added here instead of editing two files this workstream only
   * reads. src/66's `for (const id of WEAPON_IDS) WEAPONS[id].destruction = DESTRUCTION[id]` has already run
   * by now and wrote `undefined` for the two new ids — these two lines are what fills them in. */
  DESTRUCTION.laser = { shape: 'half', separation: 'slide', finish: 'scorch', particles: 'spark', delayMs: 100, vaporise: 0.05 };
  DESTRUCTION.minigun = { shape: 'strip', separation: 'radial', finish: 'none', particles: 'spark', delayMs: 0, vaporise: 0.08 };
  WEAPONS.laser.destruction = DESTRUCTION.laser;
  WEAPONS.minigun.destruction = DESTRUCTION.minigun;
  /* §A4 / §B: the laser cuts rather than shatters, so it separates the way the katana does (slide along the
   * cut) and leaves a scorched edge; the minigun shreds in strips like the smg but throws a little of it away
   * (vaporise 0.08) because 433 damage a second does not leave whole pieces. INTERPRETATION (reported): §B
   * names no destruction profile for either weapon, only that the table must be filled. */

  /* §B2 레이저: 조준점 준비 링이 열 게이지. A thin cross plus a small ring — it has to read as a cutting
   * instrument, not a gun, and the ring is already the heat readout. 미니건: four fat arms that ROTATE with
   * the barrels (§B3 "조준점 팔도 함께 회전한다"), written by the chPlaceArms wrapper below. */
  CH_SHAPES.laser = { arms: 4, dot: true, armLen: 5, thin: true, parts: [{ cls: 'crs-ch-circle', size: 15, w: 1, rot: 0 }] };
  CH_SHAPES.minigun = { arms: 4, dot: false, armLen: 9, parts: [] };

  /* ── §A1 the three constants the safety rules are made of ───────────────── */
  const ALT_MIN_MS = 120;            // under this, the press was an ordinary attack
  const ALT_AMMO = 2;                // §A4: 보조 공격은 탄약 2발
  const ALT_MELEE_CD_MUL = 1.8;      // §A4: 근접 무기는 탄약이 없으므로 쿨다운 ×1.8
  /* §A4 says 근접 무기는 쿨다운으로 값을 치른다 — but the hammer's own cooldown is 0, so "×1.8" alone would make
   * its 내려치기 free and the whole rule empty. INTERPRETATION (reported): the alt's cooldown is the weapon's
   * own cooldown raised to a floor first, THEN ×1.8 — hammer 540 ms, axe 990 ms, katana 540 ms. */
  const ALT_MELEE_CD_FLOOR = 300;
  const ALT_RING = '#8ab4ff';        // §A3: 준비 링을 재사용하되 색이 다르다
  const ALT_GAP_SHRINK = 0.4;        // §A3: 조준점 팔이 안쪽으로 모인다 (gap 최대 40% 축소)
  const ALT_DRAG_CANCEL = 12;        // §A5: 카타나는 드래그 12px 이상이면 발도가 취소된다. 붕괴도 같은 기준
  const ALT_STEP_MS = 16;            // the charge's own heartbeat (feedback only — the result reads the clock)

  /* ── §A2 the table ────────────────────────────────────────────────────────
   * `type` is §A2's own 유형 column and it decides how the release is read (§A5):
   *   charge   중간값을 보간한다 — a half-charged 내려치기 is half-way between the two attacks
   *   steady   완충이 아니면 일반 공격 — "어중간한 정조준은 의미가 없다"
   *   lock     완충이 아니면 일반 공격, plus a designated element
   *   burst    the weapon sustains on a long press, so the SHORT press is the alt
   *   marquee  a dragged rectangle, not a charge at all
   */
  const ALTS = {
    hammer:   { type: 'charge', ms: 600, dmgMul: 2.2, radius: 120 },
    pistol:   { type: 'steady', ms: 350, dmgMul: 1.4 },
    smg:      { type: 'burst',  rounds: 3, spreadMul: 0.5 },
    sniper:   { type: 'steady', ms: 350, holdMs: 2000, crit: 0.40 },
    axe:      { type: 'charge', ms: 800, dmgMul: 1.6, radius: 160 },
    katana:   { type: 'charge', ms: 600, dmgMul: 1.8, maxTargets: 16, pierce: 2 },
    bomb:     { type: 'charge', ms: 900, radius: 160, radiusMax: 340 },
    rocket:   { type: 'lock',   ms: 700 },
    flame:    { type: 'burst',  fuel: FIREBOMB_FUEL },
    collapse: { type: 'marquee' },
    laser:    { type: 'burst',  heat: 25, damage: 90 },
    minigun:  { type: 'burst',  rounds: 20, spreadMul: 0.5 },
    /* ── SPEC-arsenal §C / §D (8단계): the seven new weapons ───────────────────────────────────────
     * §A1 is a grammar, not a list — "길게 누르면 모으고, 떼면 나간다" has to be true of the whole arsenal
     * or it is true of nothing, so every new weapon gets a row here too. §C and §D name no 보조 공격 at all,
     * so each row is an INTERPRETATION (reported) and every one of them is the SAME attack with the charge
     * spent on its own verb rather than a second weapon bolted on:
     *   충격포     반경과 충격량이 함께 커진다 (폭탄의 심지 조절과 같은 모양)
     *   견인 광선  짧게 누르면 붙잡지 않고 한 번 확 당긴다 — hold 무기이므로 §A2 의 burst 쪽
     *   고무탄     반경 안 전부에 고무를 입힌다
     *   뿅망치     반경 90 을 한 번에 — 여전히 약하지만 넓다 (가장 짧은 충전 0.4초)
     *   물총       짧게 누르면 물풍선. 한 번에 넓게 적신다 — 준비 도구라는 정체성 그대로
     *   나팔       원뿔이 길어지고 세진다
     *   고무 치킨  완충이면 20% 가 아니라 반드시 걸린다 */
    shockwave:{ type: 'charge', ms: 700, radius: 260, radiusMax: 420, impulseMul: 1.8 },
    tractor:  { type: 'burst',  yank: true, rounds: 0 },
    rubber:   { type: 'charge', ms: 500, radius: 150, dmgMul: 1.5 },
    squeaky:  { type: 'charge', ms: 400, dmgMul: 2.0, radius: 90 },
    watergun: { type: 'burst',  fuel: 8, splashR: 120 },
    horn:     { type: 'charge', ms: 600, rangeMul: 1.6 },
    chicken:  { type: 'charge', ms: 450, dmgMul: 1.5 }
  };
  function altOf(id) { return ALTS[id] || null; }
  function altChargeMs(id) { const a = altOf(id); return (a && a.ms > 0) ? a.ms : 0; }

  /* ── the live press ───────────────────────────────────────────────────────
   * ONE record, never a second: a pointer can only be down once, and every cancel path empties it. */
  const altP = {
    on: false, id: null, pointerId: null, at: 0, x: 0, y: 0, type: null,
    reserved: 0, blocked: false, maxAt: 0, maxed: false, lock: null, lockNode: null,
    radiusNode: null, marquee: null, timer: 0, fired: 0, cancels: 0, lastCancel: null
  };
  /* §A3 / §A5 surfaces every piece of feedback below reads, so a frame that samples one of them never sees a
   * charge that the clock says is already over. */
  function altActive() { return altP.on && altP.type && altP.type !== 'burst' && altP.type !== 'marquee'; }
  function altElapsed() { return altP.on ? now() - altP.at : 0; }
  /* The charge fraction. scaleMs() is applied to the DURATION, not to the elapsed time, so a test running at
   * debug.timeScale 0.1 charges ten times faster and every ratio below still means exactly what it means. */
  function altChargeP() {
    if (!altActive() || altP.blocked) return 0;
    const total = Math.max(1, scaleMs(altChargeMs(altP.id)));
    return clamp(altElapsed() / total, 0, 1);
  }
  function altCharged() { return altChargeP() >= 1; }

  /* ── §A4 자원 ─────────────────────────────────────────────────────────────
   * The rounds are taken WHEN THE CHARGE STARTS and given back by every cancel path, which is what "충전 중
   * 교체하면 취소되고 탄약도 환불된다" asks for literally. The alt's own shot then refunds ONE of them right
   * before it fires so that action()'s ordinary spend() takes it again — the net cost is exactly ALT_AMMO and
   * every cooldown / swap / combo / HUD rule in action() still runs, unforked. */
  function altCanAfford(id, n) {
    const W = WEAPONS[id];
    if (!W || W.mag == null) return true;              // melee and the laser have no magazine
    if (debug.infiniteAmmo) return true;
    return state.ammo[id] >= n;
  }
  function altReserve(id, n) {
    const W = WEAPONS[id];
    if (!W || W.mag == null || debug.infiniteAmmo) return 0;
    if (!(state.ammo[id] >= n)) return 0;
    state.ammo[id] -= n;
    updateAmmoHud();
    return n;
  }
  function altRefund(id, n) {
    const W = WEAPONS[id];
    if (!(n > 0) || !W || W.mag == null) return;
    state.ammo[id] = clamp(state.ammo[id] + n, 0, W.mag);
    updateAmmoHud();
  }
  /* §A4 근접: the alt costs a long cooldown instead of ammo. */
  function altMeleeCooldown(id) {
    const W = WEAPONS[id];
    const base = Math.max(W.cooldownMs || 0, W.stabCooldownMs || 0, ALT_MELEE_CD_FLOOR);
    return Math.round(base * ALT_MELEE_CD_MUL);
  }

  /* ── the alt's own action gate ────────────────────────────────────────────
   * action() (src/79) is reused whole: the reserved rounds are handed back one at a time so its spend() sees
   * exactly the magazine it expects. Melee weapons reserve nothing and pay in cooldown instead. */
  function altAction(id, x, y, run) {
    const W = WEAPONS[id];
    const reserved = altP.reserved;
    altP.reserved = 0;
    if (reserved > 0) altRefund(id, 1);                // action()'s spend() takes this one back
    const out = action(id, x, y, run);
    if (out === undefined && reserved > 0) altRefund(id, reserved - 1);   // rejected (cooldown / swap): nothing was spent
    if (out !== undefined && W.mag == null) startCooldown(id, altMeleeCooldown(id));
    if (out !== undefined) altP.fired++;
    return out;
  }

  /* ===================================================================== */
  /* §A5 input — down / move / up / cancel                                  */
  /* ===================================================================== */
  /* Called from onSwallow (pointerdown) in src/95-events.js in place of the old three-way branch. */
  function altPressDown(id, x, y, pointerId) {
    if (!state.active || state.ko) return false;
    altClearNodes();
    const W = WEAPONS[id], a = altOf(id);
    altP.on = true; altP.id = id; altP.pointerId = pointerId == null ? null : pointerId;
    altP.at = now(); altP.x = x; altP.y = y; altP.blocked = false; altP.reserved = 0;
    altP.maxed = false; altP.maxAt = 0; altP.lock = null; altP.type = a ? a.type : null;
    if (W.hold) {                                   // 기관총 · 화염방사기 · 레이저 · 미니건: the press sustains
      startHold(id, x, y, pointerId);
      return true;
    }
    if (altP.type === 'marquee') { altMarqueeStart(x, y, pointerId); return true; }
    if (W.input === 'drag') startSlash(x, y, pointerId);   // 카타나: the drag preview AND the 발도 charge
    /* §A4: 남은 탄이 모자라면 충전이 시작되지 않고 빈 클릭 소리가 난다. The press is still live — letting go
     * under 120 ms is still the ordinary attack, which is the one thing that must never be taken away.
     * The empty click therefore waits out those 120 ms: it is the answer to "I tried to CHARGE and could
     * not", and firing it on contact would make every ordinary click on a last round sound like a failure. */
    if (!altCanAfford(id, ALT_AMMO)) {
      altP.blocked = true;
      altP.timer = later(() => { altP.timer = 0; if (altP.on && altP.blocked) emptyClick(); }, ALT_MIN_MS);
      return true;
    }
    altP.reserved = altReserve(id, ALT_AMMO);
    altChargeFxStart(id);
    altStepArm();
    return true;
  }
  /* Pointer movement during a press (from onMove). §A5: 카타나는 드래그 12px 이상이면 발도가 취소되고
   * 평소 베기가 된다. 붕괴도 같은 기준으로 갈린다. */
  function altPressMove(x, y) {
    if (!altP.on) return;
    if (altP.marquee) { altMarqueeMove(x, y); return; }
    if (!altActive()) return;
    if (Math.hypot(x - altP.x, y - altP.y) >= ALT_DRAG_CANCEL && WEAPONS[altP.id].input === 'drag') {
      altCancel('drag', true);   // the slash itself stays live: resolveSlash() will do the ordinary cut
    }
  }
  /* Called from onHoldEnd (pointerup). Returns true when the release was consumed here. */
  /* The release decision, computed ONCE so the pointerup wrapper and altPressUp() can never disagree about
   * whether the katana's drag cut is about to be replaced by a 발도. */
  function altWantAlt() {
    if (!altP.on) return false;
    const a = altOf(altP.id);
    if (!a || altP.blocked || WEAPONS[altP.id].hold || a.type === 'burst' || a.type === 'marquee') return false;
    if ((now() - altP.at) < ALT_MIN_MS) return false;
    /* §A2 저격총: 호흡 정지는 "2초 제한"이다. A breath you cannot hold any longer is not a steadier shot —
     * past the window the release is the ordinary bolt-action round, which is also what the crosshair has
     * been saying since the sway came back. */
    if (altP.id === 'sniper') return altBreathHeld();
    return a.type === 'charge' ? true : altCharged();
  }
  function altPressUp(x, y, decided) {
    if (!altP.on) return false;
    const id = altP.id, W = WEAPONS[id], a = altOf(id);
    const p = altChargeP();
    if (isFinite(x) && isFinite(y)) { altP.x = x; altP.y = y; }
    const px0 = altP.x, py0 = altP.y;
    if (altP.marquee) { const m = altMarqueeEnd(); altEnd(); altMarqueeFire(m, px0, py0); return true; }
    if (W.hold) { altEnd(); return true; }   // stopHold() (wrapped below) owns the short-press branch
    altChargeFxEnd();
    const reserved = altP.reserved;
    /* §A1 rule 1 and §A5's "완충이 아니면 일반 공격으로 떨어진다", in one place. */
    const wantAlt = (decided === undefined) ? altWantAlt() : !!decided;
    if (!wantAlt) {
      altP.reserved = 0;
      altRefund(id, reserved);
      altEnd();
      altNormalAttack(id, px0, py0);
      return true;
    }
    altP.on = false;   // the attack below must not be read as "still charging" by the crosshair
    altFire(id, px0, py0, a.type === 'charge' ? p : 1);
    altEnd();
    return true;
  }
  /* The ordinary attack the press falls back to. The katana's live drag decides stab vs slash on its own. */
  function altNormalAttack(id, x, y) {
    if (WEAPONS[id].input === 'drag') { resolveSlash(x, y); return; }
    if (state.slash) cancelSlash();
    smashAt(x, y, id);
  }
  /* §A5 중단 조건 — pointercancel, lostpointercapture, blur, visibilitychange, Escape, 무기 교체, 재장전
   * 시작, KO. Every one of them lands here, and every one of them refunds. */
  function altCancel(why, keepSlash) {
    if (!altP.on) return false;
    const id = altP.id, reserved = altP.reserved;
    altP.reserved = 0;
    altChargeFxEnd();
    if (altP.marquee) altMarqueeEnd();
    altRefund(id, reserved);
    altP.cancels++; altP.lastCancel = String(why || 'cancel');
    altEnd(keepSlash);
    return true;
  }
  /* §A5 Escape. Only a CHARGE (or a marquee being dragged) is a layer Escape should eat; a sustained hold is
   * not — Escape has always meant "stop and get out" there, and this must not quietly become "stop". The
   * press record is dropped either way, so the stopHold() that follows cannot read the exit as a short press
   * and fire a parting 3점사. */
  function altEscape() {
    if (altActive() || altP.marquee) { altCancel('escape'); return true; }
    if (altP.on) altEnd();
    return false;
  }
  function altEnd(keepSlash) {
    altP.on = false; altP.id = null; altP.pointerId = null; altP.type = null;
    altP.blocked = false; altP.reserved = 0; altP.maxed = false; altP.maxAt = 0; altP.lock = null;
    untrack(altP.timer); altP.timer = 0;
    altClearNodes();
    if (!keepSlash && state.slash) cancelSlash();
    altChargeFxEnd();
    placeCrosshairSafe();
  }
  function placeCrosshairSafe() { try { if (state.active) placeCrosshair(); } catch (e) { /* ignore */ } }

  /* The charge's heartbeat: it drives the radius preview, the lock brackets and the max-charge cue. The
   * RESULT never reads it — altChargeP() reads the clock — so a dropped frame can only cost a redraw. */
  function altStepArm() {
    untrack(altP.timer);
    altP.timer = later(altStep, ALT_STEP_MS);
  }
  function altStep() {
    altP.timer = 0;
    if (!altActive()) return;
    const p = altChargeP();
    altChargeFxStep(p);
    if (p >= 1 && !altP.maxed) { altP.maxed = true; altP.maxAt = now(); altChargeMaxCue(); }
    placeCrosshairSafe();
    altStepArm();
  }

  /* ===================================================================== */
  /* §A2 the ten alt attacks (plus the two new weapons' two)                 */
  /* ===================================================================== */
  function altFire(id, x, y, p) {
    if (id === 'hammer' || id === 'axe') return altSmash(id, x, y, p);
    if (id === 'pistol') return altAimedShot(x, y);
    if (id === 'sniper') return altHeldBreathShot(x, y);
    if (id === 'katana') return altIaido(x, y, p);
    if (id === 'bomb') return altFuseBomb(x, y, p);
    if (id === 'rocket') return altGuidedRocket(x, y);
    // ── §C / §D ──
    if (id === 'shockwave') return altShockBlast(x, y, p);
    if (id === 'rubber') return altRubberSpray(x, y, p);
    if (id === 'squeaky') return altSqueakSmash(x, y, p);
    if (id === 'horn') return altHornBlast(x, y, p);
    if (id === 'chicken') return altChickenFling(x, y, p);
    return null;
  }

  /* ── §C 충격포 보조: 반경 260 → 420, 충격량 ×1.8 ─────────────────────────────────────────────────── */
  function altShockBlast(x, y, p) {
    const a = ALTS.shockwave, W = WEAPONS.shockwave;
    const R = Math.round(a.radius + (a.radiusMax - a.radius) * p);
    const imp = W.impulse * (1 + (a.impulseMul - 1) * p);
    return altAction('shockwave', x, y, () => {
      state.shots++;
      const BW = Object.assign({}, W, { radius: R, impulse: imp, rings: (W.rings || []).map((r) => r * (R / W.radius)), maxTargets: W.maxTargets + 4 });
      interceptOrbsWithin(x, y, R);
      sfx('shockwave', { gain: 1.25, pitch: 0.82 });
      flash(x, y, 'bomb', { size: R, dur: 140 });
      ring(x, y, { r: R });
      shake('bomb', { amp: 10 + 6 * p, dur: 380 });
      blastMark(x, y, R, 0.4, { ink: 0.4, weapon: BW });
      const pushed = ixPushRadial(x, y, R, imp, { maxTargets: BW.maxTargets });
      for (const el of pushed) {
        if (!el.isConnected) continue;
        const crit = rollCrit('shockwave');
        applyHit(el, rollDamage(W.damage, crit), 'bomb', x, y, { crit, aoe: true, radius: R, toward: { x, y } });
      }
      startCooldown('shockwave', W.cooldownMs);
      return null;
    });
  }
  /* ── §C 고무탄 보조: 반경 150 안의 요소 전부에 고무를 입힌다 ─────────────────────────────────────── */
  function altRubberSpray(x, y, p) {
    const a = ALTS.rubber, W = WEAPONS.rubber;
    const R = Math.max(24, a.radius * p);
    return altAction('rubber', x, y, () => {
      state.shots++;
      interceptOrbsWithin(x, y, R);
      sfx('boing', { gain: 1.2, pitch: 0.8 });
      flash(x, y, 'gun', { size: R, dur: 160 });
      ring(x, y, { r: R });
      shake('gun', { amp: 3 });
      const cands = aoeCandidates(x, y, R, 10, [R * 0.4, R * 0.75, R], false);
      let n = 0;
      for (const c of cands) {
        const crit = rollCrit('rubber');
        applyHit(c.el, rollDamage(Math.round(W.damage * (1 + (a.dmgMul - 1) * p)), crit), 'gun', x, y, { crit, aoe: true, toward: { x, y } });
        let alive = false;
        try { alive = c.el.isConnected && !c.el.hasAttribute('data-crs-broken'); } catch (e) { alive = false; }
        if (alive && ixMakeBouncy(c.el, W.bouncyMs)) n++;
      }
      return null;
    });
  }
  /* ── §D 뿅망치 보조: 반경 90 을 한 번에. 소리도 별도 그대로다 ───────────────────────────────────── */
  function altSqueakSmash(x, y, p) {
    const a = ALTS.squeaky, W = WEAPONS.squeaky;
    const R = Math.max(14, a.radius * p);
    const mul = 1 + (a.dmgMul - 1) * p;
    return altAction('squeaky', x, y, () => {
      state.shots++;
      interceptOrbsWithin(x, y, R);
      sfx('squeak', { gain: 1.3, pitch: 0.7 });
      flash(x, y, 'hammer', { size: R * 2, dur: 220 });
      ring(x, y, { r: R });
      shake('hammer', { amp: 3 + 2 * p });
      ixStars(x, y, randInt(7, 12));
      for (const c of aoeCandidates(x, y, R, 8, [R * 0.4, R * 0.8, R], false)) {
        const crit = rollCrit('squeaky');
        applyHit(c.el, rollDamage(Math.round(W.damage * mul), crit), 'hammer', x, y, { crit, aoe: true, toward: { x, y } });
        ixSquash(c.el);                      // 피해 뒤에 — reactDamage() 가 cancelAnimsOf(el) 로 시작한다
      }
      return null;
    });
  }
  /* ── §D 나팔 보조: 원뿔이 1.6배로 길어지고 그만큼 세진다 ─────────────────────────────────────────── */
  function altHornBlast(x, y, p) {
    const a = ALTS.horn;
    const scale = 1 + (a.rangeMul - 1) * p;
    return altAction('horn', x, y, () => {
      state.shots++;
      ixHornAt(x, y, scale);
      startCooldown('horn', WEAPONS.horn.cooldownMs);
      return null;
    });
  }
  /* ── §D 고무 치킨 보조: 완충이면 20% 가 아니라 반드시 걸린다 ───────────────────────────────────── */
  function altChickenFling(x, y, p) {
    const a = ALTS.chicken, W = WEAPONS.chicken;
    const mul = 1 + (a.dmgMul - 1) * p;
    return altAction('chicken', x, y, () => {
      state.shots++;
      if (interceptOrb(x, y)) return null;
      const el = pickTarget(x, y);
      const crit = el ? rollCrit('chicken') : false;
      sfx('chicken', { gain: 1.3, pitch: 0.75 });
      flash(x, y, 'hammer', { size: 70, dur: 180 });
      shake('hammer', { amp: 2.4 });
      if (!el) return null;
      applyHit(el, rollDamage(Math.round(W.damage * mul), crit), 'hammer', x, y, { crit });
      let alive = false;
      try { alive = el.isConnected && !el.hasAttribute('data-crs-broken'); } catch (e) { alive = false; }
      /* The charge BUYS the certainty: a full charge always sticks, a half charge is half-way between the
       * weapon's own 20 % and 100 %. That is what §A5's "charge 유형만 중간값을 보간한다" means here. */
      if (alive && (debug.noQuirk ? false : (debug.forceQuirk || Math.random() < W.bouncyChance + (1 - W.bouncyChance) * p))) ixMakeBouncy(el, WEAPONS.rubber.bouncyMs);
      return el;
    });
  }

  /* 망치 내려치기 / 도끼 회전 베기 (§A2). Both are a radius: the hammer crushes everything inside 120 px for
   * ×2.2, the axe sweeps 160 px and leaves every one of them in TWO pieces for ×1.6. `p` interpolates both the
   * multiplier and the radius, which is what §A5 means by "charge 유형만 중간값을 보간한다". */
  function altSmash(id, x, y, p) {
    const a = altOf(id), W = WEAPONS[id];
    const mul = 1 + (a.dmgMul - 1) * p;
    const R = Math.max(18, a.radius * p);
    return altAction(id, x, y, () => {
      state.shots++;
      interceptOrbsWithin(x, y, R);
      const dmg = Math.max(1, Math.round(W.damage * mul));
      sfx('hammer', { gain: 1.25, pitch: id === 'axe' ? 0.7 : 0.85 });
      sfx('crit', { gain: 0.7 });
      flash(x, y, 'hammer', { size: R * 2, dur: 260 });
      ring(x, y, { r: R });
      shake('hammer', { amp: 9 + 5 * p, dur: 320 });
      drawCrack(x, y, 'hammer', { rays: [6, 9], lenScale: 1.1 + p, ink: 1 });
      const cands = aoeCandidates(x, y, R, id === 'axe' ? 14 : 10, [R * 0.35, R * 0.7, R], false);
      for (const c of cands) {
        const crit = rollCrit(id);
        const fall = 1 - 0.45 * clamp(c.d / Math.max(1, R), 0, 1);   // a radius attack, not a blast: a gentler edge than aoeHit's 0.73
        const dd = rollDamage(Math.round(dmg * fall), crit);
        const opts = { crit, aoe: true, radius: R, toward: { x, y } };
        /* §A2 도끼: "반경 160px 전부를 2조각으로". The split line is the sweep's own TANGENT at each target —
         * perpendicular to the spoke from the pivot — so the whole radius reads as ONE turn of the blade
         * rather than ten unrelated breaks. */
        if (id === 'axe') {
          const cr = rectOf(c.el);
          const ecx = cr ? cr.left + cr.width / 2 : x, ecy = cr ? cr.top + cr.height / 2 : y;
          const ang = Math.atan2(ecy - y, ecx - x) + Math.PI / 2;
          Object.assign(opts, { pieces: 2, textSplit: false, splitLine: { angle: ang, cx: ecx, cy: ecy } });
        }
        const fire = () => { if (state.active && c.el.isConnected) applyHit(c.el, dd, 'hammer', x, y, opts); scheduleHud(); };
        const delay = c.d / 4;
        if (delay < 1) fire(); else later(fire, delay);
      }
      return null;
    });
  }

  /* 권총 정조준 (§A2): 산포 0, 피해 ×1.4. Only ever fired at full charge (§A5 steady). */
  function altAimedShot(x, y) {
    const W = WEAPONS.pistol;
    return altAction('pistol', x, y, () => {
      state.shots++;
      if (interceptOrb(x, y)) return null;            // the aim point is EXACT: no shotPoint(), no bloom
      const el = pickTarget(x, y);
      const crit = el ? rollCrit('pistol') : false;
      const dmg = rollDamage(Math.round(W.damage * altOf('pistol').dmgMul), crit, falloffMul('pistol', x, y));
      sfx('gun', { crit, gain: 1.15, pitch: 0.92 });
      flash(x, y, 'gun', { size: 44 }); shake('gun', { amp: 3 });
      drawCrack(x, y, 'gun', { ink: 0.4 });
      spawnChips(x, y, randInt(4, 6));
      if (el) applyHit(el, dmg, 'gun', x, y, { crit });
      noteShot('pistol');                              // the KICK still lands on the NEXT shot
      return el;
    });
  }

  /* 저격총 호흡 정지 (§A2): 흔들림 0, 치명타 40%, 2초 제한. The steadiness is LIVE while the breath is held —
   * spreadNow() is wrapped below — so the crosshair arms visibly close before the shot is taken. */
  function altBreathHeld() {
    return altP.on && altP.id === 'sniper' && altCharged() && (now() - altP.at) <= scaleMs(altChargeMs('sniper') + ALTS.sniper.holdMs);
  }
  function altHeldBreathShot(x, y) {
    const W = WEAPONS.sniper;
    return altAction('sniper', x, y, () => {
      state.shots++;
      if (interceptOrb(x, y)) return null;
      const el = pickTarget(x, y);
      const crit = debug.forceCrit ? true : (debug.noCrit ? false : Math.random() < ALTS.sniper.crit);
      const dmg = rollDamage(W.damage, crit);
      sfx('sniper', { crit });
      flash(x, y, 'gun', { size: 70 }); shake('gun', { amp: 5 });
      drawCrack(x, y, 'gun', { ink: 0.6 });
      if (el) applyHit(el, dmg, 'gun', x, y, { crit, headshot: crit });
      noteShot('sniper');
      return el;
    });
  }

  /* 카타나 발도 (§A2): 화면 가로 전체 수평 호, 최대 16개, ×1.8, 관통 2. The horizontal arc is a real curve —
   * the same quadratic the drag slash uses — bowed through a point above the line, so the blade reads as one
   * drawn stroke across the page rather than a ruler. */
  function altIaido(x, y, p) {
    const a = ALTS.katana, W = WEAPONS.katana;
    if (state.slash) cancelSlash();
    const vw = viewW();
    /* §A5 charge: the draw's REACH is what the charge buys. A third of the screen at 120 ms, the whole
     * width at full charge — and the damage multiplier and the target cap ride the same `p`. */
    const half = (vw / 2 + 20) * Math.max(0.35, p);
    const x1 = x - half, x2 = x + half;
    const mul = 1 + (a.dmgMul - 1) * p;
    const cap = Math.max(4, Math.round(a.maxTargets * p));
    /* The quadratic is written out rather than taken from fracMakeCurve(): that helper bows the control
     * point by 12 % of the CHORD, and this chord is the whole screen — the "arc" would lift 105 px off the
     * aim line and sail clean over everything the player was pointing at. A 발도 is a flat horizontal draw
     * with a hint of curve in it, so the control point is a fixed 40 px above the line whatever the reach. */
    const cu0 = { x1, y1: y, x2, y2: y, cx: x, cy: y - 40, len: x2 - x1 };
    return altAction('katana', x2, y, () => {
      state.shots++;
      const cu = fracSetCurve(cu0);
      const angle = fracCurveAngle(cu, 0.5);
      const cache = new Map(), seen = new Set(), hits = [];
      for (const s of fracCurveSamples(cu, 22)) {
        if (hits.length >= cap) break;
        if (s.x < 0 || s.y < 0 || s.x > vw || s.y > viewH()) continue;
        const el = pickTarget(s.x, s.y, cache);
        if (el && !seen.has(el)) { seen.add(el); hits.push(el); }
      }
      interceptOrbsAlong(x1, y, x2, y, 24);
      sfx('katanaDraw', { gain: 1.25 });
      sfx('katanaAir', { gain: 1.2 });
      if (hits.length) later(() => sfx('katanaRing', { gain: 1.1 }), 40);
      slashFx(x1, y, x2, y);
      drawSlash(x1, y, x2, y);
      shake('hammer', { amp: 6 });
      for (const el of hits) {
        const crit = rollCrit('katana');
        const dmg = rollDamage(Math.round(W.damage * mul), crit);
        const r = rectOf(el);
        const cx = r ? clamp(r.left + r.width / 2, 0, vw) : x;
        applyHit(el, dmg, 'hammer', cx, y, { crit, slash: true, pieces: 2, textSplit: false, splitLine: { angle, cx, cy: y }, toward: { x: cx, y } });
        /* §A2 관통 2: the draw keeps going through what it cut, exactly as the sniper's pierce does. */
        for (const b of pierceTargets(cx, y, el, a.pierce)) {
          const c2 = rollCrit('katana');
          applyHit(b, rollDamage(Math.round(W.damage * mul * 0.6), c2), 'hammer', cx, y, { crit: c2, pierce: 1, pieces: 2, textSplit: false, splitLine: { angle, cx, cy: y } });
        }
      }
      later(() => { if (fracGetCurve() === cu) fracSetCurve(null); }, 0);
      return null;
    });
  }

  /* 폭탄 심지 조절 (§A2): 반경 160 → 340. The rings scale with the radius so the candidate sampling stays
   * proportional, exactly as blastWeaponAt() already does for the burning case. */
  function altFuseBomb(x, y, p) {
    const a = ALTS.bomb, W = WEAPONS.bomb;
    const R = Math.round(a.radius + (a.radiusMax - a.radius) * p);
    return altAction('bomb', x, y, () => {
      state.shots++;
      const k = R / W.radius;
      const BW = Object.assign({}, W, { radius: R, rings: (W.rings || []).map((r) => r * k), maxTargets: W.maxTargets + 4 });
      interceptOrbsWithin(x, y, R);
      sfx('bomb', { gain: 1.2 });
      blastFx(x, y, R, 1.2, { amp: 13 + 6 * p, dur: 460 }, BW);
      blastIgnite(x, y, BW, BURN_BOMB_DIRECT, BURN_BOMB_SPLASH);
      aoeHit(x, y, BW);
      startCooldown('bomb', W.cooldownMs);
      return null;
    });
  }

  /* 로켓 유도 조준 (§A2): 지정한 요소로 휘어 날아감. The element is designated AT FULL CHARGE (that is what
   * the brackets say), and the rocket then curves to its centre even if the pointer has moved off it — which
   * is the whole reason the lock exists: "엄폐 뒤의 적을 치는 또 하나의 수단". */
  function altGuidedRocket(x, y) {
    const el = (altP.lock && altP.lock.isConnected) ? altP.lock : pickTarget(x, y);
    const r = el ? rectOf(el) : null;
    const tx = r ? r.left + r.width / 2 : x, ty = r ? r.top + r.height / 2 : y;
    return altAction('rocket', tx, ty, () => {
      state.shots++;
      sfx('whoosh', { gain: 1.2 });
      if (!root) { rocketImpact(tx, ty); return null; }
      const sx = viewW() / 2, sy = viewH() + 20;
      const flightMs = reducedMotion() ? 60 : 420;
      const n = mk('div', 'crs-rocket crs-rocket-guided');
      n.style.left = px(sx); n.style.top = px(sy); n.style.width = '30px'; n.style.height = '9px';
      n.style.borderRadius = '5px';
      n.style.background = 'linear-gradient(90deg, rgba(138,180,255,0), #8ab4ff 35%, #fff)';
      n.style.boxShadow = '0 0 12px 4px rgba(138,180,255,.8)';
      root.append(n);
      /* The curve is the point of it: a guided rocket that flew straight would be an ordinary one. Three
       * waypoints along a quadratic bowed off the chord, written as discrete keyframes so the rotation can
       * follow the tangent without a second animation. */
      const bowX = (tx - sx) * 0.5 - (ty - sy) * 0.33, bowY = (ty - sy) * 0.5 + (tx - sx) * 0.33;
      const frames = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8, u = 1 - t;
        const qx = u * u * 0 + 2 * u * t * bowX + t * t * (tx - sx);
        const qy = u * u * 0 + 2 * u * t * bowY + t * t * (ty - sy);
        const nx = 2 * u * bowX + 2 * t * ((tx - sx) - bowX), ny = 2 * u * bowY + 2 * t * ((ty - sy) - bowY);
        frames.push({ transform: 'translate(' + px(qx) + ', ' + px(qy) + ') translate(-50%, -50%) rotate(' + Math.atan2(ny, nx).toFixed(4) + 'rad)', offset: t });
      }
      try { trackAnim(n.animate(frames, { duration: flightMs, easing: 'linear', fill: 'forwards' })); } catch (e) { /* ignore */ }
      later(() => { try { n.remove(); } catch (e) { /* ignore */ } rocketImpact(tx, ty); }, flightMs);
      startCooldown('rocket', WEAPONS.rocket.cooldownMs);
      return null;
    });
  }

  /* ── 붕괴 범위 지정 (§A2 marquee) ─────────────────────────────────────────
   * A dashed rectangle is dragged and only what it CONTAINS comes down. Under the 12 px threshold (§A5 "붕괴도
   * 같은 기준으로 갈린다") the press is the ordinary全 chain. */
  function altMarqueeStart(x, y, pointerId) {
    if (!root) return;
    try { if (shield && pointerId != null) shield.setPointerCapture(pointerId); } catch (e) { /* ignore */ }
    const n = mk('div', 'crs-marquee');
    const lab = mk('span', 'crs-marquee-n');
    n.append(lab);
    n.style.left = px(x); n.style.top = px(y); n.style.width = '0px'; n.style.height = '0px';
    root.append(n);
    altP.marquee = { x1: x, y1: y, x2: x, y2: y, node: n, label: lab, count: 0, timer: 0 };
    /* The count is recomputed on a heartbeat, not only on pointermove. A drag that stops moving still has a
     * box, and "포함된 요소 수" that was last computed when the box was 0 × 0 is not a readout, it is a lie. */
    const beat = () => {
      const m = altP.marquee;
      if (!m) return;
      m.timer = 0;
      m.countAt = 0;
      altMarqueeMove(m.x2, m.y2);
      m.timer = later(beat, 100);
    };
    altMarqueeMove(x, y);
    altP.marquee.timer = later(beat, 100);
  }
  function altMarqueeBox(m) {
    return { left: Math.min(m.x1, m.x2), top: Math.min(m.y1, m.y2), width: Math.abs(m.x2 - m.x1), height: Math.abs(m.y2 - m.y1) };
  }
  function altMarqueeMove(x, y) {
    const m = altP.marquee;
    if (!m) return;
    m.x2 = x; m.y2 = y;
    const b = altMarqueeBox(m);
    try {
      m.node.style.left = px(b.left); m.node.style.top = px(b.top);
      m.node.style.width = px(b.width); m.node.style.height = px(b.height);
    } catch (e) { /* ignore */ }
    /* §A3 마지막 줄: "범위 지정은 사각형이 점선으로 그려지고 포함된 요소 수가 표시된다." Re-counted at most
     * every 100 ms — the count is a readout, and a page walk per pointermove is a page walk per pixel. */
    const t = now();
    if (!m.countAt || t - m.countAt > 100) {
      m.countAt = t;
      m.count = altMarqueeTargets(b).length;
      try { m.label.textContent = String(m.count); } catch (e) { /* ignore */ }
    }
  }
  function altMarqueeTargets(b) {
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const cands = walkCandidates(cx, cy, { limit: 0.25 * viewW() * viewH() });
    const out = [];
    for (const c of cands) {
      /* The §2.3 walk memo is up to 300 ms old and the rect it carries with it older still — and this box
       * is being dragged RIGHT NOW. Every candidate is re-measured here so the count under the cursor is
       * the count the release will really take. */
      const r = rectOf(c.el);
      if (!r || r.width < 1 || r.height < 1) continue;
      if (r.left >= b.left - 2 && r.top >= b.top - 2 && r.right <= b.left + b.width + 2 && r.bottom <= b.top + b.height + 2) out.push(c);
    }
    return out;
  }
  function altMarqueeEnd() {
    const m = altP.marquee;
    altP.marquee = null;
    if (!m) return null;
    untrack(m.timer); m.timer = 0;
    try { m.node.remove(); } catch (e) { /* ignore */ }
    try { if (shield && altP.pointerId != null && shield.hasPointerCapture(altP.pointerId)) shield.releasePointerCapture(altP.pointerId); } catch (e) { /* ignore */ }
    return m;
  }
  function altMarqueeFire(m, x, y) {
    if (!m) return;
    const b = altMarqueeBox(m);
    if (Math.max(b.width, b.height) < ALT_DRAG_CANCEL) { smashAt(x, y, 'collapse'); return; }
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    action('collapse', cx, cy, () => {
      state.shots++;
      sfx('rumble');
      flash(cx, cy, 'collapse'); shake('collapse');
      const targets = altMarqueeTargets(b);
      let i = 0;
      for (const c of targets) {
        const d = i++;
        later(() => {
          if (!state.active || !c.el.isConnected || c.el.hasAttribute('data-crs-broken')) return;
          const r = rectOf(c.el);
          if (!r || r.width < 1 || r.height < 1) return;
          breakElement(c.el, cx, cy, { mode: 'collapse', pieces: r.width * r.height < 40000 ? 2 : 1, cloneCap: 300, away: { x: 0, y: 1 } });
          state.hp.delete(c.el);
          updateHud();
        }, 30 + d * 25);
      }
      state.hintCollapse = true;
      startCooldown('collapse', WEAPONS.collapse.cooldownMs);
      return null;
    });
  }

  /* ===================================================================== */
  /* §A2 burst — the four weapons whose SHORT press is the alt              */
  /* ===================================================================== */
  /* 기관총 3점사 (§A2): 산포 ×0.5, 3발. */
  function altBurstSmg(x, y) {
    if (!altCanAfford('smg', ALTS.smg.rounds)) { emptyClick(); return false; }
    altSpreadMul = ALTS.smg.spreadMul;
    for (let i = 0; i < ALTS.smg.rounds; i++) {
      later(() => {
        if (!state.active) return;
        altSpreadMul = ALTS.smg.spreadMul;
        smashAt(state.hoverX, state.hoverY, 'smg');
        if (i === ALTS.smg.rounds - 1) altSpreadMul = 1;
      }, i * 45);
    }
    later(() => { altSpreadMul = 1; }, ALTS.smg.rounds * 45 + 40);
    return true;
  }
  /* 미니건 고정 사격 (§A2 / §B3): 예열 후 20발을 자동으로 쏘고 멈춘다. 그 동안 확산 절반. */
  function altFixedFire(x, y) {
    const W = WEAPONS.minigun;
    if (!altCanAfford('minigun', 1)) { emptyClick(); return false; }
    mg.fixed = { left: W.fixedRounds, timer: 0 };
    altSpreadMul = ALTS.minigun.spreadMul;
    const wait = mgSpunUp() ? 0 : W.spinUpMs;
    mgSpinStart();
    const step = () => {
      const f = mg.fixed;
      if (!f) return;
      f.timer = 0;
      if (!state.active || f.left <= 0) { mgFixedStop(); return; }
      f.left--;
      altSpreadMul = ALTS.minigun.spreadMul;
      if (!smashAt(state.hoverX, state.hoverY, 'minigun')) { mgFixedStop(); return; }
      f.timer = later(step, W.tickMs);
    };
    mg.fixed.timer = later(step, wait);
    return true;
  }
  function mgFixedStop() {
    const f = mg.fixed;
    mg.fixed = null;
    altSpreadMul = 1;
    if (f) untrack(f.timer);
    mgSpinRelease();
  }
  /* 레이저 단발 펄스 (§A2 / §B2): 90, 즉발, 열 +25. */
  function altLaserPulse(x, y) {
    if (lzOverheated()) { emptyClick(); return false; }
    const a = ALTS.laser;
    action('laser', x, y, () => {
      state.shots++;
      lzAddHeat(a.heat);
      if (interceptOrb(x, y)) return null;
      const el = pickTarget(x, y);
      const crit = el ? rollCrit('laser') : false;
      const dmg = rollDamage(a.damage, crit);
      sfx('laserPulse');
      flash(x, y, 'gun', { size: 54, dur: 130 });
      shake('gun', { amp: 2.4 });
      drawCrack(x, y, 'gun', { ink: 0.35 });
      lzBeamFlash(x, y, 150);
      lzCutPoint(x, y);
      if (el) applyHit(el, dmg, 'gun', x, y, { crit });
      return el;
    });
    return true;
  }

  /* ── §C 견인 광선 보조 (짧게): 붙잡지 않고 한 번 확 당긴다 ────────────────────────────────────────
   * A hold weapon's short press is its alt (§A2 burst). The beam has no magazine, so the price is the same
   * cooldown a release pays — nothing here is free. */
  function altTractorYank(x, y) {
    const W = WEAPONS.tractor;
    if (onCooldown()) { cooldownFeedback(); return false; }
    const el = pickTarget(x, y);
    if (!el) { emptyClick(); return false; }
    const o = ixOrigin();
    const r = rectOf(el);
    const cx = r ? r.left + r.width / 2 : x, cy = r ? r.top + r.height / 2 : y;
    const dx = o.x - cx, dy = o.y - cy, L = Math.hypot(dx, dy) || 1;
    const b = displaceEl(el, (dx / L) * W.yankImpulse, (dy / L) * W.yankImpulse, { spin: rand(-90, 90) });
    state.shots++;
    sfx('tractor', { gain: 1.2, pitch: 1.2 });
    flash(cx, cy, 'gun', { size: 50, dur: 140 });
    shake('gun', { amp: 2 });
    startCooldown('tractor', W.releaseCdMs);
    kick();
    return !!b;
  }
  /* ── §D 물총 보조 (짧게): 물풍선. 한 번에 넓게 적신다 ───────────────────────────────────────────
   * §A4 gives the burst alts bespoke costs (3점사는 3발, 화염탄은 연료 12); the balloon is 연료 8. */
  function altWaterBalloon(x, y) {
    const a = ALTS.watergun, W = WEAPONS.watergun;
    if (onCooldown()) { cooldownFeedback(); return false; }
    if (!altSpendRounds('watergun', a.fuel)) { emptyClick(); return false; }
    state.shots++;
    const R = a.splashR;
    sfx('water', { gain: 1.3, pitch: 0.7 });
    flash(x, y, 'gun', { size: R, dur: 170 });
    ring(x, y, { r: R });
    ixSplash(x, y, randInt(8, 14));
    let n = 0;
    for (const c of aoeCandidates(x, y, R, 10, [R * 0.4, R * 0.8, R], false)) {
      const crit = rollCrit('watergun');
      applyHit(c.el, rollDamage(W.damage, crit), 'gun', x, y, { crit, aoe: true, toward: { x, y } });
      let alive = false;
      try { alive = c.el.isConnected && !c.el.hasAttribute('data-crs-broken'); } catch (e) { alive = false; }
      if (!alive) continue;
      try { douseEl(c.el, BURN_WATER_STACKS); } catch (e) { /* ignore */ }
      if (ixWet(c.el, W.wetMs)) n++;
    }
    startCooldown('watergun', 500);
    scheduleHud();
    return n >= 0;
  }
  /* The magazine side of a bespoke burst cost. Same shape as spendFuel() (src/77-burn.js), generalised to
   * any id so the water balloon does not need a second copy of it. */
  function altSpendRounds(id, n) {
    const W = WEAPONS[id];
    if (!W || W.mag == null || debug.infiniteAmmo) return true;
    const have = state.ammo[id] || 0;
    if (have < n) return false;
    state.ammo[id] = Math.max(0, have - n);
    if (state.ammo[id] <= 0) state.pendingReload = id;
    updateAmmoHud();
    return true;
  }

  /* §A2's spread halving for the two burst attacks that ask for one. spreadNow() is wrapped at the bottom. */
  let altSpreadMul = 1;

  /* ===================================================================== */
  /* §B2 레이저 커터 — 열 · 빔 · 절단선                                      */
  /* ===================================================================== */
  const lz = { heat: 0, overheatUntil: 0, lastFireAt: 0, coolTimer: 0, beam: null, cut: [], cutNodes: [], lastEl: null, peak: 0 };
  const LZ_CUT_MAX = 60;              // §B2: 충돌 지점의 궤적을 기록해(최대 60점)
  const LZ_COOL_MS = 600;             // §B2: 0.6초에 걸쳐 흰 고열 → 주황 → 검은 흉터

  function lzHeat() { return lz.heat; }
  function lzOverheated() { return now() < lz.overheatUntil; }
  function lzHeatRatio() { return clamp(lz.heat / WEAPONS.laser.heatMax, 0, 1); }
  function lzAddHeat(n) {
    const W = WEAPONS.laser;
    lz.heat = clamp(lz.heat + n, 0, W.heatMax);
    /* A HIGH-WATER MARK, because the top of the gauge is an instant: the forced cool starts draining it in
     * the same breath, so "did it ever actually reach 100?" cannot be answered by sampling — not by a test
     * and not by a player glancing at it. The product remembers instead. */
    if (lz.heat > lz.peak) lz.peak = lz.heat;
    lz.lastFireAt = now();
    if (lz.heat >= W.heatMax) lzOverheat();
    lzCoolArm();
    updateAmmoHud();
  }
  function lzOverheat() {
    const W = WEAPONS.laser;
    lz.heat = W.heatMax;
    lz.overheatUntil = now() + scaleMs(W.overheatMs);
    sfx('overheat');
    if (state.hold && state.hold.id === 'laser') stopHold(true);
    lzBeamOff();
    toast(msg('toastOverheat'));
    updateAmmoHud();
  }
  /* §B2 냉각: 정지 0.4초 뒤 초당 28. One self-rescheduling later() chain, never setInterval, and it stops
   * itself the moment the gauge is empty — so an idle laser costs no timers at all. */
  function lzCoolArm() {
    if (lz.coolTimer || !state.active) return;
    lz.coolTimer = later(lzCoolStep, 100);
  }
  function lzCoolStep() {
    lz.coolTimer = 0;
    if (!state.active) { lz.heat = 0; return; }
    const W = WEAPONS.laser;
    const firing = !!(state.hold && state.hold.id === 'laser');
    const idle = now() - lz.lastFireAt;
    if (!firing && idle >= scaleMs(W.coolDelayMs) && !lzOverheated()) lz.heat = clamp(lz.heat - W.coolPerSec * 0.1, 0, W.heatMax);
    /* The forced cool is derived from its own DEADLINE rather than stepped down 4 at a time. The two timers
     * are phase-locked (the beam ticks every 50 ms, this chain every 100 ms, both armed from the same
     * instant), so a decrementing version drained its first 4 points in the same millisecond the gauge
     * reached 100 — the gauge never actually showed a full bar, which is the one thing 과열 has to show.
     * Reading the deadline also makes it drift-free: a dropped step costs a frame, never 4 points. */
    else if (!firing && lzOverheated()) lz.heat = clamp(W.heatMax * ((lz.overheatUntil - now()) / Math.max(1, scaleMs(W.overheatMs))), 0, W.heatMax);
    updateAmmoHud();
    if (lz.heat > 0 || lzOverheated() || firing) lz.coolTimer = later(lzCoolStep, 100);
  }
  /* §B2 빔: 중심 3px 흰색, 바깥 9px 글로우 마젠타 #ff4d9d. div 를 회전·신축해 그린다 — 캔버스가 아니다.
   * 열이 오를수록 글로우가 주황 → 흰색으로 이동하고 과열 직전엔 떨린다. */
  const LZ_MAGENTA = '#ff4d9d';
  function lzOrigin() {
    const a = state.avatar;
    if (a && isFinite(state.player.x)) return { x: state.player.x, y: state.player.y };
    return { x: viewW() * 0.82, y: viewH() + 6 };
  }
  function lzBeamOn(x, y) {
    if (!root) return null;
    if (!lz.beam || !lz.beam.glow.isConnected) {
      const glow = mk('div', 'crs-laser-glow');
      const core = mk('div', 'crs-laser-core');
      root.append(glow, core);
      lz.beam = { glow, core };
    }
    const o = lzOrigin();
    const len = Math.hypot(x - o.x, y - o.y), ang = Math.atan2(y - o.y, x - o.x);
    const h = lzHeatRatio();
    const jitter = h > 0.85 && !reducedMotion() ? rand(-2, 2) : 0;
    const glowCol = lzGlowColor(h);
    for (const [n, w, col] of [[lz.beam.glow, 9, glowCol], [lz.beam.core, 3, '#ffffff']]) {
      n.style.left = px(o.x); n.style.top = px(o.y + jitter);
      n.style.width = px(len); n.style.height = px(w);
      n.style.transformOrigin = '0 50%';
      n.style.transform = 'translateY(' + px(-w / 2) + ') rotate(' + ang.toFixed(4) + 'rad)';
      n.style.background = col;
    }
    lz.beam.glow.style.boxShadow = '0 0 14px 4px ' + glowCol;
    return lz.beam;
  }
  /* 주황 → 흰색: the glow leaves magenta through orange as the barrel loads up, and is white hot at the top.
   * "열 게이지를 안 봐도 안다" — so the colour has to move continuously, not in steps. */
  function lzGlowColor(h) {
    if (h < 0.5) return LZ_MAGENTA;
    const t = clamp((h - 0.5) / 0.35, 0, 1);
    if (t < 1) { const r = 255, g = Math.round(77 + (170 - 77) * t), b = Math.round(157 - 157 * t * 0.7); return 'rgb(' + r + ',' + g + ',' + b + ')'; }
    const u = clamp((h - 0.85) / 0.15, 0, 1);
    return 'rgb(255,' + Math.round(170 + 85 * u) + ',' + Math.round(47 + 208 * u) + ')';
  }
  function lzBeamOff() {
    const b = lz.beam;
    lz.beam = null;
    if (!b) return;
    for (const n of [b.glow, b.core]) { try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } }
  }
  function lzBeamFlash(x, y, ms) {
    const b = lzBeamOn(x, y);
    if (!b) return;
    later(() => { if (lz.beam === b && !(state.hold && state.hold.id === 'laser')) lzBeamOff(); }, ms || 120);
  }
  /* §B2 절단선: "다른 무기는 어디를 맞히는가지만 레이저는 어디를 따라 지나가는가다." Every contact point is
   * recorded (60 max) and the segment between two of them is drawn as its own div, cooling white → orange →
   * black scar over 0.6 s. The scar stays: it is what the累積 cut is made of. */
  function lzCutPoint(x, y) {
    const prev = lz.cut.length ? lz.cut[lz.cut.length - 1] : null;
    lz.cut.push({ x, y, at: now() });
    while (lz.cut.length > LZ_CUT_MAX) lz.cut.shift();
    if (!prev || !root) return;
    if (Math.hypot(x - prev.x, y - prev.y) < 3) return;      // standing still is not a cut
    const n = mk('div', 'crs-laser-cut');
    const len = Math.hypot(x - prev.x, y - prev.y), ang = Math.atan2(y - prev.y, x - prev.x);
    n.style.left = px(prev.x); n.style.top = px(prev.y);
    n.style.width = px(len); n.style.height = '3px';
    n.style.transformOrigin = '0 50%';
    n.style.transform = 'translateY(-1.5px) rotate(' + ang.toFixed(4) + 'rad)';
    n.style.background = '#ffffff';
    root.append(n);
    lz.cutNodes.push(n);
    while (lz.cutNodes.length > LZ_CUT_MAX) { const old = lz.cutNodes.shift(); try { old.remove(); } catch (e) { /* ignore */ } }
    try {
      trackAnim(n.animate([
        { background: '#ffffff', boxShadow: '0 0 8px 2px rgba(255,255,255,.9)', offset: 0 },
        { background: '#ff9a3c', boxShadow: '0 0 5px 1px rgba(255,154,60,.6)', offset: 0.45 },
        { background: 'rgba(18,16,16,.85)', boxShadow: '0 0 0 0 rgba(0,0,0,0)', offset: 1 }
      ], { duration: reducedMotion() ? 120 : LZ_COOL_MS, easing: 'linear', fill: 'forwards' }));
    } catch (e) { /* ignore */ }
  }
  /* §B2 "누적 절단선이 요소를 가로지르면 그 궤적을 따라 나뉜다. 지그재그로 끌면 지그재그로 잘린다."
   * A CROSSING is the honest test: the recorded path must come from outside the element, pass through it and
   * leave again. The entry / exit / middle of that run become the three points of the very same quadratic the
   * katana's cut is built from, so a zig-zag drag really does leave a bowed cut rather than a straight chord. */
  function lzCutCurveFor(el) {
    const r = rectOf(el);
    if (!r || r.width < 6 || r.height < 6 || lz.cut.length < 3) return null;
    const inside = (p) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
    let i = 0;
    while (i < lz.cut.length) {
      if (!inside(lz.cut[i])) { i++; continue; }
      let j = i;
      while (j + 1 < lz.cut.length && inside(lz.cut[j + 1])) j++;
      const beforeOut = i > 0 && !inside(lz.cut[i - 1]);
      const afterOut = j + 1 < lz.cut.length && !inside(lz.cut[j + 1]);
      if (beforeOut && afterOut && j > i) {
        const a = lz.cut[i - 1], b = lz.cut[j + 1], m = lz.cut[Math.floor((i + j) / 2)];
        const span = Math.hypot(b.x - a.x, b.y - a.y);
        if (span >= Math.min(r.width, r.height) * 0.8) return fracMakeCurve(a.x, a.y, b.x, b.y, m);
      }
      i = j + 1;
    }
    return null;
  }
  function lzTrySever(el, x, y) {
    if (!el || !el.isConnected) return false;
    try { if (el.hasAttribute('data-crs-broken')) return false; } catch (e) { return false; }
    if (!damageable(el)) return false;
    const cu = lzCutCurveFor(el);
    if (!cu) return false;
    fracSetCurve(cu);
    sfx('katanaRing', { gain: 0.7 });
    breakElement(el, x, y, { mode: 'gun', pieces: 2, textSplit: false, cloneCap: 300, splitLine: { angle: fracCurveAngle(cu, 0.5), cx: x, cy: y } });
    state.hp.delete(el);
    later(() => { if (fracGetCurve() === cu) fracSetCurve(null); }, 0);
    /* The cut that did the severing is consumed, or the next tick would sever whatever is behind it along a
     * path it never travelled. */
    lz.cut.length = 0;
    refreshHover();
    scheduleHud();
    return true;
  }
  /* §B2: a crossing is only complete once the beam has come OUT the other side — and by then the beam is no
   * longer ON the element, so the tick that would have noticed is never aimed at it. fireLaser() hands over
   * whatever the previous tick hit, and the hold's end hands over the last one, so leaving an element is
   * what triggers its sever. */
  function lzSeverAt(el, x, y) {
    const prev = lz.lastEl;
    lz.lastEl = el || null;
    if (prev && prev !== el) lzTrySever(prev, x, y);
  }
  function lzSeverLast() {
    const prev = lz.lastEl;
    lz.lastEl = null;
    if (prev && lz.cut.length) { const p = lz.cut[lz.cut.length - 1]; lzTrySever(prev, p.x, p.y); }
  }
  function lzReset() {
    lz.heat = 0; lz.overheatUntil = 0; lz.lastFireAt = 0; lz.peak = 0;
    untrack(lz.coolTimer); lz.coolTimer = 0;
    lz.cut.length = 0; lz.lastEl = null;
    lzBeamOff();
    for (const n of lz.cutNodes) { try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } }
    lz.cutNodes.length = 0;
  }

  /* ===================================================================== */
  /* §B3 미니건 — 예열 · 공회전 유예 · 총열 회전 · 반동 밀림                  */
  /* ===================================================================== */
  const mg = { spinAt: 0, idleUntil: 0, rot: 0, rotAt: 0, timer: 0, fixed: null, anim: null };
  function mgSpunUp() { return now() < mg.idleUntil; }          // §B3 공회전 유예 0.6초
  function mgSpinning() { return !!(state.hold && state.hold.id === 'minigun') || !!mg.fixed || mgSpunUp(); }
  function mgSpinStart() {
    mg.spinAt = now();
    mgArtSpin(true);
    if (!mg.timer) mg.timer = later(mgStep, 50);
  }
  function mgSpinRelease() {
    mg.idleUntil = now() + scaleMs(WEAPONS.minigun.idleGraceMs);
    if (!mg.timer) mg.timer = later(mgStep, 50);
  }
  function mgStep() {
    mg.timer = 0;
    if (!state.active) { mgReset(); return; }
    const t = now();
    const dt = mg.rotAt ? Math.min(0.2, (t - mg.rotAt) / 1000) : 0;
    mg.rotAt = t;
    if (mgSpinning()) mg.rot = (mg.rot + 900 * dt) % 360;       // 2.5 turns a second: fast enough to read, slow enough to see
    placeCrosshairSafe();
    if (mgSpinning()) mg.timer = later(mgStep, 50);
    else { mg.rot = 0; mg.rotAt = 0; mgArtSpin(false); placeCrosshairSafe(); }
  }
  function mgArmSpin() { return (state.weapon === 'minigun' && mgSpinning()) ? mg.rot : 0; }
  /* §B3 "총열 묶음 6개가 분리된 SVG 그룹이라 실제로 돌아가는 게 보인다." The group is `[data-part="barrels"]`
   * in the minigun drawing (src/44-weapon-art.js); it is rotated in the VIEWMODEL, which is the copy big enough
   * for six barrels to be told apart. */
  function mgArtSpin(on) {
    const holder = vm.holder;
    if (!holder) return;
    let g = null;
    try { g = holder.querySelector('[data-part="barrels"]'); } catch (e) { g = null; }
    if (!g) return;
    if (mg.anim) { try { mg.anim.cancel(); } catch (e) { /* ignore */ } state.anims.delete(mg.anim); mg.anim = null; }
    if (!on || reducedMotion()) return;
    try {
      g.style.setProperty('transform-origin', '150px 70px');
      g.style.setProperty('transform-box', 'view-box');
      mg.anim = trackAnim(g.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 400, iterations: Infinity, easing: 'linear' }));
    } catch (e) { mg.anim = null; }
  }
  function mgReset() {
    untrack(mg.timer); mg.timer = 0;
    if (mg.fixed) { untrack(mg.fixed.timer); mg.fixed = null; }
    mg.spinAt = 0; mg.idleUntil = 0; mg.rot = 0; mg.rotAt = 0;
    if (mg.anim) { try { mg.anim.cancel(); } catch (e) { /* ignore */ } state.anims.delete(mg.anim); mg.anim = null; }
    altSpreadMul = 1;
  }

  /* ===================================================================== */
  /* §A3 충전 피드백                                                         */
  /* ===================================================================== */
  function altChargeFxStart(id) {
    const a = altOf(id);
    if (!a || !a.ms) return;
    sfx('charge', { ms: a.ms });                        // §A3: 음정이 올라가는 톤 (사인 180→420Hz)
    vmCharge(a.ms);                                     // §A3: 뷰모델이 뒤로 당겨지거나 위로 들린다
    if (a.radius || a.radiusMax) altRadiusNodeOn();
  }
  function altChargeFxStep(p) {
    const id = altP.id, a = altOf(id);
    if (!a) return;
    if (altP.radiusNode) {
      const R = a.radiusMax ? (a.radius + (a.radiusMax - a.radius) * p) : a.radius * p;
      try {
        altP.radiusNode.style.width = px(2 * R); altP.radiusNode.style.height = px(2 * R);
        altP.radiusNode.style.left = px(altP.x); altP.radiusNode.style.top = px(altP.y);
      } catch (e) { /* ignore */ }
    }
    if (a.type === 'lock') altLockStep(p);
  }
  function altChargeMaxCue() {
    sfx('chargeMax');                                   // §A3: 최대에서 짧은 클릭
    vmChargeMax();                                      // §A3: 최대에서 미세하게 떨린다 (모션 축소 시 생략)
    const ring = xhair.ring;
    if (!ring) return;
    try { ring.classList.add('crs-ch-ring-full'); } catch (e) { /* ignore */ }
    if (reducedMotion()) return;                        // §A3: 모션 축소 시 뷰모델 떨림과 번쩍임을 뺀다
    try { trackAnim(ring.animate([{ filter: 'brightness(3.2)' }, { filter: 'brightness(1)' }], { duration: 120, easing: 'ease-out', fill: 'none' })); } catch (e) { /* ignore */ }
  }
  function altChargeFxEnd() {
    vmChargeEnd();
    const ring = xhair.ring;
    if (ring) { try { ring.classList.remove('crs-ch-ring-full'); } catch (e) { /* ignore */ } }
  }
  function altRadiusNodeOn() {
    if (!root || altP.radiusNode) return;
    const n = mk('div', 'crs-charge-r');
    n.style.width = '0px'; n.style.height = '0px';
    n.style.left = px(altP.x); n.style.top = px(altP.y);
    root.append(n);
    altP.radiusNode = n;
  }
  /* §A3 "유도는 지정 요소에 괄호가 붙는다." The brackets appear the moment the lock is full and then follow
   * the designated element — it may be scrolling, and a bracket that stayed put would be a lie. */
  function altLockStep(p) {
    if (p < 1) return;
    if (!altP.lock || !altP.lock.isConnected) {
      const el = pickTarget(altP.x, altP.y);
      if (!el) return;
      altP.lock = el;
    }
    const r = rectOf(altP.lock);
    if (!r) return;
    if (!altP.lockNode && root) {
      const n = mk('div', 'crs-charge-lock');
      for (let i = 0; i < 4; i++) n.append(mk('span', 'crs-charge-lock-c crs-charge-lock-c' + i));
      root.append(n);
      altP.lockNode = n;
      sfx('clack');
    }
    if (!altP.lockNode) return;
    try {
      altP.lockNode.style.left = px(r.left); altP.lockNode.style.top = px(r.top);
      altP.lockNode.style.width = px(r.width); altP.lockNode.style.height = px(r.height);
    } catch (e) { /* ignore */ }
  }
  function altClearNodes() {
    for (const k of ['radiusNode', 'lockNode']) {
      const n = altP[k];
      altP[k] = null;
      if (n) { try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } }
    }
    if (altP.marquee) { untrack(altP.marquee.timer); try { altP.marquee.node.remove(); } catch (e) { /* ignore */ } altP.marquee = null; }
  }

  /* §B2 HUD: 탄약 패널이 열 게이지로 바뀐다. updateAmmoHud() (src/82) is wrapped rather than edited — the
   * magazine readout it writes is exactly right for every other weapon and the heat gauge simply takes the
   * panel over when the laser is in hand. */
  function altHeatHud() {
    const heatOn = state.weapon === 'laser';
    const bar = hudEls.aHeat, fill = hudEls.aHeatFill, lab = hudEls.aHeatLabel;
    if (!bar) return;
    try {
      bar.classList.toggle('on', heatOn);
      if (hudEls.aPips) hudEls.aPips.style.display = heatOn ? 'none' : '';
      if (!heatOn) return;
      const h = lzHeatRatio();
      fill.style.width = (h * 100).toFixed(1) + '%';
      fill.style.background = lzGlowColor(h);
      bar.classList.toggle('over', lzOverheated());
      lab.textContent = lzOverheated() ? msg('labelOverheat') : (Math.round(h * 100) + '%');
      if (hudEls.aBig) { hudEls.aBig.textContent = lzOverheated() ? msg('labelOverheat') : String(Math.round(WEAPONS.laser.heatMax - lz.heat)); hudEls.aBig.style.display = ''; }
      if (hudEls.aDim) { hudEls.aDim.textContent = ''; hudEls.aDim.style.display = ''; }
      if (hudEls.aPrompt) hudEls.aPrompt.classList.remove('on');
    } catch (e) { /* ignore */ }
  }

  /* ===================================================================== */
  /* wiring — every one of these is a WRAP, never a fork                     */
  /* ===================================================================== */
  /* §A3: the readiness ring is reused with a different colour. The charge takes it over, and the laser's heat
   * and the minigun's spin-up own it whenever they are what the player is waiting on. */
  const chRingNowBase = chRingNow;
  chRingNow = function (t) {
    if (altActive() && !altP.blocked) return { kind: 'charge', p: altChargeP(), color: ALT_RING };
    if (state.weapon === 'laser' && (lz.heat > 0 || lzOverheated())) return { kind: 'heat', p: lzHeatRatio(), color: lzOverheated() ? '#e5484d' : lzGlowColor(lzHeatRatio()) };
    const h = state.hold;
    if (h && h.id === 'minigun' && h.spinUntil && t < h.spinUntil) return { kind: 'spin', p: clamp(1 - (h.spinUntil - t) / Math.max(1, scaleMs(WEAPONS.minigun.spinUpMs)), 0, 1), color: ALT_RING };
    return chRingNowBase(t);
  };
  /* §A3: 조준점 팔이 안쪽으로 모인다 (gap 최대 40% 축소). The spread link is untouched — the shrink is a
   * FACTOR on whatever chGap() already computed, so a charging smg still shows its bloom, just closer in. */
  const chGapBase = chGap;
  chGap = function () { return chGapBase() * (1 - ALT_GAP_SHRINK * altChargeP()); };
  /* §B3: 조준점 팔도 함께 회전한다. */
  const chPlaceArmsBase = chPlaceArms;
  chPlaceArms = function () {
    const spin = mgArmSpin();
    if (spin) { xhair.gap = -1; xhair.armLen = -1; }   // the rotation moves every frame: never take the no-op path
    chPlaceArmsBase();
    if (!spin) return;
    const gap = xhair.gap, len = xhair.armLen;
    if (!(len > 0)) return;
    for (let i = 0; i < xhair.arms.length; i++) {
      try { xhair.arms[i].style.transform = 'translate(-50%, -50%) rotate(' + (i * 90 + spin).toFixed(1) + 'deg) translateY(' + px(-(gap + len / 2)) + ')'; } catch (e) { /* ignore */ }
    }
  };
  /* §A2 저격총: 호흡 정지 중에는 흔들림 0. §A2 기관총/미니건: 보조 사격 동안 확산 절반. */
  const spreadNowBase = spreadNow;
  spreadNow = function (id) {
    if (altBreathHeld() && (id || state.weapon) === 'sniper') return 0;
    const s = spreadNowBase(id);
    return altSpreadMul === 1 ? s : s * altSpreadMul;
  };
  /* §A5: 재장전 시작 · 무기 교체 cancel the charge (and refund). */
  const altSetWeaponBase = setWeapon;
  setWeapon = function (rawId, opts) {
    if (altP.on) altCancel('swap');
    mgFixedStop();
    return altSetWeaponBase(rawId, opts);
  };
  const altStartReloadBase = startReload;
  startReload = function (id, manual) {
    if (altP.on) altCancel('reload');
    return altStartReloadBase(id, manual);
  };
  const altShowKoBase = showKo;
  showKo = function () { if (altP.on) altCancel('ko'); mgFixedStop(); return altShowKoBase(); };
  const altOnBlurBase = onWindowBlur;
  onWindowBlur = function () { altCancel('blur'); mgFixedStop(); return altOnBlurBase(); };
  const altOnVisibilityBase = onVisibility;
  onVisibility = function () { if (doc.visibilityState === 'hidden') { altCancel('visibility'); mgFixedStop(); } return altOnVisibilityBase(); };
  /* §A5: pointercancel / lostpointercapture. onHoldEnd also carries the ordinary pointerup, which is the
   * RELEASE — altPressUp() owns that one. */
  const altOnHoldEndBase = onHoldEnd;
  onHoldEnd = function (e) {
    if (!state.active) return altOnHoldEndBase(e);
    if (e.type === 'pointerup' && e.button !== 0) return altOnHoldEndBase(e);
    const mine = altP.on && (altP.pointerId == null || e.pointerId == null || e.pointerId === altP.pointerId);
    if (!mine) return altOnHoldEndBase(e);
    if (e.type !== 'pointerup') { const r = altOnHoldEndBase(e); altCancel(e.type); return r; }
    const hold = !!state.hold;
    const want = hold ? false : altWantAlt();
    /* The base resolves a live katana drag on pointerup. When the 발도 is what is about to come out, the
     * drag cut must be taken off the table FIRST — or one press would land two attacks. */
    if (want && state.slash) cancelSlash();
    const r = altOnHoldEndBase(e);                       // stops the hold / resolves the slash exactly as before
    if (!hold) altPressUp(e.clientX, e.clientY, want);   // a charge weapon: the release is ours
    else { altP.on = false; altEnd(true); }
    return r;
  };
  const altOnMoveBase = onMove;
  onMove = function (e) {
    const r = altOnMoveBase(e);
    if (state.active && altP.on) altPressMove(e.clientX, e.clientY);
    return r;
  };
  /* §A2 burst: the SHORT press is the alt on the four weapons that sustain on a long one. stopHold() already
   * owned this gesture for the 화염방사기 (§F6 of SPEC-destruction); the other three join it here, and the
   * 화염방사기's own branch stays exactly where it was. */
  const altStopHoldBase = stopHold;
  stopHold = function (silent) {
    const h = state.hold;
    const id = h ? h.id : null;
    const dt = h ? now() - h.startedAt : 0;
    const spun = id === 'minigun' && h && h.spinUntil && now() < h.spinUntil;
    const live = !!(altP.on && altP.id === id);
    const r = altStopHoldBase(silent);
    if (id === 'laser') { lzBeamOff(); lzCoolArm(); lzSeverLast(); }
    /* §B3 공회전 유예 0.6초 is the reward for having got the barrels UP to speed. A trigger let go DURING the
     * 예열 never did, so it earns no grace — otherwise the 고정 사격 that follows a short press would skip
     * the very spin-up the short press failed to finish. */
    if (id === 'minigun' && !mg.fixed) { if (spun) { mg.idleUntil = 0; mgArtSpin(false); } else mgSpinRelease(); }
    if (silent || !id) return r;
    if (!live) return r;                                 // not a pointer release: api.restore / swap / KO never fire an alt
    if (dt >= ALT_MIN_MS && !spun) return r;             // a real sustained burst: no alt
    if (id === 'smg') altBurstSmg(state.hoverX, state.hoverY);
    else if (id === 'laser') altLaserPulse(state.hoverX, state.hoverY);
    else if (id === 'minigun') altFixedFire(state.hoverX, state.hoverY);
    // ── SPEC-arsenal §C / §D: the two hold weapons the arsenal grew by ──
    else if (id === 'tractor') altTractorYank(state.hoverX, state.hoverY);
    else if (id === 'watergun') altWaterBalloon(state.hoverX, state.hoverY);
    return r;
  };
  /* §B2 / §B3: the two new hold weapons' own gates — the laser may be overheated, the minigun has to spin up
   * before it can fire a round. Both live in the hold chain so every other rule (ammo, swap, cap) is unchanged. */
  const altStartHoldBase = startHold;
  startHold = function (id, x, y, pointerId) {
    if (id === 'laser' && lzOverheated()) { emptyClick(); return false; }
    const r = altStartHoldBase(id, x, y, pointerId);
    if (!r) return r;
    const h = state.hold;
    if (!h) return r;
    if (id === 'minigun') mgSpinStart();
    if (id === 'laser') { lz.lastFireAt = now(); lzCoolArm(); }
    return r;
  };
  const altHoldStepBase = holdStep;
  holdStep = function () {
    const h = state.hold;
    if (!h || !state.active) return altHoldStepBase();
    /* §B3 예열: the window has to be armed on the FIRST tick, not after startHold() returns — startHold()
     * calls holdStep() itself before it hands control back, so a window written afterwards would arrive one
     * round too late and the minigun would fire instantly every time. */
    if (h.id === 'minigun' && h.spinUntil === undefined) {
      h.spinUntil = mgSpunUp() ? 0 : now() + scaleMs(WEAPONS.minigun.spinUpMs);
      if (h.spinUntil) sfx('spinup');
    }
    if (h.id === 'minigun' && h.spinUntil && now() < h.spinUntil) {   // §B3 예열 0.8초: the trigger is down, nothing comes out yet
      h.timer = later(holdStep, 30);
      return;
    }
    if (h.id === 'minigun' && h.spinUntil) { h.spinUntil = 0; mg.idleUntil = now() + scaleMs(WEAPONS.minigun.idleGraceMs); }
    if (h.id === 'laser') {
      if (lzOverheated()) { stopHold(true); return; }
      lzAddHeat(WEAPONS.laser.heatPerTick);
      if (lzOverheated()) return;                                     // lzAddHeat() already stopped the hold
    }
    return altHoldStepBase();
  };
  /* §B3 서바이벌: "연사 중 드론이 조준 반대로 초당 40px 밀린다. 자리를 잡고 쏘는 무기가 된다." */
  const MG_PUSH = 40;
  const altAvatarStepBase = avatarStep;
  avatarStep = function (t, dt) {
    const r = altAvatarStepBase(t, dt);
    const firing = !!(state.hold && state.hold.id === 'minigun' && !state.hold.spinUntil) || !!mg.fixed;
    if (!firing || !(dt > 0) || !state.avatar) return r;
    const p = state.player;
    const dx = state.hoverX - p.x, dy = state.hoverY - p.y, L = Math.hypot(dx, dy);
    if (!(L > 1)) return r;
    p.x = clamp(p.x - (dx / L) * MG_PUSH * dt, 0, viewW());
    p.y = clamp(p.y - (dy / L) * MG_PUSH * dt, 0, viewH());
    return r;
  };
  const altAmmoHudBase = updateAmmoHud;
  updateAmmoHud = function () { const r = altAmmoHudBase(); altHeatHud(); return r; };
  /* restore() (Z / Escape / deactivate) must leave NOTHING of ours: no node, no timer, no reserved round.
   * It runs BEFORE the base so the base's own node sweep and clearTimers() see an already-quiet module. */
  const altRestoreBase = restore;
  restore = function () { altResetAll(); return altRestoreBase(); };
  function altResetAll() {
    altCancel('restore');
    altEnd();
    altP.fired = 0;
    lzReset();
    mgReset();
    altSpreadMul = 1;
  }

  /* ---- debug surface (the suite is written against these) ------------------------------------------ */
  debug.alt = () => ({
    on: altP.on, id: altP.id, type: altP.type, charging: altActive(), p: +altChargeP().toFixed(3),
    maxed: altP.maxed, blocked: altP.blocked, reserved: altP.reserved, elapsed: Math.round(altElapsed()),
    minMs: ALT_MIN_MS, chargeMs: altP.id ? altChargeMs(altP.id) : 0, cancels: altP.cancels, lastCancel: altP.lastCancel,
    lock: !!(altP.lock && altP.lock.isConnected), lockNode: !!(altP.lockNode && altP.lockNode.isConnected),
    radiusNode: altP.radiusNode ? Math.round(parseFloat(altP.radiusNode.style.width) / 2) : null,
    marquee: altP.marquee ? Object.assign(altMarqueeBox(altP.marquee), { count: altP.marquee.count }) : null,
    breathHeld: altBreathHeld(), spreadMul: altSpreadMul
  });
  debug.altTable = () => {
    const out = {};
    for (const id of WEAPON_IDS) { const a = altOf(id); out[id] = a ? { type: a.type, ms: a.ms || 0 } : null; }
    return out;
  };
  debug.laser = () => ({
    heat: +lz.heat.toFixed(2), peak: +lz.peak.toFixed(2), ratio: +lzHeatRatio().toFixed(3), overheated: lzOverheated(),
    overheatMs: WEAPONS.laser.overheatMs, cutPoints: lz.cut.length, cutNodes: lz.cutNodes.length,
    beam: !!(lz.beam && lz.beam.core && lz.beam.core.isConnected), glow: lz.beam ? lz.beam.glow.style.background : null,
    cooling: !!lz.coolTimer
  });
  debug.minigun = () => {
    const h = state.hold;
    return {
      spinning: mgSpinning(), spunUp: mgSpunUp(), rot: Math.round(mg.rot),
      spinUntil: (h && h.id === 'minigun' && h.spinUntil) ? Math.round(h.spinUntil - now()) : 0,
      fixedLeft: mg.fixed ? mg.fixed.left : 0, idleGraceMs: WEAPONS.minigun.idleGraceMs
    };
  };
  /* The suite drives the real gesture through the real listeners wherever it can; these two are for the
   * cases where a synthetic pointer sequence cannot express "hold for exactly N ms" without measuring the
   * harness instead of the product. */
  /* A charge is TIME, and every number the suite cares about — the ring's fill, the arm gap closing, the
   * heat climbing, the barrels spinning up — moves every frame. Sampling those over CDP measures the
   * protocol (25–40 ms a round trip) rather than the product, so the whole window is sampled INSIDE the page
   * on real animation frames and handed back in ONE hop. `t` is the product's own clock, so a dropped frame
   * shows up as a gap in the series instead of silently shifting every later reading. */
  debug.altSamples = (ms) => new Promise((resolve) => {
    const out = [], t0 = now(), want = clamp(+ms || 400, 50, 6000);
    const h0 = state.hold;
    const step = () => {
      const r = chRingNow(now());
      const h = state.hold;
      out.push({
        t: Math.round(now() - t0), p: +altChargeP().toFixed(3), gap: +chGap().toFixed(2),
        ring: r ? r.kind : null, ringP: r ? +clamp(r.p, 0, 1).toFixed(3) : null, ringColor: r ? r.color : null,
        maxed: altP.maxed, on: altP.on, spreadMul: altSpreadMul,
        radius: altP.radiusNode ? Math.round(parseFloat(altP.radiusNode.style.width) / 2) : null,
        lock: !!(altP.lockNode && altP.lockNode.isConnected),
        heat: +lz.heat.toFixed(2), overheated: lzOverheated(),
        spin: mgSpinning(), rot: Math.round(mg.rot),
        spinLeft: (h && h.id === 'minigun' && h.spinUntil) ? Math.max(0, Math.round(h.spinUntil - now())) : 0,
        shots: state.shots, mag: WEAPONS[state.weapon].mag == null ? null : state.ammo[state.weapon],
        holding: !!h, sameHold: h === h0,
        cutNodes: lz.cutNodes.length, beam: !!(lz.beam && lz.beam.core && lz.beam.core.isConnected)
      });
      if (now() - t0 >= want) { resolve(out); return; }
      raf(step);
    };
    raf(step);
  });
  debug.press = (x, y, id) => altPressDown(id || state.weapon, +x, +y, null);
  debug.release = (x, y) => altPressUp(+x, +y);
  debug.altCancel = (why) => altCancel(why || 'debug');
  debug.heat = (v) => { lz.heat = clamp(+v || 0, 0, WEAPONS.laser.heatMax); if (lz.heat >= WEAPONS.laser.heatMax) lzOverheat(); else { lzCoolArm(); updateAmmoHud(); } return lz.heat; };
