import { MAIN_PLACE, type CallRole, type Person, type Speaker } from '@alcove/api';
import { type CallPass } from '../../callPass';
import type { Deps, Owner } from '../../context';
import { b64u, mac, stateKey, utf8 } from '../../crypto';
import { ConflictError, ForbiddenError, NotFoundError } from '../../errors';
import { findOwner, openOwner } from '../../owners';
import { profile } from '../account/account';
import * as boards from './boards';
import * as catchup from './catchup';
import { personOf, portraitFor } from '../account/portraits';
import { MeetingManifest } from '../meetings/service';
import type { Loaded } from '../../vault';
import { mayStandIn } from './hosting';
import { Joined, placeOf, readableBy } from './places';
import * as transcripts from '../recordings/transcripts';
import { load, settle, type Stored } from './state';

/**
 * Who is asking about a call: anyone who joined it, by their call pass. The organizer's keys are opened for
 * the request (KMASTER), so guests' catch-up and ask work without an account. `inCall`: let in (the
 * organizer always is); someone still waiting only learns whether they've been let in. `role`: theirs as the
 * call stands, which can be more than their pass says (someone signed in whom the organizer let in from the link
 * is invited now). `isHost`: this connection hosts now (the organizer's, or someone's standing in for them), with its
 * account's session; `stale`: it hosted before and the call has gone on from another connection (another of the
 * organizer's tabs or devices, someone standing in, or the organizer back), so what it still sends as host is out of
 * date rather than never allowed. `session`: the account behind this request, if there is one, opened when it's asked for.
 */
export interface Viewer { pass: CallPass; organizer: Owner; session: () => Promise<Owner | undefined>; isOrganizer: boolean; isHost: boolean; stale: boolean; inCall: boolean; role: CallRole }

/** Someone as the call shows them: the organizer, invited people and anyone signed in by their account, guests by the name they typed. */
export function personFor(j: Joined | undefined, identity: string, fallbackName: string, organizer: Person): Person {
  if (j?.role === 'host') return organizer;
  if (j?.email) return { ...personOf(j.email, j.name), ...(j.photoUrl ? { photoUrl: j.photoUrl } : {}) };
  return { id: identity, name: j?.name ?? fallbackName, email: '', portrait: portraitFor(identity) };
}

/**
 * When each connection in a call last asked this API anything (ms), by `callId|identity`. A page in a call asks at least
 * every few seconds, so it's how late its page is known to have been there. A stay that ends without the page saying so
 * (it crashed, its goodbye was lost, its tab slept) ends no later than this: time nobody can say they were there for is
 * never counted as theirs, so a guest with the link never reads what was said in it. Kept in memory, as the API runs as
 * one instance; after a restart it's unknown until each page asks again, and such a stay ends where it began instead.
 */
const lastAsked = new Map<string, number>();

const LAST_ASKED_MAX = 50_000;

function asked(callId: string, identity: string): void {
  const key = `${callId}|${identity}`;
  // Oldest first, so what's dropped when it's full is what was heard from longest ago.
  lastAsked.delete(key);
  lastAsked.set(key, Date.now());
  if (lastAsked.size > LAST_ASKED_MAX) {
    const oldest = lastAsked.keys().next();
    if (!oldest.done) lastAsked.delete(oldest.value);
  }
}

/** The latest a connection that went without a word is known to have been in the call: never after `until`, nor before it came in. */
export const knownUntil = (callId: string, j: Pick<Joined, 'identity' | 'since'>, until: number): number =>
  Math.min(until, Math.max(j.since, lastAsked.get(`${callId}|${j.identity}`) ?? j.since));

/**
 * Who a call pass belongs to, for this request. A removed person's pass stops working, and once the call is over only
 * the organizer can read it. The organizer's powers go with the organizer's current connection only; host powers with
 * the connection that hosts (the organizer's, or someone's standing in for them). Either only together with the same
 * account's session (`session` opens it, only when it's needed): the organizer's own, or for someone standing in, an
 * account with the invited address they joined with.
 */
