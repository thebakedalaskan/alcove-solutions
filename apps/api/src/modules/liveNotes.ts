/*
 * A call's shared live notes (docs: Notes and inference › Live notes): a catch-up on each part of the call, kept sealed in
 * `call_notes`, so inference runs once a refresh instead of once per browser. What's kept and how it's read is here; when
 * a refresh may run, and with what, is calls.ts's.
 *
 * - The notes model only ever reads, for someone, lines they may read. A part of the call has one set of notes everyone
 *   who may read all it read shares (view `all`), which are the ones ticked. Anyone who may not gets notes of their own,
 *   written only from what they may read, shared with whoever can't read the same lines (`view`, a digest of those lines),
 *   and those are read-only. So the common case is one run, and the cost grows with the views being watched, not the people.
 * - Reading goes by what a row read and left out: each keeps who may read all of it, when each line was said, and the
 *   same for the lines it left out. So nobody reads a row that read anything they may not, whatever has happened since
 *   it was written, and someone who may read more than a row did isn't given it.
 * - A refresh is claimed under the row's lock and runs with no lock held, however long the notes model takes. What it
 *   wrote is merged in under the lock again, so a tick made meanwhile is kept.
 * - A follow-up keeps its ID from one refresh to the next while it's plainly the same item (likeness.ts). A ticked one
 *   stays, whatever the next refresh says, unless it rests on lines the notes stopped reading.
 * - When the call ends, what was ticked goes into the note (`ticked` in its manifest), and the rows go. When the notes
 *   are written, each tick finds the follow-up it is there (`doneInNotes`), or becomes one.
 */
import { CatchUpReadSchema, EvidenceSchema, MAIN_PLACE, type ActionItem, type CatchUpRead, type LiveFollowUp, type LiveNotes, type TranscriptLine } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../context';
import { b64u, id128, openJson, sealJson, sha, stateKey, toJson, utf8 } from '../crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../db';
import { notFound } from '../errors';
import { covers, evidenceOf, readable, type Open } from './catchup';
import type { Cited, Sorted } from './drafting';
import { likeness, notInWordsOf, pairUp, sameOwner, type SaidFollowUp } from './likeness';

/** The view of everyone who may read all a part of the call's notes read. */
export const ALL = 'all';
/** Refreshes of one view of a part of the call start at least this far apart, however many people are watching. */
const EVERY_SECONDS = 30;
/** How long a refresh holds its claim: longer than a model takes to be verified and answer. If its worker dies, the next look takes over after this. */
const LEASE_SECONDS = 150;
/** The most follow-ups one row remembers. Past it, the oldest nobody ticked and the notes no longer list are forgotten. */
const FOLLOW_UPS_KEPT = 60;
/** How plainly a follow-up in someone's own notes must be one that's ticked for them to see it done: most of it, from a line in common. */
const DONE_THERE = 2.75;

/** A point in the notes, as a catch-up gives it. */
const Point = z.object({ text: z.string(), owner: z.string().optional(), due: z.string().optional(), evidence: z.array(EvidenceSchema) });
type Point = z.infer<typeof Point>;
/** Who ticked a follow-up and when, as a note's changes say it. */
const Tick = z.object({ by: z.object({ name: z.string(), email: z.string() }), at: z.string() });
type Tick = z.infer<typeof Tick>;
/**
 * `cited`: every line it comes from, by ID (`evidence` shows the first three). `tick`: null until someone ticks it.
 * `shown`: the latest refresh listed it, or it's ticked and rests only on lines that refresh read. One not shown is kept
 * to know it again, and a tick goes to the note either way.
 */
