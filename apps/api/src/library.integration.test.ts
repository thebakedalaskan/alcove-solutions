/**
 * Bringing documents to a call, end to end: what someone can bring is what they can open in their workspaces, a call keeps
 * only IDs, and everyone on it is told what they may know of them. Through browsers talking to the real API over HTTP via
 * @alcove/api-http, on real Postgres and, for guests, a real call.
 */
import { AlcoveApiError, CALL_PASS_HEADER, OPERATION_HEADER, type CallDocument, type CallSession, type CallState, type DocumentKind, type DocumentLibrary, type ItemKind, type RepeatInput, type WorkspaceRole } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { tx } from './db';
import { MeetingManifest, updateManifest } from './modules/meetings';
import { openState, sealState, type WorkspaceState } from './modules/workspaceAccess';
import { findOwner, openOwner } from './owners';
import { ORIGIN, startHarness, type Browser, type Harness } from './testing/harness';
import { findItem } from './vault';

// Guests need real calls; every wait below is bounded and says what it was waiting for.
vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
afterEach(() => h.closeCalls());

let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
type Account = Browser & { email: string; name: string; ownerId: string };
/** A fresh account: single sign-on signs in whoever's work email is typed, and names them from it. */
async function account(who = 'person'): Promise<Account> {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email: unique(who) });
  return { ...b, email: session.user.email, name: session.user.name, ownerId: session.ownerId };
}
/** A real account, signed in with (the stand-in) Google, with its calendar connected. */
async function withGoogle(who: string): Promise<Account & { sub: string }> {
  const b = h.browser();
  const n = `${Date.now().toString(36)}${(seq++).toString(36)}`;
  const sub = `google-${n}`;
  h.google.next({ sub, email: `${who}.${n}@acme.example`, name: who });
  let url = new URL(`${h.baseUrl}/v1/auth/google`);
  for (let hop = 0; hop < 10 && url.origin !== new URL(ORIGIN).origin; hop++) {
    const res = url.origin === h.google.issuer ? await fetch(url, { redirect: 'manual' }) : await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  const session = await b.api.auth.getSession();
  if (!session) throw new Error('not signed in with Google');
  return { ...b, sub, email: session.user.email, name: session.user.name, ownerId: session.ownerId };
}
const madeUp = () => randomBytes(16).toString('base64url');
/** How a request was refused, as a browser sees it, or null when it wasn't. */
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof AlcoveApiError ? { code: e.code, message: e.message, status: e.status } : { code: 'not-an-api-error', message: String(e), status: 0 }));
const code = async (p: Promise<unknown>) => (await refusal(p))?.code ?? 'allowed';
async function until(ok: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const by = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** A workspace `who` made, with people in it at these roles. */
async function workspace(who: Account, name: string, people: [Account, WorkspaceRole][] = []) {
  const { id } = await who.api.workspaces.create(name);
  for (const [p, role] of people) await who.api.workspaces.addPerson(id, p.email, role);
  return id;
}
const make = async (who: Account, id: string, kind: ItemKind, name: string, parent: string | null = null) => (await who.api.workspaces.items.create(id, { kind, name, parent })).id;
const takeOut = async (admin: Account, id: string, who: Account) => {
  const found = (await admin.api.workspaces.people(id)).find((p) => p.person.email === who.email);
  if (!found) throw new Error('not in the workspace');
  await admin.api.workspaces.removePerson(id, found.id);
};
const ownerOf = async (workspaceId: string) => (await h.pool.query<{ owner_id: string }>('SELECT owner_id FROM workspaces WHERE workspace_id = $1', [workspaceId])).rows[0]?.owner_id ?? '';
/** Writes a workspace's sealed state as it's stored, for a shape no run of requests gets to. */
async function rewrite(workspaceId: string, change: (s: WorkspaceState) => WorkspaceState) {
  const ownerId = await ownerOf(workspaceId);
  const owner = await findOwner(h.deps, ownerId, undefined);
  const row = (await h.pool.query<{ state_ciphertext: Buffer }>('SELECT state_ciphertext FROM workspaces WHERE owner_id = $1', [ownerId])).rows[0];
  if (!owner || !row) throw new Error('no such workspace');
  await h.pool.query('UPDATE workspaces SET state_ciphertext = $2 WHERE owner_id = $1', [ownerId, sealState(owner, workspaceId, change(openState(owner, workspaceId, row.state_ciphertext)))]);
}

const listed = (l: DocumentLibrary) => l.workspaces.flatMap((w) => w.documents);
const namesOf = async (who: Account) => listed(await who.api.documents.list()).map((d) => d.name).sort();
/** What a document is called in `who`'s library: the ID a call keeps. */
async function idOf(who: Account, name: string): Promise<string> {
  const found = listed(await who.api.documents.list()).find((d) => d.name === name);
  if (!found) throw new Error(`${name} isn’t in the library`);
  return found.id;
}
const soon = (guests: string[] = []) => ({ title: 'Launch check-in', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, guests, notes: 'off' as const });
const WEEK = 7 * 86_400_000;
/** What the app sends for every week on one day, in UTC. */
function weekly(first: number, count: number): RepeatInput {
  const occurrences = Array.from({ length: count }, (_, i) => new Date(first + i * WEEK).toISOString());
  return { rule: { every: 'week', weeks: 1, days: [new Date(first).getUTCDay()] }, until: (occurrences.at(-1) ?? '').slice(0, 10), timeZone: 'UTC', occurrences };
}
/** A series' calls still to come. */
const inSeries = async (who: Account, seriesId: string | undefined) => (await who.api.meetings.upcoming()).filter((m) => m.seriesId === seriesId);
const on = async (who: Account, meetingId: string) => (await who.api.meetings.get(meetingId)).documents;
/** What a call tells someone who can't open something: what it is and whose, by a name that's only theirs, only there. */
const closedAs = (by: string | null, kind: DocumentKind = 'doc') => ({ id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), kind, by, name: null });
const upcomingOn = async (who: Account, meetingId: string) => (await who.api.meetings.upcoming()).find((m) => m.id === meetingId)?.documents;
/** Writes what a call brings as it's stored, for IDs no request can put there. */
async function stored(who: Account, meetingId: string, documents: string[]) {
  const o = await openOwner(h.deps, who.ownerId, undefined);
  await tx(h.pool, (c) => updateManifest(o, c, meetingId, (m) => ({ ...m, documents })));
}

