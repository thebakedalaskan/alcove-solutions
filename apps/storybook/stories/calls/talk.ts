/*
 * What the call stories share: the calls they happen in, what's said in them, what's shared on screen, and what's in the
 * call's workspace. All made up, at Vandelay Industries, by the demo world's people.
 */
import { servedType, type Person } from '@alcove/api';
import type { StoryCall } from '../../src/call';
import { itemId } from '../../src/api/scenarios';
import { current } from '../../src/api/state';
import { filmOf } from '../../src/media/film';
import { line, type Line } from '../../src/api/call/script';
import type { Screen } from '../../src/media/screens';
import { iso } from '../../src/world/clock';
import { AIKO, ART, DIEGO, ELENA, FELIX, INES, KOFI, LENA, MANY, MAYA, NADIA, OMAR, PRIYA, SAM, THEO, TOM, ZARA } from '../../src/world/people';

export { AIKO, ART, DIEGO, ELENA, FELIX, INES, KOFI, LENA, MAYA, NADIA, OMAR, PRIYA, SAM, THEO, TOM, ZARA };

/* ---------- the calls ---------- */

/** Art's design review at 10:30, four minutes away in the `call-soon` scenario: Priya, Kofi and Aiko are invited. */
export const REVIEW = 'dsn-revw-pka';

/** Priya's launch check-in, going on now in the busy afternoon: Art is invited, with Kofi, Aiko and Maya. */
export const CHECK_IN: StoryCall = { id: 'm-check-in', title: 'Launch check-in', startsAt: iso(0, 16, 0), minutes: 45, code: 'lch-chck-prr', organizer: PRIYA, guests: [ART, KOFI, AIKO, MAYA], status: 'live' };

/** A call Art has just started, with Priya and Kofi picked to ring. */
export const STARTED: StoryCall = { id: 'm-started', title: 'Art’s call', startsAt: iso(0, 16, 12), minutes: 30, code: 'art-call-now', guests: [PRIYA, KOFI], instant: true };

/** Art's 1:1 with Priya, now. */
export const ONE_ON_ONE: StoryCall = { id: 'm-one-priya', title: '1:1 with Priya', startsAt: iso(0, 16, 10), minutes: 30, code: 'one-prya-now', guests: [PRIYA] };

/** Kofi's Harbourline prep, which Art isn't invited to: he asks to join. */
export const PREP: StoryCall = { id: 'm-prep', title: 'Harbourline prep', startsAt: iso(0, 16, 0), minutes: 30, code: 'hbr-prep-kfo', organizer: KOFI, guests: [DIEGO, MAYA], status: 'live' };

/** Ines's board prep, which rings Art while he's in another call. */
export const BOARD_PREP: StoryCall = { id: 'm-board-leave', title: 'Board prep', startsAt: iso(0, 16, 10), minutes: 45, code: 'brd-prep-lve', organizer: INES, guests: [ART, PRIYA], status: 'live' };

/** The all-hands, with everyone at Vandelay. */
export const EVERYONE: readonly Person[] = MANY.filter((c) => c.onAlcove).map((c) => c.person).slice(0, 23);
export const ALL_HANDS: StoryCall = { id: 'm-all-hands', title: 'Vandelay all-hands', startsAt: iso(0, 16, 0), minutes: 60, code: 'all-hand-vdl', guests: EVERYONE };

/* ---------- what's said ---------- */

/** The design review: the empty states, then pricing. Kofi takes the copy, Aiko the arch, you tell Lena. */
export const REVIEW_TALK: readonly Line[] = [
  line(PRIYA, 'Shall we start with the empty states? They’re the last thing blocking the launch.'),
  line(KOFI, 'The team page is the worst of them. Right now it’s just a blank column.'),
  line('me', 'Then let’s give it one line and the empty arch, like the notes list.'),
  line(AIKO, 'That works for us. It’s one component, so every list gets it for free.'),
  line(PRIYA, 'Agreed. Every empty list gets one line and the empty arch.', { decides: 'Every empty list gets one line and the empty arch.' }),
  line(KOFI, 'I’ll write the copy for each of them by Friday.', { hands: { text: 'Write the copy for each empty state', due: 'Friday' } }),
  line(AIKO, 'And I’ll move the arch into the kit, so the team page can use it.', { hands: { text: 'Move the empty arch into the kit', due: 'Thursday' } }),
  line('me', 'Good. Next is the pricing page. Priya, where did we get to?'),
  line(PRIYA, 'Lena’s copy is in. We still have to choose whether yearly or monthly comes first.'),
  line(KOFI, 'Yearly first. Most of the teams we talked to pay yearly.'),
  line(PRIYA, 'Let’s lead with yearly, and look at it again after launch.', { decides: 'The pricing page leads with yearly prices.' }),
  line('me', 'I’ll tell Lena today.', { hands: { text: 'Tell Lena the pricing page leads with yearly', owner: 'me', due: 'Today' } }),
  line(AIKO, 'One more thing: the flag goes on for everyone on Monday, not Friday.'),
  line(PRIYA, 'Then Friday is for the copy, and Monday for the flag.', { decides: 'The flag goes on for everyone on Monday.' })
];
export const REVIEW_SUMMARY = 'The empty states are the last thing blocking the launch. Every empty list gets one line and the empty arch: Kofi writes the copy by Friday, and Aiko moves the arch into the kit. The pricing page leads with yearly prices, and Art tells Lena today. The flag goes on for everyone on Monday.';

