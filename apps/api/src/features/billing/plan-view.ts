/*
 * An account's plan as its owner sees it (docs: Plans and usage): notes as time, about what's left of the period's AI
 * allowance at what an hour of notes is reckoned at; storage and shared workspaces against the plan's limits, with any
 * grace; and the balance. The allowance itself, in dollars, never leaves the server.
 */
import type { Plan } from '@alcove/api';
import type { Deps } from '../../context';
import { limitsNow } from '../../limits';
import { minutesOf, standing } from './meter';
import { accountOf, heldTo, historyOf, inForce } from './plans';
import { sharedMade, usedBytes } from './storage';

/** How many of the balance's latest changes are shown. */
const SHOWN = 20;

export async function planOf(d: Pick<Deps, 'cfg' | 'pool'>, ownerId: string): Promise<Plan> {
  const l = await limitsNow(d);
  const now = Date.now();
  const a = await accountOf(d, d.pool, ownerId);
  const p = inForce(a, l, now);
  const s = await standing(d, d.pool, ownerId);
  const [used, made] = await Promise.all([usedBytes(d.pool, ownerId), sharedMade(d.pool, ownerId)]);
  const overWorkspaces = p.sharedWorkspaces !== null && made > p.sharedWorkspaces;
  const overStorage = used > p.storageBytes;
  const inGrace = a.grace !== null && Date.parse(a.grace.until) > now && (overWorkspaces || overStorage);
  const held = heldTo(a, p, now);
  return {
    kind: p.kind,
    period: { from: new Date(p.from).toISOString(), to: new Date(p.to).toISOString() },
    notes: { minutesLeft: minutesOf(s.leftNano - l.get('ai.stop_micro_usd') * 1000, l), minutesPerPeriod: p.notesMinutes, stopped: s.stopped },
    storage: { usedBytes: used, limitBytes: held.storageBytes ?? p.storageBytes, fileBytes: p.fileBytes },
    sharedWorkspaces: { made, limit: p.sharedWorkspaces },
    grace: inGrace && a.grace ? { until: a.grace.until, workspaces: overWorkspaces, storage: overStorage } : null,
    over: inGrace ? { workspaces: false, storage: false } : { workspaces: overWorkspaces, storage: overStorage },
    balance: { microUsd: a.balanceMicroUsd, history: historyOf(a).slice(0, SHOWN) },
    choose: a.choose
  };
}
