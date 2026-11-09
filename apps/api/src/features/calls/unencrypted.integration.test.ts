/** Unencrypted inference is disclosed on the note before requests leave, including work done during a live call. */
import { type AlcoveApi, type AudioPiece, type CallSession, type TranscriptClip } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NOTES_MODEL, UNENCRYPTED_MODEL, speechWav } from '../../testing/fake-near';
import { ORIGIN, startHarness, type Harness } from '../../testing/harness';
import { disposeLiveKit } from '../../testing/livekit';

vi.setConfig({ testTimeout: 60_000 });
let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(() => { h.closeCalls(); });
let seq = 0;
async function account() {
  const b = h.browser();
  await b.api.auth.signIn('sso', { email: `person.${Date.now().toString(36)}${seq++}@tests.example` });
  return b;
}
const audio: AudioPiece = { data: new Blob([new Uint8Array(2048)]), segment: 0, seq: 0, at: 0, durationMs: 5000, mimeType: 'audio/webm;codecs=opus' };
const speech: TranscriptClip = { data: new Blob([speechWav('We agreed to ship the beta on Friday.', 3000)], { type: 'audio/wav' }), segment: 0, at: 0, durationMs: 3000 };
async function written(api: AlcoveApi, noteId: string): Promise<void> { for await (const p of api.notes.progress(noteId)) void p; }
const drain = async (parts: AsyncIterable<unknown>) => { for await (const p of parts) void p; };

describe('unencrypted inference history', () => {
  const uses: { name: string; run: (call: CallSession) => Promise<unknown> }[] = [
    { name: 'captions', run: (call) => call.translate(call.getSnapshot().transcript.map((l) => l.id), 'fr') },
    { name: 'catch-up', run: (call) => call.catchUp({ kind: 'all' }) },
    { name: 'live questions', run: (call) => call.askSoFar('When does the beta ship?', { kind: 'all' }) },
    { name: 'live notes', run: async (call) => {
      const reply = await fetch(`${h.baseUrl}/v1/live/calls/${call.ticket.callId}/notes/watch`, {
        method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-alcove-call': call.ticket.pass }, body: '{}'
      });
      expect(reply.status).toBe(200);
    } }
  ];
  it.each(uses)('keeps the disclosure for $name after switching back to a private model', async (use) => {
    const org = await account();
    const host = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    await host.appendAudio(audio);
    await host.transcribe(speech, host.ticket.identity);
    await host.setModel(UNENCRYPTED_MODEL);
    const from = h.near.calls.length;
    const liveNoteId = host.getSnapshot().notes.noteId ?? '';
    h.near.holdNext(async () => {
      expect((await org.api.notes.get(liveNoteId)).unencrypted.map((u) => u.model)).toEqual([UNENCRYPTED_MODEL]);
    });
    await use.run(host);
    expect(h.near.calls.slice(from).some((c) => c.model === UNENCRYPTED_MODEL && c.encryption === 'none')).toBe(true);
    expect((await org.api.notes.get(liveNoteId)).unencrypted).toEqual([{ model: UNENCRYPTED_MODEL, task: 'notes', at: expect.any(String) }]);
    await host.setModel(null);
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    expect(note.model).toBeNull();
    expect(note.unencrypted.map((u) => u.model)).toEqual([UNENCRYPTED_MODEL]);
    expect(note.inference.some((e) => e.model === NOTES_MODEL)).toBe(true);
  });

  it.each(['across notes', 'a series'] as const)('records asking %s with an unencrypted model on the private source notes', async (source) => {
    const org = await account();
    const host = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on' })).code, { mic: true, cam: false });
    await host.transcribe(speech, host.ticket.identity);
    const ended = await host.leave();
    const noteId = ended?.pendingNoteId ?? '';
    await written(org.api, noteId);
    expect((await org.api.notes.get(noteId)).unencrypted).toEqual([]);
    if (source === 'a series') {
      await org.api.meetings.scheduleNext(ended?.meetingId ?? '', new Date(Date.now() + 7 * 86_400_000).toISOString());
    }
    await org.api.account.updatePreferences({ model: UNENCRYPTED_MODEL });
    h.near.holdNext(async () => {
      expect((await org.api.notes.get(noteId)).unencrypted.map((u) => u.model)).toEqual([UNENCRYPTED_MODEL]);
    });
    if (source === 'across notes') await drain(org.api.notes.askAll('When does the beta ship?'));
    else await drain(org.api.series.ask((await org.api.notes.get(noteId)).seriesId ?? '', 'When does the beta ship?', 'America/Toronto'));
    const note = await org.api.notes.get(noteId);
    expect(note.model).toBeNull();
    expect(note.unencrypted.map((u) => [u.model, u.task])).toEqual([[UNENCRYPTED_MODEL, 'notes']]);
  });
});
