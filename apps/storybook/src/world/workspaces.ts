/*
 * The workspaces of the design canvas's A workspace board (docs/design/canvas, Workspace.dc.html), full screen: Launch, kept
 * by hand for the launch on the 18th, with its plan (Priya writing in it), its board, its press folder and the planning calls
 * kept in it, the next one included; what this morning's standup made in its own workspace, and the standups before it; and
 * Hiring sync's workspace before its call tomorrow, with an agenda just made in it. A story puts them in its world with
 * `withWorkspaces`, and what's just been made in Launch, for what's new to Art, with `withJustMade`. Everyone is made up.
 */
import type { Meeting, Note, WorkspaceItem } from '@alcove/api';
import type { BlockJSON } from '~/features/workspace/editor/types';
import type { Page, Space, World } from './world';
import { call, writeNote, type NoteSpec } from './build';
import { homesOn } from './call-page';
import { fromNow, iso } from './clock';
import { AIKO, ART, INES, KOFI, MAYA, PRIYA } from './people';

/** An ID for something in these workspaces, from its name: 22 characters, none the same as the busy world's own. */
export const spaceItem = (name: string): string => `w${name.replace(/[^A-Za-z0-9]/g, '')}`.padEnd(22, '0').slice(0, 22);

export const LAUNCH = 'ws-launch';
export const HIRING_SYNC = 'ws-hiring-sync';
const STANDUP_HOME = 'ws-standup';

/** When things happened, on the demo clock: the Launch planning calls, this morning's standup, and Hiring sync tomorrow. */
const PLANNING_27 = iso(-8, 16, 0);
const PLANNING_13 = iso(-22, 16, 0);
const STANDUP = iso(0, 9, 0);
const HIRING = iso(1, 10, 0);
const plus = (at: string, minutes: number) => new Date(Date.parse(at) + minutes * 60_000).toISOString();

interface Shape { parent?: string | undefined; by?: typeof ART | undefined; trashed?: { at: string; by: typeof ART } | undefined; noteId?: string | undefined }
function item(name: string, kind: WorkspaceItem['kind'], made: string, edited: string, o: Shape = {}): WorkspaceItem {
  const by = o.by?.portrait ? { name: o.by.name, portrait: o.by.portrait } : null;
  return {
    id: spaceItem(name), kind, name, parent: o.parent ?? null, by, mine: o.by?.email === ART.email, createdAt: made, editedAt: edited,
    trashedAt: o.trashed?.at ?? null, trashedBy: o.trashed?.by.name ?? null,
    restricted: false, role: 'edit', call: o.noteId === undefined ? null : { startedAt: made, on: false, here: false, noteId: o.noteId }
  };
}
const folderOfCall = (title: string, day: string, at: string, noteId: string): WorkspaceItem => item(`${title} · ${day}`, 'folder', at, at, { noteId });

/* ---------- the pages ---------- */

const words = (text: string): BlockJSON[] => [{ type: 'text', text }];
const line = (text: string): BlockJSON => ({ type: 'line', content: words(text) });
const heading = (text: string): BlockJSON => ({ type: 'line', attrs: { kind: 'heading', level: 2 }, content: words(text) });
const bullet = (parts: (string | BlockJSON)[]): BlockJSON => ({ type: 'line', attrs: { kind: 'bullet' }, content: parts.map((x) => (typeof x === 'string' ? { type: 'text', text: x } : x)) });
const todo = (parts: (string | BlockJSON)[], done = false): BlockJSON => ({ type: 'line', attrs: done ? { kind: 'todo', done: true } : { kind: 'todo' }, content: parts.map((x) => (typeof x === 'string' ? { type: 'text', text: x } : x)) });
const tag = (p: typeof ART): BlockJSON => ({ type: 'mention', attrs: { id: `@${p.email}`, name: p.name } });
const dated = (date: string): BlockJSON => ({ type: 'dateChip', attrs: { date } });
const commented = (thread: string, text: string): BlockJSON => ({ type: 'text', text, marks: [{ type: 'comment', attrs: { id: thread } }] });
/** A line quoted from a call: who said it, when, and the line of the call's notes it is, so whoever has them can open it there. */
const quoted = (who: typeof ART, at: string, text: string, note: string, said: string): BlockJSON => ({ type: 'moment', attrs: { person: who.id, name: who.name, at, text, note, line: said } });

