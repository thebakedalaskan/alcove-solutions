/*
 * The shape of a board's Y.Doc, the one thing the app and the API have to agree on. Four roots: `objects`
 * holds a Y.Map per object, `places` one shared list of where each object is and what frame it's in, `comments` a Y.Map
 * per thread, and `settings` the board's own settings, which every picture of it follows (`settings.ts`). What people type
 * together is Y.Text and everything else is last-write-wins: per key, or per entry in `places`.
 * The schemas describe an object as it reads out, its place joined in and text as plain strings, and both
 * directions use them: `readBoard` leaves out what doesn't parse and a write refuses what wouldn't, so one
 * browser can't write what the others would throw away.
 */
import { z } from './zod';

/** The root map of objects: id to Y.Map. */
export const BOARD_OBJECTS = 'objects';
/** The root list of where things are: a `{ k, x, y, w, h, f, n }` for each object with a box, `k` being its id. See `places.ts`. */
export const BOARD_PLACES = 'places';
/** The root map of comment threads: id to Y.Map, each with a Y.Array of replies. */
export const BOARD_COMMENTS = 'comments';
/** The root map of the board's own settings: `night`, a dark board in any theme. */
export const BOARD_SETTINGS = 'settings';

/** What a board can hold. Past these it says so and refuses more, rather than slowing down for everyone. */
export const BOARD_LIMITS = { objects: 5000, points: 2000, text: 4000, minSide: 16, maxSide: 8000 } as const;
/** How far from the origin anything can sit. Finite isn't enough: no camera can fit a box 1e308 wide. */
export const BOARD_REACH = 1_000_000;
/** The most rows, or columns, in a table. A write refuses more; a read keeps the first ones, as two people can pass this together. */
export const TABLE_MAX = 50;

export const STICKY_COLOURS = ['butter', 'peach', 'rose', 'lilac', 'sky', 'mist'] as const;
export type StickyColour = (typeof STICKY_COLOURS)[number];
/** What the canvas draws strokes in. */
export const INK_COLOURS = ['horizon', 'sun', 'rose'] as const;
export type InkColour = (typeof INK_COLOURS)[number];
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond', 'pill'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
export const LINE_STYLES = ['elbow', 'straight', 'curve'] as const;
export type LineStyle = (typeof LINE_STYLES)[number];
export const LINE_SIDES = ['l', 'r', 't', 'b'] as const;
export type LineSide = (typeof LINE_SIDES)[number];

/** An id on this board: 12 base64url characters. A key that isn't one is something a peer made up. */
export const BoardIdSchema = z.string().regex(/^[A-Za-z0-9_-]{12}$/);
/** An id from outside the board, for media or a workspace item. Only ever an id, so a name can't ride in it. */
const OutsideIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const IdOrNoneSchema = z.union([z.literal(''), BoardIdSchema]);
const ReachSchema = z.number().min(-BOARD_REACH).max(BOARD_REACH);
const SideSchema = z.number().min(BOARD_LIMITS.minSide).max(BOARD_LIMITS.maxSide);
const TextSchema = z.string().max(BOARD_LIMITS.text);
const StickyColourSchema = z.enum(STICKY_COLOURS);
const ColourOrNoneSchema = z.enum(['', ...STICKY_COLOURS]);

const Layered = { id: BoardIdSchema, at: z.number(), f: IdOrNoneSchema };
const Boxed = { x: ReachSchema, y: ReachSchema, w: SideSchema, h: SideSchema };
const Placed = { ...Layered, ...Boxed };

/**
 * An entry in `places`: where the object `k` is, and `f`, the frame it's in, so that the two are decided together. `n` orders an
 * object's places: a write's is one more than the place it replaces, so of two for one key the higher `n` wins, and of two with
 * the same, written at once, the later in the list. Everything a drag changes is here, and nothing else is.
 */
