/*
 * What the welcome page's night shows, all made up: what the recorder hears in a Thursday session and the notes it leaves
 * (RecordScene), and one note from a call, as you see it and as Alcove's servers hold it (SealedScene).
 */
import type { CastId } from '~/features/notes/cast';

/** What's heard, a line at a time. It doesn't say who spoke. */
export const HEARD = [
  'We did the walk before breakfast, most days.',
  'How did the mornings feel on those days?',
  'Easier. Monday was hard, after a short night.'
] as const;

/** The session's notes, in the format the person recording uses. */
export const SESSION = {
  title: 'Thursday session',
  format: 'Session notes · SOAP',
  when: 'Thu 5 Nov, 17:00 · 50 min',
  uploaded: '50 min · uploaded and sealed',
  checked: 'Written in confidential compute · hardware verified 17:52',
  parts: [
    ['Subjective', 'Mornings feel easier on days that start with a walk. Monday was hard after a short night.'],
    ['Objective', 'On time and engaged. Calm through the session, brighter when talking about the walks.'],
    ['Assessment', 'The new routine is helping. Mornings are still the low point of the week.'],
    ['Plan', 'Keep the morning walk and add two lines in the evening journal. Next session Thu 12 Nov, 17:00.']
  ]
} as const;

/** One part of a note: what it's called, what you see (or who was there), and the sealed record that's all Alcove holds of it. */
interface Held { label: string; plain: string; people?: readonly CastId[] | undefined; sealed: string }

/** A call's note, part by part. */
export const HELD: readonly Held[] = [
  { label: 'Title', plain: 'Design review', sealed: 'title · 46 B · 0b91…77d0' },
  { label: 'People', plain: 'Priya, Kofi, Aiko and you', people: ['priya', 'kofi', 'aiko', 'art'], sealed: 'people · 4 · c2e7…0f13' },
  { label: 'Summary', plain: 'The sidebar stays dark in both themes, and every page keeps one filled button.', sealed: 'summary · 412 B · 7f3a…c21e' },
  { label: 'Decided', plain: 'The sidebar stays dark in both themes', sealed: 'decisions · 2 · 9d44…e1f0' },
  { label: '6:12', plain: 'Priya: “Then the sidebar stays dark in both themes.”', sealed: 'transcript · 38 lines · 51ab…93c4' },
  { label: 'Audio', plain: '45 min recording', sealed: 'audio · 542 pieces · 26.8 MB' }
];
