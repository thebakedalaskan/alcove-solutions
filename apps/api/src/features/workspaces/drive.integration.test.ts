/**
 * The Drive's reads, end to end: what a document says at the top, for its card, only for someone who can open it, kept nowhere
 * and logged nowhere; and one Trash for every workspace someone can open something in. Through browsers talking to the real
 * API over HTTP via @alcove/api-http, on real Postgres.
 */
import { AlcoveApiError, MAX_PREVIEWS, PREVIEW_CHARS, type DocSession, type ItemKind, type WorkspaceRole } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { startHarness, type Browser, type Harness } from '../../testing/harness';

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
const madeUp = () => randomBytes(16).toString('base64url');
/** How a request was refused, as a browser sees it, or `allowed`. */
const code = (p: Promise<unknown>) => p.then(() => 'allowed', (e: unknown) => (e instanceof AlcoveApiError ? e.code : `not-an-api-error: ${String(e)}`));
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

/* ---------- writing in a document, as the editor writes it ---------- */

/** Attributes as y-prosemirror writes them: of any type, though Yjs's types say strings. */
const setAttr = (el: Y.XmlElement, name: string, value: unknown) => { Reflect.apply(el.setAttribute, el, [name, value]); };
type Inline = string | { mention: string } | { date: string };
/** A block as the editor's schema has it: a line of some kind, with words, tags and dates in it, or a block that isn't text. */
type Block = { line: Inline[]; kind?: string; done?: boolean } | { gallery: number } | { file: string } | { video: string } | { toggle: string };
function blockOf(b: Block, id: string): Y.XmlElement {
  const el = new Y.XmlElement('line' in b ? 'line' : 'gallery' in b ? 'gallery' : 'file' in b ? 'file' : 'video' in b ? 'video' : 'toggle');
  setAttr(el, 'id', id);
  if ('gallery' in b) setAttr(el, 'items', Array.from({ length: b.gallery }, (_, i) => ({ media: `m${i}`, name: `photo ${i}.jpg`, width: 800, height: 600 })));
  if ('file' in b) setAttr(el, 'name', b.file);
  if ('video' in b) setAttr(el, 'title', b.video);
  if ('toggle' in b) {
    const summary = new Y.XmlElement('toggleSummary');
    const words = new Y.XmlText();
    summary.insert(0, [words]);
    el.insert(0, [summary]);
    words.insert(0, b.toggle);
  }
  if (!('line' in b)) return el;
  if (b.kind) setAttr(el, 'kind', b.kind);
  if (b.done) setAttr(el, 'done', true);
  el.insert(0, b.line.map((part) => {
    if (typeof part === 'string') { const t = new Y.XmlText(); t.insert(0, part); return t; }
    const inline = new Y.XmlElement('mention' in part ? 'mention' : 'dateChip');
    if ('mention' in part) { inline.setAttribute('id', 'someone'); inline.setAttribute('name', part.mention); } else inline.setAttribute('date', part.date);
    return inline;
  }));
  return el;
}
/** Opens a document, writes its title and these blocks under its empty first line, and waits until Alcove has them. */
async function write(who: Browser, id: string, doc: string, titled: string, blocks: Block[]): Promise<DocSession> {
  const s = await who.api.workspaces.document(id, doc);
  await s.ready;
  s.doc.transact(() => {
    const content = s.doc.getXmlFragment('content');
    const head = content.get(0);
    if (titled && head instanceof Y.XmlElement) { const t = new Y.XmlText(); head.insert(0, [t]); t.insert(0, titled); }
    content.insert(content.length, blocks.map((b) => blockOf(b, `block-${seq++}`)));
  });
  await until(() => s.getSnapshot().status === 'saved', 'the words to reach Alcove');
  return s;
}

