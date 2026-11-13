import { CallNudgeKindSchema, CallQuestionStatusSchema, CallStatusKindSchema, type CallAction, type CallAttention, type CallAttentionCue, type CallStatus, type Person } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../../platform/context';
import { id128, openJson, sealJson, stateKey, toJson } from '../../../keys/crypto';
import { bytea, exec, maybeOne, type Db } from '../../../platform/db';
import { ConflictError, ForbiddenError, notFound } from '../../../platform/errors';
import { log } from '../../../platform/log';
import { forViewer, personFor, seatKey, seatOf, type Viewer } from '../participants';
import { admissionFresh, placeOf, readerOf, type Joined } from '../places';
import { Stored } from '../state';

/** Older active calls had no account ID. Their sealed address/person gives a stable upgrade identity. */
export const attentionPrincipalOf = (j: Joined): string => j.attentionPrincipal ?? (j.email ? `previous-email:${j.email.toLowerCase()}` : `guest:${j.person}`);

const alog = log.child({ component: 'call-attention' });
const Audience = { place: z.string(), readers: z.array(z.string()) };
const Hand = z.object({ id: z.string(), reader: z.string(), place: z.string(), at: z.number() });
/** In place of whoever asked an anonymous question: a placeholder that names nobody, as no connection's ID looks like it (`p_…`). */
const NOBODY = 'anonymous_';
const Placeholder = z.object({ identity: z.string().startsWith(NOBODY) });
const anonymousAgain = (v: unknown): unknown => (typeof v === 'object' && v !== null && Placeholder.safeParse(v).success ? { ...v, anonymous: true } : v);
/**
 * A question, and the connection that asked it (`identity`), to say who asked. An anonymous one keeps the placeholder in its
 * place, so nothing in the record names whoever asked: `voter` alone says it's theirs, to tell them so and to let only them post it
 * again or take it back. The release before this one, still serving during a deploy (or after a rollback), drops `anonymous` when
 * it saves, but finds nobody by the placeholder, so it names nobody either; the placeholder reads as anonymous again here. Older
 * records' questions weren't anonymous.
 */
const Question = z.preprocess(anonymousAgain, z.object({ ...Audience, id: z.string(), identity: z.string(), voter: z.string(), text: z.string(), at: z.number(), status: CallQuestionStatusSchema, ballots: z.array(z.string()), pinned: z.boolean(), anonymous: z.boolean().default(false) }));
/**
 * A nudge for one person (`to`, a reader) in the room it was sent in: the readers who sent it, when it was first sent and when it
 * last changed (ms). Only `to` ever reads it.
 */
const Nudge = z.object({ id: z.string(), to: z.string(), place: z.string(), kind: CallNudgeKindSchema, from: z.array(z.string()), at: z.number(), last: z.number() });
/** Someone's status (`reader`), since its time was set, and until when, or null for no time (ms). */
const Status = z.object({ reader: z.string(), kind: CallStatusKindSchema, since: z.number(), until: z.number().nullable() });
const Cue = z.object({ ...Audience, id: z.string(), seq: z.number(), kind: z.enum(['hand', 'question', 'admission', 'join', 'leave']), at: z.number(), hostOnly: z.boolean() });
/** Records sealed before nudges and statuses open with none; their old `signals` are ignored. */
const Attention = z.object({ hands: z.array(Hand), questions: z.array(Question), nudges: z.array(Nudge).default([]), statuses: z.array(Status).default([]), cues: z.array(Cue), latest: z.number() });
type Attention = z.infer<typeof Attention>;
const empty = (): Attention => ({ hands: [], questions: [], nudges: [], statuses: [], cues: [], latest: 0 });
/** Nudges of one kind to one person within a minute of the first are one note, and a note stays a minute after it last changed. */
const NUDGE_WINDOW = 60_000;
const key = (o: Owner, id: string) => stateKey(o.root, o.ownerId, `call-attention:${id}`);
const header = (o: Owner, id: string) => ({ v: 1 as const, kind: 'call-attention', ownerId: o.ownerId, callId: id });
/** Only the previous stored format is read here: its hand flags become stable queue entries on the next save. */
const PreviousHands = z.object({ people: z.array(z.object({ identity: z.string(), hand: z.boolean().default(false) })) });
export function openAttention(o: Owner, id: string, ciphertext: Uint8Array | null, previous?: { ciphertext: Uint8Array; state: Stored }): Attention {
  if (ciphertext) return openJson(key(o, id), header(o, id), ciphertext, Attention);
  const result = empty();
  if (!previous) return result;
  const old = openJson(stateKey(o.root, o.ownerId, `call:${id}`), { v: 1, kind: 'call-state', ownerId: o.ownerId, callId: id }, previous.ciphertext, PreviousHands);
  const raised = new Set(old.people.filter((j) => j.hand).map((j) => j.identity));
  const seats = seatKey(o, id);
  for (const j of previous.state.people) {
    if (!raised.has(j.identity) || j.replaced || previous.state.removed.includes(j.person) || result.hands.some((h) => h.reader === readerOf(j))) continue;
    result.hands.push({ id: `prior_${seatOf(seats, j)}`, reader: readerOf(j), place: placeOf(previous.state, j), at: j.since });
  }
  return result;
}
async function load(o: Owner, db: Db, id: string): Promise<Attention> {
  const row = await maybeOne(db, z.object({ ciphertext: bytea }), 'SELECT ciphertext FROM call_attention WHERE owner_id = $1 AND call_id = $2', [o.ownerId, id]);
  if (row) return openAttention(o, id, row.ciphertext);
  const previous = await maybeOne(db, z.object({ state_ciphertext: bytea }), 'SELECT state_ciphertext FROM calls WHERE owner_id = $1 AND call_id = $2', [o.ownerId, id]);
  if (!previous) return empty();
  const state = openJson(stateKey(o.root, o.ownerId, `call:${id}`), { v: 1, kind: 'call-state', ownerId: o.ownerId, callId: id }, previous.state_ciphertext, Stored);
  return openAttention(o, id, null, { ciphertext: previous.state_ciphertext, state });
}
/*
 * `signals: []` lets the previous release, which still serves during a deploy and requires the field, open what this
 * one saves. Remove it in the release after this one ships; this release ignores it on read.
 */
