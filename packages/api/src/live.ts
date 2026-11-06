import { z } from './zod';
import { BreakoutBoardModeSchema, CallBoardSchema, type BoardCheck, type BoardOpen, type BoardTimerMinutes, type BoardVotesEach, type BreakoutBoard } from './callBoards';
import { CallWorkspaceSchema, type CallFollowUps, type CallWorkspaceSwitch, type DocFollowUpTick, type PresentKind } from './callWorkspace';
import { CaptureStateSchema, type CaptureDevicePart } from './capture';
import { LiveNotesSchema, type CallAnswer, type CallMoment, type CatchUp, type CatchUpRange, type CatchUpWindow } from './catchup';
import { CallCodeSchema, IDSchema, ISODateSchema, NotesChoicesSchema, NotesSettingSchema, PersonSchema, SignInProviderSchema, TranscriptLineSchema, type CaptionLanguage, type SeriesAnswerPart } from './types';
import { RungSchema } from './rings';
import type { CallMoveOut, MoveMedia } from './moves';
import type { PersonalApi } from './personal';
import type { DocumentRole } from './workspaces';

/* Live sessions push whole snapshots. Subscribers re-render from the snapshot; nothing is patched in the UI. */

export type Unsubscribe = () => void;

export interface LiveStore<S> {
  getSnapshot(): S;
  subscribe(listener: () => void): Unsubscribe;
}

/* ---------- group calls: who's in the call comes from the API; mic, camera and screen are LiveKit's tracks ---------- */

/**
 * The organizer hosts. Invited people join with their accounts. Anyone else with the link asks to join: signed in, under
 * their account, or with a typed name. Someone signed in whom the organizer lets in from the link is added to the
 * invite (when the notes may go to their account), and is invited from then on.
 */
export const CallRoleSchema = z.enum(['host', 'invited', 'guest']);
export type CallRole = z.infer<typeof CallRoleSchema>;

/** What anyone with a call's link sees before joining. No account needed. */
export const CallCardSchema = z.object({
  title: z.string(),
  organizerName: z.string(),
  /** When the call starts. Means nothing while `offer` is open; once someone has picked, it's the time they picked. */
  startsAt: ISODateSchema,
  /** Someone hosts the call now (the organizer, or someone standing in for them): everyone but the organizer waits until this is true. */
  hostHere: z.boolean(),
  /**
   * Someone is hosting while the organizer is away, so they let people in. Their name goes only to the organizer, whose
   * joining takes the call back; anyone else learns only that someone is standing in.
   */
  standIn: z.object({ name: z.string().optional() }).nullable(),
  locked: z.boolean(),
  /** Notes as the call was scheduled: whether they start when it does. */
  notes: NotesSettingSchema,
  /** What the notes keep, so people know before they join. */
  choices: NotesChoicesSchema,
  /** Everyone joins with their microphone and camera off. */
  joinMuted: z.boolean(),
  /** Times offered to pick from, until someone with the link has: no joining meanwhile. How long the call is, in minutes. */
  offer: z.object({ times: z.array(ISODateSchema), minutes: z.number() }).nullable(),
  /** What's being captured now, without anyone's name; null until the organizer has started the call. */
  capture: CaptureStateSchema.nullable(),
  /** The call is over and nobody has started it again. */
  ended: z.boolean(),
  /**
   * Where the person asking stands, by their session. `invited` (or the organizer): let in without asking, and gets
   * the notes. `asks`: signed in with an account the notes may go to, so the organizer letting them in adds them to
   * the invite. `guest`: asks by name and doesn't get the notes (no account, a demo sign-in on a real organizer's
   * call, or someone standing in for the organizer would let them in).
   */
  you: z.enum(['invited', 'asks', 'guest']),
  /**
   * The ways of signing in that get this call's notes once let in: Google, and Microsoft and single sign-on too when
   * the organizer's own account is a demo one.
   */
  signInForNotes: z.array(SignInProviderSchema)
});
export type CallCard = z.infer<typeof CallCardSchema>;

/** What joining hands back: who you are in the call, and the pass for its requests. The room comes once you're let in. */
export const CallTicketSchema = z.object({
  callId: IDSchema,
  serverUrl: z.string(),
  roomName: z.string(),
  /** This connection's random LiveKit identity; a new one for every join. */
  identity: z.string(),
  role: CallRoleSchema,
  /** Sent as `x-alcove-call` on this call's requests. Never put it in a URL. */
  pass: z.string()
});
export type CallTicket = z.infer<typeof CallTicketSchema>;
export const CALL_PASS_HEADER = 'x-alcove-call' as const;

/** A call pass as a browser keeps it (sessionStorage) for coming back after a reload: parsed before it's sent anywhere. */
export const CallPassStoredSchema = z.string().min(20).max(2000).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

/**
 * The call a browser goes back to after signing in with Google from its join page (sessionStorage, in that tab only):
 * its code, as a link has it, and until when (ms).
 */
export const CallReturnStoredSchema = z.object({ code: CallCodeSchema, until: z.number() });

/** A LiveKit join token, for someone who's been let in. It only lasts until the browser connects; it carries no name. */
export const CallRoomTokenSchema = z.object({ token: z.string() });

/**
 * The parts of a call (docs: Calls and recordings › Breakout rooms): the main room, and while breakout rooms are
 * open, each room, by its ID. Each part has its own MLS group, so its own media keys and chat.
 */
