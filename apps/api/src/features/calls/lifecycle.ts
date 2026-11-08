import { MAIN_PLACE, type CallEndResult, type Speaker } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../context';
import type { LiveKitEvent } from '../../livekit';
import { id128 } from '../../crypto';
import { exec, maybeOne, rows, timestamp, tx, type Db } from '../../db';
import { ConflictError } from '../../errors';
import { openOwner } from '../../owners';
import { me, profile } from '../account/account';
import { CallSpace, NO_BOARDS, NO_SPACE, withOpenBoards, type WorkedDocument } from './space-state';
import * as space from './workspace';
import * as boards from './boards';
import * as liveNotes from './live-notes';
import { queueDelete, segments, setRecordingState } from '../recordings/audio';
import * as capture from './capture';
import { dropInvites } from '../meetings/access';
import { MeetingManifest, updateManifest } from '../meetings/service';
import { getItem } from '../../vault';
import { finishRecording, type HeldRoom } from '../notes/service';
import { standIns, type HostChange } from './hosting';
import { Joined, relocate } from './places';
import * as rings from './rings';
import * as screens from '../recordings/screens';
import { endSeats } from '../workspaces/service';
import * as writer from '../notes/writer';
import { log } from '../../log';
import { closeRooms, hostNotices, load, roomsChanged, roomsClosedBetween, save, secondsIn, settle, sharesEnd, tenthsIn, type Row, type Stored, withPerson } from './state';
import { MlsRow, appendMls, openMls } from './mls-log';
import { hereIn, knownIn, knownUntil, personFor, speakersIn, type Viewer } from './participants';
import { afterClosing, keepRoomBoards, landRooms, syncBoardSeats, syncRoomBoards } from './room-boards';
import { stillHosting } from './permissions';
import { nudge } from './notifications';
import { leaveAttention } from './attention';

const clog = log.child({ component: 'calls' });

/**
 * The call goes on with another connection hosting (docs: Calls and recordings › Host hand-off): `host` (already among
 * the call's people, or `joining` now) hosts from now on, and `gone` (connections) have left. Every change of host
 * starts a new generation of MLS groups for every part of the call, which the new host's browser creates, so it's leaf 0
 * of each and the only committer there: the old host's keys stay with the old groups, everyone already let in rejoins
 * their part's new group with fresh keys without asking, open rooms stay open, and anyone still waiting keeps waiting
 * (key packages aren't tied to a group, so theirs carry over). What the notes capture carries over exactly: on stays on,
 * its recording going on in a new segment from the new host's browser; paused or off stay so, since only the organizer
 * changes them. `told` says what everyone hears about it. Runs in the caller's transaction, which holds the call's row:
 * the host and the generation change together, so no two browsers ever commit in one generation.
 */
