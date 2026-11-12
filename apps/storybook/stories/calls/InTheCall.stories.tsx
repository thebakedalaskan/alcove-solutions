/*
 * In the call (user-flows 6): who's here, from you alone to the whole company, people coming and going, whoever's
 * speaking in the speak ring, raised hands, your own camera, and someone asking to join. Everyone's camera is off, so people show in their arches;
 * yours is the browser's made-up camera when you turn it on. Around them, the three places: the top bar (what's only yours at
 * its right: Board, Workspace, Notes, Chat and who's here), your side, and the dock with More, and Settings from it.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, waitFor, within } from 'storybook/test';
import { tileHintKey } from '~/features/call/layout/view';
import { at, chats, floats, reacts, joins, knocks, leaves, line, lowersHand, mutes, nudges, opensBoard, raisesHand, says, shares, unmutes } from '../../src/api/script';
import { MORE, clearSide, inCall, light, narrow, phone, plays, press, reach, settings } from '../../src/call';
import { talking } from '../../src/browser';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { iso } from '../../src/world/clock';
import { ME_ID } from '../../src/world/people';
import { RETRO } from './boards';
import { notAttested } from '../pages/changes';
import { close, frameOf, openCallBoard, shareATab, tileOf } from './plays';
import { AIKO, ALL_HANDS, CHECK_IN, CHECKLIST, DIEGO, EVERYONE, KOFI, KOFI_TALKS, MAYA, ONE_ON_ONE, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK, SAM } from './talk';

const meta = { title: 'Calls/In the call', ...pages } satisfies Meta<PageArgs>;
export default meta;

const REVIEWERS = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];

/** On your own, nobody else is here yet: the link stays to hand, with × to close it. */
export const JustYou = inCall({
  scenario: 'on-their-own',
  call: { id: 'm-alone', title: 'Contract review', startsAt: iso(0, 16, 10), minutes: 30, code: 'ctr-revw-ana', guests: [] }
});
export const JustYouPhone = phone(JustYou);
/** Closed, it stays closed for the rest of the call, and nothing takes its place: the link is at the foot of People. */
export const JustYouClosed = { ...JustYou, name: 'Just you so far, closed', play: press('Close') };
export const JustYouClosedPhone = { ...phone(JustYouClosed), name: 'Just you so far, closed, on a phone' };

/** A 1:1: Priya comes in a moment after you, and you talk it through. */
export const TwoOfYou = inCall({
  scenario: 'busy', call: ONE_ON_ONE,
  script: { cues: at(1.5, joins(PRIYA)), talk: { from: 4, lines: REVIEW_TALK.filter((l) => l.who === PRIYA || l.who === 'me') }, summary: REVIEW_SUMMARY }
});
export const TwoOfYouPhone = phone(TwoOfYou);

const RELEASE_NOTES = 'The release notes are in the launch folder, for anyone who wants them.';

/**
 * People come and go at Priya's check-in: Aiko comes in, Kofi says he has to drop off and leaves, Maya comes in muted,
 * unmutes to ask what she missed, and Aiko posts in chat (its button in the dock says there's something new). Priya and Maya react to her line, and Aiko adds a thumbs up.
 */
