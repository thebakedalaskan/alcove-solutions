/**
 * Someone's own notes on a call, and what they add to the shared notes (docs: Notes and inference › Your own notes), end
 * to end: who can reach them (only their author), bookmarks reading their source again each time, answers kept only when
 * someone says so, the preview and the refusals before anything reaches the shared notes, taking it back, what happens
 * when a note goes or someone loses it, and that none of it reaches a row, a log line or a model in the clear. The real
 * API over HTTP via @alcove/api-http, real Postgres, the object store, the local LiveKit server and main's fake NEAR AI.
 */
import { AlcoveApiError, MAX_KEPT_ANSWER, MAX_KEPT_QUESTION, MAX_PERSONAL_ENTRIES, type AlcoveApi, type AudioPiece, type CallSession, type CallState, type PersonalEntry, type PersonalNotes, type ScreenFrame, type TranscriptClip } from '@alcove/api';
import { createHttpApi } from '@alcove/api-http';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screenJpeg, speechWav } from '../../testing/fake-near';
import { ORIGIN, startHarness, type Harness } from '../../testing/harness';
import { connect, disposeLiveKit, type TestParticipant } from '../../testing/livekit';

// Calls set up MLS groups and LiveKit rooms, which a busy runner can be slow to do: every wait says what it waited for.
vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
const open: TestParticipant[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map((p) => p.disconnect().catch(() => undefined))); h.closeCalls(); });

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const fails = (p: Promise<unknown>) => p.then(() => 'succeeded', (e: unknown) => code(e));
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email };
}
type Account = Awaited<ReturnType<typeof account>>;
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
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 200 && !pred(call.getSnapshot()); i++) { await call.refresh(); await sleep(30); }
  if (!pred(call.getSnapshot())) throw new Error('timed out waiting for the call to change');
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await inGroup(who);
}
/** In the group of a part of the call (the main room, or a room), holding its keys. */
const inPlace = (call: CallSession, place: string) => waitFor(() => {
  const s = call.crypto.getSnapshot();
  return s.status === 'in' && s.place === place && Boolean(s.media?.send);
}, `${call.ticket.role} in ${place === 'main' ? 'the main room' : 'a room'}`);
async function written(api: AlcoveApi, noteId: string): Promise<void> {
  for await (const p of api.notes.progress(noteId)) if (p.ready) return;
  throw new Error('the notes weren’t written');
}
const noteIdOf = (ended: { pendingNoteId: string | null } | null) => ended?.pendingNoteId ?? 'no note';
/** A call with notes on, the organizer in it, and everyone in `invited` in it too, on the invite. */
async function callWith(...invited: Account[]) {
  const org = await account(unique('organizer'));
  const { code: c } = await org.api.calls.startNow({ title: 'Planning', notes: 'on', guests: invited.map((a) => a.email) });
  const host = await org.api.calls.join(c, { mic: true, cam: false });
  await inGroup(host);
  await host.appendAudio(piece(audioBytes('audio'), 0, 0));
  const calls = await Promise.all(invited.map((a) => a.api.calls.join(c, { mic: true, cam: false })));
  await Promise.all(calls.map(inGroup));
  return { org, host, calls, code: c };
}
/** Everyone's in a call that said `words`, and it ends with the notes written. */
async function writtenNote(words: string, ...invited: Account[]) {
  const { org, host } = await callWith(...invited);
  await host.transcribe(speech(words, 0, 0), host.ticket.identity);
  await settle(host, (s) => s.transcript.length >= 1);
  const noteId = noteIdOf(await host.leave());
  await written(org.api, noteId);
  return { org, noteId };
}
const only = <T>(xs: T[]): T => { if (xs.length !== 1 || xs[0] === undefined) throw new Error(`expected one, got ${xs.length}`); return xs[0]; };
const last = (p: PersonalNotes): PersonalEntry => { const e = p.entries.at(-1); if (!e) throw new Error('nothing kept'); return e; };
const bookmark = (e: PersonalEntry | undefined) => { if (e?.kind !== 'bookmark') throw new Error('not a bookmark'); return e; };
const kept = async (noteId: string) => Number((await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM personal_notes WHERE note_item_id = $1', [noteId])).rows[0]?.n ?? -1);
const addedTo = async (noteId: string) => Number((await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM note_additions WHERE note_item_id = $1', [noteId])).rows[0]?.n ?? -1);
const encodings = (s: string) => [s, Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64').slice(0, 12), Buffer.from(s).toString('base64url').slice(0, 12)];
/** Every row of every table, as text: wherever a stored thing could turn up in the clear. */
async function allRows(): Promise<string> {
  const tables = (await h.pool.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name);
  const parts = await Promise.all(tables.map(async (t) => String((await h.pool.query(`SELECT string_agg(row_to_json(x)::text, ' ') AS all FROM "${t}" x`)).rows[0]?.all ?? '')));
  return parts.join(' ');
}

describe('your own notes in a call', () => {
  it('keeps them to you: not the organizer, not anyone else invited, not a guest, and nothing of them in the call', async () => {
    const kofi = await account(unique('kofi'));
    const lena = await account(unique('lena'));
    const { org, host, calls: [kofiCall, lenaCall], code: c } = await callWith(kofi, lena);
    if (!kofiCall || !lenaCall) throw new Error('nobody in the call');
    const guest = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, guest);

    const wrote = await kofiCall.personal.add({ kind: 'note', text: 'PRIVATE-WORDS ask about the budget' });
    const id = last(wrote).id;
    expect(last(await kofiCall.personal.add({ kind: 'bookmark', label: 'PRIVATE-LABEL this one', point: null }))).toMatchObject({ kind: 'bookmark', label: 'PRIVATE-LABEL this one' });
    expect((await kofiCall.personal.get()).entries.map((e) => e.kind)).toEqual(['note', 'bookmark']);

    // Nobody else's own notes have them, and the organizer's keys aren't what they're sealed under.
    expect((await host.personal.get()).entries).toEqual([]);
    expect((await lenaCall.personal.get()).entries).toEqual([]);
    // An entry that isn't yours isn't there to find, as with one that never was.
    expect(await fails(host.personal.edit(id, 'changed'))).toBe('not-found');
    expect(await fails(host.personal.remove(id))).toBe('not-found');
    expect(await fails(lenaCall.personal.remove('nothing'))).toBe('not-found');
    expect(await fails(lenaCall.personal.edit(id, 'changed'))).toBe('not-found');

    // Someone with only the link has no account to keep anything under.
    expect(await fails(guest.personal.get())).toBe('forbidden');
    expect(await fails(guest.personal.add({ kind: 'note', text: 'mine' }))).toBe('forbidden');

    // A pass is no way in: it takes the session of whoever joined with it.
    const raw = (f: typeof fetch, call: CallSession) => f(`${h.baseUrl}/v1/live/calls/${call.ticket.callId}/personal`, { headers: { origin: ORIGIN, 'x-alcove-call': call.ticket.pass } });
    expect((await raw(lena.fetch, kofiCall)).status).toBe(403);
    expect((await raw(org.fetch, kofiCall)).status).toBe(403);
    expect((await raw(fetch, kofiCall)).status).toBe(401);
    expect((await raw(lena.fetch, host)).status).toBe(403);
    expect((await fetch(`${h.baseUrl}/v1/live/calls/${host.ticket.callId}/personal`, { headers: { origin: ORIGIN, 'x-alcove-call': 'made-up' } })).status).toBe(401);

    // Nothing of them goes into the call, or to anyone else's screen.
    await lenaCall.refresh();
    for (const s of [host, lenaCall, guest]) expect(JSON.stringify(s.getSnapshot())).not.toContain('PRIVATE');

    await host.transcribe(speech('The merger closes on Friday.', 0, 0), host.ticket.identity);
    await settle(host, (s) => s.transcript.length >= 1);
    const noteId = noteIdOf(await host.leave());
    await written(org.api, noteId);

    // Once the call has ended they're with the note, for their author alone.
    expect(await fails(host.personal.get())).toBe('conflict');
    expect((await kofi.api.notes.personal(noteId).get()).entries.map((e) => e.kind)).toEqual(['note', 'bookmark']);
    expect((await org.api.notes.personal(noteId).get()).entries).toEqual([]);
    expect((await lena.api.notes.personal(noteId).get()).entries).toEqual([]);
    for (const b of [org, kofi, lena]) expect(JSON.stringify(await b.api.notes.get(noteId))).not.toContain('PRIVATE');
    expect(await fails(org.api.notes.personal(noteId).edit(id, 'changed'))).toBe('not-found');
    expect(await fails(lena.api.notes.personal(noteId).remove(id))).toBe('not-found');

    // Someone who doesn't have the note can't reach anything on it, their own or anyone's.
    const stranger = await account(unique('stranger'));
    expect(await fails(stranger.api.notes.personal(noteId).get())).toBe('not-found');
    expect(await fails(stranger.api.notes.personal(noteId).add({ kind: 'note', text: 'mine' }))).toBe('not-found');
    expect(await kept(noteId)).toBe(1);

    // They're yours to change and delete, and the last one takes the row with it.
    expect(last(await kofi.api.notes.personal(noteId).edit(id, 'changed my mind'))).toMatchObject({ kind: 'bookmark' });
    expect((await kofi.api.notes.personal(noteId).get()).entries[0]).toMatchObject({ id, kind: 'note', text: 'changed my mind' });
    expect(await fails(kofi.api.notes.personal(noteId).edit(id, ''))).toBe('invalid');
    for (const e of (await kofi.api.notes.personal(noteId).get()).entries) await kofi.api.notes.personal(noteId).remove(e.id);
    expect(await kept(noteId)).toBe(0);
  });

  it('goes with the call’s notes: nothing to keep them with until notes have been on, and they stay while notes are paused', async () => {
    const org = await account(unique('organizer'));
    const { code: c } = await org.api.calls.startNow({ title: 'No notes', notes: 'off', guests: [] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    expect(await fails(host.personal.get())).toBe('conflict');
    await host.setNotes(true);
    await host.appendAudio(piece(audioBytes('audio'), 0, 0));
    await host.personal.add({ kind: 'note', text: 'Now they can.' });
    await host.pause();
    // Your own words aren't capture: they're for you, and nothing reaches the AI.
    const held = bookmark(last(await host.personal.add({ kind: 'bookmark', label: 'Off the record', point: null })));
    expect(held).toMatchObject({ reach: 'none', moment: null });
    expect((await host.personal.get()).entries).toHaveLength(2);
  });

  it('holds as much as it says it does, and says so when it’s full', async () => {
    const { org, noteId } = await writtenNote('The merger closes on Friday.');
    // Two API processes, so the writes fit within each one's limit on writing to your own notes.
    const second = await h.secondServer();
    try {
      const other = createHttpApi({ baseUrl: second.baseUrl, fetch: org.fetch }).notes.personal(noteId);
      const here = org.api.notes.personal(noteId);
      for (let i = 0; i < MAX_PERSONAL_ENTRIES; i++) await (i % 2 ? other : here).add({ kind: 'note', text: `Note ${i}` });
      expect(await fails(here.add({ kind: 'note', text: 'One more' }))).toBe('conflict');
      const all = await here.get();
      expect(all.entries).toHaveLength(MAX_PERSONAL_ENTRIES);
      // Deleting one makes room.
      await other.remove(last(all).id);
      expect((await here.add({ kind: 'note', text: 'One more' })).entries).toHaveLength(MAX_PERSONAL_ENTRIES);
    } finally { await second.close(); }
  });
});

describe('bookmarks', () => {
  it('open only what you may read now, as the call’s own rule says, and everything once the note is written', async () => {
    const kofi = await account(unique('kofi'));
    const lena = await account(unique('lena'));
    const { org, host, calls: [kofiCall, lenaCall] } = await callWith(kofi, lena);
    if (!kofiCall || !lenaCall) throw new Error('nobody in the call');
    await host.transcribe(speech('The merger closes on Friday.', 0, 0), host.ticket.identity);
    const mainLine = (await settle(kofiCall, (s) => s.transcript.length >= 1)).transcript[0]?.id ?? '';

    // "Mark this": the line just said, read when it's opened, however soon after it was said.
    const marked = bookmark(last(await kofiCall.personal.add({ kind: 'bookmark', label: '', point: null })));
    expect(marked).toMatchObject({ reach: 'open', moment: { line: { id: mainLine, text: 'The merger closes on Friday.' } } });
    // A line by its ID, once: bookmarking it again changes nothing.
    const byLine = bookmark(last(await kofiCall.personal.add({ kind: 'bookmark', label: 'Friday', point: { kind: 'line', lineId: mainLine } })));
    expect(byLine).toMatchObject({ reach: 'open', moment: { line: { id: mainLine } } });
    expect((await kofiCall.personal.add({ kind: 'bookmark', label: 'Again', point: { kind: 'line', lineId: mainLine } })).entries).toHaveLength(2);

    // A line that was never said, a shared screen during a call, and a moment by its second aren't there to bookmark.
    expect(await fails(kofiCall.personal.add({ kind: 'bookmark', label: '', point: { kind: 'line', lineId: 'made-up' } }))).toBe('not-found');
    expect(await fails(kofiCall.personal.add({ kind: 'bookmark', label: '', point: { kind: 'screen', frameId: 'made-up' } }))).toBe('not-found');

    // Rooms open, each with its own transcript.
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email] }, { name: 'Support', emails: [lena.email] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
    const rooms = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms ?? [];
    const design = rooms[0]?.id ?? '';
    await inPlace(kofiCall, design);
    await inPlace(lenaCall, rooms[1]?.id ?? '');
    await settle(kofiCall, (x) => x.capture.room?.scribe === kofiCall.ticket.identity);
    await kofiCall.transcribe(speech('The logo stays blue.', 0, 2000), kofiCall.ticket.identity);
    const roomLine = (await settle(kofiCall, (s) => s.transcript.some((l) => l.text === 'The logo stays blue.'))).transcript.find((l) => l.text === 'The logo stays blue.')?.id ?? '';

    // From the room, what was said in the main room can't be read: the bookmark stays, and says nothing of what it points at.
    const fromRoom = (await kofiCall.personal.get()).entries.map(bookmark);
    expect(fromRoom.map((b) => [b.reach, b.moment])).toEqual([['later', null], ['later', null]]);
    expect(await fails(kofiCall.moment(mainLine))).toBe('not-found');

    // What's said in a room is for the people there. Lena and the organizer can't bookmark it, and asking looks the same as asking for nothing.
    expect(await fails(lenaCall.personal.add({ kind: 'bookmark', label: '', point: { kind: 'line', lineId: roomLine } }))).toBe('not-found');
    expect(await fails(host.personal.add({ kind: 'bookmark', label: '', point: { kind: 'line', lineId: roomLine } }))).toBe('not-found');
    const inRoom = bookmark(last(await kofiCall.personal.add({ kind: 'bookmark', label: 'Blue', point: { kind: 'line', lineId: roomLine } })));
    expect(inRoom).toMatchObject({ reach: 'open', moment: { line: { id: roomLine }, room: { id: design, name: 'Design' } } });
    const markedInRoom = bookmark(last(await kofiCall.personal.add({ kind: 'bookmark', label: '', point: null })));
    expect(markedInRoom).toMatchObject({ reach: 'open', moment: { line: { id: roomLine } } });

    // Back in the main room it's the other way round, and opening the room's line is refused again.
    host.closeRooms();
    await inPlace(kofiCall, 'main');
    const back = (await kofiCall.personal.get()).entries.map(bookmark);
    expect(back.map((b) => b.reach)).toEqual(['open', 'open', 'later', 'later']);
    expect(await fails(kofiCall.moment(roomLine))).toBe('not-found');

    // Everyone with the notes reads every room's section, so once they're written all of it opens.
    const noteId = noteIdOf(await host.leave());
    await written(org.api, noteId);
    const after = (await kofi.api.notes.personal(noteId).get()).entries.map(bookmark);
    expect(after.map((b) => b.reach)).toEqual(['open', 'open', 'open', 'open']);
    expect(after.map((b) => b.moment?.line?.id)).toEqual([mainLine, mainLine, roomLine, roomLine]);
    expect(after.map((b) => b.moment?.room?.name)).toEqual([undefined, undefined, 'Design', 'Design']);

    // Removing the note from yours closes all of it, and takes your own notes with it.
    await kofi.api.notes.delete(noteId);
    expect(await fails(kofi.api.notes.personal(noteId).get())).toBe('not-found');
    expect(await kept(noteId)).toBe(0);
  });

  it('points at lines and shared screens of this note and no other, and a mark while nothing is captured stays yours', async () => {
    const lena = await account(unique('lena'));
    const { org, host, calls: [lenaCall] } = await callWith(lena);
    if (!lenaCall) throw new Error('nobody in the call');
    await host.transcribe(speech('Look at the chart.', 0, 0), host.ticket.identity);
    await settle(host, (s) => s.transcript.length >= 1);
    await host.setScreens(true);
    await inGroup(lenaCall);
    const room = await connect(await lenaCall.room(), { sending: lenaCall.crypto });
    open.push(room);
    const { screen } = await room.publishScreen(false);
    for (let i = 0; i < 300 && !(await h.deps.livekit.screenShares(room.room.name ?? '')).some((x) => x.sid === screen); i++) await sleep(50);
    const frame: ScreenFrame = { data: new Blob([screenJpeg({ title: 'Q3 sign-ups', lines: ['Q3 sign-ups by week'] }, 1280, 720, 'one')], { type: 'image/jpeg' }), share: screen, takenAt: Date.now() };
    await lenaCall.shareFrame(frame);
    const noteId = noteIdOf(await host.leave());
    await written(org.api, noteId);
    const note = await lena.api.notes.get(noteId);
    const frameId = only(note.screens).id;
    const lineId = only(note.transcript ?? []).id;

    const mine = lena.api.notes.personal(noteId);
    expect(bookmark(last(await mine.add({ kind: 'bookmark', label: 'The chart', point: { kind: 'screen', frameId } })))).toMatchObject({ reach: 'open', moment: { screen: { id: frameId, title: 'Q3 sign-ups' } } });
    expect(bookmark(last(await mine.add({ kind: 'bookmark', label: '', point: { kind: 'line', lineId } })))).toMatchObject({ reach: 'open', moment: { line: { id: lineId, text: 'Look at the chart.' } } });

    // Another note's line or screen, or something that isn't there, is not found here. Without a call there's no "now".
    const other = await writtenNote('Something else entirely.');
    const theirs = only((await other.org.api.notes.get(other.noteId)).transcript ?? []).id;
    const own = other.org.api.notes.personal(other.noteId);
    expect(await fails(own.add({ kind: 'bookmark', label: '', point: { kind: 'line', lineId } }))).toBe('not-found');
    expect(await fails(mine.add({ kind: 'bookmark', label: '', point: { kind: 'line', lineId: theirs } }))).toBe('not-found');
    expect(await fails(own.add({ kind: 'bookmark', label: '', point: { kind: 'screen', frameId } }))).toBe('not-found');
    expect(await fails(own.add({ kind: 'bookmark', label: '', point: null }))).toBe('invalid');
    expect(await fails(own.add({ kind: 'bookmark', label: '', point: { kind: 'moment', at: 100_000 } }))).toBe('not-found');
  });
});

describe('answers you keep', () => {
  it('keeps one only when you say so, with only moments you may read, and for you alone', async () => {
    const kofi = await account(unique('kofi'));
    const lena = await account(unique('lena'));
    const { org, host, calls: [kofiCall, lenaCall] } = await callWith(kofi, lena);
    if (!kofiCall || !lenaCall) throw new Error('nobody in the call');
    await host.transcribe(speech('The merger closes on Friday.', 0, 0), host.ticket.identity);
    await settle(kofiCall, (s) => s.transcript.length >= 1);

    // Asking keeps nothing, as ever.
    const a = await kofiCall.askSoFar('What closes on Friday? PRIVATE-QUESTION', { kind: 'all' });
    expect(a.evidence.length).toBeGreaterThan(0);
    const noteId = host.getSnapshot().notes.noteId ?? '';
    expect(await kept(noteId)).toBe(0);

    const lineId = a.evidence[0]?.lineId ?? '';
    const saved = last(await kofiCall.personal.add({
      kind: 'answer', question: 'What closes on Friday? PRIVATE-QUESTION', answer: a.text,
      // Only moments he may read are kept, whatever a browser says.
      points: [{ kind: 'line', lineId }, { kind: 'line', lineId: 'made-up' }, { kind: 'screen', frameId: 'made-up' }]
    }));
    expect(saved).toMatchObject({ kind: 'answer', answer: a.text, moments: [{ line: { id: lineId } }] });
    expect((await lenaCall.personal.get()).entries).toEqual([]);
    expect((await host.personal.get()).entries).toEqual([]);
    // A kept answer stays what it was.
    expect(await fails(kofiCall.personal.edit(saved.id, 'Something else'))).toBe('conflict');

    const ended = await host.leave();
    await written(org.api, noteIdOf(ended));

    // After the call, the same: asking keeps nothing until you say so, and its moments are this note's.
    const parts: { type: string; at?: number; id?: string }[] = [];
    for await (const p of kofi.api.notes.ask(noteId, 'What closes on Friday?')) parts.push(p);
    const at = parts.find((p) => p.type === 'cite')?.at ?? -1;
    expect(at).toBeGreaterThanOrEqual(0);
    const mine = kofi.api.notes.personal(noteId);
    expect((await mine.get()).entries).toHaveLength(1);
    const again = last(await mine.add({ kind: 'answer', question: 'What closes on Friday?', answer: 'Friday, the merger.', points: [{ kind: 'moment', at }, { kind: 'moment', at: 100_000 }] }));
    expect(again).toMatchObject({ kind: 'answer', moments: [{ line: { id: lineId, text: 'The merger closes on Friday.' } }] });
    expect((await lena.api.notes.personal(noteId).get()).entries).toEqual([]);
    expect(JSON.stringify(await lena.api.notes.get(noteId))).not.toContain('PRIVATE');
  });

  it('reads a cite as the line nearest its second, in the call or a breakout room’s section, and shares that line', async () => {
    const kofi = await account(unique('kofi'));
    const lena = await account(unique('lena'));
    const { org, host, calls: [kofiCall, lenaCall] } = await callWith(kofi, lena);
    if (!kofiCall || !lenaCall) throw new Error('nobody in the call');
    // Over two minutes recorded: a note keeps its lines inside the audio it has, so these stay where they were said.
    for (let i = 1; i <= 25; i++) await host.appendAudio(piece(audioBytes('audio'), 0, i));
    await host.transcribe(speech('The merger closes on Friday.', 0, 28_000), host.ticket.identity);
    await host.transcribe(speech('Legal signs on Thursday.', 0, 30_600), host.ticket.identity);
    // Two minutes in when the rooms open: a room's lines are placed by the server's clock.
    await h.pool.query(`UPDATE calls SET started_at = started_at - interval '2 minutes' WHERE call_id = $1`, [host.ticket.callId]);
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email] }, { name: 'Support', emails: [lena.email] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
    const rooms = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms ?? [];
    await inPlace(kofiCall, rooms[0]?.id ?? '');
    await inPlace(lenaCall, rooms[1]?.id ?? '');
    await settle(kofiCall, (x) => x.capture.room?.scribe === kofiCall.ticket.identity);
    await kofiCall.transcribe(speech('The logo stays blue.', 0, 2000), kofiCall.ticket.identity);
    const blue = (await settle(kofiCall, (s) => s.transcript.some((l) => l.text === 'The logo stays blue.'))).transcript.find((l) => l.text === 'The logo stays blue.');
    if (!blue) throw new Error('nothing said in the room');
    // What a cite says: the second the model was shown, rounded down. The call says something just before it, further off.
    const cited = Math.floor(blue.at);
    await host.transcribe(speech('Support is quiet this week.', 0, (cited - 1.5) * 1000), host.ticket.identity);
    await settle(host, (s) => s.transcript.some((l) => l.text === 'Support is quiet this week.'));
    host.closeRooms();
    await inPlace(kofiCall, 'main');
    const noteId = noteIdOf(await host.leave());
    await written(org.api, noteId);

    const mine = kofi.api.notes.personal(noteId);
    const cite = async (at: number) => last(await mine.add({ kind: 'answer', question: 'Where was that?', answer: 'There.', points: [{ kind: 'moment', at }] }));

    // The line it names, not the last one before it: said at 30.6, it was shown as 00:30.
    expect(await cite(30)).toMatchObject({ moments: [{ line: { text: 'Legal signs on Thursday.' } }] });

    // In a room's section, with the call talking just before it.
    const answer = await cite(cited);
    const inDesign = { line: { id: blue.id, text: 'The logo stays blue.' }, room: { name: 'Design' } };
    expect(answer).toMatchObject({ moments: [inDesign] });

    // That's what everyone checks it against.
    const p = await kofi.api.notes.previewAddition(noteId, answer.id);
    expect(p).toMatchObject({ moments: [inDesign] });
    await kofi.api.notes.addToShared(noteId, answer.id, { text: p.text, seal: p.seal });
    expect(only((await lena.api.notes.get(noteId)).additions)).toMatchObject({ moments: [inDesign] });

    // A second nothing was said near means no line: it doesn't borrow the last one, so the answer stays yours.
    const made = await cite(60);
    expect(made).toMatchObject({ moments: [] });
    expect(await fails(kofi.api.notes.previewAddition(noteId, made.id))).toBe('conflict');
  });

  it('keeps the longest answer there is, in any script, and it can go to the shared notes', async () => {
    const kofi = await account(unique('kofi'));
    const lena = await account(unique('lena'));
    const { noteId } = await writtenNote('The merger closes on Friday.', kofi, lena);
    const mine = kofi.api.notes.personal(noteId);
    const lineId = only((await kofi.api.notes.get(noteId)).transcript ?? []).id;
    // Three bytes a character, to the limit: a draft well past what one answer used to be able to hold.
    const long = '語'.repeat(MAX_KEPT_ANSWER);
    const saved = last(await mine.add({ kind: 'answer', question: '語'.repeat(MAX_KEPT_QUESTION), answer: long, points: [{ kind: 'line', lineId }] }));
    expect(saved).toMatchObject({ kind: 'answer', answer: long });
    const p = await kofi.api.notes.previewAddition(noteId, saved.id);
    await kofi.api.notes.addToShared(noteId, saved.id, { text: p.text, seal: p.seal });
    expect(only((await lena.api.notes.get(noteId)).additions).text).toBe(long);
    expect(await fails(mine.add({ kind: 'answer', question: 'Too long?', answer: `${long}語`, points: [] }))).toBe('invalid');
  });
});

describe('adding to the shared notes', () => {
  it('shows exactly what goes, where and who gets it, and sends only that, only when asked', async () => {
    const kofi = await account(unique('kofi'));
    const lena = await account(unique('lena'));
    const { org, noteId } = await writtenNote('The merger closes on Friday.', kofi, lena);
    const mine = kofi.api.notes.personal(noteId);
    const entry = last(await mine.add({ kind: 'note', text: 'PRIVATE-AROUND keep this to myself. Share this bit.' }));
    await mine.add({ kind: 'note', text: 'PRIVATE-OTHER nothing to do with it.' });

    const preview = await kofi.api.notes.previewAddition(noteId, entry.id);
    expect(preview).toMatchObject({ entryId: entry.id, text: 'PRIVATE-AROUND keep this to myself. Share this bit.', moments: [], destination: { noteId, title: 'Planning' } });
    expect(preview.audience.map((p) => p.email).sort()).toEqual([org.email, kofi.email, lena.email].sort());
    // A preview sends nothing.
    expect(await addedTo(noteId)).toBe(0);
    expect((await lena.api.notes.get(noteId)).additions).toEqual([]);

    // Only the words left in the preview go, and nothing around them.
    const note = await kofi.api.notes.addToShared(noteId, entry.id, { text: 'Share this bit.', seal: preview.seal });
    expect(only(note.additions)).toMatchObject({ text: 'Share this bit.', by: { email: kofi.email }, removable: true, moments: [] });
    const seen = await lena.api.notes.get(noteId);
    expect(only(seen.additions)).toMatchObject({ text: 'Share this bit.', by: { email: kofi.email }, removable: false });
    expect(JSON.stringify(seen)).not.toContain('PRIVATE');
    expect(only((await org.api.notes.get(noteId)).additions).removable).toBe(true);

    // Your own stays yours and says where the copy is, and it doesn't go twice.
    const after = (await mine.get()).entries.find((e) => e.id === entry.id);
    expect(after).toMatchObject({ text: 'PRIVATE-AROUND keep this to myself. Share this bit.', shared: { additionId: only(note.additions).id } });
    expect(await fails(kofi.api.notes.previewAddition(noteId, entry.id).then((p) => kofi.api.notes.addToShared(noteId, entry.id, { text: 'Again', seal: p.seal })))).toBe('conflict');
  });

  it('refuses a preview that no longer holds, anyone else’s entry, and anything without words or a moment', async () => {
    const kofi = await account(unique('kofi'));
    const lena = await account(unique('lena'));
    const { org, noteId } = await writtenNote('The merger closes on Friday.', kofi, lena);
    const mine = kofi.api.notes.personal(noteId);
    const entry = last(await mine.add({ kind: 'note', text: 'For everyone.' }));

    // Nothing goes without a preview's seal, and only this entry's will do.
    expect(await fails(kofi.api.notes.addToShared(noteId, entry.id, { text: 'For everyone.', seal: 'made-up' }))).toBe('conflict');
    const other = last(await mine.add({ kind: 'bookmark', label: 'Friday', point: { kind: 'moment', at: 0 } }));
    const otherSeal = (await kofi.api.notes.previewAddition(noteId, other.id)).seal;
    expect(await fails(kofi.api.notes.addToShared(noteId, entry.id, { text: 'For everyone.', seal: otherSeal }))).toBe('conflict');

    // Whoever else has the notes changing after the preview means looking again: it can't reach more people than you saw.
    const first = await kofi.api.notes.previewAddition(noteId, entry.id);
    const newcomer = unique('newcomer');
    await org.api.notes.share(noteId, { emails: [newcomer] });
    expect(await fails(kofi.api.notes.addToShared(noteId, entry.id, { text: 'For everyone.', seal: first.seal }))).toBe('conflict');
    expect(await addedTo(noteId)).toBe(0);
    const second = await kofi.api.notes.previewAddition(noteId, entry.id);
    expect(second.audience.map((p) => p.email)).toContain(newcomer);
    expect(second.seal).not.toBe(first.seal);

    // Someone else's seal isn't yours either: it's keyed by your account.
    const lenaEntry = last(await lena.api.notes.personal(noteId).add({ kind: 'note', text: 'Lena’s.' }));
    expect(await fails(lena.api.notes.addToShared(noteId, lenaEntry.id, { text: 'Lena’s.', seal: second.seal }))).toBe('conflict');

    // Anyone else's entry isn't there to find; nor are the notes, without having them.
    for (const b of [org, lena]) {
      expect(await fails(b.api.notes.previewAddition(noteId, entry.id))).toBe('not-found');
      expect(await fails(b.api.notes.addToShared(noteId, entry.id, { text: 'Taken', seal: second.seal }))).toBe('not-found');
    }
    const stranger = await account(unique('stranger'));
    expect(await fails(stranger.api.notes.previewAddition(noteId, entry.id))).toBe('not-found');
    expect(await fails(stranger.api.notes.addToShared(noteId, entry.id, { text: 'Taken', seal: second.seal }))).toBe('not-found');

    // Words, or a moment: an entry with neither left adds nothing.
    expect(await fails(kofi.api.notes.addToShared(noteId, entry.id, { text: '', seal: second.seal }))).toBe('invalid');
    expect(await addedTo(noteId)).toBe(0);
  });

  it('waits for the notes to be written, when the people who get them are settled', async () => {
    const { org, host } = await callWith();
    await host.transcribe(speech('Nothing to see yet.', 0, 0), host.ticket.identity);
    const noteId = (await settle(host, (s) => s.transcript.length >= 1)).notes.noteId ?? '';
    const entry = last(await host.personal.add({ kind: 'note', text: 'Written in the call.' }));
    expect(await fails(org.api.notes.previewAddition(noteId, entry.id))).toBe('conflict');
    // It's the same entry from the note: one record for each person and note.
    expect((await org.api.notes.personal(noteId).get()).entries.map((e) => e.id)).toEqual([entry.id]);
    await host.leave();
    await written(org.api, noteId);
    expect((await org.api.notes.previewAddition(noteId, entry.id)).text).toBe('Written in the call.');
  });

  it('sends a bookmark’s words and moment, and an answer only with moments everyone can check, never the question', async () => {
    const kofi = await account(unique('kofi'));
    const lena = await account(unique('lena'));
    const { noteId } = await writtenNote('The merger closes on Friday.', kofi, lena);
    const mine = kofi.api.notes.personal(noteId);
    const lineId = only((await kofi.api.notes.get(noteId)).transcript ?? []).id;

    // A bookmark: what you called it and what it points at; someone reading gets the line as they may read it.
    const mark = last(await mine.add({ kind: 'bookmark', label: 'Worth saying again', point: { kind: 'line', lineId } }));
    const p1 = await kofi.api.notes.previewAddition(noteId, mark.id);
    expect(p1).toMatchObject({ text: 'Worth saying again', moments: [{ line: { id: lineId } }] });
    await kofi.api.notes.addToShared(noteId, mark.id, { text: p1.text, seal: p1.seal });
    expect(only((await lena.api.notes.get(noteId)).additions)).toMatchObject({ text: 'Worth saying again', moments: [{ line: { id: lineId, text: 'The merger closes on Friday.' } }] });

    // A moment with nothing said about it can go too: the note says what was said there.
    const bare = last(await mine.add({ kind: 'bookmark', label: '', point: { kind: 'moment', at: 0 } }));
    const p2 = await kofi.api.notes.previewAddition(noteId, bare.id);
    expect(p2).toMatchObject({ text: '', moments: [{ line: { id: lineId } }] });
    await kofi.api.notes.addToShared(noteId, bare.id, { text: '', seal: p2.seal });

    // An answer: its words, and never the question that was asked.
    const asked = last(await mine.add({ kind: 'answer', question: 'PRIVATE-QUESTION what closes?', answer: 'The merger closes on Friday.', points: [{ kind: 'line', lineId }] }));
    const p3 = await kofi.api.notes.previewAddition(noteId, asked.id);
    expect(p3.text).toBe('The merger closes on Friday.');
    expect(JSON.stringify(p3)).not.toContain('PRIVATE');
    await kofi.api.notes.addToShared(noteId, asked.id, { text: p3.text, seal: p3.seal });
    expect(JSON.stringify(await lena.api.notes.get(noteId))).not.toContain('PRIVATE');

    // An answer with nothing in these notes behind it stays yours: nobody reading it could check it.
    const loose = last(await mine.add({ kind: 'answer', question: 'What about next year?', answer: 'Nobody said.', points: [] }));
    expect(await fails(kofi.api.notes.previewAddition(noteId, loose.id))).toBe('conflict');
    expect(await fails(kofi.api.notes.addToShared(noteId, loose.id, { text: 'Nobody said.', seal: p3.seal }))).toBe('conflict');
  });

  it('adds nothing for a bookmark of nothing, and a bookmark’s words without a moment there’s nothing at', async () => {
    const { org, host } = await callWith();
    const noteId = noteIdOf(await host.leave());
    await written(org.api, noteId);
    const mine = org.api.notes.personal(noteId);
    // Nothing was said, so there's nothing at this moment for the notes to show.
    const bare = bookmark(last(await mine.add({ kind: 'bookmark', label: '', point: { kind: 'moment', at: 0 } })));
    expect(bare).toMatchObject({ reach: 'none', moment: null });
    expect(await fails(org.api.notes.previewAddition(noteId, bare.id))).toBe('conflict');
    // What you called it is yours to share, and goes without pointing at anything.
    const named = last(await mine.add({ kind: 'bookmark', label: 'Come back to this', point: { kind: 'moment', at: 0 } }));
    const p = await org.api.notes.previewAddition(noteId, named.id);
    expect(p).toMatchObject({ text: 'Come back to this', moments: [] });
    expect(only((await org.api.notes.addToShared(noteId, named.id, { text: p.text, seal: p.seal })).additions)).toMatchObject({ text: 'Come back to this', moments: [] });
  });

  it('is taken back for good by whoever added it, or by the organizer, and by nobody else', async () => {
    const kofi = await account(unique('kofi'));
    const lena = await account(unique('lena'));
    const { org, noteId } = await writtenNote('The merger closes on Friday.', kofi, lena);
    const mine = kofi.api.notes.personal(noteId);
    const add = async (text: string) => {
      const e = last(await mine.add({ kind: 'note', text }));
      const p = await kofi.api.notes.previewAddition(noteId, e.id);
      return { entry: e, addition: only((await kofi.api.notes.addToShared(noteId, e.id, { text, seal: p.seal })).additions.filter((a) => a.text === text)) };
    };
    const { entry, addition } = await add('PRIVATE-TAKEN-BACK a thought.');
    const before = await h.pool.query<{ body_ciphertext: Buffer }>('SELECT body_ciphertext FROM note_additions WHERE addition_id = $1', [addition.id]);
    expect(before.rowCount).toBe(1);

    // Having the notes isn't enough; nor is an addition from another note on this one.
    expect(await fails(lena.api.notes.takeBack(noteId, addition.id))).toBe('forbidden');
    const other = await writtenNote('Something else.');
    expect(await fails(other.org.api.notes.takeBack(other.noteId, addition.id))).toBe('not-found');
    expect(await fails((await account()).api.notes.takeBack(noteId, addition.id))).toBe('not-found');
    expect(await addedTo(noteId)).toBe(1);

    // Taking it back removes it for everyone, physically: its row, not a new revision that leaves it in an old one.
    const revisions = async () => Number((await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM revisions WHERE item_id = $1', [noteId])).rows[0]?.n ?? -1);
    const held = await revisions();
    expect((await kofi.api.notes.takeBack(noteId, addition.id)).additions).toEqual([]);
    expect((await lena.api.notes.get(noteId)).additions).toEqual([]);
    expect(await addedTo(noteId)).toBe(0);
    expect(await revisions()).toBe(held);
    expect(await fails(kofi.api.notes.takeBack(noteId, addition.id))).toBe('not-found');

    // What it came from stays yours, no longer marked as shared, and can go again.
    expect((await mine.get()).entries.find((e) => e.id === entry.id)).toMatchObject({ shared: null });
    const p = await kofi.api.notes.previewAddition(noteId, entry.id);
    await kofi.api.notes.addToShared(noteId, entry.id, { text: 'Said better.', seal: p.seal });

    // The organizer can take anything out of their own notes, and the author's entry says so.
    const again = only((await lena.api.notes.get(noteId)).additions);
    expect((await org.api.notes.takeBack(noteId, again.id)).additions).toEqual([]);
    expect((await mine.get()).entries.find((e) => e.id === entry.id)).toMatchObject({ shared: null });

    // Deleting the entry doesn't reach into the shared notes: it's a copy, and it's taken back there.
    const { entry: gone, addition: stays } = await add('Stays until taken back.');
    await mine.remove(gone.id);
    expect((await lena.api.notes.get(noteId)).additions.map((a) => a.id)).toEqual([stays.id]);
    expect((await kofi.api.notes.get(noteId)).additions.map((a) => a.removable)).toEqual([true]);
  });
});

describe('when notes go', () => {
  /** Someone adds something to a note and keeps something of their own on it. */
  async function adds(who: Account, noteId: string, words: string) {
    const mine = who.api.notes.personal(noteId);
    await mine.add({ kind: 'note', text: `PRIVATE-${words}` });
    const e = last(await mine.add({ kind: 'note', text: words }));
    const p = await who.api.notes.previewAddition(noteId, e.id);
    await who.api.notes.addToShared(noteId, e.id, { text: words, seal: p.seal });
  }

  it('deletes your own notes when you remove the note from yours, and leaves what you shared with the notes', async () => {
    const kofi = await account(unique('kofi'));
    const lena = await account(unique('lena'));
    const { org, noteId } = await writtenNote('The merger closes on Friday.', kofi, lena);
    await adds(kofi, noteId, 'Kofi shared this.');
    await lena.api.notes.personal(noteId).add({ kind: 'note', text: 'Lena’s own.' });
    expect(await kept(noteId)).toBe(2);

    await kofi.api.notes.delete(noteId);
    // Gone in the same step, and only his: they could quote the note, and he no longer has it.
    expect(await kept(noteId)).toBe(1);
    expect(await fails(kofi.api.notes.personal(noteId).get())).toBe('not-found');
    expect((await lena.api.notes.personal(noteId).get()).entries).toHaveLength(1);
    // What he chose to share stays with the notes, as the notes he shared on do, and he can't reach it from outside.
    const added = only((await lena.api.notes.get(noteId)).additions);
    expect(added).toMatchObject({ text: 'Kofi shared this.', by: { email: kofi.email } });
    expect(await fails(kofi.api.notes.takeBack(noteId, added.id))).toBe('not-found');

    // Given the notes again, he starts over: nothing came back.
    await org.api.notes.share(noteId, { emails: [kofi.email] });
    expect((await kofi.api.notes.personal(noteId).get()).entries).toEqual([]);
  });

  it('deletes everyone’s own notes and everything added when the organizer deletes the note', async () => {
    const kofi = await account(unique('kofi'));
    const { org, noteId } = await writtenNote('The merger closes on Friday.', kofi);
    await adds(kofi, noteId, 'Kofi shared this.');
    await adds(org, noteId, 'The organizer shared this.');
    expect([await kept(noteId), await addedTo(noteId)]).toEqual([2, 2]);
    await org.api.notes.delete(noteId);
    expect([await kept(noteId), await addedTo(noteId)]).toEqual([0, 0]);
    expect(await fails(kofi.api.notes.personal(noteId).get())).toBe('not-found');
    // Nothing of it is left under anyone's account either.
    expect((await h.pool.query('SELECT 1 FROM operations WHERE owner_id = $1', [kofi.session.ownerId])).rowCount).toBe(0);
  });

  it('never brings your own notes back when you remove the note as you add from them', async () => {
    const kofi = await account(unique('kofi'));
    const { noteId } = await writtenNote('The merger closes on Friday.', kofi);
    const mine = kofi.api.notes.personal(noteId);
    const e = last(await mine.add({ kind: 'note', text: 'Add this.' }));
    const p = await kofi.api.notes.previewAddition(noteId, e.id);
    // Whichever gets there first, the note isn't his afterwards, so nothing of his own is left on it.
    await Promise.allSettled([kofi.api.notes.addToShared(noteId, e.id, { text: 'Add this.', seal: p.seal }), kofi.api.notes.delete(noteId)]);
    expect(await kept(noteId)).toBe(0);
    expect(await fails(mine.get())).toBe('not-found');
  });

  it('takes what you added out of everyone’s notes with your account, whatever became of your own, and leaves the notes with everyone else', async () => {
    const kofi = await account(unique('kofi'));
    const lena = await account(unique('lena'));
    const { org, noteId } = await writtenNote('The merger closes on Friday.', kofi, lena);
    const other = await writtenNote('The logo stays blue.', kofi, lena);
    await adds(kofi, noteId, 'Kofi shared this.');
    await adds(lena, noteId, 'Lena shared this.');
    // One he then deleted from his own notes, and one on a note he then removed from his: neither is his to reach any more.
    const mine = kofi.api.notes.personal(noteId);
    const entry = last(await mine.add({ kind: 'note', text: 'Deleted from his own.' }));
    const p = await kofi.api.notes.previewAddition(noteId, entry.id);
    await kofi.api.notes.addToShared(noteId, entry.id, { text: 'Deleted from his own.', seal: p.seal });
    await mine.remove(entry.id);
    await adds(kofi, other.noteId, 'On a note he removed.');
    await kofi.api.notes.delete(other.noteId);
    expect([await addedTo(noteId), await addedTo(other.noteId), await kept(noteId)]).toEqual([3, 1, 2]);

    await kofi.api.account.delete();

    // All of his, and only his.
    expect([await addedTo(noteId), await addedTo(other.noteId), await kept(noteId)]).toEqual([1, 0, 1]);
    // The notes open as they did for the organizer and everyone else who has them.
    for (const reader of [org, lena]) {
      const read = await reader.api.notes.get(noteId);
      expect(read.additions.map((a) => a.text)).toEqual(['Lena shared this.']);
      expect(read.transcript?.map((l) => l.text)).toEqual(['The merger closes on Friday.']);
    }
    expect((await other.org.api.notes.get(other.noteId)).additions).toEqual([]);
    expect((await lena.api.notes.get(other.noteId)).additions).toEqual([]);
    expect((await lena.api.notes.personal(noteId).get()).entries).toHaveLength(2);

    // Who added what stays out of the row: it's sealed in the body, and found by a keyed hash that matches nothing else.
    const row = await h.pool.query('SELECT row_to_json(x)::text AS r FROM note_additions x WHERE note_item_id = $1', [noteId]);
    expect(JSON.stringify(row.rows)).not.toContain(lena.session.ownerId);

    // The organizer's account going takes everything on its notes.
    await org.api.account.delete();
    expect([await kept(noteId), await addedTo(noteId)]).toEqual([0, 0]);
  });

  it('deletes the own notes of someone removed from the call and taken off the invite, who never gets the note', async () => {
    const org = await account(unique('organizer'));
    const { code: c } = await org.api.calls.startNow({ title: 'Planning', notes: 'on', guests: [] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    await host.appendAudio(piece(audioBytes('audio'), 0, 0));
    // Signed in and let in from the link: on the invite, and able to keep their own notes, until they're removed.
    const sam = await account(unique('sam'));
    const samCall = await sam.api.calls.join(c, { mic: true, cam: false });
    await letIn(host, samCall);
    await settle(samCall, (s) => s.role === 'invited');
    await samCall.personal.add({ kind: 'note', text: 'PRIVATE-REMOVED my own.' });
    await host.personal.add({ kind: 'note', text: 'The organizer’s own.' });
    const noteId = host.getSnapshot().notes.noteId ?? '';
    expect(await kept(noteId)).toBe(2);
    await host.remove(samCall.ticket.identity);
    expect(await fails(samCall.personal.get())).toBe('forbidden');
    await host.transcribe(speech('Carrying on.', 0, 0), host.ticket.identity);
    await settle(host, (s) => s.transcript.length >= 1);
    await host.leave();
    await written(org.api, noteId);
    // Only the organizer's are left: Sam doesn't have the note, so there's nothing to read them through.
    expect(await kept(noteId)).toBe(1);
    expect(await fails(sam.api.notes.personal(noteId).get())).toBe('not-found');
    expect((await org.api.notes.personal(noteId).get()).entries).toHaveLength(1);
  });
});

describe('what’s stored', () => {
  it('seals it under the author’s own keys, bound to them and the note, and keeps it out of rows, logs, receipts and every model', async () => {
    const kofi = await account(unique('kofi'));
    const lena = await account(unique('lena'));
    const { org, host, calls: [kofiCall] } = await callWith(kofi, lena);
    if (!kofiCall) throw new Error('nobody in the call');
    await host.transcribe(speech('The merger closes on Friday.', 0, 0), host.ticket.identity);
    const lineId = (await settle(kofiCall, (s) => s.transcript.length >= 1)).transcript[0]?.id ?? '';
    await kofiCall.personal.add({ kind: 'note', text: 'CANARY-PERSONAL-TEXT ask about the budget' });
    await kofiCall.personal.add({ kind: 'bookmark', label: 'CANARY-PERSONAL-LABEL', point: { kind: 'line', lineId } });
    await kofiCall.personal.add({ kind: 'answer', question: 'CANARY-PERSONAL-QUESTION what closes?', answer: 'CANARY-PERSONAL-ANSWER Friday.', points: [{ kind: 'line', lineId }] });
    const noteId = noteIdOf(await host.leave());
    await written(org.api, noteId);

    const shareThis = last(await kofi.api.notes.personal(noteId).add({ kind: 'note', text: 'CANARY-ADDED said to everyone' }));
    const p = await kofi.api.notes.previewAddition(noteId, shareThis.id);
    await kofi.api.notes.addToShared(noteId, shareThis.id, { text: 'CANARY-ADDED said to everyone', seal: p.seal });
    const lenaOwn = last(await lena.api.notes.personal(noteId).add({ kind: 'note', text: 'CANARY-PERSONAL-LENA hers.' }));
    expect(lenaOwn.kind).toBe('note');

    // Nothing reads them: asking about the note, across notes, or across a series sends none of it to a model.
    for await (const part of kofi.api.notes.ask(noteId, 'What closes on Friday?')) expect(part.type).toMatch(/text|cite|screen/);
    for await (const part of kofi.api.notes.askAll('What closes on Friday?')) expect(part.type).toMatch(/text|cite/);

    const rows = await allRows();
    const canaries = ['CANARY-PERSONAL-TEXT', 'CANARY-PERSONAL-LABEL', 'CANARY-PERSONAL-QUESTION', 'CANARY-PERSONAL-ANSWER', 'CANARY-PERSONAL-LENA', 'CANARY-ADDED', 'ask about the budget', 'said to everyone'];
    const logs = h.logs.join('');
    const wire = Buffer.concat(h.near.received.map((r) => r.body));
    for (const canary of canaries) {
      for (const enc of encodings(canary)) {
        expect(rows.includes(enc), `${canary} as ${enc} in rows`).toBe(false);
        expect(logs.includes(enc), `${canary} as ${enc} in logs`).toBe(false);
        expect(wire.includes(Buffer.from(enc)), `${canary} as ${enc} to NEAR AI`).toBe(false);
      }
      expect(h.near.prompts.some((x) => x.includes(canary)), `${canary} in what a model read`).toBe(false);
    }
    for await (const obj of h.objects.list()) {
      const bytes = Buffer.from(await h.objects.get(obj.id));
      for (const canary of canaries) expect(bytes.includes(Buffer.from(canary)), `${canary} in ${obj.id}`).toBe(false);
    }
    // No receipt keeps a copy under anyone's account, to outlive what's deleted.
    const receipts = await h.pool.query<{ method: string }>(`SELECT method FROM operations WHERE owner_id = ANY($1::text[])`, [[kofi.session.ownerId, lena.session.ownerId, org.session.ownerId]]);
    expect(receipts.rows.filter((r) => r.method.includes('personal') || r.method.includes('additions'))).toEqual([]);

    // One row for each person, however much is in it: the rows don't say how many bookmarks anyone has.
    expect(await kept(noteId)).toBe(2);
    // A record opens only where it was sealed: another person's row won't take it, and nor will another note.
    const body = async (owner: string) => (await h.pool.query<{ body_ciphertext: Buffer }>('SELECT body_ciphertext FROM personal_notes WHERE owner_id = $1 AND note_item_id = $2', [owner, noteId])).rows[0]?.body_ciphertext;
    const kofiRecord = await body(kofi.session.ownerId);
    const lenaRecord = await body(lena.session.ownerId);
    await h.pool.query('UPDATE personal_notes SET body_ciphertext = $1 WHERE owner_id = $2 AND note_item_id = $3', [kofiRecord, lena.session.ownerId, noteId]);
    expect(await fails(lena.api.notes.personal(noteId).get())).toBe('key-unavailable');
    await h.pool.query('UPDATE personal_notes SET body_ciphertext = $1 WHERE owner_id = $2 AND note_item_id = $3', [lenaRecord, lena.session.ownerId, noteId]);
    expect((await lena.api.notes.personal(noteId).get()).entries).toHaveLength(1);
  });
});
