/*
 * A call, played out. LiveKit can't run in Storybook, so the call is a script: you're in it with the notes as the call
 * was set, the people invited come in one at a time, and while notes are on what they say arrives in the live transcript
 * a line every few seconds, until the live notes are written. Its media (who's speaking, mics and cameras) is the scripted
 * room in src/media/livekit.ts. Every control does what it would, to the snapshot; leaving ends the call and leaves its note
 * being written. A story that needs a different call (someone asking to join, rooms open) sets it up from here.
 */
import {
  type BreakoutPlan, type CallAnswer, type CallCrypto, type CallEndResult, type CallMoment, type CallMoveOut, type CallParticipant, type CallSession, type CallState,
  type CallTicket, type CaptionLanguage, type CaptionTranslation, type CaptureDevicePart, type CaptureMode, type CapturePart, type CaptureState, type CatchUp,
  type CatchUpRange, type CatchUpWindow, type AudioPiece, type Meeting, type MoveMedia, type MoveOutState, type PersonalApi, type ScreenFrame, type ScreenFrameReceipt,
  type SeriesAnswerPart, type TranscriptClip, type TranscriptLine
} from '@alcove/api';
import type { BoardCheck, BoardOpen, CallFollowUps, CallWorkspaceSwitch, DocFollowUpTick, DocumentRole, PresentKind } from '@alcove/api';
import { writeNote } from '../world/build';
import { Pushed, Snapshots } from './live';
import { personalFor } from './personal';
import { current, me as you, nextId } from './state';

/** A connection's identity in a call: `p_` and 22 characters, as LiveKit's are. */
const identity = (seed: string) => `p_${seed.replace(/[^A-Za-z0-9]/g, '').padEnd(22, 'x').slice(0, 22)}`;

/** What the people in the call say, in order, while notes are on: a line every few seconds. */
const SAID: readonly [string, string][] = [
  ['guest', 'Can everyone see the board? I’ve put the three options side by side.'],
  ['me', 'Yes. Let’s start with the empty states, since they block the launch.'],
  ['guest', 'The team page needs one before the flag goes on. I’d keep it to one line.'],
  ['other', 'Agreed. And the arch, not a picture of a person.'],
  ['me', 'Then let’s decide it: one line and the empty arch, for every list.'],
  ['guest', 'I’ll send the copy for each of them by Friday.']
];
const LINE_MS = 5000;

const part = (mode: CaptureMode, since: string | null, organizer: string): CapturePart => ({ mode, since, by: since ? { kind: mode === 'on' ? 'schedule' : 'organizer', name: organizer } : null });
function captureOf(on: boolean, since: string | null, organizer: string): CaptureState {
  const mode: CaptureMode = on ? 'on' : 'off';
  return {
    mode, recording: part(mode, since, organizer), transcript: part(mode, since, organizer), ai: part(on ? 'on' : 'off', since, organizer), screen: part('off', null, organizer),
    gaps: [], requests: [], asked: null, room: null, away: false
  };
}

class Crypto extends Pushed<CallCrypto> {}

export class ScriptedCall extends Snapshots<CallState> implements CallSession {
  readonly ticket: CallTicket;
  readonly crypto: Crypto;
  readonly personal: PersonalApi;
  private said = 0;
  private readonly me: CallParticipant;

