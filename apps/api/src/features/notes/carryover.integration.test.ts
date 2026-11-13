/**
 * What carries over into a call, at its pre-join and during it, end to end against the real API, Postgres, the object
 * store and the local LiveKit server (AGENTS.md: integration tests only). Each person's grant is checked for each earlier
 * note on every read: having been invited to this call, or being in it, opens nothing from the others. What a later
 * call replaced or answered is read from the later note, for people who have both. Calls are held, transcribed and
 * written up through the stand-in NEAR AI.
 */
import { AlcoveApiError, DEFAULT_NOTES_CHOICES, type AlcoveApi, type CallSession, type CallState, type Series, type SeriesAnswerPart, type TranscriptClip } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { speechWav } from '../../testing/fake-near';
import { acceptNoteSuggestions } from '../../testing/follow-ups';
import { startHarness, type Harness } from '../../testing/harness';
import { disposeLiveKit } from '../../testing/livekit';

// Calls set up MLS groups and LiveKit rooms, which a busy runner can be slow to do: every wait says what it waited for.
vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); await disposeLiveKit(); });
afterEach(() => { h.closeCalls(); });

let seq = 0;
const tag = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
/** An address at a domain of its own, so the notes model knows its owner by the name before the @. */
const at = (name: string) => `${name}@c${tag()}.example`;
async function account(email: string) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email };
}
const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
const refusal = (e: unknown) => (e instanceof AlcoveApiError ? [e.code, e.message] : ['not-an-api-error', '']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A clip of speech saying `words`; sentences split by " // " come back as lines two seconds apart. */
const speech = (words: string, atMs = 0): TranscriptClip => ({ data: new Blob([speechWav(words)], { type: 'audio/wav' }), segment: 0, at: atMs / 1000, durationMs: 4000 });
async function waitFor(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
async function settle(call: CallSession, pred: (s: CallState) => boolean): Promise<CallState> {
  for (let i = 0; i < 100 && !pred(call.getSnapshot()); i++) { await call.refresh(); await sleep(30); }
  return call.getSnapshot();
}
const inGroup = (call: CallSession) => waitFor(() => call.crypto.getSnapshot().status === 'in' && call.crypto.getSnapshot().media !== null, `${call.ticket.role} in the call’s group`);
async function letIn(host: CallSession, who: CallSession) {
  await settle(host, (s) => s.waiting.some((w) => w.id === who.ticket.identity));
  await host.admit(who.ticket.identity);
  await inGroup(who);
}
/** How many times a call has been compared with earlier ones, or had nothing to compare with: that comes after its notes, and nothing waits for it. */
const comparisons = (noteId: string) => h.logs.filter((l) => l.includes(noteId) && /call compared with earlier ones|call not compared with earlier ones|nothing to compare a call with/.test(l)).length;
const ready = async (api: AlcoveApi, noteId: string) => { for await (const p of api.notes.progress(noteId)) if (p.ready) break; };
const written = async (api: AlcoveApi, noteId: string) => { await ready(api, noteId); await waitFor(() => comparisons(noteId) > 0, 'the comparison with earlier calls'); };
async function rewritten(api: AlcoveApi, noteId: string) {
  const before = comparisons(noteId);
  await api.notes.rewrite(noteId);
  await ready(api, noteId);
  await waitFor(() => comparisons(noteId) > before, 'the comparison with earlier calls, again');
}
/** Holds a call with notes on: joins it by its code, says `words`, ends it and waits for its notes to be written. */
async function hold(api: AlcoveApi, callCode: string, words: string): Promise<{ noteId: string; meetingId: string }> {
  const call = await api.calls.join(callCode, { mic: true, cam: false });
  await call.transcribe(speech(words), call.ticket.identity);
  const end = await call.leave();
  if (!end) throw new Error('the organizer’s leave ended nothing');
  const noteId = end.pendingNoteId ?? '';
  await written(api, noteId);
  await acceptNoteSuggestions(api, noteId);
  return { noteId, meetingId: end.meetingId };
}
/** The same clock time a week after `iso`, a week further each time until it's still to come: what the app sends. */
function weekOn(iso: string): string {
  const d = new Date(iso);
  do { d.setDate(d.getDate() + 7); } while (d.getTime() <= Date.now());
  return d.toISOString();
}
const scheduleNext = async (api: AlcoveApi, meetingId: string) => api.meetings.scheduleNext(meetingId, weekOn((await api.meetings.get(meetingId)).startsAt));
/** Which notes everything carried over comes from. */
const sourcesOf = (s: Series | null) => [...new Set([...(s?.decisions ?? []), ...(s?.questions ?? []), ...(s?.actions ?? [])].map((x) => x.noteId))];
const encodings = (s: string) => [s, Buffer.from(s).toString('hex'), Buffer.from(s).toString('base64').slice(0, 12), Buffer.from(s).toString('base64url').slice(0, 12)];
const ZONE = 'Europe/London';
/** What's in the prompt that compares a call with earlier ones, when an earlier one decided something. */
const COMPARING = 'Decided in earlier meetings:';

describe('what carries over into a call', () => {
  it('shows at the pre-join and during the call what each person has notes for, and nothing to anyone else', async () => {
    const org = await account(at('olu'));
    const bea = await account(at('bea'));
    const cal = await account(at('cal'));
    const dex = await account(at('dex'));
    const { code: firstCode } = await org.api.calls.startNow({ title: 'Launch sync', notes: 'on', guests: [bea.email] });
    // A call in no series has nothing to carry, for anyone.
    expect(await org.api.calls.series(firstCode)).toBeNull();
    const one = await hold(org.api, firstCode, 'We agreed to ship the beta on Monday. // Can we afford a second designer? // Bea will draft the launch email by Friday.');
    const next = await scheduleNext(org.api, one.meetingId);
    const seriesId = next.seriesId ?? '';
    await org.api.meetings.update(next.id, { guests: [bea.email, cal.email] });
    const note = await org.api.notes.get(one.noteId);
    await bea.api.notes.updateDecision(one.noteId, note.decisions[0]?.id ?? '', { state: 'confirmed', seen: { text: note.decisions[0]?.text ?? '' } });
    await bea.api.notes.updateAction(one.noteId, note.actions[0]?.id ?? '', { takeOn: true, seen: { text: note.actions[0]?.text ?? '', due: note.actions[0]?.due ?? null } });

    // At the pre-join, before there's any pass: the organizer, and someone with the earlier notes, by the call's link.
    const before = await bea.api.calls.series(next.code);
    expect(before).toMatchObject({ id: seriesId, isOrganizer: false, notes: [{ id: one.noteId }] });
    expect(before?.decisions.map((d) => [d.text, d.state, d.noteId])).toEqual([['We agreed to ship the beta on Monday.', 'confirmed', one.noteId]]);
    expect(before?.questions.map((q) => [q.text, q.later, q.stale, q.noteId])).toEqual([['Can we afford a second designer?', 0, false, one.noteId]]);
    expect(before?.actions.map((a) => [a.text, a.takenOn, a.done, a.noteId])).toEqual([['Draft the launch email by Friday', true, false, one.noteId]]);
    expect(await org.api.calls.series(next.code)).toMatchObject({ id: seriesId, isOrganizer: true, next: { id: next.id } });

    // Cal is invited to this call and has no notes from the last one; Dex only has the link. Nothing, and no hint of what's there.
    expect(await cal.api.calls.series(next.code)).toBeNull();
    expect(await dex.api.calls.series(next.code)).toBeNull();
    expect(code(await cal.api.series.get(seriesId).catch((e: unknown) => e))).toBe('not-found');
    // Someone with only the link has no account, so nothing of their own to carry over.
    const guest = h.browser().api;
    expect(refusal(await guest.calls.series(next.code).catch((e: unknown) => e))).toEqual(['unauthenticated', 'Sign in to see what carries over from earlier calls.']);
    expect(code(await guest.calls.series('nosuch-code-here').catch((e: unknown) => e))).toBe('unauthenticated');
    expect(code(await bea.api.calls.series('nosuch-code-here').catch((e: unknown) => e))).toBe('not-found');
    // What anyone with the link can read doesn't say the call is in a series.
    expect(JSON.stringify(await guest.calls.card(next.code))).not.toMatch(new RegExp(`${seriesId}|series|designer|launch email|beta`, 'i'));

    // During the call: everyone in it reads their own, and it's in nobody's view of the call.
    const host = await org.api.calls.join(next.code, { mic: true, cam: false });
    await inGroup(host);
    const inBea = await bea.api.calls.join(next.code, { mic: true, cam: false });
    await inGroup(inBea);
    const inCal = await cal.api.calls.join(next.code, { mic: true, cam: false });
    await inGroup(inCal);
    const inGuest = await guest.calls.join(next.code, { mic: true, cam: false, name: 'Gil Guest' });
    await letIn(host, inGuest);
    // The call's own notes are still being recorded, so only the earlier ones count.
    expect(sourcesOf(await bea.api.calls.series(next.code))).toEqual([one.noteId]);
    expect(sourcesOf(await org.api.calls.series(next.code))).toEqual([one.noteId]);
    expect(await cal.api.calls.series(next.code)).toBeNull();
    expect(code(await guest.calls.series(next.code).catch((e: unknown) => e))).toBe('unauthenticated');
    for (const call of [host, inBea, inCal, inGuest]) {
      await call.refresh();
      expect(JSON.stringify(call.getSnapshot()), `${call.ticket.role}’s view of the call`).not.toMatch(new RegExp(`${seriesId}|second designer|launch email|ship the beta`));
    }

    // Given the notes on purpose, Cal has them from then on, in the call they're in; and a source opens for them.
    await bea.api.notes.share(one.noteId, { emails: [cal.email] });
    expect(sourcesOf(await cal.api.calls.series(next.code))).toEqual([one.noteId]);
    expect((await cal.api.notes.get(one.noteId)).decisions[0]?.text).toBe('We agreed to ship the beta on Monday.');
    // Cal removes them, and they go at once: from what carries over, and from the source's link.
    await cal.api.notes.delete(one.noteId);
    expect(await cal.api.calls.series(next.code)).toBeNull();
    expect(code(await cal.api.notes.get(one.noteId).catch((e: unknown) => e))).toBe('not-found');

    // The organizer deletes them during the call: for everyone at once, with the source's link, and nothing stays.
    await org.api.notes.delete(one.noteId);
    expect(await bea.api.calls.series(next.code)).toBeNull();
    expect(code(await bea.api.notes.get(one.noteId).catch((e: unknown) => e))).toBe('not-found');
    expect(await org.api.calls.series(next.code)).toMatchObject({ notes: [], decisions: [], questions: [], answered: [], actions: [] });
    await host.leave();
  });

  it('goes by each earlier call’s notes on their own, however someone’s place in the series changes', async () => {
    const org = await account(at('opal'));
    const bea = await account(at('bea'));
    const cal = await account(at('cal'));
    const { code: firstCode } = await org.api.calls.startNow({ title: 'Budget review', notes: 'on', guests: [bea.email] });
    const one = await hold(org.api, firstCode, 'We agreed to cut the travel budget.');
    const second = await scheduleNext(org.api, one.meetingId);
    await org.api.meetings.update(second.id, { guests: [cal.email] });
    const two = await hold(org.api, second.code, 'We agreed to freeze hiring.');
    const third = await scheduleNext(org.api, two.meetingId);
    await org.api.meetings.update(third.id, { guests: [bea.email, cal.email] });

    // Bea has the first call's notes and Cal the second's, and both are invited to the third: each reads theirs alone.
    expect(sourcesOf(await bea.api.calls.series(third.code))).toEqual([one.noteId]);
    expect(sourcesOf(await cal.api.calls.series(third.code))).toEqual([two.noteId]);
    expect(sourcesOf(await org.api.calls.series(third.code))).toEqual([two.noteId, one.noteId]);
    // Off the invite, what Bea already has stays hers; on it, what Cal never had stays out.
    await org.api.meetings.update(third.id, { guests: [cal.email] });
    expect(sourcesOf(await bea.api.calls.series(third.code))).toEqual([one.noteId]);
    expect(sourcesOf(await cal.api.calls.series(third.code))).toEqual([two.noteId]);
    // Another organizer's series is nothing to Bea, by its link or by its ID, however many series Bea is in.
    const other = await account(at('ola'));
    const { code: theirs } = await other.api.calls.startNow({ title: 'Other series', notes: 'on' });
    const held = await hold(other.api, theirs, 'We agreed to rent the hall.');
    const elsewhere = await scheduleNext(other.api, held.meetingId);
    expect(await bea.api.calls.series(elsewhere.code)).toBeNull();
    expect(code(await bea.api.series.get(elsewhere.seriesId ?? '').catch((e: unknown) => e))).toBe('not-found');
  });
});

describe('a series scheduled to repeat', () => {
  it('carries over the same way, by its one link and by each call’s own, and each later call is compared', async () => {
    const DAY = 86_400_000;
    const org = await account(at('olu'));
    const bea = await account(at('bea'));
    const stranger = await account(at('stranger'));
    const first = Math.ceil((Date.now() + 2 * DAY) / 3_600_000) * 3_600_000;
    const occurrences = [0, 1, 2].map((i) => new Date(first + i * 7 * DAY).toISOString());
    const made = await org.api.meetings.create({
      title: 'Weekly review', startsAt: new Date(first).toISOString(), durationMinutes: 30, guests: [bea.email], notes: 'on',
      repeat: { rule: { every: 'week', weeks: 1, days: [new Date(first).getUTCDay()] }, until: new Date(first + 14 * DAY).toISOString().slice(0, 10), timeZone: 'UTC', occurrences }
    });
    const link = made.seriesCode ?? '';
    const seriesId = made.seriesId ?? '';
    const calls = async () => (await org.api.meetings.upcoming()).filter((m) => m.seriesId === seriesId).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const [firstCall] = await calls();
    const one = await hold(org.api, firstCall?.code ?? '', 'We agreed to keep the old pricing page. // Who owns the renewal emails?');
    const decision = (await org.api.notes.get(one.noteId)).decisions[0];
    await bea.api.notes.updateDecision(one.noteId, decision?.id ?? '', { state: 'confirmed', seen: { text: decision?.text ?? '' } });

    const [nextCall] = await calls();
    for (const c of [link, nextCall?.code ?? '']) {
      expect((await bea.api.calls.series(c))).toMatchObject({ id: seriesId, decisions: [{ id: decision?.id, noteId: one.noteId, state: 'confirmed' }] });
      expect(await stranger.api.calls.series(c)).toBeNull();
    }
    const two = await hold(org.api, nextCall?.code ?? '', 'We decided to retire the old pricing page instead.');
    expect((await bea.api.series.get(seriesId)).decisions.find((d) => d.id === decision?.id)?.replacedBy?.noteId).toBe(two.noteId);
  });
});

describe('asking across the series during a call', () => {
  /** Two calls Bea was in, the second of them Cal's first, and a third everyone is in now, a guest with the link too. */
  async function third() {
    const org = await account(at('ora'));
    const bea = await account(at('bea'));
    const cal = await account(at('cal'));
    const { code: firstCode } = await org.api.calls.startNow({ title: 'Roadmap', notes: 'on', guests: [bea.email] });
    const one = await hold(org.api, firstCode, 'We agreed to drop the tablet app because support costs too much. // Bea will tell the board by Friday.');
    const next = await scheduleNext(org.api, one.meetingId);
    await org.api.meetings.update(next.id, { guests: [bea.email, cal.email] });
    const two = await hold(org.api, next.code, 'We decided to hire two engineers.');
    const now = await scheduleNext(org.api, two.meetingId);
    const host = await org.api.calls.join(now.code, { mic: true, cam: false });
    await inGroup(host);
    const inBea = await bea.api.calls.join(now.code, { mic: true, cam: false });
    await inGroup(inBea);
    const inCal = await cal.api.calls.join(now.code, { mic: true, cam: false });
    await inGroup(inCal);
    const guest = h.browser();
    const inGuest = await guest.api.calls.join(now.code, { mic: true, cam: false, name: 'Gil Guest' });
    await letIn(host, inGuest);
    return { org, bea, cal, guest, one, two, now, host, inBea, inCal, inGuest };
  }

  it('answers from the asker’s own earlier notes, with its sources, sealed to the verified notes model', async () => {
    const { bea, cal, one, now, host, inBea, inCal, inGuest } = await third();
    const [sent, arrived] = [h.near.calls.length, h.near.received.length];
    expect(await inBea.askEarlier('Why did we drop the tablet?', ZONE)).toEqual([
      { type: 'text', text: 'From meeting 2: We agreed to drop the tablet app because support costs too much.' },
      { type: 'source', noteId: one.noteId, title: 'Roadmap', startedAt: expect.any(String), at: 0 }
    ]);
    expect(h.near.calls.slice(sent).map((x) => [x.path, x.encryption])).toEqual([['/v1/chat/completions', 'ohttp']]);
    const paths = h.near.received.slice(arrived).map((r) => r.path);
    expect(paths).toContain('/direct/glm/ohttp');
    expect(paths).not.toContain('/v1/chat/completions');

    // Cal has the second call's notes only: the first never reaches the model for them, and the answer says so.
    expect(await inCal.askEarlier('Why did we drop the tablet?', ZONE)).toEqual([{ type: 'text', text: 'That wasn’t covered in these meetings.' }]);
    const prompt = h.near.prompts.at(-1) ?? '';
    expect(prompt).toContain('We decided to hire two engineers.');
    for (const away of ['tablet app', 'support costs', 'tell the board']) expect(prompt).not.toContain(away);
    // The question is the asker's, and nothing of the call they're in goes with it.
    expect(prompt).toContain('Why did we drop the tablet?');

    // A guest has no notes, and no account to have them under. Their pass opens the call, not anyone's history.
    const before = h.near.prompts.length;
    expect(code(await inGuest.askEarlier('Why did we drop the tablet?', ZONE).catch((e: unknown) => e))).toBe('unauthenticated');
    // Someone signed in with no notes from the series is told nothing about it, in the call or out.
    const dex = await account(at('dex'));
    const inDex = await dex.api.calls.join(now.code, { mic: true, cam: false });
    // Still waiting: the pass opens nothing until they're let in.
    expect(code(await inDex.askEarlier('Why did we drop the tablet?', ZONE).catch((e: unknown) => e))).toBe('forbidden');
    await letIn(host, inDex);
    expect(code(await inDex.askEarlier('Why did we drop the tablet?', ZONE).catch((e: unknown) => e))).toBe('not-found');
    // A time zone that isn't one is refused before anything goes.
    expect(code(await inBea.askEarlier('Why did we drop the tablet?', 'Mars/Olympus_Mons').catch((e: unknown) => e))).toBe('invalid');
    expect(h.near.prompts.length).toBe(before);

    // A pass is no way into someone else's notes: the answer comes from the session's account, whoever's pass it brought.
    const asked = await cal.fetch(`${h.baseUrl}/v1/live/calls/${inBea.ticket.callId}/series/ask`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': inBea.ticket.pass }, body: JSON.stringify({ question: 'Why did we drop the tablet?', timeZone: ZONE })
    });
    expect(await asked.json()).toEqual([{ type: 'text', text: 'That wasn’t covered in these meetings.' }]);
    // A pass for this call says nothing on another's route, and without a pass there's no asking at all.
    const elsewhere = await bea.fetch(`${h.baseUrl}/v1/live/calls/AAAAAAAAAAAAAAAAAAAAAA/series/ask`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-call': inBea.ticket.pass }, body: JSON.stringify({ question: 'Anything?', timeZone: ZONE })
    });
    expect(elsewhere.status).toBe(401);

    // Nothing is kept: no receipt holds a question or an answer.
    expect((await h.pool.query("SELECT count(*)::int AS n FROM operations WHERE method LIKE '%/series/%'")).rows[0]?.n).toBe(0);
    // And it wasn't put in the call for anyone else: the organizer's view is as it was.
    await host.refresh();
    expect(JSON.stringify(host.getSnapshot())).not.toMatch(/tablet/);
    await host.leave();
  });

  it('waits while notes are paused, when nothing goes to the AI, and works with notes off', async () => {
    const { bea, host, inBea, now } = await third();
    await host.transcribe(speech('Nothing yet.'), host.ticket.identity);
    await host.pause();
    await settle(inBea, (s) => s.capture.mode === 'paused');
    const sent = h.near.prompts.length;
    expect(refusal(await inBea.askEarlier('Why did we drop the tablet?', ZONE).catch((e: unknown) => e))).toEqual(['conflict', 'Notes are paused. Nothing is recorded, transcribed or sent to the AI until the organizer resumes.']);
    expect(h.near.prompts.length).toBe(sent);
    // What carries over is still there to read: it goes nowhere.
    expect((await bea.api.calls.series(now.code))?.decisions.length).toBe(2);
    await host.resume();
    await settle(inBea, (s) => s.capture.mode === 'on');
    expect((await inBea.askEarlier('Why did we drop the tablet?', ZONE))[0]).toMatchObject({ type: 'text' });
    // Notes turned off: this call captures nothing, and asking about earlier ones reads nothing of it.
    await host.setNotes(false);
    await settle(inBea, (s) => s.capture.mode === 'off');
    expect((await inBea.askEarlier('Why did we drop the tablet?', ZONE))[0]).toMatchObject({ type: 'text', text: 'From meeting 2: We agreed to drop the tablet app because support costs too much.' });
    await host.leave();
  });

  it('sends no answer written while a note it read was deleted or taken from the asker', async () => {
    const { org, bea, one, now, host, inBea } = await third();
    const gone = ['conflict', 'Notes from one of these calls were deleted or removed from yours while the answer was being written, so it isn’t shown. Ask again.'];
    const sent = h.near.prompts.length;
    // The note goes once the question has reached the notes model, which answers only after it. Anything else it's
    // asked meanwhile (a call compared with earlier ones after its notes, which nothing waits for) goes by.
    let deleted: unknown = 'the question never reached the notes model';
    const hold = async (): Promise<void> => {
      if (!h.near.instructions.at(-1)?.startsWith('You answer a question about a series')) { h.near.holdNext(hold); return; }
      deleted = await org.api.notes.delete(one.noteId).then(() => 'deleted', (e: unknown) => e);
    };
    h.near.holdNext(hold);
    expect(refusal(await inBea.askEarlier('Why did we drop the tablet?', ZONE).catch((e: unknown) => e))).toEqual(gone);
    expect(deleted).toBe('deleted');
    expect(h.near.prompts.length).toBeGreaterThan(sent);
    // Asked again, it answers from what's left; what went is in neither what carries over nor the answer.
    expect(await inBea.askEarlier('Why did we drop the tablet?', ZONE)).toEqual([{ type: 'text', text: 'That wasn’t covered in these meetings.' }]);
    expect(JSON.stringify(await bea.api.calls.series(now.code))).not.toMatch(/tablet/);
    await host.leave();
  });

  it('stops answering someone removed from the call, and leaves them their own notes', async () => {
    const { bea, host, inBea, now } = await third();
    const theirs = await bea.api.calls.series(now.code);
    expect(theirs?.decisions.length).toBe(2);
    await host.remove(inBea.ticket.identity);
    await settle(host, (s) => !s.participants.some((p) => p.id === inBea.ticket.identity));
    const sent = h.near.prompts.length;
    expect(code(await inBea.askEarlier('Why did we drop the tablet?', ZONE).catch((e: unknown) => e))).toBe('forbidden');
    expect(h.near.prompts.length).toBe(sent);
    // Their notes are theirs: being sent out of this call changes nothing in them.
    expect(await bea.api.calls.series(now.code)).toEqual(theirs);
    await host.leave();
  });

  it('has nothing to ask in a call outside a series', async () => {
    const org = await account(at('oda'));
    const { code: c } = await org.api.calls.startNow({ title: 'One-off', notes: 'on' });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    expect(code(await host.askEarlier('Anything?', ZONE).catch((e: unknown) => e))).toBe('not-found');
    await host.leave();
  });
});

