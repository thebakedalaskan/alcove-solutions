/*
 * Calls that repeat (docs: notes-and-inference › Series). A series scheduled to repeat is an item of its own, whose ID
 * is the `seriesId` its calls share: how it repeats, its one link and its recurring calendar event. Every call in it
 * is an ordinary meeting with its own code, so joining, notes and what carries over work as for any other call, and
 * `seriesCode` on a call says its series has an item: a `seriesId` alone doesn't. Series with no item are older shapes,
 * recurring Google events moved to Alcove and calls scheduled as the next one, and they work as they always did.
 *
 * The browser works out when each call starts, where the organizer is, so nothing here does sums with time zones. It
 * sends the times and the rule: the calls come from the times, and the rule is what Google gets.
 *
 * The calendar is a courtesy, as everywhere: if Google fails the calls still exist. But a series on a calendar is one
 * recurring event that many calls hang off, so whatever didn't reach it is logged, step by step.
 */
import { RepeatSchema, type ChangeScope, type MeetingInput, type Patch, type Repeat, type RepeatInput } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { exec, maybeOne, tx, type Db } from '../db';
import { ConflictError, InternalError, ValidationError, notFound } from '../errors';
import { log } from '../log';
import { createItem, findItem, getItem, listItems, lockItem, saveRevision, type Loaded } from '../vault';
import { syncAccessOf } from './access';
import { me } from './account';
import * as calendar from './calendar';
import { indexCode } from './codes';
import { MeetingManifest, all, changeCall, isOver, isPlacing, makeCode, minutesOf, showsOnEvent, updateManifest, validTimes, withChange } from './meetings';

const rlog = log.child({ component: 'repeats' });

export const SeriesManifest = z.object({
  /** The title its calls were given last, all together. One call can have another. */
  title: z.string(),
  /** Checked as it came in: a zone the runtime doesn't know some day must not stop the record opening. */
  repeat: RepeatSchema.extend({ timeZone: z.string() }),
  /** Its link's code: it leads to whichever of its calls is on now or next. */
  code: z.string(),
  /**
   * The recurring Google Calendar event that carries its latest calls. Changing this and later calls can leave an
   * earlier one carrying the calls before them: each call names its own (`calendarEvent.master`).
   */
  calendarEvent: z.object({ id: z.string() }).optional()
});
export type SeriesManifest = z.infer<typeof SeriesManifest>;
type Call = Loaded<MeetingManifest>;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const STARTED = 'This call has started, so it can’t change with the calls after it. Change the next one instead.';

const startOf = (m: Call) => new Date(m.manifest.startsAt).getTime();
const inOrder = (calls: Call[]) => [...calls].sort((a, b) => startOf(a) - startOf(b));
const callsOf = async (o: Owner, db: Db, seriesId: string) => (await all(o, db)).filter((m) => m.manifest.seriesId === seriesId);
/** The calls after this one that haven't started: what a change to this and later calls reaches. */
const laterThan = (calls: Call[], call: Call) => inOrder(calls).filter((m) => m.itemId !== call.itemId && m.manifest.status === 'scheduled' && startOf(m) >= startOf(call));

/** How each series these calls are in repeats, read once for the whole list. */
export async function repeatsOf(o: Owner, calls: Call[]): Promise<ReadonlyMap<string, Repeat>> {
  if (!calls.some((m) => m.manifest.seriesCode)) return new Map();
  return new Map((await listItems(o, o.pool, 'series', SeriesManifest)).map((s) => [s.itemId, s.manifest.repeat]));
}
/** How a series repeats, if it was scheduled to. */
export const repeatOf = async (o: Owner, seriesId: string): Promise<Repeat | undefined> => (await findItem(o, o.pool, 'series', seriesId, SeriesManifest))?.manifest.repeat;

/* ---------- the link: one code for all the calls ---------- */

/**
 * The call a series' link leads to: the one that's on, else the next one, else the latest. A call that ended keeps the
 * link until an hour after its time is up, so whoever opens it just after reads that it ended, and the organizer doesn't
 * start next week's call by opening it: that hour is the ended call's, and the organizer can reopen it as any call. A
 * next call that starts within the hour is the one people are coming to, so the link goes straight to it. The next
 * call's own Join can always start it early, and once it's on it has the link.
 */
export function leadsTo(calls: Call[]): Call | undefined {
  const soonest = inOrder(calls);
  const on = soonest.find((m) => m.manifest.status === 'live');
  if (on) return on;
  const next = soonest.find((m) => !isOver(m.manifest));
  const keeps = (m: Call) => new Date(m.manifest.endsAt).getTime() + HOUR_MS;
  const ended = soonest.filter((m) => m.manifest.status === 'ended' && keeps(m) > Date.now()).at(-1);
  if (ended && !(next && startOf(next) < keeps(ended))) return ended;
  return next ?? soonest.at(-1);
}

