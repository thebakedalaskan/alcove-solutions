/*
 * The floating call's real entry, then a browser hand-off. Only a person clicking in a top-level document can supply
 * the gesture Document PiP requires, so this journey deliberately stops before requesting a native window. There is
 * no successful replacement window, second session or automated native-window claim here. The refusal journey uses
 * the story browser's explicit blocked state to show recovery without opening a window.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { at, chats, knocks, raisesHand } from '../../src/api/script';
import { MORE, inCall, light, phone } from '../../src/call';
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
        story: 'Automatic opening follows the browser’s native permission, without an Alcove preference. Browser hand-off: open this preview as its own tab and click Open floating call. Try the microphone, camera, hand and Leave, then Stay in the call; return, close and reopen the window. The raised hand, question, new chat and waiting person arrive after 30, 33, 35 and 40 seconds. Verify automatic opening separately in the HTTPS app with a live microphone or camera, browser permission and a real tab switch; the microphone can stay muted. HTTP localhost and scripted Storybook media do not establish native auto eligibility. Native close, focus, capture privacy and audio ownership also need manual browser verification.'
      }
    }
  },
  play: async ({ userEvent, step }) => {
    await step('Open More in the real call', async () => {
      await userEvent.click(await within(await screen.findByRole('toolbar', { name: 'Call controls' }, LATER)).findByRole('button', { name: MORE }, SOON));
    });
    await step('Continue in a top-level browser tab: click Open floating call yourself. The browser decides whether opening is available', async () => {
      await screen.findByRole('button', { name: 'Open floating call' }, SOON);
    });
  }
};

export const OpeningRefused: PageStory = {
  name: '6.22 Keep calling when floating is blocked',
  ...inCall({
    scenario: 'call-soon', call: REVIEW, script: { here: [{ who: PRIYA }, { who: KOFI }], notes: 'off' }, you: { mic: false, cam: false }
  }, { parameters: { opening: { browser: { floatingWindow: 'blocked' } } } }),
  play: async ({ userEvent, step, canvas }) => {
    await step('Open More from the call controls', async () => {
      await screen.findByRole('toolbar', { name: 'Call controls' }, LATER);
      await userEvent.click(await canvas.findByRole('button', { name: MORE }, SOON));
    });
    await step('A blocked opening leaves the call and More available', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Open floating call' }, SOON));
      await within(await screen.findByRole('dialog', { name: 'More' }, SOON)).findByText(/Check this site’s picture-in-picture permission/, {}, SOON);
    });
    await step('Retry only when explicitly pressed; a second refusal keeps the same recovery path', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Open floating call' }, SOON));
    });
  }
};
export const OpeningRefusedLight = light(OpeningRefused);
export const OpeningRefusedPhone = phone(OpeningRefused);
export const OpeningRefusedPhoneLight = light(OpeningRefusedPhone);