async function save(o: Owner, db: Db, id: string, a: Attention): Promise<void> {
  await exec(db, 'INSERT INTO call_attention (owner_id, call_id, ciphertext) VALUES ($1, $2, $3) ON CONFLICT (owner_id, call_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext', [o.ownerId, id, sealJson(key(o, id), header(o, id), toJson({ ...a, signals: [] }))]);
}
const audience = (s: Stored, place: string) => ({ place, readers: [...new Set(s.people.filter((j) => j.status === 'in' && placeOf(s, j) === place).map(readerOf))] });
function cue(a: Attention, s: Stored, place: string, kind: CallAttentionCue['kind'], now: number, hostOnly = false): void {
  a.latest += 1;
  a.cues.push({ ...audience(s, place), id: id128(), seq: a.latest, kind, at: now, hostOnly });
  a.cues = a.cues.filter((c) => c.at >= now - 60_000).slice(-64);
}
const visible = (j: Joined, s: Stored, x: { place: string; readers: string[] }) => x.place === placeOf(s, j) && x.readers.includes(readerOf(j));
/** A connection in the call now, by its ID, unless whoever's it is was removed. */
const inCall = (s: Stored, identity: string): Joined | undefined => s.people.find((p) => p.identity === identity && p.status === 'in' && !s.removed.includes(p.person));
/** How long a connection that went without leaving keeps its status and the nudges it was sent: as long as a reload can take. */
const BACK_WITHIN = 120_000;
/**
 * Whether someone's latest connection keeps their status and the nudges they were sent: it's in the call, on its way back in (a
 * reload's, let in again without asking), or it went without leaving so lately that a reload may still bring it back. After that
 * they go, and leaving on purpose takes them at once (`leaveAttention`).
 */
const keeps = (j: Joined, now: number): boolean =>
  j.status === 'in' || (j.status === 'waiting' && j.admit === 'auto' && admissionFresh(j, now)) || (j.status === 'left' && j.left !== null && now - j.left < BACK_WITHIN);
/**
 * The call's people as attention sees them at `now`, worked out once for each change or look: each reader's latest connection,
 * unless they were removed (`latest`), and that connection while it keeps what's theirs (`kept`).
 */
