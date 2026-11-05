/*
 * Notes in every state a note can be in, and the series their calls belong to, for the stories that show them: a call
 * still going, notes being written again, a line corrected since they were written, notes that couldn't be written, a
 * call where nothing was said, one that kept neither its transcript nor its recording, breakout rooms, a decision someone
 * says wasn't decided, and four series. `inEveryState` puts them all into a story's world. All made up.
 */
import type { Meeting, Note, NoteRoom, Person } from '@alcove/api';
import type { World } from '.';
import { call, changer, writeNote, type NoteSpec } from './build';
import { iso } from './clock';
import { AIKO, ART, DIEGO, INES, KOFI, LENA, MAYA, PRIYA } from './people';

/* ---------- a note in each state ---------- */

/** Priya's launch check-in, going on now: its notes record as the call goes, and are written once it ends. */
const going: NoteSpec = { id: 'n-going', title: 'Launch check-in', status: 'recording', startedAt: iso(0, 16, 0), minutes: 0, organizer: PRIYA, invited: [ART, KOFI, AIKO, MAYA], excerpt: '' };

/** The support handover this afternoon: a line was corrected, and its notes are being written again from the transcript. */
const handover: NoteSpec = {
  id: 'n-again', title: 'Support handover', startedAt: iso(0, 13, 30), minutes: 22, organizer: ART, invited: [MAYA, DIEGO],
  excerpt: 'Support takes over the Harbourline account on Monday, and the refund wording changes for everyone.',
  summary: 'Diego hands the Harbourline account to support from Monday. The refund wording changes for every customer, and Maya checks it against the new terms before it goes out.',
  chapters: [['00:00', 'The account', 'Support takes over on Monday.'], ['09:40', 'Refunds', 'The wording changes for everyone.']],
  said: [
    { at: '00:30', who: DIEGO, text: 'From Monday the Harbourline account sits with support, not with me.' },
    { at: '04:12', who: ART, text: 'Then support needs the history: every call, every promise we made them.' },
    { at: '09:40', who: MAYA, text: 'The refund wording changes for everyone, not just Harbourline.' },
    { at: '15:05', who: MAYA, text: 'I’ll check the new wording against the terms before it goes out.' }
  ],
  decisions: [{ id: 'n-again-d1', text: 'Support takes over the Harbourline account on Monday.', at: '00:30', state: 'confirmed', by: ART }],
  actions: [{ id: 'n-again-a1', text: 'Check the refund wording against the new terms', at: '15:05', owner: MAYA, takenOn: true, due: 'Friday' }]
};

/** The hiring sync: Lena corrected a line after the notes were written, so Art can have them written again. */
const hiring: NoteSpec = {
  id: 'n-corrected', title: 'Hiring sync', startedAt: iso(0, 11, 0), minutes: 25, organizer: ART, invited: [PRIYA, LENA],
  excerpt: 'Two offers go out this week. The research role stays open until January.',
  summary: 'Two offers go out this week, both for engineering. The research role stays open until January, and Lena writes up what the last three interviews had in common.',
  chapters: [['00:00', 'Offers', 'Two go out this week.'], ['12:30', 'Research', 'The role stays open until January.']],
  said: [
    { id: 'n-corrected-l1', at: '01:05', who: PRIYA, text: 'Both engineering offers go out this week. The references came back yesterday.' },
    { id: 'n-corrected-l2', at: '12:30', who: LENA, text: 'The research role stays open until February. Nobody so far has done field work.' },
    { id: 'n-corrected-l3', at: '18:45', who: LENA, text: 'I’ll write up what the last three interviews had in common.' }
  ],
  decisions: [{ id: 'n-corrected-d1', text: 'Both engineering offers go out this week.', at: '01:05', state: 'confirmed', by: PRIYA }],
  questions: [{ id: 'n-corrected-q1', text: 'Should the research role be open to people outside Europe?', at: '12:30' }],
  actions: [{ id: 'n-corrected-a1', text: 'Write up what the last three interviews had in common', at: '18:45', owner: LENA, takenOn: true, due: 'Monday' }]
};

