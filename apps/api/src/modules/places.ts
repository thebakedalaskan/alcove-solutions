/*
 * The parts of a call (docs: Calls and recordings › Breakout rooms): the main room, and while breakout rooms are open,
 * each room, each with its own MLS group. Who is where, which group each person is in and may be added to, where
 * someone was when they said something, and who may read a line of the live transcript are all worked out here from
 * the call's sealed state, so every rule about rooms agrees. Nothing here touches the database or any key.
 */
import { MAIN_PLACE } from '@alcove/api';
import { z } from 'zod';
import { RoomPause } from './capture';
import { HeldRooms } from './notes';

/**
 * Everyone who has joined, by LiveKit identity, so the call can show account names and photos. Sealed: LiveKit
 * never gets names, emails or photos.
 * - `role`: a guest is anyone who isn't invited. One signed in with an account the notes can go to (see `notesCanGo`)
 *   keeps their address and photo here, so the organizer sees who's asking, and is invited once the organizer lets
 *   them in.
 * - `person`: the same for every connection one browser makes to the call, so removing someone removes all of them.
 * - `status`: waiting to be let in, in, left, or turned away. An ask taken back is kept as turned away, so nothing,
 *   its pass or its identity, can be used again.
 * - `admit`: whether the host's browser adds them without asking (invited people, and people let in before who came back).
 * - `keysFor`: the generation of their latest key package while it's unused; -1 once a commit has added them with it.
 * - `group`: the part of the call whose MLS group they're in, in this generation (`main`, or a breakout room's ID; null for
 *   none): a commit added them and none has taken them out. Whoever hosts is in every group, and counts as `main`.
 * - `hosting`: when this connection hosted the call (ms; `to` null while it still does). The organizer's host from when
 *   they join. Once someone else hosts, what a connection that hosted still sends as host is turned down as out of date
 *   (409) rather than as never allowed (403); and catching up says when no hosting browser was in the call to send
 *   what was said.
 * - `from`: where in the log their group starts for them (their welcome into it).
 * - `placedAt`, `placedSeq`: when (ms) and where in the log they came into the part of the call they're in now; `wasIn`,
 *   the part they were in before it, and when they came into it and left it. Where someone was when they said something,
 *   and whose a room's chat is, comes from these.
 * - `leftAt`: where in the log they last left each part of the call, so coming back says whether there was chat meanwhile.
 * - `replaced`: their pass brought them back on another connection, so it can't again.
 * - `chatBefore`: there had been chat in their part of the call while they weren't in it, so their browser can't read all of it.
 * - `since`: when they were let in, in ms.
 * - `left`: when this connection stopped being in the call (left, removed, or another took its place), in ms; null
 *   while it's in. With `since`, it's each person's time in the call, which catching up reads.
 */
export const Joined = z.object({
  identity: z.string(), person: z.string(), role: z.enum(['host', 'invited', 'guest']), name: z.string(), email: z.string().optional(), photoUrl: z.string().optional(),
  status: z.enum(['waiting', 'in', 'left', 'denied']), admit: z.enum(['auto', 'ask']), keysFor: z.number(), group: z.string().nullable(), from: z.number(),
  placedAt: z.number(), placedSeq: z.number(), wasIn: z.object({ place: z.string(), since: z.number(), until: z.number() }).nullable(),
  leftAt: z.record(z.string(), z.number()), replaced: z.boolean(), chatBefore: z.boolean(), since: z.number(), left: z.number().nullable(), hand: z.boolean(),
  hosting: z.array(z.object({ from: z.number(), to: z.number().nullable() }))
});
export type Joined = z.infer<typeof Joined>;

/** A breakout room as kept: invited people by email, shown with their names when the call is read. */
export const Room = HeldRooms.shape.rooms.element;
/**
 * Breakout rooms: those open now (each with its MLS group's epoch in this generation, and the room the organizer is
 * visiting, or null for the main room), and those that have closed, which go into the notes.
 */
export const BreakoutState = z.object({
  open: z.object({
    rooms: z.array(Room.extend({ epoch: z.number(), pauses: z.array(RoomPause) })), from: z.number(), until: z.number(),
    message: z.object({ text: z.string(), at: z.number() }).nullable(), visiting: z.string().nullable()
  }).nullable(),
  held: z.array(HeldRooms)
});
/**
 * What the rules here read of a call's state. `host` is the connection that hosts now (the organizer's, or someone's
 * standing in for them), which commits for every part of the call's group (see committerOf).
 */
export interface Placing { people: Joined[]; breakouts: z.infer<typeof BreakoutState>; chatAt: Record<string, number>; host: string | null }

/** The parts of the call open now: the main room, and each breakout room while rooms are open. */
export const placesOf = (s: Placing): string[] => [MAIN_PLACE, ...(s.breakouts.open?.rooms.map((r) => r.id) ?? [])];

/** Where someone is in the call now: the organizer where it's visiting (or the main room); an invited person in the room they were sent to; anyone else in the main room. */
export function placeOf(s: Placing, j: Joined): string {
  const open = s.breakouts.open;
  if (!open) return MAIN_PLACE;
  if (j.role === 'host') return open.visiting ?? MAIN_PLACE;
  const email = j.email?.toLowerCase();
  return (email ? open.rooms.find((r) => r.emails.includes(email))?.id : undefined) ?? MAIN_PLACE;
}

