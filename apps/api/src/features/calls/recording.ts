import { MAIN_PLACE, type CallAction, type CallState, type ShareStarted } from '@alcove/api';
import type { Owner } from '../../context';
import { id128 } from '../../crypto';
import { tx, type Db } from '../../db';
import { ConflictError, ForbiddenError, UnavailableError, ValidationError, notFound } from '../../errors';
import { me } from '../account/account';
import { appendPiece, createRecording, setRecordingState, type Piece } from '../recordings/audio';
import * as capture from './capture';
import * as models from '../notes/models';
import { MeetingManifest } from '../meetings/service';
import type { Loaded } from '../../vault';
import { getItem } from '../../vault';
import { blankNote, createNoteWithRecording } from '../notes/service';
import { mainScribeOf, placeAt, placeOf, readersAt } from './places';
import { scribeAt } from './scribes';
import * as screens from '../recordings/screens';
import * as transcripts from '../recordings/transcripts';
import { log } from '../../log';
import { capturing, load, notice, roomPausesOf, roomsOpenAt, save, screenChanged, settle, sharesEnd, tenthsIn, trimShares, type Row, type Stored } from './state';
import { requireIn, speakersIn, type Viewer } from './participants';
import { stillHosting } from './permissions';
import { view } from './read-model';
import { nudge } from './notifications';

const clog = log.child({ component: 'calls' });

/**
 * Notes on, or resumed, `at` seconds into the call: the first time a note and its recording are created, keeping what
 * the call was set to keep; after that a new segment starts.
 * Anyone who asked for notes has their answer: yes.
 */
export async function startNotes(o: Owner, db: Db, s: Stored, meeting: Loaded<MeetingManifest>, at: number, by: capture.CaptureChange['by']): Promise<Stored> {
  const asks = capture.answered(s.notes.asks);
  if (s.notes.recordingId) {
    await setRecordingState(o, db, s.notes.recordingId, 'recording');
    const segment = s.notes.segment + 1;
    return { ...s, notes: { ...s.notes, status: 'on', everOn: true, segment, segmentFrom: at, history: [...s.notes.history, { at, status: 'on', by, segment }], asks, unavailable: [] } };
  }
  const startedAt = new Date();
  const { keepTranscript, keepRecording } = meeting.manifest.choices;
  const { noteId, recordingId } = await createNoteWithRecording(o, db,
    (rid) => blankNote({ kind: 'call', title: meeting.manifest.title, startedAt, recordingId: rid, meetingId: meeting.itemId, invited: meeting.manifest.guests, keep: { transcript: keepTranscript, recording: keepRecording } }),
    (nid) => createRecording(o, db, nid, startedAt));
  return { ...s, notes: { ...s.notes, status: 'on', everOn: true, noteId, recordingId, segment: 0, segmentFrom: at, history: [...s.notes.history, { at, status: 'on', by, segment: 0 }], asks, unavailable: [] } };
}

/**
 * Notes paused or off, `at` seconds into the call: the recording stops taking audio until notes are on again. What
 * the host's browser couldn't capture is forgotten with every change: it says again once notes are back on, so
 * nobody is told something isn't captured when it is. Turning notes off keeps no share any more: what was kept so far
 * stays, and sharing on keeps nothing more. Pausing holds them with everything else.
 */
async function stopNotes(o: Owner, db: Db, s: Stored, at: number, status: 'paused' | 'off'): Promise<Stored> {
  if (s.notes.recordingId && s.notes.status === 'on') await setRecordingState(o, db, s.notes.recordingId, 'paused');
  const kept = status === 'off' ? s.shares.filter((x) => x.until === null && x.keep) : [];
  if (kept.length && s.notes.recordingId) await screens.endShares(o, db, s.notes.recordingId, kept.filter((x) => x.recorded).map((x) => x.id), at * 1000, s.notes.segment);
  const unkept = kept.length ? screenChanged(s, { ...s, shares: s.shares.map((x) => (kept.includes(x) ? { ...x, keep: false } : x)) }, at) : s;
  return { ...unkept, notes: { ...unkept.notes, status, history: [...s.notes.history, { at, status, by: 'organizer', segment: s.notes.segment }], unavailable: [] } };
}

