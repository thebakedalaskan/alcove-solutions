/**
 * What the notes propose and what people agree to (docs: Notes and inference › Decisions and follow-ups), end to end: the
 * real API over HTTP via @alcove/api-http, real Postgres, the object store and the fake NEAR AI. Decisions move only as
 * far as each person's grants let them, with who and when; adding a follow-up doesn't claim its owner's consent, which
 * they give separately; every entry shows what backs it for whoever reads it now; and what people settled survives the notes being
 * written again.
 */
import { AlcoveApiError, DEFAULT_NOTES_CHOICES, type ActionPatch, type AlcoveApi, type DecisionPatch, type Note, type NoteEvidenceMoment, type TranscriptClip } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { speechWav } from '../../testing/fakes/near';
import { acceptNoteSuggestions } from '../../testing/follow-ups';
import { startHarness, type Harness } from '../../testing/harness';

vi.setConfig({ testTimeout: 60_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
afterEach(() => h.closeCalls());

let seq = 0;
const tag = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
/** An address at a domain of its own, so the notes model knows its owner by the name before the @. */
const at = (name: string) => `${name}@d${tag()}.example`;
async function account(email = at('person')) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email };
}
type Account = Awaited<ReturnType<typeof account>>;
/** How a request ended: allowed, or the error's code. */
const outcome = (p: Promise<unknown>): Promise<string> => p.then(() => 'allowed', (e: unknown) => (e instanceof AlcoveApiError ? e.code : 'not-an-api-error'));
/** A clip saying `words`: sentences split by " // " are lines two seconds apart, and one starting "~" is hard to hear. */
const speech = (words: string): TranscriptClip => ({ data: new Blob([speechWav(words)], { type: 'audio/wav' }), segment: 0, at: 0, durationMs: 4000 });

/** Holds a call with notes on, says `words`, ends it and waits for its notes to be written. */
async function held(org: Account, words: string, guests: string[] = []): Promise<string> {
  const call = await org.api.calls.join((await org.api.calls.startNow({ notes: 'on', guests })).code, { mic: true, cam: false });
  await call.transcribe(speech(words), call.ticket.identity);
  const noteId = (await call.leave())?.pendingNoteId ?? '';
  await written(org.api, noteId);
  await acceptNoteSuggestions(org.api, noteId);
  return noteId;
}
/** Schedules a call set not to keep its transcript, and joins it as its organizer. */
async function notKept(org: Account, guests: string[]) {
  const meeting = await org.api.meetings.create({
    title: 'Supplier review', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, guests, notes: 'on', choices: { ...DEFAULT_NOTES_CHOICES, keepTranscript: false }
  });
  return { meeting, call: await org.api.calls.join(meeting.code, { mic: true, cam: false }) };
}
async function written(api: AlcoveApi, noteId: string): Promise<void> {
  for await (const p of api.notes.progress(noteId)) if (p.ready) return;
}
/** Who did what to something, in order. */
const who = (x: { changes: { by: { email: string }; what: string }[] } | undefined) => (x?.changes ?? []).map((c) => [c.by.email, c.what]);
const decision = (n: Note, id: string) => n.decisions.find((d) => d.id === id);
const action = (n: Note, id: string) => n.actions.find((a) => a.id === id);
const lineId = (n: Note, starts: string) => n.transcript?.find((l) => l.text.startsWith(starts))?.id ?? '';
/** The lines an entry rests on, as [what was said, whether it cuts against it]. */
const said = (moments: NoteEvidenceMoment[]) => moments.flatMap((m) => (m.kind === 'line' ? [[m.text, m.against]] : []));
/** Confirming, as the app does: with the words that were read. */
const confirm = (text: string | undefined): DecisionPatch => ({ state: 'confirmed', seen: { text: text ?? '' } });
/** What someone read of a follow-up, as the app says when they agree to it. */
const read = (a: { text: string; due?: string | undefined } | undefined) => ({ text: a?.text ?? '', due: a?.due ?? null });
const takeOn = (a: { text: string; due?: string | undefined } | undefined): ActionPatch => ({ takeOn: true, seen: read(a) });

