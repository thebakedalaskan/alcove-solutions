/*
 * Stored pictures, as this browser shows them (docs: Data and storage › Media). Everything a document or the picker shows
 * is read with `media.picture`, through the document it's in: an object URL whose bytes stay in this browser until it's let
 * go of. So a picture is read once for as long as anything shows it, let go of a minute after the last thing stops, and
 * never asked for again on every draw. A file someone deleted for good answers `not-found`, and shows as deleted.
 */
import { errorCode } from '@alcove/api';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import type { MediaState } from '../editor/types';
import { smallJpeg, type Pixels } from './thumbs';

const plog = log.child({ component: 'workspace-media' });

/** How long a picture nothing shows stays read, so scrolling back to it or a block redrawing doesn't read it again. */
const KEEP_MS = 60_000;
/** How long before a picture that didn't come is tried again, while something still shows it. */
const AGAIN_MS = 30_000;

const LOADING: MediaState = { kind: 'loading' };
const GONE: MediaState = { kind: 'gone' };
const FAILED: MediaState = { kind: 'failed' };

interface Entry {
  documentId: string;
  media: string;
  state: MediaState;
  holders: number;
  stop: AbortController | null;
  letGo: ReturnType<typeof setTimeout> | null;
  again: ReturnType<typeof setTimeout> | null;
}

const keyOf = (documentId: string, media: string) => `${documentId}:${media}`;

/**
 * Where a player or a download reads a file, asked for afresh: it lasts 12 hours, and each read checks again. It's never
 * logged or kept anywhere: for a guest, the URL is all it takes to read the file. With `download`, it saves whatever it is.
 */
export const fileUrl = (workspaceId: string, documentId: string, media: string, pass: string | undefined, download = false): Promise<string> =>
  api.workspaces.media.url(workspaceId, documentId, media, { pass, download });

/** A photo's small picture for the picker: on its way, there (an object URL), or not to be had. */
type Small = { kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'none' };

/** One workspace's pictures, for as long as it's on screen. A guest reads them with their pass. */
export class Pictures {
  private readonly entries = new Map<string, Entry>();
  /**
   * Small pictures for the picker, by file: read once while the workspace is on screen, so opening the picker again reads
   * nothing. Its stored preview, or for a photo from before previews, the photo read once and made small here.
   */
  private readonly smalls = new Map<string, Small>();
  /** Files this browser deleted for good, or heard were: gone from every document. */
  private readonly deleted = new Set<string>();
  /** Files on their way into a document: reading one through it waits, or it would be `not-found` for a moment. */
  private readonly attaching = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(private readonly workspaceId: string, private readonly pass: string | undefined) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  readonly getSnapshot = (): number => this.version;

