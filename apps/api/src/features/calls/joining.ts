import { MAIN_PLACE, type CallCard, type CallRole, type CallState, type CallTicket, type RingReply } from '@alcove/api';
import { z } from 'zod';
import { issuePass, readPass, type CallPass } from '../../callPass';
import type { Deps, Owner } from '../../context';
import { id128, openJson, sealJson, toJson } from '../../crypto';
import { exec, tx } from '../../db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors';
import { openOwner } from '../../owners';
import { limitsNow } from '../../limits';
import { me, profile } from '../account/account';
import { NO_BOARDS, NO_SPACE } from './space-state';
import { NO_LIMIT } from './capture';
import { notesCanGo, syncAccess } from '../meetings/access';
import { lookupCode } from '../meetings/codes';
import { MeetingManifest, minutesOf, pickTime, updateManifest } from '../meetings/service';
import { callFor } from '../meetings/repeats';
import type { Loaded } from '../../vault';
import { findItem, getItem } from '../../vault';
import { mayStandIn } from './hosting';
import { Joined, admissionFresh } from './places';
import { attentionPrincipalOf } from './attention';
import * as rings from './rings';
import { log } from '../../log';
import { header, hostHere, key, liveCall, load, notice, save, sharesEnd, tenthsIn, type Row, Stored, withPerson } from './state';
import { anonymousCapture, view } from './read-model';
import * as models from '../notes/models';
import { HOST_GRACE_MS, departed, newGeneration, reconcile } from './lifecycle';
import { syncBoardSeats } from './room-boards';
import { tellRoom } from './notifications';
import { knownUntil, workspaceIn, type Viewer } from './participants';
import { startNotes } from './recording';
import { notesBlocked } from '../billing/meter';
import { appendMls } from './mls-log';

const clog = log.child({ component: 'calls' });

/* ---------- joining by link: for anyone; the organizer's keys are opened with KMASTER ---------- */

/** The call a code leads to: its own, or for a series' code the one that's on now or next. */
async function meetingFor(d: Deps, code: string) {
  const link = await lookupCode(d, code);
  const organizer = link && await openOwner(d, link.ownerId, undefined);
  const meeting = organizer && link && (await findItem(organizer, d.pool, 'meeting', link.meetingId, MeetingManifest) ?? await callFor(organizer, link.meetingId));
  if (!organizer || !meeting) throw new NotFoundError('There’s no call with that code. Check the link and try again.');
  return { organizer, meeting };
}

/** Who someone is to a call: its organizer, invited by email (signed in with an invited address), or a guest. */
const roleOf = (owner: Owner | undefined, email: string | undefined, organizer: Owner, m: MeetingManifest): CallRole =>
  owner?.ownerId === organizer.ownerId ? 'host' : email && m.guests.some((g) => g.toLowerCase() === email.toLowerCase()) ? 'invited' : 'guest';

/**
 * What anyone with the link sees before joining: the title and organizer, whether they can come in yet, and what the
 * call captures (nobody's name, nothing that's been said, so they know before they ask); for someone signed in, where
 * they stand; which ways of signing in get the notes; and while the call offers times, the ones still to come.
 */
export async function card(d: Deps, code: string, owner?: Owner | undefined): Promise<CallCard> {
  const { organizer, meeting } = await meetingFor(d, code);
  const live = await liveCall(organizer, d.pool, meeting.itemId);
  // What the call captures now, and who hosts it, from the row just read.
  const s = live ? openJson(key(organizer, live.call_id), header(organizer, live.call_id), live.state_ciphertext, Stored) : null;
  const now = live && s ? anonymousCapture(s, live, await models.isPrivate(organizer.cfg, s.notes.model)) : null;
  const host = await profile(organizer);
  const asker = owner ? await profile(owner) : undefined;
  const role = roleOf(owner, asker?.email, organizer, meeting.manifest);
  // Someone standing in for the organizer: named only to the organizer, whose joining takes the call back.
  const standIn = live && hostHere(live) ? s?.people.find((j) => j.identity === s.host && j.role !== 'host') : undefined;
  // Letting someone in adds them to the invite only when the organizer does it: while someone stands in, they'd be a guest.
  const you: CallCard['you'] = role !== 'guest' ? 'invited' : asker && notesCanGo(asker, host) && !standIn ? 'asks' : 'guest';
  const { offer } = meeting.manifest;
  return {
    startsAt: meeting.manifest.startsAt,
    title: meeting.manifest.title, organizerName: host.name, hostHere: live ? hostHere(live) : false, standIn: standIn ? (role === 'host' ? { name: standIn.name } : {}) : null, locked: live?.locked ?? false,
    notes: meeting.manifest.notes, choices: meeting.manifest.choices, joinMuted: meeting.manifest.joinMuted,
    offer: offer ? { times: offer.times.filter((t) => new Date(t).getTime() > Date.now()), minutes: minutesOf(meeting.manifest) } : null,
    capture: now, ended: !live && meeting.manifest.status === 'ended', you,
    signInForNotes: host.sample ? ['google', 'microsoft', 'sso'] : ['google']
  };
}

