/*
 * A call played from its script (scripted-call.ts), built up a responsibility at a time: each file here adds one to the
 * file before it, and reaches only down, so each part says what it holds and what it needs from below.
 *
 *   CallBase → CallWithAttention → CallWithCapture → CallWithNotes → CallWithChat → CallWithStage → CallWithWorkspace
 *   → CallWithBoards → CallWithPeople → CallWithRooms → CallWithHosting → ScriptedCall
 *
 * This is what every part stands on: the call's meeting, its script and ticket, you as the call has you, its stores (the
 * call's encryption as this browser sees it, LiveKit's side, private messages and notifications), people found by who
 * they are, and the guests who came with the link.
 */
import type { CallCrypto, CallParticipant, CallSeat, CallState, CallTicket, CallWorkspace, Meeting, Person, PersonalApi, WorkspaceItem } from '@alcove/api';
import { talking } from '../../browser';
import type { Screen } from '../../media/screens';
import { Pushed, Snapshots } from '../live';
import { personalFor } from '../notes/personal';
import { current } from '../state';
import { ScriptedDirectMessages } from './direct-messages';
import { ScriptedNotifications } from './notifications';
import type { CallScript } from './script';

/** A connection's identity in a call: `p_` and 22 characters, as LiveKit's are. */
export const identity = (seed: string) => `p_${seed.replace(/[^A-Za-z0-9]/g, '').padEnd(22, 'x').slice(-22)}`;
export const sameAs = (a: Person, b: Person) => a.id === b.id || (a.email !== '' && a.email.toLowerCase() === b.email.toLowerCase());
export const firstOf = (p: Person) => p.name.split(' ')[0] ?? p.name;

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

/** What the call is made with: the meeting, its script, you as it has you, its note, when you came in, your ticket. */
interface CallSetup {
  meeting: Meeting;
  script: CallScript;
  me: CallParticipant;
  noteId: string;
  began: number;
  ticket: CallTicket;
  /** Whether you ask to be let in first. */
  asking: boolean;
}

export abstract class CallBase extends Snapshots<CallState> {
  readonly direct: ScriptedDirectMessages;
  readonly ticket: CallTicket;
  readonly notifications: ScriptedNotifications;
  readonly crypto: Crypto;
  readonly personal: PersonalApi;
  /** LiveKit's side: the scripted room plays it. */
  readonly livekit: Pushed<RoomSide>;
  /** Whoever takes the data other browsers send to the room (the scripted room), told the topic, the payload and who from. */
  protected readonly dataTakers = new Set<(topic: string, payload: Uint8Array, from: string) => void>();
  /** The call this is, as the world has it. */
  protected readonly meeting: Meeting;
  protected readonly script: CallScript;
  protected readonly me: CallParticipant;
  /** The note this call writes, once notes have been on: your own notes on the call (`personal`) go with it. */
  protected readonly noteId: string;
  /** People who came in with the link, by name, and so don't get the notes. */
  protected guests = new Set<string>();
  /** When you first came in: the script's times count from then, whenever you join it again. */
  protected readonly began: number;

  constructor(state: CallState, setup: CallSetup) {
    super(state);
    this.meeting = setup.meeting;
    this.script = setup.script;
    this.me = setup.me;
    this.noteId = setup.noteId;
    this.began = setup.began;
    this.ticket = setup.ticket;
    this.crypto = new Crypto({ status: setup.asking ? 'waiting' : 'in', place: 'main', members: setup.asking ? [] : [setup.me.id], everyone: setup.asking ? [] : [setup.me.id], media: null, chat: [], missedChat: false });
    this.personal = personalFor(setup.noteId, () => this.getSnapshot().transcript);
    this.direct = new ScriptedDirectMessages(this, this.crypto, this.ticket, setup.script.privateSendFails);
    this.notifications = new ScriptedNotifications(setup.me.id, this, this.crypto, this.direct);
    this.livekit = new Pushed<RoomSide>({ people: {}, connection: 'connected', endReason: null, mutedYou: 0, sharesStopped: 0 });
  }

  /** Every snapshot is the server's next revision of the call, with the server's clock as it's pushed. */
  protected override push(next: CallState): void {
    super.push({ ...next, revision: next.revision + 1, attention: { ...next.attention, serverNow: new Date().toISOString() } });
  }
  /** The scripted room takes the data others send, until it stops. */
  takeData(on: (topic: string, payload: Uint8Array, from: string) => void): () => void {
    this.dataTakers.add(on);
    return () => { this.dataTakers.delete(on); };
  }
  /** Someone in the call, by who they are. */
  protected find(p: Person): CallParticipant | undefined {
    return this.getSnapshot().participants.find((x) => !x.isMe && sameAs(x.person, p));
  }
  /** Changes what LiveKit says about someone's browser. */
  protected them(p: Person, change: (t: Them) => Them): void {
    const id = this.find(p)?.id;
    const now = id ? this.livekit.getSnapshot().people[id] : undefined;
    if (id && now) this.livekit.update((r) => ({ ...r, people: { ...r.people, [id]: change(now) } }));
  }
  protected space(change: (w: CallWorkspace) => CallWorkspace): void { this.change((s) => ({ ...s, workspace: change(s.workspace) })); }
  protected get seat(): CallSeat { return { seat: this.me.seat, name: this.me.person.name }; }
  protected seatOf(p: CallParticipant): CallSeat { return { seat: p.seat, name: p.person.name }; }
  /** An item that's in its workspace and not in Trash; none in a workspace that's been deleted. */
  protected itemIn(workspaceId: string, id: string): WorkspaceItem | undefined { return current().workspaces.find((w) => w.id === workspaceId)?.items.find((i) => i.id === id && i.trashedAt === null); }
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
