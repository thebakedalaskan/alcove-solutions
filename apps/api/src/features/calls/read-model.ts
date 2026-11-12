import { LIVE_TRANSCRIPT_LINES, MAIN_PLACE, type Breakouts, type CallHost, type CallState, type Person, type CallWorkspace, type CallWorkspaceAsk } from '@alcove/api';
import { z } from 'zod';
import { type Db } from '../../db';
import { limitsNow } from '../../limits';
import { me } from '../account/account';
import * as space from './workspace';
import * as boards from './boards';
import { personOf, portraitFor } from '../account/portraits';
import { segments } from '../recordings/audio';
import * as capture from './capture';
import { MeetingManifest } from '../meetings/service';
import { getItem } from '../../vault';
import { standIns } from './hosting';
import { admissionFresh, groupOf, placeOf, readerOf, type Room } from './places';
import * as rings from './rings';
import { scribeOf } from './scribes';
import * as transcripts from '../recordings/transcripts';
import { hostAway, load, screensOf, secondsIn, settle, type Row, type Stored } from './state';
import * as models from '../notes/models';
import { forViewer, invitedIn, mayRead, personFor, roomsIn, seatKey, seatOf, speakersIn, type Viewer } from './participants';
import { NO_NOTES, boardFor, notesFor } from './insights';
import { attentionFor, openAttention } from './attention';
import { stopLost } from './workspace-state';
import { chatReadFor } from './chat-read';

/**
 * Rooms as the call shows them: the people sent to each, and who's in each now, by identity (the organizer too, in
 * the room they're visiting). A guest has only the link, so of the people sent to a room they see those in the call,
 * by name, and nobody's address. A guest sent to a room is shown by name only, to everyone, under their seat.
 */
function breakoutsOf(s: Stored, v: Viewer, organizer: Person, seats: Uint8Array): Breakouts {
  const here = s.people.filter((j) => j.status === 'in');
  const open = s.breakouts.open;
  const shown = (e: string): Person[] => {
    if (v.role !== 'guest') return [personOf(e)];
    const j = here.find((x) => x.email?.toLowerCase() === e);
    return j ? [forViewer(v, personFor(j, j.identity, j.name, organizer), j.identity)] : [];
  };
  const guestOf = (g: z.infer<typeof Room>['guests'][number]) => {
    const j = here.find((x) => x.person === g.person) ?? (v.role === 'guest' ? undefined : s.people.findLast((x) => x.person === g.person));
    if (!j) return [];
    const seat = seatOf(seats, j);
    const id = j.status === 'in' ? j.identity : seat;
    return [{ seat, person: { id, name: g.name, email: '', portrait: portraitFor(id) } }];
  };
  const roomOf = (r: z.infer<typeof Room>, live: boolean) => ({
    id: r.id, name: r.name, people: r.emails.flatMap(shown), guests: r.guests.flatMap(guestOf),
    members: live ? here.filter((j) => placeOf(s, j) === r.id).map((j) => j.identity) : []
  });
  return {
    open: open ? {
      rooms: open.rooms.map((r) => ({ ...roomOf(r, true), paused: r.pauses.at(-1)?.paused === true, board: s.board.open[r.id] !== undefined })),
      board: open.board.mode, from: open.from, until: open.until, message: open.message
    } : null,
    held: s.breakouts.held.map((h) => ({ rooms: h.rooms.map((r) => roomOf(r, false)), from: h.from, to: h.to }))
  };
}

