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
 *   it was written, and someone who may read more than a row did isn't given it. Of the rows that are someone's, they
 *   read the newest, and a person keeps one row of their own, however often they come and go.
 * - A refresh is claimed under the row's lock and runs with no lock held, however long the notes model takes. What it
 *   wrote is merged in under the lock again, so a tick made meanwhile is kept.
 * - A follow-up keeps its ID because the notes model says so: each refresh is told the follow-ups so far, by label, and
 *   says which each one it lists is, in any words and any language. An ID it wasn't told is something new, one it used
 *   twice stays with the first, and what's ticked stays whatever it says.
 * - A refresh that reads less than the last one did (rooms closing takes what the people who stayed said out of it) isn't
 *   told the follow-ups so far, whose words may come from what it no longer reads, and what's ticked stops showing. Its
 *   tick still goes to the note.
 * - When the call ends, what was ticked goes into the note (`ticked` in its manifest), and the rows go. The notes model,
 *   writing the notes, is told what was ticked and says which follow-up each one is (`doneInNotes`).
 */
import { CatchUpReadSchema, ChangerSchema, EvidenceSchema, MAIN_PLACE, type ActionItem, type CatchUpRead, type LiveFollowUp, type LiveNotes, type TranscriptLine } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../context';
import { b64u, id128, openJson, sealJson, sha, stateKey, toJson, utf8 } from '../crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../db';
import { notFound } from '../errors';
import { covers, evidenceOf, readable, type Open } from './catchup';
import type { Cited, Known, Sorted } from './drafting';

/** The view of everyone who may read all a part of the call's notes read. */
export const ALL = 'all';
/** Refreshes of one view of a part of the call start at least this far apart, however many people are watching. */
const EVERY_SECONDS = 30;
/** How long a refresh holds its claim: longer than a model takes to be verified and answer. If its worker dies, the next look takes over after this. */
const LEASE_SECONDS = 150;
/**
 * What everyone reading the notes is told when a refresh fails, whatever went wrong. The causes are worded for someone
 * who can press something, and here nobody has to, so why is in the log.
 */
const NOT_UPDATED = 'The notes couldn’t be updated just now. Alcove tries again on its own.';

/** A point in the notes, as a catch-up gives it. */
const Point = z.object({ text: z.string(), owner: z.string().optional(), due: z.string().optional(), evidence: z.array(EvidenceSchema) });
type Point = z.infer<typeof Point>;
/** Who ticked a follow-up and when, as a note's changes say it. A call's pass has no account behind it for someone invited, so theirs goes by address, as `isBy` allows. */
const Tick = z.object({ by: ChangerSchema, at: z.string() });
type Tick = z.infer<typeof Tick>;
/**
 * `tick`: null until someone ticks it. `shown`: false once the notes stopped reading what a ticked one may have been
 * written from. Then it isn't shown or told to the model again, and only its tick is left, for the note.
 */
const FollowUp = Point.extend({ id: z.string(), tick: Tick.nullable(), shown: z.boolean() });
type FollowUp = z.infer<typeof FollowUp>;
const Written = z.object({
  summary: z.string(), decided: z.array(Point), proposed: z.array(Point), open: z.array(Point), next: z.array(FollowUp), read: CatchUpReadSchema,
  /** A digest of the IDs of the lines it read, to tell when there's something new. */
  heard: z.string(),
  /** When the first and the newest of those were said (seconds since the call started), and who may read every one of them, when any of them says. */
  first: z.number(), last: z.number(), readers: z.array(z.string()).optional()
});
type Written = z.infer<typeof Written>;
/** The record: the notes, null until they're written, and whether the latest refresh didn't work. */
const Stored = z.object({ notes: Written.nullable(), failed: z.boolean() });
type Stored = z.infer<typeof Stored>;
/** A line a row left out: when it was said, and who may read it, if not everyone there. */
const Barred = z.object({ said: z.number(), readers: z.array(z.string()).optional() });
/**
 * Beside a row: the lines it read, by ID and when each was said, and the lines it left out. A row with no notes yet has
 * those of the refresh that's first writing them, which is how someone reading nothing yet is told that it's going on.
 */
const Lines = z.object({ read: z.array(z.string()), said: z.array(z.number()), barred: z.array(Barred) });
type Lines = z.infer<typeof Lines>;

