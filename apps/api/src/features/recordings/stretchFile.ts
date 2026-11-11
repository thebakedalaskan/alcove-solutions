/*
 * A stretch of a recording as a file of its own, for Hear it. MediaRecorder hands a recording over in pieces cut wherever
 * its timeslice falls, not on the file's own structure: in Chrome every piece after the first starts with the end of the
 * last block of the piece before it, and its own Cluster a couple of thousand bytes in. And every Cluster keeps the time it
 * was recorded at, counted from the start of the segment. A stretch from part way through, played as it is, starts at that
 * time while browsers count the file from 0, so seeking to a line's place in the stretch lands where nothing is: silence.
 *
 * So a stretch opens on its first Cluster (a WebM's) or movie fragment (an MP4's), counts its times from that one, and
 * stops after its last whole element. Each time is rewritten in place, in the width it had, so nothing moves.
 */

type Container = 'webm' | 'mp4';
const containerOf = (mimeType: string): Container | null => {
  const type = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return type === 'audio/webm' ? 'webm' : type === 'audio/mp4' ? 'mp4' : null;
};

/** What reading something at a place found: it, nothing that can be read there (`null`), or the bytes ran out first. */
type Read<T> = T | 'short' | null;

/* ---------- WebM: EBML elements ---------- */

const CLUSTER = 0x1f43b675;
const TIMESTAMP = 0xe7;

