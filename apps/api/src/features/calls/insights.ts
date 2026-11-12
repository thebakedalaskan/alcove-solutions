import { firstName, type Speaker } from '@alcove/api';
import { CAPTION_LANGUAGES, MAIN_PLACE, MAX_CALL_IDEAS, type CallAction, type CallBoard, type CallBoardIdea, type CallAnswer, type CallMoment, type CaptionLanguage, type CaptionTranslation, type CaptureGap, type CatchUp, type CatchUpRange, type CatchUpWindow, type Changer, type LiveNotes, type Person, type CallFollowUps, type DocFollowUpTick, type SeriesAnswerPart } from '@alcove/api';
import type { Owner } from '../../context';
import type { ChatModel } from '../../inference';
import { id128 } from '../../crypto';
import { exec, tx, type Db } from '../../db';
import { AuthError, ConflictError, ForbiddenError, notFound } from '../../errors';
import { me, profile } from '../account/account';
import { type StoredIdea } from './space-state';
import * as space from './workspace';
import * as boards from './boards';
import * as catchup from './catchup';
import * as drafting from '../notes/drafting';
import * as models from '../notes/models';
import { recordUnencryptedUse } from '../notes/service';
import * as liveNotes from './live-notes';
import * as personal from '../notes/personal';
import { personOf, portraitFor } from '../account/portraits';
import { segments, stretch, type Stretch } from '../recordings/audio';
import * as capture from './capture';
import { MeetingManifest } from '../meetings/service';
import type { Loaded } from '../../vault';
import { getItem } from '../../vault';
import { Joined, placeOf, placesOf, readerOf } from './places';
import { scribedIn } from './scribes';
import * as series from '../notes/series';
import * as transcripts from '../recordings/transcripts';
import { readerInCall } from '../workspaces/access';
import { log } from '../../log';
import { invitedIn, mayRead, onlyHere, personFor, requireIn, roomsIn, saidIn, speakersIn, type Viewer } from './participants';
import { capturing, load, saveSettled, secondsIn, settle, tenthsIn, type Row, type Stored } from './state';
import { landRooms, syncRoomBoards, workedOn } from './room-boards';
import { tellRoom } from './notifications';
import { callMeter } from './recording';
import { meterFor, type Spend } from '../billing/meter';

const clog = log.child({ component: 'calls' });

/** Someone's own question or catch-up in the call: from their own plan, signed in, or a guest's from the organizer's. */
async function askerMeter(v: Viewer, spend: Spend) {
  const asker = (await v.session())?.ownerId;
  return meterFor(v.organizer, asker ? { payer: asker, spend, whose: 'yours' } : { payer: v.organizer.ownerId, spend, whose: 'organizer' });
}

/** The call's follow-ups as this person may read them: the live notes' where they are, and the documents' they can open. */
export async function followUpsIn(v: Viewer, callId: string): Promise<CallFollowUps> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live') throw new ConflictError('This call has ended. Its notes have everything.', { context: { callId, what: 'follow-ups' } });
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const place = mine ? placeOf(s, mine) : MAIN_PLACE;
  const invited = invitedIn(await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting'));
  return space.followUps(o, await readerInCall(v), await notesFor(v, o.pool, row, s, mine, place, invited), capturing(row, s, place).status, s.workspace.worked);
}

/** Ticks a to-do in a document worked on in this call, and it's worked on by whoever ticked it. */
export async function tickDocumentFollowUp(v: Viewer, callId: string, t: DocFollowUpTick): Promise<CallFollowUps> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live') throw new ConflictError('This call has ended. Its notes have everything.', { context: { callId, what: 'follow-ups' } });
  const { entry, by } = await space.tick(o, await readerInCall(v), callId, state.workspace.worked, t);
  await workedOn(v, entry, by);
  return followUpsIn(v, callId);
}

/**
 * Asking about a selection needs in a call what catching up does: everything that reaches the AI from a call waits while
 * notes, or the room someone's in, are paused, and a call whose notes have never been on sends it nothing. Says which
 * model the call's AI goes to.
 */
export async function mayAskInCall(v: Viewer): Promise<ChatModel> {
  const { row, state } = await load(v.organizer, v.organizer.pool, v.pass.callId);
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const ctx = { callId: v.pass.callId, what: 'ask-selection' };
  const call = capturing(row, s, mine ? placeOf(s, mine) : MAIN_PLACE);
  capture.mayReachAi(call, 'ask', ctx);
  if (!call.noteId) throw new ConflictError('Notes aren’t on in this call, so nothing goes to the AI from it.', { context: ctx });
  // What's asked in a call goes to the model chosen for it.
  const via = await models.resolveModel(v.organizer.cfg, s.notes.model);
  await recordUnencryptedUse(v.organizer, call.noteId, via);
  return via;
}

/**
 * Sort into themes on a board, from a call: someone asked for it, about what people wrote, so it needs no notes, only that the
 * part of the call they're in isn't paused, when nothing goes to the AI.
 */
export async function maySortInCall(v: Viewer): Promise<void> {
  const { row, state } = await load(v.organizer, v.organizer.pool, v.pass.callId);
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  capture.mayReachAi(capturing(row, s, mine ? placeOf(s, mine) : MAIN_PLACE), 'sort', { callId: v.pass.callId, what: 'board-sort' });
}

/**
 * Live transcript lines in another language, for the person asking: only lines they may read (said in the part of the
 * call they're in, while they were there). Each line is translated once per language and kept sealed with the live
 * transcript, which goes when the recording stops (and a room's, when it closes).
 */