export async function newGeneration(o: Owner, c: Db, live: Row, state: Stored, change: { host: Joined; joining: boolean; gone: string[] }, told?: { change: HostChange; organizer: string } | undefined): Promise<{ state: Stored; generation: number; roomName: string }> {
  const generation = live.mls_generation + 1;
  const waiting = new Set(state.people.filter((j) => j.status === 'waiting' && j.keysFor === live.mls_generation).map((j) => j.identity));
  const kps = await rows(c, MlsRow, `SELECT seq, kind, party, grp, epoch, body_ciphertext FROM call_mls WHERE owner_id = $1 AND call_id = $2 AND generation = $3 AND kind = 'keypackage' ORDER BY seq`,
    [o.ownerId, live.call_id, live.mls_generation]);
  const carried = kps.flatMap((r) => (r.party && waiting.has(r.party) ? [{ party: r.party, body: openMls(o, live.call_id, r) }] : []));
  const kept = new Set(carried.map((k) => k.party));
  const gone = new Set(change.gone);
  // The old host's connection was gone from when LiveKit said so; anyone else who goes, from now. Nothing either heard
  // after that was sent.
  const now = Date.now();
  const goneAt = (j: Joined) => (j.status !== 'in' ? j.left : (j.identity === live.host_identity ? live.host_left_at?.getTime() : undefined) ?? now);
  // The old host stops hosting when it went, or now; the new one hosts from now.
  const hostedUntil = (j: Joined): Joined['hosting'] => j.hosting.map((h) => (h.to === null ? { ...h, to: (gone.has(j.identity) ? goneAt(j) : null) ?? now } : h));
  const hosting = change.host.hosting.at(-1)?.to === null ? change.host.hosting : [...change.host.hosting, { from: now, to: null }];
  const open = state.breakouts.open;
  // In every group from the start of the generation: its own browser makes them.
  const host: Joined = { ...change.host, status: 'in', keysFor: generation, group: MAIN_PLACE, placedSeq: live.mls_seq + carried.length, hosting };
  let s: Stored = {
    ...state,
    host: host.identity,
    people: [...state.people.map((j): Joined => (j.identity === host.identity ? host
      : { ...j, group: null, leftAt: {}, hosting: hostedUntil(j), ...(gone.has(j.identity) ? { status: 'left' as const, left: goneAt(j) } : {}), ...(kept.has(j.identity) ? { keysFor: generation } : {}) })),
    ...(change.joining ? [host] : [])],
    // Open rooms stay open, each with a new group from its first epoch.
    breakouts: { ...state.breakouts, open: open ? { ...open, rooms: open.rooms.map((r) => ({ ...r, epoch: 0 })) } : null },
    chatAt: {},
    moving: null,
    // The same person on a new connection (the organizer's, or a stand-in's reload or move) is still the one spotlighted.
    spotlight: state.people.find((j) => j.identity === state.spotlight)?.person === host.person ? host.identity : state.spotlight
  };
  // Whoever left takes their shares with them.
  s = sharesEnd(s, state.people.filter((j) => gone.has(j.identity) && j.status === 'in').map((j) => j.identity), tenthsIn(live.started_at));
  // What the old host's browser couldn't capture was its own: the new host's says for itself. While notes are on, the
  // old browser's part of the recording ends, and a new segment starts in the new one's.
  s = { ...s, notes: { ...s.notes, unavailable: [] } };
  if (state.host !== null && s.notes.status === 'on' && s.notes.recordingId) {
    // If the old host's connection had already left the room (it dropped, or a reload or a move let go of it), the
    // host's browser was out of the call from then until now: nothing was recorded or heard, a gap in the notes after
    // the segment it was recording. With nobody saying it left, it was still there, and nothing was missed.
    const at = tenthsIn(live.started_at);
    const from = live.host_left_at ? Math.max(tenthsIn(live.started_at, live.host_left_at.getTime()), s.notes.history.at(-1)?.at ?? 0) : at;
    const offline = from < at ? [...s.notes.offline, { from, to: at, segment: s.notes.segment }] : s.notes.offline;
    s = { ...s, notes: { ...s.notes, segment: s.notes.segment + 1, segmentFrom: at, offline } };
  }
  if (told) s = hostNotices(s, told.change, told.organizer);
  await save(o, c, live.call_id, s);
  const roomName = live.room_name ?? `r_${id128()}`;
  await exec(c, 'DELETE FROM call_mls WHERE owner_id = $1 AND call_id = $2', [o.ownerId, live.call_id]);
  let seq = live.mls_seq;
  for (const k of carried) { seq += 1; await appendMls(o, c, live.call_id, { seq, generation, epoch: 0, grp: null }, 'keypackage', k.party, k.body); }
  await exec(c, 'UPDATE calls SET host_identity = $3, host_joined_at = now(), host_left_at = NULL, room_name = $4, mls_generation = $5, mls_epoch = 0, mls_seq = $6, version = version + 1 WHERE owner_id = $1 AND call_id = $2',
    [o.ownerId, live.call_id, host.identity, roomName, generation, seq]);
  return { state: s, generation, roomName };
}

/**
 * Ends the call for everyone: the recording stops, the transcript moves into the note, the note goes to
 * everyone invited, and the LiveKit room goes. A call set not to keep its recording deletes it here, once the note
 * has what it worked out from it. The organizer leaving, a webhook and upkeep all end it here.
 */
