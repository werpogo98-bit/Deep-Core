/* ==========================================================
   CRUST BREAKER: DEEP CORE — audio.js
   Fully procedural Web Audio API SFX (no assets).
   Namespace: window.CB.audio
   ========================================================== */
(function () {
  'use strict';
  window.CB = window.CB || {};

  var ctx = null;
  var master = null;
  var muted = false;
  var noiseBuffer = null;

  function ensure() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
      // Pre-build a white-noise buffer for crunchy/steam sounds
      var len = Math.floor(ctx.sampleRate * 1.0);
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = noiseBuffer.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; return false; }
    return true;
  }

  function resume() {
    if (ensure() && ctx.state === 'suspended') ctx.resume();
  }

  function now() { return ctx.currentTime; }

  function makeNoiseSource(dur) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    return src;
  }

  function env(gainNode, t0, peak, attack, decay) {
    gainNode.gain.setValueAtTime(0.0001, t0);
    gainNode.gain.linearRampToValueAtTime(peak, t0 + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  /* ---------- Crunchy rock break ---------- */
  function rockBreak(pitchJitter) {
    if (muted || !ensure()) return;
    var t = now();
    // Gritty noise burst through a lowpass that snaps down
    var noise = makeNoiseSource();
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1600 + (pitchJitter || 0), t);
    lp.frequency.exponentialRampToValueAtTime(240, t + 0.16);
    lp.Q.value = 1.4;
    var g = ctx.createGain();
    env(g, t, 0.5, 0.004, 0.17);
    noise.connect(lp); lp.connect(g); g.connect(master);
    noise.start(t); noise.stop(t + 0.2);
    // Low thump body
    var osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    var og = ctx.createGain();
    env(og, t, 0.35, 0.002, 0.13);
    osc.connect(og); og.connect(master);
    osc.start(t); osc.stop(t + 0.16);
  }

  /* ---------- Rising-pitch metallic clink (gold nugget) ---------- */
  function goldClink(stepIndex) {
    if (muted || !ensure()) return;
    var t = now();
    var step = Math.min(stepIndex || 0, 12);
    var baseFreq = 880 * Math.pow(2, step / 12); // rises with consecutive pickups
    [baseFreq, baseFreq * 2.51].forEach(function (f, idx) {
      var osc = ctx.createOscillator();
      osc.type = idx === 0 ? 'sine' : 'square';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 1.18, t + 0.09); // rising pitch
      var g = ctx.createGain();
      env(g, t, idx === 0 ? 0.32 : 0.08, 0.002, 0.14);
      osc.connect(g); g.connect(master);
      osc.start(t); osc.stop(t + 0.16);
    });
  }

  /* ---------- Explosive TNT boom ---------- */
  function boom() {
    if (muted || !ensure()) return;
    var t = now();
    // Sub drop
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    var og = ctx.createGain();
    env(og, t, 0.9, 0.005, 0.55);
    osc.connect(og); og.connect(master);
    osc.start(t); osc.stop(t + 0.6);
    // Blast noise
    var noise = makeNoiseSource();
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(90, t + 0.45);
    bp.Q.value = 0.7;
    var g = ctx.createGain();
    env(g, t, 0.75, 0.006, 0.5);
    noise.connect(bp); bp.connect(g); g.connect(master);
    noise.start(t); noise.stop(t + 0.55);
    // Debris crackle tail
    var tail = makeNoiseSource();
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2200;
    var tg = ctx.createGain();
    env(tg, t + 0.05, 0.18, 0.02, 0.4);
    tail.connect(hp); hp.connect(tg); tg.connect(master);
    tail.start(t + 0.05); tail.stop(t + 0.5);
  }

  /* ---------- Steam hiss (ice cooling vent) ---------- */
  function steamHiss() {
    if (muted || !ensure()) return;
    var t = now();
    var noise = makeNoiseSource();
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(1800, t);
    hp.frequency.linearRampToValueAtTime(5200, t + 0.5);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 3800; bp.Q.value = 0.9;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    noise.connect(hp); hp.connect(bp); bp.connect(g); g.connect(master);
    noise.start(t); noise.stop(t + 0.65);
    // Cool chime
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1320, t);
    osc.frequency.exponentialRampToValueAtTime(660, t + 0.3);
    var og = ctx.createGain();
    env(og, t, 0.14, 0.004, 0.3);
    osc.connect(og); og.connect(master);
    osc.start(t); osc.stop(t + 0.35);
  }

  /* ---------- Overheat explosion (bigger boom + alarm) ---------- */
  function overheat() {
    if (muted || !ensure()) return;
    boom();
    var t = now();
    // Warning siren sweep
    var osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.linearRampToValueAtTime(180, t + 0.7);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1400;
    var g = ctx.createGain();
    env(g, t, 0.22, 0.01, 0.7);
    osc.connect(lp); lp.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + 0.75);
  }

  /* ---------- Continuous saw hum (starts/stops with gameplay) ---------- */
  var hum = null;
  function startHum() {
    if (muted || !ensure() || hum) return;
    var osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 84;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 3;
    var g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.linearRampToValueAtTime(0.05, now() + 0.2);
    osc.connect(lp); lp.connect(g); g.connect(master);
    osc.start();
    hum = { osc: osc, gain: g, filter: lp };
  }
  function setHumIntensity(v, boost) {
    if (!hum) return;
    var t = now();
    var target = muted ? 0.0001 : 0.03 + 0.05 * Math.min(v, 1);
    hum.gain.gain.setTargetAtTime(target, t, 0.08);
    hum.osc.frequency.setTargetAtTime(boost ? 132 : 84, t, 0.1);
    hum.filter.frequency.setTargetAtTime(boost ? 620 : 320, t, 0.1);
  }
  function stopHum() {
    if (!hum) return;
    try {
      hum.gain.gain.setTargetAtTime(0.0001, now(), 0.1);
      hum.osc.stop(now() + 0.4);
    } catch (e) {}
    hum = null;
  }

  /* ---------- UI click ---------- */
  function uiClick() {
    if (muted || !ensure()) return;
    var t = now();
    var osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.05);
    var g = ctx.createGain();
    env(g, t, 0.12, 0.002, 0.06);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + 0.08);
  }

  function toggleMute() {
    muted = !muted;
    if (muted) stopHum();
    return muted;
  }

  window.CB.audio = {
    resume: resume,
    rockBreak: rockBreak,
    goldClink: goldClink,
    boom: boom,
    steamHiss: steamHiss,
    overheat: overheat,
    startHum: startHum,
    setHumIntensity: setHumIntensity,
    stopHum: stopHum,
    uiClick: uiClick,
    toggleMute: toggleMute,
    isMuted: function () { return muted; }
  };
})();