export const MAIN_PLACE = 'main' as const;
/** A part of the call as the wire names it: `main`, or a breakout room's ID. */
export const CallPlaceSchema = z.string().regex(/^(?:main|[A-Za-z0-9_-]{16,64})$/);

/**
 * The call's MLS log as this person may see it (docs: Calls and recordings › End-to-end encryption). Bodies are MLS
 * messages, base64url: the organizer's commits, a welcome for whoever was added, and chat, each in one part of the
 * call's group (`group`). Key packages come with the people the host's browser may add (`CallMlsGroup.pending`).
 */
export const CallMlsItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('commit'), seq: z.number(), group: z.string(), epoch: z.number(), body: z.string() }),
  z.object({ kind: z.literal('welcome'), seq: z.number(), group: z.string(), epoch: z.number(), body: z.string() }),
  z.object({ kind: z.literal('message'), seq: z.number(), group: z.string(), epoch: z.number(), body: z.string() })
]);
export type CallMlsItem = z.infer<typeof CallMlsItemSchema>;
/** One part of the call's MLS group as this browser keeps it: its epoch, and for the host's browser whom to add and take out. */
export const CallMlsGroupSchema = z.object({
  /** `main`, or a breakout room's ID. */
  id: z.string(),
  epoch: z.number(),
  /**
   * For the host's browser: who it may add to this group now, whether they need letting in first, and their latest
   * key package (base64url), however long ago it came: someone moving sends theirs before they may be added.
   */
  pending: z.array(z.object({ id: z.string(), admit: z.enum(['auto', 'ask']), keyPackage: z.string() })),
  /** For the host's browser: people in this group to take out of it (gone, removed, or sent to another part of the call). */
  departed: z.array(z.string())
});
export type CallMlsGroup = z.infer<typeof CallMlsGroupSchema>;
export const CallMlsSchema = z.object({
  /** A new generation (new MLS groups for every part of the call) starts whenever the connection that hosts changes. */
  generation: z.number(),
  /**
   * Where this person stands: let in, still waiting to be, out for now (taken out while this connection was away, so it
   * can come back in as it is: `mls/back`), or not in the call (turned away, removed, left, or their place went to
   * another tab or device). `away`: an organizer's connection that was gone long enough that someone else hosts now;
   * joining again takes the call back.
   */
  admission: z.enum(['in', 'waiting', 'out', 'denied', 'away']),
  /**
   * The connection that hosts, so commits for every group in this generation: its browser created them all, so it's at
   * leaf 0 of each, the only one whose commits count. The organizer's, or someone's standing in while the organizer is away.
   */
  committer: z.string().nullable(),
  /** The part of the call this person is in now (`main`, or the room they're in or the organizer is visiting): their media and chat use its group. */
  place: z.string(),
  /** The group this person is in, as the API counts the organizer's commits: `main`, a room's ID, or null (none yet, or between two). The organizer is in every group. */
  group: z.string().nullable(),
  /** The groups this browser keeps: the host's, every part of the call; anyone else's, the one they're in. */
  groups: z.array(CallMlsGroupSchema),
  /** This person's part of the log: the host's from the start of the generation (chat only in its part of the call, from when it got there), anyone else's from their welcome into their group. */
  items: z.array(CallMlsItemSchema),
  /** Whether there was chat in this person's part of the call while they weren't there, which their browser can't read. */
  earlierChat: z.boolean(),
  /** This browser should send a fresh key package: it's to be added to a group (a new generation, or a move to another part of the call) and has none unused. */
  keys: z.boolean(),
  /** How far the log was read (past entries for other people too), to ask from next time. */
  latest: z.number(),
  /** There's more after `latest`: ask again at once. */
  more: z.boolean()
});
export type CallMls = z.infer<typeof CallMlsSchema>;


/**
 * Sent by the server on CALL_TOPIC when the call changed: `call` (people, notes, the transcript) and `log` (its
 * MLS log: keys and chat) say what to fetch again. It carries nothing else, so LiveKit learns nothing from it.
 */
export const CALL_TOPIC = 'call' as const;
export const CallNudgeSchema = z.object({ v: z.literal(1), kind: z.literal('changed'), call: z.boolean(), log: z.boolean() });
export type CallNudge = z.infer<typeof CallNudgeSchema>;

export const CallParticipantSchema = z.object({
  /** LiveKit identity: new for every connection, a reload included. */
  id: z.string(),
  /**
   * The same across someone's reconnections to this call (a reload; for the organizer, any device), so each viewer's
   * own layout keeps them where they were. Anyone else joining from a second browser is a new person, with a new seat.
   * Random, and different in every call: it says nothing about who they are.
   */
  seat: z.string(),
  /** `isOrganizer`: the organizer's connection. Who hosts now is `CallState.host`. */
  person: PersonSchema, isMe: z.boolean(), isOrganizer: z.boolean(),
  /** A raised hand, which everyone sees. (Mic, camera and screen are LiveKit's tracks, not the server's.) */
  hand: z.boolean(),
  /**
   * Whether others may point at and mark what they share: their own choice, kept across their reconnections, on until
   * they turn it off. They can always point at their own share.
   */
  othersPoint: z.boolean()
});
export type CallParticipant = z.infer<typeof CallParticipantSchema>;