export const PlaceSchema = z.object({ k: BoardIdSchema, ...Boxed, f: IdOrNoneSchema, n: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) });
export type Place = z.output<typeof PlaceSchema>;
/** A place to write: its `n` comes from the list it goes into. */
export const NewPlaceSchema = PlaceSchema.omit({ n: true });
export type NewPlace = z.output<typeof NewPlaceSchema>;
/** The fields of an object with a box that live in its place rather than its Y.Map. A line has no place, so its `f` is in its map. */
export const PLACE_FIELDS = ['x', 'y', 'w', 'h', 'f'] as const;

/** One end of a line: attached to something, or free on the board. */
export const LineEndSchema = z.union([z.object({ on: BoardIdSchema, side: z.enum(LINE_SIDES) }), z.object({ x: ReachSchema, y: ReachSchema })]);
export type LineEnd = z.output<typeof LineEndSchema>;

/** A row or column of a table. Cells hang off these ids, so inserting one never moves what someone's typing in. */
export const TableLineSchema = z.object({ id: BoardIdSchema, size: SideSchema });
export type TableLine = z.output<typeof TableLineSchema>;
export const TableLinesSchema = z.array(TableLineSchema).max(TABLE_MAX);

const NoteSchema = z.object({ k: z.literal('note'), ...Placed, c: StickyColourSchema, size: z.enum(['s', 'm', 'l']), t: TextSchema });
const TextObjectSchema = z.object({ k: z.literal('text'), ...Placed, size: z.enum(['title', 'heading', 'body']), t: TextSchema });
const ShapeSchema = z.object({ k: z.literal('shape'), ...Placed, s: z.enum(SHAPE_KINDS), c: ColourOrNoneSchema, t: TextSchema });
/**
 * `c` is the colour new stickies take inside it; `sub` is the line beside its title, like who was in a room; `sorted` says Sort into
 * themes has sorted what's in it, so it's drawn round its themes.
 */
const FrameSchema = z.object({
  k: z.literal('frame'), ...Placed, c: ColourOrNoneSchema, role: z.enum(['', 'actions']), hint: TextSchema, sub: TextSchema.default(''), sorted: z.boolean().default(false), title: TextSchema
});
const LineSchema = z.object({ k: z.literal('line'), ...Layered, style: z.enum(LINE_STYLES), from: LineEndSchema, to: LineEndSchema });
/** `pts` are flat x, y pairs, each a fraction of the object's box from its top left, so a stroke resized is only a new place. */
const InkSchema = z.object({
  k: z.literal('ink'), ...Placed, tool: z.enum(['pen', 'marker']), c: z.enum(INK_COLOURS),
  pts: z.array(z.number().min(0).max(1)).min(2).max(BOARD_LIMITS.points * 2).refine((pts) => pts.length % 2 === 0)
});
const ImageSchema = z.object({ k: z.literal('image'), ...Placed, media: OutsideIdSchema });
const ShotSchema = z.object({ k: z.literal('shot'), ...Placed, media: OutsideIdSchema, caption: TextSchema });
/**
 * `cells` are keyed by `cellKey`, and read as only those with words. Each is a Y.Text made with its row and column; one a table
 * is missing, as one from before cells came with them can be, reads as empty. The limit on text is each cell's.
 */
const TableSchema = z.object({ k: z.literal('table'), ...Placed, rows: TableLinesSchema, cols: TableLinesSchema, cells: z.record(z.string(), TextSchema) });
const NodeSchema = z.object({ k: z.literal('node'), ...Placed, parent: IdOrNoneSchema, t: TextSchema });
/** A card pointing at a workspace item. Only its id: a stored name would reach people who can't open the item. */
const LinkSchema = z.object({ k: z.literal('link'), ...Placed, item: OutsideIdSchema });

