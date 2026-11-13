/**
 * A call's shared live notes: one set for each part of the call, kept sealed on the server and refreshed at most every
 * 30 seconds while someone is watching, in one run however many are; who may read what of them (guests, rooms); ticking
 * an explicitly accepted follow-up for everyone, through model suggestions and into the note; adding one nobody said; what stops them
 * (notes off, paused); and that nothing readable is left anywhere. The real API over HTTP via @alcove/api-http, real Postgres, the object store,
 * the local LiveKit server, and the stand-in NEAR AI, which says which follow-up is which as the real one is asked to,
 * can propose different wording, without changing an accepted task, and can get matching wrong.
 */
import { AlcoveApiError, DEFAULT_NOTES_CHOICES, type AudioPiece, type CallSession, type CallState, type LiveFollowUp, type LiveNotes, type Note, type TranscriptClip } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openJson, sealJson, stateKey, toJson } from '../../crypto';
import { maintain } from '../../maintenance';
import { NoteManifest } from '../notes/service';
import { standing } from '../billing/meter';
import { openOwner } from '../../owners';
import { speechWav } from '../../testing/fake-near';
import { ORIGIN, startHarness, type Harness } from '../../testing/harness';
import { connect, disposeLiveKit, type TestParticipant } from '../../testing/livekit';
import { getItem, saveRevision } from '../../vault';

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
/**
 * Does `act` once a refresh of live notes that reads `said` reaches the notes model, which answers it only after `act`.
 * Anything else it's asked meanwhile goes by: another call's notes, still being written in the background, or the
 * refresh of another call's notes that was on its way when an earlier test stopped.
 */
