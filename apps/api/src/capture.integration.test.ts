/**
 * What a call captures (docs: Calls and recordings › What's captured), end to end: the real API over HTTP via
 * @alcove/api-http, real Postgres, the object store, LiveKit and main's fake NEAR AI. One capture state everyone
 * sees, pausing that stops every kind of capture on the server, asking the organizer for notes, and the stretches
 * nothing was captured in, marked in the call, a catch-up and the finished notes.
 */
import { AlcoveApiError, type AlcoveApi, type AudioPiece, type CallSession, type CallState, type NoteProgress, type TranscriptClip } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { speechWav } from './testing/fake-near';
import { ORIGIN, startHarness, type Harness } from './testing/harness';

// Letting people into a call goes through its MLS group, which a busy CI runner can be slow at; every wait says what it waited for.
vi.setConfig({ testTimeout: 60_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
afterEach(() => h.closeCalls());

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const message = (e: unknown) => (e instanceof AlcoveApiError ? e.message : '');
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
/** A fresh account (single sign-on signs in whoever's work email is typed), or the same one again in another browser. */
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
const audioBytes = (marker: string) => { const src = Buffer.concat([Buffer.from(marker), randomBytes(2048)]); const out = new Uint8Array(new ArrayBuffer(src.length)); out.set(src); return out; };
const piece = (marker: string, segment: number, s: number): AudioPiece => ({ data: new Blob([audioBytes(marker)]), segment, seq: s, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
const speech = (words: string, segment: number, startMs: number, ms = 4000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment, startMs, durationMs: ms });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
/** Refreshes until the call's state matches: other people's changes arrive by fetching the call again. */
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 100 && !pred(call.getSnapshot()); i++) { await call.refresh(); await sleep(30); }
  if (!pred(call.getSnapshot())) throw new Error('timed out waiting for the call to change');
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in', `${call.ticket.role} in the call’s group`);
/** The organizer lets in someone who asked, and their browser has the call. */
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await inGroup(who);
  await settle(who, (s) => s.participants.some((p) => p.isMe));
}
/** One call action straight to the API with someone's pass (and no session), as their browser would send it. */
const act = async (call: CallSession, action: unknown) => (await fetch(`${h.baseUrl}/v1/live/calls/${call.ticket.callId}/actions`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-alcove-call': call.ticket.pass }, body: JSON.stringify(action)
})).status;
async function written(api: AlcoveApi, noteId: string): Promise<NoteProgress[]> {
  const steps: NoteProgress[] = [];
  for await (const p of api.notes.progress(noteId)) steps.push(p);
  return steps;
}
const PAUSED = 'Notes are paused. Nothing is recorded, transcribed or sent to the AI until the organizer resumes.';