export async function translate(v: Viewer, callId: string, language: CaptionLanguage, lineIds: string[]): Promise<CaptionTranslation[]> {
  requireIn(v, 'translate');
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const s = settle(state, row);
  const ctx = { callId, language, asked: lineIds.length };
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const into = capture.mayCapture(capturing(row, s, mine ? placeOf(s, mine) : MAIN_PLACE), 'captions', ctx);
  const asked = new Set(lineIds);
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const wanted = (await transcripts.lines(o, o.pool, into.noteId, mayRead(v, s, mine, row.started_at, invitedIn(meeting)))).filter((l) => asked.has(l.id));
  if (!wanted.length) return [];
  const have = await transcripts.translations(o, into.noteId, wanted.map((l) => l.id), language);
  const missing = wanted.filter((l) => !have.has(l.id));
  if (missing.length) {
    const t0 = performance.now();
    const via = await models.resolveModel(o.cfg, s.notes.model);
    await recordUnencryptedUse(o, into.noteId, via);
    const fresh = await drafting.translate(o.cfg, callMeter(v, callId, into.recordingId, 'captions'), missing.map((l) => ({ id: l.id, text: l.text })), CAPTION_LANGUAGES.find((x) => x.code === language)?.english ?? language, via);
    await transcripts.keepTranslations(o, into, language, [...fresh].map(([lineId, text]) => ({ lineId, text })));
    for (const [id, text] of fresh) have.set(id, text);
    clog.info('captions translated', { ...ctx, found: wanted.length, cached: wanted.length - missing.length, translated: fresh.size, ms: Math.round(performance.now() - t0) });
  } else clog.debug('captions translated from cache', { ...ctx, found: wanted.length });
  return wanted.flatMap((l) => { const text = have.get(l.id); return text === undefined ? [] : [{ id: l.id, text }]; });
}

/**
 * What wasn't captured where someone is: the call's gaps, or in a breakout room, the room's since it opened (the
 * call's notes off or paused, the room's own pauses, and the host's browser out of the call).
 */
function gapsFor(row: Row, s: Stored, place: string, segs: Parameters<typeof capture.gapsOf>[3]): CaptureGap[] {
  const open = s.breakouts.open;
  const room = place === MAIN_PLACE ? undefined : open?.rooms.find((r) => r.id === place);
  const all = !open || !room ? capture.gapsOf(s.notes.history, s.notes.offline, row.started_at, segs)
    : capture.roomGaps(s.notes.history, s.notes.offline, room.pauses, open.from, row.started_at, secondsIn(row.started_at));
  // The host's browser out of the call is told once, as `missed` (catchup.missedOf, from when each connection hosted),
  // never also as a gap.
  return all.filter((g) => g.kind !== 'offline');
}

/** What a viewer can catch up on: their time in the call, their latest time away, what they may read, and the gaps. */
function windowFor(v: Viewer, row: Row, s: Stored, mine: Joined | undefined, invited: Set<string>, gaps: CaptureGap[]): catchup.Window {
  // To a tenth, as lines and everyone's time in the call are counted.
  const now = Math.max(0, Math.round((Date.now() - row.started_at.getTime()) / 100) / 10);
  const time = mine ? catchup.presence(s.people, mine, row.started_at.getTime()) : [];
  return catchup.windowOf(now, row.started_at.getTime(), time, onlyHere(v, s, mine, row.started_at, invited) === null, gaps);
}

/**
 * Stretches with notes on (not off or paused) and nothing transcribed where someone is. In the main room: no hosting
 * browser, which sends what's said there, was in the call. The connection hosting now stopped sending when LiveKit said
 * it left, though it hosts until another does. In a breakout room: it had no scribe, since it opened (before that, there
 * was no room to miss).
 */
function missedIn(row: Row, s: Stored, w: catchup.Window, place: string): catchup.Open[] {
  if (place !== MAIN_PLACE) {
    const scribed = scribedIn(s, place).map((x) => ({ from: tenthsIn(row.started_at, x.from), to: x.until === null ? null : tenthsIn(row.started_at, x.until) }));
    return catchup.missedOf([{ from: 0, to: s.breakouts.open?.from ?? 0 }, ...scribed], w);
  }
  const left = row.host_left_at?.getTime();
  const people = left === undefined ? s.people
    : s.people.map((j) => (j.identity === s.host ? { ...j, hosting: j.hosting.map((h) => (h.to === null ? { ...h, to: left } : h)) } : j));
  return catchup.missedOf(catchup.hostingOf(people, row.started_at.getTime()), w);
}

/**
 * What the notes model reads of a part of the call so far: the lines `keep` takes, the window they're read through, what
 * can't be in them, and the brief it's told.
 */
async function soFarIn(o: Owner, row: Row, s: Stored, into: { noteId: string; recordingId: string }, meeting: Loaded<MeetingManifest>, place: string, keep: (l: transcripts.Line) => boolean, windowFrom: (gaps: CaptureGap[]) => catchup.Window) {
  const person = await me(o);
  const segs = await segments(o, into.recordingId);
  const window = windowFrom(gapsFor(row, s, place, segs));
  const said = saidIn(row.started_at);
  // Lines stay inside their segment once it's over, so what was said before a pause is read before it.
  const all = transcripts.placed(await transcripts.lines(o, o.pool, into.noteId, keep), segs, s.notes.status === 'on' ? s.notes.segment : undefined)
    .map((l) => ({ ...l, said: said(l) }));
  // The model the organizer chose for this call reads it, for catching up, questions and the live notes alike.
  const via = await models.resolveModel(o.cfg, s.notes.model);
  const brief = (ls: transcripts.HeardLine[], gaps: CaptureGap[]): drafting.Brief => ({
    title: meeting.manifest.title, kind: 'call', organizer: person, people: meeting.manifest.guests.map((e) => personOf(e)),
    seconds: window.now, lines: transcripts.spoken(ls, speakersIn(s, person), roomsIn(s)), gaps, live: true, via
  });
  return { all, window, missed: missedIn(row, s, window, place), person, brief, disclose: () => recordUnencryptedUse(o, into.noteId, via) };
}

