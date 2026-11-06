/*
 * Someone's own notes on a call (docs: Notes and inference › Your own notes): what they wrote for themselves, the moments
 * they bookmarked and the answers they kept. One sealed record for each person and note, under the person's own keys: the
 * organizer's keys don't open it, and nothing here reads anyone's but the account asking. No model reads it, nor does
 * anything that goes across notes or a series.
 *
 * What it points at is only a pointer, read again every time against what that person may read now: in a call, by the
 * call's own reading rule (calls.ts personalIn); after it, in the note. It lasts while they have the note: it goes with the
 * note, with their account, and when they remove the note from theirs, since an answer or a bookmark can quote it.
 */
import {
  MAX_BOOKMARK_LABEL, MAX_PERSONAL_ENTRIES, type PersonalEntry, type PersonalInput, type PersonalNotes, type PersonalPoint, type PersonalReach, type RoomNote, type SourceMoment,
  type Speaker, type TranscriptLine
} from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../../context';
import { id128, openJson, sealJson, sha, stateKey, toJson, utf8 } from '../../crypto';
import { bytea, exec, maybeOne, rows, tx, type Db } from '../../db';
import { ConflictError, ValidationError, notFound } from '../../errors';
import { log } from '../../log';
import { asRead, holdAccess, locate, type Located, type NoteManifest } from './service';

const plog = log.child({ component: 'personal' });

/**
 * What something kept points at. A line or a shared screen by its ID. A moment: where it falls in the recording, null if
 * nothing was being captured then; and marked in a call, when (ms) and in which breakout room, if any. Line IDs stay the
 * same from a call's live transcript into its note.
 */
export const Anchor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('line'), lineId: z.string() }),
  z.object({ kind: z.literal('screen'), frameId: z.string() }),
  z.object({ kind: z.literal('moment'), at: z.number().nullable(), when: z.number().nullable(), room: z.string().nullable() })
]);
export type Anchor = z.infer<typeof Anchor>;

const Common = { id: z.string(), at: z.string(), shared: z.object({ additionId: z.string(), at: z.string() }).nullable() };
const Entry = z.discriminatedUnion('kind', [
  z.object({ ...Common, kind: z.literal('note'), text: z.string() }),
  z.object({ ...Common, kind: z.literal('bookmark'), label: z.string(), anchor: Anchor }),
  z.object({ ...Common, kind: z.literal('answer'), question: z.string(), answer: z.string(), anchors: z.array(Anchor) })
]);
export type Entry = z.infer<typeof Entry>;
const Kept = z.object({ entries: z.array(Entry) });
type Kept = z.infer<typeof Kept>;

/** What a pointer reaches from where someone is now. */
export type Source = { moment: SourceMoment; reach: 'open' } | { moment: null; reach: Exclude<PersonalReach, 'open'> };
const LATER: Source = { moment: null, reach: 'later' };
const NOTHING: Source = { moment: null, reach: 'none' };

/** What someone may read from where they are: a call now, or a note. */
export interface Reader {
  /** What to keep for a point they name; undefined when it isn't there, or they may not read it. Both look the same. */
  anchor(p: PersonalPoint): Anchor | undefined;
  /** Now, in a call. Undefined anywhere else. */
  now(): Anchor | undefined;
  source(a: Anchor): Source;
}

/**
 * Someone's own notes on one note, and how they reach it. `reader` reads what they may read now. `holdNote` keeps the
 * note, and their way to it, in place until the transaction ends.
 */
export interface Place { author: Owner; noteOwnerId: string; noteId: string; reader: () => Promise<Reader>; holdNote: (c: Db) => Promise<void> }

/** How far back a moment looks for what was just said: past this, the line before it is about something else. */
const NEAR_SECONDS = 120;
/**
 * How far from a line a moment named by its second alone can be and still be that line. The notes model cites a line by
 * the time it was shown, in whole seconds rounded down, so a true cite is within one. Further off, it isn't that line.
 */
