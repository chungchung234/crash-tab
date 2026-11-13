'use strict';
/*
 * tools/validate.js — zero-dependency static gate for crash-tab.
 *
 * Usage:
 *   node tools/validate.js [--quiet] [--strict]
 *   node tools/validate.js --expect-version <x.y.z>
 *   node tools/validate.js --compare-icons <dirA> <dirB>
 *
 * Exit code 0 when no rule FAILed, 1 otherwise. --strict promotes WARN to FAIL
 * (release.yml uses it; ci.yml does not).
 *
 * Also usable as a library:  require('./validate.js').run({ quiet: true })
 *   -> { failures: [...], warnings: [...], skips: [...], records: [...], ok: bool }
 * tools/package.js uses that so a package run cannot succeed where validate fails.
 *
 * Rules are written so they work on the CURRENT tree (no src/, no options/,
 * no share/, no settings-schema.json, package.json possibly absent) and keep
 * working once spec A2 / B1 / B2 / C6 land. Anything that depends on a file
 * that does not exist yet SKIPs with a printed reason rather than failing.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const build = require('./build.js');   // R19 asks the generator what content.js's Korean fallback should be

const REPO_ROOT = path.resolve(__dirname, '..');

/* ===================================================================== */
/* 0. Small filesystem / text helpers                                     */
/* ===================================================================== */

function stripBOM(s) { return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; }
function isFile(p) { try { return fs.statSync(p).isFile(); } catch (_) { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } }
function readText(p) { return fs.readFileSync(p, 'utf8'); }
function readJSON(p) { return JSON.parse(stripBOM(readText(p))); }

/* Directories never walked when enumerating the repository. */
const WALK_SKIP = new Set(['node_modules', 'dist', '.git', 'test/out']);

/** Recursively list files under <root>/<rel> as repo-relative, '/'-separated paths. */
function walkRel(root, rel, out) {
  out = out || [];
  const full = rel ? path.join(root, rel) : root;
  if (!isDir(full)) return out;
  for (const name of fs.readdirSync(full).sort()) {
    const r = rel ? rel + '/' + name : name;
    if (WALK_SKIP.has(r)) continue;
    const f = path.join(root, r);
    let st;
    try { st = fs.lstatSync(f); } catch (_) { continue; }
    if (st.isDirectory()) walkRel(root, r, out);
    else if (st.isFile()) out.push(r);
  }
  return out;
}

/** Turn a manifest resource pattern into a RegExp over repo-relative paths. */
function globToRegExp(pattern) {
  const body = pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + body + '$');
}

/* ===================================================================== */
/* 1. Ship list — shared with tools/package.js                            */
/* ===================================================================== */

/*
 * The exact set of paths that end up in the store zip, in the order the
 * package listing prints them. `optional: true` means "not an error if the
 * path is absent"; package.js prints the note instead.
 */
const SHIP_SPEC = [
  { rel: 'manifest.json',         kind: 'file', optional: false },
  { rel: 'background.js',         kind: 'file', optional: false },
  { rel: 'content.js',            kind: 'file', optional: false },
  { rel: 'content.css',           kind: 'file', optional: false },
  { rel: 'settings-schema.json',  kind: 'file', optional: true, note: 'spec B1 — settings schema not created yet' },
  { rel: 'icons',                 kind: 'dir',  optional: false },
  { rel: '_locales',              kind: 'dir',  optional: false },
  { rel: 'options',               kind: 'dir',  optional: true, note: 'SPEC-product §1 — options page not created yet' },
  { rel: 'share',                 kind: 'dir',  optional: true, note: 'spec C6 — share page not created yet' },
  { rel: 'LICENSE',               kind: 'file', optional: true, note: 'spec A1 — `git checkout origin/main -- LICENSE` has not run yet' },
];

/* Never shipped, even if they somehow appear under a shipped directory. */
const SHIP_EXCLUDE_DIRS = new Set(['src', 'tools', 'test', '.github', 'dist', 'node_modules', 'docs']);

function shipDirFiles(root, rel) {
  const out = [];
  (function rec(r) {
    const full = path.join(root, r);
    if (!isDir(full)) return;
    for (const name of fs.readdirSync(full).sort()) {
      if (name.startsWith('.')) continue;                 // dotfiles never ship
      if (SHIP_EXCLUDE_DIRS.has(name)) continue;
      const child = r + '/' + name;
      const f = path.join(root, child);
      let st;
      try { st = fs.lstatSync(f); } catch (_) { continue; }
      if (st.isDirectory()) rec(child);
      else if (st.isFile() && !/\.md$/i.test(name)) out.push(child);
    }
  })(rel);
  return out;
}

/**
 * Resolve the ship list against a tree.
 * -> { files: ['manifest.json', 'icons/icon16.png', ...], missing: [{rel, optional, note}] }
 */
function collectShipFiles(root) {
  root = root || REPO_ROOT;
  const files = [];
  const missing = [];
  for (const spec of SHIP_SPEC) {
    const full = path.join(root, spec.rel);
    if (spec.kind === 'file') {
      if (isFile(full)) files.push(spec.rel);
      else missing.push(spec);
    } else {
      if (isDir(full)) {
        const found = shipDirFiles(root, spec.rel);
        if (found.length === 0) missing.push(spec); else files.push(...found);
      } else missing.push(spec);
    }
  }
  return { files, missing };
}

/* ===================================================================== */
/* 2. PNG reading — IHDR only, plus a full unfilter for --compare-icons   */
/* ===================================================================== */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

