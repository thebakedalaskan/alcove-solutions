/*
 * The named worlds the stand-in serves. A story picks one (`parameters.scenario`, or the `scenario` arg), and the preview
 * starts it before the story renders: a fresh world, the demo clock at the scenario's moment, the browser as it says, and
 * what this browser remembers. Add a scenario here, with a line in apps/storybook/README.md, when a page has a state none
 * of these reach.
 */
import {
  TopUpSchema, TopUpRoutesSchema, ISODateSchema, DriveExportChoiceSchema, DriveExportJobSchema, DriveFolderSchema, DriveSettingsSchema, FILE_TYPE, CalendarSchema, CreditBalanceSchema, DocumentLibrarySchema, IncomingRingSchema, MeetingSchema, NoteSchema, PersonalEntrySchema, PreferencesSchema,
  MentionNoticeSchema, SessionSchema, ShareEntrySchema, TeamSchema, WorkspaceMediaSchema, WorkspaceSummarySchema, WorkspaceTreeSchema, type DocumentLibrary, type DocumentRole,
  type Group, type ItemCall, type MentionNotice, type NoteRoom, type NoteWorkedOn, type Person, type ShareEntry, type WorkspaceItem, type WorkspaceRole
} from '@alcove/api';
import { tileHintKey } from '~/features/call/layout/view';
import { sessions } from '~/lib/live';
import { openBrowser } from '../browser';
import { busyCalls, busyEvents, soonCalls } from '../world/calls';
import { connected, notConnected, writeNote, type NoteSpec } from '../world/build';
import { iso, on, setClock } from '../world/clock';
import { clipOf, stillOf } from '../media/screens';
import { CREDITS, PREFS, WELCOME_CREDITS, session, type BoardSpec, type Kept, type Opening, type Page, type Refused, type Space, type World } from '../world';
import { FLOW, RETRO, roomBoard } from '../world/boards';
import {
  COMPETITORS, EMPTY_STATES, EXPENSES, FIRST_DRAFT, HOLIDAYS, INTERVIEWS, LAUNCH_CHECKLIST, LAUNCH_PLAN, MEDIA, OLD_ROADMAP, ONBOARDING_FIXES, PRICING_COPY,
  PRICING_DRAFT, REVIEW_CHECKLIST, REVIEW_UPLOADS, SHOWN, SIDEBAR_SHOTS, WORKED, WORKING_FROM_HOME
} from '../world/documents';
import { busyNotes, pricingFollowUp, pricingFollowUpWritten, standupAdditions, standupOwn, walkthrough } from '../world/notes';
import { AIKO, ANA, ART, DIEGO, DIRECTORY, INES, JONAS, KOFI, LENA, MANY, MAYA, ME_ID, NADIA, PRIYA, SAM, THEO, teamOf, type Colleague } from '../world/people';
import { QUIET } from './empty';
import { forgetKeptHere } from './kept';
import { drawnPicture, forgetAudio } from './media';
import { stopLive } from './standin';
import { paymentsOff, withPayments } from '../world/payments';
import { disconnectedDrive, withDriveExports } from '../world/drive-exports';
import { withAgentConnections, withAgentEnding } from './agents';
import { serve } from './state';
import { forgetDocuments } from './workspaces';

export type ScenarioName = 'busy' | 'first-day' | 'on-their-own' | 'offline' | 'writing' | 'call-soon' | 'lots' | 'signed-out' | 'unsaved' | 'first-sign-in' | 'agents-connected' | 'agents-ending' | 'drive-connected' | 'payments';

interface Scenario { title: string; about: string; make: () => { world: World; opening: Partial<Opening> } }

/* ---------- pieces the scenarios share ---------- */

const group = (id: string, name: string, people: readonly Person[]): Group => ({ id, name, emails: people.map((p) => p.email) });
const GROUPS = [group('g-leads', 'Leads', [PRIYA, KOFI, INES]), group('g-product', 'Product', [PRIYA, KOFI, AIKO, MAYA])];

/** A workspace item's ID, from its name: the 22 characters the contract asks for. Stories open a document by it. */
export const itemId = (slug: string) => slug.replace(/[^A-Za-z0-9]/g, '').padEnd(22, '0').slice(0, 22);
const hoursBefore = (hours: number) => new Date(Date.parse(iso(0, 16, 12)) - hours * 3_600_000).toISOString();
/** `made`: how many hours ago it was made, when that's longer ago than its last edit. */
interface ItemShape { parent?: string | null; role?: DocumentRole; restricted?: boolean; trashed?: { hoursAgo: number; by: Person }; call?: ItemCall; made?: number }
function item(name: string, kind: WorkspaceItem['kind'], by: Person, hoursAgo: number, o: ItemShape = {}): WorkspaceItem {
  const at = hoursBefore(hoursAgo);
  return {
    id: itemId(name), kind, name, parent: o.parent ?? null, by: by.portrait ? { name: by.name, portrait: by.portrait } : null, createdAt: o.made === undefined ? at : hoursBefore(o.made), editedAt: at,
    trashedAt: o.trashed ? hoursBefore(o.trashed.hoursAgo) : null, trashedBy: o.trashed?.by.name ?? null, restricted: o.restricted ?? false, role: o.role ?? 'edit',
    call: o.call ?? null
  };
}
/** When the calls with homes started, as their notes say. */
const STANDUP_AT = iso(0, 9, 0);
const PRICING_AT = iso(-1, 15, 0);
const REVIEW_AT = iso(-1, 11, 0);
/**
 * A call's home, as the API makes one when the call's workspace first opens: named after the call and the day, with the
 * call's folder at its top, whose pages open the call's note once it's over.
 */
