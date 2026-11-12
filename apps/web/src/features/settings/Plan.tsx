/*
 * Plan and credits: the time of notes left, with the sun on the row's own hairline where it runs to, the minutes used
 * this month, and adding credits when the server takes payments. Top-ups on their way are listed under Add credits, each
 * opening the sheet on it (topup.tsx), so closing the sheet loses none; one nothing has reached yet can be cancelled
 * from its row.
 */
import { errorMessage, type CreditBalance, type TopUp } from '@alcove/api';
import { Button, CryptoMark, IconButton, SettingFact, SettingRow, SettingsGroup, SettingsPanel, SunLine, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { q, useCancelTopUp } from '~/lib/queries';
import { hoursAndMinutes } from '~/lib/time';
import { AddCreditsSheet, routeName, topUpLine } from './topup';

export function PlanGroup({ credits }: { credits: CreditBalance }) {
  const routes = useQuery(q.topUpRoutes());
  // Top-ups on their way show whether or not 1Click answers right now; a server without payments has none to show.
  const open = useQuery(q.topUps()).data ?? [];
  const cancel = useCancelTopUp();
  const toast = useToast();
  const add = useRef<HTMLButtonElement>(null);
  const [sheet, setSheet] = useState<{ open: boolean; topUpId: string | null }>({ open: false, topUpId: null });
  const show = (topUpId: string | null) => setSheet({ open: true, topUpId });
  /** Only one nothing has reached, whose address can still be paid, can be cancelled: as in the sheet. */
  const cancellable = (t: TopUp) => t.state === 'waiting' && Date.parse(t.expiresAt) > Date.now();
  /** Cancels a top-up; its cancel control goes, and focus moves to the row after it (or before it), else to Add credits. */
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
  return (
    <SettingsGroup id="plan" title="Plan and credits">
      <SettingsPanel>
        <SettingRow className="is-left" label="Notes left" help="Calls without notes are free." control={<span className="set-left">{hoursAndMinutes(credits.balance / credits.perMinute)}</span>}>
          <SunLine share={credits.balance / Math.max(1, credits.granted)} />
        </SettingRow>
        <SettingRow label="Used this month" control={<SettingFact title="Since 00:00 UTC on the 1st">{credits.usedThisMonth > 0 ? hoursAndMinutes(credits.usedThisMonth / credits.perMinute) : 'None yet'}</SettingFact>} />
        {routes.data !== undefined && (
          <SettingRow label="Add credits" help="Pay with USDC from any wallet or exchange."
            control={<Button ref={add} variant="secondary" size="sm" icon="plus" onClick={() => show(null)}>Add credits</Button>} />
        )}
        {open.map((t) => (
          <SettingRow key={t.id} data-top-up={t.id} mark={<CryptoMark name={t.route.chain} />}
            label={`${t.asked.amount} ${routeName(t.route)} → ${t.asked.credits.toLocaleString('en-GB')} credits`} help={topUpLine(t)}
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
      <AddCreditsSheet open={sheet.open} topUpId={sheet.topUpId} onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))} />
    </SettingsGroup>
  );
}
