/**
 * Choosing the AI model (docs: Notes and inference › Choosing the model), end to end: the real API over HTTP via
 * @alcove/api-http, real Postgres and the object store, NEAR AI faked over HTTP. The models on offer are the ones NEAR
 * AI's catalog lists as taking text and images at no more than the price cap. One NEAR AI runs in its TEEs (its
 * registry lists its own endpoint) is private: sealed to its attested key. Any other is unencrypted: asked through the
 * gateway in plaintext, which the call, its card and the note all say. The organizer's choice goes to every AI
 * feature after transcription; speech always goes sealed to Whisper's own endpoint.
 */
import { AlcoveApiError, type AlcoveApi, type AudioPiece, type CallSession, type CallState, type TranscriptClip } from '@alcove/api';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NOTES_MODEL, PRICEY_MODEL, UNENCRYPTED_MODEL, UNVERIFIED_VISION_MODEL, VISION_MODEL, speechWav } from '../../../testing/fakes/near';
import { startHarness, type Harness } from '../../../testing/harness';
import { disposeLiveKit } from '../../../testing/livekit';

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
const drain = async (parts: AsyncIterable<unknown>) => { for await (const p of parts) void p; };
const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');

/**
 * A call with notes on where the organizer says something and catches up, then leaves; once its notes are written:
 * the note, and every request NEAR AI got meanwhile.
 */
async function call(org: Awaited<ReturnType<typeof account>>) {
  const from = h.near.calls.length;
  const chatsFrom = h.near.chats.length;
  const { code: c } = await org.api.calls.startNow({ notes: 'on' });
  const host = await org.api.calls.join(c, { mic: true, cam: false });
  for (let i = 0; i < 2; i++) await host.appendAudio(audio(i));
  await host.transcribe(speech('We agreed to ship the beta on Friday.', 1), host.ticket.identity);
  const capture = host.getSnapshot().capture;
  const card = await h.browser().api.calls.card(c);
  await host.catchUp({ kind: 'all' });
  const noteId = (await host.leave())?.pendingNoteId ?? '';
  await written(org.api, noteId);
  return { noteId, note: await org.api.notes.get(noteId), capture, card, calls: h.near.calls.slice(from), chats: h.near.chats.slice(chatsFrom) };
}

