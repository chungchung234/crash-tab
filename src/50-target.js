  /* ===================================================================== */
  /* 7. Target picking + hover highlight                                    */
  /*    v1.3 §3.1: scheduleHover()'s frame also carries the player ring      */
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
  /* opts.noLock (v1.4): skip the lock-frame aim assist below. isCovered() asks that, because it needs the raw
   * answer "what would a click here really hit?" — with the assist on, a locked enemy would always look clear.
   * SPEC-combat §D1 rides on the SAME flag (see pickTarget() below): a caller that wants the raw page answer
   * wants it whole, enemy-only focusing included. */
  function pickPhysical(x, y, cache, opts) {
    const env = { vw: viewW(), vh: viewH(), op: cache || new Map() };
    /* v1.4 §2.2 aim assist: a click inside a closing lock frame is a click on THAT enemy, not on a child of it.
     * Only for a frame actually drawn ON the enemy (lk.onEnemy) — otherwise the frame rides the PLAYER and then
     * freezes wherever they were, so the same rule would teleport damage to an enemy they never aimed at.
     * SPEC-combat §A2 anchors EVERY frame on the player, so lk.onEnemy is now always false and this branch is
     * unreachable; it is left standing because §D is still to redo targeting on top of it. */
    if (!(opts && opts.noLock) && state.locks.length) {
      const lk = lockAt(x, y);
      if (lk && lk.onEnemy && lk.rec && lk.rec.el && lk.rec.el.isConnected) {
        try { if (!lk.rec.el.hasAttribute('data-crs-broken')) return lk.rec.el; } catch (e) { /* ignore */ }
      }
    }
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

  /* ── SPEC-combat §D1: 적만 포커싱 ────────────────────────────────────────────────────────
   * 사용자: "전투 모드일 땐 적만 포커싱 가능하게 해줘 정신 없어". The box that followed the mouse across
   * every paragraph and button of the page was the direct cause — in a combat mode nothing but an enemy
   * can be damaged (§B), so nothing but an enemy should be bracketed either. This is the AIM-side twin of
   * §B's damageable(): the two gates answer the same question (is this thing part of the fight?) and are
   * turned off by the same named escape hatch, debug.noInvuln. A suite that is allowed to wear down
   * ordinary page elements while enemies are live must also be allowed to AIM at them, or it could never
   * build its own precondition.
   *
   * 조준 보정 (§D1): with the cursor off every enemy, an enemy rect within 40 px (arcade 60 px — one hand
   * is aiming AND dodging there) becomes the target. The bracket appears on THAT enemy, which is what makes
   * the correction visible rather than magic.
   *
   * AMBIGUITY, reading chosen — §D1 says "pickTarget 은 적대 요소 또는 null 만 돌려준다", and §B/§F say a
   * shot on a non-hostile element still deflects (`.crs-deflect` + `무적`, 탄약 1발). Both cannot hold for
   * ONE return value: a null hands the weapon nothing to deflect off. Read as two questions asked of one
   * function:
   *   opts.focus  — "what may the player aim at?"  → §D1: the hostile, or null. refreshHover() and
   *                 debug.pickAt() ask this, and it is what the bracket, the health bar and the §B1 aim
   *                 point are driven by. This is the sentence §D1 is actually about.
   *   (default)   — "what did this shot land on?"  → the assisted hostile when there is one, otherwise the
   *                 element really under the point, so §B's deflect still has something to bounce off.
   * The player-visible rules of §D1 are all on the focus side; keeping the impact side physical changes
   * nothing a player sees and leaves §B intact.
   * opts.noLock callers (decals, isCovered(), schedulePierce(), blastThroughCover()) opt out of both: they
   * are asking about the PAGE, not about the fight. */
  const AIM_ASSIST_PX = 40;          // survival — mouse aims, WASD dodges
  const AIM_ASSIST_PX_ARCADE = 60;   // arcade — the cursor is the character, so the window is wider
  function aimAssistPx() { return state.mode === 'arcade' ? AIM_ASSIST_PX_ARCADE : AIM_ASSIST_PX; }
  /* The §D1 rule is live exactly where §B's invulnerability is, and dies with it. */
  function enemyFocusOn() { return modeHasEnemies() && !debug.noInvuln; }
  /* Nearest live hostile whose rect is within `maxPx` of (x, y), measured edge-to-edge (0 inside the rect). */
  function nearestHostileWithin(x, y, maxPx) {
    if (!(maxPx > 0) || !state.hostiles.size) return null;
    let best = null, bestD = Infinity;
    for (const rec of state.hostiles.values()) {
      const el = rec && rec.el;
      if (!el || el.nodeType !== 1 || !el.isConnected) continue;
      try { if (el.hasAttribute('data-crs-broken')) continue; } catch (e) { continue; }
      const r = rectOf(el);
      if (!r || r.width <= 0 || r.height <= 0) continue;
      const d = edgeDist(r, x, y);
      if (d <= maxPx && d < bestD) { bestD = d; best = el; }
    }
    return best;
  }
  function pickTarget(x, y, cache, opts) {
    const raw = pickPhysical(x, y, cache, opts);
    if ((opts && opts.noLock) || !enemyFocusOn()) return raw;   // rampage / raw page query / §B escape hatch
    if (raw && hostileUnit(raw)) return raw;
    const near = nearestHostileWithin(x, y, aimAssistPx());     // §D1 조준 보정
    if (near) return near;
    return (opts && opts.focus) ? null : raw;                   // §D1 focus answer vs. §B impact answer
  }
  /* Size-based OWN max HP (v1.1 A1 / SPEC-combat §C2 `ownHp`): base = 20 + 0.35·sqrt(area); media ×1.2,
   * controls ×1, text-ish ×0.6 capped at 60 (a hammer always one-shots text), containers ×1; clamp [10, 400].
   * This is the element's own shell only — what it is worth with everything inside it already gone. */
  function ownHp(el) {
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

  /* ── SPEC-combat §C: a container is worth what it HOLDS ──────────────────────
   *   maxHp(el) = clamp(ownHp(el) + 0.6 × Σ maxHp(destructible direct descendants), 10, 2500)
   * §C1: without this, a section holding 20 cards (317) is cheaper than two of those cards (184 each), so
   * hitting the biggest thing in sight is always the right move and nothing smaller is ever worth a swing.
   * The 0.6 keeps the shell slightly cheaper than its contents (§C2: 1.0 removes the choice, 0.3 restores
   * the hole). Computed ONCE, on first contact, and cached in state.hp by hpOf() — the DOM may change
   * afterwards and the number does not (§C4). */
  const HP_AGG_MUL = 0.6;
  const HP_AGG_MIN_AREA = 2000;    // §C2: a descendant under 2000 px² is not counted at all
  const HP_AGG_CAP = 2500;         // §C2: past this, emptying the container IS the intended answer
  const HP_WALK_NODES = 200, HP_WALK_DEPTH = 12;         // §C4 traversal budget
  const HP_WALK_NODES_PERF = 100, HP_WALK_DEPTH_PERF = 8;   // §C4 in performance mode
  /* §C4: REAL computations only — a cache hit never touches it. Read through stats().hpCalcs; reset with the
   * WeakMap it counts for, in restore() (src/99-api.js). */
  let hpCalcs = 0;

  /* walkCandidates()'s eligibility rules (src/76-weapon-fire.js), with ONE deliberate omission: the
   * viewport-intersection test. An aggregate is computed once and never recomputed (§C4), so letting the
   * scroll position decide which children count would freeze a different number into the cache depending on
   * where the page happened to be when the player first touched the element.
   * 0 = not a descendant at all · 1 = no box of its own, look through it (walkCandidates' descend())
   * · 2 = a real box, judge it by area. */
  function hpQualify(el) {
    if (!el || el.nodeType !== 1) return 0;
    if (SKIP_WALK_TAGS.has(tagOf(el)) || isOurs(el)) return 0;
    try { if (el.hasAttribute('data-crs-broken')) return 0; } catch (e) { return 0; }
    const s = gcs(el);
    if (!s || s.display === 'none' || parseFloat(s.opacity) < 0.05) return 0;
    const r = rectOf(el);
    if (!r) return 0;
    if (r.width < 1 || r.height < 1 || s.display === 'contents' || s.visibility === 'hidden') return 1;
    return 2;
  }
  function hpChildren(el) {
    const out = [];
    try { if (el.shadowRoot) for (const c of el.shadowRoot.children) out.push(c); } catch (e) { /* ignore */ }
    try { for (const c of el.children) out.push(c); } catch (e) { /* ignore */ }
    return out;
  }
  /* Σ maxHp of el's destructible direct descendants. `st` is the §C4 budget: `left` nodes and `depth` levels,
   * and `over` once either runs out — an overrun is reported all the way up, never silently truncated. */
  function hpSumBelow(el, st, depth) {
    const kids = hpChildren(el);
    if (!kids.length) return 0;
    if (depth >= st.depth) { st.over = true; return 0; }
    const m = scopeMag();
    let sum = 0;
    for (const c of kids) {
      if (st.over) break;
      if (--st.left < 0) { st.over = true; break; }
      const q = hpQualify(c);
      if (q === 0) continue;
      if (q === 1) { sum += hpSumBelow(c, st, depth + 1); continue; }   // a wrapper with no box: its children are el's
      const r = rectOf(c);
      if ((r.width / m) * (r.height / m) < HP_AGG_MIN_AREA) continue;   // §C2
      /* A descendant that has been contacted already carries the live number — including whatever IT has
       * lost to §C3 — so the two views of the same subtree can never disagree. */
      const cached = state.hp.get(c);
      sum += cached ? cached.max : clamp(Math.round(ownHp(c) + HP_AGG_MUL * hpSumBelow(c, st, depth + 1)), 10, HP_AGG_CAP);
    }
    return sum;
  }
  /* The §C2 formula. Integer, so every downstream `hp === max − damage` stays exact. */
  function hpCompute(el) {
    hpCalcs++;
    const own = ownHp(el);
    const perf = perfOn();
    const st = { left: perf ? HP_WALK_NODES_PERF : HP_WALK_NODES, depth: perf ? HP_WALK_DEPTH_PERF : HP_WALK_DEPTH, over: false };
    const sum = hpSumBelow(el, st, 0);
    // §C4: too big to walk honestly → ownHp × 3 and say so, rather than a number nobody can trust
    if (st.over) return { own, max: clamp(own * 3, 10, HP_AGG_CAP), approx: true };
    return { own, max: clamp(Math.round(own + HP_AGG_MUL * sum), 10, HP_AGG_CAP), approx: false };
  }
  function hpMax(el) { return hpCompute(el).max; }
  function hpOf(el) {
    let rec = state.hp.get(el);
    if (!rec) {
      const c = hpCompute(el);
      rec = { hp: c.max, max: c.max, own: c.own, approx: c.approx, aggLost: 0, lastFxAt: 0, side: 1 };
      state.hp.set(el, rec);
    }
    return rec;
  }
  /* §C3: `el` just broke — every ancestor that has a cached record loses 0.6 × el's max from BOTH max and hp,
   * so emptying a container leaves nothing but its own shell, and an ancestor already hurt enough goes down
   * with it. The amount taken is remembered on el's own record, so repair (src/94-repair.js) gives back
   * exactly what was taken even if el's max changes meanwhile. */
  function hpDescendantBroken(el, ix, iy, mode) {
    const rec = state.hp.get(el);
    if (!rec) return;
    const d = Math.round(HP_AGG_MUL * rec.max);
    rec.aggLost = d;
    if (d <= 0) return;
    const fell = [];
    let p = parentOf(el);
    for (let guard = 0; p && p.nodeType === 1 && p !== docEl && guard < 40; guard++, p = parentOf(p)) {
      const a = state.hp.get(p);
      if (!a) continue;   // never contacted: when it IS, it walks a tree el has already left
      a.max = Math.max(a.own != null ? a.own : 10, a.max - d);
      a.hp -= d;
      if (a.hp <= 0) fell.push(p);
    }
    // nearest first: breaking it takes its own share off everything above, which those then see
    for (const anc of fell) {
      try { if (anc.isConnected && !anc.hasAttribute('data-crs-broken')) breakElement(anc, ix, iy, { mode: mode || 'collapse' }); } catch (e) { /* ignore */ }
    }
  }
  /* §C3: …and repair puts it back. */
  function hpDescendantRestored(el) {
    const rec = state.hp.get(el);
    const d = rec ? (rec.aggLost || 0) : 0;
    if (d <= 0) return;
    rec.aggLost = 0;
    let p = parentOf(el);
    for (let guard = 0; p && p.nodeType === 1 && p !== docEl && guard < 40; guard++, p = parentOf(p)) {
      const a = state.hp.get(p);
      if (!a) continue;
      a.max = Math.min(HP_AGG_CAP, a.max + d);
      a.hp = Math.min(a.max, a.hp + d);
    }
  }
  function hpOfPublic(el) {
    if (!el || el.nodeType !== 1) return null;
    const rec = hpOf(el);
    // v1.4 §10.5: depth comes from the live hostile record when there is one, else it is measured on the spot
    const h = state.hostiles.get(el);
    const depth = h ? h.depth : depthOf(el);
    // SPEC-combat §C: `own` is the shell alone and `approx` says the §C4 budget ran out and max is ownHp × 3
    return { hp: Math.max(0, rec.hp), max: rec.max, own: rec.own != null ? rec.own : rec.max, approx: !!rec.approx, depth, tier: h ? h.dtier : depthTier(depth) };
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
    // v1.4 §10.4: when the thing under the cursor is COVER, say how much is hiding behind it
    const behind = modeHasEnemies() ? hostilesBehind(el) : 0;
    /* SPEC-combat §C4: an approximated max wears a `~`. The bar itself carries no text (its LENGTH is the
     * readout the §4 crosshair work will give it), so the tilde goes on the end of the number above it —
     * the one place the max is actually spelled out today. */
    targetLabel.textContent = tagOf(el).toUpperCase() + ' ' + hp + '/' + rec.max + (rec.approx ? '~' : '') + (behind ? ' · ' + msg('hintEnemyBehind') + ' ' + behind : '');
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
    // SPEC-combat §D1: the hover bracket is the FOCUS answer — an enemy, or nothing at all
    showTarget(pickTarget(state.hoverX, state.hoverY, null, { focus: true }));
  }
  function scheduleHover() {
    if (state.moveRaf) return;
    // v1.3 §3.1: the player ring is repositioned on the frame the pointer move already schedules
    // v1.4: and the drone's nose, which tracks the crosshair even while the drone itself is parked
    state.moveRaf = raf(() => { state.moveRaf = 0; refreshHover(); if (state.self) selfStep(); if (state.avatar) placeAvatar(); });
  }
  function pulseTarget() {
    if (!targetBox || targetBox.style.display === 'none') return;
    try {
      trackAnim(targetBox.animate([{ backgroundColor: 'rgba(229,72,77,.35)' }, { backgroundColor: 'rgba(229,72,77,.06)' }], { duration: 200 }));
      trackAnim(targetLabel.animate([{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: 150, easing: 'ease-out' }));
    } catch (e) { /* ignore */ }
  }

  /* ── v1.4: what would a click at this point actually hit? ──
   * pickTarget() is where the hostile-unit rule (§5), the §2.2 lock aim assist and the §10 depth/occlusion
   * rules all land, so "the shot went nowhere" has several possible causes that look identical from outside.
   * This reports the resolved element without firing anything, so a failing assertion can say which rule ran.
   * SPEC-combat §D1: it reports the FOCUS answer — the one the bracket and the health bar are drawn from, and
   * the one §D1's "적대 요소 또는 null" is about. debug.aimAssist() below says how wide the correction is. */
  debug.pickAt = (x, y) => {
    const el = pickTarget(+x, +y, null, { focus: true });
    if (!el) return null;
    const r = rectOf(el) || { left: 0, top: 0, width: 0, height: 0 };
    let cls = '';
    try { cls = typeof el.className === 'string' ? el.className : ''; } catch (e) { cls = ''; }
    return {
      tag: tagOf(el).toUpperCase(),
      id: el.id || null,
      cls: cls.slice(0, 60),
      hostile: state.hostiles.has(el),
      broken: el.hasAttribute('data-crs-broken'),
      rect: { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
    };
  };
  /* SPEC-combat §D1: the aim-correction window actually in force, and whether enemy-only focusing is live at
   * all (rampage and debug.noInvuln both switch it off). Read rather than assumed, like debug.hostileTuning(). */
  debug.aimAssist = () => ({ px: enemyFocusOn() ? aimAssistPx() : 0, on: enemyFocusOn(), mode: state.mode });
