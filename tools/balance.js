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

/** Read the whole arsenal: WEAPONS (src/00) merged with WEAPON_STATS (src/71). */
function readArsenal() {
  const prelude = stripComments(readSrc('00-prelude.js'));
  const helpers = stripComments(readSrc('71-weapon-helpers.js'));
  const preludeConsts = numericConsts(prelude);
  const helperConsts = numericConsts(helpers);
  const ids = literalToData(sliceLiteral(prelude, 'WEAPON_IDS', '[', ']'), preludeConsts);
  const weapons = literalToData(sliceLiteral(prelude, 'WEAPONS', '{', '}'), preludeConsts);
  const stats = literalToData(sliceLiteral(helpers, 'WEAPON_STATS', '{', '}'), helperConsts);
  const roles = literalToData(sliceLiteral(prelude, 'WEAPON_ROLES', '{', '}'), preludeConsts);
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
  }
  return { ids, weapons: out, roles, presets, swapDefault, loadoutMax, burn };
}

/* ===================================================================== */
/* 1. §F2 기준 표적 · §F3 공통 통화                                        */
/* ===================================================================== */

/* §F2. The five reference targets, max health. */
const TARGETS = [
  { key: 'word', hp: 19, label: '단어 조각' },
  { key: 'button', hp: 44, label: '버튼' },
  { key: 'smallCard', hp: 99, label: '작은 카드' },
  { key: 'bigCard', hp: 184, label: '큰 카드' },
  { key: 'section', hp: 253, label: '큰 섹션' }
];
const BIG_CARD_HP = 184;
const SECTION_HP = 253;

/* §A1's own number: under 120 ms a press is "평소의 일반 공격". A click weapon with no cooldown can
 * therefore be asked for a shot every 120 ms and no faster — that is the floor this model uses, and it
 * is the SAME constant the §D band check in test/e2e.js uses, so the two models never disagree. */
const CLICK_FLOOR_MS = 120;
/* §F3 handling: 유효산포. `spread` is the weapon's own cone; sustained fire adds bloom up to bloom × 10
 * (src/71-weapon-helpers.js noteShot/bloomNow). Half of that cap is the average a magazine spends at. */
const BLOOM_CAP_MUL = 10;
const BLOOM_AVG = 0.5;
const SPREAD_REF = 120;        // §F3: (1 − min(0.35, 유효산포/120))
const SPREAD_FLOOR = 0.35;
const SWAP_REF = 2000;         // §F3: (1 − swapMs/2000)
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

