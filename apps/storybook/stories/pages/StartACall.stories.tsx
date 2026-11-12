/*
 * Starting a call: one small modal from anywhere, a sheet on a phone. It asks one thing: Start now, or Schedule for later,
 * which goes to the scheduler on the Calls page with whoever was picked (Pages/Scheduling) (user-flows 4).
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { troubled } from './changes';

const meta = { title: 'Pages/Start a call', ...pages } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
type Ctx = Parameters<Play>[0];
/** One step of the way, as a person takes it. */
type Step = (ctx: Ctx) => Promise<void>;
const playing = (...steps: Step[]): Play => async (ctx) => { for (const s of steps) await s(ctx); };
const press = (name: string | RegExp, said: string): Step => async ({ userEvent, step }) => {
  await step(said, async () => {
    await userEvent.click(await screen.findByRole('button', { name }, { timeout: 8000 }));
  });
};

const open: Step = async ({ canvas, userEvent, step }) => {
  await step('Press N, from anywhere: Start a call opens, and asks one thing', async () => {
    await canvas.findByRole('button', { name: /^Start now/ }, { timeout: 8000 });
    await userEvent.keyboard('n');
    await screen.findByRole('dialog', {}, { timeout: 8000 });
  });
};

export const Choice = page('/home', 'busy', { play: playing(open) });
export const ChoicePhone = phone(Choice);
/** On your own: Start now gets a link to send to anyone. */
export const ChoiceOnTheirOwn = page('/home', 'on-their-own', { play: playing(open) });
/** Schedule for later: the modal goes, and the Calls page opens on the scheduler, beside the week. */
export const ScheduleForLater = page('/home', 'busy', { play: playing(open, press(/^Schedule for later/, 'Choose Schedule for later')) });
/** From someone's popover on Team: Schedule opens the scheduler with them in it, and their busy times on the week. */
export const FromTheTeamPage = page('/team', 'busy', {
  play: playing(async ({ canvas, userEvent, step }) => {
    await step('Press Priya’s arch', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: /^Priya Raman$/ }));
    });
  }, press('Schedule', 'Press Schedule. The scheduler opens with Priya in it'))
});
/** The call couldn't be made: the modal stays, and says why. */
export const StartFailed = page('/home', 'busy', { beforeEach: changing(troubled({ 'calls.startNow': 'failed' })), play: playing(open, press(/^Start now/, 'Start now')) });
