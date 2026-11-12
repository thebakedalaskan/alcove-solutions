/*
 * The Drive as the design canvas has it (scratch canvas Drive.dc.html, data-cd.js `FILES` and `SPACES`), on the busy
 * Wednesday afternoon: four workspaces made on purpose (Launch, Hiring, Harbourline and the Vandelay handbook, which Art can
 * only read), the workspaces of the day's calls and the week's, the next one's (Launch check-in, at 17:30) holding its
 * agenda, a board deck outline Ines shared, and two things in Trash. Every document says what the canvas's cards show of it.
 * Everyone and everything is made up. A story puts it in place with `changing(withTheDrive)`; `withNothingYet` is the first
 * day's Drive.
 */
import { firstName, type DocumentLibrary, type DocumentRole, type Person, type PortraitStyle, type WorkspaceItem, type WorkspaceRole, type WorkspaceSummary } from '@alcove/api';
import type { BlockJSON } from '~/features/workspace/editor/types';
import type { Page, Space, World } from '.';
import { iso } from './clock';
import { AIKO, ART, DIEGO, INES, KOFI, LENA, MAYA, NADIA, PRIYA } from './people';

/** A workspace item's ID, from its name: the 22 characters the contract asks for. */
export const driveId = (slug: string): string => `dv${slug.replace(/[^A-Za-z0-9]/g, '')}`.padEnd(22, '0').slice(0, 22);

const words = (text: string): BlockJSON[] => [{ type: 'text', text }];
const bullet = (text: string): BlockJSON => ({ type: 'line', attrs: { kind: 'bullet' }, content: words(text) });
const todo = (text: string, done = false): BlockJSON => ({ type: 'line', attrs: done ? { kind: 'todo', done: true } : { kind: 'todo' }, content: words(text) });
const heading = (text: string): BlockJSON => ({ type: 'line', attrs: { kind: 'heading', level: 2 }, content: words(text) });
const line = (text: string): BlockJSON => ({ type: 'line', content: words(text) });
const bullets = (...lines: string[]): Page => ({ blocks: lines.map(bullet) });

interface Shape { parent?: string | null; role?: DocumentRole; trashed?: { at: string; by: Person }; call?: WorkspaceItem['call'] }
/** One item of a workspace, made and last edited at `at`. */
/** How an author drawn without a portrait on the canvas looks on an item, which always has one: the API draws one from their address. */
const DRAWN: PortraitStyle = { skin: '#C68A62', hair: '#2A1B12', style: 'short', shirt: '#4B3C9E', bg: '#E2E7FF' };
function item(name: string, kind: WorkspaceItem['kind'], by: Person | null, at: string, o: Shape = {}): WorkspaceItem {
  return {
    id: driveId(name), kind, name, parent: o.parent ?? null, by: by ? { name: by.name, portrait: by.portrait ?? DRAWN } : null,
    createdAt: at, editedAt: at, trashedAt: o.trashed?.at ?? null, trashedBy: o.trashed?.by.name ?? null, restricted: false, role: o.role ?? 'edit', call: o.call ?? null
  };
}
const doc = (name: string, by: Person, at: string, o: Shape = {}) => item(name, 'document', by, at, o);
const board = (name: string, by: Person, at: string, o: Shape = {}) => item(name, 'board', by, at, o);
const folder = (name: string, at: string, o: Shape = {}) => item(name, 'folder', null, at, o);
/** A call's own folder in its workspace: its pages open its note, once it's over, for whoever has it. */
const callFolder = (name: string, startedAt: string, noteId: string | null) => item(name, 'folder', null, startedAt, { call: { startedAt, on: false, here: false, noteId } });

/** A workspace: who's in it besides Art (`members`), and the line on what it's for (`about`), when it says. */
function space(id: string, name: string, role: WorkspaceRole, members: Person[], createdAt: string, items: WorkspaceItem[], call: WorkspaceSummary['call'] = null, about = ''): Space {
  return { id, name, role, inCall: false, people: members.length + 1, createdAt, call, items, members, about };
}

/* ---------- when ---------- */

const TODAY = (h: number, m: number) => iso(0, h, m);
const YESTERDAY = (h: number, m: number) => iso(-1, h, m);
const MONDAY = iso(-2, 10, 0);
const TUESDAY_LAST = iso(-8, 16, 0);

