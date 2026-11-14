/*
 * The operator CLI's diagnostics: `release`, `work`, `errors [--minutes <n>]` and `request <request id>`, each one GET of
 * an operator route (features/operator/diagnostics.ts), its answer parsed with the schemas the server answers by (wire.ts) and
 * printed as aligned text, or as the server sent it with --json.
 */
import { aligned, answered, usage, type CliCommand, type CliContext } from './cli';
import { ErrorsAnswer, ReleaseAnswer, RequestAnswer, WorkAnswer } from '../wire';

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** A list said in words, or `none`. */
const listed = (xs: readonly string[]): string => (xs.length ? xs.join(', ') : 'none');
/** Counts by name, as `name 2, other 1`, or `none`. */
const counted = (c: Record<string, number>): string => listed(Object.entries(c).map(([k, v]) => `${k} ${v}`));
const seconds = (s: number | null): string => (s === null ? 'none' : `${s} s`);

/** GETs `path` and says the answer as `print` puts it (cli.ts › answered). The exit code. */
const shown = async (ctx: CliContext, path: string, print: (body: unknown) => string[]): Promise<number> => answered(ctx, await ctx.call('GET', path), print);

function releaseLines(body: unknown): string[] {
  const a = ReleaseAnswer.parse(body);
  const rows: [string, string][] = [
    ['Instance', `${a.instance}, at ${a.at}`],
    ['Commit', a.build.commit],
    ['Image', a.build.imageDigest ?? 'none: not in a TEE, or no attestation token held yet'],
    ['Release log', a.build.rekorLogIndex === null ? 'no entry found' : `entry ${a.build.rekorLogIndex}`],
    ['Started', `${a.running.startedAt}, up ${a.running.uptimeS} s`],
    ...a.boot.map((s): [string, string] => [`Boot ${s.step}`, `${s.ok ? 'ok' : `failed: ${s.errorClass ?? 'unknown'}${s.code ? ` ${s.code}` : ''}`} in ${s.ms} ms`]),
    ...(a.boot.length ? [] : [['Boot', 'not started by start.ts on this instance'] satisfies [string, string]]),
    ...(a.migrations.ok
      ? [
        ['Migrations', `${a.migrations.applied.count} applied (newest ${a.migrations.applied.newest ?? 'none'}), ${a.migrations.inImage.count} in the image (newest ${a.migrations.inImage.newest ?? 'none'})`],
        ['Not applied', listed(a.migrations.notApplied)],
        ['Unknown', listed(a.migrations.unknown)],
        ['Changed', listed(a.migrations.changed)],
        ['A start would', a.migrations.refused === null ? 'apply what isn’t applied' : `refuse this database: ${a.migrations.refused}`]
      ] satisfies [string, string][]
      : [['Migrations', `couldn’t be read: ${a.migrations.code}`] satisfies [string, string]]),
    ['Clock', a.clock ? `${a.clock.behindGoogleS} s behind Google, round trip ${a.clock.roundTripMs} ms, at ${a.clock.at}` : 'not measured on this instance'],
    ['Attestation', a.attestation
      ? `token issued ${a.attestation.issuedAt ?? 'never'}, expires ${a.attestation.expiresAt ?? 'never'}${a.attestation.ageS === null ? '' : `, ${a.attestation.ageS} s old`}; `
        + `last failure ${a.attestation.lastFailure ? `${a.attestation.lastFailure.code} at ${a.attestation.lastFailure.at}` : 'none'}; next ask ${a.attestation.nextAskAt ?? 'when asked'}`
      : 'none: not in a TEE, or not asked for yet'],
    ['Certificate', a.certificate
      ? `until ${a.certificate.notAfter} (${a.certificate.daysLeft} days, renewal ${a.certificate.renewal}); ${a.certificate.hosts} hosts; stored ${a.certificate.storedAt}; `
        + `${a.certificate.spkiMatches ? 'its key is the attested one' : 'its key ISN’T the attested one'}; last check `
        + `${a.certificate.lastCheck ? `${a.certificate.lastCheck.at} ${a.certificate.lastCheck.ok ? 'ok' : `failed ${a.certificate.lastCheck.code ?? ''}`}` : 'none yet'}`
      : 'none: TLS ends outside this server'],
    ...([['Limits cache', a.caches.limits], ['Flags cache', a.caches.featureFlags]] as const).map(([label, c]): [string, string] =>
      [label, c ? `read ${c.readAt ?? 'never'}, last read ok ${c.okAt ?? 'never'}, ${c.failures} failures since` : 'not read yet']),
    ['Operator keys', listed(a.settings.operatorKeys.map((k) => `${k.keyId} ${k.scope}`))],
    ...Object.entries(a.settings.values).map(([name, value]): [string, string] => [name, value === null ? 'not set' : String(value)]),
    ['Set', listed(Object.entries(a.settings.others).filter(([, v]) => v === 'set').map(([name]) => name))],
    ['Not set', listed(Object.entries(a.settings.others).filter(([, v]) => v === 'not set').map(([name]) => name))]
  ];
  return aligned(rows);
}

