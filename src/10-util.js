  /* Small helpers + the Korean fallback strings. v1.3 §1 drops labelPower / btnPowerDown / btnPowerUp;
   * §3.4 adds dodgeLabel (the 회피! call-out beside the player ring). */
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const px = (v) => (Math.round(v * 100) / 100) + 'px';

  /* ── SPEC-test-speed §3: the debug time scale ──────────────────────────────
   * Spec names this pair `dur()`; it is `scaleMs()` here because `dur` is already a local variable in five
   * product functions (32-material, 35-effects, 40-audio, 46-viewmodel, 65-pieces) and every fragment shares
   * ONE closure — a top-level `dur` would be shadowed inside exactly the functions that schedule timers.
   * Clamped to [0.05, 1]: a test may speed the product up, never slow it down. Non-numeric / NaN reads as 1. */
  function timeScale() {
    const s = Number(debug.timeScale);
    return isFinite(s) ? clamp(s, 0.05, 1) : 1;
  }
  function scaleMs(ms) { return (typeof ms === 'number' && isFinite(ms)) ? ms * timeScale() : ms; }
  /* Read-back for SPEC-test-speed §8 test 2: debug.scaledMs(3000) reports what the clamp actually applied,
   * so a test can prove `timeScale = 2` behaves as 1 without timing a three-second lock to find out. */
  debug.scaledMs = (ms) => scaleMs(ms);
  debug.timeScaleNow = () => timeScale();

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
    weaponHammer: '망치', weaponPistol: '권총', weaponSmg: '기관총', weaponSniper: '저격총', weaponAxe: '도끼', weaponKatana: '카타나', weaponBomb: '폭탄',
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
    statCrit: '치명', statSwap: '교체',
    // ── v1.4: the three modes, the lock-on, the repair meter, the depth tags and the control card ──
    modeRampage: '램페이지', modeArcade: '아케이드', modeSurvival: '서바이벌',
    modeRampageDesc: '적 없이 부수기', modeArcadeDesc: '커서로 피하며 쏘기', modeSurvivalDesc: '드론으로 피하며 쏘기',
    lockBlocked: '차단!', labelRatio: '파괴율', labelDominating: '제압!',
    hintCovered: '가려짐', hintPierce: '관통 가능', hintEnemyBehind: '뒤에 적',
    helpMove: '이동', helpDash: '대시', helpAim: '마우스로 조준',
    setDebrisLife: '파편이 사라지는 시간',
    // ── SPEC-settings §2.3 / §3.3 / §3.4: the only new strings content.js itself renders ──
    // (the other setting labels are read from settings-schema.json by the options page, step 10)
    setPerfMode: '성능 모드', perfBadge: '성능 모드',
    toastKeyboardAim: '키보드 조준: 방향키로 이동 · Space 발사 · Enter 조준경 · Tab 다음 대상',
    a11yWeapon: '무기', a11yReloadStart: '재장전 시작', a11yReloadDone: '재장전 완료',
    a11yMode: '모드', a11yKo: '패배', a11yRepair: '복구',
    a11yChallengeStart: '챌린지 시작', a11yChallengeEnd: '챌린지 종료',
    // ── SPEC-combat §B1: the word a deflected hit prints instead of a damage number ──
    invulLabel: '무적',
    // ── SPEC-combat §D1: what the meter says while the roster is empty ──
    scanningEnemies: '적 탐색 중…',
    /* ── SPEC-product (10단계) §3 챌린지 · §4 보스와 해금 · §5 인스펙터·공유·리플레이 ──────────────
     * Every string the product renders has a hard-coded Korean fallback here: chrome.i18n is unavailable
     * in a page whose extension context has gone away (and in the e2e harness's shim), and a HUD that
     * prints its own message keys is a broken HUD. The _locales files carry the same keys for both locales. */
    labelChallenge: '챌린지', chalTimeAttack: '타임어택', chalTargetRush: '목표 돌파', chalSurvivalRun: '생존',
    chalResult: '챌린지 결과', chalNewBest: '최고 기록 갱신!', chalRetry: '다시', chalClose: '닫기',
    chalRemain: '남은 시간', chalTargets: '목표', chalElapsed: '소요', chalStopped: '챌린지를 멈췄어요',
    labelBoss: '보스', bossArrived: '👑 보스 등장!', bossDown: '👑 보스 격파!',
    toastLocked: '아직 잠긴 무기예요', toastUnlocked: '무기 해금!',
    setUnlockAll: '모든 무기 잠금 해제', setRecordReplay: '리플레이 기록',
    inspectOn: '🔍 인스펙터 — 클릭하면 선택자를 복사해요 (I로 끄기)', inspectOff: '인스펙터 모드 꺼짐',
    inspectCopied: '선택자 복사됨', inspectSelector: '선택자', inspectBox: '박스', inspectFont: '글꼴',
    inspectColors: '색', inspectContrast: '대비', inspectStacking: '쌓임', inspectRole: '역할',
    inspectName: '이름', inspectChildren: '자식', inspectFail: '미달',
    shareFailed: '이 페이지는 캡처할 수 없어요', shareOpened: '공유 이미지를 열었어요', shareTitle: '화면부수기 결과',
    shareSave: '저장', shareCopy: '클립보드 복사', shareCopied: '복사했어요', shareNone: '공유할 이미지가 없어요',
    replayBadge: '▶ 리플레이 재생 중', replayScaled: '뷰포트가 달라 좌표를 보정했어요',
    replayDone: '리플레이 재생 끝', replayBad: '리플레이 파일이 올바르지 않아요'
  };
  function msg(key) {
    const s = safe(() => chrome.i18n.getMessage(key));
    return (typeof s === 'string' && s) ? s : (KO[key] || key);
  }