/** What a call's home is called: the call, and the day. */
const homeName = (title: string, at: string): string => `${title} · ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(at))}`;
function home(id: string, title: string, at: string, organizer: Person, role: WorkspaceRole, people: number, noteId: string, items: WorkspaceItem[]): Space {
  const name = homeName(title, at);
  const hours = (Date.parse(iso(0, 16, 12)) - Date.parse(at)) / 3_600_000;
  return { id, name, role, inCall: false, people, createdAt: at, call: { title, at }, items: [item(name, 'folder', organizer, hours, { call: { startedAt: at, on: false, here: false, noteId } }), ...items] };
}
/**
 * The workspaces: the homes of the day's calls, the standup's newest; Product, which Art runs; Design, where he edits; and
 * the company handbook, which he can only read.
 */
function workspaces(): Space[] {
  const research = { parent: itemId('Research') };
  const reading = { role: 'read' } as const;
  return [
    home('ws-standup', 'Team standup', STANDUP_AT, ART, 'admin', 4, 'n2', [item('Onboarding fixes', 'document', PRIYA, 7.15)]),
    home('ws-pricing', 'Pricing sync', PRICING_AT, MAYA, 'edit', 3, 'n3', [item('Pricing draft', 'document', MAYA, 24.6)]),
    home('ws-review', 'Design review', REVIEW_AT, ART, 'admin', 4, 'n4', [
      item('Sidebar screenshots', 'document', KOFI, 28.3), item('Review uploads', 'document', AIKO, 28.9), item('Review checklist', 'document', ART, 28.6)
    ]),
    {
      id: 'ws-product', name: 'Product', role: 'admin', inCall: false, people: 6, createdAt: iso(-120, 10, 0), call: null,
      items: [
        item('Launch plan', 'document', PRIYA, 2, { made: 76 }), item('Launch checklist', 'document', MAYA, 5), item('Research', 'folder', LENA, 300),
        item('Interview notes', 'document', LENA, 120, research), item('Competitor notes', 'document', LENA, 170, research),
        item('Pricing page copy', 'document', LENA, 26, { restricted: true }), item('Launch retro', 'board', PRIYA, 1),
        item('Old roadmap', 'document', PRIYA, 900, { trashed: { hoursAgo: 20, by: PRIYA } }),
        item('Launch plan, first draft', 'document', ART, 260, { trashed: { hoursAgo: 70, by: ART } })
      ]
    },
    {
      id: 'ws-design', name: 'Design', role: 'edit', inCall: false, people: 4, createdAt: iso(-90, 14, 0), call: null,
      items: [item('Onboarding flow', 'board', AIKO, 50), item('Empty states', 'document', KOFI, 8)]
    },
    {
      id: 'ws-handbook', name: 'Company handbook', role: 'read', inCall: false, people: 38, createdAt: iso(-400, 9, 0), call: null,
      items: [item('Holidays', 'document', NADIA, 700, reading), item('Expenses', 'document', NADIA, 1300, reading), item('Working from home', 'document', NADIA, 2100, reading)]
    }
  ];
}
/**
 * What a demo account at the company can bring to a call: Product and Design, as the Drive has them, each item under its own
 * ID there (`item`) and the one a call keeps.
 */
function library(): DocumentLibrary {
  const doc = (workspace: string, name: string, kind: 'doc' | 'board', by: string, hoursAgo: number) =>
    ({ id: `${workspace}.${itemId(name)}`, item: itemId(name), name, kind, by, updatedAt: new Date(Date.parse(iso(0, 16, 12)) - hoursAgo * 3_600_000).toISOString() });
  return {
    workspaces: [
      {
        id: 'ws-product', name: 'Product', documents: [
          doc('ws-product', 'Launch retro', 'board', 'Priya', 1), doc('ws-product', 'Launch plan', 'doc', 'Priya', 2), doc('ws-product', 'Launch checklist', 'doc', 'Maya', 5),
          doc('ws-product', 'Pricing page copy', 'doc', 'Lena', 26)
        ]
      },
      { id: 'ws-design', name: 'Design', documents: [doc('ws-design', 'Onboarding flow', 'board', 'Aiko', 50)] }
    ]
  };
}

