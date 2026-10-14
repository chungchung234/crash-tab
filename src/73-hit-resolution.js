// ── hit resolution: floating damage numbers (v1.3 §3.5: opts.size), hit tint, hold-window aggregation, applyHit, bullet chips, AoE candidates/falloff ──
  /* --- cooldown (A3): one global timestamp, set only when an attack actually happened --- */
  function onCooldown() { return !debug.noCooldown && now() < state.cooldownUntil; }
  function startCooldown(id, ms) {
    if (!(ms > 0) || debug.noCooldown) return;   // nothing recorded while cooldowns are disabled (a later flip starts clean)
    state.cooldownUntil = now() + scaleMs(ms);   // SPEC-test-speed §3: deadline comparison in onCooldown()
    if (ms < 500) return;   // the dim reads as a real timer only on axe / bomb / rocket / collapse
    try { const b = weaponBtn(id); if (b) trackAnim(b.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: ms, easing: 'linear' })); } catch (e) { /* ignore */ }
  }
  function cooldownFeedback() {   // a click during cooldown is never silent
    sfx('clack');
    if (reducedMotion()) return;
    try { const b = weaponBtn(state.weapon); if (b) trackAnim(b.animate([{ borderColor: '#ff6b6b' }, { borderColor: 'rgba(255,255,255,.1)' }], { duration: 120 })); } catch (e) { /* ignore */ }
  }

  /* --- floating damage numbers (A5 item 1): "-65", crit "-130!" in gold, rise 44 px over 650 ms, cap 40 --- */
  function dmgText(n, dmg, crit, tag) { n.textContent = (tag ? tag + ' ' : '') + '-' + dmg + (crit ? '!' : ''); }
  /* opts (v1.2): { tag: '헤드샷!' prefix, color, text: literal text instead of "-dmg" (kill / player damage) }
   * opts.size (v1.3 §3.5): explicit px — player damage is drawn at 24 px, not the 14 px of a chip of page.
   * opts.opacity / opts.dur (SPEC-combat §B1): the `무적` of a deflected hit is drawn at 11 px, 55 % opacity
   * and lives 350 ms — a word that says "nothing happened" must not shout as loud as a damage number. */
  function spawnDmg(x, y, dmg, crit, opts) {
    if (!root) return null;
    opts = opts || {};
    const op = opts.opacity != null ? clamp(+opts.opacity, 0, 1) : 1;
    const dur = opts.dur > 0 ? opts.dur : 650;
    const n = mk('div', 'crs-dmg');
    if (opts.text != null) n.textContent = opts.text; else dmgText(n, dmg, crit, opts.tag);
    n.style.left = px(x); n.style.top = px(y);
    n.style.font = '700 ' + (opts.size || (crit ? 18 : 14)) + 'px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    n.style.color = opts.color || (crit ? '#ffd166' : '#fff');
    n.style.textShadow = '0 1px 2px rgba(0,0,0,.8)';
    n.style.transform = 'translate(-50%, -50%)';
    root.append(n);
    state.dmgNodes.push(n);
    while (state.dmgNodes.length > 40) { const old = state.dmgNodes.shift(); try { old.remove(); } catch (e) { /* ignore */ } }
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } const i = state.dmgNodes.indexOf(n); if (i >= 0) state.dmgNodes.splice(i, 1); };
    try {
      const base = 'translate(-50%, -50%) ';
      /* SPEC-settings §3.1: "피해 숫자가 이동 없이 페이드만" — reduced motion keeps the number (the
       * information) and drops the 44 px rise and the crit pop. No `transform` key at all, so the inline
       * centring transform the node already carries is left exactly where it is. */
      const kf = reducedMotion()
        ? [{ opacity: op }, { opacity: op, offset: 0.35 }, { opacity: 0 }]
        : (crit
          ? [{ transform: base + 'translateY(0px) scale(1.4)', opacity: op, offset: 0 }, { transform: base + 'translateY(-8px) scale(1)', opacity: op * 0.95, offset: 0.18 }, { transform: base + 'translateY(-44px) scale(1)', opacity: 0, offset: 1 }]
          : [{ transform: base + 'translateY(0px)', opacity: op }, { transform: base + 'translateY(-44px)', opacity: 0 }]);
      const a = trackAnim(n.animate(kf, { duration: dur, easing: 'ease-out', fill: 'forwards' }));
      a.addEventListener('finish', kill);
    } catch (e) { /* ignore */ }
    later(kill, 1500);
    return n;
  }
  /* Where a number goes: pointer ± 8 px (click), alternating 24 px left/right of the pointer (hold windows; ≥ 42 px
   * between consecutive centres so a 25 px glyph run never collides with the previous window's number),
   * centre of rect ∩ viewport nudged 10 px toward the blast / slash (AoE, slash). */
  function dmgPos(el, ix, iy, opts) {
    if (opts.aoe || opts.slash) {
      const r = rectOf(el);
      if (r) {
        const v = intersectRect(r, { left: 0, top: 0, right: viewW(), bottom: viewH() });
        let x = v.left + v.width / 2, y = v.top + v.height / 2;
        if (opts.toward) { const dx = opts.toward.x - x, dy = opts.toward.y - y, L = Math.hypot(dx, dy); if (L > 1) { x += dx / L * 10; y += dy / L * 10; } }
        return { x: x + rand(-8, 8), y: y + rand(-8, 8) };
      }
    }
    if (opts.win) return { x: ix + opts.win.side * 24 + rand(-3, 3), y: iy - 4 + rand(-3, 3) };
    return { x: ix + rand(-8, 8), y: iy + rand(-8, 8) };
  }

  /* --- hit tint (A5 item 2): a radial splash on the element rect, one node per element --- */
  function tintGradient(rect, ix, iy) {
    const R = clamp(0.5 * Math.sqrt(Math.max(1, rect.width * rect.height)), 60, 220);
    return 'radial-gradient(circle at ' + px(ix - rect.left) + ' ' + px(iy - rect.top) + ', rgba(229,72,77,.30) 0px, rgba(229,72,77,.22) 40%, rgba(229,72,77,0) ' + px(R) + ')';
  }
  function removeTint(el) {
    const t = state.tints.get(el);
    if (!t) return;
    state.tints.delete(el);
    untrack(t.timer);
    try { if (t.anim) t.anim.cancel(); } catch (e) { /* ignore */ }
    try { t.node.remove(); } catch (e) { /* ignore */ }
  }
  function tintFade(el, t, from) {
    const n = t.node;
    if (reducedMotion()) { n.style.opacity = '0.1'; t.timer = later(() => removeTint(el), 180); return; }
    n.style.opacity = String(from);
    try {
      t.anim = trackAnim(n.animate([{ opacity: from }, { opacity: 0 }], { duration: 180, easing: 'ease-out', fill: 'forwards' }));
      t.anim.addEventListener('finish', () => removeTint(el));
    } catch (e) { /* ignore */ }
    t.timer = later(() => removeTint(el), 400);
  }
  function showTint(el, rect, ix, iy, hold) {
    if (!root) return;
    let t = state.tints.get(el);
    if (!t) {
      const n = mk('div', 'crs-hit');
      const s = gcs(el); if (s) n.style.borderRadius = s.borderRadius;
      root.append(n);
      t = { node: n, anim: null, timer: 0, hold: false };
      state.tints.set(el, t);
    }
    const n = t.node;
    n.style.left = px(rect.left); n.style.top = px(rect.top); n.style.width = px(rect.width); n.style.height = px(rect.height);
    n.style.background = tintGradient(rect, ix, iy);
    if (hold && t.hold) return;   // persistent hold tint: re-centred, never re-flashed
    try { if (t.anim) { t.anim.cancel(); t.anim = null; } } catch (e) { /* ignore */ }
    untrack(t.timer); t.timer = 0;
    if (hold) { t.hold = true; n.style.opacity = reducedMotion() ? '0.1' : '0.14'; return; }
    t.hold = false;
    tintFade(el, t, 1);
  }
  function moveTint(el, rect, ix, iy) {   // hold ticks between fx windows: the gradient centre follows the pointer
    const t = state.tints.get(el);
    if (!t || !t.hold) return;
    t.node.style.left = px(rect.left); t.node.style.top = px(rect.top); t.node.style.width = px(rect.width); t.node.style.height = px(rect.height);
    t.node.style.background = tintGradient(rect, ix, iy);
  }
  function fadeTint(el) {   // hold released / target changed
    const t = state.tints.get(el);
    if (!t || !t.hold) return;
    t.hold = false;
    tintFade(el, t, reducedMotion() ? 0.1 : 0.14);
  }

  /* --- hold aggregation windows (A4 / A5): one crit roll + one number + one HUD line per 150 ms per element --- */
  function holdWindow(el) {
    const t = now();
    let w = state.dmgAgg.get(el);
    if (w && t - w.at >= HOLD_WINDOW) { flushWindow(el, w); w = null; }
    if (!w) {
      const rec = hpOf(el);
      const crit = rollCrit();   // v1.5 §3: defaults to the weapon in hand — a hold window always belongs to it
      if (crit) { state.crits++; sfx('crit', { gain: 0.7 }); }   // one audible cue per crit window (A4); the per-tick gun sound stays plain
      rec.side = rec.side === 1 ? -1 : 1;
      w = { el, at: t, sum: 0, crit, side: rec.side, node: null };
      state.dmgAgg.set(el, w);
      if (state.hold) state.hold.open.add(el);
    }
    return w;
  }
  function flushWindow(el, w) {
    if (state.dmgAgg.get(el) === w) state.dmgAgg.delete(el);
    if (state.hold) state.hold.open.delete(el);
    const rec = state.hp.get(el);
    if (w && rec && w.sum > 0) hudLastHit(el, w.sum, rec.hp, rec.max, w.crit);
  }

  /* ── SPEC-combat §B: 전투 중에는 적만 부서진다 ──────────────────────────────────────────
   * rampage keeps v1.2's "everything on the page is destructible". arcade and survival make every
   * NON-hostile element invulnerable: the shot still costs its round (action() / holdStep() spend
   * before fire() ever runs), it simply takes no HP and makes no pieces, and §B1's deflect says so in
   * the same frame. Without this there is no reason to fight the enemy at all — anything under the
   * cursor is worth the same swing.
   *
   * §B2 is the other half of the rule and deliberately NOT expressed here: invulnerability applies to
   * DAMAGE ONLY. Fire (src/76-weapon-fire.js), and wet / frozen / displacement when those exist, still
   * attach to an invulnerable element and still carry damage into any enemy they reach — which is what
   * turns "무적" from a wall into an indirect attack.
   *
   * `debug.noInvuln` turns the rule off. It exists for the suites that were written against v1.2/v1.4
   * behaviour and are about something else entirely (stacking depth, pierce layers, debris lifetime,
   * the repair beam) while enemies happen to be live — same escape hatch as debug.noAttacks /
   * debug.noRepair, and nothing in the product reads it. */
  debug.noInvuln = false;
  function hostileUnit(el) {
    if (!el || el.nodeType !== 1) return false;
    if (state.hostiles.has(el)) return true;
    /* v1.2 §5: a hostile fights as a UNIT. pickTarget() already promotes a click on a descendant up to
     * the hostile itself, but an AoE ring sample, a pierce layer and a burn tick can each land on a
     * child directly — they are the enemy too. */
    for (const h of state.hostiles.keys()) { try { if (h.contains(el)) return true; } catch (e) { /* ignore */ } }
    return false;
  }
  function damageable(el) { return !modeHasEnemies() || debug.noInvuln || hostileUnit(el); }

  /* ── SPEC-combat §B2 / §E: 변위 충돌 피해 ───────────────────────────────────────────
   * §E (변위 시스템, 로드맵 3.5) is in this build now, and its AABB collision step (movedCollide(),
   * src/67-displace.js) routes damage through HERE rather than calling applyHit() itself: §B2 says
   * displacement applies to EVERY element while the collision damage only lands on hostiles, and the
   * gate above is the single place that answers that question. The number is §E3's own —
   * clamp(round(상대속도/14), 1, 60). Both sides of an impact are billed through this one call, so
   * pushing an invulnerable element into an enemy hurts the enemy and nothing else. */
  function collisionHit(el, relSpeed, ix, iy) {
    if (lungeImmune(el)) return 'none';   // SPEC-combat §D5: the charger pushes, it does not crash (see 88-archetypes.js)
    return applyHit(el, clamp(Math.round(relSpeed / 14), 1, 60), 'hammer', ix, iy, { aoe: true, toward: { x: ix, y: iy } });
  }

  /* applyHit — the single damage sink. opts: { crit, hold, win, aoe, slash, toward, pieces, textSplit, splitLine,
   * burnt, radius }. Returns 'broken' | 'damaged' | 'none'. */
  function applyHit(el, dmg, kind, ix, iy, opts) {
    opts = opts || {};
    if (!el) return 'none';
    try { if (el.hasAttribute('data-crs-broken')) return 'none'; } catch (e) { return 'none'; }   // broken meanwhile (staggered AoE, hold tick, collapse chain)
    if (!damageable(el)) { deflectHit(el, ix, iy, opts); return 'none'; }   // SPEC-combat §B / §B1
    /* SPEC-combat §D3 (지원형 보호막): the shield a support enemy casts on an ally lives at the ONE damage
     * sink, exactly like the §B gate above — so every weapon obeys it with no special case in weapon code.
     * A plain pass-through whenever nothing on the page is shielded (src/88-archetypes.js). */
    dmg = guardedDamage(el, dmg);
    const rec = hpOf(el);
    rec.hp -= dmg;
    state.damageDealt += dmg;
    const crit = !!opts.crit;
    const broken = rec.hp <= 0;
    const win = opts.hold ? opts.win : null;
    if (win) {
      win.sum += dmg;
      if (win.node && win.node.isConnected) dmgText(win.node, win.sum, win.crit);
      else { const p = dmgPos(el, ix, iy, opts); win.node = spawnDmg(p.x, p.y, win.sum, win.crit); }
      if (broken) flushWindow(el, win);
    } else {
      if (crit) state.crits++;
      const p = dmgPos(el, ix, iy, opts);
      spawnDmg(p.x, p.y, dmg, crit, crit && opts.headshot ? { tag: msg('headshotLabel') } : null);
      hudLastHit(el, dmg, rec.hp, rec.max, crit, !!opts.headshot);
    }
    if (broken) {
      removeTint(el);   // pieces are already flying
      breakElement(el, ix, iy, Object.assign({ mode: kind }, opts));
      refreshHover();
      return 'broken';
    }
    const t = now();
    const rect = rectOf(el);
    const fxOk = !opts.hold || t - (rec.lastFxAt || 0) >= HOLD_WINDOW;
    if (fxOk) {
      rec.lastFxAt = t;
      if (rect) { reactDamage(el, ix, iy, rect); showTint(el, rect, ix, iy, !!opts.hold); }
    } else if (rect) moveTint(el, rect, ix, iy);
    if (state.hoverEl === el) showTarget(el); else refreshHover();
    if (fxOk) pulseTarget();
    if (crit && state.hoverEl === el && (!win || win.sum === dmg)) critFlashFill();   // once per crit (first tick of a hold window), not per tick
    return 'damaged';
  }

  /* Bullet-hole glass chips (A18): ordinary physics pieces (cap, eviction,
   * stats().pieces) but NOT element debris — they carry crs-chip instead of
   * crs-debris and are excluded from stats().debris, because A31 requires the
   * debris count to stay unchanged on a damage-only gun shot. */
  function spawnChips(x, y, count) {
    const n = count || randInt(3, 5), made = [];
    for (let i = 0; i < n; i++) {
      const s = rand(6, 10);
      const node = mk('div', 'crs-piece crs-chip');
      node.style.left = px(x - s / 2); node.style.top = px(y - s / 2); node.style.width = px(s); node.style.height = px(s);
      node.style.background = 'rgba(236,243,255,.92)'; node.style.boxShadow = '0 0 1px rgba(0,0,0,.6)';
      node.style.clipPath = 'polygon(' + px(rand(0, s * 0.3)) + ' 0px, ' + px(s) + ' ' + px(rand(0, s * 0.4)) + ', ' + px(rand(s * 0.4, s)) + ' ' + px(s) + ', 0px ' + px(rand(s * 0.5, s)) + ')';
      node.style.transformOrigin = px(s / 2) + ' ' + px(s / 2);
      const v = velocityFor('gun', x, y, x + rand(-4, 4), y + rand(-4, 4), null);
      made.push([node, { ox: x - s / 2, oy: y - s / 2, w: s, h: s, vx: v.vx * 1.4, vy: v.vy * 1.4 - 60, vr: v.vr * 2, cx: s / 2, cy: s / 2, bb: { minX: 0, minY: 0, maxX: s, maxY: s }, word: true, chip: true }]);
    }
    enforceCap(made.length, batchGpu(made));
    for (const [node, p] of made) addPiece(node, p);
  }
  function edgeDist(rect, x, y) {
    const dx = Math.max(rect.left - x, 0, x - rect.right), dy = Math.max(rect.top - y, 0, y - rect.bottom);
    return Math.hypot(dx, dy);
  }
  /* AoE candidates (A7): the element under the blast centre is always candidate 0 (edgeDist 0); ring samples
   * drop its descendants AND its ancestors (the centre is the only candidate on its chain, exactly as v1
   * bombCandidates — where the blast point itself fed the ancestor filter), then the v1 ancestor filter over the
   * remaining samples; sort by edge distance, keep maxTargets. */
  function aoeCandidates(x, y, R, maxTargets, rings, ignoreCover) {
    const seen = new Set(), list = [], cache = new Map();
    const centre = pickTarget(x, y, cache);
    const vw = viewW(), vh = viewH();
    /* v1.5 / combat-v2 §10.3-3: `aoeIgnoresCover` weapons sample THROUGH the topmost element at each probe,
     * so an element hiding behind a card is still inside the blast. The ancestor / descendant rules below are
     * unchanged, so the centre's own container still never becomes a candidate (A7). */
    const add = (el) => {
      if (!el || el === centre || seen.has(el)) return;
      if (centre && (centre.contains(el) || el.contains(centre))) return;
      seen.add(el); list.push(el);
    };
    if (ignoreCover) for (const b of pierceTargets(x, y, centre, 2)) add(b);
    for (const r of rings) {
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4, pxv = x + Math.cos(a) * r, pyv = y + Math.sin(a) * r;
        if (pxv < 0 || pyv < 0 || pxv > vw || pyv > vh) continue;
        const el = pickTarget(pxv, pyv, cache);
        add(el);
        if (ignoreCover) for (const b of pierceTargets(pxv, pyv, el, 2)) add(b);
      }
    }
    const filtered = list.filter((el) => !list.some((o) => o !== el && el.contains(o)));
    const out = [];
    if (centre) out.push({ el: centre, d: 0 });
    for (const el of filtered) {
      const r = rectOf(el); if (!r) continue;
      const d = edgeDist(r, x, y);
      if (d <= R) out.push({ el, d });
    }
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, maxTargets);
  }
  /* Falloff damage round(centre · (1 − 0.73·t)), t = edgeDist / R → centre 100 %, edge 27 %; stagger edgeDist / 4 ms. */
  function aoeHit(x, y, W) {
    const R = W.radius;
    const cands = aoeCandidates(x, y, R, W.maxTargets, W.rings, !!W.aoeIgnoresCover);
    const plan = cands.map((c, i) => { const crit = rollCrit(W.id); return { c, i, crit, dmg: rollDamage(Math.round(W.damage * (1 - 0.73 * clamp(c.d / R, 0, 1))), crit) }; });   // v1.5 §3: the blast rolls the WEAPON's critChance
    if (plan.some((p) => p.crit)) sfx('crit', { gain: 0.9 });   // the blast sound has already played; add the ×1.5 sparkle once (A4)
    for (const { c, i, crit, dmg } of plan) {
      const fire = () => { if (state.active && c.el.isConnected) applyHit(c.el, dmg, 'bomb', x, y, { textSplit: i === 0, aoe: true, crit, radius: R, toward: { x, y } }); scheduleHud(); };
      const delay = c.d / 4;
      if (delay < 1) fire(); else later(fire, delay);
    }
  }

  /* ── v1.5 §3 / SPEC-combat-v2 §10.3-2: pierce ─────────────────────────────
   * A hitscan weapon with `pierce` > 0 keeps going after the front-most target:
   * it walks the SAME element stack down, hits up to `pierce` further qualifying
   * elements and attenuates by ×0.6 per layer (60 %, 36 %). Anything on the
   * chain already hit — the front target, its ancestors, its descendants — is
   * skipped, so one card never takes two helpings of the same bullet. */
  function piercedAlready(el, hit) {
    for (const o of hit) {
      if (o === el) return true;
      try { if (o.contains(el) || el.contains(o)) return true; } catch (e) { return true; }
    }
    return false;
  }
  /* pickTarget()'s own walk-up rules, applied to one raw elementsFromPoint candidate: promote past boxes too
   * small to aim at and past inline wrappers, and let a hostile component answer for its descendants. Kept
   * here rather than in src/50-target.js (another workstream's file) — the rules are the same five lines. */
  function normaliseBehind(el, hit) {
    const mag = scopeMag(), mag2 = mag * mag;
    const body = doc.body;
    for (let guard = 0; guard < 40 && el; guard++) {
      const p = parentOf(el);
      if (!p || p === body || p === docEl || p.nodeType !== 1) break;
      const r = rectOf(el); if (!r) break;
      if (r.width < 24 * mag || r.height < 14 * mag) { el = p; continue; }
      const s = gcs(el);
      if (s && s.display === 'inline' && !REPLACED_TAGS.has(tagOf(el))) { el = p; continue; }
      break;
    }
    if (!el || el === doc.body || el === docEl) return null;
    if (state.hostiles.size) { for (const h of state.hostiles.keys()) { if (h !== el && h.contains(el) && !piercedAlready(h, hit)) { el = h; break; } } }
    const r = rectOf(el);
    if (!r || r.width * r.height > 0.8 * viewW() * viewH() * mag2) return null;
    try { if (el.hasAttribute('data-crs-broken')) return null; } catch (e) { return null; }
    return piercedAlready(el, hit) ? null : el;
  }
  function pierceTargets(x, y, front, n) {
    const out = [], hit = front ? [front] : [];
    if (!(n > 0)) return out;
    let list;
    try { list = doc.elementsFromPoint(x, y); } catch (e) { return out; }
    const env = { vw: viewW(), vh: viewH(), op: new Map() };
    for (const c of list) {
      if (out.length >= n) break;
      if (!visibleCandidate(c, env) || isOverlay(c, env)) continue;
      if (piercedAlready(c, hit)) continue;
      const el = normaliseBehind(c, hit);
      if (!el) continue;
      out.push(el); hit.push(el);
    }
    return out;
  }
  /* A thin white line across each pierced element for 0.2 s — without it the extra damage is invisible.
   * MERGED (v1.4 + v1.5): src/87-depth.js used to declare a second pierceMark() of its own. There is one
   * now, here, and it keeps the v1.4 copy's prefers-reduced-motion guard — a decorative fade, handled the
   * same way as every other one in this build (beamFx, toastFx, lockPop …). */
  function pierceMark(el, y) {
    if (!root || reducedMotion()) return;
    const r = rectOf(el);
    if (!r || r.width < 2) return;
    const n = mk('div', 'crs-pierce');
    n.style.left = px(r.left + 4);
    n.style.top = px(clamp(y, r.top + 1, r.bottom - 1) - 1);
    n.style.width = px(Math.max(8, r.width - 8));
    root.append(n);
    const kill = () => { try { n.remove(); } catch (e) { /* ignore */ } };
    try { const a = trackAnim(n.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' })); a.addEventListener('finish', kill); } catch (e) { /* ignore */ }
    later(kill, 600);
  }
  /* ── the ONE pierce entry point (SPEC-combat-v2 §10.3-2 + SPEC-weapons §3, merged) ─────────────────
   * src/87-depth.js used to declare a SECOND applyPierce() with a different signature
   * (x, y, front, layerCount, baseDamage). Every src/ fragment shares one closure and 87 is concatenated
   * after 73, so that one won and the v1.5 call sites were feeding it `'gun'` as the layer count and
   * `'sniper'` as the base damage — Math.round('sniper' * 0.6) is NaN, so every layer behind a pistol or
   * sniper shot had its hp silently set to NaN instead of taking 60 %. One declaration each now; the
   * depth module keeps `pierceOf()` (the stat reader) and `schedulePierce()` (the single caller).
   *   layer count  pierceOf(id) reads WEAPONS[id].pierce. 붕괴's PIERCE_ALL (999) is a sentinel, not a
   *                reason to walk a whole page, so it is clamped to PIERCE_MAX_LAYERS.
   *   targets      pierceTargets() walks the SAME elementsFromPoint stack the bullet went through, under
   *                pickTarget()'s own walk-up rules, skipping anything already on the front target's chain.
   *   damage       the firing weapon's own roll — its critChance and its distance falloff — attenuated
   *                ×0.6 compounding per layer (60 %, 36 %, …).
   * `front` may be null (the shot missed everything pickable); the layers behind are still eligible, which
   * is what makes pierce feel like a through-shot. Returns the number of layers actually hit. */
  const PIERCE_MAX_LAYERS = 8;
  function applyPierce(x, y, front, kind, id) {
    if (!state.active) return 0;
    const wid = id || state.weapon;
    const W = WEAPONS[wid];
    if (!W || !(W.damage > 0) || !isFinite(W.damage)) return 0;   // 붕괴's Infinity never reaches here (doCollapse breaks outright)
    const n = Math.min(pierceOf(wid), PIERCE_MAX_LAYERS);
    if (!(n > 0)) return 0;
    const targets = pierceTargets(x, y, front, n);
    const fall = falloffMul(wid, x, y);
    const mode = kind || W.kind;
    /* SPEC-arsenal §B2: 레이저 커터 is "관통 무제한, 층마다 ×0.75" — a different per-layer attenuation from
     * the ×0.6 every other piercing weapon uses. One table field rather than a weapon-id special case here;
     * every weapon without it keeps 0.6 exactly. (MINIMAL EDIT to a file this workstream only reads.) */
    const layerMul = (W.pierceFalloff > 0 && W.pierceFalloff < 1) ? W.pierceFalloff : 0.6;
    let k = 0;
    for (const el of targets) {
      k++;
      const crit = rollCrit(wid);
      const dmg = rollDamage(W.damage, crit, Math.pow(layerMul, k) * fall);
      pierceMark(el, y);
      applyHit(el, dmg, mode, x, y, { crit, pierce: k });
    }
    return k;
  }
