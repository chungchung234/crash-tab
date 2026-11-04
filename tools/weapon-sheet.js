#!/usr/bin/env node
'use strict';
/*
 * tools/weapon-sheet.js — the SPEC-weapon-art §4 "render and LOOK" loop.
 *
 * Draws every weapon twice and writes two contact sheets:
 *
 *   test/out/weapons.png        detail LOD at 200 px, 5 × 2, on a dark ground
 *   test/out/weapons-icon.png   icon LOD rendered at a TRUE 24 px, then blown
 *                               up 400 % with nearest-neighbour so the 24 px
 *                               pixel grid is what you are actually judging
 *
 * The point of the second sheet is that it is NOT a 96 px drawing: the icons are
 * rasterised at 24 CSS px with deviceScaleFactor 1 and only then magnified, so a
 * detail that disappears into a single grey pixel disappears here too.
 *
 * Usage:
 *   node tools/weapon-sheet.js              both sheets
 *   node tools/weapon-sheet.js hammer axe   only those ids (same file names)
 *   node tools/weapon-sheet.js --light      light ground instead of dark
 *   node tools/weapon-sheet.js --r18        SPEC-weapon-identity §G4 용 래스터만 만든다:
 *                                           아이콘을 **투명 배경 위 진짜 48×48** 로 한 줄에 굽고
 *                                           test/out/weapons-r18.png 에 쓴 뒤 id 순서를 JSON 으로
 *                                           표준출력에 찍는다. tools/validate.js 의 R18 이 이것을
 *                                           읽어 쌍마다 실루엣·색을 비교한다. puppeteer 가 없으면
 *                                           exit 2 — R18 은 그때 SKIP 한다(FAIL 이 아니다).
 *
 * Zero npm dependencies; puppeteer is resolved exactly the way test/e2e.js does.
 * src/44-weapon-art.js is evaluated directly (not content.js), so the loop never
 * waits for a build — the module only needs `doc`, `SVG_NS` and `px` from the
 * prelude, and every other name it mentions lives inside a function body that
 * this harness never calls.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'test', 'out');

function resolvePuppeteer() {
  const candidates = [];
  if (process.env.PUPPETEER_PATH) candidates.push(process.env.PUPPETEER_PATH);
  const npx = path.join(os.homedir(), '.npm', '_npx');
  try {
    for (const dir of fs.readdirSync(npx)) {
      const p = path.join(npx, dir, 'node_modules', 'puppeteer');
      if (fs.existsSync(path.join(p, 'package.json'))) candidates.push(p);
    }
  } catch (_) { /* no npx cache */ }
  for (const c of candidates) {
    try { return require(c); } catch (_) { /* next */ }
  }
  try { return require('puppeteer'); } catch (_) { return null; }
}

/* The prelude names src/44-weapon-art.js actually reads at module scope. `debug` is there because the
 * module hangs its §5 test seam (debug.weaponPng) off it at load time; everything else it mentions lives
 * inside a function body this harness never calls. */
const SHIM =
  "  const win = window;\n" +
  "  const doc = document;\n" +
  "  const SVG_NS = 'http://www.w3.org/2000/svg';\n" +
  "  const debug = {};\n" +
  "  const px = (v) => (Math.round(v * 100) / 100) + 'px';\n" +
  /* 이 목록은 src/44-weapon-art.js 가 prelude 에서 빌려 쓰는 전역이다. 7단계가 미니건 아트에
   * DEG 를 쓰면서 이 시트가 'DEG is not defined' 로 죽었고, 그 뒤로 무기 그림을 눈으로 본
   * 사람이 없다 — 그 사이 무기가 12종에서 23종이 됐다. 아트가 새 전역을 쓰면 여기도 늘린다.
   * tools/validate.js 가 이 목록과 아트의 자유 변수를 대조한다(R17). */
  "  const DEG = Math.PI / 180;\n" +
  "  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);\n" +
  "  const rand = (a, b) => a + Math.random() * (b - a);\n" +
  /* 아래 다섯은 §4 의 그리기 경로가 아니라 HUD 쪽 함수들(statLine · syncWeaponArt · syncAmmoArt)이
   * 번들의 다른 모듈에서 빌려 쓰는 이름이다. 이 하네스는 그 함수들을 부르지 않지만, R18 이 "자유
   * 변수가 전부 심 또는 prelude 에 있다" 를 검사하는 이상 **빌려 쓰는 것은 전부 여기 있어야 한다** —
   * 그래야 "아직 안 부르니까 괜찮다" 가 아니라 "불러도 괜찮다" 가 된다. 전부 무해한 더미다. */
  "  const msg = (k) => String(k);\n" +
  "  const weaponLabel = (id) => String(id);\n" +
  "  const swapMsOf = () => 250;\n" +
  "  const slotOf = () => -1;\n" +
  "  const slotKey = () => '';\n";