async function endCall(o: Owner, callId: string, unless?: (r: Row) => boolean): Promise<CallEndResult | null> {
  let room: string | null = null;
  let audio: string[] = [];
  let worked: WorkedDocument[] = [];
  let home: CallSpace['home'] = null;
  /** What the call kept of its boards, and its home, whose tree has every room's board. */
  let kept: Pick<Stored, 'board' | 'workspace'> = { board: NO_BOARDS, workspace: NO_SPACE };
  let everyone: boards.Here[] = [];
  /** Who has the rooms' boards by address once the call's over: the organizer, and everyone on the invite as it ended. */
  let invitedAtEnd: string[] = [];
  const end = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    // Upkeep decided from an earlier read; the organizer may have come back since.
    if (unless?.(row)) return null;
    room = row.room_name;
    const duration = Math.max(1, secondsIn(row.started_at));
    // Rooms still open come back when the call ends, and go into the notes with the rest: each room's own section.
    const open = state.breakouts.open;
    const closed = open ? closeRooms(state, Math.min(open.until, duration), row.started_at.getTime()) : state;
    if (row.state === 'live') {
      await exec(c, `UPDATE calls SET state = 'ended', ended_at = now(), version = version + 1 WHERE owner_id = $1 AND call_id = $2`, [o.ownerId, callId]);
    }
    const s = row.state === 'live' ? await roomsChanged(o, c, callId, state, relocate(state, closed, Date.now(), row.mls_seq)) : closed;
    if (row.state === 'live') {
      // Whatever was open anywhere as it ended is noted too, rooms' boards included, as every save notes it.
      worked = withOpenBoards(s.workspace, state.board.open).worked;
      home = s.workspace.home;
      kept = { board: s.board, workspace: s.workspace };
      everyone = knownIn(o, callId, s);
      // Who has the rooms' boards by address, whatever the call says of them: one it lost track of is found in its home's tree.
      const m = await getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
      invitedAtEnd = [(await profile(o, c)).email, ...boards.onInvite(s, m.manifest.guests, hereIn(o, callId, s))];
      // What the call kept of its workspace goes with it: what was worked on goes into its note, if it has one, and nowhere else.
      await save(o, c, callId, { ...s, workspace: NO_SPACE, board: NO_BOARDS });
      // The MLS log only matters while the call runs, and nobody is rung into a call that's over.
      await exec(c, 'DELETE FROM call_attention WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId]);
      await exec(c, 'DELETE FROM call_mls WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId]);
      await rings.clear(o, c, row.meeting_item_id);
      // Who's invited lasts as long as the call does. Its note has its own list.
      await dropInvites(o, c, [row.meeting_item_id]);
      if (s.notes.recordingId) await setRecordingState(o, c, s.notes.recordingId, 'stopped');
      // The live notes end with the call: what was ticked and what people added go into the note, and the notes at the end take over.
      const { ticked, added } = await liveNotes.finish(o, c, callId);
      if (s.notes.noteId) {
        // Ending while the host's browser is out of the call (it never came back): nothing was captured since it left.
        const gone = row.host_left_at && s.notes.status === 'on' ? tenthsIn(row.started_at, row.host_left_at.getTime()) : null;
        const offline = gone !== null && gone < duration ? [...s.notes.offline, { from: gone, to: duration, segment: s.notes.segment }] : s.notes.offline;
        const recorded = (at: number) => capture.recorded(s.notes.history, offline, at, duration);
        const held = s.breakouts.held.map((h) => ({ rooms: h.rooms.map((r) => ({ id: r.id, name: r.name, emails: r.emails })), from: recorded(h.from), to: recorded(h.to) }));
        const segs = s.notes.recordingId ? await segments(o, s.notes.recordingId, c) : [];
        // The stretches nothing was captured in go into the note, so it says so where they fall.
        const gaps = capture.gapsOf(s.notes.history, offline, row.started_at, segs, duration);
        // And what was on shared screens, each frame where it was shown and for how long, its presenter named as the call names speakers.
        const organizer = await me(o, c);
        const speakerOf = speakersIn(s, organizer);
        const shown = screens.moments(await screens.framesOf(o, c, s.notes.noteId), {
          history: s.notes.history, offline, screens: s.notes.screens.history, ended: s.notes.screens.ended, gaps, segments: segs, duration, presenterOf: speakerOf
        });
        // Each breakout room's section: everyone who was in it (the organizer if it came in), when, and its own gaps.
        const peopleOf = (seen: string[]): Speaker[] => seen.flatMap((key) => {
          const j = key === 'organizer' ? undefined : s.people.findLast((x) => x.person === key);
          const p = key === 'organizer' ? organizer : j ? personFor(j, j.identity, j.name, organizer) : undefined;
          return p ? [{ name: p.name, person: p }] : [];
        });
        const rooms: HeldRoom[] = s.breakouts.held.flatMap((h) => h.rooms.map((r) => ({
          id: r.id, name: r.name, people: peopleOf(r.seen), from: recorded(h.from), to: recorded(h.to),
          gaps: capture.roomGaps(s.notes.history, offline, r.pauses, h.from, row.started_at, h.to, h.to)
        })));
        audio = await finishRecording(o, c, s.notes.noteId, duration, held, speakerOf, gaps, shown, rooms, ticked, worked, added.map((a) => ({ room: a.room, action: liveNotes.toNote(a, recorded(a.said)) })));
      }
      await updateManifest(o, c, row.meeting_item_id, (m) => ({ ...m, status: 'ended', duration, ...(s.notes.noteId ? { noteId: s.notes.noteId } : {}) }));
    }
    clog.info(row.state === 'live' ? 'call ended' : 'left an ended call', { callId, meetingId: row.meeting_item_id, duration, noteId: s.notes.noteId });
    return { meetingId: row.meeting_item_id, pendingNoteId: s.notes.noteId, duration, startedAt: row.started_at, ended: row.state === 'live' };
  });
  if (!end) return null;
  await queueDelete(o, audio);
  // Nor do moves to other devices. Deleted once the call has ended, so a move coming in at that moment never waits on it.
  await exec(o.pool, 'DELETE FROM call_moves WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId]);
  await boards.keepForInvited(o, callId, end.meetingId, kept.board, everyone);
  // Every room's board is everyone invited's now, before its seats go, and what was open in rooms as the call ended lands on
  // the main board, if there is one: there's no main room to come back to.
  await keepRoomBoards(o, callId, kept, invitedAtEnd);
  // Nor does anything shared with people's seats in it (maintenance sweeps up, should this be cut short).
  await endSeats(o, [callId]);
  if (end.pendingNoteId) writer.kick(o, o.ownerId);
  // Deleting the room disconnects everyone in it, which is how their browsers learn the call ended: an ended call is the organizer's alone to read.
  if (room) await o.livekit.deleteRoom(room).catch((e: unknown) => clog.warn('room not deleted', { callId, err: e }));
  // What's kept of the workspace is the last thing and nobody waits for it: it can take a worker as long as a worker has for
  // each document, and nothing about the call's end depends on it. It says itself when something didn't work.
  if (end.ended) void space.afterCall(o, { callId, meetingId: end.meetingId, worked, noteId: end.pendingNoteId, home, startedAt: end.startedAt });
  return { meetingId: end.meetingId, pendingNoteId: end.pendingNoteId, duration: end.duration };
}

/**
 * Leaving. Anyone but whoever hosts just goes: the host's browser takes them out of the group. Whoever hosts ends the
 * call for everyone (`end`); a host's page going away (`end` false: it hadn't heard yet that it hosts) hands the call to
 * whoever's next, and is refused when nobody can take it, so a page going away never ends it.
 */
export async function leave(v: Viewer, callId: string, end: boolean, onPurpose = false): Promise<CallEndResult | null> {
  if (!v.isHost) {
    await departed(v.organizer, callId, v.pass.identity, Date.now(), onPurpose);
    return null;
  }
  if (!end) {
    await handOff(v, callId, null, onPurpose);
    return null;
  }
  const ended = await endCall(v.organizer, callId);
  if (!ended) throw new ConflictError('This call has ended.', { context: { callId } });
  return ended;
}

/**
 * Whoever hosts leaves, and the call goes on with `to` hosting until the organizer is back (docs: Calls and recordings ›
 * Host hand-off), or with whoever's next when `to` is null: someone invited who's in the call and in its LiveKit room.
 * One transaction takes the leaver out and starts the new host's generation, so the call is never without a host.
 * Refused (409) when they can't host now, and nothing changes: the leaver stays, and can choose again or end the call.
 */
export async function handOff(v: Viewer, callId: string, to: string | null, onPurpose = to !== null): Promise<void> {
  const o = v.organizer;
  const ctx = { callId, role: v.pass.role, standIn: !v.isOrganizer };
  const { row: first } = await load(o, o.pool, callId);
  if (first.state !== 'live' || !first.room_name) throw new ConflictError('This call has ended.', { context: ctx });
  // A browser that isn't in the room can't take over. Asked before the row lock, so LiveKit never holds it up; if it
  // can't be asked, the call's own word that they're in it will do.
  const connected = await o.livekit.participants(first.room_name).then((ps) => new Set(ps.map((p) => p.identity)), () => undefined);
  const r = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
    // Rooms whose time is up close now, taking what was said in them along.
    const s = await roomsChanged(o, c, callId, state, settle(state, row));
    stillHosting(v, s, ctx);
    const from = s.people.find((j) => j.identity === v.pass.identity);
    const can = standIns(s, new Set([v.pass.identity]), connected);
    const next = to === null ? can[0] : can.find((j) => j.identity === to);
    if (!from || !next) {
      throw new ConflictError(to === null ? 'Nobody else here can host. End the call for everyone instead.' : 'They can’t host right now. Choose someone else, or end the call.',
        { context: { ...ctx, why: 'not eligible', chosen: to !== null } });
    }
    if (onPurpose) await leaveAttention(o, c, callId, from);
    const organizer = (await me(o, c)).name;
    const { state: after, generation } = await newGeneration(o, c, row, onPurpose ? space.leftForGood(s, from.person, from.identity, space.ending(o, callId)) : s, { host: next, joining: false, gone: [from.identity] }, { change: { kind: 'left', from, to: next }, organizer });
    clog.info('host handed off and left', { ...ctx, generation, segment: after.notes.segment, notes: after.notes.status });
    return { room: row.room_name, closed: roomsClosedBetween(state, s) };
  });
  if (r.room) await o.livekit.removeParticipant(r.room, v.pass.identity).catch((e: unknown) => clog.info('host already gone from the room', { callId, err: e }));
  await afterClosing({ organizer: o, callId }, r.closed, () => nudge(o, r.room, callId, { call: true, log: true }));
}

