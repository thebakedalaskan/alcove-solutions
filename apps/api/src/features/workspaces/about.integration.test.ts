/**
 * What a workspace is for, in one line, as its Home says under its name: through browsers talking to the real API over HTTP
 * via @alcove/api-http, on real Postgres. An admin says it and everyone in it reads it; nobody else reads or changes it, or
 * can tell one is there; it's one line, sealed with the workspace's name and tree; and a workspace kept by the release before
 * there was a line reads as saying nothing, then takes one.
 */
import { AlcoveApiError } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sealJson, toJson } from '../../keys/crypto';
import { findOwner } from '../../keys/owners';
import { startHarness, type Browser, type Harness } from '../../testing/harness';
import { openState, workspaceKey } from './access';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });

let seq = 0;
const unique = () => `about.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
type Account = Browser & { email: string };
/** A fresh account: single sign-on signs in whoever's work email is typed, unchecked. */
async function account(): Promise<Account> {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email: unique() });
  return { ...b, email: session.user.email };
}
const madeUp = () => randomBytes(16).toString('base64url');
/** How a request was refused, as a browser sees it, or `allowed`. */
const code = (p: Promise<unknown>) => p.then(() => 'allowed', (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error'));
/** A workspace `admin` made, with an editor and a reader in it. */
async function launch() {
  const admin = await account();
  const editor = await account();
  const reader = await account();
  const { id } = await admin.api.workspaces.create('Launch');
  await admin.api.workspaces.addPerson(id, editor.email, 'edit');
  await admin.api.workspaces.addPerson(id, reader.email, 'read');
  return { id, admin, editor, reader };
}
const ownerOf = async (workspaceId: string) => (await h.pool.query<{ owner_id: string }>('SELECT owner_id FROM workspaces WHERE workspace_id = $1', [workspaceId])).rows[0]?.owner_id ?? '';

describe('what a workspace is for', () => {
  it('an admin says it in one line, everyone in it reads it, and saying nothing takes it away', async () => {
    const { id, admin, editor, reader } = await launch();
    expect(await admin.api.workspaces.about(id)).toBe('');

    await admin.api.workspaces.setAbout(id, '  Everything for the launch\n on the 18th:   the plan and the press list.  ');
    for (const who of [admin, editor, reader]) expect(await who.api.workspaces.about(id)).toBe('Everything for the launch on the 18th: the plan and the press list.');
    // It sits beside the name, which it doesn't change.
    expect((await reader.api.workspaces.get(id)).name).toBe('Launch');

    await admin.api.workspaces.setAbout(id, '');
    expect(await editor.api.workspaces.about(id)).toBe('');
  });

  it('only an admin changes it, and it is one line of up to 200 characters', async () => {
    const { id, admin, editor, reader } = await launch();
    await admin.api.workspaces.setAbout(id, 'The launch on the 18th.');
    expect(await code(editor.api.workspaces.setAbout(id, 'Mine now.'))).toBe('forbidden');
    expect(await code(reader.api.workspaces.setAbout(id, 'Mine now.'))).toBe('forbidden');
    expect(await code(admin.api.workspaces.setAbout(id, 'x'.repeat(201)))).toBe('invalid');
    expect(await reader.api.workspaces.about(id)).toBe('The launch on the 18th.');

    await admin.api.workspaces.setAbout(id, 'y'.repeat(200));
    expect(await reader.api.workspaces.about(id)).toBe('y'.repeat(200));
    // An admin made of an editor can change it from then on.
    const people = await admin.api.workspaces.people(id);
    const them = people.find((p) => p.person.email === editor.email);
    if (!them) throw new Error('the editor is in the workspace');
    await admin.api.workspaces.setRole(id, them.id, 'admin');
    await editor.api.workspaces.setAbout(id, 'Run by two now.');
    expect(await reader.api.workspaces.about(id)).toBe('Run by two now.');
  });

  it('nobody outside the workspace reads or changes it, or can tell it is there', async () => {
    const { id, admin } = await launch();
    await admin.api.workspaces.setAbout(id, 'The launch on the 18th.');
    const stranger = await account();
    const given = await account();
    // Someone given one document in it is outside it all the same.
    const doc = (await admin.api.workspaces.items.create(id, { kind: 'document', name: 'Launch plan' })).id;
    await admin.api.workspaces.share.set(id, doc, [{ email: given.email }], 'read');
    expect((await given.api.workspaces.get(id)).items.map((i) => i.id)).toEqual([doc]);

    for (const who of [stranger, given]) {
      expect(await code(who.api.workspaces.about(id))).toBe('not-found');
      expect(await code(who.api.workspaces.setAbout(id, 'Mine now.'))).toBe('not-found');
    }
    // The same as for a workspace that was never there, and for their own account's ID.
    expect(await code(stranger.api.workspaces.about(madeUp()))).toBe('not-found');
    expect(await code(stranger.api.workspaces.setAbout(madeUp(), 'Mine now.'))).toBe('not-found');
    const theirs = (await stranger.api.workspaces.create('Theirs')).id;
    await stranger.api.workspaces.setAbout(theirs, 'Their own line.');
    expect(await code(admin.api.workspaces.about(theirs))).toBe('not-found');
    expect(await admin.api.workspaces.about(id)).toBe('The launch on the 18th.');
    expect(await stranger.api.workspaces.about(theirs)).toBe('Their own line.');
  });

  it('a workspace kept before there was a line reads as saying nothing, and takes one', async () => {
    const { id, admin, reader } = await launch();
    await admin.api.workspaces.items.create(id, { kind: 'document', name: 'Launch plan' });
    // Its state as the release before sealed it, with no line in it at all.
    const ownerId = await ownerOf(id);
    const owner = await findOwner(h.deps, ownerId, undefined);
    const row = (await h.pool.query<{ state_ciphertext: Buffer }>('SELECT state_ciphertext FROM workspaces WHERE owner_id = $1', [ownerId])).rows[0];
    if (!owner || !row) throw new Error('no such workspace');
    const before: Record<string, unknown> = { ...openState(owner, id, row.state_ciphertext) };
    delete before['about'];
    await h.pool.query('UPDATE workspaces SET state_ciphertext = $2 WHERE owner_id = $1', [ownerId, sealJson(workspaceKey(owner), { v: 1, kind: 'workspace-state', ownerId, workspaceId: id }, toJson(before))]);

    expect(await reader.api.workspaces.about(id)).toBe('');
    expect((await reader.api.workspaces.get(id)).items.map((i) => i.name)).toEqual(['Launch plan']);
    await admin.api.workspaces.setAbout(id, 'The launch on the 18th.');
    expect(await reader.api.workspaces.about(id)).toBe('The launch on the 18th.');
    expect((await reader.api.workspaces.get(id)).items.map((i) => i.name)).toEqual(['Launch plan']);
  });

  it('is sealed with the workspace: not in its row, not in the log, and not kept by whatever answers it', async () => {
    const { id, admin, reader } = await launch();
    const canary = 'CANARY-ABOUT the merger closes on Friday';
    await admin.api.workspaces.setAbout(id, canary);
    const stored = (await h.pool.query<{ state_ciphertext: Buffer }>('SELECT state_ciphertext FROM workspaces WHERE workspace_id = $1', [id])).rows[0]?.state_ciphertext;
    expect(stored?.includes(Buffer.from('CANARY-ABOUT'))).toBe(false);
    expect(JSON.stringify(h.logs)).not.toContain('CANARY-ABOUT');
    const answer = await reader.fetch(`${h.baseUrl}/v1/workspaces/${id}/about`);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(await answer.json()).toEqual({ about: canary });
  });
});