  private changed(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  /** Reads a picture, through a document that has it, for as long as what this returns isn't called. */
  hold(documentId: string, media: string): () => void {
    const key = keyOf(documentId, media);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { documentId, media, state: this.deleted.has(media) ? GONE : LOADING, holders: 0, stop: null, letGo: null, again: null };
      this.entries.set(key, entry);
      if (entry.state === LOADING) this.read(entry);
    }
    const held = entry;
    held.holders += 1;
    if (held.letGo) { clearTimeout(held.letGo); held.letGo = null; }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      held.holders -= 1;
      if (held.holders === 0) held.letGo = setTimeout(() => this.drop(key, held), KEEP_MS);
    };
  }

  state(documentId: string, media: string): MediaState {
    if (this.deleted.has(media)) return GONE;
    return this.entries.get(keyOf(documentId, media))?.state ?? LOADING;
  }

  url(documentId: string, media: string): string | undefined {
    const s = this.state(documentId, media);
    return s.kind === 'ready' ? s.url : undefined;
  }

  /** Whether a file is known here to have been deleted for good, or to be out of reach through this document. */
  isGone(documentId: string, media: string): boolean {
    return this.state(documentId, media).kind === 'gone';
  }

  /** A file deleted for good: everything that shows it shows it as deleted, everywhere, from now on. */
  forget(media: string): void {
    this.deleted.add(media);
    const small = this.smalls.get(media);
    if (small?.kind === 'ready') URL.revokeObjectURL(small.url);
    this.smalls.delete(media);
    for (const e of this.entries.values()) {
      if (e.media !== media) continue;
      this.stopReading(e);
      e.state = GONE;
    }
    this.changed();
  }

  /** A file found to be gone through one document: a player or a download was refused it. */
  goneFrom(documentId: string, media: string): void {
    const key = keyOf(documentId, media);
    const e = this.entries.get(key);
    if (e) { this.stopReading(e); e.state = GONE; }
    else this.entries.set(key, { documentId, media, state: GONE, holders: 0, stop: null, letGo: null, again: null });
    this.changed();
  }

  /**
   * A file is being attached to a document: reading it there waits until that's done, and what was read too soon, and
   * found missing, is read again.
   */
  attachingTo(documentId: string, media: string, done: Promise<unknown>): void {
    const key = keyOf(documentId, media);
    this.attaching.set(key, done);
    void done.catch(() => undefined).finally(() => {
      if (this.attaching.get(key) === done) this.attaching.delete(key);
      const e = this.entries.get(key);
      if (e && e.state.kind !== 'ready' && !this.deleted.has(media)) this.read(e);
    });
  }

  /** A photo's small picture, read through a document that has it the first time it's asked for. */
  small(documentId: string, media: string, size: Pixels | null): string | undefined {
    if (this.deleted.has(media)) return undefined;
    const known = this.smalls.get(media);
    if (known) return known.kind === 'ready' ? known.url : undefined;
    this.smalls.set(media, { kind: 'loading' });
    void this.readSmall(documentId, media, size);
    return undefined;
  }

  private async readSmall(documentId: string, media: string, size: Pixels | null): Promise<void> {
    const where = { workspaceId: this.workspaceId, documentId, mediaId: media };
    try {
      let url = await api.workspaces.media.preview(this.workspaceId, documentId, media, { pass: this.pass });
      if (url === null) {
        // From before previews: the photo itself, once, made small, and let go of.
        const whole = await api.workspaces.media.picture(this.workspaceId, documentId, media, { pass: this.pass });
        try {
          const small = await smallJpeg(await (await fetch(whole)).blob(), size);
          url = small ? URL.createObjectURL(small) : null;
        } finally {
          URL.revokeObjectURL(whole);
        }
        plog.debug('a photo with no preview was made small here', { ...where, made: url !== null });
      }
      if (this.smalls.get(media)?.kind !== 'loading') { if (url) URL.revokeObjectURL(url); return; }
      this.smalls.set(media, url ? { kind: 'ready', url } : { kind: 'none' });
    } catch (err) {
      plog.info('a photo’s small picture didn’t come', { ...where, code: errorCode(err) });
      if (this.smalls.get(media)?.kind === 'loading') this.smalls.set(media, { kind: 'none' });
    }
    this.changed();
  }

  /** Lets go of every picture: the workspace has gone from the screen. Anything that shows one again reads it again. */
  close(): void {
    for (const s of this.smalls.values()) if (s.kind === 'ready') URL.revokeObjectURL(s.url);
    this.smalls.clear();
    for (const e of this.entries.values()) {
      this.stopReading(e);
      if (e.letGo) clearTimeout(e.letGo);
    }
    this.entries.clear();
  }

  /** Stops reading it, and lets go of what was read. Whoever calls this says what it is now. */
  private stopReading(e: Entry): void {
    e.stop?.abort();
    e.stop = null;
    if (e.again) { clearTimeout(e.again); e.again = null; }
    if (e.state.kind === 'ready') URL.revokeObjectURL(e.state.url);
  }

  private drop(key: string, e: Entry): void {
    e.letGo = null;
    if (this.entries.get(key) !== e || e.holders > 0) return;
    this.stopReading(e);
    this.entries.delete(key);
  }

  private read(e: Entry): void {
    e.stop?.abort();
    const stop = new AbortController();
    e.stop = stop;
    if (e.state.kind !== 'loading') { e.state = LOADING; this.changed(); }
    const key = keyOf(e.documentId, e.media);
    const waiting = this.attaching.get(key);
    void (async () => {
      if (waiting) await waiting.catch(() => undefined);
      if (stop.signal.aborted) return;
      const url = await api.workspaces.media.picture(this.workspaceId, e.documentId, e.media, { pass: this.pass, signal: stop.signal });
      if (stop.signal.aborted || this.entries.get(key) !== e) { URL.revokeObjectURL(url); return; }
      e.stop = null;
      e.state = { kind: 'ready', url };
      this.changed();
    })().catch((err: unknown) => {
      if (stop.signal.aborted || this.entries.get(key) !== e) return;
      e.stop = null;
      if (errorCode(err) === 'not-found') {
        e.state = GONE;
        plog.info('a picture is gone', { workspaceId: this.workspaceId, documentId: e.documentId, mediaId: e.media });
      } else {
        e.state = FAILED;
        plog.warn('a picture didn’t load', { workspaceId: this.workspaceId, documentId: e.documentId, mediaId: e.media, err });
        e.again = setTimeout(() => { e.again = null; if (e.holders > 0 && this.entries.get(key) === e) this.read(e); }, AGAIN_MS);
      }
      this.changed();
    });
  }
}
