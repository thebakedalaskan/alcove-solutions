/*
 * The workspace a call uses (docs: Calls and recordings › The call's workspace). Its home, where its notes and transcript go,
 * in a folder of its own, lives on the meeting, so it carries to the next call in a series; which workspace everyone views,
 * if the organizer switched, and what's going on there, live in the call's sealed state (features/calls/space-state.ts).
 *
 * Nothing here decides who can open what: features/workspaces/access.ts does, on every read, for each person. Being in a call or
 * organizing it opens nothing, and access is never copied into the call, so someone who loses a document stops being told
 * about it at once, and what they were presenting or playing stops. What's in a workspace is read with the server's keys
 * here only to work out what each person may be told, and someone who can open nothing is told nothing that names it.
 *
 * `calls.ts` holds the call's row and says when to do what; this is what's done. A live call comes first, so nothing done here
 * under the call's row waits on a workspace's lock, opens a workspace or works through its documents: that's done before the
 * row is taken (`prepare`, `makeAgenda`), and reading a call opens a workspace once a version for everyone (`seenAt`).
 */
import { firstName, type CallAction, type CallBrought, type CallFollowUp, type CallFollowUps, type CallPlay, type CallPresent, type CallWorkspace, type CallWorkspaceAsk, type CallWorkspaceSwitch, type DocFollowUp, type DocFollowUpTick, type LiveNotes, type Person } from '@alcove/api';
import type { Deps, Owner } from '../../context';
import { b64u, id128, mac, stateKey, utf8 } from '../../crypto';
import { tx, type Db } from '../../db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, notFound } from '../../errors';
import { publish, type Hub } from '../../live/hub';
import { log } from '../../log';
import { findItem, type Loaded } from '../../vault';
import { profile } from '../account/account';
import { seatOfViewer, type Viewer } from './participants';
import { withBoardClosed, type AgendaDraft, type CallBoards, type CallHome, type CallSpace, type Controller, type Playing, type PresentEnded, type Presenting, type SpacePresenting, type WorkedBy, type WorkedDocument } from './space-state';
import type { DocTodo, FollowUpLimits, Run } from '../workspaces/document-text';
import { MeetingManifest, all as allMeetings, updateManifest } from '../meetings/service';
import { boardPlace, placeOf, placesOf, type Joined, type Placing } from './places';
import { zoneOf } from '../meetings/repeats';
import { TREE_NOTICE, canOpen, emailIndex, grant, holdersOf, organizerEdits, readerInCall, requireDocument, requireRole, requireSharing, roleOf, saveState, serverWorkspace, standingIn, trashOf, whoInCall, workspaceAt, workspaceFor, type HeldWorkspace, type MadeFor, type Reader, type Standing, type StoredItem, type Who, type Workspace } from '../workspaces/access';
import { documentsAt, editorOf, keepVersion, kindOf, readDocument, writeDocument } from '../workspaces/documents';
import { addBeside, addCallFolder, createIn, followInvite, makeHome, type CallFolder, type InviteChange } from '../workspaces/service';

const wlog = log.child({ component: 'call-workspace' });

/**
 * What the rules here read of a call: what it keeps of its workspace, and which board is open where, which is what a board
 * presented is, and what presenting one for everyone closes.
 */
export interface Spaced extends Placing { workspace: CallSpace; removed: string[]; board: Pick<CallBoards, 'open' | 'ideas'> }

/* ---------- what's brought to a call ---------- */

/**
 * What a call keeps for a document brought to it, on the meeting: the workspace's handle and the item, with a dot between,
 * as features/workspaces/library.ts names them. An item's own ID doesn't say which workspace it's in.
 */
const broughtId = (workspaceId: string, documentId: string): string => `${workspaceId}.${documentId}`;
const BROUGHT = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{22})$/;
export const placeOfBrought = (id: string): { workspaceId: string; documentId: string } | undefined => {
  const [, workspaceId, documentId] = BROUGHT.exec(id) ?? [];
  return workspaceId && documentId ? { workspaceId, documentId } : undefined;
};
/** How many documents a call can bring, however they got there. */
const MAX_BROUGHT = 12;

/* ---------- what's going on, and what's over ---------- */

/** Someone's connection that's in the call now. */
const here = (s: Placing, person: string): Joined | undefined => s.people.find((j) => j.person === person && j.status === 'in');
/**
 * Whether what someone started shows now: they're in the part of the call it started in. A reload leaves a moment when
 * they aren't, so it's hidden then, and not stopped: they come back to it.
 */
function showing(s: Placing, x: { place: string; by: Controller }): boolean {
  const j = here(s, x.by.person);
  return j !== undefined && placeOf(s, j) === x.place;
}
/**
 * Where someone is in the call, by their latest connection, whether it's in now or they're reloading: every connection of one
 * browser is in the same part of it.
 */
function placed(s: Placing, person: string): string | undefined {
  const j = s.people.findLast((x) => x.person === person);
  return j ? placeOf(s, j) : undefined;
}
/**
 * What's over for good: its part of the call closed, whoever started it was removed, or they've gone to another part of the
 * call, even while they're reloading, as they come back there.
 */
function over(s: Spaced, x: { place: string; by: Controller }): boolean {
  const where = placed(s, x.by.person);
  return !placesOf(s).includes(x.place) || s.removed.includes(x.by.person) || (where !== undefined && where !== x.place);
}
/**
 * Whether a board presented is still there to present: while it's the one open in the part of the call it was presented in, on
 * everyone's stage there. Closed, it's over, and the next change takes it out of what the call keeps. So is a document, which
 * only a release before this one presented, a section at a time.
 */
const onStage = (s: Spaced, p: Presenting): boolean => p.kind === 'board' && s.board.open[boardPlace(s, p.place)]?.documentId === p.id;
/**
 * Which presentation a board presented is, for everyone told of it. One a release before keys were kept started has none
 * (`''`): it's given one made from where it is, whose and what, keyed under this call's own key, so it's the same on every read
 * and for everyone, and nobody without that key can tell anything from it. A new one's key is random (`id128`).
 */
const keyOf = (o: Owner, callId: string, p: Presenting): string =>
  p.key || b64u(mac(stateKey(o.root, o.ownerId, `call-present:${callId}`), utf8([p.place, p.by.person, p.kind, p.workspaceId, p.id].join('\n')))).slice(0, 22);
/** What saying a presentation ended takes: when, on this server's clock, and which presentation a board presented is (`keyOf`). */
export interface Ending { at: number; key: (p: Presenting) => string }
/** Presentations ending in this call, now. */
export const ending = (o: Owner, callId: string, at = Date.now()): Ending => ({ at, key: (p) => keyOf(o, callId, p) });
/**
 * The call's workspace with these presentations over for good, each said to have ended where it was presented, at once
 * (`ended`), so everyone who was following it knows how: for whoever presented it (`close` false), everyone following keeping
 * it open on their own, whatever ended it; or for everyone (`close`). `by` is whoever presented it, whoever or whatever ended
 * it. A part of the call that's closed has nobody there to tell, and a document, which only a release before this one
 * presented, was never told. Where two end in one part at once, as only a release before this one could leave them, it's the
 * one that started last, which is the one that showed.
 */
function endedFor(w: CallSpace, gone: { present: readonly Presenting[]; space: readonly SpacePresenting[] }, open: readonly string[], e: Ending, close = false): CallSpace {
  if (!gone.present.length && !gone.space.length) return w;
  const told = [
    ...gone.present.flatMap((p) => (p.kind === 'board' ? [{ place: p.place, key: e.key(p), by: p.by, since: p.since }] : [])),
    ...gone.space.map((p) => ({ place: p.place, key: p.key, by: p.by, since: p.since }))
  ].filter((x) => open.includes(x.place)).sort((a, b) => a.since - b.since);
  const said = new Map(told.map((x): [string, PresentEnded] => [x.place, { place: x.place, key: x.key, close, by: x.by, at: e.at }]));
  return {
    ...w,
    present: w.present.filter((p) => !gone.present.includes(p)),
    space: w.space.filter((p) => !gone.space.includes(p)),
    ended: [...w.ended.filter((x) => !said.has(x.place)), ...said.values()]
  };
}
/**
 * Someone chose to leave on this connection: what they started stops for good, so it doesn't come back if they do, and how it
 * ended is said at once. A reload isn't this, and nor is one device of two: they're still here.
 */
export function leftForGood<S extends Spaced>(s: S, person: string, identity: string, e: Ending): S {
  if (s.people.some((j) => j.person === person && j.status === 'in' && j.identity !== identity)) return s;
  const w = s.workspace;
  const theirs = (x: { by: Controller }) => x.by.person === person;
  if (!w.present.some(theirs) && !w.space.some(theirs) && !w.play.some(theirs)) return s;
  const over = endedFor(w, { present: w.present.filter(theirs), space: w.space.filter(theirs) }, placesOf(s), e);
  return { ...s, workspace: { ...over, play: w.play.filter((x) => !theirs(x)) } };
}
/**
 * The call as it's saved, with what's over gone from what it keeps, and each presentation that's over said to have ended where it
 * was presented (`endedFor`). The change that ends one is being saved, whatever it is: whoever presented it removed or moved to
 * another part of the call, or a board no longer open where it was presented. So it's said as it happens. A workspace presented
 * that isn't the one everyone views is over too, as far as this can tell: switching stops it (`view`), but a release before this
 * one switching stops only what it knows. Reading the call tells nobody of one that isn't the workspace viewed, whatever's kept.
 * How a presentation ended goes with the part of the call it ended in.
 */
