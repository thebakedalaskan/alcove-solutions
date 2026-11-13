/*
 * Team in Settings › Plan (docs/design/pages.md › Settings; docs/product/user-flows.md 16.18 and 16.19), as Plan.tsx puts
 * it in place. On Team, the plan row says whose team it is and until when your license runs, with Open Team; your notes are
 * your own, and Storage is the team's pool. On a team without a license, a note at the top says you're on your own plan
 * until one is yours. A team's notices are said in plain words. Its admin has the licenses (how many are left, who's
 * waiting, Buy licenses), and in what they pay with, buying one when it's needed and refunding those nobody has taken. The
 * team is `teams.mine`'s, read beside the plan; the rules are plan-state's.
 */
import { errorMessage, type MyTeam, type Plan, type PlanNotice, type PlanOffers, type TeamMember } from '@alcove/api';
import { Button, SettingFoot, SettingNote, SettingRow, SettingStep, Switch, buttonClass, useToast, type IconName } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { useRef, useState, type ReactNode } from 'react';
import { useCheckout } from '~/features/plans/checkout';
import { PLAN_NAMES, licensesLeft, teamAdmin, waitingForLicense, type TeamLicenses } from '~/features/plans/plan-state';
import { callName } from '~/lib/people';
import { useRefundLicenses, useSetAutoPurchase } from '~/lib/queries';
import { dayFullMonth, longDay } from '~/lib/time';
import { plural, roomLabel, usdCents } from '~/lib/words';
import { useSaveState, useSaving } from './save';

/** The admin by their first name, as a member's plan says who buys the licenses. */
const adminName = (team: MyTeam | null | undefined, otherwise: string): string => {
  const admin = teamAdmin(team);
  return admin ? callName(admin) : otherwise;
};

/** What a team's notice says at the top of Plan, and its icon; null for Pro's and a workspace's, which Plan says itself. */
export function teamNoticeSays(n: PlanNotice, plan: Plan, team: MyTeam | null | undefined): { icon: IconName; text: string } | null {
  const name = plan.team?.name ?? team?.name ?? 'your team';
  switch (n.kind) {
    case 'licenses-low': {
      const left = licensesLeft(n, team);
      return { icon: 'people', text: `${left === 0 ? 'No licenses' : plural(left, 'license')} left on ${name}. Buy more so nobody is left without one.` };
    }
    case 'licenses-none': return {
      icon: 'people',
      text: `Someone on ${name} needed a license and none was left. ${team?.licenses?.autoPurchase ? 'Buy more so they have one.' : 'Buy more, or turn on buying one when it’s needed.'}`
    };
    case 'license-replaced-pro': return { icon: 'swap', text: `Your team license replaced Pro.${n.count ? ` ${plural(n.count, 'month')} that hadn’t started went back to your balance.` : ''}` };
    // Waiting for a license is said by the note about it, for as long as it's true.
    case 'license-needed': return null;
    case 'pro-ending': case 'pro-renewed': case 'pro-ended': case 'workspace-payer': return null;
  }
}

/**
 * On a team without a license: you're on your own plan until one is yours, said at the top for as long as it's true. A
 * member's admin has been told; the admin buys more.
 */
export function WaitingNote({ plan, team }: { plan: Plan; team: MyTeam | null | undefined }) {
  if (!plan.team || !waitingForLicense(plan)) return null;
  const now = `so you’re on ${PLAN_NAMES[plan.kind]} for now`;
  if (plan.team.role === 'admin') {
    return <SettingNote icon="people">You’re the admin of {plan.team.name}, but none of its licenses is yours yet, {now}. Buy licenses, and one is yours the next time you open Alcove.</SettingNote>;
  }
  return (
    <SettingNote icon="people">
      You’re on {plan.team.name}, but none of its licenses was left for you, {now}. {adminName(team, 'Its admin')} has been told, and one is yours the next time
      you open Alcove after they buy more.
    </SettingNote>
  );
}

/** The plan row on Team: whose team, and until when your license runs, with See plans and Open Team. */
export function TeamPlanRow({ plan, team }: { plan: Plan; team: MyTeam | null | undefined }) {
  const runs = dayFullMonth(new Date(plan.period.to));
  const name = plan.team?.name ?? team?.name ?? 'Your team';
  const help = plan.team?.role === 'admin'
    ? `${name}. You’re its admin: your license runs to ${runs}.`
    : `${name}. Your license runs to ${runs}; ${adminName(team, 'its admin')} buys them.`;
  return (
    <SettingRow label={PLAN_NAMES.team} help={help} under control={
      <>
        <Link to="/plans" className={buttonClass({ variant: 'quiet', size: 'sm' })}>See plans</Link>
        <Link to="/team" className={buttonClass({ variant: 'secondary', size: 'sm' })}>Open Team</Link>
      </>
    } />
  );
}

/** Notes left on Team: your own, and a new license brings them back. `next` is how many hours a license brings. */
export function teamNotesHelp({ out, low, next }: { out: boolean; low: boolean; next: string }): string {
  if (out) return 'Calls go on without notes until your license is taken again.';
  if (low) return `Under an hour left. Back to ${next} when your license is taken again.`;
  return `Your own, back to ${next} when your license is taken again. Calls without notes are free.`;
}

/** Storage on Team: the team's pool, so much for each license. */
export const teamStorageHelp = (plan: Plan, offers: PlanOffers | undefined): string =>
  `The team’s, shared by everyone with a license${offers ? `: ${roomLabel(offers.team.storageBytes)} for each` : ''}. Files up to ${roomLabel(plan.storage.fileBytes)}.`;

/**
 * The team over its storage, said once: until when everything works as before, or what has stopped since, with `room` (Make
 * room, Plan.tsx's) as what to do about it.
 */
