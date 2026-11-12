/*
 * The AI meter's sealed record (docs: Plans and usage › Notes): its shape, sealed under Kservice's accounting key with
 * nothing but whose it is in the clear, and the period it keeps, which Free's periods run on from (features/billing/plans.ts
 * › planAt). What it means, and every change to it, is features/billing/meter.ts.
 */
import { PlanKindSchema, type PlanKind } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../../context';
import { openJson, sealJson, serviceKey, toJson, unb64u } from '../../crypto';
import { bytea, maybeOne, type Db } from '../../db';

const nano = z.number().int();
/**
 * A call or room recording whose charges are kept together while it runs: what it has cost, what writing its notes will
 * cost at most (`reserveNano`, reckoned with each transcript clip), what writing them has been charged so far
 * (`drawnNano`: those charges come out of the reserve), and whether its organizer has been told it's about to run out.
 */
const SourceState = z.object({
  kind: z.enum(['call', 'recording']), id: z.string(), since: z.number(), touched: z.number(),
  spentNano: nano, reserveNano: nano, drawnNano: nano.default(0), warned: z.boolean()
});
/** What a request on its way holds until it's charged, and until when; `source`: the source whose notes it writes, whose reserve it's part of. */
const Hold = z.object({ id: z.string(), nano, until: z.number(), source: z.string().nullable().default(null) });
export const MeterState = z.object({
  plan: PlanKindSchema, from: z.number(), to: z.number(),
  allowanceNano: nano, spentNano: nano,
  byKind: z.record(z.string(), nano),
  holds: z.array(Hold), sources: z.array(SourceState),
  /** Sources whose notes were written lately (ms): a charge still on its way for one never holds for its notes again. */
  closed: z.array(z.object({ id: z.string(), at: z.number() })),
  /** When the allowance was spent this period: nothing more until the next. */
  stopped: z.object({ at: z.number(), allowanceNano: nano }).nullable()
});
export type MeterState = z.infer<typeof MeterState>;
export type SourceState = MeterState['sources'][number];
export type Hold = MeterState['holds'][number];

const key = (d: Pick<Deps, 'cfg'>) => serviceKey(unb64u(d.cfg.KSERVICE, 32), 'accounting');
const header = (ownerId: string) => ({ v: 1 as const, kind: 'ai-meter', ownerId, keyVersion: '1' });
export const sealMeter = (d: Pick<Deps, 'cfg'>, ownerId: string, m: MeterState): Uint8Array => sealJson(key(d), header(ownerId), toJson(m));
export const openMeter = (d: Pick<Deps, 'cfg'>, ownerId: string, sealed: Uint8Array): MeterState => openJson(key(d), header(ownerId), sealed, MeterState);
export const MeterRow = z.object({ state_ciphertext: bytea });

/**
 * The plan and period an account's meter keeps (ms), as they were when it was last touched: Free's periods run on from it,
 * each at the length in force when it begins, so a change to `plan.period_seconds` applies from each account's next period.
 */
export interface KeptPeriod { plan: PlanKind; from: number; to: number }
export const keptOf = (m: Pick<MeterState, 'plan' | 'from' | 'to'>): KeptPeriod => ({ plan: m.plan, from: m.from, to: m.to });

/** The period an account's meter keeps, read without holding it (null: it has no meter yet). */
export async function keptPeriodOf(d: Pick<Deps, 'cfg'>, db: Db, ownerId: string): Promise<KeptPeriod | null> {
  const r = await maybeOne(db, MeterRow, 'SELECT state_ciphertext FROM ai_meters WHERE owner_id = $1', [ownerId]);
  return r ? keptOf(openMeter(d, ownerId, r.state_ciphertext)) : null;
}
