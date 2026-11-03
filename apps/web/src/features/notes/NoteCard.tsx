/*
 * The example note: a call's notes as they look when they're done. Home shows it before someone has
 * notes of their own, and the first sign-in flies it there.
 */
import { Chip, Faces, NoteRow, NotesPanel, NotesSection, SealedBadge, type AvatarPerson } from '@alcove/ui';
import { CAST } from './cast';

/** The promise, in the same words everywhere. */
export const PROMISE = 'Written in confidential compute. Alcove can’t read it.';
export const PROMISE_MANY = 'Written in confidential compute. Alcove can’t read them.';

export const EXAMPLE_SUMMARY = 'Sign-ups are back up, and the launch moves to the 18th.';

export function NoteCard({ you, example = false, className }: {
  /** The signed-in person, who is one of the call's people. */
  you?: AvatarPerson | null | undefined;
  example?: boolean;
  className?: string;
}) {
  const people: AvatarPerson[] = [CAST.theo, CAST.priya, CAST.kofi, ...(you ? [you] : [])];
  return (
    <NotesPanel className={className} title="Weekly product call" meta="Today · 24 min"
      end={example ? <Chip tone="sun">Example</Chip> : <Chip tone="sun" icon="check">Ready</Chip>}
      foot={<><SealedBadge inline title={PROMISE} /><Faces people={people} size={20} className="ml-auto" /></>}>
      <NotesSection label="Summary"><p className="ac-summary">{EXAMPLE_SUMMARY}</p></NotesSection>
      <NotesSection label="Decided"><NoteRow>Launch moves to the 18th.</NoteRow></NotesSection>
      <NotesSection label="Follow-ups"><NoteRow owner={CAST.kofi}>Send the new screens · Wed</NoteRow></NotesSection>
    </NotesPanel>
  );
}
