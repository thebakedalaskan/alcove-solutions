/*
 * A call, played from its script (script.ts). LiveKit can't run in Storybook, so this is the server's side of the
 * script: who's in the call, what it captures, the transcript and the live notes, who's asking to join and who's being
 * rung, breakout rooms, and who hosts. LiveKit's side (everyone else's microphones, who's speaking, what they share and
 * your own connection) is `livekit`, which the scripted room (src/media/livekit.ts) plays to the call screen. Every control
 * does to the snapshot what the server would; leaving ends the call for whoever hosts and leaves its note being written.
 * The call's workspace is played here too: its home, settled the first time Workspace opens, what's brought, presented and
 * played, who's asking to see it, and where everyone else is in it. So is a board in the call: one you open, or one someone in
 * the script opens, made in the call's home and filled from its template as the server does, with whoever works on it on it,
 * and its timer and vote.
 */
import {
  AlcoveApiError, MAX_CALL_IDEAS, RING_SECONDS, notesAreOn, type BreakoutPlan, type CallPage, type CallAnswer, type CallCrypto, type CallEndResult, type CallMoment, type CallMoveOut, type CallParticipant, type CallRole,
  type CallSession, type CallState, type CallTicket, type CaptionLanguage, type CaptionTranslation, type CaptureDevicePart, type CaptureGap, type CaptureMode, type CapturePart,
  type CatchUp, type CatchUpRange, type CatchUpWindow, type AudioPiece, type LineAudio, type Meeting, type MoveMedia, type MoveOutState, type Person, type PersonalApi,
  type RingReply, type RoomCapture, type ScreenFrame, type ScreenFrameReceipt, type SeriesAnswerPart, type TranscriptClip, type TranscriptLine
} from '@alcove/api';
import type {
  BoardCheck, BoardOpen, BoardTemplate, BoardTimerMinutes, BoardVotesEach, BreakoutBoard, BreakoutBoardMode, CallBoard, CallBoardIdea, CallFollowUp, CallFollowUps, CallPresent, CallSeat, CallWorkspace,
  CallWorkspaceSwitch, DocFollowUpTick, DocumentRole, PresentKind, WorkspaceHere, WorkspaceItem
} from '@alcove/api';
import { addObject, colourIn, fillTemplate, landBoards, readBoard, roomFrameId, roomFrames, type FrameObject } from '@alcove/board';
import { sessions } from '~/lib/live';
import { talking } from '../browser';
import type { Screen } from '../media/screens';
import { writeNote } from '../world/build';
import { quietAudio } from './media';
import { personAt } from '../world/people';
import type { Space } from '../world';
import { Pushed, Snapshots } from './live';
import { personalFor } from './personal';
import { captureOf, defaultScript, linkState, part, scriptFor, type Beat, type CallScript, type HeardIdea, type Line, type Present, type RoomPlan } from './script';
import { current, me as you, nextId } from './state';
import { boardDoc, createItem, hereIn, onTheBoard, peopleIn, restrict, shareWith, tagYou, treeOf } from './workspaces';

/** A connection's identity in a call: `p_` and 22 characters, as LiveKit's are. */
const identity = (seed: string) => `p_${seed.replace(/[^A-Za-z0-9]/g, '').padEnd(22, 'x').slice(-22)}`;
const sameAs = (a: Person, b: Person) => a.id === b.id || (a.email !== '' && a.email.toLowerCase() === b.email.toLowerCase());
const firstOf = (p: Person) => p.name.split(' ')[0] ?? p.name;
/** How long a line takes to say. */
const sayingMs = (text: string) => Math.min(5600, Math.max(2200, text.length * 55));
/** How long after the organizer's connection drops someone invited hosts in their place. */
const TAKE_OVER_MS = 10_000;

/** What LiveKit says about everyone else's browser, and about your own connection to the room. */
export interface RoomSide {
  /** Everyone else in the room, by identity: their microphone, whether they're speaking, and what they share (with its sound or not). */
  people: Readonly<Record<string, { mic: boolean; speaking: boolean; screen: Screen | null; sound: boolean }>>;
  connection: 'connected' | 'reconnecting' | 'ended';
  endReason: 'ended-by-host' | 'removed' | 'error' | null;
  /** How many times whoever hosts has muted your microphone. */
  mutedYou: number;
}
type Them = RoomSide['people'][string];

class Crypto extends Pushed<CallCrypto> {}

/** How you came to the call: what the call says you are, and whether you ask to be let in first. */
export interface Arrival { role: CallRole; asking: boolean; name?: string | undefined }

export class ScriptedCall extends Snapshots<CallState> implements CallSession {
  readonly ticket: CallTicket;
  readonly crypto: Crypto;
  readonly personal: PersonalApi;
  /** LiveKit's side: the scripted room plays it. */
  readonly livekit: Pushed<RoomSide>;
  private readonly script: CallScript;
  private readonly me: CallParticipant;
  /** The note this call writes, once notes have been on: your own notes on the call (`personal`) go with it. */
  private readonly noteId: string;
  /** People who came in with the link, by name, and so don't get the notes. */
  private guests = new Set<string>();
  /** Everyone's seat, by address or name: the same across their reconnections. */
  private seats = new Map<string, string>();
  private connections = 0;
  /** What's been heard while notes were on, with what the notes take from it. */
  private heard: { line: Line; id: string; at: number }[] = [];
  private ticked = new Set<string>();
  private watching = 0;
  private notesFor = -1;
  private writing = false;
  /** Until when you're saying a line, so your microphone murmurs as a voice does, and until when each of them is. */
  private voiceUntil = 0;
  private speakingUntil = new Map<string, number>();
  /** The organizer's connection dropped: since when, for the stretch the notes mark. */
  private away: { from: string; at: number; organizer: Person; seat: string } | null = null;
  /**
   * The board open in each part of the call, as the server keeps them (`main`, or a room's ID): where it's kept and who opened
   * it, by participant ID; what rooms were opened with to work on; and each room's own board, which comes back when they close.
   */
  private boards = new Map<string, { at: { workspaceId: string; documentId: string } | null; openedBy: string; made: boolean }>();
  private boardMode: BreakoutBoardMode = 'none';
  private roomBoards = new Map<string, { workspaceId: string; documentId: string; name: string; who: string[] }>();
  /** What's presented in each part of the call, as the server keeps it: by whom (a participant ID), which board, and which frame everyone's on. */
  private presented = new Map<string, { by: string; id: string; section: number }>();
  /** Who's on the board where you are besides you, by their connection, and where their pointer is. */
  private onIt = new Map<string, { x: number; y: number }>();

  constructor(private readonly meeting: Meeting, arrival: Arrival) {
    const script = scriptFor(meeting.code) ?? defaultScript(meeting);
    const callId = nextId('call');
    const noteId = nextId('note');
    const since = script.since ?? 0;
    const startedAt = new Date(Date.now() - since * 1000).toISOString();
    const organizes = arrival.role === 'host';
    const person: Person = arrival.name ? { id: `guest-${callId}`, name: arrival.name, email: '' } : you();
    const me: CallParticipant = { id: identity(`me${callId}`), seat: 'seat-me', person, isMe: true, isOrganizer: organizes, hand: false, othersPoint: true };
    const mode = script.notes ?? meeting.notes;
    super({
      callId, meetingId: meeting.id, code: meeting.code, title: meeting.title, startedAt, elapsed: since, phase: 'in-call', participants: organizes ? [me] : [], locked: false, pointing: true,
      spotlight: null, breakouts: { open: null, held: [] }, capture: captureOf(mode, mode === 'off' ? null : startedAt, meeting.organizer.name),
      notes: { everOn: mode !== 'off', noteId: mode !== 'off' ? noteId : null, recording: { segment: 0, pieces: 0, seconds: mode === 'on' ? since : 0 } }, waiting: [], ringing: [], leaving: [],
      host: { id: organizes ? me.id : null, standIn: false, organizer: meeting.organizer, next: [] }, generation: 1, transcript: [],
      liveNotes: { notes: null, added: [], writing: false, error: null }, notices: mode === 'on' && !since ? [{ id: nextId('notice'), text: 'Notes are on. Everyone here can see that.', kind: 'notes' }] : [],
      isOrganizer: organizes, isHost: organizes, role: arrival.role,
      workspace: { id: null, home: null, name: null, chosenBy: meeting.organizer, canOpen: false, role: null, documents: [], agenda: null, present: null, play: null, asks: [], asked: 'no' },
      board: { open: null, timer: null, vote: null, ideas: [] }
    });
    this.script = script;
    this.me = me;
    this.noteId = noteId;
    this.ticket = { callId, serverUrl: 'wss://livekit.storybook.invalid', roomName: `room-${callId}`, identity: me.id, role: arrival.role, pass: `${callId}.storybook` };
    this.crypto = new Crypto({ status: arrival.asking ? 'waiting' : 'in', place: 'main', members: arrival.asking ? [] : [me.id], everyone: arrival.asking ? [] : [me.id], media: null, chat: [], missedChat: false });
    this.personal = personalFor(noteId);
    this.livekit = new Pushed<RoomSide>({ people: {}, connection: 'connected', endReason: null, mutedYou: 0 });

    // Whoever's here already, the organizer first when it isn't you.
    const here: Present[] = [...(script.here ?? [])];
    if (!organizes && !here.some((p) => p.organizer)) here.unshift({ who: meeting.organizer, organizer: true });
    for (const p of here) this.join(p.who, { organizer: p.organizer, guest: p.guest, mic: p.mic, hand: p.hand, sharing: p.sharing });
    // You come in after them, unless you organized it (or you're asking to be let in).
    if (!organizes && !arrival.asking) this.change((s) => ({ ...s, participants: [...s.participants, me] }));
    // What was said before you came, spread over the time the call has been going.
    const earlier = script.earlier ?? [];
    earlier.forEach((l, i) => this.heardLine(l, Math.round(((i + 1) / (earlier.length + 1)) * since)));
    // Joining late, the call's notes have been written already.
    if (this.heard.length) {
      this.notesFor = this.heard.length;
      this.change((s) => ({ ...s, liveNotes: { ...s.liveNotes, notes: this.notesNow(), writing: false, error: null } }));
    }
    // The organizer back after someone hosted in their place hosts again at once, and hears who did.
    const stoodIn = script.door?.standIn;
    if (organizes && stoodIn) this.change((s) => ({ ...s, notices: [...s.notices, { id: nextId('notice'), text: `You’re hosting again. ${firstOf(stoodIn)} hosted while you were away.`, kind: 'people' }] }));
    this.hosting();
    linkState(meeting.code, () => ({ hostHere: true, standIn: null, locked: false, capture: this.getSnapshot().capture, ended: false }));
    talking(false);

    this.every(1000, () => this.tick());
    const talk = script.talk;
    if (talk) talk.lines.forEach((l, i) => this.after(((talk.from ?? 2) + i * (talk.every ?? 4.5)) * 1000, () => this.say(l)));
    for (const cue of script.cues ?? []) this.after(cue.at * 1000, () => this.play(cue.beat));
  }

