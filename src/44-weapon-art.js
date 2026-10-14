// ── SPEC-weapon-art: ten weapons, two LODs, layered gradient SVG built node by node with createElementNS ──
  /* ===================================================================== */
  /* 5b. Weapon art (SPEC-weapon-art §1 / §2)                               */
  /*                                                                        */
  /* No binary assets ship: every weapon picture is an <svg> built with      */
  /* document.createElementNS and setAttribute, so it survives a strict CSP  */
  /* / Trusted-Types page exactly like the rest of the overlay, scales to    */
  /* any size and takes the theme colours straight from ART.                 */
  /*                                                                        */
  /* §1 art direction, applied to all ten so they read as ONE set:           */
  /*   · light fixed at the top-left 45°: every gradient runs light → dark   */
  /*     from the top-left face to the bottom-right face;                    */
  /*   · three tones per material (ART below), never a flat fill on a big    */
  /*     surface;                                                            */
  /*   · a 2–3 px dark SEAM wherever two parts meet, and a 1 px RIM light    */
  /*     along every upward-facing edge — that pair alone is what turns a    */
  /*     silhouette into a solid;                                            */
  /*   · cylinders (barrels, tanks, launch tubes) get cyl(), a four-stop     */
  /*     across-the-axis ramp, never a flat rectangle;                       */
  /*   · NO outline strokes anywhere. Contour comes from value difference    */
  /*     only; a stroked contour is the fastest way back to looking like an  */
  /*     emoji. Nothing in this file calls setAttribute('stroke', …).        */
  /*                                                                        */
  /* §2 two LODs, because a 24 px HUD button is not a small 200 px picture:  */
  /*   detail  viewBox 0 0 240 140, 25–45 elements, used at 64 px and up;    */
  /*   icon    viewBox 0 0 48 48,    6–12 elements, DRAWN FRESH — the shapes */
  /*           that survive at 24 px are chosen by hand, not by scaling.     */
  /* ===================================================================== */

  /* Three tones per material: [lit face, body, shadow face]. §1's palette. */
  const ART = {
    metal:  ['#d4dae4', '#8e97a6', '#3f4654'],   // steel: heads, slides, receivers
    blade:  ['#e8edf5', '#b9c2d0', '#6d7788'],   // polished edge: katana, axe bit
    wood:   ['#a9794e', '#8b6240', '#5a3f28'],   // hafts, stocks, crates
    rubber: ['#4a4f58', '#33373e', '#1e2127'],   // grips, hoses, polymer
    brass:  ['#e6c87e', '#c8a24a', '#7f6322'],   // tsuba, fittings, cartridges
    accent: ['#ff7a7d', '#e5484d', '#86232a'],   // the one hot colour: warheads, plungers
    hot:    ['#ffe08a', '#ffb224', '#e5484d'],   // flame / spark core
    dark:   ['#3a4049', '#262a31', '#14171c'],   // near-black bodies, bores, holes
    gloss:  ['#f6fafe', '#f2f6fd', '#ffe9b0']    // specular whites: ground edges, flame core
  };
  /* Flat helpers for the 1–3 px slivers that do the modelling. */
  const RIM = 'rgba(255,255,255,.55)';           // §1 림 라이트
  const RIM2 = 'rgba(255,255,255,.3)';
  const SEAM = 'rgba(0,0,0,.42)';                // §1 접합부 음영
  const SEAM2 = 'rgba(0,0,0,.24)';
  const VB_DETAIL = '0 0 240 140';
  const VB_ICON = '0 0 48 48';
  const DETAIL_MIN = 64;                         // §2: size >= 64 picks `detail` when no lod is given

  function svgNode(tag, attrs) {
    const n = doc.createElementNS(SVG_NS, tag);
    if (attrs) for (const k of Object.keys(attrs)) n.setAttribute(k, String(attrs[k]));
    return n;
  }
  function artRect(x, y, w, h, fill, r, extra) {
    const a = { x, y, width: w, height: h, fill };
    if (r) { a.rx = r; a.ry = r; }
    if (extra) Object.assign(a, extra);
    return svgNode('rect', a);
  }
  function artPath(d, fill, extra) {
    const a = { d, fill };
    if (extra) Object.assign(a, extra);
    return svgNode('path', a);
  }
  function artCircle(cx, cy, r, fill, extra) {
    const a = { cx, cy, r, fill };
    if (extra) Object.assign(a, extra);
    return svgNode('circle', a);
  }
  function artEllipse(cx, cy, rx, ry, fill, extra) {
    const a = { cx, cy, rx, ry, fill };
    if (extra) Object.assign(a, extra);
    return svgNode('ellipse', a);
  }
  /* "M x,y L x,y … Z" from a point list — every polygon in this file goes through here. */
  function poly(pts, fill, extra) {
    let d = '';
    for (let i = 0; i < pts.length; i++) d += (i ? ' L' : 'M') + pts[i][0] + ',' + pts[i][1];
    return artPath(d + ' Z', fill, extra);
  }

  /* Gradient ids are DOCUMENT-global, and ten weapon buttons live in the HUD at once, so every drawing mints
   * its own. artCtx() hands each builder a tiny palette whose methods return `url(#…)` and lazily fill the
   * <defs> node the svg is assembled around. */
  let artSeq = 0;
  function artCtx() {
    const defs = svgNode('defs');
    const uid = 'crsa' + (++artSeq);
    const cache = new Map();
    function ref(key, make) {
      let r = cache.get(key);
      if (r) return r;
      const id = uid + '_' + cache.size;
      defs.append(make(id));
      r = 'url(#' + id + ')';
      cache.set(key, r);
      return r;
    }
    function ramp(n, list) {
      for (const s of list) n.append(svgNode('stop', { offset: s[0], 'stop-color': s[1] }));
      return n;
    }
    /* dir: 'd' top-left → bottom-right (the default 45° key light), 'v' top → bottom, 'h' left → right. */
    function axis(dir) {
      if (dir === 'v') return { x1: 0, y1: 0, x2: 0, y2: 1 };
      if (dir === 'h') return { x1: 0, y1: 0, x2: 1, y2: 0 };
      if (dir === 'r') return { x1: 1, y1: 0, x2: 0, y2: 1 };     // top-right → bottom-left
      return { x1: 0, y1: 0, x2: 1, y2: 1 };
    }
    return {
      defs,
      /* Flat three-tone ramp for a planar face. */
      mat(name, dir) {
        const p = ART[name] || ART.metal, d = dir || 'd';
        return ref('m' + name + d, (id) => ramp(svgNode('linearGradient', Object.assign({ id }, axis(d))),
          [[0, p[0]], [0.44, p[1]], [1, p[2]]]));
      },
      /* §1 원통 표현: a four-stop ramp ACROSS the axis — dark edge, hot band, body, dark edge. */
      cyl(name, dir) {
        const p = ART[name] || ART.metal, d = dir || 'v';
        return ref('c' + name + d, (id) => ramp(svgNode('linearGradient', Object.assign({ id }, axis(d))),
          [[0, p[1]], [0.18, p[0]], [0.55, p[1]], [1, p[2]]]));
      },
      /* A glow for flame / spark cores. */
      glow(name) {
        const p = ART[name] || ART.hot;
        return ref('g' + name, (id) => ramp(svgNode('radialGradient', { id, cx: 0.4, cy: 0.35, r: 0.75 }),
          [[0, p[0]], [0.5, p[1]], [1, p[2]]]));
      }
    };
  }

  /* A rotated drawing frame: fr(a, b) maps "a along the axis, b across it (positive = down-right)" into
   * viewBox coordinates. The three melee weapons are composed in one of these so the haft/head proportions
   * of §7 are written as the numbers the spec states instead of being reverse-engineered from a diagonal. */
  function frame(x0, y0, deg) {
    const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
    return (a, b) => [Math.round((x0 + a * c - b * s) * 10) / 10, Math.round((y0 + a * s + b * c) * 10) / 10];
  }

  /* ===================================================================== */
  /* The ten weapons. Each entry is { detail(c), icon(c) } and returns its   */
  /* shapes back-to-front. `c` is the artCtx() palette for THAT drawing.     */
  /* data-part marks the features §7–§8 and test/e2e.js measure.            */
  /* ===================================================================== */
  /* ===================================================================== */
  /* The ten weapons. Each entry is { detail(c), icon(c) } and returns its   */
  /* shapes back-to-front. `c` is the artCtx() palette for THAT drawing.     */
  /* data-part marks the features §7–§8 and test/e2e.js measure.            */
  /*                                                                        */
  /* The three melee weapons share one composition rule learned the hard     */
  /* way: the head is set ACROSS the haft, not along it. A head drawn along  */
  /* the haft axis is a sledge or a cleaver no matter what is carved into    */
  /* it, and that is exactly what the first pass of this rework produced.    */
  /* ===================================================================== */
  const WEAPON_ART = {

    /* ───────── 망치 · claw hammer (§7.2) ─────────
     * Haft 130 of the 195 overall = 67 % (§7.1: 62–68 %). The head crosses the haft at 72°: the striking
     * face points down-forward, the claw hooks up-back and then down, well clear of the haft, and the V
     * slot between the two tines runs 0.69 of claw length (§7.2-3 wants ≥ 0.60). */
    hammer: {
      detail: (c) => [
        /* haft: butt (54,128) → eye (164,58), 10.8 thick = 22 % of the 48-high head (§7.1) */
        poly([[50.8, 123], [161.1, 53.4], [166.9, 62.6], [57.2, 133]], c.mat('wood', 'd'), { 'data-part': 'haft' }),
        poly([[50.8, 123], [161.1, 53.4], [162.6, 55.8], [52.3, 125.4]], RIM2),
        poly([[55.7, 130.6], [165.4, 60.2], [166.9, 62.6], [57.2, 133]], SEAM2),
        poly([[62, 118.4], [150, 62.9], [151, 64.5], [63, 120]], 'rgba(255,255,255,.07)'),
        poly([[66, 125.6], [154, 70.1], [154.8, 71.4], [66.8, 126.9]], 'rgba(0,0,0,.12)'),
        poly([[50.8, 123], [81.3, 103.9], [87.5, 113.5], [57.2, 133]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        poly([[50.8, 123], [81.3, 103.9], [82.6, 106], [52.1, 125.1]], RIM2),
        poly([[46.8, 124.2], [55.3, 118.9], [62.9, 130.7], [54.4, 136]], c.mat('rubber', 'v')),
        poly([[46.8, 124.2], [55.3, 118.9], [56.4, 120.6], [47.9, 125.9]], RIM2),
        /* claw: back and down off the head's rear, outer radius ≈ 0.8 × head height (§7.2-3) */
        artPath('M161.5,39.1 Q124,18 109.8,29.6 L123.2,44.4 Q132,33 144.9,59.1 Z', c.mat('metal', 'r'), { 'data-part': 'claw' }),
        artPath('M161.5,39.1 Q124,18 109.8,29.6 L112.6,32.7 Q126.5,22.5 159.4,41.7 Z', RIM),
        /* the V slot: 8 across at the tips, pointed, 0.62 of claw length deep (§7.2-3 floor is 0.60) */
        artPath('M113.8,34 Q126,24 145,42.5 Q132,35 119.2,40 Z', ART.dark[2], { 'data-part': 'notch' }),
        artPath('M119.2,40 Q132,35 145,42.5 Q133.5,37.6 121,42.3 Z', SEAM),
        artPath('M123.2,44.4 Q132,33 144.9,59.1 L142.2,60.3 Q130.5,36.5 121.6,46 Z', 'rgba(255,255,255,.18)'),
        /* collar: a ring around the haft under the eye, not a wedge beside it (§7.1) */
        poly([[130.7, 69.6], [145.4, 59.2], [155, 74.4], [139.3, 83.2]], c.mat('metal', 'v'), { 'data-part': 'collar' }),
        poly([[130.7, 69.6], [145.4, 59.2], [146.9, 61.5], [132.1, 71.9]], RIM),
        poly([[137.8, 80.8], [153.6, 72], [155, 74.4], [139.3, 83.2]], SEAM),
        /* head: eye block → waisted neck → convex face, axis 72° across the haft */
        poly([[168.5, 30.6], [188.1, 57.1], [198.6, 69.4], [209.4, 78.3], [202.6, 89.8], [192.6, 98.7], [181.8, 89.8], [167.7, 81.7], [137.9, 67.6]], c.mat('metal', 'd'), { 'data-part': 'head' }),
        poly([[168.5, 30.6], [188.1, 57.1], [198.6, 69.4], [196.3, 71.9], [185.5, 59.3], [165.9, 33]], RIM),
        poly([[167.7, 81.7], [181.8, 89.8], [192.6, 98.7], [189.8, 100.9], [179.5, 92.3], [165.6, 84]], SEAM2),
        poly([[165.9, 33], [185.5, 59.3], [196.3, 71.9], [194.5, 73.9], [183.7, 61.2], [164.2, 35.2]], 'rgba(255,255,255,.14)'),
        poly([[209.4, 78.3], [202.6, 89.8], [192.6, 98.7], [194.5, 100.5], [204.5, 91.5], [211.2, 80]], SEAM2),
        /* neck waist: the narrow section 30 % of head length behind the face (§7.2-2) */
        poly([[188.3, 59.9], [195.8, 66.6], [178.4, 87.6], [170.5, 81.5]], 'rgba(0,0,0,.15)'),
        /* striking face: a short cylinder section, 26 across = 55 % of head height (§7.2-1) */
        poly([[198, 68.7], [199.9, 70.3], [182.9, 90.9], [181, 89.3]], SEAM),
        artPath('M198.6,69.4 L209.4,78.3 Q207.2,85.4 192.6,98.7 L181.8,89.8 Q195,78 198.6,69.4 Z', c.cyl('blade', 'r'), { 'data-part': 'face' }),
        poly([[198.6, 69.4], [209.4, 78.3], [207.4, 80.8], [196.8, 71.9]], RIM),
        /* eye wedge across the collar */
        poly([[139.2, 68.9], [146.6, 63.7], [151.5, 71.5], [144.3, 76.2]], SEAM2)
      ],
      /* 48 × 48: face, the claw V, the haft. Drawn fresh at this scale — nothing else survives 24 px. */
      icon: (c) => [
        poly([[6.3, 42.6], [31.3, 13.6], [34.7, 16.4], [9.7, 45.4]], c.mat('wood', 'd'), { 'data-part': 'haft' }),
        poly([[6.3, 42.6], [31.3, 13.6], [32.5, 14.6], [7.5, 43.6]], RIM2),
        poly([[6.3, 42.6], [15, 32.5], [18.4, 35.3], [9.7, 45.4]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        artPath('M26.8,10.9 Q14,5 9.3,12.2 L13.7,15 Q17,11 24,17.3 Z', c.mat('metal', 'r'), { 'data-part': 'claw' }),
        artPath('M10.8,13.2 Q15,8 20.5,12.5 Q16,11.5 12.2,14 Z', ART.dark[2], { 'data-part': 'notch' }),
        poly([[15.4, 30.5], [20.3, 24.2], [25.7, 29], [20.2, 34.7]], c.mat('metal', 'v'), { 'data-part': 'collar' }),
        poly([[28.3, 7.2], [37.1, 14.4], [44.5, 17.5], [41.3, 25.3], [33.9, 22.2], [22.5, 21]], c.mat('metal', 'd'), { 'data-part': 'head' }),
        poly([[37.1, 14.4], [44.5, 17.5], [41.3, 25.3], [33.9, 22.2]], c.cyl('metal', 'r'), { 'data-part': 'face' }),
        poly([[28.3, 7.2], [37.1, 14.4], [36.2, 15.8], [27.4, 8.6]], RIM)
      ]
    },

    /* ───────── 도끼 · fire axe (§7.3) ─────────
     * Haft 152 — 16 % longer than the hammer's — of 219 overall = 69 %. The bit is ONE A command of radius
     * 55 sweeping 52°, inside §7.3-1's 45–60° band and nothing like the ~150° fan it replaces. The body
     * tapers 48 → 22 into the eye (1 : 0.45, §7.3-2) and the back pick, 0.6 × head height, breaks the
     * silhouette so the axe is still an axe at 24 px (§7.3-3). */
    axe: {
      detail: (c) => [
        /* haft: butt (40,134) → eye (168,52) */
        poly([[36.8, 128.9], [164.8, 46.9], [171.2, 57.1], [43.2, 139.1]], c.mat('wood', 'd'), { 'data-part': 'haft' }),
        poly([[36.8, 128.9], [164.8, 46.9], [166.4, 49.4], [38.4, 131.4]], RIM2),
        poly([[41.6, 136.6], [169.6, 54.6], [171.2, 57.1], [43.2, 139.1]], SEAM2),
        poly([[50, 124.5], [158, 55.3], [159.1, 57], [51.1, 126.2]], 'rgba(255,255,255,.07)'),
        poly([[54, 131.5], [162, 62.3], [163, 63.9], [55, 133.1]], 'rgba(0,0,0,.12)'),
        poly([[36.8, 128.9], [72.2, 106.2], [78.6, 116.4], [43.2, 139.1]], c.mat('accent', 'd'), { 'data-part': 'grip' }),
        poly([[36.8, 128.9], [72.2, 106.2], [73.6, 108.4], [38.2, 131.1]], RIM2),
        poly([[32.4, 130.1], [41.4, 124.3], [48.2, 134.9], [39.2, 140.7]], c.mat('rubber', 'v')),
        poly([[32.4, 130.1], [41.4, 124.3], [42.5, 126], [33.5, 131.8]], RIM2),
        /* pick: 35 long (0.74 × head height), tapering to a point and hooking down, 32 clear of the haft (§7.3-3) */
        artPath('M175,43.5 L140.5,27.5 Q134.5,30.5 137,37.5 L166.1,54.3 Z', c.mat('metal', 'r'), { 'data-part': 'pick' }),
        artPath('M175,43.5 L140.5,27.5 Q137.3,29.1 136.4,32.4 L173,46.3 Z', RIM),
        artPath('M137,37.5 L166.1,54.3 L163.6,55.6 L136.2,39.6 Z', SEAM),
        /* collar wrapping the haft under the eye */
        poly([[152.4, 72.4], [167.9, 62.4], [176.2, 76.1], [160.5, 85.4]], c.mat('metal', 'v'), { 'data-part': 'collar' }),
        poly([[152.4, 72.4], [167.9, 62.4], [169.4, 64.7], [153.9, 74.7]], RIM),
        poly([[159, 83], [174.8, 73.7], [176.2, 76.1], [160.5, 85.4]], SEAM),
        poly([[155.3, 76.9], [171, 67.3], [172, 69], [156.3, 78.6]], 'rgba(255,255,255,.12)'),
        poly([[166.1, 54.3], [175, 43.5], [177.6, 46.6], [168.3, 57.5]], SEAM2),
        /* body: taper 1 : 0.45 from the edge chord into the eye (§7.3-2) */
        artPath('M174.9,43.6 L223.8,66.6 A55,55 0 0 1 193.2,103.9 L161.1,60.4 Z', c.mat('metal', 'd'), { 'data-part': 'body' }),
        poly([[174.9, 43.6], [223.8, 66.6], [222.5, 69.3], [173.7, 46.4]], RIM),
        poly([[174.9, 43.6], [198.3, 56.1], [177.9, 80.9], [161.1, 60.4]], 'rgba(0,0,0,.16)'),
        /* bit: the forward crescent carrying the ground edge */
        artPath('M215,64.6 A46,46 0 0 1 189.4,95.7 L193.2,103.9 A55,55 0 0 0 223.8,66.6 Z', c.cyl('blade', 'r'), { 'data-part': 'bit' }),
        artPath('M220.9,65.9 A52,52 0 0 1 191.9,101.2 L193.2,103.9 A55,55 0 0 0 223.8,66.6 Z', ART.gloss[0], { 'data-part': 'edgeline' }),
        poly([[215, 64.6], [189.4, 95.7], [186.2, 92.3], [212, 61.1]], 'rgba(0,0,0,.13)'),
        artCircle(192, 64, 2.6, 'rgba(0,0,0,.26)'),
        /* wedge pin through the eye */
        artCircle(168, 52, 3.2, ART.dark[2])
      ],
      /* 48 × 48: the 52° bit, the taper, the pick, the haft. The pick is what keeps it off the hammer. */
      icon: (c) => [
        poly([[5.3, 43.6], [29.3, 15.6], [32.7, 18.4], [8.7, 46.4]], c.mat('wood', 'd'), { 'data-part': 'haft' }),
        poly([[5.3, 43.6], [29.3, 15.6], [30.5, 16.6], [6.5, 44.6]], RIM2),
        poly([[5.3, 43.6], [13.5, 34], [16.9, 36.8], [8.7, 46.4]], c.mat('accent', 'd'), { 'data-part': 'grip' }),
        artPath('M29.3,12.9 L19.5,10.5 Q16,12.5 17.5,16.2 L27.6,16.9 Z', c.mat('metal', 'r'), { 'data-part': 'pick' }),
        poly([[13.2, 33.1], [18.1, 26.9], [23.3, 31.3], [17.8, 37.1]], c.mat('metal', 'v'), { 'data-part': 'collar' }),
        artPath('M29.3,13 L46.8,16 A16.5,16.5 0 0 1 41.2,29.4 L26.7,19 Z', c.mat('metal', 'd'), { 'data-part': 'body' }),
        artPath('M43.8,16.2 A13.5,13.5 0 0 1 39.2,27.1 L41.2,29.4 A16.5,16.5 0 0 0 46.8,16 Z', c.cyl('blade', 'r'), { 'data-part': 'bit' }),
        poly([[29.3, 13], [46.8, 16], [46.5, 17.6], [29, 14.6]], RIM)
      ]
    },

    /* ───────── 카타나 · katana (§8.2) ─────────
     * Curvature is the identity: the spine is one quadratic whose control point sits 14.3 off the chord,
     * giving a sagitta of 7.2 on a 158-long blade — the 1/22 §8.2 asks for, and the reason a reader calls
     * this a katana rather than a sword. Twelve hamon arcs, a round tsuba, a diamond-wrapped tsuka. */
    katana: {
      detail: (c) => {
        const out = [];
        const P0 = [76, 92], CP = [142.2, 46.9], P2 = [220, 28];
        const qp = (t) => { const u = 1 - t; return [u * u * P0[0] + 2 * t * u * CP[0] + t * t * P2[0], u * u * P0[1] + 2 * t * u * CP[1] + t * t * P2[1]]; };
        const qn = (t) => {
          const u = 1 - t;
          const dx = 2 * u * (CP[0] - P0[0]) + 2 * t * (P2[0] - CP[0]);
          const dy = 2 * u * (CP[1] - P0[1]) + 2 * t * (P2[1] - CP[1]);
          const m = Math.sqrt(dx * dx + dy * dy) || 1;
          return [-dy / m, dx / m, dx / m, dy / m];        // [nx, ny, tx, ty] — n points to the EDGE side
        };
        const wid = (t) => 15 - 4 * t;                      // single-edged: thick at the base, fine at the tip
        const at = (t, f) => { const p = qp(t), n = qn(t), w = wid(t) * f; return [p[0] + n[0] * w, p[1] + n[1] * w]; };
        const f2 = (p) => p[0].toFixed(1) + ',' + p[1].toFixed(1);
        const N = 12;
        const nt = qn(1);
        const TIP = [qp(1)[0] + nt[2] * 15, qp(1)[1] + nt[3] * 15];
        /* --- blade body --- */
        let d = 'M' + f2(at(0, 0));
        for (let i = 1; i <= N; i++) d += ' L' + f2(at(i / N, 0));
        d += ' L' + f2(TIP);
        for (let i = N; i >= 0; i--) d += ' L' + f2(at(i / N, 1));
        out.push(artPath(d + ' Z', c.mat('blade', 'd'), { 'data-part': 'blade' }));
        /* --- spine: one literal Q, so the curvature is readable straight off the path data --- */
        out.push(artPath('M' + f2(P0) + ' Q' + f2(CP) + ' ' + f2(P2) +
          ' L' + f2(at(1, 0.26)) + ' Q143.6,50 ' + f2(at(0, 0.26)) + ' Z', c.mat('metal', 'h'), { 'data-part': 'spine' }));
        out.push(artPath('M' + f2(P0) + ' Q' + f2(CP) + ' ' + f2(P2) +
          ' L' + f2(at(1, 0.07)) + ' Q142.6,47.7 ' + f2(at(0, 0.07)) + ' Z', RIM));
        /* --- hamon: 12 shallow wave arcs down the edge side (§8.2) --- */
        for (let i = 0; i < 12; i++) {
          const t0 = i / 12, t1 = (i + 1) / 12, tm = (t0 + t1) / 2;
          const fa = 0.50 + (i % 2 ? 0.08 : -0.04), fb = fa + 0.17;
          out.push(artPath('M' + f2(at(t0, fa)) + ' Q' + f2(at(tm, fa - 0.14)) + ' ' + f2(at(t1, fa)) +
            ' L' + f2(at(t1, fb)) + ' Q' + f2(at(tm, fb - 0.14)) + ' ' + f2(at(t0, fb)) + ' Z',
            'rgba(255,255,255,.35)', { 'data-part': 'hamon' }));
        }
        /* --- the ground edge: a bright band along the bottom of the blade --- */
        let de = 'M' + f2(at(0, 0.82));
        for (let i = 1; i <= N; i++) de += ' L' + f2(at(i / N, 0.82));
        de += ' L' + f2(TIP);
        for (let i = N; i >= 0; i--) de += ' L' + f2(at(i / N, 1));
        out.push(artPath(de + ' Z', ART.gloss[1], { 'data-part': 'edge' }));
        /* kissaki: the point gets its own facet */
        out.push(poly([[qp(1)[0], qp(1)[1]], [TIP[0], TIP[1]], [at(1, 1)[0], at(1, 1)[1]]], c.mat('blade', 'r'), { 'data-part': 'kissaki' }));
        /* --- habaki (brass collar) --- */
        out.push(poly([[70, 95], [82, 89], [87, 99], [75, 105]], c.mat('brass', 'd'), { 'data-part': 'habaki' }));
        out.push(poly([[70, 95], [82, 89], [83, 91], [71, 97]], RIM));
        /* --- tsuba: small round disc with a centre hole (§8.2) --- */
        out.push(artEllipse(68, 99, 7.5, 14, c.mat('brass', 'd'), { 'data-part': 'tsuba' }));
        out.push(artPath('M60.5,99 A7.5,14 0 0 1 64.5,86.8 L66,88.6 A5.9,11.8 0 0 0 62.6,99 Z', RIM));
        out.push(artEllipse(68, 99, 2.6, 5.2, ART.dark[2]));
        /* --- tsuka: 10 crossed wraps = the diamond lattice (§8.2) --- */
        const gf = (a, b) => [18 + 0.895 * a + 0.447 * b, 122 - 0.447 * a + 0.895 * b];
        out.push(poly([gf(0, -7.5), gf(57, -7.5), gf(57, 7.5), gf(0, 7.5)], c.mat('rubber', 'd'), { 'data-part': 'tsuka' }));
        out.push(poly([gf(0, -7.5), gf(57, -7.5), gf(57, -5.3), gf(0, -5.3)], RIM2));
        for (let i = 0; i < 5; i++) {
          const a0 = 2 + i * 10.6;
          out.push(poly([gf(a0, 7.5), gf(a0 + 2.8, 7.5), gf(a0 + 11.8, -7.5), gf(a0 + 9, -7.5)], 'rgba(220,228,242,.5)', { 'data-part': 'wrap' }));
          out.push(poly([gf(a0 + 9, 7.5), gf(a0 + 11.8, 7.5), gf(a0 + 2.8, -7.5), gf(a0, -7.5)], 'rgba(0,0,0,.42)', { 'data-part': 'wrap' }));
        }
        /* --- kashira: the metal butt cap --- */
        out.push(poly([gf(-6, -7.5), gf(2, -7.5), gf(2, 7.5), gf(-6, 7.5)], c.mat('brass', 'v'), { 'data-part': 'kashira' }));
        out.push(poly([gf(-6, -7.5), gf(2, -7.5), gf(2, -5.6), gf(-6, -5.6)], RIM));
        return out;
      },
      /* 48 × 48: curve, tsuba, grip. The hamon and the lattice drop; the curvature does NOT (§8.2). */
      icon: (c) => [
        artPath('M17,33 Q28,16 43,7 L46,12 Q31,22 21,38 Z', c.mat('blade', 'd'), { 'data-part': 'blade' }),
        artPath('M17,33 Q28,16 43,7 L44.2,9 Q29.5,18 18.6,34 Z', c.mat('metal', 'h'), { 'data-part': 'spine' }),
        artPath('M19.4,36.5 Q30,21 45.1,10.5 L46,12 Q31,22 21,38 Z', ART.gloss[1], { 'data-part': 'edge' }),
        artEllipse(14.5, 36.5, 4, 7.2, c.mat('brass', 'd'), { 'data-part': 'tsuba' }),
        artEllipse(14.5, 36.5, 1.4, 2.6, ART.dark[2]),
        poly([[3.5, 42], [12.5, 33.5], [16.5, 38], [7.5, 46.5]], c.mat('rubber', 'd'), { 'data-part': 'tsuka' }),
        poly([[3.5, 42], [12.5, 33.5], [13.6, 34.7], [4.6, 43.2]], RIM2),
        poly([[1.5, 43.5], [5.5, 39.7], [9.3, 44], [5.3, 47.8]], c.mat('brass', 'v'), { 'data-part': 'kashira' })
      ]
    },

    /* ───────── 권총 · semi-auto pistol (§3) ─────────
     * Slide / frame split line, raked grip, trigger guard, front and rear sights. */
    pistol: {
      detail: (c) => [
        poly([[60, 118], [100, 118], [97, 128], [57, 128]], c.mat('metal', 'v'), { 'data-part': 'magbase' }),
        poly([[74, 70], [122, 70], [102, 124], [54, 124]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        poly([[74, 70], [122, 70], [120.6, 74], [72.6, 74]], RIM2),
        artRect(72, 82, 42, 4, 'rgba(255,255,255,.1)', 2),
        artRect(68, 94, 42, 4, 'rgba(255,255,255,.1)', 2),
        artRect(64, 106, 42, 4, 'rgba(255,255,255,.1)', 2),
        poly([[66, 60], [196, 60], [196, 80], [120, 80], [112, 72], [66, 72]], c.mat('metal', 'v'), { 'data-part': 'frame' }),
        artPath('M118,70 L166,70 L166,80 A24,24 0 0 1 118,80 Z M126,76 L158,76 L158,80 A16,16 0 0 1 126,80 Z', c.mat('metal', 'd'), { 'data-part': 'guard', 'fill-rule': 'evenodd' }),
        poly([[130, 66], [142, 66], [140, 86], [132, 86]], c.mat('metal', 'r'), { 'data-part': 'trigger' }),
        poly([[64, 28], [214, 28], [222, 36], [222, 58], [64, 58]], c.mat('metal', 'd'), { 'data-part': 'slide' }),
        poly([[64, 28], [214, 28], [215.6, 30], [64, 30]], RIM),
        poly([[64, 56.4], [222, 56.4], [222, 58], [64, 58]], SEAM),
        poly([[64, 58], [196, 58], [196, 61.4], [64, 61.4]], SEAM, { 'data-part': 'split' }),
        artRect(70, 34, 5, 18, 'rgba(0,0,0,.25)', 2),
        artRect(80, 34, 5, 18, 'rgba(0,0,0,.25)', 2),
        artRect(90, 34, 5, 18, 'rgba(0,0,0,.25)', 2),
        artRect(140, 33, 40, 13, ART.dark[1], 3, { 'data-part': 'port' }),
        artRect(140, 33, 40, 3, 'rgba(0,0,0,.4)', 1.5),
        artRect(214, 36, 10, 16, c.cyl('metal', 'v'), 2, { 'data-part': 'muzzle' }),
        artCircle(219, 44, 3.4, ART.dark[2]),
        poly([[70, 20], [82, 20], [82, 28], [70, 28]], c.mat('metal', 'v'), { 'data-part': 'sight' }),
        poly([[74, 20], [78, 20], [78, 25], [74, 25]], ART.dark[2]),
        poly([[202, 20], [210, 20], [210, 28], [202, 28]], c.mat('metal', 'v')),
        poly([[56, 32], [66, 30], [66, 44], [58, 44]], c.mat('metal', 'r'), { 'data-part': 'hammer' }),
        artRect(96, 62, 30, 7, c.mat('metal', 'r'), 3, { 'data-part': 'slidestop' }),
        poly([[60, 118], [100, 118], [99, 121], [59, 121]], RIM2)
      ],
      icon: (c) => [
        poly([[14, 24], [26, 24], [20, 44], [8, 44]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        poly([[11, 22], [44, 22], [44, 29], [11, 29]], c.mat('metal', 'v'), { 'data-part': 'frame' }),
        artPath('M24,24 L36,24 L36,30 A7,7 0 0 1 24,30 Z M28,27 L32,27 L32,30 A3.4,3.4 0 0 1 28,30 Z', c.mat('metal', 'd'), { 'data-part': 'guard', 'fill-rule': 'evenodd' }),
        poly([[10, 10], [42, 10], [46, 14], [46, 22], [10, 22]], c.mat('metal', 'd'), { 'data-part': 'slide' }),
        poly([[10, 10], [42, 10], [43, 11.4], [10, 11.4]], RIM),
        artRect(13, 13, 2, 6, 'rgba(0,0,0,.3)', 1),
        artRect(17, 13, 2, 6, 'rgba(0,0,0,.3)', 1),
        artRect(41, 14, 5, 7, c.cyl('metal', 'v'), 1.5, { 'data-part': 'muzzle' })
      ]
    },

    /* ───────── 기관총 · submachine gun (§3) ─────────
     * Vertical magazine, vented barrel shroud, folding stock. */
    smg: {
      detail: (c) => [
        poly([[14, 46], [60, 42], [60, 49], [14, 53]], c.mat('metal', 'v'), { 'data-part': 'stock' }),
        poly([[14, 68], [60, 66], [60, 73], [14, 75]], c.mat('metal', 'v')),
        poly([[12, 44], [22, 44], [22, 76], [12, 76]], c.mat('metal', 'd'), { 'data-part': 'butt' }),
        poly([[12, 44], [22, 44], [22, 46.4], [12, 46.4]], RIM),
        poly([[92, 76], [118, 76], [116, 132], [94, 132]], c.mat('metal', 'v'), { 'data-part': 'mag' }),
        poly([[92, 76], [118, 76], [117.4, 80], [92.6, 80]], RIM2),
        artRect(96, 90, 16, 3, 'rgba(0,0,0,.3)', 1.5),
        artRect(96, 104, 16, 3, 'rgba(0,0,0,.3)', 1.5),
        artRect(96, 118, 16, 3, 'rgba(0,0,0,.3)', 1.5),
        poly([[52, 74], [78, 74], [70, 118], [46, 116]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        poly([[52, 74], [78, 74], [77.2, 78], [51.2, 78]], RIM2),
        poly([[46, 38], [160, 38], [160, 78], [46, 78]], c.mat('metal', 'd'), { 'data-part': 'receiver' }),
        poly([[46, 38], [160, 38], [160, 41], [46, 41]], RIM),
        poly([[46, 75], [160, 75], [160, 78], [46, 78]], SEAM),
        artRect(120, 44, 32, 12, ART.dark[1], 3, { 'data-part': 'port' }),
        artRect(158, 44, 58, 24, c.cyl('metal', 'v'), 6, { 'data-part': 'shroud' }),
        artCircle(172, 56, 5.2, ART.dark[2]),
        artCircle(188, 56, 5.2, ART.dark[2]),
        artCircle(204, 56, 5.2, ART.dark[2]),
        artRect(158, 45, 58, 2.6, RIM2, 1.3),
        artRect(214, 50, 18, 12, c.cyl('metal', 'v'), 3, { 'data-part': 'muzzle' }),
        artCircle(228, 56, 3.4, ART.dark[2]),
        poly([[58, 28], [68, 28], [68, 38], [58, 38]], c.mat('metal', 'v'), { 'data-part': 'sight' }),
        poly([[198, 32], [206, 32], [206, 44], [198, 44]], c.mat('metal', 'v')),
        artRect(84, 32, 22, 7, c.mat('metal', 'r'), 3, { 'data-part': 'charge' })
      ],
      icon: (c) => [
        poly([[3, 17], [13, 15], [13, 20], [3, 22]], c.mat('metal', 'v'), { 'data-part': 'stock' }),
        poly([[17, 28], [28, 28], [27, 46], [18, 46]], c.mat('metal', 'v'), { 'data-part': 'mag' }),
        poly([[7, 27], [16, 27], [13, 41], [5, 40]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        poly([[7, 13], [32, 13], [32, 28], [7, 28]], c.mat('metal', 'd'), { 'data-part': 'receiver' }),
        poly([[7, 13], [32, 13], [32, 15], [7, 15]], RIM),
        artRect(31, 16, 13, 9, c.cyl('metal', 'v'), 2.5, { 'data-part': 'shroud' }),
        artCircle(35, 20.5, 2, ART.dark[2]),
        artCircle(40, 20.5, 2, ART.dark[2]),
        artRect(43, 18.5, 5, 5, c.cyl('metal', 'v'), 1, { 'data-part': 'muzzle' })
      ]
    },

    /* ───────── 저격총 · bolt-action rifle (§3) ─────────
     * Long barrel, scope tube on rings, bolt handle, cheek-piece stock. */
    sniper: {
      detail: (c) => [
        poly([[6, 64], [60, 56], [60, 96], [34, 98], [10, 86]], c.mat('wood', 'd'), { 'data-part': 'stock' }),
        poly([[6, 64], [60, 56], [60, 60], [7, 68]], RIM2),
        poly([[18, 52], [62, 46], [62, 60], [18, 66]], c.mat('wood', 'd'), { 'data-part': 'cheek' }),
        poly([[18, 52], [62, 46], [62, 49], [18, 55]], RIM),
        poly([[58, 76], [82, 74], [76, 108], [54, 106]], c.mat('wood', 'd'), { 'data-part': 'grip' }),
        poly([[78, 74], [112, 74], [112, 82], [78, 82]], c.mat('metal', 'v')),
        poly([[86, 72], [94, 72], [92, 86], [86, 86]], c.mat('metal', 'r'), { 'data-part': 'trigger' }),
        poly([[96, 76], [122, 76], [120, 102], [98, 102]], c.mat('metal', 'v'), { 'data-part': 'mag' }),
        poly([[56, 50], [136, 50], [136, 78], [56, 78]], c.mat('metal', 'd'), { 'data-part': 'receiver' }),
        poly([[56, 50], [136, 50], [136, 53], [56, 53]], RIM),
        poly([[56, 75], [136, 75], [136, 78], [56, 78]], SEAM),
        poly([[104, 66], [116, 66], [128, 86], [118, 92]], c.mat('metal', 'r'), { 'data-part': 'bolt' }),
        artCircle(126, 90, 8, c.mat('metal', 'd'), { 'data-part': 'boltknob' }),
        artPath('M120,86 A8,8 0 0 1 130,84 L128,87 A5,5 0 0 0 121.6,88 Z', RIM),
        artRect(134, 56, 84, 16, c.cyl('metal', 'v'), 4, { 'data-part': 'barrel' }),
        artRect(134, 57.5, 84, 2.6, RIM2, 1.3),
        artRect(214, 52, 20, 24, c.cyl('metal', 'v'), 3, { 'data-part': 'muzzle' }),
        artRect(219, 52, 3, 24, 'rgba(0,0,0,.35)'),
        artRect(227, 52, 3, 24, 'rgba(0,0,0,.35)'),
        artRect(74, 40, 10, 14, c.mat('metal', 'v'), 2, { 'data-part': 'ring' }),
        artRect(140, 40, 10, 18, c.mat('metal', 'v'), 2, { 'data-part': 'ring' }),
        artRect(62, 14, 110, 26, c.cyl('metal', 'v'), 12, { 'data-part': 'scope' }),
        artRect(62, 16, 110, 3.6, RIM2, 1.8),
        artRect(164, 10, 22, 34, c.cyl('metal', 'v'), 6, { 'data-part': 'bell' }),
        artEllipse(180, 27, 5, 15, ART.dark[2]),
        artEllipse(178, 22, 2.4, 5, 'rgba(120,180,255,.5)'),
        artRect(100, 8, 18, 8, c.mat('metal', 'd'), 3, { 'data-part': 'turret' })
      ],
      icon: (c) => [
        poly([[2, 27], [13, 25], [13, 36], [4, 35]], c.mat('wood', 'd'), { 'data-part': 'stock' }),
        poly([[11, 28], [18, 28], [16, 42], [9, 41]], c.mat('wood', 'd'), { 'data-part': 'grip' }),
        artRect(13, 13, 3, 9, c.mat('metal', 'v'), 1, { 'data-part': 'ring' }),
        artRect(24, 13, 3, 9, c.mat('metal', 'v'), 1, { 'data-part': 'ring' }),
        poly([[9, 21], [28, 21], [28, 29], [9, 29]], c.mat('metal', 'd'), { 'data-part': 'receiver' }),
        poly([[21, 26], [25, 26], [29, 35], [25, 37]], c.mat('metal', 'r'), { 'data-part': 'bolt' }),
        artRect(27, 22.5, 20, 4, c.cyl('metal', 'v'), 2, { 'data-part': 'barrel' }),
        artRect(7, 6, 25, 8, c.cyl('metal', 'v'), 4, { 'data-part': 'scope' }),
        artRect(31, 4, 7, 12, c.cyl('metal', 'v'), 3, { 'data-part': 'bell' }),
        artEllipse(34.5, 10, 1.8, 4.6, ART.dark[2])
      ]
    },

    /* ───────── 폭탄 · pineapple grenade (§3) ─────────
     * Lattice grooves, safety lever, pin ring. */
    bomb: {
      detail: (c) => [
        artEllipse(104, 82, 46, 50, c.mat('dark', 'd'), { 'data-part': 'body' }),
        artPath('M58,82 A46,50 0 0 1 104,32 L104,39 A40,43 0 0 0 65,82 Z', RIM2),
        artPath('M60,62 Q104,52 148,62 L148,68 Q104,58 60,68 Z', 'rgba(0,0,0,.42)', { 'data-part': 'groove' }),
        artPath('M58,84 Q104,74 150,84 L150,90 Q104,80 58,90 Z', 'rgba(0,0,0,.42)', { 'data-part': 'groove' }),
        artPath('M64,106 Q104,98 144,106 L144,112 Q104,104 64,112 Z', 'rgba(0,0,0,.42)', { 'data-part': 'groove' }),
        artPath('M64,46 Q104,38 144,46 L144,52 Q104,44 64,52 Z', 'rgba(0,0,0,.42)', { 'data-part': 'groove' }),
        artPath('M70,120 Q104,114 138,120 L138,126 Q104,120 70,126 Z', 'rgba(0,0,0,.42)', { 'data-part': 'groove' }),
        poly([[81, 36], [87, 36], [87, 128], [81, 128]], 'rgba(0,0,0,.34)', { 'data-part': 'rib' }),
        poly([[119, 36], [125, 36], [125, 128], [119, 128]], 'rgba(0,0,0,.34)', { 'data-part': 'rib' }),
        artPath('M66,54 Q62,82 70,110 L75,108 Q68,82 71,56 Z', 'rgba(0,0,0,.3)', { 'data-part': 'rib' }),
        artPath('M140,56 Q144,82 136,110 L131,108 Q138,82 135,56 Z', 'rgba(0,0,0,.3)', { 'data-part': 'rib' }),
        artEllipse(104, 130, 38, 6, 'rgba(0,0,0,.3)'),
        artEllipse(82, 58, 15, 12, 'rgba(255,255,255,.09)'),
        artRect(88, 20, 32, 18, c.mat('metal', 'v'), 4, { 'data-part': 'collar' }),
        artRect(88, 21, 32, 3, RIM, 1.5),
        poly([[116, 18], [132, 22], [142, 74], [130, 76]], c.mat('metal', 'r'), { 'data-part': 'lever' }),
        poly([[116, 18], [132, 22], [131, 26], [116, 22]], RIM),
        artRect(88, 35, 32, 3.4, SEAM, 1.7),
        poly([[130, 28], [136, 30], [144, 72], [138, 73]], SEAM2),
        artEllipse(92, 46, 9, 6, 'rgba(255,255,255,.1)'),
        artRect(96, 10, 18, 12, c.mat('metal', 'd'), 3, { 'data-part': 'striker' }),
        artRect(96, 11, 18, 2.4, RIM, 1.2),
        artPath('M74,14 A18,18 0 1 0 92,-4 L92,4 A10,10 0 1 1 82,14 Z', c.mat('brass', 'd'), { 'data-part': 'ring' }),
        poly([[80, 11], [98, 11], [98, 18], [80, 18]], c.mat('brass', 'v'), { 'data-part': 'pin' }),
        poly([[80, 11], [98, 11], [98, 13], [80, 13]], RIM),
        artEllipse(76, 92, 6, 14, 'rgba(255,255,255,.06)')
      ],
      icon: (c) => [
        artEllipse(23, 29, 16, 17, c.mat('dark', 'd'), { 'data-part': 'body' }),
        artPath('M7,29 A16,17 0 0 1 23,12 L23,15 A13,14 0 0 0 10,29 Z', RIM2),
        artPath('M8,23 Q23,19 38,23 L38,25.6 Q23,21.6 8,25.6 Z', 'rgba(0,0,0,.45)', { 'data-part': 'groove' }),
        artPath('M8,34 Q23,30 38,34 L38,36.6 Q23,32.6 8,36.6 Z', 'rgba(0,0,0,.45)', { 'data-part': 'groove' }),
        poly([[20, 13], [26, 13], [26, 45], [20, 45]], 'rgba(0,0,0,.35)', { 'data-part': 'rib' }),
        artRect(18, 7, 11, 7, c.mat('metal', 'v'), 2, { 'data-part': 'collar' }),
        poly([[27, 6], [33, 8], [37, 26], [32, 27]], c.mat('metal', 'r'), { 'data-part': 'lever' }),
        artPath('M11,7 A7,7 0 1 0 18,0 L18,3.4 A3.6,3.6 0 1 1 14.4,7 Z', c.mat('brass', 'd'), { 'data-part': 'ring' })
      ]
    },

    /* ───────── 로켓 · shoulder-fired launcher (§3) ─────────
     * Launch tube, exhaust bell, optical sight, front grip. */
    rocket: {
      detail: (c) => [
        poly([[188, 44], [174, 20], [184, 18], [198, 42]], c.mat('metal', 'r'), { 'data-part': 'fin' }),
        poly([[188, 76], [174, 100], [184, 102], [198, 78]], c.mat('metal', 'r'), { 'data-part': 'fin' }),
        poly([[6, 28], [34, 46], [34, 76], [6, 94]], c.mat('metal', 'r'), { 'data-part': 'bell' }),
        poly([[6, 28], [34, 46], [34, 50], [8, 34]], RIM2),
        artEllipse(9, 61, 5, 32, ART.dark[2]),
        artRect(30, 42, 152, 38, c.cyl('metal', 'v'), 10, { 'data-part': 'tube' }),
        artRect(30, 44.5, 152, 4, RIM2, 2),
        artRect(30, 75, 152, 3.4, SEAM2, 1.7),
        artRect(56, 42, 7, 38, 'rgba(0,0,0,.22)'),
        artRect(150, 42, 7, 38, 'rgba(0,0,0,.22)'),
        artRect(96, 38, 30, 46, c.mat('rubber', 'v'), 5, { 'data-part': 'shield' }),
        artRect(96, 39, 30, 3, RIM2, 1.5),
        artRect(178, 46, 20, 30, c.cyl('metal', 'v'), 4, { 'data-part': 'body' }),
        poly([[194, 42], [236, 61], [194, 80]], c.mat('accent', 'r'), { 'data-part': 'warhead' }),
        poly([[194, 42], [236, 61], [231, 61], [194, 45.6]], RIM2),
        poly([[194, 70], [231, 61], [236, 61], [194, 80]], SEAM2),
        artRect(104, 16, 34, 14, c.mat('metal', 'd'), 3, { 'data-part': 'sight' }),
        artRect(104, 17, 34, 2.6, RIM, 1.3),
        artRect(116, 28, 10, 12, c.mat('metal', 'v'), 2),
        artEllipse(134, 23, 4, 5, 'rgba(120,180,255,.45)'),
        poly([[122, 84], [146, 84], [140, 124], [118, 122]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        poly([[122, 84], [146, 84], [145, 88], [121, 88]], RIM2),
        poly([[52, 80], [74, 80], [68, 112], [48, 110]], c.mat('rubber', 'd')),
        poly([[52, 80], [74, 80], [73, 84], [51, 84]], RIM2),
        artRect(36, 42, 5, 38, 'rgba(255,255,255,.12)'),
        artRect(168, 42, 5, 38, 'rgba(255,255,255,.12)')
      ],
      icon: (c) => [
        poly([[33, 16], [28, 6], [33, 5], [38, 15]], c.mat('metal', 'r'), { 'data-part': 'fin' }),
        poly([[3, 12], [11, 17], [11, 31], [3, 36]], c.mat('metal', 'r'), { 'data-part': 'bell' }),
        artRect(9, 17, 26, 14, c.cyl('metal', 'v'), 4, { 'data-part': 'tube' }),
        artRect(9, 18, 26, 2.4, RIM2, 1.2),
        poly([[34, 15], [47, 24], [34, 33]], c.mat('accent', 'r'), { 'data-part': 'warhead' }),
        artRect(18, 8, 12, 6, c.mat('metal', 'd'), 2, { 'data-part': 'sight' }),
        poly([[20, 31], [28, 31], [25, 45], [18, 44]], c.mat('rubber', 'd'), { 'data-part': 'grip' })
      ]
    },

    /* ───────── 화염방사기 · backpack flamethrower (§3) ─────────
     * Two fuel tanks, a corrugated hose, an igniter nozzle. */
    flame: {
      detail: (c) => {
        const out = [];
        out.push(artRect(10, 24, 42, 92, c.cyl('metal', 'h'), 20, { 'data-part': 'tank' }));
        out.push(artRect(46, 32, 34, 78, c.cyl('metal', 'h'), 16, { 'data-part': 'tank' }));
        out.push(artRect(14, 26, 7, 88, RIM2, 3.5));
        out.push(artRect(49, 34, 6, 74, RIM2, 3));
        out.push(artRect(10, 50, 70, 6, 'rgba(0,0,0,.3)', 3, { 'data-part': 'strap' }));
        out.push(artRect(10, 88, 70, 6, 'rgba(0,0,0,.3)', 3, { 'data-part': 'strap' }));
        out.push(artRect(22, 12, 14, 14, c.mat('brass', 'd'), 3, { 'data-part': 'valve' }));
        out.push(artCircle(29, 12, 7, c.mat('brass', 'v')));
        /* corrugated hose, with 7 ribs sampled off its own curve so they sit ON it (§3) */
        const H0 = [78, 54], H1 = [106, 36], H2 = [112, 94], H3 = [140, 72];
        const cub = (t) => {
          const u = 1 - t;
          return [u * u * u * H0[0] + 3 * u * u * t * H1[0] + 3 * u * t * t * H2[0] + t * t * t * H3[0],
            u * u * u * H0[1] + 3 * u * u * t * H1[1] + 3 * u * t * t * H2[1] + t * t * t * H3[1]];
        };
        out.push(artPath('M78,54 C106,36 112,94 140,72 L140,86 C112,108 106,50 78,68 Z', c.mat('rubber', 'd'), { 'data-part': 'hose' }));
        for (let i = 0; i < 7; i++) {
          const p = cub((i + 0.6) / 7.6);
          out.push(artRect(p[0] - 1.8, p[1], 3.6, 14, 'rgba(0,0,0,.3)', 1.8, { 'data-part': 'rib' }));
        }
        out.push(artRect(136, 58, 64, 22, c.cyl('metal', 'v'), 7, { 'data-part': 'nozzle' }));
        out.push(artRect(136, 60, 64, 3, RIM, 1.5));
        out.push(artRect(196, 54, 16, 30, c.mat('metal', 'd'), 4, { 'data-part': 'ring' }));
        out.push(artEllipse(204, 69, 4, 11, ART.dark[2]));
        out.push(poly([[146, 78], [170, 78], [164, 116], [142, 114]], c.mat('rubber', 'd'), { 'data-part': 'grip' }));
        out.push(poly([[146, 78], [170, 78], [169, 82], [145, 82]], RIM2));
        out.push(poly([[152, 76], [160, 76], [158, 90], [152, 90]], c.mat('metal', 'r'), { 'data-part': 'trigger' }));
        out.push(artPath('M212,70 C226,58 222,40 216,30 C240,44 240,82 212,86 Z', c.glow('hot'), { 'data-part': 'flame' }));
        out.push(artPath('M214,70 C224,62 221,50 218,44 C232,54 232,74 214,78 Z', ART.gloss[2]));
        return out;
      },
      icon: (c) => [
        artRect(3, 10, 13, 28, c.cyl('metal', 'h'), 6, { 'data-part': 'tank' }),
        artRect(14, 13, 10, 22, c.cyl('metal', 'h'), 5, { 'data-part': 'tank' }),
        artPath('M22,19 C29,13 30,31 37,25 L37,30 C29,36 28,20 22,25 Z', c.mat('rubber', 'd'), { 'data-part': 'hose' }),
        artRect(33, 20, 12, 7, c.cyl('metal', 'v'), 2, { 'data-part': 'nozzle' }),
        poly([[35, 26], [41, 26], [39, 40], [33, 39]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        artPath('M44,24 C48,19 47,13 45,9 C53,15 53,28 44,30 Z', c.glow('hot'), { 'data-part': 'flame' }),
        artRect(5, 11, 3, 26, RIM2, 1.5)
      ]
    },

    /* ───────── 붕괴 · T-handle blasting machine (§3) ─────────
     * Wooden case, T plunger, wire terminals. */
    collapse: {
      detail: (c) => [
        artRect(66, 8, 92, 16, c.mat('accent', 'd'), 7, { 'data-part': 'tbar' }),
        artRect(66, 9.5, 92, 3.4, RIM, 1.7),
        artRect(102, 22, 20, 30, c.cyl('metal', 'v'), 3, { 'data-part': 'shaft' }),
        artRect(104, 22, 4, 30, RIM2, 2),
        artPath('M34,74 C20,72 22,54 8,52 L8,60 C16,62 12,78 34,80 Z', ART.dark[2], { 'data-part': 'wire' }),
        artPath('M34,96 C20,100 22,116 10,120 L10,128 C26,122 22,106 34,102 Z', ART.dark[2], { 'data-part': 'wire' }),
        poly([[38, 50], [186, 50], [186, 116], [38, 116]], c.mat('wood', 'd'), { 'data-part': 'case' }),
        poly([[38, 50], [186, 50], [186, 54], [38, 54]], RIM),
        poly([[38, 112], [186, 112], [186, 116], [38, 116]], SEAM),
        poly([[38, 50], [54, 50], [54, 116], [38, 116]], 'rgba(200,162,74,.26)'),
        poly([[170, 50], [186, 50], [186, 116], [170, 116]], 'rgba(200,162,74,.26)'),
        artRect(44, 56, 136, 22, c.mat('dark', 'v'), 3, { 'data-part': 'plate' }),
        artRect(44, 57, 136, 2.4, RIM2, 1.2),
        artCircle(72, 94, 11, c.mat('metal', 'd'), { 'data-part': 'dial' }),
        artPath('M63,88 A11,11 0 0 1 80,86 L77,89 A7,7 0 0 0 65.6,90.4 Z', RIM),
        artCircle(72, 94, 3.4, ART.dark[2]),
        artCircle(104, 94, 11, c.mat('metal', 'v'), { 'data-part': 'dial' }),
        artCircle(104, 94, 3.4, ART.dark[2]),
        artRect(134, 86, 32, 16, c.mat('accent', 'd'), 4, { 'data-part': 'lamp' }),
        artRect(134, 87, 32, 2.6, RIM, 1.3),
        artCircle(36, 74, 7, c.mat('brass', 'd'), { 'data-part': 'terminal' }),
        artCircle(36, 96, 7, c.mat('brass', 'd'), { 'data-part': 'terminal' }),
        artRect(30, 116, 164, 10, c.mat('dark', 'v'), 3, { 'data-part': 'feet' }),
        artRect(30, 117, 164, 2.2, RIM2, 1.1),
        artRect(198, 28, 8, 58, c.cyl('metal', 'h'), 3, { 'data-part': 'antenna' }),
        artCircle(202, 24, 8, c.mat('accent', 'd'))
      ],
      icon: (c) => [
        artRect(13, 3, 22, 6, c.mat('accent', 'd'), 3, { 'data-part': 'tbar' }),
        artRect(21, 8, 6, 10, c.cyl('metal', 'v'), 1.5, { 'data-part': 'shaft' }),
        poly([[7, 17], [41, 17], [41, 38], [7, 38]], c.mat('wood', 'd'), { 'data-part': 'case' }),
        poly([[7, 17], [41, 17], [41, 19], [7, 19]], RIM),
        artRect(10, 20, 28, 7, c.mat('dark', 'v'), 2, { 'data-part': 'plate' }),
        artCircle(17, 32, 4, c.mat('metal', 'd'), { 'data-part': 'dial' }),
        artRect(27, 29, 11, 6, c.mat('accent', 'd'), 2, { 'data-part': 'lamp' }),
        artRect(5, 38, 38, 4, c.mat('dark', 'v'), 1.5, { 'data-part': 'feet' }),
        artCircle(5, 23, 3, c.mat('brass', 'd'), { 'data-part': 'terminal' })
      ]
    },

    /* ───────── 레이저 커터 · SPEC-arsenal §B2 ─────────
     * Not a gun: a cutting instrument. A squat battery block at the back, cooling fins along the top (the
     * heat is the resource, so the fins are the silhouette's one memorable feature), a stubby body and a
     * focusing lens ring at the muzzle with the magenta #ff4d9d emitter sitting inside it — the same colour
     * the beam is drawn in, so the picture and the effect agree. */
    laser: {
      detail: (c) => [
        artRect(18, 52, 58, 44, c.mat('dark', 'd'), 6, { 'data-part': 'battery' }),
        artRect(18, 53.5, 58, 3.2, RIM2, 1.6),
        artRect(24, 60, 46, 10, c.mat('brass', 'h'), 2, { 'data-part': 'cell' }),
        artRect(24, 76, 46, 6, 'rgba(255,77,157,.35)', 2),
        /* cooling fins: six across the top of the body (§B2 열 관리) */
        artRect(84, 34, 8, 20, c.cyl('metal', 'h'), 2, { 'data-part': 'fin' }),
        artRect(98, 34, 8, 20, c.cyl('metal', 'h'), 2, { 'data-part': 'fin' }),
        artRect(112, 34, 8, 20, c.cyl('metal', 'h'), 2, { 'data-part': 'fin' }),
        artRect(126, 34, 8, 20, c.cyl('metal', 'h'), 2, { 'data-part': 'fin' }),
        artRect(140, 34, 8, 20, c.cyl('metal', 'h'), 2, { 'data-part': 'fin' }),
        artRect(154, 34, 8, 20, c.cyl('metal', 'h'), 2, { 'data-part': 'fin' }),
        artRect(76, 52, 98, 36, c.mat('metal', 'd'), 5, { 'data-part': 'body' }),
        artRect(76, 53.4, 98, 3, RIM, 1.5),
        artRect(76, 84, 98, 4, SEAM),
        artRect(84, 60, 70, 9, c.mat('dark', 'v'), 2, { 'data-part': 'vent' }),
        poly([[92, 88], [126, 88], [118, 126], [88, 126]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        poly([[92, 88], [126, 88], [125.2, 91.8], [91.4, 91.8]], RIM2),
        poly([[128, 88], [142, 88], [138, 104], [128, 100]], c.mat('dark', 'd'), { 'data-part': 'trigger' }),
        artRect(174, 56, 26, 28, c.cyl('metal', 'v'), 4, { 'data-part': 'collar' }),
        artRect(175.4, 57.4, 3, 25, RIM2, 1.5),
        artCircle(206, 70, 17, c.cyl('metal', 'd'), { 'data-part': 'lens-ring' }),
        artCircle(206, 70, 11, ART.dark[2]),
        artCircle(206, 70, 8, c.glow('accent'), { 'data-part': 'emitter' }),
        artCircle(203, 66, 3.2, ART.gloss[0]),
        artRect(200, 66, 36, 8, 'rgba(255,77,157,.55)', 4, { 'data-part': 'beam' }),
        artRect(206, 68.2, 32, 3.4, ART.gloss[1], 1.7),
        artRect(84, 54, 4, 34, 'rgba(255,255,255,.1)', 2),
        artRect(166, 54, 6, 34, SEAM2, 2),
        artRect(30, 88, 34, 6, c.mat('dark', 'v'), 2, { 'data-part': 'latch' }),
        artRect(30, 88.6, 34, 1.8, RIM2, 0.9)
      ],
      icon: (c) => [
        artRect(3, 17, 12, 14, c.mat('dark', 'd'), 3, { 'data-part': 'battery' }),
        artRect(16, 11, 4, 7, c.cyl('metal', 'h'), 1, { 'data-part': 'fin' }),
        artRect(22, 11, 4, 7, c.cyl('metal', 'h'), 1, { 'data-part': 'fin' }),
        artRect(28, 11, 4, 7, c.cyl('metal', 'h'), 1, { 'data-part': 'fin' }),
        artRect(14, 17, 22, 12, c.mat('metal', 'd'), 2, { 'data-part': 'body' }),
        poly([[18, 29], [26, 29], [24, 42], [17, 42]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        artCircle(40, 23, 6, c.cyl('metal', 'd'), { 'data-part': 'lens-ring' }),
        artCircle(40, 23, 3, c.glow('accent'), { 'data-part': 'emitter' }),
        artRect(14, 18, 20, 1.6, RIM2, 0.8)
      ]
    },

    /* ───────── 미니건 · SPEC-arsenal §B3 ─────────
     * The six barrels are their OWN <g data-part="barrels">, because §B3 asks for them to turn: the group is
     * rotated about (150, 70) by src/78-altfire.js while the weapon is spinning, and nothing else in the
     * drawing moves. Everything else — receiver, drum, spade grip — is what the barrels are bolted to. */
    minigun: {
      detail: (c) => {
        const barrels = svgNode('g', { 'data-part': 'barrels' });
        /* six tubes, 60° apart around the axis at (150, 70); the two at the back are drawn first so the
         * front pair overlaps them and the cluster reads as a cylinder rather than a flower */
        const order = [3, 2, 4, 1, 5, 0];
        for (const k of order) {
          const a = k * 60 * DEG;
          const off = Math.round(Math.sin(a) * 15 * 10) / 10;
          const depth = Math.cos(a);
          const shade = depth > 0.3 ? 'metal' : 'dark';
          barrels.append(artRect(150, 64.5 + off, 82, 11, c.cyl(shade, 'h'), 5, { 'data-part': 'barrel' }));
          barrels.append(artRect(226, 65.5 + off, 8, 9, ART.dark[2], 4));
        }
        return [
          artRect(26, 44, 44, 52, c.mat('dark', 'd'), 6, { 'data-part': 'drum' }),
          artRect(26, 45.5, 44, 3, RIM2, 1.5),
          artCircle(48, 70, 15, c.cyl('metal', 'd'), { 'data-part': 'drum-hub' }),
          artCircle(48, 70, 5, ART.dark[2]),
          poly([[66, 58], [96, 52], [96, 64], [66, 70]], c.mat('brass', 'h'), { 'data-part': 'belt' }),
          poly([[66, 58], [96, 52], [96, 55], [66, 61]], RIM2),
          artRect(84, 40, 76, 60, c.mat('metal', 'd'), 7, { 'data-part': 'receiver' }),
          artRect(84, 41.6, 76, 3.4, RIM, 1.7),
          artRect(84, 96, 76, 4, SEAM),
          artRect(92, 50, 58, 12, c.mat('dark', 'v'), 3, { 'data-part': 'motor' }),
          artRect(92, 51, 58, 2.2, RIM2, 1.1),
          barrels,
          artCircle(150, 70, 19, c.cyl('metal', 'v'), { 'data-part': 'hub' }),
          artCircle(150, 70, 6.5, ART.dark[2]),
          artPath('M133,58 A19,19 0 0 1 162,55 L158,59 A14,14 0 0 0 136,61 Z', RIM),
          artRect(96, 100, 14, 30, c.mat('rubber', 'd'), 4, { 'data-part': 'grip' }),
          artRect(134, 100, 14, 30, c.mat('rubber', 'd'), 4, { 'data-part': 'grip' }),
          artRect(92, 98, 60, 10, c.mat('dark', 'v'), 3, { 'data-part': 'spade' }),
          artRect(92, 99, 60, 2.2, RIM2, 1.1),
          artRect(112, 104, 20, 8, c.mat('accent', 'd'), 3, { 'data-part': 'trigger' })
        ];
      },
      /* §2: the icon is DRAWN FRESH, not a small detail drawing. Six barrels are six grey smudges at 24 px,
       * so three survive instead — and the budget (≤ 12 drawn nodes, the <g> included) is what forces the
       * choice, which is exactly the point of having two LODs. */
      icon: (c) => {
        const barrels = svgNode('g', { 'data-part': 'barrels' });
        for (const k of [1, 2, 0]) {
          const off = (k - 1) * 5;
          barrels.append(artRect(28, 21.5 + off, 18, 4, c.cyl(k === 0 ? 'metal' : 'dark', 'h'), 2, { 'data-part': 'barrel' }));
        }
        return [
          artRect(3, 14, 12, 17, c.mat('dark', 'd'), 3, { 'data-part': 'drum' }),
          artCircle(9, 22, 4, c.cyl('metal', 'd'), { 'data-part': 'drum-hub' }),
          artRect(14, 13, 16, 19, c.mat('metal', 'd'), 3, { 'data-part': 'receiver' }),
          artRect(14, 14, 16, 2, RIM, 1),
          barrels,
          artCircle(29, 23, 6.5, c.cyl('metal', 'v'), { 'data-part': 'hub' }),
          artCircle(29, 23, 2.4, ART.dark[2]),
          artRect(20, 32, 6, 11, c.mat('rubber', 'd'), 2, { 'data-part': 'grip' })
        ];
      }
    },

    /* ───────── 충격포 · SPEC-arsenal §C ─────────
     * Not a gun — a PRESSURE emitter. Everything about the silhouette says "this moves air, it does not
     * cut": a wide flared mouth instead of a bore, a fat pressure vessel slung under the body, and three
     * concentric wave arcs leaving the mouth. There is no sight on it either; you do not aim pressure. */
    shockwave: {
      detail: (c) => [
        artRect(14, 48, 52, 48, c.cyl('metal', 'v'), 10, { 'data-part': 'tank' }),
        artRect(15.4, 49.4, 49, 3.4, RIM, 1.7),
        artRect(22, 58, 36, 8, c.mat('dark', 'v'), 3, { 'data-part': 'gauge' }),
        artCircle(32, 80, 8, c.cyl('brass', 'd'), { 'data-part': 'valve' }),
        artCircle(32, 80, 3, ART.dark[2]),
        artPath('M24,72 Q32,64 40,72 L38,74 Q32,68 26,74 Z', ART.gloss[0], { 'data-part': 'valve-rim' }),
        artRect(62, 56, 26, 32, c.mat('dark', 'd'), 4, { 'data-part': 'coupler' }),
        artRect(66, 50, 86, 44, c.mat('metal', 'd'), 7, { 'data-part': 'body' }),
        artRect(66, 51.6, 86, 3.4, RIM, 1.7),
        artRect(66, 90, 86, 4, SEAM),
        artRect(78, 58, 60, 10, c.mat('dark', 'v'), 3, { 'data-part': 'rail' }),
        artRect(78, 59, 60, 2.2, RIM2, 1.1),
        artRect(96, 40, 10, 12, c.cyl('metal', 'h'), 2, { 'data-part': 'ribs' }),
        artRect(112, 40, 10, 12, c.cyl('metal', 'h'), 2, { 'data-part': 'ribs' }),
        artRect(128, 40, 10, 12, c.cyl('metal', 'h'), 2, { 'data-part': 'ribs' }),
        poly([[74, 94], [108, 94], [100, 130], [72, 130]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        poly([[74, 94], [108, 94], [107.2, 97.6], [73.4, 97.6]], RIM2),
        poly([[110, 94], [124, 94], [120, 110], [110, 106]], c.mat('dark', 'd'), { 'data-part': 'trigger' }),
        poly([[152, 44], [178, 32], [178, 112], [152, 100]], c.mat('metal', 'r'), { 'data-part': 'throat' }),
        poly([[152, 44], [178, 32], [178, 36], [152, 48]], RIM),
        poly([[178, 32], [206, 14], [206, 130], [178, 112]], c.cyl('metal', 'v'), { 'data-part': 'mouth' }),
        poly([[178, 32], [206, 14], [206, 20], [178, 37]], RIM),
        poly([[178, 108], [206, 124], [206, 130], [178, 112]], SEAM),
        artEllipse(206, 72, 6, 58, ART.dark[2], { 'data-part': 'bore' }),
        artEllipse(204, 72, 3, 48, 'rgba(138,180,255,.35)'),
        artPath('M206,20 A52,52 0 0 1 206,124 L202,120 A48,48 0 0 0 202,24 Z', RIM2, { 'data-part': 'mouth-rim' }),
        artPath('M210,36 Q224,72 210,108 L216,108 Q230,72 216,36 Z', 'rgba(212,218,228,.55)', { 'data-part': 'wave' }),
        artPath('M220,44 Q232,72 220,100 L225,100 Q237,72 225,44 Z', 'rgba(212,218,228,.34)', { 'data-part': 'wave' }),
        artPath('M229,52 Q239,72 229,92 L233,92 Q243,72 233,52 Z', 'rgba(212,218,228,.2)', { 'data-part': 'wave' }),
        artRect(24, 96, 30, 6, c.mat('dark', 'v'), 2, { 'data-part': 'strap' }),
        artRect(24, 96.6, 30, 1.8, RIM2, 0.9)
      ],
      icon: (c) => [
        artRect(2, 16, 12, 16, c.cyl('metal', 'v'), 3, { 'data-part': 'tank' }),
        artRect(13, 17, 18, 14, c.mat('metal', 'd'), 3, { 'data-part': 'body' }),
        artRect(13, 18, 18, 1.6, RIM, 0.8),
        poly([[17, 31], [26, 31], [24, 43], [16, 43]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        poly([[31, 14], [42, 7], [42, 41], [31, 34]], c.cyl('metal', 'v'), { 'data-part': 'mouth' }),
        artEllipse(42, 24, 2.4, 17, ART.dark[2], { 'data-part': 'bore' }),
        artPath('M44,12 Q47,24 44,36 L46,36 Q46,24 46,12 Z', 'rgba(212,218,228,.5)', { 'data-part': 'wave' })
      ]
    },

    /* ───────── 견인 광선 · SPEC-arsenal §C ─────────
     * A dish, not a barrel. The emitter is a shallow parabolic reflector with a single pin at its focus,
     * and the cyan of the beam (#4ad8e6 in content.css) is quoted by the inner glow so the picture and the
     * effect agree, exactly as the laser's magenta does. Two copper coils on the spine say "this pulls". */
    tractor: {
      detail: (c) => [
        artRect(16, 54, 46, 40, c.mat('dark', 'd'), 6, { 'data-part': 'pack' }),
        artRect(17.4, 55.4, 43, 3, RIM2, 1.5),
        artRect(22, 62, 34, 9, 'rgba(74,216,230,.35)', 2, { 'data-part': 'cell' }),
        artRect(22, 76, 34, 6, c.mat('brass', 'h'), 2, { 'data-part': 'cell' }),
        artRect(60, 58, 20, 30, c.mat('metal', 'd'), 3, { 'data-part': 'spine' }),
        artCircle(94, 44, 11, c.cyl('brass', 'd'), { 'data-part': 'coil' }),
        artCircle(94, 44, 5, ART.dark[2]),
        artCircle(122, 44, 11, c.cyl('brass', 'd'), { 'data-part': 'coil' }),
        artCircle(122, 44, 5, ART.dark[2]),
        artRect(78, 52, 76, 40, c.mat('metal', 'd'), 6, { 'data-part': 'body' }),
        artRect(78, 53.6, 76, 3.2, RIM, 1.6),
        artRect(78, 88, 76, 4, SEAM),
        artRect(88, 60, 56, 9, c.mat('dark', 'v'), 2, { 'data-part': 'window' }),
        artRect(90, 62, 52, 4, 'rgba(74,216,230,.5)', 2),
        poly([[88, 92], [120, 92], [113, 128], [86, 128]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        poly([[88, 92], [120, 92], [119.2, 95.6], [87.4, 95.6]], RIM2),
        poly([[122, 92], [136, 92], [132, 108], [122, 104]], c.mat('dark', 'd'), { 'data-part': 'trigger' }),
        artRect(154, 60, 18, 24, c.cyl('metal', 'v'), 3, { 'data-part': 'neck' }),
        artPath('M172,30 Q214,72 172,114 Q198,72 172,30 Z', c.mat('metal', 'r'), { 'data-part': 'dish' }),
        artPath('M172,34 Q206,72 172,110 Q190,72 172,34 Z', ART.dark[0], { 'data-part': 'dish-in' }),
        artPath('M174,38 Q198,56 196,68 L192,66 Q192,56 174,42 Z', RIM2),
        artRect(176, 69, 32, 5, c.cyl('metal', 'h'), 2.5, { 'data-part': 'stem' }),
        artCircle(210, 72, 9, c.glow('metal'), { 'data-part': 'focus' }),
        artCircle(210, 72, 5, 'rgba(74,216,230,.85)'),
        artCircle(208, 69, 2.2, ART.gloss[0]),
        artPath('M216,62 Q236,72 216,82 L220,76 L220,68 Z', 'rgba(74,216,230,.45)', { 'data-part': 'pull' }),
        artRect(26, 94, 28, 6, c.mat('dark', 'v'), 2, { 'data-part': 'latch' }),
        artRect(26, 94.6, 28, 1.8, RIM2, 0.9),
        artCircle(70, 72, 4, ART.dark[2])
      ],
      icon: (c) => [
        artRect(2, 17, 11, 14, c.mat('dark', 'd'), 3, { 'data-part': 'pack' }),
        artCircle(18, 12, 4.5, c.cyl('brass', 'd'), { 'data-part': 'coil' }),
        artRect(12, 17, 20, 13, c.mat('metal', 'd'), 3, { 'data-part': 'body' }),
        artRect(12, 18, 20, 1.6, RIM, 0.8),
        poly([[17, 30], [26, 30], [24, 43], [16, 43]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        artPath('M33,10 Q46,23 33,36 Q39,23 33,10 Z', c.mat('metal', 'r'), { 'data-part': 'dish' }),
        artCircle(43, 23, 3.4, 'rgba(74,216,230,.85)', { 'data-part': 'focus' })
      ]
    },

    /* ───────── 고무탄 · SPEC-arsenal §C ─────────
     * A break-action launcher with a fat white round sitting in the open breech — the ROUND is the picture,
     * because what the weapon does is leave that rubber on whatever it touches. Short, wide bore, and a
     * bounce trace behind the muzzle so the silhouette reads "this comes back". */
    rubber: {
      detail: (c) => [
        poly([[20, 78], [58, 68], [62, 96], [24, 104]], c.mat('wood', 'd'), { 'data-part': 'stock' }),
        poly([[20, 78], [58, 68], [58.6, 72], [20.8, 82]], RIM2),
        artRect(56, 62, 28, 40, c.mat('metal', 'd'), 5, { 'data-part': 'receiver' }),
        artRect(56, 63.4, 28, 3, RIM, 1.5),
        artRect(56, 98, 28, 4, SEAM),
        artRect(84, 58, 16, 46, c.mat('dark', 'd'), 3, { 'data-part': 'hinge' }),
        artCircle(92, 81, 5, c.cyl('brass', 'd'), { 'data-part': 'pin' }),
        poly([[70, 102], [98, 102], [92, 132], [68, 132]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        poly([[70, 102], [98, 102], [97.2, 105.6], [69.4, 105.6]], RIM2),
        poly([[100, 100], [114, 100], [110, 116], [100, 112]], c.mat('dark', 'd'), { 'data-part': 'trigger' }),
        artRect(98, 56, 76, 50, c.cyl('metal', 'v'), 8, { 'data-part': 'barrel' }),
        artRect(99.4, 57.6, 73, 4, RIM, 2),
        artRect(98, 100, 76, 4, SEAM2),
        artRect(108, 64, 20, 8, c.mat('dark', 'v'), 2, { 'data-part': 'breech' }),
        artCircle(140, 81, 20, ART.dark[2], { 'data-part': 'chamber' }),
        artCircle(140, 81, 15, c.glow('gloss'), { 'data-part': 'round' }),
        artCircle(134, 75, 4.6, ART.gloss[0]),
        artRect(174, 60, 24, 42, c.cyl('metal', 'v'), 5, { 'data-part': 'muzzle' }),
        artRect(175.4, 61.6, 3, 38, RIM2, 1.5),
        artEllipse(198, 81, 5, 20, ART.dark[2], { 'data-part': 'bore' }),
        artEllipse(197, 81, 2.4, 15, c.mat('gloss', 'v')),
        artPath('M206,54 Q226,66 212,80 Q228,94 208,108 L212,102 Q220,92 206,80 Q220,68 210,58 Z', 'rgba(246,250,254,.5)', { 'data-part': 'bounce' }),
        artCircle(230, 54, 5, 'rgba(246,250,254,.75)', { 'data-part': 'bounce-dot' }),
        artCircle(232, 108, 4, 'rgba(246,250,254,.5)', { 'data-part': 'bounce-dot' }),
        artRect(60, 70, 18, 6, c.mat('dark', 'v'), 2, { 'data-part': 'plate' }),
        artRect(60, 70.6, 18, 1.8, RIM2, 0.9),
        artCircle(66, 88, 3.2, ART.dark[2]),
        artCircle(76, 88, 3.2, ART.dark[2])
      ],
      icon: (c) => [
        poly([[2, 24], [13, 20], [14, 31], [3, 34]], c.mat('wood', 'd'), { 'data-part': 'stock' }),
        artRect(12, 18, 10, 14, c.mat('metal', 'd'), 2, { 'data-part': 'receiver' }),
        poly([[15, 32], [23, 32], [21, 43], [14, 43]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        artRect(21, 17, 18, 16, c.cyl('metal', 'v'), 4, { 'data-part': 'barrel' }),
        artCircle(30, 25, 6, ART.dark[2], { 'data-part': 'chamber' }),
        artCircle(30, 25, 4, c.glow('gloss'), { 'data-part': 'round' }),
        artRect(38, 18, 7, 14, c.cyl('metal', 'v'), 2, { 'data-part': 'muzzle' }),
        artEllipse(45, 25, 1.8, 6, ART.dark[2], { 'data-part': 'bore' })
      ]
    },

    /* ───────── 뿅망치 · SPEC-arsenal §D ─────────
     * A TOY. Nothing on it is metal: a fat air-filled head in the one hot colour the palette owns, a thin
     * bendy shaft, a squeeze bulb at the butt (that is where the "뿅" comes from), and a bow where the two
     * meet. The head is set ACROSS the shaft like every other melee weapon in this file (§7). */
    squeaky: {
      detail: (c) => {
        const fr = frame(96, 86, -34);
        const a0 = fr(0, 0), a1 = fr(82, 0);
        return [
          artRect(30, 108, 44, 16, c.mat('rubber', 'd'), 8, { 'data-part': 'bulb' }),
          artRect(31.4, 109.4, 41, 3.4, RIM2, 1.7),
          artEllipse(28, 116, 9, 11, c.cyl('rubber', 'v'), { 'data-part': 'bulb-cap' }),
          artCircle(24, 112, 2.6, ART.gloss[1]),
          poly([[46, 104], [60, 96], [104, 70], [98, 60], [54, 86], [40, 96]], c.cyl('accent', 'h'), { 'data-part': 'shaft' }),
          poly([[46, 104], [98, 60], [99.6, 62.6], [47.4, 106.6]], RIM2),
          artEllipse(a0[0], a0[1], 7, 9, c.mat('brass', 'd'), { 'data-part': 'collar' }),
          artPath('M88,68 Q96,56 108,58 Q98,62 94,72 Z', ART.gloss[0], { 'data-part': 'bow' }),
          artPath('M100,56 Q112,44 120,52 Q110,52 104,62 Z', ART.gloss[2], { 'data-part': 'bow' }),
          artEllipse(a1[0], a1[1], 40, 30, c.cyl('accent', 'd'), { 'data-part': 'head' }),
          artEllipse(a1[0] - 10, a1[1] - 10, 15, 10, 'rgba(255,255,255,.45)', { 'data-part': 'head-gloss' }),
          artPath('M126,12 Q156,6 170,26 L164,28 Q150,12 128,16 Z', RIM, { 'data-part': 'head-rim' }),
          artEllipse(a1[0] + 20, a1[1] + 14, 14, 9, SEAM2),
          artCircle(a1[0] + 30, a1[1] - 6, 4, ART.gloss[0], { 'data-part': 'glint' }),
          artCircle(a1[0] - 26, a1[1] + 12, 3, ART.gloss[1], { 'data-part': 'glint' }),
          artPath('M198,34 L202,44 L212,46 L203,52 L206,62 L197,56 L188,62 L191,52 L183,46 L193,44 Z', ART.hot[0], { 'data-part': 'star' }),
          artPath('M60,34 L63,41 L70,42 L64,47 L66,54 L60,50 L54,54 L56,47 L50,42 L57,41 Z', ART.hot[1], { 'data-part': 'star' }),
          artPath('M26,62 L28,67 L33,68 L29,71 L30,76 L26,73 L22,76 L23,71 L19,68 L24,67 Z', ART.hot[2], { 'data-part': 'star' }),
          artCircle(214, 88, 3.4, ART.hot[0]),
          artCircle(46, 24, 2.8, ART.hot[1]),
          artRect(54, 98, 10, 8, c.mat('rubber', 'd'), 3, { 'data-part': 'band' }),
          artRect(54, 98.6, 10, 1.8, RIM2, 0.9),
          artEllipse(a1[0], a1[1] + 24, 26, 6, 'rgba(0,0,0,.18)', { 'data-part': 'shade' }),
          artCircle(a0[0], a0[1], 2.4, ART.dark[2]),
          artRect(36, 118, 30, 4, SEAM2, 2)
        ];
      },
      icon: (c) => [
        artRect(6, 32, 14, 7, c.mat('rubber', 'd'), 3.5, { 'data-part': 'bulb' }),
        poly([[16, 34], [33, 18], [29, 14], [12, 30]], c.cyl('accent', 'h'), { 'data-part': 'shaft' }),
        artEllipse(34, 15, 13, 10, c.cyl('accent', 'd'), { 'data-part': 'head' }),
        artEllipse(30, 11, 5, 3.4, 'rgba(255,255,255,.45)', { 'data-part': 'head-gloss' }),
        artPath('M7,6 L9,10 L13,11 L10,14 L11,18 L7,16 L4,18 L5,14 L2,11 L6,10 Z', ART.hot[0], { 'data-part': 'star' }),
        artCircle(44, 32, 2.6, ART.hot[1], { 'data-part': 'glint' }),
        artRect(10, 33, 8, 1.6, RIM2, 0.8)
      ]
    },

    /* ───────── 물총 · SPEC-arsenal §D ─────────
     * The other toy, and it has to read as one at 24 px: a translucent tank on top with the water line
     * actually drawn in it, a chunky moulded body, a pump handle under the barrel and a round nozzle. The
     * blue is an rgba tint over the palette rather than a new colour — §9.4 keeps literal fills to ART. */
    watergun: {
      detail: (c) => [
        artPath('M62,22 Q118,10 172,24 L176,52 Q118,40 58,52 Z', c.mat('gloss', 'd'), { 'data-part': 'tank' }),
        artPath('M62,22 Q118,10 172,24 L172,28 Q118,15 62,27 Z', RIM),
        artPath('M60,38 Q118,27 174,39 L176,52 Q118,40 58,52 Z', 'rgba(74,180,230,.55)', { 'data-part': 'water' }),
        artCircle(96, 32, 4, 'rgba(255,255,255,.6)', { 'data-part': 'bubble' }),
        artCircle(132, 29, 3, 'rgba(255,255,255,.5)', { 'data-part': 'bubble' }),
        artRect(108, 14, 20, 10, c.mat('rubber', 'd'), 3, { 'data-part': 'cap' }),
        artRect(108, 14.8, 20, 2, RIM2, 1),
        artRect(54, 50, 118, 44, c.mat('accent', 'd'), 9, { 'data-part': 'body' }),
        artRect(54, 51.6, 118, 3.4, RIM, 1.7),
        artRect(54, 90, 118, 4, SEAM),
        artRect(66, 58, 76, 10, 'rgba(74,180,230,.45)', 3, { 'data-part': 'stripe' }),
        poly([[62, 94], [96, 94], [88, 130], [58, 130]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        poly([[62, 94], [96, 94], [95.2, 97.6], [61.4, 97.6]], RIM2),
        poly([[98, 92], [112, 92], [108, 108], [98, 104]], c.mat('dark', 'd'), { 'data-part': 'trigger' }),
        artRect(112, 96, 60, 12, c.cyl('rubber', 'h'), 6, { 'data-part': 'pump' }),
        artRect(113, 97, 58, 2.6, RIM2, 1.3),
        artRect(150, 100, 34, 6, c.cyl('metal', 'h'), 3, { 'data-part': 'pump-rod' }),
        artRect(172, 56, 34, 32, c.cyl('accent', 'v'), 6, { 'data-part': 'barrel' }),
        artRect(173.4, 57.4, 3, 29, RIM2, 1.5),
        artCircle(208, 72, 15, c.cyl('metal', 'd'), { 'data-part': 'nozzle' }),
        artCircle(208, 72, 8, ART.dark[2]),
        artCircle(208, 72, 4, 'rgba(74,180,230,.8)', { 'data-part': 'jet' }),
        artCircle(204, 68, 2.4, ART.gloss[0]),
        artPath('M224,66 Q240,70 236,78 Q234,72 222,76 Z', 'rgba(74,180,230,.6)', { 'data-part': 'drip' }),
        artEllipse(232, 86, 4, 5.5, 'rgba(74,180,230,.5)', { 'data-part': 'drip' }),
        artEllipse(224, 96, 3, 4, 'rgba(74,180,230,.38)', { 'data-part': 'drip' }),
        artRect(64, 74, 22, 8, c.mat('dark', 'v'), 2, { 'data-part': 'label' }),
        artRect(64, 74.6, 22, 1.8, RIM2, 0.9)
      ],
      icon: (c) => [
        artPath('M12,6 Q24,2 36,7 L37,14 Q24,9 11,14 Z', c.mat('gloss', 'd'), { 'data-part': 'tank' }),
        artPath('M11,11 Q24,6 37,11 L37,14 Q24,9 11,14 Z', 'rgba(74,180,230,.55)', { 'data-part': 'water' }),
        artRect(9, 14, 27, 14, c.mat('accent', 'd'), 3, { 'data-part': 'body' }),
        artRect(9, 15, 27, 1.8, RIM, 0.9),
        poly([[12, 28], [21, 28], [19, 43], [11, 43]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        artRect(22, 30, 17, 4, c.cyl('rubber', 'h'), 2, { 'data-part': 'pump' }),
        artCircle(42, 20, 5, c.cyl('metal', 'd'), { 'data-part': 'nozzle' }),
        artCircle(42, 20, 2.2, 'rgba(74,180,230,.8)', { 'data-part': 'jet' })
      ]
    },

    /* ───────── 나팔 · SPEC-arsenal §D ─────────
     * A brass air horn: a long flaring bell, a straight body behind it, a pressure can clamped underneath
     * and a plunger on top. The bell is drawn as one curved path with a separate lip ellipse, so even at
     * icon size the one thing that survives is the flare — which is also the one thing the weapon does. */
    horn: {
      detail: (c) => [
        artRect(16, 60, 34, 54, c.cyl('metal', 'v'), 7, { 'data-part': 'can' }),
        artRect(17.4, 61.4, 31, 3.4, RIM, 1.7),
        artRect(22, 70, 22, 10, c.mat('accent', 'd'), 3, { 'data-part': 'label' }),
        artRect(22, 86, 22, 6, c.mat('dark', 'v'), 2, { 'data-part': 'label' }),
        artRect(24, 44, 18, 18, c.mat('dark', 'd'), 3, { 'data-part': 'plunger' }),
        artRect(20, 36, 26, 10, c.cyl('rubber', 'h'), 4, { 'data-part': 'press' }),
        artRect(21, 37, 24, 2.2, RIM2, 1.1),
        artRect(48, 66, 20, 26, c.mat('dark', 'd'), 3, { 'data-part': 'clamp' }),
        artRect(48, 67, 20, 2.2, RIM2, 1.1),
        artRect(64, 58, 56, 36, c.cyl('brass', 'v'), 6, { 'data-part': 'body' }),
        artRect(65.4, 59.6, 53, 3.4, RIM, 1.7),
        artRect(64, 90, 56, 3.4, SEAM2),
        artRect(78, 66, 30, 8, c.mat('dark', 'v'), 2, { 'data-part': 'vent' }),
        artRect(118, 54, 14, 44, c.cyl('brass', 'v'), 3, { 'data-part': 'joint' }),
        artRect(119, 55.4, 2.6, 41, RIM2, 1.3),
        artPath('M132,54 Q176,48 196,14 L210,20 Q186,62 134,66 Z', c.cyl('brass', 'r'), { 'data-part': 'bell' }),
        artPath('M132,98 Q176,104 196,138 L210,132 Q186,90 134,86 Z', c.mat('brass', 'd'), { 'data-part': 'bell' }),
        artPath('M132,54 Q176,48 196,14 L198,19 Q178,50 133,58 Z', RIM),
        artPath('M196,14 L210,20 L210,132 L196,138 Q206,76 196,14 Z', c.mat('brass', 'h'), { 'data-part': 'flare' }),
        artEllipse(203, 76, 9, 62, c.cyl('brass', 'h'), { 'data-part': 'lip' }),
        artEllipse(203, 76, 5, 54, ART.dark[1], { 'data-part': 'throat' }),
        artEllipse(201, 76, 2.4, 44, ART.dark[2]),
        artPath('M216,40 Q230,76 216,112 L221,112 Q234,76 221,40 Z', 'rgba(230,200,126,.5)', { 'data-part': 'blast' }),
        artPath('M226,52 Q237,76 226,100 L230,100 Q240,76 230,52 Z', 'rgba(230,200,126,.32)', { 'data-part': 'blast' }),
        poly([[72, 94], [104, 94], [98, 126], [70, 126]], c.mat('rubber', 'd'), { 'data-part': 'grip' }),
        poly([[72, 94], [104, 94], [103.2, 97.6], [71.4, 97.6]], RIM2),
        artCircle(56, 102, 3.4, ART.dark[2]),
        artRect(26, 112, 16, 6, c.mat('dark', 'v'), 2, { 'data-part': 'foot' })
      ],
      icon: (c) => [
        artRect(3, 18, 11, 18, c.cyl('metal', 'v'), 3, { 'data-part': 'can' }),
        artRect(5, 12, 7, 7, c.mat('dark', 'd'), 2, { 'data-part': 'plunger' }),
        artRect(13, 18, 14, 12, c.cyl('brass', 'v'), 3, { 'data-part': 'body' }),
        artRect(13, 19, 14, 1.6, RIM, 0.8),
        artPath('M27,18 Q36,16 41,5 L45,7 Q38,22 28,23 Z', c.cyl('brass', 'r'), { 'data-part': 'bell' }),
        artPath('M27,30 Q36,32 41,43 L45,41 Q38,26 28,25 Z', c.mat('brass', 'd'), { 'data-part': 'bell' }),
        artEllipse(43, 24, 3, 18, c.cyl('brass', 'h'), { 'data-part': 'lip' }),
        artEllipse(43, 24, 1.6, 14, ART.dark[1], { 'data-part': 'throat' })
      ]
    },

    /* ───────── 고무 치킨 · SPEC-arsenal §D ─────────
     * The only weapon in the arsenal that is a whole animal, so it is drawn as one: a plucked body held by
     * the neck, a comb, a beak, a wattle and two legs dangling off the bottom. "가볍고 예측 불가" is in the
     * pose — nothing on it is horizontal, and the legs hang at two different angles. */
    chicken: {
      detail: (c) => [
        artPath('M34,40 Q22,52 30,66 Q38,74 50,70 L46,60 Q38,56 40,46 Z', c.mat('rubber', 'd'), { 'data-part': 'hand' }),
        artRect(28, 56, 26, 14, c.cyl('rubber', 'h'), 6, { 'data-part': 'grip' }),
        artRect(29, 57, 24, 3, RIM2, 1.5),
        artPath('M52,62 Q78,52 104,58 Q96,70 68,74 Z', c.mat('gloss', 'd'), { 'data-part': 'neck' }),
        artPath('M52,62 Q78,52 104,58 L103,61 Q78,55 53,65 Z', RIM2),
        artEllipse(146, 74, 48, 34, c.cyl('gloss', 'd'), { 'data-part': 'body' }),
        artPath('M110,52 Q146,38 182,54 L180,60 Q146,46 112,58 Z', RIM, { 'data-part': 'back-rim' }),
        artPath('M160,66 Q190,62 196,82 Q176,94 154,86 Z', 'rgba(255,233,176,.6)', { 'data-part': 'wing' }),
        artPath('M162,70 Q184,68 190,80 L186,80 Q180,72 163,73 Z', RIM2),
        artEllipse(118, 92, 20, 12, SEAM2, { 'data-part': 'belly-shade' }),
        artPath('M188,56 Q210,42 216,58 Q222,46 230,60 Q222,74 206,72 Z', c.mat('accent', 'd'), { 'data-part': 'comb' }),
        artPath('M188,56 Q210,42 216,58 L213,58 Q208,48 190,59 Z', ART.gloss[0]),
        artEllipse(206, 76, 20, 17, c.cyl('gloss', 'v'), { 'data-part': 'head' }),
        artCircle(212, 70, 4.4, ART.dark[2], { 'data-part': 'eye' }),
        artCircle(213.4, 68.6, 1.6, ART.gloss[0]),
        poly([[224, 76], [240, 82], [224, 88]], c.mat('hot', 'h'), { 'data-part': 'beak' }),
        poly([[224, 76], [240, 82], [226, 80]], ART.hot[0]),
        artPath('M206,92 Q214,96 210,106 Q202,102 206,92 Z', c.mat('accent', 'd'), { 'data-part': 'wattle' }),
        artPath('M126,104 Q120,122 108,130 L112,134 Q128,124 132,106 Z', c.cyl('hot', 'h'), { 'data-part': 'leg' }),
        poly([[106, 128], [96, 134], [108, 136], [98, 140]], ART.hot[1], { 'data-part': 'foot' }),
        artPath('M156,106 Q158,124 150,134 L155,136 Q166,124 162,106 Z', c.cyl('hot', 'h'), { 'data-part': 'leg' }),
        poly([[150, 132], [140, 138], [152, 139], [143, 140]], ART.hot[2], { 'data-part': 'foot' }),
        artPath('M96,70 Q84,78 92,90 Q98,80 100,74 Z', 'rgba(246,250,254,.6)', { 'data-part': 'tail' }),
        artEllipse(104, 76, 7, 11, 'rgba(246,250,254,.5)', { 'data-part': 'tail' }),
        artCircle(140, 60, 3, 'rgba(0,0,0,.14)'),
        artCircle(162, 92, 3.4, 'rgba(0,0,0,.12)'),
        artEllipse(146, 108, 30, 5, 'rgba(0,0,0,.16)', { 'data-part': 'shade' })
      ],
      icon: (c) => [
        artRect(3, 20, 11, 7, c.cyl('rubber', 'h'), 3.5, { 'data-part': 'grip' }),
        artPath('M13,23 Q20,19 26,22 Q22,27 15,27 Z', c.mat('gloss', 'd'), { 'data-part': 'neck' }),
        artEllipse(28, 26, 14, 11, c.cyl('gloss', 'd'), { 'data-part': 'body' }),
        artPath('M36,15 Q42,10 44,17 Q46,12 48,19 Q43,24 38,22 Z', c.mat('accent', 'd'), { 'data-part': 'comb' }),
        artEllipse(39, 24, 7, 6, c.cyl('gloss', 'v'), { 'data-part': 'head' }),
        artCircle(41, 22, 1.7, ART.dark[2], { 'data-part': 'eye' }),
        poly([[45, 24], [48, 26], [45, 28]], c.mat('hot', 'h'), { 'data-part': 'beak' }),
        artPath('M24,36 Q22,41 18,44 L20,45 Q26,41 27,37 Z', c.cyl('hot', 'h'), { 'data-part': 'leg' })
      ]
    },

    /* ───────── 샷건 · SPEC-arsenal §E ─────────
     * 상하 2연 총열에 나무 개머리판과 앞으로 뺀 펌프 손잡이. 무기고에서 유일하게 **총구가 둘**이라
     * 24px 에서도 샷건으로 읽힌다 — 아이콘은 그 두 개의 구멍과 개머리판 경사만 남긴다. */
    shotgun: {
      detail: (c) => [
        artPath('M12,78 Q22,62 44,58 L58,56 L62,84 L34,94 Q16,96 12,78 Z', c.mat('wood', 'd'), { 'data-part': 'stock' }),
        artPath('M12,78 Q22,62 44,58 L58,56 L57.6,60 L44,62 Q24,66 15.4,80 Z', RIM2),
        artPath('M34,94 Q52,92 62,84 L62,88 Q50,97 35,98 Z', SEAM2),
        artRect(56, 54, 26, 34, c.cyl('metal', 'v'), 3, { 'data-part': 'receiver' }),
        artRect(57, 55, 24, 2.4, RIM, 1.2),
        artRect(56, 86, 26, 2.4, SEAM, 1.2),
        artRect(62, 88, 10, 14, c.mat('dark', 'd'), 2, { 'data-part': 'trigger-guard' }),
        artPath('M66,90 Q70,98 66,102 Q63,97 66,90 Z', ART.dark[2], { 'data-part': 'trigger' }),
        artRect(80, 56, 24, 12, c.cyl('rubber', 'v'), 3, { 'data-part': 'pump' }),
        artRect(81, 57, 22, 1.8, RIM2, 0.9),
        artRect(84, 58, 2, 8, SEAM2),
        artRect(90, 58, 2, 8, SEAM2),
        artRect(96, 58, 2, 8, SEAM2),
        artRect(80, 58, 128, 13, c.cyl('metal', 'v'), 5, { 'data-part': 'barrel-top' }),
        artRect(80, 59, 128, 2.2, RIM, 1.1),
        artRect(80, 72, 128, 13, c.cyl('metal', 'v'), 5, { 'data-part': 'barrel-bottom' }),
        artRect(80, 73, 128, 1.8, RIM2, 0.9),
        artRect(80, 70, 128, 2.6, SEAM, 1.3),
        artEllipse(207, 64.5, 5, 6.5, c.cyl('metal', 'h'), { 'data-part': 'muzzle-top' }),
        artEllipse(207, 64.5, 2.6, 4.2, ART.dark[1], { 'data-part': 'bore' }),
        artEllipse(207, 78.5, 5, 6.5, c.cyl('metal', 'h'), { 'data-part': 'muzzle-bottom' }),
        artEllipse(207, 78.5, 2.6, 4.2, ART.dark[1], { 'data-part': 'bore' }),
        artRect(196, 56, 4, 6, c.mat('metal', 'h'), 1, { 'data-part': 'bead' }),
        artRect(104, 86, 46, 9, c.cyl('brass', 'v'), 3, { 'data-part': 'shell' }),
        artRect(104, 87, 46, 1.6, RIM2, 0.8),
        artRect(104, 86, 11, 9, c.mat('brass', 'h'), 2, { 'data-part': 'shell-rim' }),
        artRect(148, 88, 6, 5, c.mat('accent', 'd'), 1.5, { 'data-part': 'shell-tip' }),
        artCircle(70, 72, 3.2, ART.dark[2], { 'data-part': 'pin' }),
        artRect(84, 96, 30, 4, 'rgba(0,0,0,.16)', 2, { 'data-part': 'shade' }),
        artEllipse(150, 92, 34, 4, 'rgba(0,0,0,.14)', { 'data-part': 'shade' })
      ],
      icon: (c) => [
        artPath('M2,30 Q6,22 16,20 L22,19 L24,32 L10,37 Q3,37 2,30 Z', c.mat('wood', 'd'), { 'data-part': 'stock' }),
        artRect(20, 18, 10, 14, c.cyl('metal', 'v'), 2, { 'data-part': 'receiver' }),
        artRect(28, 19, 20, 6, c.cyl('metal', 'v'), 2.5, { 'data-part': 'barrel-top' }),
        artRect(28, 26, 20, 6, c.cyl('metal', 'v'), 2.5, { 'data-part': 'barrel-bottom' }),
        artCircle(45, 22, 2, ART.dark[1], { 'data-part': 'bore' }),
        artCircle(45, 29, 2, ART.dark[1], { 'data-part': 'bore' }),
        artRect(22, 32, 6, 7, c.mat('dark', 'd'), 1.5, { 'data-part': 'trigger-guard' }),
        artRect(29, 20, 19, 1.4, RIM, 0.7)
      ]
    },

    /* ───────── 못총 · SPEC-arsenal §E ─────────
     * 공구다. 총이 아니라 **박는 물건**이라는 것이 실루엣에서 읽혀야 해서, 비스듬히 꽂힌 못 탄창 띠와
     * 코끝의 접촉 안전핀을 가장 크게 그렸다. 못 세 자루가 띠 밖으로 나와 있다. */
    nailgun: {
      detail: (c) => [
        artPath('M44,100 L70,54 L92,62 L66,112 Z', c.cyl('metal', 'r'), { 'data-part': 'magazine' }),
        artPath('M44,100 L70,54 L72.6,55 L47,101 Z', RIM2),
        artPath('M50,96 L74,60 L78,62 L54,98 Z', c.mat('dark', 'v'), { 'data-part': 'nail-strip' }),
        artRect(52, 86, 3, 16, ART.metal[0], 0, { 'data-part': 'nail' }),
        artRect(58, 78, 3, 16, ART.metal[1], 0, { 'data-part': 'nail' }),
        artRect(64, 70, 3, 16, ART.metal[0], 0, { 'data-part': 'nail' }),
        artRect(62, 48, 96, 40, c.cyl('accent', 'v'), 8, { 'data-part': 'body' }),
        artRect(64, 50, 92, 3, RIM, 1.5),
        artRect(62, 84, 96, 3, SEAM, 1.5),
        artPath('M70,48 Q104,36 140,44 L140,50 Q106,42 72,53 Z', 'rgba(255,122,125,.55)', { 'data-part': 'shell-light' }),
        artRect(94, 60, 44, 16, c.mat('dark', 'd'), 4, { 'data-part': 'vent' }),
        artRect(100, 63, 3, 10, ART.dark[2]),
        artRect(108, 63, 3, 10, ART.dark[2]),
        artRect(116, 63, 3, 10, ART.dark[2]),
        artRect(124, 63, 3, 10, ART.dark[2]),
        artPath('M62,88 L86,88 L80,118 L56,118 Z', c.cyl('rubber', 'd'), { 'data-part': 'grip' }),
        artPath('M62,88 L86,88 L85.2,91.4 L61.4,91.4 Z', RIM2),
        artRect(84, 88, 12, 5, c.mat('dark', 'v'), 2, { 'data-part': 'trigger' }),
        artRect(156, 54, 34, 28, c.cyl('metal', 'v'), 4, { 'data-part': 'nose-housing' }),
        artRect(157, 55, 32, 2.2, RIM, 1.1),
        artRect(186, 60, 20, 16, c.cyl('metal', 'h'), 3, { 'data-part': 'nose' }),
        artRect(204, 64, 10, 8, c.mat('dark', 'd'), 2, { 'data-part': 'tip' }),
        artRect(212, 66, 14, 4, ART.metal[0], 1, { 'data-part': 'driven-nail' }),
        artRect(224, 63, 4, 10, c.mat('metal', 'h'), 1, { 'data-part': 'nail-head' }),
        artPath('M188,52 L200,52 L198,60 L186,60 Z', c.mat('brass', 'd'), { 'data-part': 'safety' }),
        artCircle(80, 68, 4, ART.dark[2], { 'data-part': 'pivot' }),
        artCircle(81.2, 66.6, 1.5, RIM),
        artEllipse(110, 120, 40, 5, 'rgba(0,0,0,.16)', { 'data-part': 'shade' })
      ],
      icon: (c) => [
        artPath('M8,40 L17,18 L26,22 L17,44 Z', c.cyl('metal', 'r'), { 'data-part': 'magazine' }),
        artRect(14, 14, 22, 14, c.cyl('accent', 'v'), 3, { 'data-part': 'body' }),
        artRect(15, 15, 20, 1.6, RIM, 0.8),
        artPath('M14,28 L23,28 L20,42 L11,42 Z', c.cyl('rubber', 'd'), { 'data-part': 'grip' }),
        artRect(35, 17, 9, 9, c.cyl('metal', 'h'), 2, { 'data-part': 'nose' }),
        artRect(42, 20, 6, 3, ART.metal[0], 1, { 'data-part': 'nail' }),
        artRect(24, 18, 9, 5, c.mat('dark', 'd'), 1.5, { 'data-part': 'vent' })
      ]
    },

    /* ───────── 냉각총 · SPEC-arsenal §E ─────────
     * 등에 지는 냉매 탱크에서 호스가 나와 뭉툭한 노즐로 들어간다. 노즐 앞에는 서리 결정 셋 —
     * 화염방사기와 같은 골격을 쓰되 모든 뜨거운 색을 유리/금속의 찬 색으로 바꿔 쌍을 이루게 했다. */
    freezegun: {
      detail: (c) => [
        artRect(14, 40, 40, 72, c.cyl('metal', 'h'), 14, { 'data-part': 'tank' }),
        artRect(16, 42, 36, 4, RIM, 2),
        artRect(14, 104, 40, 4, SEAM, 2),
        artEllipse(34, 42, 20, 7, c.cyl('metal', 'v'), { 'data-part': 'tank-cap' }),
        artRect(28, 28, 12, 14, c.mat('dark', 'v'), 3, { 'data-part': 'valve' }),
        artCircle(34, 28, 7, c.cyl('brass', 'd'), { 'data-part': 'wheel' }),
        artCircle(34, 28, 3, ART.dark[2]),
        artRect(20, 58, 28, 22, c.mat('gloss', 'v'), 3, { 'data-part': 'gauge-plate' }),
        artCircle(34, 69, 9, c.cyl('gloss', 'd'), { 'data-part': 'gauge' }),
        artPath('M34,69 L40,63 L41.6,65 Z', ART.dark[2], { 'data-part': 'needle' }),
        artPath('M54,66 Q82,58 96,70 Q84,78 56,76 Z', c.cyl('rubber', 'd'), { 'data-part': 'hose' }),
        artPath('M54,66 Q82,58 96,70 L94,72 Q82,62 55,69 Z', RIM2),
        artRect(94, 56, 44, 32, c.cyl('metal', 'v'), 6, { 'data-part': 'body' }),
        artRect(95, 57, 42, 2.4, RIM, 1.2),
        artRect(94, 85, 44, 3, SEAM, 1.5),
        artPath('M100,88 L124,88 L118,118 L94,118 Z', c.cyl('rubber', 'd'), { 'data-part': 'grip' }),
        artPath('M100,88 L124,88 L123.2,91.4 L99.4,91.4 Z', RIM2),
        artRect(122, 88, 12, 5, c.mat('dark', 'v'), 2, { 'data-part': 'trigger' }),
        artRect(136, 60, 54, 24, c.cyl('metal', 'h'), 5, { 'data-part': 'nozzle' }),
        artRect(136, 61, 54, 2, RIM2, 1),
        artRect(150, 56, 6, 32, c.mat('gloss', 'v'), 2, { 'data-part': 'fin' }),
        artRect(162, 56, 6, 32, c.mat('gloss', 'v'), 2, { 'data-part': 'fin' }),
        artRect(174, 56, 6, 32, c.mat('gloss', 'v'), 2, { 'data-part': 'fin' }),
        artEllipse(190, 72, 7, 14, c.cyl('gloss', 'h'), { 'data-part': 'mouth' }),
        artEllipse(190, 72, 3.6, 10, ART.dark[1], { 'data-part': 'bore' }),
        artPath('M202,58 L206,66 L214,62 L209,72 L218,76 L208,78 L210,88 L202,80 L196,88 L198,78 L188,76 L197,72 L192,62 Z', 'rgba(246,250,254,.75)', { 'data-part': 'frost' }),
        artPath('M222,46 L224,52 L230,50 L226,56 L232,60 L225,60 L226,67 L221,61 L216,66 L218,59 L211,58 L217,55 L214,49 Z', 'rgba(242,246,253,.55)', { 'data-part': 'frost' }),
        artPath('M224,96 L226,101 L231,99 L228,104 L233,108 L227,108 L228,113 L224,108 L219,112 L221,106 L215,105 L220,102 L218,97 Z', 'rgba(246,250,254,.4)', { 'data-part': 'frost' }),
        artCircle(112, 70, 4, ART.dark[2], { 'data-part': 'port' }),
        artEllipse(120, 122, 44, 5, 'rgba(0,0,0,.16)', { 'data-part': 'shade' })
      ],
      icon: (c) => [
        artRect(3, 14, 12, 22, c.cyl('metal', 'h'), 5, { 'data-part': 'tank' }),
        artRect(4, 15, 10, 2, RIM, 1),
        artPath('M15,22 Q22,19 26,24 Q21,27 16,26 Z', c.cyl('rubber', 'd'), { 'data-part': 'hose' }),
        artRect(24, 18, 13, 11, c.cyl('metal', 'v'), 3, { 'data-part': 'body' }),
        artPath('M26,29 L34,29 L31,42 L23,42 Z', c.cyl('rubber', 'd'), { 'data-part': 'grip' }),
        artRect(36, 20, 9, 8, c.cyl('metal', 'h'), 2, { 'data-part': 'nozzle' }),
        artPath('M44,17 L45.6,21 L49,19 L46.8,23.6 L50,26 L46,26 L46.6,30 L43.6,27 L41,30 L42,26 L38,25 L41.6,23.4 L39.6,19.6 Z', 'rgba(246,250,254,.75)', { 'data-part': 'frost' })
      ]
    },

    /* ───────── 중력탄 · SPEC-arsenal §E ─────────
     * 직접 피해가 0 인 무기라 **총구에 아무것도 없고 구멍만 있다** — 사출관 끝의 검은 구와 그것을
     * 감는 두 개의 호가 전부다. 무기고에서 유일하게 가장 밝은 색이 하나도 없는 그림. */
    gravity: {
      detail: (c) => [
        artPath('M16,84 Q26,70 48,66 L62,64 L66,92 L38,100 Q20,102 16,84 Z', c.mat('dark', 'd'), { 'data-part': 'stock' }),
        artPath('M16,84 Q26,70 48,66 L62,64 L61.6,68 L48,70 Q28,74 19.4,86 Z', RIM2),
        artRect(58, 56, 36, 38, c.cyl('metal', 'v'), 5, { 'data-part': 'receiver' }),
        artRect(59, 57, 34, 2.4, RIM, 1.2),
        artRect(58, 92, 36, 2.6, SEAM, 1.3),
        artRect(64, 94, 12, 16, c.mat('dark', 'd'), 2, { 'data-part': 'trigger-guard' }),
        artPath('M69,96 Q73,104 69,109 Q66,103 69,96 Z', ART.dark[2], { 'data-part': 'trigger' }),
        artRect(66, 42, 20, 16, c.cyl('brass', 'v'), 3, { 'data-part': 'magazine' }),
        artRect(67, 43, 18, 1.8, RIM2, 0.9),
        artRect(92, 58, 72, 34, c.cyl('metal', 'v'), 8, { 'data-part': 'tube' }),
        artRect(92, 60, 72, 2.4, RIM, 1.2),
        artRect(92, 88, 72, 2.6, SEAM, 1.3),
        artRect(104, 56, 5, 38, c.mat('dark', 'v'), 1.5, { 'data-part': 'band' }),
        artRect(126, 56, 5, 38, c.mat('dark', 'v'), 1.5, { 'data-part': 'band' }),
        artRect(148, 56, 5, 38, c.mat('dark', 'v'), 1.5, { 'data-part': 'band' }),
        artEllipse(164, 75, 9, 20, c.cyl('metal', 'h'), { 'data-part': 'mouth' }),
        artEllipse(164, 75, 5, 15, ART.dark[1], { 'data-part': 'bore' }),
        artCircle(196, 75, 22, c.cyl('dark', 'd'), { 'data-part': 'well' }),
        artCircle(196, 75, 14, ART.dark[2], { 'data-part': 'core' }),
        artCircle(196, 75, 6, '#14171c', { 'data-part': 'singularity' }),
        artPath('M196,45 Q226,52 226,75 L221,75 Q221,56 195,50 Z', 'rgba(142,151,166,.55)', { 'data-part': 'arc' }),
        artPath('M196,105 Q166,98 166,75 L171,75 Q171,94 197,100 Z', 'rgba(142,151,166,.38)', { 'data-part': 'arc' }),
        artPath('M232,62 Q242,75 232,88 L236,88 Q246,75 236,62 Z', 'rgba(58,64,73,.5)', { 'data-part': 'arc' }),
        artCircle(176, 58, 3, 'rgba(212,218,228,.5)', { 'data-part': 'mote' }),
        artCircle(212, 96, 2.4, 'rgba(212,218,228,.4)', { 'data-part': 'mote' }),
        artCircle(82, 74, 4, ART.dark[2], { 'data-part': 'port' }),
        artEllipse(120, 112, 42, 5, 'rgba(0,0,0,.18)', { 'data-part': 'shade' })
      ],
      icon: (c) => [
        artPath('M2,32 Q6,24 16,22 L22,21 L24,34 L10,39 Q3,39 2,32 Z', c.mat('dark', 'd'), { 'data-part': 'stock' }),
        artRect(20, 19, 10, 14, c.cyl('metal', 'v'), 2, { 'data-part': 'receiver' }),
        artRect(28, 20, 12, 11, c.cyl('metal', 'v'), 3, { 'data-part': 'tube' }),
        artRect(29, 21, 10, 1.4, RIM, 0.7),
        artCircle(43, 25, 6, c.cyl('dark', 'd'), { 'data-part': 'well' }),
        artCircle(43, 25, 2.6, '#14171c', { 'data-part': 'singularity' }),
        artRect(22, 33, 6, 7, c.mat('dark', 'd'), 1.5, { 'data-part': 'trigger-guard' })
      ]
    }
  };

  /* ── §5: user-supplied PNG art ───────────────────────────────────────────
   * icons/weapons/<id>.png (256 × 256, transparent) wins over the SVG when the file ships, and §5 requires
   * the fallback to be SILENT when it does not.
   *
   * That rules out discovering the file at runtime. A content script cannot stat its own package, so the
   * only probe available is loading the URL — and loading a packaged resource that is not there prints
   * "Failed to load resource: net::ERR_FAILED" into the page console on every weapon, every activation.
   * (An earlier revision of this file did exactly that and suite C's zero-console-errors assertion caught
   * it.) An <img> that errors is also still an <img>: there is no in-band way to fall back afterwards
   * without a second layout pass.
   *
   * So the shipped set is DECLARED here instead. It is empty because this build packages no weapon PNGs;
   * dropping art in means adding its id to this set in the same commit, which is also what gives
   * tools/validate.js (existence + 256 × 256) and tools/package.js something to check and include. */
  const WEAPON_PNG_IDS = new Set([]);
  function artPngUrl(id) {
    try { return chrome.runtime.getURL('icons/weapons/' + id + '.png'); } catch (e) { return ''; }
  }
  function hasArtPng(id) { return WEAPON_PNG_IDS.has(id) && !!artPngUrl(id); }
  /* §9 item 5 — "drop icons/weapons/pistol.png in and weaponArt returns an <img>; take it away and it
   * returns an <svg> again". Because shipping a PNG means adding its id to the set above (the whole point
   * of the declared set: no runtime probe, no console noise), the switch the test needs to flip IS that
   * set. A function, so api.debug's flag-copying helpers skip it. */
  debug.weaponPng = (id, on) => {
    if (on) WEAPON_PNG_IDS.add(id); else WEAPON_PNG_IDS.delete(id);
    return Array.from(WEAPON_PNG_IDS);
  };

  /* weaponArt(id, size, lod) → a fresh <svg> (or an <img> when §5 art exists and weaponArt !== 'svg').
   * `size` is the WIDTH in px; `lod` is 'detail' | 'icon', defaulting by size (§2). Unknown ids fall back to
   * the hammer so a caller can never get null back. */
  function weaponArt(id, size, lod) {
    const entry = WEAPON_ART[id] || WEAPON_ART.hammer;
    const w = Math.max(8, +size || 24);
    const useIcon = (lod ? lod === 'icon' : w < DETAIL_MIN);
    const h = useIcon ? w : Math.round(w * 140 / 240 * 100) / 100;
    if (wpnOpts.weaponArt !== 'svg' && hasArtPng(id)) {
      const im = doc.createElement('img');
      im.src = artPngUrl(id);
      im.alt = '';
      im.className = 'crs-art';
      im.setAttribute('data-crs', '1');
      im.setAttribute('aria-hidden', 'true');
      im.style.width = px(w); im.style.height = px(w); im.style.display = 'block';
      return im;
    }
    const c = artCtx();
    const svg = svgNode('svg', {
      viewBox: useIcon ? VB_ICON : VB_DETAIL, width: String(w), height: String(h),
      fill: 'none', focusable: 'false', 'aria-hidden': 'true',
      class: 'crs-art', 'data-crs': '1', 'data-lod': useIcon ? 'icon' : 'detail'
    });
    svg.style.width = px(w); svg.style.height = px(h); svg.style.display = 'block';
    svg.style.overflow = 'visible';
    const nodes = (useIcon ? entry.icon : entry.detail)(c);
    if (c.defs.firstChild) svg.append(c.defs);
    for (const node of nodes) svg.append(node);
    return svg;
  }
  const weaponArtIds = () => Object.keys(WEAPON_ART);

  /* ── the same picture in the HUD grid and the ammo panel ──
   * The HUD lives in a shadow root with its own constructed stylesheet, so the
   * sizes are set through node.style (CSSOM only — the literal style ATTRIBUTE
   * is banned on hostile pages) and src/45-hud.js needs no edit at all. `weaponArt: 'emoji'` simply shows the
   * original emoji span again and hides the svg. Both call sites ask for the ICON lod explicitly: they are
   * 24–28 px, exactly what §2 drew that lod for. */
  const wpnOpts = { weaponArt: 'auto', viewmodel: true, loaded: false };
  const WEAPON_ART_MODES = ['auto', 'svg', 'emoji'];

  function statLine(W) {
    const pct = Math.round((W.critChance == null ? 0.1 : W.critChance) * 100);
    const swap = (swapMsOf(W.id) / 1000).toFixed(2).replace(/0$/, '');
    return msg('hudDamage') + ' ' + weaponLabel(W) + ' · ' + msg('statCrit') + ' ' + pct + '% · ' + msg('statSwap') + ' ' + swap + msg('unitSec');
  }
  /* One <span class="wart"> per weapon button, built once and kept; the emoji span stays in the DOM so the
   * option can flip back without rebuilding anything. Also (re)writes title / aria-label with the stats. */
  function syncWeaponArt() {
    if (!hudEls.weaponBtns) return;
    const svgMode = wpnOpts.weaponArt !== 'emoji';
    if (!hudEls.weaponArts) hudEls.weaponArts = {};
    try {
      for (const id of WEAPON_IDS) {
        const b = hudEls.weaponBtns[id];
        if (!b) continue;
        let art = hudEls.weaponArts[id];
        if (!art || !art.isConnected) {
          art = doc.createElement('span');
          art.className = 'wart';
          art.style.display = 'inline-flex';
          art.style.alignItems = 'center';
          art.style.justifyContent = 'center';
          const em0 = b.querySelector('.em');
          if (em0) b.insertBefore(art, em0); else b.append(art);
          hudEls.weaponArts[id] = art;
        }
        if (!art.firstChild) art.append(weaponArt(id, 26, 'icon'));
        art.style.display = svgMode ? 'inline-flex' : 'none';
        const em = b.querySelector('.em');
        if (em) em.style.display = svgMode ? 'none' : '';
        const W = WEAPONS[id];
        const t = slotKey(slotOf(id)) + ' · ' + msg(W.name) + ' · ' + statLine(W);
        b.title = t; b.setAttribute('aria-label', t);
      }
      syncAmmoArt();
    } catch (e) { /* ignore */ }
  }
  /* The ammo panel shows the weapon in hand at 28 px, left of the round count. */
  function syncAmmoArt() {
    if (!hudEls.ammo || !hudEls.aEmoji) return;
    const svgMode = wpnOpts.weaponArt !== 'emoji';
    try {
      if (!hudEls.aArt || !hudEls.aArt.isConnected) {
        const holder = doc.createElement('span');
        holder.className = 'aart';
        holder.style.display = 'inline-flex';
        holder.style.alignItems = 'center';
        hudEls.aArt = holder;
        hudEls.aEmoji.parentNode.insertBefore(holder, hudEls.aEmoji);
        hudEls.aArtFor = null;
      }
      if (hudEls.aArtFor !== state.weapon) {
        hudEls.aArtFor = state.weapon;
        while (hudEls.aArt.firstChild) hudEls.aArt.removeChild(hudEls.aArt.firstChild);
        hudEls.aArt.append(weaponArt(state.weapon, 28, 'icon'));
      }
      hudEls.aArt.style.display = svgMode ? 'inline-flex' : 'none';
      hudEls.aEmoji.style.display = svgMode ? 'none' : '';
    } catch (e) { /* ignore */ }
  }