const CITE_SECONDS = 2;

const sayable = (l: { id: string; text: string; speaker?: Speaker | undefined }): NonNullable<SourceMoment['line']> => ({ id: l.id, text: l.text, ...(l.speaker ? { speaker: l.speaker } : {}) });

/** What someone who has a note may read in it, which is all of it, the breakout rooms' sections included. */
export function noteReader(m: NoteManifest): Reader {
  const main = m.transcript ?? [];
  const shown = (l: TranscriptLine, room?: RoomNote | undefined): Source => ({ moment: { at: l.at, line: sayable(l), ...(room ? { room: { id: room.id, name: room.name } } : {}) }, reach: 'open' });
  const lineOf = (id: string): Source | undefined => {
    const l = main.find((x) => x.id === id);
    if (l) return shown(l);
    for (const r of m.rooms) { const x = r.transcript.find((y) => y.id === id); if (x) return shown(x, r); }
    return undefined;
  };
  /** The line just said at `at`, as the notes place it. */
  const saidAt = (lines: TranscriptLine[], at: number) => lines.findLast((l) => l.at <= at + 0.5 && at - l.at <= NEAR_SECONDS);
  /** Every line in the note, the call's first. */
  const said = [...main.map((line) => ({ line, room: undefined })), ...m.rooms.flatMap((room) => room.transcript.map((line) => ({ line, room })))];
  /**
   * The line a moment named by its second alone means: the nearest of them all, since an answer reads every section and
   * its cite says only when. Level between two, the call's. With nothing that close, it doesn't mean a line.
   */
  const citedAt = (at: number): Source => {
    const far = (l: TranscriptLine) => Math.abs(l.at - at);
    const found = said.filter((s) => far(s.line) <= CITE_SECONDS).sort((x, y) => far(x.line) - far(y.line))[0];
    return found ? shown(found.line, found.room) : NOTHING;
  };
  const source = (a: Anchor): Source => {
    // Until the recording stops, what was said isn't in the note yet.
    if (m.status === 'recording') return LATER;
    if (a.kind === 'line') return lineOf(a.lineId) ?? NOTHING;
    if (a.kind === 'screen') {
      const s = m.screens.find((x) => x.id === a.frameId);
      return s ? { moment: { at: s.at, screen: { id: s.id, title: s.title } }, reach: 'open' } : NOTHING;
    }
    const at = a.at;
    if (at === null) return NOTHING;
    if (a.when === null) return citedAt(at);
    // Marked in a call: where they were then is known, and it's what was just said there.
    const room = a.room === null ? undefined : m.rooms.find((r) => r.id === a.room);
    if (room) { const l = saidAt(room.transcript, at); return l ? shown(l, room) : NOTHING; }
    const l = saidAt(main, at);
    const up = a.room === null ? m.screens.find((s) => s.at <= at && at < s.until) : undefined;
    if (!l && !up) return NOTHING;
    return { moment: { at: l?.at ?? at, ...(l ? { line: sayable(l) } : {}), ...(up ? { screen: { id: up.id, title: up.title } } : {}) }, reach: 'open' };
  };
  return {
    anchor: (p) => {
      if (p.kind === 'line') return lineOf(p.lineId) ? { kind: 'line', lineId: p.lineId } : undefined;
      if (p.kind === 'screen') return m.screens.some((s) => s.id === p.frameId) ? { kind: 'screen', frameId: p.frameId } : undefined;
      return p.at <= m.duration + 1 ? { kind: 'moment', at: p.at, when: null, room: null } : undefined;
    },
    now: () => undefined,
    source
  };
}

/** A line of a live call someone may read now: when it was said (`when` ms, `said` seconds since the call started) and the room, if any. */
export interface LiveLine { id: string; text: string; speaker?: Speaker | undefined; room?: { id: string; name: string } | undefined; when?: number | undefined; said?: number | undefined }