/* ---------- after the launch retro ---------- */

/** The launch retro's note, which the whiteboards canvas ends on. */
export const RETRO_NOTE = 'n-retro';
const RETRO_AT = iso(0, 14, 0);
/** The breakout rooms, each with a board of its own. */
const RETRO_ROOMS = ['Comms', 'Staging', 'Support'] as const;
/** A board open in the retro, as its note lists it for Art: saved in Product. */
function onTheNote(name: string, people: readonly Person[], room: string | null, everyone = true): NoteWorkedOn {
  return {
    workspaceId: 'ws-product', id: itemId(name), kind: 'board', name, by: people.flatMap((p) => (p.portrait ? [{ name: p.name, portrait: p.portrait, isMe: p.id === ART.id }] : [])),
    workspace: 'Product', room, everyone
  };
}
/** A breakout room's section of the retro, written from what was said and written in it alone. */
function retroRoom(id: string, name: string, people: readonly Person[], spec: Pick<NoteSpec, 'summary' | 'said' | 'actions'>): NoteRoom {
  const n = writeNote({ ...spec, id: `${RETRO_NOTE}-${id}`, title: name, startedAt: RETRO_AT, minutes: 45, organizer: ART, excerpt: '' });
  return {
    id, name, people: people.map((p) => ({ name: p.name, person: p })), from: 12 * 60, to: 22 * 60, summary: n.summary, decisions: n.decisions, questions: n.questions, actions: n.actions, suggestions: n.suggestions,
    chapters: n.chapters, gaps: [], transcript: (n.transcript ?? []).map((l) => ({ ...l, room: { id, name } }))
  };
}
/**
 * After the launch retro: Art's call this afternoon, with the launch retro open for everyone and a board in each of three
 * breakout rooms. Its note has, under the summary, the board and then each room's board beside the others', and the follow-ups
 * the notes took from its Actions frame; each room's section has the follow-ups from its own. Support's board isn't open to
 * everyone invited, so the summary left it out, and its follow-up is one Sam said. The boards are saved in Product.
 */
export function afterTheRetro(w: World): void {
  const spec: NoteSpec = {
    id: RETRO_NOTE, title: 'Launch retro', startedAt: RETRO_AT, minutes: 45, organizer: ART, invited: [PRIYA, THEO, KOFI, MAYA, LENA, SAM],
    excerpt: 'The launch went well, and comms and staging need owners.',
    summary: 'The launch went well, and comms and staging need owners. Each room took one problem and came back with next steps. Three follow-ups came off the board.',
    chapters: [['00:00', 'What went well', 'Sign-ups beat the plan.'], ['06:30', 'What could improve', 'Comms, staging and support.'], ['12:00', 'Breakout rooms', 'One problem each.'], ['24:00', 'Back together', 'Owners for each.']],
    said: [
      { at: '01:10', who: PRIYA, text: 'Beta sign-ups beat the plan, and support ran launch day with no queue.' },
      { at: '06:40', who: KOFI, text: 'Staging data was two days stale on launch day. That’s how the billing bug got through.' },
      { at: '24:30', who: ART, text: 'Every launch gets one comms owner from now on. Kofi, that’s you for the next one.' },
      { at: '31:15', who: PRIYA, text: 'I’ll send the launch numbers to everyone on Friday.' }
    ],
    decisions: [{ id: 'n-retro-d1', text: 'Every launch gets one comms owner.', at: '24:30', state: 'confirmed', by: ART }],
    actions: [
      { id: 'n-retro-a1', text: 'Send the launch numbers to everyone', at: '31:15', owner: PRIYA, takenOn: true, due: 'Friday' },
      { id: 'n-retro-b1', text: 'Kofi owns launch comms from now on', owner: KOFI, takenOn: true, board: true },
      { id: 'n-retro-b2', text: 'Refresh staging every night', owner: MAYA, board: true },
      { id: 'n-retro-b3', text: 'Write the launch runbook', owner: THEO, board: true }
    ]
  };
  const rooms = [
    retroRoom('room-comms', 'Comms', [PRIYA, THEO], {
      summary: 'Comms went out of order because nobody owned the date. One owner for launch comms, and one shared calendar.',
      said: [{ at: '13:20', who: PRIYA, text: 'The changelog went out after the launch post because nobody owned the date.' }],
      actions: [{ id: 'room-comms-b1', text: 'One owner for launch comms', owner: PRIYA, board: true }, { id: 'room-comms-b2', text: 'Keep one shared launch calendar', owner: THEO, board: true }]
    }),
    retroRoom('room-staging', 'Staging', [KOFI, MAYA], {
      summary: 'Staging was stale because the nightly job was off and nobody watches it. Refresh it every night, and alert when the job fails.',
      said: [{ at: '14:05', who: MAYA, text: 'The nightly job was off for two days and nobody noticed.' }],
      actions: [{ id: 'room-staging-b1', text: 'Refresh staging every night', owner: KOFI, board: true }, { id: 'room-staging-b2', text: 'Alert when the nightly job fails', owner: MAYA, board: true }]
    }),
    retroRoom('room-support', 'Support', [LENA, SAM], {
      summary: 'Support saw the docs late, so replies were out of date. Support joins the launch review from now on.',
      said: [
        { at: '15:40', who: LENA, text: 'We saw the new docs the morning of the launch.' },
        { at: '17:10', who: SAM, text: 'Support should be in the launch review from now on. I’ll ask for a seat.' }
      ],
      actions: [{ id: 'room-support-a1', text: 'Support joins the launch review', at: '17:10', owner: SAM, takenOn: true }]
    })
  ];
  const by = [PRIYA, KOFI, THEO];
  const note = {
    ...writeNote(spec), rooms,
    workedOn: [
      onTheNote('Launch retro', by, null), onTheNote('Comms board', [PRIYA, THEO], 'room-comms'), onTheNote('Staging board', [KOFI, MAYA], 'room-staging'),
      onTheNote('Support board', [LENA, SAM], 'room-support', false)
    ]
  };
  w.notes = [note, ...w.notes].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const product = w.workspaces.find((x) => x.id === 'ws-product');
  if (product) product.items = [...product.items, item('Comms board', 'board', PRIYA, 3), item('Staging board', 'board', KOFI, 3), item('Support board', 'board', LENA, 3)];
  for (const name of RETRO_ROOMS) w.boards[itemId(`${name} board`)] = roomBoard(name);
}

