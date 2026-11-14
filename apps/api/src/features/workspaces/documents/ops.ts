/*
 * What the server reads from a document and writes to one, by name. A document is only ever opened in a worker (live/doc-pool.ts),
 * because what's in it came from browsers and can take any amount of time or memory, and a closure can't cross into a worker.
 * So each thing the server does is here, as a plain function of the document and plain data: `docOp` gives it a name's worth of
 * schema, and `readDocument` and `writeDocument` (features/workspaces/documents/documents.ts) call it by that name.
 *
 * To add one, add a line. It can use anything a worker can import, which is anything that doesn't need `Deps`: packages that
 * know what's in a board add their functions here the same way. Arguments and results cross between threads, so they're
 * plain data: bytes are fine, a `Y.Doc` isn't. To work with another document, pass its `state`.
 */
import { DOC_FRAGMENT, DocTextBlockSchema, PreviewLineSchema, SERVER_CLIENT } from '@alcove/api';
import { TEMPLATES, boardFollowUps, boardText, fillTemplate, landBoards, roomFrames, readBoard, type BoardView, type TemplateName } from '@alcove/board';
import * as Y from 'yjs';
import { z } from 'zod';
import { documentPreview, documentText, documentTodos, followUpsIn, holdsVideo, openTodos, readsAsAgenda, tickFollowUp, writeAgenda, type ContentKind, type Run } from './text';

/** Something a worker can do to a document. `call` is `run` for arguments that came through a message. */
export interface DocOp<A, R> { args: z.ZodType<A>; result: z.ZodType<R>; call(doc: Y.Doc, args: unknown): unknown }
export const docOp = <A, R>(args: z.ZodType<A>, result: z.ZodType<R>, run: (doc: Y.Doc, args: A) => R): DocOp<A, R> => ({ args, result, call: (doc, raw) => run(doc, args.parse(raw)) });
export type ArgsOf<O> = O extends DocOp<infer A, infer _> ? A : never;
export type ResultOf<O> = O extends DocOp<infer _, infer R> ? R : never;
/** A registry as `readDocument` and `writeDocument` see it, so each name's arguments and result stay tied to it. */
export type OpTable<T> = { [K in keyof T]: DocOp<ArgsOf<T[K]>, ResultOf<T[K]>> };

const Kind: z.ZodType<ContentKind> = z.enum(['document', 'board']);
const OfKind = z.object({ kind: Kind });
const Person = z.object({ id: z.string(), name: z.string() });
const Todo = z.object({ block: z.string(), text: z.string(), done: z.boolean(), mentions: z.array(Person), dates: z.array(z.string()) });
const Runs: z.ZodType<Run[][]> = z.array(z.array(z.union([z.object({ text: z.string() }), z.object({ mention: Person }), z.object({ date: z.string() })])));

/** The most frames of a board the server reads for ideas from a call. */
const MAX_FRAMES_READ = 40;

