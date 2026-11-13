/* A note in a row of cards. Styles in foundation/kit.css (`ac-note-card`). */
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../foundation/cn';
import { Icon } from '../foundation/icon';
import { Faces, type AvatarPerson } from '../foundation/people';
import type { Cover } from '../foundation/primitives';

/**
 * A note as a card, in a row of them: its own small sunset as the cover (`cover`, from `coverFor` its ID), the people on
 * the call standing on the cover's lower edge (the first two), or an arch with a microphone for a recording in the room
 * (a camera for a call with nobody else on it), then its title and `when` ("Today · 14 min"). `title` is the link that
 * opens it, and it takes the whole card. `tag` says something on the cover ("Example"), and while the notes are being
 * written (`writing`) the cover breathes.
 */
export function NoteCard({ title, when, cover, people = [], room = false, tag, writing = false, className, ...rest }: {
  title: ReactNode; when: ReactNode; cover: Cover; people?: AvatarPerson[] | undefined; room?: boolean | undefined;
  tag?: string | undefined; writing?: boolean | undefined; className?: string | undefined;
} & Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'className' | 'children'>) {
  const faces = room ? [] : people.slice(0, 2);
  return (
    <div {...rest} className={cn('ac-note-card', writing && 'is-writing', className)}>
      <span className={cn('ac-note-cover', `is-${cover}`)} aria-hidden="true">
        <i className="s" /><i className="w" /><i className="g" /><i className="g b" />{tag && <span className="tag">{tag}</span>}
      </span>
      <span className="ac-note-who" aria-hidden="true">
        {faces.length ? <Faces people={faces} size={28} max={2} /> : <span className="arch"><Icon name={room ? 'mic' : 'video'} size={14} /></span>}
      </span>
      <span className="ac-note-b"><b className="ac-clamp-2">{title}</b><small>{when}</small></span>
    </div>
  );
}
