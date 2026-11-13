/**
 * Working together in a workspace: tags reaching the person, and what someone can know of where other people are. Browsers
 * talk to the real API over HTTP via @alcove/api-http, on real Postgres. What's checked is what people are told: a tag reaches
 * who can open the document, whenever they're next here, gives nobody anything, and nothing ever names a document to someone
 * who can't open it.
 */
import { AlcoveApiError, type CallState, type ItemKind, type WorkspaceHere, type WorkspaceLive, type WorkspaceRole } from '@alcove/api';
import { createHttpApi } from '@alcove/api-http';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { blindIndex } from '../../crypto';
import { maintain } from '../../maintenance';
import { documentText } from './document-text';
import { workspaceFor } from './access';
import { readDocument } from './documents';
import { masterKey } from '../../owners';
import { startHarness, type Browser, type Harness } from '../../testing/harness';

vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
afterEach(() => h.closeCalls());

let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
type Account = Browser & { email: string; name: string; ownerId: string };
async function account(email = unique()): Promise<Account> {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email });
  return { ...b, email: session.user.email, name: session.user.name, ownerId: session.ownerId };
}
const madeUp = () => randomBytes(16).toString('base64url');
const code = (p: Promise<unknown>) => p.then(() => 'allowed', (e: unknown) => (e instanceof AlcoveApiError ? e.code : `not an API error: ${String(e)}`));
async function until(ok: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const by = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}
const rest = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = async (sql: string, params: unknown[] = []) => (await h.pool.query<{ n: number }>(sql, params)).rows[0]?.n ?? -1;
async function workspace(who: Account, name: string, people: [Account, WorkspaceRole][] = []) {
  const { id } = await who.api.workspaces.create(name);
  for (const [p, role] of people) await who.api.workspaces.addPerson(id, p.email, role);
  return id;
}
const make = async (who: Account, id: string, name: string, kind: ItemKind = 'document') => (await who.api.workspaces.items.create(id, { kind, name, parent: null })).id;
const tag = (from: Account, id: string, doc: string, to: Account, block: string | null = 'line1') => from.api.workspaces.mention(id, doc, { to: { email: to.email }, block });
const here = (s: WorkspaceLive): WorkspaceHere[] => s.getSnapshot().here;
const of = (s: WorkspaceLive, who: Account): WorkspaceHere | undefined => here(s).find((x) => x.person.name === who.name);
const told = (s: WorkspaceLive) => s.getSnapshot().mentions;
const opened = (s: WorkspaceLive, what: string) => until(() => s.getSnapshot().status === 'live', what);

