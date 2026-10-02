#!/usr/bin/env node
'use strict';
/*
 * tools/build.js — concatenates src/*.js (in the order declared by
 * src/modules.json) into content.js.
 *
 * Usage:
 *   node tools/build.js             build content.js
 *   node tools/build.js --check     rebuild in memory; exit 1 with a diff
 *                                   summary if content.js on disk differs
 *   node tools/build.js --quiet     suppress the per-module listing
 *
 * This is a PURE concatenation step (spec A2): it does not parse or alter
 * module source in any way beyond wrapping it in banners and the existing
 * v1 bootstrap shell. Pure Node, zero dependencies, no source maps.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const MODULES_JSON = path.join(SRC_DIR, 'modules.json');
const SETTINGS_SCHEMA_JSON = path.join(REPO_ROOT, 'settings-schema.json');
const CONTENT_JS = path.join(REPO_ROOT, 'content.js');
const SETTINGS_MARKER = '/*@SETTINGS_SCHEMA@*/';

/* Generated-file header. Must stay byte-for-byte deterministic across builds
 * of the same input (no timestamps) so `--check` is stable, and must contain
 * the exact phrase tools/validate.js (rule R12) looks for. */
const GENERATED_HEADER =
  '/* AUTO-GENERATED FILE — DO NOT EDIT — generated from src/ by tools/build.js.\n' +
  ' *\n' +
  ' * To change behaviour, edit the module files under src/ (their order is\n' +
  ' * declared in src/modules.json) and regenerate with:\n' +
  ' *\n' +
  ' *   node tools/build.js\n' +
  ' *\n' +
  ' * Hand edits to this file will be silently overwritten by the next build,\n' +
  ' * and `node tools/build.js --check` (run in CI) fails while they stand.\n' +
  ' */\n';

/* The v1 bootstrap shell: the IIFE whose completion value is 'on' / 'off'.
 * Module content (src/00-prelude.js .. src/99-api.js) is inserted verbatim
 * between SHELL_PREFIX and SHELL_SUFFIX — nothing about injection changes. */
const SHELL_PREFIX =
  "(() => {\n" +
  "  'use strict';\n" +
  "  if (window.__crashScreen) { return window.__crashScreen.toggle(); }\n" +
  "\n";
const SHELL_SUFFIX = '})();\n';

/* ===================================================================== */
/* small helpers                                                          */
/* ===================================================================== */

function readText(p) { return fs.readFileSync(p, 'utf8'); }
function isFile(p) { try { return fs.statSync(p).isFile(); } catch (_) { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } }

function stripBOM(s) { return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; }
function readJSON(p) { return JSON.parse(stripBOM(readText(p))); }

function fail(messages) {
  for (const m of messages) process.stderr.write('build.js: ERROR: ' + m + '\n');
  process.exit(1);
}

/* ===================================================================== */
/* 1. resolve src/modules.json against the actual contents of src/        */
/* ===================================================================== */

function loadModuleList(srcDir, modulesJsonPath) {
  const errors = [];

  if (!isDir(srcDir)) {
    fail(['src/ does not exist (expected ' + path.relative(REPO_ROOT, srcDir) + ')']);
  }
  if (!isFile(modulesJsonPath)) {
    fail(['src/modules.json does not exist']);
  }

  let doc;
  try {
    doc = readJSON(modulesJsonPath);
  } catch (e) {
    fail(['src/modules.json did not parse as JSON: ' + e.message]);
  }
  const list = Array.isArray(doc) ? doc : doc && doc.modules;
  if (!Array.isArray(list) || list.length === 0) {
    fail(['src/modules.json has no non-empty `modules` array']);
  }
  for (const name of list) {
    if (typeof name !== 'string' || !name) {
      errors.push('src/modules.json contains a non-string module entry: ' + JSON.stringify(name));
    }
  }
  if (errors.length) fail(errors);

  /* missing-module check */
  const listed = new Set(list);
  for (const name of list) {
    if (!isFile(path.join(srcDir, name))) {
      errors.push('src/modules.json lists "' + name + '" but src/' + name + ' does not exist');
    }
  }

  /* stray-file check: every .js directly under src/ (not modules.json) must be listed */
  for (const entry of fs.readdirSync(srcDir)) {
    if (!/\.js$/.test(entry)) continue;
    const full = path.join(srcDir, entry);
    if (!fs.statSync(full).isFile()) continue;
    if (!listed.has(entry)) {
      errors.push('src/' + entry + ' exists but is not listed in src/modules.json');
    }
  }

  if (errors.length) fail(errors);
  return list;
}

/* ===================================================================== */
/* 2. concatenate modules with banners                                    */
/* ===================================================================== */

function buildBody(srcDir, list, quiet) {
  const parts = [];
  for (const name of list) {
    const full = path.join(srcDir, name);
    let text;
    try {
      text = readText(full);
    } catch (e) {
      fail(['could not read src/' + name + ': ' + e.message]);
    }
    text = stripBOM(text).replace(/\s+$/, '');
    if (!quiet) {
      process.stdout.write('build.js:   + ' + name + ' (' + Buffer.byteLength(text, 'utf8') + ' bytes)\n');
    }
    parts.push('// ── ' + name + ' ──\n' + text);
  }
  return parts.join('\n\n');
}

