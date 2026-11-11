/*
 * A question for the room, in Chat's Questions: its votes in a column of their own, named Vote or Voted, the words, and who
 * asked, or that nobody's told. Whatever else can be done to it is in its ⋯, in words: whoever hosts pins it, marks it
 * answered, dismisses it, or reopens one answered or dismissed; whoever asked takes it back. Styles are in
 * `styles/call-chat.css` (`ch-q`).
 */
import { useState } from 'react';
import { cn } from '../cn';
import { Icon } from './icon';
import { Popover } from './overlay';
import { Avatar, type AvatarPerson } from './people';
import { IconButton } from './primitives';

export function CallQuestion({ id, text, author, own, time, votes, voted, status, pinned, busy, onVote, host, onWithdraw, onMenu }: {
  id: string; text: string;
  /** Who asked; null when they asked anonymously, which never says who, to anyone. */
  author: AvatarPerson | null;
  /** Yours: you're told, however you asked. */
  own: boolean;
  time: string; votes: number; voted: boolean; status: 'open' | 'answered' | 'dismissed'; pinned: boolean; busy: boolean;
  onVote: () => void;
  /** Whoever hosts: pin (or unpin), mark answered and dismiss an open question; reopen one answered or dismissed. */
  host?: { onPin: () => void; onAnswer: () => void; onDismiss: () => void; onReopen: () => void } | undefined;
  /** Whoever asked it: it goes, for everyone. */
  onWithdraw?: (() => void) | undefined;
  /** Its ⋯ opened or closed, for a list that holds still while it's open. */
  onMenu?: ((open: boolean) => void) | undefined;
}) {
  const [menu, setMenu] = useState(false);
  const open = status === 'open';
  const by = author ? (own ? 'You' : author.name) : own ? 'You, anonymously' : 'Anonymous';
  const setOpen = (o: boolean) => { setMenu(o); onMenu?.(o); };
  const pick = (act: () => void) => () => { setOpen(false); act(); };
  return (
    <article data-call-action={id} tabIndex={-1} className={cn('ch-q', pinned && 'is-pinned', !open && 'is-closed')} aria-label={`Question from ${by}`}>
      <button type="button" className="ch-vote" aria-pressed={voted} disabled={busy || !open}
        aria-label={`${voted ? 'Take back your vote' : 'Vote for this question'}, ${votes} ${votes === 1 ? 'vote' : 'votes'}`} onClick={onVote}>
        <Icon name="up" size={15} /><b>{votes}</b><span className="w">{voted ? 'Voted' : 'Vote'}</span>
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
            <Popover open={menu} onOpenChange={setOpen} label={`Question from ${by}`} align="end" tip="More" className="ic-menu narrow ch-qmenu"
              anchor={<IconButton icon="more" size={16} label="More for this question" title={undefined} disabled={busy} className="ch-qmore" />}>
              {host && open && <button type="button" className="mi" onClick={pick(host.onPin)}><Icon name={pinned ? 'pinOff' : 'pin'} size={17} /><span className="t">{pinned ? 'Unpin' : 'Pin to the top'}</span></button>}
              {host && open && <button type="button" className="mi" onClick={pick(host.onAnswer)}><Icon name="circleCheck" size={17} /><span className="t">Mark answered</span></button>}
              {host && open && <button type="button" className="mi" onClick={pick(host.onDismiss)}><Icon name="eyeOff" size={17} /><span className="t">Dismiss</span></button>}
              {host && !open && <button type="button" className="mi" onClick={pick(host.onReopen)}><Icon name="undo" size={17} /><span className="t">Reopen</span></button>}
              {onWithdraw && <button type="button" className={cn('mi', host && 'is-apart')} onClick={pick(onWithdraw)}><Icon name="trash" size={17} /><span className="t">Take back your question</span></button>}
            </Popover>
          )}
        </div>
      </div>
    </article>
  );
}
