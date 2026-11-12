/*
 * Plans (docs: Plans and usage): which plan each account is on, the USD balance it buys plans with, the months of Pro
 * bought from it, what its owner is told about them, and when upkeep next has something to do for it. Sealed under
 * Kservice's accounting key, never under owner keys: the row says only whose it is and when it's due. An account's row is
 * made when it signs up, or the first time it's touched after the release that brought plans (on Free, with time to get
 * within Free's limits if it's over them).
 */
import { PlanNoticeKindSchema, type BalanceEntry, type PlanKind, type PlanNoticeKind, type PlanOffers } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../../context';
import { id128, openJson, sealJson, serviceKey, toJson, unb64u } from '../../crypto';
import { bytea, exec, maybeOne, rows, tx, type Db } from '../../db';
import { conflict, InternalError, invalid, notFound, PlanLimitError } from '../../errors';
import { limitsNow, WHOLE_DOWNLOAD_BYTES, type Limits } from '../../limits';
import { log } from '../../log';
import { settlePayers, usedBytes } from './storage';

const plog = log.child({ component: 'plans' });
/** How many changes to the balance are kept with it, to explain it. */
const HISTORY = 50;
/** How many of the plan's notices are kept with it, dismissed ones included. */
const NOTICES = 20;
/** How many accounts upkeep gives a row, and looks at, each time. */
const BATCH = 100;

const Entry = z.object({ id: z.string(), at: z.string(), label: z.string(), microUsd: z.number().int() });
/**
 * Limits held as they were while an account gets within its plan's (null: no limit then), until `until`: at the release
 * that brought plans, for an account already over Free's. The grace after Pro ends needs no record (`gracesOf`).
 */
const Grace = z.object({ until: z.string(), storageBytes: z.number().int().nullable() });
/** A month of Pro bought from the balance, and what was paid for it. */
const Month = z.object({ id: z.string(), from: z.string(), to: z.string(), microUsd: z.number().int() });
type Month = z.infer<typeof Month>;
const Notice = z.object({ id: z.string(), kind: PlanNoticeKindSchema, at: z.string(), until: z.string(), dismissed: z.boolean() });
export const PlanAccount = z.object({
  balanceMicroUsd: z.number().int(),
  history: z.array(Entry),
  /** Where Free's periods are counted from, unless Pro ended since. */
  freeFrom: z.string(),
  /** Whether the account hasn't been shown the plans to pick from yet. */
  choose: z.boolean(),
  grace: Grace.nullable(),
  /** Months of Pro bought, back to back, oldest first: those that haven't ended, and the latest one that has. */
  pro: z.array(Month).default([]),
  /** Whether upkeep buys a month from the balance as Pro is about to end. */
  renew: z.boolean().default(false),
  /** What the owner has been told about the plan, oldest first (the latest NOTICES). */
  notices: z.array(Notice).default([]),
  /** The end of Pro (its last month's `to`) whose reminder upkeep has done, and the one it has handled at the end. */
  reminded: z.string().nullable().default(null),
  ended: z.string().nullable().default(null)
});
export type PlanAccount = z.infer<typeof PlanAccount>;

type Service = Pick<Deps, 'cfg' | 'pool'>;
const key = (d: Pick<Deps, 'cfg'>) => serviceKey(unb64u(d.cfg.KSERVICE, 32), 'accounting');
const header = (ownerId: string) => ({ v: 1 as const, kind: 'plan-account', ownerId, keyVersion: '1' });
const seal = (d: Pick<Deps, 'cfg'>, ownerId: string, a: PlanAccount) => sealJson(key(d), header(ownerId), toJson(a));
const Row = z.object({ state_ciphertext: bytea });

/** An account's plan as it starts: Free from `freeFrom`, nothing bought. */
const fresh = (freeFrom: string, grace: PlanAccount['grace']): PlanAccount =>
  ({ balanceMicroUsd: 0, history: [], freeFrom, choose: true, grace, pro: [], renew: false, notices: [], reminded: null, ended: null });

