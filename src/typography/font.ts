import opentype from 'opentype.js';
/** Archivo Black (SIL OFL 1.1, Omnibus-Type) — heavy, wide architectural grotesk. */
export const FONT_URL = import.meta.env.BASE_URL + 'fonts/ArchivoBlack-Regular.ttf';
export async function loadFont(url = FONT_URL): Promise<opentype.Font> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('font load failed ' + res.status);
  return opentype.parse(await res.arrayBuffer());
}
