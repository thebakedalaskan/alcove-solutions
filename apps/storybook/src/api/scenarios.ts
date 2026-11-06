/*
 * The named worlds the stand-in serves. A story picks one (`parameters.scenario`, or the `scenario` arg), and the preview
 * starts it before the story renders: a fresh world, the demo clock at the scenario's moment, the browser as it says, and
 * what this browser remembers. Add a scenario here, with a line in apps/storybook/README.md, when a page has a state none
 * of these reach.
 */
import {
  CalendarSchema, CreditBalanceSchema, DocumentLibrarySchema, IncomingRingSchema, MeetingSchema, NoteSchema, PersonalEntrySchema, PreferencesSchema,
  SessionSchema, ShareEntrySchema, TeamSchema, WorkspaceTreeSchema, type DocumentRole, type Group, type Person, type ShareEntry, type WorkspaceItem,
  type WorkspaceTree
} from '@alcove/api';
import { sessions } from '~/lib/live';
import { openBrowser } from '../browser';
import { busyCalls, busyEvents, library, soonCalls } from '../world/calls';
import { connected, notConnected, writeNote, type NoteSpec } from '../world/build';
import { iso, on, setClock } from '../world/clock';
import { CREDITS, PREFS, WELCOME_CREDITS, session, type Opening, type Page, type Refused, type World } from '../world';
import {
  COMPETITORS, EMPTY_STATES, EXPENSES, FIRST_DRAFT, HOLIDAYS, INTERVIEWS, LAUNCH_CHECKLIST, LAUNCH_PLAN, OLD_ROADMAP, PRICING_COPY, WORKING_FROM_HOME
} from '../world/documents';
import { busyNotes, pricingFollowUp, pricingFollowUpWritten, standupAdditions, standupOwn, walkthrough } from '../world/notes';
import { AIKO, ANA, ART, DIEGO, DIRECTORY, INES, JONAS, KOFI, LENA, MANY, MAYA, ME_ID, NADIA, PRIYA, teamOf, type Colleague } from '../world/people';
import { QUIET } from './empty';
import { forgetKeptHere } from './kept';
import { forgetAudio } from './media';
import { stopLive } from './standin';
import { serve } from './state';
import { forgetDocuments } from './workspaces';

export type ScenarioName = 'busy' | 'first-day' | 'on-their-own' | 'offline' | 'writing' | 'call-soon' | 'lots' | 'signed-out' | 'unsaved' | 'first-sign-in';

interface Scenario { title: string; about: string; make: () => { world: World; opening: Partial<Opening> } }

/* ---------- pieces the scenarios share ---------- */

const group = (id: string, name: string, people: readonly Person[]): Group => ({ id, name, emails: people.map((p) => p.email) });
const GROUPS = [group('g-leads', 'Leads', [PRIYA, KOFI, INES]), group('g-product', 'Product', [PRIYA, KOFI, AIKO, MAYA])];

/** A workspace item's ID, from its name: the 22 characters the contract asks for. Stories open a document by it. */
export const itemId = (slug: string) => slug.replace(/[^A-Za-z0-9]/g, '').padEnd(22, '0').slice(0, 22);
const hoursBefore = (hours: number) => new Date(Date.parse(iso(0, 16, 12)) - hours * 3_600_000).toISOString();
interface ItemShape { parent?: string | null; role?: DocumentRole; restricted?: boolean; trashed?: { hoursAgo: number; by: Person } }
function item(name: string, kind: WorkspaceItem['kind'], by: Person, hoursAgo: number, o: ItemShape = {}): WorkspaceItem {
  const at = hoursBefore(hoursAgo);
  return {
    id: itemId(name), kind, name, parent: o.parent ?? null, by: by.portrait ? { name: by.name, portrait: by.portrait } : null, createdAt: at, editedAt: at,
    trashedAt: o.trashed ? hoursBefore(o.trashed.hoursAgo) : null, trashedBy: o.trashed?.by.name ?? null, restricted: o.restricted ?? false, role: o.role ?? 'edit'
  };
}
/** The workspaces: Product, which Art runs; Design, where he edits; and the company handbook, which he can only read. */
function workspaces(): WorkspaceTree[] {
  const research = { parent: itemId('Research') };
  const reading = { role: 'read' } as const;
  return [
    {
      id: 'ws-product', name: 'Product', role: 'admin', people: 6,
      items: [
        item('Launch plan', 'document', PRIYA, 2), item('Launch checklist', 'document', MAYA, 5), item('Research', 'folder', LENA, 300),
        item('Interview notes', 'document', LENA, 120, research), item('Competitor notes', 'document', LENA, 170, research),
        item('Pricing page copy', 'document', LENA, 26, { restricted: true }),
        item('Old roadmap', 'document', PRIYA, 900, { trashed: { hoursAgo: 20, by: PRIYA } }),
        item('Launch plan, first draft', 'document', ART, 260, { trashed: { hoursAgo: 70, by: ART } })
      ]
    },
    { id: 'ws-design', name: 'Design', role: 'edit', people: 4, items: [item('Onboarding flow', 'board', AIKO, 50), item('Empty states', 'document', KOFI, 8)] },
    {
      id: 'ws-handbook', name: 'Company handbook', role: 'read', people: 38,
      items: [item('Holidays', 'document', NADIA, 700, reading), item('Expenses', 'document', NADIA, 1300, reading), item('Working from home', 'document', NADIA, 2100, reading)]
    }
  ];
}
/** What the documents say, by their IDs. */
function pages(): Record<string, Page> {
  const named: [string, Page][] = [
    ['Launch plan', LAUNCH_PLAN], ['Launch checklist', LAUNCH_CHECKLIST], ['Interview notes', INTERVIEWS], ['Competitor notes', COMPETITORS],
    ['Pricing page copy', PRICING_COPY], ['Old roadmap', OLD_ROADMAP], ['Launch plan, first draft', FIRST_DRAFT], ['Empty states', EMPTY_STATES],
    ['Holidays', HOLIDAYS], ['Expenses', EXPENSES], ['Working from home', WORKING_FROM_HOME]
  ];
  return Object.fromEntries(named.map(([name, page]) => [itemId(name), page]));
}
/** The launch plan reaches a designer outside the company and someone from sales; the pricing copy is closed to the workspace. */
function shares(): Record<string, ShareEntry[]> {
  const entry = (id: string, person: Person, role: DocumentRole, daysAgo: number): ShareEntry => ({ id, kind: 'email', person, role, since: iso(-daysAgo, 10, 0) });
  return {
    [itemId('Launch plan')]: [entry('share-jonas', JONAS, 'read', 6), entry('share-diego', DIEGO, 'edit', 2)],
    [itemId('Pricing page copy')]: [entry('share-maya', MAYA, 'edit', 3)]
  };
}

