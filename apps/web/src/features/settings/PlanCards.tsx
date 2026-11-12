/*
 * Buying Pro and Team, on Settings › Plan (docs: Plans and usage): what the plan's owner is told until they dismiss it, the
 * plans on offer as cards side by side (Free, Pro and Team), with months of Pro bought from the balance on Pro's card and a
 * team's licenses on Team's, by its admin; on Pro, renewing from the balance and refunding the months that haven't started;
 * for a team's admin, auto-purchase and refunding the licenses nobody has taken. Every amount is in dollars to the cent. A
 * refusal says what the server says: its words are written for people.
 */
import { errorMessage, firstName, type MyTeam, type Plan, type PlanAllowance, type PlanNotice, type PlanOffers } from '@alcove/api';
import { Button, Field, Icon, Notice, Select, SettingFoot, SettingRow, SettingsPanel, SettingStep, Switch, buttonClass, useToast, type IconName, type SelectOption } from '@alcove/ui';
import { useId, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useBuyLicenses, useBuyPro, useDismissPlanNotice, useRefundLicenses, useRefundPro, useSetAutoPurchase, useSetRenew } from '~/lib/queries';
import { shortDay } from '~/lib/time';
import { roomLabel, usdCents } from '~/lib/words';
import { useSaveState, useSaving } from './save';

const day = (iso: string | null) => (iso === null ? 'soon' : shortDay(new Date(iso)));
const monthsWord = (n: number) => `${n} ${n === 1 ? 'month' : 'months'}`;
const licensesLeft = (n: number) => `${n} team ${n === 1 ? 'license' : 'licenses'}`;

/** A team's admin by first name, for a member's notice: "Ask Priya". */
export const adminName = (team: MyTeam | null | undefined): string => {
  const admin = team?.members.find((m) => m.role === 'admin');
  return admin ? firstName(admin.person.name) : 'your team’s admin';
};

/** What one notice says, with the date in the person's own format. `admin`: who a member asks for a license. */
export function noticeWords(n: PlanNotice, plan: Plan, offers: PlanOffers | undefined, admin: string): { text: string; icon: IconName; tone: 'info' | 'caution' } {
  switch (n.kind) {
    case 'pro-ending': {
      const short = offers !== undefined && plan.balance.microUsd < offers.pro.microUsdPerMonth;
      const text = plan.pro.renew
        ? `Pro ends on ${day(n.until)}. Your balance is short of a month, so it won’t renew: add money, or buy more months, to keep it.`
        : `Pro ends on ${day(n.until)}. Turn on Renew from balance, or buy more months, to keep it.${short ? ' Your balance is short of a month.' : ''}`;
      return { text, icon: 'clock', tone: 'caution' };
    }
    case 'pro-renewed': return { text: `Pro renewed from your balance. It now runs to ${day(n.until)}.`, icon: 'coins', tone: 'info' };
    case 'pro-ended': return { text: `Pro ended on ${day(n.until)}. You’re on Free.`, icon: 'info', tone: 'info' };
    case 'licenses-low': return { text: `${licensesLeft(n.count ?? 0)} left. Buy more so nobody’s left without one.`, icon: 'people', tone: 'caution' };
    case 'licenses-none': return { text: 'Someone on your team needed a license and none was left. Buy more, or turn on auto-purchase.', icon: 'people', tone: 'caution' };
    case 'license-needed': return { text: `There was no team license for you. Ask ${admin} to buy more; until then you’re on Free.`, icon: 'people', tone: 'caution' };
    case 'license-replaced-pro': {
      const n0 = n.count ?? 0;
      return { text: `Your team license replaced Pro. ${n0 === 0 ? 'No month of Pro was left to refund.' : `${monthsWord(n0)} that hadn’t started went back to your balance.`}`, icon: 'coins', tone: 'info' };
    }
  }
}

/** The plan's notices, newest first, each until it's dismissed. Dismissing one leaves focus on the plan. */
export function PlanNotices({ plan, offers, team }: { plan: Plan; offers: PlanOffers | undefined; team: MyTeam | null | undefined }) {
  const dismiss = useDismissPlanNotice();
  const toast = useToast();
  const list = useRef<HTMLDivElement>(null);
  if (!plan.notices.length) return null;
  const close = (id: string) => dismiss.mutate(id, {
    onSuccess: () => requestAnimationFrame(() => {
      const next = list.current?.querySelector<HTMLButtonElement>('.ac-notice-x');
      if (next) next.focus();
      else document.getElementById('plan')?.focus({ preventScroll: true });
    }),
    onError: (e) => toast(errorMessage(e), { icon: 'x' })
  });
  return (
    <div ref={list} className="set-plan-notices">
      {plan.notices.map((n) => {
        const said = noticeWords(n, plan, offers, adminName(team));
        return <Notice key={n.id} tone={said.tone} icon={said.icon} onDismiss={() => close(n.id)} dismissLabel="Dismiss this notice">{said.text}</Notice>;
      })}
    </div>
  );
}