function whileRefreshing(said: string, act: () => Promise<void>): void {
  const hold = async (): Promise<void> => {
    if (!h.near.instructions.at(-1)?.startsWith('You help someone catch up') || !h.near.prompts.at(-1)?.includes(said)) { h.near.holdNext(hold); return; }
    await act();
  };
  h.near.holdNext(hold);
}
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
/** A user explicitly adds one displayed proposal before exercising actual-task behavior. */
async function acceptSuggestion(call: CallSession, text: string): Promise<LiveFollowUp> {
  await call.refresh();
  const proposal = followUp(call.getSnapshot().liveNotes.suggestions, text);
  expect(call.getSnapshot().liveNotes.notes?.next.some((x) => x.id === proposal.id)).toBe(false);
  await call.reviewFollowUp({ id: proposal.id, revision: proposal.revision, decision: 'accept' });
  const state = await settle(call, (x) => x.liveNotes.notes?.next.some((f) => f.id === proposal.id) === true);
  return followUp(state.liveNotes.notes?.next ?? [], text);
}
/** Pending extraction remains visible without being counted as an actual checklist task. */
const proposalsOf = (call: CallSession) => call.getSnapshot().liveNotes.suggestions;
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
    // The model answers only once the other browser has seen the run on its way, so both are looking while it is.
    let meanwhile: CallState | undefined;
    whileRefreshing(C, async () => { meanwhile = await settle(kofi, (s) => s.liveNotes.writing); });
    const stop = [host.watchNotes(), kofi.watchNotes()];
    await waitFor(() => runs() > before, 'the notes model to be asked');
    // Longer than that look waits for (settle's 15 s), so a look that never saw the run says so below.
    await waitFor(() => meanwhile !== undefined, 'the other browser to look while the run is on its way', 20_000);
    expect(meanwhile?.liveNotes.writing).toBe(true);
    const seen = await notesOf(host);
    expect(texts(seen.decided)).toEqual([A]);
    expect(seen.next).toEqual([]);
    expect(proposalsOf(host)).toEqual([expect.objectContaining({ text: B, owner: 'Kofi', due: 'Friday', done: false, id: expect.any(String) })]);
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
    expect(host.getSnapshot().liveNotes).toEqual({ notes: null, added: [], suggestions: [], writing: false, error: null });
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

  it('tells the room, says when it’s writing, and says when it couldn’t, trying again later with the notes as they were', async () => {
    const { host, kofi } = await twoInCall();
    await say(host, A);
    open.push(await connect(await host.room(), { sending: host.crypto }));
    const p = open[0];
    const pushed = p?.nextChange();
    const stop = kofi.watchNotes();
    await pushed;
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
    for (const how of ['empty', 'partial', 'lines'] as const) {
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

  it('is the organizer’s to pay for, whoever is watching, as the notes at the end are', async () => {
    const { org, host, kofi, invited } = await twoInCall();
    const spent = async (ownerId: string) => standing(h.deps, h.pool, ownerId);
    await say(host, A);
    const stop = kofi.watchNotes();
    await notesOf(kofi);
    await say(host, B, 4000);
    await later(kofi);
    await notesOf(kofi, (n) => n.read.lines === 2);
    stop();
    // Kofi watched; the organizer paid, for the transcript and the live notes alike. The invited account never did.
    const during = await spent(org.session.ownerId);
    expect(during.byKind['live-notes']).toBeGreaterThan(0);
    expect(during.byKind['transcript']).toBeGreaterThan(0);
    expect((await spent(invited.session.ownerId)).spentNano).toBe(0);
    const ended = await host.leave();
    await written(org.api, ended?.pendingNoteId);
    const after = await spent(org.session.ownerId);
    expect(after.byKind['notes']).toBeGreaterThan(0);
    expect(after.spentNano).toBeGreaterThan(during.spentNano);
    expect((await spent(invited.session.ownerId)).spentNano).toBe(0);
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
    expect(theirs.next).toEqual([]);
    expect(texts(proposalsOf(sam))).toEqual([SAID]);
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
    expect(full.next).toEqual([]);
    expect(texts(proposalsOf(kofi))).toEqual([SAID]);
    expect(full).toMatchObject({ summary: 'Catching up on 2 lines.', read: { lines: 2, whileHere: false } });
    expect(await notesRows(host.ticket.callId)).toBe(2);
    await sam.refresh();
    expect(sam.getSnapshot().liveNotes.notes).toEqual(theirs);

    // Sam's notes are read-only: a guest ticks nothing, and nobody ticks anything of theirs.
    const samsId = proposalsOf(sam)[0]?.id ?? '';
    const { id } = await acceptSuggestion(kofi, SAID);
    expect(code(await sam.tickFollowUp(id, true).catch((e: unknown) => e))).toBe('forbidden');
    expect(code(await sam.tickFollowUp(samsId, true).catch((e: unknown) => e))).toBe('forbidden');
    expect(code(await kofi.tickFollowUp(samsId, true).catch((e: unknown) => e))).toBe('not-found');
    expect((await notesOf(kofi)).next[0]?.done).toBe(false);
    // What's ticked in everyone's isn't told to the model for Sam, since it comes from what Sam can't read, so Sam's stays as it is.
    await kofi.tickFollowUp(id, true);
    await sam.refresh();
    expect(sam.getSnapshot().liveNotes.notes?.next).toEqual([]);
    expect(proposalsOf(sam)).toEqual([expect.objectContaining({ id: samsId, done: false })]);
    await host.leave();
  });

  it('takes a guest’s own notes and captions out of the guests’ share: past it they stop and say why, and everyone’s go on', async () => {
    // Guests in a call may spend nothing of the organizer's plan here: no questions, and nothing that's for a guest alone.
    await h.setLimit('ai.guests_call_percent', 0);
    try {
      const { org, host, kofi, code: c } = await twoInCall();
      await say(host, 'We agreed on the budget before Sam came.');
      await sleep(1100);
      const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
      await letIn(host, sam);
      await sleep(300);
      const SAID = 'Sam will review the plan by Monday.';
      await sayNow(host, SAID, 6000);
      // Sam's own notes, which read less than everyone's, would be for Sam alone: nothing reaches the model, and they say why.
      const before = runs();
      const stop = sam.watchNotes();
      const shown = await settle(sam, (x) => x.liveNotes.error !== null);
      stop();
      expect(shown.liveNotes).toMatchObject({ notes: null, error: 'These notes aren’t being updated: guests in this call have used as much of the organizer’s plan as it allows them.' });
      expect(runs()).toBe(before);
      // Captions in another language are Sam's alone too: refused in the guests' words, with nothing sent.
      const line = (await settle(sam, (x) => x.transcript.some((l) => l.text === SAID))).transcript.find((l) => l.text === SAID)?.id ?? 'no line';
      const sent = h.near.calls.length;
      const refused = await sam.translate([line], 'es').catch((e: unknown) => e);
      expect([code(refused), said(refused)]).toEqual(['plan-limit', 'Guests in this call have used as much of the organizer’s plan as it allows them.']);
      expect(h.near.calls.length).toBe(sent);
      // Everyone's notes and someone invited's captions are the call's, for everyone, and go on, the organizer paying as ever.
      const k = kofi.watchNotes();
      expect(texts((await notesOf(kofi)).decided)).toContain('We agreed on the budget before Sam came.');
      k();
      expect(runs()).toBe(before + 1);
      expect(await kofi.translate([line], 'es')).toEqual([{ id: line, text: `[Spanish] ${SAID}` }]);
      // What's translated already costs nothing, so Sam reads it.
      expect(await sam.translate([line], 'es')).toEqual([{ id: line, text: `[Spanish] ${SAID}` }]);
      expect((await standing(h.deps, h.pool, org.session.ownerId)).stopped).toBe(false);
      await host.leave();
    } finally {
      await h.resetLimits();
    }
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

  const FIRST = 'We agreed on the first plan.';
  /** How many looks have read the transcript. */
  const readsSoFar = () => h.logs.filter((l) => l.includes('reading the transcript for the live notes')).length;
  /** An organizer and a guest here from the start, with everyone's notes written from the first thing said. */
  async function guestFromTheStart() {
    const org = await account();
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    // The organizer's browser is in the room, as it is in a real call. Otherwise, 25 seconds after they joined, upkeep
    // finds them gone, and with nobody here who can host (a guest can't), ends the call: what a slow runner reaches.
    open.push(await connect(await host.room(), { sending: host.crypto }));
    await host.appendAudio(piece(audioBytes('away'), 0, 0));
    const browser = guestBrowser();
    const sam = await browser.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    await sleep(300);
    await sayNow(host, FIRST, 1000);
    const stop = sam.watchNotes();
    await notesOf(sam);
    stop();
    return { host, browser, sam, code: c };
  }
  /**
   * Transcript positions and presence both round to tenths: once a line is said, waits for a later tick of the call's
   * clock, so someone who comes back now is back after that line. Returns the tick the line was said by.
   */
  async function laterTick(host: CallSession): Promise<number> {
    const awayThrough = (await host.catchUpWindow()).now;
    const until = Date.now() + 15_000;
    while ((await host.catchUpWindow()).now <= awayThrough) {
      if (Date.now() > until) throw new Error('timed out waiting for a later call-clock tick before rejoining');
      await sleep(25);
    }
    return awayThrough;
  }
  /** The guest's page goes, something's said while it's gone, and they're back. */
  async function backAfter(g: { host: CallSession; browser: ReturnType<typeof guestBrowser>; code: string }, sam: CallSession, said: string, atMs: number) {
    sam.closing();
    await gone(g.host, sam);
    await sleep(1200);
    await sayNow(g.host, said, atMs);
    const awayThrough = await laterTick(g.host);
    const back = await g.browser.calls.join(g.code, { mic: true, cam: false, name: 'Sam', previous: sam.ticket.pass });
    await inGroup(back);
    await sleep(300);
    expect((await back.catchUpWindow()).here?.at(-1)?.from).toBeGreaterThan(awayThrough);
    return back;
  }

  it('shows someone their own notes once they’re newer than everyone’s, which they can still read', async () => {
    const g = await guestFromTheStart();
    const back = await backAfter(g, g.sam, 'We agreed on the second plan while Sam was away.', 3000);
    const NOW = 'We agreed on the third plan with Sam back.';
    await sayNow(g.host, NOW, 6000);
    await later(back);

    // Their first run fails: they go on reading what they can, and they're told.
    const before = runs();
    h.near.failNext(1, 'prose');
    const stop = back.watchNotes();
    const failed = await settle(back, (s) => s.liveNotes.error !== null);
    expect(failed.liveNotes.error).toBe(NOT_UPDATED);
    expect(texts(failed.liveNotes.notes?.decided ?? [])).toEqual([FIRST]);
    // It's tried again after the half minute, and meanwhile looks don't read the transcript for it.
    const tried = readsSoFar();
    await sleep(700);
    expect(readsSoFar()).toBe(tried);
    await later(back);
    // Nobody who may read it all is watching, so everyone's notes stay behind. Sam's run reads what Sam may read, and that's what Sam reads.
    const own = await notesOf(back, (n) => n.read.lines === 2);
    expect(texts(own.decided)).toEqual([FIRST, NOW]);
    expect(own.read.whileHere).toBe(true);
    expect(sentSince(before)[1]).not.toContain('second plan');
    await settle(back, (s) => s.liveNotes.error === null);
    expect(back.getSnapshot().liveNotes.error).toBeNull();
    // Inside the half minute it stays at that one run, however often they look, and the transcript isn't read again.
    const read = readsSoFar();
    await sleep(700);
    stop();
    expect(runs()).toBe(before + 2);
    expect(readsSoFar()).toBe(read);
    expect(await notesRows(g.host.ticket.callId)).toBe(2);
    await g.host.leave();
  });

  it('spends nothing on a refresh that would say what someone’s already reading', async () => {
    const g = await guestFromTheStart();
    const back = await backAfter(g, g.sam, 'We agreed on the second plan while Sam was away.', 3000);
    await later(back);
    // Sam may read just what everyone's notes read, so a run for Sam would write them again, and Sam would be shown them
    // either way: however often they look, that's found out once, and no row is made for it.
    const before = runs();
    const read = readsSoFar();
    const stop = back.watchNotes();
    await sleep(700);
    stop();
    expect(runs()).toBe(before);
    expect(readsSoFar()).toBe(read + 1);
    expect(await notesRows(g.host.ticket.callId)).toBe(1);
    expect(texts((await notesOf(back)).decided)).toEqual([FIRST]);
    await g.host.leave();
  });

  it('keeps one row of notes for each person, however often they come and go', async () => {
    const g = await guestFromTheStart();
    let call = g.sam;
    for (let i = 0; i < 3; i++) {
      call = await backAfter(g, call, `We agreed on plan ${i} while Sam was away.`, 3000 + i * 4000);
      const NOW = `We agreed on plan ${i} with Sam back.`;
      await sayNow(g.host, NOW, 5000 + i * 4000);
      await later(call);
      const stop = call.watchNotes();
      const own = await notesOf(call, (n) => n.decided.some((d) => d.text === NOW));
      stop();
      expect(JSON.stringify(own)).not.toContain('while Sam was away');
      expect(await notesRows(g.host.ticket.callId)).toBe(2);
    }
    await g.host.leave();
  });

  it('reads nothing said while someone’s page was gone without a word, when they’re back before Alcove heard it go', async () => {
    const g = await guestFromTheStart();
    // The page goes and its goodbye never reaches Alcove (a crash, a dropped connection, a phone putting the tab to sleep):
    // as far as the call knows, Sam is still in it.
    g.sam.close();
    await sleep(1200);
    const AWAY = 'We agreed on the price while Sam was away.';
    await sayNow(g.host, AWAY, 3000);
    const awayThrough = await laterTick(g.host);
    const back = await g.browser.calls.join(g.code, { mic: true, cam: false, name: 'Sam', previous: g.sam.ticket.pass });
    await inGroup(back);
    await sleep(300);
    expect((await back.catchUpWindow()).here?.at(-1)?.from).toBeGreaterThan(awayThrough);
    const NOW = 'We agreed on the date with Sam back.';
    await sayNow(g.host, NOW, 6000);
    await later(back);
    const before = runs();
    const stop = back.watchNotes();
    const own = await notesOf(back, (n) => n.decided.some((d) => d.text === NOW));
    stop();
    // What was said while the page was last heard from is still Sam's; what came after never reaches the notes model for them.
    expect(texts(own.decided)).toEqual([FIRST, NOW]);
    expect(JSON.stringify(own)).not.toContain('while Sam was away');
    expect(sentSince(before).join('\n')).not.toContain('while Sam was away');
    await g.host.leave();
  });

  it('tells someone with notes of their own when their first ones couldn’t be written', async () => {
    const { host, code: c } = await twoInCall();
    await say(host, 'We agreed on the budget before Sam came.');
    const first = host.watchNotes();
    await notesOf(host);
    first();
    await sleep(1100);
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    await sleep(300);
    const SAID = 'We agreed on what Sam may read.';
    await sayNow(host, SAID, 6000);
    h.near.failNext(1, 'prose');
    const stop = sam.watchNotes();
    const failed = await settle(sam, (s) => s.liveNotes.error !== null);
    expect(failed.liveNotes).toEqual({ notes: null, added: [], suggestions: [], writing: false, error: NOT_UPDATED });
    await later(sam);
    expect(texts((await notesOf(sam)).decided)).toEqual([SAID]);
    await settle(sam, (s) => s.liveNotes.error === null);
    stop();
    expect(sam.getSnapshot().liveNotes.error).toBeNull();
    await host.leave();
  });

  it('gives someone still asking to be let in nothing, and someone removed nothing more', async () => {
    const { host, code: c } = await twoInCall();
    await say(host, A);
    const stop = host.watchNotes();
    await notesOf(host);
    stop();
    const kim = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Kim' });
    expect(kim.getSnapshot().liveNotes).toEqual({ notes: null, added: [], suggestions: [], writing: false, error: null });
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
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [lenaEmail] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
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
    expect(inSupport.next).toEqual([]);
    expect(texts(proposalsOf(lena))).toEqual([SUPPORT]);
    expect(texts(inMain.decided)).toEqual([MAIN, MEANWHILE]);

    // A follow-up is the room's alone: nobody elsewhere finds it, the organizer in the main room included.
    const { id } = await acceptSuggestion(lena, SUPPORT);
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
    expect(note.rooms.find((r) => r.name === 'Support')?.actions).toEqual([expect.objectContaining({ text: SUPPORT, done: true })]);
    expect(await notesRows(host.ticket.callId)).toBe(0);
  });

  const TASK = 'Kofi will book the hall by Friday.';
  const WORDED = 'Book the hall for the surprise party by Friday';
  /** What's ticked in the main room was worded by a run that read what the people who stayed said, though it cites only what everyone read. */
  async function tickedFromWhatKofiMissed() {
    const r = await roomsCall();
    await say(r.host, TASK);
    r.host.openRooms({ rooms: [{ name: 'Design', emails: [r.kofiEmail] }, { name: 'Support', emails: [r.lenaEmail] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
    const [design = ''] = await roomIds(r.host);
    await inPlace(r.kofi, design);
    await say(r.host, 'The hall is for Kofi’s surprise party.', 3000);
    h.near.reword(TASK, WORDED);
    const stop = r.host.watchNotes();
    await notesOf(r.host);
    const task = await acceptSuggestion(r.host, WORDED);
    stop();
    expect(task.evidence).toHaveLength(1);
    await r.host.tickFollowUp(task.id, true);
    h.near.reword(TASK, null);
    r.host.closeRooms();
    await inPlace(r.kofi, 'main');
    return r;
  }

  it('stops showing what was ticked once the notes stop reading what it was written from, and tells the model nothing of it', async () => {
    const { org, host, kofi } = await tickedFromWhatKofiMissed();
    await later(kofi);
    const before = runs();
    const back = kofi.watchNotes();
    const after = await notesOf(kofi);
    back();
    expect(after.read.lines).toBe(1);
    expect(JSON.stringify(after)).not.toContain('surprise');
    expect(JSON.stringify(kofi.getSnapshot().liveNotes)).not.toContain('surprise');
    expect(sentSince(before)[0]).not.toContain('surprise');
    // The model lists it again from what it read, as something new: it wasn't told the one that's ticked.
    expect(after.next).toEqual([]);
    expect(proposalsOf(kofi).map((x) => [x.text, x.done])).toEqual([[TASK, false]]);
    // Nor is it told later, when a refresh reads all the last one did.
    await sayNow(host, C, 6000);
    await later(kofi);
    const next = runs();
    const again = kofi.watchNotes();
    const more = await notesOf(kofi, (n) => n.read.lines === 2);
    again();
    expect(JSON.stringify(more)).not.toContain('surprise');
    expect(JSON.stringify(kofi.getSnapshot().liveNotes)).not.toContain('surprise');
    expect(sentSince(next)[0]).not.toContain('surprise');
    // The tick still goes to the note, where everyone reads what it rests on.
    const ended = await host.leave();
    expect((await written(org.api, ended?.pendingNoteId)).actions).toEqual([expect.objectContaining({ text: WORDED, done: true })]);
  });

  it('stops showing it when a long call pushes it off the list too', async () => {
    const { host, kofi } = await tickedFromWhatKofiMissed();
    // Twenty more, said once they're all back: on the list in its place, so nothing lists it again.
    const task = (n: number) => `Kofi will finish item ${n} by Friday.`;
    for (let n = 1; n <= 20; n++) await sayNow(host, task(n), 4000 + n * 400);
    await later(kofi);
    const back = kofi.watchNotes();
    const after = await notesOf(kofi, (n) => n.read.lines === 21);
    back();
    expect(after.next).toEqual([]);
    expect(texts(proposalsOf(kofi))).toEqual(Array.from({ length: 20 }, (_, i) => task(i + 1)));
    expect(JSON.stringify(after)).not.toContain('surprise');
    await host.leave();
  });

  it('binds a record to its part of the call', async () => {
    const { host, kofi, kofiEmail, lenaEmail } = await roomsCall();
    await say(host, A);
    const first = host.watchNotes();
    await notesOf(host);
    first();
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [lenaEmail] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
    const [design = ''] = await roomIds(host);
    await inPlace(kofi, design);
    await scribing(kofi, design);
    await kofi.transcribe(speech('We decided on blue buttons.', 0, 2000), kofi.ticket.identity);
    const go = kofi.watchNotes();
    await notesOf(kofi);
    go();
    const id = host.ticket.callId;
    await h.pool.query(`UPDATE call_notes a SET notes_ciphertext = m.notes_ciphertext FROM call_notes m WHERE a.call_id = $1 AND a.place = $2 AND m.call_id = $1 AND m.place = 'main'`, [id, design]);
    const read = await fetch(`${h.baseUrl}/v1/live/calls/${id}`, { headers: { origin: ORIGIN, 'x-alcove-call': kofi.ticket.pass } });
    expect(read.status).toBe(403);
    await h.pool.query('DELETE FROM call_notes WHERE call_id = $1 AND place = $2', [id, design]);
    await host.leave();
  });

  it('won’t let anyone tick notes that read what they may not, whoever they are', async () => {
    const late = unique('priya');
    const { host, kofi, kofiEmail, lenaEmail, code: c } = await roomsCall([late]);
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [lenaEmail] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
    const [design = ''] = await roomIds(host);
    await inPlace(kofi, design);
    await sayNow(host, TASK, 1000);
    const stop = host.watchNotes();
    await notesOf(host);
    const task = await acceptSuggestion(host, TASK);
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
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [lenaEmail] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
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

describe('ticking an accepted follow-up', () => {
  const DECK = 'Kofi will send the deck to legal by Friday.';
  const ROOM = 'Priya will book the room by Monday.';

  it('is done for everyone and keeps actual words and ticks while inference offers a change', async () => {
    const { host, kofi } = await twoInCall();
    await say(host, DECK);
    const stop = host.watchNotes();
    expect((await notesOf(host)).next).toEqual([]);
    const deck = await acceptSuggestion(host, DECK);
    open.push(await connect(await host.room(), { sending: host.crypto }));
    const pushed = open[0]?.nextChange();
    await kofi.tickFollowUp(deck.id, true);
    await pushed;
    expect(followUp((await notesOf(host, (n) => n.next[0]?.done === true)).next, DECK).done).toBe(true);

    const SAID = 'Send the deck over to legal before Friday';
    h.near.reword(DECK, SAID);
    await say(host, ROOM, 4000);
    await later(host);
    const second = await notesOf(host, (n) => n.read.lines === 2);
    expect(second.next).toEqual([expect.objectContaining({ id: deck.id, text: DECK, done: true })]);
    expect(proposalsOf(host)).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: SAID, changeOf: deck.id }), expect.objectContaining({ text: ROOM, changeOf: null })
    ]));
    const room = await acceptSuggestion(host, ROOM);
    await host.tickFollowUp(deck.id, false);
    expect(followUp((await notesOf(kofi, (n) => n.next.find((x) => x.id === deck.id)?.done === false)).next, DECK).id).toBe(deck.id);
    await host.tickFollowUp(deck.id, true);

    // A person's update during an unlocked model run remains authoritative when the refresh saves.
    h.near.slowNext(900);
    const before = runs();
    await say(host, C, 8000);
    await later(host);
    await waitFor(() => runs() > before, 'a refresh under way');
    await kofi.tickFollowUp(room.id, true);
    const third = await notesOf(kofi, (n) => n.read.lines === 3);
    expect(third.next.map((x) => [x.id, x.text, x.done])).toEqual([[deck.id, DECK, true], [room.id, ROOM, true]]);
    stop();
    h.near.reword(DECK, null);
    await host.leave();
  });

  it('keeps accepted tasks whether ticked or open when a model omits and later repeats them', async () => {
    const { host, kofi } = await twoInCall();
    await say(host, DECK);
    await say(host, ROOM, 4000);
    const stop = host.watchNotes();
    await notesOf(host);
    const deck = await acceptSuggestion(host, DECK);
    const room = await acceptSuggestion(host, ROOM);
    await kofi.tickFollowUp(deck.id, true);
    h.near.reword(DECK, '');
    h.near.reword(ROOM, '');
    await say(host, A, 8000);
    await later(host);
    const second = await notesOf(host, (n) => n.read.lines === 3);
    expect(second.next.map((x) => [x.id, x.text, x.done])).toEqual([[deck.id, DECK, true], [room.id, ROOM, false]]);
    h.near.reword(ROOM, null);
    h.near.reword(DECK, null);
    await say(host, C, 12_000);
    await later(host);
    const third = await notesOf(host, (n) => n.read.lines === 4);
    expect(third.next.map((x) => [x.id, x.text, x.done])).toEqual([[deck.id, DECK, true], [room.id, ROOM, false]]);
    expect(proposalsOf(host)).toEqual([]);
    stop();
    await host.leave();
  });

  it('leaves multilingual paraphrases as a stable proposal while the accepted task retains its identity', async () => {
    const { host } = await twoInCall();
    await say(host, DECK);
    const stop = host.watchNotes();
    await notesOf(host);
    const deck = await acceptSuggestion(host, DECK);
    await host.tickFollowUp(deck.id, true);
    let n = 1;
    let proposalId = '';
    for (const wording of ['Go to HR', 'रिपोर्ट भेजें', 'Do it', '資料を送る']) {
      const before = runs();
      h.near.reword(DECK, wording);
      await say(host, `We talked about it ${n}.`, n * 3000);
      n++;
      await later(host);
      const seen = await notesOf(host, (x) => x.read.lines === n);
      expect(seen.next).toEqual([expect.objectContaining({ id: deck.id, text: DECK, done: true })]);
      const proposal = proposalsOf(host)[0];
      expect(proposal).toMatchObject({ text: 'Go to HR', changeOf: deck.id, review: 'suggested' });
      if (proposalId) expect(proposal?.id).toBe(proposalId);
      proposalId = proposal?.id ?? '';
      expect(sentSince(before)[0]).toContain('F1 (Kofi) ');
      expect(sentSince(before)[0]).not.toContain(deck.id);
    }
    stop();
    h.near.reword(DECK, null);
    await host.leave();
  });

  it('does not let invented or duplicate model identities replace accepted tasks', async () => {
    const { host } = await twoInCall();
    await say(host, DECK);
    await say(host, ROOM, 4000);
    const stop = host.watchNotes();
    await notesOf(host);
    const deck = await acceptSuggestion(host, DECK);
    const room = await acceptSuggestion(host, ROOM);
    await host.tickFollowUp(deck.id, true);
    h.near.identify(ROOM, 'invented');
    await say(host, A, 8000);
    await later(host);
    const second = await notesOf(host, (n) => n.read.lines === 3);
    expect(second.next.map((x) => [x.id, x.text, x.done])).toEqual([[deck.id, DECK, true], [room.id, ROOM, false]]);
    h.near.identify(ROOM, DECK);
    await say(host, C, 12_000);
    await later(host);
    const third = await notesOf(host, (n) => n.read.lines === 4);
    stop();
    h.near.identify(ROOM, null);
    expect(third.next.map((x) => [x.id, x.text, x.done])).toEqual([[deck.id, DECK, true], [room.id, ROOM, false]]);
    await host.leave();
  });

  it('keeps a ticked accepted task while offering another thing from the same sentence', async () => {
    const { host } = await twoInCall();
    const BOTH = 'Kofi will send both of those to legal by Friday.';
    const [REPORT, INVOICE] = ['Send the report to legal by Friday', 'Send the invoice to legal by Friday'];
    await say(host, BOTH);
    h.near.reword(BOTH, REPORT);
    const stop = host.watchNotes();
    await notesOf(host);
    const report = await acceptSuggestion(host, REPORT);
    await host.tickFollowUp(report.id, true);
    h.near.reword(BOTH, INVOICE);
    h.near.identify(BOTH, 'new');
    await say(host, A, 3000);
    await later(host);
    const n = await notesOf(host, (x) => x.read.lines === 2);
    stop();
    h.near.reword(BOTH, null);
    h.near.identify(BOTH, null);
    expect(n.next).toEqual([expect.objectContaining({ id: report.id, text: REPORT, done: true })]);
    expect(proposalsOf(host)).toEqual([expect.objectContaining({ text: INVOICE, done: false, review: 'suggested' })]);
    await host.leave();
  });

  it('keeps actuals and the open review batch stable as a long call produces newer proposals', async () => {
    const { host } = await twoInCall();
    const task = (n: number) => `Kofi will finish item ${n} by Friday.`;
    for (let n = 1; n <= 25; n++) await say(host, task(n), n * 400);
    const stop = host.watchNotes();
    expect((await notesOf(host)).next).toEqual([]);
    expect(texts(proposalsOf(host))).toEqual(Array.from({ length: 20 }, (_, i) => task(i + 6)));
    const oldest = await acceptSuggestion(host, task(6));
    const batch = proposalsOf(host).map((f) => [f.id, f.text]);
    await host.tickFollowUp(oldest.id, true);
    await say(host, task(26), 10_400);
    await say(host, task(27), 10_800);
    await later(host);
    const second = await notesOf(host, (n) => n.read.lines === 27);
    stop();
    expect(second.next).toEqual([expect.objectContaining({ id: oldest.id, text: task(6), done: true })]);
    expect(proposalsOf(host).map((f) => [f.id, f.text])).toEqual(expect.arrayContaining(batch));
    expect(texts(proposalsOf(host))).toEqual(expect.arrayContaining([task(26), task(27)]));
    await host.leave();
  });

  it('refuses made-up IDs, another call’s task, someone asking to join, and an ended call', async () => {
    const { org, host, kofi, code: c } = await twoInCall();
    await say(host, DECK);
    const stop = kofi.watchNotes();
    await notesOf(kofi);
    const deck = await acceptSuggestion(kofi, DECK);
    stop();
    expect(code(await kofi.tickFollowUp('AAAAAAAAAAAAAAAAAAAAAA', true).catch((e: unknown) => e))).toBe('not-found');
    expect(code(await kofi.tickFollowUp('x'.repeat(65), true).catch((e: unknown) => e))).toBe('invalid');
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

describe('adding a follow-up', () => {
  const MINE = 'Send the pricing sheet to Lena';
  const DECK = 'Kofi will send the deck to legal by Friday.';
  const addedOf = (call: CallSession) => call.getSnapshot().liveNotes.added;

  it('is everyone’s at once, before any notes are written, and ticked like the rest', async () => {
    const { host, kofi, email } = await twoInCall();
    open.push(await connect(await host.room(), { sending: host.crypto }));
    const pushed = open[0]?.nextChange();
    await kofi.addFollowUp({ text: `  ${MINE}\n`, owner: kofi.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });
    await pushed;
    // For whoever added it, under their name, with nothing behind it, and no notes have been written for it to go in.
    const name = kofi.getSnapshot().participants.find((p) => p.isMe)?.person.name;
    expect(addedOf(kofi)).toEqual([expect.objectContaining({ id: expect.any(String), text: MINE, owner: name, evidence: [], done: false, at: expect.any(Number), review: 'accepted' })]);
    const seen = await settle(host, (s) => s.liveNotes.added.length === 1);
    expect(seen.liveNotes).toMatchObject({ notes: null, writing: false, error: null, added: addedOf(kofi) });
    expect(email).toContain('kofi');

    // The same words again add nothing, however they're spaced: a retry is safe.
    await kofi.addFollowUp({ text: MINE.replace(' ', '   '), owner: kofi.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });
    await host.addFollowUp({ text: 'Book the room', owner: host.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });
    expect(texts((await settle(kofi, (s) => s.liveNotes.added.length === 2)).liveNotes.added)).toEqual([MINE, 'Book the room']);

    // Anyone who gets the notes ticks it, or takes the tick back, for everyone.
    const id = addedOf(kofi)[0]?.id ?? '';
    await host.tickFollowUp(id, true);
    expect((await settle(kofi, (s) => s.liveNotes.added[0]?.done === true)).liveNotes.added[1]?.done).toBe(false);
    await kofi.tickFollowUp(id, false);
    await settle(host, (s) => s.liveNotes.added[0]?.done === false);

    // It's among the call's follow-ups, for whoever's reading them.
    const stop = kofi.watchFollowUps();
    await waitFor(() => kofi.followUps.getSnapshot() !== null, 'the follow-ups');
    stop();
    expect(kofi.followUps.getSnapshot()?.items.map((f) => [f.from, f.text])).toEqual([['added', MINE], ['added', 'Book the room']]);
    await host.leave();
  });

  it('stays through refreshes in the words it was added, and the notes model is told it as it’s told the rest', async () => {
    const { host, kofi } = await twoInCall();
    await kofi.addFollowUp({ text: MINE, owner: kofi.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });
    const id = addedOf(kofi)[0]?.id ?? '';
    await say(host, DECK);
    const before = runs();
    const stop = host.watchNotes();
    const first = await notesOf(host);
    expect(first.next).toEqual([]);
    expect(texts(proposalsOf(host))).toEqual([DECK]);
    const told = sentSince(before)[0];
    expect(told).toContain(`(${String(host.getSnapshot().participants.find((p) => !p.isMe)?.person.name)}) ${MINE}`);
    expect(told).not.toContain(id);
    await host.tickFollowUp(id, true);

    // A refresh that lists it as what it heard keeps it once, as it was typed, ticked. What the notes wrote stays beside it.
    const SAID = 'Kofi will send the pricing sheet to Lena.';
    h.near.identify(SAID, MINE);
    await say(host, SAID, 4000);
    await later(host);
    const second = await notesOf(host, (n) => n.read.lines === 2);
    expect(second.next).toEqual([]);
    expect(texts(proposalsOf(host))).toContain(DECK);
    expect((await settle(kofi, (s) => s.liveNotes.notes?.read.lines === 2)).liveNotes.added).toEqual([expect.objectContaining({ id, text: MINE, done: true })]);

    // Listed as nothing it knows, it's something the notes wrote, and what was added doesn't go anywhere.
    h.near.identify(SAID, 'new');
    await say(host, 'Should we cut the travel line?', 8000);
    await later(host);
    const third = await notesOf(host, (n) => n.read.lines === 3);
    expect(third.next).toEqual([]);
    expect(texts(proposalsOf(host))).toEqual(expect.arrayContaining([DECK, SAID]));
    expect(addedOf(host)).toEqual([expect.objectContaining({ id, text: MINE, done: true })]);
    h.near.identify(SAID, null);
    stop();
    await host.leave();
  });

  it('survives a refresh that failed, and one written as it was added', async () => {
    const { host, kofi } = await twoInCall();
    await say(host, DECK);
    h.near.failNext(1, 'prose');
    const stop = host.watchNotes();
    await settle(host, (s) => s.liveNotes.error !== null);
    await kofi.addFollowUp({ text: MINE, owner: kofi.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });
    await later(host);
    await notesOf(host);
    await settle(host, (s) => s.liveNotes.added.length === 1);
    expect(texts(addedOf(host))).toEqual([MINE]);

    // Added while the notes model reads: what it wrote is saved around it.
    h.near.slowNext(900);
    const before = runs();
    await say(host, 'We agreed to start with the budget.', 4000);
    await later(host);
    await waitFor(() => runs() > before, 'a refresh under way');
    await kofi.addFollowUp({ text: 'Book the room', owner: kofi.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });
    await notesOf(host, (n) => n.read.lines === 2);
    expect(texts((await settle(host, (s) => s.liveNotes.added.length === 2)).liveNotes.added)).toEqual([MINE, 'Book the room']);
    stop();
    await host.leave();
  });

  it('is for people who get the notes, in a call that has some: nobody else adds or reads it', async () => {
    const { org, host, kofi, code: c } = await twoInCall();
    await kofi.addFollowUp({ text: MINE, owner: kofi.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });
    await say(host, DECK);
    const stop = kofi.watchNotes();
    await notesOf(kofi);
    stop();

    // A guest with the link, here for all of it or not: the note doesn't go to them, so nor does this.
    const sam = await guestBrowser().calls.join(c, { mic: true, cam: false, name: 'Sam' });
    expect(code(await sam.addFollowUp({ text: 'Waiting to be let in', owner: null, due: null }).catch((e: unknown) => e))).toBe('forbidden');
    await letIn(host, sam);
    expect(code(await sam.addFollowUp({ text: 'Added by a guest', owner: null, due: null }).catch((e: unknown) => e))).toBe('forbidden');
    await sam.refresh();
    expect(sam.getSnapshot().liveNotes.added).toEqual([]);
    expect(JSON.stringify(sam.getSnapshot().liveNotes)).not.toContain('pricing');
    expect(code(await sam.tickFollowUp(addedOf(kofi)[0]?.id ?? '', true).catch((e: unknown) => e))).toBe('forbidden');

    // Words that aren't there, or are too many.
    expect(code(await kofi.addFollowUp({ text: '   ', owner: kofi.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null }).catch((e: unknown) => e))).toBe('invalid');
    expect(code(await kofi.addFollowUp({ text: 'x'.repeat(301), owner: kofi.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null }).catch((e: unknown) => e))).toBe('invalid');

    // Nobody else's call: what's added here isn't there, and its ID finds nothing.
    const sameOrganizer = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    expect(sameOrganizer.getSnapshot().liveNotes.added).toEqual([]);
    expect(code(await sameOrganizer.tickFollowUp(addedOf(kofi)[0]?.id ?? '', true).catch((e: unknown) => e))).toBe('not-found');
    await sameOrganizer.leave();

    // A call that has never had notes has nowhere for it to go; one that has, however they stand now, does.
    const quiet = await twoInCall('off');
    expect(code(await quiet.kofi.addFollowUp({ text: MINE, owner: kofi.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null }).catch((e: unknown) => e))).toBe('conflict');
    await quiet.host.leave();
    await host.pause();
    await settle(kofi, (s) => s.capture.mode === 'paused');
    await kofi.addFollowUp({ text: 'Added while paused', owner: kofi.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });
    await host.setNotes(false);
    await settle(kofi, (s) => s.capture.mode === 'off');
    await kofi.addFollowUp({ text: 'Added with notes off', owner: kofi.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });
    expect(texts(addedOf(kofi))).toEqual([MINE, 'Added while paused', 'Added with notes off']);

    await host.leave();
    expect(code(await host.addFollowUp({ text: 'Too late', owner: host.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null }).catch((e: unknown) => e))).toBe('conflict');
  });

  it('stops at a limit', async () => {
    const { host, kofi } = await twoInCall();
    for (let i = 0; i < 40; i++) await (i % 2 ? kofi : host).addFollowUp({ text: `Thing ${i}`, owner: null, due: null });
    expect(code(await kofi.addFollowUp({ text: 'One too many', owner: kofi.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null }).catch((e: unknown) => e))).toBe('conflict');
    await host.addFollowUp({ text: 'Thing 3', owner: host.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });
    await host.leave();
  });

  it('keeps a manual task’s owner separate from consent and retains it through every writing of the notes', async () => {
    const { org, host, kofi, invited, email } = await twoInCall();
    await say(host, DECK);
    await kofi.addFollowUp({ text: MINE, owner: kofi.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });
    await host.addFollowUp({ text: 'Book the room', owner: host.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });
    await kofi.tickFollowUp(addedOf(kofi)[0]?.id ?? '', true);
    const before = h.near.prompts.length;
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);

    // The notes model is told it's settled, so it doesn't list it again.
    const asked = h.near.prompts.slice(before).find((p) => p.includes('Already settled'));
    expect(asked).toContain(`for ${String(note.actions.find((a) => a.text === MINE)?.owner?.name)}, done): ${MINE}`);

    const mine = note.actions.find((a) => a.text === MINE);
    expect(mine).toMatchObject({ takenOn: false, done: true, lines: [], owner: { person: { email } } });
    expect(mine?.changes).toEqual([
      { by: { id: null, name: expect.any(String), email, as: 'invited' }, at: expect.any(String), what: 'proposed' },
      { by: { id: null, name: expect.any(String), email, as: 'invited' }, at: expect.any(String), what: 'done' }
    ]);
    const room = note.actions.find((a) => a.text === 'Book the room');
    expect(room).toMatchObject({ takenOn: false, done: false, owner: { person: { id: org.session.ownerId } } });
    expect(room?.changes).toEqual([{ by: { id: org.session.ownerId, name: expect.any(String), email: expect.any(String), as: 'organizer' }, at: expect.any(String), what: 'proposed' }]);
    expect(note.actions.map((a) => a.text)).not.toContain('Send the deck to legal by Friday');
    expect(note.suggestions.map((a) => a.text)).toContain('Send the deck to legal by Friday');
    expect(await notesRows(host.ticket.callId)).toBe(0);

    // Ownership consent is still Kofi's separate choice after adding the task.
    await invited.api.notes.updateAction(note.id, mine?.id ?? '', { takeOn: true, seen: { text: MINE, due: mine?.due ?? null } });
    expect((await invited.api.notes.inbox()).followUps.map((f) => f.text)).not.toContain(MINE);
    await invited.api.notes.updateAction(note.id, mine?.id ?? '', { done: false });
    expect((await invited.api.notes.inbox()).followUps.map((f) => f.text)).toContain(MINE);

    await org.api.notes.correctLine(note.id, note.transcript?.[0]?.id ?? '', { text: DECK.replace('deck', 'slides') });
    await org.api.notes.rewrite(note.id);
    await settleNote(org.api, note.id, (n) => !n.writingAgain);
    expect((await org.api.notes.get(note.id)).actions.map((a) => a.text)).toEqual(expect.arrayContaining([MINE, 'Book the room']));
  });

  it('reaches the note when the notes can’t be written, and a breakout room’s section when it was added in one', async () => {
    const org = await account();
    const [kofiEmail, lenaEmail] = [unique('kofi'), unique('lena')];
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [kofiEmail, lenaEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const kofi = await (await account(kofiEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(kofi);
    const lena = await (await account(lenaEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(lena);
    await host.appendAudio(piece(audioBytes('rooms'), 0, 0));
    await host.addFollowUp({ text: 'Added in the main room', owner: host.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [lenaEmail] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
    const [design = ''] = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms.map((r) => r.id) ?? [];
    await inPlace(kofi, design);

    // Each part of the call has its own: what's added in a room stays there.
    await kofi.refresh();
    expect(texts(addedOf(kofi))).toEqual([]);
    await kofi.addFollowUp({ text: 'Added in Design', owner: kofi.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });
    await settle(host, (s) => s.liveNotes.added.length === 1);
    expect(texts(addedOf(host))).toEqual(['Added in the main room']);
    expect(texts(addedOf(kofi))).toEqual(['Added in Design']);
    expect(code(await host.tickFollowUp(addedOf(kofi)[0]?.id ?? '', true).catch((e: unknown) => e))).toBe('not-found');

    // Nothing to write notes from, and the model isn't asked, but what was added goes in all the same.
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);
    expect(note.actions.map((a) => a.text)).toEqual(['Added in the main room']);
    expect(note.rooms.find((r) => r.name === 'Design')?.actions.map((a) => a.text)).toEqual(['Added in Design']);
  });

  it('stops showing once the notes stop reading what it may have been written from, and goes to the note', async () => {
    const org = await account();
    const [kofiEmail, lenaEmail] = [unique('kofi'), unique('lena')];
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [kofiEmail, lenaEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const kofi = await (await account(kofiEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(kofi);
    const lena = await (await account(lenaEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(lena);
    await host.appendAudio(piece(audioBytes('rooms'), 0, 0));
    await say(host, 'Kofi will book the hall by Friday.');
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [lenaEmail] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
    const [design = ''] = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms.map((r) => r.id) ?? [];
    await inPlace(kofi, design);
    await say(host, 'The hall is for Kofi’s surprise party.', 3000);
    const stop = host.watchNotes();
    await notesOf(host, (n) => n.read.lines === 2);
    stop();
    // Someone who stayed adds what only those who stayed heard.
    await host.addFollowUp({ text: 'Order the surprise cake', owner: host.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });
    host.closeRooms();
    await inPlace(kofi, 'main');
    await later(kofi);
    const before = runs();
    const back = kofi.watchNotes();
    const after = await notesOf(kofi);
    back();
    expect(after.read.lines).toBe(1);
    expect(addedOf(kofi)).toEqual([]);
    expect(sentSince(before)[0]).not.toContain('surprise');
    await host.refresh();
    expect(addedOf(host)).toEqual([]);
    // Saying it again adds it for everyone, in full view, as anyone can.
    await kofi.addFollowUp({ text: 'Order the surprise cake', owner: kofi.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });
    await settle(host, (s) => s.liveNotes.added.length === 1);
    expect(texts(addedOf(host))).toEqual(['Order the surprise cake']);
    const ended = await host.leave();
    expect((await written(org.api, ended?.pendingNoteId)).actions.filter((a) => a.text === 'Order the surprise cake')).toHaveLength(2);
  });

  it('opens a row written before anyone could add, and adds to it', async () => {
    const { org, host, kofi } = await twoInCall();
    await say(host, DECK);
    const stop = kofi.watchNotes();
    await notesOf(kofi);
    stop();
    await acceptSuggestion(kofi, DECK);
    const callId = host.ticket.callId;
    const o = await openOwner(h.deps, org.session.ownerId, undefined);
    const key = stateKey(o.root, o.ownerId, `call-notes:${callId}`);
    const header = { v: 1 as const, kind: 'call-notes', ownerId: o.ownerId, callId, place: 'main', view: 'all' };
    const { notes_ciphertext: sealed } = (await h.pool.query<{ notes_ciphertext: Buffer }>(`SELECT notes_ciphertext FROM call_notes WHERE call_id = $1`, [callId])).rows[0] ?? {};
    if (!sealed) throw new Error('no row of notes');
    const before = openJson(key, header, sealed, z.object({ notes: z.unknown(), failed: z.boolean() }));
    expect(Object.keys(before)).toEqual(['notes', 'failed']);
    await h.pool.query(`UPDATE call_notes SET notes_ciphertext = $2 WHERE call_id = $1`, [callId, sealJson(key, header, toJson(before))]);
    await kofi.refresh();
    expect(texts(kofi.getSnapshot().liveNotes.notes?.next ?? [])).toEqual([DECK]);
    expect(addedOf(kofi)).toEqual([]);
    await kofi.addFollowUp({ text: MINE, owner: kofi.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });
    expect(texts(addedOf(kofi))).toEqual([MINE]);
    await host.leave();
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

describe('accepted follow-ups into the note', () => {
  const DECK = 'Kofi will send the deck to legal by Friday.';
  const ROOM = 'Kofi will book the room by Monday.';
  const PLANTS = 'Kofi will water the plants by Tuesday.';
  const LATER = 'Kofi will update the plan by Thursday.';

  it('preserves accepted wording, identity, ownership and ticks through final inference and rewriting', async () => {
    const { org, host, kofi, invited, email } = await twoInCall();
    for (const [i, words] of [DECK, ROOM, PLANTS, LATER].entries()) await say(host, words, i * 3000);
    const stop = kofi.watchNotes();
    expect((await notesOf(kofi)).next).toEqual([]);
    const accepted: LiveFollowUp[] = [];
    for (const text of [DECK, ROOM, PLANTS, LATER]) accepted.push(await acceptSuggestion(kofi, text));
    stop();
    for (const text of [DECK, PLANTS]) await kofi.tickFollowUp(followUp(accepted, text).id, true);
    await host.tickFollowUp(followUp(accepted, ROOM).id, true);
    await host.tickFollowUp(followUp(accepted, ROOM).id, false);
    await host.tickFollowUp(followUp(accepted, LATER).id, true);
    const WORDED = 'Legal gets the deck from Kofi by Friday';
    h.near.reword(DECK, WORDED);
    h.near.reword(PLANTS, '');
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);
    h.near.reword(DECK, null);
    h.near.reword(PLANTS, null);
    expect(note.actions.map((a) => [a.id, a.text, a.done])).toEqual(accepted.map((a) => [a.id, a.text, a.text !== ROOM]));
    const deck = note.actions.find((a) => a.text === DECK);
    expect(deck?.changes).toEqual(expect.arrayContaining([expect.objectContaining({ by: expect.objectContaining({ email }), what: 'done' })]));
    const plants = note.actions.find((a) => a.text === PLANTS);
    expect(plants).toMatchObject({ done: true, due: 'Tuesday', owner: { name: 'Kofi' }, takenOn: false });
    expect(plants?.at).toBe(note.transcript?.find((l) => l.text === PLANTS)?.at);
    expect(plants?.evidence).toMatchObject({ flags: [], moments: [{ kind: 'line', text: PLANTS }] });
    expect((await invited.api.notes.get(note.id)).actions.map((a) => a.done)).toEqual(note.actions.map((a) => a.done));
    expect((await org.api.notes.list()).find((n) => n.id === note.id)).toMatchObject({ openActions: 1, totalActions: 4 });
    await org.api.notes.correctLine(note.id, note.transcript?.[0]?.id ?? '', { text: DECK.replace('deck', 'slides') });
    await org.api.notes.rewrite(note.id);
    const again = await settleNote(org.api, note.id, (n) => !n.writingAgain);
    expect(again.actions.map((a) => [a.id, a.text, a.done])).toEqual(note.actions.map((a) => [a.id, a.text, a.done]));
  });

  it('never lets invented final-model matches transfer a tick or replace accepted task IDs', async () => {
    const { org, host, kofi } = await twoInCall();
    for (const [i, text] of [DECK, ROOM, PLANTS].entries()) await say(host, text, i * 3000);
    const stop = kofi.watchNotes();
    await notesOf(kofi);
    const deck = await acceptSuggestion(kofi, DECK);
    const plants = await acceptSuggestion(kofi, PLANTS);
    stop();
    await kofi.tickFollowUp(deck.id, true);
    await kofi.tickFollowUp(plants.id, true);
    h.near.identify(ROOM, DECK);
    h.near.identify(PLANTS, 'invented');
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);
    h.near.identify(ROOM, null);
    h.near.identify(PLANTS, null);
    expect(note.actions.map((a) => [a.id, a.text, a.done])).toEqual([[deck.id, DECK, true], [plants.id, PLANTS, true]]);
    expect(note.suggestions).toEqual(expect.arrayContaining([expect.objectContaining({ text: ROOM, done: false, review: 'suggested' })]));
    expect(note.totalActions).toBe(2);
  });

  it('retains accepted tasks and ticks when the call does not keep a transcript', async () => {
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
    await notesOf(kofi);
    const deck = await acceptSuggestion(kofi, DECK);
    stop();
    await kofi.tickFollowUp(deck.id, true);
    h.near.reword(DECK, 'Legal gets the deck from Kofi by Friday');
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);
    h.near.reword(DECK, null);
    expect(note.actions).toEqual([expect.objectContaining({ id: deck.id, text: DECK, done: true })]);
    expect(note.transcript).toEqual([]);
    const o = await openOwner(h.deps, org.session.ownerId, undefined);
    expect((await getItem(o, h.pool, 'note', note.id, NoteManifest, 'Those notes')).manifest.ticked).toEqual([]);
  });

  it('keeps an omitted accepted task and leaves the other inferred task pending', async () => {
    const { org, host, kofi } = await twoInCall();
    const [BANK, CLIENT] = ['Kofi will call the bank by Friday.', 'Kofi will call the client by Friday.'];
    await say(host, BANK);
    await say(host, CLIENT, 1000);
    const stop = kofi.watchNotes();
    await notesOf(kofi);
    const bank = await acceptSuggestion(kofi, BANK);
    stop();
    await kofi.tickFollowUp(bank.id, true);
    h.near.reword(BANK, '');
    h.near.reword(CLIENT, 'Appeler le client avant vendredi');
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);
    h.near.reword(BANK, null);
    h.near.reword(CLIENT, null);
    expect(note.actions).toEqual([expect.objectContaining({ id: bank.id, text: BANK, done: true })]);
    expect(note.suggestions).toEqual(expect.arrayContaining([expect.objectContaining({ text: CLIENT, done: false })]));
    expect(note.openActions).toBe(0);
  });

  it('honors the requested notes language without translating accepted task words', async () => {
    const { org, host, kofi } = await twoInCall();
    await org.api.account.updatePreferences({ notesLanguage: 'fr' });
    await say(host, DECK);
    await say(host, ROOM, 6000);
    const stop = kofi.watchNotes();
    await notesOf(kofi);
    const deck = await acceptSuggestion(kofi, DECK);
    stop();
    await kofi.tickFollowUp(deck.id, true);
    h.near.reword(DECK, 'Envoyer la présentation au service juridique avant vendredi');
    h.near.reword(ROOM, 'Réserver la salle avant lundi');
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);
    h.near.reword(DECK, null);
    h.near.reword(ROOM, null);
    // This call's own note: another call's notes written in the background can be the stand-in's last request.
    const ours = h.near.instructions.filter((system, i) => system.startsWith('You write the notes') && (h.near.prompts[i] ?? '').includes(`Organizer: ${org.session.user.name}`));
    expect(ours.length).toBeGreaterThan(0);
    for (const system of ours) expect(system).toContain('Write in French.');
    expect(note.actions).toEqual([expect.objectContaining({ id: deck.id, text: DECK, done: true })]);
    expect(note.suggestions.some((a) => a.text === ROOM)).toBe(true);
  });

  it('keeps accepted text without spaces through final inference', async () => {
    const { org, host, kofi } = await twoInCall();
    const LINE = '田中さんが金曜日までに資料を法務に送ります。';
    await say(host, LINE);
    const stop = kofi.watchNotes();
    await notesOf(kofi);
    const task = await acceptSuggestion(kofi, LINE);
    stop();
    await kofi.tickFollowUp(task.id, true);
    h.near.reword(LINE, '資料を金曜日までに法務へ送る');
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);
    h.near.reword(LINE, null);
    expect(note.actions).toEqual([expect.objectContaining({ id: task.id, text: LINE, done: true })]);
  });

  it('keeps accepted tasks even when writing fails and preserves them when the organizer retries', async () => {
    const { org, host, kofi } = await twoInCall();
    await say(host, DECK);
    const stop = kofi.watchNotes();
    await notesOf(kofi);
    const deck = await acceptSuggestion(kofi, DECK);
    stop();
    await kofi.tickFollowUp(deck.id, true);
    h.near.failNext(3, 'prose', `Organizer: ${org.session.user.name}`);
    const ended = await host.leave();
    const noteId = ended?.pendingNoteId ?? '';
    const until = Date.now() + 30_000;
    for (;;) {
      await h.pool.query(`UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = (SELECT owner_id FROM items WHERE item_id = $1)`, [noteId]);
      await maintain(h.deps);
      if ((await org.api.notes.get(noteId)).status === 'ready') break;
      if (Date.now() > until) throw new Error('timed out waiting for the note to finish');
      await sleep(50);
    }
    expect((await org.api.notes.get(noteId)).actions).toEqual([expect.objectContaining({ id: deck.id, text: DECK, done: true })]);
    await org.api.notes.rewrite(noteId);
    const n = await settleNote(org.api, noteId, (x) => !x.writingAgain);
    expect(n.actions).toEqual([expect.objectContaining({ id: deck.id, text: DECK, done: true })]);
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
    await notesOf(kofi);
    await acceptSuggestion(kofi, 'Kofi will send the deck by Friday.');
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
    expect(kofi.getSnapshot().liveNotes).toEqual({ notes: seen, added: [], suggestions: [], writing: false, error: null });
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
    expect(kofi.getSnapshot().liveNotes).toEqual({ notes: null, added: [], suggestions: [], writing: false, error: null });
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
    expect((await settle(kofi, (s) => s.transcript.length === 1)).liveNotes).toEqual({ notes: null, added: [], suggestions: [], writing: false, error: null });
    // The first look makes its row, and everything carries on from there.
    const stop = kofi.watchNotes();
    await notesOf(kofi);
    stop();
    const task = await acceptSuggestion(kofi, 'Kofi will send the deck by Friday.');
    await kofi.tickFollowUp(task.id, true);
    const ended = await host.leave();
    expect((await written(org.api, ended?.pendingNoteId)).actions).toEqual([expect.objectContaining({ text: task.text, id: task.id, done: true })]);
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
    const LATE = 'We agreed to close the books late.';
    await say(late.host, LATE);
    // The call ends while the notes model has the refresh, before it answers.
    let left: unknown = 'not asked';
    whileRefreshing(LATE, async () => { left = await late.host.leave().then(() => 'ended', (e: unknown) => e); });
    const before = runs();
    expect((await look(h.baseUrl, late.kofi)).body).toEqual({ refreshed: false });
    expect(left).toBe('ended');
    expect(runs()).toBe(before + 1);
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
    expect(seen.next).toEqual([]);
    const task = await acceptSuggestion(kofi, 'CANARY-FOLLOWUP Kofi will paint the lighthouse by Friday.');
    await kofi.tickFollowUp(task.id, true);
    expect(task.text).toContain('CANARY-FOLLOWUP');
    await kofi.addFollowUp({ text: 'CANARY-ADDED paint the harbour wall', owner: kofi.getSnapshot().participants.find((p) => p.isMe)?.person.email ?? null, due: null });

    const dump = String((await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (
      SELECT row_to_json(x)::text AS t FROM call_notes x UNION ALL SELECT row_to_json(x)::text FROM calls x UNION ALL
      SELECT row_to_json(x)::text FROM operations x UNION ALL SELECT row_to_json(x)::text FROM transcript_clips x) q`)).rows[0]?.all ?? '');
    expect(dump).toContain(host.ticket.callId);
    const logs = h.logs.slice(from).join('');
    const canaries = ['CANARY-LIVENOTE', 'CANARY-FOLLOWUP', 'CANARY-ADDED', 'harbour', 'lighthouse', 'Friday'];
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

    // Copied to another view of the same part of the call, or to another call of the same organizer, the record doesn't open.
    const sealed = (await h.pool.query<{ notes_ciphertext: Buffer }>('SELECT notes_ciphertext FROM call_notes WHERE call_id = $1', [host.ticket.callId])).rows[0]?.notes_ciphertext;
    await h.pool.query(`INSERT INTO call_notes (owner_id, call_id, place, view, notes_ciphertext) VALUES ($1, $2, 'main', $3, $4)`, [org.session.ownerId, host.ticket.callId, 'x'.repeat(43), sealed]);
    expect((await fetch(`${h.baseUrl}/v1/live/calls/${host.ticket.callId}`, { headers: { origin: ORIGIN, 'x-alcove-call': kofi.ticket.pass } })).status).toBe(403);
    await h.pool.query(`DELETE FROM call_notes WHERE call_id = $1 AND view <> 'all'`, [host.ticket.callId]);
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
    for (const canary of ['CANARY-FOLLOWUP', 'CANARY-ADDED']) for (const enc of encodings(canary)) expect(after.includes(enc)).toBe(false);
  });
});

describe('reviewing conversation follow-ups', () => {
  it('keeps the checklist stable until someone accepts, dismisses durably, and carries pending review into the note', async () => {
    const { org, host, kofi } = await twoInCall();
    await say(host, B);
    const stop = host.watchNotes();
    await notesOf(host);
    const first = host.getSnapshot().liveNotes;
    expect(first.notes?.next).toEqual([]);
    expect(first.suggestions).toHaveLength(1);
    const proposal = first.suggestions[0];
    if (!proposal) throw new Error('No suggestion to review');
    await kofi.reviewFollowUp({ id: proposal.id, revision: proposal.revision, decision: 'accept' });
    await settle(host, (s) => s.liveNotes.notes?.next.some((x) => x.id === proposal.id) === true);
    expect(host.getSnapshot().liveNotes.notes?.next[0]?.done).toBe(false);
    await kofi.reviewFollowUp({ id: proposal.id, revision: proposal.revision, decision: 'accept' });
    expect(code(await kofi.reviewFollowUp({ id: proposal.id, revision: proposal.revision, decision: 'dismiss' }).catch((e: unknown) => e))).toBe('conflict');
    await say(host, 'Kofi will book the room by Monday.', 4000);
    await later(host);
    await notesOf(host, (n) => n.read.lines === 2);
    const pending = host.getSnapshot().liveNotes.suggestions[0];
    if (!pending) throw new Error('No second suggestion');
    await host.reviewFollowUp({ id: pending.id, revision: pending.revision, decision: 'dismiss' });
    await say(host, 'We agreed to review the schedule.', 8000);
    await later(host);
    await notesOf(host, (n) => n.read.lines === 3);
    expect(host.getSnapshot().liveNotes.suggestions.map((x) => x.text)).not.toContain(pending.text);
    stop();
    const noteId = host.getSnapshot().notes.noteId;
    await host.leave();
    const note = await written(org.api, noteId);
    expect(note.actions.map((a) => a.id)).toContain(proposal.id);
    expect(note.actions.map((a) => a.text)).not.toContain(pending.text);
    expect(note.suggestions.map((a) => a.text)).not.toContain(pending.text);
  });
});

describe('reviewing changes without AI editing tasks', () => {
  it('proposes a change without moving the checklist, applies it once, and refuses a changed target', async () => {
    const { host } = await twoInCall();
    await say(host, B);
    const stop = host.watchNotes();
    await notesOf(host);
    const first = host.getSnapshot().liveNotes.suggestions[0];
    if (!first) throw new Error('No initial proposal');
    await host.reviewFollowUp({ id: first.id, revision: first.revision, decision: 'accept' });
    h.near.reword(B, 'Check the launch calendar by Monday');
    await say(host, A, 4000);
    await later(host);
    await notesOf(host, (n) => n.read.lines === 2);
    const before = host.getSnapshot().liveNotes.notes?.next[0];
    const change = host.getSnapshot().liveNotes.suggestions[0];
    expect(before).toMatchObject({ id: first.id, text: B });
    expect(change).toMatchObject({ changeOf: first.id, text: 'Check the launch calendar by Monday', target: { id: first.id, text: B } });
    if (!change) throw new Error('No proposed change');
    await host.reviewFollowUp({ id: change.id, revision: change.revision, decision: 'accept' });
    await host.reviewFollowUp({ id: change.id, revision: change.revision, decision: 'accept' });
    expect(host.getSnapshot().liveNotes.notes?.next).toMatchObject([{ id: first.id, text: change.text }]);
    h.near.reword(B, '');
    const laterWords = 'Kofi will send the final launch calendar by Tuesday.';
    h.near.identify(laterWords, change.text);
    await say(host, laterWords, 8000);
    await later(host);
    await notesOf(host, (n) => n.read.lines === 3);
    const stale = host.getSnapshot().liveNotes.suggestions[0];
    const actual = host.getSnapshot().liveNotes.notes?.next[0];
    if (!stale || !actual) throw new Error('Missing change or target');
    await host.updateFollowUp(actual.id, { seen: { revision: actual.revision, text: actual.text, owner: actual.ownerPerson?.email ?? null, due: actual.due ?? null }, text: 'Our own exact checklist wording' });
    expect(code(await host.reviewFollowUp({ id: stale.id, revision: stale.revision, decision: 'accept' }).catch((e: unknown) => e))).toBe('conflict');
    await host.reviewFollowUp({ id: stale.id, revision: stale.revision, decision: 'dismiss' });
    expect(host.getSnapshot().liveNotes.notes?.next[0]?.text).toBe('Our own exact checklist wording');
    stop();
    h.near.reword(B, null);
    h.near.identify(laterWords, null);
    await host.leave();
  });

  it('keeps pending IDs through call end and saved-note rewrites, and protects review from another account', async () => {
    const { org, host, invited } = await twoInCall();
    const words = 'CANARY-REVIEW Kofi will check the signed schedule by Friday.';
    await say(host, words);
    const stop = host.watchNotes();
    await notesOf(host);
    const pending = host.getSnapshot().liveNotes.suggestions[0];
    if (!pending) throw new Error('Missing pending proposal');
    stop();
    const noteId = host.getSnapshot().notes.noteId ?? '';
    await host.leave();
    const note = await written(org.api, noteId);
    expect(note.actions).toEqual([]);
    expect(note.suggestions).toMatchObject([{ id: pending.id, text: words }]);
    expect(note.openActions).toBe(0);
    expect((await invited.api.notes.inbox()).followUps).toEqual([]);
    const outsider = await account();
    expect(code(await outsider.api.notes.reviewAction(noteId, { id: pending.id, revision: pending.revision, decision: 'accept' }).catch((e: unknown) => e))).toBe('not-found');
    expect(code(await invited.api.notes.reviewAction(noteId, { id: pending.id, revision: 'stale', decision: 'accept' }).catch((e: unknown) => e))).toBe('conflict');
    const results = await Promise.all([
      org.api.notes.reviewAction(noteId, { id: pending.id, revision: pending.revision, decision: 'dismiss' }),
      invited.api.notes.reviewAction(noteId, { id: pending.id, revision: pending.revision, decision: 'dismiss' })
    ]);
    expect(results.map((n) => n.suggestions.length)).toEqual([0, 0]);
    h.near.reword(words, 'Review the signed calendar again');
    await org.api.notes.rewrite(noteId);
    const rewritten = await reviewFinished(org.api, noteId);
    expect(rewritten.actions).toEqual([]);
    expect(rewritten.suggestions).toEqual([]);
    h.near.reword(words, null);
    const dump = String((await h.pool.query(`SELECT string_agg(row_to_json(x)::text, ' ') AS all FROM revisions x`)).rows[0]?.all ?? '');
    expect(dump).not.toContain('CANARY-REVIEW');
    expect(h.logs.join('')).not.toContain('CANARY-REVIEW');
  });
});

describe('durable checklist review', () => {
  it('preserves review during inference and resolves opposing concurrent reviews only once', async () => {
    const { host, kofi } = await twoInCall();
    await say(host, B);
    const stop = host.watchNotes();
    await notesOf(host);
    const proposal = host.getSnapshot().liveNotes.suggestions[0];
    if (!proposal) throw new Error('No proposal');
    h.near.slowNext(600);
    const before = runs();
    await say(host, A, 4000);
    await later(host);
    const refresh = look(h.baseUrl, kofi);
    await waitFor(() => runs() > before, 'an in-flight refresh');
    const decisions = await Promise.allSettled([
      host.reviewFollowUp({ id: proposal.id, revision: proposal.revision, decision: 'accept' }),
      kofi.reviewFollowUp({ id: proposal.id, revision: proposal.revision, decision: 'dismiss' })
    ]);
    expect(decisions.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(decisions.flatMap((r) => r.status === 'rejected' ? [code(r.reason)] : [])).toEqual(['conflict']);
    await refresh;
    await host.refresh();
    expect(host.getSnapshot().liveNotes.suggestions).toEqual([]);
    expect(host.getSnapshot().liveNotes.notes?.next.length).toBe(decisions[0]?.status === 'fulfilled' ? 1 : 0);
    stop();
    await host.leave();
  });

  it('creates explicit unassigned or other-owned manual tasks, checks stale edits, and opens previous-release records', async () => {
    const { org, host, kofi, email } = await twoInCall();
    await host.addFollowUp({ text: 'Keep our own exact task', owner: null, due: '2027-02-01' });
    const original = host.getSnapshot().liveNotes.added[0];
    expect(original).toMatchObject({ text: 'Keep our own exact task', ownerPerson: null, due: '2027-02-01' });
    if (!original) throw new Error('No manual task');
    const seen = { revision: original.revision, text: original.text, owner: null, due: original.due ?? null };
    expect(code(await host.updateFollowUp(original.id, { seen, owner: 'outsider@tests.example' }).catch((e: unknown) => e))).toBe('forbidden');
    await host.updateFollowUp(original.id, { seen, owner: email });
    expect(code(await kofi.updateFollowUp(original.id, { seen, text: 'A stale overwrite' }).catch((e: unknown) => e))).toBe('conflict');
    const ended = await host.leave();
    const noteId = ended?.pendingNoteId ?? '';
    const note = await written(org.api, noteId);
    expect(note.actions).toMatchObject([{ id: original.id, text: original.text, takenOn: false, owner: { person: { email } } }]);
    const owner = await openOwner(h.deps, org.session.ownerId, undefined);
    const item = await getItem(owner, h.pool, 'note', noteId, NoteManifest, 'Those notes');
    const actions = item.manifest.actions.map(({ review: _review, changeOf: _change, revision: _revision, target: _target, sourceId: _source, sourceVersion: _version, reviewed: _reviewed, ...old }) => old);
    await saveRevision(owner, h.pool, noteId, item.revisionId, { ...item.manifest, actions });
    const upgraded = await org.api.notes.get(noteId);
    expect(upgraded.actions).toMatchObject([{ id: original.id, text: original.text, review: 'accepted', changeOf: null, revision: '' }]);
    expect(upgraded.suggestions).toEqual([]);
  });

  it('retains pending review even when every final-notes attempt fails', async () => {
    const { org, host } = await twoInCall();
    await say(host, B);
    const stop = host.watchNotes();
    await notesOf(host);
    const pending = host.getSnapshot().liveNotes.suggestions[0];
    if (!pending) throw new Error('No pending proposal');
    stop();
    h.near.failNext(3, 'prose', `Organizer: ${org.session.user.name}`);
    const ended = await host.leave();
    const noteId = ended?.pendingNoteId ?? '';
    const until = Date.now() + 30_000;
    for (;;) {
      await h.pool.query(`UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = $1`, [org.session.ownerId]);
      await maintain(h.deps);
      if ((await org.api.notes.get(noteId)).status === 'ready') break;
      if (Date.now() > until) throw new Error('Timed out finishing failed notes');
      await sleep(50);
    }
    const failed = await org.api.notes.get(noteId);
    expect(failed.summary).toBe('');
    expect(failed.actions).toEqual([]);
    expect(failed.suggestions).toMatchObject([{ id: pending.id, revision: pending.revision, text: pending.text }]);
    const accepted = await org.api.notes.reviewAction(noteId, { id: pending.id, revision: pending.revision, decision: 'accept' });
    expect(accepted.actions).toMatchObject([{ id: pending.id, text: pending.text, takenOn: false }]);
    await org.api.notes.rewrite(noteId);
    const rewritten = await reviewFinished(org.api, noteId);
    expect(rewritten.actions.map((a) => a.id)).toEqual([pending.id]);
  });
});

async function reviewFinished(api: Awaited<ReturnType<typeof account>>['api'], noteId: string): Promise<Note> {
  const until = Date.now() + 30_000;
  for (;;) {
    const note = await api.notes.get(noteId);
    if (note.status === 'ready' && !note.writingAgain) return note;
    if (Date.now() > until) throw new Error('Timed out waiting for rewritten review');
    await sleep(40);
  }
}

describe('authoritative source corrections', () => {
  it('revises pending review after a transcript correction and allows corrected evidence after dismissal', async () => {
    const { org, host } = await twoInCall();
    await say(host, B);
    const stop = host.watchNotes();
    await notesOf(host);
    stop();
    const ended = await host.leave();
    const noteId = ended?.pendingNoteId ?? '';
    const note = await written(org.api, noteId);
    const original = note.suggestions[0];
    const line = note.transcript?.[0];
    if (!original || !line) throw new Error('Missing review source');
    await org.api.notes.correctLine(noteId, line.id, { text: B.replace('Friday', 'Thursday') });
    await org.api.notes.rewrite(noteId);
    const corrected = await reviewFinished(org.api, noteId);
    const revised = corrected.suggestions.find((a) => a.id === original.id);
    expect(revised).toMatchObject({ id: original.id, due: 'Thursday' });
    expect(revised?.revision).not.toBe(original.revision);
    expect(code(await org.api.notes.reviewAction(noteId, { id: original.id, revision: original.revision, decision: 'accept' }).catch((e: unknown) => e))).toBe('conflict');
    if (!revised) throw new Error('Missing revised proposal');
    await org.api.notes.reviewAction(noteId, { id: revised.id, revision: revised.revision, decision: 'dismiss' });
    await org.api.notes.correctLine(noteId, line.id, { text: B.replace('Friday', 'Wednesday') });
    await org.api.notes.rewrite(noteId);
    const fresh = await reviewFinished(org.api, noteId);
    expect(fresh.suggestions).toMatchObject([{ due: 'Wednesday' }]);
    const current = fresh.suggestions[0];
    if (!current) throw new Error('Missing proposal from corrected evidence');
    expect(current.id).not.toBe(original.id);
    await org.api.notes.reviewAction(noteId, { id: current.id, revision: current.revision, decision: 'accept' });
    await org.api.notes.rewrite(noteId);
    const kept = await reviewFinished(org.api, noteId);
    expect(kept.actions).toMatchObject([{ id: current.id, due: 'Wednesday', takenOn: false }]);
    expect(kept.suggestions).toEqual([]);
  });
});

describe('separate tasks sharing source evidence', () => {
  it('preserves two distinct proposals from one line and reviews each identity independently through handover', async () => {
    const { org, host } = await twoInCall();
    const line = 'Kofi will draft the timeline and Lena will book the room.';
    const firstWords = 'Kofi will draft the timeline.';
    const secondWords = 'Lena will book the room.';
    h.near.splitActions(line, [firstWords, secondWords]);
    await say(host, line);
    const stop = host.watchNotes();
    await notesOf(host);
    const suggestions = host.getSnapshot().liveNotes.suggestions;
    expect(suggestions.map((a) => a.text)).toEqual([firstWords, secondWords]);
    const first = suggestions[0];
    const second = suggestions[1];
    if (!first || !second) throw new Error('Missing distinct source-sharing tasks');
    expect(first.evidence).toEqual(second.evidence);
    await host.reviewFollowUp({ id: first.id, revision: first.revision, decision: 'dismiss' });
    expect(host.getSnapshot().liveNotes.suggestions).toMatchObject([{ id: second.id }]);
    await say(host, A, 4000);
    await later(host);
    await notesOf(host, (n) => n.read.lines === 2);
    expect(host.getSnapshot().liveNotes.suggestions).toMatchObject([{ id: second.id, text: secondWords }]);
    await host.reviewFollowUp({ id: second.id, revision: second.revision, decision: 'accept' });
    expect(host.getSnapshot().liveNotes.notes?.next).toMatchObject([{ id: second.id, text: secondWords }]);
    stop();
    const ended = await host.leave();
    const saved = await written(org.api, ended?.pendingNoteId);
    expect(saved.actions).toMatchObject([{ id: second.id, text: secondWords }]);
    expect(saved.actions).toHaveLength(1);
    expect(saved.suggestions.every((a) => a.changeOf === second.id)).toBe(true);
    expect(saved.suggestions.some((a) => a.changeOf === first.id || a.text.includes('timeline'))).toBe(false);
    h.near.splitActions(line, null);
  });
});

describe('review identity and capacity', () => {
  it('retains a uniquely known assignee through promotion and handover without consenting for them', async () => {
    const { org, host, invited, email } = await twoInCall();
    await say(host, B);
    const stop = host.watchNotes();
    await notesOf(host);
    const proposed = host.getSnapshot().liveNotes.suggestions[0];
    expect(proposed?.ownerPerson?.email).toBe(email);
    if (!proposed) throw new Error('No owner proposal');
    await host.reviewFollowUp({ id: proposed.id, revision: proposed.revision, decision: 'accept' });
    expect(host.getSnapshot().liveNotes.notes?.next[0]?.ownerPerson?.email).toBe(email);
    stop();
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);
    const actual = note.actions.find((a) => a.id === proposed.id);
    expect(actual).toMatchObject({ owner: { person: { email } }, takenOn: false });
    expect((await invited.api.notes.inbox()).followUps.map((a) => a.id)).toContain(proposed.id);
    if (!actual) throw new Error('No accepted task');
    const taken = await invited.api.notes.updateAction(note.id, actual.id, { takeOn: true, seen: { text: actual.text, due: actual.due ?? null } });
    expect(taken.actions.find((a) => a.id === actual.id)?.takenOn).toBe(true);
  });

  it('keeps manual task capacity independent of sixty dismissed proposals', async () => {
    const { org, host, kofi } = await twoInCall();
    let stop: (() => void) | undefined;
    for (let batch = 0; batch < 3; batch++) {
      const line = `Kofi will discuss follow-up batch ${batch}.`;
      h.near.splitActions(line, Array.from({ length: 20 }, (_, i) => `Kofi will prepare checklist item ${batch}-${i}.`));
      await say(host, line, batch * 4000);
      await later(host);
      stop ??= host.watchNotes();
      await look(h.baseUrl, host);
      await notesOf(host, (n) => n.read.lines === batch + 1);
      const pending = host.getSnapshot().liveNotes.suggestions;
      expect(pending).toHaveLength(20);
      for (const proposal of pending) await host.reviewFollowUp({ id: proposal.id, revision: proposal.revision, decision: 'dismiss' });
      h.near.splitActions(line, null);
    }
    await kofi.addFollowUp({ text: 'The task people chose to add', owner: null, due: null });
    await host.refresh();
    expect(host.getSnapshot().liveNotes.added).toMatchObject([{ text: 'The task people chose to add' }]);
    stop?.();
    const ended = await host.leave();
    const note = await written(org.api, ended?.pendingNoteId);
    const added = await org.api.notes.proposeAction(note.id, { text: 'Another task added by a person' });
    expect(added.actions.map((a) => a.text)).toContain('Another task added by a person');
    expect(added.actions).toHaveLength(2);
  });
});

describe('follow-up mutation budgets', () => {
  it('shares the established write budget across add, edit and review while keeping other people independent', async () => {
    const { host, kofi } = await twoInCall();
    await host.addFollowUp({ text: 'Our task', owner: null, due: null });
    await say(host, B);
    const stop = host.watchNotes();
    await notesOf(host);
    const pending = host.getSnapshot().liveNotes.suggestions[0];
    if (!pending) throw new Error('Missing review proposal');
    stop();
    for (let i = 0; i < 59; i++) {
      const task = host.getSnapshot().liveNotes.added[0];
      if (!task) throw new Error('Missing manual task');
      await host.updateFollowUp(task.id, { seen: { revision: task.revision, text: task.text, owner: null, due: null }, text: `Our task revision ${i}` });
    }
    const task = host.getSnapshot().liveNotes.added[0];
    if (!task) throw new Error('Missing task at the write limit');
    expect(code(await host.updateFollowUp(task.id, { seen: { revision: task.revision, text: task.text, owner: null, due: null }, text: 'Past the write limit' }).catch((e: unknown) => e))).toBe('unavailable');
    expect(code(await host.reviewFollowUp({ id: pending.id, revision: pending.revision, decision: 'accept' }).catch((e: unknown) => e))).toBe('unavailable');
    await kofi.reviewFollowUp({ id: pending.id, revision: pending.revision, decision: 'accept' });
    expect(kofi.getSnapshot().liveNotes.notes?.next.map((a) => a.id)).toContain(pending.id);
    await host.leave();
  });
});