/**
 * Settles a call that offers times on one of them, for anyone with its link, signed in or not. The link is what lets
 * them, as it lets them see the times. It answers with the card, which has no times to pick from any more.
 */
export async function pick(d: Deps, code: string, at: string, owner?: Owner | undefined): Promise<CallCard> {
  const { organizer, meeting } = await meetingFor(d, code);
  await pickTime(organizer, meeting.itemId, at);
  return card(d, code, owner);
}

/** A guest's name as typed, on one line: control characters and line breaks become spaces, and runs of spaces one. */
const GuestName = z.string().transform((n) => n.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim()).pipe(z.string().min(1).max(60));

/**
 * Lets someone into a call by its link. The organizer hosts (one organizer connection at a time: a new one
 * takes over the recording on a new segment); invited people join with their accounts; anyone else asks: someone
 * signed in under their account's name, with their address when the notes may go to it (the organizer sees it, and
 * letting them in adds it to the invite), anyone else with a typed name. Everyone but the organizer waits until the
 * organizer is there, and is kept out while it's locked or once it has ended.
 */
export async function join(d: Deps, code: string, who: { owner?: Owner | undefined; name?: string | undefined; mic: boolean; cam: boolean; identity: string; keyPackage: string; previous?: string | undefined }): Promise<{ ticket: CallTicket; state: CallState }> {
  const { organizer: o, meeting } = await meetingFor(d, code);
  // Nobody comes in until someone has picked a time, the organizer included: the call has none yet.
  if (meeting.manifest.offer) throw new ConflictError('This call doesn’t have a time yet.', { context: { meetingId: meeting.itemId } });
  const asker = who.owner ? await me(who.owner) : undefined;
  const role = roleOf(who.owner, asker?.email, o, meeting.manifest);
  // Only an address the notes may go to comes with an ask: any other signed-in asker is a guest by name.
  const keepsAddress = who.owner !== undefined && (role !== 'guest' || notesCanGo(await profile(who.owner), await profile(o)));
  let name: string;
  if (asker) name = asker.name;
  else {
    const parsed = GuestName.safeParse(who.name ?? '');
    if (!parsed.success) throw new ValidationError('Enter your name to join.', { context: { role } });
    name = parsed.data;
  }
  // Chosen by the browser (its key package names it): random, and new for every connection.
  const identity = who.identity;
  const person = id128();
  const joined: Joined = {
    identity, person, attentionPrincipal: who.owner ? `account:${who.owner.ownerId}` : `guest:${person}`, role, name, ...(asker && keepsAddress ? { email: asker.email.toLowerCase(), ...(asker.photoUrl ? { photoUrl: asker.photoUrl } : {}) } : {}),
    status: role === 'host' ? 'in' : 'waiting', admit: role === 'guest' ? 'ask' : 'auto', keysFor: 0, group: role === 'host' ? MAIN_PLACE : null, from: 0,
    placedAt: Date.now(), placedSeq: 0, wasIn: null, leftAt: {}, replaced: false, chatBefore: false, since: Date.now(), left: null, askedAt: Date.now(), earlier: [], hosting: []
  };
  // A pass from this browser's earlier connection to the same call: someone let in before is let in again without asking.
  const earlier = who.previous ? readPass(d.cfg, who.previous) : undefined;
  return enter(d, o, meeting, joined, { mic: who.mic, cam: who.cam, keyPackage: who.keyPackage, earlier, owner: who.owner });
}

/** A connection that came before, of someone coming back: from a reload's pass, or a move from another device. */
type Earlier = Pick<CallPass, 'callId' | 'identity' | 'person'>;

/**
 * Lets a new connection into the call (joining, or coming back from a reload or another device), and hands back its
 * ticket. The organizer's takes over from their previous connection; anyone else's asks, or comes back as `earlier`.
 */