/** How long a link keeps leading to the call it was last found to, unless that call went or ended. */
const LEAD_MS = 5_000;
const MAX_LEADS = 10_000;
/**
 * Where links led a moment ago. Everyone waiting at a pre-join reads the call's card every few seconds, without an
 * account, and finding a series' calls opens every meeting its organizer has: for a call with 300 people invited, that
 * would be most of what this process does at the moment it starts. Only opaque IDs are kept here.
 */
const leads = new Map<string, { meetingId: string; ended: boolean; until: number }>();
const leadKey = (o: Owner, seriesId: string) => `${o.ownerId}/${seriesId}`;

/** The call a series' link leads to now, for anyone with the link. Undefined if no call in it is left. */
export async function callFor(o: Owner, seriesId: string): Promise<Call | undefined> {
  const key = leadKey(o, seriesId);
  const held = leads.get(key);
  if (held && held.until > Date.now()) {
    const m = await findItem(o, o.pool, 'meeting', held.meetingId, MeetingManifest);
    if (m && (held.ended || m.manifest.status !== 'ended')) return m;
  }
  const call = leadsTo(await callsOf(o, o.pool, seriesId));
  if (leads.size >= MAX_LEADS) leads.clear();
  if (call) leads.set(key, { meetingId: call.itemId, ended: call.manifest.status === 'ended', until: Date.now() + LEAD_MS });
  else leads.delete(key);
  return call;
}

/* ---------- taking turns ---------- */

/** How long a change waits for the one before it. Far longer than a change takes, unless Google is failing. */
const TURN_WAIT_MS = 20_000;
const TURN_POLL_MS = 100;
const Turn = z.object({ until: z.string() });

/**
 * Runs one change to a series, from its first write to Google's last answer, while no other change of this account's
 * is: two quick changes to one recurring event, interleaved, would each make a new event, or change one the other just
 * replaced. A row lock can't do this. Held across Google it would stop this account's audio uploads, which update the
 * same owner's row, and a transaction left open would tie up a connection a slow Google has no business holding. So
 * the turn is a time on the owner's row, taken and given back with one statement each, and it runs out by itself if
 * the process dies. Whoever comes second waits: nothing's held meanwhile. A change that started before a process died
 * can have left its calendar half done; what it did was logged as it went. A turn is given back by the time it took,
 * read as Postgres wrote it (a Date would lose its microseconds): a change that outlives its turn leaves the next
 * one's alone.
 */
async function inTurn<T>(o: Owner, what: string, fn: () => Promise<T>): Promise<T> {
  const giveUpAt = Date.now() + TURN_WAIT_MS;
  const take = () => maybeOne(o.pool, Turn, `UPDATE owners SET series_turn_until = now() + interval '2 minutes' WHERE owner_id = $1 AND (series_turn_until IS NULL OR series_turn_until < now()) RETURNING series_turn_until::text AS until`, [o.ownerId]);
  let turn = await take();
  while (!turn) {
    if (Date.now() > giveUpAt) throw new ConflictError('Your last change to this series is still going through. Try again in a moment.', { context: { what, waitedMs: TURN_WAIT_MS } });
    await new Promise((r) => setTimeout(r, TURN_POLL_MS));
    turn = await take();
  }
  try {
    return await fn();
  } finally {
    await exec(o.pool, 'UPDATE owners SET series_turn_until = NULL WHERE owner_id = $1 AND series_turn_until = $2::timestamptz', [o.ownerId, turn.until]).catch((e: unknown) => rlog.warn('series turn not given back', { what, err: e }));
  }
}

/* ---------- what comes in ---------- */

/**
 * When each call of a repeat starts, checked as far as can be without knowing the time zone's rules: the first is the
 * call itself, they're in order, and all still to come. None falls past `until` by more than a day, which is as far as
 * `until` can be from UTC. How many there can be is in the schema.
 */
function startsOf(r: RepeatInput, first: string): string[] {
  const context = { calls: r.occurrences.length };
  const lastDay = Date.parse(`${r.until}T23:59:59.999Z`);
  if (Number.isNaN(lastDay) || new Date(lastDay).toISOString().slice(0, 10) !== r.until) throw new ValidationError('Pick a real end date.', { context });
  if (r.rule.every === 'week' && new Set(r.rule.days).size !== r.rule.days.length) throw new ValidationError('Pick each day once.', { context });
  const at = r.occurrences.map((t) => new Date(t).getTime());
  if (at[0] !== new Date(first).getTime()) throw new ValidationError('A repeat starts at the call itself.', { context });
  if (at.some((t, i) => Number.isNaN(t) || t <= Date.now() || t <= (at[i - 1] ?? 0))) throw new ValidationError('The calls in a repeat have to be in order, and all still to come.', { context });
  if ((at.at(-1) ?? 0) > lastDay + DAY_MS) throw new ValidationError('A repeat can’t run past its end date.', { context });
  return at.map((t) => new Date(t).toISOString());
}
const ruleOf = ({ occurrences: _times, ...repeat }: RepeatInput): Repeat => repeat;