type CaptureAction = Extract<CallAction, { type: 'notes' | 'pause' | 'resume' | 'request-notes' | 'decline-notes' | 'unavailable' | 'model' }>;

/**
 * What the call captures, changed (features/calls/capture.ts). Only the organizer turns notes on or off, pauses and resumes
 * them, chooses the model for the notes, says not now to an ask, and says what their browser can't capture (features/calls/routes.ts
 * lets nobody else through). Anyone else in the call asks for notes while they're off or paused, or takes the ask
 * back. Turning notes on, or resuming, says yes to every ask.
 */
export async function changeCapture(v: Viewer, c: Db, row: Row, s: Stored, a: CaptureAction, at: number): Promise<Stored> {
  const o = v.organizer;
  const ctx = { callId: row.call_id, action: a.type, notes: s.notes.status };
  const meeting = () => getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  if (a.type === 'notes') {
    if (a.on && s.notes.status !== 'on') {
      const on = await startNotes(o, c, s, await meeting(), at, 'organizer');
      return notice(on, 'The organizer turned on notes. Everyone here can see that.');
    }
    if (!a.on && s.notes.status !== 'off') {
      const { keepTranscript, keepRecording } = (await meeting()).manifest.choices;
      return notice(await stopNotes(o, c, s, at, 'off'), keepTranscript && keepRecording ? 'The organizer turned off notes. What was written so far is kept.' : 'The organizer turned off notes. What was captured so far still goes into the notes.');
    }
    return s;
  }
  if (a.type === 'pause') {
    if (s.notes.status === 'paused') return s;
    if (s.notes.status !== 'on') throw new ConflictError('Notes aren’t on, so there’s nothing to pause.', { context: ctx });
    return notice(await stopNotes(o, c, s, at, 'paused'), 'The organizer paused notes. Nothing is recorded, transcribed or sent to the AI until they resume.');
  }
  if (a.type === 'resume') {
    if (s.notes.status === 'on') return s;
    if (s.notes.status !== 'paused') throw new ConflictError('Notes are off. Turn them on instead.', { context: ctx });
    return notice(await startNotes(o, c, s, await meeting(), at, 'organizer'), 'The organizer resumed notes. Everyone here can see that.');
  }
  if (a.type === 'unavailable') {
    // What the host's browser can't capture now (no microphone, or a browser that can't record or listen). It
    // only means something while notes are on; one that arrives after a pause or notes off is from before it.
    if (s.notes.status !== 'on') return s;
    return { ...s, notes: { ...s.notes, unavailable: [...new Set(a.parts)] } };
  }
  if (a.type === 'model') {
    if (a.model === s.notes.model) return s;
    const changed = { ...s, notes: { ...s.notes, model: a.model } };
    return notice(changed, (await models.isPrivate(o.cfg, a.model))
      ? 'The organizer changed the AI model that writes the notes. Everyone here can see that.'
      : 'The organizer chose an unencrypted AI model for the notes. It runs outside a secure enclave, so what it reads isn’t private. Everyone here can see that.');
  }
  if (a.type === 'request-notes') {
    if (v.isOrganizer) throw new ValidationError('You can turn notes on yourself.', { context: ctx });
    // One ask each: asking again while asking changes nothing, and taking it back forgets it.
    const others = s.notes.asks.filter((x) => x.person !== v.pass.person);
    if (!a.up) return { ...s, notes: { ...s.notes, asks: others } };
    if (s.notes.status === 'on') throw new ConflictError('Notes are already on.', { context: ctx });
    if (s.notes.asks.some((x) => x.person === v.pass.person && x.state === 'asking')) return s;
    return { ...s, notes: { ...s.notes, asks: [...others, { id: id128(), person: v.pass.person, at: Date.now(), state: 'asking' }] } };
  }
  const ask = s.notes.asks.find((x) => x.id === a.requestId && x.state === 'asking');
  if (!ask) throw new ValidationError('That ask for notes isn’t open.', { context: ctx });
  return { ...s, notes: { ...s.notes, asks: s.notes.asks.map((x) => (x.id === ask.id ? { ...x, state: 'declined' as const } : x)) } };
}

