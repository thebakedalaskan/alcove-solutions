/*
 * The AI allowance (docs: Plans and usage › Notes): what each account's plan brings for its period, in nano-USD, and
 * what's been spent of it, sealed under Kservice's accounting key with nothing but whose it is in the clear
 * (features/billing/meter-state.ts). Every request to NEAR AI is paid from one (inference.ts takes a Meter, so none goes
 * out without a payer): before it's sent, the most it could cost is held, and refused if that would take the allowance
 * below `ai.stop_micro_usd`; once it's answered, what it used is charged at the price NEAR AI lists for its model
 * (features/notes/models.ts), or at `ai.fallback_*` for a model it doesn't price.
 *
 * A call's notes are written once it's over, so while it's live each transcript clip also holds what writing them will
 * cost (`reserveNano`, reckoned by features/notes/drafting.ts): the allowance runs down with the call, notes stop before
 * it's spent rather than after, and the organizer is told when about `ai.warn_seconds` of notes are left at the call's own
 * pace. Writing those notes is never refused, and is the one way past an allowance: what it costs over is Alcove's. What
 * it holds and is charged comes out of what the call held for it, and counts on top only once it's past that.
 *
 * Every change is made under the meter's row lock, so requests at once on any instance can't spend the same money
 * twice. A new period starts the first time a meter is touched after its period ends, or after its plan changes:
 * what was left doesn't carry over. What the meter is now (`current`) is worked out one way, for changing it and for
 * showing it.
 */
import type { PlanKind } from '@alcove/api';
import type { Deps } from '../../context';
import { id128 } from '../../crypto';
import { exec, maybeOne, tx, type Db } from '../../db';
import { PlanLimitError } from '../../errors';
import type { Meter, Metered, Most, Usage } from '../../inference';
import { limitsNow, type Limits } from '../../limits';
import { log } from '../../log';
import { priceOf, type Price } from '../notes/models';
import { mayStore } from './held';
import { keptOf, MeterRow, openMeter, sealMeter, type Hold, type MeterState } from './meter-state';
import { planWith, type InForce } from './plans';

const alog = log.child({ component: 'ai-allowance' });
/** A source (a call or room recording) nothing has charged for this long is over, and what it held goes. */
const SOURCE_GONE_MS = 24 * 3_600_000;
/** How long a request may take before what it held is charged in full, as if it was answered and lost. */
const HOLD_MS = 5 * 60_000;

/** What a request is for, kept by kind with the allowance, so where it went can be explained. */
export type Spend = 'transcript' | 'notes' | 'live-notes' | 'ideas' | 'captions' | 'catch-up' | 'ask' | 'series' | 'documents';
/** What a call or room recording's charges belong to, so what writing its notes will cost is held while it runs. */
export interface Source { kind: 'call' | 'recording'; id: string }
/**
 * Whose allowance pays, as the person asking is told when it's refused: their own, the organizer's (what a call does for
 * everyone, and a guest's questions), or the notes a workspace's AI is paid from.
 */
export type Whose = 'yours' | 'organizer' | 'workspace';
/** Who pays for a request, what for, and whose allowance that is to whoever asked. */
export interface Bill {
  payer: string;
  spend: Spend;
  whose: Whose;
  source?: Source | undefined;
  /** What writing the source's notes will cost, reckoned now in tokens of `model`: held from the allowance while it runs. */
  reserve?: { model: string; most: Most } | undefined;
  /** Writing a source's notes once it's over: never refused, the one way past an allowance, and paid from what it held. */
  final?: boolean | undefined;
  /**
   * Told once a change is saved that the allowance has reached a limit: about to run out at the source's pace (`warn`,
   * once for it, and only for a bill with this), or spent (`stop`: the charge took it there, or it was already, or a request
   * was refused for it). A request refused only because it's too dear for what's left says nothing. A failure here is
   * logged, and the request goes on.
   */
  onLimit?: ((what: Limit) => Promise<void>) | undefined;
}
/** A limit an allowance reached: about to run out at a source's pace, or spent. */
export type Limit = 'warn' | 'stop';

type Service = Pick<Deps, 'cfg' | 'pool'>;

