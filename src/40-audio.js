  /* ===================================================================== */
  /* 5. Sound (Web Audio, synthesized)                                      */
  /*    v1.3 adds alert / whiff / hurtbig — the three cues of §3.2, §3.4, §3.5 */
  /* ===================================================================== */
  const audio = { ctx: null, master: null, noise: null, boomAt: [], loop: null };   // boomAt: start times of recent boom voices (A24 cap 2); loop: flame noise (v1.1)
  function ensureAudio() {
    if (audio.ctx) { try { if (audio.ctx.state === 'suspended') safe(() => audio.ctx.resume()); } catch (e) { /* ignore */ } return; }
    try {
      const AC = win.AudioContext || win.webkitAudioContext;
      if (!AC) return;
      const c = new AC();
      const master = c.createGain(); master.gain.value = 0.28;
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
  /* Filtered noise whose cutoff sweeps f0 → f1 over dur (sword swish, rocket whoosh — v1.1 A10). */
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
      else if (kind === 'swish') { noiseSweep(t, 0.09, 'highpass', 2000, 6000, 0.5 * gm); tinks(1, 0, 0.08 * gm); }   // sword
      else if (kind === 'whoosh') { noiseSweep(t, 0.15, 'bandpass', 200, 1200, 0.6 * gm); }                            // rocket travel
      else if (kind === 'puff') { noiseBurst(t, 0.09, { type: 'lowpass', freq: 900, Q: 0.8 }, 0.3 * gm, 0.09); if (crit) tinks(1, 0, 0.06 * gm); }      // single flame tick
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
    } catch (e) { /* ignore */ }
  }
