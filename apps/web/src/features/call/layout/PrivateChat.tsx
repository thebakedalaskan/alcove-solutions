import { type CallChatMessage, type CallSession, type DirectMessagesState, type Person } from '@alcove/api';
import { Avatar, EmptyState, Icon, Notice, Select } from '@alcove/ui';
import { useMemo, type ReactNode } from 'react';
import { type ChatDraft } from './ChatMentions';
import { type ReplyJump } from '../session/replyAlerts';
import { ChatView } from './ChatView';

export interface PrivateAudience { identity: string; place: string; generation: number }
export const privateAudienceKey = (a: PrivateAudience) => JSON.stringify([a.generation, a.place, a.identity]);
export interface PrivateChatMemory { drafts: Map<string, ChatDraft> }

/** Keeps audience choice and every draft above transient side-panel mounts. No message opens this panel itself. */
export function PrivateChat({ session, state, audience, onAudience, memory, who, place, generation, visible, children, jump }: {
  session: CallSession; state: DirectMessagesState; audience: PrivateAudience | null; onAudience: (a: PrivateAudience | null) => void;
  memory: PrivateChatMemory; who: (identity: string) => Person; place: string; generation: number; visible: boolean; children: ReactNode; jump?: ReplyJump | undefined;
}) {
  const unreadIds = useMemo(() => new Set(state.unread), [state.unread]);
  const unreadCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const message of state.messages) if (message.from !== session.ticket.identity && unreadIds.has(message.id)) {
      const key = privateAudienceKey({ identity: message.from, place: message.place, generation: message.generation });
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [state.messages, unreadIds, session.ticket.identity]);
  const conversations = useMemo(() => {
    const all = new Map<string, PrivateAudience>();
    for (const message of state.messages) {
      const identity = message.from === session.ticket.identity ? message.to : message.from;
      const a = { identity, place: message.place, generation: message.generation };
      all.set(privateAudienceKey(a), a);
    }
    for (const identity of state.peers) { const a = { identity, place, generation }; all.set(privateAudienceKey(a), a); }
    if (audience) all.set(privateAudienceKey(audience), audience);
    return all;
  }, [state.messages, state.peers, session.ticket.identity, audience, place, generation]);
  const recipientLabels = useMemo(() => {
    const people = new Map([...conversations.values()].map((a) => [a.identity, who(a.identity)]));
    const names = new Map<string, number>();
    for (const person of people.values()) names.set(person.name, (names.get(person.name) ?? 0) + 1);
    return new Map([...people].map(([identity, person]) => [identity, (names.get(person.name) ?? 0) > 1
      ? `${person.name} (${person.email || `Guest ${identity.slice(2)}`})` : person.name]));
  }, [conversations, who]);
  const chosen = audience ? privateAudienceKey(audience) : 'room';
  const available = (a: PrivateAudience) => state.ready && a.place === place && a.generation === generation && state.peers.includes(a.identity);
  const options = [{ value: 'room', label: 'Room chat', icon: 'chat' as const }, ...[...conversations].map(([value, a]) => {
    const count = unreadCounts.get(value) ?? 0;
    return { value, label: `${recipientLabels.get(a.identity) ?? who(a.identity).name} · Private${count ? ` · ${count} new` : ''}${available(a) ? '' : ' · Unavailable'}`, icon: 'lock' as const };
  })];
  const count = state.unread.length;
  const draftKey = audience ? privateAudienceKey(audience) : '';
  const draft = memory.drafts.get(draftKey) ?? { text: '' };
  if (audience) memory.drafts.set(draftKey, draft);
  return <>
    <div className="ac-private-picker"><Select label="Chat audience" value={chosen} options={options} onChange={(value) => onAudience(conversations.get(value) ?? null)} />
      <span className="sr-only" role="status" aria-live="polite">{count ? `${count} unread private ${count === 1 ? 'message' : 'messages'}. Open Chat to choose a conversation.` : ''}</span>
    </div>
    {audience ? <PrivateThread key={draftKey} session={session} state={state} audience={audience} draft={draft} available={available(audience)} who={who} recipientLabel={recipientLabels.get(audience.identity) ?? who(audience.identity).name} visible={visible} jump={jump} /> : children}
  </>;
}

function PrivateThread({ session, state, audience, draft, available, who, recipientLabel, visible, jump }: {
  session: CallSession; state: DirectMessagesState; audience: PrivateAudience; draft: ChatDraft; available: boolean; who: (identity: string) => Person; recipientLabel: string; visible: boolean; jump?: ReplyJump | undefined;
}) {
  const person = who(audience.identity);
  const messages = useMemo(() => state.messages.filter((m) => m.place === audience.place && m.generation === audience.generation && (m.from === audience.identity || m.to === audience.identity)), [state.messages, audience.place, audience.generation, audience.identity]);
  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const unreadIds = useMemo(() => new Set(state.unread), [state.unread]);
  const readIds = useMemo(() => messages.filter((m) => !unreadIds.has(m.id)).map((m) => m.id), [messages, unreadIds]);
  const unreadMentions = useMemo(() => state.unreadMentions.filter((id) => messageById.has(id)), [state.unreadMentions, messageById]);
  const chat: CallChatMessage[] = useMemo(() => messages.map((m) => ({ id: m.id, from: m.from, text: m.text, at: m.at, place: m.place,
    isMe: m.from === session.ticket.identity, sending: m.state === 'sending', failed: m.state === 'failed', thread: m.thread, mentions: m.mentions, reactions: [] })), [messages, session.ticket.identity]);
  const mentionPeople = available ? [{ identity: session.ticket.identity, person: who(session.ticket.identity) }, { identity: audience.identity, person }] : [];
  return <>
    <div className="ac-private-heading"><Avatar person={person} size={36} /><div><b className="ac-clamp-1" title={recipientLabel}>{recipientLabel}</b><span><Icon name="lock" size={12} />Private conversation · This call only</span></div></div>
    {!available && <Notice icon="lock">Unavailable in this room. Your draft stays here.</Notice>}
    {!state.ready ? <div className="ic-scroll ic-pad"><EmptyState art={null} title="Reconnecting privately">Messages return once your place in the call is checked.</EmptyState></div>
      : <ChatView readable={state.ready} chat={chat} missed={false} ready={available} moving={false} place={audience.place} here={null}
        placeName={() => 'your private conversation'} who={who} me={session.ticket.identity} draft={draft} mentionPeople={mentionPeople} unreadMentionIds={unreadMentions}
        jump={jump} privateWith={recipientLabel} visible={visible} readIds={readIds}
        onRead={(ids) => session.direct.read(ids)} onSend={(text, mentions, thread) => session.direct.send(audience.identity, text, mentions, thread)}
        onRetry={(id) => session.direct.retry(id)} delivery={(id) => messageById.get(id)?.state === 'delivered' ? 'Delivered' : 'Sent'} />}
  </>;
}