async function enter(d: Deps, o: Owner, meeting: Loaded<MeetingManifest>, joined: Joined, who: { mic: boolean; cam: boolean; keyPackage: string; earlier?: Earlier | undefined; moving?: boolean | undefined; host?: string | undefined; owner?: Owner | undefined }): Promise<{ ticket: CallTicket; state: CallState }> {
  const { identity, role, name } = joined;
  const j = role === 'host' ? await hostJoin(o, meeting, joined, who) : await guestJoin(o, meeting, joined, who.keyPackage, who.earlier, who.moving === true).catch(async (e: unknown) => {
    if (e instanceof ConflictError && e.context['reason'] === 'full' && typeof e.context['callId'] === 'string') await toldFull(o, e.context['callId']);
    throw e;
  });
  // If the new host's browser never reaches the room, someone else hosts, or the call ends when nobody can.
  if (j.hosts) setTimeout(() => { reconcile(d).catch((err: unknown) => clog.warn('reconcile after a host joined failed', { err })); }, HOST_GRACE_MS + 1_000).unref();
  if (j.replaced) await o.livekit.removeParticipant(j.roomName, j.replaced).catch((e: unknown) => clog.info('previous host connection already gone', { callId: j.callId, err: e }));
  await o.livekit.ensureRoom(j.roomName);
  // A new host starts a new group (everyone fetches the call and its log); someone asking only concerns the host's browser.
  // A connection that hosts is in the call from the start, with no commit to let it in. Joining doesn't wait for a workspace:
  // a seat lands a moment later, and the call reads itself again when it does.
  if (j.hosts) void syncBoardSeats({ organizer: o, callId: j.callId });
  await tellRoom(o, j.roomName, j.callId, { call: j.hosts, log: true });
  clog.info(role === 'host' ? 'call joined' : 'asked to join a call', { callId: j.callId, meetingId: meeting.itemId, role, admit: j.admit, generation: j.generation, back: Boolean(who.earlier) });
  return ticketFor(d, o, j.callId, { identity, role, name, person: j.person, hosts: j.hosts, owner: who.owner }, j.roomName);
}

/** A connection's ticket (a new pass), and the call as it sees it. */
async function ticketFor(d: Deps, o: Owner, callId: string, who: Pick<Joined, 'identity' | 'role' | 'name' | 'person'> & { inCall?: boolean | undefined; hosts: boolean; owner?: Owner | undefined }, roomName: string): Promise<{ ticket: CallTicket; state: CallState }> {
  const { identity, role, name, person } = who;
  const pass = issuePass(d.cfg, { callId, ownerId: o.ownerId, identity, role, name, person });
  const ticket: CallTicket = { callId, serverUrl: d.cfg.LIVEKIT_URL, roomName, identity, role, pass };
  // The role the call has for them (an invited person's, a guest's), as #62's join gave it: what they may see follows it.
  const { state } = await load(o, d.pool, callId);
  const viewer: Viewer = { pass: { v: 1, callId, ownerId: o.ownerId, identity, role, name, person, exp: 0 }, organizer: o, session: () => Promise.resolve(who.owner), isOrganizer: role === 'host', isHost: who.hosts, stale: false, inCall: who.hosts || who.inCall === true, role, workspace: workspaceIn(state) };
  return { ticket, state: await view(viewer, d.pool, callId) };
}

/* ---------- moving to another device (features/calls/moves.ts keeps the moves; the call lets the new device in) ---------- */

/** Someone in a call, as a move needs them: who they are, and where they stand. */
export interface Mover { identity: string; person: string; role: CallRole; name: string; email: string | null; status: Joined['status']; replaced: boolean; removed: boolean }

/** A call and one connection in it, for a move: what the new device is told, and whether the move can go on. */
export async function moverOf(o: Owner, callId: string, identity: string): Promise<{ live: boolean; roomName: string | null; hostIdentity: string | null; title: string; organizerName: string; mover: Mover | null }> {
  const { row, state } = await load(o, o.pool, callId);
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const organizerName = (await me(o)).name;
  const j = state.people.find((x) => x.identity === identity);
  return {
    live: row.state === 'live', roomName: row.room_name, hostIdentity: row.host_identity, title: meeting.manifest.title, organizerName,
    mover: j ? { identity: j.identity, person: j.person, role: j.role, name: j.role === 'host' ? organizerName : j.name, email: j.email ?? null, status: j.status, replaced: j.replaced, removed: state.removed.includes(j.person) } : null
  };
}

