import * as THREE from 'three';
export interface PointerHandlers {
  hover(ndcX: number, ndcY: number, cssX: number, cssY: number): void;
  leave(): void;
  pick(ndcX: number, ndcY: number): { index: number; point: THREE.Vector3 } | null;
  impact(ndcX: number, ndcY: number, point?: THREE.Vector3): void;
  dragStart(index: number, point: THREE.Vector3): void;
  dragMove(ndcX: number, ndcY: number): void;
  dragEnd(): void;
  hoverLetter(hit: boolean): void;
}
/** Pointer → interaction plane. Press on a letter + move = drag (spring); press without move = impact. */
export class PointerInput {
  ndc = new THREE.Vector2(); css = new THREE.Vector2();
  private down = false; private downX = 0; private downY = 0; private picked: { index: number; point: THREE.Vector3 } | null = null; private dragging = false;
  private id = -1;
  constructor(private el: HTMLElement, private h: PointerHandlers) {
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerdown', this.press);
    el.addEventListener('pointerup', this.release);
    el.addEventListener('pointercancel', this.release);
    el.addEventListener('pointerleave', () => { if (!this.down) this.h.leave(); });
  }
  private toNdc(e: PointerEvent) {
    const r = this.el.getBoundingClientRect();
    this.css.set(e.clientX - r.left, e.clientY - r.top);
    this.ndc.set((this.css.x / r.width) * 2 - 1, -(this.css.y / r.height) * 2 + 1);
  }
  private move = (e: PointerEvent) => {
    this.toNdc(e);
    this.h.hover(this.ndc.x, this.ndc.y, this.css.x, this.css.y);
    if (this.down && e.pointerId === this.id) {
      if (!this.dragging && this.picked && Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 5) {
        this.dragging = true; this.h.dragStart(this.picked.index, this.picked.point);
      }
      if (this.dragging) this.h.dragMove(this.ndc.x, this.ndc.y);
    } else if (e.pointerType === 'mouse') this.h.hoverLetter(!!this.h.pick(this.ndc.x, this.ndc.y));
  };
  private press = (e: PointerEvent) => {
    if (this.down) return;
    this.toNdc(e);
    this.down = true; this.id = e.pointerId; this.downX = e.clientX; this.downY = e.clientY;
    this.el.setPointerCapture?.(e.pointerId);
    this.picked = this.h.pick(this.ndc.x, this.ndc.y);
    if (!this.picked) { this.h.impact(this.ndc.x, this.ndc.y); this.down = true; }
  };
  private release = (e: PointerEvent) => {
    if (!this.down || e.pointerId !== this.id) return;
    this.toNdc(e);
    if (this.dragging) this.h.dragEnd();
    else if (this.picked) this.h.impact(this.ndc.x, this.ndc.y, this.picked.point);
    this.down = false; this.dragging = false; this.picked = null;
    if (e.pointerType !== 'mouse') this.h.leave();
  };
}
