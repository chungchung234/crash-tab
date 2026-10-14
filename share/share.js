/* 화면부수기 — 결과 공유 페이지 (SPEC-product §5).
 *
 * background.js put the capture in chrome.storage.session under `crsShare`; this page composites the
 * caption band (제목·출처·모드·점수·처치·조각·피해·시각) onto it with a canvas and offers 저장 and
 * 클립보드 복사. No network, no external resource, no new permission — and no innerHTML / eval, exactly
 * as the injected code is held to (tools/validate.js R9 checks this directory).
 */
'use strict';

(function () {
  const SHARE_KEY = 'crsShare';
  const BAND = 108;            // caption band height in device pixels of the capture
  const PAD = 28;

  const $ = (id) => document.getElementById(id);
  function t(key) {
    try { const s = chrome.i18n.getMessage(key); if (s) return s; } catch (e) { /* ignore */ }
    return key;
  }
  function setText(el, s) { if (el) el.textContent = s; }

  const MODE_KEY = { rampage: 'modeRampage', arcade: 'modeArcade', survival: 'modeSurvival' };

  function captionLines(cap) {
    cap = cap || {};
    const when = cap.at ? new Date(cap.at) : new Date();
    const pad2 = (n) => (n < 10 ? '0' + n : String(n));
    const stamp = when.getFullYear() + '-' + pad2(when.getMonth() + 1) + '-' + pad2(when.getDate())
      + ' ' + pad2(when.getHours()) + ':' + pad2(when.getMinutes());
    const head = (cap.title || '').slice(0, 72) + (cap.origin ? '  ·  ' + cap.origin : '');
    const stats = [
      t(MODE_KEY[cap.mode] || 'modeRampage'),
      t('labelScore') + ' ' + (cap.score || 0),
      t('labelKills') + ' ' + (cap.kills || 0),
      t('hudPieces') + ' ' + (cap.pieces || 0),
      t('hudDamage') + ' ' + (cap.damage || 0),
      stamp
    ].join('   ·   ');
    return { head, stats };
  }

  function draw(img, cap) {
    const c = $('shot');
    const w = img.naturalWidth || img.width || 1280;
    const h = img.naturalHeight || img.height || 800;
    c.width = w;
    c.height = h + BAND;
    const g = c.getContext('2d');
    if (!g) return false;
    g.fillStyle = '#0c0f16';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, w, h);

    // the band itself
    g.fillStyle = '#0c0f16';
    g.fillRect(0, h, w, BAND);
    g.fillStyle = 'rgba(255, 209, 102, .9)';
    g.fillRect(0, h, w, 3);

    const lines = captionLines(cap);
    const fontStack = 'system-ui, -apple-system, "Segoe UI", Roboto, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#ffd166';
    g.font = '800 26px ' + fontStack;
    g.fillText('🔨 ' + t('shareTitle'), PAD, h + 38);
    g.fillStyle = 'rgba(233, 242, 255, .92)';
    g.font = '600 18px ' + fontStack;
    g.fillText(lines.head, PAD, h + 66);
    g.fillStyle = 'rgba(233, 242, 255, .74)';
    g.font = '16px ' + fontStack;
    g.fillText(lines.stats, PAD, h + 92);
    // the frame stays hidden until there is something in it, so no blank canvas ever flashes
    $('frame').hidden = false;
    return true;
  }

  function toBlob() {
    return new Promise((resolve) => {
      try { $('shot').toBlob((b) => resolve(b), 'image/png'); }
      catch (e) { resolve(null); }
    });
  }

  async function save() {
    const b = await toBlob();
    if (!b) { setText($('status'), t('shareNone')); return; }
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'crash-tab-' + Date.now() + '.png';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function copy() {
    const b = await toBlob();
    if (!b) { setText($('status'), t('shareNone')); return; }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
      setText($('status'), t('shareCopied'));
    } catch (e) {
      setText($('status'), t('shareNone'));
    }
  }

  function showEmpty() {
    $('empty').hidden = false;
    $('frame').hidden = true;
    $('save').disabled = true;
    $('copy').disabled = true;
  }

  async function main() {
    document.title = t('shareTitle');
    setText($('title'), t('shareTitle'));
    setText($('save'), t('shareSave'));
    setText($('copy'), t('shareCopy'));
    setText($('empty'), t('shareNone'));
    setText($('note'), t('appDesc'));
    $('save').addEventListener('click', () => { save(); });
    $('copy').addEventListener('click', () => { copy(); });

    let rec = null;
    try {
      const res = await chrome.storage.session.get([SHARE_KEY]);
      rec = res && res[SHARE_KEY];
    } catch (e) { rec = null; }
    if (!rec || typeof rec.dataUrl !== 'string') { showEmpty(); return; }

    const img = new Image();
    img.addEventListener('load', () => { if (!draw(img, rec.caption)) showEmpty(); });
    img.addEventListener('error', () => showEmpty());
    img.src = rec.dataUrl;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { main(); });
  else main();
})();