/**
 * Someone asking to be let in. Only the organizer sees them: with their account's address when they're signed in with
 * one the notes may go to (letting them in adds them to the invite), otherwise by name, without an address.
 */
export const CallAskerSchema = z.object({ id: z.string(), person: PersonSchema });
export type CallAsker = z.infer<typeof CallAskerSchema>;

export const CallNoticeSchema = z.object({
  id: IDSchema,
  /** Plain sentence shown to everyone, e.g. "You turned on notes." */
  text: z.string(),
  kind: z.enum(['notes', 'people', 'info'])
});
export type CallNotice = z.infer<typeof CallNoticeSchema>;
/** Notices a tab has shown for a call, as it keeps them (sessionStorage), so a reload doesn't show them again. */
export const CallNoticesSeenSchema = z.array(IDSchema.max(64)).max(50);

/** Encrypted audio stored so far for the call's notes. */
export const RecordingProgressSchema = z.object({
  /** Current segment; a new one starts each time notes are turned on again or resumed. */
  segment: z.number(),
  pieces: z.number(),
  seconds: z.number()
});
export type RecordingProgress = z.infer<typeof RecordingProgressSchema>;

/** One breakout room: its name and the invited people sent to it. */
export const BreakoutRoomSchema = z.object({
  id: IDSchema, name: z.string(), people: z.array(PersonSchema),
  /**
   * Who's in it now, by participant ID: the invited people sent there who are in the call, and the organizer
   * while visiting it. Each room has its own MLS group, so its own media keys and chat.
   */
  members: z.array(z.string())
});
export type BreakoutRoom = z.infer<typeof BreakoutRoomSchema>;
export const BreakoutsSchema = z.object({
  /** Rooms that are open now, or null. Times are seconds since the call started. */
  open: z.object({
    /**
     * Each room open now, whether the organizer has paused notes in it (CaptureState.room says what that holds), and whether
     * it has a board of its own open: what's on it is for the people in it, so nobody else is told more than that.
     */
    rooms: z.array(BreakoutRoomSchema.extend({ paused: z.boolean(), board: z.boolean() })),
    /** What the rooms were opened with to work on (`BreakoutBoard`): nothing, a board each, or the main board, shared. */
    board: BreakoutBoardModeSchema,
    from: z.number(),
    /** Everyone comes back at this time, unless the organizer brings them back sooner. */
    until: z.number(),
    /** The organizer's latest message to every room. */
    message: z.object({ text: z.string(), at: z.number() }).nullable()
  }).nullable(),
  /** Rooms that have closed, oldest first. Each goes into the call's notes. */
  held: z.array(z.object({ rooms: z.array(BreakoutRoomSchema), from: z.number(), to: z.number() }))
});
export type Breakouts = z.infer<typeof BreakoutsSchema>;

/**
 * Who hosts the call (docs: Calls and recordings › Host hand-off): the organizer, or while the organizer is away
 * (their connection dropped, or they left it to someone), someone invited standing in for them. Whoever hosts lets
 * people in, keeps the call's keys moving and takes its notes; only the organizer changes what the notes capture.
 */
export const CallHostSchema = z.object({
  /** The participant who hosts now. Null for the moment between a host's connection dropping and someone taking over. */
  id: z.string().nullable(),
  /** Whoever hosts is standing in for the organizer, who takes the call back by joining again. */
  standIn: z.boolean(),
  /** The organizer, as you see them: whom a stand-in hosts for, even while the organizer isn't in the call. */
  organizer: PersonSchema,
  /**
   * For whoever hosts: who could take over from them, best first. People invited to the call who are in it, never a
   * guest, the main room before breakout rooms, then whoever came first. Empty for everyone else.
   */
  next: z.array(z.string())
});
export type CallHost = z.infer<typeof CallHostSchema>;

export const CallStateSchema = z.object({
  callId: IDSchema,
  meetingId: IDSchema,
  code: z.string(),
  title: z.string(),
  startedAt: ISODateSchema,
  /** Seconds since the call started. */
  elapsed: z.number(),
  phase: z.enum(['in-call', 'ended']),
  participants: z.array(CallParticipantSchema),
  locked: z.boolean(),
  /**
   * Whether people may point at and mark shared screens (docs: Calls and recordings › Pointing at shared screens): the
   * organizer's switch, on until they turn it off. Pointers and marks go from browser to browser, encrypted end to end.
   */
  pointing: z.boolean(),
  /** The participant the organizer put on everyone's main stage, or null. */
  spotlight: IDSchema.nullable(),
  breakouts: BreakoutsSchema,
  /** What's being captured now and how it got there: the same for everyone in the call. Only the organizer changes it. */
  capture: CaptureStateSchema,
  /** The note this call is writing. */
  notes: z.object({
    /** True once notes have been on at any point, so the call produces a note. */
    everOn: z.boolean(),
    noteId: IDSchema.nullable(),
    recording: RecordingProgressSchema
  }),
  /** People asking to join, for whoever hosts to let in or turn away; empty for everyone else. */
  waiting: z.array(CallAskerSchema),
  /** People the organizer rang who aren't in the call, and how each answered; empty for everyone else. */
  ringing: z.array(RungSchema),
  /**
   * Connections that left but are still in the call's group for a moment, while the host's browser takes them
   * out: whose they were, and that person's connection now (`now`) when they're still in the call, back from a reload
   * or moved to another device. Shown as who they are, never as a stranger, and never twice.
   */
  leaving: z.array(z.object({ id: z.string(), seat: z.string(), person: PersonSchema, now: z.string().nullable() })),
  /** Who hosts now: the organizer, or someone standing in while the organizer is away. */
  host: CallHostSchema,
  /** The call's MLS group generation; browsers already in the call rejoin when it changes. */
  generation: z.number(),
  /**
   * What's been said while notes were on, transcribed as the call goes: the latest lines, oldest first, from the part
   * of the call you're in now only. What's said in one breakout room never shows in another, or in the main room.
   */
  transcript: z.array(TranscriptLineSchema),
  /** The shared live notes of the part of the call you're in, written only from what you may read. Nothing for someone waiting to be let in. */
  liveNotes: LiveNotesSchema,
  /** The workspace the call uses, as you may know it. Nothing that names anything for someone waiting to be let in, or who can't open it. */
  workspace: CallWorkspaceSchema,
  /** The board open in the part of the call you're in, as you may know it. Nothing for someone waiting to be let in. */
  board: CallBoardSchema,
  notices: z.array(CallNoticeSchema),
  /** Only the organizer can turn notes on or off, pause and resume them. */
  isOrganizer: z.boolean(),
  /** You host now (the organizer, or standing in for them): you let people in, mute, remove and lock, and can end the call. */
  isHost: z.boolean(),
  /**
   * Your role in the call as it stands. It can differ from the ticket's: someone signed in whom the organizer let in
   * from the link joined as a guest and is invited now. A guest sees people by name only.
   */
  role: CallRoleSchema
});
export type CallState = z.infer<typeof CallStateSchema>;

