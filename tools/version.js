'use strict';
/*
 * tools/version.js — bump the version everywhere, seed the changelog, print the
 * git commands. It never runs git itself.
 *
 * Usage:
 *   node tools/version.js patch|minor|major|<x.y.z> [--dry-run] [--force] [--yes]
 *   node tools/version.js --current
 *   node tools/version.js --changelog-section <x.y.z>
 *
 * What a bump touches:
 *   manifest.json          "version"
 *   package.json           "version"            (skipped if the file is absent)
 *   src/00-prelude.js      const VERSION = '…'  (spec A2)
 *     — until src/ exists the VERSION constant still lives in content.js, so
 *       that file is updated instead. This mirrors how tools/validate.js R3
 *       resolves the constant, which keeps the version triple consistent either
 *       way. Once spec A2 lands, content.js is generated and must not be edited
 *       here; the rebuild below regenerates it.
 *   content.js             rebuilt via tools/build.js when that script exists
 *   CHANGELOG.md           a new section at the top, plus its reference-link
 *                          definition and the [Unreleased] compare base
 *
 * SAFETY. A bump rewrites files that other work may be sitting on, so the tool
 * refuses to touch anything unless the working tree is clean:
 *   - inside a git repository it runs `git status --porcelain` and aborts if
 *     anything is modified or staged;
 *   - outside one it cannot verify anything and aborts as well.
 * `--force` overrides both checks, and `--dry-run` reports without writing.
 * Use `--dry-run` first. Always.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

/* ===================================================================== */
/* helpers                                                                */
/* ===================================================================== */

function isFile(p) { try { return fs.statSync(p).isFile(); } catch (_) { return false; } }
function read(p) { return fs.readFileSync(p, 'utf8'); }
function out(s) { process.stdout.write(s + '\n'); }
function err(s) { process.stderr.write(s + '\n'); }

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function bumpVersion(current, how) {
  if (SEMVER.test(how)) return how;
  const m = SEMVER.exec(current);
  if (!m) throw new Error('current version "' + current + '" is not x.y.z, so ' + how + ' cannot be applied');
  let [, a, b, c] = m.map(Number);
  if (how === 'major') { a += 1; b = 0; c = 0; }
  else if (how === 'minor') { b += 1; c = 0; }
  else if (how === 'patch') { c += 1; }
  else throw new Error('unknown bump "' + how + '" (expected patch, minor, major or x.y.z)');
  return a + '.' + b + '.' + c;
}

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** Replace a `"version": "…"` value in place, leaving the rest of the file untouched. */
function replaceJsonVersion(text, next) {
  const re = /^(\s*"version"\s*:\s*")([^"]*)(")/m;
  if (!re.test(text)) return null;
  return text.replace(re, (_, a, _old, c) => a + next + c);
}

/** Replace `const VERSION = 'x.y.z'` in place. */
function replaceConstVersion(text, next) {
  const re = /(\bconst\s+VERSION\s*=\s*)(['"])([^'"]*)\2/;
  if (!re.test(text)) return null;
  return text.replace(re, (_, a, q) => a + q + next + q);
}

function currentVersion(root) {
  const p = path.join(root, 'manifest.json');
  if (!isFile(p)) throw new Error('manifest.json does not exist');
  const j = JSON.parse(read(p).replace(/^\uFEFF/, ''));
  if (!j.version) throw new Error('manifest.json has no version');
  return j.version;
}

/* Which file currently owns the VERSION constant. */
function versionConstFile(root) {
  const prelude = path.join(root, 'src/00-prelude.js');
  if (isFile(prelude)) return { rel: 'src/00-prelude.js', generated: false };
  const content = path.join(root, 'content.js');
  if (isFile(content) && /\bconst\s+VERSION\s*=/.test(read(content))) {
    return { rel: 'content.js', generated: false, preA2: true };
  }
  return null;
}

/* ===================================================================== */
/* CHANGELOG                                                              */
/* ===================================================================== */

const HEADING_RE = /^## \[?(\d+\.\d+\.\d+)\]?(.*)$/;

/** Reuse whatever separator the newest existing release heading uses. */
function detectSeparator(text) {
  for (const line of text.split(/\r?\n/)) {
    const m = HEADING_RE.exec(line);
    if (m) {
      const s = /\]?\s*(—|–|-)\s*\d{4}-\d{2}-\d{2}/.exec(line);
      if (s) return s[1];
    }
  }
  return '—';
}

/** Does the file bracket its versions (`## [1.2.0]`) or not (`## 1.2.0`)? */
function detectBrackets(text) {
  for (const line of text.split(/\r?\n/)) {
    if (HEADING_RE.test(line)) return line.indexOf('## [') === 0;
  }
  return true;
}

/** The three subsection headings the file already uses, so a Korean CHANGELOG
 *  does not grow English headings (and vice versa). */
function detectSubheadings(text) {
  const have = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^###\s+(.+?)\s*$/.exec(line);
    if (m) have.add(m[1]);
  }
  if (have.has('추가') || have.has('변경') || have.has('수정')) return ['추가', '변경', '수정'];
  return ['Added', 'Changed', 'Fixed'];
}