/** A call with Diego where the summary couldn't be written: the transcript is kept, and Art can try again. */
const supplier: NoteSpec = {
  id: 'n-unwritten', title: 'Supplier call', startedAt: iso(0, 10, 0), minutes: 18, organizer: ART, invited: [DIEGO], excerpt: '', summary: '',
  said: [
    { at: '00:40', who: DIEGO, text: 'They can deliver the new racking on the 14th, but only in the morning.' },
    { at: '06:15', who: ART, text: 'Mornings are fine. The loading bay is empty until eleven.' },
    { at: '11:50', who: DIEGO, text: 'I’ll send them the bay’s measurements today.' }
  ]
};

/** A two-minute call with Kofi where nobody said anything while notes were on. */
const quiet: NoteSpec = { id: 'n-quiet', title: 'Quick sync', startedAt: iso(0, 14, 50), minutes: 2, organizer: ART, invited: [KOFI], excerpt: '', summary: '' };

/** A call set up to keep neither its transcript nor its recording: only the notes written from them are left. */
const offer: NoteSpec = {
  id: 'n-unkept', title: 'Offer review', startedAt: iso(-1, 17, 0), minutes: 30, organizer: ART, invited: [INES], kept: { transcript: false, recording: false },
  excerpt: 'The offer goes out on Friday, with the start date left open.',
  summary: 'Ines and Art agree the offer goes out on Friday, with the start date left open so the candidate can finish their notice.',
  decisions: [{ id: 'n-unkept-d1', text: 'The offer goes out on Friday.', state: 'confirmed', by: INES }],
  actions: [{ id: 'n-unkept-a1', text: 'Send the offer letter', owner: ART, takenOn: true, due: 'Friday' }]
};

/** The launch go/no-go: Priya confirmed the date, and Kofi says it wasn't decided, so Art, who organized it, settles it. */
const goNoGo: NoteSpec = {
  id: 'n-disputed', title: 'Launch go/no-go', startedAt: iso(0, 14, 0), minutes: 28, organizer: ART, invited: [PRIYA, KOFI, MAYA],
  excerpt: 'The launch stays on the 18th, if support has two more people for launch week.',
  summary: 'The launch stays on the 18th, as long as support has two more people for launch week. Kofi isn’t sure the date was agreed before the support question was settled.',
  chapters: [['00:00', 'The date', 'It stays on the 18th.'], ['14:20', 'Support', 'Two more people for launch week.']],
  said: [
    { at: '02:10', who: PRIYA, text: 'So the launch stays on the 18th. Nothing we’ve heard moves it.' },
    { at: '05:45', who: KOFI, text: 'I’d hold off saying that until we know support can cope.' },
    { at: '14:20', who: MAYA, text: 'Support gets two more people for launch week, from the night shift.' },
    { at: '22:30', who: ART, text: 'I’ll tell the night shift lead today.' }
  ],
  decisions: [
    { id: 'n-disputed-d1', text: 'The launch stays on the 18th.', at: '02:10', state: 'confirmed', by: PRIYA },
    { id: 'n-disputed-d2', text: 'Support gets two more people for launch week.', at: '14:20', state: 'proposed' }
  ],
  actions: [{ id: 'n-disputed-a1', text: 'Tell the night shift lead about launch week', at: '22:30', owner: ART, due: 'Today' }]
};

/* ---------- breakout rooms ---------- */