/** What a plan brings: notes as minutes a period, storage and the largest file. */
export interface Allowance { notesMinutes: number; storageBytes: number; fileBytes: number }
export const freeAllowance = (l: Limits): Allowance =>
  ({ notesMinutes: l.get('plan.free.notes_minutes'), storageBytes: l.get('plan.free.storage_bytes'), fileBytes: l.get('plan.free.file_bytes') });
/** Pro's: the largest file is held to WHOLE_DOWNLOAD_BYTES, whatever its limit says, until downloads can resume. */
export const proAllowance = (l: Limits): Allowance =>
  ({ notesMinutes: l.get('plan.pro.notes_minutes'), storageBytes: l.get('plan.pro.storage_bytes'), fileBytes: Math.min(l.get('plan.pro.file_bytes'), WHOLE_DOWNLOAD_BYTES) });

/**
 * Pro's lower price a month for buying at least `fromMonths` at once (a year or more): none while that price is 0, isn't
 * below a month's, or is for more months than one purchase buys.
 */
export function yearlyOf(l: Limits): PlanOffers['pro']['yearly'] {
  const microUsdPerMonth = l.get('plan.pro.yearly_price_micro_usd');
  const fromMonths = l.get('plan.pro.yearly_from_months');
  const lower = microUsdPerMonth > 0 && microUsdPerMonth < l.get('plan.pro.price_micro_usd');
  return lower && fromMonths <= l.get('plan.pro_max_months') ? { fromMonths, microUsdPerMonth } : null;
}
/** What a month of Pro costs bought `months` at a time: the yearly price from its `fromMonths`, otherwise a month's. */
export function proPriceFor(l: Limits, months: number): number {
  const yearly = yearlyOf(l);
  return yearly && months >= yearly.fromMonths ? yearly.microUsdPerMonth : l.get('plan.pro.price_micro_usd');
}

/** The plan an account is on now, the period it's in and what the plan brings. */
export interface InForce extends Allowance { kind: PlanKind; from: number; to: number }

/** The month of Pro running at `now`, if one is. */
const runningAt = (a: PlanAccount, now: number): Month | undefined => a.pro.find((m) => Date.parse(m.from) <= now && now < Date.parse(m.to));
/** When the last month of Pro that has ended by `now` ended (null: none has). */
const lastEnded = (a: PlanAccount, now: number): number | null =>
  a.pro.reduce<number | null>((at, m) => { const to = Date.parse(m.to); return to <= now && (at === null || to > at) ? to : at; }, null);
/** When Pro ends: the last month bought's `to` (null: none bought). */
const proEnd = (a: PlanAccount): string | null => a.pro.at(-1)?.to ?? null;

/**
 * The plan in force at `now`: Pro while a month bought covers it, its period that month; otherwise Free, in periods counted
 * from `freeFrom` or the end of the last month of Pro, whichever is later, so Free starts afresh when Pro ends.
 */
export function inForce(a: PlanAccount, l: Limits, now = Date.now()): InForce {
  const month = runningAt(a, now);
  if (month) return { kind: 'pro', from: Date.parse(month.from), to: Date.parse(month.to), ...proAllowance(l) };
  const period = l.get('plan.period_seconds') * 1000;
  const start = Math.max(Date.parse(a.freeFrom), lastEnded(a, now) ?? -Infinity);
  const n = Math.max(0, Math.floor((now - start) / period));
  return { kind: 'free', from: start + n * period, to: start + (n + 1) * period, ...freeAllowance(l) };
}

/**
 * The graces running at `now`, on Free only (on Pro, Pro's limits alone apply): the release's, if the account has one,
 * and the one after Pro ends, `plan.grace_seconds` from the end of its last month, with Pro's storage.
 */