/* A Keep a Changelog file parks reference-link definitions at the bottom:
 *     [Unreleased]: <repo>/compare/v1.2.0...HEAD
 *     [1.2.0]: <repo>/releases/tag/v1.2.0
 * The `## [1.2.1]` heading inserted above is a reference link, so without a
 * matching definition GitHub renders it as the literal text "[1.2.1]" and the
 * Unreleased compare link keeps pointing at the previous release. */
function updateLinkRefs(text, version) {
  const unrel = /^(\[Unreleased\]:\s*\S*?\/compare\/)v?[^.\s]*(?:\.[^.\s]*)*(\.\.\.\S+)\s*$/m;
  let out = text;
  let changed = false;

  if (unrel.test(out)) {
    out = out.replace(unrel, (_, head, tail) => head + 'v' + version + tail);
    changed = true;
  }

  /* Model the new definition on an existing release definition so the URL shape
     (releases/tag/vX, or whatever this file uses) is copied rather than guessed. */
  const relRe = /^\[(\d+\.\d+\.\d+)\]:\s*(\S+)\s*$/m;
  const sample = relRe.exec(out);
  if (sample && !new RegExp('^\\[' + version.replace(/\./g, '\\.') + '\\]:', 'm').test(out)) {
    const line = '[' + version + ']: ' + sample[2].split(sample[1]).join(version);
    const lines = out.split('\n');
    let at = lines.findIndex((l) => relRe.test(l));
    if (at === -1) at = lines.length;
    lines.splice(at, 0, line);
    out = lines.join('\n');
    changed = true;
  }

  return changed ? out : text;
}

function insertChangelogSection(text, version, date) {
  const sep = detectSeparator(text);
  const brackets = detectBrackets(text);
  const subs = detectSubheadings(text);
  const heading = '## ' + (brackets ? '[' + version + ']' : version) + ' ' + sep + ' ' + date;
  const block = heading + '\n\n### ' + subs[0] + '\n\n-\n\n### ' + subs[1] + '\n\n-\n\n### ' + subs[2] + '\n\n-\n\n';

  const lines = text.split('\n');
  /* Insert before the first release heading; an `## [Unreleased]` section keeps
     its place at the top. */
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) { at = i; break; }
  }
  if (at === -1) {
    const trimmed = text.replace(/\s*$/, '');
    return updateLinkRefs(trimmed + '\n\n' + block.replace(/\s*$/, '') + '\n', version);
  }
  /* Back up over blank lines so the new section is separated cleanly. */
  let ins = at;
  while (ins > 0 && lines[ins - 1].trim() === '') ins--;
  const head = lines.slice(0, ins).join('\n').replace(/\s*$/, '');
  const tail = lines.slice(ins).join('\n').replace(/^\s*/, '');
  return updateLinkRefs(head + '\n\n' + block + tail.replace(/\s*$/, '') + '\n', version);
}

