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
 * nothing in it names anyone or carries anything from a call.
 */
export const CallViewModeSchema = z.enum(['auto', 'speaker', 'grid']);

export type CallViewMode = z.infer<typeof CallViewModeSchema>;

/** Where you see yourself: in the grid with everyone, as a small picture in a corner, or folded away. */
export const SelfViewSchema = z.enum(['grid', 'corner', 'hidden']);

export type SelfView = z.infer<typeof SelfViewSchema>;

export const StageCornerSchema = z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

export type StageCorner = z.infer<typeof StageCornerSchema>;

/** How much of the stage shared screens can take beside the people, and how much they start with. */
export const CALL_SHARE_ROOM = { min: 0.42, max: 0.8, start: 0.66 } as const;

/** How two shares side by side can split their space (the first one's part), and where they start. */
export const CALL_SHARE_SPLIT = { min: 0.25, max: 0.75, start: 0.5 } as const;

/** The most a call's arrangement holds: pins, and the lists kept for the call. The app keeps to them as it writes. */
export const CALL_LAYOUT_MAX = { pins: 6, order: 200, arrived: 400, big: 200, shares: 20 } as const;

/** How someone likes to see every call: remembered for their account in this browser. */
export const CallViewPrefsSchema = z.object({
  mode: CallViewModeSchema,
  /** How much of the stage shared screens take beside the people (CALL_SHARE_ROOM). */
  ratio: z.number().min(CALL_SHARE_ROOM.min).max(CALL_SHARE_ROOM.max),
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
 * call (`CallParticipant.seat`) and shares by their sharer's participant ID: random, and only meaningful in this call.
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
  /**
   * Shares you chose to see big or as a tile, in the order you chose. While any of them is shared, the latest you made
   * big are big (as many as fit) and every other share is a tile; with none, shares follow the layout.
   */
  shares: z.array(z.object({ id: z.string().max(200), show: z.enum(['big', 'tile']) })).max(CALL_LAYOUT_MAX.shares),
  /** Whether the workspace is open, and the document on it, so a reload finds you where you were. */
  workspace: z.object({ open: z.boolean(), document: z.string().max(200).nullable() }).default({ open: false, document: null }),
  /**
   * What your side showed, so a reload finds it as it was: absent until you open or close it in this call, null once you've
   * closed it. Breakout rooms and a presenter's own notes go with the moment, so they're never kept.
   */
  side: CallSideSchema.nullable().optional(),
  /** How the space splits between two shares side by side (CALL_SHARE_SPLIT). */
  split: z.number().min(CALL_SHARE_SPLIT.min).max(CALL_SHARE_SPLIT.max)
});

export type CallLayout = z.infer<typeof CallLayoutSchema>;


/*
 * How someone likes the call's main area: remembered for their account in this browser, so tomorrow's call starts the way
 * they left it. It says where kinds of things go and never names a person, a call or anything said or shared: shares are
 * seats (`share:1`, `share:2`) that whoever shares takes for the length of a share. Your side isn't part of it: it shows one
 * thing at a time, on the right, at a fixed width.
 */
/** Everything that can have a place: the stage, people, each seat for a share, the workspace and the board. */
export const CallPanelLeafIdSchema = z.enum(['stage', 'people', 'ws', 'board', 'share:1', 'share:2']);

export type CallPanelLeafId = z.infer<typeof CallPanelLeafIdSchema>;

/** How you see people while something else is on the stage. */
export const CallPeopleModeSchema = z.enum(['tiles', 'arches', 'hidden']);

export type CallPeopleMode = z.infer<typeof CallPeopleModeSchema>;

export const CALL_PANEL_SIZE_MAX = 100_000;

const PanelSizeSchema = z.number().positive().max(CALL_PANEL_SIZE_MAX);

/** A place in the tree: its share of the room (`flex`), or a size you gave it by dragging (`px` wide, `pxh` tall). */
const PanelPlace = { flex: PanelSizeSchema.optional(), px: PanelSizeSchema.optional(), pxh: PanelSizeSchema.optional() };

const CallPanelLeafSchema = z.object({ id: CallPanelLeafIdSchema, ...PanelPlace });

export type CallPanelLeaf = z.infer<typeof CallPanelLeafSchema>;

export interface CallPanelBranch { dir: 'row' | 'col'; kids: CallPanelNode[]; flex?: number | undefined; px?: number | undefined; pxh?: number | undefined }

export type CallPanelNode = CallPanelLeaf | CallPanelBranch;

/** Rows and columns: a row of panels side by side, a column of them one above the other. Six leaves, so a small tree. */
export const CallPanelNodeSchema: z.ZodType<CallPanelNode> = z.lazy(() => z.union([
  CallPanelLeafSchema,
  z.object({ dir: z.enum(['row', 'col']), kids: z.array(CallPanelNodeSchema).min(1).max(6), ...PanelPlace })
]));

export const CallPanelsSchema = z.object({
  tree: CallPanelNodeSchema,
  people: CallPeopleModeSchema,
  /** Whether the workspace shows its list of documents. */
  list: z.boolean(),
  /** While something is shared, the people and the shares stand as panels of their own rather than share the stage. */
  apart: z.boolean()
});

export type CallPanels = z.infer<typeof CallPanelsSchema>;
