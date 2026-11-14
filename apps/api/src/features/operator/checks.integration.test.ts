/*
 * Live checks from inside (GET /v1/operator/checks, features/operator/checks.ts): every dependency checked at once, against the
 * harness's own Postgres, object store and LiveKit and its stand-ins for NEAR AI, 1Click and Google; one run every 20 s on
 * an instance; what each check says when its dependency fails; the CLI's `checks`; and the worked example of 13 Nov, NEAR
 * AI's notes model turning Alcove away while its evidence checked out. The check says so as it is, and every failure
 * meanwhile carries the status NEAR AI answered as its `upstreamStatus`, never as the status Alcove answered with.
 */
import { AlcoveApiError, type AudioPiece, type TranscriptClip } from '@alcove/api';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createPool } from '../../platform/db';
import { ChecksAnswer, type LiveCheck } from './checks';
import { makeKeyFile, parseOperatorKeys } from '../../keys/operator-keys';
import { REFUSAL, speechWav } from '../../testing/fakes/near';
import { startHarness, type Browser, type Harness, type ServerSettings } from '../../testing/harness';
import { signedClient, type SignedClient } from '../../testing/operator';

vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { h?.closeCalls(); await h?.close(); });

const CHECKS = '/v1/operator/checks';
const NAMES = ['database', 'objects', 'livekit', 'near-ai:speech', 'near-ai:notes', 'oneclick', 'google'];
const LogLine = z.object({ level: z.number(), msg: z.string() }).passthrough();
const logsSince = (from: number) => h.logs.slice(from).map((l) => LogLine.parse(JSON.parse(l)));
const pause = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** The checks a signed request to `client`'s instance gets. */
async function checks(client: SignedClient): Promise<ChecksAnswer> {
  const r = await client.get(CHECKS);
  expect(r.status).toBe(200);
  return ChecksAnswer.parse(await r.json());
}
/** One check of an answer, by name. */
function check<N extends LiveCheck['name']>(a: ChecksAnswer, name: N): Extract<LiveCheck, { name: N }> {
  const found = a.checks.find((c): c is Extract<LiveCheck, { name: N }> => c.name === name);
  if (!found) throw new Error(`The answer has no ${name} check.`);
  return found;
}
/** The names of the checks that failed. */
const failing = (a: ChecksAnswer) => a.checks.filter((c) => !c.ok).map((c) => c.name);
/** Another instance on the same database and bucket, with these settings, and a read key's client for it: its checks are its own. */
async function instance(settings: ServerSettings = {}) {
  const s = await h.secondServer(settings);
  return { ...s, read: signedClient(s.baseUrl, h.operator.audience, h.operator.keys.read) };
}
/** A port nothing listens on: a database there refuses every connection. */
const closedPort = () => new Promise<number>((resolve) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => {
    const at = s.address();
    s.close(() => resolve(typeof at === 'object' && at ? at.port : 9));
  });
});