const key = (o: Owner, callId: string) => stateKey(o.root, o.ownerId, `call-notes:${callId}`);
const header = (o: Owner, callId: string, place: string, view: string) => ({ v: 1 as const, kind: 'call-notes', ownerId: o.ownerId, callId, place, view });
const linesHeader = (o: Owner, callId: string, place: string, view: string) => ({ v: 1 as const, kind: 'call-notes-lines', ownerId: o.ownerId, callId, place, view });
const opened = (o: Owner, callId: string, place: string, view: string, ciphertext: Uint8Array | null | undefined): Stored | null =>
  (ciphertext ? openJson(key(o, callId), header(o, callId, place, view), ciphertext, Stored) : null);
const sealed = (o: Owner, callId: string, place: string, view: string, s: Stored) => sealJson(key(o, callId), header(o, callId, place, view), toJson(s));
const linesOf = (o: Owner, callId: string, place: string, view: string, ciphertext: Uint8Array | null | undefined): Lines =>
  (ciphertext ? openJson(key(o, callId), linesHeader(o, callId, place, view), ciphertext, Lines) : { read: [], said: [], barred: [] });
const sealedLines = (o: Owner, callId: string, place: string, view: string, read: Read[], barred: Read[]) => sealJson(key(o, callId), linesHeader(o, callId, place, view), toJson({
  read: read.map((l) => l.id), said: read.map((l) => l.said), barred: barred.map((l) => ({ said: l.said, ...(l.readers ? { readers: l.readers } : {}) }))
} satisfies Lines));

/* ---------- reading: the row someone reads ---------- */

/**
 * Who's reading: `me` as lines list their readers (places.ts readerOf), and for a guest with the link, the stretches
 * they were in the call (null for everyone who gets the notes). Where they are in the call says which rows they read.
 */
export interface Reader { me: string; here: Open[] | null }

/**
 * Whether someone may read every line a row read. Nearly always that's known at once; for a guest whose time in the call
 * has a hole in the stretch the row read, it goes by when each line was said.
 */
function readsAll(r: Reader, n: Written, lines: Lines): boolean {
  if (n.readers !== undefined && !n.readers.includes(r.me)) return false;
  return covers(r.here, n.first, n.last) || lines.said.every((s) => readable(r.here, s));
}
/** Whether a row left out only what someone may not read. */
const leftOutFor = (r: Reader, lines: Lines) => lines.barred.every((l) => (l.readers !== undefined && !l.readers.includes(r.me)) || !readable(r.here, l.said));
/** Whether a row is someone's: they may read all it read, or is reading for the first time, and none of what it left out. */
const theirs = (r: Reader, s: Stored | null, lines: Lines) => leftOutFor(r, lines) && (s?.notes ? readsAll(r, s.notes, lines) : lines.said.every((x) => readable(r.here, x)));

const Here = z.object({ view: z.string(), notes_ciphertext: bytea.nullable(), lines_ciphertext: bytea.nullable(), writing: z.boolean() });
const WHERE = 'owner_id = $1 AND call_id = $2 AND place = $3';

/**
 * What's kept for someone in a part of the call. `view` is what they read, null when there's nothing of theirs yet, and
 * `own` their own row, if they have one, whether or not it's what they read: it's what a look at the notes refreshes.
 */
export interface Found { view: string | null; own: string | null; stored: Stored | null; writing: boolean }

/**
 * The row someone reads in a part of the call: of the rows that are theirs, the one that read what was said most
 * recently, and everyone's when that's as new, since it's the one that can be ticked. Failing that, their own that's
 * still being written, so they're told how it's going. It may be behind: anything said since they came or came back is
 * theirs at the next refresh.
 */