  /* ---------- the script ---------- */

  private tick(): void {
    this.change((s) => ({
      ...s, elapsed: s.elapsed + 1, workspace: s.workspace.play ? { ...s.workspace, play: { ...s.workspace.play, nowMs: Date.now() } } : s.workspace,
      notes: { ...s.notes, recording: s.capture.mode === 'on' ? { ...s.notes.recording, seconds: s.notes.recording.seconds + 1, pieces: Math.floor((s.notes.recording.seconds + 1) / 5) } : s.notes.recording }
    }));
    // The organizer's browser brings everyone back when the rooms' time is up; in the script, the organizer's isn't yours.
    const open = this.getSnapshot().breakouts.open;
    if (open && !this.getSnapshot().isHost && this.getSnapshot().elapsed >= open.until) this.closeRooms();
  }

  private play(b: Beat): void {
    switch (b.do) {
      case 'join': this.join(b.who, { guest: b.guest, mic: b.mic }); this.hosting(); return;
      case 'leave': this.goes(b.who); return;
      case 'say': this.say(b.line); return;
      case 'mic': this.them(b.who, (t) => ({ ...t, mic: b.on, speaking: b.on && t.speaking })); return;
      case 'hand': this.change((s) => ({ ...s, participants: s.participants.map((p) => (!p.isMe && sameAs(p.person, b.who) ? { ...p, hand: b.up } : p)) })); return;
      case 'share': this.them(b.who, (t) => ({ ...t, screen: b.screen })); return;
      case 'stop-sharing': this.them(b.who, (t) => ({ ...t, screen: null })); return;
      case 'chat': {
        const p = this.find(b.who);
        if (p) this.crypto.update((c) => ({ ...c, chat: [...c.chat, { id: nextId('chat'), from: p.id, isMe: false, text: b.text, at: Date.now(), place: c.place }] }));
        return;
      }
      case 'knock': {
        const person: Person = b.byName ? { id: `guest-${b.who.name}`, name: firstOf(b.who), email: '' } : b.who;
        this.change((s) => ({ ...s, waiting: [...s.waiting, { id: identity(`ask${person.name}${this.ticket.callId}`), person }] }));
        return;
      }
      case 'ask-for-notes': {
        const p = this.find(b.who);
        if (p) this.change((s) => ({ ...s, capture: { ...s.capture, requests: [...s.capture.requests, { id: nextId('ask'), participantId: p.id, at: new Date().toISOString() }] } }));
        return;
      }
      case 'notes': this.capture(b.mode); return;
      case 'not-now': this.change((s) => ({ ...s, capture: { ...s.capture, requests: s.capture.requests.filter((r) => r.participantId !== this.me.id), asked: s.capture.asked ? { state: 'declined', at: new Date().toISOString() } : null } })); return;
      case 'rooms': this.opensRooms(b.rooms, b.minutes, b.board); return;
      case 'message-rooms': this.messageRooms(b.text); return;
      case 'close-rooms': this.closeRooms(); return;
      case 'let-in': this.letMeIn(); return;
      case 'turn-away': this.crypto.update((c) => ({ ...c, status: 'denied' })); return;
      case 'mute-you': this.livekit.update((r) => ({ ...r, mutedYou: r.mutedYou + 1 })); return;
      case 'remove-you': this.livekit.update((r) => ({ ...r, connection: 'ended', endReason: 'removed' })); this.halt(); return;
      case 'end': this.ends(); return;
      case 'reconnect':
        this.livekit.update((r) => ({ ...r, connection: 'reconnecting' }));
        this.after(b.seconds * 1000, () => this.livekit.update((r) => ({ ...r, connection: 'connected' })));
        return;
      case 'drop': this.livekit.update((r) => ({ ...r, connection: 'ended', endReason: 'error' })); return;
      case 'host-drops': this.hostDrops(); return;
      case 'host-back': this.hostBack(); return;
      case 'goes-to': {
        const p = this.find(b.who);
        if (p) { this.where.set(p.id, { document: b.document, typing: b.typing ?? false, page: b.page ?? null }); this.sayWhere(); }
        return;
      }
      case 'present': {
        if (b.document !== undefined) { this.theyPresent(b.who, b.document, b.section ?? 0); return; }
        // The board open in the main room, from a frame.
        const p = this.find(b.who);
        const open = this.boards.get('main')?.at;
        if (p && open) this.presented.set('main', { by: p.id, id: open.documentId, section: b.section ?? 0 });
        this.showBoard();
        return;
      }
      case 'move-presenting': {
        const board = this.presented.get('main');
        if (board) { this.presented.set('main', { ...board, section: b.section }); this.showBoard(); return; }
        this.space((w) => (w.present ? { ...w, present: { ...w.present, section: w.present.id === null ? null : b.section } } : w));
        return;
      }
      case 'stop-presenting':
        if (this.presented.delete('main')) { this.showBoard(); return; }
        this.space((w) => ({ ...w, present: null }));
        return;
      case 'play': this.theyPlay(b.who, b.document, b.media); return;
      case 'stop-playing': this.space((w) => ({ ...w, play: null })); return;
      case 'ask-to-see': {
        const p = this.find(b.who);
        if (p && this.getSnapshot().isOrganizer) this.space((w) => ({ ...w, asks: [...w.asks, { id: nextId('see'), participantId: p.id, person: p.person, at: new Date().toISOString() }] }));
        return;
      }
      case 'not-now-to-see': this.space((w) => (w.asked === 'asking' ? { ...w, asked: 'declined' } : w)); return;
      case 'tag-you': this.tagsYou(b.who, b.document, b.block ?? null); return;
      case 'open-board': this.theyOpenBoard(b.who, b.template, b.closedToYou ?? false, b.draw, b.standing); return;
      case 'add-sticky': this.theyAddSticky(b.who, b.frame, b.text); return;
      case 'close-board': this.boardGoes(); return;
      case 'start-timer': this.theyStartTimer(b.who, b.minutes, b.left); return;
      case 'stop-timer': void this.session((x) => ({ ...x, timer: null })); return;
      case 'start-vote': this.theyStartVote(b.who, b.frame, b.per); return;
      case 'end-vote': this.voteEnds(b.votes, b.voters); return;
      case 'clear-vote': void this.session((x) => ({ ...x, vote: null })); return;
      case 'heard': this.theyAreHeard(b.ideas); return;
      case 'run': b.what(); return;
    }
  }

  /** Someone in the call, by who they are. */
  private find(p: Person): CallParticipant | undefined {
    return this.getSnapshot().participants.find((x) => !x.isMe && sameAs(x.person, p));
  }
  /** Changes what LiveKit says about someone's browser. */
  private them(p: Person, change: (t: Them) => Them): void {
    const id = this.find(p)?.id;
    const now = id ? this.livekit.getSnapshot().people[id] : undefined;
    if (id && now) this.livekit.update((r) => ({ ...r, people: { ...r.people, [id]: change(now) } }));
  }

  private join(p: Person, o: { organizer?: boolean | undefined; guest?: boolean | undefined; mic?: boolean | undefined; hand?: boolean | undefined; sharing?: Screen | undefined } = {}): void {
    if (this.find(p)) return;
    this.connections += 1;
    const key = p.email || p.name;
    const seat = this.seats.get(key) ?? `seat-${this.seats.size + 1}`;
    this.seats.set(key, seat);
    const id = identity(`${key}${this.ticket.callId}${this.connections}`);
    if (o.guest) this.guests.add(id);
    const joined: CallParticipant = { id, seat, person: p, isMe: false, isOrganizer: o.organizer ?? false, hand: o.hand ?? false, othersPoint: true };
    this.change((s) => ({ ...s, participants: [...s.participants, joined], host: o.organizer && !this.away ? { ...s.host, id } : s.host }));
    this.crypto.update((c) => ({ ...c, members: c.place === 'main' && c.status === 'in' ? [...c.members, id] : c.members, everyone: [...c.everyone, id] }));
    this.livekit.update((r) => ({ ...r, people: { ...r.people, [id]: { mic: o.mic ?? true, speaking: false, screen: o.sharing ?? null, sound: false } } }));
  }
  private goes(p: Person): void {
    const x = this.find(p);
    if (!x) return;
    // Whatever they were presenting ends with them.
    for (const [place, q] of this.presented) if (q.by === x.id) this.presented.delete(place);
    this.change((s) => ({
      ...s, participants: s.participants.filter((q) => q.id !== x.id), spotlight: s.spotlight === x.id ? null : s.spotlight,
      breakouts: s.breakouts.open ? { ...s.breakouts, open: { ...s.breakouts.open, rooms: s.breakouts.open.rooms.map((r) => ({ ...r, members: r.members.filter((m) => m !== x.id) })) } } : s.breakouts
    }));
    this.crypto.update((c) => ({ ...c, members: c.members.filter((m) => m !== x.id), everyone: c.everyone.filter((m) => m !== x.id) }));
    this.livekit.update((r) => { const { [x.id]: _gone, ...rest } = r.people; return { ...r, people: rest }; });
    // What they presented or played for everyone ends with them, and they're not in the workspace any more.
    this.space((w) => ({ ...w, present: w.present?.by.seat === x.seat ? null : w.present, play: w.play?.by.seat === x.seat ? null : w.play }));
    if (this.where.delete(x.id)) this.sayWhere();
    this.hosting();
  }

  /** Who could host after whoever hosts now: people invited who are in the main room, by when they came. */
  private hosting(): void {
    this.change((s) => {
      if (!s.isHost) return { ...s, host: { ...s.host, next: [] } };
      const inRoom = (id: string) => !!s.breakouts.open?.rooms.some((r) => r.members.includes(id));
      const next = s.participants.filter((p) => !p.isMe && !this.guests.has(p.id) && p.person.email !== '' && !inRoom(p.id)).map((p) => p.id);
      return { ...s, host: { ...s.host, next } };
    });
  }