export const CallEndResultSchema = z.object({
  meetingId: IDSchema,
  /** Present when notes were on at some point. */
  pendingNoteId: IDSchema.nullable(),
  duration: z.number()
});
export type CallEndResult = z.infer<typeof CallEndResultSchema>;

/**
 * A few seconds of speech to transcribe while notes are on: 16 kHz mono 16-bit WAV, which the
 * notes service reads directly. Separate from the encrypted recording, which keeps its own format.
 */
export interface TranscriptClip {
  data: Blob;
  /** Segment the speech belongs to (see RecordingProgress.segment). */
  segment: number;
  /** Where the clip starts, in seconds from the start of its segment, pauses not counted. A room recording is one segment. */
  at: number;
  durationMs: number;
  /**
   * In a call, when the speech began, by this browser's `performance.now()`. The request says how long ago that was
   * (`AUDIO_HEADERS.ago`), and the server places the speech where its speaker was then: a clip still on its way when
   * someone moves stays where it was said. A room recording has none.
   */
  heardAt?: number | undefined;
}

/**
 * A frame of the presenter's own shared screen, kept because the screen changed (docs: Calls and recordings › Shared
 * screens): JPEG bytes, which share it's from (its LiveKit track ID), and when it was taken (`Date.now()` then).
 */
export interface ScreenFrame {
  data: Blob;
  share: string;
  takenAt: number;
}
/** What the call kept of a frame: its ID, or the ID it already had if the same frame came before (a retry). */
export const ScreenFrameReceiptSchema = z.object({ id: IDSchema, duplicate: z.boolean() });
export type ScreenFrameReceipt = z.infer<typeof ScreenFrameReceiptSchema>;

/**
 * A piece of recorded audio, as produced by MediaRecorder every few seconds. Sending a piece that's
 * stored already stores nothing new. A room recording takes such a resend even once it's paused or
 * stopped; a call refuses audio once notes are off or a later segment has begun.
 */
export interface AudioPiece {
  data: Blob;
  /** Segment the piece belongs to (see RecordingProgress.segment). */
  segment: number;
  /** Position within the segment, starting at 0. */
  seq: number;
  /** Where the piece starts, in seconds from the start of its segment, pauses not counted. */
  at: number;
  durationMs: number;
  mimeType: string;
}

/**
 * A chat message, decrypted in this browser. `from` is the sender's identity, as MLS vouches for it; `place` is the
 * part of the call it was sent in (`main`, or a breakout room's ID), whose group alone could read it.
 */
export interface CallChatMessage { id: string; from: string; isMe: boolean; text: string; at: number; place: string }

/** The longest chat message in a call, in characters. */
export const CALL_CHAT_MAX = 4000;
/**
 * How much longer data browsers send each other is once sealed (CallSession.sealData): a version byte, the key's ring
 * index and a 12-byte nonce in front, and AES-GCM's 16-byte tag.
 */
export const CALL_DATA_OVERHEAD = 30;
/** How many keys LiveKit's frame encryption keeps per sender (its key index is one byte); media key indices are below it. */
export const CALL_KEYRING = 256;
/**
 * The key-ring index a browser sends under while it's between two parts of the call, with a key nobody else has.
 * No epoch's keys are ever put there, so nobody can decrypt what it sends meanwhile.
 */
export const CALL_VOID_KEY_INDEX = CALL_KEYRING - 1;

/**
 * The media keys for LiveKit's frame encryption, from the MLS group of the part of the call this browser is in:
 * one per sender per epoch (a key encrypts only its sender's frames, as SFrame requires), at a key-ring index for
 * that epoch. New ones with every join and leave, and every few minutes besides.
 */