describe('decisions', () => {
  it('moves only as far as each person’s grants let them, and keeps who did it and when', async () => {
    const org = await account(at('organizer'));
    const [kofiEmail, priyaEmail, adeEmail] = [at('kofi'), at('priya'), at('ade')];
    const words = 'We agreed to move the launch to the 18th.';
    const noteId = await held(org, words, [kofiEmail, priyaEmail, adeEmail]);
    const [kofi, priya, ade] = [await account(kofiEmail), await account(priyaEmail), await account(adeEmail)];
    const note = await org.api.notes.get(noteId);
    const id = note.decisions[0]?.id ?? '';
    // What the notes heard is only proposed, whatever the model replied: it said this was confirmed, with a dispute.
    expect(note.decisions).toMatchObject([{ state: 'proposed', changes: [], disputes: [] }]);

    // Anyone invited can confirm: who, when, and how they had the notes.
    const before = new Date().toISOString();
    const confirmed = await kofi.api.notes.updateDecision(noteId, id, confirm(words));
    expect(decision(confirmed, id)?.state).toBe('confirmed');
    const change = decision(confirmed, id)?.changes[0];
    expect(change).toMatchObject({ what: 'confirmed', by: { id: kofi.session.ownerId, email: kofiEmail, as: 'invited' } });
    expect(change && change.at >= before && change.at <= new Date().toISOString()).toBe(true);

    // Taking it away is for the organizer or whoever confirmed it: nobody else.
    const away: DecisionPatch[] = [{ state: 'proposed' }, { state: 'rejected' }, { state: 'superseded' }, { text: 'The launch moves to the 28th.' }];
    for (const patch of away) expect(await outcome(priya.api.notes.updateDecision(noteId, id, patch))).toBe('forbidden');
    expect(decision(await org.api.notes.get(noteId), id)).toMatchObject({ state: 'confirmed', text: words });
    // Kofi takes his back, and Priya confirms it.
    expect(decision(await kofi.api.notes.updateDecision(noteId, id, { state: 'proposed' }), id)?.state).toBe('proposed');
    expect(decision(await priya.api.notes.updateDecision(noteId, id, confirm(words)), id)?.changes.at(-1)).toMatchObject({ what: 'confirmed', by: { email: priyaEmail } });
    // Whoever confirmed it says it stopped holding, and that it still does; only something confirmed can stop.
    expect(decision(await priya.api.notes.updateDecision(noteId, id, { state: 'superseded' }), id)?.state).toBe('superseded');
    expect(await outcome(ade.api.notes.updateDecision(noteId, id, confirm(words)))).toBe('forbidden');
    expect(decision(await priya.api.notes.updateDecision(noteId, id, confirm(words)), id)?.state).toBe('confirmed');

    // The organizer can say it wasn't decided at any point, and only they can bring that back.
    expect(decision(await org.api.notes.updateDecision(noteId, id, { state: 'rejected' }), id)?.changes.at(-1)).toMatchObject({ what: 'rejected', by: { as: 'organizer' } });
    for (const patch of [{ state: 'proposed' }, confirm(words)] satisfies DecisionPatch[]) expect(await outcome(kofi.api.notes.updateDecision(noteId, id, patch))).toBe('forbidden');
    expect(await outcome(org.api.notes.updateDecision(noteId, id, { state: 'superseded' }))).toBe('conflict');
    const reopened = await org.api.notes.updateDecision(noteId, id, { state: 'proposed' });
    expect(who(decision(reopened, id))).toEqual([
      [kofiEmail, 'confirmed'], [kofiEmail, 'reopened'], [priyaEmail, 'confirmed'], [priyaEmail, 'superseded'], [priyaEmail, 'confirmed'], [org.email, 'rejected'], [org.email, 'reopened']
    ]);
    // Nothing that didn't happen was recorded, and the words never moved.
    expect(decision(reopened, id)?.text).toBe(words);
  });

  it('lets someone given the notes afterwards add to them, and leaves agreeing to the people the call was for', async () => {
    const org = await account(at('organizer'));
    const kofiEmail = at('kofi');
    const words = 'We agreed to drop the beta.';
    const noteId = await held(org, `${words} // Kofi will send the screens by Wednesday.`, [kofiEmail]);
    const [kofi, sam] = [await account(kofiEmail), await account(at('sam'))];
    await org.api.notes.share(noteId, { emails: [sam.email] });
    const note = await org.api.notes.get(noteId);
    const [id, screens] = [note.decisions[0]?.id ?? '', note.actions[0]?.id ?? ''];

    // Sam wasn't in the call, so he can't close it for those who were, in anyone's words, and it doesn't wait on him.
    const closing: DecisionPatch[] = [confirm(words), { state: 'rejected' }, { text: 'The beta ends.' }, { text: 'The beta ends.', state: 'confirmed' }];
    for (const patch of closing) expect(await outcome(sam.api.notes.updateDecision(noteId, id, patch))).toBe('forbidden');
    expect((await sam.api.notes.inbox()).decisions).toEqual([]);
    expect((await kofi.api.notes.inbox()).decisions.map((d) => d.id)).toEqual([id]);
    // He can say he doesn't think it was decided, as someone who had the notes afterwards, and it stays open.
    const disputed = await sam.api.notes.updateDecision(noteId, id, { dispute: true });
    expect(decision(disputed, id)).toMatchObject({ text: words, state: 'proposed', disputes: [{ by: { email: sam.email, as: 'shared' } }] });

    // He can propose, and it's his to word; it takes someone invited to confirm it, and then it's theirs.
    const added = (await sam.api.notes.proposeDecision(noteId, { text: 'Keep the changelog.' })).decisions.find((d) => d.text === 'Keep the changelog.');
    expect(added).toMatchObject({ state: 'proposed', changes: [{ what: 'proposed', by: { email: sam.email, as: 'shared' } }] });
    const own = added?.id ?? '';
    expect(decision(await sam.api.notes.updateDecision(noteId, own, { text: 'Keep the whole changelog.' }), own)?.text).toBe('Keep the whole changelog.');
    expect(await outcome(sam.api.notes.updateDecision(noteId, own, confirm('Keep the whole changelog.')))).toBe('forbidden');
    expect((await kofi.api.notes.inbox()).decisions.map((d) => d.id).sort()).toEqual([id, own].sort());
    expect(decision(await kofi.api.notes.updateDecision(noteId, own, confirm('Keep the whole changelog.')), own)?.state).toBe('confirmed');
    expect(await outcome(sam.api.notes.updateDecision(noteId, own, { state: 'rejected' }))).toBe('forbidden');
    expect(decision(await sam.api.notes.updateDecision(noteId, own, { dispute: true }), own)?.disputes).toHaveLength(1);

    // The same for follow-ups: what the notes suggested isn't his to word, and what he added is, until someone takes it on.
    expect(await outcome(sam.api.notes.updateAction(noteId, screens, { text: 'Send nothing' }))).toBe('forbidden');
    const press = (await sam.api.notes.proposeAction(noteId, { text: 'Tell the press', owner: kofiEmail })).actions.find((a) => a.text === 'Tell the press')?.id ?? '';
    const dated = await sam.api.notes.updateAction(noteId, press, { due: 'Friday' });
    expect(action(dated, press)?.due).toBe('Friday');
    await kofi.api.notes.updateAction(noteId, press, takeOn(action(dated, press)));
    expect(await outcome(sam.api.notes.updateAction(noteId, press, { due: 'Monday' }))).toBe('forbidden');
  });

  it('lets anyone say something wasn’t decided, flagged until they take it back or the organizer settles it', async () => {
    const org = await account(at('organizer'));
    const [kofiEmail, priyaEmail] = [at('kofi'), at('priya')];
    const words = 'We agreed to drop the beta.';
    const noteId = await held(org, words, [kofiEmail, priyaEmail]);
    const [kofi, priya] = [await account(kofiEmail), await account(priyaEmail)];
    const id = (await org.api.notes.get(noteId)).decisions[0]?.id ?? '';
    const inboxes = async () => Promise.all([org, kofi, priya].map(async (x) => (await x.api.notes.inbox()).decisions.map((d) => d.id)));

    // Only the organizer rejects: Priya's saying so stays as hers, for everyone to see, and it's waiting on her no more.
    expect(await outcome(priya.api.notes.updateDecision(noteId, id, { state: 'rejected' }))).toBe('forbidden');
    const disputed = await priya.api.notes.updateDecision(noteId, id, { dispute: true });
    expect(decision(disputed, id)).toMatchObject({ state: 'proposed', disputes: [{ by: { email: priyaEmail } }] });
    expect(decision(disputed, id)?.evidence.flags).toContain('conflict');
    expect(await inboxes()).toEqual([[id], [id], []]);
    // Saying it twice says it once; she takes it back, and it's waiting on her again.
    expect(who(decision(await priya.api.notes.updateDecision(noteId, id, { dispute: true }), id))).toEqual([[priyaEmail, 'disputed']]);
    const back = await priya.api.notes.updateDecision(noteId, id, { dispute: false });
    expect(decision(back, id)?.disputes).toEqual([]);
    expect(decision(back, id)?.evidence.flags).not.toContain('conflict');
    expect(await inboxes()).toEqual([[id], [id], [id]]);

    // Disputed again, someone else confirming it doesn't settle it, and Priya can dispute what Kofi confirmed.
    await priya.api.notes.updateDecision(noteId, id, { dispute: true });
    const confirmed = await kofi.api.notes.updateDecision(noteId, id, confirm(words));
    expect(decision(confirmed, id)).toMatchObject({ state: 'confirmed', disputes: [{ by: { email: priyaEmail } }] });
    expect(decision(confirmed, id)?.evidence.flags).toContain('conflict');
    // It's confirmed, but not settled: it waits on the organizer, whose call it is, and it says it's theirs.
    expect(await inboxes()).toEqual([[id], [], []]);
    expect((await org.api.notes.inbox()).decisions).toMatchObject([{ id, state: 'confirmed', role: 'organizer', disputes: [{ by: { email: priyaEmail } }] }]);
    // Kofi confirmed it, so he takes that back rather than disputing it, and so does the organizer, who settles it.
    expect(await outcome(kofi.api.notes.updateDecision(noteId, id, { dispute: true }))).toBe('forbidden');
    expect(await outcome(org.api.notes.updateDecision(noteId, id, { dispute: true }))).toBe('forbidden');
    // Taking back a dispute they never raised does nothing: only saying so settles it.
    expect(decision(await org.api.notes.updateDecision(noteId, id, { dispute: false }), id)?.disputes).toHaveLength(1);
    const settled = await org.api.notes.updateDecision(noteId, id, confirm(words));
    expect(decision(settled, id)).toMatchObject({ state: 'confirmed', disputes: [] });
    expect(decision(settled, id)?.changes.at(-1)).toMatchObject({ what: 'confirmed', by: { email: org.email } });
    expect(await inboxes()).toEqual([[], [], []]);
    // A settled decision that's confirmed already, confirmed again, changes nothing.
    expect(decision(await org.api.notes.updateDecision(noteId, id, confirm(words)), id)?.changes).toHaveLength(decision(settled, id)?.changes.length ?? 0);
    // What was rejected can't be disputed: it's the organizer's call.
    await org.api.notes.updateDecision(noteId, id, { state: 'rejected' });
    expect(await outcome(priya.api.notes.updateDecision(noteId, id, { dispute: true }))).toBe('forbidden');
  });

  it('never lets one person write a decision and agree to it, or new words keep a confirmation of the old ones', async () => {
    const org = await account(at('organizer'));
    const [kofiEmail, priyaEmail] = [at('kofi'), at('priya')];
    const noteId = await held(org, 'We agreed to move the launch to the 18th.', [kofiEmail, priyaEmail]);
    const [kofi, priya] = [await account(kofiEmail), await account(priyaEmail)];
    const id = (await org.api.notes.get(noteId)).decisions[0]?.id ?? '';

    // What the notes heard, anyone invited rewords. It stays proposed, and says its words aren't what was said.
    const reworded = await kofi.api.notes.updateDecision(noteId, id, { text: 'The launch moves to the 18th.' });
    expect(decision(reworded, id)).toMatchObject({ text: 'The launch moves to the 18th.', state: 'proposed', evidence: { flags: ['reworded'] } });
    // Whoever wrote the words can't be who agrees to them, in two steps or in one.
    expect(await outcome(kofi.api.notes.updateDecision(noteId, id, confirm('The launch moves to the 18th.')))).toBe('forbidden');
    expect(await outcome(kofi.api.notes.updateDecision(noteId, id, { text: 'The launch moves to the 19th.', state: 'confirmed' }))).toBe('forbidden');
    expect(decision(await org.api.notes.get(noteId), id)).toMatchObject({ text: 'The launch moves to the 18th.', state: 'proposed' });
    // Someone else reads them against what was said, and confirming them is saying they hold.
    const agreed = await priya.api.notes.updateDecision(noteId, id, confirm('The launch moves to the 18th.'));
    expect(decision(agreed, id)).toMatchObject({ state: 'confirmed', evidence: { flags: [] } });

    // Reworded once it's confirmed, it's back to proposed, for everyone to see what changed.
    const moved = await org.api.notes.updateDecision(noteId, id, { text: 'The launch moves to the 28th.' });
    expect(decision(moved, id)).toMatchObject({ text: 'The launch moves to the 28th.', state: 'proposed', evidence: { flags: ['reworded'] } });
    expect(decision(moved, id)?.changes.slice(-2)).toMatchObject([
      { what: 'reworded', before: 'The launch moves to the 18th.', after: 'The launch moves to the 28th.', by: { email: org.email } }, { what: 'reopened', by: { email: org.email } }
    ]);
    // Whoever confirmed something can reword it too, and that takes someone else again, however it's asked.
    await kofi.api.notes.updateDecision(noteId, id, confirm('The launch moves to the 28th.'));
    expect(await outcome(kofi.api.notes.updateDecision(noteId, id, { text: 'The launch moves to the 29th.', state: 'confirmed' }))).toBe('forbidden');
    expect(decision(await kofi.api.notes.get(noteId), id)).toMatchObject({ text: 'The launch moves to the 28th.', state: 'confirmed' });
    expect(decision(await kofi.api.notes.updateDecision(noteId, id, { text: 'The launch moves to the 29th.' }), id)).toMatchObject({ state: 'proposed', evidence: { flags: ['reworded'] } });
    expect(await outcome(kofi.api.notes.updateDecision(noteId, id, confirm('The launch moves to the 29th.')))).toBe('forbidden');
    // It's the organizer's note: they can confirm their own words in the same change, and stand behind them.
    const both = await org.api.notes.updateDecision(noteId, id, { text: 'The launch moves to the 30th.', state: 'confirmed' });
    expect(decision(both, id)).toMatchObject({ text: 'The launch moves to the 30th.', state: 'confirmed', evidence: { flags: [] } });
    expect(who(decision(both, id)).slice(-2)).toEqual([[org.email, 'reworded'], [org.email, 'confirmed']]);
    // Nothing empty, and only words: a line break can't pass for another line of the notes.
    expect(await outcome(kofi.api.notes.updateDecision(noteId, id, { text: '   ' }))).toBe('invalid');
  });

  it('lets anyone with the notes propose one, which takes someone else to confirm', async () => {
    const org = await account(at('organizer'));
    const [kofiEmail, priyaEmail] = [at('kofi'), at('priya')];
    const noteId = await held(org, 'We should keep the beta open. // Priya will book the room by Friday.', [kofiEmail, priyaEmail]);
    const [kofi, priya] = [await account(kofiEmail), await account(priyaEmail)];
    const other = await held(org, 'Nothing else was said.');
    const note = await org.api.notes.get(noteId);
    expect(note.decisions).toEqual([]);
    const line = lineId(note, 'We should keep');

    // Proposed in someone's own words, pointing at what was said: the notes model isn't asked, and it's nobody's agreement yet.
    const asked = h.near.prompts.length;
    const proposed = await kofi.api.notes.proposeDecision(noteId, { text: 'The beta stays\nopen.', lines: [line] });
    expect(h.near.prompts.length).toBe(asked);
    const id = proposed.decisions[0]?.id ?? '';
    expect(proposed.decisions).toMatchObject([{ text: 'The beta stays open.', state: 'proposed', at: 0, lines: [line], against: [], changes: [{ what: 'proposed', by: { email: kofiEmail, as: 'invited' } }] }]);
    expect(said(proposed.decisions[0]?.evidence.moments ?? [])).toEqual([['We should keep the beta open.', false]]);

    // The same words again add nothing, so a retry can't add it twice.
    expect((await kofi.api.notes.proposeDecision(noteId, { text: 'The beta stays open.' })).decisions).toHaveLength(1);
    // Kofi can't confirm his own proposal, but it's waiting on the others, and it's his to take back, not to dispute.
    expect(await outcome(kofi.api.notes.updateDecision(noteId, id, confirm('The beta stays open.')))).toBe('forbidden');
    expect(await outcome(kofi.api.notes.updateDecision(noteId, id, { dispute: true }))).toBe('forbidden');
    expect((await kofi.api.notes.inbox()).decisions).toEqual([]);
    expect((await priya.api.notes.inbox()).decisions.map((d) => d.id)).toEqual([id]);
    // They're Kofi's words: nobody else changes what he's listed as proposing, on its own or as they confirm it.
    for (const patch of [{ text: 'The beta closes.' }, { text: 'The beta closes.', state: 'confirmed' }] satisfies DecisionPatch[]) {
      expect(await outcome(priya.api.notes.updateDecision(noteId, id, patch))).toBe('forbidden');
    }
    expect(decision(await priya.api.notes.updateDecision(noteId, id, confirm('The beta stays open.')), id)?.state).toBe('confirmed');
    // Someone else's, confirmed, stays out of Kofi's hands: he proposed it, Priya stands behind it. Having second
    // thoughts, he can say so like anyone, which leaves it for the organizer to settle.
    expect(await outcome(kofi.api.notes.updateDecision(noteId, id, { state: 'rejected' }))).toBe('forbidden');
    expect(decision(await kofi.api.notes.updateDecision(noteId, id, { dispute: true }), id)).toMatchObject({ state: 'confirmed', disputes: [{ by: { email: kofiEmail } }] });
    expect((await org.api.notes.inbox()).decisions.map((d) => d.id)).toEqual([id]);
    await kofi.api.notes.updateDecision(noteId, id, { dispute: false });
    await priya.api.notes.updateDecision(noteId, id, { state: 'proposed' });
    expect(decision(await kofi.api.notes.updateDecision(noteId, id, { state: 'rejected' }), id)?.state).toBe('rejected');
    expect(decision(await kofi.api.notes.updateDecision(noteId, id, { state: 'proposed' }), id)?.state).toBe('proposed');
    // The organizer can confirm what they proposed: it's their note.
    const own = await org.api.notes.proposeDecision(noteId, { text: 'We ship on Monday.' });
    const mine = own.decisions.find((d) => d.text === 'We ship on Monday.')?.id ?? '';
    expect(decision(await org.api.notes.updateDecision(noteId, mine, confirm('We ship on Monday.')), mine)?.state).toBe('confirmed');

    // Nothing without anyone saying it backs it, and the note says so; only lines of this part of this note can.
    expect((await priya.api.notes.proposeDecision(noteId, { text: 'Nobody said this.' })).decisions.find((d) => d.text === 'Nobody said this.')?.evidence.flags).toEqual(['missing']);
    const elsewhere = lineId(await org.api.notes.get(other), 'Nothing else');
    expect(await outcome(kofi.api.notes.proposeDecision(noteId, { text: 'From another call.', lines: [elsewhere] }))).toBe('invalid');
    expect(await outcome(kofi.api.notes.proposeDecision(noteId, { text: 'From nowhere.', lines: ['AAAAAAAAAAAAAAAAAAAAAA'] }))).toBe('invalid');
    expect(await outcome(kofi.api.notes.proposeDecision(noteId, { text: 'In no room.', room: 'AAAAAAAAAAAAAAAAAAAAAA' }))).toBe('not-found');
    expect(await outcome(kofi.api.notes.proposeDecision(noteId, { text: 'x'.repeat(301) }))).toBe('invalid');
    // A decision from another note isn't this note's to change, even for its organizer.
    expect(await outcome(org.api.notes.updateDecision(other, id, confirm('The beta stays open.')))).toBe('not-found');

    // Nobody without the notes can add to them: not someone else, nor anyone signed out.
    const stranger = await account();
    expect(await outcome(stranger.api.notes.proposeDecision(noteId, { text: 'I was never there.' }))).toBe('not-found');
    expect(await outcome(stranger.api.notes.proposeAction(noteId, { text: 'Do something' }))).toBe('not-found');
    expect(await outcome(h.browser().api.notes.proposeDecision(noteId, { text: 'Signed out.' }))).toBe('unauthenticated');
    // And notes being written wait.
    const rec = await org.api.recordings.start({ title: 'Still going' });
    expect(await outcome(org.api.notes.proposeDecision(rec.getSnapshot().noteId, { text: 'Too soon.' }))).toBe('conflict');
    await rec.discard();
  });
});