  /** What's said: whoever says it speaks for a moment, and while notes are on where they are, it's transcribed. */
  private say(l: Line): void {
    const mine = l.who === 'me';
    const who = l.who === 'me' ? this.getSnapshot().participants.find((p) => p.isMe) : this.find(l.who);
    if (!who) return;
    // Nobody hears a microphone that's off.
    if (mine ? !sessions.media?.getSnapshot().mic : !this.livekit.getSnapshot().people[who.id]?.mic) return;
    const ms = sayingMs(l.text);
    if (mine) {
      this.voiceUntil = Date.now() + ms;
      talking(true);
      this.after(ms, () => { if (Date.now() >= this.voiceUntil) talking(false); });
    } else {
      this.them(who.person, (t) => ({ ...t, speaking: true }));
      this.speakingUntil.set(who.id, Date.now() + ms);
      this.after(ms, () => { if (Date.now() >= (this.speakingUntil.get(who.id) ?? 0) - 30) this.them(who.person, (t) => ({ ...t, speaking: false })); });
    }
    this.heardLine(l, this.getSnapshot().elapsed);
  }
  /** A line into the transcript, if notes are on where it was said and you're there to read it. */
  private heardLine(l: Line, at: number): void {
    const s = this.getSnapshot();
    const here = s.capture.room ? s.capture.room.mode : s.capture.mode;
    const who = l.who === 'me' ? s.participants.find((p) => p.isMe) : this.find(l.who);
    const c = this.crypto.getSnapshot();
    if (!who || here !== 'on' || c.status === 'waiting' || c.status === 'denied' || (!who.isMe && c.status === 'in' && !c.members.includes(who.id))) return;
    const id = nextId('line');
    const room = s.capture.room ? s.breakouts.open?.rooms.find((r) => r.id === s.capture.room?.id) : undefined;
    const t: TranscriptLine = { id, at, speaker: { name: who.person.name, person: who.person }, text: l.text, ...(room ? { room: { id: room.id, name: room.name } } : {}) };
    this.heard.push({ line: l, id, at });
    this.push({ ...s, transcript: [...s.transcript, t] });
    this.writeNotesSoon();
  }

  /* ---------- the live notes ---------- */

  /** While anyone's watching, the notes are written again a few seconds after something new is said. */
  private writeNotesSoon(): void {
    if (this.watching < 1 || this.writing || this.heard.length === this.notesFor) return;
    this.writing = true;
    this.after(2500, () => {
      this.change((s) => ({ ...s, liveNotes: { ...s.liveNotes, writing: true } }));
      this.after(1500, () => {
        this.writing = false;
        this.notesFor = this.heard.length;
        this.change((s) => ({ ...s, liveNotes: { ...s.liveNotes, notes: this.notesNow(), writing: false, error: null } }));
        this.writeNotesSoon();
      });
    });
  }
  private named(who: Person | 'me' | undefined): string | undefined {
    if (!who) return undefined;
    return who === 'me' ? this.me.person.name : who.name;
  }
  /** Where the call has got to, from what's been said so far. */
  private notesNow(): NonNullable<CallState['liveNotes']['notes']> {
    const s = this.getSnapshot();
    const evidence = (h: { id: string; at: number }) => [{ kind: 'transcript' as const, lineId: h.id, said: h.at }];
    const decided = this.heard.flatMap((h) => (h.line.decides ? [{ text: h.line.decides, evidence: evidence(h) }] : []));
    return {
      summary: this.summaryNow() || decided.map((d) => d.text).join(' '),
      decided,
      proposed: [], open: [],
      next: this.heard.flatMap((h) => {
        const hands = h.line.hands;
        if (!hands) return [];
        const id = `fu-${h.id}`;
        const owner = this.named(hands.owner ?? h.line.who);
        return [{ id, text: hands.text, ...(owner ? { owner } : {}), ...(hands.due ? { due: hands.due } : {}), evidence: evidence(h), done: this.ticked.has(id) }];
      }),
      read: { from: 0, to: s.elapsed, lines: s.transcript.length, through: s.transcript.at(-1)?.at ?? null, gaps: s.capture.gaps, missed: [], whileHere: false, skipped: null, asOf: s.elapsed }
    };
  }

  /** The script's summary as far as the conversation has got: each sentence once its share of the call has been said. */
  private summaryNow(): string {
    const sentences = (this.script.summary ?? '').match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [];
    if (!this.heard.length || !sentences.length) return '';
    const total = (this.script.earlier?.length ?? 0) + (this.script.talk?.lines.length ?? 0);
    const shown = total ? Math.floor((sentences.length * this.heard.length) / total) : sentences.length;
    return sentences.slice(0, shown).join('').trim();
  }

  /* ---------- what's captured ---------- */

  private capture(mode: 'on' | 'off' | 'paused'): void {
    const at = new Date().toISOString();
    const s = this.getSnapshot();
    const by = { kind: 'organizer' as const, name: s.host.organizer.name };
    const was = s.capture.mode;
    const open = (g: CaptureGap) => (g.to === null ? { ...g, to: at } : g);
    const gaps: CaptureGap[] = mode === 'on' ? s.capture.gaps.map(open) : [...s.capture.gaps.map(open), { kind: mode === 'paused' ? 'paused' : 'off', from: at, to: null, at: s.elapsed }];
    const text = mode === 'on' ? (was === 'paused' ? 'The organizer resumed notes. Everyone here can see that.' : 'The organizer turned on notes. Everyone here can see that.')
      : mode === 'paused' ? 'The organizer paused notes. Nothing is recorded, transcribed or sent to the AI until they resume.' : 'The organizer turned off notes. What was written so far is kept.';
    const asked = s.capture.asked?.state === 'asking' && mode === 'on' ? { state: 'accepted' as const, at } : s.capture.asked;
    this.push({
      ...s,
      capture: {
        ...s.capture, mode, recording: part(mode, at, by), transcript: part(mode, at, by), ai: part(mode === 'off' && !s.notes.everOn ? 'off' : mode === 'off' ? 'on' : mode, at, by),
        screen: mode === 'off' ? part('off', at, by) : s.capture.screen, gaps, requests: mode === 'on' ? [] : s.capture.requests, asked
      },
      notes: { ...s.notes, everOn: s.notes.everOn || mode === 'on', noteId: s.notes.noteId ?? (mode === 'on' ? this.noteId : null), recording: mode === 'on' && was !== 'on' ? { ...s.notes.recording, segment: s.notes.recording.segment + (s.notes.everOn ? 1 : 0) } : s.notes.recording },
      notices: [...s.notices, { id: nextId('notice'), text, kind: 'notes' }]
    });
    linkState(this.meeting.code, (l) => ({ hostHere: true, standIn: null, locked: false, ended: false, ...l, capture: this.getSnapshot().capture }));
  }

  /* ---------- asking to join, and being let in ---------- */

  private letMeIn(): void {
    if (this.crypto.getSnapshot().status !== 'waiting') return;
    const signedIn = this.me.person.email !== '';
    // Someone signed in let in from the link is on the invite now, and gets the notes.
    if (signedIn) current().meetings = current().meetings.map((m) => (m.id === this.meeting.id ? { ...m, guests: [...m.guests, this.me.person], guestCount: m.guestCount + 1 } : m));
    this.change((s) => ({ ...s, participants: [...s.participants, this.me], role: signedIn ? 'invited' : 'guest' }));
    this.crypto.update((c) => ({ ...c, status: 'in', members: [...this.getSnapshot().participants.map((p) => p.id)], everyone: this.getSnapshot().participants.map((p) => p.id) }));
  }

  /* ---------- the call's boards, in the main room and in rooms ---------- */

  /** Where the board shown in a part of the call is open: there, or in a room with none of its own while rooms share the main board, the main room. */
  private shownAt(place: string): string { return place === 'main' || this.boards.has(place) || this.boardMode !== 'shared' ? place : 'main'; }
  /** Where the board shown where you are is kept, if it's open to you. */
  private hereAt(): { workspaceId: string; documentId: string } | null { return this.boards.get(this.shownAt(this.crypto.getSnapshot().place))?.at ?? null; }
  /**
   * The board where you are, as the server says it to you: one you can't open says who brought it and nothing of itself, and one
   * in Trash or gone has left. The same board keeps its timer, vote and ideas, since its session carries on.
   */
  private boardHere(was: CallBoard): CallBoard {
    const place = this.crypto.getSnapshot().place;
    const at = this.shownAt(place);
    const b = this.boards.get(at);
    if (!b) return { open: null, timer: null, vote: null, ideas: [] };
    const openedBy = this.getSnapshot().participants.some((p) => p.id === b.openedBy) ? b.openedBy : null;
    const seen = { openedBy, canClose: b.openedBy === this.me.id || this.me.isOrganizer, seal: at === 'main' ? 'Sealed' : 'Sealed to this room', frame: at === place ? null : roomFrameId(place) };
    if (!b.at) return { open: { workspaceId: null, documentId: null, name: null, role: null, everyone: false, ...seen }, timer: null, vote: null, ideas: [] };
    const item = this.itemIn(b.at.workspaceId, b.at.documentId);
    if (!item) return { open: null, timer: null, vote: null, ideas: [] };
    const same = was.open?.documentId === b.at.documentId;
    return {
      open: { ...b.at, name: item.name, role: item.role ?? 'edit', everyone: b.made, ...seen },
      timer: same ? was.timer : null, vote: same ? was.vote : null, ideas: same ? was.ideas : []
    };
  }
  /**
   * What's presented where you are, as you may know it: the board open there, a frame at a time. A presentation of a board
   * that's closed, or by someone who's gone, is over.
   */
  private presentHere(): CallPresent | null {
    const place = this.crypto.getSnapshot().place;
    const p = this.presented.get(place);
    const open = this.boards.get(this.shownAt(place))?.at;
    const by = p ? this.getSnapshot().participants.find((x) => x.id === p.by) : undefined;
    if (!p || !by || !open || open.documentId !== p.id) return null;
    const item = treeOf(open.workspaceId).items.find((i) => i.id === p.id);
    const mine = by.id === this.me.id;
    return { kind: 'board', id: p.id, name: item?.name ?? '', section: p.section, by: { seat: by.seat, name: by.person.name }, mine, canControl: mine || this.me.isOrganizer };
  }
  /** Tells the call what's open where you are now, what's presented there, which rooms are on a board of their own, and who's on yours. */
  private showBoard(): void {
    for (const [place, p] of this.presented) if (this.boards.get(this.shownAt(place))?.at?.documentId !== p.id) this.presented.delete(place);
    this.change((s) => ({
      ...s, board: this.boardHere(s.board), workspace: { ...s.workspace, present: this.presentHere() ?? (s.workspace.present?.kind === 'board' ? null : s.workspace.present) },
      breakouts: s.breakouts.open ? { ...s.breakouts, open: { ...s.breakouts.open, board: this.boardMode, rooms: s.breakouts.open.rooms.map((r) => ({ ...r, board: this.boards.has(r.id) })) } } : s.breakouts
    }));
    this.sayWhoIsOn();
  }
  /** Who's on the board where you are now, as its awareness says them to whoever has it open. */
  private sayWhoIsOn(): void {
    const at = this.hereAt();
    if (!at) return;
    onTheBoard(at.documentId, this.getSnapshot().participants.flatMap((p) => {
      const point = this.onIt.get(p.id);
      return point && !p.isMe ? [{ callIdentity: p.id, person: p.person, at: point }] : [];
    }));
  }
  /**
   * A new board in the call's home, named as the server names it and filled from its template as the server fills it; a room's
   * is restricted, and nobody's. Someone who came with the link has no home to make one in.
   */
  private makeBoard(name: string, template: BoardTemplate, room: boolean): { workspaceId: string; documentId: string } | null {
    this.settleHome();
    const home = this.homeId;
    if (home === null) return null;
    const { id } = createItem(home, { kind: 'board', name });
    if (room) restrict(home, id, true);
    fillTemplate(boardDoc(home, id), template, null, id);
    return { workspaceId: home, documentId: id };
  }
  /** The organizer's participant ID, whoever they are here. */
  private organizerId(): string { return this.getSnapshot().participants.find((p) => p.isOrganizer)?.id ?? this.me.id; }
  /**
   * Rooms open with what they have to work on: a board each, filled, with what its people put on it as the script says; or the
   * main board, or a new one, with an empty frame for each room.
   */
  private boardsForRooms(board: BreakoutBoard | undefined, rooms: readonly { id: string; name: string; people: readonly Person[]; work?: readonly string[] | undefined }[]): void {
    this.boardMode = board?.mode ?? 'none';
    if (!board || board.mode === 'none') return;
    const by = this.organizerId();
    const who = (people: readonly Person[]) => people.map(firstOf);
    if (board.mode === 'each') {
      for (const r of rooms) {
        const made = this.makeBoard(`${r.name} board`, board.template, true);
        if (!made) continue;
        this.boards.set(r.id, { at: made, openedBy: by, made: true });
        this.roomBoards.set(r.id, { ...made, name: r.name, who: who(r.people) });
        const doc = boardDoc(made.workspaceId, made.documentId);
        const frame = readBoard(doc).frames[0] ?? { x: 0, y: 0 };
        (r.work ?? []).forEach((t, i) => this.after((3 + i * 4) * 1000, () => {
          addObject(doc, { k: 'note', x: frame.x + 20 + (i % 2) * 170, y: frame.y + 20 + Math.floor(i / 2) * 170, w: 150, h: 150, c: 'butter', size: 'm', t }, { world: true });
        }));
      }
      return;
    }
    let main = this.boards.get('main')?.at ?? null;
    if (!main) {
      main = this.makeBoard(this.meeting.title, board.template, false);
      if (!main) return;
      this.boards.set('main', { at: main, openedBy: by, made: true });
    }
    roomFrames(boardDoc(main.workspaceId, main.documentId), rooms.map((r) => ({ id: r.id, name: r.name, who: who(r.people) })), null);
  }
  /** Rooms close: what was open in them closes, and each room's own board lands on the main board, made for them if there's none. */
  private boardsBack(): void {
    this.boardMode = 'none';
    for (const id of [...this.boards.keys()]) if (id !== 'main') this.boards.delete(id);
    const coming = [...this.roomBoards].map(([room, b]) => ({ room, ...b }));
    this.roomBoards.clear();
    if (!coming.length) return;
    let main = this.boards.get('main')?.at ?? null;
    if (!main) {
      main = this.makeBoard(this.meeting.title, 'blank', false);
      if (!main) return;
      this.boards.set('main', { at: main, openedBy: this.organizerId(), made: true });
    }
    landBoards(boardDoc(main.workspaceId, main.documentId), coming.map((r) => ({ key: r.room, name: r.name, who: r.who, doc: boardDoc(r.workspaceId, r.documentId) })), null);
  }