/** Launch plan: what goes out on the 18th, who has what, and what's left, with Priya writing in it. */
const LAUNCH_PLAN: Page = {
  blocks: [
    line('The launch moves to Wednesday 18 November. Sign-ups are back up since the pricing change, so the date holds.'),
    heading('What goes out'),
    bullet(['Paying for minutes of notes, with free minutes every month for everyone']),
    bullet(['A monthly option on the team plan']),
    bullet(['The new onboarding, as the design review leaves it']),
    heading('Who has what'),
    bullet([tag(PRIYA), ' the date, and the note to everyone on the 18th']),
    bullet([tag(MAYA), ' the team plan and its monthly price']),
    bullet([tag(KOFI), ' the launch checklist, before the design review']),
    heading('Before the 18th'),
    todo(['Cut the pricing page down to one filled button'], true),
    todo(['Send Kofi the pricing draft ', dated('2026-11-06')]),
    todo(['Send the press list to the trade titles ', dated('2026-11-16')]),
    { type: 'line', attrs: { kind: 'callout', icon: 'bulb' }, content: [commented('c-review', 'Nothing goes out before the design review has seen the onboarding.')] },
    quoted(PRIYA, plus(PLANNING_27, 12.67), 'The launch moves to the eighteenth, a Wednesday. That gives support a full week with the article.', 'n-launch-27', 'lp27-l3')
  ],
  threads: [
    { id: 'c-review', on: 13, quote: 'Nothing goes out before the design review has seen the onboarding.', says: [
      { who: KOFI, text: 'The review is Thursday. I’ll bring the onboarding as it is then.', hoursAgo: 5 },
      { who: INES, text: 'Then the press list waits until Friday. Fine by me.', hoursAgo: 4 }
    ] }
  ],
  here: [{ who: PRIYA, after: 'the launch checklist, before the design review' }]
};

const PRESS_LIST: Page = { blocks: [line('Who hears first, and when.'), bullet(['Three trade titles']), bullet(['Two founders’ newsletters']), bullet(['Embargo: 18 Nov, 09:00']), bullet(['Quotes from Priya'])] };
const LAUNCH_POST: Page = { blocks: [line('Alcove, with notes nobody else can read.'), heading('What changes on the 18th'), line('Pricing, in one line. Then thanks.')] };
const RUNBOOK: Page = { blocks: [heading('Who watches it, and when'), bullet(['Kofi, from now on']), heading('What counts as an incident'), bullet(['Anything that stops a call or a note'])] };

/** What this morning's standup made: the launch checklist, two of its items still open, and Kofi's words from 8:40. */
const LAUNCH_CHECKLIST: Page = {
  blocks: [
    todo(['Status page: Kofi, from now on'], true),
    todo(['Help article before the flag goes on'], true),
    todo(['Changelog before the launch post']),
    todo(['Flag on for everyone ', dated('2026-11-12')]),
    quoted(KOFI, plus(STANDUP, 8.67), 'Launch checklist. Two items are still open, and I’d like someone to look before the design review.', 'n2', 'l15')
  ],
  here: [{ who: KOFI, after: 'Changelog before the launch post' }]
};

/** Hiring sync's agenda, made a moment ago: Ines, invited, is reading it already. */
const AGENDA: Page = {
  blocks: [heading('What we’re here to decide'), bullet(['Who joins the interview loop']), heading('Where things stand'), bullet([''])],
  here: [{ who: INES, after: 'Who joins the interview loop' }]
};

/* ---------- the calls kept in them ---------- */