/**
 * The new device of someone moving, let into the call in place of the connection that let go: the organizer's as
 * the organizer's new connection (a new key generation, the recording on a new segment, as when they join from
 * another device); anyone else's the way a reload comes back, as the same person with the same name, role, hand
 * and spotlight, and so the same seat and breakout room. Hands back the new connection's ticket.
 */
export async function moveIn(d: Deps, o: Owner, callId: string, from: { identity: string; person: string }, to: { identity: string; keyPackage: string }, media: { mic: boolean; cam: boolean }): Promise<{ ticket: CallTicket; state: CallState }> {
  const { row, state } = await load(o, o.pool, callId);
  const was = state.people.find((j) => j.identity === from.identity && j.person === from.person);
  if (row.state !== 'live' || !was || was.replaced || state.removed.includes(was.person) || (was.status !== 'in' && was.status !== 'left')) {
    throw new ConflictError('Your place in this call can’t move here any more.', { context: { callId, reason: 'moved-from', status: was?.status ?? 'none' } });
  }
  const meeting = await getItem(o, o.pool, 'meeting', row.meeting_item_id, MeetingManifest, 'That meeting');
  const host = was.role === 'host';
  // A new connection of the same person, as a fresh join makes one, keeping only who they are (and their hand): in no group
  // yet, so the host's browser adds it to the group of the part of the call they're in, and takes the old one out.
  const joined: Joined = {
    identity: to.identity, person: was.person, attentionPrincipal: attentionPrincipalOf(was), role: was.role, name: was.name, ...(was.email ? { email: was.email } : {}), ...(was.photoUrl ? { photoUrl: was.photoUrl } : {}),
    status: host ? 'in' : 'waiting', admit: 'auto', keysFor: 0, group: host ? MAIN_PLACE : null, from: 0,
    placedAt: Date.now(), placedSeq: 0, wasIn: null, leftAt: {}, replaced: false, chatBefore: false, since: Date.now(), left: null, askedAt: Date.now(), earlier: [], hosting: []
  };
  return enter(d, o, meeting, joined, { ...media, keyPackage: to.keyPackage, ...(host ? { host: from.identity } : { earlier: { callId, identity: from.identity, person: from.person }, moving: true }) });
}

/** The ticket of a move's new connection again, if its answer was lost on the way: a new pass for the same connection. */
export async function reissue(d: Deps, o: Owner, callId: string, identity: string): Promise<{ ticket: CallTicket; state: CallState }> {
  const { row, state } = await load(o, o.pool, callId);
  const j = state.people.find((x) => x.identity === identity);
  if (row.state !== 'live' || !row.room_name || !j || state.removed.includes(j.person) || j.replaced || (j.status !== 'in' && j.status !== 'waiting')) {
    throw new ConflictError('Your place in this call can’t move here any more.', { context: { callId, reason: 'reissue', status: j?.status ?? 'none' } });
  }
  return ticketFor(d, o, callId, { ...j, inCall: j.status === 'in', hosts: state.host === j.identity }, row.room_name);
}

/**
 * A connection let go to move to another device, whose new device has until `until` (ms) to come in. The connection
 * that hosts (the organizer's, or a stand-in's) is counted gone from now, and nobody takes over or ends the call while
 * the move can still arrive: its new device hosts on from where it was, as joining from another device does. A move
 * that runs out is a host gone like any other. Anyone else's is gone from the call now, so the host's browser takes it
 * out of the group and the keys move on before the new device comes in.
 */
export async function letGo(d: Deps, o: Owner, callId: string, m: Pick<Mover, 'identity' | 'role'>, until: number): Promise<void> {
  const hosting = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live' || state.host !== m.identity) return false;
    await save(o, c, callId, { ...state, moving: { until } });
    await exec(c, 'UPDATE calls SET host_left_at = now() WHERE owner_id = $1 AND call_id = $2 AND host_identity = $3', [o.ownerId, callId, m.identity]);
    return true;
  });
  if (hosting) setTimeout(() => { reconcile(d).catch((err: unknown) => clog.warn('reconcile after a host’s move ran out failed', { err })); }, until - Date.now() + 1_000).unref();
  else if (m.role !== 'host') await departed(o, callId, m.identity);
}