describe('the library', () => {
  it('lists each workspace’s documents and boards, newest first, by whoever made them, without its folders', async () => {
    const ann = await account('ann');
    const launch = await workspace(ann, 'Launch');
    const plans = await make(ann, launch, 'folder', 'Plans');
    const plan = await make(ann, launch, 'document', 'Launch plan', plans);
    await make(ann, launch, 'board', 'Onboarding flow');
    await ann.api.workspaces.items.rename(launch, plan, 'Launch plan, final');
    const design = await workspace(ann, 'Design');
    await make(ann, design, 'document', 'Brief');

    const library = await ann.api.documents.list();
    expect(Object.keys(library)).toEqual(['workspaces']);
    expect(library.workspaces.map((w) => [w.id, w.name, w.documents.map((d) => [d.name, d.kind, d.by])])).toEqual([
      [design, 'Design', [['Brief', 'doc', 'Ann']]],
      [launch, 'Launch', [['Launch plan, final', 'doc', 'Ann'], ['Onboarding flow', 'board', 'Ann']]]
    ]);
    expect(listed(library).find((d) => d.name === 'Launch plan, final')?.updatedAt).toBe((await ann.api.workspaces.items.get(launch, plan)).editedAt);
  });

  it('is empty until there’s something to bring, for everyone, and for nobody signed in there’s no library', async () => {
    const zara = await account('zara');
    expect(await zara.api.documents.list()).toEqual({ workspaces: [] });
    const art = h.browser();
    await art.api.auth.signIn('microsoft');
    expect(await art.api.documents.list()).toEqual({ workspaces: [] });
    expect(await (await withGoogle('ida')).api.documents.list()).toEqual({ workspaces: [] });

    // A workspace with nothing to bring adds nothing: not an empty one, a folder, or what's in Trash.
    const id = await workspace(zara, 'Quiet');
    expect(await zara.api.documents.list()).toEqual({ workspaces: [] });
    await make(zara, id, 'folder', 'Empty');
    const gone = await make(zara, id, 'document', 'Gone');
    await zara.api.workspaces.items.trash(id, gone);
    expect(await zara.api.documents.list()).toEqual({ workspaces: [] });

    expect((await h.browser().fetch(`${h.baseUrl}/v1/documents`)).status).toBe(401);
  });

  it('shows each reader what they can open and nothing else, whatever their role', async () => {
    const ann = await account('ann');
    const kofi = await account('kofi');
    const cas = await account('cas');
    const dee = await account('dee');
    const id = await workspace(ann, 'CANARY-SPACE', [[kofi, 'admin']]);
    await make(ann, id, 'document', 'For everyone');
    const closed = await make(ann, id, 'document', 'CANARY-CLOSED');
    await ann.api.workspaces.share.restrict(id, closed, true);
    const folder = await make(ann, id, 'folder', 'CANARY-FOLDER');
    const given = await make(ann, id, 'board', 'Given', folder);
    await ann.api.workspaces.share.set(id, given, [{ email: cas.email }], 'read');

    expect(await namesOf(ann)).toEqual(['CANARY-CLOSED', 'For everyone', 'Given']);
    // Being an admin doesn't open what's restricted.
    expect(await namesOf(kofi)).toEqual(['For everyone', 'Given']);
    expect(JSON.stringify((await kofi.api.documents.list()).workspaces.flatMap((w) => w.documents))).not.toContain('CANARY');
    // Someone outside a workspace who was given something sees that alone, and nothing of the workspace.
    const theirs = await cas.api.documents.list();
    expect(theirs.workspaces.map((w) => [w.id, w.name, w.documents.map((d) => d.name)])).toEqual([[id, null, ['Given']]]);
    expect(JSON.stringify(theirs)).not.toContain('CANARY');
    expect(await dee.api.documents.list()).toEqual({ workspaces: [] });

    // Whoever it's shared with has it, restricted or not, until it's taken back.
    await ann.api.workspaces.share.set(id, closed, [{ email: kofi.email }], 'read');
    expect(await namesOf(kofi)).toEqual(['CANARY-CLOSED', 'For everyone', 'Given']);
    await ann.api.workspaces.share.remove(id, closed, (await ann.api.workspaces.share.list(id, closed)).entries[0]?.id ?? '');
    expect(await namesOf(kofi)).toEqual(['For everyone', 'Given']);

    await takeOut(ann, id, kofi);
    expect(await kofi.api.documents.list()).toEqual({ workspaces: [] });
  });

  it('leaves out what’s in Trash, by itself or with a folder, until it’s back', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Launch');
    const folder = await make(ann, id, 'folder', 'Plans');
    await make(ann, id, 'document', 'Inside', folder);
    const alone = await make(ann, id, 'board', 'Alone');
    expect(await namesOf(ann)).toEqual(['Alone', 'Inside']);
    await ann.api.workspaces.items.trash(id, alone);
    expect(await namesOf(ann)).toEqual(['Inside']);
    await ann.api.workspaces.items.trash(id, folder);
    expect(await namesOf(ann)).toEqual([]);
    await ann.api.workspaces.items.restore(id, folder);
    await ann.api.workspaces.items.restore(id, alone);
    expect(await namesOf(ann)).toEqual(['Alone', 'Inside']);
  });

  it('reads at most 120 times a minute, with the list of workspaces, because both open every one you’re in', async () => {
    const ann = await account();
    for (let i = 0; i < 60; i++) await ann.api.documents.list();
    for (let i = 0; i < 60; i++) await ann.api.workspaces.list();
    expect(await code(ann.api.documents.list())).toBe('unavailable');
    expect(await code(ann.api.workspaces.list())).toBe('unavailable');
  });

  it('counts each change to what a call brings against that limit, and nothing else about a call', async () => {
    const ann = await account();
    const id = await workspace(ann, 'Launch');
    await make(ann, id, 'document', 'Plan');
    const plan = await idOf(ann, 'Plan');
    const m = await ann.api.meetings.create({ ...soon(), documents: [plan] });
    // That's one read of the library, by the test.
    for (let i = 0; i < 119; i++) await ann.api.meetings.update(m.id, { documents: [plan] });
    expect(await refusal(ann.api.meetings.update(m.id, { documents: [plan] }))).toMatchObject({ code: 'unavailable', status: 503 });
    expect(await code(ann.api.documents.list())).toBe('unavailable');
    // What doesn't read the library goes on as ever: changing anything else, and taking everything off.
    expect((await ann.api.meetings.update(m.id, { title: 'Renamed' })).title).toBe('Renamed');
    expect((await ann.api.meetings.update(m.id, { documents: [] })).documents).toEqual([]);
  });
});

