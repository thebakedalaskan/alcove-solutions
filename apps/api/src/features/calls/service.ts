import { MAIN_PLACE, firstName, type CallAction, type CallState } from '@alcove/api';
import { id128 } from '../../crypto';
import { exec, tx } from '../../db';
import { ConflictError, ValidationError } from '../../errors';
import { CallBoards } from './space-state';
import * as space from './workspace';
import * as boards from './boards';
import { MeetingManifest } from '../meetings/service';
import { getItem } from '../../vault';
import { me } from '../account/account';
import { addedFromLink, takeOffInvite } from '../meetings/invites';
import { placeOf, relocate } from './places';
import * as rings from './rings';
import { readerInCall } from '../workspaces/access';
import { endSeat } from '../workspaces/service';
import { log } from '../../log';
import { hereIn, knownIn, seatKey, seatOf, seatsOf, type Viewer, whereIs } from './participants';
import { actOnWorkspace, openWorkspace } from './workspace-actions';
import { actOnBoard, runOnBoard } from './board-actions';
import { closeRooms, load, notice, saveSettled, screensOf, secondsIn, settle, sharesEnd, tenthsIn, type Stored, withPerson } from './state';
import { anyone, stillHosting } from './permissions';
import { view } from './read-model';
import { addFollowUp, editFollowUp, reviewFollowUp, tickFollowUp } from './insights';
import { ROOMS_ON_NEW_BOARD, afterClosing, landRooms, syncBoardSeats, syncRoomBoards } from './room-boards';
import { changeCapture } from './recording';
import { tellRoom } from './notifications';
import { changeAttention, changeStatus, isAttentionAction } from './attention';
import { readChat } from './chat-read';

const clog = log.child({ component: 'calls' });

