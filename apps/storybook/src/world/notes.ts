/*
 * The notes of the demo world, as the design canvas tells them (docs/design/canvas/appdata.js, data-notes.js and
 * data-note.js): what each call was, who has it, what was said and what the notes wrote down. All made up. Times are on
 * the demo clock: day 0 is Wednesday 4 November 2026, -1 the Tuesday before, and so on.
 */
import type { Note, NoteAddition, PersonalEntry, ScreenMoment } from '@alcove/api';
import { iso } from './clock';
import { mmss, writeNote, type NoteSpec } from './build';
import { AIKO, ART, DIEGO, INES, KOFI, LENA, MAYA, PRIYA } from './people';

/* Art's call, today at 11:58: the warehouse move. Everything still waits on Art. */
const artsCall: NoteSpec = {
  id: 'n1', title: 'Art’s call', startedAt: iso(0, 11, 58), minutes: 14, organizer: ART, invited: [INES],
  excerpt: 'Orders before the move ship from the old warehouse, and the movers come first.',
  summary: 'Art walks Ines through moving the warehouse to the new site, from booking the movers to which suppliers come too. They agree that orders placed before the move ship from the old warehouse, and that the order page shows the new delivery times once the date is set.',
  chapters: [['00:00', 'The plan', 'Moving the warehouse by the end of the month.'], ['04:10', 'Movers and dates', 'Book the movers before anything else.'], ['09:32', 'The order page', 'New delivery times once the date is set.']],
  said: [
    { at: '00:40', who: ART, text: 'The plan is to move the warehouse to the new site by the end of the month.' },
    { at: '04:10', who: INES, text: 'Book the movers first. Nothing else can be planned until we have a date, and the order page can wait a week.' },
    { at: '04:52', who: ART, text: 'I’ll list which suppliers move with us, so nobody’s caught out.' },
    { at: '06:12', who: INES, text: 'Orders placed before the move have to ship from the old warehouse, or customers wait twice.' },
    { at: '09:32', who: ART, text: 'Let’s update the delivery times on the order page once the date’s set.' }
  ],
  decisions: [{ id: 'n1-d1', text: 'Orders placed before the move ship from the old warehouse.', at: '06:12', state: 'proposed' }],
  actions: [
    { id: 'n1-a1', text: 'Book the movers for the 14th', at: '04:10', owner: ART, due: 'Friday' },
    { id: 'n1-a2', text: 'List which suppliers move with us', at: '04:52', owner: ART, due: 'Monday' },
    { id: 'n1-a3', text: 'Update the delivery times on the order page', at: '09:32', owner: ART }
  ]
};

