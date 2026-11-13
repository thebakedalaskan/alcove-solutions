/*
 * The plan choice (docs/design/pages.md › Plans; docs/product/user-flows.md 16.20): Plans, opened by itself once in Home's
 * place, for every new account and, once, for every account from before plans. Where and when it shows is choice.ts's.
 * Its head says what it's for in the page's own type, a title and one line: to someone with no notes yet, how the plans
 * differ; to someone who has used Alcove, that it has plans now and which one they're on. The plan you're on leads straight
 * on, to Home. Get Pro and Start a team open checkout over it, as Plans does, and once what was bought is yours and checkout
 * has closed, Home follows with no other question. Every number is the server's.
 */
import type { Plan, PlanAllowance, PlanOffers } from '@alcove/api';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useState } from 'react';
import { q } from '~/lib/queries';
import { forgetSailOut } from '~/lib/sailOut';
import { fullDate, longDay } from '~/lib/time';
import { roomLabel } from '~/lib/words';
import { useCheckout } from './checkout';
import { Plans } from './Plans';
import { perPeriod, periodHours } from './words';

/** What the plan choice's head says: a short title, and one line under it. */
export interface ChoiceHead { title: string; line: string }

const DAY = 86_400_000;
/** A number and its unit kept on one line: "10 GB", "5 hours". */
const whole = (s: string): string => s.replaceAll(' ', ' ');

/**
 * Which plan someone who has used Alcove is on now, and what it brings, from the offers (else the plan's own numbers): over
 * Free's storage, until when everything works as before, or that uploads and notes have stopped.
 */
function onNow(plan: Plan, offers: PlanOffers | undefined): string {
  const per = perPeriod(offers?.periodDays ?? Math.round((Date.parse(plan.period.to) - Date.parse(plan.period.from)) / DAY));
  const hours = (a: PlanAllowance | undefined): string => whole(periodHours(a?.notesMinutes ?? plan.notes.minutesPerPeriod));
  const brings = (a: PlanAllowance | undefined): string =>
    `about ${hours(a)} of notes ${per} and ${whole(roomLabel(a?.storageBytes ?? plan.storage.limitBytes))} of storage`;
  if (plan.kind === 'team') {
    const on = plan.team ? `Team with ${plan.team.name}` : 'Team';
    return `You’re on ${on}: about ${hours(offers?.team)} of notes ${per}.`;
  }
  if (plan.kind === 'pro') return `You’re on Pro${plan.pro.until ? ` until ${fullDate(new Date(plan.pro.until))}` : ''}: ${brings(offers?.pro)}.`;
  const limit = whole(roomLabel(plan.storage.limitBytes));
  if (plan.grace?.storage) return `You’re on Free, and over its ${limit} of storage: everything works as before until ${longDay(new Date(plan.grace.until))}.`;
  if (plan.over.storage) return `You’re on Free, and over its ${limit} of storage, so uploads and notes have stopped until you get Pro or make room.`;
  return `You’re on Free: ${brings(offers?.free)}.`;
}

/**
 * What the head says. Someone with no notes yet (a new account, or one that has never had any) is asked to choose, and told how
 * the plans differ; someone who has used Alcove is told it has plans now, and which they're on.
 */
export function headOf(plan: Plan | undefined, offers: PlanOffers | undefined, fresh: boolean): ChoiceHead {
  if (fresh || !plan) {
    return { title: 'Choose a plan', line: 'Every plan has calls, workspaces and confidential compute. They differ in hours of notes and storage.' };
  }
  return { title: 'Alcove has plans now', line: onNow(plan, offers) };
}

/** Whether something bought since `was` is yours now: a plan you weren't on, or Pro running later than it did. */
function boughtSince(was: { kind: Plan['kind']; until: string | null }, now: Plan): boolean {
  if (now.kind !== 'free' && now.kind !== was.kind) return true;
  return now.pro.until !== null && (was.until === null || Date.parse(now.pro.until) > Date.parse(was.until));
}

/** `onLeave`: past the plans, to Home: on with the plan you're on, or once something bought from them is yours. */
export function PlanChoice({ onLeave }: { onLeave: () => void }) {
  const plan = useQuery(q.plan()).data;
  const offers = useQuery(q.offers()).data;
  const notes = useQuery(q.notes()).data;
  const { current } = useCheckout();
  /* The plans take Home's place as it opens, and its sail out of the welcome page's cove with it: Home doesn't sail out later. */
  useLayoutEffect(() => { forgetSailOut(); }, []);
  /* Who it's for as it opens: a note written meanwhile doesn't change the head under the reader. */
  const [fresh] = useState(() => (notes ?? []).length === 0);
  /* What they're on as it opens, and whether checkout has opened over it since. */
  const [was] = useState(() => ({ kind: plan?.kind ?? 'free', until: plan?.pro.until ?? null }));
  const open = current !== null;
  const [openedCheckout, setOpenedCheckout] = useState(false);
  if (open && !openedCheckout) setOpenedCheckout(true);
  /* Bought there, and checkout closed (Done, or closed once it was bought): Home, with nothing more to decide. */
  const bought = openedCheckout && plan !== undefined && boughtSince(was, plan);
  useEffect(() => { if (bought && !open) onLeave(); }, [bought, open, onLeave]);
  const head = headOf(plan, offers, fresh);
  return <Plans first={{ ...head, onContinue: onLeave }} />;
}
