/* A call's notes as one panel. Styles in foundation/kit.css (`ac-notes`, `ac-note-row`). */
import type { ReactNode } from 'react';
import { cn } from '../foundation/cn';
import { Icon } from '../foundation/icon';
import { Avatar, type AvatarPerson } from '../foundation/people';

/** A call's notes: a head with the title and meta, labelled sections, and a footer. */
export function NotesPanel({ title, meta, end, children, foot, className }: { title: ReactNode; meta?: ReactNode; end?: ReactNode; children: ReactNode; foot?: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn('ac-notes', className)}>
      <div className="ac-notes-head"><div><div className="t">{title}</div>{meta && <div className="m">{meta}</div>}</div>{end && <span className="end">{end}</span>}</div>
      <div className="ac-notes-body">{children}</div>
      {foot && <div className="ac-notes-foot">{foot}</div>}
    </div>
  );
}
export function NotesSection({ label, children }: { label: string; children: ReactNode }) {
  return <div><div className="ac-eyebrow">{label}</div>{children}</div>;
}
/** One row of notes: a decision gets a tick, a follow-up its owner. New rows rise in. */
export function NoteRow({ owner, isNew = false, children }: { owner?: AvatarPerson | undefined; isNew?: boolean; children: ReactNode }) {
  return (
    <div className={cn('ac-note-row', isNew && 'is-new')}>
      {owner ? <span className="ac-owner"><Avatar person={owner} size={18} />{owner.name.split(' ')[0] ?? owner.name}</span> : <span className="ac-tick"><Icon name="check" size={13} /></span>}
      <span>{children}</span>
    </div>
  );
}
