import * as THREE from 'three';
import type opentype from 'opentype.js';
import { toCreasedNormals, mergeVertices, mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface ColliderBox { cx: number; cy: number; hx: number; hy: number; hz: number }
export interface GlyphData {
  char: string;
  geometry: THREE.BufferGeometry;
  width: number;   // visual bbox width incl. bevel (cap height = 1)
  height: number;
  depth: number;
  centerY: number; // bbox centre relative to baseline
  boxes: ColliderBox[];
}

export const CAP = 1;               // world units per cap height
export const DEPTH = 0.30;          // extrusion depth (thick, heavy)
export const BEVEL = 0.015;         // machined bevel: 1.5% of letter height
const BEVEL_T = 0.022;

/** Converts real font outlines into THREE shapes (font units y-up, scaled so cap height = 1). */
export function glyphShapes(font: opentype.Font, ch: string): THREE.Shape[] {
  const capUnits = (font.tables.os2 as { sCapHeight?: number }).sCapHeight || font.unitsPerEm * 0.7;
  const s = CAP / capUnits;
  const g = font.charToGlyph(ch);
  const sp = new THREE.ShapePath();
  for (const c of g.path.commands as any[]) {
    if (c.type === 'M') sp.moveTo(c.x * s, c.y * s);
    else if (c.type === 'L') sp.lineTo(c.x * s, c.y * s);
    else if (c.type === 'Q') sp.quadraticCurveTo(c.x1 * s, c.y1 * s, c.x * s, c.y * s);
    else if (c.type === 'C') sp.bezierCurveTo(c.x1 * s, c.y1 * s, c.x2 * s, c.y2 * s, c.x * s, c.y * s);
  }
  return sp.toShapes(false); // TrueType: clockwise outers in y-up space
}

function pointInPoly(x: number, y: number, pts: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Small compound collider: the glyph is sliced into horizontal bands; each filled run inside a band
 * becomes a box (a convex hull of that run). Vertically identical runs are merged. Rigid, never trimesh.
 */
function buildColliderBoxes(shapes: THREE.Shape[], minX: number, maxX: number, minY: number, maxY: number, cx: number, cy: number): ColliderBox[] {
  const polys = shapes.map((sh) => sh.extractPoints(10));
  const inside = (x: number, y: number) => polys.some((p) => pointInPoly(x, y, p.shape) && !p.holes.some((h) => pointInPoly(x, y, h)));
  const ROWS = 7, COLS = 72, SUB = 5;
  const bandH = (maxY - minY) / ROWS, colW = (maxX - minX) / COLS;
  type Run = { x0: number; x1: number; y0: number; y1: number };
  const rows: Run[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const y0 = minY + r * bandH, y1 = y0 + bandH;
    const runs: Run[] = [];
    let start = -1;
    for (let c = 0; c <= COLS; c++) {
      let filled = false;
      if (c < COLS) {
        const x = minX + (c + 0.5) * colW;
        let n = 0;
        for (let k = 0; k < SUB; k++) if (inside(x, y0 + ((k + 0.5) / SUB) * bandH)) n++;
        filled = n >= 3;
      }
      if (filled && start < 0) start = c;
      if (!filled && start >= 0) { runs.push({ x0: minX + start * colW, x1: minX + c * colW, y0, y1 }); start = -1; }
    }
    rows.push(runs);
  }
  // merge vertically
  const out: Run[] = [];
  let open: Run[] = [];
  for (const runs of rows) {
    const next: Run[] = [];
    for (const r of runs) {
      const m = open.find((o) => Math.abs(o.x0 - r.x0) < colW * 2.5 && Math.abs(o.x1 - r.x1) < colW * 2.5);
      if (m) { m.y1 = r.y1; m.x0 = Math.min(m.x0, r.x0); m.x1 = Math.max(m.x1, r.x1); next.push(m); open = open.filter((o) => o !== m); }
      else next.push({ ...r });
    }
    out.push(...open);
    open = next;
  }
  out.push(...open);
  const hz = DEPTH / 2 + BEVEL_T * 0.9;
  return out.map((r) => ({ cx: (r.x0 + r.x1) / 2 - cx, cy: (r.y0 + r.y1) / 2 - cy, hx: (r.x1 - r.x0) / 2, hy: (r.y1 - r.y0) / 2, hz }));
}

export function buildGlyph(font: opentype.Font, ch: string): GlyphData {
  const shapes = glyphShapes(font, ch);
  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shapes, {
    depth: DEPTH, curveSegments: 10, bevelEnabled: true, bevelThickness: BEVEL_T, bevelSize: BEVEL, bevelOffset: -BEVEL * 0.35, bevelSegments: 6,
  });
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2, cz = (bb.min.z + bb.max.z) / 2;
  geo.translate(-cx, -cy, -cz);
  // caps (group 0) keep perfectly flat normals; walls + bevels (group 1) get creased smoothing
  const src = geo as THREE.ExtrudeGeometry;
  const part = (gi: number) => {
    const gr = src.groups.filter((g) => g.materialIndex === gi);
    const pos = src.getAttribute('position'), nor = src.getAttribute('normal'), uv = src.getAttribute('uv');
    const P: number[] = [], N: number[] = [], U: number[] = [];
    for (const g of gr) for (let i = g.start; i < g.start + g.count; i++) { P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); N.push(nor.getX(i), nor.getY(i), nor.getZ(i)); U.push(uv.getX(i), uv.getY(i)); }
    const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); b.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); b.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    return b;
  };
  const caps = part(0);
  // caps are lapped very slightly convex (≈3–4° at the edges): flat geometry, gently varying normals,
  // so under the orthographic camera each face picks up a graded studio reflection instead of a flat tone
  {
    const p = caps.getAttribute('position'), n = caps.getAttribute('normal');
    const K = 0.34;
    for (let i = 0; i < p.count; i++) {
      const sz = Math.sign(n.getZ(i)) || 1;
      const nx = p.getX(i) * K * 0.6, ny = p.getY(i) * K, l = Math.hypot(nx, ny, 1);
      n.setXYZ(i, nx * sz / l, ny / l, sz / l);
    }
  }
  let walls = part(1);
  walls.deleteAttribute('normal');
  walls = mergeVertices(walls, 1e-5);
  walls = toCreasedNormals(walls, Math.PI / 5); // smooth curved walls/bevels, crisp corners
  geo = mergeGeometries([caps, walls], false)!;
  src.dispose(); caps.dispose(); walls.dispose();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const boxes = buildColliderBoxes(shapes, bb.min.x + BEVEL * 0.3, bb.max.x - BEVEL * 0.3, bb.min.y + BEVEL * 0.3, bb.max.y - BEVEL * 0.3, cx, cy);
  return { char: ch, geometry: geo, width: bb.max.x - bb.min.x, height: bb.max.y - bb.min.y, depth: bb.max.z - bb.min.z, centerY: cy, boxes };
}

/** Cache: repeated glyphs (N, T, S, I, L, H…) share one geometry. */
export class GlyphLibrary {
  private map = new Map<string, GlyphData>();
  constructor(private font: opentype.Font) {}
  get(ch: string): GlyphData {
    let g = this.map.get(ch);
    if (!g) { g = buildGlyph(this.font, ch); this.map.set(ch, g); }
    return g;
  }
  dispose() { this.map.forEach((g) => g.geometry.dispose()); this.map.clear(); }
}
