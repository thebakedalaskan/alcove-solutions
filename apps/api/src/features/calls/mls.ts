import { CallBackBodySchema, CallCommitBodySchema, CallKeyPackageBodySchema, CallMessageBodySchema, MAIN_PLACE, type CallMessageReceipt, type CallMls, type CallMlsGroup, type CallMlsItem } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../context';
import { exec, rows, tx } from '../../db';
import { ConflictError, ValidationError } from '../../errors';
import * as space from './workspace';
import { addToInvite } from '../meetings/invites';
import { chatSince, committerOf, departedFrom, epochIn, groupOf, needsKeys, pendingFor, placeOf, placesOf, placesTaken } from './places';
import { callFull } from './joining';
import { limitsNow } from '../../limits';
import * as rings from './rings';
import { log } from '../../log';
import { requireIn, type Viewer } from './participants';
import { load, mayComeBack, saveSettled, settle, type Row, type Stored, withPerson } from './state';
import { MlsRow, appendMls, openMls } from './mls-log';
import { stillHosting } from './permissions';
import { afterClosing, syncBoardSeats, syncRoomBoards } from './room-boards';
import { tellRoom } from './notifications';
import { ARRIVAL_MS, arrivals } from './lifecycle';

const clog = log.child({ component: 'calls' });

/* ---------- end-to-end encryption: the API orders and relays the call's MLS messages, and never reads them ---------- */

/** At most this many entries of the log in one answer; `more` says to ask again. */
const MLS_PAGE = 100;

/**
 * The call's MLS log after `after`, as this person may see it. The host's browser reads every group's commits from
 * the start of the generation, and chat only from the part of the call it's in, since it got there; whom it may add to
 * each group comes with that person's latest key package, however long ago it arrived. Anyone else reads only the group
 * of the part of the call they're in: their welcome into it, its commits, and its chat while they're there, since they
 * last got there. Read up to the call's last seq as it stood, so nothing is skipped or sent twice. Also where they stand
 * and where they are, and for the host's browser whom to let into each group and take out of it.
 */
export async function mlsSync(v: Viewer, callId: string, after: number): Promise<CallMls> {
  const o = v.organizer;
  const { row, state } = await load(o, o.pool, callId);
  // Rooms whose time is up have closed for the keys too: nobody is in their groups any more.
  const s = settle(state, row);
  const gen = row.mls_generation;
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  // Where they stand as of this read, not the pass check's: the host's browser may have let them in in between. The
  // connection that hosts gets the committer's view: it makes and commits every group in this generation.
  const hosting = v.isHost && s.host === v.pass.identity;
  // An organizer's connection that's gone while someone stands in: joining again takes the call back.
  const away = mine?.role === 'host' && mine.status === 'left' && !s.people.some((j) => j.role === 'host' && j.status === 'in');
  const admission = hosting || mine?.status === 'in' ? 'in' : mine?.status === 'waiting' ? 'waiting' : away && row.state === 'live' ? 'away' : mine && mayComeBack(mine) ? 'out' : 'denied';
  const place = mine ? placeOf(s, mine) : MAIN_PLACE;
  const group = mine ? groupOf(s, mine) : null;
  const quiet: CallMls = { generation: gen, admission, committer: committerOf(s), place, group, groups: [], items: [], earlierChat: false, keys: false, latest: after, more: false };
  if (admission !== 'in' || row.state !== 'live' || !mine) return quiet;
  const keys = needsKeys(s, gen, mine);
  const from = after;
  let found: z.infer<typeof MlsRow>[];
  if (hosting) {
    found = await rows(o.pool, MlsRow,
      `SELECT seq, kind, party, grp, epoch, body_ciphertext FROM call_mls WHERE owner_id = $1 AND call_id = $2 AND generation = $3 AND seq > $4 AND seq <= $5
         AND (kind = 'commit' OR (kind = 'message' AND ((grp = $6 AND seq > $7) OR party = $8))) ORDER BY seq LIMIT ${MLS_PAGE}`,
      [o.ownerId, callId, gen, from, row.mls_seq, place, mine.placedSeq, v.pass.identity]);
  } else {
    // Chat only from since they last came into this part of the call: someone moved out and straight back before their
    // removal was committed doesn't get what was said while they were away. Own previously submitted ciphertexts are
    // returned for exact-connection confirmation even between groups; they never grant another room's history.
    found = await rows(o.pool, MlsRow,
      `SELECT seq, kind, party, grp, epoch, body_ciphertext FROM call_mls WHERE owner_id = $1 AND call_id = $2 AND generation = $3 AND seq > $4 AND seq <= $5
         AND ((grp = $6 AND seq >= $8 AND (kind = 'commit' OR (kind = 'welcome' AND party = $7) OR (kind = 'message' AND $9 AND seq > $10)))
           OR (kind = 'message' AND party = $7)) ORDER BY seq LIMIT ${MLS_PAGE}`,
      [o.ownerId, callId, gen, from, row.mls_seq, group, v.pass.identity, mine.from, place === group, mine.placedSeq]);
  }
  const items: CallMlsItem[] = [];
  for (const r of found) if (r.grp !== null && r.kind !== 'keypackage') items.push({ kind: r.kind, seq: r.seq, group: r.grp, epoch: r.epoch, body: openMls(o, callId, r) });
  const more = found.length === MLS_PAGE;
  const latest = more ? (found.at(-1)?.seq ?? from) : Math.max(from, row.mls_seq);
  const groups: CallMlsGroup[] = hosting ? await groupsFor(o, callId, row, s)
    : group === null ? [] : [{ id: group, epoch: epochIn(row.mls_epoch, s, group) ?? 0, pending: [], departed: [] }];
  const out: CallMls = { ...quiet, groups, items, latest, more, keys, earlierChat: (hosting || place === group) && mine.chatBefore };
  clog.debug('call keys synced', {
    callId, generation: gen, admission, groups: groups.length, items: items.length, more, after,
    departed: groups.reduce((n, g) => n + g.departed.length, 0), pending: groups.reduce((n, g) => n + g.pending.length, 0), room: place !== MAIN_PLACE, keys
  });
  return out;
}

