/*
 * Sending a file to a workspace, a piece at a time, and reading pictures back (docs: Data and storage › Media). A piece that
 * fails on the way is sent again, because it's kept by its place in the file: if it arrived and only the answer was lost,
 * nothing is kept twice. Through a lost connection or a busy server it keeps trying for minutes, because everything already
 * stored is safe and a Wi-Fi handover mustn't start 500 MiB over. Once it gives up, or the browser does, it takes back what
 * got there rather than leave it for upkeep. A picture keeps trying the same way, because an `<img>` left to itself can't,
 * and a browser reads a few at a time, so a room opening one board doesn't ask for everything at once.
 */
import { AlcoveApiError, MEDIA_PIECE_BYTES, errorCode, type MediaInput, type MediaUploadOptions, type WorkspaceMedia } from '@alcove/api';

/** What sending a file takes of the API. */
export interface MediaUpload {
  begin(input: MediaInput): Promise<{ id: string }>;
  piece(mediaId: string, seq: number, bytes: Blob): Promise<void>;
  finish(mediaId: string): Promise<WorkspaceMedia>;
  /** Keeps a picture's preview beside it, once it's finished. */
  preview(mediaId: string, jpeg: Blob): Promise<void>;
  abandon(mediaId: string): Promise<void>;
}
type Note = (level: 'info' | 'warn', msg: string, context: Record<string, string | number | boolean | null>) => void;

/** How long to wait before each further try, the last for all the rest. */
const WAITS_MS = [200, 800, 2000, 5000, 10_000, 15_000];
/** What passes by itself, however long it takes: the connection, or the server being busy. */
const PASSES = new Set(['network', 'unavailable']);
/** The same, from what stands in front of the API: its error pages aren't ours, so all they say is their status. */
const PASSING_STATUS = new Set([429, 502, 503, 504]);
const passes = (e: unknown): boolean => PASSES.has(errorCode(e)) || (e instanceof AlcoveApiError && e.status !== undefined && PASSING_STATUS.has(e.status));
/** A failure on the server's side is tried this many times more, and past that it's taken for real. Anything else was refused, and will be again. */
const SERVER_TRIES = 3;
const PATIENCE_MS = 5 * 60_000;

/** Waits, unless it's given up on first, or the browser says the connection is back, which is worth more than the rest of the wait. */
const wait = (ms: number, signal: AbortSignal | undefined) => new Promise<void>((resolve) => {
  const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); globalThis.removeEventListener?.('online', done); resolve(); };
  const timer = setTimeout(done, ms);
  signal?.addEventListener('abort', done, { once: true });
  globalThis.addEventListener?.('online', done, { once: true });
});

interface Patience { signal: AbortSignal | undefined; patienceMs: number; note: Note; stopped: string }
/** Tries something until it works, it's taken for real, or it's given up on. */
async function patiently<T>(what: string, go: () => Promise<T>, o: Patience): Promise<T> {
  const stopIfAsked = () => { if (o.signal?.aborted) throw new AlcoveApiError('network', o.stopped); };
  const began = Date.now();
  for (let attempt = 0; ; attempt++) {
    stopIfAsked();
    try {
      return await go();
    } catch (e) {
      stopIfAsked();
      const spent = passes(e) ? Date.now() - began >= o.patienceMs : errorCode(e) !== 'unknown' || attempt >= SERVER_TRIES;
      if (spent) throw e;
      o.note('warn', 'a file failed on the way; trying again', { what, code: errorCode(e), attempt: attempt + 1 });
      // A little apart, so everyone a busy server refused doesn't come back in the same moment.
      await wait((WAITS_MS[attempt] ?? WAITS_MS.at(-1) ?? 0) * (0.8 + Math.random() * 0.4), o.signal);
    }
  }
}

export async function sendFile(t: MediaUpload, file: File, o: MediaUploadOptions | undefined, note: Note, patienceMs = PATIENCE_MS): Promise<WorkspaceMedia> {
  const patience: Patience = { signal: o?.signal, patienceMs, note, stopped: 'That upload was stopped.' };
  const { id } = await patiently('start', () => t.begin({ name: file.name, type: file.type, size: file.size, ...(o?.width ? { width: o.width } : {}), ...(o?.height ? { height: o.height } : {}) }), patience);
  try {
    for (let seq = 0, at = 0; at < file.size; seq++, at += MEDIA_PIECE_BYTES) {
      const place = seq;
      const piece = file.slice(at, at + MEDIA_PIECE_BYTES);
      await patiently(`piece ${place}`, () => t.piece(id, place, piece), patience);
      o?.onProgress?.({ sent: Math.min(at + MEDIA_PIECE_BYTES, file.size), total: file.size });
    }
    const finished = await patiently('finish', () => t.finish(id), patience);
    // A preview is for pickers: one that doesn't get there leaves the picture drawn from itself, as one from before previews is.
    const preview = o?.preview;
    if (preview) await patiently('preview', () => t.preview(id, preview), patience).catch((e: unknown) => note('info', 'a picture’s preview wasn’t kept', { code: errorCode(e) }));
    return finished;
  } catch (e) {
    note('warn', 'a file’s upload failed', { code: errorCode(e) });
    await t.abandon(id).catch((e2: unknown) => note('info', 'an unfinished upload is left for upkeep', { code: errorCode(e2) }));
    throw e;
  }
}

/** What reading a picture takes of the API: its token, and an answer to it. */
export interface PictureRead {
  token(): Promise<string>;
  read(token: string): Promise<Response>;
}
/** How many pictures one browser reads at once: a page of them is nothing, a room of pages is the server's whole line. */
const PICTURES_AT_ONCE = 4;
/** Reads pictures for one browser, a few at a time, in the order they're asked for. */
export function pictureReader(note: Note, patienceMs = PATIENCE_MS) {
  let reading = 0;
  const line: (() => void)[] = [];
  return async (t: PictureRead, signal: AbortSignal | undefined): Promise<string> => {
    if (reading < PICTURES_AT_ONCE) reading++;
    else await new Promise<void>((go) => { line.push(go); });
    let token: string | undefined;
    try {
      return await patiently('picture', async () => {
        token ??= await t.token();
        const res = await t.read(token);
        const bytes = await res.blob().catch((cause: unknown) => { throw new AlcoveApiError('network', 'That picture didn’t arrive.', { cause }); });
        return URL.createObjectURL(bytes);
      }, { signal, patienceMs, note, stopped: 'That picture was stopped.' });
    } finally {
      // Whoever's next takes this turn over.
      const next = line.shift();
      if (next) next();
      else reading--;
    }
  };
}
