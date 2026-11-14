/*
 * The pre-join (/join/<code>): your camera and a level, a picker for each device with Background beside them, the call's
 * name, and what it captures and who gets the notes. The lobby and the waiting are in Calls/Lobby and waiting; these are
 * the pre-join's own states (user-flows 5), the devices' among them.
 */
import type { Meta } from '@storybook/react-vite';
import type { World } from '../../../src/world/world';
import { changing, page, pages, type PageArgs } from '../../../src/page';
import { PRICING_NEXT, ROADMAP } from '../../../src/world/invitations';
import { inEveryState } from '../../../src/world/states';
import { invited, troubled } from '../changes';

const meta = { title: 'Pages/Calls/Join a call', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** Priya set the roadmap review up to join muted. */
const joinsMuted = (w: World): void => { w.meetings = w.meetings.map((m) => (m.code === ROADMAP.code ? { ...m, joinMuted: true } : m)); };
/** This browser remembers a microphone and a camera that aren't plugged in now. */
const choseOthers = (): void => { localStorage.setItem('alcove.devices', JSON.stringify({ mic: 'mic-usb-gone', cam: 'cam-usb-gone' })); };

/** Priya's roadmap review, which Art is invited to: he gets the notes, and Join now. */
export const Invited = page(`/join/${ROADMAP.code}`, 'busy', { beforeEach: changing(invited), globals: { theme: 'dark' } });
/** Signed out at a real organizer’s call: Google can get you the notes, and guest entry is still available. */
export const SignInForNotes = page(`/join/${ROADMAP.code}`, 'signed-out', {
  beforeEach: changing(invited),
  globals: { theme: 'dark' },
  play: async ({ canvas, userEvent, step }) => {
    await step('Open sign-in for the notes', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Sign in to get them' }, { timeout: 8000 }));
      await canvas.findByRole('button', { name: 'Continue with Google' });
    });
  }
});
/** The next pricing sync in Maya's series: From last time, from the notes Art has of it. */
export const FromLastTime = page(`/join/${PRICING_NEXT.code}`, 'busy', { beforeEach: changing(invited, inEveryState), globals: { theme: 'dark' } });
/** Set up to join muted: the microphone and camera start off, and it says so. */
export const JoinsMuted = page(`/join/${ROADMAP.code}`, 'busy', { beforeEach: changing(invited, joinsMuted), globals: { theme: 'dark' } });
/** The browser blocks the microphone and camera: the pickers say so, with how to allow them. Joining still works, with them off. */
export const DevicesBlocked = page(`/join/${ROADMAP.code}`, 'busy', { beforeEach: changing(invited), parameters: { opening: { browser: { devices: 'denied' } } }, globals: { theme: 'dark' } });
/** The microphone and camera chosen before aren't plugged in: Alcove uses others, and a line under each picker says so. */
export const ChoseOthersBefore = page(`/join/${ROADMAP.code}`, 'busy', { beforeEach: changing(invited, choseOthers), globals: { theme: 'dark' } });
/** The browser hasn't been asked yet: it asks when the camera starts. */
export const DevicesNotAllowedYet = page(`/join/${ROADMAP.code}`, 'busy', { beforeEach: changing(invited), parameters: { opening: { browser: { devices: 'prompt' } } }, globals: { theme: 'dark' } });
/** Alcove can't be reached: the call can't open right now, with Try again. */
export const CantOpen = page(`/join/${ROADMAP.code}`, 'busy', {
  beforeEach: changing(invited, troubled({ 'calls.card': 'network' })),
  globals: { theme: 'dark' },
  play: async ({ canvas, step }) => {
    await step('Alcove doesn’t answer. The page tries twice more, then says the call can’t open right now', async () => {
      await canvas.findByText('Can’t open this call right now', {}, { timeout: 10000 });
    });
  }
});