/**
 * For the host's browser, every part of the call's group: its epoch, who to take out, and who it may add, each
 * with their latest key package. A key package can arrive before its owner may be added (someone being moved sends one
 * while still in their old group), so it's handed over with them rather than only as the log goes by.
 */
async function groupsFor(o: Owner, callId: string, row: Row, s: Stored): Promise<CallMlsGroup[]> {
  const gen = row.mls_generation;
  const pending = placesOf(s).map((p) => ({ place: p, people: s.people.filter(pendingFor(s, gen, p)) }));
  const ids = pending.flatMap((g) => g.people.map((j) => j.identity));
  const kps = ids.length ? await rows(o.pool, MlsRow,
    `SELECT DISTINCT ON (party) seq, kind, party, grp, epoch, body_ciphertext FROM call_mls WHERE owner_id = $1 AND call_id = $2 AND generation = $3 AND kind = 'keypackage' AND party = ANY($4::text[]) ORDER BY party, seq DESC`,
    [o.ownerId, callId, gen, ids]) : [];
  const kpOf = new Map(kps.flatMap((r): [string, string][] => (r.party ? [[r.party, openMls(o, callId, r)]] : [])));
  return pending.map((g) => ({
    id: g.place, epoch: epochIn(row.mls_epoch, s, g.place) ?? 0,
    pending: g.people.flatMap((j) => { const keyPackage = kpOf.get(j.identity); return keyPackage ? [{ id: j.identity, admit: j.admit, keyPackage }] : []; }),
    departed: s.people.filter(departedFrom(s, g.place)).map((j) => j.identity)
  }));
}

/**
 * A commit from the host's browser to one part of the call's group: who it adds and removes, and the welcome for whoever
 * it adds. The API takes exactly one commit per epoch for each group, in order, so every browser applies the same ones,
 * and only from the connection hosting in this generation, checked again here under the call's row lock: a host that
 * was replaced a moment ago can't slip one in. Everyone added must be someone the host's browser may add to that group
 * now (in no other group); anyone removed is out of that group, and nothing else; a commit adding nobody and removing
 * nobody just moves the keys on. Letting in someone who asked takes a place (docs: Plans and usage › Calls): a commit that
 * would let in more of them than the call has room for is refused, in the words joining a full call is (`callFull`).
 */
