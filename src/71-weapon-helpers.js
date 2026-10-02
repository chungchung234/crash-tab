// ── shared combat helpers: crit/damage rolls (v1.3 §1: no power multiplier), cooldown gate, HUD weapon-button lookup ──
  /* ===================================================================== */
  /* 12. Weapons (v1.1): damage roll, hit feedback, the nine fire() entries, actions   */
  /* ===================================================================== */
  function rollCrit() { return debug.forceCrit ? true : (debug.noCrit ? false : Math.random() < 0.1); }
  function rollSniperCrit(scoped) { return debug.forceCrit ? true : (debug.noCrit ? false : Math.random() < (scoped ? 0.25 : 0.1)); }   // 헤드샷 (v1.2 §2)
  function rollDamage(base, crit) { return Math.max(1, Math.round(base * (crit ? 2 : 1))); }   // v1.3 §1: the power multiplier is gone
  function reducedMotion() { try { return win.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function weaponBtn(id) { return (hudEls.weaponBtns && hudEls.weaponBtns[id]) || null; }
  function willBreak(el, dmg) { if (!el) return false; const r = state.hp.get(el); return (r ? r.hp : hpMax(el)) - dmg <= 0; }