export async function audio(v: Viewer, callId: string, piece: Piece): Promise<CallState> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const ctx = { callId, segment: piece.segment, seq: piece.seq, currentSegment: state.notes.segment };
  stillHosting(v, state, ctx, mainScribeOf(state));
  const into = capture.mayCapture(capturing(row, state), 'audio', ctx);
  if (piece.segment !== state.notes.segment) throw new ConflictError('That audio belongs to an earlier part of the recording.', { context: ctx });
  await appendPiece(o, into.recordingId, piece);
  return view(v, o.pool, callId);
}

/**
 * Speech heard in the call, into the live transcript under whoever said it while notes are on: by the browser of whoever
 * hosts in the main room, by a breakout room's scribe in the room (someone in the call, or just gone, for a clip still on
 * its way). It's placed in the part of the call its speaker was in when they began (`began`, ms on this server's clock):
 * a clip still on its way when someone moves stays where it was said. Said while rooms were open, it's kept for the
 * people there then; a room's lines stay until the call ends, a room that has closed since included, and go into its
 * section of the notes.
 */
export async function transcribe(v: Viewer, callId: string, clip: transcripts.Clip, speaker: string, began: number, count: () => void): Promise<CallState> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const nowMs = Date.now();
  const s = settle(state, row, nowMs);
  const ctx = { callId, segment: clip.segment, atMs: clip.atMs, currentSegment: state.notes.segment, agoMs: nowMs - began };
  const into = capture.mayCapture(capturing(row, state), 'speech', ctx);
  if (clip.segment !== state.notes.segment) throw new ConflictError('That speech belongs to an earlier part of the recording.', { context: ctx });
  const who = s.people.find((j) => j.identity === speaker);
  if (!who || (who.status !== 'in' && who.status !== 'left')) throw new ValidationError('That speech isn’t from anyone in this call.', { context: ctx });
  // Nobody's speech begins before they came into the call.
  const t0 = Math.max(began, who.since);
  const place = placeAt(s, who, t0);
  if (place === undefined) throw new ConflictError('Where that speech was said can’t be told any more.', { context: { ...ctx, why: 'moved since' } });
  // One browser hears each part of the call, and only it sends what's said there: the main room whoever hosts now, a
  // breakout room its scribe when the speech began (scribes.ts), even if that's changed since. A connection that hosted
  // before is told it's out of date, so what it still sends stops there quietly.
  const term = place === MAIN_PLACE ? undefined : scribeAt(s, place, t0);
  if ((place === MAIN_PLACE ? mainScribeOf(s) : term?.identity) !== v.pass.identity) {
    const refused = { ...ctx, room: place !== MAIN_PLACE ? 1 : 0, term: term?.term ?? null };
    if (v.stale) throw new ConflictError('You’re not hosting this call from here any more.', { context: { ...refused, why: 'not host' }, level: 'info' });
    throw new ForbiddenError(place === MAIN_PLACE ? 'Only the host’s browser sends what’s said in the main room.' : 'Only the room’s scribe sends what’s said in a breakout room.', { context: refused });
  }
  // Counted against the voice's and the account's allowances only now: speech refused above costs nobody's.
  count();
  // The gate again, for the part of the call it was said in: a room the organizer paused takes nothing.
  capture.mayCapture(capturing(row, s, place), 'speech', { ...ctx, why: 'room paused' });
  // A breakout room's speech is taken only if the room was capturing when it began, and placed in the segment by this
  // server's clock: its scribe's browser counts from when it loaded, not from when the segment began.
  let atMs: number | undefined;
  if (place !== MAIN_PLACE) {
    const said = (t0 - row.started_at.getTime()) / 1000;
    if (!capture.roomCapturingAt(s.notes.history, roomPausesOf(s, place), said)) {
      throw new ConflictError('Notes were paused in this room when that was said.', { context: { ...ctx, why: 'said while paused' } });
    }
    atMs = Math.max(0, Math.round((said - s.notes.segmentFrom) * 1000));
  }
  const readers = roomsOpenAt(s, row, t0) ? readersAt(s, place, t0) : undefined;
  await transcripts.hear(o, into, clip, { speaker, ...(place !== MAIN_PLACE ? { room: place } : {}), ...(readers ? { readers } : {}), began: t0, ...(atMs === undefined ? {} : { atMs }) });
  await nudge(o, row.room_name, callId, { call: true, log: false });
  return view(v, o.pool, callId);
}

