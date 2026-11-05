/*
 * What the server reads from a document and writes to one, by name. A document is only ever opened in a worker (live/docPool.ts),
 * because what's in it came from browsers and can take any amount of time or memory, and a closure can't cross into a worker.
 * So each thing the server does is here, as a plain function of the document and plain data: `docOp` gives it a name's worth of
 * schema, and `readDocument` and `writeDocument` (modules/workspaceDocuments.ts) call it by that name.
 *
 * To add one, add a line. It can use anything a worker can import, which is anything that doesn't need `Deps`: packages that
 * know what's in a board add their functions here the same way. Arguments and results cross between threads, so they're
 * plain data: bytes are fine, a `Y.Doc` isn't. To work with another document, pass its `state`.
 */
import { DOC_FRAGMENT, DocTextBlockSchema } from '@alcove/api';
import * as Y from 'yjs';
import { z } from 'zod';
import { documentText, documentTodos, holdsVideo, openTodos, readsAsAgenda, tickFollowUp, writeAgenda, type ContentKind, type Run } from './documentText';

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

/** What reading a document can ask of it. */
export const docReads = {
  /** What it says at the top and in each block. */
  text: docOp(OfKind, z.object({ title: z.string(), blocks: z.array(DocTextBlockSchema) }), (doc, a) => documentText(doc, a.kind)),
  /** Every todo in it, in order. */
  todos: docOp(OfKind, z.array(Todo), (doc, a) => documentTodos(doc, a.kind)),
  /** Whether it holds this video. */
  holdsVideo: docOp(z.object({ kind: Kind, media: z.string() }), z.boolean(), (doc, a) => holdsVideo(doc, a.kind, a.media)),
  /** What's left to do in it, for the next agenda to carry. */
  openTodos: docOp(OfKind, Runs, (doc, a) => openTodos(doc, a.kind)),
  /** Whether it's an agenda, going by what it says. */
  readsAsAgenda: docOp(OfKind, z.boolean(), (doc, a) => readsAsAgenda(doc, a.kind)),
  /** Everything, as one update. */
  state: docOp(z.object({}), z.custom<Uint8Array>((v) => v instanceof Uint8Array), (doc) => Y.encodeStateAsUpdate(doc))
};

/** Makes a document's title say `name`. */
function retitle(doc: Y.Doc, name: string): void {
  const title = doc.getXmlFragment(DOC_FRAGMENT).get(0);
  if (!(title instanceof Y.XmlElement) || title.nodeName !== 'title') return;
  const says = title.toArray().map((part) => (part instanceof Y.XmlText ? part.toString() : '')).join('');
  if (says === name) return;
  if (title.length) title.delete(0, title.length);
  const words = new Y.XmlText();
  title.insert(0, [words]);
  words.insert(0, name);
}

/** What the server can write to a document. */
export const docEdits = {
  retitle: docOp(z.object({ name: z.string() }), z.void(), (doc, a) => { retitle(doc, a.name); }),
  /** Ticks a follow-up, or takes the tick back. False when there's no such follow-up. */
  tickFollowUp: docOp(z.object({ kind: Kind, block: z.string(), done: z.boolean() }), z.boolean(), (doc, a) => tickFollowUp(doc, a.kind, a.block, a.done)),
  /** Fills in a new document as the next call's agenda. */
  writeAgenda: docOp(z.object({ title: z.string(), open: Runs }), z.void(), (doc, a) => { writeAgenda(doc, a.title, a.open); })
};
