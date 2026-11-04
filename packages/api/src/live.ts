import { z } from './zod';
import { CaptureStateSchema, type CaptureDevicePart } from './capture';
import type { CallAnswer, CallMoment, CatchUp, CatchUpRange, CatchUpWindow } from './catchup';
import { IDSchema, ISODateSchema, NotesSettingSchema, PersonSchema, SignInProviderSchema, TranscriptLineSchema, type CaptionLanguage } from './types';

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
  /** Everyone but the organizer waits until this is true. */
  hostHere: z.boolean(),
  locked: z.boolean(),
  /** Notes as the call was scheduled: whether they start when it does. */
  notes: NotesSettingSchema,
  /** What's being captured now, without anyone's name; null until the organizer has started the call. */
  capture: CaptureStateSchema.nullable(),
  /** The call is over and nobody has started it again. */
  ended: z.boolean(),
  /**
   * Where the person asking stands, by their session. `invited` (or the organizer): let in without asking, and gets
   * the notes. `asks`: signed in with an account the notes may go to, so letting them in adds them to the invite.
   * `guest`: asks by name and doesn't get the notes (no account, or a demo sign-in on a real organizer's call).
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
export const CallReturnStoredSchema = z.object({ code: z.string().regex(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/), until: z.number() });

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
 * call's group (`group`). Key packages come with the people the organizer's browser may add (`CallMlsGroup.pending`).
 */
