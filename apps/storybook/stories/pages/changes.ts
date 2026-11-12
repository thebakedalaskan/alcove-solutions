/*
 * What page stories change about their scenario's world as they open (`changing()` in src/page.tsx): a part of Alcove
 * that fails or keeps the page waiting, recordings kept on this device, the calendar, the shared demo account, a call on
 * its way here, the calls other people asked Art to, and notes in every state. All made up, in the demo world.
 */
import { NOTE_LINK_DAYS, type PersonalEntry } from '@alcove/api';
import { UNENCRYPTED_MODEL } from '../../src/api/script';
import { standIn } from '../../src/api/standin';
import type { Troubles } from '../../src/api/trouble';
import { keepHere, type KeptSpec } from '../../src/api/kept';
import type { World } from '../../src/world';
import { connected, notConnected } from '../../src/world/build';
import { iso } from '../../src/world/clock';
import { INVITATIONS, MOVING } from '../../src/world/invitations';
import { withDriveExports } from '../../src/world/drive-exports';
import { AIKO, ART, DIEGO, ELENA, LENA, MAYA, ME_ID, NADIA, OMAR, PRIYA, SAM, THEO } from '../../src/world/people';
import { swap } from '../journeys/play';

/** These parts of Alcove go wrong while the story is open (src/api/trouble.ts). */
export const troubled = (troubles: Troubles) => (w: World): void => { w.trouble = { ...w.trouble, ...troubles }; };
/** Own accepted follow-ups are ready for the reversible completion control in Home and the note preview. */
export const takenOn = (w: World): void => {
  for (const note of w.notes) for (const action of note.actions) if (action.owner?.person?.email === w.session?.user.email) action.takenOn = true;
};

/**
 * The standup twice in one day: a first run at 8:00 that ended early, with no notes, and a home of its own, before the one
 * at 9:00. Their homes share a name, so wherever they're listed together each says when its call started.
 */
export const standupTwice = (w: World): void => {
  const later = w.workspaces.find((s) => s.id === 'ws-standup');
  const folder = later?.items.find((i) => i.call !== null);
  if (!later?.call || !folder?.call) return;
  const at = new Date(Date.parse(later.call.at) - 3_600_000).toISOString();
  w.workspaces.push({
    ...later, id: 'ws-standup-early', people: 3, createdAt: at, call: { ...later.call, at },
    items: [{ ...folder, id: 'StandupEarlyFolder0000', createdAt: at, editedAt: at, call: { ...folder.call, startedAt: at, noteId: null } }]
  });
};

/**
 * The server answers that it doesn't run in confidential compute, as the public beta on Cloud Run does: a story's
 * `beforeEach`, put back when the next story opens. Everywhere still says Confidential compute, with nothing verified.
 */
export const notAttested = (): (() => void) => swap(standIn.trust, 'attestation', async (nonce) => ({ tee: 'none', nonce, build: { commit: 'storybook' } }));

/** Signed in with Google without sharing the calendar. */
export const noCalendar = (w: World): void => { w.calendar = notConnected; };

/** The calls other people asked Art to, and the ones offering times to pick from. */
export const invited = (w: World): void => { w.meetings = [...w.meetings, ...INVITATIONS]; };

/** Signed in to the shared demo account: its calendar is a sample one, and the account can't be deleted. */
export const sharedDemo = (w: World): void => {
  if (w.session) w.session = { ...w.session, sample: true, sharedDemo: true, provider: 'microsoft' };
  w.calendar = { ...connected(w.calendar.events), source: 'sample' };
};

/** Your default AI model is one that isn't in a secure enclave. */
export const unencryptedDefault = (w: World): void => { w.prefs = { ...w.prefs, model: UNENCRYPTED_MODEL }; };

