/*
 * What's on its way between this instance and browsers, for documents: room held for updates arriving and for what's being
 * sent (a document opening, a line of its stream, a version, a search), so one person's big document never holds up
 * everyone else's.
 */
import type { StreamingApi } from 'hono/utils/stream';
import type { Deps } from '../../../platform/context';
import { UnavailableError } from '../../../platform/errors';
import { type Hub } from '../../../live/hub';
import { inPieces } from '../live/stream';
import { INLINE_BYTES, BIG_DOC_BYTES } from './documents';

/** How much of updates can be coming in at once, past what's small enough to be typing: past it, a browser tries again. */
const RECEIVING_BYTES = 128 * 1024 * 1024;
/** What this instance has coming in and going out, as much of it can be megabytes, and whoever's asked for it. */
interface Traffic { sending: number; sendingBy: Map<string, number>; sendingTo: Map<string, number>; receiving: number }
const trafficByHub = new WeakMap<Hub, Traffic>();
export function trafficOn(hub: Hub): Traffic {
  const traffic = trafficByHub.get(hub) ?? { sending: 0, sendingBy: new Map<string, number>(), sendingTo: new Map<string, number>(), receiving: 0 };
  trafficByHub.set(hub, traffic);
  return traffic;
}
/** Holds room for what's about to come in, which is known before any of it's read. Nothing's held for what's small enough to be typing. */
export function takeReceiving(d: Deps, bytes: number): () => void {
  if (bytes <= INLINE_BYTES) return () => undefined;
  const traffic = trafficOn(d.hub);
  if (traffic.receiving > 0 && traffic.receiving + bytes > RECEIVING_BYTES) throw new UnavailableError('Alcove is very busy right now. This will carry on by itself in a moment.', { context: { bytes, receiving: traffic.receiving } });
  traffic.receiving += bytes;
  let holding = true;
  return () => { if (holding) { holding = false; traffic.receiving -= bytes; } };
}

/** Writes one line, or gives up on a reader who hasn't taken each piece of it within a ping. */
export async function lineFor(d: Deps, out: StreamingApi, text: string | Uint8Array): Promise<boolean> {
  if (await inPieces(out, text, d.cfg.LIVE_PING_MS)) return true;
  out.abort();
  return false;
}

/** How long bytes are as base64url. */
export const asAscii = (bytes: number): number => Math.ceil((bytes * 4) / 3);
/** What's small enough to go whatever else is on its way: everyone's ordinary documents, which nobody's unread stream gets to hold up. There's one of these to a stream, and streams have their limit. */
const SMALL_SEND_BYTES = asAscii(BIG_DOC_BYTES);
/** Room held for something on its way to a browser. `settle`: what it turned out to be. */
export interface Sending { settle(bytes: number): void; release(): void }
/** What one person, or one address, can have on its way, as a part of all there can be. */
const SHARE = 4;
/**
 * Takes room for something on its way to a browser: a document opening, a line of its stream, a version, a search. That's
 * before anything's opened, so it counts however many are opening at once, and it's held until the last of it has left or the
 * reader has, so what nobody reads stays counted. Past the limit overall, or a quarter of it for one person or one address,
 * the browser's told to try again. Someone with nothing on its way is held back only by the overall limit, and with nothing
 * at all on its way anything goes, however big: a document can be bigger than any of these, and has to be able to open.
 */
export function takeSending(d: Deps, who: string, address: string, wanted: number): Sending {
  const traffic = trafficOn(d.hub);
  const all = d.cfg.DOC_SENDING_MB * 1024 * 1024;
  const theirs = traffic.sendingBy.get(who) ?? 0;
  const there = traffic.sendingTo.get(address) ?? 0;
  const over = (n: number, limit: number) => n > 0 && n + wanted > limit;
  if (wanted > SMALL_SEND_BYTES && (over(theirs, all / SHARE) || over(there, all / SHARE) || over(traffic.sending, all))) {
    throw new UnavailableError('Too many documents are on their way right now. Try again in a moment.', { context: { wanted, theirs, there, sending: traffic.sending } });
  }
  let held = 0;
  const count = (counts: Map<string, number>, key: string, bytes: number) => {
    const now = (counts.get(key) ?? 0) + bytes - held;
    if (now > 0) counts.set(key, now);
    else counts.delete(key);
  };
  const hold = (bytes: number) => {
    count(traffic.sendingBy, who, bytes);
    count(traffic.sendingTo, address, bytes);
    traffic.sending += bytes - held;
    held = bytes;
  };
  hold(wanted);
  return { settle: hold, release: () => { hold(0); } };
}