/** What the documents say, by their IDs. */
function pages(): Record<string, Page> {
  const named: [string, Page][] = [
    ['Launch plan', LAUNCH_PLAN], ['Launch checklist', LAUNCH_CHECKLIST], ['Interview notes', INTERVIEWS], ['Competitor notes', COMPETITORS],
    ['Pricing page copy', PRICING_COPY], ['Old roadmap', OLD_ROADMAP], ['Launch plan, first draft', FIRST_DRAFT], ['Empty states', EMPTY_STATES],
    ['Holidays', HOLIDAYS], ['Expenses', EXPENSES], ['Working from home', WORKING_FROM_HOME], ['Onboarding fixes', ONBOARDING_FIXES],
    ['Sidebar screenshots', SIDEBAR_SHOTS], ['Review uploads', REVIEW_UPLOADS], ['Review checklist', REVIEW_CHECKLIST], ['Pricing draft', PRICING_DRAFT]
  ];
  return Object.fromEntries(named.map(([name, page]) => [itemId(name), page]));
}
/** What the boards hold, and who's on them: the launch retro in Product, and the onboarding flow in Design. */
const boards = (): Record<string, BoardSpec> => ({ [itemId('Launch retro')]: RETRO, [itemId('Onboarding flow')]: FLOW });

/**
 * The files: in the design review's home its screenshots, drawn, its walkthrough, recorded, and the spec, a download; and in
 * the Launch plan two photos from the offsite and the timeline as a file, from Priya, this week.
 */
function files(): Kept[] {
  const doc = itemId('Sidebar screenshots');
  const frame = { width: 1600, height: 900 };
  const kept = (id: string, name: string, type: string, size: number, body: () => Promise<Blob>, shape: { width: number; height: number } | null): Kept => ({
    workspace: 'ws-review', body,
    media: { id, name, type, size, width: shape?.width ?? null, height: shape?.height ?? null, createdAt: iso(-1, 11, 40), documents: [doc] }
  });
  return [
    kept(MEDIA.light, 'Sidebar, light.png', 'image/png', 214_310, () => stillOf(SHOWN.light), frame),
    kept(MEDIA.dark, 'Sidebar, dark.png', 'image/png', 198_744, () => stillOf(SHOWN.dark), frame),
    kept(MEDIA.pricing, 'Pricing page.png', 'image/png', 176_020, () => stillOf(SHOWN.pricing), frame),
    kept(MEDIA.walkthrough, 'Sidebar walkthrough.webm', 'video/webm', 1_830_552, () => clipOf(SHOWN.walkthrough), frame),
    kept(MEDIA.spec, 'Sidebar spec.pdf', FILE_TYPE, 482_133, () => Promise.resolve(new Blob(['The sidebar, in both themes.'], { type: FILE_TYPE })), null),
    ...launchFiles()
  ];
}
/** Kofi tagged Art in the standup's onboarding fixes this afternoon: by name and face, never an address. */
const TAGGED: MentionNotice[] = [
  { id: 'tag-kofi-fixes', workspaceId: 'ws-standup', document: itemId('Onboarding fixes'), name: 'Onboarding fixes', block: null, by: { id: KOFI.id, name: KOFI.name, email: '', ...(KOFI.portrait ? { portrait: KOFI.portrait } : {}) }, at: iso(0, 15, 40) }
];
/** Who changed what during a call, as its note lists it for Art, in the call's home. */
function workedOn(workspaceId: string, workspace: string, name: string, people: readonly Person[]): NoteWorkedOn {
  return {
    workspaceId, id: itemId(name), kind: 'document', name, by: people.flatMap((p) => (p.portrait ? [{ name: p.name, portrait: p.portrait, isMe: p.id === ART.id }] : [])), workspace, room: null, everyone: true
  };
}