export interface CallMediaKeys {
  /** The latest few epochs, oldest first: everyone's keys, by identity, to decrypt their frames with. */
  epochs: { index: number; keys: Record<string, Uint8Array> }[];
  /**
   * This browser's own key to encrypt with. For a moment after the keys move on it's still the previous
   * epoch's, so everyone has the new keys before anyone sends with them. Null while it's between two parts of
   * the call: then it sends under a key nobody else has, so nothing it sends can be heard or seen anywhere.
   */
  send: { index: number; key: Uint8Array } | null;
}

/**
 * This browser's side of the call's end-to-end encryption: the MLS group of the part of the call it's in, and what
 * that gives it. Nothing here ever leaves the browser.
 */
export interface CallCrypto {
  /**
   * joining: making keys, or getting back in; waiting: asked to be let in; in: in the group of the part of the call
   * it's in; moving: let in, and between two parts of the call (sent to a breakout room, or back from one), so it hears
   * and sends nothing until it's in the new part's group; denied: turned away; removed: no longer in the call (removed,
   * or this call went on from another tab or device); away: the organizer's connection, gone long enough that someone
   * else hosts now, so joining again takes the call back; failed: this browser's keys fell out of step, and it has to
   * join again.
   */
  status: 'joining' | 'waiting' | 'in' | 'moving' | 'denied' | 'removed' | 'away' | 'failed';
  /** The part of the call this browser is in, or is on its way to: `main`, or a breakout room's ID. */
  place: string;
  /** Who's in that part's group (LiveKit identities), from MLS itself, not from the server: the people whose media plays here. */
  members: string[];
  /** Everyone in every group this browser keeps (the organizer's keeps every part of the call's), from MLS. */
  everyone: string[];
  media: CallMediaKeys | null;
  chat: CallChatMessage[];
  /** True once there was chat in this part of the call while this browser wasn't in it, which it can't read. */
  missedChat: boolean;
}

/** A live transcript line in someone's caption language. Only the person who asked sees it. */
export const CaptionTranslationSchema = z.object({ id: IDSchema, text: z.string() });
export type CaptionTranslation = z.infer<typeof CaptionTranslationSchema>;

/** A line of a call's recording, to hear: its audio, whole pieces of the recording around it, and where in that the line is (seconds). */
export interface LineAudio { audio: Blob; from: number; seconds: number }

/** Rooms to open: who goes where (invited people, by email), for how long, and what they have to work on. */
export interface BreakoutPlan { rooms: { name: string; emails: string[] }[]; minutes: number; board: BreakoutBoard }

