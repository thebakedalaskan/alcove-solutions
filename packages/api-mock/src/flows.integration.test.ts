/**
 * End-to-end flows through the AlcoveApi contract. These are the only kind of test in this repo
 * (see AGENTS.md): each one walks a real user journey across auth, meetings, live calls, notes and
 * credits. `makeApi` is the seam: point it at @alcove/api-http to run the same flows against a backend.
 */
import { AlcoveApiError, type AlcoveApi, type AnswerPart, type CallSession } from '@alcove/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApi } from './index';

const makeApi = (): AlcoveApi => createMockApi({ persist: false, latency: [0, 0], writeSeconds: 1 }).api;

/** Run a promise to completion while advancing fake time. */
async function settle<T>(p: Promise<T>, ms = 2_000): Promise<T> {
  let done = false; let value!: T; let error: unknown;
  p.then((v) => { done = true; value = v; }, (e) => { done = true; error = e; });
  for (let t = 0; !done && t < 60_000; t += ms) await vi.advanceTimersByTimeAsync(ms);
  if (error) throw error;
  return value;
}
async function drain<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  await settle((async () => { for await (const x of it) out.push(x); })());
  return out;
}
async function signedIn(api: AlcoveApi) {
  await settle(api.auth.signIn('google'));
  await settle(api.auth.createPasskey());
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('first run', () => {
  it('signs up with a provider, creates a passkey and starts with an empty, credited account', async () => {
    const api = makeApi();
    expect(await settle(api.auth.getSession())).toBeNull();
    await expect(settle(api.meetings.upcoming())).rejects.toMatchObject({ code: 'unauthenticated' });

    const s = await settle(api.auth.signIn('microsoft'));
    expect(s).toMatchObject({ provider: 'microsoft', hasPasskey: false });
    await settle(api.auth.createPasskey());
    expect((await settle(api.auth.getSession()))?.hasPasskey).toBe(true);

    const steps = await settle(api.account.setupSteps());
    expect(steps.filter((x) => x.done).map((x) => x.id)).toEqual(['signed-in', 'passkey', 'calendar']);
    expect((await settle(api.account.calendars())).find((c) => c.connected)?.provider).toBe('microsoft');
    expect(await settle(api.credits.balance())).toEqual({ balance: 10_000, perMinute: 25 });
    expect(await settle(api.meetings.upcoming())).toEqual([]);
    expect(await settle(api.notes.list())).toEqual([]);
  });
});

describe('scheduling', () => {
  it('schedules a call with guests, edits it, changes notes and cancels it', async () => {
    const api = makeApi();
    await signedIn(api);
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const m = await settle(api.meetings.create({ title: 'Harbor kickoff', startsAt: start, durationMinutes: 30, guests: ['ben@harbor.health', 'sam@fastmail.com'], notes: 'full', audience: 'everyone' }));
    expect(m.isHost).toBe(true);
    expect(m.guests.map((g) => [g.email, g.rsvp, !!g.person])).toEqual([['ben@harbor.health', 'pending', true], ['sam@fastmail.com', 'pending', false]]);
    expect(await settle(api.meetings.byCode(m.code))).toMatchObject({ id: m.id });

    const edited = await settle(api.meetings.update(m.id, { title: 'Harbor kickoff (moved)', durationMinutes: 45, guests: ['ben@harbor.health'] }));
    expect(edited.title).toBe('Harbor kickoff (moved)');
    expect((new Date(edited.endsAt).getTime() - new Date(edited.startsAt).getTime()) / 60_000).toBe(45);
    expect(edited.guests).toHaveLength(1);

    expect((await settle(api.meetings.setNotes(m.id, 'off'))).notes).toBe('off');
    await settle(api.meetings.cancel(m.id));
    expect((await settle(api.meetings.upcoming())).map((x) => x.id)).not.toContain(m.id);
  });
});

describe('calls', () => {
  it('runs an instant call with notes, chat and screen sharing, then writes notes and charges credits', async () => {
    const api = makeApi();
    await signedIn(api);
    const { code } = await settle(api.calls.createInstant());
    const call: CallSession = await settle(api.calls.join(code, { mic: true, cam: true, notes: 'full', audience: 'everyone', instant: true }));

    let s = call.getSnapshot();
    expect(s.participants).toHaveLength(1);
    expect(s.notes).toMatchObject({ status: 'on', mode: 'full', everOn: true });
    expect(s.canControlNotes).toBe(true);

    await vi.advanceTimersByTimeAsync(8_000);
    expect(call.getSnapshot().participants.length).toBeGreaterThan(1);

    call.setSharing(true);
    call.sendChat('Deck is in the invite');
    call.pauseNotes();
    const pausedLines = call.getSnapshot().transcript.length;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(call.getSnapshot().transcript.length).toBe(pausedLines);
    call.resumeNotes();
    await vi.advanceTimersByTimeAsync(12_000);

    s = call.getSnapshot();
    expect(s.transcript.length).toBeGreaterThan(pausedLines);
    expect(s.transcript.some((l) => l.kind === 'screen')).toBe(true);
    expect(s.chat.filter((c) => c.isMe).map((c) => c.text)).toEqual(['Deck is in the invite']);

    const before = (await settle(api.credits.balance())).balance;
    const end = await settle(call.leave());
    const noteId = end.pendingNoteId;
    if (!noteId) throw new Error('expected notes to be written');

    const progress = await drain(api.notes.progress(noteId));
    expect(progress.at(-1)?.ready).toBe(true);
    expect(progress.at(-1)?.steps.every((x) => x.done)).toBe(true);

    const note = await settle(api.notes.get(noteId));
    expect(note).toMatchObject({ kind: 'call', keep: 'full', meetingId: end.meetingId });
    expect(note.transcript?.length).toBeGreaterThan(0);
    expect((await settle(api.credits.balance())).balance).toBeLessThan(before);
    expect((await settle(api.meetings.past())).map((m) => m.id)).toContain(end.meetingId);
    expect((await settle(api.account.setupSteps())).find((x) => x.id === 'first-call')?.done).toBe(true);
  });

  it('keeps no transcript for notes-only calls and writes nothing when notes never ran', async () => {
    const api = makeApi();
    await signedIn(api);
    const a = await settle(api.calls.createInstant());
    const notesOnly = await settle(api.calls.join(a.code, { mic: true, cam: false, notes: 'notes' }));
    await vi.advanceTimersByTimeAsync(10_000);
    const r1 = await settle(notesOnly.leave());
    if (!r1.pendingNoteId) throw new Error('expected notes to be written');
    await drain(api.notes.progress(r1.pendingNoteId));
    expect((await settle(api.notes.get(r1.pendingNoteId))).transcript).toBeNull();

    const b = await settle(api.calls.createInstant());
    const noNotes = await settle(api.calls.join(b.code, { mic: true, cam: true, notes: 'off' }));
    const balance = (await settle(api.credits.balance())).balance;
    const r2 = await settle(noNotes.leave());
    expect(r2.pendingNoteId).toBeNull();
    expect((await settle(api.credits.balance())).balance).toBe(balance);
  });

  it('lets a guest join a shared link by name only, without notes controls', async () => {
    const api = makeApi();
    await expect(settle(api.calls.join('kpw-rnzq-hte', { mic: true, cam: true }))).rejects.toMatchObject({ code: 'invalid' });
    const call = await settle(api.calls.join('kpw-rnzq-hte', { name: 'Sam Lee', mic: false, cam: true }));
    const s = call.getSnapshot();
    expect(s.participants.find((p) => p.isMe)).toMatchObject({ isGuest: true, mic: false, person: { name: 'Sam Lee' } });
    expect(s.canControlNotes).toBe(false);
    expect((await settle(call.leave())).pendingNoteId).toBeNull();
  });

  it('rejects an unknown call code', async () => {
    const api = makeApi();
    await signedIn(api);
    const err = await settle(api.calls.join('zzz-zzzz-zzz', { mic: true, cam: true })).catch((e) => e);
    expect(err).toBeInstanceOf(AlcoveApiError);
    expect(err.code).toBe('not-found');
  });
});

describe('room recording', () => {
  it('records, pauses, renames and turns the recording into private notes', async () => {
    const api = makeApi();
    await signedIn(api);
    const rec = await settle(api.recordings.start('Board prep'));
    await vi.advanceTimersByTimeAsync(7_000);
    expect(rec.getSnapshot().transcript.length).toBeGreaterThan(0);

    rec.pause();
    const t = rec.getSnapshot().elapsed;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rec.getSnapshot().elapsed).toBe(t);
    rec.resume();
    rec.rename('Board prep with Dana');

    const { pendingNoteId } = await settle(rec.stop());
    await drain(api.notes.progress(pendingNoteId));
    const note = await settle(api.notes.get(pendingNoteId));
    expect(note).toMatchObject({ kind: 'room', title: 'Board prep with Dana', audience: 'host' });
    expect((await settle(api.notes.list({ kind: 'room' }))).map((n) => n.id)).toEqual([pendingNoteId]);
  });
});

