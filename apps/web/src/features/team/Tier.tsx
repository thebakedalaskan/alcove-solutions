/*
 * What a free team's tier means, said once at the top of its water (the design's 4.7): everyone on it is on their own plan,
 * and upgrading gives everyone a license. Its admin's Upgrade is the page's one Upgrade, beside what it means, and opens
 * checkout on Team for it; while someone on it has asked them to (a plan notice, `upgrade-asked`), the note says who. Everyone
 * else can ask the admin to, who's told once (that notice) and at most once a week for each of them. That it's been asked is
 * kept in this browser for the week (`alcove.upgrade-asked.<ownerId>.<teamId>`, a time and nothing else), a convenience:
 * elsewhere, asking again changes nothing; signing out here forgets it. A team whose licenses have ended says that what it
 * shared opens again once it's upgraded.
 */
import { errorCode, errorMessage, type MyTeam } from '@alcove/api';
import { Button, TeamTierNote, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { accountQueries } from '~/features/account/queries';
import { useCheckout } from '~/features/plans/checkout';
import { askedBy, noticesNow, teamAdmin } from '~/features/plans/planState';
import { planQueries } from '~/features/plans/queries';
import { log } from '~/lib/log';
import { callName } from '~/lib/people';
import { joined } from '~/lib/words';
import { useAskToUpgrade } from './queries';

const tlog = log.child({ component: 'team' });
/** How long an ask holds: the admin isn't told again for a week. */
const WEEK_MS = 7 * 86_400_000;
const askedFor = (owner: string) => `alcove.upgrade-asked.${owner}.`;
const askedKey = (owner: string, team: string) => `${askedFor(owner)}${team}`;
/** When it was asked, in this tab, for a browser that keeps nothing. */
const askedHere = new Map<string, number>();

function askedLately(owner: string, team: string, now: number): boolean {
  const key = askedKey(owner, team);
  let at: number | undefined;
  try {
    const kept = localStorage.getItem(key);
    at = kept === null ? undefined : Date.parse(kept);
  } catch (e) {
    tlog.debug('the upgrade ask isn’t read from this browser', { err: e });
    at = askedHere.get(key);
  }
  return at !== undefined && !Number.isNaN(at) && now - at < WEEK_MS;
}
function keepAsked(owner: string, team: string, now: number): void {
  askedHere.set(askedKey(owner, team), now);
  try { localStorage.setItem(askedKey(owner, team), new Date(now).toISOString()); } catch (e) { tlog.debug('the upgrade ask isn’t kept in this browser', { err: e }); }
}
/** Forgets the asks made from this browser, for an account signing out or deleted here. */
export function forgetUpgradeAsked(owner: string): void {
  const prefix = askedFor(owner);
  for (const key of [...askedHere.keys()]) if (key.startsWith(prefix)) askedHere.delete(key);
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => k !== null && k.startsWith(prefix));
    for (const key of keys) localStorage.removeItem(key);
  } catch (e) { tlog.debug('the upgrade asks aren’t forgotten here', { err: e }); }
}

/** Whether the team has had licenses that have ended since: then what it shared is waiting for it. */
const hadTeam = (team: MyTeam): boolean => team.members.some((m) => m.license.state === 'ended');

/** `lead`: the admin's Upgrade is the page's one filled button (someone else is on the team, and nothing else asks). */
export function Tier({ team, lead }: { team: MyTeam; lead: boolean }) {
  const owner = useQuery(accountQueries.session()).data?.ownerId ?? null;
  const plan = useQuery(planQueries.plan()).data;
  const checkout = useCheckout();
  const ask = useAskToUpgrade();
  const toast = useToast();
  const [asked, setAsked] = useState(() => owner !== null && askedLately(owner, team.id, Date.now()));
  const admin = teamAdmin(team);
  const adminName = admin ? callName(admin) : 'the admin';
  const line = hadTeam(team)
    ? 'What it shared opens again when it’s upgraded.'
    : 'Upgrading gives everyone on it a license: the team’s notes and workspaces open to everyone, and storage is pooled.';
  if (team.role === 'admin') {
    /* Who's asked, by name from the team (the notice keeps only who by their member ID). */
    const askers = plan ? noticesNow(plan, team).filter((n) => n.kind === 'upgrade-asked').flatMap((n) => { const p = askedBy(n, team); return p ? [callName(p)] : []; }) : [];
    const who = [...new Set(askers)];
    return (
      <TeamTierNote title={who.length ? `${joined(who)} asked you to upgrade.` : `${team.name} is on Free.`} line={line}
        action={<Button variant={lead ? 'primary' : 'secondary'} size="sm" onClick={() => checkout.open({ plan: 'team' }, 'team')}>Upgrade</Button>} />
    );
  }
  return (
    <TeamTierNote title={`${team.name} is on Free.`} line={line}
      action={(
        <Button size="sm" loading={ask.isPending} onClick={() => ask.mutate(undefined, {
          onSuccess: () => { if (owner !== null) keepAsked(owner, team.id, Date.now()); setAsked(true); },
          onError: (e) => { tlog.info('upgrade not asked', { code: errorCode(e) }); toast(errorMessage(e), { icon: 'x' }); }
        })}>{`Ask ${adminName} to upgrade`}</Button>
      )}
      done={asked ? `${admin ? callName(admin) : 'The admin'}’s been asked` : undefined} />
  );
}
