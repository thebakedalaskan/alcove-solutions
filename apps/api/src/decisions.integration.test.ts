/**
 * What the notes propose and what people agree to (docs: Notes and inference › Decisions and follow-ups), end to end: the
 * real API over HTTP via @alcove/api-http, real Postgres, the object store and the fake NEAR AI. Decisions move only as
 * far as each person's grants let them, with who and when; a follow-up is a suggestion until the person it's for says
 * so; every entry shows what backs it for whoever reads it now; and what people settled survives the notes being
 * written again.
 */
import { AlcoveApiError, type ActionPatch, type AlcoveApi, type DecisionPatch, type Note, type NoteEvidenceMoment, type TranscriptClip } from '@alcove/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { speechWav } from './testing/fake-near';
import { startHarness, type Harness } from './testing/harness';

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
  return noteId;
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

describe('decisions', () => {
  it('moves only as far as each person’s grants let them, and keeps who did it and when', async () => {
    const org = await account(at('organizer'));
    const [kofiEmail, priyaEmail] = [at('kofi'), at('priya')];
    const noteId = await held(org, 'We agreed to move the launch to the 18th.', [kofiEmail, priyaEmail]);
    const [kofi, priya, sam] = [await account(kofiEmail), await account(priyaEmail), await account(at('sam'))];
    await org.api.notes.share(noteId, { emails: [sam.email] });
    const note = await org.api.notes.get(noteId);
    const id = note.decisions[0]?.id ?? '';
    // What the notes heard is only proposed, whatever the model replied: it said this was confirmed, with a dispute.
    expect(note.decisions).toMatchObject([{ state: 'proposed', changes: [], disputes: [] }]);

    // Anyone with the notes can confirm: who, when, and how they had the notes.
    const before = new Date().toISOString();
    const confirmed = await kofi.api.notes.updateDecision(noteId, id, { state: 'confirmed' });
    expect(decision(confirmed, id)?.state).toBe('confirmed');
    const change = decision(confirmed, id)?.changes[0];
    expect(change).toMatchObject({ what: 'confirmed', by: { email: kofiEmail, as: 'invited' } });
    expect(change && change.at >= before && change.at <= new Date().toISOString()).toBe(true);

    // Taking it away is for the organizer or whoever confirmed it: nobody else, however they got the notes.
    const away: DecisionPatch[] = [{ state: 'proposed' }, { state: 'rejected' }, { state: 'superseded' }, { text: 'The launch moves to the 28th.' }];
    for (const reader of [priya, sam]) for (const patch of away) expect(await outcome(reader.api.notes.updateDecision(noteId, id, patch))).toBe('forbidden');
    expect(decision(await org.api.notes.get(noteId), id)).toMatchObject({ state: 'confirmed', text: 'We agreed to move the launch to the 18th.' });
    // Kofi takes his back, and someone it was shared with confirms it, which says so.
    expect(decision(await kofi.api.notes.updateDecision(noteId, id, { state: 'proposed' }), id)?.state).toBe('proposed');
    expect(decision(await sam.api.notes.updateDecision(noteId, id, { state: 'confirmed' }), id)?.changes.at(-1)).toMatchObject({ what: 'confirmed', by: { as: 'shared' } });
    // Whoever confirmed it says it stopped holding, and that it still does; only something confirmed can stop.
    expect(decision(await sam.api.notes.updateDecision(noteId, id, { state: 'superseded' }), id)?.state).toBe('superseded');
    expect(await outcome(priya.api.notes.updateDecision(noteId, id, { state: 'confirmed' }))).toBe('forbidden');
    expect(decision(await sam.api.notes.updateDecision(noteId, id, { state: 'confirmed' }), id)?.state).toBe('confirmed');

    // The organizer can say it wasn't decided at any point, and only they can bring that back.
    expect(decision(await org.api.notes.updateDecision(noteId, id, { state: 'rejected' }), id)?.changes.at(-1)).toMatchObject({ what: 'rejected', by: { as: 'organizer' } });
    for (const patch of [{ state: 'proposed' }, { state: 'confirmed' }] satisfies DecisionPatch[]) expect(await outcome(kofi.api.notes.updateDecision(noteId, id, patch))).toBe('forbidden');
    expect(await outcome(org.api.notes.updateDecision(noteId, id, { state: 'superseded' }))).toBe('conflict');
    const reopened = await org.api.notes.updateDecision(noteId, id, { state: 'proposed' });
    expect(who(decision(reopened, id))).toEqual([
      [kofiEmail, 'confirmed'], [kofiEmail, 'reopened'], [sam.email, 'confirmed'], [sam.email, 'superseded'], [sam.email, 'confirmed'], [org.email, 'rejected'], [org.email, 'reopened']
    ]);
    // Nothing that didn't happen was recorded, and the words never moved.
    expect(decision(reopened, id)?.text).toBe('We agreed to move the launch to the 18th.');
  });

  it('lets anyone say something wasn’t decided, flagged until they take it back or the organizer settles it', async () => {
    const org = await account(at('organizer'));
    const [kofiEmail, priyaEmail] = [at('kofi'), at('priya')];
    const noteId = await held(org, 'We agreed to drop the beta.', [kofiEmail, priyaEmail]);
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
    const confirmed = await kofi.api.notes.updateDecision(noteId, id, { state: 'confirmed' });
    expect(decision(confirmed, id)).toMatchObject({ state: 'confirmed', disputes: [{ by: { email: priyaEmail } }] });
    expect(decision(confirmed, id)?.evidence.flags).toContain('conflict');
    // Kofi confirmed it, so he takes that back rather than disputing it, and so does the organizer, who settles it.
    expect(await outcome(kofi.api.notes.updateDecision(noteId, id, { dispute: true }))).toBe('forbidden');
    expect(await outcome(org.api.notes.updateDecision(noteId, id, { dispute: true }))).toBe('forbidden');
    // Taking back a dispute they never raised does nothing: only saying so settles it.
    expect(decision(await org.api.notes.updateDecision(noteId, id, { dispute: false }), id)?.disputes).toHaveLength(1);
    const settled = await org.api.notes.updateDecision(noteId, id, { state: 'confirmed' });
    expect(decision(settled, id)).toMatchObject({ state: 'confirmed', disputes: [] });
    expect(decision(settled, id)?.changes.at(-1)).toMatchObject({ what: 'confirmed', by: { email: org.email } });
    // A settled decision that's confirmed already, confirmed again, changes nothing.
    expect(decision(await org.api.notes.updateDecision(noteId, id, { state: 'confirmed' }), id)?.changes).toHaveLength(decision(settled, id)?.changes.length ?? 0);
    // What was rejected can't be disputed: it's the organizer's call.
    await org.api.notes.updateDecision(noteId, id, { state: 'rejected' });
    expect(await outcome(priya.api.notes.updateDecision(noteId, id, { dispute: true }))).toBe('forbidden');
  });

  it('never lets new words keep a confirmation that was for the old ones', async () => {
    const org = await account(at('organizer'));
    const kofiEmail = at('kofi');
    const noteId = await held(org, 'We agreed to move the launch to the 18th.', [kofiEmail, at('priya')]);
    const kofi = await account(kofiEmail);
    const id = (await org.api.notes.get(noteId)).decisions[0]?.id ?? '';

    // What's only proposed, anyone rewords, and it stays proposed.
    expect(decision(await kofi.api.notes.updateDecision(noteId, id, { text: 'The launch moves to the 18th.' }), id)).toMatchObject({ text: 'The launch moves to the 18th.', state: 'proposed' });
    await kofi.api.notes.updateDecision(noteId, id, { state: 'confirmed' });
    // Reworded once it's confirmed, it's back to proposed, for everyone to see what changed.
    const moved = await org.api.notes.updateDecision(noteId, id, { text: 'The launch moves to the 28th.' });
    expect(decision(moved, id)).toMatchObject({ text: 'The launch moves to the 28th.', state: 'proposed' });
    expect(decision(moved, id)?.changes.slice(-2)).toMatchObject([
      { what: 'reworded', before: 'The launch moves to the 18th.', after: 'The launch moves to the 28th.', by: { email: org.email } }, { what: 'reopened', by: { email: org.email } }
    ]);
    // Unless the same change confirms the new words: whoever does that stands behind them.
    await kofi.api.notes.updateDecision(noteId, id, { state: 'confirmed' });
    const both = await kofi.api.notes.updateDecision(noteId, id, { text: 'The launch moves to the 29th.', state: 'confirmed' });
    expect(decision(both, id)).toMatchObject({ text: 'The launch moves to the 29th.', state: 'confirmed' });
    expect(who(decision(both, id)).slice(-2)).toEqual([[kofiEmail, 'reworded'], [kofiEmail, 'confirmed']]);
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
    // Kofi can't confirm his own proposal, but it's waiting on the others, and it's his to take back.
    expect(await outcome(kofi.api.notes.updateDecision(noteId, id, { state: 'confirmed' }))).toBe('forbidden');
    expect((await kofi.api.notes.inbox()).decisions).toEqual([]);
    expect((await priya.api.notes.inbox()).decisions.map((d) => d.id)).toEqual([id]);
    expect(decision(await priya.api.notes.updateDecision(noteId, id, { state: 'confirmed' }), id)?.state).toBe('confirmed');
    // Someone else's, confirmed, stays out of Kofi's hands: he proposed it, Priya stands behind it.
    expect(await outcome(kofi.api.notes.updateDecision(noteId, id, { state: 'rejected' }))).toBe('forbidden');
    await priya.api.notes.updateDecision(noteId, id, { state: 'proposed' });
    expect(decision(await kofi.api.notes.updateDecision(noteId, id, { state: 'rejected' }), id)?.state).toBe('rejected');
    expect(decision(await kofi.api.notes.updateDecision(noteId, id, { state: 'proposed' }), id)?.state).toBe('proposed');
    // The organizer can confirm what they proposed: it's their note.
    const own = await org.api.notes.proposeDecision(noteId, { text: 'We ship on Monday.' });
    const mine = own.decisions.find((d) => d.text === 'We ship on Monday.')?.id ?? '';
    expect(decision(await org.api.notes.updateDecision(noteId, mine, { state: 'confirmed' }), mine)?.state).toBe('confirmed');

    // Nothing without anyone saying it backs it, and the note says so; only lines of this part of this note can.
    expect((await priya.api.notes.proposeDecision(noteId, { text: 'Nobody said this.' })).decisions.find((d) => d.text === 'Nobody said this.')?.evidence.flags).toEqual(['missing']);
    const elsewhere = lineId(await org.api.notes.get(other), 'Nothing else');
    expect(await outcome(kofi.api.notes.proposeDecision(noteId, { text: 'From another call.', lines: [elsewhere] }))).toBe('invalid');
    expect(await outcome(kofi.api.notes.proposeDecision(noteId, { text: 'From nowhere.', lines: ['AAAAAAAAAAAAAAAAAAAAAA'] }))).toBe('invalid');
    expect(await outcome(kofi.api.notes.proposeDecision(noteId, { text: 'In no room.', room: 'AAAAAAAAAAAAAAAAAAAAAA' }))).toBe('not-found');
    expect(await outcome(kofi.api.notes.proposeDecision(noteId, { text: 'x'.repeat(301) }))).toBe('invalid');
    // A decision from another note isn't this note's to change, even for its organizer.
    expect(await outcome(org.api.notes.updateDecision(other, id, { state: 'confirmed' }))).toBe('not-found');

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
    // The model replied that this was taken on and done: the notes only ever suggest.
    expect(note.actions).toMatchObject([{ takenOn: false, done: false, changes: [], owner: { person: { email: kofiEmail } }, due: 'Wednesday' }]);

    // Nobody can say yes for him, the organizer included; only Kofi can, and that's what it says from then on.
    for (const reader of [org, priya]) expect(await outcome(reader.api.notes.updateAction(noteId, id, { takeOn: true }))).toBe('forbidden');
    expect((await kofi.api.notes.inbox()).followUps).toMatchObject([{ id, takenOn: false, yours: false }]);
    expect(action(await kofi.api.notes.updateAction(noteId, id, { takeOn: true }), id)).toMatchObject({ takenOn: true, changes: [{ what: 'took-on', by: { email: kofiEmail } }] });
    expect((await kofi.api.notes.inbox()).followUps).toMatchObject([{ id, takenOn: true }]);

    // What someone took on, nobody else changes: only they or the organizer can.
    const hands: ActionPatch[] = [{ owner: priyaEmail }, { owner: null }, { text: 'Send nothing' }, { due: 'Never' }, { done: true }];
    for (const patch of hands) expect(await outcome(priya.api.notes.updateAction(noteId, id, patch))).toBe('forbidden');
    expect(action(await org.api.notes.get(noteId), id)).toMatchObject({ takenOn: true, done: false, due: 'Wednesday', text: 'Send the screens by Wednesday' });
    // Their own words and date are theirs to change, and stay agreed.
    expect(action(await kofi.api.notes.updateAction(noteId, id, { text: 'Send the final screens', due: 'Friday' }), id)).toMatchObject({ takenOn: true, text: 'Send the final screens', due: 'Friday' });

    // The organizer changing what he agreed to asks him again: for new words, and for a new date.
    for (const patch of [{ text: 'Send every screen' }, { due: 'Monday' }] satisfies ActionPatch[]) {
      const asked = await org.api.notes.updateAction(noteId, id, patch);
      expect(action(asked, id)?.takenOn).toBe(false);
      expect(action(asked, id)?.changes.at(-1)).toMatchObject({ what: 'reopened', by: { email: org.email } });
      expect((await kofi.api.notes.inbox()).followUps).toMatchObject([{ id, takenOn: false }]);
      await kofi.api.notes.updateAction(noteId, id, { takeOn: true });
    }
    // Saying yes again, or the same thing twice, changes nothing.
    const length = action(await org.api.notes.get(noteId), id)?.changes.length ?? 0;
    expect(action(await kofi.api.notes.updateAction(noteId, id, { takeOn: true }), id)?.changes).toHaveLength(length);
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
    for (const patch of [{ owner: adeEmail }, { owner: null }] satisfies ActionPatch[]) expect(await outcome(ade.api.notes.updateAction(noteId, screens, patch))).toBe('forbidden');
    expect(await outcome(ade.api.notes.updateAction(noteId, screens, { owner: adeEmail }))).toBe('forbidden');
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
    await ade.api.notes.updateAction(noteId, screens, { takeOn: true });
    const moved = await org.api.notes.updateAction(noteId, screens, { owner: kofiEmail });
    expect(action(moved, screens)).toMatchObject({ takenOn: false, owner: { person: { email: kofiEmail } } });
    expect(action(moved, screens)?.changes.at(-1)).toMatchObject({ what: 'reassigned', before: expect.stringMatching(/ade/i), after: expect.stringMatching(/kofi/i), by: { email: org.email } });
    // What the organizer takes off someone isn't their "Not mine".
    expect(action(await org.api.notes.updateAction(noteId, room, { owner: null }), room)?.changes.at(-1)).toMatchObject({ what: 'reassigned', by: { email: org.email } });
    // Taking what nobody has is taking it on; giving yourself someone else's isn't allowed.
    expect(action(await ade.api.notes.updateAction(noteId, room, { owner: adeEmail }), room)).toMatchObject({ takenOn: true, changes: expect.arrayContaining([expect.objectContaining({ what: 'took-on' })]) });
    expect(await outcome(priya.api.notes.updateAction(noteId, room, { owner: priyaEmail }))).toBe('forbidden');
    // Follow-ups go to people who have the notes.
    expect(await outcome(org.api.notes.updateAction(noteId, room, { owner: at('outsider') }))).toBe('invalid');
    expect(await outcome(org.api.notes.proposeAction(noteId, { text: 'Ask an outsider', owner: at('outsider') }))).toBe('invalid');
    // A name the notes couldn't tie to anyone can't answer, so it's as if nobody has it.
    const named = await held(org, 'Sam will order the cake.', [kofiEmail]);
    const cake = (await org.api.notes.get(named)).actions[0];
    expect(cake).toMatchObject({ owner: { name: 'Sam' }, takenOn: false });
    expect(cake?.owner?.person).toBeUndefined();
    expect(action(await kofi.api.notes.updateAction(named, cake?.id ?? '', { owner: kofiEmail }), cake?.id ?? '')).toMatchObject({ takenOn: true, owner: { person: { email: kofiEmail } } });
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
    expect(await outcome(kofi.api.notes.updateAction(noteId, added.actions[0]?.id ?? '', { takeOn: true }))).toBe('forbidden');
    // For yourself it's taken on from the start.
    const mine = await priya.api.notes.proposeAction(noteId, { text: 'Update the page', owner: priyaEmail });
    expect(mine.actions.find((a) => a.text === 'Update the page')).toMatchObject({ takenOn: true });
    // For nobody, it's anyone's, and the same words again add nothing.
    const free = await kofi.api.notes.proposeAction(noteId, { text: 'Order the cake' });
    expect(free.actions.find((a) => a.text === 'Order the cake')?.owner).toBeUndefined();
    expect((await kofi.api.notes.proposeAction(noteId, { text: 'Order the cake' })).actions).toHaveLength(3);
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

    // The lines it was sent, and none the model made up: only what was really said comes back, with who said it.
    expect(said(entry('We agreed')?.evidence.moments ?? [])).toEqual([['We agreed to drop the beta.', false], ['No, the beta stays until March.', true]]);
    expect(entry('We agreed')).toMatchObject({ lines: [lineId(note, 'We agreed')], against: [lineId(note, 'No, the beta')] });
    expect(entry('We agreed')?.evidence.flags).toEqual(['conflict']);
    expect(entry('We agreed')?.evidence.moments[0]).toMatchObject({ kind: 'line', speaker: { name: org.session.user.name } });
    // Resting only on what was hard to hear; and on nothing at all, which the note says rather than dropping it.
    expect(entry('We decided')?.evidence).toMatchObject({ flags: ['unsure'], moments: [{ unsure: { words: true } }] });
    expect(entry('Everyone agreed')).toMatchObject({ lines: [], evidence: { moments: [], flags: ['missing'] } });
    // Questions and follow-ups rest on lines the same way.
    expect(note.questions).toMatchObject([{ text: 'Is this unbacked?', evidence: { flags: [] } }]);
    expect(said(note.actions[0]?.evidence.moments ?? [])).toEqual([['Kofi will send the screens by Wednesday.', false]]);

    // A line corrected since says so wherever it's cited. Confirming the decision after that reads it as it is now.
    const id = note.actions[0]?.id ?? '';
    const fixed = await org.api.notes.correctLine(noteId, lineId(note, 'Kofi will'), { text: 'Kofi will send the screens by Friday.' });
    expect(action(fixed, id)?.evidence).toMatchObject({ flags: ['corrected'], moments: [{ text: 'Kofi will send the screens by Friday.', corrected: true }] });
    const seen = await kofi.api.notes.updateAction(noteId, id, { takeOn: true });
    expect(action(seen, id)?.evidence).toMatchObject({ flags: [], moments: [{ corrected: false }] });
    // Saying a line was heard right changes nothing it rests on.
    const unsure = entry('We decided')?.id ?? '';
    const vouched = await org.api.notes.correctLine(noteId, lineId(note, 'We decided'), { confirm: true });
    expect(decision(vouched, unsure)?.evidence.flags).toEqual([]);
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
    expect(await outcome(priya.api.notes.updateDecision(noteId, one?.id ?? '', { state: 'confirmed' }))).toBe('not-found');
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
    await kofi.api.notes.updateDecision(noteId, id, { state: 'confirmed' });
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

    await kofi.api.notes.updateDecision(noteId, d, { text: 'The beta ends.', state: 'confirmed' });
    await org.api.notes.updateDecision(noteId, d, { state: 'superseded' });
    await kofi.api.notes.updateAction(noteId, a, { takeOn: true });
    await kofi.api.notes.updateAction(noteId, a, { due: 'Friday' });
    await kofi.api.notes.updateAction(noteId, a, { text: 'Send the final screens' });
    await org.api.notes.updateAction(noteId, a, { owner: org.email });
    const last = await org.api.notes.updateAction(noteId, a, { done: true });

    const history = (x: { changes: { what: string; by: { email: string; as: string | null }; before?: string | undefined; after?: string | undefined }[] } | undefined) =>
      (x?.changes ?? []).map((c) => [c.what, c.by.as, c.before, c.after]);
    expect(history(decision(last, d))).toEqual([
      ['reworded', 'invited', 'We agreed to drop the beta.', 'The beta ends.'], ['confirmed', 'invited', undefined, undefined], ['superseded', 'organizer', undefined, undefined]
    ]);
    expect(history(action(last, a))).toEqual([
      ['took-on', 'invited', undefined, undefined], ['due', 'invited', 'Wednesday', 'Friday'], ['reworded', 'invited', 'Send the screens by Wednesday', 'Send the final screens'],
      ['took-on', 'organizer', 'Kofi', org.session.user.name], ['done', 'organizer', undefined, undefined]
    ]);
    // Everything that happened is in order, each with when, and it reads the same for everyone who has the notes.
    const stamps = decision(last, d)?.changes.map((c) => c.at) ?? [];
    expect(stamps).toEqual([...stamps].sort());
    expect(decision(await kofi.api.notes.get(noteId), d)?.changes).toEqual(decision(last, d)?.changes);
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

    await kofi.api.notes.updateDecision(noteId, launch, { state: 'confirmed' });
    await org.api.notes.updateDecision(noteId, hire, { state: 'rejected' });
    await priya.api.notes.updateDecision(noteId, rename, { dispute: true });
    await kofi.api.notes.updateAction(noteId, screens, { takeOn: true });
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
    expect(again.actions.map((a) => a.text).sort()).toEqual(['Book the room by Friday', 'Order the big cake', 'Send the screens by Wednesday', 'Tell the press']);
    expect(again.actions.find((a) => a.text.startsWith('Book'))?.owner).toBeUndefined();
    expect(h.near.prompts.at(-1)).toContain('Follow-up (nobody has it): Book the room by Friday');
    // What nobody touched was written afresh, from the corrected line, and it's still only a suggestion.
    const fresh = again.actions.find((a) => a.text === 'Order the big cake');
    expect(fresh).toMatchObject({ takenOn: false, changes: [], evidence: { flags: [] } });
    expect(fresh?.id).not.toBe(cake);
    // The inbox reads the same: what was acknowledged stays so, what was answered stays answered.
    expect((await kofi.api.notes.inbox()).followUps).toMatchObject([{ id: screens, takenOn: true }]);
    expect((await priya.api.notes.inbox()).followUps).toEqual([]);
    expect((await priya.api.notes.inbox()).decisions.map((d) => d.id)).toEqual([]);
    expect((await kofi.api.notes.inbox()).decisions.map((d) => d.text).sort()).toEqual(['Keep the changelog.', 'We decided to rename the app.']);
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
    const note = await org.api.notes.get(noteId);
    const [d, a] = [note.decisions[0]?.id ?? '', note.actions[0]?.id ?? ''];

    // The notes can name them, but a guest has no account, so it stays a name nobody can answer to.
    expect(note.actions[0]).toMatchObject({ owner: { name: 'Sam' }, takenOn: false });
    expect(note.actions[0]?.owner?.person).toBeUndefined();
    // The notes go to people invited, so someone who only had the link can't reach any of it.
    const attempts = [
      () => visitor.api.notes.get(noteId), () => visitor.api.notes.updateDecision(noteId, d, { state: 'confirmed' }), () => visitor.api.notes.updateAction(noteId, a, { takeOn: true }),
      () => visitor.api.notes.proposeDecision(noteId, { text: 'I was there.' }), () => visitor.api.notes.inbox()
    ];
    for (const attempt of attempts) expect(await outcome(attempt())).toBe('unauthenticated');
    // Signing in afterwards doesn't change that: being in a call isn't having its notes.
    const later = await account(at('sam'));
    expect(await outcome(later.api.notes.updateAction(noteId, a, { takeOn: true }))).toBe('not-found');
    expect(await outcome(org.api.notes.updateAction(noteId, a, { owner: later.email }))).toBe('invalid');
    expect(action(await org.api.notes.get(noteId), a)?.changes).toEqual([]);
  });
});

