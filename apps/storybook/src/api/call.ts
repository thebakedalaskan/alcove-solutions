/*
 * A call, played from its script (script.ts). LiveKit can't run in Storybook, so this is the server's side of the
 * script: who's in the call, what it captures, the transcript and the live notes, who's asking to join and who's being
 * rung, breakout rooms, and who hosts. LiveKit's side (everyone else's microphones, who's speaking, what they share and
 * your own connection) is `livekit`, which the scripted room (src/media/livekit.ts) plays to the call screen. Every control
 * does to the snapshot what the server would; leaving ends the call for whoever hosts and leaves its note being written.
 * The call's workspace is played here too: its home, settled the first time Workspace opens, which opens to everyone in the
 * call, guests too, what's brought, presented and played, and where everyone else is in it. So is a board in the call: one you open, or one someone in
 * the script opens, made in the call's home and filled from its template as the server does, with whoever works on it on it,
 * and its vote.
 */
import {
  CALL_TIMER_MAX_SECONDS, CallTimerControlSchema, type CallTimerControl, type CallTimer, type CallAttention, type CallNudgeKind, type CallQuestionStatus, type CallStatusKind, type CallStatusMinutes, ACCEPTED_FOLLOW_UP, AlcoveApiError, type FollowUpCreate, type FollowUpPatch, type FollowUpReview, type FollowUpTarget, type LiveFollowUp, MAX_CALL_IDEAS, RING_SECONDS, notesAreOn, reactionTarget, withReaction, type BreakoutPlan, type CallPage, type CallAnswer, type CallChatMention, CallChatTextSchema, type CallCrypto, type CallEndResult, type CallMoment, type CallMoveOut, type CallParticipant, type CallRole,
  type CallReaction, type CallSession, type CallState, type CallTicket, type CaptionLanguage, type CaptionTranslation, type CaptureDevicePart, type CaptureGap, type CaptureMode, type CapturePart,
  type CatchUp, type CatchUpRange, type CatchUpWindow, type AudioPiece, type LineAudio, type Meeting, type MoveMedia, type MoveOutState, type Person, type PersonalApi,
  type RingReply, type RoomCapture, type RoomPerson, type ScreenPiece, type SeriesAnswerPart, type TranscriptClip, type TranscriptLine
} from '@alcove/api';
import type {
  BoardCheck, BoardOpen, BoardTemplate, BoardVotesEach, BreakoutBoard, BreakoutBoardMode, CallBoard, CallBoardIdea, CallFollowUp, CallFollowUps, CallPresent, CallSeat, CallWorkspace,
  CallWorkspaceSwitch, DocFollowUpTick, PresentStart, WorkspaceHere, WorkspaceItem
} from '@alcove/api';
import { BOARD_VIEW_WIDTH, addObject, colourIn, fillTemplate, landBoards, readBoard, roomFrameId, roomFrames, type FrameObject } from '@alcove/board';
import { reading } from '~/features/board/slides';
import { sessions } from '~/lib/live';
import { talking } from '../browser';
import type { Screen } from '../media/screens';
import { changer, writeNote } from '../world/build';
import { quietAudio } from './media';
import { personAt } from '../world/people';
import type { Space, World } from '../world';
import { Pushed, Snapshots } from './live';
import { personalFor } from './personal';
import { ScriptedDirectMessages } from './direct-messages';
import { ScriptedNotifications } from './notifications';
import { captureOf, defaultScript, linkState, modelIsPrivate, part, scriptFor, type Beat, type CallScript, type HeardIdea, type Line, type Present, type RoomPlan } from './script';
import { current, me as you, nextId } from './state';
import { boardDoc, createItem, hereIn, moveItem, onTheBoard, peopleIn, removeWorkspace, restrict, tagYou, trashItem, treeOf } from './workspaces';

/** A connection's identity in a call: `p_` and 22 characters, as LiveKit's are. */
const identity = (seed: string) => `p_${seed.replace(/[^A-Za-z0-9]/g, '').padEnd(22, 'x').slice(-22)}`;
const sameAs = (a: Person, b: Person) => a.id === b.id || (a.email !== '' && a.email.toLowerCase() === b.email.toLowerCase());
const firstOf = (p: Person) => p.name.split(' ')[0] ?? p.name;
/** How long a line takes to say. */
const sayingMs = (text: string) => Math.min(5600, Math.max(2200, text.length * 55));
/** How long after the organizer's connection drops someone invited hosts in their place. */
const TAKE_OVER_MS = 10_000;
/** How long Hear it takes to fetch a line of the recording, so pressing it shows it working. */
const HEAR_MS = 900;
/** How many times as wide as it's tall someone else presenting a board has their sheet: a laptop's stage. */
const PRESENTERS_SHEET = 1.8;
/** The call's timer after one of the host's controls, as the API works it out (features/calls/timers.ts), or why not. */
function timerAfter(was: CallTimer | null, input: CallTimerControl, now: number): CallTimer | null {
  if (input.action === 'start') {
    if (was) throw new AlcoveApiError('conflict', 'A timer is running already. Stop it to start another.');
    return { id: nextId('timer'), revision: 0, durationSeconds: input.durationSeconds, status: 'running', elapsedMs: 0, startedAt: now };
  }
  if (!was || was.revision !== input.expectedRevision) throw new AlcoveApiError('conflict', 'The timer has changed. Look at it again and try once more.');
  const elapsedMs = was.elapsedMs + (was.startedAt === null ? 0 : Math.max(0, now - was.startedAt));
  const changed = { ...was, revision: was.revision + 1 };
  if (input.action === 'stop') return null;
  if (input.action === 'pause' && was.status === 'running') return { ...changed, status: 'paused', elapsedMs, startedAt: null };
  if (input.action === 'resume' && was.status === 'paused') return { ...changed, status: 'running', startedAt: now };
  if (input.action === 'add-time') {
    const durationSeconds = Math.max(was.durationSeconds, Math.floor(elapsedMs / 1000)) + input.seconds;
    if (durationSeconds > CALL_TIMER_MAX_SECONDS) throw new AlcoveApiError('conflict', 'A timer runs for a day at most.');
    return { ...changed, durationSeconds };
  }
  throw new AlcoveApiError('conflict', 'That isn’t something the timer can do right now.');
}
/** Nudges of one kind within a minute of the first are one note, and a note stays a minute, as the server keeps them. */
const NUDGE_WINDOW = 60_000;
/** A status whose time has run out. */
const ranOut = (status: CallParticipant['status']) => status !== null && status.until !== null && Date.parse(status.until) <= Date.now();

/** What LiveKit says about everyone else's browser, and about your own connection to the room. */
export interface RoomSide {
  /** Everyone else in the room, by identity: their microphone, whether they're speaking, and what they share (with its sound or not). */
  people: Readonly<Record<string, { mic: boolean; speaking: boolean; screen: Screen | null; sound: boolean }>>;
  connection: 'connected' | 'reconnecting' | 'ended';
  endReason: 'ended-by-host' | 'removed' | 'error' | null;
  /** How many times whoever hosts has muted your microphone. */
  mutedYou: number;
  /** How many times the organizer has stopped what you share: LiveKit mutes it, and your browser lets it go. */
  sharesStopped: number;
}
type Them = RoomSide['people'][string];

class Crypto extends Pushed<CallCrypto> {}

/** How you came to the call: what the call says you are, and whether you ask to be let in first. */
export interface Arrival { role: CallRole; asking: boolean; name?: string | undefined }

/**
 * What's presented in one part of the call, as the server keeps it: the board open there, and which frame everyone's on, or the
 * workspace everyone views; by whom, by their seat, which holds across their reconnections, as the server's person does; and
 * which presentation it is.
 */
type Presented = { kind: 'board'; by: CallSeat; key: string; id: string; section: number } | { kind: 'workspace'; by: CallSeat; key: string };


export class ScriptedCall extends Snapshots<CallState> implements CallSession {
  readonly direct: ScriptedDirectMessages;
  readonly ticket: CallTicket;
  readonly notifications: ScriptedNotifications;
  readonly crypto: Crypto;
  readonly personal: PersonalApi;
  /** LiveKit's side: the scripted room plays it. */
  readonly livekit: Pushed<RoomSide>;
  /** Whoever takes the data other browsers send to the room (the scripted room), told the topic, the payload and who from. */
  private readonly dataTakers = new Set<(topic: string, payload: Uint8Array, from: string) => void>();
  private readonly script: CallScript;
  /** Lines Hear it has asked for already. */
  private asked = new Set<string>();
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
  /** Resolved proposals stay here when notes refresh, so dismissed evidence never returns. */
  private inferred = new Map<string, LiveFollowUp>();
  private reviewed = new Map<string, FollowUpReview>();
  private watching = 0;
  private notesFor = -1;
  private writing = false;
  private chatFailures = 0;
  /** Until when you're saying a line, so your microphone murmurs as a voice does, and until when each of them is. */
  private voiceUntil = 0;
  private speakingUntil = new Map<string, number>();
  /** The organizer's connection dropped: since when, for the stretch the notes mark. */
  private away: { from: string; at: number; organizer: Person; seat: string } | null = null;
  /**
   * The board open in each part of the call, as the server keeps them (`main`, or a room's ID): where it's kept, who opened it,
   * by participant ID, and whether `everyone` can edit it, as one the call made, or a saved one someone let everyone into; what
   * rooms were opened with to work on; and each room's own board, which comes back when they close.
   */
  private boards = new Map<string, { at: { workspaceId: string; documentId: string } | null; openedBy: string; everyone: boolean }>();
  private boardMode: BreakoutBoardMode = 'none';
  private roomBoards = new Map<string, { workspaceId: string; documentId: string; name: string; who: string[] }>();
  /** What's presented in each part of the call: one thing at a time in each. */
  private presented = new Map<string, Presented>();
  /** How the last presentation in each part of the call ended, until another starts there. */
  private ended = new Map<string, { key: string; close: boolean; by: CallSeat }>();
  /** Who's on the board where you are besides you, by their connection, and where their pointer is. */
  private onIt = new Map<string, { x: number; y: number }>();

  /** When you first came in: the script's times count from then, whenever you join it again. */
  private readonly began: number;

