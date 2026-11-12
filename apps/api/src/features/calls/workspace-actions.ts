import { MAIN_PLACE, type CallState, type CallWorkspaceSwitch } from '@alcove/api';
import type { Owner } from '../../context';
import { id128 } from '../../crypto';
import { tx, type Db } from '../../db';
import { ConflictError, notFound } from '../../errors';
import { profile } from '../account/account';
import * as space from './workspace';
import { MeetingManifest, updateManifest } from '../meetings/service';
import { zoneOf } from '../meetings/repeats';
import { getItem } from '../../vault';
import { Joined, placeOf } from './places';
import { callMovedOn, openForCall, readerInCall, workspaceOwner } from '../workspaces/access';
import { makeHome } from '../workspaces/service';
import { log } from '../../log';
import { seatKey, seatOf, workspaceIn, type Viewer } from './participants';
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
      clog.info('call action', { callId, action: a.type, present: changed.s.workspace.present.length, space: changed.s.workspace.space.length, play: changed.s.workspace.play.length, tries });
      return { room: row.room_name, made: changed.made, meetingId: row.meeting_item_id, closed, was: workspaceIn(state), now: workspaceIn(changed.s) };
    });
    if (done === 'again') {
      if (tries < SPACE_TRIES) continue;
      throw new ConflictError('This call changed while that was being done. Try again.', { context: { ...ctx, tries } });
    }
    // The workspace the call used closes at once to whoever had it only through the call: their streams there look again.
    if (done.was !== null && done.was !== done.now) await callMovedOn(o, callId, done.was);
    if (done.made) await space.followHome(o, done.meetingId, { add: done.made.guests }, [done.made.workspaceId]);
    return afterClosing({ organizer: o, callId }, done.closed, async () => {
      await tellRoom(o, done.room, callId, { call: true, log: false });
      // Told as the call is now: what they carry names the workspace it uses after this.
      return view({ ...v, workspace: done.now }, o.pool, callId);
    });
  }
}

/**
 * The call's home, and this run of the call's folder in it, settled the first time anyone asks (docs: Calls and recordings ›
 * The call's home): the meeting's, a workspace its organizer chose or its series has, while they can still make things in it
 * and it has room for the folder; else a new one made for the call, named after it and the day where `timeZone` is. Under the
 * call's row, so everyone asking at once gets the same: a new home is made there, since nobody else can reach it yet, and
 * for a home that's there already the folder's ID is taken there, and the folder made in that workspace's own transaction
 * with nothing of the call held. Everyone invited is let into a home made for the call once the call's row is let go. A home
 * deleted since is settled again, and one with no room for the folder (`full`) gives way to a new one. Whose it is, and what's
 * in it, the meeting's organizer decides: whoever asks first only settles it. Settled, it's open to everyone in the call
 * (`openForCall`), however it came to be asked for, and the call is told when that's just happened.
 */