/* ===================================================================== */
/* 3. settings-schema.json inlining                                       */
/* ===================================================================== */

function inlineSettingsSchema(body, quiet) {
  const hasMarker = body.indexOf(SETTINGS_MARKER) !== -1;

  if (!isFile(SETTINGS_SCHEMA_JSON)) {
    process.stdout.write(
      'build.js: note: settings-schema.json not found at repo root — ' +
      (hasMarker
        ? 'leaving the ' + SETTINGS_MARKER + ' marker in place unresolved.\n'
        : 'no ' + SETTINGS_MARKER + ' marker present in src/ either, nothing to do.\n')
    );
    return body;
  }

  if (!hasMarker) {
    process.stdout.write(
      'build.js: note: settings-schema.json exists but no ' + SETTINGS_MARKER +
      ' marker was found in src/ — nothing inlined.\n'
    );
    return body;
  }

  let schema;
  try {
    schema = readJSON(SETTINGS_SCHEMA_JSON);
  } catch (e) {
    fail(['settings-schema.json did not parse as JSON: ' + e.message]);
  }

  const literal = 'Object.freeze(' + JSON.stringify(schema) + ')';
  return body.split(SETTINGS_MARKER).join(literal);
}

/* ===================================================================== */
/* 4. assemble the full file                                              */
/* ===================================================================== */

function assemble(srcDir, modulesJsonPath, quiet) {
  const list = loadModuleList(srcDir, modulesJsonPath);
  let body = buildBody(srcDir, list, quiet);
  body = inlineSettingsSchema(body, quiet);
  return GENERATED_HEADER + SHELL_PREFIX + body + '\n' + SHELL_SUFFIX;
}

/* ===================================================================== */
/* 5. minimal zero-dependency unified-diff summary (for --check)          */
/* ===================================================================== */

function unifiedDiff(oldText, newText, oldLabel, newLabel) {
  const a = oldText.split('\n');
  const b = newText.split('\n');

  let prefix = 0;
  const maxPrefix = Math.min(a.length, b.length);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++;

  let suffix = 0;
  const maxSuffix = Math.min(a.length, b.length) - prefix;
  while (suffix < maxSuffix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;

  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);

  const CONTEXT = 3;
  const ctxStart = Math.max(0, prefix - CONTEXT);
  const ctxBeforeA = a.slice(ctxStart, prefix);
  const ctxEndA = Math.min(a.length - suffix + CONTEXT, a.length);
  const ctxAfterA = a.slice(a.length - suffix, ctxEndA);

  const lines = [];
  lines.push('--- ' + oldLabel);
  lines.push('+++ ' + newLabel);
  lines.push(
    '@@ -' + (ctxStart + 1) + ',' + (ctxEndA - ctxStart) +
    ' +' + (ctxStart + 1) + ',' + (ctxEndA - ctxStart - aMid.length + bMid.length) + ' @@'
  );
  for (const l of ctxBeforeA) lines.push(' ' + l);

  const CAP = 200;
  let shown = 0;
  for (const l of aMid) {
    if (shown >= CAP) { lines.push('! … ' + (aMid.length - shown) + ' more removed line(s) omitted …'); break; }
    lines.push('-' + l);
    shown++;
  }
  shown = 0;
  for (const l of bMid) {
    if (shown >= CAP) { lines.push('! … ' + (bMid.length - shown) + ' more added line(s) omitted …'); break; }
    lines.push('+' + l);
    shown++;
  }
  for (const l of ctxAfterA) lines.push(' ' + l);

  lines.push('');
  lines.push(
    'summary: ' + a.length + ' → ' + b.length + ' lines; ' +
    aMid.length + ' line(s) removed, ' + bMid.length + ' line(s) added ' +
    '(unchanged prefix ' + prefix + ', unchanged suffix ' + suffix + ').'
  );
  return lines.join('\n');
}

/* ===================================================================== */
/* main                                                                   */
/* ===================================================================== */

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const quiet = args.includes('--quiet');
  const unknown = args.filter((a) => a !== '--check' && a !== '--quiet');
  if (unknown.length) {
    fail(['unknown argument(s): ' + unknown.join(', ') + ' (supported: --check, --quiet)']);
  }

  const expected = assemble(SRC_DIR, MODULES_JSON, quiet);

  if (check) {
    const actual = isFile(CONTENT_JS) ? readText(CONTENT_JS) : null;
    if (actual === expected) {
      process.stdout.write('build.js: content.js is up to date.\n');
      process.exit(0);
    }
    process.stderr.write('build.js: content.js is OUT OF DATE (run `node tools/build.js` to regenerate)\n\n');
    if (actual === null) {
      process.stderr.write('content.js does not exist on disk yet.\n');
    } else {
      process.stderr.write(unifiedDiff(actual, expected, 'content.js (on disk)', 'content.js (freshly built)') + '\n');
    }
    process.exit(1);
  }

  fs.writeFileSync(CONTENT_JS, expected, 'utf8');
  process.stdout.write('build.js: wrote ' + path.relative(REPO_ROOT, CONTENT_JS) +
    ' (' + Buffer.byteLength(expected, 'utf8') + ' bytes)\n');
}

main();
