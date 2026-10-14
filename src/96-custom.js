  /* =====================================================================
   * SPEC-product §6 사용자 정의 무기
   *
   * `chrome.storage.local` 의 `crsCustomWeapons`(최대 10)를 읽어 **무기고 끝에** 붙인다.
   * 검증은 §6 이 적은 그대로 엄격하다. 잘못된 항목은 버리고 첫 문제를 토스트로 알린다.
   *
   * 이 모듈의 가장 중요한 조항은 한 줄이다 — **망가진 저장값이 활성화를 막아서는 안 된다.**
   * 그래서 (1) 읽기는 activate() 와 무관하게 비동기로 일어나고, (2) 모든 저장소 접근은
   * safe()/safeThen() 안에 있고, (3) 검증은 항목 단위라 하나가 썩어도 나머지는 산다.
   * 활성화 경로 어디에도 이 모듈을 기다리는 지점이 없다.
   *
   * 최상위 이름은 `CW` 하나로 모았다 (CLAUDE.md: 모듈은 한 클로저로 이어 붙고 겹친 이름은
   * 조용히 뒤가 이긴다). 나머지는 전부 `cw*` 접두사의 함수 선언이다.
   *
   * 고른 해석 (명세가 말하지 않은 것, CLAUDE.md 가 적으라고 한 것):
   *  - `kind` 는 엔진의 모드 어휘다. 허용값을 `hammer` · `gun` · `bomb` 셋으로 뒀다 —
   *    `collapse` 는 피해가 Infinity 이고 radius 가 Infinity 인 특수기라 §6 의 수치 범위
   *    (damage 1~999, radius 0~600)와 애초에 맞지 않는다.
   *  - §6 의 필드 목록에 `hold` 가 없고 `tickMs` 는 있다. 그래서 **`kind === 'gun'` 이면
   *    꾹 누르는 무기**이고 `tickMs` 가 그 틱이다. `hammer` · `bomb` 은 클릭이고 `tickMs` 는
   *    검증만 하고 쓰지 않는다. 필드 목록을 늘리지 않는 가장 작은 규칙이다.
   *  - `crack` 과 `sound` 의 허용값도 명세에 없다. 엔진이 실제로 그릴 수 있는 자국
   *    (`hammer` · `gun`)과 실제로 낼 수 있는 소리(`hammer` · `thump` · `gun` · `bomb`)로
   *    제한했다 — 모르는 값을 받아 조용히 아무 자국도 안 남기는 쪽이 더 나쁘다.
   *  - 사용자 정의 무기는 **해금 대상이 아니다**(§4 의 `UNLOCK_AT` 에 없으므로 자동으로
   *    열려 있다). **밸런스 밴드 대상도 아니다** — tools/balance.js 가 src/ 를 정적으로
   *    읽기 때문에 구조적으로 보이지 않고, 그 사실을 그 파일이 명시적으로 적고 있다.
   * ===================================================================== */
  const CW_KEY = 'crsCustomWeapons';
  const CW_MAX = 10;                       // §6 "최대 10"
  const CW_ID_RE = /^cw_[a-z0-9_]{1,20}$/; // §6 그대로
  const CW_KINDS = ['hammer', 'gun', 'bomb'];
  const CW_CRACKS = ['hammer', 'gun'];
  const CW_SOUNDS = ['hammer', 'thump', 'gun', 'bomb'];
  const CW_NAME_MAX = 20;                  // §6 "이름 20자 이하"
  const CW_EMOJI_MAX = 4;                  // §6 "이모지 4코드포인트 이하"
  const CW = {
    list: [],              // registered ids, in arsenal order
    records: [],           // the validated records themselves
    errors: [],            // what the last load threw away
    names: Object.create(null),   // synthetic i18n key -> display name
    loaded: false,
    subscribed: false,
    msgBase: msg           // see cwName(): custom names are NOT i18n keys, so msg() has to know them
  };
  /* The display name of a custom weapon is stored data, not a message key. Rather than teach every call
   * site about that, msg() itself learns one table — the same binding-rewrite device src/99-api.js uses on
   * setWeapon/setLoadout. Keys are synthetic (`cwName_<id>`) and can never collide with a real message. */
  msg = function (key) {
    const n = CW.names[key];
    return n === undefined ? CW.msgBase(key) : n;
  };
  /* getUILanguage(), not getMessage('@@ui_locale'): the latter is a PREDEFINED message and would land in
   * tools/validate.js R6's "this key is missing from _locales" list, which would be a false alarm. */
  function cwLocaleKo() {
    const l = safe(() => chrome.i18n.getUILanguage());
    return typeof l !== 'string' || !l || /^ko/i.test(l);
  }
  function cwDisplayName(e) {
    const ko = cwLocaleKo();
    return (ko ? e.nameKo : e.nameEn) || e.nameKo || e.nameEn || e.id;
  }

  /* ---- §6 엄격 검증 ---------------------------------------------------------------
   * 항목 하나가 틀리면 그 항목만 버린다. 반환값의 `bad` 는 순서를 지키므로 "첫 문제" 가
   * 정말로 첫 문제다. `reason` 은 토스트와 옵션 페이지가 같이 읽는 기계어다. */
  function cwInt(v, lo, hi) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi;
  }
  function cwStr(v, max) {
    return typeof v === 'string' && v.length >= 1 && v.length <= max;
  }
  function cwCodepoints(s) {
    let n = 0;
    try { for (const _ of String(s)) n++; } catch (e) { return CW_EMOJI_MAX + 1; }
    return n;
  }
  function cwValidate(raw) {
    const ok = [], bad = [];
    if (raw == null) return { ok, bad };
    if (!Array.isArray(raw)) return { ok, bad: [{ index: -1, id: null, field: 'root', reason: 'not-an-array' }] };
    const seen = Object.create(null);
    for (let i = 0; i < raw.length; i++) {
      const e = raw[i];
      const id = (e && typeof e.id === 'string') ? e.id : null;
      const no = (field, reason) => { bad.push({ index: i, id, field, reason }); };
      if (!e || typeof e !== 'object' || Array.isArray(e)) { no('entry', 'not-an-object'); continue; }
      if (ok.length >= CW_MAX) { no('list', 'over-max'); continue; }
      if (!CW_ID_RE.test(String(e.id))) { no('id', 'bad-id'); continue; }
      if (WEAPON_IDS.indexOf(e.id) !== -1 && CW.list.indexOf(e.id) === -1) { no('id', 'builtin-collision'); continue; }
      if (seen[e.id]) { no('id', 'duplicate'); continue; }
      if (cwCodepoints(e.emoji) < 1 || cwCodepoints(e.emoji) > CW_EMOJI_MAX) { no('emoji', 'bad-emoji'); continue; }
      if (!cwStr(e.nameKo, CW_NAME_MAX)) { no('nameKo', 'bad-name'); continue; }
      if (!cwStr(e.nameEn, CW_NAME_MAX)) { no('nameEn', 'bad-name'); continue; }
      if (CW_KINDS.indexOf(e.kind) === -1) { no('kind', 'bad-kind'); continue; }
      if (!cwInt(e.damage, 1, 999)) { no('damage', 'out-of-range'); continue; }
      if (!cwInt(e.cooldownMs, 0, 5000)) { no('cooldownMs', 'out-of-range'); continue; }
      if (!(e.mag === null || cwInt(e.mag, 1, 200))) { no('mag', 'out-of-range'); continue; }
      if (!cwInt(e.reloadMs, 0, 10000)) { no('reloadMs', 'out-of-range'); continue; }
      if (!cwInt(e.radius, 0, 600)) { no('radius', 'out-of-range'); continue; }
      if (!cwInt(e.tickMs, 20, 500)) { no('tickMs', 'out-of-range'); continue; }
      if (CW_CRACKS.indexOf(e.crack) === -1) { no('crack', 'bad-crack'); continue; }
      if (CW_SOUNDS.indexOf(e.sound) === -1) { no('sound', 'bad-sound'); continue; }
      seen[e.id] = true;
      ok.push({
        id: e.id, emoji: String(e.emoji), nameKo: e.nameKo, nameEn: e.nameEn, kind: e.kind,
        damage: e.damage, cooldownMs: e.cooldownMs, mag: e.mag, reloadMs: e.reloadMs,
        radius: e.radius, tickMs: e.tickMs, crack: e.crack, sound: e.sound
      });
    }
    return { ok, bad };
  }

  /* ---- fire(): §6 의 무기는 엔진의 1차 동작 셋 중 하나를 고른 것이다 ----
   * 내장 무기의 fire() 를 복사하지 않고 같은 1차 함수를 부른다 — 피해·자국·소리만 그 무기의
   * 것으로 바꿔 끼운다. 새로운 파괴 경로를 만들지 않는다는 것이 핵심이다. */
  function cwFire(W) {
    if (W.kind === 'bomb') {
      return function (x, y) {
        state.shots++;
        const B = blastWeaponAt(x, y, W);
        interceptOrbsWithin(x, y, B.radius);
        sfx(W.sound);
        blastFx(x, y, B.radius, 1, undefined, B);
        aoeHit(x, y, B);
        return null;
      };
    }
    const melee = W.kind === 'hammer';
    return function (x, y) {
      state.shots++;
      if (interceptOrb(x, y)) return null;   // v1.2 A9: an orb in front of the muzzle eats the blow
      const el = pickTarget(x, y);
      const crit = el ? rollCrit(W.id) : false;
      const dmg = rollDamage(W.damage, crit, falloffMul(W.id, x, y));
      sfx(W.sound, { crit });
      flash(x, y, melee ? 'hammer' : 'gun');
      shake(melee ? 'hammer' : 'gun');
      drawCrack(x, y, W.crack, { ink: melee ? 1 : 0.25 });
      if (!melee) spawnChips(x, y, randInt(3, 5));
      if (el) applyHit(el, dmg, melee ? 'hammer' : 'gun', x, y, { crit });
      return el;
    };
  }
  /* The weapon-table row. Every field the engine reads has to be present with a sane value: a missing
   * `swapMs` would make swapMsOf() fall back to SWAP_MS (fine) but a missing `critChance` would make
   * critChanceOf() read undefined. They are written out rather than inherited. */
  function cwRow(e) {
    const gun = e.kind === 'gun';
    const W = {
      id: e.id, emoji: e.emoji, name: 'cwName_' + e.id, kind: e.kind,
      damage: e.damage, cooldownMs: e.cooldownMs, radius: e.kind === 'bomb' ? e.radius : 0,
      hold: gun, input: gun ? 'hold' : 'click', tickMs: e.tickMs,
      mag: e.mag, reloadMs: e.mag == null ? null : e.reloadMs,
      swapMs: SWAP_MS, recoil: gun ? 0.5 : 0.8, bloom: 0, critChance: 0.08,
      knockback: 1, moveSpeed: 1, falloff: 0, pierce: 0,
      cat: 'custom', role: 'custom', custom: true, crack: e.crack, sound: e.sound
    };
    if (e.kind === 'bomb') {
      const R = Math.max(1, e.radius);
      W.rings = [R * 0.3, R * 0.6, R];
      W.maxTargets = 10;
    }
    W.fire = cwFire(W);
    return W;
  }
  /* Registration is idempotent: it always removes what the previous load put in first, so an options-page
   * edit that renames or drops a weapon cannot leave a ghost behind in 무기고. */
  function cwUnregister() {
    for (const id of CW.list) {
      const i = WEAPON_IDS.indexOf(id);
      if (i >= 0) WEAPON_IDS.splice(i, 1);
      delete WEAPONS[id];
      delete CW.names['cwName_' + id];
      delete state.ammo[id];
    }
    CW.list = [];
    CW.records = [];
  }
  function cwRegister(records) {
    cwUnregister();
    for (const e of records) {
      const W = cwRow(e);
      WEAPONS[e.id] = W;
      WEAPON_IDS.push(e.id);           // §6 "무기고 끝에 붙고"
      CW.names[W.name] = cwDisplayName(e);
      state.ammo[e.id] = W.mag == null ? null : W.mag;
      CW.list.push(e.id);
      CW.records.push(e);
    }
    cwPruneLoadout();
  }
  /* A loadout stored while a custom weapon existed can name one that is gone now. isLoadout() would then
   * refuse the whole array and the player would silently lose their slot order, so the dead ids are
   * dropped instead and the rest keeps its position. */
  function cwPruneLoadout() {
    const live = state.loadout.filter((id) => WEAPON_IDS.indexOf(id) !== -1);
    if (live.length === state.loadout.length) {
      if (state.active) { try { reorderHud(); updateHud(); updateAmmoHud(); } catch (e) { /* ignore */ } }
      return;
    }
    setLoadout(live.length ? live : PRESETS.default.slice(), { silent: true, preset: state.preset });
  }
  /* The OTHER half of the same race, and the one that actually bites: loadPrefs() (src/99-api.js) reads
   * crsLoadout asynchronously too, and if it lands FIRST a stored loadout naming a custom weapon is not a
   * valid loadout yet — isPermutation() refuses the whole array and the player silently gets the preset
   * back. So once the custom weapons are registered, the stored order is offered again. `loadoutTouched`
   * keeps this from overruling a choice the player made by hand during the session. */
  function cwReapplyLoadout() {
    if (!CW.list.length || state.loadoutTouched) return;
    safeThen(() => chrome.storage.sync.get(['crsLoadout', 'crsLoadoutPreset']), (res) => {
      if (!res || state.loadoutTouched) return;
      const stored = migrateWeaponIds(res.crsLoadout);
      if (!isLoadout(stored)) return;
      if (stored.join(',') === state.loadout.join(',')) return;
      const p = res.crsLoadoutPreset;
      setLoadout(stored, { silent: true, preset: (p === 'custom' || PRESETS[p]) ? p : 'custom' });
    });
  }

  /* ---- storage ---------------------------------------------------------------------
   * §6 "잘못된 항목은 버리고 첫 문제를 토스트로 알린다." The toast only fires for a load the PLAYER can
   * see — a boot-time read on an inactive page records the error and says it when the HUD exists. */
  function cwApply(raw, announce) {
    const res = cwValidate(raw);
    CW.errors = res.bad;
    CW.loaded = true;
    cwRegister(res.ok);
    cwReapplyLoadout();
    if (announce && res.bad.length && state.active) cwToast();
    return res;
  }
  function cwToast() {
    const first = CW.errors[0];
    if (!first) return false;
    const where = first.index >= 0 ? ('#' + (first.index + 1) + (first.id ? ' ' + first.id : '')) : '';
    toast('⚠ ' + msg('cwBad') + ' ' + where + ' · ' + first.field);
    return true;
  }
  function cwRead(announce) {
    safeThen(() => chrome.storage.local.get([CW_KEY]), (res) => {
      /* Anything at all may be on disk here — an array of junk, an object, a string, null. cwValidate()
       * answers for all of it and never throws, and this whole path runs AFTER activation. */
      cwApply(res ? res[CW_KEY] : null, announce);
    });
  }
  /* The options tab writes crsCustomWeapons and crsLoadout; both have to land on an open page without a
   * re-activation (SPEC-settings §1.3 promises that for settings, and these are the same promise). The
   * settings module's own listener only watches the `crs.` prefixed SYNC keys, so this is a second,
   * separate listener rather than an edit to another workstream's file. */
  function cwSubscribe() {
    if (CW.subscribed) return;
    const ok = safe(() => {
      chrome.storage.onChanged.addListener(cwChanged);
      return true;
    });
    CW.subscribed = !!ok;
  }
  function cwChanged(changes, area) {
    if (!changes || typeof changes !== 'object') return;
    if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, CW_KEY)) {
      cwApply(changes[CW_KEY] ? changes[CW_KEY].newValue : null, true);
    }
    if (area === 'sync' && Object.prototype.hasOwnProperty.call(changes, 'crsLoadout')) {
      const next = migrateWeaponIds(changes.crsLoadout ? changes.crsLoadout.newValue : null);
      if (Array.isArray(next)) {
        const live = next.filter((id) => WEAPON_IDS.indexOf(id) !== -1);
        if (live.length) setLoadout(live, { silent: true, preset: 'custom' });
      }
    }
  }
  function cwSave(list) {
    const res = cwValidate(list);
    CW.errors = res.bad;
    const patch = {}; patch[CW_KEY] = res.ok;
    safe(() => chrome.storage.local.set(patch));
    cwRegister(res.ok);
    if (res.bad.length && state.active) cwToast();
    return { saved: res.ok.length, rejected: res.bad.length, errors: res.bad.slice() };
  }
  function cwInfo() {
    return {
      max: CW_MAX, loaded: CW.loaded,
      ids: CW.list.slice(),
      weapons: CW.records.map((e) => Object.assign({}, e)),
      errors: CW.errors.map((e) => Object.assign({}, e)),
      kinds: CW_KINDS.slice(), cracks: CW_CRACKS.slice(), sounds: CW_SOUNDS.slice()
    };
  }
  /* §6 "예시 추가" — the options page offers this shape as the starting point of a new weapon. */
  function cwExample(n) {
    const i = Math.max(1, Math.min(99, Math.floor(+n || 1)));
    return {
      id: 'cw_example' + i, emoji: '🧨', nameKo: '예시 무기 ' + i, nameEn: 'Example ' + i,
      kind: 'gun', damage: 40, cooldownMs: 200, mag: 12, reloadMs: 1200,
      radius: 0, tickMs: 120, crack: 'gun', sound: 'gun'
    };
  }
  function cwBoot() {
    cwSubscribe();
    cwRead(false);
  }
