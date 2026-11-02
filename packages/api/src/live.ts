import { z } from 'zod';
import { ActionItemSchema, IDSchema, NotesAudienceSchema, NotesKeepSchema, PersonSchema, ScreenCaptureSchema, TranscriptLineSchema, type NotesKeep } from './types';

/* Live sessions push whole snapshots. Subscribers re-render from the snapshot; nothing is patched in the UI. */

export type Unsubscribe = () => void;

export interface LiveStore<S> {
  getSnapshot(): S;
  subscribe(listener: () => void): Unsubscribe;
}

export const CallParticipantSchema = z.object({
  id: IDSchema, person: PersonSchema, isMe: z.boolean(), isHost: z.boolean(), isGuest: z.boolean(),
  mic: z.boolean(), cam: z.boolean(), hand: z.boolean(), speaking: z.boolean()
});
export type CallParticipant = z.infer<typeof CallParticipantSchema>;

export const ChatMessageSchema = z.object({
  id: IDSchema, from: PersonSchema, isMe: z.boolean(), text: z.string(),
  /** Seconds since the call started. */
  at: z.number()
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const CallNotesStatusSchema = z.enum(['off', 'on', 'paused']);
export type CallNotesStatus = z.infer<typeof CallNotesStatusSchema>;

export const CallNoticeSchema = z.object({
  id: IDSchema,
  /** Plain sentence shown to everyone, e.g. "Ben turned on notes." */
  text: z.string(),
  kind: z.enum(['notes', 'people', 'info'])
});
export type CallNotice = z.infer<typeof CallNoticeSchema>;

/** A line in the live feed: something said, or something shown on a shared screen. */
export const LiveLineSchema = z.discriminatedUnion('kind', [
  TranscriptLineSchema.extend({ kind: z.literal('speech') }),
  ScreenCaptureSchema.extend({ id: IDSchema, kind: z.literal('screen') })
]);
export type LiveLine = z.infer<typeof LiveLineSchema>;

export const CallStateSchema = z.object({
  callId: IDSchema,
  code: z.string(),
  title: z.string(),
  /** Seconds since the call started. */
  elapsed: z.number(),
  phase: z.enum(['joining', 'waiting-room', 'in-call', 'ended']),
  participants: z.array(CallParticipantSchema),
  sharing: z.object({ by: IDSchema, title: z.string() }).nullable(),
  notes: z.object({
    status: CallNotesStatusSchema,
    mode: NotesKeepSchema,
    audience: NotesAudienceSchema,
    /** True once notes have been on at any point, so something will be written at the end. */
    everOn: z.boolean()
  }),
  transcript: z.array(LiveLineSchema),
  live: z.object({ summary: z.string().nullable(), decisions: z.array(z.string()), actions: z.array(ActionItemSchema.pick({ id: true, text: true })) }),
  chat: z.array(ChatMessageSchema),
  notices: z.array(CallNoticeSchema),
  canControlNotes: z.boolean()
});
export type CallState = z.infer<typeof CallStateSchema>;

export const CallEndResultSchema = z.object({
  meetingId: IDSchema,
  /** Present when notes were on at some point; the notes are being written. */
  pendingNoteId: IDSchema.nullable(),
  duration: z.number()
});
export type CallEndResult = z.infer<typeof CallEndResultSchema>;

export interface CallSession extends LiveStore<CallState> {
  setMic(on: boolean): void;
  setCam(on: boolean): void;
  setHand(up: boolean): void;
  setSharing(on: boolean): void;
  sendChat(text: string): void;
  startNotes(mode: NotesKeep): void;
  pauseNotes(): void;
  resumeNotes(): void;
  stopNotes(): void;
  invite(email: string): Promise<void>;
  dismissNotice(id: string): void;
  leave(): Promise<CallEndResult>;
}

export const RoomRecordingStateSchema = z.object({
  id: IDSchema,
  title: z.string(),
  elapsed: z.number(),
  status: z.enum(['recording', 'paused', 'stopped']),
  /** 0..1 input level, sampled ~10 times a second. */
  level: z.number(),
  transcript: z.array(TranscriptLineSchema)
});
export type RoomRecordingState = z.infer<typeof RoomRecordingStateSchema>;

export const RecordingStopResultSchema = z.object({ pendingNoteId: IDSchema, duration: z.number() });
export type RecordingStopResult = z.infer<typeof RecordingStopResultSchema>;

export interface RoomRecording extends LiveStore<RoomRecordingState> {
  rename(title: string): void;
  pause(): void;
  resume(): void;
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
