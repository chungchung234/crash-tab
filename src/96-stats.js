  /* =====================================================================
   * SPEC-product §2 누적 통계 — 기기 밖으로 나가지 않는다
   *
   * `chrome.storage.local` 의 `crsStats`:
   *   { version, firstUse, lastUse, sessions, msPlayed, totalDamage, totalBroken, totalKills,
   *     totalRestores, totalExits, bestScore, perOrigin: { origin: { bestScore, broken, plays, lastPlayed } } }
   *
   * 쓰기는 **읽고-고치고-쓰기**다. §3 (챌린지)가 같은 키의 `challenges` 를 쓰고 있고, 두 작업이
   * 서로의 데이터를 잃지 않아야 한다 — src/97-challenge.js 가 먼저 그렇게 해 두었다. 그래서 이
   * 모듈은 메모리에 **델타만** 쌓고, 플러시 때 디스크에 있는 레코드를 복사한 위에 더한다.
   * 덕분에 다른 탭이 같은 키를 건드려도 그쪽이 쓴 필드가 사라지지 않는다.
   *
   * `collectLocalStats: false` 면 아무것도 읽지 않고 아무것도 쓰지 않는다 (§2).
   *
   * 고른 해석 (명세가 말하지 않은 것):
   *  - §2 가 요구하는 파생 지표 중 **"최근 7일 사용 일수"** 는 명세의 필드 목록만으로는 계산할 수
   *    없다 (lastUse 하나로는 며칠을 썼는지 알 수 없다). 그래서 `days` — `YYYY-MM-DD` 문자열의
   *    배열, 최근 30개 — 를 하나 더 둔다. 명세의 필드는 하나도 빼지 않았고 이것만 더했다.
   *  - **초기화는 §2 의 필드만 지운다.** `challenges`(§3)와 다른 작업물이 넣은 키는 그대로 둔다 —
   *    "누적 통계 초기화" 버튼이 챌린지 기록까지 조용히 가져가면 안 된다.
   *  - 출처(origin)는 `location.origin` 이다. `file://` · `data:` 처럼 origin 이 `"null"` 인
   *    문서는 프로토콜로 센다.
   * ===================================================================== */
  const LIFE_KEY = 'crsStats';
  const LIFE_VERSION = 1;
  const LIFE_FLUSH_MS = 30000;      // §2 "활성 중 30초마다 기록(디바운스)"
  const LIFE_ORIGIN_CAP = 200;      // §2 "출처 200개 상한, 가장 오래 안 쓴 것부터 퇴출"
  const LIFE_DAY_KEEP = 30;
  const LIFE = {
    timer: 0,            // NOT a tracked timer: restore() clears the ledger and the 30 s debounce has to
                         // survive a 복구. deactivate() below clears it explicitly instead.
    startedAt: 0,
    exiting: false,      // true while deactivate() is running, so its internal restore() is not a 복구
    snap: null,          // last-sampled counter values (the product's counters reset on restore/activate)
    d: null              // pending deltas
  };
  function lifeEnabled() { return settingsGet('collectLocalStats') === true; }
  function lifeOrigin() {
    let o = '';
    try { o = String(location.origin || ''); } catch (e) { o = ''; }
    if (!o || o === 'null') { try { o = String(location.protocol || 'unknown'); } catch (e) { o = 'unknown'; } }
    return o.slice(0, 120);
  }
  function lifeDay(ms) {
    const dt = new Date(ms);
    const p = (n) => (n < 10 ? '0' + n : String(n));
    return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
  }
  function lifeZero() {
    return {
      sessions: 0, msPlayed: 0, totalDamage: 0, totalBroken: 0, totalKills: 0,
      totalRestores: 0, totalExits: 0, bestScore: 0,
      origins: Object.create(null), days: []
    };
  }
  function lifeDeltas() {
    if (!LIFE.d) LIFE.d = lifeZero();
    return LIFE.d;
  }
  function lifeOriginDelta(origin) {
    const d = lifeDeltas();
    if (!d.origins[origin]) d.origins[origin] = { bestScore: 0, broken: 0, plays: 0 };
    return d.origins[origin];
  }
  /* The product's own counters are not monotone across a session: restore() empties state.broken and
   * activate() resets the player. A sample that went DOWN means the counter was reset, so everything it
   * currently holds is new. */
  function lifeStep(cur, prev) { return cur >= prev ? cur - prev : cur; }
  function lifeSample() {
    if (!LIFE.snap) return;
    const d = lifeDeltas();
    const o = lifeOriginDelta(LIFE.snap.origin);
    const dmg = Math.max(0, Math.round(state.damageDealt) || 0);
    const br = state.broken.length;
    const ki = Math.max(0, state.player.kills || 0);
    const sc = Math.max(0, Math.round(state.player.score) || 0);
    const addDmg = lifeStep(dmg, LIFE.snap.damage);
    const addBr = lifeStep(br, LIFE.snap.broken);
    const addKi = lifeStep(ki, LIFE.snap.kills);
    d.totalDamage += addDmg;
    d.totalBroken += addBr;
    d.totalKills += addKi;
    o.broken += addBr;
    if (sc > d.bestScore) d.bestScore = sc;
    if (sc > o.bestScore) o.bestScore = sc;
    if (LIFE.startedAt) {
      const t = Date.now();
      d.msPlayed += Math.max(0, t - LIFE.startedAt);
      LIFE.startedAt = t;
    }
    LIFE.snap.damage = dmg; LIFE.snap.broken = br; LIFE.snap.kills = ki;
  }
  function lifeHasDeltas() {
    const d = LIFE.d;
    if (!d) return false;
    if (d.sessions || d.msPlayed || d.totalDamage || d.totalBroken || d.totalKills
      || d.totalRestores || d.totalExits || d.bestScore || d.days.length) return true;
    for (const k in d.origins) if (Object.prototype.hasOwnProperty.call(d.origins, k)) return true;
    return false;
  }
  /* Read-modify-write. `stored` is COPIED first, so `challenges` (§3) and anything a later workstream
   * puts under the same key survive untouched. */
  function lifeMerge(stored, d) {
    const s = (stored && typeof stored === 'object' && !Array.isArray(stored)) ? stored : {};
    const n = Object.assign({}, s);
    const now0 = Date.now();
    const num = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);
    n.version = LIFE_VERSION;
    n.firstUse = num(s.firstUse) || now0;
    n.lastUse = now0;
    n.sessions = num(s.sessions) + d.sessions;
    n.msPlayed = num(s.msPlayed) + d.msPlayed;
    n.totalDamage = num(s.totalDamage) + d.totalDamage;
    n.totalBroken = num(s.totalBroken) + d.totalBroken;
    n.totalKills = num(s.totalKills) + d.totalKills;
    n.totalRestores = num(s.totalRestores) + d.totalRestores;
    n.totalExits = num(s.totalExits) + d.totalExits;
    n.bestScore = Math.max(num(s.bestScore), d.bestScore);

    const src = (s.perOrigin && typeof s.perOrigin === 'object' && !Array.isArray(s.perOrigin)) ? s.perOrigin : {};
    const po = {};
    for (const k of Object.keys(src)) {
      const r = src[k];
      if (!r || typeof r !== 'object') continue;
      po[k] = { bestScore: num(r.bestScore), broken: num(r.broken), plays: num(r.plays), lastPlayed: num(r.lastPlayed) };
    }
    for (const k of Object.keys(d.origins)) {
      const dd = d.origins[k];
      const r = po[k] || { bestScore: 0, broken: 0, plays: 0, lastPlayed: 0 };
      po[k] = {
        bestScore: Math.max(r.bestScore, dd.bestScore),
        broken: r.broken + dd.broken,
        plays: r.plays + dd.plays,
        lastPlayed: now0
      };
    }
    /* §2 "출처 200개 상한, 가장 오래 안 쓴 것부터 퇴출" — LRU by lastPlayed. */
    const keys = Object.keys(po);
    if (keys.length > LIFE_ORIGIN_CAP) {
      keys.sort((a, b) => po[b].lastPlayed - po[a].lastPlayed);
      for (const k of keys.slice(LIFE_ORIGIN_CAP)) delete po[k];
    }
    n.perOrigin = po;

    const days = (Array.isArray(s.days) ? s.days : []).filter((x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x));
    for (const day of d.days) if (days.indexOf(day) === -1) days.push(day);
    days.sort();
    n.days = days.slice(Math.max(0, days.length - LIFE_DAY_KEEP));
    return n;
  }
  function lifeFlush(cb) {
    lifeSample();
    if (LIFE.timer) { try { clearT(LIFE.timer); } catch (e) { /* ignore */ } LIFE.timer = 0; }
    if (!lifeEnabled() || !lifeHasDeltas()) { if (cb) { try { cb(null); } catch (e) { /* ignore */ } } return false; }
    const d = LIFE.d;
    LIFE.d = null;
    safeThen(() => chrome.storage.local.get([LIFE_KEY]), (res) => {
      const merged = lifeMerge(res ? res[LIFE_KEY] : null, d);
      const patch = {}; patch[LIFE_KEY] = merged;
      safe(() => chrome.storage.local.set(patch));
      if (cb) { try { cb(merged); } catch (e) { /* ignore */ } }
    });
    return true;
  }
  function lifeArm() {
    if (LIFE.timer || !lifeEnabled() || !state.active) return;
    /* setT, not later(): a 복구 clears the tracked-timer ledger and this debounce has to outlive it.
     * deactivate() clears it by hand, so nothing of it survives the session either (CLAUDE.md 무흔적). */
    LIFE.timer = setT(() => { LIFE.timer = 0; lifeFlush(); lifeArm(); }, LIFE_FLUSH_MS);
  }
  function lifeStart() {
    if (!lifeEnabled()) { LIFE.snap = null; return; }
    const origin = lifeOrigin();
    const d = lifeDeltas();
    d.sessions++;
    lifeOriginDelta(origin).plays++;
    const day = lifeDay(Date.now());
    if (d.days.indexOf(day) === -1) d.days.push(day);
    LIFE.startedAt = Date.now();
    LIFE.snap = { origin, damage: Math.max(0, Math.round(state.damageDealt) || 0), broken: state.broken.length, kills: Math.max(0, state.player.kills || 0) };
    lifeArm();
  }
  /* Called from the deactivate wrapper AFTER the product has torn itself down. The sample was already
   * taken on the way in (the counters are zero by now), so this only books the exit and writes. */
  function lifeStop() {
    if (LIFE.timer) { try { clearT(LIFE.timer); } catch (e) { /* ignore */ } LIFE.timer = 0; }
    if (!lifeEnabled()) { LIFE.snap = null; LIFE.startedAt = 0; return; }
    lifeDeltas().totalExits++;
    LIFE.snap = null;                  // nothing more to sample; lifeFlush()'s own lifeSample() no-ops
    LIFE.startedAt = 0;
    lifeFlush();                       // §2 "종료 시 … 기록"
  }
  /* §2 파생 지표 셋: 평균 세션 길이 · 복구 비율(복구/(복구+종료)) · 최근 7일 사용 일수.
   * The options page computes the same three from the same record (it cannot call into the content
   * script); the formulas are three lines and are written out in both places rather than shipped twice. */
  function lifeDerive(rec) {
    const r = rec || {};
    const sessions = Number(r.sessions) || 0;
    const restores = Number(r.totalRestores) || 0;
    const exits = Number(r.totalExits) || 0;
    const days = Array.isArray(r.days) ? r.days : [];
    const cutoff = lifeDay(Date.now() - 6 * 86400000);
    return {
      avgSessionMs: sessions > 0 ? Math.round((Number(r.msPlayed) || 0) / sessions) : 0,
      restoreRatio: (restores + exits) > 0 ? restores / (restores + exits) : 0,
      activeDays7: days.filter((d) => d >= cutoff).length
    };
  }
  function lifeTopOrigins(rec, n) {
    const po = (rec && rec.perOrigin && typeof rec.perOrigin === 'object') ? rec.perOrigin : {};
    return Object.keys(po)
      .map((k) => Object.assign({ origin: k }, po[k]))
      .sort((a, b) => (b.broken - a.broken) || (b.plays - a.plays))
      .slice(0, n || 10);
  }
  /* §2 "api.lifetime() 으로 읽는다." Flushes first so the number a caller sees includes this session. */
  function lifeNow() {
    return new Promise((resolve) => {
      if (!lifeEnabled()) { resolve({ enabled: false, version: LIFE_VERSION }); return; }
      /* safeThen() swallows a storage area that is not there at all, so a bare await would hang on a page
       * whose chrome.storage.local is missing. The guard timer answers instead — and is cleared the moment
       * the real read lands, so it never lingers in the timer ledger (CLAUDE.md 무흔적). */
      let guard = 0;
      const done = (out) => { if (guard) { try { clearT(guard); } catch (e) { /* ignore */ } guard = 0; } resolve(out); };
      guard = setT(() => { guard = 0; resolve({ enabled: true, version: LIFE_VERSION, derived: lifeDerive(null), topOrigins: [] }); }, 1500);
      lifeFlush(() => {
        safeThen(() => chrome.storage.local.get([LIFE_KEY]), (res) => {
          const rec = (res && res[LIFE_KEY] && typeof res[LIFE_KEY] === 'object') ? res[LIFE_KEY] : {};
          const out = Object.assign({ enabled: true }, rec);
          out.derived = lifeDerive(rec);
          out.topOrigins = lifeTopOrigins(rec, 10);
          done(out);
        });
      });
    });
  }
  /* §2 "초기화는 명시적 확인 후." The confirmation is the options page's; this is the act itself, and it
   * keeps `challenges` (§3) and anything else stored under the key. */
  function lifeReset() {
    LIFE.d = null;
    if (LIFE.snap) LIFE.snap = { origin: LIFE.snap.origin, damage: Math.max(0, Math.round(state.damageDealt) || 0), broken: state.broken.length, kills: Math.max(0, state.player.kills || 0) };
    return new Promise((resolve) => {
      let guard = setT(() => { guard = 0; resolve(false); }, 1500);
      const done = (v) => { if (guard) { try { clearT(guard); } catch (e) { /* ignore */ } guard = 0; } resolve(v); };
      safeThen(() => chrome.storage.local.get([LIFE_KEY]), (res) => {
        const s = (res && res[LIFE_KEY] && typeof res[LIFE_KEY] === 'object') ? res[LIFE_KEY] : {};
        const keep = Object.assign({}, s);
        for (const k of ['firstUse', 'lastUse', 'sessions', 'msPlayed', 'totalDamage', 'totalBroken',
          'totalKills', 'totalRestores', 'totalExits', 'bestScore', 'perOrigin', 'days']) delete keep[k];
        keep.version = LIFE_VERSION;
        keep.firstUse = Date.now();
        keep.lastUse = Date.now();
        keep.sessions = 0; keep.msPlayed = 0; keep.totalDamage = 0; keep.totalBroken = 0;
        keep.totalKills = 0; keep.totalRestores = 0; keep.totalExits = 0; keep.bestScore = 0;
        keep.perOrigin = {}; keep.days = [];
        const patch = {}; patch[LIFE_KEY] = keep;
        safe(() => chrome.storage.local.set(patch));
        done(true);
      });
    });
  }

  /* ---- lifecycle wrappers ------------------------------------------------------------
   * The same binding-rewrite device src/99-api.js uses: the bundle is one closure and a function
   * declaration's binding is writable, so this layer nests INSIDE the wrappers src/97, src/98 and
   * src/99 add later (they capture whatever `activate` / `restore` / `deactivate` are when they run). */
  const LIFE_BASE = { activate, deactivate, restore };
  activate = function () {
    LIFE_BASE.activate();
    try { lifeStart(); } catch (e) { /* 통계가 활성화를 막는 일은 없다 */ }
  };
  /* restore() ZEROES the product's counters (src/99-api.js: state.shots / damageDealt / cracks …), so the
   * sample has to be taken BEFORE it runs. Taking it after was good for exactly one wrong answer: every
   * session recorded 0 damage and 0 broken, because the only two moments §2 writes at — a 복구 and the
   * 종료 (which calls restore() on its way out) — are both on the far side of that reset. */
  deactivate = function (silent) {
    const wasActive = state.active;
    if (wasActive) { try { lifeSample(); } catch (e) { /* ignore */ } }
    LIFE.exiting = true;
    try {
      return LIFE_BASE.deactivate(silent);
    } finally {
      LIFE.exiting = false;
      if (wasActive) { try { lifeStop(); } catch (e) { /* ignore */ } }
      else if (LIFE.timer) { try { clearT(LIFE.timer); } catch (e) { /* ignore */ } LIFE.timer = 0; }
    }
  };
  restore = function () {
    /* deactivate() calls restore() on its way out; that is an EXIT, not a 복구, and counting it would
     * make §2's 복구 비율 (복구 / (복구 + 종료)) read 0.5 for someone who never pressed Z. */
    const user = state.active && !LIFE.exiting;
    if (user) { try { lifeSample(); } catch (e) { /* ignore */ } }
    const r = LIFE_BASE.restore();
    if (user && lifeEnabled()) {
      try {
        lifeDeltas().totalRestores++;
        /* the counters are back at zero now; the snapshot has to follow them or the next sample would
         * read the whole of the next 복구 as a decrease and add it twice */
        if (LIFE.snap) { LIFE.snap.damage = 0; LIFE.snap.broken = 0; LIFE.snap.kills = Math.max(0, state.player.kills || 0); }
        lifeArm();
      } catch (e) { /* ignore */ }
    }
    return r;
  };
