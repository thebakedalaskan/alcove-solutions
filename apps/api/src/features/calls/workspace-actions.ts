import { MAIN_PLACE, type CallState, type CallWorkspaceSwitch } from '@alcove/api';
import type { Owner } from '../../context';
import { id128 } from '../../crypto';
import { tx, type Db } from '../../db';
import { ConflictError } from '../../errors';
import { profile } from '../account/account';
import * as space from './workspace';
import { MeetingManifest, updateManifest } from '../meetings/service';
import { zoneOf } from '../meetings/repeats';
import { getItem } from '../../vault';
import { Joined, placeOf } from './places';
import { readerInCall, workspaceOwner } from '../workspaces/access';
import { endSeat } from '../workspaces/service';
import { log } from '../../log';
import { seatKey, seatOf, type Viewer } from './participants';
import { load, save, saveSettled, settle } from './state';
import { anyone, stillHosting } from './permissions';
import { afterClosing } from './room-boards';
import { tellRoom } from './notifications';
import { view } from './read-model';

const clog = log.child({ component: 'calls' });

/* ---------- the workspace a call uses: what's done is features/calls/workspace.ts; the call's row is held here ---------- */

/** How many times something done about the call's workspace is asked afresh when the call moved on under it, before it's refused. */
const SPACE_TRIES = 3;

/**
 * Something done about the call's workspace. A live call comes first, so it's in two steps (`space.prepare`): everything that
 * reads a workspace or changes one, with nothing of the call held; then the call's row, held only to check again what that
 * went by, from the call's own state, and to save. When the call moved on in between, it's all asked afresh.
 */