describe('follow-ups', () => {
  it('only suggests who does what until they say so, whatever the notes model replies', async () => {
    const org = await account(at('organizer'));
    const [kofiEmail, priyaEmail] = [at('kofi'), at('priya')];
    const noteId = await held(org, 'Kofi will send the screens by Wednesday.', [kofiEmail, priyaEmail]);
    const [kofi, priya] = [await account(kofiEmail), await account(priyaEmail)];
    const note = await org.api.notes.get(noteId);
    const id = note.actions[0]?.id ?? '';
    // The organizer accepted the task through held(); the model cannot claim the assignee's consent or completion.
    expect(note.actions).toMatchObject([{ takenOn: false, done: false, changes: [{ what: 'accepted', by: { email: org.email } }], owner: { person: { email: kofiEmail } }, due: 'Wednesday' }]);

    // Nobody can say yes for him, the organizer included; only Kofi can, and that's what it says from then on.
    for (const reader of [org, priya]) expect(await outcome(reader.api.notes.updateAction(noteId, id, takeOn(note.actions[0])))).toBe('forbidden');
    expect((await kofi.api.notes.inbox()).followUps).toMatchObject([{ id, takenOn: false, role: 'invited' }]);
    expect(action(await kofi.api.notes.updateAction(noteId, id, takeOn(note.actions[0])), id)).toMatchObject({ takenOn: true, changes: [{ what: 'accepted', by: { email: org.email } }, { what: 'took-on', by: { email: kofiEmail } }] });
    expect((await kofi.api.notes.inbox()).followUps).toMatchObject([{ id, takenOn: true }]);

    // What someone took on, nobody else changes: only they or the organizer can.
    const hands: ActionPatch[] = [{ owner: priyaEmail, seen: read(note.actions[0]) }, { owner: null }, { text: 'Send nothing' }, { due: 'Never' }, { done: true }];
    for (const patch of hands) expect(await outcome(priya.api.notes.updateAction(noteId, id, patch))).toBe('forbidden');
    expect(action(await org.api.notes.get(noteId), id)).toMatchObject({ takenOn: true, done: false, due: 'Wednesday', text: 'Send the screens by Wednesday' });
    // Their own words and date are theirs to change, and stay agreed.
    expect(action(await kofi.api.notes.updateAction(noteId, id, { text: 'Send the final screens', due: 'Friday' }), id)).toMatchObject({ takenOn: true, text: 'Send the final screens', due: 'Friday', evidence: { flags: [] } });

    // The organizer changing what he agreed to asks him again: for new words, and for a new date.
    for (const patch of [{ text: 'Send every screen' }, { due: 'Monday' }] satisfies ActionPatch[]) {
      const asked = await org.api.notes.updateAction(noteId, id, patch);
      expect(action(asked, id)?.takenOn).toBe(false);
      expect(action(asked, id)?.changes.at(-1)).toMatchObject({ what: 'reopened', by: { email: org.email } });
      // New words from someone else are worth a second look, until he's said yes to them.
      if ('text' in patch) expect(action(asked, id)?.evidence.flags).toEqual(['reworded']);
      expect((await kofi.api.notes.inbox()).followUps).toMatchObject([{ id, takenOn: false }]);
      await kofi.api.notes.updateAction(noteId, id, takeOn(action(asked, id)));
    }
    // Saying yes again, or the same thing twice, changes nothing.
    const agreed = action(await org.api.notes.get(noteId), id);
    expect(action(await kofi.api.notes.updateAction(noteId, id, takeOn(agreed)), id)?.changes).toHaveLength(agreed?.changes.length ?? 0);
    // Only its owner or the organizer ticks it now.
    expect(action(await kofi.api.notes.updateAction(noteId, id, { done: true }), id)?.done).toBe(true);
    expect((await kofi.api.notes.inbox()).followUps).toEqual([]);
  });

  it('hears “Not mine” from the person it’s for, and lets them or the organizer hand it on', async () => {
    const org = await account(at('organizer'));
    const [kofiEmail, priyaEmail, adeEmail] = [at('kofi'), at('priya'), at('ade')];
    const noteId = await held(org, 'Kofi will send the screens. // Priya will book the room.', [kofiEmail, priyaEmail, adeEmail]);
    const [kofi, priya, ade] = [await account(kofiEmail), await account(priyaEmail), await account(adeEmail)];
    const note = await org.api.notes.get(noteId);
    const screens = note.actions.find((a) => a.text.startsWith('Send'))?.id ?? '';
    const room = note.actions.find((a) => a.text.startsWith('Book'))?.id ?? '';

    // A suggestion is still theirs to answer: nobody else moves it or claims it.
    for (const patch of [{ owner: adeEmail, seen: read(action(note, screens)) }, { owner: null }] satisfies ActionPatch[]) expect(await outcome(ade.api.notes.updateAction(noteId, screens, patch))).toBe('forbidden');
    // Until someone takes it on, anyone can improve it: nobody has agreed to anything yet.
    expect(action(await ade.api.notes.updateAction(noteId, screens, { text: 'Send the new screens', due: 'Friday' }), screens)).toMatchObject({ text: 'Send the new screens', due: 'Friday', takenOn: false });

    // Not mine: it's said as his, and it's waiting on nobody.
    const declined = await kofi.api.notes.updateAction(noteId, screens, { owner: null });
    expect(action(declined, screens)).toMatchObject({ takenOn: false });
    expect(action(declined, screens)?.owner).toBeUndefined();
    expect(action(declined, screens)?.changes.at(-1)).toMatchObject({ what: 'declined', before: 'Kofi', by: { email: kofiEmail } });
    expect((await kofi.api.notes.inbox()).followUps).toEqual([]);
    // Nobody has it, so anyone can suggest someone; that's only a suggestion, and whoever it's for still answers.
    expect(action(await ade.api.notes.updateAction(noteId, screens, { owner: priyaEmail }), screens)).toMatchObject({ takenOn: false, owner: { person: { email: priyaEmail } } });
    // The person it's for can hand it on, and the organizer can move what someone took on: each time, the next person answers.
    expect(action(await priya.api.notes.updateAction(noteId, screens, { owner: adeEmail }), screens)).toMatchObject({ takenOn: false, owner: { person: { email: adeEmail } } });
    await ade.api.notes.updateAction(noteId, screens, takeOn({ text: 'Send the new screens', due: 'Friday' }));
    const moved = await org.api.notes.updateAction(noteId, screens, { owner: kofiEmail });
    expect(action(moved, screens)).toMatchObject({ takenOn: false, owner: { person: { email: kofiEmail } } });
    expect(action(moved, screens)?.changes.at(-1)).toMatchObject({ what: 'reassigned', before: expect.stringMatching(/ade/i), after: expect.stringMatching(/kofi/i), by: { email: org.email } });
    // What the organizer takes off someone isn't their "Not mine".
    expect(action(await org.api.notes.updateAction(noteId, room, { owner: null }), room)?.changes.at(-1)).toMatchObject({ what: 'reassigned', by: { email: org.email } });
    // Taking what nobody has is taking it on; giving yourself someone else's isn't allowed.
    const seen = read(action(note, room));
    expect(action(await ade.api.notes.updateAction(noteId, room, { owner: adeEmail, seen }), room)).toMatchObject({ takenOn: true, changes: expect.arrayContaining([expect.objectContaining({ what: 'took-on' })]) });
    expect(await outcome(priya.api.notes.updateAction(noteId, room, { owner: priyaEmail, seen }))).toBe('forbidden');
    // Follow-ups go to people who have the notes.
    expect(await outcome(org.api.notes.updateAction(noteId, room, { owner: at('outsider') }))).toBe('invalid');
    expect(await outcome(org.api.notes.proposeAction(noteId, { text: 'Ask an outsider', owner: at('outsider') }))).toBe('invalid');
    // A name the notes couldn't tie to anyone can't answer, so it's as if nobody has it.
    const named = await held(org, 'Sam will order the cake.', [kofiEmail]);
    const cake = (await org.api.notes.get(named)).actions[0];
    expect(cake).toMatchObject({ owner: { name: 'Sam' }, takenOn: false });
    expect(cake?.owner?.person).toBeUndefined();
    expect(action(await kofi.api.notes.updateAction(named, cake?.id ?? '', { owner: kofiEmail, seen: read(cake) }), cake?.id ?? '')).toMatchObject({ takenOn: true, owner: { person: { email: kofiEmail } } });
  });

  it('lets whoever took something on take that back, and nobody else: it’s suggested for them again', async () => {
    const org = await account(at('organizer'));
    const [kofiEmail, adeEmail] = [at('kofi'), at('ade')];
    const noteId = await held(org, 'Kofi will send the screens.', [kofiEmail, adeEmail]);
    const [kofi, ade] = [await account(kofiEmail), await account(adeEmail)];
    const screens = (await org.api.notes.get(noteId)).actions[0];
    const id = screens?.id ?? '';
    expect(action(await kofi.api.notes.updateAction(noteId, id, takeOn(screens)), id)).toMatchObject({ takenOn: true, owner: { person: { email: kofiEmail } } });
    expect((await kofi.api.notes.inbox()).followUps.map((f) => f.id)).toEqual([id]);

    // Nobody else can take his yes back for him, the organizer included.
    expect(await outcome(ade.api.notes.updateAction(noteId, id, { takeOn: false }))).toBe('forbidden');
    expect(await outcome(org.api.notes.updateAction(noteId, id, { takeOn: false }))).toBe('forbidden');
    // He can: it's his to answer again, still his, and the record says he reopened it.
    const back = await kofi.api.notes.updateAction(noteId, id, { takeOn: false });
    expect(action(back, id)).toMatchObject({ takenOn: false, owner: { person: { email: kofiEmail } } });
    expect(who(action(back, id)).slice(-2)).toEqual([[kofiEmail, 'took-on'], [kofiEmail, 'reopened']]);
    expect((await kofi.api.notes.inbox()).followUps.map((f) => f.id)).toEqual([id]);
    // Saying it again changes nothing more.
    expect(who(action(await kofi.api.notes.updateAction(noteId, id, { takeOn: false }), id))).toEqual(who(action(back, id)));
    // And he can take it on again.
    expect(action(await kofi.api.notes.updateAction(noteId, id, takeOn(action(back, id))), id)).toMatchObject({ takenOn: true });
  });

  it('lets anyone with the notes add one, for themselves or as a suggestion for someone else', async () => {
    const org = await account(at('organizer'));
    const [kofiEmail, priyaEmail] = [at('kofi'), at('priya')];
    const noteId = await held(org, 'We talked about the launch.', [kofiEmail, priyaEmail]);
    const [kofi, priya] = [await account(kofiEmail), await account(priyaEmail)];
    const line = lineId(await org.api.notes.get(noteId), 'We talked');

    // For someone else it's a suggestion, and the date with it; it's on them to say.
    const added = await kofi.api.notes.proposeAction(noteId, { text: 'Email the press', owner: priyaEmail, due: 'Friday', lines: [line] });
    expect(added.actions).toMatchObject([{ text: 'Email the press', takenOn: false, due: 'Friday', owner: { person: { email: priyaEmail } }, lines: [line], changes: [{ what: 'proposed', by: { email: kofiEmail } }] }]);
    expect((await priya.api.notes.inbox()).followUps).toMatchObject([{ text: 'Email the press', takenOn: false }]);
    expect(await outcome(kofi.api.notes.updateAction(noteId, added.actions[0]?.id ?? '', takeOn(added.actions[0])))).toBe('forbidden');
    // Adding a task for yourself still doesn't take it on: that agreement is a separate action.
    const mine = await priya.api.notes.proposeAction(noteId, { text: 'Update the page', owner: priyaEmail });
    const own = mine.actions.find((a) => a.text === 'Update the page');
    expect(own).toMatchObject({ review: 'accepted', takenOn: false, owner: { person: { email: priyaEmail } } });
    expect(action(await priya.api.notes.updateAction(noteId, own?.id ?? '', takeOn(own)), own?.id ?? '')).toMatchObject({ takenOn: true });
    // For nobody, it's anyone's, and the same words again add nothing.
    const free = await kofi.api.notes.proposeAction(noteId, { text: 'Order the cake' });
    expect(free.actions.find((a) => a.text === 'Order the cake')?.owner).toBeUndefined();
    expect((await kofi.api.notes.proposeAction(noteId, { text: 'Order the cake' })).actions).toHaveLength(3);
  });
});