/** The team standup was written by a model that isn't in a secure enclave, and its shared screens were read by one too. */
export const writtenUnencrypted = (w: World): void => {
  w.notes = w.notes.map((n) => (n.id === 'n2'
    ? { ...n, model: UNENCRYPTED_MODEL, unencrypted: [{ model: UNENCRYPTED_MODEL, task: 'notes' as const, at: iso(0, 10, 5) }, { model: UNENCRYPTED_MODEL, task: 'screens' as const, at: iso(0, 10, 4) }] }
    : n));
};

/** The standup's suggested questions are long ones, which wrap to more than one row of chips above the ask bar. */
export const longSuggestions = (w: World): void => {
  w.notes = w.notes.map((n) => (n.id === 'n2'
    ? { ...n, suggestedQuestions: ['What did Priya say about turning the new onboarding on for everyone at once?', 'Which items on the launch checklist are still open, and who is looking at them?', 'Draft a follow-up for support about the help article and the date of the flag'] }
    : n));
};

/** Nothing recorded in the room yet: only calls have notes. */
export const noRoomNotes = (w: World): void => { w.notes = w.notes.filter((n) => n.kind !== 'room'); };

/** Theo sat in on yesterday's design review and said nothing: Search or ask offers him, with no line of his to find. */
export const quietGuest = (w: World): void => {
  w.notes = w.notes.map((n) => (n.id === 'n4'
    ? { ...n, people: [...n.people, THEO], recipients: [...n.recipients, { person: THEO, role: 'invited' as const, at: iso(-1, 11, 45) }] }
    : n));
};

/** Record without a connection is off: this browser remembers that too, so it holds without a connection. */
export const recordsOnlyOnline = (w: World): void => {
  w.prefs = { ...w.prefs, recordOffline: false };
  try {
    const here = localStorage.getItem('alcove.signedIn');
    if (here !== null) localStorage.setItem('alcove.signedIn', JSON.stringify({ ownerId: w.session?.ownerId ?? ME_ID, until: iso(14, 9, 0), recordOffline: false }));
  } catch {
    // Without storage the browser remembers nothing, and the setting alone says so.
  }
};

/** The design sync on its way here from Art's laptop: this browser holds the move's claim, as after opening its link. */
export const moving = (seconds?: number) => (w: World): void => {
  w.move = { ...MOVING, ...(seconds === undefined ? {} : { seconds }) };
  try { sessionStorage.setItem('alcove.move-claim', MOVING.claim); } catch { /* without storage there's no move to pick up */ }
};

/** Recordings on this device that haven't uploaded, one in each state Record shows. */
export const KEPT: readonly KeptSpec[] = [
  { id: 'kept-dock', title: 'Loading dock walkthrough', startedAt: iso(-20, 7, 40), seconds: 26 * 60, problem: 'Recordings can be uploaded for up to 14 days after they start. This one started earlier.' },
  { id: 'kept-shift', title: 'Night shift handover', startedAt: iso(-3, 6, 5), seconds: 14 * 60, unreadable: true },
  { id: 'kept-interview', title: 'Interview: Sam Ortiz', startedAt: iso(-1, 14, 0), seconds: 48 * 60 },
  { id: 'kept-supplier', title: 'Supplier visit', startedAt: iso(0, 9, 40), seconds: 33 * 60, problem: 'This recording starts in the future. Check the clock on this device.' },
  { id: 'kept-floor', title: 'Floor walk with Diego', startedAt: iso(0, 16, 2), seconds: 6 * 60, recording: true }
];
/**
 * They're kept here for the signed-in account, as recording them offline would have left them, and Alcove keeps the one
 * uploading waiting, so none of them finishes while the story is open.
 */
export const keptHere = async (w: World): Promise<void> => {
  w.trouble = { ...w.trouble, 'recordings.start': 'hold' };
  await keepHere(w.session?.ownerId ?? ME_ID, KEPT);
};

/**
 * The standup with a long column beside it: ten more of Art's own notes, three more things in the shared notes, eight
 * more people with the notes and Google Drive connected, so the column is taller than a laptop's window.
 */
