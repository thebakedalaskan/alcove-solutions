/**
 * Where a call's things are and which series it's in, as its note says to each person reading it, through browsers talking to
 * the real API over HTTP via @alcove/api-http, on real Postgres, the local LiveKit server and the stand-in NEAR AI: the call's
 * home and its folder for whoever is in that workspace, and nothing of it for anyone else; and the series, in the list and the
 * note, worked out on each read, so a call that starts a series later is in it from then on.
 */
import { AlcoveApiError, type CallSession, type Note, type TranscriptClip } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { speechWav } from '../../testing/fakes/near';
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
async function until(ok: () => boolean | Promise<boolean>, what: string, ms = 30_000): Promise<void> {
  const by = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await rest(40);
  }
}
const inGroup = (call: CallSession) => until(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
const speech = (words: string, segment: number, atMs: number, ms = 4000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment, at: atMs / 1000, durationMs: ms });
const noteOf = async (who: Account, noteId: string): Promise<Note> => {
  let n = await who.api.notes.get(noteId);
  await until(async () => { n = await who.api.notes.get(noteId); return n.status === 'ready'; }, 'the notes');
  return n;
};
/** A call by `org` with notes on, one thing said in it, ended: its note, and the meeting it was. */
async function heldCall(org: Account, o: { guests: string[]; workspaceId?: string | undefined; title: string }) {
  const m = await org.api.meetings.create({ title: o.title, startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: o.guests, notes: 'on', ...(o.workspaceId ? { workspaceId: o.workspaceId } : {}) });
  const host = await org.api.calls.join(m.code, { mic: false, cam: false });
  await inGroup(host);
  await host.openWorkspace();
  await host.transcribe(speech('We agreed the launch list goes to Kofi.', 0, 0), host.ticket.identity);
  const ended = await host.leave();
  const noteId = ended?.pendingNoteId ?? '';
  await noteOf(org, noteId);
  return { meetingId: m.id, noteId };
}

describe('where a call’s things are, on its note', () => {
  it('is its home and its folder for whoever is in that workspace: the organizer and everyone invited, and nobody given the notes afterwards', async () => {
    const ann = await account();
    const kofi = await account();
    const lena = await account();
    const { meetingId, noteId } = await heldCall(ann, { guests: [kofi.email], title: 'CANARY-HOMETITLE Launch check-in' });
    const workspaceId = (await ann.api.meetings.get(meetingId)).workspaceId ?? '';
    expect(workspaceId).not.toBe('');
    // The folder this run of the call made, which its note goes to.
    let folderId = '';
    await until(async () => {
      folderId = (await ann.api.workspaces.get(workspaceId)).items.find((x) => x.call?.noteId === noteId)?.id ?? '';
      return folderId !== '';
    }, 'the folder to read the note');

    expect((await ann.api.notes.get(noteId)).home).toEqual({ workspaceId, folderId });
    // Kofi was invited: the home made for the call let him in, so it opens for him too.
    expect((await noteOf(kofi, noteId)).home).toEqual({ workspaceId, folderId });

    // Lena gets the notes afterwards, and isn't in the workspace: her note says nothing of it.
    await ann.api.notes.share(noteId, { emails: [lena.email] });
    expect((await lena.api.notes.get(noteId)).home).toBeNull();
    expect(await code(lena.api.workspaces.get(workspaceId))).toBe('not-found');

    // Once the folder's gone, the home's still there, with no folder in it for this call.
    await ann.api.workspaces.items.trash(workspaceId, folderId);
    expect((await ann.api.notes.get(noteId)).home).toEqual({ workspaceId, folderId: null });
    // And nobody's told anything that reaches a log.
    expect(h.logs.join('\n')).not.toContain('CANARY-HOMETITLE');
  });

  it('is nothing for someone invited who isn’t in the workspace its organizer chose, which keeps its own people', async () => {
    const ann = await account();
    const kofi = await account();
    const { id: product } = await ann.api.workspaces.create('Product');
    const { noteId } = await heldCall(ann, { guests: [kofi.email], workspaceId: product, title: 'Pricing sync' });
    await until(async () => (await ann.api.notes.get(noteId)).home?.folderId !== null, 'the folder in Product');
    expect((await ann.api.notes.get(noteId)).home).toMatchObject({ workspaceId: product, folderId: expect.any(String) });
    expect((await noteOf(kofi, noteId)).home).toBeNull();
    // Put in the workspace, he finds it on his next read.
    await ann.api.workspaces.addPerson(product, kofi.email, 'read');
    expect((await kofi.api.notes.get(noteId)).home).toMatchObject({ workspaceId: product });
  });
});

describe('the series a call is in, on its note and in the list', () => {
  it('is worked out on each read, for the organizer and everyone invited, once a call starts one', async () => {
    const ann = await account();
    const kofi = await account();
    const { meetingId, noteId } = await heldCall(ann, { guests: [kofi.email], title: 'Team standup' });
    const listed = async (who: Account) => (await who.api.notes.list()).find((n) => n.id === noteId);
    expect((await listed(ann))?.seriesId).toBeUndefined();
    expect((await ann.api.notes.get(noteId)).seriesId).toBeUndefined();

    // Schedule next week's call: the two are a series now, and the note that was already there is in it.
    const next = await ann.api.meetings.scheduleNext(meetingId, new Date(Date.now() + 7 * 86_400_000).toISOString());
    const seriesId = next.seriesId ?? '';
    expect(seriesId).not.toBe('');
    expect((await listed(ann))?.seriesId).toBe(seriesId);
    expect((await ann.api.notes.get(noteId)).seriesId).toBe(seriesId);
    await noteOf(kofi, noteId);
    expect((await listed(kofi))?.seriesId).toBe(seriesId);
    expect((await kofi.api.notes.get(noteId)).seriesId).toBe(seriesId);
    // Searching finds it with its series too, as the Calls page lists it.
    expect((await ann.api.notes.list({ text: 'launch' })).find((n) => n.id === noteId)?.seriesId).toBe(seriesId);
  });
});
