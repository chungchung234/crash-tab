'use strict';
/*
 * tools/package.js — build dist/crash-tab-<version>.zip with zero dependencies.
 *
 * Usage:
 *   node tools/package.js [--out <path>] [--dry-run] [--quiet] [--skip-validate]
 *
 * The archive is written by a hand-rolled ZIP writer (zlib.deflateRawSync for the
 * bodies, everything else built byte by byte here). Properties that matter:
 *
 *   - No data descriptors. General-purpose flag bit 3 stays 0 and CRC32 /
 *     compressed size / uncompressed size go straight into the local file
 *     header, because every entry is deflated in memory before its header is
 *     built. The whole payload is a few hundred KB, so buffering is free.
 *   - UTF-8 filenames: flag bit 11 (0x0800) is set on every entry in both the
 *     local header and the central directory; names are raw UTF-8, forward
 *     slashes only, and no directory entries are emitted.
 *   - Store fallback: an entry whose deflated body is not smaller than the raw
 *     body is stored (method 0) instead, and empty files are always stored.
 *   - Reproducible: one fixed DOS timestamp for every entry, taken from
 *     SOURCE_DATE_EPOCH when set, else the CHANGELOG.md date for the current
 *     version at 00:00:00 UTC, else the 1980 DOS epoch. Two runs over the same
 *     inputs produce byte-identical archives.
 *   - No ZIP64. Every classic size field is a uint32 and the entry count is a
 *     uint16, so the guards below hard-fail rather than silently truncate.
 *
 * tools/validate.js runs in-process first; a package run cannot succeed where
 * validate would fail.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const validate = require('./validate.js');
const REPO_ROOT = path.resolve(__dirname, '..');

/* Hard limits of the classic (non-ZIP64) record layout, plus the store cap. */
const MAX_UINT32 = 0xFFFFFFFF;            // 4 GiB - 1
const MAX_ENTRIES = 0xFFFF - 1;           // uint16 entry count
const MAX_ZIP_BYTES = 10 * 1024 * 1024;   // spec A5

/* ===================================================================== */
/* 1. CRC-32 (reflected, poly 0xEDB88320)                                 */
/* ===================================================================== */
/* Hand-rolled rather than zlib.crc32 because zlib.crc32 only exists from
   Node 20.15 / 22, and package.json declares engines node >= 20. Verified
   byte-for-byte against zlib.crc32 where that function is available. */

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  CRC_TABLE = t;
  return t;
}