/* Team standup, this morning at 09:00, written out in full as the canvas's note board has it. */
export const LAUNCH_CHECKLIST: ScreenMoment = {
  id: 'n2-s1', at: mmss('08:52'), until: mmss('10:05'), presenter: { name: KOFI.name, person: KOFI }, share: 'TR_kofi1', width: 1920, height: 1080,
  legible: 'clear', title: 'Launch checklist',
  text: 'Launch checklist\nHelp article for support\nFlag in the rollout plan\nEmpty state on the team page',
  description: 'Kofi’s launch checklist, with two of its items still open: the empty state on the team page and the flag’s name in the rollout plan.',
  regions: [{ label: 'The open items', x: 0.05, y: 0.3, w: 0.6, h: 0.4 }]
};
const standup: NoteSpec = {
  id: 'n2', title: 'Team standup', startedAt: iso(0, 9, 0), minutes: 20, organizer: ART, invited: [PRIYA, KOFI, MAYA],
  excerpt: 'The new onboarding ships behind a flag on 12 November, and support gets the help article first.',
  summary: 'The new onboarding ships behind a flag on 12 November, and support gets the help article first. Kofi flagged two items still open on the launch checklist, to look at before the design review.',
  chapters: [
    ['00:00', 'Onboarding', 'Ready, and it goes out behind a flag.'],
    ['05:12', 'Support', 'The help article comes before the flag.'],
    ['08:40', 'Launch checklist', 'Two items are still open.'],
    ['16:24', 'Back together', 'Support is happy if the article comes first.']
  ],
  said: [
    { id: 'l1', at: '00:04', who: ART, text: 'Morning, everyone. Let’s start with onboarding, since that’s the one with a date on it.' },
    { id: 'l2', at: '00:21', who: PRIYA, text: 'The new onboarding is done. Design signed off last night and the last coffee changes went in first thing.', unsure: 'words' },
    { id: 'l3', at: '01:10', who: PRIYA, text: 'I’d still rather not turn it on for everyone at once. If the first run breaks, it’s the first thing anyone sees.' },
    { id: 'l4', at: '01:48', who: KOFI, text: 'Agreed. Put it behind a flag and we can watch the first few hundred people go through it.' },
    { id: 'l5', at: '02:36', who: MAYA, text: 'Does the flag change anything for the trial numbers? I’m closing the month on the twelfth.' },
    { id: 'l6', at: '02:55', who: PRIYA, text: 'No. Same plans, same trial. Only the first run changes.' },
    { id: 'l7', at: '03:15', who: ART, text: 'Then let’s say it. The new onboarding ships behind a flag on 12 November.' },
    { id: 'l8', at: '03:31', who: KOFI, text: 'Twelfth works for design.' },
    { id: 'l9', at: '05:12', who: PRIYA, text: 'The other thing is support. They haven’t seen any of this yet.' },
    { id: 'l10', at: '05:40', who: MAYA, text: 'They’ll get the questions on day one, whatever we do.' },
    { id: 'l11', at: '06:02', who: ART, text: 'So support gets the help article before the flag goes on. Before, not the same day.' },
    { id: 'l12', at: '06:20', who: PRIYA, text: 'I’ll write it. Friday at the latest.' },
    { id: 'l13', at: '07:05', who: MAYA, text: 'Who tells existing customers, though? Is that an email, or a note in the app?' },
    { id: 'l14', at: '07:22', who: KOFI, text: 'I don’t think we’ve decided. Can we come back to it?' },
    { id: 'l15', at: '08:40', who: KOFI, text: 'Launch checklist. Two items are still open, and I’d like someone to look before the design review.' },
    { id: 'l16', at: '08:58', who: ART, text: 'I can look after this.' },
    { id: 'l17', at: '09:20', who: KOFI, text: 'Thanks. One is the empty state on the team page, the other is the flag name in the rollout plan.' },
    { id: 'l18', at: '10:05', who: KOFI, text: 'I’ll put the flag in the rollout plan now, that one’s quick.' },
    { id: 'l19', at: '12:02', who: ART, text: 'Let’s split up for a few minutes. Priya and Maya on the support handover, Kofi and me on the rollout.' },
    { id: 'l20', at: '16:24', who: PRIYA, text: 'We’re back. Short version, support is happy as long as the article comes first.' },
    { id: 'l21', at: '16:58', who: KOFI, text: 'Rollout’s fine. We start with one per cent and go from there.', unsure: 'speaker' },
    { id: 'l22', at: '19:10', who: ART, text: 'Good. Thanks, all. Same time next week.' }
  ],
  decisions: [
    { id: 'n2-d1', text: 'The new onboarding ships behind a flag on 12 November.', at: '03:15', state: 'proposed' },
    { id: 'n2-d2', text: 'Support gets the help article before the flag goes on.', at: '06:02', state: 'confirmed', by: PRIYA }
  ],
  questions: [{ id: 'n2-q1', text: 'Who tells existing customers about the new onboarding?', at: '07:05' }],
  actions: [
    { id: 'n2-a1', text: 'Review the launch checklist', at: '08:40', owner: ART, due: 'Today' },
    { id: 'n2-a2', text: 'Write the help article for support', at: '06:20', owner: PRIYA, takenOn: true, due: 'Friday' },
    { id: 'n2-a3', text: 'Add the flag to the rollout plan', at: '10:05', owner: KOFI, takenOn: true, done: true }
  ],
  screens: [LAUNCH_CHECKLIST]
};