describe('what later calls did to what earlier ones left', () => {
  /** A confirmed decision and an open question from one call, and a later one that replaces and answers them. */
  async function twoCalls() {
    const org = await account(at('olu'));
    const bea = await account(at('bea'));
    const cal = await account(at('cal'));
    const { code: firstCode } = await org.api.calls.startNow({ title: 'Pricing', notes: 'on', guests: [bea.email] });
    const one = await hold(org.api, firstCode, 'We agreed to keep annual pricing. // Who owns the renewal emails?');
    const early = await org.api.notes.get(one.noteId);
    const decision = early.decisions[0]?.id ?? '';
    const words = early.decisions[0]?.text ?? '';
    const question = early.questions[0]?.id ?? '';
    await bea.api.notes.updateDecision(one.noteId, decision, { state: 'confirmed', seen: { text: words } });
    const next = await scheduleNext(org.api, one.meetingId);
    await org.api.meetings.update(next.id, { guests: [bea.email, cal.email] });
    const before = h.near.prompts.length;
    const two = await hold(org.api, next.code, 'We decided to drop annual pricing instead. // Answer: Priya owns the renewal emails.');
    return { org, bea, cal, one, two, next, decision, words, question, prompts: h.near.prompts.slice(before), seriesId: next.seriesId ?? '' };
  }

  it('marks a replaced decision and an answered question for people with both notes, and leaves them standing until someone says', async () => {
    const { org, bea, cal, one, two, decision, question, prompts, seriesId } = await twoCalls();
    const later = (await org.api.notes.get(two.noteId)).decisions[0];
    for (const who of [org, bea]) {
      const s = await who.api.series.get(seriesId);
      const was = s.decisions.find((d) => d.id === decision);
      // The notes only suggest: it's still confirmed, and the question still open.
      expect(was).toMatchObject({ state: 'confirmed', noteId: one.noteId, replacedBy: { id: expect.any(String), noteId: two.noteId, text: 'We decided to drop annual pricing instead.', at: 0 } });
      expect(s.questions.find((q) => q.id === question)).toMatchObject({ state: 'open', noteId: one.noteId, answeredIn: { id: expect.any(String), noteId: two.noteId, at: 2 } });
      expect(s.decisions.find((d) => d.id === later?.id)?.replacedBy).toBeUndefined();
    }
    // Nothing the model made up got through: only labels it was given, and each earlier item once.
    const revisits = (await org.api.series.get(seriesId));
    expect(revisits.decisions.filter((d) => d.replacedBy)).toHaveLength(1);
    expect(revisits.questions.filter((q) => q.answeredIn)).toHaveLength(1);

    // It was asked apart from the notes, sealed like them. The notes of the later call never read the earlier ones,
    // so what goes to everyone invited to it can't say what an earlier call said.
    const comparing = prompts.filter((p) => p.includes(COMPARING));
    expect(comparing).toHaveLength(1);
    expect(comparing[0]).toContain('E1: We agreed to keep annual pricing.');
    expect(comparing[0]).toContain('Q1: Who owns the renewal emails?');
    expect(comparing[0]).toContain('N1: We decided to drop annual pricing instead.');
    const notesPrompt = prompts.filter((p) => !p.includes(COMPARING));
    expect(notesPrompt.length).toBeGreaterThan(0);
    for (const p of notesPrompt) { expect(p).not.toContain('keep annual pricing'); expect(p).not.toContain('Who owns the renewal emails?'); }

    // Cal has only the later call's notes: its note says nothing of the earlier one, and neither does the series.
    const theirs = await cal.api.series.get(seriesId);
    expect(theirs.notes.map((n) => n.id)).toEqual([two.noteId]);
    expect(JSON.stringify(theirs)).not.toMatch(new RegExp(`${one.noteId}|${decision}|${question}|keep annual`));
    expect(JSON.stringify(await cal.api.notes.get(two.noteId))).not.toMatch(new RegExp(`${one.noteId}|${decision}|${question}|revisit`));

    // Dex is given the earlier notes alone: what the later call did isn't theirs to know.
    const dex = await account(at('dex'));
    await bea.api.notes.share(one.noteId, { emails: [dex.email] });
    const early = await dex.api.series.get(seriesId);
    expect(early.decisions.map((d) => [d.state, d.replacedBy])).toEqual([['confirmed', undefined]]);
    expect(early.questions.map((q) => [q.state, q.answeredIn])).toEqual([['open', undefined]]);
    expect(JSON.stringify(early)).not.toMatch(new RegExp(`${two.noteId}|drop annual|Priya`));

    // Given the later notes too, Dex sees it; removing them, it goes again.
    await bea.api.notes.share(two.noteId, { emails: [dex.email] });
    expect((await dex.api.series.get(seriesId)).decisions.find((d) => d.id === decision)?.replacedBy?.noteId).toBe(two.noteId);
    await dex.api.notes.delete(two.noteId);
    expect((await dex.api.series.get(seriesId)).decisions.find((d) => d.id === decision)?.replacedBy).toBeUndefined();

    // The later note deleted, the mark goes with it, for everyone, and the earlier items stand as they did.
    await org.api.notes.delete(two.noteId);
    const after = await bea.api.series.get(seriesId);
    expect(after.decisions.map((d) => [d.id, d.state, d.replacedBy])).toEqual([[decision, 'confirmed', undefined]]);
    expect(after.questions.map((q) => [q.id, q.answeredIn])).toEqual([[question, undefined]]);
  });

  it('settles as people say: it no longer holds, it was answered, or the notes got it wrong', async () => {
    const { org, bea, cal, one, two, next, decision, words, question, seriesId } = await twoCalls();
    const s = await org.api.series.get(seriesId);
    const replaced = s.decisions.find((d) => d.id === decision)?.replacedBy?.id ?? '';
    const answered = s.questions.find((q) => q.id === question)?.answeredIn?.id ?? '';

    // Someone says so: the decision no longer holds and says what replaced it, for anyone with both notes.
    await org.api.notes.updateDecision(one.noteId, decision, { state: 'superseded' });
    expect((await bea.api.series.get(seriesId)).decisions.find((d) => d.id === decision)).toMatchObject({ state: 'superseded', replacedBy: { noteId: two.noteId } });
    // A question said to be answered moves to what was answered since the last call, with where, once.
    await bea.api.notes.updateQuestion(one.noteId, question, { state: 'answered' });
    const settled = await org.api.series.get(seriesId);
    expect(settled.questions.map((q) => q.id)).not.toContain(question);
    expect(settled.answered.map((q) => [q.id, q.state, q.answeredIn?.noteId])).toEqual([[question, 'answered', two.noteId]]);

    // Only someone shown a revisit can say it's wrong: having the later note alone finds nothing, nor does a stranger.
    const dex = await account(at('dex'));
    const wrong = { dismissed: true };
    expect(code(await cal.api.notes.updateRevisit(two.noteId, replaced, wrong).catch((e: unknown) => e))).toBe('not-found');
    expect(code(await dex.api.notes.updateRevisit(two.noteId, replaced, wrong).catch((e: unknown) => e))).toBe('not-found');
    expect(code(await bea.api.notes.updateRevisit(two.noteId, 'AAAAAAAAAAAAAAAAAAAAAA', wrong).catch((e: unknown) => e))).toBe('not-found');
    expect(code(await bea.api.notes.updateRevisit(one.noteId, replaced, wrong).catch((e: unknown) => e))).toBe('not-found');
    // It settles the suggestion for everyone, so for a decision it goes by the grants on that decision. Someone given
    // both notes afterwards is shown it, and may say so about a question, but it isn't theirs to say about a decision.
    await org.api.notes.share(one.noteId, { emails: [dex.email] });
    await org.api.notes.share(two.noteId, { emails: [dex.email] });
    expect((await dex.api.series.get(seriesId)).decisions.find((d) => d.id === decision)?.replacedBy?.id).toBe(replaced);
    expect(refusal(await dex.api.notes.updateRevisit(two.noteId, replaced, wrong).catch((e: unknown) => e))).toEqual(['forbidden', 'Only the organizer, or whoever confirmed this decision, can say a later call didn’t replace it.']);
    expect((await dex.api.notes.updateRevisit(two.noteId, answered, wrong)).id).toBe(two.noteId);
    expect((await org.api.series.get(seriesId)).answered.map((q) => q.answeredIn?.dismissed?.by.email)).toEqual([dex.email]);
    await dex.api.notes.updateRevisit(two.noteId, answered, { dismissed: false });
    // The notes got it wrong: Bea confirmed it, so it's Bea's to say. Everyone with both notes sees who did, and saying it again changes nothing.
    const markOf = async () => (await org.api.series.get(seriesId)).decisions.find((d) => d.id === decision)?.replacedBy;
    await bea.api.notes.updateRevisit(two.noteId, replaced, wrong);
    const said = await markOf();
    expect(said?.dismissed).toMatchObject({ by: { email: bea.email }, at: expect.any(String) });
    await bea.api.notes.updateRevisit(two.noteId, replaced, wrong);
    expect(await markOf()).toEqual(said);
    expect((await dex.api.series.get(seriesId)).decisions.find((d) => d.id === decision)?.replacedBy?.dismissed?.by.email).toBe(bea.email);
    // The same goes for taking that back, and someone without both notes can't, whatever they know of it.
    expect(code(await cal.api.notes.updateRevisit(two.noteId, replaced, { dismissed: false }).catch((e: unknown) => e))).toBe('not-found');
    expect(code(await dex.api.notes.updateRevisit(two.noteId, replaced, { dismissed: false }).catch((e: unknown) => e))).toBe('forbidden');
    await org.api.notes.updateRevisit(two.noteId, replaced, { dismissed: false });
    expect((await markOf())?.dismissed).toBeUndefined();
    await bea.api.notes.updateRevisit(two.noteId, replaced, wrong);
    // Its answer is the whole note, so no receipt keeps a copy under someone it was given to.
    expect((await h.pool.query("SELECT count(*)::int AS n FROM operations WHERE method LIKE '%/revisits/%'")).rows[0]?.n).toBe(0);
    expect((await org.api.notes.updateRevisit(two.noteId, answered, wrong)).id).toBe(two.noteId);
    expect((await org.api.series.get(seriesId)).answered.map((q) => q.answeredIn?.dismissed?.by.email)).toEqual([org.email]);

    // Written again, the notes model finds the same again, and what was said to be wrong stays said, where it can still
    // be seen and undone, though the later decision is a new one now.
    await org.api.notes.updateDecision(one.noteId, decision, { state: 'confirmed', seen: { text: words } });
    await org.api.notes.updateQuestion(one.noteId, question, { state: 'open' });
    await rewritten(org.api, two.noteId);
    const again = await org.api.series.get(seriesId);
    expect(again.decisions.find((d) => d.id === decision)?.replacedBy).toMatchObject({ id: replaced, dismissed: { by: { email: bea.email } } });
    expect(again.questions.find((q) => q.id === question)?.answeredIn).toMatchObject({ id: answered, dismissed: { by: { email: org.email } } });
    await org.api.notes.updateRevisit(two.noteId, answered, { dismissed: false });
    expect((await org.api.series.get(seriesId)).questions.find((q) => q.id === question)?.answeredIn?.dismissed).toBeUndefined();

    // A later decision people said wasn't decided replaces nothing: its mark goes for everyone, and comes back with it.
    const later = (await org.api.notes.get(two.noteId)).decisions[0]?.id ?? '';
    await org.api.notes.updateRevisit(two.noteId, replaced, { dismissed: false });
    await org.api.notes.updateDecision(two.noteId, later, { state: 'rejected' });
    expect(await markOf()).toBeUndefined();
    await org.api.notes.updateDecision(two.noteId, later, { state: 'proposed' });
    expect((await markOf())?.noteId).toBe(two.noteId);

    // A later call holds it answered; once a further call is over, what was answered before it isn't said again.
    await bea.api.notes.updateQuestion(one.noteId, question, { state: 'answered' });
    expect((await org.api.series.get(seriesId)).answered.map((q) => q.id)).toEqual([question]);
    const third = await scheduleNext(org.api, next.id);
    await hold(org.api, third.code, 'Thanks everyone, that is all for today.');
    expect((await org.api.series.get(seriesId)).answered).toEqual([]);
  });

  it('keeps the marks through notes written again, and carries on without them when they can’t be worked out', async () => {
    const { org, one, two, next, decision, words, question, seriesId } = await twoCalls();
    const replaced = async () => (await org.api.series.get(seriesId)).decisions.find((d) => d.id === decision)?.replacedBy;
    const first = await replaced();
    expect(first?.noteId).toBe(two.noteId);
    // Nobody touched the later decision, so written again it's a new one; the mark follows it.
    await rewritten(org.api, two.noteId);
    const after = await replaced();
    expect(after?.noteId).toBe(two.noteId);
    expect(after?.text).toBe((await org.api.notes.get(two.noteId)).decisions[0]?.text);
    // Settled by a person, it isn't standing any more, and written again the later call still says what replaced it.
    await org.api.notes.updateDecision(one.noteId, decision, { state: 'superseded' });
    await rewritten(org.api, two.noteId);
    expect((await org.api.series.get(seriesId)).decisions.find((d) => d.id === decision)).toMatchObject({ state: 'superseded', replacedBy: { noteId: two.noteId } });
    await org.api.notes.updateDecision(one.noteId, decision, { state: 'confirmed', seen: { text: words } });

    // The comparison failing costs only itself: the notes are written, nothing is marked, and the job is done.
    h.near.failNext(5, 'prose', COMPARING);
    const third = await scheduleNext(org.api, next.id);
    const three = await hold(org.api, third.code, 'We decided to end annual pricing instead. // Answer: Priya owns the renewal emails.');
    h.near.failNext(0, 'prose');
    const note = await org.api.notes.get(three.noteId);
    expect(note.status).toBe('ready');
    expect(note.decisions.map((d) => d.text)).toEqual(['We decided to end annual pricing instead.']);
    expect((await replaced())?.noteId).toBe(two.noteId);
    expect(h.logs.some((l) => l.includes('call not compared with earlier ones') && l.includes(three.noteId))).toBe(true);
    // Writing them again tries again.
    await rewritten(org.api, three.noteId);
    expect((await replaced())?.noteId).toBe(three.noteId);
    expect((await org.api.series.get(seriesId)).questions.find((q) => q.id === question)?.answeredIn?.noteId).toBe(three.noteId);
  });

  /** Holds a call and ends it, and leaves its notes to be written: `hold`, without waiting for them. */
  async function ended(api: AlcoveApi, callCode: string, words: string): Promise<string> {
    const host = await api.calls.join(callCode, { mic: true, cam: false });
    await inGroup(host);
    await host.transcribe(speech(words), host.ticket.identity);
    await settle(host, (s) => s.transcript.length >= words.split(' // ').length);
    return (await host.leave())?.pendingNoteId ?? '';
  }

  it('never holds the notes back for the comparison: a slow one comes after them, and one that can’t get through costs only itself', async () => {
    const { org, bea, next, decision, seriesId } = await twoCalls();
    const replaced = async () => (await bea.api.series.get(seriesId)).decisions.find((d) => d.id === decision)?.replacedBy;

    // The notes model takes its time over the comparison: everyone has the notes by the time it's even asked.
    const third = await scheduleNext(org.api, next.id);
    const sent = h.near.prompts.length;
    h.near.slowNext(3000, COMPARING);
    const three = await ended(org.api, third.code, 'We decided to end annual pricing instead.');
    await waitFor(() => h.near.prompts.slice(sent).some((p) => p.includes(COMPARING)), 'the comparison to reach the notes model');
    expect(await org.api.notes.get(three)).toMatchObject({ status: 'ready', summary: expect.stringMatching(/\S/), decisions: [{ text: 'We decided to end annual pricing instead.' }] });
    expect(await bea.api.notes.get(three)).toMatchObject({ status: 'ready', summary: expect.stringMatching(/\S/) });
    expect((await replaced())?.noteId).not.toBe(three);
    await written(org.api, three);
    expect((await replaced())?.noteId).toBe(three);

    // It's down: the notes are as they'd be, and what the calls before it found stands.
    const fourth = await scheduleNext(org.api, third.id);
    h.near.failNext(9, 'down', COMPARING);
    const four = await ended(org.api, fourth.code, 'We decided to bring annual pricing back instead.');
    await written(org.api, four);
    h.near.failNext(0, 'down');
    expect(await org.api.notes.get(four)).toMatchObject({ status: 'ready', summary: expect.stringMatching(/\S/), decisions: [{ text: 'We decided to bring annual pricing back instead.' }] });
    expect(h.logs.some((l) => l.includes('call not compared with earlier ones') && l.includes(four))).toBe(true);
    expect((await replaced())?.noteId).toBe(three);
  });

  it('keeps the verification of the comparison in the note it marks, when the notes model moved on after writing the notes', async () => {
    const { org, next, decision, seriesId } = await twoCalls();
    const third = await scheduleNext(org.api, next.id);
    const sent = h.near.prompts.length;
    const was = h.near.keys().notes;
    h.near.slowNext(1500);
    const three = await ended(org.api, third.code, 'We decided to end annual pricing instead.');
    // The notes model has the notes in hand when its key changes, so the comparison goes to another verification.
    await waitFor(() => h.near.prompts.length > sent, 'the notes to reach the notes model');
    h.near.rotate('notes');
    await written(org.api, three);
    expect((await org.api.series.get(seriesId)).decisions.find((d) => d.id === decision)?.replacedBy?.noteId).toBe(three);
    expect((await org.api.notes.get(three)).inference.filter((x) => x.task === 'notes').map((x) => x.key)).toEqual([was, h.near.keys().notes]);
  });
});

