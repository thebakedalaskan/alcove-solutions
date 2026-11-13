/*
 * What the busy afternoon's documents say, written the way the canvas writes Vandelay Industries: the launch moves to the
 * 18th, two of the checklist's items are still open, the pricing page keeps one filled button, and Art owes Kofi the
 * pricing draft by Friday. Each page is the editor's own blocks (`BlockJSON`), under the document's title. The calls' homes
 * hold what was worked on in them: the standup's onboarding fixes, with tags and comments, the pricing sync's draft, with a
 * thread, the bill in code in each language and date tags this year and next, and the design review's screenshots,
 * walkthrough and spec, drawn here (`src/media/screens.ts`), with what's still uploading and what couldn't.
 * Their History has the call they were worked on in, and what was changed after it.
 */
import type { Person } from '@alcove/api';
import type { BlockJSON } from '~/features/workspace/editor/types';
import type { Screen } from '../media/screens';
import type { Page } from './world';
import { iso } from './clock';
import { AIKO, ART, KOFI, MAYA, PRIYA } from './people';

const words = (text: string): BlockJSON[] => [{ type: 'text', text }];
const line = (text: string): BlockJSON => ({ type: 'line', content: words(text) });
const heading = (text: string): BlockJSON => ({ type: 'line', attrs: { kind: 'heading', level: 2 }, content: words(text) });
const bullet = (text: string): BlockJSON => ({ type: 'line', attrs: { kind: 'bullet' }, content: words(text) });
const numbered = (text: string): BlockJSON => ({ type: 'line', attrs: { kind: 'numbered' }, content: words(text) });
const todo = (text: string, done = false): BlockJSON => ({ type: 'line', attrs: done ? { kind: 'todo', done: true } : { kind: 'todo' }, content: words(text) });
const callout = (text: string): BlockJSON => ({ type: 'line', attrs: { kind: 'callout', icon: 'bulb' }, content: words(text) });
const quote = (text: string): BlockJSON => ({ type: 'line', attrs: { kind: 'quote' }, content: words(text) });
/** Someone tagged, by address: the stand-in writes in the ID they have in the document's workspace. */
const tag = (p: Person): BlockJSON => ({ type: 'mention', attrs: { id: `@${p.email}`, name: p.name } });
/** Words a comment thread hangs on. */
const commented = (thread: string, text: string): BlockJSON => ({ type: 'text', text, marks: [{ type: 'comment', attrs: { id: thread } }] });
/** A date tag, as `@` puts one in: a day, YYYY-MM-DD, which each reader reads as Today, Fri 13 Nov or Sun 31 Jan 2027. */
const dated = (date: string): BlockJSON => ({ type: 'dateChip', attrs: { date } });
/** A block of code, in a language or as plain text. */
const code = (lang: string | null, text: string): BlockJSON => ({ type: 'code', ...(lang ? { attrs: { lang } } : {}), content: words(text) });
/** A line of words, tags and commented words. */
const lineOf = (parts: (string | BlockJSON)[], attrs?: Record<string, unknown>): BlockJSON => ({
  type: 'line', ...(attrs ? { attrs } : {}), content: parts.map((x) => (typeof x === 'string' ? { type: 'text', text: x } : x))
});
/** Photos side by side, each with its caption, and who that tags (`@First` in its words), as the editor keeps them. */
const gallery = (items: { media: string; name: string; cap?: string; tags?: Person[] }[]): BlockJSON => ({
  type: 'gallery',
  attrs: {
    items: items.map(({ media, name }) => ({ media, name, width: 1600, height: 900 })),
    ...Object.fromEntries(items.flatMap((i) => (i.cap ? [[`cap:${i.media}`, i.cap]] : []))),
    ...Object.fromEntries(items.flatMap((i) => (i.tags?.length ? [[`tags:${i.media}`, i.tags.map((p) => ({ id: `@${p.email}`, name: p.name }))]] : [])))
  }
});

/** The calls the homes' documents were worked on in, by their IDs, for History to group what was kept in each. */
const STANDUP_CALL = 'TeamStandupCall0000000';
const REVIEW_CALL = 'DesignReviewCall000000';

/* ---------- Product ---------- */

