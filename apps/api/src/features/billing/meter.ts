/*
 * The AI allowance (docs: Plans and usage › Notes): what each account's plan brings for its period, in nano-USD, and
 * what's been spent of it, sealed under Kservice's accounting key with nothing but whose it is in the clear. Every
 * request to NEAR AI is paid from one (inference.ts takes a Meter, so none goes out without a payer): before it's sent,
 * the most it could cost is held, and refused if that would take the allowance below `ai.stop_micro_usd`; once it's
 * answered, what it used is charged at the price NEAR AI lists for its model (features/notes/models.ts), or at
 * `ai.fallback_*` for a model it doesn't price.
 *
 * A call's notes are written once it's over, so while it's live each transcript clip also holds what writing them will
 * cost (`reserveNano`, reckoned by features/notes/drafting.ts): the allowance runs down with the call, notes stop before
 * it's spent rather than after, and the organizer is told when about `ai.warn_seconds` of notes are left at the call's own
 * pace. Writing those notes is never refused, and is the one way past an allowance: what it costs over is Alcove's.
 *
 * Every change is made under the meter's row lock, so requests at once on any instance can't spend the same money
 * twice. A new period starts the first time a meter is touched after its period ends, or after its plan changes:
 * what was left doesn't carry over.
 */
import { PlanKindSchema, type PlanKind } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../../context';
import { id128, openJson, sealJson, serviceKey, toJson, unb64u } from '../../crypto';
import { bytea, exec, maybeOne, tx, type Db } from '../../db';
import { PlanLimitError } from '../../errors';
import type { Meter, Metered, Most, Usage } from '../../inference';
import { limitsNow, type Limits } from '../../limits';
import { log } from '../../log';
import { priceOf, type Price } from '../notes/models';
import { accountOf, inForce, mayStore, type InForce } from './plans';

const alog = log.child({ component: 'ai-allowance' });
/** A source (a call or room recording) nothing has charged for this long is over, and what it held goes. */
const SOURCE_GONE_MS = 24 * 3_600_000;
/** How long a request may take before what it held is charged in full, as if it was answered and lost. */
const HOLD_MS = 5 * 60_000;

/** What a request is for, kept by kind with the allowance, so where it went can be explained. */
export type Spend = 'transcript' | 'notes' | 'live-notes' | 'ideas' | 'captions' | 'catch-up' | 'ask' | 'series' | 'documents';
/** What a call or room recording's charges belong to, so what writing its notes will cost is held while it runs. */
export interface Source { kind: 'call' | 'recording'; id: string }
/** Who pays for a request, and what for. */
export interface Bill {
  payer: string;
  spend: Spend;
  source?: Source | undefined;
  /** What writing the source's notes will cost, reckoned now in tokens of `model`: held from the allowance while it runs. */
  reserve?: { model: string; most: Most } | undefined;
  /** Writing a source's notes once it's over: never refused, the one way past an allowance. */
  final?: boolean | undefined;
}
/** What a charge to a source came to: fine, notes about to run out at its pace (once), or the allowance spent. */
export type Outcome = 'ok' | 'warn' | 'stop';

const nano = z.number().int();
const SourceState = z.object({
  kind: z.enum(['call', 'recording']), id: z.string(), since: z.number(), touched: z.number(),
  spentNano: nano, reserveNano: nano, warned: z.boolean()
});
const Hold = z.object({ id: z.string(), nano, until: z.number() });
const MeterState = z.object({
  plan: PlanKindSchema, from: z.number(), to: z.number(),
  allowanceNano: nano, spentNano: nano,
  byKind: z.record(z.string(), nano),
  holds: z.array(Hold), sources: z.array(SourceState),
  /** When the allowance was spent this period: nothing more until the next. */
  stoppedAt: z.number().nullable()
});
type MeterState = z.infer<typeof MeterState>;

