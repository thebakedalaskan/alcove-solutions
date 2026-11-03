import { z } from 'zod';
import { IDSchema, ISODateSchema, PersonSchema } from './types';

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
  recording: RecordingProgressSchema
});
export type RoomRecordingState = z.infer<typeof RoomRecordingStateSchema>;

export const RecordingStopResultSchema = z.object({ pendingNoteId: IDSchema, duration: z.number() });
export type RecordingStopResult = z.infer<typeof RecordingStopResultSchema>;

export interface RoomRecording extends LiveStore<RoomRecordingState> {
  rename(title: string): void;
  pause(): void;
  resume(): void;
  appendAudio(piece: AudioPiece): Promise<void>;
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