export const LAUNCH_PLAN: Page = {
  blocks: [
    line('The launch moves to Wednesday 18 November. Sign-ups are back up since the pricing change, so the date holds.'),
    heading('What goes out'),
    bullet('Paying for minutes of notes, with free minutes every month for everyone'),
    bullet('A monthly option on the team plan'),
    bullet('The new onboarding, as the design review leaves it'),
    heading('Who has what'),
    bullet('Priya: the date, and the note to everyone on the 18th'),
    bullet('Maya: the team plan and its monthly price'),
    bullet('Kofi: the launch checklist, before the design review'),
    bullet('Lena: the pricing page copy'),
    heading('Before the 18th'),
    todo('Send Kofi the pricing draft'),
    todo('Cut the pricing page down to one filled button', true),
    todo('Close the last two items on the launch checklist'),
    todo('Tell support about the new refund wording', true),
    callout('Nothing goes out before the design review has seen the onboarding.')
  ],
  /* Kept as it was written: Priya's edits this afternoon, and yesterday's design review, where three of them worked on it. */
  versions: [
    { at: iso(0, 14, 5), by: [PRIYA], call: null, reason: 'edits' },
    { at: iso(-1, 11, 45), by: [PRIYA, KOFI, ART], call: REVIEW_CALL, reason: 'call' },
    { at: iso(-1, 11, 20), by: [KOFI], call: REVIEW_CALL, reason: 'edits' }
  ]
};

export const LAUNCH_CHECKLIST: Page = {
  blocks: [
    line('Everything that has to be true on the 18th. Two items are still open.'),
    todo('Free minutes show on every plan', true),
    todo('The team plan has a monthly price', true),
    todo('Receipts say minutes, not seats', true),
    todo('The refund wording is the same everywhere', true),
    todo('The status page says what’s launching'),
    todo('Someone has looked at this before the design review'),
    todo('The launch note is written', true)
  ]
};

export const INTERVIEWS: Page = {
  blocks: [
    line('Six people who run their team’s meetings, spoken to in October.'),
    heading('What they said'),
    bullet('Nobody reads a whole transcript. They read the decisions, then search.'),
    bullet('Four of the six already pay for a note taker, two of them per seat.'),
    bullet('Everyone asked who else can read the notes before asking anything else.'),
    quote('If anyone at the vendor can read the notes, legal won’t let us use it.'),
    heading('What we change'),
    numbered('Decisions first, at the top of every note'),
    numbered('Who has the notes, on every note')
  ]
};

export const COMPETITORS: Page = {
  blocks: [
    line('What the other note takers charge for, as of October.'),
    bullet('Per seat, every month, whether anyone records or not'),
    bullet('Per minute, with nothing free'),
    bullet('Free, with the recordings used to train their models'),
    line('Minutes of notes, with free minutes for everyone, is still nobody else’s model.')
  ]
};

export const PRICING_COPY: Page = {
  blocks: [
    heading('Pay for the notes, not the seats'),
    line('Every seat gets free minutes of notes each month. Teams that need more buy minutes, by the month or as they go.'),
    heading('Nobody else reads them'),
    line('Notes are written where nobody else can read them: not us, and not anyone who wasn’t in the call.'),
    line('One filled button: Start free.')
  ]
};

export const OLD_ROADMAP: Page = { blocks: [line('The third quarter’s roadmap, from before the pricing change.')] };
export const FIRST_DRAFT: Page = { blocks: [line('First draft, from when the launch was going to be the 11th.')] };

/* ---------- Design ---------- */

export const EMPTY_STATES: Page = {
  blocks: [
    line('Every list and page says what will be there, and how to put something there. Never a blank space.'),
    heading('The rules'),
    bullet('Say what shows up here, in one sentence'),
    bullet('Offer the one thing that fills it, as the page’s filled button'),
    bullet('An arch, never an empty box'),
    heading('Still to do'),
    todo('Notes, when a search finds nothing'),
    todo('Team, before anyone has joined', true),
    todo('A workspace’s Trash')
  ]
};

/* ---------- Company handbook, which Art can only read ---------- */

export const HOLIDAYS: Page = {
  blocks: [
    line('Everyone has 28 days a year, and the public holidays where they live.'),
    heading('Booking time off'),
    numbered('Put it in the team calendar'),
    numbered('Tell your lead a week ahead for anything over three days'),
    heading('Between Christmas and New Year'),
    line('The office is closed from 24 December to 1 January, and those days don’t count.')
  ]
};