/** Another call in a series, starting at `startsAt`: `like` in everything a series shares. */
const anotherCall = (like: MeetingManifest, seriesId: string, seriesCode: string, startsAt: string, minutes: number): MeetingManifest => ({
  title: like.title, ...validTimes(startsAt, minutes), guests: like.guests, notes: like.notes, code: makeCode(), status: 'scheduled', seriesId, seriesCode,
  instant: false, choices: like.choices, joinMuted: like.joinMuted, documents: like.documents
});

/** New calls with the same guests, in the caller's transaction: their items, where their codes lead, and who's invited. */
async function addCalls(o: Owner, c: Db, manifests: MeetingManifest[]): Promise<string[]> {
  const ids: string[] = [];
  for (const m of manifests) {
    const { itemId } = await createItem(o, c, 'meeting', m);
    await indexCode(o, c, { ownerId: o.ownerId, meetingId: itemId, code: m.code });
    ids.push(itemId);
  }
  await syncAccessOf(o, c, ids, manifests[0]?.guests ?? []);
  return ids;
}

/** A new series' item and where its link leads, in the caller's transaction. `seriesId` is the ID of a series that has none yet. */
async function addSeries(o: Owner, c: Db, series: SeriesManifest, seriesId?: string | undefined): Promise<string> {
  const { itemId } = await createItem(o, c, 'series', series, seriesId);
  await indexCode(o, c, { ownerId: o.ownerId, meetingId: itemId, code: series.code });
  return itemId;
}

/** A series and its calls under their locks, in the caller's transaction: nobody starts one of them while it's changing. */
async function lockSeries(o: Owner, c: Db, seriesId: string): Promise<{ series: Loaded<SeriesManifest>; calls: Call[] }> {
  const ids = (await callsOf(o, c, seriesId)).map((m) => m.itemId);
  await exec(c, 'SELECT 1 FROM items WHERE owner_id = $1 AND item_id = ANY($2::text[]) ORDER BY item_id FOR UPDATE', [o.ownerId, ids]);
  return { series: await getItem(o, c, 'series', seriesId, SeriesManifest, 'That series'), calls: await callsOf(o, c, seriesId) };
}

/** Deletes calls for good, as cancelling one does, receipts of what they said included. */
async function deleteItems(o: Owner, c: Db, ids: string[]): Promise<void> {
  await exec(c, 'DELETE FROM items WHERE owner_id = $1 AND item_id = ANY($2::text[])', [o.ownerId, ids]);
  await exec(c, 'DELETE FROM operations WHERE owner_id = $1', [o.ownerId]);
}

/* ---------- the calendar ---------- */

/** Runs one step of bringing a calendar in line. A step that fails is logged, and says so to whatever depends on it. */
async function attempt(seriesId: string, step: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    rlog.warn('series not brought up to date on calendar', { seriesId, step, err: e });
    return false;
  }
}
/**
 * The recurring event that carries a call: the one it names, or `current` for a call whose occurrence wasn't found. A
 * call that has an event of its own, as a call scheduled as the next one in a series does, has none.
 */
const carrierOf = (current: string | undefined) => ({ manifest: { calendarEvent: e } }: Call) => (e ? e.master : current);
const hasOwnEvent = (m: Call) => !!m.manifest.calendarEvent && !m.manifest.calendarEvent.master;

/** Keeps which occurrence each call is. A call that's the same as before gets no new revision. */
async function keepOccurrences(o: Owner, master: string, calls: Call[], found: ReadonlyMap<string, calendar.Instance>): Promise<void> {
  const moved = calls.flatMap((m) => {
    const i = found.get(m.itemId);
    const e = m.manifest.calendarEvent;
    return i && (e?.id !== i.id || e.master !== master || e.url !== i.url) ? [{ id: m.itemId, instance: i }] : [];
  });
  if (!moved.length) return;
  await tx(o.pool, async (c) => {
    for (const { id, instance } of moved) await updateManifest(o, c, id, (m) => ({ ...m, calendarEvent: { id: instance.id, ...(instance.url ? { url: instance.url } : {}), adopted: false, master } }));
  });
}

/** Whether an occurrence says what its call says. A recurring event's occurrences all take the length of its first. */
function matches(i: calendar.Instance, m: MeetingManifest): boolean {
  const guests = new Set(m.guests.map((e) => e.toLowerCase()));
  return i.title === m.title && new Date(i.endsAt).getTime() === new Date(m.endsAt).getTime() && i.guests.length === guests.size && i.guests.every((e) => guests.has(e));
}

