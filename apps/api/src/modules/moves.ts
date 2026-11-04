/*
 * Moving someone's place in a live call to another device (docs: Calls and recordings › Moving to another device).
 *
 * The device someone is on starts a move and gets a code for the new device's link (`/move#<code>`: the code is in
 * the fragment, which browsers never send, so no server or log sees it). Opening the link swaps the code for a claim
 * only that device holds, so the code works once. The new device says it's ready with its own random identity and
 * MLS key package (made there, and only usable there), and, for the organizer and invited people, while signed in
 * to the same account. The device being left then lets go: it stops its microphone and camera, leaves the room and
 * confirms. Only then does the new device come in, as the same person (calls.moveIn). Each step is checked against
 * the call as it is: someone removed, or whose place went elsewhere, can't move.
 *
 * Moves are rows in `call_moves`, found by the SHA-256 of their current secret, each sealed under the organizer's
 * keys (record kind `call-move`, bound to the call and the move). They run out by themselves and go with the call.
 *
 * The new device's identity is bound to its move: it must be new to the call when the device says it's ready, the
 * move brings in only that identity, and asking again for a ticket (a lost answer) only ever hands back the connection
 * this move made, as the person who moved. Requests about one move never wait on each other: each change is made only
 * if the move is still as that request read it (otherwise `409`, try again), and only one request at a time brings
 * the new device in.
 */
import { MOVE_CODE_SECONDS, MoveDeviceSchema, MoveMediaSchema, type CallState, type CallTicket, type MoveDevice, type MoveIn, type MoveMedia, type MoveOut, type MoveStage } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../context';
import { b64u, id128, openJson, random, sealJson, sha, stateKey, toJson, utf8 } from '../crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../db';
import { ConflictError, DatabaseError, ForbiddenError, NotFoundError } from '../errors';
import { log } from '../log';
import { openOwner } from '../owners';
import { me } from './account';
import * as calls from './calls';

const mlog = log.child({ component: 'moves' });

/** Once the link is opened, how long the new device has to be ready (signing in there first, if it must). */
const CLAIMED_SECONDS = 300;
/** Once the new device is ready, how long the device being left has to let go. */
const READY_SECONDS = 180;
/** Once the device being left has let go, how long the new device has to come in (and to ask for its ticket again). */
const RELEASED_SECONDS = 120;
/** How long one request has to bring the new device in; past that (it failed on the way) the move runs out. */
const ARRIVING_SECONDS = 30;

/** `arriving`: one request is bringing the new device in right now. It's still `released` as the devices see it. */
const Stage = z.enum(['open', 'claimed', 'ready', 'released', 'arriving', 'moved', 'cancelled']);
const shown = (s: z.infer<typeof Stage>): MoveStage => (s === 'arriving' ? 'released' : s);
/** A move as kept, sealed. */
const Move = z.object({
  /** The connection moving away, and the person it is (the same for every connection of theirs). */
  from: z.string(), person: z.string(),
  stage: Stage,
  /** Microphone and camera on the device being left, as it last said. */
  media: MoveMediaSchema,
  /** The new device, as it says itself. */
  device: MoveDeviceSchema.nullable(),
  /** The new device's connection, once it's ready: its random identity and MLS key package. */
  to: z.object({ identity: z.string(), keyPackage: z.string() }).nullable(),
  /** The new device was signed in to the account of whoever is moving when it said it was ready. */
  sameAccount: z.boolean()
});
type Move = z.infer<typeof Move>;
const Row = z.object({ owner_id: z.string(), call_id: z.string(), move_id: z.string(), expires_at: timestamp, body_ciphertext: bytea });
type Row = z.infer<typeof Row>;
const COLUMNS = 'owner_id, call_id, move_id, expires_at, body_ciphertext';

