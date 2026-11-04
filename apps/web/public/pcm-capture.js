/*
 * The microphone at 16 kHz mono, for the live transcript (apps/web/src/features/call/speech.ts).
 * Runs on the audio thread: mixes the input to mono, low-passes it below 8 kHz so nothing higher
 * folds into the speech band, resamples it to 16 kHz, and posts 100 ms of samples at a time.
 */
const OUT_RATE = 16000;
const CHUNK = 1600;
const CUTOFF = 7000;

/** One low-pass biquad section (Audio EQ Cookbook). Two of them make a 4th-order Butterworth. */
function lowpass(rate, q) {
  const w = (2 * Math.PI * CUTOFF) / rate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return { b0: (1 - cos) / 2 / a0, b1: (1 - cos) / a0, b2: (1 - cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}

function filter(f, x) {
  const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
  f.x2 = f.x1;
  f.x1 = x;
  f.y2 = f.y1;
  f.y1 = y;
  return y;
}

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    /** Input samples per output sample. */
    this.step = sampleRate / OUT_RATE;
    this.filters = sampleRate > OUT_RATE * 1.05 ? [lowpass(sampleRate, 0.5412), lowpass(sampleRate, 1.3066)] : [];
    /** The previous filtered input sample, and where the next output falls after it (in input samples). */
    this.prev = 0;
    this.pos = 0;
    this.out = new Float32Array(CHUNK);
    this.n = 0;
    /** Told "stop" when nobody listens any more: the node then ends, rather than running until its context closes. */
    this.done = false;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.done = true; };
  }

  process(inputs) {
    if (this.done) return false;
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const length = channels[0].length;
    for (let i = 0; i < length; i++) {
      let x = 0;
      for (let c = 0; c < channels.length; c++) x += channels[c][i];
      x /= channels.length;
      for (const f of this.filters) x = filter(f, x);
      // Every output sample that falls between the previous input sample and this one, by linear interpolation.
      while (this.pos <= 1) {
        this.out[this.n++] = this.prev + (x - this.prev) * this.pos;
        if (this.n === CHUNK) {
          this.port.postMessage(this.out, [this.out.buffer]);
          this.out = new Float32Array(CHUNK);
          this.n = 0;
        }
        this.pos += this.step;
      }
      this.pos -= 1;
      this.prev = x;
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