/** The launch plan reaches a designer outside the company and someone from sales; the pricing copy is closed to the workspace. */
function shares(): Record<string, ShareEntry[]> {
  const entry = (id: string, person: Person, role: DocumentRole, daysAgo: number): ShareEntry => ({ id, kind: 'email', person, role, since: iso(-daysAgo, 10, 0) });
  return {
    [itemId('Launch plan')]: [entry('share-jonas', JONAS, 'read', 6), entry('share-diego', DIEGO, 'edit', 2)],
    [itemId('Pricing page copy')]: [entry('share-maya', MAYA, 'edit', 3)]
  };
}

/** What the Launch plan has in it: two photos from the offsite and the timeline as a file, from Priya, this week. */
function launchFiles(): Kept[] {
  const plan = itemId('Launch plan');
  const picture = (name: string, hue: number, daysAgo: number): Kept => ({
    workspace: 'ws-product', body: () => drawnPicture(name.replace(/\.png$/, ''), hue, 1600, 1000),
    media: { id: itemId(`media ${name}`), name, type: 'image/png', size: 2_400_000, width: 1600, height: 1000, createdAt: iso(-daysAgo, 11, 0), documents: [plan] }
  });
  const words = 'Launch timeline\n\nMonday: freeze\nWednesday: press\nFriday: launch\n';
  return [
    picture('Offsite whiteboard.png', 205, 1), picture('Launch room.png', 28, 2),
    {
      workspace: 'ws-product', body: () => Promise.resolve(new Blob([words], { type: 'text/plain' })),
      media: { id: itemId('media Launch timeline'), name: 'Launch timeline.txt', type: 'application/octet-stream', size: words.length, width: null, height: null, createdAt: iso(-1, 9, 30), documents: [plan] }
    }
  ];
}

/** The canvas's busy Wednesday afternoon, at 16:12. */
function busy(): World {
  const notes = busyNotes();
  for (const n of notes) {
    if (n.id === 'n2') { n.additions = standupAdditions(); n.workedOn = [workedOn('ws-standup', homeName('Team standup', STANDUP_AT), 'Onboarding fixes', WORKED.standup)]; }
    if (n.id === 'n4') n.workedOn = [workedOn('ws-review', homeName('Design review', REVIEW_AT), 'Sidebar screenshots', WORKED.review), workedOn('ws-review', homeName('Design review', REVIEW_AT), 'Review checklist', WORKED.checklist)];
  }
  return {
    drive: disconnectedDrive(), payments: paymentsOff(), session: session(), prefs: { ...PREFS, pinned: ['n4', 'n6'], groups: GROUPS }, team: teamOf(DIRECTORY), notes, personal: { n2: standupOwn() },
    meetings: busyCalls(), calendar: connected(busyEvents()), credits: CREDITS, documents: library(), workspaces: workspaces(), pages: pages(), shares: shares(), boards: boards(),
    mentions: structuredClone(TAGGED), media: files(), rings: [], writing: null,
    // The bandwidth flag is on here and off in every other scenario, so both answers are served.
    featureFlags: ['call.bandwidth_reduction']
  };
}

