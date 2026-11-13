/*
 * Who's invited to a call, so they can find it from their own account (docs: privacy-keys-and-sessions › Who can see a
 * call). A call lives in its organizer's vault. meeting_access lists everyone on its invite, one row each, by a keyed
 * hash of their address: a hash of its own (`invite`), so these rows can't be joined to accounts without the index key.
 * Someone's answer sits in their row, sealed under the organizer's keys, and so does the time they've asked to move the
 * call to, if they have. Someone else's call is opened with its organizer's keys, and only after that check, as notes are.
 */
import { RsvpSchema, type GuestAnswer, type Proposal, type Rsvp, type RsvpCounts } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../../platform/context';
import { b64u, blindIndex, fromUtf8, openRecord, sealRecord, stateKey, utf8, type RecordHeader } from '../../keys/crypto';
import { bytea, exec, maybeOne, rows, tx, type Db } from '../../platform/db';
import { ConflictError, ValidationError, notFound } from '../../platform/errors';
import { log } from '../../platform/log';
import { findOwner, indexKey } from '../../keys/owners';
import { findItem, findItems, lockItem, type Loaded } from '../../keys/vault';
import { profile } from '../profile/profile';
import { MeetingManifest, isOver, unjoined } from './service';

const alog = log.child({ component: 'access' });

/**
 * Whether a call's notes may go to an account its organizer lets in from the link: a real one, or any when the
 * organizer's own account is a demo one too. Demo sign-ins (Microsoft and single sign-on) check nobody, and Microsoft's
 * is one account everyone trying Alcove shares, so a real organizer's notes never reach them this way.
 */
export const notesCanGo = (asker: { sample: boolean }, organizer: { sample: boolean }) => !asker.sample || organizer.sample;
/**
 * Whether a call shows on the Home of an account its address is invited to: only between accounts of one kind. A real
 * organizer's calls stay out of demo accounts, as their notes do. A demo organizer is nobody anyone has checked, so
 * what they write doesn't land on a real person's Home either. The link still works for anyone they send it to.
 */
const sameKind = (asker: { sample: boolean }, organizer: { sample: boolean }) => asker.sample === organizer.sample;

const indexOf = (o: Owner, email: string) => Buffer.from(blindIndex(indexKey(o), 'invite', email));
/** Someone on an invite, as `Access` keys them: by their address's hash. */
export const inviteKey = (o: Owner, email: string): string => b64u(indexOf(o, email));

/* ---------- answers: sealed under the organizer's keys, each bound to its call and person ---------- */

const answerKey = (organizer: Owner, meetingId: string) => stateKey(organizer.root, organizer.ownerId, `meeting-answers:${meetingId}`);
const answerHeader = (organizer: Owner, meetingId: string, index: Uint8Array): RecordHeader => ({ v: 1, kind: 'meeting-answer', ownerId: organizer.ownerId, meetingId, emailIndex: b64u(index) });
/** Every answer is sealed at this length: three words of different lengths would otherwise say which one it was. */
const ANSWER_BYTES = 5;
const sealAnswer = (organizer: Owner, meetingId: string, index: Uint8Array, answer: Rsvp) => sealRecord(answerKey(organizer, meetingId), answerHeader(organizer, meetingId, index), utf8(answer.padEnd(ANSWER_BYTES)));
const openAnswer = (organizer: Owner, meetingId: string, index: Uint8Array, record: Uint8Array): Rsvp =>
  RsvpSchema.parse(fromUtf8(openRecord(answerKey(organizer, meetingId), answerHeader(organizer, meetingId, index), record)).trimEnd());

/*
 * A request to move the call: the time someone invited would rather it started, sealed in their row under the same key,
 * as a record of its own kind. It's a moment as `toISOString` writes one, so every request is the same length.
 */
