/*
 * What page stories change about their scenario's world as they open (`changing()` in src/page.tsx): a part of Alcove
 * that fails or keeps the page waiting, recordings kept on this device, the calendar, the shared demo account, a call on
 * its way here, the calls other people asked Art to, nothing waiting on Art, notes in every state, and a team's
 * licenses. All made up, in the demo world.
 */
import { NOTE_LINK_DAYS, type PersonalEntry } from '@alcove/api';
import { returnTo } from '~/lib/afterSignIn';
import { UNENCRYPTED_MODEL } from '../../src/api/script';
import { attested, type Broken } from '../../src/api/attestation';
import { standIn } from '../../src/api/standin';
import type { Troubles } from '../../src/api/trouble';
import { keepHere, type KeptSpec } from '../../src/api/kept';
import type { World } from '../../src/world';
import { calendarEvent, changer, connected, notConnected, writeNote } from '../../src/world/build';
import { firstDayEvents, ownWeekEvents } from '../../src/world/calls';
import { pricingFollowUp, pricingFollowUpWritten } from '../../src/world/notes';
import { iso } from '../../src/world/clock';
import { INVITATIONS, MOVING } from '../../src/world/invitations';
import { withDriveExports } from '../../src/world/drive-exports';
import { AIKO, ART, DIEGO, ELENA, LENA, MAYA, ME_ID, NADIA, OMAR, PRIYA, SAM, THEO } from '../../src/world/people';
import { planWithTeam } from '../../src/world/teams';
import { LAUNCH, withWorkspaces } from '../../src/world/workspaces';
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
 * The server answers that it doesn't run in confidential compute, as a server run locally does: a story's `beforeEach`,
 * put back when the next story opens. Everywhere still says Confidential compute, with nothing verified.
 */
export const notAttested = (): (() => void) => swap(standIn.trust, 'attestation', async () => ({ tee: 'none' as const, build: { commit: 'storybook' } }));

/**
 * The server is in Confidential Space, but this browser's check of it doesn't pass, one way of each kind: its token is
 * signed under a root that isn't Google's (`another-root`), it's too old (`too-old`), the server could be debugged
 * (`debuggable`), the token names another build than the server reports (`another-build`), or the image isn't in the
 * public log (`unreleased`). Nothing is blocked: everywhere says Confidential compute without · verified, and where the
 * check's details are (Settings › Privacy, the call's shield, pointing at the side panel's check) it says why.
 */
export const checkFails = (why: Broken) => (): (() => void) => swap(standIn.trust, 'attestation', () => attested(why));

/** Signed in with Google without sharing the calendar. */
export const noCalendar = (w: World): void => { w.calendar = notConnected; };

/** Show my other meetings on Home is off (Settings, Google Calendar): Upcoming lists Alcove calls only. */
export const otherMeetingsOff = (w: World): void => { w.prefs = { ...w.prefs, showOtherMeetings: false }; };

/** Show my own events on Home is on (Settings, Google Calendar, or Upcoming's count): events with only Art on them are listed. */
export const ownEventsShown = (w: World): void => { w.prefs = { ...w.prefs, showSoloEvents: true }; };

/** No calls ahead, whatever the calendar holds. */
export const noCallsAhead = (w: World): void => { w.meetings = []; };

/** No calls ahead, and nobody else on anything on the calendar this week: only Art's own time. */
export const onlyOwnEvents = (w: World): void => { w.meetings = []; w.calendar = connected(ownWeekEvents()); };

/** No calls ahead, and nothing on the calendar in the next 7 days. */
export const clearWeek = (w: World): void => { w.meetings = []; w.calendar = connected([]); };

/** Back from Google on the first day, the calendar just connected: the week's meetings with other people on them. */
export const calendarJustConnected = (w: World): void => { w.calendar = connected(firstDayEvents()); };

/** A meeting Art set up on Google Calendar himself, on Google Meet, with Maya and Lena on Friday: one he can move to Alcove. */
export const yourMeeting = (w: World): void => {
  w.calendar = { ...w.calendar, events: [...w.calendar.events, calendarEvent({ id: 'e-pricing-review', title: 'Pricing review', startsAt: iso(2, 14, 0), minutes: 30, guests: [MAYA, LENA], meet: true })] };
};

/** Maya gave Art the pricing draft to send, after the pricing sync: it waits for his answer, from her. */
export const givenByMaya = (w: World): void => {
  const given = { by: changer(MAYA, 'organizer'), at: iso(-1, 16, 10), what: 'reassigned' as const, after: ART.email };
  w.notes = w.notes.map((n) => (n.id === 'n3' ? { ...n, actions: n.actions.map((a) => (a.id === 'n3-a1' ? { ...a, changes: [...a.changes, given] } : a)) } : n));
};

