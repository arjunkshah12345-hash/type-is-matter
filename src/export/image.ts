export function download(url: string, name: string) {
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
/** Poster typography overlay drawn onto the 3D render (2400×3000). */
export function drawPosterFrame(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const ink = '#1B1B19', m = 120;
  ctx.fillStyle = ink;
  ctx.textBaseline = 'alphabetic';
  const mono = (px: number) => `${px}px 'Plex Mono', ui-monospace, monospace`;
  ctx.font = mono(30);
  (ctx as any).letterSpacing = '2.4px';
  ctx.textAlign = 'left'; ctx.fillText('EXPERIMENT 001', m, m + 10);
  ctx.textAlign = 'right'; ctx.fillText('NOTHING STAYS STILL', W - m, m + 10);
  // footer
  ctx.fillStyle = ink; ctx.fillRect(m, H - m - 118, W - 2 * m, 2);
  ctx.font = mono(30); ctx.textAlign = 'left';
  ctx.fillText('TYPE IS MATTER / INTERACTIVE TYPOGRAPHY STUDY / 2026', m, H - m - 52);
  ctx.textAlign = 'right'; ctx.globalAlpha = 0.55; ctx.fillText('EDITION 001', W - m, H - m - 52); ctx.globalAlpha = 1;
  ctx.fillStyle = '#E7FF68'; ctx.fillRect(m, H - m - 20, 120, 12);
  ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.strokeRect(m, H - m - 20, 120, 12);
}