type Service = Pick<Deps, 'cfg' | 'pool'>;
const key = (d: Pick<Deps, 'cfg'>) => serviceKey(unb64u(d.cfg.KSERVICE, 32), 'accounting');
const header = (ownerId: string) => ({ v: 1 as const, kind: 'ai-meter', ownerId, keyVersion: '1' });

/** What a plan's minutes of notes are worth, in nano-USD. */
const allowanceOf = (p: InForce, l: Limits) => Math.round((p.notesMinutes * l.get('ai.hour_micro_usd') * 1000) / 60);
/** What's left to spend: the allowance, less what's spent and what requests in flight and live sources hold. */
const leftOf = (m: MeterState) => m.allowanceNano - m.spentNano - m.holds.reduce((n, h) => n + h.nano, 0) - m.sources.reduce((n, s) => n + s.reserveNano, 0);

/** A model's price, or the fallback's for one NEAR AI doesn't price. */
async function priced(d: Service, l: Limits, model: string): Promise<Price> {
  const p = await priceOf(d.cfg, model);
  if (p) return p;
  alog.warn('model not priced; charged at the fallback', { model });
  return { input: l.get('ai.fallback_input_micro_usd'), cached: l.get('ai.fallback_input_micro_usd'), output: l.get('ai.fallback_output_micro_usd') };
}
/** What `u` costs at `p`, in nano-USD, rounded up. */
const costOf = (p: Price, u: Usage) => Math.ceil((Math.max(0, u.input - u.cached) * p.input + u.cached * p.cached + u.output * p.output) / 1000);
/** The most `most` can use, as tokens: images at `ai.image_tokens` each. */
const usageOf = (most: Most, l: Limits): Usage => ({ input: most.input + most.images * l.get('ai.image_tokens'), cached: 0, output: most.output });

/**
 * The meter, locked for the rest of the caller's transaction, in its current period: made on the account's first
 * request, and started again when its period is over or its plan changed. Holds left past their time are charged in
 * full (whatever held them never said), and sources nothing has charged for in a day go.
 */
async function locked(d: Service, db: Db, ownerId: string, l: Limits, now: number): Promise<{ m: MeterState; save: (m: MeterState) => Promise<void> }> {
  const p = inForce(await accountOf(d, db, ownerId), l, now);
  const fresh = (carried: Pick<MeterState, 'holds' | 'sources'>): MeterState => ({
    plan: p.kind, from: p.from, to: p.to, allowanceNano: allowanceOf(p, l), spentNano: 0, byKind: {}, ...carried, stoppedAt: null
  });
  const seal = (m: MeterState) => sealJson(key(d), header(ownerId), toJson(m));
  await exec(db, 'INSERT INTO ai_meters (owner_id, state_ciphertext) VALUES ($1,$2) ON CONFLICT (owner_id) DO NOTHING', [ownerId, seal(fresh({ holds: [], sources: [] }))]);
  const r = await maybeOne(db, z.object({ state_ciphertext: bytea }), 'SELECT state_ciphertext FROM ai_meters WHERE owner_id = $1 FOR UPDATE', [ownerId]);
  if (!r) throw new PlanLimitError('Notes aren’t available for this account.', 'notes', { context: { ownerId, why: 'no meter' } });
  let m = openJson(key(d), header(ownerId), r.state_ciphertext, MeterState);
  const lost = m.holds.filter((h) => h.until <= now);
  if (lost.length) {
    m = { ...m, spentNano: m.spentNano + lost.reduce((n, h) => n + h.nano, 0), holds: m.holds.filter((h) => h.until > now) };
    alog.warn('requests never said what they used; charged what they held', { ownerId, requests: lost.length });
  }
  m = { ...m, sources: m.sources.filter((s) => now - s.touched < SOURCE_GONE_MS) };
  if (m.from !== p.from || m.plan !== p.kind) {
    if (m.spentNano > 0 || m.stoppedAt !== null) alog.info('ai period closed', { ownerId, plan: m.plan, spentNano: m.spentNano, allowanceNano: m.allowanceNano, overNano: Math.max(0, m.spentNano - m.allowanceNano), byKind: m.byKind });
    m = fresh({ holds: m.holds, sources: m.sources });
  }
  return { m, save: async (next) => { await exec(db, 'UPDATE ai_meters SET state_ciphertext = $2, version = version + 1 WHERE owner_id = $1', [ownerId, seal(next)]); } };
}

