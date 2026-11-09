/** Conversation navigation and drafts are local; encrypted messages and reads come from the session's LiveStores. */
import { errorMessage, type CallChatMention, type CallChatMessage, type CallChatThread, type CallReaction, type Person } from '@alcove/api';
import { Button, CallChatMessageView, EmptyState, Icon, IconButton, Notice, useToast, type ReactionShown } from '@alcove/ui';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { callName } from '~/lib/people';
import { ChatComposer, MentionText, useReadMentions, type ChatDraft, type MentionPerson } from './ChatMentions';
import { type ReplyJump } from '../session/replyAlerts';
import { useReadChatMessages } from './chatRead';

export function ChatView({ chat, missed, ready, moving, place, here, placeName, who, me, draft, mentionPeople, unreadMentionIds = [], readIds, onRead, onSend, onRetry, onReact, visible = true, privateWith, delivery, jump }: {
  chat: CallChatMessage[]; missed: boolean; ready: boolean; moving: boolean; place: string; here: string | null;
  placeName: (place: string) => string; who: (id: string) => Person; me: string; draft: ChatDraft; mentionPeople: readonly MentionPerson[];
  unreadMentionIds?: readonly string[] | undefined; readIds: readonly string[]; onRead: (ids: readonly string[]) => void;
  onSend: (text: string, mentions?: readonly CallChatMention[], thread?: CallChatThread | null) => Promise<void>;
  onRetry: (messageId: string) => Promise<void>; onReact?: ((messageId: string, reaction: CallReaction, on: boolean) => Promise<void>) | undefined;
  jump?: ReplyJump | undefined; visible?: boolean | undefined; privateWith?: string | undefined; delivery?: ((id: string) => string) | undefined;
}) {
  const toast = useToast();
  const [thread, setThread] = useState(draft.threadRoot ?? null);
  const [threadPlace, setThreadPlace] = useState(draft.threadPlace ?? place);
  const [replyTo, setReplyTo] = useState(draft.replyTo ?? null);
  const [composerFocus, setComposerFocus] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const bottom = useRef(true);
  const focus = useRef<string | null>(null);
  const read = useMemo(() => new Set(readIds), [readIds]);
  const grouped = useMemo(() => {
    const groups = new Map<string, CallChatMessage[]>();
    for (const message of chat) if (message.thread) {
      const rows = groups.get(`${message.place}:${message.thread.root}`) ?? [];
      rows.push(message);
      groups.set(`${message.place}:${message.thread.root}`, rows);
    }
    return groups;
  }, [chat]);
  const original = thread ? chat.find((m) => m.id === thread && m.place === threadPlace && m.thread === null) : null;
  const replies = thread ? grouped.get(`${threadPlace}:${thread}`) ?? [] : [];
  const context = original ?? replies[0] ?? null;
  const roots = chat.filter((m) => m.thread === null);
  const missing = [...grouped.entries()].flatMap(([key, rows]) => {
    const first = rows[0];
    return first?.thread && !roots.some((m) => m.id === first.thread?.root && m.place === first.place)
      ? [{ key, first, rows }] : [];
  });
  const shown = thread ? replies : roots;
  const activeDraft = useMemo(() => {
    if (!thread) return draft;
    draft.threads ??= new Map();
    const existing = draft.threads.get(thread);
    if (existing) return existing;
    const created: ChatDraft = { text: '' };
    draft.threads.set(thread, created);
    return created;
  }, [draft, thread]);
  const displayed = original ? [original, ...shown] : shown;
  const displayedIds = new Set(displayed.map((m) => m.id));
  const visibleMentions = visible && ready ? unreadMentionIds.filter((id) => displayedIds.has(id)) : [];
  useReadMentions(scroll, visibleMentions, onRead);
  const visibleUnread = displayed.filter((m) => visible && ready && !m.isMe && !m.sending && !m.failed && !read.has(m.id)
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
      const message = document.getElementById(`chat-message-${id}`);
      if (message) { message.scrollIntoView({ block: 'center' }); message.focus({ preventScroll: true }); focus.current = null; }
    }
  }, [shown.length, thread]);

  const choose = (root: string | null, target: string | null = root, originalPlace = place) => {
    if (scroll.current) activeDraft.scrollTop = scroll.current.scrollTop;
    draft.threadRoot = root; draft.replyTo = target; draft.threadPlace = originalPlace; setThreadPlace(originalPlace);
    setThread(root); setReplyTo(target);
  };
  useEffect(() => {
    if (!jump) return;
    const message = chat.find((m) => m.id === jump.id);
    if (!message) return;
    focus.current = message.id;
    choose(message.thread?.root ?? null, message.thread?.root ?? null, message.place);
    requestAnimationFrame(() => {
      const node = document.getElementById(`chat-message-${message.id}`);
      node?.scrollIntoView({ block: 'center' }); node?.focus({ preventScroll: true });
    });
  }, [jump?.request]);
  const back = () => {
    const root = thread;
    setComposerFocus(0); choose(null);
    requestAnimationFrame(() => { if (root) (document.getElementById(`thread-open-${root}`) ?? document.getElementById(`thread-reply-${root}`))?.focus(); });
  };
  const unreadIn = (messages: readonly CallChatMessage[]) => messages.filter((m) => !m.isMe && !m.sending && !m.failed && !read.has(m.id));
  const openMention = () => {
    const target = chat.find((m) => unreadMentionIds.includes(m.id));
    if (!target) return;
    focus.current = target.id;
    choose(target.thread?.root ?? null, target.thread?.root ?? null, target.place);
    requestAnimationFrame(() => {
      const message = document.getElementById(`chat-message-${target.id}`);
      (message?.querySelector('.ic-mention.is-me') ?? message)?.scrollIntoView({ block: 'center' });
      message?.focus({ preventScroll: true });
    });
  };
  const react = (id: string) => (reaction: CallReaction, on: boolean) => { void onReact?.(id, reaction, on).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' })); };
  const retry = (id: string) => { void onRetry(id).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' })); };
  const row = (message: CallChatMessage) => {
    const from = who(message.from);
    const reactions: ReactionShown[] = message.reactions.map((r) => ({ name: r.reaction, names: r.by.map((id) => id === me ? 'You' : callName(who(id))), mine: r.by.includes(me) }));
    const canAct = ready && !message.sending && !message.failed && message.place === place;
    const nested = grouped.get(`${message.place}:${message.id}`) ?? [];
    const fresh = unreadIn(nested);
    const parent = message.thread && message.thread.replyTo !== message.thread.root ? chat.find((m) => m.id === message.thread?.replyTo && m.place === message.place) : null;
    return <CallChatMessageView key={message.id} message={message} person={from} name={callName(from)}
      unreadMention={unreadMentionIds.includes(message.id)} canReply={canAct} canRetry={ready && message.place === place} canReact={canAct && Boolean(onReact)} reactions={reactions}
      parent={parent ? { name: callName(who(parent.from)), text: parent.text } : undefined} me={me}
      threadSelected={thread !== null} replyCount={nested.length} unreadReplies={fresh.length}
      delivery={message.isMe ? delivery?.(message.id) : undefined} privateMessage={Boolean(privateWith)}
      onRetry={() => retry(message.id)} onReply={() => { focus.current = null; setComposerFocus((n) => n + 1); choose(message.thread?.root ?? message.id, message.id, message.place); }}
      onOpenThread={() => { focus.current = fresh[0]?.id ?? message.id; choose(message.id, message.id, message.place); }} onReact={react(message.id)}
      text={<MentionText text={message.text} mentions={message.mentions} me={me} />} />;
  };
  const marked = new Set(chat.filter((m) => m.thread === null).map((m) => m.place)).size > 1;
  const destination = privateWith ? `only ${privateWith}${thread ? ' in this thread' : ''}` : thread && context ? `this thread in ${placeName(context.place)}` : here ?? 'everyone';
  const canSend = ready && (!thread || context?.place === place);
  const addressed = thread && replyTo ? chat.find((m) => m.id === replyTo && m.place === threadPlace) : null;
  return <>
    {thread && <div className="ic-thread-head"><IconButton icon="left" label="Back to chat" onClick={back} /><div><b>Thread</b><small>{privateWith ? `Only you and ${privateWith}` : context ? `In ${placeName(context.place)}` : 'Original message unavailable'}</small></div></div>}
    {!!unreadMentionIds.length && <div className="ic-mention-unread" role="status"><Icon name="chat" size={16} /><span>{unreadMentionIds.length} unread {unreadMentionIds.length === 1 ? 'mention' : 'mentions'}</span><Button variant="quiet" size="sm" onClick={openMention}>Open mention</Button></div>}
    <div ref={scroll} className="ic-scroll ic-pad" role="log" aria-label={privateWith ? `Private conversation with ${privateWith}` : thread ? 'Thread replies' : 'Room chat'} aria-live="polite" aria-relevant="additions" onScroll={() => {
      const node = scroll.current;
      if (node) { activeDraft.scrollTop = node.scrollTop; bottom.current = node.scrollHeight - node.clientHeight - node.scrollTop < 80; }
    }}>
      {thread && <div className="ic-thread-original">{original ? row(original) : <Notice icon="lock">The original message isn’t available to you. Only replies you can read are shown.</Notice>}</div>}
      {privateWith && !thread && <p className="ac-private-history">History ends with this call. Private messages stay out of the recording and notes.</p>}
      {!thread && missed && <Notice icon="lock" className="ic-missed">Messages sent here before you came aren’t shown. Only people who were here then can read them.</Notice>}
      {!thread && missing.map(({ key, first, rows }) => <div className="ic-thread-original" key={key}><Notice icon="lock">The original message isn’t available to you.</Notice><button type="button" id={`thread-open-${first.thread?.root}`} className="ic-thread-open" onClick={() => { if (first.thread) { focus.current = unreadIn(rows)[0]?.id ?? first.id; choose(first.thread.root, first.id, first.place); } }}><Icon name="reply" size={14} /><span>{rows.length} {rows.length === 1 ? 'reply' : 'replies'}</span>{unreadIn(rows).length > 0 && <b>{unreadIn(rows).length} new</b>}</button></div>)}
      {shown.length ? <div className="ic-chat">{shown.map((message, i) => <Fragment key={message.id}>
        {!thread && marked && shown[i - 1]?.place !== message.place && <div className="ic-chatplace"><span className="ac-eyebrow">In {placeName(message.place)}</span></div>}
        {row(message)}
      </Fragment>)}</div> : (thread || !missing.length) && <EmptyState title={thread ? 'No replies yet' : 'No messages yet'} className="ic-empty">{thread ? 'Keep this exchange together. Only people in its conversation can read it.' : privateWith ? `Only you and ${privateWith} can read this conversation.` : here ? `Messages are encrypted end to end. Only people in ${here} can read them.` : 'Messages are encrypted end to end. Only people in the call can read them.'}</EmptyState>}
    </div>
    {thread && context?.place !== place && <Notice icon="lock">Return to this conversation’s room to reply.</Notice>}
    {privateWith && <div className="ac-private-audience ic-private-audience"><Icon name="lock" size={14} /><span>Only you and {privateWith}</span></div>}
    {addressed && <div className="ic-replying"><Icon name="reply" size={14} /><span className="ac-clamp-1">Replying to {callName(who(addressed.from))}: {addressed.text}</span>{replyTo !== thread && <IconButton icon="x" size={14} label="Reply to the original instead" onClick={() => { draft.replyTo = thread; setReplyTo(thread); }} />}</div>}
    <ChatComposer focusRequest={composerFocus} privateWith={privateWith} key={thread ?? 'room'} draft={activeDraft} people={mentionPeople} ready={canSend} moving={moving} to={destination}
      onSend={(text, mentions) => onSend(text, mentions, thread ? { root: thread, replyTo: replyTo ?? thread } : null)} />
  </>;
}
