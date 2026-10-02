// ── shared combat helpers: crit/damage rolls (v1.3 §1: no power multiplier), cooldown gate, HUD weapon-button lookup ──
  /* ===================================================================== */
  /* 12. Weapons (v1.1): damage roll, hit feedback, the nine fire() entries, actions   */
  /* ===================================================================== */

  /* ── v1.5 §3: per-weapon stats ─────────────────────────────────────────────
   * Merged INTO the WEAPONS table rather than written into 00-prelude.js, so the
   * one-line-per-weapon table there stays exactly as it was. Every value below is
   * read by real play code — nothing here is decoration:
   *   swapMs    draw time; firing is blocked for it (replaces the flat SWAP_MS)
   *   recoil    viewmodel kick AND the aim punch added to the next shot's spread
   *   bloom     px of spread added per sustained shot (cap bloom × 10)
   *   critChance   replaces the old flat 10 % (`critChanceScoped`: sniper ADS)
   *   knockback    debris velocity multiplier (velocityFor)
   *   moveSpeed    drone movement multiplier — NO drone avatar exists in this
   *                build, so it is carried and reported but not yet wired (see
   *                scratchpad/v15-handoff.md)
   *   falloff   damage × (1 − falloff × min(dist, 900) / 900) from the aim origin
   *   pierce    extra elements hit down the same stack, ×0.6 damage per layer
   *   aoeIgnoresCover   blasts sample by radius, so depth never shields (§10.3)
   * Melee-ness is NOT a new field: `kind === 'hammer'` already means hammer / axe
   * / sword, and that is what the viewmodel swing and the no-spread rule read. */
  /* 붕괴's pierce is "전부" (all). A sentinel integer, not Infinity: Infinity does not survive the structured
   * clone / JSON hop that api.weapons() takes to reach an extension page or a test harness. */
  const PIERCE_ALL = 999;
  const WEAPON_STATS = {
    hammer:   { swapMs: 220, recoil: 1.4, bloom: 0, critChance: 0.12, knockback: 1.0, moveSpeed: 1.00, falloff: 0,    pierce: 0 },
    pistol:   { swapMs: 150, recoil: 0.7, bloom: 0, critChance: 0.10, knockback: 0.7, moveSpeed: 1.10, falloff: 0.25, pierce: 0 },
    smg:      { swapMs: 260, recoil: 0.5, bloom: 6, critChance: 0.06, knockback: 0.6, moveSpeed: 0.95, falloff: 0.40, pierce: 0 },
    sniper:   { swapMs: 420, recoil: 2.0, bloom: 0, critChance: 0.10, critChanceScoped: 0.25, knockback: 1.3, moveSpeed: 0.75, moveSpeedScoped: 0.45, falloff: 0, pierce: 2 },
    axe:      { swapMs: 400, recoil: 1.8, bloom: 0, critChance: 0.15, knockback: 1.4, moveSpeed: 0.85, falloff: 0,    pierce: 0 },
    sword:    { swapMs: 200, recoil: 1.0, bloom: 0, critChance: 0.20, knockback: 1.1, moveSpeed: 1.15, falloff: 0,    pierce: 0 },
    bomb:     { swapMs: 300, recoil: 1.2, bloom: 0, critChance: 0.08, knockback: 1.6, moveSpeed: 0.95, falloff: 0,    pierce: 0, aoeIgnoresCover: true },
    rocket:   { swapMs: 480, recoil: 2.4, bloom: 0, critChance: 0.08, knockback: 2.0, moveSpeed: 0.80, falloff: 0,    pierce: 0, aoeIgnoresCover: true },
    flame:    { swapMs: 340, recoil: 0.3, bloom: 3, critChance: 0.05, knockback: 0.5, moveSpeed: 0.90, falloff: 0.55, pierce: 0 },
    collapse: { swapMs: 500, recoil: 2.6, bloom: 0, critChance: 0,    knockback: 1.2, moveSpeed: 1.00, falloff: 0,    pierce: PIERCE_ALL, aoeIgnoresCover: true }
  };
  for (const id of WEAPON_IDS) Object.assign(WEAPONS[id], WEAPON_STATS[id]);
  /* v1.5 §4: three more determinism switches. noBloom / noRecoil are the two halves of noSpread that a test may
   * want to disable separately; noFalloff is independent of all three — noSpread is about WHERE a shot lands,
   * falloff about how much it hurts once it has landed, so disabling one must not silently disable the other. */
  Object.assign(debug, { noFalloff: false, noBloom: false, noRecoil: false });

  function isMelee(id) { const W = WEAPONS[id || state.weapon]; return !!(W && W.kind === 'hammer'); }
  function swapMsOf(id) { const W = WEAPONS[id]; return (W && W.swapMs > 0) ? W.swapMs : SWAP_MS; }
  function critChanceOf(id, scoped) {
    const W = WEAPONS[id] || WEAPONS[state.weapon];
    if (!W) return 0.1;
    if (scoped && W.critChanceScoped != null) return W.critChanceScoped;
    return W.critChance == null ? 0.1 : W.critChance;
  }
  /* v1.5 §3: the flat 10 % is gone — every weapon rolls its own critChance. `id` defaults to the weapon in hand,
   * which is what every caller means (a hold window, an AoE plan and a slash all belong to the current weapon). */
  function rollCrit(id) { return debug.forceCrit ? true : (debug.noCrit ? false : Math.random() < critChanceOf(id || state.weapon, false)); }
  function rollSniperCrit(scoped) { return debug.forceCrit ? true : (debug.noCrit ? false : Math.random() < critChanceOf('sniper', scoped)); }   // 헤드샷 (v1.2 §2, v1.5 §3)
  /* v1.3 §1: the power multiplier is gone. v1.5 §3: `mul` carries distance falloff and pierce attenuation. */
  function rollDamage(base, crit, mul) { return Math.max(1, Math.round(base * (crit ? 2 : 1) * (mul == null ? 1 : mul))); }
  function reducedMotion() { try { return win.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function weaponBtn(id) { return (hudEls.weaponBtns && hudEls.weaponBtns[id]) || null; }
  function willBreak(el, dmg) { if (!el) return false; const r = state.hp.get(el); return (r ? r.hp : hpMax(el)) - dmg <= 0; }

  /* ── v1.5 §3.2: recoil kick + bloom, one timer-free ledger ─────────────────
   * Both decay purely as a function of (now − lastShotAt), so there is nothing to
   * tick, nothing to cancel on deactivate and nothing to drift: `aim.kick` /
   * `aim.bloom` are the values AT `aim.at`, and every read extrapolates. */
  const aim = { at: 0, kick: 0, bloom: 0 };
  function resetAim() { aim.at = 0; aim.kick = 0; aim.bloom = 0; }
  function recoilKickNow(t) {
    if (!aim.at || debug.noSpread || debug.noRecoil) return 0;
    return aim.kick * (1 - clamp((t - aim.at) / 250, 0, 1));
  }
  function bloomNow(t) {
    if (!aim.at || debug.noSpread || debug.noBloom) return 0;
    const idle = (t - aim.at) - 400;            // 0.4 s of quiet before recovery starts
    return idle <= 0 ? aim.bloom : Math.max(0, aim.bloom - 40 * idle / 1000);   // then 40 px/s
  }
  /* Called by each hitscan shot AFTER its aim point was computed: this shot's kick lands on the NEXT one. */
  function noteShot(id) {
    const W = WEAPONS[id] || WEAPONS[state.weapon];
    if (!W) return;
    const t = now(), b = W.bloom || 0;
    aim.bloom = Math.min(b * 10, bloomNow(t) + b);
    aim.kick = (W.recoil || 0) * 6;
    aim.at = t;
  }
  /* spreadPx = (weapon.spread || 0) + recoilKick + bloomNow. Zero while the sniper is scoped (v1.2 A4 keeps
   * ADS exact) and zero under debug.noSpread. */
  function spreadNow(id) {
    const W = WEAPONS[id || state.weapon];
    if (!W || debug.noSpread) return 0;
    if (W.scope && state.scoped) return 0;
    const t = now();
    return (W.spread || 0) + recoilKickNow(t) + bloomNow(t);
  }
  /* Box–Muller, one sample. Guarded against u === 0 (log(0) → −Infinity). */
  function gauss(sd) {
    if (!(sd > 0)) return 0;
    let u = Math.random();
    if (u < 1e-9) u = 1e-9;
    return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
  }
  /* NOTE: named shotPoint, not aimPoint — src/91-combat-feedback.js already declares an aimPoint() in this
   * same (concatenated) function scope, and the later declaration would silently win. */
  function shotPoint(x, y, id) {
    const s = spreadNow(id);
    if (!(s > 0)) return { x, y };
    return { x: clamp(x + gauss(s), 0, viewW()), y: clamp(y + gauss(s), 0, viewH()) };
  }

  /* ── v1.5 §3: distance falloff ─────────────────────────────────────────────
   * Origin = the screen centre, or the survival drone once one exists (the other
   * v1.5 workstream owns the avatar; `state.drone` is simply absent here, and the
   * guard below starts working the day it lands). */
  function aimOrigin() {
    const d = state.drone;
    if (d && isFinite(d.x) && isFinite(d.y)) return { x: d.x, y: d.y };
    return { x: viewW() / 2, y: viewH() / 2 };
  }
  function falloffMul(id, x, y) {
    const W = WEAPONS[id || state.weapon];
    const f = W ? (W.falloff || 0) : 0;
    if (!(f > 0) || debug.noFalloff) return 1;
    const o = aimOrigin();
    return 1 - f * Math.min(Math.hypot(x - o.x, y - o.y), 900) / 900;
  }

  /* ── v1.5 §3: knockback ────────────────────────────────────────────────────
   * velocityFor() lives in src/65-pieces.js, which this workstream does not own,
   * so the multiplier is applied by wrapping the binding here instead of editing
   * it there. Every producer of debris — breakElement, word splitting, bullet
   * chips — goes through this one function, so one wrapper covers them all.
   * Spin scales at half rate: a rocket that throws debris twice as far should not
   * also make it spin twice as fast, or the pieces read as confetti. */
  const velocityForBase = velocityFor;
  velocityFor = function (mode, ix, iy, cx, cy, opts) {
    const v = velocityForBase(mode, ix, iy, cx, cy, opts);
    const W = WEAPONS[state.weapon];
    const k = (W && W.knockback > 0) ? W.knockback : 1;
    if (k !== 1) { v.vx *= k; v.vy *= k; v.vr *= 1 + (k - 1) * 0.5; }
    return v;
  };