/** Runs `change` on the meter in its own transaction, under its lock. */
async function changing<T>(d: Service, ownerId: string, change: (m: MeterState, l: Limits, now: number) => { m: MeterState; result: T }): Promise<T> {
  const l = await limitsNow(d);
  return tx(d.pool, async (c) => {
    const now = Date.now();
    const { m, save } = await locked(d, c, ownerId, l, now);
    const { m: next, result } = change(m, l, now);
    await save(next);
    return result;
  });
}

const refusal = (ownerId: string, bill: Bill) => new PlanLimitError('Your notes for this period have run out. They start again when your plan renews.', 'notes', { context: { ownerId, spend: bill.spend } });

/** The meter `bill` pays with, and what the last charge to its source came to. */
export function meterFor(d: Service, bill: Bill): Meter & { outcome(): Outcome } {
  let last: Outcome = 'ok';
  return {
    outcome: () => last,
    async begin(model: string, most: Most): Promise<Metered> {
      const l = await limitsNow(d);
      const price = await priced(d, l, model);
      const reserve = bill.reserve ? costOf(await priced(d, l, bill.reserve.model), usageOf(bill.reserve.most, l)) : undefined;
      const heldNano = costOf(price, usageOf(most, l));
      const holdId = id128();
      const stop = l.get('ai.stop_micro_usd') * 1000;
      const held = await changing(d, bill.payer, (m, _l, now): { m: MeterState; result: 'held' | 'refused' | 'stopped' } => {
        if (bill.final) return { m: { ...m, holds: [...m.holds, { id: holdId, nano: heldNano, until: now + HOLD_MS }] }, result: 'held' };
        if (m.stoppedAt !== null) return { m, result: 'stopped' };
        // Spent: nothing more this period. Only too little for this one request: it's refused, and smaller ones still go.
        if (leftOf(m) <= stop) {
          alog.info('ai allowance spent', { ownerId: bill.payer, plan: m.plan, spend: bill.spend, source: bill.source?.kind ?? null });
          return { m: { ...m, stoppedAt: now }, result: 'stopped' };
        }
        if (leftOf(m) - heldNano < stop) return { m, result: 'refused' };
        return { m: { ...m, holds: [...m.holds, { id: holdId, nano: heldNano, until: now + HOLD_MS }] }, result: 'held' };
      });
      if (held !== 'held') {
        if (held === 'stopped') last = 'stop';
        throw refusal(bill.payer, bill);
      }
      const settle = (cost: (m: MeterState) => number, what: string) => changing(d, bill.payer, (m, _l, now) => {
        const charged = cost(m);
        const s = bill.source;
        let sources = m.sources;
        if (s) {
          const had = sources.find((x) => x.kind === s.kind && x.id === s.id);
          const was = had ?? { ...s, since: now, touched: now, spentNano: 0, reserveNano: 0, warned: false };
          const next = { ...was, touched: now, spentNano: was.spentNano + charged, reserveNano: reserve ?? was.reserveNano };
          sources = [...sources.filter((x) => x !== had), next];
        }
        let next: MeterState = {
          ...m, spentNano: m.spentNano + charged, byKind: { ...m.byKind, [bill.spend]: (m.byKind[bill.spend] ?? 0) + charged },
          holds: m.holds.filter((h) => h.id !== holdId), sources
        };
        last = 'ok';
        if (next.stoppedAt === null && leftOf(next) <= stop) {
          next = { ...next, stoppedAt: now };
          last = 'stop';
          alog.info('ai allowance spent', { ownerId: bill.payer, plan: next.plan, spend: bill.spend, source: s?.kind ?? null });
        } else if (s && next.stoppedAt === null) {
          const mine = next.sources.find((x) => x.kind === s.kind && x.id === s.id);
          // This source's pace: what it has cost and will cost to write up, a second of it, since it began.
          const pace = mine ? (mine.spentNano + mine.reserveNano) / Math.max(60, (now - mine.since) / 1000) : 0;
          if (mine && !mine.warned && pace > 0 && (leftOf(next) - stop) / pace <= l.get('ai.warn_seconds')) {
            next = { ...next, sources: next.sources.map((x) => (x === mine ? { ...x, warned: true } : x)) };
            last = 'warn';
          }
        } else if (next.stoppedAt !== null) last = 'stop';
        if (charged > 0) alog.debug('ai charged', { ownerId: bill.payer, spend: bill.spend, model, how: what, costNano: charged, final: bill.final === true });
        return { m: next, result: undefined };
      });
      return {
        used: (u, reckoned) => settle(() => costOf(price, reckoned ? { ...u, input: u.input + most.images * l.get('ai.image_tokens') } : u), reckoned ? 'reckoned' : 'reported'),
        unsent: () => settle(() => 0, 'unsent'),
        lost: () => settle(() => heldNano, 'lost')
      };
    }
  };
}