/** Lots of everything: thirty people on Alcove, three months of notes, every group and pin, long names. */
function lots(): World {
  const w = busy();
  const people = MANY.filter((c) => c.onAlcove).map((c) => c.person);
  const pick = (i: number, n: number) => Array.from({ length: n }, (_, k) => people[(i * 7 + k * 3) % people.length]).filter((p): p is Person => p !== undefined);
  const TOPICS = [
    ['Weekly with the platform team', 'The new storage tier goes to every team in December, and the old one is read-only from then.'],
    ['Support handover', 'Three tickets need an answer before Friday, and the refund wording changes for everyone.'],
    ['Hiring sync', 'Two offers go out this week. The design role stays open until January.'],
    ['Quarterly planning: what goes into the first quarter of next year, and what waits until the summer', 'Three projects make the quarter, and the rest wait for the summer.'],
    ['Customer call: Harbourline', 'Harbourline wants notes in Portuguese for every handover, starting with the night shift.'],
    ['Security review', 'Keys rotate every ninety days, and the audit log goes to the security team only.']
  ] as const;
  const more: NoteSpec[] = Array.from({ length: 48 }, (_, i) => {
    const [title, excerpt] = TOPICS[i % TOPICS.length] ?? TOPICS[0];
    const invited = pick(i, 2 + (i % 5));
    const owner = invited[0] ?? PRIYA;
    return {
      id: `lot-${i}`, title, startedAt: iso(-3 - Math.floor(i * 1.8), 9 + (i % 8), (i * 13) % 60), minutes: 15 + ((i * 11) % 50), organizer: i % 3 === 0 ? owner : ART,
      invited: i % 3 === 0 ? [ART, ...invited.slice(1)] : invited, excerpt,
      said: [{ at: '02:10', who: owner, text: excerpt }],
      decisions: i % 4 === 0 ? [{ id: `lot-${i}-d`, text: excerpt.split(',')[0] ?? excerpt, at: '02:10', state: 'proposed' as const }] : [],
      actions: i % 2 === 0 ? [{ id: `lot-${i}-a`, text: 'Send the summary to everyone who wasn’t there', owner: ART, due: 'Friday' }] : []
    };
  });
  const extra = people.slice(5, 23);
  w.notes = [...w.notes, ...more.map((s) => writeNote(s))].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  w.team = teamOf(MANY);
  w.prefs = {
    ...w.prefs,
    pinned: ['n4', 'n6', 'n2', 'n3', 'lot-0', 'lot-1', 'lot-2', 'lot-3'],
    groups: [...GROUPS, ...Array.from({ length: 10 }, (_, i) => group(`g-${i}`, ['Engineering', 'Design critique', 'Support leads', 'Everyone in the London office', 'Hiring panel', 'Harbourline account team', 'Board', 'Security', 'Data', 'Marketing'][i] ?? `Group ${i}`, extra.slice(i, i + 3 + (i % 6))))]
  };
  w.meetings = [...w.meetings, ...Array.from({ length: 9 }, (_, i) => busyCalls()[i % 4]).flatMap((m, i) => (m ? [{ ...m, id: `${m.id}-${i}`, code: `${m.code.slice(0, 9)}${'abcdefghi'.charAt(i)}${m.code.slice(10)}`, startsAt: iso(1 + (i % 5), 9 + i, 0), endsAt: iso(1 + (i % 5), 9 + i, 45) }] : []))];
  return w;
}

/** Someone on their own: Art at a personal address, so no team and no groups, with recordings and calls with people he meets. */
function onTheirOwn(): World {
  const solo: Person = { ...ART, id: 'o-art-personal', email: 'art@personal.example' };
  const specs: NoteSpec[] = [
    {
      id: 'p1', title: 'Contract review with Ana', startedAt: iso(0, 11, 0), minutes: 28, organizer: solo, invited: [ANA],
      excerpt: 'The contract renews in January, and the notice period drops to thirty days.',
      said: [{ at: '03:40', who: ANA, text: 'It renews in January unless you give notice, and the notice period is thirty days now.' }, { at: '12:05', who: solo, text: 'I’ll send the signed copy back by Friday.' }],
      decisions: [{ id: 'p1-d1', text: 'The notice period drops to thirty days.', at: '03:40', state: 'proposed' }],
      actions: [{ id: 'p1-a1', text: 'Send the signed copy back', at: '12:05', owner: solo, due: 'Friday' }]
    },
    {
      id: 'p2', kind: 'room', title: 'Interview: Jonas Weber', startedAt: iso(-2, 14, 10), minutes: 52, organizer: solo,
      excerpt: 'Strong on distributed systems. Wants to stay close to customers.',
      said: [{ at: '11:30', text: 'Most of my work has been distributed systems: consensus, storage, the boring parts.' }]
    },
    {
      id: 'p3', title: 'Portfolio call with Jonas', startedAt: iso(-6, 10, 0), minutes: 35, organizer: solo, invited: [JONAS],
      excerpt: 'Jonas walks through three projects. The storage one is the strongest.',
      said: [{ at: '20:15', who: JONAS, text: 'The storage project is the one I’d want to talk about most.' }]
    }
  ];
  return {
    drive: disconnectedDrive(), payments: paymentsOff(), session: session({ user: solo, ownerId: solo.id }), prefs: PREFS, team: null, notes: specs.map((s) => writeNote(s, solo)), personal: {},
    meetings: [], calendar: connected([]), credits: CREDITS, documents: { workspaces: [{ id: 'own', name: 'Your documents', documents: [] }] },
    workspaces: [], pages: {}, shares: {}, boards: {}, mentions: [], media: [], rings: [], writing: null
  };
}

/* ---------- the scenarios ---------- */