/* ---------- shared screens: each share, and the video of those kept for the notes (features/recordings/screens.ts) ---------- */

/**
 * Someone starting to share their screen, from their own browser once they've picked what to share: whether it goes in
 * the notes (`notes`). Refused with the notes while they're off. It's kept only from the main room, with notes on or
 * paused (its video waits until they're resumed). A share of theirs still going ends: each person shares one screen at
 * a time. Everyone sees it in the call's `shares`.
 */
export async function startShare(v: Viewer, callId: string, notes: boolean): Promise<ShareStarted> {
  requireIn(v, 'share');
  const o = v.organizer;
  const r = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: { callId } });
    const exact = tenthsIn(row.started_at);
    const ctx = { callId, notes: state.notes.status, asked: notes };
    if (notes && state.notes.status === 'off') throw new ConflictError('Turn on notes first: only then can a share go in them.', { context: ctx });
    // The organizer decides whether shares may go in the notes at all (the call's choices); each presenter, for theirs.
    const { allowScreens } = (await getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting')).manifest.choices;
    if (notes && !allowScreens) throw new ConflictError('The organizer keeps shared screens out of these notes.', { context: ctx });
    // Where they are now, with rooms whose time is up closed.
    const settled = settle(state, row);
    const mine = settled.people.find((j) => j.identity === v.pass.identity && j.status === 'in');
    if (!mine) throw new ForbiddenError('Join the call to share your screen.', { context: ctx });
    let s = await sharesEnd(o, c, state, [v.pass.identity], exact);
    const keep = notes && s.notes.status !== 'off' && placeOf(settled, mine) === MAIN_PLACE;
    const id = id128();
    const recordingId = s.notes.recordingId;
    if (recordingId) {
      const presenter = speakersIn(s, await me(o, c))(v.pass.identity);
      await screens.startShare(o, c, recordingId, id, { keep, meta: { identity: v.pass.identity, ...(presenter ? { presenter } : {}) }, atMs: exact * 1000, segment: s.notes.segment });
    }
    s = screenChanged(s, { ...s, shares: trimShares([...s.shares, { id, identity: v.pass.identity, keep, recorded: recordingId !== null, from: exact, until: null }]) }, exact);
    await save(o, c, callId, s);
    clog.info('share started', { ...ctx, keep, segment: s.notes.segment, role: v.pass.role });
    return { id, keep, room: row.room_name };
  });
  await nudge(o, r.room, callId, { call: true, log: false });
  return { share: r.id, keep: r.keep, state: await view(v, o.pool, callId) };
}

/** Who LiveKit said is sharing a screen, by room and identity, for a few seconds: pieces come every five. */
const sharing = new Map<string, number>();

const SHARE_SEEN_MS = 10_000;

const NOT_YOURS = 'That isn’t a screen you’re sharing in this call.';

/** Whether `identity` has a screen up in the call's room now, as LiveKit sees its tracks. Never a camera. */
async function sharingNow(o: Owner, roomName: string, identity: string): Promise<boolean> {
  const id = `${roomName}|${identity}`;
  if ((sharing.get(id) ?? 0) > Date.now()) return true;
  const shares = await o.livekit.screenShares(roomName).catch((e: unknown) => {
    throw new UnavailableError('We couldn’t check the shared screen with the call’s media server. Try again in a moment.', { cause: e });
  });
  const yes = shares.some((x) => x.identity === identity);
  if (yes) {
    if (sharing.size > 10_000) sharing.clear();
    sharing.set(id, Date.now() + SHARE_SEEN_MS);
  }
  return yes;
}

/**
 * A piece of a kept share's video, from its presenter's own browser. Only the presenter's own share that they said goes
 * in the notes, while LiveKit lists a screen they're sharing in the call's room (403 otherwise); one that's unknown isn't
 * found (404). One that has ended (they stopped it, left, or the call ended) still takes pieces of the segment it ended
 * in for screens.SHARE_TAIL_MS after it ended, since the browser hands its last piece over as it stops, even from
 * someone who has just left; after that it isn't found (404), unless it's a piece already stored (a retry), which
 * changes nothing. While notes are paused or off it's refused (409), as is a piece from an earlier segment of the
 * recording, or a different piece at a place already stored. Once the presenter is out of the call, or the call has
 * ended, the answer shows only that.
 */