/**
 * A live call and its transcript so far, for the person asking: what was said in the part of the call they're in now,
 * while they were there (and for a guest with the link, while they were in the call), with the stretches nothing was
 * captured in. Like everything that reaches the AI, it waits while notes, or their breakout room, are paused.
 */
async function sofar(v: Viewer, callId: string, what: 'catch-up' | 'ask') {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const place = mine ? placeOf(s, mine) : MAIN_PLACE;
  const into = capture.mayCapture(capturing(row, s, place), what, { callId, part: place !== MAIN_PLACE ? 'room' : 'main' });
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const invited = invitedIn(meeting);
  return soFarIn(o, row, s, into, meeting, place, mayRead(v, s, mine, row.started_at, invited), (gaps) => windowFor(v, row, s, mine, invited, gaps));
}

/**
 * The viewer's grants checked again once an answer is written, which can take the model up to a minute: still in
 * this live call, and not removed. An answer that quotes the call isn't sent to someone who's no longer in it.
 */
async function stillIn(v: Viewer, callId: string, what: 'catch-up' | 'ask'): Promise<void> {
  const { row, state: s } = await load(v.organizer, v.organizer.pool, callId);
  const ctx = { callId, what, role: v.pass.role };
  if (s.removed.includes(v.pass.person)) throw new ForbiddenError('The host removed you from this call.', { context: ctx });
  if (row.state !== 'live') throw new ConflictError('The call ended while the answer was being written. Its notes have everything.', { context: ctx });
  const here = v.isOrganizer ? row.host_identity === v.pass.identity : s.people.some((j) => j.identity === v.pass.identity && j.status === 'in');
  if (!here) throw new ForbiddenError('You left the call while the answer was being written, so it isn’t shown.', { context: ctx });
}

/** Where a stretch of the call has got to, from the live transcript: for the person asking alone, from what they may read. */
export async function catchUp(v: Viewer, callId: string, range: CatchUpRange): Promise<CatchUp> {
  const { all, window, missed, brief, disclose } = await sofar(v, callId, 'catch-up');
  const { lines, read } = catchup.readOf(all, range, window, missed, { callId, what: 'catch-up' });
  const ctx = { callId, range: range.kind, lines: lines.length, gaps: read.gaps.length, missed: read.missed.length, whileHere: read.whileHere };
  // Nothing said, nothing sent: an empty stretch never reaches the notes model.
  if (!lines.length) { clog.info('caught up on a stretch with nothing said', ctx); return { summary: '', decided: [], proposed: [], open: [], next: [], read }; }
  const t0 = performance.now();
  await disclose();
  const sorted = await drafting.catchUp(v.organizer.cfg, await askerMeter(v, 'catch-up'), brief(lines, read.gaps), catchup.describe(range, read.whileHere));
  await stillIn(v, callId, 'catch-up');
  const cite = (xs: drafting.Cited[]) => xs.map(({ refs, ...x }) => ({ ...x, evidence: catchup.evidenceOf(refs, lines) }));
  const out: CatchUp = { summary: sorted.summary, decided: cite(sorted.decided), proposed: cite(sorted.proposed), open: cite(sorted.open), next: cite(sorted.next), read: catchup.withCut(read, sorted.cut, lines) };
  clog.info('caught up during a call', { ...ctx, items: out.decided.length + out.proposed.length + out.open.length + out.next.length, uncited: sorted.uncited, cut: sorted.cut?.count ?? 0, ms: Math.round(performance.now() - t0) });
  return out;
}

/** Answers a question from a stretch of the call's live transcript, for the person asking alone, with the moments it comes from. */
export async function askSoFar(v: Viewer, callId: string, question: string, range: CatchUpRange): Promise<CallAnswer> {
  const { all, window, missed, person, brief, disclose } = await sofar(v, callId, 'ask');
  const { lines, read } = catchup.readOf(all, range, window, missed, { callId, what: 'ask' });
  const ctx = { callId, range: range.kind, lines: lines.length, whileHere: read.whileHere };
  if (!lines.length) { clog.info('question about a stretch with nothing said', ctx); return { text: '', evidence: [], read }; }
  const asker: Person = v.isOrganizer ? person : { id: v.pass.identity, name: v.pass.name, email: '' };
  const t0 = performance.now();
  await disclose();
  const a = await drafting.answerSoFar(v.organizer.cfg, await askerMeter(v, 'ask'), brief(lines, read.gaps), asker, question, catchup.describe(range, read.whileHere));
  await stillIn(v, callId, 'ask');
  clog.info('question answered during a call', { ...ctx, cites: a.refs.length, cut: a.cut?.count ?? 0, ms: Math.round(performance.now() - t0) });
  return { text: a.text, evidence: catchup.evidenceOf(a.refs, lines), read: catchup.withCut(read, a.cut, lines) };
}

/**
 * Answers a question across the earlier calls in this call's series, from the notes `asker`'s own account has now: being
 * in this call adds nothing to them. It reads nothing of this call, so it needs no notes here, but while notes are
 * paused nothing goes to the AI, questions included.
 */
export async function askEarlier(v: Viewer, callId: string, asker: Owner, question: string, timeZone: string): Promise<SeriesAnswerPart[]> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  capture.mayReachAi(capturing(row, s, mine ? placeOf(s, mine) : MAIN_PLACE), 'ask', { callId, what: 'ask-earlier' });
  const { seriesId } = (await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting')).manifest;
  if (!seriesId) throw notFound('That series', { callId });
  return series.ask(asker, seriesId, question, timeZone);
}

/* ---------- the call's shared live notes: kept in features/calls/live-notes.ts; who reads what, and when they're refreshed, is here ---------- */

/** Nothing to read: until notes are written, for someone waiting to be let in, and once the call has ended and they're in the note. */
export const NO_NOTES: LiveNotes = { notes: null, added: [], suggestions: [], writing: false, error: null };

/** As much of a whole call's follow-ups as its live notes keep from one refresh, as many as the notes at the end may have. */
const FOLLOW_UPS_READ = 20;