export interface CallSession extends LiveStore<CallState> {
  /** Who you are in the call, and this person's pass for the call's requests. */
  readonly ticket: CallTicket;
  /** The call's encryption as this browser sees it. */
  readonly crypto: LiveStore<CallCrypto>;
  /**
   * Your own notes on this call, with this browser's account: only you read them. For the organizer and everyone on the
   * invite, once notes have been on; someone with only the link has no account to keep them under.
   */
  readonly personal: PersonalApi;
  /** A LiveKit token, once you're let in. Rejected before that. */
  room(): Promise<{ serverUrl: string; roomName: string; identity: string; token: string }>;
  /** Fetches the call and its MLS log again (other people's chat, notes changes, transcript lines and keys arrive this way), or only what a nudge says changed. */
  refresh(what?: { call: boolean; log: boolean } | undefined): Promise<void>;
  /** Encrypted in this browser for everyone in the group of the part of the call you're in. Nobody who comes later can read it. */
  sendChat(text: string): Promise<void>;
  /**
   * Seals data this browser sends straight to the others in the call through LiveKit (pointers and marks on shared
   * screens): AES-GCM under a key derived from its own media key for the epoch it sends in, bound to `topic` and to who
   * sends it. Only someone holding that key (the people in the call's group) can open it. Null while there's no key.
   */
  sealData(topic: string, payload: Uint8Array): Promise<Uint8Array<ArrayBuffer> | null>;
  /**
   * Opens data `from` someone in the call, with their media key for the epoch it was sealed in (one of the last few). Null
   * when it doesn't open: not sealed by them, for another topic, from too long ago, or changed on the way.
   */
  openData(topic: string, from: string, sealed: Uint8Array): Promise<Uint8Array | null>;
  /** Whoever hosts: lets someone who asked into the call (their browser is added to the group). */
  admit(identity: string): Promise<void>;
  /** Whoever hosts: turns someone away. */
  deny(identity: string): Promise<void>;
  /** Organizer only: rings teammates, or people already invited, by address. Anyone rung is added to the invite; ringing someone again starts over. */
  ring(emails: string[]): Promise<void>;
  /** Organizer only. Everyone in the call sees the change. Resolves once it's made, so capture can wait for it. */
  setNotes(on: boolean): Promise<void>;
  /**
   * Organizer only: holds every kind of capture until resume(). Nothing is recorded, transcribed or sent to the AI
   * meanwhile, and the server refuses whatever arrives. Resolves once the server has paused.
   */
  pause(): Promise<void>;
  /** Organizer only: carries on capturing, on a new segment. Nothing else ever resumes it: not a reconnect, a room or a new device. */
  resume(): Promise<void>;
  /** Anyone but the organizer, while notes are off or paused: asks the organizer for notes, like raising a hand, or takes the ask back. */
  requestNotes(up: boolean): Promise<void>;
  /** Organizer only: says not now to an ask for notes. Whoever asked is told. Saying yes is turning notes on, or resuming. */
  declineNotes(requestId: string): Promise<void>;
  /** Whoever hosts, whose browser takes the notes: what it can't capture now (no microphone, or no way to record or listen), or none. */
  setUnavailable(parts: CaptureDevicePart[]): Promise<void>;
  /**
   * Organizer only: has shared screens read for the notes, or stops it. Only while notes are on or paused; everyone
   * sees it in `capture.screen`. Resolves once the server has done it.
   */
  setScreens(on: boolean): Promise<void>;
  /**
   * The presenter's own browser: one frame of its own share, while screen notes are on and not paused. Refused for
   * anyone else's share, for a camera, and from a breakout room. The same frame sent again is kept once.
   */
  shareFrame(frame: ScreenFrame): Promise<ScreenFrameReceipt>;
  /** The presenter's own browser: one of its shares ended, so what it showed last stops there in the notes. */
  shareEnded(share: string): Promise<void>;
  /** Raises or lowers your hand; everyone in the call sees it. */
  setHand(up: boolean): void;
  /** Whether others may point at and mark what you share; everyone sees it. Resolves once the server has it. */
  letOthersPoint(on: boolean): Promise<void>;
  /** Organizer only: whether anyone may point at and mark shared screens in this call. Resolves once the server has it. */
  setPointing(on: boolean): Promise<void>;
  /** Whoever hosts: puts one participant on everyone's main stage, or nobody (null). */
  setSpotlight(participantId: string | null): void;
  /** Organizer only: splits the invited people into rooms for a while. */
  openRooms(plan: BreakoutPlan): void;
  /** Whoever hosts: brings everyone back from the rooms now. */
  closeRooms(): void;
  /** Organizer only: a message every room sees. */
  messageRooms(text: string): void;
  /** Organizer only: goes to one of the open rooms, or back to the main room (null). Everyone in that room sees and hears them. */
  visitRoom(roomId: string | null): void;
  /** Organizer only: renames an open room. */
  renameRoom(roomId: string, name: string): void;
  /** Organizer only: sends an invited person (by email) to another open room, or back to the main room (null). Their keys move with them. */
  moveToRoom(email: string, roomId: string | null): void;
  /**
   * Organizer only: pauses notes in one open room while the call's notes are on, or carries on there (`paused` false).
   * Nothing said in a paused room is transcribed or sent to the AI, and the server refuses whatever arrives for it.
   * Resolves once the server has done it.
   */
  pauseRoom(roomId: string, paused: boolean): Promise<void>;
  /** Live transcript lines in `language`, for you alone. Each line is translated once and kept sealed until the call ends. */
  translate(lineIds: string[], language: CaptionLanguage): Promise<CaptionTranslation[]>;
  /**
   * Hear it, during the call: the recording of one line of its transcript (`line`, in the note `note`), for anyone in the
   * call, but only a line they may read, said while they were there: a guest with the link never hears what was said while
   * they were away. `not-found` for anything else, a call that doesn't keep its recording included. After the call it's
   * the note's audio, for people with the note.
   */
  hear(note: string, line: string): Promise<LineAudio>;
  /** Whoever hosts: encrypts and stores one piece of the notes recording. */
  appendAudio(piece: AudioPiece): Promise<void>;
  /**
   * Whoever hosts: transcribes a few seconds of speech into the live transcript, under whoever said it. The host's
   * browser hears everyone it plays, each on their own: `speaker` is the participant ID of the person heard (this
   * browser's own for its microphone). Only while notes are on.
   */
  transcribe(clip: TranscriptClip, speaker: string): Promise<void>;
  /**
   * Says this browser is showing the live notes, until the function it returns is called. While anything here is, the
   * notes of the part of the call it's in are kept up to date: at most every 30 seconds while there's something new,
   * in one run however many browsers are watching. The notes themselves arrive with the call (`CallState.liveNotes`).
   */
  watchNotes(): () => void;
  /**
   * Anyone in the call who gets the notes: ticks a follow-up of the live notes, or takes the tick back, for everyone in
   * that part of the call. It stays ticked through every refresh, and is done in the note when the call ends. A guest
   * with the link is refused, and notes written for a narrower view (`read.whileHere`) can't be ticked. Resolves once the
   * server has it.
   */
  tickFollowUp(id: string, done: boolean): Promise<void>;
  /**
   * Anyone in the call who gets the notes: adds a follow-up nobody said, in your own words, for you, for everyone in that
   * part of the call. It's ticked with `tickFollowUp`, comes with the call (`CallState.liveNotes.added`), and is yours in
   * the note when the call ends. The same words again add nothing. Refused where ticking is, and where notes have never been on.
   */
  addFollowUp(text: string): Promise<void>;
  /**
   * Opening Workspace, for anyone in the call: the first time, it settles the call's home (the meeting's, else a new one
   * named after the call and the day, where this browser is), with the call's folder in it, and the next call in a series
   * finds its new agenda. Resolves with `workspace` up to date, which for someone who can't open it says it's private.
   */
  openWorkspace(): Promise<void>;
  /** Organizer only: what viewing another workspace would mean, for the sheet that asks. Changes nothing. */
  previewWorkspace(workspaceId: string): Promise<CallWorkspaceSwitch>;
  /**
   * Organizer only: everyone views and edits a workspace the organizer can edit in, or the call's home again. The notes and
   * transcript still go to the home. Nobody is interrupted; what's being presented and played stops.
   */
  setWorkspace(workspaceId: string): Promise<void>;
  /**
   * Organizer only: makes a workspace for this call, named after it unless it's given a name, and everyone views it. As the
   * call's home does, it has everyone invited in it to edit (a guest without an account isn't), and it follows the invite.
   */
  newWorkspace(name?: string | undefined): Promise<void>;
  /** Anyone who can open it: brings a document in the call's workspace to the call, or takes it off (`brought` false). */
  bringDocument(documentId: string, brought: boolean): Promise<void>;
  /** Asks the organizer to share something from the workspace, or takes the ask back. It names nothing. */
  askForWorkspace(up: boolean): Promise<void>;
  /** Organizer only: answers an ask by opening one document to whoever asked, until the call ends or Share takes it back. */
  grantWorkspaceAsk(askId: string, documentId: string, role: DocumentRole): Promise<void>;
  /** Organizer only: says not now to an ask. Whoever asked is told. */
  declineWorkspaceAsk(askId: string): Promise<void>;
  /** Anyone who can open it: presents a document or board in the call's workspace to the part of the call they're in. */
  startPresenting(kind: PresentKind, id: string, section?: number | undefined): Promise<void>;
  /** Whoever started it, or the organizer. */
  movePresenting(section: number): Promise<void>;
  /** Whoever started it, or the organizer. */
  stopPresenting(): Promise<void>;
  /** Anyone who can open the document: plays a video in it for the part of the call they're in, from `positionMs`. */
  startPlaying(documentId: string, mediaId: string, positionMs?: number | undefined): Promise<void>;
  /** Whoever started it, or the organizer: it holds at `positionMs`. */
  pausePlaying(positionMs: number): Promise<void>;
  /** Whoever started it, or the organizer: it carries on from where it holds. */
  resumePlaying(): Promise<void>;
  /** Whoever started it, or the organizer: it goes to `positionMs`, playing or held as it was. */
  seekPlaying(positionMs: number): Promise<void>;
  /** Whoever started it, or the organizer. Nothing about the video changes. */
  stopPlaying(): Promise<void>;
  /**
   * Anyone invited, not a guest: opens a board for everyone in the part of the call they're in, in place of whatever's open
   * there. A new one is saved in the call's home, named after the call; a saved one, from whichever workspace it's in, needs
   * `edit` on it. Resolves once it's open, with `board` up to date.
   */
  openBoard(from: BoardOpen): Promise<void>;
  /** Whoever opened it, or the organizer: closes it for everyone. Nothing is deleted, and nobody loses what the call gave them. */
  closeBoard(): Promise<void>;
  /** What opening a saved board would mean: who here can't open it, and whether you may let them in. For someone who could bring it. Changes nothing. */
  boardCheck(workspaceId: string, documentId: string): Promise<BoardCheck>;
  /**
   * Says this browser has the board open, until the function it returns is called. While anything here does, and notes are
   * on, what was said in the part of the call it's in is looked at for ideas worth putting on the board: at most once a
   * minute, in one run however many browsers are looking. The ideas arrive with the call (`CallState.board.ideas`).
   */
  watchIdeas(): () => void;
  /** Ideas from the call that were added to the board, or put aside: they go for everyone in that part of the call. */
  ideasDone(ids: string[]): Promise<void>;
  /**
   * Anyone who can edit the board open here: a timer everyone there sees count down, of 3, 5 or 10 minutes from now. While
   * one is still running, starting another starts it over, and is only for whoever started it or the organizer, or while
   * neither of them is in the call, anyone who can edit the board.
   */
  startTimer(minutes: BoardTimerMinutes): Promise<void>;
  /** Whoever started it, or the organizer, or while neither is in the call anyone who can edit the board: it goes for everyone. */
  stopTimer(): Promise<void>;
  /**
   * Anyone who can edit the board open here: a vote on one of its frames, or on every sticky on it with no frame, with `per`
   * votes each. Nobody is told a count until it ends. Never on top of another, nor of one whose results haven't been cleared.
   */
  startVote(frame: string | null, per: BoardVotesEach): Promise<void>;
  /** Anyone who can edit the board, while the vote is on: a vote for a sticky it's on, one a sticky, up to `per`. Only you are told. */
  castVote(sticky: string): Promise<void>;
  /** Takes your vote for a sticky back, while the vote is on. */
  takeBackVote(sticky: string): Promise<void>;
  /** Whoever started it, or the organizer, or while neither is in the call anyone who can edit the board: it ends, and everyone is told every count at once. */
  endVote(): Promise<void>;
  /** The same people, once it's ended: the results go, for everyone. */
  clearVote(): Promise<void>;
  /** The call's follow-ups as you may read them, kept up to date while something here says it's showing them (`watchFollowUps`). */
  readonly followUps: LiveStore<CallFollowUps | null>;
  /** Says this browser is showing the follow-ups, until the function it returns is called. */
  watchFollowUps(): () => void;
  /** Ticks a to-do in a document from the follow-ups, or takes the tick back, as ticking it in the document does. Needs `edit`. */
  tickDocumentFollowUp(tick: DocFollowUpTick): Promise<void>;
  /** What was said in `range`, for you alone: decided, proposed, still open and next, each with the moments it comes from. */
  catchUp(range: CatchUpRange): Promise<CatchUp>;
  /** Asks about what was said in `range`, for you alone, with the moments the answer comes from. */
  askSoFar(question: string, range: CatchUpRange): Promise<CallAnswer>;
  /** What you can catch up on: when you came in, your latest time away, and for a guest the stretches they were here. */
  catchUpWindow(): Promise<CatchUpWindow>;
  /** A moment of the live transcript from a catch-up or an answer, with what was said around it. Your access is checked again. */
  moment(lineId: string): Promise<CallMoment>;
  /**
   * Asks across the earlier calls in this call's series, for you alone, from the notes your account has now, with the
   * calls and moments the answer comes from. `timeZone` as in series.ask. Needs a sign-in, and waits while notes are paused.
   */
  askEarlier(question: string, timeZone: string): Promise<SeriesAnswerPart[]>;
  /* Host controls, for whoever hosts (refused for anyone else). */
  /** Mutes one of someone's tracks; they unmute themselves. */
  mute(identity: string, trackSid: string): Promise<void>;
  /** Disconnects someone. They can come back with the link unless the call is locked. Nobody removes the organizer. */
  remove(identity: string): Promise<void>;
  /** While locked, nobody new can join except the organizer. */
  lock(on: boolean): Promise<void>;
  /** Stops ringing someone (their `Rung.id`). A ring that's already over needs no stopping. */
  stopRing(ringId: string): Promise<void>;
  /** Hides a notice on this screen only. */
  dismissNotice(id: string): void;
  /** Starts moving your place in the call to another device, with your microphone and camera as they are now. */
  startMove(media: MoveMedia): Promise<CallMoveOut>;
  /** Whoever hosts leaving ends the call for everyone and returns how it ended; anyone else just leaves (null). */
  leave(): Promise<CallEndResult | null>;
  /**
   * Whoever hosts leaves, and the call goes on with `to` hosting (someone invited who's in the call, among
   * `CallState.host.next`) until the organizer is back. Refused when they can't host now.
   */
  handOff(to: string): Promise<void>;
  /** Stops keeping up with the call here, without leaving it: the call ended, or this person is out of it. */
  close(): void;
  /**
   * The page is going away (closed, reloaded or left for another): stops here and tells the server this connection
   * has gone, without waiting for an answer, so nobody waits on it. Whoever hosts doesn't say so: their reload comes
   * back still hosting, and if they don't come back someone else hosts, or the call ends when nobody can.
   */
  closing(): void;
}

