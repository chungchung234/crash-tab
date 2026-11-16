'use strict';
/*
 * tools/promo.js — bake the Chrome Web Store promo tiles.
 *
 * Usage:
 *   node tools/promo.js            # store/promo/{small-440x280,marquee-1400x560}.png
 *   node tools/promo.js --check    # 치수만 확인하고 끝낸다
 *
 * 생성물이다. 손으로 고치지 말고 여기를 고쳐서 다시 굽는다 (tools/weapon-sheet.js 와 같은 규약).
 *
 * 왜 스크린샷이 아니라 그림인가: 스토어 가이드라인이 프로모 타일에 UI 스크린샷을 쓰지 말고
 * 글자를 최소로 하라고 한다. 스크린샷 5장은 따로 store/screenshots/ 에 있다.
 *
 * 그림은 제품의 정체성 그대로다 — 웹페이지의 **요소** 하나가 맞은 자리에서 쪼개진다.
 * 아이콘(tools/make-icons.py)의 깨진 유리 모티프를 같은 색으로 가져왔다: 네이비 #1b1f2a 바탕,
 * 창백한 파란 균열 #dfe8ff, 충격점의 흰 점. 조각은 실제 파괴와 같은 방식으로 만든다 —
 * 충격점에서 방사형으로 광선을 쏘고 이웃한 두 광선 사이의 쐐기를 카드 사각형으로 잘라낸다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'store', 'promo');
const NAVY = '#1b1f2a', GLOW = '#3a4566', RAY = '#dfe8ff', ACCENT = '#8ab4ff';

/* make-icons.py 와 같은 LCG. 같은 씨앗이면 같은 타일이 나온다. */
function lcg(seed) { let s = seed >>> 0; return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; }; }

/* 광선이 사각형 경계와 만나는 점. cx,cy 는 사각형 안에 있다고 본다. */
function rayHit(cx, cy, ang, R) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (R.x + R.w - cx) / dx);
  if (dx < -1e-9) t = Math.min(t, (R.x - cx) / dx);
  if (dy > 1e-9) t = Math.min(t, (R.y + R.h - cy) / dy);
  if (dy < -1e-9) t = Math.min(t, (R.y - cy) / dy);
  return [cx + dx * t, cy + dy * t];
}
const norm = (a) => { while (a < 0) a += Math.PI * 2; while (a >= Math.PI * 2) a -= Math.PI * 2; return a; };

/* 두 광선 사이의 쐐기. 사이에 든 사각형 모서리를 끼워 넣어야 모양이 맞는다. */
function wedge(cx, cy, a0, a1, R) {
  const pts = [[cx, cy], rayHit(cx, cy, a0, R)];
  const corners = [[R.x + R.w, R.y], [R.x + R.w, R.y + R.h], [R.x, R.y + R.h], [R.x, R.y]];
  const span = norm(a1 - a0);
  for (const c of corners) {
    const rel = norm(Math.atan2(c[1] - cy, c[0] - cx) - a0);
    if (rel > 1e-6 && rel < span - 1e-6) pts.push({ rel, c });
  }
  const mid = pts.filter((p) => p.rel !== undefined).sort((p, q) => p.rel - q.rel).map((p) => p.c);
  return [[cx, cy], rayHit(cx, cy, a0, R)].concat(mid, [rayHit(cx, cy, a1, R)]);
}
const poly = (p) => p.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* 부서지는 "웹페이지 요소" 한 장. 진짜 카드처럼 제목·본문 줄·버튼이 들어 있다. */
/* cs 는 **카드 디테일** 축척이고 타일 축척 s 와 다르다. 440x280 에서 s 를 그대로 쓰면
 * 본문 줄이 6px 도 안 돼서 목록에 작게 걸렸을 때 회색 죽으로 뭉갠다. 작은 타일은 굵게, 적게. */