const pricing: NoteSpec = {
  id: 'n3', title: 'Pricing sync', startedAt: iso(-1, 15, 0), minutes: 32, organizer: MAYA, invited: [ART, LENA],
  excerpt: 'The team plan gets a monthly option. Free minutes stay as they are.',
  summary: 'Maya compares seat pricing with usage pricing, and everyone leans towards minutes of notes as the thing people pay for. The team plan gets a monthly option, and free minutes stay as they are.',
  chapters: [['00:00', 'Seats or usage', 'Minutes of notes are what people pay for.'], ['12:48', 'A monthly option', 'Nobody wants to commit for a year.'], ['17:05', 'Free minutes', 'They stay as they are.']],
  said: [
    { at: '04:20', who: MAYA, text: 'Seats or usage: everyone leans towards minutes of notes as the thing people pay for.' },
    { at: '12:48', who: MAYA, text: 'The team plan gets a monthly option, because nobody wants to commit for a year.' },
    { at: '17:05', who: LENA, text: 'Free minutes stay as they are. Cutting them would hurt sign-ups.' },
    { at: '24:30', who: ART, text: 'I’ll send Kofi the pricing draft before Friday.' },
    { at: '28:15', who: MAYA, text: 'Keep the monthly option behind a flag until the launch.' }
  ],
  decisions: [
    { id: 'n3-d1', text: 'The team plan gets a monthly option.', at: '12:48', state: 'confirmed', by: MAYA },
    { id: 'n3-d2', text: 'Free minutes stay as they are.', at: '17:05', state: 'confirmed', by: LENA }
  ],
  actions: [{ id: 'n3-a1', text: 'Send Kofi the pricing draft', at: '24:30', owner: ART, due: 'Friday' }]
};

const designReview: NoteSpec = {
  id: 'n4', title: 'Design review', startedAt: iso(-1, 11, 0), minutes: 45, organizer: ART, invited: [PRIYA, KOFI, AIKO],
  excerpt: 'The sidebar reads better dark. One filled button per view from now on.',
  summary: 'Kofi walks through the sidebar in both themes, and it reads better dark. The team agrees on one filled button per view, and Aiko finds three on the pricing page.',
  chapters: [['00:00', 'The sidebar', 'It reads better dark, in both themes.'], ['18:22', 'Filled buttons', 'One per view from now on.'], ['31:02', 'The pricing page', 'Three filled buttons, cut to one.']],
  said: [
    { at: '07:10', who: KOFI, text: 'The sidebar reads better dark, in both themes.' },
    { at: '18:22', who: PRIYA, text: 'One filled button per view from now on.' },
    { at: '31:02', who: AIKO, text: 'The pricing page needs the same rule. It has three filled buttons.' },
    { at: '38:10', who: KOFI, text: 'The new empty states can ride the same flag.' }
  ],
  decisions: [
    { id: 'n4-d1', text: 'One filled button per view from now on.', at: '18:22', state: 'confirmed', by: ART },
    { id: 'n4-d2', text: 'The sidebar stays dark in both themes.', at: '07:10', state: 'confirmed', by: KOFI }
  ],
  actions: [{ id: 'n4-a1', text: 'Cut the pricing page to one filled button', at: '31:02', owner: AIKO, takenOn: true, done: true }]
};

const interview: NoteSpec = {
  id: 'n5', kind: 'room', title: 'Interview: Jonas Weber', startedAt: iso(-2, 14, 10), minutes: 52, organizer: ART,
  excerpt: 'Strong on distributed systems. Wants to stay close to customers.',
  summary: 'Jonas is strong on distributed systems and wants to stay close to customers. They’d rather ship to people than join a platform team.',
  chapters: [['00:00', 'Background', 'Distributed systems: consensus and storage.'], ['38:05', 'What they want', 'To stay close to customers.']],
  said: [
    { at: '11:30', text: 'Most of my work has been distributed systems: consensus, storage, the boring parts.' },
    { at: '38:05', text: 'I want to stay close to customers, not disappear into a platform team.' },
    { at: '49:20', text: 'I’ll send the take-home tomorrow.' }
  ],
  actions: [{ id: 'n5-a1', text: 'Send Jonas the take-home', at: '49:20', owner: ART, due: 'Thursday' }]
};