/** Who's reading the live notes of the part of the call someone is in: as lines list their readers, and for a guest, their time in the call. */
const readerFor = (v: Viewer, s: Stored, mine: Joined, startedAt: Date, invited: Set<string>): liveNotes.Reader => ({ me: readerOf(mine), here: onlyHere(v, s, mine, startedAt, invited) });

/** The live notes of the part of the call someone is in now: everyone's, or notes of their own from what they may read. */
export async function notesFor(v: Viewer, db: Db, row: Row, s: Stored, mine: Joined | undefined, place: string, invited: Set<string>): Promise<LiveNotes> {
  if (!mine || row.state !== 'live' || !s.notes.noteId) return NO_NOTES;
  return liveNotes.shownTo(await liveNotes.find(v.organizer, db, row.call_id, place, readerFor(v, s, mine, row.started_at, invited)), capturing(row, s, place).status === 'on');
}

/**
 * What a part of the call's notes read: everything said there. Except that what the main room said while rooms were open
 * is for the people who stayed: it's read while those rooms are open, and left out once they've closed, so that everyone
 * back in the main room can read one set of notes, and tick them. It stays in the transcript of whoever may read it, in
 * their catching up, and the note.
 */
function sharedIn(row: Pick<Row, 'started_at'>, s: Stored, place: string): (l: transcripts.Line) => boolean {
  const open = s.breakouts.open;
  const said = saidIn(row.started_at);
  return (l) => (l.room ?? MAIN_PLACE) === place && (place !== MAIN_PLACE || l.readers === undefined || (open !== null && (said(l) ?? 0) >= open.from));
}

/** Connections that looked and found nothing that could be written for them, until when they don't need to look again. They have no row to say so. */
const resting = new Map<string, number>();

const REST_MS = 30_000;

/**
 * Someone in the call is looking at the live notes. What the notes read of this part of the call is split by what this
 * person may read of it: all of it is everyone's view, and anything less is a view of its own, named by what they can't
 * read, which the notes model never sees for them. If that view has something new, it's been at least half a minute and
 * nobody else is at it, it’s refreshed now, for everyone in it. The organizer pays for it, as for everything the call does. True when
 * this look refreshed them; any other look at the same time answers false at once. Nothing is held while the model reads.
 */
export async function watchNotes(v: Viewer, callId: string): Promise<boolean> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live') throw new ConflictError('This call has ended. Its notes have everything.', { context: { callId, what: 'live-notes' } });
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  if (!mine) return false;
  const place = placeOf(s, mine);
  const { status, noteId, recordingId } = capturing(row, s, place);
  if (status !== 'on' || !noteId || !recordingId) return false;
  const restKey = `${callId}|${v.pass.identity}`;
  if ((resting.get(restKey) ?? 0) > Date.now()) return false;
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const invited = invitedIn(meeting);
  const reader = readerFor(v, s, mine, row.started_at, invited);
  const found = await liveNotes.find(o, o.pool, callId, place, reader);
  // Their notes are up to date, or it isn't time: said without reading the transcript, which is nearly every look.
  const theirs = found.own ?? found.view;
  if (theirs !== null && !(await liveNotes.due(o, o.pool, callId, place, theirs, noteId))) return false;
  clog.debug('reading the transcript for the live notes', { callId, part: place !== MAIN_PLACE ? 'room' : 'main' });
  const clips = await liveNotes.clipsOf(o, o.pool, noteId);
  const part = await soFarIn(o, row, s, { noteId, recordingId }, meeting, place, sharedIn(row, s, place), (gaps) => catchup.windowOf(tenthsIn(row.started_at), row.started_at.getTime(), [], true, gaps));
  const may = mayRead(v, s, mine, row.started_at, invited);
  const barred = part.all.flatMap((l) => (!may(l) && l.said !== undefined ? [{ ...l, said: l.said }] : []));
  const view = barred.length ? liveNotes.digestOf(barred) : liveNotes.ALL;
  const ctx = { callId, part: place !== MAIN_PLACE ? 'room' : 'main', view: barred.length ? 'narrowed' : 'all' };
  const whole: CatchUpRange = { kind: 'all' };
  const { lines, read } = catchup.readOf(barred.length ? part.all.filter(may) : part.all, whole, part.window, part.missed, ctx);
  const heard = liveNotes.digestOf(lines);
  // Nothing they may read, or a view of their own that would read what they're reading already: a run would write it again.
  if (!lines.length || (view !== found.view && heard === found.stored?.notes?.heard)) {
    if (resting.size > 10_000) resting.clear();
    resting.set(restKey, Date.now() + REST_MS);
    return false;
  }
  // Under the call's row, shared: a pause is either here to see, and nothing is claimed, or comes after what got through.
  const claim = await tx(o.pool, async (c) => {
    const now = await load(o, c, callId, 'share');
    const at = settle(now.state, now.row);
    if (!placesOf(at).includes(place)) return null;
    capture.mayCapture(capturing(now.row, at, place), 'live-notes', ctx);
    return liveNotes.claim(o, c, callId, place, view, clips, lines, barred);
  });
  if (!claim) return false;
  if (heard === claim.heard) {
    await liveNotes.release(o, callId, place, view, claim);
    clog.debug('nothing new for the live notes', { ...ctx, lines: lines.length });
    return false;
  }
  try {
    // Everyone reading them sees they're being written.
    await tellRoom(o, row.room_name, callId, { call: true, log: false });
    const t0 = performance.now();
    const known = liveNotes.knownTo(claim, lines);
    await part.disclose();
    const sorted = await drafting.catchUp(o.cfg, callMeter(v, callId, recordingId, 'live-notes'), part.brief(lines, read.gaps), catchup.describe(whole, barred.length > 0), { followUps: FOLLOW_UPS_READ, known });
    const done = {
      lines: lines.length, gaps: read.gaps.length, missed: read.missed.length, uncited: sorted.uncited, known: known.length, same: sorted.next.filter((f) => f.same).length, strays: sorted.strays,
      cut: sorted.cut?.count ?? 0, ms: Math.round(performance.now() - t0)
    };
    const invitedEmails = new Set([...meeting.manifest.guests, part.person.email].map((email) => email.toLowerCase()));
    const people = [...new Map([
      ...meeting.manifest.guests.map((email) => personOf(email)),
      ...s.people.map((j) => personFor(j, j.identity, j.name, part.person)), part.person
    ].filter((p) => p.email && invitedEmails.has(p.email.toLowerCase())).map((p) => [p.email.toLowerCase(), p])).values()];
    const folded = (text: string) => text.normalize('NFKC').trim().toLowerCase();
    const ownerOf = (name: string): Person | null => {
      const exact = people.filter((p) => folded(p.name) === folded(name) || folded(p.email) === folded(name));
      const first = people.filter((p) => folded(firstName(p.name)) === folded(name));
      const matches = exact.length ? exact : first;
      return matches.length === 1 ? matches[0] ?? null : null;
    };
    const run = liveNotes.runOf(sorted, lines, barred, { ...catchup.withCut(read, sorted.cut, lines), whileHere: barred.length > 0 }, ownerOf);
    if (!await liveNotes.keep(o, callId, place, view, claim, run, reader)) {
      clog.info('live notes written too late to keep', { ...ctx, ...done });
      return false;
    }
    clog.info('live notes written', { ...ctx, ...done, points: sorted.decided.length + sorted.proposed.length + sorted.open.length + sorted.next.length });
    await tellRoom(o, row.room_name, callId, { call: true, log: false });
    return true;
  } catch (e) {
    clog.warn('live notes not refreshed', { ...ctx, err: e });
    if (await liveNotes.failed(o, callId, place, view, claim)) await tellRoom(o, row.room_name, callId, { call: true, log: false });
    return false;
  }
}