describe('what the notes leave out', () => {
  it('leaves out what the model says doesn’t belong, by the reasons each kind of entry can be left out for', async () => {
    const org = await account(at('organizer'));
    // Each line asks the stand-in model to say whether what it hears in it belongs in the notes (keep="…").
    const noteId = await held(org, [
      'We agreed to ship on Monday.',
      'We agreed to name the release Banana keep="aside".',
      'We decided to rent the hall keep=" Done ".',
      'We agreed to move the review keep="yes".',
      'We agreed to hire a designer keep="unheard-of".',
      'We agreed Kofi sends the deck keep="twice".',
      'Who signs off on the budget keep="maybe"?',
      'Which printer do we use keep="personal"?',
      'Priya will draft the memo keep="maybe".',
      'Kofi will send the deck keep="twice".'
    ].join(' // '));
    const note = await org.api.notes.get(noteId);
    // An aside, something done (however it's written) and a job its follow-up holds go; "yes", no reason or one it doesn't
    // know keeps a decision.
    expect(note.decisions.map((d) => d.text)).toEqual(['We agreed to ship on Monday.', 'We agreed to move the review keep="yes".', 'We agreed to hire a designer keep="unheard-of".']);
    // "maybe" is never a question's reason, so the question stays; personal chat goes.
    expect(note.questions.map((q) => q.text)).toEqual(['Who signs off on the budget keep="maybe"?']);
    // Something only floated goes; "twice" says a follow-up holds something else, so the follow-up itself stays.
    expect(note.actions.map((a) => a.text)).toEqual(['Send the deck keep="twice"']);
  });

  it('doesn’t list an open question that a follow-up to find it out already holds, and keeps one about something else', async () => {
    const org = await account(at('organizer'));
    // Both an open question and a follow-up to email someone, heard in one line: the follow-up is about something else.
    const unrelated = 'Ade will email the deck, but is the caterer vegan?';
    h.near.reword(unrelated, 'Email Sam the agenda');
    try {
      const noteId = await held(org, ['Kofi will check whether the venue is free?', 'Priya will book the room by Friday?', unrelated].join(' // '));
      const note = await org.api.notes.get(noteId);
      expect(note.actions.map((a) => a.text)).toEqual(['Check whether the venue is free?', 'Book the room by Friday?', 'Email Sam the agenda']);
      // Checking whether the venue is free holds that question. Booking a room finds nothing out, and the email isn't
      // about the caterer, so those questions stay open.
      expect(note.questions.map((q) => q.text)).toEqual(['Priya will book the room by Friday?', unrelated]);
    } finally {
      h.near.reword(unrelated, null);
    }
  });

  it('ends a part’s summary with what becomes of it later in the call, whole, however long the part’s own summary', async () => {
    const org = await account(at('organizer'));
    const pencilled = `We pencilled in the second for the offsite, ${'and went over the travel at length, '.repeat(8)}later="Later, the date moves to the ninth."`;
    const noteId = await held(org, [pencilled, 'Fine by me.', 'We agreed to ship on Monday.'].join(' // '));
    const [first, second] = (await org.api.notes.get(noteId)).chapters;
    expect(first?.summary.startsWith('We pencilled in the second for the offsite')).toBe(true);
    expect(first?.summary.endsWith(' Later, the date moves to the ninth.')).toBe(true);
    expect(first?.summary.length).toBeLessThanOrEqual(300);
    // A part nothing changes later keeps its summary as it is.
    expect(second?.summary).toBe('We agreed to ship on Monday.');
  });
});