/* ---------- the workspaces made on purpose ---------- */

const press = { parent: driveId('Press') };
const research = { parent: driveId('Research') };
const candidates = { parent: driveId('Candidates') };
const policies = { parent: driveId('Policies'), role: 'read' as const };
const reading = { role: 'read' as const };

function launch(): Space {
  return space('dv-launch', 'Launch', 'admin', [PRIYA, KOFI, INES], iso(-60, 10, 0), [
    folder('Press', iso(-20, 9, 0)), doc('Press list', INES, TUESDAY_LAST, press), doc('Launch post draft', INES, MONDAY, press),
    folder('Research', iso(-40, 9, 0)), doc('Interview notes', PRIYA, iso(-30, 11, 0), research), doc('Competitor notes', PRIYA, iso(-29, 11, 0), research),
    doc('Survey results', MAYA, iso(-27, 11, 0), research), doc('Sign-up numbers', MAYA, iso(-12, 11, 0), research),
    callFolder('Launch planning · 27 Oct', TUESDAY_LAST, 'n7'),
    doc('Launch plan', PRIYA, TODAY(8, 40)), board('Launch board', KOFI, TUESDAY_LAST), doc('Status page runbook', KOFI, MONDAY),
    doc('Old roadmap', PRIYA, iso(-40, 10, 0), { trashed: { at: iso(-6, 10, 0), by: PRIYA } })
  ], null, 'Launch planning is kept here, every other Tuesday');
}
function hiring(): Space {
  return space('dv-hiring', 'Hiring', 'edit', [INES, AIKO], iso(-50, 10, 0), [
    folder('Candidates', iso(-25, 9, 0)), doc('Screening questions', INES, iso(-20, 9, 0), candidates), doc('Take-home brief', AIKO, iso(-15, 9, 0), candidates),
    doc('Interview loop', INES, MONDAY), doc('Scorecard template', INES, iso(-5, 11, 0))
  ]);
}
function harbourline(): Space {
  return space('dv-harbour', 'Harbourline', 'admin', [MAYA], iso(-21, 10, 0), [doc('Visit report', ART, MONDAY), doc('Handover photos', ART, iso(-2, 10, 5))], null, 'The site visit is kept here');
}
function handbook(): Space {
  return space('dv-handbook', 'Vandelay handbook', 'read', [INES, PRIYA, KOFI, MAYA, AIKO, NADIA], iso(-400, 9, 0), [
    folder('Policies', iso(-300, 9, 0), reading), doc('Travel', NADIA, iso(-200, 9, 0), policies), doc('Equipment', NADIA, iso(-190, 9, 0), policies),
    doc('Holidays', INES, iso(-33, 9, 0), reading)
  ]);
}

/* ---------- the calls' own workspaces ---------- */

