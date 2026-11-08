/*
 * In the call (user-flows 6): who's here, from you alone to the whole company, people coming and going, whoever's
 * speaking in the speak ring, raised hands, your own camera, and someone asking to join. Everyone's camera is off, so people show in their arches;
 * yours is the browser's made-up camera when you turn it on. Around them, the three places: the top bar (what's only yours at
 * its right: View, Board, Workspace, Notes, Chat and who's here), your side, and the dock with More.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { at, chats, reacts, joins, knocks, leaves, line, lowersHand, mutes, raisesHand, says, unmutes } from '../../src/api/script';
import { MORE, clearSide, inCall, light, phone, plays, press, reach } from '../../src/call';
import { pages, type PageArgs } from '../../src/page';
import { iso } from '../../src/world/clock';
import { AIKO, ALL_HANDS, CHECK_IN, DIEGO, EVERYONE, KOFI, KOFI_TALKS, MAYA, ONE_ON_ONE, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK, SAM } from './talk';

const meta = { title: 'Calls/In the call', ...pages } satisfies Meta<PageArgs>;
export default meta;

const REVIEWERS = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];

/** On your own, nobody else is here yet: the link stays to hand. */
export const JustYou = inCall({
  scenario: 'on-their-own',
  call: { id: 'm-alone', title: 'Contract review', startsAt: iso(0, 16, 10), minutes: 30, code: 'ctr-revw-ana', guests: [] }
});
export const JustYouPhone = phone(JustYou);

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
      await step('Open mention goes to the addressed words. Seeing them clears the unread mention', async () => {
        await userEvent.click(await screen.findByRole('button', { name: 'Open mention' }));
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
 * More, above the dock: captions, marking a moment, catching up, breakout rooms (the organizer's), then your devices, video
 * quality, moving to another device and the keyboard's shortcuts. The same on every screen.
 */
export const More = { ...FourOfYou, name: 'More', play: plays(clearSide, press(MORE)) };
/** On a phone the dock is the microphone, the camera, Share, More and Leave, and More starts with a grid of Board, Workspace, Notes, Chat and People, then the hand and Your view. */
export const MorePhone = { ...phone(FourOfYou, 'More, on a phone'), play: press(MORE) };
/** Keyboard shortcuts, from More: the call's keys, and a tile's. */
export const KeyboardShortcuts = { ...FourOfYou, name: 'Keyboard shortcuts', play: press(MORE, { then: ['Keyboard shortcuts'] }) };
/** View, at the top right: the people (Auto, Speaker or Grid), how they sit beside what's shared, where you see yourself, and Reset my view. Only your screen changes. */
export const YourView = { ...FourOfYou, name: 'Your view', play: plays(clearSide, press('Your view')) };
/** On a phone, Your view is in More, and what's open fills the screen, so there's nothing to choose beside it. */
export const YourViewPhone = { ...phone(FourOfYou, 'Your view, on a phone'), play: press(MORE, { then: ['Your view'] }) };

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