function workLines(body: unknown): string[] {
  const a = WorkAnswer.parse(body);
  const rows: [string, string][] = [['Instance', `${a.instance}, at ${a.at}`]];
  for (const l of a.loops) {
    const last = l.lastEndedAt === null ? 'never ended' : `last ended ${l.lastEndedAt} in ${l.lastMs ?? 0} ms, ${l.lastOk ? 'ok' : `failed ${l.lastCode ?? ''}`}`;
    rows.push([`Loop ${l.name}`, `${last}; counted ${counted(l.lastCounts)}; ${l.running} running; last ok ${l.lastOkAt ?? 'never'}; failed in the hour ${counted(l.failures)}`]);
  }
  const q = a.queues;
  if (!q.ok) rows.push(['Queues', `couldn’t be counted: ${q.code}`]);
  else {
    rows.push(
      ['Notes', `${q.notes.queued} queued, ${q.notes.writing} writing, ${q.notes.waiting} waiting; ${q.notes.claimable} due now, the oldest ${seconds(q.notes.oldestClaimableS)}; ${q.notes.leasesRunOut} leases run out`],
      ['Drive exports', `${q.driveExports.pending} pending, ${q.driveExports.uploading} uploading, ${q.driveExports.uploaded} uploaded, ${q.driveExports.failed} failed, ${q.driveExports.reconnect} to reconnect; ${q.driveExports.claimable} due now; most attempts ${q.driveExports.highestAttempt}`],
      ['Shared screens', `${q.sharedScreens.recordings} recordings, ${q.sharedScreens.pieces} pieces, ${q.sharedScreens.bytes} bytes to join; the oldest stopped ${seconds(q.sharedScreens.oldestStopS)} ago`],
      ['Object deletes', `${q.objectDeletes.queued} queued, ${q.objectDeletes.failing} failing, most attempts ${q.objectDeletes.highestAttempt}, the oldest ${seconds(q.objectDeletes.oldestS)}`],
      ['Top-ups', `${q.deposits.due} due a look, lag ${seconds(q.deposits.lagS)}; ${q.deposits.open} open; ${q.deposits.unanswered} past their deadline unanswered; ${q.deposits.creditedNotCarried} credited, not carried`],
      ['Plans', `${q.plans.due} due, lag ${seconds(q.plans.lagS)}; ${q.plans.accountsWithout} accounts with no plan`],
      ['Teams', `${q.teams.due} due, lag ${seconds(q.teams.lagS)}`],
      ['Calls', `${q.calls.live} live, ${q.calls.overdue} past their longest (the most overdue by ${seconds(q.calls.mostLateS)}), ${q.calls.hostAway} host away past the grace, ${q.calls.noRoom} with no room; `
        + `${q.calls.endedLastHour} ended in the hour; `
        + (q.calls.livekit === null ? `${q.calls.roomGone ?? 0} rooms gone, ${q.calls.roomLeftUp ?? 0} rooms left up` : `LiveKit didn’t say which rooms are up: ${q.calls.livekit}`)],
      ['Sweeps', `${q.sweeps.sessions} sessions, ${q.sweeps.agentRows} agents' rows, ${q.sweeps.invites} invites to sweep`]
    );
  }
  for (const f of a.finals) {
    rows.push(['Final', `${f.at} ${f.kind === 'notes-without-summary' ? 'notes finished without a summary' : 'Drive export failed for good'}, note ${f.noteId ?? 'unknown'}, job ${f.jobId ?? 'unknown'}, ${f.errorClass ?? ''} ${f.code ?? ''}`.trim()]);
  }
  if (!a.finals.length) rows.push(['Finals', 'none in the last day']);
  return aligned(rows);
}

