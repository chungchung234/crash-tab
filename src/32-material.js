  /* ===================================================================== */
  /* 3b. Materials (SPEC-material §5)                                        */
  /*     "everything is glass" is gone. What an element is MADE OF decides     */
  /*     how it marks, how its debris falls and what it sounds like; the        */
  /*     per-weapon destruction profile stays and the material multiplies on     */
  /*     top of it (a hammer on paper is still a wedge — it just tears and       */
  /*     flutters down instead of shattering).                                   */
  /* ===================================================================== */
  const MAT_GLASS_TAGS = new Set(['img', 'picture', 'video', 'canvas', 'svg']);
  const MAT_PLASTIC_TAGS = new Set(['button', 'input', 'select', 'textarea']);
  const MAT_THIN_PX = 12;            // §5 rule 3: shorter side under 12 px is a divider / icon → metal
  const MAT_DEFAULT = 'panel';

  /* Per material: the two ink colours its marks are drawn with, the debris physics the pieces inherit
   * (gMul = gravity multiplier, hdrag = per-second horizontal velocity retention WHILE AIRBORNE, bounce =
   * restitution, flutter = the lateral sway of something light), the piece-count multiplier, the CSS filter
   * the piece wrapper carries, and the puff of particles the break throws off.
   *
   * The physics numbers are deliberately close to the single old profile (which was exactly `panel`): the
   * material changes how debris READS — paper sways and lands dead, metal skates and rings, glass is
   * numerous and brittle — without changing how long a floor takes to settle. Terminal-velocity damping on
   * the VERTICAL axis is not part of this: a sheet that floats instead of falling leaves debris hanging in
   * the viewport long after the hit, which is the opposite of the feeling §5 asks for. */
  const MATERIALS = {
    panel: {
      id: 'panel', mark: 'panel',
      ink: 'rgba(20,24,30,.76)', light: 'rgba(255,255,255,.40)',
      gMul: 1, hdrag: 0.6, bounce: 0.32, flutter: null, pieceMul: 1, extraBounce: false,
      filter: 'drop-shadow(1px 1px 0 rgba(255,255,255,.7))',
      puff: { n: [4, 7], size: [8, 16], rise: [12, 26], life: [380, 620], color: 'rgba(216,214,206,.72)', round: true }
    },
    paper: {
      id: 'paper', mark: 'paper',
      ink: 'rgba(86,72,56,.6)', light: 'rgba(255,252,244,.88)',
      gMul: 0.82, hdrag: 0.45, bounce: 0.12, flutter: { amp: 46, period: 520 }, pieceMul: 1, extraBounce: false,
      filter: '',
      puff: { n: [3, 6], size: [4, 9], rise: [10, 22], life: [520, 820], color: 'rgba(238,230,212,.8)', round: false }
    },
    glass: {
      id: 'glass', mark: 'glass',
      ink: 'rgba(15,25,35,.75)', light: 'rgba(255,255,255,.55)',
      gMul: 1.08, hdrag: 0.75, bounce: 0.30, flutter: null, pieceMul: 1.6, extraBounce: false,
      filter: 'drop-shadow(0 0 1.5px rgba(255,255,255,.9))',
      puff: { n: [5, 9], size: [2, 4], rise: [6, 16], life: [240, 420], color: 'rgba(255,255,255,.95)', round: false }
    },
    plastic: {
      id: 'plastic', mark: 'plastic',
      ink: 'rgba(28,30,36,.72)', light: 'rgba(255,255,255,.8)',
      gMul: 1, hdrag: 0.82, bounce: 0.42, flutter: null, pieceMul: 0.55, extraBounce: false,
      filter: '',
      puff: { n: [2, 4], size: [3, 6], rise: [8, 18], life: [260, 420], color: 'rgba(255,255,255,.7)', round: true }
    },
    metal: {
      id: 'metal', mark: 'metal',
      ink: 'rgba(16,20,26,.7)', light: 'rgba(226,236,252,.9)',
      gMul: 1.15, hdrag: 0.86, bounce: 0.40, flutter: null, pieceMul: 0.6, extraBounce: true,
      filter: 'drop-shadow(0 0 1px rgba(205,220,240,.85))',
      puff: { n: [3, 6], size: [2, 4], rise: [10, 24], life: [220, 380], color: 'rgba(214,230,255,.95)', round: false }
    }
  };
  const MATERIAL_IDS = ['panel', 'paper', 'glass', 'plastic', 'metal'];
  const matCache = new WeakMap();
  function matOf(name) { return MATERIALS[name] || MATERIALS[MAT_DEFAULT]; }

  /* §5 rule 1 reads "img/picture/video/canvas/svg OR an element with a background-image". The sentence it
   * exists to serve is the one right under the table — "glass is left on images and video, not on the
   * screen" — so a background that is only a GRADIENT (every other card on the web) is not a picture and
   * does not make its card glass. A real picture (url() / image-set()) does. */
  function matHasPicture(s) {
    if (!s) return false;
    const bg = s.backgroundImage;
    if (!bg || bg === 'none') return false;
    return /(^|[\s,(])(url|image-set|-webkit-image-set)\s*\(/i.test(bg);
  }
  function matRoleButton(el) {
    let role = null;
    try { role = el.getAttribute('role'); } catch (e) { role = null; }
    return role === 'button';
  }
  /* materialOf(el) — SPEC-material §5, checked in order. Cached per element: an element's material is a
   * property of what it IS, and re-reading computed styles on every bullet would cost a layout per shot. */
  function materialOf(el) {
    if (!el || el.nodeType !== 1) return MAT_DEFAULT;
    const hit = matCache.get(el);
    if (hit) return hit;
    const tag = tagOf(el);
    const s = gcs(el);
    const r = rectOf(el);
    let m = MAT_DEFAULT;
    let stable = true;
    if (MAT_GLASS_TAGS.has(tag) || matHasPicture(s)) m = 'glass';
    else if (MAT_PLASTIC_TAGS.has(tag) || tag === 'summary' || matRoleButton(el)) m = 'plastic';
    else if (tag === 'hr') m = 'metal';
    else if (r && r.width > 0 && r.height > 0 && Math.min(r.width, r.height) < MAT_THIN_PX) m = 'metal';
    else if (!r || r.width <= 0 || r.height <= 0) stable = false;   // not laid out yet: decide again next time
    else if (safe(() => textDominant(el))) m = 'paper';
    if (stable) { try { matCache.set(el, m); } catch (e) { /* ignore */ } }
    return m;
  }
  function materialAt(x, y) {
    const el = decalTargetAt(x, y);
    return el ? materialOf(el) : MAT_DEFAULT;
  }
  function materialOfPublic(el) {
    if (!el || el.nodeType !== 1) return null;
    const id = materialOf(el);
    const M = matOf(id);
    return { material: id, gravity: M.gMul, bounce: M.bounce, pieces: M.pieceMul };
  }

  /* ── the break sound (§5 column 4) ──
   * Composed from the existing voices in src/40-audio.js rather than new ones, so no audio graph changes:
   * glass = bright tinks over a high noise burst, panel = a double dull thud, paper = two noise sweeps,
   * plastic = a double square clack, metal = a sine ring with a tink on top. */
  function matSfx(mat, opts) {
    const g = (opts && opts.gain) || 1;
    if (state.muted) return;
    if (mat === 'glass') { sfx('gun', { gain: 0.45 * g }); sfx('crit', { gain: 1.2 * g }); later(() => sfx('crit', { gain: 0.6 * g }), 70); }
    else if (mat === 'paper') { sfx('whiff', { gain: 0.85 * g }); later(() => sfx('whiff', { gain: 0.45 * g }), 70); }
    else if (mat === 'plastic') { sfx('clack', { gain: 1.2 * g }); later(() => sfx('clack', { gain: 0.6 * g }), 45); }
    else if (mat === 'metal') { sfx('alert', { gain: 0.5 * g }); sfx('crit', { gain: 0.6 * g }); later(() => sfx('alert', { gain: 0.22 * g }), 110); }
    else { sfx('thump', { gain: 1.05 * g, pitch: 0.82 }); later(() => sfx('thump', { gain: 0.45 * g, pitch: 0.72 }), 60); }
  }

  /* ── the puff a break throws off (§5: panel = dust, glass = sparkle, paper = fibres, metal = sparks) ──
   * Plain fading divs in our own root, capped, tracked, and swept by clearCanvas() — restore() cancels every
   * animation, so the nodes are removed by hand there rather than by the finish handler. */
  const MATFX_CAP = 40;
  const matFx = [];
  function clearMatFx() {
    for (const n of matFx) { try { n.remove(); } catch (e) { /* ignore */ } }
    matFx.length = 0;
  }
  function matBurst(mat, x, y) {
    if (!root || reducedMotion()) return;
    const P = matOf(mat).puff;
    if (!P) return;
    const n = randInt(P.n[0], P.n[1]);
    for (let i = 0; i < n; i++) {
      const s = rand(P.size[0], P.size[1]);
      const node = mk('div', 'crs-matfx');
      node.style.left = px(x + rand(-14, 14) - s / 2);
      node.style.top = px(y + rand(-14, 14) - s / 2);
      node.style.width = px(s); node.style.height = px(s);
      node.style.borderRadius = P.round ? '50%' : '1px';
      node.style.background = P.color;
      if (P.round) node.style.filter = 'blur(1.5px)';
      root.append(node);
      matFx.push(node);
      while (matFx.length > MATFX_CAP) { const old = matFx.shift(); try { old.remove(); } catch (e) { /* ignore */ } }
      const kill = () => { try { node.remove(); } catch (e) { /* ignore */ } const k = matFx.indexOf(node); if (k >= 0) matFx.splice(k, 1); };
      const dur = rand(P.life[0], P.life[1]);
      try {
        const a = trackAnim(node.animate([
          { transform: 'translate(0px, 0px) scale(1)', opacity: 0.95 },
          { transform: 'translate(' + px(rand(-18, 18)) + ', ' + px(-rand(P.rise[0], P.rise[1])) + ') scale(' + rand(0.3, 0.8).toFixed(2) + ')', opacity: 0 }
        ], { duration: dur, easing: 'ease-out', fill: 'forwards' }));
        a.addEventListener('finish', kill);
      } catch (e) { /* ignore */ }
      later(kill, dur + 300);
    }
  }

  /* Debris physics a piece inherits from the element it came off (§5 column 3), read by addPiece()/tickFrame(). */
  function matPieceProps(mat) {
    const M = matOf(mat);
    return { mat: M.id, gMul: M.gMul, hdrag: M.hdrag, bounce: M.bounce, flutter: M.flutter, matFilter: M.filter, extraBounce: M.extraBounce };
  }
  debug.materialOf = (el) => materialOfPublic(el);
  debug.materialAt = (x, y) => {
    const el = decalTargetAt(+x, +y);
    if (!el) return null;
    return { tag: tagOf(el).toUpperCase(), id: el.id || null, material: materialOf(el) };
  };
