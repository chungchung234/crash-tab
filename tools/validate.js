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
  { rel: 'options',               kind: 'dir',  optional: true, note: 'spec B2 — options page not created yet' },
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

const FORBIDDEN_EXT_PAGES = [
  { label: 'eval(',        re: /\beval\s*\(/ },
  { label: 'new Function', re: /\bnew\s+Function\b/ },
];

function scanForbidden(root, rels, patterns) {
  const hits = [];
  for (const rel of rels) {
    const full = path.join(root, rel);
    if (!isFile(full)) continue;
    const lines = readText(full).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
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
  if (!r.failed()) r.note(rels.length + ' extension-page file(s) clean (eval / new Function only)');
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
  if (!r.failed()) r.note(list.length + ' module(s), list and directory agree');
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