function bootSource() {
  const src = fs.readFileSync(path.join(ROOT, 'src', '44-weapon-art.js'), 'utf8');
  return '(() => {\n  "use strict";\n' + SHIM + src +
    '\n  window.__art = { weaponArt: weaponArt, ids: weaponArtIds() };\n})();';
}

const BG_DARK = '#191d25';
const BG_LIGHT = '#e9ecf1';

/* ── SPEC-weapon-identity §G4: 48×48 래스터 ───────────────────────────────────────────────────────
 * "아이콘 48×48 을 실제로 래스터화해 쌍마다 비교한다." 그러려면 **투명 배경** 위에 구워야 한다 —
 * 실루엣 비교가 보는 것이 알파 채널이고, 바탕색이 칠해져 있으면 모든 아이콘의 알파가 1 이 되어
 * 자카드 거리가 전부 0 이 된다(즉 검사가 아무것도 안 한다).
 *
 * 한 장에 한 줄로 굽는다. 아이콘마다 스크린샷을 찍으면 23번의 왕복이 되고, 그 시간이 validate 를
 * 느리게 만들어 결국 아무도 안 돌리게 된다. 자르는 쪽은 R18 이 한다. */
async function bakeR18(browser, ids, boot) {
  const CELL = 48;
  const page = await browser.newPage();
  await page.setViewport({ width: ids.length * CELL, height: CELL, deviceScaleFactor: 1 });
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
  const err = await page.evaluate((code) => { try { eval(code); return null; } catch (e) { return String(e && e.stack || e); } }, boot);
  if (err) throw new Error('module failed to evaluate:\n' + err);
  await page.evaluate((ids2, cell) => {
    document.documentElement.style.background = 'transparent';
    document.body.style.margin = '0';
    document.body.style.background = 'transparent';
    const row = document.createElement('div');
    row.style.display = 'flex';
    document.body.append(row);
    for (const id of ids2) {
      const c = document.createElement('div');
      c.style.width = cell + 'px';
      c.style.height = cell + 'px';
      c.style.overflow = 'hidden';          /* 48×48 밖은 아이콘이 아니다 — 잘린다 */
      c.style.flex = '0 0 auto';
      /* lod 를 'icon' 으로 **명시**한다. 크기로 고르게 두면 48 은 DETAIL_MIN(64) 미만이라 지금은
       * 우연히 맞지만, 그 상수가 움직이는 날 검사가 조용히 다른 그림을 보게 된다. */
      c.append(window.__art.weaponArt(id, cell, 'icon'));
      row.append(c);
    }
  }, ids, CELL);
  const out = path.join(OUT, 'weapons-r18.png');
  await page.screenshot({ path: out, omitBackground: true });
  await page.close();
  return { path: out, cell: CELL, ids };
}

