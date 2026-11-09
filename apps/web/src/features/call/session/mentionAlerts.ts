import { type CallCrypto, type CallSession, type CallState, type DirectMessagesState } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useEffect, useRef } from 'react';
import { type PrivateAudience } from '../layout/PrivateChat';
import { unreadChatMentions } from './attention';
import { useCallAlertPreference } from './alertPreferences';

interface Baseline { scope: string; at: number; ids: Set<string> }
/** Local generic attention only. Exact destinations are rechecked on use; no message opens or takes focus itself. */
export function useMentionAlerts({ session, state, crypto, direct, allowed, onOpen }: {
  session: CallSession; state: CallState; crypto: CallCrypto; direct: DirectMessagesState; allowed: boolean;
  onOpen: (id: string, audience: PrivateAudience | null) => void;
}) {
  const preference = useCallAlertPreference('mentionAlerts');
  const toast = useToast();
  const latest = useRef({ session, state, crypto, direct, allowed, onOpen });
  latest.current = { session, state, crypto, direct, allowed, onOpen };
  const roomBaseline = useRef<Baseline | null>(null);
  const privateBaseline = useRef<Baseline | null>(null);
  const shown = useRef<{ id: string; scope: string; audience: PrivateAudience | null; close: () => void } | null>(null);
  const roomScope = `${state.callId}:${session.ticket.identity}:${state.generation}:${crypto.place}:${crypto.status}`;
  const privateScope = `${roomScope}:${direct.ready}`;
  useEffect(() => () => { shown.current?.close(); shown.current = null; }, [session]);
  useEffect(() => {
    const roomIds = new Set(unreadChatMentions(state, crypto, session.ticket.identity));
    const retained = new Set(direct.unreadMentions);
    const peers = new Set(direct.peers);
    const privateIds = new Set(direct.messages.filter((m) => retained.has(m.id) && peers.has(m.from) && m.place === crypto.place && m.generation === state.generation).map((m) => m.id));
    const previousRoom = roomBaseline.current; const previousPrivate = privateBaseline.current;
    // Baseline every confirmed incoming ID, including while a preference is off or its candidate is already read.
    roomBaseline.current = allowed && crypto.status === 'in' ? { scope: roomScope, at: Date.now(), ids: new Set(crypto.chat.filter((m) => !m.isMe && !m.sending && !m.failed).map((m) => m.id)) } : null;
    privateBaseline.current = allowed && direct.ready ? { scope: privateScope, at: Date.now(), ids: new Set(direct.messages.filter((m) => m.to === session.ticket.identity && m.state === 'delivered').map((m) => m.id)) } : null;
    const active = shown.current;
    if (active && (!allowed || !preference.enabled || active.scope !== (active.audience ? privateScope : roomScope) || !(active.audience ? privateIds : roomIds).has(active.id))) { active.close(); shown.current = null; }
    if (!allowed || !preference.enabled) return;
    const freshRoom = previousRoom?.scope === roomScope && Date.now() - previousRoom.at <= 12_000
      ? crypto.chat.find((m) => roomIds.has(m.id) && crypto.members.includes(m.from) && !previousRoom.ids.has(m.id) && state.elapsed - m.at <= 5) : undefined;
    const freshPrivate = previousPrivate?.scope === privateScope && Date.now() - previousPrivate.at <= 12_000
      ? direct.messages.find((m) => privateIds.has(m.id) && !previousPrivate.ids.has(m.id) && state.elapsed - m.at <= 5) : undefined;
    const id = freshRoom?.id ?? freshPrivate?.id;
    if (!id) return;
    const audience = freshPrivate && !freshRoom ? { identity: freshPrivate.from, place: freshPrivate.place, generation: freshPrivate.generation } : null;
    shown.current?.close();
    const close = toast('Someone mentioned you in your call.', { icon: 'chat', topic: 'call-mention', ms: 5000, action: { label: 'Open mention', onClick: () => {
      const now = latest.current;
      if (now.session !== session || now.state.callId !== state.callId || !now.allowed || now.state.phase !== 'in-call' || now.state.generation !== state.generation || now.crypto.place !== crypto.place) return;
      const unread = audience ? now.direct.ready && now.direct.unreadMentions.includes(id) && now.direct.peers.includes(audience.identity)
        : now.crypto.status === 'in' && unreadChatMentions(now.state, now.crypto, session.ticket.identity).includes(id);
      if (unread) now.onOpen(id, audience);
    } } });
    shown.current = { id, audience, scope: audience ? privateScope : roomScope, close };
  }, [session, state, crypto, direct, roomScope, privateScope, allowed, preference.enabled, toast]);
}
