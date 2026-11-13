/*
 * What the search stories share: the demo world's calls as Search or ask finds them, in the design canvas's words
 * (docs/design/canvas/Search.dc.html): Art's call with Ines, the team standup where the new onboarding was set to ship
 * behind a flag, the pricing sync, the design review and launch planning. Everyone is the world's made-up people. The
 * palette's parts only draw: a story gives each what the app would, with the words already marked, and draws the rows'
 * own elements as the app does (a `div role="option"` with `paletteRow`).
 */
import {
  EmptyState, Icon, PaletteCallHead, PaletteGroup, PaletteMomentLine, PaletteMoreLine, cn, coverFor, paletteRow, type AvatarPerson, type Cover, type IconName,
  type PaletteMadeKind, type PaletteRowKind
} from '@alcove/ui';
import { Fragment, type ReactNode } from 'react';
import { did } from '../../../src/component';
import { AIKO, ART, DIEGO, INES, KOFI, LENA, MAYA, PRIYA } from '../../../src/world/people';

/** You, as a line of what was said names you. */
export const YOU: AvatarPerson = { ...ART, name: 'You' };

/** "3:15", as the app writes a moment. */
export const clock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const at = (m: number, s: number): number => m * 60 + s;

/** Every word of a search marked where it shows, each word whole, as the app marks them. */
export function marked(text: string, words: readonly string[]): ReactNode {
  if (!words.length) return text;
  const literally = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${words.map((w) => `${literally(w)}[\\p{L}\\p{N}]*`).join('|')})`, 'giu');
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>));
}

/** A line of what was said: who, when, the words, and what it became in the notes. */
export interface Said { at: number; person: AvatarPerson; text: string; made?: PaletteMadeKind | undefined }
/** A call with notes, as the palette shows it. */
export interface Call {
  id: string; title: string; day: string; when: string; length: string; people: AvatarPerson[]; room?: boolean | undefined;
  summary: string; confirm: number; followUps: number; said: Said[];
}

export const ARTS_CALL: Call = {
  id: 'n1', title: 'Art’s call', day: 'Today', when: 'Today at 11:58', length: '14 min', people: [INES],
  summary: 'Art walks Ines through moving the warehouse to the new site, from booking the movers to which suppliers come too. They agree that orders placed before the move ship from the old warehouse, and that the order page shows the new delivery times once the date is set.',
  confirm: 1, followUps: 2,
  said: [
    { at: at(4, 10), person: INES, text: 'Book the movers first. Nothing else can be planned until we have a date, and the order page can wait a week.', made: 'follow-up' },
    { at: at(6, 12), person: INES, text: 'Orders placed before the move have to ship from the old warehouse, or customers wait twice.', made: 'decision' }
  ]
};
export const STANDUP: Call = {
  id: 'n2', title: 'Team standup', day: 'Today', when: 'Today at 09:00', length: '20 min', people: [PRIYA, KOFI, MAYA],
  summary: 'The new onboarding ships behind a flag on 12 November, and support gets the help article first. Kofi flagged two items still open on the launch checklist, to look at before the design review.',
  confirm: 1, followUps: 2,
  said: [
    { at: at(1, 48), person: KOFI, text: 'Agreed. Put it behind a flag and we can watch the first few hundred people go through it.' },
    { at: at(2, 36), person: MAYA, text: 'Does the flag change anything for the trial numbers? I’m closing the month on the twelfth.' },
    { at: at(2, 55), person: PRIYA, text: 'No. Same plans, same trial. Only the first run changes.' },
    { at: at(3, 15), person: YOU, text: 'Then let’s say it. The new onboarding ships behind a flag on 12 November.', made: 'decision' },
    { at: at(3, 31), person: KOFI, text: 'Twelfth works for design.' },
    { at: at(5, 40), person: MAYA, text: 'They’ll get the questions on day one, whatever we do.' },
    { at: at(6, 2), person: YOU, text: 'So support gets the help article before the flag goes on. Before, not the same day.', made: 'decision' },
    { at: at(6, 20), person: PRIYA, text: 'I’ll write it. Friday at the latest.', made: 'follow-up' },
    { at: at(7, 5), person: MAYA, text: 'Who tells existing customers, though? Is that an email, or a note in the app?' },
    { at: at(10, 5), person: KOFI, text: 'I’ll add the flag to the rollout plan, so it goes on with the rest.', made: 'follow-up' }
  ]
};
export const PRICING: Call = {
  id: 'n3', title: 'Pricing sync', day: 'Yesterday', when: 'Yesterday at 15:00', length: '34 min', people: [MAYA, LENA, YOU],
  summary: 'Maya compares seat pricing with usage pricing, and everyone leans towards minutes of notes as the thing people pay for. The team plan gets a monthly option, and free minutes stay as they are.',
  confirm: 0, followUps: 1,
  said: [
    { at: at(4, 20), person: MAYA, text: 'Seats or usage: everyone leans towards minutes of notes as the thing people pay for.' },
    { at: at(12, 48), person: MAYA, text: 'The team plan gets a monthly option, because nobody wants to commit for a year.', made: 'decision' },
    { at: at(28, 15), person: MAYA, text: 'Keep the monthly option behind a flag until the launch.' }
  ]
};
export const DESIGN: Call = {
  id: 'n4', title: 'Design review', day: 'Yesterday', when: 'Yesterday at 11:00', length: '46 min', people: [KOFI, PRIYA, AIKO],
  summary: 'Kofi walks through the sidebar in both themes, and it reads better dark. The team agrees on one filled button per view, and Aiko finds three on the pricing page.',
  confirm: 0, followUps: 0,
  said: [{ at: at(38, 10), person: KOFI, text: 'The new empty states can ride the same flag.' }]
};
export const LAUNCH: Call = {
  id: 'n7', title: 'Launch planning', day: 'Tue 27 Oct', when: 'Tuesday 27 October at 16:00', length: '25 min', people: [PRIYA, INES],
  summary: 'The launch moves to the 18th so the onboarding flag has a week to settle. Sign-ups are back up after the pricing change.',
  confirm: 0, followUps: 0,
  said: [{ at: at(6, 30), person: PRIYA, text: 'The launch moves to the 18th, so the onboarding flag has a week to settle.', made: 'decision' }]
};
/** An interview recorded in the room, and an intro call: notes with no line of the words they're found by. */
export const INTERVIEW: Call = {
  id: 'n5', title: 'Interview: Jonas Weber', day: 'Mon', when: 'Monday at 14:10', length: '52 min', people: [], room: true,
  summary: 'Jonas is strong on distributed systems and wants to stay close to customers.', confirm: 0, followUps: 1, said: []
};
export const HARBOURLINE: Call = {
  id: 'n10', title: 'Harbourline intro', day: '14 Oct', when: 'Wednesday 14 October at 11:00', length: '28 min', people: [PRIYA, DIEGO],
  summary: 'Harbourline cares where the notes are written and who can read them.', confirm: 0, followUps: 0, said: []
};

/** The notes, newest first. */
export const NOTES: readonly Call[] = [ARTS_CALL, STANDUP, PRICING, DESIGN, INTERVIEW, LAUNCH, HARBOURLINE];
/** The people Art has most calls with, before anything's typed. */
export const PEOPLE: readonly AvatarPerson[] = [MAYA, PRIYA, KOFI, AIKO, LENA];
/** How many notes Art has, for what Ask and Nothing matches say. */
export const NOTE_COUNT = 11;

export const coverOf = (c: Call): Cover => coverFor(c.id);
/** "1 moment", "9 moments". */
export const plural = (n: number, word: string): string => `${n} ${n === 1 ? word : `${word}s`}`;
/** The first word of someone's name. */
export const first = (p: AvatarPerson): string => p.name.split(' ')[0] ?? p.name;
/** What a note's row says under its title, as the app's noteLine does: "Mon · In the room", or just the day. */
export const noteLine = (c: Call): string => (c.room ? `${c.day} · In the room` : c.day);

/** The lines of a call that have the words, in time order. */
export const found = (c: Call, words: readonly string[]): Said[] => c.said.filter((l) => words.every((w) => l.text.toLowerCase().includes(w)));

/** A row's own element, as the app draws it when it isn't a link: an option, lit or not. */
export function Row({ kind, lit = false, label, children }: { kind: PaletteRowKind; lit?: boolean | undefined; label?: string | undefined; children: ReactNode }) {
  return <div role="option" aria-selected={lit} aria-label={label} tabIndex={-1} className={paletteRow(kind, lit)} onClick={did(`open ${kind}`)}>{children}</div>;
}

/**
 * Nothing to list, as the app draws it (shell/palette/Results.tsx): the kit's EmptyState, its art a dashed arch around
 * `icon`, with className="pal-none"; `caution` for a search that didn't go through.
 */
export function Nothing({ icon, caution = false, title, action, children }: { icon: IconName; caution?: boolean | undefined; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <EmptyState className={cn('pal-none', caution && 'is-caution')} art={<span className="pal-none-arch" aria-hidden="true"><Icon name={icon} size={22} /></span>} title={title} action={action}>
      {children}
    </EmptyState>
  );
}

/** A list of rows, as the window's list pane holds them. */
export const Listbox = ({ label, children }: { label: string; children: ReactNode }) => <div role="listbox" aria-label={label}>{children}</div>;

/** A call's head and the moments in it that have the words, the `lit` one lit, with "N more" when `shown` hides some. */
export function CallMoments({ call, words, lit, shown, made = true, markName = false }: {
  call: Call; words: readonly string[]; lit?: number | undefined; shown?: number | undefined; made?: boolean | undefined; markName?: boolean | undefined;
}) {
  const lines = words.length ? found(call, words) : call.said;
  const visible = shown === undefined ? lines : lines.slice(0, shown);
  return (
    <>
      <PaletteCallHead cover={coverOf(call)} room={call.room} title={call.title} meta={call.day} />
      {visible.map((l) => (
        <Row key={l.at} kind="moment" lit={lit === l.at}>
          <PaletteMomentLine person={l.person} name={markName ? marked(first(l.person), words) : first(l.person)} made={made ? l.made : undefined} time={clock(l.at)}>{marked(l.text, words)}</PaletteMomentLine>
        </Row>
      ))}
      {visible.length < lines.length && <Row kind="more"><PaletteMoreLine>{lines.length - visible.length} more in {call.title}</PaletteMoreLine></Row>}
    </>
  );
}

/** What was said, as a group: its label and how many moments in how many calls. */
export function SaidGroup({ label, calls, words, children }: { label: string; calls: readonly Call[]; words: readonly string[]; children: ReactNode }) {
  const moments = calls.reduce((n, c) => n + found(c, words).length, 0);
  return <PaletteGroup label={label} count={`${plural(moments, 'moment')} in ${plural(calls.length, 'call')}`}>{children}</PaletteGroup>;
}
