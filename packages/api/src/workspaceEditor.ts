/*
 * What reaches an open document from other browsers and the clipboard, beside its Yjs updates. A browser can send anything
 * here, so nothing is read until it's parsed with these. Only the shapes: the editor owns what they mean.
 */
import { ISODateSchema } from './types';
import { z } from './zod';

/** Who wrote something, and how much they'd written by then. */
const YjsIdSchema = z.object({ client: z.number().int().nonnegative(), clock: z.number().int().nonnegative() });

/** A place in a document that stays put as others type: a `Y.RelativePosition` as JSON. */
export const DocPlaceSchema = z.object({
  type: YjsIdSchema.nullish(),
  tname: z.string().nullish(),
  item: YjsIdSchema.nullish(),
  assoc: z.number().int().nullish()
});

/**
 * What another browser's awareness state says: where its caret is, who the server says it is, and for a few seconds after
 * they restored a version, which one, so nobody typing is left to wonder why the page changed. `n` tells two restores apart.
 */
export const DocCaretStateSchema = z.object({
  cursor: z.object({ anchor: DocPlaceSchema, head: DocPlaceSchema }).nullish(),
  user: z.object({ id: z.string().nullish(), name: z.string().nullish() }).nullish(),
  restored: z.object({ from: ISODateSchema, n: z.number() }).nullish()
});
export type DocCaretState = z.infer<typeof DocCaretStateSchema>;

/**
 * Which connection to a call an awareness state is on (`CallParticipant.id`), as the server stamps it on every one it passes
 * on, whatever a browser says of itself: how a person's tile finds their pointer on a board. Null outside a call.
 */
export const DocCallerStateSchema = z.object({ user: z.object({ callIdentity: z.string().max(128).nullish() }).nullish() });

/**
 * What another browser's awareness says it's sending into a document: the blocks its uploads are going into. A block that
 * says it's uploading with nobody saying this of it any more was left when its browser went.
 */
export const DocUploadsStateSchema = z.object({ uploading: z.array(z.string().max(64)).max(500).nullish() });

/** A block's attributes, as a copy of it carries them in `data-attrs`. */
export const BlockAttrsSchema = z.record(z.string(), z.unknown());