/** What a period's minutes of notes are worth, in nano-USD: the plan's, and any more bought for the period (plans.ts `inForce`). */
const allowanceOf = (p: InForce, l: Limits) => Math.round((p.notesMinutes * l.get('ai.hour_micro_usd') * 1000) / 60);
/** What a live source's own requests hold now: those writing its notes. */
const heldFor = (m: MeterState, sourceId: string) => m.holds.reduce((n, h) => n + (h.source === sourceId ? h.nano : 0), 0);
/**
 * What's left to spend: the allowance, less what's spent, what requests in flight hold, and what live sources hold for
 * writing their notes. Writing a source's notes is paid from what it held for them: what that has been charged so far,
 * and what its requests hold now, come out of the reserve, and count on top of it only once they're past it.
 */
function leftOf(m: MeterState): number {
  const live = new Set(m.sources.map((s) => s.id));
  const loose = m.holds.reduce((n, h) => n + (h.source !== null && live.has(h.source) ? 0 : h.nano), 0);
  const writing = m.sources.reduce((n, s) => n + Math.max(s.reserveNano - s.drawnNano, heldFor(m, s.id)), 0);
  return m.allowanceNano - m.spentNano - loose - writing;
}

/** A model's price, or the fallback's for one NEAR AI doesn't price (said once each time the catalog is read: models.ts). */
async function priced(d: Service, l: Limits, model: string): Promise<Price> {
  const p = await priceOf(d.cfg, model);
  if (p) return p;
  return { input: l.get('ai.fallback_input_micro_usd'), cached: l.get('ai.fallback_input_micro_usd'), output: l.get('ai.fallback_output_micro_usd') };
}
/** What `u` costs at `p`, in nano-USD, rounded up. */
const costOf = (p: Price, u: Usage) => Math.ceil((Math.max(0, u.input - u.cached) * p.input + u.cached * p.cached + u.output * p.output) / 1000);
/** The most `most` can use, as tokens: images at `ai.image_tokens` each. */
const usageOf = (most: Most, l: Limits): Usage => ({ input: most.input + most.images * l.get('ai.image_tokens'), cached: 0, output: most.output });

/** A new period's meter for the plan in force: all of its allowance, carrying what's held over from the one before. */
const fresh = (p: InForce, l: Limits, carried: Pick<MeterState, 'holds' | 'sources' | 'closed'>): MeterState => ({
  plan: p.kind, from: p.from, to: p.to, allowanceNano: allowanceOf(p, l), spentNano: 0, byKind: {}, ...carried, stopped: null
});

/**
 * The meter as it stands at `now`, from what's stored (null before the account's first request), for the plan in force
 * (`p`): holds nothing settled in time are charged in full, as if answered and lost, and come out of what their source held
 * for its notes; sources nothing has charged for in a day go; a period that's over, or a plan that changed, starts a new
 * period carrying what's held; the allowance is what the limits make it now, a change to them in force at once; and a stop
 * is lifted once the allowance itself has outgrown it. It's what `locked` saves and `standing` shows, so the two never
 * differ. Says how many holds were charged in full (`lost`), and the period that closed, if one did.
 */
function current(stored: MeterState | null, p: InForce, l: Limits, now: number): { m: MeterState; lost: number; closed: MeterState | null } {
  let m = stored ?? fresh(p, l, { holds: [], sources: [], closed: [] });
  const gone: Hold[] = m.holds.filter((h) => h.until <= now);
  if (gone.length) {
    const drawn = (id: string) => gone.reduce((n, h) => n + (h.source === id ? h.nano : 0), 0);
    m = {
      ...m, spentNano: m.spentNano + gone.reduce((n, h) => n + h.nano, 0), holds: m.holds.filter((h) => h.until > now),
      sources: m.sources.map((s) => ({ ...s, drawnNano: s.drawnNano + drawn(s.id) }))
    };
  }
  m = { ...m, sources: m.sources.filter((s) => now - s.touched < SOURCE_GONE_MS), closed: m.closed.filter((c) => now - c.at < SOURCE_GONE_MS) };
  let closed: MeterState | null = null;
  if (m.from !== p.from || m.plan !== p.kind) {
    closed = m;
    m = fresh(p, l, { holds: m.holds, sources: m.sources, closed: m.closed });
  }
  m = { ...m, allowanceNano: allowanceOf(p, l) };
  // Once spent it stays spent this period, a call's hold let go included, unless the allowance itself is raised past it.
  if (m.stopped !== null && m.allowanceNano > m.stopped.allowanceNano && leftOf(m) > l.get('ai.stop_micro_usd') * 1000) m = { ...m, stopped: null };
  return { m, lost: gone.length, closed };
}

