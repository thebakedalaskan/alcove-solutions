/*
 * What a document or board holds, and how browsers work on it together (docs: Data and storage › Documents). Its content
 * is a Yjs document: browsers send binary updates up with POST, and hear everyone's on an NDJSON stream. Everything here
 * is a shape on the wire or a store a screen reads; only the types come from Yjs, so nothing that imports the contract
 * loads it.
 */
import type { Awareness } from 'y-protocols/awareness';
import type { Doc } from 'yjs';
import { z } from './zod';
import type { LiveStore } from './live';
import { IDSchema, ISODateSchema } from './types';
import { DocumentRoleSchema, ItemAuthorSchema, ItemKindSchema, type DocumentRole, type WorkspaceReadOptions } from './workspaces';

/** The root of a document's Yjs state that holds the title and the blocks. */
export const DOC_FRAGMENT = 'content';
/** The root map of a document's comment threads. */
export const DOC_COMMENTS = 'comments';

/**
 * The Yjs clients only the API writes as, 1 to 15, which no browser ever does: `seed` writes every document's start and
 * `template` a board's template, and the rest are kept for what comes. What each writes depends on nothing but what it's for
 * (a template on its board and its name), so a client and its clocks say one thing in every log, version and browser, and the
 * API turns away anything a browser writes as one. A browser's are random 32-bit numbers outside these (`randomClient`).
 */
export const SERVER_CLIENT = { seed: 1, template: 2 } as const;
const LAST_SERVER_CLIENT = 15;
export const isServerClient = (client: number): boolean => client >= 1 && client <= LAST_SERVER_CLIENT;
/** A Yjs client for anyone but the server: random, as Yjs makes them, and never one of the server's. */
export function randomClient(): number {
  for (;;) {
    const [client = 0] = crypto.getRandomValues(new Uint32Array(1));
    if (!isServerClient(client)) return client;
  }
}

/**
 * The start of every document, the same bytes for everyone: its title and first line, written as `SERVER_CLIENT.seed`. A
 * document's title is the first element of its fragment, so two browsers each making their own would merge into two titles,
 * and a browser that can only read mustn't write. So the API writes these bytes when a document is made, and the first `sync`
 * always carries them. They merge into one, whoever applies them and however often. Each of the two has an empty text in it,
 * so whoever types there first types in the text that's there: two people each making one would sit side by side, and
 * y-prosemirror merges those by deleting one. They're fixed for good: every document holds them.
 */
export const DOC_SEED: Uint8Array = new Uint8Array([
  1, 5, 1, 0, 7, 1, 7, 99, 111, 110, 116, 101, 110, 116, 3, 5, 116, 105, 116, 108, 101, 7, 0, 1, 0, 6, 135, 1, 0, 3, 4, 108, 105, 110, 101, 7, 0, 1, 2, 6, 40, 0, 1, 2, 2, 105, 100, 1, 119, 5, 102, 105, 114, 115, 116, 0
]);

/** How big a document's state can grow: every reader is sent it whole when they open it. */
export const MAX_DOC_BYTES = 16 * 1024 * 1024;
/**
 * How many separate pieces what's on a document's page can be made of, which is what its memory follows: about 37,500 lines,
 * far past any meeting's notes. A line is about four pieces, and each run of words with its own formatting one more, which is
 * enough to work out whether a paste fits before it's made (`DocSession.size`). What a document keeps of what's left its page
 * doesn't count here, and has a ceiling of its own, at twice this, which is where its memory was measured.
 */
export const MAX_DOC_ITEMS = 150_000;
/** The most one update can be: whatever fits in a document can arrive in one go. A browser with more waiting sends it in several. */
export const MAX_DOC_UPDATE_BYTES = MAX_DOC_BYTES;
/** The most what's on one browser's cursor can be: it travels sealed in a Postgres notice, which is small. */
export const MAX_DOC_AWARENESS_BYTES = 4 * 1024;

const CHUNK = 0x8000;
/** Bytes as they go in JSON. Updates can be large, so they go through `btoa` a piece at a time. */
export function toBase64Url(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += CHUNK) s += String.fromCharCode(...b.subarray(i, i + CHUNK));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Url(s: string): Uint8Array {
  const text = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}
/** Bytes on the wire: base64url, of at most `max` bytes. */
const binary = (max: number) => z.string().regex(/^[A-Za-z0-9_-]*$/).max(Math.ceil((max * 4) / 3));

/* ---------- requests ---------- */

/** An update goes up as it is: a paste can be megabytes, and there's nothing to gain from encoding them. */
export const DOC_UPDATE_TYPE = 'application/octet-stream';
export const DocAwarenessBodySchema = z.object({ update: binary(MAX_DOC_AWARENESS_BYTES).min(1) });
/** Where an update landed in the document's log. */
export const DocAppendedSchema = z.object({ seq: z.number() });

