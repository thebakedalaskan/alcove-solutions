/*
 * Who has a note (docs: Privacy, keys and sessions › Who can read a note). A note lives in its organizer's vault. Everyone
 * invited to its call gets it when the call ends, and anyone who has it can share it on, by address, with one of their
 * groups, or by a link whoever opens signed in (./links/links.ts, ./sharing.ts); the note keeps, sealed, who shared it with
 * whom, the group's name or that it was a link, and when. Who else may read it is kept in note_access as keyed email hashes.
 * Someone else's note is opened with its organizer's keys, and only after that check. Its organizer can also make it visible
 * to their team (`team_notes`): everyone live-licensed on that team reads it and asks about it, and changes nothing
 * (`locateToRead` finds it; `locate`, which everything that changes a note uses, refuses it).
 */
import { type GroupShare, type NoteSummary, type Person, type Received, type Recipient } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../../platform/context';
import { b64u } from '../../keys/crypto';
import { bytea, exec, maybeOne, rows, timestamp, type Db } from '../../platform/db';
import { ForbiddenError, notFound } from '../../platform/errors';
import { findOwner } from '../../keys/owners';
import { findItem, findItems, getItem, listItems, type Loaded } from '../../keys/vault';
import { me, profile } from '../profile/profile';
import { personOf } from '../profile/portraits';
import { licensedOn, teamReaders } from '../billing/teams/teams';
import { NoteManifest, emailIndex, Sharer, same, actionsOf } from './manifest';

/* ---------- finding a note: your own, or one you have access to ---------- */

/** A note and the vault it lives in: your own, or someone else's that you have under your address `as`. */
export type Located =
  | { owner: Owner; note: Loaded<NoteManifest>; mine: true }
  | { owner: Owner; note: Loaded<NoteManifest>; mine: false; as: string };
/**
 * Someone else's note its organizer made visible to the team the reader is live-licensed on (`teamId`), since `at`: it's
 * theirs to read and ask about, and nothing more (docs: Plans and usage › Team).
 */
export interface TeamLocated { owner: Owner; note: Loaded<NoteManifest>; mine: false; team: { teamId: string; at: string } }
/** A note as someone may read it: their own, given to them, or their team's. */
export type Seen = Located | TeamLocated;
export const viaTeam = (l: Seen): l is TeamLocated => 'team' in l;
const AccessRow = z.object({ owner_id: z.string(), note_item_id: z.string() });
const TeamNoteRow = z.object({ owner_id: z.string(), note_item_id: z.string(), created_at: timestamp });
/** What every change to a note refuses someone who has it only through their team. */
export const TEAM_READS = 'This note is visible to your team to read and ask about. Only its organizer changes it.';

/**
 * A note as this person may read it. A transcript that's to be deleted once the notes are written is there to write
 * them from, for its organizer: everyone else gets the notes, and never reads it, by any path. That goes for the main
 * room's and every breakout room's, which any of them may still hold while its notes can't be written.
 */
export function asRead(l: Seen): NoteManifest {
  const m = l.note.manifest;
  return l.mine || m.keep.transcript ? m : { ...m, transcript: m.transcript === null ? null : [], rooms: m.rooms.map((r) => ({ ...r, transcript: [] })) };
}

/** The IDs of every note this person has, their own and ones shared with them, without opening any vault. */
export async function heldNoteIds(o: Owner): Promise<Set<string>> {
  const Id = z.object({ id: z.string() });
  const own = await rows(o.pool, Id, `SELECT item_id AS id FROM items WHERE owner_id = $1 AND kind = 'note' AND deleted_at IS NULL`, [o.ownerId]);
  const shared = await rows(o.pool, Id, 'SELECT note_item_id AS id FROM note_access WHERE email_index = $1 AND owner_id <> $2', [emailIndex(o, await myEmail(o)), o.ownerId]);
  return new Set([...own, ...shared].map((r) => r.id));
}

/** The address someone has other people's notes under: their profile's, which follows their sign-in. */
export const myEmail = async (o: Owner): Promise<string> => (await profile(o)).email;

