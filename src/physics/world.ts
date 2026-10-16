import RAPIER from '@dimforge/rapier3d-compat';
export { RAPIER };
export const STEP = 1 / 120;
export const MAX_FRAME = 0.1; // accumulated-time cap (tab inactive / slow frame)
export const FLOOR_RESTITUTION = 0.28, FLOOR_FRICTION = 0.65;

export async function initPhysics() { await RAPIER.init(); }

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly events: RAPIER.EventQueue;
  private statics: RAPIER.Collider[] = [];
  private staticBody: RAPIER.RigidBody;
  bounds = { floorY: -3, halfW: 8, ceil: 6, zBack: -2.6, zFront: 2.6 };
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    this.events = new RAPIER.EventQueue(true);
    this.staticBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }
  /** invisible floor + containment walls so nothing escapes the frame */
  setBounds(floorY: number, halfW: number, ceil: number) {
    for (const c of this.statics) this.world.removeCollider(c, true);
    this.statics = [];
    this.bounds = { floorY, halfW, ceil, zBack: -2.6, zFront: 2.6 };
    const T = 2, big = 60;
    const mk = (hx: number, hy: number, hz: number, x: number, y: number, z: number, rest = FLOOR_RESTITUTION, fr = FLOOR_FRICTION) => {
      const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRestitution(rest).setFriction(fr);
      this.statics.push(this.world.createCollider(d, this.staticBody));
    };
    mk(big, T, big, 0, floorY - T, 0);                     // floor: restitution 0.28, friction 0.65
    mk(T, big, big, -halfW - T, 0, 0, 0.2, 0.3);           // side walls
    mk(T, big, big, halfW + T, 0, 0, 0.2, 0.3);
    mk(big, T, big, 0, ceil + T, 0, 0.2, 0.3);             // ceiling
    mk(big, big, T, 0, 0, -2.6 - T, 0.2, 0.3);             // back
    mk(big, big, T, 0, 0, 2.6 + T, 0.2, 0.3);              // front
  }
  isStatic(handle: number) { return this.statics.some((c) => c.handle === handle); }
}