/* ---------- ideas from the call, for the board open in the part of the call they were said in ---------- */

/** Whoever said an idea, when the call doesn't know them any more. */
const SOMEONE: Person = { id: 'someone', name: 'Someone', email: '', portrait: portraitFor('someone') };

/** Ideas in a part of the call are looked for at most this often, however many browsers have its board open. */
const IDEAS_EVERY_MS = 60_000;

/** How long a look holds its claim: longer than the notes model takes to be verified and answer. If its worker dies, the next look takes over after this. */
const IDEAS_LEASE_MS = 150_000;

/** What a look at ideas reads: what was said lately. */
const IDEAS_READ: CatchUpRange = { kind: 'recent', minutes: 5 };

/** A line as an idea keeps it, for `mayRead`: where it was said, when, and who may read it. */
const lineOf = (place: string, l: { when?: number | undefined; readers?: string[] | undefined }): transcripts.Line => ({
  id: '', at: 0, end: 0, text: '', ...(place === MAIN_PLACE ? {} : { room: place }), ...(l.when === undefined ? {} : { when: l.when }), ...(l.readers ? { readers: l.readers } : {})
});

/**
 * The board open in the part of the call someone's in, as they may know it, with that part's ideas from the call while notes
 * are on there: only for someone who can add to the board, and only the ones they may read every line of what they were
 * picked from, so nobody is told anything of what they may not read. A part's ideas are for its own board: in a room on the one
 * board every room shares there are none, since not everyone on that board may read what's said in the room.
 */
export async function boardFor(v: Viewer, s: Stored, mine: Joined | undefined, place: string, row: Row, invited: Set<string>): Promise<CallBoard> {
  const shown = await boards.shownTo(v, s, place);
  const kept = s.board.ideas[place];
  if (!kept?.list.length || !mine || row.state !== 'live' || shown.open?.role !== 'edit' || capturing(row, s, place).status !== 'on') return shown;
  const may = mayRead(v, s, mine, row.started_at, invited);
  const organizer = await me(v.organizer);
  const speaker = speakersIn(s, organizer, v);
  const ideas = kept.list.filter((i) => i.seen.every((l) => may(lineOf(place, l)))).map((i): CallBoardIdea => ({
    id: i.id, text: i.text,
    said: { person: (i.speaker ? speaker(i.speaker)?.person : undefined) ?? SOMEONE, at: i.when === undefined ? null : new Date(i.when).toISOString(), words: i.words },
    frame: i.frame
  }));
  return { ...shown, ideas };
}

/** Connections that looked for ideas and found it wasn't for them to look, until when they needn't look again. */
const restingIdeas = new Map<string, number>();

/**
 * Someone in the call has its board open, while notes are on in the part of the call they're in. If it's been a minute since
 * that part's ideas were last looked for, nobody else is at it, and something new was said, what was said lately is read now,
 * for everyone there, with the board's frames, and the notes model offers ideas worth a sticky: each from one line, which
 * says who said it and when, and in the frame it fits. Ideas come only from what everyone in that part may read: someone who
 * may read less doesn't look. The organizer's notes pay for it, as for the live notes. True when this look found some; any other
 * look at the same time answers false at once. Nothing is held while the model reads. A part looks only at its own board:
 * a room on the board every room shares has none of its own, so nobody there looks. Claiming the look and letting it go both
 * save the call (`saveSettled`), so rooms whose time ran out close with either: their boards are everyone invited's once the
 * look is done, and they land with the next look or whatever's done next in the call.
 */
