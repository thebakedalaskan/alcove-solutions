/*
 * What a call keeps about the workspace it uses, in its sealed state (docs: Calls and recordings › The call's workspace).
 * Everything has a default, so a call stored before this release still opens. The rest of it, who may see what and what it
 * does, is modules/callWorkspace.ts: `calls.ts` and `notes.ts` need these shapes as they load, so nothing here imports them.
 */
import { PortraitStyleSchema } from '@alcove/api';
import { z } from 'zod';

/** Someone who changed a document in the call: as a version names them, and never an address. */
const WorkedBy = z.object({ id: z.string(), name: z.string(), portrait: PortraitStyleSchema.optional().catch(undefined) });
export type WorkedBy = z.infer<typeof WorkedBy>;
/**
 * A document or board changed during the call, and by whom, or a board open in it, whether or not anyone changed it. It goes
 * into the note when the call ends, and the call lets go of it. `open` is the part of the call a board was open in for
 * everyone (`main`, or a breakout room's ID): the notes of that part read it. Null for anything only changed from the list,
 * which moves nobody else, and for what a call kept before boards were noted.
 */
export const WorkedDocument = z.object({ workspaceId: z.string(), documentId: z.string(), kind: z.enum(['document', 'board']), by: z.array(WorkedBy), open: z.string().nullable().default(null) });
export type WorkedDocument = z.infer<typeof WorkedDocument>;

/**
 * Whoever started something: as who they are in the call, so it holds across their reconnections, and as what access knows
 * them by (`email`, and `seat`), so it stops if they lose what they started.
 */
const Controller = z.object({ person: z.string(), seat: z.string(), name: z.string(), email: z.string().nullable() });
export type Controller = z.infer<typeof Controller>;
/** What's being presented in one part of the call. `place` is where it started: it's for the people there. */
const Presenting = z.object({ place: z.string(), workspaceId: z.string(), kind: z.enum(['document', 'board']), id: z.string(), section: z.number(), by: Controller });
export type Presenting = z.infer<typeof Presenting>;
/** A video playing in one part of the call. `positionMs` is where it was at `atMs`, on this server's clock. Only IDs: the video stays in its document. */
const Playing = z.object({ place: z.string(), workspaceId: z.string(), documentId: z.string(), mediaId: z.string(), by: Controller, playing: z.boolean(), positionMs: z.number(), atMs: z.number() });
export type Playing = z.infer<typeof Playing>;
/** Someone asking to see the workspace, while they're asking and once they've been told not now. */
const SpaceAsk = z.object({ id: z.string(), person: z.string(), at: z.number(), state: z.enum(['asking', 'declined']) });
export type SpaceAsk = z.infer<typeof SpaceAsk>;

/**
 * The next agenda while it's being made: the document it's made as, so trying again fills the same one, and until when
 * whoever's making it has it, so two people opening Workspace at once don't both make one. Nothing names it until it's filled.
 */
const AgendaDraft = z.object({ workspaceId: z.string(), documentId: z.string(), until: z.number() });
export type AgendaDraft = z.infer<typeof AgendaDraft>;

/**
 * This run of the call's folder in its home: the ID it's made as, taken under the call's row so that everyone opening Workspace
 * at once makes one between them, and whether it's made. Made once: someone deleting it doesn't bring it back.
 */
const CallHome = z.object({ workspaceId: z.string(), folderId: z.string(), made: z.boolean() });
export type CallHome = z.infer<typeof CallHome>;

export const CallSpace = z.object({
  asks: z.array(SpaceAsk).default([]),
  present: z.array(Presenting).default([]),
  play: z.array(Playing).default([]),
  worked: z.array(WorkedDocument).default([]),
  /** This run of the call has its agenda, or has found there's none to make, so nobody opening Workspace looks again. */
  agendaLooked: z.boolean().default(false),
  agendaDraft: AgendaDraft.nullable().default(null),
  /** The workspace everyone views, when the organizer switched from the home: the home's on the meeting. */
  viewing: z.string().nullable().default(null),
  home: CallHome.nullable().default(null),
  /** The workspaces made in this run of the call (New workspace), the latest last: who's in them follows its invite while it's on. */
  made: z.array(z.string()).default([])
});
export type CallSpace = z.infer<typeof CallSpace>;
export const NO_SPACE: CallSpace = { asks: [], present: [], play: [], worked: [], agendaLooked: false, agendaDraft: null, viewing: null, home: null, made: [] };

/** Nothing presented or playing is left: everyone views another workspace. */
export const stopped = (w: CallSpace): CallSpace => ({ ...w, present: [], play: [] });

/** A timer on a board, the same for everyone where it's open: when it runs out, in seconds since the call started, and how long it was set for, in seconds. */
const BoardTimer = z.object({ until: z.number(), length: z.number(), by: Controller });
export type BoardTimer = z.infer<typeof BoardTimer>;
/**
 * A vote on a board, on one of its frames or with none on every sticky. Each person's votes are kept by who they are to it:
 * their account when they're signed in, so it's one set of votes on every device, else the person they are in the call, which
 * holds across their reconnections. Only IDs: which stickies, never what they say. Until it's `ended` they go to nobody but
 * that person. `id` tells one vote from the next, so a vote checked against one is never counted in another.
 */
