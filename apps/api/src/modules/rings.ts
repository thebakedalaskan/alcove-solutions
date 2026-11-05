/*
 * Ringing people into a call (docs: Calls and recordings › Ringing).
 *
 * The organizer rings teammates, or people invited who've said yes. A ring is one row per person per call in `call_rings`, in
 * the organizer's vault, found by a keyed hash of the address rung: the address and what they said are sealed under
 * the organizer's keys (record kind `call-ring`, bound to the meeting and the ring). What the card says isn't kept:
 * it's read from the call as it's delivered, with the organizer's keys opened for that read and dropped after it.
 *
 * A ring shows from `deliver_at` until `expires_at`, and everything else follows from those two and what they said:
 * still to come is `later`, showing is `ringing`, run out is `missed`. So a ring running out, or coming back, takes no
 * write and no request, on any instance, and Postgres stays the only truth. A row means the call is live: rows go in
 * the transaction that ends it.
 *
 * Each browser tab holds a stream of whole snapshots of what's ringing its person (RingStreams). One ticker per process
 * runs while anyone listens, with one indexed query for all of them. A stream keeps what finds its person's rings,
 * never their keys, and holds no database connection: every read takes one from the pool and gives it back.
 */
import { RING_SECONDS, type IncomingRing, type RingReply, type Rung } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../context';
import { b64u, blindIndex, id128, openJson, sealJson, stateKey, toJson, utf8 } from '../crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../db';
import { AuthError, UnavailableError, ValidationError, notFound } from '../errors';
import { log, withLogContext } from '../log';
import { findOwner, masterKey } from '../owners';
import { stillOpen } from '../sessions';
import { findItem, getItem } from '../vault';
import { saidYes } from './access';
import { me, profile } from './account';
import { addToInvite, type InviteOf } from './invites';
import { MAX_GUESTS, MeetingManifest } from './meetings';
import { teammates } from './people';
import { personOf } from './portraits';

const rlog = log.child({ component: 'rings' });

/** How long each answer puts a ring off, in seconds. */
const PUT_OFF = { 'in-5': 300, 'in-15': 900 } as const;
/** How often what's ringing is read while anyone is listening, in ms. */
const TICK_MS = 1000;
/** A stream repeats itself this often, in ms, so a browser can tell a quiet stream from a dead one. */
const REPEAT_MS = 20_000;
/** How many streams an account holds at once: one a tab, and more tabs than anyone keeps open. */
const STREAMS_PER_ACCOUNT = 8;
/** How many streams a process holds at once. Each is one of the 1,000 requests an instance serves at a time (`deploy.yml`), which workspaces, documents and calls share. */
const STREAMS_PER_PROCESS = 300;

/** A ring as kept, sealed. */
const Ring = z.object({
  /** Whom it's for, lower-cased: how the organizer sees them. */
  email: z.string(),
  /** Their answer, while it stands: coming, or not this time. In a little while isn't one: that's a ring still to come. */
  reply: z.enum(['join', 'no']).nullable(),
  /** Put off for a little while: when the ring they put off started. */
  since: z.string().nullable()
});
type Ring = z.infer<typeof Ring>;
const Row = z.object({
  owner_id: z.string(), ring_id: z.string(), meeting_item_id: z.string(), email_index: bytea, deliver_at: timestamp, expires_at: timestamp, ring_ciphertext: bytea,
  /** Whether its time has come, and whether it's still running, by Postgres's clock, which every instance shares. */
  due: z.boolean(), running: z.boolean()
});
type Row = z.infer<typeof Row>;
const COLUMNS = 'owner_id, ring_id, meeting_item_id, email_index, deliver_at, expires_at, ring_ciphertext, deliver_at <= now() AS due, expires_at > now() AS running';