export function TeamStorageNote({ plan, team, room }: { plan: Plan; team: MyTeam | null | undefined; room: ReactNode }) {
  const limit = roomLabel(plan.storage.limitBytes);
  const admin = Boolean(team?.licenses);
  if (plan.grace?.storage) {
    return (
      <SettingNote tone="caution" action={room}>
        The team is over its {limit} of storage. Everything works as before until {longDay(new Date(plan.grace.until))}; then uploads and notes stop
        until it makes room{admin ? ' or you buy more licenses' : ''}.
      </SettingNote>
    );
  }
  if (plan.over.storage) {
    return (
      <SettingNote tone="caution" action={room}>
        Uploads and notes have stopped: the team is over its {limit} of storage. {admin ? 'Make room, or buy more licenses.' : 'Make room to start them again.'}
      </SettingNote>
    );
  }
  return null;
}

/** What the balance buys, as Balance's help says it: a team's admin buys its licenses with it. */
export const balanceBuys = (plan: Plan, team: MyTeam | null | undefined): string =>
  (team?.licenses ? 'the team’s licenses and more notes are' : plan.kind === 'team' ? 'more notes are' : 'Pro and more notes are');

/** "Maya is waiting", "you’re waiting", "you and Maya are waiting": who's waiting for a license, as Licenses says it. */
function whoWaits(waiting: TeamMember[]): string {
  const names = [...waiting].sort((a, b) => Number(b.you) - Number(a.you)).map((m) => (m.you ? 'you' : callName(m.person)));
  if (names.length === 1) return names[0] === 'you' ? 'you’re waiting' : `${names[0] ?? ''} is waiting`;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''} are waiting`;
}

/**
 * A team's licenses, for its admin: how many are left of how many, and who's waiting for one, in warm. Buy licenses opens
 * checkout on Team, filled while someone waits.
 */
export function Licenses({ licenses, offers }: { licenses: TeamLicenses; offers: PlanOffers | undefined }) {
  const checkout = useCheckout();
  const { left, of, waiting } = licenses;
  const count = of === 0 ? 'None bought yet' : left === 0 ? `None of ${of} left` : `${left} of ${of} left`;
  const help = `${count}${waiting.length ? `, and ${whoWaits(waiting)} for one` : ''}. Each is taken as someone next opens Alcove, for ${offers?.periodDays ?? 30} days.`;
  return (
    <SettingRow label="Licenses" help={help} warm={waiting.length > 0}
      control={<Button variant={waiting.length ? 'primary' : 'secondary'} size="sm" onClick={() => checkout.open({ plan: 'team' }, 'settings')}>Buy licenses</Button>} />
  );
}

const AUTO_BUY = 'Buy one when it’s needed';

/** A team's admin buying a license from their balance when someone needs one and none is left: kept as it's switched. */
export function AutoBuy({ plan, offers, canAdd, on }: { plan: Plan; offers: PlanOffers | undefined; canAdd: boolean; on: boolean }) {
  const auto = useSetAutoPurchase();
  const saving = useSaving();
  const state = useSaveState();
  const toast = useToast();
  const set = (to: boolean) => {
    void saving(AUTO_BUY, () => auto.mutateAsync(to)).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' }));
  };
  const price = offers?.team.microUsdPerLicense;
  const short = on && price !== undefined && plan.balance.microUsd < price;
  return (
    <SettingRow label={AUTO_BUY} saveState={state(AUTO_BUY)} problem={short} onLabel={() => set(!on)}
      help={short ? `Your balance is short of a license (${usdCents(price)}), so none would be bought.${canAdd ? ' Add money to keep it.' : ''}` : 'From your balance, when someone on the team needs a license and none is left.'}
      control={<Switch label={AUTO_BUY} checked={on} onChange={set} />} />
  );
}

/**
 * Refunding the licenses nobody has taken, asked in place: what goes back to the balance, and what happens when someone
 * needs one after. One someone has taken isn't refunded.
 */
export function RefundLicenses({ left, back, auto }: { left: number; back: number; auto: boolean }) {
  const refund = useRefundLicenses();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const ask = useRef<HTMLButtonElement>(null);
  if (left <= 0 || back <= 0) return null;
  const go = () => {
    setRefused(null);
    refund.mutate(undefined, {
      onSuccess: () => { setAsking(false); toast(`Refunded ${usdCents(back)} to your balance.`, { icon: 'check' }); },
      onError: (e) => setRefused(errorMessage(e))
    });
  };
  if (!asking) {
    return (
      <SettingRow label={`Refund ${plural(left, 'license')} nobody has taken`} help={`${usdCents(back)} goes back to your balance. One someone has taken isn’t refunded.`}
        control={<Button ref={ask} variant="quiet" size="sm" onClick={() => { setRefused(null); setAsking(true); }}>Refund</Button>} />
    );
  }
  return (
    <>
      <SettingStep title={`Refund ${plural(left, 'license')} nobody has taken?`}
        help={`${usdCents(back)} goes back to your balance. Then ${auto ? 'one is bought from your balance when someone needs it' : 'whoever needs one waits until you buy more'}.`}>
        {refused !== null && <p className="set-err" role="alert">{refused}</p>}
      </SettingStep>
      <SettingFoot actions={
        <>
          {/* The answer that loses nothing is the filled one, and takes the focus as the question opens. */}
          <Button variant="primary" size="sm" autoFocus disabled={refund.isPending} onClick={() => { setAsking(false); requestAnimationFrame(() => ask.current?.focus()); }}>{left === 1 ? 'Keep it' : 'Keep them'}</Button>
          <Button variant="secondary" size="sm" loading={refund.isPending} onClick={go}>Refund {usdCents(back)}</Button>
        </>
      } />
    </>
  );
}
