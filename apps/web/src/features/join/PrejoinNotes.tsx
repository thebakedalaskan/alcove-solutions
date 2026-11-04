/*
 * What the call records, before anyone joins: whether notes are on, and who gets them, said for the person looking.
 * One component for every pre-join, so the organizer, invited people, people signed in and guests all read the same
 * state (the call's capture state takes over here).
 */
import { firstName, type CallNotesStatus, type Person } from '@alcove/api';
import { Icon, NotesSign } from '@alcove/ui';
import { listNames } from '~/lib/people';

/**
 * Who's looking: the organizer (who knows who's invited), someone invited, someone signed in who'll ask (letting them
 * in adds them to the invite), or a guest with only the link.
 */
export type NotesAudience = { kind: 'organizer'; guests: Person[] } | { kind: 'invited' } | { kind: 'asking' } | { kind: 'guest' };

function whoGets(a: NotesAudience, organizer: string): string {
  if (a.kind === 'organizer') return a.guests.length ? `You and ${listNames(a.guests)} get them afterwards.` : 'You get them afterwards.';
  if (a.kind === 'invited') return 'You’re invited, so you get them afterwards.';
  if (a.kind === 'asking') return `Once ${organizer} lets you in, you’re added to the invite and get them.`;
  return 'They go to the people invited.';
}

export function PrejoinNotes({ notes, audience, organizerName }: { notes: CallNotesStatus; audience: NotesAudience; organizerName: string }) {
  const organizer = firstName(organizerName);
  return (
    <div className="pj-notes">
      {notes === 'on' ? <NotesSign stage>Notes are on</NotesSign> : <span className="off"><Icon name="x" size={14} />No notes for this call</span>}
      <p>
        {notes === 'on' ? `${whoGets(audience, organizer)} Alcove can’t read them.`
          : audience.kind === 'organizer' ? 'Nothing is recorded. You can turn notes on during the call.' : `Nothing is recorded unless ${organizer} turns notes on.`}
      </p>
    </div>
  );
}
