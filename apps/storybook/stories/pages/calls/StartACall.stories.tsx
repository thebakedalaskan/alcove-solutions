/*
 * Starting a call: one small modal from anywhere, a sheet on a phone. It asks one thing: Start now, or Schedule for later,
 * which goes to the scheduler on the Calls page with whoever was picked (Pages/Calls/Scheduling) (user-flows 4).
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { phone } from '../../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { troubled } from '../changes';

const meta = { title: 'Pages/Calls/Start a call', ...pages } satisfies Meta<PageArgs>;
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

/*
 * No notes left this period (docs/product/user-flows.md 16.10): starting or scheduling a call with notes on says so in caution, until
 * the period renews, with Get Pro, and on Start now a way on without notes. A call scheduled after the period renews has notes
 * again, so nothing is said there.
 */
/** Under the ways to start: No notes left until 20 November, with Get Pro and Start without notes. */
export const NoNotesLeft = page('/home', 'plan-stopped', { play: playing(open) });
export const NoNotesLeftPhone = phone(NoNotesLeft);
/* Scheduling for this period says the same under its Notes row, on Calls: Pages/Calls/Scheduling, No notes left. */
