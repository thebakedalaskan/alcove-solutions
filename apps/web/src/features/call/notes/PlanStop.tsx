/*
 * When the organizer's plan stops a call's notes (docs: Plans and usage › Running out in a call; the plans spec's doors, 4).
 * What's said about it is the same in the banner over the call, at the top of Notes and in what's captured. Whoever organizes
 * has the ways to more (Get Pro, more hours for this period, room), each opening checkout over the call. Once they've bought
 * more, notes come on again by themselves and say so; when the plan has notes again without a purchase (a new period), the
 * organizer is asked, with Turn notes on. Everyone else is told whose notes ran out, with nothing to buy: a
 * call's notes are on its organizer's plan. Where notes stopped and came on again is marked in the notes.
 */
import { CallStopsSeenSchema, errorCode, notesAreOn, type CallSession, type CallState, type Plan } from '@alcove/api';
import { Button, Icon, buttonClass, useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCheckout } from '~/features/plans/checkout';
import { hoursLabel, hoursOfNotes } from '~/features/plans/words';
import { log } from '~/lib/log';
import { q } from '~/lib/queries';
import { dayFullMonth, hm, hms } from '~/lib/time';
import { capital } from '~/lib/words';
import { organizerName } from './Capture';

const slog = log.child({ component: 'plan-stop' });

/** A way to more, for whoever organizes: Pro, more hours for this period, or room in their storage. */
export type StopWay = { kind: 'pro' } | { kind: 'hours'; label: string } | { kind: 'room' } | { kind: 'on'; go: () => void; busy: boolean };

/** Notes stopped by the organizer's plan, as it's said: a few words, a sentence, and the ways to more (none for anyone else). */
export interface PlanStop { reason: 'notes' | 'storage'; at: string; title: string; line: string; ways: StopWay[] }

/** Whether the organizer's plan has stopped this call's notes: the stop is in force while notes are off because of it. */
const stopOf = (state: CallState) => {
  const s = state.capture.stopped;
  return s && !notesAreOn(state.capture.mode) ? s : null;
};

/** How often the organizer's plan is read while it has stopped their call's notes: a payment from another device lands here soon. */
const STOPPED_READ_MS = 10_000;

/**
 * What's said while the organizer's plan has stopped this call's notes, or null when it hasn't. To whoever organizes: this
 * period's hours (from their plan) or their storage, that the call carries on and notes start again the moment they have
 * more, and the ways to it: Get Pro on Free, more hours (when offered) for notes, room for storage. To everyone else: whose
 * notes or storage ran out, that the call carries on, and that what was written before stays.
 */
export function usePlanStop(state: CallState): PlanStop | null {
  const s = stopOf(state);
  const host = state.isOrganizer;
  const plan = useQuery({ ...q.plan(), enabled: host && s !== null, refetchInterval: STOPPED_READ_MS }).data;
  const offers = useQuery({ ...q.offers(), enabled: host && s !== null }).data;
  /* The plan as it is once notes stop, not as it was read before: what's said, and offered, follows it. */
  const qc = useQueryClient();
  const stoppedAt = s?.at ?? null;
  useEffect(() => { if (host && stoppedAt) void qc.invalidateQueries({ queryKey: q.plan().queryKey, exact: true }); }, [host, stoppedAt, qc]);
  if (!s) return null;
  if (!host) {
    const whose = capital(organizerName(state));
    return {
      reason: s.reason, at: s.at, title: 'Notes stopped', ways: [],
      line: s.reason === 'storage' ? `${whose}’s storage is full, and the call carries on. What was written before stays.` : `${whose}’s notes for this period are used up, and the call carries on. What was written before stays.`
    };
  }
  const ways: StopWay[] = [];
  if (plan?.kind === 'free') ways.push({ kind: 'pro' });
  if (s.reason === 'notes' && plan && offers?.hours) ways.push({ kind: 'hours', label: hoursLabel(offers.hours) });
  if (s.reason === 'storage' && plan) ways.push({ kind: 'room' });
  if (s.reason === 'storage') {
    return { reason: s.reason, at: s.at, title: 'Notes stopped: your storage is full', line: 'The call carries on. Notes start again the moment you have room.', ways };
  }
  const title = plan ? `Notes stopped at this period’s ${hoursOfNotes(plan.notes.minutesPerPeriod)}` : 'Notes stopped';
  const line = !plan || ways.length > 0 ? 'The call carries on. Notes start again the moment you have more.' : `The call carries on. Notes start again on ${dayFullMonth(new Date(plan.period.to))}.`;
  return { reason: s.reason, at: s.at, title, line, ways };
}

