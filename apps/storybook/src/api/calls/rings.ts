/* Being rung, as the stand-in plays it: each tab's stream of what's ringing you, and someone ringing you while a story is open. */
import type { IncomingRing } from '@alcove/api';
import { Pushed } from '../live';
import { current } from '../state';

/** Everything ringing you, as one tab's stream has it: a ring nobody answers leaves by itself when it runs out. */
export class Rings extends Pushed<IncomingRing[]> {
  constructor(rings: IncomingRing[]) {
    super(rings);
    for (const r of rings) this.runsOut(r);
  }
  ring(r: IncomingRing): void {
    this.update((rs) => [...rs.filter((x) => x.id !== r.id), r]);
    this.runsOut(r);
  }
  private runsOut(r: IncomingRing): void {
    this.after(Math.max(0, Date.parse(r.expiresAt) - Date.now()), () => this.update((rs) => rs.filter((x) => x.id !== r.id || x.expiresAt !== r.expiresAt)));
  }
}
/** Every tab's stream of rings open now. */
export const ringing = new Set<Rings>();
/** Someone rings you while the story is open: the card drops in on whatever page is open. */
export function ringYou(r: IncomingRing): void {
  const w = current();
  w.rings = [...w.rings.filter((x) => x.id !== r.id), r];
  for (const store of ringing) store.ring(structuredClone(r));
}