describe('what backs an entry', () => {
  it('points at the lines it came from, and flags what’s missing, in doubt or said otherwise', async () => {
    const org = await account(at('organizer'));
    const kofiEmail = at('kofi');
    const noteId = await held(org, 'We agreed to drop the beta. // No, the beta stays until March. // ~We decided to ship on Monday. // Kofi will send the screens by Wednesday. // Is this unbacked?', [kofiEmail]);
    const kofi = await account(kofiEmail);
    const note = await org.api.notes.get(noteId);
    const entry = (starts: string) => note.decisions.find((d) => d.text.startsWith(starts));

    // Told how many of each the notes keep, so a busy call's reply isn't cut off on entries that would be dropped.
    expect(h.near.instructions.findLast((x) => x.startsWith('You write the notes'))).toMatch(/decisions: .*At most 12: .*\nquestions: .*At most 12: .*\nactions: .*at most 20: /);
    // The lines it was sent, and none the model made up: only what was really said comes back, with who said it.
    expect(said(entry('We agreed')?.evidence.moments ?? [])).toEqual([['We agreed to drop the beta.', false], ['No, the beta stays until March.', true]]);
    expect(entry('We agreed')).toMatchObject({ lines: [lineId(note, 'We agreed')], against: [lineId(note, 'No, the beta')] });
    expect(entry('We agreed')?.evidence.flags).toEqual(['conflict']);
    expect(entry('We agreed')?.evidence.moments[0]).toMatchObject({ kind: 'line', speaker: { name: org.session.user.name } });
    // Resting only on what was hard to hear; and on nothing at all, which the note says rather than dropping it. The model
    // gave that one a moment too, but with no line behind it that's its word alone, and the nearest line backs nothing.
    expect(entry('We decided')?.evidence).toMatchObject({ flags: ['unsure'], moments: [{ unsure: { words: true } }] });
    expect(entry('Everyone agreed')).toMatchObject({ lines: [], evidence: { moments: [], flags: ['missing'] } });
    expect(entry('Everyone agreed')?.at).toBeUndefined();
    // Questions and follow-ups rest on lines the same way.
    expect(note.questions).toMatchObject([{ text: 'Is this unbacked?', evidence: { flags: [] } }]);
    expect(said(note.actions[0]?.evidence.moments ?? [])).toEqual([['Kofi will send the screens by Wednesday.', false]]);

    // A line corrected since says so wherever it's cited. Confirming the decision after that reads it as it is now.
    const id = note.actions[0]?.id ?? '';
    const fixed = await org.api.notes.correctLine(noteId, lineId(note, 'Kofi will'), { text: 'Kofi will send the screens by Friday.' });
    expect(action(fixed, id)?.evidence).toMatchObject({ flags: ['corrected'], moments: [{ text: 'Kofi will send the screens by Friday.', corrected: true }] });
    const seen = await kofi.api.notes.updateAction(noteId, id, takeOn(note.actions[0]));
    expect(action(seen, id)?.evidence).toMatchObject({ flags: [], moments: [{ corrected: false }] });
    // Saying a line was heard right changes nothing it rests on.
    const unsure = entry('We decided')?.id ?? '';
    const vouched = await org.api.notes.correctLine(noteId, lineId(note, 'We decided'), { confirm: true });
    expect(decision(vouched, unsure)?.evidence.flags).toEqual([]);
  });

  it('stays corrected until someone settles it again, whatever else is said about it', async () => {
    const org = await account(at('organizer'));
    const [kofiEmail, priyaEmail] = [at('kofi'), at('priya')];
    const words = 'We agreed to drop the beta.';
    const noteId = await held(org, words, [kofiEmail, priyaEmail]);
    const [kofi, priya] = [await account(kofiEmail), await account(priyaEmail)];
    const note = await org.api.notes.get(noteId);
    const id = note.decisions[0]?.id ?? '';
    const flags = async () => decision(await org.api.notes.get(noteId), id)?.evidence.flags;
    await kofi.api.notes.updateDecision(noteId, id, confirm(words));
    await org.api.notes.correctLine(noteId, lineId(note, 'We agreed'), { text: 'We agreed to end the beta.' });
    expect(await flags()).toEqual(['corrected']);

    // Saying it wasn't decided and taking that back isn't reading the line again, and neither is Kofi taking his back.
    await priya.api.notes.updateDecision(noteId, id, { dispute: true });
    expect(await flags()).toEqual(['conflict', 'corrected']);
    await priya.api.notes.updateDecision(noteId, id, { dispute: false });
    expect(await flags()).toEqual(['corrected']);
    await kofi.api.notes.updateDecision(noteId, id, { state: 'proposed' });
    expect(await flags()).toEqual(['corrected']);
    // Confirming it is: whoever does reads the line as it is now.
    await priya.api.notes.updateDecision(noteId, id, confirm(words));
    expect(await flags()).toEqual([]);
  });

  it('doesn’t say nothing backs an entry because the call wasn’t set to keep what did', async () => {
    const org = await account(at('organizer'));
    const { call } = await notKept(org, []);
    await call.transcribe(speech('We agreed to drop the beta. // No, the beta stays until March. // We decided to ship on Monday. // Is this unbacked?'), call.ticket.identity);
    const noteId = (await call.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    const entry = (starts: string) => note.decisions.find((d) => d.text.startsWith(starts));
    expect(note.transcript).toEqual([]);

    // These rested on lines that went on purpose, so there's nothing to quote, and that's not the same as nothing behind them.
    expect(entry('We decided')).toMatchObject({ evidence: { moments: [], flags: [] } });
    expect(entry('We decided')?.lines).toHaveLength(1);
    // What someone said against one is still known, though not what they said.
    expect(entry('We agreed')).toMatchObject({ evidence: { moments: [], flags: ['conflict'] } });
    // And what the model wrote with nothing behind it still says so, with or without a transcript.
    expect(entry('Everyone agreed')).toMatchObject({ lines: [], evidence: { moments: [], flags: ['missing'] } });
    // As does what someone proposed from memory.
    const mine = await org.api.notes.proposeDecision(noteId, { text: 'Nobody said this.' });
    expect(mine.decisions.find((d) => d.text === 'Nobody said this.')?.evidence.flags).toEqual(['missing']);
  });

  it('is read for each person, from the notes they have now', async () => {
    const org = await account(at('organizer'));
    const [kofiEmail, priyaEmail] = [at('kofi'), at('priya')];
    const noteId = await held(org, 'We agreed to drop the beta. // Priya will write the post by Friday.', [kofiEmail, priyaEmail]);
    const [kofi, priya] = [await account(kofiEmail), await account(priyaEmail)];
    const [one] = (await org.api.notes.get(noteId)).decisions;
    const reading = async (x: Account) => {
      const inbox = await x.api.notes.inbox();
      return [...inbox.decisions.map((d) => d.evidence.moments.length), ...inbox.followUps.map((a) => a.evidence.moments.length)];
    };
    // Everyone who has the notes reads what backs an entry where it waits on them, as the note stands now.
    expect(await reading(org)).toEqual([1]);
    expect(await reading(kofi)).toEqual([1]);
    expect(await reading(priya)).toEqual([1, 1]);
    const fixed = await org.api.notes.correctLine(noteId, lineId(await org.api.notes.get(noteId), 'We agreed'), { text: 'We agreed to end the beta.' });
    expect((await kofi.api.notes.inbox()).decisions[0]?.evidence).toMatchObject({ flags: ['corrected'], moments: [{ text: 'We agreed to end the beta.' }] });
    expect(decision(fixed, one?.id ?? '')?.evidence.moments).toMatchObject([{ text: 'We agreed to end the beta.' }]);

    // Priya removes the notes. Whatever anyone else reads, she reads nothing of them: not the entry, the line or a way to change it.
    await priya.api.notes.delete(noteId);
    expect(await reading(priya)).toEqual([]);
    expect(await outcome(priya.api.notes.get(noteId))).toBe('not-found');
    expect(await outcome(priya.api.notes.updateDecision(noteId, one?.id ?? '', confirm(one?.text)))).toBe('not-found');
    expect(await outcome(priya.api.notes.proposeDecision(noteId, { text: 'Gone from mine.' }))).toBe('not-found');
    // Kofi's reading doesn't depend on hers.
    expect(await reading(kofi)).toEqual([1]);
    // And nothing derived is kept anywhere for anyone: a line's words live in the note and nowhere else.
    const rows = await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM note_access WHERE note_item_id = $1', [noteId]);
    expect(rows.rows[0]?.n).toBe(1);
  });

  it('is gone with the note, and nobody else can reach it', async () => {
    const org = await account(at('organizer'));
    const kofiEmail = at('kofi');
    const noteId = await held(org, 'We agreed to drop the beta.', [kofiEmail]);
    const kofi = await account(kofiEmail);
    const id = (await org.api.notes.get(noteId)).decisions[0]?.id ?? '';
    await kofi.api.notes.updateDecision(noteId, id, confirm('We agreed to drop the beta.'));
    await kofi.api.notes.proposeDecision(noteId, { text: 'Keep the changelog.' });
    await kofi.api.notes.proposeAction(noteId, { text: 'Write it up' });
    const revisions = async () => (await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM revisions WHERE item_id = $1', [noteId])).rows[0]?.n ?? 0;
    expect(await revisions()).toBeGreaterThan(3);

    await org.api.notes.delete(noteId);
    // Every revision, so every wording and every change anyone made, physically; and what waited on people goes with it.
    expect(await revisions()).toBe(0);
    expect(await kofi.api.notes.inbox()).toEqual({ followUps: [], decisions: [] });
    expect(await outcome(kofi.api.notes.updateDecision(noteId, id, { state: 'proposed' }))).toBe('not-found');
  });
});

describe('the record, read back', () => {
  it('keeps the history of an entry’s wording, status, owner and due date', async () => {
    const org = await account(at('organizer'));
    const kofiEmail = at('kofi');
    const noteId = await held(org, 'We agreed to drop the beta. // Kofi will send the screens by Wednesday.', [kofiEmail]);
    const kofi = await account(kofiEmail);
    const note = await org.api.notes.get(noteId);
    const [d, a] = [note.decisions[0]?.id ?? '', note.actions[0]?.id ?? ''];

    await kofi.api.notes.updateDecision(noteId, d, { text: 'The beta ends.' });
    await org.api.notes.updateDecision(noteId, d, confirm('The beta ends.'));
    await org.api.notes.updateDecision(noteId, d, { state: 'superseded' });
    await kofi.api.notes.updateAction(noteId, a, takeOn(note.actions[0]));
    await kofi.api.notes.updateAction(noteId, a, { due: 'Friday' });
    await kofi.api.notes.updateAction(noteId, a, { text: 'Send the final screens' });
    await org.api.notes.updateAction(noteId, a, { owner: org.email, seen: { text: 'Send the final screens', due: 'Friday' } });
    const last = await org.api.notes.updateAction(noteId, a, { done: true });

    const history = (x: { changes: { what: string; by: { email: string; as: string | null }; before?: string | undefined; after?: string | undefined }[] } | undefined) =>
      (x?.changes ?? []).map((c) => [c.what, c.by.as, c.before, c.after]);
    expect(history(decision(last, d))).toEqual([
      ['reworded', 'invited', 'We agreed to drop the beta.', 'The beta ends.'], ['confirmed', 'organizer', undefined, undefined], ['superseded', 'organizer', undefined, undefined]
    ]);
    expect(history(action(last, a))).toEqual([
      ['accepted', 'organizer', undefined, undefined],
      ['took-on', 'invited', undefined, undefined], ['due', 'invited', 'Wednesday', 'Friday'], ['reworded', 'invited', 'Send the screens by Wednesday', 'Send the final screens'],
      ['took-on', 'organizer', 'Kofi', org.session.user.name], ['done', 'organizer', undefined, undefined]
    ]);
    // Everything that happened is in order, each with when, and it reads the same for everyone who has the notes.
    const stamps = decision(last, d)?.changes.map((c) => c.at) ?? [];
    expect(stamps).toEqual([...stamps].sort());
    expect(decision(await kofi.api.notes.get(noteId), d)?.changes).toEqual(decision(last, d)?.changes);
  });

  it('keeps who proposed and who confirmed something however long its history gets', async () => {
    const org = await account(at('organizer'));
    const [kofiEmail, priyaEmail, adeEmail] = [at('kofi'), at('priya'), at('ade')];
    const noteId = await held(org, 'We talked about the launch.', [kofiEmail, priyaEmail, adeEmail]);
    const [kofi, priya, ade] = [await account(kofiEmail), await account(priyaEmail), await account(adeEmail)];
    const id = (await priya.api.notes.proposeDecision(noteId, { text: 'Launch on a Tuesday.' })).decisions[0]?.id ?? '';
    await kofi.api.notes.updateDecision(noteId, id, confirm('Launch on a Tuesday.'));
    // Saying so and taking it back, over and over: an entry keeps its first change, its latest of each kind, and then its latest.
    for (let i = 0; i < 25; i++) {
      await ade.api.notes.updateDecision(noteId, id, { dispute: true });
      await ade.api.notes.updateDecision(noteId, id, { dispute: false });
    }
    const kept = decision(await org.api.notes.get(noteId), id);
    expect(kept?.changes).toHaveLength(40);
    expect(kept?.changes[0]).toMatchObject({ what: 'proposed', by: { email: priyaEmail } });
    expect(kept?.changes[1]).toMatchObject({ what: 'confirmed', by: { email: kofiEmail } });
    expect(kept?.changes.at(-1)).toMatchObject({ what: 'undisputed' });
    // So it's still Kofi's to take back, and nobody else's; and still hers, so she still can't confirm it herself.
    expect(await outcome(ade.api.notes.updateDecision(noteId, id, { state: 'proposed' }))).toBe('forbidden');
    expect(decision(await kofi.api.notes.updateDecision(noteId, id, { state: 'proposed' }), id)?.state).toBe('proposed');
    expect(await outcome(priya.api.notes.updateDecision(noteId, id, confirm('Launch on a Tuesday.')))).toBe('forbidden');
  });

  it('limits how fast someone changes notes, so nobody can churn one or its history', async () => {
    const org = await account(at('organizer'));
    const kofiEmail = at('kofi');
    const noteId = await held(org, 'We agreed to drop the beta.', [kofiEmail]);
    const kofi = await account(kofiEmail);
    const id = (await org.api.notes.get(noteId)).decisions[0]?.id ?? '';
    const change = () => kofi.api.notes.updateDecision(noteId, id, { dispute: false });
    for (let i = 0; i < 120; i++) await change();
    // Every way of changing a note counts towards the same allowance, and it's one person's: others carry on.
    expect(await outcome(change())).toBe('unavailable');
    expect(await outcome(kofi.api.notes.proposeDecision(noteId, { text: 'One more.' }))).toBe('unavailable');
    expect(await outcome(kofi.api.notes.get(noteId))).toBe('allowed');
    expect(await outcome(org.api.notes.updateDecision(noteId, id, { state: 'rejected' }))).toBe('allowed');
  });

  it('keeps what people settled when the notes are written again', async () => {
    const org = await account(at('organizer'));
    const [kofiEmail, priyaEmail] = [at('kofi'), at('priya')];
    const noteId = await held(org, 'We agreed to launch on the 18th. // We decided to hire a designer. // We decided to rename the app. // Kofi will send the screens by Wednesday. // Priya will book the room by Friday. // Ade will order the cake.', [kofiEmail, priyaEmail]);
    const [kofi, priya] = [await account(kofiEmail), await account(priyaEmail)];
    const note = await org.api.notes.get(noteId);
    const id = (xs: { id: string; text: string }[], starts: string) => xs.find((x) => x.text.startsWith(starts))?.id ?? '';
    const [launch, hire, rename] = [id(note.decisions, 'We agreed'), id(note.decisions, 'We decided to hire'), id(note.decisions, 'We decided to rename')];
    const [screens, room, cake] = [id(note.actions, 'Send'), id(note.actions, 'Book'), id(note.actions, 'Order')];

    await kofi.api.notes.updateDecision(noteId, launch, confirm(decision(note, launch)?.text));
    await org.api.notes.updateDecision(noteId, hire, { state: 'rejected' });
    await priya.api.notes.updateDecision(noteId, rename, { dispute: true });
    await kofi.api.notes.updateAction(noteId, screens, takeOn(action(note, screens)));
    await priya.api.notes.updateAction(noteId, room, { owner: null });
    await priya.api.notes.proposeDecision(noteId, { text: 'Keep the changelog.', lines: [lineId(note, 'We agreed')] });
    await priya.api.notes.proposeAction(noteId, { text: 'Tell the press' });
    const before = await org.api.notes.get(noteId);
    await org.api.notes.correctLine(noteId, lineId(note, 'Ade will'), { text: 'Ade will order the big cake.' });

    expect((await org.api.notes.rewrite(noteId)).writingAgain).toBe(true);
    await written(org.api, noteId);
    const again = await org.api.notes.get(noteId);
    expect(again.writingAgain).toBe(false);
    const settled = (n: Note) => ({
      decisions: n.decisions.filter((d) => d.changes.length > 0).map((d) => [d.id, d.text, d.state, d.lines, d.disputes.map((x) => x.by.email), who(d)]),
      actions: n.actions.filter((a) => a.changes.length > 0).map((a) => [a.id, a.text, a.takenOn, a.owner?.name, a.due, who(a)])
    });
    // Everything anyone confirmed, rejected, disputed, took on, turned down or proposed is as they left it, in the same place.
    expect(settled(again)).toEqual(settled(before));
    // Told what's settled, the model repeated it anyway: nothing came back twice, and Priya isn't offered what she turned down.
    expect(again.decisions).toHaveLength(4);
    expect(again.actions.map((a) => a.text).sort()).toEqual(['Book the room by Friday', 'Order the cake', 'Send the screens by Wednesday', 'Tell the press']);
    expect(again.actions.find((a) => a.text.startsWith('Book'))?.owner).toBeUndefined();
    expect(h.near.prompts[h.near.instructions.findLastIndex((x) => x.startsWith('You write the notes'))]).toContain('Follow-up (nobody has it): Book the room by Friday');
    // A corrected line proposes a change; the task already accepted by a person keeps its words and identity.
    const fresh = again.suggestions.find((a) => a.text === 'Order the big cake');
    expect(fresh).toMatchObject({ takenOn: false, changes: [], evidence: { flags: [] } });
    expect(fresh?.id).not.toBe(cake);
    expect(fresh?.changeOf).toBe(cake);
    expect(again.actions.find((a) => a.id === cake)?.text).toBe('Order the cake');
    // The inbox reads the same: what was acknowledged stays so, what was answered stays answered.
    expect((await kofi.api.notes.inbox()).followUps).toMatchObject([{ id: screens, takenOn: true }]);
    expect((await priya.api.notes.inbox()).followUps).toEqual([]);
    expect((await priya.api.notes.inbox()).decisions.map((d) => d.id)).toEqual([]);
    expect((await kofi.api.notes.inbox()).decisions.map((d) => d.text).sort()).toEqual(['Keep the changelog.', 'We decided to rename the app.']);
  });

  it('doesn’t take something short for what the call said when the notes are written again', async () => {
    const org = await account(at('organizer'));
    const kofiEmail = at('kofi');
    const noteId = await held(org, 'We agreed to move the beta to March. // We decided to ship on Monday. // Kofi will send the screens by Wednesday. // Kofi will book the room. // Kofi will tell the board about the end of the beta.', [kofiEmail]);
    const kofi = await account(kofiEmail);
    // Proposed from memory, so with no moment to place them. These share words with what was said and say something else:
    // a word or two, most of the shorter one's words, or the same small words around a different one.
    await kofi.api.notes.proposeDecision(noteId, { text: 'Move the launch' });
    await kofi.api.notes.proposeDecision(noteId, { text: 'the' });
    await kofi.api.notes.proposeDecision(noteId, { text: 'Move the launch to March' });
    await kofi.api.notes.proposeAction(noteId, { text: 'the' });
    await kofi.api.notes.proposeAction(noteId, { text: 'Tell the team about the end of the beta' });
    // Two words aren't enough to tell, even the same two, so both stay.
    await kofi.api.notes.proposeAction(noteId, { text: 'Book room' });
    // These say what the model is going to say again, so each stays one entry: the one someone proposed.
    await kofi.api.notes.proposeDecision(noteId, { text: 'Agreed to ship on Monday' });
    await kofi.api.notes.proposeAction(noteId, { text: 'Send screens by Wednesday' });

    await org.api.notes.rewrite(noteId);
    await written(org.api, noteId);
    const again = await org.api.notes.get(noteId);
    // Nothing the call said was lost to them: the model words decisions afresh, as it does when it's told what's settled.
    expect(again.decisions.map((d) => d.text).sort()).toEqual(['Agreed to ship on Monday', 'Agreed: move the beta to March.', 'Move the launch', 'Move the launch to March', 'the']);
    expect(again.actions.map((a) => a.text).sort()).toEqual(['Book room', 'Book the room', 'Send screens by Wednesday', 'Send the screens by Wednesday', 'Tell the board about the end of the beta', 'Tell the team about the end of the beta', 'the']);
  });
});

describe('agreeing to what was read', () => {
  it('refuses a yes to words or a date that changed since they were read', async () => {
    const org = await account(at('organizer'));
    const [kofiEmail, priyaEmail] = [at('kofi'), at('priya')];
    const noteId = await held(org, 'We agreed to drop the beta. // Kofi will send the screens by Wednesday.', [kofiEmail, priyaEmail]);
    const [kofi, priya] = [await account(kofiEmail), await account(priyaEmail)];
    const before = await kofi.api.notes.get(noteId);
    const [d, a] = [before.decisions[0]?.id ?? '', before.actions[0]?.id ?? ''];

    // Both change while Kofi has the page open, and he says yes to what he read: nothing is saved.
    await priya.api.notes.updateDecision(noteId, d, { text: 'We agreed to keep the beta.' });
    await org.api.notes.updateAction(noteId, a, { text: 'Pay for the screens yourself', due: 'Today' });
    expect(await outcome(kofi.api.notes.updateDecision(noteId, d, confirm(before.decisions[0]?.text)))).toBe('conflict');
    expect(await outcome(kofi.api.notes.updateAction(noteId, a, takeOn(before.actions[0])))).toBe('conflict');
    const now = await org.api.notes.get(noteId);
    expect(decision(now, d)).toMatchObject({ text: 'We agreed to keep the beta.', state: 'proposed' });
    expect(action(now, a)).toMatchObject({ text: 'Pay for the screens yourself', due: 'Today', takenOn: false });
    expect(who(action(now, a))).not.toContainEqual([kofiEmail, 'took-on']);

    // A new date is as much of a change as new words.
    await org.api.notes.updateAction(noteId, a, { due: 'Tomorrow' });
    expect(await outcome(kofi.api.notes.updateAction(noteId, a, takeOn(action(now, a))))).toBe('conflict');
    // Having read it as it is, he agrees to that.
    const read2 = await kofi.api.notes.get(noteId);
    expect(decision(await kofi.api.notes.updateDecision(noteId, d, confirm(decision(read2, d)?.text)), d)?.state).toBe('confirmed');
    expect(action(await kofi.api.notes.updateAction(noteId, a, takeOn(action(read2, a))), a)).toMatchObject({ takenOn: true, due: 'Tomorrow' });

    // The server doesn't take the app's word for it: agreeing without saying what was read isn't allowed.
    await kofi.api.notes.updateDecision(noteId, d, { state: 'proposed' });
    await org.api.notes.updateAction(noteId, a, { owner: null });
    expect(await outcome(priya.api.notes.updateDecision(noteId, d, { state: 'confirmed' }))).toBe('invalid');
    expect(await outcome(kofi.api.notes.updateAction(noteId, a, { takeOn: true }))).toBe('invalid');
    // Giving it to yourself is saying yes to it too, so the same goes.
    expect(await outcome(priya.api.notes.updateAction(noteId, a, { owner: priyaEmail }))).toBe('invalid');
    expect(await outcome(priya.api.notes.updateAction(noteId, a, { owner: priyaEmail, seen: read(before.actions[0]) }))).toBe('conflict');
    expect(action(await priya.api.notes.updateAction(noteId, a, { owner: priyaEmail, seen: read(action(read2, a)) }), a)).toMatchObject({ takenOn: true, owner: { person: { email: priyaEmail } } });
  });
});

describe('guests', () => {
  it('gives someone who came in by the link nothing to read, confirm or be held to', async () => {
    const org = await account(at('organizer'));
    const { code } = await org.api.calls.startNow({ notes: 'on' });
    const host = await org.api.calls.join(code, { mic: true, cam: false });
    const visitor = h.browser();
    const sam = await visitor.api.calls.join(code, { mic: true, cam: false, name: 'Sam' });
    for (let i = 0; i < 200 && !host.getSnapshot().waiting.some((w) => w.id === sam.ticket.identity); i++) { await host.refresh(); await new Promise((r) => setTimeout(r, 25)); }
    await host.admit(sam.ticket.identity);
    for (let i = 0; i < 400 && sam.crypto.getSnapshot().status !== 'in'; i++) await new Promise((r) => setTimeout(r, 25));
    expect(sam.crypto.getSnapshot().status).toBe('in');
    await host.transcribe(speech('We agreed to order a cake. // Sam will order the cake by Friday.'), host.ticket.identity);
    const noteId = (await host.leave())?.pendingNoteId ?? '';
    await written(org.api, noteId);
    await acceptNoteSuggestions(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    const [d, a] = [note.decisions[0]?.id ?? '', note.actions[0]?.id ?? ''];

    // The notes can name them, but a guest has no account, so it stays a name nobody can answer to.
    expect(note.actions[0]).toMatchObject({ owner: { name: 'Sam' }, takenOn: false });
    expect(note.actions[0]?.owner?.person).toBeUndefined();
    // Adding the task records the organizer's review, without agreeing to it for the guest.
    const reviewHistory = note.actions[0]?.changes;
    expect(who(note.actions[0])).toEqual([[org.email, 'accepted']]);
    // The notes go to people invited, so someone who only had the link can't reach any of it.
    const attempts = [
      () => visitor.api.notes.get(noteId), () => visitor.api.notes.updateDecision(noteId, d, confirm(note.decisions[0]?.text)), () => visitor.api.notes.updateAction(noteId, a, takeOn(note.actions[0])),
      () => visitor.api.notes.proposeDecision(noteId, { text: 'I was there.' }), () => visitor.api.notes.inbox()
    ];
    for (const attempt of attempts) expect(await outcome(attempt())).toBe('unauthenticated');
    // Signing in afterwards doesn't change that: being in a call isn't having its notes.
    const later = await account(at('sam'));
    expect(await outcome(later.api.notes.updateAction(noteId, a, takeOn(note.actions[0])))).toBe('not-found');
    expect(await outcome(org.api.notes.updateAction(noteId, a, { owner: later.email }))).toBe('invalid');
    expect(action(await org.api.notes.get(noteId), a)?.changes).toEqual(reviewHistory);
  });
});

describe('notes that couldn’t be written', () => {
  /** The job writing someone's notes: where it stands, waiting for its first try to fail, and trying again now, not later. */
  const jobOf = (org: Account) => {
    const job = async () => (await h.pool.query<{ state: string; attempt: number }>('SELECT state, attempt FROM content_jobs WHERE owner_id = $1', [org.session.ownerId])).rows[0];
    const failedOnce = async () => { for (let i = 0; i < 200; i++) { const j = await job(); if (j?.state === 'queued' && j.attempt === 1) return; await new Promise((r) => setTimeout(r, 25)); } };
    const retryNow = async () => {
      const { maintain } = await import('../../maintenance');
      await h.pool.query(`UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = $1`, [org.session.ownerId]);
      await maintain(h.deps);
    };
    return { job, failedOnce, retryNow };
  };

  it('never shows anyone a line of a transcript that isn’t theirs to read, whichever way they come at it', async () => {
    const org = await account(at('organizer'));
    const kofiEmail = at('kofi');
    const kofi = await account(kofiEmail);
    const { job, failedOnce, retryNow } = jobOf(org);
    // A call set not to keep its transcript, whose notes couldn't be written: it stays, for its organizer to have them written.
    const { meeting, call } = await notKept(org, [kofiEmail]);
    h.near.failNext(3, 'prose');
    await call.transcribe(speech('CANARY-KEPTBACK we ship on Monday.'), call.ticket.identity);
    const noteId = (await call.leave())?.pendingNoteId ?? '';
    await failedOnce();
    await retryNow();
    await retryNow();
    expect(await job()).toBeUndefined();

    // The organizer can rest a proposal on a line, and reads what's behind it.
    const line = (await org.api.notes.get(noteId)).transcript?.[0]?.id ?? '';
    const proposed = await org.api.notes.proposeDecision(noteId, { text: 'Monday it is.', lines: [line] });
    expect(said(proposed.decisions[0]?.evidence.moments ?? [])).toEqual([['CANARY-KEPTBACK we ship on Monday.', false]]);

    // It's Kofi's to confirm, but what backs it isn't his to read: not on the note, in what waits on him, or across the series.
    const startsAt = new Date(new Date(meeting.startsAt).getTime() + 7 * 86_400_000).toISOString();
    const seriesId = (await org.api.meetings.scheduleNext(meeting.id, startsAt)).seriesId ?? '';
    const [read, waiting, series] = [await kofi.api.notes.get(noteId), await kofi.api.notes.inbox(), await kofi.api.series.get(seriesId)];
    expect(read.decisions).toMatchObject([{ text: 'Monday it is.', evidence: { moments: [], flags: [] } }]);
    expect(waiting.decisions).toMatchObject([{ text: 'Monday it is.', evidence: { moments: [], flags: [] } }]);
    expect(series.decisions).toMatchObject([{ text: 'Monday it is.', evidence: { moments: [], flags: [] } }]);
    for (const reply of [read, waiting, series]) expect(JSON.stringify(reply)).not.toContain('CANARY-KEPTBACK');
  });

  it('asks for less after a reply that was cut off, so a call with a lot in it still gets its notes', async () => {
    const org = await account(at('organizer'));
    const { failedOnce, retryNow } = jobOf(org);
    const sent = h.near.instructions.length;
    // The reply runs out of tokens part way, so what came back isn't JSON.
    h.near.failNext(1, 'cut-off');
    const rec = await org.api.recordings.start({ title: 'Busy' });
    await rec.transcribe(speech('We agreed to ship on Monday.'));
    const { pendingNoteId: noteId } = await rec.stop();
    await failedOnce();
    await retryNow();
    await written(org.api, noteId);
    expect((await org.api.notes.get(noteId)).decisions.map((d) => d.text)).toEqual(['We agreed to ship on Monday.']);
    // The model was asked for fewer of everything the second time, the screens it describes too.
    const [first, second] = h.near.instructions.slice(sent).filter((x) => x.startsWith('You write the notes'));
    expect(first).toMatch(/decisions: .*At most 12: .*\nquestions: .*At most 12: .*\nactions: .*at most 20: /);
    expect(first).toMatch(/screens: .*up to 8 of them/);
    expect(second).toMatch(/decisions: .*At most 6: .*\nquestions: .*At most 6: .*\nactions: .*at most 10: /);
    expect(second).toMatch(/screens: .*up to 4 of them/);
  });

  it('keeps what someone added meanwhile, once they are', async () => {
    const org = await account(at('organizer'));
    const { job, failedOnce, retryNow } = jobOf(org);
    // The notes model never gives a usable answer, so the note is finished without notes.
    h.near.failNext(3, 'prose');
    const rec = await org.api.recordings.start({ title: 'Unwritten' });
    await rec.transcribe(speech('We agreed to ship on Monday.'));
    const { pendingNoteId: noteId } = await rec.stop();
    await failedOnce();
    await retryNow();
    await retryNow();
    expect(await job()).toBeUndefined();
    expect(await org.api.notes.get(noteId)).toMatchObject({ status: 'ready', summary: '', writtenAt: null, decisions: [] });

    // Someone adds what they remember, and then the notes are written after all: what they added is still there. The model
    // is told it's settled, as for anything added before notes are first written, so it doesn't list it again; told that,
    // like a model can, it words what it does list another way.
    await org.api.notes.proposeDecision(noteId, { text: 'Monday it is.' });
    const added = (await org.api.notes.proposeAction(noteId, { text: 'Tell the team', owner: org.email })).actions.find((a) => a.text === 'Tell the team');
    expect(added).toMatchObject({ review: 'accepted', takenOn: false });
    await org.api.notes.updateAction(noteId, added?.id ?? '', takeOn(added));
    const asked = h.near.prompts.length;
    await org.api.notes.rewrite(noteId);
    await written(org.api, noteId);
    const told = h.near.prompts.slice(asked).find((p) => p.includes('Already settled')) ?? '';
    expect(told).toContain('Monday it is.');
    expect(told).toContain('Tell the team');
    const note = await org.api.notes.get(noteId);
    expect(note.writtenAt).not.toBeNull();
    expect(note.decisions.map((d) => d.text).sort()).toEqual(['Agreed: ship on Monday.', 'Monday it is.']);
    expect(note.actions.map((a) => [a.text, a.takenOn])).toEqual([['Tell the team', true]]);
  });
});

describe('asking across your notes', () => {
  it('tells what someone took on from what was only suggested', async () => {
    const org = await account(at('organizer'));
    const kofiEmail = at('kofi');
    const noteId = await held(org, 'Kofi will send the screens by Wednesday. // Kofi will book the room.', [kofiEmail]);
    const kofi = await account(kofiEmail);
    const screens = (await org.api.notes.get(noteId)).actions.find((a) => a.text.startsWith('Send'));
    await kofi.api.notes.updateAction(noteId, screens?.id ?? '', takeOn(screens));
    for await (const part of org.api.notes.askAll('Who is sending the screens?')) expect(part.type).toMatch(/text|cite/);
    const prompt = h.near.prompts.at(-1) ?? '';
    expect(prompt).toMatch(/Send the screens by Wednesday \(Kofi, took it on, due Wednesday\)/);
    expect(prompt).toMatch(/Book the room \(Kofi, suggested\)/);
  });
});