/**
 * What someone in a call may read now: `lines`, by the call's own rule, from the part of the call they're in (`here`, null
 * for the main room). Anything else they kept is `later`: it's somewhere they aren't, and the notes have it once the call
 * ends. Shared screens are read once it has, so during a call they're never here yet.
 */
export function callReader(lines: LiveLine[], here: string | null, now: Anchor): Reader {
  const shown = (l: LiveLine): Source => ({ moment: { at: l.said ?? 0, line: sayable(l), ...(l.room ? { room: l.room } : {}) }, reach: 'open' });
  return {
    anchor: (p) => (p.kind === 'line' && lines.some((l) => l.id === p.lineId) ? { kind: 'line', lineId: p.lineId } : undefined),
    now: () => now,
    source: (a) => {
      if (a.kind === 'screen') return LATER;
      if (a.kind === 'line') { const l = lines.find((x) => x.id === a.lineId); return l ? shown(l) : LATER; }
      if (a.at === null) return NOTHING;
      if (a.room !== here || a.when === null) return LATER;
      const mark = a.when;
      const l = lines.findLast((x) => x.when !== undefined && x.when <= mark);
      return l?.when !== undefined && mark - l.when <= NEAR_SECONDS * 1000 ? shown(l) : NOTHING;
    }
  };
}

/* ---------- the record ---------- */

const key = (p: Pick<Place, 'author' | 'noteId'>) => stateKey(p.author.root, p.author.ownerId, `personal:${p.noteId}`);
const header = (p: Pick<Place, 'author' | 'noteOwnerId' | 'noteId'>) => ({ v: 1 as const, kind: 'personal-notes', ownerId: p.author.ownerId, noteOwnerId: p.noteOwnerId, noteId: p.noteId });
const Row = z.object({ body_ciphertext: bytea });

/** This person's record of this note, read and written one change at a time. It takes no row, so it can't wait on one. */
export async function hold(c: Db, authorId: string, noteId: string): Promise<void> {
  await exec(c, 'SELECT pg_advisory_xact_lock($1)', [Buffer.from(sha(utf8(`personal:${authorId}:${noteId}`)).slice(0, 8)).readBigInt64BE()]);
}
async function load(db: Db, p: Pick<Place, 'author' | 'noteOwnerId' | 'noteId'>): Promise<Kept> {
  const r = await maybeOne(db, Row, 'SELECT body_ciphertext FROM personal_notes WHERE owner_id = $1 AND note_owner_id = $2 AND note_item_id = $3', [p.author.ownerId, p.noteOwnerId, p.noteId]);
  return r ? openJson(key(p), header(p), r.body_ciphertext, Kept) : { entries: [] };
}
/** Saves the record; with nothing left in it, the row goes too, so nothing says there ever was one. */
async function save(c: Db, p: Pick<Place, 'author' | 'noteOwnerId' | 'noteId'>, k: Kept): Promise<void> {
  if (!k.entries.length) { await forget(c, p.author.ownerId, p.noteOwnerId, p.noteId); return; }
  await exec(c, `INSERT INTO personal_notes (owner_id, note_owner_id, note_item_id, body_ciphertext) VALUES ($1,$2,$3,$4)
                 ON CONFLICT (owner_id, note_owner_id, note_item_id) DO UPDATE SET body_ciphertext = EXCLUDED.body_ciphertext`,
  [p.author.ownerId, p.noteOwnerId, p.noteId, sealJson(key(p), header(p), toJson(k))]);
}
async function change(p: Place, fn: (k: Kept) => Kept): Promise<void> {
  await tx(p.author.pool, async (c) => {
    await hold(c, p.author.ownerId, p.noteId);
    await p.holdNote(c);
    const before = await load(c, p);
    const after = fn(before);
    if (after !== before) await save(c, p, after);
  });
}