const FollowUp = Point.extend({ id: z.string(), cited: z.array(z.string()), tick: Tick.nullable(), shown: z.boolean() });
type FollowUp = z.infer<typeof FollowUp>;
const Written = z.object({
  summary: z.string(), decided: z.array(Point), proposed: z.array(Point), open: z.array(Point), next: z.array(FollowUp), read: CatchUpReadSchema,
  /** A digest of the IDs of the lines it read, to tell when there's something new. */
  heard: z.string(),
  /** When the first and the newest of those were said (seconds since the call started), and who may read every one of them, when any of them says. */
  first: z.number(), last: z.number(), readers: z.array(z.string()).optional()
});
type Written = z.infer<typeof Written>;
/** The record: the notes, null until they're written, and why the latest refresh didn't work. */
const Stored = z.object({ notes: Written.nullable(), error: z.string().nullable() });
type Stored = z.infer<typeof Stored>;
/** A line a row left out: when it was said, and who may read it, if not everyone there. */
const Barred = z.object({ said: z.number(), readers: z.array(z.string()).optional() });
/** Beside a row, for anyone who can't simply read everything: when each line it read was said, and the lines it left out. */
const Lines = z.object({ said: z.array(z.number()), barred: z.array(Barred) });
type Lines = z.infer<typeof Lines>;

const key = (o: Owner, callId: string) => stateKey(o.root, o.ownerId, `call-notes:${callId}`);
const header = (o: Owner, callId: string, place: string, view: string) => ({ v: 1 as const, kind: 'call-notes', ownerId: o.ownerId, callId, place, view });
const linesHeader = (o: Owner, callId: string, place: string, view: string) => ({ v: 1 as const, kind: 'call-notes-lines', ownerId: o.ownerId, callId, place, view });
const opened = (o: Owner, callId: string, place: string, view: string, ciphertext: Uint8Array | null | undefined): Stored | null =>
  (ciphertext ? openJson(key(o, callId), header(o, callId, place, view), ciphertext, Stored) : null);
const sealed = (o: Owner, callId: string, place: string, view: string, s: Stored) => sealJson(key(o, callId), header(o, callId, place, view), toJson(s));

/* ---------- reading: the one row someone may read ---------- */

/**
 * Who's reading: `me` as lines list their readers (places.ts readerOf), and for a guest with the link, the stretches
 * they were in the call (null for everyone who gets the notes). Where they are in the call says which rows they read.
 */
export interface Reader { me: string; here: Open[] | null }

/**
 * Whether someone may read every line a row read. Nearly always that's known at once; for a guest whose time in the call
 * has a hole in the stretch the row read, it goes by when each line was said.
 */
async function readsAll(r: Reader, n: Written, lines: () => Promise<Lines>): Promise<boolean> {
  if (n.readers !== undefined && !n.readers.includes(r.me)) return false;
  if (covers(r.here, n.first, n.last)) return true;
  return (await lines()).said.every((s) => readable(r.here, s));
}
/** Whether a row is someone's own: everything it read they may read, and nothing it left out. */
const leftOutFor = (r: Reader, lines: Lines) => lines.barred.every((l) => (l.readers !== undefined && !l.readers.includes(r.me)) || !readable(r.here, l.said));

const Main = z.object({ notes_ciphertext: bytea.nullable(), writing: z.boolean() });
const Other = z.object({ view: z.string(), notes_ciphertext: bytea.nullable(), lines_ciphertext: bytea.nullable(), writing: z.boolean() });
const JustLines = z.object({ lines_ciphertext: bytea.nullable() });
const WHERE = 'owner_id = $1 AND call_id = $2 AND place = $3';

/** What's kept for someone in a part of the call. `view` is what they read, null when there's nothing of theirs yet; `ticked`, what's done in the notes they can't read. */
export interface Found { view: string | null; stored: Stored | null; writing: boolean; ticked: FollowUp[] }
const linesOf = (o: Owner, callId: string, place: string, view: string, ciphertext: Uint8Array | null | undefined): Lines =>
  (ciphertext ? openJson(key(o, callId), linesHeader(o, callId, place, view), ciphertext, Lines) : { said: [], barred: [] });

/**
 * The row someone reads in a part of the call: everyone's, if they may read all of it; otherwise the one that read what
 * they may read and left out what they may not. It may be behind: anything said since they came or came back is theirs
 * at the next refresh.
 */