/** About how many hours of notes a period brings: "About 50 hours". */
const hoursOf = (minutes: number) => { const h = Math.round(minutes / 60); return `About ${h} ${h === 1 ? 'hour' : 'hours'}`; };

/** What a plan brings, one line each. `each`: a team's, for each licensed person, its storage pooled. */
function Brings({ a, each = false }: { a: PlanAllowance; each?: boolean | undefined }) {
  const lines: { icon: IconName; text: string }[] = [
    { icon: 'notes', text: `${hoursOf(a.notesMinutes)} of notes a month${each ? ' each' : ''}` },
    { icon: 'hardDrive', text: each ? `${roomLabel(a.storageBytes)} of storage each, pooled` : `${roomLabel(a.storageBytes)} of storage` },
    { icon: 'fileText', text: `Files up to ${roomLabel(a.fileBytes)}` }
  ];
  return <ul className="set-plan-gets">{lines.map((l) => <li key={l.icon}><Icon name={l.icon} size={16} />{l.text}</li>)}</ul>;
}

function Card({ name, price, yours, allowance, each, children }: { name: string; price: string; yours: boolean; allowance: PlanAllowance; each?: boolean | undefined; children?: ReactNode }) {
  const h = useId();
  return (
    <section className={yours ? 'set-plan is-yours' : 'set-plan'} aria-labelledby={h}>
      <div className="set-plan-h"><h3 id={h}>{name}</h3>{yours && <span className="set-tag">Your plan</span>}</div>
      <p className="set-plan-price">{price}</p>
      <Brings a={allowance} each={each} />
      {children}
    </section>
  );
}

/**
 * The plans as cards side by side, stacked on a phone. Pro's card buys months from the balance, and Team's a team's
 * licenses, for its admin: the card that leads (Team's for an admin, otherwise Pro's) has the one filled button on the page
 * when the balance covers what's picked; when it doesn't, the reason, and Add money as the way on (`onAddMoney`, when this
 * server takes payments). Someone not on a team starts one from Team's card, on the Team page.
 */
export function PlanCards({ plan, offers, team, onAddMoney }: { plan: Plan; offers: PlanOffers; team: MyTeam | null | undefined; onAddMoney: (() => void) | null }) {
  const onPro = plan.kind === 'pro';
  const admin = team?.role === 'admin';
  return (
    <div className="set-plans" role="group" aria-label="Plans">
      <Card name="Free" price="$0" yours={plan.kind === 'free' && !team} allowance={offers.free} />
      <Card name="Pro" price={`${usdCents(offers.pro.microUsdPerMonth)} a month`} yours={onPro} allowance={offers.pro}>
        <BuyPro plan={plan} offers={offers} onAddMoney={onAddMoney} lead={!admin} />
      </Card>
      <Card name="Team" price={`${usdCents(offers.team.microUsdPerLicense)} a person a month`} yours={plan.kind === 'team' || !!team} allowance={offers.team} each>
        {team && admin ? <BuyLicenses plan={plan} offers={offers} team={team} onAddMoney={onAddMoney} />
          : team ? <div className="set-plan-buy"><p className="set-plan-until"><b>You’re on {team.name}</b>{team.licensed ? `${adminName(team)} buys its licenses.` : `There’s no license for you yet. Ask ${adminName(team)} to buy more.`}</p></div>
            : <div className="set-plan-buy"><p className="set-plan-until">A license for each person, bought by whoever starts the team. Everyone licensed shares the team’s notes and workspaces.</p>
              <div className="set-plan-acts"><Link to="/team" className={buttonClass({ variant: 'secondary' })}>Start a team</Link></div></div>}
      </Card>
    </div>
  );
}

const licensesWord = (n: number) => `${n} ${n === 1 ? 'license' : 'licenses'}`;