describe('what a call captures', () => {
  it('lets only the organizer pause, resume and turn notes on or off, and shows everyone the same state, with who changed it', async () => {
    const org = await account(unique('organizer'));
    const invitedEmail = unique('invited');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [invitedEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    // Notes on from the start, as the call was scheduled: every kind of capture but screens, which nothing reads.
    expect(host.getSnapshot().capture).toMatchObject({
      mode: 'on', recording: { mode: 'on', since: expect.any(String), by: { kind: 'schedule' } }, transcript: { mode: 'on' }, ai: { mode: 'on' },
      screen: { mode: 'off', since: null, by: null }, gaps: [], requests: [], asked: null
    });
    const invited = await (await account(invitedEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(invited);
    const guest = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);

    // Nobody but the organizer: not someone invited, not a guest, and nobody without the call's pass.
    for (const call of [invited, guest]) {
      for (const a of [{ type: 'pause' }, { type: 'resume' }, { type: 'notes', on: false }, { type: 'decline-notes', requestId: 'someone' }]) expect(await act(call, a), a.type).toBe(403);
    }
    const stranger = await account();
    const steal = await stranger.fetch(`${h.baseUrl}/v1/live/calls/${host.ticket.callId}/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'pause' }) });
    expect(steal.status).toBe(401);
    expect(host.getSnapshot().capture.mode).toBe('on');

    await host.pause();
    let s = host.getSnapshot();
    expect(s.capture).toMatchObject({
      mode: 'paused', recording: { mode: 'paused', since: expect.any(String), by: { kind: 'organizer', name: org.session.user.name } },
      transcript: { mode: 'paused' }, ai: { mode: 'paused' }, screen: { mode: 'off' }
    });
    expect(s.notices.at(-1)).toMatchObject({ kind: 'notes', text: 'The organizer paused notes. Nothing is recorded, transcribed or sent to the AI until they resume.' });
    // Everyone in the call sees the same, with who did it.
    for (const call of [invited, guest]) expect((await settle(call, (x) => x.capture.mode === 'paused')).capture.recording.by).toEqual({ kind: 'organizer', name: org.session.user.name });

    // Pausing again changes nothing; resuming carries on in a new segment; resuming again changes nothing.
    await host.pause();
    expect(host.getSnapshot().notes.recording.segment).toBe(0);
    await host.resume();
    s = host.getSnapshot();
    expect(s.capture.mode).toBe('on');
    expect(s.notes.recording.segment).toBe(1);
    expect(s.notices.at(-1)?.text).toBe('The organizer resumed notes. Everyone here can see that.');
    await host.resume();
    expect(host.getSnapshot().notes.recording.segment).toBe(1);

    // With notes off there's nothing to pause or resume.
    host.setNotes(false);
    await settle(host, (x) => x.capture.mode === 'off');
    expect(host.getSnapshot().capture.recording.by).toEqual({ kind: 'organizer', name: org.session.user.name });
    expect(code(await host.pause().catch((e: unknown) => e))).toBe('conflict');
    expect(code(await host.resume().catch((e: unknown) => e))).toBe('conflict');
    expect((await settle(guest, (x) => x.capture.mode === 'off')).capture.mode).toBe('off');
    await host.leave();
  });

  it('lets anyone in the call ask for notes, and tells them when the organizer says yes or not now', async () => {
    const org = await account(unique('organizer'));
    const { code: c } = await org.api.calls.startNow({ notes: 'off' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const guest = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Samwise Gamgee' });
    // Someone still waiting to be let in can't ask.
    expect(await act(guest, { type: 'request-notes', up: true })).toBe(403);
    await letIn(host, guest);
    const other = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Lee' });
    await letIn(host, other);

    await guest.requestNotes(true);
    expect(guest.getSnapshot().capture.asked).toMatchObject({ state: 'asking', at: expect.any(String) });
    // The organizer sees who asked, and so does everyone else in the call, like a raised hand.
    const ask = (await settle(host, (x) => x.capture.requests.length === 1)).capture.requests[0];
    expect(ask).toEqual({ id: expect.any(String), participantId: guest.ticket.identity, at: expect.any(String) });
    expect((await settle(other, (x) => x.capture.requests.length === 1)).capture.requests[0]?.participantId).toBe(guest.ticket.identity);
    expect(other.getSnapshot().capture.asked).toBeNull();
    // Asking again is the same ask, and the organizer has nothing to ask for.
    await guest.requestNotes(true);
    expect(guest.getSnapshot().capture.requests.map((r) => r.id)).toEqual([ask?.id]);
    expect(code(await host.requestNotes(true).catch((e: unknown) => e))).toBe('invalid');

    // Not now: whoever asked is told, and the ask is gone. It can't be said no to twice.
    await host.declineNotes(ask?.id ?? '');
    expect(host.getSnapshot().capture.requests).toEqual([]);
    expect((await settle(guest, (x) => x.capture.asked?.state === 'declined')).capture.requests).toEqual([]);
    expect(code(await host.declineNotes(ask?.id ?? '').catch((e: unknown) => e))).toBe('invalid');

    // Asking again, and taking it back.
    await guest.requestNotes(true);
    await guest.requestNotes(false);
    expect(guest.getSnapshot().capture.asked).toBeNull();
    expect((await settle(host, (x) => x.capture.requests.length === 0)).capture.requests).toEqual([]);

    // Yes is notes coming on, which answers every open ask.
    await guest.requestNotes(true);
    await other.requestNotes(true);
    await settle(host, (x) => x.capture.requests.length === 2);
    host.setNotes(true);
    expect((await settle(host, (x) => x.capture.mode === 'on')).capture.requests).toEqual([]);
    for (const call of [guest, other]) expect((await settle(call, (x) => x.capture.asked?.state === 'accepted')).capture.mode).toBe('on');
    // There's nothing to ask for while notes are on. While they're paused, asking and resuming work the same way.
    expect(code(await guest.requestNotes(true).catch((e: unknown) => e))).toBe('conflict');
    await host.pause();
    await guest.requestNotes(true);
    const paused = (await settle(host, (x) => x.capture.requests.length === 1)).capture.requests[0]?.id ?? '';
    // An ask belongs to its own call: another call's organizer can't answer it.
    const elsewhere = await account();
    const theirs = await elsewhere.api.calls.join((await elsewhere.api.calls.startNow({ notes: 'off' })).code, { mic: true, cam: false });
    expect(code(await theirs.declineNotes(paused).catch((e: unknown) => e))).toBe('invalid');
    await theirs.leave();
    expect(host.getSnapshot().capture.requests.map((r) => r.id)).toEqual([paused]);
    await host.resume();
    expect((await settle(guest, (x) => x.capture.asked?.state === 'accepted')).capture.mode).toBe('on');

    // Nothing about asking reaches a log line or a row as a name.
    expect(h.logs.join('')).not.toContain('Samwise');
    await host.leave();
  });

  it('keeps an ask with whoever asked: gone while they’re away, back when they return, and answered by notes coming on while paused', async () => {
    const org = await account(unique('organizer'));
    const kofiEmail = unique('kofi');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [kofiEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const kofi = await account(kofiEmail);
    const first = await kofi.api.calls.join(c, { mic: true, cam: false });
    await inGroup(first);
    const guest = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);
    await host.pause();
    await first.requestNotes(true);
    const ask = (await settle(host, (x) => x.capture.requests.length === 1)).capture.requests[0];
    expect(ask?.participantId).toBe(first.ticket.identity);

    // Kofi leaves: his ask goes with him, for everyone.
    await first.leave();
    await settle(host, (x) => x.capture.requests.length === 0);
    await settle(guest, (x) => x.capture.requests.length === 0);
    // He comes back on another connection: the same ask, still open, under who he is now.
    const back = await kofi.api.calls.join(c, { mic: true, cam: false, previous: first.ticket.pass });
    await inGroup(back);
    expect((await settle(back, (x) => x.participants.some((p) => p.isMe))).capture.asked?.state).toBe('asking');
    expect((await settle(host, (x) => x.capture.requests.length === 1)).capture.requests).toEqual([{ id: ask?.id, participantId: back.ticket.identity, at: ask?.at }]);
    await guest.requestNotes(true);
    await settle(host, (x) => x.capture.requests.length === 2);

    // Turning notes on while they're paused carries on in a new segment, as resuming does, and answers every ask.
    await host.setNotes(true);
    const s = host.getSnapshot();
    expect(s.capture).toMatchObject({ mode: 'on', requests: [], recording: { mode: 'on', by: { kind: 'organizer', name: org.session.user.name } } });
    expect(s.notes.recording.segment).toBe(1);
    for (const call of [back, guest]) expect((await settle(call, (x) => x.capture.asked?.state === 'accepted')).capture.mode).toBe('on');
    expect(code(await host.appendAudio(piece('before', 0, 0)).catch((e: unknown) => e))).toBe('conflict');
    await host.appendAudio(piece('after', 1, 0));
    await host.leave();
  });

  it('shows everyone what the organizer’s browser can’t capture while notes are on, and forgets it with every change', async () => {
    const orgEmail = unique('organizer');
    const org = await account(orgEmail);
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(c, { mic: false, cam: false });
    const guest = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);

    // No microphone: the recording is unavailable, and what everyone else says is still transcribed.
    await host.setUnavailable(['recording']);
    expect(host.getSnapshot().capture).toMatchObject({ mode: 'on', recording: { mode: 'unavailable', by: { kind: 'schedule' } }, transcript: { mode: 'on' }, ai: { mode: 'on' } });
    expect((await settle(guest, (x) => x.capture.recording.mode === 'unavailable')).capture.mode).toBe('on');
    // Neither: notes are on but nothing can be captured, which everyone sees, and anyone with the link too.
    await host.setUnavailable(['transcript', 'recording']);
    expect(host.getSnapshot().capture).toMatchObject({ mode: 'unavailable', recording: { mode: 'unavailable' }, transcript: { mode: 'unavailable' }, ai: { mode: 'on' } });
    expect((await h.browser().api.calls.card(c)).capture).toMatchObject({ mode: 'unavailable', recording: { mode: 'unavailable' }, transcript: { mode: 'unavailable' } });
    expect((await settle(guest, (x) => x.capture.mode === 'unavailable')).capture.requests).toEqual([]);
    // Notes are on all the same: there's nothing to ask for, and only the organizer's browser says what it can't do.
    expect(code(await guest.requestNotes(true).catch((e: unknown) => e))).toBe('conflict');
    expect(await act(guest, { type: 'unavailable', parts: [] })).toBe(403);
    await host.setUnavailable([]);
    expect(host.getSnapshot().capture).toMatchObject({ mode: 'on', recording: { mode: 'on' }, transcript: { mode: 'on' } });

    // A pause forgets it, and what arrives while paused is from before: back on, everything says on until the browser says again.
    await host.setUnavailable(['transcript']);
    await host.pause();
    expect(host.getSnapshot().capture).toMatchObject({ mode: 'paused', recording: { mode: 'paused' }, transcript: { mode: 'paused' } });
    await host.setUnavailable(['recording']);
    await host.resume();
    expect(host.getSnapshot().capture).toMatchObject({ mode: 'on', recording: { mode: 'on' }, transcript: { mode: 'on' } });
    // So does the organizer joining again from another device: the new browser says for itself, and the old one can't.
    await host.setUnavailable(['recording', 'transcript']);
    const host2 = await (await account(orgEmail)).api.calls.join(c, { mic: true, cam: false });
    expect(host2.getSnapshot().capture).toMatchObject({ mode: 'on', recording: { mode: 'on' }, transcript: { mode: 'on' } });
    expect(code(await host.setUnavailable(['recording']).catch((e: unknown) => e))).toBe('conflict');
    await host2.leave();
  });

  it('keeps the AI part on while notes are off once they’ve been on, since catch-up, questions and the notes still read the transcript', async () => {
    const org = await account(unique('organizer'));
    const host = await org.api.calls.join((await org.api.calls.startNow({ notes: 'off' })).code, { mic: true, cam: false });
    // Never on: nothing is read either.
    expect(host.getSnapshot().capture).toMatchObject({ mode: 'off', ai: { mode: 'off', since: null, by: null } });
    expect(code(await host.catchUp({ kind: 'all' }).catch((e: unknown) => e))).toBe('conflict');
    await host.setNotes(true);
    const on = host.getSnapshot().capture.ai;
    expect(on).toMatchObject({ mode: 'on', since: expect.any(String), by: { kind: 'organizer', name: org.session.user.name } });
    await host.transcribe(speech('We agreed to ship on Friday.', 0, 0), host.ticket.identity);
    await host.setNotes(false);
    // Recording and the transcript are off; the notes model still reads what was transcribed, so it's on, since it came on.
    expect(host.getSnapshot().capture).toMatchObject({ mode: 'off', recording: { mode: 'off' }, transcript: { mode: 'off' }, ai: { mode: 'on', since: on.since, by: on.by } });
    const sent = h.near.calls.length;
    expect((await host.catchUp({ kind: 'all' })).read.lines).toBe(1);
    expect(h.near.calls.length).toBeGreaterThan(sent);
    // A pause is the one thing that stops it.
    await host.setNotes(true);
    await host.pause();
    expect(host.getSnapshot().capture.ai.mode).toBe('paused');
    await host.leave();
  });

  it('refuses audio, speech, captions, catch-up and questions while paused, keeps what came before, and resumes in a new segment', async () => {
    const org = await account();
    const host = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    await host.appendAudio(piece('before', 0, 0));
    await host.transcribe(speech('We agreed to ship on Friday.', 0, 0), host.ticket.identity);
    const lines = host.getSnapshot().transcript.map((l) => l.id);
    const guest = await h.browser().api.calls.join(host.getSnapshot().code, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);
    await host.pause();
    const sent = h.near.calls.length;
    // Whoever sends it, the server takes nothing more while paused, and nothing goes to the AI.
    const attempts: [string, () => Promise<unknown>][] = [
      ['audio', () => host.appendAudio(piece('during', 0, 1))],
      ['speech', () => host.transcribe(speech('This is off the record.', 0, 6000), host.ticket.identity)],
      ['captions', () => host.translate(lines, 'es')],
      ['catch-up', () => host.catchUp({ kind: 'all' })],
      ['a question', () => host.askSoFar('When do we ship?', { kind: 'all' })],
      ['a guest’s captions', () => guest.translate(lines, 'fr')],
      ['a guest’s catch-up', () => guest.catchUp({ kind: 'recent', minutes: 5 })]
    ];
    for (const [what, attempt] of attempts) {
      const e = await attempt().catch((x: unknown) => x);
      expect([code(e), message(e)], what).toEqual(['conflict', PAUSED]);
    }
    expect(h.near.calls.length).toBe(sent);
    const pieces = async () => (await h.pool.query('SELECT count(*)::int AS n FROM recording_pieces WHERE owner_id = $1', [org.session.ownerId])).rows[0]?.n;
    expect(await pieces()).toBe(1);
    // What was taken before the pause stays.
    expect(host.getSnapshot().transcript.map((l) => l.text)).toEqual(['We agreed to ship on Friday.']);

    // Resuming carries on in a new segment, and nothing more from the old one is taken.
    await host.resume();
    expect(host.getSnapshot().notes.recording.segment).toBe(1);
    expect(code(await host.appendAudio(piece('late', 0, 1)).catch((e: unknown) => e))).toBe('conflict');
    expect(code(await host.transcribe(speech('Late speech.', 0, 9000), host.ticket.identity).catch((e: unknown) => e))).toBe('conflict');
    await host.appendAudio(piece('after', 1, 0));
    await host.transcribe(speech('Back on the record.', 1, 0), host.ticket.identity);
    expect(await pieces()).toBe(2);
    expect(await host.translate(lines, 'es')).toEqual([{ id: lines[0], text: '[Spanish] We agreed to ship on Friday.' }]);
    await host.leave();
  });

  it('marks what wasn’t captured, in the call, a catch-up, the finished notes and what the notes model reads', async () => {
    const org = await account(unique('organizer'));
    const host = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    await host.appendAudio(piece('a', 0, 0));
    await host.transcribe(speech('We agreed to move the launch.', 0, 0), host.ticket.identity);
    // Heard after the last audio that arrived before the pause (the rest was dropped): it stays before the pause.
    await host.transcribe(speech('Kofi will send the screens.', 0, 6000), host.ticket.identity);
    await host.pause();
    await sleep(1100);
    await host.resume();
    await host.appendAudio(piece('b', 1, 0));
    await host.transcribe(speech('Back to pricing.', 1, 1000), host.ticket.identity);
    const s = host.getSnapshot();
    expect(s.capture.gaps).toEqual([{ kind: 'paused', from: expect.any(String), to: expect.any(String), at: 5 }]);
    expect(s.transcript.map((l) => [l.at, l.text])).toEqual([[0, 'We agreed to move the launch.'], [4.9, 'Kofi will send the screens.'], [6, 'Back to pricing.']]);
    // A catch-up says what it can't have in it.
    const caught = await host.catchUp({ kind: 'all' });
    expect(caught.read.gaps).toEqual(s.capture.gaps);
    expect(h.near.prompts.at(-1)).toContain('-- at 00:05 notes were paused for less than a minute: nothing said then was recorded --');
    // Off for a moment too, then on again.
    host.setNotes(false);
    await settle(host, (x) => x.capture.mode === 'off');
    await sleep(1100);
    host.setNotes(true);
    await settle(host, (x) => x.capture.mode === 'on');

    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    expect(note.gaps.map((g) => [g.kind, g.at])).toEqual([['paused', 5], ['off', 10]]);
    for (const g of note.gaps) expect(Date.parse(g.to ?? '') - Date.parse(g.from)).toBeGreaterThanOrEqual(1000);
    expect(note.transcript?.map((l) => [l.at, l.text])).toEqual([[0, 'We agreed to move the launch.'], [4.9, 'Kofi will send the screens.'], [6, 'Back to pricing.']]);
    // The notes model read where nothing was captured, and wrote nothing about it.
    const prompt = h.near.prompts.at(-1) ?? '';
    expect(prompt).toContain('[00:04] ');
    expect(prompt).toContain('-- at 00:05 notes were paused for less than a minute: nothing said then was recorded --\n[00:06] ');
    expect(prompt).toContain('-- at 00:10 notes were off for less than a minute: nothing said then was recorded --');
    expect(note.summary).toBe('Heard 3 lines. It ended on: Back to pricing.');
  });

  it('stays paused through breakout rooms, someone coming back and a new organizer connection, until the organizer resumes', async () => {
    const orgEmail = unique('organizer');
    const org = await account(orgEmail);
    const kofiEmail = unique('kofi');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [kofiEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    const kofi = await account(kofiEmail);
    const kofiCall = await kofi.api.calls.join(c, { mic: true, cam: false });
    await inGroup(kofiCall);
    await host.pause();
    // Rooms open and close: still paused.
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [] }], minutes: 5 });
    await settle(host, (x) => x.breakouts.open !== null);
    host.closeRooms();
    expect((await settle(host, (x) => x.breakouts.open === null)).capture.mode).toBe('paused');
    // Kofi comes back on another connection: what he's told before he's in is the same, without names.
    const back = await kofi.api.calls.join(c, { mic: true, cam: false });
    expect(back.getSnapshot().capture).toMatchObject({ mode: 'paused', recording: { by: { kind: 'organizer' } }, gaps: [], requests: [] });
    expect(back.getSnapshot().capture.recording.by?.name).toBeUndefined();
    await inGroup(back);
    expect((await settle(back, (x) => x.participants.some((p) => p.isMe))).capture.mode).toBe('paused');

    // The organizer joins again from another device, and the new connection takes over: still paused.
    const host2 = await (await account(orgEmail)).api.calls.join(c, { mic: true, cam: false });
    expect(host2.getSnapshot().capture).toMatchObject({ mode: 'paused', recording: { by: { kind: 'organizer', name: org.session.user.name } } });
    expect(code(await host2.appendAudio(piece('new-device', 0, 1)).catch((e: unknown) => e))).toBe('conflict');
    expect(code(await host2.transcribe(speech('Still paused.', 0, 8000), host2.ticket.identity).catch((e: unknown) => e))).toBe('conflict');
    expect((await settle(back, (x) => x.generation === host2.getSnapshot().generation)).capture.mode).toBe('paused');
    // Only the organizer saying so carries on.
    await host2.resume();
    expect(host2.getSnapshot().capture.mode).toBe('on');
    expect(host2.getSnapshot().notes.recording.segment).toBe(1);
    await host2.leave();
  });

  it('tells anyone with the link, and anyone asking to join, what is captured, and nothing else', async () => {
    const org = await account(unique('organizer'));
    const { code: c } = await org.api.calls.startNow({ notes: 'on' });
    const anyone = h.browser().api;
    // Before the organizer starts the call: what will happen.
    expect(await anyone.calls.card(c)).toMatchObject({ notes: 'on', capture: null, hostHere: false });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await host.transcribe(speech('CANARY-CAPTURE the merger closes Friday.', 0, 0), host.ticket.identity);
    expect((await anyone.calls.card(c)).capture).toMatchObject({ mode: 'on', recording: { mode: 'on', by: { kind: 'schedule' } } });
    const member = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Samwise Canary' });
    await letIn(host, member);
    await host.pause();
    await member.requestNotes(true);

    // The card, for anyone with the link: the state, and who changed it as a role, never a name.
    const card = await anyone.calls.card(c);
    expect(card.capture).toEqual({
      mode: 'paused', recording: { mode: 'paused', since: expect.any(String), by: { kind: 'organizer' } }, transcript: { mode: 'paused', since: expect.any(String), by: { kind: 'organizer' } },
      ai: { mode: 'paused', since: expect.any(String), by: { kind: 'organizer' } }, screen: { mode: 'off', since: null, by: null }, gaps: [], requests: [], asked: null, room: null
    });
    // Someone asking to join sees the same, and nobody in the call or anything said in it.
    const waiting = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Lee' });
    const w = waiting.getSnapshot();
    expect(w.capture).toEqual(card.capture);
    expect(w).toMatchObject({ participants: [], transcript: [], waiting: [], notices: [] });
    for (const shown of [JSON.stringify(card.capture), JSON.stringify(w)]) {
      for (const secret of [org.session.user.name, org.session.user.email, 'Samwise', 'CANARY-CAPTURE', member.ticket.identity]) expect(shown.includes(secret), secret).toBe(false);
    }
    // And the logs and the call's row keep it all out too.
    const logs = h.logs.join('');
    for (const secret of ['Samwise', 'CANARY-CAPTURE']) expect(logs.includes(secret), secret).toBe(false);
    const row = String((await h.pool.query('SELECT row_to_json(x)::text AS t FROM calls x WHERE call_id = $1', [host.ticket.callId])).rows[0]?.t ?? '');
    for (const secret of ['Samwise', 'Samwise Canary', 'paused', 'CANARY-CAPTURE']) expect(row.includes(secret), secret).toBe(false);
    await host.leave();
  });
});
