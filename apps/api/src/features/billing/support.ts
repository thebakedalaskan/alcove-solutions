/*
 * What support does for an account's plan (docs: Plans and usage › Support), from `pnpm billing` (billing-cli.ts): say
 * where it stands, and add dollars to its balance, such as a stray payment that reached the treasury. The account is found
 * by its address as sign-in records it (a blind index under KMASTER), so the address itself is never stored or logged.
 */
import { z } from 'zod';
import type { Deps } from '../../context';
import { blindIndex, unb64u } from '../../crypto';
import { rows, tx } from '../../db';
import { conflict, NotFoundError } from '../../errors';
import { log } from '../../log';
import { planOf } from './plan-view';
import { credit } from './plans';

const slog = log.child({ component: 'billing-support' });
type Service = Pick<Deps, 'cfg' | 'pool'>;

/** The account signed in with `email`. Refused when there's none, or more than one (signed in with different providers). */
export async function accountByEmail(d: Service, email: string): Promise<string> {
  const index = blindIndex(unb64u(d.cfg.KMASTER, 32), 'email', email.trim().toLowerCase());
  const found = await rows(d.pool, z.object({ owner_id: z.string() }), 'SELECT DISTINCT owner_id FROM identities WHERE email_index = $1', [index]);
  const [one, ...more] = found;
  if (!one) throw new NotFoundError('No account has signed in with that address.');
  if (more.length) throw conflict(`${found.length} accounts signed in with that address. Nothing was done.`, { accounts: found.length });
  return one.owner_id;
}

/** Adds `microUsd` to the balance of the account signed in with `email`, labelled "Added by support". */
export async function creditByEmail(d: Service, email: string, microUsd: number): Promise<string> {
  const ownerId = await accountByEmail(d, email);
  await tx(d.pool, (c) => credit(d, c, ownerId, microUsd, 'Added by support'));
  slog.info('balance added by support', { ownerId, microUsd });
  return ownerId;
}

const usd = (microUsd: number) => `$${(microUsd / 1_000_000).toFixed(2)}`;
/** Where an account's plan stands, as lines to read: its plan, balance, months of Pro and notices. Nothing else about them. */
export async function standingOf(d: Service, ownerId: string): Promise<string[]> {
  const p = await planOf(d, ownerId);
  return [
    `Account ${ownerId}`,
    `Plan: ${p.kind}, period ${p.period.from} to ${p.period.to}; renewing ${p.pro.renew ? 'on' : 'off'}`,
    `Notes: about ${p.notes.minutesLeft} of ${p.notes.minutesPerPeriod} minutes left${p.notes.stopped ? ' (stopped)' : ''}`,
    `Storage: ${p.storage.usedBytes} of ${p.storage.limitBytes} bytes${p.grace ? `, in grace until ${p.grace.until}` : ''}${p.over.storage ? ', over' : ''}`,
    `Balance: ${usd(p.balance.microUsd)}`,
    ...p.balance.history.slice(0, 10).map((e) => `  ${e.at}  ${e.microUsd >= 0 ? '+' : '-'}${usd(Math.abs(e.microUsd))}  ${e.label}`),
    `Pro: ${p.pro.months.length ? `${p.pro.months.length} months to ${p.pro.until ?? ''}, ${usd(p.pro.refundableMicroUsd)} refundable` : 'none'}`,
    ...p.pro.months.map((m) => `  ${m.from} to ${m.to}  ${usd(m.microUsd)}`),
    `Notices:${p.notices.length ? '' : ' none'}`,
    ...p.notices.map((n) => `  ${n.at}  ${n.kind} (${n.until})`)
  ];
}
