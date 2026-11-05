/*
 * Comments: writing one on words someone selected, and a thread as it goes. It loads with the document, because threads live
 * in its Yjs state. Nobody who can only read gets anything to press: `comments.ts` can't check a role, so `canWrite` is the
 * only thing between a reader and writing, and every change here goes through it.
 */
import { firstName, type Person } from '@alcove/api';
import { WsCommentCompose, WsCommentThread, WsPopover, WsTagWords, wsToast, type AvatarPerson, type WsComment, type WsTagChoice, type WsTagging, type WsToastData } from '@alcove/ui';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Doc } from 'yjs';
import { addReply, observeThreads, readThread, setResolved, type MessageTag, type Thread, type ThreadMessage } from './editor/comments';
import type { CommentDraft, MentionSection, Rect } from './editor/types';

/** What's open: a comment being written, or a thread. */
export type CommentOpen = { kind: 'draft'; draft: CommentDraft } | { kind: 'thread'; id: string; rect: Rect };

export interface CommentsProps {
  doc: Doc;
  open: CommentOpen;
  onOpen: (open: CommentOpen | null) => void;
  /** You, as a thread names you. */
  self: Person | null;
  /** Who a thread may name, for faces. */
  people: ReadonlyMap<string, Person>;
  canWrite: boolean;
  /** Put away while a tag's question is on screen, so there's only ever one thing open. */
  hidden: boolean;
  sections: (query: string, options: { docsOnly: boolean }) => MentionSection[];
  onTagged: (person: Person, block: string, rect: () => DOMRect) => void;
  say: (toast: WsToastData) => void;
}

const rectOf = (r: Rect) => new DOMRect(r.left, r.top, r.width, r.height);
/** The words a thread hangs on, wherever they are now. */
const wordsOf = (id: string): Element | null => document.querySelector(`.wc[data-c="${CSS.escape(id)}"]`);

function useThread(doc: Doc, id: string): Thread | null {
  const cached = useRef<{ key: string; thread: Thread | null }>({ key: '', thread: null });
  const subscribe = useCallback((changed: () => void) => observeThreads(doc, changed), [doc]);
  const read = useCallback(() => {
    const thread = readThread(doc, id);
    const key = JSON.stringify(thread);
    if (cached.current.key !== key) cached.current = { key, thread };
    return cached.current.thread;
  }, [doc, id]);
  return useSyncExternalStore(subscribe, read, read);
}

/** What `@` offers in a comment: people and dates. A comment is plain words read by everyone, so it can't name a document only some can open. */
function useTagging(sections: CommentsProps['sections']) {
  const picked = useRef(new Map<string, Person>());
  const tagging = useMemo<WsTagging>(() => ({
    sections: (query) => sections(query, { docsOnly: false }).flatMap((s) => {
      const choices = s.items.flatMap((i): WsTagChoice[] => {
        if (i.kind === 'person') return [{ key: `p:${i.person.id}`, label: i.person.name, person: i.person, sub: i.sub, words: firstName(i.person.name) }];
        return i.kind === 'date' ? [{ key: `t:${i.date}`, label: i.label, icon: 'cal', words: i.label }] : [];
      });
      return choices.length ? [{ title: s.title, choices }] : [];
    }),
    onPick: (c) => { if (c.person) picked.current.set(c.key, { id: c.key.slice(2), name: c.person.name, email: c.person.email ?? '' }); }
  }), [sections]);
  /** Who's still in the words, for what's about to be sent, and it starts over. */
  const take = (text: string): Person[] => {
    const named = [...picked.current.values()].filter((p) => text.includes(`@${firstName(p.name)}`));
    picked.current.clear();
    return named;
  };
  return { tagging, take };
}