  /* ---------- breakout rooms ---------- */

  private roomId = (k: number) => `room_${this.ticket.callId.replace(/[^A-Za-z0-9]/g, '')}_${k}`.padEnd(20, '0');
  /** What's captured in a room: never recorded, transcribed by one browser there while the call's notes are on. */
  private roomCapture(id: string, scribe: string | null, paused = false): RoomCapture {
    const s = this.getSnapshot();
    const mode: CaptureMode = paused ? 'paused' : s.capture.mode === 'unavailable' ? 'on' : s.capture.mode;
    const at = new Date().toISOString();
    const by = { kind: 'organizer' as const, name: s.host.organizer.name };
    return { id, mode, recording: part('off', null, null), transcript: part(mode, at, by), ai: part(mode, at, by), screen: part('off', null, null), gaps: [], scribe };
  }
  /** Your part of the call changes: a moment between the two (nothing heard or sent), then the new part's keys. */
  private moveTo(place: string, members: string[]): void {
    this.crypto.update((c) => ({ ...c, status: 'moving', place }));
    this.showBoard();
    this.after(1200, () => this.crypto.update((c) => ({ ...c, status: 'in', members })));
  }
  /** The organizer (not you) opens rooms: you're sent to yours, if you're in one. */
  private opensRooms(plans: readonly RoomPlan[], minutes: number, board?: BreakoutBoard | undefined): void {
    const s = this.getSnapshot();
    const idOf = (p: Person | 'me') => (p === 'me' ? this.me.id : this.find(p)?.id);
    const rooms = plans.map((plan, k) => {
      const members = plan.people.flatMap((p) => { const id = idOf(p); return id ? [id] : []; });
      return { id: this.roomId(k), name: plan.name, people: plan.people.map((p) => (p === 'me' ? this.me.person : p)), members, paused: false, board: false };
    });
    this.boardsForRooms(board, rooms.map((r, k) => ({ ...r, work: plans[k]?.work })));
    const mine = rooms.find((r) => r.members.includes(this.me.id));
    const scribe = mine ? mine.members.find((id) => id !== this.me.id && !this.guests.has(id)) ?? this.me.id : null;
    this.push({ ...s, breakouts: { ...s.breakouts, open: { rooms, board: this.boardMode, from: s.elapsed, until: s.elapsed + minutes * 60, message: null } }, capture: { ...s.capture, room: mine && notesAreOn(s.capture.mode) ? this.roomCapture(mine.id, scribe) : null } });
    const main = s.participants.filter((p) => !rooms.some((r) => r.members.includes(p.id))).map((p) => p.id);
    if (mine) this.moveTo(mine.id, mine.members);
    else this.crypto.update((c) => ({ ...c, members: main }));
    this.hosting();
  }
  openRooms(plan: BreakoutPlan): void {
    const s = this.getSnapshot();
    const rooms = plan.rooms.map((r, k) => ({
      id: this.roomId(k), name: r.name, people: r.emails.map(personAt), paused: false, board: false,
      members: s.participants.filter((p) => !p.isMe && r.emails.some((e) => e.toLowerCase() === p.person.email.toLowerCase())).map((p) => p.id)
    }));
    this.boardsForRooms(plan.board, rooms);
    this.push({ ...s, breakouts: { ...s.breakouts, open: { rooms, board: this.boardMode, from: s.elapsed, until: s.elapsed + plan.minutes * 60, message: null } } });
    this.showBoard();
    // The organizer stays in the main room, and keeps every room's keys.
    this.crypto.update((c) => ({ ...c, members: s.participants.filter((p) => !rooms.some((r) => r.members.includes(p.id))).map((p) => p.id) }));
    this.hosting();
  }
  closeRooms(): void {
    const s = this.getSnapshot();
    const open = s.breakouts.open;
    if (!open) return;
    this.push({ ...s, breakouts: { open: null, held: [...s.breakouts.held, { rooms: open.rooms.map(({ paused: _p, board: _b, ...r }) => r), from: open.from, to: s.elapsed }] }, capture: { ...s.capture, room: null } });
    for (const place of this.presented.keys()) if (place !== 'main') this.presented.delete(place);
    this.boardsBack();
    this.showBoard();
    const everyone = s.participants.map((p) => p.id);
    if (this.crypto.getSnapshot().place !== 'main') this.moveTo('main', everyone);
    else this.crypto.update((c) => ({ ...c, members: everyone }));
    this.hosting();
  }
  messageRooms(text: string): void {
    this.change((s) => (s.breakouts.open ? { ...s, breakouts: { ...s.breakouts, open: { ...s.breakouts.open, message: { text, at: s.elapsed } } } } : s));
  }
  visitRoom(roomId: string | null): void {
    const s = this.getSnapshot();
    const open = s.breakouts.open;
    if (!open) return;
    const rooms = open.rooms.map((r) => ({ ...r, members: r.id === roomId ? [...r.members.filter((m) => m !== this.me.id), this.me.id] : r.members.filter((m) => m !== this.me.id) }));
    const room = rooms.find((r) => r.id === roomId);
    this.push({ ...s, breakouts: { ...s.breakouts, open: { ...open, rooms } }, capture: { ...s.capture, room: room && notesAreOn(s.capture.mode) ? this.roomCapture(room.id, room.members.find((m) => m !== this.me.id) ?? null, room.paused) : null } });
    this.moveTo(roomId ?? 'main', room ? room.members : s.participants.filter((p) => !rooms.some((r) => r.members.includes(p.id))).map((p) => p.id));
  }
  renameRoom(roomId: string, name: string): void {
    this.change((s) => (s.breakouts.open ? { ...s, breakouts: { ...s.breakouts, open: { ...s.breakouts.open, rooms: s.breakouts.open.rooms.map((r) => (r.id === roomId ? { ...r, name } : r)) } } } : s));
  }
  moveToRoom(email: string, roomId: string | null): void {
    this.change((s) => {
      const open = s.breakouts.open;
      const who = s.participants.find((p) => p.person.email.toLowerCase() === email.toLowerCase());
      if (!open || !who) return s;
      return { ...s, breakouts: { ...s.breakouts, open: { ...open, rooms: open.rooms.map((r) => ({ ...r, members: r.id === roomId ? [...r.members.filter((m) => m !== who.id), who.id] : r.members.filter((m) => m !== who.id) })) } } };
    });
  }
  pauseRoom(roomId: string, paused: boolean): Promise<void> {
    this.change((s) => {
      const open = s.breakouts.open;
      if (!open) return s;
      const room = s.capture.room;
      return {
        ...s, breakouts: { ...s.breakouts, open: { ...open, rooms: open.rooms.map((r) => (r.id === roomId ? { ...r, paused } : r)) } },
        capture: { ...s.capture, room: room && room.id === roomId ? this.roomCapture(roomId, room.scribe, paused) : room }
      };
    });
    return Promise.resolve();
  }

  /* ---------- who hosts ---------- */