/** Deletes someone's own notes on a note, in the caller's transaction. */
export const forget = (db: Db, authorId: string, noteOwnerId: string, noteId: string) =>
  exec(db, 'DELETE FROM personal_notes WHERE owner_id = $1 AND note_owner_id = $2 AND note_item_id = $3', [authorId, noteOwnerId, noteId]);

/**
 * Deletes the own notes of anyone who wrote some during a call and didn't end up with its note: taken off the invite when
 * they were removed from the call. The note's organizer has theirs by owning it. Found by the keyed hash of the
 * address, so it opens nothing. In the transaction that gives everyone the note.
 */
export const dropUnheld = (db: Db, noteOwnerId: string, noteId: string) => exec(db, `DELETE FROM personal_notes p WHERE p.note_owner_id = $1 AND p.note_item_id = $2 AND p.owner_id <> $1
  AND NOT EXISTS (SELECT 1 FROM note_access a JOIN identities i ON i.email_index = a.email_index WHERE a.owner_id = $1 AND a.note_item_id = $2 AND i.owner_id = p.owner_id)`, [noteOwnerId, noteId]);

/** The additions a note has now: what someone took back, or the organizer removed, is no longer in the notes. */
export async function additionIds(db: Db, noteOwnerId: string, noteId: string): Promise<Set<string>> {
  const found = await rows(db, z.object({ addition_id: z.string() }), 'SELECT addition_id FROM note_additions WHERE owner_id = $1 AND note_item_id = $2', [noteOwnerId, noteId]);
  return new Set(found.map((r) => r.addition_id));
}

/* ---------- what the person does ---------- */

/** Reaching your own notes by the note: anyone who has it, however they got it. */
export const inNote = (o: Owner, l: Located): Place => ({
  author: o, noteOwnerId: l.owner.ownerId, noteId: l.note.itemId, reader: () => Promise.resolve(noteReader(asRead(l))), holdNote: (c) => holdAccess(o, l, c)
});
export const ofNote = async (o: Owner, noteId: string): Promise<Place> => inNote(o, await locate(o, noteId));

/** An entry as its author sees it: what it points at as they may read it now, and whether the shared notes still have a copy. */
function shown(e: Entry, reader: Reader | undefined, inNotes: Set<string>): PersonalEntry {
  const base = { id: e.id, at: e.at, shared: e.shared && inNotes.has(e.shared.additionId) ? e.shared : null };
  if (e.kind === 'note') return { ...base, kind: 'note', text: e.text };
  if (e.kind === 'bookmark') {
    const s = reader?.source(e.anchor) ?? NOTHING;
    return { ...base, kind: 'bookmark', label: e.label, moment: s.moment, reach: s.reach };
  }
  return { ...base, kind: 'answer', question: e.question, answer: e.answer, moments: e.anchors.flatMap((a) => { const m = reader?.source(a).moment; return m ? [m] : []; }) };
}

export async function read(p: Place): Promise<PersonalNotes> {
  const k = await load(p.author.pool, p);
  if (!k.entries.length) return { noteId: p.noteId, entries: [] };
  const reader = k.entries.some((e) => e.kind !== 'note') ? await p.reader() : undefined;
  const inNotes = await additionIds(p.author.pool, p.noteOwnerId, p.noteId);
  plog.debug('own notes read', { noteId: p.noteId, entries: k.entries.length });
  return { noteId: p.noteId, entries: k.entries.map((e) => shown(e, reader, inNotes)) };
}

/** Puts something in your own notes. A bookmark of a line or a screen already bookmarked changes nothing. */
export async function add(p: Place, input: PersonalInput): Promise<PersonalNotes> {
  return (await addEntry(p, input)).notes;
}

