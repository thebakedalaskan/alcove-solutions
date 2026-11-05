/*
 * What's let into a document's log (docs: Data and storage › Documents). Yjs trusts what it's given: an update that's well
 * formed but impossible can leave a document nobody can open, and nothing shows until a compaction has made that permanent.
 * So every update from a browser is read here first, and refused unless an honest client could have sent it.
 *
 * It's about structs, never about what a document means, so a board goes through the same door as a page. It reads Yjs's
 * format byte by byte and builds nothing from it, which lets it stop at a cap, walk values without recursing, and see what
 * Yjs's own decoder lets past. `inspect` needs only the update, and runs with nothing held. `refusalGiven` needs what the
 * log already holds, and runs under the document's lock.
 *
 * It can't catch everything: Yjs's conflict scan is quadratic in shapes that need the whole document to see. What's left is
 * for workers to contain (live/docPool.ts).
 */
import * as decoding from 'lib0/decoding';

/** Why an update isn't something an honest client sends. It goes in logs, so it says what was wrong and nothing of what was in it. */
export type Refusal =
  | 'unreadable' | 'too-many-items' | 'too-many-deletes' | 'client-out-of-range' | 'client-repeated' | 'client-empty' | 'zero-length' | 'skip' | 'content'
  | 'clock-out-of-range' | 'shared-origin' | 'too-deep' | 'waiting-for-ever' | 'trailing-bytes' | 'not-theirs' | 'gap' | 'unknown-reference' | 'unknown-delete';
/**
 * What's too much, as opposed to what no honest client could send. A browser can't do anything about the second. Taking
 * something out makes the first go through, so it hears the difference.
 */
const TOO_MUCH: ReadonlySet<string> = new Set<Refusal>(['too-many-items', 'too-many-deletes', 'shared-origin', 'too-deep']);
export const isTooMuch = (why: string): boolean => TOO_MUCH.has(why);

/** What one update may hold, so what's read never costs more than this. */
export interface Caps { items: number; sharedOrigin: number; nesting: number }
/**
 * What a browser's update may hold: as much as a document may, in `items`, so nothing fits in a document and not in an
 * update. Any number of clients, as what's waiting in a browser can have been written by any number of sessions, and each
 * of them brings an item. Items with the same left neighbour make Yjs's conflict scan quadratic, and a browser only writes
 * them by inserting again and again without the caret moving, so a thousand is far past anything typed.
 */
export const browserCaps = (items: number): Caps => ({ items, sharedOrigin: 1024, nesting: 1024 });
/** For what the server made or already holds: it's read to know its shape, not to judge it. */
export const SERVER_CAPS: Caps = { items: Infinity, sharedOrigin: Infinity, nesting: Infinity };
/**
 * How deep types may nest, whatever's in them. Deleting a type recurses into what's in it, in every browser, so this stays
 * well inside anyone's stack. Nothing written by hand comes within a hundredth of it.
 */
export const MAX_NESTING = 1024;
/** How deep a value inside an item may nest: lib0 and JSON recurse through these too. */
const MAX_VALUE_DEPTH = 64;
/** An attribute bigger than this is content, whatever it's written on: what's small is a block's own settings, which nobody fills a document with. */
const SMALL_ATTRIBUTE_BYTES = 512;
/** Clients are random 32-bit numbers. */
const MAX_CLIENT = 0xFFFFFFFF;
/** Far past what anyone types, and far short of where a clock stops being an exact number. */
const MAX_CLOCK = 2 ** 46;

/** One client's part of an update: the clocks it brings. */
export interface Block { client: number; from: number; to: number }
/** The shape of an update, with nothing of what it says. Plain data, so a worker can hand it back. */
export interface Inspected {
  blocks: Block[];
  /** `[client, clock]`: what it builds on, and has to be there already. */
  needs: [number, number][];
  /** `[client, clock]`: how far what it deletes reaches, each past the end of a range. */
  deletes: [number, number][];
  items: number;
  /** How many levels of type it adds below what's there. */
  nesting: number;
  /**
   * How much it adds that's new text or new elements, as Yjs counts it. Not an attribute on something, and not what's only
   * a deleted thing keeping its place: that's how blocks leave a page, and leaving has to work however full a document is.
   */
  content: number;
  /** How much it deletes, as Yjs counts it, which may be something already gone: this only ever excuses what a full document takes. */
  deleted: number;
}
export type Inspection = { seen: Inspected; why?: undefined } | { seen?: undefined; why: Refusal };