interface Vint { value: number; length: number; unknown: boolean }
/** An EBML variable-length integer at `i`: an element's ID, its length marker kept, or a size without it. */
function vint(b: Uint8Array, i: number, id: boolean): Read<Vint> {
  const first = b[i];
  if (first === undefined) return 'short';
  if (first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (i + length > b.length) return 'short';
  const mask = 0xff >> length;
  let value = id ? first : first & mask;
  // A size with every bit set is unknown: the element runs until something that can't be in it starts.
  let ones = (first & mask) === mask;
  for (let k = 1; k < length; k++) {
    const x = b[i + k] ?? 0;
    value = value * 256 + x;
    if (x !== 0xff) ones = false;
  }
  return { value, length, unknown: !id && ones };
}

interface Element { id: number; at: number; sizeAt: number; sizeLength: number; dataAt: number; size: number | null }
function elementAt(b: Uint8Array, i: number): Read<Element> {
  const id = vint(b, i, true);
  if (id === null || id === 'short') return id;
  if (id.length > 4) return null;
  const size = vint(b, i + id.length, false);
  if (size === null || size === 'short') return size;
  return { id: id.value, at: i, sizeAt: i + id.length, sizeLength: size.length, dataAt: i + id.length + size.length, size: size.unknown ? null : size.value };
}

/** Whether a Cluster starts at `i`: its ID, a size, then its Timestamp, as MediaRecorder writes every one. */
function clusterAt(b: Uint8Array, i: number): boolean {
  const c = elementAt(b, i);
  if (c === null || c === 'short' || c.id !== CLUSTER) return false;
  const t = elementAt(b, c.dataAt);
  return t !== null && t !== 'short' && t.id === TIMESTAMP && t.size !== null && t.size >= 1 && t.size <= 8 && t.dataAt + t.size <= b.length;
}

const uintAt = (b: Uint8Array, at: number, width: number): bigint => {
  let v = 0n;
  for (let k = 0; k < width; k++) v = (v << 8n) | BigInt(b[at + k] ?? 0);
  return v;
};
function putUint(b: Uint8Array, at: number, width: number, value: bigint): void {
  let v = value;
  for (let k = width - 1; k >= 0; k--) { b[at + k] = Number(v & 0xffn); v >>= 8n; }
}
/** A size, in the width the one it replaces had: a smaller one always fits. */
function putSize(b: Uint8Array, at: number, width: number, value: number): void {
  putUint(b, at, width, BigInt(value));
  b[at] = (b[at] ?? 0) | (0x80 >> (width - 1));
}

/**
 * From the Cluster at `at`: every Cluster's Timestamp less the first one's, and where the file ends whole. A Cluster cut
 * off by the piece after the stretch says how much of it there is, if it said its size. Null if what follows isn't EBML.
 */
function webmFromZero(b: Uint8Array, at: number): number | null {
  let zero: bigint | null = null;
  let end = at;
  let last: Element | null = null;
  for (let i = at; i < b.length;) {
    const e = elementAt(b, i);
    if (e === null) return null;
    if (e === 'short') break;
    // Its children follow, whether or not it says how far they go.
    if (e.id === CLUSTER) { last = e; i = e.dataAt; continue; }
    if (e.size === null) return null;
    if (e.dataAt + e.size > b.length) break;
    if (e.id === TIMESTAMP && e.size >= 1 && e.size <= 8) {
      const t = uintAt(b, e.dataAt, e.size);
      zero ??= t;
      putUint(b, e.dataAt, e.size, t > zero ? t - zero : 0n);
    }
    i = end = e.dataAt + e.size;
  }
  if (zero === null) return null;
  if (last && last.size !== null && last.dataAt <= end && last.dataAt + last.size > end) putSize(b, last.sizeAt, last.sizeLength, end - last.dataAt);
  return end;
}

/* ---------- MP4: boxes, in fragments ---------- */

interface Box { type: string; dataAt: number; end: number }
function boxAt(b: Uint8Array, v: DataView, i: number): Read<Box> {
  if (i + 8 > b.length) return 'short';
  const size32 = v.getUint32(i);
  const type = String.fromCharCode(...b.subarray(i + 4, i + 8));
  if (size32 === 1) {
    if (i + 16 > b.length) return 'short';
    const large = v.getBigUint64(i + 8);
    if (large < 16n || large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return { type, dataAt: i + 16, end: i + Number(large) };
  }
  // Size 0: the box runs to the end of the file.
  if (size32 === 0) return { type, dataAt: i + 8, end: b.length };
  return size32 < 8 ? null : { type, dataAt: i + 8, end: i + size32 };
}

const viewOf = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Whether a movie fragment starts at `i`: a 'moof' box whose first child is its 'mfhd', as every fragment's is. */
function fragmentAt(b: Uint8Array, i: number): boolean {
  const v = viewOf(b);
  const m = boxAt(b, v, i);
  if (m === null || m === 'short' || m.type !== 'moof') return false;
  const h = boxAt(b, v, m.dataAt);
  return h !== null && h !== 'short' && h.type === 'mfhd';
}

/** Each track's decode times in one fragment, less the first fragment's. False if it isn't laid out as a fragment is. */
function retime(b: Uint8Array, v: DataView, moof: Box, zero: Map<number, bigint>): boolean {
  for (let i = moof.dataAt; i < moof.end;) {
    const traf = boxAt(b, v, i);
    if (traf === null || traf === 'short' || traf.end > moof.end) return false;
    if (traf.type === 'traf') {
      let track: number | null = null;
      for (let k = traf.dataAt; k < traf.end;) {
        const c = boxAt(b, v, k);
        if (c === null || c === 'short' || c.end > traf.end) return false;
        if (c.type === 'tfhd') {
          if (c.dataAt + 8 > c.end) return false;
          // Offsets counted from the start of the file would point elsewhere once it's cut. MediaRecorder counts them from each fragment.
          if ((v.getUint32(c.dataAt) & 0x000001) !== 0) return false;
          track = v.getUint32(c.dataAt + 4);
        }
        if (c.type === 'tfdt') {
          const wide = b[c.dataAt] === 1;
          if (track === null || c.dataAt + (wide ? 12 : 8) > c.end) return false;
          const t = wide ? v.getBigUint64(c.dataAt + 4) : BigInt(v.getUint32(c.dataAt + 4));
          const first = zero.get(track) ?? t;
          zero.set(track, first);
          const d = t > first ? t - first : 0n;
          if (wide) v.setBigUint64(c.dataAt + 4, d);
          else v.setUint32(c.dataAt + 4, Number(d));
        }
        k = c.end;
      }
    }
    i = traf.end;
  }
  return true;
}

/**
 * From the fragment at `at`: its decode times less the first fragment's, and the end of the last fragment there's all of.
 * A fragment without a decode time counts on from the one before it, which from the first one here is from 0 already.
 */
function mp4FromZero(b: Uint8Array, at: number): number | null {
  const v = viewOf(b);
  const zero = new Map<number, bigint>();
  let end = at;
  let fragments = 0;
  for (let i = at; i < b.length;) {
    const x = boxAt(b, v, i);
    if (x === null) return null;
    if (x === 'short' || x.end > b.length) break;
    if (x.type === 'moof') {
      if (!retime(b, v, x, zero)) return null;
      fragments++;
    }
    // A fragment's sound is in the box after it: a fragment cut off before its sound is left out.
    else end = x.end;
    i = x.end;
  }
  return fragments ? end : null;
}

/* ---------- a stretch ---------- */

/**
 * Where a piece's sound starts: its first Cluster (WebM) or movie fragment (MP4). In the first piece of a segment, what's
 * before it says what the recording is; in a later one, it's the end of the piece before. Null when there's none, or
 * it's another kind of file.
 */
export function soundStarts(b: Uint8Array, mimeType: string): number | null {
  const kind = containerOf(mimeType);
  if (kind === 'webm') {
    for (let i = b.indexOf(0x1f); i >= 0 && i + 4 <= b.length; i = b.indexOf(0x1f, i + 1)) {
      if (b[i + 1] === 0x43 && b[i + 2] === 0xb6 && b[i + 3] === 0x75 && clusterAt(b, i)) return i;
    }
  }
  if (kind === 'mp4') {
    for (let i = b.indexOf(0x6d, 4); i >= 4 && i + 4 <= b.length; i = b.indexOf(0x6d, i + 1)) {
      if (b[i + 1] === 0x6f && b[i + 2] === 0x6f && b[i + 3] === 0x66 && fragmentAt(b, i - 4)) return i - 4;
    }
  }
  return null;
}

/**
 * The stretch `b`, whose sound starts at `at` on a Cluster or a fragment, with its times counted from there and cut after
 * the last element it has all of (the rest went with the piece after it). Rewritten in place. Null if it isn't laid out
 * as a recording is, or it's another kind of file.
 */
export function fromZero(b: Uint8Array, at: number, mimeType: string): Uint8Array | null {
  const kind = containerOf(mimeType);
  const end = kind === 'webm' ? webmFromZero(b, at) : kind === 'mp4' ? mp4FromZero(b, at) : null;
  return end === null ? null : b.subarray(0, end);
}