const workshop: NoteSpec = {
  id: 'n-rooms', title: 'Planning workshop', startedAt: iso(-1, 13, 0), minutes: 40, organizer: ART, invited: [PRIYA, KOFI, AIKO, MAYA, LENA],
  excerpt: 'Onboarding and pricing each went to a room. Both come back with one thing to do before the launch.',
  summary: 'The team split into two rooms for twenty minutes: onboarding, and pricing. Onboarding keeps the new first run behind the flag; pricing asks whether the monthly option needs its own page. Everyone agreed to meet again on Monday.',
  chapters: [['00:00', 'What we’re here for', 'Two questions, one room each.'], ['08:00', 'Breakout rooms', 'Onboarding and pricing.'], ['30:30', 'Back together', 'One thing each before the launch.']],
  said: [
    { at: '00:40', who: ART, text: 'Two questions today, so two rooms: onboarding, and pricing. Twenty minutes each.' },
    { at: '31:10', who: PRIYA, text: 'Onboarding’s settled: the new first run stays behind the flag until launch.' },
    { at: '33:25', who: MAYA, text: 'Pricing has one question left: does the monthly option need its own page?' },
    { at: '38:40', who: ART, text: 'Let’s meet again on Monday with both answers.' }
  ],
  decisions: [{ id: 'n-rooms-d1', text: 'We meet again on Monday with both answers.', at: '38:40', state: 'confirmed', by: ART }]
};

/** A breakout room's section, written from what was said in it alone. */
function room(id: string, name: string, people: readonly Person[], from: string, to: string, spec: Omit<NoteSpec, 'id' | 'title' | 'startedAt' | 'minutes' | 'organizer'>): NoteRoom {
  const n = writeNote({ ...spec, id: `${workshop.id}-${id}`, title: name, startedAt: workshop.startedAt, minutes: workshop.minutes, organizer: ART });
  const seconds = (t: string) => t.split(':').reduce((s, p) => s * 60 + Number(p), 0);
  return {
    id, name, people: people.map((p) => ({ name: p.name, person: p })), from: seconds(from), to: seconds(to), summary: n.summary,
    decisions: n.decisions, questions: n.questions, actions: n.actions, chapters: n.chapters, gaps: [], transcript: (n.transcript ?? []).map((l) => ({ ...l, room: { id, name } }))
  };
}
const ROOMS = (): NoteRoom[] => [
  room('room-onboarding', 'Onboarding', [PRIYA, KOFI, AIKO], '08:00', '28:00', {
    excerpt: 'The new first run stays behind the flag until launch.',
    summary: 'The new first run stays behind the flag until launch. Aiko adds a way to turn it off for one account, for support.',
    said: [
      { at: '08:30', who: PRIYA, text: 'If the first run breaks, it’s the first thing anyone sees. It stays behind the flag.' },
      { at: '15:10', who: AIKO, text: 'Support will want to turn it off for one account. I’ll add that.' },
      { at: '22:40', who: KOFI, text: 'Agreed. Behind the flag until launch, then on for everyone.' }
    ],
    decisions: [{ id: 'room-onboarding-d1', text: 'The new first run stays behind the flag until launch.', at: '22:40', state: 'confirmed', by: PRIYA }],
    actions: [{ id: 'room-onboarding-a1', text: 'Add a way to turn the first run off for one account', at: '15:10', owner: AIKO, takenOn: true, due: 'Friday' }]
  }),
  room('room-pricing', 'Pricing', [ART, MAYA, LENA], '08:00', '28:00', {
    excerpt: 'Does the monthly option need its own page?',
    summary: 'The monthly option goes out with the launch. Whether it needs its own page is still open, and Lena asks three customers.',
    said: [
      { at: '09:05', who: MAYA, text: 'The monthly option goes out with the launch, at the same price per minute.' },
      { at: '17:30', who: LENA, text: 'Nobody can tell me whether it needs its own page. I’ll ask three customers.' },
      { at: '24:15', who: ART, text: 'Let’s not decide the page until Lena has heard back.' }
    ],
    questions: [{ id: 'room-pricing-q1', text: 'Does the monthly option need its own page?', at: '24:15' }],
    actions: [{ id: 'room-pricing-a1', text: 'Ask three customers about a page for the monthly option', at: '17:30', owner: LENA, takenOn: true, due: 'Monday' }]
  })
];

/* ---------- series ---------- */