export async function view(v: Viewer, db: Db, callId: string): Promise<CallState> {
  const o = v.organizer;
  const { row, state: s } = await load(o, db, callId);
  const meeting = await getItem(o, db, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const organizer = await me(o);
  const end = row.ended_at ?? new Date();
  const base = {
    revision: row.version, callId, meetingId: row.meeting_item_id, code: meeting.manifest.code, title: meeting.manifest.title, startedAt: row.started_at.toISOString(),
    elapsed: Math.max(0, Math.round((end.getTime() - row.started_at.getTime()) / 1000)), endsAt: new Date(row.started_at.getTime() + (await limitsNow(o, db)).get('call.max_seconds') * 1000).toISOString(),
    phase: row.state === 'live' ? 'in-call' as const : 'ended' as const,
    locked: row.locked, pointing: s.pointing, generation: row.mls_generation, isOrganizer: v.isOrganizer, isHost: v.isHost && s.host === v.pass.identity, role: v.role,
    chatRead: chatReadFor(v, s)
  };
  // Someone still waiting to be let in learns what's captured, and nothing else: nobody's name, nothing that was said.
  if (!v.inCall) {
    return {
      ...base, attention: { place: 'main', hands: [], questions: [], nudges: [], cues: [], latest: 0, serverNow: end.toISOString() }, participants: [], waiting: [], ringing: [], leaving: [], spotlight: null, breakouts: { open: null, held: [] }, capture: anonymousCapture(s, row, await models.isPrivate(o.cfg, s.notes.model)), notes: { everOn: false, noteId: null, segmentStartedAt: null, recording: { segment: 0, pieces: 0, seconds: 0 }, keepsRecording: meeting.manifest.choices.keepRecording },
      host: { id: null, standIn: false, organizer: { id: 'organizer', name: '', email: '' }, next: [] }, transcript: [], liveNotes: NO_NOTES, workspace: PRIVATE, board: boards.NO_BOARD, timer: null, notices: [], shares: []
    };
  }
  const rooms = settle(s, row, end.getTime());
  const segs = s.notes.recordingId ? await segments(o, s.notes.recordingId) : [];
  // What was said where the viewer is now, while they were there: one room's lines never show in another, or in the main room.
  const viewing = rooms.people.find((j) => j.identity === v.pass.identity);
  const invited = invitedIn(meeting);
  const heard = s.notes.noteId && row.state === 'live' ? await transcripts.latest(o, db, s.notes.noteId, LIVE_TRANSCRIPT_LINES, mayRead(v, rooms, viewing, row.started_at, invited)) : [];
  const where = viewing ? placeOf(rooms, viewing) : MAIN_PLACE;
  const open = rooms.breakouts.open;
  const roomHere = open?.rooms.find((r) => r.id === where);
  // Who's in: whoever the host's browser let into the group and hasn't left. Never asked of LiveKit, so reads cost nothing there.
  const here = row.state === 'live' ? s.people.filter((j) => j.status === 'in') : [];
  const seats = seatKey(o, callId);
  const mine = s.notes.asks.find((a) => a.person === v.pass.person);
  const who = hostOf(rooms, v, organizer, row.state === 'live');
  const kept = openAttention(o, callId, row.attention_ciphertext, { ciphertext: row.state_ciphertext, state: rooms });
  const { attention, statuses } = attentionFor(v, callId, rooms, kept, organizer, end.getTime());
  // Who's asking to see the workspace, from whoever is in the call now: for the organizer, as they see everyone.
  const asks: CallWorkspaceAsk[] = !v.isOrganizer ? [] : rooms.workspace.asks.flatMap((a) => {
    const j = here.findLast((p) => p.person === a.person);
    return a.state === 'asking' && j ? [{ id: a.id, participantId: j.identity, person: personFor(j, j.identity, j.name, organizer), at: new Date(a.at).toISOString() }] : [];
  });
  const { shown: workspace, lost } = await space.shownTo({ v, callId, meeting: meeting.manifest, s: rooms, place: where, chosenBy: who.organizer, asks });
  if (lost.present.length || lost.space.length || lost.play.length) await stopLost(o, callId, lost);
  return {
    ...base, attention, timer: s.timer,
    participants: here.map((j) => ({
      id: j.identity, seat: seatOf(seats, j), person: forViewer(v, personFor(j, j.identity, j.name, organizer), j.identity), isMe: j.identity === v.pass.identity,
      isOrganizer: j.role === 'host', hand: attention.hands.some((h) => h.participantId === j.identity), status: statuses.get(readerOf(j)) ?? null, othersPoint: !s.othersPointOff.includes(j.person)
    })),
    spotlight: s.spotlight && here.some((j) => j.identity === s.spotlight) ? s.spotlight : null,
    breakouts: breakoutsOf(rooms, v, organizer, seats),
    waiting: v.isHost && s.host === v.pass.identity ? s.people.filter((j) => j.status === 'waiting' && admissionFresh(j) && j.admit === 'ask' && j.keysFor === row.mls_generation).map((j) => ({ id: j.identity, person: personFor(j, j.identity, j.name, organizer) })) : [],
    ringing: v.isOrganizer ? await rings.rungIn(o, db, row.meeting_item_id, here.flatMap((j) => (j.email ? [j.email.toLowerCase()] : []))) : [],
    // Connections on their way out of their group (the host's browser takes them out), shown as who they are.
    leaving: row.state === 'live' ? s.people.filter((j) => j.status === 'left' && groupOf(s, j) !== null && j.role !== 'host').map((j) => ({
      id: j.identity, seat: seatOf(seats, j), person: forViewer(v, personFor(j, j.identity, j.name, organizer), j.identity),
      now: s.people.find((x) => x.person === j.person && x.status === 'in')?.identity ?? null
    })) : [],
    host: who,
    capture: {
      ...capture.stateFor({
        status: s.notes.status, history: s.notes.history, startedAt: row.started_at, organizer: organizer.name, unavailable: s.notes.unavailable, away: hostAway(row), screens: screensOf(s), model: s.notes.model, modelPrivate: await models.isPrivate(o.cfg, s.notes.model), allowScreens: meeting.manifest.choices.allowScreens,
        gaps: capture.gapsOf(s.notes.history, s.notes.offline, row.started_at, segs, row.ended_at ? secondsIn(row.started_at, row.ended_at.getTime()) : undefined),
        // Open asks, from whoever is in the call now: everyone sees them, like raised hands.
        requests: s.notes.asks.flatMap((a) => {
          const j = here.findLast((p) => p.person === a.person);
          return a.state === 'asking' && j ? [{ id: a.id, participantId: j.identity, at: new Date(a.at).toISOString() }] : [];
        }),
        asked: mine ? { state: mine.state, at: new Date(mine.at).toISOString() } : null,
        limit: s.notes.limit, organizerSees: v.isOrganizer
      }),
      // In a breakout room, what's captured there as well: the call's capture, held while the organizer has paused the room.
      room: open && roomHere ? capture.roomStateFor({
        status: s.notes.status, history: s.notes.history, offline: s.notes.offline, startedAt: row.started_at, organizer: organizer.name,
        room: { id: roomHere.id, from: open.from, pauses: roomHere.pauses, scribe: scribeOf(rooms, roomHere.id) }, now: secondsIn(row.started_at, end.getTime())
      }) : null
    },
    shares: row.state === 'live' ? s.shares.filter((x) => x.until === null).map((x) => ({ id: x.id, participant: x.identity, keep: x.keep })) : [],
    notes: { everOn: s.notes.everOn, noteId: s.notes.noteId, segmentStartedAt: s.notes.everOn ? new Date(row.started_at.getTime() + s.notes.segmentFrom * 1000).toISOString() : null, recording: { segment: s.notes.segment, pieces: segs.reduce((n, g) => n + g.pieces, 0), seconds: segs.reduce((n, g) => n + g.seconds, 0) }, keepsRecording: meeting.manifest.choices.keepRecording },
    // Lines stay inside their segment once it's over, so what was said before a pause is shown before it.
    transcript: transcripts.spoken(transcripts.placed(heard, segs, s.notes.status === 'on' ? s.notes.segment : undefined), speakersIn(rooms, organizer, v), roomsIn(rooms)),
    liveNotes: await notesFor(v, db, row, rooms, viewing, where, invited),
    workspace,
    board: await boardFor(v, rooms, viewing, where, row, invited),
    // Each notice to the people it's for: everyone, only those in the room it's about, one connection, or everyone but one.
    notices: s.notices.filter((n) => (n.place === undefined || n.place === where) && (n.to === undefined || n.to === v.pass.identity) && n.not !== v.pass.identity)
      .map((n) => ({ id: n.id, text: n.text, kind: n.kind }))
  };
}

/** What someone who isn't in the call yet is told of its workspace: nothing. */
const PRIVATE: CallWorkspace = { id: null, home: null, name: null, chosenBy: { id: 'organizer', name: '', email: '' }, canOpen: false, role: null, documents: [], agenda: null, present: null, ended: null, play: null, asks: [], asked: 'no' };

/**
 * Who hosts, as this viewer sees it: the connection hosting now and whether it stands in for the organizer, the
 * organizer by name, and for whoever hosts, who could take over from them (never a guest).
 */
function hostOf(s: Stored, v: Viewer, organizer: Person, live: boolean): CallHost {
  const host = live ? s.people.find((j) => j.identity === s.host) : undefined;
  const organizerHere = s.people.find((j) => j.role === 'host' && j.status === 'in');
  return {
    id: host?.identity ?? null,
    standIn: host !== undefined && host.role !== 'host',
    organizer: forViewer(v, organizer, organizerHere?.identity ?? 'organizer'),
    next: v.isHost ? standIns(s, new Set([v.pass.identity])).map((j) => j.identity) : []
  };
}

/**
 * What's captured, for someone who isn't in the call (asking to join, or reading the call's card): no names, no gaps, no
 * asks, and not which model, only whether it's private, so they know before they come in.
 */
export function anonymousCapture(s: Stored, row: Pick<Row, 'started_at' | 'state' | 'host_identity' | 'host_left_at'>, modelPrivate: boolean) {
  return capture.stateFor({ status: s.notes.status, history: s.notes.history, startedAt: row.started_at, organizer: null, unavailable: s.notes.unavailable, away: hostAway(row), screens: screensOf(s), model: null, modelPrivate, allowScreens: false, gaps: [], requests: [], asked: null, limit: s.notes.limit, organizerSees: false });
}