/**
 * Someone other than whoever hosts is gone (left, or LiveKit says so): the host's browser removes them from the group,
 * so the keys move on. Someone still asking to be let in takes their request back. The host going is handOff's, or
 * upkeep's (reconcile), never this. `onPurpose`: they chose to, so what they started stops; only they can say so, and a
 * connection dropping or a page reloading comes back to what it left. `noticed`: Alcove found out, from LiveKit or upkeep,
 * rather than the connection saying so, so it went some time before `at`: its stay ends when it was last heard from.
 */
export async function departed(o: Owner, callId: string, identity: string, at = Date.now(), onPurpose = false, noticed = false): Promise<void> {
  const r = await tx(o.pool, async (c) => {
    const held = await load(o, c, callId, true);
    const { row } = held;
    const j = held.state.people.find((x) => x.identity === identity && x.role !== 'host' && x.identity !== held.state.host);
    const state = j && onPurpose ? space.leftForGood(held.state, j.person, identity, space.ending(o, callId)) : held.state;
    if (row.state !== 'live' || !j) return null;
    if (onPurpose) await leaveAttention(o, c, callId, j);
    if (j.status !== 'in' && j.status !== 'waiting') {
      // LiveKit's word that they'd gone got here first.
      if (state !== held.state) await save(o, c, callId, state);
      return null;
    }
    // Someone who was in is kept, as having left (a reload's pass brings them back, hand and all), and their shares
    // end. Someone who only asked is kept as turned away: nothing of theirs, a pass included, brings them in without
    // asking again, and their identity can't come back as someone else (to be let in by a toast still showing the first ask).
    await save(o, c, callId, sharesEnd(withPerson(state, identity, (x) => (j.status === 'waiting' ? { ...x, status: 'denied' } : { ...x, status: 'left', left: noticed ? knownUntil(callId, x, at) : at })),
      j.status === 'in' ? [identity] : [], tenthsIn(row.started_at)));
    return { room: row.room_name, was: j.status, rooms: held.state.board.rooms.some((x) => !x.kept) };
  });
  if (r) {
    clog.info(r.was === 'waiting' ? 'someone stopped asking to join' : 'someone left the call', { callId });
    // Someone who's gone isn't in their room: its board goes with them, and comes back when they do.
    if (r.rooms) await syncRoomBoards({ organizer: o, callId });
    await nudge(o, r.room, callId, { call: true, log: true });
  }
}