/**
 * Every note someone else gave you, by invitation or by sharing it with you: each found by the index of
 * your address `as` right now, or only those among `among`. Each organizer's keys are opened once, however many of their
 * notes you have.
 */
export async function sharedWithMe(o: Owner, as: string, among?: readonly string[]): Promise<Located[]> {
  const access = among === undefined
    ? await rows(o.pool, AccessRow, 'SELECT owner_id, note_item_id FROM note_access WHERE email_index = $1 AND owner_id <> $2', [emailIndex(o, as), o.ownerId])
    : await rows(o.pool, AccessRow, 'SELECT owner_id, note_item_id FROM note_access WHERE email_index = $1 AND owner_id <> $2 AND note_item_id = ANY($3::text[])', [emailIndex(o, as), o.ownerId, [...among]]);
  const owners = new Map<string, Owner | undefined>();
  const out: Located[] = [];
  for (const a of access) {
    const owner = owners.has(a.owner_id) ? owners.get(a.owner_id) : await findOwner(o, a.owner_id, undefined);
    owners.set(a.owner_id, owner);
    // Deleted since its row was read, on its own or with its organizer's account: nobody has it any more.
    const note = owner && await findItem(owner, owner.pool, 'note', a.note_item_id, NoteManifest);
    if (owner && note) out.push({ owner, note, mine: false, as });
  }
  return out;
}
/** Every note this person has: their own, and other people's they have under their address `as`. */
export async function everyNote(o: Owner, as: string): Promise<Located[]> {
  const own = (await listItems(o, o.pool, 'note', NoteManifest)).map((note): Located => ({ owner: o, note, mine: true }));
  return [...own, ...await sharedWithMe(o, as)];
}
/** Which of these notes this person has, as `everyNote` finds them, opening only those: their own, and given to them under `as`. */
export async function heldAmong(o: Owner, as: string, ids: ReadonlySet<string>): Promise<Located[]> {
  if (!ids.size) return [];
  const among = [...ids];
  const own = (await findItems(o, o.pool, 'note', among, NoteManifest)).map((note): Located => ({ owner: o, note, mine: true }));
  return [...own, ...await sharedWithMe(o, as, among)];
}

/**
 * How many of these notes, found earlier in this request, the asker can't read any more: deleted,
 * or (someone else's) no longer given to them. An answer that took a while to write is checked with
 * this before it's sent, since it may quote a note that went in the meantime.
 */
