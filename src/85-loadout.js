  /* --- loadouts (A6) --- */
  function isPermutation(ids) {
    if (!Array.isArray(ids) || ids.length !== WEAPON_IDS.length) return false;
    const seen = new Set();
    for (const id of ids) { if (!WEAPON_IDS.includes(id) || seen.has(id)) return false; seen.add(id); }
    return true;
  }
  function setLoadout(ids, opts) {
    if (!isPermutation(ids)) return false;
    const silent = !!(opts && opts.silent);
    state.loadout = ids.slice();
    state.preset = (opts && opts.preset) || 'custom';
    if (!silent) { state.loadoutTouched = true; safe(() => chrome.storage.sync.set({ crsLoadout: state.loadout.slice(), crsLoadoutPreset: state.preset })); }
    reorderHud();
    updateHud();
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