let seq = 0;
async function organizer(): Promise<Browser> {
  const b = h.browser();
  await b.api.auth.signIn('sso', { email: `organizer.${Date.now().toString(36)}${(seq++).toString(36)}@vandelay.test` });
  return b;
}
const audio = (i: number): AudioPiece => ({ data: new Blob([new Uint8Array(2048)]), segment: 0, seq: i, at: i * 5, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
const speech = (words: string): TranscriptClip => ({ data: new Blob([speechWav(words, 3000)], { type: 'audio/wav' }), segment: 0, at: 1, durationMs: 3000 });
/** A call with notes on in which `words` are said, then left: the ID of its note, whose notes are then written. */
async function call(b: Browser, words: string): Promise<string> {
  const { code } = await b.api.calls.startNow({ notes: 'on' });
  const host = await b.api.calls.join(code, { mic: true, cam: false });
  for (let i = 0; i < 2; i++) await host.appendAudio(audio(i));
  await host.transcribe(speech(words), host.ticket.identity);
  const noteId = (await host.leave())?.pendingNoteId;
  if (!noteId) throw new Error('The call left no note to write.');
  return noteId;
}

describe('live checks from inside', () => {
  it('checks every dependency at once, sealing each probe to the key its model’s evidence vouched for', async () => {
    const from = h.logs.length;
    const asked = { calls: h.near.calls.length, prompts: h.near.prompts.length, instructions: h.near.instructions.length };

    const r = await h.operator.read.get(CHECKS);
    expect(r.status).toBe(200);
    const a = ChecksAnswer.parse(await r.json());
    expect(a.checks.map((c) => c.name)).toEqual(NAMES);
    // Any failure, with its code, shows in the diff.
    expect(a.checks.filter((c) => !c.ok)).toEqual([]);
    expect(a).toMatchObject({ ok: true, cached: false, instance: r.headers.get('x-alcove-instance') });
    expect(Math.abs(Date.parse(a.at) - Date.now())).toBeLessThan(30_000);
    expect(Date.parse(a.ranAt)).toBeLessThanOrEqual(Date.parse(a.at));
    for (const c of a.checks) {
      expect(c.code, c.name).toBeNull();
      expect(c.ms, c.name).toBeLessThan(10_000);
    }

    const cfg = h.deps.cfg;
    expect(check(a, 'database').detail.pool).toEqual({ total: expect.any(Number), idle: expect.any(Number), waiting: expect.any(Number), max: 10 });
    expect(check(a, 'database').detail.pool.total).toBeGreaterThanOrEqual(1);
    expect(check(a, 'livekit').detail.rooms).toEqual(expect.any(Number));
    for (const [name, model] of [['near-ai:speech', cfg.NEAR_AI_STT_MODEL], ['near-ai:notes', cfg.NEAR_AI_NOTES_MODEL]] as const) {
      expect(check(a, name).detail).toEqual({
        model, evidence: { ok: true, ms: expect.any(Number), check: null, tcb: 'UpToDate', gpus: expect.any(Number) },
        probe: { ok: true, ms: expect.any(Number), status: 200, timedOut: false }
      });
    }
    expect(check(a, 'oneclick').detail).toEqual({ offered: 9, allowed: 9, partnerKey: true, topUps: true });
    expect(check(a, 'google').detail).toEqual({
      client: 'ok', step: null, signup: cfg.GOOGLE_SIGNUP_MODE, testers: cfg.GOOGLE_SIGNUP_TESTERS.length, keys: 1, behindGoogleS: expect.any(Number), roundTripMs: expect.any(Number)
    });
    // The stand-in's clock is this one.
    expect(Math.abs(check(a, 'google').detail.behindGoogleS ?? 99)).toBeLessThanOrEqual(1);

    // One probe a model, each sealed to the attested key of the model whose evidence was just checked.
    const sent = h.near.calls.slice(asked.calls);
    expect(sent).toHaveLength(2);
    expect(sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/v1/audio/transcriptions', encryption: 'ohttp', key: h.near.keys().transcript }),
      expect.objectContaining({ path: '/v1/chat/completions', encryption: 'ohttp', key: h.near.keys().notes })
    ]));

    // The notes model was asked the same fixed thing as ever, with nothing of anyone's in it, and none of it is in the log:
    // neither what it was asked nor the speech model's second of silence.
    const prompts = h.near.prompts.slice(asked.prompts);
    const instructions = h.near.instructions.slice(asked.instructions);
    expect(prompts).toEqual(['Reply with {"ok":true} and nothing else.']);
    const said = h.logs.slice(from).join('\n');
    for (const text of [...prompts, ...instructions]) {
      expect(said).not.toContain(text);
      expect(said).not.toContain(JSON.stringify(text).slice(1, -1));
    }
    for (const wav of ['RIFF', 'UklGR', 'A'.repeat(64)]) expect(said).not.toContain(wav);

    const lines = logsSince(from);
    expect(lines.filter((l) => l.msg === 'operator call')).toEqual([
      expect.objectContaining({ route: `GET ${CHECKS}`, scope: 'read', outcome: 'ok', status: 200, requestId: r.headers.get('x-request-id') })
    ]);
    const probes = lines.filter((l) => l.msg === 'operator probe');
    expect(probes).toHaveLength(2);
    expect(probes).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 30, model: cfg.NEAR_AI_STT_MODEL, upstreamStatus: 200, readable: true }),
      expect.objectContaining({ level: 30, model: cfg.NEAR_AI_NOTES_MODEL, upstreamStatus: 200, readable: true })
    ]));
    expect(lines.find((l) => l.msg === 'operator checks')).toMatchObject({ failed: 0 });
  });

  it('runs at most once every 20 s on an instance, answering in between from that run', async () => {
    const s = await instance();
    try {
      const before = h.near.calls.length;
      // Two at once: one run, which both wait for.
      const [x, y] = await Promise.all([checks(s.read), checks(s.read)]);
      expect([x.cached, y.cached].sort()).toEqual([false, true]);
      expect(y.ranAt).toBe(x.ranAt);
      expect(y.checks).toEqual(x.checks);
      const ran = h.near.calls.length;
      expect(ran - before).toBe(2);
      // And again: the same run, with nothing asked of anyone.
      const again = await checks(s.read);
      expect(again).toMatchObject({ cached: true, ranAt: x.ranAt, instance: x.instance, ok: true });
      expect(again.checks).toEqual(x.checks);
      expect(Date.parse(again.at)).toBeGreaterThanOrEqual(Date.parse(x.at));
      expect(h.near.calls.length).toBe(ran);
      // Another instance runs its own.
      const other = await instance();
      try {
        expect((await checks(other.read)).cached).toBe(false);
      } finally { await other.close(); }
    } finally { await s.close(); }
  });

  it('says when the notes model doesn’t answer its probe in time', async () => {
    const s = await instance();
    try {
      h.near.slowNext(7_000, '{"ok":true}');
      const a = await checks(s.read);
      const notes = check(a, 'near-ai:notes');
      expect(notes).toMatchObject({ ok: false, code: 'UnansweredError' });
      expect(notes.ms).toBeLessThan(10_000);
      expect(notes.detail.evidence).toMatchObject({ ok: true, check: null });
      expect(notes.detail.probe).toEqual({ ok: false, ms: expect.any(Number), status: null, timedOut: true });
      expect(failing(a)).toEqual(['near-ai:notes']);
    } finally { await s.close(); }
  });

  it('says when 1Click can’t be reached, when NEAR AI isn’t set up, and when a probe’s answer isn’t the model’s', async () => {
    const off = await instance({ ONECLICK_BASE_URL: `http://127.0.0.1:${await closedPort()}`, NEAR_AI_API_KEY: '' });
    try {
      const a = await checks(off.read);
      expect(check(a, 'oneclick')).toMatchObject({ ok: false, code: expect.stringMatching(/\S/), detail: { offered: null, allowed: null } });
      // Without a key there's nothing to check NEAR AI with: no evidence fetched, no probe sent.
      for (const name of ['near-ai:speech', 'near-ai:notes'] as const) {
        expect(check(a, name)).toMatchObject({ ok: false, code: 'not-connected', detail: { evidence: null, probe: null } });
      }
      expect(failing(a)).toEqual(['near-ai:speech', 'near-ai:notes', 'oneclick']);
    } finally { await off.close(); }
    const on = await instance();
    try {
      // The notes model answers the probe with prose, not the JSON it was asked for: it answered, and isn't usable.
      h.near.failNext(1, 'prose', '{"ok":true}');
      const a = await checks(on.read);
      expect(check(a, 'near-ai:notes')).toMatchObject({ ok: false, code: 'unreadable-reply', detail: { evidence: { ok: true }, probe: { ok: false, status: 200, timedOut: false } } });
      expect(failing(a)).toEqual(['near-ai:notes']);
    } finally { await on.close(); }
  });

  it('says when NEAR AI’s evidence for a model doesn’t check out, and sends that model nothing', async () => {
    const s = await instance();
    try {
      const sent = h.near.calls.length;
      // Each model reports an app compose other than the one its quote measures.
      h.near.tamper('compose');
      let a: ChecksAnswer;
      try { a = await checks(s.read); } finally { h.near.tamper(null); }
      for (const name of ['near-ai:speech', 'near-ai:notes'] as const) {
        expect(check(a, name)).toMatchObject({ ok: false, code: 'compose' });
        expect(check(a, name).detail).toMatchObject({ evidence: { ok: false, check: 'compose', tcb: null, gpus: null }, probe: null });
      }
      expect(h.near.calls.length).toBe(sent);
      // The verifications requests use were left alone: a call's speech is still heard.
      const org = await organizer();
      const noteId = await call(org, 'We agreed the evidence check stays on.');
      for await (const p of org.api.notes.progress(noteId)) void p;
      expect((await org.api.notes.get(noteId)).status).toBe('ready');
    } finally { await s.close(); }
  });

  it('says Google turned its client away, and still how its keys and its clock stand', async () => {
    const s = await instance({ GOOGLE_CLIENT_SECRET: 'not-the-secret' });
    try {
      const a = await checks(s.read);
      const google = check(a, 'google');
      expect(google).toMatchObject({ ok: false, code: 'invalid_client' });
      expect(google.detail).toMatchObject({ client: 'refused', step: 'client', keys: 1, behindGoogleS: expect.any(Number) });
      expect(failing(a)).toEqual(['google']);
      // Google's description never comes back.
      expect(JSON.stringify(a)).not.toContain('Unauthorized');
    } finally { await s.close(); }
  });

  it('answers while the database can’t be reached, and says why', async () => {
    const dead = createPool(`postgres://alcove:alcove@127.0.0.1:${await closedPort()}/alcove`, 2);
    const s = await h.secondServer({}, undefined, dead);
    try {
      // The signed request's nonce is checked in this instance's memory, as for any read with the database down.
      const a = await checks(signedClient(s.baseUrl, h.operator.audience, h.operator.keys.read));
      const db = check(a, 'database');
      expect(db).toMatchObject({ ok: false, code: 'ECONNREFUSED' });
      expect(db.detail.pool.max).toBe(2);
      expect(failing(a)).toEqual(['database']);
    } finally {
      await s.close();
      await dead.end();
    }
  });

  it('prints the checks from the CLI, and the answer as it came with --json', async () => {
    const home = await mkdtemp(join(tmpdir(), 'alcove-checks-'));
    /** The CLI as an operator runs it: no .env, nothing in its environment but a PATH and a home. */
    const cli = (args: string[]) => new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
      const run = spawn(process.execPath, ['--import', 'tsx', 'src/operator-cli.ts', ...args], { env: { PATH: process.env['PATH'] ?? '', HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      run.stdout.on('data', (b: Buffer) => { out += b.toString(); });
      run.stderr.on('data', (b: Buffer) => { err += b.toString(); });
      run.on('error', reject);
      run.on('close', (code) => resolve({ code, out, err }));
    });
    try {
      const { file } = makeKeyFile(null);
      const keyPath = join(home, 'operator-key.json');
      await writeFile(keyPath, JSON.stringify(file), { mode: 0o600 });
      const s = await h.secondServer({ operatorKeys: parseOperatorKeys(`read:${file.publicKey}`) });
      try {
        const api = ['--api', s.baseUrl, '--audience', h.operator.audience, '--key', keyPath];
        const printed = await cli(['checks', ...api]);
        expect(printed.code, printed.err).toBe(0);
        const lines = printed.out.trim().split('\n');
        expect(lines[0]).toMatch(/^Ran \S+ on \S+: every check passed$/);
        expect(lines.slice(1).map((l) => /^([a-z:-]+):/.exec(l)?.[1])).toEqual(NAMES);
        for (const line of lines.slice(1)) expect(line).toMatch(/^[a-z:-]+:\s+ok in \d/);
        expect(printed.out).toMatch(/^near-ai:notes:\s+ok in .*; evidence ok in .* \(UpToDate, \d+ GPUs?\); probe answered 200 in /m);
        expect(printed.out).toMatch(/^oneclick:\s+ok in .*; 9 of 9 routes offered; partner key set; top-ups on$/m);
        expect(printed.err).toMatch(/^Request [A-Za-z0-9_-]{8,64} on \S+$/m);

        const json = await cli(['checks', '--json', ...api]);
        expect(json.code, json.err).toBe(0);
        expect(ChecksAnswer.parse(JSON.parse(json.out))).toMatchObject({ ok: true, cached: true });
        // It takes no words of its own.
        const extra = await cli(['checks', 'now', ...api]);
        expect(extra.code).toBe(2);
        expect(extra.err).toContain('usage: operator checks');
      } finally { await s.close(); }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('says NEAR AI turned the notes model away while its evidence checked out, and each failure carries the status it answered', async () => {
    const org = await organizer();
    // A call whose notes are written, to ask about.
    const written = await call(org, 'We agreed to ship the beta on Friday.');
    for await (const p of org.api.notes.progress(written)) void p;

    h.near.refuseModel('notes', 403);
    try {
      // The check says it as it was: the notes model's evidence checked out, and the probe sealed to its key came back 403.
      const meters = async () => (await h.pool.query('SELECT owner_id, state_ciphertext FROM ai_meters ORDER BY owner_id')).rows;
      const metered = await meters();
      // The organizer's, charged for the notes just written.
      expect(metered.length).toBeGreaterThanOrEqual(1);
      const s = await instance();
      let a: ChecksAnswer;
      try { a = await checks(s.read); } finally { await s.close(); }
      // Nobody's meter moved: Alcove pays for probes, whatever they're answered.
      expect(await meters()).toEqual(metered);
      const notes = check(a, 'near-ai:notes');
      expect(notes).toMatchObject({ ok: false, code: '403' });
      expect(notes.detail.evidence).toMatchObject({ ok: true, check: null, tcb: 'UpToDate' });
      expect(notes.detail.probe).toEqual({ ok: false, ms: expect.any(Number), status: 403, timedOut: false });
      expect(check(a, 'near-ai:speech')).toMatchObject({ ok: true, code: null });
      expect(failing(a)).toEqual(['near-ai:notes']);

      // A question asked meanwhile fails as Alcove's own 500, with NEAR AI's 403 as its upstream status, never its status.
      const from = h.logs.length;
      const failure = await (async () => {
        try {
          for await (const part of org.api.notes.ask(written, 'What did we agree to ship?')) void part;
          return null;
        } catch (e) { return e; }
      })();
      if (!(failure instanceof AlcoveApiError)) throw new Error('The question was answered while the notes model turned Alcove away.');
      expect(failure.code).toBe('unknown');
      const asked = logsSince(from).filter((l) => l['requestId'] === failure.requestId);
      expect(asked.find((l) => l.msg === 'The notes service turned Alcove away.')).toMatchObject({ level: 50, errorClass: 'InternalError', code: 'unknown', status: 500, upstreamStatus: 403 });
      expect(asked.find((l) => l.msg === 'request failed')).toMatchObject({ status: 500 });
      expect(asked.filter((l) => l['status'] === 403)).toEqual([]);

      // And the notes of a call that ends meanwhile wait for the model, saying what it answered.
      const waiting = await call(org, 'We agreed to move the launch to Monday.');
      let line: z.infer<typeof LogLine> | undefined;
      for (let i = 0; i < 300 && !line; i++) {
        line = logsSince(from).find((l) => l.msg === 'notes not written yet; trying again' && l['noteId'] === waiting);
        if (!line) await pause(100);
      }
      expect(line).toMatchObject({ level: 40, err: { type: 'InternalError', status: 500, context: { upstreamStatus: 403 } } });
      // What NEAR AI said came back in no answer and no log line.
      for (const text of [JSON.stringify(a), h.logs.join('\n')]) {
        expect(text).not.toContain(REFUSAL);
        expect(text).not.toContain('ak-vandelay-7781');
      }
    } finally {
      h.near.refuseModel('notes', null);
      h.closeCalls();
    }
  });
});