export function tidied<S extends Spaced>(s: S, e: Ending): S {
  const w = s.workspace;
  const open = placesOf(s);
  const gone = {
    present: w.present.filter((x) => over(s, x) || !onStage(s, x)),
    space: w.space.filter((x) => over(s, x) || (w.viewing !== null && x.workspaceId !== w.viewing))
  };
  const kept = endedFor(w, gone, open, e);
  return {
    ...s,
    workspace: {
      ...kept,
      ended: kept.ended.filter((x) => open.includes(x.place)),
      play: w.play.filter((x) => !over(s, x)),
      asks: w.asks.filter((a) => !s.removed.includes(a.person))
    }
  };
}
/**
 * The board open in a part of the call (`at`) closed for everyone (`withBoardClosed`) by `by`, and every presentation of it ended
 * wherever it was presented, there and in each room that shares it, as it's said at once. A presentation closes for everyone
 * (`close`) only when its presenter or the organizer ended it, so that's what a presenter told theirs closed without them can take
 * it to mean: anyone else's ends for them alone. Nobody else closes a board someone else presents while it shows (`present-stop`,
 * `board-close`), so that's only ever one whose presenter is reloading.
 */
export function boardClosed<S extends Spaced>(s: S, at: string, e: Ending, by: { person: string; organizer: boolean }): S {
  const open = s.board.open[at];
  const of = open ? s.workspace.present.filter((p) => p.kind === 'board' && p.id === open.documentId && boardPlace(s, p.place) === at) : [];
  const closes = (p: Presenting) => by.organizer || p.by.person === by.person;
  const places = placesOf(s);
  const closed = endedFor(s.workspace, { present: of.filter(closes), space: [] }, places, e, true);
  return { ...s, workspace: endedFor(closed, { present: of.filter((p) => !closes(p)), space: [] }, places, e), board: withBoardClosed(s.board, at) };
}
/**
 * What's presented in a part of the call now, for everyone there: the board on its stage, or the workspace `viewed`. There's
 * one at a time, unless a release before this one left both: then it's whichever started last.
 */
type Here = { kind: 'board'; p: Presenting } | { kind: 'workspace'; p: SpacePresenting };
function presentedHere(s: Spaced, place: string, viewed: string | null): Here | undefined {
  const board = s.workspace.present.find((q) => q.place === place && showing(s, q) && onStage(s, q));
  const space = s.workspace.space.find((q) => q.place === place && q.workspaceId === viewed && showing(s, q));
  if (board && (!space || board.since >= space.since)) return { kind: 'board', p: board };
  return space ? { kind: 'workspace', p: space } : undefined;
}
/**
 * Whether someone else is presenting a board that opening one in `place` would take off everyone's stage: one presented there,
 * or in a room that shows the board open there. Bringing in the board that's presented (`keeping`) takes it off nobody's.
 */
export const boardPresentedOver = (s: Spaced, place: string, person: string, keeping: string | null): boolean =>
  s.workspace.present.some((p) => p.by.person !== person && p.id !== keeping && (p.place === place || boardPlace(s, p.place) === place) && showing(s, p) && onStage(s, p));
/** Who started something, by the name they came into the call with, which is how everyone there knows them. */
export const controllerOf = (v: Viewer, reader: Reader): Controller => ({ person: v.pass.person, seat: seatOfViewer(v), name: v.pass.name, email: reader.email ?? null });
const whoStarted = (d: Deps, callId: string, by: Controller): Who => whoInCall(d, callId, by);
const asSeat = (by: Controller) => ({ seat: by.seat, name: by.name });

/* ---------- what each person is told ---------- */

/** What the call knows, for working out what one person sees. */
export interface Seeing {
  v: Viewer;
  callId: string;
  meeting: Pick<MeetingManifest, 'workspaceId' | 'documents' | 'agenda'>;
  s: Spaced;
  /** Where they are in the call. */
  place: string;
  chosenBy: Person;
  /** Who's asking, for the organizer. */
  asks: CallWorkspaceAsk[];
}

/** A board presented, as someone who can open it (`opens`) is told, or anyone else: that it's on, and whose it is. */
const presentAs = (v: Viewer, key: string, p: Presenting, name: string, opens: boolean): CallPresent => {
  const mine = p.by.person === v.pass.person;
  const seen = { key, by: asSeat(p.by), mine };
  return opens ? { kind: 'board', id: p.id, name, section: p.section, ...seen } : { kind: null, id: null, name: null, section: null, ...seen };
};
/** The workspace presented: which it is for someone who can open something in it, and only whose it is for anyone else. */
const spaceAs = (v: Viewer, p: SpacePresenting, opens: boolean): CallPresent => {
  const mine = p.by.person === v.pass.person;
  const seen = { key: p.key, name: null, section: null, by: asSeat(p.by), mine };
  return opens ? { kind: 'workspace', id: p.workspaceId, ...seen } : { kind: null, id: null, ...seen };
};
const playAs = (v: Viewer, p: Playing): CallPlay => {
  const mine = p.by.person === v.pass.person;
  return { mediaId: p.mediaId, documentId: p.documentId, by: asSeat(p.by), playing: p.playing, positionMs: p.positionMs, atMs: p.atMs, nowMs: Date.now(), mine, canControl: mine || v.isOrganizer };
};

/**
 * What whoever started it has lost the document of, found while reading the call. Losing a document says nothing to the call,
 * so this is where it's noticed: it stops for good (`withoutLost`), how a presentation ended is said where it was presented, and
 * it doesn't come back if they're given it again.
 */
export interface Lost { present: Presenting[]; space: SpacePresenting[]; play: Playing[] }
const sameStart = (a: { place: string; by: Controller }, b: { place: string; by: Controller }) => a.place === b.place && a.by.person === b.by.person;
export const withoutLost = (w: CallSpace, lost: Lost, open: readonly string[], e: Ending): CallSpace => {
  const gone = {
    present: w.present.filter((p) => lost.present.some((x) => sameStart(x, p) && x.id === p.id)),
    space: w.space.filter((p) => lost.space.some((x) => sameStart(x, p) && x.key === p.key))
  };
  return { ...endedFor(w, gone, open, e), play: w.play.filter((p) => !lost.play.some((x) => sameStart(x, p) && x.mediaId === p.mediaId)) };
};

/* ---------- what calls read of a tree: once for each version, for everyone ---------- */

/** What reading a call needs of one item in a tree: what it is, what it's called, and enough to say who can open it. */
interface Facts { item: Pick<StoredItem, 'kind' | 'name' | 'by' | 'restricted' | 'restrictedBy'>; trashed: boolean }
/** A tree as calls have read it at one version: its name, and each item they've asked after (null when it isn't there). */
interface Seen { version: number; name: string; items: Map<string, Facts | null> }
const MAX_SEEN = 1024;
const seenByHub = new WeakMap<Hub, Map<string, Seen>>();
const openingByHub = new WeakMap<Hub, Map<string, Promise<HeldWorkspace | undefined>>>();
/**
 * These items as a workspace's tree has them at `version`, for everyone reading a call that uses it. Opening a tree costs in
 * proportion to its size, and everyone in a call reads it every few seconds while something shows, so, as for each update
 * typed (`editableBy`), what's read holds for as long as the version does, and costs one small query; a tree is opened once
 * for each version, however many ask at once. All that's kept between reads is what calls asked after, by ID: names and who
 * can open them, never keys and never the tree. Whatever changes the tree moves its version on (`saveState`), and who holds
 * what is read afresh every time, so nobody's told anything that no longer holds. Undefined once it's gone.
 */
async function seenAt(d: Deps, workspaceId: string, version: number, ids: string[]): Promise<Seen | undefined> {
  const seen = seenByHub.get(d.hub) ?? new Map<string, Seen>();
  seenByHub.set(d.hub, seen);
  const known = seen.get(workspaceId);
  if (known?.version === version && ids.every((id) => known.items.has(id))) return known;
  const opening = openingByHub.get(d.hub) ?? new Map<string, Promise<HeldWorkspace | undefined>>();
  openingByHub.set(d.hub, opening);
  const key = `${workspaceId}:${version}`;
  let read = opening.get(key);
  if (!read) {
    read = serverWorkspace(d, workspaceId).finally(() => opening.delete(key));
    opening.set(key, read);
  }
  const w = await read;
  if (!w) return undefined;
  const was = seen.get(workspaceId);
  const items = new Map(was?.version === w.version ? was.items : []);
  for (const id of ids) {
    const item = w.state.items[id];
    items.set(id, item ? { item: { kind: item.kind, name: item.name, by: item.by, restricted: item.restricted, restrictedBy: item.restrictedBy }, trashed: trashOf(w.state, id) !== null } : null);
  }
  const now: Seen = { version: w.version, name: w.state.name, items };
  seen.delete(workspaceId);
  seen.set(workspaceId, now);
  for (const oldest of seen.keys()) {
    if (seen.size <= MAX_SEEN) break;
    seen.delete(oldest);
  }
  return now;
}
/**
 * Whether a workspace itself opens for someone: a role in it, or a document given to them that's still there, with `seen` holding
 * what's given. A board in a call gives every guest a seat on it, and boards aren't in the workspace's list, so a board alone
 * opens it to nothing: they're told it's private, who's presenting it and never what, and can ask.
 */
const opensItself = (as: Standing, seen: Seen): boolean => as.role !== null || [...as.grants.keys()].some((id) => { const f = seen.items.get(id); return f ? !f.trashed && f.item.kind !== 'board' : false; });

/**
 * The call's workspace as this person may know it, and what's been lost. One that can't be read says it's private: a call
 * doesn't depend on what's in a workspace, so nothing here can stop anyone reading the call.
 *
 * Someone with nothing in a workspace has nothing of it read for them, whatever's going on there: they're told only that
 * something's being presented, and by whom, so what they're told, and what a read costs them, is the same either way.
 * Whether what's going on there still stands is found by whoever can open something in it, or started it.
 */
