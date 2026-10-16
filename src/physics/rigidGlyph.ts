import * as THREE from 'three';
import { RAPIER } from './world';
import type { PhysicsWorld } from './world';
import type { GlyphData } from '../typography/glyphGeometry';
import { ElasticState } from '../typography/deformation';

export type Mode = 'pending' | 'arrive' | 'hold' | 'free' | 'return' | 'drag';
export interface Gains { w: number; z: number; wr: number; zr: number }
export const GAINS: Record<string, Gains> = {
  hold: { w: 16, z: 1.0, wr: 16, zr: 1.0 },
  arrive: { w: 10.5, z: 0.5, wr: 10, zr: 0.45 },
  return: { w: 6.4, z: 0.42, wr: 6.8, zr: 0.48 },
  returnReduced: { w: 6.0, z: 1.0, wr: 6.0, zr: 1.0 },
};
const MAX_ACC = 46, MAX_ALPHA = 70;

const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _v = new THREE.Vector3();
const _f = { x: 0, y: 0, z: 0 }, _t = { x: 0, y: 0, z: 0 };

/** One physical letter: rigid body + compound collider + magnetic target + elastic state. */
export class RigidGlyph {
  readonly body: RAPIER.RigidBody;
  readonly colliders: RAPIER.Collider[] = [];
  readonly rest = new THREE.Vector3();
  readonly restQ = new THREE.Quaternion();
  readonly offset = new THREE.Vector3();       // magnetic field displacement of the target (hover / ripple / hand)
  readonly offsetQ = new THREE.Quaternion();
  readonly prevP = new THREE.Vector3(); readonly currP = new THREE.Vector3();
  readonly prevQ = new THREE.Quaternion(); readonly currQ = new THREE.Quaternion();
  readonly linv = new THREE.Vector3(); readonly angv = new THREE.Vector3();
  readonly elastic = new ElasticState();
  mode: Mode = 'hold';
  modeTime = 0;            // sim time the mode started
  gain = 1;                // ramped gain for return
  mass: number; inertia: number;
  roughness = 0.13;
  mesh!: THREE.Mesh;
  arriveAt = 0; visibleAt = 0;
  constructor(pw: PhysicsWorld, readonly glyph: GlyphData, readonly index: number, x: number, y: number, z: number) {
    this.rest.set(x, y, z);
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setGravityScale(0).setLinearDamping(0.08).setAngularDamping(0.9).setCcdEnabled(true).setCanSleep(true);
    this.body = pw.world.createRigidBody(desc);
    for (const b of glyph.boxes) {
      const cd = RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.cx, b.cy, 0)
        .setDensity(1).setRestitution(0.3).setFriction(0.5)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(0.5);
      this.colliders.push(pw.world.createCollider(cd, this.body));
    }
    this.mass = this.body.mass(); // mass ∝ volume (uniform density)
    const I = this.body.principalInertia();
    this.inertia = (I.x + I.y + I.z) / 3;
    this.elastic.size.value.set(glyph.width / 2, glyph.height / 2, glyph.depth / 2);
    this.sync(); this.prevP.copy(this.currP); this.prevQ.copy(this.currQ);
  }
  setMode(m: Mode, now: number) {
    if (this.mode === m) return;
    if (m !== 'return') this.setGhost(false);
    this.mode = m; this.modeTime = now;
    this.body.setGravityScale(m === 'free' || m === 'return' ? 1 : 0, true);
    this.body.wakeUp();
  }
  /** read state from Rapier into interpolation buffers */
  sync() {
    const t = this.body.translation(), r = this.body.rotation(), lv = this.body.linvel(), av = this.body.angvel();
    this.currP.set(t.x, t.y, t.z); this.currQ.set(r.x, r.y, r.z, r.w);
    this.linv.set(lv.x, lv.y, lv.z); this.angv.set(av.x, av.y, av.z);
  }
  pushPrev() { this.prevP.copy(this.currP); this.prevQ.copy(this.currQ); }
  /** position error to target in world units */
  posError() { return _v.copy(this.rest).add(this.offset).sub(this.currP).length(); }
  restError() { return _v.copy(this.rest).sub(this.currP).length(); }
  angError() { _q.copy(this.restQ); return 2 * Math.acos(Math.min(1, Math.abs(_q.dot(this.currQ)))); }
  /**
   * Magnetic restoring force F = kp(target − pos) − kd·vel and shortest-path quaternion torque, both clamped.
   * Forces only — never sets position.
   */
  applyMagnet(g: Gains, scale: number, allowSleep: boolean) {
    const b = this.body;
    b.resetForces(false); b.resetTorques(false);
    const ex = this.rest.x + this.offset.x - this.currP.x, ey = this.rest.y + this.offset.y - this.currP.y, ez = this.rest.z + this.offset.z - this.currP.z;
    // orientation error (shortest path)
    _q.copy(this.restQ).multiply(this.offsetQ);
    _qi.copy(this.currQ).invert();
    _q.multiply(_qi);
    if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
    const s = Math.sqrt(_q.x * _q.x + _q.y * _q.y + _q.z * _q.z);
    const ang = 2 * Math.atan2(s, _q.w);
    const k = s > 1e-9 ? ang / s : 2;
    const rx = _q.x * k, ry = _q.y * k, rz = _q.z * k;
    const e2 = ex * ex + ey * ey + ez * ez, v2 = this.linv.lengthSq(), w2 = this.angv.lengthSq();
    if (allowSleep && e2 < 1e-9 && v2 < 1e-7 && ang < 2e-5 && w2 < 1e-6) return; // let the body sleep
    const kp = g.w * g.w * scale, kd = 2 * g.z * g.w * Math.sqrt(scale);
    let ax = kp * ex - kd * this.linv.x, ay = kp * ey - kd * this.linv.y, az = kp * ez - kd * this.linv.z;
    const am = Math.sqrt(ax * ax + ay * ay + az * az);
    if (am > MAX_ACC) { const c = MAX_ACC / am; ax *= c; ay *= c; az *= c; }
    _f.x = ax * this.mass; _f.y = ay * this.mass; _f.z = az * this.mass;
    const kpr = g.wr * g.wr * scale, kdr = 2 * g.zr * g.wr * Math.sqrt(scale);
    let bx = kpr * rx - kdr * this.angv.x, by = kpr * ry - kdr * this.angv.y, bz = kpr * rz - kdr * this.angv.z;
    const bm = Math.sqrt(bx * bx + by * by + bz * bz);
    if (bm > MAX_ALPHA) { const c = MAX_ALPHA / bm; bx *= c; by *= c; bz *= c; }
    _t.x = bx * this.inertia; _t.y = by * this.inertia; _t.z = bz * this.inertia;
    b.addForce(_f, true); b.addTorque(_t, true);
  }
  ghost = false;
  /** jam resolution: a letter that has not settled after a while stops colliding with other letters (floor/walls still collide) */
  setGhost(on: boolean) {
    if (this.ghost === on) return;
    this.ghost = on;
    const groups = on ? ((0x0004 << 16) | 0x0001) : ((0x0002 << 16) | 0xffff);
    for (const c of this.colliders) c.setCollisionGroups(groups);
  }
  clearForces() { this.body.resetForces(false); this.body.resetTorques(false); }
}
