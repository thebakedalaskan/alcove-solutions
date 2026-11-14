/*
 * What a call keeps of the documents and boards worked on in it, and its note after it (docs: Calls and recordings › The
 * call's workspace): which workspace and item, what kind, and who changed it, never what it says or anyone's address.
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
