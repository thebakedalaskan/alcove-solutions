/**
 * Searching your notes (docs: Notes and inference › Search), end to end: the real API over HTTP via @alcove/api-http, real
 * Postgres, the object store, the local LiveKit server and the fake NEAR AI. What a search finds in what was said, in the
 * names of the people who said it and in what the notes wrote down; one person's lines; what a line became in the notes;
 * and all of it only ever in notes the person searching has.
 */
import { AlcoveApiError, type AlcoveApi, type CallSession, type CallState, type NoteFound, type TranscriptClip } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { speechWav } from '../../testing/fakes/near';
import { acceptNoteSuggestions } from '../../testing/follow-ups';
import { startHarness, type Harness } from '../../testing/harness';
import { disposeLiveKit } from '../../testing/livekit';

// Calls with more than one person set up MLS groups and LiveKit rooms, which a busy runner can be slow to do.
vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(() => { h.closeCalls(); });

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
let seq = 0;
/** A work email nobody has used yet in this run. Single sign-on names the account from it: "kofi.…" is Kofi. */
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const { session } = await b.api.auth.signIn('sso', { email });
  return { ...b, email: session.user.email, name: session.user.name };
}
type Account = Awaited<ReturnType<typeof account>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, what: string, ms = 20_000): Promise<void> {
  const by = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > by) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 300 && !pred(call.getSnapshot()); i++) { await call.refresh(); await sleep(30); }
  if (!pred(call.getSnapshot())) throw new Error('timed out waiting for the call to change');
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
/** A clip of speech saying `words` (sentences split by " // ", two seconds apart), `at` seconds into the recording. */
const speech = (words: string, at: number, ms = 4000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment: 0, at, durationMs: ms });
async function written(api: AlcoveApi, noteId: string): Promise<void> {
  for await (const p of api.notes.progress(noteId)) if (p.ready) return;
  throw new Error('the notes weren’t written');
}
/** The organizer leaving ends the call; anything else is a mistake in the test. */
async function ended(call: CallSession): Promise<string> {
  const r = await call.leave();
  if (!r?.pendingNoteId) throw new Error('the organizer’s leave left no note');
  return r.pendingNoteId;
}

/** A call between its organizer and someone invited, with `said` said by the organizer at 4-second steps, written up. */
async function talked(said: string[], title = 'Roadmap review') {
  const org = await account(unique('organizer'));
  const guest = await account(unique('guest'));
  const meeting = await org.api.meetings.create({ title, startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests: [guest.email], notes: 'on' });
  const call = await org.api.calls.join(meeting.code, { mic: true, cam: false });
  for (const [i, words] of said.entries()) await call.transcribe(speech(words, i * 4), call.ticket.identity);
  const noteId = await ended(call);
  await written(org.api, noteId);
  return { org, guest, noteId };
}
/**
 * A call `org` organizes with everyone in `guests` in it, invited, where each line of `said` is said by whoever it names, four
 * seconds apart (the organizer's browser hears them all), and that ends with its notes written.
 */
async function held(org: Account, guests: Account[], said: readonly (readonly [Account, string])[], title = 'Harbour review'): Promise<string> {
  const { code: c } = await org.api.calls.startNow({ title, notes: 'on', guests: guests.map((g) => g.email) });
  const host = await org.api.calls.join(c, { mic: true, cam: false });
  await inGroup(host);
  const there = new Map<string, CallSession>([[org.email, host]]);
  for (const g of guests) {
    const call = await g.api.calls.join(c, { mic: true, cam: false });
    await inGroup(call);
    there.set(g.email, call);
  }
  for (const [i, [who, words]] of said.entries()) await host.transcribe(speech(words, i * 4), there.get(who.email)?.ticket.identity ?? 'nobody');
  await settle(host, (s) => s.transcript.length >= said.length);
  const noteId = await ended(host);
  await written(org.api, noteId);
  return noteId;
}
const found = async (api: AlcoveApi, text: string) => (await api.notes.list({ text })).map((n) => n.id);
/** What a search quoted from each note it found: the note, and each line's words with who said them. */
const quoted = (notes: NoteFound[]) => notes.map((n) => [n.id, n.said.map((l) => [l.text, l.speaker?.name ?? null]), n.saidCount]);

