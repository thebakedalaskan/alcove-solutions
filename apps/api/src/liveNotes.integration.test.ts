/**
 * A call's shared live notes: one set for each part of the call, kept sealed on the server and refreshed at most every
 * 30 seconds while someone is watching, in one run however many are; who may read what of them (guests, rooms); ticking
 * a follow-up for everyone, through refreshes that reword it and into the note; what stops them (notes off, paused); and
 * that nothing readable is left anywhere. The real API over HTTP via @alcove/api-http, real Postgres, the object store,
 * the local LiveKit server, and the stand-in NEAR AI, which can reword what it wrote before.
 */
import { AlcoveApiError, DEFAULT_NOTES_CHOICES, type AudioPiece, type CallSession, type CallState, type LiveFollowUp, type LiveNotes, type Note, type TranscriptClip } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { maintain } from './maintenance';
import { NoteManifest } from './modules/notes';
import { openOwner } from './owners';
import { speechWav } from './testing/fake-near';
import { ORIGIN, startHarness, type Harness } from './testing/harness';
import { connect, disposeLiveKit, type TestParticipant } from './testing/livekit';
import { getItem, saveRevision } from './vault';

// Calls set up MLS groups and LiveKit rooms, which a busy runner can be slow to do: every wait says what it waited for.
vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
const open: TestParticipant[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map((p) => p.disconnect().catch(() => undefined))); h.closeCalls(); });

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const said = (e: unknown) => (e instanceof AlcoveApiError ? e.message : 'not-an-api-error');
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
const guestBrowser = () => h.browser().api;
const audioBytes = (marker: string) => { const src = Buffer.concat([Buffer.from(marker), randomBytes(2048)]); const out = new Uint8Array(new ArrayBuffer(src.length)); out.set(src); return out; };
const piece = (bytes: Uint8Array<ArrayBuffer>, segment: number, s: number): AudioPiece => ({ data: new Blob([bytes]), segment, seq: s, at: s * 5, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
const speech = (words: string, segment: number, atMs: number, ms = 4000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment, at: atMs / 1000, durationMs: ms });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
/** Reads the call again until `pred` holds, or the wait is up. */
async function settle(call: CallSession, pred: (s: CallState) => boolean, ms = 15_000): Promise<CallState> {
  const until = Date.now() + ms;
  while (!pred(call.getSnapshot()) && Date.now() < until) { await call.refresh(); await sleep(30); }
  return call.getSnapshot();
}
/** Waits until the organizer no longer lists someone: the goodbye their page sent as it went has arrived. */
const gone = (host: CallSession, who: CallSession) => settle(host, (x) => !x.participants.some((p) => p.id === who.ticket.identity));
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
const inPlace = (call: CallSession, place: string) => waitFor(() => { const s = call.crypto.getSnapshot(); return s.status === 'in' && s.place === place && Boolean(s.media?.send); }, `${call.ticket.role} in ${place === 'main' ? 'the main room' : 'a room'}`);
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await inGroup(who);
}
/** An organizer in a call with notes on, and someone invited to it in the call too, with the recording under way. */
async function twoInCall(notes: 'on' | 'off' = 'on') {
  const org = await account();
  const email = unique('kofi');
  const { code: c } = await org.api.calls.startNow({ notes, guests: [email] });
  const host = await org.api.calls.join(c, { mic: true, cam: false });
  await inGroup(host);
  const invited = await account(email);
  const kofi = await invited.api.calls.join(c, { mic: true, cam: false });
  await inGroup(kofi);
  if (notes === 'on') for (const at of [0, 1, 2, 3]) await host.appendAudio(piece(audioBytes('live-notes'), 0, at));
  return { org, host, kofi, invited, code: c, email };
}
const say = (host: CallSession, words: string, atMs = 0) => host.transcribe(speech(words, 0, atMs), host.ticket.identity);
/** Said a moment ago, so it falls after someone who just came in came in. */
const sayNow = (host: CallSession, words: string, atMs: number) => host.transcribe({ ...speech(words, 0, atMs), heardAt: performance.now() - 50 }, host.ticket.identity);