/** Every object on a board. Parse with this anything that came from another browser. */
export const BoardObjectSchema = z.discriminatedUnion('k', [
  NoteSchema, TextObjectSchema, ShapeSchema, FrameSchema, LineSchema, InkSchema, ImageSchema, ShotSchema, TableSchema, NodeSchema, LinkSchema
]);
export type BoardObject = z.output<typeof BoardObjectSchema>;
export type NoteObject = z.output<typeof NoteSchema>;
export type TextObject = z.output<typeof TextObjectSchema>;
export type ShapeObject = z.output<typeof ShapeSchema>;
export type FrameObject = z.output<typeof FrameSchema>;
export type LineObject = z.output<typeof LineSchema>;
export type InkObject = z.output<typeof InkSchema>;
export type ImageObject = z.output<typeof ImageSchema>;
export type ShotObject = z.output<typeof ShotSchema>;
export type TableObject = z.output<typeof TableSchema>;
export type NodeObject = z.output<typeof NodeSchema>;
export type LinkObject = z.output<typeof LinkSchema>;
/** Everything with a box. A line has none: it goes where its ends go. */
export type PlacedObject = Exclude<BoardObject, LineObject>;

/**
 * Who wrote a comment: `by`, what they're known by in the workspace, which finds their face, and their name as it was then.
 * A reply from before comments said who wrote them reads as nobody's.
 */
export const BoardAuthorSchema = z.object({ by: z.string().max(64).catch(''), name: z.string().max(200).catch('') });
export type BoardAuthor = z.output<typeof BoardAuthorSchema>;
/** One message in a comment thread. `at`: when it was written, in ms since the epoch. */
export const BoardReplySchema = z.object({ id: BoardIdSchema, text: TextSchema, at: z.number(), ...BoardAuthorSchema.shape });
export type BoardReply = z.output<typeof BoardReplySchema>;
/** A comment thread, pinned to the object `on`, with what's been said, oldest first. A resolved thread stays, and isn't shown. */
export interface BoardThread {
  id: string;
  on: string;
  resolved: boolean;
  replies: BoardReply[];
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An object about to be added. The board gives it an id and an `at`, and works out `f` unless it's told. */
export type NewObject = Without<BoardObject, 'id' | 'at' | 'f'> & { f?: string | undefined };

/** A board as it reads now: `objects` and `frames` in drawing order, which puts a frame after whatever holds it. The top-level frames, with no `f`, are the slides, in order. */
export interface BoardView {
  objects: readonly BoardObject[];
  byId: ReadonlyMap<string, BoardObject>;
  frames: readonly FrameObject[];
}

export const hasBox = (o: BoardObject): o is PlacedObject => o.k !== 'line';
export const isAttached = (end: LineEnd): end is Extract<LineEnd, { on: string }> => 'on' in end;
/** The key of a table's cell in its `cells` map, and in `TableObject.cells`. */
export const cellKey = (row: string, col: string): string => `${row}:${col}`;
/** The layer an object draws in: frames, then lines, then everything else. */
export const layerOf = (k: BoardObject['k']): number => (k === 'frame' ? 0 : k === 'line' ? 1 : 2);

/** Text cut to the limit. Never between a surrogate pair: half of one encodes differently, and browsers would disagree. */
export function cut(text: string): string {
  if (text.length <= BOARD_LIMITS.text) return text;
  const kept = text.slice(0, BOARD_LIMITS.text);
  return /[\uD800-\uDBFF]$/.test(kept) ? kept.slice(0, -1) : kept;
}

const ID_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** A new id: 12 random base64url characters. 64 divides 256, so masking a byte keeps every character equally likely. */
export function newId(): string {
  let id = '';
  for (const byte of crypto.getRandomValues(new Uint8Array(12))) id += ID_CHARACTERS.charAt(byte & 63);
  return id;
}

/** A 32-bit hash of some text, from `salt`: FNV-1a over its UTF-16 code units, then MurmurHash3's finaliser to spread the bits. */
function hash(text: string, salt: number): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** An id that's the same every time for the same parts, like `newId`'s: each character from a hash of its own, 72 bits in all. */
export function idFrom(...parts: readonly string[]): string {
  const text = parts.join('\u0000');
  let id = '';
  for (let i = 0; i < 12; i += 1) id += ID_CHARACTERS.charAt(hash(text, i) & 63);
  return id;
}
