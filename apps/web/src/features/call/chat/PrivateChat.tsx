/*
 * Private conversations in Chat: which there are, what each tab calls its other person, and one conversation, under its
 * lock line. The words are the recipient-only messages of `session.direct`; nothing here is shared with the room.
 */
import { type CallChatMessage, type CallSession, type DirectMessagesState, type Person } from '@alcove/api';
import { ChatLock, EmptyState, Notice } from '@alcove/ui';
import { useMemo } from 'react';
import { callName } from '~/lib/people';
import { type ChatDraft } from './ChatMentions';
import { type ReplyJump } from './replyAlerts';
import { ChatView } from './ChatView';

/** Who a private conversation is with: their exact connection, in the room and generation it began in. */
export interface PrivateAudience { identity: string; place: string; generation: number }
export const privateAudienceKey = (a: PrivateAudience) => JSON.stringify([a.generation, a.place, a.identity]);

/** Every private conversation there is: each with a message in it, then each you opened, in the order they began. */
export function privateConversations(state: DirectMessagesState, me: string, opened: Iterable<PrivateAudience>): PrivateAudience[] {
  const all = new Map<string, PrivateAudience>();
  for (const message of state.messages) {
    const a = { identity: message.from === me ? message.to : message.from, place: message.place, generation: message.generation };
    all.set(privateAudienceKey(a), a);
  }
  for (const a of opened) all.set(privateAudienceKey(a), a);
  return [...all.values()];
}

/** Unread messages in each private conversation, by its key. */
export function privateUnread(state: DirectMessagesState, me: string): Map<string, number> {
  const unread = new Set(state.unread);
  const counts = new Map<string, number>();
  for (const message of state.messages) if (message.from !== me && unread.has(message.id)) {
    const key = privateAudienceKey({ identity: message.from, place: message.place, generation: message.generation });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * What each conversation calls its other person: a first name on its tab, and in full where it's said. Two people who share
 * a name, in a conversation or anywhere in the call (`here`), are told apart by their address, or a guest by their connection.
 */
export function privateNames(audiences: readonly PrivateAudience[], here: readonly string[], who: (identity: string) => Person): Map<string, { short: string; full: string }> {
  const people = new Map(audiences.map((a) => [a.identity, who(a.identity)]));
  const everyone = new Map([...here.map((identity) => [identity, who(identity)] as const), ...people]);
  const count = (name: string) => [...everyone.values()].filter((p) => p.name === name).length;
  const shortCount = (name: string) => [...everyone.values()].filter((p) => callName(p) === name).length;
  return new Map([...people].map(([identity, person]) => {
    const full = count(person.name) > 1 ? `${person.name} (${person.email || `Guest ${identity.slice(2)}`})` : person.name;
    return [identity, { full, short: shortCount(callName(person)) > 1 ? full : callName(person) }];
  }));
}

/** One private conversation: who alone can read it, then its messages, threads and composer. */
export function PrivateConversation({ session, state, audience, place, generation, draft, who, name, visible, jump, when }: {
  session: CallSession; state: DirectMessagesState; audience: PrivateAudience; place: string; generation: number; draft: ChatDraft;
  who: (identity: string) => Person; name: string; visible: boolean; jump?: ReplyJump | undefined; when: (at: number) => string;
}) {
  const me = session.ticket.identity;
  const available = state.ready && audience.place === place && audience.generation === generation && state.peers.includes(audience.identity);
  const messages = useMemo(() => state.messages.filter((m) => m.place === audience.place && m.generation === audience.generation && (m.from === audience.identity || m.to === audience.identity)), [state.messages, audience.place, audience.generation, audience.identity]);
  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const unreadIds = useMemo(() => new Set(state.unread), [state.unread]);
  const readIds = useMemo(() => messages.filter((m) => !unreadIds.has(m.id)).map((m) => m.id), [messages, unreadIds]);
  const unreadMentions = useMemo(() => state.unreadMentions.filter((id) => messageById.has(id)), [state.unreadMentions, messageById]);
  const chat: CallChatMessage[] = useMemo(() => messages.map((m) => ({ id: m.id, from: m.from, text: m.text, at: m.at, place: m.place,
    isMe: m.from === me, sending: m.state === 'sending', failed: m.state === 'failed', thread: m.thread, broadcast: false, mentions: m.mentions, reactions: m.reactions })), [messages, me]);
  const mentionPeople = available ? [{ identity: me, person: who(me) }, { identity: audience.identity, person: who(audience.identity) }] : [];
  return <>
    <ChatLock>Only you and {name} can read this.</ChatLock>
    {!available && <Notice icon="lock">Unavailable in this room. Your draft stays here.</Notice>}
    {!state.ready ? <EmptyState art={null} title="Reconnecting privately" className="ch-empty">Messages return once your place in the call is checked.</EmptyState>
      : <ChatView readable={state.ready} chat={chat} missed={false} ready={available} moving={false} place={audience.place} here={null}
        placeName={() => 'your private conversation'} who={who} me={me} draft={draft} mentionPeople={mentionPeople} unreadMentionIds={unreadMentions}
        jump={jump} privateWith={name} visible={visible} readIds={readIds} when={when}
        onRead={(ids) => session.direct.read(ids)} onSend={(text, mentions, thread) => session.direct.send(audience.identity, text, mentions, thread)}
        onRetry={(id) => session.direct.retry(id)} onReact={(id, reaction, on) => session.direct.react(id, reaction, on)}
        delivery={(id) => messageById.get(id)?.state === 'delivered' ? 'Delivered' : 'Sent'} />}
  </>;
}
