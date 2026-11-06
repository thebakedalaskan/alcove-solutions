/**
 * A call's home, through browsers talking to the real API over HTTP via @alcove/api-http, on real Postgres, the local LiveKit
 * server and the stand-in NEAR AI: a new workspace for each call by default, or the one chosen when it was scheduled; the
 * call's own folder at the top of it, whose pages read the call while it's on and its note after, through their own access;
 * switching what's viewed without moving where the notes go; and who's in a home made for a call, which follows its invite.
 */
import { AlcoveApiError, type CallSession, type CallState, type ItemCall, type Note, type TranscriptClip, type WorkspaceItem, type WorkspaceReadOptions } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { id128, sealJson, stateKey, toJson } from './crypto';
import { tx } from './db';
import { saveState, serverWorkspace, type StoredItem } from './modules/workspaceAccess';
import { speechWav } from './testing/fake-near';
import { startHarness, type Browser, type Harness } from './testing/harness';
import { disposeLiveKit } from './testing/livekit';

vi.setConfig({ testTimeout: 120_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(() => { h.closeCalls(); });

let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
type Account = Browser & { email: string; name: string; ownerId: string };
async function account(email = unique()): Promise<Account> {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email });
  return { ...b, email: session.user.email, name: session.user.name, ownerId: session.ownerId };
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
async function settle(call: CallSession, pred: (s: CallState) => boolean, ms = 15_000): Promise<CallState> {
  const by = Date.now() + ms;
  while (!pred(call.getSnapshot()) && Date.now() < by) { await call.refresh(); await rest(30); }
  return call.getSnapshot();
}
const space = async (call: CallSession) => { await call.refresh({ call: true, log: false }); return call.getSnapshot().workspace; };
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await inGroup(who);
  await settle(host, (s) => s.participants.some((p) => p.id === who.ticket.identity));
}
async function invited(host: CallSession, callCode: string, who: Account) {
  const call = await who.api.calls.join(callCode, { mic: false, cam: false });
  await inGroup(call);
  await settle(host, (s) => s.participants.some((p) => p.id === call.ticket.identity));
  return call;
}
async function callBy(org: Account, o: { notes?: 'on' | 'off'; guests?: string[]; title?: string } = {}) {
  const { code: c } = await org.api.calls.startNow({ notes: o.notes ?? 'off', guests: o.guests ?? [], ...(o.title ? { title: o.title } : {}) });
  const host = await org.api.calls.join(c, { mic: false, cam: false });
  await inGroup(host);
  return { host, code: c };
}
const speech = (words: string, segment: number, atMs: number, ms = 4000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment, at: atMs / 1000, durationMs: ms });
const noteOf = async (who: Account, noteId: string | null | undefined): Promise<Note> => {
  const by = Date.now() + 30_000;
  for (;;) {
    const n = await who.api.notes.get(noteId ?? '');
    if (n.status === 'ready') return n;
    if (Date.now() > by) throw new Error('timed out waiting for the notes');
    await rest(40);
  }
};
/** The call folders in a workspace as `who` reads it. */
const folders = async (who: Browser, workspaceId: string, opts?: WorkspaceReadOptions): Promise<(WorkspaceItem & { call: ItemCall })[]> =>
  (await who.api.workspaces.get(workspaceId, opts)).items.flatMap((x) => (x.call ? [{ ...x, call: x.call }] : []));
