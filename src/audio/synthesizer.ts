/**
 * Procedural metallic collision audio (Web Audio). Off by default; the AudioContext is created
 * only inside a user gesture. Hits are driven by real Rapier contact impulses, aggregated per frame and rate-limited.
 */
export class MetalSynth {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  enabled = false;
  private lastHit = 0;
  private hum: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  async enable() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 4;
      this.master = this.ctx.createGain(); this.master.gain.value = 0.7;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    await this.ctx.resume();
    this.enabled = true;
  }
  async disable() { this.enabled = false; this.stopHum(); if (this.ctx) await this.ctx.suspend(); }
  private noiseBurst(t: number, type: BiquadFilterType, freq: number, q: number, gain: number, decay: number) {
    const c = this.ctx!, src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.master); src.start(t, Math.random() * 1.0); src.stop(t + decay + 0.05);
  }
  private partials(t: number, f0: number, ratios: number[], gain: number, decay: number) {
    const c = this.ctx!;
    ratios.forEach((r, i) => {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f0 * r * (1 + (Math.random() - 0.5) * 0.01);
      const g = c.createGain(); const a = gain / (1 + i * 0.9);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay / (1 + i * 0.35));
      o.connect(g).connect(this.master); o.start(t); o.stop(t + decay + 0.1);
    });
  }
  /** dv: aggregated impact strength (m/s), count: number of contacts aggregated this frame */
  hit(dv: number, count: number) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (now - this.lastHit < 0.045) return; // rate limit
    this.lastHit = now;
    const t = now + 0.005, density = Math.min(1.6, 1 + (count - 1) * 0.08);
    if (dv < 1.2) { // small: high tick
      const v = Math.min(0.25, 0.05 + dv * 0.15);
      this.noiseBurst(t, 'highpass', 5200, 0.7, v, 0.03);
      this.partials(t, 2900 + Math.random() * 900, [1, 2.32], v * 0.6, 0.08);
    } else if (dv < 3.5) { // medium: resonant aluminium tone
      const v = Math.min(0.35, 0.12 + dv * 0.05) * density;
      this.noiseBurst(t, 'bandpass', 2400, 1.2, v * 0.6, 0.06);
      this.partials(t, 480 + Math.random() * 260, [1, 2.756, 5.404, 8.933], v * 0.5, 0.9);
    } else { // large: deep layered resonance
      const v = Math.min(0.5, 0.2 + dv * 0.03) * density;
      this.noiseBurst(t, 'lowpass', 420, 0.8, v, 0.25);
      this.noiseBurst(t, 'bandpass', 1800, 2, v * 0.4, 0.1);
      this.partials(t, 92 + Math.random() * 30, [1, 1.51, 2.76, 4.07, 5.4], v * 0.55, 2.2);
      this.partials(t, 610 + Math.random() * 120, [1, 2.756], v * 0.25, 1.0);
    }
  }
  /** Subtle rising harmonic during reassembly. progress 0..1, fades out as letters settle. */
  reassembly(active: boolean, progress: number) {
    if (!this.enabled || !this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    if (active && !this.hum) {
      const gain = c.createGain(); gain.gain.value = 0.0001; gain.connect(this.master);
      const osc = [1, 2, 3].map((h) => { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 196 * h; const g = c.createGain(); g.gain.value = 0.05 / h; o.connect(g).connect(gain); o.start(); return o; });
      this.hum = { osc, gain };
    }
    if (this.hum) {
      const p = Math.max(0, Math.min(1, progress));
      this.hum.osc.forEach((o, i) => o.frequency.setTargetAtTime(196 * (i + 1) * (1 + 0.5 * p), t, 0.3));
      this.hum.gain.gain.setTargetAtTime(active ? 0.5 * (1 - p) + 0.0001 : 0.0001, t, active ? 0.25 : 0.4);
      if (!active) this.stopHum(1.6);
    }
  }
  private stopHum(after = 0) {
    if (!this.hum) return;
    const h = this.hum; this.hum = null;
    const t = this.ctx ? this.ctx.currentTime : 0;
    h.gain.gain.setTargetAtTime(0.0001, t, 0.3);
    h.osc.forEach((o) => o.stop(t + after + 0.05));
  }
}