/** The two standups before today's, a week apart: what they decided and left open carries over. */
const standups: NoteSpec[] = [
  {
    id: 'n2-w1', title: 'Team standup', startedAt: iso(-7, 9, 0), minutes: 18, organizer: ART, invited: [PRIYA, KOFI, MAYA], seriesId: 's-standup',
    excerpt: 'The flag is called new-first-run. Legal looks at the consent copy before it ships.',
    said: [
      { at: '02:20', who: KOFI, text: 'Let’s call the flag new-first-run, so support can find it.' },
      { at: '08:05', who: PRIYA, text: 'Legal should see the consent copy before it ships. Someone has to ask them.' },
      { at: '12:40', who: MAYA, text: 'Which plan gets the new onboarding first, the team plan or everyone?' }
    ],
    decisions: [{ id: 'n2-w1-d1', text: 'The onboarding flag is called new-first-run.', at: '02:20', state: 'confirmed', by: KOFI }],
    questions: [{ id: 'n2-w1-q1', text: 'Which plan gets the new onboarding first?', at: '12:40' }],
    actions: [{ id: 'n2-w1-a1', text: 'Ask legal to look at the consent copy', at: '08:05', owner: PRIYA, due: 'Next week' }]
  },
  {
    id: 'n2-w2', title: 'Team standup', startedAt: iso(-14, 9, 0), minutes: 21, organizer: ART, invited: [PRIYA, KOFI, MAYA], seriesId: 's-standup',
    excerpt: 'Usability sessions start in two weeks. Nobody knows yet whether existing teams need a guide.',
    said: [
      { at: '03:30', who: ART, text: 'I’ll book the usability sessions for the week after next.' },
      { at: '10:15', who: MAYA, text: 'Do existing teams need a migration guide, or does the first run cover it?' },
      { at: '16:50', who: PRIYA, text: 'Five sessions is enough. More than that and we hear the same thing.' }
    ],
    decisions: [{ id: 'n2-w2-d1', text: 'Five usability sessions, no more.', at: '16:50', state: 'confirmed', by: PRIYA }],
    questions: [{ id: 'n2-w2-q1', text: 'Do existing teams need a migration guide?', at: '10:15' }],
    actions: [{ id: 'n2-w2-a1', text: 'Book the usability sessions', at: '03:30', owner: ART, takenOn: true, due: 'Friday next week' }]
  }
];

/** The pricing sync Maya runs every week, the one before yesterday's: Art is invited, so it's her series. */
const pricingBefore: NoteSpec = {
  id: 'n3-w1', title: 'Pricing sync', startedAt: iso(-8, 15, 0), minutes: 30, organizer: MAYA, invited: [ART, LENA], seriesId: 's-pricing',
  excerpt: 'Seats stay off the price list. Lena asks three teams what a minute of notes is worth.',
  said: [
    { at: '06:40', who: MAYA, text: 'Seats stay off the price list. People pay for minutes of notes.' },
    { at: '19:20', who: LENA, text: 'I’ll ask three teams what a minute of notes is worth to them.' }
  ],
  decisions: [{ id: 'n3-w1-d1', text: 'Seats stay off the price list.', at: '06:40', state: 'confirmed', by: MAYA }],
  actions: [{ id: 'n3-w1-a1', text: 'Ask three teams what a minute of notes is worth', at: '19:20', owner: LENA, takenOn: true, due: 'Monday' }]
};

/** The design review the week before yesterday's: with yesterday's, a series Art runs with nothing scheduled next. */
const reviewBefore: NoteSpec = {
  id: 'n4-w1', title: 'Design review', startedAt: iso(-8, 11, 0), minutes: 40, organizer: ART, invited: [PRIYA, KOFI, AIKO], seriesId: 's-design',
  excerpt: 'Empty states use the arch, never a photo. The sidebar gets a second look in dark.',
  said: [
    { at: '05:15', who: KOFI, text: 'Empty states use the arch, never a photo of a person.' },
    { at: '27:40', who: AIKO, text: 'I’ll mock up the sidebar dark, in both themes, for next time.' }
  ],
  decisions: [{ id: 'n4-w1-d1', text: 'Empty states use the arch, never a photo.', at: '05:15', state: 'confirmed', by: KOFI }],
  actions: [{ id: 'n4-w1-a1', text: 'Mock up the sidebar dark, in both themes', at: '27:40', owner: AIKO, takenOn: true, done: true }]
};