const key = (o: Owner, callId: string) => stateKey(o.root, o.ownerId, `call-move:${callId}`);
const header = (o: Owner, callId: string, moveId: string) => ({ v: 1 as const, kind: 'call-move', ownerId: o.ownerId, callId, moveId });
const hashOf = (secret: string) => sha(utf8(secret));
const newSecret = () => b64u(random(16));
const openMove = (o: Owner, r: Row): Move => openJson(key(o, r.call_id), header(o, r.call_id, r.move_id), r.body_ciphertext, Move);
const seal = (o: Owner, callId: string, moveId: string, m: Move) => sealJson(key(o, callId), header(o, callId, moveId), toJson(m));
const inSeconds = (s: number) => new Date(Date.now() + s * 1000);

/** The same wording for a code or claim that's run out, was used, or never was: it says nothing about which. */
const gone = (context: Record<string, string | number | boolean>) => new NotFoundError('This move has run out or was already used. Make a new code on your other device.', { context });

/** Every unexpired move in a call, open. */
async function movesIn(o: Owner, db: Db, callId: string, lock = false): Promise<{ row: Row; move: Move }[]> {
  const found = await rows(db, Row, `SELECT ${COLUMNS} FROM call_moves WHERE owner_id = $1 AND call_id = $2 AND expires_at > now()${lock ? ' FOR UPDATE' : ''}`, [o.ownerId, callId]);
  return found.map((row) => ({ row, move: openMove(o, row) }));
}
/** The unexpired move whose current secret this is, with its call's organizer opened; or nothing at all. It locks nothing. */
async function bySecret(d: Deps, secret: string): Promise<{ o: Owner; row: Row; move: Move } | undefined> {
  const row = await maybeOne(d.pool, Row, `SELECT ${COLUMNS} FROM call_moves WHERE secret_hash = $1 AND expires_at > now()`, [hashOf(secret)]);
  if (!row) return undefined;
  const o = await openOwner(d, row.owner_id, undefined);
  return { o, row, move: openMove(o, row) };
}
/**
 * Changes a move only if nobody has since it was read (its sealed body is still that one, and it hasn't run out): two
 * requests about one move never wait on each other, and the one that lost is told so. The row as changed, or null.
 */
async function change(o: Owner, db: Db, row: Row, m: Move, to: { secret?: string; expires: Date }): Promise<Row | null> {
  // Its own copy, as the row keeps it, so a later change can be made only if it's still this one.
  const body = new Uint8Array(seal(o, row.call_id, row.move_id, m));
  const n = await exec(db, `UPDATE call_moves SET body_ciphertext = $4, expires_at = $5${to.secret ? ', secret_hash = $7' : ''}
    WHERE owner_id = $1 AND call_id = $2 AND move_id = $3 AND body_ciphertext = $6 AND expires_at > now()`,
  [o.ownerId, row.call_id, row.move_id, body, to.expires, row.body_ciphertext, ...(to.secret ? [hashOf(to.secret)] : [])]);
  return n === 1 ? { ...row, body_ciphertext: body, expires_at: to.expires } : null;
}
/** A move's transaction, never kept waiting long for a lock another request holds: that's a 409 to try again. */
async function moveTx<T>(o: Owner, fn: (c: Db) => Promise<T>): Promise<T> {
  try {
    return await tx(o.pool, async (c) => { await exec(c, "SET LOCAL lock_timeout = '2s'"); return fn(c); });
  } catch (e) {
    if (e instanceof DatabaseError && e.context['pgCode'] === '55P03') throw new ConflictError('This move is busy. Try again in a moment.', { cause: e, context: { reason: 'busy' } });
    throw e;
  }
}
/** What a move's secret is counted under for rate limits: its hash, never the secret. */
export const limitKey = (secret: string): string => b64u(hashOf(secret));

/**
 * Whether `session` is the account of whoever is moving: the organizer's own, or an invited person's (by their sign-in
 * email, the way they were let in). A guest's move comes into no account.
 */
