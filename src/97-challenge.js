  /* ===================================================================== */
  /* 16. 챌린지 모드 · 무기 해금 (SPEC-product §3 / §4 해금)                   */
  /*                                                                        */
  /* §3 gives the product its first END CONDITION. Everything before this    */
  /* step runs until the player gets bored; a challenge starts from a clean  */
  /* page, counts one thing, stops by itself and writes down what happened.  */
  /*                                                                        */
  /* §4's other half — the weapon unlocks — lives here too, because it is    */
  /* the same kind of thing: a number that survives the tab, read from       */
  /* storage once and written back on a debounce. The BOSS half of §4 is in  */
  /* src/90-combat.js, where the rest of the enemy code already is.          */
  /* ===================================================================== */

  /* ───────────────────────────────────────────────────────────────────────
   * §4 무기 해금 — 누적 피해로 열린다
   *
   * "기본 설정 `unlockAll: true` 라 아무도 막히지 않는다. 켜면 누적 피해로 열린다."
   * READ AS (reported): `unlockAll` is the setting and its default is TRUE, so the shipped product locks
   * nothing at all; "켜면" is the player turning the gate ON by setting unlockAll to false. Everything below
   * is therefore dormant on a default install — weaponLocked() answers false for every weapon — and the
   * cumulative damage is still counted, so switching the gate on later does not start the player at zero.
   * ─────────────────────────────────────────────────────────────────────── */
  const UNLOCK_AT = {
    smg: 5000, axe: 15000, katana: 30000, sniper: 60000,
    bomb: 100000, rocket: 180000, flame: 300000, collapse: 500000
  };
  const UNLOCK_ORDER = ['smg', 'axe', 'katana', 'sniper', 'bomb', 'rocket', 'flame', 'collapse'];
  const PROGRESS_KEY = 'crsProgress';
  const PROGRESS_VERSION = 1;
  const PROGRESS_SAVE_MS = 1500;
  const progressData = { version: PROGRESS_VERSION, totalDamage: 0, unlocked: [], loaded: false, dirty: false, timer: 0 };
  let progressSeen = 0;   // the value of state.damageDealt already folded into totalDamage

  function unlockGateOn() { return settingsGet('unlockAll') === false; }
  function unlockedAlready(id) { return progressData.unlocked.indexOf(id) !== -1; }
  /* A weapon with no threshold is never locked; neither is anything at all while the gate is off or while
   * the stored progress has not been read back yet (a slow or broken read must never take the arsenal away). */
  function weaponLocked(id) {
    if (!unlockGateOn() || !progressData.loaded) return false;
    if (!Object.prototype.hasOwnProperty.call(UNLOCK_AT, id)) return false;
    return !unlockedAlready(id);
  }
  function unlockRemaining(id) {
    const need = UNLOCK_AT[id];
    return need == null ? 0 : Math.max(0, need - progressData.totalDamage);
  }
  function unlockList() { return UNLOCK_ORDER.map((id) => ({ id, need: UNLOCK_AT[id], unlocked: !weaponLocked(id), remaining: unlockRemaining(id) })); }

  function progressSave() {
    progressData.timer = 0;
    if (!progressData.dirty) return;
    progressData.dirty = false;
    const payload = { version: PROGRESS_VERSION, totalDamage: Math.round(progressData.totalDamage), unlocked: progressData.unlocked.slice() };
    const patch = {}; patch[PROGRESS_KEY] = payload;
    safe(() => chrome.storage.local.set(patch));
  }
  function progressQueueSave() {
    progressData.dirty = true;
    if (progressData.timer) return;
    progressData.timer = later(() => progressSave(), PROGRESS_SAVE_MS);
  }
  /* Which thresholds the new total has just crossed. Crossing one is announced once, and only while the
   * gate is actually on — nobody wants a toast about unlocking something they were never missing. */
  function progressUnlockCheck() {
    const opened = [];
    for (const id of UNLOCK_ORDER) {
      if (unlockedAlready(id)) continue;
      if (progressData.totalDamage < UNLOCK_AT[id]) continue;
      progressData.unlocked.push(id);
      opened.push(id);
    }
    if (!opened.length) return opened;
    progressQueueSave();
    if (unlockGateOn() && state.active) {
      const W = WEAPONS[opened[0]];
      toast('🔓 ' + msg('toastUnlocked') + ' ' + W.emoji + ' ' + msg(W.name));
    }
    syncLockedSlots();
    return opened;
  }
  function progressAdd(n) {
    if (!(n > 0)) return;
    progressData.totalDamage += n;
    progressQueueSave();
    progressUnlockCheck();
  }
  /* state.damageDealt is the session counter the HUD already prints; the cumulative total is its integral.
   * restore() zeroes it, which reads here as "the baseline moved" rather than as negative damage. */
  function progressSample() {
    const d = state.damageDealt;
    if (!isFinite(d)) return;
    if (d < progressSeen) { progressSeen = d; return; }
    if (d > progressSeen) { const add = d - progressSeen; progressSeen = d; progressAdd(add); }
  }
  function progressRead() {
    safeThen(() => chrome.storage.local.get([PROGRESS_KEY]), (res) => {
      const raw = res && res[PROGRESS_KEY];
      if (raw && typeof raw === 'object') {
        const t = Number(raw.totalDamage);
        if (isFinite(t) && t >= 0) progressData.totalDamage = t;
        if (Array.isArray(raw.unlocked)) {
          for (const id of raw.unlocked) if (typeof id === 'string' && UNLOCK_AT[id] != null && !unlockedAlready(id)) progressData.unlocked.push(id);
        }
      }
      progressData.loaded = true;
      progressUnlockCheck();   // a stored total above a threshold opens it even if the list was short
      syncLockedSlots();
    });
    /* No local storage at all (an old Chrome, a shimmed harness): the gate stays open rather than closed.
     * "망가진 저장값이 활성화를 막아서는 안 된다" is §6's sentence, and the same rule is right here. */
    if (safe(() => chrome.storage.local) === undefined) progressData.loaded = true;
  }

  /* §4 "잠긴 슬롯은 흐리게 🔒 와 남은 수치를 보인다."
   * Called from updateHud(), which runs once a frame while a hold weapon is firing — so it has to cost
   * nothing when there is nothing to say. With the gate off (the default) the signature is a constant and
   * the second call onwards returns on the first line; with it on, only a change in the cumulative damage
   * or in what is unlocked does any DOM work, and even then each node is written only if it differs. */
  let lockSig = '';
  function syncLockedSlots() {
    if (!hudEls.weaponBtns || !hudEls.lockTags) { lockSig = ''; return; }
    const gate = unlockGateOn() && progressData.loaded;
    const sig = gate ? ('1:' + Math.round(progressData.totalDamage) + ':' + progressData.unlocked.length) : '0';
    if (sig === lockSig) return;
    lockSig = sig;
    for (const id of WEAPON_IDS) {
      const b = hudEls.weaponBtns[id], tag = hudEls.lockTags[id];
      if (!b || !tag) continue;
      try {
        const locked = weaponLocked(id);
        b.classList.toggle('locked', locked);
        const want = locked ? 'true' : 'false';
        if (b.getAttribute('aria-disabled') !== want) b.setAttribute('aria-disabled', want);
        const text = locked ? '🔒 ' + unlockRemaining(id) : '';
        if (tag.textContent !== text) tag.textContent = text;
      } catch (e) { /* ignore */ }
    }
  }
  /* The gate itself. Wrapped rather than inlined into setWeapon() so §4 owns its own rule: a locked weapon
   * is simply not selectable, and nothing about the swap, the reload or the HUD had to learn about locks. */
  const setWeaponUnlock = setWeapon;
  setWeapon = function (rawId, opts) {
    const id = migrateWeaponId(rawId);
    if (weaponLocked(id) && id !== state.weapon) {
      const W = WEAPONS[id];
      if (!(opts && opts.silent) && W) toast('🔒 ' + msg('toastLocked') + ' · ' + W.emoji + ' ' + msg(W.name) + ' · ' + unlockRemaining(id));
      return false;
    }
    return setWeaponUnlock(rawId, opts);
  };

  /* ───────────────────────────────────────────────────────────────────────
   * §3 챌린지 모드
   *
   * | timeAttack | 60초, 점수 최대화 | 시간 종료 |
   * | targetRush | 40개를 가장 빨리  | 40개 파괴 |
   * | survival   | 전투 강제, 난이도 가파르게 | KO |
   *
   * AMBIGUITY, reading chosen (reported). §3 says survival "전투 강제" without naming WHICH combat mode, and
   * the product has two (arcade · survival). Taken as: whatever combat mode the player last chose, falling
   * back to the drone mode — the same rule state.combat's setter has used since v1.4, so a challenge never
   * silently changes how the player controls the game. "난이도 가파르게" is read as the enemy attack interval
   * ramping down to 40 % over the first 60 seconds (chalIntervalMul(), multiplied into attackInterval()).
   * timeAttack and targetRush leave the mode alone: they are about the page, not about the fight.
   * ─────────────────────────────────────────────────────────────────────── */
  const CHAL_IDS = ['timeAttack', 'targetRush', 'survival'];
  const CHAL_NAME = { timeAttack: 'chalTimeAttack', targetRush: 'chalTargetRush', survival: 'chalSurvivalRun' };
  const CHAL_TIME_MS = 60000;      // timeAttack
  const CHAL_TARGETS = 40;         // targetRush
  const CHAL_TICK_MS = 200;
  const CHAL_RAMP_MS = 60000;      // survival: the window the difficulty ramp is spread over
  const CHAL_RAMP_MIN = 0.4;       // …down to 40 % of the usual interval
  const chal = {
    id: null, startedAt: 0, endsAt: 0, timer: 0, broken0: 0,
    result: null, resultNode: null, restores: 0, lastEnd: null
  };
  const chalRecords = Object.create(null);   // mode -> { plays, bestScore, bestMs, lastScore, lastMs, lastAt }

  function chalRunning() { return !!chal.id; }
  function chalElapsed() { return chal.startedAt ? Math.max(0, now() - chal.startedAt) : 0; }
  /* Read by attackInterval() (src/90-combat.js) on every schedule. 1 unless a 생존 challenge is running. */
  function chalIntervalMul() {
    if (chal.id !== 'survival') return 1;
    const k = clamp(chalElapsed() / Math.max(1, scaleMs(CHAL_RAMP_MS)), 0, 1);
    return 1 - (1 - CHAL_RAMP_MIN) * k;
  }
  function chalBrokenNow() { return Math.max(0, state.broken.length - chal.broken0); }
  function chalProgress() {
    if (chal.id === 'timeAttack') return clamp(chalElapsed() / Math.max(1, chal.endsAt - chal.startedAt), 0, 1);
    if (chal.id === 'targetRush') return clamp(chalBrokenNow() / CHAL_TARGETS, 0, 1);
    if (chal.id === 'survival') return clamp(1 - state.player.hp / Math.max(1, state.player.max), 0, 1);
    return 0;
  }
  function chalLabel() {
    if (chal.id === 'timeAttack') return msg('chalTimeAttack') + ' · ' + msg('chalRemain') + ' ' + Math.max(0, Math.ceil((chal.endsAt - now()) / 1000)) + msg('unitSec') + ' · ' + msg('labelScore') + ' ' + state.player.score;
    if (chal.id === 'targetRush') return msg('chalTargetRush') + ' · ' + msg('chalTargets') + ' ' + chalBrokenNow() + '/' + CHAL_TARGETS;
    return msg('chalSurvivalRun') + ' · ' + msg('labelTime') + ' ' + Math.floor(chalElapsed() / 1000) + msg('unitSec') + ' · ' + msg('labelKills') + ' ' + state.player.kills;
  }
  function chalHud() {
    const n = hudEls.chal;
    if (!n || !n.box) return;
    const on = !!(state.active && chalRunning());
    try {
      n.box.classList.toggle('on', on);
      if (hudEls.fallback) n.box.style.display = on ? 'block' : 'none';
      if (!on) return;
      n.label.textContent = chalLabel();
      n.fill.style.width = (chalProgress() * 100).toFixed(1) + '%';
    } catch (e) { /* ignore */ }
  }
  function chalTick() {
    chal.timer = 0;
    if (!state.active || !chalRunning()) { chalHud(); return; }
    if (chal.id === 'timeAttack' && now() >= chal.endsAt) { chalEnd('time'); return; }
    if (chal.id === 'targetRush' && chalBrokenNow() >= CHAL_TARGETS) { chalEnd('targets'); return; }
    if (chal.id === 'survival' && (state.ko || !state.player.alive)) { chalEnd('ko'); return; }
    chalHud();
    chal.timer = laterRaw(chalTick, CHAL_TICK_MS);
  }
  function chalArm() {
    untrack(chal.timer);
    chal.timer = chalRunning() && state.active ? laterRaw(chalTick, CHAL_TICK_MS) : 0;
  }

  /* ---- records: crsStats.challenges[mode] (§3's last sentence) -------------------------------------
   * §2 (누적 통계) belongs to a later workstream and owns the rest of crsStats. This touches ONE key of
   * it — `challenges` — with a read-modify-write that preserves every other field, so the two can land in
   * either order without either one losing the other's data. */
  const STATS_KEY = 'crsStats';
  function chalRecordsRead() {
    safeThen(() => chrome.storage.local.get([STATS_KEY]), (res) => {
      const raw = res && res[STATS_KEY] && res[STATS_KEY].challenges;
      if (!raw || typeof raw !== 'object') return;
      for (const id of CHAL_IDS) {
        const r = raw[id];
        if (!r || typeof r !== 'object') continue;
        chalRecords[id] = {
          plays: Number(r.plays) || 0,
          bestScore: Number(r.bestScore) || 0,
          bestMs: Number(r.bestMs) || 0,
          lastScore: Number(r.lastScore) || 0,
          lastMs: Number(r.lastMs) || 0,
          lastAt: Number(r.lastAt) || 0
        };
      }
    });
  }
  /* "최고" is not the same number in all three modes: timeAttack maximises SCORE, targetRush minimises the
   * TIME it took, survival maximises the time survived. One field (`bestMs`) with a per-mode comparison
   * keeps the stored shape uniform while still meaning the right thing in each. */
  function chalIsBest(id, score, ms, completed) {
    const rec = chalRecords[id];
    if (!rec || !rec.plays) return true;
    if (id === 'timeAttack') return score > rec.bestScore;
    if (id === 'targetRush') return completed && (!rec.bestMs || ms < rec.bestMs);
    return ms > rec.bestMs;
  }
  function chalRecordWrite(id, score, kills, ms, completed, best) {
    const prev = chalRecords[id] || { plays: 0, bestScore: 0, bestMs: 0, lastScore: 0, lastMs: 0, lastAt: 0 };
    const rec = {
      plays: prev.plays + 1,
      bestScore: Math.max(prev.bestScore, score),
      bestMs: best ? ms : prev.bestMs,
      lastScore: score, lastKills: kills, lastMs: ms, lastAt: Date.now()
    };
    if (id === 'targetRush' && !completed) rec.bestMs = prev.bestMs;   // an abandoned rush sets no record
    chalRecords[id] = rec;
    safeThen(() => chrome.storage.local.get([STATS_KEY]), (res) => {
      const stats = (res && res[STATS_KEY] && typeof res[STATS_KEY] === 'object') ? res[STATS_KEY] : {};
      const ch = (stats.challenges && typeof stats.challenges === 'object') ? stats.challenges : {};
      ch[id] = rec;
      stats.challenges = ch;
      const patch = {}; patch[STATS_KEY] = stats;
      safe(() => chrome.storage.local.set(patch));
    });
    return rec;
  }

  /* ---- the result overlay (§3: 모드·점수·처치·소요·최고 기록 갱신 여부, 다시 (Enter) / 닫기 (Esc)) ---- */
  function chalResultOpen() { return !!chal.resultNode; }
  function chalResultClose() {
    const n = chal.resultNode;
    chal.resultNode = null;
    if (n) { try { cancelAnimsOf(n); n.remove(); } catch (e) { /* ignore */ } }
  }
  function chalResultShow(r) {
    chalResultClose();
    if (!hudEls.mount) return;
    try {
      const box = mk('div', 'crs-result');
      const rt = doc.createElement('div'); rt.className = 'rt'; rt.textContent = '🏁 ' + msg('chalResult');
      const rs = doc.createElement('div'); rs.className = 'rs';
      rs.textContent = msg(CHAL_NAME[r.mode]) + ' · ' + msg('labelScore') + ' ' + r.score + ' · ' + msg('labelKills') + ' ' + r.kills
        + ' · ' + msg('chalElapsed') + ' ' + (r.elapsedMs / 1000).toFixed(1) + msg('unitSec');
      const rb2 = doc.createElement('div'); rb2.className = 'rbest'; rb2.textContent = r.best ? '🏆 ' + msg('chalNewBest') : '';
      const rb = doc.createElement('div'); rb.className = 'rb';
      rb.append(
        hudButton(msg('chalRetry') + ' (Enter)', msg('chalRetry') + ' (Enter)', () => chalRetry()),
        hudButton(msg('chalClose') + ' (Esc)', msg('chalClose') + ' (Esc)', () => chalResultClose())
      );
      box.append(rt, rs, rb2, rb);
      box.classList.add('show');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', msg('chalResult'));
      if (hudEls.fallback) {
        const s = box.style;
        s.position = 'fixed'; s.left = '0'; s.top = '0'; s.right = '0'; s.bottom = '0'; s.background = 'rgba(0,0,0,.78)';
        s.color = '#fff'; s.display = 'flex'; s.alignItems = 'center'; s.justifyContent = 'center'; s.flexDirection = 'column';
        s.pointerEvents = 'auto'; s.font = '16px system-ui, sans-serif';
        for (const b of box.querySelectorAll('button')) { b.style.margin = '4px'; b.style.padding = '6px 12px'; b.style.color = '#fff'; b.style.background = 'rgba(255,255,255,.15)'; b.style.border = '1px solid rgba(255,255,255,.3)'; b.style.borderRadius = '8px'; b.style.cursor = 'pointer'; }
      }
      hudEls.mount.append(box);
      chal.resultNode = box;
      const btns = box.querySelectorAll('button');
      if (btns.length) { try { btns[0].focus(); } catch (e) { /* ignore */ } }
    } catch (e) { chal.resultNode = null; }
  }
  function chalRetry() {
    const id = (chal.result && chal.result.mode) || chal.id;
    chalResultClose();
    if (id) challengeStart(id);
  }

  /* ---- start / stop / end ---- */
  function challengeStart(mode) {
    if (!state.active || CHAL_IDS.indexOf(mode) === -1) return false;
    chalResultClose();
    chal.id = null;                       // so restore()'s updateHud does not draw a half-started run
    untrack(chal.timer); chal.timer = 0;
    /* §3: "시작 시 restore() 를 먼저 불러 깨끗한 페이지에서 출발한다." */
    restore();
    chal.restores++;
    if (mode === 'survival' && !modeHasEnemies()) setPlayMode(state.lastCombatMode || 'survival');
    chal.id = mode;
    chal.startedAt = now();
    chal.endsAt = chal.startedAt + scaleMs(CHAL_TIME_MS);
    chal.broken0 = state.broken.length;
    chal.result = null;
    announceChallenge(true);
    toast('🏁 ' + msg('labelChallenge') + ': ' + msg(CHAL_NAME[mode]));
    chalHud();
    chalArm();
    return mode;
  }
  function challengeStop(silent) {
    if (!chalRunning()) return false;
    chal.id = null;
    untrack(chal.timer); chal.timer = 0;
    chalHud();
    announceChallenge(false);
    if (!silent) toast(msg('chalStopped'));
    return true;
  }
  function chalEnd(reason) {
    const id = chal.id;
    if (!id) return null;
    const ms = Math.round(chalElapsed());
    const score = state.player.score, kills = state.player.kills;
    const completed = reason === 'time' || reason === 'targets' || reason === 'ko';
    const best = chalIsBest(id, score, ms, reason === 'targets');
    chal.id = null;
    untrack(chal.timer); chal.timer = 0;
    chalHud();
    const r = { mode: id, reason, score, kills, elapsedMs: ms, broken: chalBrokenNow(), completed, best, at: Date.now() };
    chal.result = r; chal.lastEnd = r;
    chalRecordWrite(id, score, kills, ms, reason === 'targets', best);
    announceChallenge(false);
    chalResultShow(r);
    return r;
  }
  function challengeState() {
    return {
      mode: chal.id, running: chalRunning(),
      elapsedMs: chalRunning() ? Math.round(chalElapsed()) : 0,
      remainMs: chal.id === 'timeAttack' ? Math.max(0, Math.round(chal.endsAt - now())) : 0,
      targets: CHAL_TARGETS, broken: chalRunning() ? chalBrokenNow() : 0,
      progress: chalRunning() ? chalProgress() : 0,
      score: state.player.score, kills: state.player.kills,
      intervalMul: chalIntervalMul(),
      resultOpen: chalResultOpen(), result: chal.result ? Object.assign({}, chal.result) : null,
      records: challengeRecords(), restores: chal.restores
    };
  }
  function challengeRecords() {
    const out = {};
    for (const id of CHAL_IDS) if (chalRecords[id]) out[id] = Object.assign({}, chalRecords[id]);
    return out;
  }
  /* `C` cycles off → 타임어택 → 목표 돌파 → 생존 → off (§3: "C 키로 순환"). */
  function challengeCycle() {
    const i = chal.id ? CHAL_IDS.indexOf(chal.id) : -1;
    const next = CHAL_IDS[i + 1];
    if (!next) { challengeStop(); return null; }
    return challengeStart(next);
  }

  /* ---- lifecycle ---------------------------------------------------------------------------------
   * restore() clears every tracked timer, so the challenge tick is re-armed behind it exactly as the perf
   * sample and the a11y layer are (src/99-api.js). deactivate() ends the run outright. */
  const restoreChal = restore;
  restore = function () {
    restoreChal();
    progressSeen = 0;        // restore() zeroed state.damageDealt; the cumulative total keeps what it had
    if (!state.active) return;
    chalArm();
    chalHud();
    bossBarSync();
  };
  const deactivateChal = deactivate;
  deactivate = function (silent) {
    challengeStop(true);
    chalResultClose();
    untrack(chal.timer); chal.timer = 0;
    progressSave();          // whatever is still owed goes to disk before the page lets go
    untrack(progressData.timer); progressData.timer = 0;
    const r = deactivateChal(silent);
    untrack(state.bossTimer); state.bossTimer = 0;
    state.bossRespawnAt = 0; state.slowmoUntil = 0; state.bossNodes = null;
    return r;
  };

  debug.challengeRecordsReset = () => { for (const id of CHAL_IDS) delete chalRecords[id]; return true; };
  debug.setProgress = (n) => {
    n = Number(n);
    if (!isFinite(n) || n < 0) return progressData.totalDamage;
    progressData.totalDamage = n;
    progressData.unlocked.length = 0;
    progressData.loaded = true;
    progressUnlockCheck();
    syncLockedSlots();
    return progressData.totalDamage;
  };
  debug.unlockInfo = () => ({
    gate: unlockGateOn(), loaded: progressData.loaded, totalDamage: Math.round(progressData.totalDamage),
    unlocked: progressData.unlocked.slice(), locked: WEAPON_IDS.filter(weaponLocked), list: unlockList()
  });
  debug.challengeEnd = () => chalEnd('forced');

  /* The public surface is attached in src/99-api.js: `api` is a `const` declared there, so touching it from
   * here — which the bundle evaluates first — would hit its temporal dead zone. These two are what that file
   * publishes as api.challenge / api.progress. */
  const CHALLENGE_API = {
    start: (mode) => challengeStart(mode),
    stop: () => challengeStop(),
    state: () => challengeState(),
    cycle: () => challengeCycle(),
    records: () => challengeRecords(),
    modes: () => CHAL_IDS.slice()
  };
  function progressInfo() {
    return {
      totalDamage: Math.round(progressData.totalDamage),
      unlocked: progressData.unlocked.slice(),
      locked: WEAPON_IDS.filter(weaponLocked),
      thresholds: Object.assign({}, UNLOCK_AT),
      gate: unlockGateOn()
    };
  }

  progressRead();
  chalRecordsRead();