const proposalHeader = (organizer: Owner, meetingId: string, index: Uint8Array): RecordHeader => ({ v: 1, kind: 'meeting-proposal', ownerId: organizer.ownerId, meetingId, emailIndex: b64u(index) });
const sealProposal = (organizer: Owner, meetingId: string, index: Uint8Array, startsAt: string) => sealRecord(answerKey(organizer, meetingId), proposalHeader(organizer, meetingId, index), utf8(startsAt));
const openProposal = (organizer: Owner, meetingId: string, index: Uint8Array, record: Uint8Array): string =>
  fromUtf8(openRecord(answerKey(organizer, meetingId), proposalHeader(organizer, meetingId, index), record));

/* ---------- the organizer's side: every change to who's invited ---------- */

/**
 * Makes these calls' rows match the guests they all have, in the transaction that changes them. People who stay keep
 * their answers; anyone taken off goes, answer and all. Each address is hashed once, however many calls it's on, and
 * it's one statement each way: a series of 60 calls with 300 people is 18,000 rows.
 */
export async function syncAccessOf(o: Owner, db: Db, meetingIds: string[], guests: string[]): Promise<void> {
  const want = guests.map((e) => indexOf(o, e));
  await exec(db, 'DELETE FROM meeting_access WHERE owner_id = $1 AND meeting_item_id = ANY($2::text[]) AND NOT (email_index = ANY($3::bytea[]))', [o.ownerId, meetingIds, want]);
  await exec(db, `INSERT INTO meeting_access (owner_id, meeting_item_id, email_index)
                  SELECT $1::alcove_owner_id, m::alcove_id128, i FROM unnest($2::text[]) AS m CROSS JOIN unnest($3::bytea[]) AS i ON CONFLICT DO NOTHING`, [o.ownerId, meetingIds, want]);
}
/** The same for one call. */
export const syncAccess = (o: Owner, db: Db, meetingId: string, guests: string[]): Promise<void> => syncAccessOf(o, db, [meetingId], guests);
/** Lets go of who's invited to calls that are over, answers and all. A call that's on again has its invite back, without them. */
export async function dropInvites(o: Owner, db: Db, meetingIds: string[]): Promise<number> {
  return meetingIds.length ? exec(db, 'DELETE FROM meeting_access WHERE owner_id = $1 AND meeting_item_id = ANY($2::text[])', [o.ownerId, meetingIds]) : 0;
}

/** Where someone invited stands: what they answered, and the time they've asked to move the call to. Null until they have. */
export interface Invitee { answer: Rsvp | null; proposal: string | null }
/** Everyone on a call's invite, by `inviteKey`, with where they stand. */
export type Access = ReadonlyMap<string, Invitee>;
const AccessRow = z.object({ meeting_item_id: z.string(), email_index: bytea, answer_ciphertext: bytea.nullable(), proposal_ciphertext: bytea.nullable() });

/** The invites of these calls of the organizer's, read together. */
export async function accessOf(organizer: Owner, meetingIds: string[]): Promise<ReadonlyMap<string, Access>> {
  const out = new Map<string, Map<string, Invitee>>();
  if (!meetingIds.length) return out;
  const found = await rows(organizer.pool, AccessRow, 'SELECT meeting_item_id, email_index, answer_ciphertext, proposal_ciphertext FROM meeting_access WHERE owner_id = $1 AND meeting_item_id = ANY($2::text[])', [organizer.ownerId, meetingIds]);
  for (const r of found) {
    const invite = out.get(r.meeting_item_id) ?? new Map<string, Invitee>();
    invite.set(b64u(r.email_index), {
      answer: r.answer_ciphertext ? openAnswer(organizer, r.meeting_item_id, r.email_index, r.answer_ciphertext) : null,
      proposal: r.proposal_ciphertext ? openProposal(organizer, r.meeting_item_id, r.email_index, r.proposal_ciphertext) : null
    });
    out.set(r.meeting_item_id, invite);
  }
  return out;
}

