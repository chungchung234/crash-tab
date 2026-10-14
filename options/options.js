/* 화면부수기 — 옵션 페이지 (SPEC-product §1 · §2 · §5 · §6).
 *
 * 확장 페이지다. content.js 는 여기서 돌지 않으므로 이 파일은 제품에게 무엇도 물어볼 수 없고,
 * 대신 **두 생성물과 저장소**를 직접 읽는다:
 *
 *   settings-schema.json   설정의 단일 소스 (SPEC-settings §1.1 — 빌드가 content.js 에 박아 넣는
 *                          그 파일 그대로를 chrome.runtime.getURL 로 읽는다)
 *   options/arsenal.json   무기 표와 밸런스 파생값. `node tools/balance.js --write` 가 만들고
 *                          `--check` 가 낡으면 CI 에서 깨진다 — 손으로 고치는 두 번째 사본이 아니다
 *   chrome.storage         sync: `crs.<key>` 설정과 `crsLoadout` / `crsLoadoutPreset`
 *                          local: `crsStats` (§2) · `crsCustomWeapons` (§6) · `crsReplays` (§5)
 *
 * 규칙은 주입되는 코드와 같다 (CLAUDE.md, tools/validate.js R9): `innerHTML` · `outerHTML` ·
 * `insertAdjacentHTML` · `document.write` · `eval` · `new Function` 을 쓰지 않는다. DOM 은 전부
 * createElement / textContent 로 만들고 SVG 는 createElementNS + setAttribute 로 만든다.
 *
 * **외부 리소스를 전혀 쓰지 않는다.** 폰트는 시스템 폰트, 그림은 인라인 SVG, fetch 는
 * chrome-extension:// 안의 두 JSON 뿐이다. 네트워크로 나가는 요청이 하나도 없다는 것은
 * 스위트 D 가 요청 목록으로 직접 확인한다.
 *
 * 중복에 대하여 — 사용자 정의 무기 검증(§6)과 리플레이 검증(§5)은 콘텐츠 스크립트에도 있고 여기에도
 * 있다. 확장 페이지에서 콘텐츠 스크립트의 함수를 부를 방법이 없기 때문이다. 두 벌 다 명세의 규칙을
 * 그대로 적은 것이고, 규칙이 바뀌면 둘 다 고쳐야 한다. 그 사실을 여기 적어 둔다.
 */
'use strict';