export async function find(o: Owner, db: Db, callId: string, place: string, r: Reader): Promise<Found> {
  const main = await maybeOne(db, Main, `SELECT notes_ciphertext, COALESCE(lease_until > now(), false) AS writing FROM call_notes WHERE ${WHERE} AND view = '${ALL}'`, [o.ownerId, callId, place]);
  const stored = opened(o, callId, place, ALL, main?.notes_ciphertext);
  const notes = stored?.notes;
  if (notes && await readsAll(r, notes, () => mainLines(o, db, callId, place))) return { view: ALL, stored, writing: main?.writing ?? false, ticked: [] };
  const others = await rows(db, Other, `SELECT view, notes_ciphertext, lines_ciphertext, COALESCE(lease_until > now(), false) AS writing FROM call_notes WHERE ${WHERE} AND view <> '${ALL}' ORDER BY looked_at DESC NULLS LAST`, [o.ownerId, callId, place]);
  const ticked = notes?.next.filter((f) => f.tick !== null) ?? [];
  for (const x of others) {
    const s = opened(o, callId, place, x.view, x.notes_ciphertext);
    const lines = linesOf(o, callId, place, x.view, x.lines_ciphertext);
    if (s?.notes && leftOutFor(r, lines) && await readsAll(r, s.notes, () => Promise.resolve(lines))) return { view: x.view, stored: s, writing: x.writing, ticked };
  }
  // Notes they can't read, and none of their own yet: nothing to show, and nothing here says when there's more for them.
  return notes ? { view: null, stored: null, writing: false, ticked } : { view: ALL, stored, writing: main?.writing ?? false, ticked: [] };
}
/** The lines everyone's notes in a part of the call read. Only someone with a hole in their time in the call needs them. */
const mainLines = async (o: Owner, db: Db, callId: string, place: string): Promise<Lines> =>
  linesOf(o, callId, place, ALL, (await maybeOne(db, JustLines, `SELECT lines_ciphertext FROM call_notes WHERE ${WHERE} AND view = '${ALL}'`, [o.ownerId, callId, place]))?.lines_ciphertext);

const plain = ({ text, owner, due, evidence }: Point) => ({ text, ...(owner === undefined ? {} : { owner }), ...(due === undefined ? {} : { due }), evidence });
const saidOf = (f: Pick<FollowUp, 'text' | 'owner' | 'evidence' | 'cited'>, heard = ''): SaidFollowUp => ({ text: f.text, owner: f.owner, at: f.evidence[0]?.said, lines: f.cited, heard });

/** The notes as they're shown. `capturing`: refreshes can run here now, so why the last one failed is worth saying. */
export function shownTo(found: Found, capturing: boolean): LiveNotes {
  const n = found.stored?.notes ?? null;
  const out = { writing: found.writing, error: capturing ? found.stored?.error ?? null : null };
  if (!n) return { ...out, notes: null };
  const done = (f: FollowUp) => f.tick !== null || found.ticked.some((t) => likeness(saidOf(t), saidOf(f)) >= DONE_THERE);
  const next = n.next.filter((f) => f.shown).map((f): LiveFollowUp => ({ ...plain(f), id: f.id, done: done(f) }));
  return { ...out, notes: { summary: n.summary, decided: n.decided.map(plain), proposed: n.proposed.map(plain), open: n.open.map(plain), next, read: n.read } };
}

/* ---------- a refresh: claimed under the row's lock, kept under it again ---------- */

const Clips = z.object({ n: z.coerce.number() });
/** How many clips a note has, which only grows while it's recording. */
export const clipsOf = async (o: Owner, db: Db, noteId: string): Promise<number> =>
  (await maybeOne(db, Clips, 'SELECT count(*) AS n FROM transcript_clips WHERE owner_id = $1 AND note_item_id = $2', [o.ownerId, noteId]))?.n ?? 0;

const Due = z.object({ due: z.boolean() });
/**
 * Whether a look at a row has anything to do, as far as can be told without opening anything: the note has clips its
 * last refresh didn't count, and it's been long enough with none under way. Nothing is locked; `claim` decides.
 */