/** Lets go of what a call or room recording held for writing its notes, once they're written (or given up on). */
export async function close(d: Service, payer: string, source: Source): Promise<void> {
  await changing(d, payer, (m) => ({ m: { ...m, sources: m.sources.filter((s) => !(s.kind === source.kind && s.id === source.id)) }, result: undefined }));
}

/** An account's allowance as it stands, without changing it: what's left, what a period brings, and whether it's spent. */
export interface Standing { leftNano: number; allowanceNano: number; stopped: boolean; plan: PlanKind; from: number; to: number }
export async function standing(d: Service, db: Db, ownerId: string): Promise<Standing> {
  const l = await limitsNow(d);
  const now = Date.now();
  const p = inForce(await accountOf(d, db, ownerId), l, now);
  const r = await maybeOne(db, z.object({ state_ciphertext: bytea }), 'SELECT state_ciphertext FROM ai_meters WHERE owner_id = $1', [ownerId]);
  const m = r ? openJson(key(d), header(ownerId), r.state_ciphertext, MeterState) : null;
  const allowanceNano = allowanceOf(p, l);
  // A period that's over, or a plan that changed, starts again the next time the meter's touched: it's shown so already.
  const current = m && m.from === p.from && m.plan === p.kind ? m : null;
  const live = current ? { ...current, holds: current.holds.filter((h) => h.until > now), sources: current.sources.filter((s) => now - s.touched < SOURCE_GONE_MS) } : null;
  const leftNano = live ? leftOf(live) : allowanceNano - (m?.sources.filter((s) => now - s.touched < SOURCE_GONE_MS).reduce((n, s) => n + s.reserveNano, 0) ?? 0);
  return { leftNano, allowanceNano, stopped: live ? live.stoppedAt !== null || leftNano <= l.get('ai.stop_micro_usd') * 1000 : false, plan: p.kind, from: p.from, to: p.to };
}

/** Minutes of notes `nano` is about worth, at what an hour of notes is reckoned at. */
export const minutesOf = (nanoUsd: number, l: Limits): number => Math.max(0, Math.floor((nanoUsd * 60) / (l.get('ai.hour_micro_usd') * 1000)));

/** Why notes can't be kept for an account now: its notes this period, or its storage, have run out. Null: they can. */
export async function notesBlocked(d: Service, db: Db, ownerId: string): Promise<'notes' | 'storage' | null> {
  if ((await standing(d, db, ownerId)).stopped) return 'notes';
  if (!(await mayStore(d, db, ownerId, 1))) return 'storage';
  return null;
}
