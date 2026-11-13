/*
 * Checkout: one window over wherever you were, with what you're buying beside every step (the canvas's Checkout and
 * PayMotion boards, docs/design/canvas/plans/). The step is on the left: choose how long, how many hours or how many of
 * Team's licenses (a team being started is named first, and one buying more says who's waiting), and the network to send
 * USDC on; pay, with the exact amount, the address made for this one payment and how it stands; then done. What you're
 * buying is on the right, under a small evening of its own whose sun rises as the payment lands. On a phone the window
 * fills the screen, with what you're buying as one line at the top.
 *
 * Every part is stateless: plain data in and handlers out, the words as the app puts them. Only a copy button keeps
 * "Copied" for a moment, and the amount that arrived counts up while you watch.
 */
import { useReducedMotion } from 'motion/react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { CryptoMark, Logo } from './brand';
import { Icon, type IconName } from './icon';
import { CheckDraw, CountUp, Dots } from './motion';
import { Modal, ThemeScope } from './overlay';
import { Faces, type AvatarPerson } from './people';
import { Button, CopyField, IconButton, buttonClass } from './primitives';
import { QrCode } from './qr';

/** Which small evening a purchase is drawn as: Pro's sunset, Team's with its people, more notes' last light. */
export type PlanArt = 'pro' | 'team' | 'hours';
/** Where a payment is, as the sun says it: still, on the horizon while it's awaited, lifting as it's seen, clear once it's done. */
export type SunRise = 'rest' | 'waiting' | 'seen' | 'done';
/**
 * Where checkout is: choosing; waiting for the payment (`send`), or for the rest of it (`short`); the payment seen and
 * being added (`seen`); bought (`done`); or a payment that won't go on (`closed`: expired, cancelled, failed).
 */
export type CheckoutStage = 'choose' | 'send' | 'short' | 'seen' | 'done' | 'closed';

const RISE: Record<CheckoutStage, SunRise> = { choose: 'rest', send: 'waiting', short: 'waiting', seen: 'seen', done: 'done', closed: 'rest' };
const monthsWord = (n: number) => `${n} ${n === 1 ? 'month' : 'months'}`;
const licensesWord = (n: number) => `${n} ${n === 1 ? 'license' : 'licenses'}`;

/** A value to copy, and "Copied" for a moment once it has been. */
function useCopy(value: string): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  return [copied, () => { void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined); }];
}

/* ---------- the art ---------- */

/**
 * A plan's small arched window: a moment of the evening, flat shapes in one colour each. `rise` moves its sun as a payment
 * lands (on the horizon, lifting, clear of it with the sky warming). `sm` is the phone's one line. `people` stand on
 * Team's horizon.
 */
export function PlanWindow({ art, rise = 'rest', size = 'md', people, className }: {
  art: PlanArt; rise?: SunRise | undefined; size?: 'md' | 'sm' | undefined; people?: ReactNode; className?: string | undefined;
}) {
  const big = size === 'md';
  return (
    <span aria-hidden="true" data-rise={rise} className={cn('ck-win', `is-${art}`, !big && 'is-sm', className)}>
      <i className="sky" /><i className="dawn" /><i className="glow" /><i className="sun" /><i className="sea" /><i className="rim" />
      {big && <><i className="g g1" /><i className="g g2" /><i className="g g3" /></>}
      {big && art === 'hours' && <><i className="st s1" /><i className="st s2" /><i className="st s3" /></>}
      {big && art === 'team' && people && <span className="ck-folk">{people}</span>}
    </span>
  );
}

/* ---------- the head ---------- */