/* ---------- the call's lifecycle from LiveKit: webhooks and upkeep, with nobody's session ---------- */

/**
 * How long the host's connection may be gone (LiveKit said it left, and still doesn't have it) before someone else hosts:
 * long enough for a reload to come back hosting by itself, short enough that the call isn't long without anyone letting
 * people in, moving its keys on or taking its notes.
 */
export const HANDOFF_MS = 10_000;

/**
 * How long the host's connection may be gone before the call ends when nobody can host instead, and how long a new
 * host's browser has to reach the room at all: LiveKit's 20 s departure timeout, plus margin.
 */
export const HOST_GRACE_MS = 25_000;

/** How long after LiveKit says someone left before asking it whether they're really gone. */
const LEFT_CHECK_MS = 3_000;

/** `at` is when LiveKit said they left (ms): their time in the call ends then, not when this check ran. */
async function goneFromRoom(d: Deps, ownerId: string, callId: string, roomName: string | null, identity: string, at: number): Promise<void> {
  const here = roomName ? await d.livekit.participants(roomName).then((ps) => ps.some((p) => p.identity === identity), () => false) : false;
  if (here) { clog.info('left and came back to the room', { callId }); return; }
  await departed(await openOwner(d, ownerId, undefined), callId, identity, at, false, true);
}