/**
 * Makes a recurring event's occurrences match the calls it carries, and keeps each one's ID. Google works them out from
 * the rule, which knows nothing of a call moved or cancelled on its own, so a new recurring event can have one too many,
 * or one at the wrong time: it's moved to a call with none, or taken off the calendar. All of that happens quietly,
 * inside a change everyone just heard about. An occurrence and a call that can't be matched are logged, and the call
 * still exists.
 */
async function settleOccurrences(o: Owner, seriesId: string, master: string, calls: Call[], timeZone: string): Promise<void> {
  const free = new Map((await calendar.instances(o, master)).map((i) => [new Date(i.startsAt).getTime(), i]));
  const found = new Map<string, calendar.Instance>();
  const loose: Call[] = [];
  for (const m of inOrder(calls)) {
    const i = free.get(startOf(m));
    if (i) { free.delete(startOf(m)); found.set(m.itemId, i); } else loose.push(m);
  }
  const spare = [...free.values()];
  const adrift = loose.splice(spare.length);
  const moved = loose.flatMap((m) => { const i = spare.shift(); if (i) found.set(m.itemId, i); return i ? [m] : []; });
  await keepOccurrences(o, master, calls, found);
  // What goes to a recurring event goes to all of it: a call changed on its own stays as it is.
  const differing = calls.filter((m) => { const i = found.get(m.itemId); return i && !moved.includes(m) && !matches(i, m.manifest); });
  for (const m of [...moved, ...differing]) {
    const i = found.get(m.itemId);
    if (i) await calendar.changeInstance(o, i.id, m.itemId, m.manifest, timeZone, true);
  }
  for (const i of spare) await calendar.dropInstance(o, i.id);
  if (moved.length || spare.length || adrift.length) rlog.warn('calendar occurrences didn’t match the calls', { seriesId, calls: calls.length, moved: moved.length, dropped: spare.length, unmatched: adrift.length });
}

/**
 * Finds a call's occurrence when it doesn't know it: they couldn't be read when the series was scheduled. It has to be
 * now, before a change: moved, a call can't be told from the rest by its time, and cancelled, it's gone. Whatever can't
 * be found is logged, here and by the step that needed it, and the change goes ahead without the calendar.
 */
async function findOccurrence(o: Owner, seriesId: string, id: string): Promise<void> {
  const series = await findItem(o, o.pool, 'series', seriesId, SeriesManifest);
  const master = series?.manifest.calendarEvent?.id;
  if (!series || !master) return;
  const calls = await callsOf(o, o.pool, seriesId);
  if (calls.find((m) => m.itemId === id)?.manifest.calendarEvent || !(await calendar.connected(o))) return;
  const carrier = carrierOf(master);
  await attempt(seriesId, 'occurrences', () => settleOccurrences(o, seriesId, master, calls.filter((m) => carrier(m) === master), series.manifest.repeat.timeZone));
}
/** Logs a step that couldn't happen: a call with no occurrence to do it to. */
const noOccurrence = (seriesId: string, step: string, meetingId: string) => rlog.warn('series not brought up to date on calendar', { seriesId, step, meetingId, why: 'its occurrence isn’t known' });

/** Keeps which recurring event carries the series' latest calls, or that none does. */
async function keepCarrier(o: Owner, seriesId: string, eventId: string | undefined): Promise<void> {
  await tx(o.pool, async (c) => {
    await lockItem(o, c, seriesId);
    const s = await findItem(o, c, 'series', seriesId, SeriesManifest);
    if (!s || s.manifest.calendarEvent?.id === eventId) return;
    const { calendarEvent: _old, ...rest } = s.manifest;
    await saveRevision(o, c, seriesId, s.revisionId, { ...rest, ...(eventId ? { calendarEvent: { id: eventId } } : {}) });
  });
}

/** A run of calls on one recurring event, `first` being the first of `calls`, which are in order. */
const runOf = (repeat: Repeat, first: Call, calls: Call[]): calendar.SeriesRun => ({ repeat, first: first.manifest, last: (calls.at(-1) ?? first).manifest });

/**
 * Takes calls off the recurring events that carry them: one with calls left ends before the first to go, and one left
 * with none goes altogether. `staying` is every call the series keeps.
 */
async function release(o: Owner, seriesId: string, leaving: Call[], staying: Call[], carrier: (m: Call) => string | undefined, timeZone: string): Promise<void> {
  const masters = new Set(leaving.flatMap((m) => carrier(m) ?? []));
  for (const master of masters) {
    const rest = staying.filter((m) => carrier(m) === master);
    const first = inOrder(leaving.filter((m) => carrier(m) === master))[0];
    if (!rest.length) await attempt(seriesId, 'withdraw', () => calendar.withdraw(o, master, seriesId));
    else if (first) {
      await attempt(seriesId, 'end', async () => {
        await calendar.endSeries(o, master, seriesId, first.manifest.startsAt);
        await settleOccurrences(o, seriesId, master, rest, timeZone);
      });
    }
  }
}