function crc32(buf) {
  const t = crcTable();
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ===================================================================== */
/* 2. DOS date/time                                                       */
/* ===================================================================== */

function dosDateTime(date) {
  const y = date.getUTCFullYear();
  if (y < 1980) return { time: 0, date: (1 << 5) | 1 };   // clamp to 1980-01-01
  const time = ((date.getUTCHours() & 31) << 11)
    | ((date.getUTCMinutes() & 63) << 5)
    | (Math.floor(date.getUTCSeconds() / 2) & 31);
  const d = (((y - 1980) & 127) << 9)
    | (((date.getUTCMonth() + 1) & 15) << 5)
    | (date.getUTCDate() & 31);
  return { time, date: d };
}

/* ===================================================================== */
/* 3. ZIP writer                                                          */
/* ===================================================================== */

const SIG_LOCAL = 0x04034b50;
const SIG_CEN = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800;      // bit 11; bit 3 (data descriptor) must stay 0
const M_STORE = 0;
const M_DEFLATE = 8;
const UNIX_MODE = 0o100644;

/**
 * entries: [{ name: 'icons/icon16.png', data: Buffer }]
 * opts:    { mtime: Date, level: number }
 * -> { buffer, rows: [{ name, raw, stored, method }] }
 */
function makeZip(entries, opts) {
  opts = opts || {};
  const mtime = opts.mtime || new Date(Date.UTC(1980, 0, 1));
  const level = opts.level == null ? 9 : opts.level;
  const { time, date } = dosDateTime(mtime);

  if (entries.length > MAX_ENTRIES) {
    throw new Error('refusing to write ' + entries.length + ' entries: the classic EOCD entry count is a uint16 '
      + '(limit ' + MAX_ENTRIES + ') and this writer does not implement ZIP64');
  }

  const locals = [];
  const centrals = [];
  const rows = [];
  let offset = 0;
  let totalRaw = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    if (nameBuf.includes(0x5c)) throw new Error('backslash in zip entry name: ' + e.name);
    if (e.name.startsWith('/')) throw new Error('absolute zip entry name: ' + e.name);

    const raw = e.data;
    if (raw.length > MAX_UINT32) {
      throw new Error(e.name + ' is ' + raw.length + ' bytes; sizes above 4 GiB need ZIP64, which this writer '
        + 'deliberately does not implement');
    }
    totalRaw += raw.length;
    if (totalRaw > MAX_UINT32) {
      throw new Error('total uncompressed size passed 4 GiB; ZIP64 would be required');
    }

    const crc = crc32(raw);
    let method = M_DEFLATE;
    let body = zlib.deflateRawSync(raw, { level });
    if (raw.length === 0 || body.length >= raw.length) { method = M_STORE; body = raw; }

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(SIG_LOCAL, 0);
    lfh.writeUInt16LE(20, 4);                 // version needed: 2.0
    lfh.writeUInt16LE(FLAG_UTF8, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(time, 10);
    lfh.writeUInt16LE(date, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(body.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    locals.push(lfh, nameBuf, body);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(SIG_CEN, 0);
    cdh.writeUInt16LE(0x031E, 4);             // version made by: 3 = Unix, 30 = spec 3.0
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(FLAG_UTF8, 8);          // must match the local header exactly
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(time, 12);
    cdh.writeUInt16LE(date, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(body.length, 20);
    cdh.writeUInt32LE(raw.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);                 // extra len
    cdh.writeUInt16LE(0, 32);                 // comment len
    cdh.writeUInt16LE(0, 34);                 // disk number start
    cdh.writeUInt16LE(0, 36);                 // internal attrs
    /* `>>> 0` is load-bearing: JS `<<` yields a signed int32 and writeUInt32LE
       throws ERR_OUT_OF_RANGE on the negative value. */
    cdh.writeUInt32LE((((UNIX_MODE & 0xFFFF) << 16) >>> 0), 38);
    cdh.writeUInt32LE(offset, 42);
    centrals.push(cdh, nameBuf);

    rows.push({ name: e.name, raw: raw.length, stored: body.length, method: method === M_STORE ? 'store' : 'deflate' });
    offset += lfh.length + nameBuf.length + body.length;
    if (offset > MAX_UINT32) throw new Error('archive passed 4 GiB; ZIP64 would be required');
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return { buffer: Buffer.concat([...locals, cd, eocd]), rows };
}

/* ===================================================================== */
/* 4. Reproducible timestamp                                              */
/* ===================================================================== */

function changelogDate(root, version) {
  const p = path.join(root, 'CHANGELOG.md');
  if (!version || !fs.existsSync(p)) return null;
  const re = new RegExp('^## \\[?' + version.replace(/\./g, '\\.') + '\\]?[^\\n]*$', 'm');
  const m = re.exec(fs.readFileSync(p, 'utf8'));
  if (!m) return null;
  const d = /(\d{4})-(\d{2})-(\d{2})/.exec(m[0]);
  if (!d) return null;
  return new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])));
}

function archiveTimestamp(root, version) {
  const sde = process.env.SOURCE_DATE_EPOCH;
  if (sde && /^\d+$/.test(sde)) {
    return { date: new Date(Number(sde) * 1000), source: 'SOURCE_DATE_EPOCH=' + sde };
  }
  const cd = changelogDate(root, version);
  if (cd) return { date: cd, source: 'CHANGELOG.md section for ' + version };
  return { date: new Date(Date.UTC(1980, 0, 1)), source: 'DOS epoch fallback (no SOURCE_DATE_EPOCH, no CHANGELOG date)' };
}

/* ===================================================================== */
/* 5. Build                                                               */
/* ===================================================================== */

function human(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function buildPackage(opts) {
  opts = opts || {};
  const root = opts.root || REPO_ROOT;
  const log = opts.log || ((s) => process.stdout.write(s + '\n'));

  /* ---- 1. validate gate ---- */
  if (opts.skipValidate) {
    log('!! --skip-validate: the static gate was bypassed. Never do this in CI or for a real release.');
    log('');
  } else {
    log('— running tools/validate.js —');
    const res = validate.run({ root, quiet: true, log });
    if (!res.ok) {
      log('');
      log('package: refusing to build, tools/validate.js reported ' + res.failures.length + ' failure(s):');
      for (const f of res.failures) log('    ' + f);
      return { ok: false, failures: res.failures };
    }
    log('validate clean.');
    log('');
  }

  /* ---- 2. version ---- */
  const manifestPath = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { ok: false, failures: ['manifest.json does not exist'] };
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { return { ok: false, failures: ['manifest.json did not parse: ' + e.message] }; }
  const version = manifest.version;
  if (!version) return { ok: false, failures: ['manifest.json has no version'] };

  /* ---- 3. ship list ---- */
  const { files, missing } = validate.collectShipFiles(root);
  const notes = [];
  for (const spec of missing) {
    if (!spec.optional) return { ok: false, failures: ['required ship path missing: ' + spec.rel] };
    notes.push('not packaged (optional): ' + spec.rel + (spec.note ? ' — ' + spec.note : ''));
  }
  if (files.length === 0) return { ok: false, failures: ['nothing to package'] };

  /* Sorted by name so the archive is order-stable regardless of filesystem order. */
  const names = [...files].sort();
  const entries = names.map((rel) => ({ name: rel, data: fs.readFileSync(path.join(root, rel)) }));

  /* ---- 4. zip ---- */
  const ts = archiveTimestamp(root, version);
  let zip;
  try { zip = makeZip(entries, { mtime: ts.date, level: 9 }); }
  catch (e) { return { ok: false, failures: ['zip writer: ' + e.message] }; }

  if (zip.buffer.length > MAX_ZIP_BYTES) {
    return { ok: false, failures: ['archive is ' + human(zip.buffer.length) + ', over the ' + human(MAX_ZIP_BYTES) + ' cap'] };
  }

  const outPath = opts.out
    ? path.resolve(opts.out)
    : path.join(root, 'dist', 'crash-tab-' + version + '.zip');
  const sha = crypto.createHash('sha256').update(zip.buffer).digest('hex');

  /* ---- 5. report ---- */
  const totalRaw = zip.rows.reduce((s, r) => s + r.raw, 0);
  const totalStored = zip.rows.reduce((s, r) => s + r.stored, 0);
  const nameW = Math.max(24, ...zip.rows.map((r) => r.name.length));
  log('crash-tab ' + version + ' — ' + zip.rows.length + ' file(s)');
  log('');
  log('  ' + 'path'.padEnd(nameW) + '  ' + 'raw'.padStart(10) + '  ' + 'in zip'.padStart(10) + '  method');
  log('  ' + '-'.repeat(nameW) + '  ' + '-'.repeat(10) + '  ' + '-'.repeat(10) + '  -------');
  for (const r of zip.rows) {
    log('  ' + r.name.padEnd(nameW) + '  ' + human(r.raw).padStart(10) + '  ' + human(r.stored).padStart(10) + '  ' + r.method);
  }
  log('  ' + '-'.repeat(nameW) + '  ' + '-'.repeat(10) + '  ' + '-'.repeat(10) + '  -------');
  log('  ' + 'total'.padEnd(nameW) + '  ' + human(totalRaw).padStart(10) + '  ' + human(totalStored).padStart(10));
  log('');
  for (const n of notes) log('  ' + n);
  if (notes.length) log('');
  log('  timestamp : ' + ts.date.toISOString() + '  (' + ts.source + ')');
  log('  archive   : ' + human(zip.buffer.length) + ' / ' + human(MAX_ZIP_BYTES) + ' cap');
  log('  sha256    : ' + sha);

  if (opts.dryRun) {
    log('  output    : ' + outPath + '  (--dry-run, nothing written)');
    return { ok: true, version, bytes: zip.buffer.length, sha256: sha, outPath, rows: zip.rows, written: false };
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, zip.buffer);
  log('  output    : ' + outPath);
  return { ok: true, version, bytes: zip.buffer.length, sha256: sha, outPath, rows: zip.rows, written: true };
}

/* ===================================================================== */
/* 6. CLI                                                                 */
/* ===================================================================== */

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write([
      'usage: node tools/package.js [--out <path>] [--dry-run] [--skip-validate]',
      '',
      '  --out <path>      write the archive here instead of dist/crash-tab-<version>.zip',
      '  --dry-run         build and report, write nothing (used by CI smoke checks)',
      '  --skip-validate   bypass the static gate. Local debugging only — never in CI,',
      '                    never for a release. The run prints a loud warning.',
      '',
    ].join('\n'));
    return 0;
  }
  const oi = argv.indexOf('--out');
  const res = buildPackage({
    out: oi === -1 ? null : argv[oi + 1],
    dryRun: argv.includes('--dry-run'),
    skipValidate: argv.includes('--skip-validate'),
  });
  if (!res.ok) {
    process.stdout.write('\npackage: FAILED\n');
    for (const f of res.failures || []) process.stdout.write('    ' + f + '\n');
    return 1;
  }
  return 0;
}

module.exports = { buildPackage, makeZip, crc32, dosDateTime, archiveTimestamp };

if (require.main === module) process.exit(main(process.argv.slice(2)));
