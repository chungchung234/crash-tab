  /* ===================================================================== */
  /* 3a. Damage decals (SPEC-material §1–§3)                                 */
  /*     A damage mark belongs to the ELEMENT that was hit, not to the        */
  /*     screen. Each marked element owns a decal canvas sized to its own      */
  /*     rect, positioned over it, clipped to it and moved with it — so a      */
  /*     mark scrolls, resizes and dies with the thing it was made on. The     */
  /*     viewport-fixed sheet of glass (.crs-canvas) is gone (§9.1).           */
  /* ===================================================================== */
  /* SPEC-material §3: 40 live decal canvases, 12 in performance mode. Least-recently-damaged is
     retired first (a 200 ms fade), so the one you are actively hitting is never the one evicted. */
  const DECAL_CAP = 40;
  const DECAL_CAP_PERF = 12;
  function decalCap() { return safe(() => state.perf && state.perf.mode === 'performance') ? DECAL_CAP_PERF : DECAL_CAP; }
  const DECAL_MAX_PX = 4096;       // device-pixel clamp per axis (same ceiling the old sheet used)
  const DECAL_HOLD_MS = 600;       // keep the frame loop syncing decals this long after a fresh mark
  const decals = new Map();        // el -> rec; Map iteration order is insertion order, oldest first
  let decalRaf = 0;
  let decalHold = 0;               // the hit element wobbles (reactDamage, 260 ms) — ride it out, see decalBusy()

  function decalDpr() { return Math.min(win.devicePixelRatio || 1, 2); }

  /* The element a mark at (x, y) belongs to. pickTarget() is the SAME walk-up the weapons use to decide what
   * they damaged, so a mark always lands on exactly the element that took the hit. It returns null over the
   * page background, over a broken element and over a viewport-sized container — precisely the three places a
   * mark must never be painted (§8: the background is not a material). */
  function decalTargetAt(x, y) {
    try { return pickTarget(x, y, null, { noLock: true }); } catch (e) { return null; }
  }
  function decalUsable(el) {
    if (!el || el.nodeType !== 1 || !el.isConnected) return false;
    if (isOurs(el)) return false;
    try { if (el.hasAttribute('data-crs-broken')) return false; } catch (e) { return false; }
    const r = rectOf(el);
    return !!(r && r.width >= 1 && r.height >= 1);
  }
  /* The box a decal covers. getBoundingClientRect() is the visual box, which is what a mark must sit on —
   * but a hit makes the element itself wobble for 260 ms (reactDamage) and the page shake on top of that, so
   * a rect read inside that window is a fraction of a pixel wider and taller than the element really is.
   * Baking that into the bitmap would leave the mark permanently mis-sized, so the UNTRANSFORMED layout box
   * wins whenever the two agree to within a pixel; a genuinely transformed element keeps its visual rect. */
  function decalBox(el) {
    const r = rectOf(el);
    if (!r || r.width < 1 || r.height < 1) return null;
    let w = r.width, h = r.height, ow = 0, oh = 0;
    try { ow = el.offsetWidth || 0; oh = el.offsetHeight || 0; } catch (e) { ow = oh = 0; }
    if (ow > 0 && oh > 0 && Math.abs(ow - w) <= 1.5 && Math.abs(oh - h) <= 1.5) { w = ow; h = oh; }
    return { left: r.left, top: r.top, width: w, height: h };
  }
  function destroyDecal(rec) {
    if (!rec) return;
    try { rec.node.remove(); } catch (e) { /* ignore */ }
    decals.delete(rec.el);
  }
  /* A broken element takes its damage with it (SPEC-destruction.md §1): the pieces carry the look now. */
  function dropDecal(el) { const rec = el && decals.get(el); if (rec) destroyDecal(rec); }
  function clearDecals() {
    if (decalRaf) { try { caf(decalRaf); } catch (e) { /* ignore */ } decalRaf = 0; }
    decalHold = 0;
    for (const rec of Array.from(decals.values())) destroyDecal(rec);
    decals.clear();
  }
  function decalCount() { return decals.size; }
  /* True while a freshly marked element may still be moving under its own hit reaction. tickFrame() reads
   * this to keep the loop awake for exactly that window, so the mark rides the wobble and then settles
   * pixel-exact on the element — instead of freezing wherever the element happened to be mid-animation. */
  function decalBusy() { return decals.size > 0 && now() < decalHold; }

  /* Re-size the bitmap to the element's current rect, keeping the marks already on it at the same LOCAL
   * position (copied back unscaled from the top-left, which is where they were drawn from). */
  function resizeDecal(rec, r) {
    const dpr = decalDpr();
    const bw = clamp(Math.round(r.width * dpr), 1, DECAL_MAX_PX);
    const bh = clamp(Math.round(r.height * dpr), 1, DECAL_MAX_PX);
    let tmp = null;
    try {
      if (rec.node.width > 0 && rec.node.height > 0) {
        tmp = doc.createElement('canvas');
        tmp.width = rec.node.width; tmp.height = rec.node.height;
        tmp.getContext('2d').drawImage(rec.node, 0, 0);
      }
    } catch (e) { tmp = null; }
    rec.node.width = bw; rec.node.height = bh;
    rec.node.style.width = px(r.width);
    rec.node.style.height = px(r.height);
    rec.cssW = r.width; rec.cssH = r.height;
    rec.sx = bw / Math.max(1, r.width); rec.sy = bh / Math.max(1, r.height);
    try { rec.ctx = rec.node.getContext('2d'); } catch (e) { rec.ctx = null; }
    if (tmp && rec.ctx) {
      try { rec.ctx.setTransform(1, 0, 0, 1, 0, 0); rec.ctx.drawImage(tmp, 0, 0); } catch (e) { /* ignore */ }
    }
    if (rec.ctx) { try { rec.ctx.setTransform(rec.sx, 0, 0, rec.sy, 0, 0); } catch (e) { /* ignore */ } }
  }
  /* Put the decal back over its element. Returns false when the element no longer has a usable box. */
  function placeDecal(rec) {
    const r = decalBox(rec.el);
    if (!r) return false;
    if (rec.left !== r.left || rec.top !== r.top) {
      rec.left = r.left; rec.top = r.top;
      rec.node.style.left = px(r.left);
      rec.node.style.top = px(r.top);
    }
    if (Math.abs(rec.cssW - r.width) > 0.5 || Math.abs(rec.cssH - r.height) > 0.5) resizeDecal(rec, r);
    return !!rec.ctx;
  }
  function ensureDecal(el) {
    if (!root || !decalUsable(el)) return null;
    decalHold = now() + DECAL_HOLD_MS;
    let rec = decals.get(el);
    if (rec) {
      if (rec.node.isConnected) return placeDecal(rec) ? rec : null;
      decals.delete(el);
    }
    const r = decalBox(el);
    if (!r) return null;
    let node;
    try { node = mk('canvas', 'crs-decal'); } catch (e) { return null; }
    rec = { el, node, ctx: null, cssW: 0, cssH: 0, sx: 1, sy: 1, left: r.left, top: r.top };
    node.style.left = px(r.left);
    node.style.top = px(r.top);
    resizeDecal(rec, r);
    if (!rec.ctx) { try { node.remove(); } catch (e) { /* ignore */ } return null; }
    try { root.append(node); } catch (e) { return null; }
    decals.set(el, rec);
    while (decals.size > decalCap()) {
      const oldest = decals.keys().next().value;
      if (oldest === el) break;
      destroyDecal(decals.get(oldest));
    }
    return rec;
  }
  /* Every marked element re-reads its own rect: this is what makes a mark follow a scroll, a reflow, a
   * resize or an element that moves on its own. Elements that are gone or broken drop their decal here. */
  function syncDecals() {
    if (!decals.size) return;
    for (const rec of Array.from(decals.values())) {
      if (!decalUsable(rec.el) || !rec.node.isConnected) { destroyDecal(rec); continue; }
      if (!placeDecal(rec)) destroyDecal(rec);
    }
  }
  function scheduleDecalSync() {
    if (decalRaf || !state.active || !decals.size) return;
    decalRaf = raf(() => {
      decalRaf = 0;
      if (state.active) { try { syncDecals(); } catch (e) { state.lastError = String((e && e.stack) || e); } }
    });
  }
  const DECAL_MAX_TARGETS = 12;
  debug.decals = () => Array.from(decals.values()).map((rec) => {
    const r = rectOf(rec.el) || { left: 0, top: 0, width: 0, height: 0 };
    return {
      tag: tagOf(rec.el).toUpperCase(), id: rec.el.id || null,
      left: Math.round(rec.left), top: Math.round(rec.top),
      w: Math.round(rec.cssW), h: Math.round(rec.cssH),
      elLeft: Math.round(r.left), elTop: Math.round(r.top)
    };
  });
