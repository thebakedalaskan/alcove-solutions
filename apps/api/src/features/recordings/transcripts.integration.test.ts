/**
 * A transcript that's honest about what it heard, and correctable (docs: Notes and inference › The live transcript and
 * › Correcting the transcript), end to end: the real API over HTTP via @alcove/api-http, real Postgres, the object
 * store and main's fake NEAR AI. Words the speech model was unsure of, and lines heard on two people's microphones at
 * once, are marked live, in catch-up and in the notes; the organizer corrects any line and the people who said them
 * their own words, in revisions that say who changed what; questions read the corrected transcript; and the organizer
 * has the notes written again from it, keeping what people settled.
 */
import { AlcoveApiError, type AlcoveApi, type AnswerPart, type AudioPiece, type CallSession, type CallState, type Note, type NoteProgress, type TranscriptClip, type TranscriptLine } from '@alcove/api';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { speechWav } from '../../testing/fake-near';
import { startHarness, type Harness } from '../../testing/harness';
import { standing } from '../billing/meter';

// Letting people into a call goes through its MLS group, which a busy CI runner can be slow at; every wait says what it waited for.
vi.setConfig({ testTimeout: 60_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
afterEach(() => h.closeCalls());

const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
let seq = 0;
const tag = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
const unique = (who = 'person') => `${who}.${tag()}@tests.example`;
/** A fresh account (single sign-on signs in whoever's work email is typed), or the same one again in another browser. */
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
const audioBytes = (marker: string) => { const src = Buffer.concat([Buffer.from(marker), randomBytes(2048)]); const out = new Uint8Array(new ArrayBuffer(src.length)); out.set(src); return out; };
const piece = (marker: string, segment: number, s: number): AudioPiece => ({ data: new Blob([audioBytes(marker)]), segment, seq: s, at: s * 5, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
/** Speech saying `words` (sentences split by " // "; one starting "~" is heard with little confidence). */
const speech = (words: string, segment: number, atMs: number, ms = 4000): TranscriptClip => ({ data: new Blob([speechWav(words, ms)], { type: 'audio/wav' }), segment, at: atMs / 1000, durationMs: ms });
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
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await inGroup(who);
}
async function written(api: AlcoveApi, noteId: string): Promise<NoteProgress[]> {
  const steps: NoteProgress[] = [];
  for await (const p of api.notes.progress(noteId)) steps.push(p);
  return steps;
}
async function asked(api: AlcoveApi, noteId: string, question: string): Promise<AnswerPart[]> {
  const parts: AnswerPart[] = [];
  for await (const p of api.notes.ask(noteId, question)) parts.push(p);
  return parts;
}
/** An invited person whose address names them ("kofi@…" is Kofi). */
const invitee = (name: string) => `${name}@${name.slice(0, 1)}${tag()}.example`;
/** Each line as [speaker, words, what's in doubt]. */
const marked = (ls: readonly TranscriptLine[]) => ls.map((l) => [l.speaker?.name ?? null, l.text, l.unsure ?? null]);
const lineIn = (n: Note, text: string) => n.transcript?.find((l) => l.text === text);
const revisions = async (noteId: string) => (await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM revisions WHERE item_id = $1', [noteId])).rows[0]?.n ?? 0;
const encodings = (s: string) => [s, Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64').slice(0, 12), Buffer.from(s).toString('base64url').slice(0, 12)];

describe('a transcript that says what it isn’t sure of', () => {
  it('marks words heard unclearly, and lines heard on two people’s microphones, live, in catch-up, in the notes and across notes', async () => {
    const org = await account(unique('organizer'));
    const kofiEmail = invitee('kofi');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [kofiEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const kofi = await (await account(kofiEmail)).api.calls.join(c, { mic: true, cam: false });
    await inGroup(kofi);
    await settle(host, (x) => x.capture.mode === 'on' && x.participants.some((p) => p.id === kofi.ticket.identity));
    await host.appendAudio(piece('two-voices', 0, 0));
    const me = org.session.user.name;
    const them = host.getSnapshot().participants.find((p) => p.id === kofi.ticket.identity)?.person.name ?? '';
    expect(them).toBe('Kofi');

    // Whisper heard the second sentence with little confidence: it's kept, and marked.
    await host.transcribe(speech('We agreed the budget is final. // ~the vendor wants eighty something', 0, 0), host.ticket.identity);
    // Kofi sits beside the organizer, so his words reach both microphones at once. Both are marked: nothing says whose
    // microphone was nearer. Two people agreeing at the same moment, in a few of the same words, aren't that.
    await host.transcribe(speech('I will send the contract to legal today.', 0, 5000), kofi.ticket.identity);
    await host.transcribe(speech('I will send the contract to legal today.', 0, 5300), host.ticket.identity);
    await host.transcribe(speech('That works for me too.', 0, 9000), host.ticket.identity);
    await host.transcribe(speech('That works for me.', 0, 9400), kofi.ticket.identity);
    // A reply that says the question's words again comes straight after it, not over it: nobody is in doubt.
    await host.transcribe(speech('Can we ship the release on Friday?', 0, 12_000), host.ticket.identity);
    await host.transcribe(speech('Yes, we can ship the release on Friday.', 0, 14_000), kofi.ticket.identity);
    const heard = [
      [me, 'We agreed the budget is final.', null],
      [me, 'the vendor wants eighty something', { words: true }],
      [them, 'I will send the contract to legal today.', { speaker: true }],
      [me, 'I will send the contract to legal today.', { speaker: true }],
      [me, 'That works for me too.', null],
      [them, 'That works for me.', null],
      [me, 'Can we ship the release on Friday?', null],
      [them, 'Yes, we can ship the release on Friday.', null]
    ];
    expect(marked(host.getSnapshot().transcript)).toEqual(heard);
    // Everyone in the call sees the same.
    expect(marked((await settle(kofi, (x) => x.transcript.length === heard.length)).transcript)).toEqual(heard);

    // Catching up, the notes model is told what's unsure, so it rests nothing on it.
    await kofi.catchUp({ kind: 'all' });
    const caughtUp = h.near.prompts.at(-1) ?? '';
    expect(caughtUp).toContain('the vendor wants eighty something (unclear)');
    expect(caughtUp).toContain(`${me} (not sure who): I will send the contract to legal today.`);
    expect(caughtUp).toContain(`${me}: We agreed the budget is final.`);
    expect(caughtUp).toContain(`${me}: That works for me too.`);

    // The notes keep it, and are written knowing it.
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    expect(marked(note.transcript ?? [])).toEqual(heard);
    expect(note).toMatchObject({ status: 'ready', writingAgain: false });
    expect(note.writtenAt).not.toBeNull();
    const draft = h.near.prompts.at(-1) ?? '';
    expect(draft).toContain('Transcript:');
    expect(draft).toContain('the vendor wants eighty something (unclear)');
    expect(draft).toContain(`Kofi (not sure who): I will send the contract to legal today.`);

    // A question across your notes reads them the same way, told what the marks mean, each transcript fenced.
    const across: AnswerPart[] = [];
    for await (const p of org.api.notes.askAll('What does the vendor want?')) across.push(p);
    expect(across[0]).toMatchObject({ type: 'text' });
    expect(h.near.instructions.at(-1)).toContain('A line ending in "(unclear)" was hard to hear');
    expect(h.near.instructions.at(-1)).toContain("Each note's transcript comes between <transcript> and </transcript>.");
    const acrossPrompt = h.near.prompts.at(-1) ?? '';
    expect(acrossPrompt).toContain('Transcript:\n<transcript>\n');
    expect(acrossPrompt).toContain('the vendor wants eighty something (unclear)');
    expect(acrossPrompt).toContain(`Kofi (not sure who): I will send the contract to legal today.`);
  });

  it('lets the organizer correct any line and people their own words, in revisions that say who changed what', async () => {
    const org = await account(unique('organizer'));
    const kofiEmail = invitee('kofi');
    const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [kofiEmail] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const kofiAccount = await account(kofiEmail);
    const kofi = await kofiAccount.api.calls.join(c, { mic: true, cam: false });
    await inGroup(kofi);
    const sam = await h.browser().api.calls.join(c, { mic: true, cam: false, name: 'Sam' });
    await letIn(host, sam);
    await settle(host, (x) => x.capture.mode === 'on' && x.participants.length === 3);
    await host.transcribe(speech('Welcome everyone, let us begin.', 0, 0), host.ticket.identity);
    await host.transcribe(speech('~the vendor wants eighty something', 0, 4000), kofi.ticket.identity);
    await host.transcribe(speech('I can take the design review myself.', 0, 8000), kofi.ticket.identity);
    await host.transcribe(speech('Count me in for the launch party.', 0, 12_000), sam.ticket.identity);
    await host.transcribe(speech('~we meet again on Thursday', 0, 16_000), sam.ticket.identity);
    // Kofi sits beside Sam: these reached both microphones, and the second was hard to hear. Each copy is heard before
    // the other is in its prompt, as two clips cut at the same moment are (a copy heard after would be the prompt said back).
    await host.transcribe(speech('I will send the contract to legal today.', 0, 20_300), sam.ticket.identity);
    await host.transcribe(speech('I will send the contract to legal today.', 0, 20_000), kofi.ticket.identity);
    await host.transcribe(speech('~we need a bigger room for the offsite', 0, 24_300), sam.ticket.identity);
    await host.transcribe(speech('~we need a bigger room for the offsite', 0, 24_000), kofi.ticket.identity);
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    let note = await org.api.notes.get(noteId);
    const id = (text: string) => lineIn(note, text)?.id ?? '';
    const [welcome, vendor, review, party, thursday] = ['Welcome everyone, let us begin.', 'the vendor wants eighty something', 'I can take the design review myself.', 'Count me in for the launch party.', 'we meet again on Thursday'].map(id);
    const kofis = (text: string) => note.transcript?.find((l) => l.text === text && l.speaker?.name === 'Kofi')?.id ?? '';
    const [contract, offsite] = [kofis('I will send the contract to legal today.'), kofis('we need a bigger room for the offsite')];
    const line = (lineId: string | undefined) => note.transcript?.find((l) => l.id === lineId);
    const changes = (lineId: string | undefined) => (line(lineId)?.changes ?? []).map((x) => [x.by.email, x.what, x.before ?? null, x.after ?? null]);
    const fixed = 'CANARY-FIX The vendor wants eighty thousand dollars.';

    // Kofi corrects his own words: the unclear mark goes, in a new revision that says who changed it and what it was.
    let before = await revisions(noteId);
    note = await kofiAccount.api.notes.correctLine(noteId, vendor ?? '', { text: fixed });
    expect(await revisions(noteId)).toBe(before + 1);
    expect(line(vendor)).toMatchObject({ text: fixed, speaker: { name: 'Kofi' } });
    expect(line(vendor)?.unsure).toBeUndefined();
    expect(changes(vendor)).toEqual([[kofiEmail, 'reworded', 'the vendor wants eighty something', fixed]]);
    // The same again changes nothing, and writes nothing.
    before = await revisions(noteId);
    await kofiAccount.api.notes.correctLine(noteId, vendor ?? '', { text: fixed });
    expect(await revisions(noteId)).toBe(before);
    // However often a line is corrected, its history keeps the first change, which says what was heard, and the latest.
    for (let i = 0; i < 20; i++) note = await kofiAccount.api.notes.correctLine(noteId, vendor ?? '', { text: i % 2 ? fixed : `${fixed} Again.` });
    expect(line(vendor)?.changes).toHaveLength(20);
    expect(changes(vendor)[0]).toEqual([kofiEmail, 'reworded', 'the vendor wants eighty something', fixed]);
    expect(changes(vendor).at(-1)).toEqual([kofiEmail, 'reworded', `${fixed} Again.`, fixed]);
    // Kofi vouches for his words, never for who said them: that's the organizer's to settle.
    expect(line(contract)?.unsure).toEqual({ speaker: true });
    expect(code(await kofiAccount.api.notes.correctLine(noteId, contract, { confirm: true }).catch((e: unknown) => e))).toBe('forbidden');
    expect(line(offsite)?.unsure).toEqual({ words: true, speaker: true });
    note = await kofiAccount.api.notes.correctLine(noteId, offsite, { confirm: true });
    expect(line(offsite)?.unsure).toEqual({ speaker: true });
    note = await org.api.notes.correctLine(noteId, offsite, { confirm: true });
    expect(line(offsite)?.unsure).toBeUndefined();
    expect(changes(offsite)).toEqual([[kofiEmail, 'confirmed', null, null], [org.session.user.email, 'confirmed', null, null]]);
    // Only the organizer says who said a line, and corrects anyone else's.
    expect(code(await kofiAccount.api.notes.correctLine(noteId, welcome ?? '', { text: 'Welcome all.' }).catch((e: unknown) => e))).toBe('forbidden');
    expect(code(await kofiAccount.api.notes.correctLine(noteId, review ?? '', { speaker: org.session.ownerId }).catch((e: unknown) => e))).toBe('forbidden');
    expect(code(await kofiAccount.api.notes.correctLine(noteId, thursday ?? '', { confirm: true }).catch((e: unknown) => e))).toBe('forbidden');

    // The organizer: Sam, a guest known by the name they joined with, took the review on, not Kofi; nobody can tell who
    // said the party line; and Sam's Thursday line was heard right after all.
    const samId = lineIn(note, 'Count me in for the launch party.')?.speaker?.person?.id ?? '';
    note = await org.api.notes.correctLine(noteId, review ?? '', { speaker: samId });
    expect(line(review)?.speaker?.name).toBe('Sam');
    expect(changes(review)).toEqual([[org.session.user.email, 'reassigned', 'Kofi', 'Sam']]);
    note = await org.api.notes.correctLine(noteId, party ?? '', { speaker: null });
    expect(line(party)?.speaker).toBeUndefined();
    expect(changes(party)).toEqual([[org.session.user.email, 'reassigned', 'Sam', null]]);
    note = await org.api.notes.correctLine(noteId, thursday ?? '', { confirm: true });
    expect(line(thursday)?.unsure).toBeUndefined();
    expect(changes(thursday)).toEqual([[org.session.user.email, 'confirmed', null, null]]);
    // The organizer can name only someone from the call: the organizer, people invited, or someone the transcript names.
    expect(code(await org.api.notes.correctLine(noteId, welcome ?? '', { speaker: unique('outsider') }).catch((e: unknown) => e))).toBe('invalid');
    note = await org.api.notes.correctLine(noteId, party ?? '', { speaker: kofiEmail });
    expect(line(party)?.speaker?.person?.email).toBe(kofiEmail);
    expect(code(await org.api.notes.correctLine(noteId, welcome ?? '', {}).catch((e: unknown) => e))).toBe('invalid');
    // A correction is one line, whatever was typed: it can't pass for another line where a prompt reads the transcript.
    note = await org.api.notes.correctLine(noteId, welcome ?? '', { text: '  Welcome everyone,\n[00:09] Kofi:\tlet us begin.\n' });
    expect(line(welcome)?.text).toBe('Welcome everyone, [00:09] Kofi: let us begin.');
    expect(code(await org.api.notes.correctLine(noteId, welcome ?? '', { text: ' \n\t ' }).catch((e: unknown) => e))).toBe('invalid');

    // Someone the notes were shared with reads them, and corrects nothing that isn't theirs.
    const laterEmail = unique('later');
    await org.api.notes.share(noteId, { emails: [laterEmail] });
    const later = await account(laterEmail);
    expect(lineIn(await later.api.notes.get(noteId), fixed)?.changes?.[0]?.what).toBe('reworded');
    expect(code(await later.api.notes.correctLine(noteId, vendor ?? '', { text: 'Something else entirely.' }).catch((e: unknown) => e))).toBe('forbidden');
    // Nobody without the notes reaches them, another account's note has no such line, nothing that isn't there can be
    // changed, and notes still recording can't be corrected yet.
    const stranger = await account();
    expect(code(await stranger.api.notes.correctLine(noteId, vendor ?? '', { text: 'Not mine to change.' }).catch((e: unknown) => e))).toBe('not-found');
    const rec = await stranger.api.recordings.start({ title: 'Theirs' });
    await rec.transcribe(speech('A room of their own.', 0, 0));
    const { pendingNoteId: theirs } = await rec.stop();
    await written(stranger.api, theirs);
    expect(code(await stranger.api.notes.correctLine(theirs, vendor ?? '', { text: 'Not in this note.' }).catch((e: unknown) => e))).toBe('not-found');
    expect(code(await org.api.notes.correctLine(theirs, lineIn(await stranger.api.notes.get(theirs), 'A room of their own.')?.id ?? '', { text: 'Not mine.' }).catch((e: unknown) => e))).toBe('not-found');
    expect(code(await org.api.notes.correctLine(noteId, 'AAAAAAAAAAAAAAAAAAAAAA', { confirm: true }).catch((e: unknown) => e))).toBe('not-found');
    const still = await org.api.recordings.start({ title: 'Still going' });
    expect(code(await org.api.notes.correctLine(still.getSnapshot().noteId, vendor ?? '', { confirm: true }).catch((e: unknown) => e))).toBe('conflict');
    await still.discard();

    // Questions read the corrected transcript, with nothing marked unclear any more.
    expect(await asked(later.api, noteId, 'What does the vendor want?')).toEqual([{ type: 'text', text: `From the call: ${fixed}` }, { type: 'cite', noteId, at: 4 }]);
    const transcript = (h.near.prompts.at(-1) ?? '').split('Transcript:\n')[1]?.split('\n\nAsked by')[0] ?? '';
    expect(transcript).toContain(`Kofi: ${fixed}\n`);
    expect(transcript).toContain('Sam (guest): I can take the design review myself.');
    expect(transcript).toContain('Kofi: we need a bigger room for the offsite\n');
    // Only what nobody has vouched for is still marked: Sam's line of the two the offsite was heard on.
    expect(transcript.split('\n').filter((l) => l.includes('(unclear)'))).toEqual([expect.stringContaining('Sam (guest) (not sure who): we need a bigger room for the offsite (unclear)')]);

    // What was corrected is sealed in the note's revisions like the rest: in no row, and in no log line.
    const dump = String((await h.pool.query(`SELECT string_agg(row_to_json(x)::text, ' ') AS all FROM revisions x WHERE item_id = $1`, [noteId])).rows[0]?.all ?? '');
    expect(dump).not.toBe('');
    const logs = h.logs.join('');
    for (const canary of ['CANARY-FIX', 'eighty thousand', 'Something else entirely', 'Welcome all']) {
      for (const enc of encodings(canary)) {
        expect(dump.includes(enc), `${canary} as ${enc} in revisions`).toBe(false);
        expect(logs.includes(enc), `${canary} as ${enc} in logs`).toBe(false);
      }
    }
    expect(logs).toContain('transcript line corrected');
  });

  it('writes the notes again from the corrected transcript when the organizer asks, keeping what people settled', async () => {
    const org = await account(unique('organizer'));
    const kofiEmail = invitee('kofi');
    const call = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on', guests: [kofiEmail] })).code, { mic: true, cam: false });
    await call.appendAudio(piece('again', 0, 0));
    await call.transcribe(speech('We agreed to launch on the 18th. // We decided to hire a designer. // Kofi will send the screens by Wednesday. // Can we test it first?', 0, 0), call.ticket.identity);
    const noteId = (await call.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    let note = await org.api.notes.get(noteId);
    const first = note.writtenAt ?? '';
    expect(first).not.toBe('');
    const jobs = async () => (await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM content_jobs WHERE owner_id = $1', [org.session.ownerId])).rows[0]?.n ?? 0;

    // Kofi rewords the first decision and the organizer confirms it, so it stays whatever the notes say next time (typed on
    // one line, however it was typed); the organizer corrects what was misheard.
    const kofi = await account(kofiEmail);
    const [launch, hire] = note.decisions;
    await kofi.api.notes.updateDecision(noteId, launch?.id ?? '', { text: 'Launch on the 18th,\nafter the security review.' });
    note = await org.api.notes.updateDecision(noteId, launch?.id ?? '', { state: 'confirmed', seen: { text: 'Launch on the 18th, after the security review.' } });
    const confirmed = note.decisions.find((d) => d.id === launch?.id);
    expect(confirmed).toMatchObject({ text: 'Launch on the 18th, after the security review.', state: 'confirmed' });
    const id = (text: string) => lineIn(note, text)?.id ?? '';
    note = await org.api.notes.correctLine(noteId, id('Kofi will send the screens by Wednesday.'), { text: 'Kofi will send the screens by Friday.' });
    note = await org.api.notes.correctLine(noteId, id('Can we test it first?'), { text: 'Can we test it on staging first?' });
    // The page can tell the transcript changed since the notes were written.
    expect(note.transcript?.some((l) => (l.changes ?? []).some((x) => x.at > first))).toBe(true);

    // Only the organizer has them written again.
    expect(code(await kofi.api.notes.rewrite(noteId).catch((e: unknown) => e))).toBe('forbidden');
    expect(code(await (await account()).api.notes.rewrite(noteId).catch((e: unknown) => e))).toBe('not-found');
    // While they're written again the notes stay as they were, for everyone: readable, changeable and asked about.
    h.near.slowNext(3000);
    const sent = h.near.prompts.length;
    expect(await org.api.notes.rewrite(noteId)).toMatchObject({ status: 'ready', writingAgain: true, summary: note.summary });
    await waitFor(() => h.near.prompts.length > sent, 'the notes to read the transcript');
    const prompt = h.near.prompts[sent] ?? '';
    const during = await kofi.api.notes.get(noteId);
    expect(during).toMatchObject({ status: 'ready', writingAgain: true, summary: note.summary, decisions: note.decisions });
    expect((await asked(kofi.api, noteId, 'When do we launch?')).length).toBeGreaterThan(0);
    note = await kofi.api.notes.updateDecision(noteId, hire?.id ?? '', { state: 'confirmed', seen: { text: hire?.text ?? '' } });
    // A correction made after the notes read the transcript isn't in them, so it's offered for next time.
    note = await org.api.notes.correctLine(noteId, id('We decided to hire a designer.'), { text: 'We decided to hire a second designer.' });
    // Asking again while they're being written changes nothing, even after the transcript changed.
    expect(await org.api.notes.rewrite(noteId)).toMatchObject({ status: 'ready', writingAgain: true });
    expect(await jobs()).toBe(1);
    await written(org.api, noteId);
    note = await org.api.notes.get(noteId);
    expect(note).toMatchObject({ status: 'ready', writingAgain: false });
    expect((note.writtenAt ?? '') > first).toBe(true);
    // The notes model read the corrected words, and was told what's settled so it doesn't list it again.
    expect(prompt).toContain('Kofi will send the screens by Friday.');
    expect(prompt).toContain('Already settled (don\'t list these again):\n- Decision (confirmed): Launch on the 18th, after the security review.\n');
    expect(prompt).not.toContain('second designer');
    const since = note.writtenAt ?? '';
    expect(note.transcript?.filter((l) => (l.changes ?? []).some((x) => x.at > since)).map((l) => l.text)).toEqual(['We decided to hire a second designer.']);

    // What Kofi settled is untouched, even what he confirmed while they were written and the model listed again in
    // other words; what nobody had touched is written again from the corrected words.
    expect(note.decisions.map((d) => [d.text, d.state])).toEqual([['Launch on the 18th, after the security review.', 'confirmed'], ['We decided to hire a designer.', 'confirmed']]);
    expect(note.decisions[0]).toEqual(confirmed);
    expect(note.actions).toEqual([]);
    expect(note.suggestions).toEqual([expect.objectContaining({ text: 'Send the screens by Friday', due: 'Friday', takenOn: false, done: false, changes: [] })]);
    expect(note.questions.map((x) => [x.text, x.state])).toEqual([['Can we test it on staging first?', 'open']]);
    expect(note.summary).toBe('Heard 4 lines. It ended on: Can we test it on staging first?');
    // Written again, the notes model’s verification isn’t listed twice.
    expect(note.inference.map((e) => e.task)).toEqual(['transcript', 'notes']);
    expect(await jobs()).toBe(0);

    // Nothing to write from, or still recording: refused.
    const rec = await org.api.recordings.start({ title: 'Quiet' });
    expect(code(await org.api.notes.rewrite(rec.getSnapshot().noteId).catch((e: unknown) => e))).toBe('conflict');
    const { pendingNoteId: silent } = await rec.stop();
    await written(org.api, silent);
    expect(code(await org.api.notes.rewrite(silent).catch((e: unknown) => e))).toBe('conflict');
  });

  it('writes notes that couldn’t be written when the organizer asks, paying for every answer the model gave', async () => {
    const { maintain } = await import('../../maintenance');
    const org = await account(unique('organizer'));
    const job = async () => (await h.pool.query<{ state: string; attempt: number }>('SELECT state, attempt FROM content_jobs WHERE owner_id = $1', [org.session.ownerId])).rows[0];
    const retryNow = async () => {
      await h.pool.query(`UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = $1`, [org.session.ownerId]);
      await maintain(h.deps);
    };
    const spent = async () => (await standing(h.deps, h.pool, org.session.ownerId)).spentNano;
    // The notes model never gives a usable answer: after three attempts the note is finished without notes. Each answer was
    // still work the model did, and the organizer paid for it.
    h.near.failNext(3, 'prose');
    const rec = await org.api.recordings.start({ title: 'Unwritten' });
    await rec.appendAudio(piece('unwritten', 0, 0));
    await rec.transcribe(speech('We agreed to ship on Monday.', 0, 0));
    const { pendingNoteId: noteId } = await rec.stop();
    for (let i = 0; i < 200; i++) { const j = await job(); if (j?.state === 'queued' && j.attempt === 1) break; await sleep(25); }
    expect(await job()).toEqual({ state: 'queued', attempt: 1 });
    await retryNow();
    await retryNow();
    expect(await job()).toBeUndefined();
    let note = await org.api.notes.get(noteId);
    expect(note).toMatchObject({ status: 'ready', summary: '', writtenAt: null });
    const unusable = await spent();
    expect(unusable).toBeGreaterThan(0);

    // Asked to, it writes them, from the organizer’s notes again.
    expect(await org.api.notes.rewrite(noteId)).toMatchObject({ status: 'ready', writingAgain: true });
    await written(org.api, noteId);
    note = await org.api.notes.get(noteId);
    expect(note.decisions.map((d) => d.text)).toEqual(['We agreed to ship on Monday.']);
    expect(note.writtenAt).not.toBeNull();
    expect(await spent()).toBeGreaterThan(unusable);
  });
});
