import { CallFeedbackKindSchema, CallQuestionStatusSchema, type CallAction, type CallAttention, type CallAttentionCue, type Person } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../context';
import { id128, openJson, sealJson, stateKey, toJson } from '../../crypto';
import { bytea, exec, maybeOne, type Db } from '../../db';
import { ConflictError, ForbiddenError, notFound } from '../../errors';
import { log } from '../../log';
import { forViewer, personFor, seatKey, seatOf, type Viewer } from './participants';
import { placeOf, readerOf, type Joined } from './places';
import { Stored } from './state';

/** Older active calls had no account ID. Their sealed address/person gives a stable upgrade identity. */
export const attentionPrincipalOf = (j: Joined): string => j.attentionPrincipal ?? (j.email ? `previous-email:${j.email.toLowerCase()}` : `guest:${j.person}`);

const alog = log.child({ component: 'call-attention' });
const Audience = { place: z.string(), readers: z.array(z.string()) };
const Hand = z.object({ id: z.string(), reader: z.string(), place: z.string(), at: z.number() });
const Question = z.object({ ...Audience, id: z.string(), identity: z.string(), voter: z.string(), text: z.string(), at: z.number(), status: CallQuestionStatusSchema, ballots: z.array(z.string()), pinned: z.boolean() });
const Signal = z.object({ ...Audience, identity: z.string(), reader: z.string(), placedAt: z.number(), kind: CallFeedbackKindSchema, until: z.number() });
const Cue = z.object({ ...Audience, id: z.string(), seq: z.number(), kind: z.enum(['hand', 'question', 'admission', 'join', 'leave']), at: z.number(), hostOnly: z.boolean() });
const Attention = z.object({ hands: z.array(Hand), questions: z.array(Question), signals: z.array(Signal), cues: z.array(Cue), latest: z.number() });
type Attention = z.infer<typeof Attention>;
const empty = (): Attention => ({ hands: [], questions: [], signals: [], cues: [], latest: 0 });
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
async function save(o: Owner, db: Db, id: string, a: Attention): Promise<void> {
  await exec(db, 'INSERT INTO call_attention (owner_id, call_id, ciphertext) VALUES ($1, $2, $3) ON CONFLICT (owner_id, call_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext', [o.ownerId, id, sealJson(key(o, id), header(o, id), toJson(a))]);
}
const audience = (s: Stored, place: string) => ({ place, readers: [...new Set(s.people.filter((j) => j.status === 'in' && placeOf(s, j) === place).map(readerOf))] });
function cue(a: Attention, s: Stored, place: string, kind: CallAttentionCue['kind'], now: number, hostOnly = false): void {
  a.latest += 1;
  a.cues.push({ ...audience(s, place), id: id128(), seq: a.latest, kind, at: now, hostOnly });
  a.cues = a.cues.filter((c) => c.at >= now - 60_000).slice(-64);
}
const visible = (j: Joined, s: Stored, x: { place: string; readers: string[] }) => x.place === placeOf(s, j) && x.readers.includes(readerOf(j));
function activeSignals(a: Attention, s: Stored, now: number) {
  return a.signals.filter((x) => x.until > now && s.people.some((j) => j.identity === x.identity && j.status === 'in' && j.placedAt === x.placedAt && placeOf(s, j) === x.place));
}

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
  // A hand follows a resumed seat, but a room move clears it. Removed people cannot revive it with a stale pass.
  a.hands = a.hands.filter((x) => {
    const j = after.people.findLast((p) => readerOf(p) === x.reader);
    return j !== undefined && !after.removed.includes(j.person) && placeOf(after, j) === x.place;
  });
  a.signals = activeSignals(a, after, now);
  await save(o, db, id, a);
}

export type AttentionAction = Extract<CallAction, { type: 'hand' | 'hand-lower' | 'hands-clear' | 'question-post' | 'question-vote' | 'question-resolve' | 'question-pin' | 'feedback' }>;
export const isAttentionAction = (a: CallAction): a is AttentionAction => ['hand', 'hand-lower', 'hands-clear', 'question-post', 'question-vote', 'question-resolve', 'question-pin', 'feedback'].includes(a.type);
export const anyonesAttention = (a: CallAction): boolean => a.type === 'hand' || a.type === 'question-post' || a.type === 'question-vote' || a.type === 'feedback';