describe('a tag', () => {
  it('reaches whoever was tagged as it happens: who, where, and the line', async () => {
    const priya = await account();
    const art = await account();
    const kofi = await account();
    const id = await workspace(priya, 'Product', [[art, 'edit'], [kofi, 'edit']]);
    const check = await make(priya, id, 'Launch checklist');
    const a = art.api.workspaces.live(id);
    const k = kofi.api.workspaces.live(id);
    await opened(a, 'Art’s stream');
    await opened(k, 'Kofi’s stream');

    await tag(priya, id, check, art, 'c4');
    await until(() => told(a).length === 1, 'Art to hear');
    const heard = told(a)[0];
    expect(heard).toMatchObject({ document: check, block: 'c4' });
    expect(heard?.by.name).toBe(priya.name);
    // Never an address, and it's who they are in the workspace: the same as on their caret.
    expect(heard?.by.email).toBe('');
    const p = priya.api.workspaces.live(id);
    await until(() => of(a, priya) !== undefined, 'Priya to be here');
    expect(heard?.by.id).toBe(of(a, priya)?.person.id);
    // The name comes from Art's own tree: the line itself says only IDs.
    expect(JSON.stringify(heard)).not.toContain('Launch checklist');

    // Nobody else hears.
    await rest(150);
    expect(told(k)).toEqual([]);
    expect(told(p)).toEqual([]);
    for (const s of [a, k, p]) s.close();
  });

  it('crosses instances, and every window of theirs hears', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'Doc');
    const second = await h.secondServer();
    const otherApi = createHttpApi({ baseUrl: second.baseUrl, fetch: theo.fetch });
    const other = otherApi.workspaces.live(id);
    const same = theo.api.workspaces.live(id);
    await opened(other, 'one window');
    await opened(same, 'another window');
    await tag(ann, id, doc, theo);
    await until(() => told(other).length === 1 && told(same).length === 1, 'both windows to hear');
    const mentionId = told(same)[0]?.id ?? '';
    expect(mentionId).not.toBe('');
    await same.seen(mentionId);
    await until(() => told(other).length === 0 && told(same).length === 0, 'both windows to clear the read tag');
    expect(await otherApi.workspaces.mentions()).toEqual([]);
    expect(await theo.api.workspaces.mentions()).toEqual([]);
    other.close();
    same.close();
    await second.close();
  });

  it('waits for someone who isn’t here, and they hear when they’re back, wherever they are in the app', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'Pricing');

    await tag(ann, id, doc, theo, 'p3');
    const waiting = await theo.api.workspaces.mentions();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ workspaceId: id, document: doc, block: 'p3', name: 'Pricing' });

    // Opening the workspace says so, as many times as it's opened, until they've seen it.
    const first = theo.api.workspaces.live(id);
    await until(() => told(first).length === 1, 'the tag on opening');
    first.close();
    const again = theo.api.workspaces.live(id);
    await until(() => told(again).length === 1, 'the tag on opening again');
    const mention = told(again)[0]?.id ?? '';
    await again.seen(mention);
    expect(told(again)).toEqual([]);
    expect(await theo.api.workspaces.mentions()).toEqual([]);
    expect(await count('SELECT count(*)::int AS n FROM workspace_mentions WHERE mention_id = $1', [mention])).toBe(0);
    again.close();

    // Seeing something that's gone changes nothing.
    expect(await code(theo.api.workspaces.mentionSeen(id, mention))).toBe('allowed');
    const third = theo.api.workspaces.live(id);
    await opened(third, 'the stream');
    await rest(100);
    expect(told(third)).toEqual([]);
    third.close();
  });

  it('never gives anyone anything: someone who can’t open the document isn’t told, and the answer doesn’t say so', async () => {
    const ann = await account();
    const diego = await account();
    const member = await account();
    const id = await workspace(ann, 'Ours', [[member, 'edit']]);
    const doc = await make(ann, id, 'CANARY-TAGGED-DOC');
    await ann.api.workspaces.share.restrict(id, doc, true);

    // Nobody it isn't shared with: outside the workspace, or inside it and restricted.
    const canTheyTell = [await code(tag(ann, id, doc, diego)), await code(tag(ann, id, doc, member)), await code(ann.api.workspaces.mention(id, doc, { to: { email: `${madeUp().slice(0, 8)}@nowhere.example` }, block: null }))];
    expect(canTheyTell).toEqual(['allowed', 'allowed', 'allowed']);
    expect(await diego.api.workspaces.mentions()).toEqual([]);
    expect(await member.api.workspaces.mentions()).toEqual([]);
    expect(await code(diego.api.workspaces.get(id))).toBe('not-found');
    expect(await code(diego.api.workspaces.items.get(id, doc))).toBe('not-found');
    expect(await code(member.api.workspaces.items.get(id, doc))).toBe('not-found');
    expect(await code(member.api.workspaces.versions(id, doc))).toBe('not-found');
    expect(await count('SELECT count(*)::int AS n FROM workspace_mentions WHERE document_id = $1', [doc])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM document_access WHERE document_id = $1', [doc])).toBe(0);
    const m = member.api.workspaces.live(id);
    await opened(m, 'the member’s stream');
    await rest(100);
    expect(told(m)).toEqual([]);
    expect(JSON.stringify(m.getSnapshot())).not.toContain('CANARY-TAGGED-DOC');
    m.close();

    // Sharing is a choice someone makes, and then the same tag reaches them, in that document and no other.
    await ann.api.workspaces.share.set(id, doc, [{ email: diego.email }], 'read');
    await tag(ann, id, doc, diego);
    const waiting = await diego.api.workspaces.mentions();
    expect(waiting.map((w) => w.document)).toEqual([doc]);
    expect(waiting[0]?.name).toBe('CANARY-TAGGED-DOC');
    const other = await make(ann, id, 'Something else');
    expect(await code(diego.api.workspaces.items.get(id, other))).toBe('not-found');
  });

  it('can only be made by someone who can edit that document, and only there', async () => {
    const ann = await account();
    const reader = await account();
    const stranger = await account();
    const mine = await account();
    const id = await workspace(ann, 'Ours', [[reader, 'read'], [mine, 'edit']]);
    const doc = await make(ann, id, 'Doc');
    const elsewhere = await workspace(stranger, 'Theirs');
    const theirs = await make(stranger, elsewhere, 'Theirs');

    expect(await code(tag(reader, id, doc, mine))).toBe('forbidden');
    expect(await code(tag(stranger, id, doc, mine))).toBe('not-found');
    // An ID from another workspace is nothing here, the same as one made up.
    expect(await code(tag(ann, id, theirs, mine))).toBe('not-found');
    expect(await code(tag(ann, id, madeUp(), mine))).toBe('not-found');
    expect(await code(tag(ann, madeUp(), doc, mine))).toBe('not-found');
    expect(await code(ann.api.workspaces.mention(id, doc, { to: { email: mine.email }, block: 'no spaces in a block' }))).toBe('invalid');
    expect(await mine.api.workspaces.mentions()).toEqual([]);
    // Nothing in Trash can change.
    await ann.api.workspaces.items.trash(id, doc);
    expect(await code(tag(ann, id, doc, mine))).toBe('conflict');
    // Tagging yourself tells nobody.
    const other = await make(ann, id, 'Other');
    await tag(ann, id, other, ann);
    expect(await ann.api.workspaces.mentions()).toEqual([]);
  });

  it('isn’t heard by someone who lost the document while it waited, and is theirs alone to clear', async () => {
    const ann = await account();
    const theo = await account();
    const zoe = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit'], [zoe, 'edit']]);
    const lost = await make(ann, id, 'CANARY-LOST-DOC');
    const trashed = await make(ann, id, 'In Trash');
    const kept = await make(ann, id, 'Still theirs');
    await tag(ann, id, lost, theo);
    await tag(ann, id, trashed, theo);
    await tag(ann, id, kept, theo);
    await tag(ann, id, kept, zoe);

    // Someone else can't clear it, by ID or by trying.
    const zoes = await zoe.api.workspaces.mentions();
    const theos = await theo.api.workspaces.mentions();
    expect(theos).toHaveLength(3);
    const stream = theo.api.workspaces.live(id);
    await until(() => told(stream).length === 3, 'the unread tags before access changes');
    await zoe.api.workspaces.mentionSeen(id, theos[0]?.id ?? '');
    expect(await theo.api.workspaces.mentions()).toHaveLength(3);
    expect(await code(theo.api.workspaces.mentionSeen(madeUp(), zoes[0]?.id ?? ''))).toBe('not-found');

    await ann.api.workspaces.share.restrict(id, lost, true);
    await ann.api.workspaces.items.trash(id, trashed);
    const left = await theo.api.workspaces.mentions();
    expect(left.map((m) => m.document)).toEqual([kept]);
    expect(JSON.stringify(left)).not.toContain('CANARY-LOST-DOC');
    await until(() => told(stream).length === 1, 'the tag that’s left');
    expect(told(stream)[0]?.document).toBe(kept);
    // A tag in something they lost is gone for good. One in Trash waits to see if it comes back.
    expect(await count('SELECT count(*)::int AS n FROM workspace_mentions WHERE document_id = $1', [lost])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM workspace_mentions WHERE document_id = $1', [trashed])).toBe(1);
    await ann.api.workspaces.items.restore(id, trashed);
    expect((await theo.api.workspaces.mentions()).map((m) => m.document).sort()).toEqual([kept, trashed].sort());

    // Taken out of the workspace: nothing's kept for them, and nothing's said.
    const person = (await ann.api.workspaces.people(id)).find((p) => p.person.email === theo.email);
    await ann.api.workspaces.removePerson(id, person?.id ?? '');
    expect(await theo.api.workspaces.mentions()).toEqual([]);
    await until(() => stream.getSnapshot().status === 'closed', 'the removed person’s stream to close');
    expect(told(stream)).toEqual([]);
    stream.close();
    expect(await count('SELECT count(*)::int AS n FROM workspace_mentions WHERE document_id = ANY($1::text[]) AND mention_id <> $2', [[kept, trashed], zoes[0]?.id ?? ''])).toBe(0);
  });

  it('goes physically, with its document, the account it waits for, and after 30 days', async () => {
    const ann = await account();
    const theo = await account();
    const zoe = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit'], [zoe, 'edit']]);
    const doc = await make(ann, id, 'Doc');
    const old = await make(ann, id, 'Old');
    const kept = await make(ann, id, 'Kept');
    await tag(ann, id, doc, theo);
    await tag(ann, id, old, zoe);
    await tag(ann, id, kept, theo);

    await ann.api.workspaces.items.trash(id, doc);
    await ann.api.workspaces.items.deleteForever(id, doc);
    expect(await count('SELECT count(*)::int AS n FROM workspace_mentions WHERE document_id = $1', [doc])).toBe(0);

    await h.pool.query("UPDATE workspace_mentions SET created_at = now() - interval '31 days' WHERE document_id = $1", [old]);
    await maintain(h.deps);
    expect(await count('SELECT count(*)::int AS n FROM workspace_mentions WHERE document_id = $1', [old])).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM workspace_mentions WHERE document_id = $1', [kept])).toBe(1);

    await theo.api.account.delete();
    expect(await count('SELECT count(*)::int AS n FROM workspace_mentions WHERE document_id = $1', [kept])).toBe(0);
  });

  it('reaches a guest in a call by their seat, in what they’ve been given', async () => {
    const org = await account();
    const id = await workspace(org, 'Ours');
    const doc = await make(org, id, 'Doc');
    const { code: c } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(c, { mic: false, cam: false });
    await until(() => host.crypto.getSnapshot().status === 'in', 'the host in the call’s group');
    const b = h.browser();
    const guest = await b.api.calls.join(c, { mic: false, cam: false, name: 'Sam Guest' });
    const settle = async (pred: (s: CallState) => boolean) => { for (let i = 0; i < 200 && !pred(host.getSnapshot()); i++) { await host.refresh(); await rest(30); } return host.getSnapshot(); };
    await settle((s) => s.waiting.some((x) => x.id === guest.ticket.identity));
    await host.admit(guest.ticket.identity);
    const seat = (await settle((s) => s.participants.some((p) => p.id === guest.ticket.identity))).participants.find((p) => p.id === guest.ticket.identity)?.seat ?? '';
    const pass = { pass: host.ticket.pass };

    // Not yet: they aren't told, and they can't see it.
    await org.api.workspaces.mention(id, doc, { to: { seat }, block: 'l1' }, pass);
    expect(await count('SELECT count(*)::int AS n FROM workspace_mentions WHERE document_id = $1', [doc])).toBe(0);

    expect((await org.api.workspaces.share.list(id, doc, pass)).seats).toEqual([]);
    await org.api.workspaces.share.set(id, doc, [{ seat }], 'read', pass);
    // Who has it, from inside the call, for someone with no address to go by. From outside it, a seat means nothing.
    expect((await org.api.workspaces.share.list(id, doc, pass)).seats).toEqual([seat]);
    expect((await org.api.workspaces.share.list(id, doc)).seats).toEqual([]);
    const g = b.api.workspaces.live(id, { pass: guest.ticket.pass });
    await opened(g, 'the guest’s stream');
    await org.api.workspaces.mention(id, doc, { to: { seat }, block: 'l1' }, pass);
    await until(() => told(g).length === 1, 'the guest to hear');
    expect(told(g)[0]).toMatchObject({ document: doc, block: 'l1' });
    expect(await code(b.api.workspaces.mentionSeen(id, told(g)[0]?.id ?? '', { pass: guest.ticket.pass }))).toBe('allowed');
    expect(await count('SELECT count(*)::int AS n FROM workspace_mentions WHERE document_id = $1', [doc])).toBe(0);
    // Someone in the call can't be named from outside it.
    expect(await code(org.api.workspaces.mention(id, doc, { to: { seat }, block: null }))).toBe('invalid');
    expect(await code(org.api.workspaces.mention(id, doc, { to: { seat: 'nobody' }, block: null }, pass))).toBe('not-found');
    g.close();
  });

  it('reaches a guest in a call by their seat, in the workspace the call opens to everyone in it', async () => {
    const org = await account();
    const id = await workspace(org, 'Ours');
    const doc = await make(org, id, 'Doc');
    const secret = await make(org, id, 'Restricted');
    await org.api.workspaces.share.restrict(id, secret, true);
    const { code: c } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(c, { mic: false, cam: false });
    await until(() => host.crypto.getSnapshot().status === 'in', 'the host in the call’s group');
    const b = h.browser();
    const guest = await b.api.calls.join(c, { mic: false, cam: false, name: 'Sam Guest' });
    const settle = async (pred: (s: CallState) => boolean) => { for (let i = 0; i < 200 && !pred(host.getSnapshot()); i++) { await host.refresh(); await rest(30); } return host.getSnapshot(); };
    await settle((s) => s.waiting.some((x) => x.id === guest.ticket.identity));
    await host.admit(guest.ticket.identity);
    const seat = (await settle((s) => s.participants.some((p) => p.id === guest.ticket.identity))).participants.find((p) => p.id === guest.ticket.identity)?.seat ?? '';
    await host.setWorkspace(id);
    const pass = { pass: host.ticket.pass };
    const g = b.api.workspaces.live(id, { pass: guest.ticket.pass });
    await opened(g, 'the guest’s stream');
    // Nothing given to their seat: the call opens the document to them, so they're told, as anyone who can open it is.
    await org.api.workspaces.mention(id, doc, { to: { seat }, block: 'l1' }, pass);
    await until(() => told(g).length === 1, 'the guest to hear');
    expect(told(g)[0]).toMatchObject({ document: doc, block: 'l1' });
    // What the call doesn't open to them, they aren't told of.
    await org.api.workspaces.mention(id, secret, { to: { seat }, block: 'l1' }, pass);
    expect(await count('SELECT count(*)::int AS n FROM workspace_mentions WHERE document_id = $1', [secret])).toBe(0);
    g.close();
    await host.leave();
  });

  it('reaches someone signed in, by their seat, through what their address gives them, and after the call', async () => {
    const org = await account();
    const theo = await account();
    const id = await workspace(org, 'Ours', [[theo, 'edit']]);
    const doc = await make(org, id, 'Doc');
    const { code: c } = await org.api.calls.startNow({ notes: 'off', guests: [theo.email] });
    const host = await org.api.calls.join(c, { mic: false, cam: false });
    await until(() => host.crypto.getSnapshot().status === 'in', 'the host in the call’s group');
    const inCall = await theo.api.calls.join(c, { mic: false, cam: false });
    const settle = async (pred: (s: CallState) => boolean) => { for (let i = 0; i < 200 && !pred(host.getSnapshot()); i++) { await host.refresh(); await rest(30); } return host.getSnapshot(); };
    const seat = (await settle((s) => s.participants.some((p) => p.id === inCall.ticket.identity))).participants.find((p) => p.id === inCall.ticket.identity)?.seat ?? '';

    await org.api.workspaces.mention(id, doc, { to: { seat }, block: 'b1' }, { pass: host.ticket.pass });
    const waiting = await theo.api.workspaces.mentions();
    expect(waiting.map((m) => m.document)).toEqual([doc]);
  });

  it('leaves nothing readable behind it', async () => {
    const ann = await account(unique('canary-tagger'));
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'CANARY-MENTION-DOC');
    const notices: string[] = [];
    const listener = new pg.Client({ connectionString: h.deps.cfg.DATABASE_URL });
    await listener.connect();
    listener.on('notification', (m) => notices.push(m.payload ?? ''));
    await listener.query('LISTEN alcove_workspace');
    try {
      const from = h.logs.length;
      await tag(ann, id, doc, theo, 'CANARYBLOCK');
      await until(() => notices.some((n) => n.includes('told:')), 'the notice');
      const row = (await h.pool.query<{ t: string }>('SELECT row_to_json(x)::text AS t FROM workspace_mentions x WHERE document_id = $1', [doc])).rows[0]?.t ?? '';
      expect(row).not.toBe('');
      const encodings = (s: string) => [s, Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64').slice(0, 12), Buffer.from(s).toString('base64url').slice(0, 12)];
      for (const canary of [ann.name, 'canary-tagger', 'CANARYBLOCK', 'CANARY-MENTION-DOC', theo.email]) {
        for (const enc of encodings(canary)) {
          expect(row.includes(enc), `${canary} as ${enc} in the row`).toBe(false);
          expect(notices.join(' ').includes(enc), `${canary} as ${enc} in a notice`).toBe(false);
          expect(h.logs.slice(from).join('').includes(enc), `${canary} as ${enc} in a log`).toBe(false);
        }
      }
    } finally {
      await listener.end();
    }
  });
});