function card(R, s, lines) {
  const cs = s, pad = 22 * cs, lh = 13 * cs;
  let g = `<rect x="${R.x}" y="${R.y}" width="${R.w}" height="${R.h}" rx="${10 * cs}" fill="#f7f8fa"/>`;
  g += `<rect x="${R.x + pad}" y="${R.y + pad}" width="${R.w * 0.52}" height="${20 * cs}" rx="${4 * cs}" fill="#2b3040"/>`;
  for (let i = 0; i < (lines || 4); i++) {
    const w = [0.84, 0.92, 0.7, 0.44][i];
    g += `<rect x="${R.x + pad}" y="${R.y + pad + 36 * cs + i * lh * 1.55}" width="${(R.w - pad * 2) * w}" height="${7 * cs}" rx="${3.5 * cs}" fill="#c2c8d4"/>`;
  }
  const by = R.y + R.h - pad - 30 * cs;
  g += `<rect x="${R.x + pad}" y="${by}" width="${96 * cs}" height="${30 * cs}" rx="${6 * cs}" fill="${ACCENT}"/>`;
  g += `<rect x="${R.x + pad + 118 * cs}" y="${by}" width="${72 * cs}" height="${30 * cs}" rx="${6 * cs}" fill="#dde2ea"/>`;
  return g;
}

