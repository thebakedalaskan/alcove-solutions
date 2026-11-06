/*
 * What the call captures and who gets the notes, before anyone joins: the call's capture summary (the same for
 * everyone, from `@alcove/ui`), with who gets the notes said for the person looking. One component for every pre-join.
 */
import { firstName, type CaptureState, type NotesChoices, type NotesSetting, type Person } from '@alcove/api';
import { CaptureSummary } from '@alcove/ui';
import { listNames } from '~/lib/people';

/**
 * Who's looking: the organizer (who knows who's invited), someone invited, someone signed in whom letting in adds to
 * the invite, or a guest (no account, or one the notes can't go to), who reads the general line.
 */
export type NotesAudience = { kind: 'organizer'; guests: Person[] } | { kind: 'invited' } | { kind: 'asks' } | { kind: 'guest' };

function whoGets(a: NotesAudience, organizer: string): string | undefined {
  if (a.kind === 'organizer') return a.guests.length ? `You and ${listNames(a.guests)} get them.` : 'You get them.';
  if (a.kind === 'invited') return 'You’re invited, so you get them.';
  if (a.kind === 'asks') return `Once ${organizer} lets you in, you’re added to the invite and get them.`;
  return undefined;
}

/** `taker`: whose browser takes the notes, "the host" while someone stands in for the organizer. */
export function PrejoinCapture({ notes, choices, capture, audience, organizerName, taker }: { notes: NotesSetting; choices: NotesChoices; capture: CaptureState | null; audience: NotesAudience; organizerName: string; taker?: string | undefined }) {
  return <CaptureSummary notes={notes} choices={choices} capture={capture} who={whoGets(audience, firstName(organizerName))} taker={taker} />;
}
