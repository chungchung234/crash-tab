  /* --- loadouts (A6, rewritten by SPEC-arsenal §B1) ---
   * The loadout used to be a PERMUTATION of the whole weapon table. With 12 weapons and 10 number keys it
   * cannot be: §B1 makes it "무기고에서 고른 최대 10개의 순서 있는 목록" — a subset, no duplicates, length
   * 1–10. isPermutation() keeps its name and its callers (loadPrefs' stored-array guard is the only other
   * one) but now answers that question; isLoadout() is the name the new code reads better with. */
  function isLoadout(ids) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > LOADOUT_MAX) return false;
    const seen = new Set();
    for (const id of ids) { if (!WEAPON_IDS.includes(id) || seen.has(id)) return false; seen.add(id); }
    return true;
  }
  function isPermutation(ids) { return isLoadout(ids); }
  /* §B1: 무기고 — every weapon that exists, in table order. Not the loadout and never reordered. */
  function arsenalList() { return WEAPON_IDS.slice(); }
  function inLoadout(id) { return state.loadout.indexOf(id) >= 0; }
  function setLoadout(ids, opts) {
    const list = migrateWeaponIds(ids);   // §8.1: a caller (or a stored array) still saying 'sword' is accepted once
    if (!isLoadout(list)) return false;
    const silent = !!(opts && opts.silent);
    state.loadout = list.slice();
    state.preset = (opts && opts.preset) || 'custom';
    if (!silent) { state.loadoutTouched = true; safe(() => chrome.storage.sync.set({ crsLoadout: state.loadout.slice(), crsLoadoutPreset: state.preset })); }
    /* §B1: the weapon in hand may have just been dropped from the loadout. Fall back to slot 1 rather than
     * leaving the player holding something no key can reselect — a silent swap, so no draw animation and no
     * stored-preference write fights the one setLoadout() just made. */
    if (!inLoadout(state.weapon)) setWeapon(state.loadout[0], { silent: true });
    reorderHud();
    updateHud();
    updateAmmoHud();
    return true;
  }
  function applyPreset(name) {
    if (!PRESETS[name]) return false;
    setLoadout(PRESETS[name], { preset: name });
    toast(msg('labelLoadout') + ': ' + msg(PRESET_KEYS[name]));
    return true;
  }
  /* Shift+digit / drag: the weapon takes `slot`, the slot's previous weapon takes the old slot. */
  function moveToSlot(id, slot) {
    const i = state.loadout.indexOf(id), j = slot - 1;
    if (i < 0 || j < 0 || j >= state.loadout.length) return false;
    const other = state.loadout[j];
    if (i !== j) { const arr = state.loadout.slice(); arr[j] = id; arr[i] = other; setLoadout(arr); }
    const W = WEAPONS[id];
    toast(slotKey(slot) + ' ← ' + W.emoji + ' ' + msg(W.name));
    pulseBadge(id); if (other !== id) pulseBadge(other);
    return true;
  }
  function stepSlot(dir) {
    const n = state.loadout.length, i = state.loadout.indexOf(state.weapon);
    return setWeapon(state.loadout[((((i < 0 ? 0 : i) + dir) % n) + n) % n]);
  }