export const EXPENSES: Page = {
  blocks: [
    line('Keep the receipt, and send it in within a month.'),
    bullet('Trains in second class, planes in economy'),
    bullet('Hotels up to 180 euros a night, or 250 in London'),
    bullet('Dinner with a customer: up to 60 euros a head'),
    callout('Ask Nadia before booking anything over 1,000 euros.')
  ]
};

export const WORKING_FROM_HOME: Page = {
  blocks: [
    line('Work from wherever suits the day. Wednesdays are for being in the office together.'),
    bullet('A desk and a chair: up to 400 euros, once'),
    bullet('Internet: 30 euros a month')
  ]
};

/* ---------- the calls' homes ---------- */

/** The files in the design review's home, by their IDs. */
export const MEDIA = {
  light: 'media-sidebar-light', dark: 'media-sidebar-dark', pricing: 'media-pricing-page', walkthrough: 'media-sidebar-walkthrough', spec: 'media-sidebar-spec',
  /** One deleted for good: a document that had it says so where it was. */
  gone: 'media-old-sidebar'
} as const;
/** What Aiko is uploading to the review's home right now, as the block says. */
export const UPLOADING = 'up-aiko-pricing-walkthrough';

/** What the review's screenshots and walkthrough show, drawn. */
export const SHOWN: Record<'light' | 'dark' | 'pricing' | 'walkthrough', Screen> = {
  light: { title: 'Sidebar, light', accent: '#215DB3', pages: [{ heading: 'The sidebar, by day', lines: ['Start a call, a row with a warm circle, so the page’s own action is the one filled button', 'Home, Notes, Drive, Record and Team', 'Up next, then what’s pinned'] }] },
  dark: { title: 'Sidebar, dark', accent: '#7A5BD6', pages: [{ heading: 'The sidebar, by night', lines: ['It reads better dark, in both themes', 'The same order, the same words', 'Pinned notes keep their arches'] }] },
  pricing: { title: 'Pricing page', kind: 'doc', accent: '#C0587A', pages: [{ heading: 'Pricing', lines: ['Start free', 'Talk to us', 'Buy minutes: three filled buttons, where one would do'] }] },
  walkthrough: {
    title: 'Sidebar walkthrough', accent: '#215DB3',
    pages: [{ heading: 'Walking through the sidebar', lines: ['Start a call opens the call’s lobby', 'Drive holds every call’s home', 'Record works without a connection'] }]
  }
};

export const ONBOARDING_FIXES: Page = {
  blocks: [
    line('What the standup found in onboarding, to fix before the 18th.'),
    todo('Empty states say what will be there, everywhere', true),
    lineOf(['The welcome email in dark mode ', tag(KOFI)], { kind: 'todo' }),
    lineOf(['Send Kofi the pricing draft before Friday ', tag(ART)], { kind: 'todo' }),
    lineOf([commented('c-tour', 'The tour skips Record on a phone'), '. It should end there, where the recorder is.']),
    lineOf(['Sign-ups are back up, so ', commented('c-copy', 'nothing in the welcome copy changes'), ' before the launch.'])
  ],
  threads: [
    {
      id: 'c-tour', on: 4, quote: 'The tour skips Record on a phone',
      says: [{ who: KOFI, text: 'Every phone, not only small ones: its last step is behind the tab bar.', hoursAgo: 6.5 }, { who: PRIYA, text: 'Then it ends on the tab bar. I’ll move it.', hoursAgo: 6 }]
    },
    { id: 'c-copy', on: 5, quote: 'nothing in the welcome copy changes', says: [{ who: MAYA, text: 'Not even the line about free minutes?', hoursAgo: 5 }] }
  ],
  versions: [
    { at: iso(0, 14, 30), by: [KOFI], call: null, reason: 'edits' },
    { at: iso(0, 9, 20), by: [PRIYA, KOFI, ART], call: STANDUP_CALL, reason: 'call' },
    { at: iso(0, 9, 13), by: [PRIYA], call: STANDUP_CALL, reason: 'edits' }
  ]
};