/** The canvas's busy Wednesday afternoon, at 16:12. */
function busy(): World {
  const notes = busyNotes();
  for (const n of notes) if (n.id === 'n2') n.additions = standupAdditions();
  return {
    session: session(), prefs: { ...PREFS, pinned: ['n4', 'n6'], groups: GROUPS }, team: teamOf(DIRECTORY), notes, personal: { n2: standupOwn() },
    meetings: busyCalls(), calendar: connected(busyEvents()), credits: CREDITS, documents: library(), workspaces: workspaces(), pages: pages(), shares: shares(),
    rings: [], writing: null
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
    session: session({ user: solo, ownerId: solo.id }), prefs: PREFS, team: null, notes: specs.map((s) => writeNote(s, solo)), personal: {},
    meetings: [], calendar: connected([]), credits: CREDITS, documents: { workspaces: [{ id: 'own', name: 'Your documents', documents: [] }] },
    workspaces: [], pages: {}, shares: {}, rings: [], writing: null
  };
}

/* ---------- the scenarios ---------- */

export const SCENARIOS: Record<ScenarioName, Scenario> = {
  busy: { title: 'A busy team', about: 'Wednesday afternoon at Vandelay Industries: a day of notes, things waiting on you, a design sync at 17:30.', make: () => ({ world: busy(), opening: {} }) },
  'first-day': {
    title: 'A first day', about: 'Art has just signed in for the first time: no notes, no calls, a team that isn’t on Alcove yet, and no calendar access.',
    make: () => ({
      world: {
        session: session({ createdAt: iso(0, 16, 5) }), prefs: PREFS, team: teamOf(DIRECTORY.filter((c) => c.person !== INES && c.person !== AIKO).map((c): Colleague => ({ ...c, onAlcove: false, invited: false }))),
        notes: [], personal: {}, meetings: [], calendar: notConnected, credits: WELCOME_CREDITS, documents: library(), workspaces: [], pages: {}, shares: {}, rings: [], writing: null
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
    ['session', SessionSchema.nullable().safeParse(w.session)], ['prefs', PreferencesSchema.safeParse(w.prefs)], ['team', TeamSchema.nullable().safeParse(w.team)],
    ['notes', NoteSchema.array().safeParse(w.notes)], ['meetings', MeetingSchema.array().safeParse(w.meetings)], ['calendar', CalendarSchema.safeParse(w.calendar)],
    ['credits', CreditBalanceSchema.safeParse(w.credits)], ['documents', DocumentLibrarySchema.safeParse(w.documents)], ['workspaces', WorkspaceTreeSchema.array().safeParse(w.workspaces)],
    ['rings', IncomingRingSchema.array().safeParse(w.rings)], ['personal', PersonalEntrySchema.array().safeParse(Object.values(w.personal).flat())],
    ['shares', ShareEntrySchema.array().safeParse(Object.values(w.shares).flat())]
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
    for (const k of Object.keys(localStorage)) if (k.startsWith('alcove') && k !== THEME && k !== 'alcove:log') localStorage.removeItem(k);
    sessionStorage.clear();
    const owner = w.session?.ownerId ?? ME_ID;
    if (o.tourSeen) localStorage.setItem(`alcove.tour.${owner}`, JSON.stringify({ seenAt: iso(-30, 9, 0) }));
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
  // Recordings the last story kept on this device go with it (`remember` deletes them), and Record lists what's here afresh.
  forgetKeptHere();
  const { world, opening } = SCENARIOS[name].make();
  const o: Opening = { ...QUIET, ...opening, ...over, browser: { ...opening.browser, ...over.browser } };
  setClock(o.now);
  openBrowser(o.browser);
  remember(o, world);
  serve(checked(world), o);
  return name;
}