const peopleIn = async (who: Account, workspaceId: string) => Object.fromEntries((await who.api.workspaces.people(workspaceId)).map((p) => [p.person.email, p.role]));
const DAY = /^\d{1,2} \p{L}{3,4}$/u;
/** Someone's place in a workspace, to take them out or change it. */
const placeOf = async (who: Account, workspaceId: string, email: string) => (await who.api.workspaces.people(workspaceId)).find((p) => p.person.email === email)?.id ?? '';
/** A workspace as full as one can be, written straight into its sealed state: making 5,000 things through the API would take minutes. */
async function fill(workspaceId: string): Promise<void> {
  await tx(h.pool, async (c) => {
    const w = await serverWorkspace(h.deps, workspaceId, c, 'change');
    if (!w) throw new Error('no workspace');
    const now = new Date().toISOString();
    const items: Record<string, StoredItem> = { ...w.state.items };
    for (let i = Object.keys(items).length; i < 5000; i++) items[id128()] = { kind: 'document', name: `Planning notes ${i}`, parent: null, pos: `a${String(i).padStart(6, '0')}`, by: null, createdAt: now, editedAt: now, trashedAt: null, trashedBy: null, restricted: false, restrictedBy: null, call: null };
    w.state = { ...w.state, items };
    await saveState(w, c);
  });
}
/** How tags named someone before IDs were keyed: a plain hash of their address, the same anywhere. */
function plainHash(value: string): string {
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  return `p${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

describe('a call’s home', () => {
  it('is a new workspace for each call: named after it and the day, its folder at the top, the organizer and everyone invited in it, a guest nowhere', async () => {
    const ann = await account();
    const kofi = await account();
    const priya = await account();
    const { host, code: c } = await callBy(ann, { guests: [kofi.email, priya.email], title: 'Launch check-in' });
    const k = await invited(host, c, kofi);
    const jamie = await h.browser().api.calls.join(c, { mic: false, cam: false, name: 'Jamie Guest' });
    await letIn(host, jamie);
    await host.openWorkspace();

    const home = (await space(host)).home ?? '';
    expect(home).not.toBe('');
    const [listed] = await ann.api.workspaces.list();
    expect(listed).toMatchObject({ id: home, role: 'admin', people: 3, call: { title: 'Launch check-in', at: expect.any(String) } });
    const [title, day] = (listed?.name ?? '').split(' · ');
    expect(title).toBe('Launch check-in');
    expect(day).toMatch(DAY);
    // The organizer is its admin, and everyone invited is in it to edit, whether or not they've come: they get the notes.
    expect(await peopleIn(ann, home)).toEqual({ [ann.email]: 'admin', [kofi.email]: 'edit', [priya.email]: 'edit' });
    expect(await space(k)).toMatchObject({ id: home, home, canOpen: true, role: 'edit' });
    expect(await priya.api.workspaces.list()).toEqual([expect.objectContaining({ id: home, role: 'edit', call: { title: 'Launch check-in', at: expect.any(String) } })]);
    // A guest has nothing in it, and isn't told which it is.
    expect(await space(jamie)).toMatchObject({ id: null, home: null, canOpen: false });
    expect(await code(h.browser().api.workspaces.get(home, { pass: jamie.ticket.pass }))).toBe('not-found');

    // The call's folder is at the top, named as the home is. Its pages are live for whoever's in the call, and nobody else.
    const tree = await ann.api.workspaces.get(home);
    expect(tree.items).toEqual([expect.objectContaining({ kind: 'folder', name: listed?.name, parent: null, call: { startedAt: expect.any(String), on: true, here: false, noteId: null } })]);
    expect(await folders(kofi, home, { pass: k.ticket.pass })).toEqual([expect.objectContaining({ call: expect.objectContaining({ on: true, here: true, noteId: null }) })]);
    expect(await folders(priya, home)).toEqual([expect.objectContaining({ call: expect.objectContaining({ on: true, here: false }) })]);
    // Nothing of the call is in it: a folder holds no content.
    expect(await h.pool.query('SELECT count(*)::int AS n FROM documents d JOIN workspaces w ON w.owner_id = d.owner_id WHERE w.workspace_id = $1', [home]).then((r) => r.rows[0]?.n)).toBe(0);
    await host.leave();

    // The next call gets its own, newest first in the Drive.
    const next = await callBy(ann, { title: 'Launch check-in' });
    await next.host.openWorkspace();
    const second = (await space(next.host)).home;
    expect(second).not.toBe(home);
    expect((await ann.api.workspaces.list()).map((w) => w.id)).toEqual([second, home]);
    expect(await peopleIn(ann, second ?? '')).toEqual({ [ann.email]: 'admin' });
    await next.host.leave();
  });

  it('is the workspace chosen when it was scheduled: each call it’s home to gets a folder there, and nothing new is made', async () => {
    const ann = await account();
    const priya = await account();
    const theo = await account();
    const { id: product } = await ann.api.workspaces.create('Product');
    await ann.api.workspaces.addPerson(product, priya.email, 'edit');
    const at = Date.now() + 3_600_000;
    const schedule = (title: string) => ann.api.meetings.create({ title, startsAt: new Date(at).toISOString(), durationMinutes: 30, guests: [theo.email], notes: 'off', workspaceId: product });
    const start = async (callCode: string) => {
      const host = await ann.api.calls.join(callCode, { mic: false, cam: false });
      await inGroup(host);
      await host.openWorkspace();
      return host;
    };
    const first = await start((await schedule('Design review')).code);
    expect(await space(first)).toMatchObject({ id: product, home: product });
    await first.leave();
    await until(async () => (await folders(ann, product))[0]?.call.on === false, 'the first call’s folder to hear it’s over');
    const second = await start((await schedule('Pricing')).code);
    expect(await space(second)).toMatchObject({ id: product, home: product });

    // One workspace, still: a chosen home has a folder for each call, the newest at the top, and its people stay as they are.
    expect((await ann.api.workspaces.list()).map((w) => w.id)).toEqual([product]);
    const there = await folders(ann, product);
    expect(there.map((f) => f.name.split(' · ')[0])).toEqual(['Pricing', 'Design review']);
    expect(there.map((f) => f.call.on)).toEqual([true, false]);
    expect(await peopleIn(ann, product)).toEqual({ [ann.email]: 'admin', [priya.email]: 'edit' });
    // Someone invited who isn't in it isn't let in by the call: to them it's private.
    expect(await code(theo.api.workspaces.get(product))).toBe('not-found');
    // A home the organizer can no longer make things in isn't theirs to use: the call gets a new one.
    const later = await schedule('Roadmap');
    await ann.api.workspaces.addPerson(product, priya.email, 'admin');
    const people = await priya.api.workspaces.people(product);
    await priya.api.workspaces.setRole(product, people.find((p) => p.person.email === ann.email)?.id ?? '', 'read');
    await second.leave();
    const third = await start(later.code);
    const fresh = (await space(third)).home;
    expect(fresh).not.toBe(product);
    expect((await folders(priya, product)).map((f) => f.name.split(' · ')[0])).toEqual(['Pricing', 'Design review']);
    await third.leave();
  });

  it('is a new workspace when the one chosen has no room for the call’s folder, and only a folder that’s there counts', async () => {
    const ann = await account();
    const kofi = await account();
    const { id: product } = await ann.api.workspaces.create('Product');
    await fill(product);
    const m = await ann.api.meetings.create({ title: 'Full', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [kofi.email], notes: 'on', workspaceId: product });
    const host = await ann.api.calls.join(m.code, { mic: false, cam: false });
    await inGroup(host);
    await host.openWorkspace();

    // A home of its own, made for the call, with its folder and everyone invited; the meeting names it from now on.
    const home = (await space(host)).home ?? '';
    expect(home).not.toBe('');
    expect(home).not.toBe(product);
    expect((await folders(ann, home)).map((f) => f.name.split(' · ')[0])).toEqual(['Full']);
    expect(await peopleIn(ann, home)).toEqual({ [ann.email]: 'admin', [kofi.email]: 'edit' });
    expect((await ann.api.meetings.get(m.id)).workspaceId).toBe(home);
    // The full one is as it was: no folder in it, nothing more in it.
    expect(await folders(ann, product)).toEqual([]);
    expect((await ann.api.workspaces.get(product)).items).toHaveLength(5000);

    // Its note lands in the new home's folder when the call ends.
    await host.transcribe(speech('Kofi takes the launch list.', 0, 0), host.ticket.identity);
    const ended = await host.leave();
    const noteId = ended?.pendingNoteId ?? '';
    await noteOf(ann, noteId);
    await until(async () => (await folders(ann, home))[0]?.call.noteId === noteId, 'the folder to read the note');
    expect(await folders(ann, product)).toEqual([]);
  });

  it('stays where it is when everyone views another workspace: the notes and transcript still go home', async () => {
    const ann = await account();
    const kofi = await account();
    const { id: design } = await ann.api.workspaces.create('Design');
    await ann.api.workspaces.addPerson(design, kofi.email, 'edit');
    const { host, code: c } = await callBy(ann, { notes: 'on', guests: [kofi.email], title: 'Weekly' });
    const k = await invited(host, c, kofi);
    await host.transcribe(speech('We agreed the pricing page goes live first.', 0, 0), host.ticket.identity);
    await host.openWorkspace();
    const home = (await space(host)).home ?? '';
    const meetingId = host.getSnapshot().meetingId;

    await host.setWorkspace(design);
    expect(await space(host)).toMatchObject({ id: design, home, name: 'Design' });
    expect(await space(k)).toMatchObject({ id: design, home });
    expect((await ann.api.meetings.get(meetingId)).workspaceId).toBe(home);
    expect(await folders(ann, design)).toEqual([]);
    // Back home, the same folder.
    await host.setWorkspace(home);
    expect(await space(k)).toMatchObject({ id: home, home });
    await host.setWorkspace(design);

    const ended = await host.leave();
    const noteId = ended?.pendingNoteId ?? '';
    await noteOf(ann, noteId);
    // The folder in the home reads the note now, and the workspace that was viewed has none.
    await until(async () => (await folders(ann, home))[0]?.call.noteId === noteId, 'the folder to read the note');
    expect(await folders(ann, home)).toEqual([expect.objectContaining({ call: expect.objectContaining({ on: false, here: false, noteId }) })]);
    expect(await folders(ann, design)).toEqual([]);
    expect((await ann.api.meetings.get(meetingId)).workspaceId).toBe(home);
  });

  it('gives a call that had notes, and never opened Workspace, a home when it ends', async () => {
    const ann = await account();
    const kofi = await account();
    const { host, code: c } = await callBy(ann, { notes: 'on', guests: [kofi.email], title: 'Quick sync' });
    await invited(host, c, kofi);
    await host.transcribe(speech('Kofi will send the deck to legal by Friday.', 0, 0), host.ticket.identity);
    const ended = await host.leave();
    const noteId = ended?.pendingNoteId ?? '';
    await noteOf(ann, noteId);
    await until(async () => (await ann.api.workspaces.list()).length === 1, 'a home for the call');
    const [home] = await ann.api.workspaces.list();
    expect(home?.name?.split(' · ')[0]).toBe('Quick sync');
    expect(await peopleIn(ann, home?.id ?? '')).toEqual({ [ann.email]: 'admin', [kofi.email]: 'edit' });
    await until(async () => (await folders(kofi, home?.id ?? ''))[0]?.call.noteId === noteId, 'Kofi’s folder to read the note');
    // A call with notes off that nobody opened Workspace in makes none.
    const quiet = await callBy(ann, { title: 'Nothing kept' });
    await quiet.host.leave();
    await rest(400);
    expect(await ann.api.workspaces.list()).toHaveLength(1);
  });
});

describe('the call’s folder', () => {
  it('reads the note through its own access: whoever has it, and nobody else, as that changes', async () => {
    const ann = await account();
    const kofi = await account();
    const lena = await account();
    const { host, code: c } = await callBy(ann, { notes: 'on', guests: [kofi.email], title: 'Board prep' });
    const k = await invited(host, c, kofi);
    await host.transcribe(speech('CANARY-FOLDERSAID the board meets on the twelfth.', 0, 0), host.ticket.identity);
    await host.openWorkspace();
    const home = (await space(host)).home ?? '';
    // Lena's added to the home by hand: she's in it, and not invited, so she doesn't get the notes.
    await ann.api.workspaces.addPerson(home, lena.email, 'edit');
    expect(await folders(lena, home)).toEqual([expect.objectContaining({ call: expect.objectContaining({ on: true, here: false, noteId: null }) })]);
    expect(await folders(kofi, home, { pass: k.ticket.pass })).toEqual([expect.objectContaining({ call: expect.objectContaining({ here: true }) })]);

    const ended = await host.leave();
    const noteId = ended?.pendingNoteId ?? '';
    await noteOf(ann, noteId);
    await until(async () => (await folders(ann, home))[0]?.call.noteId === noteId, 'the folder to read the note');
    const noteOn = async (who: Account) => (await folders(who, home))[0]?.call.noteId ?? null;
    expect(await noteOn(kofi)).toBe(noteId);
    expect(await noteOn(lena)).toBeNull();
    expect(await code(lena.api.notes.get(noteId))).toBe('not-found');

    // Kofi takes the note out of his notes: its pages go from his folder. Ann shares it with Lena: they come to hers.
    await kofi.api.notes.delete(noteId);
    expect(await noteOn(kofi)).toBeNull();
    await ann.api.notes.share(noteId, { emails: [lena.email] });
    expect(await noteOn(lena)).toBe(noteId);
    // Ann deletes the note: it's gone from everyone's folder, and the folder stays.
    await ann.api.notes.delete(noteId);
    expect(await noteOn(ann)).toBeNull();
    expect(await noteOn(lena)).toBeNull();
    expect(await folders(lena, home)).toHaveLength(1);

    // It's a folder like any other: renamed, moved, sent to Trash and back; a copy of it is a plain folder.
    const [folder] = await folders(ann, home);
    const id = folder?.id ?? '';
    await ann.api.workspaces.items.rename(home, id, 'Board prep, first week');
    const outer = (await ann.api.workspaces.items.create(home, { kind: 'folder', name: 'Archive' })).id;
    await ann.api.workspaces.items.move(home, id, { parent: outer });
    const copy = (await ann.api.workspaces.items.duplicate(home, id)).id;
    const items = (await ann.api.workspaces.get(home)).items;
    expect(items.find((x) => x.id === id)).toMatchObject({ name: 'Board prep, first week', parent: outer, call: expect.objectContaining({ on: false }) });
    expect(items.find((x) => x.id === copy)).toMatchObject({ kind: 'folder', call: null });
    // Nothing of the note went into the workspace.
    const w = await serverWorkspace(h.deps, home);
    expect(JSON.stringify(w?.state)).not.toContain('CANARY-FOLDERSAID');
  });

  it('says which of its pages someone’s on to everyone in the call, so they can follow them there, and to anyone else only that they’re elsewhere', async () => {
    const ann = await account();
    const kofi = await account();
    const lena = await account();
    const { host, code: c } = await callBy(ann, { guests: [kofi.email], title: 'Pricing' });
    const k = await invited(host, c, kofi);
    await host.openWorkspace();
    const home = (await space(host)).home ?? '';
    // Lena's in the workspace and not in the call.
    await ann.api.workspaces.addPerson(home, lena.email, 'edit');
    const annSees = ann.api.workspaces.live(home, { pass: host.ticket.pass });
    const kofiIs = kofi.api.workspaces.live(home, { pass: k.ticket.pass });
    const lenaSees = lena.api.workspaces.live(home);
    await until(() => [annSees, kofiIs, lenaSees].every((s) => s.getSnapshot().status === 'live'), 'everyone’s stream');
    const of = (s: typeof annSees, email: string) => s.getSnapshot().here.find((x) => x.person.email === email);

    kofiIs.present({ document: null, block: null, typing: false, page: 'transcript' });
    await until(() => of(annSees, kofi.email)?.page === 'transcript', 'Ann to see Kofi on the transcript');
    expect(of(annSees, kofi.email)).toMatchObject({ document: null, page: 'transcript', elsewhere: false, callIdentity: k.ticket.identity });
    await until(() => of(lenaSees, kofi.email)?.elsewhere === true, 'Lena to see Kofi elsewhere');
    expect(of(lenaSees, kofi.email)).toMatchObject({ document: null, page: null, elsewhere: true, callIdentity: null });
    // From one page to another, and off them.
    kofiIs.present({ document: null, block: null, typing: false, page: 'notes' });
    await until(() => of(annSees, kofi.email)?.page === 'notes', 'Ann to see Kofi on the notes');
    kofiIs.present({ document: null, block: null, typing: false, page: null });
    await until(() => of(annSees, kofi.email)?.page === null, 'Ann to see Kofi leave the notes');
    await until(() => of(lenaSees, kofi.email)?.elsewhere === false, 'Lena to see Kofi back');

    // Someone who isn't in the call can't be on its pages: what they say of it is dropped, and the rest of it holds.
    const plan = (await ann.api.workspaces.items.create(home, { kind: 'document', name: 'Plan', parent: null })).id;
    lenaSees.present({ document: plan, block: null, typing: false, page: 'notes' });
    const lenaIn = () => annSees.getSnapshot().here.find((x) => x.person.email === lena.email && x.document === plan);
    await until(() => lenaIn() !== undefined, 'Ann to see Lena in the plan');
    expect(lenaIn()).toMatchObject({ page: null, elsewhere: false });
    await until(() => of(kofiIs, lena.email)?.document === plan, 'Kofi to see Lena in the plan');
    expect(of(kofiIs, lena.email)).toMatchObject({ page: null, elsewhere: false });
    for (const s of [annSees, kofiIs, lenaSees]) s.close();
    await host.leave();
  });

  it('has a room for what the server makes for the call, beside its pages', async () => {
    const ann = await account();
    const { host } = await callBy(ann, { title: 'Sketching' });
    await host.openWorkspace();
    const home = (await space(host)).home ?? '';
    const [folder] = await folders(ann, home);
    // A board made in it, as the whiteboards will, is the folder's like anything people put there.
    const board = (await ann.api.workspaces.items.create(home, { kind: 'board', name: 'Board', parent: folder?.id ?? null })).id;
    expect((await ann.api.workspaces.get(home)).items.find((x) => x.id === board)).toMatchObject({ kind: 'board', parent: folder?.id });
    await host.leave();
  });
});

describe('who’s in a home made for a call', () => {
  it('follows its invite: someone let in from the link is in it, and out again when they’re taken off; nobody added by hand is', async () => {
    const ann = await account();
    const kofi = await account();
    const sam = await account();
    const lena = await account();
    const { host, code: c } = await callBy(ann, { guests: [kofi.email], title: 'Standup' });
    await host.openWorkspace();
    const home = (await space(host)).home ?? '';
    expect(await peopleIn(ann, home)).toEqual({ [ann.email]: 'admin', [kofi.email]: 'edit' });
    await ann.api.workspaces.addPerson(home, lena.email, 'edit');

    // Sam, signed in, asks from the link and is let in: he's on the invite, so he gets the notes, and the home.
    const s = await sam.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, s);
    await until(async () => (await peopleIn(ann, home))[sam.email] === 'edit', 'Sam to be in the home');
    expect(await space(s)).toMatchObject({ home, canOpen: true, role: 'edit' });

    // Taken out of the call: off the invite, and out of the home. Lena, whom Ann added herself, stays.
    await host.remove(s.ticket.identity);
    await until(async () => (await peopleIn(ann, home))[sam.email] === undefined, 'Sam to be out of the home');
    expect(await peopleIn(ann, home)).toEqual({ [ann.email]: 'admin', [kofi.email]: 'edit', [lena.email]: 'edit' });
    expect(await code(sam.api.workspaces.get(home))).toBe('not-found');

    // A guest let in from the link with no account has nothing.
    const jamie = await h.browser().api.calls.join(c, { mic: false, cam: false, name: 'Jamie Guest' });
    await letIn(host, jamie);
    expect(await space(jamie)).toMatchObject({ id: null, home: null, canOpen: false });
    expect(Object.keys(await peopleIn(ann, home))).toHaveLength(3);
    await host.leave();
  });

  it('never puts back someone taken out of it by hand, or who left it, however the invite changes after; an admin can', async () => {
    const ann = await account();
    const kofi = await account();
    const priya = await account();
    const zed = await account();
    const { host, code: c } = await callBy(ann, { guests: [kofi.email, priya.email], title: 'Standup' });
    await host.openWorkspace();
    const home = (await space(host)).home ?? '';
    expect(await peopleIn(ann, home)).toEqual({ [ann.email]: 'admin', [kofi.email]: 'edit', [priya.email]: 'edit' });

    // Ann takes Kofi out, and Priya leaves by herself.
    await ann.api.workspaces.removePerson(home, await placeOf(ann, home, kofi.email));
    await priya.api.workspaces.removePerson(home, (await priya.api.workspaces.people(home)).find((p) => p.isMe)?.id ?? '');

    // Zed is let in from the link, which puts him on the invite and in the home: nobody else comes back with him.
    const z = await zed.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, z);
    await until(async () => (await peopleIn(ann, home))[zed.email] === 'edit', 'Zed to be in the home');
    expect(await peopleIn(ann, home)).toEqual({ [ann.email]: 'admin', [zed.email]: 'edit' });
    expect(await code(kofi.api.workspaces.get(home))).toBe('not-found');
    expect(await code(priya.api.workspaces.get(home))).toBe('not-found');

    // An admin can put Kofi back by hand: his place is Ann's doing, so the invite leaves it alone from then on.
    await ann.api.workspaces.addPerson(home, kofi.email, 'edit');
    expect(await peopleIn(ann, home)).toEqual({ [ann.email]: 'admin', [zed.email]: 'edit', [kofi.email]: 'edit' });
    await host.leave();
  });

  it('leaves anyone whose place an admin changed by hand when they come off the invite', async () => {
    const ann = await account();
    const sam = await account();
    const tess = await account();
    const { host, code: c } = await callBy(ann, { title: 'Standup' });
    await host.openWorkspace();
    const home = (await space(host)).home ?? '';
    const s = await sam.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, s);
    const t = await tess.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, t);
    await until(async () => { const p = await peopleIn(ann, home); return p[sam.email] === 'edit' && p[tess.email] === 'edit'; }, 'Sam and Tess to be in the home');

    // Ann takes Sam out and adds him back herself, and makes Tess a reader and then an editor again.
    await ann.api.workspaces.removePerson(home, await placeOf(ann, home, sam.email));
    await ann.api.workspaces.addPerson(home, sam.email, 'edit');
    await ann.api.workspaces.setRole(home, await placeOf(ann, home, tess.email), 'read');
    await ann.api.workspaces.setRole(home, await placeOf(ann, home, tess.email), 'edit');

    // Taken out of the call, both come off the invite: the places Ann gave them stay.
    await host.remove(s.ticket.identity);
    await host.remove(t.ticket.identity);
    await settle(host, (x) => !x.participants.some((p) => p.id === s.ticket.identity || p.id === t.ticket.identity));
    await rest(400);
    expect(await peopleIn(ann, home)).toEqual({ [ann.email]: 'admin', [sam.email]: 'edit', [tess.email]: 'edit' });
    await host.leave();
  });

  it('follows a series’ invite as it changes: off the calls to come, someone’s out of its home; put on, they’re in; who left stays out', async () => {
    const ann = await account();
    const kofi = await account();
    const priya = await account();
    const lena = await account();
    const at = Date.now() + 3_600_000;
    const week = (n: number) => new Date(at + n * 7 * 86_400_000).toISOString();
    const series = await ann.api.meetings.create({ title: 'Weekly', startsAt: week(0), durationMinutes: 30, guests: [kofi.email, priya.email], notes: 'off',
      repeat: { rule: { every: 'week', weeks: 1, days: [new Date(week(0)).getUTCDay()] }, until: week(2).slice(0, 10), timeZone: 'UTC', occurrences: [week(0), week(1), week(2)] } });
    const calls = (await ann.api.meetings.upcoming()).filter((x) => x.seriesId === series.seriesId).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const [first, second, third] = calls;
    const host = await ann.api.calls.join(first?.code ?? '', { mic: false, cam: false });
    await inGroup(host);
    await host.openWorkspace();
    const home = (await space(host)).home ?? '';
    expect(await peopleIn(ann, home)).toEqual({ [ann.email]: 'admin', [kofi.email]: 'edit', [priya.email]: 'edit' });
    await priya.api.workspaces.removePerson(home, (await priya.api.workspaces.people(home)).find((p) => p.isMe)?.id ?? '');
    await host.leave();

    // Kofi off this call and every one after, Lena on: the home follows, and Priya, who left, stays out.
    await ann.api.meetings.update(second?.id ?? '', { guests: [priya.email, lena.email] }, { scope: 'following' });
    expect((await ann.api.meetings.get(second?.id ?? '')).workspaceId).toBe(home);
    expect(await peopleIn(ann, home)).toEqual({ [ann.email]: 'admin', [lena.email]: 'edit' });
    expect(await code(kofi.api.workspaces.get(home))).toBe('not-found');
    // Off the last call alone, Lena stays: the series still invites her to the next one.
    await ann.api.meetings.update(third?.id ?? '', { guests: [priya.email] });
    expect(await peopleIn(ann, home)).toEqual({ [ann.email]: 'admin', [lena.email]: 'edit' });

    // The next call settles in the same home, and lets in only who its invite says and isn't out.
    const host2 = await ann.api.calls.join(second?.code ?? '', { mic: false, cam: false });
    await inGroup(host2);
    await host2.openWorkspace();
    expect(await space(host2)).toMatchObject({ home });
    expect(await peopleIn(ann, home)).toEqual({ [ann.email]: 'admin', [lena.email]: 'edit' });
    expect((await folders(lena, home)).map((f) => f.name.split(' · ')[0])).toEqual(['Weekly', 'Weekly']);
    expect(await code(kofi.api.workspaces.get(home))).toBe('not-found');
    await host2.leave();
  });

  it('gives its admins what only someone taken out could open, rather than send it where nobody can', async () => {
    const ann = await account();
    const sam = await account();
    const theo = await account();
    const { host, code: c } = await callBy(ann, { title: 'Standup' });
    await host.openWorkspace();
    const home = (await space(host)).home ?? '';
    const s = await sam.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, s);
    await until(async () => (await peopleIn(ann, home))[sam.email] === 'edit', 'Sam to be in the home');
    await ann.api.workspaces.addPerson(home, theo.email, 'edit');
    // Each keeps a document to themselves.
    const sams = (await sam.api.workspaces.items.create(home, { kind: 'document', name: 'Sam’s draft' })).id;
    await sam.api.workspaces.share.restrict(home, sams, true);
    const theos = (await theo.api.workspaces.items.create(home, { kind: 'document', name: 'Theo’s draft' })).id;
    await theo.api.workspaces.share.restrict(home, theos, true);
    expect(await code(ann.api.workspaces.items.get(home, sams))).toBe('not-found');

    // Sam comes off the invite when he's taken out of the call, and Ann takes Theo out by hand.
    await host.remove(s.ticket.identity);
    await until(async () => (await peopleIn(ann, home))[sam.email] === undefined, 'Sam to be out of the home');
    await ann.api.workspaces.removePerson(home, await placeOf(ann, home, theo.email));

    // Neither document is in Trash: each is still kept to itself, given to Ann, the admin, to edit.
    for (const id of [sams, theos]) {
      expect(await ann.api.workspaces.items.get(home, id)).toMatchObject({ id, restricted: true, trashedAt: null, role: 'edit' });
      expect((await ann.api.workspaces.share.list(home, id)).entries).toEqual([expect.objectContaining({ kind: 'email', role: 'edit', person: expect.objectContaining({ email: ann.email }) })]);
    }
    expect(await code(sam.api.workspaces.get(home))).toBe('not-found');
    expect(await code(theo.api.workspaces.get(home))).toBe('not-found');
    await host.leave();
  });

  it('is what a workspace made during the call is too: everyone invited is in it, after the call as well, and no guest', async () => {
    const ann = await account();
    const kofi = await account();
    const sam = await account();
    const zed = await account();
    const { host, code: c } = await callBy(ann, { guests: [kofi.email], title: 'Standup' });
    await invited(host, c, kofi);
    const s = await sam.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, s);
    const jamie = await h.browser().api.calls.join(c, { mic: false, cam: false, name: 'Jamie Guest' });
    await letIn(host, jamie);
    await host.openWorkspace();
    const home = (await space(host)).home ?? '';

    // Ann makes one in the call, and everyone views it: everyone invited is in it to edit, Sam (let in from the link) too.
    await host.newWorkspace('Retro');
    const made = (await space(host)).id ?? '';
    expect(made).not.toBe(home);
    expect(await peopleIn(ann, made)).toEqual({ [ann.email]: 'admin', [kofi.email]: 'edit', [sam.email]: 'edit' });
    expect(await ann.api.workspaces.list()).toEqual(expect.arrayContaining([expect.objectContaining({ id: made, name: 'Retro', people: 3, call: { title: 'Standup', at: expect.any(String) } })]));
    // A guest without an account isn't in it: to them it's private.
    expect(await space(jamie)).toMatchObject({ id: null, canOpen: false });
    // Someone let in after it's made comes in too, as the invite says, and someone taken out of the call goes, whichever
    // workspace everyone views by then.
    await host.setWorkspace(home);
    const z = await zed.api.calls.join(c, { mic: false, cam: false });
    await letIn(host, z);
    await until(async () => (await peopleIn(ann, made))[zed.email] === 'edit', 'Zed to be in the workspace made in the call');
    await host.remove(s.ticket.identity);
    await until(async () => (await peopleIn(ann, made))[sam.email] === undefined, 'Sam to be out of it');
    expect(await peopleIn(ann, made)).toEqual({ [ann.email]: 'admin', [kofi.email]: 'edit', [zed.email]: 'edit' });

    // After the call it's theirs too, with what they wrote there.
    await host.leave();
    expect((await kofi.api.workspaces.list()).map((w) => w.id)).toContain(made);
    expect((await kofi.api.workspaces.get(made)).role).toBe('edit');
  });

  it('is made with its organizer alone, and lets everyone invited in once the call’s row is let go', async () => {
    const ann = await account();
    const guests = Array.from({ length: 40 }, () => unique('invitee'));
    const { host } = await callBy(ann, { guests, title: 'All hands' });
    await host.openWorkspace();
    const home = (await space(host)).home ?? '';
    expect(Object.keys(await peopleIn(ann, home))).toHaveLength(41);
    // Each place is stamped with the moment its transaction began: only the organizer's began with the home's.
    const made = await h.pool.query<{ first: number; later: number }>(`SELECT count(*) FILTER (WHERE m.created_at = w.created_at)::int AS first, count(*) FILTER (WHERE m.created_at > w.created_at)::int AS later
      FROM workspace_members m JOIN workspaces w ON w.owner_id = m.owner_id WHERE w.workspace_id = $1`, [home]);
    expect(made.rows[0]).toEqual({ first: 1, later: 40 });
    await host.leave();
  });
});

describe('who’s who in a workspace’s documents', () => {
  it('keys each address under the workspace: a member’s own ID, nothing to check a guess against, and only who’s been in the call for someone here through one', async () => {
    const ann = await account();
    const kofi = await account();
    const ola = await account();
    const { host, code: c } = await callBy(ann, { guests: [kofi.email], title: 'Launch' });
    await invited(host, c, kofi);
    await host.openWorkspace();
    const home = (await space(host)).home ?? '';
    const plan = (await ann.api.workspaces.items.create(home, { kind: 'document', name: 'Plan' })).id;

    // In the workspace, any address: a member's is the ID the workspace already knows them by.
    const ids = await ann.api.workspaces.ids(home, [ann.email, kofi.email, ola.email.toUpperCase(), 'nobody@elsewhere.example']);
    expect(Object.keys(ids).sort()).toEqual([ann.email, kofi.email, ola.email, 'nobody@elsewhere.example'].sort());
    expect(ids[kofi.email]).toBe((await ann.api.workspaces.people(home)).find((p) => p.person.email === kofi.email)?.person.id);
    // An outsider's says nothing about their address: it isn't the address, nor the plain hash tags carried, and it's the
    // same each time here and different in another workspace, so it can't be matched across them.
    const olas = ids[ola.email] ?? '';
    expect(olas).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(olas).not.toContain(ola.email.split('@')[0] ?? '');
    expect(olas).not.toBe(plainHash(ola.email));
    expect((await kofi.api.workspaces.ids(home, [ola.email]))[ola.email]).toBe(olas);
    const { id: other } = await ann.api.workspaces.create('Elsewhere');
    expect((await ann.api.workspaces.ids(other, [ola.email]))[ola.email]).not.toBe(olas);
    // Someone who can't open anything in it is told nothing.
    expect(await code(ola.api.workspaces.ids(home, [kofi.email]))).toBe('not-found');

    // A guest given a document in the call: only the people who've been in it, never anyone else's.
    const jamieBrowser = h.browser();
    const jamie = await jamieBrowser.api.calls.join(c, { mic: false, cam: false, name: 'Jamie Guest' });
    await letIn(host, jamie);
    await jamie.askForWorkspace(true);
    const ask = (await settle(host, (x) => x.workspace.asks.length === 1)).workspace.asks[0];
    await host.grantWorkspaceAsk(ask?.id ?? '', plan, 'read');
    const theirs = await jamieBrowser.api.workspaces.ids(home, [ann.email, kofi.email, ola.email], { pass: jamie.ticket.pass });
    expect(theirs).toEqual({ [ann.email]: ids[ann.email], [kofi.email]: ids[kofi.email] });
    await host.leave();
  });
});

describe('what’s kept of a home', () => {
  const encodings = (t: string) => [t, Buffer.from(t).toString('hex'), Buffer.from(t).toString('base64').slice(0, 12), Buffer.from(t).toString('base64url').slice(0, 12)];
  it('holds nothing readable: not the call’s name, nor anyone’s address', async () => {
    const ann = await account();
    const kofi = await account('canary-homeguest@canary.example');
    const { host, code: c } = await callBy(ann, { notes: 'on', guests: [kofi.email], title: 'CANARY-HOMETITLE' });
    await invited(host, c, kofi);
    await host.openWorkspace();
    const ended = await host.leave();
    await noteOf(ann, ended?.pendingNoteId);
    const home = (await ann.api.workspaces.list())[0]?.id ?? '';
    await until(async () => (await folders(ann, home))[0]?.call.on === false, 'the folder to hear the call’s over');
    const tables = (await h.pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")).rows.map((r) => r.table_name);
    const dump = await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (${tables.map((t) => `SELECT row_to_json(x)::text AS t FROM ${t} x`).join(' UNION ALL ')}) q`);
    const text = String(dump.rows[0]?.all ?? '');
    const logs = h.logs.join('');
    for (const canary of ['CANARY-HOMETITLE', 'canary-homeguest', 'Canary Homeguest']) {
      for (const enc of encodings(canary)) {
        expect(text.includes(enc), `${canary} as ${enc} in rows`).toBe(false);
        expect(logs.includes(enc), `${canary} as ${enc} in logs`).toBe(false);
      }
    }
  });
});