function gracesOf(a: PlanAccount, p: InForce, l: Limits, now: number): { until: number; storageBytes: number | null }[] {
  if (p.kind !== 'free') return [];
  const out: { until: number; storageBytes: number | null }[] = [];
  if (a.grace && Date.parse(a.grace.until) > now) out.push({ until: Date.parse(a.grace.until), storageBytes: a.grace.storageBytes });
  const ended = lastEnded(a, now);
  const after = ended === null ? null : ended + l.get('plan.grace_seconds') * 1000;
  if (after !== null && after > now) out.push({ until: after, storageBytes: proAllowance(l).storageBytes });
  return out;
}

/** The limits an account is held to now: its plan's, or, during a grace, the most of those and the graces' (null: none). */
export function heldTo(a: PlanAccount, p: InForce, l: Limits, now = Date.now()): { storageBytes: number | null } {
  const more = (x: number | null, y: number | null) => (x === null || y === null ? null : Math.max(x, y));
  return { storageBytes: gracesOf(a, p, l, now).reduce<number | null>((n, g) => more(n, g.storageBytes), p.storageBytes) };
}

/** When the grace running at `now` ends, the later of two (null: none is). */
export const graceUntil = (a: PlanAccount, p: InForce, l: Limits, now = Date.now()): number | null =>
  gracesOf(a, p, l, now).reduce<number | null>((n, g) => (n === null || g.until > n ? g.until : n), null);

/**
 * When Pro's end is told: `plan.pro_remind_seconds` before it, but never before its last month starts, so a month bought
 * at the reminder is never due a reminder of its own at once, however the limits are set.
 */
const remindAt = (a: PlanAccount, l: Limits, end: string): number =>
  Math.max(Date.parse(end) - l.get('plan.pro_remind_seconds') * 1000, Date.parse(a.pro.at(-1)?.from ?? end));

/** When upkeep should next look at an account: its grace ending, Pro's end to be told, or Pro's end to be handled. */
function dueAt(a: PlanAccount, l: Limits): Date | null {
  const at: number[] = [];
  if (a.grace) at.push(Date.parse(a.grace.until));
  const end = proEnd(a);
  if (end !== null && a.ended !== end) {
    at.push(Date.parse(end));
    if (a.reminded !== end) at.push(remindAt(a, l, end));
  }
  return at.length ? new Date(Math.min(...at)) : null;
}

/** A new account's plan, in the sign-up transaction: Free from now, with the plans to pick from shown first. */
export async function open(d: Pick<Deps, 'cfg'>, db: Db, ownerId: string): Promise<void> {
  await exec(db, 'INSERT INTO plan_accounts (owner_id, state_ciphertext, due_at) VALUES ($1,$2,NULL)', [ownerId, seal(d, ownerId, fresh(new Date().toISOString(), null))]);
}

/**
 * The row for an account from before plans, on Free from now. If it's already over Free's limits it keeps working as it
 * did for the grace period: no limit on storage until then. Nothing happens if another request made
 * the row first.
 */
async function carryOver(d: Service, db: Db, ownerId: string): Promise<void> {
  const l = await limitsNow(d, db);
  const now = Date.now();
  const over = (await usedBytes(db, ownerId)) > l.get('plan.free.storage_bytes');
  const grace = over ? { until: new Date(now + l.get('plan.grace_seconds') * 1000).toISOString(), storageBytes: null } : null;
  const a = fresh(new Date(now).toISOString(), grace);
  const made = await exec(db, 'INSERT INTO plan_accounts (owner_id, state_ciphertext, due_at) VALUES ($1,$2,$3) ON CONFLICT (owner_id) DO NOTHING', [ownerId, seal(d, ownerId, a), dueAt(a, l)]);
  if (made) plog.info('plan account carried over', { ownerId, grace: over });
}

/** An account's plan, made first if it has none yet. `lock` holds its row for the rest of the caller's transaction. */
export async function accountOf(d: Service, db: Db, ownerId: string, lock = false): Promise<PlanAccount> {
  const read = () => maybeOne(db, Row, `SELECT state_ciphertext FROM plan_accounts WHERE owner_id = $1${lock ? ' FOR UPDATE' : ''}`, [ownerId]);
  let r = await read();
  if (!r) {
    await carryOver(d, db, ownerId);
    r = await read();
  }
  if (!r) throw new InternalError('A plan account was made and isn’t there.', { context: { ownerId } });
  return openJson(key(d), header(ownerId), r.state_ciphertext, PlanAccount);
}