/** What reading a document can ask of it. */
export const docReads = {
  /** What it says at the top and in each block. */
  text: docOp(OfKind, z.object({ title: z.string(), blocks: z.array(DocTextBlockSchema) }), (doc, a) => documentText(doc, a.kind)),
  /** Every todo in it, in order. */
  todos: docOp(OfKind, z.array(Todo), (doc, a) => documentTodos(doc, a.kind)),
  /** Its follow-ups as a call shows them, worked out here so nothing past the limits comes back. */
  followUps: docOp(z.object({ kind: Kind, max: z.number().int().min(0), chars: z.number().int().min(1), tags: z.number().int().min(0) }), z.array(Todo), (doc, a) => followUpsIn(doc, a.kind, a)),
  /** What its card shows: its first lines with words, the pictures and videos it holds, and its first file's ending. Nothing past the limits crosses back. */
  preview: docOp(
    z.object({ kind: Kind, lines: z.number().int().min(0), chars: z.number().int().min(1) }),
    z.object({ lines: z.array(PreviewLineSchema), pictures: z.number(), videos: z.number(), file: z.string().nullable() }),
    (doc, a) => documentPreview(doc, a.kind, a)
  ),
  /** Whether it holds this video. */
  holdsVideo: docOp(z.object({ kind: Kind, media: z.string() }), z.boolean(), (doc, a) => holdsVideo(doc, a.kind, a.media)),
  /** What's left to do in it, for the next agenda to carry. */
  openTodos: docOp(OfKind, Runs, (doc, a) => openTodos(doc, a.kind)),
  /** Whether it's an agenda, going by what it says. */
  readsAsAgenda: docOp(OfKind, z.boolean(), (doc, a) => readsAsAgenda(doc, a.kind)),
  /** Everything, as one update. */
  state: docOp(z.object({}), z.custom<Uint8Array>((v) => v instanceof Uint8Array), (doc) => Y.encodeStateAsUpdate(doc)),
  /** A board's frames by their titles, for ideas from a call to say which one each fits: nothing else of it, and none of a document. */
  frames: docOp(z.object({}), z.array(z.object({ id: z.string(), title: z.string() })), (doc) => readBoard(doc).frames.slice(0, MAX_FRAMES_READ).map((f) => ({ id: f.id, title: f.title.slice(0, 80) }))),
  /**
   * A board as the notes read it: its words, the first `chars` of them, and the stickies in its Actions frames, the first `max`,
   * each cut to `each`. Nothing past that crosses back from the worker.
   */
  boardNotes: docOp(
    z.object({ chars: z.number().int().min(1), max: z.number().int().min(0), each: z.number().int().min(1) }),
    z.object({ text: z.string(), followUps: z.array(z.object({ id: z.string(), text: z.string() })) }),
    (doc, a) => ({ text: boardText(doc).slice(0, a.chars), followUps: boardFollowUps(doc).slice(0, a.max).map((f) => ({ id: f.id, text: f.text.slice(0, a.each) })) })
  ),
  /** What a vote on a board can be on: whether `frame` is one of its frames, and whether `sticky` is a sticky the vote takes. */
  voteOn: docOp(z.object({ frame: z.string().nullable(), sticky: z.string().nullable() }), z.object({ frame: z.boolean(), sticky: z.boolean() }), (doc, a) => onView(readBoard(doc), a.frame, a.sticky)),
  /** Of `stickies`, the ones a vote on `frame` still takes: on the board, and inside the frame. */
  stillInVote: docOp(z.object({ frame: z.string().nullable(), stickies: z.array(z.string()) }), z.array(z.string()), (doc, a) => {
    const view = readBoard(doc);
    return a.stickies.filter((id) => onView(view, a.frame, id).sticky);
  })
};

/**
 * What a vote on a board can be on. A vote on a frame takes the stickies inside it however deep, since frames nest, and one with
 * no frame (`frame` null) every sticky on the board. Only what reads as a board does: what's in it came from browsers.
 */
function onView(view: BoardView, frame: string | null, sticky: string | null): { frame: boolean; sticky: boolean } {
  const framed = frame === null || view.byId.get(frame)?.k === 'frame';
  const o = sticky === null ? undefined : view.byId.get(sticky);
  if (!framed || o?.k !== 'note') return { frame: framed, sticky: false };
  // Up from the sticky through what holds it. A board reads with no loops in it, and this stops anyway once it's seen every frame.
  let at = o.f;
  for (let left = view.frames.length; frame !== null && at !== frame && at !== '' && left > 0; left -= 1) at = view.byId.get(at)?.f ?? '';
  return { frame: true, sticky: frame === null || at === frame };
}

/**
 * Makes a document's title say `name`. Its texts stay, emptied, like any text in a document: what lands in a deleted one is
 * lost on every browser, and someone may be typing in it.
 */