/** A team's admin buys licenses from their balance at the price shown: how many are left, how many to buy, and what it costs. */
function BuyLicenses({ plan, offers, team, onAddMoney }: { plan: Plan; offers: PlanOffers; team: MyTeam; onAddMoney: (() => void) | null }) {
  const buy = useBuyLicenses();
  const toast = useToast();
  const [count, setCount] = useState(1);
  const [typed, setTyped] = useState('1');
  const [refused, setRefused] = useState<string | null>(null);
  const price = offers.team.microUsdPerLicense;
  const max = offers.team.maxLicenses;
  const total = count * price;
  const short = total - plan.balance.microUsd;
  const left = team.licenses?.unconsumed ?? 0;
  const pick = (v: string) => {
    setTyped(v);
    setRefused(null);
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= max) setCount(n);
  };
  const go = () => {
    setRefused(null);
    buy.mutate({ count, microUsdPerLicense: price }, {
      onSuccess: (t) => {
        toast(`Bought ${licensesWord(count)}. ${licensesWord(t.licenses?.unconsumed ?? 0)} left.`, { icon: 'check' });
        setCount(1); setTyped('1');
      },
      onError: (e) => setRefused(errorMessage(e))
    });
  };
  const label = `Buy ${licensesWord(count)}`;
  return (
    <div className="set-plan-buy">
      <p className="set-plan-until"><b>{licensesWord(left)} left</b>Someone without a live license takes one when they next open Alcove. Each runs a month.</p>
      <div className="set-plan-pick">
        <Field label="Licenses" type="number" inputMode="numeric" min={1} max={max} step={1} value={typed} onChange={(e) => pick(e.target.value)}
          hint={`1 to ${max} at a time`} className="set-plan-n" />
        <span className="set-plan-total">{usdCents(total)}</span>
      </div>
      <div className="set-plan-acts">
        {short <= 0
          ? <Button variant="primary" loading={buy.isPending} onClick={go}>{label}</Button>
          : <>
              <Button variant="secondary" disabled>{label}</Button>
              {onAddMoney && <Button variant="primary" icon="plus" onClick={onAddMoney}>Add money</Button>}
            </>}
      </div>
      {short > 0 && <p className="set-plan-why">Add {usdCents(short)} more to buy {licensesWord(count)}. Your balance is {usdCents(plan.balance.microUsd)}.</p>}
      {refused !== null && <p className="set-plan-err" role="alert">{refused}</p>}
    </div>
  );
}

function BuyPro({ plan, offers, onAddMoney, lead }: { plan: Plan; offers: PlanOffers; onAddMoney: (() => void) | null; lead: boolean }) {
  const buy = useBuyPro();
  const toast = useToast();
  const [months, setMonths] = useState(1);
  const [refused, setRefused] = useState<string | null>(null);
  const price = offers.pro.microUsdPerMonth;
  const total = months * price;
  const short = total - plan.balance.microUsd;
  const until = plan.pro.until;
  const options: SelectOption<string>[] = Array.from({ length: offers.pro.maxMonths }, (_, i) => ({
    value: String(i + 1), label: monthsWord(i + 1), note: usdCents((i + 1) * price)
  }));
  const pick = (v: string) => { const n = Number(v); if (Number.isInteger(n) && n >= 1) { setMonths(n); setRefused(null); } };
  const go = () => {
    setRefused(null);
    buy.mutate({ months, microUsdPerMonth: price }, {
      onSuccess: (p) => {
        setMonths(1);
        toast(`Pro bought: ${monthsWord(months)}.${p.pro.until ? ` It runs to ${day(p.pro.until)}.` : ''}`, { icon: 'check' });
      },
      onError: (e) => setRefused(errorMessage(e))
    });
  };
  const label = `Buy ${monthsWord(months)}`;
  return (
    <div className="set-plan-buy">
      {until !== null && <p className="set-plan-until"><b>Pro until {day(until)}</b>Buy more months: they start after the last one.</p>}
      <div className="set-plan-pick">
        <Select label="Months of Pro" value={String(months)} options={options} onChange={pick} />
        <span className="set-plan-total">{usdCents(total)}</span>
      </div>
      <div className="set-plan-acts">
        {short <= 0
          ? <Button variant={lead ? 'primary' : 'secondary'} loading={buy.isPending} onClick={go}>{label}</Button>
          : <>
              <Button variant="secondary" disabled>{label}</Button>
              {onAddMoney && <Button variant={lead ? 'primary' : 'secondary'} icon="plus" onClick={onAddMoney}>Add money</Button>}
            </>}
      </div>
      {short > 0 && <p className="set-plan-why">Add {usdCents(short)} more to buy {monthsWord(months)}. Your balance is {usdCents(plan.balance.microUsd)}.</p>}
      {refused !== null && <p className="set-plan-err" role="alert">{refused}</p>}
    </div>
  );
}

const RENEW = 'Renew from balance';

