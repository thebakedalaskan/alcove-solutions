/*
 * The named worlds the stand-in serves. A story picks one (`parameters.scenario`, or the `scenario` arg), and the preview
 * starts it before the story renders: a fresh world, the demo clock at the scenario's moment, the browser as it says, and
 * what this browser remembers. Add a scenario here, with a line in apps/storybook/README.md, when a page has a state none
 * of these reach.
 */
import {
  TopUpSchema, TopUpRoutesSchema, PlanOffersSchema, ISODateSchema, DriveExportChoiceSchema, DriveExportJobSchema, DriveFolderSchema, DriveSettingsSchema, FILE_TYPE, CalendarSchema,
  DocumentLibrarySchema, IncomingRingSchema, MeetingSchema, NoteSchema, PersonalEntrySchema, PlanSchema, PreferencesSchema, MentionNoticeSchema, SessionSchema, ShareEntrySchema, TeamSchema,
  WorkspaceMediaSchema, WorkspaceSummarySchema, WorkspaceTreeSchema, type DocumentLibrary, type DocumentRole, type Group, type ItemCall, type MentionNotice, type NoteRoom, type NoteWorkedOn,
  type Person, type ShareEntry, type WorkspaceItem, type WorkspaceRole, MyTeamSchema, type PlanNotice
} from '@alcove/api';
import { tileHintKey } from '~/features/call/layout/view';
import { returnTo } from '~/lib/afterSignIn';
import { sessions } from '~/lib/live';
import { openBrowser } from '../browser';
import { busyCalls, busyEvents, soonCalls } from '../world/calls';
import { connected, notConnected, writeNote, type NoteSpec } from '../world/build';
import { iso, on, setClock } from '../world/clock';
import { clipOf, stillOf } from '../media/screens';
import { PREFS, session, type BoardSpec, type Kept, type Opening, type Page, type Refused, type Space, type World } from '../world';
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
import { buyingWith, paymentsOff, PREVIEW_PAID_TOP_UP, PREVIEW_TOP_UP, PRO_YEAR, purchaseTopUp, raisePrices, TEAM_SIX, topUpOf, withPayments, type PaymentPlay } from '../world/payments';
import { carriedOver, freePlan, inGrace, newPlan, notesStopped, overLimits, proEnded, proEnding, proEndingPriceRose, proExtended, proPlan, proRenewed, PRO_YEARLY_PRICE, withBalance, withNotesLeft } from '../world/plans';
import { disconnectedDrive, withDriveExports } from '../world/drive-exports';
import { homesOn } from '../world/call-page';
import { withAgentConnections, withAgentEnding, withClaudeJustConnected } from './agents';
import { planWithTeam, priyasTeam, startedTeam, teamView, vandelayTeam, type TeamWorld } from '../world/teams';
import { serve } from './state';
import { forgetDocuments, summaryOf } from './workspaces';

