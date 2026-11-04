/*
 * Pointing at shared screens (docs: Calls and recordings › Pointing at shared screens). Everyone the call lets point can
 * show a pointer with their name on someone's share and leave marks that fade: a ring where they click, a line where they
 * drag. Browsers send these straight to each other as LiveKit data packets on CALL_MARKS_TOPIC, encrypted end to end with
 * each sender's own media key from the call's MLS group: LiveKit forwards ciphertext, and the API never sees them. Nothing
 * is kept anywhere, and nothing reaches anyone's computer but a picture drawn over the share on their screen: no input is
 * ever sent to the presenter's computer.
 *
 * Every place is a fraction of the shared picture's width and height (0 to 1), so a mark lands on the same spot of the
 * picture at whatever size, zoom or screen anyone sees it. A share is named by its picture's LiveKit track ID, which no
 * later share has: a message about a share that stopped finds nothing to land on.
 */
import { z } from './zod';
import { ShareIdSchema } from './wire';

/** The data topic pointers and marks travel on. It's inside the encryption, with everything else in the packet. */
export const CALL_MARKS_TOPIC = 'marks/1' as const;
/** A mark lasts this long once it's made (a line: once it's drawn), fading over the last SHARE_MARK_FADE_MS. */
export const SHARE_MARK_MS = 8000;
export const SHARE_MARK_FADE_MS = 1500;
/** A pointer's place goes out at most this often while it moves: 20 times a second. */
export const SHARE_POINT_EVERY_MS = 50;
/** While someone points without moving, their browser says so this often, so their pointer stays where it is. */
export const SHARE_POINTER_KEEP_MS = 1000;
/** After this long without moving, a pointer is idle: its browser stops sending it, and it goes. */
export const SHARE_POINTER_IDLE_MS = 6000;
/** A pointer nothing has been heard of for this long has gone (its browser went, or the word that it stopped was lost). */
export const SHARE_POINTER_GONE_MS = 2500;
/** A line has at most this many places. */
export const SHARE_MARK_POINTS = 96;
/** Marks one person has on one share at once: making another takes their oldest away. */
export const SHARE_MARKS_EACH = 12;
/** The largest message a browser reads. */
export const SHARE_MARK_BYTES = 8192;

/** A place on a shared picture: how far across and how far down, as fractions of its width and height. */
export const SharePlaceSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
export type SharePlace = z.infer<typeof SharePlaceSchema>;
export const MarkIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,24}$/);
/** Each sender counts its messages, so a message replayed, or overtaken by a newer one, is told apart from a new one. */
const SeqSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const ShareMarkMessageSchema = z.discriminatedUnion('t', [
  /** Where the sender points on a share now. */
  z.object({ t: z.literal('point'), share: ShareIdSchema, seq: SeqSchema, at: SharePlaceSchema }),
  /** The sender stopped pointing at a share: they moved off it, stopped pointing, or went idle. */
  z.object({ t: z.literal('away'), share: ShareIdSchema, seq: SeqSchema }),
  /** A mark as it is now: a ring at one place, or a line through its places, sent again as it's drawn until it's `done`. */
  z.object({
    t: z.literal('mark'), share: ShareIdSchema, seq: SeqSchema, id: MarkIdSchema, kind: z.enum(['ring', 'line']),
    points: z.array(SharePlaceSchema).min(1).max(SHARE_MARK_POINTS), done: z.boolean()
  }),
  /** The sender takes back marks of their own. */
  z.object({ t: z.literal('unmark'), share: ShareIdSchema, seq: SeqSchema, ids: z.array(MarkIdSchema).min(1).max(SHARE_MARKS_EACH) }),
  /** The presenter clears every mark on their own share, whoever made it. */
  z.object({ t: z.literal('clear'), share: ShareIdSchema, seq: SeqSchema })
]);
export type ShareMarkMessage = z.infer<typeof ShareMarkMessageSchema>;