/** Requests that reached the notes model as a refresh of live notes (or a catch-up: both are asked the same way). */
const runs = () => h.near.instructions.filter((s) => s.startsWith('You help someone catch up')).length;
/** What each of those requests sent the notes model, from the `from`th on. */
const sentSince = (from: number) => h.near.prompts.filter((_, i) => h.near.instructions[i]?.startsWith('You help someone catch up')).slice(from);
/** The notes as this browser reads them once they exist and aren't being written, and `pred` holds. */
async function notesOf(call: CallSession, pred: (n: NonNullable<LiveNotes['notes']>) => boolean = () => true) {
  const s = await settle(call, (x) => { const n = x.liveNotes.notes; return n !== null && !x.liveNotes.writing && pred(n); });
  const n = s.liveNotes.notes;
  if (!n || s.liveNotes.writing || !pred(n)) throw new Error('timed out waiting for the live notes');
  return n;
}
/** As if `seconds` had passed since the call's notes were last looked at. */
const later = (call: CallSession, seconds = 31) => h.pool.query(`UPDATE call_notes SET looked_at = now() - make_interval(secs => $2) WHERE call_id = $1`, [call.ticket.callId, seconds]);
const NOT_UPDATED = 'The notes couldn’t be updated just now. Alcove tries again on its own.';
const texts = (xs: { text: string }[]) => xs.map((x) => x.text);
const followUp = (xs: LiveFollowUp[], text: string): LiveFollowUp => {
  const f = xs.find((x) => x.text === text);
  if (!f) throw new Error(`no follow-up “${text}” among ${JSON.stringify(texts(xs))}`);
  return f;
};
/** Someone in the call saying they're watching, straight to an API instance, with their pass. */
const look = async (base: string, call: CallSession) => {
  const r = await fetch(`${base}/v1/live/calls/${call.ticket.callId}/notes/watch`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-alcove-call': call.ticket.pass }, body: '{}' });
  return { status: r.status, body: await r.json() };
};
const notesRows = async (callId: string) => Number((await h.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM call_notes WHERE call_id = $1', [callId])).rows[0]?.n ?? -1);
async function written(api: Awaited<ReturnType<typeof account>>['api'], noteId: string | null | undefined): Promise<Note> {
  const until = Date.now() + 30_000;
  for (;;) {
    const n = await api.notes.get(noteId ?? '');
    if (n.status === 'ready') return n;
    if (Date.now() > until) throw new Error('timed out waiting for the notes');
    await sleep(40);
  }
}
const encodings = (s: string) => [s, Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64').slice(0, 12), Buffer.from(s).toString('base64url').slice(0, 12)];

const A = 'We agreed to start with the budget.';
const B = 'Kofi will check the budget by Friday.';
const C = 'Should we cut the travel line?';

describe('one set of live notes for the call', () => {
  it('writes them once however many are watching, and everyone reads the same ones', async () => {
    const { host, kofi } = await twoInCall();
    await say(host, A);
    await say(host, B, 4000);
    await say(host, C, 8000);
    const before = runs();
    // A busy model, so both browsers are looking while the run is on its way.
    h.near.slowNext(700);
    const stop = [host.watchNotes(), kofi.watchNotes()];
    await waitFor(() => runs() > before, 'the notes model to be asked');
    expect((await settle(kofi, (s) => s.liveNotes.writing)).liveNotes.writing).toBe(true);
    const seen = await notesOf(host);
    expect(texts(seen.decided)).toEqual([A]);
    expect(seen.next).toEqual([expect.objectContaining({ text: B, owner: 'Kofi', due: 'Friday', done: false, id: expect.any(String) })]);
    expect(texts(seen.open)).toEqual([C]);
    expect(seen.summary).toBe('Catching up on 3 lines.');
    expect(seen.read).toMatchObject({ lines: 3, whileHere: false, skipped: null });
    // Only what was really said: the model's invented decision and its pointers at lines that aren't there are dropped.
    expect(texts(seen.decided)).not.toContain('Everyone agreed to double the budget.');
    expect(seen.decided[0]?.evidence).toEqual([{ kind: 'transcript', lineId: host.getSnapshot().transcript[0]?.id, said: expect.any(Number) }]);
    expect(await notesOf(kofi)).toEqual(seen);
    await sleep(400);
    expect(runs()).toBe(before + 1);
    for (const s of stop) s();

    // They come with the call, so someone who wasn't watching reads them too, and nothing is asked again.
    expect((await settle(host, (s) => !s.liveNotes.writing)).liveNotes.notes).toEqual(seen);
    await host.leave();
  });

  it('runs once when watchers race, across API instances too', async () => {
    const { host, kofi } = await twoInCall();
    await say(host, A);
    const before = runs();
    const second = await h.secondServer();
    try {
      h.near.slowNext(300);
      const looks = await Promise.all([look(h.baseUrl, kofi), look(second.baseUrl, kofi), look(second.baseUrl, host), look(h.baseUrl, host), look(second.baseUrl, kofi)]);
      expect(looks.map((l) => l.status)).toEqual([200, 200, 200, 200, 200]);
      expect(looks.filter((l) => JSON.stringify(l.body) === '{"refreshed":true}')).toHaveLength(1);
      expect(runs()).toBe(before + 1);
    } finally { await second.close(); }
    await host.leave();
  });

  it('refreshes at most every 30 seconds, only with something new and only while someone is watching', async () => {
    const { host, kofi } = await twoInCall();
    const before = runs();
    await say(host, A);
    // Nobody is watching: nothing goes to the notes model, and nothing is kept.
    await sleep(300);
    await host.refresh();
    expect(host.getSnapshot().liveNotes).toEqual({ notes: null, writing: false, error: null });
    expect(runs()).toBe(before);
    expect(await notesRows(host.ticket.callId)).toBe(0);

    // Watching with nothing said in this part of the call yet costs nothing either.
    const quiet = await twoInCall();
    const q = quiet.kofi.watchNotes();
    await sleep(300);
    q();
    expect(runs()).toBe(before);
    expect(await notesRows(quiet.host.ticket.callId)).toBe(0);
    await quiet.host.leave();

    const stop = kofi.watchNotes();
    await notesOf(kofi, (n) => n.read.lines === 1);
    expect(runs()).toBe(before + 1);
    // Half a minute on with nothing new: nothing to read, so nothing is asked.
    await later(kofi);
    await sleep(400);
    expect(runs()).toBe(before + 1);

    // Something new, and it's been under 30 seconds: it waits.
    await later(kofi, 28);
    await say(host, B, 4000);
    await sleep(500);
    expect(runs()).toBe(before + 1);
    // At 30 seconds it goes, once.
    await later(kofi);
    await notesOf(kofi, (n) => n.read.lines === 2);
    await sleep(300);
    expect(runs()).toBe(before + 2);

    // Nobody watching any more: however long it's been, nothing is asked.
    stop();
    await say(host, C, 8000);
    await later(kofi);
    await sleep(400);
    expect(runs()).toBe(before + 2);
    // The next look takes up what was said meanwhile.
    const next = kofi.watchNotes();
    await notesOf(kofi, (n) => n.read.lines === 3);
    next();
    await host.leave();
  });

  it('nudges the room, says when it’s writing, and says when it couldn’t, trying again later with the notes as they were', async () => {
    const { host, kofi } = await twoInCall();
    await say(host, A);
    open.push(await connect(await host.room(), { sending: host.crypto }));
    const p = open[0];
    const nudged = p?.nextNudge();
    const stop = kofi.watchNotes();
    await nudged;
    const seen = await notesOf(host);

    await say(host, B, 4000);
    h.near.failNext(1, 'prose');
    await later(kofi);
    const failed = await settle(host, (s) => s.liveNotes.error !== null);
    // Nobody can do anything about it here, so nobody's told to: why is in the log, for the request that tried.
    expect(failed.liveNotes.error).toBe(NOT_UPDATED);
    expect(h.logs.some((l) => l.includes('live notes not refreshed') && l.includes('The notes service sent back something unexpected.'))).toBe(true);
    expect(failed.liveNotes.notes).toEqual(seen);
    // Tried again once the half minute is up, with the same lines, and then it's all right again.
    await later(kofi);
    expect((await notesOf(host, (n) => n.read.lines === 2)).read.lines).toBe(2);
    expect((await settle(host, (s) => s.liveNotes.error === null)).liveNotes.error).toBeNull();
    stop();
    await host.leave();
  });

  it('counts a reply it can’t use as a failed refresh, whatever shape it came in', async () => {
    for (const how of ['empty', 'partial'] as const) {
      const { host, kofi } = await twoInCall();
      await say(host, A);
      await say(host, B, 4000);
      const stop = kofi.watchNotes();
      const seen = await notesOf(kofi);
      await say(host, C, 8000);
      h.near.failNext(1, how);
      await later(kofi);
      const failed = await settle(host, (s) => s.liveNotes.error !== null);
      expect(failed.liveNotes.error).toBe(NOT_UPDATED);
      expect(failed.liveNotes.notes).toEqual(seen);
      await later(kofi);
      expect((await notesOf(host, (n) => n.read.lines === 3)).summary).toBe('Catching up on 3 lines.');
      expect((await settle(host, (s) => s.liveNotes.error === null)).liveNotes.error).toBeNull();
      stop();
      await host.leave();
    }
  });

  it('is free: it charges nobody, and the notes at the end are charged as ever', async () => {
    const { org, host, kofi, invited } = await twoInCall();
    const [organizer, guest] = [await org.api.credits.balance(), await invited.api.credits.balance()];
    await say(host, A);
    const stop = kofi.watchNotes();
    await notesOf(kofi);
    await say(host, B, 4000);
    await later(kofi);
    await notesOf(kofi, (n) => n.read.lines === 2);
    stop();
    expect(await org.api.credits.balance()).toEqual(organizer);
    expect(await invited.api.credits.balance()).toEqual(guest);
    const ended = await host.leave();
    await written(org.api, ended?.pendingNoteId);
    // One minute of notes, once, to the organizer alone: whoever was watching.
    expect((await org.api.credits.balance()).balance).toBe(organizer.balance - 25);
    expect(await invited.api.credits.balance()).toEqual(guest);
  });

  it('leaves Catch up and Ask as they were: for the person asking, from what they may read, whatever the notes hold', async () => {
    const { host, kofi } = await twoInCall();
    await say(host, A);
    const stop = kofi.watchNotes();
    await notesOf(kofi);
    stop();
    const before = runs();
    expect(texts((await kofi.catchUp({ kind: 'all' })).decided)).toEqual([A]);
    expect((await kofi.askSoFar('What about the budget?', { kind: 'all' })).text).toBe(`From the call: ${A}`);
    expect(runs()).toBe(before + 1);
    await host.leave();
  });
});

describe('who reads what of them', () => {
  it('writes a guest’s notes from what they may read alone: nothing else reaches the notes model for them', async () => {
    const { host, kofi, code: c } = await twoInCall();
    const BEFORE = 'We agreed on the budget before Sam came.';
    await say(host, BEFORE);
    await sleep(1100);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    const SAID = 'Sam will review the plan by Monday.';
    await sleep(300);
    await sayNow(host, SAID, 6000);

    // Only Sam is watching: the model reads what Sam may read, and not a word more.
    const before = runs();
    const stop = sam.watchNotes();
    const theirs = await notesOf(sam);
    stop();
    expect(runs()).toBe(before + 1);
    expect(sentSince(before)[0]).toContain(SAID);
    expect(sentSince(before)[0]).not.toContain('budget');
    expect(theirs.summary).toBe('Catching up on 1 lines.');
    expect(texts(theirs.next)).toEqual([SAID]);
    expect(theirs.decided).toEqual([]);
    expect(theirs.read).toMatchObject({ lines: 1, whileHere: true });
    expect(JSON.stringify(sam.getSnapshot().liveNotes)).not.toContain('budget');
    // Nobody who may read the rest was watching, so nothing was written for them, and they don't read Sam's.
    await kofi.refresh();
    expect(kofi.getSnapshot().liveNotes.notes).toBeNull();

    // Someone invited reads all of it, from a run of its own over every line.
    const full = await (async () => { const s = kofi.watchNotes(); const n = await notesOf(kofi); s(); return n; })();
    expect(runs()).toBe(before + 2);
    expect(sentSince(before)[1]).toContain(BEFORE);
    expect(sentSince(before)[1]).toContain(SAID);
    expect(texts(full.decided)).toEqual([BEFORE]);
    expect(texts(full.next)).toEqual([SAID]);
    expect(full).toMatchObject({ summary: 'Catching up on 2 lines.', read: { lines: 2, whileHere: false } });
    expect(await notesRows(host.ticket.callId)).toBe(2);
    await sam.refresh();
    expect(sam.getSnapshot().liveNotes.notes).toEqual(theirs);

    // Sam's notes are read-only: a guest ticks nothing, and nobody ticks anything of theirs.
    const [id, samsId] = [full.next[0]?.id ?? '', theirs.next[0]?.id ?? ''];
    expect(code(await sam.tickFollowUp(id, true).catch((e: unknown) => e))).toBe('forbidden');
    expect(code(await sam.tickFollowUp(samsId, true).catch((e: unknown) => e))).toBe('forbidden');
    expect(code(await kofi.tickFollowUp(samsId, true).catch((e: unknown) => e))).toBe('not-found');
    expect((await notesOf(kofi)).next[0]?.done).toBe(false);
    // Someone who gets the notes ticks it, and Sam sees that one done.
    await kofi.tickFollowUp(id, true);
    expect((await notesOf(sam, (n) => n.next[0]?.done === true)).next[0]?.id).toBe(samsId);
    await host.leave();
  });

  it('shares one run among everyone who can read the same lines, and costs another only for a different view', async () => {
    const { host, code: c } = await twoInCall();
    await say(host, 'We agreed on the budget before anyone came.');
    await sleep(1100);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    const lee = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Lee' });
    await letIn(host, lee);
    await sleep(300);
    await sayNow(host, 'We agreed on the plan with both of them here.', 6000);

    // Came in at different moments, with nothing said in between: the same lines, so one set of notes.
    const before = runs();
    h.near.slowNext(300);
    const stop = [sam.watchNotes(), lee.watchNotes()];
    const theirs = await notesOf(sam);
    expect(await notesOf(lee)).toEqual(theirs);
    await sleep(600);
    for (const s of stop) s();
    expect(runs()).toBe(before + 1);
    expect(await notesRows(host.ticket.callId)).toBe(1);

    // Someone who came in after that line has other lines: a run of their own, which doesn't read it.
    const kim = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Kim' });
    await letIn(host, kim);
    await sleep(300);
    const LATER = 'We agreed Kim reads this much.';
    await sayNow(host, LATER, 9000);
    const next = runs();
    const k = kim.watchNotes();
    const hers = await notesOf(kim);
    k();
    expect(texts(hers.decided)).toEqual([LATER]);
    expect(runs()).toBe(next + 1);
    expect(sentSince(next)[0]).not.toContain('both of them');
    // Sam and Lee read on: the same rules, one run for the two of them.
    await later(sam);
    const again = [sam.watchNotes(), lee.watchNotes()];
    const more = await notesOf(sam, (n) => n.read.lines === 2);
    expect(await notesOf(lee, (n) => n.read.lines === 2)).toEqual(more);
    for (const s of again) s();
    expect(runs()).toBe(next + 2);
    await host.leave();
  });

  it('never shows someone back from time away notes that read what was said while they were gone', async () => {
    const { host, code: c } = await twoInCall();
    await say(host, 'We agreed on the budget before anyone came.');
    await sleep(1100);
    const browser = guestBrowser();
    const sam = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    const lee = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Lee' });
    await letIn(host, lee);
    await sleep(300);
    const FIRST = 'We agreed on the first plan.';
    await sayNow(host, FIRST, 6000);
    const stop = lee.watchNotes();
    await notesOf(lee);
    // Sam shares Lee's notes, and then Sam's page goes away. Lee hears what's said meanwhile.
    await settle(sam, (s) => s.liveNotes.notes !== null);
    sam.closing();
    await gone(host, sam);
    await sleep(1200);
    const WHILE = 'We agreed on the second plan while Sam was away.';
    await sayNow(host, WHILE, 8000);
    await later(lee);
    await notesOf(lee, (n) => n.read.lines === 2);
    stop();

    // Back: the notes Sam shared now read that line, so Sam doesn't read them.
    const back = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam', previous: sam.ticket.pass });
    await inGroup(back);
    await back.refresh();
    expect(JSON.stringify(back.getSnapshot().liveNotes)).not.toContain('second plan');
    // Watching writes notes for what Sam may read now.
    const before = runs();
    const s = back.watchNotes();
    const own = await notesOf(back);
    s();
    expect(texts(own.decided)).toEqual([FIRST]);
    expect(sentSince(before)[0]).not.toContain('second plan');
    await host.leave();
  });

  it('lets a guest who missed nothing read everyone’s notes, however often their page came back', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    await host.appendAudio(piece(audioBytes('reload'), 0, 0));
    const browser = guestBrowser();
    const sam = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    await sleep(300);
    await sayNow(host, 'We agreed on the first plan.', 1000);
    // A reload with nothing said while the page was away.
    sam.closing();
    await gone(host, sam);
    await sleep(1200);
    const back = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam', previous: sam.ticket.pass });
    await inGroup(back);
    await sleep(300);
    await sayNow(host, 'We agreed on the second plan.', 3000);
    const before = runs();
    const stop = [host.watchNotes(), back.watchNotes()];
    const seen = await notesOf(host);
    expect(await notesOf(back)).toEqual(seen);
    await sleep(400);
    for (const s of stop) s();
    expect(seen.read).toMatchObject({ lines: 2, whileHere: false });
    expect(runs()).toBe(before + 1);
    expect(await notesRows(host.ticket.callId)).toBe(1);
    await host.leave();
  });

  it('shows a guest all of it when they were here for all of it, and someone added to the invite all of it from then on', async () => {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    await host.appendAudio(piece(audioBytes('here'), 0, 0));
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    await sleep(200);
    await say(host, 'We agreed that Sam stays for all of it.', 1000);
    const stop = sam.watchNotes();
    const seen = await notesOf(sam);
    stop();
    expect(seen).toMatchObject({ summary: 'Catching up on 1 lines.', read: { lines: 1, whileHere: false } });
    expect(texts(seen.decided)).toEqual(['We agreed that Sam stays for all of it.']);

    // Asking from the link under an account: on the invite once let in, so they read what was said before they came.
    const lee = await (await account(unique('lee'))).api.calls.join(c, { mic: true, cam: false });
    await letIn(host, lee);
    await settle(lee, (s) => s.role === 'invited');
    expect(await notesOf(lee)).toEqual(seen);
    await host.leave();
  });

  it('gives someone still asking to be let in nothing, and someone removed nothing more', async () => {
    const { host, code: c } = await twoInCall();
    await say(host, A);
    const stop = host.watchNotes();
    await notesOf(host);
    stop();
    const kim = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Kim' });
    expect(kim.getSnapshot().liveNotes).toEqual({ notes: null, writing: false, error: null });
    expect((await look(h.baseUrl, kim)).status).toBe(403);
    await letIn(host, kim);
    await host.remove(kim.ticket.identity);
    expect((await look(h.baseUrl, kim)).status).toBe(403);
    await host.leave();
  });
});

describe('breakout rooms', () => {
  async function roomsCall(also: string[] = []) {
    const org = await account();
    const [kofiEmail, lenaEmail] = [unique('kofi'), unique('lena')];
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [kofiEmail, lenaEmail, ...also] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const kofi = await (await account(kofiEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(kofi);
    const lena = await (await account(lenaEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(lena);
    await host.appendAudio(piece(audioBytes('rooms'), 0, 0));
    return { org, host, kofi, lena, kofiEmail, lenaEmail, code: c };
  }
  const roomIds = async (host: CallSession) => (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms.map((r) => r.id) ?? [];
  const scribing = (call: CallSession, room: string) => settle(call, (x) => x.capture.room?.id === room && x.capture.room.scribe === call.ticket.identity);

  it('keeps each room’s notes to the room: what’s said there reaches nobody else, the notes model’s prompts included', async () => {
    const { org, host, kofi, lena, kofiEmail, lenaEmail } = await roomsCall();
    const MAIN = 'We agreed to split into two rooms.';
    await say(host, MAIN);
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [lenaEmail] }], minutes: 10 });
    const [design = '', support = ''] = await roomIds(host);
    await inPlace(kofi, design);
    await inPlace(lena, support);
    await scribing(kofi, design);
    await scribing(lena, support);
    const DESIGN = 'CANARY-DESIGN we decided on blue buttons.';
    const SUPPORT = 'Lena will call the customer by Monday.';
    await kofi.transcribe(speech(DESIGN, 0, 2000), kofi.ticket.identity);
    await lena.transcribe(speech(SUPPORT, 0, 2500), lena.ticket.identity);
    const MEANWHILE = 'We agreed the organizer stays in the main room.';
    await say(host, MEANWHILE, 3000);

    const before = runs();
    const stop = [host.watchNotes(), kofi.watchNotes(), lena.watchNotes()];
    const [inMain, inDesign, inSupport] = [await notesOf(host), await notesOf(kofi), await notesOf(lena)];
    for (const s of stop) s();
    // One run for each part of the call, each from that part's lines alone.
    expect(runs()).toBe(before + 3);
    const sent = sentSince(before);
    expect(sent.filter((p) => p.includes(DESIGN))).toHaveLength(1);
    expect(sent.filter((p) => p.includes(SUPPORT))).toHaveLength(1);
    expect(sent.find((p) => p.includes(DESIGN))).not.toContain(MAIN);
    expect(sent.find((p) => p.includes(DESIGN))).not.toContain(SUPPORT);
    expect(sent.find((p) => p.includes(MAIN))).toContain(MEANWHILE);
    expect(texts(inDesign.decided)).toEqual([DESIGN]);
    expect(inDesign.read.lines).toBe(1);
    expect(texts(inSupport.next)).toEqual([SUPPORT]);
    expect(texts(inMain.decided)).toEqual([MAIN, MEANWHILE]);

    // A follow-up is the room's alone: nobody elsewhere finds it, the organizer in the main room included.
    const id = inSupport.next[0]?.id ?? '';
    for (const who of [kofi, host]) expect(code(await who.tickFollowUp(id, true).catch((e: unknown) => e))).toBe('not-found');
    await lena.tickFollowUp(id, true);
    await notesOf(lena, (n) => n.next[0]?.done === true);

    // The organizer visiting a room gets notes of its own from what's said once it's there: what was said before never
    // reaches them, and it can't tick anything in them.
    host.visitRoom(design);
    await inPlace(host, design);
    await host.refresh();
    expect(host.getSnapshot().liveNotes.notes).toBeNull();
    const WITH = 'We agreed the organizer likes the blue.';
    await kofi.transcribe(speech(WITH, 0, 6000), host.ticket.identity);
    const visitRun = runs();
    const visit = host.watchNotes();
    const visiting = await notesOf(host);
    visit();
    expect(texts(visiting.decided)).toEqual([WITH]);
    expect(visiting.read).toMatchObject({ lines: 1, whileHere: true });
    expect(sentSince(visitRun)[0]).not.toContain('CANARY-DESIGN');
    // The room's own people read all of it, in notes of their own.
    await later(kofi);
    const room = kofi.watchNotes();
    expect(texts((await notesOf(kofi, (n) => n.read.lines === 2)).decided)).toEqual([DESIGN, WITH]);
    room();
    expect((await notesOf(kofi)).read.whileHere).toBe(false);
    host.visitRoom(null);
    await inPlace(host, 'main');

    // Rooms close. The main room's notes read what the organizer said there while they were away, so Kofi can't read them.
    host.closeRooms();
    await inPlace(kofi, 'main');
    await inPlace(lena, 'main');
    await kofi.refresh();
    expect(kofi.getSnapshot().liveNotes.notes).toBeNull();
    // The next look writes them again without that talk, even with nothing new said, and then everyone reads one set.
    await later(kofi);
    const back = kofi.watchNotes();
    const after = await notesOf(kofi);
    back();
    expect(texts(after.decided)).toEqual([MAIN]);
    expect(after).toMatchObject({ summary: 'Catching up on 1 lines.', read: { lines: 1, whileHere: false } });
    expect(JSON.stringify(kofi.getSnapshot().liveNotes)).not.toContain('CANARY-DESIGN');
    await Promise.all([host.refresh(), lena.refresh()]);
    expect(await notesOf(host)).toEqual(after);
    expect(await notesOf(lena)).toEqual(after);
    await say(host, 'We agreed to wrap up.', 9000);
    await later(host);
    const wrap = host.watchNotes();
    const wrapped = await notesOf(host, (n) => n.decided.some((d) => d.text === 'We agreed to wrap up.'));
    wrap();
    expect(wrapped).toMatchObject({ summary: 'Catching up on 2 lines.', read: { whileHere: false } });
    expect(await notesOf(kofi, (n) => n.read.lines === 2)).toEqual(wrapped);

    // What was ticked in a room is done in the room's section of the note.
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);
    expect(note.rooms.find((r) => r.name === 'Support')?.actions).toEqual([expect.objectContaining({ text: 'Call the customer by Monday', done: true })]);
    expect(await notesRows(host.ticket.callId)).toBe(0);
  });

  it('goes by every line a follow-up cites, not the three it shows, for what someone may read', async () => {
    const { org, host, kofi, kofiEmail, lenaEmail } = await roomsCall();
    const [ONE, TWO, TASK, SECRET] = ['We talked about the plan.', 'We talked about the launch.', 'Kofi will book the hall by Friday.', 'The hall is for the surprise party.'];
    await say(host, ONE);
    await say(host, TWO, 1000);
    await say(host, TASK, 2000);
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [lenaEmail] }], minutes: 10 });
    const [design = ''] = await roomIds(host);
    await inPlace(kofi, design);
    await say(host, SECRET, 3000);
    // The model says it comes from all four lines. The fourth was said with Kofi away in a room.
    h.near.cite(TASK, [ONE, TWO, SECRET]);
    const stop = host.watchNotes();
    const task = followUp((await notesOf(host)).next, TASK);
    stop();
    expect(task.evidence).toHaveLength(3);
    await host.tickFollowUp(task.id, true);

    // Back in the main room, the model no longer lists it, so only the tick keeps it there.
    h.near.reword(TASK, '');
    host.closeRooms();
    await inPlace(kofi, 'main');
    await later(kofi);
    const back = kofi.watchNotes();
    const after = await notesOf(kofi);
    back();
    expect(after.read.lines).toBe(3);
    expect(after.next).toEqual([]);

    // It's still done in the note, where everyone reads the lines it rests on.
    h.near.reword(TASK, null);
    h.near.cite(TASK, null);
    const ended = await host.leave();
    expect((await written(org.api, ended?.pendingNoteId)).actions).toEqual([expect.objectContaining({ text: 'Book the hall by Friday', done: true })]);
  });

  it('won’t let anyone tick notes that read what they may not, whoever they are', async () => {
    const late = unique('priya');
    const { host, kofi, kofiEmail, lenaEmail, code: c } = await roomsCall([late]);
    const TASK = 'Kofi will book the hall by Friday.';
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [lenaEmail] }], minutes: 10 });
    const [design = ''] = await roomIds(host);
    await inPlace(kofi, design);
    await sayNow(host, TASK, 1000);
    const stop = host.watchNotes();
    const task = followUp((await notesOf(host)).next, TASK);
    stop();

    // Invited, and in the main room, but they came after that was said with the rooms open: those notes aren't theirs.
    const priya = await (await account(late)).api.calls.join(c, { mic: true, cam: false });
    await inPlace(priya, 'main');
    await priya.refresh();
    expect(priya.getSnapshot().liveNotes.notes).toBeNull();
    expect(code(await priya.tickFollowUp(task.id, true).catch((e: unknown) => e))).toBe('not-found');
    await host.refresh();
    expect(followUp((await notesOf(host)).next, TASK).done).toBe(false);
    await host.tickFollowUp(task.id, true);
    await notesOf(host, (n) => n.next[0]?.done === true);
  });

  it('stops a paused room’s notes while the others go on', async () => {
    const { host, kofi, lena, kofiEmail, lenaEmail } = await roomsCall();
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [lenaEmail] }], minutes: 10 });
    const [design = '', support = ''] = await roomIds(host);
    await inPlace(kofi, design);
    await inPlace(lena, support);
    await scribing(kofi, design);
    await scribing(lena, support);
    await kofi.transcribe(speech('We decided on blue buttons.', 0, 2000), kofi.ticket.identity);
    const before = runs();
    await host.pauseRoom(design, true);
    await settle(kofi, (s) => s.capture.room?.mode === 'paused');
    const stop = kofi.watchNotes();
    await sleep(400);
    stop();
    expect(runs()).toBe(before);
    expect(kofi.getSnapshot().liveNotes.notes).toBeNull();
    await lena.transcribe(speech('We decided on a new reply.', 0, 2000), lena.ticket.identity);
    const go = lena.watchNotes();
    await notesOf(lena);
    go();
    expect(runs()).toBe(before + 1);
    await host.pauseRoom(design, false);
    await settle(kofi, (s) => s.capture.room?.mode === 'on');
    const resumed = kofi.watchNotes();
    await notesOf(kofi);
    resumed();
    await host.leave();
  });
});