/* ---------- live ---------- */

/**
 * Why a document's stream ended for good: you can't open it now, it's gone for everyone, your session or call ended, or it
 * can't be opened right now, by anyone, and has to be opened again to find out. History still reads, and can put it back.
 */
export const DocClosedSchema = z.enum(['access', 'deleted', 'session', 'unavailable']);
export type DocClosed = z.infer<typeof DocClosedSchema>;

/**
 * One line of a document's stream. `sync` comes first: what you don't have yet as one update, the seq it reaches, and what
 * you can do. Then `update`, in order, `awareness`, whenever someone's caret moves, with who they are added by the server
 * under `user` in its state, and `access`, when what you can do changes. `ping`: it's still there. `closed`: it ends and
 * stays ended. A stream that just ends is to be opened again, with `after` the last `seq` you had.
 */
export const DocLiveEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sync'), seq: z.number(), update: z.string(), role: DocumentRoleSchema, trashed: z.boolean() }),
  z.object({ type: z.literal('update'), seq: z.number(), update: z.string() }),
  z.object({ type: z.literal('awareness'), update: z.string() }),
  z.object({ type: z.literal('access'), role: DocumentRoleSchema, trashed: z.boolean() }),
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('closed'), why: DocClosedSchema })
]);
export type DocLiveEvent = z.infer<typeof DocLiveEventSchema>;

/**
 * Why what's typed here isn't reaching Alcove, though there's a connection: you can only read this, it's in Trash, or it's
 * too much, whether in one go or for the document, which counts its size and how many separate pieces are on its page. What
 * was typed stays here, and goes once that changes: undoing a paste, or deleting something, is enough. `rejected`: Alcove
 * won't take it as it stands, which no browser should see. Whatever doesn't depend on it still goes. A refusal never lets go
 * of anything: what's refused stays kept, through reloads, for someone to take out with `unsentCopy`.
 */
export type DocRefusal = 'read-only' | 'trashed' | 'too-large' | 'rejected';

export interface DocStatus {
  /**
   * `saved`: Alcove has everything typed here. `saving`: it's on its way. `offline`: no connection, and what's typed is kept
   * until there is one. `failed`: Alcove refused it, and `refused` says why.
   */
  status: 'saved' | 'saving' | 'offline' | 'failed';
  refused: DocRefusal | null;
  /** What you can do with it, once the first `sync` says. */
  role: DocumentRole | null;
  /** It's in Trash: readable, and nothing can change it until it's back. */
  trashed: boolean;
  /** Why it ended, if it has: nothing is sent or heard after this. */
  closed: DocClosed | null;
  /**
   * Something here hasn't reached Alcove. It stays kept until Alcove has it or someone chooses to let it go, whatever else
   * this says. With `refused` or `closed`, it may not get there by itself: that's when to offer `unsentCopy`.
   */
  unsent: boolean;
}

/** An edit this browser is keeping until Alcove has it, and when it was made, in ms since the epoch: nothing reads that yet. */
export interface KeptUpdate { key: number; update: Uint8Array; at: number }
/**
 * Where a session keeps what Alcove doesn't have yet, so edits made offline survive a reload and send on return. The app
 * backs it with IndexedDB, sealed under the device key. One store for one document in one account.
 */
export interface KeptUpdates {
  /** Everything kept, the oldest first. */
  load(): Promise<KeptUpdate[]>;
  /** Keeps an update, made at `at`. Resolves once it's kept, with what `remove` knows it by. */
  add(update: Uint8Array, at: number): Promise<number>;
  /** Forgets updates Alcove has now, or that someone chose to let go. A refusal never comes here. */
  remove(keys: number[]): Promise<void>;
}
export interface DocSessionOptions extends WorkspaceReadOptions { keep?: KeptUpdates | undefined }

/** What a copy held, to let go of with `discardUnsaved`: the document's state vector, and the keys of what was kept, as they stood. */
export interface DocCopyToken { readonly vector: Uint8Array; readonly keys: readonly number[] }
/**
 * Someone's own words that haven't reached Alcove, and nothing else, as plain paragraphs: for them to read, copy, or make a new
 * document of. `token`: for `discardUnsaved`, once they're saved.
 */
export interface DocUnsentCopy { text: string; token: DocCopyToken }
/** How much a document holds as it stands here, to set beside `MAX_DOC_BYTES` and `MAX_DOC_ITEMS`. `items`: what's on its page. */
export interface DocSize { bytes: number; items: number }

/**
 * A document being worked on: a `Y.Doc` kept in step with everyone else's, whatever the connection does. Whatever changes
 * `doc` here reaches Alcove and everyone in the document; `awareness` carries where the caret is. Read the status with
 * useLive(). It works the same in a browser and in Node.
 */
