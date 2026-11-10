/*
 * Reactions (React, in the dock): emoji floating up from the foot of the call for a moment, yours and everyone else's.
 * Kept in this browser's memory and nowhere else. They travel as data packets through the call's room (CallRoom.send
 * and receive, on CALL_REACT_TOPIC), each encrypted with its sender's own media key, so LiveKit forwards ciphertext and
 * the API never sees them. Yours shows at the press, before it's sent. Pressed fast, they come several at a time and
 * further apart: the strip bursts.
 */
import { CALL_REACT_LIMITS, CALL_REACT_TOPIC, CallReactMessageSchema, type CallReaction, type LiveStore } from '@alcove/api';
import type { BurstItem } from '@alcove/ui';
import { useSyncExternalStore } from 'react';
import { log } from '~/lib/log';
import type { CallRoom } from '../media/livekit';

const rlog = log.child({ component: 'call-reactions' });

/** How long one shows: it has faded out by then. */
const SHOWN_MS = 2100;
/** The most showing at once; past it the oldest go first. */
const MOST = 60;
/** Reactions within this long of each other count towards a burst. */
const BURST_MS = 700;
/** How many in that time make it a burst. */
const BURST_AT = 4;

const enc = new TextEncoder();
const dec = new TextDecoder();

const between = (a: number, b: number) => a + Math.random() * (b - a);

export class CallReactions implements LiveStore<BurstItem[]> {
  private items: BurstItem[] = [];
  private listeners = new Set<() => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private recent: number[] = [];
  private seq = 0;
  private tokens: number = CALL_REACT_LIMITS.burst;
  private refilled = performance.now();
  private stopReceiving: () => void;

  constructor(private readonly room: Pick<CallRoom, 'send' | 'receive'>) {
    this.stopReceiving = room.receive(CALL_REACT_TOPIC, (payload, from) => this.take(payload, from), CALL_REACT_LIMITS);
  }

  getSnapshot = (): BurstItem[] => this.items;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };

  /** Yours: shown here now, and sent to everyone else in your part of the call. */
  fire(name: CallReaction): void {
    // The same bucket receivers hold a sender to: a press past it is neither shown nor sent.
    const t = performance.now();
    this.tokens = Math.min(CALL_REACT_LIMITS.burst, this.tokens + ((t - this.refilled) / 1000) * CALL_REACT_LIMITS.perSecond);
    this.refilled = t;
    if (this.tokens < 1) return;
    this.tokens -= 1;
    this.show(name);
    this.room.send(CALL_REACT_TOPIC, enc.encode(JSON.stringify({ r: name })), { reliable: false });
  }

  private take(payload: Uint8Array, from: string): void {
    let raw: unknown;
    try { raw = JSON.parse(dec.decode(payload)); } catch { raw = null; }
    const m = CallReactMessageSchema.safeParse(raw);
    if (!m.success) { rlog.debug('a reaction didn’t read', { from }); return; }
    this.show(m.data.r);
  }

  /** One reaction: a single emoji, or, while they're coming fast, a few spread wider and thrown higher. */
  private show(name: CallReaction): void {
    const now = Date.now();
    this.recent = this.recent.filter((t) => now - t < BURST_MS);
    this.recent.push(now);
    // How hard it's bursting, 0 (one now and then) to 1 (a flood).
    const heat = Math.min(1, Math.max(0, this.recent.length - BURST_AT + 1) / 8);
    const copies = heat > 0 ? 1 + Math.round(between(1, 2 + heat)) : 1;
    const added: BurstItem[] = [];
    for (let i = 0; i < copies; i++) {
      // Across the strip, 0 to 1: the middle 70% one at a time, all of it in a flood.
      const spread = 0.7 + 0.3 * heat;
      added.push({
        id: `r${++this.seq}`, name,
        x: (1 - spread) / 2 + Math.random() * spread,
        // From the foot of the screen to where they peak, as a share of its height: a fifth to a quarter up, higher in a flood.
        lift: between(0.195, 0.27) + heat * between(0.04, 0.11),
        drift: between(-15, 9) * (1 + heat),
        size: Math.round(between(28, 36) + (i > 0 ? between(-8, 4) : 0)),
        turn: between(-18, 18) * (1 + heat)
      });
    }
    this.items = [...this.items, ...added].slice(-MOST);
    this.emit();
    const t = setTimeout(() => {
      this.timers.delete(t);
      const gone = new Set(added.map((a) => a.id));
      this.items = this.items.filter((it) => !gone.has(it.id));
      this.emit();
    }, SHOWN_MS);
    this.timers.add(t);
  }

  private emit(): void { this.listeners.forEach((l) => l()); }

  /** Stops: nothing more is sent or taken, and what's showing goes. */
  dispose(): void {
    this.stopReceiving();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.items = [];
    this.listeners.clear();
  }
}

const NONE: BurstItem[] = [];
const quiet = () => () => undefined;

/** What's floating up now: nothing until the room's connected. */
export function useBurst(reactions: CallReactions | null): BurstItem[] {
  return useSyncExternalStore(reactions?.subscribe ?? quiet, () => reactions?.getSnapshot() ?? NONE);
}