/** On Pro: renewing from the balance, and refunding the months that haven't started, asked in place. */
export function ProPanel({ plan }: { plan: Plan }) {
  const renew = useSetRenew();
  const refund = useRefundPro();
  const saving = useSaving();
  const state = useSaveState();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const ask = useRef<HTMLButtonElement>(null);
  if (plan.kind !== 'pro') return null;
  const now = Date.now();
  const later = plan.pro.months.filter((m) => Date.parse(m.from) > now);
  const running = plan.pro.months.find((m) => Date.parse(m.from) <= now && Date.parse(m.to) > now);
  const back = plan.pro.refundableMicroUsd;
  const setRenew = (on: boolean) => {
    void saving(RENEW, () => renew.mutateAsync(on)).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' }));
  };
  const doRefund = () => {
    setRefused(null);
    refund.mutate(undefined, {
      onSuccess: () => { setAsking(false); toast(`Refunded ${usdCents(back)} to your balance.`, { icon: 'check' }); },
      onError: (e) => setRefused(errorMessage(e))
    });
  };
  const refundLabel = `Refund ${monthsWord(later.length)} that ${later.length === 1 ? 'hasn’t' : 'haven’t'} started`;
  return (
    <SettingsPanel title="Pro">
      <SettingRow label={RENEW} help="Buys a month from your balance 3 days before Pro ends." saveState={state(RENEW)}
        onLabel={() => setRenew(!plan.pro.renew)}
        control={<Switch label={RENEW} checked={plan.pro.renew} onChange={setRenew} />} />
      {back > 0 && !asking && (
        <SettingRow label={refundLabel} help={`${usdCents(back)} goes back to your balance. A month that has started isn’t refunded.`}
          control={<Button ref={ask} variant="quiet" size="sm" onClick={() => { setRefused(null); setAsking(true); }}>Refund ({usdCents(back)})</Button>} />
      )}
      {back > 0 && asking && (
        <>
          <SettingStep title={`Refund ${monthsWord(later.length)} of Pro?`}
            help={`${usdCents(back)} goes back to your balance.${running ? ` Pro ends on ${day(running.to)}, when the month running now does.` : ''}`}>
            {refused !== null && <p className="set-plan-err" role="alert">{refused}</p>}
          </SettingStep>
          <SettingFoot actions={
            <>
              <Button variant="quiet" size="sm" disabled={refund.isPending} onClick={() => { setAsking(false); requestAnimationFrame(() => ask.current?.focus()); }}>{later.length === 1 ? 'Keep it' : 'Keep them'}</Button>
              <Button variant="secondary" size="sm" loading={refund.isPending} onClick={doRefund}>Refund {usdCents(back)}</Button>
            </>
          } />
        </>
      )}
    </SettingsPanel>
  );
}

const AUTO = 'Auto-purchase';

/** For a team's admin: buying a license automatically when one is needed, and refunding the ones nobody has taken, asked in place. */
export function TeamPanel({ team }: { team: MyTeam | null | undefined }) {
  const auto = useSetAutoPurchase();
  const refund = useRefundLicenses();
  const saving = useSaving();
  const state = useSaveState();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const ask = useRef<HTMLButtonElement>(null);
  const licenses = team?.licenses;
  if (!team || !licenses) return null;
  const setAuto = (on: boolean) => {
    void saving(AUTO, () => auto.mutateAsync(on)).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' }));
  };
  const back = licenses.refundableMicroUsd;
  const n = licenses.unconsumed;
  const doRefund = () => {
    setRefused(null);
    refund.mutate(undefined, {
      onSuccess: () => { setAsking(false); toast(`Refunded ${usdCents(back)} to your balance.`, { icon: 'check' }); },
      onError: (e) => setRefused(errorMessage(e))
    });
  };
  return (
    <SettingsPanel title={team.name}>
      <SettingRow label={AUTO} help="Buys a license from your balance when someone on the team needs one and none is left." saveState={state(AUTO)}
        onLabel={() => setAuto(!licenses.autoPurchase)}
        control={<Switch label={AUTO} checked={licenses.autoPurchase} onChange={setAuto} />} />
      {n > 0 && !asking && (
        <SettingRow label={`Refund ${n} unconsumed ${n === 1 ? 'license' : 'licenses'}`} help={`${usdCents(back)} goes back to your balance. A license someone has taken isn’t refunded.`}
          control={<Button ref={ask} variant="quiet" size="sm" onClick={() => { setRefused(null); setAsking(true); }}>Refund ({usdCents(back)})</Button>} />
      )}
      {n > 0 && asking && (
        <>
          <SettingStep title={`Refund ${licensesWord(n)} nobody has taken?`}
            help={`${usdCents(back)} goes back to your balance. Someone who needs a license after that waits until you buy more${licenses.autoPurchase ? ', or auto-purchase buys one' : ''}.`}>
            {refused !== null && <p className="set-plan-err" role="alert">{refused}</p>}
          </SettingStep>
          <SettingFoot actions={
            <>
              <Button variant="quiet" size="sm" disabled={refund.isPending} onClick={() => { setAsking(false); requestAnimationFrame(() => ask.current?.focus()); }}>{n === 1 ? 'Keep it' : 'Keep them'}</Button>
              <Button variant="secondary" size="sm" loading={refund.isPending} onClick={doRefund}>Refund {usdCents(back)}</Button>
            </>
          } />
        </>
      )}
    </SettingsPanel>
  );
}