/** How `invited` people have answered, from a call's invite: anyone without an answer there is waiting. */
export function countsOf(access: Access | undefined, invited: number): RsvpCounts {
  const counts = { yes: 0, maybe: 0, no: 0 };
  for (const { answer } of access?.values() ?? []) if (answer) counts[answer]++;
  return { ...counts, waiting: Math.max(0, invited - counts.yes - counts.maybe - counts.no) };
}

/** The same counts from what each person answered. */
export function countsFrom(answers: readonly GuestAnswer[]): RsvpCounts {
  const counts = { yes: 0, maybe: 0, no: 0, waiting: 0 };
  for (const { answer } of answers) counts[answer ?? 'waiting']++;
  return counts;
}

/**
 * What each of a call's guests answered, and the times they've asked to move it to, in the order of `guests`: what only
 * its organizer sees. `keyOf` is `inviteKey` for the organizer, kept from one call to the next of a list.
 */
export function standing(access: Access | undefined, guests: readonly string[], keyOf: (email: string) => string): { answers: GuestAnswer[]; proposals: Proposal[] } {
  const each = guests.map((email) => ({ email, at: access?.get(keyOf(email)) }));
  return {
    answers: each.map(({ email, at }) => ({ email, answer: at?.answer ?? null })),
    proposals: each.flatMap(({ email, at }) => (at?.proposal ? [{ email, startsAt: at.proposal }] : []))
  };
}

/** Which of these addresses have said yes to this call: the one answer that's theirs to give, and nobody else's to assume. */
export async function saidYes(o: Owner, meetingId: string, emails: string[]): Promise<Set<string>> {
  const invite = (await accessOf(o, [meetingId])).get(meetingId);
  return new Set(emails.filter((e) => invite?.get(inviteKey(o, e))?.answer === 'yes'));
}

/**
 * Lets go of the times people asked to move these calls to: all of them when a call has moved, since they were asked of
 * where it was, or one person's (`email`) when the organizer keeps the time it has.
 */
export async function dropProposals(o: Owner, db: Db, meetingIds: string[], email?: string | undefined): Promise<number> {
  if (!meetingIds.length) return 0;
  if (email === undefined) return exec(db, 'UPDATE meeting_access SET proposal_ciphertext = NULL WHERE owner_id = $1 AND meeting_item_id = ANY($2::text[]) AND proposal_ciphertext IS NOT NULL', [o.ownerId, meetingIds]);
  return exec(db, 'UPDATE meeting_access SET proposal_ciphertext = NULL WHERE owner_id = $1 AND meeting_item_id = ANY($2::text[]) AND email_index = $3 AND proposal_ciphertext IS NOT NULL', [o.ownerId, meetingIds, indexOf(o, email)]);
}

/**
 * The invites of the calls an organizer is reading, with any whose rows don't match its guests brought into line first.
 * That's every call scheduled before this table existed: its guests are sealed, so only its organizer's keys can
 * fill it in. It's also a call whose rows went while it looked over, and that's on again.
 */
export async function reconcileAccess(o: Owner, meetings: Loaded<MeetingManifest>[]): Promise<ReadonlyMap<string, Access>> {
  const ids = meetings.map((m) => m.itemId);
  const found = await accessOf(o, ids);
  // Each address once: the calls of a series share their guests, and this runs on every read of Home.
  const keys = new Map<string, string>();
  const keyOf = (e: string) => { const k = keys.get(e) ?? inviteKey(o, e); keys.set(e, k); return k; };
  const stale = meetings.filter((m) => {
    const want = new Set(m.manifest.guests.map(keyOf));
    const has = found.get(m.itemId);
    return (has?.size ?? 0) !== want.size || [...want].some((k) => !has?.has(k));
  });
  if (!stale.length) return found;
  for (const { itemId } of stale) {
    await tx(o.pool, async (c) => {
      // Under the call's lock, from its guests as they are now: someone taken off while this was reading stays off.
      await lockItem(o, c, itemId);
      const now = await findItem(o, c, 'meeting', itemId, MeetingManifest);
      if (now) await syncAccess(o, c, itemId, now.manifest.guests);
    });
  }
  alog.info('invites brought up to date', { ownerId: o.ownerId, meetings: stale.length });
  return accessOf(o, ids);
}