  /** The organizer's connection drops: notes can't be captured, and ten seconds later someone invited hosts in their place. */
  private hostDrops(): void {
    const s = this.getSnapshot();
    const organizer = s.participants.find((p) => p.isOrganizer && !p.isMe);
    if (!organizer) return;
    const at = new Date().toISOString();
    this.away = { from: at, at: s.elapsed, organizer: organizer.person, seat: organizer.seat };
    this.goes(organizer.person);
    const unavailable = (p: CapturePart): CapturePart => (p.mode === 'on' ? { ...p, mode: 'unavailable' } : p);
    this.change((x) => ({
      ...x, host: { ...x.host, id: null },
      capture: notesAreOn(x.capture.mode) ? { ...x.capture, mode: 'unavailable', recording: unavailable(x.capture.recording), transcript: unavailable(x.capture.transcript), away: true } : { ...x.capture, away: true }
    }));
    this.after(TAKE_OVER_MS, () => this.standIn());
  }
  /** Someone invited who's in the main room hosts while the organizer is away: you, unless someone came before you. */
  private standIn(): void {
    const s = this.getSnapshot();
    const away = this.away;
    if (!away || s.host.id) return;
    const inRoom = (id: string) => !!s.breakouts.open?.rooms.some((r) => r.members.includes(id));
    const host = s.participants.find((p) => !this.guests.has(p.id) && (p.isMe ? s.role === 'invited' : p.person.email !== '') && !inRoom(p.id));
    if (!host) return;
    const org = firstOf(away.organizer);
    const at = new Date().toISOString();
    const on = (p: CapturePart): CapturePart => (p.mode === 'unavailable' ? { ...p, mode: 'on' } : p);
    this.push({
      ...s, isHost: host.isMe,
      host: { id: host.id, standIn: true, organizer: away.organizer, next: [] },
      capture: { ...s.capture, mode: s.capture.mode === 'unavailable' ? 'on' : s.capture.mode, recording: on(s.capture.recording), transcript: on(s.capture.transcript), away: false, gaps: [...s.capture.gaps, { kind: 'offline', from: away.from, to: at, at: away.at }] },
      notices: [...s.notices, { id: nextId('notice'), text: host.isMe ? `${org}’s connection dropped, so you’re hosting until ${org} is back.` : `${org}’s connection dropped, so ${firstOf(host.person)} is hosting until ${org} is back.`, kind: 'people' }]
    });
    linkState(this.meeting.code, (l) => ({ hostHere: true, locked: false, capture: null, ended: false, ...l, standIn: host.person }));
    this.hosting();
  }
  /** The organizer joins again, and hosts again at once. */
  private hostBack(): void {
    const away = this.away;
    if (!away) return;
    this.away = null;
    const was = this.getSnapshot().host;
    this.join(away.organizer, { organizer: true });
    const back = this.find(away.organizer);
    const s = this.getSnapshot();
    const org = firstOf(away.organizer);
    this.push({
      ...s, isHost: false, host: { id: back?.id ?? was.id, standIn: false, organizer: away.organizer, next: [] },
      capture: { ...s.capture, mode: s.capture.mode === 'unavailable' ? 'on' : s.capture.mode, away: false },
      notices: [...s.notices, { id: nextId('notice'), text: `${org} is back and hosting again.`, kind: 'people' }]
    });
    linkState(this.meeting.code, (l) => ({ hostHere: true, locked: false, capture: null, ended: false, ...l, standIn: null }));
    this.hosting();
  }

  /** Whoever hosts (not you) ends the call: it's over for everyone. */
  private ends(): void {
    current().meetings = current().meetings.map((m) => (m.id === this.meeting.id ? { ...m, status: 'ended' } : m));
    linkState(this.meeting.code, (l) => ({ hostHere: false, standIn: null, locked: false, capture: null, ...l, ended: true }));
    this.change((s) => ({ ...s, phase: 'ended' }));
    this.livekit.update((r) => ({ ...r, connection: 'ended', endReason: 'ended-by-host' }));
    this.halt();
  }

  /* ---------- the session ---------- */

  room(): Promise<{ serverUrl: string; roomName: string; identity: string; token: string }> {
    return Promise.resolve({ serverUrl: this.ticket.serverUrl, roomName: this.ticket.roomName, identity: this.ticket.identity, token: 'storybook' });
  }
  refresh(): Promise<void> { return Promise.resolve(); }
  sendChat(text: string): Promise<void> {
    this.crypto.update((c) => ({ ...c, chat: [...c.chat, { id: nextId('chat'), from: this.me.id, isMe: true, text, at: Date.now(), place: c.place }] }));
    return Promise.resolve();
  }
  /** Data between browsers goes nowhere here: nobody else's browser is in the call. */
  sealData(_topic: string, payload: Uint8Array): Promise<Uint8Array<ArrayBuffer> | null> { return Promise.resolve(new Uint8Array(payload)); }
  openData(_topic: string, _from: string, sealed: Uint8Array): Promise<Uint8Array | null> { return Promise.resolve(sealed); }
  /* ---------- the call's workspace ---------- */

  /** Where everyone else is in the call's workspace, by their connection: what its stream says of them, the call's own pages included. */
  private where = new Map<string, { document: string | null; typing: boolean; page: CallPage | null }>();
  /** The call's home, once it's settled. */
  private homeId: string | null = null;
  private followWatchers = 0;
  readonly followUps = new Pushed<CallFollowUps | null>(null);

  /** Whoever's showing the call's follow-ups hears every change to the call that changes them. */
  protected override push(next: CallState): void {
    super.push(next);
    if (this.followWatchers > 0) this.tellFollowUps();
  }
  private space(change: (w: CallWorkspace) => CallWorkspace): void { this.change((s) => ({ ...s, workspace: change(s.workspace) })); }
  private get seat(): CallSeat { return { seat: this.me.seat, name: this.me.person.name }; }
  private seatOf(p: CallParticipant): CallSeat { return { seat: p.seat, name: p.person.name }; }
  private itemIn(workspaceId: string, id: string): WorkspaceItem | undefined { return treeOf(workspaceId).items.find((i) => i.id === id && i.trashedAt === null); }
  private organizerOnly(): Promise<void> | null {
    return this.getSnapshot().isOrganizer ? null : Promise.reject(new AlcoveApiError('forbidden', 'Only the organizer chooses the call’s workspace.'));
  }