const PLANNING: NoteSpec[] = [
  {
    id: 'n-launch-27', title: 'Launch planning', startedAt: PLANNING_27, minutes: 38, organizer: ART, invited: [PRIYA, INES], seriesId: 's-launch',
    excerpt: 'The launch moves to the 18th. Sign-ups are back up after the pricing change.',
    said: [
      { id: 'lp27-l1', at: '00:20', who: PRIYA, text: 'First, the date. Sign-ups came back after the pricing change.' },
      { id: 'lp27-l2', at: '06:10', who: INES, text: 'The press list can be ready for any date in the week of the sixteenth.' },
      { id: 'lp27-l3', at: '12:40', who: PRIYA, text: 'The launch moves to the eighteenth, a Wednesday. That gives support a full week with the article.' }
    ],
    decisions: [{ id: 'lp27-d1', text: 'The launch moves to the 18th.', at: '12:40', state: 'confirmed', by: PRIYA }],
    actions: [{ id: 'lp27-a1', text: 'Draft the press list', at: '06:10', owner: INES, takenOn: true, due: 'Friday' }]
  },
  {
    id: 'n-launch-13', title: 'Launch planning', startedAt: PLANNING_13, minutes: 41, organizer: ART, invited: [PRIYA, KOFI, INES], seriesId: 's-launch',
    excerpt: 'The press list goes to Ines. The monthly option waits for pricing.',
    said: [{ id: 'lp13-l1', at: '04:00', who: INES, text: 'I’ll take the press list.' }],
    decisions: [{ id: 'lp13-d1', text: 'The press list goes to Ines.', at: '04:00', state: 'confirmed', by: INES }]
  }
];
/** The standups before this morning's, kept in the standup's own workspace. */
const STANDUPS: NoteSpec[] = [
  { id: 'n-standup-3', title: 'Team standup', startedAt: iso(-1, 9, 0), minutes: 18, organizer: ART, invited: [PRIYA, KOFI, MAYA], seriesId: 's-standup', excerpt: 'Support’s queue is clear. The flag waits for the help article.' },
  { id: 'n-standup-2', title: 'Team standup', startedAt: iso(-2, 9, 0), minutes: 15, organizer: ART, invited: [PRIYA, KOFI], seriesId: 's-standup', excerpt: 'Kofi takes the status page from now on.' }
];

/** The next Launch planning, every other Tuesday, kept in Launch. */
const NEXT_PLANNING: Meeting = {
  ...call({ id: 'm-launch-next', title: 'Launch planning', startsAt: iso(6, 16, 0), minutes: 45, code: 'lch-plan-prn', guests: [PRIYA, INES], rsvps: { yes: 2 }, seriesId: 's-launch',
    repeat: { rule: { every: 'week', weeks: 2, days: [2] }, until: '2027-06-29', timeZone: 'Europe/London' } }),
  workspaceId: LAUNCH
};

/* ---------- the workspaces ---------- */

function launch(): Space {
  const press = { parent: spaceItem('Press') };
  return {
    id: LAUNCH, name: 'Launch', role: 'admin', inCall: false, people: 4, teamAccess: null, createdAt: iso(-40, 10, 0), call: null, members: [PRIYA, KOFI, INES],
    about: 'Everything for the launch on Wednesday 18 November: the plan, the press list, and the planning call every other Tuesday.',
    items: [
      folderOfCall('Launch planning', '27 Oct', PLANNING_27, 'n-launch-27'),
      folderOfCall('Launch planning', '13 Oct', PLANNING_13, 'n-launch-13'),
      item('Launch plan', 'document', plus(PLANNING_27, 20), iso(0, 8, 40), { by: PRIYA }),
      item('Launch board', 'board', plus(PLANNING_27, 25), plus(PLANNING_27, 34), { by: KOFI }),
      item('Press', 'folder', iso(-20, 10, 0), iso(-20, 10, 0), { by: INES }),
      item('Press list', 'document', plus(PLANNING_27, 30), plus(PLANNING_27, 60), { by: INES, ...press }),
      item('Launch post draft', 'document', iso(-12, 11, 0), iso(-11, 15, 0), { by: INES, ...press }),
      item('Research', 'folder', iso(-30, 10, 0), iso(-30, 10, 0), { by: PRIYA }),
      item('Status page runbook', 'document', iso(-14, 10, 0), iso(-13, 12, 0), { by: KOFI }),
      item('Old launch date', 'document', iso(-30, 10, 0), iso(-25, 10, 0), { by: PRIYA, trashed: { at: iso(-8, 16, 40), by: PRIYA } }),
      item('Press list, first try', 'document', iso(-21, 10, 0), iso(-21, 10, 0), { by: INES, trashed: { at: iso(-8, 17, 10), by: INES } })
    ]
  };
}