const key = (o: Owner, meetingId: string) => stateKey(o.root, o.ownerId, `ring:${meetingId}`);
const header = (o: Owner, meetingId: string, ringId: string) => ({ v: 1 as const, kind: 'call-ring', ownerId: o.ownerId, meetingId, ringId });
const seal = (o: Owner, meetingId: string, ringId: string, r: Ring) => sealJson(key(o, meetingId), header(o, meetingId, ringId), toJson(r));
const open = (o: Owner, r: Row): Ring => openJson(key(o, r.meeting_item_id), header(o, r.meeting_item_id, r.ring_id), r.ring_ciphertext, Ring);
/** The keyed hash a ring finds its person by: its own purpose, so a row joins to no other table without KMASTER. */
const indexOf = (d: Deps, email: string) => blindIndex(masterKey(d), 'ring', email.trim().toLowerCase());
/** A demo account's name and address are checked by nobody, so a ring never crosses between one and a real account. */
const reaches = (organizer: { sample: boolean }, rung: { sample: boolean }) => organizer.sample === rung.sample;

/* ---------- the organizer: in the call's transaction, under its row lock, like anything else that changes it ---------- */

/**
 * Refuses anyone the organizer has no reason to reach. A ring puts the call's title on someone's screen, with a sound, and
 * anyone can put any address on an invite, so being invited says nothing: only teammates can be rung, and people invited
 * who said yes to this call. Everyone else gets the same answer, account or not, and it names nobody, so asking teaches
 * nothing about an address or who answered what. It runs before the call's lock is taken, because knowing the team can
 * take a calendar read.
 */
export async function mayRing(o: Owner, meetingId: string, emails: string[]): Promise<void> {
  const team = await teammates(o);
  const others = emails.filter((e) => !team.has(e));
  if (!others.length) return;
  const coming = await saidYes(o, meetingId, others);
  const strangers = others.filter((e) => !coming.has(e)).length;
  if (strangers) throw new ValidationError('You can ring people on your team, or people who said yes to this call.', { context: { meetingId, strangers } });
}

/**
 * Rings people into a call. Everyone rung goes on the invite, so they get the notes and come in without asking. Someone
 * rung before starts over, on the same ring, whatever they said to it.
 */
export async function ring(o: Owner, c: Db, at: InviteOf, emails: string[]): Promise<void> {
  const wanted = [...new Set(emails)];
  if (!wanted.length) return;
  const added = await addToInvite(o, c, at, wanted);
  const invited = new Set((await getItem(o, c, 'meeting', at.meetingId, MeetingManifest, 'That meeting')).manifest.guests.map((e) => e.toLowerCase()));
  // Unlike someone let in from the link, nobody is in the call yet, so a full invite is a refusal.
  if (wanted.some((e) => !invited.has(e))) throw new ValidationError(`A call can have at most ${MAX_GUESTS} people invited.`, { context: { meetingId: at.meetingId, people: wanted.length } });
  const indexes = wanted.map((email) => ({ email, index: indexOf(o, email) }));
  const earlier = await rows(c, Row, `SELECT ${COLUMNS} FROM call_rings WHERE owner_id = $1 AND meeting_item_id = $2 AND email_index = ANY($3)`, [o.ownerId, at.meetingId, indexes.map((x) => x.index)]);
  const ringOf = new Map(earlier.map((r) => [b64u(r.email_index), r.ring_id]));
  for (const { email, index } of indexes) {
    const ringId = ringOf.get(b64u(index)) ?? id128();
    await exec(c, `INSERT INTO call_rings (owner_id, ring_id, meeting_item_id, email_index, deliver_at, expires_at, ring_ciphertext) VALUES ($1,$2,$3,$4,now(),now() + make_interval(secs => $5),$6)
                   ON CONFLICT (owner_id, ring_id) DO UPDATE SET deliver_at = EXCLUDED.deliver_at, expires_at = EXCLUDED.expires_at, ring_ciphertext = EXCLUDED.ring_ciphertext`,
    [o.ownerId, ringId, at.meetingId, index, RING_SECONDS, seal(o, at.meetingId, ringId, { email, reply: null, since: null })]);
  }
  rlog.info('people rung', { meetingId: at.meetingId, people: wanted.length, again: earlier.length, added: added.length });
}

/** The organizer stops ringing someone. Only a ring of this call; one that's already over needs no stopping. They stay on the invite. */
export async function stop(o: Owner, c: Db, meetingId: string, ringId: string): Promise<void> {
  const stopped = await exec(c, 'DELETE FROM call_rings WHERE owner_id = $1 AND meeting_item_id = $2 AND ring_id = $3', [o.ownerId, meetingId, ringId]);
  rlog.info('stopped ringing someone', { meetingId, stopped });
}