describe('finding what was said', () => {
  it('finds the words in what was said, with who said them and when, for everyone who has the notes', async () => {
    const { org, guest, noteId } = await talked(['The harbour pilot starts in March.', 'Nothing else came up about the budget.', 'The budget for the harbour pilot is agreed.']);
    const [hit] = await org.api.notes.list({ text: 'pilot' });
    expect(hit).toMatchObject({ id: noteId, saidCount: 2 });
    expect(hit?.said.map((l) => [l.at, l.text, l.speaker?.name])).toEqual([[0, 'The harbour pilot starts in March.', org.name], [8, 'The budget for the harbour pilot is agreed.', org.name]]);
    expect((await guest.api.notes.list({ text: 'pilot' }))[0]?.said).toEqual(hit?.said);

    // Every word counts, in any order and anywhere in the note: the title is searched too, though nothing said matches it.
    expect(await found(org.api, 'budget harbour')).toEqual([noteId]);
    expect(await found(org.api, 'budget tugboat')).toEqual([]);
    expect(await org.api.notes.list({ text: 'Roadmap' })).toMatchObject([{ id: noteId, said: [], saidCount: 0 }]);
    expect(await org.api.notes.list({ text: 'roadmap pilot' })).toMatchObject([{ id: noteId, saidCount: 2 }]);

    // Not a search at all: nothing was looked for, so nothing is quoted.
    expect(await org.api.notes.list()).toMatchObject([{ id: noteId, said: [], saidCount: 0 }]);
    // A question shows the notes with any of its words, while it's being typed, and what was said with them.
    expect(await found(org.api, 'When does the pilot start?')).toEqual([noteId]);
    expect(await found(org.api, 'Who ordered the cake?')).toEqual([]);
    // Only what you have: someone else's search finds nothing here, and neither does asking to see every note.
    const stranger = await account(unique('stranger'));
    expect(await found(stranger.api, 'pilot')).toEqual([]);
    expect(await stranger.api.notes.list()).toEqual([]);
  });

  it('quotes the lines with most of the words first, then the earliest, ten at most, and says how many there were', async () => {
    const { org } = await talked([
      'The tide table is late.', 'The tide came in early.', 'The tide turned at noon.', 'The tide was high all week.', 'The harbour tide table is right now.', 'Then the tide went out.',
      'The tide gauge broke.', 'A spring tide is due.', 'Low tide was at six.', 'The tide line moved.', 'A tide pool formed.', 'The last tide of the day.'
    ]);
    const [hit] = await org.api.notes.list({ text: 'tide harbour' });
    expect(hit?.saidCount).toBe(12);
    expect(hit?.said.map((l) => l.at)).toEqual([16, 0, 4, 8, 12, 20, 24, 28, 32, 36]);
    expect(hit?.said[0]?.text).toBe('The harbour tide table is right now.');
  });

  it('finds a note by the words of its decisions and follow-ups, though nothing said has them', async () => {
    const { org, guest, noteId } = await talked(['The harbour pilot starts in March.']);
    await org.api.notes.proposeDecision(noteId, { text: 'The warehouse moves in June.' });
    await guest.api.notes.proposeAction(noteId, { text: 'Order the packing crates' });
    for (const who of [org, guest]) {
      expect(await who.api.notes.list({ text: 'warehouse' })).toMatchObject([{ id: noteId, said: [], saidCount: 0 }]);
      expect(await who.api.notes.list({ text: 'crates' })).toMatchObject([{ id: noteId, said: [], saidCount: 0 }]);
    }
    // Every word still counts, wherever it is: one in a decision, one in what was said, which is quoted.
    expect(quoted(await org.api.notes.list({ text: 'warehouse pilot' }))).toEqual([[noteId, [['The harbour pilot starts in March.', org.name]], 1]]);
    expect(await found(org.api, 'warehouse tugboat')).toEqual([]);
  });
});