export async function shownTo(x: Seeing): Promise<{ shown: CallWorkspace; lost: Lost }> {
  const { v, s, place, meeting } = x;
  // How the last presentation here ended is told to everyone here, as its being on was, whatever they can open.
  const last = s.workspace.ended.find((e) => e.place === place);
  const ended = last ? { key: last.key, close: last.close, by: asSeat(last.by) } : null;
  const shut: CallWorkspace = {
    id: null, home: null, name: null, chosenBy: x.chosenBy, canOpen: false, role: null, documents: [], agenda: null, present: null, ended, play: null, asks: x.asks,
    asked: s.workspace.asks.find((a) => a.person === v.pass.person)?.state === 'asking' ? 'asking' : s.workspace.asks.some((a) => a.person === v.pass.person) ? 'declined' : 'no'
  };
  const brought = meeting.documents.flatMap((id) => { const at = placeOfBrought(id); return at ? [at] : []; });
  const home = meeting.workspaceId;
  const lost: Lost = { present: [], space: [], play: [] };
  // A board presented is wherever it's kept, which needn't be the workspace everyone views.
  const boards = s.workspace.present.flatMap((p) => (p.kind === 'board' && p.place === place ? [p.workspaceId] : []));
  if (!home && !s.workspace.viewing && !brought.length && !boards.length) return { shown: shut, lost };
  const d = v.organizer;
  try {
    // A workspace everyone was viewing that's been deleted since: they're back in the home, and its presentation here is over, as
    // losing it would make it (`stopLost`).
    const inUse = s.workspace.viewing !== null && await workspaceAt(d.pool, s.workspace.viewing) ? s.workspace.viewing : home;
    if (s.workspace.viewing !== null && inUse !== s.workspace.viewing) lost.space.push(...s.workspace.space.filter((p) => p.place === place && p.workspaceId === s.workspace.viewing && showing(s, p)));
    const workspaces = new Set([...(inUse ? [inUse] : []), ...(home ? [home] : []), ...brought.map((b) => b.workspaceId), ...boards]);
    const reader = await readerInCall(v);
    const out = { ...shut };
    const documents = new Map<string, CallBrought>();
    /** What's presented here, as this person may know it, and when it started: one, unless a release before this one left two. */
    const presents: { since: number; is: CallPresent }[] = [];
    const startedHere = (p: { by: Controller } | undefined) => p !== undefined && p.by.person === v.pass.person;
    for (const workspaceId of workspaces) {
      const at = await workspaceAt(d.pool, workspaceId);
      if (!at) {
        // Deleted: what's presented from it here is over for everyone, as losing it would make it.
        lost.present.push(...s.workspace.present.filter((p) => p.place === place && p.workspaceId === workspaceId && showing(s, p) && onStage(s, p)));
        lost.space.push(...s.workspace.space.filter((p) => p.place === place && p.workspaceId === workspaceId && showing(s, p)));
        continue;
      }
      const inCall = workspaceId === inUse;
      // A board is presented from wherever it's kept, while it's on the stage; the workspace, while it's the one everyone views.
      const present = s.workspace.present.find((p) => p.place === place && p.workspaceId === workspaceId && showing(s, p) && onStage(s, p));
      const space = inCall ? s.workspace.space.find((p) => p.place === place && p.workspaceId === workspaceId && showing(s, p)) : undefined;
      const play = inCall ? s.workspace.play.find((p) => p.place === place && p.workspaceId === workspaceId && showing(s, p)) : undefined;
      const standing = standingIn(await holdersOf(d.pool, at.ownerId, reader.principals), reader);
      const opensSomething = canOpen(standing);
      if (opensSomething && workspaceId === home) out.home = home;
      if (!opensSomething && !startedHere(present) && !startedHere(space) && !startedHere(play)) {
        if (present) presents.push({ since: present.since, is: presentAs(v, keyOf(d, x.callId, present), present, '', false) });
        if (space) presents.push({ since: space.since, is: spaceAs(v, space, false) });
        continue;
      }
      // Someone with no role in the workspace the call views has it open only through what's given to them, so that's looked at.
      const given = inCall && standing.role === null ? [...standing.grants.keys()] : [];
      const ids = [...brought.filter((b) => b.workspaceId === workspaceId).map((b) => b.documentId), ...(present ? [present.id] : []), ...(play ? [play.documentId] : []), ...given];
      // The home, when it isn't what's viewed and nothing's brought from it, only says whether it opens for them.
      if (!ids.length && !inCall) continue;
      const seen = await seenAt(d, workspaceId, at.version, ids);
      if (!seen) continue;
      /** What `who`, standing as they do, can do with something that's still in the tree. */
      const roleIn = (who: Who, as: Standing, id: string) => { const f = seen.items.get(id); return f && !f.trashed ? roleOf(who, as, id, f.item) : undefined; };
      const opensSpace = inCall && opensItself(standing, seen);
      if (opensSomething) {
        for (const b of brought.filter((y) => y.workspaceId === workspaceId)) {
          const f = seen.items.get(b.documentId);
          const role = roleIn(reader, standing, b.documentId);
          if (f && role) documents.set(broughtId(workspaceId, b.documentId), { workspaceId, id: b.documentId, kind: f.item.kind, name: f.item.name, role });
        }
      }
      if (inCall && opensSpace) {
        out.id = workspaceId;
        out.name = standing.role === null ? null : seen.name;
        out.canOpen = true;
        out.role = standing.role;
      }
      // Whatever's going on there goes on while whoever started it can still open it: the workspace presented, while something
      // in it opens for them.
      const starters = [present, space, play].flatMap((p) => (p ? [whoStarted(d, x.callId, p.by)] : []));
      const theirs = starters.length ? await holdersOf(d.pool, at.ownerId, starters.flatMap((who) => who.principals)) : { members: [], shares: [] };
      const stands = (by: Controller, id: string) => { const who = whoStarted(d, x.callId, by); return roleIn(who, standingIn(theirs, who), id) !== undefined; };
      const opensIt = (by: Controller) => { const who = whoStarted(d, x.callId, by); return canOpen(standingIn(theirs, who)); };
      if (present) {
        if (!stands(present.by, present.id)) lost.present.push(present);
        else presents.push({ since: present.since, is: presentAs(v, keyOf(d, x.callId, present), present, seen.items.get(present.id)?.item.name ?? '', roleIn(reader, standing, present.id) !== undefined) });
      }
      if (space) {
        if (!opensIt(space.by)) lost.space.push(space);
        else presents.push({ since: space.since, is: spaceAs(v, space, opensSpace) });
      }
      if (play) {
        if (!stands(play.by, play.documentId)) lost.play.push(play);
        else if (roleIn(reader, standing, play.documentId)) out.play = playAs(v, play);
      }
    }
    const latest = presents.reduce<{ since: number; is: CallPresent } | undefined>((a, b) => (a && a.since >= b.since ? a : b), undefined);
    const shown = latest?.is ?? null;
    // What whoever presented it has lost ends now for everyone here, as taking it out of what the call keeps says (`stopLost`),
    // so this read says so at once, as the next one will.
    const gone = [...lost.present.map((p) => ({ since: p.since, key: keyOf(d, x.callId, p), by: p.by })), ...lost.space.map((p) => ({ since: p.since, key: p.key, by: p.by }))]
      .reduce<{ since: number; key: string; by: Controller } | undefined>((a, b) => (a && a.since >= b.since ? a : b), undefined);
    const said = gone && (!latest || gone.since >= latest.since) ? { key: gone.key, close: false, by: asSeat(gone.by) } : ended;
    const inOrder = meeting.documents.flatMap((id) => documents.get(id) ?? []);
    const agenda = meeting.agenda ? documents.get(broughtId(meeting.agenda.workspaceId, meeting.agenda.documentId)) : undefined;
    // What's going on hasn't ended: a release before this one can have started one again with no key.
    return { shown: { ...out, present: shown, ended: shown && said?.key === shown.key ? null : said, documents: inOrder, agenda: agenda?.id ?? null }, lost };
  } catch (e) {
    wlog.warn('workspace not read for someone in a call', { callId: x.callId, err: e });
    return { shown: shut, lost: { present: [], space: [], play: [] } };
  }
}

/* ---------- the call's home, and what's viewed ---------- */

/** Who an account is to a workspace, without a call. */
const accountWho = (o: Owner, email: string): Who => ({ email, principals: [emailIndex(o, email)] });

/** The workspace everyone in the call views and edits together: its home, unless the organizer switched to another. */
export const viewedIn = (m: Pick<MeetingManifest, 'workspaceId'>, w: Pick<CallSpace, 'viewing'>): string | null => w.viewing ?? m.workspaceId;

/** What a call's new home and its folder are called: the call, and the day it started where `timeZone` is. */
export const homeName = (title: string, startedAt: Date, timeZone: string): string =>
  `${title.replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled call'} · ${dayOf(startedAt.toISOString(), timeZone)}`;

/** This run of a call's folder, as it's made: its name, and whose call it is. Its note comes when the call's over (`homeAfter`). */
export const folderFor = (o: Owner, organizer: string, callId: string, folderId: string, name: string, startedAt: Date): CallFolder => ({
  id: folderId, name, call: { ownerId: o.ownerId, callId, organizer: organizer.trim().toLowerCase(), startedAt: startedAt.toISOString(), noteId: null, ended: false }
});

/** What a call's new home starts with, besides its folder: the call it's for. */
export const madeForCall = (m: Loaded<MeetingManifest>, startedAt: Date): Omit<MadeFor, 'out'> =>
  ({ title: m.manifest.title, at: startedAt.toISOString(), meetingId: m.itemId, seriesId: m.manifest.seriesId ?? null });
/** Whether a home was made for this call, or for its series, so who's in it follows the call's invite. */
export const homeOf = (made: MadeFor | null, m: Loaded<MeetingManifest>): boolean =>
  made !== null && (made.meetingId === m.itemId || (made.seriesId !== null && made.seriesId === (m.manifest.seriesId ?? null)));