/**
 * How long someone let in has to reach the room before they're taken out. A tab in the background can take a
 * minute to notice it was let in; a browser that closed or died while asking never will.
 */
export const ARRIVAL_MS = 90_000;

/**
 * Takes out whoever was let in at least ARRIVAL_MS ago and isn't in the room: they never got there, or LiveKit's
 * word that they left was missed. Nobody is taken out while LiveKit can't be asked.
 */
export async function arrivals(d: Deps, ownerId: string, callId: string, roomName: string, now: number): Promise<void> {
  const o = await openOwner(d, ownerId, undefined);
  const { row, state } = await load(o, o.pool, callId);
  // Upkeep comes through here, so a seat that a crash kept from someone let in is put right, and so is a room's board, and
  // rooms' boards a crash kept from landing land.
  if (row.state === 'live' && state.board.letIn.length) await syncBoardSeats({ organizer: o, callId });
  if (row.state === 'live' && state.board.rooms.some((r) => !r.kept)) await syncRoomBoards({ organizer: o, callId });
  if (row.state === 'live' && state.board.landing) await landRooms({ organizer: o, callId });
  const due = row.state === 'live' ? state.people.filter((j) => j.role !== 'host' && j.identity !== state.host && j.status === 'in' && now - j.since >= ARRIVAL_MS) : [];
  if (!due.length) return;
  const here = new Set((await d.livekit.participants(roomName)).map((p) => p.identity));
  for (const j of due) {
    if (here.has(j.identity)) continue;
    clog.info('someone let in isn’t in the room', { callId, role: j.role });
    await departed(o, callId, j.identity, now, false, true);
  }
}

const ByRoom = z.object({ owner_id: z.string(), call_id: z.string(), host_identity: z.string().nullable() });

