// ── SPEC-destruction §F: 연소 시스템 — 지속 피해 · 확산 · 모습과 소리 · 상태 연계 · 화염탄 ──
  /* 사용자: "불 공격은 지속딜과 확산이 포인트인데 없네"
   *
   * 3단계 §B2 (SPEC-combat) planted the seed of this system inside src/76-weapon-fire.js: a ledger, a
   * 250 ms tick, 24 px adjacency spread, and the rule that fire sticks to an INVULNERABLE element and only
   * bites once it has reached an enemy. All of that is still here, unchanged in its numbers and its names —
   * the §B2 assertions are a contract. What step 6 adds is everything §F actually asks for:
   *   §F1 상태        — the record, 지속 피해 초당 2 + stacks × 0.14, 자연 감소 초당 6, 상한 20 (성능 10)
   *   §F2 확산        — 700 ms · stacks ≥ 45 · 24 px 인접 · 최대 2개 · ×0.35 · 불꽃이 튀는 연출
   *   §F3 모습과 소리 — 아래 가장자리 불꽃 · 그을림 램프 · 연기 · sepia 틴트 · 루프음 하나
   *   §F4 연계        — ash 마감 · 폭발 반경 ×1.15 · 복구 봉쇄 · 젖음 / 빙결 표
   *   §F5 점화 무기   — 화염방사기 9 / 로켓 25·12 / 폭탄 15
   *   §F6 화염방사기  — 틱 피해 8, 틱당 스택 9, 짧게 누르면 화염탄
   *
   * TWO READINGS CHOSEN (both reported):
   *   · §B2 scoped ignition to the combat modes because the general case was step 6's to settle. It is
   *     settled: fire burns in rampage too (§F is a weapon system, not a combat rule), and §F6 pays for it
   *     in the same breath by dropping the flamethrower's tick damage from 15 to 8.
   *   · fire does not spread into an element's own ancestors or descendants. They are always "맞닿은" by
   *     rect, so without this one tick on a card would climb its whole wrapper chain in 700 ms. §F2 says
   *     인접 — "번진다", not "번져 올라간다" — so it spreads sideways.
   *
   * NOT REACHABLE YET, and said so rather than faked: §F4's 젖음 · 빙결 table and §F5's 레이저 entry. The
   * water pistol, the freeze gun and the laser cutter are roadmap steps 7–8 and no weapon in this build
   * produces those states. The RULES are implemented here against a real per-element status record and are
   * driven by debug hooks (debug.setWet / setFrozen / douse), so step 8 wires its weapons to them and
   * changes nothing else. */

  const BURN_TICK_MS = 250;                              // §F1: 250 ms 마다 1/4씩
  const BURN_DOT_BASE = 2, BURN_DOT_PER_STACK = 0.14;    // §F1: 지속 피해 초당 2 + stacks × 0.14
  const BURN_DECAY = 6;                                  // §F1: 자연 감소 초당 6
  const BURN_MAX = 100, BURN_MIN = 1;                    // §F1: stacks 0~100
  const BURN_CAP = 20, BURN_CAP_PERF = 10;               // §F1: 동시 연소 상한 20 (성능 모드 10)
  const BURN_SPREAD_MS = 700;                            // §F2: 700ms 마다 번질 곳을 찾는다
  const BURN_SPREAD_MIN = 45;                            // §F2: stacks >= 45 일 때만
  const BURN_SPREAD_GAP = 24;                            // §F2: rect 가 24px 이내로 맞닿거나 겹칠 것
  const BURN_SPREAD_MAX = 2, BURN_SPREAD_MUL = 0.35;     // §F2: 최대 2개, stacks × 0.35, 원래 쪽은 줄지 않는다
  const BURN_FLAME_STACKS = 9;                           // §F5: 화염방사기 틱당 9
  const BURN_ROCKET_DIRECT = 25, BURN_ROCKET_SPLASH = 12;   // §F5: 로켓 직격 25 · 범위 12
  const BURN_BOMB_DIRECT = 15, BURN_BOMB_SPLASH = 15;       // §F5: 폭탄 범위 15
  const BURN_LASER_STACKS = 4;                           // §F5: 레이저 틱당 4 — the laser cutter is roadmap step 7
  const BURN_BLAST_MUL = 1.15, BURN_BLAST_SPLASH = 20;   // §F4: 폭발에 휘말리면 반경 ×1.15, 주변에 스택 20
  const BURN_WET_MUL = 0.3, BURN_WET_OUT = 20;           // §F4: 젖음 → 불, 들어오는 스택 ×0.3 · stacks < 20 에서 즉시 꺼짐
  const BURN_DRY_MUL = 2;                                // §F4: 불 → 젖음, wet 이 2배 속도로 마름
  const BURN_WATER_STACKS = 40;                          // §F4: 물총 → 불, 틱당 스택 −40
  const BURN_FREEZE_RATE = 25;                           // §F4: 빙결 ↔ 불, 각각 초당 25씩 녹이고 끈다
  const BURN_FROZEN_FULL = 100;                          // §F4: 완전 빙결에는 붙지 않는다
  const BURN_SMOKE_PER_S = 1.5;                          // §F3: 연기는 요소당 초당 1.5개
  const BURN_FLAME_BASE = 12, BURN_FLAME_PER_STACK = 0.2;   // §F3: 불꽃 높이 12 + stacks × 0.2 px
  const BURN_FLICKER_MS = 120;                           // §F3: 0.12초 주기 흔들림
  /* §F6 화염탄: 반경 110px 불바다가 5초, 초당 14 스택. 연료 12 소모, 쿨다운 1400ms. */
  const POOL_R = 110, POOL_MS = 5000, POOL_STACKS_PER_S = 14;
  const FIREBOMB_FUEL = 12, FIREBOMB_CD = 1400, FIREBOMB_FLIGHT = 460, FIREBOMB_PRESS_MS = 180;

  /* A Map, not a WeakMap: every tick walks the whole set, so it has to be enumerable (§F1). */
  const burning = new Map();
  /* §F4's other two states. Separate, because a wet or frozen element is usually NOT burning — that is the
   * whole point of wetting something before the fire arrives. */
  const chilled = new Map();
  const pools = [];
  let burnTimer = 0;
  let burnSpark = 0;   // §F3 read-back: how many spread flashes have been drawn
  let burnTicks = 0;   // §F1 read-back: how many 250 ms steps have run (a test must not guess the cadence)

  function burnCap() { return perfOn() ? BURN_CAP_PERF : BURN_CAP; }
  function burnCount() { return burning.size; }
  function isBurning(el) { return !!(el && burning.has(el)); }
  /* §F4's ash rule is about an element that WAS ALREADY BURNING when the blow landed — "연소 중에 파괴된
   * 요소". A blast lights its targets (§F5) and destroys them in the same event, and if that counted the
   * bomb and the rocket would never again leave their own §B4 debris (wedge · scorch, shard · ember): every
   * blast would end in ash. So the fire has to have had a tick of its own first. */
  function burnEstablished(el) {
    const rec = el && burning.get(el);
    return !!rec && rec.ticked === true;
  }
  function burnAlive(el) {
    if (!el || el.nodeType !== 1 || !el.isConnected || isOurs(el)) return false;
    try { return !el.hasAttribute('data-crs-broken'); } catch (e) { return false; }
  }
  function chillOf(el) {
    let c = chilled.get(el);
    if (!c) { c = { wet: 0, frozen: 0 }; chilled.set(el, c); }
    return c;
  }

  /* ── §F3 the look ────────────────────────────────────────────────────────────────────────────────
   * Three things are drawn per burning element: a flame strip along its BOTTOM edge that follows it, a
   * char ramp burnt into its decal, and a sepia tint written as an inline `filter`.
   * The tint is the only thing this system puts on a PAGE element, so its original value AND priority are
   * saved before the first write and put back on extinguish (CLAUDE.md: 흔적을 남기지 않는다 — 빈 문자열이
   * 아니라 원래 값으로). `filter` carries no !important anywhere in content.css for page elements. */
  function burnTint(el, rec) {
    if (rec.saved === undefined) {
      try { rec.saved = el.style.getPropertyValue('filter') || ''; rec.savedPriority = el.style.getPropertyPriority('filter') || ''; }
      catch (e) { rec.saved = ''; rec.savedPriority = ''; }
    }
    const s = clamp(rec.stacks, 0, BURN_MAX);
    const want = 'sepia(' + (s / 280).toFixed(4) + ') brightness(' + (1 + s / 900).toFixed(4) + ')';
    if (want === rec.wrote) return;
    rec.wrote = want;
    try { el.style.setProperty('filter', want); } catch (e) { /* ignore */ }
  }
  function burnUntint(el, rec) {
    if (rec.saved === undefined) return;
    try {
      if (rec.saved) el.style.setProperty('filter', rec.saved, rec.savedPriority);
      else el.style.removeProperty('filter');
    } catch (e) { /* ignore */ }
    rec.saved = undefined; rec.wrote = '';
  }
  function burnFlames(el, rec) {
    if (!root || reducedMotion()) return;
    const r = rectOf(el);
    if (!r || r.width < 1 || r.height < 1) return;
    if (!rec.node || !rec.node.isConnected) {
      const n = mk('div', 'crs-flames');
      n.style.background = 'linear-gradient(0deg, rgba(255,214,102,.85) 0%, rgba(255,107,53,.6) 45%, rgba(255,107,53,0) 100%)';
      n.style.transformOrigin = '50% 100%';
      try { root.append(n); } catch (e) { return; }
      rec.node = n;
      try { rec.anim = trackAnim(n.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(.62)' }, { transform: 'scaleY(1)' }], { duration: BURN_FLICKER_MS, iterations: Infinity })); } catch (e) { rec.anim = null; }
    }
    const h = BURN_FLAME_BASE + clamp(rec.stacks, 0, BURN_MAX) * BURN_FLAME_PER_STACK;
    const s = rec.node.style;
    s.left = px(r.left); s.top = px(r.bottom - h); s.width = px(r.width); s.height = px(h);
  }
  function burnDropFlames(rec) {
    if (rec.anim) { try { rec.anim.cancel(); } catch (e) { /* ignore */ } state.anims.delete(rec.anim); rec.anim = null; }
    if (rec.node) { try { rec.node.remove(); } catch (e) { /* ignore */ } rec.node = null; }
  }
  /* §F3 "그을림 데칼이 stacks 에 비례해 짙어진다". Only the DIFFERENCE since the last tick is laid down, the
   * same way charDecal() ramps the flamethrower's own char (src/66-fracture.js), so a long burn darkens
   * smoothly instead of saturating on the first tick. */
  function burnChar(el, rec) {
    const want = clamp(rec.hottest / BURN_MAX, 0, 1) * 0.7;
    const prev = rec.char || 0;
    if (want <= prev + 0.04) return;
    const dec = ensureDecal(el);
    if (!dec || !dec.ctx) return;
    rec.char = want;
    try {
      const c = dec.ctx;
      c.save();
      c.fillStyle = 'rgba(26,18,12,' + ((want - prev) * 0.55).toFixed(3) + ')';
      c.fillRect(0, 0, dec.cssW, dec.cssH);
      c.restore();
    } catch (e) { /* ignore */ }
  }
  /* Every burning element's flame strip re-reads its element's rect. Called from tickFrame() so the strip
   * rides a scroll, a reflow and a displacement instead of being redrawn four times a second. */
  function burnFollow() {
    if (!burning.size) return false;
    for (const [el, rec] of burning) { if (rec.node) burnFlames(el, rec); }
    return true;
  }

  /* ── §F3 the sound ───────────────────────────────────────────────────────────────────────────────
   * "타닥거리는 저역 노이즈 루프 하나. 볼륨이 연소 요소 수에 비례한다. 요소마다 소리를 내면 귀가 아프다." */
  function burnAudioSync() {
    const n = burning.size;
    if (n > 0 && state.active && !state.muted) { ensureAudio(); startBurnLoop(); setBurnGain(n); }
    else stopBurnLoop();
  }

  /* ── §F1 the ledger ──────────────────────────────────────────────────────────────────────────── */
  /* igniteEl(el, stacks) — the ONE way anything catches fire. Returns the record, or null when the element
   * cannot take fire at all (gone, broken, ours, over the cap, or §F4's 완전 빙결). */
  function igniteEl(el, stacks) {
    if (!state.active || !burnAlive(el) || !(stacks > 0)) return null;
    const ch = chilled.get(el);
    if (ch && ch.frozen >= BURN_FROZEN_FULL) return null;        // §F4: 완전 빙결 → 불. 먼저 녹여야 한다
    let add = stacks;
    if (ch && ch.wet > 0) add *= BURN_WET_MUL;                   // §F4: 젖음 → 불, 들어오는 스택 ×0.3
    let rec = burning.get(el);
    if (!rec) {
      if (burning.size >= burnCap()) return null;
      rec = { stacks: 0, hottest: 0, bornAt: now(), ticked: false, lastTickAt: now(), igniter: state.weapon, spreadAt: now(), smokeDebt: 0, char: 0, node: null, anim: null, saved: undefined, savedPriority: '', wrote: '' };
      burning.set(el, rec);
    }
    rec.stacks = clamp(rec.stacks + add, 0, BURN_MAX);
    /* §F4: 젖은 요소는 `stacks < 20` 에서 즉시 꺼진다 — a damp thing can be scorched, not set alight. */
    if (ch && ch.wet > 0 && rec.stacks < BURN_WET_OUT) { extinguish(el); return null; }
    if (rec.stacks > rec.hottest) rec.hottest = rec.stacks;
    burnTint(el, rec);
    burnFlames(el, rec);
    armBurn();
    return rec;
  }
  /* §F4 물총 → 불: 틱당 스택 −40. The water pistol is roadmap step 8; this is the rule it will call. */
  function douseEl(el, stacks) {
    const rec = burning.get(el);
    if (!rec) return null;
    rec.stacks -= (stacks > 0 ? stacks : BURN_WATER_STACKS);
    if (rec.stacks < BURN_MIN) { extinguish(el); return 0; }
    burnTint(el, rec);
    return Math.round(rec.stacks);
  }
  function extinguish(el) {
    const rec = burning.get(el);
    if (!rec) return false;
    burning.delete(el);
    burnDropFlames(rec);
    burnUntint(el, rec);
    burnAudioSync();
    return true;
  }
  function armBurn() {
    if (burnTimer || !state.active) return;
    if (!burning.size && !pools.length) return;
    burnTimer = later(burnStep, BURN_TICK_MS);
    burnAudioSync();
  }
  function clearBurning() {
    untrack(burnTimer); burnTimer = 0;
    for (const [el, rec] of Array.from(burning)) { burnDropFlames(rec); burnUntint(el, rec); }
    burning.clear();
    chilled.clear();
    for (const p of pools.splice(0, pools.length)) { try { p.node.remove(); } catch (e) { /* ignore */ } }
    burnSpark = 0; burnTicks = 0;
    stopBurnLoop();
  }

  /* ── §F2 확산 ────────────────────────────────────────────────────────────────────────────────── */
  /* Gap between two rects — 0 when they touch or overlap. §F2 wants ADJACENCY, not distance between
   * centres: fire that jumps a gap is teleportation, not fire. The rects are read LIVE, which is why
   * §F4's "변위 → 불" falls out for free: 밀어서 떼면 방화선이 된다. */
  function rectGap(a, b) {
    const dx = Math.max(a.left - b.right, b.left - a.right, 0);
    const dy = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
    return Math.hypot(dx, dy);
  }
  /* §F2: the three sparks that make the jump visible, plus the short "화악" of §F3. */
  function spreadSparks(a, b) {
    burnSpark++;
    const x = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2;
    const y = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
    if (isFinite(x) && isFinite(y) && !reducedMotion()) spawnFire(x, y, 3);
    sfx('flare', { gain: 0.5 });
  }
  function burnSpread(el, rec, r) {
    if (burning.size >= burnCap()) return;
    /* descendCollected: a collected container is still walked INTO. Without it the walk stops at the first
     * box under the limit — a section, say — and the cards inside it, which are the things that are actually
     * 맞닿은, are never candidates at all. (§F2 names the 300 ms memo; walkCandidates keys it on these very
     * options, so this stays a separate, correctly-cached signature.) */
    const cands = walkCandidates(r.left + r.width / 2, r.top + r.height / 2, { limit: 0.7 * viewW() * viewH(), minArea: 1200, descendCollected: true });
    /* The SAME wrapper filter aoeCandidates() applies (src/73-hit-resolution.js): a candidate that
     * CONTAINS another candidate is a container, not a neighbour. Without it `descendCollected` hands the
     * walk both a section and the cards inside it, and the section — which touches everything it wraps —
     * catches first and then chars right across the gaps between its children. That is the page STRUCTURE
     * burning, not the page: §F2's 인접 is about things that sit next to each other. (The el.contains /
     * o.contains guard below only protects the burning element's OWN chain; this one protects everyone
     * else's.) */
    const wrap = new Set();
    for (const a of cands) for (const b of cands) { if (a !== b) { try { if (a.el.contains(b.el)) { wrap.add(a.el); break; } } catch (e) { /* ignore */ } } }
    let n = 0;
    for (const c of cands) {
      if (n >= BURN_SPREAD_MAX || burning.size >= burnCap()) break;
      const o = c.el;
      if (o === el || burning.has(o) || !burnAlive(o) || wrap.has(o)) continue;
      try { if (o.contains(el) || el.contains(o)) continue; } catch (e) { continue; }   // reading chosen: sideways only
      const or = rectOf(o);                                  // LIVE rect: a displaced element really has moved
      if (!or || rectGap(r, or) > BURN_SPREAD_GAP) continue;
      // §F2: 원래 쪽은 줄지 않는다. 불은 나눠 갖는 게 아니라 번진다.
      if (igniteEl(o, rec.stacks * BURN_SPREAD_MUL)) { n++; spreadSparks(r, or); }
    }
  }

  /* ── §F5 / §F4: what a blast does ──────────────────────────────────────────────────────────────── */
  /* §F4: 연소 중 요소가 폭발에 휘말리면 반경 ×1.15. Asked BEFORE the blast resolves, so the bigger radius is
   * the one the damage, the ring, the mark and the crosshair's prediction all agree on. */
  function burnBlastRadius(x, y, R) {
    if (!burning.size || !(R > 0) || !isFinite(R)) return R;
    for (const el of burning.keys()) {
      const r = rectOf(el);
      if (r && edgeDist(r, x, y) <= R) return R * BURN_BLAST_MUL;
    }
    return R;
  }
  /* §F5's ignition table for the two blast weapons, and §F4's "그 폭발이 주변에 스택 20을 뿌린다" — a blast
   * that caught something already burning throws more fire than one that did not. */
  function blastIgnite(x, y, W, direct, splash) {
    if (!state.active) return 0;
    let caught = false;
    for (const el of burning.keys()) { const r = rectOf(el); if (r && edgeDist(r, x, y) <= W.radius) { caught = true; break; } }
    const sp = caught ? Math.max(splash, BURN_BLAST_SPLASH) : splash;
    let cands = [];
    try { cands = aoeCandidates(x, y, W.radius, W.maxTargets, W.rings, !!W.aoeIgnoresCover); } catch (e) { cands = []; }
    let n = 0;
    for (const c of cands) { if (igniteEl(c.el, c.d === 0 ? direct : sp)) n++; }
    return n;
  }

  /* ── §F6 화염탄 ───────────────────────────────────────────────────────────────────────────────── */
  /* "포물선으로 날아가 착탄점에 불바다(반경 110px, 5초, 초당 14 스택)를 만든다. 확산의 시작점을 던져
   * 놓는 도구다." It is the flamethrower's 보조, i.e. a SHORT PRESS — a press that let go before the
   * sustained stream really started. INTERPRETATION (reported): roadmap step 7 owns the general 보조 공격
   * system, so this is wired to the one gesture §F6 names rather than inventing a second input. */
  function firePoolAt(x, y) {
    if (!state.active) return null;
    const p = { x, y, r: POOL_R, until: now() + scaleMs(POOL_MS), node: null };
    if (root && !reducedMotion()) {
      const n = mk('div', 'crs-firepool');
      n.style.left = px(x - POOL_R); n.style.top = px(y - POOL_R);
      n.style.width = px(2 * POOL_R); n.style.height = px(2 * POOL_R);
      n.style.borderRadius = '50%';
      n.style.background = 'radial-gradient(circle, rgba(255,214,102,.5) 0%, rgba(255,107,53,.35) 55%, rgba(255,107,53,0) 78%)';
      try { root.append(n); } catch (e) { /* ignore */ }
      p.node = n;
      try { trackAnim(n.animate([{ opacity: 0.95 }, { opacity: 0.72 }, { opacity: 0.95 }], { duration: 420, iterations: Infinity })); } catch (e) { /* ignore */ }
    }
    pools.push(p);
    armBurn();
    kick();
    return p;
  }
  function poolStep(dt) {
    if (!pools.length) return;
    const t = now(), add = POOL_STACKS_PER_S * dt;
    for (let i = pools.length - 1; i >= 0; i--) {
      const p = pools[i];
      if (t >= p.until || !state.active) {
        pools.splice(i, 1);
        if (p.node) { try { cancelAnimsOf(p.node); p.node.remove(); } catch (e) { /* ignore */ } }
        continue;
      }
      let cands = [];
      try { cands = walkCandidates(p.x, p.y, { limit: 0.7 * viewW() * viewH(), minArea: 1200, descendCollected: true }); } catch (e) { cands = []; }
      let n = 0;
      for (const c of cands) {
        if (n >= 4) break;
        const r = rectOf(c.el);
        if (!r || edgeDist(r, p.x, p.y) > p.r) continue;
        if (igniteEl(c.el, add)) n++;
      }
      if (!reducedMotion() && Math.random() < 0.6) spawnFire(p.x + rand(-p.r * 0.7, p.r * 0.7), p.y + rand(-p.r * 0.5, p.r * 0.5), 1);
    }
  }
  /* The thrown shell itself: a parabola, drawn with the same tracked WAAPI / later() pair the rocket uses,
   * so restore() and deactivate() cancel both the flight and the impact. */
  function throwFireBomb(x, y) {
    if (!state.active) return false;
    if (onCooldown()) { cooldownFeedback(); return false; }
    if (!spendFuel(FIREBOMB_FUEL)) { sfx('empty'); return false; }
    state.shots++;
    sfx('whoosh', { gain: 0.8, pitch: 0.8 });
    startCooldown('flame', FIREBOMB_CD);
    const flightMs = reducedMotion() ? 60 : scaleMs(FIREBOMB_FLIGHT);
    if (!root) { firePoolAt(x, y); return true; }
    const sx = viewW() / 2, sy = viewH() + 16;
    const n = mk('div', 'crs-firebomb');
    n.style.left = px(sx); n.style.top = px(sy); n.style.width = '14px'; n.style.height = '14px';
    n.style.borderRadius = '50%';
    n.style.background = 'radial-gradient(circle, #fff 0%, #ffd166 40%, rgba(255,107,53,.85) 100%)';
    n.style.boxShadow = '0 0 12px 4px rgba(255,107,53,.7)';
    n.style.transform = 'translate(-50%, -50%)';
    try { root.append(n); } catch (e) { /* ignore */ }
    const apex = -Math.max(120, Math.abs(y - sy) * 0.45);   // the arc the shell is thrown on
    try {
      trackAnim(n.animate([
        { transform: 'translate(-50%, -50%) translate(0px, 0px)' },
        { transform: 'translate(-50%, -50%) translate(' + px((x - sx) / 2) + ', ' + px((y - sy) / 2 + apex) + ')', offset: 0.5 },
        { transform: 'translate(-50%, -50%) translate(' + px(x - sx) + ', ' + px(y - sy) + ')' }
      ], { duration: flightMs, easing: 'linear', fill: 'forwards' }));
    } catch (e) { /* ignore */ }
    laterRaw(() => {
      try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ }
      if (!state.active) return;
      sfx('flare');
      flash(x, y, 'hammer', { size: POOL_R, dur: 180 });
      firePoolAt(x, y);
      scheduleHud();
    }, flightMs);
    return true;
  }
  /* §F6 연료 12 소모 — the SHELL's own price, on top of whatever the press itself burned as stream ticks
   * (spend() charges one per tick, as it does for every hold weapon). It refuses rather than half-firing
   * when the tank cannot pay for it. */
  function spendFuel(n) {
    const W = WEAPONS.flame;
    if (debug.infiniteAmmo || W.mag == null) return true;
    const have = state.ammo.flame || 0;
    if (have < n) return false;
    state.ammo.flame = Math.max(0, have - n);
    if (state.ammo.flame <= 0) state.pendingReload = 'flame';
    updateAmmoHud();
    return true;
  }

  /* ── §F1 the tick ────────────────────────────────────────────────────────────────────────────── */
  function burnStep() {
    burnTimer = 0;
    if (!state.active) { clearBurning(); return; }
    burnTicks++;
    const t = now(), dt = BURN_TICK_MS / 1000;
    for (const [el, rec] of Array.from(burning)) {
      if (!burnAlive(el)) { burning.delete(el); burnDropFlames(rec); burnUntint(el, rec); continue; }
      const r = rectOf(el);
      if (r && r.width >= 1 && r.height >= 1) {
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        /* THE §B2 LINE. The element burns whatever it is; only the DAMAGE asks whether it may be hurt.
         * An invulnerable element just chars, and the moment the fire has reached an enemy it bites —
         * which is the whole indirect-attack route §B2 is paying for. */
        if (damageable(el)) {
          applyHit(el, Math.max(1, Math.round((BURN_DOT_BASE + rec.stacks * BURN_DOT_PER_STACK) * dt)), 'gun', cx, cy, { burnt: true, aoe: true, noVs: true, toward: { x: cx, y: cy } });   /* SPEC-weapon-identity §C3: 불은 요소에 붙어 있는 것이지 지금 든 무기가 쏘는 것이 아니다 — 등급 계수를 곱하지 않는다 (MINIMAL EDIT, 보고에 적었다) */
          if (!burning.has(el)) continue;   // the tick finished it off
        }
        if (!reducedMotion() && state.fire.length < particleCap()) spawnFire(cx + rand(-r.width / 3, r.width / 3), cy + rand(-r.height / 3, r.height / 3), 1);
        // §F3: 연기가 피어오른다 — 요소당 초당 1.5개
        rec.smokeDebt += BURN_SMOKE_PER_S * dt;
        while (rec.smokeDebt >= 1) { rec.smokeDebt -= 1; smokePuff(cx + rand(-r.width / 4, r.width / 4), r.bottom - 4); }
        burnFlames(el, rec);
        burnChar(el, rec);
        if (rec.stacks >= BURN_SPREAD_MIN && t - rec.spreadAt >= scaleMs(BURN_SPREAD_MS)) { rec.spreadAt = t; burnSpread(el, rec, r); }
      }
      // §F4 상호작용 표: 빙결 ↔ 불은 서로 상쇄하고, 불 → 젖음 은 2배 속도로 마른다
      const ch = chilled.get(el);
      if (ch) {
        if (ch.frozen > 0) { const melt = BURN_FREEZE_RATE * dt; ch.frozen = Math.max(0, ch.frozen - melt); rec.stacks -= melt; }
        if (ch.wet > 0) ch.wet = Math.max(0, ch.wet - BURN_DRY_MUL * BURN_TICK_MS);
      }
      rec.stacks -= BURN_DECAY * dt;                      // §F1: 자연 감소 초당 6
      rec.lastTickAt = t; rec.ticked = true;
      if (rec.stacks < BURN_MIN) { burning.delete(el); burnDropFlames(rec); burnUntint(el, rec); continue; }
      burnTint(el, rec);
    }
    poolStep(dt);
    burnAudioSync();
    /* armBurn(), never a bare later(): igniteEl() can run DURING this tick (a spread, a fire pool) and it
     * arms the next one itself. Assigning `burnTimer` here would overwrite that handle and leave the first
     * timer running untracked — two burn chains, double damage and double decay. That is exactly what the
     * §F1 assertions caught: 100 스택이 1초에 20을 주고 16초가 아니라 8초 만에 꺼졌다. */
    if (burning.size || pools.length) { armBurn(); kick(); }
  }

  /* §5 debug hooks: what is on fire, how hot, and whether the thing burning is the enemy or a wall. */
  debug.burning = () => Array.from(burning, ([el, rec]) => ({
    tag: tagOf(el).toUpperCase(), id: el.id || null, stacks: Math.round(rec.stacks), hostile: hostileUnit(el), ticked: !!rec.ticked,
    igniter: rec.igniter, flames: !!(rec.node && rec.node.isConnected), filter: (() => { try { return el.style.getPropertyValue('filter') || ''; } catch (e) { return ''; } })()
  }));
  debug.ignite = (el, stacks) => { const r = igniteEl(el, stacks == null ? 60 : +stacks); return r ? Math.round(r.stacks) : null; };
  debug.douse = (el, stacks) => douseEl(el, stacks == null ? BURN_WATER_STACKS : +stacks);
  /* Put every fire on the page out at once, the way a bucket of water would — the read-back a test needs to
   * ask "and when the fire IS out, is there anything left?" without tearing the whole session down. */
  debug.douseAll = () => { let n = 0; for (const el of Array.from(burning.keys())) { if (extinguish(el)) n++; } return n; };
  /* §F4's two step-8 states, drivable now so the interaction table is real code rather than a promise. */
  debug.setWet = (el, ms) => { if (!el) return null; const c = chillOf(el); c.wet = ms == null ? 8000 : +ms; return c.wet; };
  debug.setFrozen = (el, level) => { if (!el) return null; const c = chillOf(el); c.frozen = clamp(level == null ? BURN_FROZEN_FULL : +level, 0, BURN_FROZEN_FULL); return c.frozen; };
  debug.chillOf = (el) => { const c = el && chilled.get(el); return c ? { wet: Math.round(c.wet), frozen: Math.round(c.frozen) } : null; };
  debug.burnStats = () => ({ count: burning.size, cap: burnCap(), pools: pools.length, sparks: burnSpark, ticks: burnTicks, timer: !!burnTimer, audio: burnAudio() });
  debug.firePools = () => pools.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), r: p.r, msLeft: Math.max(0, Math.round(p.until - now())) }));
  debug.firebomb = (x, y) => throwFireBomb(+x, +y);
  debug.burnConst = () => ({
    tickMs: BURN_TICK_MS, dotBase: BURN_DOT_BASE, dotPerStack: BURN_DOT_PER_STACK, decay: BURN_DECAY,
    max: BURN_MAX, cap: BURN_CAP, capPerf: BURN_CAP_PERF, spreadMs: BURN_SPREAD_MS, spreadMin: BURN_SPREAD_MIN,
    spreadGap: BURN_SPREAD_GAP, spreadMax: BURN_SPREAD_MAX, spreadMul: BURN_SPREAD_MUL,
    flame: BURN_FLAME_STACKS, rocket: [BURN_ROCKET_DIRECT, BURN_ROCKET_SPLASH], bomb: [BURN_BOMB_DIRECT, BURN_BOMB_SPLASH],
    laser: BURN_LASER_STACKS, blastMul: BURN_BLAST_MUL, blastSplash: BURN_BLAST_SPLASH,
    wetMul: BURN_WET_MUL, wetOut: BURN_WET_OUT, water: BURN_WATER_STACKS, freezeRate: BURN_FREEZE_RATE,
    flameTickDmg: FLAME_TICK_DMG, poolR: POOL_R, poolMs: POOL_MS, poolPerS: POOL_STACKS_PER_S,
    firebombFuel: FIREBOMB_FUEL, firebombCd: FIREBOMB_CD
  });
