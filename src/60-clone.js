  /* ===================================================================== */
  /* 9. Cloning (recursive cloneTree + computed-style diff)                  */
  /* ===================================================================== */
  function substitute(src) {
    const d = doc.createElement('div');
    const s = gcs(src);
    const bg = s ? s.backgroundColor : '';
    d.style.backgroundColor = (bg && alphaOf(bg) > 0) ? bg : '#e8e8e8';
    d.style.border = '1px solid rgba(0,0,0,.15)';
    d.style.boxSizing = 'border-box';
    return d;
  }
  function canvasOf(src, w, h) {
    try {
      const c = doc.createElement('canvas');
      c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
      c.style.width = px(w); c.style.height = px(h);
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      return c;
    } catch (e) { return null; }
  }
  function copyAttrs(src, clone) {
    const attrs = src.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i], n = a.name;
      if (STRIP_ATTRS.has(n) || n.startsWith('on') || (n === 'role' && a.value === 'alert')) continue;
      try { if (a.namespaceURI) clone.setAttributeNS(a.namespaceURI, n, a.value); else clone.setAttribute(n, a.value); } catch (e) { /* ignore */ }
    }
    if (src.hasAttribute('open') && tagOf(src) === 'details') { try { clone.setAttribute('open', ''); } catch (e) { /* ignore */ } }
  }
  function copyInlineStyle(src, clone, isRoot) {
    try {
      const st = src.style;
      if (!st) return;
      for (let i = 0; i < st.length; i++) {
        const p = st[i];
        if (isRoot && (ROOT_INLINE_SKIP.has(p) || p.startsWith('transition') || p.startsWith('animation'))) continue;
        clone.style.setProperty(p, st.getPropertyValue(p), st.getPropertyPriority(p));
      }
    } catch (e) { /* ignore */ }
  }
  function copyFormState(src, clone) {
    const tag = tagOf(src);
    try {
      if (tag === 'input') { if (src.type !== 'file') clone.value = src.value; clone.checked = src.checked; }
      else if (tag === 'textarea') clone.value = src.value;
      else if (tag === 'select') clone.selectedIndex = src.selectedIndex;
    } catch (e) { /* ignore */ }
  }
  function cloneTree(src, st, depth, inShadow) {
    if (st.count >= st.cap) return null;
    if (src.nodeType === 3) { st.count++; return doc.createTextNode(src.data); }
    if (src.nodeType !== 1) return null;
    const tag = tagOf(src);
    if (DROP_TAGS.has(tag) && !(inShadow && (tag === 'style' || tag === 'link'))) return null;
    st.count++;
    const isSvg = src.namespaceURI === SVG_NS;
    let clone = null, atomic = false;
    if (tag === 'iframe' || tag === 'object' || tag === 'embed' || tag === 'audio') { clone = substitute(src); atomic = true; }   // audio: a live clone would start another playback (§12.6)
    else if (tag === 'canvas' || tag === 'video') {
      const w = depth === 0 ? st.rootW : (src.offsetWidth || (rectOf(src) || {}).width || 1);
      const h = depth === 0 ? st.rootH : (src.offsetHeight || (rectOf(src) || {}).height || 1);
      clone = canvasOf(src, w, h);
      if (clone) { clone.setAttribute('data-crs-cv', String(st.canvases.length)); st.canvases.push({ src, w, h }); }
      else clone = substitute(src);
      atomic = true;
    } else if (tag.indexOf('-') >= 0 && !src.shadowRoot && src.childNodes.length === 0) { clone = substitute(src); atomic = true; }
    else {
      try {
        if (isSvg) clone = doc.createElementNS(SVG_NS, src.localName || tag);   // keep camelCase (foreignObject, linearGradient, clipPath…)
        else if (tag.indexOf('-') >= 0 || (typeof HTMLUnknownElement !== 'undefined' && src instanceof HTMLUnknownElement)) clone = doc.createElement('div');
        else clone = doc.createElement(tag);
      } catch (e) { clone = doc.createElement('div'); }
      copyAttrs(src, clone);
    }
    copyInlineStyle(src, clone, depth === 0);
    st.pairs.push([src, clone, depth, isSvg]);
    if (atomic) return clone;
    if (FORM_TAGS.has(tag)) copyFormState(src, clone);
    if (depth >= st.maxDepth) return clone;
    if (src.shadowRoot) {
      let sh = null;
      try { sh = clone.attachShadow({ mode: 'open' }); } catch (e) { sh = null; }
      if (sh) {
        st.hasShadow = true;
        try { sh.adoptedStyleSheets = src.shadowRoot.adoptedStyleSheets; } catch (e) { /* ignore */ }
        for (const ch of src.shadowRoot.childNodes) { const c = cloneTree(ch, st, depth + 1, true); if (c) sh.append(c); }
      }
    }
    for (const ch of src.childNodes) { const c = cloneTree(ch, st, depth + 1, inShadow); if (c) clone.append(c); }
    if (tag === 'select') copyFormState(src, clone);
    return clone;
  }
  /* Diff computed styles of each original/clone pair and set only the differing
   * properties (important). Returns a replayable plan so sibling pieces (same
   * cloneTree traversal → same pair order) can skip the computed-style reads. */
  function diffStyles(st) {
    const plan = { n: st.pairs.length, tags: [], ops: [] };
    for (let k = 0; k < st.pairs.length; k++) {
      const [orig, clone, depth, isSvg] = st.pairs[k];
      plan.tags.push(tagOf(clone));
      const co = gcs(orig), cc = gcs(clone);
      if (!co || !cc) continue;
      let list = depth <= 2 ? STYLE_FULL : STYLE_STAR;
      if (isSvg && depth > 2) list = list.concat(STYLE_SVG_EXTRA);
      const vals = new Array(list.length);
      for (let i = 0; i < list.length; i++) vals[i] = co.getPropertyValue(list[i]);
      const diffs = [];
      for (let i = 0; i < list.length; i++) { if (vals[i] !== cc.getPropertyValue(list[i])) diffs.push(i); }
      for (const i of diffs) {
        const p = list[i];
        if (depth === 0 && (p === 'transform' || p === 'transform-origin' || p === 'position' || p === 'top' || p === 'left' || p === 'right' || p === 'bottom' || p === 'width' || p === 'height' || p.startsWith('margin'))) continue;
        let v = vals[i];
        if (depth === 0 && p === 'display' && v === 'inline') v = 'inline-block';
        imp(clone, p, v);
        plan.ops.push([k, p, v]);
      }
    }
    return plan;
  }
  function replayPlan(st, plan) {
    if (!plan || plan.n !== st.pairs.length) return false;
    for (let k = 0; k < plan.n; k++) if (tagOf(st.pairs[k][1]) !== plan.tags[k]) return false;
    for (const [k, p, v] of plan.ops) imp(st.pairs[k][1], p, v);
    return true;
  }
  function normalizeRoot(clone) {
    const pairs = [['position', 'relative'], ['inset', 'auto'], ['margin', '0'], ['transform', 'none'], ['translate', 'none'], ['rotate', 'none'], ['scale', 'none'],
      ['transition', 'none'], ['animation', 'none'], ['visibility', 'visible'], ['width', '100%'], ['height', '100%'], ['max-width', 'none'], ['max-height', 'none'],
      ['min-width', '0'], ['min-height', '0'], ['box-sizing', 'border-box'], ['pointer-events', 'none'], ['opacity', '1']];
    for (const [p, v] of pairs) imp(clone, p, v);
  }
  function buildStyledClone(el, rootW, rootH, cap, pieceClipHost, plan) {
    const st = { count: 0, cap, maxDepth: 6, pairs: [], canvases: [], hasShadow: false, rootW, rootH };
    const clone = cloneTree(el, st, 0, false);
    if (!clone) return null;
    pieceClipHost.append(clone);          // lay the clone out inside our subtree first
    st.plan = (plan && replayPlan(st, plan)) ? plan : diffStyles(st);
    normalizeRoot(clone);
    st.root = clone;
    return st;
  }
  function makeTextTransparent(st) {
    for (const [, clone] of st.pairs) { imp(clone, 'color', 'transparent'); imp(clone, '-webkit-text-fill-color', 'transparent'); imp(clone, 'text-shadow', 'none'); }
  }