  constructor(private readonly meeting: Meeting) {
    const callId = nextId('call');
    const noteId = nextId('note');
    const isOrganizer = meeting.organizer.email === you().email;
    const me: CallParticipant = { id: identity(`me${callId}`), seat: 'seat-me', person: you(), isMe: true, isOrganizer, hand: false, othersPoint: true };
    const startedAt = new Date().toISOString();
    const on = meeting.notes === 'on';
    super({
      callId, meetingId: meeting.id, code: meeting.code, title: meeting.title, startedAt, elapsed: 0, phase: 'in-call', participants: [me], locked: false, pointing: true,
      spotlight: null, breakouts: { open: null, held: [] }, capture: captureOf(on, on ? startedAt : null, meeting.organizer.name),
      notes: { everOn: on, noteId: on ? noteId : null, recording: { segment: 0, pieces: 0, seconds: 0 } }, waiting: [], ringing: [], leaving: [],
      host: { id: isOrganizer ? me.id : null, standIn: false, organizer: meeting.organizer, next: [] }, generation: 1, transcript: [],
      liveNotes: { notes: null, writing: false, error: null }, notices: on ? [{ id: nextId('notice'), text: 'Notes are on for this call.', kind: 'notes' }] : [],
      isOrganizer, isHost: isOrganizer, role: isOrganizer ? 'host' : 'invited',
      workspace: { id: null, name: null, chosenBy: meeting.organizer, canOpen: false, role: null, documents: [], agenda: null, present: null, play: null, asks: [], asked: 'no' },
      board: { open: null }
    });
    this.me = me;
    this.ticket = { callId, serverUrl: 'wss://livekit.storybook.invalid', roomName: `room-${callId}`, identity: me.id, role: isOrganizer ? 'host' : 'invited', pass: `${callId}.storybook` };
    this.crypto = new Crypto({ status: 'in', place: 'main', members: [me.id], everyone: [me.id], media: null, chat: [], missedChat: false });
    this.personal = personalFor(noteId);
    // Everyone invited comes in, one at a time.
    meeting.guests.forEach((person, i) => this.after(1500 + i * 1800, () => {
      const p: CallParticipant = { id: identity(`${person.email}${callId}`), seat: `seat-${i + 1}`, person, isMe: false, isOrganizer: false, hand: false, othersPoint: true };
      this.change((s) => ({ ...s, participants: [...s.participants, p] }));
      this.crypto.update((c) => ({ ...c, members: [...c.members, p.id], everyone: [...c.everyone, p.id] }));
    }));
    this.every(1000, () => this.change((s) => ({ ...s, elapsed: s.elapsed + 1, notes: { ...s.notes, recording: s.capture.mode === 'on' ? { ...s.notes.recording, seconds: s.notes.recording.seconds + 1 } : s.notes.recording } })));
    this.every(LINE_MS, () => this.hear());
  }

  /** The next line of the script, from whoever says it, while notes are on and they're in the call. */
  private hear(): void {
    const s = this.getSnapshot();
    const next = SAID[this.said];
    if (!next || s.capture.mode !== 'on') return;
    const others = s.participants.filter((p) => !p.isMe);
    const who = next[0] === 'me' ? this.me : next[0] === 'guest' ? others[0] : others[1] ?? others[0];
    if (!who) return;
    this.said += 1;
    const line: TranscriptLine = { id: nextId('line'), at: s.elapsed, speaker: { name: who.person.name, person: who.person }, text: next[1] };
    this.push({ ...s, transcript: [...s.transcript, line] });
  }

  private capture(mode: CaptureMode): void {
    const at = new Date().toISOString();
    this.change((s) => ({
      ...s,
      capture: { ...s.capture, mode, recording: part(mode, at, s.host.organizer.name), transcript: part(mode, at, s.host.organizer.name), ai: part(mode === 'off' && !s.notes.everOn ? 'off' : mode, at, s.host.organizer.name), requests: [] },
      notes: { ...s.notes, everOn: s.notes.everOn || mode === 'on', noteId: s.notes.noteId ?? nextId('note') }
    }));
  }

