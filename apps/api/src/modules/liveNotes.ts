/*
 * A call's shared live notes (docs: Notes and inference › Live notes): a catch-up on the whole of each part of the call,
 * kept sealed in `call_notes`, so everyone there reads the same notes and inference runs once instead of once per
 * browser. What's kept and how it's read is here; when a refresh may run, and with what, is calls.ts's.
 *
 * - A refresh is claimed under the row's lock and runs with no lock held, however long the notes model takes. What it
 *   wrote is merged in under the lock again, so a tick made meanwhile is kept.
 * - A follow-up keeps its ID from one refresh to the next while it's plainly the same item (likeness.ts). A ticked one
 *   stays, whatever the next refresh says.
 * - Each point keeps who may read every line behind it, so reading the one record needs nothing but the reader.
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
import { likeness, pairUp, type SaidFollowUp } from './likeness';

/** Refreshes of one part of the call start at least this far apart, however many people are watching. */
const EVERY_SECONDS = 30;
/** How long a refresh holds its claim: longer than a model takes to be verified and answer. If its worker dies, the next look takes over after this. */
const LEASE_SECONDS = 150;
/** The most follow-ups one part of the call remembers. Past it, the oldest nobody ticked and the notes no longer list are forgotten. */
const FOLLOW_UPS_KEPT = 60;

/** A point in the notes, as a catch-up gives it, and who may read every line behind it, when any of those lines says (places.ts). */
const Point = z.object({
  text: z.string(), owner: z.string().optional(), due: z.string().optional(), evidence: z.array(EvidenceSchema), readers: z.array(z.string()).optional()
});
type Point = z.infer<typeof Point>;
/** Who ticked a follow-up and when, as a note's changes say it. */
const Tick = z.object({ by: z.object({ name: z.string(), email: z.string() }), at: z.string() });
type Tick = z.infer<typeof Tick>;
/** `tick`: null until someone ticks it. `listed`: the latest refresh listed it; one it didn't is shown only while ticked, and kept to know it again. */
const FollowUp = Point.extend({ id: z.string(), tick: Tick.nullable(), listed: z.boolean() });
type FollowUp = z.infer<typeof FollowUp>;
const Written = z.object({
  summary: z.string(), decided: z.array(Point), proposed: z.array(Point), open: z.array(Point), next: z.array(FollowUp), read: CatchUpReadSchema,
  /** A digest of the IDs of the lines it read, to tell when there's something new. */
  heard: z.string(),
  /** When the first and the newest of those were said (seconds since the call started), and who may read every one of them, when any says. */
  first: z.number(), last: z.number(), readers: z.array(z.string()).optional()
});
type Written = z.infer<typeof Written>;
/** The record: the notes, null until they're written, and why the latest refresh didn't work. */
const Stored = z.object({ notes: Written.nullable(), error: z.string().nullable() });
type Stored = z.infer<typeof Stored>;

const key = (o: Owner, callId: string) => stateKey(o.root, o.ownerId, `call-notes:${callId}`);
const header = (o: Owner, callId: string, place: string) => ({ v: 1 as const, kind: 'call-notes', ownerId: o.ownerId, callId, place });
const opened = (o: Owner, callId: string, place: string, sealed: Uint8Array | null | undefined): Stored | null => (sealed ? openJson(key(o, callId), header(o, callId, place), sealed, Stored) : null);
const sealed = (o: Owner, callId: string, place: string, s: Stored) => sealJson(key(o, callId), header(o, callId, place), toJson(s));

/* ---------- reading: the one record, as far as each reader may ---------- */

/**
 * Who's reading: `me` as lines list their readers (places.ts readerOf), and for a guest with the link, the stretches
 * they were in the call (null for everyone who gets the notes). Where they are in the call says which record they read.
 */
export interface Reader { me: string; here: Open[] | null }

const mayRead = (r: Reader, readers: string[] | undefined) => readers === undefined || readers.includes(r.me);
/** Whether someone may read a point: every line behind it. */
const shows = (r: Reader, p: Pick<Point, 'readers' | 'evidence'>) => mayRead(r, p.readers) && p.evidence.every((e) => readable(r.here, e.said));
/** Whether someone may read every line the notes read, which the summary rests on as a whole. */
const readsAll = (r: Reader, n: Written) => mayRead(r, n.readers) && covers(r.here, n.first, n.last);