export type ScenarioName = 'busy' | 'first-day' | 'on-their-own' | 'offline' | 'writing' | 'call-soon' | 'lots' | 'signed-out' | 'unsaved' | 'first-sign-in' | 'agents-connected' | 'agents-ending' | 'agents-just-connected' | 'drive-connected' | 'payments'
  | 'plan-low' | 'plan-stopped' | 'plan-grace' | 'plan-over' | 'plan-balance' | 'plan-pro' | 'plan-pro-ending' | 'plan-pro-ending-price' | 'plan-pro-renewed' | 'plan-pro-ended'
  | 'plan-buying-pro' | 'plan-pro-extended'
  | 'plan-waiting' | 'payment-short' | 'payment-over' | 'payment-refused' | 'payment-expired' | 'payment-failed'
  | 'team-admin' | 'team-admin-low' | 'team-admin-none' | 'team-member' | 'team-member-unlicensed' | 'team-join' | 'no-team'
  | 'team-buying' | 'plan-choice' | 'plan-choice-before';

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
  return {
    id, name, role, inCall: false, people, teamAccess: null, createdAt: at, call: { title, at }, items: [item(name, 'folder', organizer, hours, { call: { startedAt: at, on: false, here: false, noteId } }), ...items],
    // A call's home is on its organizer's plan.
    paidBy: organizer
  };
}
/**
 * The workspaces: the homes of the day's calls, the standup's newest; Product, which Art runs; Design, where Art edits and Aiko
 * pays; and the company handbook, which Art can only read.
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
      id: 'ws-product', name: 'Product', role: 'admin', inCall: false, people: 6, teamAccess: null, createdAt: iso(-120, 10, 0), call: null,
      items: [
        item('Launch plan', 'document', PRIYA, 2, { made: 76 }), item('Launch checklist', 'document', MAYA, 5), item('Research', 'folder', LENA, 300),
        item('Interview notes', 'document', LENA, 120, research), item('Competitor notes', 'document', LENA, 170, research),
        item('Pricing page copy', 'document', LENA, 26, { restricted: true }), item('Launch retro', 'board', PRIYA, 1),
        item('Old roadmap', 'document', PRIYA, 900, { trashed: { hoursAgo: 20, by: PRIYA } }),
        item('Launch plan, first draft', 'document', ART, 260, { trashed: { hoursAgo: 70, by: ART } })
      ]
    },
    {
      id: 'ws-design', name: 'Design', role: 'edit', inCall: false, people: 4, teamAccess: null, createdAt: iso(-90, 14, 0), call: null, paidBy: AIKO,
      items: [item('Onboarding flow', 'board', AIKO, 50), item('Empty states', 'document', KOFI, 8)]
    },
    {
      id: 'ws-handbook', name: 'Company handbook', role: 'read', inCall: false, people: 38, teamAccess: null, createdAt: iso(-400, 9, 0), call: null,
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
  const spaces = workspaces();
  for (const n of notes) {
    if (n.id === 'n2') { n.additions = standupAdditions(); n.workedOn = [workedOn('ws-standup', homeName('Team standup', STANDUP_AT), 'Onboarding fixes', WORKED.standup)]; }
    if (n.id === 'n4') n.workedOn = [workedOn('ws-review', homeName('Design review', REVIEW_AT), 'Sidebar screenshots', WORKED.review), workedOn('ws-review', homeName('Design review', REVIEW_AT), 'Review checklist', WORKED.checklist)];
  }
  homesOn(notes, spaces);
  return {
    drive: disconnectedDrive(), payments: paymentsOff(), session: session(), prefs: { ...PREFS, pinned: ['n4', 'n6'], groups: GROUPS }, team: teamOf(DIRECTORY), notes, personal: { n2: standupOwn() },
    meetings: busyCalls(), calendar: connected(busyEvents()), plan: freePlan(), documents: library(), workspaces: spaces, pages: pages(), shares: shares(), boards: boards(),
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

/** Someone on their own: Art at a personal address, so no team and no groups, with recordings and calls with people Art meets. */
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
    meetings: [], calendar: connected([]), plan: freePlan(), documents: { workspaces: [{ id: 'own', name: 'Your documents', documents: [] }] },
    workspaces: [], pages: {}, shares: {}, boards: {}, mentions: [], media: [], rings: [], writing: null
  };
}

/* ---------- a team ---------- */

/** The secret of the invite `team-join` opens. Made up: it joins nothing outside Storybook. */
export const TEAM_INVITE_SECRET = 'VandelayInviteStorybook0001';
/**
 * The busy afternoon on Vandelay's team (src/world/teams.ts): `team` as it stands, `admin` whether Art runs it, `change`
 * anything else, and the plan as the team makes it, with $180 in the balance.
 */
function onTeam(team: TeamWorld, change: (t: TeamWorld, w: World) => void = () => {}): World {
  const w = busy();
  withPayments(w);
  // The licenses are the admin's to buy: a member's balance never paid for any.
  const admin = team.members.some((m) => m.person === ART && m.role === 'admin');
  w.plan = {
    ...freePlan(),
    balance: {
      microUsd: 180_000_000,
      history: admin
        ? [{ id: 'sb-entry-1', at: iso(-12, 9, 0), label: 'Added, 300 USDC', microUsd: 300_000_000 }, { id: 'sb-entry-team', at: iso(-12, 9, 5), label: 'Team, 3 licenses', microUsd: -120_000_000 }]
        : [{ id: 'sb-entry-1', at: iso(-12, 9, 0), label: 'Added, 180 USDC', microUsd: 180_000_000 }]
    }
  };
  w.myTeam = team;
  change(team, w);
  // A team note of Art's own: the standup, visible to the team.
  w.notes = w.notes.map((n) => (n.id === 'n2' ? { ...n, teamVisible: true } : n));
  w.plan = { ...planWithTeam(w.plan, team, ART.email, on(0, 16, 12).getTime()), notes: { minutesLeft: 2380, minutesPerPeriod: 3000, stopped: false } };
  return w;
}
/**
 * Priya's link to join Vandelay's team (which has licenses left, and Art isn't on) in the world, waiting in this tab as it
 * does while signing in from it: Storybook can't put a secret in the page's address. `expired`: it ran out a minute ago.
 */