export const longSide = (w: World): void => {
  withDriveExports(w);
  const n = w.notes.find((x) => x.id === 'n2');
  if (!n) return;
  const said = [
    'Check the rollout dates with support before Friday.', 'The flag name needs to match the docs.', 'Ask Maya about the pricing page copy.',
    'Kofi’s checklist: the empty state and the error copy.', 'Book a room for the design review.', 'Find last quarter’s onboarding numbers.',
    'Does the help article need screenshots?', 'Write up the beta feedback for Thursday.', 'Send Theo the flag rollout plan.', 'Chase the legal review of the new terms.'
  ];
  w.personal['n2'] = [...(w.personal['n2'] ?? []), ...said.map((text, i): PersonalEntry => ({ id: `n2-long-${i}`, at: iso(0, 9, 34 + i), shared: null, kind: 'note', text }))];
  const at = iso(0, 10, 40);
  n.additions.push(
    { id: 'n2-long-x1', text: 'The pricing page copy is in the shared folder too.', by: MAYA, at, moments: [], removable: true },
    { id: 'n2-long-x2', text: 'Support can start on the article on Monday.', by: LENA, at: iso(0, 11, 5), moments: [], removable: true },
    { id: 'n2-long-x3', text: 'Two of the checklist items are done now.', by: THEO, at: iso(0, 11, 30), moments: [], removable: true }
  );
  const more = [AIKO, LENA, SAM, DIEGO, THEO, NADIA, OMAR, ELENA];
  n.people.push(...more);
  n.recipients.push(...more.map((person) => ({ person, role: 'shared' as const, by: PRIYA, at })));
};

/** The secret of Priya's link to her research readout: made up, 22 letters and digits as a real one is. */
export const READOUT_SECRET = 'VandelayReadout2026Nov';
/**
 * Priya made a link to her research readout, which Art doesn't have yet (`expired`: it ran out a minute ago), and Art
 * opened it here: its secret waits in this tab, as it does while signing in from it. Only Open the notes, once the page
 * has asked, puts the readout in Art's notes, from Priya's link.
 */
export const linkToReadout = (expired = false) => (w: World): void => {
  const n = w.notes.find((x) => x.id === 'n9');
  if (!n) return;
  w.notes = w.notes.filter((x) => x.id !== 'n9');
  const at = new Date().toISOString();
  const expiresAt = new Date(Date.now() + (expired ? -60_000 : NOTE_LINK_DAYS * 86_400_000)).toISOString();
  const art = w.session?.user ?? ART;
  const recipients = [...n.recipients.filter((r) => r.person.email !== art.email), { person: art, role: 'shared' as const, by: PRIYA, link: true as const, at }];
  w.noteLinks = [{ link: { id: 'link-readout', by: PRIYA, at, expiresAt, revocable: false }, noteId: 'n9', secret: READOUT_SECRET, note: { ...n, recipients, received: { role: 'shared', by: PRIYA, link: true, at } } }];
  try { sessionStorage.setItem('alcove.link-after-sign-in', JSON.stringify({ secret: READOUT_SECRET, until: Date.now() + 600_000 })); } catch { /* without storage there's no link to open */ }
};

/** Art has Priya's research readout from her link, and Theo has it from Art's: the note says so, and so does who has it. */
export const fromALink = (w: World): void => {
  const n = w.notes.find((x) => x.id === 'n9');
  if (!n) return;
  const at = iso(-1, 9, 30);
  n.received = { role: 'shared', by: PRIYA, link: true, at };
  n.recipients = [
    ...n.recipients.filter((r) => r.person.email !== ART.email && r.person.email !== THEO.email),
    { person: ART, role: 'shared', by: PRIYA, link: true, at },
    { person: THEO, role: 'shared', by: ART, link: true, at: iso(0, 11, 0) }
  ];
  if (!n.people.some((p) => p.email === THEO.email)) n.people.push(THEO);
};
