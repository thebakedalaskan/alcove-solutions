import { MAIN_PLACE, type CallAction, type CallState, type ScreenFrameReceipt } from '@alcove/api';
import type { Owner } from '../../context';
import { id128 } from '../../crypto';
import { tx, type Db } from '../../db';
import { ConflictError, ForbiddenError, UnavailableError, ValidationError } from '../../errors';
import { appendPiece, createRecording, setRecordingState, type Piece } from '../recordings/audio';
import * as capture from './capture';
import { MeetingManifest } from '../meetings/service';
import type { Loaded } from '../../vault';
import { getItem } from '../../vault';
import { blankNote, createNoteWithRecording } from '../notes/service';
import { mainScribeOf, placeAt, readersAt } from './places';
import { scribeAt } from './scribes';
import * as screens from '../recordings/screens';
import * as transcripts from '../recordings/transcripts';
import { log } from '../../log';
import { capturing, load, notice, roomPausesOf, roomsOpenAt, save, settle, sharesEnd, tenthsIn, type Row, type Stored } from './state';
import { requireIn, type Viewer } from './participants';
import { stillHosting } from './permissions';
import { view } from './read-model';
import { nudge } from './notifications';

const clog = log.child({ component: 'calls' });

/**
 * Notes on, or resumed, `at` seconds into the call: the first time a note and its recording are created, keeping what
 * the call was set to keep, with shared screens read from then on if it was set to; after that a new segment starts.
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
  const { keepTranscript, keepRecording, readScreens } = meeting.manifest.choices;
  const { noteId, recordingId } = await createNoteWithRecording(o, db,
    (rid) => blankNote({ kind: 'call', title: meeting.manifest.title, startedAt, recordingId: rid, meetingId: meeting.itemId, invited: meeting.manifest.guests, keep: { transcript: keepTranscript, recording: keepRecording } }),
    (nid) => createRecording(o, db, nid, startedAt));
  const sc = s.notes.screens;
  const screensNow = readScreens && !sc.on ? { ...sc, on: true, history: [...sc.history, { at, on: true, segment: 0, by }] } : sc;
  return { ...s, notes: { ...s.notes, status: 'on', everOn: true, noteId, recordingId, segment: 0, segmentFrom: at, screens: screensNow, history: [...s.notes.history, { at, status: 'on', by, segment: 0 }], asks, unavailable: [] } };
}

/**
 * Notes paused or off, `at` seconds into the call: the recording stops taking audio until notes are on again. What
 * the host's browser couldn't capture is forgotten with every change: it says again once notes are back on, so
 * nobody is told something isn't captured when it is. Turning notes off stops shared screens being read too; pausing
 * holds them with everything else.
 */
async function stopNotes(o: Owner, db: Db, s: Stored, at: number, status: 'paused' | 'off'): Promise<Stored> {
  if (s.notes.recordingId && s.notes.status === 'on') await setRecordingState(o, db, s.notes.recordingId, 'paused');
  const sc = s.notes.screens;
  const screensNow = status === 'off' && sc.on ? { ...sc, on: false, history: [...sc.history, { at, on: false, segment: s.notes.segment, by: 'organizer' as const }] } : sc;
  return { ...s, notes: { ...s.notes, status, screens: screensNow, history: [...s.notes.history, { at, status, by: 'organizer', segment: s.notes.segment }], unavailable: [] } };
}

type CaptureAction = Extract<CallAction, { type: 'notes' | 'pause' | 'resume' | 'request-notes' | 'decline-notes' | 'unavailable' | 'screens' }>;

/**
 * What the call captures, changed (features/calls/capture.ts). Only the organizer turns notes on or off, pauses and resumes
 * them, has shared screens read or stops it, says not now to an ask, and says what their browser can't capture (features/calls/routes.ts
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
      return notice(on, on.notes.screens.on ? 'The organizer turned on notes, and what anyone shares is read for them. Everyone here can see that.' : 'The organizer turned on notes. Everyone here can see that.');
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
  if (a.type === 'screens') {
    const sc = s.notes.screens;
    if (a.on === sc.on) return s;
    // Frames go into the notes, beside what was said, so they're read only while there are notes to read them into.
    if (a.on && s.notes.status === 'off') throw new ConflictError('Turn on notes first: shared screens are read for the notes.', { context: ctx });
    if (a.on && s.notes.noteId && await screens.full(o, c, s.notes.noteId)) throw new ConflictError(FULL, { context: { ...ctx, max: o.cfg.SCREEN_FRAMES_MAX } });
    const next: Stored = { ...s, notes: { ...s.notes, screens: { ...sc, on: a.on, history: [...sc.history, { at, on: a.on, segment: s.notes.segment, by: 'organizer' }] } } };
    return notice(next, a.on ? 'The organizer turned on shared screens in the notes. What anyone shares is read for them.' : 'The organizer turned off shared screens in the notes. What was shared before is kept.');
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

/* ---------- shared screens: frames from each presenter's own browser, while screen notes are on ---------- */

/** A frame as its presenter's browser sent it: which share, when it was taken (ms, on this server's clock), the JPEG and its size. */
export interface FrameUpload { share: string; takenAt: number; jpeg: Uint8Array; width: number; height: number }

/** Shares LiveKit said someone has up, by room, identity and track, for a few seconds: frames come every few seconds. */
const sharing = new Map<string, number>();