export const SCENARIOS: Record<ScenarioName, Scenario> = {
  payments: {
    title: 'Credit top-ups', about: 'Art can add credits with a stablecoin; every payment address is an invalid Storybook preview.',
    make: () => { const world = busy(); withPayments(world); return { world, opening: {} }; }
  },
  'drive-connected': {
    title: 'Google Drive exports', about: 'Art sends finalized call files to a chosen folder, with completed, uploading, pending and failed exports.',
    make: () => { const world = busy(); withDriveExports(world); return { world, opening: {} }; }
  },
  'agents-connected': {
    title: 'Agents connected', about: 'Art has Claude signed in (it booked the onboarding review 4 minutes ago), Cursor signed in to read, and a Weekly digest token, with three weeks of what they did.',
    make: () => { const world = busy(); withAgentConnections(world); return { world, opening: {} }; }
  },
  'agents-ending': {
    title: 'An agent’s access ending', about: 'The same three agents, with Cursor’s access ending tomorrow.',
    make: () => { const world = busy(); withAgentEnding(world); return { world, opening: {} }; }
  },
  busy: { title: 'A busy team', about: 'Wednesday afternoon at Vandelay Industries: a day of notes, things waiting on you, a design sync at 17:30.', make: () => ({ world: busy(), opening: {} }) },
  'first-day': {
    title: 'A first day', about: 'Art has just signed in for the first time: no notes, no calls, a team that isn’t on Alcove yet, and no calendar access.',
    make: () => ({
      world: {
        drive: disconnectedDrive(), payments: paymentsOff(), session: session({ createdAt: iso(0, 16, 5) }), prefs: PREFS, team: teamOf(DIRECTORY.filter((c) => c.person !== INES && c.person !== AIKO).map((c): Colleague => ({ ...c, onAlcove: false, invited: false }))),
        notes: [], personal: {}, meetings: [], calendar: notConnected, credits: WELCOME_CREDITS, documents: library(), workspaces: [], pages: {}, shares: {}, boards: {}, mentions: [], media: [], rings: [], writing: null
      },
      opening: { tourSeen: false }
    })
  },
  'on-their-own': { title: 'Someone on their own', about: 'Art at a personal address: no team, no groups, recordings and calls with people he meets.', make: () => ({ world: onTheirOwn(), opening: {} }) },
  offline: {
    title: 'Offline', about: 'The busy afternoon, opened with no connection by someone signed in on this browser: Record works, every other page says it’s offline.',
    make: () => ({ world: busy(), opening: { browser: { online: false }, signedInHere: true } })
  },
  writing: {
    title: 'A note being written', about: 'The busy afternoon, just after the pricing follow-up ended: its notes are written over a few seconds, and a walkthrough is recording on another device.',
    make: () => {
      const w = busy();
      w.notes = [writeNote(walkthrough), writeNote(pricingFollowUp), ...w.notes];
      w.writing = { id: 'n0', seconds: 12, written: pricingFollowUpWritten };
      return { world: w, opening: {} };
    }
  },
  'call-soon': {
    title: 'A call about to start', about: 'Wednesday at 10:26: the design review with Priya, Kofi and Aiko starts in four minutes, and the day is still ahead.',
    make: () => {
      const w = busy();
      w.notes = w.notes.filter((n) => Date.parse(n.startedAt) < Date.parse(iso(0, 10, 26)) && n.id !== 'n1');
      w.meetings = soonCalls();
      return { world: w, opening: { now: on(0, 10, 26) } };
    }
  },
  lots: { title: 'Lots of everything', about: 'Thirty people on Alcove, three months of notes, eight pins, a dozen groups, long names.', make: () => ({ world: lots(), opening: {} }) },
  'signed-out': {
    title: 'Signed out', about: 'Nobody is signed in on this browser: the welcome page. Microsoft or single sign-on signs Art in, to the busy afternoon.',
    make: () => ({ world: { ...busy(), session: null }, opening: {} })
  },
  unsaved: {
    title: 'Edits that didn’t save',
    about: 'The busy afternoon, after Alcove wouldn’t take some of what Art wrote: his last edits to the pricing copy, more interview notes than one document holds, and a line in the handbook, which he can only read now.',
    make: () => {
      const w = busy();
      const refuse = (name: string, why: Refused['why'], words: string[]) => {
        const id = itemId(name);
        const page = w.pages[id];
        if (page) w.pages[id] = { ...page, refused: { why, words } };
      };
      refuse('Pricing page copy', 'rejected', ['Every seat gets 300 free minutes a month.']);
      refuse('Interview notes', 'too-large', ['Interview 6, the whole transcript, pasted from the recording.']);
      refuse('Expenses', 'read-only', ['Trains over four hours can be first class.']);
      return { world: w, opening: {} };
    }
  },
  'first-sign-in': {
    title: 'Signing in for the first time', about: 'Nobody is signed in, and Art has no account yet: signing in makes it on screen, opens on his first day, and the tour of Home follows.',
    make: () => ({ world: { ...SCENARIOS['first-day'].make().world, session: null }, opening: { tourSeen: false } })
  }
};
export const SCENARIO_NAMES = Object.keys(SCENARIOS).filter((k): k is ScenarioName => k in SCENARIOS);
export const isScenario = (v: unknown): v is ScenarioName => typeof v === 'string' && v in SCENARIOS;

