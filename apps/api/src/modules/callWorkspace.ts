/*
 * The workspace a call uses (docs: Calls and recordings › The call's workspace). Which one it is lives on the meeting, so it
 * carries to the next call in a series; what's going on in it lives in the call's sealed state (modules/callSpace.ts).
 *
 * Nothing here decides who can open what: modules/workspaceAccess.ts does, on every read, for each person. Being in a call or
 * organizing it opens nothing, and access is never copied into the call, so someone who loses a document stops being told
 * about it at once, and what they were presenting or playing stops. What's in a workspace is read with the server's keys
 * here only to work out what each person may be told, and someone who can open nothing is told nothing that names it.
 *
 * `calls.ts` holds the call's row and says when to do what; this is what's done.
 */
import { firstName, type CallAction, type CallBrought, type CallFollowUp, type CallFollowUps, type CallPlay, type CallPresent, type CallWorkspace, type CallWorkspaceAsk, type CallWorkspaceSwitch, type DocFollowUp, type DocFollowUpTick, type LiveNotes, type Person } from '@alcove/api';
import type { Deps, Owner } from '../context';
import { id128 } from '../crypto';
import { tx, type Db } from '../db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, notFound } from '../errors';
import type { Hub } from '../live/hub';
import { log } from '../log';
import { findItem, getItem, type Loaded } from '../vault';
import { profile, updateProfile } from './account';
import { seatOfViewer, type Viewer } from './calls';
import { stopped, type CallSpace, type Controller, type Playing, type Presenting, type WorkedBy, type WorkedDocument } from './callSpace';
import { isFollowUp, type Run } from './documentText';
import { MeetingManifest, all as allMeetings, updateManifest } from './meetings';
import { placeOf, placesOf, type Joined, type Placing } from './places';
import { zoneOf } from './repeats';
import { canOpen, emailIndex, grant, holdersOf, readerInCall, requireDocument, requireRole, requireSharing, roleOf, serverWorkspace, standingIn, trashOf, whoInCall, workspaceFor, workspaceOwner, type HeldWorkspace, type Reader, type Who } from './workspaceAccess';
import { editorOf, keepVersion, kindOf, readDocument, writeDocument } from './workspaceDocuments';
import { addBeside, createIn } from './workspaces';

const wlog = log.child({ component: 'call-workspace' });

/** What the rules here read of a call. */
export interface Spaced extends Placing { workspace: CallSpace; removed: string[] }

/* ---------- what's brought to a call ---------- */

/**
 * What a call keeps for a document brought to it, on the meeting: the workspace's handle and the item, with a dot between,
 * as modules/documents.ts names them. An item's own ID doesn't say which workspace it's in.
 */
