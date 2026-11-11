/*
 * Feature flags (docs: engineering/feature-flags.md): what a browser hears from /v1/feature-flags, signed in or not, as flags are
 * switched on for everyone, for groups and for people, from the same functions the feature-flags CLI calls.
 */
import { spawn } from 'node:child_process';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { b64u } from '../crypto';
import { addMembers, createGroup, deleteGroup, emailHash, grantGroup, grantPerson, revokeGroup, setEveryone } from '../feature-flags';
import { masterKey } from '../owners';
import { startHarness, type Harness } from '../testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
// What a test switched on is gone before the next starts: FEATURE_FLAGS_CACHE_MS is 0 here, so every request reads it afresh.
afterEach(async () => {
  await h.pool.query('DELETE FROM feature_flag_person_grants; DELETE FROM feature_flag_group_grants; DELETE FROM feature_flag_group_members; DELETE FROM feature_flag_groups; DELETE FROM feature_flags_everyone');
});

let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
/** A fresh account: single sign-on signs in whoever's work email is typed. */
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, email: r.session.user.email, ownerId: r.session.ownerId };
}
const hash = (email: string) => emailHash(masterKey(h.deps), email);
const pause = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });
const LogLine = z.object({ level: z.number(), msg: z.string() }).passthrough();
const logsSince = (from: number) => h.logs.slice(from).map((l) => LogLine.parse(JSON.parse(l)));
const count = async (sql: string, params: unknown[]) => z.object({ n: z.number() }).parse((await h.pool.query(sql, params)).rows[0]).n;