/** Applies a verified LiveKit webhook. Rooms are unique, so the room finds the call (and its organizer, and who hosts). */
export async function onRoomEvent(d: Deps, e: LiveKitEvent): Promise<void> {
  if (!e.roomName) return;
  const r = await maybeOne(d.pool, ByRoom, `SELECT owner_id, call_id, host_identity FROM calls WHERE room_name = $1 AND state = 'live'`, [e.roomName]);
  if (!r) { clog.debug('livekit event for no live call', { event: e.event }); return; }
  if (e.event === 'room_finished') { await endCall(await openOwner(d, r.owner_id, undefined), r.call_id); return; }
  if (!e.identity) return;
  if (e.identity !== r.host_identity) {
    // LiveKit says someone left: once it's clear they're really gone (a reconnect shows up as leaving and joining again), they're taken out.
    if (e.event === 'participant_left') {
      const who = e.identity;
      const heard = Date.now();
      setTimeout(() => { goneFromRoom(d, r.owner_id, r.call_id, e.roomName, who, heard).catch((err: unknown) => clog.warn('checking who left failed', { callId: r.call_id, err })); }, LEFT_CHECK_MS).unref();
    }
    return;
  }
  if (e.event === 'participant_left') {
    // A reload or a dropped connection: if the host doesn't come back in time someone else hosts, and the call ends only
    // when nobody can.
    await exec(d.pool, 'UPDATE calls SET host_left_at = now() WHERE owner_id = $1 AND call_id = $2 AND host_identity = $3', [r.owner_id, r.call_id, e.identity]);
    clog.info('host connection left', { callId: r.call_id });
    for (const after of [HANDOFF_MS, HOST_GRACE_MS]) setTimeout(() => { reconcile(d).catch((err: unknown) => clog.warn('reconcile after the host left failed', { err })); }, after + 1_000).unref();
  } else if (e.event === 'participant_joined') {
    await exec(d.pool, 'UPDATE calls SET host_left_at = NULL WHERE owner_id = $1 AND call_id = $2 AND host_identity = $3', [r.owner_id, r.call_id, e.identity]);
  } else return;
  // Everyone's screen says what's captured: nothing while the host's browser is out of the call.
  await nudge(await openOwner(d, r.owner_id, undefined), e.roomName, r.call_id, { call: true, log: false });
}

const LiveCall = z.object({ owner_id: z.string(), call_id: z.string(), room_name: z.string(), host_identity: z.string().nullable(), host_joined_at: timestamp.nullable(), host_left_at: timestamp.nullable(), started_at: timestamp });

type LiveCall = z.infer<typeof LiveCall>;

/**
 * Looks after live calls whose host is gone: once LiveKit has said the host's connection left (HANDOFF_MS ago), or its
 * browser never reached the room (HOST_GRACE_MS), someone else hosts (standInFor); if nobody can, the call ends once the
 * host has been gone past HOST_GRACE_MS, as it always has. Calls whose room LiveKit no longer has end too. Whether the
 * host is in the room is asked of LiveKit, so a missed webhook neither ends a call nor keeps one going, and nothing
 * changes while LiveKit can't be asked.
 */
export async function reconcile(d: Deps, now = Date.now()): Promise<number> {
  let ended = 0;
  // Every live call, a page at a time.
  for (let last: { at: Date; id: string } | null = null; ;) {
    const page: LiveCall[] = await rows(d.pool, LiveCall, `SELECT owner_id, call_id, room_name, host_identity, host_joined_at, host_left_at, started_at FROM calls
      WHERE state = 'live' AND room_name IS NOT NULL AND ($1::timestamptz IS NULL OR (started_at, call_id) > ($1::timestamptz, $2)) ORDER BY started_at, call_id LIMIT 500`, [last?.at ?? null, last?.id ?? '']);
    if (!page.length) break;
    const tail: LiveCall | undefined = page.at(-1);
    last = tail ? { at: tail.started_at, id: tail.call_id } : null;
    ended += await reconcilePage(d, page, now);
    if (page.length < 500) break;
  }
  return ended;
}

async function reconcilePage(d: Deps, live: LiveCall[], now: number): Promise<number> {
  const rooms = await d.livekit.existingRooms(live.flatMap((c) => (now - c.started_at.getTime() > 60_000 ? [c.room_name] : [])));
  let ended = 0;
  // Each call on its own: one that can't be handed on or ended this time never holds up the others.
  for (const c of live) {
    const done = await reconcileCall(d, c, rooms, now).catch((err: unknown) => {
      clog.warn('upkeep of a call failed', { callId: c.call_id, err });
      return false;
    });
    if (done) ended++;
  }
  return ended;
}