export const ComingAndGoing = inCall({
  scenario: 'busy', call: CHECK_IN,
  script: {
    here: [{ who: KOFI }],
    cues: [
      ...at(2, joins(AIKO)),
      ...at(4, says(KOFI, 'I have to drop off for the next one. The copy comes on Friday.', { hands: { text: 'Send the empty states copy', due: 'Friday' } })),
      ...at(8.5, leaves(KOFI)),
      ...at(11, joins(MAYA, { mic: false })),
      ...at(14, unmutes(MAYA)),
      ...at(14.4, says(MAYA, 'Sorry I’m late. Did I miss the help article?')),
      ...at(19, chats(AIKO, RELEASE_NOTES)),
      ...at(22, reacts(PRIYA, RELEASE_NOTES, 'thumbs-up')),
      ...at(23.5, reacts(MAYA, RELEASE_NOTES, 'heart')),
      ...at(25, reacts(AIKO, RELEASE_NOTES, 'thumbs-up'))
    ]
  }
});
export const ComingAndGoingPhone = phone(ComingAndGoing);
/** Priya, Kofi and Aiko cheer the decision: their emoji float up over the call a few at a time. React, in the dock, sends yours. */
export const Reactions = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: {
    here: REVIEWERS,
    cues: [
      ...at(3, floats(PRIYA, 'heart')), ...at(3.4, floats(KOFI, 'party')), ...at(3.8, floats(AIKO, 'thumbs-up')),
      ...at(6, floats(PRIYA, 'laugh'), floats(AIKO, 'heart')), ...at(6.5, floats(KOFI, 'wow')), ...at(9, floats(AIKO, 'party'), floats(PRIYA, 'smile'))
    ]
  }
});
export const ReactionsPhone = phone(Reactions);
/** Chat in your side, alone: Aiko's message lands (Chat at the top right counts it), then Chat opens on it, and the reactions come in. */
export const Chat = {
  ...ComingAndGoing, name: 'Chat',
  play: plays(async ({ canvas, step }) => {
    await step('Wait for Aiko’s message: Chat at the top right says it’s new', async () => {
      await canvas.findByRole('button', { name: /^Chat, \d+ new$/ }, { timeout: 30000 });
    });
  }, reach('Chat'))
};
export const ChatPhone = { ...phone(Chat), name: 'Chat, on a phone' };

/** The design review, everyone there and talking it through while notes are on: Notes opens beside the stage by itself on a wide screen. */
export const FourOfYou = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, talk: { lines: REVIEW_TALK }, summary: REVIEW_SUMMARY } });
export const FourOfYouPhone = phone(FourOfYou);
/** The shield beside the notes sign: pointing at it says what confidential compute covers in this call, and when this browser verified the hardware. */
export const Shield = {
  ...FourOfYou, name: 'The shield',
  play: plays(clearSide, async ({ canvas, userEvent, step }) => {
    await step('Point at the shield beside the notes sign', async () => {
      await userEvent.hover(await canvas.findByRole('button', { name: /^Confidential compute/ }, { timeout: 10000 }));
    });
  })
};
export const ShieldLight = light(Shield);
/** The server says it doesn't run in confidential compute yet: the shield states the promise, with nothing verified and no caveat. */
export const ShieldNotAttested: PageStory = { ...Shield, name: 'The shield, not attested', beforeEach: [notAttested, ...[Shield.beforeEach ?? []].flat()] };

/** A message addressed to Art is highlighted when Chat opens, and viewing it clears its unread attention. */
export const MentionedInChat = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: REVIEWERS, cues: at(2, chats(AIKO, '@Art Vandelay, can you review the launch checklist?', ['me'])) }
}, {
  play: plays(async ({ canvas }) => { await canvas.findByRole('button', { name: /^Chat, / }, { timeout: 10000 }); }, reach('Chat'))
});
export const MentionedInChatPhone = phone(MentionedInChat);

const LONG_MENTION = `@Art Vandelay ${'The launch checklist has the updated empty states, the welcome copy and the call controls. We can review each screen at the small and wide sizes, then collect the remaining questions in the workspace. '.repeat(16)}`;
/** The addressed words start a long message: opening its end does not mark those words read. */
export const MentionInLongMessage = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: REVIEWERS, cues: at(2, chats(AIKO, LONG_MENTION, ['me'])) }
}, {
  play: plays(
    async ({ canvas, step }) => {
      await step('Aiko mentions you at the start of a long design discussion', async () => {
        await canvas.findByRole('button', { name: /^Chat, / }, { timeout: 10000 });
      });
    },
    reach('Chat'),
    async ({ userEvent, step }) => {
      await step('Open mention, over the conversation, goes to the addressed words. Seeing them clears the unread mention', async () => {
        await userEvent.click(await within(await screen.findByRole('complementary', { name: 'Chat' })).findByRole('button', { name: 'Open mention' }));
      });
    }
  )
});
export const MentionInLongMessagePhone = phone(MentionInLongMessage);