export async function goneSince(o: Owner, found: Seen[]): Promise<number> {
  const Count = z.object({ n: z.number() });
  const mine = found.filter((l) => l.mine).map((l) => l.note.itemId);
  const theirs = found.filter((l): l is Extract<Located, { mine: false }> => !l.mine && !viaTeam(l));
  const team = found.filter(viaTeam);
  // A team's note goes with the note, with its organizer making it not visible, or with the reader's license.
  const licensed = team.length ? await licensedOn(o.pool, o.ownerId) : null;
  const teamLeft = licensed && team.length
    ? (await maybeOne(o.pool, Count, `SELECT count(*)::int AS n FROM team_notes t
        JOIN unnest($2::text[], $3::text[]) AS x(owner_id, note_item_id) ON t.owner_id = x.owner_id AND t.note_item_id = x.note_item_id
        JOIN items i ON i.owner_id = t.owner_id AND i.item_id = t.note_item_id AND i.deleted_at IS NULL
        WHERE t.team_id = $1`, [licensed.teamId, team.map((l) => l.owner.ownerId), team.map((l) => l.note.itemId)]))?.n ?? 0
    : 0;
  const ownLeft = mine.length
    ? (await maybeOne(o.pool, Count, `SELECT count(*)::int AS n FROM items WHERE owner_id = $1 AND kind = 'note' AND deleted_at IS NULL AND item_id = ANY($2::text[])`, [o.ownerId, mine]))?.n ?? 0
    : 0;
  const givenLeft = theirs.length
    ? (await maybeOne(o.pool, Count, `SELECT count(*)::int AS n FROM note_access a
        JOIN unnest($2::text[], $3::text[]) AS t(owner_id, note_item_id) ON a.owner_id = t.owner_id AND a.note_item_id = t.note_item_id
        JOIN items i ON i.owner_id = a.owner_id AND i.item_id = a.note_item_id AND i.deleted_at IS NULL
        WHERE a.email_index = $1`, [emailIndex(o, await myEmail(o)), theirs.map((l) => l.owner.ownerId), theirs.map((l) => l.note.itemId)]))?.n ?? 0
    : 0;
  return found.length - ownLeft - givenLeft - teamLeft;
}
/** A note this person has, their own or given to them, or nothing. */
async function given(o: Owner, id: string, db: Db): Promise<Located | undefined> {
  const own = await maybeOne(db, z.object({ n: z.number() }), `SELECT 1 AS n FROM items WHERE owner_id = $1 AND item_id = $2 AND kind = 'note' AND deleted_at IS NULL`, [o.ownerId, id]);
  if (own) return { owner: o, note: await getItem(o, db, 'note', id, NoteManifest, 'Those notes'), mine: true };
  const as = await myEmail(o);
  const a = await maybeOne(db, AccessRow, 'SELECT owner_id, note_item_id FROM note_access WHERE note_item_id = $1 AND email_index = $2', [id, emailIndex(o, as)]);
  // No access, or access whose organizer deleted their account since it was read: nothing, either way.
  const owner = a && await findOwner(o, a.owner_id, undefined, db);
  return owner ? { owner, note: await getItem(owner, db, 'note', id, NoteManifest, 'Those notes'), mine: false, as } : undefined;
}
/** Where someone else's note is visible to the team this person is live-licensed on, without opening anything. */
async function onTeam(o: Owner, id: string, db: Db): Promise<{ row: z.infer<typeof TeamNoteRow>; teamId: string } | undefined> {
  const licensed = await licensedOn(db, o.ownerId);
  const row = licensed && await maybeOne(db, TeamNoteRow, `SELECT t.owner_id, t.note_item_id, t.created_at FROM team_notes t
    JOIN items i ON i.owner_id = t.owner_id AND i.item_id = t.note_item_id AND i.kind = 'note' AND i.deleted_at IS NULL
    WHERE t.note_item_id = $1 AND t.team_id = $2 AND t.owner_id <> $3`, [id, licensed.teamId, o.ownerId]);
  return licensed && row ? { row, teamId: licensed.teamId } : undefined;
}
/**
 * A note this person has, to change it (or anything of theirs on it): their own, or given to them. One they can only read
 * through their team is refused (`forbidden`); anything else is `not-found`, the same for a note that was never there.
 */
export async function locate(o: Owner, id: string, db: Db = o.pool): Promise<Located> {
  const l = await given(o, id, db);
  if (l) return l;
  if (await onTeam(o, id, db)) throw new ForbiddenError(TEAM_READS, { context: { noteId: id } });
  throw notFound('Those notes', { noteId: id });
}
/** A note this person may read and ask about: their own, given to them, or visible to the team they're live-licensed on. */
export async function locateToRead(o: Owner, id: string, db: Db = o.pool): Promise<Seen> {
  const l = await given(o, id, db);
  if (l) return l;
  const t = await onTeam(o, id, db);
  // Its organizer deleted their account since the row was read: it's gone.
  const owner = t && await findOwner(o, t.row.owner_id, undefined, db);
  if (!t || !owner) throw notFound('Those notes', { noteId: id });
  return { owner, note: await getItem(owner, db, 'note', id, NoteManifest, 'Those notes'), mine: false, team: { teamId: t.teamId, at: t.row.created_at.toISOString() } };
}

/**
 * The notes made visible to the team this person is live-licensed on that they don't have otherwise (`except`: what they
 * have), each opened with its organizer's keys, once for each organizer. None without a live license.
 */
