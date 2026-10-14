  /* ===================================================================== */
  /* 17. 인스펙터 모드 · 결과 공유 · 리플레이 (SPEC-product §5)                */
  /*                                                                        */
  /* Three features that share one property: none of them is a weapon.      */
  /* The inspector is the clearest case — §5 calls it 개발자용 차별화 기능    */
  /* and says "이 모드는 아무것도 부수지 않고 페이지에 쓰지 않는다", which is  */
  /* asserted rather than promised: every entry point a press can reach is   */
  /* wrapped and refuses while it is on.                                    */
  /* ===================================================================== */

  /* ───────────────────────────────────────────────────────────────────────
   * §5 인스펙터 (`I`)
   * ─────────────────────────────────────────────────────────────────────── */
  const inspect = { on: false, panel: null, title: null, list: null, el: null, sel: '', copied: '', copies: 0 };
  function inspectActive() { return !!(inspect.on && state.active); }

  /* ---- colour maths (the §7 assertion is "대비비가 손계산과 ±0.05") ---- */
  function inspectColor(str) {
    const m = /rgba?\(([^)]+)\)/.exec(str || '');
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || !isFinite(p[0]) || !isFinite(p[1]) || !isFinite(p[2])) return null;
    const a = p.length >= 4 && isFinite(p[3]) ? p[3] : 1;
    return { r: p[0], g: p[1], b: p[2], a };
  }
  function inspectOver(top, under) {
    const a = clamp(top.a, 0, 1);
    return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
  }
  /* WCAG 2.x relative luminance, exactly as the recommendation states it. */
  function inspectLum(c) {
    const f = (v) => { v = clamp(v, 0, 255) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  /* The background a reader actually sees behind this element: the first opaque ancestor background with
   * every translucent layer above it composited back down onto it, and the canvas (white) underneath. */
  function inspectBgOf(el) {
    const stack = [];
    let n = el, guard = 0;
    while (n && n.nodeType === 1 && guard++ < 40) {
      const s = gcs(n);
      const c = s ? inspectColor(s.backgroundColor) : null;
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
      n = parentOf(n);
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = inspectOver(stack[i], base);
    return base;
  }
  function inspectRatio(fg, bg) {
    const l1 = inspectLum(fg), l2 = inspectLum(bg);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }
  /* §5 "대비비와 WCAG 판정". Large text is 24 px, or 18.66 px at weight ≥ 700 — the recommendation's own
   * definition, so the verdict a reader gets here is the verdict an audit tool would give. */
  function inspectWcag(ratio, fontPx, weight) {
    const large = fontPx >= 24 || (fontPx >= 18.66 && weight >= 700);
    if (large) return ratio >= 4.5 ? 'AAA' : (ratio >= 3 ? 'AA' : msg('inspectFail'));
    return ratio >= 7 ? 'AAA' : (ratio >= 4.5 ? 'AA' : msg('inspectFail'));
  }

  /* ---- the unique selector (§7: `document.querySelector(sel) === el`) ---- */
  function inspectEscape(s) {
    try { return win.CSS.escape(s); } catch (e) { return String(s).replace(/[^A-Za-z0-9_-]/g, (c) => '\\' + c); }
  }
  function inspectUnique(el) {
    if (!el || el.nodeType !== 1) return '';
    const hits = (sel) => { try { return doc.querySelectorAll(sel).length === 1 && doc.querySelector(sel) === el; } catch (e) { return false; } };
    if (el.id && hits('#' + inspectEscape(el.id))) return '#' + inspectEscape(el.id);
    const parts = [];
    let n = el, guard = 0;
    while (n && n.nodeType === 1 && guard++ < 40) {
      const p = parentOf(n);
      let seg;
      if (n.id) seg = tagOf(n) + '#' + inspectEscape(n.id);
      else {
        seg = tagOf(n);
        if (p) {
          let same = 0, mine = 0;
          for (const c of p.children) { if (tagOf(c) === tagOf(n)) { same++; if (c === n) mine = same; } }
          if (same > 1) seg += ':nth-of-type(' + mine + ')';
        }
      }
      parts.unshift(seg);
      const sel = parts.join(' > ');
      if (hits(sel)) return sel;
      if (!p) break;
      n = p;
    }
    return parts.join(' > ');
  }

  /* ---- accessible name and role ----
   * A pragmatic subset of the accname / ARIA-in-HTML mappings: aria-label, aria-labelledby, alt, title and
   * then the element's own text, and the role table the §D3 archetypes already read the page through. */
  const INSPECT_ROLE = {
    a: 'link', button: 'button', input: 'textbox', select: 'combobox', textarea: 'textbox',
    img: 'img', svg: 'graphics-document', video: 'video', canvas: 'canvas',
    h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
    nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo', aside: 'complementary',
    section: 'region', article: 'article', form: 'form', table: 'table', tr: 'row', td: 'cell', th: 'columnheader',
    ul: 'list', ol: 'list', li: 'listitem', p: 'paragraph', summary: 'button', dialog: 'dialog'
  };
  function inspectRoleOf(el) {
    let r = null;
    try { r = el.getAttribute('role'); } catch (e) { r = null; }
    if (r && r.trim()) return r.trim();
    const tag = tagOf(el);
    if (tag === 'a') { let href = null; try { href = el.getAttribute('href'); } catch (e) { href = null; } return href == null ? 'generic' : 'link'; }
    return INSPECT_ROLE[tag] || 'generic';
  }
  function inspectNameOf(el) {
    try {
      const al = el.getAttribute('aria-label');
      if (al && al.trim()) return al.trim().slice(0, 80);
      const lb = el.getAttribute('aria-labelledby');
      if (lb) {
        const t = lb.split(/\s+/).map((id) => { const n = doc.getElementById(id); return n ? (n.textContent || '').trim() : ''; }).filter(Boolean).join(' ');
        if (t) return t.slice(0, 80);
      }
      const alt = el.getAttribute('alt');
      if (alt != null && alt.trim()) return alt.trim().slice(0, 80);
      const ti = el.getAttribute('title');
      if (ti && ti.trim()) return ti.trim().slice(0, 80);
      return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    } catch (e) { return ''; }
  }
  function inspectClasses(el) {
    let cls = '';
    try { cls = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || ''); } catch (e) { cls = ''; }
    return cls.split(/\s+/).filter(Boolean);
  }
  /* Everything §5 lists, as data. The panel renders this object and debug.inspectAt() returns it. */
  function inspectData(el) {
    if (!el || el.nodeType !== 1) return null;
    const s = gcs(el) || {};
    const r = rectOf(el) || { width: 0, height: 0 };
    const fontPx = parseFloat(s.fontSize) || 0;
    const weight = parseInt(s.fontWeight, 10) || (s.fontWeight === 'bold' ? 700 : 400);
    const bg = inspectBgOf(el);
    const fgRaw = inspectColor(s.color) || { r: 0, g: 0, b: 0, a: 1 };
    const fg = fgRaw.a < 1 ? inspectOver(fgRaw, bg) : fgRaw;
    const ratio = inspectRatio(fg, bg);
    const h = hpOf(el);
    const sel = inspectUnique(el);
    let kids = 0;
    try { kids = el.children ? el.children.length : 0; } catch (e) { kids = 0; }
    const rgb = (c) => 'rgb(' + Math.round(c.r) + ', ' + Math.round(c.g) + ', ' + Math.round(c.b) + ')';
    return {
      tag: tagOf(el).toUpperCase(),
      id: el.id || null,
      classes: inspectClasses(el),
      selector: sel,
      /* §7's acceptance test is literally `querySelector(sel) === el`, so the product answers it itself —
       * a selector that does not come back to this element is a bug the panel can show rather than hide. */
      selectorOk: (function () { try { return doc.querySelector(sel) === el; } catch (e) { return false; } })(),
      width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10,
      fontFamily: String(s.fontFamily || '').split(',')[0].replace(/["']/g, '').trim(),
      fontSize: fontPx, fontWeight: weight,
      color: rgb(fg), background: rgb(bg),
      contrast: Math.round(ratio * 100) / 100, wcag: inspectWcag(ratio, fontPx, weight),
      zIndex: String(s.zIndex || 'auto'), position: String(s.position || 'static'), display: String(s.display || ''),
      role: inspectRoleOf(el), name: inspectNameOf(el),
      children: kids,
      hp: Math.max(0, Math.round(h.hp)), hpMax: h.max
    };
  }

  /* ---- the panel. Our own overlay node under `root`; nothing is written to the page. ---- */
  function inspectBuild() {
    if (inspect.panel && inspect.panel.isConnected) return inspect.panel;
    if (!root) return null;
    const box = mk('div', 'crs-inspect');
    const title = mk('div', 'crs-inspect-title');
    const list = mk('div', 'crs-inspect-rows');
    box.append(title, list);
    root.append(box);
    inspect.panel = box; inspect.title = title; inspect.list = list;
    return box;
  }
  function inspectClear() {
    const n = inspect.panel;
    inspect.panel = inspect.title = inspect.list = null;
    inspect.el = null; inspect.sel = '';
    if (n) { try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } }
  }
  function inspectRow(label, value) {
    const row = mk('div', 'crs-inspect-row');
    const k = mk('span', 'crs-inspect-k'); k.textContent = label;
    const v = mk('span', 'crs-inspect-v'); v.textContent = value;
    row.append(k, v);
    return row;
  }
  function inspectRender(el) {
    const box = inspectBuild();
    if (!box) return null;
    const d = el ? inspectData(el) : null;
    inspect.el = el || null;
    inspect.sel = d ? d.selector : '';
    try {
      if (!d) { box.classList.remove('on'); return null; }
      box.classList.add('on');
      inspect.title.textContent = d.tag + (d.id ? '#' + d.id : '') + (d.classes.length ? '.' + d.classes.slice(0, 3).join('.') : '');
      while (inspect.list.firstChild) inspect.list.removeChild(inspect.list.firstChild);
      const rows = [
        [msg('inspectSelector'), d.selector],
        [msg('inspectBox'), d.width + ' × ' + d.height],
        [msg('inspectFont'), d.fontFamily + ' ' + d.fontSize + 'px / ' + d.fontWeight],
        [msg('inspectColors'), d.color + ' · ' + d.background],
        [msg('inspectContrast'), d.contrast.toFixed(2) + ' : 1 · ' + d.wcag],
        [msg('inspectStacking'), 'z ' + d.zIndex + ' · ' + d.position + ' · ' + d.display],
        [msg('inspectRole'), d.role],
        [msg('inspectName'), d.name || '—'],
        [msg('inspectChildren'), String(d.children)],
        [msg('labelHealth'), d.hp + ' / ' + d.hpMax]
      ];
      for (const [k, v] of rows) inspect.list.append(inspectRow(k, v));
      // keep the panel out from under the cursor: it sits on the side of the screen the pointer is not on
      const left = state.hoverX > viewW() / 2;
      box.style.setProperty('left', left ? '24px' : 'auto');
      box.style.setProperty('right', left ? 'auto' : '24px');
    } catch (e) { /* ignore */ }
    return d;
  }
  function inspectHide() {
    inspect.el = null; inspect.sel = '';
    if (inspect.panel) { try { inspect.panel.classList.remove('on'); } catch (e) { /* ignore */ } }
  }
  /* §5 "클릭하면 선택자를 복사한다." The clipboard write is best-effort (a page may deny it); the selector is
   * published on the API either way, so the feature is still usable and still testable where it is denied. */
  function inspectCopy() {
    if (!inspect.sel) return false;
    inspect.copied = inspect.sel;
    inspect.copies++;
    safe(() => win.navigator.clipboard.writeText(inspect.sel));
    toast('📋 ' + msg('inspectCopied') + ' · ' + inspect.sel);
    return inspect.sel;
  }
  function inspectEnable() {
    if (inspect.on) return true;
    inspect.on = true;
    challengeStop(true);   // an inspector pass is not a run: nothing it does could advance a challenge
    stopHold(); cancelSlash(); scopeOff();
    try { docEl.classList.add('crs-inspect-on'); } catch (e) { /* ignore */ }
    if (targetBox) { try { targetBox.classList.add('crs-inspect-box'); } catch (e) { /* ignore */ } }
    inspectBuild();
    toast(msg('inspectOn'));
    announce(msg('inspectOn'));
    refreshHover();
    return true;
  }
  function inspectDisable() {
    if (!inspect.on) return false;
    inspect.on = false;
    try { docEl.classList.remove('crs-inspect-on'); } catch (e) { /* ignore */ }
    if (targetBox) { try { targetBox.classList.remove('crs-inspect-box'); } catch (e) { /* ignore */ } }
    inspectClear();
    if (state.active) { toast(msg('inspectOff')); announce(msg('inspectOff')); refreshHover(); }
    return true;
  }
  function inspectToggle() { return inspect.on ? (inspectDisable(), false) : (inspectEnable(), true); }
  function inspectInfo() {
    return { on: inspect.on, selector: inspect.sel, copied: inspect.copied, copies: inspect.copies, data: inspect.el ? inspectData(inspect.el) : null };
  }

  /* §5 "공격이 완전히 꺼지고". Every entry point a press, a drag or the keyboard cursor can reach goes
   * through one of these three, so the refusal is structural rather than a checklist of call sites. */
  const smashInspect = smashAt;
  smashAt = function (x, y, weaponId) {
    if (inspectActive()) return false;
    const r = smashInspect(x, y, weaponId);
    replayRecord('smash', [x, y]);
    return r;
  };
  const slashInspect = slashSegment;
  slashSegment = function (x1, y1, x2, y2, mid) {
    if (inspectActive()) return false;
    const r = slashInspect(x1, y1, x2, y2, mid);
    replayRecord('slash', [x1, y1, x2, y2]);
    return r;
  };
  const altPressInspect = altPressDown;
  altPressDown = function (id, x, y, pointerId) {
    if (inspectActive()) return false;
    return altPressInspect(id, x, y, pointerId);
  };
  /* The keyboard aim cursor (SPEC-settings §3.3) fires a drag weapon by calling startSlash() + resolveSlash()
   * directly rather than through altPressDown(), so the marquee has to be refused at its own door too. */
  const startSlashInspect = startSlash;
  startSlash = function (x, y, pointerId) {
    if (inspectActive()) return false;
    return startSlashInspect(x, y, pointerId);
  };
  /* §5 "호버 박스가 파랗게 바뀐다" and "패널에 … 를 보여준다". The hover pick is the PHYSICAL one here, not
   * the §D1 focus answer: an inspector that could only look at enemies would be useless on a quiet page. */
  const refreshHoverInspect = refreshHover;
  refreshHover = function () {
    if (!inspectActive()) return refreshHoverInspect();
    if (!state.active) return;
    if (state.overHud || state.hoverX < 0) { showTarget(null); inspectHide(); crosshairHover(); return; }
    showTarget(pickPhysical(state.hoverX, state.hoverY, null, { noLock: true }));
    inspectRender(state.hoverEl);
    crosshairHover();
  };

  /* ───────────────────────────────────────────────────────────────────────
   * §5 결과 공유 (`P`)
   *
   * `chrome.tabs.*` does not exist in a content script, so the capture is asked for by MESSAGE and performed
   * by the service worker — which is also the only context `chrome.tabs.captureVisibleTab` works in. It runs
   * on the activeTab grant the toolbar click already gave us: NO new permission, which is §8's completion
   * criterion. "제한된 페이지에서는 캡처 실패를 토스트로 알린다" is the else branch below, and it is also what
   * a context with no runtime at all gets.
   * ─────────────────────────────────────────────────────────────────────── */
  const shareState = { pending: false, last: null, sent: 0 };
  function shareCaption() {
    const p = state.player;
    let origin = '';
    try { origin = String(win.location.host || win.location.origin || ''); } catch (e) { origin = ''; }
    return {
      title: String(doc.title || '').slice(0, 160),
      origin: origin.slice(0, 160),
      mode: state.mode,
      score: p.score, kills: p.kills,
      pieces: debrisCount(), damage: state.damageDealt,
      at: Date.now()
    };
  }
  function shareDone(res) {
    shareState.pending = false;
    const ok = !!(res && res.ok);
    shareState.last = ok ? { ok: true, at: Date.now() } : { ok: false, reason: (res && res.reason) || 'unavailable', at: Date.now() };
    toast(ok ? '📷 ' + msg('shareOpened') : '⚠ ' + msg('shareFailed'));
    return ok;
  }
  function shareNow() {
    if (!state.active) return false;
    shareState.pending = true;
    shareState.sent++;
    const r = safe(() => chrome.runtime.sendMessage({ type: 'crash:share', caption: shareCaption() }));
    if (r && typeof r.then === 'function') r.then((res) => shareDone(res), () => shareDone(null));
    else shareDone(r === undefined ? null : r);
    return true;
  }
  function shareInfo() { return { pending: shareState.pending, sent: shareState.sent, last: shareState.last ? Object.assign({}, shareState.last) : null }; }

  /* ───────────────────────────────────────────────────────────────────────
   * §5 리플레이
   *
   * "`recordReplay` 가 켜져 있으면 모든 조작을 `{ t, op, args }` 로 2000개까지 기록한다."
   * The recorder wraps the five calls that ARE the player's operations; the playback timer is deliberately
   * NOT one of the tracked later() timers, because a recording may contain a `restore` op and restore()
   * clears every tracked timer — the replay would cancel its own next step. It is cleared explicitly by
   * replayStop() and by deactivate() instead, so nothing of it outlives the session either.
   * ─────────────────────────────────────────────────────────────────────── */
  const REPLAY_MAX = 2000;
  const REPLAY_OPS = ['smash', 'slash', 'weapon', 'restore', 'reload'];
  const REPLAY_KEY = 'crsReplays';
  const REPLAY_KEEP = 10;              // §5 "최대 10, FIFO"
  const REPLAY_MAX_BYTES = 1048576;    // §5 "1MB 상한"
  const REPLAY_VIEWPORT_TOL = 0.05;    // §5 "뷰포트가 5% 이상 다르면"
  const replay = { ops: [], startedAt: 0, playing: false, step: 0, scaled: false, loaded: null, played: 0, dropped: 0 };

  function replayOn() { return settingsGet('recordReplay') === true; }
  function replayPlaying() { return !!replay.playing; }
  function replayRecord(op, args) {
    if (!state.active || replay.playing || !replayOn()) return false;
    if (REPLAY_OPS.indexOf(op) === -1) return false;
    if (!replay.startedAt) replay.startedAt = now();
    if (replay.ops.length >= REPLAY_MAX) { replay.dropped++; return false; }
    const a = [];
    for (const v of (args || [])) a.push(typeof v === 'number' ? Math.round(v * 100) / 100 : String(v));
    replay.ops.push({ t: Math.round(now() - replay.startedAt), op, args: a });
    return true;
  }
  function replayExport() {
    return { v: 1, startedAt: replay.startedAt ? Math.round(replay.startedAt) : 0, viewport: { w: viewW(), h: viewH() }, ops: replay.ops.map((o) => ({ t: o.t, op: o.op, args: o.args.slice() })) };
  }
  /* Strict: anything it cannot vouch for is refused outright rather than repaired. */
  function replayValidate(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    if (obj.v !== 1) return null;
    const vp = obj.viewport;
    if (!vp || typeof vp !== 'object' || !(vp.w > 0) || !(vp.h > 0) || !isFinite(vp.w) || !isFinite(vp.h)) return null;
    if (!Array.isArray(obj.ops) || obj.ops.length > REPLAY_MAX) return null;
    const ops = [];
    let last = -1;
    for (const o of obj.ops) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
      const t = Number(o.t);
      if (!isFinite(t) || t < 0 || t < last) return null;
      if (typeof o.op !== 'string' || REPLAY_OPS.indexOf(o.op) === -1) return null;
      const args = Array.isArray(o.args) ? o.args : [];
      if (args.length > 4) return null;
      for (const v of args) {
        if (typeof v === 'number') { if (!isFinite(v)) return null; }
        else if (typeof v === 'string') { if (v.length > 40) return null; }
        else return null;
      }
      if (o.op === 'weapon' && WEAPON_IDS.indexOf(args[0]) === -1) return null;
      if ((o.op === 'smash' && args.length !== 2) || (o.op === 'slash' && args.length !== 4)) return null;
      ops.push({ t, op: o.op, args: args.slice() });
      last = t;
    }
    return { v: 1, startedAt: Number(obj.startedAt) || 0, viewport: { w: vp.w, h: vp.h }, ops };
  }
  function replayImport(obj) {
    let bytes = 0;
    try { bytes = JSON.stringify(obj).length; } catch (e) { bytes = REPLAY_MAX_BYTES + 1; }
    if (bytes > REPLAY_MAX_BYTES) { toast('⚠ ' + msg('replayBad')); return false; }
    const data = replayValidate(obj);
    if (!data) { toast('⚠ ' + msg('replayBad')); return false; }
    replay.loaded = data;
    return true;
  }
  function replayBadge(on) {
    const n = hudEls.replay;
    if (!n) return;
    try {
      n.classList.toggle('on', !!on);
      if (hudEls.fallback) n.style.display = on ? 'block' : 'none';
    } catch (e) { /* ignore */ }
  }
  function replayStop() {
    if (replay.step) { try { clearT(replay.step); } catch (e) { /* ignore */ } replay.step = 0; }
    if (!replay.playing) { replayBadge(false); return false; }
    replay.playing = false;
    replayBadge(false);
    return true;
  }
  function replayRun(op, sx, sy) {
    const a = op.args || [];
    try {
      if (op.op === 'smash') return smashAt(a[0] * sx, a[1] * sy);
      if (op.op === 'slash') return slashSegment(a[0] * sx, a[1] * sy, a[2] * sx, a[3] * sy);
      if (op.op === 'weapon') return setWeapon(a[0]);
      if (op.op === 'restore') return restore();
      if (op.op === 'reload') return reloadNow();
    } catch (e) { state.lastError = String((e && e.stack) || e); }
    return false;
  }
  function replayPlay(obj, opts) {
    if (!state.active || replay.playing) return Promise.resolve(false);
    const data = replayValidate(obj || replay.loaded || replayExport());
    if (!data || !data.ops.length) { if (!data) toast('⚠ ' + msg('replayBad')); return Promise.resolve(false); }
    let speed = Number(opts && opts.speed);
    if (!isFinite(speed) || speed <= 0) speed = 1;
    speed = clamp(speed, 0.1, 20);
    /* §5 "뷰포트가 5% 이상 다르면 좌표를 보정하고 경고한다." */
    const sx = viewW() / data.viewport.w, sy = viewH() / data.viewport.h;
    replay.scaled = Math.abs(sx - 1) >= REPLAY_VIEWPORT_TOL || Math.abs(sy - 1) >= REPLAY_VIEWPORT_TOL;
    replay.playing = true;
    replay.played++;
    replayBadge(true);
    if (replay.scaled) toast('⚠ ' + msg('replayScaled'));
    return new Promise((resolve) => {
      let i = 0;
      const finish = (ok) => {
        replay.step = 0;
        if (replay.playing) { replay.playing = false; replayBadge(false); if (ok && state.active) toast(msg('replayDone')); }
        resolve(!!ok);
      };
      const step = () => {
        replay.step = 0;
        if (!replay.playing || !state.active) { finish(false); return; }
        replayRun(data.ops[i], sx, sy);
        i++;
        if (i >= data.ops.length) { finish(true); return; }
        const gap = Math.max(0, data.ops[i].t - data.ops[i - 1].t) / speed;
        replay.step = setT(step, scaleMs(gap));
      };
      replay.step = setT(step, Math.min(50, scaleMs(data.ops[0].t / speed)));
    });
  }
  function replayReset() { replay.ops.length = 0; replay.startedAt = 0; replay.dropped = 0; return true; }
  function replayInfo() {
    return {
      recording: replayOn(), playing: replay.playing, scaled: replay.scaled,
      count: replay.ops.length, dropped: replay.dropped, max: REPLAY_MAX, played: replay.played,
      loaded: replay.loaded ? replay.loaded.ops.length : null
    };
  }
  /* §5 "저장은 `crsReplays`(최대 10, FIFO)". */
  function replaySave(obj) {
    const data = replayValidate(obj || replayExport());
    if (!data || !data.ops.length) return false;
    safeThen(() => chrome.storage.local.get([REPLAY_KEY]), (res) => {
      const list = (res && Array.isArray(res[REPLAY_KEY])) ? res[REPLAY_KEY].slice() : [];
      list.push(Object.assign({ savedAt: Date.now() }, data));
      while (list.length > REPLAY_KEEP) list.shift();   // FIFO: the oldest goes first
      const patch = {}; patch[REPLAY_KEY] = list;
      safe(() => chrome.storage.local.set(patch));
    });
    return true;
  }
  function replayList(cb) {
    safeThen(() => chrome.storage.local.get([REPLAY_KEY]), (res) => {
      const list = (res && Array.isArray(res[REPLAY_KEY])) ? res[REPLAY_KEY] : [];
      try { cb(list); } catch (e) { /* ignore */ }
    });
    return true;
  }

  /* ---- the two remaining recorder wrappers (smashAt / slashSegment are above, with the inspector) ---- */
  const setWeaponReplay = setWeapon;
  setWeapon = function (rawId, opts) {
    const r = setWeaponReplay(rawId, opts);
    if (r && !(opts && opts.silent)) replayRecord('weapon', [r]);
    return r;
  };
  const restoreReplay = restore;
  restore = function () {
    replayRecord('restore', []);
    return restoreReplay();
  };
  const reloadReplay = reloadNow;
  reloadNow = function () {
    const r = reloadReplay();
    if (r) replayRecord('reload', []);
    return r;
  };

  /* ---- lifecycle: nothing here may outlive the session (§7 무흔적) ---- */
  const deactivateInspect = deactivate;
  deactivate = function (silent) {
    replayStop();
    inspect.on = false;
    inspectClear();
    try { docEl.classList.remove('crs-inspect-on'); } catch (e) { /* ignore */ }
    return deactivateInspect(silent);
  };

  debug.inspectAt = (x, y) => {
    const el = pickPhysical(+x, +y, null, { noLock: true });
    return el ? inspectData(el) : null;
  };
  debug.inspectInfo = () => inspectInfo();
  debug.replayInfo = () => replayInfo();
  debug.shareInfo = () => shareInfo();

  const INSPECT_API = {
    on: () => inspectEnable(),
    off: () => inspectDisable(),
    toggle: () => inspectToggle(),
    at: (x, y) => debug.inspectAt(x, y),
    state: () => inspectInfo(),
    copy: () => inspectCopy()
  };
  const REPLAY_API = {
    export: () => replayExport(),
    import: (obj) => replayImport(obj),
    play: (obj, opts) => replayPlay(obj, opts),
    stop: () => replayStop(),
    reset: () => replayReset(),
    save: (obj) => replaySave(obj),
    list: (cb) => replayList(cb),
    state: () => replayInfo()
  };