/** Puts a series on the calendar from scratch, or from the event its first call already has. */
async function putOnCalendar(o: Owner, seriesId: string, series: SeriesManifest, calls: Call[]): Promise<void> {
  const first = calls[0];
  if (!first) return;
  const run = runOf(series.repeat, first, calls);
  const held = first.manifest.calendarEvent?.id;
  let master = held;
  const placed = held
    ? await attempt(seriesId, 'repeat', () => calendar.changeSeries(o, held, seriesId, first.manifest, { run, guests: true }))
    : await attempt(seriesId, 'place', async () => { master = await calendar.placeSeries(o, seriesId, run); });
  if (!placed || !master) return;
  await keepCarrier(o, seriesId, master);
  const carrier = master;
  await attempt(seriesId, 'occurrences', () => settleOccurrences(o, seriesId, carrier, calls, series.repeat.timeZone));
}

/* ---------- scheduling a series ---------- */

/**
 * Schedules a series from its first call as it would be on its own, and gives back that call's ID: the series' item,
 * its link and a call for each start, in one transaction, then one event on the calendar for all of them.
 */
export async function schedule(o: Owner, first: MeetingManifest, input: RepeatInput): Promise<string> {
  const starts = startsOf(input, first.startsAt);
  const minutes = minutesOf(first);
  return inTurn(o, 'schedule', async () => {
    const series: SeriesManifest = { title: first.title, repeat: ruleOf(input), code: makeCode() };
    const { seriesId, ids } = await tx(o.pool, async (c) => {
      const seriesId = await addSeries(o, c, series);
      return { seriesId, ids: await addCalls(o, c, starts.map((s) => anotherCall(first, seriesId, series.code, s, minutes))) };
    });
    const firstId = ids[0];
    if (firstId === undefined) throw new InternalError('A series was scheduled with no calls.', { context: { seriesId } });
    rlog.info('series scheduled', { seriesId, calls: ids.length, guests: first.guests.length, notes: first.notes });
    if (await calendar.places(o)) await putOnCalendar(o, seriesId, series, inOrder(await callsOf(o, o.pool, seriesId)));
    return firstId;
  });
}

/**
 * Makes a call repeat. Its own calendar event, if it has one, becomes the recurring event, so everyone gets one update
 * and not a cancellation and a new invitation. A call scheduled as the next one has a series ID already: the series
 * keeps it, so what carries over still does, and the calls already in it are in this series now: a time one of them
 * already has makes no second call, and if it has no event of its own yet it's on the recurring one with the rest.
 */
async function startRepeating(o: Owner, id: string, patch: Patch<MeetingInput>, input: RepeatInput): Promise<void> {
  const organizer = await me(o);
  const made = await tx(o.pool, async (c) => {
    await lockItem(o, c, id);
    const { manifest: was } = await getItem(o, c, 'meeting', id, MeetingManifest, 'That meeting');
    const context = { meetingId: id };
    if (was.seriesCode) throw new ConflictError('This call repeats already. Change this and later calls to change how.', { context });
    if (was.instant) throw new ConflictError('A call that’s started now can’t repeat. Schedule one instead.', { context });
    if (was.offer) throw new ConflictError('This call is waiting for someone to pick a time, so it can’t repeat yet.', { context });
    if (isPlacing(was)) throw new ConflictError('This call is going on your calendar. Try again in a moment.', { context });
    if (was.calendarEvent?.adopted || was.recurringEventId) throw new ConflictError('This call is your own event on Google Calendar. Set it to repeat there.', { context });
    const changed = withChange(was, patch, organizer.email, id);
    const starts = startsOf(input, changed.startsAt);
    const series: SeriesManifest = { title: changed.title, repeat: ruleOf(input), code: makeCode() };
    const seriesId = await addSeries(o, c, series, was.seriesId);
    const next = await updateManifest(o, c, id, () => ({ ...changed, seriesId, seriesCode: series.code }));
    const others = (await callsOf(o, c, seriesId)).filter((m) => m.itemId !== id);
    for (const m of others) await updateManifest(o, c, m.itemId, (x) => ({ ...x, seriesCode: series.code }));
    await syncAccessOf(o, c, [id], next.guests);
    const taken = new Set(others.map(startOf));
    const added = await addCalls(o, c, starts.slice(1).filter((s) => !taken.has(new Date(s).getTime())).map((s) => anotherCall(next, seriesId, series.code, s, minutesOf(next))));
    const wanted = new Set(starts.map((s) => new Date(s).getTime()));
    const joining = others.filter((m) => wanted.has(startOf(m)) && !m.manifest.calendarEvent).map((m) => m.itemId);
    return { seriesId, series, ids: new Set([id, ...added, ...joining]) };
  });
  rlog.info('call made a series', { seriesId: made.seriesId, meetingId: id, calls: made.ids.size });
  const calls = inOrder((await callsOf(o, o.pool, made.seriesId)).filter((m) => made.ids.has(m.itemId)));
  if (calls[0]?.manifest.calendarEvent ? await calendar.connected(o) : await calendar.places(o)) await putOnCalendar(o, made.seriesId, made.series, calls);
}