function retitle(doc: Y.Doc, name: string): void {
  const title = doc.getXmlFragment(DOC_FRAGMENT).get(0);
  if (!(title instanceof Y.XmlElement) || title.nodeName !== 'title') return;
  const texts = title.toArray().flatMap((part) => (part instanceof Y.XmlText ? [part] : []));
  if (texts.map(String).join('') === name) return;
  for (const text of texts) text.delete(0, text.length);
  const first = texts[0];
  if (first) first.insert(0, name);
  else {
    const words = new Y.XmlText();
    title.insert(0, [words]);
    words.insert(0, name);
  }
}

/**
 * Puts a template on an empty board, once. It's written as `SERVER_CLIENT.template`, the same client on every board and never
 * a browser's, so a board says itself whether it has had its template, and so does a copy of one. Its ids come from `seed`,
 * the board's id. Asking again finds the template's client in the board and changes nothing; so does the second of two asks
 * at the same moment, as `writeDocument` won't write as a client the log has had by then: it works that one out again, and finds
 * the first. That, not the bytes, is what makes it land once: two worked out at once can differ, and only one is written. A
 * board someone has put something on is left as it is, and a document isn't a board: `kind` is the tree's, as `writeDocument`
 * checks. Whether this put the template on: blank puts nothing.
 */
function boardTemplate(doc: Y.Doc, kind: ContentKind, template: TemplateName, seed: string): boolean {
  if (kind !== 'board' || Y.getState(doc.store, SERVER_CLIENT.template) > 0) return false;
  doc.clientID = SERVER_CLIENT.template;
  fillTemplate(doc, template, null, seed);
  return Y.getState(doc.store, SERVER_CLIENT.template) > 0;
}

/**
 * Lands each room's board on a board, as frames, from each one's whole state. Each frame's id comes from the board it came from,
 * so a board that's landed before is left as it is however often this is asked. A document isn't a board. How many landed.
 */
function land(doc: Y.Doc, kind: ContentKind, rooms: readonly { key: string; name: string; who: string[]; state: Uint8Array }[]): number {
  if (kind !== 'board') return 0;
  const docs = rooms.map((r) => { const d = new Y.Doc(); Y.applyUpdate(d, r.state); return { key: r.key, name: r.name, who: r.who, doc: d }; });
  try {
    return landBoards(doc, docs, null);
  } finally {
    for (const r of docs) r.doc.destroy();
  }
}

const Bytes = z.custom<Uint8Array>((v) => v instanceof Uint8Array);
const Room = z.object({ name: z.string(), who: z.array(z.string()) });

/** What the server can write to a document. */
export const docEdits = {
  retitle: docOp(z.object({ name: z.string() }), z.void(), (doc, a) => { retitle(doc, a.name); }),
  /** Ticks a follow-up, or takes the tick back. False when there's no such follow-up. */
  tickFollowUp: docOp(z.object({ kind: Kind, block: z.string(), done: z.boolean() }), z.boolean(), (doc, a) => tickFollowUp(doc, a.kind, a.block, a.done)),
  /** Fills in a new document as the next call's agenda. */
  writeAgenda: docOp(z.object({ title: z.string(), open: Runs }), z.void(), (doc, a) => { writeAgenda(doc, a.title, a.open); }),
  /** A board's template, from the server, so everyone gets the same frames and nobody's undo can take them away. `seed`: the board's id. */
  boardTemplate: docOp(z.object({ kind: Kind, template: z.enum(TEMPLATES), seed: z.string() }), z.boolean(), (doc, a) => boardTemplate(doc, a.kind, a.template, a.seed)),
  /** Rooms' boards coming back to the main board when rooms close: a frame for each, once. */
  boardLand: docOp(z.object({ kind: Kind, rooms: z.array(Room.extend({ key: z.string(), state: Bytes })) }), z.number(), (doc, a) => land(doc, a.kind, a.rooms)),
  /** An empty frame for each room on the one board every room shares, once. */
  roomFrames: docOp(z.object({ kind: Kind, rooms: z.array(Room.extend({ id: z.string() })) }), z.number(), (doc, a) => (a.kind === 'board' ? roomFrames(doc, a.rooms, null) : 0))
};