export async function settledHome(o: Owner, callId: string, timeZone?: string | undefined, full: string | null = null): Promise<{ workspaceId: string; folderId: string }> {
  const { row, state } = await load(o, o.pool, callId);
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const had = state.workspace.home;
  const chosen = meeting.manifest.workspaceId;
  /** The home, open to everyone in the call: settled under the release before, or opened by nothing yet, it's opened now. */
  const opened = async (home: { workspaceId: string; folderId: string }) => {
    if (await openForCall({ organizer: o, callId }, home.workspaceId)) await tellRoom(o, row.room_name, callId, { call: true, log: false });
    return { workspaceId: home.workspaceId, folderId: home.folderId };
  };
  if (had?.made && had.workspaceId === chosen && await workspaceOwner(o.pool, chosen)) return opened(had);
  const organizer = (await profile(o)).email;
  // Asked with nothing held: a home the organizer can no longer make things in is no home of theirs, nor one with no room.
  const usable = chosen !== full && (await space.usableHome(o, organizer, chosen)) !== undefined;
  const zone = timeZone ?? (meeting.manifest.seriesId ? await zoneOf(o, meeting.manifest.seriesId) : undefined) ?? 'UTC';
  const name = space.homeName(meeting.manifest.title, row.started_at, zone);
  const taken = await tx(o.pool, async (c) => {
    const held = await load(o, c, callId, true);
    if (held.row.state !== 'live') throw new ConflictError('This call has ended.', { context: { callId, what: 'workspace' } });
    const m = await getItem(o, c, 'meeting', held.row.meeting_item_id, MeetingManifest, 'That meeting');
    const now = m.manifest.workspaceId;
    const h = held.state.workspace.home;
    if (now !== chosen) return { again: true } as const;
    // Who's invited, as it stands under the call's row: whoever an invite change adds after this finds the home named.
    const guests = m.manifest.guests;
    if (now !== null && usable) {
      if (h?.workspaceId === now) return { again: false, home: h, made: false, was: now, guests } as const;
      const claim = { workspaceId: now, folderId: id128(), made: false };
      await save(o, c, callId, { ...held.state, workspace: { ...held.state.workspace, home: claim } });
      return { again: false, home: claim, made: false, was: now, guests } as const;
    }
    const folder = space.folderFor(o, organizer, callId, id128(), name, held.row.started_at);
    const { id } = await makeHome(o, c, { name, madeFor: space.madeForCall(m, held.row.started_at), folder });
    await updateManifest(o, c, m.itemId, (x) => ({ ...x, workspaceId: id }));
    const home = { workspaceId: id, folderId: folder.id, made: true };
    await save(o, c, callId, { ...held.state, workspace: { ...held.state.workspace, home } });
    clog.info('call settled on a new home', { callId, workspaceId: id, full: full !== null });
    return { again: false, home, made: true, was: now, room: held.row.room_name, guests } as const;
  });
  // The meeting changed while this was asked: ask again, from what it says now.
  if (taken.again) return settledHome(o, callId, timeZone, full);
  const { home } = taken;
  if (taken.made) {
    // Everyone invited comes in now the call's row is let go, so a big invite never holds the call up, and it's open to
    // everyone in the call before anyone's told it's there.
    await space.followHome(o, row.meeting_item_id, { add: taken.guests });
    await space.carryForward(o, row.meeting_item_id, taken.was, home.workspaceId);
    await openForCall({ organizer: o, callId }, home.workspaceId);
    await tellRoom(o, taken.room, callId, { call: true, log: false });
    return home;
  }
  if (!home.made) {
    const folder = space.folderFor(o, organizer, callId, home.folderId, name, row.started_at);
    const put = await space.folderIn(o, home.workspaceId, folder);
    if (put === 'gone') throw notFound('That workspace', { callId, workspaceId: home.workspaceId });
    // No room for the folder: the call settles on a new home, and only a folder that's there is ever marked made.
    if (put === 'full') return settledHome(o, callId, timeZone, home.workspaceId);
    await tx(o.pool, async (c) => {
      const held = await load(o, c, callId, true);
      const h = held.state.workspace.home;
      if (held.row.state === 'live' && h?.folderId === home.folderId && !h.made) await save(o, c, callId, { ...held.state, workspace: { ...held.state.workspace, home: { ...h, made: true } } });
    });
    await space.followHome(o, row.meeting_item_id, { add: taken.guests });
    clog.info('call folder settled in its home', { callId, workspaceId: home.workspaceId });
  }
  return opened(home);
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
 * Someone opens Workspace. A home that can't be made for a guest opening it is the organizer's to hear about, not theirs,
 * and an agenda that can't be made is no reason anyone can't open the rest. They're told as the call is once it's settled:
 * what they carry names the workspace it uses, which may be the home settled just now.
 */
export async function openWorkspace(v: Viewer, callId: string, timeZone: string | undefined): Promise<CallState> {
  const o = v.organizer;
  let now = v;
  try {
    await settledHome(o, callId, timeZone);
    // Settling the home opened it, and switching opens what's switched to; one switched to under the release before opens here.
    const { row, state } = await load(o, o.pool, callId);
    const inUse = workspaceIn(state);
    if (inUse !== null && await openForCall({ organizer: o, callId }, inUse)) await tellRoom(o, row.room_name, callId, { call: true, log: false });
    now = { ...v, workspace: inUse };
    await agendaFor(o, callId).catch((e: unknown) => clog.warn('next agenda not made', { callId, err: e }));
  } catch (e) {
    if (v.isOrganizer || !(e instanceof ConflictError)) throw e;
    clog.info('workspace not settled for someone opening it', { callId, code: e.code });
  }
  return view(now, o.pool, callId);
}

/** What viewing another workspace in the call would mean, for the organizer to decide. */
export async function previewWorkspace(v: Viewer, callId: string, workspaceId: string): Promise<CallWorkspaceSwitch> {
  return space.preview(v, await readerInCall(v), (await load(v.organizer, v.organizer.pool, callId)).state.people, workspaceId);
}