(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SETTING_PREFIX = 'crs.';
  const REPO_URL = 'https://github.com/chungchung234/crash-tab';
  const LICENSE = 'Apache-2.0';
  const LIFE_KEY = 'crsStats';
  const CW_KEY = 'crsCustomWeapons';
  const REPLAY_KEY = 'crsReplays';

  /* §6 의 검증 규칙 — src/96-custom.js 와 글자 그대로 같은 것이다. */
  const CW_MAX = 10;
  const CW_ID_RE = /^cw_[a-z0-9_]{1,20}$/;
  const CW_KINDS = ['hammer', 'gun', 'bomb'];
  const CW_CRACKS = ['hammer', 'gun'];
  const CW_SOUNDS = ['hammer', 'thump', 'gun', 'bomb'];
  const CW_NAME_MAX = 20;
  const CW_EMOJI_MAX = 4;
  /* §5 의 리플레이 검증 — src/98-inspect.js 와 같은 규칙이다. */
  const REPLAY_OPS = ['smash', 'slash', 'weapon', 'restore', 'reload'];
  const REPLAY_MAX = 2000;
  const REPLAY_MAX_BYTES = 1048576;

  const $ = (id) => document.getElementById(id);

  /* `msg(key, fallback)` is deliberately spelled the way the injected code spells it: tools/validate.js
   * R6 / R7 look for a string literal handed straight to msg(), so every static label on this page is
   * a reference the validator can actually SEE. The handful of keys that are BUILT from a value are
   * assembled into a variable first, because a concatenation inside the call would read to R6 as a
   * literal reference to the prefix alone.
   */
  function msgRaw(key) {
    try { const s = chrome.i18n.getMessage(key); if (s) return s; } catch (e) { /* ignore */ }
    return '';
  }
  function msg(key, fallback) { return msgRaw(key) || fallback; }
  function setText(node, s) { if (node) node.textContent = s == null ? '' : String(s); }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k of Object.keys(attrs || {})) n.setAttribute(k, String(attrs[k]));
    return n;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  let toastTimer = 0;
  function toast(text) {
    const n = $('toast');
    if (!n) return;
    setText(n, text);
    n.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastTimer = 0; n.classList.remove('show'); }, 2400);
  }

  /* ---- storage (every call resolves, never rejects) ---- */
  function area(name) {
    return {
      get(keys) {
        return new Promise((resolve) => {
          try {
            const r = chrome.storage[name].get(keys);
            if (r && typeof r.then === 'function') r.then((v) => resolve(v || {}), () => resolve({}));
            else resolve(r || {});
          } catch (e) { resolve({}); }
        });
      },
      set(obj) {
        return new Promise((resolve) => {
          try {
            const r = chrome.storage[name].set(obj);
            if (r && typeof r.then === 'function') r.then(() => resolve(true), () => resolve(false));
            else resolve(true);
          } catch (e) { resolve(false); }
        });
      }
    };
  }
  const sync = area('sync');
  const local = area('local');

  /* =====================================================================
   * 무기 그림 — 인라인 SVG (§1 "무기 비교표: … SVG 그림 포함")
   *
   * src/44-weapon-art.js 의 그림은 content.js 안에 있고 확장 페이지에서 불러올 수 없다
   * (src/ 는 배포되지 않는다). 그래서 여기에는 24×24 스트로크 글리프 한 벌을 둔다 — 같은
   * 무기를 가리키는 **요약 기호**이지 그 그림의 사본이 아니다. 외부 파일이 하나도 없다.
   * ===================================================================== */
  const GLYPH = {
    hammer: [['path', { d: 'M5 4h10v5H5z' }], ['path', { d: 'M10 9v11' }]],
    pistol: [['path', { d: 'M4 7h11v4h-3l-2 5H8l1-5H4z' }]],
    smg: [['path', { d: 'M3 8h14v4H9l-1 4H6v-4H3z' }], ['path', { d: 'M12 12v5' }]],
    sniper: [['path', { d: 'M3 11h16' }], ['circle', { cx: 16, cy: 11, r: 3.4 }], ['path', { d: 'M6 11v4' }]],
    axe: [['path', { d: 'M12 4c4 0 7 2 7 5s-3 5-7 5' }], ['path', { d: 'M12 4v10' }], ['path', { d: 'M11 9L5 20' }]],
    katana: [['path', { d: 'M20 3L9 14' }], ['path', { d: 'M9 14l-3 1 1-3' }], ['path', { d: 'M7 15l-3 5' }]],
    bomb: [['circle', { cx: 11, cy: 14, r: 6 }], ['path', { d: 'M15 9l3-3' }], ['path', { d: 'M18 6c1-2 3-2 3 0' }]],
    rocket: [['path', { d: 'M12 3c3 3 4 7 4 10l-4 4-4-4c0-3 1-7 4-10z' }], ['path', { d: 'M8 15l-3 4 5-2' }], ['path', { d: 'M16 15l3 4-5-2' }]],
    flame: [['path', { d: 'M12 21c4 0 6-3 6-6 0-4-4-5-4-9 0 0-3 2-3 5 0-2-2-3-2-3s-3 3-3 7c0 3 2 6 6 6z' }]],
    collapse: [['path', { d: 'M4 6h16' }], ['path', { d: 'M6 11h12' }], ['path', { d: 'M9 16h6' }], ['path', { d: 'M11 20h2' }]],
    laser: [['path', { d: 'M3 12h8' }], ['path', { d: 'M11 9h4l5 3-5 3h-4z' }], ['circle', { cx: 20, cy: 12, r: 1.4 }]],
    minigun: [['circle', { cx: 8, cy: 12, r: 4 }], ['path', { d: 'M12 10h9' }], ['path', { d: 'M12 14h9' }], ['path', { d: 'M8 8V5' }]],
    shockwave: [['circle', { cx: 12, cy: 12, r: 2 }], ['path', { d: 'M6 6a8.5 8.5 0 000 12' }], ['path', { d: 'M18 6a8.5 8.5 0 010 12' }]],
    tractor: [['path', { d: 'M6 6h12l-2 3H8z' }], ['path', { d: 'M8 9l-4 11h16L16 9' }], ['circle', { cx: 12, cy: 16, r: 1.6 }]],
    rubber: [['circle', { cx: 12, cy: 9, r: 4 }], ['path', { d: 'M5 20c3-3 11-3 14 0' }]],
    squeaky: [['circle', { cx: 8, cy: 8, r: 5 }], ['path', { d: 'M11 11l8 9' }]],
    watergun: [['path', { d: 'M3 9h11v4H9l-2 4H5v-4H3z' }], ['path', { d: 'M18 6c2 3 3 4 3 6a3 3 0 01-6 0c0-2 1-3 3-6z' }]],
    horn: [['path', { d: 'M4 10v4h4l8 5V5L8 10z' }], ['path', { d: 'M19 9a4 4 0 010 6' }]],
    chicken: [['circle', { cx: 10, cy: 8, r: 4 }], ['path', { d: 'M14 8l5 1-5 2' }], ['path', { d: 'M8 12l-2 8h8l-2-8' }]],
    shotgun: [['path', { d: 'M3 9h13v3H3z' }], ['path', { d: 'M16 10.5l5-3' }], ['path', { d: 'M16 10.5l5 3' }], ['path', { d: 'M16 10.5h6' }]],
    nailgun: [['path', { d: 'M4 7h10v4H4z' }], ['path', { d: 'M14 9h7' }], ['path', { d: 'M7 11v6' }]],
    freezegun: [['path', { d: 'M12 3v18' }], ['path', { d: 'M4 7.5l16 9' }], ['path', { d: 'M20 7.5l-16 9' }]],
    gravity: [['circle', { cx: 12, cy: 12, r: 3.5 }], ['path', { d: 'M12 2v4' }], ['path', { d: 'M12 18v4' }], ['path', { d: 'M2 12h4' }], ['path', { d: 'M18 12h4' }]],
    _custom: [['path', { d: 'M12 3l2.5 6H21l-5 4 2 7-6-4-6 4 2-7-5-4h6.5z' }]]
  };
  function art(id, size) {
    const parts = GLYPH[id] || GLYPH._custom;
    const svg = svgEl('svg', {
      viewBox: '0 0 24 24', width: size || 20, height: size || 20, class: 'art',
      fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false'
    });
    for (const [tag, attrs] of parts) svg.appendChild(svgEl(tag, attrs));
    return svg;
  }

  /* =====================================================================
   * 상태
   * ===================================================================== */
  const S = {
    schema: [],
    byKey: Object.create(null),
    values: Object.create(null),     // resolved setting values
    arsenal: null,                   // options/arsenal.json
    weapons: [],                     // arsenal.json weapons + custom weapons, in 무기고 order
    loadout: [],
    preset: 'default',
    custom: [],                      // validated custom weapon records
    stats: null,
    replays: [],
    sort: { col: 'id', dir: 1 },
    editing: null                    // custom weapon id being edited, or null for a new one
  };
  const GROUP_LABEL = {
    general: 'optGroupGeneral', combat: 'optGroupCombat',
    accessibility: 'optGroupAccessibility', advanced: 'optGroupAdvanced'
  };
  const GROUP_ORDER = ['general', 'combat', 'accessibility', 'advanced'];
  const CAT_LABEL = { field: 'optCatField', special: 'optCatSpecial', fun: 'optCatFun', custom: 'optCatCustom' };
  const KIND_LABEL = { hammer: 'optKindHammer', gun: 'optKindGun', bomb: 'optKindBomb', collapse: 'optKindCollapse' };

  function pascal(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }
  function weaponName(w) {
    if (w.custom) return w.name;
    const s = w.nameKey ? msgRaw(w.nameKey) : '';
    return s || w.id;
  }
  function settingValid(entry, v) {
    if (!entry) return false;
    if (entry.type === 'bool') return typeof v === 'boolean';
    if (entry.type === 'enum') return Array.isArray(entry.options) && entry.options.indexOf(v) !== -1;
    if (entry.type === 'string') return typeof v === 'string';
    if (entry.type === 'int') {
      if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v) return false;
      if (Number.isInteger(entry.min) && v < entry.min) return false;
      if (Number.isInteger(entry.max) && v > entry.max) return false;
      return true;
    }
    if (entry.type === 'number') {
      if (typeof v !== 'number' || !isFinite(v)) return false;
      if (typeof entry.min === 'number' && v < entry.min) return false;
      if (typeof entry.max === 'number' && v > entry.max) return false;
      return true;
    }
    return false;
  }
  /* 열거형 값의 라벨. 무기 / 프리셋 / 모드는 이미 메시지 키가 있고, 그 밖의 값은 `optv<Value>` 를
   * 찾아보고 없으면 값 자체를 쓴다 — 없는 라벨 때문에 빈 칸이 뜨는 일은 없다. */
  function optionLabel(key, v) {
    if (key === 'defaultWeapon') {
      const w = S.weapons.find((x) => x.id === v);
      return w ? (w.emoji ? w.emoji + ' ' : '') + weaponName(w) : String(v);
    }
    if (key === 'loadoutPreset') { const pk = 'preset' + pascal(v); return msg(pk, String(v)); }
    if (key === 'mode') { const mk = 'mode' + pascal(v); return msg(mk, String(v)); }
    if (key === 'debrisLifeMs') {
      if (v === 0) return msg('optvUnlimited', '∞');
      return (v / 1000) + ' ' + msg('optUnitSeconds', 's');
    }
    if (typeof v === 'number') return '×' + v;
    const vk = 'optv' + pascal(v);
    return msg(vk, String(v));
  }

  /* =====================================================================
   * 1. 설정 — settings-schema.json 을 그룹별로 렌더한다
   * ===================================================================== */
  function renderSettings() {
    const host = $('groups');
    clear(host);
    const groups = GROUP_ORDER.filter((g) => S.schema.some((e) => e.group === g));
    for (const e of S.schema) if (groups.indexOf(e.group) === -1) groups.push(e.group);

    for (const g of groups) {
      const items = S.schema.filter((e) => e.group === g);
      if (!items.length) continue;
      const fs = el('fieldset');
      fs.setAttribute('data-group', g);
      const lg = el('legend', null, msg(GROUP_LABEL[g] || '', g));
      fs.appendChild(lg);
      for (const e of items) fs.appendChild(settingRow(e));
      const row = el('div', 'row');
      const btn = el('button', 'btn', msg('optResetGroup', 'Reset this group'));
      btn.type = 'button';
      btn.setAttribute('data-reset-group', g);
      btn.addEventListener('click', () => { resetGroup(g); });
      row.appendChild(btn);
      fs.appendChild(row);
      host.appendChild(fs);
    }
  }
  function settingRow(e) {
    const wrap = el('div', 'setting');
    wrap.setAttribute('data-setting', e.key);
    const id = 'set-' + e.key;
    const label = el('label', null, msg(e.labelKey, e.key));
    label.htmlFor = id;
    wrap.appendChild(label);

    const v = S.values[e.key];
    if (e.type === 'bool') {
      const input = el('input');
      input.type = 'checkbox';
      input.id = id;
      input.checked = v === true;
      input.addEventListener('change', () => { writeSetting(e, input.checked); });
      wrap.appendChild(input);
      return wrap;
    }
    if (e.type === 'enum') {
      const sel = el('select');
      sel.id = id;
      for (const o of e.options) {
        const op = el('option', null, optionLabel(e.key, o));
        op.value = JSON.stringify(o);
        if (o === v) op.selected = true;
        sel.appendChild(op);
      }
      sel.addEventListener('change', () => {
        let parsed;
        try { parsed = JSON.parse(sel.value); } catch (err) { return; }
        writeSetting(e, parsed);
      });
      wrap.appendChild(sel);
      return wrap;
    }
    if ((e.type === 'int' || e.type === 'number') && Number.isFinite(e.min) && Number.isFinite(e.max)) {
      /* §1 "범위(숫자 병기)" — 슬라이더 옆에 현재 숫자를 항상 보인다. */
      const box = el('div', 'rangewrap');
      const input = el('input');
      input.type = 'range';
      input.id = id;
      input.min = String(e.min);
      input.max = String(e.max);
      input.step = e.type === 'int' ? '1' : 'any';
      input.value = String(v);
      const out = el('output', null, String(v));
      out.htmlFor = id;
      input.addEventListener('input', () => { setText(out, input.value); });
      input.addEventListener('change', () => { writeSetting(e, Number(input.value)); });
      box.appendChild(input);
      box.appendChild(out);
      wrap.appendChild(box);
      return wrap;
    }
    const input = el('input');
    input.type = 'number';
    input.id = id;
    if (Number.isFinite(e.min)) input.min = String(e.min);
    if (Number.isFinite(e.max)) input.max = String(e.max);
    input.value = String(v);
    input.addEventListener('change', () => { writeSetting(e, Number(input.value)); });
    wrap.appendChild(input);
    return wrap;
  }
  async function writeSetting(entry, value) {
    if (!settingValid(entry, value)) { toast(msg('optInvalid', 'invalid')); return false; }
    S.values[entry.key] = value;
    const patch = {};
    patch[SETTING_PREFIX + entry.key] = value;
    await sync.set(patch);
    if (entry.key === 'loadoutPreset') await applyPreset(value);
    if (entry.key === 'collectLocalStats') await loadStats();
    toast(msg('optSaved', 'saved'));
    return true;
  }
  /* 기본값으로 되돌리기는 키를 **지우는** 대신 스키마 기본값을 명시적으로 **쓴다**. 지우면 아직 디스크에
   * 남아 있을 수 있는 v1 평탄 키(crsWeapon 등)가 다음 로드에서 다시 이기기 때문이다. */
  async function resetKeys(keys) {
    const patch = {};
    for (const k of keys) {
      const e = S.byKey[k];
      if (!e) continue;
      S.values[k] = e.default;
      patch[SETTING_PREFIX + k] = e.default;
    }
    await sync.set(patch);
    if (keys.indexOf('loadoutPreset') !== -1) await applyPreset(S.byKey.loadoutPreset.default);
    renderSettings();
    renderArsenal();
    await loadStats();
    toast(msg('optResetDone', 'reset'));
  }
  function resetGroup(g) {
    return resetKeys(S.schema.filter((e) => e.group === g).map((e) => e.key));
  }

  /* =====================================================================
   * 2. 무기고 편집기 (§1) — 포인터 드래그로 넣고 빼고 순서를 바꾼다
   *
   * HTML5 drag-and-drop 대신 포인터 이벤트를 쓴다. 하나는 접근성(모든 동작에 키보드 경로가 있다),
   * 하나는 검증 가능성이다 — 스위트 D 가 실제 마우스로 끌어다 놓고 결과를 읽는다.
   * ===================================================================== */
  const LOADOUT_MAX = 10;
  function slotKeyLabel(i) { return i === 9 ? '0' : String(i + 1); }

  function chipFor(w, inLoadout) {
    const b = el('button', 'chip');
    b.type = 'button';
    b.setAttribute('data-id', w.id);
    b.setAttribute('data-drag', '1');
    if (!inLoadout && S.loadout.indexOf(w.id) !== -1) b.setAttribute('data-in', '1');
    b.appendChild(art(w.id, 18));
    b.appendChild(el('span', null, (w.emoji ? w.emoji + ' ' : '') + weaponName(w)));
    b.title = inLoadout ? msg('optRemove', 'remove') : msg('optAdd', 'add');
    b.addEventListener('click', (ev) => {
      if (b.getAttribute('data-dragged') === '1') { b.removeAttribute('data-dragged'); return; }
      ev.preventDefault();
      if (inLoadout) removeFromLoadout(w.id); else addToLoadout(w.id);
    });
    if (inLoadout) {
      b.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight' && ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
        ev.preventDefault();
        const i = S.loadout.indexOf(w.id);
        const j = i + ((ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') ? -1 : 1);
        if (i < 0 || j < 0 || j >= S.loadout.length) return;
        const next = S.loadout.slice();
        next[i] = next[j]; next[j] = w.id;
        saveLoadout(next, 'custom').then(() => {
          const node = document.querySelector('#loadout .chip[data-id="' + w.id + '"]');
          if (node) node.focus();
        });
      });
    }
    b.addEventListener('pointerdown', (ev) => startDrag(ev, b, w.id, inLoadout));
    return b;
  }

  function renderArsenal() {
    const pool = $('pool');
    clear(pool);
    const cats = ['field', 'special', 'fun', 'custom'];
    for (const cat of cats) {
      const list = S.weapons.filter((w) => (w.cat || 'field') === cat);
      if (!list.length) continue;
      pool.appendChild(el('p', 'catrow', msg(CAT_LABEL[cat], cat)));
      for (const w of list) pool.appendChild(chipFor(w, false));
    }

    const ol = $('loadout');
    clear(ol);
    for (let i = 0; i < LOADOUT_MAX; i++) {
      const li = el('li', 'slot');
      li.setAttribute('data-drop', 'slot');
      li.setAttribute('data-slot', String(i));
      li.appendChild(el('span', 'key', slotKeyLabel(i)));
      const id = S.loadout[i];
      const w = id ? S.weapons.find((x) => x.id === id) : null;
      if (w) li.appendChild(chipFor(w, true));
      else li.appendChild(el('span', 'blank', msg('optEmptySlot', 'empty')));
      ol.appendChild(li);
    }
    const sel = $('preset');
    if (sel) sel.value = S.preset;
  }

  const drag = { chip: null, ghost: null, id: null, from: -1, moved: false, over: null };
  function startDrag(ev, chip, id, inLoadout) {
    if (ev.button !== undefined && ev.button !== 0) return;
    drag.chip = chip;
    drag.id = id;
    drag.from = inLoadout ? S.loadout.indexOf(id) : -1;
    drag.moved = false;
    drag.over = null;
    try { chip.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    window.addEventListener('pointermove', onDragMove, true);
    window.addEventListener('pointerup', onDragUp, true);
    window.addEventListener('pointercancel', onDragUp, true);
  }
  function onDragMove(ev) {
    if (!drag.chip) return;
    if (!drag.moved) {
      drag.moved = true;
      const g = drag.chip.cloneNode(true);
      g.classList.add('ghost');
      g.removeAttribute('data-drag');
      document.body.appendChild(g);
      drag.ghost = g;
    }
    if (drag.ghost) {
      drag.ghost.style.left = (ev.clientX + 8) + 'px';
      drag.ghost.style.top = (ev.clientY - 14) + 'px';
    }
    const target = dropTargetAt(ev.clientX, ev.clientY);
    if (drag.over && drag.over !== target) drag.over.classList.remove('over');
    drag.over = target;
    if (target && target.getAttribute('data-drop') === 'slot') target.classList.add('over');
  }
  function dropTargetAt(x, y) {
    let node = null;
    try { node = document.elementFromPoint(x, y); } catch (e) { node = null; }
    while (node && node !== document.body) {
      if (node.getAttribute && node.getAttribute('data-drop')) return node;
      node = node.parentNode;
    }
    return null;
  }
  function onDragUp(ev) {
    window.removeEventListener('pointermove', onDragMove, true);
    window.removeEventListener('pointerup', onDragUp, true);
    window.removeEventListener('pointercancel', onDragUp, true);
    const chip = drag.chip;
    const id = drag.id;
    const from = drag.from;
    const moved = drag.moved;
    if (drag.ghost) { try { drag.ghost.remove(); } catch (e) { /* ignore */ } }
    if (drag.over) drag.over.classList.remove('over');
    const target = moved ? dropTargetAt(ev.clientX, ev.clientY) : null;
    drag.chip = null; drag.ghost = null; drag.id = null; drag.from = -1; drag.over = null; drag.moved = false;
    if (!chip || !moved) return;
    chip.setAttribute('data-dragged', '1');   // the click that follows a drag must not also toggle the weapon
    if (!target) return;
    const kind = target.getAttribute('data-drop');
    if (kind === 'pool') { if (from >= 0) removeFromLoadout(id); return; }
    const slot = Number(target.getAttribute('data-slot'));
    if (!Number.isInteger(slot)) return;
    moveTo(id, from, slot);
  }
  /* §1 "빈 칸이 있어도 된다" — 로드아웃은 **압축된 목록**이고 빈 칸은 "열 개보다 적다" 는 뜻이다.
   * 저장 형식(`crsLoadout`)이 중복 없는 1~10개의 배열이라 가운데 구멍을 표현할 자리가 없고,
   * 콘텐츠 스크립트의 isLoadout() 도 그 형태만 받는다. 그래서 가운데로 떨어뜨린 것은 압축된다.
   *
   * 무기고에서 끌어다 **찬 칸**에 놓으면 그 칸의 무기를 밀어낸다 — 가득 찬 로드아웃에서
   * 아무 일도 일어나지 않는 것보다 이쪽이 사람이 기대하는 동작이다. */
  function moveTo(id, from, slot) {
    const next = S.loadout.slice();
    while (next.length < slot) next.push(null);
    if (from >= 0) {
      const dest = next[slot];
      next[from] = (dest === undefined || dest === null) ? null : dest;
      next[slot] = id;
    } else {
      if (next.indexOf(id) !== -1) return;
      next[slot] = id;
    }
    saveLoadout(next.filter((x) => typeof x === 'string'), 'custom');
  }
  function addToLoadout(id) {
    if (S.loadout.indexOf(id) !== -1) return;
    if (S.loadout.length >= LOADOUT_MAX) { toast(msg('optLoadoutFull', 'full')); return; }
    saveLoadout(S.loadout.concat([id]), 'custom');
  }
  function removeFromLoadout(id) {
    const next = S.loadout.filter((x) => x !== id);
    if (!next.length) { toast(msg('optInvalid', 'invalid')); return; }
    saveLoadout(next, 'custom');
  }
  async function saveLoadout(ids, preset) {
    const known = S.weapons.map((w) => w.id);
    const seen = Object.create(null);
    const list = [];
    for (const id of ids) {
      if (typeof id !== 'string' || known.indexOf(id) === -1 || seen[id]) continue;
      seen[id] = true;
      list.push(id);
      if (list.length >= LOADOUT_MAX) break;
    }
    if (!list.length) return false;
    S.loadout = list;
    S.preset = preset || 'custom';
    S.values.loadoutPreset = S.preset;
    const patch = { crsLoadout: list.slice(), crsLoadoutPreset: S.preset };
    patch[SETTING_PREFIX + 'loadoutPreset'] = S.preset;
    await sync.set(patch);
    renderArsenal();
    const sel = document.querySelector('#set-loadoutPreset');
    if (sel) sel.value = JSON.stringify(S.preset);
    return true;
  }
  async function applyPreset(name) {
    const presets = (S.arsenal && S.arsenal.presets) || {};
    if (!presets[name]) return false;
    return saveLoadout(presets[name], name);
  }

  /* =====================================================================
   * 3. 무기 비교표 (§1) — 정렬 가능, SVG 그림 포함
   * ===================================================================== */
  const COLS = [
    { k: 'name', label: 'optColWeapon', text: true, get: (w) => weaponName(w) },
    { k: 'cat', label: 'optColCat', text: true, get: (w) => msg(CAT_LABEL[w.cat || 'field'], w.cat || 'field') },
    { k: 'role', label: 'optColRole', text: true, get: (w) => (w.custom ? msg('optCatCustom', 'custom') : roleLabel(w.role)) },
    { k: 'kind', label: 'optColKind', text: true, get: (w) => msg(KIND_LABEL[w.kind] || '', w.kind || '') },
    { k: 'damage', label: 'optColDamage', get: (w) => w.damage },
    { k: 'interval', label: 'optColInterval', get: (w) => (w.hold ? w.tickMs : w.cooldownMs) },
    { k: 'mag', label: 'optColMag', get: (w) => w.mag },
    { k: 'reloadMs', label: 'optColReload', get: (w) => w.reloadMs },
    { k: 'radius', label: 'optColRadius', get: (w) => w.radius },
    { k: 'swapMs', label: 'optColSwap', get: (w) => w.swapMs },
    { k: 'burstDPS', label: 'optColDps', get: (w) => w.burstDPS },
    { k: 'uptime', label: 'optColUptime', get: (w) => w.uptime, pct: true },
    { k: 'handling', label: 'optColHandling', get: (w) => w.handling, pct: true },
    { k: 'effective', label: 'optColEffective', get: (w) => w.effective }
  ];
  function roleLabel(role) {
    const map = (S.arsenal && S.arsenal.roleLabels) || {};
    return map[role] || role || '';
  }
  function cellText(col, w) {
    const v = col.get(w);
    if (col.text) return v == null ? '—' : String(v);
    if (v == null) return '—';
    if (col.pct) return Math.round(v * 100) + '%';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
    return String(v);
  }
  function renderTable() {
    const head = $('cmp-head');
    clear(head);
    for (const col of COLS) {
      const th = el('th', col.text ? 't' : null);
      th.scope = 'col';
      const b = el('button', null, msg(col.label, col.k) + (S.sort.col === col.k ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : ''));
      b.type = 'button';
      b.setAttribute('data-sort', col.k);
      b.addEventListener('click', () => {
        if (S.sort.col === col.k) S.sort.dir = -S.sort.dir;
        else { S.sort.col = col.k; S.sort.dir = 1; }
        renderTable();
      });
      th.appendChild(b);
      head.appendChild(th);
    }
    const body = $('cmp-body');
    clear(body);
    const col = COLS.find((c) => c.k === S.sort.col) || COLS[0];
    const rows = S.weapons.slice().sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * S.sort.dir;
      return String(va).localeCompare(String(vb)) * S.sort.dir;
    });
    for (const w of rows) {
      const tr = el('tr');
      tr.setAttribute('data-id', w.id);
      for (let i = 0; i < COLS.length; i++) {
        const c = COLS[i];
        const td = el('td', c.text ? 't' : null);
        if (i === 0) {
          td.appendChild(art(w.id, 20));
          td.appendChild(el('span', null, (w.emoji ? w.emoji + ' ' : '') + weaponName(w)));
        } else {
          setText(td, cellText(c, w));
        }
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  }

  /* =====================================================================
   * 4. 누적 통계 (§2)
   * ===================================================================== */
  function fmtDuration(ms) {
    const n = Math.max(0, Math.round(Number(ms) || 0));
    const sec = Math.floor(n / 1000);
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (d) return d + msg('optUnitDays', 'd') + ' ' + h + msg('optUnitHours', 'h');
    if (h) return h + msg('optUnitHours', 'h') + ' ' + m + msg('optUnitMinutes', 'min');
    if (m) return m + msg('optUnitMinutes', 'min') + ' ' + s + msg('optUnitSeconds', 's');
    return s + msg('optUnitSeconds', 's');
  }
  function fmtDate(ms) {
    const n = Number(ms);
    if (!n || !isFinite(n)) return '—';
    const dt = new Date(n);
    const p = (x) => (x < 10 ? '0' + x : String(x));
    return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate()) + ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes());
  }
  function dayKey(ms) {
    const dt = new Date(ms);
    const p = (x) => (x < 10 ? '0' + x : String(x));
    return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
  }
  /* §2 의 파생 지표 셋. src/96-stats.js 의 lifeDerive() 와 같은 세 줄이다 — 확장 페이지에서 콘텐츠
   * 스크립트를 부를 수 없으므로 양쪽에 있다. */
  function derive(rec) {
    const r = rec || {};
    const sessions = Number(r.sessions) || 0;
    const restores = Number(r.totalRestores) || 0;
    const exits = Number(r.totalExits) || 0;
    const days = Array.isArray(r.days) ? r.days : [];
    const cutoff = dayKey(Date.now() - 6 * 86400000);
    return {
      avgSessionMs: sessions > 0 ? Math.round((Number(r.msPlayed) || 0) / sessions) : 0,
      restoreRatio: (restores + exits) > 0 ? restores / (restores + exits) : 0,
      activeDays7: days.filter((d) => d >= cutoff).length
    };
  }
  function statRow(dl, labelKey, value, id) {
    const d = el('div');
    const dt = el('dt', null, msg(labelKey, labelKey));
    const dd = el('dd', null, value);
    if (id) dd.id = id;
    d.appendChild(dt);
    d.appendChild(dd);
    dl.appendChild(d);
  }
  function renderStats() {
    const off = S.values.collectLocalStats !== true;
    $('stats-off').hidden = !off;
    $('stats-body').hidden = off;
    $('stats-local').hidden = off;
    if (off) return;    // §2 "collectLocalStats: false 면 아예 쓰지 않고 섹션도 숨긴다"

    const rec = S.stats || {};
    const d = derive(rec);
    const dl = $('stats-grid');
    clear(dl);
    statRow(dl, 'optStatSessions', String(Number(rec.sessions) || 0), 'stat-sessions');
    statRow(dl, 'optStatPlayed', fmtDuration(rec.msPlayed), 'stat-played');
    statRow(dl, 'optStatDamage', String(Number(rec.totalDamage) || 0), 'stat-damage');
    statRow(dl, 'optStatBroken', String(Number(rec.totalBroken) || 0), 'stat-broken');
    statRow(dl, 'optStatKills', String(Number(rec.totalKills) || 0), 'stat-kills');
    statRow(dl, 'optStatRestores', String(Number(rec.totalRestores) || 0), 'stat-restores');
    statRow(dl, 'optStatExits', String(Number(rec.totalExits) || 0), 'stat-exits');
    statRow(dl, 'optStatBest', String(Number(rec.bestScore) || 0), 'stat-best');
    statRow(dl, 'optStatFirstUse', fmtDate(rec.firstUse), 'stat-first');
    statRow(dl, 'optStatLastUse', fmtDate(rec.lastUse), 'stat-last');
    statRow(dl, 'optStatAvgSession', fmtDuration(d.avgSessionMs), 'stat-avg');
    statRow(dl, 'optStatRestoreRatio', Math.round(d.restoreRatio * 100) + '%', 'stat-ratio');
    statRow(dl, 'optStatDays7', String(d.activeDays7), 'stat-days7');

    const po = (rec.perOrigin && typeof rec.perOrigin === 'object') ? rec.perOrigin : {};
    const top = Object.keys(po)
      .map((k) => Object.assign({ origin: k }, po[k]))
      .sort((a, b) => ((Number(b.broken) || 0) - (Number(a.broken) || 0)) || ((Number(b.plays) || 0) - (Number(a.plays) || 0)))
      .slice(0, 10);
    $('origins-empty').hidden = top.length > 0;
    $('origins').hidden = top.length === 0;
    const head = $('origins-head');
    clear(head);
    for (const [k, cls] of [['optColOrigin', 't'], ['optColPlays', ''], ['optColBroken', ''], ['optColBest', ''], ['optColLast', '']]) {
      const th = el('th', cls || null, msg(k, k));
      th.scope = 'col';
      head.appendChild(th);
    }
    const body = $('origins-body');
    clear(body);
    for (const o of top) {
      const tr = el('tr');
      tr.appendChild(el('td', 't', o.origin));
      tr.appendChild(el('td', null, String(Number(o.plays) || 0)));
      tr.appendChild(el('td', null, String(Number(o.broken) || 0)));
      tr.appendChild(el('td', null, String(Number(o.bestScore) || 0)));
      tr.appendChild(el('td', null, fmtDate(o.lastPlayed)));
      body.appendChild(tr);
    }
  }
  async function loadStats() {
    if (S.values.collectLocalStats !== true) { S.stats = null; renderStats(); return; }
    const res = await local.get([LIFE_KEY]);
    S.stats = (res && res[LIFE_KEY] && typeof res[LIFE_KEY] === 'object') ? res[LIFE_KEY] : {};
    renderStats();
  }
  /* §2 "초기화는 명시적 확인 후." §3 의 challenges 는 남긴다 — 이 버튼은 누적 통계의 버튼이다. */
  async function resetStats() {
    if (!window.confirm(msg('optConfirmStatsReset', 'Erase statistics?'))) return;
    const res = await local.get([LIFE_KEY]);
    const s = (res && res[LIFE_KEY] && typeof res[LIFE_KEY] === 'object') ? res[LIFE_KEY] : {};
    const keep = Object.assign({}, s);
    for (const k of ['firstUse', 'lastUse', 'sessions', 'msPlayed', 'totalDamage', 'totalBroken',
      'totalKills', 'totalRestores', 'totalExits', 'bestScore', 'perOrigin', 'days']) delete keep[k];
    keep.version = 1;
    keep.firstUse = Date.now();
    keep.lastUse = Date.now();
    keep.sessions = 0; keep.msPlayed = 0; keep.totalDamage = 0; keep.totalBroken = 0;
    keep.totalKills = 0; keep.totalRestores = 0; keep.totalExits = 0; keep.bestScore = 0;
    keep.perOrigin = {}; keep.days = [];
    const patch = {};
    patch[LIFE_KEY] = keep;
    await local.set(patch);
    S.stats = keep;
    renderStats();
    toast(msg('optStatsResetDone', 'done'));
  }

  /* =====================================================================
   * 5. 사용자 정의 무기 (§6)
   *
   * 검증은 src/96-custom.js 의 것과 같다. 규칙이 바뀌면 두 곳을 같이 고친다.
   * ===================================================================== */
  function cpCount(s) {
    let n = 0;
    try { for (const ch of String(s)) { if (ch) n++; } } catch (e) { return CW_EMOJI_MAX + 1; }
    return n;
  }
  function cwInt(v, lo, hi) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi;
  }
  function cwStr(v, max) { return typeof v === 'string' && v.length >= 1 && v.length <= max; }
  function cwValidate(raw, builtinIds) {
    const ok = [], bad = [];
    if (raw == null) return { ok, bad };
    if (!Array.isArray(raw)) return { ok, bad: [{ index: -1, id: null, field: 'root', reason: 'not-an-array' }] };
    const seen = Object.create(null);
    for (let i = 0; i < raw.length; i++) {
      const e = raw[i];
      const id = (e && typeof e.id === 'string') ? e.id : null;
      const no = (field, reason) => { bad.push({ index: i, id, field, reason }); };
      if (!e || typeof e !== 'object' || Array.isArray(e)) { no('entry', 'not-an-object'); continue; }
      if (ok.length >= CW_MAX) { no('list', 'over-max'); continue; }
      if (!CW_ID_RE.test(String(e.id))) { no('id', 'bad-id'); continue; }
      if (builtinIds.indexOf(e.id) !== -1) { no('id', 'builtin-collision'); continue; }
      if (seen[e.id]) { no('id', 'duplicate'); continue; }
      if (cpCount(e.emoji) < 1 || cpCount(e.emoji) > CW_EMOJI_MAX) { no('emoji', 'bad-emoji'); continue; }
      if (!cwStr(e.nameKo, CW_NAME_MAX)) { no('nameKo', 'bad-name'); continue; }
      if (!cwStr(e.nameEn, CW_NAME_MAX)) { no('nameEn', 'bad-name'); continue; }
      if (CW_KINDS.indexOf(e.kind) === -1) { no('kind', 'bad-kind'); continue; }
      if (!cwInt(e.damage, 1, 999)) { no('damage', 'out-of-range'); continue; }
      if (!cwInt(e.cooldownMs, 0, 5000)) { no('cooldownMs', 'out-of-range'); continue; }
      if (!(e.mag === null || cwInt(e.mag, 1, 200))) { no('mag', 'out-of-range'); continue; }
      if (!cwInt(e.reloadMs, 0, 10000)) { no('reloadMs', 'out-of-range'); continue; }
      if (!cwInt(e.radius, 0, 600)) { no('radius', 'out-of-range'); continue; }
      if (!cwInt(e.tickMs, 20, 500)) { no('tickMs', 'out-of-range'); continue; }
      if (CW_CRACKS.indexOf(e.crack) === -1) { no('crack', 'bad-crack'); continue; }
      if (CW_SOUNDS.indexOf(e.sound) === -1) { no('sound', 'bad-sound'); continue; }
      seen[e.id] = true;
      ok.push({
        id: e.id, emoji: String(e.emoji), nameKo: e.nameKo, nameEn: e.nameEn, kind: e.kind,
        damage: e.damage, cooldownMs: e.cooldownMs, mag: e.mag, reloadMs: e.reloadMs,
        radius: e.radius, tickMs: e.tickMs, crack: e.crack, sound: e.sound
      });
    }
    return { ok, bad };
  }
  function builtinIds() { return (S.arsenal && S.arsenal.weapons ? S.arsenal.weapons : []).map((w) => w.id); }

  const CW_FIELDS = [
    { k: 'id', label: 'optFieldId', type: 'text' },
    { k: 'emoji', label: 'optFieldEmoji', type: 'text' },
    { k: 'nameKo', label: 'optFieldNameKo', type: 'text' },
    { k: 'nameEn', label: 'optFieldNameEn', type: 'text' },
    { k: 'kind', label: 'optFieldKind', type: 'select', options: CW_KINDS, labels: KIND_LABEL },
    { k: 'damage', label: 'optFieldDamage', type: 'number', min: 1, max: 999 },
    { k: 'cooldownMs', label: 'optFieldCooldown', type: 'number', min: 0, max: 5000 },
    { k: 'mag', label: 'optFieldMag', type: 'number', min: 1, max: 200, blankIsNull: true },
    { k: 'reloadMs', label: 'optFieldReload', type: 'number', min: 0, max: 10000 },
    { k: 'radius', label: 'optFieldRadius', type: 'number', min: 0, max: 600 },
    { k: 'tickMs', label: 'optFieldTick', type: 'number', min: 20, max: 500 },
    { k: 'crack', label: 'optFieldCrack', type: 'select', options: CW_CRACKS },
    { k: 'sound', label: 'optFieldSound', type: 'select', options: CW_SOUNDS }
  ];
  function cwExample(n) {
    return {
      id: 'cw_example' + n, emoji: '🧨', nameKo: '예시 무기 ' + n, nameEn: 'Example ' + n,
      kind: 'gun', damage: 40, cooldownMs: 200, mag: 12, reloadMs: 1200,
      radius: 0, tickMs: 120, crack: 'gun', sound: 'gun'
    };
  }
  function renderCustomForm(rec) {
    const form = $('cw-form');
    clear(form);
    const base = rec || cwExample(S.custom.length + 1);
    for (const f of CW_FIELDS) {
      const field = el('label', 'field');
      field.appendChild(el('span', null, msg(f.label, f.k)));
      let input;
      if (f.type === 'select') {
        input = el('select');
        for (const o of f.options) {
          const op = el('option', null, f.labels ? msg(f.labels[o] || '', o) : o);
          op.value = o;
          if (base[f.k] === o) op.selected = true;
          input.appendChild(op);
        }
      } else {
        input = el('input');
        input.type = f.type;
        if (f.min != null) input.min = String(f.min);
        if (f.max != null) input.max = String(f.max);
        input.value = base[f.k] == null ? '' : String(base[f.k]);
      }
      input.id = 'cw-f-' + f.k;
      input.setAttribute('data-field', f.k);
      field.appendChild(input);
      form.appendChild(field);
    }
    const row = el('div', 'field');
    row.appendChild(el('span', null, ' '));
    const save = el('button', 'btn', msg('optCustomSave', 'Save'));
    save.type = 'button';
    save.id = 'cw-save';
    save.addEventListener('click', () => { saveFormWeapon(); });
    row.appendChild(save);
    form.appendChild(row);
  }
  function readForm() {
    const out = {};
    for (const f of CW_FIELDS) {
      const input = $('cw-f-' + f.k);
      if (!input) continue;
      if (f.type === 'number') {
        const raw = String(input.value).trim();
        if (!raw && f.blankIsNull) { out[f.k] = null; continue; }
        out[f.k] = raw === '' ? NaN : Number(raw);
      } else {
        out[f.k] = String(input.value);
      }
    }
    return out;
  }
  async function saveFormWeapon() {
    const rec = readForm();
    const next = S.custom.filter((w) => w.id !== rec.id).concat([rec]);
    if (next.length > CW_MAX) { toast(msg('optCustomFull', 'full')); return; }
    const res = cwValidate(next, builtinIds());
    if (res.bad.length) {
      const first = res.bad[0];
      toast(msg('optCustomRejected', 'rejected') + ' · ' + first.field + ' (' + first.reason + ')');
      return;
    }
    await writeCustom(res.ok);
    toast(msg('optCustomSaved', 'saved'));
  }
  async function writeCustom(list) {
    const patch = {};
    patch[CW_KEY] = list;
    await local.set(patch);
    S.custom = list;
    rebuildWeapons();
    renderCustomTable();
    renderArsenal();
    renderTable();
    renderCustomForm(null);
    $('cw-json').value = JSON.stringify(list, null, 2);
  }
  function renderCustomTable() {
    $('custom-empty').hidden = S.custom.length > 0;
    $('cw-table').hidden = S.custom.length === 0;
    const head = $('cw-head');
    clear(head);
    for (const [k, cls] of [['optColWeapon', 't'], ['optFieldId', 't'], ['optColKind', 't'], ['optColDamage', ''], ['optColInterval', ''], ['optColMag', ''], ['', '']]) {
      const th = el('th', cls || null, k ? msg(k, k) : '');
      th.scope = 'col';
      head.appendChild(th);
    }
    const body = $('cw-body');
    clear(body);
    for (const w of S.custom) {
      const tr = el('tr');
      tr.setAttribute('data-id', w.id);
      const first = el('td', 't');
      first.appendChild(art(w.id, 20));
      first.appendChild(el('span', null, w.emoji + ' ' + w.nameKo));
      tr.appendChild(first);
      tr.appendChild(el('td', 't', w.id));
      tr.appendChild(el('td', 't', msg(KIND_LABEL[w.kind] || '', w.kind)));
      tr.appendChild(el('td', null, String(w.damage)));
      tr.appendChild(el('td', null, String(w.kind === 'gun' ? w.tickMs : w.cooldownMs)));
      tr.appendChild(el('td', null, w.mag == null ? '—' : String(w.mag)));
      const act = el('td');
      const ed = el('button', 'btn', msg('optCustomEdit', 'Edit'));
      ed.type = 'button';
      ed.setAttribute('data-edit', w.id);
      ed.addEventListener('click', () => { renderCustomForm(w); });
      const rm = el('button', 'btn danger', msg('optCustomDelete', 'Delete'));
      rm.type = 'button';
      rm.setAttribute('data-delete', w.id);
      rm.addEventListener('click', () => { writeCustom(S.custom.filter((x) => x.id !== w.id)); });
      act.appendChild(ed);
      act.appendChild(rm);
      tr.appendChild(act);
      body.appendChild(tr);
    }
  }
  async function importCustomJson() {
    let parsed;
    try { parsed = JSON.parse($('cw-json').value); } catch (e) { toast(msg('optCustomBadJson', 'bad json')); return; }
    const res = cwValidate(parsed, builtinIds());
    if (!res.ok.length && res.bad.length) {
      const first = res.bad[0];
      toast(msg('optCustomRejected', 'rejected') + ' · ' + first.field + ' (' + first.reason + ')');
      return;
    }
    await writeCustom(res.ok);
    toast(res.bad.length ? msg('optCustomRejected', 'rejected') : msg('optCustomSaved', 'saved'));
  }
  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /* =====================================================================
   * 6. 리플레이 가져오기 / 내보내기 (§5)
   * ===================================================================== */
  function replayValidate(obj, knownIds) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    if (obj.v !== 1) return null;
    const vp = obj.viewport;
    if (!vp || typeof vp !== 'object' || !(vp.w > 0) || !(vp.h > 0) || !isFinite(vp.w) || !isFinite(vp.h)) return null;
    if (!Array.isArray(obj.ops) || obj.ops.length > REPLAY_MAX) return null;
    const ops = [];
    let last = -1;
    for (const o of obj.ops) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
      const tt = Number(o.t);
      if (!isFinite(tt) || tt < 0 || tt < last) return null;
      if (typeof o.op !== 'string' || REPLAY_OPS.indexOf(o.op) === -1) return null;
      const args = Array.isArray(o.args) ? o.args : [];
      if (args.length > 4) return null;
      for (const v of args) {
        if (typeof v === 'number') { if (!isFinite(v)) return null; }
        else if (typeof v === 'string') { if (v.length > 40) return null; }
        else return null;
      }
      if (o.op === 'weapon' && knownIds.indexOf(args[0]) === -1) return null;
      if ((o.op === 'smash' && args.length !== 2) || (o.op === 'slash' && args.length !== 4)) return null;
      ops.push({ t: tt, op: o.op, args: args.slice() });
      last = tt;
    }
    return { v: 1, startedAt: Number(obj.startedAt) || 0, viewport: { w: vp.w, h: vp.h }, ops };
  }
  function renderReplays() {
    $('replay-empty').hidden = S.replays.length > 0;
    $('rp-table').hidden = S.replays.length === 0;
    const head = $('rp-head');
    clear(head);
    for (const [k, cls] of [['optReplaySavedAt', 't'], ['optReplayOps', ''], ['', '']]) {
      const th = el('th', cls || null, k ? msg(k, k) : '');
      th.scope = 'col';
      head.appendChild(th);
    }
    const body = $('rp-body');
    clear(body);
    S.replays.forEach((r, i) => {
      const tr = el('tr');
      tr.setAttribute('data-index', String(i));
      tr.appendChild(el('td', 't', fmtDate(r && r.savedAt)));
      tr.appendChild(el('td', null, String(r && Array.isArray(r.ops) ? r.ops.length : 0)));
      const act = el('td');
      const b = el('button', 'btn', msg('optReplayExport', 'Export'));
      b.type = 'button';
      b.setAttribute('data-export', String(i));
      b.addEventListener('click', () => { download('crash-tab-replay-' + (i + 1) + '.json', JSON.stringify(r, null, 2)); });
      act.appendChild(b);
      tr.appendChild(act);
      body.appendChild(tr);
    });
  }
  async function importReplayJson() {
    const text = $('rp-json').value;
    /* §5 "1MB 상한, 엄격 검증" — 크기를 먼저 보고, 그 다음 모양을 본다. */
    if (text.length > REPLAY_MAX_BYTES) { toast(msg('replayBad', 'bad replay')); return; }
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { toast(msg('replayBad', 'bad replay')); return; }
    const known = S.weapons.map((w) => w.id);
    const data = replayValidate(parsed, known);
    if (!data) { toast(msg('replayBad', 'bad replay')); return; }
    const list = S.replays.slice();
    list.push(Object.assign({ savedAt: Date.now() }, data));
    while (list.length > 10) list.shift();
    const patch = {};
    patch[REPLAY_KEY] = list;
    await local.set(patch);
    S.replays = list;
    renderReplays();
    toast(msg('optReplayImported', 'imported'));
  }

  /* =====================================================================
   * 7. 정보 (§1: 버전 · 저장소 · 라이선스 · 수집 없음 명시)
   * ===================================================================== */
  function renderAbout() {
    const dl = $('about-grid');
    clear(dl);
    let version = '';
    try { version = chrome.runtime.getManifest().version; } catch (e) { version = ''; }
    statRow(dl, 'optAboutVersion', version || '—', 'about-version');
    const repo = el('div');
    repo.appendChild(el('dt', null, msg('optAboutRepo', 'Repository')));
    const dd = el('dd');
    const a = el('a', null, REPO_URL);
    a.href = REPO_URL;
    a.rel = 'noreferrer noopener';
    a.target = '_blank';
    dd.appendChild(a);
    repo.appendChild(dd);
    dl.appendChild(repo);
    statRow(dl, 'optAboutLicense', LICENSE, 'about-license');
    statRow(dl, 'optAboutPerms', msg('optAboutPermsValue', 'activeTab, scripting, storage'), 'about-perms');
    setText($('about-privacy'), msg('optAboutPrivacy', 'No network traffic. Nothing is collected.'));
  }

  /* =====================================================================
   * 로딩
   * ===================================================================== */
  function rebuildWeapons() {
    const base = (S.arsenal && Array.isArray(S.arsenal.weapons) ? S.arsenal.weapons : []).map((w) => Object.assign({}, w));
    const ko = /^ko/i.test(uiLang());
    const customs = S.custom.map((w) => ({
      id: w.id, emoji: w.emoji, custom: true, name: (ko ? w.nameKo : w.nameEn) || w.nameKo,
      cat: 'custom', role: 'custom', kind: w.kind,
      damage: w.damage, cooldownMs: w.cooldownMs, tickMs: w.tickMs, hold: w.kind === 'gun',
      mag: w.mag, reloadMs: w.mag == null ? null : w.reloadMs, radius: w.kind === 'bomb' ? w.radius : 0,
      swapMs: 250, burstDPS: null, uptime: null, handling: null, effective: null
    }));
    S.weapons = base.concat(customs);   // §6 "무기고 끝에 붙고"
  }
  function uiLang() {
    try { return chrome.i18n.getUILanguage() || 'ko'; } catch (e) { return 'ko'; }
  }
  async function readJson(rel) {
    const url = chrome.runtime.getURL(rel);
    const res = await fetch(url);
    return res.json();
  }
  function labelStatic() {
    const title = msg('optTitle', 'crash-tab');
    document.title = title;
    setText($('title'), title);
    setText($('skip'), msg('optNavSettings', 'Settings'));
    const nav = $('nav');
    clear(nav);
    const SECTIONS = [
      ['sec-settings', 'optNavSettings', 'h-settings'],
      ['sec-arsenal', 'optNavArsenal', 'h-arsenal'],
      ['sec-table', 'optNavTable', 'h-table'],
      ['sec-stats', 'optNavStats', 'h-stats'],
      ['sec-custom', 'optNavCustom', 'h-custom'],
      ['sec-replay', 'optNavReplay', 'h-replay'],
      ['sec-about', 'optNavAbout', 'h-about']
    ];
    for (const [sec, key, head] of SECTIONS) {
      const label = msg(key, key);
      const a = el('a', null, label);
      a.href = '#' + sec;
      nav.appendChild(a);
      setText($(head), label);
    }
    setText($('reset-all'), msg('optResetAll', 'Reset all'));
    setText($('arsenal-hint'), msg('optArsenalHint', ''));
    setText($('h-pool'), msg('optArsenalAll', 'Arsenal'));
    setText($('h-loadout'), msg('optLoadoutTitle', 'Loadout'));
    setText($('preset-label'), msg('setLoadoutPreset', 'Preset'));
    setText($('table-hint'), msg('optSortHint', ''));
    setText($('stats-local'), msg('optStatsLocal', ''));
    setText($('stats-off'), msg('optStatsOff', ''));
    setText($('h-origins'), msg('optStatTopOrigins', ''));
    setText($('origins-empty'), msg('optStatsEmpty', ''));
    setText($('stats-reset'), msg('optStatsReset', 'Reset'));
    setText($('custom-hint'), msg('optCustomHint', ''));
    setText($('custom-empty'), msg('optCustomEmpty', ''));
    setText($('cw-new'), msg('optCustomNew', 'Example'));
    setText($('cw-export'), msg('optCustomExport', 'Export'));
    setText($('cw-import'), msg('optCustomImport', 'Import'));
    setText($('cw-json-label'), msg('optCustomImport', 'JSON'));
    setText($('replay-hint'), msg('optReplayHint', ''));
    setText($('replay-empty'), msg('optReplayEmpty', ''));
    setText($('rp-import'), msg('optReplayImport', 'Import'));
    setText($('rp-json-label'), msg('optReplayImport', 'JSON'));
    setText($('h-settings'), msg('optNavSettings', 'Settings'));
  }
  function renderPresetSelect() {
    const sel = $('preset');
    clear(sel);
    const presets = (S.arsenal && S.arsenal.presets) || {};
    const names = Object.keys(presets).concat(['custom']);
    for (const n of names) {
      const pk = 'preset' + pascal(n);
      const op = el('option', null, msg(pk, n));
      op.value = n;
      sel.appendChild(op);
    }
    sel.value = S.preset;
    sel.addEventListener('change', () => {
      if (sel.value === 'custom') return;
      applyPreset(sel.value);
    });
  }

  async function main() {
    labelStatic();
    $('reset-all').addEventListener('click', () => {
      if (!window.confirm(msg('optConfirmResetAll', 'Reset everything?'))) return;
      resetKeys(S.schema.map((e) => e.key));
    });
    $('stats-reset').addEventListener('click', () => { resetStats(); });
    $('cw-new').addEventListener('click', () => { renderCustomForm(cwExample(S.custom.length + 1)); });
    $('cw-export').addEventListener('click', () => { download('crash-tab-weapons.json', JSON.stringify(S.custom, null, 2)); });
    $('cw-import').addEventListener('click', () => { importCustomJson(); });
    $('rp-import').addEventListener('click', () => { importReplayJson(); });

    /* 두 생성물. 둘 다 chrome-extension:// 안이고, 그 밖으로 나가는 요청은 이 페이지에 하나도 없다. */
    try { S.schema = await readJson('settings-schema.json'); } catch (e) { S.schema = []; }
    try { S.arsenal = await readJson('options/arsenal.json'); } catch (e) { S.arsenal = null; }
    if (!Array.isArray(S.schema)) S.schema = [];
    for (const e of S.schema) { S.byKey[e.key] = e; S.values[e.key] = e.default; }

    const want = S.schema.map((e) => SETTING_PREFIX + e.key).concat(['crsLoadout', 'crsLoadoutPreset']);
    const stored = await sync.get(want);
    for (const e of S.schema) {
      const v = stored[SETTING_PREFIX + e.key];
      if (v !== undefined && settingValid(e, v)) S.values[e.key] = v;
    }
    const localRes = await local.get([CW_KEY, REPLAY_KEY, LIFE_KEY]);
    /* §6 "망가진 저장값이 활성화를 막아서는 안 된다" — 옵션 페이지에서도 같다. 썩은 항목은 버리고
     * 나머지를 보여 주며, 무엇이 왜 거절됐는지 한 줄로 알린다. */
    const cwRes = cwValidate(localRes[CW_KEY], builtinIds());
    S.custom = cwRes.ok;
    S.replays = Array.isArray(localRes[REPLAY_KEY]) ? localRes[REPLAY_KEY] : [];
    S.stats = (localRes[LIFE_KEY] && typeof localRes[LIFE_KEY] === 'object') ? localRes[LIFE_KEY] : {};

    rebuildWeapons();

    const presets = (S.arsenal && S.arsenal.presets) || {};
    S.preset = typeof stored.crsLoadoutPreset === 'string' ? stored.crsLoadoutPreset : (S.values.loadoutPreset || 'default');
    const knownIds = S.weapons.map((w) => w.id);
    const storedLoadout = Array.isArray(stored.crsLoadout) ? stored.crsLoadout.filter((x) => knownIds.indexOf(x) !== -1) : null;
    S.loadout = (storedLoadout && storedLoadout.length) ? storedLoadout.slice(0, LOADOUT_MAX)
      : (presets[S.preset] || presets.default || knownIds.slice(0, LOADOUT_MAX)).slice(0, LOADOUT_MAX);

    renderSettings();
    renderPresetSelect();
    renderArsenal();
    renderTable();
    renderStats();
    renderCustomTable();
    renderCustomForm(null);
    renderReplays();
    renderAbout();
    $('cw-json').value = JSON.stringify(S.custom, null, 2);
    document.body.setAttribute('data-ready', '1');
    if (cwRes.bad.length) {
      const first = cwRes.bad[0];
      toast(msg('cwBad', 'invalid custom weapon') + ' · ' + first.field + ' (' + first.reason + ')');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { main(); });
  else main();
})();