const BoardVote = z.object({
  id: z.string(), frame: z.string().nullable(), per: z.number(), by: Controller, ballots: z.record(z.string(), z.array(z.string())), ended: z.boolean()
});
export type BoardVote = z.infer<typeof BoardVote>;
/**
 * A board open in one part of the call: where it is, who opened it, and its timer and vote, which are this session's and end
 * when it closes. What it's called and what's on it stay in its workspace.
 */
const OpenBoard = z.object({
  workspaceId: z.string(), documentId: z.string(), by: Controller,
  timer: BoardTimer.nullable().default(null),
  vote: BoardVote.nullable().default(null)
});
export type OpenBoard = z.infer<typeof OpenBoard>;
/**
 * A board the call lets everyone into, whether it's open or not: a policy, not a list, so anyone let into the call later gets
 * a seat too. `by` is whoever decided that, whose right to share it is asked again each time; null for a board the call made,
 * which is the call's to give while it isn't restricted and the organizer can edit there. `seen` is the seats it's been worked
 * out for, and on a board the call made the addresses it went to: nobody is asked about twice, so someone it's been taken back
 * from stays out.
 */
const BoardLetIn = z.object({ workspaceId: z.string(), documentId: z.string(), by: Controller.nullable(), seen: z.array(z.string()) });
export type BoardLetIn = z.infer<typeof BoardLetIn>;
/** What a line an idea was picked from says about who may read it, which is all an idea keeps of it. */
const Seen = z.object({ when: z.number().optional(), readers: z.array(z.string()).optional() });
/**
 * An idea from the call, until it's added to the board or put aside: what it says, and `words`, what was said. `speaker` is
 * the participant ID of whoever said it and `when` the moment, in ms; `seen` is every line the run it came from read, so only
 * someone who may read all of them is shown it. `frame` is the frame on the board it fits, by its ID there.
 */
const StoredIdea = z.object({
  id: z.string(), text: z.string(), words: z.string(), speaker: z.string().optional(), when: z.number().optional(), frame: z.string().nullable(), seen: z.array(Seen)
});
export type StoredIdea = z.infer<typeof StoredIdea>;
/**
 * A part of the call's ideas: when they were last looked for and what that read (a digest of the lines), a run holding the
 * look until `running` (ms) while the notes model reads, and what's offered now.
 */
const PlaceIdeas = z.object({ at: z.number(), heard: z.string(), running: z.number().nullable().default(null), list: z.array(StoredIdea).default([]) });
export type PlaceIdeas = z.infer<typeof PlaceIdeas>;
/**
 * A board made for a breakout room, or started in one: which room it's for, and whether everyone invited has it by address yet
 * (`kept`), which they get once its room has closed, so it's theirs like any saved board. Until then only the seats of whoever's
 * in its room open it: it's restricted, with nobody as its creator.
 */
const RoomBoard = z.object({ workspaceId: z.string(), documentId: z.string(), room: z.string(), kept: z.boolean() });
export type RoomBoard = z.infer<typeof RoomBoard>;
/**
 * Rooms' boards coming back to the main room, from the moment rooms close until they've landed: each one, named for its room
 * with who was there; the board they land on, which is the one open in the main room, or with `make` one to make for them, its
 * id taken under the call's row so that it's made once; and until when (ms) whoever's landing them has it, so two never do at
 * once. Landing again changes nothing (`landBoards`), so one cut short is done again from the start.
 */
const Landing = z.object({
  rooms: z.array(z.object({ room: z.string(), workspaceId: z.string(), documentId: z.string(), name: z.string(), who: z.array(z.string()) })),
  into: z.object({ workspaceId: z.string(), documentId: z.string() }),
  make: z.boolean(),
  until: z.number()
});
export type Landing = z.infer<typeof Landing>;
/**
 * What a call keeps about its boards. `open` and `ideas` are by part of the call: `main`, or a room's ID. `rooms` is every board
 * made for a room in it, and `landing` what's coming back from rooms that have closed. Each is empty in a call stored before it
 * had them.
 */
export const CallBoards = z.object({
  open: z.record(z.string(), OpenBoard).default({}),
  letIn: z.array(BoardLetIn).default([]),
  rooms: z.array(RoomBoard).default([]),
  landing: Landing.nullable().default(null),
  ideas: z.record(z.string(), PlaceIdeas).default({})
});
export type CallBoards = z.infer<typeof CallBoards>;
export const NO_BOARDS: CallBoards = { open: {}, letIn: [], rooms: [], landing: null, ideas: {} };

/** How many documents a call remembers working on, and how many people on each: its sealed state is read on every request. */
const MAX_WORKED = 100;
const MAX_WORKED_BY = 50;
/** The same, with someone having changed a document. Undefined when that's known already, or there's no room for it. */
export function withWorked(w: CallSpace, entry: Omit<WorkedDocument, 'by'>, by: WorkedBy): CallSpace | undefined {
  const same = (x: WorkedDocument) => x.workspaceId === entry.workspaceId && x.documentId === entry.documentId;
  const there = w.worked.find(same);
  if (!there) return w.worked.length >= MAX_WORKED ? undefined : { ...w, worked: [...w.worked, { ...entry, by: [by] }] };
  if (there.by.some((x) => x.id === by.id) || there.by.length >= MAX_WORKED_BY) return undefined;
  return { ...w, worked: w.worked.map((x) => (same(x) ? { ...x, by: [...x.by, by] } : x)) };
}