/** Whoever was let into the call, by address: nobody needs ringing once they're in. */
export async function arrived(o: Owner, c: Db, meetingId: string, emails: string[]): Promise<void> {
  if (emails.length) await exec(c, 'DELETE FROM call_rings WHERE owner_id = $1 AND meeting_item_id = $2 AND email_index = ANY($3)', [o.ownerId, meetingId, emails.map((e) => indexOf(o, e))]);
}

/** The call is over: its rings go with it. */
export async function clear(o: Owner, c: Db, meetingId: string): Promise<void> {
  await exec(c, 'DELETE FROM call_rings WHERE owner_id = $1 AND meeting_item_id = $2', [o.ownerId, meetingId]);
}

function rungFrom(r: Row, ring: Ring): Rung {
  const shows = r.deliver_at.toISOString();
  const who = { id: r.ring_id, person: personOf(ring.email) };
  if (ring.reply === 'join') return { ...who, state: 'coming', since: shows };
  if (ring.reply === 'no') return { ...who, state: 'declined', since: shows };
  if (!r.due) return { ...who, state: 'later', since: ring.since ?? shows, until: shows };
  // Nobody can tell a ring nobody saw from one that was ignored: neither says whether they were online.
  return { ...who, state: r.running ? 'ringing' : 'missed', since: shows };
}

/** Everyone the organizer rang into this call and how each answered, in an order that doesn't change. `here`: the addresses in the call now, who are left out. */
export async function rungIn(o: Owner, db: Db, meetingId: string, here: string[]): Promise<Rung[]> {
  const found = await rows(db, Row, `SELECT ${COLUMNS} FROM call_rings WHERE owner_id = $1 AND meeting_item_id = $2 ORDER BY ring_id`, [o.ownerId, meetingId]);
  const present = new Set(here);
  return found.flatMap((r) => { const ring = open(o, r); return present.has(ring.email) ? [] : [rungFrom(r, ring)]; });
}

/* ---------- the person rung: found by the hash of their own address, and nobody else ---------- */

/**
 * Answers a ring, in the organizer's vault with the organizer's keys: for anyone but the person it's for, it doesn't
 * exist. `join` and `no` end it now; `in-5` and `in-15` put it off, and it rings again then, for as long as a ring lasts.
 * Hands back whose call it is, so the room can be told. The answer itself is never logged: it's sealed for a reason.
 * Everything that needs its own connection is read first: a whole group can answer at once, and a transaction waiting
 * for a second connection while it holds one could use up the pool.
 */
export async function answer(who: Owner, ringId: string, reply: RingReply): Promise<{ organizer: Owner; meetingId: string }> {
  const asker = await profile(who);
  const found = await maybeOne(who.pool, Row, `SELECT ${COLUMNS} FROM call_rings WHERE ring_id = $1 AND email_index = $2`, [ringId, indexOf(who, asker.email)]);
  const o = found && await findOwner(who, found.owner_id, undefined);
  if (!found || !o || !reaches(await profile(o), asker)) throw notFound('That ring', { ringId });
  return tx(who.pool, async (c) => {
    const r = await maybeOne(c, Row, `SELECT ${COLUMNS} FROM call_rings WHERE owner_id = $1 AND ring_id = $2 FOR UPDATE`, [o.ownerId, ringId]);
    if (!r) throw notFound('That ring', { ringId });
    const ring = open(o, r);
    if (reply === 'join' || reply === 'no') {
      await exec(c, 'UPDATE call_rings SET deliver_at = LEAST(deliver_at, now()), expires_at = now(), ring_ciphertext = $3 WHERE owner_id = $1 AND ring_id = $2',
        [o.ownerId, r.ring_id, seal(o, r.meeting_item_id, r.ring_id, { ...ring, reply, since: null })]);
    } else {
      const since = r.due ? r.deliver_at.toISOString() : ring.since;
      await exec(c, 'UPDATE call_rings SET deliver_at = now() + make_interval(secs => $3), expires_at = now() + make_interval(secs => $4), ring_ciphertext = $5 WHERE owner_id = $1 AND ring_id = $2',
        [o.ownerId, r.ring_id, PUT_OFF[reply], PUT_OFF[reply] + RING_SECONDS, seal(o, r.meeting_item_id, r.ring_id, { ...ring, reply: null, since })]);
    }
    rlog.info('ring answered', { ringId, meetingId: r.meeting_item_id });
    return { organizer: o, meetingId: r.meeting_item_id };
  });
}

