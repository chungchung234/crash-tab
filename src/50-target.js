  /* ===================================================================== */
  /* 7. Target picking + hover highlight                                    */
  /* ===================================================================== */
  /* Effective opacity = product of computed opacity up the (shadow-crossing) ancestor chain, ≤ 40 levels.
   * Hit testing ignores opacity, so an opacity:0 hover overlay (quick-view buttons, gallery captions)
   * would otherwise be picked ahead of the visible image beneath it. Memoised per pick in `cache`. */
  function effectiveOpacity(el, cache, depth) {
    if (cache.has(el)) return cache.get(el);
    const s = gcs(el);
    let own = s ? parseFloat(s.opacity) : 1;
    if (!isFinite(own)) own = 1;
    let v = own;
    if (own > 0 && depth < 40) {
      const p = parentOf(el);
      if (p && p !== docEl && p.nodeType === 1) v = own * effectiveOpacity(p, cache, depth + 1);
    }
    cache.set(el, v);
    return v;
  }
  /* A8 step 1 rules (a)–(c): not ours, not inert, non-empty rect, effective opacity ≥ 0.05. */
  function visibleCandidate(el, env) {
    if (!el || el.nodeType !== 1) return false;
    if (isOurs(el)) return false;
    try { if (el.closest('[inert]')) return false; } catch (e) { /* ignore */ }
    const r = rectOf(el); if (!r || r.width <= 0 || r.height <= 0) return false;
    if (effectiveOpacity(el, env.op, 0) < 0.05) return false;
    return true;
  }
  /* A8 step 1 rule (d): a full-viewport transparent overlay. */
  function isOverlay(el, env) {
    const r = rectOf(el), s = gcs(el);
    const m2 = scopeMag() * scopeMag();   // page rects are 2× while magnified (v1.2 A3)
    return !!(r && s && r.width * r.height > 0.8 * env.vw * env.vh * m2 && alphaOf(s.backgroundColor) === 0 && s.backgroundImage === 'none');
  }
  /* First entry of `list` (restricted to `rootNode` when given) that passes (a)–(c). A shadow host is
   * descended (A8 step 2, ≤ 5 levels) BEFORE rule (d) is applied to it, so a full-viewport transparent
   * root host (Ionic / Lit / Stencil / Angular ShadowDom apps) still yields its inner element. */
  function pickFromList(list, rootNode, x, y, env, depth) {
    for (const c of list) {
      if (rootNode && !(c.getRootNode && c.getRootNode() === rootNode)) continue;
      if (!visibleCandidate(c, env)) continue;
      if (c.shadowRoot && depth < 5) {
        let inner = null;
        try { inner = pickFromList(c.shadowRoot.elementsFromPoint(x, y), c.shadowRoot, x, y, env, depth + 1); } catch (e) { inner = null; }
        if (inner) return inner;
      }
      if (isOverlay(c, env)) continue;
      return c;
    }
    return null;
  }
  function pickTarget(x, y, cache) {
    const env = { vw: viewW(), vh: viewH(), op: cache || new Map() };
    let list;
    try { list = doc.elementsFromPoint(x, y); } catch (e) { return null; }
    let el = pickFromList(list, null, x, y, env, 0);
    if (!el) return null;
    const vw = env.vw, vh = env.vh;
    const mag = scopeMag(), mag2 = mag * mag;   // thresholds scale with the 2× body transform (v1.2 A3)
    // SVG: treat the outermost <svg> atomically
    if (el.ownerSVGElement) { let s = el; while (s.ownerSVGElement) s = s.ownerSVGElement; el = s; }
    const body = doc.body;
    // walk-up rules
    for (let guard = 0; guard < 40 && el; guard++) {
      const p = parentOf(el);
      if (!p || p === body || p === docEl || p.nodeType !== 1) break;
      const r = rectOf(el); if (!r) break;
      if (r.width < 24 * mag || r.height < 14 * mag) { el = p; continue; }
      const s = gcs(el);
      if (s && s.display === 'inline' && !REPLACED_TAGS.has(tagOf(el))) {
        // find the nearest block ancestor; take it if it is small
        let blk = p, bs = gcs(blk);
        while (blk && blk !== body && blk !== docEl && bs && bs.display === 'inline') { blk = parentOf(blk); bs = blk ? gcs(blk) : null; }
        if (blk && blk !== body && blk !== docEl) {
          const br = rectOf(blk);
          if (br && br.width * br.height < 60000 * mag2) { el = blk; continue; }
        }
      }
      break;
    }
    if (!el || el === body || el === docEl) return null;
    // v1.2: a hostile element fights as a unit — a hit on any of its descendants lands on the hostile itself
    if (state.hostiles.size) { for (const h of state.hostiles.keys()) { if (h !== el && h.contains(el)) { el = h; break; } } }
    const r = rectOf(el);
    if (!r || r.width * r.height > 0.8 * vw * vh * mag2) return null;
    if (el.hasAttribute('data-crs-broken')) return null;
    return el;
  }
  /* Size-based max HP (v1.1 A1): base = 20 + 0.35·sqrt(area); media ×1.2, controls ×1, text-ish ×0.6 capped
   * at 60 (a hammer always one-shots text), containers ×1; clamp [10, 400]. Computed once per element on
   * first contact (hover or hit) and cached in the WeakMap by hpOf(). */
  function hpMax(el) {
    const tag = tagOf(el);
    const r = rectOf(el) || { width: 0, height: 0 };
    const m = scopeMag();   // page-space area: rects are 2× under the scope transform (v1.2 A3)
    const area = Math.max(1, (r.width / m) * (r.height / m));
    const base = 20 + 0.35 * Math.sqrt(area);
    let role = null;
    try { role = el.getAttribute('role'); } catch (e) { role = null; }
    let v;
    if (MEDIA_TAGS.has(tag)) v = Math.round(base * 1.2);
    else if (FORM_TAGS.has(tag) || tag === 'summary' || role === 'button') v = Math.round(base);
    else if (TEXTISH_TAGS.has(tag)) v = Math.min(60, Math.round(base * 0.6));
    else v = Math.round(base);
    return clamp(v, 10, 400);
  }
  function hpOf(el) {
    let rec = state.hp.get(el);
    if (!rec) { const m = hpMax(el); rec = { hp: m, max: m, lastFxAt: 0, side: 1 }; state.hp.set(el, rec); }
    return rec;
  }
  function hpOfPublic(el) {
    if (!el || el.nodeType !== 1) return null;
    const rec = hpOf(el);
    return { hp: Math.max(0, rec.hp), max: rec.max };
  }
  function fillColor(ratio) { return ratio > 0.6 ? '#3fb950' : (ratio > 0.3 ? '#e3b341' : '#e5484d'); }
  function showTarget(el) {
    state.hoverEl = el || null;
    if (!el || !targetBox) { if (targetBox) targetBox.style.display = 'none'; return; }
    const r = rectOf(el);
    if (!r) { targetBox.style.display = 'none'; return; }
    targetBox.style.display = 'block';
    targetBox.style.left = px(r.left); targetBox.style.top = px(r.top);
    targetBox.style.width = px(r.width); targetBox.style.height = px(r.height);
    const rec = hpOf(el);
    const hp = Math.max(0, rec.hp), ratio = rec.max > 0 ? clamp(hp / rec.max, 0, 1) : 0;
    targetLabel.textContent = tagOf(el).toUpperCase() + ' ' + hp + '/' + rec.max;
    if (targetFill) { targetFill.style.width = (100 * ratio).toFixed(1) + '%'; targetFill.style.background = fillColor(ratio); }
  }
  /* Crit landed on the hovered element: the fill flashes white for 80 ms (A4). */
  function critFlashFill() {
    if (!targetFill || !targetBox || targetBox.style.display === 'none') return;
    try { trackAnim(targetFill.animate([{ backgroundColor: '#fff' }, { backgroundColor: targetFill.style.background || '#e5484d' }], { duration: 80 })); } catch (e) { /* ignore */ }
  }
  function refreshHover() {
    if (!state.active) return;
    if (state.overHud || state.hoverX < 0) { showTarget(null); return; }
    showTarget(pickTarget(state.hoverX, state.hoverY));
  }
  function scheduleHover() {
    if (state.moveRaf) return;
    state.moveRaf = raf(() => { state.moveRaf = 0; refreshHover(); });
  }
  function pulseTarget() {
    if (!targetBox || targetBox.style.display === 'none') return;
    try {
      trackAnim(targetBox.animate([{ backgroundColor: 'rgba(229,72,77,.35)' }, { backgroundColor: 'rgba(229,72,77,.06)' }], { duration: 200 }));
      trackAnim(targetLabel.animate([{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: 150, easing: 'ease-out' }));
    } catch (e) { /* ignore */ }
  }