describe('choosing the AI model', () => {
  it('offers the models that take text and images within the price cap, the default first, and says which are private', async () => {
    const me = await account();
    const listed = await me.api.models.list();
    expect(listed.default).toEqual({ id: NOTES_MODEL, name: 'DeepSeek V4.1 Flash 1017', private: true });
    expect(listed.models[0]).toEqual(listed.default);
    expect(listed.models).toEqual(expect.arrayContaining([
      { id: VISION_MODEL, name: 'Qwen3 VL Test', private: true },
      { id: UNVERIFIED_VISION_MODEL, name: 'Vision Unverified', private: true },
      { id: UNENCRYPTED_MODEL, name: 'Vision Elsewhere', private: false }
    ]));
    // Private ones come before the unencrypted ones.
    const firstPlain = listed.models.findIndex((m) => !m.private);
    expect(listed.models.slice(firstPlain).every((m) => !m.private)).toBe(true);
    // Not offered: over the price cap, without a price, without text or images, not ready, speech, and a model NEAR AI
    // runs privately whose endpoint can't be used (never offered unencrypted instead).
    const ids = listed.models.map((m) => m.id);
    for (const id of [PRICEY_MODEL, 'acme/vision-unpriced', 'acme/images-only', 'acme/text-only', 'acme/not-ready', 'openai/whisper-large-v3', 'acme/bad-host']) expect(ids).not.toContain(id);
    expect((await h.browser().fetch(`${h.baseUrl}/v1/models`)).status).toBe(401);
  });

  it('keeps a call with the default model private end to end, whatever someone else chose', async () => {
    // Someone else's choice of an unencrypted model is theirs alone.
    const other = await account();
    await other.api.account.updatePreferences({ model: UNENCRYPTED_MODEL });
    const org = await account(unique('organizer'));
    expect((await org.api.account.preferences()).model).toBeNull();
    const r = await call(org);
    expect(r.capture).toMatchObject({ model: null, modelPrivate: true });
    expect(r.card.capture?.modelPrivate).toBe(true);
    expect(r.calls.filter((x) => x.encryption === 'none')).toEqual([]);
    expect(new Set(r.chats.map((x) => x.model))).toEqual(new Set([NOTES_MODEL]));
    expect(r.chats.every((x) => x.key === h.near.keys().notes)).toBe(true);
    expect(r.note.model).toBeNull();
    expect(r.note.unencrypted).toEqual([]);
    expect(r.note.inference.map((e) => e.model)).toEqual(expect.arrayContaining(['openai/whisper-large-v3', NOTES_MODEL]));
  });

  it('sends everything after transcription to an unencrypted model the organizer chose, in plaintext, and says so', async () => {
    const org = await account(unique('organizer'));
    await org.api.account.updatePreferences({ model: UNENCRYPTED_MODEL });
    const logsFrom = h.logs.length;
    // With thinking on, so that the notes not thinking is the gateway model's doing.
    const r = await configured({ NEAR_AI_NOTES_EFFORT: 100 }, () => call(org));
    // The call, and its card for anyone with the link, say the AI isn't private; which model is the call's own business.
    expect(r.capture).toMatchObject({ model: UNENCRYPTED_MODEL, modelPrivate: false });
    expect(r.card.capture).toMatchObject({ model: null, modelPrivate: false });
    // Speech still goes sealed to Whisper's own endpoint. Catching up and the notes go to the gateway in plaintext,
    // without a temperature, which that model's provider doesn't take, and never asked to think first.
    const speechCalls = r.calls.filter((x) => x.path === '/v1/audio/transcriptions');
    expect(speechCalls.length).toBeGreaterThan(0);
    expect(speechCalls.every((x) => x.encryption === 'ohttp')).toBe(true);
    const chat = r.calls.filter((x) => x.path === '/v1/chat/completions');
    expect(chat.length).toBeGreaterThanOrEqual(2);
    expect(chat.every((x) => x.encryption === 'none' && x.model === UNENCRYPTED_MODEL && x.key === null)).toBe(true);
    expect(r.chats.every((x) => !x.temperature)).toBe(true);
    expect(r.chats.some((x) => x.system.startsWith('You write the notes'))).toBe(true);
    expect(r.chats.every((x) => x.thinking === null && x.maxTokens !== 64_000)).toBe(true);
    // The note names the model and says it worked unencrypted: no evidence vouches for it.
    expect(r.note.model).toBe(UNENCRYPTED_MODEL);
    expect(r.note.unencrypted).toEqual([{ model: UNENCRYPTED_MODEL, task: 'notes', at: expect.any(String) }]);
    expect(r.note.inference.map((e) => e.model)).toEqual(['openai/whisper-large-v3']);
    // Asking about the note, and across the organizer's notes, goes to the same model.
    const asked = h.near.calls.length;
    await drain(org.api.notes.ask(r.noteId, 'When does the beta ship?'));
    await drain(org.api.notes.askAll('When does the beta ship?'));
    expect(h.near.calls.slice(asked).map((x) => `${x.model} ${x.encryption}`)).toEqual([`${UNENCRYPTED_MODEL} none`, `${UNENCRYPTED_MODEL} none`]);
    // The logs say which model and that it wasn't sealed, never what was said.
    const logged = h.logs.slice(logsFrom).join('');
    expect(logged).toContain('"encrypted":false');
    expect(logged).not.toContain('ship the beta');

    // Written again with the default: private again, and the note still says what worked on it before.
    const again = h.near.calls.length;
    await org.api.notes.rewrite(r.noteId, { model: null });
    await written(org.api, r.noteId);
    expect(h.near.calls.slice(again).filter((x) => x.path === '/v1/chat/completions').every((x) => x.encryption === 'ohttp' && x.model === NOTES_MODEL)).toBe(true);
    const note = await org.api.notes.get(r.noteId);
    expect(note.model).toBeNull();
    expect(note.unencrypted.map((u) => u.model)).toEqual([UNENCRYPTED_MODEL]);
  });

  it('falls back to the default for a model that isn’t on offer, and nobody else can choose a note’s model', async () => {
    const org = await account(unique('organizer'));
    await org.api.account.updatePreferences({ model: PRICEY_MODEL });
    const logsFrom = h.logs.length;
    const r = await call(org);
    expect(r.capture).toMatchObject({ model: PRICEY_MODEL, modelPrivate: true });
    expect(r.calls.filter((x) => x.encryption === 'none')).toEqual([]);
    expect(r.calls.some((x) => x.model === PRICEY_MODEL)).toBe(false);
    expect(r.note.unencrypted).toEqual([]);
    expect(h.logs.slice(logsFrom).some((l) => l.includes('"msg":"model unavailable"') && l.includes(PRICEY_MODEL))).toBe(true);
    // Someone else can't write the organizer's notes again with a model of their choosing.
    const stranger = await account();
    expect(code(await stranger.api.notes.rewrite(r.noteId, { model: UNENCRYPTED_MODEL }).catch((e: unknown) => e))).toBe('not-found');
  });
});