export async function mlsCommit(v: Viewer, callId: string, b: z.infer<typeof CallCommitBodySchema>): Promise<{ epoch: number }> {
  const o = v.organizer;
  const ctx = { callId, generation: b.generation, epoch: b.epoch, added: b.added.length, removed: b.removed.length, room: b.group !== MAIN_PLACE };
  /** The meeting, and who this put on its invite: a home made for the call lets them in too, as does each workspace made in it. */
  const invited: { meetingId: string; add: string[]; made: string[] } = { meetingId: '', add: [], made: [] };
  const { room, closed } = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
    let s = settle(state, row);
    stillHosting(v, s, ctx, committerOf(s));
    const epoch = epochIn(row.mls_epoch, s, b.group);
    if (epoch === undefined) throw new ConflictError('That room has closed.', { context: ctx, level: 'info' });
    if (b.generation !== row.mls_generation || b.epoch !== epoch) {
      throw new ConflictError('The call’s keys have moved on. Catch up and try again.', { context: { ...ctx, current: epoch, currentGeneration: row.mls_generation }, level: 'info' });
    }
    const may = pendingFor(s, row.mls_generation, b.group);
    const people = new Map(s.people.map((j) => [j.identity, j]));
    for (const id of b.added) {
      const j = people.get(id);
      // Nobody the organizer removed is added again, whichever connection of theirs is asking.
      if (!j || !may(j) || s.removed.includes(j.person)) throw new ValidationError('Someone in that commit isn’t waiting to join.', { context: ctx });
    }
    if (new Set(b.added).size !== b.added.length) throw new ValidationError('Someone is in that commit twice.', { context: ctx });
    if (b.added.length && !b.welcome) throw new ValidationError('Adding people needs a welcome for them.', { context: ctx });
    // Someone who asked takes a place as they're let in, and only while there's one: the people in the call, and those it's
    // letting in by itself, hold theirs already (`placesTaken`).
    const asked = new Set(b.added.flatMap((id) => { const j = people.get(id); return j?.status === 'waiting' && j.admit === 'ask' ? [j.person] : []; }));
    if (asked.size) {
      const most = (await limitsNow(o, c)).get('call.max_people');
      const here = placesTaken(s);
      if (here + asked.size > most) throw callFull(most, { ...ctx, people: here, asked: asked.size });
    }
    const at = row.mls_seq + 1;
    await appendMls(o, c, callId, { seq: at, generation: row.mls_generation, epoch: b.epoch, grp: b.group }, 'commit', null, b.commit);
    let seq = at;
    const welcomed = new Map<string, number>();
    for (const id of b.added) {
      seq += 1;
      welcomed.set(id, seq);
      if (b.welcome) await appendMls(o, c, callId, { seq, generation: row.mls_generation, epoch: b.epoch + 1, grp: b.group }, 'welcome', id, b.welcome);
    }
    if (b.group === MAIN_PLACE) {
      await exec(c, 'UPDATE calls SET mls_epoch = $3, mls_seq = $4, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, b.epoch + 1, seq]);
    } else {
      await exec(c, 'UPDATE calls SET mls_seq = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, seq]);
      const open = s.breakouts.open;
      if (open) s = { ...s, breakouts: { ...s.breakouts, open: { ...open, rooms: open.rooms.map((r) => (r.id === b.group ? { ...r, epoch: b.epoch + 1 } : r)) } } };
    }
    const now = Date.now();
    // Added: in that group from now (their key package is used up), reading its log from their welcome, and told whether
    // there was chat there they can't read. Newly let in: in the call, and in their part of it, from now.
    for (const id of b.added) {
      s = withPerson(s, id, (j) => ({
        ...j, status: 'in', group: b.group, keysFor: -1, from: welcomed.get(id) ?? seq, chatBefore: chatSince(s, j, b.group),
        ...(j.status === 'in' ? {} : { since: now, placedAt: now, placedSeq: at, wasIn: null })
      }));
    }
    // Taken out: out of that group, and nothing more. Leaving the call is the API's to say, not a commit's.
    for (const id of b.removed) s = withPerson(s, id, (j) => (j.group === b.group ? { ...j, group: null } : j));
    // Nobody in the call needs ringing: the ring goes the moment they're let in, so an arch becomes a tile with no gap.
    await rings.arrived(o, c, row.meeting_item_id, b.added.flatMap((id) => { const email = people.get(id)?.email; return email ? [email] : []; }));
    // Signed in and let in by the organizer, who saw who it was (they asked; nobody let in without asking counts):
    // added to the invite, so they get the notes like everyone invited. Only the organizer adds anyone to their invite:
    // whoever someone standing in lets in is in the call as a guest, without the notes. An address comes with an ask
    // only when the notes may go to it (see join).
    const signedIn = !v.isOrganizer ? [] : b.added.flatMap((id) => { const j = people.get(id); return j?.status === 'waiting' && j.admit === 'ask' && j.role === 'guest' && j.email ? [{ id, email: j.email }] : []; });
    if (signedIn.length) {
      const wanted = [...new Set(signedIn.map((x) => x.email))];
      const added = await addToInvite(o, c, { meetingId: row.meeting_item_id, noteId: s.notes.noteId }, wanted);
      for (const x of signedIn) if (added.includes(x.email)) s = withPerson(s, x.id, (j) => ({ ...j, role: 'invited' }));
      invited.meetingId = row.meeting_item_id;
      invited.add.push(...added);
      invited.made = s.workspace.made;
      clog.info('added to the invite', { callId, meetingId: row.meeting_item_id, noteId: s.notes.noteId, people: added.length });
      // The invite is full: they're in the call, as guests, without the notes.
      if (added.length < wanted.length) clog.warn('invite full; let in without the notes', { callId, meetingId: row.meeting_item_id, people: wanted.length - added.length });
    }
    return { room: row.room_name, closed: (await saveSettled(o, c, callId, state, s)).closed };
  });
  clog.info('call keys moved on', { ...ctx, next: b.epoch + 1, bytes: b.commit.length + (b.welcome?.length ?? 0) });
  if (invited.add.length) await space.followHome(o, invited.meetingId, invited, invited.made);
  // Rooms whose time ran out closed with it, and come back.
  return afterClosing({ organizer: o, callId }, closed, async () => {
    // Letting someone in doesn't wait for a workspace: a seat lands a moment later, and the call reads itself again when it does.
    if (b.added.length) { void syncBoardSeats({ organizer: o, callId }); if (!closed) void syncRoomBoards({ organizer: o, callId }); }
    await tellRoom(o, room, callId, { call: closed || b.added.length > 0 || b.removed.length > 0, log: true });
    if (b.added.length && room) {
      // Whoever was just let in should reach the room soon; anyone who doesn't (their tab closed while they asked) is taken out.
      const d: Deps = { cfg: o.cfg, pool: o.pool, objects: o.objects, livekit: o.livekit, hub: o.hub, docs: o.docs };
      const ownerId = o.ownerId;
      setTimeout(() => { arrivals(d, ownerId, callId, room, Date.now()).catch((err: unknown) => clog.warn('checking who reached the room failed', { callId, err })); }, ARRIVAL_MS + 1_000).unref();
    }
    return { epoch: b.epoch + 1 };
  });
}

