  /* ===================================================================== */
  /* 1b. Settings (SPEC-settings §1)                                        */
  /*                                                                        */
  /* ONE schema file, read by TWO consumers: tools/build.js inlines          */
  /* settings-schema.json at the /*@SETTINGS_SCHEMA@*\/ marker below as a    */
  /* frozen literal, and the options page (roadmap step 10) fetches the      */
  /* very same file through chrome.runtime.getURL(). Neither one owns a      */
  /* second copy of the defaults.                                           */
  /*                                                                        */
  /* The marker is replaced by `Object.freeze([ …entries… ])`. It is wrapped */
  /* in [].concat(…) so this source file still PARSES on its own when the    */
  /* schema file is absent (build.js then only warns): the unresolved form   */
  /* is Object.freeze([].concat()) — a frozen empty schema.                  */
  /* ===================================================================== */
  const SETTINGS_SCHEMA = Object.freeze([].concat(/*@SETTINGS_SCHEMA@*/));
  const SETTING_GROUPS = ['general', 'combat', 'accessibility', 'advanced'];
  /* chrome.storage.sync keys are namespaced `crs.<key>` so they can never collide with the v1 flat keys
   * (crsWeapon, crsMuted, …) that §1.2 migrates away from. Only big things go to `local` — the one that
   * exists today is crsSeenCombatHelp (v1.4 §5), which is deliberately per-machine and is NOT a setting. */
  const SETTING_PREFIX = 'crs.';
  const SETTING_MIGRATED = 'crs.migrated';   // schema version the stored data was migrated to
  const SETTINGS_VERSION = 1;

  const SETTING_BY_KEY = Object.create(null);
  const settings = Object.create(null);          // key -> resolved value (schema default until something says otherwise)
  const settingsExplicit = new Set();            // keys that storage (or a runtime write) actually carries
  const settingsMeta = { loaded: false, subscribed: false, migrated: false, legacyPresent: new Set() };

  for (const e of SETTINGS_SCHEMA) {
    if (!e || typeof e.key !== 'string') continue;
    SETTING_BY_KEY[e.key] = e;
    settings[e.key] = e.default;
  }

  /* ---- validation (the same rules tools/validate.js R10 enforces on the file) ---- */
  function settingValid(entry, v) {
    if (!entry) return false;
    if (entry.type === 'bool') return typeof v === 'boolean';
    if (entry.type === 'enum') return Array.isArray(entry.options) && entry.options.indexOf(v) !== -1;
    if (entry.type === 'string') return typeof v === 'string';
    if (entry.type === 'int') {
      if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v) return false;
      if (Number.isInteger(entry.min) && v < entry.min) return false;
      if (Number.isInteger(entry.max) && v > entry.max) return false;
      return true;
    }
    if (entry.type === 'number') {
      if (typeof v !== 'number' || !isFinite(v)) return false;
      if (typeof entry.min === 'number' && v < entry.min) return false;
      if (typeof entry.max === 'number' && v > entry.max) return false;
      return true;
    }
    return false;
  }
  function settingShow(v) {
    try { return typeof v === 'string' ? JSON.stringify(v) : String(v); } catch (e) { return '?'; }
  }
  /* §1.3: "잘못된 값은 무시하고 stats().lastError 에 남긴다" — never thrown, never stored, always reported. */
  function settingFail(text) {
    state.lastError = 'settings: ' + text;
    return false;
  }
  function settingsGet(key) {
    const e = SETTING_BY_KEY[key];
    if (!e) return undefined;
    const v = settings[key];
    return settingValid(e, v) ? v : e.default;
  }
  function settingBool(key) { return settingsGet(key) === true; }
  function settingsNow() {
    const out = {};
    for (const k of Object.keys(SETTING_BY_KEY)) out[k] = settingsGet(k);
    return out;
  }
  /* The schema itself, for the options page and for tests. A copy: nothing outside may mutate it. */
  function settingsSchema() {
    return SETTINGS_SCHEMA.map((e) => Object.assign({}, e, Array.isArray(e.options) ? { options: e.options.slice() } : null));
  }

  /* ---- §1.2: the v1 flat keys this schema absorbs ----------------------------
   * Every one of these is still READ and WRITTEN by the v1 code paths (loadPrefs, setWeapon, setMuted,
   * persistMode, setDebrisAnchor, setWeaponOption, setLoadout). They are kept as a compatibility MIRROR
   * for one release: the wrappers in src/99-api.js push each legacy write into the matching setting too,
   * so the two never disagree, and `settingsApply()` defers to the legacy key for as long as one is
   * present in storage — which makes the two async reads (loadPrefs' and this module's) order-independent.
   * `crsLoadout` (an array) and `crsSeenCombatHelp` (local, per machine) have no schema type and stay put. */
  const LEGACY_READ = {
    mode: (res) => {
      // SPEC-combat §A: the retired v1.4 id still has to be READ off disk, so it comes through migrateModeId()
      const m = migrateModeId(res.crsMode);
      if (MODES.indexOf(m) !== -1) return m;
      if (typeof res.crsCombat === 'boolean') return res.crsCombat ? 'arcade' : 'rampage';
      return undefined;
    },
    defaultWeapon: (res) => {
      const w = migrateWeaponId(res.crsWeapon);
      return WEAPON_IDS.indexOf(w) !== -1 ? w : undefined;
    },
    loadoutPreset: (res) => (typeof res.crsLoadoutPreset === 'string' ? res.crsLoadoutPreset : undefined),
    debrisAnchor: (res) => (res.crsDebrisAnchor === 'viewport' || res.crsDebrisAnchor === 'document' ? res.crsDebrisAnchor : undefined),
    debrisLifeMs: (res) => (typeof res.crsDebrisLifeMs === 'number' ? res.crsDebrisLifeMs : (typeof res.crsDebrisLife === 'number' ? res.crsDebrisLife : undefined)),
    muted: (res) => (typeof res.crsMuted === 'boolean' ? res.crsMuted : undefined),
    weaponArt: (res) => (WEAPON_ART_MODES.indexOf(res.crsWeaponArt) !== -1 ? res.crsWeaponArt : undefined),
    viewmodel: (res) => (typeof res.crsViewmodel === 'boolean' ? res.crsViewmodel : undefined)
  };
  const LEGACY_KEYS_OF = {
    mode: ['crsMode', 'crsCombat'],
    defaultWeapon: ['crsWeapon'],
    loadoutPreset: ['crsLoadoutPreset'],
    debrisAnchor: ['crsDebrisAnchor'],
    debrisLifeMs: ['crsDebrisLifeMs', 'crsDebrisLife'],
    muted: ['crsMuted'],
    weaponArt: ['crsWeaponArt'],
    viewmodel: ['crsViewmodel']
  };
  /* Removed outright (v1.3 §1): never read again, dropped on sight. */
  const LEGACY_DEAD = ['crsPower'];
  /* crsLoadoutPreset is the ONE v1 key the migration does not delete: it names the preset for `crsLoadout`,
   * an ARRAY that no schema type can hold and that therefore has to stay where it is. Dropping its name
   * while keeping the order would make every stored loadout read back as 'custom'. */
  const LEGACY_KEEP = ['crsLoadoutPreset'];
  function legacyKeyList() {
    const out = LEGACY_DEAD.slice();
    for (const k of Object.keys(LEGACY_KEYS_OF)) for (const n of LEGACY_KEYS_OF[k]) out.push(n);
    return out;
  }
  function legacyRemovableKeys() { return legacyKeyList().filter((n) => LEGACY_KEEP.indexOf(n) === -1); }
  function legacyWritePatch(key, value) {
    if (key === 'mode') return { crsMode: value, crsCombat: value !== 'rampage' };
    if (key === 'defaultWeapon') return { crsWeapon: value };
    if (key === 'loadoutPreset') return { crsLoadoutPreset: value };
    if (key === 'debrisAnchor') return { crsDebrisAnchor: value };
    if (key === 'debrisLifeMs') return { crsDebrisLifeMs: value, crsDebrisLife: value };
    if (key === 'muted') return { crsMuted: value };
    if (key === 'weaponArt') return { crsWeaponArt: value };
    if (key === 'viewmodel') return { crsViewmodel: value };
    return null;
  }

  /* ---- applying one setting to the live page ---------------------------------
   * Every branch is idempotent and silent: it never writes storage and never toasts, so it is safe to run
   * from a storage event raised by another tab. The ones with no branch here (mode / defaultWeapon /
   * loadoutPreset / debrisAnchor on a legacy-owned load) are applied by the v1 paths instead. */
  function settingApply(key, value) {
    try {
      if (key === 'mode') { if (value !== state.mode) setPlayMode(value, { silent: true }); }
      else if (key === 'defaultWeapon') { if (!state.weaponTouched && value !== state.weapon) setWeapon(value, { silent: true }); }
      else if (key === 'loadoutPreset') { if (!state.loadoutTouched && PRESETS[value]) setLoadout(PRESETS[value], { preset: value, silent: true }); }
      else if (key === 'debrisAnchor') setDebrisAnchor(value, true);
      else if (key === 'debrisLifeMs') applyDebrisLife(value);
      else if (key === 'debrisCap') enforceCap(0, 0);
      else if (key === 'soundVolume') applySoundVolume();
      else if (key === 'muted') {
        if (!!value !== !!state.muted) {
          state.muted = !!value;
          if (state.muted) stopLoop(); else if (state.hold && state.hold.id === 'flame') { ensureAudio(); startLoop(); }
          updateHud();
        }
      }
      else if (key === 'weaponArt') { if (WEAPON_ART_MODES.indexOf(value) !== -1) { wpnOpts.weaponArt = value; applyWeaponOpts(); } }
      else if (key === 'viewmodel') { wpnOpts.viewmodel = !!value; applyWeaponOpts(); }
      else if (key === 'combatDifficulty') debug.difficulty = value;
      else if (key === 'perfMode') perfResolve(true);
      else if (key === 'reduceMotion') a11yMotionChanged();
      else if (key === 'highContrastMarkers') a11yContrastChanged();
      else if (key === 'keyboardAim') a11yAimChanged();
    } catch (e) { /* a page that fights back must never break a settings write */ }
  }
  /* The runtime half of api.setDebrisLife(), with no storage write of its own. */
  function applyDebrisLife(ms) {
    ms = +ms;
    if (!isFinite(ms) || ms < 0) return state.debrisLifeMs;
    state.debrisLifeMs = ms;
    for (const p of state.pieces) if (p.resting) p.expireAt = ms > 0 ? now() + ms + rand(-DEBRIS_JITTER, DEBRIS_JITTER) : 0;
    scheduleDebrisSweep();
    return state.debrisLifeMs;
  }
  function soundGain() { return clamp(settingsGet('soundVolume') / 100, 0, 1); }
  function applySoundVolume() {
    if (!audio.master) return;
    try { audio.master.gain.value = soundGain(); } catch (e) { /* ignore */ }
  }
  /* Push every setting onto the live page. `opts.all` ignores the legacy-defers rule (used after a write,
   * where the caller already knows the setting is the authority). */
  function settingsApply(opts) {
    const all = !!(opts && opts.all);
    for (const key of Object.keys(SETTING_BY_KEY)) {
      if (!all) {
        if (!settingsExplicit.has(key)) continue;                 // never fight a default with a default
        if (settingsMeta.legacyPresent.has(key)) continue;         // the v1 path still owns this one this load
      }
      settingApply(key, settingsGet(key));
    }
  }

  /* ---- storage ---------------------------------------------------------------
   * One read per page (not per activation): the IIFE body runs once, `window.__crashScreen.toggle()`
   * short-circuits every later injection, and chrome.storage.onChanged keeps the cache fresh from then on.
   * That is what stops the read from racing the first frame — by the second activation the values are
   * already in memory and apply synchronously. */
  function settingsRead(cb) {
    const want = Object.keys(SETTING_BY_KEY).map((k) => SETTING_PREFIX + k);
    want.push(SETTING_MIGRATED);
    safeThen(() => chrome.storage.sync.get(want.concat(legacyKeyList())), (res) => {
      res = res || {};
      settingsMeta.migrated = res[SETTING_MIGRATED] >= SETTINGS_VERSION;
      settingsMeta.legacyPresent.clear();
      /* 1. adopt whatever the v1 flat keys still hold (this is the migration READ half) */
      for (const key of Object.keys(LEGACY_READ)) {
        if (!LEGACY_KEYS_OF[key].some((n) => res[n] !== undefined)) continue;
        let v = LEGACY_READ[key](res);
        if (key === 'debrisLifeMs' && typeof v === 'number' && !settingValid(SETTING_BY_KEY[key], v)) v = nearestDebrisLife(v);
        if (v === undefined || !settingValid(SETTING_BY_KEY[key], v)) continue;   // a junk v1 value is simply not adopted
        settings[key] = v; settingsExplicit.add(key);
        settingsMeta.legacyPresent.add(key);   // the v1 path owns this key for as long as its key is on disk
      }
      /* 2. the namespaced keys win over the legacy ones they replaced */
      for (const key of Object.keys(SETTING_BY_KEY)) {
        const v = res[SETTING_PREFIX + key];
        if (v === undefined) continue;
        if (!settingValid(SETTING_BY_KEY[key], v)) continue;       // a stored value that no longer validates is ignored
        if (settingsMeta.legacyPresent.has(key)) { settingsExplicit.add(key); continue; }   // the v1 key still on disk wins this load
        settings[key] = v; settingsExplicit.add(key);
      }
      settingsMeta.loaded = true;
      settingsMigrate(res);
      settingsApply();
      try { if (cb) cb(); } catch (e) { /* ignore */ }
    });
  }
  function nearestDebrisLife(ms) {
    const opts = SETTING_BY_KEY.debrisLifeMs ? SETTING_BY_KEY.debrisLifeMs.options : null;
    if (!Array.isArray(opts) || !opts.length) return ms;
    let best = opts[0];
    for (const o of opts) if (Math.abs(o - ms) < Math.abs(best - ms)) best = o;
    return best;
  }
  /* §1.3: "구 키 마이그레이션은 한 번만 돌고 구 키를 지운다." The adopted values are written under their
   * new names, the marker is stamped, and the flat keys are dropped. chrome.storage.sync.remove() is wrapped
   * in safe() because a storage shim without it (the e2e harness) must leave the keys exactly where they are
   * rather than taking the whole load down. */
  function settingsMigrate(res) {
    if (settingsMeta.migrated) return;
    const patch = {};
    for (const key of settingsMeta.legacyPresent) {
      if (res[SETTING_PREFIX + key] !== undefined) continue;        // already carried over on an earlier run
      if (!settingsExplicit.has(key)) continue;
      patch[SETTING_PREFIX + key] = settings[key];
    }
    patch[SETTING_MIGRATED] = SETTINGS_VERSION;
    settingsMeta.migrated = true;
    safe(() => chrome.storage.sync.set(patch));
    const removing = safe(() => chrome.storage.sync.remove(legacyRemovableKeys()));
    /* The v1 keys are going away in this same tick, so the settings layer has to take ownership NOW — the
     * other async read in flight (loadPrefs') may land on either side of the delete, and leaving the keys
     * marked "legacy-owned" would make THIS one load fall back to the hard defaults. Anything whose only v1
     * key is kept on purpose (loadoutPreset, paired with the crsLoadout array) stays with the v1 path.
     * When remove() is unavailable the keys survive, which is exactly when deferring to them is still right. */
    if (removing !== undefined) {
      for (const key of Object.keys(LEGACY_KEYS_OF)) {
        if (LEGACY_KEYS_OF[key].every((n) => LEGACY_KEEP.indexOf(n) !== -1)) continue;
        settingsMeta.legacyPresent.delete(key);
      }
    }
  }
  /* §1.3: an options tab writing a value must land on every open page WITHOUT re-activation. */
  function settingsSubscribe() {
    if (settingsMeta.subscribed) return;
    const ok = safe(() => {
      chrome.storage.onChanged.addListener(settingsChanged);
      return true;
    });
    settingsMeta.subscribed = !!ok;
  }
  function settingsChanged(changes, area) {
    if (area && area !== 'sync') return;
    if (!changes || typeof changes !== 'object') return;
    for (const name of Object.keys(changes)) {
      if (name.slice(0, SETTING_PREFIX.length) !== SETTING_PREFIX) continue;
      const key = name.slice(SETTING_PREFIX.length);
      const entry = SETTING_BY_KEY[key];
      if (!entry) continue;
      const nv = changes[name] ? changes[name].newValue : undefined;
      if (nv === undefined) {                                      // the key was deleted: fall back to the default
        settings[key] = entry.default;
        settingsExplicit.delete(key);
        settingsMeta.legacyPresent.delete(key);
        settingApply(key, entry.default);
        continue;
      }
      if (!settingValid(entry, nv)) { settingFail('ignored an invalid stored value for "' + key + '": ' + settingShow(nv)); continue; }
      if (settings[key] === nv && settingsExplicit.has(key)) continue;
      settings[key] = nv;
      settingsExplicit.add(key);
      settingsMeta.legacyPresent.delete(key);                      // an explicit write retires the v1 key for good
      settingApply(key, nv);
    }
  }

  /* ---- the two public entry points (§1.3) ---- */
  function setSettingValue(key, value) {
    const entry = SETTING_BY_KEY[key];
    if (!entry) return settingFail('unknown key ' + settingShow(key));
    if (!settingValid(entry, value)) return settingFail('invalid value for "' + key + '": ' + settingShow(value));
    settings[key] = value;
    settingsExplicit.add(key);
    settingsMeta.legacyPresent.delete(key);
    const patch = {};
    patch[SETTING_PREFIX + key] = value;
    const mirror = legacyWritePatch(key, value);                   // one release of compatibility; see LEGACY_READ
    if (mirror) Object.assign(patch, mirror);
    safe(() => chrome.storage.sync.set(patch));
    settingApply(key, value);
    return true;
  }
  /* Used by the v1 setters (wrapped in src/99-api.js): the user changed something through the HUD or a
   * hotkey, so the namespaced key has to follow or the next load would resurrect the old value. */
  function settingsMirror(key, value) {
    const entry = SETTING_BY_KEY[key];
    if (!entry || !settingValid(entry, value)) return false;
    if (settings[key] === value && settingsExplicit.has(key)) return true;
    settings[key] = value;
    settingsExplicit.add(key);
    settingsMeta.legacyPresent.delete(key);
    const patch = {};
    patch[SETTING_PREFIX + key] = value;
    safe(() => chrome.storage.sync.set(patch));
    return true;
  }

  /* settingsBoot() is called ONCE from src/99-api.js, after every module has been evaluated and before the
   * first activate(). Reading at injection time rather than at activate() is what keeps the storage round
   * trip from racing the first frame: by the second activation the values are already in memory and apply
   * synchronously, and chrome.storage.onChanged keeps them fresh in between. */
  function settingsBoot() {
    settingsSubscribe();
    settingsRead();
  }