export async function viewerOf(d: Deps, pass: CallPass, session: () => Promise<Owner | undefined>): Promise<Viewer> {
  const organizer = await openOwner(d, pass.ownerId, undefined);
  const { row, state: s } = await load(organizer, organizer.pool, pass.callId);
  const signedIn = pass.role === 'host' || s.host === pass.identity ? await session() : undefined;
  const theOrganizer = pass.role === 'host' && signedIn?.ownerId === pass.ownerId;
  const ctx = { callId: pass.callId, role: pass.role };
  if (s.removed.includes(pass.person)) throw new ForbiddenError('The host removed you from this call.', { context: ctx });
  if (row.state !== 'live' && !theOrganizer) throw new ConflictError('This call has ended.', { context: ctx });
  const mine = s.people.find((j) => j.identity === pass.identity);
  // The organizer's current connection: the one of theirs that's in the call (joining again leaves the others).
  const isOrganizer = theOrganizer && mine?.role === 'host' && mine.status === 'in';
  const standingIn = !isOrganizer && s.host === pass.identity && mine !== undefined && mayStandIn(mine) && signedIn !== undefined && mine.email !== undefined
    && (await profile(signedIn)).email.toLowerCase() === mine.email;
  const isHost = s.host === pass.identity && (isOrganizer || standingIn);
  // Never more than the pass says, except a guest the organizer let in and so added to the invite.
  const role: CallRole = pass.role === 'guest' && mine?.role === 'invited' ? 'invited' : pass.role;
  if (mine?.status === 'in') asked(pass.callId, pass.identity);
  return { pass, organizer, session, isOrganizer, isHost, stale: (mine?.hosting.length ?? 0) > 0 && s.host !== pass.identity, inCall: isOrganizer || isHost || mine?.status === 'in', role };
}

/** Everything about a call but whether you're let in needs you to be in it. */
export function requireIn(v: Viewer, what: string): void {
  if (!v.inCall) throw new ForbiddenError('Wait until the host lets you in.', { context: { callId: v.pass.callId, role: v.pass.role, what } });
}

/**
 * Someone as this viewer may see them. A guest has only the link, so they see people by name and portrait
 * under their call identity: no email address (nor an ID made from one), and no photo, which loads only
 * for signed-in browsers anyway.
 */
export function forViewer(v: Viewer, p: Person, identity: string): Person {
  if (v.role !== 'guest') return p;
  return { id: identity, name: p.name, email: '', ...(p.portrait ? { portrait: p.portrait } : {}) };
}

/**
 * Who said each line: the person behind the participant ID it was heard from, as `v` may see them (everyone in
 * full for the notes). An ID the call doesn't know names nobody.
 */
export function speakersIn(s: Stored, organizer: Person, v?: Viewer | undefined): (identity: string) => Speaker | undefined {
  const by = new Map(s.people.map((j) => [j.identity, j]));
  const named = new Map<string, Speaker | undefined>();
  return (identity) => {
    if (named.has(identity)) return named.get(identity);
    const j = by.get(identity);
    const p = j ? personFor(j, identity, j.name, organizer) : undefined;
    const speaker = p ? { name: p.name, person: v ? forViewer(v, p, identity) : p } : undefined;
    named.set(identity, speaker);
    return speaker;
  };
}

/** Every breakout room the call has had, by ID, with its name. */
export function roomsIn(s: Stored): (id: string) => { id: string; name: string } | undefined {
  const all = new Map([...(s.breakouts.open?.rooms ?? []), ...s.breakouts.held.flatMap((h) => h.rooms)].map((r) => [r.id, { id: r.id, name: r.name }]));
  return (id) => all.get(id);
}

/**
 * Seats: what each viewer's own layout keys people by. Someone's seat is the same across their reconnections (a reload's
 * pass carries their `person`; the organizer has one seat on any device), and a MAC of that random `person` under a key
 * for this call from the organizer's root: nobody can work one out, it says nothing about who anyone is, and it differs
 * in every call. Never stored. Anyone but the organizer joining from a second browser is a new person, with a new seat.
 */
export const seatKey = (o: Owner, callId: string) => stateKey(o.root, o.ownerId, `call-seat:${callId}`);

const seatFor = (key: Uint8Array, role: Joined['role'], person: string) => b64u(mac(key, utf8(role === 'host' ? 'organizer' : person))).slice(0, 22);

export const seatOf = (key: Uint8Array, j: Joined) => seatFor(key, j.role, j.person);

/** The seat of whoever a pass belongs to. */
export const seatOfViewer = (v: Viewer): string => seatFor(seatKey(v.organizer, v.pass.callId), v.pass.role, v.pass.person);

/**
 * Whether someone's in a seat now, known only by its name: the call is going on, and whoever has the seat is let in and
 * wasn't taken out. It's what a pass's viewer says, for what carries a seat in place of a pass.
 */
export async function inSeat(d: Deps, at: { callId: string; organizer: string; seat: string }): Promise<boolean> {
  const o = await findOwner(d, at.organizer, undefined);
  if (!o) return false;
  const found = await load(o, o.pool, at.callId).catch((e: unknown) => { if (e instanceof NotFoundError) return undefined; throw e; });
  if (found?.row.state !== 'live') return false;
  const key = seatKey(o, at.callId);
  return found.state.people.some((j) => j.status === 'in' && !found.state.removed.includes(j.person) && seatOf(key, j) === at.seat);
}

