export interface ControlHandlers { sound(): Promise<boolean>; hand(): Promise<boolean>; reset(): void; png(): void; poster(): void; record(): void }
const $ = (id: string) => document.getElementById(id)!;
export class Controls {
  constructor(h: ControlHandlers) {
    const sound = $('btn-sound'), hand = $('btn-hand'), menu = $('exportmenu'), exp = $('btn-export');
    sound.addEventListener('click', async () => { const on = await h.sound(); sound.setAttribute('aria-pressed', String(on)); sound.textContent = on ? '[ SOUND ON ]' : '[ SOUND OFF ]'; });
    hand.addEventListener('click', async () => { const on = await h.hand(); hand.setAttribute('aria-pressed', String(on)); });
    $('btn-reset').addEventListener('click', () => h.reset());
    exp.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; exp.setAttribute('aria-expanded', String(open)); });
    $('btn-png').addEventListener('click', () => h.png());
    $('btn-poster').addEventListener('click', () => h.poster());
    $('btn-rec').addEventListener('click', () => h.record());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { menu.hidden = true; exp.setAttribute('aria-expanded', 'false'); }
      if ((e.key === 'r' || e.key === 'R') && !(e.target instanceof HTMLButtonElement)) h.reset();
    });
  }
  note(text: string, ms = 2600) { const n = $('note'); n.textContent = text; n.classList.add('on'); clearTimeout((this as any)._t); (this as any)._t = setTimeout(() => n.classList.remove('on'), ms); }
  setHand(on: boolean) { $('btn-hand').setAttribute('aria-pressed', String(on)); ($('camind') as HTMLElement).hidden = !on; }
  setRec(text: string | null) { const r = $('recind'); r.hidden = text === null; if (text) r.textContent = text; }
  setDownload(url: string | null, ext = 'webm') { const a = $('dl-rec') as HTMLAnchorElement; a.hidden = !url; if (url) { a.href = url; a.download = `type-is-matter.${ext}`; a.textContent = `DOWNLOAD ${ext.toUpperCase()}`; } }
  setRecLabel(t: string) { $('btn-rec').textContent = t; }
}