  /**
   * The first time Workspace opens, the call's home: the meeting's own, with this call's folder put at its top, else a new
   * workspace named after the call and the day, with the folder in it. The organizer is its admin and everyone invited
   * edits; someone who came in with the link gets nothing, so it's private to them.
   */
  private settleHome(): void {
    const s = this.getSnapshot();
    if (this.homeId !== null || s.role === 'guest') return;
    const w = current();
    const name = homeName(this.meeting.title, s.startedAt);
    const now = new Date().toISOString();
    const folder: WorkspaceItem = {
      id: nextId('folder').padEnd(22, '0'), kind: 'folder', name, parent: null, by: null, createdAt: now, editedAt: now, trashedAt: null, trashedBy: null,
      restricted: false, role: 'edit', call: { startedAt: s.startedAt, on: true, here: true, noteId: null }
    };
    const chosen = this.meeting.workspaceId ? w.workspaces.find((x) => x.id === this.meeting.workspaceId) : undefined;
    let home: Space;
    if (chosen) {
      chosen.items = [folder, ...chosen.items];
      home = chosen;
    } else {
      home = { id: nextId('home'), name, role: s.isOrganizer ? 'admin' : 'edit', people: this.meeting.guests.length + 1, items: [folder], createdAt: now, call: { title: this.meeting.title, at: s.startedAt } };
      w.workspaces.push(home);
    }
    this.homeId = home.id;
    for (const p of this.script.workspace?.where ?? []) {
      const x = this.find(p.who);
      if (x) this.where.set(x.id, { document: p.document, typing: p.typing ?? false, page: p.page ?? null });
    }
    const brought = (this.script.workspace?.brought ?? []).flatMap((id) => { const item = this.itemIn(home.id, id); return item ? [this.broughtOf(home.id, item)] : []; });
    this.space((x) => ({ ...x, documents: brought }));
    this.view(home.id);
  }
  private broughtOf(workspaceId: string, item: WorkspaceItem): CallWorkspace['documents'][number] {
    return { workspaceId, id: item.id, kind: item.kind, name: item.name, role: item.role };
  }
  /** Everyone views `id`: what was presented and played stops, and everyone else is on its list until they open something there. */
  private view(id: string): void {
    const was = this.getSnapshot().workspace.id;
    const tree = treeOf(id);
    if (was !== null && was !== id) {
      hereIn(was, []);
      for (const [k, v] of this.where) this.where.set(k, { ...v, document: v.document !== null && this.itemIn(id, v.document) ? v.document : null });
    }
    this.space((w) => ({ ...w, id, home: this.homeId, name: tree.name, canOpen: true, role: tree.role, present: null, play: null }));
    this.sayWhere();
  }
  /** Who's where in the workspace everyone views, as its stream says it. */
  private sayWhere(): void {
    const id = this.getSnapshot().workspace.id;
    if (id === null) return;
    const here = this.getSnapshot().participants.flatMap((p): WorkspaceHere[] => {
      const at = this.where.get(p.id);
      if (p.isMe || !at) return [];
      return [{ person: p.person, connection: `c_${p.id}`, callIdentity: p.id, document: at.document, block: null, typing: at.typing, page: at.page, elsewhere: false, isMe: false }];
    });
    hereIn(id, here);
  }
  /* Someone else presenting, playing or tagging you in it has opened Workspace, so the home is settled by then. */
  private theyPresent(who: Person, document: string, section: number): void {
    this.settleHome();
    const p = this.find(who);
    if (!p) return;
    const id = this.getSnapshot().workspace.id;
    const item = id === null ? undefined : this.itemIn(id, document);
    // Someone who can open nothing here is told that something is presented, and by whom, and nothing else.
    const present: CallWorkspace['present'] = item
      ? { kind: item.kind === 'board' ? 'board' : 'document', id: document, name: item.name, section, by: this.seatOf(p), mine: false, canControl: this.getSnapshot().isOrganizer }
      : { kind: null, id: null, name: null, section: null, by: this.seatOf(p), mine: false, canControl: false };
    this.space((x) => ({ ...x, present }));
  }
  private theyPlay(who: Person, documentId: string, mediaId: string): void {
    this.settleHome();
    const p = this.find(who);
    if (!p || this.getSnapshot().workspace.id === null) return;
    const now = Date.now();
    this.space((x) => ({ ...x, play: { mediaId, documentId, by: this.seatOf(p), playing: true, positionMs: 0, atMs: now, nowMs: now, mine: false, canControl: this.getSnapshot().isOrganizer } }));
  }
  private tagsYou(who: Person, document: string, block: string | null): void {
    this.settleHome();
    const id = this.getSnapshot().workspace.id;
    const item = id === null ? undefined : this.itemIn(id, document);
    if (id === null || !item) return;
    tagYou({ id: nextId('tag'), workspaceId: id, document, name: item.name, block, by: { ...who, email: '' }, at: new Date().toISOString() });
  }
  /** The call's follow-ups as you may read them: the live notes' and the ones added by hand. */
  private tellFollowUps(): void {
    const s = this.getSnapshot();
    const mode = s.capture.room ? s.capture.room.mode : s.capture.mode;
    const items: CallFollowUp[] = [
      ...(s.liveNotes.notes?.next ?? []).map((n): CallFollowUp => ({ ...n, from: 'notes' })),
      ...s.liveNotes.added.map((a): CallFollowUp => ({ ...a, from: 'added' }))
    ];
    const next: CallFollowUps = { items, notes: mode === 'off' ? 'off' : mode === 'paused' ? 'paused' : 'on' };
    if (JSON.stringify(next) !== JSON.stringify(this.followUps.getSnapshot())) this.followUps.set(next);
  }
  watchFollowUps(): () => void {
    this.followWatchers += 1;
    this.tellFollowUps();
    let stopped = false;
    return () => { if (!stopped) { stopped = true; this.followWatchers -= 1; } };
  }
  openWorkspace(): Promise<void> { this.settleHome(); return Promise.resolve(); }
  previewWorkspace(workspaceId: string): Promise<CallWorkspaceSwitch> {
    const no = this.organizerOnly();
    if (no) return no.then(() => ({ name: '', cantOpen: [] }));
    const tree = treeOf(workspaceId);
    const members = new Set(peopleIn(workspaceId).map((p) => p.person.email.toLowerCase()));
    const cantOpen = this.getSnapshot().participants.filter((p) => !p.isMe && (this.guests.has(p.id) || !members.has(p.person.email.toLowerCase()))).map((p) => firstOf(p.person));
    return Promise.resolve({ name: tree.name ?? '', cantOpen });
  }
  setWorkspace(workspaceId: string): Promise<void> {
    const no = this.organizerOnly();
    if (no) return no;
    this.view(workspaceId);
    return Promise.resolve();
  }
  newWorkspace(name?: string | undefined): Promise<void> {
    const no = this.organizerOnly();
    if (no) return no;
    const id = nextId('ws');
    // Made for the call, as its home is: the organizer and everyone invited, and no guest.
    current().workspaces.push({
      id, name: name?.trim() || this.meeting.title, role: 'admin', people: this.meeting.guests.length + 1, items: [], createdAt: new Date().toISOString(),
      call: { title: this.meeting.title, at: this.getSnapshot().startedAt }
    });
    this.view(id);
    return Promise.resolve();
  }
  bringDocument(documentId: string, brought: boolean): Promise<void> {
    const id = this.getSnapshot().workspace.id;
    const item = id === null ? undefined : this.itemIn(id, documentId);
    if (id === null || !item) return Promise.reject(new AlcoveApiError('not-found', 'That isn’t there, or you can’t open it.'));
    this.space((w) => ({ ...w, documents: [...w.documents.filter((d) => d.id !== documentId), ...(brought ? [this.broughtOf(id, item)] : [])] }));
    return Promise.resolve();
  }
  askForWorkspace(up: boolean): Promise<void> { this.space((w) => ({ ...w, asked: up ? 'asking' : 'no' })); return Promise.resolve(); }
  /** The organizer opens one document to whoever asked, by their seat in the call. */
  grantWorkspaceAsk(askId: string, documentId: string, role: DocumentRole): Promise<void> {
    const ask = this.getSnapshot().workspace.asks.find((a) => a.id === askId);
    const seat = ask ? this.getSnapshot().participants.find((p) => p.id === ask.participantId)?.seat : undefined;
    if (seat) shareWith(documentId, [{ seat }], role);
    this.space((w) => ({ ...w, asks: w.asks.filter((a) => a.id !== askId) }));
    return Promise.resolve();
  }
  declineWorkspaceAsk(askId: string): Promise<void> { this.space((w) => ({ ...w, asks: w.asks.filter((a) => a.id !== askId) })); return Promise.resolve(); }
  /** A board is presented where it's open, as the server lets it be; a document, from the workspace everyone views. */
  startPresenting(kind: PresentKind, id: string, section = 0): Promise<void> {
    if (kind === 'board') {
      const place = this.crypto.getSnapshot().place;
      if (this.boards.get(this.shownAt(place))?.at?.documentId !== id) return Promise.reject(new AlcoveApiError('not-found', 'That isn’t there, or you can’t open it.'));
      const there = this.presented.get(place);
      if (there && there.by !== this.me.id) return Promise.reject(new AlcoveApiError('conflict', 'Someone else is presenting here.'));
      this.presented.set(place, { by: this.me.id, id, section });
      this.showBoard();
      return Promise.resolve();
    }
    const w = this.getSnapshot().workspace;
    const item = w.id === null ? undefined : this.itemIn(w.id, id);
    if (!item) return Promise.reject(new AlcoveApiError('not-found', 'That isn’t there, or you can’t open it.'));
    this.space((x) => ({ ...x, present: { kind, id, name: item.name, section, by: this.seat, mine: true, canControl: true } }));
    return Promise.resolve();
  }
  /** A board presented where you are, for whoever started it or the organizer to move on or stop; null when none is. */
  private boardPresentedHere(): { place: string; now: { by: string; id: string; section: number } } | AlcoveApiError | null {
    const place = this.crypto.getSnapshot().place;
    const now = this.presented.get(place);
    if (!now) return null;
    if (now.by !== this.me.id && !this.me.isOrganizer) return new AlcoveApiError('forbidden', 'Only whoever started this, or the organizer, can do that.');
    return { place, now };
  }
  movePresenting(section: number): Promise<void> {
    const board = this.boardPresentedHere();
    if (board instanceof AlcoveApiError) return Promise.reject(board);
    if (board) {
      this.presented.set(board.place, { ...board.now, section });
      this.showBoard();
      return Promise.resolve();
    }
    this.space((w) => (w.present ? { ...w, present: { ...w.present, section } } : w));
    return Promise.resolve();
  }
  stopPresenting(): Promise<void> {
    const board = this.boardPresentedHere();
    if (board instanceof AlcoveApiError) return Promise.reject(board);
    if (board) {
      this.presented.delete(board.place);
      this.showBoard();
      return Promise.resolve();
    }
    this.space((w) => ({ ...w, present: null }));
    return Promise.resolve();
  }
  startPlaying(documentId: string, mediaId: string, positionMs?: number | undefined): Promise<void> {
    const now = Date.now();
    this.space((w) => ({ ...w, play: { mediaId, documentId, by: this.seat, playing: true, positionMs: positionMs ?? 0, atMs: now, nowMs: now, mine: true, canControl: true } }));
    return Promise.resolve();
  }
  /** Where what's playing is now, on the server's clock. */
  private playAt(): number {
    const p = this.getSnapshot().workspace.play;
    return p ? p.positionMs + (p.playing ? Date.now() - p.atMs : 0) : 0;
  }
  pausePlaying(positionMs: number): Promise<void> {
    const now = Date.now();
    this.space((w) => (w.play ? { ...w, play: { ...w.play, playing: false, positionMs, atMs: now, nowMs: now } } : w));
    return Promise.resolve();
  }
  resumePlaying(): Promise<void> {
    const now = Date.now();
    const at = this.playAt();
    this.space((w) => (w.play ? { ...w, play: { ...w.play, playing: true, positionMs: at, atMs: now, nowMs: now } } : w));
    return Promise.resolve();
  }
  seekPlaying(positionMs: number): Promise<void> {
    const now = Date.now();
    this.space((w) => (w.play ? { ...w, play: { ...w.play, positionMs, atMs: now, nowMs: now } } : w));
    return Promise.resolve();
  }
  stopPlaying(): Promise<void> { this.space((w) => ({ ...w, play: null })); return Promise.resolve(); }
  /* ---------- the board's script: what other people do on it ---------- */

  /** A frame on a board by its title, or its first. */
  private frameCalled(doc: ReturnType<typeof boardDoc> | null, title: string | null): FrameObject | null {
    if (!doc || title === null) return null;
    const { frames } = readBoard(doc);
    return frames.find((f) => f.title === title) ?? frames[0] ?? null;
  }
  /**
   * Someone opens a new board for everyone in the main room, made in the call's home and filled as the server fills it, with
   * what `draw` puts on it; or one you can't open (`closedToYou`). Then the others work on it as the script says. With a
   * `standing`, your browser opens it as the world says it stands for you: no connection to it, or what's added here refused.
   */
  private theyOpenBoard(who: Person, template: BoardTemplate, closedToYou: boolean, draw?: ((doc: ReturnType<typeof boardDoc>) => void) | undefined, standing?: 'offline' | 'failed' | undefined): void {
    const p = this.find(who);
    if (!p) return;
    const at = closedToYou ? null : this.makeBoard(this.meeting.title, template, false);
    if (!closedToYou && !at) return;
    if (at) draw?.(boardDoc(at.workspaceId, at.documentId));
    if (at && standing) current().boards[at.documentId] = { ...current().boards[at.documentId], standing };
    this.boards.set('main', { at, openedBy: p.id, made: !closedToYou });
    this.onIt.clear();
    this.onIt.set(p.id, { x: 560, y: 260 });
    this.showBoard();
    this.othersWorkOnIt();
  }
  /** Once the main room's board is open, the others fill it as the script says, a sticky at a time, for as long as it's that board. */
  private othersWorkOnIt(): void {
    const plan = this.script.board;
    const opened = this.boards.get('main');
    if (!plan?.work || !opened?.at) return;
    const at = opened.at;
    const every = plan.every ?? 1.2;
    plan.work.forEach((w, i) => this.after((1 + i * every) * 1000, () => { if (this.boards.get('main') === opened) this.theyAddSticky(w.who, w.frame, w.text, at); }));
  }
  /**
   * A sticky in the first free place in a frame of the board `at` (the one where you are, unless said), two to a row, in the
   * frame's colour; their pointer goes with it.
   */
  private theyAddSticky(who: Person, title: string, text: string, at: { workspaceId: string; documentId: string } | null = this.hereAt()): void {
    const p = this.find(who);
    const doc = at ? boardDoc(at.workspaceId, at.documentId) : null;
    if (!p || !doc) return;
    const frame = this.frameCalled(doc, title);
    const view = readBoard(doc);
    const fx = frame?.x ?? 0, fy = frame?.y ?? 0;
    const taken = view.objects.flatMap((o) => (o.k === 'note' ? [o] : []));
    const free = (x: number, y: number) => !taken.some((o) => o.x < x + 150 && x < o.x + o.w && o.y < y + 150 && y < o.y + o.h);
    const slot = (i: number) => ({ x: fx + 20 + (i % 2) * 170, y: fy + 20 + Math.floor(i / 2) * 170 });
    let i = 0;
    while (i < 40 && !free(slot(i).x, slot(i).y)) i += 1;
    const { x, y } = slot(i);
    addObject(doc, { k: 'note', x, y, w: 150, h: 150, c: colourIn(view, frame, 'butter'), size: 'm', t: text }, { world: true });
    this.onIt.set(p.id, { x: x + 110, y: y + 120 });
    this.sayWhoIsOn();
  }
  /** Whoever opened the board where you are closes it for everyone there: the faces come back, and nothing on it is lost. */
  private boardGoes(): void {
    this.boards.delete(this.shownAt(this.crypto.getSnapshot().place));
    this.onIt.clear();
    this.showBoard();
  }
  private theyStartTimer(who: Person, minutes: BoardTimerMinutes, left: number | undefined): void {
    if (!this.find(who)) return;
    void this.session((b) => ({ ...b, timer: { until: this.getSnapshot().elapsed + (left ?? minutes * 60), length: minutes * 60, text: 'Add your stickies', canStop: this.me.isOrganizer } }));
  }
  private theyStartVote(who: Person, title: string | null, per: BoardVotesEach): void {
    if (!this.find(who)) return;
    const at = this.hereAt();
    const frame = this.frameCalled(at ? boardDoc(at.workspaceId, at.documentId) : null, title)?.id ?? null;
    void this.session((b) => (b.vote ? b : { ...b, vote: { on: true, frame, per, left: per, mine: [], results: {}, voters: 0, canEnd: this.me.isOrganizer } }));
  }
  /** The vote ends with everyone else's votes, by what each sticky says, and yours: every count at once, and only for what's in it. */
  private voteEnds(votes: Readonly<Record<string, number>>, voters: number): void {
    const at = this.hereAt();
    const view = at ? readBoard(boardDoc(at.workspaceId, at.documentId)) : null;
    void this.session((b) => {
      if (!b.vote?.on) return b;
      const frame = b.vote.frame === null ? null : view?.frames.find((f) => f.id === b.vote?.frame) ?? null;
      const notes = (view?.objects ?? []).flatMap((o) => (o.k === 'note' && (!frame || (o.x >= frame.x && o.x < frame.x + frame.w && o.y >= frame.y && o.y < frame.y + frame.h)) ? [o] : []));
      const results: Record<string, number> = {};
      for (const [text, n] of Object.entries(votes)) { const note = notes.find((o) => o.t === text); if (note) results[note.id] = (results[note.id] ?? 0) + n; }
      for (const id of b.vote.mine) results[id] = (results[id] ?? 0) + 1;
      return { ...b, vote: { ...b.vote, on: false, results, voters: voters + (b.vote.mine.length ? 1 : 0) } };
    });
  }