/**
 * Forgets what a deleted account answered on other people's calls, and the times it asked to move them to, unless
 * another account still signs in with its address. The invites stay: they're the organizers', who put the address on them.
 */
export async function forgetAnswers(o: Owner, db: Db, email: string): Promise<number> {
  return exec(db, `UPDATE meeting_access SET answer_ciphertext = NULL, proposal_ciphertext = NULL WHERE email_index = $1 AND owner_id <> $2
                   AND (answer_ciphertext IS NOT NULL OR proposal_ciphertext IS NOT NULL)
                   AND NOT EXISTS (SELECT 1 FROM identities WHERE email_index = $3 AND owner_id <> $2)`, [indexOf(o, email), o.ownerId, blindIndex(indexKey(o), 'email', email)]);
}

/* ---------- the invited side: finding a call by your own address ---------- */

/** A vault someone may reach through their invites: it's still there, and they're allowed its calls. */
async function vaultOf(viewer: Owner, asker: { sample: boolean }, ownerId: string): Promise<Owner | undefined> {
  const organizer = await findOwner(viewer, ownerId, undefined);
  return organizer && sameKind(asker, await profile(organizer)) ? organizer : undefined;
}

/**
 * Whether a call's invite can go: it's past the cut-off, and not running over it, whose invite goes when it ends, in the
 * transaction that ends it.
 */
export const finished = (m: MeetingManifest): boolean => isOver(m) && m.status !== 'live';

/** A call on someone's invites, unless it's over: then it's nobody's to reach any more, and its rows go as they're read. */
async function stillOn(organizer: Owner, meetingId: string): Promise<Loaded<MeetingManifest> | undefined> {
  const meeting = await findItem(organizer, organizer.pool, 'meeting', meetingId, MeetingManifest);
  if (!meeting || !isOver(meeting.manifest)) return meeting;
  if (finished(meeting.manifest)) alog.debug('invites of a call that’s over removed', { meetingId, invites: await dropInvites(organizer, organizer.pool, [meetingId]) });
  return undefined;
}

/** Someone else's calls you're invited to, and the vault they live in. */
export interface InvitedBy { organizer: Owner; meetings: Loaded<MeetingManifest>[] }
/** How far ahead Upcoming lists other people's calls. Anyone can invite any address, so a Home has to end somewhere. */
const AHEAD_MS = 90 * 86_400_000;

const Invite = z.object({ owner_id: z.string(), meeting_item_id: z.string() });

/**
 * The calls Upcoming lists for someone from other people's vaults, found by their address's index as it is now, in the
 * next 90 days. Each organizer's keys are opened once and their calls read together, however many it is. A call started
 * now isn't listed until someone is in it, as for its organizer.
 */
export async function invitedMeetings(viewer: Owner): Promise<InvitedBy[]> {
  const asker = await profile(viewer);
  const invites = await rows(viewer.pool, Invite, 'SELECT owner_id, meeting_item_id FROM meeting_access WHERE email_index = $1 AND owner_id <> $2', [indexOf(viewer, asker.email), viewer.ownerId]);
  const until = Date.now() + AHEAD_MS;
  const out: InvitedBy[] = [];
  for (const ownerId of new Set(invites.map((i) => i.owner_id))) {
    const organizer = await vaultOf(viewer, asker, ownerId);
    if (!organizer) continue;
    const calls = await findItems(organizer, organizer.pool, 'meeting', invites.filter((x) => x.owner_id === ownerId).map((i) => i.meeting_item_id), MeetingManifest);
    const gone = calls.filter((m) => finished(m.manifest)).map((m) => m.itemId);
    if (gone.length) alog.debug('invites of calls that are over removed', { calls: gone.length, invites: await dropInvites(organizer, organizer.pool, gone) });
    const meetings = calls.filter((m) => !isOver(m.manifest) && !unjoined(m.manifest) && new Date(m.manifest.startsAt).getTime() <= until);
    if (meetings.length) out.push({ organizer, meetings });
  }
  return out;
}

