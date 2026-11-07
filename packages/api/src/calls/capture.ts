import { ModelIdSchema } from '../notes/models';
import { CaptureGapSchema } from '../notes/schema';
import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
/**
 * on: being captured. paused: the organizer is holding it until they resume. off: not captured. unavailable: notes
 * are on, but the host's browser can't capture it now (a recorder that can't start, or a browser that can't listen).
 */
export const CaptureModeSchema = z.enum(['on', 'paused', 'off', 'unavailable']);

export type CaptureMode = z.infer<typeof CaptureModeSchema>;

/** Notes are on, whether or not the host's browser can capture right now: asks and the organizer's controls follow it. */
export const notesAreOn = (mode: CaptureMode): boolean => mode === 'on' || mode === 'unavailable';


/** The kinds of capture the host's browser does itself, and so can say it can't do. */
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


/**
 * What's captured in the breakout room you're in (for the organizer, the one it's visiting). A room is never recorded.
 * What's said there is transcribed by its scribe's browser, shown live only to the people there, and goes into the
 * call's notes as the room's own section when the call ends. It captures while the call's notes are on and the
 * organizer hasn't paused the room. Each part says when it last changed and who changed it, the call's changes and the
 * room's together; `gaps` are the stretches since the room opened with nothing captured in it.
 */
export const RoomCaptureSchema = z.object({
  id: IDSchema,
  mode: CaptureModeSchema,
  recording: CapturePartSchema,
  transcript: CapturePartSchema,
  ai: CapturePartSchema,
  screen: CapturePartSchema,
  gaps: z.array(CaptureGapSchema),
  /**
   * The participant ID of the room's scribe: the one browser in the room that hears it and sends what's said for the
   * room's section of the call's notes (an invited person's). Null while nobody in the room can.
   */
  scribe: z.string().nullable().default(null)
});

export type RoomCapture = z.infer<typeof RoomCaptureSchema>;


export const CaptureStateSchema = z.object({
  /**
   * All of it at once: on while notes are on, paused while the organizer holds them, off otherwise, and unavailable
   * when notes are on but the host's browser can neither record nor listen, or is out of the call (`away`).
   */
  mode: CaptureModeSchema,
  /**
   * What the host's browser hears, mixed into one recording: their microphone and everyone in their part of the
   * call, encrypted and kept with the notes. Silent while the organizer visits a breakout room.
   */
  recording: CapturePartSchema,
  /** What everyone the host's browser hears says, turned into text as the call goes by a private speech model. */
  transcript: CapturePartSchema,
  /**
   * The private notes model reading the transcript: the notes when the call ends, and catch-up, questions and captions
   * during it. It stays on while notes are off once they've been on, since what was transcribed is still read; only a
   * pause stops it.
   */
  ai: CapturePartSchema,
  /**
   * Shared screens kept for the notes: on while anyone is sharing a screen they said goes in the notes (each presenter
   * answers for each share, and only while notes are on). Their own browser records the share, encrypted and kept with
   * the call's audio; after the call, frames picked from what was said are read by the chosen vision model. Pauses with
   * notes and stops when they're turned off. Cameras are never recorded.
   */
  screen: CapturePartSchema,
  /**
   * The model the organizer chose for this call's notes, by its ID in `models.list()`. Null means the default model.
   */
  model: ModelIdSchema.nullable(),
  /** Whether that model runs in a secure enclave. */
  modelPrivate: z.boolean(),
  /**
   * Whether the organizer lets shared screens go in these notes (the call's `allowScreens` choice). Without it nobody is
   * asked, and no share is kept.
   */
  allowScreens: z.boolean(),
  /** The stretches with nothing captured, oldest first; the last may still be going. Empty for people asking to join. */
  gaps: z.array(CaptureGapSchema),
  /** Open asks for notes. Empty for people asking to join. */
  requests: z.array(NotesRequestSchema),
  /** Your own latest ask for notes and how it went: still asking, said yes to (notes came on) or said no to. Null if you haven't asked. */
  asked: z.object({ state: z.enum(['asking', 'accepted', 'declined']), at: ISODateSchema }).nullable(),
  /** What's captured in the breakout room you're in, or null in the main room (and for people asking to join). */
  room: RoomCaptureSchema.nullable(),
  /**
   * The host's browser is out of the call right now: its connection dropped, or it's reloading or moving to
   * another device. While notes are on, recording and the transcript are unavailable until it's back, in every part.
   */
  away: z.boolean()
});

export type CaptureState = z.infer<typeof CaptureStateSchema>;
