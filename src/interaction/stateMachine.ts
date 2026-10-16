export type Phase = 'intro' | 'rest' | 'collapse' | 'reassemble';
export const REASSEMBLE_DELAY = 1.4;
/** Global choreography state. Per-letter modes live on RigidGlyph. */
export class StateMachine {
  phase: Phase = 'intro';
  lastInteraction = -1e9;   // last click / drag / release (sim time)
  lastActivity = 0;         // any pointer activity (for idle ripple)
  reassembleStart = 0;
  rippleDone = false;
  dragging = false;
  interact(now: number) { this.lastInteraction = now; this.lastActivity = now; this.rippleDone = false; if (this.phase !== 'intro') this.phase = 'collapse'; }
  shouldReassemble(now: number) { return this.phase === 'collapse' && !this.dragging && now - this.lastInteraction >= REASSEMBLE_DELAY; }
}