describe('a tag in a photo’s caption', () => {
  /** Attributes as y-prosemirror writes them: of any type, though Yjs's types say strings. */
  const setAttr = (el: Y.XmlElement, name: string, value: unknown) => { Reflect.apply(el.setAttribute, el, [name, value]); };
  /** Photos, as the editor writes a gallery: its pictures, and each one's caption, and who that tags, as attributes of their own. */
  async function gallery(who: Account, id: string, doc: string, attrs: Record<string, unknown>) {
    const s = await who.api.workspaces.document(id, doc);
    await s.ready;
    const el = new Y.XmlElement('gallery');
    for (const [k, v] of Object.entries({ id: 'ga', items: [{ media: 'mediaOne', name: 'harbour.png' }, { media: 'mediaTwo', name: 'dock.png' }], ...attrs })) setAttr(el, k, v);
    const fragment = s.doc.getXmlFragment('content');
    fragment.insert(fragment.length, [el]);
    await until(() => s.getSnapshot().status === 'saved', 'the photos to reach Alcove');
    s.close();
  }
  /** What the server reads the document as saying, as search and the notes read it. */
  async function said(who: Account, id: string, doc: string) {
    const w = await workspaceFor(h.deps, { email: who.email, principals: [blindIndex(masterKey(h.deps), 'email', who.email)], calls: [] }, id);
    const read = new Y.Doc();
    Y.applyUpdate(read, await readDocument(w, doc, 'state', {}));
    return { blocks: documentText(read, 'document').blocks, gallery: read.getXmlFragment('content').toArray().find((el): el is Y.XmlElement => el instanceof Y.XmlElement && el.getAttribute('id') === 'ga') };
  }

  it('reaches whoever’s tagged as a tag in a line does, and a caption from before tags reads as it always did', async () => {
    const priya = await account();
    const art = await account();
    const id = await workspace(priya, 'Product', [[art, 'edit']]);
    const plan = await make(priya, id, 'Launch plan');
    // One caption from before tags, plain words, and one that tags Art: its words say @Art, and who that is is kept beside them.
    await gallery(priya, id, plan, { 'cap:mediaOne': 'Felixstowe at dawn', 'cap:mediaTwo': `@${art.name.split(' ')[0] ?? art.name} at the dock`, 'tags:mediaTwo': [{ id: 'art-in-workspace', name: art.name }] });
    const a = art.api.workspaces.live(id);
    await opened(a, 'Art’s stream');
    await tag(priya, id, plan, art, 'ga');
    await until(() => told(a).length === 1, 'Art to hear of the caption');
    expect(told(a)[0]).toMatchObject({ document: plan, block: 'ga', by: { name: priya.name, email: '' } });
    a.close();
    // The server reads both captions as words: the old one exactly as before, and the tag as the words it is.
    const { blocks, gallery: el } = await said(priya, id, plan);
    expect(blocks.find((b) => b.id === 'ga')).toEqual({ id: 'ga', type: 'gallery', text: `Felixstowe at dawn @${art.name.split(' ')[0] ?? art.name} at the dock` });
    expect(el?.getAttribute('cap:mediaOne')).toBe('Felixstowe at dawn');
    expect(el?.getAttribute('tags:mediaOne')).toBeUndefined();
    // Nothing of who's tagged, or what the caption says, is in a row: not the document's, and not the tag waiting for Art.
    expect(await count('SELECT count(*)::int AS n FROM workspace_mentions WHERE document_id = $1', [plan])).toBe(1);
    const rows = JSON.stringify([...(await h.pool.query('SELECT * FROM document_updates WHERE document_id = $1', [plan])).rows, ...(await h.pool.query('SELECT * FROM workspace_mentions WHERE document_id = $1', [plan])).rows]);
    for (const words of ['Felixstowe', 'at the dock', 'art-in-workspace']) expect(rows.includes(words), words).toBe(false);
  });

  it('follows the same access rules: nobody who can’t open the document is told, and nobody outside it can tag in it', async () => {
    const priya = await account();
    const art = await account();
    const kofi = await account();
    const lena = await account();
    const id = await workspace(priya, 'Product', [[art, 'edit']]);
    const theirs = await workspace(lena, 'Theirs', [[art, 'edit']]);
    const plan = await make(priya, id, 'Launch plan');
    const lenas = await make(lena, theirs, 'Their plan');
    await gallery(priya, id, plan, { 'cap:mediaOne': '@Kofi on the quay', 'tags:mediaOne': [{ id: 'kofi', name: kofi.name }] });
    // Kofi isn't in the workspace: the tag is taken, and he hears nothing, now or later, and nobody can tell.
    expect(await code(tag(priya, id, plan, kofi, 'ga'))).toBe('allowed');
    expect(await kofi.api.workspaces.mentions()).toEqual([]);
    // Restricted from Art, a caption tag doesn't reach him either, until it's shared with him.
    await priya.api.workspaces.share.restrict(id, plan, true);
    expect(await code(tag(priya, id, plan, art, 'ga'))).toBe('allowed');
    expect(await art.api.workspaces.mentions()).toEqual([]);
    await priya.api.workspaces.share.set(id, plan, [{ email: art.email }], 'read');
    await tag(priya, id, plan, art, 'ga');
    expect((await art.api.workspaces.mentions()).map((m) => [m.document, m.block])).toEqual([[plan, 'ga']]);
    // Across owners: Lena can't tag anyone in Priya's document, nor reach it through her own workspace's ID, nor Priya hers.
    expect(await code(tag(lena, id, plan, art, 'ga'))).toBe('not-found');
    expect(await code(tag(lena, theirs, plan, art, 'ga'))).toBe('not-found');
    expect(await code(tag(priya, theirs, lenas, art, 'ga'))).toBe('not-found');
    expect(await code(tag(priya, id, lenas, art, 'ga'))).toBe('not-found');
    // Art can read it, so he can't tag anyone in it: tagging is for whoever can edit.
    expect(await code(tag(art, id, plan, priya, 'ga'))).not.toBe('allowed');
    expect((await art.api.workspaces.mentions()).map((m) => m.document)).toEqual([plan]);
  });
});