export interface DocSession extends LiveStore<DocStatus> {
  readonly doc: Doc;
  readonly awareness: Awareness;
  /** Resolves once the first `sync` is in: mount the editor then. Rejects if it can't be opened at all. */
  readonly ready: Promise<void>;
  /** Sends what's waiting, says this browser's caret is gone, and stops. */
  close(): void;
  /**
   * The words this browser wrote that Alcove hasn't taken, for someone whose words aren't reaching it: what's placed, in page
   * order, a paragraph to a line, then what Yjs has nowhere to put, in the order it was written. Never anything deleted, nor
   * anything anyone else wrote, so a new document made of it can't carry what someone can't open any more, or deleted. What's
   * being typed is cut off here, so all of it is in the copy. Works however the session ended, until `close()`.
   */
  unsentCopy(): DocUnsentCopy;
  /** What this document comes to here, for an editor to check a paste against the limits before it goes in. */
  size(): DocSize;
  /**
   * Lets go, here and in `keep`, of what a copy holds that can't reach this document (Alcove refused it, the session's over, or
   * this person can only read it now), and closes the session: for after `saveCopy`, or copying the words, by someone's choice. Anything written since the copy, anything that can still
   * go, and anything another tab keeps is untouched, and goes when the document's opened again.
   */
  discardUnsaved(token: DocCopyToken): Promise<void>;
}

/* ---------- versions ---------- */

/** Why a version was kept: someone came back to it after a while or had been editing for ten minutes, a call ended, or just before a restore. */
export const DocVersionReasonSchema = z.enum(['edits', 'call', 'restore']);
export type DocVersionReason = z.infer<typeof DocVersionReasonSchema>;
/** A document as it stood at one moment. */
export const DocVersionSummarySchema = z.object({
  id: IDSchema,
  at: ISODateSchema,
  /** Everyone who changed it since the version before. */
  by: z.array(ItemAuthorSchema),
  /** The call it was kept in, if it was: what History groups by. */
  callId: IDSchema.nullable(),
  reason: DocVersionReasonSchema
});
export type DocVersionSummary = z.infer<typeof DocVersionSummarySchema>;
/** A version on its way: what it is, then its parts in order, as a document can be big and a reader slow. */
export const DocVersionLineSchema = z.discriminatedUnion('type', [
  DocVersionSummarySchema.extend({ type: z.literal('version'), parts: z.number() }),
  z.object({ type: z.literal('part'), update: z.string() })
]);
/** A version with its whole state: a `Y.Doc` that applies `update` shows it. */
export interface DocVersion extends DocVersionSummary { update: Uint8Array }

/* ---------- presenter notes ---------- */

/** The longest someone's own notes on a document can be. */
export const MAX_PRESENTER_NOTES = 20_000;
/** What you keep beside a document for presenting it, for your eyes only. Empty when you have none. */
export const PresenterNotesSchema = z.object({ text: z.string() });
export type PresenterNotes = z.infer<typeof PresenterNotesSchema>;
export const PresenterNotesBodySchema = z.object({ text: z.string().max(MAX_PRESENTER_NOTES) });

/* ---------- asking Alcove about a selection ---------- */

/** The most of a document's words one question can carry. */
export const MAX_DOC_ASK = 8000;
/** The format bar's Make this shorter and Turn this into a checklist. */
export const DocAskActionSchema = z.enum(['shorter', 'checklist']);
export type DocAskAction = z.infer<typeof DocAskActionSchema>;
/** What's selected travels in the body, to the notes model and nowhere else: nothing of it is kept. */
export const DocAskBodySchema = z.object({ action: DocAskActionSchema, text: z.string().trim().min(1).max(MAX_DOC_ASK) });
export type DocAskBody = z.infer<typeof DocAskBodySchema>;
/** What comes back, in order: the words to put in the selection's place, or a to-do for each thing to do. */
export const DocAskPartSchema = z.discriminatedUnion('type', [z.object({ type: z.literal('text'), text: z.string() }), z.object({ type: z.literal('todo'), text: z.string() })]);
export type DocAskPart = z.infer<typeof DocAskPartSchema>;

/* ---------- search ---------- */

/** One block's words, for searching in the browser: `id` is what to land on. */
export const DocTextBlockSchema = z.object({ id: z.string(), type: z.string(), text: z.string() });
export type DocTextBlock = z.infer<typeof DocTextBlockSchema>;
/** One document a reader can open, as words. Nothing in Trash. */
export const SearchDocSchema = z.object({
  id: IDSchema, kind: ItemKindSchema,
  /** What the tree calls it. */
  name: z.string(),
  /** What it says at the top. */
  title: z.string(),
  blocks: z.array(DocTextBlockSchema)
});
export type SearchDoc = z.infer<typeof SearchDocSchema>;
