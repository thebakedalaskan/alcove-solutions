import { type CallChatMessage, type CallSession, type DirectMessagesState, type Person } from '@alcove/api';
import { Avatar, EmptyState, Icon, Notice, Select } from '@alcove/ui';
import { type ReactNode } from 'react';
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
  const conversations = new Map<string, PrivateAudience>();
  for (const message of state.messages) {
    const identity = message.from === session.ticket.identity ? message.to : message.from;
    const a = { identity, place: message.place, generation: message.generation };
    conversations.set(privateAudienceKey(a), a);
  }
  for (const identity of state.peers) { const a = { identity, place, generation }; conversations.set(privateAudienceKey(a), a); }
  if (audience) conversations.set(privateAudienceKey(audience), audience);
  const chosen = audience ? privateAudienceKey(audience) : 'room';
  const unread = (a: PrivateAudience) => state.messages.filter((m) => m.from === a.identity && m.place === a.place && m.generation === a.generation && state.unread.includes(m.id)).length;
  const available = (a: PrivateAudience) => state.ready && a.place === place && a.generation === generation && state.peers.includes(a.identity);
  const options = [{ value: 'room', label: 'Room chat', icon: 'chat' as const }, ...[...conversations].map(([value, a]) => {
    const count = unread(a);
    return { value, label: `${who(a.identity).name} · Private${count ? ` · ${count} new` : ''}${available(a) ? '' : ' · Unavailable'}`, icon: 'lock' as const };
  })];
  const count = state.unread.length;
  const draftKey = audience ? privateAudienceKey(audience) : '';
  const draft = memory.drafts.get(draftKey) ?? { text: '' };
  if (audience) memory.drafts.set(draftKey, draft);
  return <>
    <div className="ac-private-picker"><Select label="Chat audience" value={chosen} options={options} onChange={(value) => onAudience(conversations.get(value) ?? null)} />
      <span className="sr-only" role="status" aria-live="polite">{count ? `${count} unread private ${count === 1 ? 'message' : 'messages'}. Open Chat to choose a conversation.` : ''}</span>
    </div>
    {audience ? <PrivateThread key={draftKey} session={session} state={state} audience={audience} draft={draft} available={available(audience)} who={who} visible={visible} jump={jump} /> : children}
  </>;
}

function PrivateThread({ session, state, audience, draft, available, who, visible, jump }: {
  session: CallSession; state: DirectMessagesState; audience: PrivateAudience; draft: ChatDraft; available: boolean; who: (identity: string) => Person; visible: boolean; jump?: ReplyJump | undefined;
}) {
  const person = who(audience.identity);
  const messages = state.messages.filter((m) => m.place === audience.place && m.generation === audience.generation && (m.from === audience.identity || m.to === audience.identity));
  const chat: CallChatMessage[] = messages.map((m) => ({ id: m.id, from: m.from, text: m.text, at: m.at, place: m.place,
    isMe: m.from === session.ticket.identity, sending: m.state === 'sending', failed: m.state === 'failed', thread: m.thread, mentions: [], reactions: [] }));
  return <>
    <div className="ac-private-heading"><Avatar person={person} size={36} /><div><b>{person.name}</b><span><Icon name="lock" size={12} />Private conversation · This call only</span></div></div>
    {!available && <Notice icon="lock">Unavailable in this room. Your draft stays here.</Notice>}
    {!state.ready ? <div className="ic-scroll ic-pad"><EmptyState art={null} title="Reconnecting privately">Messages return once your place in the call is checked.</EmptyState></div>
      : <ChatView chat={chat} missed={false} ready={available} moving={false} place={audience.place} here={null}
        placeName={() => 'your private conversation'} who={who} me={session.ticket.identity} draft={draft} mentionPeople={[]}
        jump={jump} privateWith={person.name} visible={visible} readIds={messages.filter((m) => !state.unread.includes(m.id)).map((m) => m.id)}
        onRead={(ids) => session.direct.read(ids)} onSend={(text, _mentions, thread) => session.direct.send(audience.identity, text, thread)}
        onRetry={(id) => session.direct.retry(id)} delivery={(id) => messages.find((m) => m.id === id)?.state === 'delivered' ? 'Delivered' : 'Sent'} />}
  </>;
}