/**
 * A workspace chosen as a call's home, if its organizer can still make things there: the call writes its folder in their
 * name, so it takes what making a folder takes (`organizerEdits`). Undefined for one deleted since, or theirs no longer.
 */
export async function usableHome(o: Owner, email: string, workspaceId: string | null): Promise<HeldWorkspace | undefined> {
  const w = workspaceId ? await serverWorkspace(o, workspaceId) : undefined;
  return w && await organizerEdits(o, w, o.pool, email) ? w : undefined;
}

/** Where putting a call's folder in a home left it: there, with no room for it in a full workspace, or with no home, deleted since. */
export type FolderPut = 'made' | 'full' | 'gone';
/**
 * Puts this run of the call's folder in a home that's there already, in that workspace's own transaction, with nothing of the
 * call held. Only a folder that's there counts as made: a full home has no room, and the call settles on another.
 */
export async function folderIn(o: Owner, workspaceId: string, folder: CallFolder): Promise<FolderPut> {
  return tx(o.pool, async (c) => {
    const w = await serverWorkspace(o, workspaceId, c, 'change');
    if (!w) return 'gone';
    return await addCallFolder(w, c, folder) ? 'made' : 'full';
  });
}

/**
 * Who's on the invite as far as a call's home goes: the call's own, and, for a call in a series, every call of it that hasn't
 * ended and has the same home. Lower-cased.
 */
async function invitedTo(o: Owner, m: Loaded<MeetingManifest>, home: string): Promise<Set<string>> {
  const series = m.manifest.seriesId;
  const calls = series ? (await allMeetings(o)).filter((x) => x.manifest.seriesId === series && x.manifest.workspaceId === home && x.manifest.status !== 'ended') : [];
  return new Set([m, ...calls].flatMap((x) => x.manifest.guests.map((e) => e.trim().toLowerCase())));
}

/**
 * Who's in the call's home follows its invite, one change at a time, when it was made for the call or its series
 * (`followInvite`): whoever the change put on the invite is let in, if they're on it still, and whoever it took off is
 * taken out, unless the series still invites them to a call to come. So does who's in each workspace made in the call
 * (`made`), by the call's own invite. It never throws: the call goes on, and the next change, or the next call's start,
 * tries again.
 */
export async function followHome(o: Owner, meetingId: string, change: InviteChange, made: readonly string[] = []): Promise<void> {
  if (!change.add?.length && !change.gone?.length) return;
  try {
    const m = await findItem(o, o.pool, 'meeting', meetingId, MeetingManifest);
    if (!m) return;
    const home = m.manifest.workspaceId;
    const own = new Set(m.manifest.guests.map((e) => e.trim().toLowerCase()));
    const spaces = new Map<string, Set<string>>(made.map((x) => [x, own]));
    if (home) spaces.set(home, await invitedTo(o, m, home));
    let organizer: string | undefined;
    for (const [workspaceId, invited] of spaces) {
      const add = (change.add ?? []).filter((e) => invited.has(e.trim().toLowerCase()));
      const gone = (change.gone ?? []).filter((e) => !invited.has(e.trim().toLowerCase()));
      if (!add.length && !gone.length) continue;
      const by = (organizer ??= (await profile(o)).email);
      await tx(o.pool, async (c) => {
        const w = await serverWorkspace(o, workspaceId, c, 'change');
        if (w && homeOf(w.state.madeFor, m)) await followInvite(w, c, by, { add, gone });
      });
    }
  } catch (e) {
    wlog.warn('a call’s home didn’t follow its invite', { meetingId, err: e });
  }
}

/**
 * Who each call a change to `meetingId` can reach invites, as they are: that call's, and the rest of its series' that haven't
 * ended. Asked before the change, for the calls' homes to follow it afterwards (`followInvites`).
 */
export async function invitesOf(o: Owner, meetingId: string, m: Pick<MeetingManifest, 'guests' | 'seriesId'>): Promise<Map<string, string[]>> {
  const series = m.seriesId;
  const calls = series ? (await allMeetings(o)).filter((x) => x.manifest.seriesId === series && x.itemId !== meetingId && x.manifest.status !== 'ended') : [];
  return new Map([[meetingId, m.guests], ...calls.map((x): [string, string[]] => [x.itemId, x.manifest.guests])]);
}
/**
 * A change to scheduled calls' invites reaches the homes made for them as a change in the call does (`followHome`): who it
 * put on an invite is let in, and who it took off is taken out. `before`: the invites as they were (`invitesOf`). Never throws.
 */
export async function followInvites(o: Owner, before: Map<string, string[]>): Promise<void> {
  try {
    const now = new Map((await allMeetings(o)).map((x) => [x.itemId, x]));
    const lower = (xs: string[]) => new Set(xs.map((e) => e.trim().toLowerCase()));
    const homes = new Map<string, { meetingId: string; add: Set<string>; gone: Set<string> }>();
    for (const [meetingId, was] of before) {
      const m = now.get(meetingId);
      const home = m?.manifest.workspaceId;
      if (!m || !home) continue;
      const then = lower(was);
      const after = lower(m.manifest.guests);
      const at = homes.get(home) ?? { meetingId, add: new Set<string>(), gone: new Set<string>() };
      for (const e of after) if (!then.has(e)) at.add.add(e);
      for (const e of then) if (!after.has(e)) at.gone.add(e);
      homes.set(home, at);
    }
    for (const { meetingId, add, gone } of homes.values()) await followHome(o, meetingId, { add: [...add], gone: [...gone] });
  } catch (e) {
    wlog.warn('calls’ homes didn’t follow their invites', { calls: before.size, err: e });
  }
}

/** What viewing another workspace would mean: refused as switching is. It goes only by who's in the workspace, which the organizer can see: what's been given to anyone beyond that isn't theirs to know. */
export async function preview(v: Viewer, reader: Reader, people: Joined[], workspaceId: string): Promise<CallWorkspaceSwitch> {
  const o = v.organizer;
  const w = await workspaceFor(o, reader, workspaceId);
  requireRole(w, 'edit');
  const inCall = people.filter((j) => j.status === 'in' && j.role !== 'host');
  const who = inCall.map((j) => ({ j, who: j.email ? accountWho(o, j.email) : { email: undefined, principals: [] } }));
  const holders = await holdersOf(o.pool, w.owner.ownerId, who.flatMap((x) => x.who.principals));
  return { name: w.state.name, cantOpen: who.filter((x) => standingIn({ ...holders, shares: [] }, x.who).role === null).map((x) => firstName(x.j.name)) };
}

/** Later calls in a series that had the home `from` follow it to `to`, once a call of theirs settles one: they're the same meetings, so it can only be said here. */
export async function carryForward(o: Owner, meetingId: string, from: string | null, to: string): Promise<void> {
  try {
    const m = await findItem(o, o.pool, 'meeting', meetingId, MeetingManifest);
    if (!m?.manifest.seriesId) return;
    const later = (await allMeetings(o)).filter((x) => x.manifest.seriesId === m.manifest.seriesId && x.itemId !== meetingId && x.manifest.status === 'scheduled' && x.manifest.startsAt > m.manifest.startsAt && x.manifest.workspaceId === from);
    for (const x of later) await tx(o.pool, (c) => updateManifest(o, c, x.itemId, (y) => (y.workspaceId === from ? { ...y, workspaceId: to } : y)));
  } catch (e) {
    wlog.warn('later calls not moved to the workspace', { meetingId, err: e });
  }
}

/* ---------- what people do ---------- */

export type SpaceAction = Extract<CallAction, { type: 'workspace-set' | 'workspace-new' | 'workspace-bring' | 'workspace-ask' | 'workspace-grant' | 'workspace-decline' | 'present-start' | 'present-move' | 'present-stop' | 'play-start' | 'play-pause' | 'play-resume' | 'play-seek' | 'play-stop' }>;
const SPACE_ACTIONS: ReadonlySet<CallAction['type']> = new Set(['workspace-set', 'workspace-new', 'workspace-bring', 'workspace-ask', 'workspace-grant', 'workspace-decline', 'present-start', 'present-move', 'present-stop', 'play-start', 'play-pause', 'play-resume', 'play-seek', 'play-stop']);
export const isSpaceAction = (a: CallAction): a is SpaceAction => SPACE_ACTIONS.has(a.type);
/** What's anyone's in a call: what they can do goes by what they can open. The rest of a call's workspace is its organizer's. */
const ANYONES: ReadonlySet<CallAction['type']> = new Set(['workspace-open', 'workspace-bring', 'workspace-ask', 'present-start', 'present-move', 'present-stop', 'play-start', 'play-pause', 'play-resume', 'play-seek', 'play-stop']);
export const anyonesAction = (a: CallAction): boolean => ANYONES.has(a.type);

const noDocument = (documentId: string) => notFound('That document', { documentId });
/** What someone can't reach reads as what was never there: one refusal for both, in the same words, whatever made it so. */
async function reached<T>(documentId: string, f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof NotFoundError) throw noDocument(documentId);
    throw e;
  }
}

/** A video to play has to be in its document, in the call's workspace, for someone who can open it. Reads the document, so it's asked with nothing held. */
export async function mayPlay(o: Owner, reader: Reader, workspaceId: string | null, documentId: string, mediaId: string): Promise<void> {
  if (!workspaceId) throw noDocument(documentId);
  await reached(documentId, async () => {
    const w = await workspaceFor(o, reader, workspaceId);
    const { item } = requireDocument(reader, w, documentId, 'read');
    if (!await readDocument(w, documentId, 'holdsVideo', { kind: kindOf(item), media: mediaId })) throw noDocument(documentId);
  });
}

