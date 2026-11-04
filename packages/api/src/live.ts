import { z } from './zod';
import { IDSchema, ISODateSchema, PersonSchema, TranscriptLineSchema, type AnswerPart, type CaptionLanguage } from './types';

/* Live sessions push whole snapshots. Subscribers re-render from the snapshot; nothing is patched in the UI. */

export type Unsubscribe = () => void;

export interface LiveStore<S> {
  getSnapshot(): S;
  subscribe(listener: () => void): Unsubscribe;
}

/* ---------- group calls: who's in the call comes from the API; mic, camera and screen are LiveKit's tracks ---------- */

/** The organizer hosts. Invited people join with their accounts; anyone else with the link joins by name. */
export const CallRoleSchema = z.enum(['host', 'invited', 'guest']);
export type CallRole = z.infer<typeof CallRoleSchema>;

/** What anyone with a call's link sees before joining. No account needed. */
export const CallCardSchema = z.object({
  title: z.string(),
  organizerName: z.string(),
  /** Everyone but the organizer waits until this is true. */
  hostHere: z.boolean(),
  locked: z.boolean()
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

/** A LiveKit join token, for someone who's been let in. It only lasts until the browser connects; it carries no name. */
export const CallRoomTokenSchema = z.object({ token: z.string() });

/**
 * The call's MLS log as this person may see it (docs: Calls and recordings › End-to-end encryption). Bodies
 * are MLS messages, base64url: key packages from people asking to join (for the organizer's browser), the
 * organizer's commits, a welcome for whoever was added, and chat.
 */
export const CallMlsItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('keypackage'), seq: z.number(), from: z.string(), body: z.string() }),
  z.object({ kind: z.literal('commit'), seq: z.number(), epoch: z.number(), body: z.string() }),
  z.object({ kind: z.literal('welcome'), seq: z.number(), epoch: z.number(), body: z.string() }),
  z.object({ kind: z.literal('message'), seq: z.number(), epoch: z.number(), body: z.string() })
]);
export type CallMlsItem = z.infer<typeof CallMlsItemSchema>;
export const CallMlsSchema = z.object({
  /** A new generation (a new MLS group) starts when the organizer's connection changes. */
  generation: z.number(),
  epoch: z.number(),
  /** Where this person stands: let in, still waiting to be, or not in the call (turned away, removed, or gone). */
  admission: z.enum(['in', 'waiting', 'denied']),
  /** The organizer's connection in this generation: the group's leaf 0, the only one whose commits count. */
  organizer: z.string().nullable(),
  /** This person's part of the log: the organizer's from the start of the generation, anyone else's from their welcome. */
  items: z.array(CallMlsItemSchema),
  /** For the organizer's browser: people who left or were removed but are still in the group, to take out of it. */
  departed: z.array(z.string()),
  /** For the organizer's browser: whose key packages it may act on now (asking, or coming back), and whether they need letting in. */
  pending: z.array(z.object({ id: z.string(), admit: z.enum(['auto', 'ask']) })),
  /** Whether there was chat before this person was let in, which their browser can't read. */
  earlierChat: z.boolean(),
  /** Let in before the organizer's connection changed: this browser should send a fresh key package for the new group. */
  rejoin: z.boolean(),
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
   * The same for every connection someone makes to this call (a reload, another device for the organizer), so each
   * viewer's own layout keeps them where they were. Random, and different in every call: it says nothing about who
   * they are.
   */
  seat: z.string(),
  person: PersonSchema, isMe: z.boolean(), isOrganizer: z.boolean(),
  /** A raised hand, which everyone sees. (Mic, camera and screen are LiveKit's tracks, not the server's.) */
  hand: z.boolean()
});
export type CallParticipant = z.infer<typeof CallParticipantSchema>;

/** Someone asking to be let in. Only the organizer sees them. */
export const CallAskerSchema = z.object({ id: z.string(), person: PersonSchema });
export type CallAsker = z.infer<typeof CallAskerSchema>;

export const CallNotesStatusSchema = z.enum(['off', 'on']);
export type CallNotesStatus = z.infer<typeof CallNotesStatusSchema>;

export const CallNoticeSchema = z.object({
  id: IDSchema,
  /** Plain sentence shown to everyone, e.g. "You turned on notes." */
  text: z.string(),
  kind: z.enum(['notes', 'people', 'info'])
});
export type CallNotice = z.infer<typeof CallNoticeSchema>;