/* ---------- changing calls in a series ---------- */

/** One call, on its own: its occurrence changes, and the recurring event stays as it is. */
async function changeOne(o: Owner, id: string, seriesId: string, patch: Patch<MeetingInput>): Promise<void> {
  if (showsOnEvent(patch)) await findOccurrence(o, seriesId, id);
  const next = await changeCall(o, id, patch);
  leads.delete(leadKey(o, seriesId));
  const event = next.calendarEvent;
  const series = await findItem(o, o.pool, 'series', seriesId, SeriesManifest);
  if (!series || !showsOnEvent(patch) || !(await calendar.connected(o))) return;
  if (event) await attempt(seriesId, 'instance', () => calendar.changeInstance(o, event.id, id, next, series.manifest.repeat.timeZone));
  else if (series.manifest.calendarEvent) noOccurrence(seriesId, 'instance', id);
}

/** What a change to this and later calls leaves the calendar to catch up with. */
interface Reach {
  series: SeriesManifest;
  /** The calls it reached, as they are now, in order. */
  calls: Call[];
  /** The same calls as they were, with any it deleted, in order: what the calendar still shows. */
  was: Call[];
  /** The series' other calls. */
  stays: Call[];
  /** The change is one the calendar shows. */
  showing: boolean;
  /** The calls' times, or the rule, changed. */
  timed: boolean;
  /** Who's invited changed. */
  guests: boolean;
}

/**
 * Brings the calendar in line with a change to this and later calls. When this was the first call the recurring event
 * carries, the event itself changes. Otherwise it would change the calls before this one too, so a new one takes over
 * from here, carrying the same link, and the old one ends just before: Google does the same with "this and following
 * events". The new one goes first, because if it fails nothing's been taken off anyone's calendar.
 */
async function moveOnCalendar(o: Owner, seriesId: string, { series, calls, was, stays, showing, timed, guests }: Reach): Promise<void> {
  const { repeat } = series;
  const carrier = carrierOf(series.calendarEvent?.id);
  // A call with an event of its own changes there, or takes it with it.
  for (const m of calls.filter(hasOwnEvent)) {
    const eventId = m.manifest.calendarEvent?.id;
    if (eventId && showing) await attempt(seriesId, 'instance', () => calendar.changeInstance(o, eventId, m.itemId, m.manifest, repeat.timeZone));
  }
  for (const m of was.filter((x) => hasOwnEvent(x) && !calls.some((c) => c.itemId === x.itemId))) {
    const eventId = m.manifest.calendarEvent?.id;
    if (eventId) await attempt(seriesId, 'withdraw', () => calendar.withdraw(o, eventId, m.itemId));
  }
  const riding = calls.filter((m) => !hasOwnEvent(m));
  const first = riding[0];
  if (!first) { await release(o, seriesId, was, stays, carrier, repeat.timeZone); return; }
  // With none before them on a recurring event, the calls a change made start one of their own.
  const from = was.find((m) => !hasOwnEvent(m));
  const held = from && carrier(from);
  // Nothing has been on a calendar yet: this is the first chance to put it there, if that's what the account wants.
  if (!held && !(await calendar.places(o))) return;
  const run = runOf(repeat, first, riding);
  const isFirst = !!held && !!from && !stays.some((m) => carrier(m) === held && startOf(m) < startOf(from));
  // Calls another event carries are about to leave it: this one has to reach them first, or they'd leave the calendar.
  const reaching = timed || was.some((m) => !hasOwnEvent(m) && carrier(m) !== held);
  let master = isFirst ? held : undefined;
  const moved = isFirst
    ? await attempt(seriesId, 'change', () => calendar.changeSeries(o, held, seriesId, run.last, { ...(reaching ? { run } : {}), guests }))
    : await attempt(seriesId, 'place', async () => { master = await calendar.placeSeries(o, seriesId, run); });
  if (!moved || !master) return;
  const carrying = master;
  await keepCarrier(o, seriesId, carrying);
  await attempt(seriesId, 'occurrences', () => settleOccurrences(o, seriesId, carrying, [...riding, ...stays.filter((m) => carrier(m) === carrying)], repeat.timeZone));
  await release(o, seriesId, was.filter((m) => carrier(m) !== carrying), stays, carrier, repeat.timeZone);
}