/** A message's words, with the people it tags marked. */
function wordsWith(text: string, tags: readonly MessageTag[]): ReactNode {
  if (tags.length === 0) return text;
  const names = tags.map((t) => `@${firstName(t.name)}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text.split(new RegExp(`(${names.join('|')})`)).map((part, i) => (i % 2 === 1 ? <WsTagWords key={i}>{part}</WsTagWords> : <Fragment key={i}>{part}</Fragment>));
}

const tagsOf = (people: readonly Person[]): MessageTag[] => people.map((p) => ({ id: p.id, name: p.name }));

function Compose({ draft, self, sections, onOpen, onTagged, onDraft }: { draft: CommentDraft; self: Person; sections: CommentsProps['sections']; onOpen: CommentsProps['onOpen']; onTagged: CommentsProps['onTagged']; onDraft: (text: string) => void }) {
  const [text, setText] = useState('');
  const { tagging, take } = useTagging(sections);
  const send = () => {
    const words = text.trim();
    if (!words) return;
    const named = take(words);
    const id = draft.send({ by: self.id, name: self.name, text: words, tags: tagsOf(named) });
    onOpen({ kind: 'thread', id, rect: draft.rect });
    for (const p of named) onTagged(p, draft.block, () => wordsOf(id)?.getBoundingClientRect() ?? rectOf(draft.rect));
  };
  return <WsCommentCompose quote={draft.quote} person={self} value={text} onChange={(v) => { setText(v); onDraft(v); }} onSend={send} tagging={tagging} />;
}

function ThreadView({ doc, id, thread, self, people, canWrite, sections, onOpen, onTagged, say }: { thread: Thread; id: string } & Pick<CommentsProps, 'doc' | 'self' | 'people' | 'canWrite' | 'sections' | 'onOpen' | 'onTagged' | 'say'>) {
  const [text, setText] = useState('');
  const { tagging, take } = useTagging(sections);
  const face = (m: ThreadMessage): AvatarPerson => people.get(m.by) ?? { name: m.name };
  const messages = thread.messages.map((m): WsComment => ({ id: m.id, person: face(m), name: firstName(m.name), text: wordsWith(m.text, m.tags) }));
  const send = () => {
    const words = text.trim();
    if (!words || !self || !canWrite) return;
    const named = take(words);
    addReply(doc, id, { by: self.id, name: self.name, text: words, tags: tagsOf(named) });
    setText('');
    for (const p of named) onTagged(p, thread.block, () => wordsOf(id)?.getBoundingClientRect() ?? new DOMRect());
  };
  const resolve = () => {
    if (!canWrite) return;
    setResolved(doc, id, true);
    onOpen(null);
    say(wsToast.resolved(() => setResolved(doc, id, false)));
  };
  return canWrite
    ? <WsCommentThread quote={thread.quote} messages={messages} value={text} onChange={setText} onSend={send} onResolve={resolve} tagging={tagging} />
    : <WsCommentThread quote={thread.quote} messages={messages} />;
}

function ThreadPopover(props: CommentsProps & { id: string; rect: Rect }) {
  const { doc, id, rect, onOpen, hidden } = props;
  const thread = useThread(doc, id);
  const at = useCallback(() => wordsOf(id)?.getBoundingClientRect() ?? rectOf(rect), [id, rect]);
  /* Resolved by someone else as you read it: the words aren't marked any more, so there's nothing to hang on. */
  useEffect(() => { if (thread?.resolved) onOpen(null); }, [thread?.resolved, onOpen]);
  if (!thread) return null;
  return (
    <WsPopover open={!hidden} onOpenChange={(to) => { if (!to) onOpen(null); }} at={at} label={`Comments on ${thread.quote}`}>
      <ThreadView {...props} thread={thread} />
    </WsPopover>
  );
}

function DraftPopover({ open, onOpen, self, sections, onTagged, hidden }: CommentsProps & { open: Extract<CommentOpen, { kind: 'draft' }> }) {
  const { draft } = open;
  const at = useCallback(() => document.querySelector('.fs')?.getBoundingClientRect() ?? rectOf(draft.rect), [draft.rect]);
  const typed = useRef('');
  if (!self) return null;
  return (
    <WsPopover open={!hidden} at={at} label={`Comment on ${draft.quote}`} onOpenChange={(to) => { if (!to) { draft.cancel(); onOpen(null); } }}>
      <Compose draft={draft} self={self} sections={sections} onOpen={onOpen} onTagged={onTagged} onDraft={(t) => { typed.current = t; }} />
    </WsPopover>
  );
}

export default function Comments(props: CommentsProps) {
  const { open } = props;
  return open.kind === 'draft' ? <DraftPopover {...props} open={open} /> : <ThreadPopover key={open.id} {...props} id={open.id} rect={open.rect} />;
}