const STEPS = ['Choose', 'Pay', 'Done'] as const;
/** Choose, Pay, Done: the numbered pills at the window's head, the one you're at filled. On a phone, the numbers alone. */
export function CheckoutSteps({ at, className }: { at: 1 | 2 | 3; className?: string | undefined }) {
  return (
    <ol className={cn('ck-steps', className)} aria-label="Steps">
      {STEPS.map((t, i) => {
        const n = i + 1;
        return (
          <li key={t} className={n === at ? 'is-on' : n < at ? 'is-past' : undefined} aria-current={n === at ? 'step' : undefined}>
            <span className="n">{n}</span><span className="t">{t}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- choosing ---------- */

/** One choice as a card: its name, what it costs, and what that comes to. */
interface Card { id: string; name: string; price: string; sub: string; tag?: string | null | undefined }

/**
 * Cards to pick one of, as radio buttons: arrow keys move between them. `bracket` spans the cards from `from` on, over
 * them. `autoFocus` puts focus on the one chosen as they appear, for a window whose first thing is this choice.
 */
function Cards({ label, hint, cards, value, onChange, bracket, autoFocus = false, className }: {
  label: string; hint?: string | undefined; cards: Card[]; value: string | null; onChange: (id: string) => void;
  bracket?: { from: number; label: string } | null | undefined; autoFocus?: boolean | undefined; className?: string | undefined;
}) {
  const q = useId();
  const name = useId();
  return (
    <>
      <p className="ck-q"><span id={q}>{label}</span>{hint && <small>{hint}</small>}</p>
      <div role="radiogroup" aria-labelledby={q} className={cn('ck-cards', className)} style={{ '--n': cards.length }}>
        {bracket && (
          <>
            {bracket.from > 0 && <span className="ck-brk-sp" aria-hidden="true" style={{ gridColumn: `1 / span ${bracket.from}` }} />}
            <span className="ck-brk" aria-hidden="true" style={{ gridColumn: `${bracket.from + 1} / -1` }}>{bracket.label}</span>
          </>
        )}
        {cards.map((c) => (
          <label key={c.id} className="ck-card">
            <input type="radio" className="ck-radio" name={name} value={c.id} checked={value === c.id} autoFocus={autoFocus && value === c.id} onChange={() => onChange(c.id)} />
            {c.tag && <span className="tag"><span className="ck-off">{c.tag}</span></span>}
            <span className="n">{c.name}</span>
            <span className="p">{c.price}</span>
            <span className="m">{c.sub}</span>
          </label>
        ))}
      </div>
    </>
  );
}

/** Another amount than the cards offer: open, from 1 to `max`, with what the amount stepped to costs. */
interface OtherAmount { open: boolean; max: number; price: string; onOpen: () => void; onStep: (n: number) => void }

/**
 * Under the cards: a link (`link`, with the range it reaches) that opens a stepper from 1 to `other.max`, saying the amount
 * stepped to (`word`) and what it costs.
 */
function Another({ other, value, link, range, word, group, fewer, more }: {
  other: OtherAmount; value: number; link: string; range: string; word: (n: number) => string; group: string; fewer: string; more: string;
}) {
  return (
    <div className="ck-other">
      {other.open ? (
        <>
          <span className="ck-stepper" role="group" aria-label={group}>
            <button type="button" aria-label={fewer} disabled={value <= 1} onClick={() => other.onStep(Math.max(1, value - 1))}><Icon name="minus" size={16} /></button>
            <output aria-live="polite">{word(value)}</output>
            <button type="button" aria-label={more} disabled={value >= other.max} onClick={() => other.onStep(Math.min(other.max, value + 1))}><Icon name="plus" size={16} /></button>
          </span>
          <span>{other.price}</span>
        </>
      ) : (
        <>
          <button type="button" className="ck-lnk" onClick={other.onOpen}>{link}</button>
          <span>{range}</span>
        </>
      )}
    </div>
  );
}

/** One length of Pro: "12 months", "$192", "$16 a month", and whether it's at the lower price. */
export interface MonthsOption { months: number; total: string; each: string; off: boolean }

/**
 * How long: a card for each length, each with its total and what that is a month, and a bracket over the lengths at the
 * lower price (`offLabel`, "20% off"; on a phone it's on each of those cards). Another length opens a stepper from 1 to
 * `other.max`, with what it costs, which steps with `other.onStep`; while it's open, no card is ticked, and picking a
 * card (`onChange`) is the way back to them.
 */
export function MonthsPicker({ label = 'How long', options, value, onChange, offLabel, other, autoFocus }: {
  label?: string | undefined; options: MonthsOption[]; value: number; onChange: (months: number) => void;
  offLabel: string | null;
  other: OtherAmount;
  /** Focus on the length chosen as it appears. */
  autoFocus?: boolean | undefined;
}) {
  const from = options.findIndex((o) => o.off);
  const cards = options.map((o): Card => ({ id: String(o.months), name: monthsWord(o.months), price: o.total, sub: o.each, tag: o.off ? offLabel : null }));
  return (
    <div className="ck-sec">
      <Cards label={label} cards={cards} value={other.open ? null : String(value)} onChange={(id) => onChange(Number(id))} autoFocus={autoFocus}
        bracket={offLabel && from >= 0 ? { from, label: offLabel } : null} />
      <Another other={other} value={value} link="Another length" range={`Any number of months from 1 to ${other.max}.`} word={monthsWord}
        group="Months" fewer="One month fewer" more="One more month" />
    </div>
  );
}

/** A number of Team's licenses: "6 licenses", "$240", and what that number is for: "For the 6 of you", "Room for 4 more". */
export interface LicensesOption { count: number; total: string; sub: string }

/**
 * How many licenses: a card for each number, each with its total and what it's for, under the price of one (`hint`, "$40
 * each, one person for 30 days"). Another number opens a stepper from 1 to `other.max` (the most one purchase buys), with
 * what it costs; while it's open, no card is ticked, and picking a card is the way back to them.
 */
export function LicensesPicker({ label = 'How many licenses', hint, options, value, onChange, other, autoFocus }: {
  label?: string | undefined; hint?: string | undefined; options: LicensesOption[]; value: number; onChange: (count: number) => void;
  other: OtherAmount;
  /** Focus on the number chosen as it appears. */
  autoFocus?: boolean | undefined;
}) {
  const cards = options.map((o): Card => ({ id: String(o.count), name: licensesWord(o.count), price: o.total, sub: o.sub }));
  return (
    <div className="ck-sec">
      <Cards label={label} hint={hint} cards={cards} value={other.open ? null : String(value)} onChange={(id) => onChange(Number(id))} autoFocus={autoFocus}
        className="is-licenses" />
      <Another other={other} value={value} link="Another number" range={`Any number from 1 to ${other.max}.`} word={licensesWord}
        group="Licenses" fewer="One license fewer" more="One more license" />
    </div>
  );
}

/**
 * The team being started: its name, typed into a box with its label inside, under what starting it makes you. `disabled`
 * once the team is made, when its name is what it is.
 */
export function TeamName({ label = 'Your team', hint = 'You’re its admin: you buy its licenses and invite people.', field = 'Its name', value, onChange, placeholder, disabled = false, autoFocus = false, maxLength = 120 }: {
  label?: string | undefined; hint?: string | undefined; field?: string | undefined; value: string; onChange: (name: string) => void;
  placeholder?: string | undefined; disabled?: boolean | undefined; autoFocus?: boolean | undefined; maxLength?: number | undefined;
}) {
  const q = useId();
  return (
    <div className="ck-sec" role="group" aria-labelledby={q}>
      <p className="ck-q"><span id={q}>{label}</span>{hint && <small>{hint}</small>}</p>
      <label className="ck-field">
        <span className="k">{field}</span>
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} autoFocus={autoFocus}
          maxLength={maxLength} autoComplete="organization" spellCheck={false} />
      </label>
    </div>
  );
}

/**
 * The team licenses are bought for, in a line: its people's arches, how many licenses are left (`title`, "2 of 8 licenses
 * left") and, under it, who's waiting for one or how long each runs.
 */
export function LicensesLeft({ people, title, sub, className }: { people: AvatarPerson[]; title: ReactNode; sub?: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn('ck-sec ck-team', className)}>
      {people.length > 0 && <Faces people={people} size={30} max={5} />}
      <p className="who"><b>{title}</b>{sub && <small>{sub}</small>}</p>
    </div>
  );
}

/** Packs of more notes: "10 hours", "$15", "10 hour-long calls". */
export interface HoursOption { packs: number; hours: string; price: string; sub: string }

/** How many hours: a card for each number of packs, up to the most one purchase buys. `hint` is the price of an hour. */
export function HoursPicker({ label = 'How many hours', hint, options, value, onChange, autoFocus }: {
  label?: string | undefined; hint?: string | undefined; options: HoursOption[]; value: number; onChange: (packs: number) => void;
  /** Focus on the number chosen as it appears. */
  autoFocus?: boolean | undefined;
}) {
  const cards = options.map((o): Card => ({ id: String(o.packs), name: o.hours, price: o.price, sub: o.sub }));
  return <div className="ck-sec"><Cards label={label} hint={hint} cards={cards} value={String(value)} onChange={(id) => onChange(Number(id))} autoFocus={autoFocus} /></div>;
}

/** A network USDC can be sent on: its chain (for its mark), its name, and a note such as "From 20" when its least is more. */
export interface NetworkOption { id: string; chain: string; name: string; note?: string | null | undefined }

/** Pay with USDC on: a tile for each network, with its mark. None is chosen for you. */
export function NetworkPicker({ label = 'Pay with USDC on', hint = 'Any wallet or exchange', options, value, onChange }: {
  label?: string | undefined; hint?: string | undefined; options: NetworkOption[]; value: string | null; onChange: (id: string) => void;
}) {
  const q = useId();
  const name = useId();
  return (
    <div className="ck-sec">
      <p className="ck-q"><span id={q}>{label}</span><small>{hint}</small></p>
      <div role="radiogroup" aria-labelledby={q} className="ck-nets">
        {options.map((n) => (
          <label key={n.id} className="ck-net">
            <input type="radio" className="ck-radio" name={name} value={n.id} checked={value === n.id} onChange={() => onChange(n.id)} />
            <CryptoMark name={n.chain} className="ck-mark" />
            <span className="nm">{n.name}</span>
            {n.note && <small>{n.note}</small>}
          </label>
        ))}
      </div>
    </div>
  );
}

/** A calm sentence in the step: caution for something that needs a look, info for what happens next. */
export function CheckoutNote({ tone = 'caution', icon, children, className }: {
  tone?: 'caution' | 'info' | undefined; icon?: IconName | undefined; children: ReactNode; className?: string | undefined;
}) {
  return (
    <div className={cn('ck-note', tone === 'info' && 'is-info', className)} role={tone === 'caution' ? 'status' : undefined}>
      <Icon name={icon ?? (tone === 'caution' ? 'alert' : 'info')} size={18} />
      <div>{children}</div>
    </div>
  );
}

/* ---------- what you're buying ---------- */

/** A line of the summary: "12 months at $20" and "$240", or the discount ("−$48") in warm text. */
export interface SummaryLine { label: string; value: string; off?: boolean | undefined }

/** What you're buying, beside every step. */
export interface CheckoutSummaryData {
  art: PlanArt;
  /** Who stands on Team's horizon. */
  people?: ReactNode;
  /** "Pro", "10 hours of notes", "Team". */
  name: string;
  /**
   * Who it's for, or what it adds to: "For Art Vandelay", "Added to the 6 days you have left", "For this period", "For
   * Vandelay Industries, with you its admin".
   */
  sub: string;
  /** What the phone's one line says under the name: "12 months · 20% off", "6 licenses". */
  brief: string;
  lines: SummaryLine[];
  /** What's paid: an amount to send ("187.00" "USDC"), or from the balance ("$192"). Null while it isn't known yet. */
  total: { value: string; unit?: string | undefined } | null;
  /** Under the total: what more there is to know about it, such as a network's least. */
  extra?: string | null | undefined;
  /** "Pro until" and the day it runs to, or how long each of Team's licenses runs: "Each runs" "30 days from when it’s taken". */
  until?: { lead: string; day: string } | null | undefined;
  /** At the foot: how the price is reckoned, or where it's paid from. */
  foot: string;
}

/** What you're buying: its small evening, its name and who it's for, the price line by line, the total, and until when. */
export function CheckoutSummary({ summary: s, rise = 'rest', className }: { summary: CheckoutSummaryData; rise?: SunRise | undefined; className?: string | undefined }) {
  return (
    <aside className={cn('ck-sum', className)} aria-label="What you’re buying">
      <PlanWindow art={s.art} rise={rise} people={s.people} />
      <div className="ck-sum-h"><b>{s.name}</b><p>{s.sub}</p></div>
      {s.lines.length > 0 && (
        <div className="ck-lines">
          {s.lines.map((l) => <p key={l.label} className={cn('ck-ln', l.off && 'is-off')}><span>{l.label}</span><b>{l.value}</b></p>)}
        </div>
      )}
      {s.total && <p className="ck-total"><span className="lab">Total</span><b>{s.total.value}{s.total.unit && <small> {s.total.unit}</small>}</b></p>}
      {s.extra && <p className="ck-extra">{s.extra}</p>}
      {s.until && <p className="ck-until">{s.until.lead} <b>{s.until.day}</b></p>}
      <p className="ck-sum-f"><Icon name="info" size={15} /><span>{s.foot}</span></p>
    </aside>
  );
}

/* ---------- the window ---------- */

export interface CheckoutPanelProps {
  /** "Get Pro", "Extend Pro", "More notes", "Start a team", "Buy licenses". */
  title: string;
  step: 1 | 2 | 3;
  stage: CheckoutStage;
  summary: CheckoutSummaryData;
  /** The step itself. It rises in each time the stage changes. */
  children: ReactNode;
  /** What's at the foot: the step's buttons, or a question in place of them. */
  foot: ReactNode;
  /** Changes when the foot changes in place, such as a question asked there, so it rises in too. */
  footKey?: string | undefined;
  onClose: () => void;
  /** Slows every move by this much (4 is a quarter of the speed), for judging the motion. */
  pm?: number | undefined;
}

/**
 * Checkout's two columns: the step on the left (its title and steps, the step, its foot), what you're buying on the right,
 * and Close at the top right. On a phone, one column, with what you're buying as one line at the top. A `ck-host` sizes
 * it: the window, or a frame in a story.
 */
export function CheckoutPanel({ title, step, stage, summary, children, foot, footKey = '', onClose, pm = 1 }: CheckoutPanelProps) {
  const rise = RISE[stage];
  return (
    <div className="ck-host">
      <div className="ck-in" data-stage={stage} style={{ '--pm': pm }}>
        <div className="ck-main">
          <div className="ck-mini">
            <PlanWindow art={summary.art} rise={rise} size="sm" />
            <span className="w"><b>{summary.name}</b><small className="ac-clamp-1">{summary.brief}</small></span>
            {summary.total && <span className="t">{summary.total.value}{summary.total.unit && <small>{summary.total.unit}</small>}</span>}
          </div>
          <header className="ck-h">
            <h2>{title}</h2>
            <CheckoutSteps at={step} />
          </header>
          <div key={stage} className="ck-b">{children}</div>
          <footer key={`${stage}-${footKey}`} className="ck-f">{foot}</footer>
        </div>
        <CheckoutSummary summary={summary} rise={rise} />
        <IconButton icon="x" label="Close" className="ck-x" onClick={onClose} />
      </div>
    </div>
  );
}

/**
 * The checkout window, on the kit's Modal: focus starts on what's chosen (or the first thing to press), Escape and the
 * veil close it, and focus goes back where it was. `theme` scopes it to one theme, as over a call it opens in yours.
 * With `receipt`, the window is small and holds the receipt alone, as paper in both themes (no window opens over another).
 */
export function CheckoutWindow({ theme = null, receipt, ...panel }: CheckoutPanelProps & { theme?: 'light' | 'dark' | null | undefined; receipt?: ReactNode }) {
  const scoped = receipt ? 'light' : theme;
  return (
    <Modal open onOpenChange={(open) => { if (!open) panel.onClose(); }} label={panel.title} focusOn=".ck-b input:checked"
      className={cn('ck', receipt ? 'is-receipt' : null, scoped)}>
      <ThemeScope theme={scoped}>
        {receipt ?? <CheckoutPanel {...panel} />}
      </ThemeScope>
    </Modal>
  );
}

/* ---------- paying ---------- */

/**
 * How the payment stands, in a chip: awaited (horizon, with moving dots), something to look at (caution) or over (quiet);
 * and until when its address is open.
 */
export function PayStatus({ tone = 'waiting', label, icon, dots = false, expires }: {
  tone?: 'waiting' | 'caution' | 'quiet' | undefined; label: string; icon?: IconName | undefined; dots?: boolean | undefined; expires?: string | null | undefined;
}) {
  return (
    <div className="ck-status" role="status">
      <span className={cn('ck-st', tone !== 'waiting' && `is-${tone}`)}>{dots && <Dots />}{icon && <Icon name={icon} size={15} />}{label}</span>
      {expires && <span className="ck-exp"><Icon name="clock" size={15} />{expires}</span>}
    </div>
  );
}

/**
 * What to send, exactly, with a button that copies it (`copy`, the amount as a wallet takes it: "1152.00" for "1,152.00");
 * what has arrived so far, when part has; and the token on its network.
 */
export function PayAmount({ label = 'Send exactly', amount, copy: value = amount, token = 'USDC', chain, chainName, arrived }: {
  label?: string | undefined; amount: string; copy?: string | undefined; token?: string | undefined; chain: string; chainName: string;
  /** "100.00 of 144.00 USDC arrived." */
  arrived?: string | null | undefined;
}) {
  const [copied, copy] = useCopy(value);
  const tip = copied ? 'Copied' : 'Copy the amount';
  return (
    <div className="ck-amount">
      <p className="lab">{label}</p>
      <div className="v">
        <b>{amount}</b><span className="unit">{token}</span>
        <IconButton icon={copied ? 'check' : 'copy'} label={tip} className="ck-icb" onClick={copy} />
      </div>
      {arrived && <p className="so">{arrived}</p>}
      <p className="ck-on"><CryptoMark name={token} className="ck-mark is-sm" />{token} on<CryptoMark name={chain} className="ck-mark is-sm" />{chainName}</p>
    </div>
  );
}

/**
 * Where to send it: a QR code of the address with the token's mark in its middle (listening while a payment is awaited),
 * and the address itself in mono with its first six and last four characters bold, since those are the ones people check.
 * On a phone there's no code: Open in wallet opens the payment in a wallet app, or copies the address where the network
 * has no such link (`walletHref` null).
 */
export function PayAddress({ address, chainName, token = 'USDC', tag, walletHref, memo, listening = false, quiet = false }: {
  address: string; chainName: string; token?: string | undefined;
  /** new: made for this payment. same: the address part of it already came to. */
  tag: 'new' | 'same';
  walletHref: string | null;
  memo?: string | null | undefined;
  listening?: boolean | undefined;
  /** Open in wallet isn't the filled button while the window asks something else, whose answer is. */
  quiet?: boolean | undefined;
}) {
  const [copied, copy] = useCopy(address);
  const head = address.slice(0, 6);
  const tail = address.length > 10 ? address.slice(-4) : '';
  const mid = address.slice(6, address.length - tail.length);
  return (
    <div className="ck-pay">
      <div className={cn('ck-qr', listening && 'is-listening')}>
        <QrCode value={address} size={150} ecc="H" label={`Address to send ${token} on ${chainName} to`} />
        <span className="ctr" aria-hidden="true"><CryptoMark name={token} /></span>
      </div>
      <div className={cn('ck-addr', !walletHref && 'is-copy')}>
        <p className="lab">
          <span>Address on {chainName}</span>
          {tag === 'new' ? <span className="ck-tag"><Icon name="lock" size={13} />Made for this payment</span> : <span className="ck-tag">The same address</span>}
        </p>
        <code><b>{head}</b>{mid}<b>{tail}</b></code>
        {memo && <CopyField value={memo} label="Memo" className="ck-memo" />}
        <div className="acts">
          <Button variant="secondary" size="sm" icon={copied ? 'check' : 'copy'} onClick={copy}>{copied ? 'Copied' : 'Copy address'}</Button>
        </div>
        <p className="chk">After you paste it, check the first and last characters.</p>
        <div className="ck-wallet">
          {walletHref
            ? <a className={buttonClass({ variant: quiet ? 'secondary' : 'primary' })} href={walletHref}><Icon name="wallet" size={18} />Open in wallet</a>
            : <Button variant={quiet ? 'secondary' : 'primary'} icon={copied ? 'check' : 'copy'} onClick={copy}>{copied ? 'Copied' : 'Copy address'}</Button>}
        </div>
      </div>
    </div>
  );
}

/** An amount to the cent as it counts up: "187.42". */
const cents = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "187.00 USDC arrived on Base", the amount in sans and tabular. `count` counts it up as it lands (`CountUp`, 0.65 s, slowed
 * by `pm`), for a payment seen while you watch, ending on the amount as it's said; reopened later, it's simply there.
 */
export function PayArrived({ amount, value, token = 'USDC', chainName, count = false, pm = 1 }: {
  /** The amount as it's said, "187.00"; `value` the same as a number, to count. */
  amount: string; value: number; token?: string | undefined; chainName: string; count?: boolean | undefined; pm?: number | undefined;
}) {
  const shown = count ? <CountUp value={value} duration={0.65 * pm} format={(v) => (v >= value ? amount : cents(v))} /> : amount;
  return <p className="ck-big"><span className="ac">{shown}</span> {token} arrived on {chainName}</p>;
}

/**
 * Where the payment is, on one line: sent, seen on its network, then what it buys. The step it's at has a ring, and a
 * glint runs along the line towards what's next.
 */
export function PayTrack({ steps, at = 1 }: { steps: readonly [string, string, string]; at?: 0 | 1 | 2 | undefined }) {
  return (
    <div className="ck-track" role="status" aria-label="Where your payment is" style={{ '--at': at }}>
      {steps.map((s, i) => <p key={s} className={i < at ? 'is-done' : i === at ? 'is-on' : undefined}><i className="dot" /><span>{s}</span></p>)}
      <span className="line" aria-hidden="true"><span className="run" /></span>
    </div>
  );
}

/** A big line in the step: what happened, in Newsreader. */
export function CheckoutBig({ children }: { children: ReactNode }) {
  return <p className="ck-big">{children}</p>;
}
/** A line under it. */
export function CheckoutLine({ children }: { children: ReactNode }) {
  return <p className="ck-line2">{children}</p>;
}

/** The payment's receipt, as a row: what was paid and on what, the day, what it bought and its reference, and Receipt. */
export interface ReceiptRowData { title: string; sub: string; reference: string | null; onOpen: () => void }

/**
 * Done: a tick that draws in (`CheckDraw`, 0.5 s, slowed by `pm`) as its circle pops, what you have now in Newsreader, a line
 * or two on it, the receipt's row, and a reminder that nothing renews by itself. A team just started has inviting its people
 * under the receipt (`invite`, under its heading and what an invite does: `inviteTitle`, `inviteHint`).
 */
export function CheckoutDone({ title, lines, receipt, reminder, invite, inviteTitle = 'Invite your team', inviteHint = 'Each link lets one person join, for a day. A license is taken when they next open Alcove.', pm = 1 }: {
  title: string; lines: string[]; receipt: ReceiptRowData | null; reminder: string | null;
  /** What invites people: a link to make, then the link with Copy. Nothing shows without it. */
  invite?: ReactNode;
  inviteTitle?: string | undefined;
  inviteHint?: string | undefined;
  /** Slows the tick's drawing by this much, with the window's other moves. */
  pm?: number | undefined;
}) {
  const q = useId();
  const reduce = useReducedMotion() === true;
  /* The tick draws itself as Done opens; with reduced motion it's simply there. */
  const [drawn, setDrawn] = useState(false);
  useEffect(() => setDrawn(true), []);
  return (
    <div className="ck-done">
      <div className="ck-done-said" role="status">
        <span className="ck-tick"><CheckDraw done={drawn} size={28} duration={reduce ? 0 : 0.5 * pm} /></span>
        <p className="ck-big">{title}</p>
        {lines.map((l) => <p key={l} className="ck-line2">{l}</p>)}
      </div>
      {receipt && (
        <div className="ck-receipt-row">
          <Icon name="receipt" size={22} />
          <span><b>{receipt.title}</b><small>{receipt.sub}{receipt.reference && <> · <code>{receipt.reference}</code></>}</small></span>
          <Button variant="secondary" size="sm" icon="download" onClick={receipt.onOpen}>Receipt</Button>
        </div>
      )}
      {invite !== undefined && invite !== null && invite !== false && (
        <div className="ck-invite" role="group" aria-labelledby={q}>
          <p className="ck-q"><span id={q}>{inviteTitle}</span><small>{inviteHint}</small></p>
          {invite}
        </div>
      )}
      {reminder && <p className="ck-rem"><Icon name="clock" size={18} />{reminder}</p>}
    </div>
  );
}

/**
 * A question before something that can't be undone, asked in the foot in place of its buttons: the answer that loses
 * nothing is the filled one.
 */
export function CheckoutAsk({ title, text, confirm, keep, onConfirm, onKeep, busy = false }: {
  title: string; text: string; confirm: string; keep: string; onConfirm: () => void; onKeep: () => void; busy?: boolean | undefined;
}) {
  return (
    <div className="ck-ask" role="group" aria-label={title}>
      <b>{title}</b>
      <p>{text}</p>
      <div className="row">
        <Button variant="secondary" className="ck-caution" loading={busy} onClick={onConfirm}>{confirm}</Button>
        <Button variant="primary" disabled={busy} onClick={onKeep}>{keep}</Button>
      </div>
    </div>
  );
}

/* ---------- the receipt ---------- */

/** A line of a receipt: what, and its value, in mono for a reference. */
export interface ReceiptLine { label: string; value: ReactNode; mono?: boolean | undefined }

/**
 * A payment's receipt, to keep or print: what it was for, line by line, its total, and a last line (`note`). Print prints
 * it alone, with Alcove's name at its head; on screen it's paper in a small window, light in both themes (CheckoutWindow's
 * `receipt`, or a `ReceiptWindow` over Settings), and Back (or Close) goes back.
 */
export function PaymentReceipt({ title, lines, total, note, onPrint, onBack, backLabel = 'Back' }: {
  title: string; lines: readonly ReceiptLine[]; total: string; note?: ReactNode; onPrint: () => void; onBack: () => void; backLabel?: string | undefined;
}) {
  return (
    <div className="ck-receipt">
      <div className="ck-receipt-brand"><Logo size={22} /></div>
      <p className="ck-receipt-k">Receipt</p>
      <h3>{title}</h3>
      <dl>
        {lines.map((l) => <div key={l.label}><dt>{l.label}</dt><dd className={cn(l.mono && 'is-mono')}>{l.value}</dd></div>)}
      </dl>
      <p className="ck-receipt-total"><span>Total</span><b>{total}</b></p>
      {note !== undefined && <p className="ck-receipt-note">{note}</p>}
      <div className="ck-receipt-acts">
        <Button variant="quiet" onClick={onBack}>{backLabel}</Button>
        <Button variant="primary" icon="printer" onClick={onPrint}>Print</Button>
      </div>
    </div>
  );
}

/** A receipt alone in a small window of paper, light in both themes, as checkout shows its own: for a payment in Settings. */
export function ReceiptWindow({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} label="Receipt" className="ck is-receipt light">
      <ThemeScope theme="light">{children}</ThemeScope>
    </Modal>
  );
}