function peopleAt(s: Stored, now: number) {
  const removed = new Set(s.removed);
  const latest = new Map<string, Joined>();
  for (const j of s.people) if (!removed.has(j.person)) latest.set(readerOf(j), j);
  const kept = (reader: string): Joined | undefined => { const j = latest.get(reader); return j && keeps(j, now) ? j : undefined; };
  return { s, now, latest, kept };
}
type PeopleAt = ReturnType<typeof peopleAt>;
/** A reader's connection in the call now, while it's in `place`. */
const inPlace = (p: PeopleAt, reader: string, place: string): Joined | undefined => {
  const j = p.latest.get(reader);
  return j?.status === 'in' && placeOf(p.s, j) === place ? j : undefined;
};
/** Notes still kept (only those to `to`, given one), for someone still in the room they were nudged in. */
function liveNudges(a: Attention, p: PeopleAt, to?: string) {
  return a.nudges.filter((x) => {
    if ((to !== undefined && x.to !== to) || x.last <= p.now - NUDGE_WINDOW) return false;
    const j = p.kept(x.to);
    return j !== undefined && placeOf(p.s, j) === x.place;
  });
}
/** Statuses whose time hasn't run out, of people still in the call (a reload keeps theirs). */
const liveStatuses = (a: Attention, p: PeopleAt) => a.statuses.filter((x) => (x.until === null || x.until > p.now) && p.kept(x.reader) !== undefined);

/** Called under the call row's lock whenever its state changes. Reconnection never creates another join cue. */
export async function syncAttention(o: Owner, db: Db, id: string, before: Stored, after: Stored): Promise<void> {
  const a = await load(o, db, id);
  const now = Date.now();
  const beforePeople = new Map(before.people.map((j) => [j.identity, j]));
  const afterReaders = new Set(after.people.filter((j) => j.status === 'in' || (j.status === 'waiting' && j.admit === 'auto')).map(readerOf));
  const beforeReaders = new Set(before.people.filter((j) => j.status === 'in' || (j.status === 'left' && j.replaced)).map(readerOf));
  for (const j of after.people) {
    const old = beforePeople.get(j.identity);
    if (j.status === 'waiting' && j.admit === 'ask' && !old) cue(a, after, 'main', 'admission', now, true);
    if (j.status === 'in' && old?.status !== 'in' && !beforeReaders.has(readerOf(j))) cue(a, after, placeOf(after, j), 'join', now);
    if (old?.status === 'in' && j.status !== 'in' && !afterReaders.has(readerOf(j))) cue(a, before, placeOf(before, old), 'leave', now);
  }
  const people = peopleAt(after, now);
  // A hand follows a resumed seat, but a room move clears it. Removed people cannot revive it with a stale pass.
  a.hands = a.hands.filter((x) => { const j = people.latest.get(x.reader); return j !== undefined && placeOf(after, j) === x.place; });
  a.nudges = liveNudges(a, people);
  a.statuses = liveStatuses(a, people);
  await save(o, db, id, a);
}

export type AttentionAction = Extract<CallAction, { type: 'hand' | 'hand-lower' | 'question-post' | 'question-withdraw' | 'question-vote' | 'question-resolve' | 'question-pin' | 'nudge' }>;
export const isAttentionAction = (a: CallAction): a is AttentionAction => ['hand', 'hand-lower', 'question-post', 'question-withdraw', 'question-vote', 'question-resolve', 'question-pin', 'nudge'].includes(a.type);
export const anyonesAttention = (a: CallAction): boolean => a.type === 'hand' || a.type === 'question-post' || a.type === 'question-withdraw' || a.type === 'question-vote' || a.type === 'nudge' || a.type === 'status';

/**
 * The caller holds the call row, so order, audiences, membership and moderation are checked at the moment of the change. Says
 * which connections alone need to read the call again, or null for everyone in the room: a nudge is only its recipient's news.
 */