export async function act(v: Viewer, callId: string, a: CallAction): Promise<CallState> {
  const o = v.organizer;
  if (a.type === 'workspace-open') return openWorkspace(v, callId, a.timeZone);
  if (space.isSpaceAction(a)) return actOnWorkspace(v, callId, a);
  if (boards.isBoardAction(a)) return actOnBoard(v, callId, a);
  if (boards.isRunAction(a)) return runOnBoard(v, callId, a);
  if (a.type === 'mute') {
    // Carried out by LiveKit; nothing about the call changes here.
    const { row, state } = await load(o, o.pool, callId);
    if (row.state !== 'live' || !row.room_name) throw new ConflictError('This call has ended.', { context: { callId, action: a.type } });
    stillHosting(v, state, { callId, action: a.type });
    await o.livekit.muteTrack(row.room_name, a.identity, a.trackSid);
    clog.info('host control', { callId, action: a.type, target: a.identity });
    return view(v, o.pool, callId);
  }
  if (a.type === 'share-stop') return stopShare(v, callId, a.seat);
  // Who may be rung is settled before the call's lock is taken: knowing the team can take a calendar read.
  if (a.type === 'ring') await rings.mayRing(o, (await load(o, o.pool, callId)).row.meeting_item_id, a.emails);
  /**
   * Who the invite took on (`add`) or let go of (`gone`), for the call's home to follow once the call's row is let go, and the
   * workspaces made in the call (`made`), which do too.
   */
  const invite: { meetingId: string; add: string[]; gone: string[]; made: string[] } | null = a.type === 'ring' || a.type === 'remove' ? { meetingId: '', add: [], gone: [], made: [] } : null;
  // Rooms opening with something to work on: it's made first, with nothing of the call held.
  const ready = a.type === 'rooms-open' && a.board.mode !== 'none' ? await roomsReady(v, callId, a) : undefined;
  await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: { callId, action: a.type } });
    const at = secondsIn(row.started_at);
    // To a tenth of a second, for what's captured and for rooms opening: even a short pause falls on the right side of a room's opening.
    const exact = tenthsIn(row.started_at);
    const settled = settle(state, row);
    let s = settled;
    if (invite) invite.meetingId = row.meeting_item_id;
    let locked = row.locked;
    let gone: string[] = [];
    /** The seat of whoever this takes out of the call. */
    let removed: string | null = null;
    /** The connections that alone need to read the call again (a nudge's recipient), or null for everyone in the room. */
    let only: string[] | null = null;
    const ctx = { callId, action: a.type };
    // Under the call's row lock: a stand-in's last click as the organizer takes the call back is refused, not carried out.
    if (!anyone(a)) stillHosting(v, state, ctx);
    if (a.type === 'read-chat') {
      s = await readChat(v, c, callId, s, a.messages);
    } else if (isAttentionAction(a)) {
      only = await changeAttention(v, c, callId, s, a);
    } else if (a.type === 'status') {
      await changeStatus(v, c, callId, s, a);
    } else if (a.type === 'others-point') {
      // Someone's own choice about what they share, by person, so it holds when they come back on another connection.
      const off = s.othersPointOff.filter((p) => p !== v.pass.person);
      s = { ...s, othersPointOff: a.on ? off : [...off, v.pass.person] };
    } else if (a.type === 'board-ideas-done') {
      // Added to the board, or put aside: they go for everyone in the part of the call they're from, and nothing of them stays.
      const place = whereIs(v, settled);
      const kept = s.board.ideas[place];
      if (kept) s = { ...s, board: { ...s.board, ideas: { ...s.board.ideas, [place]: { ...kept, list: kept.list.filter((i) => !a.ids.includes(i.id)) } } } };
    } else if (a.type === 'follow-up') {
      await tickFollowUp(v, c, row, s, a);
    } else if (a.type === 'follow-up-edit') {
      await editFollowUp(v, c, row, s, a);
    } else if (a.type === 'follow-up-review') {
      await reviewFollowUp(v, c, row, s, a);
    } else if (a.type === 'follow-up-add') {
      await addFollowUp(v, c, row, s, a, at);
    } else if (a.type === 'pointing') {
      if (a.on !== s.pointing) {
        s = notice({ ...s, pointing: a.on }, a.on ? 'The organizer turned on pointing at shared screens.' : 'The organizer turned off pointing at shared screens.', 'info');
      }
    } else if (a.type === 'spotlight') {
      // Only someone in the call can be spotlighted.
      if (a.participantId !== null && !s.people.some((j) => j.identity === a.participantId && j.status === 'in')) throw new ValidationError('That person isn’t in this call.', { context: ctx });
      s = { ...s, spotlight: a.participantId };
    } else if (a.type === 'rooms-open') {
      checkRooms(s, a, (await getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting')).manifest, ctx);
      // Each room gets its own MLS group: everyone sent to one leaves the main room's group and joins the room's. What they
      // have to work on was made before the call's row was taken (`roomsReady`), and opens with them.
      const rooms = a.rooms.map((r, k) => ({ id: ready?.ids[k] ?? id128(), name: r.name, emails: r.emails, epoch: 0, pauses: [], scribes: [], seen: [] }));
      s = { ...s, spotlight: null, board: ready ? withRoomsReady(s.board, ready, rooms.map((r) => r.id)) : s.board, breakouts: { ...s.breakouts, open: { rooms, from: exact, until: exact + a.minutes * 60, message: null, visiting: null, board: a.board } } };
      // The board that was open can't take the rooms' frames, so they share a new one in its place: everyone is told why it changed.
      if (ready?.instead) s = notice(s, ROOMS_ON_NEW_BOARD, 'info');
    } else if (a.type === 'rooms-close') {
      s = closeRooms(s, exact, row.started_at.getTime());
    } else if (a.type === 'rooms-rename') {
      const open = s.breakouts.open;
      if (!open) throw new ConflictError('No rooms are open.', { context: ctx });
      if (!open.rooms.some((r) => r.id === a.roomId)) throw new ValidationError('That room isn’t open.', { context: ctx });
      s = { ...s, breakouts: { ...s.breakouts, open: { ...open, rooms: open.rooms.map((r) => (r.id === a.roomId ? { ...r, name: a.name } : r)) } } };
    } else if (a.type === 'rooms-move') {
      // Someone invited, to another open room or back to the main room: their browser leaves its group and joins the new part's.
      const open = s.breakouts.open;
      if (!open) throw new ConflictError('No rooms are open.', { context: ctx });
      if (a.roomId !== null && !open.rooms.some((r) => r.id === a.roomId)) throw new ValidationError('That room isn’t open.', { context: ctx });
      const meeting = await getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
      if (!meeting.manifest.guests.some((e) => e.toLowerCase() === a.email)) throw new ValidationError('Only people invited to this call can be sent to a room.', { context: ctx });
      s = { ...s, breakouts: { ...s.breakouts, open: { ...open, rooms: open.rooms.map((r) => ({ ...r, emails: [...r.emails.filter((e) => e !== a.email), ...(r.id === a.roomId ? [a.email] : [])] })) } } };
    } else if (a.type === 'rooms-message') {
      const open = s.breakouts.open;
      if (!open) throw new ConflictError('No rooms are open.', { context: ctx });
      s = { ...s, breakouts: { ...s.breakouts, open: { ...open, message: { text: a.text, at } } } };
    } else if (a.type === 'rooms-pause') {
      // One room's notes held, or carried on, while the call's are on. The call's notes don't change, and only that room hears about it.
      const open = s.breakouts.open;
      if (!open) throw new ConflictError('No rooms are open.', { context: ctx });
      const room = open.rooms.find((r) => r.id === a.roomId);
      if (!room) throw new ValidationError('That room isn’t open.', { context: ctx });
      if ((room.pauses.at(-1)?.paused === true) !== a.paused) {
        if (a.paused && s.notes.status !== 'on') throw new ConflictError('Notes aren’t on, so there’s nothing to pause.', { context: ctx });
        const pause = { at: exact, paused: a.paused };
        s = { ...s, breakouts: { ...s.breakouts, open: { ...open, rooms: open.rooms.map((r) => (r.id === room.id ? { ...r, pauses: [...r.pauses, pause] } : r)) } } };
        s = notice(s, a.paused ? 'The organizer paused notes in this room. Nothing said here is transcribed or sent to the AI until they resume.'
          : 'The organizer resumed notes in this room. Everyone here can see that.', 'notes', room.id);
      }
    } else if (a.type === 'rooms-visit') {
      // The organizer is in one room at a time, or the main room: only a room of this call that's open now.
      const open = s.breakouts.open;
      if (!open) throw new ConflictError('No rooms are open.', { context: ctx });
      if (a.roomId !== null && !open.rooms.some((r) => r.id === a.roomId)) throw new ValidationError('That room isn’t open.', { context: ctx });
      s = { ...s, breakouts: { ...s.breakouts, open: { ...open, visiting: a.roomId } } };
    } else if (a.type === 'deny') {
      if (!s.people.some((j) => j.identity === a.identity && j.status === 'waiting')) throw new ValidationError('That person isn’t asking to join.', { context: { callId } });
      s = withPerson(s, a.identity, (j) => ({ ...j, status: 'denied' }));
    } else if (a.type === 'remove') {
      // Every connection of theirs is out: their passes stop working here, LiveKit disconnects them, and the
      // host's browser takes them out of the group, so the keys move on without them.
      const target = s.people.find((j) => j.identity === a.identity);
      // Nobody removes the organizer (someone standing in hosts their call), and whoever hosts doesn't remove themselves.
      if (target?.role === 'host') throw new ValidationError('Nobody can remove the organizer.', { context: { callId } });
      if (a.identity === s.host) throw new ValidationError('You can’t remove yourself. Leave the call instead.', { context: { callId } });
      if (!target) throw new ValidationError('That person isn’t in this call.', { context: { callId } });
      gone = s.people.filter((j) => j.person === target.person && j.status === 'in').map((j) => j.identity);
      removed = seatOf(seatKey(o, callId), target);
      s = await sharesEnd(o, c, {
        ...s, removed: [...s.removed, target.person],
        people: s.people.map((j) => (j.person === target.person ? { ...j, status: j.status === 'in' ? 'left' : j.status === 'waiting' ? 'denied' : j.status, left: j.status === 'in' ? Date.now() : j.left } : j))
      }, gone, tenthsIn(row.started_at));
      // On the invite because they were let in from the link (in this run of the call or an earlier one): the organizer
      // removing them takes that back, so they don't get the notes, once no other connection of theirs is still in the
      // call. The invite is the organizer's alone: someone standing in only takes them out of the call.
      const email = target.email;
      const stillIn = (e: string) => s.people.some((j) => j.email === e && j.status === 'in' && !s.removed.includes(j.person));
      if (v.isOrganizer && email && !stillIn(email) && await addedFromLink(o, c, row.meeting_item_id, email)) {
        await takeOffInvite(o, c, { meetingId: row.meeting_item_id, noteId: s.notes.noteId }, email);
        invite?.gone.push(email);
        clog.info('taken off the invite', { callId, meetingId: row.meeting_item_id, noteId: s.notes.noteId });
      }
    } else if (a.type === 'lock') {
      locked = a.on;
      await exec(c, 'UPDATE calls SET locked = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, locked]);
    } else if (a.type === 'ring') {
      // Nobody new can come into a locked call, so nobody is rung into one. Someone already here has no need of a ring.
      if (locked) throw new ConflictError('This call is locked, so nobody new can join. Unlock it to ring someone.', { context: ctx });
      const here = new Set(s.people.flatMap((j) => (j.status === 'in' && j.email ? [j.email.toLowerCase()] : [])));
      invite?.add.push(...await rings.ring(o, c, { meetingId: row.meeting_item_id, noteId: s.notes.noteId }, a.emails.filter((e) => !here.has(e))));
    } else if (a.type === 'stop-ring') {
      await rings.stop(o, c, row.meeting_item_id, a.ringId);
    } else {
      s = await changeCapture(v, c, row, s, a, exact);
    }
    const moved = s.people.filter((j) => j.status === 'in' && j.role !== 'host' && placeOf(settled, j) !== placeOf(s, j)).length;
    // Whoever left the main room (sent to a room, or the organizer visiting one) takes their share with them: it stops
    // there, and in the notes. Sharing again once they're back is a new share.
    s = await sharesEnd(o, c, s, s.people.filter((j) => j.status === 'in' && placeOf(settled, j) === MAIN_PLACE && placeOf(s, j) !== MAIN_PLACE).map((j) => j.identity), exact);
    s = (await saveSettled(o, c, callId, state, relocate(settled, s, Date.now(), row.mls_seq))).s;
    // Anyone sent to another part of the call (or back) moves group: their browser and the organizer's read the log again.
    clog.info('call action', {
      callId, action: a.type, notes: s.notes.status, screens: screensOf(s).live, segment: s.notes.segment, asks: s.notes.asks.filter((x) => x.state === 'asking').length, unavailable: s.notes.unavailable.length,
      connections: gone.length, spotlight: Boolean(s.spotlight), rooms: s.breakouts.open?.rooms.length ?? 0, visiting: Boolean(s.breakouts.open?.visiting), roomsHeld: s.breakouts.held.length, moved,
      pointing: s.pointing, othersPointOff: s.othersPointOff.length
    });
    if (invite) invite.made = s.workspace.made;
    // Who has each room's board changes only as people move or rooms open or close, by time or by hand.
    const shifted = moved > 0 || a.type === 'rooms-open' || a.type === 'rooms-close' || a.type === 'rooms-move' || a.type === 'rooms-visit' || (state.breakouts.open !== null) !== (s.breakouts.open !== null);
    // Rooms that closed meanwhile (their time ran out as this was saved) change everyone's view, whatever this was.
    return { room: row.room_name, gone, moved, removed, board: s.board, shifted, only: shifted ? null : only };
  }).then(async ({ room, gone, moved, removed, board, shifted, only }) => {
    if (room) for (const who of gone) await o.livekit.removeParticipant(room, who).catch((e: unknown) => clog.info('removed person already gone', { callId, err: e }));
    // What the call gave them in a workspace goes with them.
    if (removed) await endSeat(o, callId, removed);
    // So does a place in a home made for the call that the invite gave them; someone rung is on the invite, so in it. And a
    // room's board they had by address, as they don't get that room's notes.
    if (invite) await space.followHome(o, invite.meetingId, invite, invite.made);
    if (invite?.gone.length) await boards.offRoomBoards(o, board, invite.gone);
    // Each room's board goes with whoever's in its room before anyone's told, so whoever's moved out has lost it by then.
    if (shifted) await syncRoomBoards({ organizer: o, callId });
    if (ready?.main) void syncBoardSeats({ organizer: o, callId });
    await tellRoom(o, room, callId, { call: true, log: a.type === 'remove' || a.type === 'deny' || moved > 0 }, only ?? undefined);
    if (board.landing) void landRooms({ organizer: o, callId });
  }, async (e: unknown) => {
    if (ready) await boards.dropRoomsReady(o, callId, ready);
    throw e;
  });
  return view(v, o.pool, callId);
}