/** §F3 burstDPS, single target. AoE's simultaneous targets are a ROLE (§F5), not a currency. */
function burstDPS(W, burn) {
  const d = hitDamage(W);
  if (!isFinite(d)) return Infinity;
  const key = BURN_WEAPONS[W.id];
  let dot = 0;
  if (key && burn[key] > 0) {
    /* src/77-burn.js §F1: 지속 피해 초당 BURN_DOT_BASE + stacks × BURN_DOT_PER_STACK. A weapon that adds
     * `stacks` every tick saturates at BURN_MAX long before the natural decay matters, so the dot it is
     * credited with is the saturated one. */
    dot = num(burn.BURN_DOT_BASE, 0) + num(burn.BURN_MAX, 0) * num(burn.BURN_DOT_PER_STACK, 0);
  }
  return (d * 1000) / intervalMs(W) + dot;
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

/** §F3 handling = moveSpeed × (1 − swapMs/2000) × (1 − min(0.35, 유효산포/120)). */
function effSpread(W) { return num(W.spread, 0) + num(W.bloom, 0) * BLOOM_CAP_MUL * BLOOM_AVG; }
function handling(W, swapDefault, moveExp) {
  const move = num(W.moveSpeed, 1);
  const swap = num(W.swapMs, swapDefault);
  const m = moveExp === 0 ? 1 : Math.pow(move, moveExp == null ? 1 : moveExp);
  return m * (1 - swap / SWAP_REF) * (1 - Math.min(SPREAD_FLOOR, effSpread(W) / SPREAD_REF));
}

/** 처치 시간: the reference target's whole health, magazines and 예열 included. */
function ttk(W, hp) {
  const d = hitDamage(W);
  if (!isFinite(d)) return 0;                      // 붕괴
  if (!(d > 0)) return Infinity;                   // 중력탄 — 직접 피해 0
  const shots = Math.ceil(hp / d);
  const iv = intervalMs(W);
  let t = (shots - 1) * iv + num(W.spinUpMs, 0);
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
  const { ids, weapons, presets, swapDefault, loadoutMax, burn } = readArsenal();
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
    for (const t of TARGETS) row.ttk[t.key] = ttk(W, t.hp);
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

  return { ids, rows, byId, presets, median, loadoutMax, burn, swapDefault, violations: violations(rows, byId, median) };
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
  for (const r of rows) {
    if (r.cat !== 'field' || BAND_EXEMPT.has(r.id)) continue;
    if (r.ttk.section > 4.5 + 1e-9) out.push({ rule: 4, id: r.id, msg: `큰 섹션(${SECTION_HP}) 처치 시간 ${r.ttk.section.toFixed(2)}초 > 4.5초` });
  }
  /* 5. moveSpeed 가 0.5 미만 또는 1.25 초과 */
  for (const r of rows) {
    if (r.moveSpeed < 0.5 - 1e-9 || r.moveSpeed > 1.25 + 1e-9) out.push({ rule: 5, id: r.id, msg: `moveSpeed ${r.moveSpeed} 가 [0.5, 1.25] 밖이다` });
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
  { id: 'chicken', field: 'cooldownMs', from: 0, to: 300, why: '예능 밴드 안에 있어야 하는데 **100%** 로 실전 한복판에 있었다. 피해 12 는 §D 가 못박았고 교체 110ms · 이동 1.25 는 "가장 빠르고 가볍다" 라 못 건드린다. 고무 치킨은 휘두를 때마다 출렁인다 — 간격이 그 값이다.' }
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
  const head = ['무기', '범주', '역할', 'burstDPS', 'uptime', 'handling', 'effective', '효용', '환산', '중앙값비'];
  const body = m.rows.map((r) => [
    r.id, BANDS[r.cat] ? BANDS[r.cat].label : r.cat, ROLE_LABEL[r.role] || String(r.role),
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
  L.push('hit       = damage × (pellets | 1)                  // 샷건 한 발은 펠릿 아홉이고 한 번에 닿는다');
  L.push('burstDPS  = hit × 1000 / interval + dotDPS          // 단일 표적. 연소는 가산한다');
  L.push('uptime    = 쏠 수 있는 시간 / 주기                     // 재장전 · 과열 · 예열 · 쿨다운');
  L.push('handling  = moveSpeed × (1 − swapMs/2000) × (1 − min(0.35, 유효산포/120))');
  L.push('유효산포   = spread + bloom × 10 × 0.5                // bloom 상한은 ×10 (src/71), 평균은 그 절반');
  L.push('effective = burstDPS × uptime × handling');
  L.push('환산       = (burstDPS + utility) × uptime × handling   // §F4 의 "제공 효용 환산 후"');
  L.push('```');
  L.push('');
  L.push('고른 해석 셋을 적어 둔다.');
  L.push('');
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
      ['무기', '역할 (§F5)', 'burstDPS', 'uptime', 'handling', 'effective', '효용', '환산', '중앙값비'],
      rows.map((r) => [
        '`' + r.id + '`', ROLE_LABEL[r.role] || String(r.role),
        f1(r.burstDPS), f3(r.uptime), f3(r.handling), f1(r.effective),
        r.utility === 0 ? '—' : '+' + f1(r.utility), f1(r.rated),
        (BAND_EXEMPT.has(r.id) ? '— (밴드 제외)' : pct(r.ratio))
      ]),
      ['', '', 'r', 'r', 'r', 'r', 'r', 'r', 'r']));
    L.push('');
  }
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
  L.push('§F6-4 는 실전 무기가 큰 섹션(' + SECTION_HP + ')을 4.5초 안에 지울 것을 요구한다.');
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

  L.push('## §F6 — `--check` 가 잡는 다섯 가지');
  L.push('');
  L.push('1. 실효 화력이 범주 밴드를 벗어난다');
  L.push('2. 같은 범주 안에서 다른 무기에 완전히 지배된다 (`burstDPS` · `uptime` · `handling` 모든 축에서 같거나 나쁨)');
  L.push('3. 큰 카드(' + BIG_CARD_HP + ')를 **값싼** 1회 타격으로 파괴한다 (붕괴 · 충전 로켓 · 슬러그 제외)');
  L.push('4. 실전 무기가 큰 섹션(' + SECTION_HP + ')을 4.5초 안에 못 지운다');
  L.push('5. `moveSpeed` 가 0.5 미만 또는 1.25 초과');
  L.push('');
  L.push('여기에 §F5 역할 겹침 검사가 더해진다.');
  L.push('');
  L.push('3번은 해석이 하나 들어갔다. 명세가 뺀 셋(붕괴 · 충전 로켓 · 슬러그)은 전부 **비싼 한 방**이다 —');
  L.push('쿨다운 2초짜리 탄창 1, 또는 탄약 2발을 쓰는 보조 공격. 그래서 "1회 타격" 을 **값이 싼 한 방**으로');
  L.push('읽었다: 탄창이 없어 무한히 반복되거나(근접), 한 탄창으로 ' + BIG_CARD_HP + ' 이상을 여섯 번 넘게 꽂을 수 있는 경우.');
  L.push('이 해석 없이 글자 그대로 읽으면 §A2 가 못박고 테스트가 고정한 저격총 200 · 폭탄 190 · 로켓 260 이');
  L.push('전부 위반이 되어 규칙이 성립하지 않는다.');
  L.push('');
  L.push('4번도 하나 들어갔다. **실전 범주에만** 적용한다 — 예능 무기가 4.5초 안에 큰 섹션을 지우면');
  L.push('§D 의 "실효 화력이 중앙값의 25~50%" 와 정면으로 충돌하고, 특수 무기는 애초에 피해로 일하지 않는다.');
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
  let bad = 0;
  if (args.includes('--write')) {
    fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
    fs.writeFileSync(DOC_PATH, doc, 'utf8');
    if (!args.includes('--quiet')) process.stdout.write('\nbalance: wrote ' + path.relative(REPO_ROOT, DOC_PATH) + '\n');
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
  }
  process.exit(args.includes('--check') && bad ? 1 : 0);
}
