/*
 * What Alcove captures in a call (docs: Calls and recordings › What's captured). One state for the whole call, the
 * same for everyone in it and, without names, for anyone asking to join: what each kind of capture is doing, who
 * changed it and when, the stretches with nothing captured, and who asked for notes. While notes are on, what
 * everyone says goes to the notes, through the organizer's browser. The organizer turns notes on and off, and
 * pauses and resumes all of it; the server refuses whatever arrives while it isn't on.
 */
import { z } from './zod';
import { CaptureGapSchema, IDSchema, ISODateSchema } from './types';

/**
 * on: being captured. paused: the organizer is holding it until they resume. off: not captured. unavailable: notes
 * are on, but the organizer's browser can't capture it now (a recorder that can't start, or a browser that can't listen).
 */
export const CaptureModeSchema = z.enum(['on', 'paused', 'off', 'unavailable']);
export type CaptureMode = z.infer<typeof CaptureModeSchema>;
/** Notes are on, whether or not the organizer's browser can capture right now: asks and the organizer's controls follow it. */
export const notesAreOn = (mode: CaptureMode): boolean => mode === 'on' || mode === 'unavailable';

/** The kinds of capture the organizer's browser does itself, and so can say it can't do. */
export const CaptureDevicePartSchema = z.enum(['recording', 'transcript']);
export type CaptureDevicePart = z.infer<typeof CaptureDevicePartSchema>;

/**
 * Who changed a kind of capture last: the call as it was scheduled (notes on from the start), or the organizer
 * during it. `name` is the organizer's, for the people in the call; people asking to join aren't told names.
 */
export const CaptureActorSchema = z.object({ kind: z.enum(['schedule', 'organizer']), name: z.string().optional() });
export type CaptureActor = z.infer<typeof CaptureActorSchema>;

/** One kind of capture: what it's doing, since when, and who made it so. Both are null while it has been off since the call started. */
export const CapturePartSchema = z.object({ mode: CaptureModeSchema, since: ISODateSchema.nullable(), by: CaptureActorSchema.nullable() });
export type CapturePart = z.infer<typeof CapturePartSchema>;

/** Someone in the call asking the organizer for notes while they're off or paused. Everyone in the call sees it, like a raised hand. */
export const NotesRequestSchema = z.object({ id: IDSchema, participantId: z.string(), at: ISODateSchema });
export type NotesRequest = z.infer<typeof NotesRequestSchema>;

export const CaptureStateSchema = z.object({
  /**
   * All of it at once: on while notes are on, paused while the organizer holds them, off otherwise, and unavailable
   * when notes are on but the organizer's browser can neither record nor listen.
   */
  mode: CaptureModeSchema,
  /**
   * What the organizer's browser hears, mixed into one recording: their microphone and everyone in their part of the
   * call, encrypted and kept with the notes. Silent while the organizer visits a breakout room: room talk stays out.
   */
  recording: CapturePartSchema,
  /** What everyone the organizer's browser hears says, turned into text as the call goes by a private speech model. */
  transcript: CapturePartSchema,
  /**
   * The private notes model reading the transcript: the notes when the call ends, and catch-up, questions and captions
   * during it. It stays on while notes are off once they've been on, since what was transcribed is still read; only a
   * pause stops it.
   */
  ai: CapturePartSchema,
  /**
   * Shared screens read for the notes: each presenter's own browser sends frames of their share when it changes, and
   * the private notes model reads them. Off until the organizer turns it on; it runs only while notes are on, pauses
   * with them, and stops when they're turned off, or once the notes have kept as many frames as they can for the call.
   * Cameras are never read.
   */
  screen: CapturePartSchema,
  /** The stretches with nothing captured, oldest first; the last may still be going. Empty for people asking to join. */
  gaps: z.array(CaptureGapSchema),
  /** Open asks for notes. Empty for people asking to join. */
  requests: z.array(NotesRequestSchema),
  /** Your own latest ask for notes and how it went: still asking, said yes to (notes came on) or said no to. Null if you haven't asked. */
  asked: z.object({ state: z.enum(['asking', 'accepted', 'declined']), at: ISODateSchema }).nullable()
});
export type CaptureState = z.infer<typeof CaptureStateSchema>;