/** `hosts`: the connection joining hosts the call from now on (the organizer's, or a stand-in's reload). */
interface Joining { callId: string; roomName: string; replaced: string | null; row: Pick<Row, 'host_identity' | 'locked'>; state: Stored; admit: 'auto' | 'ask'; generation: number; person: string; hosts: boolean }

async function hostJoin(o: Owner, meeting: Loaded<MeetingManifest>, joined: Joined, opts: { mic: boolean; cam: boolean; host?: string | undefined }): Promise<Joining> {
  return tx(o.pool, async (c) => {
    const live = await liveCall(o, c, meeting.itemId, true);
    if (!live) {
      const callId = id128();
      const roomName = `r_${id128()}`;
      let s: Stored = {
        host: joined.identity, moving: null, people: [{ ...joined, hosting: [{ from: joined.since, to: null }] }], spotlight: null, breakouts: { open: null, held: [] }, removed: [], pointing: true, othersPointOff: [], chatAt: {}, chatRead: {}, timer: null, notices: [], workspace: NO_SPACE, board: NO_BOARDS,
        notes: {
          status: 'off', everOn: false, noteId: null, recordingId: null, segment: 0, segmentFrom: 0, history: [], asks: [], unavailable: [], offline: [], screenHistory: [],
          frameCapture: null, model: (await profile(o, c)).preferences.model, limit: NO_LIMIT
        },
        shares: []
      };
      await exec(c, `INSERT INTO calls (owner_id, call_id, meeting_item_id, state, started_at, version, state_ciphertext, room_name, host_identity, host_joined_at) VALUES ($1,$2,$3,'live',now(),0,$4,$5,$6,now())`,
        [o.ownerId, callId, meeting.itemId, sealJson(key(o, callId), header(o, callId), toJson(s)), roomName, joined.identity]);
      if (meeting.manifest.notes === 'on') {
        // The organizer's notes or storage have run out: the call goes on, and everyone sees why there are no notes.
        const blocked = await notesBlocked(o, c, o.ownerId);
        if (blocked) s = { ...s, notes: { ...s.notes, limit: { ...NO_LIMIT, stopped: { at: Date.now(), reason: blocked } } } };
        else {
          s = await startNotes(o, c, s, meeting, 0, 'schedule');
          s = notice(s, 'Notes are on. Everyone here can see that.');
        }
      }
      await save(o, c, callId, s);
      const started = await updateManifest(o, c, meeting.itemId, (m) => ({ ...m, status: 'live' }));
      // A call that ended, or went past its time, let go of its invite: it's on now, and everyone on it is invited.
      await syncAccess(o, c, meeting.itemId, started.guests);
      clog.info('call started', { callId, meetingId: meeting.itemId, mic: opts.mic, cam: opts.cam, notes: s.notes.status, noteId: s.notes.noteId, recordingId: s.notes.recordingId });
      return { callId, roomName, replaced: null, row: { host_identity: joined.identity, locked: false }, state: s, admit: 'auto', generation: 0, person: joined.person, hosts: true };
    }
    const { state } = await load(o, c, live.call_id, true);
    if (state.people.some((j) => j.identity === joined.identity)) throw new ConflictError('Join the call again.', { context: { callId: live.call_id, reason: 'identity' } });
    // Moving from one device to another: only from the organizer's connection as it is now.
    if (opts.host !== undefined && opts.host !== live.host_identity) throw new ConflictError('The organizer’s connection changed while this was moving. Make a new code and try again.', { context: { callId: live.call_id, reason: 'host' } });
    // A new organizer connection (a reload, another device, or coming back while someone stood in) hosts from now on, in a
    // new generation: the organizer's earlier connection, if one is still in the call, leaves it; someone standing in
    // stays, and rejoins their part's new group like everyone else, unless LiveKit has said their connection left: then
    // they're gone from then, and nobody hosted in between.
    const earlier = state.people.find((j) => j.role === 'host' && j.status === 'in');
    const standIn = state.people.find((j) => j.identity === state.host && j.role !== 'host' && j.status === 'in');
    const standInGone = standIn !== undefined && live.host_left_at !== null;
    // The organizer is one person across their connections (a reload, another device), as anyone else is across a
    // reload: what's kept by person, such as whether others may point at what they share, holds when they come back,
    // and so does their raised hand.
    const last = state.people.findLast((j) => j.role === 'host');
    const host: Joined = { ...joined, person: last?.person ?? joined.person, attentionPrincipal: last ? attentionPrincipalOf(last) : joined.attentionPrincipal };
    const told = standIn ? { change: { kind: 'back' as const, standIn, organizer: joined }, organizer: (await me(o, c)).name } : undefined;
    const gone = [...(earlier ? [earlier.identity] : []), ...(standIn && standInGone ? [standIn.identity] : [])];
    const { state: s, generation, roomName } = await newGeneration(o, c, live, state, { host, joining: true, gone }, told);
    clog.info(standIn ? 'organizer back, hosting again' : 'organizer rejoined call', { callId: live.call_id, meetingId: meeting.itemId, replaced: Boolean(earlier), segment: s.notes.segment, generation });
    return { callId: live.call_id, roomName, replaced: earlier?.identity ?? null, row: { host_identity: joined.identity, locked: live.locked }, state: s, admit: 'auto', generation, person: host.person, hosts: true };
  });
}