const siteVisit: NoteSpec = {
  id: 'n6', kind: 'room', title: 'Site visit, Harbourline', startedAt: iso(-2, 10, 30), minutes: 72, organizer: ART,
  excerpt: 'The Harbourline team records every handover. They need notes in Portuguese.',
  summary: 'The Harbourline team records every handover on the floor, shift to shift. Half the crew reads Portuguese, so they need notes in Portuguese.',
  chapters: [['00:00', 'Handovers', 'Every handover is recorded, shift to shift.'], ['41:40', 'Language', 'Notes in Portuguese.']],
  said: [
    { at: '08:15', text: 'Every handover on the floor gets recorded, shift to shift.' },
    { at: '41:40', text: 'Half the crew reads Portuguese, so the notes need to be in Portuguese.' }
  ]
};

const launch: NoteSpec = {
  id: 'n7', title: 'Launch planning', startedAt: iso(-8, 16, 0), minutes: 38, organizer: PRIYA, invited: [ART, INES],
  excerpt: 'The launch moves to the 18th. Sign-ups are back up after the pricing change.',
  summary: 'The launch moves to the 18th so the onboarding flag has a week to settle. Sign-ups are back up after the pricing change.',
  chapters: [['00:00', 'The date', 'The launch moves to the 18th.'], ['21:30', 'Sign-ups', 'Back up after the pricing change.']],
  said: [
    { at: '06:30', who: PRIYA, text: 'The launch moves to the 18th, so the onboarding flag has a week to settle.' },
    { at: '21:30', who: INES, text: 'Sign-ups are back up after the pricing change.' }
  ],
  decisions: [{ id: 'n7-d1', text: 'The launch moves to the 18th.', at: '06:30', state: 'confirmed', by: PRIYA }]
};

const boardPrep: NoteSpec = {
  id: 'n8', title: 'Board prep', startedAt: iso(-9, 9, 30), minutes: 41, organizer: INES, invited: [MAYA],
  shared: [{ person: ART, by: INES, at: iso(-9, 11, 0) }],
  excerpt: 'Runway is 22 months. The ask stays at the same size.',
  summary: 'Runway is 22 months at the current burn. The ask stays at the same size, and the pricing change is the story.',
  chapters: [['00:00', 'Runway', '22 months at the current burn.'], ['19:40', 'The ask', 'The same size, with the pricing change as the story.']],
  said: [
    { at: '02:50', who: MAYA, text: 'Runway is 22 months at the current burn.' },
    { at: '19:40', who: INES, text: 'The ask stays at the same size. The pricing change is the story.' }
  ]
};

const research: NoteSpec = {
  id: 'n9', title: 'Customer research readout', startedAt: iso(-13, 13, 0), minutes: 36, organizer: PRIYA, invited: [LENA, AIKO],
  shared: [{ person: ART, by: PRIYA, group: 'Product', at: iso(-13, 15, 0) }, { person: KOFI, by: PRIYA, group: 'Product', at: iso(-13, 15, 0) }],
  excerpt: 'People pay for minutes of notes, not seats. Three teams asked for notes in their own language.',
  summary: 'Lena’s interviews point to minutes of notes, not seats, as the thing people pay for. Three teams asked for notes in their own language.',
  said: [
    { at: '09:12', who: LENA, text: 'Nobody asked for seats. They asked what a minute of notes costs.' },
    { at: '22:47', who: LENA, text: 'Three teams asked for notes in their own language.' }
  ]
};

const intro: NoteSpec = {
  id: 'n10', title: 'Harbourline intro', startedAt: iso(-21, 11, 0), minutes: 28, organizer: PRIYA, invited: [ART, DIEGO],
  excerpt: 'Harbourline cares where the notes are written and who can read them.',
  summary: 'Harbourline cares where the notes are written and who can read them. Priya leads with confidential compute.',
  said: [
    { at: '05:02', who: DIEGO, text: 'They want to know where the notes are written, and who can read them.' },
    { at: '11:18', who: PRIYA, text: 'Then we lead with confidential compute.' }
  ]
};

