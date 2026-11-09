import { type CallCrypto, type CallSession, type CallState, type DirectMessagesState } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useEffect, useRef } from 'react';
import { type PrivateAudience } from '../layout/PrivateChat';
import { useCallAlertPreference } from './alertPreferences';

/** Only authors and people who have taken part follow a thread. Reading a thread never subscribes the room. */
export function unreadThreadReplies(state: CallState, crypto: CallCrypto, identity: string): string[] {
  if (state.phase !== 'in-call' || crypto.status !== 'in') return [];
  const read = new Set(state.chatRead);
  const mine = new Set(crypto.chat.filter((m) => m.from === identity && !m.failed && !m.sending && m.place === crypto.place).map((m) => m.thread?.root ?? m.id));
  return crypto.chat.filter((m) => m.thread && mine.has(m.thread.root) && !m.isMe && !m.sending && !m.failed
    && m.place === crypto.place && !read.has(m.id)).map((m) => m.id);
}

export interface ReplyJump { id: string; request: number }
export function useReplyAlerts({ session, state, crypto, direct, allowed, onOpen }: {
  session: CallSession; state: CallState; crypto: CallCrypto; direct: DirectMessagesState; allowed: boolean;
  onOpen: (id: string, audience: PrivateAudience | null) => void;
}) {
  const preference = useCallAlertPreference('replyAlerts');
  const toast = useToast();
  const latest = useRef({ session, state, crypto, direct, allowed, onOpen });
  latest.current = { session, state, crypto, direct, allowed, onOpen };
  const scope = `${state.callId}:${state.generation}:${crypto.place}:${crypto.status}:${direct.ready}`;
  const baseline = useRef<{ scope: string; at: number; ids: Set<string> } | null>(null);
  const shown = useRef<{ id: string; scope: string; close: () => void } | null>(null);
  useEffect(() => () => { shown.current?.close(); shown.current = null; }, [session]);
  useEffect(() => {
    const replies = unreadThreadReplies(state, crypto, session.ticket.identity);
    const mentions = new Set(crypto.chat.filter((m) => m.mentions.some((mention) => mention.identity === session.ticket.identity)).map((m) => m.id));
    const relevant = new Set(replies.filter((id) => !mentions.has(id)));
    const privateUnread = new Set(direct.unread);
    const privateReplies = direct.ready ? direct.messages.filter((m) => m.thread && m.to === session.ticket.identity && privateUnread.has(m.id) && !m.mentions.some((mention) => mention.identity === session.ticket.identity)
      && m.place === crypto.place && m.generation === state.generation && direct.peers.includes(m.from)) : [];
    const ids = new Set([...relevant, ...privateReplies.map((m) => m.id)]);
    const previous = baseline.current;
    // Joining a thread or changing read state does not make an already received message new.
    const received = new Set([...crypto.chat.filter((m) => !m.isMe && !m.sending && !m.failed).map((m) => m.id),
      ...direct.messages.filter((m) => m.to === session.ticket.identity && m.state === 'delivered').map((m) => m.id)]);
    baseline.current = allowed ? { scope, at: Date.now(), ids: received } : null;
    if (shown.current && (!allowed || !preference.enabled || shown.current.scope !== scope || !ids.has(shown.current.id))) { shown.current.close(); shown.current = null; }
    if (!allowed || !preference.enabled || !previous || previous.scope !== scope || Date.now() - previous.at > 12_000) return;
    const room = crypto.chat.find((m) => relevant.has(m.id) && crypto.members.includes(m.from) && !previous.ids.has(m.id) && state.elapsed - m.at <= 5);
    const privateMessage = privateReplies.find((m) => !previous.ids.has(m.id) && state.elapsed - m.at <= 5);
    const id = room?.id ?? privateMessage?.id;
    if (!id) return;
    const audience = privateMessage && !room ? { identity: privateMessage.from, place: privateMessage.place, generation: privateMessage.generation } : null;
    shown.current?.close();
    const close = toast('New reply in a conversation you follow.', { icon: 'reply', topic: 'call-reply', ms: 5000, action: { label: 'Open reply', onClick: () => {
      const now = latest.current;
      if (now.session !== session || now.state.callId !== state.callId || !now.allowed || now.state.phase !== 'in-call' || now.state.generation !== state.generation || now.crypto.place !== crypto.place) return;
      const readable = audience ? now.direct.ready && now.direct.peers.includes(audience.identity) && now.direct.messages.some((m) => m.id === id)
        : now.crypto.status === 'in' && now.crypto.chat.some((m) => m.id === id && m.place === now.crypto.place);
      if (readable) now.onOpen(id, audience);
    } } });
    shown.current = { id, scope, close };
  }, [session, state, crypto, direct, scope, allowed, preference.enabled, toast]);
}