const plain = ({ text, owner, due, evidence }: Point) => ({ text, ...(owner === undefined ? {} : { owner }), ...(due === undefined ? {} : { due }), evidence });
const followUpOf = (f: FollowUp): LiveFollowUp => ({ ...plain(f), id: f.id, done: f.tick !== null });

/**
 * The notes as someone may read them. A point shows only if they may read every line behind it, the summary only if
 * they may read every line the notes read, and what was read then says so and counts only the lines behind what's
 * shown. `capturing`: refreshes can run here now, so why the last one failed is worth saying.
 */
export function shownTo(found: { stored: Stored | null; writing: boolean }, r: Reader, capturing: boolean): LiveNotes {
  const n = found.stored?.notes ?? null;
  const out = { writing: found.writing, error: capturing ? found.stored?.error ?? null : null };
  if (!n) return { ...out, notes: null };
  const lists = { decided: n.decided.filter((p) => shows(r, p)), proposed: n.proposed.filter((p) => shows(r, p)), open: n.open.filter((p) => shows(r, p)) };
  const next = n.next.filter((f) => (f.listed || f.tick !== null) && shows(r, f));
  const behind = [...lists.decided, ...lists.proposed, ...lists.open, ...next].flatMap((p) => p.evidence);
  const whole = readsAll(r, n);
  const read: CatchUpRead = whole ? n.read : {
    ...n.read, lines: new Set(behind.map((e) => e.lineId)).size, through: behind.length ? Math.max(...behind.map((e) => e.said)) : null, whileHere: true, skipped: null
  };
  return {
    ...out,
    notes: { summary: whole ? n.summary : '', decided: lists.decided.map(plain), proposed: lists.proposed.map(plain), open: lists.open.map(plain), next: next.map(followUpOf), read }
  };
}

const Found = z.object({ notes_ciphertext: bytea.nullable(), writing: z.boolean() });
/** The record of a part of the call, and whether a refresh is under way. */
export async function read(o: Owner, db: Db, callId: string, place: string): Promise<{ stored: Stored | null; writing: boolean }> {
  const r = await maybeOne(db, Found, 'SELECT notes_ciphertext, COALESCE(lease_until > now(), false) AS writing FROM call_notes WHERE owner_id = $1 AND call_id = $2 AND place = $3', [o.ownerId, callId, place]);
  return { stored: opened(o, callId, place, r?.notes_ciphertext), writing: r?.writing ?? false };
}

/* ---------- a refresh: claimed under the row's lock, kept under it again ---------- */

const Due = z.object({ due: z.boolean() });
/**
 * Whether a look at the notes has anything to do, as far as can be told without opening anything: the note has clips
 * the last refresh didn't count, and it's been long enough with none under way. Nothing is locked; `claim` decides.
 */
export async function due(o: Owner, db: Db, callId: string, place: string, noteId: string): Promise<boolean> {
  const r = await maybeOne(db, Due, `SELECT (SELECT count(*) FROM transcript_clips WHERE owner_id = $1 AND note_item_id = $4) <> COALESCE(n.clips_seen, 0)
      AND (n.lease_until IS NULL OR n.lease_until <= now()) AND (n.looked_at IS NULL OR n.looked_at <= now() - make_interval(secs => $5)) AS due
    FROM (SELECT 1) AS one LEFT JOIN call_notes n ON n.owner_id = $1 AND n.call_id = $2 AND n.place = $3`, [o.ownerId, callId, place, noteId, EVERY_SECONDS]);
  return r?.due ?? false;
}

/** A refresh's hold on a part of the call: when its lease runs out, which names it, and what the notes it may replace read. */
export interface Claim { lease: Date; heard: string | null }
const Claimable = z.object({ notes_ciphertext: bytea.nullable(), clips: z.coerce.number(), clips_seen: z.number(), due: z.boolean() });
const Leased = z.object({ lease_until: timestamp });
/**
 * Takes a refresh of a part of the call for this request, under the row's lock, in the caller's transaction, or says
 * someone else has it or it's not time. Two people watching come through here one after the other, and only the first
 * gets one.
 */
