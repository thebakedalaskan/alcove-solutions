/**
 * The workspace a call uses, through browsers talking to the real API over HTTP via @alcove/api-http, on real Postgres, the
 * local LiveKit server and the stand-in NEAR AI: which one it is and who chooses, guests asking and being let in one document
 * at a time, the call's follow-ups, what was worked on, presenting, playing a video together, the next call's agenda, and
 * asking Alcove about a selection. What's checked is what each person is told, and above all what they aren't.
 */
import {
  AlcoveApiError, playPosition, type AudioPiece, type CallAction, type CallSession, type CallState, type DocSession, type DocSessionOptions, type Note, type TranscriptClip, type WorkspaceRole
} from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { z } from 'zod';
import { openJson, sealJson, stateKey, toJson } from './crypto';
import { NotFoundError } from './errors';
import { DocFailure } from './live/docPool';
import { maintain } from './maintenance';
import { Profile } from './modules/account';
import { documentText, documentTodos } from './modules/documentText';
import { MeetingManifest } from './modules/meetings';
import { NoteManifest } from './modules/notes';
import { grantDocumentToCall, workspaceForCall } from './modules/workspaceAccess';
import { openOwner } from './owners';
import { speechWav } from './testing/fake-near';
import { startHarness, type Browser, type Harness } from './testing/harness';
import { connect, disposeLiveKit, type TestParticipant } from './testing/livekit';
import { getItem, listItems, saveRevision } from './vault';

vi.setConfig({ testTimeout: 120_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
const inRoom: TestParticipant[] = [];
afterEach(async () => { await Promise.all(inRoom.splice(0).map((p) => p.disconnect().catch(() => undefined))); h.closeCalls(); });

let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
type Account = Browser & { email: string; name: string; ownerId: string };
async function account(email = unique()): Promise<Account> {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email });
  return { ...b, email: session.user.email, name: session.user.name, ownerId: session.ownerId };
}
const madeUp = () => randomBytes(16).toString('base64url');
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof AlcoveApiError ? { code: e.code, message: e.message, status: e.status } : { code: 'not-an-api-error', message: String(e), status: 0 }));
const code = async (p: Promise<unknown>) => (await refusal(p))?.code ?? 'allowed';
const rest = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const by = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await rest(20);
  }
}
const inGroup = (call: CallSession) => until(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
/** Reads the call again until `pred` holds, or the wait is up. */
async function settle(call: CallSession, pred: (s: CallState) => boolean, ms = 15_000): Promise<CallState> {
  const by = Date.now() + ms;
  while (!pred(call.getSnapshot()) && Date.now() < by) { await call.refresh(); await rest(30); }
  return call.getSnapshot();
}
/** The call as this browser reads it now. */
const read = async (call: CallSession) => { await call.refresh({ call: true, log: false }); return call.getSnapshot(); };
const space = async (call: CallSession) => (await read(call)).workspace;
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await inGroup(who);
  await settle(host, (s) => s.participants.some((p) => p.id === who.ticket.identity));
}
/** Someone with the link and no account, let in. */
async function guest(host: CallSession, callCode: string, name = 'Jamie Guest') {
  const b = h.browser();
  const call = await b.api.calls.join(callCode, { mic: false, cam: false, name });
  await letIn(host, call);
  return { ...b, call };
}
/** Someone signed in and invited, in the call. */
async function invited(host: CallSession, callCode: string, who: Account) {
  const call = await who.api.calls.join(callCode, { mic: false, cam: false });
  await inGroup(call);
  await settle(host, (s) => s.participants.some((p) => p.id === call.ticket.identity));
  return call;
}
/** A call `org` hosts, with `guests` invited. */
async function callBy(org: Account, o: { notes?: 'on' | 'off'; guests?: string[]; title?: string } = {}) {
  const { code: c } = await org.api.calls.startNow({ notes: o.notes ?? 'off', guests: o.guests ?? [], ...(o.title ? { title: o.title } : {}) });
  const host = await org.api.calls.join(c, { mic: false, cam: false });
  await inGroup(host);
  return { host, code: c };
}
async function workspace(who: Account, name: string, people: [Account, WorkspaceRole][] = []) {
  const { id } = await who.api.workspaces.create(name);
  for (const [p, role] of people) await who.api.workspaces.addPerson(id, p.email, role);
  return id;
}
const doc = async (who: Account, id: string, name: string, parent: string | null = null) => (await who.api.workspaces.items.create(id, { kind: 'document', name, parent })).id;