export const withTeamInvite = (expired = false) => (w: World): void => {
  const team = vandelayTeam();
  team.members = team.members.filter((m) => m.person !== ART).map((m) => (m.person === PRIYA ? { ...m, role: 'admin' } : m));
  w.teamInvites = [{ secret: TEAM_INVITE_SECRET, expiresAt: new Date(Date.now() + (expired ? -60_000 : 4 * 3_600_000)).toISOString(), team, admin: PRIYA }];
  returnTo({ to: 'team', secret: TEAM_INVITE_SECRET });
};
const teamNotice = (id: string, kind: PlanNotice['kind'], count: number | null, at = iso(0, 11, 20)): PlanNotice => ({ id, kind, at, until: null, count });

/* ---------- the scenarios ---------- */

/** The busy afternoon with payments taken, where a payment opened to buy something goes as `play` says. */
const paymentGoes = (title: string, about: string, play: PaymentPlay): Scenario => ({
  title, about, make: () => { const world = busy(); withPayments(world, play); return { world, opening: {} }; }
});

export const SCENARIOS: Record<ScenarioName, Scenario> = {
  'team-admin': {
    title: 'A team, as its admin', about: 'Art runs Vandelay’s team: six people, Maya’s license ran out last week, three licenses left, auto-purchase off, $180 in the balance.',
    make: () => ({ world: onTeam(vandelayTeam()), opening: {} })
  },
  'team-admin-low': {
    title: 'Team licenses running low', about: 'Two licenses are left on Art’s team, and Art is told so.',
    make: () => {
      const world = onTeam(vandelayTeam(), (t) => { t.unconsumed = t.unconsumed.slice(1); });
      world.plan = { ...world.plan, notices: [teamNotice('sb-notice-low', 'licenses-low', 2)] };
      return { world, opening: {} };
    }
  },
  'team-admin-none': {
    title: 'No team licenses left', about: 'Maya came back this morning and needed a license, but none was left: Maya waits, and Art is told.',
    make: () => {
      const world = onTeam(vandelayTeam(), (t) => {
        t.unconsumed = [];
        t.members = t.members.map((m) => (m.person === MAYA ? { ...m, wanted: iso(0, 11, 20) } : m));
      });
      world.plan = { ...world.plan, notices: [teamNotice('sb-notice-none', 'licenses-none', null)] };
      return { world, opening: {} };
    }
  },
  'team-member': {
    title: 'On a team, licensed', about: 'Art is on Priya’s team with a live license: the team’s notes and workspaces are open to Art.',
    make: () => ({ world: onTeam(priyasTeam()), opening: {} })
  },
  'team-member-unlicensed': {
    title: 'On a team, without a license', about: 'Art’s license ran out and there was none to take: Art is on Free, and told to ask Priya.',
    make: () => {
      const world = onTeam(priyasTeam(), (t) => {
        t.unconsumed = [];
        t.members = t.members.map((m) => (m.person === ART ? { ...m, license: { from: iso(-32, 9, 0), until: iso(-2, 9, 0) }, wanted: iso(0, 9, 5) } : m));
      });
      world.plan = { ...freePlan(), balance: world.plan.balance, team: world.plan.team, notices: [teamNotice('sb-notice-needed', 'license-needed', null, iso(0, 9, 5))] };
      return { world, opening: {} };
    }
  },
  'team-join': {
    title: 'An invite to a team', about: 'Art isn’t on a team, and has Priya’s link to join Vandelay’s, which has licenses left.',
    make: () => { const world = busy(); withTeamInvite()(world); return { world, opening: {} }; }
  },
  'no-team': {
    title: 'Not on a team', about: 'The busy afternoon: Vandelay’s directory, and Start a team on the Team page.',
    make: () => { const world = busy(); withPayments(world); world.plan = withBalance(); return { world, opening: {} }; }
  },
  'plan-low': {
    title: 'Notes nearly out', about: 'Art is on Free with about 20 minutes of the period’s notes left, and the sun near the start of the line.',
    make: () => { const world = busy(); world.plan = withNotesLeft(20); return { world, opening: {} }; }
  },
  'plan-stopped': {
    title: 'Notes stopped', about: 'Art is on Free and the period’s notes have run out: they stop until it renews, and calls go on without them.',
    make: () => { const world = busy(); world.plan = notesStopped(); return { world, opening: {} }; }
  },
  'plan-grace': {
    title: 'Over Free’s storage, in grace', about: 'Art stores 14.2 GB of Free’s 10: everything works as before for nine more days.',
    make: () => { const world = busy(); world.plan = inGrace(); return { world, opening: {} }; }
  },
  'plan-over': {
    title: 'Over Free’s storage, past the grace', about: 'The grace is over: uploads have stopped.',
    make: () => { const world = busy(); world.plan = overLimits(); return { world, opening: {} }; }
  },
  'plan-balance': {
    title: 'A balance', about: 'Art has $60 in their balance, with a $20 top-up waiting for its payment and a $40 one already added.',
    make: () => {
      const world = busy();
      withPayments(world);
      world.plan = withBalance();
      world.payments.topUps = [topUpOf(PREVIEW_TOP_UP, 'waiting', 20), topUpOf(PREVIEW_PAID_TOP_UP, 'credited', 40, true)];
      return { world, opening: {} };
    }
  },
  'plan-pro': {
    title: 'On Pro', about: 'Art bought three months of Pro ten days ago: the month running and two after it, renewing off, with $35 left in the balance.',
    make: () => { const world = busy(); withPayments(world); world.plan = proPlan(); return { world, opening: {} }; }
  },
  'plan-pro-ending': {
    title: 'Pro ending', about: 'Art’s Pro ends in 3 days and won’t renew: renewing is off and $5 doesn’t buy a month. Art is told so.',
    make: () => { const world = busy(); withPayments(world); world.plan = proEnding(); return { world, opening: {} }; }
  },
  'plan-pro-ending-price': {
    title: 'Pro ending, at a higher price', about: 'Art’s Pro ends in 3 days and won’t renew, though renewing is on and $60 is in the balance: a month of Pro costs $24 now, more than the $20 the last did, and renewing never pays a higher price without Art. Art is told Pro is ending.',
    make: () => { const world = busy(); withPayments(world); raisePrices(world); world.plan = proEndingPriceRose(); return { world, opening: {} }; }
  },
  'plan-pro-renewed': {
    title: 'Pro renewed', about: 'Renewing is on, so 3 days before Pro ended a month was bought from the balance, and Art is told it runs a month further.',
    make: () => { const world = busy(); withPayments(world); world.plan = proRenewed(); return { world, opening: {} }; }
  },
  'plan-pro-ended': {
    title: 'Pro ended', about: 'Pro ended two days ago: Art is on Free, over its storage with 14.2 GB, and everything works as before for 13 more days.',
    make: () => { const world = busy(); withPayments(world); world.plan = proEnded(); return { world, opening: {} }; }
  },
  'plan-buying-pro': {
    title: 'Paying for Pro', about: 'Art is on Free and has opened a payment of 192 USDC on Base for a year of Pro at the yearly price, and closed checkout: it waits for the payment.',
    make: () => {
      const world = busy();
      withPayments(world);
      world.payments.topUps = [buyingWith(PREVIEW_TOP_UP, { kind: 'pro', months: 12, microUsdPerMonth: PRO_YEARLY_PRICE }, 192)];
      return { world, opening: {} };
    }
  },
  'plan-pro-extended': {
    title: 'Pro, extended', about: 'Art extended Pro by a year yesterday, paid with 192 USDC on Base at the yearly price: the month running and twelve after it, $5 left.',
    make: () => { const world = busy(); withPayments(world); world.plan = proExtended(); return { world, opening: {} }; }
  },
  payments: {
    title: 'Adding money', about: 'Art can add money to their balance with a stablecoin; every payment address is an invalid Storybook preview. A payment opened to buy something is seen, added and bought a few seconds apart.',
    make: () => { const world = busy(); withPayments(world); return { world, opening: {} }; }
  },
  'plan-waiting': {
    title: 'A payment on its way', about: 'Art is on Free with a payment of 192 USDC on Base on its way, opened to buy 12 months of Pro: nothing has been sent to its address yet.',
    make: () => {
      const world = busy();
      withPayments(world, 'waits');
      world.payments.topUps = [purchaseTopUp(PREVIEW_TOP_UP, PRO_YEAR, 192, iso(1, 16, 12))];
      return { world, opening: {} };
    }
  },
  'payment-short': paymentGoes('Less than asked arrives', 'A payment opened to buy something: two thirds of it arrive, and the same address waits for the rest.', 'short'),
  'payment-over': paymentGoes('More than asked arrives', 'A payment opened to buy something: 6 USDC more than asked arrives. It’s bought, and the rest stays in the balance.', 'over'),
  'payment-refused': paymentGoes('Bought, refused', 'A payment opened to buy something arrives after the prices went up: it’s added to the balance, and what it was for isn’t bought at the old price.', 'refused'),
  'payment-expired': paymentGoes('Nothing arrives', 'A payment opened to buy something: nothing arrives before its address closes, and nothing is charged.', 'expires'),
  'payment-failed': paymentGoes('A payment fails', 'A payment opened to buy something is seen, then 1Click fails it: it needs support, with its reference.', 'fails'),
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
  'agents-just-connected': {
    title: 'An agent just connected', about: 'Art allowed Claude a few minutes ago and hasn’t asked it anything yet, so it hasn’t done anything.',
    make: () => { const world = busy(); withClaudeJustConnected(world); return { world, opening: {} }; }
  },
  busy: { title: 'A busy team', about: 'Wednesday afternoon at Vandelay Industries: a day of notes, things waiting on you, a design sync at 17:30.', make: () => ({ world: busy(), opening: {} }) },
  'first-day': {
    title: 'A first day', about: 'Art has just signed in for the first time and carried on with Free: no notes, no calls, a team that isn’t on Alcove yet, and no calendar access.',
    make: () => ({
      world: {
        drive: disconnectedDrive(), payments: paymentsOff(), session: session({ createdAt: iso(0, 16, 5) }), prefs: PREFS, team: teamOf(DIRECTORY.filter((c) => c.person !== INES && c.person !== AIKO).map((c): Colleague => ({ ...c, onAlcove: false, invited: false }))),
        // Past the plans, which a new account sees first (`plan-choice`), so Home is Home.
        notes: [], personal: {}, meetings: [], calendar: notConnected, plan: { ...newPlan(), choose: false }, documents: library(), workspaces: [], pages: {}, shares: {}, boards: {}, mentions: [], media: [], rings: [], writing: null
      },
      opening: { tourSeen: false }
    })
  },
  'plan-choice': {
    title: 'Choosing a plan', about: 'Art’s account was made a few minutes ago, and the plans haven’t been shown yet: Home opens on them, once. Payments are taken.',
    make: () => {
      const { world, opening } = SCENARIOS['first-day'].make();
      world.plan = newPlan();
      withPayments(world);
      return { world, opening };
    }
  },
  'plan-choice-before': {
    title: 'Plans, new to an account from before them', about: 'Art has used Alcove for weeks, and the release that brought plans put the account on Free two days ago: the busy afternoon, and Home opens on the plans, once. Payments are taken.',
    make: () => { const world = busy(); withPayments(world); world.plan = carriedOver(); return { world, opening: {} }; }
  },
  'on-their-own': { title: 'Someone on their own', about: 'Art at a personal address: no team, no groups, recordings and calls with people Art meets.', make: () => ({ world: onTheirOwn(), opening: {} }) },
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
    about: 'The busy afternoon, after Alcove wouldn’t take some of what Art wrote: the last edits to the pricing copy, more interview notes than one document holds, and a line in the handbook, which Art can only read now.',
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
    title: 'Signing in for the first time', about: 'Nobody is signed in, and Art has no account yet: signing in makes it on screen and opens on the plans to choose from, then Art’s first day, and the tour of Home follows.',
    make: () => ({ world: { ...SCENARIOS['first-day'].make().world, session: null, plan: newPlan() }, opening: { tourSeen: false } })
  },
  'team-buying': {
    title: 'Starting a team, paying', about: 'Art started Vandelay’s team from Plans and opened a payment of 240 USDC on Base for its first six licenses, then closed checkout: the team is Art’s, with nothing bought yet, and the payment waits.',
    make: () => {
      const world = busy();
      withPayments(world, 'waits');
      world.myTeam = startedTeam(world.plan.storage.usedBytes);
      world.plan = planWithTeam(world.plan, world.myTeam, ART.email, on(0, 16, 12).getTime());
      world.payments.topUps = [purchaseTopUp(PREVIEW_TOP_UP, TEAM_SIX, 240, iso(1, 16, 12))];
      return { world, opening: {} };
    }
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
    ['offers', PlanOffersSchema.safeParse(w.payments.offers)],
    ['plan', PlanSchema.safeParse(w.plan)], ['documents', DocumentLibrarySchema.safeParse(w.documents)], ['workspaces', WorkspaceTreeSchema.array().safeParse(w.workspaces)],
    ['rings', IncomingRingSchema.array().safeParse(w.rings)], ['personal', PersonalEntrySchema.array().safeParse(Object.values(w.personal).flat())],
    ['shares', ShareEntrySchema.array().safeParse(Object.values(w.shares).flat())],
    ['drive', WorkspaceSummarySchema.array().safeParse(w.workspaces.map((x) => summaryOf(x, w.session?.user ?? ART)))], ['mentions', MentionNoticeSchema.array().safeParse(w.mentions)],
    ['media', WorkspaceMediaSchema.array().safeParse(w.media.map((m) => m.media))],
    ['team', MyTeamSchema.nullable().safeParse(w.myTeam ? teamView(w.myTeam, w.session?.user.email ?? ART.email) : null)]
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
