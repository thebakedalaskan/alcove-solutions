/**
 * Getting a call ready before it starts, through browsers talking to the real API over HTTP via @alcove/api-http, on real
 * Postgres and the local LiveKit server: its organizer, or someone invited, adds an agenda or a board from the call's page;
 * its home is settled as the call would settle it (a new one made for it, with everyone invited in, or the one its organizer
 * chose), what's made is brought to the call, and the call settles on that same home when it starts. Nobody else reaches it.
 */
import { AlcoveApiError, type CallSession } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startHarness, type Browser, type Harness } from '../../testing/harness';
import { disposeLiveKit } from '../../testing/livekit';

vi.setConfig({ testTimeout: 120_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(() => { h.closeCalls(); });

let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
type Account = Browser & { email: string; ownerId: string };
async function account(email = unique()): Promise<Account> {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email });
  return { ...b, email: session.user.email, ownerId: session.ownerId };
}
const code = (p: Promise<unknown>) => p.then(() => 'allowed', (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error'));
const rest = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean | Promise<boolean>, what: string, ms = 20_000): Promise<void> {
  const by = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await rest(30);
  }
}
const inGroup = (call: CallSession) => until(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
const peopleIn = async (who: Account, workspaceId: string) => Object.fromEntries((await who.api.workspaces.people(workspaceId)).map((p) => [p.person.email, p.role]));
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

describe('a call before it starts', () => {
  it('gets an agenda from its organizer: a home made for it with everyone invited in, the agenda brought to it, and the same home when it starts', async () => {
    const ann = await account();
    const kofi = await account();
    const m = await ann.api.meetings.create({ title: 'CANARY-AHEADTITLE Hiring sync', startsAt: tomorrow(), durationMinutes: 45, guests: [kofi.email], notes: 'on' });
    expect((await ann.api.meetings.get(m.id)).workspaceId).toBeNull();

    const made = await ann.api.calls.ready(m.id, 'agenda');
    const home = made.workspaceId;
    // The meeting names its home now, and it's a workspace made for the call: the organizer its admin, Kofi in it to edit.
    expect((await ann.api.meetings.get(m.id)).workspaceId).toBe(home);
    const [listed] = await ann.api.workspaces.list();
    expect(listed).toMatchObject({ id: home, role: 'admin', call: { title: 'CANARY-AHEADTITLE Hiring sync', at: expect.any(String) } });
    expect(await peopleIn(ann, home)).toEqual({ [ann.email]: 'admin', [kofi.email]: 'edit' });
    // The agenda is at the top of it, made by Ann, with no folder yet: the call makes its own when it starts.
    expect((await ann.api.workspaces.get(home)).items).toEqual([expect.objectContaining({ id: made.itemId, kind: 'document', name: 'Agenda', parent: null })]);
    expect((await ann.api.workspaces.get(home)).items.filter((x) => x.call)).toEqual([]);
    // It's brought to the call, so it opens for everyone invited, Kofi included, before the call and in it.
    expect((await ann.api.meetings.get(m.id)).documents).toEqual([expect.objectContaining({ kind: 'doc', name: 'Agenda' })]);
    await until(async () => (await kofi.api.meetings.get(m.id)).documents.some((d) => d.name === 'Agenda'), 'Kofi to see the agenda');
    expect((await kofi.api.workspaces.get(home)).items.map((x) => x.name)).toEqual(['Agenda']);

    // Kofi adds a board the same way, in the same home, and it's brought too.
    const board = await kofi.api.calls.ready(m.id, 'board');
    expect(board.workspaceId).toBe(home);
    expect((await ann.api.workspaces.get(home)).items.map((x) => [x.kind, x.name]).sort()).toEqual([['board', 'Board'], ['document', 'Agenda']]);
    expect((await ann.api.meetings.get(m.id)).documents.map((d) => d.kind).sort()).toEqual(['board', 'doc']);

    // When the call starts, it settles on that home: its folder goes there, and no other workspace is made.
    const host = await ann.api.calls.join(m.code, { mic: false, cam: false });
    await inGroup(host);
    await host.openWorkspace();
    await host.refresh({ call: true, log: false });
    expect(host.getSnapshot().workspace.home).toBe(home);
    expect((await ann.api.workspaces.get(home)).items.filter((x) => x.call !== null)).toHaveLength(1);
    expect(await ann.api.workspaces.list()).toHaveLength(1);
    // Once it's started, its workspace is the call's to open.
    expect(await code(ann.api.calls.ready(m.id, 'agenda'))).toBe('conflict');
    await host.leave();
    expect(h.logs.join('\n')).not.toContain('CANARY-AHEADTITLE');
  });

  it('settles one home however many get it ready at once, each bringing what they made, a document for files by its name', async () => {
    const ann = await account();
    const kofi = await account();
    const priya = await account();
    const m = await ann.api.meetings.create({ title: 'Design review', startsAt: tomorrow(), durationMinutes: 30, guests: [kofi.email, priya.email], notes: 'on' });
    const [a, k, p] = await Promise.all([ann.api.calls.ready(m.id, 'agenda'), kofi.api.calls.ready(m.id, 'board'), priya.api.calls.ready(m.id, 'file', 'CANARY-AHEADFILE Brief')]);
    expect(new Set([a.workspaceId, k.workspaceId, p.workspaceId]).size).toBe(1);
    expect(await ann.api.workspaces.list()).toHaveLength(1);
    const items = (await ann.api.workspaces.get(a.workspaceId)).items;
    expect(items.map((x) => [x.id, x.kind, x.name]).sort()).toEqual([[a.itemId, 'document', 'Agenda'], [k.itemId, 'board', 'Board'], [p.itemId, 'document', 'CANARY-AHEADFILE Brief']].sort());
    // All three are brought to the call; only the agenda is its agenda.
    const brought = (await ann.api.meetings.get(m.id)).documents;
    expect(brought.map((d) => [d.kind, d.name]).sort()).toEqual([['board', 'Board'], ['doc', 'Agenda'], ['doc', 'CANARY-AHEADFILE Brief']]);
    expect(h.logs.join('\n')).not.toContain('CANARY-AHEADFILE');
  });

  it('adds to the workspace its organizer chose, for whoever is in it, and refuses someone invited who isn’t', async () => {
    const ann = await account();
    const kofi = await account();
    const { id: product } = await ann.api.workspaces.create('Product');
    const m = await ann.api.meetings.create({ title: 'Pricing sync', startsAt: tomorrow(), durationMinutes: 30, guests: [kofi.email], notes: 'on', workspaceId: product });
    // Kofi isn't in Product: he can't add to it, and nothing is made.
    expect(await code(kofi.api.calls.ready(m.id, 'agenda'))).toBe('forbidden');
    expect((await ann.api.workspaces.get(product)).items).toEqual([]);
    const made = await ann.api.calls.ready(m.id, 'agenda');
    expect(made.workspaceId).toBe(product);
    expect((await ann.api.workspaces.get(product)).items.map((x) => x.name)).toEqual(['Agenda']);
    expect(await ann.api.workspaces.list()).toHaveLength(1);
    // Product keeps its own people: being invited to the call doesn't put Kofi in it.
    expect(await peopleIn(ann, product)).toEqual({ [ann.email]: 'admin' });
  });

  it('is nobody else’s to get ready: someone not invited, a made-up call, and a call that’s been cancelled are all not found', async () => {
    const ann = await account();
    const kofi = await account();
    const lena = await account();
    const m = await ann.api.meetings.create({ title: 'Board prep', startsAt: tomorrow(), durationMinutes: 30, guests: [kofi.email], notes: 'on' });
    expect(await code(lena.api.calls.ready(m.id, 'agenda'))).toBe('not-found');
    expect(await code(lena.api.calls.ready(m.id, 'file', 'Notes.pdf'))).toBe('not-found');
    expect(await code(ann.api.calls.ready('AAAAAAAAAAAAAAAAAAAAAA', 'agenda'))).toBe('not-found');
    // Nothing was made for Lena's tries.
    expect((await ann.api.meetings.get(m.id)).workspaceId).toBeNull();
    expect(await lena.api.workspaces.list()).toEqual([]);
    await ann.api.meetings.cancel(m.id);
    expect(await code(ann.api.calls.ready(m.id, 'agenda'))).toBe('not-found');
    expect(await code(kofi.api.calls.ready(m.id, 'agenda'))).toBe('not-found');
  });
});
