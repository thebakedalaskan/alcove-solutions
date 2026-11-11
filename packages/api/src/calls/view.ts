import { z } from '../shared/zod';
/**
 * How loud each person in a call is for one listener: their own playback only, never what the person sends, what's
 * recorded or transcribed, or anyone else's. Kept in that browser tab for that call only, by the random identity
 * each connection has in the call (never a name or an address), from 0 (muted for you) to 1 (as they arrive).
 */
export const CallVolumesSchema = z.object({
  callId: z.string().max(200),
  levels: z.record(z.string().max(200), z.number().min(0).max(1)).refine((l) => Object.keys(l).length <= 200, 'too many people')
});

export type CallVolumes = z.infer<typeof CallVolumesSchema>;


/*
 * How someone arranges a call on their own screen. Kept in their browser only: nobody else's view changes, and
 * nothing in it names anyone or carries anything from a call. The stage lays itself out; what's kept is what they
 * moved, sized and pinned, and where they see themselves.
 */
/** Where you see yourself: in the grid with everyone, as a small picture in a corner, or folded away. */
export const SelfViewSchema = z.enum(['grid', 'corner', 'hidden']);

export type SelfView = z.infer<typeof SelfViewSchema>;

export const StageCornerSchema = z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

export type StageCorner = z.infer<typeof StageCornerSchema>;

/** The most a call's arrangement holds: pins, and the lists kept for the call. The app keeps to them as it writes. */
export const CALL_LAYOUT_MAX = { pins: 6, order: 200, arrived: 400, big: 200 } as const;

/**
 * How someone likes to see every call: remembered for their account in this browser. A browser that kept a layout mode
 * (`mode`: Auto, Speaker or Grid) from before the stage laid itself out keeps where its owner sees themselves; the mode
 * is dropped as it's read, and goes for good the next time this is saved.
 */
export const CallViewPrefsSchema = z.object({
  self: SelfViewSchema,
  /** The corner your own picture sits in. */
  corner: StageCornerSchema
});

export type CallViewPrefs = z.infer<typeof CallViewPrefsSchema>;

/** What your side can show that a reload brings back: the call's notes, its chat, or who's here. */
export const CallSideSchema = z.enum(['notes', 'chat', 'people']);

export type CallSide = z.infer<typeof CallSideSchema>;

/**
 * How someone arranged one call: kept in that tab until they leave the call. People are named by their seat in the
 * call (`CallParticipant.seat`): random, and only meaningful in this call.
 */
export const CallLayoutSchema = z.object({
  /** Seats pinned, in the order they were pinned. Someone pinned who leaves stays pinned for when they come back. */
  pins: z.array(z.string().max(200)).max(CALL_LAYOUT_MAX.pins),
  /** Seats in the order you arranged them. Anyone else follows in the order they first came in. */
  order: z.array(z.string().max(200)).max(CALL_LAYOUT_MAX.order),
  /** Seats in the order they first came into the call, so someone coming back keeps their place. */
  arrived: z.array(z.string().max(200)).max(CALL_LAYOUT_MAX.arrived),
  /** Seats you made bigger. */
  big: z.array(z.string().max(200)).max(CALL_LAYOUT_MAX.big),
  /** Whether the workspace is open, and the document on it, so a reload finds you where you were. */
  workspace: z.object({ open: z.boolean(), document: z.string().max(200).nullable() }).default({ open: false, document: null }),
  /**
   * What your side showed, so a reload finds it as it was: absent until you open or close it in this call, null once you've
   * closed it. Breakout rooms and a presenter's own notes go with the moment, so they're never kept.
   */
  side: CallSideSchema.nullable().optional()
});

export type CallLayout = z.infer<typeof CallLayoutSchema>;


/*
 * How someone likes the people beside what's open on their stage: remembered for their account in this browser, so
 * tomorrow's call starts the way they left this one. It names nobody, and says nothing about what's open.
 */
/**
 * The people while something is open on your stage, at the window's right edge: a column of tiles, or made smaller (⇧P) a
 * rail of arches, kept as `hidden`, the name it has always been stored under. A narrow stage has a row of arches either way.
 */
export const CallPeopleModeSchema = z.enum(['tiles', 'hidden']);

export type CallPeopleMode = z.infer<typeof CallPeopleModeSchema>;

export const CallPanelsSchema = z.object({
  /** Arches, once a choice of their own, are what a narrow stage gives anyway: a browser that kept them has the people beside what's open again. */
  people: z.preprocess((v) => (v === 'arches' ? 'tiles' : v), CallPeopleModeSchema).default('tiles'),
  /** Whether the workspace shows its list of documents. */
  list: z.boolean().default(true)
});

export type CallPanels = z.infer<typeof CallPanelsSchema>;
