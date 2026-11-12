/*
 * When the organizer's plan stops a call's notes (docs: Plans and usage › Running out in a call; the plans spec's doors, 4).
 * What's said about it is the same in the banner over the call, at the top of Notes and in what's captured. Whoever organizes
 * has the ways to more (Get Pro, more hours for this period, room), each opening checkout over the call, and once their plan
 * has more, notes come on again by themselves and say so. Everyone else is told whose notes ran out, with nothing to buy: a
 * call's notes are on its organizer's plan. Where notes stopped and came on again is marked in the notes.
 */
import { CallStopsSeenSchema, notesAreOn, type CallSession, type CallState, type Plan } from '@alcove/api';
import { Button, Icon, buttonClass, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useCheckout } from '~/features/plans/checkout';
import { hoursLabel, hoursOfNotes } from '~/features/plans/words';
import { log } from '~/lib/log';
import { q } from '~/lib/queries';
import { dayFullMonth, hm } from '~/lib/time';
import { capital } from '~/lib/words';
import { organizerName } from './Capture';

const slog = log.child({ component: 'plan-stop' });

/** A way to more, for whoever organizes: Pro, more hours for this period, or room in their storage. */
export type StopWay = { kind: 'pro' } | { kind: 'hours'; label: string } | { kind: 'room' };

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

/** The marks in the notes: "Notes stopped · 16:44" in caution, and "Notes on again · 16:47" in the notes' own colour. */
export function StopMarks({ marks }: { marks: readonly StopMark[] }) {
  if (!marks.length) return null;
  return (
    <div className="nn-cuts">
      {marks.map((m) => (
        <div key={m.at}>
          <p className="nn-cut">Notes stopped · {hm(m.at)}</p>
          {m.back && <p className="nn-cut is-on">Notes on again · {hm(m.back)}</p>}
        </div>
      ))}
    </div>
  );
}

/* ---------- notes on again, the moment the organizer's plan has more ---------- */

/** What in the organizer's plan can lift a stop: its kind, this period's notes and when it began, and its storage. */
const roomOf = (p: Plan) => ({ kind: p.kind, minutes: p.notes.minutesPerPeriod, from: p.period.from, storage: p.storage.limitBytes, left: p.notes.minutesLeft });

/**
 * Whether the organizer's plan has more than it had when notes stopped: Pro or Team bought, more hours this period, a new
 * period, or more room. Only a plan that has changed is tried, so a plan that showed a minute or two left as notes stopped
 * isn't tried again and again.
 */
function hasMore(reason: 'notes' | 'storage', was: Plan, now: Plan): boolean {
  if (reason === 'storage') return now.storage.limitBytes > was.storage.limitBytes || now.storage.usedBytes < was.storage.usedBytes || (was.over.storage && !now.over.storage);
  const a = roomOf(was), b = roomOf(now);
  return !now.notes.stopped && b.left > 0 && (b.kind !== a.kind || b.minutes > a.minutes || b.from !== a.from || b.left > a.left);
}

/**
 * For whoever organizes: notes come on again by themselves the moment their plan has more (bought in checkout over the call,
 * paid from another device, or a new period), and a toast says so: "You're on Pro. Notes are on again." when Pro is what came,
 * else "Notes are on again.". While a stop is in force the plan is read every few seconds, so a payment that lands anywhere
 * is heard soon. Turning them on goes as the organizer's own would; refused (the plan wasn't enough after all), nothing is
 * said and the next change tries again. `hushing()` is true while notes coming on is this, so the call's own notice about it
 * isn't said as well.
 */
export function usePlanRestart(state: CallState, session: Pick<CallSession, 'setNotes'>): { hushing: () => boolean } {
  const toast = useToast();
  const s = stopOf(state);
  const host = state.isOrganizer && state.phase === 'in-call';
  const plan = useQuery({ ...q.plan(), enabled: host && s !== null, refetchInterval: STOPPED_READ_MS }).data;
  /* The plan as it was when notes stopped, to tell more from what was already there; then whether notes are on their way back. */
  const before = useRef<{ at: string; plan: Plan } | null>(null);
  const turning = useRef<{ pro: boolean } | null>(null);
  const stoppedAt = s?.at ?? null;
  const reason = s?.reason ?? null;
  useEffect(() => {
    if (!host || !stoppedAt || !reason || !plan) return;
    const was = before.current;
    if (!was || was.at !== stoppedAt) { before.current = { at: stoppedAt, plan }; return; }
    if (turning.current || !hasMore(reason, was.plan, plan)) return;
    turning.current = { pro: was.plan.kind === 'free' && plan.kind === 'pro' };
    slog.info('the organizer’s plan has more: turning notes on again', { reason, kind: plan.kind });
    session.setNotes(true).catch((e: unknown) => {
      slog.warn('notes didn’t come on again; the next change to the plan tries again', { err: e, reason });
      turning.current = null;
      before.current = { at: stoppedAt, plan };
    });
  }, [host, stoppedAt, reason, plan, session]);
  /* Notes are on again: said once, as what came. */
  const on = notesAreOn(state.capture.mode);
  useEffect(() => {
    const t = turning.current;
    if (!t || !on || stoppedAt) return;
    turning.current = null;
    before.current = null;
    toast(t.pro ? 'You’re on Pro. Notes are on again.' : 'Notes are on again.', { icon: 'check', ms: 5200, topic: 'notes-back' });
  }, [on, stoppedAt, toast]);
  return { hushing: () => turning.current !== null };
}