/** The ways to more, for whoever organizes: the first fills, the rest sit beside it. Checkout opens over the call. */
export function StopWays({ ways }: { ways: readonly StopWay[] }) {
  const checkout = useCheckout();
  return (
    <>
      {ways.map((w, i) => {
        const variant = i === 0 ? 'primary' : 'secondary';
        if (w.kind === 'pro') return <Button key="pro" size="sm" variant={variant} onClick={() => checkout.open({ plan: 'pro' }, 'call')}>Get Pro</Button>;
        if (w.kind === 'hours') return <Button key="hours" size="sm" variant={variant} onClick={() => checkout.open({ plan: 'hours' }, 'call')}>{w.label}</Button>;
        if (w.kind === 'on') return <Button key="on" size="sm" variant={variant} loading={w.busy} onClick={w.go}>Turn notes on</Button>;
        // The Drive opens beside the call, which goes on here.
        return <a key="room" className={buttonClass({ variant, size: 'sm' })} href="/drive" target="_blank" rel="noopener noreferrer">Make room</a>;
      })}
    </>
  );
}

/**
 * At the top of Notes, over its tabs, while the organizer's plan has stopped them: what happened in caution, the sentence,
 * and the ways to more for whoever organizes. It says it for every tab, so nothing under the tabs says it again.
 */
export function NotesStopBar({ stop }: { stop: PlanStop }) {
  return (
    <div className="nn-stop" role="status">
      <Icon name="alert" size={18} />
      <div className="nn-stop-t"><b>{stop.title}</b><p>{stop.line}</p></div>
      {stop.ways.length > 0 && <div className="nn-stop-a"><StopWays ways={stop.ways} /></div>}
    </div>
  );
}

/* ---------- where notes stopped and came on again, in the notes ---------- */

/** One stop as this tab saw it: when notes stopped, and when they came on again (null while they're still stopped). */
export interface StopMark { at: string; back: string | null }
const marksKey = (callId: string) => `alcove.call-stops.${callId}`;
function readMarks(callId: string): StopMark[] {
  try {
    const r = CallStopsSeenSchema.safeParse(JSON.parse(sessionStorage.getItem(marksKey(callId)) ?? '[]'));
    return r.success ? r.data : [];
  } catch (e) {
    slog.debug('where notes stopped isn’t readable', { err: e });
    return [];
  }
}
function keepMarks(callId: string, marks: readonly StopMark[]): void {
  try { sessionStorage.setItem(marksKey(callId), JSON.stringify(marks.slice(-20))); } catch (e) { slog.debug('where notes stopped isn’t kept', { err: e }); }
}

/**
 * Where the organizer's plan stopped notes in this call, and where they came on again, oldest first, for everyone in it. The
 * call says when notes stopped while the stop is in force; once notes are on again it forgets the stop, so this tab keeps
 * both (sessionStorage, through a reload; only times). Notes coming on again is when the call's recording or transcript
 * last changed, as the server says it.
 */
export function useStopMarks(state: CallState): StopMark[] {
  const { callId, capture } = state;
  const [marks, setMarks] = useState<StopMark[]>(() => readMarks(callId));
  const stoppedAt = capture.stopped?.at ?? null;
  const on = notesAreOn(capture.mode);
  const since = capture.recording.since ?? capture.transcript.since;
  useEffect(() => {
    setMarks((was) => {
      let next = was;
      if (stoppedAt && !was.some((m) => m.at === stoppedAt)) next = [...was, { at: stoppedAt, back: null }];
      const last = next.at(-1);
      if (last && last.back === null && !stoppedAt && on) next = [...next.slice(0, -1), { ...last, back: since ?? new Date().toISOString() }];
      if (next !== was) keepMarks(callId, next);
      return next;
    });
  }, [callId, stoppedAt, on, since]);
  return marks;
}

