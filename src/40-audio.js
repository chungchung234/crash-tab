  /* ===================================================================== */
  /* 5. Sound (Web Audio, synthesized)                                      */
  /*    v1.3 adds alert / whiff / hurtbig — the three cues of §3.2, §3.4, §3.5 */
  /* ===================================================================== */
  const audio = { ctx: null, master: null, noise: null, boomAt: [], loop: null, burn: null };   // boomAt: start times of recent boom voices (A24 cap 2); loop: flame noise (v1.1); burn: the ONE §F3 crackle loop
  function ensureAudio() {
    if (audio.ctx) { try { if (audio.ctx.state === 'suspended') safe(() => audio.ctx.resume()); } catch (e) { /* ignore */ } return; }
    try {
      const AC = win.AudioContext || win.webkitAudioContext;
      if (!AC) return;
      const c = new AC();
      const master = c.createGain(); master.gain.value = soundGain();   // SPEC-settings §1.2: soundVolume (0–100, default 28)
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 6;
      master.connect(comp); comp.connect(c.destination);
      const len = Math.floor(c.sampleRate * 1.0);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      audio.ctx = c; audio.master = master; audio.noise = buf;
      if (c.state === 'suspended') safe(() => c.resume());
    } catch (e) { audio.ctx = null; }
  }
  function env(c, t0, g, decay) {
    const gn = c.createGain();
    gn.gain.setValueAtTime(Math.max(0.0001, g), t0);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    gn.connect(audio.master);
    return gn;
  }
  function noiseBurst(t0, dur, filt, g, decay) {
    const c = audio.ctx;
    const src = c.createBufferSource(); src.buffer = audio.noise;
    src.playbackRate.value = rand(0.92, 1.08);
    let node = src;
    if (filt) { const f = c.createBiquadFilter(); f.type = filt.type; f.frequency.value = filt.freq; f.Q.value = filt.Q || 0.8; src.connect(f); node = f; }
    node.connect(env(c, t0, g, decay));
    src.start(t0); src.stop(t0 + dur + 0.02);
  }
  /* Filtered noise whose cutoff sweeps f0 → f1 over dur (katana swish, rocket whoosh — v1.1 A10). */
  function noiseSweep(t0, dur, type, f0, f1, g) {
    const c = audio.ctx;
    const src = c.createBufferSource(); src.buffer = audio.noise;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    src.connect(f); f.connect(env(c, t0, g, dur));
    src.start(t0); src.stop(t0 + dur + 0.02);
  }
  /* Flamethrower loop: looping lowpass noise, started on hold start, stopped on hold end / mute / deactivate. */
  function startLoop() {
    if (!audio.ctx || audio.loop || state.muted) return;
    try {
      const c = audio.ctx;
      if (c.state === 'suspended') safe(() => c.resume());
      const src = c.createBufferSource(); src.buffer = audio.noise; src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const g = c.createGain(); g.gain.value = 0.12;
      src.connect(f); f.connect(g); g.connect(audio.master);
      src.start();
      audio.loop = { src, g };
    } catch (e) { audio.loop = null; }
  }
  function stopLoop() {
    const l = audio.loop;
    if (!l) return;
    audio.loop = null;
    try { l.src.stop(); } catch (e) { /* ignore */ }
    try { l.src.disconnect(); l.g.disconnect(); } catch (e) { /* ignore */ }
  }
  /* ── SPEC-destruction §F3: the burn loop ──────────────────────────────────────────────────────────
   * "타닥거리는 저역 노이즈 루프 **하나**. 볼륨이 연소 요소 수에 비례한다. 요소마다 소리를 내면 귀가
   * 아프다." So there is exactly ONE node chain for every fire on the page, however many there are, and
   * burnAudioSync() (src/77-burn.js) only ever moves its gain. A crackle — not the flamethrower's hiss —
   * so it is a lowpass at 320 Hz with a slow wobble on the cutoff, which is what makes it tick and pop. */
  const BURN_GAIN_PER_EL = 0.028, BURN_GAIN_MAX = 0.16;
  function startBurnLoop() {
    if (!audio.ctx || audio.burn || state.muted) return;
    try {
      const c = audio.ctx;
      if (c.state === 'suspended') safe(() => c.resume());
      const src = c.createBufferSource(); src.buffer = audio.noise; src.loop = true;
      src.playbackRate.value = 0.55;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320; f.Q.value = 2.4;
      const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 7;
      const lfoGain = c.createGain(); lfoGain.gain.value = 180;
      lfo.connect(lfoGain); lfoGain.connect(f.frequency);
      const g = c.createGain(); g.gain.value = BURN_GAIN_PER_EL;
      src.connect(f); f.connect(g); g.connect(audio.master);
      src.start(); lfo.start();
      audio.burn = { src, f, g, lfo, lfoGain };
    } catch (e) { audio.burn = null; }
  }
  function setBurnGain(n) {
    const b = audio.burn;
    if (!b) return;
    try { b.g.gain.value = Math.min(BURN_GAIN_MAX, BURN_GAIN_PER_EL * Math.max(0, n)); } catch (e) { /* ignore */ }
  }
  function stopBurnLoop() {
    const b = audio.burn;
    if (!b) return;
    audio.burn = null;
    try { b.src.stop(); b.lfo.stop(); } catch (e) { /* ignore */ }
    try { b.src.disconnect(); b.f.disconnect(); b.g.disconnect(); b.lfo.disconnect(); b.lfoGain.disconnect(); } catch (e) { /* ignore */ }
  }
  /* §G read-back: "오디오 노드는 하나뿐이고 볼륨만 달라진다" is a claim about the GRAPH, so the graph is
   * what the test reads — how many loop chains exist and what gain the one chain is at. */
  function burnAudio() {
    const b = audio.burn;
    let gain = 0;
    try { gain = b ? b.g.gain.value : 0; } catch (e) { gain = 0; }
    return { nodes: b ? 1 : 0, gain: Math.round(gain * 1000) / 1000, ctx: !!audio.ctx };
  }
  debug.burnAudio = () => burnAudio();
  function tone(t0, type, f0, f1, dur, g, decay) {
    const c = audio.ctx;
    const o = c.createOscillator(); o.type = type;
    const k = rand(0.92, 1.08);
    o.frequency.setValueAtTime(f0 * k, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * k), t0 + dur);
    o.connect(env(c, t0, g, decay || dur));
    o.start(t0); o.stop(t0 + Math.max(dur, decay || 0) + 0.05);
  }
  function sfx(kind, opts) {
    if (state.muted || !audio.ctx) return;
    const c = audio.ctx;
    try {
      if (c.state === 'suspended') { safe(() => c.resume()); }
      const t = c.currentTime + 0.001;
      const gm = rand(0.85, 1.15) * ((opts && opts.gain) || 1);
      const pitch = (opts && opts.pitch) || 1;          // axe 0.75: thump 110→45 becomes ≈ 82→34 Hz (A10)
      const crit = !!(opts && opts.crit) || kind === 'crit';
      const critK = crit ? 1.5 : 1;                     // crit feel (A4): tink partials ×1.5
      const comboK = 1 + 0.03 * Math.min(12, Math.max(0, state.combo - 1));
      const thump = (g) => tone(t, 'sine', 110 * comboK * pitch, 45 * pitch, 0.14, g, 0.16);
      const tinks = (n, stagger, g) => { for (let i = 0; i < n; i++) { tone(t + i * stagger, 'triangle', (i % 2 ? 4600 : 3100) * critK, (i % 2 ? 4400 : 3000) * critK, 0.07, g, 0.07); } };
      const glass = () => noiseBurst(t, 0.06, { type: 'highpass', freq: 5000, Q: 0.7 }, 0.12 * gm, 0.06);
      if (kind === 'hammer') { noiseBurst(t, 0.15, { type: 'bandpass', freq: 1800, Q: 0.8 }, 0.9 * gm, 0.12); thump(0.8 * gm); tinks(2, 0.012, 0.08 * gm); glass(); }
      else if (kind === 'thump') { thump(0.6 * gm); noiseBurst(t, 0.08, { type: 'bandpass', freq: 900, Q: 0.9 }, 0.3 * gm, 0.07); if (crit) tinks(2, 0.012, 0.08 * gm); }   // a dent that crits still sparkles (A4)
      else if (kind === 'gun') { noiseBurst(t, 0.045, { type: 'highpass', freq: 2500, Q: 0.7 }, 0.8 * gm, 0.045); tone(t, 'square', 1000, 900, 0.01, 0.25 * gm, 0.012); glass(); if (crit) tinks(1, 0, 0.07 * gm); }
      else if (kind === 'bomb' || kind === 'rumble') {
        const t0 = now();
        audio.boomAt = audio.boomAt.filter((x) => t0 - x < 700);
        if (audio.boomAt.length < 2) {
          audio.boomAt.push(t0);
          tone(t, 'sine', 70, 24, 0.7, (kind === 'rumble' ? 0.6 : 1) * 1.2 * gm, 0.7);
          noiseBurst(t, 0.55, { type: 'lowpass', freq: 420, Q: 0.8 }, (kind === 'rumble' ? 0.6 : 1) * 0.9 * gm, 0.5);
        }
        if (kind === 'bomb') { tinks(3, 0.03, 0.1 * gm); glass(); }
      }
      else if (kind === 'swish') { noiseSweep(t, 0.09, 'highpass', 2000, 6000, 0.5 * gm); tinks(1, 0, 0.08 * gm); }   // katana stab
      /* SPEC-destruction §D2, the katana's three layers. Composed from the voices already here, so there is
       * still no new audio graph: the DRAW is metal sliding on air, the AIR is the blade's own wake, and the
       * RING only ever plays when something was really cut — "허공을 그으면 울림이 없다". */
      else if (kind === 'katanaDraw') { noiseSweep(t, 0.07, 'highpass', 2000, 6000, 0.55 * gm); if (crit) tinks(1, 0, 0.08 * gm); }
      else if (kind === 'katanaAir') { noiseBurst(t, 0.12, { type: 'bandpass', freq: 1200, Q: 1.4 }, 0.34 * gm, 0.12); }
      else if (kind === 'katanaRing') { tone(t, 'triangle', 2600, 2500, 0.14, 0.17 * gm, 0.14); tone(t + 0.008, 'triangle', 3900, 3750, 0.14, 0.12 * gm, 0.14); }
      else if (kind === 'whoosh') { noiseSweep(t, 0.15, 'bandpass', 200, 1200, 0.6 * gm); }                            // rocket travel
      else if (kind === 'puff') { noiseBurst(t, 0.09, { type: 'lowpass', freq: 900, Q: 0.8 }, 0.3 * gm, 0.09); if (crit) tinks(1, 0, 0.06 * gm); }      // single flame tick
      /* SPEC-destruction §F2 / §F3: the short "화악" of fire taking hold somewhere new — a rising band of
       * noise over a quick low swell, so a spread is heard as an EVENT against the steady crackle loop. */
      else if (kind === 'flare') { noiseSweep(t, 0.17, 'bandpass', 420, 2400, 0.42 * gm); tone(t, 'sine', 160, 90, 0.16, 0.22 * gm, 0.18); }
      else if (kind === 'clack') { tone(t, 'square', 320, 300, 0.03, 0.15, 0.03); }                                   // cooldown reject (A3) / bolt clicks
      else if (kind === 'crit') { tinks(2, 0.012, 0.08 * gm); }   // the ×1.5 sparkle on its own: per-element AoE crits and hold-window crits (A4)
      // v1.2 (A5): tone / noise combos only, no new audio graph
      else if (kind === 'sniper') { noiseBurst(t, 0.12, { type: 'highpass', freq: 1800, Q: 0.7 }, 1.1 * gm, 0.12); tone(t, 'sine', 55, 40, 0.35, 0.9 * gm, 0.35); glass(); if (crit) tinks(2, 0.012, 0.08 * gm); }
      else if (kind === 'empty') { tone(t, 'square', 180, 120, 0.03, 0.18, 0.03); }
      else if (kind === 'magout') { tone(t, 'square', 260, 200, 0.04, 0.16, 0.05); noiseBurst(t, 0.03, { type: 'bandpass', freq: 1200, Q: 1 }, 0.2 * gm, 0.03); }
      else if (kind === 'magin') { tone(t, 'square', 420, 360, 0.04, 0.18, 0.05); noiseBurst(t, 0.03, { type: 'bandpass', freq: 2200, Q: 1 }, 0.25 * gm, 0.03); }
      else if (kind === 'scopeIn') { tone(t, 'square', 900, 800, 0.02, 0.12, 0.03); noiseBurst(t + 0.03, 0.3, { type: 'lowpass', freq: 600, Q: 0.6 }, 0.08 * gm, 0.3); }
      else if (kind === 'scopeOut') { tone(t, 'square', 700, 600, 0.02, 0.12, 0.03); }
      else if (kind === 'kill') { tone(t, 'triangle', 500, 1400, 0.18, 0.25 * gm, 0.2); tone(t + 0.08, 'triangle', 800, 1800, 0.14, 0.2 * gm, 0.16); }
      else if (kind === 'hurt') { tone(t, 'sine', 90, 40, 0.2, 0.8 * gm, 0.22); noiseBurst(t, 0.12, { type: 'lowpass', freq: 500, Q: 0.8 }, 0.4 * gm, 0.12); }
      else if (kind === 'pop') { tone(t, 'sine', 600, 200, 0.06, 0.3 * gm, 0.08); noiseBurst(t, 0.03, { type: 'highpass', freq: 3000, Q: 0.7 }, 0.2 * gm, 0.03); }
      // v1.3 §3.2 / §3.4 / §3.5: "something is aiming at you", "that one went past you", "that one hit you"
      else if (kind === 'alert') { tone(t, 'sine', 220, 220, 0.12, 0.32 * gm, 0.14); }
      else if (kind === 'whiff') { noiseSweep(t, 0.09, 'highpass', 900, 7000, 0.45 * gm); }
      else if (kind === 'hurtbig') { tone(t, 'sine', 90, 40, 0.25, 1.15 * gm, 0.28); noiseBurst(t, 0.08, { type: 'lowpass', freq: 420, Q: 0.9 }, 0.6 * gm, 0.09); }
      else if (kind === 'laser') { noiseSweep(t, 0.4, 'bandpass', 3000, 600, 0.5 * gm); tone(t, 'sawtooth', 220, 180, 0.4, 0.15 * gm, 0.4); }
      /* SPEC-combat §B1: the shot that bounced. A bare triangle at 2.2 kHz for 60 ms — no noise burst, no
       * thump, no glass: nothing it shares with 'gun' / 'hammer' / 'sniper', so "that did nothing" is told
       * apart from "that hit" by ear alone, which is the whole point of the cue. */
      else if (kind === 'deflect') { tone(t, 'triangle', 2200, 2050, 0.06, 0.3 * gm, 0.07); }
      /* ── SPEC-arsenal §A3 / §B: the charge, its ceiling, and the two new weapons ──
       * §A3 names the charge tone exactly: "음정이 올라가는 톤(사인 180→420Hz), 최대에서 짧은 클릭". The tone
       * is a single oscillator whose frequency ramps across the WHOLE charge window, so the ear tracks the
       * ring without looking at it — `opts.ms` is that window, scaled like every other time constant so a
       * fast-clock test does not hear a two-second drone over a 60 ms charge. */
      else if (kind === 'charge') {
        const dur = clamp(scaleMs((opts && opts.ms) || 600) / 1000, 0.05, 2);
        tone(t, 'sine', 180, 420, dur, 0.17 * gm, dur);
      }
      else if (kind === 'chargeMax') { tone(t, 'square', 1500, 1400, 0.018, 0.2 * gm, 0.02); tinks(1, 0, 0.06 * gm); }
      /* §B2 레이저: the loop tick is a thin bright buzz, the pulse a short bright stab, and 과열 a falling
       * hiss that can only be the sound of something being shut down. */
      else if (kind === 'laserLoop') { tone(t, 'sawtooth', 1750, 1700, 0.07, 0.07 * gm, 0.07); noiseBurst(t, 0.05, { type: 'highpass', freq: 6000, Q: 0.8 }, 0.07 * gm, 0.05); }
      else if (kind === 'laserPulse') { noiseSweep(t, 0.12, 'bandpass', 5200, 1400, 0.5 * gm); tone(t, 'sawtooth', 900, 2400, 0.1, 0.22 * gm, 0.12); }
      else if (kind === 'overheat') { noiseSweep(t, 0.5, 'lowpass', 3200, 300, 0.45 * gm); tone(t, 'sine', 300, 70, 0.45, 0.3 * gm, 0.5); }
      /* §B3 미니건 예열: 총열이 돌기 시작하는 0.8초. A rising motor whine with a noise bed under it. */
      else if (kind === 'spinup') { tone(t, 'sawtooth', 70, 230, 0.75, 0.2 * gm, 0.8); noiseSweep(t, 0.75, 'bandpass', 180, 900, 0.3 * gm); }
      /* ── SPEC-arsenal §C 상호작용 · §D 예능 (8단계) ──
       * Still no new audio graph: every one of these is the same tone() / noiseBurst() / noiseSweep() trio
       * the rest of the file is made of. What makes them readable is that they do NOT share a profile with
       * anything already here — a push, a tow, a bounce, a toy hammer, water, a horn and a rubber chicken
       * have to be told apart by ear with the HUD out of view.
       * 충격포: 피해가 아니라 압력이다 — a low thud with a wide noise front and no metal in it at all. */
      else if (kind === 'shockwave') { tone(t, 'sine', 140, 38, 0.3, 0.9 * gm, 0.34); noiseSweep(t, 0.26, 'lowpass', 1800, 240, 0.55 * gm); }
      /* 견인 광선: a hum that RISES while it takes hold and falls when it lets go — the same two voices,
       * swept the other way, so grabbing and dropping are one gesture heard in both directions. */
      else if (kind === 'tractor') { tone(t, 'triangle', 180, 430, 0.28, 0.17 * gm, 0.3); noiseSweep(t, 0.26, 'bandpass', 500, 1600, 0.16 * gm); }
      else if (kind === 'tractorOff') { tone(t, 'triangle', 430, 170, 0.2, 0.15 * gm, 0.22); }
      /* 고무탄: a short pitch-bent "boing". A sine sliding UP and straight back down is the whole trick. */
      else if (kind === 'boing') { tone(t, 'sine', 240, 820, 0.07, 0.3 * gm, 0.08); tone(t + 0.06, 'sine', 780, 230, 0.12, 0.26 * gm, 0.14); if (crit) tinks(1, 0, 0.06 * gm); }
      /* 뿅망치: the "뿅" §D names. A squeak is a fast rise with a puff of air under it — high, soft, silly. */
      else if (kind === 'squeak') { tone(t, 'sine', 700, 1500, 0.07, 0.26 * gm, 0.08); tone(t + 0.05, 'sine', 1400, 620, 0.09, 0.2 * gm, 0.1); noiseBurst(t, 0.05, { type: 'highpass', freq: 3200, Q: 0.7 }, 0.12 * gm, 0.05); }
      /* 물총: filtered noise, no tone at all — water has no pitch. */
      else if (kind === 'water') { noiseSweep(t, 0.12, 'bandpass', 900, 2600, 0.3 * gm); noiseBurst(t, 0.06, { type: 'lowpass', freq: 1400, Q: 0.6 }, 0.14 * gm, 0.07); }
      /* 나팔: a brass honk — a sawtooth with a flat tail and an octave above it. */
      else if (kind === 'horn') { tone(t, 'sawtooth', 300, 290, 0.3, 0.3 * gm, 0.32); tone(t + 0.01, 'sawtooth', 600, 585, 0.26, 0.14 * gm, 0.28); noiseBurst(t, 0.05, { type: 'bandpass', freq: 1800, Q: 1.2 }, 0.1 * gm, 0.06); }
      /* 고무 치킨: two squawks, the second lower and later, because one is a squeak and two is a chicken. */
      else if (kind === 'chicken') { tone(t, 'sawtooth', 820, 520, 0.09, 0.2 * gm, 0.1); tone(t + 0.1, 'sawtooth', 620, 330, 0.11, 0.17 * gm, 0.13); noiseBurst(t + 0.02, 0.05, { type: 'bandpass', freq: 2400, Q: 1.6 }, 0.1 * gm, 0.06); }
      /* ── SPEC-arsenal §E 무기 다양화 (9단계) ──
       * 여섯 개 전부 기존의 tone() / noiseBurst() / noiseSweep() 세 가지로만 만든다. 새 오디오 그래프는
       * 없다. 구분의 기준도 §C/§D 때와 같다 — HUD 를 안 보고 **귀로만** 다른 무기임을 알 수 있을 것.
       * 샷건: 넓은 저역 충격과 그 위의 산탄 쇳소리. 권총보다 낮고, 폭탄보다 짧다. */
      else if (kind === 'shotgun') { noiseSweep(t, 0.16, 'lowpass', 2600, 420, 0.85 * gm); tone(t, 'square', 180, 60, 0.12, 0.42 * gm, 0.14); noiseBurst(t + 0.02, 0.07, { type: 'highpass', freq: 3800, Q: 0.8 }, 0.26 * gm, 0.08); }
      /* 한 발씩 장전: 약실에 한 발 밀어 넣는 소리. 재장전 막대가 한 발마다 다시 차는 것과 짝이다. */
      else if (kind === 'shell') { noiseBurst(t, 0.045, { type: 'bandpass', freq: 1500, Q: 2.4 }, 0.3 * gm, 0.05); tone(t + 0.03, 'square', 420, 300, 0.04, 0.12 * gm, 0.05); }
      /* 못총: 공압이다. 짧은 쉿 소리 뒤에 금속이 박히는 딱 소리 — 총성이 아니다. */
      else if (kind === 'nail') { noiseBurst(t, 0.03, { type: 'highpass', freq: 5200, Q: 0.7 }, 0.2 * gm, 0.035); tone(t + 0.02, 'square', 1800, 900, 0.035, 0.22 * gm, 0.045); }
      /* 냉각총: 음정이 없는 가는 고역 분사. 물총보다 높고 차갑고, 레이저와 달리 톤이 섞이지 않는다. */
      else if (kind === 'freeze') { noiseSweep(t, 0.09, 'highpass', 2600, 7200, 0.22 * gm); }
      /* 서리 파편: 유리가 얼어붙는 소리 — 위로 치솟는 삼각파 둘과 잔금. */
      else if (kind === 'frostShard') { tone(t, 'triangle', 900, 2600, 0.12, 0.26 * gm, 0.14); tone(t + 0.04, 'triangle', 1400, 3200, 0.1, 0.16 * gm, 0.12); tinks(3, 0.03, 0.09 * gm); }
      /* 중력탄: 유일하게 **내려가는** 소리다. 빨려 들어가는 것에는 올라가는 음이 붙으면 안 된다. */
      else if (kind === 'gravity') { tone(t, 'sine', 520, 40, 0.5, 0.34 * gm, 0.55); noiseSweep(t, 0.45, 'lowpass', 2400, 160, 0.3 * gm); tone(t + 0.06, 'triangle', 300, 30, 0.4, 0.14 * gm, 0.45); }
    } catch (e) { /* ignore */ }
  }