/** An account going takes the rings to its address with it, in anyone's call. */
export function forget(o: Owner, c: Db, email: string): Promise<number> {
  return exec(c, 'DELETE FROM call_rings WHERE email_index = $1', [indexOf(o, email)]);
}

/** Rings go with their call; any that outlast a day, in a call that does too, are deleted (upkeep). */
export function sweep(d: Deps): Promise<number> {
  return exec(d.pool, `DELETE FROM call_rings WHERE expires_at < now() - interval '24 hours'`);
}

/* ---------- delivery: a stream of whole snapshots per browser tab ---------- */

/** Who's listening, by what finds their rings: never their keys. */
export interface Listener { ownerId: string; index: Uint8Array; sample: boolean; session: Uint8Array }
export async function listenerOf(o: Owner): Promise<Listener> {
  if (!o.session) throw new AuthError('Sign in to Alcove first.', { context: { ownerId: o.ownerId } });
  const p = await profile(o);
  return { ownerId: o.ownerId, index: indexOf(o, p.email), sample: p.sample, session: o.session.hash };
}

/** Every ring showing now to any of these people. */
const showing = (d: Deps, indexes: Uint8Array[]) => rows(d.pool, Row, `SELECT ${COLUMNS} FROM call_rings WHERE email_index = ANY($1) AND deliver_at <= now() AND expires_at > now() ORDER BY expires_at, ring_id`, [indexes]);
/** What a stream last said, to tell whether there's anything new. */
const seenIn = (found: Row[]) => found.map((r) => `${r.ring_id}@${r.expires_at.getTime()}`).join();

/** The cards for these rings: each read from its call, with its organizer's keys, which go when this read does. */
async function cardsFor(d: Deps, who: Listener, found: Row[]): Promise<IncomingRing[]> {
  const cards: IncomingRing[] = [];
  for (const r of found) {
    const o = await findOwner(d, r.owner_id, undefined);
    const meeting = o && await findItem(o, o.pool, 'meeting', r.meeting_item_id, MeetingManifest);
    // Gone since its row was read, on its own or with its organizer's account: nobody is ringing any more.
    if (!o || !meeting || !reaches(await profile(o), who)) continue;
    cards.push({ id: r.ring_id, code: meeting.manifest.code, title: meeting.manifest.title, from: await me(o), notes: meeting.manifest.notes, expiresAt: r.expires_at.toISOString() });
  }
  return cards;
}
const lineOf = (rings: IncomingRing[]) => utf8(`${JSON.stringify({ rings })}\n`);

interface Stream { who: Listener; key: string; seen: string; line: Uint8Array; sentAt: number; endsAt: number; out: ReadableStreamDefaultController<Uint8Array> }
/** The ticker runs for everyone listening: none of its lines are any one request's. */
const NO_REQUEST = { requestId: undefined, method: undefined, path: undefined, ownerId: undefined };

/** Every stream one API process holds, and the one ticker that keeps them up to date while there are any. */
export class RingStreams {
  private readonly open = new Set<Stream>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** `stopping`: the process is shutting down, so every stream ends and its browser goes to another instance. */
  constructor(private readonly d: Deps, stopping?: AbortSignal | undefined) {
    stopping?.addEventListener('abort', () => { for (const s of this.open) this.end(s); }, { once: true });
  }

