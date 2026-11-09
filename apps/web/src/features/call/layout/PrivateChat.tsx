import { clock, errorMessage, type CallSession, type DirectMessagesState, type Person } from '@alcove/api';
import { Avatar, EmptyState, Icon, PrivateChatComposer, PrivateMessage, Select, useToast } from '@alcove/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { type Draft } from './side';

export interface PrivateAudience { identity: string; place: string; generation: number }
export const privateAudienceKey = (a: PrivateAudience) => JSON.stringify([a.generation, a.place, a.identity]);
export interface PrivateChatMemory { drafts: Map<string, Draft> }

/** Keeps audience choice and every draft above transient side-panel mounts. No message opens this panel itself. */
export function PrivateChat({ session, state, audience, onAudience, memory, who, place, generation, visible, children }: {
  session: CallSession; state: DirectMessagesState; audience: PrivateAudience | null; onAudience: (a: PrivateAudience | null) => void;
  memory: PrivateChatMemory; who: (identity: string) => Person; place: string; generation: number; visible: boolean; children: ReactNode;
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
    {audience ? <PrivateThread key={draftKey} session={session} state={state} audience={audience} draft={draft} available={available(audience)} who={who} visible={visible} /> : children}
  </>;
}

function PrivateThread({ session, state, audience, draft, available, who, visible }: {
  session: CallSession; state: DirectMessagesState; audience: PrivateAudience; draft: Draft; available: boolean; who: (identity: string) => Person; visible: boolean;
}) {
  const [text, setText] = useState(draft.text);
  const toast = useToast();
  const end = useRef<HTMLDivElement>(null);
  const person = who(audience.identity);
  const messages = state.messages.filter((m) => m.place === audience.place && m.generation === audience.generation && (m.from === audience.identity || m.to === audience.identity));
  const unread = messages.filter((m) => state.unread.includes(m.id)).map((m) => m.id);
  const unreadKey = unread.join(',');
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);
  useEffect(() => {
    const mark = () => { if (visible && state.ready && document.visibilityState === 'visible' && document.hasFocus()) session.direct.read(unread); };
    mark(); window.addEventListener('focus', mark); document.addEventListener('visibilitychange', mark);
    return () => { window.removeEventListener('focus', mark); document.removeEventListener('visibilitychange', mark); };
  }, [session, visible, state.ready, unreadKey]);
  const send = () => {
    if (!available || !text.trim()) return;
    const original = text;
    draft.text = ''; setText('');
    void session.direct.send(audience.identity, original).catch((e: unknown) => {
      toast(errorMessage(e), { icon: 'x' });
      // A rejected submission belongs to this exact draft, even if the audience switched meanwhile.
      if (!draft.text) { draft.text = original; setText(original); }
    });
  };
  return <>
    <div className="ac-private-heading"><Avatar person={person} size={36} /><div><b>{person.name}</b><span><Icon name="lock" size={12} />Private conversation · This call only</span></div></div>
    <div className="ic-scroll ic-pad" role="log" aria-label={`Private conversation with ${person.name}`} aria-live="polite" aria-relevant="additions">
      <p className="ac-private-history">History ends with this call. Private messages stay out of the recording and notes.</p>
      {!state.ready ? <EmptyState art={null} title="Reconnecting privately">Messages return once your place in the call is checked.</EmptyState>
        : messages.length ? <div className="ac-private-messages">{messages.map((message) => <PrivateMessage key={message.id} message={message} person={who(message.from)} mine={message.from === session.ticket.identity} time={clock(message.at)} onRetry={() => { void session.direct.retry(message.id); }} />)}</div>
          : <EmptyState art={null} title="A word, just between you">Send {person.name} a private message without interrupting the call.</EmptyState>}
      <div ref={end} />
    </div>
    <PrivateChatComposer name={person.name} value={text} available={available} onChange={(next) => { draft.text = next; setText(next); }} onSend={send} />
  </>;
}
