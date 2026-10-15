#!/usr/bin/env node
'use strict';
/*
 * tools/balance.js — SPEC-arsenal §F, 밸런스를 문서가 아니라 실행 가능한 검사로.
 *
 * Usage:
 *   node tools/balance.js              print the table (실전 / 특수 / 예능, 표적 5종 처치 시간)
 *   node tools/balance.js --check      exit 1 on any §F6 violation; also fails when
 *                                      docs/BALANCE.md is stale (fix: --write)
 *   node tools/balance.js --write      regenerate docs/BALANCE.md
 *   node tools/balance.js --json       the whole model as JSON (test/e2e.js reads this)
 *   node tools/balance.js --quiet      no stdout (useful with --check / --write)
 *
 * Also usable as a library:  require('./balance.js').model()  ->  { weapons, median, violations, ... }
 * test/e2e.js uses that to assert the PRODUCT's own published numbers against this
 * static parse — the tool and the shipping table can never drift apart silently.
 *
 * Zero dependencies, pure Node, no eval of product source: the weapon table is read
 * out of src/ as TEXT and turned into JSON by hand (parseObjectLiteral below).
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
/* `CRS_BALANCE_SRC` points the parse at a DIFFERENT src tree. It exists so test/e2e.js can prove that
 * --check really bites: it writes a deliberately broken copy of the weapon table into a temp directory and
 * asserts exit 1 with the §F6 rule numbers it expected. Nothing in CI sets it. */
const SRC_DIR = process.env.CRS_BALANCE_SRC ? path.resolve(process.env.CRS_BALANCE_SRC) : path.join(REPO_ROOT, 'src');
const DOC_PATH = path.join(REPO_ROOT, 'docs', 'BALANCE.md');
/* SPEC-product §1 무기 비교표. The options page is an extension page: content.js never runs there, so it
 * cannot ask the product what the arsenal is. Rather than keep a second hand-written copy of the weapon
 * table (which would drift), the table is GENERATED here from the same static parse the balance model uses
 * — `--write` writes it, `--check` fails when it is stale, exactly like docs/BALANCE.md. */
const ARSENAL_PATH = path.join(REPO_ROOT, 'options', 'arsenal.json');

/* ===================================================================== */
/* 0. Static parsing of src/ — text in, plain objects out                 */
/* ===================================================================== */

function readSrc(name) { return fs.readFileSync(path.join(SRC_DIR, name), 'utf8'); }

/** Strip /* *​/ and // comments without touching string literals. */
function stripComments(s) {
  let out = '';
  let i = 0;
  let quote = '';
  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += (d == null ? '' : d); i += 2; continue; }
      if (c === quote) quote = '';
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && d === '*') { const end = s.indexOf('*/', i + 2); i = end < 0 ? s.length : end + 2; out += ' '; continue; }
    if (c === '/' && d === '/') { const end = s.indexOf('\n', i); i = end < 0 ? s.length : end; continue; }
    out += c; i++;
  }
  return out;
}

/** Find `<decl> <name> = {` and return the brace-matched literal text (braces included). */
function sliceLiteral(src, name, open, close) {
  const re = new RegExp('(?:const|let|var)\\s+' + name + '\\s*=\\s*\\' + open);
  const m = re.exec(src);
  if (!m) throw new Error('balance.js: could not find `' + name + '` in src/');
  const start = m.index + m[0].length - 1;
  let depth = 0, quote = '';
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('balance.js: `' + name + '` literal is not brace-balanced');
}

const INF = '__INFINITY__';

/** Turn a comment-free JS object/array literal of plain values into real data.
 * `consts` resolves a bare SCREAMING_CASE identifier used as a value (src/71's `pierce: PIERCE_ALL`). */
function literalToData(text, consts) {
  let s = text;
  s = s.replace(/\bInfinity\b/g, '"' + INF + '"');
  s = s.replace(/:\s*([A-Z][A-Z0-9_]*)\s*(?=[,}\]])/g, (whole, name) => {
    const v = consts && consts[name];
    if (typeof v !== 'number') throw new Error('balance.js: `' + name + '` is used as a value but is not a known numeric constant');
    return ': ' + v;
  });
  s = s.replace(/'((?:[^'\\]|\\.)*)'/g, (_, body) => JSON.stringify(body.replace(/\\'/g, "'")));
  s = s.replace(/([{,[]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');
  s = s.replace(/,(\s*[}\]])/g, '$1');
  let data;
  try { data = JSON.parse(s); }
  catch (e) { throw new Error('balance.js: static parse failed (' + e.message + ')\n' + s.slice(0, 400)); }
  return revive(data);
}
function revive(v) {
  if (v === INF) return Infinity;
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = revive(v[k]); return o; }
  return v;
}