/** Everyone in the call now or, with `place`, in that part of it, by seat, with the name they're in it under. */
export async function seatedIn(o: Owner, callId: string, place?: string | undefined): Promise<Map<string, string>> {
  const { row, state } = await load(o, o.pool, callId);
  const s = settle(state, row);
  const key = seatKey(o, callId);
  return new Map(s.people.filter((j) => j.status === 'in' && (place === undefined || placeOf(s, j) === place)).map((j) => [seatOf(key, j), j.name]));
}

export const seated = (v: Viewer): Promise<Map<string, string>> => seatedIn(v.organizer, v.pass.callId);

/** The addresses of everyone who's been in this viewer's call, the organizer's among them, lower-cased: whoever a quote or a follow-up from it can name. */
export async function addressesIn(v: Viewer): Promise<Set<string>> {
  const { state: s } = await load(v.organizer, v.organizer.pool, v.pass.callId);
  const organizer = (await profile(v.organizer)).email;
  return new Set([organizer, ...s.people.flatMap((j) => (j.email ? [j.email] : []))].map((e) => e.trim().toLowerCase()));
}

/** The address someone in a seat of this call signed in with, if the call kept one. */
export async function addressIn(v: Viewer, seat: string): Promise<string | undefined> {
  const { state: s } = await load(v.organizer, v.organizer.pool, v.pass.callId);
  const key = seatKey(v.organizer, v.pass.callId);
  return s.people.find((j) => seatOf(key, j) === seat)?.email?.toLowerCase();
}

/* ---------- a board in a call: what's done is features/calls/boards.ts; the call's row is held here ---------- */

/** These connections, once for each person, as a seat on a board names them. */
export function seatsOf(o: Owner, callId: string, people: Joined[]): boards.Here[] {
  const key = seatKey(o, callId);
  return [...new Map(people.map((j) => { const seat = seatOf(key, j); return [seat, { seat, name: j.name, email: j.email ?? null }] as const; })).values()];
}

/** Everyone in the call now, wherever they are in it: a main board is for the whole call. */
export const hereIn = (o: Owner, callId: string, s: Stored): boards.Here[] => seatsOf(o, callId, s.people.filter((j) => j.status === 'in'));

/** Everyone in one part of the call now: whoever's in a room is who its board is for. */
export const inPlaceOf = (o: Owner, callId: string, s: Stored, place: string): boards.Here[] => seatsOf(o, callId, s.people.filter((j) => j.status === 'in' && placeOf(s, j) === place));

/** Everyone the call has had who wasn't taken out of it, here now or not. Taking someone out ends their seats, so those don't count. */
export const knownIn = (o: Owner, callId: string, s: Stored): boards.Here[] => seatsOf(o, callId, s.people.filter((j) => !s.removed.includes(j.person)));

/** The part of the call someone asking is in. */
export function whereIs(v: Viewer, s: Stored): string {
  const mine = s.people.find((j) => j.identity === v.pass.identity);
  return mine ? placeOf(s, mine) : MAIN_PLACE;
}

/** When a line was said, in seconds since the call started (to a tenth), as everyone's time in the call is counted. */
export const saidIn = (startedAt: Date) => (l: transcripts.Line): number | undefined => (l.when === undefined ? undefined : Math.max(0, Math.round((l.when - startedAt.getTime()) / 100) / 10));

/** The people on the invite, by address: they get the notes, whether they were invited when the call was scheduled or added once let in. */
export const invitedIn = (m: Loaded<MeetingManifest>) => new Set(m.manifest.guests.map((e) => e.toLowerCase()));

/* ---------- catching up: for the person asking alone, from what they may read; nothing is kept ---------- */

/**
 * A guest's own time in the call, which is all of it they may read: someone not on the invite doesn't get the notes,
 * so reads only what they were there for, as with chat from before they came. Null for the organizer and for everyone
 * on the invite now, whether they were invited when the call was scheduled or added once let in from the link.
 */
export function onlyHere(v: Viewer, s: Stored, mine: Joined | undefined, startedAt: Date, invited: Set<string>): catchup.Open[] | null {
  if (v.pass.role === 'host') return null;
  const email = mine?.email?.toLowerCase();
  if (email && invited.has(email)) return null;
  return mine ? catchup.presence(s.people, mine, startedAt.getTime()) : [];
}

/**
 * Which lines of the live transcript someone may read: the call's one rule (places.ts readableBy: what was said in
 * the part of the call they're in now, while they were there), and on top of it, for a guest with the link, only what
 * was said while they were in the call.
 */
export function mayRead(v: Viewer, s: Stored, mine: Joined | undefined, startedAt: Date, invited: Set<string>): (l: transcripts.Line) => boolean {
  const rule = readableBy(s, mine);
  const here = onlyHere(v, s, mine, startedAt, invited);
  const said = saidIn(startedAt);
  return (l) => rule(l) && catchup.readable(here, said(l));
}