/** When each full call's host was last told someone was turned away, so they're told at most once a minute (this instance). */
const fullTold = new Map<string, number>();
const FULL_TOLD_MS = 60_000;
/** Tells whoever hosts a full call that someone was turned away: a notice to their connection alone. */
async function toldFull(o: Owner, callId: string): Promise<void> {
  const last = fullTold.get(callId) ?? 0;
  if (Date.now() - last < FULL_TOLD_MS) return;
  fullTold.set(callId, Date.now());
  for (const [id, at] of fullTold) if (Date.now() - at > FULL_TOLD_MS) fullTold.delete(id);
  const room = await tx(o.pool, async (c) => {
    const { row, state } = await load(o, c, callId, true);
    if (row.state !== 'live' || !state.host) return null;
    const most = (await limitsNow(o, c)).get('call.max_people');
    const told = { ...state, notices: [...state.notices.slice(-2), { id: id128(), text: `Someone tried to join, but this call is full: ${most} people is the most a call can have.`, kind: 'people' as const, to: state.host }] };
    await save(o, c, callId, told);
    return row.room_name;
  });
  clog.info('someone turned away from a full call', { callId });
  if (room) await tellRoom(o, room, callId, { call: true, log: false });
}

async function guestJoin(o: Owner, meeting: Loaded<MeetingManifest>, joined: Joined, keyPackage: string, earlier: Earlier | undefined, moving = false): Promise<Joining> {
  return tx(o.pool, async (c) => {
    const live = await liveCall(o, c, meeting.itemId, true);
    // Over and not started again: only the organizer can start it.
    if (!live && meeting.manifest.status === 'ended') throw new ConflictError('This call has ended.', { context: { meetingId: meeting.itemId, role: joined.role } });
    if (!live || !live.room_name) throw new ConflictError('Waiting for the host to start the call.', { context: { meetingId: meeting.itemId, role: joined.role } });
    const { state } = await load(o, c, live.call_id, true);
    if (state.people.some((j) => j.identity === joined.identity)) throw new ConflictError('Join the call again.', { context: { callId: live.call_id, reason: 'identity' } });
    // Back from a reload or another device: whoever was let in before (and not removed) needn't ask again, and is
    // the same person, as long as they come back as the same account (or still none): a pass never carries anyone
    // else in. Their old connection's place is over, and its pass can't bring anyone back again.
    const before = earlier && earlier.callId === live.call_id && !state.removed.includes(earlier.person)
      ? state.people.find((j) => j.identity === earlier.identity && j.person === earlier.person && !j.replaced && j.role !== 'host' && (j.status === 'in' || j.status === 'left')
        && (j.email ?? '') === (joined.email ?? '')) : undefined;
    // A move brings in only the person whose place it was, as they are now: removed or replaced since it was checked
    // (that read held no lock), it brings nobody in, rather than letting them in as someone new without asking.
    if (moving && !before) throw new ConflictError('Your place in this call can’t move here any more.', { context: { callId: live.call_id, reason: 'moved-from' } });
    // A lock keeps new people out, not someone coming back to the place they had.
    if (live.locked && !before) throw new ForbiddenError('The host has locked this call.', { context: { callId: live.call_id, role: joined.role } });
    // Coming back keeps their raised hand, and the spotlight if it was theirs.
    // During the stored-data upgrade, a second browser of an old signed-in participant keeps that same principal.
    const previousAccount = joined.email ? state.people.find((p) => p.attentionPrincipal === null && p.email?.toLowerCase() === joined.email?.toLowerCase()) : undefined;
    const attentionPrincipal = before ? attentionPrincipalOf(before) : previousAccount ? attentionPrincipalOf(previousAccount) : joined.attentionPrincipal;
    const me: Joined = { ...joined, attentionPrincipal, keysFor: live.mls_generation, group: null, ...(before ? { admit: 'auto' as const, person: before.person } : {}) };
    // Someone standing in for the organizer who reloads comes back hosting, as the organizer would: the new connection
    // hosts in a new generation, so the call is never left without a host meanwhile, locked or not.
    if (before && before.identity === state.host && mayStandIn({ ...me, status: 'in' })) {
      const { state: s, generation } = await newGeneration(o, c, live, withPerson(state, before.identity, (j) => ({ ...j, replaced: true })), { host: me, joining: true, gone: [before.identity] });
      clog.info('stand-in host came back on a new connection', { callId: live.call_id, generation });
      return { callId: live.call_id, roomName: live.room_name, replaced: before.identity, row: live, state: s, admit: 'auto', generation, person: me.person, hosts: true };
    }
    if (!hostHere(live)) throw new ConflictError('Waiting for the host to start the call.', { context: { meetingId: meeting.itemId, role: joined.role } });
    // The same browser asking again while it still waited (a reload): its earlier ask gives way to this one, as the same
    // account (or still none), so it holds no place of its own and the host isn't asked twice.
    const again = earlier && earlier.callId === live.call_id && !before
      ? state.people.find((j) => j.identity === earlier.identity && j.person === earlier.person && j.status === 'waiting' && (j.email ?? '') === (joined.email ?? '')) : undefined;
    // At most `call.max_people` at once (docs: Plans and usage): everyone let in, and everyone asking to be who can still be
    // let in, whose ask hasn't gone quiet (`admissionFresh`), so an ask nobody follows up holds no place once the host can't
    // see it. Someone coming back keeps their place, anyone more is turned away, and whoever hosts is told.
    if (!before) {
      const most = (await limitsNow(o, c)).get('call.max_people');
      const holding = (j: Joined) => j !== again && (j.status === 'in' || (j.status === 'waiting' && admissionFresh(j)));
      const here = new Set(state.people.filter(holding).map((j) => j.person)).size;
      if (here >= most) throw new ConflictError(`This call is full: ${most} people are in it, the most a call can have.`, { context: { callId: live.call_id, reason: 'full', people: here } });
    }
    let s: Stored = { ...state, people: [...state.people, me], spotlight: before && state.spotlight === before.identity ? me.identity : state.spotlight };
    if (again) s = withPerson(s, again.identity, (j) => ({ ...j, status: 'denied' }));
    // An old connection still in never said it went (its page crashed, or its goodbye hasn't come): its stay ends when it
    // was last heard from, not now, so the time between isn't counted as theirs for a guest coming back to read.
    if (before) s = await sharesEnd(o, c, withPerson(s, before.identity, (j) => ({ ...j, status: 'left', replaced: true, left: j.status === 'in' ? knownUntil(live.call_id, j, Date.now()) : j.left })), before.status === 'in' ? [before.identity] : [], tenthsIn(live.started_at));
    const seq = live.mls_seq + 1;
    await appendMls(o, c, live.call_id, { seq, generation: live.mls_generation, epoch: live.mls_epoch, grp: null }, 'keypackage', me.identity, keyPackage);
    await exec(c, 'UPDATE calls SET mls_seq = $3, version = version + 1 WHERE owner_id = $1 AND call_id = $2', [o.ownerId, live.call_id, seq]);
    await save(o, c, live.call_id, s);
    return { callId: live.call_id, roomName: live.room_name, replaced: null, row: live, state: s, admit: me.admit, generation: live.mls_generation, person: me.person, hosts: false };
  });
}

/** Someone rung answers: the organizer's browser is told, so their arch shows it. */
export async function answerRing(who: Owner, ringId: string, reply: RingReply): Promise<void> {
  const { organizer, meetingId } = await rings.answer(who, ringId, reply);
  const live = await liveCall(organizer, organizer.pool, meetingId);
  if (live) await tellRoom(organizer, live.room_name, live.call_id, { call: true, log: false });
}

/** The series a call is in, by its link: what carries over into it is read for whoever asks (features/notes/series.ts). */
export const seriesOf = async (d: Deps, code: string): Promise<string | undefined> => (await meetingFor(d, code)).meeting.manifest.seriesId;