export async function watchIdeas(v: Viewer, callId: string): Promise<boolean> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live') return false;
  // Rooms' boards waiting to come back land now, as after anything done in the call: a look comes every 15 seconds.
  const waiting = state.board.landing;
  if (waiting && waiting.until <= Date.now()) void landRooms({ organizer: o, callId });
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  if (!mine) return false;
  const place = placeOf(s, mine);
  const open = s.board.open[place];
  const kept = s.board.ideas[place];
  const now = Date.now();
  if (!open || (kept && (kept.at + IDEAS_EVERY_MS > now || (kept.running ?? 0) > now))) return false;
  const { status, noteId, recordingId } = capturing(row, s, place);
  if (status !== 'on' || !noteId || !recordingId) return false;
  const restKey = `${callId}|${v.pass.identity}`;
  if ((restingIdeas.get(restKey) ?? 0) > now) return false;
  const rest = () => {
    if (restingIdeas.size > 10_000) restingIdeas.clear();
    restingIdeas.set(restKey, Date.now() + IDEAS_EVERY_MS);
    return false;
  };
  // Only someone who can add to the board looks for what to add to it.
  if ((await boards.shownTo(v, s, place)).open?.role !== 'edit') return rest();
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const invited = invitedIn(meeting);
  const ctx = { callId, part: place !== MAIN_PLACE ? 'room' : 'main' };
  const part = await soFarIn(o, row, s, { noteId, recordingId }, meeting, place, sharedIn(row, s, place), (gaps) => catchup.windowOf(tenthsIn(row.started_at), row.started_at.getTime(), [], true, gaps));
  const may = mayRead(v, s, mine, row.started_at, invited);
  if (part.all.some((l) => !may(l))) return rest();
  const { lines, read } = catchup.readOf(part.all, IDEAS_READ, part.window, part.missed, ctx);
  const heard = liveNotes.digestOf(lines);
  if (!lines.length || heard === kept?.heard) return false;
  // Under the call's row: a pause is either here to see, and nothing is claimed, or comes after what got through.
  const claimed = await tx(o.pool, async (c) => {
    const at = await load(o, c, callId, true);
    const held = settle(at.state, at.row);
    const was = held.board.ideas[place];
    const stamp = Date.now();
    if (!placesOf(held).includes(place) || !held.board.open[place] || (was && (was.at + IDEAS_EVERY_MS > stamp || (was.running ?? 0) > stamp))) return undefined;
    capture.mayCapture(capturing(at.row, held, place), 'ideas', ctx);
    const claim = { at: stamp, heard: was?.heard ?? '', running: stamp + IDEAS_LEASE_MS, list: was?.list ?? [] };
    return saveSettled(o, c, callId, at.state, { ...held, board: { ...held.board, ideas: { ...held.board.ideas, [place]: claim } } });
  });
  if (!claimed) return false;
  /** Whether rooms closed with either save, for them to come back once the look's done. */
  let closed = claimed.closed;
  /** Lets the claim go, keeping what's offered, and anything new: under the row again, so an idea added meanwhile stays added. */
  const settleIdeas = (found: StoredIdea[]) => tx(o.pool, async (c) => {
    const at = await load(o, c, callId, true);
    const held = settle(at.state, at.row);
    const was = held.board.ideas[place];
    // The board closed or changed meanwhile, or its room did: what was found was for it.
    if (!was || held.board.open[place]?.documentId !== open.documentId) return false;
    const list = placesOf(held).includes(place) ? [...was.list, ...found].slice(-MAX_CALL_IDEAS) : was.list;
    const saved = await saveSettled(o, c, callId, at.state, { ...held, board: { ...held.board, ideas: { ...held.board.ideas, [place]: { ...was, heard, running: null, list } } } });
    closed ||= saved.closed;
    return found.length > 0 && saved.s.board.ideas[place] !== undefined;
  });
  try {
    const t0 = performance.now();
    const frames = await boards.framesOf(o, open);
    const brief = part.brief(lines, read.gaps);
    await part.disclose();
    const found = await drafting.ideasFrom(o.cfg, callMeter(v, callId, recordingId, 'ideas'), brief, frames, kept?.list.map((i) => i.text) ?? []);
    const seen = lines.map((l) => ({ ...(l.when === undefined ? {} : { when: l.when }), ...(l.readers ? { readers: l.readers } : {}) }));
    const ideas = found.flatMap((f): StoredIdea[] => {
      const line = lines[f.line];
      return line ? [{ id: id128(), text: f.text, words: f.said, ...(line.speaker ? { speaker: line.speaker } : {}), ...(line.when === undefined ? {} : { when: line.when }), frame: f.frame, seen }] : [];
    });
    const offered = await settleIdeas(ideas);
    clog.info('ideas from the call looked for', { ...ctx, lines: lines.length, frames: frames.length, ideas: ideas.length, ms: Math.round(performance.now() - t0) });
    // Rooms that closed meanwhile have their boards kept for everyone invited before anyone's told.
    if (closed) await syncRoomBoards({ organizer: o, callId });
    if (offered || closed) await tellRoom(o, row.room_name, callId, { call: true, log: false });
    return offered;
  } catch (e) {
    clog.warn('ideas from the call not looked for', { ...ctx, err: e });
    await settleIdeas([]).catch((err: unknown) => clog.warn('a look for ideas not let go', { ...ctx, err }));
    if (closed) {
      await syncRoomBoards({ organizer: o, callId });
      await tellRoom(o, row.room_name, callId, { call: true, log: false });
    }
    return false;
  }
}

/**
 * Who's changing the follow-ups of the part of the call they're in, for everyone there, in the caller's transaction, which
 * holds the call's row, so the call can't end halfway through. It's for anyone in the call who gets the notes, as
 * `mayChangeAction` has it for a follow-up nobody has taken on, which nothing is until the notes are written. A guest with
 * the link doesn't get them.
 */