describe('what the previous release stored', () => {
  it('still opens: a workspace sealed before a call could have a home, and its items before a call had a folder', async () => {
    const ann = await account();
    const { id } = await ann.api.workspaces.create('From before');
    const plan = (await ann.api.workspaces.items.create(id, { kind: 'document', name: 'Plan' })).id;
    // Sealed as the release before this one sealed it: no `madeFor`, and no `call` on anything.
    await tx(h.pool, async (c) => {
      const w = await serverWorkspace(h.deps, id, c, 'change');
      if (!w) throw new Error('no workspace');
      const { madeFor: _m, ...older } = w.state;
      const items = Object.fromEntries(Object.entries(older.items).map(([key, { call: _c, ...item }]) => [key, item]));
      const header = { v: 1, kind: 'workspace-state', ownerId: w.owner.ownerId, workspaceId: id } as const;
      await c.query('UPDATE workspaces SET state_ciphertext = $2, version = version + 1 WHERE owner_id = $1', [w.owner.ownerId, sealJson(stateKey(w.owner.root, w.owner.ownerId, 'workspace'), header, toJson({ ...older, items }))]);
    });
    expect((await ann.api.workspaces.get(id)).items).toEqual([expect.objectContaining({ id: plan, call: null })]);
    expect(await ann.api.workspaces.list()).toEqual([expect.objectContaining({ id, name: 'From before', call: null, createdAt: expect.any(String) })]);
    // And a call can make it its home.
    const m = await ann.api.meetings.create({ title: 'Later', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [], notes: 'off', workspaceId: id });
    const host = await ann.api.calls.join(m.code, { mic: false, cam: false });
    await inGroup(host);
    await host.openWorkspace();
    expect((await folders(ann, id)).map((f) => f.name.split(' · ')[0])).toEqual(['Later']);
    await host.leave();
  });
});