export const SIDEBAR_SHOTS: Page = {
  blocks: [
    line('From the design review: the sidebar in both themes, and the pricing page Aiko found three filled buttons on.'),
    gallery([{ media: MEDIA.light, name: 'Sidebar, light.png', cap: 'By day' }, { media: MEDIA.dark, name: 'Sidebar, dark.png', cap: 'By night, which reads better' }, { media: MEDIA.pricing, name: 'Pricing page.png', cap: 'Three buttons, says @Aiko', tags: [AIKO] }]),
    heading('The walkthrough'),
    { type: 'video', attrs: { media: MEDIA.walkthrough, title: 'Sidebar walkthrough', dur: 3, width: 1600, height: 900 } },
    heading('The spec'),
    { type: 'file', attrs: { media: MEDIA.spec, name: 'Sidebar spec.pdf', size: 482_133 } }
  ]
};

export const REVIEW_UPLOADS: Page = {
  blocks: [
    line('Aiko’s walkthrough of the pricing page is on its way.'),
    { type: 'video', attrs: { title: 'Pricing page walkthrough', up: 62, upload: UPLOADING, width: 1600, height: 900 } },
    line('The recording of the whole review is too big to keep here.'),
    { type: 'file', attrs: { name: 'Review recording.mov', size: 1_284_000_000, failed: 'Review recording.mov', upload: 'up-art-review-recording' } },
    line('The old sidebar, to compare:'),
    gallery([{ media: MEDIA.gone, name: 'Old sidebar.png' }])
  ],
  /* Kept as the review ended, with the walkthrough on its way and the recording refused: a version shows neither. */
  versions: [{ at: iso(-1, 11, 45), by: [AIKO], call: REVIEW_CALL, reason: 'call' }]
};

export const REVIEW_CHECKLIST: Page = {
  blocks: [
    line('What the design review asked for, before the 18th.'),
    todo('One filled button per view', true),
    todo('The pricing page down to one filled button'),
    todo('The sidebar dark in both themes', true)
  ]
};

/* The same sum, as each of the apps that send a bill has it: code in each language a block can be coloured as. */
const BILL_JS = `// Minutes past the free ones, at the price of a minute, in cents
export function bill(minutes, plan) {
  const paid = Math.max(0, minutes - plan.free);
  return paid * plan.perMinute + (plan.monthly ? 0 : 500);
}`;
const BILL_PY = `def bill(minutes: int, plan: dict) -> int:
    """Minutes past the free ones, at the price of a minute, in cents."""
    paid = max(0, minutes - plan["free"])
    return paid * plan["per_minute"] + (0 if plan["monthly"] else 500)`;
const BILL_CPP = `#include <algorithm>

// Minutes past the free ones, at the price of a minute, in cents
int bill(int minutes, const Plan& plan) {
  int paid = std::max(0, minutes - plan.free);
  return paid * plan.perMinute + (plan.monthly ? 0 : 500);
}`;

/*
 * The pricing sync's draft: a thread on its first line, the bill worked out in code in each language, a follow-up with a
 * date tag, and a date in another year, which its tag says. Long enough to scroll.
 */
export const PRICING_DRAFT: Page = {
  blocks: [
    lineOf(['Minutes of notes are what people pay for. Every seat gets ', commented('c-free', 'free minutes each month'), '.']),
    heading('The team plan'),
    bullet('Monthly or yearly'),
    bullet('Minutes shared across the team'),
    heading('What a bill comes to'),
    line('Minutes past the free ones, at the price of a minute: the same sum in each app that sends a bill.'),
    code('javascript', BILL_JS),
    code('python', BILL_PY),
    code('cpp', BILL_CPP),
    heading('Still open'),
    todo('What a minute costs past the free ones'),
    lineOf(['Settle the price of a minute with ', tag(KOFI), ' by ', dated('2026-11-13')], { kind: 'todo' }),
    lineOf(['Today’s prices hold until ', dated('2027-01-31'), '.'])
  ],
  threads: [
    { id: 'c-free', on: 0, quote: 'free minutes each month', says: [{ who: KOFI, text: 'How many, for a team of five?', hoursAgo: 23 }, { who: MAYA, text: '600 each, so 3,000 a month between them.', hoursAgo: 22.5 }] }
  ]
};

/** Who changed each document in the calls, as their notes say (`Note.workedOn`). */
export const WORKED = { standup: [PRIYA, KOFI, ART], review: [KOFI, AIKO], checklist: [ART] } as const;