describe('ticking a follow-up', () => {
  const DECK = 'Kofi will send the deck to legal by Friday.';
  const ROOM = 'Priya will book the room by Monday.';

  it('is done for everyone, nudges the room, and stays through a refresh that rewords it', async () => {
    const { host, kofi } = await twoInCall();
    await say(host, DECK);
    const stop = host.watchNotes();
    const first = await notesOf(host);
    const deck = followUp(first.next, DECK);
    expect(deck.done).toBe(false);

    // Anyone in the call who gets the notes. It reaches the others as every change to the call does.
    open.push(await connect(await host.room(), { sending: host.crypto }));
    const nudged = open[0]?.nextNudge();
    await kofi.tickFollowUp(deck.id, true);
    await nudged;
    expect(followUp(kofi.getSnapshot().liveNotes.notes?.next ?? [], DECK).done).toBe(true);
    expect(followUp((await notesOf(host, (n) => n.next[0]?.done === true)).next, DECK).done).toBe(true);

    // The next run words it differently, and hears something new: the same item keeps its ID and its tick; the new one has its own.
    const SAID = 'Send the deck over to legal before Friday';
    h.near.reword(DECK, SAID);
    await say(host, ROOM, 4000);
    await later(host);
    const second = await notesOf(host, (n) => n.read.lines === 2);
    expect(texts(second.next)).toEqual([SAID, ROOM]);
    expect(followUp(second.next, SAID)).toMatchObject({ id: deck.id, done: true });
    const room = followUp(second.next, ROOM);
    expect(room).toMatchObject({ done: false });
    expect(room.id).not.toBe(deck.id);

    // Taking a tick back is done for everyone too, and keeps through a refresh as well.
    await host.tickFollowUp(deck.id, false);
    expect(followUp((await notesOf(kofi, (n) => n.next.find((x) => x.id === deck.id)?.done === false)).next, SAID).id).toBe(deck.id);
    await host.tickFollowUp(deck.id, true);

    // A tick that lands while the notes are being written isn't lost when they're saved.
    h.near.slowNext(900);
    const before = runs();
    await say(host, C, 8000);
    await later(host);
    await waitFor(() => runs() > before, 'a refresh under way');
    await kofi.tickFollowUp(room.id, true);
    const third = await notesOf(kofi, (n) => n.read.lines === 3);
    expect(third.next.map((x) => [x.id, x.done])).toEqual([[deck.id, true], [room.id, true]]);
    stop();
    await host.leave();
    h.near.reword(DECK, null);
  });

  it('keeps a ticked item the model no longer lists, drops one nobody ticked, and gives it back its ID if it returns', async () => {
    const { host, kofi } = await twoInCall();
    await say(host, DECK);
    await say(host, ROOM, 4000);
    const stop = host.watchNotes();
    const first = await notesOf(host);
    const [deck, room] = [followUp(first.next, DECK), followUp(first.next, ROOM)];
    await kofi.tickFollowUp(deck.id, true);
    h.near.reword(DECK, '');
    h.near.reword(ROOM, '');
    await say(host, A, 8000);
    await later(host);
    const second = await notesOf(host, (n) => n.read.lines === 3);
    expect(second.next.map((x) => [x.id, x.text, x.done])).toEqual([[deck.id, DECK, true]]);
    h.near.reword(ROOM, null);
    h.near.reword(DECK, null);
    await say(host, C, 12_000);
    await later(host);
    const third = await notesOf(host, (n) => n.read.lines === 4);
    expect(third.next.map((x) => [x.id, x.done])).toEqual([[deck.id, true], [room.id, false]]);
    stop();
    await host.leave();
  });

  it('tells something reworded from something else that came from the same line', async () => {
    const { host } = await twoInCall();
    const BOTH = 'Kofi will send the deck and book the hall by Friday.';
    await say(host, BOTH);
    const stop = host.watchNotes();
    const deck = followUp((await notesOf(host)).next, BOTH);
    await host.tickFollowUp(deck.id, true);
    // Worded afresh, it's the same item: it says the same words, from the same line.
    h.near.reword(BOTH, 'Send the deck and book the hall');
    await say(host, A, 4000);
    await later(host);
    expect((await notesOf(host, (n) => n.read.lines === 2)).next).toEqual([expect.objectContaining({ id: deck.id, text: 'Send the deck and book the hall', done: true })]);
    // Something else from that line, with nothing in common, isn't: the tick stays with what was ticked.
    h.near.reword(BOTH, 'Water the plants');
    await say(host, C, 8000);
    await later(host);
    const n = await notesOf(host, (x) => x.read.lines === 3);
    expect(n.next.map((x) => [x.text, x.done])).toEqual([['Send the deck and book the hall', true], ['Water the plants', false]]);
    expect(n.next[1]?.id).not.toBe(deck.id);
    stop();
    h.near.reword(BOTH, null);
    await host.leave();
  });

  it('never hands a tick to another follow-up with most of its words', async () => {
    const { host } = await twoInCall();
    const REPORT = 'Kofi will send the report to legal by Friday.';
    const INVOICE = 'Kofi will send the invoice to legal by Friday.';
    await say(host, REPORT);
    const stop = host.watchNotes();
    const report = followUp((await notesOf(host)).next, REPORT);
    await host.tickFollowUp(report.id, true);
    // The model stops listing the report, and hears the invoice a moment later, in nearly the same words.
    h.near.reword(REPORT, '');
    await say(host, INVOICE, 3000);
    await later(host);
    const n = await notesOf(host, (x) => x.read.lines === 2);
    stop();
    h.near.reword(REPORT, null);
    expect(n.next.map((x) => [x.text, x.done])).toEqual([[REPORT, true], [INVOICE, false]]);
    expect(followUp(n.next, REPORT).id).toBe(report.id);
    expect(followUp(n.next, INVOICE).id).not.toBe(report.id);
    await host.leave();
  });

  it('tells two things from one sentence apart, however many words they share', async () => {
    const { host } = await twoInCall();
    const BOTH = 'Kofi will send the report and the invoice to legal by Friday.';
    await say(host, BOTH);
    h.near.reword(BOTH, 'Send the report to legal by Friday');
    const stop = host.watchNotes();
    const report = (await notesOf(host)).next[0];
    await host.tickFollowUp(report?.id ?? '', true);
    // The next run lists the other thing that sentence said, instead.
    h.near.reword(BOTH, 'Send the invoice to legal by Friday');
    await say(host, A, 3000);
    await later(host);
    const n = await notesOf(host, (x) => x.read.lines === 2);
    stop();
    h.near.reword(BOTH, null);
    expect(n.next.map((x) => [x.text, x.done])).toEqual([['Send the report to legal by Friday', true], ['Send the invoice to legal by Friday', false]]);
    await host.leave();
  });

  it('tells follow-ups apart by their numbers', async () => {
    const { host } = await twoInCall();
    const [SEVEN, EIGHT] = ['Kofi will finish job 7 by Friday.', 'Kofi will finish job 8 by Friday.'];
    await say(host, SEVEN);
    const stop = host.watchNotes();
    const seven = followUp((await notesOf(host)).next, SEVEN);
    await host.tickFollowUp(seven.id, true);
    h.near.reword(SEVEN, '');
    await say(host, EIGHT, 3000);
    await later(host);
    const n = await notesOf(host, (x) => x.read.lines === 2);
    stop();
    h.near.reword(SEVEN, null);
    expect(n.next.map((x) => [x.text, x.done])).toEqual([[SEVEN, true], [EIGHT, false]]);
    await host.leave();
  });

  it('keeps its IDs in text without spaces', async () => {
    const { host } = await twoInCall();
    const [LINE, OTHER] = ['田中さんは資料を法務に送ります。', '鈴木さんが来週までに見積もりを作ります。'];
    await say(host, LINE);
    const stop = host.watchNotes();
    const first = followUp((await notesOf(host)).next, LINE);
    await host.tickFollowUp(first.id, true);
    const WORDED = '資料を法務に送る';
    h.near.reword(LINE, WORDED);
    await say(host, OTHER, 3000);
    await later(host);
    const n = await notesOf(host, (x) => x.read.lines === 2);
    stop();
    h.near.reword(LINE, null);
    expect(n.next.map((x) => [x.text, x.done])).toEqual([[WORDED, true], [OTHER, false]]);
    expect(followUp(n.next, WORDED).id).toBe(first.id);
    await host.leave();
  });

  it('keeps the newest follow-ups of a long call, and never loses a ticked one', async () => {
    const { host } = await twoInCall();
    const task = (n: number) => `Kofi will finish item ${n} by Friday.`;
    for (let n = 1; n <= 25; n++) await say(host, task(n), n * 400);
    const stop = host.watchNotes();
    const first = await notesOf(host);
    // At most 20 at a time, and they're the newest.
    expect(texts(first.next)).toEqual(Array.from({ length: 20 }, (_, i) => task(i + 6)));
    const oldest = followUp(first.next, task(6));
    await host.tickFollowUp(oldest.id, true);
    await say(host, task(26), 10_400);
    await say(host, task(27), 10_800);
    await later(host);
    const second = await notesOf(host, (n) => n.read.lines === 27);
    stop();
    // The two new ones are in, the oldest unticked ones give way, and what was ticked stays where it was.
    expect(texts(second.next)).toEqual([task(6), ...Array.from({ length: 20 }, (_, i) => task(i + 8))]);
    expect(followUp(second.next, task(6))).toMatchObject({ id: oldest.id, done: true });
    await host.leave();
  });

  it('never takes one person’s follow-up for another’s, however alike their words', async () => {
    const { org, host } = await twoInCall();
    const KOFI = 'Kofi will send the deck to legal by Friday.';
    const PRIYA = 'Priya will send the deck to legal by Friday.';
    await say(host, KOFI);
    const stop = host.watchNotes();
    const kofis = followUp((await notesOf(host)).next, KOFI);
    await host.tickFollowUp(kofis.id, true);
    // The model stops listing Kofi's, and hears the same words from Priya a moment later: that's Priya's own, not ticked.
    h.near.reword(KOFI, '');
    await say(host, PRIYA, 3000);
    await later(host);
    const n = await notesOf(host, (x) => x.read.lines === 2);
    expect(n.next.map((x) => [x.text, x.owner, x.done])).toEqual([[KOFI, 'Kofi', true], [PRIYA, 'Priya', false]]);
    expect(followUp(n.next, PRIYA).id).not.toBe(kofis.id);
    stop();
    // The notes make the same choice: Priya's stays open, and Kofi's tick is its own follow-up.
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);
    h.near.reword(KOFI, null);
    expect(note.actions.map((a) => [a.text, a.owner?.name, a.done])).toEqual([[KOFI, 'Kofi', true], ['Send the deck to legal by Friday', 'Priya', false]]);
  });

  it('refuses what isn’t in the notes here: made-up IDs, another call’s, someone asking to join, and an ended call', async () => {
    const { org, host, kofi, code: c } = await twoInCall();
    await say(host, DECK);
    const stop = kofi.watchNotes();
    const deck = followUp((await notesOf(kofi)).next, DECK);
    stop();
    expect(code(await kofi.tickFollowUp('AAAAAAAAAAAAAAAAAAAAAA', true).catch((e: unknown) => e))).toBe('not-found');
    expect(code(await kofi.tickFollowUp('x'.repeat(65), true).catch((e: unknown) => e))).toBe('invalid');

    // The same organizer's other call, and another account's: a follow-up of this call isn't theirs to tick.
    const sameOrganizer = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    expect(code(await sameOrganizer.tickFollowUp(deck.id, true).catch((e: unknown) => e))).toBe('not-found');
    await sameOrganizer.leave();
    const org2 = await account();
    const theirs = await org2.api.calls.join((await org2.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    await inGroup(theirs);
    await theirs.transcribe(speech(A, 0, 0), theirs.ticket.identity);
    const s = theirs.watchNotes();
    await notesOf(theirs);
    s();
    expect(code(await theirs.tickFollowUp(deck.id, true).catch((e: unknown) => e))).toBe('not-found');
    const raw = await fetch(`${h.baseUrl}/v1/live/calls/${host.ticket.callId}/actions`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-alcove-call': theirs.ticket.pass }, body: JSON.stringify({ type: 'follow-up', id: deck.id, done: true }) });
    expect(raw.status).toBe(401);
    await theirs.leave();

    const waiting = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Kim' });
    expect(code(await waiting.tickFollowUp(deck.id, true).catch((e: unknown) => e))).toBe('forbidden');
    expect((await notesOf(kofi)).next[0]?.done).toBe(false);
    await host.leave();
    expect(code(await host.tickFollowUp(deck.id, true).catch((e: unknown) => e))).toBe('conflict');
  });
});

describe('into the note', () => {
  const DECK = 'Kofi will send the deck to legal by Friday.';
  const ROOM = 'Kofi will book the room by Monday.';
  const PLANTS = 'Kofi will water the plants by Tuesday.';
  const LATER = 'Kofi will update the plan by Thursday.';

  it('makes what was ticked done in the note, reworded or not, and nothing else, with who ticked it', async () => {
    const { org, host, kofi, invited, email } = await twoInCall();
    await say(host, DECK);
    await say(host, ROOM, 3000);
    await say(host, PLANTS, 6000);
    await say(host, LATER, 9000);
    const stop = kofi.watchNotes();
    const seen = await notesOf(kofi);
    stop();
    await kofi.tickFollowUp(followUp(seen.next, DECK).id, true);
    await kofi.tickFollowUp(followUp(seen.next, PLANTS).id, true);
    await host.tickFollowUp(followUp(seen.next, ROOM).id, true);
    await host.tickFollowUp(followUp(seen.next, ROOM).id, false);
    await kofi.tickFollowUp(followUp(seen.next, LATER).id, true);

    // The notes word the deck afresh, as a model does, and leave out the plants altogether. Only the moment and a few
    // words tie the deck to what was ticked. The plan is written as the fake hears it: a few of the same words.
    const WORDED = 'Legal gets the deck from Kofi by Friday';
    h.near.reword(DECK, WORDED);
    h.near.reword(PLANTS, '');
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);
    h.near.reword(DECK, null);
    h.near.reword(PLANTS, null);

    expect(note.actions.map((a) => [a.text, a.done])).toEqual([[WORDED, true], ['Book the room by Monday', false], [PLANTS, true], ['Update the plan by Thursday', true]]);
    const deck = note.actions.find((a) => a.text === WORDED);
    expect(deck?.changes).toEqual([{ by: { name: expect.any(String), email }, at: expect.any(String), what: 'done' }]);
    // The notes never listed the plants: ticked, it's in the note all the same, as it was said, done, with its moment.
    const plants = note.actions.find((a) => a.text === PLANTS);
    expect(plants).toMatchObject({ done: true, due: 'Tuesday', owner: { name: 'Kofi' }, takenOn: false, changes: [{ what: 'done' }] });
    expect(plants?.at).toBe(note.transcript?.find((l) => l.text === PLANTS)?.at);
    // Everyone who has the note reads it so, and it isn't among what's open.
    expect((await invited.api.notes.get(note.id)).actions.map((a) => a.done)).toEqual(note.actions.map((a) => a.done));
    expect((await org.api.notes.list()).find((n) => n.id === note.id)).toMatchObject({ openActions: 1, totalActions: 4 });

    // Writing the notes again keeps them done, as anything someone settled.
    await org.api.notes.correctLine(note.id, note.transcript?.[0]?.id ?? '', { text: DECK.replace('deck', 'slides') });
    await org.api.notes.rewrite(note.id);
    await settleNote(org.api, note.id, (n) => !n.writingAgain);
    const again = await org.api.notes.get(note.id);
    expect(again.actions.filter((a) => a.done).map((a) => a.text)).toEqual(expect.arrayContaining([WORDED, PLANTS]));
    expect(again.actions.filter((a) => a.done)).toHaveLength(3);
  });

  it('finds what was ticked in notes that keep no transcript, from the lines the same save takes away', async () => {
    const org = await account();
    const email = unique('kofi');
    const { code: c } = await org.api.meetings.create({
      title: 'Supplier review', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [email], notes: 'on', choices: { ...DEFAULT_NOTES_CHOICES, keepTranscript: false }
    });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const kofi = await (await account(email)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(kofi);
    for (const at of [0, 1, 2, 3]) await host.appendAudio(piece(audioBytes('no-transcript'), 0, at));
    await say(host, DECK);
    const stop = kofi.watchNotes();
    const seen = await notesOf(kofi);
    stop();
    await kofi.tickFollowUp(followUp(seen.next, DECK).id, true);

    // Worded so that only the line behind it says it's the same thing.
    const WORDED = 'Legal gets the deck from Kofi by Friday';
    h.near.reword(DECK, WORDED);
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);
    h.near.reword(DECK, null);
    expect(note.actions.map((a) => [a.text, a.done])).toEqual([[WORDED, true]]);
    expect(note.transcript).toEqual([]);
    const o = await openOwner(h.deps, org.session.ownerId, undefined);
    expect((await getItem(o, h.pool, 'note', note.id, NoteManifest, 'Those notes')).manifest.ticked).toEqual([]);
  });

  it('marks nothing else done when the notes leave out what was ticked', async () => {
    const { org, host, kofi } = await twoInCall();
    const [BANK, CLIENT] = ['Kofi will call the bank by Friday.', 'Kofi will call the client by Friday.'];
    await say(host, BANK);
    await say(host, CLIENT, 1000);
    const stop = kofi.watchNotes();
    const seen = await notesOf(kofi);
    stop();
    await kofi.tickFollowUp(followUp(seen.next, BANK).id, true);
    // The notes never list the bank. The client, a second later and in nearly the same words, isn't it.
    h.near.reword(BANK, '');
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);
    h.near.reword(BANK, null);
    expect(note.actions.map((a) => [a.text, a.done])).toEqual([[BANK, true], ['Call the client by Friday', false]]);
  });

  it('finds what was ticked in notes written in another language, by the moment it came up', async () => {
    const { org, host, kofi } = await twoInCall();
    await org.api.account.updatePreferences({ notesLanguage: 'fr' });
    await say(host, DECK);
    await say(host, ROOM, 6000);
    const stop = kofi.watchNotes();
    const seen = await notesOf(kofi);
    stop();
    await kofi.tickFollowUp(followUp(seen.next, DECK).id, true);
    const [SENT, BOOKED] = ['Envoyer la présentation au service juridique avant vendredi', 'Réserver la salle avant lundi'];
    h.near.reword(DECK, SENT);
    h.near.reword(ROOM, BOOKED);
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);
    h.near.reword(DECK, null);
    h.near.reword(ROOM, null);
    expect(h.near.instructions.at(-1)).toContain('Write in French.');
    expect(note.actions.map((a) => [a.text, a.done])).toEqual([[SENT, true], [BOOKED, false]]);
  });

  it('goes by the moment only when it’s the one candidate there', async () => {
    const { org, host, kofi } = await twoInCall();
    await org.api.account.updatePreferences({ notesLanguage: 'fr' });
    await say(host, DECK);
    await say(host, ROOM, 300);
    const stop = kofi.watchNotes();
    const seen = await notesOf(kofi);
    stop();
    await kofi.tickFollowUp(followUp(seen.next, DECK).id, true);
    const [SENT, BOOKED] = ['Envoyer la présentation au service juridique avant vendredi', 'Réserver la salle avant lundi'];
    h.near.reword(DECK, SENT);
    h.near.reword(ROOM, BOOKED);
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);
    h.near.reword(DECK, null);
    h.near.reword(ROOM, null);
    // Two follow-ups at that second, and no words to tell them by: neither is marked, and the tick stands on its own.
    expect(note.actions.filter((a) => a.done).map((a) => a.text)).toEqual([DECK]);
    expect(note.actions.filter((a) => !a.done).map((a) => a.text).sort()).toEqual([BOOKED, SENT].sort());
  });

  it('finds what was ticked in text without spaces', async () => {
    const { org, host, kofi } = await twoInCall();
    const LINE = '田中さんが金曜日までに資料を法務に送ります。';
    await say(host, LINE);
    const stop = kofi.watchNotes();
    const seen = await notesOf(kofi);
    stop();
    await kofi.tickFollowUp(followUp(seen.next, LINE).id, true);
    const WORDED = '資料を金曜日までに法務へ送る';
    h.near.reword(LINE, WORDED);
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);
    h.near.reword(LINE, null);
    expect(note.actions.map((a) => [a.text, a.done])).toEqual([[WORDED, true]]);
  });

  it('waits for notes that couldn’t be written, and marks them done when they are', async () => {
    const { org, host, kofi } = await twoInCall();
    await say(host, DECK);
    const stop = kofi.watchNotes();
    const deck = followUp((await notesOf(kofi)).next, DECK);
    stop();
    await kofi.tickFollowUp(deck.id, true);
    // Three unusable answers, and the note is finished without notes.
    h.near.failNext(3, 'prose');
    const ended = await host.leave();
    const noteId = ended?.pendingNoteId ?? '';
    const dueNow = () => h.pool.query(`UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = (SELECT owner_id FROM items WHERE item_id = $1)`, [noteId]);
    const until = Date.now() + 30_000;
    for (;;) {
      await dueNow();
      await maintain(h.deps);
      if ((await org.api.notes.get(noteId)).status === 'ready') break;
      if (Date.now() > until) throw new Error('timed out waiting for the note to finish');
      await sleep(50);
    }
    expect((await org.api.notes.get(noteId)).actions).toEqual([]);
    // The organizer has them written after all: what was ticked is done then.
    await org.api.notes.rewrite(noteId);
    const n = await settleNote(org.api, noteId, (x) => !x.writingAgain && x.actions.length > 0);
    expect(n.actions).toEqual([expect.objectContaining({ text: 'Send the deck to legal by Friday', done: true })]);
  });

  async function settleNote(api: Awaited<ReturnType<typeof account>>['api'], id: string, pred: (n: Note) => boolean): Promise<Note> {
    const until = Date.now() + 30_000;
    for (;;) {
      const n = await api.notes.get(id);
      if (pred(n)) return n;
      if (Date.now() > until) throw new Error('timed out waiting for the note');
      await sleep(40);
    }
  }
});