/** Checks the world against the contract's own schemas, so a story never shows something the API could never send. */
export function checked(w: World): World {
  const checks = [
    ['drive settings', DriveSettingsSchema.safeParse(w.drive.settings)], ['drive folders', DriveFolderSchema.array().safeParse(w.drive.folders)],
    ['drive jobs', DriveExportJobSchema.array().safeParse(w.drive.jobs)], ['drive overrides', DriveExportChoiceSchema.array().safeParse(Object.values(w.drive.overrides))],
    ['session', SessionSchema.nullable().safeParse(w.session)], ['prefs', PreferencesSchema.safeParse(w.prefs)], ['team', TeamSchema.nullable().safeParse(w.team)],
    ['notes', NoteSchema.array().safeParse(w.notes)], ['meetings', MeetingSchema.array().safeParse(w.meetings)], ['calendar', CalendarSchema.safeParse(w.calendar)],
    ['payment routes', TopUpRoutesSchema.nullable().safeParse(w.payments.routes)], ['top-ups', TopUpSchema.array().safeParse(w.payments.topUps)],
    ['credits', CreditBalanceSchema.safeParse(w.credits)], ['documents', DocumentLibrarySchema.safeParse(w.documents)], ['workspaces', WorkspaceTreeSchema.array().safeParse(w.workspaces)],
    ['rings', IncomingRingSchema.array().safeParse(w.rings)], ['personal', PersonalEntrySchema.array().safeParse(Object.values(w.personal).flat())],
    ['shares', ShareEntrySchema.array().safeParse(Object.values(w.shares).flat())],
    ['drive', WorkspaceSummarySchema.array().safeParse(w.workspaces)], ['mentions', MentionNoticeSchema.array().safeParse(w.mentions)],
    ['media', WorkspaceMediaSchema.array().safeParse(w.media.map((m) => m.media))]
  ] as const;
  const bad = checks.flatMap(([what, r]) => (r.success ? [] : [`${what}: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`]));
  if (bad.length) throw new Error(`The demo world doesn’t fit the contract. ${bad.join(' · ')}`);
  return w;
}

/** The app's theme in this browser, which the toolbar sets. */
const THEME = 'alcove-theme';

/** What this browser remembers, as the scenario has it: nothing else from an earlier story (but the theme the toolbar chose). */
function remember(o: Opening, w: World): void {
  try {
    if (!o.browser.sharedNotificationBrowser) for (const k of Object.keys(localStorage)) if (k.startsWith('alcove') && k !== THEME && k !== 'alcove:log') localStorage.removeItem(k);
    sessionStorage.clear();
    const owner = w.session?.ownerId ?? ME_ID;
    if (o.tourSeen) localStorage.setItem(`alcove.tour.${owner}`, JSON.stringify({ seenAt: iso(-30, 9, 0) }));
    // Someone who's seen the tour has pointed at a call's tiles before, too: a story shows what that says by forgetting it.
    if (o.tourSeen) for (const k of [tileHintKey(owner), tileHintKey(null)]) localStorage.setItem(k, '1');
    if (o.signedInHere) localStorage.setItem('alcove.signedIn', JSON.stringify({ ownerId: owner, until: iso(14, 9, 0), recordOffline: w.prefs.recordOffline }));
  } catch {
    // A browser without storage starts with nothing remembered, as the app does.
  }
  indexedDB.deleteDatabase('alcove-offline');
}

/**
 * Starts a scenario for a story: whatever the last story left running stops, the world is made fresh and checked, and the
 * clock, the browser and what it remembers are set as the scenario (and the story's own `opening`) say. Returns its name.
 */
export function begin(name: ScenarioName, over: Partial<Opening> = {}): ScenarioName {
  stopLive();
  forgetAudio();
  forgetDocuments();
  sessions.call = null;
  sessions.recording = null;
  // The last story's microphone and camera (a call's, or a pre-join's) stop with it.
  sessions.media?.stop();
  sessions.media = null;
  sessions.roomTitle = null;
  sessions.arrive = null;
  // Recordings the last story kept on this device go with it (`remember` deletes them), and Record lists what's here afresh.
  forgetKeptHere();
  const { world, opening } = SCENARIOS[name].make();
  const o: Opening = { ...QUIET, ...opening, ...over, browser: { ...opening.browser, ...over.browser } };
  if (o.browser.sharedNotificationBrowser) {
    // A real browser shares one wall clock. These explicit two-tab scenes must share their demo-clock anchor too.
    const wall = performance.timeOrigin + performance.now();
    let anchor = wall;
    try {
      const raw = localStorage.getItem('alcove.storybook.notification-clock');
      const stored = ISODateSchema.safeParse(raw);
      const previous = stored.success ? Date.parse(stored.data) : NaN;
      if (Number.isFinite(previous) && wall >= previous && wall - previous < 3_600_000) anchor = previous;
      else localStorage.setItem('alcove.storybook.notification-clock', new Date(wall).toISOString());
    } catch { /* Native delivery still works; this scene needs writable storage to coordinate two tabs. */ }
    setClock(new Date(o.now.getTime() + wall - anchor));
  } else setClock(o.now);
  openBrowser(o.browser);
  remember(o, world);
  serve(checked(world), o);
  return name;
}