export const CallMlsItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('commit'), seq: z.number(), group: z.string(), epoch: z.number(), body: z.string() }),
  z.object({ kind: z.literal('welcome'), seq: z.number(), group: z.string(), epoch: z.number(), body: z.string() }),
  z.object({ kind: z.literal('message'), seq: z.number(), group: z.string(), epoch: z.number(), body: z.string() })
]);
export type CallMlsItem = z.infer<typeof CallMlsItemSchema>;
/** One part of the call's MLS group as this browser keeps it: its epoch, and for the organizer's browser whom to add and take out. */
export const CallMlsGroupSchema = z.object({
  /** `main`, or a breakout room's ID. */
  id: z.string(),
  epoch: z.number(),
  /**
   * For the organizer's browser: who it may add to this group now, whether they need letting in first, and their latest
   * key package (base64url), however long ago it came: someone moving sends theirs before they may be added.
   */
  pending: z.array(z.object({ id: z.string(), admit: z.enum(['auto', 'ask']), keyPackage: z.string() })),
  /** For the organizer's browser: people in this group to take out of it (gone, removed, or sent to another part of the call). */
  departed: z.array(z.string())
});
export type CallMlsGroup = z.infer<typeof CallMlsGroupSchema>;
export const CallMlsSchema = z.object({
  /** A new generation (new MLS groups for every part of the call) starts when the organizer's connection changes. */
  generation: z.number(),
  /** Where this person stands: let in, still waiting to be, or not in the call (turned away, removed, or gone). */
  admission: z.enum(['in', 'waiting', 'denied']),
  /**
   * The connection that commits for every group in this generation: the organizer's, at leaf 0 of each, the only one whose
   * commits count. Kept in one place so another connection could take over committing.
   */
  committer: z.string().nullable(),
  /** The part of the call this person is in now (`main`, or the room they're in or the organizer is visiting): their media and chat use its group. */
  place: z.string(),
  /** The group this person is in, as the API counts the organizer's commits: `main`, a room's ID, or null (none yet, or between two). The organizer is in every group. */
  group: z.string().nullable(),
  /** The groups this browser keeps: the organizer's, every part of the call; anyone else's, the one they're in. */
  groups: z.array(CallMlsGroupSchema),
  /** This person's part of the log: the organizer's from the start of the generation (chat only in its part of the call, from when it got there), anyone else's from their welcome into their group. */
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
    /** Each room open now, and whether the organizer has paused notes in it (CaptureState.room says what that holds). */
    rooms: z.array(BreakoutRoomSchema.extend({ paused: z.boolean() })),
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
  /** People asking to join, for the organizer to let in or turn away; empty for everyone else. */
  waiting: z.array(CallAskerSchema),
  /** The call's MLS group generation; browsers already in the call rejoin when it changes. */
  generation: z.number(),
  /**
   * What's been said while notes were on, transcribed as the call goes: the latest lines, oldest first, from the part
   * of the call you're in now only. What's said in one breakout room never shows in another, or in the main room.
   */
  transcript: z.array(TranscriptLineSchema),
  notices: z.array(CallNoticeSchema),
  /** Only the organizer can turn notes on or off, pause and resume them. */
  isOrganizer: z.boolean(),
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
  /** Where the clip starts within its segment, not counting pauses. */
  startMs: number;
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

/** A piece of recorded audio, as produced by MediaRecorder every few seconds. */
export interface AudioPiece {
  data: Blob;
  /** Segment the piece belongs to (see RecordingProgress.segment). */
  segment: number;
  /** Position within the segment, starting at 0. */
  seq: number;
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
   * or this call went on from another tab or device); failed: this browser's keys fell out of step, and it has to join
   * again.
   */
  status: 'joining' | 'waiting' | 'in' | 'moving' | 'denied' | 'removed' | 'failed';
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

/** Rooms to open: who goes where (invited people, by email), and for how long. */
export interface BreakoutPlan { rooms: { name: string; emails: string[] }[]; minutes: number }

export interface CallSession extends LiveStore<CallState> {
  /** Who you are in the call, and this person's pass for the call's requests. */
  readonly ticket: CallTicket;
  /** The call's encryption as this browser sees it. */
  readonly crypto: LiveStore<CallCrypto>;
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
  /** Organizer only: lets someone who asked into the call (their browser is added to the group). */
  admit(identity: string): Promise<void>;
  /** Organizer only: turns someone away. */
  deny(identity: string): Promise<void>;
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
  /** Organizer only: what this browser can't capture now (no microphone, or no way to record or listen), or none. */
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
  /** Organizer only: puts one participant on everyone's main stage, or nobody (null). */
  setSpotlight(participantId: string | null): void;
  /** Organizer only: splits the invited people into rooms for a while. */
  openRooms(plan: BreakoutPlan): void;
  /** Organizer only: brings everyone back from the rooms now. */
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
  /** Encrypts and stores one piece of the notes recording. */
  appendAudio(piece: AudioPiece): Promise<void>;
  /**
   * Transcribes a few seconds of speech into the live transcript, under whoever said it. The organizer's browser
   * hears everyone it plays, each on their own: `speaker` is the participant ID of the person heard (this browser's
   * own for its microphone). Only while notes are on.
   */
  transcribe(clip: TranscriptClip, speaker: string): Promise<void>;
  /** What was said in `range`, for you alone: decided, proposed, still open and next, each with the moments it comes from. */
  catchUp(range: CatchUpRange): Promise<CatchUp>;
  /** Asks about what was said in `range`, for you alone, with the moments the answer comes from. */
  askSoFar(question: string, range: CatchUpRange): Promise<CallAnswer>;
  /** What you can catch up on: when you came in, your latest time away, and for a guest the stretches they were here. */
  catchUpWindow(): Promise<CatchUpWindow>;
  /** A moment of the live transcript from a catch-up or an answer, with what was said around it. Your access is checked again. */
  moment(lineId: string): Promise<CallMoment>;
  /* The organizer's host controls (refused for anyone else). */
  /** Mutes one of someone's tracks; they unmute themselves. */
  mute(identity: string, trackSid: string): Promise<void>;
  /** Disconnects someone. They can come back with the link unless the call is locked. */
  remove(identity: string): Promise<void>;
  /** While locked, nobody new can join except the organizer. */
  lock(on: boolean): Promise<void>;
  /** Hides a notice on this screen only. */
  dismissNotice(id: string): void;
  /** The organizer leaving ends the call for everyone and returns how it ended; anyone else just leaves (null). */
  leave(): Promise<CallEndResult | null>;
  /** Stops keeping up with the call here, without leaving it: the call ended, or this person is out of it. */
  close(): void;
  /**
   * The page is going away (closed, reloaded or left for another): stops here and tells the server this connection
   * has gone, without waiting for an answer, so nobody waits on it. The organizer's doesn't say so: their reload
   * mustn't end the call, which ends only if they don't come back.
   */
  closing(): void;
}

export const RoomRecordingStateSchema = z.object({
  id: IDSchema,
  noteId: IDSchema,
  title: z.string(),
  startedAt: ISODateSchema,
  /** Seconds recorded, excluding pauses. */
  elapsed: z.number(),
  status: z.enum(['recording', 'paused', 'stopped']),
  recording: RecordingProgressSchema,
  /** What's been said so far, transcribed as the recording goes: the latest lines, oldest first. */
  transcript: z.array(TranscriptLineSchema)
});
export type RoomRecordingState = z.infer<typeof RoomRecordingStateSchema>;

export const RecordingStopResultSchema = z.object({ pendingNoteId: IDSchema, duration: z.number() });
export type RecordingStopResult = z.infer<typeof RecordingStopResultSchema>;

export interface RoomRecording extends LiveStore<RoomRecordingState> {
  rename(title: string): void;
  pause(): void;
  resume(): void;
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
