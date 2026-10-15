  /* ===================================================================== */
  /* 0. Captured globals, constants, generic helpers                        */
  /*    v1.3: POWERS is gone (§1) and the readability numbers of §3 land here */
  /* ===================================================================== */
  const win = window;
  const doc = document;
  const docEl = doc.documentElement;
  const raf = win.requestAnimationFrame.bind(win);
  const caf = win.cancelAnimationFrame.bind(win);
  const setT = win.setTimeout.bind(win);
  const clearT = win.clearTimeout.bind(win);
  const gcsRaw = win.getComputedStyle.bind(win);
  const now = () => win.performance.now();

  const VERSION = '2.0.0';
  /* Weapon table (SPEC-v2 A2 numbers + v1.2 A1 ammo fields). `kind` is the v1 mode vocabulary every primitive
   * consumes (CRACK / flash / shake / sfx / velocityFor / pieceCount / breakElement opts.mode — A10).
   * `mag` = magazine size (null = ∞ / melee), `reloadMs` (null for melee); the slot KEY is no longer a table
   * field: it comes from the loadout order (v1.2 A6). `fire(x, y, ctx)` entries are attached in section 12.
   * WEAPON_IDS is the canonical SET (validation / persistence); `state.loadout` is the ORDER. */
  /* SPEC-arsenal §B1: WEAPON_IDS is the ARSENAL now — every weapon that exists (12 since 레이저 커터 and
   * 미니건 landed). `state.loadout` is a chosen SUBSET of it, at most 10 long, and that subset is what the
   * number keys / Q / E / the HUD grid speak. Nothing else about the id set changed. */
  /* SPEC-arsenal §C (상호작용) · §D (예능), 8단계: the arsenal grows 12 → 19. The three §C weapons ride the
   * displacement system (src/67-displace.js) and the four §D weapons are the 예능 band — weak on paper, each
   * carrying ONE effect that is not damage. Nothing about the loadout changed: it is still at most 10. */
  /* SPEC-arsenal §E (무기 다양화), 9단계: the arsenal grows 19 → 23. The bar for a new weapon is not
   * "피해량이 다른가" but "할 수 있는 일이 다른가" — four new verbs: 밀집한 작은 요소를 한 번에 (샷건),
   * 조각 고정 (못총), 빙결로 피해 증폭 (냉각총), 끌어모으기 (중력탄). 냉각총이 특히 중요하다: 혼자 쓰면
   * 가장 약하고 반드시 다른 무기와 같이 써야 한다 — 로드아웃 구성에 처음으로 조합이라는 개념이 생긴다.
   * The ids are APPENDED, so every existing slot, key and preset keeps the position it had. */
  const WEAPON_IDS = ['hammer', 'pistol', 'smg', 'sniper', 'axe', 'katana', 'bomb', 'rocket', 'flame', 'collapse', 'laser', 'minigun',
    'shockwave', 'tractor', 'rubber', 'squeaky', 'watergun', 'horn', 'chicken',
    'shotgun', 'nailgun', 'freezegun', 'gravity'];
  const LOADOUT_MAX = 10;            // §B1: 숫자키 10칸
  const WEAPONS = {
    hammer:   { id: 'hammer',   emoji: '🔨', name: 'weaponHammer',   kind: 'hammer',   damage: 65,  cooldownMs: 400,  radius: 0,   hold: false, input: 'click', mag: null, reloadMs: null },
    pistol:   { id: 'pistol',   emoji: '🔫', name: 'weaponPistol',   kind: 'gun',      damage: 25,  cooldownMs: 0,    radius: 0,   hold: false, input: 'click', mag: 12, reloadMs: 900 },
    smg:      { id: 'smg',      emoji: '💥', name: 'weaponSmg',      kind: 'gun',      damage: 22,  cooldownMs: 0,    radius: 0,   hold: true,  input: 'hold', tickMs: 70, mag: 30, reloadMs: 1400 },
    sniper:   { id: 'sniper',   emoji: '🎯', name: 'weaponSniper',   kind: 'gun',      damage: 200, cooldownMs: 600,  radius: 0,   hold: false, input: 'click', mag: 3, reloadMs: 1900, spread: 25, scope: true },
    axe:      { id: 'axe',      emoji: '🪓', name: 'weaponAxe',      kind: 'hammer',   damage: 130, cooldownMs: 550,  radius: 0,   hold: false, input: 'click', mag: null, reloadMs: null },
    katana:    { id: 'katana',    emoji: '🗡️', name: 'weaponKatana',    kind: 'hammer',   damage: 60,  cooldownMs: 0,    radius: 0,   hold: false, input: 'drag', stabCooldownMs: 520, mag: null, reloadMs: null },
    bomb:     { id: 'bomb',     emoji: '💣', name: 'weaponBomb',     kind: 'bomb',     damage: 190, cooldownMs: 700,  radius: 240, hold: false, input: 'click', rings: [60, 130, 210], maxTargets: 10, mag: 3, reloadMs: 1800 },
    rocket:   { id: 'rocket',   emoji: '🚀', name: 'weaponRocket',   kind: 'bomb',     damage: 260, cooldownMs: 1200, radius: 360, hold: false, input: 'click', rings: [70, 150, 230, 320], maxTargets: 14, mag: 3, reloadMs: 1400 },
    flame:    { id: 'flame',    emoji: '🔥', name: 'weaponFlame',    kind: 'gun',      damage: 15,  cooldownMs: 0,    radius: 0,   hold: true,  input: 'hold', tickMs: 50, mag: 100, reloadMs: 3400 },
    collapse: { id: 'collapse', emoji: '🌪️', name: 'weaponCollapse', kind: 'collapse', damage: Infinity, cooldownMs: 2000, radius: Infinity, hold: false, input: 'click', mag: 1, reloadMs: 5000 },
    /* ── SPEC-arsenal §B2 레이저 커터 ───────────────────────────────────────────────────────────────
     * No magazine at all: `heat` 0–100 is the resource (heatPerTick / heatPulse / overheatMs / coolDelayMs
     * / coolPerSec below), so `mag` stays null and the ammo panel becomes a heat gauge (src/45-hud.js).
     * `pierce` is the PIERCE_ALL sentinel (999 — src/71 declares the constant, which has not been
     * evaluated yet at this point in the bundle, so the number is written out here) and `pierceFalloff`
     * is §B2's ×0.75 per layer, read by applyPierce() in src/73-hit-resolution.js.
     * The §3.1 stat block is inline rather than in WEAPON_STATS for the same reason the destruction
     * profile is attached in src/78-altfire.js: src/71 and src/66 are not this workstream's files, and
     * `Object.assign(W, undefined)` leaves what is written here alone. */
    laser:    { id: 'laser',    emoji: '🔆', name: 'weaponLaser',   kind: 'gun',      damage: 11,  cooldownMs: 0,    radius: 0,   hold: true,  input: 'hold', tickMs: 50, mag: null, reloadMs: null,
                heat: true, heatPerTick: 2.2, heatPulse: 25, heatMax: 100, overheatMs: 2500, coolDelayMs: 400, coolPerSec: 28, pulseDamage: 90,
                swapMs: 250, recoil: 0.2, bloom: 0, critChance: 0.07, knockback: 0.4, moveSpeed: 1.00, falloff: 0, pierce: 999, pierceFalloff: 0.75 },
    /* ── SPEC-arsenal §B3 미니건 ────────────────────────────────────────────────────────────────────
     * 26 damage every 60 ms = 433/s, the number §B3's table publishes. `spinUpMs` is the 0.8 s 예열 before
     * the first round and `idleGraceMs` the 0.6 s 공회전 유예 that lets a re-press skip it. */
    minigun:  { id: 'minigun',  emoji: '⚙️', name: 'weaponMinigun', kind: 'gun',      damage: 26,  cooldownMs: 0,    radius: 0,   hold: true,  input: 'hold', tickMs: 60, mag: 300, reloadMs: 2600,
                spinUpMs: 800, idleGraceMs: 600, fixedRounds: 20,
                swapMs: 560, recoil: 0.45, bloom: 2.2, critChance: 0.05, knockback: 0.55, moveSpeed: 0.55, falloff: 0.42, pierce: 0 },
    /* ── SPEC-arsenal §C 상호작용 무기 ──────────────────────────────────────────────────────────────
     * All three are built on the displacement system, so what they publish here is not damage but the
     * physics the fire() entries hand to displaceEl(): `impulse` (충격포), `grabMaxMass` (견인 광선),
     * `bouncyMs` / `bounceRest` / `collisionMul` (고무탄). The stat block is inline for the same reason the
     * laser's is: WEAPON_STATS (src/71) is not this workstream's file and Object.assign(W, undefined) leaves
     * what is written here alone.
     * INTERPRETATION (reported): §C gives each weapon its VERB and nothing else — no magazine, no cooldown,
     * no swap time. Those had to be chosen for the weapon to exist in this engine at all; they are picked so
     * the 특수 band of §F4 (40–90 % of the 실전 median) is plausible, and §F itself is 9단계. */
    shockwave:{ id: 'shockwave', emoji: '🌀', name: 'weaponShockwave', kind: 'bomb', damage: 10, cooldownMs: 900, radius: 260, hold: false, input: 'click',
                rings: [70, 150, 230], maxTargets: 14, mag: 4, reloadMs: 1700, impulse: 900,
                swapMs: 360, recoil: 1.6, bloom: 0, critChance: 0.04, knockback: 2.4, moveSpeed: 0.92, falloff: 0, pierce: 0, aoeIgnoresCover: true },
    /* 견인 광선: 길게 눌러 하나를 붙잡는다. No magazine — the price is a cooldown on release (`releaseCdMs`),
     * because a grab is one continuous act and charging it by the tick would turn "hold to carry" into a
     * stopwatch. `grabK` is the spring constant of the cursor follow (1/s). */
    tractor:  { id: 'tractor', emoji: '🛸', name: 'weaponTractor', kind: 'gun', damage: 1, cooldownMs: 0, radius: 0, hold: true, input: 'hold', tickMs: 60,
                mag: null, reloadMs: null, grabMaxMass: 4, grabK: 9, releaseCdMs: 600, yankImpulse: 1500,
                swapMs: 380, recoil: 0, bloom: 0, critChance: 0, knockback: 0, moveSpeed: 0.95, falloff: 0, pierce: 0 },
    rubber:   { id: 'rubber', emoji: '⚪', name: 'weaponRubber', kind: 'gun', damage: 18, cooldownMs: 260, radius: 0, hold: false, input: 'click', mag: 8, reloadMs: 1300,
                bouncyMs: 6000, bounceRest: 0.85, collisionMul: 1.6,
                swapMs: 210, recoil: 0.8, bloom: 3, critChance: 0.05, knockback: 1.2, moveSpeed: 1.05, falloff: 0.20, pierce: 0 },
    /* ── SPEC-arsenal §D 예능 무기 ──────────────────────────────────────────────────────────────────
     * "밸런스 밴드에서 제외하되 … 실효 화력이 중앙값의 25~50%, 그리고 각각 피해가 아닌 고유 효과를 하나씩."
     * `quirk` names that effect so the rule is a field rather than a promise — §D's own table, in the table.
     * 뿅망치 and 고무 치킨 are melee (no magazine), which is also what makes them the fastest things to swing. */
    squeaky:  { id: 'squeaky', emoji: '🎈', name: 'weaponSqueaky', kind: 'hammer', damage: 8, cooldownMs: 185, radius: 0, hold: false, input: 'click', mag: null, reloadMs: null,
                quirk: 'squash', squashMs: 420,
                swapMs: 120, recoil: 0.6, bloom: 0, critChance: 0.10, knockback: 0.9, moveSpeed: 1.20, falloff: 0, pierce: 0 },
    /* 틱 40 ms / 탄창 180: §D fixes the tick DAMAGE at 3 and says nothing about the rate, and 3 damage every
     * 70 ms put the 실효 화력 at 18 % of the 실전 중앙값 — under §D's own 25~50 % floor. §F7's rule ("피해량보다
     * 핸들링을 먼저 건드린다") says which number moves: the published 3 stays and the stream gets finer. */
    watergun: { id: 'watergun', emoji: '💧', name: 'weaponWatergun', kind: 'gun', damage: 3, cooldownMs: 0, radius: 0, hold: true, input: 'hold', tickMs: 50, mag: 180, reloadMs: 1300,
                quirk: 'wet', wetMs: 8000, coolMul: 2.5, splashR: 120,
                swapMs: 200, recoil: 0.2, bloom: 1.5, critChance: 0.03, knockback: 0.3, moveSpeed: 1.05, falloff: 0.45, pierce: 0 },
    horn:     { id: 'horn', emoji: '🎺', name: 'weaponHorn', kind: 'gun', damage: 5, cooldownMs: 520, radius: 420, hold: false, input: 'click', mag: 6, reloadMs: 1500,
                quirk: 'reflect', coneDeg: 90, coneImpulse: 520, rings: [120, 260, 400], maxTargets: 12,
                swapMs: 260, recoil: 0.9, bloom: 0, critChance: 0.04, knockback: 1.5, moveSpeed: 1.05, falloff: 0, pierce: 0 },
    chicken:  { id: 'chicken', emoji: '🐔', name: 'weaponChicken', kind: 'hammer', damage: 12, cooldownMs: 300, radius: 0, hold: false, input: 'click', mag: null, reloadMs: null,
                quirk: 'bouncy', bouncyChance: 0.20,
                swapMs: 110, recoil: 0.5, bloom: 0, critChance: 0.18, knockback: 0.8, moveSpeed: 1.25, falloff: 0, pierce: 0 },
    /* ── SPEC-arsenal §E 무기 다양화 (9단계) ────────────────────────────────────────────────────────
     * 샷건: "펠릿 9발 원뿔. 밀집한 작은 요소를 한 번에. 사거리 감쇠 최대. 한 발씩 장전."
     * `pellets` is a NEW table field and it is what makes 밀집 다수 동시 a number rather than a promise:
     * one shell is nine hitscan rays inside `pelletCone` degrees, each one resolving its own target. The
     * falloff 0.86 is the highest in the arsenal (§E: 사거리 감쇠 최대), and `shellReload` changes reloadMs's
     * meaning — it becomes the time for ONE shell, because this magazine refills one at a time
     * (src/69-utility.js wraps startReload for it). `pelletSpread` is the radius the nine rays scatter in at
     * the aim point. `slugDamage` is the 보조 공격: one solid slug, no cone — §F6-3 의 "슬러그" 가 이것이다. */
    shotgun:  { id: 'shotgun', emoji: '🎇', name: 'weaponShotgun', kind: 'gun', damage: 13, cooldownMs: 400, radius: 0, hold: false, input: 'click',
                mag: 6, reloadMs: 420, shellReload: true, pellets: 9, pelletSpread: 72, slugDamage: 190,
                swapMs: 300, recoil: 2.2, bloom: 0, critChance: 0.08, knockback: 1.5, moveSpeed: 0.92, falloff: 0.86, pierce: 0 },
    /* 못총: "고정. 맞은 조각이 그 자리에 박힌다. 공중에서 멈추고 수명의 영향을 받지 않는다."
     * `pinRadius` is how far from the nail a debris piece is caught, `pinMax` the cap per shot. The pin
     * itself is src/69-utility.js — it freezes the piece's own integrator state and clears its expiry. */
    nailgun:  { id: 'nailgun', emoji: '📌', name: 'weaponNailgun', kind: 'gun', damage: 19, cooldownMs: 0, radius: 0, hold: true, input: 'hold', tickMs: 100,
                mag: 40, reloadMs: 1400, pinRadius: 130, pinMax: 6,
                swapMs: 240, recoil: 0.9, bloom: 1.5, critChance: 0.07, knockback: 0.7, moveSpeed: 1.00, falloff: 0.18, pierce: 1 },
    /* 냉각총: "빙결. 받는 피해 ×1.8, 조각 수 ×2.5, 적은 2초 정지. SPA 리렌더도 묶는다."
     * 피해가 거의 없는 것이 설계다 — §E 가 "혼자 쓰면 가장 약하고 반드시 다른 무기와 같이 써야 한다" 고
     * 적었다. 물총의 젖음이 `ixCoolMul` 로 빙결을 2.5배로 만들어 두었으므로(8단계 §D) 물총 → 냉각총 →
     * 망치가 가장 센 연계가 된다. `utility` 는 §F4 특수 범주의 "제공 효용 환산" 이다 — 아래 §F 주석 참조. */
    freezegun:{ id: 'freezegun', emoji: '❄️', name: 'weaponFreezegun', kind: 'gun', damage: 4, cooldownMs: 0, radius: 0, hold: true, input: 'hold', tickMs: 60,
                mag: 100, reloadMs: 1800, freezePerTick: 7, freezeMul: 1.8, pieceMul: 2.5, stunMs: 2000, frostMs: 5000, shardDamage: 46,
                swapMs: 340, recoil: 0.2, bloom: 0, critChance: 0.03, knockback: 0.3, moveSpeed: 0.90, falloff: 0.30, pierce: 0 },
    /* 중력탄: "끌어모으기. 조각과 적의 탄환을 빨아들인다. 직접 피해 0."
     * 직접 피해가 0 이므로 `effective` 가 0 이 되고, 곱셈으로 된 환산 계수로는 어떤 값을 줘도 0 이다.
     * 그래서 §F4 의 "제공 효용 환산" 은 곱이 아니라 **burstDPS 에 더하는 환산 화력**(`utility`)으로 두었다
     * — 그 무기가 로드아웃에 돌려주는 초당 피해를 적어 둔 숫자다. 유도 과정은 §F 주석에 있다. */
    gravity:  { id: 'gravity', emoji: '🕳️', name: 'weaponGravity', kind: 'bomb', damage: 0, cooldownMs: 900, radius: 300, hold: false, input: 'click',
                rings: [90, 180, 270], maxTargets: 12, mag: 3, reloadMs: 2000, wellMs: 1700, wellPull: 2600, wellOrbPull: 1900, collapseMul: 1.5,
                swapMs: 320, recoil: 0.6, bloom: 0, critChance: 0, knockback: 0.4, moveSpeed: 1.00, falloff: 0, pierce: 0, aoeIgnoresCover: true }
  };
  /* ── SPEC-arsenal §F4 범주 · §F5 역할 ─────────────────────────────────────────────────────────────
   * §F5: "각 무기가 1등인 한 가지. 하나도 겹치면 안 된다. 겹치면 둘 중 하나는 존재 이유가 없다."
   * 약속이 아니라 필드다 — `tools/balance.js --check` 가 빈 역할 · 모르는 역할 · 겹치는 역할을 잡는다.
   * `cat` 은 §F4 의 범주(실전 ±18% · 특수 40~90% · 예능 25~50%)이고, `utility` 는 특수 범주의 "제공 효용
   * 환산" — 피해가 아닌 일로 로드아웃에 돌려주는 초당 피해를 환산한 값이다. 전부 번갈아 쓰는 보정 0.5 를
   * 이미 먹은 숫자다(한 무기를 쓰는 동안 다른 무기는 못 쓴다):
   *   충격포 150  반경 260 을 900 의 충격량으로 밀어 서로 박게 만든다 — 피해는 전부 충돌에서 나온다
   *   견인 광선 100  하나를 들어 던지고, 잡는 동안 그 적은 공격을 멈춘다
   *   고무탄 70  6초간 반발 0.85 + 충돌 피해 ×1.6 — 한 번의 사격이 여러 번의 충돌이 된다
   *   냉각총 100  얼린 동안 뒤이은 공격이 ×1.8. 실전 중앙 수준(약 250/s)의 0.8배를 번갈아 보정 0.5 로
   *   중력탄 150  한 점에 모아 둔 것을 범위 무기 한 발이 한 번에 친다
   *   나팔 45  §D 가 직접 "유일하게 전투 효용이 분명하다" 고 적은 무기다. 탄환을 되돌리면 그 피해가
   *            사라지는 동시에 쏜 쪽으로 간다 — 예능 중 유일하게 환산을 받는다
   * 그 외 전부 0 (피해로 일하는 무기는 환산이 필요 없다). */
  const WEAPON_ROLES = {
    hammer:    { cat: 'field',   role: 'single-mid' },
    pistol:    { cat: 'field',   role: 'reaction' },
    smg:       { cat: 'field',   role: 'mid-range' },
    sniper:    { cat: 'field',   role: 'single-max' },
    axe:       { cat: 'field',   role: 'melee-max' },
    katana:    { cat: 'field',   role: 'crit-mobility' },
    bomb:      { cat: 'field',   role: 'area-efficiency' },
    rocket:    { cat: 'field',   role: 'area-single-max' },
    flame:     { cat: 'field',   role: 'stacked-damage' },
    collapse:  { cat: 'field',   role: 'wipe' },
    laser:     { cat: 'field',   role: 'pierce-cut' },
    minigun:   { cat: 'field',   role: 'sustained-max' },
    shotgun:   { cat: 'field',   role: 'cluster' },
    nailgun:   { cat: 'field',   role: 'pin' },
    shockwave: { cat: 'special', role: 'push',   utility: 150 },
    tractor:   { cat: 'special', role: 'tow',    utility: 100 },
    rubber:    { cat: 'special', role: 'bounce', utility: 70 },
    freezegun: { cat: 'special', role: 'amplify', utility: 90 },
    gravity:   { cat: 'special', role: 'gather', utility: 150 },
    squeaky:   { cat: 'fun',     role: 'squash' },
    watergun:  { cat: 'fun',     role: 'soak' },
    horn:      { cat: 'fun',     role: 'reflect', utility: 45 },
    chicken:   { cat: 'fun',     role: 'chaos' }
  };
  for (const id of WEAPON_IDS) Object.assign(WEAPONS[id], WEAPON_ROLES[id]);
  /* ── SPEC-weapon-identity §C2 · §C3 표적 등급 계수 ────────────────────────────────────────────────
   * "무기의 정체성은 '무엇을 잘하는가'가 아니라 **'무엇을 못하는가'** 다."
   * §F5 의 역할표는 산문이라 강제되지 않았다. 등급 계수는 **수치**다 — 피해에 곱하고(src/72-roles.js),
   * `tools/balance.js --check` 의 §F6-7 · §F6-8 이 정적으로 읽어 "못 하는 일이 없는 무기" 와 "둘이 같은
   * 무기" 를 구조적으로 막는다. 등급 경계는 §C2 의 면적이다: 낱말 < 3,000 · 작은 것 ~20,000 ·
   * 중간 ~150,000 · 큰 것 그 위.
   *
   * 표는 §C3 그대로다. 단 한 칸만 다르고, 그것은 **명세가 자기 규칙과 어긋난 자리**다:
   *   `bomb` 낱말 1.0 → **0.8**. §C3 의 폭탄 줄은 { 1.0, 1.0, 1.2, 1.0 } 이라 1.0 미만이 하나도 없는데,
   *   같은 절이 바로 다음 줄에서 "실전 무기는 1.0 미만인 등급이 최소 하나 있어야 한다" 고 요구한다.
   *   원칙(§C1)과 검사(§F6-7)가 표의 한 칸보다 무겁다고 읽었고, 내릴 칸은 저격총이 이미 쓴 논리를
   *   그대로 따랐다 — "낱말에 200 을 쓰는 건 낭비다"(저격총 0.4). 폭탄은 190 이다. 나머지 세 칸은
   *   §C3 이 적은 값 그대로다. (보고에 적었다.)
   *
   * 붕괴는 표에 없다. 피해가 Infinity 이고 §F4 가 이미 밴드 검사에서 뺐다 — 곱할 피해가 없다.
   * 특수 · 예능 무기도 표에 없다: §C3 의 표는 실전 13종만 적었고 §C3 자신이 "기본 1.0" 이라고 썼다. */
  const WEAPON_VS = {
    hammer:  { word: 1.0, small: 1.0, mid: 1.0, large: 0.5 },   // 큰 것은 망치로 안 된다
    pistol:  { word: 1.0, small: 1.3, mid: 1.0, large: 0.6 },   // 작은 것 저격
    smg:     { word: 1.0, small: 1.0, mid: 1.0, large: 0.7 },   // 무난하되 큰 것엔 약하다
    sniper:  { word: 0.4, small: 1.0, mid: 1.4, large: 1.2 },   // 낱말에 200 을 쓰는 건 낭비다
    axe:     { word: 0.6, small: 1.0, mid: 1.3, large: 1.0 },   // 쪼갠다
    katana:  { word: 1.5, small: 1.2, mid: 0.7, large: 0.5 },   // 낱말과 작은 것을 썬다
    bomb:    { word: 0.8, small: 1.0, mid: 1.2, large: 1.0 },   // 뭉친 것 (낱말 0.8 은 위 주석 참조)
    rocket:  { word: 0.5, small: 0.7, mid: 1.2, large: 1.5 },   // 큰 것 전문
    flame:   { word: 1.4, small: 1.1, mid: 1.0, large: 0.6 },   // 번진다
    laser:   { word: 1.0, small: 1.1, mid: 1.0, large: 0.8 },   // 관통이 값이다
    minigun: { word: 0.7, small: 0.8, mid: 1.2, large: 1.4 },   // 큰 것을 갈아낸다
    shotgun: { word: 1.2, small: 1.4, mid: 0.6, large: 0.4 },   // 밀집한 작은 것
    nailgun: { word: 1.0, small: 1.2, mid: 1.0, large: 0.7 }    // 고정이 값이다
  };
  for (const id of WEAPON_IDS) if (WEAPON_VS[id]) WEAPONS[id].vs = WEAPON_VS[id];
  /* Loadout presets (v1.2 §4): permutations of WEAPON_IDS mapped onto keys 1 2 3 4 5 6 7 8 9 0. */
  /* SPEC-arsenal §B1: "프리셋이 서로 다른 10개 조합이 되어 실제 선택이 생긴다." The arsenal holds 12 and a
   * loadout holds 10, so each preset now LEAVES TWO OUT — and no two presets leave out the same pair, which
   * is what makes the choice real rather than a reshuffle. `default` keeps the exact v1.2 order (it is the
   * ten weapons that existed before this step), so an upgrade changes nothing for someone who never looked. */
  /* §C / §D (8단계): the arsenal is 19 now and a loadout is still ten, so the five presets above can no
   * longer reach seven of the weapons at all. Two more presets are the smallest fix that keeps §B1's promise
   * ("프리셋이 서로 다른 10개 조합이 되어 실제 선택이 생긴다") true of the WHOLE arsenal: `interaction` is the
   * push / pull / bounce loadout and `fun` is the 예능 one. The five that existed are untouched. */
  const PRESETS = {
    default:   ['hammer', 'pistol', 'smg', 'sniper', 'axe', 'katana', 'bomb', 'rocket', 'flame', 'collapse'],                 // 빠짐: 레이저 · 미니건
    assault:   ['smg', 'minigun', 'pistol', 'sniper', 'bomb', 'rocket', 'flame', 'hammer', 'axe', 'collapse'],                // 빠짐: 카타나 · 레이저
    sniper:    ['sniper', 'pistol', 'laser', 'katana', 'hammer', 'axe', 'smg', 'bomb', 'rocket', 'collapse'],                 // 빠짐: 화염방사기 · 미니건
    explosive: ['rocket', 'bomb', 'flame', 'collapse', 'laser', 'minigun', 'smg', 'pistol', 'hammer', 'axe'],                 // 빠짐: 저격총 · 카타나
    melee:     ['hammer', 'axe', 'katana', 'laser', 'pistol', 'sniper', 'bomb', 'rocket', 'flame', 'collapse'],               // 빠짐: 기관총 · 미니건
    interaction: ['shockwave', 'tractor', 'rubber', 'hammer', 'pistol', 'smg', 'sniper', 'bomb', 'rocket', 'collapse'],       // §C 셋을 앞에 두고 뒤는 실전
    fun:         ['squeaky', 'watergun', 'horn', 'chicken', 'rubber', 'hammer', 'pistol', 'smg', 'flame', 'collapse'],         // §D 넷 + 고무탄, 뒤는 실전
    /* §E (9단계): 무기고가 23 이 되었고 로드아웃은 여전히 열이다. `breach` 는 샷건과 못총이 들어간 실전
     * 조합이고, `combo` 는 §E 가 처음으로 말한 **조합** 그 자체다 — 물총으로 적시고 냉각총으로 얼린 뒤
     * 망치로 깬다. 중력탄이 모아 주고 폭탄이 친다. 둘 다 앞의 일곱 프리셋과 서로 다른 열 개다. */
    breach:      ['shotgun', 'nailgun', 'smg', 'pistol', 'sniper', 'hammer', 'axe', 'bomb', 'rocket', 'collapse'],            // §E 실전 둘 + 기존 실전
    combo:       ['watergun', 'freezegun', 'hammer', 'gravity', 'bomb', 'shotgun', 'nailgun', 'pistol', 'smg', 'collapse']    // §E 의 조합: 적시고 → 얼리고 → 깬다
  };
  const PRESET_KEYS = { default: 'presetDefault', assault: 'presetAssault', sniper: 'presetSniper', explosive: 'presetExplosive', melee: 'presetMelee',
    interaction: 'presetInteraction', fun: 'presetFun', breach: 'presetBreach', combo: 'presetCombo' };
  const HOLD_WINDOW = 150;           // ms: hold-weapon damage aggregation / fx throttle window (A4, A5)
  const BURNT_FILTER = 'brightness(.55) sepia(.6)';   // flame-broken pieces (A9)
  const SWAP_MS = 250;               // weapon swap delay (v1.2 A5)
  const GRACE_MS = 5000;             // combat activation grace (v1.2 A7)
  const TIER_BASE = { shooter: 1800, charger: 3000, laser: 4500 };   // attack intervals (v1.2 §5)
  /* v1.3 readability (§3): player marker / orb / near-miss / hitstop numbers. ORB_HIT_R is the ONE radius the
   * orb sweep test and the near-miss band both read — the damage rule itself is unchanged (v1.3 §4). */
  const SELF_R = 22;                 // player ring radius (44 px diameter)
  const SELF_HIT_R = 32;             // ring radius at the peak of the on-hit punch (64 px diameter)
  const ORB_R = 11;                  // orb radius (22 px diameter)
  const ORB_HIT_R = 22;              // orb → player hit radius
  const NEAR_MISS_BAND = 45;         // px beyond ORB_HIT_R that still counts as a graze (§3.4)
  const HITSTOP_MS = 70;             // physics dt is clamped to 0 for this long after a hit (§3.5)
  const ORB_TRAIL = 6;               // afterimage samples behind each orb
  const AIMLINE_MIN_MS = 220;        // an aim line stays visible at least this long (forced / zero wind-up)
  /* api.debug (A12): one plain object, survives toggles. v1.2 adds noSpread / noAttacks / fastReload /
   * infiniteAmmo and the hooks setPlayerHp / setPlayerPos / forceAttack (attached in section 12b). */
  /* SPEC-test-speed §3: `timeScale` is the one knob that shortens the product's own time constants so a test
   * can prove an OUTCOME without paying its wall clock. Clamped to [0.05, 1] at every read (scaleMs()), so a
   * test can only ever speed the product UP — never slow it down to hide a timing regression. Default 1, and
   * `ms * 1 === ms` exactly, so a default run is numerically identical to one with no scaling at all. */
  const debug = { noCrit: false, forceCrit: false, noCooldown: false, noSpread: false, noAttacks: false, fastReload: false, infiniteAmmo: false, hitstop: true, timeScale: 1 };
  const CAP = 160;                 // live debris pieces (A1)
  const MIN_EVICT_AGE = 800;       // ms (A1)
  const GPU_BUDGET = 64e6;         // sum of w*h*dpr^2 over live pieces (A1)
  const BOMB_RADIUS = 240;         // px (A14)
  const GRAVITY = 2400;            // px/s^2
  const DEG = Math.PI / 180;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const MEDIA_TAGS = new Set(['img', 'picture', 'svg', 'video', 'canvas']);
  const FORM_TAGS = new Set(['button', 'input', 'select', 'textarea']);
  const REPLACED_TAGS = new Set(['img', 'svg', 'video', 'canvas', 'iframe', 'input', 'button', 'select', 'textarea', 'picture', 'object', 'embed']);
  const TEXTISH_TAGS = new Set(['p', 'span', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'label', 'small', 'em', 'strong', 'b', 'i', 'code', 'blockquote', 'dt', 'dd', 'figcaption', 'pre']);
  const DROP_TAGS = new Set(['script', 'style', 'link', 'template', 'noscript', 'meta', 'title', 'head']);
  const SKIP_WALK_TAGS = new Set(['script', 'style', 'link', 'meta', 'template', 'noscript']);
  const STRIP_ATTRS = new Set(['id', 'name', 'is', 'for', 'form', 'autofocus', 'tabindex', 'contenteditable', 'draggable', 'aria-live', 'srcdoc', 'style', 'loading', 'slot', 'popover', 'inert', 'open', 'autoplay', 'loop', 'data-crs-broken']);
  const ROOT_INLINE_SKIP = new Set(['transform', 'transition', 'animation', 'position', 'inset', 'top', 'left', 'right', 'bottom', 'margin', 'margin-top', 'margin-left', 'margin-right', 'margin-bottom', 'translate', 'rotate', 'scale']);

  // Computed-style properties copied to clones (A10). ★ = reduced set used below depth 2.
  const STYLE_STAR = ['display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-color', 'background-image', 'visibility'];
  const STYLE_FULL = STYLE_STAR.concat(['min-width', 'max-width', 'min-height', 'max-height', 'box-sizing', 'z-index', 'transform', 'transform-origin',
    'overflow-x', 'overflow-y', 'text-overflow', 'float', 'clear', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
    'justify-content', 'align-items', 'align-self', 'gap', 'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows',
    'grid-column', 'grid-row', 'place-items', 'columns', 'aspect-ratio', 'border-collapse', 'border-spacing', 'table-layout',
    'font-style', 'font-variant', 'font-kerning', 'font-feature-settings', 'letter-spacing', 'word-spacing', 'text-align',
    'text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'text-transform', 'text-shadow', 'white-space',
    'word-break', 'direction', 'vertical-align', 'list-style-type', 'list-style-position', '-webkit-text-fill-color',
    '-webkit-text-stroke', 'background-size', 'background-position', 'background-repeat',
    'border-top-width', 'border-top-style', 'border-top-color', 'border-right-width', 'border-right-style', 'border-right-color',
    'border-bottom-width', 'border-bottom-style', 'border-bottom-color', 'border-left-width', 'border-left-style', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'box-shadow', 'opacity', 'object-fit', 'fill', 'stroke', 'stroke-width']);
  const STYLE_SVG_EXTRA = ['fill', 'stroke', 'stroke-width', 'opacity'];