export async function changeAttention(v: Viewer, db: Db, id: string, s: Stored, action: AttentionAction): Promise<string[] | null> {
  const j = inCall(s, v.pass.identity);
  if (!j) throw new ForbiddenError('You are no longer in this call.', { context: { callId: id } });
  const voter = attentionPrincipalOf(j);
  const a = await load(v.organizer, db, id);
  const place = placeOf(s, j);
  if (action.place !== place) throw new ConflictError('You moved to another room. Try again from there.', { context: { callId: id, action: action.type } });
  const reader = readerOf(j);
  const now = Date.now();
  let only: string[] | null = null;
  if (action.type === 'hand') {
    const existing = a.hands.find((x) => x.reader === reader && x.place === place);
    if (action.up && !existing) {
      if (a.hands.length >= 200) throw new ConflictError('The hand queue is full.', { context: { callId: id } });
      a.hands.push({ id: id128(), reader, place, at: now });
      cue(a, s, place, 'hand', now);
    } else if (!action.up) a.hands = a.hands.filter((x) => x.reader !== reader);
  } else if (action.type === 'hand-lower') {
    a.hands = a.hands.filter((x) => x.id !== action.entryId);
  } else if (action.type === 'nudge') {
    // Only to someone else in your room now: never yourself, someone who has gone, or someone another room's group hears.
    const to = inCall(s, action.to);
    if (!to || readerOf(to) === reader || placeOf(s, to) !== place) throw new ConflictError('They aren’t in this room any more.', { context: { callId: id, action: action.type } });
    a.nudges = liveNudges(a, peopleAt(s, now));
    only = s.people.filter((p) => p.status === 'in' && readerOf(p) === readerOf(to)).map((p) => p.identity);
    const open = a.nudges.find((x) => x.to === readerOf(to) && x.kind === action.kind && x.place === place && x.at > now - NUDGE_WINDOW);
    // The same nudge from someone else joins the note that's open; from you again, it changes nothing.
    if (open && !open.from.includes(reader)) { open.from.push(reader); open.last = now; }
    else if (!open) {
      if (a.nudges.length >= 200) throw new ConflictError('This call has as many nudges as it can keep. Try again in a minute.', { context: { callId: id } });
      a.nudges.push({ id: id128(), to: readerOf(to), place, kind: action.kind, from: [reader], at: now, last: now });
    }
  } else if (action.type === 'question-post') {
    const previous = a.questions.find((x) => x.id === action.id);
    if (previous) {
      if (!visible(j, s, previous)) throw notFound('That question');
      if (previous.voter !== voter || previous.text !== action.text || previous.anonymous !== action.anonymous) throw new ConflictError('That question has already been posted.', { context: { callId: id } });
    } else {
      if (a.questions.length >= 200) throw new ConflictError('This call has reached its question limit.', { context: { callId: id } });
      // Anonymous, it keeps nothing that says who asked: no connection, only `voter`, which tells the asker alone it's theirs.
      a.questions.push({ ...audience(s, place), id: action.id, identity: action.anonymous ? `${NOBODY}${id128()}` : j.identity, voter, text: action.text, at: now, status: 'open', ballots: [], pinned: false, anonymous: action.anonymous });
      cue(a, s, place, 'question', now);
    }
  } else if (action.type === 'question-withdraw') {
    // Taking a question back removes it from the sealed record: nothing of it is kept.
    const q = a.questions.find((x) => x.id === action.id && visible(j, s, x));
    if (!q) throw notFound('That question');
    if (q.voter !== voter) throw new ForbiddenError('Only whoever asked a question can take it back.', { context: { callId: id } });
    a.questions = a.questions.filter((x) => x !== q);
  } else if (action.type === 'question-pin' && action.id === null) {
    for (const q of a.questions) if (q.place === place) q.pinned = false;
  } else {
    const q = a.questions.find((x) => x.id === action.id && visible(j, s, x));
    if (!q) throw notFound('That question');
    if (action.type === 'question-vote') {
      if (q.status !== 'open') throw new ConflictError('That question is closed.', { context: { callId: id } });
      q.ballots = q.ballots.filter((x) => x !== voter);
      if (action.on) {
        if (q.ballots.length >= 200) throw new ConflictError('This question has reached its vote limit.', { context: { callId: id } });
        q.ballots.push(voter);
      }
    } else if (action.type === 'question-resolve') {
      q.status = action.status;
      if (q.status !== 'open') q.pinned = false;
    } else if (action.type === 'question-pin') {
      if (q.status !== 'open') throw new ConflictError('Only an open question can be pinned.', { context: { callId: id } });
      for (const other of a.questions) if (other.place === place) other.pinned = other.id === q.id;
    }
  }
  await save(v.organizer, db, id, a);
  alog.info('call attention changed', { callId: id, action: action.type, hands: a.hands.length, questions: a.questions.length, nudges: a.nudges.length });
  return only;
}

/**
 * Someone's own status, for everyone in the call: set, changed or cleared (null). `minutes` sets when it goes; with none, a time
 * already set stays. It isn't bound to a room: it goes with them wherever they are in the call, through reloads, until it runs
 * out, they clear it, they leave, or their connection drops and doesn't come back (`keeps`).
 */