/** Priya's launch check-in, down the checklist. */
export const CHECK_IN_TALK: readonly Line[] = [
  line(PRIYA, 'Thanks, everyone. Let’s go down the launch checklist.'),
  line(MAYA, 'The help article for support is done. It went to the team this morning.'),
  line(KOFI, 'The empty states are designed. The copy comes on Friday.'),
  line(PRIYA, 'Art, how’s the rollout plan looking?'),
  line('me', 'The flag goes on for ten percent on Monday, then for everyone a week later.', { decides: 'The flag goes on for ten percent on Monday, and for everyone a week later.' }),
  line(MAYA, 'Support needs a day’s notice before each step.'),
  line(PRIYA, 'Art, can you send support the dates?', { hands: { text: 'Send support the rollout dates', owner: 'me', due: 'Tomorrow' } }),
  line(AIKO, 'The last two bugs are fixed. The release goes out tonight.'),
  line(PRIYA, 'Then we’re ready. Same time next week.')
];
export const CHECK_IN_SUMMARY = 'The help article for support is out, and the empty states are designed, with their copy on Friday. The flag goes on for ten percent of teams on Monday and for everyone a week later, and Art sends support the dates. The last two bugs are fixed, so the launch is ready.';

/** Kofi, at length: why the team page needs its empty state first. */
export const KOFI_TALKS: readonly Line[] = [
  line(KOFI, 'Here’s why I’d do the team page first. It’s the first page a new team sees.'),
  line(KOFI, 'Right now a new team sees a blank column and nothing to press.'),
  line(KOFI, 'With one line and the arch, they know who’s missing and how to ask them.'),
  line(KOFI, 'And it’s the same component everywhere, so the other lists come almost for free.'),
  line(KOFI, 'The copy is the only real work. I can have it by Friday.', { hands: { text: 'Write the copy for the team page’s empty state', due: 'Friday' } }),
  line(PRIYA, 'That makes sense to me.'),
  line(KOFI, 'Great. Then the notes list next, and the groups last.', { decides: 'The team page gets its empty state first, then the notes list, then the groups.' })
];

/* ---------- what's shared ---------- */

/** Priya's deck: the launch checklist. */
export const CHECKLIST: Screen = {
  title: 'Launch checklist', accent: '#215DB3',
  pages: [
    { heading: 'Launch checklist', lines: ['Help article for support', 'Empty state on the team page', 'Flag in the rollout plan', 'Pricing page copy'] },
    { heading: 'Rollout', lines: ['Monday: ten percent of teams', 'A week later: everyone', 'Support hears a day before each step'] },
    { heading: 'Still open', lines: ['Yearly or monthly first on the pricing page', 'Who answers the first week’s tickets'] }
  ]
};
/** Kofi's empty states, as a document. */
export const EMPTY_STATES: Screen = {
  title: 'Empty states · Design', kind: 'doc', accent: '#9C4A86',
  pages: [
    { heading: 'Empty states', lines: ['Every list gets one line and the empty arch.', 'The line says what will be here, and how it gets here.', 'No pictures of people: the arch stands in for them.'] },
    { heading: 'Team page', lines: ['“Nobody from your team is on Alcove yet.”', 'Invite them from here, or share a link.'] }
  ]
};
/** Aiko's release notes. */
export const RELEASE: Screen = {
  title: 'Release 4.12', accent: '#B4652A',
  pages: [{ heading: 'Release 4.12', lines: ['The empty arch, in the kit', 'Two fixes to the team page', 'Faster notes on long calls'] }]
};

/* ---------- the call's workspace ---------- */

/** Art's launch review, going on now: Product was chosen as its home when he scheduled it, so the call's folder goes there. */
export const LAUNCH_REVIEW: StoryCall = {
  id: 'm-launch-review', title: 'Launch review', startsAt: iso(0, 16, 10), minutes: 45, code: 'lch-revw-art', guests: [PRIYA, KOFI, AIKO], workspaceId: 'ws-product'
};
/** Product's documents, by their IDs. */
export const PLAN = itemId('Launch plan');
export const CHECKLIST_DOC = itemId('Launch checklist');
export const WALKTHROUGH = itemId('Onboarding walkthrough');
/** The walkthrough's film, by the ID its block names it by. */
export const FILM = 'film-onboarding';

/**
 * Aiko's onboarding walkthrough, put in Product for the story: a line, and a six-second film of the new onboarding,
 * drawn and recorded in this browser the first time it's played.
 */
export function addWalkthrough(): void {
  const w = current();
  const space = w.workspaces.find((s) => s.id === 'ws-product');
  if (!space || space.items.some((i) => i.id === WALKTHROUGH)) return;
  const at = iso(0, 15, 40);
  space.items.push({
    id: WALKTHROUGH, kind: 'document', name: 'Onboarding walkthrough', parent: null, by: AIKO.portrait ? { name: AIKO.name, portrait: AIKO.portrait } : null,
    createdAt: at, editedAt: at, trashedAt: null, trashedBy: null, restricted: false, role: 'edit', call: null
  });
  w.pages[WALKTHROUGH] = {
    blocks: [
      { type: 'line', content: [{ type: 'text', text: 'The new onboarding, from signing in to the first call. Six seconds, no sound.' }] },
      { type: 'video', attrs: { media: FILM, title: 'Onboarding, start to first call', dur: 6, width: 960, height: 540 } }
    ]
  };
  w.media.unshift({
    workspace: 'ws-product',
    media: { id: FILM, name: 'onboarding.webm', type: servedType('video/webm'), size: 1_200_000, width: 960, height: 540, createdAt: at, documents: [WALKTHROUGH] },
    body: filmOf({ title: 'Onboarding', steps: ['Sign in with Google', 'Name your team', 'Invite three people', 'Start your first call'], accent: '#9C4A86' })
  });
}
