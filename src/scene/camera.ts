import * as THREE from 'three';
const DEG = Math.PI / 180;
export const PITCH = -7 * DEG;
/** Orthographic camera, ~7° downward, with heavy critically-damped pointer parallax (≤1.5° / 0.8°). */
export class StudioCamera {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 120);
  viewH = 8; aspect = 1.6;
  private yaw = 0; private pitch = 0; private vyaw = 0; private vpitch = 0;
  private tyaw = 0; private tpitch = 0;
  private omega = 2.6; // critically damped (ζ = 1)
  readonly target = new THREE.Vector3();
  frame(compW: number, compH: number, aspect: number, wFrac = 0.78, hFrac = 0.56) {
    this.aspect = aspect;
    const narrow = aspect < 0.8;
    const wf = narrow ? 0.9 : wFrac;
    this.viewH = Math.max(compH / hFrac, compW / (wf * aspect));
    this.applyFrustum();
  }
  applyFrustum() {
    const c = this.camera, h = this.viewH / 2, w = h * this.aspect;
    c.left = -w; c.right = w; c.top = h; c.bottom = -h; c.updateProjectionMatrix();
  }
  setParallaxTarget(nx: number, ny: number) { this.tyaw = -nx * 1.5 * DEG; this.tpitch = ny * 0.8 * DEG; }
  update(dt: number, enabled = true) {
    const w = this.omega;
    const ty = enabled ? this.tyaw : 0, tp = enabled ? this.tpitch : 0;
    // semi-implicit critically-damped spring
    this.vyaw += (w * w * (ty - this.yaw) - 2 * w * this.vyaw) * dt; this.yaw += this.vyaw * dt;
    this.vpitch += (w * w * (tp - this.pitch) - 2 * w * this.vpitch) * dt; this.pitch += this.vpitch * dt;
    this.place(this.yaw, this.pitch);
  }
  place(yaw: number, pitch: number) {
    const p = PITCH + pitch, d = 40;
    const c = this.camera;
    c.position.set(this.target.x + Math.sin(yaw) * Math.cos(p) * d, this.target.y - Math.sin(p) * d, this.target.z + Math.cos(yaw) * Math.cos(p) * d);
    c.lookAt(this.target);
    c.updateMatrixWorld();
  }
  resetParallax() { this.yaw = this.pitch = this.vyaw = this.vpitch = 0; this.place(0, 0); }
  /** world units per CSS pixel */
  unitsPerPx(cssH: number) { return this.viewH / cssH; }
}
