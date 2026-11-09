/** Camera effects on the real LocalMedia pipeline, with the story browser's drawn room, never a personal camera. */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { atTheDoor, inCall, light, phone, plays } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { REVIEW } from './talk';

const meta = { title: 'Calls/Camera effects', ...pages } satisfies Meta<PageArgs>;
export default meta;

const backgroundWindow = async () => screen.findByRole('dialog', { name: 'Background' }, { timeout: 20_000 });
/** Background's window from the camera's menu: its arrow on a wide screen, or the same menu from More on a phone. */
const openBackground: NonNullable<PageStory['play']> = async ({ canvas, userEvent }) => {
  await canvas.findByRole('toolbar', { name: 'Call controls' }, { timeout: 15_000 });
  // A phone's dock hides the arrows, so it isn't found there.
  const camera = canvas.queryByRole('button', { name: 'Camera and background' });
  if (camera) await userEvent.click(camera);
  else {
    await userEvent.click(await canvas.findByRole('button', { name: 'More: board, workspace, notes, chat, people' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  }
  await userEvent.click(await screen.findByRole('button', { name: /^Background/ }));
};

/** 5.1: preview the effect before joining, large, in Background's window. LocalMedia processes the same synthetic track the call would send. */
export const BeforeJoining = atTheDoor({ scenario: 'call-soon', call: REVIEW }, {
  play: async ({ canvas, userEvent, step }) => {
    await step('Background opens its window, without changing the camera', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Background' }, { timeout: 10_000 }));
    });
    await step('Light blur applies at once, in the big preview', async () => {
      await userEvent.click(await within(await backgroundWindow()).findByRole('button', { name: 'Light blur' }, { timeout: 20_000 }));
    });
  }
});
export const BeforeJoiningPhone = phone(BeforeJoining);
export const BeforeJoiningLight = light(BeforeJoining);

/** 6.29: an in-call effect changes in place. The made-up camera is on, and the original preset and stable solids are real. */
export const InTheCall = inCall({ scenario: 'call-soon', call: REVIEW, you: { cam: true, mic: false } }, {
  play: async (context) => {
    const { userEvent, step } = context;
    await step('The camera’s menu has Background, which closes the menu and opens its window', async () => openBackground(context));
    await step('Choose a solid background without leaving the call', async () => {
      await userEvent.click(await within(await backgroundWindow()).findByRole('button', { name: 'Slate background' }, { timeout: 20_000 }));
    });
  }
});
export const InTheCallPhone = phone(InTheCall);
export const InTheCallLight = light(InTheCall);

/** 6.29: browsing choices with the camera off keeps it off, including a device change. */
export const CameraOff = inCall({ scenario: 'call-soon', call: REVIEW, you: { cam: false, mic: false } }, {
  play: plays(async (context) => {
    const { userEvent, step } = context;
    await step('Choose the next camera background while the camera stays off', async () => {
      await openBackground(context);
      await userEvent.click(await within(await backgroundWindow()).findByRole('button', { name: 'Rose background' }, { timeout: 20_000 }));
    });
  })
});
export const CameraOffPhone = phone(CameraOff);