/** Someone else's call that you're invited to. */
export interface Invited { organizer: Owner; meeting: Loaded<MeetingManifest> }

/**
 * One call someone's invited to and that isn't over, for them to read or answer. Anyone else gets what a call that
 * doesn't exist gets, its organizer included: an organizer's own calls are read from their own vault.
 */
export async function locateInvited(viewer: Owner, meetingId: string): Promise<Invited> {
  const asker = await profile(viewer);
  const row = await maybeOne(viewer.pool, Invite, 'SELECT owner_id, meeting_item_id FROM meeting_access WHERE meeting_item_id = $1 AND email_index = $2 AND owner_id <> $3', [meetingId, indexOf(viewer, asker.email), viewer.ownerId]);
  const organizer = row && await vaultOf(viewer, asker, row.owner_id);
  const meeting = organizer && await stillOn(organizer, meetingId);
  if (!organizer || !meeting) throw notFound('That meeting', { meetingId });
  return { organizer, meeting };
}

/**
 * Says whether you're coming to a call you're invited to. It goes in your row, sealed under the organizer's keys, and
 * replaces any answer you gave before. Google Calendar doesn't hear about it.
 */
export async function answer(viewer: Owner, meetingId: string, value: Rsvp): Promise<Invited> {
  const invited = await locateInvited(viewer, meetingId);
  const { organizer } = invited;
  const index = indexOf(viewer, (await profile(viewer)).email);
  const saved = await exec(viewer.pool, 'UPDATE meeting_access SET answer_ciphertext = $4 WHERE owner_id = $1 AND meeting_item_id = $2 AND email_index = $3',
    [organizer.ownerId, meetingId, index, sealAnswer(organizer, meetingId, index, value)]);
  // Taken off the invite since it was read.
  if (!saved) throw notFound('That meeting', { meetingId });
  alog.info('invitation answered', { meetingId });
  return invited;
}

/**
 * Asks the organizer to move a call you're invited to: the time goes in your row, sealed under their keys, and replaces
 * any you asked before. Only a call that hasn't started and has a time of its own can be asked, and only to a time
 * that's still to come and isn't the one it has. Google Calendar doesn't hear about it.
 */
export async function propose(viewer: Owner, meetingId: string, at: string): Promise<Invited> {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) throw new ValidationError('Pick a time to ask for.', { context: { meetingId } });
  const invited = await locateInvited(viewer, meetingId);
  const { organizer, meeting: { manifest: m } } = invited;
  if (m.status !== 'scheduled') throw new ConflictError('This call has started, so it can’t move now.', { context: { meetingId, status: m.status } });
  if (m.offer) throw new ConflictError('A time is still being picked for this call.', { context: { meetingId } });
  if (when.getTime() <= Date.now()) throw new ValidationError('Ask for a time that’s still to come.', { context: { meetingId } });
  if (when.getTime() === new Date(m.startsAt).getTime()) throw new ValidationError('That’s the time it has already.', { context: { meetingId } });
  const index = indexOf(viewer, (await profile(viewer)).email);
  const saved = await exec(viewer.pool, 'UPDATE meeting_access SET proposal_ciphertext = $4 WHERE owner_id = $1 AND meeting_item_id = $2 AND email_index = $3',
    [organizer.ownerId, meetingId, index, sealProposal(organizer, meetingId, index, when.toISOString())]);
  if (!saved) throw notFound('That meeting', { meetingId });
  alog.info('another time proposed', { meetingId });
  return invited;
}