  /* ---------- the board: what you do ---------- */

  /**
   * A new board, in the main room or for the room you're in (then restricted, named for the room, and coming back with it), or
   * a saved one, which only the main room opens. In the main room the others work on it as the script says.
   */
  openBoard(from: BoardOpen): Promise<void> {
    const place = this.crypto.getSnapshot().place;
    if ('template' in from) {
      const room = place === 'main' ? undefined : this.getSnapshot().breakouts.open?.rooms.find((r) => r.id === place);
      const at = this.makeBoard(room ? `${room.name} board` : this.meeting.title, from.template, room !== undefined);
      if (!at) return Promise.reject(new AlcoveApiError('forbidden', 'Only someone invited can start a board.'));
      this.boards.set(place, { at, openedBy: this.me.id, made: true });
      if (room) this.roomBoards.set(place, { ...at, name: room.name, who: room.people.map(firstOf) });
    } else {
      if (place !== 'main') return Promise.reject(new AlcoveApiError('conflict', 'Open a board from the main room.'));
      this.boards.set('main', { at: { workspaceId: from.workspaceId, documentId: from.documentId }, openedBy: this.me.id, made: false });
    }
    this.onIt.clear();
    this.showBoard();
    if (place === 'main') this.othersWorkOnIt();
    return Promise.resolve();
  }
  closeBoard(): Promise<void> { this.boardGoes(); return Promise.resolve(); }
  /**
   * Who here can't open a saved board: anyone who came with the link, and anyone not in its workspace. You may let them in if
   * you may share it: you can edit it, in a workspace you're in.
   */
  boardCheck(workspaceId: string, documentId: string): Promise<BoardCheck> {
    const members = new Set(peopleIn(workspaceId).map((p) => p.person.email.toLowerCase()));
    const cannot = this.getSnapshot().participants.filter((p) => !p.isMe && (this.guests.has(p.id) || !members.has(p.person.email.toLowerCase()))).map((p) => firstOf(p.person));
    return Promise.resolve({ cannot, mayLetIn: treeOf(workspaceId).role !== null && this.itemIn(workspaceId, documentId)?.role === 'edit' });
  }
  /*
   * The board's session, as the server keeps it: a timer from now, the same for everyone, and a vote whose counts come only
   * when it ends, everyone else's from the script (`board.votes`) and yours. With no board open, nothing changes.
   */
  private session(change: (b: CallState['board']) => CallState['board']): Promise<void> {
    this.change((s) => (s.board.open ? { ...s, board: change(s.board) } : s));
    return Promise.resolve();
  }
  startTimer(minutes: BoardTimerMinutes): Promise<void> {
    return this.session((b) => ({ ...b, timer: { until: this.getSnapshot().elapsed + minutes * 60, length: minutes * 60, text: 'Add your stickies', canStop: true } }));
  }
  stopTimer(): Promise<void> { return this.session((b) => ({ ...b, timer: null })); }
  startVote(frame: string | null, per: BoardVotesEach): Promise<void> {
    return this.session((b) => (b.vote ? b : { ...b, vote: { on: true, frame, per, left: per, mine: [], results: {}, voters: 0, canEnd: true } }));
  }
  castVote(sticky: string): Promise<void> {
    return this.session((b) => (b.vote?.on && !b.vote.mine.includes(sticky) && b.vote.left > 0 ? { ...b, vote: { ...b.vote, mine: [...b.vote.mine, sticky], left: b.vote.left - 1 } } : b));
  }
  takeBackVote(sticky: string): Promise<void> {
    return this.session((b) => (b.vote?.on && b.vote.mine.includes(sticky) ? { ...b, vote: { ...b.vote, mine: b.vote.mine.filter((id) => id !== sticky), left: b.vote.left + 1 } } : b));
  }
  /** You end it: everyone else's votes, as the script has them, and yours. */
  endVote(): Promise<void> {
    this.voteEnds(this.script.board?.votes ?? {}, this.script.board?.voters ?? 0);
    return Promise.resolve();
  }
  clearVote(): Promise<void> { return this.session((b) => (b.vote?.on === false ? { ...b, vote: null } : b)); }
  /*
   * Ideas from the call, as the server offers them: what the script says the call heard (`heard`), for whoever can add to the
   * board where they are while notes are on there, each with the frame it fits. The script decides when, so watching changes
   * nothing; added or put by, they go for everyone.
   */
  watchIdeas(): () => void { return () => undefined; }
  ideasDone(ids: string[]): Promise<void> {
    this.change((s) => ({ ...s, board: { ...s.board, ideas: s.board.ideas.filter((i) => !ids.includes(i.id)) } }));
    return Promise.resolve();
  }
  private theyAreHeard(heard: readonly HeardIdea[]): void {
    const at = this.hereAt();
    const s = this.getSnapshot();
    const notesOn = (s.capture.room ? s.capture.room.mode : s.capture.mode) === 'on';
    if (!at || s.board.open?.role !== 'edit' || !notesOn) return;
    const { frames } = readBoard(boardDoc(at.workspaceId, at.documentId));
    const ideas = heard.flatMap((h): CallBoardIdea[] => {
      const p = this.find(h.who);
      return p ? [{
        id: nextId('idea'), text: h.text, said: { person: p.person, at: new Date(Date.now() - (h.ago ?? 0) * 1000).toISOString(), words: h.said },
        frame: frames.find((f) => f.title === h.frame)?.id ?? null
      }] : [];
    });
    this.change((x) => ({ ...x, board: { ...x.board, ideas: [...x.board.ideas, ...ideas].slice(-MAX_CALL_IDEAS) } }));
  }
  tickDocumentFollowUp(_tick: DocFollowUpTick): Promise<void> { return Promise.resolve(); }
  admit(id: string): Promise<void> {
    const asker = this.getSnapshot().waiting.find((w) => w.id === id);
    this.change((s) => ({ ...s, waiting: s.waiting.filter((w) => w.id !== id) }));
    if (!asker) return Promise.resolve();
    // Someone signed in let in from the link is on the invite now; someone by name is a guest.
    if (asker.person.email) current().meetings = current().meetings.map((m) => (m.id === this.meeting.id && !m.guests.some((g) => sameAs(g, asker.person)) ? { ...m, guests: [...m.guests, asker.person], guestCount: m.guestCount + 1 } : m));
    this.after(600, () => { this.join(asker.person, { guest: !asker.person.email }); this.hosting(); });
    return Promise.resolve();
  }
  deny(id: string): Promise<void> { this.change((s) => ({ ...s, waiting: s.waiting.filter((w) => w.id !== id) })); return Promise.resolve(); }
  /** Rings each of them: they answer as the script says, or come in a few seconds later. Anyone rung is on the invite. */
  ring(emails: string[]): Promise<void> {
    emails.forEach((email, i) => {
      const person = personAt(email);
      const id = nextId('rung');
      this.change((s) => ({ ...s, ringing: [...s.ringing.filter((r) => !sameAs(r.person, person)), { id, person, state: 'ringing', since: new Date().toISOString() }] }));
      current().meetings = current().meetings.map((m) => (m.id === this.meeting.id && !m.guests.some((g) => sameAs(g, person)) ? { ...m, guests: [...m.guests, person], guestCount: m.guestCount + 1 } : m));
      const answer = this.script.answers?.[email] ?? { after: 5 + i * 3, reply: 'join' };
      this.after(answer.after * 1000, () => this.answered(id, answer.reply));
      this.after(RING_SECONDS * 1000, () => this.answered(id, 'missed'));
    });
    return Promise.resolve();
  }
  private answered(id: string, reply: RingReply | 'missed'): void {
    const r = this.getSnapshot().ringing.find((x) => x.id === id && x.state === 'ringing');
    if (!r) return;
    const at = new Date().toISOString();
    const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
    const next = reply === 'join' ? { ...r, state: 'coming' as const }
      : reply === 'in-5' ? { ...r, state: 'later' as const, until: later(5) }
        : reply === 'in-15' ? { ...r, state: 'later' as const, until: later(15) }
          : reply === 'no' ? { ...r, state: 'declined' as const, since: at } : { ...r, state: 'missed' as const, since: at };
    this.change((s) => ({ ...s, ringing: s.ringing.map((x) => (x.id === id ? next : x)) }));
    if (reply === 'join') this.after(2500, () => { this.change((s) => ({ ...s, ringing: s.ringing.filter((x) => x.id !== id) })); this.join(r.person); this.hosting(); });
  }
  setNotes(on: boolean): Promise<void> { this.capture(on ? 'on' : 'off'); return Promise.resolve(); }
  pause(): Promise<void> { this.capture('paused'); return Promise.resolve(); }
  resume(): Promise<void> { this.capture('on'); return Promise.resolve(); }
  requestNotes(up: boolean): Promise<void> {
    const at = new Date().toISOString();
    this.change((s) => ({
      ...s,
      capture: {
        ...s.capture, asked: up ? { state: 'asking', at } : null,
        requests: up ? [...s.capture.requests.filter((r) => r.participantId !== this.me.id), { id: nextId('ask'), participantId: this.me.id, at }] : s.capture.requests.filter((r) => r.participantId !== this.me.id)
      }
    }));
    return Promise.resolve();
  }
  declineNotes(requestId: string): Promise<void> {
    this.change((s) => ({ ...s, capture: { ...s.capture, requests: s.capture.requests.filter((r) => r.id !== requestId) } }));
    return Promise.resolve();
  }
  setUnavailable(_parts: CaptureDevicePart[]): Promise<void> { return Promise.resolve(); }
  setScreens(on: boolean): Promise<void> {
    this.change((s) => ({ ...s, capture: { ...s.capture, screen: part(on ? (s.capture.mode === 'paused' ? 'paused' : 'on') : 'off', new Date().toISOString(), { kind: 'organizer', name: s.host.organizer.name }) } }));
    return Promise.resolve();
  }
  shareFrame(_frame: ScreenFrame): Promise<ScreenFrameReceipt> { return Promise.resolve({ id: nextId('frame'), duplicate: false }); }
  shareEnded(_share: string): Promise<void> { return Promise.resolve(); }
  setHand(up: boolean): void { this.change((s) => ({ ...s, participants: s.participants.map((p) => (p.isMe ? { ...p, hand: up } : p)) })); }
  letOthersPoint(on: boolean): Promise<void> { this.change((s) => ({ ...s, participants: s.participants.map((p) => (p.isMe ? { ...p, othersPoint: on } : p)) })); return Promise.resolve(); }
  setPointing(on: boolean): Promise<void> { this.change((s) => ({ ...s, pointing: on })); return Promise.resolve(); }
  setSpotlight(participantId: string | null): void { this.change((s) => ({ ...s, spotlight: participantId })); }
  translate(lineIds: string[], _language: CaptionLanguage): Promise<CaptionTranslation[]> {
    const lines = this.getSnapshot().transcript;
    return Promise.resolve(lineIds.flatMap((id) => { const l = lines.find((x) => x.id === id); return l ? [{ id, text: l.text }] : []; }));
  }
  /**
   * Hear it, as the call plays it: a line in your own transcript, which is only what you were there for, as a few quiet
   * seconds of the recording around it. Anything else isn't there, as the API says it.
   */
  hear(note: string, line: string): Promise<LineAudio> {
    const s = this.getSnapshot();
    const l = s.transcript.find((x) => x.id === line);
    if (s.notes.noteId !== note || !l || l.room) return Promise.reject(new AlcoveApiError('not-found', 'That moment of the call doesn’t exist, or you don’t have access to it.'));
    return Promise.resolve({ audio: quietAudio(5), from: 1, seconds: 3 });
  }
  appendAudio(_piece: AudioPiece): Promise<void> { return Promise.resolve(); }
  transcribe(_clip: TranscriptClip, _speaker: string): Promise<void> { return Promise.resolve(); }
  watchNotes(): () => void {
    this.watching += 1;
    this.writeNotesSoon();
    let stopped = false;
    return () => { if (!stopped) { stopped = true; this.watching -= 1; } };
  }
  tickFollowUp(id: string, done: boolean): Promise<void> {
    if (done) this.ticked.add(id); else this.ticked.delete(id);
    this.change((s) => {
      const added = s.liveNotes.added.map((a) => (a.id === id ? { ...a, done } : a));
      return s.liveNotes.notes
        ? { ...s, liveNotes: { ...s.liveNotes, added, notes: { ...s.liveNotes.notes, next: s.liveNotes.notes.next.map((n) => (n.id === id ? { ...n, done } : n)) } } }
        : { ...s, liveNotes: { ...s.liveNotes, added } };
    });
    return Promise.resolve();
  }
  /** A follow-up nobody said, in your own words, yours: for everyone who gets the notes. The same words again add nothing. */
  addFollowUp(text: string): Promise<void> {
    const s = this.getSnapshot();
    if (!s.notes.everOn) return Promise.reject(new AlcoveApiError('forbidden', 'Notes have never been on in this call.'));
    const words = text.replace(/\s+/g, ' ').trim();
    if (!words || s.liveNotes.added.some((a) => a.text === words)) return Promise.resolve();
    const at = Math.max(0, Math.round((Date.now() - Date.parse(s.startedAt)) / 1000));
    this.change((now) => ({ ...now, liveNotes: { ...now.liveNotes, added: [...now.liveNotes.added, { id: nextId('added'), text: words, owner: this.me.person.name, evidence: [], done: false, at }] } }));
    return Promise.resolve();
  }
  catchUp(_range: CatchUpRange): Promise<CatchUp> {
    const n = this.notesNow();
    return Promise.resolve({ ...n, next: n.next.map(({ text, owner, due, evidence }) => ({ text, ...(owner ? { owner } : {}), ...(due ? { due } : {}), evidence })) });
  }
  askSoFar(_question: string, _range: CatchUpRange): Promise<CallAnswer> {
    const n = this.notesNow();
    return Promise.resolve({ text: n.summary || 'Nothing’s been said yet while notes were on.', evidence: n.decided.flatMap((d) => d.evidence).slice(0, 2), read: n.read });
  }
  catchUpWindow(): Promise<CatchUpWindow> {
    const s = this.getSnapshot();
    return Promise.resolve({ now: s.elapsed, joined: this.script.since ?? 0, away: null, here: null, gaps: s.capture.gaps });
  }
  moment(lineId: string): Promise<CallMoment> {
    const lines = this.getSnapshot().transcript;
    const k = lines.findIndex((l) => l.id === lineId);
    return Promise.resolve({ lineId, lines: lines.slice(Math.max(0, k - 2), k + 3).map((l) => ({ ...l, said: l.at })) });
  }
  askEarlier(_question: string, _timeZone: string): Promise<SeriesAnswerPart[]> { return Promise.resolve([{ type: 'text', text: 'There’s nothing from earlier calls in this series yet.' }]); }
  mute(identity: string, _trackSid: string): Promise<void> {
    const now = this.livekit.getSnapshot().people[identity];
    if (now) this.livekit.update((r) => ({ ...r, people: { ...r.people, [identity]: { ...now, mic: false, speaking: false } } }));
    return Promise.resolve();
  }
  remove(id: string): Promise<void> {
    const p = this.getSnapshot().participants.find((x) => x.id === id);
    if (p) this.goes(p.person);
    return Promise.resolve();
  }
  lock(on: boolean): Promise<void> {
    this.change((s) => ({ ...s, locked: on }));
    linkState(this.meeting.code, (l) => ({ hostHere: true, standIn: null, capture: null, ended: false, ...l, locked: on }));
    return Promise.resolve();
  }
  stopRing(ringId: string): Promise<void> { this.change((s) => ({ ...s, ringing: s.ringing.filter((r) => r.id !== ringId) })); return Promise.resolve(); }
  dismissNotice(id: string): void { this.change((s) => ({ ...s, notices: s.notices.filter((n) => n.id !== id) })); }
  startMove(_media: MoveMedia): Promise<CallMoveOut> { return Promise.resolve(new MoveOut()); }