/**
 * The meter, locked for the rest of the caller's transaction, as it stands now (`current`): made on the account's first
 * request, in the period the plan in force has then. After that the plan in force runs on from the period it keeps
 * (plans.ts › planAt). What it says changed by itself (holds charged in full, a period closed) is logged here, where it's saved.
 */
async function locked(d: Service, db: Db, ownerId: string, l: Limits, now: number): Promise<{ m: MeterState; save: (m: MeterState) => Promise<void> }> {
  const read = () => maybeOne(db, MeterRow, 'SELECT state_ciphertext FROM ai_meters WHERE owner_id = $1 FOR UPDATE', [ownerId]);
  let r = await read();
  if (!r) {
    const { p } = await planWith(d, db, ownerId, now, null);
    await exec(db, 'INSERT INTO ai_meters (owner_id, state_ciphertext) VALUES ($1,$2) ON CONFLICT (owner_id) DO NOTHING', [ownerId, sealMeter(d, ownerId, current(null, p, l, now).m)]);
    r = await read();
  }
  if (!r) throw new PlanLimitError('Notes aren’t available for this account.', 'notes', { context: { ownerId, why: 'no meter' } });
  const stored = openMeter(d, ownerId, r.state_ciphertext);
  const { p } = await planWith(d, db, ownerId, now, keptOf(stored));
  const { m, lost, closed } = current(stored, p, l, now);
  if (lost) alog.warn('requests never said what they used; charged what they held', { ownerId, requests: lost });
  if (closed && (closed.spentNano > 0 || closed.stopped !== null)) {
    alog.info('ai period closed', { ownerId, plan: closed.plan, spentNano: closed.spentNano, allowanceNano: closed.allowanceNano, overNano: Math.max(0, closed.spentNano - closed.allowanceNano), byKind: closed.byKind });
  }
  return { m, save: async (next) => { await exec(db, 'UPDATE ai_meters SET state_ciphertext = $2, version = version + 1 WHERE owner_id = $1', [ownerId, sealMeter(d, ownerId, next)]); } };
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

/** What someone is told when an allowance is spent, by whose it is. */
const SPENT: Record<Whose, string> = {
  yours: 'Your notes for this period have run out. They start again when your plan renews.',
  organizer: 'The organizer’s notes for this period have run out, and this is paid from them.',
  workspace: 'The notes this workspace’s AI is paid from have run out for this period.'
};
/** What someone is told when what's left can't cover a request, though smaller ones still go. */
const SHORT: Record<Whose, string> = {
  yours: 'What’s left of your notes this period isn’t enough for this.',
  organizer: 'What’s left of the organizer’s notes this period isn’t enough for this.',
  workspace: 'What’s left of the notes this workspace’s AI is paid from isn’t enough for this.'
};
/** The refusal when an allowance is spent, worded for whoever asked (`whose`). */
export const ranOut = (whose: Whose, context: Record<string, string | number | null>): PlanLimitError => new PlanLimitError(SPENT[whose], 'notes', { context });

/** The meter `bill` pays with. */
export function meterFor(d: Service, bill: Bill): Meter {
  const said = async (what: Limit): Promise<void> => {
    if (!bill.onLimit) return;
    try {
      await bill.onLimit(what);
    } catch (e) {
      alog.error('a limit the allowance reached wasn’t acted on', { ownerId: bill.payer, spend: bill.spend, what, err: e });
    }
  };
  return {
    async begin(model: string, most: Most): Promise<Metered> {
      const l = await limitsNow(d);
      const price = await priced(d, l, model);
      const reserve = bill.reserve ? costOf(await priced(d, l, bill.reserve.model), usageOf(bill.reserve.most, l)) : undefined;
      const heldNano = costOf(price, usageOf(most, l));
      const holdId = id128();
      // Writing a source's notes holds from what the source held for them.
      const hold = (now: number): Hold => ({ id: holdId, nano: heldNano, until: now + HOLD_MS, source: bill.final && bill.source ? bill.source.id : null });
      const stop = l.get('ai.stop_micro_usd') * 1000;
      const held = await changing(d, bill.payer, (m, _l, now): { m: MeterState; result: 'held' | 'refused' | 'stopped' } => {
        if (bill.final) return { m: { ...m, holds: [...m.holds, hold(now)] }, result: 'held' };
        if (m.stopped !== null) return { m, result: 'stopped' };
        // Spent: nothing more this period. Only too little for this one request: it's refused, and smaller ones still go.
        if (leftOf(m) <= stop) {
          alog.info('ai allowance spent', { ownerId: bill.payer, plan: m.plan, spend: bill.spend, source: bill.source?.kind ?? null });
          return { m: { ...m, stopped: { at: now, allowanceNano: m.allowanceNano } }, result: 'stopped' };
        }
        if (leftOf(m) - heldNano < stop) return { m, result: 'refused' };
        return { m: { ...m, holds: [...m.holds, hold(now)] }, result: 'held' };
      });
      const context = { ownerId: bill.payer, spend: bill.spend, whose: bill.whose };
      if (held === 'stopped') {
        await said('stop');
        throw ranOut(bill.whose, context);
      }
      if (held === 'refused') throw new PlanLimitError(SHORT[bill.whose], 'notes', { context: { ...context, why: 'short' } });
      // What it cost, charged under the lock; what that came to is said once it's saved.
      const charge = (cost: (m: MeterState) => number, what: string) => changing(d, bill.payer, (m, _l, now): { m: MeterState; result: Limit | null } => {
        const used = cost(m);
        // A hold nothing settled in time was charged in full already (`current`): what it really cost is set right now,
        // never charged on top of it.
        const swept = !m.holds.some((h) => h.id === holdId);
        const charged = swept ? Math.max(-m.spentNano, used - heldNano) : used;
        const s = bill.source;
        let sources = m.sources;
        if (s && !m.closed.some((c) => c.id === s.id)) {
          const had = sources.find((x) => x.kind === s.kind && x.id === s.id);
          const was = had ?? { ...s, since: now, touched: now, spentNano: 0, reserveNano: 0, drawnNano: 0, warned: false };
          // Writing its notes is paid from what it held for them: what's charged comes out of the reserve.
          const drawnNano = bill.final ? Math.max(0, was.drawnNano + charged) : was.drawnNano;
          const next = { ...was, touched: now, spentNano: was.spentNano + used, reserveNano: reserve ?? was.reserveNano, drawnNano };
          sources = [...sources.filter((x) => x !== had), next];
        }
        let next: MeterState = {
          ...m, spentNano: m.spentNano + charged, byKind: { ...m.byKind, [bill.spend]: (m.byKind[bill.spend] ?? 0) + used },
          holds: m.holds.filter((h) => h.id !== holdId), sources
        };
        let reached: Limit | null = null;
        if (next.stopped === null && leftOf(next) <= stop) {
          next = { ...next, stopped: { at: now, allowanceNano: next.allowanceNano } };
          alog.info('ai allowance spent', { ownerId: bill.payer, plan: next.plan, spend: bill.spend, source: s?.kind ?? null });
        }
        if (next.stopped !== null) reached = 'stop';
        else if (s && bill.onLimit) {
          // Only a bill whose caller is told can take the source's one warning, so it's never lost to one that isn't.
          const mine = next.sources.find((x) => x.kind === s.kind && x.id === s.id);
          // This source's pace: what it has cost and will cost to write up, a second of it, since it began.
          const pace = mine ? (mine.spentNano + mine.reserveNano) / Math.max(60, (now - mine.since) / 1000) : 0;
          if (mine && !mine.warned && pace > 0 && (leftOf(next) - stop) / pace <= l.get('ai.warn_seconds')) {
            next = { ...next, sources: next.sources.map((x) => (x === mine ? { ...x, warned: true } : x)) };
            reached = 'warn';
          }
        }
        if (used > 0) alog.debug('ai charged', { ownerId: bill.payer, spend: bill.spend, model, how: what, costNano: used, final: bill.final === true, late: swept });
        return { m: next, result: reached };
      });
      const settle = async (cost: (m: MeterState) => number, what: string): Promise<void> => {
        const reached = await charge(cost, what);
        if (reached) await said(reached);
      };
      return {
        used: (u, reckoned) => settle(() => costOf(price, reckoned ? { ...u, input: u.input + most.images * l.get('ai.image_tokens') } : u), reckoned ? 'reckoned' : 'reported'),
        unsent: () => settle(() => 0, 'unsent'),
        lost: () => settle(() => heldNano, 'lost')
      };
    }
  };
}

/**
 * What writing a live source's notes will cost, reckoned again (`reserve`, in tokens of the model they'll be written with,
 * as when the call's model changes), held in place of what the source held, in the caller's transaction, which holds the
 * meter until it commits. Holding more is refused when it would take the allowance to the stop, or it's spent: writing the
 * notes is never refused, so what it may cost has to be held before. Holding less always goes. A source with nothing held
 * yet, or whose notes are written, has nothing to change: its next clip reckons it.
 */
export async function reckonAgain(d: Service, db: Db, payer: string, source: Source, reserve: { model: string; most: Most }): Promise<void> {
  const l = await limitsNow(d, db);
  const nano = costOf(await priced(d, l, reserve.model), usageOf(reserve.most, l));
  const now = Date.now();
  const { m, save } = await locked(d, db, payer, l, now);
  const was = m.sources.find((s) => s.kind === source.kind && s.id === source.id);
  if (!was || m.closed.some((c) => c.id === source.id)) return;
  const next: MeterState = { ...m, sources: m.sources.map((s) => (s === was ? { ...s, touched: now, reserveNano: nano } : s)) };
  if (nano > was.reserveNano && (m.stopped !== null || leftOf(next) <= l.get('ai.stop_micro_usd') * 1000)) {
    throw new PlanLimitError('What’s left of your notes this period won’t cover writing this call’s notes with that model. Keep the one it has, or choose one that costs less.', 'notes', { context: { ownerId: payer, source: source.kind, why: 'reserve' } });
  }
  await save(next);
}

/** Lets go of what a call or room recording held for writing its notes, once they're written (or given up on). */
export async function close(d: Service, payer: string, source: Source): Promise<void> {
  await changing(d, payer, (m, _l, now) => ({
    m: { ...m, sources: m.sources.filter((s) => !(s.kind === source.kind && s.id === source.id)), closed: [...m.closed.filter((c) => c.id !== source.id), { id: source.id, at: now }] }, result: undefined
  }));
}

/**
 * An account's allowance as it stands, without changing it: what's left, what a period brings, and whether it's spent,
 * as the meter will be the next time it's touched (`current`). `leftNano` and `stopped` are what the meter decides by:
 * what requests in flight and live calls' notes hold counts at the most it could cost, so nothing spends past the
 * allowance. `unspentNano` and `ranOut` are what the plan shows: only what's been spent, so notes left only ever go down
 * in a period, and don't dip while something is held and come back when it's charged at what it actually cost.
 */
export interface Standing {
  leftNano: number; unspentNano: number; allowanceNano: number; spentNano: number; byKind: Readonly<Record<string, number>>;
  stopped: boolean; ranOut: boolean; plan: PlanKind; from: number; to: number;
}
export async function standing(d: Service, db: Db, ownerId: string): Promise<Standing> {
  const l = await limitsNow(d, db);
  const now = Date.now();
  const r = await maybeOne(db, MeterRow, 'SELECT state_ciphertext FROM ai_meters WHERE owner_id = $1', [ownerId]);
  const stored = r ? openMeter(d, ownerId, r.state_ciphertext) : null;
  const { p } = await planWith(d, db, ownerId, now, stored ? keptOf(stored) : null);
  const { m } = current(stored, p, l, now);
  const stop = l.get('ai.stop_micro_usd') * 1000;
  const leftNano = leftOf(m);
  const unspentNano = Math.max(0, m.allowanceNano - m.spentNano);
  // Spent this period, and not lifted by a bigger allowance since.
  const halted = m.stopped !== null;
  return {
    leftNano, unspentNano, allowanceNano: m.allowanceNano, spentNano: m.spentNano, byKind: m.byKind,
    stopped: leftNano <= stop || halted, ranOut: unspentNano <= stop || halted, plan: m.plan, from: m.from, to: m.to
  };
}

/** Minutes of notes `nano` is about worth, at what an hour of notes is reckoned at. */
export const minutesOf = (nanoUsd: number, l: Limits): number => Math.max(0, Math.floor((nanoUsd * 60) / (l.get('ai.hour_micro_usd') * 1000)));

/** Room a recording needs to start or carry on: a few minutes of a call's audio. */
const NOTES_ROOM = 1024 * 1024;
/** Why notes can't be kept for an account now: its notes this period, or its storage (without NOTES_ROOM left), have run out. Null: they can. */
export async function notesBlocked(d: Service, db: Db, ownerId: string): Promise<'notes' | 'storage' | null> {
  if ((await standing(d, db, ownerId)).stopped) return 'notes';
  if (!(await mayStore(d, db, ownerId, NOTES_ROOM))) return 'storage';
  return null;
}
