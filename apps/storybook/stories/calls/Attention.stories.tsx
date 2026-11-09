import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { at, knocks, raisesHand, type CallScript } from '../../src/api/script';
import { MORE, inCall, light, phone, press } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { AIKO, CHECK_IN, DIEGO, KOFI, LAUNCH_REVIEW, MAYA, PRIYA } from './talk';

const meta = { title: 'Calls/Attention', ...pages } satisfies Meta<PageArgs>;
export default meta;
const script: CallScript = {
  here: [{ who: PRIYA, hand: true }, { who: KOFI, hand: true }, { who: AIKO }],
  cues: [
    ...at(.2, { do: 'question', who: PRIYA, text: 'Which teams are included in the first launch?', votes: 4 }),
    ...at(.3, { do: 'question', who: KOFI, text: 'Can the status page go out before the announcement?', votes: 2 }),
    ...at(.4, { do: 'feedback', who: AIKO, kind: 'slow-down' })
  ]
};
const review = (more: Omit<PageStory, 'args'> = {}) => inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script }, more);
const attention = press(/^Attention,/);
const tab = (name: RegExp): NonNullable<PageStory['play']> => async ({ userEvent }) => { await userEvent.click(await screen.findByRole('tab', { name })); };

/** The ordered queue survives when the people are hidden or a document fills the stage. */
export const Hands = review({ play: attention });
export const HandsLight = light(Hands);
export const HandsPhone = phone(Hands);
export const Questions = review({ play: async (c) => { await attention(c); await tab(/^Q&A/)(c); } });
export const QuestionsLight = light(Questions);
export const QuestionsPhone = phone(Questions);
export const PinnedQuestion = review({ play: async (c) => {
  await attention(c); await tab(/^Q&A/)(c);
  const [pin] = await screen.findAllByRole('button', { name: 'Pin question' }); if (pin) await c.userEvent.click(pin);
} });
export const ResolvedQuestion = review({ play: async (c) => {
  await attention(c); await tab(/^Q&A/)(c);
  const [answer] = await screen.findAllByRole('button', { name: 'Mark question answered' }); if (answer) await c.userEvent.click(answer);
  await c.userEvent.click(await screen.findByRole('button', { name: 'Show resolved questions' }));
} });
export const Signals = review({ play: async (c) => { await attention(c); await tab(/^Signals/)(c); } });
export const SignalsPhone = phone(Signals);
export const Waiting = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { ...script, cues: [...script.cues ?? [], ...at(.5, knocks(DIEGO))] } }, { play: async (c) => { await attention(c); await tab(/^Waiting/)(c); } });
export const WaitingPhone = phone(Waiting);
/** A participant can vote and lower their own hand, while host moderation stays with the host. */
export const Participant = inCall({ scenario: 'busy', call: CHECK_IN, script }, { play: async (c) => { await attention(c); await tab(/^Q&A/)(c); } });
export const NoRequests = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { here: [{ who: PRIYA }] } }, { play: attention });
export const ReturningConnection = inCall({ scenario: 'busy', call: LAUNCH_REVIEW, script: { ...script, cues: [...script.cues ?? [], ...at(3, { do: 'reconnect', seconds: 5 }), ...at(4, raisesHand(MAYA))] } }, { play: attention });

export const SoundControls = review({ play: press(MORE, { then: ['Sounds and notifications'] }) });
export const SoundControlsPhone = phone(SoundControls);
