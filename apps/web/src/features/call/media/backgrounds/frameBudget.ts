/**
 * Bounded work for the local camera effect. Expensive frames reduce resolution and frequency, never the effect itself.
 * Two slow two-second windows lower quality; eight comfortably fast ones restore one tier. A costly frame also leaves
 * the same amount of time for the rest of the call before another is processed. There are no timers or retained frames.
 */
export type BackgroundQuality = 'full' | 'balanced' | 'light';
const TIERS: readonly { quality: BackgroundQuality; edge: number; fps: number }[] = [
  { quality: 'full', edge: 1920, fps: 30 },
  { quality: 'balanced', edge: 960, fps: 20 },
  { quality: 'light', edge: 640, fps: 12 }
];
const FULL = { quality: 'full', edge: 1920, fps: 30 } as const;

export class FrameBudget {
  private tier = 0;
  private next = -Infinity;
  private window = { since: 0, frames: 0, ms: 0 };
  private slow = 0;
  private fast = 0;

  constructor(private readonly changed: (quality: BackgroundQuality) => void) {}

  private current() { return TIERS[this.tier] ?? FULL; }

  /** Capped before any source pixels are uploaded to GL, even when the camera supplies a very large frame. */
  size(width: number, height: number): { width: number; height: number } {
    const scale = Math.min(1, this.current().edge / Math.max(width, height, 1));
    return { width: Math.max(2, Math.floor(width * scale / 2) * 2), height: Math.max(2, Math.floor(height * scale / 2) * 2) };
  }

  take(now: number): boolean {
    if (now < this.next) return false;
    this.next = now + 1000 / this.current().fps;
    return true;
  }

  measured(ms: number, now: number): void {
    this.next = Math.max(this.next, now + ms);
    const w = this.window;
    if (w.frames === 0) w.since = now;
    w.frames += 1;
    w.ms += ms;
    if (now - w.since < 2000 || w.frames < 8) return;
    const average = w.ms / w.frames;
    const previous = TIERS[Math.max(0, this.tier - 1)] ?? FULL;
    this.slow = average > 1000 / this.current().fps * 0.7 ? this.slow + 1 : 0;
    this.fast = average < 1000 / previous.fps * 0.4 ? this.fast + 1 : 0;
    this.window = { since: now, frames: 0, ms: 0 };
    const next = this.slow >= 2 ? Math.min(TIERS.length - 1, this.tier + 1) : this.fast >= 8 ? Math.max(0, this.tier - 1) : this.tier;
    if (next === this.tier) return;
    this.tier = next;
    this.slow = 0;
    this.fast = 0;
    this.changed(this.current().quality);
  }
}