export async function teamNotes(o: Owner, except: ReadonlySet<string>): Promise<TeamLocated[]> {
  const licensed = await licensedOn(o.pool, o.ownerId);
  if (!licensed) return [];
  const found = await rows(o.pool, TeamNoteRow, 'SELECT owner_id, note_item_id, created_at FROM team_notes WHERE team_id = $1 AND owner_id <> $2', [licensed.teamId, o.ownerId]);
  const owners = new Map<string, Owner | undefined>();
  const out: TeamLocated[] = [];
  for (const r of found) {
    if (except.has(r.note_item_id)) continue;
    const owner = owners.has(r.owner_id) ? owners.get(r.owner_id) : await findOwner(o, r.owner_id, undefined);
    owners.set(r.owner_id, owner);
    // Deleted since its row was read, on its own or with its organizer's account.
    const note = owner && await findItem(owner, owner.pool, 'note', r.note_item_id, NoteManifest);
    if (owner && note) out.push({ owner, note, mine: false, team: { teamId: licensed.teamId, at: r.created_at.toISOString() } });
  }
  return out;
}
/** Titles of whichever of these notes are the account's own, read together from their manifests. */
export async function ownNoteTitles(o: Owner, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  return new Map((await findItems(o, o.pool, 'note', ids, NoteManifest)).map((n) => [n.itemId, n.manifest.title]));
}
/** The title of a note the account has, someone else's included, by the check reading it takes, from its manifest alone. */
export async function noteTitle(o: Owner, id: string): Promise<string> { return (await locate(o, id)).note.manifest.title; }

/**
 * Keeps a note, and this person's way to it, in place until the transaction ends, or says they've gone: deleting the
 * note, or removing it from their notes, waits for what's being written with it, and then takes that too.
 */
export async function holdAccess(o: Owner, l: Located, db: Db): Promise<void> {
  const One = z.object({ n: z.number() });
  const noteId = l.note.itemId;
  const note = await maybeOne(db, One, `SELECT 1 AS n FROM items WHERE owner_id = $1 AND item_id = $2 AND kind = 'note' AND deleted_at IS NULL FOR KEY SHARE`, [l.owner.ownerId, noteId]);
  const given = l.mine || await maybeOne(db, One, 'SELECT 1 AS n FROM note_access WHERE owner_id = $1 AND note_item_id = $2 AND email_index = $3 FOR KEY SHARE', [l.owner.ownerId, noteId, emailIndex(o, l.as)]);
  if (!note || !given) throw notFound('Those notes', { noteId });
}

const Holder = z.object({ email_index: bytea });
/** Everyone who has the organizer's note now, besides the organizer, by the keyed hash of their address. */
export async function holders(owner: Owner, db: Db, noteId: string): Promise<Set<string>> {
  const found = await rows(db, Holder, 'SELECT email_index FROM note_access WHERE owner_id = $1 AND note_item_id = $2', [owner.ownerId, noteId]);
  return new Set(found.map((r) => b64u(r.email_index)));
}

/** Who shared a note on, as everyone sees them: the organizer as they are now, anyone else as they were when they shared it. */
const sharerOf = (s: Sharer, organizer: Person): Person => (s.id === organizer.id ? organizer : { ...personOf(s.email, s.name), id: s.id });

/**
 * Everyone who has a note, organizer first; then the people invited to its call (all of them while
 * it records, since they get it when it ends); then the people it was shared with, in the order they
 * got it, each with who shared it, the group's name and when. Whoever has since removed it from
 * their notes no longer has it, so isn't listed.
 */
export async function recipients(l: Seen, organizer: Person, db: Db = l.owner.pool): Promise<Recipient[]> {
  const m = l.note.manifest;
  const holding = await holders(l.owner, db, l.note.itemId);
  const holds = (email: string) => holding.has(b64u(emailIndex(l.owner, email)));
  // Someone invited who removed the notes and was given them again has them as shared now.
  const sharedTo = new Set(m.shared.map((s) => s.email));
  return [
    { person: organizer, role: 'organizer' },
    ...m.invited.filter((e) => !sharedTo.has(e) && (m.status === 'recording' || holds(e)))
      .map((e): Recipient => ({ person: personOf(e), role: 'invited', ...(m.endedAt ? { at: m.endedAt } : {}) })),
    ...m.shared.filter((s) => holds(s.email))
      .map((s): Recipient => ({ person: personOf(s.email), role: 'shared', by: sharerOf(s.by, organizer), ...(s.group ? { group: s.group } : {}), ...(s.link ? { link: true } : {}), at: s.at }))
  ];
}