/** A recording made without a connection can be uploaded until it's this many days old. */
export const MAX_RECORDING_AGE_DAYS = 14;

/**
 * Starting a recording in the room. `startedAt` is when it really started, for one recorded without
 * a connection and uploaded later: up to MAX_RECORDING_AGE_DAYS back, and not in the future. Starting
 * again from the same `startedAt` carries on with that recording, as it is, so an upload that was cut
 * off resumes instead of making a second note. `owner` is the account it was recorded under (its
 * opaque ID): a session of any other account is refused (`forbidden`) and nothing is made, so a
 * recording kept on a shared device never lands in whoever is signed in there now.
 */
export const RoomRecordingInputSchema = z.object({
  title: z.string().trim().max(160).optional(),
  startedAt: z.iso.datetime({ offset: true }).optional(),
  owner: z.string().min(1).max(100).optional()
});
export type RoomRecordingInput = z.infer<typeof RoomRecordingInputSchema>;

export const RoomRecordingStateSchema = z.object({
  id: IDSchema,
  noteId: IDSchema,
  title: z.string(),
  /** When it started: when it was started here, or its own start for one recorded without a connection. */
  startedAt: ISODateSchema,
  /** Seconds of audio stored so far, excluding pauses. */
  elapsed: z.number(),
  status: z.enum(['recording', 'paused', 'stopped']),
  recording: RecordingProgressSchema,
  /** What's been said so far, transcribed as the recording goes: the latest lines, oldest first. */
  transcript: z.array(TranscriptLineSchema)
});
export type RoomRecordingState = z.infer<typeof RoomRecordingStateSchema>;