  room(): Promise<{ serverUrl: string; roomName: string; identity: string; token: string }> {
    return Promise.resolve({ serverUrl: this.ticket.serverUrl, roomName: this.ticket.roomName, identity: this.ticket.identity, token: 'storybook' });
  }
  refresh(): Promise<void> { return Promise.resolve(); }
  sendChat(text: string): Promise<void> {
    this.crypto.update((c) => ({ ...c, chat: [...c.chat, { id: nextId('chat'), from: this.me.id, isMe: true, text, at: Date.now(), place: 'main' }] }));
    return Promise.resolve();
  }
  /** Data between browsers goes nowhere here: nobody else's browser is in the call. */
  sealData(_topic: string, payload: Uint8Array): Promise<Uint8Array<ArrayBuffer> | null> { return Promise.resolve(new Uint8Array(payload)); }
  openData(_topic: string, _from: string, sealed: Uint8Array): Promise<Uint8Array | null> { return Promise.resolve(sealed); }
  /* The call's workspace and boards: Storybook shows the call without them, so each answers and changes nothing. */
  readonly followUps = new Pushed<CallFollowUps | null>(null);
  watchFollowUps(): () => void { return () => undefined; }
  openWorkspace(): Promise<void> { return Promise.resolve(); }
  previewWorkspace(_workspaceId: string): Promise<CallWorkspaceSwitch> { return Promise.resolve({ name: '', cantOpen: [] }); }
  setWorkspace(_workspaceId: string): Promise<void> { return Promise.resolve(); }
  newWorkspace(_name?: string | undefined): Promise<void> { return Promise.resolve(); }
  bringDocument(_documentId: string, _brought: boolean): Promise<void> { return Promise.resolve(); }
  askForWorkspace(up: boolean): Promise<void> { this.change((s) => ({ ...s, workspace: { ...s.workspace, asked: up ? 'asking' : 'no' } })); return Promise.resolve(); }
  grantWorkspaceAsk(_askId: string, _documentId: string, _role: DocumentRole): Promise<void> { return Promise.resolve(); }
  declineWorkspaceAsk(_askId: string): Promise<void> { return Promise.resolve(); }
  startPresenting(_kind: PresentKind, _id: string, _section?: number | undefined): Promise<void> { return Promise.resolve(); }
  movePresenting(_section: number): Promise<void> { return Promise.resolve(); }
  stopPresenting(): Promise<void> { return Promise.resolve(); }
  startPlaying(_documentId: string, _mediaId: string, _positionMs?: number | undefined): Promise<void> { return Promise.resolve(); }
  pausePlaying(_positionMs: number): Promise<void> { return Promise.resolve(); }
  resumePlaying(): Promise<void> { return Promise.resolve(); }
  seekPlaying(_positionMs: number): Promise<void> { return Promise.resolve(); }
  stopPlaying(): Promise<void> { return Promise.resolve(); }
  openBoard(_from: BoardOpen): Promise<void> { return Promise.resolve(); }
  closeBoard(): Promise<void> { return Promise.resolve(); }
  boardCheck(_documentId: string): Promise<BoardCheck> { return Promise.resolve({ cannot: [], mayLetIn: true }); }
  tickDocumentFollowUp(_tick: DocFollowUpTick): Promise<void> { return Promise.resolve(); }
  admit(id: string): Promise<void> { this.change((s) => ({ ...s, waiting: s.waiting.filter((w) => w.id !== id) })); return Promise.resolve(); }
  deny(id: string): Promise<void> { return this.admit(id); }
  ring(_emails: string[]): Promise<void> { return Promise.resolve(); }
  setNotes(on: boolean): Promise<void> { this.capture(on ? 'on' : 'off'); return Promise.resolve(); }
  pause(): Promise<void> { this.capture('paused'); return Promise.resolve(); }
  resume(): Promise<void> { this.capture('on'); return Promise.resolve(); }
  requestNotes(up: boolean): Promise<void> {
    this.change((s) => ({ ...s, capture: { ...s.capture, asked: up ? { state: 'asking', at: new Date().toISOString() } : null } }));
    return Promise.resolve();
  }
  declineNotes(requestId: string): Promise<void> {
    this.change((s) => ({ ...s, capture: { ...s.capture, requests: s.capture.requests.filter((r) => r.id !== requestId) } }));
    return Promise.resolve();
  }
  setUnavailable(_parts: CaptureDevicePart[]): Promise<void> { return Promise.resolve(); }
  setScreens(on: boolean): Promise<void> {
    this.change((s) => ({ ...s, capture: { ...s.capture, screen: part(on ? 'on' : 'off', new Date().toISOString(), s.host.organizer.name) } }));
    return Promise.resolve();
  }
  shareFrame(_frame: ScreenFrame): Promise<ScreenFrameReceipt> { return Promise.resolve({ id: nextId('frame'), duplicate: false }); }
  shareEnded(_share: string): Promise<void> { return Promise.resolve(); }
  setHand(up: boolean): void { this.change((s) => ({ ...s, participants: s.participants.map((p) => (p.isMe ? { ...p, hand: up } : p)) })); }
  letOthersPoint(on: boolean): Promise<void> { this.change((s) => ({ ...s, participants: s.participants.map((p) => (p.isMe ? { ...p, othersPoint: on } : p)) })); return Promise.resolve(); }
  setPointing(on: boolean): Promise<void> { this.change((s) => ({ ...s, pointing: on })); return Promise.resolve(); }
  setSpotlight(participantId: string | null): void { this.change((s) => ({ ...s, spotlight: participantId })); }
  openRooms(_plan: BreakoutPlan): void { /* Breakout rooms aren't scripted yet: the call stays in the main room. */ }
  closeRooms(): void { this.change((s) => ({ ...s, breakouts: { ...s.breakouts, open: null } })); }
  messageRooms(_text: string): void { /* No rooms are open in the script. */ }
  visitRoom(_roomId: string | null): void { /* No rooms are open in the script. */ }
  renameRoom(_roomId: string, _name: string): void { /* No rooms are open in the script. */ }
  moveToRoom(_email: string, _roomId: string | null): void { /* No rooms are open in the script. */ }
  pauseRoom(_roomId: string, _paused: boolean): Promise<void> { return Promise.resolve(); }
  translate(lineIds: string[], _language: CaptionLanguage): Promise<CaptionTranslation[]> {
    const lines = this.getSnapshot().transcript;
    return Promise.resolve(lineIds.flatMap((id) => { const l = lines.find((x) => x.id === id); return l ? [{ id, text: l.text }] : []; }));
  }
  appendAudio(_piece: AudioPiece): Promise<void> { return Promise.resolve(); }
  transcribe(_clip: TranscriptClip, _speaker: string): Promise<void> { return Promise.resolve(); }
  watchNotes(): () => void {
    this.after(12_000, () => this.change((s) => ({ ...s, liveNotes: { notes: this.catchUpNow(), writing: false, error: null } })));
    return () => undefined;
  }
  tickFollowUp(id: string, done: boolean): Promise<void> {
    this.change((s) => (s.liveNotes.notes ? { ...s, liveNotes: { ...s.liveNotes, notes: { ...s.liveNotes.notes, next: s.liveNotes.notes.next.map((n) => (n.id === id ? { ...n, done } : n)) } } } : s));
    return Promise.resolve();
  }