export async function changeStatus(v: Viewer, db: Db, id: string, s: Stored, action: Extract<CallAction, { type: 'status' }>): Promise<void> {
  const j = inCall(s, v.pass.identity);
  if (!j) throw new ForbiddenError('You are no longer in this call.', { context: { callId: id } });
  const a = await load(v.organizer, db, id);
  const now = Date.now();
  const reader = readerOf(j);
  const live = liveStatuses(a, peopleAt(s, now));
  const was = live.find((x) => x.reader === reader);
  a.statuses = live.filter((x) => x.reader !== reader);
  if (action.status) {
    if (a.statuses.length >= 500) throw new ConflictError('This call has as many statuses as it can keep.', { context: { callId: id } });
    const timed = action.minutes !== undefined ? { since: now, until: now + action.minutes * 60_000 } : was ? { since: was.since, until: was.until } : { since: now, until: null };
    a.statuses.push({ reader, kind: action.status, ...timed });
  }
  await save(v.organizer, db, id, a);
  alog.info('call status changed', { callId: id, statuses: a.statuses.length });
}

/**
 * The call's attention as one viewer sees it, and everyone's status as everyone in the call sees it, by reader (`readerOf`): what
 * each set, until its time runs out. The people are worked out once for both.
 */
export function attentionFor(v: Viewer, id: string, s: Stored, a: Attention, organizer: Person, now = Date.now()): { attention: CallAttention; statuses: Map<string, CallStatus> } {
  const people = peopleAt(s, now);
  const statuses = new Map(liveStatuses(a, people).map((x): [string, CallStatus] => [x.reader, { kind: x.kind, since: new Date(x.since).toISOString(), until: x.until === null ? null : new Date(x.until).toISOString() }]));
  const j = inCall(s, v.pass.identity);
  const base: CallAttention = { place: j ? placeOf(s, j) : 'main', hands: [], questions: [], nudges: [], cues: [], latest: a.latest, serverNow: new Date(now).toISOString() };
  if (!j) return { attention: base, statuses };
  const voter = attentionPrincipalOf(j);
  const authorizedHost = v.isHost && s.host === j.identity;
  const seats = seatKey(v.organizer, id);
  const connection = new Map(s.people.map((p) => [p.identity, p]));
  const attention: CallAttention = {
    ...base,
    hands: a.hands.flatMap((x) => {
      const p = inPlace(people, x.reader, x.place);
      return p && (x.place === base.place || authorizedHost) ? [{ id: x.id, participantId: p.identity, seat: seatOf(seats, p), raisedAt: new Date(x.at).toISOString() }] : [];
    }),
    // An anonymous question says who asked to nobody, whoever hosts included; `own` alone tells the asker.
    questions: a.questions.filter((q) => visible(j, s, q)).map((q) => ({
      id: q.id, author: q.anonymous ? null : forViewer(v, personFor(connection.get(q.identity), q.identity, '', organizer), q.identity), text: q.text,
      createdAt: new Date(q.at).toISOString(), status: q.status, votes: q.ballots.length, voted: q.ballots.includes(voter), own: q.voter === voter, pinned: q.pinned
    })),
    // Only the nudges sent to you, in the room you're in: whoever sent each, while that's one person, else only how many.
    nudges: liveNudges(a, people, readerOf(j)).filter((x) => x.place === base.place).map((x) => {
      const sender = x.from.length === 1 ? people.latest.get(x.from[0] ?? '') : undefined;
      return { id: x.id, kind: x.kind, count: x.from.length, from: sender ? forViewer(v, personFor(sender, sender.identity, sender.name, organizer), sender.identity) : null, at: new Date(x.last).toISOString() };
    }),
    cues: a.cues.filter((c) => c.at >= now - 60_000 && (c.hostOnly ? authorizedHost : (c.kind === 'hand' && authorizedHost) || visible(j, s, c))).map((c) => ({ id: c.id, seq: c.seq, kind: c.kind, at: new Date(c.at).toISOString() }))
  };
  return { attention, statuses };
}

/** An intentional departure forgets its hand, status and nudges; a reload/device move retains them (`keeps`). */
export async function leaveAttention(o: Owner, db: Db, id: string, j: Joined): Promise<void> {
  const a = await load(o, db, id);
  a.hands = a.hands.filter((x) => x.reader !== readerOf(j));
  a.statuses = a.statuses.filter((x) => x.reader !== readerOf(j));
  a.nudges = a.nudges.filter((x) => x.to !== readerOf(j));
  await save(o, db, id, a);
}

/** Upkeep removes attention left by a previous API ending a call during a rollout. */
export const sweep = (d: Pick<Deps, 'pool'>): Promise<number> =>
  exec(d.pool, `DELETE FROM call_attention a USING calls c WHERE c.owner_id = a.owner_id AND c.call_id = a.call_id AND c.state = 'ended'`);