/**
 * The marks in the notes: "Notes stopped · 16:44" in caution, and "Notes on again · 16:47" in the notes' own colour, to the
 * second when both fall in one minute, as a stretch of the transcript says it.
 */
export function StopMarks({ marks }: { marks: readonly StopMark[] }) {
  if (!marks.length) return null;
  return (
    <div className="nn-cuts">
      {marks.map((m) => {
        const close = m.back !== null && hm(m.at) === hm(m.back);
        const time = close ? hms : hm;
        return (
          <div key={m.at}>
            <p className="nn-cut">Notes stopped · {time(m.at)}</p>
            {m.back && <p className="nn-cut is-on">Notes on again · {time(m.back)}</p>}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- notes on again, the moment the organizer's plan has more ---------- */

/** The room notes need to come on again after storage stopped them, as the server asks: 1 MiB. */
const ROOM_BYTES = 2 ** 20;
/** Whether the plan has what notes need to come on again: notes left this period, or room in storage. */
function canGo(reason: 'notes' | 'storage', p: Plan): boolean {
  return reason === 'storage' ? !p.over.storage && p.storage.limitBytes - p.storage.usedBytes >= ROOM_BYTES : !p.notes.stopped && p.notes.minutesLeft > 0;
}
/**
 * Whether the organizer's plan has more than it had (`was`): Pro or Team bought, more hours this period (they add to the
 * period's notes), a new period, or more room. Only a plan that has changed is tried again, so one that showed a minute or two
 * left as notes stopped isn't tried over and over.
 */
function hasMore(reason: 'notes' | 'storage', was: Plan, now: Plan): boolean {
  if (!canGo(reason, now)) return false;
  if (reason === 'storage') return now.storage.limitBytes > was.storage.limitBytes || now.storage.usedBytes < was.storage.usedBytes || (was.over.storage && !now.over.storage);
  return now.kind !== was.kind || now.notes.minutesPerPeriod > was.notes.minutesPerPeriod || now.period.from !== was.period.from || now.notes.minutesLeft > was.notes.minutesLeft;
}

/** A purchase since notes stopped: Pro or more notes, bought from the balance or by a payment that bought it. */
const boughtSince = (p: Plan, at: string): boolean => p.balance.history.some((e) => e.microUsd < 0 && Date.parse(e.at) >= Date.parse(at));
/** Turning notes on failed for a reason that may pass (the connection, the server busy): tried again after these waits. */
const RETRY_MS = [2000, 5000, 10_000, 20_000, 40_000] as const;
const passing = (e: unknown): boolean => { const c = errorCode(e); return c === 'network' || c === 'unavailable' || c === 'unknown'; };

/** Notes on again for a stopped call, as its organizer has it: whether to offer it, and doing it. */
export interface PlanRestart {
  /** True while notes coming on is this, so the call's own notice about it isn't said as well. */
  hushing: () => boolean;
  /** The plan has notes again without anything bought since the stop (a new period, more given): the organizer chooses. */
  ready: boolean;
  /** Turns notes on now, for the organizer who chose to. */
  turnOn: () => void;
  /** Notes are on their way back on. */
  turning: boolean;
}

/**
 * For whoever organizes: the server doesn't turn a stopped call's notes on again by itself. When the organizer bought more
 * since they stopped (Pro, or more notes, in checkout over the call or paid from anywhere), their browser turns them on the
 * moment the plan has it, and a toast says so: "You're on Pro. Notes are on again." when Pro is what came, else "Notes are
 * on again.". When the plan has notes again without anything bought (a new period, more given), nothing turns on by
 * itself: the organizer is offered Turn notes on (`ready`). While a stop is in force the plan is read every 10 s, so a
 * payment that lands anywhere is heard within seconds. Turning notes on that fails for a reason that may pass is tried
 * again, waiting longer each time; refused (the plan wasn't enough after all), it's tried again only once the plan changes.
 */
export function usePlanRestart(state: CallState, session: Pick<CallSession, 'setNotes'>): PlanRestart {
  const toast = useToast();
  const s = stopOf(state);
  const host = state.isOrganizer && state.phase === 'in-call';
  const read = useQuery({ ...q.plan(), enabled: host && s !== null, refetchInterval: STOPPED_READ_MS });
  const plan = read.data;
  const readAt = read.dataUpdatedAt;
  /* The plan when turning notes on was last refused, so the same plan isn't tried again; then whether they're on their way back. */
  const refused = useRef<{ at: string; plan: Plan } | null>(null);
  const turning = useRef<{ pro: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const stoppedAt = s?.at ?? null;
  const reason = s?.reason ?? null;
  const wasKind = useRef<Plan['kind'] | null>(null);
  if (stoppedAt && plan && readAt < Date.parse(stoppedAt)) wasKind.current = plan.kind;

  const turnOn = useCallback((pro: boolean, tries = 0) => {
    if (!stoppedAt || !reason || !plan) return;
    turning.current = { pro };
    setBusy(true);
    slog.info('turning notes on again', { reason, kind: plan.kind, tries });
    session.setNotes(true).catch((e: unknown) => {
      const wait = RETRY_MS[tries];
      if (passing(e) && wait !== undefined) {
        slog.info('notes didn’t come on again; trying again', { err: e, reason, tries });
        window.setTimeout(() => { if (turning.current) turnOn(pro, tries + 1); }, wait);
        return;
      }
      slog.info('notes didn’t come on again; the next change to the plan tries again', { err: e, reason });
      turning.current = null;
      refused.current = { at: stoppedAt, plan };
      setBusy(false);
    });
  }, [stoppedAt, reason, plan, session]);

  useEffect(() => {
    if (!host || !stoppedAt || !reason || !plan || turning.current) return;
    // Only a plan read since notes stopped says what they can do now; one read before is a moment from being read again.
    if (readAt < Date.parse(stoppedAt)) return;
    const was = refused.current;
    const fresh = was === null || was.at !== stoppedAt || hasMore(reason, was.plan, plan);
    if (!fresh || !canGo(reason, plan)) { setReady(false); return; }
    if (!boughtSince(plan, stoppedAt)) { setReady(true); return; }
    setReady(false);
    turnOn(wasKind.current === 'free' && plan.kind === 'pro');
  }, [host, stoppedAt, reason, plan, readAt, turnOn]);

  /* Notes are on again: said once, as what came. */
  const on = notesAreOn(state.capture.mode);
  useEffect(() => {
    const t = turning.current;
    if (!t || !on || stoppedAt) return;
    turning.current = null;
    refused.current = null;
    setBusy(false);
    setReady(false);
    toast(t.pro ? 'You’re on Pro. Notes are on again.' : 'Notes are on again.', { icon: 'check', ms: 5200, topic: 'notes-back' });
  }, [on, stoppedAt, toast]);
  return { hushing: () => turning.current !== null, ready: host && ready && stoppedAt !== null, turnOn: () => turnOn(false), turning: busy };
}

/**
 * What's said while the plan has notes again but nobody bought more since they stopped: the organizer is asked, with Turn
 * notes on, and nothing turns on by itself. Otherwise the stop as it is.
 */
export function withRestart(stop: PlanStop | null, r: PlanRestart): PlanStop | null {
  if (!stop || !r.ready) return stop;
  return {
    ...stop,
    title: stop.reason === 'storage' ? 'You have room for notes again' : 'Your plan has notes again',
    line: 'Notes stay off until you turn them on. The call carries on either way.',
    ways: [{ kind: 'on', go: r.turnOn, busy: r.turning }]
  };
}
