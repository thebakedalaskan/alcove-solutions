import { clock, type CallChatMessage, type CallReaction, type Person } from '@alcove/api';
import { motion, useReducedMotion } from 'motion/react';
import { type ReactNode } from 'react';
import { cn } from '../cn';
import { EASE } from './motion';
import { Avatar } from './people';
import { Button, IconButton } from './primitives';
import { Icon } from './icon';
import { ReactionAdd, Reactions, type ReactionShown } from './reactions';

/** One readable message, used by room and recipient-only conversations without owning either session. */
export function CallChatMessageView({ message, person, name, text, parent, me, unreadMention, canReply, canRetry, canReact, reactions,
  threadSelected, replyCount, unreadReplies, delivery, privateMessage, onRetry, onReply, onOpenThread, onReact }: {
  message: CallChatMessage; person: Person; name: string; text: ReactNode; parent?: { name: string; text: string } | undefined; me: string;
  unreadMention: boolean; canReply: boolean; canRetry: boolean; canReact: boolean; reactions: ReactionShown[]; threadSelected: boolean;
  replyCount: number; unreadReplies: number; delivery?: string | undefined; privateMessage: boolean;
  onRetry: () => void; onReply: () => void; onOpenThread: () => void; onReact: (reaction: CallReaction, on: boolean) => void;
}) {
  const reduced = useReducedMotion();
  return <motion.div id={`chat-message-${message.id}`} data-chat-message={message.id} tabIndex={-1}
    className={cn('ic-msg', unreadMention && 'has-unread-mention', message.failed && 'is-failed')}
    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.18, ease: EASE.out }}>
    <Avatar person={person} size={28} />
    <div className="ic-msg-content">
      <div className="meta"><b>{message.from === me ? `${name} (you)` : name}</b><span className="ac-time">{message.sending ? '' : clock(message.at)}</span></div>
      {parent && <div className="ic-reply-context"><Icon name="reply" size={12} /><span className="ac-clamp-1">Replying to {parent.name}: {parent.text}</span></div>}
      <p>{text}</p>
      <span data-chat-read-end className="ic-chat-read-end" aria-hidden="true" />
      {message.sending && <small className="ic-message-state" role="status">Sending…</small>}
      {message.failed && <div className="ic-message-failed" role="status"><span>Not confirmed. Your message is kept here.</span><Button size="sm" variant="quiet" disabled={!canRetry} onClick={onRetry}>{privateMessage ? 'Retry privately' : 'Retry'}</Button></div>}
      {!message.failed && !message.sending && message.isMe && delivery && <small className="ic-message-state">{delivery}</small>}
      {(canReact || reactions.length > 0) && <Reactions reactions={reactions} onToggle={onReact} canReact={canReact} />}
      {!threadSelected && replyCount > 0 && <button type="button" id={`thread-open-${message.id}`} className="ic-thread-open" onClick={onOpenThread}>
        <Icon name="reply" size={14} /><span>{replyCount} {replyCount === 1 ? 'reply' : 'replies'}</span>{unreadReplies > 0 && <b>{unreadReplies} new</b>}
      </button>}
    </div>
    {canReply && <div className="ic-msg-acts"><IconButton id={`thread-reply-${message.id}`} icon="reply" size={15} label={`Reply to ${name}`} onClick={onReply} />
      {canReact && !reactions.length && <ReactionAdd mine={[]} onPick={onReact} />}</div>}
  </motion.div>;
}