describe('breakout rooms in what carries over', () => {
  /** A call whose Design room decided, asked and handed something out, and the next call in its series. */
  async function roomCall() {
    const org = await account(at('olu'));
    const kofi = await account(at('kofi'));
    const lena = await account(at('lena'));
    const { code: c } = await org.api.calls.startNow({ title: 'Design review', notes: 'on', guests: [kofi.email] });
    const host = await org.api.calls.join(c, { mic: true, cam: false });
    await inGroup(host);
    const inKofi = await kofi.api.calls.join(c, { mic: true, cam: false });
    await inGroup(inKofi);
    await host.transcribe(speech('We agreed to meet again next week.'), host.ticket.identity);
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email] }, { name: 'Support', emails: [] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
    const [room = ''] = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms.map((r) => r.id) ?? [];
    await waitFor(() => inKofi.crypto.getSnapshot().place === room && Boolean(inKofi.crypto.getSnapshot().media?.send), 'Kofi in the room');
    await settle(inKofi, (s) => s.capture.room?.scribe === inKofi.ticket.identity);
    await inKofi.transcribe(speech('We agreed on blue buttons. // Should links be underlined? // Kofi will draw the icons by Friday.', 2000), inKofi.ticket.identity);
    await settle(inKofi, (s) => s.transcript.length >= 3);
    host.closeRooms();
    await settle(host, (s) => s.breakouts.open === null);
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    await acceptNoteSuggestions(org.api, noteId);
    const meetingId = (await org.api.notes.get(noteId)).meetingId ?? '';
    const next = await scheduleNext(org.api, meetingId);
    await org.api.meetings.update(next.id, { guests: [kofi.email, lena.email] });
    return { org, kofi, lena, room, noteId, next, seriesId: next.seriesId ?? '' };
  }

  it('carries each room’s decisions, questions and follow-ups with a way to its section, and asks across them, under the same checks', async () => {
    const { org, kofi, lena, room, noteId, next, seriesId } = await roomCall();
    const from = { id: room, name: 'Design' };
    for (const who of [org, kofi]) {
      const s = await who.api.calls.series(next.code);
      expect(s?.decisions.map((d) => [d.text, d.room])).toEqual([['We agreed to meet again next week.', undefined], ['We agreed on blue buttons.', from]]);
      expect(s?.questions.map((q) => [q.text, q.room, q.noteId])).toEqual([['Should links be underlined?', from, noteId]]);
      expect(s?.actions.map((a) => [a.text, a.room, a.noteId])).toEqual([['Draw the icons by Friday', from, noteId]]);
    }
    // The room's section opens for whoever has the notes, and for nobody else, as the call's do.
    expect((await kofi.api.notes.get(noteId)).rooms.find((r) => r.id === room)?.name).toBe('Design');
    expect(code(await lena.api.notes.get(noteId).catch((e: unknown) => e))).toBe('not-found');
    expect(await lena.api.calls.series(next.code)).toBeNull();

    // Asking reads the rooms' sections and transcripts, and says which room an answer comes from.
    const parts: unknown[] = [];
    for await (const p of kofi.api.series.ask(seriesId, 'Who draws the icons?', ZONE)) parts.push(p);
    expect(parts).toEqual([
      { type: 'text', text: 'From meeting 1: Kofi will draw the icons by Friday.' },
      { type: 'source', noteId, title: 'Design review', startedAt: expect.any(String), room: from, at: expect.any(Number) }
    ]);
    const prompt = h.near.prompts.at(-1) ?? '';
    expect(prompt).toContain('Breakout room 1, Design');
    expect(prompt).toContain('We agreed on blue buttons. (not confirmed yet)');

    // Settling a room's item is settling it where it was said: the series sees it, and the room's section does.
    const d = (await org.api.series.get(seriesId)).decisions.find((x) => x.room);
    await kofi.api.notes.updateDecision(noteId, d?.id ?? '', { state: 'confirmed', seen: { text: d?.text ?? '' } });
    expect((await org.api.series.get(seriesId)).decisions.find((x) => x.id === d?.id)?.state).toBe('confirmed');
  });

  it('waits while the asker’s own room is paused, and not for anyone else’s', async () => {
    const { org, kofi, lena, next } = await roomCall();
    const host = await org.api.calls.join(next.code, { mic: true, cam: false });
    await inGroup(host);
    const inKofi = await kofi.api.calls.join(next.code, { mic: true, cam: false });
    await inGroup(inKofi);
    const inLena = await lena.api.calls.join(next.code, { mic: true, cam: false });
    await inGroup(inLena);
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email] }, { name: 'Support', emails: [lena.email] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
    const [design = '', support = ''] = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms.map((r) => r.id) ?? [];
    await waitFor(() => inKofi.crypto.getSnapshot().place === design && Boolean(inKofi.crypto.getSnapshot().media?.send), 'Kofi in Design');
    await waitFor(() => inLena.crypto.getSnapshot().place === support && Boolean(inLena.crypto.getSnapshot().media?.send), 'Lena in Support');
    await host.pauseRoom(design, true);
    await settle(inKofi, (s) => s.capture.room?.mode === 'paused');

    const sent = h.near.prompts.length;
    expect(refusal(await inKofi.askEarlier('What colour are the buttons?', ZONE).catch((e: unknown) => e))).toEqual(['conflict', 'Notes are paused in this room. Nothing said here is transcribed or sent to the AI until the organizer resumes.']);
    expect(h.near.prompts.length).toBe(sent);
    // The host is in the main room and Support is on: a pause in Design holds neither, and each asks from their own notes.
    expect((await host.askEarlier('What colour are the buttons?', ZONE))[0]).toMatchObject({ type: 'text' });
    expect(h.near.prompts.length).toBe(sent + 1);
    // Lena has no notes from the series, so there's nothing to read, which a pause next door doesn't change.
    expect(code(await inLena.askEarlier('What colour are the buttons?', ZONE).catch((e: unknown) => e))).toBe('not-found');

    await host.pauseRoom(design, false);
    await settle(inKofi, (s) => s.capture.room?.mode === 'on');
    expect((await inKofi.askEarlier('What colour are the buttons?', ZONE))[0]).toMatchObject({ type: 'text' });
    host.closeRooms();
    await settle(host, (s) => s.breakouts.open === null);
    await host.leave();
  });

  it('marks what a later call’s room replaced or answered, with its room', async () => {
    const { org, kofi, room, noteId, next, seriesId } = await roomCall();
    const host = await org.api.calls.join(next.code, { mic: true, cam: false });
    await inGroup(host);
    const inKofi = await kofi.api.calls.join(next.code, { mic: true, cam: false });
    await inGroup(inKofi);
    await host.transcribe(speech('Hello again.'), host.ticket.identity);
    host.openRooms({ rooms: [{ name: 'Follow-up', emails: [kofi.email] }, { name: 'Support', emails: [] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
    const [later = ''] = (await settle(host, (s) => s.breakouts.open !== null)).breakouts.open?.rooms.map((r) => r.id) ?? [];
    await waitFor(() => inKofi.crypto.getSnapshot().place === later && Boolean(inKofi.crypto.getSnapshot().media?.send), 'Kofi in the room');
    await settle(inKofi, (s) => s.capture.room?.scribe === inKofi.ticket.identity);
    await inKofi.transcribe(speech('We decided on green buttons instead. // Answer: links should be underlined.', 2000), inKofi.ticket.identity);
    await settle(inKofi, (s) => s.transcript.length >= 2);
    host.closeRooms();
    await settle(host, (s) => s.breakouts.open === null);
    const two = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, two);

    const s = await kofi.api.series.get(seriesId);
    const inRoom = { id: later, name: 'Follow-up' };
    expect(s.decisions.find((d) => d.noteId === noteId && d.room?.id === room)?.replacedBy).toMatchObject({ noteId: two, room: inRoom, text: 'We decided on green buttons instead.' });
    expect(s.questions.find((q) => q.noteId === noteId)?.answeredIn).toMatchObject({ noteId: two, room: inRoom, at: expect.any(Number) });
  });
});

describe('a call that keeps no transcript', () => {
  const keepsNone = async (org: AlcoveApi, guests: string[]) => org.meetings.create({
    title: 'Supplier review', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests, notes: 'on', choices: { ...DEFAULT_NOTES_CHOICES, keepTranscript: false }
  });
  const answer = async (api: AlcoveApi, seriesId: string, question: string) => { const parts: SeriesAnswerPart[] = []; for await (const p of api.series.ask(seriesId, question, ZONE)) parts.push(p); return parts; };

  it('is compared from what the notes read, before it went', async () => {
    const org = await account(at('olu'));
    const { code: first } = await org.api.calls.startNow({ title: 'Pricing', notes: 'on' });
    const one = await hold(org.api, first, 'We agreed to keep annual pricing. // Who owns the renewal emails?');
    const decision = (await org.api.notes.get(one.noteId)).decisions[0];
    await org.api.notes.updateDecision(one.noteId, decision?.id ?? '', { state: 'confirmed', seen: { text: decision?.text ?? '' } });
    const next = await scheduleNext(org.api, one.meetingId);
    await org.api.meetings.update(next.id, { choices: { ...DEFAULT_NOTES_CHOICES, keepTranscript: false } });
    const two = await hold(org.api, next.code, 'We decided to drop annual pricing instead. // Answer: CANARY-GONE Priya owns the renewal emails.');
    expect(await org.api.notes.get(two.noteId)).toMatchObject({ transcript: [], kept: { transcript: false } });
    const s = await org.api.series.get(next.seriesId ?? '');
    expect(s.decisions.find((d) => d.id === decision?.id)?.replacedBy?.noteId).toBe(two.noteId);
    expect(s.questions[0]?.answeredIn).toMatchObject({ noteId: two.noteId, at: expect.any(Number) });
    // It went to the notes model and no further: it's gone from every revision, the comparison's own included.
    const { rows } = await h.pool.query('SELECT count(*)::int AS n FROM revisions WHERE item_id = $1', [two.noteId]);
    expect(rows[0]?.n).toBe(2);
    expect(JSON.stringify(s)).not.toContain('CANARY-GONE');
  });

  it('keeps its lines from everyone but its organizer, in what carries over and in answers, whatever points at them', async () => {
    const org = await account(at('olu'));
    const kofi = await account(at('kofi'));
    const meeting = await keepsNone(org.api, [kofi.email]);
    const host = await org.api.calls.join(meeting.code, { mic: true, cam: false });
    await inGroup(host);
    const inKofi = await kofi.api.calls.join(meeting.code, { mic: true, cam: false });
    await inGroup(inKofi);
    await host.transcribe(speech('We agreed to meet again next week.'), host.ticket.identity);
    host.openRooms({ rooms: [{ name: 'Design', emails: [kofi.email] }, { name: 'Support', emails: [] }], minutes: 10, board: { mode: 'none', template: 'blank' } });
    await settle(host, (s) => s.breakouts.open !== null);
    await settle(inKofi, (s) => s.capture.room?.scribe === inKofi.ticket.identity);
    await inKofi.transcribe(speech('The printer is CANARY-HIDDEN-LINE for now.', 2000), inKofi.ticket.identity);
    await settle(inKofi, (s) => s.transcript.length >= 1);
    host.closeRooms();
    await settle(host, (s) => s.breakouts.open === null);
    // The room's notes can't be written, so its lines wait in the note, for the organizer alone, to write them from.
    h.near.failNext(3, 'prose', 'the breakout room “Design”');
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    h.near.failNext(0, 'prose');
    const note = await org.api.notes.get(noteId);
    const room = note.rooms[0];
    const line = room?.transcript[0];
    expect(line?.text).toContain('CANARY-HIDDEN-LINE');
    await org.api.notes.proposeDecision(noteId, { text: 'We chose a printer.', lines: [line?.id ?? ''], room: room?.id ?? '' });

    const next = await scheduleNext(org.api, note.meetingId ?? '');
    await org.api.meetings.update(next.id, { guests: [kofi.email] });
    const seriesId = next.seriesId ?? '';
    // The organizer reads what the decision rests on. Kofi has the note and the decision, and not the lines behind it.
    const backed = (s: Series | null) => s?.decisions.find((d) => d.text === 'We chose a printer.')?.evidence.moments;
    expect(backed(await org.api.series.get(seriesId))).toMatchObject([{ kind: 'line', text: line?.text }]);
    for (const s of [await kofi.api.series.get(seriesId), await kofi.api.calls.series(next.code)]) {
      expect(backed(s)).toEqual([]);
      expect(JSON.stringify(s)).not.toContain('CANARY-HIDDEN-LINE');
    }
    // Asking across the series reads each call as whoever's asking may, in the call too.
    await answer(kofi.api, seriesId, 'Who is the printer?');
    expect(h.near.prompts.at(-1)).not.toContain('CANARY-HIDDEN-LINE');
    expect(h.near.prompts.at(-1)).toContain('(deleted once the notes were written)');
    const again = await org.api.calls.join(next.code, { mic: true, cam: false });
    await inGroup(again);
    const nextKofi = await kofi.api.calls.join(next.code, { mic: true, cam: false });
    await inGroup(nextKofi);
    await nextKofi.askEarlier('Who is the printer?', ZONE);
    expect(h.near.prompts.at(-1)).not.toContain('CANARY-HIDDEN-LINE');
    await again.askEarlier('Who is the printer?', ZONE);
    expect(h.near.prompts.at(-1)).toContain('CANARY-HIDDEN-LINE');
    await again.leave();
  });
});

describe('what stays out of what’s stored', () => {
  it('keeps what carries over, and what’s asked during a call, out of every row, object and log', async () => {
    const org = await account(at('canary-org'));
    const bea = await account(at('canary-bea'));
    const { code: c } = await org.api.calls.startNow({ title: 'CANARY-SERIES-TITLE plans', notes: 'on', guests: [bea.email] });
    const one = await hold(org.api, c, 'We agreed to CANARY-CARRIED sell the lighthouse. // Who buys CANARY-OPEN the lighthouse? // Bea will CANARY-TODO paint the lighthouse.');
    // What each of them keeps for themselves stays theirs, whatever else reads these notes.
    await org.api.notes.personal(one.noteId).add({ kind: 'note', text: 'CANARY-OWN-ORGANIZER my own view of the lighthouse' });
    await bea.api.notes.personal(one.noteId).add({ kind: 'note', text: 'CANARY-OWN-INVITED my own view of the lighthouse' });
    await bea.api.notes.personal(one.noteId).add({ kind: 'answer', question: 'CANARY-OWN-QUESTION who?', answer: 'CANARY-OWN-ANSWER them.', points: [] });
    const next = await scheduleNext(org.api, one.meetingId);
    const host = await org.api.calls.join(next.code, { mic: true, cam: false });
    await inGroup(host);
    const inBea = await bea.api.calls.join(next.code, { mic: true, cam: false });
    await inGroup(inBea);
    const carried = await bea.api.calls.series(next.code);
    expect(carried?.decisions.length).toBe(1);
    expect(JSON.stringify([carried, await org.api.calls.series(next.code)])).not.toContain('CANARY-OWN');
    await inBea.askEarlier('CANARY-EARLIER-ASK who buys the lighthouse?', 'Asia/Tokyo');
    await host.transcribe(speech('We decided to keep the lighthouse instead. // Answer: CANARY-LATER nobody buys the lighthouse.'), host.ticket.identity);
    const two = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, two);
    const s = await org.api.series.get(next.seriesId ?? '');
    const mark = s.decisions.find((d) => d.replacedBy)?.replacedBy;
    expect(mark?.noteId).toBe(two);
    await bea.api.notes.updateRevisit(two, mark?.id ?? '', { dismissed: true });

    // They reached no question, no answer and no comparison: nothing about the earlier call but the shared notes went to the model.
    expect(h.near.prompts.some((p) => p.includes(COMPARING))).toBe(true);
    expect(h.near.prompts.some((p) => p.includes('CANARY-OWN'))).toBe(false);
    const canaries = ['CANARY-SERIES-TITLE', 'CANARY-CARRIED', 'CANARY-OPEN', 'CANARY-TODO', 'CANARY-EARLIER-ASK', 'CANARY-LATER', 'CANARY-OWN', 'lighthouse', 'Asia/Tokyo'];
    const dump = String((await h.pool.query(`SELECT string_agg(t, ' ') AS all FROM (
      SELECT row_to_json(x)::text AS t FROM operations x UNION ALL SELECT row_to_json(x)::text FROM calls x UNION ALL
      SELECT row_to_json(x)::text FROM transcript_clips x UNION ALL SELECT row_to_json(x)::text FROM items x UNION ALL
      SELECT row_to_json(x)::text FROM revisions x UNION ALL SELECT row_to_json(x)::text FROM content_jobs x UNION ALL
      SELECT row_to_json(x)::text FROM note_access x) q`)).rows[0]?.all ?? '');
    const logs = h.logs.join('');
    for (const canary of canaries) {
      for (const enc of encodings(canary)) {
        expect(dump.includes(enc), `${canary} as ${enc} in rows`).toBe(false);
        expect(logs.includes(enc), `${canary} as ${enc} in logs`).toBe(false);
      }
    }
    // A call's link is a join token: finding what carries over by it logs the path with the code masked.
    expect(logs).toContain('/v1/calls/:code/series');
    expect(logs).not.toContain(next.code);
    // What a later call came back to is sealed in its note like the rest: no row names it, or says which earlier item it means.
    for (const word of ['revisits', 'replaced', 'answered', 'dismissed', mark?.id ?? 'no mark']) expect(dump.includes(word), `${word} in rows`).toBe(false);
    for await (const obj of h.objects.list()) {
      const bytes = Buffer.from(await h.objects.get(obj.id));
      for (const canary of canaries) for (const enc of encodings(canary)) expect(bytes.includes(Buffer.from(enc)), `${canary} in ${obj.id}`).toBe(false);
    }
    const wire = Buffer.concat(h.near.received.map((r) => r.body));
    for (const canary of canaries) for (const enc of encodings(canary)) expect(wire.includes(Buffer.from(enc)), `${canary} as ${enc} on the wire to NEAR AI`).toBe(false);
    expect(h.near.prompts.some((p) => p.includes('CANARY-EARLIER-ASK'))).toBe(true);
  });
});
