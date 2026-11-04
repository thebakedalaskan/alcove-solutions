/*
 * What people add to the shared notes from their own (docs: Notes and inference › Your own notes): the one way anything
 * leaves someone's own notes, and only by them saying so.
 *
 * A preview says exactly what would go, where and who gets it. Adding it needs the preview's seal, a keyed hash of the
 * entry, its moments and everyone who has the notes, so it can't go further than the person saw. Only that one entry's
 * words go, as they stand in the preview: never the rest of their notes, and never the question behind an answer. An answer
 * goes only if every moment behind it is in these notes, so whoever reads it can check it.
 *
 * What goes is a copy, under the note's organizer's keys like the note, in its own row and not in the note's manifest,
 * whose revisions stay until the note is deleted: taking it back deletes the row, and nothing of it is left. Each
 * reader's moments are read for them, each time. It stays when its author later removes the note or deletes their
 * account, as the notes they shared on do; it goes with the note.
 */
import { MAX_NOTE_ADDITIONS, type NoteAddition, type PromoteBody, type PromotionPreview, type Person } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { b64u, equalBytes, id128, jcs, mac, openJson, sealJson, stateKey, toJson, utf8 } from '../crypto';
import { bytea, exec, maybeOne, rows, tx, type Db } from '../db';
import { ConflictError, ForbiddenError, ValidationError, notFound } from '../errors';
import { log } from '../log';
import { lockItem } from '../vault';
import { me, profile } from './account';
import { audienceOf, locate, type Located } from './notes';
import * as personal from './personal';
import { personOf } from './portraits';

const alog = log.child({ component: 'additions' });

/** What an addition points at: only ever a line or a shared screen of its note. */
const Point = z.discriminatedUnion('kind', [z.object({ kind: z.literal('line'), lineId: z.string() }), z.object({ kind: z.literal('screen'), frameId: z.string() })]);
type Point = z.infer<typeof Point>;
const Stored = z.object({
  text: z.string(),
  /** Who added it, as they were then. Their account's ID says who may take it back. */
  by: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  at: z.string(),
  points: z.array(Point)
});
type Stored = z.infer<typeof Stored>;

const key = (owner: Owner, noteId: string) => stateKey(owner.root, owner.ownerId, `note-additions:${noteId}`);
const header = (owner: Owner, noteId: string, additionId: string) => ({ v: 1 as const, kind: 'note-addition', ownerId: owner.ownerId, noteId, additionId });
const Row = z.object({ addition_id: z.string(), body_ciphertext: bytea });
const opened = (owner: Owner, noteId: string, r: z.infer<typeof Row>) => openJson(key(owner, noteId), header(owner, noteId, r.addition_id), r.body_ciphertext, Stored);

/** What's been added to a note, as `readerId` reads it: the moments are read for them, now, and any they can't open aren't there. */
export async function of(l: Located, readerId: string): Promise<NoteAddition[]> {
  const noteId = l.note.itemId;
  const found = await rows(l.owner.pool, Row, 'SELECT addition_id, body_ciphertext FROM note_additions WHERE owner_id = $1 AND note_item_id = $2 ORDER BY added_at, addition_id', [l.owner.ownerId, noteId]);
  if (!found.length) return [];
  const reader = personal.noteReader(l.note.manifest);
  const organizer = await me(l.owner);
  const person = (by: Stored['by']): Person => (by.id === organizer.id ? organizer : personOf(by.email, by.name));
  return found.map((r) => {
    const a = opened(l.owner, noteId, r);
    return {
      id: r.addition_id, text: a.text, by: person(a.by), at: a.at, removable: l.mine || a.by.id === readerId,
      moments: a.points.flatMap((p) => { const s = reader.source(p); return s.moment ? [s.moment] : []; })
    };
  });
}

/** What a moment an entry reaches can be pointed at by: its line, or the shared screen when there's no line. */
function pointOf(s: personal.Source): Point | undefined {
  if (s.moment?.line) return { kind: 'line', lineId: s.moment.line.id };
  if (s.moment?.screen) return { kind: 'screen', frameId: s.moment.screen.id };
  return undefined;
}

/** What one entry would put in the shared notes: its own words and the moments everyone with the notes can open. */
function whatGoes(e: personal.Entry, reader: personal.Reader, ctx: { noteId: string; entryId: string }): { text: string; points: Point[] } {
  if (e.kind === 'note') return { text: e.text, points: [] };
  if (e.kind === 'bookmark') {
    const p = pointOf(reader.source(e.anchor));
    if (!p && !e.label) throw new ConflictError('This bookmark doesn’t point at anything in these notes, so there’s nothing to add.', { context: ctx });
    return { text: e.label, points: p ? [p] : [] };
  }
  const points = e.anchors.flatMap((a) => { const p = pointOf(reader.source(a)); return p ? [p] : []; });
  // The answer quotes the call. Each reader can check it only against moments the notes have, so without them it stays yours.
  if (!points.length || points.length < e.anchors.length) throw new ConflictError('This answer points at something that isn’t in these notes, so it stays yours. You can write it in your own words.', { context: { ...ctx, moments: e.anchors.length, found: points.length } });
  return { text: e.answer, points: [...new Map(points.map((p) => [JSON.stringify(p), p])).values()] };
}

