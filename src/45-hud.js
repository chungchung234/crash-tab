  /* ===================================================================== */
  /* 6. HUD (shadow DOM, constructed stylesheet)                            */
  /* ===================================================================== */
  const HUD_CSS = [
    ':host{all:initial;display:block;cursor:default;color-scheme:dark}',
    '*{box-sizing:border-box}',
    '.panel{font:13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#fff;background:rgba(18,18,22,.86);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.14);border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.45);padding:10px 12px;width:max-content;min-width:300px;max-width:380px;user-select:none;-webkit-user-select:none}',
    '.title{display:flex;align-items:center;gap:6px;font-weight:700;font-size:14px;cursor:grab;touch-action:none;padding:2px 2px 8px;letter-spacing:.2px}',
    // v1.2: ADS fades the weapon panel (ammo / player HUD / toast stay) so it never covers the scope circle
    ':host(.crs-scoped) .panel{opacity:.12;pointer-events:none;transition:opacity .15s ease-out}',
    '.title:active{cursor:grabbing}',
    '.row{display:flex;gap:6px;margin-top:6px}',
    // v1.2 A6: compact 2 × 5 grid — slot badge + emoji only; name / damage live in title, aria-label and the .cur readout
    '.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin-top:6px}',
    'button{all:unset;display:inline-flex;align-items:center;justify-content:center;gap:4px;flex:1 1 0;min-width:max-content;height:30px;padding:0 6px;border-radius:9px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);color:#fff;font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap;text-align:center;transition:background .12s}',
    '.grid button{position:relative;min-width:0;flex:none;justify-content:center;gap:0;padding:0;overflow:hidden;font-size:16px;touch-action:none}',
    '.grid button.dragging{opacity:.6;transform:scale(.94)}',
    '.badge{position:absolute;top:2px;left:4px;font-size:9px;line-height:1.3;padding:0 3px;border-radius:4px;background:rgba(255,255,255,.18);font-weight:700}',
    '.cur{margin-top:6px;font-size:12.5px;color:rgba(255,255,255,.92);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.presets{display:flex;align-items:center;gap:3px;margin-top:6px}',
    '.presets .plabel{flex:none;font-size:11.5px;color:rgba(255,255,255,.7);white-space:nowrap;margin-right:2px}',
    '.presets button{flex:0 0 auto;min-width:max-content;height:24px;padding:0 4px;font-size:11px;border-radius:7px}',
    '.presets .custom{flex:none;font-size:10.5px;color:#ffb224;white-space:nowrap}',
    '.power{align-items:center}',
    '.power .ptxt{flex:1 1 auto;min-width:0;padding-left:2px;font-size:12.5px;color:rgba(255,255,255,.85);white-space:nowrap}',
    '.power button{flex:0 0 36px;min-width:0;font-size:14px}',
    'button:hover{background:rgba(255,255,255,.16)}',
    'button:focus-visible{outline:2px solid #e5484d;outline-offset:1px}',
    'button[aria-pressed="true"]{background:#e5484d;border-color:#e5484d}',
    'button.holding{animation:crs-hold 700ms ease-in-out infinite alternate}',
    '@keyframes crs-hold{from{border-color:rgba(255,255,255,.3)}to{border-color:#ffb224}}',
    '.status{contain:inline-size;margin-top:8px;font-size:12px;color:rgba(255,255,255,.78);display:flex;flex-wrap:wrap;align-items:center;gap:0 6px;min-height:17px}',
    '.hint{flex:1 1 100%;color:rgba(255,255,255,.62)}',
    '.combo{display:inline-block;color:#ffb224;font-weight:700}',
    '.combo.pop{animation:pop .15s ease-out}',
    '.last{flex:1 1 100%;min-height:17px;color:#ffe9a8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '@keyframes pop{from{transform:scale(1.4)}to{transform:scale(1)}}',
    // v1.2 A11: ammo HUD / player HUD / toast / KO live in this shadow root as siblings of .panel (host pins transform: none)
    '.crs-ammo,.crs-player,.crs-toast,.crs-ko{font:13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#fff;user-select:none;-webkit-user-select:none}',
    '.crs-ammo{position:fixed;right:16px;bottom:16px;pointer-events:none;text-align:right;background:rgba(18,18,22,.72);padding:8px 12px;border-radius:12px;min-width:200px;box-shadow:0 6px 20px rgba(0,0,0,.35)}',
    '.crs-ammo .aline{display:flex;align-items:baseline;justify-content:flex-end;gap:6px}',
    '.crs-ammo .aemoji{font-size:18px}',
    '.crs-ammo .abig{font-size:28px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}',
    '.crs-ammo .abig.low{color:#e5484d}',
    '.crs-ammo .adim{font-size:14px;opacity:.6}',
    '.crs-ammo .abar{width:120px;height:4px;background:rgba(255,255,255,.2);border-radius:2px;margin:6px 0 0 auto;overflow:hidden;display:none}',
    '.crs-ammo .abar.on{display:block}',
    '.crs-ammo .afill{height:100%;width:0;background:#ffb224}',
    '.crs-ammo .aprompt{font-size:12px;color:#e5484d;font-weight:700;display:none;margin-top:4px}',
    '.crs-ammo .aprompt.on{display:block}',
    '.crs-player{position:fixed;left:16px;bottom:16px;pointer-events:none;background:rgba(18,18,22,.72);padding:8px 12px;border-radius:12px;display:none;box-shadow:0 6px 20px rgba(0,0,0,.35)}',
    '.crs-player.on{display:block}',
    '.crs-player .hrow{display:flex;align-items:center;gap:8px}',
    '.crs-player .hbar{width:160px;height:10px;background:rgba(255,255,255,.2);border-radius:5px;overflow:hidden}',
    '.crs-player .hfill{height:100%;width:100%;background:#3fb950}',
    '.crs-player .php{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.crs-player .pstats{margin-top:4px;font-size:12px;color:rgba(255,255,255,.85);white-space:nowrap}',
    '.crs-toast{position:fixed;left:50%;top:14px;transform:translate(-50%,0);background:rgba(18,18,22,.92);padding:7px 14px;border-radius:999px;pointer-events:none;display:none;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.14);z-index:6}',
    '.crs-toast.show{display:block}',
    '.crs-ko{position:fixed;inset:0;background:rgba(0,0,0,.78);pointer-events:auto;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;z-index:5}',
    '.crs-ko.show{display:flex}',
    '.crs-ko .kt{font-size:30px;font-weight:800;letter-spacing:.3px}',
    '.crs-ko .ks{font-size:15px;color:rgba(255,255,255,.85)}',
    '.crs-ko .kb{display:flex;gap:10px;margin-top:8px}',
    '.crs-ko button{flex:none;height:38px;padding:0 18px;font-size:14px;background:rgba(255,255,255,.12)}'
  ].join('\n');

  function hudButton(label, title, onClick) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', (e) => { e.preventDefault(); try { onClick(); } catch (err) { /* ignore */ } });
    return b;
  }
  function buildHud() {
    const host = mk('crs-hud', 'crs-hud-host');
    let shadow = null;
    try { shadow = host.attachShadow({ mode: 'open' }); } catch (e) { shadow = null; }
    const mountPoint = shadow || host;
    let styled = false;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(HUD_CSS);
      mountPoint.adoptedStyleSheets = [sheet];
      styled = true;
    } catch (e) { styled = false; }
    if (!styled) {
      try { const st = doc.createElement('style'); st.textContent = HUD_CSS; mountPoint.append(st); } catch (e) { /* ignore */ }
    }
    const panel = doc.createElement('div'); panel.className = 'panel';
    const title = doc.createElement('div'); title.className = 'title';
    title.textContent = '🔨 ' + msg('hudTitle');
    // weapons: 2 × 5 compact grid in loadout order — slot badge + emoji (v1.2 A6); created once, re-appended on reorder
    const grid = doc.createElement('div'); grid.className = 'grid';
    hudEls.grid = grid;
    hudEls.weaponBtns = {}; hudEls.badges = {};
    let gridDrag = null, suppressClick = false;
    for (const id of WEAPON_IDS) {
      const W = WEAPONS[id];
      const b = doc.createElement('button');
      b.type = 'button';
      b.setAttribute('data-weapon', id);
      b.setAttribute('aria-pressed', 'false');
      const badge = doc.createElement('span'); badge.className = 'badge';
      const em = doc.createElement('span'); em.className = 'em'; em.textContent = W.emoji;
      b.append(badge, em);
      b.addEventListener('click', (e) => {
        e.preventDefault();
        if (suppressClick) { suppressClick = false; return; }   // the click that follows a drag
        try { setWeapon(id); } catch (err) { /* ignore */ }
      });
      // drag reorder (A6): pointer capture on the pressed button, 6 px threshold, drop via shadowRoot.elementFromPoint
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        suppressClick = false;
        gridDrag = { id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, dragging: false };
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });
      b.addEventListener('pointermove', (e) => {
        if (!gridDrag || gridDrag.id !== id || gridDrag.dragging) return;
        if (Math.hypot(e.clientX - gridDrag.x, e.clientY - gridDrag.y) >= 6) { gridDrag.dragging = true; try { b.classList.add('dragging'); } catch (err) { /* ignore */ } }
      });
      const endDrag = (e) => {
        if (!gridDrag || gridDrag.id !== id) return;
        const d = gridDrag; gridDrag = null;
        try { b.releasePointerCapture(d.pointerId); } catch (err) { /* ignore */ }
        try { b.classList.remove('dragging'); } catch (err) { /* ignore */ }
        if (!d.dragging) return;
        suppressClick = true;
        if (e.type !== 'pointerup') return;
        let target = null;
        try { target = (hudShadow || doc).elementFromPoint(e.clientX, e.clientY); } catch (err) { target = null; }
        const drop = target && target.closest ? target.closest('button[data-weapon]') : null;
        const dropId = drop ? drop.getAttribute('data-weapon') : null;
        if (dropId && dropId !== id) { try { moveToSlot(id, slotOf(dropId)); } catch (err) { /* ignore */ } }
      };
      b.addEventListener('pointerup', endDrag);
      b.addEventListener('pointercancel', endDrag);
      hudEls.weaponBtns[id] = b; hudEls.badges[id] = badge;
      grid.append(b);
    }
    // preset row (A6): 로드아웃 [기본][돌격][저격][폭발][근접] (사용자 지정)
    const presets = doc.createElement('div'); presets.className = 'presets';
    const plabel = doc.createElement('span'); plabel.className = 'plabel'; plabel.textContent = msg('labelLoadout');
    presets.append(plabel);
    hudEls.presetBtns = {};
    for (const name of Object.keys(PRESETS)) {
      const pb = hudButton(msg(PRESET_KEYS[name]), msg('labelLoadout') + ': ' + msg(PRESET_KEYS[name]), () => applyPreset(name));
      pb.setAttribute('data-preset', name);
      pb.setAttribute('aria-pressed', 'false');
      hudEls.presetBtns[name] = pb;
      presets.append(pb);
    }
    hudEls.customTag = doc.createElement('span'); hudEls.customTag.className = 'custom'; hudEls.customTag.textContent = msg('presetCustom');
    presets.append(hudEls.customTag);
    // active weapon readout
    hudEls.cur = doc.createElement('div'); hudEls.cur.className = 'cur';
    const actions = doc.createElement('div'); actions.className = 'row';
    hudEls.sound = hudButton('🔊 ' + msg('btnSound'), msg('btnSound') + ' (M)', () => setMuted(!state.muted));
    hudEls.restore = hudButton('↺ ' + msg('btnRestore'), msg('btnRestore') + ' (Z)', () => restore());
    hudEls.combatBtn = hudButton('⚔️ ' + msg('labelCombat') + ' ON', msg('labelCombat') + ' (H)', () => setCombat(!state.combat));
    hudEls.combatBtn.className = 'crs-combat-toggle';
    hudEls.exit = hudButton('✕ ' + msg('btnExit'), msg('btnExit') + ' (Esc)', () => deactivate());
    actions.append(hudEls.sound, hudEls.restore, hudEls.combatBtn, hudEls.exit);
    // attack power row (§4): "공격력 ×1  [−] [+]"
    const power = doc.createElement('div'); power.className = 'row power';
    hudEls.powerText = doc.createElement('span'); hudEls.powerText.className = 'ptxt';
    hudEls.powerDown = hudButton('−', msg('btnPowerDown') + ' (-)', () => stepPower(-1));
    hudEls.powerDown.className = 'crs-power-down';
    hudEls.powerUp = hudButton('+', msg('btnPowerUp') + ' (=)', () => stepPower(1));
    hudEls.powerUp.className = 'crs-power-up';
    power.append(hudEls.powerText, hudEls.powerDown, hudEls.powerUp);
    const status = doc.createElement('div'); status.className = 'status';
    hudEls.hint = doc.createElement('span'); hudEls.hint.className = 'hint';
    hudEls.pieces = doc.createElement('span');
    hudEls.cracks = doc.createElement('span');
    hudEls.damage = doc.createElement('span');
    hudEls.score = doc.createElement('span');   // "· 점수 N" while combat is on (v1.2 §7)
    hudEls.combo = doc.createElement('span'); hudEls.combo.className = 'combo';
    hudEls.last = doc.createElement('span'); hudEls.last.className = 'last';
    status.append(hudEls.hint, hudEls.pieces, hudEls.cracks, hudEls.damage, hudEls.score, hudEls.combo, hudEls.last);
    panel.append(title, grid, presets, hudEls.cur, actions, power, status);
    mountPoint.append(panel);
    hudEls.panel = panel; hudEls.title = title;
    // v1.2 A11: ammo HUD (bottom-right), player HUD (bottom-left), toast (top-centre), KO overlay — shadow siblings of .panel
    const ammo = mk('div', 'crs-ammo');
    const aline = doc.createElement('div'); aline.className = 'aline';
    hudEls.aEmoji = doc.createElement('span'); hudEls.aEmoji.className = 'aemoji';
    hudEls.aBig = doc.createElement('span'); hudEls.aBig.className = 'abig';
    hudEls.aDim = doc.createElement('span'); hudEls.aDim.className = 'adim';
    aline.append(hudEls.aEmoji, hudEls.aBig, hudEls.aDim);
    hudEls.aBar = doc.createElement('div'); hudEls.aBar.className = 'abar';
    hudEls.aFill = doc.createElement('div'); hudEls.aFill.className = 'afill';
    hudEls.aBar.append(hudEls.aFill);
    hudEls.aPrompt = doc.createElement('div'); hudEls.aPrompt.className = 'aprompt'; hudEls.aPrompt.textContent = 'R ' + msg('toastReload');
    ammo.append(aline, hudEls.aBar, hudEls.aPrompt);
    hudEls.ammo = ammo;
    const player = mk('div', 'crs-player');
    const hrow = doc.createElement('div'); hrow.className = 'hrow';
    const hbar = doc.createElement('div'); hbar.className = 'hbar';
    hudEls.pFill = doc.createElement('div'); hudEls.pFill.className = 'hfill';
    hbar.append(hudEls.pFill);
    hudEls.pHp = doc.createElement('span'); hudEls.pHp.className = 'php';
    hrow.append(hbar, hudEls.pHp);
    hudEls.pStats = doc.createElement('div'); hudEls.pStats.className = 'pstats';
    player.append(hrow, hudEls.pStats);
    hudEls.player = player;
    hudEls.toast = mk('div', 'crs-toast');
    hudEls.mount = mountPoint;   // the KO overlay (`.crs-ko`) is built on demand by showKo() and removed by hideKo()
    mountPoint.append(ammo, player, hudEls.toast);
    reorderHud();
    hudShadow = shadow;
    // drag by the title bar (clamped to the viewport)
    let drag = null;
    title.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = host.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
      try { title.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    });
    title.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const l = clamp(e.clientX - drag.dx, 0, Math.max(0, viewW() - drag.w));
      const t = clamp(e.clientY - drag.dy, 0, Math.max(0, viewH() - drag.h));
      host.style.setProperty('--crs-hud-left', px(l));
      host.style.setProperty('--crs-hud-top', px(t));
      host.style.setProperty('--crs-hud-right', 'auto');
    });
    const endDrag = (e) => { if (!drag) return; drag = null; try { title.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ } };
    title.addEventListener('pointerup', endDrag);
    title.addEventListener('pointercancel', endDrag);
    return host;
  }
  function hudFallbackCheck() {
    // If neither adoptedStyleSheets nor the <style> fallback took effect (CSP), style minimally via CSSOM.
    try {
      const bg = gcsRaw(hudEls.panel).backgroundColor;
      if (alphaOf(bg) < 0.05) {
        const p = hudEls.panel.style;
        p.background = 'rgba(18,18,22,.92)'; p.color = '#fff'; p.padding = '10px 12px'; p.borderRadius = '14px';
        p.font = '13px system-ui, sans-serif'; p.width = 'max-content'; p.minWidth = '300px'; p.maxWidth = '380px'; p.boxShadow = '0 10px 30px rgba(0,0,0,.45)';
        for (const b of hudEls.panel.querySelectorAll('button')) { b.style.margin = '2px'; b.style.padding = '4px 6px'; b.style.color = '#fff'; b.style.background = 'rgba(255,255,255,.12)'; b.style.border = '1px solid rgba(255,255,255,.2)'; b.style.borderRadius = '8px'; b.style.cursor = 'pointer'; }
        // v1.2 A11: the shadow siblings get a minimal fixed placement too (their .on / .show classes are mirrored by style.display)
        const fixed = (n, l, r, t, b) => { const s = n.style; s.position = 'fixed'; s.left = l; s.right = r; s.top = t; s.bottom = b; s.color = '#fff'; s.background = 'rgba(18,18,22,.85)'; s.padding = '8px 12px'; s.borderRadius = '12px'; s.font = '13px system-ui, sans-serif'; s.pointerEvents = 'none'; };
        if (hudEls.ammo) fixed(hudEls.ammo, 'auto', '16px', 'auto', '16px');
        if (hudEls.player) { fixed(hudEls.player, '16px', 'auto', 'auto', '16px'); hudEls.player.style.display = state.combat ? 'block' : 'none'; }
        if (hudEls.toast) { fixed(hudEls.toast, '50%', 'auto', '14px', 'auto'); hudEls.toast.style.transform = 'translate(-50%, 0)'; hudEls.toast.style.display = 'none'; }
        hudEls.fallback = true;   // showKo() styles the on-demand KO overlay the same way
      }
    } catch (e) { /* ignore */ }
  }
  function weaponLabel(W) {
    if (W.id === 'smg') return W.damage + msg('unitPerShot');
    if (W.id === 'flame') return W.damage + msg('unitPerTick');
    if (W.id === 'collapse') return '∞';
    return String(W.damage);
  }
  function fmtPower(v) { return '×' + (v === 0.5 ? '0.5' : String(v)); }
  function updateHud() {
    if (!hudEls.panel) return;
    try {
      for (const id of WEAPON_IDS) {
        const b = hudEls.weaponBtns[id];
        if (b) b.setAttribute('aria-pressed', state.weapon === id ? 'true' : 'false');
      }
      hudEls.sound.textContent = state.muted ? '🔇 ' + msg('btnMute') : '🔊 ' + msg('btnSound');
      hudEls.sound.title = (state.muted ? msg('btnMute') : msg('btnSound')) + ' (M)';
      hudEls.sound.setAttribute('aria-pressed', state.muted ? 'true' : 'false');
      hudEls.powerText.textContent = msg('labelPower') + ' ' + fmtPower(state.power);
      const W = WEAPONS[state.weapon];
      hudEls.hint.textContent = state.hintCollapse ? msg('hudHintCollapse') : (W.hold ? msg('hudHintHold') : (W.input === 'drag' ? msg('hudHintDrag') : (W.scope ? msg('hudHintScope') : msg('hudHint'))));
      hudEls.pieces.textContent = msg('hudPieces') + ' ' + debrisCount();
      hudEls.cracks.textContent = '· ' + msg('hudCracks') + ' ' + state.cracks;
      hudEls.damage.textContent = '· ' + msg('hudDamage') + ' ' + state.damageDealt;
      hudEls.score.textContent = state.combat ? '· ' + msg('labelScore') + ' ' + state.player.score : '';
      hudEls.combo.textContent = state.combo >= 2 ? '· x' + state.combo : '';
      // v1.2: readout, preset row, combat toggle
      hudEls.cur.textContent = W.emoji + ' ' + msg(W.name) + ' · ' + weaponLabel(W);
      for (const name of Object.keys(PRESETS)) { const pb = hudEls.presetBtns[name]; if (pb) pb.setAttribute('aria-pressed', state.preset === name ? 'true' : 'false'); }
      const custom = state.preset === 'custom';
      hudEls.customTag.textContent = custom ? msg('presetCustom') : '';   // text only while custom (the tag "shows")
      hudEls.customTag.style.display = custom ? 'inline' : 'none';
      hudEls.combatBtn.textContent = '⚔️ ' + msg('labelCombat') + ' ' + (state.combat ? 'ON' : 'OFF');
      hudEls.combatBtn.title = msg('labelCombat') + ' ' + (state.combat ? 'ON' : 'OFF') + ' (H)';
      hudEls.combatBtn.setAttribute('aria-pressed', state.combat ? 'true' : 'false');
    } catch (e) { /* ignore */ }
  }
  /* Hot paths (hold ticks, staggered AoE hits) refresh the counters at most once per frame (A5 item 4). */
  function scheduleHud() {
    if (state.hudRaf || !state.active) return;
    state.hudRaf = raf(() => { state.hudRaf = 0; updateHud(); updateAmmoHud(); });
  }
  /* Grid order follows the loadout (v1.2 A6): the existing button nodes are re-appended; badge + title rewritten. */
  function reorderHud() {
    const grid = hudEls.grid;
    if (!grid || !hudEls.weaponBtns) return;
    try {
      state.loadout.forEach((id, i) => {
        const b = hudEls.weaponBtns[id]; if (!b) return;
        const W = WEAPONS[id], key = slotKey(i + 1);
        hudEls.badges[id].textContent = key;
        const t = key + ' · ' + msg(W.name) + ' · ' + weaponLabel(W);
        b.title = t; b.setAttribute('aria-label', t);
        grid.append(b);
      });
    } catch (e) { /* ignore */ }
  }
  function pulseBadge(id) {
    const badge = hudEls.badges && hudEls.badges[id];
    if (!badge || reducedMotion()) return;
    try { trackAnim(badge.animate([{ transform: 'scale(1.7)', background: '#ffb224', color: '#000' }, { transform: 'scale(1)', background: 'rgba(255,255,255,.18)', color: '#fff' }], { duration: 450, easing: 'ease-out' })); } catch (e) { /* ignore */ }
  }
  /* "IMG -65 (62/127)" for 1.2 s on its own reserved line (fixed height, so the panel never resizes under the
   * player's hand); "치명타! " prefix on crit (A5 item 4). */
  function hudLastHit(el, dmg, hp, max, crit, headshot) {
    try {
      hudEls.last.textContent = (crit ? msg(headshot ? 'headshotLabel' : 'critLabel') + ' ' : '') + tagOf(el).toUpperCase() + ' -' + dmg + ' (' + Math.max(0, hp) + '/' + max + ')';
      untrack(state.lastHitTimer);
      state.lastHitTimer = later(() => { state.lastHitTimer = 0; hudEls.last.textContent = ''; }, 1200);
    } catch (e) { /* ignore */ }
  }
  function bumpCombo() {
    const t = now();
    state.combo = (t - state.lastHitAt <= 700) ? state.combo + 1 : 1;
    state.lastHitAt = t;
    untrack(state.comboTimer);
    state.comboTimer = later(() => { state.comboTimer = 0; state.combo = 0; updateHud(); }, 700);
    try {
      hudEls.combo.classList.remove('pop');
      void hudEls.combo.offsetWidth;
      if (state.combo >= 2) hudEls.combo.classList.add('pop');
    } catch (e) { /* ignore */ }
  }
