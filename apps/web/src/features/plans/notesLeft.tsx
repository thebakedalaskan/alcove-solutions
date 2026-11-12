/*
 * Two of the doors into checkout (docs/superpowers/specs/2026-11-12-plans-frontend-design.md › The doors), both about the
 * period's notes running low: an hour left, said once a period as a toast (3), and none left where a call with notes is
 * started or scheduled (5). Only whoever pays meets them: what's left is your own plan's, and a call's notes are on its
 * organizer's, who is whoever starts or schedules it. Every number is the server's (GET /v1/plan, /v1/plan/offers).
 */
import type { Plan } from '@alcove/api';
import { Button, NoNotesLeft, buttonClass, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { log } from '~/lib/log';
import { q } from '~/lib/queries';
import { dayFullMonth } from '~/lib/time';
import { useCheckout, type CheckoutFor } from './checkout';
import { notesLow, notesOut } from './plan-state';
import { tellOnce } from './hourLeft';
import { hoursLabel } from './words';

const plog = log.child({ component: 'plan-doors' });

/**
 * Whether a call that starts at `at` (now, when it's left out) starts with none of your notes left, and until when there are
 * none: the period's end, when they come back. A call after that has notes again. Undefined until the plan has been read.
 */
export function useNotesLeft(at?: Date | undefined): { none: boolean; until: Date | null; plan: Plan | undefined } {
  const plan = useQuery(q.plan()).data;
  if (!plan || !notesOut(plan)) return { none: false, until: null, plan };
  const until = new Date(plan.period.to);
  return { none: (at ?? new Date()).getTime() < until.getTime(), until, plan };
}

/** The way to more notes, as a button says it and checkout opens on it. */
export interface MoreNotes { label: string; what: CheckoutFor }
/**
 * What helps when your notes run out: Pro on Free, more hours for this period on a paid plan when they're offered, or null
 * when there's nothing to buy. Undefined while that isn't known yet: the plan, or a paid plan's offers, on their way.
 */
export function useMoreNotes(plan: Plan | undefined, wanted: boolean): MoreNotes | null | undefined {
  const paid = plan !== undefined && plan.kind !== 'free';
  const offers = useQuery({ ...q.offers(), enabled: wanted && paid });
  if (!plan) return undefined;
  if (plan.kind === 'free') return { label: 'Get Pro', what: { plan: 'pro' } };
  if (offers.isPending) return undefined;
  const hours = offers.data?.hours;
  return hours ? { label: hoursLabel(hours), what: { plan: 'hours' } } : null;
}

/**
 * None left (door 5): said where a call with notes on is started or scheduled, once this period's are used and before they
 * come back: until when, in caution, with Get Pro (or more hours on a paid plan) and, where it's given, a way on without
 * notes. The server starts such a call without notes anyway, and says why in it.
 *
 * - `at`: when the call starts (now when left out). A call after the period renews has notes, so nothing is said.
 * - `alone`: nothing beside it says it's about notes (Start now), so it names them.
 * - `newTab`: checkout can't open where this is, inside a window it would stack over: Get Pro opens Plans in a new tab with
 *   checkout on Pro, and what was chosen here stays.
 * - `beforeCheckout`: what to do before checkout opens over the page, such as closing the window this is in.
 * - `without`: the way on without notes, such as Start without notes.
 */
export function NoNotesLeftDoor({ at, alone = false, newTab = false, beforeCheckout, without, className }: {
  at?: Date | undefined; alone?: boolean | undefined; newTab?: boolean | undefined; beforeCheckout?: (() => void) | undefined;
  without?: { label: string; onClick: () => void } | undefined; className?: string | undefined;
}) {
  const left = useNotesLeft(at);
  const more = useMoreNotes(left.plan, left.none);
  const checkout = useCheckout();
  if (!left.none || !left.until) return null;
  // In a new tab, Plans opens with checkout on Pro; more hours are bought from Settings › Plan.
  const away = more?.what.plan === 'pro' ? '/plans?checkout=pro' : '/settings#plan';
  return (
    <NoNotesLeft until={dayFullMonth(left.until)} alone={alone} className={className}>
      {more && (newTab
        ? <a className={buttonClass({ variant: 'secondary', size: 'sm' })} href={away} target="_blank" rel="noopener noreferrer">{more.label}</a>
        : <Button size="sm" variant="secondary" onClick={() => { beforeCheckout?.(); checkout.open(more.what, 'door'); }}>{more.label}</Button>)}
      {without && <Button size="sm" variant="quiet" onClick={without.onClick}>{without.label}</Button>}
    </NoNotesLeft>
  );
}


/**
 * An hour left (door 3): once a period, when the notes left this period drop under an hour, a toast says so with the way to
 * more (Get Pro on Free, more hours on a paid plan). The side panel's number turns warm by itself. Mounted with the frame
 * round every page, so never in a call; the plan is read again every minute, so it comes as a call's notes use it up.
 */
export function HourLeft({ ownerId }: { ownerId: string }) {
  const plan = useQuery(q.plan()).data;
  const low = plan !== undefined && notesLow(plan);
  const more = useMoreNotes(plan, low);
  const toast = useToast();
  const checkout = useCheckout();
  // What the toast offers is fixed when it's said: the way to more as it is then.
  const offer = useRef<(() => void) | null>(null);
  offer.current = more ? () => checkout.open(more.what, 'door') : null;
  // A paid plan waits for the offers, to say what more hours cost, or that there's nothing to buy.
  const ready = low && more !== undefined;
  const label = more?.label ?? null;
  const periodTo = plan?.period.to;
  const kind = plan?.kind;
  useEffect(() => {
    if (!ready || !periodTo || !tellOnce(ownerId, periodTo)) return;
    plog.info('told an hour of notes is left', { kind: kind ?? 'free' });
    toast('Less than an hour of notes left this period', {
      icon: 'clock', ms: 12_000, topic: 'hour-left',
      ...(label ? { action: { label, onClick: () => offer.current?.() } } : {})
    });
  }, [ready, periodTo, ownerId, kind, label, toast]);
  return null;
}
