/*
 * Comment threads. The words a thread hangs on carry a `comment` mark in the text; the thread itself is a Y.Map in the
 * root map `comments`, with its messages in a Y.Array. Resolving keeps the mark and the thread and only stops showing
 * them, so Reopen and History need nothing brought back. This works on a plain Y.Doc: the thread UI needs no editor.
 */
import * as Y from 'yjs';
import { newBlockId } from '@alcove/api/retire';
import { COMMENTS } from './names';

export interface ThreadMessage { id: string; by: string; name: string; text: string; at: string }
export interface Thread { id: string; quote: string; block: string; resolved: boolean; messages: ThreadMessage[] }

const threadsMap = (doc: Y.Doc): Y.Map<unknown> => doc.getMap<unknown>(COMMENTS);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A stored message, if it is one. Threads are written by other people's browsers. */
function messageOf(v: unknown): ThreadMessage | null {
  if (!isRecord(v)) return null;
  const id = text(v['id']);
  return id ? { id, by: text(v['by']), name: text(v['name']), text: text(v['text']), at: text(v['at']) } : null;
}

function threadOf(id: string, v: unknown): Thread | null {
  if (!(v instanceof Y.Map)) return null;
  const replies: unknown = v.get('replies');
  return {
    id,
    quote: text(v.get('quote')),
    block: text(v.get('block')),
    resolved: v.get('resolved') === true,
    messages: replies instanceof Y.Array ? replies.toArray().flatMap((m) => messageOf(m) ?? []) : []
  };
}

export function readThreads(doc: Y.Doc): Thread[] {
  const out: Thread[] = [];
  threadsMap(doc).forEach((v, id) => { const t = threadOf(id, v); if (t) out.push(t); });
  return out;
}

export function readThread(doc: Y.Doc, id: string): Thread | null {
  return threadOf(id, threadsMap(doc).get(id));
}

/** Runs `listener` whenever any thread or message changes. Returns how to stop. */
export function observeThreads(doc: Y.Doc, listener: () => void): () => void {
  const map = threadsMap(doc);
  map.observeDeep(listener);
  return () => map.unobserveDeep(listener);
}

const newMessage = (m: { by: string; name: string; text: string }): ThreadMessage => ({ id: newBlockId(), by: m.by, name: m.name, text: m.text, at: new Date().toISOString() });

/** Starts a thread. The caller marks the words with the same ID. */
export function startThread(doc: Y.Doc, id: string, thread: { quote: string; block: string }, first: { by: string; name: string; text: string }): void {
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    const replies = new Y.Array<ThreadMessage>();
    replies.push([newMessage(first)]);
    map.set('quote', thread.quote);
    map.set('block', thread.block);
    map.set('resolved', false);
    map.set('replies', replies);
    threadsMap(doc).set(id, map);
  });
}

export function addReply(doc: Y.Doc, id: string, reply: { by: string; name: string; text: string }): void {
  const thread = threadsMap(doc).get(id);
  const replies: unknown = thread instanceof Y.Map ? thread.get('replies') : null;
  if (replies instanceof Y.Array) replies.push([newMessage(reply)]);
}

/** Resolve, or Reopen with `false`. The mark goes or comes back for everyone. */
export function setResolved(doc: Y.Doc, id: string, resolved: boolean): void {
  const thread = threadsMap(doc).get(id);
  if (thread instanceof Y.Map) thread.set('resolved', resolved);
}
