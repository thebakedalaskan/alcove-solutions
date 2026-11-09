/** Camera effects on the real LocalMedia pipeline, with the story browser's drawn room, never a personal camera. */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { atTheDoor, inCall, light, phone, plays } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { REVIEW } from './talk';

const meta = { title: 'Calls/Camera effects', ...pages } satisfies Meta<PageArgs>;
export default meta;

const options = async () => screen.findByRole('dialog', { name: 'Background' }, { timeout: 20_000 });
/** The dock chevron on a wide screen, or the same settings from More on a phone. */
const openCamera: NonNullable<PageStory['play']> = async ({ canvas, userEvent }) => {
  await canvas.findByRole('toolbar', { name: 'Call controls' }, { timeout: 15_000 });
  const camera = canvas.queryByRole('button', { name: 'Camera and background' });
  if (camera) { await userEvent.click(camera); return; }
  await userEvent.click(await canvas.findByRole('button', { name: 'More: board, workspace, notes, chat, people' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Audio and video settings' }));
};

/** 5.1: preview the effect before joining. LocalMedia processes the same synthetic track the call would send. */
export const BeforeJoining = atTheDoor({ scenario: 'call-soon', call: REVIEW }, {
  play: async ({ canvas, userEvent, step }) => {
    await step('Open backgrounds without changing the camera state', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Background' }, { timeout: 10_000 }));
    });
    await step('Choose blur, then its strength, in the live preview', async () => {
      const dialog = await options();
      await userEvent.click(await within(dialog).findByRole('button', { name: 'Blur' }, { timeout: 20_000 }));
      await userEvent.click(await within(dialog).findByRole('button', { name: 'Mild' }));
    });
  }
});
export const BeforeJoiningPhone = phone(BeforeJoining);
export const BeforeJoiningLight = light(BeforeJoining);

/** 6.29: an in-call effect changes in place. The made-up camera is on, and the original preset and stable solids are real. */
export const InTheCall = inCall({ scenario: 'call-soon', call: REVIEW, you: { cam: true, mic: false } }, {
  play: async (context) => {
    const { userEvent, step } = context;
    await step('Open camera settings during the call', async () => openCamera(context));
    await step('Choose a solid background without leaving the call', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Slate background' }, { timeout: 20_000 }));
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
      await openCamera(context);
      await userEvent.click(await screen.findByRole('button', { name: 'Rose background' }, { timeout: 20_000 }));
    });
  })
});
export const CameraOffPhone = phone(CameraOff);
