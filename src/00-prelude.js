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

  const VERSION = '1.2.0';
  /* Weapon table (SPEC-v2 A2 numbers + v1.2 A1 ammo fields). `kind` is the v1 mode vocabulary every primitive
   * consumes (CRACK / flash / shake / sfx / velocityFor / pieceCount / breakElement opts.mode — A10).
   * `mag` = magazine size (null = ∞ / melee), `reloadMs` (null for melee); the slot KEY is no longer a table
   * field: it comes from the loadout order (v1.2 A6). `fire(x, y, ctx)` entries are attached in section 12.
   * WEAPON_IDS is the canonical SET (validation / persistence); `state.loadout` is the ORDER. */
  /* SPEC-arsenal §B1: WEAPON_IDS is the ARSENAL now — every weapon that exists (12 since 레이저 커터 and
   * 미니건 landed). `state.loadout` is a chosen SUBSET of it, at most 10 long, and that subset is what the
   * number keys / Q / E / the HUD grid speak. Nothing else about the id set changed. */
  const WEAPON_IDS = ['hammer', 'pistol', 'smg', 'sniper', 'axe', 'katana', 'bomb', 'rocket', 'flame', 'collapse', 'laser', 'minigun'];
  const LOADOUT_MAX = 10;            // §B1: 숫자키 10칸
  const WEAPONS = {
    hammer:   { id: 'hammer',   emoji: '🔨', name: 'weaponHammer',   kind: 'hammer',   damage: 65,  cooldownMs: 0,    radius: 0,   hold: false, input: 'click', mag: null, reloadMs: null },
    pistol:   { id: 'pistol',   emoji: '🔫', name: 'weaponPistol',   kind: 'gun',      damage: 25,  cooldownMs: 0,    radius: 0,   hold: false, input: 'click', mag: 12, reloadMs: 900 },
    smg:      { id: 'smg',      emoji: '💥', name: 'weaponSmg',      kind: 'gun',      damage: 22,  cooldownMs: 0,    radius: 0,   hold: true,  input: 'hold', tickMs: 70, mag: 30, reloadMs: 1400 },
    sniper:   { id: 'sniper',   emoji: '🎯', name: 'weaponSniper',   kind: 'gun',      damage: 200, cooldownMs: 600,  radius: 0,   hold: false, input: 'click', mag: 5, reloadMs: 2000, spread: 25, scope: true },
    axe:      { id: 'axe',      emoji: '🪓', name: 'weaponAxe',      kind: 'hammer',   damage: 130, cooldownMs: 550,  radius: 0,   hold: false, input: 'click', mag: null, reloadMs: null },
    katana:    { id: 'katana',    emoji: '🗡️', name: 'weaponKatana',    kind: 'hammer',   damage: 60,  cooldownMs: 0,    radius: 0,   hold: false, input: 'drag', stabCooldownMs: 120, mag: null, reloadMs: null },
    bomb:     { id: 'bomb',     emoji: '💣', name: 'weaponBomb',     kind: 'bomb',     damage: 190, cooldownMs: 700,  radius: 240, hold: false, input: 'click', rings: [60, 130, 210], maxTargets: 10, mag: 3, reloadMs: 1800 },
    rocket:   { id: 'rocket',   emoji: '🚀', name: 'weaponRocket',   kind: 'bomb',     damage: 260, cooldownMs: 1200, radius: 360, hold: false, input: 'click', rings: [70, 150, 230, 320], maxTargets: 14, mag: 2, reloadMs: 1500 },
    flame:    { id: 'flame',    emoji: '🔥', name: 'weaponFlame',    kind: 'gun',      damage: 15,  cooldownMs: 0,    radius: 0,   hold: true,  input: 'hold', tickMs: 50, mag: 100, reloadMs: 2500 },
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
                swapMs: 320, recoil: 0.2, bloom: 0, critChance: 0.07, knockback: 0.4, moveSpeed: 0.88, falloff: 0, pierce: 999, pierceFalloff: 0.75 },
    /* ── SPEC-arsenal §B3 미니건 ────────────────────────────────────────────────────────────────────
     * 26 damage every 60 ms = 433/s, the number §B3's table publishes. `spinUpMs` is the 0.8 s 예열 before
     * the first round and `idleGraceMs` the 0.6 s 공회전 유예 that lets a re-press skip it. */
    minigun:  { id: 'minigun',  emoji: '⚙️', name: 'weaponMinigun', kind: 'gun',      damage: 26,  cooldownMs: 0,    radius: 0,   hold: true,  input: 'hold', tickMs: 60, mag: 200, reloadMs: 4000,
                spinUpMs: 800, idleGraceMs: 600, fixedRounds: 20,
                swapMs: 560, recoil: 0.45, bloom: 14, critChance: 0.05, knockback: 0.55, moveSpeed: 0.55, falloff: 0.42, pierce: 0 }
  };
  /* Loadout presets (v1.2 §4): permutations of WEAPON_IDS mapped onto keys 1 2 3 4 5 6 7 8 9 0. */
  /* SPEC-arsenal §B1: "프리셋이 서로 다른 10개 조합이 되어 실제 선택이 생긴다." The arsenal holds 12 and a
   * loadout holds 10, so each preset now LEAVES TWO OUT — and no two presets leave out the same pair, which
   * is what makes the choice real rather than a reshuffle. `default` keeps the exact v1.2 order (it is the
   * ten weapons that existed before this step), so an upgrade changes nothing for someone who never looked. */
  const PRESETS = {
    default:   ['hammer', 'pistol', 'smg', 'sniper', 'axe', 'katana', 'bomb', 'rocket', 'flame', 'collapse'],                 // 빠짐: 레이저 · 미니건
    assault:   ['smg', 'minigun', 'pistol', 'sniper', 'bomb', 'rocket', 'flame', 'hammer', 'axe', 'collapse'],                // 빠짐: 카타나 · 레이저
    sniper:    ['sniper', 'pistol', 'laser', 'katana', 'hammer', 'axe', 'smg', 'bomb', 'rocket', 'collapse'],                 // 빠짐: 화염방사기 · 미니건
    explosive: ['rocket', 'bomb', 'flame', 'collapse', 'laser', 'minigun', 'smg', 'pistol', 'hammer', 'axe'],                 // 빠짐: 저격총 · 카타나
    melee:     ['hammer', 'axe', 'katana', 'laser', 'pistol', 'sniper', 'bomb', 'rocket', 'flame', 'collapse']                // 빠짐: 기관총 · 미니건
  };
  const PRESET_KEYS = { default: 'presetDefault', assault: 'presetAssault', sniper: 'presetSniper', explosive: 'presetExplosive', melee: 'presetMelee' };
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
