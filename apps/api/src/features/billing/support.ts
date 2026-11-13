/*
 * What support does for an account's plan (docs: Plans and usage › Support), from `pnpm billing` (billing-cli.ts): say where
 * it stands, and add dollars to its balance, such as what a failed top-up or a stray payment brought the treasury. An account
 * is named by a top-up's reference (its deposit ID, which the person gives support) or by its ID. Only where KMASTER is set,
 * which is locally, an address finds it, as sign-in finds one (a blind index), so no address is stored, logged or typed into
 * production's job. What this says goes to Cloud Logging when it runs as that job, so it says only what a log may hold: the
 * plan, whether it renews, counts, and whether the balance covers a month of Pro; never an amount, a history or an address.
 */
import { TopUpStateSchema, type TopUpState } from '@alcove/api';
import { z } from 'zod';
import type { Config } from '../../config';
import { blindIndex, deriveIndexKey, unb64u } from '../../crypto';
import { maybeOne, rows, tx, type Db } from '../../db';
import { conflict, NotFoundError, ValidationError } from '../../errors';
import { limitsNow } from '../../limits';
import { log } from '../../log';
import { closedBySupport } from './deposits';
import { credit, planNow, type Accounting } from './plans';

const slog = log.child({ component: 'billing-support' });
/** What support reads: what plans do, and KMASTER where it's set (locally), to find an account by an address. */
export type Support = Accounting & { cfg: Partial<Pick<Config, 'KMASTER'>> };
/** The account a support command is about, and the top-up it was named by, if it was. */
export interface Named { ownerId: string; depositId: string | null }

/** A top-up's reference: an ID of 22 characters of base64url. */
const REFERENCE = /^[A-Za-z0-9_-]{22}$/;
/** An account's ID: 43 characters of base64url. */
const ACCOUNT = /^[A-Za-z0-9_-]{43}$/;

/**
 * The account signed in with `email`, found by its blind index under `indexKey` as sign-in finds it. Refused when there's none,
 * or more than one (signed in with different providers).
 */
async function accountByEmail(db: Db, indexKey: Uint8Array, email: string): Promise<string> {
  const index = blindIndex(indexKey, 'email', email.trim().toLowerCase());
  const found = await rows(db, z.object({ owner_id: z.string() }), 'SELECT DISTINCT owner_id FROM identities WHERE email_index = $1', [index]);
  const [one, ...more] = found;
  if (!one) throw new NotFoundError('No account has signed in with that address.');
  if (more.length) throw conflict(`${found.length} accounts signed in with that address. Nothing was done.`, { accounts: found.length });
  return one.owner_id;
}

/**
 * The account `who` names, as support types it: a top-up's reference, an account's ID, or, where KMASTER is set, an address it
 * signs in with. Anything else, or nothing there, is refused. Nothing typed is said back.
 */
export async function named(d: Support, who: string): Promise<Named> {
  const typed = who.trim();
  if (REFERENCE.test(typed)) {
    const found = await rows(d.pool, z.object({ owner_id: z.string() }), 'SELECT owner_id FROM deposits WHERE deposit_id = $1', [typed]);
    const [one, ...more] = found;
    if (!one) throw new NotFoundError('No top-up has that reference.');
    if (more.length) throw conflict('More than one account has a top-up with that reference. Nothing was done.', { accounts: found.length });
    return { ownerId: one.owner_id, depositId: typed };
  }
  if (ACCOUNT.test(typed)) {
    if (!(await maybeOne(d.pool, z.object({ owner_id: z.string() }), 'SELECT owner_id FROM owners WHERE owner_id = $1', [typed]))) throw new NotFoundError('No account has that ID.');
    return { ownerId: typed, depositId: null };
  }
  if (!typed.includes('@')) throw new ValidationError('Name the account by a top-up’s reference or by its ID.');
  if (d.cfg.KMASTER === undefined) throw new ValidationError('An address finds an account only where KMASTER is set, as it is locally. Name it by a top-up’s reference or by its ID.');
  // The key the blind indexes are keyed by, as the API derives it from KMASTER outside a TEE (crypto.ts deriveIndexKey).
  const indexKey = deriveIndexKey(unb64u(d.cfg.KMASTER, 32));
  try { return { ownerId: await accountByEmail(d.pool, indexKey, typed), depositId: null }; } finally { indexKey.fill(0); }
}

/**
 * Adds `microUsd` to the balance of the account `who` names, as "Added by support", in one transaction. Named by a top-up's
 * reference, it's that top-up's money, added in its place: it stops adding itself, even by a check already on its way to
 * 1Click, and one Alcove still watches, or added already, is refused with nothing added (`closedBySupport`), so a top-up's
 * money is added once. Named by the account's ID, it's money of its own. Says which account, and the top-up's state now.
 */
export async function creditBySupport(d: Support, who: string, microUsd: number): Promise<Named & { state: TopUpState | null }> {
  const n = await named(d, who);
  const state = await tx(d.pool, async (c) => {
    const was = n.depositId === null ? null : await closedBySupport(c, n.ownerId, n.depositId);
    await credit(d, c, n.ownerId, microUsd, 'Added by support');
    return was;
  });
  slog.info('balance added by support', { ownerId: n.ownerId, depositId: n.depositId });
  return { ...n, state };
}

const TopUps = z.object({ state: TopUpStateSchema, n: z.number().int() });
/**
 * Where an account's plan stands, as lines a log may hold: the account, the top-up it was named by, its plan and whether
 * Pro renews, how many months of Pro aren't over, whether the balance covers a month of Pro at its price now, how many
 * changes to the balance are kept, how many notices wait, and how many top-ups it has in each state. Nothing else about the
 * person: no amount, no history, no date and no address.
 */
export async function standingOf(d: Accounting, n: Named): Promise<string[]> {
  const now = Date.now();
  const l = await limitsNow(d);
  const { a, p } = await planNow(d, d.pool, n.ownerId, now);
  const topUps = await rows(d.pool, TopUps, 'SELECT state, count(*)::int AS n FROM deposits WHERE owner_id = $1 GROUP BY state ORDER BY state', [n.ownerId]);
  const topUp = n.depositId === null ? null : await maybeOne(d.pool, z.object({ state: TopUpStateSchema }), 'SELECT state FROM deposits WHERE owner_id = $1 AND deposit_id = $2', [n.ownerId, n.depositId]);
  return [
    `Account ${n.ownerId}`,
    ...(topUp && n.depositId !== null ? [`Top-up ${n.depositId}: ${topUp.state}`] : []),
    `Plan: ${p.kind}; renewing Pro ${a.renew ? 'on' : 'off'}`,
    `Months of Pro not over: ${a.pro.filter((m) => Date.parse(m.to) > now).length}`,
    `Balance: ${a.balanceMicroUsd >= l.get('plan.pro.price_micro_usd') ? 'covers' : 'doesn’t cover'} a month of Pro`,
    `Changes to the balance kept: ${a.history.length}`,
    `Notices not dismissed: ${a.notices.filter((x) => !x.dismissed).length}`,
    `Top-ups: ${topUps.length ? topUps.map((t) => `${t.n} ${t.state}`).join(', ') : 'none'}`
  ];
}