async function changing(v: Viewer, c: Db, row: Row, s: Stored, what: CallAction['type']): Promise<{ mine: Joined; by: Changer; place: string; reader: liveNotes.Reader }> {
  const o = v.organizer;
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const meeting = await getItem(o, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const invited = invitedIn(meeting);
  if (!mine || onlyHere(v, s, mine, row.started_at, invited) !== null) throw new ForbiddenError('The notes go to the people invited, so only they can change follow-ups.', { context: { callId: row.call_id, role: v.pass.role, what } });
  const organizer = mine.role === 'host' ? await me(o) : undefined;
  const by: Changer = { id: organizer ? o.ownerId : null, name: organizer?.name ?? mine.name, email: organizer?.email ?? mine.email ?? '', as: organizer ? 'organizer' : 'invited' };
  return { mine, by, place: placeOf(s, mine), reader: readerFor(v, s, mine, row.started_at, invited) };
}

/** A follow-up of the live notes, ticked or not, for everyone in that part of the call. */
export async function tickFollowUp(v: Viewer, c: Db, row: Row, s: Stored, a: Extract<CallAction, { type: 'follow-up' }>): Promise<void> {
  const { by, place, reader } = await changing(v, c, row, s, a.type);
  await liveNotes.tick(v.organizer, c, row.call_id, place, a.id, a.done, by, reader);
}

/** A follow-up nobody said, for whoever adds it. It goes into the note, so there has to be one. */
export async function addFollowUp(v: Viewer, c: Db, row: Row, s: Stored, a: Extract<CallAction, { type: 'follow-up-add' }>, said: number): Promise<void> {
  const o = v.organizer;
  const { by, place, reader } = await changing(v, c, row, s, a.type);
  if (!s.notes.noteId) throw new ConflictError('Notes haven’t been on in this call, so there’s nowhere for this to go.', { context: { callId: row.call_id, what: a.type } });
  await liveNotes.add(o, c, row.call_id, place, { text: a.input.text, owner: await ownerFor(v, c, row, s, a.input.owner), due: a.input.due, takenOn: false, by, said }, reader);
}


/** A manual owner names a real invited identity, never a model-supplied display name. */
async function ownerFor(v: Viewer, c: Db, row: Row, s: Stored, email: string | null): Promise<Speaker | null> {
  if (email === null) return null;
  const organizer = await me(v.organizer);
  const meeting = await getItem(v.organizer, c, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  if (organizer.email === email) return { name: organizer.name, person: organizer };
  if (!meeting.manifest.guests.some((x) => x.toLowerCase() === email)) throw new ForbiddenError('Choose someone invited to this call.', { context: { callId: row.call_id } });
  const joined = s.people.find((x) => x.email?.toLowerCase() === email);
  const person = joined ? personFor(joined, joined.identity, joined.name, organizer) : personOf(email);
  return { name: person.name, person };
}
export async function editFollowUp(v: Viewer, c: Db, row: Row, s: Stored, a: Extract<CallAction, { type: 'follow-up-edit' }>): Promise<void> {
  const { place, reader, by } = await changing(v, c, row, s, a.type);
  const owner = a.patch.owner === undefined ? undefined : await ownerFor(v, c, row, s, a.patch.owner);
  await liveNotes.edit(v.organizer, c, row.call_id, place, a.id, a.patch, owner, reader, by);
}
export async function reviewFollowUp(v: Viewer, c: Db, row: Row, s: Stored, a: Extract<CallAction, { type: 'follow-up-review' }>): Promise<void> {
  const { place, reader, by } = await changing(v, c, row, s, a.type);
  await liveNotes.review(v.organizer, c, row.call_id, place, a.review, reader, by);
}

/** What this person can catch up on, for choosing what to read. */
export async function catchUpWindow(v: Viewer, callId: string): Promise<CatchUpWindow> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live') throw new ConflictError('This call has ended. Its notes have everything.', { context: { callId, what: 'window' } });
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const segs = s.notes.recordingId ? await segments(o, s.notes.recordingId) : [];
  return catchup.shown(windowFor(v, row, s, mine, invitedIn(meeting), gapsFor(row, s, mine ? placeOf(s, mine) : MAIN_PLACE, segs)));
}

/** How many lines either side of a moment come with it. */
const AROUND = 6;

/**
 * A line of the live transcript from a catch-up or an answer, and a few either side, for the person opening it: only
 * from this call's live transcript, and only what they may read now. Anything else isn't found, whether or not it
 * exists, so nothing can be learned by asking.
 */
export async function moment(v: Viewer, callId: string, lineId: string): Promise<CallMoment> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  if (row.state !== 'live') throw new ConflictError('This call has ended. Its notes have everything.', { context: { callId, what: 'moment' } });
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const said = saidIn(row.started_at);
  const lines = s.notes.noteId ? (await transcripts.lines(o, o.pool, s.notes.noteId, mayRead(v, s, mine, row.started_at, invitedIn(meeting))))
    .flatMap((l) => { const at = said(l); return at === undefined ? [] : [{ ...l, said: at }]; }) : [];
  const i = lines.findIndex((l) => l.id === lineId);
  if (i < 0) throw notFound('That moment of the call', { callId, what: 'moment' });
  const around = lines.slice(Math.max(0, i - AROUND), i + AROUND + 1);
  const saidAt = new Map(around.map((l) => [l.id, l.said]));
  const organizer = await me(o);
  clog.debug('transcript moment opened', { callId, lines: around.length });
  return { lineId, lines: transcripts.spoken(around, speakersIn(s, organizer, v), roomsIn(s)).map((l) => ({ ...l, said: saidAt.get(l.id) ?? 0 })) };
}

/** How much of a line Hear it plays at least, when its words were heard in less. */
const LEAST_HEARD_MS = 1000;

/** A line of a call's recording, for Hear it: its whole pieces, where the line starts in them and how long it lasts. */
export interface Heard { audio: Stretch; from: number; seconds: number }

/**
 * Hear it, during the call: the recording of one line of its live transcript, for anyone in the call. Only a line they may
 * read (mayRead: the part of the call they're in, and for a guest with the link, while they were in it, a stay that ended
 * without a word ending when it was last heard from), and only the pieces of the recording they were there for: whole
 * pieces, so a guest who came in or went out in the middle of one doesn't hear it. A line said in a breakout room isn't in
 * the recording, and nor is anything of a call that doesn't keep its recording. Once the call ends it's the note's audio,
 * for whoever has the note. A line whose pieces the host's browser hasn't sent yet, while it's still recording that segment,
 * is a `conflict`, to try again in a few seconds. Everything else, a piece that will never come included, is the same
 * `not-found`, which names nothing.
 */