/** Binds a preview to this entry, its moments and everyone who has the notes: it stops working once any of them changes. */
function sealOf(o: Owner, noteId: string, entryId: string, points: Point[], audience: Person[]): string {
  const people = audience.map((p) => p.email.toLowerCase()).sort();
  return b64u(mac(stateKey(o.root, o.ownerId, `promotion:${noteId}`), utf8(jcs(toJson({ entryId, points, people })))));
}

const NOT_WRITTEN = 'These notes are still being written. You can add this once they are.';

/** What adding one of your own entries to the shared notes would do. Nothing changes. */
export async function preview(o: Owner, noteId: string, entryId: string): Promise<PromotionPreview> {
  const l = await locate(o, noteId);
  const m = l.note.manifest;
  const ctx = { noteId, entryId };
  if (m.status !== 'ready') throw new ConflictError(NOT_WRITTEN, { context: { ...ctx, status: m.status } });
  const entry = await personal.entryOf(o.pool, personal.inNote(o, l), entryId);
  const reader = personal.noteReader(m);
  const { text, points } = whatGoes(entry, reader, ctx);
  const audience = await audienceOf(l);
  alog.debug('addition previewed', { ...ctx, audience: audience.length, moments: points.length });
  return {
    entryId, text, moments: points.flatMap((p) => { const s = reader.source(p); return s.moment ? [s.moment] : []; }),
    destination: { noteId, title: m.title }, audience, seal: sealOf(o, noteId, entryId, points, audience)
  };
}

/**
 * Adds one of your own entries to the shared notes, as previewed: what you chose, under your name, for everyone with them.
 * Your own stays yours, marked with where the copy is. Everything's read again under the note's lock, so the people the
 * preview showed are the people who get it.
 */
export async function addToShared(o: Owner, noteId: string, entryId: string, body: PromoteBody): Promise<void> {
  const owner = (await locate(o, noteId)).owner;
  const ctx = { noteId, entryId };
  const additionId = id128();
  const at = new Date().toISOString();
  const who = await profile(o);
  const { audience, moments } = await tx(o.pool, async (c) => {
    await personal.hold(c, o.ownerId, noteId);
    await lockItem(owner, c, noteId);
    const l = await locate(o, noteId, c);
    const m = l.note.manifest;
    if (m.status !== 'ready') throw new ConflictError(NOT_WRITTEN, { context: { ...ctx, status: m.status } });
    const place = personal.inNote(o, l);
    const entry = await personal.entryOf(c, place, entryId);
    if (entry.shared && (await personal.additionIds(c, owner.ownerId, noteId)).has(entry.shared.additionId)) {
      throw new ConflictError('That’s in the shared notes already. Take it back from them to add it again.', { context: ctx });
    }
    const { points } = whatGoes(entry, personal.noteReader(m), ctx);
    const people = await audienceOf(l, c);
    // Compared as text, in constant time: it's a keyed hash either way.
    if (!equalBytes(utf8(sealOf(o, noteId, entryId, points, people)), utf8(body.seal))) {
      throw new ConflictError('Who has these notes changed since the preview, or what this points at did. Look again before you add it.', { context: { ...ctx, audience: people.length } });
    }
    if (!body.text && !points.length) throw new ValidationError('Say what to add.', { context: ctx });
    const n = await maybeOne(c, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM note_additions WHERE owner_id = $1 AND note_item_id = $2', [owner.ownerId, noteId]);
    if ((n?.n ?? 0) >= MAX_NOTE_ADDITIONS) throw new ConflictError('These notes can’t take any more additions.', { context: ctx });
    const stored: Stored = { text: body.text, by: { id: o.ownerId, name: who.name, email: who.email }, at, points };
    await exec(c, 'INSERT INTO note_additions (owner_id, note_item_id, addition_id, body_ciphertext) VALUES ($1,$2,$3,$4)',
      [owner.ownerId, noteId, additionId, sealJson(key(owner, noteId), header(owner, noteId, additionId), toJson(stored))]);
    await personal.markShared(c, place, entryId, { additionId, at });
    return { audience: people.length, moments: points.length };
  });
  alog.info('added to the shared notes', { ...ctx, additionId, audience, moments, mine: owner.ownerId === o.ownerId });
}

/** Holds an addition for the rest of the transaction, or says it isn't on this note. */
async function held(owner: Owner, c: Db, noteId: string, additionId: string) {
  const r = await maybeOne(c, Row, 'SELECT addition_id, body_ciphertext FROM note_additions WHERE owner_id = $1 AND note_item_id = $2 AND addition_id = $3 FOR UPDATE', [owner.ownerId, noteId, additionId]);
  if (!r) throw notFound('That', { noteId, additionId });
  return r;
}

/**
 * Takes something out of the shared notes, for everyone, for good: whoever added it can, and so can the organizer, whose
 * notes they are. The author's own entry stays theirs, and can be added again.
 */
export async function takeBack(o: Owner, noteId: string, additionId: string): Promise<void> {
  const l = await locate(o, noteId);
  await tx(l.owner.pool, async (c) => {
    await lockItem(l.owner, c, noteId);
    const a = opened(l.owner, noteId, await held(l.owner, c, noteId, additionId));
    if (!l.mine && a.by.id !== o.ownerId) throw new ForbiddenError('Only whoever added it, or the organizer, can take it out of the notes.', { context: { noteId, additionId } });
    await exec(c, 'DELETE FROM note_additions WHERE owner_id = $1 AND note_item_id = $2 AND addition_id = $3', [l.owner.ownerId, noteId, additionId]);
  });
  alog.info('taken out of the shared notes', { noteId, additionId, mine: l.mine });
}