/** A tag, then a host decision: answer the card, then read Chat to restore the normal tab icon. */
export const TabAttentionWithoutNotifications = inCall({
  scenario: 'first-day', call: { id: 'm-attention', title: 'Design review', startsAt: iso(0, 16, 10), minutes: 30, code: 'attn-call-ana', guests: [] },
  script: { here: REVIEWERS, cues: [...at(2, chats(AIKO, '@Art Vandelay, can you review the checklist?', ['me'])), ...at(4, knocks(DIEGO))] }
}, { parameters: { opening: { browser: { notifications: 'denied' } } } });

/** Type @ without leaving the composer: arrows choose someone in this room, Enter inserts their identity. */
export const MentionPicker = {
  ...FourOfYou, name: 'Mention someone in chat',
  play: plays(reach('Chat'), async ({ userEvent }) => {
    await userEvent.type(await screen.findByRole('combobox', { name: 'Message everyone' }), '@');
  })
};
export const MentionPickerPhone = phone(MentionPicker);
export const MentionPickerLight = light(MentionPicker);
export const MentionPickerLightPhone = phone(MentionPickerLight);

/** A selected mention has a chip in the composer as well as its words on the line. */
export const SelectedMention = {
  ...FourOfYou, name: 'A selected chat mention',
  play: plays(reach('Chat'), async ({ userEvent }) => {
    await userEvent.type(await screen.findByRole('combobox', { name: 'Message everyone' }), '@Pri');
    await userEvent.keyboard('{Enter}');
    await userEvent.type(await screen.findByRole('combobox', { name: 'Message everyone' }), 'can you review this?');
  })
};

/**
 * More, above the dock: what you do in a call (captions, marking a moment, catching up, the organizer's breakout rooms), then
 * Open floating call, Move to another device and Settings. The same on every screen.
 */
export const More = { ...FourOfYou, name: 'More', play: plays(clearSide, press(MORE)) };
/** On a phone the dock is the microphone, the camera, Share, More and Leave, and More starts with a grid of Board, Workspace, Notes, Chat and People, then the hand. */
export const MorePhone = { ...phone(FourOfYou, 'More, on a phone'), play: press(MORE) };
/**
 * The stage lays itself out, and there are no modes to choose. Once you've changed it (Priya pinned from her tile, with P),
 * More has a quiet Reset layout, which puts it back, with Undo.
 */
export const ResetLayout = {
  ...FourOfYou, name: 'More, once you’ve changed the layout',
  play: plays(clearSide, async ({ userEvent, step }) => {
    await step('Pin Priya: her tile, then P', async () => {
      (await screen.findByRole('group', { name: /^Priya/ }, { timeout: 10000 })).focus();
      await userEvent.keyboard('p');
    });
  }, press(MORE))
};
export const ResetLayoutPhone = phone(ResetLayout);

/**
 * Settings, from More: one window, its parts down its left. Audio and video comes first: the microphone and its level, the
 * speaker with a test sound, noise reduction, and the camera with what shows behind you, as the dock's arrows have them.
 */
export const Settings = { ...FourOfYou, name: 'Settings', play: settings() };
export const SettingsPhone = phone(Settings);
/** Video quality: the most video you send, and how you see everyone else's cameras. */
export const SettingsVideoQuality = { ...FourOfYou, name: 'Settings, video quality', play: settings('Video quality') };
/**
 * Notifications: the browser's own, while this tab is out of sight (only Turn on asks the browser), how loud the sounds are
 * with one to hear, quiet mode, then what reaches you in a call, each with an Alert and a Sound.
 */