describe('notes that couldn’t be written', () => {
  it('keeps what someone added meanwhile, once they are', async () => {
    const { maintain } = await import('./maintenance');
    const org = await account(at('organizer'));
    const job = async () => (await h.pool.query<{ state: string; attempt: number }>('SELECT state, attempt FROM content_jobs WHERE owner_id = $1', [org.session.ownerId])).rows[0];
    const retryNow = async () => {
      await h.pool.query(`UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = $1`, [org.session.ownerId]);
      await maintain(h.deps);
    };
    // The notes model never gives a usable answer, so the note is finished without notes.
    h.near.failNext(3, 'prose');
    const rec = await org.api.recordings.start({ title: 'Unwritten' });
    await rec.transcribe(speech('We agreed to ship on Monday.'));
    const { pendingNoteId: noteId } = await rec.stop();
    for (let i = 0; i < 200; i++) { const j = await job(); if (j?.state === 'queued' && j.attempt === 1) break; await new Promise((r) => setTimeout(r, 25)); }
    await retryNow();
    await retryNow();
    expect(await job()).toBeUndefined();
    expect(await org.api.notes.get(noteId)).toMatchObject({ status: 'ready', summary: '', writtenAt: null, decisions: [] });

    // Someone adds what they remember, and then the notes are written after all: what they added is still there.
    await org.api.notes.proposeDecision(noteId, { text: 'Monday it is.' });
    await org.api.notes.proposeAction(noteId, { text: 'Tell the team', owner: org.email });
    await org.api.notes.rewrite(noteId);
    await written(org.api, noteId);
    const note = await org.api.notes.get(noteId);
    expect(note.writtenAt).not.toBeNull();
    expect(note.decisions.map((d) => d.text).sort()).toEqual(['Monday it is.', 'We agreed to ship on Monday.']);
    expect(note.actions.map((a) => [a.text, a.takenOn])).toEqual([['Tell the team', true]]);
  });
});

describe('asking across your notes', () => {
  it('tells what someone took on from what was only suggested', async () => {
    const org = await account(at('organizer'));
    const kofiEmail = at('kofi');
    const noteId = await held(org, 'Kofi will send the screens by Wednesday. // Kofi will book the room.', [kofiEmail]);
    const kofi = await account(kofiEmail);
    const id = (await org.api.notes.get(noteId)).actions.find((a) => a.text.startsWith('Send'))?.id ?? '';
    await kofi.api.notes.updateAction(noteId, id, { takeOn: true });
    for await (const part of org.api.notes.askAll('Who is sending the screens?')) expect(part.type).toMatch(/text|cite/);
    const prompt = h.near.prompts.at(-1) ?? '';
    expect(prompt).toMatch(/Send the screens by Wednesday \(Kofi, took it on, due Wednesday\)/);
    expect(prompt).toMatch(/Book the room \(Kofi, suggested\)/);
  });
});