/** The note being written, and how long the recording is: its pieces' total, pauses not counted. */
export const RecordingStopResultSchema = z.object({ pendingNoteId: IDSchema, duration: z.number() });
export type RecordingStopResult = z.infer<typeof RecordingStopResultSchema>;

export interface RoomRecording extends LiveStore<RoomRecordingState> {
  /** Renames: the snapshot says so at once. Resolves once the server has the new name, and fails if it couldn't. */
  rename(title: string): Promise<void>;
  /** Pauses: the snapshot says so at once. Resolves once the server has paused it, and fails if it couldn't. */
  pause(): Promise<void>;
  /** Resumes: the snapshot says so at once. Resolves once the server is recording again, and fails if it couldn't. */
  resume(): Promise<void>;
  appendAudio(piece: AudioPiece): Promise<void>;
  /** Transcribes a few seconds of speech into the live transcript. Only while recording. */
  transcribe(clip: TranscriptClip): Promise<void>;
  /** Stops and hands the audio to the notes service. Resolves with the note being written. */
  stop(): Promise<RecordingStopResult>;
  discard(): Promise<void>;
}

export const NoteProgressSchema = z.object({
  noteId: IDSchema,
  title: z.string(),
  steps: z.array(z.object({ label: z.string(), done: z.boolean() })),
  ready: z.boolean()
});
export type NoteProgress = z.infer<typeof NoteProgressSchema>;