describe('feature flags', () => {
  it('are off for everyone by default', async () => {
    const ann = await account();
    expect(await ann.api.featureFlags.on()).toEqual([]);
    expect(await h.browser().api.featureFlags.on()).toEqual([]);
  });

  it('switched on for everyone reach the signed in and the signed out', async () => {
    const ann = await account();
    const visitor = h.browser();
    expect(await setEveryone(h.pool, 'call.bandwidth_reduction', true)).toBe(true);
    expect(await ann.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
    expect(await visitor.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
    expect(await setEveryone(h.pool, 'call.bandwidth_reduction', false)).toBe(true);
    expect(await ann.api.featureFlags.on()).toEqual([]);
    expect(await visitor.api.featureFlags.on()).toEqual([]);
  });

  it('granted to a group reach its members only', async () => {
    const ann = await account();
    const bob = await account();
    await createGroup(h.pool, 'staff');
    expect(await addMembers(h.pool, 'staff', [hash(ann.email)])).toBe(1);
    await grantGroup(h.pool, 'call.bandwidth_reduction', 'staff');
    expect(await ann.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
    expect(await bob.api.featureFlags.on()).toEqual([]);
    expect(await h.browser().api.featureFlags.on()).toEqual([]);
  });

  it('granted to a group and to people outside it at once reach all of them', async () => {
    const ann = await account();
    const bob = await account();
    const carol = await account();
    await createGroup(h.pool, 'internal');
    await addMembers(h.pool, 'internal', [hash(ann.email)]);
    await grantGroup(h.pool, 'call.bandwidth_reduction', 'internal');
    await grantPerson(h.pool, 'call.bandwidth_reduction', hash(bob.email));
    expect(await ann.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
    expect(await bob.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
    expect(await carol.api.featureFlags.on()).toEqual([]);
  });

  it('on at once by different grants all reach whoever has them, and each goes on its own', async () => {
    const ann = await account();
    const bob = await account();
    await createGroup(h.pool, 'staff');
    await addMembers(h.pool, 'staff', [hash(ann.email)]);
    await setEveryone(h.pool, 'call.bandwidth_reduction', true);
    await grantGroup(h.pool, 'call.screen_share_quality', 'staff');
    expect(await ann.api.featureFlags.on()).toEqual(['call.bandwidth_reduction', 'call.screen_share_quality']);
    expect(await bob.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
    expect(await h.browser().api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
    await revokeGroup(h.pool, 'call.screen_share_quality', 'staff');
    expect(await ann.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
  });

  it('match an address however it’s typed', async () => {
    const email = unique('ann');
    await grantPerson(h.pool, 'call.bandwidth_reduction', hash(`  ${email.toUpperCase()} `));
    const ann = await account(email);
    expect(await ann.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
  });

  it('granted to someone before they sign up are on once they do', async () => {
    const email = unique('newcomer');
    await createGroup(h.pool, 'beta-testers');
    await addMembers(h.pool, 'beta-testers', [hash(email)]);
    await grantGroup(h.pool, 'call.bandwidth_reduction', 'beta-testers');
    const newcomer = await account(email);
    expect(await newcomer.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
  });

  it('go with a deleted group: its members and grants are deleted too', async () => {
    const ann = await account();
    await createGroup(h.pool, 'staff');
    await addMembers(h.pool, 'staff', [hash(ann.email)]);
    await grantGroup(h.pool, 'call.bandwidth_reduction', 'staff');
    expect(await ann.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
    expect(await deleteGroup(h.pool, 'staff')).toBe(true);
    expect(await ann.api.featureFlags.on()).toEqual([]);
    expect(await count("SELECT count(*)::int AS n FROM feature_flag_group_members WHERE group_name = 'staff'", [])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM feature_flag_group_grants WHERE group_name = 'staff'", [])).toBe(0);
  });

  it('ignore a flag the code doesn’t know, and say so once', async () => {
    const ann = await account();
    const from = h.logs.length;
    await h.pool.query("INSERT INTO feature_flags_everyone (name) VALUES ('retired.thing')");
    expect(await ann.api.featureFlags.on()).toEqual([]);
    expect(await ann.api.featureFlags.on()).toEqual([]);
    const ignored = logsSince(from).filter((l) => l.msg === 'feature flag ignored');
    expect(ignored).toEqual([expect.objectContaining({ level: 40, featureFlag: 'retired.thing' })]);
  });

  it('take a change within the cache window, with no restart, and say so', async () => {
    const ann = await account();
    const { cfg } = h.deps;
    // Read now, so the window starts here.
    expect(await ann.api.featureFlags.on()).toEqual([]);
    const from = h.logs.length;
    h.deps.cfg = { ...cfg, FEATURE_FLAGS_CACHE_MS: 3000 };
    try {
      await setEveryone(h.pool, 'call.bandwidth_reduction', true);
      // Until the window ends, what was read holds...
      expect(await ann.api.featureFlags.on()).toEqual([]);
      await pause(3100);
      // ...and once it has, what the database says.
      expect(await ann.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
    } finally { h.deps.cfg = cfg; }
    const changed = logsSince(from).filter((l) => l.msg === 'feature flag changed');
    expect(changed).toEqual([expect.objectContaining({ level: 30, featureFlag: 'call.bandwidth_reduction', everyone: true })]);
  });

  it('say when who has a flag changes through a group, or which groups have it, at the same counts', async () => {
    const ann = await account();
    await createGroup(h.pool, 'staff');
    await createGroup(h.pool, 'internal');
    await grantGroup(h.pool, 'call.bandwidth_reduction', 'staff');
    expect(await ann.api.featureFlags.on()).toEqual([]);
    const from = h.logs.length;
    // Someone joins a group the flag is granted to: the counts of groups and people granted directly don't change.
    await addMembers(h.pool, 'staff', [hash(ann.email)]);
    expect(await ann.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
    // Another group takes the first one's place: still one group.
    await revokeGroup(h.pool, 'call.bandwidth_reduction', 'staff');
    await grantGroup(h.pool, 'call.bandwidth_reduction', 'internal');
    expect(await ann.api.featureFlags.on()).toEqual([]);
    const changed = logsSince(from).filter((l) => l.msg === 'feature flag changed');
    expect(changed).toEqual([
      expect.objectContaining({ featureFlag: 'call.bandwidth_reduction', groups: 1, members: 1 }),
      expect.objectContaining({ featureFlag: 'call.bandwidth_reduction', groups: 1, members: 0 })
    ]);
  });

  it('keep what was in force when they can’t be read, and are read again next time', async () => {
    const ann = await account();
    await setEveryone(h.pool, 'call.bandwidth_reduction', true);
    expect(await ann.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
    const from = h.logs.length;
    await h.pool.query('ALTER TABLE feature_flags_everyone RENAME TO flags_everyone_away');
    try {
      // Nothing can read them now: what was in force stays, and isn't put back to off.
      expect(await ann.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
      expect(logsSince(from).filter((l) => l.msg === 'feature flags not read; keeping what was in force').map((l) => l.level)).toContain(40);
    } finally { await h.pool.query('ALTER TABLE flags_everyone_away RENAME TO feature_flags_everyone'); }
    // Once they can be read, the next request does.
    await setEveryone(h.pool, 'call.bandwidth_reduction', false);
    expect(await ann.api.featureFlags.on()).toEqual([]);
  });

  it('forget a deleted account’s address in groups and grants', async () => {
    const ann = await account();
    await createGroup(h.pool, 'staff');
    await addMembers(h.pool, 'staff', [hash(ann.email)]);
    await grantPerson(h.pool, 'call.bandwidth_reduction', hash(ann.email));
    await ann.api.account.delete();
    expect(await count('SELECT count(*)::int AS n FROM feature_flag_group_members WHERE email_index = $1', [hash(ann.email)])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM feature_flag_person_grants WHERE email_index = $1', [hash(ann.email)])).toBe(0);
    // The group is the operator's, not the account's.
    expect(await count("SELECT count(*)::int AS n FROM feature_flag_groups WHERE name = 'staff'", [])).toBe(1);
  });

  it('are switched from the command line, which never says an address back, in its output or its log', async () => {
    const cli = (...args: string[]) => new Promise<{ code: number | null; out: string }>((resolve, reject) => {
      const run = spawn(process.execPath, ['--import', 'tsx', 'src/feature-flags-cli.ts', ...args], {
        env: { ...process.env, DATABASE_URL: process.env['TEST_DATABASE_URL'], LOG_FORMAT: 'json', LOG_LEVEL: 'info' }, stdio: ['ignore', 'pipe', 'pipe']
      });
      let out = '';
      run.stdout.on('data', (b: Buffer) => { out += b.toString(); });
      run.stderr.on('data', (b: Buffer) => { out += b.toString(); });
      run.on('error', reject);
      run.on('close', (c) => resolve({ code: c, out }));
    });
    const ann = await account();
    const bob = await account();
    const said: string[] = [];
    const ok = async (...args: string[]) => { const r = await cli(...args); said.push(r.out); expect(r.code).toBe(0); };
    await ok('group', 'create', 'staff');
    await ok('group', 'add', 'staff', ann.email);
    await ok('grant', 'call.bandwidth_reduction', 'group', 'staff');
    await ok('grant', 'call.bandwidth_reduction', 'person', bob.email);
    await ok('group', 'members', 'staff', ann.email);
    // A group that isn't there is said to be missing, not empty.
    const typo = await cli('group', 'members', 'stafff');
    expect(typo.code).toBe(1);
    expect(typo.out).toContain('There’s no group called stafff.');
    await ok('list');
    expect(await ann.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
    expect(await bob.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
    // An address where a flag's name goes is refused without being said back.
    const misplaced = await cli('grant', bob.email, 'group', 'staff');
    said.push(misplaced.out);
    expect(misplaced.code).toBe(1);
    await ok('revoke', 'call.bandwidth_reduction', 'person', bob.email);
    await ok('group', 'remove', 'staff', ann.email);
    expect(await ann.api.featureFlags.on()).toEqual([]);
    expect(await bob.api.featureFlags.on()).toEqual([]);
    for (const email of [ann.email, bob.email]) expect(said.join('\n')).not.toContain(email);
  });

  it('never log an address or its hash', async () => {
    const from = h.logs.length;
    const ann = await account();
    const bob = await account();
    await createGroup(h.pool, 'staff');
    await addMembers(h.pool, 'staff', [hash(ann.email)]);
    await grantGroup(h.pool, 'call.bandwidth_reduction', 'staff');
    await grantPerson(h.pool, 'call.bandwidth_reduction', hash(bob.email));
    expect(await ann.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
    expect(await bob.api.featureFlags.on()).toEqual(['call.bandwidth_reduction']);
    const said = h.logs.slice(from).join('\n');
    for (const secret of [ann.email, bob.email, b64u(hash(ann.email)), b64u(hash(bob.email)), Buffer.from(hash(ann.email)).toString('hex')]) {
      expect(said).not.toContain(secret);
    }
  });
});