describe('notes and credits', () => {
  it('answers questions with citations, tracks action items and tops up credits', async () => {
    const api = makeApi();
    await signedIn(api);
    const rec = await settle(api.recordings.start('Board prep'));
    const { pendingNoteId: id } = await settle(rec.stop());
    await drain(api.notes.progress(id));

    const parts: AnswerPart[] = await drain(api.notes.ask(id, 'What’s our runway?'));
    expect(parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('')).toContain('Eighteen months');
    expect(parts.some((p) => p.type === 'cite')).toBe(true);

    const note = await settle(api.notes.get(id));
    const [first] = note.actions;
    if (!first) throw new Error('expected action items');
    await settle(api.notes.setActionDone(id, first.id, true));
    expect((await settle(api.notes.list())).find((n) => n.id === id)?.openActions).toBe(note.actions.length - 1);

    expect((await settle(api.notes.list({ text: 'runway' }))).map((n) => n.id)).toContain(id);
    expect(await settle(api.notes.list({ text: 'nothing like this' }))).toEqual([]);

    const before = (await settle(api.credits.balance())).balance;
    expect((await settle(api.credits.purchase('p50'))).balance).toBe(before + 50_000);
    expect((await settle(api.credits.history()))[0]).toMatchObject({ amount: 50_000, label: 'Credits added' });
  });
});
