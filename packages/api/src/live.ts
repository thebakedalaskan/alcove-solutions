import { z } from 'zod';
import { IDSchema, ISODateSchema, PersonSchema, TranscriptLineSchema, type AnswerPart } from './types';

/* Live sessions push whole snapshots. Subscribers re-render from the snapshot; nothing is patched in the UI. */

export type Unsubscribe = () => void;

export interface LiveStore<S> {
  getSnapshot(): S;
  subscribe(listener: () => void): Unsubscribe;
}

export const CallParticipantSchema = z.object({
  id: IDSchema, person: PersonSchema, isMe: z.boolean(), isOrganizer: z.boolean(),
  mic: z.boolean(), cam: z.boolean(), hand: z.boolean()
});
export type CallParticipant = z.infer<typeof CallParticipantSchema>;

export const ChatMessageSchema = z.object({
  id: IDSchema, from: PersonSchema, isMe: z.boolean(), text: z.string(),
  /** Seconds since the call started. */
  at: z.number()
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

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
  sharing: z.object({ title: z.string() }).nullable(),
  notes: z.object({
    status: CallNotesStatusSchema,
    /** True once notes have been on at any point, so the call produces a note. */
    everOn: z.boolean(),
    noteId: IDSchema.nullable(),
    recording: RecordingProgressSchema
  }),
  chat: z.array(ChatMessageSchema),
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

/** One thing a catch-up points out, and when it was said (seconds into the recording, as transcript lines count). */
export const CatchUpItemSchema = z.object({ text: z.string(), at: z.number().optional() });
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

export interface CallSession extends LiveStore<CallState> {
  setMic(on: boolean): void;
  setCam(on: boolean): void;
  setHand(up: boolean): void;
  setSharing(on: boolean, title?: string): void;
  sendChat(text: string): void;
  /** Organizer only. Everyone in the call sees the change. */
  setNotes(on: boolean): void;
  /** Encrypts and stores one piece of the notes recording. */
  appendAudio(piece: AudioPiece): Promise<void>;
  /** Transcribes a few seconds of speech into the live transcript. Only while notes are on. */
  transcribe(clip: TranscriptClip): Promise<void>;
  /** What's happened so far, for you alone: the last `minutes`, or the whole call. */
  catchUp(minutes?: number | undefined): Promise<CatchUp>;
  /** Asks about the call so far, for you alone, with the moments the answer comes from. */
  askSoFar(question: string): Promise<AnswerPart[]>;
  dismissNotice(id: string): void;
  leave(): Promise<CallEndResult>;
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
