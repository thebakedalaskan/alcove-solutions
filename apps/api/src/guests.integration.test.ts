/**
 * Joining a call by its link without being invited: what the link tells anyone before they join; signed-in people the
 * organizer lets in (added to the invite, so they get the notes, but only from accounts the notes may go to, only when
 * the organizer saw who, and only as long as they're let in) next to guests (who don't); how every refusal fails
 * safely with a request ID; and what a guest's call pass can reach (its own call, nothing else). The real API over
 * HTTP via @alcove/api-http, real Postgres, the object store and the local LiveKit server.
 */
import { AlcoveApiError, type AlcoveApi, type CallSession, type CallState, type TranscriptClip } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { speechWav } from './testing/fake-near';
import { ORIGIN, startHarness, type Harness } from './testing/harness';
import { disposeLiveKit } from './testing/livekit';

// Calls go through the real LiveKit server; every wait below is bounded and says what it was waiting for.
vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(() => { vi.useRealTimers(); h.closeCalls(); });

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
/** A fresh demo account: single sign-on signs in whoever's work email is typed, unchecked. */
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
/** A real account, signed in with (the stand-in) Google, which checks who it is. */
async function googleAccount(name: string) {
  const b = h.browser();
  const n = `${Date.now().toString(36)}${(seq++).toString(36)}`;
  h.google.next({ sub: `google-${n}`, email: `${name.toLowerCase()}.${n}@example.com`, name });
  let url = new URL(`${h.baseUrl}/v1/auth/google`);
  for (let hop = 0; hop < 10 && url.origin !== new URL(ORIGIN).origin; hop++) {
    const res = url.origin === h.google.issuer ? await fetch(url, { redirect: 'manual' }) : await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  const session = await b.api.auth.getSession();
  if (!session) throw new Error('not signed in with Google');
  return { ...b, session };
}
const guestBrowser = () => h.browser().api;
async function waitFor(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 100 && !pred(call.getSnapshot()); i++) { await call.refresh(); await new Promise((r) => setTimeout(r, 30)); }
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await inGroup(who);
}
/** A clip of speech, starting `atMs` milliseconds into its segment. */
const speech = (words: string, segment: number, atMs: number, ms = 4000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment, at: atMs / 1000, durationMs: ms });
/** Every progress step of a note until it's written. */
async function written(api: AlcoveApi, noteId: string) { for await (const p of api.notes.progress(noteId)) if (p.ready) return; }
/** The log lines written while handling one request. */
const linesOf = (requestId: string) => h.logs.filter((l) => l.includes(requestId));
/** Who's on a meeting's invite, as its organizer sees it. */
const invite = async (api: AlcoveApi, meetingId: string) => (await api.meetings.get(meetingId)).guests.map((g) => g.email).sort();