describe('when notes are off or paused', () => {
  it('sends nothing to the notes model and keeps what was written readable, and ticks still count', async () => {
    const { host, kofi } = await twoInCall();
    await say(host, 'Kofi will send the deck by Friday.');
    const stop = kofi.watchNotes();
    const seen = await notesOf(kofi);
    const id = seen.next[0]?.id ?? '';
    const before = runs();

    // Paused: nothing reaches the AI, however long it's been and whoever is watching.
    await say(host, A, 3000);
    await host.pause();
    await settle(kofi, (s) => s.capture.mode === 'paused');
    await later(kofi);
    await sleep(400);
    expect(runs()).toBe(before);
    expect(await look(h.baseUrl, kofi)).toEqual({ status: 200, body: { refreshed: false } });
    await kofi.refresh();
    expect(kofi.getSnapshot().liveNotes).toEqual({ notes: seen, writing: false, error: null });
    await kofi.tickFollowUp(id, true);
    await notesOf(host, (n) => n.next[0]?.done === true);

    // Back on: what was said before the pause is read at the next look.
    await host.resume();
    await settle(kofi, (s) => s.capture.mode === 'on');
    await later(kofi);
    await notesOf(kofi, (n) => n.read.lines === 2);
    expect(runs()).toBe(before + 1);

    // Off: the same.
    await host.transcribe(speech(B, 1, 1000), host.ticket.identity);
    await host.setNotes(false);
    await settle(kofi, (s) => s.capture.mode === 'off');
    await later(kofi);
    await sleep(400);
    expect(runs()).toBe(before + 1);
    expect(await look(h.baseUrl, kofi)).toEqual({ status: 200, body: { refreshed: false } });
    expect((await notesOf(host)).read.lines).toBe(2);
    expect((await notesOf(host)).next[0]?.done).toBe(true);
    stop();
    await host.leave();
  });

  it('has nothing to read in a call that never had notes on, and refuses nobody for looking', async () => {
    const { host, kofi } = await twoInCall('off');
    const before = runs();
    expect((await look(h.baseUrl, kofi)).body).toEqual({ refreshed: false });
    expect(await notesRows(host.ticket.callId)).toBe(0);
    await kofi.refresh();
    expect(kofi.getSnapshot().liveNotes).toEqual({ notes: null, writing: false, error: null });
    expect(code(await kofi.tickFollowUp('AAAAAAAAAAAAAAAAAAAAAA', true).catch((e: unknown) => e))).toBe('not-found');
    expect(runs()).toBe(before);
    await host.leave();
    expect((await look(h.baseUrl, host)).status).toBe(409);
  });
});