describe('who can open a document, for whoever’s tagging', () => {
  it('says who can, by the same rule that decides it', async () => {
    const ann = await account();
    const theo = await account();
    const zoe = await account();
    const out = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit'], [zoe, 'read']]);
    const doc = await make(ann, id, 'Doc');
    const open = async () => (await ann.api.workspaces.share.list(id, doc)).canOpen.sort();
    expect(await open()).toEqual([ann.email, theo.email, zoe.email].sort());
    await ann.api.workspaces.share.set(id, doc, [{ email: out.email }], 'read');
    expect(await open()).toEqual([ann.email, theo.email, zoe.email, out.email].sort());
    // Restricted: its creator, and who it's shared with. Nobody else in the workspace.
    await ann.api.workspaces.share.restrict(id, doc, true);
    expect(await open()).toEqual([ann.email, out.email].sort());
    await ann.api.workspaces.share.set(id, doc, [{ email: zoe.email }], 'edit');
    expect(await open()).toEqual([ann.email, out.email, zoe.email].sort());
    // Someone who restricts what they didn't make keeps it, and says so here.
    const made = await make(theo, id, 'Theo’s');
    await ann.api.workspaces.share.restrict(id, made, true);
    expect((await ann.api.workspaces.share.list(id, made)).canOpen.sort()).toEqual([ann.email, theo.email].sort());
  });

  it('knows people by one ID: on their caret, in who’s here, in a tag and in the workspace’s people', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const a = ann.api.workspaces.live(id);
    const t = theo.api.workspaces.live(id);
    await until(() => of(a, theo) !== undefined && of(t, ann) !== undefined, 'both to be here');
    const people = await ann.api.workspaces.people(id);
    expect(people.find((p) => p.person.email === theo.email)?.person.id).toBe(of(a, theo)?.person.id);
    expect(people.find((p) => p.person.email === ann.email)?.person.id).toBe(of(t, ann)?.person.id);
    // It's an ID: nothing of who they are, unlike the address the same person goes by anywhere else.
    expect(people.map((p) => p.person.id).join()).not.toContain('@');
    a.close();
    t.close();
  });
});