const broughtId = (workspaceId: string, documentId: string): string => `${workspaceId}.${documentId}`;
const BROUGHT = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{22})$/;
const placeOfBrought = (id: string): { workspaceId: string; documentId: string } | undefined => {
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
/** What's over for good: its part of the call closed, whoever started it was removed, or they've gone to another part of the call. */
function over(s: Spaced, x: { place: string; by: Controller }): boolean {
  const j = here(s, x.by.person);
  return !placesOf(s).includes(x.place) || s.removed.includes(x.by.person) || (j !== undefined && placeOf(s, j) !== x.place);
}
/**
 * Someone chose to leave on this connection: what they started stops for good, so it doesn't come back if they do. A reload
 * isn't this, and nor is one device of two: they're still here.
 */
export function leftForGood<S extends Spaced>(s: S, person: string, identity: string): S {
  if (s.people.some((j) => j.person === person && j.status === 'in' && j.identity !== identity)) return s;
  const w = s.workspace;
  const others = (x: { by: Controller }) => x.by.person !== person;
  return w.present.every(others) && w.play.every(others) ? s : { ...s, workspace: { ...w, present: w.present.filter(others), play: w.play.filter(others) } };
}
/** The call as it stands, with what's over gone from what it keeps. */
export function tidied<S extends Spaced>(s: S): S {
  const w = s.workspace;
  return { ...s, workspace: { ...w, present: w.present.filter((x) => !over(s, x)), play: w.play.filter((x) => !over(s, x)), asks: w.asks.filter((a) => !s.removed.includes(a.person)) } };
}
/** Who started something, by the name they came into the call with, which is how everyone there knows them. */
const controllerOf = (v: Viewer, reader: Reader): Controller => ({ person: v.pass.person, seat: seatOfViewer(v), name: v.pass.name, email: reader.email ?? null });
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

const presentAs = (v: Viewer, p: Presenting, name: string, opens: boolean): CallPresent => {
  const mine = p.by.person === v.pass.person;
  const seen = { by: asSeat(p.by), mine, canControl: mine || v.isOrganizer };
  return opens ? { kind: p.kind, id: p.id, name, section: p.section, ...seen } : { kind: null, id: null, name: null, section: null, ...seen };
};
const playAs = (v: Viewer, p: Playing): CallPlay => {
  const mine = p.by.person === v.pass.person;
  return { mediaId: p.mediaId, documentId: p.documentId, by: asSeat(p.by), playing: p.playing, positionMs: p.positionMs, atMs: p.atMs, nowMs: Date.now(), mine, canControl: mine || v.isOrganizer };
};

/**
 * What whoever started it has lost the document of, found while reading the call. Losing a document says nothing to the call,
 * so this is where it's noticed: it stops for good (`withoutLost`), and doesn't come back if they're given it again.
 */
export interface Lost { present: Presenting[]; play: Playing[] }
const sameStart = (a: { place: string; by: Controller }, b: { place: string; by: Controller }) => a.place === b.place && a.by.person === b.by.person;
export const withoutLost = (w: CallSpace, lost: Lost): CallSpace => ({
  ...w, present: w.present.filter((p) => !lost.present.some((x) => sameStart(x, p) && x.id === p.id)), play: w.play.filter((p) => !lost.play.some((x) => sameStart(x, p) && x.mediaId === p.mediaId))
});

/**
 * The call's workspace as this person may know it, and what's been lost. One that can't be read says it's private: a call
 * doesn't depend on what's in a workspace, so nothing here can stop anyone reading the call.
 */
export async function shownTo(x: Seeing): Promise<{ shown: CallWorkspace; lost: Lost }> {
  const { v, s, place, meeting } = x;
  const shut: CallWorkspace = {
    id: null, name: null, chosenBy: x.chosenBy, canOpen: false, role: null, documents: [], agenda: null, present: null, play: null, asks: x.asks,
    asked: s.workspace.asks.find((a) => a.person === v.pass.person)?.state === 'asking' ? 'asking' : s.workspace.asks.some((a) => a.person === v.pass.person) ? 'declined' : 'no'
  };
  const brought = meeting.documents.flatMap((id) => { const at = placeOfBrought(id); return at ? [at] : []; });
  const inUse = meeting.workspaceId;
  const workspaces = new Set([...(inUse ? [inUse] : []), ...brought.map((b) => b.workspaceId)]);
  const lost: Lost = { present: [], play: [] };
  if (!workspaces.size) return { shown: shut, lost };
  const d = v.organizer;
  try {
    const reader = await readerInCall(v);
    const out = { ...shut };
    const documents = new Map<string, CallBrought>();
    for (const workspaceId of workspaces) {
      const ownerId = await workspaceOwner(d.pool, workspaceId);
      if (!ownerId) continue;
      const inCall = workspaceId === inUse;
      const present = inCall ? s.workspace.present.find((p) => p.place === place && p.workspaceId === workspaceId && showing(s, p)) : undefined;
      const play = inCall ? s.workspace.play.find((p) => p.place === place && p.workspaceId === workspaceId && showing(s, p)) : undefined;
      const others = [present, play].flatMap((p) => (p ? [whoStarted(d, x.callId, p.by)] : []));
      const holders = await holdersOf(d.pool, ownerId, [...reader.principals, ...others.flatMap((o) => o.principals)]);
      const standing = standingIn(holders, reader);
      // Its keys are opened only for someone with something in it, or to see whether what's going on there still stands.
      if (!canOpen(standing) && !present && !play) continue;
      const w = await serverWorkspace(d, workspaceId);
      if (!w) continue;
      for (const b of brought.filter((y) => y.workspaceId === workspaceId)) {
        const item = w.state.items[b.documentId];
        const role = item && !trashOf(w.state, b.documentId) ? roleOf(reader, standing, b.documentId, item) : undefined;
        if (item && role) documents.set(broughtId(workspaceId, b.documentId), { workspaceId, id: b.documentId, kind: item.kind, name: item.name, role });
      }
      if (!inCall) continue;
      if (canOpen(standing)) {
        out.id = workspaceId;
        out.name = standing.role === null ? null : w.state.name;
        out.canOpen = true;
        out.role = standing.role;
      }
      /** What `who` can do with something that's still in the tree. */
      const roleIn = (who: Who, id: string) => { const item = w.state.items[id]; return item && !trashOf(w.state, id) ? roleOf(who, standingIn(holders, who), id, item) : undefined; };
      if (present) {
        if (!roleIn(whoStarted(d, x.callId, present.by), present.id)) lost.present.push(present);
        else out.present = presentAs(v, present, w.state.items[present.id]?.name ?? '', roleIn(reader, present.id) !== undefined);
      }
      if (play) {
        if (!roleIn(whoStarted(d, x.callId, play.by), play.documentId)) lost.play.push(play);
        else if (roleIn(reader, play.documentId)) out.play = playAs(v, play);
      }
    }
    const inOrder = meeting.documents.flatMap((id) => documents.get(id) ?? []);
    const agenda = meeting.agenda ? documents.get(broughtId(meeting.agenda.workspaceId, meeting.agenda.documentId)) : undefined;
    return { shown: { ...out, documents: inOrder, agenda: agenda?.id ?? null }, lost };
  } catch (e) {
    wlog.warn('workspace not read for someone in a call', { callId: x.callId, err: e });
    return { shown: shut, lost: { present: [], play: [] } };
  }
}

/* ---------- choosing a workspace ---------- */

/** Who an account is to a workspace, without a call. */
const accountWho = (o: Owner, email: string): Who => ({ email, principals: [emailIndex(o, email)] });

/** The workspace a call settles on when nobody has chosen: its organizer's most recently used, if they can still edit in it, else a new one in their name. */
export async function chooseFor(o: Owner, c: Db): Promise<string> {
  const me = await profile(o, c);
  if (me.recentWorkspace) {
    try {
      const w = await workspaceFor(o, accountWho(o, me.email), me.recentWorkspace, c);
      if (w.role === 'admin' || w.role === 'edit') return me.recentWorkspace;
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }
  }
  return (await createIn(o, c, `${firstName(me.name)}’s workspace`)).id;
}
/** Remembers the workspace someone used last, when that's changed. */
export async function noteUsed(o: Owner, workspaceId: string): Promise<void> {
  try {
    if ((await profile(o)).recentWorkspace !== workspaceId) await updateProfile(o, (p) => ({ ...p, recentWorkspace: workspaceId }));
  } catch (e) {
    wlog.warn('most recently used workspace not kept', { workspaceId, err: e });
  }
}

/** How often opening a workspace in the app says so, for each person and workspace: tabs come and go, and every change to a profile is a revision. */
const OPENED_EVERY_MS = 10 * 60_000;
const MAX_OPENED = 4096;
const openedByHub = new WeakMap<Hub, Map<string, number>>();
/** Someone who can work in a workspace opened it: their next call starts there unless they say otherwise. */
export async function noteOpened(o: Owner, workspaceId: string): Promise<void> {
  const opened = openedByHub.get(o.hub) ?? new Map<string, number>();
  openedByHub.set(o.hub, opened);
  const key = `${o.ownerId}:${workspaceId}`;
  if (Date.now() - (opened.get(key) ?? 0) < OPENED_EVERY_MS) return;
  opened.delete(key);
  opened.set(key, Date.now());
  for (const oldest of opened.keys()) {
    if (opened.size <= MAX_OPENED) break;
    opened.delete(oldest);
  }
  await noteUsed(o, workspaceId);
}

/** What changing the call's workspace would mean: refused as changing it is. It goes only by who's in the workspace, which the organizer can see: what's been given to anyone beyond that isn't theirs to know. */
export async function preview(v: Viewer, reader: Reader, people: Joined[], workspaceId: string): Promise<CallWorkspaceSwitch> {
  const o = v.organizer;
  const w = await workspaceFor(o, reader, workspaceId);
  requireRole(w, 'edit');
  const inCall = people.filter((j) => j.status === 'in' && j.role !== 'host');
  const who = inCall.map((j) => ({ j, who: j.email ? accountWho(o, j.email) : { email: undefined, principals: [] } }));
  const holders = await holdersOf(o.pool, w.owner.ownerId, who.flatMap((x) => x.who.principals));
  return { name: w.state.name, cantOpen: who.filter((x) => standingIn({ ...holders, shares: [] }, x.who).role === null).map((x) => firstName(x.j.name)) };
}

/** Later calls in a series that were using `from` follow it to `to`: they're the same meetings, so it can only be said here. */
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

/** A video to play has to be in its document, in the call's workspace, for someone who can open it. Reads the document, so it's asked with nothing held. */
export async function mayPlay(o: Owner, reader: Reader, workspaceId: string | null, documentId: string, mediaId: string): Promise<void> {
  const shut = notFound('That document', { documentId });
  if (!workspaceId) throw shut;
  const w = await workspaceFor(o, reader, workspaceId);
  const { item } = requireDocument(reader, w, documentId, 'read');
  if (!await readDocument(w, documentId, 'holdsVideo', { kind: kindOf(item), media: mediaId })) throw shut;
}

/** What's needed to change what a call keeps, in its transaction, which holds its row. */
export interface Changing<S extends Spaced> {
  v: Viewer; reader: Reader; c: Db; callId: string;
  meeting: Loaded<MeetingManifest>;
  s: S;
  /** Where whoever's asking is in the call. */
  place: string;
  now: number;
  seatOf: (j: Joined) => string;
}
/** What came of it: the call as it is now, and the workspace it left and moved to, if it moved. */
export interface Changed<S> { s: S; moved?: { from: string | null; to: string } | undefined }

const withSpace = <S extends Spaced>(s: S, workspace: CallSpace): S => ({ ...s, workspace });
const noDocument = (documentId: string) => notFound('That document', { documentId });
const notYours = (callId: string, what: string) => new ForbiddenError('Only whoever started this, or the organizer, can do that.', { context: { callId, what } });
/** Whether someone can open a document in a workspace. */
async function opens(d: Deps, reader: Who, workspaceId: string, documentId: string, db: Db): Promise<boolean> {
  try {
    requireDocument(reader, await workspaceFor(d, reader, workspaceId, db), documentId, 'read');
    return true;
  } catch (e) {
    if (e instanceof NotFoundError) return false;
    throw e;
  }
}

async function moveTo<S extends Spaced>(x: Changing<S>, workspaceId: string): Promise<Changed<S>> {
  const from = x.meeting.manifest.workspaceId;
  if (from === workspaceId) return { s: x.s };
  await updateManifest(x.v.organizer, x.c, x.meeting.itemId, (m) => ({ ...m, workspaceId }));
  wlog.info('call moved to a workspace', { callId: x.callId, workspaceId });
  return { s: withSpace(x.s, stopped(x.s.workspace)), moved: { from, to: workspaceId } };
}

/** Whatever someone does about the call's workspace. Who may is checked here, under the call's row, and again by access. */
export async function change<S extends Spaced>(x: Changing<S>, a: SpaceAction): Promise<Changed<S>> {
  const { v, reader, c, s, callId, place, now } = x;
  const o = v.organizer;
  const w = s.workspace;
  const inUse = x.meeting.manifest.workspaceId;
  const control = (p: { by: Controller }) => p.by.person === v.pass.person || v.isOrganizer;
  switch (a.type) {
    case 'workspace-set': {
      const target = await workspaceFor(o, reader, a.workspaceId, c, 'hold');
      requireRole(target, 'edit');
      return moveTo(x, a.workspaceId);
    }
    case 'workspace-new': return moveTo(x, (await createIn(o, c, a.name ?? (x.meeting.manifest.title.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled'))).id);
    case 'workspace-bring': {
      // What's brought comes from the workspace in use; what's taken off can have been brought from one the call used before.
      const from = a.brought ? inUse : x.meeting.manifest.documents.flatMap((id) => { const at = placeOfBrought(id); return at?.documentId === a.documentId ? [at.workspaceId] : []; })[0] ?? inUse;
      if (!from) throw noDocument(a.documentId);
      requireDocument(reader, await workspaceFor(o, reader, from, c), a.documentId, 'read');
      const id = broughtId(from, a.documentId);
      await updateManifest(o, c, x.meeting.itemId, (m) => {
        if (a.brought === m.documents.includes(id)) return m;
        if (!a.brought) return { ...m, documents: m.documents.filter((d) => d !== id) };
        if (m.documents.length >= MAX_BROUGHT) throw new ConflictError('This call has as many documents as it can bring. Take one off first.', { context: { callId, documents: m.documents.length } });
        return { ...m, documents: [...m.documents, id] };
      });
      return { s };
    }
    case 'workspace-ask': {
      if (v.isOrganizer) throw new ValidationError('You choose the workspace for this call.', { context: { callId } });
      const others = w.asks.filter((q) => q.person !== v.pass.person);
      if (!a.up) return { s: withSpace(s, { ...w, asks: others }) };
      if (w.asks.some((q) => q.person === v.pass.person && q.state === 'asking')) return { s };
      return { s: withSpace(s, { ...w, asks: [...others, { id: id128(), person: v.pass.person, at: now, state: 'asking' }] }) };
    }
    case 'workspace-grant': {
      const ask = w.asks.find((q) => q.id === a.askId && q.state === 'asking');
      const j = ask && here(s, ask.person);
      if (!ask || !j) throw new ValidationError('That ask isn’t open.', { context: { callId } });
      if (!inUse) throw noDocument(a.documentId);
      const held = await workspaceFor(o, reader, inUse, c, 'change');
      requireSharing(reader, held, a.documentId);
      await grant(held, c, a.documentId, [{ kind: 'seat', callId, seat: x.seatOf(j), name: j.name, role: a.role }]);
      wlog.info('document opened to someone in a call', { callId, workspaceId: inUse, documentId: a.documentId, role: a.role });
      return { s: withSpace(s, { ...w, asks: w.asks.filter((q) => q.id !== ask.id) }) };
    }
    case 'workspace-decline': {
      if (!w.asks.some((q) => q.id === a.askId && q.state === 'asking')) throw new ValidationError('That ask isn’t open.', { context: { callId } });
      return { s: withSpace(s, { ...w, asks: w.asks.map((q) => (q.id === a.askId ? { ...q, state: 'declined' as const } : q)) }) };
    }
    case 'present-start': {
      if (!inUse) throw noDocument(a.id);
      const held = await workspaceFor(o, reader, inUse, c);
      const { item } = requireDocument(reader, held, a.id, 'read');
      if (item.kind !== a.kind) throw noDocument(a.id);
      if (trashOf(held.state, a.id)) throw new ConflictError('This is in Trash. Restore it to present it.', { context: { callId, documentId: a.id } });
      const there = w.present.find((p) => p.place === place);
      if (there && showing(s, there) && there.by.person !== v.pass.person && await opens(o, whoStarted(o, callId, there.by), there.workspaceId, there.id, c)) throw new ConflictError('Someone else is presenting here.', { context: { callId } });
      const next: Presenting = { place, workspaceId: inUse, kind: a.kind, id: a.id, section: a.section, by: controllerOf(v, reader) };
      return { s: withSpace(s, { ...w, present: [...w.present.filter((p) => p.place !== place), next] }) };
    }
    case 'present-move':
    case 'present-stop': {
      const p = w.present.find((q) => q.place === place && showing(s, q));
      if (!p) throw new ConflictError('Nothing is being presented here.', { context: { callId, what: a.type } });
      if (!control(p)) throw notYours(callId, a.type);
      const rest = w.present.filter((q) => q !== p);
      return { s: withSpace(s, { ...w, present: a.type === 'present-stop' ? rest : [...rest, { ...p, section: a.section }] }) };
    }
    case 'play-start': {
      if (!inUse) throw noDocument(a.documentId);
      const there = w.play.find((p) => p.place === place);
      if (there && showing(s, there) && there.by.person !== v.pass.person && await opens(o, whoStarted(o, callId, there.by), there.workspaceId, there.documentId, c)) throw new ConflictError('Someone else is playing something here.', { context: { callId } });
      const next: Playing = { place, workspaceId: inUse, documentId: a.documentId, mediaId: a.mediaId, by: controllerOf(v, reader), playing: true, positionMs: a.positionMs, atMs: now };
      return { s: withSpace(s, { ...w, play: [...w.play.filter((p) => p.place !== place), next] }) };
    }
    case 'play-pause':
    case 'play-resume':
    case 'play-seek':
    case 'play-stop': {
      const p = w.play.find((q) => q.place === place && showing(s, q));
      // What someone can't open is never said to be playing, so it reads the same as nothing playing.
      if (!p || !(await opens(o, reader, p.workspaceId, p.documentId, c))) throw new ConflictError('Nothing is playing here.', { context: { callId, what: a.type } });
      if (!control(p)) throw notYours(callId, a.type);
      const rest = w.play.filter((q) => q !== p);
      if (a.type === 'play-stop') return { s: withSpace(s, { ...w, play: rest }) };
      const at = a.type === 'play-pause' ? { playing: false, positionMs: a.positionMs } : a.type === 'play-seek' ? { positionMs: a.positionMs } : { playing: true };
      return { s: withSpace(s, { ...w, play: [...rest, { ...p, ...at, atMs: now }] }) };
    }
  }
}

/** What's kept of something worked on in a call, once it's known what it is. Nothing, if it's gone. */
export async function workedEntry(d: Deps, at: Pick<WorkedDocument, 'workspaceId' | 'documentId'>): Promise<Omit<WorkedDocument, 'by'> | undefined> {
  const item = (await serverWorkspace(d, at.workspaceId))?.state.items[at.documentId];
  return item ? { workspaceId: at.workspaceId, documentId: at.documentId, kind: kindOf(item) } : undefined;
}

/* ---------- the call's follow-ups ---------- */

const byWorkspace = (worked: WorkedDocument[]): Map<string, WorkedDocument[]> => {
  const out = new Map<string, WorkedDocument[]>();
  for (const x of worked) out.set(x.workspaceId, [...(out.get(x.workspaceId) ?? []), x]);
  return out;
};
/** A workspace as this reader has it, or nothing when they have nothing in it. */
async function maybeWorkspace(d: Deps, reader: Who, workspaceId: string) {
  try {
    return await workspaceFor(d, reader, workspaceId);
  } catch (e) {
    if (e instanceof NotFoundError) return undefined;
    throw e;
  }
}

/** To-dos with a person and a date in the documents worked on in this call, for someone who can open each. One that won't open is left out, and the rest still come. */
async function fromDocuments(d: Deps, reader: Reader, worked: WorkedDocument[]): Promise<DocFollowUp[]> {
  const out: DocFollowUp[] = [];
  for (const [workspaceId, documents] of byWorkspace(worked)) {
    const w = await maybeWorkspace(d, reader, workspaceId);
    if (!w) continue;
    for (const { documentId } of documents) {
      const item = w.state.items[documentId];
      const role = item && !trashOf(w.state, documentId) ? roleOf(reader, w, documentId, item) : undefined;
      if (!item || !role) continue;
      try {
        const todos = await readDocument(w, documentId, 'todos', { kind: kindOf(item) });
        for (const t of todos.filter(isFollowUp)) out.push({ from: 'document', workspaceId, documentId, document: item.name, block: t.block, text: t.text, mentions: t.mentions, dates: t.dates, done: t.done, canTick: role === 'edit' });
      } catch (e) {
        wlog.warn('document not read for the call’s follow-ups', { workspaceId, documentId, err: e });
      }
    }
  }
  return out;
}
/** The call's follow-ups: the live notes' as this person reads them, then the documents'. */
export async function followUps(d: Deps, reader: Reader, notes: LiveNotes, status: CallFollowUps['notes'], worked: WorkedDocument[]): Promise<CallFollowUps> {
  const said: CallFollowUp[] = (notes.notes?.next ?? []).map((f) => ({ ...f, from: 'notes' }));
  return { items: [...said, ...await fromDocuments(d, reader, worked)], notes: status };
}
/**
 * A follow-up ticked from the call, or the tick taken back: the to-do's own `done`, as the editor sets it, so a tick here and
 * a tick in the document are the same. Only in a document worked on in this call. Whoever can't open it, or has lost it by
 * the time it's written, finds nothing there.
 */
export async function tick(d: Deps, reader: Reader, callId: string, worked: WorkedDocument[], t: DocFollowUpTick): Promise<{ entry: Omit<WorkedDocument, 'by'>; by: WorkedBy }> {
  const shut = () => notFound('That follow-up', { callId });
  const found = worked.find((x) => x.workspaceId === t.workspaceId && x.documentId === t.documentId);
  if (!found) throw shut();
  const w = await workspaceFor(d, reader, t.workspaceId);
  const { item } = requireDocument(reader, w, t.documentId, 'edit');
  const by = editorOf(w.owner, reader);
  const { result: ticked } = await writeDocument(w, t.documentId, 'tickFollowUp', { kind: kindOf(item), block: t.block, done: t.done }, {
    by, callId, holding: async (c) => { requireDocument(reader, await workspaceFor(d, reader, t.workspaceId, c, 'hold'), t.documentId, 'edit'); }
  });
  if (!ticked) throw shut();
  return { entry: found, by };
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
    if (await readDocument(w, x.documentId, 'readsAsAgenda', { kind: kindOf(item) })) return x;
  }
  return undefined;
}
/**
 * Once a call has ended and everyone's gone, with nothing held and nobody waiting: for a call in a series, which document was
 * its agenda, so the next one can carry on from it, and then a version with reason `call` of everything worked on. It never
 * throws: whatever doesn't work is logged, and costs only what it was keeping.
 */
export async function afterCall(o: Owner, callId: string, meetingId: string, worked: WorkedDocument[]): Promise<void> {
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
 * The agenda to make for a call in a series, if one's due: it has none, the call before it had one, and that's in the
 * workspace this call uses and still in its tree. An agenda stays in its workspace: nothing in one is copied to another.
 */
export async function planAgenda(o: Owner, meeting: Loaded<MeetingManifest>): Promise<AgendaPlan | undefined> {
  const { seriesId, startsAt, agenda, workspaceId } = meeting.manifest;
  if (!seriesId || agenda || !workspaceId) return undefined;
  const earlier = (await allMeetings(o)).filter((m) => m.manifest.seriesId === seriesId && m.itemId !== meeting.itemId && m.manifest.agenda && m.manifest.startsAt < startsAt).sort((a, b) => b.manifest.startsAt.localeCompare(a.manifest.startsAt));
  const last = earlier[0]?.manifest.agenda;
  if (!last || last.workspaceId !== workspaceId) return undefined;
  const w = await serverWorkspace(o, workspaceId);
  const item = w?.state.items[last.documentId];
  if (!w || !item || trashOf(w.state, last.documentId)) return undefined;
  const open = await readDocument(w, last.documentId, 'openTodos', { kind: kindOf(item) });
  return { workspaceId, last: last.documentId, title: `Agenda · ${dayOf(startsAt, await zoneOf(o, seriesId) ?? 'UTC')}`, open };
}
/**
 * Makes it, in the caller's transaction, which holds the call's row, so however many people open Workspace at once there's
 * one. Undefined when it isn't to be made after all. It's filled in once this commits (`fillAgenda`).
 */
export async function claimAgenda(o: Owner, c: Db, meetingId: string, plan: AgendaPlan): Promise<HeldWorkspace & { documentId: string } | undefined> {
  const m = await getItem(o, c, 'meeting', meetingId, MeetingManifest, 'That meeting');
  if (m.manifest.agenda) return undefined;
  const w = await serverWorkspace(o, plan.workspaceId, c, 'change');
  if (!w || !w.state.items[plan.last] || trashOf(w.state, plan.last)) return undefined;
  const documentId = await addBeside(w, c, plan.last, plan.title);
  const brought = broughtId(plan.workspaceId, documentId);
  await updateManifest(o, c, meetingId, (x) => ({
    ...x, agenda: { workspaceId: plan.workspaceId, documentId }, documents: [brought, ...x.documents.filter((d) => d !== broughtId(plan.workspaceId, plan.last))].slice(0, MAX_BROUGHT)
  }));
  return { ...w, documentId };
}
/** Fills in an agenda once it's there, through the log like anything else: whoever has it open sees it arrive. */
export async function fillAgenda(made: HeldWorkspace & { documentId: string }, plan: AgendaPlan, callId: string): Promise<void> {
  await writeDocument(made, made.documentId, 'writeAgenda', { title: plan.title, open: plan.open }, { callId });
}
