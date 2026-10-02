  /* Small helpers + the Korean fallback strings. v1.3 §1 drops labelPower / btnPowerDown / btnPowerUp;
   * §3.4 adds dodgeLabel (the 회피! call-out beside the player ring). */
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const px = (v) => (Math.round(v * 100) / 100) + 'px';

  /* safe(): run fn in try/catch; swallow promise rejections too (A3). */
  function safe(fn) {
    try {
      const r = fn();
      if (r && typeof r.then === 'function') r.then(null, () => {});
      return r;
    } catch (e) { return undefined; }
  }
  function safeThen(fn, cb) {
    const r = safe(fn);
    if (r && typeof r.then === 'function') r.then((v) => { try { cb(v); } catch (e) { /* ignore */ } }, () => {});
    else if (r !== undefined) { try { cb(r); } catch (e) { /* ignore */ } }
  }
  function gcs(el) { try { return gcsRaw(el); } catch (e) { return null; } }
  function rectOf(el) { try { return el.getBoundingClientRect(); } catch (e) { return null; } }
  function tagOf(el) { return (el && el.localName) ? String(el.localName).toLowerCase() : ''; }
  function parentOf(el) { return el ? (el.parentElement || (el.parentNode && el.parentNode.host) || null) : null; }
  function viewW() { return docEl.clientWidth || win.innerWidth; }
  function viewH() { return docEl.clientHeight || win.innerHeight; }
  function isOurs(n) { return !!(n && n.nodeType === 1 && n.closest && n.closest('[data-crs]')); }
  function alphaOf(color) {
    if (!color) return 1;
    if (color === 'transparent') return 0;
    const m = /rgba?\(([^)]+)\)/.exec(color);
    if (!m) return 1;
    const parts = m[1].split(/[\s,\/]+/).filter(Boolean);
    return parts.length >= 4 ? parseFloat(parts[3]) : 1;
  }
  function mk(tag, cls) {
    const n = doc.createElement(tag);
    n.className = cls;
    n.setAttribute('data-crs', '1');
    return n;
  }
  function imp(node, prop, val) { try { node.style.setProperty(prop, val, 'important'); } catch (e) { /* ignore */ } }
  function countDescendants(el, cap) {
    let n = 0;
    try {
      const w = doc.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
      while (w.nextNode()) { if (++n >= cap) break; }
    } catch (e) { /* ignore */ }
    return n;
  }

  /* i18n with hard-coded Korean fallbacks */
  const KO = {
    hudTitle: '화면부수기',
    weaponHammer: '망치', weaponPistol: '권총', weaponSmg: '기관총', weaponSniper: '저격총', weaponAxe: '도끼', weaponSword: '검', weaponBomb: '폭탄',
    weaponRocket: '로켓', weaponFlame: '화염방사기', weaponFlameShort: '화염', weaponCollapse: '붕괴',
    hudDamage: '피해', critLabel: '치명타!', headshotLabel: '헤드샷!', unitPerShot: '/발', unitPerTick: '/틱',
    btnSound: '소리', btnMute: '음소거', btnRestore: '복구', btnExit: '종료',
    hudHint: '클릭해서 화면을 부수세요', hudHintHold: '꾹 눌러서 발사', hudHintDrag: '드래그해서 베기',
    hudHintCollapse: '복구(Z)로 되돌릴 수 있어요', hudHintScope: '클릭해서 발사 · 오른쪽 버튼이나 Shift로 조준해요',
    hudPieces: '조각', hudCracks: '균열',
    // v1.2
    labelLoadout: '로드아웃', presetDefault: '기본', presetAssault: '돌격', presetSniper: '저격', presetExplosive: '폭발', presetMelee: '근접', presetCustom: '사용자 지정',
    labelCombat: '전투', labelHealth: '체력', labelScore: '점수', labelKills: '처치', labelTime: '생존', labelEnemies: '적',
    koTitle: '당신은 부서졌습니다', koRestart: '다시 시작', koExit: '종료', killLabel: '처치!',
    toastCombatOn: '⚔️ 전투 모드: 큰 요소들이 반격해요 (H로 끄기)', toastCombatOff: '전투 모드 꺼짐', toastReload: '재장전', labelSwapping: '교체 중',
    // v1.3 (§2 / §3.4): the dodge call-out next to the player ring
    dodgeLabel: '회피!',
    unitSec: '초',
    // v1.5 (§3.3): the two extra stats in the weapon-button tooltip
    statCrit: '치명', statSwap: '교체'
  };
  function msg(key) {
    const s = safe(() => chrome.i18n.getMessage(key));
    return (typeof s === 'string' && s) ? s : (KO[key] || key);
  }
