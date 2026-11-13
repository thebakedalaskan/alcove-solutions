/*
 * Getting a call ready before it starts, from its page: its organizer, or someone invited, adds an agenda, a board, or a
 * document to upload files into. The call's home is settled (docs: Calls and recordings › The call's home), and what's made
 * in it is brought to the call, so it opens for everyone invited before the call and in it.
 */
import { isTimeZone } from '../../meetings/schema';
import { IDSchema } from '../../shared/ids';
import { z } from '../../shared/zod';
import { ItemInputSchema } from '../../workspaces/schema';

/** What to make in the call's home: an agenda (a document), a board, or a document for files being uploaded. */
export const CallAheadMakeSchema = z.enum(['agenda', 'board', 'file']);

export type CallAheadMake = z.infer<typeof CallAheadMakeSchema>;

/**
 * `name`: what a document for files is called, from the file when there's one (the others are named for what they are).
 * `timeZone`, where the browser is: the day a new home is named after.
 */
export const CallAheadBodySchema = z.object({
  make: CallAheadMakeSchema, name: ItemInputSchema.shape.name, timeZone: z.string().min(1).max(64).refine(isTimeZone, 'Not a time zone.').optional()
});

export type CallAheadBody = z.infer<typeof CallAheadBodySchema>;

/** The call's home, and what was made in it, for whoever asked to open it there. */
export const CallAheadHomeSchema = z.object({ workspaceId: IDSchema, itemId: IDSchema });

export type CallAheadHome = z.infer<typeof CallAheadHomeSchema>;