  /** Where the call has got to, from what's been said so far. */
  private catchUpNow(): NonNullable<CallState['liveNotes']['notes']> {
    const s = this.getSnapshot();
    const evidence = (i: number) => { const l = s.transcript[i]; return l ? [{ kind: 'transcript' as const, lineId: l.id, said: l.at }] : []; };
    return {
      summary: s.transcript.length ? 'The empty states block the launch, so every list gets one line and the empty arch.' : '',
      decided: s.transcript.length > 4 ? [{ text: 'Every list gets one line and the empty arch when it’s empty.', evidence: evidence(4) }] : [],
      proposed: [], open: [],
      next: s.transcript.length > 5 ? [{ id: 'fu-copy', text: 'Send the copy for each empty state', owner: s.participants[1]?.person.name, due: 'Friday', evidence: evidence(5), done: false }] : [],
      read: { from: 0, to: s.elapsed, lines: s.transcript.length, through: s.transcript.at(-1)?.at ?? null, gaps: [], missed: [], whileHere: false, skipped: null, asOf: s.elapsed }
    };
  }
  catchUp(_range: CatchUpRange): Promise<CatchUp> {
    const n = this.catchUpNow();
    return Promise.resolve({ ...n, next: n.next.map(({ text, owner, due, evidence }) => ({ text, ...(owner ? { owner } : {}), ...(due ? { due } : {}), evidence })) });
  }
  askSoFar(_question: string, _range: CatchUpRange): Promise<CallAnswer> {
    const n = this.catchUpNow();
    return Promise.resolve({ text: n.summary || 'Nothing’s been said yet while notes were on.', evidence: [], read: n.read });
  }
  catchUpWindow(): Promise<CatchUpWindow> {
    const s = this.getSnapshot();
    return Promise.resolve({ now: s.elapsed, joined: 0, away: null, here: null, gaps: [] });
  }
  moment(lineId: string): Promise<CallMoment> {
    return Promise.resolve({ lineId, lines: this.getSnapshot().transcript.filter((l) => l.id === lineId).map((l) => ({ ...l, said: l.at })) });
  }
  askEarlier(_question: string, _timeZone: string): Promise<SeriesAnswerPart[]> { return Promise.resolve([{ type: 'text', text: 'There’s nothing from earlier calls in this series yet.' }]); }
  mute(_identity: string, _trackSid: string): Promise<void> { return Promise.resolve(); }
  remove(id: string): Promise<void> { this.change((s) => ({ ...s, participants: s.participants.filter((p) => p.id !== id) })); return Promise.resolve(); }
  lock(on: boolean): Promise<void> { this.change((s) => ({ ...s, locked: on })); return Promise.resolve(); }
  stopRing(ringId: string): Promise<void> { this.change((s) => ({ ...s, ringing: s.ringing.filter((r) => r.id !== ringId) })); return Promise.resolve(); }
  dismissNotice(id: string): void { this.change((s) => ({ ...s, notices: s.notices.filter((n) => n.id !== id) })); }
  startMove(_media: MoveMedia): Promise<CallMoveOut> { return Promise.resolve(new MoveOut()); }