/** The first call of a new hiring panel series, its notes still being written. */
const panel: NoteSpec = {
  id: 'n-panel', title: 'Hiring panel', status: 'pending', startedAt: iso(0, 15, 0), minutes: 35, organizer: ART, invited: [INES, LENA], seriesId: 's-panel',
  excerpt: '', said: [{ at: '01:00', who: INES, text: 'Let’s agree what we’re looking for before the first interview.' }]
};

/** Yesterday's design review, which the series schedules its next call from. */
const REVIEWED: Meeting = call({ id: 'm-review-was', title: 'Design review', startsAt: iso(-1, 11, 0), minutes: 45, code: 'dsn-revw-was', guests: [PRIYA, KOFI, AIKO], status: 'ended', seriesId: 's-design', noteId: 'n4' });

/* ---------- into a world ---------- */

/** A note as you read it, with what a note in that state has that `writeNote` doesn't write. */
function inState(s: NoteSpec): Note {
  const n = writeNote(s);
  // Twelve minutes in: the audio so far plays, and the line ends where the recording has got to.
  if (s.id === going.id) return { ...n, audio: [{ index: 0, seconds: 12 * 60, pieces: 144, mimeType: 'audio/webm;codecs=opus' }] };
  if (s.id === handover.id) return { ...n, writingAgain: true };
  if (s.id === hiring.id) {
    return {
      ...n, transcript: (n.transcript ?? []).map((l) => (l.id !== 'n-corrected-l2' ? l : {
        ...l, changes: [{ by: changer(LENA, 'invited'), at: iso(0, 14, 5), what: 'reworded', before: 'The research role stays open until January.', after: l.text }]
      }))
    };
  }
  if (s.id === goNoGo.id) {
    return {
      ...n, decisions: n.decisions.map((d) => (d.id !== 'n-disputed-d1' ? d : {
        ...d, disputes: [{ by: changer(KOFI, 'invited'), at: iso(0, 15, 5) }], changes: [...d.changes, { by: changer(KOFI, 'invited'), at: iso(0, 15, 5), what: 'disputed' }]
      }))
    };
  }
  if (s.id === workshop.id) return { ...n, rooms: ROOMS() };
  return n;
}

const EVERY: readonly NoteSpec[] = [going, handover, hiring, supplier, quiet, offer, goNoGo, workshop, ...standups, pricingBefore, reviewBefore, panel];
const newestFirst = (a: Note, b: Note) => b.startedAt.localeCompare(a.startedAt);

/** Only these notes, of the ones in every state, in a story's world: the rest of it stays as the scenario has it. */
export const withNotes = (...ids: string[]) => (w: World): void => {
  w.notes = [...w.notes, ...EVERY.filter((s) => ids.includes(s.id)).map(inState)].sort(newestFirst);
};

/** The notes in every state, the series and the call one is scheduled from, in a story's world; newest first, as the world keeps them. */
export function inEveryState(w: World): void {
  const fresh = EVERY.map(inState);
  const inSeries: Readonly<Record<string, Partial<Note>>> = { n2: { seriesId: 's-standup' }, n3: { seriesId: 's-pricing' }, n4: { seriesId: 's-design', meetingId: REVIEWED.id } };
  w.notes = [...w.notes.map((n) => ({ ...n, ...inSeries[n.id] })), ...fresh].sort(newestFirst);
  w.meetings = [...w.meetings, REVIEWED];
}

/** Which note shows each state. */
export const STATES = {
  going: going.id, again: handover.id, corrected: hiring.id, unwritten: supplier.id, quiet: quiet.id, unkept: offer.id, disputed: goNoGo.id, rooms: workshop.id
} as const;
/** The series: Art's standup with a call next week, Maya's pricing sync, Art's design review with nothing next, and a panel being written. */
export const SERIES = { standup: 's-standup', pricing: 's-pricing', design: 's-design', panel: 's-panel' } as const;