export const SettingsNotifications = { ...FourOfYou, name: 'Settings, notifications', play: settings('Notifications') };
export const SettingsNotificationsPhone = phone(SettingsNotifications);
export const SettingsNotificationsLight = light(SettingsNotifications);
/** Call, the organizer's: locking the call, and pointing at shared screens, for everyone in it. */
export const SettingsCall = { ...FourOfYou, name: 'Settings, the call', play: settings('Call') };
export const SettingsCallPhone = phone(SettingsCall);
/** In Priya's check-in, where you're one of the people, Settings has no Call: it's hers. */
export const SettingsInSomeoneElsesCall = inCall({
  scenario: 'busy', call: CHECK_IN, script: { here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }] }
}, { name: 'Settings, in someone else’s call', play: settings() });

/** The all-hands, six minutes in: twenty-four people, most of them muted, Priya talking, and a hand going up. */
export const Many = inCall({
  scenario: 'lots', call: ALL_HANDS, you: { mic: false },
  script: {
    here: EVERYONE.map((who, i) => ({ who, mic: i % 5 === 0 })), since: 6 * 60,
    earlier: [line(PRIYA, 'Welcome, everyone. Three things today: the launch, hiring, and the new office.')],
    talk: {
      from: 1.5, every: 7,
      lines: [
        line(PRIYA, 'First, the launch. It’s on track for Monday, with ten percent of teams.', { decides: 'The launch goes to ten percent of teams on Monday.' }),
        line(PRIYA, 'Hiring next. Two offers go out this week, and the design role stays open.'),
        line(PRIYA, 'Kofi, do you want to say a word about the design role?'),
        line(PRIYA, 'And the new office opens on the first of December.')
      ]
    },
    // Kofi unmutes to answer, and mutes again; Maya puts her hand up.
    cues: [...at(18.6, unmutes(KOFI)), ...at(18.9, says(KOFI, 'If you know a designer who’d like it here, send them my way.')), ...at(22.4, mutes(KOFI)), ...at(25, raisesHand(MAYA))],
    summary: 'The launch is on track for ten percent of teams on Monday. Two offers go out this week, the design role stays open, and the new office opens on the first of December.'
  }
});
export const ManyPhone = phone(Many);

/** Kofi has the floor: the speak ring follows whoever's talking, and the stage settles on him. */
export const SomeoneSpeaking = inCall({
  scenario: 'call-soon', call: REVIEW, you: { mic: false },
  script: {
    here: REVIEWERS, talk: { from: 1, every: 4, lines: KOFI_TALKS },
    summary: 'Kofi makes the case for the team page’s empty state first: it’s the first page a new team sees. The same component serves every other list, so the notes list and the groups follow.'
  }
});
export const SomeoneSpeakingPhone = phone(SomeoneSpeaking);

/** Aiko has her hand up as you come in, then Maya raises hers; Aiko lowers hers once she's spoken. */
export const HandsRaised = inCall({
  scenario: 'busy', call: { ...ONE_ON_ONE, id: 'm-hands', title: 'Design critique', code: 'dsn-crit-hnd', guests: [PRIYA, KOFI, AIKO, MAYA] },
  script: {
    here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO, hand: true }, { who: MAYA }],
    cues: [...at(3, raisesHand(MAYA)), ...at(6, says(AIKO, 'Could the arch be smaller on a phone? It takes half the screen.')), ...at(11, lowersHand(AIKO))]
  }
});
export const HandsRaisedPhone = phone(HandsRaised);

/** Your camera on: the browser's made-up camera, a dim room. Everyone else's stays off. */
export const YourCameraOn = inCall({ scenario: 'busy', call: ONE_ON_ONE, you: { cam: true }, script: { here: [{ who: PRIYA }] } });

