/*
 * Plan: the plan you're on and when it renews, about how much of its notes is left (with the sun on the row's own
 * hairline where it runs to), storage against its limit, and the balance plans are bought with,
 * with adding money when the server takes payments. Being over the plan's limits is said once, in a note: until when
 * everything works as before, or what's stopped since. Top-ups on their way are listed under the balance, each opening
 * the sheet on it (topup.tsx), so closing the sheet loses none; one nothing has reached yet can be cancelled from its row.
 * What the owner is told about the plan sits at the top until dismissed, and the plans on offer, with buying months of Pro,
 * renewing and refunding, sit between the plan and the balance (PlanCards.tsx).
 */
import { errorMessage, type Plan, type PlanKind, type TopUp } from '@alcove/api';
import { Button, CryptoMark, IconButton, SettingFact, SettingNote, SettingRow, SettingsGroup, SettingsPanel, SunLine, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { q, useCancelTopUp } from '~/lib/queries';
import { hoursAndMinutes, shortDay } from '~/lib/time';
import { roomLabel, usd } from '~/lib/words';
import { PlanCards, PlanNotices, ProPanel, TeamPanel } from './PlanCards';
import { AddMoneySheet, routeName, topUpLine } from './topup';

export const PLAN_NAMES: Record<PlanKind, string> = { free: 'Free', pro: 'Pro', team: 'Team' };

/** About how much of the period's notes is left, said as an estimate: "About 3 h 20 min", or "None" once they've stopped. */
export const notesLeft = (p: Pick<Plan, 'notes'>): string => (p.notes.stopped || p.notes.minutesLeft <= 0 ? 'None' : `About ${hoursAndMinutes(p.notes.minutesLeft)}`);

export function PlanGroup({ plan }: { plan: Plan }) {
  const routes = useQuery(q.topUpRoutes());
  const offers = useQuery(q.offers()).data;
  const team = useQuery(q.myTeam()).data;
  // Top-ups on their way show whether or not 1Click answers right now; a server without payments has none to show.
  const open = useQuery(q.topUps()).data ?? [];
  const cancel = useCancelTopUp();
  const toast = useToast();
  const add = useRef<HTMLButtonElement>(null);
  const [sheet, setSheet] = useState<{ open: boolean; topUpId: string | null }>({ open: false, topUpId: null });
  const show = (topUpId: string | null) => setSheet({ open: true, topUpId });
  /** Only one nothing has reached, whose address can still be paid, can be cancelled: as in the sheet. */
  const cancellable = (t: TopUp) => t.state === 'waiting' && Date.parse(t.expiresAt) > Date.now();
  /** Cancels a top-up; its cancel control goes, and focus moves to the row after it (or before it), else to Add money. */
  const cancelRow = (t: TopUp) => {
    const i = open.findIndex((x) => x.id === t.id);
    const near = open[i + 1] ?? open[i - 1];
    cancel.mutate(t.id, {
      onSuccess: () => requestAnimationFrame(() => {
        // Unless they've moved on: focus still on the cancelled row, or nowhere, is moved.
        const at = document.activeElement;
        if (at && at !== document.body && at.isConnected && !at.closest(`[data-top-up="${t.id}"]`)) return;
        const row = near ? document.querySelector<HTMLButtonElement>(`[data-top-up="${near.id}"] .set-topup-acts button`) : null;
        (row ?? add.current)?.focus();
      }),
      onError: (e) => toast(errorMessage(e), { icon: 'x' })
    });
  };
  const renews = shortDay(new Date(plan.period.to));
  const { storage } = plan;
  const until = plan.kind === 'pro' && plan.pro.until !== null ? `Pro until ${shortDay(new Date(plan.pro.until))}. `
    : plan.kind === 'team' && plan.team ? `A license from ${plan.team.name}. ` : '';
  return (
    <SettingsGroup id="plan" title="Plan">
      <PlanNotices plan={plan} offers={offers} team={team} />
      <SettingsPanel>
        <SettingRow label="Plan" help={`${until}Notes renew ${renews}.`} control={<SettingFact>{PLAN_NAMES[plan.kind]}</SettingFact>} />
        <SettingRow className="is-left" label="Notes left" help={plan.notes.stopped ? `They start again ${renews}.` : 'An estimate: busier calls use more.'}
          control={<span className="set-left">{notesLeft(plan)}</span>}>
          <SunLine share={plan.notes.minutesPerPeriod > 0 ? plan.notes.minutesLeft / plan.notes.minutesPerPeriod : 0} />
        </SettingRow>
        <SettingRow label="Storage" help={`${plan.kind === 'team' ? 'The team’s, shared by everyone licensed: uploads' : 'Uploads'} and call recordings. Files up to ${roomLabel(storage.fileBytes)}.`}
          control={<SettingFact>{roomLabel(storage.usedBytes)} of {roomLabel(storage.limitBytes)}</SettingFact>} />
        <Limits plan={plan} />
      </SettingsPanel>
      {offers && <PlanCards plan={plan} offers={offers} team={team} onAddMoney={routes.data === undefined ? null : () => show(null)} />}
      <ProPanel plan={plan} />
      <TeamPanel team={team} />
      <SettingsPanel>
        <SettingRow label="Balance" help="What plans are bought with. Add money with a stablecoin from any wallet or exchange."
          control={
            <div className="set-topup-acts">
              <span className="set-left">{usd(plan.balance.microUsd)}</span>
              {routes.data !== undefined && <Button ref={add} variant="secondary" size="sm" icon="plus" onClick={() => show(null)}>Add money</Button>}
            </div>
          } />
        {open.map((t) => (
          <SettingRow key={t.id} data-top-up={t.id} mark={<CryptoMark name={t.route.chain} />}
            label={`${t.asked.amount} ${routeName(t.route)}`} help={topUpLine(t)}
            onLabel={() => show(t.id)}
            control={
              <div className="set-topup-acts">
                <Button variant="secondary" size="sm" onClick={() => show(t.id)}>Open</Button>
                {cancellable(t) && (
                  <IconButton icon="x" label={`Cancel the ${t.asked.amount} ${routeName(t.route)} top-up`}
                    disabled={cancel.isPending && cancel.variables === t.id} onClick={() => cancelRow(t)} />
                )}
              </div>
            } />
        ))}
      </SettingsPanel>
      <AddMoneySheet open={sheet.open} topUpId={sheet.topUpId} onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))} />
    </SettingsGroup>
  );
}

/** Being over the plan's limits, said once: until when everything works as before, or what has stopped since. */
function Limits({ plan }: { plan: Plan }) {
  const { grace, over } = plan;
  const name = PLAN_NAMES[plan.kind];
  if (grace?.storage) {
    return <SettingNote tone="caution">You’re over {name}’s storage. Everything works as before until {shortDay(new Date(grace.until))}; then uploads and notes stop until you upgrade or make room.</SettingNote>;
  }
  if (over.storage) {
    return <SettingNote tone="caution">Uploads and notes have stopped: you’re over {name}’s storage. Upgrade, or make room.</SettingNote>;
  }
  return null;
}