  /** What's ringing someone now, then every change, one line of JSON each, for a few minutes. Released when the browser goes. */
  async connect(who: Listener): Promise<ReadableStream<Uint8Array>> {
    const found = await showing(this.d, [who.index]);
    const line = lineOf(await cardsFor(this.d, who, found));
    // Past everything that waits: nothing changes what's open between here and `start`, so a burst can't pass together.
    this.makeRoom(who);
    let stream: Stream | undefined;
    return new ReadableStream<Uint8Array>({
      start: (out) => {
        const now = Date.now();
        // Streams that opened together, after a deploy, don't all end together.
        const lasts = this.d.cfg.RING_STREAM_SECONDS * 1000 * (0.875 + Math.random() / 8);
        stream = { who, key: b64u(who.index), seen: seenIn(found), line, sentAt: now, endsAt: now + lasts, out };
        out.enqueue(line);
        this.open.add(stream);
        rlog.debug('rings stream opened', { listening: this.open.size });
        this.wake();
      },
      cancel: () => { if (stream) this.release(stream); }
    });
  }

  /**
   * Keeps to the limits, by what's open: a stream lasts minutes, so how many opened says little. Someone at a limit gives
   * up their own oldest stream, the one likeliest to be a tab that went without the server hearing, so a tab coming back
   * always gets in, and if that oldest tab is still there it opens another, as when any stream ends. Someone with none
   * to give up, on a full process, is told to try again, and their browser does, more slowly each time.
   */
  private makeRoom(who: Listener): void {
    const theirs = [...this.open].filter((s) => s.who.ownerId === who.ownerId);
    if (theirs.length < STREAMS_PER_ACCOUNT && this.open.size < STREAMS_PER_PROCESS) return;
    const [oldest] = theirs;
    if (!oldest) throw new UnavailableError('Too many attempts. Wait a minute and try again.', { context: { limit: 'open rings', listening: this.open.size } });
    this.end(oldest);
    rlog.debug('oldest rings stream ended to make room', { ownerId: who.ownerId, theirs: theirs.length, listening: this.open.size });
  }

  /** The ticker, as long as anyone is listening. Each tick starts after the last has finished, so a slow one never piles up. */
  private wake(): void {
    if (this.timer || !this.open.size) return;
    this.timer = setTimeout(() => { void withLogContext(NO_REQUEST, () => this.tick()); }, TICK_MS);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    try {
      const now = Date.now();
      for (const s of this.open) if (now >= s.endsAt) this.end(s);
      if (this.open.size) await this.read([...this.open], now);
    } catch (e) {
      rlog.warn('rings not read', { listening: this.open.size, err: e });
    } finally {
      this.timer = null;
      this.wake();
    }
  }

  /** One indexed query for everyone listening; only a stream whose rings changed reads any further. */
  private async read(listening: Stream[], now: number): Promise<void> {
    const found = await showing(this.d, [...new Map(listening.map((s) => [s.key, s.who.index])).values()]);
    const byPerson = new Map<string, Row[]>();
    for (const r of found) { const k = b64u(r.email_index); byPerson.set(k, [...(byPerson.get(k) ?? []), r]); }
    for (const s of listening) {
      const mine = byPerson.get(s.key) ?? [];
      const seen = seenIn(mine);
      if (seen !== s.seen) await this.change(s, mine, seen).catch((e: unknown) => rlog.warn('rings not delivered', { ownerId: s.who.ownerId, rings: mine.length, err: e }));
      else if (now - s.sentAt >= REPEAT_MS) this.send(s, s.line);
    }
  }

  /** Something changed for this stream. It lasts no longer than its session: whoever signed out hears nothing new, and if it fails it's tried again next tick. */
  private async change(s: Stream, mine: Row[], seen: string): Promise<void> {
    if (!(await stillOpen(this.d, s.who.session))) { this.end(s); return; }
    const line = lineOf(await cardsFor(this.d, s.who, mine));
    s.seen = seen;
    s.line = line;
    this.send(s, line);
    rlog.debug('rings delivered', { ownerId: s.who.ownerId, rings: mine.length });
  }

  private send(s: Stream, line: Uint8Array): void {
    if (!this.open.has(s)) return;
    s.out.enqueue(line);
    s.sentAt = Date.now();
  }

  /** The server is done with a stream: its browser opens another, and reads its rings afresh. */
  private end(s: Stream): void {
    if (this.release(s)) s.out.close();
  }

  private release(s: Stream): boolean {
    const held = this.open.delete(s);
    if (held) rlog.debug('rings stream closed', { listening: this.open.size });
    return held;
  }
}
