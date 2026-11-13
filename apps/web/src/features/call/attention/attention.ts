import type { CallCrypto, CallState } from '@alcove/api';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { answerAttentionLook, holdAttention, publishAttention } from '~/features/notifications/attentionChannel';
import { accountQueries } from '~/features/account/queries';
import { onSignedOutElsewhere, signedOut } from '~/lib/signedOut';

/** Someone's raised hand, by its ID, or null while their hand is down: People's rows and their ⋯ lower it by that ID. */
export const handOf = (state: CallState, id: string): string | null => state.attention.hands.find((h) => h.participantId === id)?.id ?? null;

/** Counts come from the same current snapshots as Chat and the host's persistent admission cards. */
export function unreadChatMentions(state: CallState, crypto: CallCrypto, identity: string): string[] {
  if (state.phase !== 'in-call' || crypto.status !== 'in') return [];
  const read = new Set(state.chatRead);
  return crypto.chat.filter((message) => !message.sending && !message.failed && !message.isMe && message.place === crypto.place
    && !read.has(message.id) && message.mentions.some((mention) => mention.identity === identity)).map((message) => message.id);
}

/** Owns this call's cross-tab publisher and heartbeat, removed as soon as the call or its authorization goes away. */
export function useCallAttention(state: CallState, crypto: CallCrypto, unread: readonly string[], enabled: boolean) {
  const session = useQuery(accountQueries.session());
  const owner = session.data?.ownerId ?? null;
  // A signed-in call never becomes a guest publisher when that account signs out.
  const account = useRef<{ known: boolean; owner: string | null }>({ known: false, owner: null });
  if (!account.current.known && session.isSuccess) account.current = { known: true, owner };
  const current = useRef({ state, crypto, unread, enabled, owner });
  current.current = { state, crypto, unread, enabled, owner };
  const publish = useRef<(() => void) | null>(null);
  useEffect(() => {
    const tab = globalThis.crypto.randomUUID();
    const stopLock = holdAttention(tab);
    let revoked = false;
    const send = () => {
      const now = current.current;
      const who = account.current;
      const allowed = who.known && who.owner === now.owner && !revoked && !(who.owner !== null && signedOut(who.owner)) && now.enabled && now.state.phase === 'in-call' && now.crypto.status === 'in';
      publishAttention({ type: 'call', tab, owner: who.owner, call: now.state.callId,
        mentions: allowed ? Math.min(99, now.unread.length) : 0,
        actions: allowed && now.state.isHost ? Math.min(99, now.state.waiting.length) : 0 });
    };
    publish.current = send;
    send();
    const stopLook = answerAttentionLook(send);
    const stopAccount = onSignedOutElsewhere((who) => { if (who === account.current.owner) { revoked = true; send(); } });
    const timer = setInterval(send, 5_000);
    const hide = () => publishAttention({ type: 'gone', tab });
    window.addEventListener('pagehide', hide);
    return () => { publish.current = null; clearInterval(timer); stopLock(); stopLook(); stopAccount(); window.removeEventListener('pagehide', hide); hide(); };
  }, [state.callId]);
  useEffect(() => { publish.current?.(); }, [state, crypto, unread, enabled, owner]);
  return account.current.known && account.current.owner === owner && session.isSuccess
    && !(owner !== null && signedOut(owner)) && enabled;
}