/** The notes' own requests among `chats`, and everything else asked. */
const notesOf = (chats: typeof h.near.chats) => chats.filter((x) => x.system.startsWith('You write the notes'));
const restOf = (chats: typeof h.near.chats) => chats.filter((x) => !x.system.startsWith('You write the notes'));
/** For `holdNext`: the notes model gets a new key while the notes' own request is answered; any other request passes it on. */
const rotateOnNotes = async (): Promise<void> => {
  if (notesOf(h.near.chats.slice(-1)).length) h.near.rotate('notes');
  else h.near.holdNext(rotateOnNotes);
};
/** Runs `fn` with the server's settings changed by `patch`, then as they were. */
async function configured<T>(patch: Partial<typeof h.deps.cfg>, fn: () => Promise<T>): Promise<T> {
  const was = h.deps.cfg;
  h.deps.cfg = { ...was, ...patch };
  try { return await fn(); } finally { h.deps.cfg = was; }
}
const inGroup = async (call: CallSession) => {
  for (let i = 0; i < 600 && !(call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null); i++) await new Promise((r) => setTimeout(r, 25));
};
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 100 && !pred(call.getSnapshot()); i++) { await call.refresh(); await new Promise((r) => setTimeout(r, 30)); }
  return call.getSnapshot();
}

