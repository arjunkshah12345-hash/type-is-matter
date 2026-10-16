import * as THREE from 'three';
import type { RigidGlyph } from './rigidGlyph';
import { RAPIER } from './world';

const _d = new THREE.Vector3(), _axis = new THREE.Vector3(), _goal = new THREE.Vector3();
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Radial cursor repel field (~180px, smooth falloff, 4–12px displacement), the idle ripple (≤3px),
 * and hand-mode fields. They move each letter's magnetic target, which a critically damped spring follows.
 */
export class MagneticField {
  pointer = new THREE.Vector3(); active = false;
  hand = new THREE.Vector3(); handStrength = 0; handSign = 1; // +1 repel, −1 attract
  rippleStart = -1;
  update(letters: RigidGlyph[], upp: number, now: number, dt: number, reduced: boolean) {
    const R = 180 * upp;
    for (const L of letters) {
      _goal.set(0, 0, 0);
      if (this.active) {
        _d.copy(L.rest).sub(this.pointer); _d.z = 0;
        const dist = Math.max(0, _d.length() - Math.min(L.glyph.width, L.glyph.height) * 0.25);
        const f = 1 - dist / R;
        if (f > 0) {
          const s = smooth(f);
          const px = (4 + 8 * s) * smooth(f * 5); // 4–12px, faded in at the field edge
          _d.normalize().multiplyScalar(px * upp);
          _goal.add(_d);
        }
      }
      if (this.handStrength > 0.001) {
        _d.copy(L.rest).sub(this.hand); _d.z = 0;
        const RH = 300 * upp, f = 1 - _d.length() / RH;
        if (f > 0) { const s = smooth(f); _d.normalize().multiplyScalar(this.handSign * 34 * s * this.handStrength * upp); _goal.add(_d); }
      }
      if (!reduced && this.rippleStart >= 0) {
        const t = now - this.rippleStart; const r = t * 9; // travelling radial wave, max 3px
        const dd = Math.hypot(L.rest.x, L.rest.y);
        const w = Math.exp(-Math.pow((dd - r) / 1.2, 2)) * (t < 2.2 ? 1 : 0);
        if (w > 0.001) { _d.set(L.rest.x, L.rest.y, 0).normalize().multiplyScalar(3 * upp * w); _goal.add(_d); }
        if (t > 2.4) this.rippleStart = -1;
      }
      // critically damped approach of target offset (heavy, no jumps)
      const k = 1 - Math.exp(-dt * 14);
      L.offset.lerp(_goal, k);
      // a hint of tilt away from the field
      _axis.set(-L.offset.y, L.offset.x, 0);
      const ang = _axis.length() * 0.9;
      if (ang > 1e-7) L.offsetQ.setFromAxisAngle(_axis.normalize(), ang); else L.offsetQ.identity();
    }
  }
}

/** Spherical impulse from the pointer projected into 3D, quadratic falloff, seeded angular impulse. */
export function shockwave(letters: RigidGlyph[], center: THREE.Vector3, radius: number, rand: () => number, strength = 1) {
  let separated = 0;
  for (const L of letters) {
    _d.copy(L.currP).sub(center);
    const dist = _d.length(), f = 1 - dist / radius;
    if (f <= 0) continue;
    const fall = f * f; // quadratic falloff
    if (dist < 1e-4) _d.set(rand() - 0.5, rand() - 0.5, -1);
    _d.normalize();
    _d.z = _d.z * 0.6 - 0.35 * (rand() * 0.6 + 0.4); // push slightly into depth so they tumble past each other
    _d.y += 0.35;
    _d.normalize();
    const dv = (8 + 5 * rand()) * fall * strength;
    L.body.applyImpulse({ x: _d.x * dv * L.mass, y: _d.y * dv * L.mass, z: _d.z * dv * L.mass }, true);
    _axis.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
    const w = (4 + 10 * rand()) * fall * strength;
    L.body.applyTorqueImpulse({ x: _axis.x * w * L.inertia, y: _axis.y * w * L.inertia, z: _axis.z * w * L.inertia }, true);
    if (dv > 1.2) separated++;
  }
  return separated;
}
export type { RAPIER };