const SHARE_SEEN_MS = 10_000;

/** Whether `identity` is sharing the screen `share` in the call's room now, as LiveKit sees its tracks. Never a camera. */
async function ownShare(o: Owner, roomName: string, identity: string, share: string): Promise<boolean> {
  const id = `${roomName}|${identity}|${share}`;
  if ((sharing.get(id) ?? 0) > Date.now()) return true;
  const shares = await o.livekit.screenShares(roomName).catch((e: unknown) => {
    throw new UnavailableError('We couldn’t check the shared screen with the call’s media server. Try again in a moment.', { cause: e });
  });
  const yes = shares.some((x) => x.identity === identity && x.sid === share);
  if (yes) {
    if (sharing.size > 10_000) sharing.clear();
    sharing.set(id, Date.now() + SHARE_SEEN_MS);
  }
  return yes;
}

/**
 * A frame of someone's own shared screen, into the call's notes, while screen notes are on (the capture gate decides,
 * as for audio and speech). Only the presenter's own share: LiveKit must list it as a screen this person is sharing in
 * this call, so another person's share, a camera or a share that's over is refused, as is one their browser said
 * ended. Nothing is taken from a breakout room, or that was taken before screen notes came on or were resumed. It's
 * placed where it was on screen: when it was taken, by the server's clock. Once the notes have kept as many frames
 * as they may, screen notes turn off for everyone, saying why.
 */
export async function shareFrame(v: Viewer, callId: string, f: FrameUpload): Promise<ScreenFrameReceipt> {
  requireIn(v, 'screen');
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const s = settle(state, row);
  const at = tenthsIn(row.started_at, f.takenAt);
  const ctx = { callId, segment: s.notes.segment, bytes: f.jpeg.length, ageMs: Date.now() - f.takenAt, role: v.pass.role };
  // Where its presenter was when it was taken (never before they came into the call), as for speech: a frame from a
  // breakout room, the organizer's own share while it's visiting one included, stays out of the notes. So does one
  // whose place can't be told any more (two moves since).
  const presenter = s.people.find((j) => j.identity === v.pass.identity);
  const where = presenter ? placeAt(s, presenter, Math.max(f.takenAt, presenter.since)) : undefined;
  const into = capture.mayCapture({ ...capturing(row, s), inRoom: where !== MAIN_PLACE }, 'screen', ctx);
  // Taken before notes came on, were resumed, or screens were turned on: from a stretch that wasn't captured.
  const since = Math.max(s.notes.history.filter((h) => h.status === 'on').at(-1)?.at ?? 0, s.notes.screens.history.filter((h) => h.on).at(-1)?.at ?? 0);
  if (at < since) throw new ConflictError('That frame was taken before screen notes were on, so it isn’t kept.', { context: { ...ctx, early: Math.round((since - at) * 10) / 10 } });
  const over = s.notes.screens.ended.some((e) => e.presenter === v.pass.identity && e.share === f.share && e.at <= at);
  if (over || !row.room_name || !(await ownShare(o, row.room_name, v.pass.identity, f.share))) throw new ForbiddenError(NOT_YOURS, { context: { ...ctx, ended: over } });
  const kept = await screens.keep(o, into, { presenter: v.pass.identity, share: f.share, at, segment: s.notes.segment, jpeg: f.jpeg, width: f.width, height: f.height });
  if (kept !== 'full') return kept;
  await screensFull(o, callId);
  throw new ConflictError(FULL, { context: { ...ctx, max: o.cfg.SCREEN_FRAMES_MAX } });
}

const NOT_YOURS = 'That isn’t a screen you’re sharing in this call.';

const FULL = 'The notes have kept as many shared screens as they can for this call.';

/** The notes are full of frames: screen notes turn off for everyone, with a notice saying why, as if the organizer had. */
async function screensFull(o: Owner, callId: string): Promise<void> {
  const turned = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    const sc = state.notes.screens;
    if (row.state !== 'live' || !sc.on) return null;
    const off: Stored = { ...state, notes: { ...state.notes, screens: { ...sc, on: false, history: [...sc.history, { at: tenthsIn(row.started_at), on: false, segment: state.notes.segment, by: 'organizer' }] } } };
    await save(o, c, callId, notice(off, 'Shared screens are off: the notes have kept as many as they can for this call. What was shared is kept.'));
    return { room: row.room_name };
  });
  if (!turned) return;
  clog.info('screen notes turned off: the notes are full', { callId, max: o.cfg.SCREEN_FRAMES_MAX });
  await nudge(o, turned.room, callId, { call: true, log: false });
}

/** The presenter's browser says one of its shares ended: what it showed last stops there in the notes. Only their own shares. */
export async function shareEnded(v: Viewer, callId: string, share: string): Promise<void> {
  requireIn(v, 'share-ended');
  const o = v.organizer;
  await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: { callId } });
    if (state.notes.screens.ended.some((e) => e.share === share && e.presenter === v.pass.identity)) return;
    await save(o, c, callId, sharesEnd(state, [{ share, presenter: v.pass.identity }], tenthsIn(row.started_at)));
  });
  // Frames of it already checked with LiveKit stop being taken at once, not when that check runs out.
  for (const id of sharing.keys()) if (id.endsWith(`|${v.pass.identity}|${share}`)) sharing.delete(id);
  clog.debug('share ended', { callId, role: v.pass.role });
}