const allHands = (everyone: NoteSpec['invited']): NoteSpec => ({
  id: 'n11', title: 'All hands', startedAt: iso(-41, 16, 30), minutes: 48, organizer: INES, invited: everyone,
  excerpt: 'Alcove opens to teams in November, and everyone gets a say in the launch checklist.',
  summary: 'The quarter in ten minutes: Alcove opens to teams in November, and everyone gets a say in the launch checklist.',
  said: [{ at: '03:20', who: INES, text: 'Alcove opens to teams in November.' }]
});

/** The notes a busy day has, newest first: the canvas's eleven. */
export function busyNotes(): Note[] {
  return [artsCall, standup, pricing, designReview, interview, siteVisit, launch, boardPrep, research, intro, allHands([ART, PRIYA, KOFI, AIKO, MAYA, LENA, DIEGO])].map((s) => writeNote(s));
}

/* ---------- notes still on their way ---------- */

/** A call that ended a few minutes ago, its notes being written: `writing` in the canvas's list. */
export const pricingFollowUp: NoteSpec = {
  id: 'n0', title: 'Pricing follow-up', status: 'pending', startedAt: iso(0, 15, 40), minutes: 26, organizer: ART, invited: [MAYA, LENA],
  excerpt: 'The monthly option goes out with the launch, at the same price per minute.',
  summary: 'Maya and Lena settle the monthly option: it goes out with the launch, at the same price per minute as the yearly plan, and the free minutes stay.',
  chapters: [['00:00', 'The monthly option', 'It goes out with the launch.'], ['14:20', 'Free minutes', 'They stay.']],
  said: [
    { at: '01:10', who: MAYA, text: 'The monthly option goes out with the launch. Same price per minute as yearly.' },
    { at: '14:20', who: LENA, text: 'And the free minutes stay. We said so last time and nothing’s changed.' },
    { at: '22:05', who: ART, text: 'I’ll tell support before the launch so they’re not surprised.' }
  ],
  decisions: [{ id: 'n0-d1', text: 'The monthly option goes out with the launch, at the same price per minute.', at: '01:10', state: 'proposed' }],
  actions: [{ id: 'n0-a1', text: 'Tell support about the monthly option', at: '22:05', owner: ART, due: 'Before the launch' }]
};
/** The same call, written. */
export const pricingFollowUpWritten = (): Note => writeNote({ ...pricingFollowUp, status: 'ready' });

/** A room recording going on now on another device: `recording` in the canvas's list. */
export const walkthrough: NoteSpec = {
  id: 'r0', kind: 'room', title: 'Harbourline walkthrough', status: 'recording', startedAt: iso(0, 16, 2), minutes: 0, organizer: ART,
  excerpt: ''
};

/* ---------- what's yours on a note ---------- */

/** What Priya added to the standup's shared notes from her own. Art can remove it: they're his notes. */
export function standupAdditions(): NoteAddition[] {
  return [{
    id: 'n2-x1', text: 'The outline is in the shared folder. Comments welcome before Friday.', by: PRIYA, at: iso(0, 10, 12),
    moments: [{ at: mmss('06:20'), line: { id: 'l12', text: 'I’ll write it. Friday at the latest.', speaker: { name: PRIYA.name, person: PRIYA } } }], removable: true
  }];
}
/** Art's own notes on the standup: a note to himself and a bookmark. */
export function standupOwn(): PersonalEntry[] {
  return [
    { id: 'n2-o1', at: iso(0, 9, 31), shared: null, kind: 'note', text: 'Ask Priya whether the article covers the team plan.' },
    {
      id: 'n2-o2', at: iso(0, 9, 32), shared: null, kind: 'bookmark', label: 'Launch checklist', reach: 'open',
      moment: { at: mmss('08:40'), line: { id: 'l15', text: 'Launch checklist. Two items are still open, and I’d like someone to look before the design review.', speaker: { name: KOFI.name, person: KOFI } } }
    }
  ];
}