/** Encrypted audio stored so far for the call's notes. */
export const RecordingProgressSchema = z.object({
  /** Current segment; a new one starts each time notes are turned on again. */
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
   * while visiting it. Browsers keep each room's media to the people in it.
   */
  members: z.array(z.string())
});
export type BreakoutRoom = z.infer<typeof BreakoutRoomSchema>;
export const BreakoutsSchema = z.object({
  /** Rooms that are open now, or null. Times are seconds since the call started. */
  open: z.object({
    rooms: z.array(BreakoutRoomSchema),
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
  /** The participant the organizer put on everyone's main stage, or null. */
  spotlight: IDSchema.nullable(),
  breakouts: BreakoutsSchema,
  notes: z.object({
    status: CallNotesStatusSchema,
    /** True once notes have been on at any point, so the call produces a note. */
    everOn: z.boolean(),
    noteId: IDSchema.nullable(),
    recording: RecordingProgressSchema
  }),
  /** People asking to join, for the organizer to let in or turn away; empty for everyone else. */
  waiting: z.array(CallAskerSchema),
  /** The call's MLS group generation; browsers already in the call rejoin when it changes. */
  generation: z.number(),
  /** What's been said while notes were on, transcribed as the call goes: the latest lines, oldest first. */
  transcript: z.array(TranscriptLineSchema),
  notices: z.array(CallNoticeSchema),
  /** Only the organizer can turn notes on or off. */
  isOrganizer: z.boolean()
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
}

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
 * One thing a catch-up points out, and when it was said (seconds into the recording, as transcript
 * lines count). Something to do also says who it's for and when it's due, when the call said so.
 */
export const CatchUpItemSchema = z.object({ text: z.string(), at: z.number().optional(), owner: z.string().optional(), due: z.string().optional() });
export type CatchUpItem = z.infer<typeof CatchUpItemSchema>;

/**
 * What's happened in a call so far, from its live transcript, for the person who asked: nobody else
 * sees it, and it isn't kept. Only what was said while notes were on can be in it.
 */
export const CatchUpSchema = z.object({
  /** A sentence or two on where the conversation is; empty when nothing was said in the stretch. */
  summary: z.string(),
  /** Agreed or settled. */
  decided: z.array(CatchUpItemSchema),
  /** Suggested, and not agreed yet. */
  proposed: z.array(CatchUpItemSchema),
  /** Asked, and not answered yet. */
  open: z.array(CatchUpItemSchema),
  /** What someone said they, or someone else, would do. */
  next: z.array(CatchUpItemSchema),
  /** The stretch it read, in seconds into the recording. */
  from: z.number(), through: z.number(),
  /** How many lines of transcript that was. */
  lines: z.number(),
  /** When notes were off, as seconds since the call started: nothing said then is in here. */
  gaps: z.array(z.object({ from: z.number(), to: z.number() })),
  /** When it was put together, as seconds since the call started. */
  asOf: z.number()
});
export type CatchUp = z.infer<typeof CatchUpSchema>;

/** A chat message, decrypted in this browser. `from` is the sender's identity, as MLS vouches for it. */
export interface CallChatMessage { id: string; from: string; isMe: boolean; text: string; at: number }

/** The longest chat message in a call, in characters. */
export const CALL_CHAT_MAX = 4000;
/** How many keys LiveKit's frame encryption keeps per sender (its key index is one byte); media key indices are below it. */
export const CALL_KEYRING = 256;

/**
 * The media keys for LiveKit's frame encryption, from the call's MLS group: one per sender per epoch (a key
 * encrypts only its sender's frames, as SFrame requires), at a key-ring index for that epoch. New ones with
 * every join and leave, and every few minutes besides.
 */
export interface CallMediaKeys {
  /** The latest few epochs, oldest first: everyone's keys, by identity, to decrypt their frames with. */
  epochs: { index: number; keys: Record<string, Uint8Array> }[];
  /**
   * This browser's own key to encrypt with. For a moment after the keys move on it's still the previous
   * epoch's, so everyone has the new keys before anyone sends with them.
   */
  send: { index: number; key: Uint8Array };
}

/**
 * This browser's side of the call's end-to-end encryption: the MLS group it's in and what that gives it.
 * Nothing here ever leaves the browser.
 */
export interface CallCrypto {
  /**
   * joining: making keys, or getting back in; waiting: asked to be let in; in: in the group; denied: turned
   * away; removed: no longer in the call (removed, or this call went on from another tab or device); failed:
   * this browser's keys fell out of step, and it has to join again.
   */
  status: 'joining' | 'waiting' | 'in' | 'denied' | 'removed' | 'failed';
  /** Who's in the group (LiveKit identities), from MLS itself, not from the server. */
  members: string[];
  media: CallMediaKeys | null;
  chat: CallChatMessage[];
  /** True once there was chat from before this browser was in the group, which it can't read. */
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
  /** Encrypted in this browser for everyone in the call's group. Nobody who joins later can read it. */
  sendChat(text: string): Promise<void>;
  /** Organizer only: lets someone who asked into the call (their browser is added to the group). */
  admit(identity: string): Promise<void>;
  /** Organizer only: turns someone away. */
  deny(identity: string): Promise<void>;
  /** Organizer only. Everyone in the call sees the change. */
  setNotes(on: boolean): void;
  /** Raises or lowers your hand; everyone in the call sees it. */
  setHand(up: boolean): void;
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
  /** Live transcript lines in `language`, for you alone. Each line is translated once and kept sealed until the call ends. */
  translate(lineIds: string[], language: CaptionLanguage): Promise<CaptionTranslation[]>;
  /** Encrypts and stores one piece of the notes recording. */
  appendAudio(piece: AudioPiece): Promise<void>;
  /** Transcribes a few seconds of speech into the live transcript. Only while notes are on. */
  transcribe(clip: TranscriptClip): Promise<void>;
  /** What's happened so far, for you alone: the last `minutes`, or the whole call. */
  catchUp(minutes?: number | undefined): Promise<CatchUp>;
  /** Asks about the call so far, for you alone, with the moments the answer comes from. */
  askSoFar(question: string): Promise<AnswerPart[]>;
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
