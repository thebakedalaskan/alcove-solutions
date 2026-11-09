/**
 * One conversation, the room's or a private one: its messages in runs under one name, a thread open in its place, and its
 * composer. Navigation and drafts are local; encrypted messages and reads come from the session's LiveStores.
 */
import { errorMessage, type CallChatMention, type CallChatMessage, type CallChatThread, type CallReaction, type Person } from '@alcove/api';
import { Button, ChatDivider, ChatMessage, ChatThreadHead, ChatThreadLine, EmptyState, Icon, Notice, useToast, type ChatThreadSummary, type ReactionShown } from '@alcove/ui';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { callName } from '~/lib/people';
import { ChatComposer, MentionText, useReadMentions, type ChatDraft, type MentionPerson } from './ChatMentions';
import { type ReplyJump } from '../session/replyAlerts';
import { useReadChatMessages } from './chatRead';

/** How far apart two messages from the same person can be and still sit under one name, in seconds. */
const RUN_SECONDS = 5 * 60;

/** A message in the conversation itself, not only in a thread: an original, or a reply also sent to everyone. */
export const inConversation = (m: Pick<CallChatMessage, 'thread' | 'broadcast'>): boolean => m.thread === null || m.broadcast;

export function ChatView({ chat, missed, ready, moving, place, here, placeName, who, me, draft, mentionPeople, unreadMentionIds = [], readIds, onRead, onSend, onRetry, onReact, onPrivate, visible = true, privateWith, delivery, jump, readable, when }: {
  chat: CallChatMessage[]; missed: boolean; ready: boolean; moving: boolean; place: string;
  /** The room you're in while rooms are open: Everyone is the people in it. */
  here: string | null;
  placeName: (place: string) => string; who: (id: string) => Person; me: string; draft: ChatDraft; mentionPeople: readonly MentionPerson[];
  unreadMentionIds?: readonly string[] | undefined; readIds: readonly string[]; onRead: (ids: readonly string[]) => void;
  /** `broadcast`: a thread's reply goes to the conversation as well. */
  onSend: (text: string, mentions: readonly CallChatMention[], thread: CallChatThread | null, broadcast: boolean) => Promise<void>;
  onRetry: (messageId: string) => Promise<void>; onReact?: ((messageId: string, reaction: CallReaction, on: boolean) => Promise<void>) | undefined;
  /** Opening a private conversation with whoever sent a message, when they can be messaged privately now. */
  onPrivate?: ((identity: string) => (() => void) | undefined) | undefined;
  readable?: boolean | undefined; jump?: ReplyJump | undefined; visible?: boolean | undefined; privateWith?: string | undefined; delivery?: ((id: string) => string) | undefined;
  /** A message's time of day, from when in the call it was sent. */
  when: (at: number) => string;
}) {
  const toast = useToast();
  const [thread, setThread] = useState(draft.threadRoot ?? null);
  const [threadPlace, setThreadPlace] = useState(draft.threadPlace ?? place);
  const [composerFocus, setComposerFocus] = useState(0);
  const [, redraw] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const findMessage = (id: string) => scroll.current?.querySelector<HTMLElement>(`[data-chat-message="${CSS.escape(id)}"]`);
  const bottom = useRef(true);
  const focus = useRef<string | null>(null);
  const read = useMemo(() => new Set(readIds), [readIds]);
  const mentioned = useMemo(() => new Set(unreadMentionIds), [unreadMentionIds]);
  const byMessage = useMemo(() => new Map(chat.map((m) => [`${m.place}:${m.id}`, m])), [chat]);
  const rootIds = useMemo(() => new Set(chat.filter((m) => m.thread === null).map((m) => `${m.place}:${m.id}`)), [chat]);
  // The conversation: originals, and replies that were sent to everyone too, in the order they came.
  const main = useMemo(() => chat.filter(inConversation), [chat]);
  const grouped = useMemo(() => {
    const groups = new Map<string, CallChatMessage[]>();
    for (const message of chat) if (message.thread) {
      const rows = groups.get(`${message.place}:${message.thread.root}`) ?? [];
      rows.push(message);
      groups.set(`${message.place}:${message.thread.root}`, rows);
    }
    return groups;
  }, [chat]);
  const root = thread ? byMessage.get(`${threadPlace}:${thread}`) : null;
  const original = root?.thread === null ? root : null;
  const replies = thread ? grouped.get(`${threadPlace}:${thread}`) ?? [] : [];
  const context = original ?? replies[0] ?? null;
  const missing = [...grouped.entries()].flatMap(([key, rows]) => {
    const first = rows[0];
    return first?.thread && !rootIds.has(`${first.place}:${first.thread.root}`) ? [{ key, first, rows }] : [];
  });
  const activeDraft = useMemo(() => {
    if (!thread) return draft;
    draft.threads ??= new Map();
    const existing = draft.threads.get(thread);
    if (existing) return existing;
    const created: ChatDraft = { text: '' };
    draft.threads.set(thread, created);
    return created;
  }, [draft, thread]);
  const historyReady = readable ?? ready;
  const displayed = thread ? (original ? [original, ...replies] : replies) : main;
  // Retained history can be read after a peer leaves even though it no longer generates mention attention.
  const visibleMentions = visible && historyReady ? displayed.filter((m) => !m.isMe && !m.sending && !m.failed && !read.has(m.id)
    && m.mentions.some((mention) => mention.identity === me)).map((m) => m.id) : [];
  useReadMentions(scroll, visibleMentions, onRead);
  const visibleUnread = displayed.filter((m) => visible && historyReady && !m.isMe && !m.sending && !m.failed && !read.has(m.id)
    && !m.mentions.some((mention) => mention.identity === me)).map((m) => m.id);
  useReadChatMessages(scroll, visibleUnread, onRead);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    node.scrollTop = activeDraft.scrollTop ?? node.scrollHeight;
    bottom.current = node.scrollHeight - node.clientHeight - node.scrollTop < 80;
  }, [activeDraft]);
  useEffect(() => {
    const node = scroll.current;
    if (node && bottom.current) node.scrollTop = node.scrollHeight;
    const id = focus.current;
    if (id) {
      const message = findMessage(id);
      if (message) { message.scrollIntoView({ block: 'center' }); message.focus({ preventScroll: true }); focus.current = null; }
    }
  }, [displayed.length, thread]);

  const choose = (to: string | null, originalPlace = place) => {
    if (scroll.current) activeDraft.scrollTop = scroll.current.scrollTop;
    draft.threadRoot = to; draft.threadPlace = originalPlace; setThreadPlace(originalPlace);
    setThread(to);
  };
  useEffect(() => {
    if (!jump) return;
    const message = chat.find((m) => m.id === jump.id);
    if (!message) return;
    focus.current = message.id;
    choose(message.thread?.root ?? null, message.place);
    requestAnimationFrame(() => {
      const node = findMessage(message.id);
      node?.scrollIntoView({ block: 'center' }); node?.focus({ preventScroll: true });
    });
  }, [jump?.request]);
  const back = () => {
    const was = thread;
    setComposerFocus(0); choose(null);
    requestAnimationFrame(() => { if (was) scroll.current?.querySelector<HTMLElement>(`#${CSS.escape(`thread-open-${was}`)}`)?.focus(); });
  };
  const unreadIn = (messages: readonly CallChatMessage[]) => messages.filter((m) => !m.isMe && !m.sending && !m.failed && !read.has(m.id));
  const openThread = (rootId: string, at: string, rows: readonly CallChatMessage[], from: string) => {
    focus.current = unreadIn(rows)[0]?.id ?? from;
    choose(rootId, at);
  };
  const openMention = () => {
    const target = chat.find((m) => mentioned.has(m.id));
    if (!target) return;
    focus.current = target.id;
    choose(target.thread?.root ?? null, target.place);
    requestAnimationFrame(() => {
      const message = findMessage(target.id);
      (message?.querySelector('.ic-mention.is-me') ?? message)?.scrollIntoView({ block: 'center' });
      message?.focus({ preventScroll: true });
    });
  };
  const react = (id: string) => (reaction: CallReaction, on: boolean) => { void onReact?.(id, reaction, on).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' })); };
  const retry = (id: string) => { void onRetry(id).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' })); };
  /** A thread's line under its original: its replies, the last one's time, who replied and what's new. */
  const summary = (rows: readonly CallChatMessage[], onOpen: () => void): ChatThreadSummary => {
    const repliers = [...new Set(rows.map((m) => m.from))].map((id) => who(id));
    return { count: rows.length, last: when(rows.at(-1)?.at ?? 0), people: repliers, fresh: unreadIn(rows).length, onOpen };
  };
  const row = (message: CallChatMessage, first: boolean) => {
    const from = who(message.from);
    const name = message.from === me ? `${callName(from)} (you)` : callName(from);
    const reactions: ReactionShown[] = message.reactions.map((r) => ({ name: r.reaction, names: r.by.map((id) => id === me ? 'You' : callName(who(id))), mine: r.by.includes(me) }));
    const canAct = ready && !message.sending && !message.failed && message.place === place;
    const nested = !thread && message.thread === null ? grouped.get(`${message.place}:${message.id}`) ?? [] : [];
    const rootOf = message.thread ? byMessage.get(`${message.place}:${message.thread.root}`) : undefined;
    // A reply sent to everyone too says what it answered, and opens its thread.
    const said = !thread && message.thread && message.broadcast ? (
      <button type="button" className="ch-from" onClick={() => { if (message.thread) openThread(message.thread.root, message.place, grouped.get(`${message.place}:${message.thread.root}`) ?? [], message.id); }}>
        <Icon name="thread" size={13} /><span className="ac-clamp-1">{rootOf ? `Replied to ${callName(who(rootOf.from))}: ${rootOf.text}` : 'Replied in a thread'}</span>
      </button>
    ) : undefined;
    return <ChatMessage key={message.id} id={message.id} person={from} name={name} time={message.sending ? 'Now' : when(message.at)} first={first} context={said}
      text={<MentionText text={message.text} mentions={message.mentions} me={me} who={who} />}
      unreadMention={mentioned.has(message.id)} sending={message.sending}
      failed={message.failed ? { onRetry: () => retry(message.id), canRetry: ready && message.place === place, label: privateWith ? 'Retry privately' : 'Retry' } : undefined}
      delivery={message.isMe ? delivery?.(message.id) : undefined} reactions={reactions}
      actions={{
        onReact: canAct && onReact ? react(message.id) : undefined,
        onReply: canAct ? () => { focus.current = null; setComposerFocus((n) => n + 1); if (!thread) choose(message.thread?.root ?? message.id, message.place); } : undefined,
        onPrivate: !privateWith && message.from !== me ? onPrivate?.(message.from) : undefined
      }}
      thread={nested.length ? summary(nested, () => openThread(message.id, message.place, nested, message.id)) : null} />;
  };
  /** Messages in runs: a run from one person, close together, sits under one name. */
  const runs = (list: readonly CallChatMessage[], breaks: (i: number) => boolean = () => false) => list.map((m, i) => {
    const prev = list[i - 1];
    const first = !prev || breaks(i) || prev.from !== m.from || prev.place !== m.place || m.at - prev.at > RUN_SECONDS || prev.failed || (!thread && m.broadcast);
    return { message: m, first };
  });
  const marked = new Set(main.map((m) => m.place)).size > 1;
  const sameRoom = context?.place === place;
  const canSend = ready && (!thread || sameRoom);
  const people = new Set((original ? [original, ...replies] : replies).map((m) => m.from)).size;
  const audience = (at: string) => (at === place ? here ?? 'Everyone' : placeName(at));
  const threadSub = privateWith ? `Only you and ${privateWith}` : context ? `In ${audience(context.place)} · ${people} ${people === 1 ? 'person' : 'people'}` : 'Original message unavailable';
  const everyone = here ? `everyone in ${here}` : 'everyone';
  const send = (text: string, mentions: readonly CallChatMention[] = []) => {
    if (!thread) return onSend(text, mentions, null, false);
    // A thread is flat: a reply answers its original, or its latest readable reply when the original isn't readable here.
    const target = original?.id ?? [...replies].reverse().find((m) => !m.sending && !m.failed)?.id ?? thread;
    const all = !privateWith && (activeDraft.broadcast ?? false);
    activeDraft.broadcast = false; redraw((n) => n + 1);
    return onSend(text, mentions, { root: thread, replyTo: target }, all).catch((e: unknown) => { activeDraft.broadcast = all; redraw((n) => n + 1); throw e; });
  };
  const composer = (
    <ChatComposer key={thread ?? 'conversation'} draft={activeDraft} people={mentionPeople} ready={canSend} moving={moving} focusRequest={composerFocus} privateWith={privateWith}
      disabledReason={privateWith && !ready ? 'This conversation is unavailable' : thread && !sameRoom ? 'Return to this conversation’s room to reply' : undefined}
      placeholder={thread ? 'Reply…' : privateWith ? `Message ${privateWith}` : `Message ${everyone}`}
      label={thread ? (privateWith ? `Reply only to ${privateWith}` : 'Reply in this thread') : privateWith ? `Message only ${privateWith}` : `Message ${everyone}`}
      sendLabel={thread ? (privateWith ? `Send only to ${privateWith}` : 'Send reply') : privateWith ? `Send only to ${privateWith}` : `Send to ${everyone}`}
      also={thread && !privateWith && sameRoom ? { label: `Also send to ${here ?? 'Everyone'}`, checked: activeDraft.broadcast ?? false, onChange: (on) => { activeDraft.broadcast = on; redraw((n) => n + 1); } } : undefined}
      onSend={send} />
  );
  const keepScroll = () => {
    const node = scroll.current;
    if (node) { activeDraft.scrollTop = node.scrollTop; bottom.current = node.scrollHeight - node.clientHeight - node.scrollTop < 80; }
  };
  if (thread) return (
    <>
      <ChatThreadHead sub={threadSub} onBack={back} />
      <div ref={scroll} className="ch-scroll" role="log" aria-label={privateWith ? `Thread with ${privateWith}` : 'Thread replies'} aria-live="polite" aria-relevant="additions" onScroll={keepScroll}>
        {original ? <div className="ch-list">{row(original, true)}</div>
          : <Notice icon="lock">The original message isn’t available to you. Only replies you can read are shown.</Notice>}
        {replies.length ? (
          <div className="ch-list is-replies">
            <ChatDivider>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</ChatDivider>
            {runs(replies, (i) => i === 0).map(({ message, first }) => row(message, first))}
          </div>
        ) : <p className="ch-quiet">No replies yet.</p>}
      </div>
      {!sameRoom && <Notice icon="lock">Return to this conversation’s room to reply.</Notice>}
      {composer}
    </>
  );
  const placeBreak = (i: number) => marked && main[i - 1]?.place !== main[i]?.place;
  return (
    <>
      {!!unreadMentionIds.length && <div className="ch-unread" role="status"><Icon name="at" size={15} /><span>{unreadMentionIds.length} unread {unreadMentionIds.length === 1 ? 'mention' : 'mentions'}</span><Button variant="quiet" size="xs" onClick={openMention}>Open mention</Button></div>}
      <div ref={scroll} className="ch-scroll" role="log" aria-label={privateWith ? `Private conversation with ${privateWith}` : 'Room chat'} aria-live="polite" aria-relevant="additions" onScroll={keepScroll}>
        {missed && <Notice icon="lock">Messages sent here before you came aren’t shown. Only people who were here then can read them.</Notice>}
        {missing.map(({ key, first, rows }) => (
          <div className="ch-list" key={key}>
            <Notice icon="lock">The original message isn’t available to you.</Notice>
            <ChatThreadLine id={first.thread?.root ?? first.id} {...summary(rows, () => { if (first.thread) openThread(first.thread.root, first.place, rows, first.id); })} />
          </div>
        ))}
        {main.length ? (
          <div className="ch-list">
            {runs(main, placeBreak).map(({ message, first }, i) => <Fragment key={message.id}>
              {placeBreak(i) && <ChatDivider>In {placeName(message.place)}</ChatDivider>}
              {row(message, first)}
            </Fragment>)}
          </div>
        ) : !missing.length && (
          <EmptyState title="No messages yet" className="ch-empty">
            {privateWith ? `Only you and ${privateWith} can read this conversation. It ends with the call, and stays out of the recording and notes.`
              : here ? `Messages are encrypted end to end. Only people in ${here} can read them.` : 'Messages are encrypted end to end. Only people in the call can read them.'}
          </EmptyState>
        )}
      </div>
      {composer}
    </>
  );
}
