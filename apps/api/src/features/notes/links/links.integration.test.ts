/**
 * Links to a call's notes (docs: Privacy, keys and sessions › Who can read a note), end to end through the real API over
 * HTTP via @alcove/api-http, real Postgres and the fake Google and NEAR AI: anyone with the notes makes one once the call
 * has ended; looked at first, it says until when it works and opens nothing; it gives the notes to whoever opens it signed
 * in, to keep, as shared by its maker, and to nobody without an account; it stops when it's revoked, runs out or its maker
 * no longer has the notes, and whoever it gave them to keeps them after that; it's refused across accounts; and it goes with
 * the note and with its maker's account. Only the secret's hash is stored, and the secret never reaches a row or a log.
 */
import { randomUUID, createHash } from 'node:crypto';
import { AlcoveApiError, NOTE_LINK_DAYS, type TranscriptClip } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { maintain } from '../../../maintenance';
import { speechWav } from '../../../testing/fakes/near';
import { type GoogleUser } from '../../../testing/fakes/google';
import { ORIGIN, startHarness, type Browser, type Harness } from '../../../testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
afterEach(() => { h.closeCalls(); });

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const fails = (p: Promise<unknown>) => p.then(() => 'succeeded', (e: unknown) => code(e));
const unique = (who: string) => `${who}.${randomUUID()}@tests.example`;
async function account(email = unique('person')) {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email });
  return { ...b, session, email };
}
type Account = Awaited<ReturnType<typeof account>>;
/** Signs in with Google, as a real account is: a demo account's notes are open to demo accounts alone. */
async function googleAccount() {
  const b = h.browser();
  const who: GoogleUser = { sub: `links-${randomUUID()}`, email: `real.${randomUUID()}@tests.example`, name: 'Ines Moreau' };
  h.google.next(who);
  let next = new URL(b.api.auth.signInUrl('google'));
  for (let i = 0; i < 8 && next.origin !== ORIGIN; i++) {
    const res = await (next.origin === h.google.issuer ? fetch(next, { redirect: 'manual' }) : b.fetch(next, { redirect: 'manual' }));
    const location = res.headers.get('location');
    if (!location) throw new Error(`Sign-in stopped at ${res.status}`);
    next = new URL(location, next);
  }
  const session = await b.api.auth.getSession();
  if (!session) throw new Error('Not signed in with Google.');
  return { ...b, session, email: who.email };
}
const speech = (text: string): TranscriptClip => ({ data: new Blob([speechWav(text, 4000)], { type: 'audio/wav' }), segment: 0, at: 0, durationMs: 4000 });
/** A call with notes, ended and written, with `guests` invited to it. */
async function writtenCall(org: Browser, guests: string[] = []) {
  const call = await org.api.calls.join((await org.api.calls.startNow({ title: `Pricing ${randomUUID()}`, notes: 'on', guests })).code, { mic: true, cam: false });
  await call.transcribe(speech('We agreed the team plan gets a monthly option.'), call.ticket.identity);
  const noteId = call.getSnapshot().notes.noteId ?? '';
  expect(noteId).not.toBe('');
  await call.leave();
  for await (const p of org.api.notes.progress(noteId)) if (p.ready) break;
  return noteId;
}
const linkRows = async (noteId: string) => Number((await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM note_links WHERE note_item_id = $1', [noteId])).rows[0]?.n ?? -1);
const recipientOf = async (b: Account, noteId: string, email: string) => (await b.api.notes.get(noteId)).recipients.find((r) => r.person.email === email);

describe('links to a call’s notes', () => {
  it('gives the notes to whoever opens the link signed in, as shared by whoever made it, and to nobody without an account', async () => {
    const org = await account(unique('organizer'));
    const noteId = await writtenCall(org);
    const made = await org.api.notes.createLink(noteId);
    expect(made.secret).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(made.link).toMatchObject({ by: { email: org.email }, revocable: true });
    const days = (Date.parse(made.link.expiresAt) - Date.parse(made.link.at)) / 86_400_000;
    expect(days).toBeCloseTo(NOTE_LINK_DAYS, 3);
    expect((await org.api.notes.links(noteId)).map((l) => l.id)).toEqual([made.link.id]);
    // Only its hash is kept: the secret is in no row.
    const stored = await h.pool.query<{ secret_hash: Buffer }>('SELECT secret_hash FROM note_links WHERE link_id = $1', [made.link.id]);
    expect(stored.rows[0]?.secret_hash.equals(createHash('sha256').update(made.secret).digest())).toBe(true);
    const everything = String((await h.pool.query(`SELECT string_agg(row_to_json(x)::text, ' ') AS all FROM note_links x`)).rows[0]?.all ?? '');
    for (const enc of [made.secret, Buffer.from(made.secret).toString('hex')]) expect(everything.includes(enc)).toBe(false);

    // The link alone reads nothing: without an account it opens no notes, and says nothing of itself.
    expect(await fails(h.browser().api.notes.claimLink(made.secret))).toBe('unauthenticated');
    expect(await fails(h.browser().api.notes.peekLink(made.secret))).toBe('unauthenticated');
    const reader = await account(unique('reader'));
    expect(await fails(reader.api.notes.get(noteId))).toBe('not-found');
    // Looked at before it's opened, it says until when it works, and nothing more: the notes aren't the reader's yet.
    expect(await reader.api.notes.peekLink(made.secret)).toEqual({ expiresAt: made.link.expiresAt });
    expect(await fails(reader.api.notes.get(noteId))).toBe('not-found');
    expect((await org.api.notes.get(noteId)).recipients.map((r) => r.person.email)).toEqual([org.email]);
    expect(await reader.api.notes.claimLink(made.secret)).toEqual({ noteId });
    expect((await reader.api.notes.get(noteId)).received).toMatchObject({ role: 'shared', by: { email: org.email }, link: true });
    expect(await recipientOf(org, noteId, reader.email)).toMatchObject({ role: 'shared', by: { email: org.email }, link: true });
    expect((await reader.api.notes.list()).map((n) => n.id)).toContain(noteId);
    // Opening it again, or as the organizer, gives nothing more.
    const people = (await org.api.notes.get(noteId)).recipients.length;
    expect(await reader.api.notes.claimLink(made.secret)).toEqual({ noteId });
    expect(await org.api.notes.claimLink(made.secret)).toEqual({ noteId });
    expect((await org.api.notes.get(noteId)).recipients).toHaveLength(people);
    // A secret that was never made opens nothing, said as for one that ran out; one that isn't a secret at all is refused.
    expect(await fails(reader.api.notes.claimLink('AAAAAAAAAAAAAAAAAAAAAA'))).toBe('not-found');
    expect(await fails(reader.api.notes.peekLink('AAAAAAAAAAAAAAAAAAAAAA'))).toBe('not-found');
    expect(await fails(reader.api.notes.claimLink('not a secret'))).toBe('invalid');
    expect(await fails(reader.api.notes.peekLink('not a secret'))).toBe('invalid');
    // Neither keeps a receipt, which would hold a copy of what it answered.
    expect((await h.pool.query("SELECT count(*)::int AS n FROM operations WHERE method LIKE '%note-links%'")).rows[0]).toEqual({ n: 0 });
    // Nothing of the secret reaches a log line.
    expect(h.logs.join('').includes(made.secret)).toBe(false);
  });

  it('can be made by anyone with the notes, and stops when revoked, when it runs out, and when its maker no longer has them', async () => {
    const kofi = await account(unique('kofi'));
    const org = await account(unique('organizer'));
    const noteId = await writtenCall(org, [kofi.email]);
    const kofis = await kofi.api.notes.createLink(noteId);
    expect((await org.api.notes.links(noteId)).find((l) => l.id === kofis.link.id)).toMatchObject({ by: { email: kofi.email }, revocable: true });
    const lena = await account(unique('lena'));
    await lena.api.notes.claimLink(kofis.secret);
    expect((await lena.api.notes.get(noteId)).received).toMatchObject({ role: 'shared', by: { email: kofi.email }, link: true });

    // Revoked: by its maker or the organizer, and nobody else. Whoever it gave the notes to keeps them.
    expect(await fails(lena.api.notes.revokeLink(noteId, kofis.link.id))).toBe('forbidden');
    expect(await kofi.api.notes.revokeLink(noteId, kofis.link.id)).toEqual([]);
    expect(await linkRows(noteId)).toBe(0);
    const sam = await account(unique('sam'));
    expect(await fails(sam.api.notes.claimLink(kofis.secret))).toBe('not-found');
    expect(await fails(sam.api.notes.peekLink(kofis.secret))).toBe('not-found');
    expect((await lena.api.notes.get(noteId)).received?.link).toBe(true);
    const another = await kofi.api.notes.createLink(noteId);
    expect(await org.api.notes.revokeLink(noteId, another.link.id)).toEqual([]);

    // Run out: it opens nothing, isn't listed, and upkeep deletes it. Whoever opened it before keeps the notes: the link ran
    // out, not what it gave.
    const old = await kofi.api.notes.createLink(noteId);
    const dee = await account(unique('dee'));
    await dee.api.notes.claimLink(old.secret);
    await h.pool.query("UPDATE note_links SET expires_at = now() - interval '1 second' WHERE link_id = $1", [old.link.id]);
    expect(await fails(sam.api.notes.claimLink(old.secret))).toBe('not-found');
    expect(await fails(sam.api.notes.peekLink(old.secret))).toBe('not-found');
    expect(await kofi.api.notes.links(noteId)).toEqual([]);
    await maintain(h.deps);
    expect(await linkRows(noteId)).toBe(0);
    expect((await dee.api.notes.get(noteId)).received).toMatchObject({ role: 'shared', by: { email: kofi.email }, link: true });
    expect((await dee.api.notes.list()).map((n) => n.id)).toContain(noteId);

    // Its maker removes the notes from theirs: their links go with them, and would open nothing anyway.
    const last = await kofi.api.notes.createLink(noteId);
    await kofi.api.notes.delete(noteId);
    expect(await linkRows(noteId)).toBe(0);
    expect(await fails(sam.api.notes.claimLink(last.secret))).toBe('not-found');
    expect(await fails(sam.api.notes.get(noteId))).toBe('not-found');
  });

  it('is refused for notes you don’t have, across accounts, while the call is on, and from a demo account to a real organizer', async () => {
    const org = await account(unique('organizer'));
    const noteId = await writtenCall(org);
    const made = await org.api.notes.createLink(noteId);
    const stranger = await account(unique('stranger'));
    expect(await fails(stranger.api.notes.links(noteId))).toBe('not-found');
    expect(await fails(stranger.api.notes.createLink(noteId))).toBe('not-found');
    expect(await fails(stranger.api.notes.revokeLink(noteId, made.link.id))).toBe('not-found');
    // Another account's link, by its ID, on notes you do have: not there to find, and still working.
    const otherNote = await writtenCall(stranger);
    expect(await fails(stranger.api.notes.revokeLink(otherNote, made.link.id))).toBe('not-found');
    expect(await linkRows(noteId)).toBe(1);
    // While the call is on, who gets its notes isn't settled: no link yet.
    const live = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    await live.transcribe(speech('Still talking.'), live.ticket.identity);
    expect(await fails(org.api.notes.createLink(live.getSnapshot().notes.noteId ?? ''))).toBe('invalid');
    await live.leave();

    // A real organizer's notes never go to a demo account, which anyone can sign in as; a real account gets them.
    const real = await googleAccount();
    const realNote = await writtenCall(real);
    const realLink = await real.api.notes.createLink(realNote);
    expect(await fails(stranger.api.notes.claimLink(realLink.secret))).toBe('forbidden');
    expect(await fails(stranger.api.notes.get(realNote))).toBe('not-found');
    const alsoReal = await googleAccount();
    expect(await alsoReal.api.notes.claimLink(realLink.secret)).toEqual({ noteId: realNote });
  });

  it('goes with the note, and with its maker’s account', async () => {
    const kofi = await account(unique('kofi'));
    const org = await account(unique('organizer'));
    const noteId = await writtenCall(org, [kofi.email]);
    const mine = await org.api.notes.createLink(noteId);
    const kofis = await kofi.api.notes.createLink(noteId);
    expect(await linkRows(noteId)).toBe(2);
    // Deleting the maker's account takes the links it made, whatever else stays.
    await kofi.api.account.delete();
    expect((await org.api.notes.links(noteId)).map((l) => l.id)).toEqual([mine.link.id]);
    const sam = await account(unique('sam'));
    expect(await fails(sam.api.notes.claimLink(kofis.secret))).toBe('not-found');
    // Deleting the note deletes every link to it, physically.
    await org.api.notes.delete(noteId);
    expect(await linkRows(noteId)).toBe(0);
    expect(await fails(sam.api.notes.claimLink(mine.secret))).toBe('not-found');
  });
});