async function accountOf(o: Owner, mover: calls.Mover, session: Owner | undefined): Promise<MoveIn['account']> {
  if (mover.role === 'guest') return 'none';
  if (!session) return 'needed';
  if (mover.role === 'host') return session.ownerId === o.ownerId ? 'ok' : 'other';
  const email = (await me(session)).email.toLowerCase();
  return mover.email !== null && email === mover.email.toLowerCase() ? 'ok' : 'other';
}

/**
 * Who is moving, in a call that's still on, and still theirs to move: not removed, not turned away, and not taken
 * over by another tab or device.
 */
async function stillHere(o: Owner, callId: string, m: Pick<Move, 'from' | 'person'>) {
  const call = await calls.moverOf(o, callId, m.from);
  const mover = call.mover;
  if (!call.live || !mover || mover.person !== m.person || mover.removed || mover.replaced || mover.status === 'denied') return { call, mover: null };
  return { call, mover };
}

/** A move as the new device sees it. Once it has moved, whoever moved is the new device's connection. */
async function asIn(o: Owner, row: Row, m: Move, session: Owner | undefined, joined: { ticket: CallTicket; state: CallState } | null = null): Promise<MoveIn> {
  // Coming in, the new device's connection may already have taken the old one's place: then it's whoever is moving
  // (its identity was new to the call when it was ready, so in the call as this person it can only be this move's).
  const now = m.to ? { from: m.to.identity, person: m.person } : null;
  const first = await stillHere(o, row.call_id, m.stage === 'moved' && now ? now : m);
  const { call, mover } = !first.mover && now && (m.stage === 'released' || m.stage === 'arriving') ? await stillHere(o, row.call_id, now) : first;
  if (!mover) throw gone({ callId: row.call_id, reason: 'not-in-call' });
  return {
    stage: shown(m.stage), expiresAt: row.expires_at.toISOString(), title: call.title, organizerName: call.organizerName,
    you: { name: mover.name, role: mover.role }, account: await accountOf(o, mover, session), media: m.media, joined
  };
}

/* ---------- the device being left: by its call pass ---------- */

/**
 * Starts moving the person behind this pass to another device: a code for the new device's link, and any earlier
 * move of theirs in this call is over. The organizer moves only from their current connection with their own session
 * (as host powers go), invited people only together with their account's session; a guest's pass is all they have.
 */
export async function start(v: calls.Viewer, callId: string, media: MoveMedia, session: Owner | undefined): Promise<{ code: string; expiresAt: string }> {
  calls.requireIn(v, 'move');
  const o = v.organizer;
  const ctx = { callId, role: v.pass.role };
  const { mover } = await stillHere(o, callId, { from: v.pass.identity, person: v.pass.person });
  if (!mover || mover.status !== 'in') throw new ConflictError('You’re not in this call here any more.', { context: ctx });
  if (mover.role === 'host' && !v.isOrganizer) throw new ForbiddenError('Only the organizer’s own connection can move the organizer.', { context: ctx });
  if (mover.role === 'invited' && (await accountOf(o, mover, session)) !== 'ok') throw new ForbiddenError('Sign in to your account here to move to another device.', { context: ctx });
  const code = newSecret();
  const moveId = id128();
  const expires = inSeconds(MOVE_CODE_SECONDS);
  const m: Move = { from: mover.identity, person: mover.person, stage: 'open', media, device: null, to: null, sameAccount: false };
  const replaced = await moveTx(o, async (c) => {
    // One move at a time for each person: a new code makes every earlier one of theirs useless.
    const earlier = (await movesIn(o, c, callId, true)).filter((x) => x.move.person === mover.person);
    for (const x of earlier) await exec(c, 'DELETE FROM call_moves WHERE owner_id = $1 AND call_id = $2 AND move_id = $3', [o.ownerId, callId, x.row.move_id]);
    await exec(c, 'INSERT INTO call_moves (owner_id, call_id, move_id, secret_hash, expires_at, body_ciphertext) VALUES ($1,$2,$3,$4,$5,$6)',
      [o.ownerId, callId, moveId, hashOf(code), expires, seal(o, callId, moveId, m)]);
    return earlier.length;
  });
  mlog.info('move started', { ...ctx, moveId, replaced });
  return { code, expiresAt: expires.toISOString() };
}