/**
 * Who reads whatever is added to a note now: everyone who has it, organizer first, and, while its organizer has it visible to
 * their team, that team, by its ID, its name and how many people live-licensed on it aren't among them (`people`).
 */
export interface Audience { people: Person[]; team: { id: string; name: string; people: number } | null }
export async function audienceOf(l: Located, db: Db = l.owner.pool): Promise<Audience> {
  const people = (await recipients(l, await me(l.owner), db)).map((r) => r.person);
  const row = await maybeOne(db, z.object({ team_id: z.string() }), 'SELECT team_id FROM team_notes WHERE owner_id = $1 AND note_item_id = $2', [l.owner.ownerId, l.note.itemId]);
  const team = row && await teamReaders(l.owner, db, row.team_id, people.map((p) => emailIndex(l.owner, p.email)));
  return { people, team: row && team ? { id: row.team_id, ...team } : null };
}

/** How someone came to have a note that isn't theirs, from the address they have it under. */
export function receivedBy(m: NoteManifest, as: string, organizer: Person): Received {
  const s = m.shared.find((x) => same(x.email, as));
  if (s) return { role: 'shared', by: sharerOf(s.by, organizer), ...(s.group ? { group: s.group } : {}), ...(s.link ? { link: true } : {}), at: s.at };
  // Everyone else who has it was invited to the call, and got it when the call ended.
  return { role: 'invited', by: organizer, at: m.endedAt ?? m.startedAt };
}

/**
 * Each time someone shared the note with one of their groups, from the people who still have it: once
 * for each sharer and group (the latest time), newest first. Whoever has the note sees the same list.
 */
function groupSharesOf(who: Recipient[]): GroupShare[] {
  const shares = new Map<string, GroupShare>();
  for (const r of who) {
    if (r.role !== 'shared' || !r.by || !r.group || !r.at) continue;
    const key = `${r.by.email.toLowerCase()}\n${r.group}`;
    const had = shares.get(key);
    if (!had || Date.parse(r.at) > Date.parse(had.at)) shares.set(key, { by: r.by, group: r.group, at: r.at });
  }
  return [...shares.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Whether a note's organizer made it visible to their team (docs: Plans and usage › Team). */
export async function teamVisible(l: Seen): Promise<boolean> {
  return (await exec(l.owner.pool, 'SELECT 1 FROM team_notes WHERE owner_id = $1 AND note_item_id = $2', [l.owner.ownerId, l.note.itemId])) > 0;
}
/** How someone came to have a note that isn't theirs: given to them, or made visible to their team. */
const receivedOf = (l: Exclude<Seen, { mine: true }>, organizer: Person): Received =>
  (viaTeam(l) ? { role: 'team', by: organizer, at: l.team.at } : receivedBy(l.note.manifest, l.as, organizer));
export function summaryOf(l: Seen, organizer: Person, who: Recipient[], visible: boolean, seriesId: string | undefined): NoteSummary {
  const m = l.note.manifest;
  return {
    id: l.note.itemId, kind: m.kind, status: m.status, title: m.title, startedAt: m.startedAt, duration: m.duration,
    people: who.map((r) => r.person), sharedWith: who.filter((r) => r.role === 'shared').map((r) => r.person.email),
    excerpt: m.summary.split(/(?<=\.)\s/).slice(0, 2).join(' '),
    openActions: actionsOf(m).filter((a) => !a.done).length, totalActions: actionsOf(m).length,
    ...(m.meetingId && l.mine ? { meetingId: m.meetingId } : {}), ...(l.mine ? {} : { received: receivedOf(l, organizer) }),
    teamVisible: visible, ...(seriesId ? { seriesId } : {}), groupShares: groupSharesOf(who)
  };
}
export async function summary(l: Seen, seriesId: string | undefined): Promise<NoteSummary> {
  const organizer = await me(l.owner);
  return summaryOf(l, organizer, await recipients(l, organizer), await teamVisible(l), seriesId);
}