/**
 * Chat, as an MLS message from someone in the group of the part of the call they're in: stored as it came, and
 * relayed to everyone in that group. Nobody chats into another part of the call, whoever hosts included.
 */
export async function mlsMessage(v: Viewer, callId: string, b: z.infer<typeof CallMessageBodySchema>, chat = true): Promise<CallMessageReceipt> {
  requireIn(v, 'chat');
  const o = v.organizer;
  const ctx = { callId, epoch: b.epoch, room: b.group !== MAIN_PLACE };
  const { room, closed, receipt } = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.', { context: ctx });
    const s = settle(state, row);
    const mine = s.people.find((j) => j.identity === v.pass.identity);
    // Whoever hosts is in every group, and chats only in the part of the call it's in; anyone else, in the group they're in.
    if (!mine || placeOf(s, mine) !== b.group || (mine.identity !== s.host && groupOf(s, mine) !== b.group)) throw new ValidationError('You’re in another part of the call now.', { context: ctx });
    const epoch = epochIn(row.mls_epoch, s, b.group);
    if (epoch === undefined || b.generation !== row.mls_generation || b.epoch > epoch) throw new ConflictError('The call’s keys have moved on. Catch up and try again.', { context: { ...ctx, current: epoch ?? null }, level: 'info' });
    const seq = row.mls_seq + 1;
    await appendMls(o, c, callId, { seq, generation: row.mls_generation, epoch: b.epoch, grp: b.group }, 'message', v.pass.identity, b.message);
    await exec(c, 'UPDATE calls SET mls_seq = $3 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, seq]);
    return { room: row.room_name, closed: (await saveSettled(o, c, callId, state, chat ? { ...s, chatAt: { ...s.chatAt, [b.group]: seq } } : s)).closed, receipt: { sent: true as const, generation: row.mls_generation, seq } };
  });
  // Sizes only: what was said is in the MLS message, which nobody here can read.
  clog.debug('chat relayed', { ...ctx, bytes: b.message.length });
  await afterClosing({ organizer: o, callId }, closed, () => tellRoom(o, room, callId, { call: closed, log: true }));
  return receipt;
}