/** What a call is when someone does something about its workspace: read with nothing held, and read again under its row. */
export interface Changing<S extends Spaced> {
  v: Viewer; reader: Reader; callId: string;
  meeting: Loaded<MeetingManifest>;
  /** When this run of the call started. */
  startedAt: Date;
  s: S;
  /** Where whoever's asking is in the call. */
  place: string;
  now: number;
  seatOf: (j: Joined) => string;
}
/**
 * What came of it: the call as it is now, and the seat a grant gave someone who was removed meanwhile, for the caller to take
 * back once the call's row is let go, as their removal does.
 */
export interface Changed<S> {
  s: S; ended?: string | undefined;
  /** A workspace made for the call just now, and who's invited, for them to be let into it once the call's row is let go. */
  made?: { workspaceId: string; guests: string[] } | undefined;
}
/**
 * The change to what the call keeps, in the transaction that holds its row (`c`). What it went by is checked again there, from
 * the call's own state alone; `again` when that's moved on, for it all to be asked afresh with nothing held.
 */
export type Apply<S extends Spaced> = (x: Changing<S> & { c: Db }) => Promise<Changed<S> | 'again'>;

const withSpace = <S extends Spaced>(s: S, workspace: CallSpace): S => ({ ...s, workspace });
/** How many of the workspaces made in a call it keeps following: as many as anyone can have. */
const MADE_KEPT = 100;
const notYours = (callId: string, what: string) => new ForbiddenError('Only whoever started this, or the organizer, can do that.', { context: { callId, what } });
/** Whether someone can open a document in a workspace, read with nothing held. */
async function opens(d: Deps, reader: Who, workspaceId: string, documentId: string): Promise<boolean> {
  try {
    requireDocument(reader, await workspaceFor(d, reader, workspaceId), documentId, 'read');
    return true;
  } catch (e) {
    if (e instanceof NotFoundError) return false;
    throw e;
  }
}
/**
 * Whether the workspace itself opens for someone (`opensItself`), which is what presenting it takes: read with nothing held, and
 * its tree read (`seenAt`) only for someone with no role in it, to see what's been given to them.
 */
async function opensWorkspace(d: Deps, who: Who, workspaceId: string): Promise<boolean> {
  const at = await workspaceAt(d.pool, workspaceId);
  if (!at) return false;
  const standing = standingIn(await holdersOf(d.pool, at.ownerId, who.principals), who);
  if (standing.role !== null) return true;
  if (!standing.grants.size) return false;
  const seen = await seenAt(d, workspaceId, at.version, [...standing.grants.keys()]);
  return seen !== undefined && opensItself(standing, seen);
}
/**
 * Someone else presenting in a part of the call, a board or the workspace `viewed`, while it shows and they can still open it: a
 * start there is refused. Someone reloading, or who's lost it, is in nobody's way.
 */
async function presentingThere(o: Owner, callId: string, s: Spaced, place: string, viewed: string | null, person: string): Promise<boolean> {
  for (const p of s.workspace.present) {
    if (p.place === place && p.by.person !== person && showing(s, p) && onStage(s, p) && await opens(o, whoStarted(o, callId, p.by), p.workspaceId, p.id)) return true;
  }
  for (const p of s.workspace.space) {
    if (p.place === place && p.by.person !== person && p.workspaceId === viewed && showing(s, p) && await opensWorkspace(o, whoStarted(o, callId, p.by), p.workspaceId)) return true;
  }
  return false;
}
/** What's presented in one part of the call, as a start over it goes by: whose, what, and whether it shows. */
const presentSlot = (s: Spaced, place: string): string => [
  ...s.workspace.present.filter((p) => p.place === place).map((p) => `${p.by.person}:${p.workspaceId}:${p.id}:${String(showing(s, p))}`),
  ...s.workspace.space.filter((p) => p.place === place).map((p) => `${p.by.person}:${p.workspaceId}:${String(showing(s, p))}`)
].join(' ');
const playSlot = (s: Placing, p: Playing | undefined): string => (p ? `${p.by.person}:${p.workspaceId}:${p.documentId}:${p.mediaId}:${String(showing(s, p))}` : '');
/** Where a document brought or taken off is from: what's brought, from the workspace viewed; what's taken off can have come from one viewed before. */
const broughtFrom = (m: Pick<MeetingManifest, 'workspaceId' | 'documents'>, w: Pick<CallSpace, 'viewing'>, a: { documentId: string; brought: boolean }): string | null =>
  a.brought ? viewedIn(m, w) : m.documents.flatMap((id) => { const at = placeOfBrought(id); return at?.documentId === a.documentId ? [at.workspaceId] : []; })[0] ?? viewedIn(m, w);

/** What's asked to be presented. */
type PresentWhat = Extract<SpaceAction, { type: 'present-start' }>['what'];
/** What's to be presented, and where it's kept: the workspace everyone views, or the board open here, wherever it's kept. */
type Presentable = { kind: 'workspace'; workspaceId: string } | { kind: 'board'; workspaceId: string; id: string; section: number };
/**
 * What someone asks to present, if they may, read with nothing held. The workspace is presented as everyone views it, by someone
 * something in it opens for, and a call that views none has none to present. A board is presented where it's open: the one on
 * everyone's stage in this part of the call, from wherever it's kept, and nothing else, for someone who can open it, while it
 * isn't in Trash. What they can't reach reads as what isn't there.
 */
async function presentable<S extends Spaced>(x: Changing<S>, what: PresentWhat, viewed: string | null): Promise<Presentable> {
  const { v, reader, s, callId, place } = x;
  if (what.kind === 'workspace') {
    if (!viewed || !(await opensWorkspace(v.organizer, reader, viewed))) throw notFound('That workspace', { callId });
    return { kind: 'workspace', workspaceId: viewed };
  }
  const open = s.board.open[boardPlace(s, place)];
  if (open?.documentId !== what.id) throw noDocument(what.id);
  const held = await workspaceFor(v.organizer, reader, open.workspaceId);
  if (requireDocument(reader, held, what.id, 'read').item.kind !== 'board') throw noDocument(what.id);
  if (trashOf(held.state, what.id)) throw new ConflictError('This is in Trash. Restore it to present it.', { context: { callId, documentId: what.id } });
  return { kind: 'board', workspaceId: open.workspaceId, id: what.id, section: what.section };
}

/**
 * Everyone views `workspaceId` together, the home or another: what's being presented, a board or the workspace, ends for good in
 * every part of the call, and that's said there at once; what's playing stops; and the notes still go home.
 */
function view<S extends Spaced>(x: Changing<S>, workspaceId: string): Changed<S> {
  const home = x.meeting.manifest.workspaceId;
  if (viewedIn(x.meeting.manifest, x.s.workspace) === workspaceId) return { s: x.s };
  wlog.info('call views a workspace', { callId: x.callId, workspaceId, home: workspaceId === home });
  const w = x.s.workspace;
  const over = endedFor(w, { present: w.present, space: w.space }, placesOf(x.s), ending(x.v.organizer, x.callId, x.now));
  return { s: withSpace(x.s, { ...over, play: [], viewing: workspaceId === home ? null : workspaceId }) };
}

/**
 * Whatever someone does about the call's workspace, in two steps, because a live call comes first: nothing under the call's
 * row waits on a workspace's lock, opens a workspace or works through its documents. This is the first, with nothing of the
 * call held: who may, whether what's asked for opens, and a grant, which changes the workspace under that row in a
 * transaction of its own. What it returns is the second (`Apply`). Access is asked on every read of the call, so whatever
 * changes in between is found there.
 */