export async function due(o: Owner, db: Db, callId: string, place: string, view: string, noteId: string): Promise<boolean> {
  const r = await maybeOne(db, Due, `SELECT (SELECT count(*) FROM transcript_clips WHERE owner_id = $1 AND note_item_id = $4) <> COALESCE(n.clips_seen, 0)
      AND (n.lease_until IS NULL OR n.lease_until <= now()) AND (n.looked_at IS NULL OR n.looked_at <= now() - make_interval(secs => $5)) AS due
    FROM (SELECT 1) AS one LEFT JOIN call_notes n ON n.owner_id = $1 AND n.call_id = $2 AND n.place = $3 AND n.view = $6`, [o.ownerId, callId, place, noteId, EVERY_SECONDS, view]);
  return r?.due ?? false;
}

/** A refresh's hold on a row: when its lease runs out, which names it, and what the notes it may replace read. */
export interface Claim { lease: Date; heard: string | null }
const Claimable = z.object({ notes_ciphertext: bytea.nullable(), free: z.boolean() });
const Leased = z.object({ lease_until: timestamp });
/**
 * Takes a refresh of a row for this request, under its lock, in the caller's transaction, or says someone else has it or
 * it's not time. Everyone watching a view comes through here one after the other, and only the first gets one. `clips`
 * is how many the note had before its lines were read.
 */