function tile(W, H, opt) {
  const s = opt.s, rnd = lcg(opt.seed);
  const R = opt.card;                       // 카드 사각형
  const cx = R.x + R.w * opt.impact[0], cy = R.y + R.h * opt.impact[1];
  const N = opt.rays || 11;
  const angs = [];
  for (let i = 0; i < N; i++) angs.push(norm(i * (Math.PI * 2 / N) + (rnd() - 0.5) * 0.34));
  angs.sort((a, b) => a - b);

  let defs = '', body = '';
  /* 조각마다 clipPath 로 카드를 잘라 쓰고, 바깥으로 조금 밀고 돌린다. 충격점에서 멀수록 더. */
  for (let i = 0; i < N; i++) {
    const a0 = angs[i], a1 = angs[(i + 1) % N];
    const p = wedge(cx, cy, a0, a1, R);
    const mid = norm(a0 + norm(a1 - a0) / 2);
    /* 처음엔 모든 조각을 똑같이 밀었더니 쐐기 사이가 벌어져 **깨진 게 아니라 터진 것**으로 보였다.
     * 어두운 바탕이 틈으로 비쳐 검은 가시처럼 읽히고 카드가 카드로 안 보였다.
     * 그래서 대부분은 실금만 남게 거의 그대로 두고, 셋 중 하나만 확실히 떨어져 나가게 한다.
     * 떨어지는 조각에는 아래로 치우친 성분을 준다 — 제품에서도 조각은 떨어진 자리에 쌓인다. */
    const detach = rnd() < 0.34;
    const push = (detach ? 16 + rnd() * 26 : 0.6 + rnd() * 3.2) * s * opt.spread;
    const rot = (detach ? (rnd() - 0.5) * 17 : (rnd() - 0.5) * 2.4) * opt.spread;
    const tx = Math.cos(mid) * push, ty = Math.sin(mid) * push + (detach ? push * 0.42 : 0);
    defs += `<clipPath id="c${i}"><polygon points="${poly(p)}"/></clipPath>`;
    body += `<g transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) rotate(${rot.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})">`
      + `<g clip-path="url(#c${i})">${card(R, opt.cs, opt.lines)}`
      + `<polygon points="${poly(p)}" fill="none" stroke="rgba(20,24,34,${detach ? '.5' : '.26'})" stroke-width="${(detach ? 1.2 : 0.8) * s}"/></g></g>`;
  }
  /* 아이콘의 균열 웹: 충격점에서 나가는 광선 + 흔들린 동심 링 */
  let web = '';
  for (let i = 0; i < N; i++) {
    const [ex, ey] = rayHit(cx, cy, angs[i], R);
    web += `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${RAY}" stroke-width="${1.5 * s}" stroke-opacity=".85"/>`;
  }
  for (const f of [0.3, 0.58]) {
    const pts = angs.map((a) => { const [ex, ey] = rayHit(cx, cy, a, R); const j = f * (0.86 + rnd() * 0.3); return [cx + (ex - cx) * j, cy + (ey - cy) * j]; });
    web += `<polygon points="${poly(pts)}" fill="none" stroke="${RAY}" stroke-width="${1.2 * s}" stroke-opacity=".6"/>`;
  }

  /* 떨어져 나간 작은 파편 몇 개 */
  let bits = '';
  for (let i = 0; i < opt.bits; i++) {
    const a = rnd() * Math.PI * 2, d = (R.w * 0.52) + rnd() * R.w * 0.42;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.72 + rnd() * 26 * s;
    const sz = (3 + rnd() * 9) * s;
    bits += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${sz.toFixed(1)}" height="${(sz * (0.5 + rnd())).toFixed(1)}" rx="${1 * s}" `
      + `fill="#e8ecf4" fill-opacity="${(0.3 + rnd() * 0.5).toFixed(2)}" transform="rotate(${(rnd() * 90 - 45).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>${defs}
<radialGradient id="bg" cx="${(cx / W * 100).toFixed(0)}%" cy="${(cy / H * 100).toFixed(0)}%" r="78%">
<stop offset="0%" stop-color="${GLOW}"/><stop offset="100%" stop-color="${NAVY}"/></radialGradient>
<radialGradient id="flash" r="50%"><stop offset="0%" stop-color="#fff" stop-opacity=".95"/><stop offset="60%" stop-color="${RAY}" stop-opacity=".35"/><stop offset="100%" stop-color="${RAY}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
${bits}
${body}
${web}
<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${34 * s}" fill="url(#flash)"/>
<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${3.4 * s}" fill="#fff"/>
${opt.text}
</svg>`;
}

const FONT = "'Apple SD Gothic Neo','Pretendard','Noto Sans KR','Helvetica Neue',sans-serif";

function small() {
  const W = 440, H = 280, s = 0.82;
  const R = { x: 138, y: 26, w: 286, h: 186 };
  const text = `<text x="26" y="248" font-family="${FONT}" font-size="34" font-weight="800" fill="#fff" letter-spacing="-.5">${esc('화면부수기')}</text>`
    + `<text x="26" y="270" font-family="${FONT}" font-size="14" font-weight="600" fill="${ACCENT}" letter-spacing="1.6">CRASH SCREEN</text>`;
  return { W, H, svg: tile(W, H, { s, cs: 1.3, lines: 3, rays: 8, seed: 7, card: R, impact: [0.44, 0.44], spread: 1, bits: 18, text }) };
}

function marquee() {
  const W = 1400, H = 560, s = 1.7;
  const R = { x: 712, y: 72, w: 596, h: 416 };
  const text = `<text x="86" y="252" font-family="${FONT}" font-size="92" font-weight="800" fill="#fff" letter-spacing="-2">${esc('화면부수기')}</text>`
    + `<text x="92" y="300" font-family="${FONT}" font-size="26" font-weight="600" fill="${ACCENT}" letter-spacing="5">CRASH SCREEN</text>`
    + `<text x="90" y="372" font-family="${FONT}" font-size="31" font-weight="500" fill="rgba(255,255,255,.80)">${esc('웹페이지의 요소를 직접 부순다.')}</text>`
    + `<text x="90" y="416" font-family="${FONT}" font-size="31" font-weight="500" fill="rgba(255,255,255,.46)">${esc('끄면 흔적이 남지 않는다.')}</text>`;
  return { W, H, svg: tile(W, H, { s, cs: s, lines: 4, rays: 11, seed: 23, card: R, impact: [0.38, 0.44], spread: 1.15, bits: 40, text }) };
}

(async () => {
  const want = [['small-440x280', small()], ['marquee-1400x560', marquee()]];
  if (process.argv.includes('--check')) {
    let bad = 0;
    for (const [name] of want) {
      const f = path.join(OUT_DIR, name + '.png');
      if (!fs.existsSync(f)) { console.log('MISSING ' + name + '.png'); bad++; continue; }
      const b = fs.readFileSync(f), w = b.readUInt32BE(16), h = b.readUInt32BE(20);
      const [ew, eh] = name.split('-')[1].split('x').map(Number);
      const ok = w === ew && h === eh;
      console.log((ok ? 'OK   ' : 'BAD  ') + name + '.png  ' + w + 'x' + h);
      if (!ok) bad++;
    }
    process.exit(bad ? 1 : 0);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try {
    for (const [name, t] of want) {
      const page = await browser.newPage();
      await page.setViewport({ width: t.W, height: t.H, deviceScaleFactor: 1 });
      await page.setContent('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:' + NAVY + '}svg{display:block}</style>' + t.svg,
        { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const out = path.join(OUT_DIR, name + '.png');
      await page.screenshot({ path: out, type: 'png' });
      await page.close();
      const b = fs.readFileSync(out);
      console.log('promo: ' + path.relative(ROOT, out) + '  ' + b.readUInt32BE(16) + 'x' + b.readUInt32BE(20) + '  ' + (b.length / 1024).toFixed(1) + ' KB');
    }
  } finally { await browser.close(); }
})().catch((e) => { console.error('promo: ' + ((e && e.message) || e)); process.exit(1); });