export async function prepare<S extends Spaced>(x: Changing<S>, a: SpaceAction): Promise<Apply<S>> {
  const { v, reader, s, callId, place } = x;
  const o = v.organizer;
  const w = s.workspace;
  const inUse = viewedIn(x.meeting.manifest, w);
  const control = (p: { by: Controller }) => p.by.person === v.pass.person || v.isOrganizer;
  switch (a.type) {
    case 'workspace-set': {
      requireRole(await workspaceFor(o, reader, a.workspaceId), 'edit');
      return (y) => Promise.resolve(view(y, a.workspaceId));
    }
    /*
     * A workspace made now is one nobody else can reach yet, so making it under the call's row waits on nobody. It's made for
     * this call, as its home is: everyone invited is let in to edit once the row's let go, and who's in it follows the invite
     * for as long as the call's on (the call keeps it in `made`).
     */
    case 'workspace-new': return async (y) => {
      const name = a.name ?? (y.meeting.manifest.title.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled');
      const { id } = await createIn(o, y.c, name, { ...madeForCall(y.meeting, y.startedAt), seriesId: null });
      const { s } = view(y, id);
      return { s: withSpace(s, { ...s.workspace, made: [...s.workspace.made, id].slice(-MADE_KEPT) }), made: { workspaceId: id, guests: y.meeting.manifest.guests } };
    };
    case 'workspace-bring': {
      const from = broughtFrom(x.meeting.manifest, w, a);
      if (!from) throw noDocument(a.documentId);
      await reached(a.documentId, async () => requireDocument(reader, await workspaceFor(o, reader, from), a.documentId, 'read'));
      return async (y) => {
        if (broughtFrom(y.meeting.manifest, y.s.workspace, a) !== from) return 'again';
        const id = broughtId(from, a.documentId);
        await updateManifest(o, y.c, y.meeting.itemId, (m) => {
          if (a.brought === m.documents.includes(id)) return m;
          if (!a.brought) return { ...m, documents: m.documents.filter((d) => d !== id) };
          if (m.documents.length >= MAX_BROUGHT) throw new ConflictError('This call has as many documents as it can bring. Take one off first.', { context: { callId, documents: m.documents.length } });
          return { ...m, documents: [...m.documents, id] };
        });
        return { s: y.s };
      };
    }
    case 'workspace-ask': {
      if (v.isOrganizer) throw new ValidationError('You choose the workspace for this call.', { context: { callId } });
      return async (y) => {
        const now = y.s.workspace;
        const others = now.asks.filter((q) => q.person !== v.pass.person);
        if (!a.up) return { s: withSpace(y.s, { ...now, asks: others }) };
        if (now.asks.some((q) => q.person === v.pass.person && q.state === 'asking')) return { s: y.s };
        return { s: withSpace(y.s, { ...now, asks: [...others, { id: id128(), person: v.pass.person, at: y.now, state: 'asking' }] }) };
      };
    }
    case 'workspace-grant': {
      const ask = w.asks.find((q) => q.id === a.askId && q.state === 'asking');
      const j = ask && here(s, ask.person);
      if (!ask || !j) throw new ValidationError('That ask isn’t open.', { context: { callId } });
      if (!inUse) throw noDocument(a.documentId);
      const seat = x.seatOf(j);
      await tx(o.pool, async (c) => {
        const held = await workspaceFor(o, reader, inUse, c, 'change');
        requireSharing(reader, held, a.documentId);
        await grant(held, c, a.documentId, [{ kind: 'seat', callId, seat, name: j.name, role: a.role }]);
      });
      wlog.info('document opened to someone in a call', { callId, workspaceId: inUse, documentId: a.documentId, role: a.role });
      return async (y) => ({ s: withSpace(y.s, { ...y.s.workspace, asks: y.s.workspace.asks.filter((q) => q.id !== ask.id) }), ended: y.s.removed.includes(ask.person) ? seat : undefined });
    }
    case 'workspace-decline': return async (y) => {
      const now = y.s.workspace;
      if (!now.asks.some((q) => q.id === a.askId && q.state === 'asking')) throw new ValidationError('That ask isn’t open.', { context: { callId } });
      return { s: withSpace(y.s, { ...now, asks: now.asks.map((q) => (q.id === a.askId ? { ...q, state: 'declined' as const } : q)) }) };
    };
    /*
     * One at a time in each part of the call: nobody starts over someone else presenting there (`presentable` says what may be).
     * Starting while you present one presents this in its place, as a new presentation unless it's the same again: a start clears
     * how the last one here ended, and a new presentation by the same person here is the end of their last. Someone else's here
     * is hidden while they reload, or the start would have been refused: it ends for good, and that's said.
     */
    case 'present-start': {
      const what = await presentable(x, a.what, inUse);
      if (await presentingThere(o, callId, s, place, inUse, v.pass.person)) throw new ConflictError('Someone else is presenting here.', { context: { callId, kind: what.kind } });
      const slot = presentSlot(s, place);
      return async (y) => {
        const now = y.s.workspace;
        const still = what.kind === 'board' ? y.s.board.open[boardPlace(y.s, place)]?.documentId === what.id : viewedIn(y.meeting.manifest, now) === what.workspaceId;
        if (!still || y.place !== place || presentSlot(y.s, place) !== slot) return 'again';
        const by = controllerOf(v, reader);
        const mine = (p: { place: string; by: Controller }) => p.place === place && p.by.person === v.pass.person;
        const theirs = (p: { place: string; by: Controller }) => p.place === place && p.by.person !== v.pass.person;
        const cleared = { ...now, ended: now.ended.filter((e) => e.place !== place) };
        const after = endedFor(cleared, { present: now.present.filter(theirs), space: now.space.filter(theirs) }, placesOf(y.s), ending(o, callId, y.now));
        const others = { present: after.present.filter((p) => p.place !== place), space: after.space.filter((p) => p.place !== place) };
        if (what.kind === 'board') {
          const was = now.present.find((p) => mine(p) && p.kind === 'board' && p.id === what.id);
          const next: Presenting = { place, workspaceId: what.workspaceId, kind: 'board', id: what.id, section: what.section, by, key: was ? was.key : id128(), since: was ? was.since : y.now };
          return { s: withSpace(y.s, { ...after, ...others, present: [...others.present, next] }) };
        }
        const next: SpacePresenting = now.space.find((p) => mine(p) && p.workspaceId === what.workspaceId) ?? { place, workspaceId: what.workspaceId, key: id128(), since: y.now, by };
        return { s: withSpace(y.s, { ...after, ...others, space: [...others.space, next] }) };
      };
    }
    /* A board, a frame at a time. */
    case 'present-move': return async (y) => {
      const now = y.s.workspace;
      const p = presentedHere(y.s, y.place, viewedIn(y.meeting.manifest, now));
      if (!p) throw new ConflictError('Nothing is being presented here.', { context: { callId, what: a.type } });
      if (!control(p.p)) throw notYours(callId, a.type);
      if (p.kind !== 'board') throw new ConflictError('Only a board is presented a frame at a time.', { context: { callId, what: a.type } });
      const board = p.p;
      return { s: withSpace(y.s, { ...now, present: [...now.present.filter((q) => q !== board), { ...board, section: a.section }] }) };
    };
    /*
     * It ends for whoever presented it, and everyone following keeps it open on their own, which only they can choose; or for
     * everyone (`close`), by them or the organizer. So a presenter told theirs closed for everyone without them knows it was the
     * organizer. Everyone there is told which, until another starts there: `ended` names the presentation, and its presenter,
     * whoever stopped it. A board closed for everyone closes in the call too, where it's open, as board-close closes it: by the
     * organizer always; by anyone else when it's this part of the call's own board, or they opened it, and nobody else presents it
     * anywhere it shows. Otherwise it's closed for everyone in their part of the call, and stays the call's.
     */
    case 'present-stop': return async (y) => {
      const now = y.s.workspace;
      const p = presentedHere(y.s, y.place, viewedIn(y.meeting.manifest, now));
      if (!p) throw new ConflictError('Nothing is being presented here.', { context: { callId, what: a.type } });
      if (!control(p.p)) throw notYours(callId, a.type);
      const theirs = p.p.by.person === v.pass.person;
      if (!a.close && !theirs) throw new ForbiddenError('Only whoever’s presenting this can end it just for themselves.', { context: { callId, what: a.type } });
      const e = ending(o, callId, y.now);
      const stopped = withSpace(y.s, endedFor(now, p.kind === 'board' ? { present: [p.p], space: [] } : { present: [], space: [p.p] }, placesOf(y.s), e, a.close));
      const at = boardPlace(stopped, y.place);
      const mayClose = v.isOrganizer || ((at === y.place || stopped.board.open[at]?.by.person === v.pass.person) && !boardPresentedOver(stopped, at, v.pass.person, null));
      const closes = p.kind === 'board' && a.close && mayClose;
      wlog.info('presentation ended', { callId, kind: p.kind, close: a.close, theirs, boardClosed: closes });
      return { s: closes ? boardClosed(stopped, at, e, { person: v.pass.person, organizer: v.isOrganizer }) : stopped };
    };
    case 'play-start': {
      if (!inUse) throw noDocument(a.documentId);
      await mayPlay(o, reader, inUse, a.documentId, a.mediaId);
      const there = w.play.find((p) => p.place === place);
      if (there && showing(s, there) && there.by.person !== v.pass.person && await opens(o, whoStarted(o, callId, there.by), there.workspaceId, there.documentId)) {
        // Someone who can't open what's playing isn't told it is: what they try reads as their own video not being there.
        if (!await opens(o, reader, there.workspaceId, there.documentId)) throw noDocument(a.documentId);
        throw new ConflictError('Someone else is playing something here.', { context: { callId } });
      }
      const slot = playSlot(s, there);
      return async (y) => {
        const now = y.s.workspace;
        if (viewedIn(y.meeting.manifest, now) !== inUse || y.place !== place || playSlot(y.s, now.play.find((p) => p.place === place)) !== slot) return 'again';
        const next: Playing = { place, workspaceId: inUse, documentId: a.documentId, mediaId: a.mediaId, by: controllerOf(v, reader), playing: true, positionMs: a.positionMs, atMs: y.now };
        return { s: withSpace(y.s, { ...now, play: [...now.play.filter((p) => p.place !== place), next] }) };
      };
    }
    case 'play-pause':
    case 'play-resume':
    case 'play-seek':
    case 'play-stop': {
      const p = w.play.find((q) => q.place === place && showing(s, q));
      // What someone can't open is never said to be playing, so it reads the same as nothing playing.
      if (!p || !(await opens(o, reader, p.workspaceId, p.documentId))) throw new ConflictError('Nothing is playing here.', { context: { callId, what: a.type } });
      if (!control(p)) throw notYours(callId, a.type);
      const slot = playSlot(s, p);
      return async (y) => {
        const now = y.s.workspace;
        const q = now.play.find((x2) => x2.place === place && showing(y.s, x2));
        if (y.place !== place || playSlot(y.s, q) !== slot || !q) return 'again';
        const rest = now.play.filter((x2) => x2 !== q);
        if (a.type === 'play-stop') return { s: withSpace(y.s, { ...now, play: rest }) };
        const at = a.type === 'play-pause' ? { playing: false, positionMs: a.positionMs } : a.type === 'play-seek' ? { positionMs: a.positionMs } : { playing: true };
        return { s: withSpace(y.s, { ...now, play: [...rest, { ...q, ...at, atMs: y.now }] }) };
      };
    }
  }
}

/** What's kept of something worked on in a call, once it's known what it is. Nothing, if it's gone. */
export async function workedEntry(d: Deps, at: Pick<WorkedDocument, 'workspaceId' | 'documentId'>): Promise<Omit<WorkedDocument, 'by'> | undefined> {
  const item = (await serverWorkspace(d, at.workspaceId))?.state.items[at.documentId];
  return item ? { workspaceId: at.workspaceId, documentId: at.documentId, kind: kindOf(item), open: null } : undefined;
}

/* ---------- the call's follow-ups ---------- */

const byWorkspace = (worked: WorkedDocument[]): Map<string, WorkedDocument[]> => {
  const out = new Map<string, WorkedDocument[]>();
  for (const x of worked) out.set(x.workspaceId, [...(out.get(x.workspaceId) ?? []), x]);
  return out;
};
/** How many documents worked on in a call its follow-ups are read from: the ones most recently worked on. */
const FOLLOW_UP_DOCUMENTS = 20;
/** What a call is given of each one's follow-ups, worked out where it's read (`followUpsIn`): a document can hold thousands. */
const FOLLOW_UP_LIMITS: FollowUpLimits = { max: 25, chars: 300, tags: 5 };
/** How many come from documents in all. */
const MAX_DOCUMENT_FOLLOW_UPS = 100;
/** How long what was read of a document's follow-ups stands for it once someone's typed: nobody's poll reads it again for anyone sooner. */
const FOLLOW_UPS_FRESH_MS = 3_000;
const MAX_READ = 512;
/** A document's follow-ups as last read: as of where it had got to (`at`), and when. */
interface Read { at: string; when: number; items: DocTodo[] }
const readByHub = new WeakMap<Hub, Map<string, Read>>();
const readingByHub = new WeakMap<Hub, Map<string, Promise<DocTodo[]>>>();
const readsOn = (d: Deps) => {
  const read = readByHub.get(d.hub) ?? new Map<string, Read>();
  readByHub.set(d.hub, read);
  const reading = readingByHub.get(d.hub) ?? new Map<string, Promise<DocTodo[]>>();
  readingByHub.set(d.hub, reading);
  return { read, reading };
};
/**
 * One document's follow-ups where it's got to, for everyone in the call: read once for each place it gets to, by whoever asks
 * first, however many ask at once, and that stands for a moment more while people type, so a poll every few seconds by
 * everyone in the call reads each document at most every few seconds between them. What's kept is what a call is shown of it,
 * by ID, and only for someone who can open it now. `tree` opens the workspace, if it comes to reading.
 */
async function followUpsAt(d: Deps, workspaceId: string, documentId: string, at: string, tree: () => Promise<HeldWorkspace | undefined>): Promise<DocTodo[]> {
  const { read, reading } = readsOn(d);
  const key = `${workspaceId}:${documentId}`;
  const known = read.get(key);
  if (known && (known.at === at || Date.now() - known.when < FOLLOW_UPS_FRESH_MS)) return known.items;
  const once = `${key}:${at}`;
  let p = reading.get(once);
  if (!p) {
    p = (async () => {
      const w = await tree();
      const item = w?.state.items[documentId];
      return w && item ? readDocument(w, documentId, 'followUps', { kind: kindOf(item), ...FOLLOW_UP_LIMITS }) : [];
    })().finally(() => reading.delete(once));
    reading.set(once, p);
  }
  const items = await p;
  read.delete(key);
  read.set(key, { at, when: Date.now(), items });
  for (const oldest of read.keys()) {
    if (read.size <= MAX_READ) break;
    read.delete(oldest);
  }
  return items;
}
/** What was read of a document's follow-ups no longer stands: it was just ticked from the call, and whoever ticked it sees the tick. */
const forgetFollowUps = (d: Deps, workspaceId: string, documentId: string): void => { readsOn(d).read.delete(`${workspaceId}:${documentId}`); };

/**
 * To-dos with a person and a date in the documents most recently worked on in this call, for someone who can open each, so
 * many from each and so many in all. Who can open what is asked on every read, from the tree as it is at its version
 * (`seenAt`), and what's in each document is read once for everyone (`followUpsAt`). One that won't open, or is closed, is
 * left out, and the rest still come.
 */
async function fromDocuments(d: Deps, reader: Reader, worked: WorkedDocument[]): Promise<DocFollowUp[]> {
  const out: DocFollowUp[] = [];
  for (const [workspaceId, documents] of byWorkspace(worked.slice(-FOLLOW_UP_DOCUMENTS))) {
    const at = await workspaceAt(d.pool, workspaceId);
    if (!at) continue;
    const standing = standingIn(await holdersOf(d.pool, at.ownerId, reader.principals), reader);
    if (!canOpen(standing)) continue;
    const seen = await seenAt(d, workspaceId, at.version, documents.map((x) => x.documentId));
    if (!seen) continue;
    const opened = documents.flatMap(({ documentId }) => {
      const f = seen.items.get(documentId);
      const role = f && !f.trashed ? roleOf(reader, standing, documentId, f.item) : undefined;
      return f && role ? [{ documentId, name: f.item.name, role }] : [];
    });
    if (!opened.length) continue;
    const marks = await documentsAt(d.pool, at.ownerId, opened.map((x) => x.documentId));
    let held: Promise<HeldWorkspace | undefined> | undefined;
    const tree = () => { held ??= serverWorkspace(d, workspaceId); return held; };
    for (const { documentId, name, role } of opened) {
      const mark = marks.get(documentId);
      if (!mark || mark.closed) continue;
      try {
        for (const t of await followUpsAt(d, workspaceId, documentId, mark.at, tree)) {
          out.push({ from: 'document', workspaceId, documentId, document: name, block: t.block, text: t.text, mentions: t.mentions, dates: t.dates, done: t.done, canTick: role === 'edit' });
        }
      } catch (e) {
        wlog.warn('document not read for the call’s follow-ups', { workspaceId, documentId, err: e });
      }
      if (out.length >= MAX_DOCUMENT_FOLLOW_UPS) return out.slice(0, MAX_DOCUMENT_FOLLOW_UPS);
    }
  }
  return out;
}
/** The call's follow-ups: the live notes' as this person reads them, what people added, then the documents'. */
export async function followUps(d: Deps, reader: Reader, notes: LiveNotes, status: CallFollowUps['notes'], worked: WorkedDocument[]): Promise<CallFollowUps> {
  const said: CallFollowUp[] = (notes.notes?.next ?? []).map((f) => ({ ...f, from: 'notes' }));
  const added: CallFollowUp[] = notes.added.map((f) => ({ ...f, from: 'added' }));
  return { items: [...said, ...added, ...await fromDocuments(d, reader, worked)], suggestions: notes.suggestions, notes: status };
}
/**
 * A follow-up ticked from the call, or the tick taken back: the to-do's own `done`, as the editor sets it, so a tick here and
 * a tick in the document are the same. Only in a document worked on in this call. Whoever can't open it, or has lost it by
 * the time it's written, finds nothing there: the same refusal as for a follow-up that never was, so it says nothing of what
 * was worked on in this call.
 */
export async function tick(d: Deps, reader: Reader, callId: string, worked: WorkedDocument[], t: DocFollowUpTick): Promise<{ entry: Omit<WorkedDocument, 'by'>; by: WorkedBy }> {
  const shut = () => notFound('That follow-up', { callId });
  const found = worked.find((x) => x.workspaceId === t.workspaceId && x.documentId === t.documentId);
  if (!found) throw shut();
  try {
    const w = await workspaceFor(d, reader, t.workspaceId);
    const { item } = requireDocument(reader, w, t.documentId, 'edit');
    const by = editorOf(w.owner, reader);
    const { result: ticked } = await writeDocument(w, t.documentId, 'tickFollowUp', { kind: kindOf(item), block: t.block, done: t.done }, {
      by, callId, holding: async (c) => { requireDocument(reader, await workspaceFor(d, reader, t.workspaceId, c, 'hold'), t.documentId, 'edit'); }
    });
    if (!ticked) throw shut();
    forgetFollowUps(d, t.workspaceId, t.documentId);
    return { entry: found, by };
  } catch (e) {
    if (e instanceof NotFoundError) throw shut();
    throw e;
  }
}

/* ---------- when a call ends ---------- */

const looksLikeAgenda = (name: string) => /^agenda\b/i.test(name.trim());
/** The document that was this call's agenda, out of what it brought and what it worked on: by its name, or by what it says. */
async function agendaOf(o: Owner, documents: string[], worked: WorkedDocument[]): Promise<{ workspaceId: string; documentId: string } | undefined> {
  const seen = new Set<string>();
  const candidates = [...documents.flatMap((id) => { const at = placeOfBrought(id); return at ? [at] : []; }), ...worked.map(({ workspaceId, documentId }) => ({ workspaceId, documentId }))]
    .filter((x) => { const key = broughtId(x.workspaceId, x.documentId); const fresh = !seen.has(key); seen.add(key); return fresh; });
  for (const x of candidates) {
    const w = await serverWorkspace(o, x.workspaceId);
    const item = w?.state.items[x.documentId];
    if (!w || !item || item.kind !== 'document' || trashOf(w.state, x.documentId)) continue;
    if (looksLikeAgenda(item.name)) return x;
    // One that won't open isn't the agenda as far as anyone can tell, and says nothing about the rest.
    if (await readDocument(w, x.documentId, 'readsAsAgenda', { kind: kindOf(item) }).catch(() => false)) return x;
  }
  return undefined;
}
/** What a call that's just ended leaves for afterwards: what was worked on, its note if it had notes, and its folder if it took one. */
export interface Ended { callId: string; meetingId: string; worked: WorkedDocument[]; noteId: string | null; home: CallHome | null; startedAt: Date }

/**
 * The call's folder once it's over (docs: Calls and recordings › The call's home): its pages read its note from now on, for
 * whoever has it, if it had notes. A folder the call took and never made is made now. A call that had notes and never settled
 * a home gets one now, so they land somewhere: the meeting's, if its organizer can still make things there, else a new one
 * made for it. A folder someone deleted stays gone.
 */
async function homeAfter(o: Owner, end: Ended): Promise<void> {
  const m = await findItem(o, o.pool, 'meeting', end.meetingId, MeetingManifest);
  if (!m) return;
  const organizer = (await profile(o)).email;
  const zone = (m.manifest.seriesId ? await zoneOf(o, m.manifest.seriesId) : undefined) ?? 'UTC';
  const over = (folderId: string): CallFolder => {
    const f = folderFor(o, organizer, end.callId, folderId, homeName(m.manifest.title, end.startedAt, zone), end.startedAt);
    return { ...f, call: { ...f.call, ended: true, noteId: end.noteId } };
  };
  const home = end.home;
  if (home) {
    const folder = over(home.folderId);
    const put = await tx(o.pool, async (c): Promise<FolderPut> => {
      const w = await serverWorkspace(o, home.workspaceId, c, 'change');
      const there = w?.state.items[folder.id];
      if (!w) return 'gone';
      if (there?.call) {
        w.state = { ...w.state, items: { ...w.state.items, [folder.id]: { ...there, call: { ...there.call, ended: true, noteId: end.noteId } } } };
        await saveState(w, c);
        await publish(c, w.workspaceId, TREE_NOTICE);
        return 'made';
      }
      // A folder someone deleted stays gone; one the call took and never made is made now, if there's room.
      return there || home.made ? 'made' : await addCallFolder(w, c, folder) ? 'made' : 'full';
    });
    wlog.info('call folder told the call is over', { callId: end.callId, workspaceId: home.workspaceId, notes: end.noteId !== null, put });
    if (put !== 'full') return;
  }
  if (!end.noteId) return;
  const chosen = m.manifest.workspaceId;
  const folder = over(id128());
  if (chosen && await usableHome(o, organizer, chosen) && await folderIn(o, chosen, folder) === 'made') {
    wlog.info('call folder made after the call', { callId: end.callId, workspaceId: chosen });
    await followHome(o, m.itemId, { add: m.manifest.guests });
    return;
  }
  // A new one: nobody can reach it until the meeting names it, and everyone invited comes in once it does.
  const made = await tx(o.pool, async (c) => {
    const { id } = await makeHome(o, c, { name: folder.name, madeFor: madeForCall(m, end.startedAt), folder });
    const next = await updateManifest(o, c, m.itemId, (x) => ({ ...x, workspaceId: id }));
    return { id, guests: next.guests };
  });
  wlog.info('call home made after the call', { callId: end.callId, workspaceId: made.id });
  await followHome(o, m.itemId, { add: made.guests });
  await carryForward(o, m.itemId, chosen, made.id);
}

/**
 * Once a call has ended and everyone's gone, with nothing held and nobody waiting: its folder, which its note goes to; for a
 * call in a series, which document was its agenda, so the next one can carry on from it; and then a version with reason
 * `call` of everything worked on. It never throws: whatever doesn't work is logged, and costs only what it was keeping.
 */
export async function afterCall(o: Owner, end: Ended): Promise<void> {
  const { callId, meetingId, worked } = end;
  try {
    await homeAfter(o, end);
  } catch (e) {
    wlog.warn('a call’s folder not told it’s over', { callId, err: e });
  }
  try {
    const m = await findItem(o, o.pool, 'meeting', meetingId, MeetingManifest);
    if (m?.manifest.seriesId && !m.manifest.agenda) {
      const agenda = await agendaOf(o, m.manifest.documents, worked);
      if (agenda) await tx(o.pool, (c) => updateManifest(o, c, meetingId, (x) => (x.agenda ? x : { ...x, agenda })));
    }
  } catch (e) {
    wlog.warn('a call’s agenda not kept', { callId, err: e });
  }
  try {
    for (const [workspaceId, documents] of byWorkspace(worked)) {
      const w = await serverWorkspace(o, workspaceId);
      if (!w) continue;
      for (const { documentId } of documents) {
        if (!w.state.items[documentId]) continue;
        await keepVersion(w, documentId, { reason: 'call', callId }).catch((e: unknown) => wlog.warn('version not kept for a call', { callId, workspaceId, documentId, err: e }));
      }
    }
  } catch (e) {
    wlog.warn('what a call worked on not kept', { callId, err: e });
  }
}

/* ---------- the next call's agenda ---------- */

/** What the next agenda will say, worked out with nothing held. */
export interface AgendaPlan { workspaceId: string; last: string; title: string; open: Run[][] }
/** The day a call falls on where its series was scheduled, as an agenda's title says it. A zone the runtime doesn't know some day reads as UTC. */
function dayOf(iso: string, timeZone: string): string {
  const formatted = (zone: string) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short' }).formatToParts(new Date(iso));
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatted(timeZone);
  } catch (e) {
    wlog.warn('an agenda’s title fell back to UTC', { err: e });
    parts = formatted('UTC');
  }
  return `${parts.find((p) => p.type === 'day')?.value ?? ''} ${parts.find((p) => p.type === 'month')?.value ?? ''}`;
}
/**
 * The workspace as the organizer has it, if they may make the next agenda in it from the last one: an agenda is made in
 * their name, so it takes what making a document there takes, `edit` in the workspace, and `edit` on the last one, whose
 * open to-dos it carries. Reading either isn't enough. Undefined otherwise, including once they've been taken out of it.
 */