/** This connection's own move, if it has one. */
async function mine(v: calls.Viewer, callId: string) {
  return (await movesIn(v.organizer, v.organizer.pool, callId)).find((x) => x.move.from === v.pass.identity && x.move.person === v.pass.person);
}

/** The move this connection started, as it stands now, or null once it has run out. */
export async function current(v: calls.Viewer, callId: string): Promise<MoveOut | null> {
  const x = await mine(v, callId);
  if (!x) return null;
  return { stage: shown(x.move.stage), expiresAt: x.row.expires_at.toISOString(), device: x.move.device, sameAccount: x.move.sameAccount };
}

/**
 * The device being left has let go: it stopped its microphone and camera and left the room. From now it's out of the
 * call (LiveKit is told too, in case it didn't get there), and the new device may come in.
 */
export async function confirm(v: calls.Viewer, callId: string, media: MoveMedia): Promise<void> {
  const o = v.organizer;
  const ctx = { callId, role: v.pass.role };
  const x = await mine(v, callId);
  if (!x || x.move.stage !== 'ready') throw new ConflictError('There’s no device ready to take over. Make a new code and try again.', { context: { ...ctx, stage: x?.move.stage ?? 'none' } });
  const { call, mover } = await stillHere(o, callId, x.move);
  if (!mover) throw new ConflictError('You’re not in this call here any more.', { context: ctx });
  // Released first, and only if the move is still ready (not called off meanwhile): then this connection lets go.
  if (!(await change(o, o.pool, x.row, { ...x.move, stage: 'released', media }, { expires: inSeconds(RELEASED_SECONDS) }))) {
    throw new ConflictError('There’s no device ready to take over. Make a new code and try again.', { context: { ...ctx, stage: 'changed' } });
  }
  // In the room no more, whatever the browser managed: its microphone reaches nobody from here on.
  if (call.roomName) await o.livekit.removeParticipant(call.roomName, mover.identity).catch((e: unknown) => mlog.debug('the connection that let go had already left the room', { ...ctx, err: e }));
  await calls.letGo(o, callId, mover);
  mlog.info('move let go', { ...ctx, moveId: x.row.move_id, host: call.hostIdentity === mover.identity, mic: media.mic, cam: media.cam });
}

/** Calls off this connection's move, if it hasn't happened yet. A code nobody opened just goes. */
export async function cancelOut(v: calls.Viewer, callId: string): Promise<void> {
  const o = v.organizer;
  const x = await mine(v, callId);
  if (!x) return;
  const ctx = { callId, moveId: x.row.move_id, stage: x.move.stage };
  if (x.move.stage === 'released' || x.move.stage === 'arriving' || x.move.stage === 'moved') throw new ConflictError('You’ve moved already.', { context: ctx });
  const done = x.move.stage === 'open'
    ? await exec(o.pool, 'DELETE FROM call_moves WHERE owner_id = $1 AND call_id = $2 AND move_id = $3 AND body_ciphertext = $4', [o.ownerId, callId, x.row.move_id, x.row.body_ciphertext]) === 1
    // Kept until it runs out, so the device that opened the link learns it was called off.
    : await change(o, o.pool, x.row, { ...x.move, stage: 'cancelled' }, { expires: x.row.expires_at }) !== null;
  if (!done) throw new ConflictError('The move changed just now. Try again.', { context: { ...ctx, reason: 'changed' } });
  mlog.info('move called off', { ...ctx, by: 'old' });
}

/* ---------- the new device: by the code from its link, then its claim ---------- */