  leave(): Promise<CallEndResult | null> {
    const s = this.getSnapshot();
    this.push({ ...s, phase: 'ended' });
    this.halt();
    this.crypto.close();
    if (!s.isHost) return Promise.resolve(null);
    const w = current();
    const noteId = s.notes.everOn ? s.notes.noteId : null;
    w.meetings = w.meetings.map((m) => (m.id === this.meeting.id ? { ...m, status: 'ended', duration: s.elapsed, ...(noteId ? { noteId } : {}) } : m));
    if (noteId) {
      const spec = {
        id: noteId, title: s.title, startedAt: s.startedAt, minutes: Math.max(1, Math.round(s.elapsed / 60)), organizer: this.meeting.organizer, invited: this.meeting.guests,
        excerpt: 'Every list gets one line and the empty arch when it’s empty.', meetingId: this.meeting.id,
        said: s.transcript.map((l) => ({ at: `${Math.floor(l.at / 60)}:${String(Math.floor(l.at % 60)).padStart(2, '0')}`, who: l.speaker?.person, text: l.text }))
      };
      w.notes.unshift(writeNote({ ...spec, status: 'pending' }));
      w.writing = { id: noteId, seconds: 8, written: () => writeNote(spec) };
    }
    return Promise.resolve({ meetingId: this.meeting.id, pendingNoteId: noteId, duration: s.elapsed });
  }
  handOff(_to: string): Promise<void> { return this.leave().then(() => undefined); }
  close(): void { this.halt(); this.crypto.close(); }
  closing(): void { this.close(); }
}

/** Moving to another device: the code waits to be opened on the other one, which never happens here. */
class MoveOut extends Pushed<MoveOutState> implements CallMoveOut {
  constructor() {
    super({ stage: 'open', code: 'StorybookMoveCode00000', expiresAt: Date.now() + 120_000, device: null, sameAccount: true, problem: null });
  }
  confirm(_media: MoveMedia): Promise<void> { this.update((s) => ({ ...s, stage: 'moved' })); return Promise.resolve(); }
  cancel(): Promise<void> { this.update((s) => ({ ...s, stage: 'cancelled' })); return Promise.resolve(); }
  renew(): Promise<void> { this.update((s) => ({ ...s, stage: 'open', expiresAt: Date.now() + 120_000 })); return Promise.resolve(); }
}
