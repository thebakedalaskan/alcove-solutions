/*
 * `operator checks` (GET /v1/operator/checks, features/operator/checks.ts): which dependency is failing, and how. One
 * line a check: whether it passed and how long it took, its code when it failed, and what it found besides, under a
 * line saying which instance ran it and when. With --json, the answer as the server sent it.
 */
import { ChecksAnswer, type LiveCheck } from '../checks';
import { aligned, answered, usage, type CliCommand } from './cli';

const took = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const many = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** A private model's evidence and probe, in words. */
function model(d: Extract<LiveCheck, { name: 'near-ai:notes' }>['detail']): string {
  const e = d.evidence;
  const evidence = e === null ? 'evidence not fetched'
    : e.ok ? `evidence ok in ${took(e.ms)} (${e.tcb ?? 'no TCB status'}, ${many(e.gpus ?? 0, 'GPU')})`
      : `evidence refused${e.check === null ? '' : ` (${e.check})`} in ${took(e.ms)}`;
  const p = d.probe;
  const probe = p === null ? null
    : p.timedOut ? `probe timed out after ${took(p.ms)}`
      : p.status === null ? `probe failed after ${took(p.ms)}`
        : `probe answered ${p.status}${p.ok || p.status !== 200 ? '' : ', unreadable'} in ${took(p.ms)}`;
  return [d.model, evidence, ...(probe === null ? [] : [probe])].join('; ');
}

/** How far this clock is from Google's, in words. */
function clock(behindGoogleS: number | null): string | null {
  if (behindGoogleS === null) return null;
  if (behindGoogleS === 0) return 'clock in step with Google';
  return behindGoogleS > 0 ? `clock ${behindGoogleS} s behind Google` : `clock ${-behindGoogleS} s ahead of Google`;
}

/** What a check found besides passing, in words. */
function found(c: LiveCheck): string {
  switch (c.name) {
    case 'database': {
      const p = c.detail.pool;
      return `pool ${p.total} of ${p.max} open, ${p.idle} idle, ${p.waiting} waiting`;
    }
    case 'objects': return '';
    case 'livekit': return c.detail.rooms === null ? '' : `${many(c.detail.rooms, 'room')} open`;
    case 'near-ai:speech':
    case 'near-ai:notes': return model(c.detail);
    case 'oneclick': {
      const d = c.detail;
      const routes = d.offered === null || d.allowed === null ? 'routes not read' : `${d.offered} of ${d.allowed} routes offered`;
      return [routes, d.partnerKey ? 'partner key set' : 'no partner key', d.topUps ? 'top-ups on' : 'top-ups off'].join('; ');
    }
    case 'google': {
      const d = c.detail;
      const client = d.client === 'ok' ? 'client ok' : d.client === 'refused' ? 'client refused' : d.client === 'not-set' ? 'no client set' : 'client not checked';
      const signup = d.signup === 'testers' ? `sign-up for ${many(d.testers, 'tester')}` : `sign-up ${d.signup}`;
      return [client, ...(d.step === null ? [] : [`${d.step} failed`]), ...(d.keys === null ? [] : [many(d.keys, 'key')]), ...(clock(d.behindGoogleS) ?? []), signup].join('; ');
    }
  }
}

const command: CliCommand = {
  words: ['checks'],
  usage: 'checks                                   which dependency is failing, and how: each checked from inside, once every 20 s at most',
  async run(ctx, args) {
    if (args.length) return usage(command);
    return answered(ctx, await ctx.call('GET', '/v1/operator/checks'), (body) => {
      const a = ChecksAnswer.parse(body);
      const failed = a.checks.filter((c) => !c.ok).length;
      return [
        `Ran ${a.ranAt} on ${a.instance}${a.cached ? ', an earlier request’s run' : ''}: ${failed ? `${failed} of ${a.checks.length} failed` : 'every check passed'}`,
        ...aligned(a.checks.map((c) => {
          const outcome = c.ok ? `ok in ${took(c.ms)}` : `failed (${c.code ?? 'unknown'}) in ${took(c.ms)}`;
          const more = found(c);
          return [c.name, more ? `${outcome}; ${more}` : outcome] as const;
        }))
      ];
    });
  }
};

/** The live checks' command. */
export const checks: CliCommand[] = [command];
