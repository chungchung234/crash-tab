// ── v1.4 §10: reading the page's own depth (stacking order) and turning it into combat roles ──
  /* A web page already HAS depth: z-index, stacking contexts, overlaps, sticky headers, modals. We never have to
   * invent it — `document.elementsFromPoint()` returns the whole stack at a point FRONT FIRST, so our element's
   * index in that list IS its depth. Measured only for hostile elements (five samples, median), so the cost is
   * five hit tests per hostile every two seconds.
   *
   * The roles that fall out of it (§10.2) are the point: the enemy that UNDOES your work sits at the back where
   * it is hard to reach, and the enemy that hurts you sits at the front where it dies fast. Clearing the front
   * is how you reach the back — no extra code, that is just what pickTarget already does. */

  function depthSamples(r) {
    return [
      { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 },
      { x: r.left + r.width * 0.25, y: r.top + r.height * 0.25 },
      { x: r.left + r.width * 0.75, y: r.top + r.height * 0.25 },
      { x: r.left + r.width * 0.25, y: r.top + r.height * 0.75 },
      { x: r.left + r.width * 0.75, y: r.top + r.height * 0.75 }
    ];
  }
  /* One sample: how many qualifying elements are painted in front of `el` at this point, or null when the sample
   * does not actually land on `el` (clipped away, scrolled out, covered by something that swallowed the hit). */
  function depthAt(el, x, y) {
    const vw = viewW(), vh = viewH();
    if (x < 0 || y < 0 || x > vw || y > vh) return null;
    let list;
    try { list = doc.elementsFromPoint(x, y); } catch (e) { return null; }
    if (!list || !list.length) return null;
    let n = 0;
    for (const c of list) {
      if (c === el) return n;
      if (!c || c.nodeType !== 1) continue;
      if (isOurs(c)) continue;                                    // our own glass-root nodes are not page depth
      try { if (c.contains(el) || el.contains(c)) continue; } catch (e) { continue; }   // ancestors and descendants
      const cr = rectOf(c);
      if (!cr || cr.width * cr.height < DEPTH_MIN_AREA) continue;   // decorative slivers are not cover
      n++;
    }
    return null;   // `el` was never reached: this sample missed it
  }
  function depthOf(el) {
    if (!el || el.nodeType !== 1 || !el.isConnected) return 0;
    const s = gcs(el);
    // a fixed / sticky element really is drawn on top of the flow it overlaps, whatever the hit test says
    if (s && (s.position === 'fixed' || s.position === 'sticky')) return 0;
    const r = rectOf(el);
    if (!r || r.width < 1 || r.height < 1) return 0;
    const vals = [];
    for (const p of depthSamples(r)) { const d = depthAt(el, p.x, p.y); if (d != null) vals.push(d); }
    if (!vals.length) return depthFromStacking(el, 0);   // scrolled out of view: elementsFromPoint cannot help
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];   // median, so one odd overlay cannot move a whole enemy to the back
  }
  /* Fallback when the element is not in the viewport (an API call about something scrolled away). Same question,
   * asked of the stacking rules instead of the hit test: at each level, how many overlapping siblings paint in
   * front of us — higher z-index, or equal z-index and later in the document — plus whatever is in front of our
   * parent. A child with no siblings of its own therefore inherits its parent's depth, which is right: it is
   * buried exactly as deep as the box it lives in. */
  function zOf(el) { const s = gcs(el); const z = s ? parseInt(s.zIndex, 10) : NaN; return isFinite(z) ? z : 0; }
  function frontSiblings(el) {
    const r = rectOf(el), parent = parentOf(el);
    if (!r || !parent) return 0;
    let kids = [];
    try { kids = Array.from(parent.children); } catch (e) { return 0; }
    const z = zOf(el);
    let n = 0;
    for (const c of kids) {
      if (c === el || !c || c.nodeType !== 1 || isOurs(c)) continue;
      try { if (c.contains(el) || el.contains(c)) continue; } catch (e) { continue; }
      const cr = rectOf(c);
      if (!cr || cr.width * cr.height < DEPTH_MIN_AREA) continue;
      if (cr.right <= r.left || cr.left >= r.right || cr.bottom <= r.top || cr.top >= r.bottom) continue;
      const cz = zOf(c);
      let later = false;
      try { later = !!(c.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING); } catch (e) { later = false; }
      if (cz > z || (cz === z && later)) n++;
    }
    return n;
  }
  function depthFromStacking(el, guard) {
    if (!el || el === doc.body || el === docEl || (guard || 0) > 8) return 0;
    const p = parentOf(el);
    return frontSiblings(el) + ((p && p !== doc.body && p !== docEl) ? depthFromStacking(p, (guard || 0) + 1) : 0);
  }
  function depthTier(d) { return d <= 0 ? 'front' : (d <= 2 ? 'mid' : 'back'); }
  function depthMark(tier) { return tier === 'front' ? '▲' : (tier === 'back' ? '▲▲▲' : '▲▲'); }

  /* The aura label is composed from parts, never appended to: the 🎯 of an aim line (§3.2) and the ▲ depth mark
   * both live in it and each is rewritten independently. */
  function setHostileLabel(rec) {
    if (!rec || !rec.label) return;
    try {
      rec.label.textContent = (rec.aim ? '🎯 ' : '') + '👿 ' + tagOf(rec.el).toUpperCase() + ' ' + depthMark(rec.dtier || 'mid');
    } catch (e) { /* ignore */ }
  }
  /* back enemies read as "further away": blurred, desaturated, dashed. While one is actually repairing (§10.4)
   * the blur comes OFF and the aura brightens — the enemy undoing your work has to be visible to be worth the trip. */
  function applyDepthLook(rec) {
    if (!rec || !rec.aura) return;
    try {
      rec.aura.classList.toggle('crs-depth-front', rec.dtier === 'front');
      rec.aura.classList.toggle('crs-depth-back', rec.dtier === 'back');
    } catch (e) { /* ignore */ }
    setHostileLabel(rec);
  }
  function measureDepth(rec) {
    if (!rec || !rec.el) return;
    rec.depth = depthOf(rec.el);
    const t = depthTier(rec.depth);
    if (t !== rec.dtier) { rec.dtier = t; applyDepthLook(rec); }
    rec.depthAt = now();
  }
  /* §10.1 item 6: once on selection, then every two seconds for every live hostile. One later() chain, never a
   * setInterval, so clearTimers() takes it with everything else. */
  function depthTick() {
    state.depthTimer = 0;
    if (!state.active || !modeHasEnemies() || state.paused) return;
    for (const rec of state.hostiles.values()) measureDepth(rec);
    state.depthTimer = later(depthTick, DEPTH_REFRESH_MS);
  }
  function armDepthTick() {
    if (state.depthTimer || !state.active || !modeHasEnemies()) return;
    state.depthTimer = later(depthTick, DEPTH_REFRESH_MS);
  }
  function hostilesByTier() {
    const out = { front: 0, mid: 0, back: 0 };
    for (const rec of state.hostiles.values()) out[rec.dtier || 'mid']++;
    return out;
  }
  /* §10.2 role multipliers. A zero means "this tier never does that at all". */
  function depthAttackMul(rec) { const k = DEPTH_ATTACK[(rec && rec.dtier) || 'mid']; return k == null ? 1 : k; }
  function depthRepairMul(rec) { const k = DEPTH_REPAIR[(rec && rec.dtier) || 'mid']; return k == null ? 1 : k; }
  function depthHpMul(tier) { const k = DEPTH_HP[tier || 'mid']; return k == null ? 1 : k; }
  /* Applied once, when the element becomes hostile: hpOf() may already have cached a plain max from a hover. */
  function applyDepthHp(el, tier) {
    const rec = state.hp.get(el);
    if (!rec || rec.depthScaled === tier) return;
    const base = rec.baseMax != null ? rec.baseMax : (rec.baseMax = rec.max);
    const ratio = rec.max > 0 ? clamp(rec.hp / rec.max, 0, 1) : 1;
    rec.max = clamp(Math.round(base * depthHpMul(tier)), 10, 400);
    rec.hp = Math.max(1, Math.round(rec.max * ratio));
    rec.depthScaled = tier;
  }

  /* §10.4: is this enemy actually shootable right now, or is something painted over it? The honest test is the
   * one the player's click will run — pickTarget at the enemy centre. */
  function isCovered(el) {
    const r = rectOf(el);
    if (!r || r.width < 1 || r.height < 1) return false;
    const picked = pickTarget(r.left + r.width / 2, r.top + r.height / 2, null, { noLock: true });
    if (!picked) return true;
    if (picked === el) return false;
    try { return !el.contains(picked); } catch (e) { return true; }
  }
  /* §10.3 item 2. The table entry is read defensively so this works whether or not the weapon stats carry
   * `pierce` yet — the sniper is the one hitscan weapon the spec gives a value to. */
  function pierceOf(id) {
    const W = WEAPONS[id];
    if (W && typeof W.pierce === 'number') return W.pierce;
    return id === 'sniper' ? 2 : 0;
  }
  function canPierceNow() { return pierceOf(state.weapon) > 0; }
  /* ── §10.3 item 2: PIERCE — the arming half ─────────────────────────────────────────────────────────
   * A hitscan weapon with `pierce` keeps going after its front target, hitting the next qualifying elements
   * down the same stack at ×0.6 per layer. This module arms it; src/73-hit-resolution.js applies it.
   *
   * MERGED (v1.4 + v1.5): this module used to carry its OWN applyPierce()/pierceMark() pair next to the v1.5
   * ones in src/73-hit-resolution.js. Every src/ fragment shares one closure and 87 is concatenated after 73,
   * so this module's pair won every call — including the two v1.5 fire() call sites, which pass
   * (x, y, front, kind, id) and were therefore handing a layer count of 'gun' and a base damage of 'sniper'
   * to a (x, y, front, n, base) signature: Math.round('sniper' * 0.6) is NaN, so every layer behind a pistol
   * or sniper shot had its hp set to NaN instead of taking 60 %. Both copies here are gone — the hit-resolution
   * module owns the single applyPierce() and pierceMark() (SPEC-weapons §3 files 타격 판정 there) and this is
   * its ONE caller, which is why the v1.5 fire() entries no longer call applyPierce() directly: two live entry
   * points would pierce the same stack twice.
   *
   * It still hangs off interceptOrb() (src/90-combat.js), which every click weapon already calls with the exact
   * impact point BEFORE the page is hit — so the primary hit stays entirely in the weapon code and the only
   * thing living here is what happens behind it. Deferred by one task so the front target has already resolved
   * (and possibly broken) before we look at what is behind it — §10.3 item 2's "최전면 대상을 처리한 뒤".
   * `noLock` asks for the raw "what is really under this point?": the §2.2 lock-frame aim assist can send the
   * PRIMARY hit to an enemy nowhere near (x, y), but the stack the bullet went through is still the one at
   * (x, y) — isCovered() above reads the point the same way.
   * §10.3 item 3 (aoeIgnoresCover) needs no code here: aoeCandidates() samples rings of POINTS, so a blast
   * already reaches whatever is inside its radius no matter how many layers are painted over it. */
  function schedulePierce(x, y) {
    if (!state.active || !(pierceOf(state.weapon) > 0)) return;
    const id = state.weapon, W = WEAPONS[id];
    if (!W || !(W.damage > 0) || !isFinite(W.damage)) return;
    const front = pickTarget(x, y, null, { noLock: true });
    later(() => applyPierce(x, y, front, W.kind, id), 0);
  }
  /* ── §10.3 item 3: explosions ignore cover ──
   * aoeCandidates() samples rings of POINTS and keeps only what pickTarget() returns at each — the topmost
   * element. That makes a blast respect cover, which is the opposite of what §10.3 promises. This pass walks the
   * SAME points and picks up what is behind the front element at each one, so a rocket reaches the back rank
   * whatever is painted over it. Deferred one task, so the ordinary blast has already resolved and this only
   * adds the layers it could not see; `aoeIgnoresCover` is the flag that documents it.
   * Nothing is double-hit: anything pickTarget() would have returned is skipped, as is its own subtree. */
  const aoeIgnoresCover = true;
  function scheduleBlastThroughCover(x, y, R) {
    const W = WEAPONS[state.weapon];
    if (!aoeIgnoresCover || !W || W.kind !== 'bomb' || !(W.damage > 0) || !isFinite(W.damage)) return;
    later(() => blastThroughCover(x, y, R, W.damage, W.maxTargets || 10), 0);
  }
  function blastThroughCover(x, y, R, damage, maxTargets) {
    if (!state.active || !(R > 0)) return;
    const points = [{ x, y }];
    for (const k of [0.35, 0.7, 1]) {
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; points.push({ x: x + Math.cos(a) * k * R, y: y + Math.sin(a) * k * R }); }
    }
    const cache = new Map(), seen = new Set();
    const vw = viewW(), vh = viewH();
    let hits = 0;
    for (const p of points) {
      if (hits >= maxTargets) break;
      if (p.x < 0 || p.y < 0 || p.x > vw || p.y > vh) continue;
      const front = pickTarget(p.x, p.y, cache, { noLock: true });
      let list = [];
      try { list = doc.elementsFromPoint(p.x, p.y); } catch (e) { continue; }
      for (const c of list) {
        if (hits >= maxTargets) break;
        if (!c || c.nodeType !== 1 || isOurs(c) || c === doc.body || c === docEl) continue;
        if (c === front || seen.has(c) || SKIP_WALK_TAGS.has(tagOf(c))) continue;
        try { if (front && (c.contains(front) || front.contains(c))) continue; } catch (e) { continue; }
        try { if (c.hasAttribute('data-crs-broken')) continue; } catch (e) { continue; }
        const cr = rectOf(c);
        if (!cr || cr.width * cr.height < DEPTH_MIN_AREA) continue;
        const d = edgeDist(cr, x, y);
        if (d > R) continue;
        seen.add(c);
        hits++;
        applyHit(c, Math.max(1, Math.round(damage * (1 - 0.73 * clamp(d / R, 0, 1)))), 'bomb', x, y, { aoe: true, radius: R, toward: { x, y } });
      }
    }
  }
  /* (The thin white pierce streak lives with applyPierce() in src/73-hit-resolution.js — see the merge note
   * on schedulePierce() above. Its prefers-reduced-motion guard came from the copy that stood here.) */
  /* §10.4: "뒤에 적 N" on the target box — the thing under your cursor is cover, and this says how much. */
  function hostilesBehind(el) {
    if (!el || !state.hostiles.size) return 0;
    const r = rectOf(el);
    if (!r) return 0;
    let n = 0;
    for (const rec of state.hostiles.values()) {
      const h = rec.el;
      if (h === el) continue;
      try { if (h.contains(el) || el.contains(h)) continue; } catch (e) { continue; }
      const hr = rectOf(h);
      if (!hr || hr.right <= r.left || hr.left >= r.right || hr.bottom <= r.top || hr.top >= r.bottom) continue;
      if ((rec.depth || 0) > 0 || isCovered(h)) n++;
    }
    return n;
  }