/**
 * This call and every later one that hasn't started. A call that's on or over is never rewritten. Moving them takes
 * `repeat`: its times are paired with the calls in order, new calls are made for times left over, and calls left over
 * are deleted, so someone's answer to a call that keeps its place stays.
 */
async function changeFollowing(o: Owner, id: string, seriesId: string, patch: Patch<MeetingInput>): Promise<void> {
  const organizer = await me(o);
  if (patch.startsAt !== undefined && !patch.repeat) throw new ValidationError('Moving this and later calls takes how they repeat.', { context: { meetingId: id } });
  const change = await tx(o.pool, async (c) => {
    const { series, calls } = await lockSeries(o, c, seriesId);
    const call = calls.find((m) => m.itemId === id);
    if (!call) throw notFound('That meeting', { meetingId: id });
    if (call.manifest.status !== 'scheduled') throw new ConflictError(STARTED, { context: { meetingId: id, status: call.manifest.status } });
    const was = [call, ...laterThan(calls, call)];
    const starts = patch.repeat ? startsOf(patch.repeat, patch.startsAt ?? call.manifest.startsAt) : undefined;
    const kept = starts ? was.slice(0, starts.length) : was;
    const left = was.slice(kept.length);
    const changed: MeetingManifest[] = [];
    for (const [i, m] of kept.entries()) {
      const startsAt = starts?.[i];
      changed.push(await updateManifest(o, c, m.itemId, (cur) => withChange(cur, startsAt === undefined ? patch : { ...patch, startsAt }, organizer.email, m.itemId)));
    }
    const like = changed[0];
    if (!like) throw notFound('That meeting', { meetingId: id });
    if (patch.guests) await syncAccessOf(o, c, kept.map((m) => m.itemId), like.guests);
    const added = await addCalls(o, c, (starts ?? []).slice(kept.length).map((s) => anotherCall(like, seriesId, series.manifest.code, s, minutesOf(like))));
    if (left.length) await deleteItems(o, c, left.map((m) => m.itemId));
    const next: SeriesManifest = { ...series.manifest, title: patch.title?.trim() || series.manifest.title, repeat: patch.repeat ? ruleOf(patch.repeat) : series.manifest.repeat };
    if (patch.repeat || next.title !== series.manifest.title) await saveRevision(o, c, seriesId, series.revisionId, next);
    return { series: next, was, stays: calls.filter((m) => !was.includes(m)), reached: new Set([...kept.map((m) => m.itemId), ...added]), added: added.length, deleted: left.length };
  });
  rlog.info('calls in a series changed', { seriesId, meetingId: id, calls: change.reached.size, added: change.added, deleted: change.deleted, fields: Object.keys(patch).length });
  leads.delete(leadKey(o, seriesId));
  const showing = showsOnEvent(patch) || !!patch.repeat;
  if ((!showing && change.series.calendarEvent) || !(await calendar.connected(o))) return;
  const calls = inOrder((await callsOf(o, o.pool, seriesId)).filter((m) => change.reached.has(m.itemId)));
  await moveOnCalendar(o, seriesId, { series: change.series, calls, was: change.was, stays: change.stays, showing, timed: !!patch.repeat || patch.durationMinutes !== undefined, guests: patch.guests !== undefined });
}

/**
 * Changes a call with `repeat`, or one in a series, as far as `scope` says: only this call unless it says otherwise.
 * `repeat` on a call that doesn't repeat makes it a series. Anything older that's called a series has no way to reach
 * the calls after a call: a recurring Google event's aren't all in Alcove, and calls scheduled as the next one each have
 * a plain event of their own.
 */
export async function changeInSeries(o: Owner, id: string, m: MeetingManifest, patch: Patch<MeetingInput>, scope: ChangeScope | undefined): Promise<void> {
  const { seriesId, seriesCode } = m;
  const context = { meetingId: id };
  if (!seriesCode || !seriesId) {
    const { repeat } = patch;
    if (!repeat) throw new ConflictError('This call doesn’t repeat, so there are no later calls to change with it.', { context });
    return inTurn(o, 'repeat', () => startRepeating(o, id, patch, repeat));
  }
  if (scope === 'following') return inTurn(o, 'following', () => changeFollowing(o, id, seriesId, patch));
  if (patch.repeat) throw new ValidationError('How a series repeats changes for this and later calls, not one call.', { context });
  return inTurn(o, 'this', () => changeOne(o, id, seriesId, patch));
}

/* ---------- cancelling ---------- */