  /** `back`: a call you left that went on, which joining again picks up where it's got to (`GoingOn`). */
  constructor(private readonly meeting: Meeting, arrival: Arrival, back: GoingOn | null = null) {
    const script = scriptFor(meeting.code) ?? defaultScript(meeting);
    const callId = back?.callId ?? script.notificationId ?? `${nextId('call')}-${crypto.randomUUID()}`;
    const noteId = back?.noteId ?? nextId('note');
    const since = back ? Math.max(0, Math.round((Date.now() - Date.parse(back.startedAt)) / 1000)) : script.since ?? 0;
    const startedAt = back?.startedAt ?? new Date(Date.now() - since * 1000).toISOString();
    const organizes = arrival.role === 'host';
    const person: Person = arrival.name ? { id: `guest-${callId}`, name: arrival.name, email: '' } : you();
    // Every connection is new, as LiveKit's are: coming back is another, in the same seat.
    const me: CallParticipant = { id: identity(`me${callId}${back ? nextId('back') : ''}`), seat: 'seat-me', person, isMe: true, isOrganizer: organizes, hand: false, status: null, othersPoint: true };
    const mode = script.notes ?? meeting.notes;
    super({
      revision: 0, timer: script.timer ? { ...script.timer, startedAt: script.timer.status === 'running' ? Date.now() : null } : null, attention: { place: 'main', hands: [], questions: [], nudges: [], cues: [], latest: 0, serverNow: new Date().toISOString() },
      callId, meetingId: meeting.id, code: meeting.code, title: meeting.title, startedAt, elapsed: since, phase: 'in-call', participants: organizes ? [me] : [], locked: false, pointing: true,
      spotlight: null, breakouts: { open: null, held: [] }, capture: back?.capture ?? captureOf(mode, mode === 'off' ? null : startedAt, meeting.organizer.name, script.model ?? null),
      notes: back?.notes ?? { everOn: mode !== 'off', noteId: mode !== 'off' ? noteId : null, segmentStartedAt: mode !== 'off' ? startedAt : null, recording: { segment: 0, pieces: 0, seconds: mode === 'on' ? since : 0 }, keepsRecording: meeting.choices.keepRecording }, waiting: [], ringing: [], leaving: [], chatRead: [],
      host: { id: organizes ? me.id : null, standIn: false, organizer: meeting.organizer, next: [] }, generation: 1, transcript: back?.transcript ?? [],
      liveNotes: { notes: null, added: [], suggestions: [], writing: false, error: null }, notices: !back && mode === 'on' && !since ? [{ id: nextId('notice'), text: 'Notes are on. Everyone here can see that.', kind: 'notes' }] : [],
      isOrganizer: organizes, isHost: organizes, role: arrival.role,
      workspace: { id: null, home: null, name: null, chosenBy: meeting.organizer, canOpen: false, role: null, everyone: false, documents: [], agenda: null, present: null, ended: null, play: null, asks: [], asked: 'no' },
      board: { open: null, timer: null, vote: null, ideas: [] }, shares: []
    });
    this.script = script;
    this.me = me;
    this.noteId = noteId;
    this.began = back?.began ?? Date.now();
    for (const followUp of script.followUps ?? []) this.inferred.set(followUp.id, structuredClone(followUp));
    this.ticket = { callId, serverUrl: 'wss://livekit.storybook.invalid', roomName: `room-${callId}`, identity: me.id, role: arrival.role, pass: `${callId}.storybook` };
    this.crypto = new Crypto({ status: arrival.asking ? 'waiting' : 'in', place: 'main', members: arrival.asking ? [] : [me.id], everyone: arrival.asking ? [] : [me.id], media: null, chat: [], missedChat: false });
    this.personal = personalFor(noteId, () => this.getSnapshot().transcript);
    this.direct = new ScriptedDirectMessages(this, this.crypto, this.ticket, script.privateSendFails);
    this.notifications = new ScriptedNotifications(me.id, this, this.crypto, this.direct);
    this.livekit = new Pushed<RoomSide>({ people: {}, connection: 'connected', endReason: null, mutedYou: 0, sharesStopped: 0 });

    // Whoever's here already, the organizer first when it isn't you; coming back, whoever was still in it as you left.
    const here: Present[] = back ? [...back.here] : [...(script.here ?? [])];
    if (!back && !organizes && !here.some((p) => p.organizer)) here.unshift({ who: meeting.organizer, organizer: true });
    for (const p of here) this.join(p.who, { organizer: p.organizer, guest: p.guest, mic: p.mic, hand: p.hand, sharing: p.sharing, status: p.status });
    // Coming back, what's in the script from here on happens as it would have: what's past has happened.
    const gone = back ? Date.now() - back.began : 0;
    const later = (ms: number, step: () => void) => { if (ms >= gone) this.after(ms - gone, step); };
    for (const message of script.privateMessages ?? []) later((message.after ?? 2) * 1000, () => {
      const from = this.find(message.from);
      const parent = message.replyTo ? this.direct.getSnapshot().messages.find((m) => m.text === message.replyTo) : null;
      if (message.replyTo && !parent) return;
      const mentions = (message.tagged ?? []).flatMap((who): CallChatMention[] => {
        const target = who === 'me' ? this.me : this.find(who);
        if (!target) return [];
        const name = `@${target.person.name}`; const start = message.text.indexOf(name);
        return start < 0 ? [] : [{ identity: target.id, start, end: start + name.length }];
      });
      if (from) this.direct.receive(from.id, message.text, mentions, parent ? { root: parent.thread?.root ?? parent.id, replyTo: parent.id } : null);
    });
    // You come in after them, unless you organized it (or you're asking to be let in).
    if (!organizes && !arrival.asking) this.change((s) => ({ ...s, participants: [...s.participants, me] }));
    // What was said before you came, spread over the time the call has been going; coming back, what was said while you were in it.
    if (back) this.heard = [...back.heard];
    const earlier = back ? [] : script.earlier ?? [];
    earlier.forEach((l, i) => this.heardLine(l, Math.round(((i + 1) / (earlier.length + 1)) * since)));
    // Joining late, the call's notes have been written already.
    if (this.heard.length || script.followUps?.length) {
      this.notesFor = this.heard.length;
      this.change((s) => ({ ...s, liveNotes: { ...s.liveNotes, notes: this.notesNow(), suggestions: this.suggestionsNow(), writing: false, error: this.notesError() } }));
    }
    // The organizer back after someone hosted in their place hosts again at once, and hears who did.
    const stoodIn = back ? back.standIn : script.door?.standIn;
    if (organizes && stoodIn) this.change((s) => ({ ...s, notices: [...s.notices, { id: nextId('notice'), text: `You’re hosting again. ${firstOf(stoodIn)} hosted while you were away.`, kind: 'people' }] }));
    // Anyone else coming back finds whoever you left hosting in the organizer's place still hosting: only the organizer takes it back.
    const standing = !organizes && back?.standIn ? this.find(back.standIn) : undefined;
    if (standing) this.change((s) => ({ ...s, host: { ...s.host, id: standing.id, standIn: true } }));
    this.hosting();
    linkState(meeting.code, () => ({ hostHere: true, standIn: standing ? standing.person : null, locked: false, capture: this.getSnapshot().capture, ended: false }));
    talking(false);

    this.every(1000, () => this.tick());
    const talk = script.talk;
    if (talk) talk.lines.forEach((l, i) => later(((talk.from ?? 2) + i * (talk.every ?? 4.5)) * 1000, () => this.say(l)));
    for (const cue of script.cues ?? []) later(cue.at * 1000, () => this.play(cue.beat));
  }

  /* ---------- the script ---------- */

