/*
 * What's new for you in Chat: the room's messages in your part of the call, mentions of you and replies in your threads, and
 * private messages, counted once each on Chat's button (`unread`). Mentions, here and in private, are what the tab's attention
 * says (`attentionMentions`). Reading them is saved in batches, each once while it's on its way (`readMentions`).
 */
import { errorCode, type CallCrypto, type CallSession, type CallState, type DirectMessagesState } from '@alcove/api';
import { useCallback, useMemo, useRef } from 'react';
import { log } from '~/lib/log';
import { unreadChatMentions } from '../attention/attention';
import { inConversation } from './ChatView';
import { unreadThreadReplies } from './replyAlerts';

const clog = log.child({ component: 'call' });

export function useUnread({ session, state, crypto, direct, self }: { session: CallSession; state: CallState; crypto: CallCrypto; direct: DirectMessagesState; self: string }) {
  const readChatIds = useMemo(() => new Set(state.chatRead), [state.chatRead]);
  const unreadChat = crypto.status === 'in' ? crypto.chat.filter((m) => !m.isMe && !m.sending && !m.failed && inConversation(m) && m.place === crypto.place && !readChatIds.has(m.id)).map((m) => m.id) : [];
  const unreadMentions = useMemo(() => unreadChatMentions(state, crypto, self), [state, crypto, self]);
  const unreadReplies = useMemo(() => unreadThreadReplies(state, crypto, self), [state, crypto, self]);
  const unread = new Set([...unreadChat, ...unreadMentions, ...unreadReplies]).size + direct.unread.length;
  const attentionMentions = useMemo(() => [...unreadMentions, ...direct.unreadMentions], [unreadMentions, direct.unreadMentions]);
  const readingMentions = useRef(new Set<string>());
  const readMentions = useCallback((ids: readonly string[]) => {
    const fresh = ids.filter((id) => !readingMentions.current.has(id));
    for (let at = 0; at < fresh.length; at += 200) {
      const batch = fresh.slice(at, at + 200);
      for (const id of batch) readingMentions.current.add(id);
      void session.readChat(batch).catch((e: unknown) => clog.warn('chat read state not saved', { code: errorCode(e) }))
        .finally(() => { for (const id of batch) readingMentions.current.delete(id); });
    }
  }, [session]);
  return { unreadChat, unreadMentions, unread, attentionMentions, readMentions };
}
