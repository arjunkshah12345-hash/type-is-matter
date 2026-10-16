import type { GlyphLibrary } from './glyphGeometry';

export const LINES = ['NOTHING', 'STAYS', 'STILL'];
export const TRACK = 0.055;     // tight tracking between machined edges (no overlap at rest)
/**
 * Brief: "line spacing about 0.92× cap height". Read literally as baseline pitch it would overlap the
 * lines, so it is applied as leading of 0.92 em (≈ 1.34 cap heights baseline-to-baseline for Archivo Black).
 */
export const LINE_PITCH = 0.92 * (1000 / 688);

export interface LetterSlot { char: string; line: number; index: number; x: number; y: number; z: number }
export interface Layout { slots: LetterSlot[]; width: number; height: number; lineWidths: number[] }

export function computeLayout(lib: GlyphLibrary, lines = LINES, pitch = LINE_PITCH, align: 'center' | 'left' = 'center', track = TRACK): Layout {
  const slots: LetterSlot[] = [];
  const lineWidths: number[] = [];
  const top = 1, bottom = -(lines.length - 1) * pitch; // cap top of first line, baseline of last
  const midY = (top + bottom) / 2;
  let maxW = 0;
  lines.forEach((line) => {
    let w = 0;
    for (let i = 0; i < line.length; i++) w += lib.get(line[i]).width + (i ? track : 0);
    lineWidths.push(w); maxW = Math.max(maxW, w);
  });
  lines.forEach((line, li) => {
    const w = lineWidths[li];
    let x = align === 'center' ? -w / 2 : -maxW / 2;
    const baseline = -li * pitch - midY;
    for (let i = 0; i < line.length; i++) {
      const g = lib.get(line[i]);
      slots.push({ char: line[i], line: li, index: i, x: x + g.width / 2, y: baseline + g.centerY, z: 0 });
      x += g.width + track;
    }
  });
  return { slots, width: maxW, height: top - bottom, lineWidths };
}
