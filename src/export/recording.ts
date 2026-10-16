/** Canvas recording via captureStream + MediaRecorder. Picks the best supported container; never mislabels WebM as MP4. */
const CANDIDATES = [
  { mime: 'video/mp4;codecs=avc1.640028', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
];
export function pickFormat(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c.mime)) ?? null;
}
export const MAX_SECONDS = 15;
export class Recorder {
  private rec: MediaRecorder | null = null; private chunks: Blob[] = [];
  started = 0; format: { mime: string; ext: string } | null = null;
  get active() { return !!this.rec && this.rec.state === 'recording'; }
  start(canvas: HTMLCanvasElement, onDone: (url: string, ext: string, mime: string) => void) {
    this.format = pickFormat();
    if (!this.format) throw new Error('MediaRecorder unsupported');
    const stream = canvas.captureStream(60);
    this.chunks = [];
    this.rec = new MediaRecorder(stream, { mimeType: this.format.mime, videoBitsPerSecond: 16_000_000 });
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    const fmt = this.format;
    this.rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(this.chunks, { type: fmt.mime.split(';')[0] });
      onDone(URL.createObjectURL(blob), fmt.ext, fmt.mime);
    };
    this.rec.start(250);
    this.started = performance.now();
  }
  stop() { if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); }
  elapsed() { return (performance.now() - this.started) / 1000; }
}