/** Saves an account's plan, in the caller's transaction, which holds its row. */
export async function save(d: Service, db: Db, ownerId: string, a: PlanAccount): Promise<void> {
  const l = await limitsNow(d, db);
  await exec(db, 'UPDATE plan_accounts SET state_ciphertext = $2, due_at = $3, version = version + 1 WHERE owner_id = $1', [ownerId, seal(d, ownerId, a), dueAt(a, l)]);
}

/** A change to the balance, with what it was for, kept with it (the latest HISTORY). */
const withEntry = (a: PlanAccount, microUsd: number, label: string): PlanAccount =>
  ({ ...a, balanceMicroUsd: a.balanceMicroUsd + microUsd, history: [...a.history, { id: id128(), at: new Date().toISOString(), label, microUsd }].slice(-HISTORY) });
/** Something the owner is told (the latest NOTICES are kept). */
const withNotice = (a: PlanAccount, kind: PlanNoticeKind, until: string, now: number): PlanAccount =>
  ({ ...a, notices: [...a.notices, { id: id128(), kind, at: new Date(now).toISOString(), until, dismissed: false }].slice(-NOTICES) });
/** Months that ended before the latest one that has go: nothing reads them. */
function pruned(a: PlanAccount, now: number): PlanAccount {
  const ended = lastEnded(a, now);
  return { ...a, pro: a.pro.filter((m) => Date.parse(m.to) > now || Date.parse(m.to) === ended) };
}
/**
 * `months` of Pro at `microUsd` each, back to back after the last one bought that hasn't ended at `from`, or from `from`.
 * A month is `plan.period_seconds` long.
 */
function withMonths(a: PlanAccount, l: Limits, months: number, microUsd: number, from: number): PlanAccount {
  const period = l.get('plan.period_seconds') * 1000;
  const end = proEnd(a);
  const start = end !== null && Date.parse(end) > from ? Date.parse(end) : from;
  const bought = Array.from({ length: months }, (_, i): Month => ({
    id: id128(), from: new Date(start + i * period).toISOString(), to: new Date(start + (i + 1) * period).toISOString(), microUsd
  }));
  return { ...a, pro: [...a.pro, ...bought] };
}
const monthsOf = (n: number) => `${n} ${n === 1 ? 'month' : 'months'}`;
/** Dollars as someone reads them: whole dollars bare, otherwise to the cent below. */
const dollars = (microUsd: number) => {
  const cents = Math.floor(microUsd / 10_000);
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
};

/** Adds money to the balance, in the caller's transaction, with the account's row locked. */
export async function credit(d: Service, db: Db, ownerId: string, microUsd: number, label: string): Promise<void> {
  const a = await accountOf(d, db, ownerId, true);
  await save(d, db, ownerId, withEntry(a, microUsd, label));
}

/** The balance's history as its owner sees it, newest first. */
export const historyOf = (a: PlanAccount): BalanceEntry[] => [...a.history].reverse().map((e) => ({ id: e.id, at: e.at, label: e.label, microUsd: e.microUsd }));

/** Months of Pro as their owner sees them: those that haven't ended, oldest first, and when the last ends. */
export function proOf(a: PlanAccount, now = Date.now()) {
  const months = a.pro.filter((m) => Date.parse(m.to) > now);
  return {
    months: months.map((m) => ({ from: m.from, to: m.to, microUsd: m.microUsd })),
    until: months.at(-1)?.to ?? null,
    renew: a.renew,
    refundableMicroUsd: months.filter((m) => Date.parse(m.from) > now).reduce((n, m) => n + m.microUsd, 0)
  };
}
/** The notices not dismissed, newest first. */
export const noticesOf = (a: PlanAccount) =>
  a.notices.filter((n) => !n.dismissed).reverse().map((n) => ({ id: n.id, kind: n.kind, at: n.at, until: n.until }));