/** The day a moment falls on where the organizer is, as `Repeat.until` has it. */
function dayIn(timeZone: string, iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Takes cancelled calls off the calendar. The last call on a recurring event takes the event with it. */
async function takeOffCalendar(o: Owner, seriesId: string, series: SeriesManifest, gone: Call[], left: Call[], scope: ChangeScope | undefined): Promise<void> {
  if (!(await calendar.connected(o))) return;
  const current = series.calendarEvent?.id;
  const carrier = carrierOf(current);
  const { timeZone } = series.repeat;
  for (const m of gone.filter(hasOwnEvent)) {
    const eventId = m.manifest.calendarEvent?.id;
    if (eventId) await attempt(seriesId, 'withdraw', () => calendar.withdraw(o, eventId, m.itemId));
  }
  if (scope === 'following' || !left.length) await release(o, seriesId, gone, left, carrier, timeZone);
  else {
    for (const m of gone.filter((x) => !hasOwnEvent(x))) {
      const master = carrier(m);
      const eventId = m.manifest.calendarEvent?.id;
      if (master && !left.some((x) => carrier(x) === master)) await attempt(seriesId, 'withdraw', () => calendar.withdraw(o, master, seriesId));
      else if (eventId) await attempt(seriesId, 'withdraw', () => calendar.withdraw(o, eventId, m.itemId));
      else if (master) noOccurrence(seriesId, 'withdraw', m.itemId);
    }
  }
  if (!current) return;
  const carried = left.some((m) => carrier(m) === current);
  // No call was left to say the series' own event should go: nothing else will.
  if (!left.length && !gone.some((m) => carrier(m) === current)) await attempt(seriesId, 'withdraw', () => calendar.withdraw(o, current, seriesId));
  if (left.length && !carried) await keepCarrier(o, seriesId, inOrder(left).flatMap((m) => m.manifest.calendarEvent?.master ?? []).at(-1));
}

/**
 * Cancels a call in a series, or with `following` it and every later one that hasn't started. When no call is left, the
 * series goes too, with its link: from the first call that's the whole series, however its calls went. Earlier calls
 * that have been held stay with their notes, and the link leads to the latest of them.
 */
export async function cancelInSeries(o: Owner, id: string, seriesId: string, scope: ChangeScope | undefined): Promise<void> {
  await inTurn(o, 'cancel', async () => {
    // This and later calls end the event by time. One call alone has to say which occurrence is its own.
    if (scope !== 'following') await findOccurrence(o, seriesId, id);
    const out = await tx(o.pool, async (c) => {
      const { series, calls } = await lockSeries(o, c, seriesId);
      const call = calls.find((m) => m.itemId === id);
      if (!call) throw notFound('That meeting', { meetingId: id });
      if (call.manifest.status === 'live') throw new ConflictError('That call is happening now. Leave it first.', { context: { meetingId: id } });
      if (scope === 'following' && call.manifest.status !== 'scheduled') throw new ConflictError('This call has started, so it can’t be cancelled with the calls after it. Cancel from the next one instead.', { context: { meetingId: id, status: call.manifest.status } });
      const gone = scope === 'following' ? [call, ...laterThan(calls, call)] : [call];
      const left = calls.filter((m) => !gone.includes(m));
      await deleteItems(o, c, [...gone.map((m) => m.itemId), ...(left.length ? [] : [seriesId])]);
      const last = inOrder(left).at(-1);
      const until = last ? dayIn(series.manifest.repeat.timeZone, last.manifest.startsAt) : series.manifest.repeat.until;
      if (left.length && until < series.manifest.repeat.until) await saveRevision(o, c, seriesId, series.revisionId, { ...series.manifest, repeat: { ...series.manifest.repeat, until } });
      return { series: series.manifest, gone, left };
    });
    rlog.info('calls in a series cancelled', { seriesId, meetingId: id, cancelled: out.gone.length, left: out.left.length });
    leads.delete(leadKey(o, seriesId));
    await takeOffCalendar(o, seriesId, out.series, out.gone, out.left, scope);
  });
}

/* ---------- deleting an account ---------- */

/**
 * The recurring events to withdraw when an account goes: of every series with a call still to come, once each, so
 * everyone hears once and not for each call. What's only in the past stays on the calendar, as a call that's been held does.
 */
export async function eventsToWithdraw(o: Owner, upcoming: Call[]): Promise<{ meetingId: string; eventId: string }[]> {
  const due = new Map<string, string>();
  const going = new Set(upcoming.flatMap((m) => (m.manifest.seriesCode && m.manifest.seriesId ? [m.manifest.seriesId] : [])));
  if (!going.size) return [];
  for (const s of await listItems(o, o.pool, 'series', SeriesManifest)) if (going.has(s.itemId) && s.manifest.calendarEvent) due.set(s.manifest.calendarEvent.id, s.itemId);
  for (const m of upcoming) {
    const master = m.manifest.calendarEvent?.master;
    if (master && m.manifest.seriesId) due.set(master, m.manifest.seriesId);
  }
  return [...due].map(([eventId, meetingId]) => ({ meetingId, eventId }));
}