export async function find(o: Owner, db: Db, callId: string, place: string, r: Reader): Promise<Found> {
  const here = await rows(db, Here, `SELECT view, notes_ciphertext, lines_ciphertext, COALESCE(lease_until > now(), false) AS writing FROM call_notes WHERE ${WHERE} ORDER BY view = '${ALL}' DESC, looked_at DESC NULLS LAST`, [o.ownerId, callId, place]);
  const mine = here.flatMap((x) => {
    const lines = linesOf(o, callId, place, x.view, x.lines_ciphertext);
    // Most often no: everyone who gets the notes may read what a guest's notes left out, so a guest's notes are never opened for them.
    if (!leftOutFor(r, lines)) return [];
    const stored = opened(o, callId, place, x.view, x.notes_ciphertext);
    return theirs(r, stored, lines) ? [{ view: x.view, stored, writing: x.writing }] : [];
  });
  const ownRow = mine.find((x) => x.view !== ALL);
  const written = mine.filter((x) => x.stored?.notes);
  const newest = written.reduce<(typeof mine)[number] | undefined>((best, x) => ((x.stored?.notes?.last ?? 0) > (best?.stored?.notes?.last ?? -1) ? x : best), undefined);
  const shown = newest ?? ownRow ?? mine[0];
  if (shown) return { view: shown.view, own: ownRow?.view ?? null, stored: shown.stored, writing: shown.writing };
  // Notes they can't read, and none of their own yet: nothing to show, and nothing here says when there's more for them.
  return { view: here.some((x) => x.view === ALL && x.notes_ciphertext) ? null : ALL, own: null, stored: null, writing: false };
}

const plain = ({ text, owner, due, evidence }: Point) => ({ text, ...(owner === undefined ? {} : { owner }), ...(due === undefined ? {} : { due }), evidence });

/** The notes as they're shown. `capturing`: refreshes can run here now, so that the last one failed is worth saying. */
export function shownTo(found: Found, capturing: boolean): LiveNotes {
  const n = found.stored?.notes ?? null;
  const out = { writing: found.writing, error: capturing && found.stored?.failed ? NOT_UPDATED : null };
  if (!n) return { ...out, notes: null };
  const next = n.next.filter((f) => f.shown).map((f): LiveFollowUp => ({ ...plain(f), id: f.id, done: f.tick !== null }));
  return { ...out, notes: { summary: n.summary, decided: n.decided.map(plain), proposed: n.proposed.map(plain), open: n.open.map(plain), next, read: n.read } };
}

/* ---------- a refresh: claimed under the row's lock, kept under it again ---------- */

const Clips = z.object({ n: z.coerce.number() });
/** How many clips a note has, which only grows while it's recording. */
export const clipsOf = async (o: Owner, db: Db, noteId: string): Promise<number> =>
  (await maybeOne(db, Clips, 'SELECT count(*) AS n FROM transcript_clips WHERE owner_id = $1 AND note_item_id = $2', [o.ownerId, noteId]))?.n ?? 0;

const Due = z.object({ due: z.boolean() });
/**
 * Whether a look at a row has anything to do, as far as can be told without reading the transcript: the note has clips
 * its last refresh didn't count, and it's been long enough with none under way. Nothing is locked; `claim` decides.
 */
export async function due(o: Owner, db: Db, callId: string, place: string, view: string, noteId: string): Promise<boolean> {
  const r = await maybeOne(db, Due, `SELECT (SELECT count(*) FROM transcript_clips WHERE owner_id = $1 AND note_item_id = $4) <> COALESCE(n.clips_seen, 0)
      AND (n.lease_until IS NULL OR n.lease_until <= now()) AND (n.looked_at IS NULL OR n.looked_at <= now() - make_interval(secs => $5)) AS due
    FROM (SELECT 1) AS one LEFT JOIN call_notes n ON n.owner_id = $1 AND n.call_id = $2 AND n.place = $3 AND n.view = $6`, [o.ownerId, callId, place, noteId, EVERY_SECONDS, view]);
  return r?.due ?? false;
}

/** A refresh's hold on a row: when its lease runs out, which names it, and what the notes it may replace read and listed. */
export interface Claim { lease: Date; heard: string | null; read: string[]; next: FollowUp[] }
const Claimable = z.object({ notes_ciphertext: bytea.nullable(), lines_ciphertext: bytea.nullable(), free: z.boolean() });
const Leased = z.object({ lease_until: timestamp });
/**
 * Takes a refresh of a row for this request, under its lock, in the caller's transaction, or says someone else has it or
 * it's not time. Everyone watching a view comes through here one after the other, and only the first gets one. `clips`
 * is how many the note had before its lines were read, and `lines` and `barred` what the refresh is to read and leave out.
 */