const audioBytes = (marker: string) => { const src = Buffer.concat([Buffer.from(marker), randomBytes(2048)]); const out = new Uint8Array(new ArrayBuffer(src.length)); out.set(src); return out; };
const piece = (bytes: Uint8Array<ArrayBuffer>, segment: number, s: number): AudioPiece => ({ data: new Blob([bytes]), segment, seq: s, at: s * 5, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
const speech = (words: string, segment: number, atMs: number, ms = 4000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment, at: atMs / 1000, durationMs: ms });

/* ---------- a Yjs document, as an editor would change one ---------- */

const setAttr = (el: Y.XmlElement, name: string, value: unknown) => { Reflect.apply(el.setAttribute, el, [name, value]); };
async function open(who: Browser, id: string, document: string, opts: DocSessionOptions = {}): Promise<DocSession> {
  const s = await who.api.workspaces.document(id, document, opts);
  await s.ready;
  return s;
}
const saved = (s: DocSession) => until(() => s.getSnapshot().status === 'saved', 'everything to reach Alcove');
const inlineNode = (type: string, attrs: Record<string, string>) => { const el = new Y.XmlElement(type); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
const textNode = (s: string) => { const t = new Y.XmlText(); t.insert(0, s); return t; };
/** Adds a to-do at the end, as the editor writes one: `who` and `when` give it a mention and a date, which is what joins it to the call's follow-ups. */
function addTodo(s: { doc: Y.Doc }, block: string, words: string, o: { who?: { id: string; name: string }; when?: string; done?: boolean } = {}): Y.XmlElement {
  const el = new Y.XmlElement('line');
  setAttr(el, 'id', block);
  setAttr(el, 'kind', 'todo');
  if (o.done !== undefined) setAttr(el, 'done', o.done);
  const fragment = s.doc.getXmlFragment('content');
  fragment.insert(fragment.length, [el]);
  el.insert(0, [textNode(words), ...(o.who ? [inlineNode('mention', o.who)] : []), ...(o.when ? [textNode(' by '), inlineNode('dateChip', { date: o.when })] : [])]);
  return el;
}
function addVideo(s: { doc: Y.Doc }, block: string, media: string): void {
  const el = new Y.XmlElement('video');
  setAttr(el, 'id', block);
  setAttr(el, 'media', media);
  setAttr(el, 'title', 'Launch film');
  const fragment = s.doc.getXmlFragment('content');
  fragment.insert(fragment.length, [el]);
}
const blockOf = (s: { doc: Y.Doc }, id: string) => s.doc.getXmlFragment('content').toArray().find((el): el is Y.XmlElement => el instanceof Y.XmlElement && el.getAttribute('id') === id);
const firstLine = (s: { doc: Y.Doc }) => {
  const el = blockOf(s, 'first');
  if (!el) throw new Error('no first line');
  const t = el.get(0);
  if (t instanceof Y.XmlText) return t;
  const made = new Y.XmlText();
  el.insert(0, [made]);
  return made;
};
/** Someone in the call types in a document, with their pass: it's what says it was worked on in this call. */
async function type(who: Browser, call: CallSession, id: string, document: string, words: string): Promise<DocSession> {
  const s = await open(who, id, document, { pass: call.ticket.pass });
  firstLine(s).insert(firstLine(s).length, words);
  await saved(s);
  return s;
}
const noteOf = async (who: Account, noteId: string | null | undefined): Promise<Note> => {
  const by = Date.now() + 30_000;
  for (;;) {
    const n = await who.api.notes.get(noteId ?? '');
    if (n.status === 'ready') return n;
    if (Date.now() > by) throw new Error('timed out waiting for the notes');
    await rest(40);
  }
};
const count = async (sql: string, params: unknown[] = []) => (await h.pool.query<{ n: number }>(sql, params)).rows[0]?.n ?? -1;
const ownerOf = async (workspaceId: string) => (await h.pool.query<{ owner_id: string }>('SELECT owner_id FROM workspaces WHERE workspace_id = $1', [workspaceId])).rows[0]?.owner_id ?? '';
/** The call's own record of itself, opened as the server opens it. */
async function storedCall(ownerId: string, callId: string) {
  const o = await openOwner(h.deps, ownerId, undefined);
  const key = stateKey(o.root, ownerId, `call:${callId}`);
  const header = { v: 1, kind: 'call-state', ownerId, callId } as const;
  const row = z.object({ state_ciphertext: z.instanceof(Uint8Array) }).parse((await h.pool.query('SELECT state_ciphertext FROM calls WHERE owner_id = $1 AND call_id = $2', [ownerId, callId])).rows[0]);
  return { key, header, state: openJson(key, header, row.state_ciphertext, z.record(z.string(), z.unknown())) };
}
/** Everything the call told this person, as text: what a name would be found in. */
const said = (s: CallState) => JSON.stringify(s);
/** Workers that take `tasks` and don't answer until told to, as a worker with a slow document doesn't, and what's been asked of them meanwhile. */
function stuckWorkers(...tasks: string[]) {
  const pool = h.deps.docs;
  const run = pool.run;
  const real = pool.run.bind(pool);
  let free = () => { /* until there's a gate */ };
  const gate = new Promise<void>((go) => { free = go; });
  const asked: string[] = [];
  pool.run = (task, input, o) => { asked.push(task); return tasks.includes(task) ? gate.then(() => real(task, input, o)) : real(task, input, o); };
  return { asked, free: () => { pool.run = run; free(); } };
}
/** What `p` came to, or a failure for taking longer than anything in a live call should. */
const soon = <T,>(p: Promise<T>, what: string, ms = 5_000): Promise<T> => Promise.race([p, rest(ms).then((): never => { throw new Error(`${what} took more than ${ms} ms`); })]);
/** An action as a browser sends it, whatever the client would make of it. */
const action = (who: Browser, call: CallSession, a: unknown) => who.fetch(`${h.baseUrl}/v1/live/calls/${call.ticket.callId}/actions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': call.ticket.pass }, body: JSON.stringify(a) });

describe('which workspace a call uses', () => {
  it('settles the first time anyone opens it: a new one in the organizer’s name, once, however many open it at once', async () => {
    const ann = await account();
    const kofi = await account();
    const { host, code: c } = await callBy(ann, { guests: [kofi.email] });
    const k = await invited(host, c, kofi);
    expect(host.getSnapshot().workspace).toMatchObject({ id: null, name: null, canOpen: false, role: null, documents: [], agenda: null, present: null, play: null, asks: [], asked: 'no' });
    expect(host.getSnapshot().workspace.chosenBy.name).toBe(ann.name);
    // Anyone opening it settles it, and it's the organizer's, whoever opened it: Kofi isn't in it.
    await Promise.all([k.openWorkspace(), host.openWorkspace(), k.openWorkspace()]);
    const mine = await ann.api.workspaces.list();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ role: 'admin', people: 1 });
    expect(await space(host)).toMatchObject({ id: mine[0]?.id, name: mine[0]?.name, canOpen: true, role: 'admin' });
    expect(mine[0]?.name).toContain(ann.name.split(' ')[0]);
    expect(await space(k)).toMatchObject({ id: null, name: null, canOpen: false, role: null });
    // It's on the meeting, for the organizer alone.
    const meetingId = host.getSnapshot().meetingId;
    expect((await ann.api.meetings.get(meetingId)).workspaceId).toBe(mine[0]?.id);
    expect((await kofi.api.meetings.get(meetingId)).workspaceId).toBeNull();
    // Opening it again changes nothing.
    await k.openWorkspace();
    expect(await ann.api.workspaces.list()).toHaveLength(1);
  });

  it('is the organizer’s most recently used, the next time, and not one they can no longer edit in', async () => {
    const ann = await account();
    const lena = await account();
    const first = await workspace(ann, 'First');
    const second = await workspace(ann, 'Second');
    // Making one uses it.
    let c = await callBy(ann);
    await c.host.openWorkspace();
    expect(c.host.getSnapshot().workspace.id).toBe(second);
    // Opening one in the app does too.
    const stream = ann.api.workspaces.live(first);
    await until(() => stream.getSnapshot().status === 'live', 'the stream');
    await until(async () => { const n = await callBy(ann); c = n; await n.host.openWorkspace(); return n.host.getSnapshot().workspace.id === first; }, 'the first workspace to be the latest used');
    stream.close();
    // One they only read isn't a workspace they could have chosen: it's skipped for a new one.
    const theirs = await workspace(lena, 'Lena’s', [[ann, 'edit']]);
    const live = ann.api.workspaces.live(theirs);
    await until(() => live.getSnapshot().status === 'live', 'the stream');
    await until(async () => { const n = await callBy(ann); await n.host.openWorkspace(); return n.host.getSnapshot().workspace.id === theirs; }, 'Lena’s workspace to be the latest used');
    live.close();
    const people = await lena.api.workspaces.people(theirs);
    await lena.api.workspaces.setRole(theirs, people.find((p) => p.person.email === ann.email)?.id ?? '', 'read');
    const after = await callBy(ann);
    await after.host.openWorkspace();
    const chosen = after.host.getSnapshot().workspace.id;
    expect(chosen).not.toBe(theirs);
    expect([first, second]).not.toContain(chosen);
    expect(after.host.getSnapshot().workspace.role).toBe('admin');
  });

  it('comes with the meeting, carries to the next call in a series, and goes for later calls when it’s changed', async () => {
    const ann = await account();
    const theo = await account();
    const lena = await account();
    const product = await workspace(ann, 'Product');
    const design = await workspace(ann, 'Design');
    const reading = await workspace(lena, 'Only to read', [[ann, 'read']]);
    const hers = await workspace(lena, 'Not hers');
    const at = Date.now() + 86_400_000;
    const input = { title: 'Weekly', startsAt: new Date(at).toISOString(), durationMinutes: 30, guests: [theo.email], notes: 'off' as const };
    // A meeting only takes a workspace its organizer can edit in, and one they can't reach reads as one that isn't there.
    expect(await code(ann.api.meetings.create({ ...input, workspaceId: reading }))).toBe('forbidden');
    expect(await refusal(ann.api.meetings.create({ ...input, workspaceId: hers }))).toEqual(await refusal(ann.api.meetings.create({ ...input, workspaceId: madeUp() })));
    const m = await ann.api.meetings.create({ ...input, workspaceId: product });
    expect(m.workspaceId).toBe(product);
    expect((await theo.api.meetings.get(m.id)).workspaceId).toBeNull();
    const changed = await ann.api.meetings.update(m.id, { workspaceId: design });
    expect(changed.workspaceId).toBe(design);
    await ann.api.meetings.update(m.id, { workspaceId: product });
    expect(await code(ann.api.meetings.update(m.id, { workspaceId: reading }))).toBe('forbidden');
    // The next call scheduled takes it along.
    const next = await ann.api.meetings.scheduleNext(m.id, new Date(at + 7 * 86_400_000).toISOString());
    expect(next.workspaceId).toBe(product);
    // A series' calls all have it; the organizer changing it in one call changes it for the calls after that one, and no earlier.
    const week = (n: number) => new Date(at + n * 7 * 86_400_000).toISOString();
    const series = await ann.api.meetings.create({ ...input, startsAt: week(0), workspaceId: product, repeat: { rule: { every: 'week', weeks: 1, days: [new Date(week(0)).getUTCDay()] }, until: week(2).slice(0, 10), timeZone: 'UTC', occurrences: [week(0), week(1), week(2)] } });
    const calls = (await ann.api.meetings.upcoming()).filter((x) => x.seriesId === series.seriesId).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    expect(calls.map((x) => x.workspaceId)).toEqual([product, product, product]);
    const host = await ann.api.calls.join(calls[1]?.code ?? '', { mic: false, cam: false });
    await inGroup(host);
    expect((await space(host)).id).toBe(product);
    await host.setWorkspace(design);
    await until(async () => (await ann.api.meetings.get(calls[2]?.id ?? '')).workspaceId === design, 'the later call to follow');
    expect((await ann.api.meetings.get(calls[0]?.id ?? '')).workspaceId).toBe(product);
  });

  it('takes the later calls in a series along when it settles on one', async () => {
    const ann = await account();
    const at = Date.now() + 3_600_000;
    const week = (n: number) => new Date(at + n * 7 * 86_400_000).toISOString();
    const series = await ann.api.meetings.create({
      title: 'Weekly', startsAt: week(0), durationMinutes: 30, guests: [], notes: 'off',
      repeat: { rule: { every: 'week', weeks: 1, days: [new Date(week(0)).getUTCDay()] }, until: week(1).slice(0, 10), timeZone: 'UTC', occurrences: [week(0), week(1)] }
    });
    expect(series.workspaceId).toBeNull();
    const calls = (await ann.api.meetings.upcoming()).filter((x) => x.seriesId === series.seriesId).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const host = await ann.api.calls.join(calls[0]?.code ?? '', { mic: false, cam: false });
    await inGroup(host);
    await host.openWorkspace();
    const settled = host.getSnapshot().workspace.id;
    expect(settled).not.toBeNull();
    await until(async () => (await ann.api.meetings.get(calls[1]?.id ?? '')).workspaceId === settled, 'the next call to follow');
  });

  it('is the same for someone coming late, coming back, and on another device', async () => {
    const ann = await account();
    const priya = await account();
    const id = await workspace(ann, 'Product', [[priya, 'edit']]);
    const plan = await doc(ann, id, 'Launch plan');
    const { host, code: c } = await callBy(ann, { guests: [priya.email] });
    await host.setWorkspace(id);
    await host.bringDocument(plan, true);
    const shown = { id, name: 'Product', canOpen: true, documents: [{ workspaceId: id, id: plan, kind: 'document', name: 'Launch plan', role: 'edit' }] };
    // Someone who comes late.
    const p = await invited(host, c, priya);
    expect(await space(p)).toMatchObject({ ...shown, role: 'edit' });
    // A reload: their pass brings them back as themselves, with what they had.
    p.closing();
    const back = await priya.api.calls.join(c, { mic: false, cam: false, previous: p.ticket.pass });
    await inGroup(back);
    expect(await space(back)).toMatchObject({ ...shown, role: 'edit' });
    // The organizer on a new connection.
    const again = await ann.api.calls.join(c, { mic: false, cam: false });
    await inGroup(again);
    expect(await space(again)).toMatchObject({ ...shown, role: 'admin' });
    // A guest who comes late isn't in it, then or after coming back.
    const jamie = await guest(again, c);
    expect(await space(jamie.call)).toMatchObject({ id: null, name: null, canOpen: false, documents: [] });
  });

  it('changes for everyone at once, says who can’t open it without telling the organizer anything else, and interrupts nothing', async () => {
    const art = await account();
    const priya = await account();
    const theo = await account();
    const lena = await account();
    const product = await workspace(art, 'Product', [[priya, 'edit'], [theo, 'edit']]);
    const design = await workspace(art, 'Design', [[priya, 'edit']]);
    const reading = await workspace(lena, 'Reading', [[art, 'read']]);
    const hers = await workspace(lena, 'Hers');
    const secret = await doc(art, design, 'Restricted plan');
    await art.api.workspaces.share.restrict(design, secret, true);
    // Theo has one document in Design that Art can't see: that's Theo's, and Art isn't told.
    const other = await doc(priya, design, 'Priya’s own');
    await priya.api.workspaces.share.restrict(design, other, true);
    await priya.api.workspaces.share.set(design, other, [{ email: theo.email }], 'read');
    const { host, code: c } = await callBy(art, { guests: [priya.email, theo.email] });
    const p = await invited(host, c, priya);
    const t = await invited(host, c, theo);
    const jamie = await guest(host, c, 'Jamie Guest');
    await host.setWorkspace(product);
    const open1 = await open(priya, product, await doc(priya, product, 'Open'), { pass: p.ticket.pass });

    // Only the organizer can, and only to where they can edit. Nobody learns anything about a workspace they can't reach.
    expect(await code(p.setWorkspace(design))).toBe('forbidden');
    expect(await code(jamie.call.setWorkspace(design))).toBe('forbidden');
    expect(await code(p.previewWorkspace(design))).toBe('forbidden');
    expect(await code(host.setWorkspace(reading))).toBe('forbidden');
    expect(await refusal(host.setWorkspace(hers))).toEqual(await refusal(host.setWorkspace(madeUp())));
    expect(await refusal(host.previewWorkspace(hers))).toEqual(await refusal(host.previewWorkspace(madeUp())));
    expect(await code(host.previewWorkspace(reading))).toBe('forbidden');
    expect((await space(p)).id).toBe(product);

    // Asking first changes nothing, and says who isn't in it by first name. Theo has something in it, and Art doesn't know that.
    expect(await host.previewWorkspace(design)).toEqual({ name: 'Design', cantOpen: expect.arrayContaining([theo.name.split(' ')[0], 'Jamie']) });
    expect((await host.previewWorkspace(design)).cantOpen).toHaveLength(2);
    expect((await space(p)).id).toBe(product);
    // Someone who can open it isn't named.
    expect((await host.previewWorkspace(product)).cantOpen).toEqual(['Jamie']);

    const generation = host.getSnapshot().generation;
    await host.setWorkspace(design);
    expect(host.getSnapshot().workspace).toMatchObject({ id: design, name: 'Design', role: 'admin' });
    expect(await space(p)).toMatchObject({ id: design, name: 'Design', role: 'edit' });
    // Theo stays in the call, with the one thing that's theirs and not the name of what it's in.
    expect(await space(t)).toMatchObject({ id: design, name: null, canOpen: true, role: null });
    expect(await space(jamie.call)).toMatchObject({ id: null, name: null, canOpen: false });
    expect(said(jamie.call.getSnapshot())).not.toContain('Design');
    // Nobody was interrupted: nobody's keys moved, and what they had open stays open.
    expect(host.getSnapshot().generation).toBe(generation);
    expect(p.crypto.getSnapshot().status).toBe('in');
    expect(open1.getSnapshot().closed).toBeNull();
    // The workspace it left is still there.
    expect((await art.api.workspaces.list()).map((x) => x.name)).toEqual(expect.arrayContaining(['Design', 'Product']));

    // A new one, from the call: named after it, with just the organizer in it, still there after the call.
    await host.newWorkspace('Launch review');
    const made = host.getSnapshot().workspace;
    expect(made).toMatchObject({ name: 'Launch review', role: 'admin', canOpen: true });
    expect(await art.api.workspaces.people(made.id ?? '')).toHaveLength(1);
    expect((await art.api.workspaces.get(made.id ?? '')).items).toEqual([]);
    expect(await space(p)).toMatchObject({ id: null, name: null, canOpen: false });
    expect(await code(p.newWorkspace('Mine now'))).toBe('forbidden');
    await host.newWorkspace();
    expect(host.getSnapshot().workspace.name).toBe(host.getSnapshot().title);
    await host.leave();
    expect((await art.api.workspaces.list()).map((x) => x.name)).toContain('Launch review');
  });

  it('takes what’s brought off the call, and brings no more than a call can', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const other = await workspace(art, 'Other');
    const plan = await doc(art, id, 'Plan');
    const { host } = await callBy(art);
    await host.setWorkspace(id);
    await host.bringDocument(plan, true);
    await host.bringDocument(plan, true);
    expect(host.getSnapshot().workspace.documents.map((x) => x.id)).toEqual([plan]);
    // It stays brought when the call moves on, and can be taken off from there.
    await host.setWorkspace(other);
    expect((await space(host)).documents).toEqual([{ workspaceId: id, id: plan, kind: 'document', name: 'Plan', role: 'edit' }]);
    await host.bringDocument(plan, false);
    expect(host.getSnapshot().workspace.documents).toEqual([]);
    await host.setWorkspace(id);
    for (let i = 0; i < 12; i++) await host.bringDocument(await doc(art, id, `Doc ${i}`), true);
    expect(await code(host.bringDocument(plan, true))).toBe('conflict');
    expect(host.getSnapshot().workspace.documents).toHaveLength(12);
    // Trash takes it off the list, and what isn't there can't be taken off.
    await art.api.workspaces.items.trash(id, host.getSnapshot().workspace.documents[0]?.id ?? '');
    expect((await space(host)).documents).toHaveLength(11);
    expect(await code(host.bringDocument(madeUp(), false))).toBe('not-found');
  });

  it('refuses whoever isn’t in the call yet, and the organizer’s last connection, and a stand-in for what’s the organizer’s', async () => {
    const art = await account();
    const kofi = await account();
    const id = await workspace(art, 'Product', [[kofi, 'edit']]);
    const other = await workspace(art, 'Other', [[kofi, 'edit']]);
    const plan = await doc(art, id, 'Plan');
    const { host, code: c } = await callBy(art, { guests: [kofi.email] });
    await host.setWorkspace(id);
    const k = await invited(host, c, kofi);
    // Still asking to be let in: a pass, and nothing else.
    const b = h.browser();
    const waiting = await b.api.calls.join(c, { mic: false, cam: false, name: 'Waiting Guest' });
    await settle(host, (s) => s.waiting.some((w) => w.id === waiting.ticket.identity));
    expect(waiting.getSnapshot().workspace).toMatchObject({ id: null, name: null, canOpen: false, documents: [], present: null, play: null });
    expect(await code(waiting.openWorkspace())).toBe('forbidden');
    expect(await code(waiting.askForWorkspace(true))).toBe('forbidden');
    expect(await code(waiting.startPresenting('document', plan))).toBe('forbidden');
    expect((await b.fetch(`${h.baseUrl}/v1/live/calls/${waiting.ticket.callId}/follow-ups`, { headers: { 'x-alcove-call': waiting.ticket.pass } })).status).toBe(403);
    expect(await code(b.api.workspaces.get(id, { pass: waiting.ticket.pass }))).toBe('unauthenticated');
    await host.deny(waiting.ticket.identity);
    // The organizer's connection that the call has moved on from is out of date, not refused.
    const again = await art.api.calls.join(c, { mic: false, cam: false });
    await inGroup(again);
    expect(await code(host.setWorkspace(other))).toBe('conflict');
    // Someone standing in for the organizer hosts, and doesn't choose the workspace, or answer for it.
    inRoom.push(await connect(await k.room(), { sending: k.crypto }));
    await settle(k, (s) => s.host.id === again.ticket.identity);
    await inGroup(k);
    await again.handOff(k.ticket.identity);
    const standing = await settle(k, (s) => s.isHost);
    expect(standing.isOrganizer).toBe(false);
    expect(await code(k.setWorkspace(other))).toBe('forbidden');
    expect(await code(k.newWorkspace('Theirs'))).toBe('forbidden');
    expect(await code(k.previewWorkspace(other))).toBe('forbidden');
    // What they can do by what they can open, they still can.
    expect((await space(k)).id).toBe(id);
    expect(await code(k.bringDocument(plan, true))).toBe('allowed');
  });

  it('opens nothing for the organizer: it’s private to them too once they’ve lost it', async () => {
    const lena = await account();
    const art = await account();
    const id = await workspace(lena, 'Lena’s', [[art, 'edit']]);
    await doc(lena, id, 'Hers');
    const { host } = await callBy(art);
    await host.setWorkspace(id);
    expect(host.getSnapshot().workspace.name).toBe('Lena’s');
    const people = await lena.api.workspaces.people(id);
    await lena.api.workspaces.removePerson(id, people.find((p) => p.person.email === art.email)?.id ?? '');
    expect(await space(host)).toMatchObject({ id: null, name: null, canOpen: false, role: null, documents: [] });
    expect(said(host.getSnapshot())).not.toContain('Lena’s');
    // Whatever's been chosen, they can still choose again.
    await host.newWorkspace('Another');
    expect(host.getSnapshot().workspace.name).toBe('Another');
  });

  it('survives its workspace being deleted: the call goes on, and opening it again settles on another', async () => {
    const art = await account();
    const id = await workspace(art, 'Short lived');
    const { host } = await callBy(art);
    await host.setWorkspace(id);
    await art.api.workspaces.remove(id);
    expect(await space(host)).toMatchObject({ id: null, canOpen: false });
    await host.openWorkspace();
    expect(host.getSnapshot().workspace.canOpen).toBe(true);
    expect(host.getSnapshot().workspace.id).not.toBe(id);
  });

  it('gives the server the call’s workspace, and one document to the people in the call or in a room, until it ends', async () => {
    const art = await account();
    const kofi = await account();
    const priya = await account();
    const id = await workspace(art, 'Boards');
    const board = (await art.api.workspaces.items.create(id, { kind: 'board', name: 'Board' })).id;
    const { host, code: c } = await callBy(art, { guests: [kofi.email, priya.email] });
    const k = await invited(host, c, kofi);
    const p = await invited(host, c, priya);
    const jamie = await guest(host, c);
    await host.setWorkspace(id);
    const call = { organizer: await openOwner(h.deps, art.ownerId, undefined), callId: host.ticket.callId };
    const w = await workspaceForCall(h.deps, call);
    expect(w.workspaceId).toBe(id);
    expect(w.state.items[board]?.kind).toBe('board');

    // To everyone in the call: a seat each, and a guest reads it with their pass.
    await grantDocumentToCall(h.deps, w, board, call, { role: 'edit' });
    expect(await count("SELECT count(*)::int AS n FROM document_access WHERE document_id = $1 AND kind = 'seat'", [board])).toBe(4);
    expect((await jamie.api.workspaces.get(id, { pass: jamie.call.ticket.pass })).items.map((x) => x.id)).toEqual([board]);
    await art.api.workspaces.share.list(id, board).then(async (share) => { for (const e of share.entries) await art.api.workspaces.share.remove(id, board, e.id); });

    // To one room's people: nobody else gets it.
    host.openRooms({ rooms: [{ name: 'One', emails: [kofi.email] }, { name: 'Two', emails: [priya.email] }], minutes: 5 });
    const rooms = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms ?? [];
    await until(() => k.crypto.getSnapshot().place === rooms[0]?.id, 'Kofi to be in their room');
    await grantDocumentToCall(h.deps, w, board, call, { role: 'read', place: rooms[0]?.id });
    expect(await count("SELECT count(*)::int AS n FROM document_access WHERE document_id = $1 AND kind = 'seat'", [board])).toBe(1);
    expect((await kofi.api.workspaces.get(id, { pass: k.ticket.pass })).items.map((x) => x.id)).toEqual([board]);
    expect(await code(priya.api.workspaces.get(id, { pass: p.ticket.pass }))).toBe('not-found');
    // Something that isn't in the workspace is refused, and a folder holds nothing to give.
    await expect(grantDocumentToCall(h.deps, w, madeUp(), call, { role: 'read' })).rejects.toBeInstanceOf(NotFoundError);
    await host.leave();
    await until(async () => (await count("SELECT count(*)::int AS n FROM document_access WHERE document_id = $1 AND kind = 'seat'", [board])) === 0, 'the seats to end with the call');
  });
});

describe('someone who can’t open it', () => {
  it('is told it’s private, and nothing that names anything: not in the call, presence, or an error', async () => {
    const art = await account();
    const priya = await account();
    const id = await workspace(art, 'CANARY-SPACE Product', [[priya, 'edit']]);
    const folder = (await art.api.workspaces.items.create(id, { kind: 'folder', name: 'CANARY-FOLDER Launch' })).id;
    const plan = await doc(art, id, 'CANARY-DOC Launch plan', folder);
    const film = await doc(art, id, 'CANARY-FILM film');
    const media = madeUp();
    const f = await open(art, id, film);
    addVideo(f, 'v1', media);
    await saved(f);
    const { host, code: c } = await callBy(art, { guests: [priya.email], title: 'Weekly' });
    const p = await invited(host, c, priya);
    await host.setWorkspace(id);
    await host.bringDocument(plan, true);
    const jamie = await guest(host, c);
    const pass = { pass: jamie.call.ticket.pass };
    // Someone's in the workspace, doing things.
    await p.startPresenting('document', plan, 2);
    await host.startPlaying(film, media, 5000);
    const here = priya.api.workspaces.live(id, { pass: p.ticket.pass });
    await until(() => here.getSnapshot().status === 'live', 'Priya’s stream');
    here.present({ document: plan, block: null, typing: false });
    await rest(250);

    await jamie.call.openWorkspace();
    const seen = await read(jamie.call);
    expect(seen.workspace).toMatchObject({ id: null, name: null, canOpen: false, role: null, documents: [], agenda: null, play: null, asks: [], asked: 'no' });
    // They're told something's being presented, by whom, and nothing about what it is.
    expect(seen.workspace.present).toEqual({ kind: null, id: null, name: null, section: null, by: { seat: expect.any(String), name: priya.name }, mine: false, canControl: false });
    const text = said(seen);
    for (const name of ['CANARY-SPACE', 'CANARY-FOLDER', 'CANARY-DOC', 'CANARY-FILM', id, plan, film, media, folder]) expect(text, name).not.toContain(name);

    // Whatever they ask for, the same answer as for what doesn't exist, in the same words.
    const nothing = madeUp();
    expect(await refusal(jamie.api.workspaces.get(id, pass))).toEqual(await refusal(jamie.api.workspaces.get(nothing, pass)));
    expect(await refusal(jamie.call.bringDocument(plan, true))).toEqual(await refusal(jamie.call.bringDocument(nothing, true)));
    expect(await refusal(jamie.call.startPresenting('document', plan))).toEqual(await refusal(jamie.call.startPresenting('document', nothing)));
    expect(await refusal(jamie.call.startPlaying(film, media))).toEqual(await refusal(jamie.call.startPlaying(nothing, media)));
    expect(await refusal(jamie.call.pausePlaying(0))).toEqual(await refusal(jamie.call.pausePlaying(1)));
    expect(await code(jamie.call.pausePlaying(0))).toBe('conflict');
    expect(await refusal(jamie.call.tickDocumentFollowUp({ workspaceId: id, documentId: plan, block: 'first', done: true }))).toEqual(await refusal(jamie.call.tickDocumentFollowUp({ workspaceId: nothing, documentId: nothing, block: 'first', done: true })));
    expect(await code(jamie.api.workspaces.presenterNotes.get(id, plan, pass))).toBe('not-found');
    expect(await code(collect(jamie.api.workspaces.ask(id, plan, { action: 'shorter', text: 'Words' }, pass)))).toBe('not-found');
    const stream = jamie.api.workspaces.live(id, pass);
    await until(() => stream.getSnapshot().status === 'closed', 'their stream to be refused');
    expect(stream.getSnapshot().here).toEqual([]);
    expect(said(await read(jamie.call))).not.toContain('CANARY');
  });

  it('isn’t let in by being in the call, invited, or the organizer: only what’s shared opens', async () => {
    const art = await account();
    const theo = await account();
    const priya = await account();
    const id = await workspace(priya, 'Priya’s', [[art, 'edit']]);
    const secret = await doc(priya, id, 'Restricted');
    await priya.api.workspaces.share.restrict(id, secret, true);
    const plan = await doc(priya, id, 'Open to the workspace');
    const { host, code: c } = await callBy(art, { guests: [theo.email] });
    const t = await invited(host, c, theo);
    await host.setWorkspace(id);
    // Invited, and not in the workspace.
    expect(await code(theo.api.workspaces.get(id, { pass: t.ticket.pass }))).toBe('not-found');
    expect(await space(t)).toMatchObject({ canOpen: false });
    // The organizer, and restricted away from them: it isn't brought, presented, or named.
    expect(await code(host.bringDocument(secret, true))).toBe('not-found');
    expect(await code(host.startPresenting('document', secret))).toBe('not-found');
    expect((await art.api.workspaces.get(id)).items.map((x) => x.id)).not.toContain(secret);
    // What someone brought, that the organizer can't open, doesn't show to the organizer either.
    await host.bringDocument(plan, true);
    await priya.api.workspaces.share.restrict(id, plan, true);
    expect((await space(host)).documents).toEqual([]);
  });
});

describe('a guest in a call', () => {
  it('asks, is let into one document, and has nothing named before it or left after the call', async () => {
    const art = await account();
    const id = await workspace(art, 'CANARY-SPACE Product');
    const plan = await doc(art, id, 'CANARY-DOC Launch plan');
    const other = await doc(art, id, 'CANARY-OTHER budget');
    const s = await open(art, id, plan);
    firstLine(s).insert(0, 'CANARY-WORDS the plan says');
    await saved(s);
    const { host, code: c } = await callBy(art);
    await host.setWorkspace(id);
    const jamie = await guest(host, c);
    const pass = { pass: jamie.call.ticket.pass };
    await jamie.call.openWorkspace();
    expect(said(jamie.call.getSnapshot())).not.toContain('CANARY');

    // Asking names nothing. Only the organizer sees it, and only while they're asking.
    await jamie.call.askForWorkspace(true);
    expect(jamie.call.getSnapshot().workspace.asked).toBe('asking');
    const ask = (await settle(host, (x) => x.workspace.asks.length === 1)).workspace.asks[0];
    expect(ask?.participantId).toBe(jamie.call.ticket.identity);
    expect(ask?.person.name).toBe('Jamie Guest');
    await jamie.call.askForWorkspace(false);
    expect(jamie.call.getSnapshot().workspace.asked).toBe('no');
    expect((await settle(host, (x) => x.workspace.asks.length === 0)).workspace.asks).toEqual([]);
    await jamie.call.askForWorkspace(true);
    const again = (await settle(host, (x) => x.workspace.asks.length === 1)).workspace.asks[0];

    // Saying not now tells them, and leaves the workspace shut.
    await host.declineWorkspaceAsk(again?.id ?? '');
    expect((await space(jamie.call))).toMatchObject({ asked: 'declined', canOpen: false });
    expect(host.getSnapshot().workspace.asks).toEqual([]);
    await jamie.call.askForWorkspace(true);
    const third = (await settle(host, (x) => x.workspace.asks.length === 1)).workspace.asks[0];

    // One document, read only: a seat entry, and it opens for them with their pass.
    await host.grantWorkspaceAsk(third?.id ?? '', plan, 'read');
    expect(await count("SELECT count(*)::int AS n FROM document_access WHERE document_id = $1 AND kind = 'seat'", [plan])).toBe(1);
    expect(await space(jamie.call)).toMatchObject({ id, name: null, canOpen: true, role: null, asked: 'no' });
    expect(host.getSnapshot().workspace.asks).toEqual([]);
    const tree = await jamie.api.workspaces.get(id, pass);
    expect(tree).toMatchObject({ id, name: null, people: null });
    expect(tree.items.map((x) => x.id)).toEqual([plan]);
    const page = await open(jamie, id, plan, pass);
    expect(page.getSnapshot().role).toBe('read');
    expect(documentText(page.doc, 'document').blocks[0]?.text).toContain('CANARY-WORDS');
    // Read only, and nothing else is theirs.
    firstLine(page).insert(0, 'Guest typing');
    await until(() => page.getSnapshot().refused === 'read-only', 'the edit to be refused');
    expect(await code(jamie.api.workspaces.items.get(id, other, pass))).toBe('not-found');
    expect(await code(open(jamie, id, other, pass))).toBe('not-found');
    expect(said(await read(jamie.call))).not.toContain('CANARY');

    // Taking it back from Share stops content, edits and presence at once.
    const here = jamie.api.workspaces.live(id, pass);
    await until(() => here.getSnapshot().status === 'live', 'their stream');
    here.present({ document: plan, block: null, typing: false });
    const watching = art.api.workspaces.live(id);
    await until(() => watching.getSnapshot().here.some((x) => x.document === plan && x.person.name === 'Jamie Guest'), 'Art to see Jamie there');
    const entry = (await art.api.workspaces.share.list(id, plan)).entries[0];
    expect(entry).toMatchObject({ kind: 'seat', role: 'read', person: { name: 'Jamie Guest' } });
    await art.api.workspaces.share.remove(id, plan, entry?.id ?? '');
    await until(() => page.getSnapshot().closed === 'access', 'their document to end');
    await until(() => here.getSnapshot().status === 'closed', 'their stream to end');
    await until(() => !watching.getSnapshot().here.some((x) => x.person.name === 'Jamie Guest'), 'them to be gone from who’s here');
    expect(await space(jamie.call)).toMatchObject({ id: null, canOpen: false });
    expect(await code(jamie.api.workspaces.get(id, pass))).toBe('not-found');

    // Let in again, to edit this time, it opens and takes their edits.
    await jamie.call.askForWorkspace(true);
    const fourth = (await settle(host, (x) => x.workspace.asks.length === 1)).workspace.asks[0];
    await host.grantWorkspaceAsk(fourth?.id ?? '', other, 'edit');
    const editing = await open(jamie, id, other, pass);
    firstLine(editing).insert(0, 'A guest’s words');
    await saved(editing);
    expect(editing.getSnapshot().refused).toBeNull();

    // The call ending ends it, and leaves nothing of it.
    await host.leave();
    await until(async () => (await count("SELECT count(*)::int AS n FROM document_access WHERE owner_id = $1 AND kind = 'seat'", [await ownerOf(id)])) === 0, 'the seat to end');
    await until(() => editing.getSnapshot().closed !== null, 'their document to end');
    expect(await code(jamie.api.workspaces.get(id, pass))).toBe('unauthenticated');
  });

  it('refuses everything that isn’t the organizer answering a real ask for something they can share', async () => {
    const art = await account();
    const priya = await account();
    const lena = await account();
    const id = await workspace(art, 'Product', [[priya, 'edit']]);
    const plan = await doc(art, id, 'Plan');
    const theirs = await workspace(lena, 'Other', [[art, 'edit']]);
    const readOnly = await doc(lena, theirs, 'Read only');
    await lena.api.workspaces.share.restrict(theirs, readOnly, true);
    await lena.api.workspaces.share.set(theirs, readOnly, [{ email: art.email }], 'read');
    const { host, code: c } = await callBy(art, { guests: [priya.email] });
    const p = await invited(host, c, priya);
    await host.setWorkspace(id);
    const jamie = await guest(host, c);
    const sam = await guest(host, c, 'Sam Guest');
    // The organizer chooses the workspace, so there's nothing for them to ask.
    expect(await code(host.askForWorkspace(true))).toBe('invalid');
    await jamie.call.askForWorkspace(true);
    const ask = (await settle(host, (x) => x.workspace.asks.length === 1)).workspace.asks[0];
    // Someone else's answer.
    expect(await code(p.grantWorkspaceAsk(ask?.id ?? '', plan, 'read'))).toBe('forbidden');
    expect(await code(jamie.call.grantWorkspaceAsk(ask?.id ?? '', plan, 'edit'))).toBe('forbidden');
    expect(await code(sam.call.declineWorkspaceAsk(ask?.id ?? ''))).toBe('forbidden');
    expect(await space(p)).toMatchObject({ asks: [] });
    expect(await space(sam.call)).toMatchObject({ asks: [], asked: 'no' });
    // An ask that isn't one, from this call or another.
    expect(await code(host.grantWorkspaceAsk(madeUp(), plan, 'read'))).toBe('invalid');
    expect(await code(host.declineWorkspaceAsk(madeUp()))).toBe('invalid');
    const elsewhere = await callBy(art);
    await elsewhere.host.setWorkspace(id);
    expect(await code(elsewhere.host.grantWorkspaceAsk(ask?.id ?? '', plan, 'read'))).toBe('invalid');
    expect(await code(elsewhere.host.declineWorkspaceAsk(ask?.id ?? ''))).toBe('invalid');
    // A document that isn't in the call's workspace is the same as one that isn't anywhere.
    expect(await refusal(host.grantWorkspaceAsk(ask?.id ?? '', readOnly, 'read'))).toEqual(await refusal(host.grantWorkspaceAsk(ask?.id ?? '', madeUp(), 'read')));
    expect(await count("SELECT count(*)::int AS n FROM document_access WHERE kind = 'seat' AND call_id = $1", [host.ticket.callId])).toBe(0);
    // Being the organizer gives no right to share what they can only read.
    await host.setWorkspace(theirs);
    expect(await code(host.grantWorkspaceAsk(ask?.id ?? '', readOnly, 'read'))).toBe('forbidden');
    await host.setWorkspace(id);
    // Someone who left takes their ask with them.
    await jamie.call.leave();
    expect((await settle(host, (x) => x.workspace.asks.length === 0)).workspace.asks).toEqual([]);
    expect(await code(host.grantWorkspaceAsk(ask?.id ?? '', plan, 'read'))).toBe('invalid');
  });

  it('hears that something opened or closed for them, however it was shared', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const plan = await doc(art, id, 'Plan');
    const { host, code: c } = await callBy(art);
    await host.setWorkspace(id);
    const jamie = await guest(host, c);
    const room = await connect(await jamie.call.room(), { sending: jamie.call.crypto });
    inRoom.push(room);
    // A browser that's only just reached the room can miss what's sent that moment, so this one has heard something first.
    let ready = false;
    const warm = room.nextNudge().then(() => { ready = true; });
    while (!ready) { await host.lock(false); await rest(50); }
    await warm;
    const seat = (await settle(host, (s) => s.participants.some((p) => p.id === jamie.call.ticket.identity))).participants.find((p) => p.id === jamie.call.ticket.identity)?.seat ?? '';
    // From the Share sheet, from inside the call: nobody asked, and it opens by itself.
    const shared = room.nextNudge();
    await art.api.workspaces.share.set(id, plan, [{ seat }], 'read', { pass: host.ticket.pass });
    await shared;
    expect(await space(jamie.call)).toMatchObject({ id, canOpen: true });
    // Taken back from anywhere, it closes at once.
    const entry = (await art.api.workspaces.share.list(id, plan)).entries[0];
    const closed = room.nextNudge();
    await art.api.workspaces.share.remove(id, plan, entry?.id ?? '');
    await closed;
    expect(await space(jamie.call)).toMatchObject({ id: null, canOpen: false });
  });

  it('keeps what they’re given across a reload, and loses it when they’re removed', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const plan = await doc(art, id, 'Plan');
    const { host, code: c } = await callBy(art);
    await host.setWorkspace(id);
    const jamie = await guest(host, c);
    await jamie.call.askForWorkspace(true);
    const ask = (await settle(host, (x) => x.workspace.asks.length === 1)).workspace.asks[0];
    await host.grantWorkspaceAsk(ask?.id ?? '', plan, 'read');
    jamie.call.closing();
    const back = await jamie.api.calls.join(c, { mic: false, cam: false, name: 'Jamie Guest', previous: jamie.call.ticket.pass });
    await inGroup(back);
    expect(await space(back)).toMatchObject({ id, canOpen: true });
    expect((await jamie.api.workspaces.get(id, { pass: back.ticket.pass })).items.map((x) => x.id)).toEqual([plan]);
    await host.remove(back.ticket.identity);
    expect(await count("SELECT count(*)::int AS n FROM document_access WHERE document_id = $1 AND kind = 'seat'", [plan])).toBe(0);
    expect(await code(jamie.api.workspaces.get(id, { pass: back.ticket.pass }))).toBe('unauthenticated');
  });
});

const collect = async <T>(parts: AsyncIterable<T>): Promise<T[]> => { const out: T[] = []; for await (const p of parts) out.push(p); return out; };

describe('the call’s follow-ups', () => {
  /** A call with notes on, someone invited in it, and the recording under way. */
  async function withNotes(org: Account, guests: string[] = []) {
    const c = await callBy(org, { notes: 'on', guests });
    for (const at of [0, 1]) await c.host.appendAudio(piece(audioBytes('follow-ups'), 0, at));
    return c;
  }
  const followUps = async (call: CallSession) => {
    const stop = call.watchFollowUps();
    await until(() => call.followUps.getSnapshot() !== null, 'the follow-ups');
    stop();
    return call.followUps;
  };
  /** The follow-ups once they're as `ok` says. */
  async function read2(call: CallSession, ok: (items: NonNullable<ReturnType<CallSession['followUps']['getSnapshot']>>) => boolean) {
    const stop = call.watchFollowUps();
    await until(() => { const f = call.followUps.getSnapshot(); return f !== null && ok(f); }, 'the follow-ups to say so');
    stop();
    const f = call.followUps.getSnapshot();
    if (!f) throw new Error('no follow-ups');
    return f;
  }
  const inDocuments = (f: { items: { from: string }[] }) => f.items.filter((x) => x.from === 'document');

  it('are the notes’ and the documents’, each only for who can open it, and a tick agrees both ways', async () => {
    const art = await account();
    const priya = await account();
    const theo = await account();
    const id = await workspace(art, 'Product', [[priya, 'edit'], [theo, 'read']]);
    const plan = await doc(art, id, 'Launch plan');
    const hidden = await doc(art, id, 'Hidden');
    await art.api.workspaces.share.restrict(id, hidden, true);
    const { host, code: c } = await withNotes(art, [priya.email, theo.email]);
    const p = await invited(host, c, priya);
    const t = await invited(host, c, theo);
    await host.setWorkspace(id);
    const jamie = await guest(host, c);
    await host.transcribe(speech('Kofi will book the press briefing by Friday.', 0, 0), host.ticket.identity);
    const reading = host.watchNotes();
    await settle(host, (x) => (x.liveNotes.notes?.next.length ?? 0) > 0);
    reading();

    // Written in a document in this call, with a person and a date. A to-do without both isn't a follow-up.
    const a = await open(art, id, plan, { pass: host.ticket.pass });
    addTodo(a, 't1', 'Send the brief to ', { who: { id: 'priya', name: priya.name }, when: '2026-11-06' });
    addTodo(a, 't2', 'Nobody’s yet');
    addTodo(a, 't3', 'No date', { who: { id: 'priya', name: priya.name } });
    await saved(a);
    const b = await open(art, id, hidden, { pass: host.ticket.pass });
    addTodo(b, 'h1', 'CANARY-HIDDEN-TODO ', { who: { id: 'art', name: art.name }, when: '2026-11-07' });
    await saved(b);

    const mine = await read2(host, (f) => inDocuments(f).length === 2);
    expect(mine.notes).toBe('on');
    expect(mine.items.filter((x) => x.from === 'notes').map((x) => x.text)).toEqual(['Kofi will book the press briefing by Friday.']);
    expect(mine.items.find((x) => x.from === 'document' && x.block === 't1')).toEqual({
      from: 'document', workspaceId: id, documentId: plan, document: 'Launch plan', block: 't1', text: `Send the brief to ${priya.name} by 2026-11-06`,
      mentions: [{ id: 'priya', name: priya.name }], dates: ['2026-11-06'], done: false, canTick: true
    });
    // Priya can't open the restricted one, and isn't told it's there; Theo can read and not tick; Jamie can open nothing.
    const hers = await read2(p, (f) => inDocuments(f).length === 1);
    expect(JSON.stringify(hers)).not.toContain('CANARY-HIDDEN-TODO');
    expect(inDocuments(await read2(t, (f) => inDocuments(f).length === 1))[0]).toMatchObject({ block: 't1', canTick: false });
    const guestSees = await read2(jamie.call, () => true);
    expect(inDocuments(guestSees)).toEqual([]);
    expect(JSON.stringify(guestSees)).not.toContain('Send the brief');

    // A tick from the follow-ups is the document's tick: everyone with it open sees it.
    const tick = { workspaceId: id, documentId: plan, block: 't1' };
    await p.tickDocumentFollowUp({ ...tick, done: true });
    await until(() => documentTodos(a.doc, 'document')[0]?.done === true, 'the document to be ticked');
    expect((await read2(host, (f) => f.items.some((x) => x.from === 'document' && x.block === 't1' && x.done))).items.length).toBeGreaterThan(0);
    await p.tickDocumentFollowUp({ ...tick, done: false });
    await until(() => documentTodos(a.doc, 'document')[0]?.done === false, 'the tick to come off');
    // And a tick in the document is the follow-up's.
    const block = blockOf(a, 't1');
    if (!block) throw new Error('no block');
    setAttr(block, 'done', true);
    await saved(a);
    await read2(p, (f) => f.items.some((x) => x.from === 'document' && x.block === 't1' && x.done));
    setAttr(block, 'done', false);
    await saved(a);
    await read2(p, (f) => f.items.some((x) => x.from === 'document' && x.block === 't1' && !x.done));

    // Reading doesn't let you tick, even a tick that changes nothing and would say you worked on it; nor does what isn't one.
    expect(await code(t.tickDocumentFollowUp({ ...tick, done: true }))).toBe('forbidden');
    expect(await code(t.tickDocumentFollowUp({ ...tick, done: false }))).toBe('forbidden');
    expect(await code(jamie.call.tickDocumentFollowUp({ ...tick, done: true }))).toBe('not-found');
    expect(await code(host.tickDocumentFollowUp({ ...tick, block: 't2', done: true }))).toBe('not-found');
    expect(await code(host.tickDocumentFollowUp({ ...tick, block: 'nothing', done: true }))).toBe('not-found');
    expect(documentTodos(a.doc, 'document').map((x) => x.done)).toEqual([false, false, false]);
    // A tick is someone working on it.
    const stored = await storedCall(art.ownerId, host.ticket.callId);
    expect(JSON.stringify(stored.state['workspace'])).toContain(priya.name);
  });

  it('come from documents alone when notes are off, and say so, and only from what was worked on in this call', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const plan = await doc(art, id, 'Plan');
    const other = await doc(art, id, 'Not touched');
    const before = await open(art, id, other);
    addTodo(before, 'b1', 'From before the call ', { who: { id: 'art', name: art.name }, when: '2026-11-06' });
    await saved(before);
    const { host } = await callBy(art, { notes: 'off' });
    await host.setWorkspace(id);
    const a = await open(art, id, plan, { pass: host.ticket.pass });
    addTodo(a, 't1', 'Written in the call ', { who: { id: 'art', name: art.name }, when: '2026-11-06' });
    await saved(a);
    // The same person in the same document, without the call's pass, wasn't working in the call.
    const f = await read2(host, (x) => inDocuments(x).length === 1);
    expect(f.notes).toBe('off');
    expect(f.items.map((x) => x.text)).toEqual([`Written in the call ${art.name} by 2026-11-06`]);
    // Nothing in a document nobody worked on in this call can be ticked from it, nor a document elsewhere.
    expect(await code(host.tickDocumentFollowUp({ workspaceId: id, documentId: other, block: 'b1', done: true }))).toBe('not-found');
    const elsewhere = await callBy(art);
    expect(await code(elsewhere.host.tickDocumentFollowUp({ workspaceId: id, documentId: plan, block: 't1', done: true }))).toBe('not-found');
    expect(await code(host.tickDocumentFollowUp({ workspaceId: madeUp(), documentId: plan, block: 't1', done: true }))).toBe('not-found');
    expect((await followUps(host)).getSnapshot()?.items).toHaveLength(1);
  });

  it('aren’t ticked by someone who lost the document on the way: access is asked again as it’s written', async () => {
    const art = await account();
    const priya = await account();
    const id = await workspace(art, 'Product');
    const { id: member } = await art.api.workspaces.addPerson(id, priya.email, 'edit');
    const plan = await doc(art, id, 'Plan');
    const { host, code: c } = await callBy(art, { guests: [priya.email] });
    const p = await invited(host, c, priya);
    await host.setWorkspace(id);
    const a = await open(art, id, plan, { pass: host.ticket.pass });
    addTodo(a, 't1', 'Send the brief ', { who: { id: 'art', name: art.name }, when: '2026-11-06' });
    await saved(a);
    await read2(p, (f) => inDocuments(f).length === 1);
    const waiting = () => count("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");

    // With the workspace held, taking Priya out queues for it first. Her tick is past its first look by the time it queues behind that.
    const held = await h.pool.connect();
    try {
      await held.query('BEGIN');
      await held.query('SELECT 1 FROM workspaces WHERE workspace_id = $1 FOR UPDATE', [id]);
      const base = await waiting();
      const out = art.api.workspaces.removePerson(id, member);
      await until(async () => (await waiting()) > base, 'taking her out to wait for the workspace');
      const ticked = code(p.tickDocumentFollowUp({ workspaceId: id, documentId: plan, block: 't1', done: true }));
      await until(async () => (await waiting()) > base + 1, 'the tick to wait behind it');
      await held.query('COMMIT');
      await out;
      expect(await ticked).toBe('not-found');
    } finally {
      held.release();
    }
    expect(documentTodos((await open(art, id, plan)).doc, 'document').map((x) => x.done)).toEqual([false]);
  });

  it('stop being read once the call has ended', async () => {
    const art = await account();
    const { host } = await callBy(art);
    const pass = { 'x-alcove-call': host.ticket.pass };
    await host.leave();
    const res = await fetch(`${h.baseUrl}/v1/live/calls/${host.ticket.callId}/follow-ups`, { headers: pass });
    expect(res.status).toBe(409);
  });
});

describe('what was worked on', () => {
  it('keeps a version for each document when the call ends, and tells each reader of the note only what they can open', async () => {
    const art = await account();
    const priya = await account();
    const theo = await account();
    const id = await workspace(art, 'Product', [[priya, 'edit']]);
    const plan = await doc(art, id, 'Launch plan');
    const hidden = await doc(art, id, 'CANARY-RESTRICTED Hidden');
    await art.api.workspaces.share.restrict(id, hidden, true);
    const board = (await art.api.workspaces.items.create(id, { kind: 'board', name: 'Board' })).id;
    const untouched = await doc(art, id, 'Untouched');
    const { host, code: c } = await callBy(art, { notes: 'on', guests: [priya.email, theo.email] });
    await host.appendAudio(piece(audioBytes('worked'), 0, 0));
    const p = await invited(host, c, priya);
    await invited(host, c, theo);
    await host.setWorkspace(id);
    await type(art, host, id, plan, 'Art’s words. ');
    await type(priya, p, id, plan, 'Priya’s words. ');
    await type(art, host, id, hidden, 'Restricted words. ');
    // Written without the call's pass, by someone in the call: not worked on in it.
    const aside = await open(art, id, untouched);
    firstLine(aside).insert(0, 'Not in the call.');
    await saved(aside);
    const b = await open(art, id, board, { pass: host.ticket.pass });
    b.doc.getMap('objects').set('note', 'A sticky');
    await saved(b);

    const ended = await host.leave();
    const noteId = ended?.pendingNoteId;
    const asArt = await noteOf(art, noteId);
    const by = (n: Note, doc2: string) => n.workedOn.find((x) => x.id === doc2)?.by.map((x) => x.name).sort();
    expect(asArt.workedOn.map((x) => x.id).sort()).toEqual([plan, hidden, board].sort());
    expect(asArt.workedOn.find((x) => x.id === plan)).toMatchObject({ workspaceId: id, kind: 'document', name: 'Launch plan' });
    expect(asArt.workedOn.find((x) => x.id === board)).toMatchObject({ kind: 'board', name: 'Board' });
    expect(by(asArt, plan)).toEqual([art.name, priya.name].sort());
    // Priya has the note and can open only two of them: the third isn't counted, or named.
    const asPriya = await priya.api.notes.get(noteId ?? '');
    expect(asPriya.workedOn.map((x) => x.id).sort()).toEqual([plan, board].sort());
    expect(JSON.stringify(asPriya)).not.toContain('CANARY-RESTRICTED');
    // Theo has the note and can open none of them.
    const asTheo = await theo.api.notes.get(noteId ?? '');
    expect(asTheo.workedOn).toEqual([]);
    // It follows what they can open now: sharing it shows it, a rename is the name, Trash takes it off.
    await art.api.workspaces.share.set(id, plan, [{ email: theo.email }], 'read');
    await art.api.workspaces.items.rename(id, plan, 'Launch plan, renamed');
    expect((await theo.api.notes.get(noteId ?? '')).workedOn.map((x) => x.name)).toEqual(['Launch plan, renamed']);
    await art.api.workspaces.items.trash(id, plan);
    expect((await theo.api.notes.get(noteId ?? '')).workedOn).toEqual([]);
    await art.api.workspaces.items.restore(id, plan);

    // A version with reason `call` of each, filed under the call, and one of nothing else.
    for (const document of [plan, hidden, board]) {
      await until(async () => (await art.api.workspaces.versions(id, document)).some((v) => v.reason === 'call' && v.callId === host.ticket.callId), 'a version for the call');
    }
    expect((await art.api.workspaces.versions(id, plan)).find((v) => v.reason === 'call')?.by.map((x) => x.name).sort()).toEqual([art.name, priya.name].sort());
    expect((await art.api.workspaces.versions(id, untouched)).filter((v) => v.reason === 'call')).toEqual([]);
    // A document deleted since isn't on the note for anyone.
    await art.api.workspaces.items.trash(id, hidden);
    await art.api.workspaces.items.deleteForever(id, hidden);
    expect((await art.api.notes.get(noteId ?? '')).workedOn.map((x) => x.id).sort()).toEqual([plan, board].sort());
    // The call keeps none of it.
    const stored = await storedCall(art.ownerId, host.ticket.callId);
    expect(stored.state['workspace']).toMatchObject({ worked: [], present: [], play: [], asks: [] });
  });

  it('keeps nothing beyond the versions for a call with notes off', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const plan = await doc(art, id, 'Plan');
    const { host } = await callBy(art, { notes: 'off' });
    await host.setWorkspace(id);
    await type(art, host, id, plan, 'Words. ');
    expect(JSON.stringify((await storedCall(art.ownerId, host.ticket.callId)).state['workspace'])).toContain(art.name);
    const ended = await host.leave();
    expect(ended?.pendingNoteId).toBeNull();
    await until(async () => (await art.api.workspaces.versions(id, plan)).some((v) => v.reason === 'call'), 'the version');
    expect((await art.api.workspaces.versions(id, plan)).filter((v) => v.reason === 'call')).toHaveLength(1);
    expect(JSON.stringify((await storedCall(art.ownerId, host.ticket.callId)).state['workspace'])).not.toContain(art.name);
  });
});

describe('presenting', () => {
  async function presented() {
    const art = await account();
    const priya = await account();
    const theo = await account();
    const id = await workspace(art, 'Product', [[priya, 'edit'], [theo, 'read']]);
    const plan = await doc(art, id, 'Launch plan');
    const { host, code: c } = await callBy(art, { guests: [priya.email, theo.email] });
    const p = await invited(host, c, priya);
    const t = await invited(host, c, theo);
    await host.setWorkspace(id);
    return { art, priya, theo, id, plan, host, c, p, t };
  }
  it('is for whoever can open it, moved and stopped by them or the organizer, and tells everyone else only that it’s happening', async () => {
    const { art, priya, id, plan, host, c, p, t } = await presented();
    const jamie = await guest(host, c);
    await p.startPresenting('document', plan);
    expect(p.getSnapshot().workspace.present).toEqual({ kind: 'document', id: plan, name: 'Launch plan', section: 0, by: { seat: expect.any(String), name: priya.name }, mine: true, canControl: true });
    expect((await space(host)).present).toMatchObject({ id: plan, mine: false, canControl: true });
    expect((await space(t)).present).toMatchObject({ id: plan, mine: false, canControl: false });
    expect((await space(jamie.call)).present).toEqual({ kind: null, id: null, name: null, section: null, by: expect.objectContaining({ name: priya.name }), mine: false, canControl: false });

    // Only them or the organizer.
    await p.movePresenting(2);
    expect((await space(t)).present?.section).toBe(2);
    expect(await code(t.movePresenting(3))).toBe('forbidden');
    expect(await code(jamie.call.movePresenting(3))).toBe('forbidden');
    expect(await code(t.stopPresenting())).toBe('forbidden');
    expect(await code(t.startPresenting('document', plan))).toBe('conflict');
    await host.movePresenting(3);
    expect((await space(p)).present?.section).toBe(3);
    // Someone who comes late lands where everyone is.
    const late = await guest(host, c, 'Late Guest');
    expect((await space(late.call)).present).toMatchObject({ id: null, name: null, section: null });
    const again = await priya.api.calls.join(c, { mic: false, cam: false, previous: p.ticket.pass });
    await inGroup(again);
    expect((await space(again)).present).toMatchObject({ id: plan, section: 3, mine: true, canControl: true });
    await host.stopPresenting();
    expect((await space(again)).present).toBeNull();
    expect(await code(host.stopPresenting())).toBe('conflict');
    expect(await code(again.movePresenting(1))).toBe('conflict');

    // Nothing that isn't in the call's workspace, and nothing but what it says it is.
    const other = await workspace(art, 'Other');
    const elsewhere = await doc(art, other, 'Elsewhere');
    expect(await code(host.startPresenting('document', elsewhere))).toBe('not-found');
    expect(await code(host.startPresenting('board', plan))).toBe('not-found');
    const board = (await art.api.workspaces.items.create(id, { kind: 'board', name: 'Board' })).id;
    expect(await code(host.startPresenting('document', board))).toBe('not-found');
    await host.startPresenting('board', board);
    expect((await space(again)).present).toMatchObject({ kind: 'board', id: board, name: 'Board' });
    await host.stopPresenting();
    const folder = (await art.api.workspaces.items.create(id, { kind: 'folder', name: 'Folder' })).id;
    expect(await code(host.startPresenting('document', folder))).toBe('not-found');
    const trashed = await doc(art, id, 'Going');
    await art.api.workspaces.items.trash(id, trashed);
    expect(await code(host.startPresenting('document', trashed))).toBe('conflict');
    expect(await code(host.startPresenting('document', madeUp()))).toBe('not-found');
  });

  it('changes nobody’s access, and stops for whoever loses the document and for everyone when the presenter does', async () => {
    const { art, theo, id, plan, host, p, t } = await presented();
    await host.startPresenting('document', plan, 1);
    await art.api.workspaces.share.restrict(id, plan, true);
    // Theo can't open it now: they're told it's on, without its name. Being shown it gave them nothing.
    expect((await space(t)).present).toEqual({ kind: null, id: null, name: null, section: null, by: expect.objectContaining({ name: art.name }), mine: false, canControl: false });
    expect(await code(open(theo, id, plan, { pass: t.ticket.pass }))).toBe('not-found');
    expect((await space(host)).present).toMatchObject({ id: plan, section: 1 });
    await host.stopPresenting();
    await art.api.workspaces.share.restrict(id, plan, false);

    // Priya presents it and loses it: it stops for everyone, and doesn't come back when she's given it again.
    await p.startPresenting('document', plan, 2);
    await art.api.workspaces.share.restrict(id, plan, true);
    expect((await space(t)).present).toBeNull();
    expect((await space(p)).present).toBeNull();
    expect((await space(host)).present).toBeNull();
    await art.api.workspaces.share.restrict(id, plan, false);
    expect((await space(p)).present).toBeNull();
    // And it's nothing in the way of someone else presenting.
    await t.startPresenting('document', plan);
    expect((await space(host)).present).toMatchObject({ id: plan, section: 0 });
  });

  it('stops when the workspace changes, the presenter is removed or moves, and with the call', async () => {
    const { art, id, plan, host, c, p } = await presented();
    const other = await workspace(art, 'Other');
    await p.startPresenting('document', plan);
    await host.setWorkspace(other);
    expect((await space(p)).present).toBeNull();
    await host.setWorkspace(id);
    expect((await space(p)).present).toBeNull();
    // Removed.
    await p.startPresenting('document', plan);
    await host.remove(p.ticket.identity);
    expect((await space(host)).present).toBeNull();
    // The call ending takes it, and someone who stayed to the end isn't left with it.
    const jamie = await guest(host, c, 'Second Guest');
    await host.startPresenting('document', plan);
    expect((await space(jamie.call)).present).toMatchObject({ id: null });
    await host.leave();
    expect((await storedCall(art.ownerId, host.ticket.callId)).state['workspace']).toMatchObject({ present: [] });
  });

  it('hides while whoever started it is reloading, and is theirs again when they’re back', async () => {
    const { priya, plan, host, c, p, t } = await presented();
    await p.startPresenting('document', plan, 4);
    p.closing();
    await settle(host, (s) => !s.participants.some((x) => x.id === p.ticket.identity));
    expect((await space(t)).present).toBeNull();
    const back = await priya.api.calls.join(c, { mic: false, cam: false, previous: p.ticket.pass });
    await inGroup(back);
    expect((await space(t)).present).toMatchObject({ id: plan, section: 4, canControl: false });
    expect((await space(back)).present).toMatchObject({ mine: true, canControl: true });
    await back.movePresenting(5);
    expect((await space(t)).present?.section).toBe(5);
    await back.leave();
    // Someone who's gone for good holds nothing up.
    await settle(host, (s) => !s.participants.some((x) => x.id === back.ticket.identity));
    await host.startPresenting('document', plan);
    expect((await space(t)).present).toMatchObject({ section: 0 });
  });

  it('isn’t shown to a part of the call whoever started it came back to somewhere else from', async () => {
    const { priya, plan, host, c, p, t } = await presented();
    await p.startPresenting('document', plan);
    p.closing();
    await settle(host, (s) => !s.participants.some((x) => x.id === p.ticket.identity));
    // Rooms open while she's away, with her in one, so that's where she comes back to.
    host.openRooms({ rooms: [{ name: 'One', emails: [priya.email] }, { name: 'Two', emails: [] }], minutes: 5 });
    const room = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms[0]?.id;
    expect(room).toBeDefined();
    const back = await priya.api.calls.join(c, { mic: false, cam: false, previous: p.ticket.pass });
    await until(() => back.crypto.getSnapshot().place === room, 'her to be in her room');
    expect((await settle(host, (s) => s.participants.some((x) => x.id === back.ticket.identity))).participants.map((x) => x.id)).toContain(back.ticket.identity);
    expect((await space(t)).present).toBeNull();
    expect((await space(host)).present).toBeNull();
    expect((await space(back)).present).toBeNull();
    // It's in nobody's way there, either.
    await t.startPresenting('document', plan);
    expect((await space(host)).present).toMatchObject({ id: plan, mine: false });
  });

  it('is for the part of the call it started in', async () => {
    const { priya, theo, plan, host, p, t } = await presented();
    host.openRooms({ rooms: [{ name: 'One', emails: [priya.email] }, { name: 'Two', emails: [theo.email] }], minutes: 5 });
    const rooms = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms ?? [];
    await until(() => p.crypto.getSnapshot().place === rooms[0]?.id && t.crypto.getSnapshot().place === rooms[1]?.id, 'everyone to be in their rooms');
    await p.startPresenting('document', plan);
    await t.startPresenting('document', plan);
    expect((await space(p)).present).toMatchObject({ id: plan, mine: true });
    expect((await space(t)).present).toMatchObject({ id: plan, mine: true });
    expect((await space(host)).present).toBeNull();
    // A room closing takes what's presented in it.
    host.closeRooms();
    await settle(p, (s) => s.breakouts.open === null);
    expect((await space(p)).present).toBeNull();
    expect((await space(t)).present).toBeNull();
  });
});

describe('presenter notes', () => {
  it('are yours alone, by document, for anyone with an account who can open it, and sealed', async () => {
    const art = await account();
    const priya = await account();
    const id = await workspace(art, 'Product', [[priya, 'edit']]);
    const plan = await doc(art, id, 'Plan');
    const other = await workspace(priya, 'Hers');
    const hers = await doc(priya, other, 'Hers');
    expect(await art.api.workspaces.presenterNotes.get(id, plan)).toEqual({ text: '' });
    await art.api.workspaces.presenterNotes.set(id, plan, 'CANARY-PRESENTER thank Aiko');
    expect(await art.api.workspaces.presenterNotes.get(id, plan)).toEqual({ text: 'CANARY-PRESENTER thank Aiko' });
    // Someone else who can open it has their own.
    expect(await priya.api.workspaces.presenterNotes.get(id, plan)).toEqual({ text: '' });
    await priya.api.workspaces.presenterNotes.set(id, plan, 'Priya’s');
    expect(await art.api.workspaces.presenterNotes.get(id, plan)).toEqual({ text: 'CANARY-PRESENTER thank Aiko' });
    // A document they can't open, or that's in another workspace, reads as nothing there.
    expect(await refusal(art.api.workspaces.presenterNotes.get(other, hers))).toEqual(await refusal(art.api.workspaces.presenterNotes.get(madeUp(), hers)));
    expect(await code(art.api.workspaces.presenterNotes.set(other, hers, 'No'))).toBe('not-found');
    expect(await code(art.api.workspaces.presenterNotes.get(id, hers))).toBe('not-found');
    expect(await code(art.api.workspaces.presenterNotes.set(id, plan, 'x'.repeat(20_001)))).toBe('invalid');
    // Someone in a call with no account has nowhere to keep them, even with the document open.
    const { host, code: c } = await callBy(art);
    await host.setWorkspace(id);
    const jamie = await guest(host, c);
    await jamie.call.askForWorkspace(true);
    const ask = (await settle(host, (x) => x.workspace.asks.length === 1)).workspace.asks[0];
    await host.grantWorkspaceAsk(ask?.id ?? '', plan, 'edit');
    expect(await code(jamie.api.workspaces.presenterNotes.get(id, plan, { pass: jamie.call.ticket.pass }))).toBe('forbidden');
    expect(await code(jamie.api.workspaces.presenterNotes.set(id, plan, 'Mine', { pass: jamie.call.ticket.pass }))).toBe('forbidden');
    // Losing the document loses the way to them, and the record can't be moved to another place.
    const lost = await workspace(art, 'Lost', [[priya, 'edit']]);
    const lostDoc = await doc(art, lost, 'Lost');
    await priya.api.workspaces.presenterNotes.set(lost, lostDoc, 'Mine');
    await art.api.workspaces.share.restrict(lost, lostDoc, true);
    expect(await code(priya.api.workspaces.presenterNotes.get(lost, lostDoc))).toBe('not-found');
    const row = (await h.pool.query<{ body_ciphertext: Buffer }>('SELECT body_ciphertext FROM presenter_notes WHERE owner_id = $1 AND document_id = $2', [art.ownerId, plan])).rows[0];
    expect(row?.body_ciphertext.includes(Buffer.from('CANARY-PRESENTER'))).toBe(false);
    await h.pool.query('UPDATE presenter_notes SET body_ciphertext = $3 WHERE owner_id = $1 AND document_id = $2', [priya.ownerId, plan, row?.body_ciphertext]);
    expect(await code(priya.api.workspaces.presenterNotes.get(id, plan))).toBe('key-unavailable');
    // Empty text leaves nothing.
    await art.api.workspaces.presenterNotes.set(id, plan, '');
    expect(await count('SELECT count(*)::int AS n FROM presenter_notes WHERE owner_id = $1 AND document_id = $2', [art.ownerId, plan])).toBe(0);
  });

  it('go with the document, the workspace or the account, leaving no rows', async () => {
    const art = await account();
    const priya = await account();
    const id = await workspace(art, 'Product', [[priya, 'edit']]);
    const one = await doc(art, id, 'One');
    const two = await doc(art, id, 'Two');
    for (const d of [one, two]) {
      await art.api.workspaces.presenterNotes.set(id, d, 'Art’s');
      await priya.api.workspaces.presenterNotes.set(id, d, 'Priya’s');
    }
    expect(await count('SELECT count(*)::int AS n FROM presenter_notes WHERE document_id = ANY($1::text[])', [[one, two]])).toBe(4);
    await art.api.workspaces.items.trash(id, one);
    await art.api.workspaces.items.deleteForever(id, one);
    expect(await count('SELECT count(*)::int AS n FROM presenter_notes WHERE document_id = $1', [one])).toBe(0);
    await priya.api.account.delete();
    expect(await count('SELECT count(*)::int AS n FROM presenter_notes WHERE owner_id = $1', [priya.ownerId])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM presenter_notes WHERE document_id = $1', [two])).toBe(1);
    await art.api.workspaces.remove(id);
    expect(await count('SELECT count(*)::int AS n FROM presenter_notes WHERE document_id = $1', [two])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM presenter_notes WHERE owner_id = $1', [art.ownerId])).toBe(0);
  });
});

describe('playing a video together', () => {
  async function playing() {
    const art = await account();
    const priya = await account();
    const theo = await account();
    const id = await workspace(art, 'Product', [[priya, 'edit'], [theo, 'read']]);
    const film = await doc(art, id, 'Launch film');
    const media = madeUp();
    const s = await open(art, id, film);
    addVideo(s, 'v1', media);
    await saved(s);
    const { host, code: c } = await callBy(art, { guests: [priya.email, theo.email] });
    const p = await invited(host, c, priya);
    const t = await invited(host, c, theo);
    await host.setWorkspace(id);
    return { art, priya, theo, id, film, media, host, c, p, t };
  }
  it('is for whoever can open the document, on the server’s clock, and controlled by whoever started it or the organizer', async () => {
    const { art, priya, id, film, media, host, c, p, t } = await playing();
    const jamie = await guest(host, c);
    const t0 = Date.now();
    await p.startPlaying(film, media, 42_000);
    const mine = p.getSnapshot().workspace.play;
    expect(mine).toMatchObject({ mediaId: media, documentId: film, by: { name: priya.name }, playing: true, positionMs: 42_000, mine: true, canControl: true });
    expect(mine?.atMs).toBeGreaterThanOrEqual(t0 - 2000);
    // Only those who can open the document are told.
    expect((await space(jamie.call)).play).toBeNull();
    expect(said(jamie.call.getSnapshot())).not.toContain(media);
    expect((await space(t)).play).toMatchObject({ mediaId: media, mine: false, canControl: false });
    expect((await space(host)).play).toMatchObject({ canControl: true });

    // Someone who comes late lands at the same moment: the server's clock says so, whatever theirs says.
    await rest(400);
    const late = await read(t);
    const at = late.workspace.play;
    if (!at) throw new Error('nothing playing');
    expect(playPosition(at)).toBeGreaterThanOrEqual(42_300);
    expect(playPosition(at)).toBeLessThan(45_000);
    expect(playPosition(at, 1000)).toBe(playPosition(at) + 1000);

    // Only whoever controls it.
    expect(await code(t.pausePlaying(50_000))).toBe('forbidden');
    expect(await code(t.seekPlaying(1))).toBe('forbidden');
    expect(await code(t.stopPlaying())).toBe('forbidden');
    expect(await code(t.resumePlaying())).toBe('forbidden');
    expect(await code(t.startPlaying(film, media))).toBe('conflict');
    // Pause holds it at the same moment for everyone, and the clock stops counting.
    await p.pausePlaying(50_000);
    const held = await read(t);
    expect(held.workspace.play).toMatchObject({ playing: false, positionMs: 50_000 });
    await rest(100);
    const still = (await read(t)).workspace.play;
    if (!still) throw new Error('nothing playing');
    expect(playPosition(still)).toBe(50_000);
    await host.seekPlaying(10_000);
    expect((await space(p)).play).toMatchObject({ playing: false, positionMs: 10_000 });
    await p.resumePlaying();
    expect((await space(t)).play).toMatchObject({ playing: true, positionMs: 10_000 });
    await host.stopPlaying();
    expect((await space(p)).play).toBeNull();
    expect(await code(p.pausePlaying(1))).toBe('conflict');
    expect(await code(p.stopPlaying())).toBe('conflict');
    // Stored media stays: the video is still a block in the document.
    const page = await open(art, id, film);
    expect(blockOf(page, 'v1')?.getAttribute('media')).toBe(media);
  });

  it('takes only a video that’s in a document of the call’s workspace', async () => {
    const { art, id, film, media, host } = await playing();
    const other = await workspace(art, 'Other');
    const elsewhere = await doc(art, other, 'Elsewhere');
    const e = await open(art, other, elsewhere);
    const there = madeUp();
    addVideo(e, 'v2', there);
    await saved(e);
    const plain = await doc(art, id, 'No video');
    expect(await code(host.startPlaying(elsewhere, there))).toBe('not-found');
    expect(await code(host.startPlaying(film, there))).toBe('not-found');
    expect(await code(host.startPlaying(plain, media))).toBe('not-found');
    expect(await code(host.startPlaying(madeUp(), media))).toBe('not-found');
    expect((await action(art, host, { type: 'play-start', documentId: film, mediaId: media, positionMs: -1 })).status).toBe(400);
    expect((await action(art, host, { type: 'play-seek', positionMs: 86_400_001 })).status).toBe(400);
  });

  it('stops for whoever loses the document, for everyone when whoever started it does, and when the workspace, room or call changes', async () => {
    const { art, theo, id, film, media, host, p, t } = await playing();
    // Whoever loses it stops being told; the person who started it, and the organizer, carry on.
    await host.startPlaying(film, media);
    await art.api.workspaces.share.restrict(id, film, true);
    expect((await space(t)).play).toBeNull();
    expect((await space(host)).play).toMatchObject({ mediaId: media });
    await host.stopPlaying();
    await art.api.workspaces.share.restrict(id, film, false);
    // Whoever started it losing it stops it for everyone, for good.
    await p.startPlaying(film, media);
    await art.api.workspaces.share.restrict(id, film, true);
    expect((await space(p)).play).toBeNull();
    expect((await space(host)).play).toBeNull();
    await art.api.workspaces.share.restrict(id, film, false);
    expect((await space(p)).play).toBeNull();

    await host.startPlaying(film, media);
    const other = await workspace(art, 'Other');
    await host.setWorkspace(other);
    expect((await space(p)).play).toBeNull();
    await host.setWorkspace(id);
    expect((await space(p)).play).toBeNull();

    // Someone removed takes what they started with them.
    await p.startPlaying(film, media);
    await host.remove(p.ticket.identity);
    expect((await space(t)).play).toBeNull();

    // Sent to a room, someone stops being told; the person playing it leaving the main room stops it.
    await host.startPlaying(film, media);
    host.openRooms({ rooms: [{ name: 'One', emails: [theo.email] }, { name: 'Two', emails: [] }], minutes: 5 });
    const rooms = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms ?? [];
    await until(() => t.crypto.getSnapshot().place === rooms[0]?.id, 'Theo to be in their room');
    expect((await space(t)).play).toBeNull();
    expect((await space(host)).play).toMatchObject({ mediaId: media });
    host.visitRoom(rooms[0]?.id ?? null);
    await until(() => host.crypto.getSnapshot().place === rooms[0]?.id, 'the organizer to be in the room');
    expect((await space(host)).play).toBeNull();
    host.visitRoom(null);
    await until(() => host.crypto.getSnapshot().place === 'main', 'the organizer to be back');
    expect((await space(host)).play).toBeNull();

    // The call ending stops it, and the video stays in the document.
    host.closeRooms();
    await settle(host, (s) => s.breakouts.open === null);
    await host.startPlaying(film, media);
    await host.leave();
    expect((await storedCall(art.ownerId, host.ticket.callId)).state['workspace']).toMatchObject({ play: [] });
    expect(blockOf(await open(art, id, film), 'v1')).toBeDefined();
  });
});

describe('the next call’s agenda', () => {
  /** A call in a series, its next one, and the agenda it was worked on in, with what was left open. */
  async function series() {
    const art = await account();
    const priya = await account();
    const id = await workspace(art, 'Product', [[priya, 'edit']]);
    const folder = (await art.api.workspaces.items.create(id, { kind: 'folder', name: 'Weekly' })).id;
    const agenda = await doc(art, id, 'Agenda', folder);
    const at = Date.now() + 3_600_000;
    const m = await art.api.meetings.create({ title: 'Weekly', startsAt: new Date(at).toISOString(), durationMinutes: 30, guests: [priya.email], notes: 'off', workspaceId: id });
    const next = await art.api.meetings.scheduleNext(m.id, new Date(at + 7 * 86_400_000).toISOString());
    const first = await art.api.calls.join(m.code, { mic: false, cam: false });
    await inGroup(first);
    const page = await open(art, id, agenda, { pass: first.ticket.pass });
    addTodo(page, 'open1', 'CANARY-AGENDA book the briefing ', { who: { id: 'priya', name: priya.name }, when: '2026-11-06' });
    addTodo(page, 'open2', 'Who signs off the pricing? ', { who: { id: 'art', name: art.name } });
    addTodo(page, 'shut1', 'Already settled', { done: true });
    addTodo(page, 'blank', '');
    await saved(page);
    await first.leave();
    await until(async () => (await art.api.workspaces.versions(id, agenda)).some((v) => v.reason === 'call'), 'the version');
    return { art, priya, id, folder, agenda, next, page };
  }
  const agendaIn = async (who: Account, id: string, call: CallSession) => {
    const s = await settle(call, (x) => x.workspace.agenda !== null);
    const page = await open(who, id, s.workspace.agenda ?? '', { pass: call.ticket.pass });
    return { id: s.workspace.agenda ?? '', page };
  };

  it('is waiting in the next call, in the same folder, with only what was left open, once however many open it at once', async () => {
    const { art, priya, id, folder, agenda, next } = await series();
    const host = await art.api.calls.join(next.code, { mic: false, cam: false });
    await inGroup(host);
    const p = await invited(host, next.code, priya);
    const before = (await art.api.workspaces.get(id)).items.length;
    await Promise.all([host.openWorkspace(), p.openWorkspace(), host.openWorkspace(), p.openWorkspace()]);
    const tree = await art.api.workspaces.get(id);
    expect(tree.items).toHaveLength(before + 1);
    const made = await agendaIn(art, id, host);
    const item = tree.items.find((x) => x.id === made.id);
    expect(item).toMatchObject({ kind: 'document', parent: folder });
    expect(item?.name).toMatch(/^Agenda · \d{1,2} \p{L}{3,4}$/u);
    expect(item?.id).not.toBe(agenda);
    // It's the document everyone finds at the top, and it was made by the server, through the log like anything else.
    expect(host.getSnapshot().workspace.documents.map((x) => x.id)).toContain(made.id);
    expect((await space(p)).agenda).toBe(made.id);
    const { title, blocks } = documentText(made.page.doc, 'document');
    expect(title).toBe(item?.name);
    expect(blocks.map((b) => [b.type, b.text])).toEqual([
      ['heading', 'From last time'],
      ['todo', `CANARY-AGENDA book the briefing ${priya.name} by 2026-11-06`],
      ['todo', `Who signs off the pricing? ${art.name}`],
      ['heading', 'Today'],
      ['heading', 'Notes']
    ]);
    expect(documentTodos(made.page.doc, 'document').map((t) => [t.done, t.mentions.map((m) => m.name), t.dates])).toEqual([
      [false, [priya.name], ['2026-11-06']], [false, [art.name], []]
    ]);
    // The block IDs are the editor's kind, one each, and the fragment holds what the editor's schema says: a title, then lines.
    const fragment = made.page.doc.getXmlFragment('content').toArray();
    expect(fragment[0]).toBeInstanceOf(Y.XmlElement);
    const lines = fragment.slice(1).flatMap((el) => (el instanceof Y.XmlElement ? [el] : []));
    expect(lines.every((el) => el.nodeName === 'line')).toBe(true);
    expect(new Set(lines.map((el) => el.getAttribute('id'))).size).toBe(lines.length);
    expect(lines.map((el) => el.getAttribute('kind') ?? null)).toEqual(['heading', 'todo', 'todo', 'heading', 'numbered', 'heading', null]);
    expect(lines[0]?.getAttribute('level')).toBe(2);
    // Opening it again makes no other, and neither does the call starting again.
    await host.openWorkspace();
    expect((await art.api.workspaces.get(id)).items).toHaveLength(before + 1);
    const left = await host.leave();
    expect(left?.meetingId).toBe(next.id);
    const reopened = await art.api.calls.join(next.code, { mic: false, cam: false });
    await inGroup(reopened);
    await reopened.openWorkspace();
    expect((await art.api.workspaces.get(id)).items).toHaveLength(before + 1);
  });

  it('carries what’s left open from the one before it, and stays private when the last one was', async () => {
    const { art, priya, id, agenda, next, page } = await series();
    // Someone ticks one off between calls.
    const open1 = blockOf(page, 'open1');
    if (!open1) throw new Error('no block');
    setAttr(open1, 'done', true);
    await saved(page);
    await art.api.workspaces.share.restrict(id, agenda, true);
    await art.api.workspaces.share.set(id, agenda, [{ email: unique('shared') }], 'read');
    const host = await art.api.calls.join(next.code, { mic: false, cam: false });
    await inGroup(host);
    const p = await invited(host, next.code, priya);
    await p.openWorkspace();
    const made = await agendaIn(art, id, host);
    expect(documentTodos(made.page.doc, 'document').map((t) => t.text)).toEqual([`Who signs off the pricing? ${art.name}`]);
    // Restricted as it was: Priya couldn't read the last one, and can't read this one.
    expect(await space(p)).toMatchObject({ agenda: null, documents: [] });
    expect((await art.api.workspaces.get(id)).items.find((x) => x.id === made.id)?.restricted).toBe(true);
    expect((await art.api.workspaces.share.list(id, made.id)).entries).toHaveLength(1);
    expect((await priya.api.workspaces.get(id)).items.some((x) => x.id === made.id)).toBe(false);
    await host.leave();
  });

  it('isn’t made for a call that isn’t in a series, in another workspace, or from one that’s gone', async () => {
    const { art, next } = await series();
    const other = await workspace(art, 'Other');
    await art.api.meetings.update(next.id, { workspaceId: other });
    const host = await art.api.calls.join(next.code, { mic: false, cam: false });
    await inGroup(host);
    await host.openWorkspace();
    expect(host.getSnapshot().workspace).toMatchObject({ id: other, agenda: null });
    expect((await art.api.workspaces.get(other)).items).toEqual([]);
    await host.leave();
    const again = await series();
    await again.art.api.workspaces.items.trash(again.id, again.agenda);
    const h2 = await again.art.api.calls.join(again.next.code, { mic: false, cam: false });
    await inGroup(h2);
    await h2.openWorkspace();
    expect(h2.getSnapshot().workspace.agenda).toBeNull();
    const single = await callBy(art);
    await single.host.setWorkspace(other);
    await single.host.openWorkspace();
    expect(single.host.getSnapshot().workspace.agenda).toBeNull();
  });
});

describe('asking Alcove about a selection', () => {
  it('needs edit, goes sealed to the notes model, keeps nothing, and costs nobody credits', async () => {
    const art = await account();
    const theo = await account();
    const id = await workspace(art, 'Product', [[theo, 'read']]);
    const plan = await doc(art, id, 'Plan');
    const credits = await art.api.credits.balance();
    const from = h.near.prompts.length;
    expect(await collect(art.api.workspaces.ask(id, plan, { action: 'shorter', text: 'CANARY-SELECTION a long way of saying it' }))).toEqual([{ type: 'text', text: 'Shorter: CANARY-SELECTION a long way of saying it' }]);
    expect(await collect(art.api.workspaces.ask(id, plan, { action: 'checklist', text: 'Book the room; send the brief' }))).toEqual([{ type: 'todo', text: 'Book the room' }, { type: 'todo', text: 'send the brief' }]);
    expect(h.near.prompts.slice(from).join(' ')).toContain('CANARY-SELECTION');
    expect(Buffer.concat(h.near.received.map((r) => r.body)).includes(Buffer.from('CANARY-SELECTION'))).toBe(false);
    expect(await art.api.credits.balance()).toEqual(credits);
    // Reading isn't enough, and what's elsewhere isn't there. Nothing refused reaches the model.
    const asked = h.near.prompts.length;
    expect(await code(collect(theo.api.workspaces.ask(id, plan, { action: 'shorter', text: 'Words' })))).toBe('forbidden');
    const trashed = await doc(art, id, 'Going');
    await art.api.workspaces.items.trash(id, trashed);
    expect(await code(collect(art.api.workspaces.ask(id, trashed, { action: 'shorter', text: 'Words' })))).toBe('conflict');
    const lena = await account();
    expect(await refusal(collect(lena.api.workspaces.ask(id, plan, { action: 'shorter', text: 'Words' })))).toEqual(await refusal(collect(lena.api.workspaces.ask(madeUp(), plan, { action: 'shorter', text: 'Words' }))));
    expect(await code(collect(art.api.workspaces.ask(id, madeUp(), { action: 'shorter', text: 'Words' })))).toBe('not-found');
    expect(await code(collect(art.api.workspaces.ask(id, plan, { action: 'shorter', text: ' ' })))).toBe('invalid');
    expect(await code(collect(art.api.workspaces.ask(id, plan, { action: 'shorter', text: 'x'.repeat(8001) })))).toBe('invalid');
    expect(h.near.prompts.length).toBe(asked);
    // Nothing is kept: no receipt, and no log line, says what was asked.
    expect(await count("SELECT count(*)::int AS n FROM operations WHERE owner_id = $1 AND method LIKE '%/ask'", [art.ownerId])).toBe(0);
    expect(h.logs.join('').includes('CANARY-SELECTION')).toBe(false);
  });

  it('is for a guest who can edit, waits while notes are paused, and isn’t sent to someone who lost it meanwhile', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const plan = await doc(art, id, 'Plan');
    const { host, code: c } = await callBy(art, { notes: 'on' });
    await host.setWorkspace(id);
    const jamie = await guest(host, c);
    await jamie.call.askForWorkspace(true);
    const ask = (await settle(host, (x) => x.workspace.asks.length === 1)).workspace.asks[0];
    await host.grantWorkspaceAsk(ask?.id ?? '', plan, 'edit');
    const pass = { pass: jamie.call.ticket.pass };
    expect(await collect(jamie.api.workspaces.ask(id, plan, { action: 'shorter', text: 'From a guest' }, pass))).toEqual([{ type: 'text', text: 'Shorter: From a guest' }]);
    await host.pause();
    const sent = h.near.prompts.length;
    expect(await refusal(collect(jamie.api.workspaces.ask(id, plan, { action: 'shorter', text: 'Held' }, pass)))).toMatchObject({ code: 'conflict', message: expect.stringContaining('paused') });
    expect(await code(collect(art.api.workspaces.ask(id, plan, { action: 'shorter', text: 'Held' }, { pass: host.ticket.pass })))).toBe('conflict');
    expect(h.near.prompts.length).toBe(sent);
    // Outside the call, the same person isn't held by it.
    expect(await code(collect(art.api.workspaces.ask(id, plan, { action: 'shorter', text: 'Elsewhere' })))).toBe('allowed');
    await host.resume();
    // Lost while the model was writing: nothing comes back.
    const entry = (await art.api.workspaces.share.list(id, plan)).entries[0];
    h.near.holdNext(async () => { await art.api.workspaces.share.remove(id, plan, entry?.id ?? ''); });
    expect(await code(collect(jamie.api.workspaces.ask(id, plan, { action: 'shorter', text: 'Words' }, pass)))).toBe('not-found');
  });

  it('is limited, per person', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const plan = await doc(art, id, 'Plan');
    const answers = await Promise.all(Array.from({ length: 22 }, () => code(collect(art.api.workspaces.ask(id, plan, { action: 'shorter', text: 'Words' })))));
    expect(answers.filter((x) => x === 'unavailable').length).toBeGreaterThan(0);
    expect(answers.filter((x) => x === 'allowed').length).toBeGreaterThan(0);
  });
});

describe('a live call comes first', () => {
  it('ends at once whatever a document is doing, and keeps its versions afterwards', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const plan = await doc(art, id, 'Plan');
    const { host } = await callBy(art);
    await host.setWorkspace(id);
    (await type(art, host, id, plan, 'words')).close();
    const { livekit } = h.deps;
    const deleteRoom = livekit.deleteRoom;
    let roomGone = false;
    livekit.deleteRoom = async (room) => { roomGone = true; return deleteRoom.call(livekit, room); };
    const workers = stuckWorkers('fold', 'read');
    try {
      await soon(host.leave(), 'ending a call while a worker is stuck');
      expect(roomGone).toBe(true);
    } finally {
      workers.free();
      livekit.deleteRoom = deleteRoom;
    }
    await until(async () => (await art.api.workspaces.versions(id, plan)).some((v) => v.reason === 'call'), 'the version');
  });

  it('says so when what comes after a call fails, and the call has ended all the same', async () => {
    const art = await account();
    const id = await workspace(art, 'Product');
    const plan = await doc(art, id, 'Plan');
    const { host } = await callBy(art);
    await host.setWorkspace(id);
    (await type(art, host, id, plan, 'words')).close();
    const pool = h.deps.docs;
    const run = pool.run;
    const real = pool.run.bind(pool);
    pool.run = (task, input, o) => (task === 'fold' ? Promise.reject(new DocFailure('time', 'over the limit')) : real(task, input, o));
    try {
      await soon(host.leave(), 'ending a call with a worker failing');
      await until(() => h.logs.some((l) => l.includes('version not kept for a call') && l.includes(host.ticket.callId)), 'the failure to be logged');
    } finally {
      pool.run = run;
    }
    expect((await art.api.workspaces.versions(id, plan)).filter((v) => v.reason === 'call')).toEqual([]);
  });
});

describe('what the previous release stored', () => {
  it('still opens: a call, its meeting, a note and an account from before any of this', async () => {
    const art = await account();
    const priya = await account();
    const { host, code: c } = await callBy(art, { notes: 'on', guests: [priya.email] });
    await host.appendAudio(piece(audioBytes('stored'), 0, 0));
    await host.transcribe(speech('Said before this release.', 0, 0), host.ticket.identity);
    const p = await invited(host, c, priya);
    const { ownerId } = art;
    const { callId } = host.ticket;
    // Sealed as the release before this one sealed it: no `workspace`.
    const stored = await storedCall(ownerId, callId);
    const { workspace: _w, ...older } = stored.state;
    await h.pool.query('UPDATE calls SET state_ciphertext = $3 WHERE owner_id = $1 AND call_id = $2', [ownerId, callId, sealJson(stored.key, stored.header, toJson(older))]);
    const o = await openOwner(h.deps, ownerId, undefined);
    const meeting = await getItem(o, o.pool, 'meeting', host.getSnapshot().meetingId, MeetingManifest, 'That meeting');
    const { workspaceId: _id, agenda: _a, ...oldMeeting } = meeting.manifest;
    await saveRevision(o, o.pool, meeting.itemId, meeting.revisionId, oldMeeting);
    const [profile] = await listItems(o, o.pool, 'profile', Profile);
    if (!profile) throw new Error('no profile');
    const { recentWorkspace: _r, ...oldProfile } = profile.manifest;
    await saveRevision(o, o.pool, profile.itemId, profile.revisionId, oldProfile);

    expect(await space(host)).toMatchObject({ id: null, canOpen: false, documents: [], present: null, play: null, asks: [], asked: 'no' });
    expect((await read(p)).transcript.map((l) => l.text)).toEqual(['Said before this release.']);
    await host.openWorkspace();
    expect(host.getSnapshot().workspace.canOpen).toBe(true);
    const ended = await host.leave();
    const noteId = ended?.pendingNoteId ?? '';
    await noteOf(art, noteId);

    // A note from before: no `workedOn`.
    const note = await getItem(o, o.pool, 'note', noteId, NoteManifest, 'Those notes');
    const { workedOn: _worked, ...oldNote } = note.manifest;
    await saveRevision(o, o.pool, note.itemId, note.revisionId, oldNote);
    expect((await art.api.notes.get(noteId)).workedOn).toEqual([]);
    expect((await priya.api.notes.get(noteId)).workedOn).toEqual([]);
  });
});

describe('every ID from a request', () => {
  it('reaches only this call and this workspace', async () => {
    const art = await account();
    const lena = await account();
    const mine = await workspace(art, 'Mine');
    const plan = await doc(art, mine, 'Plan');
    const hers = await workspace(lena, 'Hers');
    const herDoc = await doc(lena, hers, 'Hers');
    const herVideo = madeUp();
    const hv = await open(lena, hers, herDoc);
    addVideo(hv, 'v', herVideo);
    await saved(hv);
    const { host } = await callBy(art);
    await host.setWorkspace(mine);
    const theirCall = await callBy(lena);
    await theirCall.host.setWorkspace(hers);

    // Another workspace's document, in this call's actions.
    const fromElsewhere: CallAction[] = [
      { type: 'workspace-set', workspaceId: hers }, { type: 'workspace-bring', documentId: herDoc, brought: true },
      { type: 'present-start', kind: 'document', id: herDoc, section: 0 }, { type: 'play-start', documentId: herDoc, mediaId: herVideo, positionMs: 0 }
    ];
    for (const a of fromElsewhere) expect(`${a.type} → ${(await action(art, host, a)).status}`).toBe(`${a.type} → 404`);
    // Another call's pass on this call's routes.
    const routes = ['/follow-ups', '/actions', `/workspace/${mine}`];
    for (const path of routes) {
      const res = await fetch(`${h.baseUrl}/v1/live/calls/${host.ticket.callId}${path}`, { headers: { 'x-alcove-call': theirCall.host.ticket.pass } });
      expect(`${path} → ${res.status}`).toMatch(/→ 40[14]$/);
    }
    // A workspace's routes with a document of another workspace.
    expect(await code(art.api.workspaces.presenterNotes.get(mine, herDoc))).toBe('not-found');
    expect(await code(art.api.workspaces.presenterNotes.set(mine, herDoc, 'No'))).toBe('not-found');
    expect(await code(collect(art.api.workspaces.ask(mine, herDoc, { action: 'shorter', text: 'No' })))).toBe('not-found');
    expect(await code(host.tickDocumentFollowUp({ workspaceId: hers, documentId: herDoc, block: 'v', done: true }))).toBe('not-found');
    // What's in a request that isn't an ID is refused before it reaches anything.
    expect((await action(art, host, { type: 'workspace-set', workspaceId: 'not an id' })).status).toBe(400);
    expect((await action(art, host, { type: 'present-move', section: -1 })).status).toBe(400);
    expect(await code(host.previewWorkspace('../secrets'))).toMatch(/not-found|invalid/);
    // Nothing of what was tried landed.
    expect(await space(host)).toMatchObject({ id: mine, documents: [], present: null, play: null });
    await host.bringDocument(plan, true);
    expect((await space(host)).documents.map((x) => x.id)).toEqual([plan]);
  });

  it('leaves no seats, asks or state behind in upkeep', async () => {
    const art = await account();
    const id = await workspace(art, 'Mine');
    const plan = await doc(art, id, 'Plan');
    const { host, code: c } = await callBy(art);
    await host.setWorkspace(id);
    const jamie = await guest(host, c);
    await jamie.call.askForWorkspace(true);
    const ask = (await settle(host, (x) => x.workspace.asks.length === 1)).workspace.asks[0];
    await host.grantWorkspaceAsk(ask?.id ?? '', plan, 'read');
    await h.pool.query("UPDATE calls SET state = 'ended', ended_at = now() WHERE call_id = $1", [host.ticket.callId]);
    expect((await maintain(h.deps)).seats).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM document_access WHERE call_id = $1", [host.ticket.callId])).toBe(0);
  });
});

describe('what’s kept', () => {
  const encodings = (s: string) => [s, Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64').slice(0, 12), Buffer.from(s).toString('base64url').slice(0, 12)];
  it('holds nothing readable: presenter notes, an agenda, what was worked on, or anything asked', async () => {
    const art = await account();
    const worker = await account('canary-worker@canary.example');
    const id = await workspace(art, 'CANARY-CALLSPACE', [[worker, 'edit']]);
    const agenda = await doc(art, id, 'Agenda CANARY-AGENDANAME');
    await art.api.workspaces.presenterNotes.set(id, agenda, 'CANARY-PRESENTERNOTE thank the pilot team');
    await worker.api.workspaces.presenterNotes.set(id, agenda, 'CANARY-THEIRNOTE mention the 20th');
    const at = Date.now() + 3_600_000;
    const m = await art.api.meetings.create({ title: 'CANARY-CALLTITLE', startsAt: new Date(at).toISOString(), durationMinutes: 30, guests: [worker.email], notes: 'on', workspaceId: id });
    const next = await art.api.meetings.scheduleNext(m.id, new Date(at + 7 * 86_400_000).toISOString());
    const host = await art.api.calls.join(m.code, { mic: false, cam: false });
    await inGroup(host);
    await host.appendAudio(piece(audioBytes('canary-kept'), 0, 0));
    const w = await invited(host, m.code, worker);
    const page = await open(worker, id, agenda, { pass: w.ticket.pass });
    addTodo(page, 'a1', 'CANARY-OPENTODO book the briefing ', { who: { id: 'canary-mention', name: 'CANARY-MENTION Priya' }, when: '2026-11-06' });
    const media = madeUp();
    addVideo(page, 'v1', media);
    await saved(page);
    await w.startPresenting('document', agenda, 1);
    await w.startPlaying(agenda, media, 1000);
    const jamie = await guest(host, m.code, 'CANARY-GUESTNAME Jamie');
    await jamie.call.askForWorkspace(true);
    const ask = (await settle(host, (x) => x.workspace.asks.length === 1)).workspace.asks[0];
    await host.grantWorkspaceAsk(ask?.id ?? '', agenda, 'read');
    await collect(art.api.workspaces.ask(id, agenda, { action: 'shorter', text: 'CANARY-ASKEDSELECTION a long way of saying it' }));
    const live = String((await h.pool.query(`SELECT string_agg(row_to_json(x)::text, ' ') AS all FROM document_access x`)).rows[0]?.all ?? '');
    const ended = await host.leave();
    const note = await noteOf(art, ended?.pendingNoteId);
    expect(note.workedOn.map((x) => x.by.map((b) => b.name))).toEqual([[worker.name]]);

    const nextCall = await art.api.calls.join(next.code, { mic: false, cam: false });
    await inGroup(nextCall);
    await nextCall.openWorkspace();
    const made = (await settle(nextCall, (x) => x.workspace.agenda !== null)).workspace.agenda ?? '';
    expect(documentTodos((await open(art, id, made, { pass: nextCall.ticket.pass })).doc, 'document')[0]?.text).toContain('CANARY-OPENTODO');
    await nextCall.leave();
    await until(async () => (await art.api.workspaces.versions(id, agenda)).some((v) => v.reason === 'call'), 'the version');

    const canaries = ['CANARY-CALLSPACE', 'CANARY-AGENDANAME', 'CANARY-PRESENTERNOTE', 'CANARY-THEIRNOTE', 'CANARY-CALLTITLE', 'CANARY-OPENTODO', 'CANARY-MENTION', 'canary-mention', 'CANARY-GUESTNAME', 'CANARY-ASKEDSELECTION', 'canary-worker', 'Canary Worker', 'From last time', media];
    const tables = (await h.pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")).rows.map((r) => r.table_name);
    expect(tables).toContain('presenter_notes');
    const dump = await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (${tables.map((t) => `SELECT row_to_json(x)::text AS t FROM ${t} x`).join(' UNION ALL ')}) q`);
    const rowsText = `${String(dump.rows[0]?.all ?? '')} ${live}`;
    expect(rowsText).toContain('body_ciphertext');
    for (const canary of canaries) for (const enc of encodings(canary)) expect(rowsText.includes(enc), `${canary} as ${enc} in rows`).toBe(false);
    for await (const obj of h.objects.list()) {
      const bytes = Buffer.from(await h.objects.get(obj.id));
      for (const canary of canaries) for (const enc of encodings(canary)) expect(bytes.includes(Buffer.from(enc)), `${canary} in ${obj.id}`).toBe(false);
    }
    // What the model is sent crosses the wire sealed, and the logs say what happened and nothing of what it said.
    expect(h.near.prompts.some((p) => p.includes('CANARY-ASKEDSELECTION'))).toBe(true);
    const wire = Buffer.concat(h.near.received.map((r) => r.body));
    for (const canary of canaries) for (const enc of encodings(canary)) expect(wire.includes(Buffer.from(enc)), `${canary} on the wire to NEAR AI`).toBe(false);
    const logText = h.logs.join('');
    for (const canary of canaries) for (const enc of encodings(canary)) expect(logText.includes(enc), `${canary} as ${enc} in logs`).toBe(false);
    expect(logText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) ?? []).toEqual([]);
  });
});