describe('thinking first (NEAR_AI_NOTES_EFFORT)', () => {
  it('thinks at the most effort only to write the notes after a call, each breakout room’s too, with the room thinking takes', async () => {
    const org = await account(unique('organizer'));
    const kofiEmail = unique('kofi');
    const chatsFrom = h.near.chats.length;
    const noteId = await configured({ NEAR_AI_NOTES_EFFORT: 100 }, async () => {
      const { code: c } = await org.api.calls.startNow({ notes: 'on', guests: [kofiEmail] });
      const host = await org.api.calls.join(c, { mic: true, cam: false });
      await inGroup(host);
      const kofi = await (await account(kofiEmail)).api.calls.join(c, { mic: true, cam: false });
      await inGroup(kofi);
      await host.appendAudio(audio(0));
      await host.transcribe(speech('We agreed to ship the beta on Friday.', 1), host.ticket.identity);
      // Catching up and asking in the call don't think.
      await host.catchUp({ kind: 'all' });
      await host.askSoFar('When does the beta ship?', { kind: 'all' });
      host.openRooms({ rooms: [{ name: 'Design', emails: [kofiEmail] }, { name: 'Support', emails: [] }], minutes: 5, board: { mode: 'none', template: 'blank' } });
      const design = (await settle(host, (x) => x.breakouts.open !== null)).breakouts.open?.rooms.find((r) => r.name === 'Design')?.id ?? '';
      await settle(kofi, (x) => x.capture.room?.id === design && x.capture.room.scribe === kofi.ticket.identity);
      await kofi.transcribe(speech('Design starts with the colours.', 4), kofi.ticket.identity);
      const id = (await host.leave())?.pendingNoteId ?? '';
      await written(org.api, id);
      // Nor does asking about the note after it.
      await drain(org.api.notes.ask(id, 'When does the beta ship?'));
      return id;
    });
    const chats = h.near.chats.slice(chatsFrom).filter((x) => x.model === NOTES_MODEL);
    const notes = notesOf(chats);
    expect(notes).toHaveLength(2);
    expect(notes.map((x) => [x.thinking, x.maxTokens])).toEqual([[100, 64_000], [100, 64_000]]);
    const rest = restOf(chats);
    expect(rest.some((x) => x.system.startsWith('You write the full summary'))).toBe(true);
    expect(rest.some((x) => x.system.startsWith('You help someone catch up'))).toBe(true);
    expect(rest.filter((x) => x.system.startsWith('You answer a question'))).toHaveLength(2);
    expect(rest.every((x) => x.thinking === 0 && (x.maxTokens ?? 0) <= 4000)).toBe(true);
    const note = await org.api.notes.get(noteId);
    expect(note.summary).not.toBe('');
    expect(note.rooms.find((r) => r.name === 'Design')?.summary).not.toBe('');
  });

  it('writes the notes without thinking when NEAR_AI_NOTES_EFFORT is 0', async () => {
    const org = await account(unique('organizer'));
    const r = await configured({ NEAR_AI_NOTES_EFFORT: 0 }, () => call(org));
    expect(notesOf(r.chats).map((x) => [x.thinking, x.maxTokens])).toEqual([[0, 4000]]);
    expect(r.note.summary).not.toBe('');
  });

  it('asks again at once without thinking when the thinking request is cut off or comes back unusable, and saves the notes', async () => {
    for (const how of ['dropped', 'prose'] as const) {
      const org = await account(unique('organizer'));
      const logsFrom = h.logs.length;
      h.near.failNext(1, how, 'notes');
      // Cut off while the model's key changes: the thinking request isn't sent again to the new key, and only the request
      // without thinking goes there.
      const was = h.near.keys().notes;
      if (how === 'dropped') h.near.holdNext(rotateOnNotes);
      const r = await configured({ NEAR_AI_NOTES_EFFORT: 100 }, () => call(org));
      expect(notesOf(r.chats).map((x) => [x.thinking, x.maxTokens]), how).toEqual([[100, 64_000], [0, 4000]]);
      if (how === 'dropped') expect(notesOf(r.chats).map((x) => x.key)).toEqual([was, h.near.keys().notes]);
      expect(r.note.summary, how).not.toBe('');
      expect(r.note.inference.map((e) => e.model), how).toContain(NOTES_MODEL);
      expect(h.logs.slice(logsFrom).some((l) => l.includes('"msg":"notes not written thinking first; asking again without"')), how).toBe(true);
    }
  });

  it('never thinks again once the notes waited for the model: the job starts over without thinking', async () => {
    const org = await account(unique('organizer'));
    const chatsFrom = h.near.chats.length;
    await configured({ NEAR_AI_NOTES_EFFORT: 100 }, async () => {
      const rec = await org.api.recordings.start({ title: 'Waits after thinking' });
      await rec.transcribe(speech('We agreed to wait for an answer.', 0));
      // NEAR AI closes the thinking request, then the one without thinking: the job waits for the model.
      h.near.failNext(2, 'dropped', 'notes');
      const { pendingNoteId } = await rec.stop();
      const state = async () => (await h.pool.query<{ state: string }>('SELECT state FROM content_jobs WHERE owner_id = $1', [org.session.ownerId])).rows[0]?.state;
      for (let i = 0; i < 600 && (await state()) !== 'waiting'; i++) await new Promise((r) => setTimeout(r, 25));
      expect(await state()).toBe('waiting');
      await h.pool.query(`UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = $1`, [org.session.ownerId]);
      const { maintain } = await import('../../../maintenance');
      await maintain(h.deps);
      expect((await org.api.notes.get(pendingNoteId)).status).toBe('ready');
    });
    expect(notesOf(h.near.chats.slice(chatsFrom)).map((x) => x.thinking)).toEqual([100, 0, 0]);
  });
});