/** The caller holds the call row, so order, audiences, membership and moderation are checked at the moment of the change. */
export async function changeAttention(v: Viewer, db: Db, id: string, s: Stored, action: AttentionAction): Promise<void> {
  const j = s.people.find((p) => p.identity === v.pass.identity && p.status === 'in' && !s.removed.includes(p.person));
  if (!j) throw new ForbiddenError('You are no longer in this call.', { context: { callId: id } });
  const voter = attentionPrincipalOf(j);
  const a = await load(v.organizer, db, id);
  const place = placeOf(s, j);
  if (action.place !== place) throw new ConflictError('You moved to another room. Try again from there.', { context: { callId: id, action: action.type } });
  const reader = readerOf(j);
  const now = Date.now();
  if (action.type === 'hand') {
    const existing = a.hands.find((x) => x.reader === reader && x.place === place);
    if (action.up && !existing) {
      if (a.hands.length >= 200) throw new ConflictError('The hand queue is full.', { context: { callId: id } });
      a.hands.push({ id: id128(), reader, place, at: now });
      cue(a, s, place, 'hand', now);
    } else if (!action.up) a.hands = a.hands.filter((x) => x.reader !== reader);
  } else if (action.type === 'hand-lower') {
    a.hands = a.hands.filter((x) => x.id !== action.entryId);
  } else if (action.type === 'hands-clear') {
    a.hands = [];
  } else if (action.type === 'feedback') {
    a.signals = activeSignals(a, s, now).filter((x) => x.reader !== reader);
    if (action.kind && a.signals.length >= 200) throw new ConflictError('This call has reached its feedback limit.', { context: { callId: id } });
    if (action.kind) a.signals.push({ ...audience(s, place), identity: j.identity, reader, placedAt: j.placedAt, kind: action.kind, until: now + 15_000 });
  } else if (action.type === 'question-post') {
    const previous = a.questions.find((x) => x.id === action.id);
    if (previous) {
      if (!visible(j, s, previous)) throw notFound('That question');
      if (previous.voter !== voter || previous.text !== action.text) throw new ConflictError('That question has already been posted.', { context: { callId: id } });
    } else {
      if (a.questions.length >= 200) throw new ConflictError('This call has reached its question limit.', { context: { callId: id } });
      a.questions.push({ ...audience(s, place), id: action.id, identity: j.identity, voter, text: action.text, at: now, status: 'open', ballots: [], pinned: false });
      cue(a, s, place, 'question', now);
    }
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
  alog.info('call attention changed', { callId: id, action: action.type, hands: a.hands.length, questions: a.questions.length });
}

export function attentionFor(v: Viewer, id: string, s: Stored, a: Attention, organizer: Person, now = Date.now()): CallAttention {
  const j = s.people.find((p) => p.identity === v.pass.identity && p.status === 'in' && !s.removed.includes(p.person));
  const base: CallAttention = { place: j ? placeOf(s, j) : 'main', hands: [], questions: [], signals: [], cues: [], latest: a.latest, serverNow: new Date(now).toISOString() };
  if (!j) return base;
  const voter = attentionPrincipalOf(j);
  const authorizedHost = v.isHost && s.host === j.identity;
  const seats = seatKey(v.organizer, id);
  return {
    ...base,
    hands: a.hands.flatMap((x) => {
      const p = s.people.findLast((person) => person.status === 'in' && readerOf(person) === x.reader && placeOf(s, person) === x.place);
      return p && (x.place === base.place || authorizedHost) ? [{ id: x.id, participantId: p.identity, seat: seatOf(seats, p), raisedAt: new Date(x.at).toISOString() }] : [];
    }),
    questions: a.questions.filter((q) => visible(j, s, q)).map((q) => {
      const author = s.people.find((p) => p.identity === q.identity);
      return { id: q.id, author: forViewer(v, personFor(author, q.identity, '', organizer), q.identity), text: q.text, createdAt: new Date(q.at).toISOString(), status: q.status, votes: q.ballots.length, voted: q.ballots.includes(voter), own: q.voter === voter, pinned: q.pinned };
    }),
    signals: activeSignals(a, s, now).filter((x) => visible(j, s, x)).flatMap((x) => {
      const p = s.people.find((person) => person.identity === x.identity);
      return p ? [{ participantId: p.identity, seat: seatOf(seats, p), kind: x.kind, expiresAt: new Date(x.until).toISOString() }] : [];
    }),
    cues: a.cues.filter((c) => c.at >= now - 60_000 && (c.hostOnly ? authorizedHost : (c.kind === 'hand' && authorizedHost) || visible(j, s, c))).map((c) => ({ id: c.id, seq: c.seq, kind: c.kind, at: new Date(c.at).toISOString() }))
  };
}

/** An intentional departure forgets its hand; a reload/device move retains queue position. */
export async function leaveAttention(o: Owner, db: Db, id: string, j: Joined): Promise<void> {
  const a = await load(o, db, id);
  a.hands = a.hands.filter((x) => x.reader !== readerOf(j));
  a.signals = a.signals.filter((x) => x.reader !== readerOf(j));
  await save(o, db, id, a);
}

/** Upkeep removes attention left by a previous API ending a call during a rollout. */
export const sweep = (d: Pick<Deps, 'pool'>): Promise<number> =>
  exec(d.pool, `DELETE FROM call_attention a USING calls c WHERE c.owner_id = a.owner_id AND c.call_id = a.call_id AND c.state = 'ended'`);
