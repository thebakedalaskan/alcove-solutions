/*
 * A film for a video block, drawn and recorded in this browser: a few seconds of a made-up product walkthrough, a step
 * at a time, with a pointer moving over it. The workspace keeps it as any uploaded video (`Kept.body`), so Play for
 * everyone reads it the way it reads a real one. Recorded the first time it's read, which takes as long as the film runs.
 */

/** What the film shows: its steps, one after another. */
export interface Film { title: string; steps: readonly string[]; accent: string }

const W = 960;
const H = 540;
const STEP_MS = 1500;
const FONT = '"Hanken Grotesk", system-ui, sans-serif';

function draw(g: CanvasRenderingContext2D, f: Film, t: number): void {
  const k = Math.floor(t / STEP_MS) % Math.max(1, f.steps.length);
  g.fillStyle = '#F4F1EA';
  g.fillRect(0, 0, W, H);
  g.fillStyle = f.accent;
  g.fillRect(0, 0, W, 10);
  g.fillStyle = '#1D2433';
  g.font = `600 40px ${FONT}`;
  g.fillText(f.title, 64, 104);
  f.steps.forEach((step, i) => {
    const y = 180 + i * 64;
    g.fillStyle = i === k ? f.accent : '#C9CED8';
    g.beginPath();
    g.arc(84, y - 10, 12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = i === k ? '#1D2433' : '#7A8394';
    g.font = `${i === k ? 600 : 400} 28px ${FONT}`;
    g.fillText(step, 116, y);
  });
  // The pointer, drifting toward the step being shown.
  const x = 520 + Math.sin(t / 700) * 120;
  const y = 170 + k * 64 + Math.cos(t / 900) * 12;
  g.fillStyle = '#1D2433';
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + 18, y + 26);
  g.lineTo(x + 6, y + 24);
  g.lineTo(x, y + 34);
  g.closePath();
  g.fill();
}

/** The film's bytes, as WebM: recorded once, the first time they're asked for. */
export function filmOf(f: Film): () => Promise<Blob> {
  let made: Promise<Blob> | null = null;
  return () => {
    made ??= new Promise<Blob>((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const g = canvas.getContext('2d');
      if (!g) { reject(new Error('This browser can’t draw the film.')); return; }
      const started = performance.now();
      const length = STEP_MS * f.steps.length;
      draw(g, f, 0);
      const recorder = new MediaRecorder(canvas.captureStream(24), { mimeType: 'video/webm' });
      const parts: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) parts.push(e.data); };
      recorder.onstop = () => resolve(new Blob(parts, { type: 'video/webm' }));
      const frame = () => {
        const t = performance.now() - started;
        if (t >= length) { recorder.stop(); return; }
        draw(g, f, t);
        requestAnimationFrame(frame);
      };
      recorder.start();
      requestAnimationFrame(frame);
    });
    return made;
  };
}