/** Whether storing `adding` more bytes keeps an account within what it's held to. */
export async function mayStore(d: Service, db: Db, payerId: string, adding: number): Promise<boolean> {
  const a = await accountOf(d, db, payerId);
  const l = await limitsNow(d, db);
  const held = heldTo(a, inForce(a, l), l);
  return held.storageBytes === null || (await usedBytes(db, payerId)) + adding <= held.storageBytes;
}

/** Refuses storing `adding` more bytes for an account that it has no room for. */
export async function requireRoom(d: Service, db: Db, payerId: string, adding: number, context: Record<string, string | number>): Promise<void> {
  if (await mayStore(d, db, payerId, adding)) return;
  throw new PlanLimitError('Your storage is full. Delete something, or move to a plan with more room.', 'storage', { context: { ...context, ownerId: payerId } });
}

/** What an account may store now, its plan's or its grace's (null: no limit). */
export async function storageLimitOf(d: Service, db: Db, ownerId: string): Promise<number | null> {
  const a = await accountOf(d, db, ownerId);
  const l = await limitsNow(d, db);
  return heldTo(a, inForce(a, l), l).storageBytes;
}

/** The largest file an account's plan takes. */
export async function fileBytesFor(d: Service, db: Db, payerId: string): Promise<number> {
  const a = await accountOf(d, db, payerId);
  return inForce(a, await limitsNow(d, db)).fileBytes;
}

/** Changes an account's plan in a transaction of its own, with its row locked. */
async function changing(d: Service, ownerId: string, change: (a: PlanAccount, l: Limits, now: number) => PlanAccount): Promise<void> {
  await tx(d.pool, async (c) => {
    const a = await accountOf(d, c, ownerId, true);
    const l = await limitsNow(d, c);
    await save(d, c, ownerId, change(a, l, Date.now()));
  });
}

/**
 * Buys `months` of Pro from the balance at `microUsdPerMonth`, the price its buyer was shown for that many months (the
 * yearly price from its `fromMonths`), after any already bought (on Free, from now). Each month keeps what was paid for
 * it, which is what a refund gives back. Under the row's lock, so buys at once on any instance never spend the same money
 * twice. Buying ends any grace: only Pro's limits apply from now.
 */
export async function buyPro(d: Service, ownerId: string, months: number, microUsdPerMonth: number): Promise<void> {
  await changing(d, ownerId, (a, l, now) => {
    const max = l.get('plan.pro_max_months');
    if (months > max) throw invalid(`Buy 1 to ${max} months at a time.`, { ownerId, months, max });
    const price = proPriceFor(l, months);
    if (microUsdPerMonth !== price) throw conflict('The price of Pro has changed. Look at it again before buying.', { ownerId, why: 'price', months });
    const total = months * price;
    if (a.balanceMicroUsd < total) {
      throw conflict(`Your balance is short: ${monthsOf(months)} of Pro ${months === 1 ? 'costs' : 'cost'} ${dollars(total)} and your balance is ${dollars(a.balanceMicroUsd)}. Add money first.`, { ownerId, why: 'balance', months });
    }
    const bought = withEntry(withMonths(pruned(a, now), l, months, price, now), -total, `Pro, ${monthsOf(months)}`);
    plog.info('pro bought', { ownerId, months, microUsd: total });
    return { ...bought, grace: null };
  });
}

/** Refunds every month of Pro that hasn't started, at what was paid for it. A month that has started isn't refunded. */
export async function refundPro(d: Service, ownerId: string): Promise<void> {
  await changing(d, ownerId, (a, _l, now) => {
    const later = a.pro.filter((m) => Date.parse(m.from) > now);
    if (!later.length) throw conflict('There’s no month of Pro to refund that hasn’t started. A month that has started isn’t refunded.', { ownerId });
    const microUsd = later.reduce((n, m) => n + m.microUsd, 0);
    plog.info('pro refunded', { ownerId, months: later.length, microUsd });
    return withEntry({ ...a, pro: a.pro.filter((m) => !later.includes(m)) }, microUsd, `Pro refunded, ${monthsOf(later.length)}`);
  });
}