async function organizerCarries(o: Owner, workspaceId: string, last: string, c?: Db | undefined, lock?: 'change' | undefined): Promise<Workspace | undefined> {
  const who = accountWho(o, (await profile(o, c)).email);
  try {
    const w = await workspaceFor(o, who, workspaceId, c, lock);
    requireRole(w, 'edit');
    requireDocument(who, w, last, 'edit');
    return w;
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError || e instanceof ConflictError) return undefined;
    throw e;
  }
}
/**
 * The agenda to make for a call in a series, if one's due: it has none, the call before it had one, and that's in the
 * workspace this call uses and still in its tree, and its organizer may carry it on (`organizerCarries`). An agenda stays in
 * its workspace: nothing in one is copied to another.
 */
export async function planAgenda(o: Owner, meeting: Loaded<MeetingManifest>): Promise<AgendaPlan | undefined> {
  const { seriesId, startsAt, agenda, workspaceId } = meeting.manifest;
  if (!seriesId || agenda || !workspaceId) return undefined;
  const earlier = (await allMeetings(o)).filter((m) => m.manifest.seriesId === seriesId && m.itemId !== meeting.itemId && m.manifest.agenda && m.manifest.startsAt < startsAt).sort((a, b) => b.manifest.startsAt.localeCompare(a.manifest.startsAt));
  const last = earlier[0]?.manifest.agenda;
  if (!last || last.workspaceId !== workspaceId) return undefined;
  const w = await organizerCarries(o, workspaceId, last.documentId);
  const item = w?.state.items[last.documentId];
  if (!w || !item) return undefined;
  const open = await readDocument(w, last.documentId, 'openTodos', { kind: kindOf(item) });
  return { workspaceId, last: last.documentId, title: `Agenda · ${dayOf(startsAt, await zoneOf(o, seriesId) ?? 'UTC')}`, open };
}
/** How long whoever's making the next agenda has it, before someone else opening Workspace takes it on. */
const AGENDA_CLAIM_MS = 2 * 60_000;
/** Someone's making the next agenda now, so nobody else starts. */
export const makingAgenda = (w: CallSpace, now: number): boolean => w.agendaDraft !== null && w.agendaDraft.until > now;
/**
 * The call's state once someone opening Workspace takes on making the next agenda, under the call's row, so however many open
 * it at once one of them makes it. A draft from a try that didn't work is the one made again, so there's never a second.
 * With none to make, it's looked for: nobody looks again.
 */