describe('where people are', () => {
  it('never names a document to someone who can’t open it, however it’s reached: a follower only ever sees that it’s somewhere else', async () => {
    const priya = await account();
    const art = await account();
    const id = await workspace(priya, 'Product', [[art, 'edit']]);
    const plan = await make(priya, id, 'Launch plan');
    const secret = await make(priya, id, 'CANARY-SECRET-DOC');
    await priya.api.workspaces.share.restrict(id, secret, true);
    const p = priya.api.workspaces.live(id);
    const a = art.api.workspaces.live(id);
    await opened(a, 'Art’s stream');
    const frames: string[] = [];
    const stop = a.subscribe(() => frames.push(JSON.stringify(a.getSnapshot())));

    // Going where they go: the same document, the same line.
    p.present({ document: plan, block: 'p11', typing: true, page: null });
    await until(() => of(a, priya)?.block === 'p11', 'Art to see Priya’s line');
    expect(of(a, priya)).toMatchObject({ document: plan, typing: true, elsewhere: false });

    // Somewhere Art can't open: no document, no line, no typing, and only that it's elsewhere.
    p.present({ document: secret, block: 'canaryblock', typing: true, page: null });
    await until(() => of(a, priya)?.elsewhere === true, 'Art to see Priya elsewhere');
    expect(of(a, priya)).toMatchObject({ document: null, block: null, typing: false, elsewhere: true });

    // And back: as if nothing happened.
    p.present({ document: plan, block: 'p12', typing: false, page: null });
    await until(() => of(a, priya)?.document === plan, 'Priya to come back');
    expect(of(a, priya)).toMatchObject({ block: 'p12', elsewhere: false });

    // Nothing that crossed the wire on the way said which document, or what's in it.
    stop();
    for (const frame of frames) {
      expect(frame).not.toContain(secret);
      expect(frame).not.toContain('canaryblock');
      expect(frame).not.toContain('CANARY-SECRET-DOC');
    }
    // Saying you're in something you can't open is refused, and says nothing of it.
    const said = await art.fetch(`${h.baseUrl}/v1/workspaces/${id}/presence`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ connection: madeUp(), document: secret, block: null, typing: false, page: null }) });
    expect(said.status).toBe(404);
    p.close();
    a.close();
  });

  it('stops naming a document the moment someone can’t open it any more, and catches up when they can', async () => {
    const priya = await account();
    const art = await account();
    const id = await workspace(priya, 'Product', [[art, 'edit']]);
    const doc = await make(priya, id, 'Launch plan');
    const p = priya.api.workspaces.live(id);
    const a = art.api.workspaces.live(id);
    p.present({ document: doc, block: 'b1', typing: false, page: null });
    await until(() => of(a, priya)?.document === doc, 'Art to see Priya');

    await priya.api.workspaces.share.restrict(id, doc, true);
    await until(() => of(a, priya)?.elsewhere === true, 'Art to lose the document');
    expect(of(a, priya)).toMatchObject({ document: null, block: null });

    await priya.api.workspaces.share.restrict(id, doc, false);
    await until(() => of(a, priya)?.document === doc, 'Art to have it back');
    p.close();
    a.close();
  });

  it('puts whoever moved last at the end, so of someone’s windows the one in use can be told from one left open', async () => {
    const ann = await account();
    const theo = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const left = await make(ann, id, 'Left open');
    const using = await make(ann, id, 'In use');
    const a = ann.api.workspaces.live(id);
    const one = theo.api.workspaces.live(id);
    const two = theo.api.workspaces.live(id);
    await opened(one, 'one window');
    await opened(two, 'another window');
    const theirs = () => here(a).filter((x) => x.person.name === theo.name);
    one.present({ document: left, block: 'b1', typing: false, page: null });
    two.present({ document: using, block: 'b2', typing: false, page: null });
    await until(() => theirs().length === 2 && theirs().every((x) => x.document !== null), 'both windows');
    one.present({ document: left, block: 'b3', typing: false, page: null });
    await until(() => theirs().at(-1)?.block === 'b3', 'the window that moved to come last');
    two.present({ document: using, block: 'b4', typing: false, page: null });
    await until(() => theirs().at(-1)?.block === 'b4', 'the other to come last');
    // Saying the same thing again isn't moving: every window does that every few seconds.
    await rest(250);
    expect(theirs().at(-1)?.block).toBe('b4');
    for (const s of [a, one, two]) s.close();
  });

  it('stops for someone whose access is taken away: they’re gone for everyone, and can’t come back by saying so', async () => {
    const ann = await account();
    const theo = await account();
    const out = await account();
    const id = await workspace(ann, 'Ours', [[theo, 'edit']]);
    const doc = await make(ann, id, 'Doc');
    await ann.api.workspaces.share.set(id, doc, [{ email: out.email }], 'edit');
    const a = ann.api.workspaces.live(id);
    const t = theo.api.workspaces.live(id);
    const o = out.api.workspaces.live(id);
    t.present({ document: doc, block: 'b1', typing: true, page: null });
    o.present({ document: doc, block: 'b2', typing: false, page: null });
    await until(() => of(a, theo)?.document === doc && of(a, out)?.document === doc, 'both to be in the document');

    // A shared document taken back: they've nothing left here, so they're not here.
    const entry = (await ann.api.workspaces.share.list(id, doc)).entries.find((e) => e.person.email === out.email);
    await ann.api.workspaces.share.remove(id, doc, entry?.id ?? '');
    await until(() => of(a, out) === undefined, 'the outsider to go');
    await until(() => o.getSnapshot().status === 'closed', 'their stream to end');
    expect(o.getSnapshot()).toMatchObject({ tree: null, here: [], mentions: [] });

    // Taken out of the workspace.
    const person = (await ann.api.workspaces.people(id)).find((p) => p.person.email === theo.email);
    await ann.api.workspaces.removePerson(id, person?.id ?? '');
    await until(() => of(a, theo) === undefined, 'Theo to go');
    await until(() => t.getSnapshot().status === 'closed', 'Theo’s stream to end');
    const again = await theo.fetch(`${h.baseUrl}/v1/workspaces/${id}/presence`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ connection: madeUp(), document: doc, block: 'b1', typing: true, page: null }) });
    expect(again.status).toBe(404);
    await rest(300);
    expect(of(a, theo)).toBeUndefined();
    a.close();
  });
});