/** The new device opens the link: its code is swapped for a claim only this device has, so the code works once. */
export async function claim(d: Deps, code: string, session: Owner | undefined): Promise<{ claim: string; move: MoveIn }> {
  const x = await bySecret(d, code);
  if (!x || x.move.stage !== 'open') throw gone({ reason: x ? x.move.stage : 'no-move' });
  const claimed = newSecret();
  const m: Move = { ...x.move, stage: 'claimed' };
  const row = await change(x.o, d.pool, x.row, m, { secret: claimed, expires: inSeconds(CLAIMED_SECONDS) });
  // Opened at the same moment somewhere else: the code works once.
  if (!row) throw gone({ callId: x.row.call_id, reason: 'claimed-elsewhere' });
  mlog.info('move opened on another device', { callId: row.call_id, moveId: row.move_id });
  return { claim: claimed, move: await asIn(x.o, row, m, session) };
}

/** The move as it stands, for the device holding its claim. */
export async function status(d: Deps, claimed: string, session: Owner | undefined): Promise<MoveIn> {
  const x = await bySecret(d, claimed);
  if (!x) throw gone({ reason: 'no-move' });
  return asIn(x.o, x.row, x.move, session);
}

/**
 * The new device is ready: its own identity and MLS key package, and for the organizer and invited people, signed in
 * to the same account. The device being left is asked to let go. Saying so again changes nothing.
 */
export async function ready(d: Deps, b: { claim: string; identity: string; keyPackage: string; device: MoveDevice }, session: Owner | undefined): Promise<MoveIn> {
  const x = await bySecret(d, b.claim);
  if (!x) throw gone({ reason: 'no-move' });
  const ctx = { callId: x.row.call_id, moveId: x.row.move_id, stage: x.move.stage };
  if (x.move.stage === 'ready' && x.move.to?.identity === b.identity) return asIn(x.o, x.row, x.move, session);
  if (x.move.stage !== 'claimed') throw new ConflictError(x.move.stage === 'cancelled' ? 'Your other device kept the call.' : 'This move has gone on without this device.', { context: ctx });
  const { mover } = await stillHere(x.o, x.row.call_id, x.move);
  if (!mover) throw gone({ ...ctx, reason: 'not-in-call' });
  const account = await accountOf(x.o, mover, session);
  if (account === 'needed' || account === 'other') throw new ForbiddenError('Sign in to your own account on this device to move here.', { context: { ...ctx, account } });
  // The new device's identity is its own, made there: never one the call already has (the organizer's, someone else's,
  // or this person's own), which would make this move hand over someone else's place.
  if ((await calls.moverOf(x.o, x.row.call_id, b.identity)).mover) {
    throw new ConflictError('This device can’t take your place. Make a new code on your other device and try again.', { context: { ...ctx, reason: 'identity-in-call' }, level: 'warn' });
  }
  const m: Move = { ...x.move, stage: 'ready', device: b.device, to: { identity: b.identity, keyPackage: b.keyPackage }, sameAccount: account === 'ok' };
  const row = await change(x.o, d.pool, x.row, m, { expires: inSeconds(READY_SECONDS) });
  if (!row) throw new ConflictError('This move changed while this device was getting ready. Try again.', { context: { ...ctx, reason: 'changed' }, level: 'info' });
  mlog.info('move ready on the new device', { callId: row.call_id, moveId: row.move_id, sameAccount: m.sameAccount });
  return asIn(x.o, row, m, session);
}

/**
 * The new device comes in, once the device being left has let go: as the same person, with the identity and key
 * package it sent when it was ready. Asking again (an answer lost on the way) hands back the same connection, never
 * a second one.
 */
