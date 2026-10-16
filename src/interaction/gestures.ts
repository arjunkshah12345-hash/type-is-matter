import type { HandLandmarker } from '@mediapipe/tasks-vision';
/** One Euro filter (Casiez et al. 2012). */
export class OneEuro {
  private x: number | null = null; private dx = 0; private t = 0;
  constructor(private minCutoff = 1.2, private beta = 0.02, private dCutoff = 1.0) {}
  private alpha(cutoff: number, dt: number) { const r = 2 * Math.PI * cutoff * dt; return r / (r + 1); }
  filter(v: number, t: number) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max(1e-3, t - this.t); this.t = t;
    const d = (v - this.x) / dt;
    this.dx += this.alpha(this.dCutoff, dt) * (d - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += this.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
  reset() { this.x = null; this.dx = 0; }
}
export type Gesture = 'none' | 'open' | 'pinch' | 'fist' | 'gust';
export interface HandState { tracking: boolean; x: number; y: number; vx: number; vy: number; gesture: Gesture; strength: number }

/**
 * Optional, opt-in hand mode. MediaPipe Hand Landmarker runs locally (WASM + model served from this site);
 * no frames leave the device. Camera tracks are stopped when disabled.
 */
export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private lastVideoTime = -1;
  private fx = new OneEuro(); private fy = new OneEuro();
  private candidate: Gesture = 'none'; private candidateSince = 0; private stableSince = -1;
  private raw: Gesture = 'none';
  private px = 0.5; private py = 0.5; private pt = 0;
  readonly state: HandState = { tracking: false, x: 0.5, y: 0.5, vx: 0, vy: 0, gesture: 'none', strength: 0 };
  running = false;
  async start() {
    if (!this.landmarker) {
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision'); // lazy: only when opted in
      const fileset = await FilesetResolver.forVisionTasks(import.meta.env.BASE_URL + 'mediapipe');
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: import.meta.env.BASE_URL + 'models/hand_landmarker.task', delegate: 'GPU' },
        runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.5,
      });
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    this.video = document.createElement('video');
    this.video.muted = true; this.video.playsInline = true; this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
  }
  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) { this.video.srcObject = null; this.video = null; }
    this.state.tracking = false; this.state.strength = 0; this.stableSince = -1;
    this.fx.reset(); this.fy.reset();
  }
  activeTracks() { return this.stream ? this.stream.getTracks().filter((t) => t.readyState === 'live').length : 0; }
  /** call once per animation frame; returns the filtered, hysteresis-gated state */
  update(nowMs: number, dt: number) {
    const s = this.state;
    let seen = false;
    if (this.running && this.landmarker && this.video && this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      const r = this.landmarker.detectForVideo(this.video, nowMs);
      const lm = r.landmarks?.[0];
      const conf = r.handedness?.[0]?.[0]?.score ?? 0;
      if (lm && conf > 0.6) {
        seen = true;
        const t = nowMs / 1000;
        const x = this.fx.filter(1 - lm[9].x, t), y = this.fy.filter(lm[9].y, t); // mirrored
        const dtt = Math.max(1e-3, t - this.pt);
        s.vx = (x - this.px) / dtt; s.vy = (y - this.py) / dtt; this.px = x; this.py = y; this.pt = t;
        s.x = x; s.y = y;
        const d = (a: number, b: number) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y, (lm[a].z - lm[b].z) * 0.5);
        const palm = d(0, 9) + 1e-6;
        const pinch = d(4, 8) / palm;
        const curl = (d(8, 0) + d(12, 0) + d(16, 0) + d(20, 0)) / 4 / palm;
        const speed = Math.hypot(s.vx, s.vy);
        // hysteresis thresholds
        const g0 = this.raw;
        let g: Gesture = 'none';
        if (speed > (g0 === 'gust' ? 1.4 : 2.2)) g = 'gust';
        else if (pinch < (g0 === 'pinch' ? 0.5 : 0.33)) g = 'pinch';
        else if (curl < (g0 === 'fist' ? 1.35 : 1.1)) g = 'fist';
        else if (curl > (g0 === 'open' ? 1.45 : 1.65)) g = 'open';
        else g = g0 === 'gust' ? 'none' : g0;
        this.raw = g;
        if (g !== this.candidate) { this.candidate = g; this.candidateSince = nowMs; }
        if (this.stableSince < 0) this.stableSince = nowMs;
      }
      if (!seen) { this.stableSince = -1; this.fx.reset(); this.fy.reset(); }
      s.tracking = seen;
    }
    // ≥100 ms of stable tracking and a stable candidate before a gesture activates
    const stable = s.tracking && this.stableSince >= 0 && nowMs - this.stableSince >= 100 && nowMs - this.candidateSince >= 100;
    if (stable) s.gesture = this.candidate;
    const targetStrength = stable && s.gesture !== 'none' ? 1 : 0;
    // smooth fade in/out (also when tracking is lost)
    s.strength += (targetStrength - s.strength) * (1 - Math.exp(-dt * (targetStrength > s.strength ? 8 : 4)));
    if (!s.tracking && s.strength < 0.01) s.gesture = 'none';
    return s;
  }
}
