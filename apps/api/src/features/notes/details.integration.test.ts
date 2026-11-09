/**
 * The full summary of a call (docs: Notes and inference › Prompts), end to end: the real API over HTTP via
 * @alcove/api-http, real Postgres and the object store, NEAR AI faked over HTTP. After a call's notes are written, a
 * second request writes a longer account of the meeting, kept with the note and read again when someone asks about it.
 * When it can't be written the notes stand without it.
 */
import { type AlcoveApi, type AudioPiece, type TranscriptClip } from '@alcove/api';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { speechWav } from '../../testing/fake-near';
import { startHarness, type Harness } from '../../testing/harness';
import { disposeLiveKit } from '../../testing/livekit';

vi.setConfig({ testTimeout: 60_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { h.closeCalls(); await h?.close(); await disposeLiveKit(); });

let seq = 0;
const unique = (who: string) => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique('person')) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session };
}
const audio = (i: number): AudioPiece => ({ data: new Blob([new Uint8Array(2048)]), segment: 0, seq: i, at: i * 5, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' });
const speech = (words: string, at: number): TranscriptClip => ({ data: new Blob([speechWav(words, 3000)], { type: 'audio/wav' }), segment: 0, at, durationMs: 3000 });
async function written(api: AlcoveApi, noteId: string): Promise<void> {
  for await (const p of api.notes.progress(noteId)) void p;
}
async function asked(api: AlcoveApi, noteId: string, question: string): Promise<string> {
  const from = h.near.chats.length;
  for await (const p of api.notes.ask(noteId, question)) void p;
  const i = h.near.chats.slice(from).findIndex((c) => c.system.startsWith('You answer a question about one meeting'));
  return h.near.prompts[from + i] ?? '';
}
const logged = (from: number, msg: string): { level: number; msg: string }[] => h.logs.slice(from).filter((l) => l.includes(`"msg":"${msg}`)).map((l) => JSON.parse(l));

/** A call with notes on where the organizer says two things, then leaves; once its notes are written: the note, and every chat request NEAR AI got meanwhile. */
async function call(org: Awaited<ReturnType<typeof account>>) {
  const chatsFrom = h.near.chats.length;
  const promptsFrom = h.near.prompts.length;
  const { code } = await org.api.calls.startNow({ notes: 'on' });
  const host = await org.api.calls.join(code, { mic: true, cam: false });
  for (let i = 0; i < 2; i++) await host.appendAudio(audio(i));
  await host.transcribe(speech('We agreed to ship the beta on Friday.', 1), host.ticket.identity);
  await host.transcribe(speech('Kofi will send the invites by Wednesday.', 5), host.ticket.identity);
  const noteId = (await host.leave())?.pendingNoteId ?? '';
  await written(org.api, noteId);
  return { noteId, note: await org.api.notes.get(noteId), chats: h.near.chats.slice(chatsFrom), prompts: h.near.prompts.slice(promptsFrom) };
}
const isDetails = (c: { system: string }) => c.system.startsWith('You write the full summary');

describe('the full summary', () => {
  it('is written after the notes, from the transcript and the notes, kept with the note, and read when someone asks about it', async () => {
    const org = await account(unique('organizer'));
    const logsFrom = h.logs.length;
    const r = await call(org);
    // The notes first, then the full summary, to the model that wrote the notes, sealed to its attested key.
    const order = r.chats.map((c) => (c.system.startsWith('You write the notes') ? 'notes' : isDetails(c) ? 'details' : 'other'));
    expect(order.filter((x) => x !== 'other')).toEqual(['notes', 'details']);
    expect(r.chats.filter(isDetails).every((c) => c.key === h.near.keys().notes)).toBe(true);
    const sent = r.prompts[r.chats.findIndex(isDetails)] ?? '';
    expect(sent).toContain('Notes already written:');
    expect(sent).toContain(`Short summary: ${r.note.summary}`);
    expect(sent).toContain('Kofi will send the invites by Wednesday.');
    // Two paragraphs, as the model wrote them.
    expect(r.note.details).toBe('First, We agreed to ship the beta on Friday.\n\nThen, Kofi will send the invites by Wednesday.');
    expect(r.note.summary).not.toBe('');
    expect(r.note.decisions).toHaveLength(1);
    // Asking about the note sends the full summary with the rest.
    const question = await asked(org.api, r.noteId, 'When does the beta ship?');
    expect(question).toContain(`Full summary:\n${r.note.details}`);
    expect(question).toContain('Summary: ');
    // The logs say it was written and how long, never what it says.
    const text = h.logs.slice(logsFrom).join('');
    expect(logged(logsFrom, 'full summary written')).toMatchObject([{ level: 30 }]);
    expect(text).not.toContain('Then, Kofi');
  });

  it('is left empty, and the notes stand, when it can’t be written', async () => {
    const org = await account(unique('organizer'));
    const logsFrom = h.logs.length;
    h.near.failDetailsNext();
    const r = await call(org);
    // Asked for once, answered in the wrong shape: no second try, no effect on the notes.
    expect(r.chats.filter(isDetails)).toHaveLength(1);
    expect(r.note.status).toBe('ready');
    expect(r.note.details).toBe('');
    expect(r.note.summary).not.toBe('');
    expect(r.note.decisions).toHaveLength(1);
    expect(r.note.actions).toEqual([]);
    expect(r.note.suggestions).toHaveLength(1);
    expect(logged(logsFrom, 'full summary written')).toEqual([]);
    expect(logged(logsFrom, 'full summary not written')).toMatchObject([{ level: 40 }]);
    expect(logged(logsFrom, 'notes written')).toHaveLength(1);
    // Asking about the note goes on without it.
    expect(await asked(org.api, r.noteId, 'When does the beta ship?')).not.toContain('Full summary:');
  });
});