function changelogSection(root, version) {
  const p = path.join(root, 'CHANGELOG.md');
  if (!isFile(p)) return null;
  const lines = read(p).split('\n');
  const want = new RegExp('^## \\[?' + version.replace(/\./g, '\\.') + '\\]?(\\s|$)');
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (want.test(lines[i])) { start = i; break; }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    /* Stop at the next section, or at the link-reference block Keep a Changelog
       parks at the bottom of the file — those are not release notes. */
    if (/^## /.test(lines[i]) || /^\[[^\]]+\]:\s*\S+/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n').replace(/^\s*\n/, '').replace(/\s*$/, '') + '\n';
}

/* ===================================================================== */
/* working-tree guard                                                     */
/* ===================================================================== */

function treeGuard(root, force) {
  const gitDir = path.join(root, '.git');
  let gitPresent = false;
  try { gitPresent = fs.existsSync(gitDir); } catch (_) { gitPresent = false; }

  if (!gitPresent) {
    const why = 'no .git directory at ' + root + ', so the working tree cannot be verified clean';
    if (force) { out('!! ' + why + ' — continuing because --force was given.'); return true; }
    err('version: refusing to bump — ' + why + '.');
    err('        Another workflow may be editing manifest.json / content.js right now.');
    err('        Run the spec A1 git bootstrap first, or pass --force if you are certain.');
    return false;
  }

  const res = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (res.error || res.status !== 0) {
    const why = 'git status failed (' + (res.error ? res.error.message : 'exit ' + res.status) + ')';
    if (force) { out('!! ' + why + ' — continuing because --force was given.'); return true; }
    err('version: refusing to bump — ' + why + '.');
    return false;
  }
  const dirty = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (dirty.length === 0) return true;

  if (force) {
    out('!! working tree is dirty (' + dirty.length + ' path(s)) — continuing because --force was given.');
    return true;
  }
  err('version: refusing to bump — the working tree is not clean:');
  for (const l of dirty.slice(0, 20)) err('        ' + l);
  if (dirty.length > 20) err('        … and ' + (dirty.length - 20) + ' more');
  err('        Commit or stash first. A bump rewrites manifest.json, package.json,');
  err('        the VERSION constant and CHANGELOG.md, and would clobber work in flight.');
  return false;
}

/* ===================================================================== */
/* bump                                                                   */
/* ===================================================================== */

function doBump(root, how, opts) {
  const cur = currentVersion(root);
  const next = bumpVersion(cur, how);
  if (next === cur) {
    err('version: ' + cur + ' is already the requested version; nothing to do');
    return 1;
  }

  out('crash-tab version bump: ' + cur + '  ->  ' + next);
  out('');

  const edits = [];                       // [{ rel, text, note }]
  const skipped = [];

  /* manifest.json */
  const mPath = path.join(root, 'manifest.json');
  const mNew = replaceJsonVersion(read(mPath), next);
  if (mNew === null) { err('version: could not find a "version" line in manifest.json'); return 1; }
  edits.push({ rel: 'manifest.json', text: mNew });

  /* package.json */
  const pPath = path.join(root, 'package.json');
  if (isFile(pPath)) {
    const pNew = replaceJsonVersion(read(pPath), next);
    if (pNew === null) { err('version: could not find a "version" line in package.json'); return 1; }
    edits.push({ rel: 'package.json', text: pNew });
  } else {
    skipped.push('package.json does not exist — nothing to update there');
  }

  /* VERSION constant */
  const vc = versionConstFile(root);
  if (!vc) {
    skipped.push('no VERSION constant found in src/00-prelude.js or content.js');
  } else {
    const vPath = path.join(root, vc.rel);
    const vNew = replaceConstVersion(read(vPath), next);
    if (vNew === null) { err('version: could not rewrite the VERSION constant in ' + vc.rel); return 1; }
    edits.push({
      rel: vc.rel,
      text: vNew,
      note: vc.preA2 ? 'pre-A2: the VERSION constant still lives in content.js' : null,
    });
  }

  /* CHANGELOG.md */
  const cPath = path.join(root, 'CHANGELOG.md');
  const date = todayISO();
  if (isFile(cPath)) {
    const cText = read(cPath);
    const already = new RegExp('^## \\[?' + next.replace(/\./g, '\\.') + '\\]?(\\s|$)', 'm');
    if (already.test(cText)) skipped.push('CHANGELOG.md already has a section for ' + next);
    else edits.push({ rel: 'CHANGELOG.md', text: insertChangelogSection(cText, next, date) });
  } else {
    skipped.push('CHANGELOG.md does not exist — create it before releasing (validate R14 will fail without it)');
  }

  for (const e of edits) out('  edit  ' + e.rel + (e.note ? '   (' + e.note + ')' : ''));
  for (const s of skipped) out('  skip  ' + s);
  out('');

  if (opts.dryRun) {
    out('--dry-run: nothing was written.');
    out('');
    printNextSteps(next, root, true);
    return 0;
  }

  for (const e of edits) fs.writeFileSync(path.join(root, e.rel), e.text);
  out('wrote ' + edits.length + ' file(s).');

  /* Rebuild content.js when the build script exists (spec A2). */
  const buildPath = path.join(root, 'tools/build.js');
  if (isFile(buildPath)) {
    out('');
    out('— node tools/build.js —');
    const res = spawnSync(process.execPath, [buildPath], { cwd: root, stdio: 'inherit' });
    if (res.status !== 0) {
      err('version: tools/build.js exited ' + res.status + '. The version files were already written;');
      err('        fix the build and rerun `node tools/build.js` before committing.');
      return 1;
    }
  } else {
    out('note: tools/build.js does not exist yet (spec A2) — content.js was not regenerated.');
  }

  out('');
  printNextSteps(next, root, false);
  return 0;
}

function printNextSteps(version, root, dry) {
  const tag = 'v' + version;
  out('Next steps — these commands are NOT run for you:');
  out('');
  out('  node tools/validate.js');
  out('  node test/e2e.js');
  out('  node tools/package.js');
  out('');
  out('  # edit CHANGELOG.md: fill in the Added / Changed / Fixed bullets for ' + version);
  out('');
  out('  git add -A');
  out('  git commit -m "chore(release): ' + tag + '"');
  out('  git tag -a ' + tag + ' -m "' + tag + '"');
  out('  git push origin main');
  out('  git push origin ' + tag);
  out('');
  out('Pushing the tag triggers .github/workflows/release.yml, which re-runs the gate,');
  out('packages dist/crash-tab-' + version + '.zip and attaches it to the GitHub release.');
  out('Store publishing stays manual: run .github/workflows/publish-store.yml by hand.');
  out('');
  out('Rollback: `git push --delete origin ' + tag + '` and delete the GitHub release.');
  out('Never force-push main.');
  if (dry) out('\n(dry run — rerun without --dry-run to apply.)');
}

/* ===================================================================== */
/* CLI                                                                    */
/* ===================================================================== */

function usage() {
  out([
    'usage: node tools/version.js patch|minor|major|<x.y.z> [--dry-run] [--force]',
    '       node tools/version.js --current',
    '       node tools/version.js --changelog-section <x.y.z>',
    '',
    '  --dry-run              report every edit, write nothing',
    '  --force                bump even though the working tree is dirty or not a git repo',
    '  --current              print the manifest.json version and exit',
    '  --changelog-section    print the body of one CHANGELOG.md section (release notes)',
    '',
  ].join('\n'));
}

function main(argv) {
  const root = REPO_ROOT;

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) { usage(); return argv.length === 0 ? 2 : 0; }

  if (argv.includes('--current')) {
    try { out(currentVersion(root)); return 0; }
    catch (e) { err('version: ' + e.message); return 1; }
  }

  const cs = argv.indexOf('--changelog-section');
  if (cs !== -1) {
    const want = argv[cs + 1];
    if (!want || !SEMVER.test(want)) { err('version: --changelog-section needs an x.y.z argument'); return 2; }
    const body = changelogSection(root, want);
    if (body === null) {
      err('version: CHANGELOG.md has no section for ' + want);
      return 1;
    }
    process.stdout.write(body);
    return 0;
  }

  const how = argv.find((a) => !a.startsWith('-'));
  if (!how) { usage(); return 2; }
  if (!['patch', 'minor', 'major'].includes(how) && !SEMVER.test(how)) {
    err('version: "' + how + '" is not patch, minor, major or x.y.z');
    return 2;
  }

  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force') || argv.includes('--yes');
  if (!dryRun && !treeGuard(root, force)) return 1;

  try { return doBump(root, how, { dryRun }); }
  catch (e) { err('version: ' + e.message); return 1; }
}

module.exports = { bumpVersion, insertChangelogSection, changelogSection, replaceJsonVersion, replaceConstVersion };

if (require.main === module) process.exit(main(process.argv.slice(2)));
