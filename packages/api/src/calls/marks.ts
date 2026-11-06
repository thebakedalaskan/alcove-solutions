import { z } from '../shared/zod';
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


/**
 * A picture of someone's share put on the board (`Put on the board`), told to whoever's screen it is, so nobody's screen goes
 * on a board without them knowing. It travels as marks do, on its own topic, sealed with the sender's media key, and says
 * which share by its picture's track ID and nothing else: the picture itself is on the board, sealed like the rest of it.
 */
export const BOARD_SHOT_TOPIC = 'board-shot/1' as const;

/** The largest such message a browser reads, and how many a sender can say in a burst and then each second. */
export const BOARD_SHOT_LIMITS = { bytes: 256, burst: 4, perSecond: 1 } as const;

export const BoardShotMessageSchema = z.object({ share: ShareIdSchema });

export type BoardShotMessage = z.infer<typeof BoardShotMessageSchema>;