export function claimAgenda(w: CallSpace, plan: AgendaPlan | undefined, now: number): { space: CallSpace; draft: AgendaDraft | undefined } {
  if (!plan) return { space: { ...w, agendaLooked: true, agendaDraft: null }, draft: undefined };
  const documentId = w.agendaDraft?.workspaceId === plan.workspaceId ? w.agendaDraft.documentId : id128();
  const draft = { workspaceId: plan.workspaceId, documentId, until: now + AGENDA_CLAIM_MS };
  return { space: { ...w, agendaDraft: draft }, draft };
}
/** The next agenda, made and opened for the server to fill in. */
export type MadeAgenda = HeldWorkspace & { documentId: string };
/**
 * Makes the next agenda as the draft says, unless it's there already, in a transaction of its own under the workspace's row,
 * with the organizer's access asked again there. Nothing of the call is held. Undefined when it isn't to be made after all.
 */
export async function makeAgenda(o: Owner, plan: AgendaPlan, draft: AgendaDraft): Promise<MadeAgenda | undefined> {
  return tx(o.pool, async (c) => {
    const w = await organizerCarries(o, plan.workspaceId, plan.last, c, 'change');
    if (!w) return undefined;
    if (w.state.items[draft.documentId]) return trashOf(w.state, draft.documentId) ? undefined : { ...w, documentId: draft.documentId };
    await addBeside(w, c, plan.last, plan.title, draft.documentId);
    return { ...w, documentId: draft.documentId };
  });
}
/** The meeting once its agenda is filled in: it names it, and it takes the last one's place among what's brought. */
export const withAgenda = (m: MeetingManifest, plan: AgendaPlan, documentId: string): MeetingManifest => (m.agenda ? m : {
  ...m, agenda: { workspaceId: plan.workspaceId, documentId }, documents: [broughtId(plan.workspaceId, documentId), ...m.documents.filter((d) => d !== broughtId(plan.workspaceId, plan.last))].slice(0, MAX_BROUGHT)
});
/** Fills in an agenda once it's there, through the log like anything else: whoever has it open sees it arrive. */
export async function fillAgenda(made: MadeAgenda, plan: AgendaPlan, callId: string): Promise<void> {
  await writeDocument(made, made.documentId, 'writeAgenda', { title: plan.title, open: plan.open }, { callId });
}