/** Someone asks to join: Diego, signed in, then Sam by name only. Let them in, or not now. */
export const SomeoneAskingToJoin = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: [{ who: PRIYA }, { who: KOFI }], cues: [...at(2, knocks(DIEGO)), ...at(5, knocks(SAM, { byName: true }))] }
});
export const SomeoneAskingToJoinPhone = phone(SomeoneAskingToJoin);
/** People, from the faces at the top right: who's asking to join, Breakout rooms for you, the organizer, who's here and who's invited and not here. */
export const People = {
  ...SomeoneAskingToJoin, name: 'People',
  play: plays(async ({ step }) => {
    await step('Wait for Diego and Sam to ask', async () => { await screen.findByRole('button', { name: /^People in this call\. 2 asking/ }, { timeout: 15000 }); });
  }, reach('People'))
};
export const PeoplePhone = { ...phone(People), name: 'People, on a phone' };

type Play = NonNullable<PageStory['play']>;
/** Opens a tile's ⋯, as a pointer over the tile would. */
const tileMenu = (name: string | RegExp): Play => async ({ canvas, userEvent, step }) => {
  await step('Open the tile’s ⋯', async () => {
    const [more] = await canvas.findAllByRole('button', { name }, { timeout: 15000 });
    if (more) await userEvent.click(more);
  });
};
const YOUR_TILE = /^Options for .+ \(you\)$/;
const KOFIS_TILE = 'Options for Kofi Asante';

/** Your own tile's ⋯: Set a status (Back in 2, 5 or 10 minutes), Pin for me, where you see yourself, and Spotlight for everyone. */
export const YourTileMenu = { ...FourOfYou, name: 'Your tile’s menu', play: plays(clearSide, tileMenu(YOUR_TILE)) };
export const YourTileMenuPhone = { ...phone(FourOfYou, 'Your tile’s menu, on a phone'), play: tileMenu(YOUR_TILE) };
/** Someone else's ⋯: Pin for me, Message privately, Nudge, how loud they are for you, and whoever hosts' Spotlight, Mute and Remove. */
export const TheirTileMenu = { ...FourOfYou, name: 'Someone else’s tile menu', play: plays(clearSide, tileMenu(KOFIS_TILE)) };
/** Nudge Kofi: what only Kofi sees, a step inside the same menu. */
export const NudgeSomeone = {
  ...FourOfYou, name: 'Nudge someone',
  play: plays(clearSide, tileMenu(KOFIS_TILE), async ({ userEvent }) => { await userEvent.click(await screen.findByRole('button', { name: 'Nudge Kofi' }, { timeout: 8000 })); })
};
export const NudgeSomeonePhone = { ...phone(FourOfYou, 'Nudge someone, on a phone'), play: plays(tileMenu(KOFIS_TILE), async ({ userEvent }) => { await userEvent.click(await screen.findByRole('button', { name: 'Nudge Kofi' }, { timeout: 8000 })); }) };
/** Nudges you got: Priya asks you to slow down, then Aiko and Kofi do too, and one note says how many. */
export const NudgesReceived = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: REVIEWERS, cues: [...at(2, nudges(PRIYA, 'slow-down')), ...at(4, nudges(AIKO, 'slow-down')), ...at(5, nudges(KOFI, 'slow-down'))] }
});
/** You talk with your microphone muted: the top of the call says so, with Unmute, from your microphone's level here alone. */
export const TalkingOnMute = inCall({ scenario: 'call-soon', call: REVIEW, you: { mic: false }, script: { here: REVIEWERS } }, {
  play: async ({ canvas }) => { await canvas.findByRole('toolbar', { name: 'Call controls' }, { timeout: 10000 }); talking(true); }
});
/** Someone tells you you're muted: Unmute is right there. */
export const NudgedOnMute = inCall({ scenario: 'call-soon', call: REVIEW, you: { mic: false }, script: { here: REVIEWERS, cues: at(2, nudges(KOFI, 'muted')) } });
/** Statuses, for everyone: Priya is right back at the time on her tile, dimmed while she's away, and Kofi is listening only. */
export const Statuses = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: [{ who: PRIYA, status: { kind: 'away', minutes: 5 } }, { who: KOFI, status: { kind: 'listening' } }, { who: AIKO }] }
});
export const StatusesPhone = phone(Statuses);
/** People, at the top right: hands raised first, in the order they went up, with each status on its row, and Copy link at the foot. */
export const PeopleWithHands = inCall({
  scenario: 'call-soon', call: REVIEW,
  script: { here: [{ who: PRIYA, status: { kind: 'away', minutes: 5 } }, { who: KOFI, hand: true }, { who: AIKO }], cues: at(2, raisesHand(AIKO)) }
}, { name: 'People with hands raised', play: plays(async ({ canvas }) => { await canvas.findAllByRole('button', { name: KOFIS_TILE }, { timeout: 15000 }); }, reach('People')) });
export const PeopleWithHandsPhone = { ...phone(PeopleWithHands), name: 'People with hands raised, on a phone' };
/** Your side takes your theme: People in a light theme, beside the night stage. */
export const PeopleWithHandsLight = light(PeopleWithHands);
/** Find someone: what's typed filters everyone in People, asking to join, in the call, ringing and invited. */
export const FindSomeone = {
  ...SomeoneAskingToJoin, name: 'Find someone in People',
  play: plays(async ({ step }) => {
    await step('Wait for Diego and Sam to ask', async () => { await screen.findByRole('button', { name: /^People in this call\. 2 asking/ }, { timeout: 15000 }); });
  }, reach('People'), async ({ userEvent }) => { await userEvent.type(await screen.findByRole('searchbox', { name: 'Find someone in this call' }, { timeout: 8000 }), 'ko'); })
};
/** Nobody by the name typed. */
export const FindNobody = {
  ...FourOfYou, name: 'Find someone, nobody by that name',
  play: plays(reach('People'), async ({ userEvent }) => { await userEvent.type(await screen.findByRole('searchbox', { name: 'Find someone in this call' }, { timeout: 8000 }), 'zed'); })
};