function hiringSync(): Space {
  return {
    id: HIRING_SYNC, name: 'Hiring sync · 5 Nov', role: 'admin', inCall: false, people: 3, teamAccess: null, createdAt: iso(0, 16, 5), call: { title: 'Hiring sync', at: HIRING }, members: [INES, AIKO],
    items: [item('Agenda', 'document', iso(0, 16, 10), iso(0, 16, 11), { by: ART })]
  };
}

/** What the standup made, and the standups before it, put in its own workspace beside what's there. */
function standupMade(w: World): void {
  const home = w.workspaces.find((s) => s.id === STANDUP_HOME);
  if (!home) return;
  const [folder, ...rest] = home.items;
  home.items = [
    ...(folder ? [folder] : []),
    item('Launch checklist', 'document', plus(STANDUP, 8), plus(STANDUP, 70), { by: KOFI }),
    item('Standup board', 'board', plus(STANDUP, 4), plus(STANDUP, 18), { by: PRIYA }),
    ...rest,
    folderOfCall('Team standup', '3 Nov', iso(-1, 9, 0), 'n-standup-3'),
    folderOfCall('Team standup', '2 Nov', iso(-2, 9, 0), 'n-standup-2')
  ];
}

/** Puts these workspaces, their pages, their calls' notes and the next planning call in a story's world. */
export function withWorkspaces(w: World): void {
  w.workspaces = [...w.workspaces, launch(), hiringSync()];
  standupMade(w);
  const pages: [string, Page][] = [
    ['Launch plan', LAUNCH_PLAN], ['Press list', PRESS_LIST], ['Launch post draft', LAUNCH_POST], ['Status page runbook', RUNBOOK],
    ['Launch checklist', LAUNCH_CHECKLIST], ['Agenda', AGENDA]
  ];
  for (const [name, page] of pages) w.pages[spaceItem(name)] = page;
  const notes: Note[] = [...PLANNING, ...STANDUPS].map((s) => writeNote(s));
  /* Each call's page opens its workspace, as the API works it out: the one keeping the call's folder. */
  homesOn(notes, w.workspaces);
  w.notes = [...w.notes, ...notes].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  w.meetings = [...w.meetings, NEXT_PLANNING];
}

/* ---------- what's new to Art ---------- */

/** What's just been made in Launch: Kofi's pricing FAQ, Art's launch tweet and Priya's press quotes. */
const JUST_MADE: [string, Page][] = [
  ['Pricing FAQ', { blocks: [
    heading('What people ask'),
    bullet(['Is the team plan monthly now? Yes, from the 18th, beside the yearly price.']),
    bullet(['Do the free minutes change? No: everyone keeps theirs, every month.']),
    bullet(['Where are notes written? In confidential compute, as before.'])
  ] }],
  ['Launch tweet', { blocks: [line('From the 18th: free minutes of notes every month for everyone, and a monthly team plan.')] }],
  ['Press quotes', { blocks: [heading('From Priya'), bullet(['“The launch moved to the 18th so support has a full week with the article.”']), bullet(['“Notes are written in confidential compute, so nobody else can read them.”'])] }]
];
/** Priya's press quotes, which Art opened here a minute ago: a story keeps that in this browser, as opening them would. */
export const JUST_OPENED = spaceItem('Press quotes');

/**
 * What's just been made in Launch, at the end of its pages, as anything new lands: Kofi's pricing FAQ three minutes ago, which
 * Art hasn't opened; Art's own launch tweet two minutes ago; and Priya's press quotes six minutes ago (`JUST_OPENED`). Put in a
 * story's world after `withWorkspaces`.
 */
export function withJustMade(w: World): void {
  const launch = w.workspaces.find((s) => s.id === LAUNCH);
  if (!launch) return;
  const ago = (minutes: number) => fromNow(-minutes * 60_000);
  launch.items = [
    ...launch.items,
    item('Pricing FAQ', 'document', ago(3), ago(1), { by: KOFI }),
    item('Launch tweet', 'document', ago(2), ago(2), { by: ART }),
    item('Press quotes', 'document', ago(6), ago(5), { by: PRIYA })
  ];
  for (const [name, page] of JUST_MADE) w.pages[spaceItem(name)] = page;
}
