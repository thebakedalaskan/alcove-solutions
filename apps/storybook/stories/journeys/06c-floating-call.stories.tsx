/*
 * The floating call's real entry, then a browser hand-off. Only a person clicking in a top-level document can supply
 * the gesture Document PiP requires, so this journey deliberately stops before requesting a native window. There is
 * no replacement browser API, second session or automated native-window claim here.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { at, chats, knocks, raisesHand } from '../../src/api/script';
import { inCall } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { AIKO, DIEGO, KOFI, PRIYA, REVIEW } from '../calls/talk';
import { LAPTOP, LATER, SOON } from './play';

const meta = { title: 'Journeys/6 Floating call', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

export const OpenFloatingCall: PageStory = {
  name: '6.22 Open a floating call',
  ...inCall({
    scenario: 'call-soon', call: REVIEW,
    script: {
      here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }],
      cues: [...at(30, raisesHand(KOFI)), ...at(33, { do: 'question', who: PRIYA, text: 'Which team reviews the launch checklist?' }), ...at(35, chats(AIKO, 'The launch plan is ready for review.')), ...at(40, knocks(DIEGO))]
    }
  }, { globals: LAPTOP }),
  parameters: {
    docs: {
      description: {
        story: 'Browser hand-off: open this preview as its own tab and click Open floating call. Try the microphone, camera, hand and Leave, then Stay in the call; return, close and reopen the window. The raised hand, question, new chat and waiting person arrive after 30, 33, 35 and 40 seconds. Automatic opening, native close, focus, capture privacy and audio ownership need manual browser verification.'
      }
    }
  },
  play: async ({ userEvent, step }) => {
    await step('Open View in the real call', async () => {
      await screen.findByRole('toolbar', { name: 'Call controls' }, LATER);
      await userEvent.click(await screen.findByRole('button', { name: 'Your view' }, SOON));
    });
    await step('Continue in a top-level browser tab: click Open floating call yourself. The browser decides whether opening is available', async () => {
      await screen.findByRole('button', { name: 'Open floating call' }, SOON);
    });
  }
};