async function main() {
  const args = process.argv.slice(2);
  const light = args.includes('--light');
  const want = args.filter((a) => !a.startsWith('--'));
  const sizeArg = Math.max(48, Number((args.find((a) => a.startsWith('--size=')) || '').slice(7)) || 200);
  const cols = Math.max(1, Math.min(5, Number((args.find((a) => a.startsWith('--cols=')) || '').slice(7)) || 5));
  const bg = light ? BG_LIGHT : BG_DARK;
  const fg = light ? '#333a45' : '#c9d2e0';

  const puppeteer = resolvePuppeteer();
  if (!puppeteer) { console.error('weapon-sheet: puppeteer not found'); process.exit(2); }   /* exit 2 는 "못 돌렸다" 다 — R18 이 SKIP 과 FAIL 을 이것으로 가른다 */
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check'].concat(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [])
  });
  try {
    const boot = bootSource();

    /* ---------- §G4: the R18 raster, and nothing else ---------- */
    if (args.includes('--r18')) {
      const p0 = await browser.newPage();
      await p0.setContent('<!doctype html><meta charset="utf-8"><body></body>');
      const e0 = await p0.evaluate((code) => { try { eval(code); return null; } catch (e) { return String(e && e.stack || e); } }, boot);
      if (e0) { console.error('weapon-sheet: module failed to evaluate:\n' + e0); process.exit(1); }
      const all = await p0.evaluate(() => window.__art.ids);
      await p0.close();
      const pick = want.length ? all.filter((i) => want.includes(i)) : all;
      const baked = await bakeR18(browser, pick, boot);
      process.stdout.write(JSON.stringify({ path: path.relative(ROOT, baked.path), cell: baked.cell, ids: baked.ids }) + '\n');
      return;
    }

    /* ---------- sheet 1: detail LOD at 200 px ---------- */
    const p1 = await browser.newPage();
    await p1.setViewport({ width: Math.min(1600, sizeArg * cols + 60), height: 900, deviceScaleFactor: 1 });
    await p1.setContent('<!doctype html><meta charset="utf-8"><body></body>');
    const err = await p1.evaluate((code) => { try { eval(code); return null; } catch (e) { return String(e && e.stack || e); } }, boot);
    if (err) { console.error('weapon-sheet: module failed to evaluate:\n' + err); process.exit(1); }

    const ids = await p1.evaluate((only) => {
      const all = window.__art.ids;
      return only.length ? all.filter((i) => only.includes(i)) : all;
    }, want);
    if (!ids.length) { console.error('weapon-sheet: no matching weapon ids'); process.exit(1); }

    const size1 = await p1.evaluate((ids2, bg2, fg2, sz, cols2) => {
      document.body.style.margin = '0';
      document.body.style.background = bg2;
      document.body.style.font = '14px system-ui, -apple-system, sans-serif';
      const grid = document.createElement('div');
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(' + cols2 + ', 1fr)';
      grid.style.gap = '4px';
      grid.style.padding = '10px';
      document.body.append(grid);
      for (const id of ids2) {
        const cell = document.createElement('div');
        cell.style.display = 'flex';
        cell.style.flexDirection = 'column';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'flex-end';
        cell.style.height = (sz * 0.72) + 'px';
        cell.style.background = 'rgba(127,127,127,.09)';
        cell.style.borderRadius = '6px';
        const art = document.createElement('div');
        art.style.flex = '1 1 auto';
        art.style.display = 'flex';
        art.style.alignItems = 'center';
        art.append(window.__art.weaponArt(id, sz));
        const lab = document.createElement('div');
        lab.textContent = id;
        lab.style.color = fg2;
        lab.style.padding = '2px 0 6px';
        lab.style.letterSpacing = '.04em';
        cell.append(art, lab);
        grid.append(cell);
      }
      const r = document.body.getBoundingClientRect();
      return { w: Math.ceil(r.width), h: Math.ceil(document.body.scrollHeight) };
    }, ids, bg, fg, sizeArg, cols);

    await p1.setViewport({ width: Math.max(320, size1.w), height: Math.max(120, size1.h), deviceScaleFactor: 1 });
    const detailPath = path.join(OUT, 'weapons.png');
    await p1.screenshot({ path: detailPath });
    console.log('weapon-sheet: wrote ' + path.relative(ROOT, detailPath) + '  (' + ids.length + ' weapons, detail LOD @' + sizeArg + 'px)');

    /* ---------- sheet 2: icon LOD rasterised at a true 24 px ---------- */
    const CELL = 34, PAD = 6;                       // 24 px icon centred in a 34 px cell
    const p2 = await browser.newPage();
    await p2.setViewport({ width: ids.length * CELL + PAD * 2, height: CELL + PAD * 2, deviceScaleFactor: 1 });
    await p2.setContent('<!doctype html><meta charset="utf-8"><body></body>');
    await p2.evaluate((code) => { eval(code); }, boot);
    await p2.evaluate((ids2, bg2, cell, pad) => {
      document.body.style.margin = '0';
      document.body.style.background = bg2;
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.padding = pad + 'px';
      document.body.append(row);
      for (const id of ids2) {
        const c = document.createElement('div');
        c.style.width = cell + 'px';
        c.style.height = cell + 'px';
        c.style.display = 'flex';
        c.style.alignItems = 'center';
        c.style.justifyContent = 'center';
        c.append(window.__art.weaponArt(id, 24));
        row.append(c);
      }
    }, ids, bg, CELL, PAD);
    const rawIcon = await p2.screenshot({ encoding: 'base64' });

    /* magnify 400 % with nearest-neighbour and caption each column */
    const p3 = await browser.newPage();
    const Z = 4;
    await p3.setViewport({ width: (ids.length * CELL + PAD * 2) * Z, height: (CELL + PAD * 2) * Z + 26, deviceScaleFactor: 1 });
    await p3.setContent('<!doctype html><meta charset="utf-8"><body></body>');
    await p3.evaluate((b64, ids2, cell, pad, z, bg2, fg2) => new Promise((done) => {
      document.body.style.margin = '0';
      document.body.style.background = bg2;
      document.body.style.font = '13px system-ui, -apple-system, sans-serif';
      const img = new Image();
      img.onload = () => {
        img.style.width = (img.naturalWidth * z) + 'px';
        img.style.height = (img.naturalHeight * z) + 'px';
        img.style.imageRendering = 'pixelated';
        img.style.display = 'block';
        document.body.append(img);
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.paddingLeft = (pad * z) + 'px';
        row.style.color = fg2;
        for (const id of ids2) {
          const t = document.createElement('div');
          t.textContent = id;
          t.style.width = (cell * z) + 'px';
          t.style.textAlign = 'center';
          row.append(t);
        }
        document.body.append(row);
        done();
      };
      img.src = 'data:image/png;base64,' + b64;
    }), rawIcon, ids, CELL, PAD, Z, bg, fg);
    const iconPath = path.join(OUT, 'weapons-icon.png');
    await p3.screenshot({ path: iconPath });
    console.log('weapon-sheet: wrote ' + path.relative(ROOT, iconPath) + '  (icon LOD rasterised @24px, shown at 400%)');

    /* ---------- element / gradient census, printed so the loop is measurable ---------- */
    const census = await p1.evaluate((ids2) => {
      const out = {};
      for (const id of ids2) {
        const d = window.__art.weaponArt(id, 200), i = window.__art.weaponArt(id, 24);
        const count = (n) => n.querySelectorAll('*').length - n.querySelectorAll('defs *').length - n.querySelectorAll('defs').length;
        out[id] = {
          detail: count(d), icon: count(i),
          grads: d.querySelectorAll('linearGradient,radialGradient').length,
          vb: d.getAttribute('viewBox') + ' / ' + i.getAttribute('viewBox')
        };
      }
      return out;
    }, ids);
    for (const id of ids) {
      const c = census[id];
      console.log('  ' + id.padEnd(9) + ' detail ' + String(c.detail).padStart(3) + ' el, icon ' + String(c.icon).padStart(2) + ' el, ' + String(c.grads).padStart(2) + ' grads   ' + c.vb);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