/** The ID is selected under the same lock as insertion, so concurrent additions cannot swap receipts. */
export async function addEntry(p: Place, input: PersonalInput): Promise<{ notes: PersonalNotes; entryId: string }> {
  const ctx = { noteId: p.noteId };
  const base = { id: id128(), at: new Date().toISOString(), shared: null };
  const made = async (): Promise<Entry> => {
    if (input.kind === 'note') return { ...base, kind: 'note', text: input.text };
    const reader = await p.reader();
    if (input.kind === 'answer') {
      // A moment the asker can't read isn't kept: an answer only ever points at what they may open.
      const anchors = input.points.flatMap((x) => { const a = reader.anchor(x); return a ? [a] : []; });
      return { ...base, kind: 'answer', question: input.question, answer: input.answer, anchors };
    }
    const anchor = input.point ? reader.anchor(input.point) : reader.now();
    if (!anchor) throw input.point ? notFound('That moment', ctx) : new ValidationError('Bookmark a line or a shared screen.', { context: ctx });
    return { ...base, kind: 'bookmark', label: input.label, anchor };
  };
  const entry = await made();
  let entryId = entry.id;
  await change(p, (k) => {
    if (entry.kind === 'bookmark' && entry.anchor.kind !== 'moment') {
      const existing = k.entries.find((e) => e.kind === 'bookmark' && JSON.stringify(e.anchor) === JSON.stringify(entry.anchor));
      if (existing) { entryId = existing.id; return k; }
    }
    if (k.entries.length >= MAX_PERSONAL_ENTRIES) throw new ConflictError('Your notes on this call are full. Delete something to keep more.', { context: { ...ctx, entries: k.entries.length } });
    return { entries: [...k.entries, entry] };
  });
  plog.info('own notes changed', { ...ctx, change: 'added' });
  return { notes: await read(p), entryId };
}

/** Changes what you wrote, or what a bookmark is called. A kept answer stays as it was. */
export async function edit(p: Place, entryId: string, text: string): Promise<PersonalNotes> {
  const ctx = { noteId: p.noteId, entryId };
  await change(p, (k) => {
    const e = k.entries.find((x) => x.id === entryId);
    if (!e) throw notFound('That', ctx);
    if (e.kind === 'answer') throw new ConflictError('A kept answer stays as it was. You can delete it.', { context: ctx });
    if (e.kind === 'note' && !text) throw new ValidationError('Write something, or delete it.', { context: ctx });
    if (e.kind === 'bookmark' && text.length > MAX_BOOKMARK_LABEL) throw new ValidationError('That’s too long for a bookmark. Write it as a note instead.', { context: ctx });
    const next: Entry = e.kind === 'note' ? { ...e, text } : { ...e, label: text };
    return { entries: k.entries.map((x) => (x.id === entryId ? next : x)) };
  });
  plog.info('own notes changed', { ...ctx, change: 'edited' });
  return read(p);
}

/** Deletes something from your own notes. What was added to the shared notes from it stays there until it's taken back. */
export async function remove(p: Place, entryId: string): Promise<PersonalNotes> {
  const ctx = { noteId: p.noteId, entryId };
  await change(p, (k) => {
    if (!k.entries.some((x) => x.id === entryId)) throw notFound('That', ctx);
    return { entries: k.entries.filter((x) => x.id !== entryId) };
  });
  plog.info('own notes changed', { ...ctx, change: 'deleted' });
  return read(p);
}

/** One of this person's entries, for adding to the shared notes, read in the caller's transaction. Anyone else's isn't there to find. */
export async function entryOf(c: Db, p: Pick<Place, 'author' | 'noteOwnerId' | 'noteId'>, entryId: string): Promise<Entry> {
  const e = (await load(c, p)).entries.find((x) => x.id === entryId);
  if (!e) throw notFound('That', { noteId: p.noteId, entryId });
  return e;
}
/** Says the shared notes have a copy of an entry, in the transaction that adds it. */
export async function markShared(c: Db, p: Pick<Place, 'author' | 'noteOwnerId' | 'noteId'>, entryId: string, shared: { additionId: string; at: string }): Promise<void> {
  const k = await load(c, p);
  await save(c, p, { entries: k.entries.map((e) => (e.id === entryId ? { ...e, shared } : e)) });
}