/** The group someone is in, if its part of the call is still open (a closed room's group is nobody's any more). Whoever hosts is in every group. */
export const groupOf = (s: Placing, j: Joined): string | null => (j.identity === s.host ? MAIN_PLACE : j.group !== null && placesOf(s).includes(j.group) ? j.group : null);

/**
 * Someone the host's browser may add to `place`'s group now: asking (or invited, on their way in), or let in and on
 * their way into this part of the call, in no group, with a key package for this generation. Nobody but whoever hosts
 * is ever in two groups at once.
 */
export const pendingFor = (s: Placing, generation: number, place: string) => (j: Joined): boolean =>
  j.identity !== s.host && (j.status === 'waiting' || j.status === 'in') && groupOf(s, j) === null && j.keysFor === generation && placeOf(s, j) === place;

/** In `place`'s group and no longer to be: gone, removed, or sent to another part of the call. The host's browser takes them out. */
export const departedFrom = (s: Placing, place: string) => (j: Joined): boolean =>
  j.identity !== s.host && groupOf(s, j) === place && (j.status !== 'in' || placeOf(s, j) !== place);

/** Let in, on their way into a part of the call's group (a new generation, or a move), and without an unused key package. */
export const needsKeys = (s: Placing, generation: number, j: Joined): boolean =>
  j.identity !== s.host && j.status === 'in' && j.keysFor !== generation && groupOf(s, j) !== placeOf(s, j);

/** The epoch of a part of the call's group: the main room's is the call's own (`mainEpoch`), each open room's is its own. */
export const epochIn = (mainEpoch: number, s: Placing, place: string): number | undefined =>
  place === MAIN_PLACE ? mainEpoch : s.breakouts.open?.rooms.find((r) => r.id === place)?.epoch;

/**
 * Who commits for every part of the call's group: the connection that hosts (the organizer's, or while the organizer is
 * away, someone's standing in for them). Its browser creates every group in its generation, so it's leaf 0 in each, and
 * every change of host starts a new generation (the calls module's `newGeneration`), so a generation's committer never
 * changes. Every place that relies on it: this, which names the committer to every browser (`CallMls.committer`);
 * `app.ts`, which takes commits only from whoever hosts (`hostOnly` on `/mls/commits`), and `mlsCommit`, which checks
 * it again with the generation under the call's row lock; `mlsSync`, which gives that connection the committer's view;
 * and in the browser, `HttpCall`'s `hosting` (opens and commits for every group) and `COMMITTER_LEAF` in `mls.ts` (the
 * one leaf whose commits a group takes, which a joining browser checks is the connection named here).
 */
export const committerOf = (s: Placing): string | null => s.host;

/** Whether there was chat in `place` while this person wasn't in it (they never were, or left before it). */
export const chatSince = (s: Placing, j: Joined, place: string): boolean => {
  const last = s.chatAt[place];
  return last !== undefined && last > (j.leftAt[place] ?? -1);
};

/**
 * Everyone whose part of the call changed between `before` and `after` gets it recorded: when and where in the log they
 * came into the new part, and the part they left. Whoever hosts, being in every group, also learns whether there was
 * chat where it's going.
 */
export function relocate<S extends Placing>(before: Placing, after: S, atMs: number, seq: number): S {
  const was = new Map(before.people.map((j) => [j.identity, j]));
  return {
    ...after,
    people: after.people.map((j): Joined => {
      const old = was.get(j.identity);
      if (!old) return j;
      const from = placeOf(before, old);
      const to = placeOf(after, j);
      if (from === to) return j;
      const leftAt = { ...j.leftAt, [from]: seq };
      const moved: Joined = { ...j, placedAt: atMs, placedSeq: seq, wasIn: { place: from, since: j.placedAt, until: atMs }, leftAt };
      return j.identity === after.host ? { ...moved, chatBefore: chatSince(after, moved, to) } : moved;
    })
  };
}

/**
 * Where someone was at `t` (ms): the part of the call they're in now if they were in it by then, or the part before
 * it if `t` falls in their time there. Undefined when `t` is before both (they moved twice since): nobody can tell.
 */
export function placeAt(s: Placing, j: Joined, t: number): string | undefined {
  if (j.placedAt <= t) return placeOf(s, j);
  const w = j.wasIn;
  return w && w.since <= t && t < w.until ? w.place : undefined;
}

/** Who may read a line, as kept with it: the organizer for every connection of theirs, anyone else by their `person`. */
export const readerOf = (j: Joined): string => (j.role === 'host' ? 'organizer' : j.person);

/** Everyone in `place` at `t` (ms), as readers of what was said there then. */
export const readersAt = (s: Placing, place: string, t: number): string[] =>
  s.people.filter((j) => (j.status === 'in' || j.status === 'left') && placeAt(s, j, t) === place).map(readerOf);

/**
 * Which lines of the live transcript someone may read: those said in the part of the call they're in now, and of
 * those said while breakout rooms were open (which list their readers), only the ones said while they were there.
 * A room's lines are for the people in the room when they were said, the organizer included only if it was there;
 * the main room's while rooms are open, for the people in the main room then.
 */
export function readableBy(s: Placing, viewer: Joined | undefined): (l: { room?: string | undefined; readers?: string[] | undefined }) => boolean {
  if (!viewer) return () => false;
  const here = placeOf(s, viewer);
  const me = readerOf(viewer);
  return (l) => (l.room ?? MAIN_PLACE) === here && (l.readers === undefined || l.readers.includes(me));
}