type Id = readonly [number, number];
interface Struct { clock: number; length: number; origin: Id | null; right: Id | null; parent: Id | null; type: boolean; depth: number }
interface Reading { client: number; from: number; end: number; reached: number; at: number; content: number; structs: Struct[] }

const refused = (why: Refusal): Inspection => ({ why });
/** What's left to read. Everything an update counts takes at least a byte of it, so a count past this isn't one: it's not an update at all, rather than too much of one. */
const left = (d: decoding.Decoder): number => d.arr.length - d.pos;
const readId = (d: decoding.Decoder): Id => [decoding.readVarUint(d), decoding.readVarUint(d)];

/** Whether text is JSON Yjs can write back: `JSON.stringify` recurses, so a value it can't get through would stop every read of the document. */
function isJson(text: string): boolean {
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (quoted) {
      if (c === 92) i++;
      else if (c === 34) quoted = false;
    } else if (c === 34) quoted = true;
    else if (c === 91 || c === 123) {
      if (++depth > MAX_VALUE_DEPTH) return false;
    } else if (c === 93 || c === 125) depth--;
  }
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
/** Past one of lib0's values, without recursing. False if it isn't one, or goes too deep. */
function skipAny(d: decoding.Decoder): boolean {
  const open: { left: number; keyed: boolean }[] = [{ left: 1, keyed: false }];
  for (let top = open.at(-1); top; top = open.at(-1)) {
    if (top.left === 0) { open.pop(); continue; }
    top.left--;
    if (top.keyed) decoding.readVarString(d);
    const tag: number | undefined = decoding.readUint8(d);
    switch (tag) {
      case 127: case 126: case 121: case 120: break;
      case 125: decoding.readVarInt(d); break;
      case 124: decoding.readFromDataView(d, 4); break;
      case 123: case 122: decoding.readFromDataView(d, 8); break;
      case 119: decoding.readVarString(d); break;
      case 118: open.push({ left: decoding.readVarUint(d), keyed: true }); break;
      case 117: open.push({ left: decoding.readVarUint(d), keyed: false }); break;
      case 116: decoding.readVarUint8Array(d); break;
      default: return false;
    }
    if (open.length > MAX_VALUE_DEPTH) return false;
  }
  return true;
}
/** Past an item's content, saying how many clocks it takes. Null for content nothing here should hold: a sub-document needs a sync of its own. */
function contentLength(d: decoding.Decoder, ref: number): number | null {
  switch (ref) {
    case 1: return decoding.readVarUint(d);
    case 2: {
      const n = decoding.readVarUint(d);
      for (let i = 0; i < n; i++) { const text = decoding.readVarString(d); if (text !== 'undefined' && !isJson(text)) return null; }
      return n;
    }
    case 3: decoding.readVarUint8Array(d); return 1;
    case 4: return decoding.readVarString(d).length;
    case 5: return isJson(decoding.readVarString(d)) ? 1 : null;
    case 6: decoding.readVarString(d); return isJson(decoding.readVarString(d)) ? 1 : null;
    case 7: {
      const type = decoding.readVarUint(d);
      if (type > 6) return null;
      if (type === 3 || type === 5) decoding.readVarString(d);
      return 1;
    }
    case 8: {
      const n = decoding.readVarUint(d);
      for (let i = 0; i < n; i++) if (!skipAny(d)) return null;
      return n;
    }
    default: return null;
  }
}
/** The struct holding a clock, in a client's part of this update. */
function structAt(r: Reading, clock: number): Struct | undefined {
  let lo = 0;
  let hi = r.structs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = r.structs[mid];
    if (!s) return undefined;
    if (clock < s.clock) hi = mid - 1;
    else if (clock >= s.clock + s.length) lo = mid + 1;
    else return s;
  }
  return undefined;
}

/** Whether a clock is in what this update brings of its client. */
const arrives = (r: Reading | undefined, clock: number): r is Reading => r !== undefined && clock >= r.from && clock < r.end;