/** Upkeep of one live call: who reached the room, a hand-off once its host is gone, or its end. True when it ended. */
async function reconcileCall(d: Deps, c: LiveCall, rooms: ReadonlySet<string>, now: number): Promise<boolean> {
  const since = c.host_left_at ?? c.host_joined_at;
  const roomGone = now - c.started_at.getTime() > 60_000 && !rooms.has(c.room_name);
  let hostGone = !roomGone && since !== null && now - since.getTime() > (c.host_left_at ? HANDOFF_MS : HOST_GRACE_MS);
  let connected: Set<string> | undefined;
  if (hostGone) {
    connected = await d.livekit.participants(c.room_name).then((ps) => new Set(ps.map((p) => p.identity)), () => undefined);
    if (!connected || (c.host_identity !== null && connected.has(c.host_identity))) {
      hostGone = false;
      if (connected && c.host_left_at) await exec(d.pool, 'UPDATE calls SET host_left_at = NULL WHERE owner_id = $1 AND call_id = $2 AND host_identity = $3', [c.owner_id, c.call_id, c.host_identity]);
    }
  }
  if (!hostGone && !roomGone) {
    await arrivals(d, c.owner_id, c.call_id, c.room_name, now).catch((err: unknown) => clog.warn('checking who reached the room failed', { callId: c.call_id, err }));
    return false;
  }
  if (hostGone && connected) {
    // Someone else hosts if anyone can; if nobody can yet, the call waits until the grace runs out.
    if ((await standInFor(d, c, connected, now)) !== 'nobody') return false;
    if (since !== null && now - since.getTime() <= HOST_GRACE_MS) return false;
  }
  const end = await endCall(await openOwner(d, c.owner_id, undefined), c.call_id, (r) => !roomGone && r.host_identity !== c.host_identity);
  if (!end) return false;
  clog.info('call ended without a host', { callId: c.call_id, reason: hostGone ? 'host gone, nobody can host' : 'room gone' });
  return true;
}

/**
 * Someone else hosts, once the host's connection has been gone long enough: the best of the invited people in the call
 * who are in its LiveKit room (`connected`). Reconcile decided from an earlier read, so it's all checked again under
 * the call's row lock. `handed`: done; `nobody`: nobody can host; `moved on`: the host changed meanwhile (came back,
 * or someone already took over), so there's nothing to do.
 */
async function standInFor(d: Deps, c: LiveCall, connected: ReadonlySet<string>, now: number): Promise<'handed' | 'nobody' | 'moved on'> {
  const o = await openOwner(d, c.owner_id, undefined);
  const r = await tx(o.pool, async (tc) => {
    const { row, state } = await load(o, tc, c.call_id, true);
    const same = row.state === 'live' && row.host_identity === c.host_identity && row.host_left_at?.getTime() === c.host_left_at?.getTime();
    if (!same) return { result: 'moved on' as const, room: null, closed: false };
    // Its connection let go to move to another device, which can still arrive: the call waits for it. One that ran out
    // is a host gone like any other.
    if (state.moving && state.moving.until > now) return { result: 'moved on' as const, room: null, closed: false };
    const s = await roomsChanged(o, tc, c.call_id, state, settle(state, row, now));
    const from = s.people.find((j) => j.identity === s.host);
    const next = standIns(s, new Set(s.host ? [s.host] : []), connected)[0];
    if (!next) return { result: 'nobody' as const, room: null, closed: false };
    const told = from ? { change: { kind: 'dropped' as const, from, to: next }, organizer: (await me(o, tc)).name } : undefined;
    const { generation, state: after } = await newGeneration(o, tc, row, s, { host: next, joining: false, gone: from ? [from.identity] : [] }, told);
    clog.info('host gone; someone else hosts', { callId: c.call_id, generation, from: from?.role === 'host' ? 'organizer' : 'stand-in', segment: after.notes.segment, notes: after.notes.status });
    return { result: 'handed' as const, room: row.room_name, closed: roomsClosedBetween(state, s) };
  });
  return afterClosing({ organizer: o, callId: c.call_id }, r.closed, async () => {
    if (r.result === 'handed') await nudge(o, r.room, c.call_id, { call: true, log: true });
    return r.result;
  });
}