export async function appendScreen(v: Viewer, callId: string, shareId: string, piece: screens.Piece): Promise<CallState> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const ctx = { callId, segment: piece.segment, seq: piece.seq, currentSegment: state.notes.segment, role: v.pass.role };
  // Someone let in, who may have left since: the tail of a share is theirs to send.
  const mine = state.people.find((j) => j.identity === v.pass.identity);
  if (!v.inCall && mine?.status !== 'left') throw new ForbiddenError('Wait until the host lets you in.', { context: { ...ctx, what: 'screen' } });
  const share = state.shares.find((x) => x.id === shareId);
  if (!share) throw notFound('That share', ctx);
  if (share.identity !== v.pass.identity) throw new ForbiddenError(NOT_YOURS, { context: ctx });
  const recordingId = state.notes.recordingId;
  if (!share.recorded || !recordingId) throw new ForbiddenError('That share doesn’t go in the notes.', { context: ctx });
  const answer = () => view(row.state === 'live' && v.inCall ? v : { ...v, inCall: false }, o.pool, callId);
  // How much it may hold: by how long it has been up, to now or to its end.
  const budget = () => screens.shareBudget((share.until ?? (Date.now() - row.started_at.getTime()) / 1000) - share.from);
  // A retry of a piece already stored is fine whatever has happened since.
  if (await screens.pieceStored(o, recordingId, shareId, piece)) return answer();
  // Notes turned off mid-share stop keeping it (state) but it was kept, and its presenter's last piece is still its tail.
  const ended = share.keep ? null : await screens.shareEnd(o, recordingId, shareId, row.started_at);
  if (!share.keep && !ended?.keep) throw new ForbiddenError('That share doesn’t go in the notes.', { context: ctx });
  if (!share.keep || share.until !== null || row.state !== 'live' || !v.inCall) {
    // Its tail: the presenter's last piece, arriving just after the share (or the call) ended, or they left.
    const end = ended ?? await screens.shareEnd(o, recordingId, shareId, row.started_at);
    const late = end ? Date.now() - end.at : null;
    if (!end || !end.keep || late === null || late > screens.SHARE_TAIL_MS) throw notFound('That share', { ...ctx, ended: 1, lateMs: late });
    if (piece.segment !== end.segment) throw new ConflictError('That video belongs to an earlier part of the recording.', { context: ctx });
    await screens.appendPiece(o, recordingId, shareId, piece, budget(), share.keep ? 'ended' : 'notes-off');
    clog.debug('share piece taken after it ended', { ...ctx, lateMs: late });
    return answer();
  }
  const into = capture.mayCapture(capturing(row, state), 'screen', ctx);
  if (piece.segment !== state.notes.segment) throw new ConflictError('That video belongs to an earlier part of the recording.', { context: ctx });
  // Going: only while LiveKit lists a screen of theirs, so nobody puts video in the notes without sharing it in the call.
  if (!row.room_name || !(await sharingNow(o, row.room_name, v.pass.identity))) throw new ForbiddenError(NOT_YOURS, { context: { ...ctx, why: 'not sharing' } });
  await screens.appendPiece(o, into.recordingId, shareId, piece, budget());
  return answer();
}

/** The presenter's browser says one of its shares ended: its video stops there in the notes. Only their own; ending one again changes nothing. */
export async function shareEnded(v: Viewer, callId: string, shareId: string): Promise<CallState> {
  requireIn(v, 'share-ended');
  const o = v.organizer;
  const room = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: { callId } });
    const share = state.shares.find((x) => x.id === shareId);
    if (!share) throw notFound('That share', { callId });
    if (share.identity !== v.pass.identity) throw new ForbiddenError(NOT_YOURS, { context: { callId } });
    if (share.until !== null) return null;
    await save(o, c, callId, await sharesEnd(o, c, state, [{ share: shareId }], tenthsIn(row.started_at)));
    return { name: row.room_name };
  });
  if (room) {
    clog.debug('share ended', { callId, role: v.pass.role });
    await nudge(o, room.name, callId, { call: true, log: false });
  }
  return view(v, o.pool, callId);
}
