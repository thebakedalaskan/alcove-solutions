/*
 * A call, played from its script (script.ts). LiveKit can't run in Storybook, so this is the server's side of the
 * script: who's in the call, what it captures, the transcript and the live notes, who's asking to join and who's being
 * rung, breakout rooms, and who hosts. LiveKit's side (everyone else's microphones, who's speaking, what they share and
 * your own connection) is `livekit`, which the scripted room (src/media/livekit.ts) plays to the call screen. Every control
 * does to the snapshot what the server would; leaving ends the call for whoever hosts and leaves its note being written.
 */
import {
  RING_SECONDS, notesAreOn, type BreakoutPlan, type CallAnswer, type CallCrypto, type CallEndResult, type CallMoment, type CallMoveOut, type CallParticipant, type CallRole,
  type CallSession, type CallState, type CallTicket, type CaptionLanguage, type CaptionTranslation, type CaptureDevicePart, type CaptureGap, type CaptureMode, type CapturePart,
  type CatchUp, type CatchUpRange, type CatchUpWindow, type AudioPiece, type Meeting, type MoveMedia, type MoveOutState, type Person, type PersonalApi,
  type RingReply, type RoomCapture, type ScreenFrame, type ScreenFrameReceipt, type SeriesAnswerPart, type TranscriptClip, type TranscriptLine
} from '@alcove/api';
import type { BoardCheck, BoardOpen, CallFollowUps, CallWorkspaceSwitch, DocFollowUpTick, DocumentRole, PresentKind } from '@alcove/api';
import { sessions } from '~/lib/live';
import { talking } from '../browser';
import type { Screen } from '../media/screens';
import { writeNote } from '../world/build';
import { personAt } from '../world/people';
import { Pushed, Snapshots } from './live';
import { personalFor } from './personal';
import { captureOf, defaultScript, linkState, part, scriptFor, type Beat, type CallScript, type Line, type Present, type RoomPlan } from './script';
import { current, me as you, nextId } from './state';

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
      liveNotes: { notes: null, writing: false, error: null }, notices: mode === 'on' && !since ? [{ id: nextId('notice'), text: 'Notes are on. Everyone here can see that.', kind: 'notes' }] : [],
      isOrganizer: organizes, isHost: organizes, role: arrival.role,
      workspace: { id: null, name: null, chosenBy: meeting.organizer, canOpen: false, role: null, documents: [], agenda: null, present: null, play: null, asks: [], asked: 'no' },
      board: { open: null }
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
    earlier.forEach((l, i) => this.hear(l, Math.round(((i + 1) / (earlier.length + 1)) * since)));
    // Joining late, the call's notes have been written already.
    if (this.heard.length) {
      this.notesFor = this.heard.length;
      this.change((s) => ({ ...s, liveNotes: { notes: this.notesNow(), writing: false, error: null } }));
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
      ...s, elapsed: s.elapsed + 1,
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
      case 'rooms': this.opensRooms(b.rooms, b.minutes); return;
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
    this.change((s) => ({
      ...s, participants: s.participants.filter((q) => q.id !== x.id), spotlight: s.spotlight === x.id ? null : s.spotlight,
      breakouts: s.breakouts.open ? { ...s.breakouts, open: { ...s.breakouts.open, rooms: s.breakouts.open.rooms.map((r) => ({ ...r, members: r.members.filter((m) => m !== x.id) })) } } : s.breakouts
    }));
    this.crypto.update((c) => ({ ...c, members: c.members.filter((m) => m !== x.id), everyone: c.everyone.filter((m) => m !== x.id) }));
    this.livekit.update((r) => { const { [x.id]: _gone, ...rest } = r.people; return { ...r, people: rest }; });
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
    this.hear(l, this.getSnapshot().elapsed);
  }
  /** A line into the transcript, if notes are on where it was said and you're there to read it. */
  private hear(l: Line, at: number): void {
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
        this.change((s) => ({ ...s, liveNotes: { notes: this.notesNow(), writing: false, error: null } }));
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
    this.after(1200, () => this.crypto.update((c) => ({ ...c, status: 'in', members })));
  }
  /** The organizer (not you) opens rooms: you're sent to yours, if you're in one. */
  private opensRooms(plans: readonly RoomPlan[], minutes: number): void {
    const s = this.getSnapshot();
    const idOf = (p: Person | 'me') => (p === 'me' ? this.me.id : this.find(p)?.id);
    const rooms = plans.map((plan, k) => {
      const members = plan.people.flatMap((p) => { const id = idOf(p); return id ? [id] : []; });
      return { id: this.roomId(k), name: plan.name, people: plan.people.map((p) => (p === 'me' ? this.me.person : p)), members, paused: false };
    });
    const mine = rooms.find((r) => r.members.includes(this.me.id));
    const scribe = mine ? mine.members.find((id) => id !== this.me.id && !this.guests.has(id)) ?? this.me.id : null;
    this.push({ ...s, breakouts: { ...s.breakouts, open: { rooms, from: s.elapsed, until: s.elapsed + minutes * 60, message: null } }, capture: { ...s.capture, room: mine && notesAreOn(s.capture.mode) ? this.roomCapture(mine.id, scribe) : null } });
    const main = s.participants.filter((p) => !rooms.some((r) => r.members.includes(p.id))).map((p) => p.id);
    if (mine) this.moveTo(mine.id, mine.members);
    else this.crypto.update((c) => ({ ...c, members: main }));
    this.hosting();
  }
  openRooms(plan: BreakoutPlan): void {
    const s = this.getSnapshot();
    const rooms = plan.rooms.map((r, k) => ({
      id: this.roomId(k), name: r.name, people: r.emails.map(personAt), paused: false,
      members: s.participants.filter((p) => !p.isMe && r.emails.some((e) => e.toLowerCase() === p.person.email.toLowerCase())).map((p) => p.id)
    }));
    this.push({ ...s, breakouts: { ...s.breakouts, open: { rooms, from: s.elapsed, until: s.elapsed + plan.minutes * 60, message: null } } });
    // The organizer stays in the main room, and keeps every room's keys.
    this.crypto.update((c) => ({ ...c, members: s.participants.filter((p) => !rooms.some((r) => r.members.includes(p.id))).map((p) => p.id) }));
    this.hosting();
  }
  closeRooms(): void {
    const s = this.getSnapshot();
    const open = s.breakouts.open;
    if (!open) return;
    this.push({ ...s, breakouts: { open: null, held: [...s.breakouts.held, { rooms: open.rooms.map(({ paused: _p, ...r }) => r), from: open.from, to: s.elapsed }] }, capture: { ...s.capture, room: null } });
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
    this.change((s) => (s.liveNotes.notes ? { ...s, liveNotes: { ...s.liveNotes, notes: { ...s.liveNotes.notes, next: s.liveNotes.notes.next.map((n) => (n.id === id ? { ...n, done } : n)) } } } : s));
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
