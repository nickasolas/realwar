// Procedural sound effects via WebAudio — no asset files needed.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastPlayed = {};
    this.listener = { x: 0, y: 0, range: 20 };
  }

  // Browsers require a user gesture before audio can start.
  unlock() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setListener(x, y, range) { this.listener = { x, y, range }; }

  play(kind, x, y, size = 1) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    // Throttle identical sounds so big battles don't clip.
    const minGap = { bullet: 0.06, flak: 0.08, shell: 0.08, rocket: 0.1, explode: 0.05, die: 0.15, artillery: 0.1, bomb: 0.1 }[kind] ?? 0.05;
    if (now - (this.lastPlayed[kind] || 0) < minGap) return;
    const dist = Math.hypot(x - this.listener.x, y - this.listener.y);
    const vol = Math.max(0, 1 - dist / this.listener.range);
    if (vol <= 0.02) return;
    this.lastPlayed[kind] = now;
    switch (kind) {
      case 'bullet': this.burst(now, 0.05, 2400, 0.25 * vol); break;
      case 'flak': this.burst(now, 0.07, 1600, 0.25 * vol); break;
      case 'shell': this.burst(now, 0.18, 700, 0.5 * vol); this.thump(now, 120, 0.15, 0.4 * vol); break;
      case 'rocket': this.burst(now, 0.35, 1200, 0.25 * vol, true); break;
      case 'artillery': this.thump(now, 70, 0.4, 0.8 * vol); this.burst(now, 0.3, 500, 0.5 * vol); break;
      case 'bomb': this.burst(now, 0.4, 900, 0.2 * vol, true); break;
      case 'explode': this.thump(now, 55, 0.6 + size * 0.1, 0.9 * vol); this.burst(now, 0.5 + size * 0.1, 400, 0.7 * vol); break;
      case 'die': this.burst(now, 0.12, 900, 0.15 * vol); break;
    }
  }

  burst(t, dur, freq, gain, sweep = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(freq * 0.3, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, dur);
  }

  thump(t, freq, dur, gain) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }

  // Short radio-style blip for UI notifications.
  blip(freq = 880) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.setValueAtTime(freq * 1.5, t + 0.06);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.16);
  }
}