/** `const NAME = <number>` declarations, for the burn constants §F3's dotDPS is made of. */
function numericConsts(src) {
  const out = {};
  const re = /(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*(?:,|;)/g;
  let m;
  while ((m = re.exec(src))) out[m[1]] = Number(m[2]);
  /* `const A = 1, B = 2;` — the regex above catches A, this catches B and onwards. */
  const re2 = /,\s*([A-Z][A-Z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)/g;
  while ((m = re2.exec(src))) if (out[m[1]] == null) out[m[1]] = Number(m[2]);
  return out;
}

/* SPEC-product §6: 사용자 정의 무기(`cw_…`)는 런타임에 chrome.storage.local 에서 붙는다. 이 도구는
 * src/ 를 정적으로 읽으므로 구조적으로 그것들을 볼 수 없고, **보여서도 안 된다** — §F 의 밴드는 내장
 * 무기들 사이의 관계이고, 사용자가 만든 무기를 그 중앙값 계산에 넣으면 밸런스 검사가 사용자 데이터에
 * 따라 통과했다 말았다 하게 된다. 아래 한 줄은 그 사실을 "우연히 그렇다" 에서 "그렇게 정했다" 로
 * 바꾸는 가드다: 어떤 경로로든 `cw_` 로 시작하는 id 가 들어오면 모델에서 떨어진다. */
const CUSTOM_ID_RE = /^cw_/;

/** Read the whole arsenal: WEAPONS (src/00) merged with WEAPON_STATS (src/71). */
function readArsenal() {
  const prelude = stripComments(readSrc('00-prelude.js'));
  const helpers = stripComments(readSrc('71-weapon-helpers.js'));
  const preludeConsts = numericConsts(prelude);
  const helperConsts = numericConsts(helpers);
  const idsAll = literalToData(sliceLiteral(prelude, 'WEAPON_IDS', '[', ']'), preludeConsts);
  const ids = idsAll.filter((id) => !CUSTOM_ID_RE.test(String(id)));   // §6: 사용자 정의 무기는 밸런스 검사 대상이 아니다
  const weapons = literalToData(sliceLiteral(prelude, 'WEAPONS', '{', '}'), preludeConsts);
  const stats = literalToData(sliceLiteral(helpers, 'WEAPON_STATS', '{', '}'), helperConsts);
  const roles = literalToData(sliceLiteral(prelude, 'WEAPON_ROLES', '{', '}'), preludeConsts);
  /* SPEC-weapon-identity §C3 표적 등급 계수. `src/00-prelude.js` 가 `WEAPONS[id].vs` 로 붙이는 표를 같은
   * 정적 파싱으로 읽는다 — §F6-7 · §F6-8 이 보는 것이 이 값이다. */
  const vs = literalToData(sliceLiteral(prelude, 'WEAPON_VS', '{', '}'), preludeConsts);
  const presets = literalToData(sliceLiteral(prelude, 'PRESETS', '{', '}'), preludeConsts);
  const swapDefault = Number((/(?:const|let|var)\s+SWAP_MS\s*=\s*(\d+)/.exec(prelude) || [])[1] || 250);
  const loadoutMax = Number((/(?:const|let|var)\s+LOADOUT_MAX\s*=\s*(\d+)/.exec(prelude) || [])[1] || 10);
  const burn = numericConsts(stripComments(readSrc('77-burn.js')));
  const out = {};
  for (const id of ids) {
    if (!weapons[id]) throw new Error('balance.js: WEAPON_IDS names `' + id + '` but WEAPONS has no such row');
    /* src/71 runs `Object.assign(WEAPONS[id], WEAPON_STATS[id])`, and `Object.assign(W, undefined)` is a
     * no-op — so a weapon with no WEAPON_STATS row keeps the stat block written inline in src/00. */
    out[id] = Object.assign({}, weapons[id], stats[id] || {}, roles[id] || {});
    if (vs[id]) out[id].vs = vs[id];
  }
  return { ids, weapons: out, roles, vs, presets, swapDefault, loadoutMax, burn };
}

/* ===================================================================== */
/* 1. §F2 기준 표적 · §F3 공통 통화                                        */
/* ===================================================================== */

/* §F2. The five reference targets, max health.
 *
 * SPEC-weapon-identity §C2 groups them into FOUR grades by area (낱말 < 3,000 · 작은 것 ~20,000 ·
 * 중간 ~150,000 · 큰 것 그 위) and §C3 multiplies a weapon's damage by `vs[grade]`. The mapping below is
 * §C2's own prose read onto the five targets that already existed: 단어 조각 = 낱말, 버튼 = 작은 것,
 * 카드 둘 = 중간 ("중간: 카드 · 이미지"), 큰 섹션 = 큰 것 ("큰 것: 섹션 · 큰 컨테이너"). INTERPRETATION
 * (보고에 적었다): §C2 lists areas and §F2 lists hit points, and the two are not the same axis — the join
 * is by what the target IS, which is what both texts name. */
const GRADES = [
  { key: 'word', label: '낱말', maxArea: 3000 },
  { key: 'small', label: '작은 것', maxArea: 20000 },
  { key: 'mid', label: '중간', maxArea: 150000 },
  { key: 'large', label: '큰 것', maxArea: Infinity }
];
/* `area` is the reference target's own px², and the grade is read off §C2's bands from it — the join is
 * the product's own `ownHp()` (src/50-target.js: base = 20 + 0.35·√area, 텍스트 ×0.6), which inverts the
 * five published hit points back onto the fixture geometry they came from almost exactly:
 *   19 → ≈1,100 px² (단어 조각)      44 → ≈4,700 px² (버튼 120×44 = 5,280)
 *   99 → ≈50,900 px² (작은 카드 320×~150)   184 → ≈220,000 px² (큰 카드 580×380 = 220,400)
 *   253 → ≈443,000 px² (큰 섹션 1000×420 = 441,840)
 * So 큰 카드 is a 큰 것 by §C2's own number, not a 중간 — the area decides, not the label. */
const TARGETS = [
  { key: 'word', hp: 19, area: 1120, label: '단어 조각' },
  { key: 'button', hp: 44, area: 5280, label: '버튼' },
  { key: 'smallCard', hp: 99, area: 50900, label: '작은 카드' },
  { key: 'bigCard', hp: 184, area: 220400, label: '큰 카드' },
  { key: 'section', hp: 253, area: 441840, label: '큰 섹션' }
];
function gradeForArea(area) {
  for (const g of GRADES) if (area <= g.maxArea) return g.key;
  return 'large';
}
for (const t of TARGETS) t.grade = gradeForArea(t.area);

const BIG_CARD_HP = 184;
const SECTION_HP = 253;

/* §A1's own number: under 120 ms a press is "평소의 일반 공격". A click weapon with no cooldown can
 * therefore be asked for a shot every 120 ms and no faster — that is the floor this model uses, and it
 * is the SAME constant the §D band check in test/e2e.js uses, so the two models never disagree. */
const CLICK_FLOOR_MS = 120;
/* SPEC-weapon-identity §B1: 유효산포 σ. `spread` is the weapon's own cone; sustained fire adds bloom up to
 * bloom × 10 (src/71-weapon-helpers.js noteShot/bloomNow).
 *
 * INTERPRETATION (보고에 적었다). 지속 사격의 **상한**을 쓴다. 9단계까지는 그 절반(평균)이었고 그 평균이
 * handling 의 포화 상한과 짝이 되어 §A4 의 구멍을 만들었다. §A3 · §B2 의 표가 전부 상한 σ 로 계산되어
 * 있고(미니건 bloom 14 → 140px), §F6-6 이 "샷건은 펠릿 보정값으로 본다" 고 단서를 단 것도 상한에서만
 * 뜻이 있다 — 평균으로 보면 샷건은 보정 없이도 문턱을 넘어 그 문장이 죽는다. 그래서 σ = spread + bloom × 10.
 *
 * 이 σ 는 **무기 표가 발행하는 산포**다. 발사 시점에만 있는 두 가지 — 반동 킥(recoil × 6, 250ms 감쇠)과
 * 기관단총/미니건 fire() 안의 기계적 ±9 / ±7 원뿔 — 은 표에 없으므로 여기 들어가지 않는다. 그래서 아래
 * pHit 은 **상한**이고, 진짜로 쏴서 센 명중률은 그보다 조금 낮다. 그 차이는 test/e2e.js 의 실측 단언이 본다. */
const BLOOM_CAP_MUL = 10;
const SWAP_REF = 2000;         // §F3: (1 − swapMs/2000)
const SWAP_DEFAULT_MS = 250;   // src/00-prelude.js `SWAP_MS` — the fallback ttk() uses when none is passed

/* §B1: 기준 표적은 버튼 120×44 로 고정한다 — "가장 작고 가장 자주 겨누는 것". */
const HIT_BOX = { w: 120, h: 44, label: '버튼 120×44' };
/* Abramowitz–Stegun 7.1.26. |ε| ≤ 1.5e-7 — §B1 이 요구한 1e-7 정밀도를 만족한다. Math.erf 는 없다. */
function erf(x) {
  const s = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return s * y;
}
/* §B1: pHit(W, 표적) = erf((w/2)/(σ√2)) × erf((h/2)/(σ√2)). 2차원 가우시안, x·y 가 독립이다
 * (shotPoint() 가 gauss(s) 를 두 축에 따로 더한다 — src/71-weapon-helpers.js). */
function pHitOf(sigma, box) {
  if (!(sigma > 0)) return 1;
  const k = sigma * Math.SQRT2;
  return erf((box.w / 2) / k) * erf((box.h / 2) / k);
}
/* §F3: "연소는 dotDPS 를 가산". Only the two weapons that stack burn EVERY tick keep a target saturated;
 * a blast ignites once and the stack decays. The stack numbers come from src/77-burn.js itself. */
const BURN_WEAPONS = { flame: 'BURN_FLAME_STACKS', laser: 'BURN_LASER_STACKS' };

/* §F4 바디: category band. 붕괴 is listed under 실전 by §F4 but excluded from the band check in the very
 * next line ("붕괴는 쿨다운으로 제한되는 특수기이므로 밴드 검사에서 제외한다"). */
const BANDS = {
  field: { label: '실전', lo: 0.82, hi: 1.18 },
  special: { label: '특수', lo: 0.40, hi: 0.90 },
  fun: { label: '예능', lo: 0.25, hi: 0.50 }
};
const BAND_EXEMPT = new Set(['collapse']);
/* §F6-6 (SPEC-weapon-identity §B1): 실전 무기가 버튼을 맞힐 확률의 바닥. */
const PHIT_MIN = 0.55;
/* §F6 rule 3's own exemptions. 슬러그 is the shotgun's 보조 공격 and 충전 로켓 the rocket's, so both are
 * alt-fire rather than a weapon id — the rule below only ever looks at a weapon's BASE attack, which is
 * why neither needs naming here; 붕괴 does, because 전체 연쇄 IS its base attack. */
const ONESHOT_EXEMPT = new Set(['collapse']);

/* §F5 역할 — the label for each `role` id published by the weapon table. 하나도 겹치면 안 된다. */
const ROLE_LABEL = {
  'single-mid': '중형 단일 효율',
  'reaction': '즉응성',
  'mid-range': '중거리 균형',
  'single-max': '단발 최대와 무감쇠',
  'melee-max': '근접 최대 피해',
  'crit-mobility': '치명타율과 기동성',
  'area-efficiency': '범위당 효율',
  'area-single-max': '단발 범위 최대',
  'stacked-damage': '누적 화력 최대',
  'pierce-cut': '관통과 절단선 자유도',
  'sustained-max': '지속 화력 최대',
  'cluster': '밀집 다수 동시',
  'pin': '조각 고정',
  'amplify': '피해 증폭',
  'gather': '끌어모으기',
  'wipe': '광역 전멸',
  'push': '밀어내기',
  'tow': '붙잡아 나르기',
  'bounce': '튕기는 몸체 부여',
  'squash': '찌그러뜨리기',
  'soak': '적시기',
  'reflect': '탄환 뒤집기',
  'chaos': '무작위 튕김'
};

function num(v, dflt) { return typeof v === 'number' && isFinite(v) ? v : dflt; }

/** The interval between two shots of the base attack, in ms. */
function intervalMs(W) {
  if (W.hold) return Math.max(1, num(W.tickMs, 50));
  /* 카타나의 클릭은 `stabCooldownMs` 로 막힌다(src/79 smashAt) — 그것이 이 무기의 진짜 연사 간격이다. */
  return Math.max(num(W.cooldownMs, 0), num(W.stabCooldownMs, 0), CLICK_FLOOR_MS);
}
/** One "hit" of the base attack: a shotgun shell is nine pellets and lands as one.
 * 붕괴의 damage 는 Infinity 다 — num() 이 0 으로 깎아 버리면 "부술 수 없다" 로 뒤집히므로 그대로 넘긴다. */
function hitDamage(W) {
  if (W.damage === Infinity) return Infinity;
  return num(W.damage, 0) * Math.max(1, num(W.pellets, 1));
}
/* §C3: `WEAPONS[id].vs[grade]`, 기본 1.0. The product rounds the product of the two (src/72-roles.js
 * `rlVsMul` → applyHit), so this model does too — a 65 damage hammer on a 큰 것 is 33, not 32.5. */
function vsOf(W, grade) {
  const t = W && W.vs;
  const v = t && grade ? t[grade] : null;
  return typeof v === 'number' && isFinite(v) && v > 0 ? v : 1;
}
function gradedHit(W, grade) {
  const d = hitDamage(W);
  if (!isFinite(d)) return d;
  const m = vsOf(W, grade);
  return m === 1 ? d : Math.max(1, Math.round(d * m));
}
/* §F3 의 통화에 들어가는 화력. §C3 이 등급마다 다른 계수를 주었으므로 **네 등급의 평균**을 쓴다.
 *
 * INTERPRETATION (보고에 적었다). 버튼 한 등급만 쓰는 것도 가능한 읽기였다 — §B1 이 pHit 의 기준 표적을
 * 버튼으로 고정했으니까. 그러면 §C3 이 준 역할이 그대로 밴드 위반이 된다: 샷건(작은 것 1.4)과 권총(1.3)이
 * 단숨에 140% · 142% 가 되고 로켓(0.7)과 미니건(0.8)이 73% · 71% 로 떨어진다. §C5 가 "밴드를 느슨하게
 * 하지 않는다 — **성능은 같아도 된다. 역할이 달라야 한다**" 고 적었는데, 통화를 한 등급에 묶으면 역할이
 * 곧 성능이 되어 그 문장이 성립하지 않는다. pHit 의 기준 표적이 버튼인 것은 **조준**(어디에 맞나)의
 * 문제이고 등급 계수는 **표적**(무엇을 치나)의 문제라 축이 다르다. 평균이면 통화는 "이 무기가 페이지
 * 전체를 상대로 내는 화력" 이 되고, 등급 간의 차이는 §F2 처치 시간표와 §F6-7 · §F6-8 이 본다. */
function meanGradedHit(W) {
  const d = hitDamage(W);
  if (!isFinite(d)) return d;
  let sum = 0;
  for (const g of GRADES) sum += vsOf(W, g.key);
  const m = sum / GRADES.length;
  return m === 1 ? d : d * m;
}

/** §B1 유효산포 σ — the spread the weapon has IN ITS OWN FIRING POSTURE.
 * 지속 사격 무기는 블룸 상한에서 쏜다. 저격총은 **조준경 안에서** 쏜다 — src/71 의 spreadNow() 가
 * `W.scope && state.scoped` 일 때 0 을 돌려주고, v1.2 A4 가 "조준 중에는 정확하다" 를 무기의 정체성으로
 * 못박았다. 두 경우 모두 "그 무기가 실제로 쓰이는 상태" 라는 같은 규칙이다.
 * INTERPRETATION (보고에 적었다): 이 규칙이 없으면 저격총이 **조준하지 않고 쏘는** 가정으로 평가되어,
 * 산포를 지우는 기능을 가진 유일한 무기가 그 기능 때문에 벌을 받는다 — §A4 가 고친 것과 같은 종류의
 * 모델 오류다. */
function effSpread(W) {
  if (W.scope) return 0;
  return num(W.spread, 0) + num(W.bloom, 0) * BLOOM_CAP_MUL;
}
/** §B1 pHit(W, 버튼). 샷건 보정은 pHitEff() — 여기는 **펠릿 하나**의 확률이다. */
function pHit(W, box) { return pHitOf(effSpread(W), box || HIT_BOX); }
/* §B2 ※: 샷건은 펠릿 아홉이 **각자** 판정하므로 "한 발이라도 맞을 확률" 이 그 무기의 명중률이다.
 * §F6-6 이 보는 값이 이것이다. burstDPS 는 이 값을 쓰지 않는다 — 기대 피해는 펠릿 수에 **선형**이고
 * (hit 가 이미 damage × pellets 이다) 1 − (1 − p)^9 는 기대값이 아니라 "적어도 하나" 의 확률이다. */
function pHitEff(W, box) {
  const p = pHit(W, box);
  const n = Math.max(1, num(W.pellets, 1));
  return n > 1 ? 1 - Math.pow(1 - p, n) : p;
}

/** §F3 burstDPS, single target. AoE's simultaneous targets are a ROLE (§F5), not a currency.
 * §B1: 이제 **맞는 탄만 센다** — × pHit(W, 버튼). 못 맞는 것이 밴드를 맞추는 공짜 손잡이였다(§A4). */
function burstDPS(W, burn) {
  const d = meanGradedHit(W);
  if (!isFinite(d)) return Infinity;
  const key = BURN_WEAPONS[W.id];
  let dot = 0;
  if (key && burn[key] > 0) {
    /* src/77-burn.js §F1: 지속 피해 초당 BURN_DOT_BASE + stacks × BURN_DOT_PER_STACK. A weapon that adds
     * `stacks` every tick saturates at BURN_MAX long before the natural decay matters, so the dot it is
     * credited with is the saturated one. */
    dot = num(burn.BURN_DOT_BASE, 0) + num(burn.BURN_MAX, 0) * num(burn.BURN_DOT_PER_STACK, 0);
  }
  /* 연소는 명중한 탄이 붙이는 것이지만 포화 스택은 "틱마다 쌓는다" 가 전제다 — 명중률을 두 번 곱하지
   * 않도록 §B1 의 공식을 글자 그대로 따른다: 직접 피해에만 곱하고 dotDPS 는 가산한다. */
  return (d * 1000) / intervalMs(W) * pHit(W, HIT_BOX) + dot;
}

/** §F3 uptime — 재장전 · 과열 · 예열 · 쿨다운 are all already inside this one number. */
function uptime(W) {
  if (W.heat) return heatUptime(W);
  if (W.mag == null || !(W.reloadMs > 0)) return 1;
  const fire = W.mag * intervalMs(W);
  const spin = num(W.spinUpMs, 0);
  /* §E 샷건: "한 발씩 장전" — `reloadMs` is the time for ONE shell, so an empty magazine costs mag × that. */
  const reload = W.shellReload ? W.mag * W.reloadMs : W.reloadMs;
  return fire / (fire + reload + spin);
}
/* The laser has no magazine: 열 0–100 is the resource. Two rhythms are available and the weapon is worth
 * the better of them — §B2 sells 끊어 쏘기, but running to the forced cool-down is sometimes faster.
 *   a) 과열까지 쏘고 강제 냉각 2.5초: fire = heatMax/heatPerTick ticks, then overheatMs.
 *   b) 과열 직전에서 멈추고 자연 냉각: 같은 fire 뒤에 coolDelayMs + heatMax/coolPerSec.
 */
function heatUptime(W) {
  const perSec = (num(W.heatPerTick, 0) * 1000) / Math.max(1, num(W.tickMs, 50));
  if (!(perSec > 0)) return 1;
  const fire = num(W.heatMax, 100) / perSec;                            // s of continuous fire
  const forced = fire / (fire + num(W.overheatMs, 0) / 1000);
  const natural = fire / (fire + num(W.coolDelayMs, 0) / 1000 + num(W.heatMax, 100) / Math.max(1, num(W.coolPerSec, 1)));
  return Math.max(forced, natural);
}

/** §B1 handling = moveSpeed × (1 − swapMs/2000). 산포 항은 **삭제됐다**.
 * 산포는 이제 화력(burstDPS × pHit)에 들어간다. 한 축을 두 번 세면 포화 상한이 필요해지고, 그 상한이
 * (1 − min(0.35, 유효산포/120)) 의 42px 바닥이다 — 미니건이 그 바닥에 앉아 "더 부정확해져도 점수가
 * 안 내려가는" §A4 의 구멍을 썼다. */
function handling(W, swapDefault, moveExp) {
  const move = num(W.moveSpeed, 1);
  const swap = num(W.swapMs, swapDefault);
  const m = moveExp === 0 ? 1 : Math.pow(move, moveExp == null ? 1 : moveExp);
  return m * (1 - swap / SWAP_REF);
}

/** 처치 시간: the reference target's whole health, magazines and 예열 included, with §C3's grade
 * coefficient applied to every hit.
 *
 * INTERPRETATION (보고에 적었다). 9단계는 `(shots − 1) × interval` 로 셌다 — 한 방에 지우는 조합이
 * **0초**, 표에서는 "즉시" 가 되고, §A2 가 센 "표의 절반이 즉시" 가 거기서 나왔다. 그건 모델의 눈금이
 * 틀린 것이지 무기가 빠른 것이 아니다: 쿨다운 400ms 짜리 망치를 한 번 휘두르면 그 400ms 는 **당신의
 * 시간**이고 그 동안 다른 아무것도 못 한다. §F3 이 `interval` 을 "공격 한 번이 드는 시간" 으로 정의해
 * 두었으므로 n 번 치는 데 드는 시간은 n × interval 이다. 등급 계수만으로는 "즉시" 가 사라지지 않는다 —
 * §C3 이 망치의 낱말 계수를 1.0 으로 못박았고 피해 65 는 §A2 가 못박았으므로 한 방은 한 방이다.
 * SPEC-weapon-identity §E 가 요구한 "표에서 즉시가 사라진다" 는 눈금을 고쳐야만 참이 된다. */
function ttk(W, hp, grade, swapDefault) {
  const d = gradedHit(W, grade);
  if (!(d > 0)) return Infinity;                   // 중력탄 — 직접 피해 0
  const shots = isFinite(d) ? Math.ceil(hp / d) : 1;   // 붕괴: 한 번이면 끝난다. 그래도 한 번은 든다
  const iv = intervalMs(W);
  let t = shots * iv + num(W.spinUpMs, 0) + num(W.swapMs, swapDefault == null ? SWAP_DEFAULT_MS : swapDefault);
  if (W.heat) {
    const perSec = (num(W.heatPerTick, 0) * 1000) / Math.max(1, num(W.tickMs, 50));
    const fireMs = (num(W.heatMax, 100) / Math.max(1e-9, perSec)) * 1000;
    const stalls = Math.max(0, Math.ceil(((shots - 1) * iv) / fireMs) - 1);
    t += stalls * num(W.overheatMs, 0);
  } else if (W.mag != null && W.reloadMs > 0) {
    t += Math.floor((shots - 1) / W.mag) * (W.shellReload ? W.mag * W.reloadMs : W.reloadMs);
  }
  return t / 1000;
}

/* ===================================================================== */
/* 2. The model                                                           */
/* ===================================================================== */

/* §F8 모드별 보정: the moveSpeed exponent in `handling`. */
const MODES = {
  rampage: { label: 'rampage', moveExp: 0 },
  survival: { label: 'survival', moveExp: 1.5 },
  arcade: { label: 'arcade', moveExp: 1 }
};

function model() {
  const { ids, weapons, presets, swapDefault, loadoutMax, burn, roles } = readArsenal();
  const rows = ids.map((id) => {
    const W = Object.assign({ id }, weapons[id]);
    const b = burstDPS(W, burn);
    const u = uptime(W);
    const h = handling(W, swapDefault);
    const row = {
      id,
      cat: W.cat || 'field',
      role: W.role || null,
      quirk: W.quirk || null,
      utility: num(W.utility, 0),
      damage: W.damage,
      pellets: num(W.pellets, 1),
      hit: hitDamage(W),
      intervalMs: intervalMs(W),
      mag: W.mag == null ? null : W.mag,
      reloadMs: W.reloadMs == null ? null : W.reloadMs,
      swapMs: num(W.swapMs, swapDefault),
      moveSpeed: num(W.moveSpeed, 1),
      spread: effSpread(W),
      /* §B1: 발행된 산포 상한과 그 상한에서의 버튼 명중률. `pHitEff` 는 샷건 펠릿 보정이 들어간 값이고
       * §F6-6 이 보는 것이 그쪽이다. */
      pHit: pHit(W, HIT_BOX),
      pHitEff: pHitEff(W, HIT_BOX),
      maxTargets: num(W.maxTargets, 1),
      burstDPS: b,
      rawDPS: b + num(W.utility, 0),
      uptime: u,
      handling: h,
      effective: b * u * h,
      /* §F4 특수: "제공 효용 환산 후". `utility` is published BY THE WEAPON (src/00-prelude.js, WEAPON_ROLES)
       * with its derivation in the comment next to it, so the conversion is data rather than a number hidden
       * here. It is ADDED to burstDPS rather than multiplied into `effective`: 중력탄's 직접 피해 is 0 and
       * zero times any factor is still zero, which would make the 특수 band unreachable by construction. */
      rated: (b + num(W.utility, 0)) * u * h,
      ttk: {},
      modes: {},
      firstShotMs: num(W.swapMs, swapDefault) + num(W.spinUpMs, 0) + (W.hold ? num(W.tickMs, 0) : 0)
    };
    for (const t of TARGETS) row.ttk[t.key] = ttk(W, t.hp, t.grade, swapDefault);
    /* §F6-4 는 등급 계수를 **빼고** 본다 — 아래 violations() 의 주석 참조. */
    row.ttkRawSection = ttk(W, SECTION_HP, null, swapDefault);
    row.vs = W.vs || null;
    for (const k of Object.keys(MODES)) {
      const hh = handling(W, swapDefault, MODES[k].moveExp);
      row.modes[k] = { handling: hh, effective: (b + num(W.utility, 0)) * u * hh };
    }
    return row;
  });

  const byId = {};
  for (const r of rows) byId[r.id] = r;

  /* The 실전 median every band is measured against. 붕괴 is out of it: its damage is Infinity and §F4
   * takes it out of the band check anyway. */
  const fieldVals = rows.filter((r) => r.cat === 'field' && !BAND_EXEMPT.has(r.id) && isFinite(r.rated)).map((r) => r.rated).sort((a, b) => a - b);
  const median = fieldVals.length ? (fieldVals.length % 2 ? fieldVals[(fieldVals.length - 1) / 2]
    : (fieldVals[fieldVals.length / 2 - 1] + fieldVals[fieldVals.length / 2]) / 2) : 0;
  for (const r of rows) r.ratio = median > 0 ? r.rated / median : 0;

  return { ids, rows, byId, weapons, roles, presets, median, loadoutMax, burn, swapDefault, violations: violations(rows, byId, median) };
}

/* ---- SPEC-product §1 무기 비교표 — options/arsenal.json ----------------------------------------
 * 옵션 페이지가 읽는 **생성물**이다. 손으로 고치지 않는다 — `node tools/balance.js --check` 가
 * content.js 와 같은 이유로 낡은 생성물을 잡는다.
 *
 * 무엇을 넣는가: 무기 비교표가 보여 줄 수 있는 전부 — 표에 적힌 수치(`damage` … `pierce`)와,
 * 같은 파일이 이미 계산하고 있는 파생값(`burstDPS` · `uptime` · `handling` · `effective` · 표적별
 * 처치 시간). 이름은 **메시지 키**로 넣는다: 옵션 페이지가 chrome.i18n 으로 번역한다.          */
function renderArsenal(m) {
  const round = (v, n) => (isFinite(v) ? Math.round(v * Math.pow(10, n)) / Math.pow(10, n) : null);
  const out = {
    generatedBy: 'tools/balance.js --write',
    loadoutMax: m.loadoutMax,
    median: round(m.median, 3),
    targets: TARGETS.map((t) => ({ key: t.key, hp: t.hp, label: t.label })),
    presets: m.presets,
    roleLabels: ROLE_LABEL,
    weapons: m.rows.map((r) => {
      const W = m.weapons[r.id] || {};
      return {
        id: r.id,
        emoji: W.emoji || '',
        nameKey: W.name || null,
        kind: W.kind || null,
        cat: r.cat,
        role: r.role,
        quirk: r.quirk,
        damage: W.damage === '__INFINITY__' || W.damage === Infinity ? null : W.damage,
        pellets: r.pellets,
        cooldownMs: W.cooldownMs == null ? null : W.cooldownMs,
        tickMs: W.tickMs == null ? null : W.tickMs,
        hold: !!W.hold,
        input: W.input || 'click',
        mag: r.mag,
        reloadMs: r.reloadMs,
        radius: W.radius === Infinity || W.radius === '__INFINITY__' ? null : (W.radius || 0),
        swapMs: r.swapMs,
        moveSpeed: round(r.moveSpeed, 3),
        spread: round(r.spread, 2),
        /* SPEC-weapon-identity §B1: 발행 산포 상한에서의 버튼(120×44) 명중률. `pHit` 은 조준점 한 발,
         * `pHitEff` 는 샷건 펠릿 보정이 들어간 값이다. */
        pHit: round(r.pHit, 4),
        pHitEff: round(r.pHitEff, 4),
        pierce: W.pierce === 999 ? 999 : (W.pierce || 0),
        critChance: round(W.critChance == null ? 0.1 : W.critChance, 3),
        knockback: round(W.knockback == null ? 1 : W.knockback, 2),
        falloff: round(W.falloff || 0, 2),
        maxTargets: r.maxTargets,
        burstDPS: round(r.burstDPS, 2),
        uptime: round(r.uptime, 4),
        handling: round(r.handling, 4),
        effective: round(r.effective, 2),
        utility: r.utility,
        rated: round(r.rated, 2),
        ratio: round(r.ratio, 4),
        ttk: TARGETS.reduce((acc, t) => { acc[t.key] = round(r.ttk[t.key], 3); return acc; }, {})
      };
    })
  };
  return JSON.stringify(out, null, 2) + '\n';
}

/* ===================================================================== */
/* 3. §F6 — the five violations plus §F5's role table                     */
/* ===================================================================== */

/* §F6-2: "같은 범주 안에서 다른 무기에 완전히 지배된다(모든 축에서 같거나 나쁨)". The axes are §F3's own
 * three common currencies — nothing else is a currency the spec defined. */
/* `rawDPS` is burstDPS with §F4's 효용 환산 already added: comparing a 중력탄 (직접 피해 0) against a
 * 충격포 on raw damage alone would say every 특수 weapon dominates it, which is the opposite of true. */
const AXES = ['rawDPS', 'uptime', 'handling'];

function dominates(a, b) {
  let strict = false;
  for (const k of AXES) {
    if (!(a[k] >= b[k] - 1e-9)) return false;
    if (a[k] > b[k] + 1e-9) strict = true;
  }
  return strict;
}

function violations(rows, byId, median) {
  const out = [];
  /* 1. 실효 화력이 범주 밴드를 벗어난다 */
  for (const r of rows) {
    if (BAND_EXEMPT.has(r.id)) continue;
    const band = BANDS[r.cat];
    if (!band) { out.push({ rule: 1, id: r.id, msg: `범주 \`${r.cat}\` 는 §F4 에 없다` }); continue; }
    if (!(median > 0)) continue;
    if (r.ratio < band.lo - 1e-9 || r.ratio > band.hi + 1e-9) {
      out.push({ rule: 1, id: r.id, msg: `${band.label} 밴드 ${pct(band.lo)}~${pct(band.hi)} 를 벗어났다 — ${pct(r.ratio)}` });
    }
  }
  /* 2. 같은 범주 안에서 완전히 지배된다 */
  for (const r of rows) {
    if (BAND_EXEMPT.has(r.id) || !isFinite(r.effective)) continue;
    for (const o of rows) {
      if (o === r || o.cat !== r.cat || BAND_EXEMPT.has(o.id) || !isFinite(o.effective)) continue;
      if (dominates(o, r)) { out.push({ rule: 2, id: r.id, msg: `같은 범주의 ${o.id} 에 모든 축(${AXES.join(' · ')})에서 지배된다` }); break; }
    }
  }
  /* 3. 큰 카드(184)를 1회 타격으로 파괴한다 (붕괴 · 충전 로켓 · 슬러그 제외)
   *
   * INTERPRETATION (보고에 적었다). 명세가 뺀 셋은 전부 **비싼 한 방**이다: 붕괴는 쿨다운 2초에 탄창 1,
   * 충전 로켓과 슬러그는 탄약 2발을 쓰는 보조 공격이다. 그래서 "1회 타격" 을 **값이 싼 한 방** 으로 읽는다
   * — 탄창이 없어 무한히 반복되거나(근접), 한 탄창으로 184 이상을 여섯 번 이상 꽂을 수 있는 경우.
   * 이 해석이 없으면 §A2 가 못박고 테스트가 고정한 저격총 200 · 폭탄 190 · 로켓 260 이 전부 위반이 되어
   * 규칙 자체가 성립하지 않는다. 보조 공격은 애초에 여기서 보지 않는다(기본 공격만 본다). */
  for (const r of rows) {
    if (ONESHOT_EXEMPT.has(r.id) || !isFinite(r.hit)) continue;
    if (r.hit < BIG_CARD_HP) continue;
    const cheap = r.mag == null || r.mag >= 6;
    if (cheap) out.push({ rule: 3, id: r.id, msg: `단발 ${r.hit} 로 큰 카드(${BIG_CARD_HP})를 한 방에 부수는데 그 한 방이 싸다 (탄창 ${r.mag == null ? '없음' : r.mag})` });
  }
  /* 4. 큰 섹션(253)의 지속 사격 처치 시간이 4.5초를 넘는다
   *
   * INTERPRETATION (보고에 적었다): 실전 범주에만 적용한다. §D 는 예능 무기에게 "실효 화력이 중앙값의
   * 25~50%" 를 요구하므로 예능이 4.5초 안에 큰 섹션을 지우면 그쪽 규칙과 정면으로 충돌하고, 특수 무기는
   * 애초에 피해로 일하지 않는다(중력탄은 직접 피해가 0 이다). "지속 사격" 은 실전 무기의 개념이다. */
  /* SPEC-weapon-identity §C3 (11단계): 이 규칙은 등급 계수를 **빼고** 본다 (`ttkRawSection`).
   * INTERPRETATION (보고에 적었다). §C3 은 다섯 무기(망치 0.5 · 권총 0.6 · 카타나 0.5 · 화염 0.6 ·
   * 샷건 0.4)에게 큰 것을 **일부러** 못하게 만들라고 적었고, §F6-4 는 실전 무기가 큰 것을 지울 수
   * 있어야 한다고 적었다. 계수를 넣어 재면 그 다섯이 전부 §F6-4 위반이 되어 §C 와 §F6-4 가 서로를
   * 지운다. 두 문장이 묻는 것이 다르다고 읽었다 — §F6-4 는 "**할 수 있는가**"(지속 사격으로 큰 것을
   * 끝낼 화력이 있는가)이고 §C3 은 "**얼마나 잘하는가**"다. 못하게 만드는 쪽은 §F6-7 이 반대편에서
   * 강제한다. 등급 계수가 들어간 값은 아래 §F2 표가 그대로 보여 준다. */
  for (const r of rows) {
    if (r.cat !== 'field' || BAND_EXEMPT.has(r.id)) continue;
    if (r.ttkRawSection > 4.5 + 1e-9) out.push({ rule: 4, id: r.id, msg: `큰 섹션(${SECTION_HP}) 처치 시간(등급 계수 제외) ${r.ttkRawSection.toFixed(2)}초 > 4.5초` });
  }
  /* 5. moveSpeed 가 0.5 미만 또는 1.25 초과 */
  for (const r of rows) {
    if (r.moveSpeed < 0.5 - 1e-9 || r.moveSpeed > 1.25 + 1e-9) out.push({ rule: 5, id: r.id, msg: `moveSpeed ${r.moveSpeed} 가 [0.5, 1.25] 밖이다` });
  }
  /* 6. SPEC-weapon-identity §B1: 실전 무기의 pHit(버튼 120×44) 이 0.55 미만이다.
   * "지속 사격 무기가 작은 표적을 절반도 못 맞히면 그것은 역할이 아니라 결함이다." 샷건은 펠릿이 각자
   * 판정하므로 펠릿 보정값(`pHitEff`)으로 본다 — §B2 의 ※ 가 그렇게 적어 두었다. */
  for (const r of rows) {
    if (r.cat !== 'field') continue;
    if (r.pHitEff < PHIT_MIN - 1e-9) {
      out.push({ rule: 6, id: r.id, msg: `실전 무기인데 ${HIT_BOX.label} 명중률이 ${pct(r.pHitEff)} — 문턱 ${pct(PHIT_MIN)} 미만이다 (유효산포 ${r.spread.toFixed(0)}px)` });
    }
  }
  /* 7. SPEC-weapon-identity §C3: 실전 무기는 `vs` 에 **1.0 미만인 등급이 최소 하나** 있어야 한다.
   * "못하는 것이 없으면 잘하는 것도 느껴지지 않는다"(§C1). 등급표가 아예 없는 실전 무기도 같은 실패다 —
   * 계수를 안 적는 것은 전부 1.0 을 적은 것과 같다. 붕괴만 뺀다: 피해가 Infinity 라 곱할 것이 없고
   * §F4 가 이미 밴드 검사에서 뺐다. */
  for (const r of rows) {
    if (r.cat !== 'field' || BAND_EXEMPT.has(r.id)) continue;
    const t = r.vs;
    if (!t) { out.push({ rule: 7, id: r.id, msg: '실전 무기인데 §C3 등급 계수(`vs`)가 없다' }); continue; }
    const vals = GRADES.map((g) => (typeof t[g.key] === 'number' ? t[g.key] : 1));
    if (!vals.some((v) => v < 1 - 1e-9)) {
      out.push({ rule: 7, id: r.id, msg: `등급 계수에 1.0 미만이 하나도 없다 — ${GRADES.map((g, i) => g.label + ' ' + vals[i]).join(' · ')}` });
    }
  }
  /* 8. SPEC-weapon-identity §C3: **어떤 두 무기도 `vs` 네 값이 모두 같아서는 안 된다.**
   * 등급표를 발행한 무기들끼리 본다 — 발행하지 않은 무기(특수 · 예능 · 붕괴)는 §C3 자신이 "기본 1.0"
   * 이라고 적은 쪽이고, 그것들을 서로 비교하면 규칙이 "특수 무기 둘이 존재하면 실패" 가 되어 §C3 의
   * 표가 다루지 않는 범주를 벌하게 된다. (보고에 적었다.) */
  const vsSeen = new Map();
  for (const r of rows) {
    if (!r.vs) continue;
    const key = GRADES.map((g) => (typeof r.vs[g.key] === 'number' ? r.vs[g.key] : 1)).join('/');
    if (vsSeen.has(key)) out.push({ rule: 8, id: r.id, msg: `등급 계수 네 값이 ${vsSeen.get(key)} 와 완전히 같다 (${key})` });
    else vsSeen.set(key, r.id);
  }
  /* §F5: "하나도 겹치면 안 된다." A role that is missing, unknown or shared is the same failure. */
  const seen = new Map();
  for (const r of rows) {
    if (!r.role) { out.push({ rule: 'F5', id: r.id, msg: '§F5 역할이 비어 있다' }); continue; }
    if (!ROLE_LABEL[r.role]) { out.push({ rule: 'F5', id: r.id, msg: `§F5 역할 \`${r.role}\` 에 이름표가 없다` }); continue; }
    if (seen.has(r.role)) out.push({ rule: 'F5', id: r.id, msg: `§F5 역할 \`${r.role}\` 이 ${seen.get(r.role)} 와 겹친다` });
    else seen.set(r.role, r.id);
  }
  return out;
}

/* ===================================================================== */
/* 4. §F7 — what moved, and why                                           */
/* ===================================================================== */

/*
 * 9단계의 조정 기록. 순서가 §F7 그대로다: 핸들링(교체 · 이동 · 산포 · 재장전)을 먼저 움직이고,
 * 피해량은 그것으로 닿지 않는 곳에서만 건드렸다. 여기 없는 수치는 손대지 않았다는 뜻이다.
 */
const ADJUSTMENTS = [
  { id: 'hammer', field: 'cooldownMs', from: 0, to: 400, why: '실효 화력이 실전 중앙값의 **412%** 였다 — 무기고에서 가장 심하게 벗어난 값. 쿨다운 0 에 피해 65 면 120ms 마다 65 이고 그건 지속 화력 1등(미니건)의 1.3배다. 피해 65 는 §A2 가 못박았으니 **휘두르는 간격**이 값을 치른다. 핸들링(교체 · 이동)만으로는 ×0.25 가 필요해 닿지 않았다.' },
  { id: 'hammer', field: 'swapMs', from: 220, to: 440, why: '쿨다운만으로는 여전히 밴드 위였다. 가장 센 한 방을 **가장 느리게 꺼낸다** — 큰 둔기의 값.' },
  { id: 'hammer', field: 'moveSpeed', from: 1.00, to: 0.88, why: '같은 이유. 이동이 생존인 survival 에서 가장 아프게 느껴진다(§F8).' },
  { id: 'katana', field: 'stabCooldownMs', from: 120, to: 520, why: '실효 화력이 중앙값의 **443%**. 카타나의 1등은 §F5 가 준 치명타율과 기동성이지 지속 화력이 아니다 — 그래서 기동성 1.15 는 그대로 두고 **찌르기 간격만** 늘렸다. 카타나는 베는 무기지 찌르는 무기가 아니다.' },
  { id: 'katana', field: 'swapMs', from: 200, to: 260, why: '위와 같은 방향으로 조금. 1.15 라는 최고 이동 속도를 유지하려면 어디선가는 값을 치러야 한다.' },
  { id: 'axe', field: 'moveSpeed', from: 0.85, to: 0.60, why: '중앙값의 **138%**. 쿨다운 550 과 피해 130 은 §A2 가 못박았고 §F5 가 도끼에 준 1등은 근접 최대 피해라 둘 다 못 건드린다. 남은 값은 기동성이다 — 가장 큰 날을 들고 다니는 대가.' },
  { id: 'axe', field: 'swapMs', from: 400, to: 430, why: '같은 방향. 미니건(560)을 넘지 않는 선에서 멈췄다 — 교체 최장은 §B3 이 미니건에 준 자리다.' },
  { id: 'sniper', field: 'swapMs', from: 420, to: 320, why: '중앙값의 **80%** 로 밴드 아래였다. 피해 200 · 쿨다운 600 · 산포 25 가 전부 고정이라 교체 · 이동 · 재장전만 남았다.' },
  { id: 'sniper', field: 'moveSpeed', from: 0.75, to: 0.82, why: '조준경을 들여다보지 않을 때까지 느릴 이유가 없다. 조준 중 이동(`moveSpeedScoped` 0.45)은 그대로라 "보는 동안 느리다" 는 성격은 남는다.' },
  { id: 'sniper', field: 'reloadMs', from: 2000, to: 1900, why: '탄창 5 에 2초면 가동률 0.60. 1.9초로 0.61 이 된다. 작게 움직인 이유는 재장전이 §A2 표의 값이기 때문이다.' },
  { id: 'rocket', field: 'swapMs', from: 480, to: 380, why: '중앙값의 **69%** 로 가장 심하게 밴드 아래였다. 단발 범위 최대(§F5)를 지키려면 피해 260 과 쿨다운 1200 을 못 건드린다 — 전부 핸들링과 가동률에서 벌었다.' },
  { id: 'rocket', field: 'moveSpeed', from: 0.80, to: 0.92, why: '위와 같은 이유. 로켓은 어깨에 걸치는 무기지 땅에 박는 무기가 아니다.' },
  { id: 'rocket', field: 'mag', from: 2, to: 3, why: '쿨다운 1200ms 에 탄창 2 는 두 발 쏘고 1.5초를 쉰다는 뜻이다. 3 으로 가동률 0.62 → 0.72.' },
  { id: 'rocket', field: 'reloadMs', from: 1500, to: 1400, why: '같은 이유. 그리고 탄창 3 은 §F6-3 의 "값싼 한 방" 문턱(6)에서 더 멀어진다.' },
  { id: 'laser', field: 'swapMs', from: 320, to: 250, why: '중앙값의 **71%**. 열 · 피해 11 · 관통은 §B2 가 통째로 고정한 표라 교체와 이동만 남았다.' },
  { id: 'laser', field: 'moveSpeed', from: 0.88, to: 1.00, why: '레이저는 반동이 없고 **끌고 다니는** 무기다. 끌고 다닐 수 있어야 §F5 가 준 1등(절단선 자유도)이 성립한다.' },
  { id: 'minigun', field: 'mag', from: 200, to: 300, why: '중앙값의 **68%** 로 밴드 아래였다. 이동 0.55 와 교체 560ms 는 §B3 이 "화력을 사는 대가" 로 못박았고, 산포 14/발 은 유효산포 70px 이라 §F3 의 0.35 바닥을 이미 치고 있어 낮춰도 핸들링이 안 움직인다. 결국 움직일 수 있는 축은 **탄띠**뿐이었다.' },
  { id: 'minigun', field: 'reloadMs', from: 4000, to: 2600, why: '같은 이유. 탄창 300 · 재장전 2.6초로 가동률 0.71 → 0.84. 그래도 무기고에서 가장 긴 재장전이다.' },
  { id: 'pistol', field: 'swapMs', from: 150, to: 130, why: '§F5 가 권총에 준 1등은 **즉응성**이다. 총 중에서 가장 빨리 꺼내지 못하면 그 1등이 거짓말이 된다.' },
  { id: 'pistol', field: 'moveSpeed', from: 1.10, to: 1.00, why: '교체를 줄인 만큼 되돌려 밴드 안에 둔다. 즉응성은 "꺼내는 속도" 지 "달리는 속도" 가 아니다.' },
  { id: 'smg', field: 'swapMs', from: 260, to: 280, why: '중거리 균형(§F5)은 밴드 한가운데 있으라는 뜻이다. 나머지가 내려온 만큼 같이 내렸다.' },
  { id: 'smg', field: 'moveSpeed', from: 0.95, to: 0.92, why: '위와 같은 이유.' },
  { id: 'flame', field: 'moveSpeed', from: 0.90, to: 0.82, why: '누적 화력 최대(§F5)에 연소 dotDPS 까지 더해져 밴드 위였다.' },
  { id: 'flame', field: 'reloadMs', from: 2500, to: 3400, why: '같은 이유이면서, §F6-2 를 푸는 수치이기도 하다. 재장전 2.5초일 때 화염방사기가 **기관총을 세 축 전부에서 지배**했다(burstDPS · uptime · handling 모두 같거나 나음). 연료 100 을 다 쓰는 데 5초, 다시 채우는 데 3.4초 — 가동률이 기관총 아래로 내려가면서 지배가 풀린다.' },
  { id: 'rubber', field: 'swapMs', from: 240, to: 210, why: '§F6-2. 냉각총이 들어오면서 고무탄을 세 축 전부에서 지배했다. 고무탄에게 남은 1등은 **손이 빠른 것** 이라 교체와 이동으로 풀었다.' },
  { id: 'rubber', field: 'moveSpeed', from: 1.00, to: 1.05, why: '위와 같은 이유.' },
  { id: 'squeaky', field: 'cooldownMs', from: 0, to: 170, why: '예능 밴드는 25~50% 인데 **64%** 였다. 피해 8 은 §D 가 못박았고 §D 가 뿅망치에 준 성격은 "가장 빠르게 휘두른다" 라 이동 1.20 · 교체 120ms 도 못 건드린다 — 남은 축이 간격이다. 170ms 는 무기고에서 가장 짧은 공격 간격이라 §D 의 그 문장은 여전히 참이다.' },
  { id: 'chicken', field: 'cooldownMs', from: 0, to: 300, why: '예능 밴드 안에 있어야 하는데 **100%** 로 실전 한복판에 있었다. 피해 12 는 §D 가 못박았고 교체 110ms · 이동 1.25 는 "가장 빠르고 가볍다" 라 못 건드린다. 고무 치킨은 휘두를 때마다 출렁인다 — 간격이 그 값이다.' },
  /* ── SPEC-weapon-identity §B2 (11단계): 명중률 교정 ─────────────────────────────────────────────
   * §B3 이 "피해값은 하나도 바꾸지 않는다. 벗어나면 틱 간격과 탄창으로만 되돌린다" 고 했고 그대로 했다 —
   * 아래에서 움직인 것은 `bloom` 넷 · `mag` 하나 · `tickMs` 하나뿐이고 `damage` 는 한 줄도 없다. */
  { id: 'minigun', field: 'bloom', from: 14, to: 2.2, why: '§B2. 유효산포 140px 에서 **버튼을 4% 로 맞혔다**. §B2 표는 2.5(σ 25px)를 적었지만 그 값은 발행 명중률 61%, **실측 56%** 다 — fire() 안의 기계적 ±7px 원뿔과 반동 킥은 무기 표에 없어서 §B2 의 계산에 빠져 있었다. §D 가 요구한 "0.6초 지속 사격 뒤에도 60% 이상" 을 실제로 넘는 가장 큰 값이 **2.2** 다 (발행 68% · 실측 67%). §B2 가 적은 65% 와 3%p 안이다.' },
  { id: 'smg', field: 'bloom', from: 6, to: 2, why: '§B2 표 그대로. 유효산포 60px → 20px, 버튼 명중률 20% → 73%.' },
  { id: 'flame', field: 'bloom', from: 3, to: 2, why: '§B2 표 그대로. 30px → 20px, 51% → 73%.' },
  { id: 'nailgun', field: 'bloom', from: 2, to: 1.5, why: '§B2 표 그대로. 20px → 15px, 73% → 86%.' },
  { id: 'watergun', field: 'bloom', from: 5, to: 1.5, why: '§B2 가 `laser 5 → 1.5` 로 적은 줄의 **진짜 주인**이다. 레이저의 `bloom` 은 0 이고 유효산포 50px / 명중률 26% 를 들고 있던 것은 물총이다(§A3 의 σ 표가 그대로 가리킨다). 명세의 이름표가 어긋났을 뿐 수치는 정확해서, 수치를 따랐다. 50px → 15px.' },
  { id: 'rubber', field: 'bloom', from: 4, to: 3, why: '§B2 가 `shotgun 4 → 3` 으로 적은 줄의 진짜 주인. 샷건의 `bloom` 도 0 이고 유효산포 40px / 36% 는 고무탄의 것이었다. 40px → 30px. 레이저 · 샷건 · 냉각총은 이미 `bloom: 0` 이라 **올리지 않았다** — 올리면 §B 가 하려는 일의 정반대가 된다.' },
  { id: 'sniper', field: 'mag', from: 5, to: 4, why: '모델이 산포를 핸들링에서 빼면서 저격총의 `handling` 이 0.545 → 0.689 로 올랐고(산포 25px 이 더 이상 두 번 세이지 않는다) 중앙값의 **126%** 가 됐다. §B3 이 허락한 축은 틱 간격과 탄창이고, 틱(쿨다운 600)은 §A2 가 못박은 값이라 탄창만 남았다. 5 → 4 로 가동률 0.612 → 0.558, 115%. 탄창 6 이상은 §F6-3 의 "값싼 한 방" 문턱이라 애초에 올릴 수도 없었다.' },
  { id: 'watergun', field: 'tickMs', from: 40, to: 50, why: '물총의 명중률이 26% → 86% 로 오르면서 `rawDPS` 가 19.6 → 64.3 이 되어 **나팔을 세 축 전부에서 지배**했다(§F6-2). §B3 이 허락한 축 그대로 틱만 40 → 50 — `rawDPS` 51.4 로 나팔(54.6) 아래에 둔다. 피해 3 은 §D 가 못박은 값이라 그대로다.' },
  /* ── SPEC-weapon-identity §C3 (11단계): 등급 계수 ───────────────────────────────────────────────
   * §C5 가 "피해값을 바꾸지 않는다" 고 다시 못박았고 그대로 했다 — `damage` 는 한 줄도 움직이지
   * 않았다. 등급 계수가 통화에 들어오면서(네 등급의 평균) 실전 중앙값이 111.5 → 103.5 로 내려갔고,
   * 그 결과 밴드를 벗어난 둘만 §C5 가 허락한 축(틱 간격 · 탄창 · 쿨다운)으로 되돌렸다. */
  { id: 'sniper', field: 'mag', from: 4, to: 3, why: '§C3. 저격총의 등급 계수 평균은 1.0 이라(낱말 0.4 · 작은 것 1.0 · 중간 1.4 · 큰 것 1.2) 화력이 그대로인데 중앙값이 111.5 → 103.5 로 내려가 **124%** 가 됐다. 피해 200 과 쿨다운 600 은 §A2 가 못박았으므로 남은 축은 또 탄창이다. 4 → 3 으로 가동률 0.558 → 0.486, 108%. 볼트액션 세 발은 §F6-3 의 "값싼 한 방" 문턱(6)에서 가장 멀기도 하다.' },
  { id: 'squeaky', field: 'cooldownMs', from: 170, to: 185, why: '§C3. 뿅망치는 등급 계수가 없어(예능은 §C3 의 표에 없다) 화력이 그대로인데 중앙값이 내려가 예능 밴드 25~50% 를 **51%** 로 넘었다. 9단계와 같은 축, 같은 이유 — 피해 8 은 §D 가 못박았고 이동 1.20 · 교체 120ms 는 "가장 빠르게 휘두른다" 라 못 건드린다. 185ms 도 여전히 무기고에서 가장 짧은 공격 간격이다.' }
];

/* ===================================================================== */
/* 5. Rendering                                                           */
/* ===================================================================== */

function pct(v) { return (v * 100).toFixed(0) + '%'; }
function f1(v) { return isFinite(v) ? v.toFixed(1) : '∞'; }
function f2(v) { return isFinite(v) ? v.toFixed(2) : '∞'; }
function f3(v) { return isFinite(v) ? v.toFixed(3) : '∞'; }
function ttkStr(v) { return v === 0 ? '즉시' : (isFinite(v) ? v.toFixed(2) + 's' : '—'); }

function pad(s, n) { s = String(s); const w = width(s); return s + ' '.repeat(Math.max(0, n - w)); }
function padL(s, n) { s = String(s); const w = width(s); return ' '.repeat(Math.max(0, n - w)) + s; }
/* Hangul and the box glyphs below are double width in a terminal; ids are ASCII. */
function width(s) { let n = 0; for (const ch of String(s)) n += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(ch) ? 2 : 1; return n; }

function printTable(m) {
  const lines = [];
  lines.push('SPEC-arsenal §F — 밸런스 (무기 ' + m.rows.length + '종, 실전 중앙값 ' + f1(m.median) + ')');
  lines.push('');
  const head = ['무기', '범주', '역할', 'σ', 'pHit', 'burstDPS', 'uptime', 'handling', 'effective', '효용', '환산', '중앙값비'];
  const body = m.rows.map((r) => [
    r.id, BANDS[r.cat] ? BANDS[r.cat].label : r.cat, ROLE_LABEL[r.role] || String(r.role),
    f1(r.spread), pct(r.pHitEff),
    f1(r.burstDPS), f3(r.uptime), f3(r.handling), f1(r.effective),
    r.utility === 0 ? '—' : '+' + f1(r.utility), f1(r.rated), pct(r.ratio)
  ]);
  const w = head.map((h, i) => Math.max(width(h), ...body.map((b) => width(b[i]))));
  lines.push(head.map((h, i) => (i < 3 ? pad(h, w[i]) : padL(h, w[i]))).join('  '));
  lines.push(w.map((n) => '─'.repeat(n)).join('  '));
  for (const b of body) lines.push(b.map((c, i) => (i < 3 ? pad(c, w[i]) : padL(c, w[i]))).join('  '));
  lines.push('');
  lines.push('처치 시간 — ' + TARGETS.map((t) => t.label + ' ' + t.hp).join(' · '));
  const h2 = ['무기'].concat(TARGETS.map((t) => t.label));
  const b2 = m.rows.map((r) => [r.id].concat(TARGETS.map((t) => ttkStr(r.ttk[t.key]))));
  const w2 = h2.map((h, i) => Math.max(width(h), ...b2.map((b) => width(b[i]))));
  lines.push(h2.map((h, i) => (i === 0 ? pad(h, w2[i]) : padL(h, w2[i]))).join('  '));
  lines.push(w2.map((n) => '─'.repeat(n)).join('  '));
  for (const b of b2) lines.push(b.map((c, i) => (i === 0 ? pad(c, w2[i]) : padL(c, w2[i]))).join('  '));
  return lines.join('\n');
}

function mdTable(head, rows, align) {
  const out = ['| ' + head.join(' | ') + ' |'];
  out.push('|' + head.map((_, i) => (align && align[i] === 'r' ? '---:' : '---')).join('|') + '|');
  for (const r of rows) out.push('| ' + r.join(' | ') + ' |');
  return out.join('\n');
}

function renderDoc(m) {
  const L = [];
  L.push('<!-- AUTO-GENERATED — DO NOT EDIT. `node tools/balance.js --write` 가 만든다. -->');
  L.push('<!-- 모델과 조정 이유는 tools/balance.js 안에 있다. 여기를 고치면 --check 가 깨진다. -->');
  L.push('');
  L.push('# 밸런스');
  L.push('');
  L.push('SPEC-arsenal §F. 무기 **' + m.rows.length + '종**, 로드아웃 상한 ' + m.loadoutMax + '.');
  L.push('실전 중앙값은 **' + f1(m.median) + '** 이고 모든 밴드는 이 값에 대한 비율이다.');
  L.push('');
  L.push('이 문서는 손으로 쓰지 않는다. `node tools/balance.js --write` 가 만들고');
  L.push('`node tools/balance.js --check` 가 CI 에서 돌아 **밸런스 회귀가 테스트로 잡힌다**.');
  L.push('');

  L.push('## §F3 공통 통화');
  L.push('');
  L.push('```');
  L.push('interval  = hold ? tickMs : max(cooldownMs, ' + CLICK_FLOOR_MS + ')   // ' + CLICK_FLOOR_MS + 'ms 는 §A1 의 "짧게 누름" 경계');
  L.push('hit       = damage × (pellets | 1) × vs[등급]        // 샷건 한 발은 펠릿 아홉이고 한 번에 닿는다');
  L.push('vs평균     = (vs.낱말 + vs.작은것 + vs.중간 + vs.큰것) / 4   // §F3 통화가 쓰는 등급 계수 (§C3)');
  L.push('pHit      = erf((w/2)/(σ√2)) × erf((h/2)/(σ√2))      // 2차원 가우시안. 기준 표적은 ' + HIT_BOX.label);
  L.push('burstDPS  = damage × pellets × vs평균 × 1000 / interval × pHit + dotDPS   // 맞는 탄만 센다');
  L.push('처치 시간  = swapMs + 예열 + 필요한 공격 수 × interval + 재장전 · 과열   // 꺼내서 지울 때까지');
  L.push('uptime    = 쏠 수 있는 시간 / 주기                     // 재장전 · 과열 · 예열 · 쿨다운');
  L.push('handling  = moveSpeed × (1 − swapMs/2000)           // 산포 항은 삭제됐다 (§B1)');
  L.push('σ (유효산포) = spread + bloom × 10                     // 지속 사격 상한. 조준경 무기는 0');
  L.push('effective = burstDPS × uptime × handling');
  L.push('환산       = (burstDPS + utility) × uptime × handling   // §F4 의 "제공 효용 환산 후"');
  L.push('```');
  L.push('');
  L.push('고른 해석을 적어 둔다.');
  L.push('');
  L.push('- **산포는 화력이지 핸들링이 아니다** (SPEC-weapon-identity §B1). 9단계의 `handling` 은 산포를');
  L.push('  `(1 − min(0.35, 유효산포/120))` 로 한 번 세었고, 그 `min` 이 **유효산포 42px 에서 포화**했다.');
  L.push('  미니건은 유효산포 70px 로 이미 그 바닥에 앉아 있었으므로 **더 부정확해져도 점수가 내려가지 않았다**');
  L.push('  — 못 맞게 만드는 것이 밴드를 맞추는 공짜 손잡이였다. 이제 산포는 `burstDPS × pHit` 하나로만 들어가고');
  L.push('  포화 상한은 없다.');
  L.push('- **σ 는 그 무기가 실제로 쏘는 자세의 산포다.** 지속 사격 무기는 **블룸 상한**에서 쏜다(`bloom × 10`,');
  L.push('  src/71 `noteShot`). 저격총은 **조준경 안에서** 쏘므로 0 이다 — src/71 의 `spreadNow()` 가');
  L.push('  `W.scope && state.scoped` 에서 0 을 돌려주고 v1.2 A4 가 그것을 무기의 정체성으로 못박았다.');
  L.push('  이 예외가 없으면 산포를 지우는 기능을 가진 유일한 무기가 그 기능 때문에 벌을 받는다.');
  L.push('- **σ 는 무기 표가 발행하는 산포다.** 발사 시점에만 있는 둘 — 반동 킥(`recoil × 6`, 250ms 감쇠)과');
  L.push('  `fireSmg` / `fireMinigun` 안의 기계적 ±9 · ±7 원뿔 — 은 표에 없으므로 여기 들어가지 않는다.');
  L.push('  그래서 아래 `pHit` 은 **상한**이고 실제로 쏴서 센 명중률은 그보다 몇 %p 낮다. 그 차이는');
  L.push('  `test/e2e.js` 의 실측 단언이 본다.');
  L.push('- **샷건의 `pHit` 은 조준점 자체의 명중률이다.** 펠릿 아홉이 흩어지는 반경 72px(`pelletSpread`)은');
  L.push('  조준 오차가 아니라 §E 가 샷건에 준 **역할**(밀집 다수 동시)이고, 첫 펠릿은 조준점에 정확히 간다');
  L.push('  (src/76 `fireShotgun`). §F6-6 이 보는 값만 펠릿 보정 `1 − (1 − pHit)^pellets` 을 쓴다.');
  L.push('- **burstDPS 는 단일 표적이다.** §F2 의 기준 표적이 전부 요소 하나이고, 동시 타격 수를 곱하면');
  L.push('  폭탄 하나가 중앙값의 일곱 배가 되어 ±18% 밴드가 산술적으로 닫히지 않는다. 범위 무기의 동시');
  L.push('  타격은 통화가 아니라 **역할**이다 (§F5: 폭탄은 범위당 효율, 로켓은 단발 범위 최대).');
  L.push('- **dotDPS 는 매 틱 스택을 쌓는 무기에만 붙는다** (화염방사기 · 레이저). 폭발은 한 번 붙이고');
  L.push('  스택이 줄어들기 시작하므로 포화 상태의 지속 피해를 줄 수 없다. 숫자는 `src/77-burn.js` 의');
  L.push('  상수(`BURN_DOT_BASE` ' + num(m.burn.BURN_DOT_BASE, 0) + ' + `BURN_MAX` ' + num(m.burn.BURN_MAX, 0) + ' × `BURN_DOT_PER_STACK` ' + num(m.burn.BURN_DOT_PER_STACK, 0) + ') 에서 직접 읽는다.');
  L.push('- **§F4 의 "제공 효용 환산" 은 곱이 아니라 덧셈이다.** 중력탄은 직접 피해가 0 이고 0 에 어떤 계수를');
  L.push('  곱해도 0 이라, 곱셈으로 두면 특수 밴드가 구조적으로 닿을 수 없다. 그래서 `utility` 는 그 무기가');
  L.push('  로드아웃에 돌려주는 **초당 피해 환산값**이고 `burstDPS` 옆에 더한다. 각 숫자의 유도는');
  L.push('  `src/00-prelude.js` 의 `WEAPON_ROLES` 주석에 한 줄씩 적혀 있다.');
  L.push('- **등급 계수는 통화에 네 등급의 평균으로 들어간다** (SPEC-weapon-identity §C3). 버튼 한 등급만');
  L.push('  쓰는 읽기도 가능했지만 — §B1 이 pHit 의 기준 표적을 버튼으로 고정했으니까 — 그러면 §C3 이 준');
  L.push('  역할이 그대로 밴드 위반이 된다: 샷건(작은 것 1.4)과 권총(1.3)이 140% · 142%, 로켓(0.7)과');
  L.push('  미니건(0.8)이 73% · 71%. §C5 가 "**성능은 같아도 된다. 역할이 달라야 한다**" 고 적었는데 통화를');
  L.push('  한 등급에 묶으면 역할이 곧 성능이 되어 그 문장이 성립하지 않는다. pHit 의 기준 표적이 버튼인');
  L.push('  것은 **조준**의 문제이고 등급 계수는 **표적**의 문제라 축이 다르다.');
  L.push('- **처치 시간은 n 번째 공격까지가 아니라 n 번의 공격이다.** 9단계는 `(공격 수 − 1) × interval` 로');
  L.push('  셌고, 그래서 한 방에 지우는 조합이 **0초 = "즉시"** 로 적혔다 — §A2 가 센 "표의 절반이 즉시" 가');
  L.push('  거기서 나왔다. 쿨다운 400ms 짜리 망치를 한 번 휘두르면 그 400ms 는 **당신의 시간**이고 그 동안');
  L.push('  다른 아무것도 못 한다. 무기를 꺼내는 `swapMs` 도 같은 이유로 들어간다 — §F8 이 이미 그 값을');
  L.push('  `arcade 반응` 으로 따로 발행하고 있었다. 등급 계수만으로는 "즉시" 가 사라지지 않는다: §C3 이');
  L.push('  망치의 낱말 계수를 1.0 으로 못박았고 피해 65 는 §A2 가 못박았으므로 한 방은 한 방이다.');
  L.push('');

  L.push('## §F4 · §F5 — 실효 화력과 역할');
  L.push('');
  L.push('§F5 는 "하나도 겹치면 안 된다" 고 했다. 역할은 약속이 아니라 `WEAPONS[id].role` 필드이고,');
  L.push('`--check` 가 빈 역할 · 이름 없는 역할 · 겹치는 역할을 전부 잡는다.');
  L.push('');
  for (const cat of ['field', 'special', 'fun']) {
    const band = BANDS[cat];
    const rows = m.rows.filter((r) => r.cat === cat);
    if (!rows.length) continue;
    L.push('### ' + band.label + ' — 밴드 ' + pct(band.lo) + ' ~ ' + pct(band.hi) + (cat === 'field' ? ' (중앙값 ±18%)' : ''));
    L.push('');
    L.push(mdTable(
      ['무기', '역할 (§F5)', 'σ', 'pHit(버튼)', 'burstDPS', 'uptime', 'handling', 'effective', '효용', '환산', '중앙값비'],
      rows.map((r) => [
        '`' + r.id + '`', ROLE_LABEL[r.role] || String(r.role),
        f1(r.spread) + 'px', pct(r.pHitEff) + (r.pellets > 1 ? ' ※' : ''),
        f1(r.burstDPS), f3(r.uptime), f3(r.handling), f1(r.effective),
        r.utility === 0 ? '—' : '+' + f1(r.utility), f1(r.rated),
        (BAND_EXEMPT.has(r.id) ? '— (밴드 제외)' : pct(r.ratio))
      ]),
      ['', '', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r']));
    L.push('');
  }
  L.push('`pHit` 은 ' + HIT_BOX.label + ' 명중률이다. ※ 는 펠릿 보정 `1 − (1 − pHit)^pellets` 이 들어간 값(샷건).');
  L.push('');
  L.push('붕괴는 §F4 가 직접 뺐다 — "쿨다운으로 제한되는 특수기이므로 밴드 검사에서 제외한다".');
  L.push('');

  L.push('## §F2 — 기준 표적 처치 시간');
  L.push('');
  L.push('재장전 · 예열 · 과열이 전부 들어간 값이다. `—` 는 그 무기로는 부술 수 없다는 뜻(중력탄은 직접 피해 0).');
  L.push('');
  L.push(mdTable(
    ['무기'].concat(TARGETS.map((t) => t.label + ' ' + t.hp)),
    m.rows.map((r) => ['`' + r.id + '`'].concat(TARGETS.map((t) => ttkStr(r.ttk[t.key])))),
    ['', 'r', 'r', 'r', 'r', 'r']));
  L.push('');
  L.push('§F6-4 는 실전 무기가 큰 섹션(' + SECTION_HP + ')을 4.5초 안에 지울 것을 요구한다 — 그 검사만은');
  L.push('**등급 계수를 빼고** 본다(아래 §F6 주석 참조).');
  L.push('');
  L.push('표적의 **등급**(§C2, 면적으로 가른다)과 그 등급에 곱해진 계수가 위 숫자에 이미 들어가 있다:');
  L.push('');
  L.push(mdTable(['기준 표적', '면적(px²)', '등급'],
    TARGETS.map((t) => [t.label + ' ' + t.hp, String(t.area), GRADES.filter((g) => g.key === t.grade).map((g) => g.label)[0] || t.grade]),
    ['', 'r', '']));
  L.push('');
  L.push('## §C3 — 표적 등급 계수');
  L.push('');
  L.push('> "무기의 정체성은 \'무엇을 잘하는가\'가 아니라 **\'무엇을 못하는가\'** 다." (§C1)');
  L.push('');
  L.push('`WEAPONS[id].vs` 는 약속이 아니라 필드다. §F6-7 이 1.0 미만을 하나도 갖지 않은 실전 무기를 잡고,');
  L.push('§F6-8 이 네 값이 완전히 같은 두 무기를 잡는다.');
  L.push('');
  L.push(mdTable(['무기', '범주'].concat(GRADES.map((g) => g.label)).concat(['평균']),
    m.rows.filter((r) => r.vs).map((r) => ['`' + r.id + '`', BANDS[r.cat] ? BANDS[r.cat].label : r.cat]
      .concat(GRADES.map((g) => { const v = typeof r.vs[g.key] === 'number' ? r.vs[g.key] : 1; return (v < 1 ? '**' + v.toFixed(1) + '**' : v.toFixed(1)); }))
      .concat([(GRADES.reduce((a, g) => a + (typeof r.vs[g.key] === 'number' ? r.vs[g.key] : 1), 0) / GRADES.length).toFixed(3)])),
    ['', '', 'r', 'r', 'r', 'r', 'r']));
  L.push('');
  L.push('굵은 값이 그 무기가 **못하는 것**이다. 계수표가 없는 무기(붕괴 · 특수 · 예능)는 네 등급 전부 1.0 —');
  L.push('§C3 의 표가 실전 13종만 적었고 §C3 자신이 "기본 1.0" 이라고 썼다. 붕괴는 피해가 Infinity 라');
  L.push('곱할 것이 없고 §F4 가 이미 밴드 검사에서 뺐으므로 §F6-7 에서도 뺀다.');
  L.push('');

  L.push('## §F8 — 모드별 보정');
  L.push('');
  L.push('`survival` 은 `moveSpeed` 지수를 1.5 로 올리고(이동이 생존이다), `rampage` 는 `moveSpeed` 항을 1 로');
  L.push('둔다(아무도 쫓아오지 않는다). `arcade` 는 한 손 조작이라 **반응 = swapMs + 첫 발까지의 시간** 을 따로 본다.');
  L.push('');
  L.push(mdTable(
    ['무기', 'rampage', 'arcade', 'survival', 'arcade 반응(ms)'],
    m.rows.map((r) => ['`' + r.id + '`', f1(r.modes.rampage.effective), f1(r.modes.arcade.effective), f1(r.modes.survival.effective), String(Math.round(r.firstShotMs))]),
    ['', 'r', 'r', 'r', 'r']));
  L.push('');

  L.push('## §F7 — 무엇을 왜 바꿨나');
  L.push('');
  L.push('§F7 의 순서를 그대로 따랐다. **핸들링(교체 · 이동 · 산포 · 재장전)을 먼저 건드리고**,');
  L.push('피해량은 거기서 닿지 않는 곳에서만 움직였다 — 피해량은 체감으로 기억하는 값이라');
  L.push('자주 바꾸면 혼란스럽기 때문이다. 아래에 없는 수치는 **손대지 않았다**.');
  L.push('');
  if (ADJUSTMENTS.length) {
    L.push(mdTable(['무기', '항목', '이전', '이후', '왜'],
      ADJUSTMENTS.map((a) => ['`' + a.id + '`', '`' + a.field + '`', String(a.from), String(a.to), a.why])));
  } else {
    L.push('_이번 단계에서 움직인 수치가 없다._');
  }
  L.push('');

  L.push('## §F6 — `--check` 가 잡는 여덟 가지');
  L.push('');
  L.push('1. 실효 화력이 범주 밴드를 벗어난다');
  L.push('2. 같은 범주 안에서 다른 무기에 완전히 지배된다 (`burstDPS` · `uptime` · `handling` 모든 축에서 같거나 나쁨)');
  L.push('3. 큰 카드(' + BIG_CARD_HP + ')를 **값싼** 1회 타격으로 파괴한다 (붕괴 · 충전 로켓 · 슬러그 제외)');
  L.push('4. 실전 무기가 큰 섹션(' + SECTION_HP + ')을 4.5초 안에 못 지운다');
  L.push('5. `moveSpeed` 가 0.5 미만 또는 1.25 초과');
  L.push('6. 실전 무기의 `pHit(' + HIT_BOX.label + ')` 이 ' + pct(PHIT_MIN) + ' 미만이다 (샷건은 펠릿 보정값으로 본다)');
  L.push('7. 실전 무기의 §C3 등급 계수에 **1.0 미만인 등급이 하나도 없다** (계수표 자체가 없는 것도 같은 실패)');
  L.push('8. **어떤 두 무기의 등급 계수 네 값이 전부 같다**');
  L.push('');
  L.push('여기에 §F5 역할 겹침 검사가 더해진다.');
  L.push('');
  L.push('6번은 SPEC-weapon-identity §B1 이 더한 것이다. **지속 사격 무기가 작은 표적을 절반도 못 맞히면');
  L.push('그것은 역할이 아니라 결함이다** — 교정 전의 미니건은 ' + HIT_BOX.label + ' 을 **4%** 로 맞혔고,');
  L.push('그런데도 모델은 그것을 벌하지 않았다. 이제 `bloom` 을 14 로 되돌리면 이 줄이 exit 1 이다.');
  L.push('');
  L.push('3번은 해석이 하나 들어갔다. 명세가 뺀 셋(붕괴 · 충전 로켓 · 슬러그)은 전부 **비싼 한 방**이다 —');
  L.push('쿨다운 2초짜리 탄창 1, 또는 탄약 2발을 쓰는 보조 공격. 그래서 "1회 타격" 을 **값이 싼 한 방**으로');
  L.push('읽었다: 탄창이 없어 무한히 반복되거나(근접), 한 탄창으로 ' + BIG_CARD_HP + ' 이상을 여섯 번 넘게 꽂을 수 있는 경우.');
  L.push('이 해석 없이 글자 그대로 읽으면 §A2 가 못박고 테스트가 고정한 저격총 200 · 폭탄 190 · 로켓 260 이');
  L.push('전부 위반이 되어 규칙이 성립하지 않는다.');
  L.push('');
  L.push('4번도 하나 들어갔다. **실전 범주에만** 적용한다 — 예능 무기가 4.5초 안에 큰 섹션을 지우면');
  L.push('§D 의 "실효 화력이 중앙값의 25~50%" 와 정면으로 충돌하고, 특수 무기는 애초에 피해로 일하지 않는다.');
  L.push('그리고 11단계부터 4번은 **등급 계수를 빼고** 잰다 — §C3 이 다섯 무기에게 큰 것을 일부러 못하게');
  L.push('만들라고 적었으므로, 계수를 넣어 재면 그 다섯이 전부 4번 위반이 되어 §C 와 §F6-4 가 서로를 지운다.');
  L.push('4번은 "할 수 있는가" 를 묻고 §C3 은 "얼마나 잘하는가" 를 정한다. 못하게 만드는 쪽은 7번이 맡는다.');
  L.push('');
  L.push('7번과 8번은 SPEC-weapon-identity §C3 이 더한 것이다. **"못하는 것이 없으면 잘하는 것도 느껴지지');
  L.push('않는다"**(§C1) 를 산문이 아니라 검사로 만든 둘이다 — 계수가 전부 1.0 인 실전 무기를 넣으면 7번이,');
  L.push('두 무기의 계수 네 값을 같게 만들면 8번이 exit 1 이다. 8번은 **계수표를 발행한 무기들끼리** 본다:');
  L.push('§C3 의 표는 실전 13종만 적었고 발행하지 않은 쪽은 §C3 자신이 "기본 1.0" 이라고 쓴 쪽이라,');
  L.push('그것들을 서로 비교하면 "특수 무기가 둘 이상 존재하면 실패" 가 된다.');
  L.push('');
  if (m.violations.length) {
    L.push('> **현재 위반 ' + m.violations.length + '건** — `node tools/balance.js --check` 가 exit 1 이다.');
    for (const v of m.violations) L.push('> - §F6-' + v.rule + ' `' + v.id + '`: ' + v.msg);
  } else {
    L.push('현재 위반 **0건**.');
  }
  L.push('');
  return L.join('\n');
}

module.exports = { model, TARGETS, BANDS, ROLE_LABEL, ADJUSTMENTS, CLICK_FLOOR_MS, readArsenal };

if (require.main === module) {
  const args = process.argv.slice(2);
  const m = model();
  if (args.includes('--json')) { process.stdout.write(JSON.stringify(m, null, 2) + '\n'); process.exit(0); }
  if (!args.includes('--quiet')) process.stdout.write(printTable(m) + '\n');

  const doc = renderDoc(m);
  const arsenal = renderArsenal(m);
  let bad = 0;
  if (args.includes('--write')) {
    fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
    fs.writeFileSync(DOC_PATH, doc, 'utf8');
    fs.mkdirSync(path.dirname(ARSENAL_PATH), { recursive: true });
    fs.writeFileSync(ARSENAL_PATH, arsenal, 'utf8');
    if (!args.includes('--quiet')) {
      process.stdout.write('\nbalance: wrote ' + path.relative(REPO_ROOT, DOC_PATH) + '\n');
      process.stdout.write('balance: wrote ' + path.relative(REPO_ROOT, ARSENAL_PATH) + '\n');
    }
  }
  for (const v of m.violations) { process.stderr.write('balance: §F6-' + v.rule + ' ' + v.id + ': ' + v.msg + '\n'); bad++; }
  if (args.includes('--check')) {
    /* The human-readable table is a GENERATED file, exactly like content.js — a stale one is a failure,
     * with the same fix line build.js prints. */
    let onDisk = null;
    try { onDisk = fs.readFileSync(DOC_PATH, 'utf8'); } catch (e) { onDisk = null; }
    if (onDisk !== doc) {
      process.stderr.write('balance: docs/BALANCE.md ' + (onDisk == null ? 'does not exist' : 'is stale') + ' — run `node tools/balance.js --write`\n');
      bad++;
    }
    /* SPEC-product §1: options/arsenal.json is the same kind of generated file and is held to the same rule.
     * It only exists once the options page does, so its ABSENCE is not a failure — a stale one is. */
    let arsenalOnDisk = null;
    try { arsenalOnDisk = fs.readFileSync(ARSENAL_PATH, 'utf8'); } catch (e) { arsenalOnDisk = null; }
    if (arsenalOnDisk !== null && arsenalOnDisk !== arsenal) {
      process.stderr.write('balance: options/arsenal.json is stale — run `node tools/balance.js --write`\n');
      bad++;
    }
  }
  process.exit(args.includes('--check') && bad ? 1 : 0);
}