/* ---------- beside what's open ---------- */

/**
 * Priya shares two seconds in: her screen takes your stage, and the people stand in a column beside it, under the frame's bar.
 * At the top of the column, level with the bar, Hide the people does what ⇧P does.
 */
const SHARING = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, cues: at(2, shares(PRIYA, CHECKLIST)), talk: { from: 4, lines: REVIEW_TALK }, summary: REVIEW_SUMMARY } });
const priyasScreen: Play = async ({ step }) => { await step('Priya shares her screen', async () => { await frameOf('Priya’s screen'); }); };
export const PeopleBesideWhatsOpen = { ...SHARING, name: 'The people beside what’s open', play: plays(clearSide, priyasScreen) };
/** On a phone the people are a row of arches over what's open, always: there's no room to hide them into. */
export const PeopleBesideWhatsOpenPhone = { ...phone(SHARING, 'The people beside what’s open, on a phone'), play: priyasScreen };
/** Hide the people: they wait small on the horizon by the dock, and Show the people, first there, brings them back. */
export const HideThePeople = { ...SHARING, name: 'Hide the people', play: plays(clearSide, priyasScreen, press('Hide the people')) };
/** In a narrow window they're a row of arches over the frame, with Hide the people at its end. */
export const PeopleBesideWhatsOpenNarrow = { ...narrow(SHARING, 'The people beside what’s open, in a narrow window'), play: plays(clearSide, priyasScreen) };
export const HideThePeopleNarrow = { ...narrow(SHARING, 'Hide the people, in a narrow window'), play: plays(clearSide, priyasScreen, press('Hide the people')) };
/** Close says what it does before it's pressed: closed for you, the people fill your stage again, and Priya's tile takes you back. */
export const CloseSaysThePeopleComeBack = {
  ...SHARING, name: 'Close, before it’s pressed',
  play: plays(clearSide, priyasScreen, async ({ userEvent, step }) => {
    await step('Point at Close', async () => { await userEvent.hover(await within(await frameOf('Priya’s screen')).findByRole('button', { name: 'Close Priya’s screen' })); });
  })
};
/** Your own screen's bar: Stop sharing, for everyone, and Close beside it, which only puts it away for you. (Notes are off here.) */
export const YourScreensBar = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, notes: 'off' } }, {
  name: 'Your screen’s bar',
  play: plays(clearSide, async (c) => {
    await c.step('Share a tab', async () => { await shareATab(c); await frameOf('Your screen'); });
  })
});
/**
 * Your own screen has Close as well as Stop sharing: Close puts it away for you while everyone still sees it. It's a tile with
 * the people, who fill your stage again, and the tile brings it back. (Notes are off here, so Share doesn't ask about them.)
 */
