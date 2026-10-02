// ── v1.4 §3: enemies that REPAIR the page, and the destruction-ratio meter that makes it matter ──
  /* Until now breaking something was permanent, so combat had no objective: you could ignore every enemy and
   * still "win". Now each hostile periodically pulls one of your kills back — a cyan beam reaches from it to the
   * nearest broken element, and 1.5 s later the debris flies back into place and the element is whole again.
   * The destruction-ratio meter turns that into a number you are fighting over.
   *
   * Which pieces belong to the element being repaired is worked out geometrically, from where each piece SPAWNED
   * (`ox + cx`, `oy + cy`) against the element's box. A hidden element keeps its layout box, so that box is still
   * exactly the one the pieces came from, and no piece has to carry a back-reference. */

  function repairIntervalOf(rec) {
    const base = REPAIR_MS[rec && rec.tier] || REPAIR_MS.shooter;
    const k = depthRepairMul(rec);
    if (!k) return 0;                       // §10.2: `front` enemies attack, they do not repair
    return base * k * difficultyMul();
  }
  function scheduleRepair(rec) {
    untrack(rec.repairTimer); rec.repairTimer = 0;
    if (!modeHasRepair() || debug.noRepair) return;
    const ms = repairIntervalOf(rec);
    if (!(ms > 0)) return;
    rec.repairTimer = later(() => { rec.repairTimer = 0; tryRepair(rec, false); scheduleRepair(rec); }, ms);
  }
  function repairBusy(el) { for (const rp of state.repairs) if (rp.el === el) return true; return false; }
  /* Nearest broken original within 600 px of the enemy centre; nothing in range means this turn is skipped. */
  function repairCandidate(rec) {
    const r = rectOf(rec.el);
    if (!r) return null;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bestD = Infinity;
    /* A hammer that breaks a card often breaks a child first, so `state.broken` can hold both. Rebuilding the
      * inner one would leave the card still gone — the outermost broken element is the one worth putting back. */
    const nested = new Set();
    for (const a of state.broken) {
      for (const b of state.broken) {
        if (a === b || !a.el || !b.el) continue;
        try { if (a.el.contains(b.el)) nested.add(b.el); } catch (e) { /* ignore */ }
      }
    }
    for (const b of state.broken) {
      const el = b.el;
      if (!el || !el.isConnected || el === rec.el || repairBusy(el) || nested.has(el)) continue;
      const er = rectOf(el);
      if (!er || er.width < 1 || er.height < 1) continue;
      const d = Math.hypot(er.left + er.width / 2 - cx, er.top + er.height / 2 - cy);
      if (d <= REPAIR_RANGE && d < bestD) { bestD = d; best = el; }
    }
    return best;
  }
  function placeRepairBeam(rp) {
    const r = rectOf(rp.rec.el), er = rectOf(rp.el);
    if (!r || !er) return;
    const tx = er.left + er.width / 2, ty = er.top + er.height / 2;
    const from = { x: clamp(tx, r.left, r.right), y: clamp(ty, r.top, r.bottom) };
    const len = Math.hypot(tx - from.x, ty - from.y);
    const ang = Math.atan2(ty - from.y, tx - from.x);
    const s = rp.node.style;
    s.left = px(from.x); s.top = px(from.y); s.width = px(len); s.height = '3px';
    s.transform = 'translateY(-1.5px) rotate(' + ang.toFixed(4) + 'rad)';
    rp.x1 = from.x; rp.y1 = from.y; rp.x2 = tx; rp.y2 = ty;
    const g = rp.ghost.style;
    g.left = px(er.left); g.top = px(er.top); g.width = px(er.width); g.height = px(er.height);
  }
  function tryRepair(rec, forced) {
    if (!root || !state.active || !modeHasRepair() || state.paused) return null;
    if (!forced && debug.noRepair) return null;
    if (!rec || !rec.el || !rec.el.isConnected || state.hostiles.get(rec.el) !== rec) return null;
    const el = repairCandidate(rec);
    if (!el) return null;
    const node = mk('div', 'crs-repair');
    node.style.transformOrigin = '0 50%';
    const ghost = mk('div', 'crs-repair-ghost');
    root.append(node, ghost);
    const rp = { rec, el, node, ghost, startedAt: now(), dur: REPAIR_BEAM_MS, delays: 0, timer: 0, done: false, x1: 0, y1: 0, x2: 0, y2: 0 };
    state.repairs.push(rp);
    placeRepairBeam(rp);
    // §10.4: a back-rank enemy drops its blur while it works, so you can see who is undoing your kills
    try { rec.aura.classList.add('crs-repairing'); } catch (e) { /* ignore */ }
    try { trackAnim(node.animate([{ backgroundPosition: '0px 0px' }, { backgroundPosition: '20px 0px' }], { duration: 500, iterations: Infinity, easing: 'linear' })); } catch (e) { /* ignore */ }
    csfx('repair');
    armRepairTimer(rp);
    kick();
    return el;
  }
  function armRepairTimer(rp) {
    untrack(rp.timer);
    rp.timer = later(() => { rp.timer = 0; completeRepair(rp); }, Math.max(0, rp.startedAt + rp.dur - now()));
  }
  function removeRepair(rp) {
    const i = state.repairs.indexOf(rp);
    if (i >= 0) state.repairs.splice(i, 1);
    untrack(rp.timer); rp.timer = 0;
    try { if (rp.rec && rp.rec.aura && !state.repairs.some((o) => o.rec === rp.rec)) rp.rec.aura.classList.remove('crs-repairing'); } catch (e) { /* ignore */ }
    try { cancelAnimsOf(rp.node); rp.node.remove(); } catch (e) { /* ignore */ }
    try { cancelAnimsOf(rp.ghost); rp.ghost.remove(); } catch (e) { /* ignore */ }
  }
  function clearRepairs() { for (const rp of state.repairs.slice()) removeRepair(rp); }
  function dropRepairsOf(rec) { for (const rp of state.repairs.slice()) if (rp.rec === rec) removeRepair(rp); }
  /* §3.1: shooting the beam itself buys you 0.4 s, twice. It never absorbs the shot — the page is still hit. */
  function delayRepair(rp) {
    if (rp.done || rp.delays >= REPAIR_DELAY_MAX) return false;
    rp.delays++;
    rp.dur += REPAIR_DELAY_MS;
    armRepairTimer(rp);
    try { trackAnim(rp.node.animate([{ filter: 'brightness(2.4)' }, { filter: 'brightness(1)' }], { duration: 180, easing: 'ease-out' })); } catch (e) { /* ignore */ }
    sfx('clack');
    return true;
  }
  function hitRepairBeams(x, y, R) {
    let n = 0;
    for (const rp of state.repairs.slice()) {
      const q = nearestOnSegment(rp.x1, rp.y1, rp.x2, rp.y2, x, y);
      if (Math.hypot(q.x - x, q.y - y) <= R && delayRepair(rp)) n++;
    }
    return n;
  }
  function hitRepairBeamsWithin(x, y, R) { return hitRepairBeams(x, y, R); }
  function hitRepairBeamsAlong(x1, y1, x2, y2, R) {
    let n = 0;
    for (const rp of state.repairs.slice()) {
      const a = nearestOnSegment(x1, y1, x2, y2, rp.x1, rp.y1);
      const b = nearestOnSegment(x1, y1, x2, y2, rp.x2, rp.y2);
      const m = nearestOnSegment(x1, y1, x2, y2, (rp.x1 + rp.x2) / 2, (rp.y1 + rp.y2) / 2);
      const d = Math.min(Math.hypot(a.x - rp.x1, a.y - rp.y1), Math.hypot(b.x - rp.x2, b.y - rp.y2), Math.hypot(m.x - (rp.x1 + rp.x2) / 2, m.y - (rp.y1 + rp.y2) / 2));
      if (d <= R && delayRepair(rp)) n++;
    }
    return n;
  }
  function stepRepairs() { for (const rp of state.repairs) if (!rp.done) placeRepairBeam(rp); }

  /* ---- putting ONE element back (the existing restore(), narrowed to a single target) ---- */
  /* The piece flies back to where it spawned (translate 0 / rotate 0 in its own frame) over 600 ms and fades. */
  function flyPieceHome(p) {
    const node = p.node;
    try { node.classList.remove('crs-debris', 'crs-chip'); node.classList.add('crs-fading'); } catch (e) { /* ignore */ }
    const kill = () => { try { node.remove(); } catch (e) { /* ignore */ } };
    if (reducedMotion()) { kill(); return; }
    try {
      const a = trackAnim(node.animate([
        { transform: 'translate(' + p.x.toFixed(2) + 'px, ' + p.y.toFixed(2) + 'px) rotate(' + p.rot.toFixed(2) + 'deg)', opacity: 1 },
        { transform: 'translate(0px, 0px) rotate(0deg)', opacity: 0 }
      ], { duration: REPAIR_PIECE_MS, easing: 'ease-in-out', fill: 'forwards' }));
      a.addEventListener('finish', kill); a.addEventListener('cancel', kill);
    } catch (e) { kill(); return; }
    later(kill, REPAIR_PIECE_MS + 200);
  }
  /* §9.3: if the debris already expired there is nothing to fly back, so the element itself fades in instead. */
  function fadeInOriginal(el) {
    if (reducedMotion()) return;
    try { trackAnim(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: REPAIR_FADE_IN_MS, easing: 'ease-out' })); } catch (e) { /* ignore */ }
  }
  function piecesOf(el) {
    const r = rectOf(el);
    const out = [];
    if (!r || r.width < 1 || r.height < 1) return out;
    for (const p of state.pieces) {
      const sx = p.ox + p.cx, sy = p.oy + p.cy;
      if (sx >= r.left - 2 && sx <= r.right + 2 && sy >= r.top - 2 && sy <= r.bottom + 2) out.push(p);
    }
    return out;
  }
  function restoreOne(el) {
    let idx = -1;
    for (let i = 0; i < state.broken.length; i++) { if (state.broken[i].el === el) { idx = i; break; } }
    if (idx < 0) return false;
    const brec = state.broken[idx];
    state.broken.splice(idx, 1);
    try { if (brec.mo) brec.mo.disconnect(); } catch (e) { /* ignore */ }
    const mine = piecesOf(el);
    for (const p of mine) {
      const i = state.pieces.indexOf(p);
      if (i >= 0) state.pieces.splice(i, 1);
      state.gpuSum -= p.gpu;
      cancelAnimsOf(p.node);
      flyPieceHome(p);
    }
    for (const s of brec.saved) {
      try { if (s.value) s.node.style.setProperty(s.prop, s.value, s.priority); else s.node.style.removeProperty(s.prop); } catch (e) { /* ignore */ }
    }
    try { el.removeAttribute('data-crs-broken'); } catch (e) { /* ignore */ }
    const hrec = state.hp.get(el);
    if (hrec) hrec.hp = hrec.max;   // §3.1 item 4: it comes back whole
    if (!mine.length) fadeInOriginal(el);
    return true;
  }
  function completeRepair(rp) {
    if (rp.done) return;
    rp.done = true;
    const el = rp.el, rec = rp.rec;
    removeRepair(rp);
    // cancelled: the enemy died, was released, or the target is already whole again
    if (!el || !el.isConnected || !state.active) return;
    if (!rec || state.hostiles.get(rec.el) !== rec) return;
    let broken = false;
    try { broken = el.hasAttribute('data-crs-broken'); } catch (e) { broken = false; }
    if (!broken) return;
    if (!restoreOne(el)) return;
    state.repaired++;
    const max = (state.hp.get(el) || {}).max || hpMax(el);
    state.player.score -= Math.round(max / 2);
    csfx('repairDone');
    syncRatioMeter(true);
    updatePlayerHud(); scheduleHud(); refreshHover();
    kick();
  }

  /* ---- §3.2 destruction-ratio meter ---- */
  function destroyRatio() {
    const vw = viewW(), vh = viewH();
    let brokenArea = 0;
    for (const b of state.broken) {
      const el = b.el;
      if (!el || !el.isConnected) continue;
      const r = rectOf(el);
      if (!r || r.width < 1 || r.height < 1) continue;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
      brokenArea += r.width * r.height;
    }
    let liveArea = 0;
    const cands = walkCandidates(vw / 2, vh / 2, { limit: 0.7 * vw * vh, minArea: 1200, descendCollected: false });
    for (const c of cands) liveArea += c.area;
    const total = brokenArea + liveArea;
    return total > 0 ? clamp(brokenArea / total, 0, 1) : 0;
  }
  function updateRatioHud() {
    const n = state.ratioNodes;
    if (!n) return;
    const on = !!(state.active && modeHasRatio());
    try {
      n.box.classList.toggle('on', on);
      if (hudEls.fallback) n.box.style.display = on ? 'block' : 'none';
      if (!on) return;
      const pct = Math.round(state.ratio * 100);
      n.label.textContent = msg('labelRatio') + ' ' + pct + '%' + (state.ratio >= RATIO_DOMINATE ? ' · ' + msg('labelDominating') : '');
      n.fill.style.width = (state.ratio * 100).toFixed(1) + '%';
      n.fill.style.background = state.ratio >= RATIO_DOMINATE ? '#ffd166' : '#e5484d';
    } catch (e) { /* ignore */ }
  }
  /* `drop` animates the bar leftwards so a repair is impossible to miss (§3.2). */
  function syncRatioMeter(drop) {
    if (!modeHasRatio()) { clearRatioMeter(); return; }
    const before = state.ratio;
    state.ratio = destroyRatio();
    state.ratioDirty = false; state.ratioAt = now(); state.ratioBrokenN = state.broken.length;
    if (drop && state.ratioNodes && state.ratio < before - 0.002 && !reducedMotion()) {
      try { trackAnim(state.ratioNodes.fill.animate([{ width: (before * 100).toFixed(1) + '%' }, { width: (state.ratio * 100).toFixed(1) + '%' }], { duration: RATIO_DROP_MS, easing: 'ease-out' })); } catch (e) { /* ignore */ }
    }
    updateRatioHud();
    armRatioTick();
  }
  function ratioTick() {
    state.ratioTimer = 0;
    if (!state.active || !modeHasRatio()) return;
    state.ratio = destroyRatio();
    state.ratioDirty = false; state.ratioAt = now(); state.ratioBrokenN = state.broken.length;
    updateRatioHud();
    state.ratioTimer = later(ratioTick, RATIO_REFRESH_MS);
  }
  /* The HUD bar is happy on a 2 s clock (§3.2), but a reader of stats() asking right after a break must not get
   * the number from before it. Recompute on demand when something has changed since the last measurement. */
  /* Throttled, because stats() can be read many times a second and destroyRatio() walks the page. The one case
   * that must never be stale is the one every caller actually asks about — something was broken or put back —
   * so a change in the broken count always forces a fresh measurement, whatever the throttle says. */
  const RATIO_MIN_GAP = 250;
  function ratioNow() {
    if (!modeHasRatio()) return 0;
    const changed = state.broken.length !== state.ratioBrokenN;
    if (changed || (state.ratioDirty && now() - state.ratioAt >= RATIO_MIN_GAP) || now() - state.ratioAt > RATIO_REFRESH_MS) {
      state.ratio = destroyRatio();
      state.ratioDirty = false; state.ratioAt = now(); state.ratioBrokenN = state.broken.length;
    }
    return state.ratio;
  }
  function armRatioTick() {
    if (state.ratioTimer || !state.active || !modeHasRatio()) return;
    state.ratioTimer = later(ratioTick, RATIO_REFRESH_MS);
  }
  function clearRatioMeter() {
    untrack(state.ratioTimer); state.ratioTimer = 0;
    state.ratio = 0;
    updateRatioHud();
  }
  debug.noRepair = false;
  debug.forceRepair = (el) => {
    const rec = state.hostiles.get(el);
    if (!rec) return null;
    return tryRepair(rec, true);
  };
  debug.depthOf = (el) => depthOf(el);
