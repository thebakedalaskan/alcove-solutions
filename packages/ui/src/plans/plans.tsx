/*
 * Plans: the last of the sunset, with the plans on the water under it (docs/design/pages.md › Plans).
 * The plans are light cards side by side whose parts share rows (PlanCards, PlanCard), so the names, prices, buttons and every
 * fact line up across them and they compare row by row. Pro is lifted a little, never lit up: a raised card with a warm edge.
 * Over them on the sky, Monthly or Yearly (PlanCycle), and behind it the last sliver of the sun (PlanSunset, which Plans draws
 * on the evening, since its moment has no sun of its own). Under them, what every plan has (EveryPlan) and how paying works
 * (PayingLine). Everything here is stateless, taking plain data and handlers. plans/plans.css (`pl-`).
 */
import { Children, useId, type ReactNode } from 'react';
import { cn } from '../foundation/cn';
import { Icon, type IconName } from '../foundation/icon';
import { Chip } from '../foundation/primitives';

/** Whether there's something to show: not nothing, false or an empty string. */
const has = (x: ReactNode): boolean => x !== undefined && x !== null && x !== false && x !== '';

/* ---------- the plans, side by side ---------- */

/** What a plan brings, one line each: its icon, what it is, and a smaller line under it when it needs one. */
export interface PlanFact { icon: IconName; text: ReactNode; sub?: ReactNode | undefined }

/**
 * The plans side by side, as many columns as there are cards, each a third of the page's width at most; their parts share
 * rows, so every row lines up across them. On a phone, and for three or more on a narrow window, they stand one under
 * another.
 */
export function PlanCards({ children, className }: { children: ReactNode; className?: string | undefined }) {
  const n = Math.max(1, Children.toArray(children).length);
  return <div className={cn('pl-cards', n > 2 && 'is-many', className)} style={{ '--n': n }}>{children}</div>;
}

/** Which plan a card is: Pro and Team are bought, Free is where everyone starts. */
export type PlanCardKind = 'free' | 'pro' | 'team';

interface PlanCardBase {
  kind: PlanCardKind;
  /** The plan's name: Free, Pro, Team. */
  name: string;
  /** Who it's for, under the name. */
  sub: ReactNode;
  /** At the end of the name's row: the people a Team plan is for, as small arches. */
  people?: ReactNode;
  /** Raised a little, with a warm edge along its top: Pro, whichever plan you're on. */
  lifted?: boolean | undefined;
  className?: string | undefined;
}

/** A plan with everything it says. */
export interface PlanCardShown extends PlanCardBase {
  waiting?: false | undefined;
  /** "$20", in the page's display face. */
  price: string;
  /** After the price: "a month", "a person a month". */
  per?: string | undefined;
  /** What it bills: "$192 for 12 months.", "Nothing to pay." */
  bill: ReactNode;
  /** After the bill, warm: "You save $48." */
  save?: ReactNode;
  /** Beside the name, warm: "Your plan" on the plan you're on (never Free's, whose button says it), "Ends in 6 days". */
  chip?: ReactNode;
  /** A button the width of the card, or PlanHere. */
  action: ReactNode;
  facts: readonly PlanFact[];
  /** A last line under the facts, quiet. */
  more?: ReactNode;
}

/** A plan whose prices are on their way: its name and who it's for, and quiet bars where the rest will be. */
export interface PlanCardWaiting extends PlanCardBase {
  waiting: true;
  /** How many facts will come, so nothing moves when they do. */
  facts?: number | undefined;
  /** What can be done before the prices come, in the button's place (the plan choice's way on). Otherwise a bar waits there. */
  action?: ReactNode;
}

export type PlanCardProps = PlanCardShown | PlanCardWaiting;