describe('finding who said it', () => {
  it('finds what someone said by their name, though nobody said it, for everyone who has the notes', async () => {
    const zuri = await account(unique('zuri'));
    const kofi = await account(unique('kofi'));
    const noteId = await held(zuri, [kofi], [
      [zuri, 'The harbour pilot starts in March.'], [kofi, 'The budget for the pilot looks fine.'], [zuri, 'Nothing else came up.'], [kofi, 'The tide tables are late again.']
    ]);
    // Kofi's lines, in the order they were said: his name is in none of them, nor anywhere else in the note.
    const kofis = [['The budget for the pilot looks fine.', kofi.name], ['The tide tables are late again.', kofi.name]];
    expect(quoted(await zuri.api.notes.list({ text: 'kofi' }))).toEqual([[noteId, kofis, 2]]);
    expect(quoted(await kofi.api.notes.list({ text: 'Kofi' }))).toEqual([[noteId, kofis, 2]]);
    // The start of a name is enough, from two letters, and the organizer is found the same way.
    expect(quoted(await kofi.api.notes.list({ text: 'zu' }))).toEqual([[noteId, [['The harbour pilot starts in March.', zuri.name], ['Nothing else came up.', zuri.name]], 2]]);
    // One letter isn't: it starts too many names to say anything. Nothing said or written here has a "z".
    expect(await found(kofi.api, 'z')).toEqual([]);
    // A name and a word: the lines with both come first.
    expect(quoted(await zuri.api.notes.list({ text: 'kofi tide' }))).toEqual([[noteId, [['The tide tables are late again.', kofi.name], ['The budget for the pilot looks fine.', kofi.name]], 2]]);
    // A question keeps finding notes with any of its words.
    expect(await found(zuri.api, 'What did Kofi say?')).toEqual([noteId]);
    // Someone who said nothing in it isn't found by their name, and a stranger finds nothing by anyone's.
    expect(await found(zuri.api, 'yusuf')).toEqual([]);
    expect(await found((await account(unique('stranger'))).api, 'kofi')).toEqual([]);
  });

  it('finds a link guest’s lines by the hyphenated name they typed, and by either part of it', async () => {
    const zuri = await account(unique('zuri'));
    const { code: c } = await zuri.api.calls.startNow({ title: 'Harbour review', notes: 'on' });
    const host = await zuri.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    // Someone without an account joins from the link under the name they typed, and the organizer lets them in.
    const guest = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Ama-Lee Osei' });
    await settle(host, (s) => s.waiting.some((w) => w.id === guest.ticket.identity));
    await host.admit(guest.ticket.identity);
    await inGroup(guest);
    await host.transcribe(speech('The quay is ready.', 0), guest.ticket.identity);
    await settle(host, (s) => s.transcript.length >= 1);
    const noteId = await ended(host);
    await written(zuri.api, noteId);
    // A hyphen parts a name as a space does: "lee" starts the second part of the first name, and "ama" the first. The
    // name as it's written finds them too, and with their last name after it.
    const theirs = [[noteId, [['The quay is ready.', 'Ama-Lee Osei']], 1]];
    expect(quoted(await zuri.api.notes.list({ text: 'lee' }))).toEqual(theirs);
    expect(quoted(await zuri.api.notes.list({ text: 'ama' }))).toEqual(theirs);
    expect(quoted(await zuri.api.notes.list({ text: 'Ama-Lee' }))).toEqual(theirs);
    expect(quoted(await zuri.api.notes.list({ text: 'ama-lee osei' }))).toEqual(theirs);
  });

  it('gives only the lines someone said, across notes, and finds a note only through one of them', async () => {
    const zuri = await account(unique('zuri'));
    const kofi = await account(unique('kofi'));
    const first = await held(zuri, [kofi], [[zuri, 'The harbour pilot starts in March.'], [kofi, 'The budget for the pilot looks fine.'], [kofi, 'Bring the tide tables next time.']]);
    const second = await held(zuri, [kofi], [[kofi, 'The crane hire is booked.'], [zuri, 'The harbour is closed on Sunday.']], 'Crane planning');
    const alone = await held(zuri, [], [[zuri, 'Only one of us talked about the harbour here.']], 'Harbour notes');
    // Everything Kofi said, newest note first, each note's lines in the order they were said. Kofi said nothing in the third.
    const all = [[second, [['The crane hire is booked.', kofi.name]], 1], [first, [['The budget for the pilot looks fine.', kofi.name], ['Bring the tide tables next time.', kofi.name]], 2]];
    expect(quoted(await zuri.api.notes.list({ by: kofi.email }))).toEqual(all);
    expect(quoted(await kofi.api.notes.list({ by: kofi.email }))).toEqual(all);
    // An address is an address, however it's written.
    expect(quoted(await zuri.api.notes.list({ by: kofi.email.toUpperCase() }))).toEqual(all);
    // With words, only Kofi's lines count: the organizer said "harbour" in both of these, and the title has it too.
    expect(quoted(await zuri.api.notes.list({ by: kofi.email, text: 'tide' }))).toEqual([[first, [['Bring the tide tables next time.', kofi.name]], 1]]);
    expect(await zuri.api.notes.list({ by: kofi.email, text: 'harbour' })).toEqual([]);
    expect(await zuri.api.notes.list({ by: kofi.email, text: 'Where does the harbour close?' })).toEqual([]);
    // Nor does another speaker's name: "zuri" finds every note Zuri spoke in, and none through Kofi's lines.
    expect(await found(zuri.api, 'zuri')).toEqual([alone, second, first]);
    expect(await zuri.api.notes.list({ by: kofi.email, text: 'zuri' })).toEqual([]);
    // The organizer's own lines are found the same way, in every note they spoke in.
    expect((await zuri.api.notes.list({ by: zuri.email })).map((n) => [n.id, n.saidCount])).toEqual([[alone, 1], [second, 1], [first, 1]]);
    // Someone who said nothing anywhere, and what isn't an address.
    expect(await zuri.api.notes.list({ by: unique('nobody') })).toEqual([]);
    expect(code(await zuri.api.notes.list({ by: 'not an address' }).catch((e: unknown) => e))).toBe('invalid');
  });

  it('finds nothing by someone’s address in notes you don’t have', async () => {
    const zuri = await account(unique('zuri'));
    const yusuf = await account(unique('yusuf'));
    const kofi = await account(unique('kofi'));
    const zuris = await held(zuri, [kofi], [[kofi, 'The crane hire is booked.']], 'Crane planning');
    const yusufs = await held(yusuf, [kofi], [[kofi, 'The crane arrives on Monday.']], 'Crane delivery');
    // Each organizer finds Kofi's lines in their own call alone; Kofi, who has both, finds both.
    expect((await zuri.api.notes.list({ by: kofi.email })).map((n) => n.id)).toEqual([zuris]);
    expect((await yusuf.api.notes.list({ by: kofi.email, text: 'crane' })).map((n) => n.id)).toEqual([yusufs]);
    expect((await kofi.api.notes.list({ by: kofi.email })).map((n) => n.id)).toEqual([yusufs, zuris]);
    // Someone with neither note finds nothing by his address, with words or without, though their own note has the word.
    const stranger = await account(unique('stranger'));
    const theirs = await held(stranger, [], [[stranger, 'Our crane is booked as well.']], 'Crane planning');
    expect(await stranger.api.notes.list({ by: kofi.email })).toEqual([]);
    expect(await stranger.api.notes.list({ by: kofi.email, text: 'crane' })).toEqual([]);
    expect((await stranger.api.notes.list({ text: 'crane' })).map((n) => n.id)).toEqual([theirs]);
    // Nor does Kofi once he's removed one from his notes.
    await kofi.api.notes.delete(zuris);
    expect((await kofi.api.notes.list({ by: kofi.email })).map((n) => n.id)).toEqual([yusufs]);
  });
});

