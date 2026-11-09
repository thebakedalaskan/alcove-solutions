/*
 * A question for the room, in Chat's Questions: its votes in a column of their own, the words, and who asked, or that
 * nobody's told. Whoever hosts pins it, marks it answered or dismisses it; whoever asked takes it back. Styles are in
 * `styles/call-chat.css` (`ch-q`).
 */
import { cn } from '../cn';
import { Icon } from './icon';
import { Avatar, type AvatarPerson } from './people';
import { IconButton } from './primitives';

export function CallQuestion({ id, text, author, own, time, votes, voted, status, pinned, busy, onVote, host, onWithdraw }: {
  id: string; text: string;
  /** Who asked; null when they asked anonymously, which never says who, to anyone. */
  author: AvatarPerson | null;
  /** Yours: you're told, however you asked. */
  own: boolean;
  time: string; votes: number; voted: boolean; status: 'open' | 'answered' | 'dismissed'; pinned: boolean; busy: boolean;
  onVote: () => void;
  /** Whoever hosts: pin (or unpin), mark answered, dismiss. */
  host?: { onPin: () => void; onAnswer: () => void; onDismiss: () => void } | undefined;
  /** Whoever asked it: it goes, for everyone. */
  onWithdraw?: (() => void) | undefined;
}) {
  const open = status === 'open';
  const by = author ? (own ? 'You' : author.name) : own ? 'You, anonymously' : 'Anonymous';
  return (
    <article data-call-action={id} tabIndex={-1} className={cn('ch-q', pinned && 'is-pinned', !open && 'is-closed')} aria-label={`Question from ${by}`}>
      <button type="button" className="ch-vote" aria-pressed={voted} disabled={busy || !open}
        aria-label={`${voted ? 'Take back your vote' : 'Vote for this question'}, ${votes} ${votes === 1 ? 'vote' : 'votes'}`} onClick={onVote}>
        <Icon name="up" size={16} /><b>{votes}</b>
      </button>
      <div className="ch-q-body">
        <p>{text}</p>
        <div className="by">
          {author ? <Avatar person={author} size={18} /> : <Icon name="anonymous" size={15} className="anon" />}
          <span className="ac-clamp-1">{by} · {time}</span>
          {pinned && <span className="ch-badge is-rose"><Icon name="pin" size={11} />Pinned</span>}
          {status === 'answered' && <span className="ch-badge"><Icon name="check" size={11} />Answered</span>}
          {status === 'dismissed' && <span className="ch-badge">Dismissed</span>}
          {(host || onWithdraw) && (
            <span className="acts">
              {host && open && <IconButton icon={pinned ? 'pinOff' : 'pin'} size={15} label={pinned ? 'Unpin question' : 'Pin question'} disabled={busy} onClick={host.onPin} />}
              {host && open && <IconButton icon="check" size={15} label="Mark question answered" disabled={busy} onClick={host.onAnswer} />}
              {host && open && <IconButton icon="x" size={15} label="Dismiss question" disabled={busy} onClick={host.onDismiss} />}
              {onWithdraw && <IconButton icon="trash" size={15} label="Take back your question" disabled={busy} onClick={onWithdraw} />}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
