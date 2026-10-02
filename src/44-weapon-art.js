// ── v1.5 §1: weapon art — ten side silhouettes assembled node by node with createElementNS ──
  /* ===================================================================== */
  /* 5b. Weapon art (v1.5 §1)                                               */
  /*                                                                        */
  /* No binary assets ship: every weapon picture is an <svg> built with      */
  /* document.createElementNS and setAttribute, so it survives a strict CSP  */
  /* / Trusted-Types page exactly like the rest of the overlay, scales to    */
  /* any size and takes the theme colours straight from ART.                 */
  /*                                                                        */
  /* One picture, three places (§1): the viewmodel (§2), the HUD weapon      */
  /* grid buttons and the ammo panel. Shapes only — filled paths, rounded    */
  /* rects and circles, never strokes — because a stroke that scales badly   */
  /* is the fastest way to turn a 22 px button icon into mud. The goal is a  */
  /* silhouette you can NAME, not a rendering.                               */
  /* ===================================================================== */
  const ART = {
    metal: '#b9c2d0',      // bright metal: slides, blades, barrels
    metalMid: '#7c8696',   // mid metal: shrouds, guards, bodies
    metalDark: '#4a5361',  // dark metal: grips, magazines, stocks
    wood: '#8b6240',       // wood: hafts, handles, fuses
    accent: '#e5484d',     // the one hot colour: warheads, flame, plunger
    hot: '#ffb224',        // flame / spark core (accent's lighter partner)
    dark: '#2b3038'        // shadow: bomb body, holes, feet
  };

  function svgNode(tag, attrs) {
    const n = doc.createElementNS(SVG_NS, tag);
    if (attrs) for (const k of Object.keys(attrs)) n.setAttribute(k, String(attrs[k]));
    return n;
  }
  function artRect(x, y, w, h, fill, r) {
    return svgNode('rect', r ? { x, y, width: w, height: h, rx: r, ry: r, fill } : { x, y, width: w, height: h, fill });
  }
  function artPath(d, fill, rule) {
    return rule ? svgNode('path', { d, fill, 'fill-rule': rule }) : svgNode('path', { d, fill });
  }
  function artCircle(cx, cy, r, fill) { return svgNode('circle', { cx, cy, r, fill }); }

  /* Ten builders. Each pushes its shapes back-to-front into `out`; viewBox is 0 0 120 60 for all of them,
   * so the HUD can swap one for another without re-measuring anything. */
  const WEAPON_ART = {
    /* 나무 자루 + 직사각 머리 + 쐐기 뒷날 */
    hammer: () => [
      artRect(6, 26, 80, 8, ART.wood, 4),                       // haft
      artRect(8, 24, 22, 12, ART.metalDark, 5),                 // grip wrap
      artPath('M86,16 L62,27 L64,35 L86,28 Z', ART.metalMid),   // wedge claw hooking back
      artRect(84, 9, 28, 42, ART.metal, 4),                     // head block
      artRect(104, 9, 8, 42, ART.metalMid, 4)                   // striking face
    ],
    /* 슬라이드 + 그립 + 방아쇠울 */
    pistol: () => [
      artRect(38, 12, 76, 15, ART.metal, 3),                    // slide
      artRect(104, 16, 12, 7, ART.metalMid, 2),                 // muzzle
      artRect(38, 27, 58, 8, ART.metalMid, 2),                  // frame
      artPath('M42,33 L70,33 L58,59 L32,59 Z', ART.metalDark),  // grip
      artPath('M60,33 h24 v7 a12,12 0 0 1 -24,0 z M64,36 h16 v4 a8,8 0 0 1 -16,0 z', ART.metalMid, 'evenodd'),
      artRect(69, 35, 4, 8, ART.metal, 1)                       // trigger
    ],
    /* 긴 몸체 + 탄창 + 총열덮개 구멍 3개 */
    smg: () => [
      artRect(6, 20, 26, 12, ART.metalDark, 3),                 // stock
      artRect(24, 17, 78, 17, ART.metal, 3),                    // receiver + shroud
      artRect(100, 22, 18, 7, ART.metalMid, 3),                 // barrel
      artCircle(64, 25, 4, ART.dark), artCircle(77, 25, 4, ART.dark), artCircle(90, 25, 4, ART.dark),
      artPath('M44,34 L60,34 L57,57 L41,57 Z', ART.metalDark),  // magazine
      artPath('M26,34 L40,34 L36,52 L24,52 Z', ART.metalMid)    // grip
    ],
    /* 긴 총열 + 조준경 원통 + 개머리판 */
    sniper: () => [
      artPath('M2,24 L34,19 L34,41 L16,41 L2,33 Z', ART.wood),  // stock
      artRect(30, 21, 42, 16, ART.metal, 3),                    // receiver
      artRect(68, 25, 50, 7, ART.metalMid, 3),                  // barrel
      artRect(108, 23, 10, 11, ART.metalDark, 2),               // muzzle brake
      artRect(52, 19, 6, 5, ART.metalDark), artRect(82, 19, 6, 5, ART.metalDark),   // scope mounts
      artRect(46, 5, 48, 15, ART.metalDark, 7),                 // scope tube
      artRect(88, 5, 9, 15, ART.metalMid, 4),                   // objective bell
      artPath('M34,36 L48,36 L44,54 L30,52 Z', ART.metalDark)   // pistol grip
    ],
    /* 긴 자루 + 초승달 날 */
    axe: () => [
      artPath('M4,40 L72,18 L76,30 L8,52 Z', ART.wood),         // haft, raked down-left
      artPath('M4,40 L22,34 L26,46 L8,52 Z', ART.metalDark),    // butt wrap
      artPath('M58,11 L94,3 C110,13 110,47 94,57 L58,49 C70,40 70,20 58,11 Z', ART.metal),   // bit
      artRect(46, 20, 18, 20, ART.metalMid, 3)                  // poll + eye: where the haft enters the head
    ],
    /* 칼날 + 날밑 + 손잡이 + 둥근 자루머리 */
    sword: () => [
      artPath('M44,23 L104,25 L118,30 L104,35 L44,37 Z', ART.metal),   // blade
      artPath('M44,28 L108,29 L108,31 L44,32 Z', ART.metalMid),        // fuller
      artRect(38, 11, 9, 38, ART.metalMid, 3),                         // crossguard
      artRect(20, 26, 20, 8, ART.wood, 3),                             // grip
      artCircle(16, 30, 8, ART.metalMid)                               // pommel
    ],
    /* 둥근 몸체 + 심지 + 불꽃 */
    bomb: () => [
      artCircle(44, 36, 25, ART.metalDark),                     // rim: the near-black body needs an edge to read on a dark HUD
      artCircle(44, 36, 23, ART.dark),                          // body
      artCircle(35, 27, 6, ART.metalDark),                      // highlight
      artRect(37, 8, 14, 9, ART.metalDark, 3),                  // collar
      artPath('M45,11 C55,3 64,12 74,5 L77,10 C66,18 57,10 47,18 Z', ART.wood),   // fuse
      artCircle(84, 7, 7, ART.accent), artCircle(84, 7, 3.4, ART.hot)             // spark
    ],
    /* 발사관 + 탄두 원뿔 + 날개 + 조준 손잡이 */
    rocket: () => [
      /* the two fins (날개) are drawn FIRST so the warhead cone covers their roots: a fin that visibly
       * sprouts from under the cone reads as part of the rocket, a floating blade next to it does not. */
      artPath('M101,22 L89,8 L96,6 L107,21 Z', ART.metal),      // upper fin
      artPath('M101,36 L89,50 L96,52 L107,37 Z', ART.metal),    // lower fin
      artRect(16, 20, 80, 18, ART.metalMid, 6),                 // launch tube
      artPath('M10,10 L24,20 L24,38 L10,48 Z', ART.metalDark),  // rear flare
      artRect(86, 21, 12, 16, ART.metalDark, 2),                // exposed rocket body + collar
      artPath('M96,13 L120,29 L96,45 Z', ART.accent),           // warhead cone
      artRect(58, 10, 9, 11, ART.metal, 2),                     // optical sight
      artPath('M42,38 L56,38 L52,58 L38,58 Z', ART.metalDark)   // aiming grip
    ],
    /* 연료통 2개 + 호스 + 노즐 + 점화구 */
    flame: () => [
      artRect(6, 12, 22, 40, ART.metalMid, 10),                 // fuel tank A
      artRect(26, 15, 18, 34, ART.metalDark, 8),                // fuel tank B
      artPath('M44,27 C58,13 62,43 76,29 L76,37 C62,51 58,21 44,35 Z', ART.dark),   // hose
      artRect(70, 23, 30, 12, ART.metal, 5),                    // nozzle
      artRect(96, 20, 10, 18, ART.metalDark, 3),                // muzzle ring
      artPath('M74,35 L88,35 L84,53 L70,53 Z', ART.metalMid),   // grip
      artPath('M106,29 C114,22 112,12 109,6 C120,14 120,34 106,37 Z', ART.accent),  // pilot flame
      artPath('M108,30 C112,25 111,19 110,15 C117,21 116,31 108,34 Z', ART.hot)
    ],
    /* 기폭 장치 상자 + 플런저 + 안테나 */
    collapse: () => [
      artRect(36, 2, 38, 9, ART.accent, 4),                     // plunger handle
      artRect(51, 9, 8, 16, ART.metalMid),                      // plunger shaft
      artRect(22, 23, 68, 29, ART.metalDark, 5),                // detonator box
      artRect(26, 27, 60, 9, ART.dark, 3),                      // label plate
      artCircle(38, 44, 6, ART.metal), artCircle(56, 44, 6, ART.metalMid),   // dials
      artRect(74, 41, 12, 6, ART.accent, 2),                    // armed lamp
      artRect(18, 50, 76, 7, ART.dark, 3),                      // feet
      artPath('M22,44 C12,44 8,34 2,36 L2,42 C6,41 8,50 22,50 Z', ART.dark),   // firing lead
      artRect(100, 6, 5, 30, ART.metal, 2), artCircle(102, 4, 5, ART.accent) // antenna
    ]
  };

  /* weaponArt(id, size) → a fresh <svg>. `size` is the WIDTH in px; the 2:1 viewBox fixes the height.
   * Unknown ids fall back to the hammer so a caller can never get null back. */
  function weaponArt(id, size) {
    const build = WEAPON_ART[id] || WEAPON_ART.hammer;
    const w = Math.max(8, +size || 24), h = w / 2;
    const svg = svgNode('svg', {
      viewBox: '0 0 120 60', width: String(w), height: String(h),
      fill: 'none', focusable: 'false', 'aria-hidden': 'true',
      class: 'crs-art', 'data-crs': '1'
    });
    svg.style.width = px(w); svg.style.height = px(h); svg.style.display = 'block';
    svg.style.overflow = 'visible';
    for (const node of build()) svg.append(node);
    return svg;
  }
  const weaponArtIds = () => Object.keys(WEAPON_ART);

  /* ── v1.5 §1 / §3.3: the same picture in the HUD grid and the ammo panel ──
   * The HUD lives in a shadow root with its own constructed stylesheet, so the
   * sizes are set through node.style (CSSOM only — the literal style ATTRIBUTE
   * is banned on hostile pages) and src/45-hud.js needs no edit at all. `weaponArt: 'emoji'` simply shows the
   * original emoji span again and hides the svg. */
  const wpnOpts = { weaponArt: 'svg', viewmodel: true, loaded: false };
  const WEAPON_ART_MODES = ['svg', 'emoji'];

  function statLine(W) {
    const pct = Math.round((W.critChance == null ? 0.1 : W.critChance) * 100);
    const swap = (swapMsOf(W.id) / 1000).toFixed(2).replace(/0$/, '');
    return msg('hudDamage') + ' ' + weaponLabel(W) + ' · ' + msg('statCrit') + ' ' + pct + '% · ' + msg('statSwap') + ' ' + swap + msg('unitSec');
  }
  /* One <span class="wart"> per weapon button, built once and kept; the emoji span stays in the DOM so the
   * option can flip back without rebuilding anything. Also (re)writes title / aria-label with §3.3's stats. */
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
          art.append(weaponArt(id, 26));
          const em = b.querySelector('.em');
          if (em) b.insertBefore(art, em); else b.append(art);
          hudEls.weaponArts[id] = art;
        }
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
        hudEls.aArt.append(weaponArt(state.weapon, 28));
      }
      hudEls.aArt.style.display = svgMode ? 'inline-flex' : 'none';
      hudEls.aEmoji.style.display = svgMode ? 'none' : '';
    } catch (e) { /* ignore */ }
  }