function pngChunks(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG (bad signature)');
  const out = [];
  let p = 8;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const tag = buf.toString('latin1', p + 4, p + 8);
    if (p + 12 + len > buf.length) throw new Error('truncated PNG chunk ' + tag);
    out.push({ tag, data: buf.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
  }
  return out;
}

function pngIHDR(buf) {
  const c = pngChunks(buf).find((x) => x.tag === 'IHDR');
  if (!c || c.data.length < 13) throw new Error('missing or short IHDR');
  return {
    width: c.data.readUInt32BE(0),
    height: c.data.readUInt32BE(4),
    depth: c.data[8],
    colorType: c.data[9],
    interlace: c.data[12],
  };
}

/** Decode to unfiltered RGBA bytes. 8-bit truecolour-alpha, non-interlaced only. */
function pngPixels(buf) {
  const h = pngIHDR(buf);
  if (h.depth !== 8 || h.colorType !== 6 || h.interlace !== 0) {
    throw new Error('unsupported PNG (depth ' + h.depth + ', colourType ' + h.colorType + ', interlace ' + h.interlace + ')');
  }
  const idat = Buffer.concat(pngChunks(buf).filter((c) => c.tag === 'IDAT').map((c) => c.data));
  const raw = zlib.inflateSync(idat);
  const bpp = 4;
  const stride = h.width * bpp;
  const out = Buffer.alloc(h.height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h.height; y++) {
    const rowStart = y * (stride + 1);
    const ft = raw[rowStart];
    const line = raw.subarray(rowStart + 1, rowStart + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (ft !== 0) throw new Error('bad PNG filter type ' + ft);
      cur[x] = v & 0xFF;
    }
    prev = cur;
  }
  return { width: h.width, height: h.height, data: out };
}

/* ===================================================================== */
/* 3. Shared context                                                      */
/* ===================================================================== */

const VERSION_RE = /\bconst\s+VERSION\s*=\s*(['"])([^'"]+)\1/;

function readVersionConstant(root) {
  const rel = isFile(path.join(root, 'src/00-prelude.js')) ? 'src/00-prelude.js' : 'content.js';
  const full = path.join(root, rel);
  if (!isFile(full)) return { file: rel, version: null, error: rel + ' does not exist' };
  const m = VERSION_RE.exec(readText(full));
  if (!m) return { file: rel, version: null, error: 'no `const VERSION = \'x.y.z\'` found in ' + rel };
  return { file: rel, version: m[2], error: null };
}

function buildContext(root) {
  const ctx = {
    root,
    manifest: null, manifestText: null, manifestError: null,
    pkg: null, pkgPresent: false, pkgError: null,
    locales: {}, localeError: null,
    versionConst: readVersionConstant(root),
    allFiles: walkRel(root, '', []),
  };

  const mPath = path.join(root, 'manifest.json');
  if (!isFile(mPath)) ctx.manifestError = 'manifest.json does not exist';
  else {
    try { ctx.manifestText = readText(mPath); ctx.manifest = JSON.parse(stripBOM(ctx.manifestText)); }
    catch (e) { ctx.manifestError = e.message; }
  }

  const pPath = path.join(root, 'package.json');
  if (isFile(pPath)) {
    ctx.pkgPresent = true;
    try { ctx.pkg = readJSON(pPath); } catch (e) { ctx.pkgError = e.message; }
  }

  for (const loc of ['ko', 'en']) {
    const lp = path.join(root, '_locales', loc, 'messages.json');
    if (!isFile(lp)) { ctx.locales[loc] = { error: '_locales/' + loc + '/messages.json does not exist' }; continue; }
    try { ctx.locales[loc] = { data: readJSON(lp) }; }
    catch (e) { ctx.locales[loc] = { error: e.message }; }
  }

  /* The version package.js stamps on the zip. manifest.json is authoritative:
     it is what Chrome actually reads, so the artifact is named after it. */
  if (ctx.manifest && ctx.manifest.version) { ctx.version = ctx.manifest.version; ctx.versionSource = 'manifest.json'; }
  else if (ctx.pkg && ctx.pkg.version) { ctx.version = ctx.pkg.version; ctx.versionSource = 'package.json'; }
  else if (ctx.versionConst.version) { ctx.version = ctx.versionConst.version; ctx.versionSource = ctx.versionConst.file; }
  else { ctx.version = null; ctx.versionSource = null; }

  return ctx;
}

/* ===================================================================== */
/* 4. i18n reference collection                                           */
/* ===================================================================== */

const RE_MSG_CALL = /(?:\bmsg|chrome\s*\.\s*i18n\s*\.\s*getMessage)\s*\(\s*(['"])([A-Za-z0-9_@]+)\1/g;
const RE_MSG_MANIFEST = /__MSG_([A-Za-z0-9_@]+)__/g;

function i18nSourceFiles(root) {
  const files = [];
  for (const f of ['content.js', 'background.js']) if (isFile(path.join(root, f))) files.push(f);
  if (isDir(path.join(root, 'src'))) for (const r of walkRel(root, 'src', [])) if (/\.js$/.test(r)) files.push(r);
  for (const d of ['options', 'share']) {
    if (!isDir(path.join(root, d))) continue;
    for (const r of walkRel(root, d, [])) if (/\.(js|html)$/.test(r)) files.push(r);
  }
  return files;
}

/* ===================================================================== */
/* 5. Forbidden-API patterns                                              */
/* ===================================================================== */

const FORBIDDEN_INJECTED = [
  { label: 'innerHTML',            re: /\binnerHTML\b/ },
  { label: 'outerHTML',            re: /\bouterHTML\b/ },
  { label: 'insertAdjacentHTML',   re: /\binsertAdjacentHTML\b/ },
  { label: 'document.write',       re: /\bdocument\s*\.\s*write\b/ },
  { label: 'eval(',                re: /\beval\s*\(/ },
  { label: 'new Function',         re: /\bnew\s+Function\b/ },
  { label: "setAttribute('style'", re: /setAttribute\s*\(\s*['"]style['"]/ },
  { label: 'setInterval(',         re: /\bsetInterval\s*\(/ },
];

/* CLAUDE.md: "확장 페이지도 같은 규칙으로 만든다". The injected list's style/timer rules do not apply
 * here (an options page has no USER-origin stylesheet to fight and may own a repeating timer), but the
 * markup-injection family does — it is the rule that keeps every page in this extension buildable the
 * same way, and share/ and options/ are both written to it. */
const FORBIDDEN_EXT_PAGES = [
  { label: 'eval(',              re: /\beval\s*\(/ },
  { label: 'new Function',       re: /\bnew\s+Function\b/ },
  { label: 'innerHTML',          re: /\binnerHTML\b/ },
  { label: 'outerHTML',          re: /\bouterHTML\b/ },
  { label: 'insertAdjacentHTML', re: /\binsertAdjacentHTML\b/ },
  { label: 'document.write',     re: /\bdocument\s*\.\s*write\b/ },
];

/* A line that is ENTIRELY a comment is not code. Without this, a file cannot say in its own header
 * which APIs it refuses to use — which is exactly what share/share.js and options/options.js do, and
 * what CLAUDE.md asks every file in this repo to do. The test is deliberately crude (the line's first
 * non-space characters are a comment opener) so it can never mis-parse a regex literal the way a real
 * comment stripper can; a trailing comment after code is still scanned, which only errs conservative. */
function commentOnly(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*');
}

function scanForbidden(root, rels, patterns) {
  const hits = [];
  for (const rel of rels) {
    const full = path.join(root, rel);
    if (!isFile(full)) continue;
    const lines = readText(full).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (commentOnly(lines[i])) continue;
      for (const p of patterns) {
        const m = p.re.exec(lines[i]);
        if (m) hits.push({ rel, line: i + 1, col: m.index + 1, label: p.label, text: lines[i].trim().slice(0, 100) });
      }
    }
  }
  return hits;
}

/* ===================================================================== */
/* 6. Rules                                                               */
/* ===================================================================== */

const RULES = [];
function rule(id, name, fn) { RULES.push({ id, name, fn }); }

/* ---- R1 ---- */
rule('R1', 'manifest-parse', (r, ctx) => {
  if (ctx.manifestError) return r.fail('manifest.json: ' + ctx.manifestError);
  const m = ctx.manifest;
  if (m.manifest_version !== 3) r.fail('manifest_version is ' + JSON.stringify(m.manifest_version) + ', expected 3');
  if (!m.minimum_chrome_version) r.fail('minimum_chrome_version is missing');
  else r.note('minimum_chrome_version = ' + m.minimum_chrome_version);
  if (!m.name) r.fail('name is missing');
  if (!m.version) r.fail('version is missing');
});

/* ---- R2 ---- */
rule('R2', 'manifest-refs', (r, ctx) => {
  if (!ctx.manifest) return r.skip('manifest.json did not parse (see R1)');
  const m = ctx.manifest;
  const need = [];                       // [{ where, rel }]
  const push = (where, rel) => { if (typeof rel === 'string' && rel) need.push({ where, rel }); };

  if (m.icons) for (const k of Object.keys(m.icons)) push('icons.' + k, m.icons[k]);
  if (m.action && m.action.default_icon) {
    const di = m.action.default_icon;
    if (typeof di === 'string') push('action.default_icon', di);
    else for (const k of Object.keys(di)) push('action.default_icon.' + k, di[k]);
  }
  if (m.action && m.action.default_popup) push('action.default_popup', m.action.default_popup);
  if (m.background && m.background.service_worker) push('background.service_worker', m.background.service_worker);
  if (m.options_ui && m.options_ui.page) push('options_ui.page', m.options_ui.page);
  if (m.options_page) push('options_page', m.options_page);
  if (Array.isArray(m.content_scripts)) {
    m.content_scripts.forEach((cs, i) => {
      (cs.js || []).forEach((f, j) => push('content_scripts[' + i + '].js[' + j + ']', f));
      (cs.css || []).forEach((f, j) => push('content_scripts[' + i + '].css[' + j + ']', f));
    });
  }

  for (const n of need) {
    if (!isFile(path.join(ctx.root, n.rel))) r.fail(n.where + ' -> ' + n.rel + ' (file not found)');
  }

  /* web_accessible_resources entries may be globs; each must match >= 1 file. */
  if (Array.isArray(m.web_accessible_resources)) {
    m.web_accessible_resources.forEach((group, gi) => {
      (group.resources || []).forEach((pat, pi) => {
        const where = 'web_accessible_resources[' + gi + '].resources[' + pi + ']';
        if (pat.indexOf('*') === -1) {
          if (!isFile(path.join(ctx.root, pat))) r.fail(where + ' -> ' + pat + ' (file not found)');
        } else {
          const re = globToRegExp(pat);
          if (!ctx.allFiles.some((f) => re.test(f))) r.fail(where + ' -> ' + pat + ' (glob matches no file)');
        }
      });
    });
  }

  if (!r.failed()) r.note(need.length + ' referenced path(s) checked, all present');
});

/* ---- R3 ---- */
rule('R3', 'version-triple', (r, ctx) => {
  const vc = ctx.versionConst;
  const seen = [];
  seen.push({ src: 'manifest.json', v: ctx.manifest ? ctx.manifest.version : null });
  if (ctx.pkgPresent) seen.push({ src: 'package.json', v: ctx.pkg ? ctx.pkg.version : null });
  seen.push({ src: vc.file + ' (VERSION)', v: vc.version });

  if (!ctx.pkgPresent) r.note('package.json does not exist yet — comparing the remaining two sources only');
  if (ctx.pkgError) r.fail('package.json did not parse: ' + ctx.pkgError);
  if (vc.error) r.fail(vc.error);

  for (const s of seen) if (s.v == null && !r.failed()) r.fail(s.src + ' has no version');
  if (r.failed()) return;

  const values = new Map();
  for (const s of seen) {
    if (!values.has(s.v)) values.set(s.v, []);
    values.get(s.v).push(s.src);
  }
  if (values.size === 1) { r.note('all sources agree on ' + seen[0].v); return; }

  /* Name the odd one out rather than printing a bare mismatch. */
  const groups = [...values.entries()].sort((a, b) => b[1].length - a[1].length);
  const majority = groups[0];
  r.fail('version mismatch — ' + majority[1].join(' + ') + ' say ' + majority[0]
    + ', but ' + groups.slice(1).map((g) => g[1].join(' + ') + ' say ' + g[0]).join('; '));
  for (const s of seen) r.detail(s.src.padEnd(28) + s.v);
});

/* ---- R4 ---- */
rule('R4', 'permission-allowlist', (r, ctx) => {
  if (!ctx.manifest) return r.skip('manifest.json did not parse (see R1)');
  const ALLOWED = new Set(['activeTab', 'scripting', 'storage']);
  const perms = ctx.manifest.permissions || [];
  if (!Array.isArray(perms)) return r.fail('permissions is not an array');
  for (const p of perms) if (!ALLOWED.has(p)) r.fail('permission "' + p + '" is not in the allowlist {activeTab, scripting, storage}');
  if (ctx.manifest.host_permissions !== undefined) {
    r.fail('host_permissions must not appear in manifest.json (found ' + JSON.stringify(ctx.manifest.host_permissions) + ')');
    r.detail('the e2e harness injects host_permissions into its throwaway copy; it must never land in the repo manifest');
  }
  if (ctx.manifest.optional_host_permissions !== undefined) {
    r.fail('optional_host_permissions must not appear in manifest.json');
  }
  if (!r.failed()) r.note('permissions = [' + perms.join(', ') + '], no host_permissions');
});

/* ---- R5 ---- */
rule('R5', 'locale-parity', (r, ctx) => {
  const names = Object.keys(ctx.locales);
  for (const loc of names) if (ctx.locales[loc].error) r.fail('_locales/' + loc + ': ' + ctx.locales[loc].error);
  if (r.failed()) return;

  const keysets = {};
  for (const loc of names) {
    const data = ctx.locales[loc].data;
    if (data === null || typeof data !== 'object' || Array.isArray(data)) { r.fail('_locales/' + loc + '/messages.json is not an object'); continue; }
    for (const k of Object.keys(data)) {
      const v = data[k];
      if (v === null || typeof v !== 'object' || Array.isArray(v)) r.fail('_locales/' + loc + ': "' + k + '" is not an object');
      else if (typeof v.message !== 'string') r.fail('_locales/' + loc + ': "' + k + '" has no string `message`');
    }
    keysets[loc] = new Set(Object.keys(data));
  }
  if (r.failed()) return;

  const [a, b] = names;
  const onlyA = [...keysets[a]].filter((k) => !keysets[b].has(k));
  const onlyB = [...keysets[b]].filter((k) => !keysets[a].has(k));
  if (onlyA.length || onlyB.length) {
    r.fail('locale key sets differ (symmetric difference ' + (onlyA.length + onlyB.length) + ')');
    for (const k of onlyA) r.detail('only in ' + a + ': ' + k);
    for (const k of onlyB) r.detail('only in ' + b + ': ' + k);
  } else {
    r.note(names.join(' / ') + ' both define ' + keysets[a].size + ' keys, zero difference');
  }
});

/* ---- R6 ---- */
rule('R6', 'i18n-refs-exist', (r, ctx) => {
  for (const loc of Object.keys(ctx.locales)) if (ctx.locales[loc].error) return r.skip('a locale file is unreadable (see R5)');

  const refs = new Map();                                  // key -> Set(file)
  const add = (k, where) => { if (!refs.has(k)) refs.set(k, new Set()); refs.get(k).add(where); };

  if (ctx.manifestText) {
    RE_MSG_MANIFEST.lastIndex = 0;
    let m;
    while ((m = RE_MSG_MANIFEST.exec(ctx.manifestText))) add(m[1], 'manifest.json');
  }
  const srcFiles = i18nSourceFiles(ctx.root);
  for (const rel of srcFiles) {
    const text = readText(path.join(ctx.root, rel));
    RE_MSG_CALL.lastIndex = 0;
    let m;
    while ((m = RE_MSG_CALL.exec(text))) add(m[2], rel);
  }

  ctx.i18nRefs = refs;                                     // R7 reuses this
  for (const loc of Object.keys(ctx.locales)) {
    const data = ctx.locales[loc].data;
    for (const [k, where] of refs) {
      if (!Object.prototype.hasOwnProperty.call(data, k)) {
        r.fail('key "' + k + '" referenced by ' + [...where].join(', ') + ' is missing from _locales/' + loc);
      }
    }
  }
  if (!r.failed()) r.note(refs.size + ' referenced key(s) across ' + (srcFiles.length + 1) + ' file(s), all present in every locale');
});

/* ---- R7 (warn only) ---- */
rule('R7', 'i18n-unused', (r, ctx) => {
  if (!ctx.i18nRefs) return r.skip('reference collection did not run (see R6)');
  const ko = ctx.locales.ko && ctx.locales.ko.data;
  if (!ko) return r.skip('_locales/ko is unreadable (see R5)');
  const unused = Object.keys(ko).filter((k) => !ctx.i18nRefs.has(k)).sort();
  if (unused.length === 0) { r.note('every locale key is referenced'); return; }
  r.warn(unused.length + ' locale key(s) are never referenced by a literal (never fails the build)');
  r.detail('indirect reference possible — weapon and preset names are looked up as WEAPONS[x].name then msg(w.name),');
  r.detail('so a key listed here is NOT automatically dead code. Verify by hand before deleting any of them:');
  for (const k of unused) r.detail('  ' + k);
});

/* ---- R8 ---- */
rule('R8', 'forbidden-api-injected', (r, ctx) => {
  const rels = [];
  for (const f of ['content.js', 'background.js']) if (isFile(path.join(ctx.root, f))) rels.push(f);
  if (isDir(path.join(ctx.root, 'src'))) for (const x of walkRel(ctx.root, 'src', [])) if (/\.js$/.test(x)) rels.push(x);
  const hits = scanForbidden(ctx.root, rels, FORBIDDEN_INJECTED);
  for (const h of hits) {
    r.fail(h.rel + ':' + h.line + ':' + h.col + '  ' + h.label);
    r.detail('    ' + h.text);
  }
  if (!r.failed()) r.note(rels.length + ' file(s) clean across ' + FORBIDDEN_INJECTED.length + ' patterns');
});

/* ---- R9 ---- */
rule('R9', 'forbidden-api-extension-pages', (r, ctx) => {
  const dirs = ['options', 'share'].filter((d) => isDir(path.join(ctx.root, d)));
  if (dirs.length === 0) return r.skip('options/ and share/ do not exist yet (spec B2 / C6)');
  const rels = [];
  for (const d of dirs) for (const x of walkRel(ctx.root, d, [])) if (/\.(js|html)$/.test(x)) rels.push(x);
  const hits = scanForbidden(ctx.root, rels, FORBIDDEN_EXT_PAGES);
  for (const h of hits) {
    r.fail(h.rel + ':' + h.line + ':' + h.col + '  ' + h.label);
    r.detail('    ' + h.text);
  }
  if (!r.failed()) r.note(rels.length + ' extension-page file(s) clean across ' + FORBIDDEN_EXT_PAGES.length + ' patterns');
});

/* ---- R10 ---- */
rule('R10', 'settings-schema', (r, ctx) => {
  const p = path.join(ctx.root, 'settings-schema.json');
  if (!isFile(p)) return r.skip('settings-schema.json does not exist yet (spec B1)');
  let schema;
  try { schema = readJSON(p); } catch (e) { return r.fail('settings-schema.json did not parse: ' + e.message); }
  if (!Array.isArray(schema)) return r.fail('settings-schema.json must be an array');

  const TYPES = new Set(['bool', 'int', 'enum', 'string', 'number']);
  const seen = new Set();
  const localeKeys = {};
  for (const loc of Object.keys(ctx.locales)) {
    if (ctx.locales[loc].data) localeKeys[loc] = new Set(Object.keys(ctx.locales[loc].data));
  }

  schema.forEach((e, i) => {
    const at = 'settings-schema.json[' + i + ']';
    if (e === null || typeof e !== 'object' || Array.isArray(e)) return r.fail(at + ' is not an object');
    for (const f of ['key', 'type', 'default', 'labelKey', 'group']) {
      if (!Object.prototype.hasOwnProperty.call(e, f)) r.fail(at + ' is missing "' + f + '"');
    }
    if (typeof e.key !== 'string' || !e.key) return r.fail(at + ' has a non-string key');
    if (seen.has(e.key)) r.fail(at + ' duplicates key "' + e.key + '"');
    seen.add(e.key);
    if (!TYPES.has(e.type)) r.fail(at + ' (' + e.key + ') has unknown type "' + e.type + '"');

    if (e.type === 'enum') {
      if (!Array.isArray(e.options) || e.options.length === 0) r.fail(at + ' (' + e.key + ') type enum needs a non-empty options array');
      else if (e.options.indexOf(e.default) === -1) r.fail(at + ' (' + e.key + ') default ' + JSON.stringify(e.default) + ' is not in options');
    } else if (e.type === 'bool') {
      if (typeof e.default !== 'boolean') r.fail(at + ' (' + e.key + ') default must be a boolean');
    } else if (e.type === 'int') {
      if (!Number.isInteger(e.default)) r.fail(at + ' (' + e.key + ') default must be an integer');
      if (Number.isInteger(e.min) && e.default < e.min) r.fail(at + ' (' + e.key + ') default is below min');
      if (Number.isInteger(e.max) && e.default > e.max) r.fail(at + ' (' + e.key + ') default is above max');
    } else if (e.type === 'number') {
      if (typeof e.default !== 'number') r.fail(at + ' (' + e.key + ') default must be a number');
    } else if (e.type === 'string') {
      if (typeof e.default !== 'string') r.fail(at + ' (' + e.key + ') default must be a string');
    }

    for (const loc of Object.keys(localeKeys)) {
      if (typeof e.labelKey === 'string' && !localeKeys[loc].has(e.labelKey)) {
        r.fail(at + ' (' + e.key + ') labelKey "' + e.labelKey + '" is missing from _locales/' + loc);
      }
    }
  });
  if (!r.failed()) r.note(schema.length + ' setting(s) validated');
});

/* ---- R11 ---- */
rule('R11', 'icon-dimensions', (r, ctx) => {
  if (!ctx.manifest || !ctx.manifest.icons) return r.skip('manifest.icons is absent (see R1)');
  const icons = ctx.manifest.icons;
  for (const key of Object.keys(icons).sort((a, b) => Number(a) - Number(b))) {
    const want = Number(key);
    const rel = icons[key];
    const full = path.join(ctx.root, rel);
    if (!isFile(full)) { r.fail(rel + ' does not exist (also reported by R2)'); continue; }
    let h;
    try { h = pngIHDR(fs.readFileSync(full)); } catch (e) { r.fail(rel + ': ' + e.message); continue; }
    if (h.width !== want || h.height !== want) r.fail(rel + ' is ' + h.width + 'x' + h.height + ', manifest declares ' + want);
    if (h.depth !== 8) r.fail(rel + ' bit depth is ' + h.depth + ', expected 8');
    if (h.colorType !== 6) r.fail(rel + ' colour type is ' + h.colorType + ', expected 6 (RGBA)');
    if (!r.failed()) r.detail(rel.padEnd(22) + h.width + 'x' + h.height + '  depth ' + h.depth + '  colourType ' + h.colorType);
  }
  if (!r.failed()) r.note(Object.keys(icons).length + ' icon(s) match their declared size');
});

/* ---- R12 ---- */
rule('R12', 'generated-header', (r, ctx) => {
  if (!isFile(path.join(ctx.root, 'src/modules.json'))) {
    return r.skip('src/ does not exist; content.js is still the authored file (spec A2 pending)');
  }
  const p = path.join(ctx.root, 'content.js');
  if (!isFile(p)) return r.fail('content.js does not exist');
  const head = readText(p).slice(0, 400);
  if (!/DO NOT EDIT\s*[—-]\s*generated from src\/ by tools\/build\.js/.test(head)) {
    r.fail('content.js is missing the generated header — it looks hand-edited');
    r.detail('expected near the top: DO NOT EDIT — generated from src/ by tools/build.js');
  } else r.note('generated header present');
});

/* ---- R13 ---- */
rule('R13', 'module-manifest', (r, ctx) => {
  const mj = path.join(ctx.root, 'src/modules.json');
  if (!isFile(mj)) return r.skip('src/modules.json does not exist yet (spec A2)');
  let doc;
  try { doc = readJSON(mj); } catch (e) { return r.fail('src/modules.json did not parse: ' + e.message); }
  const list = Array.isArray(doc) ? doc : doc.modules;
  if (!Array.isArray(list)) return r.fail('src/modules.json has no `modules` array');
  const listed = new Set(list);
  for (const name of list) {
    if (!isFile(path.join(ctx.root, 'src', name))) r.fail('src/modules.json lists "' + name + '" but src/' + name + ' does not exist');
  }
  for (const rel of walkRel(ctx.root, 'src', [])) {
    if (!/\.js$/.test(rel)) continue;
    const name = rel.slice('src/'.length);
    if (!listed.has(name)) r.fail('src/' + name + ' exists but is not listed in src/modules.json');
  }
  if (r.failed()) return;

  /* The number in a module's file name is its place in the load order. Two modules sharing a number leave
   * their order to a string sort of the names, which a rename silently flips; so every number is unique and
   * the list is in ascending numeric order. A sub-slot is written 88.5-name.js — '.' sorts after '-', so a
   * plain sort of the file names also reproduces the list, whichever way someone looks at it. */
  const num = (name) => { const m = /^(\d+(?:\.\d+)?)-/.exec(name); return m ? parseFloat(m[1]) : null; };
  const owner = new Map();
  let prev = null;
  for (const name of list) {
    const n = num(name);
    if (n === null) { r.fail('src/' + name + ' has no leading load-order number (expected NN-name.js or NN.N-name.js)'); continue; }
    if (owner.has(n)) r.fail('load-order number ' + n + ' is used by both ' + owner.get(n) + ' and ' + name);
    else owner.set(n, name);
    if (prev !== null && n < prev.n) r.fail(name + ' (' + n + ') is listed after ' + prev.name + ' (' + prev.n + '): numbers must ascend along src/modules.json');
    prev = { n, name };
  }
  const sorted = list.slice().sort();
  const flip = list.findIndex((name, i) => name !== sorted[i]);
  if (flip !== -1) r.fail('src/modules.json order differs from a plain sort of the file names at position ' + (flip + 1) + ' (' + list[flip] + ' vs ' + sorted[flip] + ')');
  if (!r.failed()) r.note(list.length + ' module(s), list and directory agree; load-order numbers are unique and ascending, and match a plain sort of the names');
});

/* ---- R14 ---- */
rule('R14', 'changelog-section', (r, ctx) => {
  const p = path.join(ctx.root, 'CHANGELOG.md');
  if (!isFile(p)) {
    r.fail('CHANGELOG.md does not exist');
    r.detail('spec A10 — seed it in Keep a Changelog format with 1.0.0 / 1.1.0 / 1.2.0');
    return;
  }
  if (!ctx.version) return r.skip('no version could be determined (see R3)');
  const text = readText(p);
  const re = new RegExp('^## \\[?' + ctx.version.replace(/\./g, '\\.') + '\\]? ', 'm');
  if (!re.test(text)) {
    r.fail('CHANGELOG.md has no "## [' + ctx.version + '] …" section');
    const heads = text.split(/\r?\n/).filter((l) => /^## /.test(l)).slice(0, 6);
    for (const h of heads) r.detail('found heading: ' + h);
  } else r.note('section for ' + ctx.version + ' present (version read from ' + ctx.versionSource + ')');
});

/* ---- R15 ---- */
rule('R15', 'ship-list-complete', (r, ctx) => {
  const { files, missing } = collectShipFiles(ctx.root);
  for (const spec of missing) {
    if (spec.optional) r.note('optional, absent: ' + spec.rel + (spec.note ? ' — ' + spec.note : ''));
    else r.fail('required ship path missing: ' + spec.rel);
  }
  if (!r.failed()) r.note(files.length + ' file(s) would be packaged');
});

/* ---- R16 ---- */
rule('R16', 'text-hygiene', (r, ctx) => {
  const EXT = /\.(js|json|css|md|ya?ml)$/i;
  let checked = 0;
  for (const rel of ctx.allFiles) {
    if (!EXT.test(rel)) continue;
    checked++;
    const buf = fs.readFileSync(path.join(ctx.root, rel));
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      r.fail(rel + ': UTF-8 BOM at offset 0');
    }
    const crlf = buf.indexOf('\r\n');
    if (crlf !== -1) {
      const line = buf.subarray(0, crlf).toString('utf8').split('\n').length;
      r.fail(rel + ':' + line + ': CRLF line ending');
    }
  }
  if (!r.failed()) r.note(checked + ' text file(s) are BOM-free and LF-only');
});


/* ===================================================================== */
/* 6b. SPEC-weapon-identity §G — 무기 그림이 읽히는가                      */
/* ===================================================================== */

/* ---- 아주 작은 자유 변수 스캐너 (R17) ------------------------------------------------------------
 * 파서를 들이지 않는다 — 이 도구의 규칙이 "의존성 0" 이다. 대신 세 단계로 어림한다:
 *   1) 주석 · 문자열 · 정규식 리터럴을 지운다 (식별자가 아닌 글자를 식별자로 세지 않기 위해)
 *   2) 그 파일 안에서 **선언된** 이름을 전부 모은다 (const/let/var 의 모든 선언자, 함수 이름과
 *      매개변수, 화살표 매개변수, catch, class, 객체 메서드 축약형)
 *   3) 나머지 중 JS 내장이 아닌 것이 자유 변수다
 * 선언 쪽을 **넉넉히** 모으는 방향으로 틀리므로(어느 스코프에서든 선언된 이름은 선언으로 친다)
 * 거짓 양성이 나지 않는다 — 이 검사는 "아트가 새 전역을 쓰기 시작했다" 를 잡으려는 것이고,
 * 그 경우 그 이름은 파일 어디에도 선언되어 있지 않다. 7단계의 `DEG` 가 바로 그 모양이었다. */
const FV_ID = '[A-Za-z_$][A-Za-z0-9_$]*';

function fvStripLiterals(src) {
  let out = '', i = 0, prev = '';
  const n = src.length;
  while (i < n) {
    const ch = src[i], nx = src[i + 1];
    if (ch === '/' && nx === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (ch === '/' && nx === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; } i += 2; out += ' '; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch; i++;
      let inner = '';
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        /* 템플릿 치환부는 코드다. 지우면 그 안의 자유 변수를 놓친다. */
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          i += 2;
          let depth = 1;
          const start = i;
          while (i < n && depth > 0) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; if (depth > 0) i++; }
          inner += '+(' + fvStripLiterals(src.slice(start, i)) + ')+';
          i++;
          continue;
        }
        if (src[i] === q) { i++; break; }
        if (src[i] === '\n') inner += '\n';
        i++;
      }
      out += '0' + inner + '0'; prev = '0';
      continue;
    }
    if (ch === '/' && /[=(,:[!&|?{;+\-*%~^<>]/.test(prev)) {        // 정규식 리터럴
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') { while (i < n && src[i] !== ']') { if (src[i] === '\\') i++; i++; } }
        if (src[i] === '/') { i++; break; }
        if (src[i] === '\n') break;
        i++;
      }
      while (i < n && /[a-z]/.test(src[i])) i++;
      out += '0'; prev = '0';
      continue;
    }
    out += ch;
    if (!/\s/.test(ch)) prev = ch;
    i++;
  }
  return out;
}

/** `const a = 1, [b, c] = xs;` 의 선언자 머리들. 깊이 0 의 쉼표에서 끊고 `=` 앞만 읽는다. */
function fvDeclaratorNames(code, from) {
  const names = [];
  let depth = 0, i = from, head = '', eating = true;
  const push = () => { for (const m of head.matchAll(new RegExp(FV_ID, 'g'))) names.push(m[0]); head = ''; };
  while (i < code.length) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
    else if (depth === 0 && c === ';') break;
    else if (depth === 0 && c === ',') { push(); eating = true; i++; continue; }
    else if (depth === 0 && c === '=' && code[i + 1] !== '=' && !'=!<>'.includes(code[i - 1])) { push(); eating = false; i++; continue; }
    else if (depth === 0 && c === '\n' && eating && /^\s*(?:const|let|var|return|if|for|while|function|})/.test(code.slice(i + 1, i + 40))) break;
    if (eating && depth <= 1) head += c;
    i++;
  }
  push();
  return names;
}

function fvDeclared(code, topLevelOnly) {
  const d = new Set();
  const add = (s) => { for (const m of String(s).matchAll(new RegExp(FV_ID, 'g'))) d.add(m[0]); };
  const declRe = topLevelOnly ? /^ {0,2}(?:const|let|var)\s/gm : /\b(?:const|let|var)\s/g;
  for (const m of code.matchAll(declRe)) for (const nm of fvDeclaratorNames(code, m.index + m[0].length)) d.add(nm);
  const fnRe = topLevelOnly
    ? new RegExp('^ {0,2}function\\s*\\*?\\s*(' + FV_ID + ')?\\s*\\(([^)]*)\\)', 'gm')
    : new RegExp('\\bfunction\\s*\\*?\\s*(' + FV_ID + ')?\\s*\\(([^)]*)\\)', 'g');
  for (const m of code.matchAll(fnRe)) { if (m[1]) d.add(m[1]); if (!topLevelOnly) add(m[2] || ''); }
  if (topLevelOnly) return d;
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) add(m[1]);
  for (const m of code.matchAll(new RegExp('(?:^|[^.\\w$])(' + FV_ID + ')\\s*=>', 'gm'))) d.add(m[1]);
  for (const m of code.matchAll(new RegExp('\\bcatch\\s*\\(\\s*(' + FV_ID + ')', 'g'))) d.add(m[1]);
  for (const m of code.matchAll(new RegExp('\\bclass\\s+(' + FV_ID + ')', 'g'))) d.add(m[1]);
  /* 객체 리터럴의 메서드 축약형: `mat(name, dir) {` — 이름도 매개변수도 선언이다 */
  for (const m of code.matchAll(new RegExp('(?:^|[,{])\\s*(?:get\\s+|set\\s+|async\\s+)?(' + FV_ID + ')\\s*\\(([^)]*)\\)\\s*\\{', 'gm'))) { d.add(m[1]); add(m[2] || ''); }
  return d;
}

const FV_GLOBALS = new Set(['Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'JSON', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Promise', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'Symbol', 'Infinity', 'NaN', 'undefined', 'this', 'arguments',
  'window', 'document', 'console', 'parseInt', 'parseFloat', 'isFinite', 'isNaN', 'Intl', 'URL', 'Blob', 'Image', 'CSS',
  'performance', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'getComputedStyle', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'CustomEvent', 'Event',
  'Node', 'Element', 'HTMLElement', 'SVGElement', 'DOMParser', 'TextEncoder', 'TextDecoder', 'Uint8Array', 'Float32Array',
  'ArrayBuffer', 'chrome', 'globalThis', 'structuredClone', 'KeyboardEvent', 'PointerEvent', 'AbortController', 'Function',
  'Proxy', 'Reflect', 'BigInt']);
const FV_KEYWORDS = new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
  'break', 'continue', 'new', 'typeof', 'instanceof', 'delete', 'in', 'of', 'try', 'catch', 'finally', 'throw', 'class',
  'extends', 'super', 'yield', 'await', 'async', 'void', 'default', 'export', 'import', 'from', 'as', 'static', 'get', 'set',
  'true', 'false', 'null']);

function fvFree(code) {
  const decl = fvDeclared(code, false);
  const out = [];
  const re = new RegExp('(\\.\\s*)?\\b(' + FV_ID + ')\\b\\s*(:)?', 'g');
  const seen = new Set();
  let m;
  while ((m = re.exec(code))) {
    if (m[1]) continue;                                  // 멤버 접근
    if (m[3]) {                                          // 객체 리터럴 키
      const before = code.slice(Math.max(0, m.index - 60), m.index).replace(/\s+$/, '');
      const c = before[before.length - 1];
      if (c === '{' || c === ',' || c === undefined) continue;
    }
    const name = m[2];
    if (seen.has(name) || decl.has(name) || FV_GLOBALS.has(name) || FV_KEYWORDS.has(name)) continue;
    seen.add(name);
    out.push({ name, line: code.slice(0, m.index).split('\n').length });
  }
  return out;
}

/* ---- R17 ---- */
/* SPEC-weapon-identity §G3: "아트가 빌려 쓰는 전역을 시트의 심에 넣고, R17 로 아트 모듈의 자유 변수가
 * 전부 시트 심 또는 prelude 에 있는지 검사한다. 도구가 다시 죽으면 CI 가 잡는다."
 *
 * 왜 이 규칙이 있나: 7단계가 미니건 아트에 prelude 의 `DEG` 를 쓰면서 tools/weapon-sheet.js 가
 * `DEG is not defined` 로 죽었고, **그 뒤로 무기 그림을 눈으로 본 사람이 없다** — 그 사이 무기가
 * 12종에서 23종이 됐고 11종은 한 번도 검수되지 않았다(§G1). 그림을 보는 도구가 조용히 죽는 것이
 * 그림이 안 읽히는 것보다 먼저 온 사고다. */
rule('R17', 'weapon-art-free-vars', (r, ctx) => {
  const artRel = 'src/44-weapon-art.js', sheetRel = 'tools/weapon-sheet.js', preludeRel = 'src/00-prelude.js';
  for (const rel of [artRel, sheetRel, preludeRel]) {
    if (!isFile(path.join(ctx.root, rel))) { r.skip(rel + ' does not exist'); return; }
  }
  const sheet = readText(path.join(ctx.root, sheetRel));
  const start = sheet.indexOf('const SHIM =');
  const end = sheet.indexOf('function bootSource', start < 0 ? 0 : start);
  if (start < 0 || end < 0) { r.fail(sheetRel + ': could not find the `const SHIM = …` block'); return; }
  const shim = new Set();
  for (const m of sheet.slice(start, end).matchAll(new RegExp('\\bconst\\s+(' + FV_ID + ')', 'g'))) shim.add(m[1]);
  shim.delete('SHIM');
  const prelude = fvDeclared(fvStripLiterals(readText(path.join(ctx.root, preludeRel))), true);
  const free = fvFree(fvStripLiterals(readText(path.join(ctx.root, artRel))));
  const missing = free.filter((f) => !shim.has(f.name) && !prelude.has(f.name));
  for (const f of missing) {
    r.fail(artRel + ':' + f.line + ': `' + f.name + '` is neither in the sheet shim (' + sheetRel + ') nor declared at the top level of ' + preludeRel
      + ' — tools/weapon-sheet.js will die on it (that is how §G1 happened)');
  }
  if (!r.failed()) {
    r.note(free.length + ' free variable(s) in ' + artRel + ', all covered (shim ' + shim.size + ', prelude ' + prelude.size + ')');
    r.detail('free: ' + free.map((f) => f.name).sort().join(' '));
  }
});

/* ---- R18 ---- */
/* SPEC-weapon-identity §G4: "아이콘 48×48 을 실제로 래스터화해 쌍마다 비교한다. 실루엣 차이는 알파
 * 채널의 자카드 거리가 0.18 이상, 색 차이는 평균 색조·채도·명도 벡터의 거리가 0.12 이상. 둘 다
 * 밑돌면 그 쌍은 실패. 어느 쌍인지 이름으로 말한다."
 *
 * 왜 래스터인가: 아트 검사(SPEC-weapon-art §9)는 요소 수 · 그라데이션 · 획 · 팔레트를 본다. 그 전부를
 * 통과하면서도 48 px 에서 똑같은 회색 덩어리일 수 있다 — §G2 가 찾은 것이 정확히 그것이다. **구별은
 * 픽셀에서만 증명된다.**
 *
 * 색 거리의 해석 (보고에 적었다): "색조·채도·명도 벡터" 를 (h, s, v) 세 숫자로 그대로 읽으면 회색의
 * 색조(정의되지 않는 값)가 거리에 섞이고 359° 와 1° 가 가장 먼 색이 된다. 그래서 HSV **원뿔** 좌표
 * (s·v·cos h, s·v·sin h, v) 로 읽는다 — 채도가 0 이면 색조가 거리에 아무 영향을 주지 않는다는,
 * "회색끼리는 밝기로만 구별된다" 는 그 문장의 뜻 그대로다.
 *
 * 래스터는 tools/weapon-sheet.js --r18 이 굽는다(puppeteer 가 필요하고 이 파일은 의존성이 0 이다).
 * 그 도구가 puppeteer 를 못 찾으면 exit 2 를 돌려주고, 여기서는 FAIL 이 아니라 SKIP 이다. */
const R18_SILHOUETTE_MIN = 0.18;
const R18_COLOUR_MIN = 0.12;
const R18_ALPHA = 128;            // 이 이상이면 그 픽셀은 그림이다 (가장자리 안티앨리어싱의 절반)

function rgbToHsvCone(r, g, b) {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === rr) h = ((gg - bb) / d) % 6;
    else if (mx === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = mx <= 0 ? 0 : d / mx;
  const rad = h * Math.PI / 180;
  return [s * mx * Math.cos(rad), s * mx * Math.sin(rad), mx];
}

/* §G4 는 48×48 을 적었지만 **HUD 가 실제로 그리는 크기는 26×26** 이다(실측: 버튼 65×32 안의
 * svg 26×26). 검사가 보는 크기와 사용자가 보는 크기가 다르면 그 사이에서 그림이 밀린다 —
 * 그래서 두 크기를 다 본다. 48 은 아이콘 LOD 가 설계된 크기, 26 은 사용자가 실제로 보는 크기다. */
const R18_SIZES = [48, 26];

rule('R18', 'weapon-icon-distinct', (r, ctx) => {
  const sheetRel = 'tools/weapon-sheet.js';
  if (!isFile(path.join(ctx.root, sheetRel))) { r.skip(sheetRel + ' does not exist'); return; }
  let skipped = null;
  for (const px of R18_SIZES) {
    let failedHere = false;
    const SKIP = (m) => { skipped = m; };
    const FAIL = (m) => { failedHere = true; r.fail(m); };
    const NOTE = (m) => r.note(m);
    const DETAIL = (m) => r.detail(m);
      const res = require('child_process').spawnSync(process.execPath, [path.join(ctx.root, sheetRel), '--r18', '--r18-px=' + px],
        { cwd: ctx.root, encoding: 'utf8', timeout: 120000 });
      if (res.status === 2) { SKIP('puppeteer is not installed — ' + sheetRel + ' --r18 cannot rasterise (npm install)'); return; }
      if (res.status !== 0) {
        FAIL(sheetRel + ' --r18 exited ' + res.status + ': ' + String(res.stderr || res.error || '').trim().split('\n').slice(0, 3).join(' / '));
        return;
      }
      let meta;
      try { meta = JSON.parse(String(res.stdout).trim().split('\n').pop()); }
      catch (e) { FAIL(sheetRel + ' --r18 printed something that is not JSON: ' + String(res.stdout).slice(0, 160)); return; }
      const png = path.join(ctx.root, meta.path);
      if (!isFile(png)) { FAIL('the raster was not written: ' + meta.path); return; }
      const img = pngPixels(fs.readFileSync(png));
      const cell = meta.cell, ids = meta.ids;
      if (img.height !== cell || img.width !== cell * ids.length) {
        FAIL('raster is ' + img.width + '×' + img.height + ', expected ' + (cell * ids.length) + '×' + cell);
        return;
      }
      const tiles = ids.map((id, i) => {
        const x0 = i * cell;
        const mask = new Uint8Array(cell * cell);
        let n = 0, cx = 0, cy = 0, cv = 0;
        for (let y = 0; y < cell; y++) {
          for (let x = 0; x < cell; x++) {
            const o = (y * img.width + (x0 + x)) * 4;
            if (img.data[o + 3] < R18_ALPHA) continue;
            mask[y * cell + x] = 1;
            n++;
            const c = rgbToHsvCone(img.data[o], img.data[o + 1], img.data[o + 2]);
            cx += c[0]; cy += c[1]; cv += c[2];
          }
        }
        return { id, mask, n, c: n ? [cx / n, cy / n, cv / n] : [0, 0, 0] };
      });
      /* 아무것도 안 그려진 아이콘은 쌍 비교 이전의 실패다 — 빈 타일끼리는 자카드 거리가 0 이라
       * "둘 다 비어 있다" 가 "둘이 똑같다" 로 조용히 통과할 수도 있다. */
      for (const t of tiles) if (t.n < 16) FAIL('`' + t.id + '` icon covers only ' + t.n + ' px at ' + cell + '×' + cell + ' — it is effectively blank');
      let worst = null;
      const fails = [];
      for (let i = 0; i < tiles.length; i++) {
        for (let j = i + 1; j < tiles.length; j++) {
          const a = tiles[i], b = tiles[j];
          let inter = 0, uni = 0;
          for (let k = 0; k < a.mask.length; k++) { const p = a.mask[k], q = b.mask[k]; if (p && q) inter++; if (p || q) uni++; }
          const sil = uni ? 1 - inter / uni : 0;
          let s2 = 0;
          for (let k = 0; k < 3; k++) { const d = a.c[k] - b.c[k]; s2 += d * d; }
          const col = Math.sqrt(s2);
          /* 통과 여유: 두 문턱 중 **더 많이 넘은 쪽**이 그 쌍을 구해 준다(둘 다 밑돌아야 실패이므로). */
          const margin = Math.max(sil / R18_SILHOUETTE_MIN, col / R18_COLOUR_MIN);
          if (!worst || margin < worst.margin) worst = { a: a.id, b: b.id, sil, col, margin };
          if (sil < R18_SILHOUETTE_MIN && col < R18_COLOUR_MIN) fails.push({ a: a.id, b: b.id, sil, col });
        }
      }
      for (const f of fails) {
        FAIL('`' + f.a + '` and `' + f.b + '` are not told apart at ' + cell + '×' + cell
          + ' — silhouette ' + f.sil.toFixed(3) + ' (need ' + R18_SILHOUETTE_MIN + ') AND colour ' + f.col.toFixed(3) + ' (need ' + R18_COLOUR_MIN + ')');
      }
      if (!failedHere) {
        const pairs = tiles.length * (tiles.length - 1) / 2;
        NOTE(pairs + ' icon pair(s) of ' + tiles.length + ' weapons are distinguishable at ' + cell + '×' + cell);
        if (worst) DETAIL('closest pair: ' + worst.a + ' / ' + worst.b + ' — silhouette ' + worst.sil.toFixed(3) + ', colour ' + worst.col.toFixed(3) + ' (' + worst.margin.toFixed(2) + '× the threshold it passes on)');
      }
    if (skipped) { r.skip(skipped); return; }
  }
});

/* ===================================================================== */
/* 6c. Korean fallback table + bundle size budget                         */
/* ===================================================================== */

/* ---- R19 ----
 * content.js carries a Korean fallback table for pages and harnesses without chrome.i18n. The strings are
 * GENERATED from _locales/ko/messages.json by tools/build.js (the keys come from src/ko-fallback-keys.json),
 * so the product has one Korean source, not two. build.js --check already catches a stale content.js as a
 * byte diff; this rule says WHY in terms of the locale, and also guards the source side: no hand-typed
 * Hangul string may creep back into src/10-util.js. */
rule('R19', 'ko-fallback-generated', (r, ctx) => {
  if (!isFile(path.join(ctx.root, 'src/modules.json'))) return r.skip('src/ does not exist; content.js is still the authored file');
  const utilRel = 'src/10-util.js';
  const util = isFile(path.join(ctx.root, utilRel)) ? readText(path.join(ctx.root, utilRel)) : '';
  const marker = build.KO_MARKER;
  const markerCount = util.split(marker).length - 1;
  if (markerCount !== 1) {
    return r.fail(utilRel + ' must contain the ' + marker + ' marker exactly once (found ' + markerCount + ')');
  }

  /* no Hangul inside a non-comment line of the util module: the strings belong to the locale */
  const lines = util.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (commentOnly(lines[i])) continue;
    const m = /[\u3131-\u318E\uAC00-\uD7A3]/.exec(lines[i]);
    if (m) r.fail(utilRel + ':' + (i + 1) + ': a Korean string is typed by hand here; it belongs in _locales/ko/messages.json (' + lines[i].trim().slice(0, 60) + ')');
  }

  let literal, keys;
  try { keys = build.koFallbackKeys(ctx.root); literal = build.koFallbackLiteral(ctx.root); }
  catch (e) { return r.fail(e.message); }

  const cjs = path.join(ctx.root, 'content.js');
  if (!isFile(cjs)) return r.fail('content.js does not exist');
  const built = readText(cjs);
  if (built.indexOf(marker) !== -1) r.fail('content.js still contains the unresolved ' + marker + ' marker (run node tools/build.js)');
  else if (built.indexOf(literal) === -1) {
    r.fail('content.js carries a Korean fallback table that does not match _locales/ko/messages.json');
    r.detail('run node tools/build.js — the table is generated, never edited');
    const ko = ctx.locales.ko && ctx.locales.ko.data;
    const bad = keys.filter((k) => ko && ko[k] && built.indexOf(JSON.stringify(ko[k].message)) === -1);
    for (const k of bad.slice(0, 10)) r.detail('    stale or missing text for "' + k + '"');
    if (bad.length > 10) r.detail('    … and ' + (bad.length - 10) + ' more');
  }
  if (r.failed()) return;

  const refs = ctx.i18nRefs;
  const keySet = new Set(keys);
  const uncovered = refs ? [...refs.keys()].filter((k) => !keySet.has(k) && ctx.locales.ko && ctx.locales.ko.data && Object.prototype.hasOwnProperty.call(ctx.locales.ko.data, k)) : [];
  r.note(keys.length + ' fallback key(s) generated from _locales/ko, content.js matches the locale');
  if (refs) r.detail(uncovered.length + ' other literal msg() key(s) have no built-in Korean fallback (not generated; unchanged by this rule)');
});

/* ---- R20 ----
 * content.js is injected into arbitrary pages and content.css rides along with it. Nothing used to look at
 * their size. The ceilings are about 1.35x the size at the time they were set (content.js 1187 KB,
 * content.css 81 KB): they should not ring often, but they ring well before the bundle doubles. The current
 * value and the room left are printed on every run, pass or fail, so whoever grows it can see the number. */
const BUDGETS = [
  { rel: 'content.js',  limitKB: 1600 },
  { rel: 'content.css', limitKB: 200 },
];
rule('R20', 'bundle-size-budget', (r, ctx) => {
  let any = false;
  for (const b of BUDGETS) {
    const p = path.join(ctx.root, b.rel);
    if (!isFile(p)) { r.detail(b.rel.padEnd(12) + 'absent — nothing to measure (see R2)'); continue; }
    any = true;
    const bytes = fs.statSync(p).size;
    const kb = bytes / 1024;
    const left = b.limitKB - kb;
    const line = b.rel.padEnd(12) + kb.toFixed(1).padStart(7) + ' KB of ' + b.limitKB + ' KB budget  ('
      + (left >= 0 ? left.toFixed(1) + ' KB left, ' + (100 * kb / b.limitKB).toFixed(0) + '% used' : (-left).toFixed(1) + ' KB OVER') + ')';
    if (left < 0) r.fail(line);
    else r.detail(line);   // detail, not note: a FAIL prints details too, so the passing file still shows its number
  }
  if (!any) r.skip('neither content.js nor content.css exists');
});

/* ===================================================================== */
/* 6d. 출시 차단 · 제품 정체성 · 스키마 대조 · 이름 충돌 (R21~R24)         */
/* ===================================================================== */

/* `_locales/<loc>/messages.json` 전부. ctx.locales 는 ko·en 둘만 담는데(R5 가 그 둘의 parity 를 본다),
 * R21 과 R22 는 로케일이 하나 늘어도 같이 따라가야 한다 — 크롬은 로케일마다 **다른** 문자열을 읽으므로
 * 한 로케일만 상한을 넘어도 그 로케일로 올릴 때 거부된다. 그래서 디렉터리를 직접 센다.
 * 못 읽는 파일은 건너뛰고 이유를 적는다(파싱 실패 자체는 R5 가 말한다). */
function localeMessageFiles(root) {
  const dir = path.join(root, '_locales');
  if (!isDir(dir)) return [];
  const out = [];
  for (const loc of fs.readdirSync(dir).sort()) {
    const rel = '_locales/' + loc + '/messages.json';
    if (!isFile(path.join(root, rel))) continue;
    let data = null, error = null;
    try { data = readJSON(path.join(root, rel)); } catch (e) { error = e.message; }
    out.push({ loc, rel, data, error });
  }
  return out;
}

/* ---- R21 ----
 * 크롬 웹스토어는 매니페스트 `description` 이 상한을 넘으면 심사가 아니라 **업로드 단계에서**
 * `The description field in manifest is too long` 으로 거부한다. `name` 에도 같은 종류의 상한이 있다.
 *
 * 왜 이 규칙이 생겼나: 전체 검토(docs/review/00-종합.md B1)가 `appDesc` 를 ko 174자 · en 242자로 찾았다.
 * **출시 블로커**였는데 스무 개 규칙 중 길이를 보는 것이 하나도 없었다. 제품은 다 만들어 놓고
 * 업로드 버튼에서 막히는 종류의 결함이고, 검사 한 줄이면 영영 안 돌아온다.
 *
 * 무엇을 세는가 — **코드포인트**(`[...s].length`)다. UTF-8 바이트로 세면 한글은 글자당 3바이트라
 * 132바이트가 44자가 되고, 그 상한으로는 한국어 설명문을 쓸 수가 없다. 크롬이 말하는 132는 문자 수다.
 * UTF-16 코드 단위(`s.length`)와는 이모지(서로게이트 쌍)가 섞일 때만 갈리는데 이 문구들에는 이모지가
 * 없어 결과가 같고, 코드포인트 쪽이 "글자"라는 말에 더 가깝다. 실패했을 때는 세 가지 수를 다 찍어
 * 사람이 직접 판단할 수 있게 한다.
 *
 * `description` 이 `__MSG_<key>__` 꼴이면 **모든 로케일**의 그 키를 본다. */
const MANIFEST_TEXT_LIMITS = [
  { field: 'description', max: 132 },   // 넘으면 업로드가 거부된다
  { field: 'name',        max: 45 },    // 매니페스트 이름의 상한
];

rule('R21', 'manifest-text-length', (r, ctx) => {
  if (!ctx.manifest) return r.skip('manifest.json did not parse (see R1)');
  const locales = localeMessageFiles(ctx.root);
  const rows = [];
  for (const lim of MANIFEST_TEXT_LIMITS) {
    const raw = ctx.manifest[lim.field];
    if (typeof raw !== 'string' || !raw) { r.detail(lim.field.padEnd(12) + 'absent from manifest.json — nothing to measure'); continue; }
    const key = (/^__MSG_([A-Za-z0-9_@]+)__$/.exec(raw) || [])[1];
    const where = [];
    if (key) {
      for (const L of locales) {
        if (!L.data) { r.detail(L.rel + ' is unreadable (' + L.error + ') — ' + lim.field + ' not measured there (see R5)'); continue; }
        const e = L.data[key];
        if (!e || typeof e.message !== 'string') { r.detail(L.rel + ' has no "' + key + '" — ' + lim.field + ' not measured there (see R5 / R6)'); continue; }
        where.push({ at: '_locales/' + L.loc + ' "' + key + '"', text: e.message });
      }
      if (where.length === 0) r.fail('manifest ' + lim.field + ' is ' + raw + ' but no locale defines "' + key + '" — its length cannot be checked');
    } else {
      where.push({ at: 'manifest.json ' + lim.field, text: raw });
    }
    for (const w of where) {
      const cp = [...w.text].length;
      rows.push({ field: lim.field, at: w.at, cp, max: lim.max });
      if (cp <= lim.max) continue;
      r.fail(w.at + ' is ' + cp + ' characters — the manifest ' + lim.field + ' takes at most ' + lim.max
        + ' (' + (cp - lim.max) + ' over); Chrome rejects the UPLOAD, not the review');
      r.detail('    code points ' + cp + ', UTF-16 units ' + w.text.length + ', UTF-8 bytes ' + Buffer.byteLength(w.text, 'utf8')
        + ' — this rule counts code points');
      r.detail('    ' + JSON.stringify([...w.text].slice(0, 60).join('')) + (cp > 60 ? ' …' : ''));
    }
  }
  for (const row of rows) {
    r.detail(row.field.padEnd(12) + row.at.padEnd(26) + String(row.cp).padStart(4) + ' / ' + row.max + ' characters');
  }
  if (!r.failed() && rows.length) {
    const worst = rows.slice().sort((a, b) => (b.cp / b.max) - (a.cp / a.max))[0];
    r.note(rows.length + ' manifest string(s) measured, the tightest is ' + worst.at + ' at ' + worst.cp + ' of ' + worst.max + ' characters');
  }
});

/* ---- R22 ----
 * docs/specs/material.md 가 "HUD 힌트, 스토어 설명, 로케일에서 '유리판' 은유를 전부 걷어낸다" 고
 * 지시했는데 1년 가까이 이행되지 않고 README.md:3 과 `appDesc` 에 남아 있었다(docs/review/00-종합.md F3).
 * 12단계가 HUD 문구(`화면을 부수세요` → `요소를 부수세요`)를 고치면서 **같은 결함이 바깥에 그대로 남은**
 * 것은 명세의 완료 검사가 로케일만 봤기 때문이다. 그래서 이 규칙은 사용자에게 보이는 텍스트를 한자리에서
 * 본다 — 로케일 전부 · README.md · manifest.json.
 *
 * 왜 fail 인가(R7 처럼 warn 이 아니라): 목록이 두 낱말뿐이고 둘 다 폐기된 모델을 **직접** 가리킨다.
 * R7 이 warn 인 것은 "안 쓰이는 것처럼 보이지만 간접 참조일 수 있다" 는 진짜 불확실성 때문인데
 * 여기에는 그 불확실성이 없다. 그리고 warn 으로 두면 또 1년을 간다 — 그게 이 결함의 이력이다. */

/* 폐기된 제품 모델을 가리키는 말. **좁게** 잡는다 — 유리는 여전히 재질 5종 중 하나이고
 * (docs/specs/material.md), "유리 균열" 같은 무기·재질 설명은 정당하다. 금지하는 것은 재질이 아니라
 * **"페이지 전체가 유리판"** 이라는 은유뿐이다. 거짓 양성이 나오면 고치는 방법은 그 말을 목록에서 빼거나
 * 더 좁히는 것이지 규칙을 끄는 것이 아니다. 패턴에 `g` 를 달지 않는다(FORBIDDEN_INJECTED 와 같은 이유 —
 * `lastIndex` 가 호출 사이에 남는다). */
const IDENTITY_BANNED = [
  { re: /유리판/,        why: '폐기된 "페이지 = 유리판" 모델. 이 제품은 화면이 아니라 요소를 부순다 (CLAUDE.md 1행)' },
  { re: /glass\s+pane/i, why: 'the retired "the page is a pane of glass" model — the English half of 유리판' },
];

rule('R22', 'product-identity-terms', (r, ctx) => {
  const hits = [];
  const scanLine = (where, text) => {
    for (const b of IDENTITY_BANNED) {
      const m = b.re.exec(text);
      if (m) hits.push({ where, term: m[0], why: b.why, text: text.trim().slice(0, 100) });
    }
  };
  let scanned = 0;

  for (const L of localeMessageFiles(ctx.root)) {
    if (!L.data) { r.detail(L.rel + ' is unreadable (' + L.error + ') — not scanned (see R5)'); continue; }
    for (const k of Object.keys(L.data)) {
      const e = L.data[k];
      if (!e || typeof e.message !== 'string') continue;      // 모양 문제는 R5 가 말한다
      scanned++;
      scanLine(L.rel + ' "' + k + '"', e.message);
    }
  }
  for (const rel of ['README.md', 'manifest.json']) {
    const full = path.join(ctx.root, rel);
    if (!isFile(full)) { r.detail(rel + ' does not exist — not scanned'); continue; }
    const lines = readText(full).split(/\r?\n/);
    scanned += lines.length;
    for (let i = 0; i < lines.length; i++) scanLine(rel + ':' + (i + 1), lines[i]);
  }

  for (const h of hits) {
    r.fail(h.where + ': "' + h.term + '" — ' + h.why);
    r.detail('    ' + h.text);
  }
  if (!r.failed()) r.note(scanned + ' user-visible string(s) / line(s) carry none of the ' + IDENTITY_BANNED.length + ' retired-model terms');
});

/* ---- R23 ----
 * R10 은 스키마의 **내부** 정합성만 본다 — 기본값이 options 안에 있는가, labelKey 가 로케일에 있는가.
 * 그래서 `defaultWeapon` 의 options 가 v1.3 의 10종 모델에 멈춰 있는 동안 무기고가 23종으로 자라도
 * 아무도 울지 않았고, **13종은 기본 무기로 지정할 수 없었다**(docs/review/00-종합.md F8).
 * 이 규칙은 스키마를 제품 쪽 진실과 대조한다.
 *
 * src/ 는 하나의 클로저로 합쳐지는 조각들이라 require 로 못 읽는다. 무기고(WEAPON_IDS)와
 * 프리셋(PRESETS)은 tools/balance.js 의 readArsenal() 을 **그대로 쓴다** — 같은 정적 파싱을 두 벌 두면
 * 언젠가 둘이 어긋나고, 그러면 이 규칙이 막으려는 바로 그 종류의 표류가 규칙 안에서 벌어진다.
 * 모드 목록만 balance.js 가 읽지 않으므로 여기서 따로 읽는다.
 *
 * `custom` 은 PRESETS 에 없지만 제품이 실제로 쓰는 값이다 — src/85-loadout.js 가 프리셋 없이 바뀐
 * 로드아웃을 'custom' 으로 적고, src/99-api.js 와 src/96.1-custom.js 가 `(p === 'custom' || PRESETS[p])`
 * 로 되읽는다. 그래서 스키마 쪽 특수값이 아니라 **정당한 열 번째 값**이고, 진실 목록에 넣는다. */
const SCHEMA_ENUM_TRUTH = [
  { key: 'defaultWeapon', from: 'WEAPON_IDS (src/00-prelude.js)' },
  { key: 'loadoutPreset', from: "PRESETS (src/00-prelude.js) + 'custom'" },
  { key: 'mode',          from: 'MODES (src/86-modes.js)' },
];

/** `const NAME = ['a', 'b', …];` 의 문자열 원소들. 배열이 한 덩어리로 닫히는 모양만 읽고, 못 찾으면
 *  null 을 돌려 규칙이 **조용히 통과하지 않고** SKIP 하게 한다. */
function readStringArrayLiteral(text, name) {
  const m = new RegExp('(?:const|let|var)\\s+' + name + '\\s*=\\s*\\[([^\\]]*)\\]').exec(text);
  if (!m) return null;
  const out = [];
  for (const s of m[1].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) out.push(s[1] != null ? s[1] : s[2]);
  return out;
}

rule('R23', 'settings-enum-vs-product', (r, ctx) => {
  const p = path.join(ctx.root, 'settings-schema.json');
  if (!isFile(p)) return r.skip('settings-schema.json does not exist yet (spec B1)');
  if (!isFile(path.join(ctx.root, 'src/00-prelude.js'))) return r.skip('src/ does not exist; the product side cannot be read');
  /* readArsenal() 은 tools/balance.js 자신의 repo root 에서 src/ 를 읽는다. 다른 트리로 validate 를
   * 돌리면 엉뚱한 src/ 와 대조하게 되므로, 그럴 때는 대조하지 않고 이유를 찍는다. */
  if (ctx.root !== REPO_ROOT) return r.skip('root is ' + ctx.root + ', but tools/balance.js reads the arsenal from ' + REPO_ROOT + ' — the comparison would be against the wrong src/');

  let schema;
  try { schema = readJSON(p); } catch (e) { return r.skip('settings-schema.json did not parse (see R10)'); }
  if (!Array.isArray(schema)) return r.skip('settings-schema.json is not an array (see R10)');

  let arsenal;
  try { arsenal = require('./balance.js').readArsenal(); }
  catch (e) { return r.fail('could not read the arsenal out of src/: ' + e.message); }
  const modes = readStringArrayLiteral(readText(path.join(ctx.root, 'src/86-modes.js')), 'MODES');

  const truth = {
    defaultWeapon: arsenal.ids.map(String),
    loadoutPreset: Object.keys(arsenal.presets).concat(['custom']),
    mode: modes,
  };

  for (const spec of SCHEMA_ENUM_TRUTH) {
    const want = truth[spec.key];
    if (!want || want.length === 0) {
      r.fail('could not read ' + spec.from + ' — "' + spec.key + '" was not compared against the product');
      continue;
    }
    const entry = schema.find((e) => e && e.key === spec.key);
    if (!entry) {
      r.fail('settings-schema.json has no "' + spec.key + '" setting — this rule keeps it in step with ' + spec.from
        + '; if the setting really is gone, drop it from SCHEMA_ENUM_TRUTH on purpose rather than letting the check go quiet');
      continue;
    }
    if (!Array.isArray(entry.options)) { r.fail('settings-schema.json "' + spec.key + '" has no options array (see R10)'); continue; }
    const have = entry.options.map(String);
    const haveSet = new Set(have), wantSet = new Set(want);
    const missing = want.filter((v) => !haveSet.has(v));
    const extra = have.filter((v) => !wantSet.has(v));
    if (missing.length) {
      r.fail('settings-schema.json "' + spec.key + '" cannot reach ' + missing.length + ' value(s) the product has: ' + missing.join(', ')
        + ' (options has ' + have.length + ', ' + spec.from + ' has ' + want.length + ')');
    }
    if (extra.length) {
      r.fail('settings-schema.json "' + spec.key + '" offers ' + extra.length + ' value(s) the product does not know: ' + extra.join(', ')
        + ' — they are not in ' + spec.from);
    }
    if (!missing.length && !extra.length) r.detail(spec.key.padEnd(16) + String(have.length).padStart(3) + ' option(s), all matching ' + spec.from);
  }
  if (!r.failed()) r.note(SCHEMA_ENUM_TRUTH.length + ' schema enum(s) agree with the product, value for value');
});

/* ---- R24 ----
 * CLAUDE.md: "모듈은 하나의 클로저로 이어 붙인다. 서로 다른 모듈의 최상위 이름이 겹치면 뒤 모듈이
 * 이긴다. **조용히 깨지므로** 새 최상위 이름은 먼저 grep 한다." 그 경고를 지키는 검사가 없었다.
 * `const`/`let` 끼리 겹치면 content.js 가 SyntaxError 로 죽어 그나마 티가 나지만, `var` 와 `function`
 * 은 **아무 소리 없이** 뒤엣것이 이긴다 — 그래서 grep 을 잊은 하루가 디버깅 반나절이 된다.
 * 지금 저장소의 충돌은 0이다. 규칙을 넣기 가장 싼 때가 지금이다(docs/review/00-종합.md).
 *
 * 최상위 판정 기준은 **줄 머리 들여쓰기**다. tools/build.js 가 모듈들을 하나의 클로저 안에 그대로
 * 이어 붙이므로 모든 모듈의 본문은 2칸에서 시작하고 중첩 블록은 4칸 이상이다. 그래서 "공백 0~2칸으로
 * 시작하는 선언"이 최상위이고, 그보다 깊은 선언은 **아예 보지 않는다.**
 *
 * R17 은 "선언을 넉넉히 모으는 방향으로 틀린다" 고 적었다. 이 규칙은 **반대 방향으로 틀린다** —
 * 최상위를 좁게 본다. 넓게 잡으면 중첩 스코프의 흔한 이름(i · el · out)이 모듈마다 겹쳐 거짓 양성이
 * 쏟아지고, 그러면 사람이 규칙을 끈다. 좁게 잡으면 기껏해야 진짜 충돌 하나를 놓치는데, 놓친 충돌은
 * 다음 사람이 다시 만나기라도 한다.
 *
 * 괄호 깊이로 재지 않는 이유: fvStripLiterals 는 `return /…\(/i.test(bg)` 꼴의 정규식 리터럴을 코드로
 * 읽는다(`/` 앞 글자가 `n` 이라 리터럴로 안 본다). 그러면 src/32-material.js 의 괄호 균형이 깨지고
 * 깊이 기준은 그 파일의 최상위 선언 **아홉 개를 조용히 잃는다.** 줄 머리 들여쓰기는 그 영향을 안 받는다. */
function topLevelDeclared(code) {
  const d = fvDeclared(code, true);          // const / let / var / function — R17 의 수집기 그대로
  /* fvDeclared 의 topLevelOnly 경로는 class 를 안 본다(R17 은 볼 필요가 없었다). 최상위 class 도
   * 같은 클로저의 이름 한 칸을 차지하므로 여기서는 센다. 지금 src/ 에는 하나도 없다. */
  for (const m of code.matchAll(new RegExp('^ {0,2}class\\s+(' + FV_ID + ')', 'gm'))) d.add(m[1]);
  return d;
}

rule('R24', 'module-top-level-collisions', (r, ctx) => {
  const mj = path.join(ctx.root, 'src/modules.json');
  if (!isFile(mj)) return r.skip('src/modules.json does not exist yet (spec A2)');
  let doc;
  try { doc = readJSON(mj); } catch (e) { return r.skip('src/modules.json did not parse (see R13)'); }
  const list = Array.isArray(doc) ? doc : doc.modules;
  if (!Array.isArray(list)) return r.skip('src/modules.json has no `modules` array (see R13)');

  const owner = new Map();                   // 최상위 이름 -> 처음 선언한 모듈
  let total = 0, files = 0;
  for (const name of list) {                 // src/modules.json 순서 = build.js 의 이어 붙이는 순서
    const full = path.join(ctx.root, 'src', name);
    if (!isFile(full)) continue;             // 목록과 디렉터리가 어긋난 것은 R13 이 말한다
    files++;
    const names = topLevelDeclared(fvStripLiterals(readText(full)));
    total += names.size;
    for (const n of [...names].sort()) {
      if (!owner.has(n)) { owner.set(n, name); continue; }
      r.fail('`' + n + '` is declared at the top level of BOTH src/' + owner.get(n) + ' and src/' + name
        + ' — they land in ONE closure, so src/' + name + ' wins and nothing throws (CLAUDE.md)');
      r.detail('    rename one of them, or move it inside the function that needs it');
    }
  }
  if (!r.failed()) r.note(files + ' module(s), ' + total + ' top-level name(s), none declared in two modules');
});

/* ---- R25 ---------------------------------------------------------------------------------------
 * SPEC-launch §8: 간접 조회되는 이름은 한국어 폴백 표에 반드시 있어야 한다.
 *
 * `src/ko-fallback-keys.json` 은 **손으로 관리하는 목록**이고, 빌드는 거기 적힌 키의 문자열만
 * `_locales/ko` 에서 가져다 content.js 에 굽는다(R19). 그래서 무기나 프리셋을 늘리면서 이 표를 안 늘리면
 * `chrome.i18n` 이 없는 경로에서 HUD 가 `weaponMinigun` 같은 **생키를 그대로 보여 준다.**
 *
 * 실제로 그랬다. 7~9단계가 무기고를 10 → 23 으로, 프리셋을 5 → 9 로 늘리는 동안 표는 그대로여서
 * 무기 이름 13개와 프리셋 이름 4개가 폴백 없이 세 단계를 버텼다. 확장으로 설치해 쓰면 `chrome.i18n`
 * 이 가려 주기 때문에 **눈에 띄지 않았고**, 스위트 A 처럼 content.js 를 그냥 주입하는 경로에서만 드러났다.
 *
 * R7(i18n-unused)은 "쓰이지 않는 키" 를 보고 R19 는 "표에 적힌 키가 로케일과 맞는가" 를 본다.
 * **"로케일에 있는데 표에 없는가" 는 아무도 안 봤다.** 이 규칙이 그 자리를 맡는다.
 *
 * 범위를 `weapon*` 과 `preset*` 으로 좁힌 이유: 이 둘만 `WEAPONS[id].name` · `PRESET_KEYS[name]` 처럼
 * **변수로** 조회되어 리터럴 스캐너에 안 잡히고, 동시에 HUD 에 상시 노출된다. 리터럴로 쓰이는 키는
 * 사람이 추가할 때 눈에 보이므로 여기서 다루지 않는다. */
rule('R25', 'ko-fallback-covers-indirect', (r, ctx) => {
  const listPath = path.join(ctx.root, 'src', 'ko-fallback-keys.json');
  if (!isFile(listPath)) return r.skip('src/ko-fallback-keys.json does not exist');
  const ko = ctx.locales.ko && ctx.locales.ko.data;
  if (!ko) return r.skip('_locales/ko is unreadable (see R5)');
  let listed;
  try { listed = readJSON(listPath); } catch (e) { return r.fail('src/ko-fallback-keys.json did not parse: ' + e.message); }
  if (!listed || !Array.isArray(listed.keys)) return r.fail('src/ko-fallback-keys.json has no `keys` array');
  const have = new Set(listed.keys);

  const PREFIXES = ['weapon', 'preset'];
  let checked = 0;
  const missing = [];
  for (const key of Object.keys(ko)) {
    if (!PREFIXES.some((p) => key.startsWith(p) && key.length > p.length && key[p.length] === key[p.length].toUpperCase())) continue;
    checked++;
    if (!have.has(key)) missing.push(key);
  }
  if (missing.length) {
    r.fail(missing.length + ' indirectly-looked-up key(s) are in _locales/ko but NOT in src/ko-fallback-keys.json —');
    r.fail('without chrome.i18n the HUD prints the raw key for each of these. Add them to the list:');
    for (const k of missing.sort()) r.fail('  ' + k + '  ("' + String(ko[k].message).slice(0, 28) + '")');
  } else {
    r.note(checked + ' weapon*/preset* key(s) all have a Korean fallback');
  }
});

/* ===================================================================== */
/* 7. Runner                                                              */
/* ===================================================================== */

function run(opts) {
  opts = opts || {};
  const root = opts.root || REPO_ROOT;
  const quiet = !!opts.quiet;
  const strict = !!opts.strict;
  const log = opts.log || ((s) => process.stdout.write(s + '\n'));

  const ctx = buildContext(root);
  const records = [];

  for (const def of RULES) {
    const rec = { id: def.id, name: def.name, status: 'PASS', fails: [], warns: [], notes: [], details: [], reason: null };
    const api = {
      fail(msg) { rec.fails.push(msg); },
      warn(msg) { rec.warns.push(msg); },
      note(msg) { rec.notes.push(msg); },
      detail(msg) { rec.details.push(msg); },
      skip(reason) { rec.reason = reason; rec.skipped = true; },
      failed() { return rec.fails.length > 0; },
    };
    try { def.fn(api, ctx); }
    catch (e) { rec.fails.push('rule threw: ' + (e && e.stack ? e.stack.split('\n')[0] : e)); }

    if (rec.fails.length) rec.status = 'FAIL';
    else if (rec.skipped) rec.status = 'SKIP';
    else if (rec.warns.length) rec.status = 'WARN';
    else rec.status = 'PASS';
    records.push(rec);
  }

  /* ---- print ---- */
  for (const rec of records) {
    const head = rec.id.padEnd(4) + rec.name;
    if (rec.status === 'FAIL') {
      log('FAIL ' + head);
      for (const m of rec.fails) log('    ' + m);
      for (const m of rec.details) log('    ' + m);
    } else if (rec.status === 'WARN') {
      log('WARN ' + head);
      for (const m of rec.warns) log('    ' + m);
      for (const m of rec.details) log('    ' + m);
    } else if (quiet) {
      continue;
    } else if (rec.status === 'SKIP') {
      log('SKIP ' + head + ' — ' + rec.reason);
      for (const m of rec.notes) log('    ' + m);
    } else {
      log('PASS ' + head);
      for (const m of rec.notes) log('    ' + m);
      for (const m of rec.details) log('    ' + m);
    }
  }

  const failures = [];
  const warnings = [];
  const skips = [];
  for (const rec of records) {
    for (const m of rec.fails) failures.push(rec.id + ' ' + rec.name + ': ' + m);
    for (const m of rec.warns) warnings.push(rec.id + ' ' + rec.name + ': ' + m);
    if (rec.status === 'SKIP') skips.push(rec.id + ' ' + rec.name + ': ' + rec.reason);
  }

  const counts = { PASS: 0, WARN: 0, SKIP: 0, FAIL: 0 };
  for (const rec of records) counts[rec.status]++;
  log('');
  log('validate: ' + counts.PASS + ' passed, ' + counts.WARN + ' warned, '
    + counts.SKIP + ' skipped, ' + counts.FAIL + ' failed'
    + '  (version ' + (ctx.version || '?') + ', root ' + root + ')');
  if (strict && warnings.length) log('validate: --strict is on, ' + warnings.length + ' warning(s) count as failures');

  const ok = failures.length === 0 && !(strict && warnings.length);
  return { ok, failures, warnings, skips, records, counts, version: ctx.version, context: ctx };
}

/* ===================================================================== */
/* 8. Extra subcommands                                                   */
/* ===================================================================== */

function expectVersion(want) {
  const ctx = buildContext(REPO_ROOT);
  const seen = [
    { src: 'manifest.json', v: ctx.manifest ? ctx.manifest.version : null },
    { src: 'package.json', v: ctx.pkgPresent ? (ctx.pkg ? ctx.pkg.version : null) : '(absent)' },
    { src: ctx.versionConst.file + ' (VERSION)', v: ctx.versionConst.version },
  ];
  let bad = 0;
  for (const s of seen) {
    const okRow = s.v === want || (s.src === 'package.json' && s.v === '(absent)');
    if (!okRow) bad++;
    process.stdout.write((okRow ? 'ok   ' : 'BAD  ') + s.src.padEnd(28) + s.v + '\n');
  }
  if (bad) {
    process.stdout.write('\nexpect-version: ' + bad + ' source(s) disagree with ' + want + '\n');
    return 1;
  }
  process.stdout.write('\nexpect-version: every source reports ' + want + '\n');
  return 0;
}

function compareIcons(dirA, dirB) {
  if (!isDir(dirA) || !isDir(dirB)) {
    process.stdout.write('compare-icons: both arguments must be directories\n');
    return 1;
  }
  const names = fs.readdirSync(dirA).filter((n) => /\.png$/i.test(n)).sort();
  if (names.length === 0) { process.stdout.write('compare-icons: no PNG files in ' + dirA + '\n'); return 1; }
  let pixelDiff = 0, byteDiff = 0;
  for (const n of names) {
    const pa = path.join(dirA, n), pb = path.join(dirB, n);
    if (!isFile(pb)) { process.stdout.write('BAD  ' + n + ' missing from ' + dirB + '\n'); pixelDiff++; continue; }
    const ba = fs.readFileSync(pa), bb = fs.readFileSync(pb);
    if (ba.equals(bb)) { process.stdout.write('ok   ' + n + ' byte-identical\n'); continue; }
    let qa, qb;
    try { qa = pngPixels(ba); qb = pngPixels(bb); }
    catch (e) { process.stdout.write('BAD  ' + n + ' undecodable: ' + e.message + '\n'); pixelDiff++; continue; }
    if (qa.width !== qb.width || qa.height !== qb.height) {
      process.stdout.write('BAD  ' + n + ' dimensions differ: ' + qa.width + 'x' + qa.height + ' vs ' + qb.width + 'x' + qb.height + '\n');
      pixelDiff++; continue;
    }
    if (qa.data.equals(qb.data)) {
      byteDiff++;
      process.stdout.write('::warning::' + n + ' differs in bytes but is pixel-identical (zlib build drift, not an icon change)\n');
      process.stdout.write('warn ' + n + ' bytes differ (' + ba.length + ' vs ' + bb.length + '), pixels identical\n');
    } else {
      let differing = 0;
      for (let i = 0; i < qa.data.length; i += 4) {
        if (qa.data[i] !== qb.data[i] || qa.data[i + 1] !== qb.data[i + 1]
          || qa.data[i + 2] !== qb.data[i + 2] || qa.data[i + 3] !== qb.data[i + 3]) differing++;
      }
      process.stdout.write('BAD  ' + n + ' ' + differing + ' of ' + (qa.width * qa.height) + ' pixels differ\n');
      pixelDiff++;
    }
  }
  process.stdout.write('\ncompare-icons: ' + names.length + ' file(s), '
    + pixelDiff + ' with pixel differences, ' + byteDiff + ' byte-only differences\n');
  return pixelDiff ? 1 : 0;
}

/* ===================================================================== */
/* 9. CLI                                                                 */
/* ===================================================================== */

function main(argv) {
  const ev = argv.indexOf('--expect-version');
  if (ev !== -1) {
    const want = argv[ev + 1];
    if (!want || !/^\d+\.\d+\.\d+$/.test(want)) {
      process.stdout.write('usage: node tools/validate.js --expect-version <x.y.z>\n');
      return 2;
    }
    return expectVersion(want);
  }
  const ci = argv.indexOf('--compare-icons');
  if (ci !== -1) {
    const a = argv[ci + 1], b = argv[ci + 2];
    if (!a || !b) {
      process.stdout.write('usage: node tools/validate.js --compare-icons <dirA> <dirB>\n');
      return 2;
    }
    return compareIcons(a, b);
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write([
      'usage: node tools/validate.js [--quiet] [--strict]',
      '       node tools/validate.js --expect-version <x.y.z>',
      '       node tools/validate.js --compare-icons <dirA> <dirB>',
      '',
      '  --quiet   print only WARN and FAIL rules plus the summary',
      '  --strict  treat warnings as failures (used by release.yml)',
      '',
    ].join('\n'));
    return 0;
  }
  const res = run({ quiet: argv.includes('--quiet'), strict: argv.includes('--strict') });
  return res.ok ? 0 : 1;
}

module.exports = {
  run,
  collectShipFiles,
  SHIP_SPEC,
  pngIHDR,
  pngPixels,
  readVersionConstant,
  REPO_ROOT,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