function errorsLines(body: unknown): string[] {
  const a = ErrorsAnswer.parse(body);
  const width = Math.max(1, ...[...a.requests, ...a.groups].map((g) => String(g.count).length));
  const n = (count: number) => String(count).padStart(width);
  const from = Date.parse(a.at) - a.minutes * 60_000;
  const cut = ([['requests', a.heldFrom.requests], ['lines', a.heldFrom.failures]] as const)
    .flatMap(([what, held]) => (held !== null && Date.parse(held) > from ? [`${what} only from ${held}`] : []));
  const { unrouted, overShare } = a.notKept;
  return [
    `${a.instance}, at ${a.at}: ${a.lines} lines in the last ${a.minutes} minutes`,
    ...(cut.length ? [`Cut short: this instance holds ${cut.join(', and ')}; older ones were pushed out to keep the newest.`] : []),
    ...(unrouted || overShare ? [`Not kept: ${unrouted} requests for no route, ${overShare} lines past their client’s share.`] : []),
    'Requests refused or failed:',
    ...(a.requests.length ? a.requests.map((g) => `  ${n(g.count)}  ${g.route}  ${g.status ?? '?'} ${g.code ?? ''}  last ${g.lastAt}  request ${g.requestId ?? 'none'}`) : ['  none']),
    'Lines:',
    ...(a.groups.length ? a.groups.map((g) => `  ${n(g.count)}  ${g.component ?? '?'}  ${g.msg}  ${g.code ?? ''}${g.upstreamStatus === null ? '' : ` upstream ${g.upstreamStatus}`}  last ${g.lastAt}  request ${g.requestId ?? 'none'}`) : ['  none'])
  ];
}

function requestLines(body: unknown): string[] {
  const a = RequestAnswer.parse(body);
  return [
    `Request ${a.requestId}, as ${a.instance} holds it:`,
    ...a.lines.map((l) => {
      const ids = Object.entries(l.ids).flatMap(([k, v]) => (v === undefined ? [] : [`${k} ${v}`]));
      return [
        `  ${l.at} ${l.level} ${l.component ?? '?'}: ${l.msg}`,
        l.route ?? '', l.status === null ? '' : `status ${l.status}`,
        l.errorClass ?? '', l.code ?? '', l.upstreamStatus === null ? '' : `upstream ${l.upstreamStatus}`, l.what ? `what ${l.what}` : '',
        l.final ? `given up for good: ${l.final}` : '', ids.join(', ')
      ].filter(Boolean).join('  ');
    })
  ];
}

const release: CliCommand = {
  words: ['release'],
  usage: 'release                                  which release is serving, how it started, its migrations, settings, clock and certificate',
  run: (ctx, args) => (args.length ? Promise.resolve(usage(release)) : shown(ctx, '/v1/operator/release', releaseLines))
};

const work: CliCommand = {
  words: ['work'],
  usage: 'work                                     background loops, the queues, and notes and exports that failed for good',
  run: (ctx, args) => (args.length ? Promise.resolve(usage(work)) : shown(ctx, '/v1/operator/work', workLines))
};

/** `--minutes <n>` or `--minutes=<n>`, from 1 to 240; undefined for none, and null for anything else. */
function minutesOf(args: string[]): number | undefined | null {
  if (!args.length) return undefined;
  const [first = '', second, ...rest] = args;
  const given = first === '--minutes' && second !== undefined && !rest.length ? second : first.startsWith('--minutes=') && args.length === 1 ? first.slice('--minutes='.length) : null;
  if (given === null || !/^\d{1,3}$/.test(given)) return null;
  const minutes = Number(given);
  return minutes >= 1 && minutes <= 240 ? minutes : null;
}

const errors: CliCommand = {
  words: ['errors'],
  usage: 'errors [--minutes <n>]                   what failed in the last n minutes (1 to 240, 60 unless given), counted',
  run(ctx, args) {
    const minutes = minutesOf(args);
    if (minutes === null) return Promise.resolve(usage(errors));
    return shown(ctx, `/v1/operator/errors${minutes === undefined ? '' : `?minutes=${minutes}`}`, errorsLines);
  }
};

const request: CliCommand = {
  words: ['request'],
  usage: 'request <request id>                     why one request failed: its lines on the instance that answers',
  run(ctx, args) {
    const [id, ...rest] = args;
    if (id === undefined || rest.length || !REQUEST_ID.test(id)) return Promise.resolve(usage(request));
    return shown(ctx, `/v1/operator/requests/${id}`, requestLines);
  }
};

/** What's running, what's behind, and what's failing. */
export const diagnostics: CliCommand[] = [release, work, errors, request];