/**
 * The organizer stops what someone shares, for everyone (docs: Calls and recordings › Shared screens): LiveKit mutes the picture
 * and its sound, on whichever of their connections it is, as it mutes a microphone, and everyone who could see it is told who
 * stopped whose. The organizer's own browser says it in its own words. LiveKit is asked with nothing of the call held; the
 * call's row is held only to tell everyone. Someone sharing nothing, or not in the call, has nothing to stop (409).
 */
async function stopShare(v: Viewer, callId: string, seat: string): Promise<CallState> {
  const o = v.organizer;
  const ctx = { callId, action: 'share-stop' };
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live' || !row.room_name) throw new ConflictError('This call has ended.', { context: ctx });
  stillHosting(v, state, ctx);
  const key = seatKey(o, callId);
  const theirs = state.people.filter((j) => j.status === 'in' && seatOf(key, j) === seat);
  const tracks = theirs.length ? (await o.livekit.sharing(row.room_name)).filter((t) => !t.muted && theirs.some((j) => j.identity === t.identity)) : [];
  const sharer = theirs.find((j) => tracks.some((t) => t.identity === j.identity));
  if (!sharer) throw new ConflictError('They aren’t sharing anything.', { context: { ...ctx, connections: theirs.length } });
  for (const t of tracks) await o.livekit.muteTrack(row.room_name, t.identity, t.sid);
  const organizer = firstName((await me(o)).name);
  const closed = await tx(o.pool, async (c) => {
    const held = await load(o, c, callId, true);
    if (held.row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
    const s = settle(held.state, held.row);
    const j = s.people.find((x) => x.identity === sharer.identity) ?? sharer;
    return (await saveSettled(o, c, callId, held.state, notice(s, `${organizer} stopped ${firstName(j.name)}’s share.`, 'people', placeOf(s, j), v.pass.identity))).closed;
  });
  clog.info('host control', { callId, action: 'share-stop', tracks: tracks.length });
  return afterClosing({ organizer: o, callId }, closed, async () => {
    await tellRoom(o, row.room_name, callId, { call: true, log: false });
    return view(v, o.pool, callId);
  });
}

/** Whether rooms can open as asked: none are open, and everyone sent to one is invited, once. */
function checkRooms(s: Stored, a: Extract<CallAction, { type: 'rooms-open' }>, meeting: Pick<MeetingManifest, 'guests'>, ctx: Record<string, string>): void {
  if (s.breakouts.open) throw new ConflictError('Rooms are already open.', { context: ctx });
  const invited = new Set(meeting.guests.map((e) => e.toLowerCase()));
  const placed = a.rooms.flatMap((r) => r.emails);
  if (placed.some((e) => !invited.has(e))) throw new ValidationError('Only people invited to this call can be sent to a room.', { context: { ...ctx, rooms: a.rooms.length } });
  if (new Set(placed).size !== placed.length) throw new ValidationError('Someone is in two rooms. Each person goes to one room.', { context: { ...ctx, rooms: a.rooms.length } });
}

/**
 * What rooms opening with a board each, or one they share, need, made with nothing of the call held (callBoards.ts's
 * `prepareRooms`), from the call as it stands: whoever's going to each room, by seat, is seated on its board now. What can't
 * open is refused first, so nothing is made for rooms that won't open.
 */
async function roomsReady(v: Viewer, callId: string, a: Extract<CallAction, { type: 'rooms-open' }>): Promise<boards.RoomsReady> {
  const o = v.organizer;
  const ctx = { callId, action: a.type };
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
  const s = settle(state, row);
  stillHosting(v, s, ctx);
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  checkRooms(s, a, meeting.manifest, ctx);
  const going = (emails: string[]) => seatsOf(o, callId, s.people.filter((j) => j.status === 'in' && j.role !== 'host' && j.email !== undefined && emails.includes(j.email.toLowerCase())));
  const reader = await readerInCall(v);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const main: boards.MainBoardFor = {
    o, callId, s, meeting: meeting.manifest, here: hereIn(o, callId, s), known: knownIn(o, callId, s), maker: { name: mine?.name ?? v.pass.name, email: mine?.email ?? '' }, asOrganizer: v.isOrganizer
  };
  return boards.prepareRooms({ rooms: a.rooms.map((r) => ({ name: r.name, people: going(r.emails) })), board: a.board, main, ids: a.rooms.map(() => id128()), by: space.controllerOf(v, reader) });
}

/** The call's boards with what rooms opening made: each room's board open in it, and a shared board open in the main room. */
function withRoomsReady(board: CallBoards, ready: boards.RoomsReady, ids: string[]): CallBoards {
  if (ready.each) {
    const each = ready.each;
    const made = ids.flatMap((room, k) => { const documentId = each.documentIds[k]; return documentId ? [{ room, documentId }] : []; });
    return {
      ...board,
      open: { ...board.open, ...Object.fromEntries(made.map((m) => [m.room, { workspaceId: each.workspaceId, documentId: m.documentId, by: ready.by, timer: null, vote: null }])) },
      rooms: [...board.rooms, ...made.map((m) => ({ workspaceId: each.workspaceId, documentId: m.documentId, room: m.room, kept: false }))]
    };
  }
  const main = ready.main;
  if (!main) return board;
  return { ...board, open: { ...board.open, [MAIN_PLACE]: { workspaceId: main.workspaceId, documentId: main.documentId, by: ready.by, timer: null, vote: null } }, letIn: [...board.letIn, main.entry] };
}

export const state = (v: Viewer, callId: string) => view(v, v.organizer.pool, callId);