export async function hear(v: Viewer, callId: string, noteId: string, lineId: string): Promise<Heard> {
  requireIn(v, 'hear');
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const ctx = { callId, what: 'hear' };
  if (row.state !== 'live') throw new ConflictError('This call has ended. Its notes have the recording.', { context: ctx });
  const nothing = () => notFound('That moment of the call', ctx);
  const s = settle(state, row);
  const recordingId = s.notes.recordingId;
  if (!recordingId || s.notes.noteId !== noteId) throw nothing();
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  if (!meeting.manifest.choices.keepRecording) throw nothing();
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const invited = invitedIn(meeting);
  const line = (await transcripts.lines(o, o.pool, noteId, mayRead(v, s, mine, row.started_at, invited))).find((l) => l.id === lineId);
  const said = line ? saidIn(row.started_at)(line) : undefined;
  if (!line || line.room !== undefined || said === undefined) throw nothing();
  // Where it is in its own segment, as the line was placed there (transcripts.hear).
  const before = (await segments(o, recordingId)).filter((g) => g.index < line.segment).reduce((n, g) => n + g.seconds, 0);
  const fromMs = Math.max(0, Math.round((line.at - before) * 1000));
  const toMs = Math.max(fromMs + LEAST_HEARD_MS, Math.round((line.end - before) * 1000));
  // A piece of the recording is placed in the call by where it is from the line, which is known in both.
  const here = onlyHere(v, s, mine, row.started_at, invited);
  const inCall = (ms: number) => said + (ms - fromMs) / 1000;
  const audio = await stretch(o, recordingId, line.segment, fromMs, toMs, (a, b) => catchup.covers(here, inCall(a), inCall(b)));
  // A piece still to come only comes while its segment is being recorded: notes on, and in that segment. Once they're paused
  // or off, or a new segment has begun (a new host's browser records its own), the server takes no more of it, so a piece
  // that never came (the host's tab closed, or it was given up after its tries) never will, and it can't be played.
  if (audio === 'pending') {
    if (s.notes.status === 'on' && s.notes.segment === line.segment) throw new ConflictError('The recording doesn’t have this line yet. Try again in a few seconds.', { context: { ...ctx, segment: line.segment } });
    clog.info('a line’s piece of the recording never came', { callId, segment: line.segment, notes: s.notes.status, currentSegment: s.notes.segment });
    throw nothing();
  }
  if (!audio) throw nothing();
  clog.info('a line heard', { callId, segment: line.segment, bytes: audio.bytes.length, guest: here !== null });
  return { audio, from: Math.max(0, (fromMs - audio.startMs) / 1000), seconds: (Math.min(toMs, audio.endMs) - fromMs) / 1000 };
}

/* ---------- your own notes, from inside the call: for your account alone, and nothing of them goes into the call ---------- */

/**
 * Someone's own notes on this call: their account's (the session with the request, which has to be whoever this
 * connection joined as), on the call's note, and what they may read here now, by the same rule as everything else in a
 * call. Someone with only the link has no account to keep anything under, and doesn't get the note it would go with.
 */
export async function personalIn(v: Viewer, callId: string, session: () => Promise<Owner | undefined>): Promise<personal.Place> {
  requireIn(v, 'personal');
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  const ctx = { callId, role: v.pass.role };
  const ended = () => new ConflictError('This call has ended. Your own notes are with its notes.', { context: ctx });
  if (row.state !== 'live') throw ended();
  if (v.role === 'guest') throw new ForbiddenError('You joined with the link, so there’s no account to keep your own notes under.', { context: ctx });
  const s = settle(state, row);
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  const author = await session();
  if (!author) throw new AuthError('Sign in to Alcove first.', { context: ctx });
  const same = v.pass.role === 'host' ? author.ownerId === o.ownerId : !!mine?.email && (await profile(author)).email.toLowerCase() === mine.email.toLowerCase();
  if (!same) throw new ForbiddenError('This browser is signed in to another account.', { context: ctx });
  const noteId = s.notes.noteId;
  if (!noteId) throw new ConflictError('Your own notes go with the call’s, and notes haven’t been on in this call.', { context: ctx });
  const place = mine ? placeOf(s, mine) : MAIN_PLACE;
  const here = place === MAIN_PLACE ? null : place;
  return {
    author, noteOwnerId: o.ownerId, noteId,
    reader: async () => {
      const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
      const heard = await transcripts.lines(o, o.pool, noteId, mayRead(v, s, mine, row.started_at, invitedIn(meeting)));
      const said = saidIn(row.started_at);
      const lines = transcripts.spoken(heard, speakersIn(s, await me(o), v), roomsIn(s)).map((l, i): personal.LiveLine => {
        const h = heard[i];
        return { ...l, when: h?.when, said: h ? said(h) : undefined };
      });
      const t = tenthsIn(row.started_at);
      // Marked while nothing is captured here: there'll be nothing there to open, and the recording doesn't move on.
      const at = capturing(row, s, place).status === 'on' ? capture.recorded(s.notes.history, s.notes.offline, t, t) : null;
      return personal.callReader(lines, here, { kind: 'moment', at, when: Date.now(), room: here });
    },
    // Ending the call takes its row: anything written after it isn't in time for who gets the note to be settled.
    holdNote: async (c) => {
      if ((await load(o, c, callId, 'share')).row.state !== 'live') throw ended();
      if (!(await exec(c, `SELECT 1 FROM items WHERE owner_id = $1 AND item_id = $2 AND kind = 'note' AND deleted_at IS NULL FOR KEY SHARE`, [o.ownerId, noteId]))) throw notFound('Those notes', { noteId });
    }
  };
}