export async function claim(o: Owner, c: Db, callId: string, place: string, view: string, clips: number): Promise<Claim | null> {
  await exec(c, 'INSERT INTO call_notes (owner_id, call_id, place, view) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [o.ownerId, callId, place, view]);
  const r = await maybeOne(c, Claimable, `SELECT notes_ciphertext, (lease_until IS NULL OR lease_until <= now()) AND (looked_at IS NULL OR looked_at <= now() - make_interval(secs => $5)) AS free
    FROM call_notes WHERE ${WHERE} AND view = $4 FOR UPDATE`, [o.ownerId, callId, place, view, EVERY_SECONDS]);
  if (!r?.free) return null;
  // To the millisecond, as a Date holds it, since the lease is what names this claim.
  const leased = await maybeOne(c, Leased, `UPDATE call_notes SET clips_seen = $5, looked_at = now(), lease_until = date_trunc('milliseconds', now() + make_interval(secs => $6))
    WHERE ${WHERE} AND view = $4 RETURNING lease_until`, [o.ownerId, callId, place, view, clips, LEASE_SECONDS]);
  return leased ? { lease: leased.lease_until, heard: opened(o, callId, place, view, r.notes_ciphertext)?.notes?.heard ?? null } : null;
}

/** Nothing new in this view after all: the claim is given up, and the notes stay as they are. */
export async function release(o: Owner, callId: string, place: string, view: string, c: Claim): Promise<void> {
  await exec(o.pool, `UPDATE call_notes SET lease_until = NULL WHERE ${WHERE} AND view = $4 AND lease_until = $5`, [o.ownerId, callId, place, view, c.lease]);
}

/** What a refresh read and wrote, before it's merged with what's kept, and what it left out. */
export interface Run { notes: Omit<Written, 'next'>; next: Omit<FollowUp, 'id' | 'tick' | 'shown'>[]; lines: Read[]; barred: Read[] }
/** A line of what a refresh read: its ID, what was said, when, and who may read it, if not everyone there. */
export interface Read { id: string; text: string; said: number; readers?: string[] | undefined }

/** A digest of lines, by their random IDs, which say nothing of what was said: to tell the same lines read before, and to name the view of whoever can't read them. */
export const digestOf = (lines: Pick<Read, 'id'>[]): string => b64u(sha(utf8(lines.map((l) => l.id).sort().join(' '))));

/** Who may read all of these lines: everyone, unless any of them lists its readers. */
function readersOf(lines: Pick<Read, 'readers'>[]): { readers?: string[] } {
  const [first, ...rest] = lines.flatMap((l) => (l.readers ? [l.readers] : []));
  return first ? { readers: first.filter((x) => rest.every((l) => l.includes(x))) } : {};
}
/** What a refresh wrote from `lines`, leaving out `barred`: each point with the moments behind it, and each follow-up with every line it cites. */
export function runOf(sorted: Sorted, lines: Read[], barred: Read[], read: CatchUpRead): Run {
  const point = ({ refs, cited: _all, ...x }: Cited): Point => ({ ...x, evidence: evidenceOf(refs, lines) });
  return {
    notes: {
      summary: sorted.summary, decided: sorted.decided.map(point), proposed: sorted.proposed.map(point), open: sorted.open.map(point), read, heard: digestOf(lines),
      first: lines.reduce((n, l) => Math.min(n, l.said), Number.POSITIVE_INFINITY), last: lines.reduce((n, l) => Math.max(n, l.said), 0), ...readersOf(lines)
    },
    next: sorted.next.map((c) => ({ ...point(c), cited: c.cited.flatMap((i) => { const l = lines[i]; return l ? [l.id] : []; }) })),
    lines, barred
  };
}

const saidAt = (f: Point) => f.evidence[0]?.said ?? 0;
/**
 * The follow-ups after a refresh. Each it listed keeps the ID, and the tick, of the one it plainly is, in its new words;
 * a new one gets a new ID. One it no longer lists is kept to know it again, and shows only while it's ticked and rests
 * on nothing but lines this refresh read: everyone reading these notes may read those.
 */
function nextOf(was: FollowUp[], run: Run): FollowUp[] {
  const said = new Map(run.lines.map((l) => [l.id, l.text]));
  const saying = (f: Pick<FollowUp, 'text' | 'owner' | 'evidence' | 'cited'>) => saidOf(f, f.cited.map((id) => said.get(id) ?? '').join(' '));
  const same = pairUp(run.next, was, (f, w) => likeness(saying(f), saying(w)));
  const listed = run.next.map((f): FollowUp => { const w = same.get(f); return { ...f, id: w?.id ?? id128(), tick: w?.tick ?? null, shown: true }; });
  const carried = new Set(listed.map((f) => f.id));
  const left = was.filter((f) => !carried.has(f.id)).map((f) => ({ ...f, shown: f.tick !== null && f.cited.every((id) => said.has(id)) }));
  const over = Math.max(0, left.length + listed.length - FOLLOW_UPS_KEPT);
  const forgotten = new Set(left.filter((f) => f.tick === null).sort((a, b) => saidAt(a) - saidAt(b)).slice(0, over).map((f) => f.id));
  return [...left.filter((f) => !forgotten.has(f.id)), ...listed].sort((a, b) => saidAt(a) - saidAt(b));
}

const Held = z.object({ lease_until: timestamp.nullable(), notes_ciphertext: bytea.nullable() });
/** A row and its lease, locked for the rest of the transaction; undefined once the call has ended. */
const held = (c: Db, o: Owner, callId: string, place: string, view: string) =>
  maybeOne(c, Held, `SELECT lease_until, notes_ciphertext FROM call_notes WHERE ${WHERE} AND view = $4 FOR UPDATE`, [o.ownerId, callId, place, view]);
/** Whether a claim still stands: the row is there, and nobody has taken over from a refresh that outran its lease. */
const stands = (r: z.infer<typeof Held> | undefined, c: Claim) => r?.lease_until?.getTime() === c.lease.getTime();

/**
 * Keeps what a refresh wrote, merged with the follow-ups as they are now, ticks made meanwhile included. False when
 * there's nowhere to keep it: the call ended meanwhile, or the claim ran out.
 */
export async function keep(o: Owner, callId: string, place: string, view: string, c: Claim, run: Run): Promise<boolean> {
  return tx(o.pool, async (db) => {
    const r = await held(db, o, callId, place, view);
    if (!r || !stands(r, c)) return false;
    const was = opened(o, callId, place, view, r.notes_ciphertext)?.notes?.next ?? [];
    const notes: Written = { ...run.notes, next: nextOf(was, run) };
    const lines: Lines = { said: run.lines.map((l) => l.said), barred: run.barred.map((l) => ({ said: l.said, ...(l.readers ? { readers: l.readers } : {}) })) };
    await exec(db, `UPDATE call_notes SET notes_ciphertext = $5, lines_ciphertext = $6, lease_until = NULL WHERE ${WHERE} AND view = $4`,
      [o.ownerId, callId, place, view, sealed(o, callId, place, view, { notes, error: null }), sealJson(key(o, callId), linesHeader(o, callId, place, view), toJson(lines))]);
    return true;
  });
}

/**
 * A refresh didn't work: the notes stay as they were, everyone reading them is told why, and the next look after the
 * usual wait tries again, with the same lines or more.
 */
export async function failed(o: Owner, callId: string, place: string, view: string, c: Claim, error: string): Promise<boolean> {
  return tx(o.pool, async (db) => {
    const r = await held(db, o, callId, place, view);
    if (!r || !stands(r, c)) return false;
    const s = opened(o, callId, place, view, r.notes_ciphertext);
    await exec(db, `UPDATE call_notes SET notes_ciphertext = $5, clips_seen = -1, lease_until = NULL WHERE ${WHERE} AND view = $4`,
      [o.ownerId, callId, place, view, sealed(o, callId, place, view, { notes: s?.notes ?? null, error })]);
    return true;
  });
}

/* ---------- ticking a follow-up ---------- */

/**
 * Ticks a follow-up of a part of the call, or takes the tick back, in the caller's transaction. Only the notes everyone
 * shares are ticked, by someone who may read all of them, in the part of the call they're in: anything else isn't found,
 * whether or not it exists.
 */
export async function tick(o: Owner, c: Db, callId: string, place: string, id: string, done: boolean, by: Tick['by'], r: Reader): Promise<void> {
  const row = await held(c, o, callId, place, ALL);
  const s = opened(o, callId, place, ALL, row?.notes_ciphertext);
  const f = s?.notes?.next.find((x) => x.id === id);
  if (!s?.notes || !f?.shown || !(await readsAll(r, s.notes, () => mainLines(o, c, callId, place)))) throw notFound('That follow-up', { callId, room: place !== MAIN_PLACE });
  if ((f.tick !== null) === done) return;
  const next = s.notes.next.map((x) => (x.id === id ? { ...x, tick: done ? { by, at: new Date().toISOString() } : null } : x));
  await exec(c, `UPDATE call_notes SET notes_ciphertext = $4 WHERE ${WHERE} AND view = '${ALL}'`, [o.ownerId, callId, place, sealed(o, callId, place, ALL, { ...s, notes: { ...s.notes, next } })]);
}

/* ---------- into the note ---------- */

/**
 * A follow-up someone ticked during the call, kept in the note until its notes are written: its words, the lines
 * behind it, the breakout room it was in (null for the main room), and who ticked it and when.
 */
export const Ticked = Tick.extend({ text: z.string(), owner: z.string().optional(), due: z.string().optional(), lines: z.array(z.string()), room: z.string().nullable() });
export type Ticked = z.infer<typeof Ticked>;

const Ending = z.object({ place: z.string(), notes_ciphertext: bytea.nullable() });
/** The call is ending, in the caller's transaction, which holds the call's row: what was ticked, for the note, and every row goes. */
export async function finish(o: Owner, c: Db, callId: string): Promise<Ticked[]> {
  const found = await rows(c, Ending, `SELECT place, notes_ciphertext FROM call_notes WHERE owner_id = $1 AND call_id = $2 AND view = '${ALL}' FOR UPDATE`, [o.ownerId, callId]);
  await exec(c, 'DELETE FROM call_notes WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId]);
  return found.flatMap((r) => (opened(o, callId, r.place, ALL, r.notes_ciphertext)?.notes?.next ?? []).flatMap((f): Ticked[] => (f.tick ? [{
    ...f.tick, text: f.text, ...(f.owner === undefined ? {} : { owner: f.owner }), ...(f.due === undefined ? {} : { due: f.due }), lines: f.cited,
    room: r.place === MAIN_PLACE ? null : r.place
  }] : [])));
}

/** How close a written follow-up's moment must be to a line to say it comes from it: the notes model reads whole seconds off a line's mark. */
const POINTS_AT_SECONDS = 2;

/**
 * Follow-ups as written for a part of a note, with what was ticked in that part of the call done. The written ones have
 * new IDs and the notes model's own words; the transcript lines keep theirs from the call, which is what ties them.
 *
 * A written follow-up's lines are those within two seconds of its moment. Each tick goes to the follow-up it plainly is
 * by `likeness`, the plainest pairs first, each follow-up taking one tick. When a tick has none, and the words can't be
 * compared because the written ones aren't the transcript's (notes in another language), the place decides: the one
 * written follow-up whose nearest line is behind the tick, if it's the only one there and names nobody else. A tick
 * nothing matches is added as it was said, done: someone ticked it, and a wrong follow-up marked done would be worse.
 */
export function doneInNotes(actions: ActionItem[], ticks: Ticked[], lines: TranscriptLine[]): ActionItem[] {
  if (!ticks.length) return actions;
  const within = (a: ActionItem) => (a.at === undefined ? [] : lines.filter((l) => a.at !== undefined && Math.abs(l.at - a.at) <= POINTS_AT_SECONDS));
  const textOf = (ls: TranscriptLine[]) => ls.map((l) => l.text).join(' ');
  const behind = (t: Ticked) => lines.filter((l) => t.lines.includes(l.id));
  const pairs = pairUp(ticks, actions, (t, a) => likeness(
    { text: t.text, owner: t.owner, at: behind(t)[0]?.at, lines: t.lines, heard: textOf(behind(t)) },
    { text: a.text, owner: a.owner?.name, at: a.at, lines: within(a).map((l) => l.id), heard: textOf(within(a)) }
  ));
  /** The line a written follow-up is nearest, if any is near enough. */
  const nearest = (a: ActionItem) => within(a).reduce<TranscriptLine | undefined>((best, l) => (best && Math.abs(best.at - (a.at ?? 0)) <= Math.abs(l.at - (a.at ?? 0)) ? best : l), undefined);
  const paired = new Set(pairs.values());
  for (const t of ticks.filter((x) => !pairs.has(x))) {
    const there = actions.filter((a) => { const l = nearest(a); return l !== undefined && t.lines.includes(l.id); });
    const [only] = there;
    if (only && there.length === 1 && !paired.has(only) && sameOwner(t.owner, only.owner?.name) && notInWordsOf(only.text, textOf(within(only)))) {
      pairs.set(t, only);
      paired.add(only);
    }
  }
  const change = (t: Ticked): ActionItem['changes'][number] => ({ by: t.by, at: t.at, what: 'done' });
  const doneBy = new Map([...pairs].map(([t, a]) => [a, t]));
  const written = actions.map((a) => { const t = doneBy.get(a); return t && !a.done ? { ...a, done: true, changes: [...a.changes, change(t)] } : a; });
  const added = ticks.filter((t) => !pairs.has(t)).map((t): ActionItem => {
    const at = behind(t)[0]?.at;
    return { id: id128(), text: t.text, ...(t.owner ? { owner: { name: t.owner } } : {}), takenOn: false, ...(t.due ? { due: t.due } : {}), ...(at === undefined ? {} : { at }), done: true, changes: [change(t)] };
  });
  return added.length ? [...written, ...added].sort((a, b) => (a.at ?? Number.POSITIVE_INFINITY) - (b.at ?? Number.POSITIVE_INFINITY)) : written;
}

/** Upkeep: rows of a call that ended without taking them along (a release from before live notes ended it, during a deploy or a rollback). */
export const sweep = (d: Pick<Deps, 'pool'>): Promise<number> =>
  exec(d.pool, `DELETE FROM call_notes n USING calls c WHERE c.owner_id = n.owner_id AND c.call_id = n.call_id AND c.state = 'ended'`);