export async function claim(o: Owner, c: Db, callId: string, place: string, view: string, clips: number, lines: Read[], barred: Read[]): Promise<Claim | null> {
  await exec(c, 'INSERT INTO call_notes (owner_id, call_id, place, view) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [o.ownerId, callId, place, view]);
  const r = await maybeOne(c, Claimable, `SELECT notes_ciphertext, lines_ciphertext, (lease_until IS NULL OR lease_until <= now()) AND (looked_at IS NULL OR looked_at <= now() - make_interval(secs => $5)) AS free
    FROM call_notes WHERE ${WHERE} AND view = $4 FOR UPDATE`, [o.ownerId, callId, place, view, EVERY_SECONDS]);
  if (!r?.free) return null;
  // To the millisecond, as a Date holds it, since the lease is what names this claim.
  const leased = await maybeOne(c, Leased, `UPDATE call_notes SET clips_seen = $5, looked_at = now(), lease_until = date_trunc('milliseconds', now() + make_interval(secs => $6)), lines_ciphertext = COALESCE(lines_ciphertext, $7)
    WHERE ${WHERE} AND view = $4 RETURNING lease_until`, [o.ownerId, callId, place, view, clips, LEASE_SECONDS, sealedLines(o, callId, place, view, lines, barred)]);
  if (!leased) return null;
  const n = opened(o, callId, place, view, r.notes_ciphertext)?.notes;
  return { lease: leased.lease_until, heard: n?.heard ?? null, read: n ? linesOf(o, callId, place, view, r.lines_ciphertext).read : [], next: n?.next ?? [] };
}

/** Nothing new in this view after all: the claim is given up, and the notes stay as they are. */
export async function release(o: Owner, callId: string, place: string, view: string, c: Claim): Promise<void> {
  await exec(o.pool, `UPDATE call_notes SET lease_until = NULL WHERE ${WHERE} AND view = $4 AND lease_until = $5`, [o.ownerId, callId, place, view, c.lease]);
}

/** Whether a refresh reads at least everything the notes it may replace read. */
function readsOn(c: Claim, lines: Pick<Read, 'id'>[]): boolean {
  const now = new Set(lines.map((l) => l.id));
  return c.read.every((id) => now.has(id));
}
/**
 * The follow-ups so far, for the notes model to say which of what it writes each is. None for a refresh that reads less
 * than they did: their words may come from any line that was read then, which aren't for it to see.
 */
export const knownTo = (c: Claim, lines: Pick<Read, 'id'>[]): Known[] =>
  (readsOn(c, lines) ? c.next.filter((f) => f.shown).map(({ id, text, owner }) => ({ id, text, ...(owner === undefined ? {} : { owner }) })) : []);

/** What a refresh read and wrote, before it's merged with what's kept, and what it left out. `same` on a follow-up is the one the notes model says it is. */
export interface Run { notes: Omit<Written, 'next'>; next: (Point & { same?: string | undefined })[]; lines: Read[]; barred: Read[] }
/** A line of what a refresh read: its ID, what was said, when, and who may read it, if not everyone there. */
export interface Read { id: string; text: string; said: number; readers?: string[] | undefined }

/** A digest of lines, by their random IDs, which say nothing of what was said: to tell the same lines read before, and to name the view of whoever can't read them. */
export const digestOf = (lines: Pick<Read, 'id'>[]): string => b64u(sha(utf8(lines.map((l) => l.id).sort().join(' '))));

/** Who may read all of these lines: everyone, unless any of them lists its readers. */
function readersOf(lines: Pick<Read, 'readers'>[]): { readers?: string[] } {
  const [first, ...rest] = lines.flatMap((l) => (l.readers ? [l.readers] : []));
  return first ? { readers: first.filter((x) => rest.every((l) => l.includes(x))) } : {};
}
/** What a refresh wrote from `lines`, leaving out `barred`: each point with the moments behind it. */
export function runOf(sorted: Sorted, lines: Read[], barred: Read[], read: CatchUpRead): Run {
  const point = ({ refs, same: _same, ...x }: Cited): Point => ({ ...x, evidence: evidenceOf(refs, lines) });
  return {
    notes: {
      summary: sorted.summary, decided: sorted.decided.map(point), proposed: sorted.proposed.map(point), open: sorted.open.map(point), read, heard: digestOf(lines),
      first: lines.reduce((n, l) => Math.min(n, l.said), Number.POSITIVE_INFINITY), last: lines.reduce((n, l) => Math.max(n, l.said), 0), ...readersOf(lines)
    },
    next: sorted.next.map((c) => ({ ...point(c), same: c.same })),
    lines, barred
  };
}

const saidAt = (f: Point) => f.evidence[0]?.said ?? 0;
/**
 * The follow-ups after a refresh. Each it listed has the ID, and the tick, of the one the notes model says it is, in its
 * new words, and anything else is new. One it no longer lists goes, unless it's ticked: then it stays, and shows as long
 * as the notes read everything they read when it was written (`whole`), since nobody may read more than these notes do.
 */
function nextOf(was: FollowUp[], run: Run, whole: boolean): FollowUp[] {
  const byId = new Map(was.map((f) => [f.id, f]));
  const listed = run.next.map(({ same, ...f }): FollowUp => { const w = same === undefined ? undefined : byId.get(same); return { ...f, id: w?.id ?? id128(), tick: w?.tick ?? null, shown: true }; });
  const carried = new Set(listed.map((f) => f.id));
  const left = was.filter((f) => f.tick !== null && !carried.has(f.id)).map((f) => ({ ...f, shown: f.shown && whole }));
  return [...left, ...listed].sort((a, b) => saidAt(a) - saidAt(b));
}

const Held = z.object({ lease_until: timestamp.nullable(), notes_ciphertext: bytea.nullable(), lines_ciphertext: bytea.nullable() });
/** A row and its lease, locked for the rest of the transaction; undefined once the call has ended. */
const held = (c: Db, o: Owner, callId: string, place: string, view: string) =>
  maybeOne(c, Held, `SELECT lease_until, notes_ciphertext, lines_ciphertext FROM call_notes WHERE ${WHERE} AND view = $4 FOR UPDATE`, [o.ownerId, callId, place, view]);
/** Whether a claim still stands: the row is there, and nobody has taken over from a refresh that outran its lease. */
const stands = (r: z.infer<typeof Held> | undefined, c: Claim) => r?.lease_until?.getTime() === c.lease.getTime();

/**
 * Someone's notes have moved on to `view`: the rows of their own from before go, so a person has one however often they
 * come and go. Anyone else who still reads one of those writes it again at their next look.
 */
async function letGo(o: Owner, db: Db, callId: string, place: string, view: string, r: Reader): Promise<void> {
  const others = await rows(db, Here, `SELECT view, notes_ciphertext, lines_ciphertext, false AS writing FROM call_notes WHERE ${WHERE} AND view <> $4 AND view <> '${ALL}'`, [o.ownerId, callId, place, view]);
  const old = others.filter((x) => theirs(r, opened(o, callId, place, x.view, x.notes_ciphertext), linesOf(o, callId, place, x.view, x.lines_ciphertext))).map((x) => x.view);
  if (old.length) await exec(db, `DELETE FROM call_notes WHERE ${WHERE} AND view = ANY($4)`, [o.ownerId, callId, place, old]);
}

/**
 * Keeps what a refresh wrote for `r`, merged with the follow-ups as they are now, ticks made meanwhile included. False
 * when there's nowhere to keep it: the call ended meanwhile, or the claim ran out.
 */
export async function keep(o: Owner, callId: string, place: string, view: string, c: Claim, run: Run, r: Reader): Promise<boolean> {
  return tx(o.pool, async (db) => {
    const row = await held(db, o, callId, place, view);
    if (!row || !stands(row, c)) return false;
    const was = opened(o, callId, place, view, row.notes_ciphertext)?.notes?.next ?? [];
    const notes: Written = { ...run.notes, next: nextOf(was, run, readsOn(c, run.lines)) };
    await exec(db, `UPDATE call_notes SET notes_ciphertext = $5, lines_ciphertext = $6, lease_until = NULL WHERE ${WHERE} AND view = $4`,
      [o.ownerId, callId, place, view, sealed(o, callId, place, view, { notes, failed: false }), sealedLines(o, callId, place, view, run.lines, run.barred)]);
    await letGo(o, db, callId, place, view, r);
    return true;
  });
}

/**
 * A refresh didn't work: the notes stay as they were, everyone reading them is told it didn't, and the next look after
 * the usual wait tries again, with the same lines or more.
 */
export async function failed(o: Owner, callId: string, place: string, view: string, c: Claim): Promise<boolean> {
  return tx(o.pool, async (db) => {
    const r = await held(db, o, callId, place, view);
    if (!r || !stands(r, c)) return false;
    const s = opened(o, callId, place, view, r.notes_ciphertext);
    await exec(db, `UPDATE call_notes SET notes_ciphertext = $5, clips_seen = -1, lease_until = NULL WHERE ${WHERE} AND view = $4`,
      [o.ownerId, callId, place, view, sealed(o, callId, place, view, { notes: s?.notes ?? null, failed: true })]);
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
  if (!s?.notes || !f?.shown || !readsAll(r, s.notes, linesOf(o, callId, place, ALL, row?.lines_ciphertext))) throw notFound('That follow-up', { callId, room: place !== MAIN_PLACE });
  if ((f.tick !== null) === done) return;
  const next = s.notes.next.map((x) => (x.id === id ? { ...x, tick: done ? { by, at: new Date().toISOString() } : null } : x));
  await exec(c, `UPDATE call_notes SET notes_ciphertext = $4 WHERE ${WHERE} AND view = '${ALL}'`, [o.ownerId, callId, place, sealed(o, callId, place, ALL, { ...s, notes: { ...s.notes, next } })]);
}

/* ---------- into the note ---------- */

/**
 * A follow-up someone ticked during the call, kept in the note until its notes are written: its ID, which is how the
 * notes model's answer finds it, its words, the lines behind it, the breakout room it was in (null for the main room),
 * and who ticked it and when.
 */
export const Ticked = Tick.extend({ id: z.string(), text: z.string(), owner: z.string().optional(), due: z.string().optional(), lines: z.array(z.string()), room: z.string().nullable() });
export type Ticked = z.infer<typeof Ticked>;

const Ending = z.object({ place: z.string(), notes_ciphertext: bytea.nullable() });
/** The call is ending, in the caller's transaction, which holds the call's row: what was ticked, for the note, and every row goes. */
export async function finish(o: Owner, c: Db, callId: string): Promise<Ticked[]> {
  const found = await rows(c, Ending, `SELECT place, notes_ciphertext FROM call_notes WHERE owner_id = $1 AND call_id = $2 AND view = '${ALL}' FOR UPDATE`, [o.ownerId, callId]);
  await exec(c, 'DELETE FROM call_notes WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId]);
  return found.flatMap((r) => (opened(o, callId, r.place, ALL, r.notes_ciphertext)?.notes?.next ?? []).flatMap((f): Ticked[] => (f.tick ? [{
    ...f.tick, id: f.id, text: f.text, ...(f.owner === undefined ? {} : { owner: f.owner }), ...(f.due === undefined ? {} : { due: f.due }), lines: f.evidence.map((e) => e.lineId),
    room: r.place === MAIN_PLACE ? null : r.place
  }] : [])));
}

/**
 * Follow-ups as written for a part of a note, with what was ticked in that part of the call done. `said` is which tick
 * the notes model says each written follow-up is, by their IDs. A tick nothing was said to be is added as it was said,
 * done, at the lines behind it: someone ticked it, and a wrong follow-up marked done would be worse.
 */
export function doneInNotes(actions: ActionItem[], ticks: Ticked[], said: ReadonlyMap<string, string>, lines: TranscriptLine[]): ActionItem[] {
  if (!ticks.length) return actions;
  const change = (t: Ticked): ActionItem['changes'][number] => ({ by: t.by, at: t.at, what: 'done' });
  const found = new Set<string>();
  const written = actions.map((a) => {
    const t = ticks.find((x) => x.id === said.get(a.id));
    if (!t) return a;
    found.add(t.id);
    return a.done ? a : { ...a, done: true, changes: [...a.changes, change(t)] };
  });
  const added = ticks.filter((t) => !found.has(t.id)).map((t): ActionItem => {
    const behind = lines.filter((l) => t.lines.includes(l.id));
    const at = behind[0]?.at;
    return { id: id128(), text: t.text, ...(t.owner ? { owner: { name: t.owner } } : {}), takenOn: false, ...(t.due ? { due: t.due } : {}), ...(at === undefined ? {} : { at }), lines: behind.map((l) => l.id), against: [], done: true, changes: [change(t)] };
  });
  return added.length ? [...written, ...added].sort((a, b) => (a.at ?? Number.POSITIVE_INFINITY) - (b.at ?? Number.POSITIVE_INFINITY)) : written;
}

/** Upkeep: rows of a call that ended without taking them along (a release from before live notes ended it, during a deploy or a rollback). */
export const sweep = (d: Pick<Deps, 'pool'>): Promise<number> =>
  exec(d.pool, `DELETE FROM call_notes n USING calls c WHERE c.owner_id = n.owner_id AND c.call_id = n.call_id AND c.state = 'ended'`);