export async function arrive(d: Deps, claimed: string, session: Owner | undefined): Promise<MoveIn> {
  const x = await bySecret(d, claimed);
  if (!x) throw gone({ reason: 'no-move' });
  const ctx = { callId: x.row.call_id, moveId: x.row.move_id, stage: x.move.stage };
  const to = x.move.to;
  if (!to || (x.move.stage !== 'released' && x.move.stage !== 'arriving' && x.move.stage !== 'moved')) {
    throw new ConflictError(x.move.stage === 'cancelled' ? 'Your other device kept the call.' : 'Your other device hasn’t let go yet.', { context: ctx, level: 'info' });
  }
  // Whoever is moving: the organizer and invited people only to a device signed in to their own account, here as when it said it was ready.
  const was = (await calls.moverOf(x.o, x.row.call_id, x.move.from)).mover;
  if (!was || was.person !== x.move.person || was.removed) throw gone({ ...ctx, reason: 'not-in-call' });
  const account = await accountOf(x.o, was, session);
  if (account === 'needed' || account === 'other') throw new ForbiddenError('Sign in to your own account on this device to move here.', { context: { ...ctx, account } });
  if (x.move.stage === 'moved') {
    // Asking again (the first answer was lost): only ever the connection this move made, as the person who moved.
    const made = (await calls.moverOf(x.o, x.row.call_id, to.identity)).mover;
    if (!made || made.person !== x.move.person || made.role !== was.role) throw gone({ ...ctx, reason: 'not-this-move' });
    return asIn(x.o, x.row, x.move, session, await calls.reissue(d, x.o, x.row.call_id, to.identity));
  }
  // One request at a time brings the new device in; any other asks again once it's in.
  const arriving = x.move.stage === 'released' ? await change(x.o, d.pool, x.row, { ...x.move, stage: 'arriving' }, { expires: inSeconds(ARRIVING_SECONDS) }) : null;
  if (!arriving) throw new ConflictError('Coming in now. Wait a moment.', { context: { ...ctx, reason: 'arriving' }, level: 'info' });
  let joined: { ticket: CallTicket; state: CallState };
  try {
    joined = await calls.moveIn(d, x.o, x.row.call_id, { identity: x.move.from, person: x.move.person }, to, x.move.media);
  } catch (e) {
    // Not in (the organizer's connection is coming back, say): released again, for this device to ask again.
    await change(x.o, d.pool, arriving, x.move, { expires: x.row.expires_at }).catch((err: unknown) => mlog.warn('move not released again after it couldn’t come in', { ...ctx, err }));
    throw e;
  }
  const m: Move = { ...x.move, stage: 'moved' };
  const row = await change(x.o, d.pool, arriving, m, { expires: inSeconds(RELEASED_SECONDS) });
  if (!row) mlog.warn('moved to another device, but the move changed meanwhile', ctx);
  mlog.info('moved to another device', { callId: x.row.call_id, moveId: x.row.move_id, role: joined.ticket.role });
  return asIn(x.o, row ?? arriving, m, session, joined);
}

/** The new device calls the move off, before the device being left has let go. */
export async function cancelIn(d: Deps, claimed: string): Promise<void> {
  const x = await bySecret(d, claimed);
  if (!x) throw gone({ reason: 'no-move' });
  const ctx = { callId: x.row.call_id, moveId: x.row.move_id, stage: x.move.stage };
  if (x.move.stage === 'released' || x.move.stage === 'arriving' || x.move.stage === 'moved') throw new ConflictError('Your other device has let go already. Join here, or go back to it and join again.', { context: ctx });
  if (!(await change(x.o, d.pool, x.row, { ...x.move, stage: 'cancelled' }, { expires: x.row.expires_at }))) throw new ConflictError('The move changed just now. Try again.', { context: { ...ctx, reason: 'changed' } });
  mlog.info('move called off', { ...ctx, by: 'new' });
}

/** Moves that have run out, wherever they got to, are deleted (upkeep). */
export function sweep(d: Deps): Promise<number> {
  return exec(d.pool, 'DELETE FROM call_moves WHERE expires_at <= now()');
}