/**
 * Works through what's in the update as Yjs would: nothing can be placed before what it refers to. Anything that can never
 * be placed is refused, because Yjs would hold it pending for ever, in every browser and every snapshot. On the way it finds
 * out how deep this goes below what's already there, and what it needs from the log. That's anything that doesn't arrive
 * here, before a client's part of the update or after it: two tabs share a store, so what's going can be an old part of a
 * client with something built on a later part, which the log has by now. If it hasn't, it's refused under its lock.
 */
function settle(readings: Reading[], caps: Caps): { nesting: number; needs: Map<number, number> } | Refusal {
  const byClient = new Map(readings.map((r) => [r.client, r]));
  const needs = new Map<number, number>();
  const placed = (id: Id | null): boolean => {
    if (!id) return true;
    const r = byClient.get(id[0]);
    return !arrives(r, id[1]) || id[1] < r.reached;
  };
  /** How many levels below what's known something is: zero for anything that isn't in this update. */
  const depthOf = (id: Id): number | undefined => {
    const r = byClient.get(id[0]);
    if (arrives(r, id[1])) return structAt(r, id[1])?.depth;
    needs.set(id[0], Math.max(needs.get(id[0]) ?? 0, id[1] + 1));
    return undefined;
  };
  let left = readings.reduce((n, r) => n + r.structs.length, 0);
  let nesting = 0;
  while (left) {
    let moved = false;
    for (const r of readings) {
      for (let s = r.structs[r.at]; s && placed(s.origin) && placed(s.right) && placed(s.parent); s = r.structs[r.at]) {
        let depth = 0;
        if (s.parent) depth = (depthOf(s.parent) ?? 0) + 1;
        if (s.origin) depth = Math.max(depth, depthOf(s.origin) ?? 0);
        if (s.right) depth = Math.max(depth, depthOf(s.right) ?? 0);
        s.depth = depth;
        if (s.type && depth > nesting) {
          nesting = depth;
          if (nesting > caps.nesting) return 'too-deep';
        }
        r.reached = s.clock + s.length;
        r.at++;
        left--;
        moved = true;
      }
    }
    if (!moved) return 'waiting-for-ever';
  }
  return { nesting, needs };
}

/** Reads one client's part of an update. */
function readBlock(d: decoding.Decoder, caps: Caps, count: number, client: number, origins: Map<string, number>): Reading | Refusal {
  const from = decoding.readVarUint(d);
  const r: Reading = { client, from, end: from, reached: from, at: 0, content: 0, structs: [] };
  let clock = from;
  for (let i = 0; i < count; i++) {
    const info: number | undefined = decoding.readUint8(d);
    if (info === undefined) return 'unreadable';
    const ref = info & 31;
    if (ref === 10) return 'skip';
    let length: number | null;
    let origin: Id | null = null;
    let right: Id | null = null;
    let parent: Id | null = null;
    if (ref === 0) length = decoding.readVarUint(d);
    else {
      if (info & 0x80) origin = readId(d);
      if (info & 0x40) right = readId(d);
      if (!(info & 0xC0)) {
        const named = decoding.readVarUint(d);
        if (named > 1) return 'content';
        if (named === 1) decoding.readVarString(d);
        else parent = readId(d);
        if (info & 0x20) decoding.readVarString(d);
      }
      const started = d.pos;
      length = contentLength(d, ref);
      if (length === null) return 'content';
      // Yjs marks a map entry as one whether or not its key is written, so this needs nothing of what a document means.
      const attribute = (info & 0x20) !== 0 && ref !== 7 && d.pos - started <= SMALL_ATTRIBUTE_BYTES;
      if (!attribute && ref !== 1) r.content += length;
    }
    if (length === 0) return 'zero-length';
    if (origin) {
      const key = `${origin[0]}:${origin[1]}`;
      const sharing = (origins.get(key) ?? 0) + 1;
      if (sharing > caps.sharedOrigin) return 'shared-origin';
      origins.set(key, sharing);
    }
    r.structs.push({ clock, length, origin, right, parent, type: ref === 7, depth: 0 });
    clock += length;
    if (clock > MAX_CLOCK) return 'clock-out-of-range';
  }
  r.end = clock;
  return r;
}

