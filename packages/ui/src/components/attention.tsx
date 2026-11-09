import type { ReactNode } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';
import { Avatar, type AvatarPerson } from './people';
import { Button, IconButton } from './primitives';

/** Persistent counts: what needs a turn, even with the people put away. */
export function AttentionButton({ hands, questions, waiting, on, onClick, compact = false, className }: {
  hands: number; questions: number; waiting: number; on: boolean; onClick: () => void; compact?: boolean; className?: string;
}) {
  const label = `Attention, ${hands} hands, ${questions} open questions${waiting ? `, ${waiting} waiting` : ''}`;
  return <button type="button" className={cn('ac-attention-button', on && 'is-on', compact && 'is-compact', className)} data-side="attention" aria-label={label} aria-pressed={on} onClick={onClick}>
    <Icon name="hand" size={17} />{!compact && <span>Attention</span>}<span className="ac-attention-counts" aria-hidden="true"><b>{hands}</b><Icon name="ask" size={14} /><b>{questions}</b>{waiting > 0 && <><Icon name="door" size={14} /><b>{waiting}</b></>}</span>
  </button>;
}

/** A quiet signal, also used beside a person's tile. */
export function CallSignal({ label, icon, count, className }: { label: string; icon: IconName; count?: number; className?: string }) {
  return <span className={cn('ac-call-signal', className)}><Icon name={icon} size={14} /><span>{label}</span>{count !== undefined && <b>{count}</b>}</span>;
}

export function AttentionHand({ person, number, detail, lower, busy, actionId }: {
  actionId?: string | undefined;
  person: AvatarPerson; number: number; detail: string; lower: { label: string; onClick: () => void } | null; busy: boolean;
}) {
  return <li className="ac-attention-hand" data-call-action={actionId} tabIndex={actionId ? -1 : undefined}><span className="number">{number}</span><Avatar person={person} size={30} /><div className="person"><b className="ac-clamp-1">{person.name}</b><small>{detail}</small></div>{lower && <Button size="xs" variant="quiet" disabled={busy} onClick={lower.onClick}>{lower.label}</Button>}</li>;
}

/** One question: stable identity and a separate vote control preserve where someone's reading. */
export function AttentionQuestion({ author, text, votes, voted, status, pinned, busy, onVote, actions, actionId }: {
  actionId?: string | undefined;
  author: AvatarPerson; text: string; votes: number; voted: boolean; status: 'open' | 'answered' | 'dismissed'; pinned: boolean; busy: boolean;
  onVote: () => void; actions?: { pin: () => void; answer: () => void; dismiss: () => void } | undefined;
}) {
  return <article data-call-action={actionId} tabIndex={actionId ? -1 : undefined} className={cn('ac-attention-question', pinned && 'is-pinned')} aria-label={`Question from ${author.name}`}>
    <div className="by"><Avatar person={author} size={22} /><b className="ac-clamp-1">{author.name}</b>{pinned && <span className="state"><Icon name="pin" size={12} />Pinned</span>}{status !== 'open' && <span className="state">{status === 'answered' ? 'Answered' : 'Dismissed'}</span>}</div>
    <p>{text}</p><div className="actions"><button type="button" className="ac-attention-vote" aria-label={`${voted ? 'Remove vote' : 'Vote for question'} from ${author.name}, ${votes} votes`} aria-pressed={voted} disabled={busy || status !== 'open'} onClick={onVote}><Icon name="up" size={15} /><b>{votes}</b>{voted ? 'Voted' : 'Vote'}</button>{actions && status === 'open' && <span className="host-actions"><IconButton icon={pinned ? 'pinOff' : 'pin'} label={pinned ? 'Unpin question' : 'Pin question'} disabled={busy} onClick={actions.pin} /><IconButton icon="check" label="Mark question answered" disabled={busy} onClick={actions.answer} /><IconButton icon="x" label="Dismiss question" disabled={busy} onClick={actions.dismiss} /></span>}</div>
  </article>;
}

/** Signal choices are toggles, not reactions or chat messages. */
export function CallSignalChoices({ choices, selected, busy, onChange }: {
  choices: readonly { value: string; label: string; icon: IconName }[]; selected: string | null; busy: boolean; onChange: (value: string | null) => void;
}) {
  return <div className="ac-call-signals" role="group" aria-label="Send a quiet signal">{choices.map((c) => <button type="button" key={c.value} aria-pressed={selected === c.value} disabled={busy} onClick={() => onChange(selected === c.value ? null : c.value)}><Icon name={c.icon} size={17} />{c.label}{selected === c.value && <Icon name="check" size={14} />}</button>)}</div>;
}

export function AttentionSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="ac-attention-section" aria-label={title}><div className="head"><h3>{title}</h3>{action}</div>{children}</section>;
}
