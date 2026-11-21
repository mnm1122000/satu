// SATU! — sound engine. Every sound is synthesised live with Web Audio (no files to load),
// so the "trrr" of a dealt card plays instantly on the host phone.

const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

class Sfx {
  constructor() {
    this.ctx = null; this.master = null; this.noise = null; this.muted = false;
    try { this.muted = localStorage.getItem('satu_muted') === '1'; } catch (_) {}
  }

  // Call inside a tap. Everything before the first await runs inside the gesture (iOS/Android rule).
  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}
    if (!this.mediaEl) {
      // a looping silent <audio> moves iPhones into the media session, so the silent switch doesn't mute us
      const a = document.createElement('audio');
      a.src = 'assets/sfx/silence.mp3'; a.loop = true; a.preload = 'auto';
      a.setAttribute('playsinline', ''); a.setAttribute('webkit-playsinline', '');
      document.body.appendChild(a);
      this.mediaEl = a;
    }
    if (this.mediaEl.paused) { const pr = this.mediaEl.play(); if (pr && pr.catch) pr.catch(() => {}); }
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
      const makeup = this.ctx.createGain(); makeup.gain.value = 1.4;
      this.master.connect(comp).connect(makeup).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    try { const b = this.ctx.createBuffer(1, 1, 22050); const s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0); } catch (_) {}
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }
  get ready() { return !!this.ctx && this.ctx.state === 'running'; }
  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('satu_muted', m ? '1' : '0'); } catch (_) {}
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  // ---- building blocks ----
  // filtered noise burst
  nz(t, dur, { f = 3000, q = 1, type = 'bandpass', vol = 0.5, f2 = null } = {}) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const flt = c.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f, t); flt.Q.value = q;
    if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.006, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }
  // oscillator note with optional glide
  tone(t, dur, { f = 440, f2 = null, type = 'sine', vol = 0.3, att = 0.005 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  play(name, opts = {}) {
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') { this.ctx.resume().catch(() => {}); }
    const t = this.ctx.currentTime + 0.01 + (opts.delay || 0);
    const fn = SOUNDS[name];
    if (fn) try { fn(this, t, opts); } catch (_) {}
  }
}

const SOUNDS = {
  // the dealer's "trrrr": a card flicked off the deck — rapid paper clicks, then a soft whoosh
  trrr(s, t) {
    for (let i = 0; i < 11; i++) s.nz(t + i * 0.013, 0.012, { f: 2600 + Math.random() * 1600, q: 2.5, vol: 0.55 * (1 - i / 14) });
    s.nz(t + 0.13, 0.17, { f: 900, f2: 4500, q: 0.8, vol: 0.28 });
  },
  // receiving a dealt card: whoosh in + paper tap
  receive(s, t) {
    s.nz(t, 0.2, { f: 5000, f2: 900, q: 0.7, vol: 0.3 });
    s.nz(t + 0.2, 0.03, { f: 1800, q: 1.5, vol: 0.5 });
    s.tone(t + 0.2, 0.08, { f: 1200, f2: 1500, vol: 0.06 });
  },
  // a long riffle shuffle
  shuffle(s, t, { small } = {}) {
    const n = small ? 22 : 54, len = small ? 0.5 : 1.25;
    for (let i = 0; i < n; i++) {
      const tt = t + (i / n) * len + Math.random() * 0.01;
      s.nz(tt, 0.011, { f: 2200 + Math.random() * 2500, q: 2, vol: 0.32 + 0.2 * Math.sin((i / n) * Math.PI) });
    }
    s.nz(t + len, 0.12, { f: 700, q: 0.8, vol: 0.5, type: 'lowpass' });
    if (!small) { s.nz(t + len + 0.25, 0.1, { f: 600, q: 0.8, vol: 0.45, type: 'lowpass' }); }
  },
  // card slapped onto the pile
  play(s, t) {
    s.nz(t, 0.09, { f: 2400, q: 0.6, vol: 0.7, type: 'lowpass' });
    s.tone(t, 0.12, { f: 160, f2: 70, vol: 0.35 });
  },
  draw(s, t) {
    s.nz(t, 0.16, { f: 1200, f2: 5000, q: 0.8, vol: 0.28 });
    s.nz(t + 0.15, 0.025, { f: 2000, q: 1.5, vol: 0.35 });
  },
  turn(s, t) {
    s.tone(t, 0.16, { f: 784, type: 'triangle', vol: 0.32 });
    s.tone(t + 0.12, 0.28, { f: 1175, type: 'triangle', vol: 0.32 });
  },
  skip(s, t) {
    s.tone(t, 0.28, { f: 420, f2: 140, type: 'square', vol: 0.12 });
    s.nz(t, 0.08, { f: 1200, vol: 0.3 });
  },
  reverse(s, t) {
    s.tone(t, 0.18, { f: 300, f2: 900, type: 'sawtooth', vol: 0.09 });
    s.tone(t + 0.18, 0.2, { f: 900, f2: 300, type: 'sawtooth', vol: 0.09 });
    s.nz(t, 0.38, { f: 600, f2: 3000, q: 1, vol: 0.15 });
  },
  plus(s, t) {
    s.tone(t, 0.25, { f: 110, f2: 55, vol: 0.5 });
    s.nz(t, 0.12, { f: 800, type: 'lowpass', vol: 0.5 });
    [523, 659, 784].forEach((f, i) => s.tone(t + 0.08 + i * 0.07, 0.14, { f, type: 'square', vol: 0.08 }));
  },
  wild(s, t) {
    [523, 659, 784, 1047, 1319].forEach((f, i) => s.tone(t + i * 0.06, 0.3, { f, type: 'triangle', vol: 0.18 }));
  },
  satu(s, t) {
    [523, 659, 784, 1047].forEach((f) => s.tone(t, 0.55, { f, type: 'sawtooth', vol: 0.06, att: 0.02 }));
    s.tone(t, 0.55, { f: 1047, f2: 1568, type: 'triangle', vol: 0.2 });
    s.nz(t, 0.25, { f: 4000, q: 0.5, vol: 0.15 });
  },
  catch(s, t) {
    for (let i = 0; i < 4; i++) s.tone(t + i * 0.13, 0.12, { f: i % 2 ? 660 : 990, type: 'square', vol: 0.12 });
  },
  win(s, t) {
    const seq = [523, 659, 784, 1047, 784, 1047, 1319];
    seq.forEach((f, i) => s.tone(t + i * 0.11, i === seq.length - 1 ? 0.7 : 0.16, { f, type: 'triangle', vol: 0.25 }));
    [523, 659, 784].forEach((f) => s.tone(t + 0.77, 0.8, { f: f * 2, type: 'sine', vol: 0.1 }));
  },
  join(s, t) { s.tone(t, 0.12, { f: 600, f2: 1000, vol: 0.25 }); },
  click(s, t) { s.nz(t, 0.02, { f: 3000, q: 2, vol: 0.25 }); },
  error(s, t) { s.tone(t, 0.15, { f: 160, type: 'square', vol: 0.1 }); },
  color(s, t) { s.tone(t, 0.2, { f: 880, f2: 1320, type: 'sine', vol: 0.2 }); },
};

export const sfx = new Sfx();

// Android vibrates; iPhone fakes a Taptic tick by toggling a hidden <input switch> (iOS 18+).
function iosTick() {
  try {
    const label = document.createElement('label');
    label.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
    const input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('switch', '');
    label.appendChild(input); document.body.appendChild(label); label.click();
    setTimeout(() => label.remove(), 50);
  } catch (_) {}
}
export function vibrate(pattern) {
  const arr = Array.isArray(pattern) ? pattern : [pattern];
  let done = false;
  try { if (typeof navigator.vibrate === 'function') done = navigator.vibrate(arr); } catch (_) {}
  if (done || !IS_IOS) return;
  let t = 0;
  arr.forEach((ms, i) => {
    if (i % 2 === 0) for (let k = 0; k < Math.max(1, Math.round(ms / 110)); k++) setTimeout(iosTick, t + k * 110);
    t += ms;
  });
}