function calls(): Space[] {
  return [
    space('dv-checkin', 'Launch check-in · 4 Nov', 'edit', [PRIYA, KOFI, INES], TODAY(10, 30), [doc('Agenda', PRIYA, TODAY(10, 40))], { title: 'Launch check-in', at: TODAY(17, 30) }),
    space('dv-warehouse', 'Moving the warehouse · 4 Nov', 'admin', [INES], TODAY(11, 58), [
      callFolder('Moving the warehouse · 4 Nov', TODAY(11, 58), 'n1'), doc('Move plan', ART, TODAY(12, 10)), doc('floor-plan', INES, TODAY(12, 2))
    ], { title: 'Moving the warehouse', at: TODAY(11, 58) }),
    space('dv-standup', 'Team standup · 4 Nov', 'admin', [PRIYA, KOFI, MAYA], TODAY(9, 0), [
      callFolder('Team standup · 4 Nov', TODAY(9, 0), 'n2'), callFolder('Team standup · 3 Nov', iso(-1, 9, 0), null),
      doc('Launch checklist', KOFI, TODAY(10, 12)), board('Standup board', PRIYA, TODAY(9, 20))
    ], { title: 'Team standup', at: TODAY(9, 0) }),
    space('dv-pricing', 'Pricing sync · 3 Nov', 'edit', [MAYA, LENA], YESTERDAY(15, 0), [
      callFolder('Pricing sync · 3 Nov', YESTERDAY(15, 0), 'n3'), doc('Pricing page copy', MAYA, YESTERDAY(16, 40)), board('Plans board', MAYA, YESTERDAY(15, 31))
    ], { title: 'Pricing sync', at: YESTERDAY(15, 0) }),
    space('dv-review', 'Design review · 3 Nov', 'admin', [PRIYA, KOFI, AIKO], YESTERDAY(11, 0), [
      callFolder('Design review · 3 Nov', YESTERDAY(11, 0), 'n4'), doc('Review notes', AIKO, YESTERDAY(12, 5)), board('Sidebar, dark', KOFI, YESTERDAY(11, 40)),
      board('Sketches', ART, YESTERDAY(11, 30), { trashed: { at: iso(-2, 9, 30), by: ART } })
    ], { title: 'Design review', at: YESTERDAY(11, 0) }),
    space('dv-research', 'Customer research readout · 22 Oct', 'edit', [PRIYA, LENA, AIKO], iso(-13, 13, 0), [
      callFolder('Customer research readout · 22 Oct', iso(-13, 13, 0), 'n9'), doc('Research readout', PRIYA, iso(-13, 14, 0))
    ], { title: 'Customer research readout', at: iso(-13, 13, 0) }),
    space('dv-intro', 'Harbourline intro · 14 Oct', 'edit', [PRIYA, DIEGO], iso(-21, 11, 0), [
      callFolder('Harbourline intro · 14 Oct', iso(-21, 11, 0), 'n10'), doc('Intro notes', ART, iso(-21, 12, 0))
    ], { title: 'Harbourline intro', at: iso(-21, 11, 0) })
  ];
}

/** Ines's board prep, which she shared one document of: someone outside a workspace sees no name, no folders and no head count. */
function sharedByInes(): Space {
  return { id: 'dv-boardprep', name: null, role: null, inCall: false, people: null, createdAt: null, call: null, items: [doc('Board deck outline', INES, iso(-9, 9, 30))] };
}

/* ---------- what the documents say ---------- */

/** A document that's a file and nothing else, as uploading one makes it. */
const fileOnly = (name: string): Page => ({ blocks: [{ type: 'file', attrs: { name, media: `media-${name}`, size: 2_400_000 } }] });
/** A document that's photos and nothing else. */
const photos = (n: number): Page => ({ blocks: [{ type: 'gallery', attrs: { items: Array.from({ length: n }, (_, i) => ({ media: `media-handover-${i}`, name: `Handover ${i + 1}.jpg`, width: 1600, height: 1200 })) } }] });