describe('previews', () => {
  it('says what a document says at the top, as its card draws it: its first lines, cut at a word, and what it holds', async () => {
    const ann = await account('ann');
    const id = await workspace(ann, 'Launch');
    const plan = await make(ann, id, 'document', 'Launch plan');
    const long = 'Orders placed before the fourteenth ship from the old warehouse, and everything after that ships from the new one on the north side';
    (await write(ann, id, plan, 'Launch plan', [
      { line: ['   '] },
      { line: ['What goes out'], kind: 'heading' },
      { toggle: 'A toggle is not a line on the page' },
      { line: ['Status page: ', { mention: 'Kofi Asante' }, ', from now on'], kind: 'todo', done: true },
      { line: ['Flag on for everyone: ', { date: `${new Date().getUTCFullYear()}-11-12` }], kind: 'todo' },
      { line: [long], kind: 'numbered' },
      { line: ['A fifth line, which no card shows'], kind: 'bullet' }
    ])).close();
    const photos = await make(ann, id, 'document', 'Handover photos');
    (await write(ann, id, photos, '', [{ gallery: 7 }, { gallery: 5 }, { video: 'The walk round' }])).close();
    const pdf = await make(ann, id, 'document', 'Floor plan');
    (await write(ann, id, pdf, 'Floor plan', [{ file: 'floor-plan.final.pdf' }, { file: 'notes.txt' }, { file: 'README' }])).close();
    const blank = await make(ann, id, 'document', '');

    const found = await ann.api.workspaces.previews(id, [plan, photos, pdf, blank]);
    expect(found.map((p) => p.id)).toEqual([plan, photos, pdf, blank]);
    const [first, second, third, fourth] = found;
    expect(first?.lines.map((l) => l.kind)).toEqual(['heading', 'done', 'todo', 'bullet']);
    expect(first?.lines.slice(0, 3).map((l) => l.text)).toEqual(['What goes out', 'Status page: Kofi Asante, from now on', 'Flag on for everyone: 12 Nov']);
    const cut = first?.lines[3]?.text ?? '';
    expect(cut.length).toBeLessThanOrEqual(PREVIEW_CHARS);
    expect(cut.endsWith('…')).toBe(true);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    // Never half a word: what's left before the ellipsis ends where a word of the line ends.
    expect(long.slice(cut.length - 1).startsWith(' ')).toBe(true);
    expect(first).toMatchObject({ pictures: 0, videos: 0, file: null });
    expect(second).toEqual({ id: photos, lines: [], pictures: 12, videos: 1, file: null });
    expect(third).toEqual({ id: pdf, lines: [], pictures: 0, videos: 0, file: 'PDF' });
    expect(fourth).toEqual({ id: blank, lines: [], pictures: 0, videos: 0, file: null });
  });

  it('leaves out what has no card of words: a board, a folder, what’s in Trash, an ID twice, and one that was never there', async () => {
    const ann = await account('ann');
    const id = await workspace(ann, 'Launch');
    const doc = await make(ann, id, 'document', 'Notes');
    (await write(ann, id, doc, 'Notes', [{ line: ['Kept'] }])).close();
    const board = await make(ann, id, 'board', 'Standup board');
    const folder = await make(ann, id, 'folder', 'Press');
    const inFolder = await make(ann, id, 'document', 'Press list', folder);
    const gone = await make(ann, id, 'document', 'Old roadmap');
    await ann.api.workspaces.items.trash(id, gone);
    await ann.api.workspaces.items.trash(id, folder);

    const found = await ann.api.workspaces.previews(id, [doc, board, folder, inFolder, gone, doc, madeUp()]);
    expect(found).toEqual([{ id: doc, lines: [{ text: 'Kept', kind: 'text' }], pictures: 0, videos: 0, file: null }]);
    expect(await ann.api.workspaces.previews(id, [])).toEqual([]);
  });

  it('is only for whoever can open each document: a restricted one isn’t anyone else’s, and someone outside sees what’s shared with them', async () => {
    const ann = await account('ann');
    const theo = await account('theo');
    const sam = await account('sam');
    const id = await workspace(ann, 'Launch', [[theo, 'read']]);
    const open = await make(ann, id, 'document', 'Launch plan');
    (await write(ann, id, open, 'Launch plan', [{ line: ['CANARY-OPEN the date holds'] }])).close();
    const closed = await make(ann, id, 'document', 'Pricing copy');
    (await write(ann, id, closed, 'Pricing copy', [{ line: ['CANARY-CLOSED the merger closes'] }])).close();
    await ann.api.workspaces.share.restrict(id, closed, true);
    const shared = await make(ann, id, 'document', 'Press list');
    (await write(ann, id, shared, 'Press list', [{ line: ['Three trade titles'] }])).close();
    await ann.api.workspaces.share.set(id, shared, [{ email: sam.email }], 'read');

    expect((await ann.api.workspaces.previews(id, [open, closed, shared])).map((p) => p.id)).toEqual([open, closed, shared]);
    const theirs = await theo.api.workspaces.previews(id, [open, closed, shared]);
    expect(theirs.map((p) => p.id)).toEqual([open, shared]);
    expect(JSON.stringify(theirs)).not.toContain('CANARY-CLOSED');
    const outside = await sam.api.workspaces.previews(id, [open, closed, shared]);
    expect(outside).toEqual([{ id: shared, lines: [{ text: 'Three trade titles', kind: 'text' }], pictures: 0, videos: 0, file: null }]);

    // Taken out of the workspace, Theo reads nothing of it, the same as for a workspace that was never there.
    const them = (await ann.api.workspaces.people(id)).find((p) => p.person.email === theo.email);
    await ann.api.workspaces.removePerson(id, them?.id ?? '');
    expect(await code(theo.api.workspaces.previews(id, [open]))).toBe('not-found');
    expect(await code(theo.api.workspaces.previews(madeUp(), [open]))).toBe('not-found');
  });

  it('reads nothing across workspaces or owners: a workspace you can’t open is not found, and another workspace’s IDs name nothing here', async () => {
    const ann = await account('ann');
    const bob = await account('bob');
    const mine = await workspace(ann, 'Launch');
    const other = await workspace(ann, 'Hiring');
    const here = await make(ann, mine, 'document', 'Launch plan');
    (await write(ann, mine, here, 'Launch plan', [{ line: ['Ours'] }])).close();
    const there = await make(ann, other, 'document', 'Interview loop');
    (await write(ann, other, there, 'Interview loop', [{ line: ['CANARY-THERE screen first'] }])).close();
    const bobs = await workspace(bob, 'Bob’s');
    const his = await make(bob, bobs, 'document', 'His plan');
    (await write(bob, bobs, his, 'His plan', [{ line: ['CANARY-HIS the price goes up'] }])).close();

    // An item named through another workspace's path is nothing there, even to someone who can open both.
    expect(await ann.api.workspaces.previews(mine, [here, there, his])).toEqual([{ id: here, lines: [{ text: 'Ours', kind: 'text' }], pictures: 0, videos: 0, file: null }]);
    // Bob's workspace doesn't exist for Ann, whatever she asks of it, and hers doesn't for him.
    for (const asked of [[his], [here], [madeUp()]]) expect(await code(ann.api.workspaces.previews(bobs, asked))).toBe('not-found');
    expect(await code(bob.api.workspaces.previews(mine, [here]))).toBe('not-found');
    expect(await code(bob.api.workspaces.previews(other, [there]))).toBe('not-found');
    // Nobody signed in reads nothing, before anything is looked at.
    const nobody = h.browser();
    expect(await code(nobody.api.workspaces.previews(mine, [here]))).toBe('unauthenticated');
  });

  it('refuses what isn’t a short list of IDs, and answers with nothing for a cache to keep', async () => {
    const ann = await account('ann');
    const id = await workspace(ann, 'Launch');
    const doc = await make(ann, id, 'document', 'Launch plan');
    const get = (query: string) => ann.fetch(`${h.baseUrl}/v1/workspaces/${id}/previews${query}`);
    for (const query of ['', '?items=', `?items=${doc},`, '?items=not-an-id', `?items=${Array.from({ length: MAX_PREVIEWS + 1 }, madeUp).join(',')}`]) {
      expect((await get(query)).status, query).toBe(400);
    }
    const ok = await get(`?items=${doc}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    // More than a request takes go in several, and come back as one answer.
    const many = await Promise.all(Array.from({ length: MAX_PREVIEWS + 6 }, (_, i) => make(ann, id, 'document', `Doc ${i}`)));
    expect((await ann.api.workspaces.previews(id, many)).map((p) => p.id)).toEqual(many);
  });

  it('keeps nothing it reads, in a table, a receipt or a log line', async () => {
    const ann = await account('ann');
    const id = await workspace(ann, 'CANARY-DRIVE-SPACE');
    const doc = await make(ann, id, 'document', 'CANARY-DRIVE-NAME');
    (await write(ann, id, doc, 'CANARY-DRIVE-TITLE', [{ line: ['CANARY-DRIVE-WORDS the merger closes'] }, { file: 'CANARY-DRIVE-FILE.pdf' }])).close();
    const from = h.logs.length;
    const found = await ann.api.workspaces.previews(id, [doc]);
    expect(found[0]?.lines[0]?.text).toBe('CANARY-DRIVE-WORDS the merger closes');
    // Read from the document as it is: what's written next is what the next card says.
    const more = await write(ann, id, doc, '', [{ line: ['CANARY-DRIVE-LATER'], kind: 'bullet' }]);
    more.close();
    expect((await ann.api.workspaces.previews(id, [doc]))[0]?.lines.map((l) => l.text)).toEqual(['CANARY-DRIVE-WORDS the merger closes', 'CANARY-DRIVE-LATER']);
    await ann.api.workspaces.trashed();
    const logged = h.logs.slice(from).join('');
    expect(logged).toContain('previews read');
    for (const canary of ['CANARY-DRIVE', 'merger closes', Buffer.from('CANARY-DRIVE-WORDS').toString('base64').slice(0, 12)]) expect(logged).not.toContain(canary);
    const receipts = await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM operations WHERE owner_id = $1', [ann.ownerId]);
    const before = receipts.rows[0]?.n ?? 0;
    await ann.api.workspaces.previews(id, [doc]);
    expect((await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM operations WHERE owner_id = $1', [ann.ownerId])).rows[0]?.n ?? 0).toBe(before);
    const everyTable = (await h.pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")).rows.map((r) => r.table_name);
    const dump = await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (${everyTable.map((x) => `SELECT row_to_json(x)::text AS t FROM ${x} x`).join(' UNION ALL ')}) q`);
    const rows = String(dump.rows[0]?.all ?? '');
    for (const canary of ['CANARY-DRIVE', 'merger closes']) expect(rows).not.toContain(canary);
  });
});

