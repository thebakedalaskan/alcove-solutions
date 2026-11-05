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
/** A document or board changed during the call, and by whom. It goes into the note when the call ends, and the call lets go of it. */
export const WorkedDocument = z.object({ workspaceId: z.string(), documentId: z.string(), kind: z.enum(['document', 'board']), by: z.array(WorkedBy) });
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

export const CallSpace = z.object({
  asks: z.array(SpaceAsk).default([]),
  present: z.array(Presenting).default([]),
  play: z.array(Playing).default([]),
  worked: z.array(WorkedDocument).default([]),
  /** This run of the call has its agenda, or has found there's none to make, so nobody opening Workspace looks again. */
  agendaLooked: z.boolean().default(false),
  agendaDraft: AgendaDraft.nullable().default(null)
});
export type CallSpace = z.infer<typeof CallSpace>;
export const NO_SPACE: CallSpace = { asks: [], present: [], play: [], worked: [], agendaLooked: false, agendaDraft: null };

/** Nothing presented or playing is left: the call moved to another workspace. */
export const stopped = (w: CallSpace): CallSpace => ({ ...w, present: [], play: [] });

/** A board open in one part of the call. Only IDs, and who opened it: what it's called and what's on it stay in its workspace. */
const OpenBoard = z.object({ workspaceId: z.string(), documentId: z.string(), by: Controller });
export type OpenBoard = z.infer<typeof OpenBoard>;
/**
 * A board the call lets everyone into, whether it's open or not: a policy, not a list, so anyone let into the call later gets
 * a seat too. `by` is whoever decided that, whose right to share it is asked again each time; null for a board the call made.
 * `seen` is the seats it's been worked out for: nobody is asked about twice, so someone it's been taken back from stays out.
 */
const BoardLetIn = z.object({ workspaceId: z.string(), documentId: z.string(), by: Controller.nullable(), seen: z.array(z.string()) });
export type BoardLetIn = z.infer<typeof BoardLetIn>;
/** What a call keeps about its boards. `open` is by part of the call: `main`, or a room's ID. */
export const CallBoards = z.object({ open: z.record(z.string(), OpenBoard).default({}), letIn: z.array(BoardLetIn).default([]) });
export type CallBoards = z.infer<typeof CallBoards>;
export const NO_BOARDS: CallBoards = { open: {}, letIn: [] };

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