  private tick(): void {
    this.change((s) => ({
      ...s, attention: { ...s.attention, serverNow: new Date().toISOString(), nudges: s.attention.nudges.filter((n) => Date.parse(n.at) > Date.now() - NUDGE_WINDOW) },
      participants: s.participants.some((p) => ranOut(p.status)) ? s.participants.map((p) => (ranOut(p.status) ? { ...p, status: null } : p)) : s.participants, elapsed: s.elapsed + 1, workspace: s.workspace.play ? { ...s.workspace, play: { ...s.workspace.play, nowMs: Date.now() } } : s.workspace,
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
      case 'hand': { const p = this.find(b.who); if (p) this.handFor(p, b.up); return; }
      case 'question': { const p = this.find(b.who); if (p) this.questionFor(p, b.text, b.votes ?? 0, nextId('question'), b.anonymous ?? false); return; }
      case 'question-vote': this.change((s) => ({ ...s, attention: { ...s.attention, questions: s.attention.questions.map((q) => (q.text === b.text && q.status === 'open' ? { ...q, votes: q.votes + b.votes } : q)) } })); return;
      case 'nudge': { const p = this.find(b.who); if (p) this.nudgeFrom(p, b.kind); return; }
      case 'status': { const p = this.find(b.who); if (p) this.statusFor(p, b.status, b.minutes); return; }
      case 'share': this.them(b.who, (t) => ({ ...t, screen: b.screen })); return;
      case 'stop-sharing': this.them(b.who, (t) => ({ ...t, screen: null })); return;
      case 'unavailable-chat': this.crypto.update((c) => ({ ...c, chat: c.chat.filter((m) => m.text !== b.text) })); return;
      case 'chat':
      case 'reply': {
        const p = this.find(b.who);
        const parent = b.do === 'reply' ? this.crypto.getSnapshot().chat.findLast((m) => m.text === b.to && m.place === this.crypto.getSnapshot().place) : null;
        if (b.do === 'reply' && !parent) return;
        const thread = parent ? { root: parent.thread?.root ?? parent.id, replyTo: parent.id } : null;
        const mentions = b.tagged.flatMap((who): CallChatMention[] => {
          const target = who === 'me' ? this.me : this.find(who);
          if (!target || !this.crypto.getSnapshot().members.includes(target.id)) return [];
          const name = `@${target.person.name}`;
          const start = b.text.indexOf(name);
          return start < 0 ? [] : [{ identity: target.id, start, end: start + name.length }];
        });
        const broadcast = b.do === 'reply' && thread !== null && (b.broadcast ?? false);
        if (p) this.crypto.update((c) => ({ ...c, chat: [...c.chat, { id: nextId('chat'), from: p.id, isMe: false, text: b.text, mentions, thread, broadcast, at: this.getSnapshot().elapsed, place: c.place, sending: false, failed: false, reactions: [] }] }));
        return;
      }
      case 'react': {
        const p = this.find(b.who);
        const message = this.crypto.getSnapshot().chat.findLast((m) => m.text === b.text);
        if (p && message) this.crypto.update((c) => ({ ...c, chat: withReaction(c.chat, message.id, message.place, b.reaction, p.id, true) }));
        return;
      }
      case 'react-privately': { const p = this.find(b.who); if (p) this.direct.receiveReaction(p.id, b.text, b.reaction); return; }
      case 'knock': {
        const person: Person = b.byName ? { id: `guest-${b.who.name}`, name: firstOf(b.who), email: '' } : b.who;
        this.change((s) => ({ ...s, waiting: [...s.waiting, { id: identity(`ask${person.name}${this.ticket.callId}`), person }] }));
        if (this.getSnapshot().isHost) this.cue('admission');
        return;
      }
      case 'ask-for-notes': {
        const p = this.find(b.who);
        if (p) this.change((s) => ({ ...s, capture: { ...s.capture, requests: [...s.capture.requests, { id: nextId('ask'), participantId: p.id, at: new Date().toISOString() }] } }));
        return;
      }
      case 'notes': this.capture(b.mode); return;
      case 'host-cant-hear': this.cantHear(b.records); return;
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
        // The board open in the main room, from a frame.
        const p = this.find(b.who);
        const open = this.boards.get('main')?.at;
        if (p && open) this.startsHere('main', { kind: 'board', by: this.seatOf(p), key: nextId('present'), id: open.documentId, section: b.section ?? 0 });
        this.showBoard();
        return;
      }
      case 'present-workspace': {
        // Whoever presents the workspace has opened it, so the home is settled by then.
        this.settleHome();
        const p = this.find(b.who);
        if (p) this.startsHere('main', { kind: 'workspace', by: this.seatOf(p), key: nextId('present') });
        this.showBoard();
        return;
      }
      case 'move-presenting': {
        const now = this.presented.get('main');
        if (now?.kind === 'board') { this.presented.set('main', { ...now, section: b.section }); this.showBoard(); }
        return;
      }
      case 'stop-presenting': {
        // Whoever's presenting stops it.
        const now = this.presented.get('main');
        this.endsHere('main', b.close ?? false, now ? this.presenterOf(now) : undefined);
        return;
      }
      case 'close-presenting': this.endsHere('main', true, this.getSnapshot().participants.find((p) => p.isOrganizer)); return;
      case 'trash-board': this.boardToTrash(b.folder ?? false); return;
      case 'delete-board-workspace': this.boardWorkspaceGoes(); return;
      case 'reload': this.reloads(b.who, b.seconds); return;
      case 'move-to-room': this.movesToRoom(b.who, b.room); return;
      case 'stop-share': this.theyStopShare(b.who); return;
      case 'play': this.theyPlay(b.who, b.document, b.media); return;
      case 'stop-playing': this.space((w) => ({ ...w, play: null })); return;
      case 'tag-you': this.tagsYou(b.who, b.document, b.block ?? null); return;
      case 'open-board': this.theyOpenBoard(b.who, b.template, b.closedToYou ?? false, b.draw, b.standing); return;
      case 'add-sticky': this.theyAddSticky(b.who, b.frame, b.text); return;
      case 'close-board': {
        // Whoever opened the board where you are closes it, as the server lets them.
        const opened = this.boards.get(this.shownAt(this.crypto.getSnapshot().place));
        this.boardGoes(this.getSnapshot().participants.find((p) => p.id === opened?.openedBy));
        return;
      }
      case 'start-vote': this.theyStartVote(b.who, b.frame, b.per); return;
      case 'end-vote': this.voteEnds(b.votes, b.voters); return;
      case 'clear-vote': void this.session((x) => ({ ...x, vote: null })); return;
      case 'data': {
        const from = this.find(b.who)?.id;
        if (from) for (const take of this.dataTakers) take(b.topic, b.payload, from);
        return;
      }
      case 'heard': this.theyAreHeard(b.ideas); return;
      case 'run': b.what(); return;
    }
  }

  /** The scripted room takes the data others send, until it stops. */
  takeData(on: (topic: string, payload: Uint8Array, from: string) => void): () => void {
    this.dataTakers.add(on);
    return () => { this.dataTakers.delete(on); };
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

  private join(p: Person, o: { organizer?: boolean | undefined; guest?: boolean | undefined; mic?: boolean | undefined; hand?: boolean | undefined; sharing?: Screen | undefined; status?: Present['status'] } = {}): void {
    if (this.find(p)) return;
    this.connections += 1;
    const key = p.email || p.name;
    const seat = this.seats.get(key) ?? `seat-${this.seats.size + 1}`;
    this.seats.set(key, seat);
    const id = identity(`${key}${this.ticket.callId}${this.connections}`);
    if (o.guest) this.guests.add(id);
    // As the server shows people: a guest by the name they typed, with no address, and to a guest, nobody's address.
    const shown = o.guest || this.me.person.email === '' ? { ...p, email: '' } : p;
    const joined: CallParticipant = { id, seat, person: shown, isMe: false, isOrganizer: o.organizer ?? false, hand: o.hand ?? false, status: null, othersPoint: true };
    this.change((s) => ({ ...s, participants: [...s.participants, joined], host: o.organizer && !this.away ? { ...s.host, id } : s.host }));
    if (o.hand) this.handFor(joined, true);
    if (o.status) this.statusFor(joined, o.status.kind, o.status.minutes);
    this.cue('join');
    this.crypto.update((c) => ({ ...c, members: c.place === 'main' && c.status === 'in' ? [...c.members, id] : c.members, everyone: [...c.everyone, id] }));
    this.livekit.update((r) => ({ ...r, people: { ...r.people, [id]: { mic: o.mic ?? true, speaking: false, screen: o.sharing ?? null, sound: false } } }));
  }
  /**
   * Someone leaves on purpose, or is removed: whatever they were presenting ends with them for good, and that's said at once
   * where it was presented. Nobody stopped it, so it ended for them, and everyone following keeps it open on their own.
   */
  private goes(p: Person): void {
    const x = this.find(p);
    if (!x) return;
    for (const [place, q] of [...this.presented]) if (q.by.seat === x.seat) this.endIt(place, q, false);
    this.drops(x);
    this.cue('leave');
  }
  /**
   * Someone's connection is gone, as a reload or a dropped connection leaves it: they're gone from the people, and what they
   * present is hidden until they're back, with nothing said to have ended. What they played for everyone ends with them, and
   * they're not in the workspace any more.
   */
  private drops(x: CallParticipant): void {
    this.change((s) => ({
      ...s, attention: { ...s.attention, hands: s.attention.hands.filter((h) => h.seat !== x.seat) }, participants: s.participants.filter((q) => q.id !== x.id), spotlight: s.spotlight === x.id ? null : s.spotlight,
      breakouts: s.breakouts.open ? { ...s.breakouts, open: { ...s.breakouts.open, rooms: s.breakouts.open.rooms.map((r) => ({ ...r, members: r.members.filter((m) => m !== x.id) })) } } : s.breakouts
    }));
    this.crypto.update((c) => ({ ...c, members: c.members.filter((m) => m !== x.id), everyone: c.everyone.filter((m) => m !== x.id) }));
    this.livekit.update((r) => { const { [x.id]: _gone, ...rest } = r.people; return { ...r, people: rest }; });
    this.space((w) => ({ ...w, play: w.play?.by.seat === x.seat ? null : w.play }));
    this.showBoard();
    if (this.where.delete(x.id)) this.sayWhere();
    this.hosting();
  }
  /**
   * Someone's page reloads: their connection drops (`drops`), so they're gone from the people and what they present is hidden,
   * with nothing said to have ended; `seconds` later they're back on a new connection, in the same seat and the same part of the
   * call, presenting it as it was, with the same key.
   */
  private reloads(who: Person, seconds: number): void {
    const x = this.find(who);
    if (!x) return;
    const room = this.whereIs(x.id);
    const where = this.where.get(x.id);
    const mic = this.livekit.getSnapshot().people[x.id]?.mic;
    const guest = this.guests.has(x.id);
    this.drops(x);
    this.after(seconds * 1000, () => {
      this.join(who, { organizer: x.isOrganizer, guest, mic, hand: x.hand });
      const back = this.find(who);
      if (!back) return;
      if (room !== 'main' && this.getSnapshot().breakouts.open?.rooms.some((r) => r.id === room)) {
        this.change((s) => (s.breakouts.open ? { ...s, breakouts: { ...s.breakouts, open: { ...s.breakouts.open, rooms: s.breakouts.open.rooms.map((r) => (r.id === room ? { ...r, members: [...r.members, back.id] } : r)) } } } : s));
        this.crypto.update((c) => ({ ...c, members: c.place === room ? [...c.members.filter((m) => m !== back.id), back.id] : c.members.filter((m) => m !== back.id) }));
      }
      if (where) { this.where.set(back.id, where); this.sayWhere(); }
      this.showBoard();
      this.hosting();
    });
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
    const id = l.id ?? nextId('line');
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
        this.change((s) => ({ ...s, liveNotes: { ...s.liveNotes, notes: this.notesNow(), suggestions: this.suggestionsNow(), writing: false, error: this.notesError() } }));
        this.writeNotesSoon();
      });
    });
  }
  private suggestionsNow(): LiveFollowUp[] { return [...this.inferred.values()].filter((f) => f.review === 'suggested'); }
  /** Where the call has got to, from what's been said so far. */
  private notesNow(): NonNullable<CallState['liveNotes']['notes']> {
    const s = this.getSnapshot();
    const evidence = (h: { id: string; at: number }) => [{ kind: 'transcript' as const, lineId: h.id, said: h.at }];
    const decided = this.heard.flatMap((h) => (h.line.decides ? [{ text: h.line.decides, evidence: evidence(h) }] : []));
    for (const h of this.heard) {
      const hands = h.line.hands;
      const id = `fu-${h.id}`;
      if (!hands || this.inferred.has(id)) continue;
      const who = hands.owner ?? h.line.who;
      const ownerPerson = who === 'me' ? this.me.person : who;
      this.inferred.set(id, {
        ...ACCEPTED_FOLLOW_UP, review: 'suggested', revision: `${id}-v1`, id, text: hands.text,
        owner: ownerPerson.name, ownerPerson, ...(hands.due ? { due: hands.due } : {}), evidence: evidence(h), done: false
      });
    }
    return {
      summary: this.summaryNow() || decided.map((d) => d.text).join(' '),
      decided,
      proposed: [], open: [],
      next: [...this.inferred.values()].filter((f) => f.review === 'accepted' && f.changeOf === null),
      read: { from: 0, to: s.elapsed, lines: s.transcript.length, through: s.transcript.at(-1)?.at ?? null, gaps: s.capture.gaps, missed: [], whileHere: false, skipped: null, asOf: s.elapsed }
    };
  }

  /** What the live notes say went wrong: the server's words, while the script has them not written again just now. */
  private notesError(): string | null {
    return this.script.notesStale ? 'The notes couldn’t be updated just now. Alcove tries again on its own.' : null;
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

  /** The host's browser can't hear the call: it records on (`records`), so only the transcript stops, or it can do neither. */
  private cantHear(records: boolean): void {
    const at = new Date().toISOString();
    const s = this.getSnapshot();
    const by = s.capture.transcript.by;
    this.push({ ...s, capture: { ...s.capture, mode: records ? s.capture.mode : 'unavailable', transcript: part('unavailable', at, by), recording: records ? s.capture.recording : part('unavailable', at, by) } });
  }

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
      notes: { ...s.notes, segmentStartedAt: mode === 'on' && was !== 'on' ? at : s.notes.segmentStartedAt, everOn: s.notes.everOn || mode === 'on', noteId: s.notes.noteId ?? (mode === 'on' ? this.noteId : null), recording: mode === 'on' && was !== 'on' ? { ...s.notes.recording, segment: s.notes.recording.segment + (s.notes.everOn ? 1 : 0) } : s.notes.recording },
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
   * in Trash or gone has left. The same board keeps its vote and ideas, since its session carries on.
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
    // Everyone here can edit it as the server says: let in, or in the workspace the call opens to everyone, and not restricted.
    const w = this.getSnapshot().workspace;
    const everyone = b.everyone || (w.everyone && b.at.workspaceId === w.id && !item.restricted);
    return {
      open: { ...b.at, name: item.name, role: item.role ?? 'edit', everyone, ...seen },
      timer: null, vote: same ? was.vote : null, ideas: same ? was.ideas : []
    };
  }
  /** Where someone is in the call now, by their participant ID: the room they're in, or the main room. */
  private whereIs(id: string): string { return this.getSnapshot().breakouts.open?.rooms.find((r) => r.members.includes(id))?.id ?? 'main'; }
  /** Whoever presents it, on the connection they're on now: none while they're reloading. */
  private presenterOf(p: Presented): CallParticipant | undefined { return this.getSnapshot().participants.find((x) => x.seat === p.by.seat); }
  private isMine(p: Presented): boolean { return p.by.seat === this.me.seat; }
  /** Whether someone other than `seat` presents the board open at `at`, there or in a room that shares it, while they're here. */
  private presentedByOthers(at: string, seat: string): boolean {
    const open = this.boards.get(at)?.at;
    return [...this.presented].some(([place, p]) => p.kind === 'board' && p.id === open?.documentId && this.shownAt(place) === at && p.by.seat !== seat && this.presenterOf(p) !== undefined);
  }
  /**
   * What's presented where you are, as you may know it: the board open there, a frame at a time, or the workspace everyone
   * views. Someone who can open nothing in the workspace is told who's presenting it, and nothing else. A presentation of a
   * board that's closed is over; one whose presenter is reloading is hidden until they're back.
   */
  private presentHere(): CallPresent | null {
    const s = this.getSnapshot();
    const place = this.crypto.getSnapshot().place;
    const p = this.presented.get(place);
    const by = p ? this.presenterOf(p) : undefined;
    if (!p || !by || this.whereIs(by.id) !== place) return null;
    const mine = by.id === this.me.id;
    const seen = { key: p.key, by: this.seatOf(by), mine };
    if (p.kind === 'workspace') {
      const w = s.workspace;
      return w.canOpen && w.id !== null ? { kind: 'workspace', id: w.id, name: null, section: null, ...seen } : { kind: null, id: null, name: null, section: null, ...seen };
    }
    const open = this.boards.get(this.shownAt(place))?.at;
    const item = open?.documentId === p.id ? this.itemIn(open.workspaceId, p.id) : undefined;
    return item ? { kind: 'board', id: p.id, name: item.name, section: p.section, ...seen } : null;
  }
  /** A presentation starts in a part of the call, in place of whatever was presented there, and nothing has ended there since. */
  private startsHere(place: string, p: Presented): void {
    this.presented.set(place, p);
    this.ended.delete(place);
  }
  /**
   * What's presented in a part of the call ends for good, said there at once, as the server says it (`ended`): for whoever
   * presented it, everyone following keeping it open on their own, or for everyone (`close`). Its presenter, whoever or whatever
   * ended it.
   */
  private endIt(place: string, p: Presented, close: boolean): void {
    this.presented.delete(place);
    this.ended.set(place, { key: p.key, close, by: p.by });
  }
  /**
   * What's presented in a part of the call ends as `by` ends it, its presenter or the organizer: for whoever presented it, which
   * only they choose, or for everyone (`close`). So a presenter whose presentation closed for everyone without them knows it was
   * the organizer. A board closed for everyone closes in the call too, where it's open: by the organizer always; by anyone else
   * when it's this part of the call's own board or they opened it, and nobody else presents it where it shows. Otherwise it's
   * closed for everyone in this part of the call alone, and the board stays.
   */
  private endsHere(place: string, close: boolean, by: CallParticipant | undefined): void {
    const p = this.presented.get(place);
    if (!p) return;
    this.endIt(place, p, close);
    const at = this.shownAt(place);
    const mayClose = by !== undefined && (by.isOrganizer || ((at === place || this.boards.get(at)?.openedBy === by.id) && !this.presentedByOthers(at, by.seat)));
    if (p.kind === 'board' && close && mayClose) this.boardOut(at, by);
    this.showBoard();
  }
  /**
   * The board open in a part of the call (`at`) closes for everyone, there and in each room that shares it, as `by` closes it:
   * every presentation of it ends, said at once, for everyone when its presenter or the organizer closed it, and otherwise for
   * its presenter alone, as nobody else closes someone's presentation for everyone. The faces come back, and nothing on it is lost.
   */
  private boardOut(at: string, by: CallParticipant | undefined): void {
    const open = this.boards.get(at)?.at;
    for (const [place, p] of [...this.presented]) {
      if (p.kind !== 'board' || !open || p.id !== open.documentId || this.shownAt(place) !== at) continue;
      this.endIt(place, p, by !== undefined && (by.isOrganizer || p.by.seat === by.seat));
    }
    this.boards.delete(at);
    this.onIt.clear();
  }
  /** Whoever's gone to another part of the call has left what they presented where they were: it ends there for good, said at once. */
  private endsMoved(): void {
    for (const [place, p] of [...this.presented]) {
      const by = this.presenterOf(p);
      if (by && this.whereIs(by.id) !== place) this.endIt(place, p, false);
    }
  }
  /** Tells the call what's open where you are now, what's presented there, which rooms are on a board of their own, and who's on yours. */
  private showBoard(): void {
    // A board presented that isn't open where it was presented any more, or that's in Trash or gone, is over: that's said there.
    for (const [place, p] of [...this.presented]) {
      const open = this.boards.get(this.shownAt(place))?.at;
      if (p.kind === 'board' && (open?.documentId !== p.id || !this.itemIn(open.workspaceId, p.id))) this.endIt(place, p, false);
    }
    const present = this.presentHere();
    const last = this.ended.get(this.crypto.getSnapshot().place) ?? null;
    this.change((s) => ({
      ...s, board: this.boardHere(s.board), workspace: { ...s.workspace, present, ended: last && last.key !== present?.key ? last : null },
      breakouts: s.breakouts.open ? { ...s.breakouts, open: { ...s.breakouts.open, board: this.boardMode, rooms: s.breakouts.open.rooms.map((r) => ({ ...r, board: this.boards.has(r.id) })) } } : s.breakouts
    }));
    this.sayWhoIsOn();
  }
  /**
   * Who's on the board where you are now, as its awareness says them to whoever has it open: someone else presenting it with their
   * view on the frame they're on, as their browser says it, which is what everyone following them sees.
   */
  private sayWhoIsOn(): void {
    const at = this.hereAt();
    if (!at) return;
    const shown = this.presentersView(at);
    onTheBoard(at.documentId, this.getSnapshot().participants.flatMap((p) => {
      if (p.isMe) return [];
      if (shown && p.seat === shown.seat) return [{ callIdentity: p.id, person: p.person, at: shown.at, view: shown.view }];
      const point = this.onIt.get(p.id);
      return point ? [{ callIdentity: p.id, person: p.person, at: point }] : [];
    }));
  }
  /**
   * Someone else presenting the board where you are: their seat, and their pointer and view on the frame they're on, of its frames
   * in the order they sit, framed with room round it as their sheet would show it: a laptop's stage, `PRESENTERS_SHEET` times as
   * wide as it's tall, which their view says (`h`), as a browser does, so everyone following sees all of it, whatever their shape.
   */
  private presentersView(at: { workspaceId: string; documentId: string }): { seat: string; at: { x: number; y: number }; view: { x: number; y: number; z: number; h: number } } | null {
    const now = this.presented.get(this.crypto.getSnapshot().place);
    if (now?.kind !== 'board' || now.id !== at.documentId || this.isMine(now)) return null;
    const frames = readBoard(boardDoc(at.workspaceId, at.documentId)).frames.filter((f) => !f.f).sort(reading);
    const f = frames[Math.min(now.section, frames.length - 1)];
    if (!f) return null;
    const middle = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
    const wide = Math.max(f.w + 160, (f.h + 200) * PRESENTERS_SHEET);
    return { seat: now.by.seat, at: { x: middle.x + 40, y: middle.y + 30 }, view: { ...middle, z: BOARD_VIEW_WIDTH / wide, h: BOARD_VIEW_WIDTH / PRESENTERS_SHEET } };
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
        this.boards.set(r.id, { at: made, openedBy: by, everyone: true });
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
      this.boards.set('main', { at: main, openedBy: by, everyone: true });
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
      this.boards.set('main', { at: main, openedBy: this.organizerId(), everyone: true });
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
    const attention = this.getSnapshot().attention;
    this.attentionRooms.set(attention.place, { ...attention, hands: attention.hands.filter((h) => h.seat !== this.me.seat), nudges: [] });
    const nextAttention = this.attentionRooms.get(place) ?? { place, hands: [], questions: [], nudges: [], cues: [], latest: 0, serverNow: new Date().toISOString() };
    this.change((s) => ({ ...s, attention: nextAttention }));
    this.crypto.update((c) => ({ ...c, status: 'moving', place }));
    this.showBoard();
    this.after(1200, () => this.crypto.update((c) => ({ ...c, status: 'in', members })));
  }
  /** The organizer (not you) opens rooms: you're sent to yours, if you're in one. */
  private opensRooms(plans: readonly RoomPlan[], minutes: number, board?: BreakoutBoard | undefined): void {
    const s = this.getSnapshot();
    const idOf = (p: Person | 'me') => (p === 'me' ? this.me.id : this.find(p)?.id);
    // Guests (anyone who came in with the link) go by seat, by name only; everyone else by address.
    const guest = (p: Person | 'me') => { const id = idOf(p); return id !== undefined && this.guests.has(id); };
    const rooms = plans.map((plan, k) => {
      const members = plan.people.flatMap((p) => { const id = idOf(p); return id ? [id] : []; });
      return {
        id: this.roomId(k), name: plan.name, people: plan.people.flatMap((p) => (guest(p) ? [] : [p === 'me' ? this.me.person : p])),
        guests: plan.people.flatMap((p) => { const x = p === 'me' ? this.me : this.find(p); return x && guest(p) ? [this.asGuest(x)] : []; }), members, paused: false, board: false
      };
    });
    this.boardsForRooms(board, rooms.map((r, k) => ({ ...r, work: plans[k]?.work })));
    const mine = rooms.find((r) => r.members.includes(this.me.id));
    const scribe = mine ? mine.members.find((id) => id !== this.me.id && !this.guests.has(id)) ?? this.me.id : null;
    this.push({ ...s, breakouts: { ...s.breakouts, open: { rooms, board: this.boardMode, from: s.elapsed, until: s.elapsed + minutes * 60, message: null } }, capture: { ...s.capture, room: mine && notesAreOn(s.capture.mode) ? this.roomCapture(mine.id, scribe) : null } });
    // Whoever was presenting in the main room and goes to a room leaves it: it ends there, said at once.
    this.endsMoved();
    const main = s.participants.filter((p) => !rooms.some((r) => r.members.includes(p.id))).map((p) => p.id);
    if (mine) this.moveTo(mine.id, mine.members);
    else { this.crypto.update((c) => ({ ...c, members: main })); this.showBoard(); }
    this.hosting();
  }
  openRooms(plan: BreakoutPlan): void {
    const s = this.getSnapshot();
    const rooms = plan.rooms.map((r, k) => {
      const guests = s.participants.filter((p) => !p.isMe && (r.seats ?? []).includes(p.seat));
      const invited = s.participants.filter((p) => !p.isMe && r.emails.some((e) => e.toLowerCase() === p.person.email.toLowerCase()));
      return {
        id: this.roomId(k), name: r.name, people: r.emails.map(personAt), guests: guests.map((p) => this.asGuest(p)), paused: false, board: false,
        members: [...invited, ...guests].map((p) => p.id)
      };
    });
    this.boardsForRooms(plan.board, rooms);
    this.push({ ...s, breakouts: { ...s.breakouts, open: { rooms, board: this.boardMode, from: s.elapsed, until: s.elapsed + plan.minutes * 60, message: null } } });
    this.endsMoved();
    this.showBoard();
    // The organizer starts in the main room, keeping every room's keys, unless they chose a room to start in: then they visit it.
    const visiting = plan.visit === undefined ? undefined : rooms[plan.visit];
    if (visiting) this.visitRoom(visiting.id);
    else this.crypto.update((c) => ({ ...c, members: s.participants.filter((p) => !rooms.some((r) => r.members.includes(p.id))).map((p) => p.id) }));
    this.hosting();
  }
  /** Someone in the call as a room names a guest: by seat, by name only. */
  private asGuest(p: CallParticipant): { seat: string; person: Person } {
    return { seat: p.seat, person: { id: p.id, name: p.person.name, email: '', ...(p.person.portrait ? { portrait: p.person.portrait } : {}) } };
  }
  closeRooms(): void {
    const s = this.getSnapshot();
    const open = s.breakouts.open;
    if (!open) return;
    this.push({ ...s, breakouts: { open: null, held: [...s.breakouts.held, { rooms: open.rooms.map(({ paused: _p, board: _b, ...r }) => r), from: open.from, to: s.elapsed }] }, capture: { ...s.capture, room: null } });
    for (const place of this.presented.keys()) if (place !== 'main') this.presented.delete(place);
    for (const place of this.ended.keys()) if (place !== 'main') this.ended.delete(place);
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
    // What you were presenting where you were ends there.
    this.endsMoved();
    this.moveTo(roomId ?? 'main', room ? room.members : s.participants.filter((p) => !rooms.some((r) => r.members.includes(p.id))).map((p) => p.id));
  }
  renameRoom(roomId: string, name: string): void {
    this.change((s) => (s.breakouts.open ? { ...s, breakouts: { ...s.breakouts, open: { ...s.breakouts.open, rooms: s.breakouts.open.rooms.map((r) => (r.id === roomId ? { ...r, name } : r)) } } } : s));
  }
  moveToRoom(person: RoomPerson, roomId: string | null): void {
    this.change((s) => {
      const open = s.breakouts.open;
      const who = s.participants.find((p) => (person.email !== undefined ? p.person.email.toLowerCase() === person.email.toLowerCase() : p.seat === person.seat));
      if (!open || !who) return s;
      // A guest goes by seat, so the rooms name them; someone invited by address.
      const rooms = open.rooms.map((r) => {
        const to = r.id === roomId;
        const guests = person.seat === undefined ? r.guests : [...r.guests.filter((g) => g.seat !== person.seat), ...(to ? [this.asGuest(who)] : [])];
        const people = person.email === undefined ? r.people : [...r.people.filter((p) => p.email.toLowerCase() !== person.email.toLowerCase()), ...(to ? [who.person] : [])];
        return { ...r, people, guests, members: to ? [...r.members.filter((m) => m !== who.id), who.id] : r.members.filter((m) => m !== who.id) };
      });
      return { ...s, breakouts: { ...s.breakouts, open: { ...open, rooms } } };
    });
    // What they were presenting where they were ends there.
    this.endsMoved();
    this.showBoard();
  }
  /**
   * The organizer (not you) moves someone, or you, to the open room with this name, or back to the main room (null): what they
   * were presenting where they were ends there, said at once, and you, moved, go to your new part of the call.
   */
  private movesToRoom(who: Person | 'me', name: string | null): void {
    const s = this.getSnapshot();
    const open = s.breakouts.open;
    const x = who === 'me' ? this.me : this.find(who);
    const to = name === null ? null : open?.rooms.find((r) => r.name === name);
    if (!open || !x || to === undefined) return;
    const rooms = open.rooms.map((r) => ({ ...r, members: r.id === to?.id ? [...r.members.filter((m) => m !== x.id), x.id] : r.members.filter((m) => m !== x.id) }));
    const room = rooms.find((r) => r.id === to?.id);
    const capture = x.isMe ? { ...s.capture, room: room && notesAreOn(s.capture.mode) ? this.roomCapture(room.id, room.members.find((m) => m !== this.me.id) ?? null, room.paused) : null } : s.capture;
    this.push({ ...s, breakouts: { ...s.breakouts, open: { ...open, rooms } }, capture });
    this.endsMoved();
    if (x.isMe) this.moveTo(room?.id ?? 'main', room ? room.members : s.participants.filter((p) => !rooms.some((r) => r.members.includes(p.id))).map((p) => p.id));
    else this.showBoard();
    this.hosting();
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
    // Their connection dropped, which isn't leaving: what they present is hidden until they're back, and nothing ended.
    this.drops(organizer);
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
    // What they were presenting shows again, as it was.
    this.showBoard();
    this.hosting();
  }

  /** Whoever hosts (not you) ends the call: it's over for everyone, and everyone invited can follow its notes being written. */
  private ends(): void {
    this.endsWith(this.getSnapshot());
    this.change((s) => ({ ...s, phase: 'ended' }));
    this.livekit.update((r) => ({ ...r, connection: 'ended', endReason: 'ended-by-host' }));
    this.halt();
  }
  /**
   * The call ends for everyone, as the server ends it: it's over in the world and its link says so, and its note, if notes
   * were ever on, is written as everyone invited is given it, before anyone's out of the call.
   */
  private endsWith(s: CallState): string | null {
    const w = current();
    const noteId = s.notes.everOn ? s.notes.noteId : null;
    w.meetings = w.meetings.map((m) => (m.id === this.meeting.id ? { ...m, status: 'ended', duration: s.elapsed, ...(noteId ? { noteId } : {}) } : m));
    linkState(this.meeting.code, (l) => ({ hostHere: false, standIn: null, locked: false, capture: null, ...l, ended: true }));
    if (noteId) {
      const decided = this.heard.flatMap((h) => (h.line.decides ? [{ id: `${noteId}-d${h.id}`, text: h.line.decides, at: clockOf(h.at), state: 'proposed' as const }] : []));
      const actionSpec = (row: LiveFollowUp) => ({
        id: row.id, text: row.text, revision: row.revision, reviewed: row.reviewed, ...(row.ownerPerson ? { owner: row.ownerPerson } : {}), ...(row.due ? { due: row.due } : {}),
        ...(row.evidence[0] ? { at: clockOf(row.evidence[0].said) } : {}), done: row.done, ...(row.target ? { target: row.target } : {})
      });
      const actions = [...(s.liveNotes.notes?.next ?? []), ...s.liveNotes.added].map(actionSpec);
      const suggestions = s.liveNotes.suggestions.map(actionSpec);
      const spec = {
        id: noteId, title: s.title, startedAt: s.startedAt, minutes: Math.max(1, Math.round(s.elapsed / 60)), organizer: this.meeting.organizer, invited: this.meeting.guests,
        excerpt: this.script.summary ?? 'Notes from the call.', summary: this.script.summary, meetingId: this.meeting.id, decisions: decided, actions, suggestions,
        said: s.transcript.map((l) => ({ at: clockOf(l.at), who: l.speaker?.person, text: l.text }))
      };
      w.notes.unshift(writeNote({ ...spec, status: 'pending' }));
      w.writing = { id: noteId, seconds: 8, written: () => writeNote(spec) };
    }
    return noteId;
  }
  /**
   * You left, and the call goes on without you, as the server keeps it: where it had got to, for joining it again, and its
   * script's end, which can still come while you're on its page. `standIn`: whoever you left hosting in the organizer's place.
   */
  private goesOn(standIn: Person | null): void {
    const s = this.getSnapshot();
    const lk = this.livekit.getSnapshot();
    const call: GoingOn = {
      callId: this.ticket.callId, noteId: this.noteId, startedAt: s.startedAt, began: this.began, standIn, pass: this.ticket.pass,
      here: s.participants.filter((p) => !p.isMe).map((p) => ({ who: p.person, organizer: p.isOrganizer, guest: this.guests.has(p.id), mic: lk.people[p.id]?.mic ?? true })),
      heard: [...this.heard], transcript: s.transcript, capture: s.capture, notes: s.notes
    };
    const w = current();
    const end = (this.script.cues ?? []).find((c) => c.beat.do === 'end' && c.at * 1000 >= Date.now() - this.began);
    const ends = end ? setTimeout(() => {
      if (current() !== w || goingOnIn(w).get(this.meeting.code)?.call !== call) return;
      goingOnIn(w).delete(this.meeting.code);
      this.endsWith({ ...s, elapsed: Math.round((Date.now() - Date.parse(s.startedAt)) / 1000) });
    }, end.at * 1000 - (Date.now() - this.began)) : null;
    goingOnIn(w).set(this.meeting.code, { call, ends });
  }

  /* ---------- the session ---------- */

  room(): Promise<{ serverUrl: string; roomName: string; identity: string; token: string }> {
    return Promise.resolve({ serverUrl: this.ticket.serverUrl, roomName: this.ticket.roomName, identity: this.ticket.identity, token: 'storybook' });
  }
  refresh(): Promise<void> { return Promise.resolve(); }
  sendChat(text: string, mentions: readonly CallChatMention[] = [], thread: import('@alcove/api').CallChatThread | null = null, broadcast = false): Promise<void> {
    const leading = text.length - text.trimStart().length;
    const parsed = CallChatTextSchema.safeParse({ text: text.trim(), mentions: mentions.map((m) => ({ ...m, start: m.start - leading, end: m.end - leading })), thread, broadcast, at: this.getSnapshot().elapsed });
    const now = this.crypto.getSnapshot();
    if (!parsed.success || parsed.data.mentions.some((m) => !now.members.includes(m.identity))) return Promise.reject(new AlcoveApiError('invalid', 'Choose people who are in this part of the call.'));
    if (parsed.data.thread) {
      const target = now.chat.find((m) => m.id === parsed.data.thread?.replyTo && m.place === now.place && !m.failed && !m.sending);
      if (!target || (target.thread?.root ?? target.id) !== parsed.data.thread.root) return Promise.reject(new AlcoveApiError('not-found', 'That conversation isn’t available in this room.'));
    }
    const failed = this.chatFailures < (this.script.chatFailures ?? 0);
    if (failed) this.chatFailures++;
    this.crypto.update((c) => ({ ...c, chat: [...c.chat, { id: nextId('chat'), from: this.me.id, isMe: true, text: parsed.data.text, mentions: parsed.data.mentions, thread: parsed.data.thread, broadcast: parsed.data.broadcast, at: parsed.data.at, place: c.place, sending: false, failed, reactions: [] }] }));
    return Promise.resolve();
  }
  retryChat(messageId: string): Promise<void> {
    const message = this.crypto.getSnapshot().chat.find((m) => m.id === messageId && m.failed);
    if (!message || message.place !== this.crypto.getSnapshot().place) return Promise.reject(new AlcoveApiError('conflict', 'Return to the original conversation before retrying this message.'));
    this.crypto.update((c) => ({ ...c, chat: c.chat.map((m) => m.id === messageId ? { ...m, failed: false } : m) }));
    return Promise.resolve();
  }
  readChat(ids: readonly string[]): Promise<void> {
    const readable = this.crypto.getSnapshot().chat.filter((m) => ids.includes(m.id)).map((m) => m.id);
    this.change((s) => ({ ...s, chatRead: [...new Set([...s.chatRead, ...readable])].slice(-200) }));
    return Promise.resolve();
  }
  /** Yours on a message, on or off: the same rules as the real call's. */
  react(messageId: string, reaction: CallReaction, on: boolean): Promise<void> {
    try { reactionTarget(this.crypto.getSnapshot(), this.crypto.getSnapshot().place, messageId); }
    catch (e) { return Promise.reject(e); }
    this.crypto.update((c) => ({ ...c, chat: withReaction(c.chat, messageId, c.place, reaction, this.me.id, on) }));
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
    super.push({ ...next, revision: next.revision + 1, attention: { ...next.attention, serverNow: new Date().toISOString() } });
    if (this.followWatchers > 0) this.tellFollowUps();
  }
  private space(change: (w: CallWorkspace) => CallWorkspace): void { this.change((s) => ({ ...s, workspace: change(s.workspace) })); }
  private get seat(): CallSeat { return { seat: this.me.seat, name: this.me.person.name }; }
  private seatOf(p: CallParticipant): CallSeat { return { seat: p.seat, name: p.person.name }; }
  /** An item that's in its workspace and not in Trash; none in a workspace that's been deleted. */
  private itemIn(workspaceId: string, id: string): WorkspaceItem | undefined { return current().workspaces.find((w) => w.id === workspaceId)?.items.find((i) => i.id === id && i.trashedAt === null); }
  private organizerOnly(): Promise<void> | null {
    return this.getSnapshot().isOrganizer ? null : Promise.reject(new AlcoveApiError('forbidden', 'Only the organizer chooses the call’s workspace.'));
  }

  /**
   * The first time Workspace opens, the call's home: the meeting's own, with this call's folder put at its top, else a new
   * workspace named after the call and the day, with the folder in it. The organizer is its admin and everyone invited
   * edits; someone who came in with the link isn't in it, and has it, as everyone in the call does, while they're in the call.
   */
  private settleHome(): void {
    const s = this.getSnapshot();
    if (this.homeId !== null) return;
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
      home = { id: nextId('home'), name, role: s.isOrganizer ? 'admin' : s.role === 'guest' ? null : 'edit', inCall: false, people: this.meeting.guests.length + 1, items: [folder], createdAt: now, call: { title: this.meeting.title, at: s.startedAt } };
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
  /**
   * Everyone views `id`: what was presented, a board or the workspace, ends for good in every part of the call, said there at
   * once; what was played stops; and everyone else is on its list until they open something there. It opens to everyone in the
   * call, to edit what isn't restricted, while they're in it, and the one it used before closes to whoever isn't in it.
   */
  private view(id: string): void {
    const was = this.getSnapshot().workspace.id;
    const tree = this.openedToCall(id);
    if (was !== null && was !== id) {
      treeOf(was).inCall = false;
      hereIn(was, []);
      for (const [k, v] of this.where) this.where.set(k, { ...v, document: v.document !== null && this.itemIn(id, v.document) ? v.document : null });
      for (const [place, p] of [...this.presented]) this.endIt(place, p, false);
    }
    this.space((w) => ({ ...w, id, home: this.homeId, name: tree.name, canOpen: true, role: tree.role, everyone: true, play: null }));
    this.showBoard();
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
  /* Someone else playing or tagging you in it has opened Workspace, so the home is settled by then. */
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
    const next: CallFollowUps = { items, suggestions: s.liveNotes.suggestions, notes: mode === 'off' ? 'off' : mode === 'paused' ? 'paused' : 'on' };
    if (JSON.stringify(next) !== JSON.stringify(this.followUps.getSnapshot())) this.followUps.set(next);
  }
  watchFollowUps(): () => void {
    this.followWatchers += 1;
    this.tellFollowUps();
    let stopped = false;
    return () => { if (!stopped) { stopped = true; this.followWatchers -= 1; } };
  }
  openWorkspace(): Promise<void> { this.settleHome(); return Promise.resolve(); }
  /**
   * A workspace as someone in a call that uses it has it: everything in it that isn't restricted opens to them, to edit. For
   * someone who isn't in it, a guest say, that's all they have: its name, and no say in who has what. The world is as you see
   * it, so it's written here as you'd see it.
   */
  private openedToCall(id: string): Space {
    const tree = treeOf(id);
    tree.inCall = true;
    // The world is as Art has it: a guest with the link is in none of it.
    if (this.getSnapshot().role === 'guest') tree.role = null;
    if (tree.role !== null) return tree;
    tree.people = null;
    tree.items = tree.items.filter((i) => !i.restricted).map((i) => ({ ...i, role: 'edit' }));
    return tree;
  }
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
      id, name: name?.trim() || this.meeting.title, role: 'admin', inCall: false, people: this.meeting.guests.length + 1, items: [], createdAt: new Date().toISOString(),
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
  /**
   * The workspace everyone views, for someone who can open it, or a board where it's open, as the server lets either be: one at a
   * time where you are. Presenting while you present something presents this in its place; the same again is the same one.
   */
  startPresenting(what: PresentStart): Promise<void> {
    const place = this.crypto.getSnapshot().place;
    const w = this.getSnapshot().workspace;
    if (what.kind === 'workspace' ? w.id === null || !w.canOpen : this.boards.get(this.shownAt(place))?.at?.documentId !== what.id) {
      return Promise.reject(new AlcoveApiError('not-found', `That ${what.kind === 'workspace' ? 'workspace' : 'document'} doesn’t exist, or you don’t have access to it.`));
    }
    const there = this.presented.get(place);
    // Someone else's here, while they're here, is in the way; while they reload it isn't, and it ends for good, said at once. A
    // new one of yours here is the end of your last, as a start clears how the last one ended.
    if (there && !this.isMine(there) && this.presenterOf(there)) return Promise.reject(new AlcoveApiError('conflict', 'Someone else is presenting here.'));
    const mine = there && this.isMine(there) ? there : undefined;
    const same = what.kind === 'workspace' ? mine?.kind === 'workspace' : mine?.kind === 'board' && mine.id === what.id;
    const key = same && mine ? mine.key : nextId('present');
    this.startsHere(place, what.kind === 'workspace' ? { kind: 'workspace', by: this.seat, key } : { kind: 'board', by: this.seat, key, id: what.id, section: what.section ?? 0 });
    if (there && !mine) this.ended.set(place, { key: there.key, close: false, by: there.by });
    this.showBoard();
    return Promise.resolve();
  }
  /** What's presented where you are, while its presenter is here, for whoever started it or the organizer to move on or stop. */
  private presentedHere(): { place: string; now: Presented } | AlcoveApiError {
    const place = this.crypto.getSnapshot().place;
    const now = this.presented.get(place);
    if (!now || !this.presenterOf(now)) return new AlcoveApiError('conflict', 'Nothing is being presented here.');
    if (!this.isMine(now) && !this.me.isOrganizer) return new AlcoveApiError('forbidden', 'Only whoever started this, or the organizer, can do that.');
    return { place, now };
  }
  movePresenting(section: number): Promise<void> {
    const here = this.presentedHere();
    if (here instanceof AlcoveApiError) return Promise.reject(here);
    if (here.now.kind !== 'board') return Promise.reject(new AlcoveApiError('conflict', 'Only a board is presented a frame at a time.'));
    this.presented.set(here.place, { ...here.now, section });
    this.showBoard();
    return Promise.resolve();
  }
  stopPresenting(close: boolean): Promise<void> {
    const here = this.presentedHere();
    if (here instanceof AlcoveApiError) return Promise.reject(here);
    if (!close && !this.isMine(here.now)) return Promise.reject(new AlcoveApiError('forbidden', 'Only whoever’s presenting this can end it just for themselves.'));
    this.endsHere(here.place, close, this.me);
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
   * Someone makes a new board, the board in the main room, made in the call's home and filled as the server fills it, with
   * what `draw` puts on it; or one you can't open (`closedToYou`). It opens on their stage alone until they present it. Then the others work on it as the script says. With a
   * `standing`, your browser opens it as the world says it stands for you: no connection to it, or what's added here refused.
   */
  private theyOpenBoard(who: Person, template: BoardTemplate, closedToYou: boolean, draw?: ((doc: ReturnType<typeof boardDoc>) => void) | undefined, standing?: 'offline' | 'failed' | undefined): void {
    const p = this.find(who);
    if (!p) return;
    const at = closedToYou ? null : this.makeBoard(this.meeting.title, template, false);
    if (!closedToYou && !at) return;
    if (at) draw?.(boardDoc(at.workspaceId, at.documentId));
    if (at && standing) current().boards[at.documentId] = { ...current().boards[at.documentId], standing };
    this.boards.set('main', { at, openedBy: p.id, everyone: !closedToYou });
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
  /**
   * Someone moves the board where you are to Trash in the Drive, or the folder it's in (`folder`: the call's folder, where the
   * server makes a call's board, for one that's in none): its own connection says it's in Trash (`trashItem`), it leaves the call
   * for everyone, as the server takes a board in Trash out of it until it's back, and what presented it ends (`showBoard`).
   */
  private boardToTrash(folder: boolean): void {
    const at = this.hereAt();
    const item = at ? this.itemIn(at.workspaceId, at.documentId) : undefined;
    if (!at || !item) return;
    const into = folder ? item.parent ?? treeOf(at.workspaceId).items.find((i) => i.kind === 'folder' && i.call?.here === true)?.id ?? null : null;
    if (folder && into === null) return;
    if (into !== null && item.parent === null) moveItem(at.workspaceId, item.id, { parent: into });
    trashItem(at.workspaceId, into ?? item.id);
    this.showBoard();
  }
  /**
   * Someone deletes the workspace the board where you are is kept in: its own connection says it was deleted (`removeWorkspace`),
   * it leaves the call for everyone, and what presented it ends. When it's the workspace the call views, or its home, nothing in
   * it opens any more, and opening Workspace again settles on another home.
   */
  private boardWorkspaceGoes(): void {
    const at = this.hereAt();
    if (!at) return;
    removeWorkspace(at.workspaceId);
    if (this.homeId === at.workspaceId) this.homeId = null;
    if (this.getSnapshot().workspace.id === at.workspaceId) this.space((w) => ({ ...w, id: null, home: this.homeId, name: null, canOpen: false, role: null, everyone: false, documents: [], agenda: null, play: null }));
    this.showBoard();
  }
  /**
   * Whoever opened the board where you are, or the organizer, closes it for everyone there (`boardOut`): the faces come back, and
   * nothing on it is lost. As the server does, nobody but the organizer closes it while someone else presents it. Why not, if not.
   */
  private boardGoes(by: CallParticipant | undefined): AlcoveApiError | null {
    const at = this.shownAt(this.crypto.getSnapshot().place);
    const b = this.boards.get(at);
    if (!b) return new AlcoveApiError('conflict', 'No board is open here.');
    if (!by || (b.openedBy !== by.id && !by.isOrganizer)) return new AlcoveApiError('forbidden', 'Only whoever opened this board, or the organizer, can close it.');
    if (!by.isOrganizer && this.presentedByOthers(at, by.seat)) return new AlcoveApiError('conflict', 'Someone else is presenting this board. You can close it once they stop.');
    this.boardOut(at, by);
    this.showBoard();
    return null;
  }
  private theyStartVote(who: Person, title: string | null, per: BoardVotesEach): void {
    const p = this.find(who);
    if (!p) return;
    const at = this.hereAt();
    const frame = this.frameCalled(at ? boardDoc(at.workspaceId, at.documentId) : null, title)?.id ?? null;
    void this.session((b) => (b.vote ? b : { ...b, vote: { on: true, frame, per, left: per, mine: [], results: {}, voters: 0, canEnd: this.me.isOrganizer, startedBy: p.id } }));
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
    // Nobody makes or brings in a board while someone else presents one here: it would take theirs off everyone's stage.
    const there = this.presented.get(place);
    if (there?.kind === 'board' && !this.isMine(there) && this.presenterOf(there) && !('documentId' in from && from.documentId === there.id)) {
      return Promise.reject(new AlcoveApiError('conflict', 'Someone else is presenting a board here. You can start one once they stop.'));
    }
    if ('template' in from) {
      const room = place === 'main' ? undefined : this.getSnapshot().breakouts.open?.rooms.find((r) => r.id === place);
      const at = this.makeBoard(room ? `${room.name} board` : this.meeting.title, from.template, room !== undefined);
      if (!at) return Promise.reject(new AlcoveApiError('forbidden', 'Only someone invited can start a board.'));
      this.boards.set(place, { at, openedBy: this.me.id, everyone: true });
      if (room) this.roomBoards.set(place, { ...at, name: room.name, who: room.people.map(firstOf) });
    } else {
      if (place !== 'main') return Promise.reject(new AlcoveApiError('conflict', 'Open a board from the main room.'));
      // Let in, everyone here can edit it while they're in the call; otherwise it opens for whoever can open it already.
      this.boards.set('main', { at: { workspaceId: from.workspaceId, documentId: from.documentId }, openedBy: this.me.id, everyone: from.letIn });
    }
    this.onIt.clear();
    this.showBoard();
    if (place === 'main') this.othersWorkOnIt();
    return Promise.resolve();
  }
  closeBoard(): Promise<void> {
    const no = this.boardGoes(this.me);
    return no ? Promise.reject(no) : Promise.resolve();
  }
  /**
   * Who here can't open a saved board: anyone who came with the link, and anyone not in its workspace, but for one in the workspace
   * the call opens to everyone, which they can. You may let them in if
   * you may share it: you can edit it, in a workspace you're in.
   */
  boardCheck(workspaceId: string, documentId: string): Promise<BoardCheck> {
    const members = new Set(peopleIn(workspaceId).map((p) => p.person.email.toLowerCase()));
    // The workspace the call opens to everyone opens what isn't restricted in it to everyone here.
    const w = this.getSnapshot().workspace;
    const toCall = w.everyone && w.id === workspaceId && this.itemIn(workspaceId, documentId)?.restricted === false;
    const cannot = toCall ? [] : this.getSnapshot().participants.filter((p) => !p.isMe && (this.guests.has(p.id) || !members.has(p.person.email.toLowerCase()))).map((p) => firstOf(p.person));
    return Promise.resolve({ cannot, mayLetIn: treeOf(workspaceId).role !== null && this.itemIn(workspaceId, documentId)?.role === 'edit' });
  }
  /*
   * The board's session, as the server keeps it: a vote whose counts come only when it ends, everyone else's from the script
   * (`board.votes`) and yours. With no board open, nothing changes.
   */
  private session(change: (b: CallState['board']) => CallState['board']): Promise<void> {
    this.change((s) => (s.board.open ? { ...s, board: change(s.board) } : s));
    return Promise.resolve();
  }
  startVote(frame: string | null, per: BoardVotesEach): Promise<void> {
    return this.session((b) => (b.vote ? b : { ...b, vote: { on: true, frame, per, left: per, mine: [], results: {}, voters: 0, canEnd: true, startedBy: this.me.id } }));
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
  setModel(model: string | null): Promise<void> {
    this.change((s) => ({ ...s, capture: { ...s.capture, model, modelPrivate: modelIsPrivate(model) } }));
    return Promise.resolve();
  }
  /** A share starts: it's kept for the notes when you asked for that, and notes aren't off. */
  startShare(o: { notes: boolean }): Promise<{ share: string; keep: boolean }> {
    const share = nextId('share');
    const keep = o.notes && this.getSnapshot().capture.mode !== 'off';
    this.change((s) => ({ ...s, shares: [...s.shares, { id: share, participant: this.me.id, keep }] }));
    return Promise.resolve({ share, keep });
  }
  /** Pieces of a kept share's video go nowhere: the stand-in keeps no recordings. */
  appendScreen(_piece: ScreenPiece): Promise<void> { return Promise.resolve(); }
  shareEnded(share: string): Promise<void> {
    this.change((s) => ({ ...s, shares: s.shares.filter((x) => x.id !== share) }));
    return Promise.resolve();
  }
  private attentionRooms = new Map<string, CallAttention>();
  private cue(kind: CallAttention['cues'][number]['kind']): void {
    this.change((s) => { const seq = s.attention.latest + 1; return { ...s, attention: { ...s.attention, latest: seq, cues: [...s.attention.cues, { id: nextId('cue'), seq, kind, at: new Date().toISOString() }].slice(-64) } }; });
  }
  /** A hand goes with its seat, as the API's does: someone back on a new connection keeps their place, under that connection. */
  private handFor(p: CallParticipant, up: boolean): void {
    this.change((s) => ({ ...s, participants: s.participants.map((x) => x.seat === p.seat ? { ...x, hand: up } : x), attention: { ...s.attention, hands: up ? s.attention.hands.some((h) => h.seat === p.seat) ? s.attention.hands.map((h) => (h.seat === p.seat ? { ...h, participantId: p.id } : h)) : [...s.attention.hands, { id: nextId('hand'), participantId: p.id, seat: p.seat, raisedAt: new Date().toISOString() }] : s.attention.hands.filter((h) => h.seat !== p.seat) } }));
    if (up) this.cue('hand');
  }
  /** The call's timer, as the API keeps it: only whoever hosts changes it, each change but a start against its revision. */
  controlTimer(input: CallTimerControl): Promise<void> {
    return Promise.resolve().then(() => {
      const parsed = CallTimerControlSchema.parse(input);
      const s = this.getSnapshot();
      if (!s.isHost) throw new AlcoveApiError('forbidden', 'Only the host can change the timer.');
      const timer = timerAfter(s.timer, parsed, Date.now());
      this.change((state) => ({ ...state, timer }));
    });
  }

  setHand(up: boolean): Promise<void> { this.handFor(this.me, up); return Promise.resolve(); }
  lowerHand(entryId: string): Promise<void> {
    const s = this.getSnapshot(); const h = s.attention.hands.find((h) => h.id === entryId);
    if (!h) return Promise.resolve();
    if (!s.isHost && h.seat !== this.me.seat) return Promise.reject(new AlcoveApiError('forbidden', 'Only the host can lower someone else’s hand.'));
    const p = s.participants.find((p) => p.seat === h.seat); if (p) this.handFor(p, false); return Promise.resolve();
  }
  /** As the server says it: an anonymous question names nobody, and only its asker is told it's theirs. */
  private questionFor(p: CallParticipant, text: string, votes = 0, id = nextId('question'), anonymous = false): void {
    if (this.getSnapshot().attention.questions.some((q) => q.id === id)) return;
    this.change((s) => ({ ...s, attention: { ...s.attention, questions: [...s.attention.questions, { id, author: anonymous ? null : p.person, text, createdAt: new Date().toISOString(), status: 'open', votes, voted: false, own: p.isMe, pinned: false }] } }));
    this.cue('question');
  }
  postQuestion(id: string, text: string, anonymous = false): Promise<void> { this.questionFor(this.me, text, 0, id, anonymous); return Promise.resolve(); }
  withdrawQuestion(id: string): Promise<void> {
    if (!this.getSnapshot().attention.questions.some((q) => q.id === id && q.own)) return Promise.reject(new AlcoveApiError('forbidden', 'Only whoever asked a question can take it back.'));
    this.change((s) => ({ ...s, attention: { ...s.attention, questions: s.attention.questions.filter((q) => q.id !== id) } })); return Promise.resolve();
  }
  voteQuestion(id: string, on: boolean): Promise<void> {
    this.change((s) => ({ ...s, attention: { ...s.attention, questions: s.attention.questions.map((q) => q.id === id && q.status === 'open' ? { ...q, voted: on, votes: q.votes + (q.voted === on ? 0 : on ? 1 : -1) } : q) } })); return Promise.resolve();
  }
  resolveQuestion(id: string, status: CallQuestionStatus): Promise<void> {
    if (!this.getSnapshot().isHost) return Promise.reject(new AlcoveApiError('forbidden', 'Only the host can resolve questions.'));
    this.change((s) => ({ ...s, attention: { ...s.attention, questions: s.attention.questions.map((q) => q.id === id ? { ...q, status, pinned: false } : q) } })); return Promise.resolve();
  }
  pinQuestion(id: string | null): Promise<void> {
    if (!this.getSnapshot().isHost) return Promise.reject(new AlcoveApiError('forbidden', 'Only the host can pin questions.'));
    this.change((s) => ({ ...s, attention: { ...s.attention, questions: s.attention.questions.map((q) => ({ ...q, pinned: q.id === id && q.status === 'open' })) } })); return Promise.resolve();
  }
  /** Who sent each nudge note you got (by seat), and when its minute began: the same nudge again from them changes nothing. */
  private nudgeNotes = new Map<string, { first: number; from: string[] }>();
  /** Someone in the script nudges you: a note of its own, or one more on the same nudge's note within its minute. */
  private nudgeFrom(p: CallParticipant, kind: CallNudgeKind): void {
    const now = Date.now();
    const open = this.getSnapshot().attention.nudges.find((n) => n.kind === kind && (this.nudgeNotes.get(n.id)?.first ?? 0) > now - NUDGE_WINDOW);
    const kept = open ? this.nudgeNotes.get(open.id) : undefined;
    if (open && kept) {
      if (kept.from.includes(p.seat)) return;
      kept.from.push(p.seat);
      this.change((s) => ({ ...s, attention: { ...s.attention, nudges: s.attention.nudges.map((n) => (n.id === open.id ? { ...n, count: kept.from.length, from: null, at: new Date(now).toISOString() } : n)) } }));
      return;
    }
    const id = nextId('nudge');
    this.nudgeNotes.set(id, { first: now, from: [p.seat] });
    this.change((s) => ({ ...s, attention: { ...s.attention, nudges: [...s.attention.nudges, { id, kind, count: 1, from: p.person, at: new Date(now).toISOString() }] } }));
  }
  /** Your nudge goes to someone in your room, and nobody else in the script hears of it. */
  nudge(to: string, _kind: CallNudgeKind): Promise<void> {
    if (to === this.me.id || !this.getSnapshot().participants.some((p) => p.id === to) || !this.crypto.getSnapshot().members.includes(to)) {
      return Promise.reject(new AlcoveApiError('conflict', 'They aren’t in this room any more.'));
    }
    return Promise.resolve();
  }
  /** Someone's status, as the server keeps it: a new time from now, or the time already set, or none. */
  private statusFor(p: CallParticipant, kind: CallStatusKind | null, minutes?: CallStatusMinutes | undefined): void {
    const now = Date.now();
    this.change((s) => ({
      ...s, participants: s.participants.map((x) => {
        if (x.seat !== p.seat) return x;
        if (!kind) return { ...x, status: null };
        const was = x.status && !ranOut(x.status) ? x.status : null;
        const time = minutes !== undefined ? { since: new Date(now).toISOString(), until: new Date(now + minutes * 60_000).toISOString() } : was ? { since: was.since, until: was.until } : { since: new Date(now).toISOString(), until: null };
        return { ...x, status: { kind, ...time } };
      })
    }));
  }
  setStatus(status: CallStatusKind | null, minutes?: CallStatusMinutes | undefined): Promise<void> { this.statusFor(this.me, status, minutes); return Promise.resolve(); }
  letOthersPoint(on: boolean): Promise<void> { this.change((s) => ({ ...s, participants: s.participants.map((p) => (p.isMe ? { ...p, othersPoint: on } : p)) })); return Promise.resolve(); }
  setPointing(on: boolean): Promise<void> { this.change((s) => ({ ...s, pointing: on })); return Promise.resolve(); }
  setSpotlight(participantId: string | null): void { this.change((s) => ({ ...s, spotlight: participantId })); }
  translate(lineIds: string[], _language: CaptionLanguage): Promise<CaptionTranslation[]> {
    const lines = this.getSnapshot().transcript;
    return Promise.resolve(lineIds.flatMap((id) => { const l = lines.find((x) => x.id === id); return l ? [{ id, text: l.text }] : []; }));
  }
  /**
   * Hear it, as the call plays it: a line in your own transcript, which is only what you were there for, as a few quiet
   * seconds of the recording around it, after a moment's fetching. Anything else isn't there, as the API says it, and so is
   * whatever the script says Hear it gets (`CallScript.hear`).
   */
  hear(note: string, line: string): Promise<LineAudio> {
    const s = this.getSnapshot();
    const l = s.transcript.find((x) => x.id === line);
    const missing = () => new AlcoveApiError('not-found', 'That moment of the call doesn’t exist, or you don’t have access to it.');
    if (s.notes.noteId !== note || !l || l.room || !s.notes.keepsRecording) return Promise.reject(missing());
    const answer = this.script.hear ?? 'plays';
    if (answer === 'waits') return new Promise<LineAudio>(() => undefined);
    return new Promise<LineAudio>((resolve, reject) => this.after(HEAR_MS, () => {
      if (answer === 'not-found') { reject(missing()); return; }
      // The recording has the line the second time it's asked for: its piece has gone up by then.
      if (answer === 'not-yet' && !this.asked.has(line)) { this.asked.add(line); reject(new AlcoveApiError('conflict', 'The recording doesn’t have this line yet. Try again in a few seconds.')); return; }
      resolve({ audio: answer === 'unplayable' ? new Blob([new Uint8Array(64)], { type: 'audio/webm' }) : quietAudio(5), from: 1, seconds: 3 });
    }));
  }
  appendAudio(_piece: AudioPiece): Promise<void> { return Promise.resolve(); }
  transcribe(_clip: TranscriptClip, _speaker: string): Promise<void> { return Promise.resolve(); }
  watchNotes(): () => void {
    this.watching += 1;
    this.writeNotesSoon();
    let stopped = false;
    return () => { if (!stopped) { stopped = true; this.watching -= 1; } };
  }
  private followUpTarget(row: LiveFollowUp): FollowUpTarget {
    return { id: row.id, revision: row.revision, text: row.text, owner: row.ownerPerson?.email ?? null, due: row.due ?? null };
  }
  private refreshFollowUps(): void {
    const notes = this.notesNow();
    this.change((s) => ({ ...s, liveNotes: { ...s.liveNotes, notes, suggestions: this.suggestionsNow() } }));
  }
  private followUpOwner(email: string | null): Person | null {
    if (email === null) return null;
    const owner = [this.meeting.organizer, ...this.meeting.guests, ...this.getSnapshot().participants.map((p) => p.person)].find((p) => p.email.toLowerCase() === email.toLowerCase());
    if (!owner) throw new AlcoveApiError('invalid', 'Choose someone invited to the call.');
    return owner;
  }
  tickFollowUp(id: string, done: boolean): Promise<void> {
    const row = this.inferred.get(id);
    if (row?.review === 'accepted') this.inferred.set(id, { ...row, done, revision: nextId('revision') });
    this.change((s) => ({ ...s, liveNotes: { ...s.liveNotes, added: s.liveNotes.added.map((a) => a.id === id ? { ...a, done, revision: nextId('revision') } : a) } }));
    this.refreshFollowUps();
    return Promise.resolve();
  }
  /** Manual tasks are actual immediately; choosing an owner never claims their agreement. */
  addFollowUp(input: FollowUpCreate): Promise<void> {
    const s = this.getSnapshot();
    if (!s.notes.everOn || s.role === 'guest') return Promise.reject(new AlcoveApiError('forbidden', 'Only someone invited can add follow-ups.'));
    const words = input.text.replace(/\s+/g, ' ').trim();
    if (!words || s.liveNotes.added.some((a) => a.text === words)) return Promise.resolve();
    try {
      const ownerPerson = this.followUpOwner(input.owner);
      const at = Math.max(0, Math.round((Date.now() - Date.parse(s.startedAt)) / 1000));
      this.change((now) => ({ ...now, liveNotes: { ...now.liveNotes, added: [...now.liveNotes.added, {
        ...ACCEPTED_FOLLOW_UP, revision: nextId('revision'), id: nextId('added'), text: words, ownerPerson, ...(ownerPerson ? { owner: ownerPerson.name } : {}), ...(input.due ? { due: input.due } : {}), evidence: [], done: false, at
      }] } }));
      return Promise.resolve();
    } catch (e) { return Promise.reject(e); }
  }
  updateFollowUp(id: string, patch: FollowUpPatch): Promise<void> {
    const s = this.getSnapshot();
    const row = this.inferred.get(id) ?? s.liveNotes.added.find((a) => a.id === id);
    if (s.role === 'guest') return Promise.reject(new AlcoveApiError('forbidden', 'Only someone invited can edit follow-ups.'));
    if (!row || row.review !== 'accepted' || JSON.stringify(this.followUpTarget(row)) !== JSON.stringify({ id, ...patch.seen })) return Promise.reject(new AlcoveApiError('conflict', 'That follow-up changed. Open it again.'));
    try {
      const ownerPerson = patch.owner === undefined ? row.ownerPerson : this.followUpOwner(patch.owner);
      const { owner: _owner, due: _due, ...rest } = row;
      const due = patch.due === undefined ? row.due : patch.due;
      const next: LiveFollowUp = { ...rest, revision: nextId('revision'), text: patch.text ?? row.text, ownerPerson, ...(ownerPerson ? { owner: ownerPerson.name } : {}), ...(due ? { due } : {}) };
      if (this.inferred.has(id)) this.inferred.set(id, next);
      this.change((now) => ({ ...now, liveNotes: { ...now.liveNotes, added: now.liveNotes.added.map((a) => a.id === id ? { ...next, at: a.at } : a) } }));
      this.refreshFollowUps();
      return Promise.resolve();
    } catch (e) { return Promise.reject(e); }
  }
  reviewFollowUp(review: FollowUpReview): Promise<void> {
    if (this.getSnapshot().role === 'guest') return Promise.reject(new AlcoveApiError('forbidden', 'Only someone invited can review follow-ups.'));
    const previous = this.reviewed.get(review.id);
    if (previous?.revision === review.revision && previous.decision === review.decision) return Promise.resolve();
    const proposal = this.inferred.get(review.id);
    if (previous || !proposal || proposal.review !== 'suggested' || proposal.revision !== review.revision) return Promise.reject(new AlcoveApiError('conflict', 'That suggestion changed or has already been reviewed.'));
    const target = proposal.target;
    const actual = target ? this.inferred.get(target.id) ?? this.getSnapshot().liveNotes.added.find((a) => a.id === target.id) : undefined;
    if (target && (!actual || JSON.stringify(this.followUpTarget(actual)) !== JSON.stringify(target))) return Promise.reject(new AlcoveApiError('conflict', 'That follow-up changed. Close review and open it again.'));
    this.reviewed.set(review.id, review);
    const reviewed = { by: changer(this.me.person, this.me.isOrganizer ? 'organizer' : 'invited'), at: new Date().toISOString(), decision: review.decision };
    if (review.decision === 'dismiss') this.inferred.set(proposal.id, { ...proposal, review: 'dismissed', reviewed });
    else if (target) {
      const accepted: LiveFollowUp = { ...proposal, ...ACCEPTED_FOLLOW_UP, id: target.id, reviewed, done: actual?.done ?? false, revision: nextId('revision') };
      this.inferred.set(proposal.id, { ...proposal, review: 'accepted', reviewed });
      if (this.inferred.has(target.id)) this.inferred.set(target.id, accepted);
      this.change((s) => ({ ...s, liveNotes: { ...s.liveNotes, added: s.liveNotes.added.map((a) => a.id === target.id ? { ...accepted, at: a.at } : a) } }));
    } else this.inferred.set(proposal.id, { ...proposal, review: 'accepted', reviewed, revision: nextId('revision') });
    this.refreshFollowUps();
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
  /**
   * The organizer stops what someone shares, for everyone: LiveKit mutes it. Everyone else is told who stopped it, and you, who
   * did, have your own words for it.
   */
  stopShare(seat: string): Promise<void> {
    if (!this.getSnapshot().isOrganizer) return Promise.reject(new AlcoveApiError('forbidden', 'Only the organizer can do that.'));
    const p = this.getSnapshot().participants.find((x) => x.seat === seat);
    const nothing = new AlcoveApiError('conflict', 'They aren’t sharing anything.');
    if (p?.isMe) {
      if (!sessions.media?.getSnapshot().screen) return Promise.reject(nothing);
      this.livekit.update((r) => ({ ...r, sharesStopped: r.sharesStopped + 1 }));
      return Promise.resolve();
    }
    const them = p ? this.livekit.getSnapshot().people[p.id] : undefined;
    if (!p || !them?.screen) return Promise.reject(nothing);
    this.livekit.update((r) => ({ ...r, people: { ...r.people, [p.id]: { ...them, screen: null, sound: false } } }));
    return Promise.resolve();
  }
  /** The organizer, when it isn't you, stops what someone shares, yours or anyone's: it stops for everyone, and you're told who stopped it. */
  private theyStopShare(who: Person | 'me'): void {
    const s = this.getSnapshot();
    const organizer = firstOf(s.participants.find((p) => p.isOrganizer)?.person ?? this.meeting.organizer);
    const whose = who === 'me' ? this.me : this.find(who);
    if (!whose) return;
    if (who === 'me') this.livekit.update((r) => ({ ...r, sharesStopped: r.sharesStopped + 1 }));
    else this.them(who, (t) => ({ ...t, screen: null, sound: false }));
    if (!s.isOrganizer) this.change((x) => ({ ...x, notices: [...x.notices, { id: nextId('notice'), text: `${organizer} stopped ${firstOf(whose.person)}’s share.`, kind: 'people' }] }));
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

  /** Whoever hosts ends the call for everyone and its note starts being written; anyone else just leaves, and it goes on. */
  leave(): Promise<CallEndResult | null> {
    const s = this.getSnapshot();
    if (s.isHost) this.push({ ...s, phase: 'ended' });
    this.close();
    if (!s.isHost) { this.goesOn(null); return Promise.resolve(null); }
    const noteId = this.endsWith(s);
    return Promise.resolve({ meetingId: this.meeting.id, pendingNoteId: noteId, duration: s.elapsed });
  }
  /** Whoever hosts leaves it to someone invited, who hosts until the organizer is back, and it goes on. */
  handOff(to: string): Promise<void> {
    const person = this.getSnapshot().participants.find((p) => p.id === to)?.person ?? null;
    linkState(this.meeting.code, (l) => ({ hostHere: true, locked: false, capture: null, ended: false, ...l, standIn: person }));
    this.close();
    this.goesOn(person);
    return Promise.resolve();
  }
  close(): void {
    this.notifications.close();
    this.direct.close();
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

/**
 * A call you left that goes on without you, as the server keeps it: the same call and note, how long it's been going, who's still
 * in it, what was said while you were there, how it's captured, whoever you left hosting, and the pass you left with.
 */
export interface GoingOn {
  callId: string;
  noteId: string;
  startedAt: string;
  /** When you first came in: the script's times count from then. */
  began: number;
  here: Present[];
  heard: { line: Line; id: string; at: number }[];
  transcript: TranscriptLine[];
  capture: CallState['capture'];
  notes: CallState['notes'];
  standIn: Person | null;
  pass: string;
}
/** The calls you've left that go on, by their link, and the timer for the end their script still has: kept with the world. */
const goingOn = new WeakMap<World, Map<string, { call: GoingOn; ends: ReturnType<typeof setTimeout> | null }>>();
function goingOnIn(w: World): Map<string, { call: GoingOn; ends: ReturnType<typeof setTimeout> | null }> {
  const known = goingOn.get(w);
  if (known) return known;
  const fresh = new Map<string, { call: GoingOn; ends: ReturnType<typeof setTimeout> | null }>();
  goingOn.set(w, fresh);
  return fresh;
}
/** Whatever the last story left going stops: no call it left ends in the next story's world. */
export function forgetGoingOn(): void {
  const here = goingOnIn(current());
  for (const { ends } of here.values()) if (ends) clearTimeout(ends);
  here.clear();
}

/**
 * The CallSession the stand-in's `calls.join` hands back: you, as the world and the call's invite have you. A call you left
 * that's still going is picked up where it's got to, and the pass you left with (`previous`) lets you straight back in.
 */
export function joinCall(m: Meeting, opts: { name?: string | undefined; previous?: string | undefined }): ScriptedCall {
  const w = current();
  const signedIn = w.session !== null;
  const organizes = signedIn && m.organizer.email === you().email;
  const invited = organizes || (signedIn && m.guests.some((g) => g.email === you().email));
  const kept = goingOnIn(w).get(m.code);
  if (kept?.ends) clearTimeout(kept.ends);
  goingOnIn(w).delete(m.code);
  const back = kept?.call ?? null;
  const known = back !== null && opts.previous === back.pass;
  return new ScriptedCall(m, { role: organizes ? 'host' : invited ? 'invited' : 'guest', asking: !invited && !known, ...(signedIn ? {} : { name: opts.name?.trim() || 'Guest' }) }, back);
}