/** Turns buying a month as Pro is about to end on or off. */
export async function setRenew(d: Service, ownerId: string, renew: boolean): Promise<void> {
  await changing(d, ownerId, (a) => {
    plog.info('pro renewing set', { ownerId, renew });
    return { ...a, renew };
  });
}

/** Stops showing one of the plan's notices. */
export async function dismissNotice(d: Service, ownerId: string, noticeId: string): Promise<void> {
  await changing(d, ownerId, (a) => {
    if (!a.notices.some((n) => n.id === noticeId)) throw notFound('That notice', { ownerId });
    return { ...a, notices: a.notices.map((n) => (n.id === noticeId ? { ...n, dismissed: true } : n)) };
  });
}

/**
 * What upkeep does for one account that's due at `now`: ends a grace that's over; at the reminder before Pro ends, buys a
 * month if renewing is on and the balance has it, else tells its owner Pro is ending; at the end, buys a month the same
 * way (renewing turned on, or money added, since), else tells them Pro has ended. Each happens once for each end.
 */
function kept(a: PlanAccount, l: Limits, now: number, ownerId: string): PlanAccount {
  let next = a;
  if (next.grace && Date.parse(next.grace.until) <= now) {
    next = { ...next, grace: null };
    plog.info('grace ended', { ownerId });
  }
  const end = proEnd(next);
  if (end === null || next.ended === end) return pruned(next, now);
  const atEnd = Date.parse(end) <= now;
  if (!atEnd && (next.reminded === end || remindAt(next, l, end) > now)) return pruned(next, now);
  const price = l.get('plan.pro.price_micro_usd');
  const marked = atEnd ? { ...next, reminded: end, ended: end } : { ...next, reminded: end };
  if (next.renew && next.balanceMicroUsd >= price) {
    const renewed = withEntry(withMonths(marked, l, 1, price, Date.parse(end)), -price, 'Pro, renewed for a month');
    plog.info('pro renewed', { ownerId });
    return pruned(withNotice(renewed, 'pro-renewed', proEnd(renewed) ?? end, now), now);
  }
  plog.info(atEnd ? 'pro ended' : 'pro ending', { ownerId });
  return pruned(withNotice(marked, atEnd ? 'pro-ended' : 'pro-ending', end, now), now);
}

/**
 * Upkeep for plans, each part on its own: settles who pays for workspaces nobody does, gives every account from before
 * plans its row (so a grace runs out even for someone who never comes back), and looks at every account that's due: graces
 * ending, Pro about to end and Pro ending (`kept`). Returns how many accounts it settled, gave a row and looked at.
 */
export async function upkeep(d: Service): Promise<{ settled: number; carried: number; due: number }> {
  const settled = await settlePayers(d.pool);
  const missing = await rows(d.pool, z.object({ owner_id: z.string() }), `
    SELECT DISTINCT i.owner_id FROM identities i WHERE NOT EXISTS (SELECT 1 FROM plan_accounts p WHERE p.owner_id = i.owner_id) LIMIT $1`, [BATCH]);
  for (const m of missing) await tx(d.pool, (c) => carryOver(d, c, m.owner_id));
  let due = 0;
  for (;;) {
    const one = await tx(d.pool, async (c) => {
      const r = await maybeOne(c, z.object({ owner_id: z.string(), state_ciphertext: bytea }),
        'SELECT owner_id, state_ciphertext FROM plan_accounts WHERE due_at <= now() ORDER BY due_at LIMIT 1 FOR UPDATE SKIP LOCKED');
      if (!r) return false;
      const a = openJson(key(d), header(r.owner_id), r.state_ciphertext, PlanAccount);
      await save(d, c, r.owner_id, kept(a, await limitsNow(d, c), Date.now(), r.owner_id));
      return true;
    });
    if (!one) break;
    if (++due >= BATCH) break;
  }
  return { settled, carried: missing.length, due };
}