export async function claim(o: Owner, c: Db, callId: string, place: string, noteId: string): Promise<Claim | null> {
  await exec(c, 'INSERT INTO call_notes (owner_id, call_id, place) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [o.ownerId, callId, place]);
  const r = await maybeOne(c, Claimable, `SELECT notes_ciphertext, clips_seen, (SELECT count(*) FROM transcript_clips WHERE owner_id = $1 AND note_item_id = $4) AS clips,
      (lease_until IS NULL OR lease_until <= now()) AND (looked_at IS NULL OR looked_at <= now() - make_interval(secs => $5)) AS due
    FROM call_notes WHERE owner_id = $1 AND call_id = $2 AND place = $3 FOR UPDATE`, [o.ownerId, callId, place, noteId, EVERY_SECONDS]);
  if (!r?.due || r.clips === r.clips_seen) return null;
  // To the millisecond, as a Date holds it, since the lease is what names this claim.
  const leased = await maybeOne(c, Leased, `UPDATE call_notes SET clips_seen = $4, looked_at = now(), lease_until = date_trunc('milliseconds', now() + make_interval(secs => $5))
    WHERE owner_id = $1 AND call_id = $2 AND place = $3 RETURNING lease_until`, [o.ownerId, callId, place, r.clips, LEASE_SECONDS]);
  return leased ? { lease: leased.lease_until, heard: opened(o, callId, place, r.notes_ciphertext)?.notes?.heard ?? null } : null;
}

/** Nothing new in this part of the call after all: the claim is given up, and the notes stay as they are. */
export async function release(o: Owner, callId: string, place: string, c: Claim): Promise<void> {
  await exec(o.pool, 'UPDATE call_notes SET lease_until = NULL WHERE owner_id = $1 AND call_id = $2 AND place = $3 AND lease_until = $4', [o.ownerId, callId, place, c.lease]);
}

/** What a refresh read and wrote, before it's merged with what's kept. */
export interface Run { notes: Omit<Written, 'next'>; next: Omit<FollowUp, 'id' | 'tick' | 'listed'>[] }
/** A line of what a refresh read: its ID, when it was said, and who may read it, if not everyone there. */
export interface Read { id: string; said: number; readers?: string[] | undefined }

/** What the notes would read: the same lines, read before, are nothing new. The IDs are random, and say nothing of what was said. */
export const heardFrom = (lines: Pick<Read, 'id'>[]): string => b64u(sha(utf8(lines.map((l) => l.id).sort().join(' '))));

/** Who may read all of these lines: everyone, unless any of them lists its readers. */
function readersOf(lines: Pick<Read, 'readers'>[]): { readers?: string[] } {
  const [first, ...rest] = lines.flatMap((l) => (l.readers ? [l.readers] : []));
  return first ? { readers: first.filter((x) => rest.every((l) => l.includes(x))) } : {};
}
/** What a refresh wrote from `lines`: each point with the moments behind it and who may read them all. */
export function runOf(sorted: Sorted, lines: Read[], read: CatchUpRead): Run {
  const point = ({ refs, ...x }: Cited): Point => ({ ...x, evidence: evidenceOf(refs, lines), ...readersOf(refs.flatMap((i) => { const l = lines[i]; return l ? [l] : []; })) });
  return {
    notes: {
      summary: sorted.summary, decided: sorted.decided.map(point), proposed: sorted.proposed.map(point), open: sorted.open.map(point), read, heard: heardFrom(lines),
      first: lines.reduce((n, l) => Math.min(n, l.said), Number.POSITIVE_INFINITY), last: lines.reduce((n, l) => Math.max(n, l.said), 0), ...readersOf(lines)
    },
    next: sorted.next.map(point)
  };
}

const sayingOf = (f: Point): SaidFollowUp => ({ text: f.text, owner: f.owner, at: f.evidence[0]?.said, lines: f.evidence.map((e) => e.lineId) });
const saidAt = (f: Point) => f.evidence[0]?.said ?? 0;
/**
 * The follow-ups after a refresh. Each it listed keeps the ID, and the tick, of the one it plainly is, in its new
 * words; a new one gets a new ID. One it no longer lists is kept to know it again, and shows only while it's ticked.
 */
function nextOf(was: FollowUp[], fresh: Run['next']): FollowUp[] {
  const same = pairUp(fresh, was, (f, w) => likeness(sayingOf(f), sayingOf(w)));
  const listed = fresh.map((f): FollowUp => { const w = same.get(f); return { ...f, id: w?.id ?? id128(), tick: w?.tick ?? null, listed: true }; });
  const carried = new Set(listed.map((f) => f.id));
  const left = was.filter((f) => !carried.has(f.id)).map((f) => ({ ...f, listed: false }));
  const over = Math.max(0, left.length + listed.length - FOLLOW_UPS_KEPT);
  const forgotten = new Set(left.filter((f) => f.tick === null).sort((a, b) => saidAt(a) - saidAt(b)).slice(0, over).map((f) => f.id));
  return [...left.filter((f) => !forgotten.has(f.id)), ...listed].sort((a, b) => saidAt(a) - saidAt(b));
}

const Held = z.object({ lease_until: timestamp.nullable(), notes_ciphertext: bytea.nullable() });
/** The record of a part of the call and its lease, locked for the rest of the transaction; undefined once the call has ended. */
const held = (c: Db, o: Owner, callId: string, place: string) =>
  maybeOne(c, Held, 'SELECT lease_until, notes_ciphertext FROM call_notes WHERE owner_id = $1 AND call_id = $2 AND place = $3 FOR UPDATE', [o.ownerId, callId, place]);
/** Whether a claim still stands: the row is there, and nobody has taken over from a refresh that outran its lease. */
const stands = (r: z.infer<typeof Held> | undefined, c: Claim) => r?.lease_until?.getTime() === c.lease.getTime();

/**
 * Keeps what a refresh wrote, merged with the follow-ups as they are now, ticks made meanwhile included. False when
 * there's nowhere to keep it: the call ended meanwhile, or the claim ran out.
 */
export async function keep(o: Owner, callId: string, place: string, c: Claim, run: Run): Promise<boolean> {
  return tx(o.pool, async (db) => {
    const r = await held(db, o, callId, place);
    if (!r || !stands(r, c)) return false;
    const was = opened(o, callId, place, r.notes_ciphertext)?.notes?.next ?? [];
    const notes: Written = { ...run.notes, next: nextOf(was, run.next) };
    await exec(db, 'UPDATE call_notes SET notes_ciphertext = $4, lease_until = NULL WHERE owner_id = $1 AND call_id = $2 AND place = $3', [o.ownerId, callId, place, sealed(o, callId, place, { notes, error: null })]);
    return true;
  });
}

/**
 * A refresh didn't work: the notes stay as they were, everyone there is told why, and the next look after the usual
 * wait tries again, with the same lines or more.
 */
export async function failed(o: Owner, callId: string, place: string, c: Claim, error: string): Promise<boolean> {
  return tx(o.pool, async (db) => {
    const r = await held(db, o, callId, place);
    if (!r || !stands(r, c)) return false;
    const s = opened(o, callId, place, r.notes_ciphertext);
    await exec(db, 'UPDATE call_notes SET notes_ciphertext = $4, clips_seen = -1, lease_until = NULL WHERE owner_id = $1 AND call_id = $2 AND place = $3',
      [o.ownerId, callId, place, sealed(o, callId, place, { notes: s?.notes ?? null, error })]);
    return true;
  });
}

/* ---------- ticking a follow-up ---------- */

/**
 * Ticks a follow-up of a part of the call, or takes the tick back, in the caller's transaction. Someone can only tick
 * what they can read, in the part of the call they're in: anything else isn't found, whether or not it exists.
 */
export async function tick(o: Owner, c: Db, callId: string, place: string, id: string, done: boolean, by: Tick['by'], r: Reader): Promise<void> {
  const row = await held(c, o, callId, place);
  const s = opened(o, callId, place, row?.notes_ciphertext);
  const f = s?.notes?.next.find((x) => x.id === id);
  if (!s?.notes || !f || !(f.listed || f.tick !== null) || !shows(r, f)) throw notFound('That follow-up', { callId, room: place !== MAIN_PLACE });
  if ((f.tick !== null) === done) return;
  const next = s.notes.next.map((x) => (x.id === id ? { ...x, tick: done ? { by, at: new Date().toISOString() } : null } : x));
  await exec(c, 'UPDATE call_notes SET notes_ciphertext = $4 WHERE owner_id = $1 AND call_id = $2 AND place = $3', [o.ownerId, callId, place, sealed(o, callId, place, { ...s, notes: { ...s.notes, next } })]);
}

/* ---------- into the note ---------- */

/**
 * A follow-up someone ticked during the call, kept in the note until its notes are written: its words, the lines
 * behind it, the breakout room it was in (null for the main room), and who ticked it and when.
 */
export const Ticked = Tick.extend({ text: z.string(), owner: z.string().optional(), due: z.string().optional(), lines: z.array(z.string()), room: z.string().nullable() });
export type Ticked = z.infer<typeof Ticked>;

const Ending = z.object({ place: z.string(), notes_ciphertext: bytea.nullable() });
/** The call is ending, in the caller's transaction, which holds the call's row: what was ticked, for the note, and the rows go. */
export async function finish(o: Owner, c: Db, callId: string): Promise<Ticked[]> {
  const found = await rows(c, Ending, 'SELECT place, notes_ciphertext FROM call_notes WHERE owner_id = $1 AND call_id = $2 FOR UPDATE', [o.ownerId, callId]);
  await exec(c, 'DELETE FROM call_notes WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId]);
  return found.flatMap((r) => (opened(o, callId, r.place, r.notes_ciphertext)?.notes?.next ?? []).flatMap((f): Ticked[] => (f.tick ? [{
    ...f.tick, text: f.text, ...(f.owner === undefined ? {} : { owner: f.owner }), ...(f.due === undefined ? {} : { due: f.due }), lines: f.evidence.map((e) => e.lineId),
    room: r.place === MAIN_PLACE ? null : r.place
  }] : [])));
}

/** How close a written follow-up's moment must be to a line to say it comes from it: the notes model reads whole seconds off a line's mark. */
const POINTS_AT_SECONDS = 2;
const lineAt = (at: number | undefined, l: TranscriptLine) => at !== undefined && Math.abs(l.at - at) <= POINTS_AT_SECONDS;

/**
 * Follow-ups as written for a part of a note, with what was ticked in that part of the call done. Each tick goes to
 * the written follow-up it plainly is (`likeness`): their moments and words, compared by the transcript lines the note
 * keeps with their IDs. It never names someone else, and either points at a line behind the tick (within two seconds)
 * and shares a word that says something, or came up within a minute with most of the shorter one's words in the other.
 * The plainest pairs go first, and each written follow-up takes one tick. A tick the notes have no follow-up for is
 * added as it was said, done: someone ticked it, so it happened.
 */
export function doneInNotes(actions: ActionItem[], ticks: Ticked[], lines: TranscriptLine[]): ActionItem[] {
  if (!ticks.length) return actions;
  const firstAt = (t: Ticked) => lines.find((l) => t.lines.includes(l.id))?.at;
  const change = (t: Ticked): ActionItem['changes'][number] => ({ by: t.by, at: t.at, what: 'done' });
  const pairs = pairUp(ticks, actions, (t, a) => likeness(
    { text: t.text, owner: t.owner, at: firstAt(t), lines: t.lines },
    { text: a.text, owner: a.owner?.name, at: a.at, lines: lines.filter((l) => lineAt(a.at, l)).map((l) => l.id) }
  ));
  const doneBy = new Map([...pairs].map(([t, a]) => [a, t]));
  const written = actions.map((a) => { const t = doneBy.get(a); return t && !a.done ? { ...a, done: true, changes: [...a.changes, change(t)] } : a; });
  const added = ticks.filter((t) => !pairs.has(t)).map((t): ActionItem => {
    const at = firstAt(t);
    return { id: id128(), text: t.text, ...(t.owner ? { owner: { name: t.owner } } : {}), takenOn: false, ...(t.due ? { due: t.due } : {}), ...(at === undefined ? {} : { at }), done: true, changes: [change(t)] };
  });
  return added.length ? [...written, ...added].sort((a, b) => (a.at ?? Number.POSITIVE_INFINITY) - (b.at ?? Number.POSITIVE_INFINITY)) : written;
}

/** Upkeep: rows of a call that ended without taking them along (a release from before live notes ended it, during a deploy or a rollback). */
export const sweep = (d: Pick<Deps, 'pool'>): Promise<number> =>
  exec(d.pool, `DELETE FROM call_notes n USING calls c WHERE c.owner_id = n.owner_id AND c.call_id = n.call_id AND c.state = 'ended'`);
