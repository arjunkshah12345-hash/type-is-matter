import type { PhysicsWorld } from './world';
import type { RigidGlyph } from './rigidGlyph';
/** Drains Rapier contact-force events into per-letter impulses (elastic) and aggregated audio hits. */
export class CollisionEvents {
  private owner = new Map<number, number>();
  hits = new Float32Array(64);       // per-letter strongest Δv this frame
  frameMax = 0; frameCount = 0;      // aggregate for audio
  pairCount = 0;                     // letter-letter contacts seen (for tests)
  letterPairs = new Set<string>();
  register(letters: RigidGlyph[]) { letters.forEach((L, i) => L.colliders.forEach((c) => this.owner.set(c.handle, i))); }
  drain(pw: PhysicsWorld, letters: RigidGlyph[], dt: number) {
    pw.events.drainContactForceEvents((ev) => {
      const a = this.owner.get(ev.collider1()), b = this.owner.get(ev.collider2());
      const F = ev.totalForceMagnitude();
      const touch = (i: number | undefined) => {
        if (i === undefined) return 0;
        const dv = (F * dt) / letters[i].mass;
        if (dv > this.hits[i]) this.hits[i] = dv;
        return dv;
      };
      const dv = Math.max(touch(a), touch(b));
      if (a !== undefined && b !== undefined) { this.pairCount++; this.letterPairs.add(a < b ? a + '-' + b : b + '-' + a); }
      if (dv > 0.22) { this.frameCount++; if (dv > this.frameMax) this.frameMax = dv; }
    });
  }
  resetFrame() { this.hits.fill(0); this.frameMax = 0; this.frameCount = 0; }
}