describe('the call’s link, before joining', () => {
  it('says what the call captures and whether it has ended, where someone signed in stands, and how to sign in for the notes', async () => {
    const org = await account();
    const invitedEmail = unique('invited');
    const { code: c } = await org.api.calls.startNow({ notes: 'off', guests: [invitedEmail] });
    const anyone = guestBrowser();
    const invited = await account(invitedEmail);
    const stranger = await account();
    expect(await anyone.calls.card(c)).toEqual({
      title: expect.any(String), organizerName: org.session.user.name, startsAt: expect.any(String), hostHere: false, standIn: null, locked: false, notes: 'off', capture: null, ended: false,
      choices: { keepTranscript: true, keepRecording: true, readScreens: false }, joinMuted: false, offer: null, you: 'guest', signInForNotes: ['google', 'microsoft', 'sso']
    });
    expect((await invited.api.calls.card(c)).you).toBe('invited');
    // The organizer signed in with a demo stand-in, so another demo account may have the notes when let in.
    expect((await stranger.api.calls.card(c)).you).toBe('asks');
    expect((await org.api.calls.card(c)).you).toBe('invited');
    // A call scheduled with notes says so before anyone has joined.
    const scheduled = await org.api.meetings.create({ title: 'Planning', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on' });
    expect(await anyone.calls.card(scheduled.code)).toMatchObject({ notes: 'on', startsAt: scheduled.startsAt });

    // Once the call is on, what it captures is the call's own: the organizer turning notes on shows before anyone asks.
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    expect(await anyone.calls.card(c)).toMatchObject({ hostHere: true, ended: false, capture: { mode: 'off' } });
    await host.setNotes(true);
    expect((await anyone.calls.card(c)).capture?.mode).toBe('on');

    await host.leave();
    expect(await anyone.calls.card(c)).toMatchObject({ hostHere: false, ended: true, capture: null });
    // Over: nobody but the organizer can start it again, and the link says so rather than "waiting for the host".
    for (const attempt of [() => anyone.calls.join(c, { mic: true, cam: false, name: 'Sam' }), () => invited.api.calls.join(c, { mic: true, cam: false })]) {
      const e = await attempt().catch((x: unknown) => x);
      expect([code(e), e instanceof Error ? e.message : '']).toEqual(['conflict', 'This call has ended.']);
    }
    const again = await org.api.calls.join(c, { mic: true, cam: false });
    expect(await anyone.calls.card(c)).toMatchObject({ hostHere: true, ended: false });
    await again.leave();
  });

  it('keeps a real organizer’s notes from demo sign-ins: they ask by name, and only Google accounts get the notes', async () => {
    const org = await googleAccount('Rosa');
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    expect((await guestBrowser().calls.card(c)).signInForNotes).toEqual(['google']);
    const demo = await account();
    const art = h.browser();
    await art.api.auth.signIn('microsoft');
    const googler = await googleAccount('Ines');
    expect([(await demo.api.calls.card(c)).you, (await art.api.calls.card(c)).you, (await googler.api.calls.card(c)).you]).toEqual(['guest', 'guest', 'asks']);

    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const demoCall = await demo.api.calls.join(c, { mic: true, cam: false });
    const artCall = await art.api.calls.join(c, { mic: true, cam: false });
    const googlerCall = await googler.api.calls.join(c, { mic: true, cam: false });
    // The organizer sees the demo accounts by name only, and the Google account with its address.
    const asking = (await settle(host, (s) => s.waiting.length === 3)).waiting;
    expect(asking.find((w) => w.id === demoCall.ticket.identity)?.person).toMatchObject({ name: demo.session.user.name, email: '' });
    expect(asking.find((w) => w.id === artCall.ticket.identity)?.person.email).toBe('');
    expect(asking.find((w) => w.id === googlerCall.ticket.identity)?.person.email).toBe(googler.session.user.email);
    for (const who of [demoCall, artCall, googlerCall]) await letIn(host, who);
    // Only the Google account went on the invite; the demo ones are guests in the call.
    expect(await invite(org.api, host.getSnapshot().meetingId)).toEqual([googler.session.user.email]);
    expect((await settle(demoCall, (s) => s.participants.length === 4)).role).toBe('guest');
    expect((await settle(googlerCall, (s) => s.participants.length === 4)).role).toBe('invited');

    await host.transcribe(speech('Ship it on Friday.', 0, 0), host.ticket.identity);
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    expect((await googler.api.notes.get(noteId)).id).toBe(noteId);
    for (const them of [demo.api, art.api]) expect(code(await them.notes.get(noteId).catch((e: unknown) => e))).toBe('not-found');
  });
});

describe('signed-in people let in from the link', () => {
  it('adds them to the invite, so they get the notes, while a guest with only a name doesn’t; only the organizer sees who asks', async () => {
    const org = await account();
    const invitedEmail = unique('invited');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [invitedEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const invited = await (await account(invitedEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(invited);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    const asker = await account(unique('asker'));
    // Signed in, the account's name is what the organizer sees: a typed one doesn't stand in for it.
    const signedIn = await asker.api.calls.join(c, { mic: true, cam: false, name: 'Someone Else' });
    const lee = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Lee' });
    expect([signedIn.ticket.role, lee.ticket.role]).toEqual(['guest', 'guest']);
    expect(signedIn.crypto.getSnapshot().status).toBe('waiting');

    // The organizer sees who's asking: the signed-in person by their account, the guest by the name they typed.
    const asking = (await settle(host, (s) => s.waiting.length === 2)).waiting;
    expect(asking.find((w) => w.id === signedIn.ticket.identity)?.person).toMatchObject({ name: asker.session.user.name, email: asker.session.user.email });
    expect(asking.find((w) => w.id === lee.ticket.identity)?.person).toMatchObject({ name: 'Lee', email: '' });
    // Nobody else does: not someone invited, not a guest in the call, not another asker.
    for (const call of [invited, sam, lee]) {
      const theirs = await settle(call, (s) => call === lee || s.participants.length === 3);
      expect(theirs.waiting).toEqual([]);
      expect(JSON.stringify(theirs)).not.toContain(asker.session.user.email);
    }

    await letIn(host, signedIn);
    // On the invite now, as if invited by email: the call says so, and they see people as invited people do.
    expect(await invite(org.api, host.getSnapshot().meetingId)).toEqual([asker.session.user.email, invitedEmail].sort());
    const theirs = await settle(signedIn, (s) => s.participants.length === 4);
    expect(theirs.role).toBe('invited');
    expect(JSON.stringify(theirs.participants)).toContain(org.session.user.email);
    const sams = await settle(sam, (s) => s.participants.length === 4);
    expect(sams.role).toBe('guest');
    expect(JSON.stringify(sams)).not.toContain('@');
    // From then on they're invited: coming back on another connection, the organizer's browser lets them in without asking.
    const back = await asker.api.calls.join(c, { mic: true, cam: false });
    expect(back.ticket.role).toBe('invited');
    await inGroup(back);

    await host.transcribe(speech('We agreed to ship on Friday.', 0, 0), host.ticket.identity);
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    // The notes reach them like anyone invited. The guest has no account, and their pass reads no notes.
    expect((await asker.api.notes.get(noteId)).id).toBe(noteId);
    expect((await asker.api.notes.list()).map((n) => n.id)).toEqual([noteId]);
    const r = await fetch(`${h.baseUrl}/v1/notes/${noteId}`, { headers: { 'x-alcove-call': sam.ticket.pass, origin: ORIGIN } });
    expect(r.status).toBe(401);
    // Being on this call's invite opens nothing else of the organizer's.
    const other = await org.api.meetings.create({ title: 'Board prep', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on' });
    expect(code(await asker.api.meetings.get(other.id).catch((e: unknown) => e))).toBe('not-found');
  });

  it('brings back an earlier pass only as the same account: a guest let in who then signs in asks again, and isn’t added until let in', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const browser = h.browser();
    const sam = await browser.api.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    await sam.leave();
    // The same tab signs in and asks again with the pass it was let in with.
    const email = unique('sam');
    await browser.api.auth.signIn('sso', { email });
    const again = await browser.api.calls.join(c, { mic: true, cam: false, previous: sam.ticket.pass });
    expect(again.crypto.getSnapshot().status).toBe('waiting');
    const meetingId = host.getSnapshot().meetingId;
    expect(await invite(org.api, meetingId)).toEqual([]);
    const asking = (await settle(host, (s) => s.waiting.some((w) => w.id === again.ticket.identity))).waiting;
    expect(asking.find((w) => w.id === again.ticket.identity)?.person.email).toBe(email);
    await letIn(host, again);
    expect(await invite(org.api, meetingId)).toEqual([email]);
    await host.leave();
  });

  it('adds nobody past the invite’s limit of 300: someone let in then is a guest without the notes', async () => {
    const org = await account();
    const guests = Array.from({ length: 300 }, (_, i) => `full.${i}.${Date.now().toString(36)}@tests.example`);
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const asker = await account(unique('late'));
    const late = await asker.api.calls.join(c, { mic: true, cam: false });
    await letIn(host, late);
    expect((await invite(org.api, host.getSnapshot().meetingId)).length).toBe(300);
    expect((await settle(late, (s) => s.participants.length === 2)).role).toBe('guest');
    await host.leave();
  });

  it('adds them while notes are off, so notes turned on later go to them too', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const asker = await account(unique('asker'));
    const call = await asker.api.calls.join(c, { mic: true, cam: false });
    await letIn(host, call);
    expect(await invite(org.api, host.getSnapshot().meetingId)).toEqual([asker.session.user.email]);
    await host.setNotes(true);
    await host.transcribe(speech('The budget is approved.', 0, 0), host.ticket.identity);
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    expect((await asker.api.notes.get(noteId)).id).toBe(noteId);
  });

  it('takes someone back off the invite when the organizer removes them, so they don’t get the notes', async () => {
    const org = await account();
    const invitedEmail = unique('invited');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [invitedEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const asker = await account(unique('asker'));
    const signedIn = await asker.api.calls.join(c, { mic: true, cam: false });
    await letIn(host, signedIn);
    const meetingId = host.getSnapshot().meetingId;
    expect(await invite(org.api, meetingId)).toEqual([asker.session.user.email, invitedEmail].sort());

    await host.remove(signedIn.ticket.identity);
    // Only what letting them in added goes: the person invited by email stays invited.
    expect(await invite(org.api, meetingId)).toEqual([invitedEmail]);
    await host.transcribe(speech('Budget is approved.', 0, 0), host.ticket.identity);
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    expect(code(await asker.api.notes.get(noteId).catch((e: unknown) => e))).toBe('not-found');
    expect((await (await account(invitedEmail)).api.notes.get(noteId)).id).toBe(noteId);
  });

  it('keeps them on the invite while another connection of theirs is still in the call', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const email = unique('two');
    const laptop = await (await account(email)).api.calls.join(c, { mic: true, cam: false });
    await letIn(host, laptop);
    // Their phone: invited by then, so it comes straight in.
    const phone = await (await account(email)).api.calls.join(c, { mic: true, cam: false });
    expect(phone.ticket.role).toBe('invited');
    await inGroup(phone);
    const meetingId = host.getSnapshot().meetingId;
    await host.remove(phone.ticket.identity);
    expect(await invite(org.api, meetingId)).toEqual([email]);
    await host.remove(laptop.ticket.identity);
    expect(await invite(org.api, meetingId)).toEqual([]);
    await host.leave();
  });

  it('takes them off the invite in a later run of the call too, while notes already given stay given', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const first = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(first);
    const asker = await account(unique('asker'));
    await letIn(first, await asker.api.calls.join(c, { mic: true, cam: false }));
    await first.transcribe(speech('First run.', 0, 0), first.ticket.identity);
    const firstNote = (await first.leave())?.pendingNoteId ?? '';
    await written(org.api, firstNote);

    // The call runs again: they're invited now, so they come straight in, and removing them still takes them off.
    const second = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(second);
    const back = await asker.api.calls.join(c, { mic: true, cam: false });
    expect(back.ticket.role).toBe('invited');
    await inGroup(back);
    await second.remove(back.ticket.identity);
    expect(await invite(org.api, second.getSnapshot().meetingId)).toEqual([]);
    await second.transcribe(speech('Second run.', 0, 0), second.ticket.identity);
    const secondNote = (await second.leave())?.pendingNoteId ?? '';
    await written(org.api, secondNote);
    expect((await asker.api.notes.get(firstNote)).id).toBe(firstNote);
    expect(code(await asker.api.notes.get(secondNote).catch((e: unknown) => e))).toBe('not-found');
  });

  it('keeps an ask that was taken back, so its identity can’t ask again as someone else', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const theo = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Theo' });
    await settle(host, (s) => s.waiting.some((w) => w.id === theo.ticket.identity));
    await theo.leave();
    expect((await settle(host, (s) => s.waiting.length === 0)).waiting).toEqual([]);
    // Another account asking under the same identity, as a toast still showing Theo's ask would let in.
    const other = await account(unique('other'));
    const res = await other.fetch(`${h.baseUrl}/v1/calls/${c}/join`, {
      method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ mic: true, cam: false, identity: theo.ticket.identity, keyPackage: 'AAAAAAAAAAAAAAAAAAAAAAAA' })
    });
    expect(res.status).toBe(409);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ code: 'conflict', message: 'Join the call again.' });
    await host.leave();
  });

  it('lets nobody in from a late Let in, for someone already in or an ask taken back, and lets the next ask in as usual', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    const lee = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Lee' });
    await settle(host, (s) => s.waiting.some((w) => w.id === lee.ticket.identity));
    await lee.leave();
    expect((await settle(host, (s) => s.waiting.length === 0)).waiting).toEqual([]);
    // Let in pressed on toasts still showing their asks: Sam is in already, and Lee took the ask back.
    await host.admit(sam.ticket.identity);
    await host.admit(lee.ticket.identity);
    // The organizer's browser goes on as before: the next person to ask gets in, and Lee doesn't.
    const ada = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Ada' });
    await letIn(host, ada);
    const after = await settle(host, (s) => s.participants.length === 3);
    expect(after.participants.map((p) => p.person.name).sort()).toEqual([org.session.user.name, 'Ada', 'Sam'].sort());
    expect(after.participants.some((p) => p.id === lee.ticket.identity)).toBe(false);
    expect(sam.crypto.getSnapshot().status).toBe('in');
    await host.leave();
  });

  it('keeps a sealed record of a signed-in asker’s name and address: out of rows and logs', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const asker = await account('canary.asker@canary.example');
    expect(asker.session.user.name).toBe('Canary Asker');
    const signedIn = await asker.api.calls.join(c, { mic: true, cam: false });
    await letIn(host, signedIn);
    await host.leave();
    const dump = await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (
      SELECT row_to_json(x)::text AS t FROM calls x UNION ALL SELECT row_to_json(x)::text FROM items x UNION ALL
      SELECT row_to_json(x)::text FROM revisions x UNION ALL SELECT row_to_json(x)::text FROM note_access x UNION ALL
      SELECT row_to_json(x)::text FROM call_codes x) q`);
    const rows = String(dump.rows[0]?.all ?? '');
    const logs = h.logs.join('');
    for (const canary of ['canary.asker', 'Canary Asker']) {
      for (const enc of [canary, Buffer.from(canary).toString('hex'), Buffer.from(canary).toString('base64url').slice(0, 12)]) {
        expect(rows.includes(enc), `${canary} as ${enc} in rows`).toBe(false);
        expect(logs.includes(enc), `${canary} as ${enc} in logs`).toBe(false);
      }
    }
  });
});

describe('what guests see', () => {
  it('never shows a guest the address of anyone sent to a breakout room', async () => {
    const org = await account();
    const absent = unique('absent');
    const { code: c } = await org.api.calls.startNow({ notes: 'off', guests: [absent] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const asker = await account(unique('asker'));
    const signedIn = await asker.api.calls.join(c, { mic: true, cam: false });
    await letIn(host, signedIn);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    host.openRooms({ rooms: [{ name: 'One', emails: [asker.session.user.email] }, { name: 'Two', emails: [absent] }], minutes: 5 });
    await settle(host, (s) => s.breakouts.open !== null);
    const seen = await settle(sam, (s) => s.breakouts.open !== null);
    // Of the people sent to rooms, the guest sees those in the call by name, and nobody's address.
    expect(JSON.stringify(seen)).not.toContain('@');
    expect(seen.breakouts.open?.rooms.map((r) => r.people.map((p) => p.name))).toEqual([[asker.session.user.name], []]);
    await host.leave();
  });
});

describe('failing safely', () => {
  /** A refusal: its code, its message, and a request ID that finds its log lines, which name no code, pass or name. */
  async function refused(attempt: () => Promise<unknown>, secrets: string[]) {
    const e = await attempt().then(() => null, (x: unknown) => x);
    if (!(e instanceof AlcoveApiError)) throw new Error('expected the API to refuse');
    const id = e.requestId ?? '';
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    const lines = linesOf(id);
    expect(lines.some((l) => l.includes('"request refused"'))).toBe(true);
    for (const s of secrets) expect(lines.join('').includes(s), 'a join secret or name in the request’s log lines').toBe(false);
    return { code: e.code, message: e.message };
  }

  it('refuses an unknown code, a locked call, a removed person, an ended call and an expired pass, each with a request ID', async () => {
    const anyone = guestBrowser();
    expect(await refused(() => anyone.calls.card('zzz-zzzz-zzz'), ['zzz-zzzz-zzz'])).toEqual({ code: 'not-found', message: 'There’s no call with that code. Check the link and try again.' });
    expect((await refused(() => anyone.calls.join('zzz-zzzz-zzz', { mic: true, cam: false, name: 'Sam Unknown' }), ['zzz-zzzz-zzz', 'Sam Unknown'])).code).toBe('not-found');

    const org = await account();
    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam Removed' });
    await letIn(host, guest);
    const secrets = [c, guest.ticket.pass, host.ticket.pass, 'Sam Removed', 'Lee Locked'];

    await host.lock(true);
    expect(await refused(() => anyone.calls.join(c, { mic: true, cam: false, name: 'Lee Locked' }), secrets)).toEqual({ code: 'forbidden', message: 'The host has locked this call.' });
    await host.lock(false);

    // An expired pass: twelve hours on, the same pass reads nothing, and coming back with it means asking again.
    const later = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Ada Later' });
    await letIn(host, later);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 12 * 3_600_000 + 60_000 });
    expect(await refused(() => later.refresh(), [...secrets, later.ticket.pass])).toEqual({ code: 'unauthenticated', message: 'Join the call again to carry on.' });
    vi.useRealTimers();

    await host.remove(guest.ticket.identity);
    expect(await refused(() => guest.refresh(), secrets)).toEqual({ code: 'forbidden', message: 'The host removed you from this call.' });

    await host.leave();
    expect(await refused(() => later.refresh(), secrets)).toEqual({ code: 'conflict', message: 'This call has ended.' });
    expect(await refused(() => anyone.calls.join(c, { mic: true, cam: false, name: 'Sam' }), secrets)).toEqual({ code: 'conflict', message: 'This call has ended.' });
  });
});

describe('what a guest’s pass reaches', () => {
  it('opens its own call and nothing else: every route that needs an account, and every route of another call, refuses it', async () => {
    // An organizer with things a pass must never open: a meeting, written notes in a series, and their profile.
    const org = await account();
    const first = await org.api.calls.join((await org.api.calls.startNow({ title: 'Standup', notes: 'on' })).code, { mic: true, cam: false });
    await first.transcribe(speech('We agreed to ship on Friday.', 0, 0), first.ticket.identity);
    const firstEnd = await first.leave();
    const noteId = firstEnd?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const next = await org.api.meetings.scheduleNext(first.getSnapshot().meetingId, new Date(Date.now() + 7 * 86_400_000).toISOString());
    const ids: Record<string, string> = { id: noteId, decisionId: 'd', actionId: 'a', questionId: 'q', segment: '0', token: 'nothing', code: next.code };
    const meetingIds: Record<string, string> = { id: next.id };
    const seriesIds: Record<string, string> = { id: next.seriesId ?? '' };
    // A real workspace, so what a pass gets from one isn't just what it gets from an ID nobody has.
    const workspace = await org.api.workspaces.create('Standup workspace');
    const agenda = (await org.api.workspaces.items.create(workspace.id, { kind: 'document', name: 'Standup agenda' })).id;
    const picture = await org.api.workspaces.media.upload(workspace.id, agenda, new File([new Uint8Array(8)], 'standup.png', { type: 'image/png' }));
    const workspaceIds: Record<string, string> = { id: workspace.id, item: agenda, doc: agenda, media: picture.id, seq: '0' };

    const { code: c } = await org.api.calls.startNow({});
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const guest = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);

    // Every route of the API, from its own route table: anything outside the call routes and the public ones needs an account.
    // The new device's side of a move is public too: it has no account, and the move's secret in the body is what it holds.
    const MOVES = ['/v1/moves/claim', '/v1/moves/status', '/v1/moves/ready', '/v1/moves/arrive', '/v1/moves/cancel'];
    // A file's URL is public too: its token says who's asking, and it answers for nobody else, a pass included.
    const PUBLIC = new Set(['/health', '/healthz', '/hooks/livekit', '/v1/telemetry', '/v1/attestation', '/v1/session', '/v1/auth/sign-in', '/v1/auth/google', '/v1/auth/google/callback', '/v1/calls/:code/card', '/v1/calls/:code/join', '/v1/media/:token', '/v1/calls/:code/pick', ...MOVES]);
    const table = createApp(h.deps).routes.filter((r) => r.method !== 'ALL');
    // A pass is nothing to them: without a move's secret, they find no move.
    for (const path of MOVES) {
      const res = await fetch(`${h.baseUrl}${path}`, { method: 'POST', headers: { 'x-alcove-call': guest.ticket.pass, origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ code: 'x'.repeat(22), claim: 'x'.repeat(22), identity: `p_${'x'.repeat(22)}`, keyPackage: 'AAAA', device: { kind: 'phone', os: 'ios', browser: 'safari' } }) });
      expect(`${path} → ${res.status}`).toBe(`${path} → 404`);
      expect(await res.text()).not.toContain('Standup');
    }
    // The only routes outside the call's that take a pass: what may be shared with someone's seat in a call. Each one is listed
    // here on purpose, and without anything shared it answers as if the workspace weren't there.
    const BY_PASS = new Set([
      'GET /v1/workspaces/:id', 'GET /v1/workspaces/:id/live', 'GET /v1/workspaces/:id/items/:item', 'PATCH /v1/workspaces/:id/items/:item', 'POST /v1/workspaces/:id/items/:item/restore', 'POST /v1/workspaces/:id/presence', 'GET /v1/workspaces/:id/search',
      'GET /v1/workspaces/:id/documents/:doc/live', 'POST /v1/workspaces/:id/documents/:doc/updates', 'POST /v1/workspaces/:id/documents/:doc/awareness', 'GET /v1/workspaces/:id/documents/:doc/versions',
      'GET /v1/workspaces/:id/documents/:doc/versions/:version', 'POST /v1/workspaces/:id/documents/:doc/versions/:version/restore',
      'GET /v1/workspaces/:id/media', 'POST /v1/workspaces/:id/documents/:doc/media', 'GET /v1/workspaces/:id/documents/:doc/media/:media/token', 'POST /v1/workspaces/:id/documents/:doc/media/:media/pieces/:seq',
      'POST /v1/workspaces/:id/documents/:doc/media/:media/finish', 'POST /v1/workspaces/:id/documents/:doc/media/:media/attach', 'DELETE /v1/workspaces/:id/documents/:doc/media/:media'
    ]);
    const byPass = (r: { method: string; path: string }) => BY_PASS.has(`${r.method} ${r.path}`);
    const routes = table.filter((r) => !PUBLIC.has(r.path) && !r.path.startsWith('/v1/live/calls/') && !byPass(r));
    expect(routes.length).toBeGreaterThan(30);
    const fill = (path: string) => {
      const by = path.startsWith('/v1/meetings/') ? { ...ids, ...meetingIds } : path.startsWith('/v1/series/') ? { ...ids, ...seriesIds } : path.startsWith('/v1/workspaces/') ? { ...ids, ...workspaceIds } : ids;
      return path.replace(/:([A-Za-z]+)/g, (_, name: string) => encodeURIComponent(by[name] ?? 'x'));
    };
    const send = (method: string, path: string, body = '{}') => {
      const mutating = method !== 'GET';
      return fetch(`${h.baseUrl}${path}`, { method, headers: { 'x-alcove-call': guest.ticket.pass, origin: ORIGIN, ...(mutating ? { 'content-type': 'application/json' } : {}) }, ...(mutating ? { body } : {}) });
    };
    const passRoutes = table.filter(byPass);
    expect(passRoutes.map((r) => `${r.method} ${r.path}`).sort()).toEqual([...BY_PASS].sort());
    // Each with what it takes, so what answers is whether it's there to reach and not what was sent.
    const update = 'AQHpxYYMAAQBB2NvbnRlbnQBeAA';
    const presence = { connection: 'x'.repeat(22), document: null, block: null, typing: false };
    const asking: Record<string, unknown> = { 'POST /v1/workspaces/:id/presence': presence, 'POST /v1/workspaces/:id/documents/:doc/updates': { update }, 'POST /v1/workspaces/:id/documents/:doc/awareness': { update: 'AA' } };
    for (const r of passRoutes) {
      const res = await send(r.method, fill(r.path), JSON.stringify(asking[`${r.method} ${r.path}`] ?? { name: 'Renamed by a guest' }));
      expect(`${r.method} ${r.path} → ${res.status}`).toBe(`${r.method} ${r.path} → 404`);
      expect(await res.text()).not.toContain('Standup');
    }
    expect((await org.api.workspaces.items.get(workspace.id, workspaceIds['item'] ?? '')).name).toBe('Standup agenda');
    expect((await org.api.workspaces.media.list(workspace.id)).map((m) => m.name)).toEqual(['standup.png']);
    const noToken = await send('GET', '/v1/media/nothing');
    expect(noToken.status).toBe(404);
    expect(await noToken.text()).not.toContain('Standup');
    for (const r of routes) {
      const res = await send(r.method, fill(r.path));
      expect(`${r.method} ${r.path} → ${res.status}`).toBe(`${r.method} ${r.path} → 401`);
      expect(await res.text()).not.toContain('Standup');
    }
    // Every route of another call (the one that ended) refuses it before reading anything.
    const live = table.filter((r) => r.path.startsWith('/v1/live/calls/'));
    expect(live.length).toBeGreaterThan(10);
    for (const r of live) {
      const res = await send(r.method, r.path.replace(':id', first.ticket.callId));
      expect(`${r.method} ${r.path} → ${res.status}`).toBe(`${r.method} ${r.path} → 401`);
    }
    // Within its own call, what only the organizer may do is refused.
    for (const [method, path] of [['POST', '/audio'], ['POST', '/transcribe'], ['POST', '/mls/commits']] as const) {
      const res = await send(method, `/v1/live/calls/${guest.ticket.callId}${path}`);
      expect([path, res.status]).toEqual([path, 403]);
    }
    await host.leave();
  });
});