describe('what a line became', () => {
  /** Each line found, with what it became in the notes, if anything. */
  const made = (notes: NoteFound[]) => notes.flatMap((n) => n.said.map((l) => [l.text, l.made ?? null]));

  it('says which line a decision rests on and which a follow-up does, as the notes change', async () => {
    const { org, noteId } = await talked(['We agreed to ship on Monday.', 'Kofi will send the screens by Friday.', 'Ama will book the room, we agreed.', 'The tide table is late.']);
    // The notes' follow-ups are suggestions until someone adds them, so only the decisions rest on a line yet.
    expect(made(await org.api.notes.list({ by: org.email }))).toEqual([
      ['We agreed to ship on Monday.', 'decision'], ['Kofi will send the screens by Friday.', null], ['Ama will book the room, we agreed.', 'decision'], ['The tide table is late.', null]
    ]);
    await acceptNoteSuggestions(org.api, noteId);
    expect(made(await org.api.notes.list({ text: 'screens' }))).toEqual([['Kofi will send the screens by Friday.', 'follow-up']]);
    // A line both rest on is the decision's, until it isn't decided after all.
    expect(made(await org.api.notes.list({ text: 'room' }))).toEqual([['Ama will book the room, we agreed.', 'decision']]);
    const note = await org.api.notes.get(noteId);
    for (const d of note.decisions) await org.api.notes.updateDecision(noteId, d.id, { state: 'rejected' });
    expect(made(await org.api.notes.list({ by: org.email }))).toEqual([
      ['We agreed to ship on Monday.', null], ['Kofi will send the screens by Friday.', 'follow-up'], ['Ama will book the room, we agreed.', 'follow-up'], ['The tide table is late.', null]
    ]);
  });

  it('reads a breakout room’s lines against that room’s own decisions and follow-ups', async () => {
    const zuri = await account(unique('zuri'));
    const kofi = await account(unique('kofi'));
    const { code: c } = await zuri.api.calls.startNow({ title: 'Design review', notes: 'on', guests: [kofi.email] });
    const host = await zuri.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const inKofi = await kofi.api.calls.join(c, { mic: true, cam: false });
    await inGroup(inKofi);
    await host.transcribe(speech('We agreed to meet again next week.', 0), host.ticket.identity);
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email] }, { name: 'Support', emails: [] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
    const [room = ''] = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms.map((r) => r.id) ?? [];
    await waitFor(() => inKofi.crypto.getSnapshot().place === room && Boolean(inKofi.crypto.getSnapshot().media?.send), 'Kofi in the room');
    await settle(inKofi, (s) => s.capture.room?.scribe === inKofi.ticket.identity);
    await inKofi.transcribe(speech('We agreed on blue buttons. // Kofi will draw the icons by Friday.', 4), inKofi.ticket.identity);
    await settle(inKofi, (s) => s.transcript.length >= 2);
    host.closeRooms();
    await settle(host, (s) => s.breakouts.open === null);
    const noteId = await ended(host);
    await written(zuri.api, noteId);
    await acceptNoteSuggestions(zuri.api, noteId);
    // The room decided something and handed something out, in its own section: the main room only decided.
    const note = await zuri.api.notes.get(noteId);
    const design = note.rooms.find((r) => r.name === 'Design');
    expect([note.decisions.length, note.actions.length, design?.decisions.length, design?.actions.length]).toEqual([1, 0, 1, 1]);
    const said = (notes: NoteFound[]) => notes.flatMap((n) => n.said.map((l) => [l.text, l.room?.name ?? null, l.made ?? null]));
    expect(said(await zuri.api.notes.list({ by: kofi.email }))).toEqual([['We agreed on blue buttons.', 'Design', 'decision'], ['Kofi will draw the icons by Friday.', 'Design', 'follow-up']]);
    expect(said(await kofi.api.notes.list({ text: 'agreed' }))).toEqual([['We agreed to meet again next week.', null, 'decision'], ['We agreed on blue buttons.', 'Design', 'decision']]);
  });
});