function pages(): Record<string, Page> {
  const named: [string, Page][] = [
    ['Move plan', bullets('Movers come on the 14th', 'Orders before the 14th ship from the old site', 'Order page shows new delivery times', 'Tell suppliers by Friday')],
    ['floor-plan', fileOnly('floor-plan.pdf')],
    ['Agenda', { blocks: [heading('From last time'), todo('Where the launch checklist stands'), todo('Press list for the 18th'), todo('Status page: who watches it'), heading('Today'), line('Anything else')] }],
    ['Launch checklist', { blocks: [todo('Status page: Kofi, from now on', true), todo('Help article before the flag goes on', true), todo('Changelog before the launch post'), todo('Flag on for everyone: 12 Nov')] }],
    ['Launch plan', bullets('Launch: Wednesday 18 November', 'Onboarding behind a flag first', 'Status page owned by Kofi', 'Press list: Ines')],
    ['Pricing page copy', bullets('Team plan, now monthly too', 'Free minutes stay as they are', 'One line on confidential compute', 'Compare plans, under the fold')],
    ['Review notes', bullets('The sidebar reads better dark', 'One filled button per view', 'Empty states get an arch', 'Recheck light at 1440')],
    ['Visit report', bullets('Every handover is recorded', 'Notes needed in Portuguese', 'Two sites, one team', 'Pilot from December')],
    ['Handover photos', photos(12)],
    ['Interview loop', bullets('Screen: 30 min', 'Systems: 60 min', 'Team: 45 min', 'Decide within a week')],
    ['Scorecard template', { blocks: [heading('Systems'), heading('Customers'), heading('Team fit'), heading('Next step')] }],
    ['Status page runbook', bullets('Who watches it, and when', 'What counts as an incident', 'Words for the first update', 'Who signs off')],
    ['Press list', bullets('Three trade titles', 'Two founders’ newsletters', 'Embargo: 18 Nov, 09:00', 'Quotes from Priya')],
    ['Launch post draft', bullets('Alcove, with notes nobody else can read', 'What changes on the 18th', 'Pricing, in one line', 'Thanks')],
    ['Holidays', bullets('25 days a year', 'Book a week ahead', 'Office closed 24 Dec to 1 Jan', 'Public holidays on top')],
    ['Board deck outline', bullets('Runway: 22 months', 'The ask stays the same', 'Pilots: Harbourline', 'Hiring: two engineers')],
    ['Research readout', bullets('Six teams, four pay for notes today', 'Decisions first, then search', 'Who can read the notes, asked first', 'Seats are the wrong price')],
    ['Intro notes', bullets('Two sites, one night shift', 'Every handover recorded', 'Portuguese first', 'A pilot in December')],
    ['Interview notes', bullets('Nobody reads a whole transcript', 'Four of six pay for a note taker', 'Who can read it, asked first')],
    ['Competitor notes', bullets('Per seat, every month', 'Per minute, nothing free', 'Free, trained on your calls', 'Nobody prices by minutes of notes')],
    ['Survey results', { blocks: [heading('Forty-two teams answered'), bullet('Decisions first, then search'), bullet('Who can read the notes, asked first'), bullet('Half record in the room')] }],
    ['Sign-up numbers', bullets('Up 18% since the pricing change', 'Teams of 5 to 20 sign up most', 'Half come from a shared note', 'Monthly plan: a third of new teams')],
    ['Screening questions', bullets('What do you run meetings for?', 'Who reads your notes today?', 'What would make you stop?')],
    ['Take-home brief', bullets('Three hours, no more', 'Search a week of transcripts', 'Explain what you left out')],
    ['Travel', bullets('Book through the travel desk', 'Trains under four hours', 'Receipts within a week')],
    ['Equipment', bullets('A laptop and one screen', 'Headphones for calls', 'Ask Nadia for anything else')],
    ['Old roadmap', { blocks: [line('The third quarter’s roadmap, from before the pricing change.')] }]
  ];
  return Object.fromEntries(named.map(([name, page]) => [driveId(name), page]));
}

/** What a library lists of these workspaces: every document and board out of Trash, the newest first, by whoever made it. */
export function libraryOf(spaces: readonly Space[]): DocumentLibrary {
  return {
    workspaces: spaces.flatMap((w) => {
      const documents = w.items.filter((i) => i.kind !== 'folder' && i.trashedAt === null).sort((a, b) => b.editedAt.localeCompare(a.editedAt))
        .map((i) => ({ id: `${w.id}.${i.id}`, item: i.id, name: i.name, kind: i.kind === 'board' ? 'board' as const : 'doc' as const, by: i.by ? firstName(i.by.name) : null, updatedAt: i.editedAt }));
      return documents.length ? [{ id: w.id, name: w.name, documents }] : [];
    })
  };
}

/**
 * The library follows the world's workspaces from now on, as the API works it out from them on every read: what the story
 * makes, renames or sends to Trash is in it at once. Set it, and it's that value again.
 */
function libraryFollows(w: World): void {
  Object.defineProperty(w, 'documents', {
    configurable: true, enumerable: true,
    get: () => libraryOf(w.workspaces),
    set: (value: DocumentLibrary) => { Object.defineProperty(w, 'documents', { value, writable: true, configurable: true, enumerable: true }); }
  });
}

/** The Drive as the canvas has it, in place of the busy afternoon's workspaces. */
export function withTheDrive(w: World): void {
  w.workspaces = [launch(), hiring(), harbourline(), handbook(), ...calls(), sharedByInes()];
  w.pages = { ...w.pages, ...pages() };
  libraryFollows(w);
}

/** The first day's Drive: nothing in it, and no workspace yet. */
export function withNothingYet(w: World): void {
  w.workspaces = [];
  libraryFollows(w);
}