/** Reads an update's structs and deletes against `caps`, with nothing but the update to go on. */
function read(update: Uint8Array, caps: Caps): Inspection {
  const d = decoding.createDecoder(update);
  const clients = decoding.readVarUint(d);
  if (clients > left(d)) return refused('unreadable');
  const readings: Reading[] = [];
  const seenClients = new Set<number>();
  const origins = new Map<string, number>();
  let items = 0;
  for (let i = 0; i < clients; i++) {
    const count = decoding.readVarUint(d);
    if (!count) return refused('client-empty');
    if (count > left(d)) return refused('unreadable');
    items += count;
    if (items > caps.items) return refused('too-many-items');
    const client = decoding.readVarUint(d);
    if (client > MAX_CLIENT) return refused('client-out-of-range');
    if (seenClients.has(client)) return refused('client-repeated');
    seenClients.add(client);
    const r = readBlock(d, caps, count, client, origins);
    if (typeof r === 'string') return refused(r);
    readings.push(r);
  }
  const settled = settle(readings, caps);
  if (typeof settled === 'string') return refused(settled);

  const deletes = new Map<number, number>();
  let ranges = 0;
  let deletedLength = 0;
  const deleted = decoding.readVarUint(d);
  if (deleted > left(d)) return refused('unreadable');
  for (let i = 0; i < deleted; i++) {
    const client = decoding.readVarUint(d);
    const n = decoding.readVarUint(d);
    if (n > left(d)) return refused('unreadable');
    ranges += n;
    if (ranges > caps.items) return refused('too-many-deletes');
    for (let j = 0; j < n; j++) {
      const clock = decoding.readVarUint(d);
      const length = decoding.readVarUint(d);
      if (!length) return refused('zero-length');
      if (clock + length > MAX_CLOCK) return refused('clock-out-of-range');
      deletes.set(client, Math.max(deletes.get(client) ?? 0, clock + length));
      deletedLength += length;
    }
  }
  if (decoding.hasContent(d)) return refused('trailing-bytes');
  return {
    seen: {
      blocks: readings.map((r) => ({ client: r.client, from: r.from, to: r.reached })), needs: [...settled.needs], deletes: [...deletes], items, nesting: settled.nesting,
      content: readings.reduce((n, r) => n + r.content, 0), deleted: deletedLength
    }
  };
}
/** The shape of an update, or why it's refused. It never throws: nothing in the update gets to decide that. */
export function inspect(update: Uint8Array, caps: Caps): Inspection {
  try {
    return read(update, caps);
  } catch {
    return refused('unreadable');
  }
}

/** Every client an update's checks need to know about. */
export const clientsOf = (seen: Inspected): number[] => [...new Set([...seen.blocks.map((b) => b.client), ...seen.needs.map(([c]) => c), ...seen.deletes.map(([c]) => c)])];
/** What the log says of one client: how far it's written, and who it belongs to. Nobody, for what the server wrote. */
export interface KnownClient { next: number; people: Uint8Array[] }

/**
 * Whether an update fits what the log holds, under its lock. Clocks carry on from where a client got to, or go over what's
 * there again, as a retry does: Yjs ignores what it has. Everything referred to is there or arrives with this. Nobody writes
 * as someone else's client: Yjs would believe them, and whatever that client wrote next would vanish.
 */
export function refusalGiven(seen: Inspected, known: Map<number, KnownClient>, theirs: (client: number, people: Uint8Array[]) => boolean): Refusal | null {
  const reached = new Map<number, number>();
  for (const [client, k] of known) reached.set(client, k.next);
  for (const b of seen.blocks) {
    const k = known.get(b.client);
    if (k && !theirs(b.client, k.people)) return 'not-theirs';
    if (b.from > (k?.next ?? 0)) return 'gap';
    reached.set(b.client, Math.max(reached.get(b.client) ?? 0, b.to));
  }
  for (const [client, clock] of seen.needs) if (clock > (reached.get(client) ?? 0)) return 'unknown-reference';
  for (const [client, clock] of seen.deletes) if (clock > (reached.get(client) ?? 0)) return 'unknown-delete';
  return null;
}
/** Whether an update brings anything the log doesn't have yet: one that doesn't has been here before. */
export const bringsNew = (seen: Inspected, known: Map<number, KnownClient>): boolean => seen.blocks.some((b) => b.to > (known.get(b.client)?.next ?? 0));