describe('one Trash', () => {
  it('lists what’s in Trash in every workspace, the latest first, with who sent it and when it goes for good', async () => {
    const ann = await account('ann');
    const ines = await account('ines');
    const launch = await workspace(ann, 'Launch', [[ines, 'edit']]);
    const hiring = await workspace(ann, 'Hiring');
    const roadmap = await make(ann, launch, 'document', 'Old roadmap');
    const press = await make(ann, hiring, 'folder', 'Press');
    const inPress = await make(ann, hiring, 'document', 'Press list', press);
    const sketches = await make(ann, launch, 'board', 'Sketches');
    const kept = await make(ann, launch, 'document', 'Launch plan');
    await ines.api.workspaces.items.trash(launch, roadmap);
    await ann.api.workspaces.items.trash(hiring, press);
    await ann.api.workspaces.items.trash(launch, sketches);

    const trash = await ann.api.workspaces.trashed();
    // The latest first; a folder and what's in it went together, the folder first, as its tree has them.
    expect(trash.map((t) => [t.workspaceId, t.item.id])).toEqual([[launch, sketches], [hiring, press], [hiring, inPress], [launch, roadmap]]);
    const sent = trash.find((t) => t.item.id === roadmap);
    expect(sent?.item).toMatchObject({ name: 'Old roadmap', kind: 'document', trashedBy: ines.name, role: 'edit' });
    expect(Date.parse(sent?.deletesAt ?? '') - Date.parse(sent?.item.trashedAt ?? '')).toBe(30 * 86_400_000);
    // What's inside a folder in Trash is there with it, at the folder's time.
    expect(trash.find((t) => t.item.id === inPress)?.item).toMatchObject({ parent: press, trashedAt: trash.find((t) => t.item.id === press)?.item.trashedAt });
    expect(trash.some((t) => t.item.id === kept)).toBe(false);

    // Restored, it's out of Trash for everyone.
    await ann.api.workspaces.items.restore(launch, roadmap);
    expect((await ines.api.workspaces.trashed()).map((t) => t.item.id)).toEqual([sketches]);
    // A workspace deleted for good takes its Trash with it.
    await ann.api.workspaces.remove(hiring);
    expect((await ann.api.workspaces.trashed()).map((t) => t.item.id)).toEqual([sketches]);
  });

  it('holds only what each person can open: nothing restricted to someone else, what’s shared with them, and nobody else’s', async () => {
    const ann = await account('ann');
    const theo = await account('theo');
    const sam = await account('sam');
    const zoe = await account('zoe');
    const id = await workspace(ann, 'Launch', [[theo, 'read']]);
    const open = await make(ann, id, 'document', 'Old plan');
    const closed = await make(ann, id, 'document', 'Pricing draft');
    await ann.api.workspaces.share.restrict(id, closed, true);
    const shared = await make(ann, id, 'document', 'Press list');
    await ann.api.workspaces.share.set(id, shared, [{ email: sam.email }], 'edit');
    for (const doc of [open, closed, shared]) await ann.api.workspaces.items.trash(id, doc);

    expect((await ann.api.workspaces.trashed()).map((t) => t.item.id).sort()).toEqual([open, closed, shared].sort());
    const theirs = await theo.api.workspaces.trashed();
    expect(theirs.map((t) => t.item.id).sort()).toEqual([open, shared].sort());
    expect(theirs.every((t) => t.item.role === 'read')).toBe(true);
    // Someone outside the workspace sees only what's shared with them, with no folder.
    expect((await sam.api.workspaces.trashed()).map((t) => [t.workspaceId, t.item.id, t.item.parent, t.item.role])).toEqual([[id, shared, null, 'edit']]);
    // Sam can bring it back, as anyone who can edit it can; Theo, who can only read it, can't.
    expect(await code(theo.api.workspaces.items.restore(id, open))).toBe('forbidden');
    await sam.api.workspaces.items.restore(id, shared);
    expect(await sam.api.workspaces.trashed()).toEqual([]);
    // Someone with nothing anywhere has an empty Trash, and nobody signed in has none.
    expect(await zoe.api.workspaces.trashed()).toEqual([]);
    expect(await code(h.browser().api.workspaces.trashed())).toBe('unauthenticated');
  });
});