export const PutYourScreenAway = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, notes: 'off' } }, {
  name: 'Your screen, put away for you',
  play: plays(clearSide, async (c) => {
    await c.step('Share a tab, then Close on your screen’s bar', async () => {
      await shareATab(c);
      await frameOf('Your screen');
      await close(c, 'Your screen');
      await tileOf('Your screen');
    });
  })
});

/** Forgets that this browser was shown what a tile does, so the first tile pointed at says it again. */
const firstTime = (story: PageStory): PageStory => {
  const b = story.beforeEach;
  const forget = () => { for (const k of [tileHintKey(ME_ID), tileHintKey(null)]) localStorage.removeItem(k); };
  return { ...story, beforeEach: [...(Array.isArray(b) ? b : b ? [b] : []), forget] };
};
/** A tile that can be moved, as a pointer finds one: not whoever Alcove picked to lead, nor your own picture in a corner. */
const movable = () => waitFor(() => {
  const tile = screen.getAllByRole('group').find((el) => el.classList.contains('can-drag') && !el.classList.contains('is-corner'));
  if (!tile) throw new Error('No tile can be moved yet.');
  return tile;
}, { timeout: 10000 });
/** The first time you point at a tile, it says what you can do with one: drag it to move it, and pull its corner to make it bigger. */
export const FirstTimeYouPointAtATile = {
  ...firstTime(FourOfYou), name: 'The first time you point at a tile',
  play: plays(clearSide, async ({ userEvent, step }) => {
    await step('Point at a tile', async () => { await userEvent.hover(await movable()); });
    await step('It says so, once', async () => { await screen.findByText('Drag a tile to move it', {}, { timeout: 8000 }); });
  })
};
/** Beside what's open, a tile in the column moves, and nothing's made bigger there. */
export const FirstTimeYouPointAtATileBesideAShare = {
  ...firstTime(SHARING), name: 'The first time you point at a tile, beside what’s open',
  play: plays(clearSide, priyasScreen, async ({ userEvent, step }) => {
    await step('Point at a tile', async () => { await userEvent.hover(await movable()); });
    await step('It says so, once', async () => { await screen.findByText('Drag a tile to move it', {}, { timeout: 8000 }); });
  })
};

/**
 * Beside a board the people stand in a column: drag someone's tile up or down it, and letting go only puts it there. A press
 * that doesn't move it opens their ⋯, with Go to and Follow on the board.
 */
export const MoveSomeonesTileBesideABoard = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, notes: 'off', talk: { lines: REVIEW_TALK, every: 6 }, board: RETRO, cues: at(1, opensBoard(PRIYA, 'retro')) } }, {
  name: 'Move someone’s tile beside a board',
  play: async (c) => {
    await c.step('Open the board in the call, on your screen', async () => { await openCallBoard(c, 'Design review'); });
    await c.step('Drag Priya’s tile down the column, and let go: it moves there, and nothing opens', async () => {
      const tile = await screen.findByRole('group', { name: /^Priya/ }, { timeout: 10000 });
      const r = tile.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      await c.userEvent.pointer([
        { keys: '[MouseLeft>]', target: tile, coords: { clientX: x, clientY: y } },
        { coords: { clientX: x, clientY: y + 24 } },
        { coords: { clientX: x, clientY: y + r.height + 24 } },
        { keys: '[/MouseLeft]' }
      ]);
    });
  }
});
