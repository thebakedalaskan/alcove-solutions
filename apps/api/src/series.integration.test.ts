/**
 * Memory across a series, end to end against the real API, Postgres and object store (AGENTS.md:
 * integration tests only): calls that follow on from each other, what carries over between them,
 * and who sees what. Everyone signs in through the API; calls are held, transcribed and written up
 * through the stand-in NEAR AI, and recurring events come from the stand-in Google.
 */
import { AlcoveApiError, type AlcoveApi, type SeriesAnswerPart, type TranscriptClip } from '@alcove/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GoogleUser } from './testing/fake-google';
import { speechWav } from './testing/fake-near';
import { ORIGIN, startHarness, type Browser, type Harness } from './testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });

let seq = 0;
const tag = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
/** An address at a domain of its own, so the notes model knows its owner by the name before the @. */
const at = (name: string) => `${name}@s${tag()}.example`;
async function account(email: string) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email };
}
const code = (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error');
/** A clip of speech saying `words`; sentences split by " // " come back as lines two seconds apart. */
const speech = (words: string): TranscriptClip => ({ data: new Blob([speechWav(words)], { type: 'audio/wav' }), segment: 0, startMs: 0, durationMs: 4000 });

/** Holds a call with notes on: joins it by its code, says `words`, ends it and waits for its notes to be written. */
async function hold(api: AlcoveApi, callCode: string, words: string, during?: () => Promise<void>): Promise<{ noteId: string; meetingId: string }> {
  const call = await api.calls.join(callCode, { mic: true, cam: false });
  await call.transcribe(speech(words));
  await during?.();
  const end = await call.leave();
  if (!end) throw new Error('the organizer’s leave ended nothing');
  const noteId = end.pendingNoteId ?? '';
  for await (const p of api.notes.progress(noteId)) if (p.ready) break;
  return { noteId, meetingId: end.meetingId };
}
async function asked(api: AlcoveApi, seriesId: string, question: string): Promise<SeriesAnswerPart[]> {
  const parts: SeriesAnswerPart[] = [];
  for await (const p of api.series.ask(seriesId, question)) parts.push(p);
  return parts;
}
/** Which notes everything carried over comes from. */
const sourcesOf = (s: Awaited<ReturnType<AlcoveApi['series']['get']>>) => [...new Set([...s.decisions, ...s.questions, ...s.actions].map((x) => x.noteId))];

/** Signs in with Google the way a browser does, following each redirect by hand. */
async function viaGoogle(b: Browser, user: GoogleUser): Promise<void> {
  h.google.next(user);
  let url = new URL(`${h.baseUrl}/v1/auth/google`);
  for (let hop = 0; hop < 10; hop++) {
    if (url.origin === new URL(ORIGIN).origin) return;
    const res = url.origin === h.google.issuer ? await fetch(url, { redirect: 'manual' }) : await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  throw new Error('Too many redirects while signing in with Google.');
}

describe('memory across a series', () => {
  it('carries confirmed decisions, open questions and follow-ups into the next call, for the organizer and everyone invited', async () => {
    const org = await account(at('olu'));
    const bea = await account(at('bea'));
    const { code: firstCode } = await org.api.calls.startNow({ title: 'Launch sync', notes: 'on', guests: [bea.email] });
    const one = await hold(org.api, firstCode, 'We agreed to ship the beta on Monday. // Can we afford a second designer? // Bea will draft the launch email by Friday.');
    expect((await org.api.notes.get(one.noteId)).seriesId).toBeUndefined();

    // The open question is in the note, open until someone says it was answered.
    const note = await org.api.notes.get(one.noteId);
    expect(note.questions).toEqual([{ id: expect.any(String), text: 'Can we afford a second designer?', at: 2, state: 'open', changes: [] }]);

    // Scheduling the next one starts the series: the same title, people and notes, a week on.
    const first = await org.api.meetings.get(one.meetingId);
    const next = await org.api.meetings.scheduleNext(one.meetingId);
    expect(next).toMatchObject({ title: 'Launch sync', notes: 'on', status: 'scheduled', guests: [{ email: bea.email }] });
    expect(new Date(next.startsAt).getTime() - new Date(first.startsAt).getTime()).toBe(7 * 86_400_000);
    const seriesId = next.seriesId ?? '';
    expect(seriesId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect((await org.api.meetings.get(one.meetingId)).seriesId).toBe(seriesId);
    expect((await org.api.notes.get(one.noteId)).seriesId).toBe(seriesId);
    expect((await org.api.meetings.upcoming()).find((m) => m.id === next.id)?.seriesId).toBe(seriesId);

    // What the notes heard carries over as they heard it: proposed, open, suggested.
    let s = await org.api.series.get(seriesId);
    expect(s).toMatchObject({ id: seriesId, title: 'Launch sync', isOrganizer: true, recurring: false, next: { id: next.id }, organizer: { id: org.session.ownerId } });
    expect(s.notes.map((n) => [n.id, n.status, n.meetingId, n.from])).toEqual([[one.noteId, 'ready', one.meetingId, undefined]]);
    expect(s.decisions.map((d) => [d.text, d.state, d.noteId])).toEqual([['We agreed to ship the beta on Monday.', 'proposed', one.noteId]]);
    expect(s.questions.map((q) => [q.text, q.later, q.stale])).toEqual([['Can we afford a second designer?', 0, false]]);
    expect(s.actions.map((a) => [a.text, a.owner?.person?.email, a.takenOn, a.done])).toEqual([['Draft the launch email by Friday', bea.email, false, false]]);

    // People settle things on the note, and the series shows it straight away.
    const decision = note.decisions[0]?.id ?? '';
    const action = note.actions[0]?.id ?? '';
    await bea.api.notes.updateDecision(one.noteId, decision, { state: 'confirmed' });
    await bea.api.notes.updateAction(one.noteId, action, { takeOn: true });
    s = await org.api.series.get(seriesId);
    expect(s.decisions.map((d) => d.state)).toEqual(['confirmed']);
    expect(s.actions.map((a) => a.takenOn)).toEqual([true]);

    // Everyone invited sees the same, as someone else's series, and without the organizer's plans.
    const theirs = await bea.api.series.get(seriesId);
    expect(theirs).toMatchObject({ isOrganizer: false, recurring: false, organizer: { id: org.session.ownerId }, title: 'Launch sync' });
    expect(theirs.next).toBeUndefined();
    expect(theirs.notes.map((n) => [n.id, n.meetingId, n.from?.id])).toEqual([[one.noteId, undefined, org.session.ownerId]]);
    expect([theirs.decisions, theirs.questions, theirs.actions].map((xs) => xs.length)).toEqual([1, 1, 1]);

    // A second and a third call. A call's notes join the series when it ends: while the second is going, nothing has stayed open through it yet.
    const two = await hold(org.api, next.code, 'We decided to hire a contractor instead. // How much does the contractor cost?', async () => {
      const live = await org.api.series.get(seriesId);
      expect(live.notes.map((n) => n.id)).toEqual([one.noteId]);
      expect(live.questions.map((q) => [q.text, q.later])).toEqual([['Can we afford a second designer?', 0]]);
    });
    // What stays open through two later calls is stale.
    const third = await org.api.meetings.scheduleNext(two.meetingId);
    expect(third.seriesId).toBe(seriesId);
    expect(new Date(third.startsAt).getTime() - new Date(next.startsAt).getTime()).toBe(7 * 86_400_000);
    const three = await hold(org.api, third.code, 'Thanks everyone, that is all for today.');
    s = await org.api.series.get(seriesId);
    expect(s.notes.map((n) => n.id)).toEqual([three.noteId, two.noteId, one.noteId]);
    expect(s.questions.map((q) => [q.text, q.later, q.stale])).toEqual([['How much does the contractor cost?', 1, false], ['Can we afford a second designer?', 2, true]]);
    expect(s.actions.map((a) => [a.text, a.later, a.stale])).toEqual([['Draft the launch email by Friday', 2, true]]);
    expect(s.next).toBeUndefined();

    // A later decision replaces the first: it no longer holds, and says who said so. Only something confirmed can stop holding.
    const contractor = (await org.api.notes.get(two.noteId)).decisions[0]?.id ?? '';
    expect(code(await org.api.notes.updateDecision(two.noteId, contractor, { state: 'superseded' }).catch((e: unknown) => e))).toBe('conflict');
    const replaced = await org.api.notes.updateDecision(one.noteId, decision, { state: 'superseded' });
    expect(replaced.decisions[0]).toMatchObject({ state: 'superseded', changes: [{ what: 'confirmed', by: { email: bea.email } }, { what: 'superseded', by: { email: org.email } }] });
    s = await org.api.series.get(seriesId);
    expect(s.decisions.map((d) => [d.text, d.state])).toEqual([['We decided to hire a contractor instead.', 'proposed'], ['We agreed to ship the beta on Monday.', 'superseded']]);

    // Answering a question or finishing a follow-up settles it; ticked since the latest call, it says so once.
    const question = note.questions[0]?.id ?? '';
    const answered = await bea.api.notes.updateQuestion(one.noteId, question, { state: 'answered' });
    expect(answered.questions[0]).toMatchObject({ state: 'answered', changes: [{ what: 'answered', by: { email: bea.email } }] });
    await bea.api.notes.updateAction(one.noteId, action, { done: true });
    s = await org.api.series.get(seriesId);
    expect(s.questions.map((q) => q.text)).toEqual(['How much does the contractor cost?']);
    expect(s.actions.map((a) => [a.text, a.done, a.stale])).toEqual([['Draft the launch email by Friday', true, false]]);
    // Reworded, reopened: the history keeps who did each.
    const reopened = await org.api.notes.updateQuestion(one.noteId, question, { state: 'open', text: 'Can we afford a second designer this year?' });
    expect(reopened.questions[0]?.changes.map((c) => [c.what, c.by.email])).toEqual([['answered', bea.email], ['reworded', org.email], ['reopened', org.email]]);
    expect(code(await org.api.notes.updateQuestion(one.noteId, 'AAAAAAAAAAAAAAAAAAAAAA', { state: 'answered' }).catch((e: unknown) => e))).toBe('not-found');

    // The next call can't come before the one it follows.
    expect(code(await org.api.meetings.scheduleNext(three.meetingId, new Date(Date.now() - 86_400_000).toISOString()).catch((e: unknown) => e))).toBe('invalid');
  });

  it('shows each person only the calls whose notes they have, and asks across those alone', async () => {
    const org = await account(at('ora'));
    const bea = await account(at('bea'));
    const cal = await account(at('cal'));
    const stranger = await account(at('dex'));
    const { code: firstCode } = await org.api.calls.startNow({ title: 'Budget review', notes: 'on', guests: [bea.email] });
    const one = await hold(org.api, firstCode, 'We agreed to cut the travel budget. // Can we afford a second designer? // Bea will draft the launch email by Friday.');
    const next = await org.api.meetings.scheduleNext(one.meetingId);
    const seriesId = next.seriesId ?? '';
    // Cal joins the series from its second call on.
    await org.api.meetings.update(next.id, { guests: [bea.email, cal.email] });
    const two = await hold(org.api, next.code, 'We decided to hire a contractor instead. // How much does the contractor cost?');

    // Bea was in both calls; Cal only in the second. Being in the series opens nothing from the first.
    expect((await bea.api.series.get(seriesId)).notes.map((n) => n.id)).toEqual([two.noteId, one.noteId]);
    const cals = await cal.api.series.get(seriesId);
    expect(cals.notes.map((n) => n.id)).toEqual([two.noteId]);
    expect(sourcesOf(cals)).toEqual([two.noteId]);
    expect(JSON.stringify(cals)).not.toMatch(/travel budget|second designer|launch email/);
    // Following a source checks again: the first call's notes don't open for Cal, and can't be changed.
    expect(code(await cal.api.notes.get(one.noteId).catch((e: unknown) => e))).toBe('not-found');
    const q1 = (await org.api.notes.get(one.noteId)).questions[0]?.id ?? '';
    expect(code(await cal.api.notes.updateQuestion(one.noteId, q1, { state: 'answered' }).catch((e: unknown) => e))).toBe('not-found');

    // Asking across the series reads only the calls the asker has, and says where the answer comes from.
    expect(await asked(bea.api, seriesId, 'Who drafts the launch email?')).toEqual([
      { type: 'text', text: 'From meeting 2: Bea will draft the launch email by Friday.' },
      { type: 'source', noteId: one.noteId, title: 'Budget review', startedAt: expect.any(String), at: 4 }
    ]);
    expect(await asked(cal.api, seriesId, 'Who drafts the launch email?')).toEqual([{ type: 'text', text: 'That wasn’t covered in these meetings.' }]);
    const prompt = h.near.prompts.at(-1) ?? '';
    expect(prompt).toContain('We decided to hire a contractor instead.');
    for (const away of ['travel budget', 'second designer', 'launch email by Friday']) expect(prompt).not.toContain(away);
    // Names, never addresses, and nothing is kept: no receipt holds a question or an answer.
    for (const p of [bea, cal, org]) expect(prompt).not.toContain(p.email);
    expect((await h.pool.query("SELECT count(*)::int AS n FROM operations WHERE method LIKE '%/series/%'")).rows[0]?.n).toBe(0);

    // Sharing the first call's notes with Cal, deliberately, brings them into Cal's series...
    await bea.api.notes.share(one.noteId, [cal.email]);
    expect(sourcesOf(await cal.api.series.get(seriesId)).sort()).toEqual([one.noteId, two.noteId].sort());
    expect((await asked(cal.api, seriesId, 'Who drafts the launch email?'))[1]).toMatchObject({ type: 'source', noteId: one.noteId });
    // ...and removing them from Cal's notes takes them out again, with nothing left behind.
    await cal.api.notes.delete(one.noteId);
    expect(sourcesOf(await cal.api.series.get(seriesId))).toEqual([two.noteId]);
    expect(await asked(cal.api, seriesId, 'Who drafts the launch email?')).toEqual([{ type: 'text', text: 'That wasn’t covered in these meetings.' }]);

    // Someone with no notes from the series can't find it, ask about it or plan it; nor can anyone but the organizer schedule its calls.
    const refused = [() => stranger.api.series.get(seriesId), () => asked(stranger.api, seriesId, 'Anything?'), () => stranger.api.meetings.scheduleNext(one.meetingId), () => bea.api.meetings.scheduleNext(one.meetingId)];
    for (const attempt of refused) expect(code(await attempt().catch((e: unknown) => e))).toBe('not-found');
    expect(code(await org.api.series.get('AAAAAAAAAAAAAAAAAAAAAA').catch((e: unknown) => e))).toBe('not-found');

    // The organizer deleting a call's notes takes them out of everyone's series at once.
    await org.api.notes.delete(two.noteId);
    expect(code(await cal.api.series.get(seriesId).catch((e: unknown) => e))).toBe('not-found');
    expect((await bea.api.series.get(seriesId)).notes.map((n) => n.id)).toEqual([one.noteId]);
    expect((await org.api.series.get(seriesId)).notes.map((n) => n.id)).toEqual([one.noteId]);
  });

  it('keeps room recordings out of every series, and answers only once there are written notes', async () => {
    const org = await account(at('rhea'));
    // A recording in the room has no call, so it's in no series, even shared.
    const rec = await org.api.recordings.start('Corridor chat');
    await rec.transcribe(speech('We agreed to repaint the office.'));
    const { pendingNoteId: room } = await rec.stop();
    for await (const p of org.api.notes.progress(room)) if (p.ready) break;
    expect((await org.api.notes.get(room)).seriesId).toBeUndefined();

    // A series whose only call hasn't happened yet: nothing carries over, and there's nothing to ask.
    const m = await org.api.meetings.create({ title: 'Kickoff', startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, guests: [], notes: 'on' });
    const when = new Date(new Date(m.startsAt).getTime() + 3 * 86_400_000).toISOString();
    const next = await org.api.meetings.scheduleNext(m.id, when);
    expect([next.startsAt, (new Date(next.endsAt).getTime() - new Date(next.startsAt).getTime()) / 60_000]).toEqual([when, 30]);
    const s = await org.api.series.get(next.seriesId ?? '');
    expect(s).toMatchObject({ title: 'Kickoff', notes: [], decisions: [], questions: [], actions: [], next: { id: m.id } });
    expect(code(await asked(org.api, next.seriesId ?? '', 'What did we decide?').catch((e: unknown) => e))).toBe('conflict');
  });

  it('makes every occurrence of a recurring Google Calendar event held in Alcove one series', async () => {
    const n = tag();
    const gus: GoogleUser = { sub: `g-series-${n}`, email: `gus.${n}@calendar.example`, name: 'Gus Ward' };
    const day = (days: number, hour: number, minute = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, minute, 0, 0); return d.toISOString(); };
    const occurrence = (days: number) => ({
      id: `crit${n}_${days}`, recurringEventId: `crit${n}`, summary: 'Design crit', start: { dateTime: day(days, 10) }, end: { dateTime: day(days, 10, 30) },
      organizer: { email: gus.email, self: true }, attendees: [{ email: gus.email, self: true }, { email: 'dee@calendar.example' }]
    });
    const [soon, later] = [occurrence(1), occurrence(5)];
    h.google.calendar(gus.sub).push(soon, later, { id: `once${n}`, summary: 'One-off', start: { dateTime: day(2, 9) }, end: { dateTime: day(2, 9, 30) }, organizer: { email: gus.email, self: true } });
    const b = h.browser();
    await viaGoogle(b, gus);
    expect((await b.api.calendar.get()).events.map((e) => [e.title, e.seriesId])).toEqual([['Design crit', undefined], ['One-off', undefined], ['Design crit', undefined]]);

    // Held in Alcove once, the recurring event is a series, and its next occurrence on the calendar says so.
    const first = await b.api.calendar.adopt(soon.id, 'on');
    const seriesId = first.seriesId ?? '';
    expect(seriesId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect((await b.api.calendar.get()).events.map((e) => [e.id, e.seriesId])).toEqual([[`once${n}`, undefined], [later.id, seriesId]]);
    await hold(b.api, first.code, 'We agreed to keep the darker header. // Will the new font load fast enough?');
    expect(await b.api.series.get(seriesId)).toMatchObject({ title: 'Design crit', recurring: true, isOrganizer: true, questions: [{ text: 'Will the new font load fast enough?' }] });
    // Its next call is on the calendar already, so Alcove doesn't make another.
    expect(code(await b.api.meetings.scheduleNext(first.id).catch((e: unknown) => e))).toBe('conflict');
    // The next occurrence made an Alcove call joins the same series.
    const second = await b.api.calendar.adopt(later.id);
    expect(second.seriesId).toBe(seriesId);
    expect((await b.api.series.get(seriesId)).next?.id).toBe(second.id);
  });
});