/** Art's first call has just ended: its notes are being written, and they're written a few seconds later. */
export const firstNotesWriting = (w: World): void => {
  w.notes = [writeNote(pricingFollowUp)];
  w.writing = { id: pricingFollowUp.id, seconds: 12, written: pricingFollowUpWritten };
};

/** Every decision settled, and nothing shared with Art this past week. */
const allSettled = (w: World): void => {
  const weeksAgo = iso(-10, 9, 0);
  w.notes = w.notes.map((n) => ({
    ...n,
    decisions: n.decisions.map((d) => (d.state === 'proposed' || d.disputes.length ? { ...d, state: 'confirmed' as const, disputes: [] } : d)),
    ...(n.received ? { received: { ...n.received, at: weeksAgo } } : {})
  }));
};

/** Nothing waiting on Art: every decision settled, every follow-up of his done, and nothing shared with him this past week. */
export const caughtUp = (w: World): void => {
  allSettled(w);
  w.notes = w.notes.map((n) => ({ ...n, actions: n.actions.map((a) => ({ ...a, done: true })) }));
};

/** Nothing for Art to answer, with his follow-ups still open: every decision settled, nothing shared, all of his taken on. */
export const nothingToAnswer = (w: World): void => {
  allSettled(w);
  takenOn(w);
};

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
  returnTo({ to: 'link', secret: READOUT_SECRET });
};

/**
 * The standup with an open question Art added afterwards, through his agent (add_question): nothing said backs it, so its
 * row says he asked it, and so does its history.
 */
export const aQuestionAdded = (w: World): void => {
  const n = w.notes.find((x) => x.id === 'n2');
  if (!n) return;
  n.questions = [...n.questions, {
    id: 'n2-q-added', text: 'Does the help article need a version for teams on the old plan?', state: 'open', lines: [], against: [],
    changes: [{ by: changer(ART, 'organizer'), at: iso(0, 10, 15), what: 'proposed' }], evidence: { moments: [], flags: ['missing'] }
  }];
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

/* ---------- a team (src/world/teams.ts) ---------- */

/** Maya needed a license this morning when none was left, and is waiting for one. */
export const mayaWaits = (w: World): void => {
  if (w.myTeam) w.myTeam.members = w.myTeam.members.map((m) => (m.person === MAYA ? { ...m, wanted: iso(0, 11, 20) } : m));
};
/**
 * Art, the team's admin, whose own license ran out two days ago with none left to take: on Free, waiting with the rest, and
 * told none were left.
 */
export const adminWithoutLicense = (w: World): void => {
  const t = w.myTeam;
  if (!t) return;
  t.unconsumed = [];
  t.members = t.members.map((m) => (m.person === ART ? { ...m, license: { from: iso(-32, 9, 0), until: iso(-2, 9, 0) }, wanted: iso(0, 9, 5) } : m));
  // On Free, what Art stores counts against Art's own storage again, not the team's.
  const free = planWithTeam(w.plan, t, ART.email);
  w.plan = { ...free, storage: { ...free.storage, usedBytes: Math.round(2.1 * 2 ** 30) }, notices: [{ id: 'sb-notice-none', kind: 'licenses-none', at: iso(0, 9, 5), until: null, count: null, workspaceId: null }] };
};
/**
 * Whoever paid for Launch left it this morning, so its payment moved to Art, its longest-standing admin with an account: he
 * pays for it now, and its files count against his storage from a fortnight on, when its grace ends. Said at the top of
 * Settings › Plan, and in a line over the side panel's plan, by the name Art sees it by, which is read from the workspaces
 * he's in: so Launch is put in the world first (the busy afternoon has it only with `withWorkspaces`), or nothing names it.
 */
export const paysForLaunch = (w: World): void => {
  if (!w.workspaces.some((s) => s.id === LAUNCH)) withWorkspaces(w);
  w.plan = { ...w.plan, notices: [{ id: 'sb-notice-paying', kind: 'workspace-payer', at: iso(0, 9, 40), until: iso(15, 9, 40), count: null, workspaceId: LAUNCH }, ...w.plan.notices] };
};
/** Art's team license replaced Pro this morning: the two months that hadn't started went back to Art's balance. */
export const replacedPro = (w: World): void => {
  const at = iso(0, 9, 5);
  w.plan = {
    ...w.plan,
    balance: { microUsd: w.plan.balance.microUsd + 40_000_000, history: [{ id: 'sb-entry-replaced', at, label: 'Refund: 2 months of Pro, for a team license', microUsd: 40_000_000 }, ...w.plan.balance.history] },
    notices: [{ id: 'sb-notice-replaced', kind: 'license-replaced-pro', at, until: null, count: 2, workspaceId: null }]
  };
};