describe('a call’s documents', () => {
  it('are kept as IDs, and each person on the call is told what they may know of each one', async () => {
    const ann = await account('ann');
    const kofi = await account('kofi');
    const cas = await account('cas');
    const dee = await account('dee');
    const id = await workspace(ann, 'Launch', [[kofi, 'read']]);
    await make(ann, id, 'document', 'Launch plan');
    const board = await make(ann, id, 'board', 'Onboarding flow');
    await ann.api.workspaces.share.set(id, board, [{ email: cas.email }], 'read');
    const plan = await idOf(ann, 'Launch plan');
    const flow = await idOf(ann, 'Onboarding flow');

    const m = await ann.api.meetings.create({ ...soon([kofi.email, cas.email, dee.email]), documents: [plan, flow] });
    const opened: CallDocument[] = [{ id: plan, kind: 'doc', by: 'Ann', name: 'Launch plan' }, { id: flow, kind: 'board', by: 'Ann', name: 'Onboarding flow' }];
    const closed = [closedAs('Ann'), closedAs('Ann', 'board')];
    expect(m.documents).toEqual(opened);
    expect(await on(ann, m.id)).toEqual(opened);
    expect(await on(kofi, m.id)).toEqual(opened);
    expect(await on(cas, m.id)).toEqual([closed[0], opened[1]]);
    expect(await on(dee, m.id)).toEqual(closed);
    // Home reads them the same way, one workspace at a time however many calls it lists.
    expect(await upcomingOn(ann, m.id)).toEqual(opened);
    expect(await upcomingOn(dee, m.id)).toEqual(closed);
    // What someone outside the workspace was given is theirs to bring too, and the same ID.
    expect((await cas.api.meetings.create({ ...soon(), documents: [flow] })).documents).toEqual([opened[1]]);

    // A call keeps the ID and nothing else, so a new name reaches it at once, and who can open it is decided each time.
    await ann.api.workspaces.items.rename(id, board, 'Onboarding, redrawn');
    expect((await on(kofi, m.id))[1]?.name).toBe('Onboarding, redrawn');
    await ann.api.workspaces.share.set(id, board, [{ email: dee.email }], 'read');
    expect((await on(dee, m.id))[1]?.name).toBe('Onboarding, redrawn');
    const o = await openOwner(h.deps, ann.ownerId, undefined);
    expect((await findItem(o, h.pool, 'meeting', m.id, MeetingManifest))?.manifest.documents).toEqual([plan, flow]);

    // Changing what's brought takes the same IDs, and answers with the call as it is now.
    expect((await ann.api.meetings.update(m.id, { documents: [flow] })).documents.map((d) => d.id)).toEqual([flow]);
    expect((await on(dee, m.id)).map((d) => d.id)).toEqual([flow]);
    expect((await ann.api.meetings.update(m.id, { title: 'Renamed' })).documents.map((d) => d.id)).toEqual([flow]);
    expect((await ann.api.meetings.update(m.id, { documents: [] })).documents).toEqual([]);
  });

  it('go on to the next call in a series, and to every call that repeats', async () => {
    const ann = await account('ann');
    const id = await workspace(ann, 'Launch');
    await make(ann, id, 'board', 'Flow');
    const flow = await idOf(ann, 'Flow');
    const first = await ann.api.meetings.create({ ...soon(), documents: [flow] });
    const next = await ann.api.meetings.scheduleNext(first.id, new Date(Date.now() + 8 * 86_400_000).toISOString());
    expect(next.documents).toEqual([{ id: flow, kind: 'board', by: 'Ann', name: 'Flow' }]);
    const start = Date.now() + 86_400_000;
    const repeating = await ann.api.meetings.create({ ...soon(), startsAt: new Date(start).toISOString(), documents: [flow], repeat: weekly(start, 3) });
    const calls = await inSeries(ann, repeating.seriesId);
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.documents).toEqual([{ id: flow, kind: 'board', by: 'Ann', name: 'Flow' }]);
  });

  it('never give someone who can’t open a restricted document its name, wherever they look', async () => {
    const ann = await account('ann');
    const kofi = await account('kofi');
    const dee = await account('dee');
    const id = await workspace(ann, 'Launch', [[kofi, 'admin']]);
    const closed = await make(ann, id, 'document', 'CANARY-CLOSED');
    await ann.api.workspaces.share.restrict(id, closed, true);
    const brought = await idOf(ann, 'CANARY-CLOSED');
    const m = await ann.api.meetings.create({ ...soon([kofi.email, dee.email]), documents: [brought] });
    expect(m.documents).toEqual([{ id: brought, kind: 'doc', by: 'Ann', name: 'CANARY-CLOSED' }]);

    for (const who of [kofi, dee]) {
      expect(await on(who, m.id)).toEqual([closedAs('Ann')]);
      const everything = JSON.stringify([await who.api.meetings.get(m.id), await who.api.meetings.upcoming(), await who.api.meetings.past(), await who.api.documents.list()]);
      expect(everything).not.toContain('CANARY');
      expect(everything).not.toContain(brought);
      // And bringing it to their own call, by what they're told or by its real ID, is refused as anything else they can't open is.
      const told = (await on(who, m.id)).map((d) => d.id);
      const madeUpOne = await refusal(who.api.meetings.create({ ...soon(), documents: [`${madeUp()}.${madeUp()}`] }));
      expect(await refusal(who.api.meetings.create({ ...soon(), documents: told }))).toEqual(madeUpOne);
      expect(await refusal(who.api.meetings.create({ ...soon(), documents: [brought] }))).toEqual(madeUpOne);
    }
    expect(h.logs.join('')).not.toContain('CANARY-CLOSED');

    // What they're told is a name, never an address, whether or not its maker's account is still there.
    expect(JSON.stringify(await on(dee, m.id))).not.toContain('@');
    await ann.api.workspaces.share.set(id, closed, [{ email: kofi.email }], 'read');
    expect((await on(kofi, m.id))[0]?.name).toBe('CANARY-CLOSED');
  });

  it('say nobody’s name when nobody in particular made one', async () => {
    const ann = await account('ann');
    const dee = await account('dee');
    const id = await workspace(ann, 'Launch');
    const made = await make(ann, id, 'document', 'From the call');
    const brought = await idOf(ann, 'From the call');
    const m = await ann.api.meetings.create({ ...soon([dee.email]), documents: [brought] });
    await rewrite(id, (s) => {
      const found = s.items[made];
      if (!found) throw new Error('no such item');
      return { ...s, items: { ...s.items, [made]: { ...found, by: null } } };
    });
    expect(listed(await ann.api.documents.list())[0]?.by).toBeNull();
    expect(await on(ann, m.id)).toEqual([{ id: brought, kind: 'doc', by: null, name: 'From the call' }]);
    expect(await on(dee, m.id)).toEqual([closedAs(null)]);
  });

  it('can’t be matched up by someone who can’t open them: not by two people, not across calls, not to the same workspace', async () => {
    const ann = await account('ann');
    const cas = await account('cas');
    const dee = await account('dee');
    const id = await workspace(ann, 'Launch');
    await make(ann, id, 'document', 'Plan');
    await make(ann, id, 'document', 'Budget');
    const plan = await idOf(ann, 'Plan');
    const budget = await idOf(ann, 'Budget');
    const guests = [cas.email, dee.email];
    const first = await ann.api.meetings.create({ ...soon(guests), documents: [plan, budget] });
    const second = await ann.api.meetings.create({ ...soon(guests), documents: [plan] });

    const told = async (who: Account, meetingId: string) => (await on(who, meetingId)).map((d) => d.id);
    const theirs = [...await told(dee, first.id), ...await told(dee, second.id), ...await told(cas, first.id), ...await told(cas, second.id)];
    // Six entries for two documents, and nothing says which are the same, or that they're in the same place.
    expect(theirs).toHaveLength(6);
    expect(new Set(theirs).size).toBe(6);
    for (const told of theirs) {
      expect(told).not.toContain('.');
      expect(`${plan}.${budget}`).not.toContain(told);
    }
    expect(JSON.stringify(await dee.api.meetings.upcoming())).not.toContain(id);

    // It's the same whenever they look and wherever they read it, so a screen can keep track of what it shows.
    expect(await told(dee, first.id)).toEqual(theirs.slice(0, 2));
    expect((await upcomingOn(dee, first.id))?.map((d) => d.id)).toEqual(theirs.slice(0, 2));

    // Whoever opens it is told what the call keeps, and being given it changes what they're told.
    await ann.api.workspaces.share.set(id, await make(ann, id, 'document', 'Unrelated'), [{ email: dee.email }], 'read');
    expect(await told(dee, first.id)).toEqual(theirs.slice(0, 2));
    await ann.api.workspaces.addPerson(id, dee.email, 'read');
    expect(await told(dee, first.id)).toEqual([plan, budget]);
    expect(await told(cas, first.id)).toEqual(theirs.slice(3, 5));
    // And what one person is told means nothing from anyone else.
    expect(await code(ann.api.meetings.update(first.id, { documents: theirs.slice(3, 5) }))).toBe('invalid');
  });

  it('are refused the same when they’re made up, someone else’s, or anything else that isn’t in the organizer’s library', async () => {
    const ann = await account('ann');
    const kofi = await account('kofi');
    const mine = await workspace(ann, 'Mine', [[kofi, 'edit']]);
    await make(ann, mine, 'document', 'Brief');
    const brief = await idOf(ann, 'Brief');
    const folder = await make(ann, mine, 'folder', 'Plans');
    const binned = await make(ann, mine, 'document', 'Binned');
    const binnedId = await idOf(ann, 'Binned');
    await ann.api.workspaces.items.trash(mine, binned);
    // Something restricted in a workspace Ann's in, and a workspace Ann isn't in.
    const hidden = await make(kofi, mine, 'document', 'Hidden');
    await kofi.api.workspaces.share.restrict(mine, hidden, true);
    const theirs = await workspace(kofi, 'Theirs');
    const other = await make(kofi, theirs, 'board', 'Other');
    const otherId = await idOf(kofi, 'Other');

    const m = await ann.api.meetings.create({ ...soon(), documents: [brief] });
    const expected = await refusal(ann.api.meetings.create({ ...soon(), documents: [`${madeUp()}.${madeUp()}`] }));
    expect(expected?.code).toBe('invalid');
    const others: [string, string][] = [
      ['a real document Ann can’t open', await idOf(kofi, 'Hidden')],
      ['a real document in a workspace Ann isn’t in', otherId],
      ['a real workspace and a made-up item', `${mine}.${madeUp()}`],
      ['a workspace Ann isn’t in and a made-up item', `${theirs}.${madeUp()}`],
      ['an item with another workspace’s ID', `${mine}.${other}`],
      ['the same the other way around', `${theirs}.${folder}`],
      ['a folder', `${mine}.${folder}`],
      ['something in Trash', binnedId],
      ['a bare item ID', other],
      ['a sample ID from before workspaces', 'vandelay.launch-plan'],
      ['nothing of the kind', 'nothing-of-the-kind']
    ];
    for (const [what, id] of others) {
      expect(await refusal(ann.api.meetings.create({ ...soon(), documents: [id] })), what).toEqual(expected);
      expect(await refusal(ann.api.meetings.update(m.id, { documents: [brief, id] })), what).toEqual(expected);
    }
    // Each document once.
    expect(await refusal(ann.api.meetings.create({ ...soon(), documents: [brief, brief] }))).toEqual(expected);
    expect(await refusal(ann.api.meetings.update(m.id, { documents: [brief, brief] }))).toEqual(expected);
    // Nothing changed, and nothing about any of it went anywhere.
    expect((await on(ann, m.id)).map((d) => d.id)).toEqual([brief]);
    expect(h.logs.join('')).not.toContain(otherId);

    // Someone else's call is someone else's, whatever comes with the request.
    expect(await code(kofi.api.meetings.update(m.id, { documents: [] }))).toBe('not-found');
    expect(await code(kofi.api.meetings.update(m.id, { documents: [otherId] }))).toBe('not-found');
    // Twelve at most, by the contract.
    expect(await code(ann.api.meetings.create({ ...soon(), documents: Array.from({ length: 13 }, () => madeUp()) }))).toBe('invalid');
  });

  it('stay on a call when its organizer loses them, for them to take off, and no request can add them again', async () => {
    const ann = await account('ann');
    const kofi = await account('kofi');
    const id = await workspace(kofi, 'Theirs', [[ann, 'read']]);
    await make(kofi, id, 'document', 'Plan');
    await make(kofi, id, 'document', 'Notes');
    const plan = await idOf(ann, 'Plan');
    const notes = await idOf(ann, 'Notes');
    const mine = await workspace(ann, 'Mine');
    await make(ann, mine, 'document', 'Brief');
    const brief = await idOf(ann, 'Brief');
    const m = await ann.api.meetings.create({ ...soon([kofi.email]), documents: [plan] });

    await takeOut(kofi, id, ann);
    expect(await on(ann, m.id)).toEqual([closedAs('Kofi')]);
    expect((await on(kofi, m.id))[0]?.name).toBe('Plan');
    // It isn't in Ann's library any more, and that doesn't stop Ann changing the call: only what's new has to be. Ann's
    // screen sends the list back as it was told, and the call goes on keeping the same thing.
    expect(await namesOf(ann)).toEqual(['Brief']);
    const told = (await on(ann, m.id)).map((d) => d.id);
    expect((await ann.api.meetings.update(m.id, { documents: [...told, brief] })).documents.map((d) => d.id)).toEqual([...told, brief]);
    const o = await openOwner(h.deps, ann.ownerId, undefined);
    expect((await findItem(o, h.pool, 'meeting', m.id, MeetingManifest))?.manifest.documents).toEqual([plan, brief]);
    expect(await refusal(ann.api.meetings.update(m.id, { documents: [...told, brief, notes] }))).toEqual(await refusal(ann.api.meetings.update(m.id, { documents: [...told, brief, `${madeUp()}.${madeUp()}`] })));
    // By the ID Ann had before losing it, it's the same thing, so one list can't hold it twice.
    expect((await ann.api.meetings.update(m.id, { documents: [plan, brief] })).documents.map((d) => d.id)).toEqual([...told, brief]);
    expect(await code(ann.api.meetings.update(m.id, { documents: [plan, ...told, brief] }))).toBe('invalid');
    // What Ann's told on this call means nothing on another.
    const other = await ann.api.meetings.create({ ...soon([kofi.email]) });
    expect(await code(ann.api.meetings.update(other.id, { documents: told }))).toBe('invalid');
    // Off the call, no request can add it, here or to another call: it's as anything else Ann can't open.
    expect((await ann.api.meetings.update(m.id, { documents: [brief] })).documents.map((d) => d.id)).toEqual([brief]);
    expect(await code(ann.api.meetings.update(m.id, { documents: [...told, brief] }))).toBe('invalid');
    expect(await code(ann.api.meetings.update(m.id, { documents: [plan, brief] }))).toBe('invalid');
    expect(await code(ann.api.meetings.create({ ...soon(), documents: [plan] }))).toBe('invalid');
  });

  it('go along a series as they’re kept, so one its organizer has lost can reach later calls, and nobody there learns more', async () => {
    const ann = await account('ann');
    const kofi = await account('kofi');
    const dee = await account('dee');
    const id = await workspace(kofi, 'Theirs', [[ann, 'read']]);
    await make(kofi, id, 'document', 'CANARY-PLAN');
    const plan = await idOf(ann, 'CANARY-PLAN');
    const mine = await workspace(ann, 'Mine');
    await make(ann, mine, 'document', 'Brief');
    const brief = await idOf(ann, 'Brief');
    const start = Date.now() + 86_400_000;
    const guests = [kofi.email, dee.email];
    const repeating = await ann.api.meetings.create({ ...soon(guests), startsAt: new Date(start).toISOString(), documents: [plan], repeat: weekly(start, 2) });
    const single = await ann.api.meetings.create({ ...soon(guests), documents: [plan] });
    await takeOut(kofi, id, ann);
    const shut = closedAs('Kofi');

    // The next call in a series takes the list as it's kept.
    expect((await ann.api.meetings.scheduleNext(single.id, new Date(Date.now() + WEEK).toISOString())).documents).toEqual([shut]);
    // A change to this and later calls writes what it's given to each of them, what this call keeps included, and the
    // calls a repeat adds copy the call before them.
    await ann.api.meetings.update(repeating.id, { documents: [...(await on(ann, repeating.id)).map((d) => d.id), brief] }, { scope: 'following' });
    await ann.api.meetings.update(repeating.id, { repeat: weekly(start, 3) }, { scope: 'following' });
    const calls = await inSeries(ann, repeating.seriesId);
    expect(calls).toHaveLength(3);
    expect(new Set(calls.flatMap((c) => c.documents.map((d) => d.id))).size).toBe(4);
    for (const call of calls) {
      expect(call.documents).toEqual([shut, { id: brief, kind: 'doc', by: 'Ann', name: 'Brief' }]);
      // Everyone on each of them is told what they'd be told on any call: a name only if they can open it.
      expect((await on(kofi, call.id))[0]?.name).toBe('CANARY-PLAN');
      expect((await on(dee, call.id))[0]).toEqual(shut);
    }
    // None of that makes it something Ann can bring.
    expect(await namesOf(ann)).toEqual(['Brief']);
    expect(await code(ann.api.meetings.create({ ...soon(), documents: [plan] }))).toBe('invalid');
  });

  it('drop out when they’re in Trash or gone, come back when they’re restored, and break nothing', async () => {
    const ann = await account('ann');
    const dee = await account('dee');
    const id = await workspace(ann, 'Launch');
    const folder = await make(ann, id, 'folder', 'Plans');
    const plan = await make(ann, id, 'document', 'Plan', folder);
    const board = await make(ann, id, 'board', 'Board');
    const other = await workspace(ann, 'Other');
    await make(ann, other, 'document', 'Stays');
    const brought = [await idOf(ann, 'Plan'), await idOf(ann, 'Board'), await idOf(ann, 'Stays')];
    const [planId = '', boardId = '', staysId = ''] = brought;
    const m = await ann.api.meetings.create({ ...soon([dee.email]), documents: brought });
    const ids = async (who: Account) => (await on(who, m.id)).map((d) => d.id);
    const [planFor = '', boardFor = '', staysFor = ''] = await ids(dee);

    await ann.api.workspaces.items.trash(id, board);
    expect(await ids(ann)).toEqual([planId, staysId]);
    expect(await ids(dee)).toEqual([planFor, staysFor]);
    await ann.api.workspaces.items.restore(id, board);
    expect(await ids(dee)).toEqual([planFor, boardFor, staysFor]);

    // A folder takes what's in it to Trash, and brings it back.
    await ann.api.workspaces.items.trash(id, folder);
    expect(await ids(ann)).toEqual([boardId, staysId]);
    await ann.api.workspaces.items.restore(id, folder);
    expect(await ids(ann)).toEqual([planId, boardId, staysId]);

    await ann.api.workspaces.items.trash(id, plan);
    await ann.api.workspaces.items.deleteForever(id, plan);
    expect(await ids(ann)).toEqual([boardId, staysId]);
    expect(await ids(dee)).toEqual([boardFor, staysFor]);

    // Saving what the call shows takes them off for good; anything else leaves its IDs as they are.
    await ann.api.meetings.update(m.id, { title: 'Still here' });
    await ann.api.workspaces.remove(id);
    expect(await ids(ann)).toEqual([staysId]);
    expect((await upcomingOn(dee, m.id))?.map((d) => d.id)).toEqual([staysFor]);
    expect((await ann.api.meetings.update(m.id, { documents: [staysId] })).documents.map((d) => d.id)).toEqual([staysId]);
  });

  it('go when the only person who could open one deletes their account, and stay for everyone else', async () => {
    const ann = await account('ann');
    const kofi = await account('kofi');
    const dee = await account('dee');
    const id = await workspace(ann, 'Launch', [[kofi, 'admin']]);
    const closed = await make(kofi, id, 'document', 'Theirs alone');
    await kofi.api.workspaces.share.restrict(id, closed, true);
    await make(kofi, id, 'document', 'For everyone');
    const theirs = await idOf(kofi, 'Theirs alone');
    const open = await idOf(kofi, 'For everyone');
    const m = await kofi.api.meetings.create({ ...soon([ann.email]), documents: [theirs, open] });
    const n = await ann.api.meetings.create({ ...soon([dee.email]), documents: [open] });
    expect(await on(ann, m.id)).toEqual([closedAs('Kofi'), { id: open, kind: 'doc', by: 'Kofi', name: 'For everyone' }]);

    await kofi.api.account.delete();
    // What its maker made keeps their name and loses their address.
    expect(await on(ann, n.id)).toEqual([{ id: open, kind: 'doc', by: 'Kofi', name: 'For everyone' }]);
    expect(await on(dee, n.id)).toEqual([closedAs('Kofi')]);
    expect(listed(await ann.api.documents.list()).map((d) => d.name)).toEqual(['For everyone']);
  });

  it('read fine when a call was stored with IDs from before workspaces, which simply aren’t listed', async () => {
    const ann = await account('ann');
    const dee = await account('dee');
    const id = await workspace(ann, 'Launch');
    await make(ann, id, 'document', 'Real');
    const real = await idOf(ann, 'Real');
    const m = await ann.api.meetings.create({ ...soon([dee.email]) });
    const old = ['vandelay.launch-plan', 'vandelay.launch-checklist', `own.${'A1_-'.repeat(4)}.proposal.Zara`, `own.${'A1_-'.repeat(4)}.rates.J%C3%B3`, 'since-deleted', ''];
    await stored(ann, m.id, [...old, real]);

    const shown = [{ id: real, kind: 'doc', by: 'Ann', name: 'Real' }];
    expect(await on(ann, m.id)).toEqual(shown);
    expect(await upcomingOn(ann, m.id)).toEqual(shown);
    expect(await on(dee, m.id)).toEqual([closedAs('Ann')]);

    // Nothing else about the call minds, and what's saved next is what the call showed.
    expect((await ann.api.meetings.update(m.id, { title: 'Renamed' })).documents).toEqual(shown);
    expect((await ann.api.meetings.update(m.id, { documents: [real] })).documents).toEqual(shown);
    const o = await openOwner(h.deps, ann.ownerId, undefined);
    expect((await findItem(o, h.pool, 'meeting', m.id, MeetingManifest))?.manifest.documents).toEqual([real]);

    // Only old IDs on a call: none listed, and it opens as a call with nothing brought.
    await stored(ann, m.id, old);
    expect(await on(ann, m.id)).toEqual([]);
  });

  it('don’t take a call down with them when a workspace can’t be read', async () => {
    const ann = await account('ann');
    const bad = await workspace(ann, 'Bad');
    await make(ann, bad, 'document', 'Unreadable');
    const good = await workspace(ann, 'Good');
    await make(ann, good, 'document', 'Readable');
    const unreadable = await idOf(ann, 'Unreadable');
    const readable = await idOf(ann, 'Readable');
    const m = await ann.api.meetings.create({ ...soon(), documents: [unreadable, readable] });
    await h.pool.query('UPDATE workspaces SET state_ciphertext = $2 WHERE workspace_id = $1', [bad, randomBytes(96)]);
    expect((await on(ann, m.id)).map((d) => d.id)).toEqual([readable]);
    expect((await upcomingOn(ann, m.id))?.map((d) => d.id)).toEqual([readable]);
    await until(() => h.logs.some((l) => l.includes('documents not read') && l.includes(bad)), 'the log to say which workspace');
  });

  it('never reach a receipt: a retry comes back without them, because a receipt outlives what it was about', async () => {
    const ann = await account('ann');
    const id = await workspace(ann, 'Launch');
    const made = await make(ann, id, 'document', 'CANARY-RECEIPT');
    const brought = await idOf(ann, 'CANARY-RECEIPT');
    const AnswerSchema = z.object({ id: z.string(), documents: z.array(z.unknown()) });
    const send = (who: Account, method: string, path: string, body: unknown, op: string) => who.fetch(`${h.baseUrl}/v1${path}`, { method, headers: { 'content-type': 'application/json', [OPERATION_HEADER]: op }, body: JSON.stringify(body) });
    const once = async (who: Account, method: string, path: string, body: unknown) => {
      const op = madeUp();
      const first = await (await send(who, method, path, body, op)).text();
      expect(first).toContain('CANARY-RECEIPT');
      const again = await send(who, method, path, body, op);
      expect(again.status).toBe(200);
      const text = await again.text();
      expect(text).not.toContain('CANARY-RECEIPT');
      expect(text).not.toContain(made);
      return { first: AnswerSchema.parse(JSON.parse(first)), again: AnswerSchema.parse(JSON.parse(text)) };
    };

    const calls = async () => (await ann.api.meetings.upcoming()).length;
    const before = await calls();
    const scheduled = await once(ann, 'POST', '/meetings', { ...soon(), documents: [brought] });
    // It's the same call, not a second one.
    expect(scheduled.again).toEqual({ id: scheduled.first.id, documents: [] });
    expect(await calls()).toBe(before + 1);
    await once(ann, 'PATCH', `/meetings/${scheduled.first.id}`, { title: 'Renamed' });
    await once(ann, 'POST', `/meetings/${scheduled.first.id}/next`, { startsAt: new Date(Date.now() + 8 * 86_400_000).toISOString() });
    expect(await calls()).toBe(before + 2);

    // Adopting an event a second time answers with the call it already is, which by then can have documents on it.
    const gia = await withGoogle('gia');
    const at = (ms: number) => ({ dateTime: new Date(Date.now() + ms).toISOString() });
    h.google.calendar(gia.sub).push({ id: 'their-own', summary: 'Standing call', start: at(86_400_000), end: at(88_200_000), organizer: { email: gia.email, self: true } });
    const adopted = await gia.api.calendar.adopt('their-own', 'off');
    const space = await workspace(gia, 'Launch');
    await make(gia, space, 'document', 'CANARY-RECEIPT');
    await gia.api.meetings.update(adopted.id, { documents: [await idOf(gia, 'CANARY-RECEIPT')] });
    const again = await once(gia, 'POST', '/calendar/events/their-own/adopt', { notes: 'off' });
    expect(again.again).toEqual({ id: adopted.id, documents: [] });

    // A call with nothing brought answers a retry with exactly what it said.
    const op = madeUp();
    const input = soon();
    const plain = await (await send(ann, 'POST', '/meetings', input, op)).text();
    expect(await (await send(ann, 'POST', '/meetings', input, op)).text()).toBe(plain);
  });
});