describe('what stays', () => {
  it('still opens a call and a note from before live notes were kept', async () => {
    const { org, host, kofi } = await twoInCall();
    // A note as the previous release wrote it: no `ticked` in its manifest. Nothing about the call changed; it just has no row of notes yet.
    const noteId = host.getSnapshot().notes.noteId ?? '';
    const o = await openOwner(h.deps, org.session.ownerId, undefined);
    const item = await getItem(o, h.pool, 'note', noteId, NoteManifest, 'Those notes');
    const { ticked: _dropped, ...before } = item.manifest;
    void _dropped;
    await saveRevision(o, h.pool, noteId, item.revisionId, before);
    expect(await notesRows(host.ticket.callId)).toBe(0);
    await say(host, 'Kofi will send the deck by Friday.');
    expect((await settle(kofi, (s) => s.transcript.length === 1)).liveNotes).toEqual({ notes: null, writing: false, error: null });
    // The first look makes its row, and everything carries on from there.
    const stop = kofi.watchNotes();
    const seen = await notesOf(kofi);
    stop();
    await kofi.tickFollowUp(seen.next[0]?.id ?? '', true);
    const ended = await host.leave();
    expect((await written(org.api, ended?.pendingNoteId)).actions).toEqual([expect.objectContaining({ text: 'Send the deck by Friday', done: true })]);
  });

  it('won’t delete a note while its call is live, and deletes it as ever once the call has ended', async () => {
    const { org, host, kofi } = await twoInCall();
    await say(host, 'Kofi will send the deck by Friday.');
    const stop = kofi.watchNotes();
    const seen = await notesOf(kofi);
    stop();
    const noteId = host.getSnapshot().notes.noteId ?? '';
    const refused = await org.api.notes.delete(noteId).catch((e: unknown) => e);
    expect([code(refused), said(refused)]).toEqual(['conflict', 'This call is still going. You can delete its notes once it ends.']);
    // Nothing changed: everyone reads the same notes, and the call ends as ever.
    await kofi.refresh();
    expect(kofi.getSnapshot().liveNotes.notes).toEqual(seen);
    const ended = await host.leave();
    expect(ended?.pendingNoteId).toBe(noteId);
    await written(org.api, noteId);
    await org.api.notes.delete(noteId);
    expect(code(await org.api.notes.get(noteId).catch((e: unknown) => e))).toBe('not-found');
  });

  it('goes when the call ends, and with the account; a call ended by an earlier release is swept', async () => {
    const { host, kofi } = await twoInCall();
    await say(host, A);
    const stop = kofi.watchNotes();
    await notesOf(kofi);
    stop();
    expect(await notesRows(host.ticket.callId)).toBe(1);
    await host.leave();
    expect(await notesRows(host.ticket.callId)).toBe(0);

    // A refresh still on its way when the call ends finds nothing to save into, and nothing comes back.
    const late = await twoInCall();
    await say(late.host, A);
    h.near.slowNext(600);
    const before = runs();
    const look1 = look(h.baseUrl, late.kofi);
    await waitFor(() => runs() > before, 'a refresh under way');
    await late.host.leave();
    expect((await look1).body).toEqual({ refreshed: false });
    expect(await notesRows(late.host.ticket.callId)).toBe(0);

    // An earlier release knows nothing of live notes, so a call it ended leaves them behind until upkeep.
    const old = await twoInCall();
    await say(old.host, A);
    const s = old.kofi.watchNotes();
    await notesOf(old.kofi);
    s();
    await h.pool.query(`UPDATE calls SET state = 'ended', ended_at = now() WHERE call_id = $1`, [old.host.ticket.callId]);
    await maintain(h.deps);
    expect(await notesRows(old.host.ticket.callId)).toBe(0);

    // Deleting the organizer's account takes a live call's notes with it.
    const gone = await twoInCall();
    await say(gone.host, A);
    const g = gone.kofi.watchNotes();
    await notesOf(gone.kofi);
    g();
    await gone.org.api.account.delete();
    expect(await notesRows(gone.host.ticket.callId)).toBe(0);
  });

  it('keeps nothing readable: not in the row, the receipts, objects, logs or on the wire, and a record is bound to where it lies', async () => {
    const { host, kofi, org } = await twoInCall();
    const from = h.logs.length;
    await say(host, 'CANARY-LIVENOTE we agreed to sell the lighthouse.');
    await say(host, 'CANARY-FOLLOWUP Kofi will paint the lighthouse by Friday.', 4000);
    const stop = kofi.watchNotes();
    const seen = await notesOf(kofi);
    stop();
    await kofi.tickFollowUp(seen.next[0]?.id ?? '', true);
    expect(seen.next[0]?.text).toContain('CANARY-FOLLOWUP');

    const dump = String((await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (
      SELECT row_to_json(x)::text AS t FROM call_notes x UNION ALL SELECT row_to_json(x)::text FROM calls x UNION ALL
      SELECT row_to_json(x)::text FROM operations x UNION ALL SELECT row_to_json(x)::text FROM transcript_clips x) q`)).rows[0]?.all ?? '');
    expect(dump).toContain(host.ticket.callId);
    const logs = h.logs.slice(from).join('');
    const canaries = ['CANARY-LIVENOTE', 'CANARY-FOLLOWUP', 'lighthouse', 'Friday'];
    for (const canary of canaries) {
      for (const enc of encodings(canary)) {
        expect(dump.includes(enc), `${canary} as ${enc} in rows`).toBe(false);
        expect(logs.includes(enc), `${canary} as ${enc} in logs`).toBe(false);
      }
    }
    for await (const obj of h.objects.list()) {
      const bytes = Buffer.from(await h.objects.get(obj.id));
      for (const canary of canaries.slice(0, 2)) for (const enc of encodings(canary)) expect(bytes.includes(Buffer.from(enc)), `${canary} in ${obj.id}`).toBe(false);
    }
    // Only the notes model read it: sealed on the wire, to its verified key.
    const wire = Buffer.concat(h.near.received.map((r) => r.body));
    for (const canary of canaries.slice(0, 2)) for (const enc of encodings(canary)) expect(wire.includes(Buffer.from(enc)), `${canary} as ${enc} on the wire`).toBe(false);
    expect(h.near.calls.at(-1)).toMatchObject({ encryption: 'ohttp', key: h.near.keys().notes });

    // Copied to another part of the same call, or another call of the same organizer, the record doesn't open.
    const sealed = (await h.pool.query<{ notes_ciphertext: Buffer }>('SELECT notes_ciphertext FROM call_notes WHERE call_id = $1', [host.ticket.callId])).rows[0]?.notes_ciphertext;
    const other = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    await h.pool.query(`INSERT INTO call_notes (owner_id, call_id, place, notes_ciphertext) VALUES ($1, $2, 'main', $3)`, [org.session.ownerId, other.ticket.callId, sealed]);
    const read = await fetch(`${h.baseUrl}/v1/live/calls/${other.ticket.callId}`, { headers: { origin: ORIGIN, 'x-alcove-call': other.ticket.pass } });
    expect(read.status).toBe(403);
    await h.pool.query('DELETE FROM call_notes WHERE call_id = $1', [other.ticket.callId]);
    await other.leave();

    // Once the call ends, the tick goes into the note, sealed with the rest, and the row goes.
    const ended = await host.leave();
    await written(org.api, ended?.pendingNoteId);
    const after = String((await h.pool.query(`SELECT string_agg(row_to_json(x)::text, ' ') AS all FROM revisions x`)).rows[0]?.all ?? '');
    for (const enc of encodings('CANARY-FOLLOWUP')) expect(after.includes(enc)).toBe(false);
  });
});