/** One plan: its name, who it's for, its price and what that bills, the one thing to do, and what it brings. */
export function PlanCard(props: PlanCardProps) {
  const h = useId();
  const { kind, name, sub, people, lifted = false, className } = props;
  const head = (chip?: ReactNode) => (
    <div className="pl-hn">
      <h2 id={h}>{name}</h2>
      {has(chip) && <Chip tone="sun" className="pl-chip">{chip}</Chip>}
      {has(people) && <span className="pl-who">{people}</span>}
    </div>
  );
  if (props.waiting) {
    const n = props.facts ?? 3;
    return (
      <article className={cn('pl-card', `is-${kind}`, lifted && 'is-lifted', 'is-waiting', className)} aria-labelledby={h} aria-busy="true">
        {head()}
        <p className="pl-sub">{sub}</p>
        <p className="pl-price" aria-hidden="true"><i className="pl-wait is-price" /></p>
        <p className="pl-bill" aria-hidden="true"><i className="pl-wait is-bill" /></p>
        {has(props.action)
          ? <div className="pl-act">{props.action}</div>
          : <div className="pl-act" aria-hidden="true"><i className="pl-wait is-act" /></div>}
        <ul className="pl-facts" aria-hidden="true" style={{ '--facts': n }}>
          {Array.from({ length: n }, (_, i) => <li key={i} className="pl-fact"><i className="pl-wait is-icon" /><i className="pl-wait is-line" /></li>)}
        </ul>
      </article>
    );
  }
  const { price, per, bill, save, chip, action, facts, more } = props;
  return (
    <article className={cn('pl-card', `is-${kind}`, lifted && 'is-lifted', className)} aria-labelledby={h}>
      {head(chip)}
      <p className="pl-sub">{sub}</p>
      <p className="pl-price"><b>{price}</b>{per !== undefined && <span className="per">{per}</span>}</p>
      <p className="pl-bill">{bill}{has(save) && <> <span className="save">{save}</span></>}</p>
      <div className="pl-act">{action}</div>
      <ul className="pl-facts" style={{ '--facts': facts.length }}>
        {facts.map((f, i) => (
          <li key={i} className="pl-fact">
            <Icon name={f.icon} size={17} />
            <span><b>{f.text}</b>{has(f.sub) && <small>{f.sub}</small>}</span>
          </li>
        ))}
      </ul>
      {has(more) && <p className="pl-more">{more}</p>}
    </article>
  );
}

/**
 * Where a plan's button would be, on the plan you're on: "Your plan" with a tick, in an outline, and nothing to press.
 * `quiet`, a line of its own with no outline: Free's, while you're on another plan.
 */
export function PlanHere({ quiet = false, children = 'Your plan' }: { quiet?: boolean | undefined; children?: ReactNode }) {
  return <p className={cn('pl-here', quiet && 'is-quiet')}>{!quiet && <Icon name="check" size={17} />}{children}</p>;
}

/* ---------- the sky ---------- */

/** What the prices are for: a month at a time, or a year or more. */
export type PlanCycleChoice = 'month' | 'year';

/**
 * Monthly or Yearly, on the sky over the plans: each plan then shows one price. `off` says what a year or more saves,
 * beside Yearly ("20% off").
 */
export function PlanCycle({ value, onChange, off, month = 'Monthly', year = 'Yearly', label = 'Prices for', className }: {
  value: PlanCycleChoice;
  onChange: (v: PlanCycleChoice) => void;
  off?: ReactNode;
  month?: ReactNode;
  year?: ReactNode;
  label?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn('pl-cycle', className)} role="group" aria-label={label}>
      <button type="button" aria-pressed={value === 'month'} onClick={() => onChange('month')}>{month}</button>
      <button type="button" aria-pressed={value === 'year'} onClick={() => onChange('year')}>
        {year}{has(off) && <><span className="sr-only">, </span><span className="off">{off}</span></>}
      </button>
    </div>
  );
}

/**
 * The last sliver of the sun on the horizon, and its long glow over the sky. Plans puts it on the evening behind everything
 * that passes through (`Evening`'s `sky`), at the middle of the horizon (--hz), since its moment has no sun of its own. Its sun
 * is marked `data-sun` (its box as wide as the sun, its top the sun's), so signing in from the welcome page can sail onto it.
 */
export function PlanSunset({ className }: { className?: string | undefined }) {
  return <div className={cn('pl-sunset', className)} aria-hidden="true"><i className="pl-sunset-glow" /><i className="pl-sunset-sun" data-sun="" /></div>;
}

/* ---------- under the plans ---------- */

/** What every plan has, under its heading, in one row of chips: plans only change how much you get. */
export function EveryPlan({ title = 'On every plan', items, className }: { title?: ReactNode; items: readonly { icon: IconName; text: ReactNode }[]; className?: string | undefined }) {
  const h = useId();
  return (
    <div className={cn('pl-every-all', className)}>
      <h2 id={h} className="pl-every-h">{title}</h2>
      <ul className="pl-every" aria-labelledby={h}>
        {items.map((x, i) => <li key={i}><Chip icon={x.icon}>{x.text}</Chip></li>)}
      </ul>
    </div>
  );
}

/** How paying works, in a line under everything, with the wallet it's paid from. */
export function PayingLine({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <p className={cn('pl-paying', className)}><Icon name="wallet" size={18} /><span>{children}</span></p>;
}