describe('guests in a call', () => {
  const inGroup = (call: CallSession) => until(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
  async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
    for (let i = 0; i < 200 && !pred(call.getSnapshot()); i++) { await call.refresh(); await new Promise((r) => setTimeout(r, 30)); }
    return call.getSnapshot();
  }
  /** Someone joining by a call's link and being let in, with the seat they're given. */
  async function letIn(host: CallSession, b: Browser, code: string, name?: string) {
    const call = await b.api.calls.join(code, { mic: false, cam: false, ...(name ? { name } : {}) });
    await settle(host, (s) => s.waiting.some((w) => w.id === call.ticket.identity));
    await host.admit(call.ticket.identity);
    await inGroup(call);
    const seat = (await settle(host, (s) => s.participants.some((p) => p.id === call.ticket.identity))).participants.find((p) => p.id === call.ticket.identity)?.seat ?? '';
    return { call, pass: call.ticket.pass, seat };
  }

  it('hear nothing of what was brought, and read a document only by being given it, with who made it by name alone', async () => {
    const ann = await account('ann');
    const id = await workspace(ann, 'CANARY-SPACE');
    const doc = await make(ann, id, 'document', 'CANARY-PLAN');
    const brought = await idOf(ann, 'CANARY-PLAN');
    const m = await ann.api.meetings.create({ ...soon(), documents: [brought] });
    const host = await ann.api.calls.join(m.code, { mic: false, cam: false });
    await inGroup(host);
    const b = h.browser();
    const { call, pass, seat } = await letIn(host, b, m.code, 'Sam Guest');

    // What a guest has of the call says nothing about what was brought to it: no name, no ID, nobody's.
    const seen = JSON.stringify([call.getSnapshot(), await b.api.calls.card(m.code)]);
    expect(seen).not.toContain('CANARY');
    expect(seen).not.toContain(doc);
    expect(seen).not.toContain(id);
    // A pass reaches neither a library nor a meeting: those are for accounts.
    const withPass = (path: string) => b.fetch(`${h.baseUrl}/v1${path}`, { headers: { [CALL_PASS_HEADER]: pass } });
    expect((await withPass('/documents')).status).toBe(401);
    expect((await withPass(`/meetings/${m.id}`)).status).toBe(401);
    expect((await withPass(`/calls/${m.code}/meeting`)).status).toBe(401);
    // Being in the call gives nothing.
    expect(await code(b.api.workspaces.items.get(id, doc, { pass }))).toBe('not-found');

    await ann.api.workspaces.share.set(id, doc, [{ seat }], 'read', { pass: host.ticket.pass });
    const item = await b.api.workspaces.items.get(id, doc, { pass });
    expect(item.name).toBe('CANARY-PLAN');
    expect(item.by?.name).toBe(ann.name);
    expect(JSON.stringify(item)).not.toContain('@');
    await host.leave();
  });

  it('can’t bring what their seat gave them: that ends with the call, and a library is what an account can open', async () => {
    const ann = await account('ann');
    const id = await workspace(ann, 'Launch');
    const doc = await make(ann, id, 'document', 'Plan');
    const brought = await idOf(ann, 'Plan');
    const { code: joinCode } = await ann.api.calls.startNow({ notes: 'off' });
    const host = await ann.api.calls.join(joinCode, { mic: false, cam: false });
    await inGroup(host);
    const sam = await account('sam');
    const { pass, seat } = await letIn(host, sam, joinCode);
    await ann.api.workspaces.share.set(id, doc, [{ seat }], 'read', { pass: host.ticket.pass });

    // Their seat opens it, and their account doesn't.
    expect((await sam.api.workspaces.items.get(id, doc, { pass })).name).toBe('Plan');
    expect(await sam.api.documents.list()).toEqual({ workspaces: [] });
    expect(await refusal(sam.api.meetings.create({ ...soon(), documents: [brought] }))).toEqual(await refusal(sam.api.meetings.create({ ...soon(), documents: [`${madeUp()}.${madeUp()}`] })));
    await host.leave();
  });
});