  /** Whoever hosts ends the call for everyone and its note starts being written; anyone else just leaves. */
  leave(): Promise<CallEndResult | null> {
    const s = this.getSnapshot();
    if (s.isHost) this.push({ ...s, phase: 'ended' });
    this.close();
    if (!s.isHost) return Promise.resolve(null);
    const w = current();
    const noteId = s.notes.everOn ? s.notes.noteId : null;
    w.meetings = w.meetings.map((m) => (m.id === this.meeting.id ? { ...m, status: 'ended', duration: s.elapsed, ...(noteId ? { noteId } : {}) } : m));
    linkState(this.meeting.code, (l) => ({ hostHere: false, standIn: null, locked: false, capture: null, ...l, ended: true }));
    if (noteId) {
      const decided = this.heard.flatMap((h) => (h.line.decides ? [{ id: `${noteId}-d${h.id}`, text: h.line.decides, at: clockOf(h.at), state: 'proposed' as const }] : []));
      const actions = this.heard.flatMap((h) => {
        const hands = h.line.hands;
        if (!hands) return [];
        const owner = hands.owner === 'me' || (!hands.owner && h.line.who === 'me') ? this.me.person : hands.owner ?? (h.line.who === 'me' ? undefined : h.line.who);
        return [{ id: `${noteId}-a${h.id}`, text: hands.text, at: clockOf(h.at), ...(owner ? { owner } : {}), ...(hands.due ? { due: hands.due } : {}) }];
      });
      const spec = {
        id: noteId, title: s.title, startedAt: s.startedAt, minutes: Math.max(1, Math.round(s.elapsed / 60)), organizer: this.meeting.organizer, invited: this.meeting.guests,
        excerpt: this.script.summary ?? 'Notes from the call.', summary: this.script.summary, meetingId: this.meeting.id, decisions: decided, actions,
        said: s.transcript.map((l) => ({ at: clockOf(l.at), who: l.speaker?.person, text: l.text }))
      };
      w.notes.unshift(writeNote({ ...spec, status: 'pending' }));
      w.writing = { id: noteId, seconds: 8, written: () => writeNote(spec) };
    }
    return Promise.resolve({ meetingId: this.meeting.id, pendingNoteId: noteId, duration: s.elapsed });
  }
  /** Whoever hosts leaves it to someone invited, who hosts until the organizer is back. */
  handOff(to: string): Promise<void> {
    const person = this.getSnapshot().participants.find((p) => p.id === to)?.person ?? null;
    linkState(this.meeting.code, (l) => ({ hostHere: true, locked: false, capture: null, ended: false, ...l, standIn: person }));
    this.close();
    return Promise.resolve();
  }
  close(): void {
    this.halt();
    this.crypto.close();
    this.livekit.close();
    talking(true);
  }
  closing(): void { this.close(); }
}

/** What a call's new home and its folder are called: the call, and the day it started, 'Design review · 4 Nov'. */
const homeName = (title: string, startedAt: string) =>
  `${title.replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled call'} · ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(startedAt))}`;

/** A moment of the call as the notes write it, '04:12'. */
const clockOf = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Moving to another device: the code waits to be opened on the other one, which never happens here. */
class MoveOut extends Pushed<MoveOutState> implements CallMoveOut {
  constructor() {
    super({ stage: 'open', code: 'StorybookMoveCode00000', expiresAt: Date.now() + 120_000, device: null, sameAccount: true, problem: null });
  }
  confirm(_media: MoveMedia): Promise<void> { this.update((s) => ({ ...s, stage: 'moved' })); return Promise.resolve(); }
  cancel(): Promise<void> { this.update((s) => ({ ...s, stage: 'cancelled' })); return Promise.resolve(); }
  renew(): Promise<void> { this.update((s) => ({ ...s, stage: 'open', expiresAt: Date.now() + 120_000 })); return Promise.resolve(); }
}

/** The CallSession the stand-in's `calls.join` hands back: you, as the world and the call's invite have you. */
export function joinCall(m: Meeting, opts: { name?: string | undefined }): ScriptedCall {
  const w = current();
  const signedIn = w.session !== null;
  const organizes = signedIn && m.organizer.email === you().email;
  const invited = organizes || (signedIn && m.guests.some((g) => g.email === you().email));
  return new ScriptedCall(m, { role: organizes ? 'host' : invited ? 'invited' : 'guest', asking: !invited, ...(signedIn ? {} : { name: opts.name?.trim() || 'Guest' }) });
}