export async function actOnWorkspace(v: Viewer, callId: string, a: space.SpaceAction): Promise<CallState> {
  const o = v.organizer;
  const reader = await readerInCall(v);
  const ctx = { callId, action: a.type };
  const seats = seatKey(o, callId);
  const seatOfJ = (j: Joined) => seatOf(seats, j);
  /** The call as it stands, read with `db`: the pool, or the transaction that holds its row. */
  const read = async (db: Db, held: boolean) => {
    const { row, state } = await load(o, db, callId, held);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
    if (!anyone(a)) stillHosting(v, state, ctx);
    const s = settle(state, row);
    const mine = s.people.find((j) => j.identity === v.pass.identity);
    const meeting = await getItem(o, db, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
    return { row, state, changing: { v, reader, callId, meeting, startedAt: row.started_at, s, place: mine ? placeOf(s, mine) : MAIN_PLACE, now: Date.now(), seatOf: seatOfJ } };
  };
  for (let tries = 1; ; tries++) {
    const apply = await space.prepare((await read(o.pool, false)).changing, a);
    const done = await tx(o.pool, async (c) => {
      const { row, state, changing } = await read(c, true);
      const changed = await apply({ ...changing, c });
      if (changed === 'again') return 'again';
      const { closed } = await saveSettled(o, c, callId, state, changed.s);
      clog.info('call action', { callId, action: a.type, present: changed.s.workspace.present.length, space: changed.s.workspace.space.length, play: changed.s.workspace.play.length, asks: changed.s.workspace.asks.length, tries });
      return { room: row.room_name, ended: changed.ended, switched: changed.switched, meetingId: row.meeting_item_id, closed };
    });
    if (done === 'again') {
      if (tries < SPACE_TRIES) continue;
      throw new ConflictError('This call changed while that was being done. Try again.', { context: { ...ctx, tries } });
    }
    // A grant to someone removed while it was made goes, as their removal took everything else.
    if (done.ended) await endSeat(o, callId, done.ended);
    if (done.switched) await switchedTo(o, callId, done.meetingId, done.switched, 'timeZone' in a ? a.timeZone : undefined);
    return afterClosing({ organizer: o, callId }, done.closed, async () => {
      await tellRoom(o, done.room, callId, { call: true, log: false });
      return view(v, o.pool, callId);
    });
  }
}

/**
 * After the organizer picked or made the call's workspace, with nothing of the call held: the folder the call left in the
 * last one goes (`letGo`), this run's folder is put in the new one, everyone invited is let into one made for the call, later
 * calls in the series follow, and the next call's agenda is looked for. Each step says itself when it doesn't work.
 */
async function switchedTo(o: Owner, callId: string, meetingId: string, s: space.Switched, timeZone: string | undefined): Promise<void> {
  if (s.left) await space.letGo(o, callId, s.left);
  await settledFolder(o, callId, timeZone).catch((e: unknown) => clog.warn('call folder not settled', { callId, err: e }));
  await space.followHome(o, meetingId, { add: s.guests });
  await space.carryForward(o, meetingId, s.from, s.to);
  await agendaFor(o, callId).catch((e: unknown) => clog.warn('next agenda not made', { callId, err: e }));
}

/**
 * Where this run of the call's folder is, in the call's workspace (docs: Calls and recordings › The call's folder): `folder`
 * once it's there; `none` while the call has no workspace (or it was deleted since), as nothing makes one; `shut` for one its
 * organizer can no longer make things in, and `full` for one with no room for it.
 */
export type Settled = { kind: 'folder'; workspaceId: string; folderId: string } | { kind: 'none' } | { kind: 'shut'; workspaceId: string } | { kind: 'full'; workspaceId: string };
/**
 * This run of the call's folder, put in the call's workspace the first time anyone asks, named after the call and the day where
 * `timeZone` is. Under the call's row, so everyone asking at once gets the same: the folder's ID is taken there, and the folder
 * made in that workspace's own transaction with nothing of the call held. A folder made after the organizer picked another
 * workspace meanwhile is let go again.
 */
export async function settledFolder(o: Owner, callId: string, timeZone?: string | undefined): Promise<Settled> {
  const { row, state } = await load(o, o.pool, callId);
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const had = state.workspace.home;
  const chosen = meeting.manifest.workspaceId;
  if (!chosen || !await workspaceOwner(o.pool, chosen)) return { kind: 'none' };
  if (had?.made && had.workspaceId === chosen) return { kind: 'folder', workspaceId: chosen, folderId: had.folderId };
  // Asked with nothing held: a workspace the organizer can no longer make things in can't take the call's folder.
  const organizer = (await profile(o)).email;
  if (!await space.usableHome(o, organizer, chosen)) return { kind: 'shut', workspaceId: chosen };
  const zone = timeZone ?? (meeting.manifest.seriesId ? await zoneOf(o, meeting.manifest.seriesId) : undefined) ?? 'UTC';
  const name = space.homeName(meeting.manifest.title, row.started_at, zone);
  const taken = await tx(o.pool, async (c) => {
    const held = await load(o, c, callId, true);
    if (held.row.state !== 'live') throw new ConflictError('This call has ended.', { context: { callId, what: 'workspace' } });
    const m = await getItem(o, c, 'meeting', held.row.meeting_item_id, MeetingManifest, 'That meeting');
    if (m.manifest.workspaceId !== chosen) return 'again' as const;
    const h = held.state.workspace.home;
    if (h?.workspaceId === chosen) return h;
    const claim = { workspaceId: chosen, folderId: id128(), made: false };
    await save(o, c, callId, { ...held.state, workspace: { ...held.state.workspace, home: claim } });
    return claim;
  });
  // The organizer picked another meanwhile: ask again, from what the meeting says now.
  if (taken === 'again') return settledFolder(o, callId, timeZone);
  if (taken.made) return { kind: 'folder', workspaceId: chosen, folderId: taken.folderId };
  const put = await space.folderIn(o, chosen, space.folderFor(o, organizer, callId, taken.folderId, name, row.started_at));
  if (put === 'gone') return { kind: 'none' };
  if (put === 'full') return { kind: 'full', workspaceId: chosen };
  const kept = await tx(o.pool, async (c) => {
    const held = await load(o, c, callId, true);
    const h = held.state.workspace.home;
    if (held.row.state !== 'live' || h?.folderId !== taken.folderId || h.workspaceId !== chosen) return false;
    await save(o, c, callId, { ...held.state, workspace: { ...held.state.workspace, home: { ...h, folderId: put.folderId, made: true } } });
    return true;
  });
  // Made just as the organizer picked another: it goes again.
  if (!kept) {
    await space.letGo(o, callId, { workspaceId: chosen, folderId: put.folderId, made: true });
    return settledFolder(o, callId, timeZone);
  }
  clog.info('call folder settled', { callId, workspaceId: chosen });
  // One made for the call's series lets in whoever this call invites: it was made in an earlier call, which didn't invite them.
  await space.followHome(o, row.meeting_item_id, { add: meeting.manifest.guests });
  return { kind: 'folder', workspaceId: chosen, folderId: put.folderId };
}

/**
 * Looks, in each run of a call, for an agenda to make, until there is one or there's none to make. What it says is worked out
 * with nothing held. Whoever opens Workspace first takes it on, under the call's row, so there's one however many open it at
 * once; it's made in the workspace's own transaction and filled in with nothing of the call held, and only once it's filled in
 * does the call say it's done, the meeting name it, and it take the last one's place. A try that fails lets go, keeping the
 * document it was making, so the next person opening Workspace fills that one in.
 */
async function agendaFor(o: Owner, callId: string): Promise<void> {
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live' || state.workspace.agendaLooked || space.makingAgenda(state.workspace, Date.now())) return;
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  // A call with no workspace has nowhere to make one: it's looked for once the organizer picks one.
  if (!meeting.manifest.workspaceId) return;
  const plan = await space.planAgenda(o, meeting);
  const draft = await tx(o.pool, async (c) => {
    const held = await load(o, c, callId, true);
    if (held.row.state !== 'live' || held.state.workspace.agendaLooked || space.makingAgenda(held.state.workspace, Date.now())) return undefined;
    const claimed = space.claimAgenda(held.state.workspace, plan, Date.now());
    await save(o, c, callId, { ...held.state, workspace: claimed.space });
    return claimed.draft;
  });
  if (!draft || !plan) return;
  try {
    const made = await space.makeAgenda(o, plan, draft);
    if (made) await space.fillAgenda(made, plan, callId);
    await tx(o.pool, async (c) => {
      const held = await load(o, c, callId, true);
      if (held.row.state === 'live') await save(o, c, callId, { ...held.state, workspace: { ...held.state.workspace, agendaLooked: true, agendaDraft: null } });
      if (made) await updateManifest(o, c, meeting.itemId, (m) => space.withAgenda(m, plan, made.documentId));
    });
    if (!made) return;
    clog.info('next agenda made', { callId, workspaceId: plan.workspaceId, documentId: made.documentId, carried: plan.open.length });
    await tellRoom(o, row.room_name, callId, { call: true, log: false });
  } catch (e) {
    await tx(o.pool, async (c) => {
      const held = await load(o, c, callId, true);
      const w = held.state.workspace;
      if (held.row.state === 'live' && w.agendaDraft?.documentId === draft.documentId) await save(o, c, callId, { ...held.state, workspace: { ...w, agendaDraft: { ...w.agendaDraft, until: 0 } } });
    }).catch((err: unknown) => clog.warn('next agenda not let go of', { callId, err }));
    throw e;
  }
}

/**
 * Someone opens Workspace: the call's folder goes in the call's workspace, if it has one (a call with none makes none: the
 * organizer picks or makes it), and the next call's agenda is looked for there. A folder that can't be put there is no reason
 * anyone can't open the rest, nor is an agenda that can't be made.
 */
export async function openWorkspace(v: Viewer, callId: string, timeZone: string | undefined): Promise<CallState> {
  const o = v.organizer;
  const settled = await settledFolder(o, callId, timeZone);
  if (settled.kind !== 'folder') clog.info('call folder not settled', { callId, why: settled.kind });
  else await agendaFor(o, callId).catch((e: unknown) => clog.warn('next agenda not made', { callId, err: e }));
  return view(v, o.pool, callId);
}

/** What viewing another workspace in the call would mean, for the organizer to decide. */
export async function previewWorkspace(v: Viewer, callId: string, workspaceId: string): Promise<CallWorkspaceSwitch> {
  return space.preview(v, await readerInCall(v), (await load(v.organizer, v.organizer.pool, callId)).state.people, workspaceId);
}
