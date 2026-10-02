  /* ===================================================================== */
  /* 2. Mount points, top layer, zoom                                       */
  /* ===================================================================== */
  function raise(host) {
    try { host.popover = 'manual'; host.showPopover(); } catch (e) {
      try { host.removeAttribute('popover'); } catch (e2) { /* ignore */ }
    }
  }
  function lower(host) {
    try { if (host.matches(':popover-open')) host.hidePopover(); } catch (e) { /* ignore */ }
  }
  function reraiseAll() {
    for (const h of [shield, root, hud]) {
      if (!h) continue;
      try { if (h.matches(':popover-open')) { h.hidePopover(); h.showPopover(); } } catch (e) { /* ignore */ }
    }
  }
  function ensureMounted() {
    for (const h of [shield, root, hud]) {
      if (h && !h.isConnected) { try { docEl.append(h); raise(h); } catch (e) { /* ignore */ } }
    }
  }
  function applyZoom() {
    let z = 1;
    try { z = parseFloat(gcsRaw(docEl).zoom) || 1; } catch (e) { z = 1; }
    for (const h of [shield, root, hud]) {
      if (!h) continue;
      if (Math.abs(z - 1) > 0.001) imp(h, 'zoom', String(1 / z)); else { try { h.style.removeProperty('zoom'); } catch (e) { /* ignore */ } }
    }
  }
  function mountHosts() {
    shield = mk('div', 'crs-shield');
    shield.setAttribute('aria-hidden', 'true');
    root = mk('div', 'crs-root');
    root.setAttribute('aria-hidden', 'true');
    targetBox = mk('div', 'crs-target');
    targetLabel = mk('span', 'crs-target-label');
    targetBar = mk('div', 'crs-target-bar');       // health bar under the label (A11)
    targetFill = mk('div', 'crs-target-fill');
    targetBar.append(targetFill);
    targetBox.append(targetLabel, targetBar);
    targetBox.style.display = 'none';
    canvas = mk('canvas', 'crs-canvas');
    root.append(targetBox, canvas);
    hud = buildHud();
    docEl.append(shield, root, hud);
    raise(shield); raise(root); raise(hud);
    applyZoom();
    hudFallbackCheck();
  }