/**
 * A fresh key package from someone already let in who's on their way into a group (after the connection that hosts
 * changed, or a move to another part of the call): the host's browser adds them with it.
 */
export async function mlsKeyPackage(v: Viewer, callId: string, b: z.infer<typeof CallKeyPackageBodySchema>): Promise<void> {
  requireIn(v, 'rejoin');
  const o = v.organizer;
  const r = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    const s = settle(state, row);
    const mine = s.people.find((j) => j.identity === v.pass.identity);
    if (row.state !== 'live' || !mine || b.generation !== row.mls_generation || !needsKeys(s, row.mls_generation, mine)) {
      throw new ConflictError('There’s nothing to rejoin.', { context: { callId, generation: b.generation, current: row.mls_generation }, level: 'info' });
    }
    const seq = row.mls_seq + 1;
    await appendMls(o, c, callId, { seq, generation: row.mls_generation, epoch: row.mls_epoch, grp: null }, 'keypackage', mine.identity, b.keyPackage);
    await exec(c, 'UPDATE calls SET mls_seq = $3 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, seq]);
    const next = withPerson(s, mine.identity, (j) => ({ ...j, admit: 'auto', keysFor: row.mls_generation }));
    const { closed } = await saveSettled(o, c, callId, state, next);
    return { room: row.room_name, moving: groupOf(s, mine) !== null || placeOf(s, mine) !== MAIN_PLACE, closed };
  });
  clog.info('keys sent to join another group', { callId, generation: b.generation, moving: r.moving });
  await afterClosing({ organizer: o, callId }, r.closed, () => tellRoom(o, r.room, callId, { call: r.closed, log: true }));
}

/**
 * Back in as they were, after being taken out while their connection was away: the same connection and person (seat,
 * hand and all), with a fresh key package for the host's browser to add them by. Nobody removed, turned away,
 * or whose place went to another tab or device comes back this way; they join again.
 */
export async function mlsBack(v: Viewer, callId: string, b: z.infer<typeof CallBackBodySchema>): Promise<void> {
  const o = v.organizer;
  const { room, closed } = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    const s = settle(state, row);
    const mine = s.people.find((j) => j.identity === v.pass.identity && j.person === v.pass.person);
    if (row.state !== 'live' || !mine || !mayComeBack(mine) || b.generation !== row.mls_generation) {
      throw new ConflictError('There’s no way back in from here. Join the call again.', { context: { callId, generation: b.generation, current: row.mls_generation, status: mine?.status ?? 'none' }, level: 'info' });
    }
    // The host's browser takes them out of their group first, so its keys move on without the connection that went.
    if (groupOf(s, mine) !== null) throw new ConflictError('Still moving the call’s keys on. Try again in a moment.', { context: { callId, reason: 'in-group' }, level: 'info' });
    // In again from now, in the same part of the call: the log asks this browser for keys next, as for anyone on their way
    // into a group, and the host's browser adds it. A fresh ARRIVAL_MS to reach the room, if its connection is still coming back.
    // Its time in before the drop is kept as an earlier stretch, so the time it was away stays time away (a guest reads
    // nothing said then, and catching up "while you were away" finds it).
    const now = Date.now();
    const next = withPerson(s, mine.identity, (j) => ({ ...j, status: 'in', admit: 'auto', earlier: [...j.earlier, { since: j.since, left: j.left ?? now }], since: now, left: null }));
    return { room: row.room_name, closed: (await saveSettled(o, c, callId, state, next)).closed };
  });
  clog.info('back in the call after its connection dropped', { callId, generation: b.generation });
  await afterClosing({ organizer: o, callId }, closed, () => tellRoom(o, room, callId, { call: true, log: true }));
}

/** A LiveKit token, only for someone the host's browser let in. It names nobody. */
export async function roomToken(v: Viewer, callId: string): Promise<{ token: string }> {
  requireIn(v, 'room');
  const { row } = await load(v.organizer, v.organizer.pool, callId);
  if (row.state !== 'live' || !row.room_name) throw new ConflictError('This call has ended.', { context: { callId } });
  return { token: await v.organizer.livekit.token({ roomName: row.room_name, identity: v.pass.identity }) };
}
