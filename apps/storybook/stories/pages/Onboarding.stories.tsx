/*
 * A new account's way in: the account created on screen (an arch draws itself, dawn fills it, the sun rises, and what came
 * with the account arrives a row at a time), then the arch opens into Home, and the tour goes through it (user-flows 1;
 * the design: docs/design/canvas/onboarding). The tour stops at Start now and Schedule, the call Home offers when one is
 * about to start, the example note (or Calls), Search or ask, the Drive, Record, Agents, and back at the start.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { phone } from '../../src/call';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';

const meta = { title: 'Pages/Onboarding', ...pages } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
/** Take the tour, from Settings: Home opens, and the tour goes through it. */
const tour: Play = async ({ canvas, userEvent, step }) => {
  await step('Press Take the tour. Home opens, and the tour goes through it one slide at a time', async () => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Take the tour' }, { timeout: 8000 }));
    await screen.findByRole('dialog', {}, { timeout: 8000 });
  });
};

/** Art's first sign-in: the account is created on screen, in about six seconds. */
export const Arrival = page('/ready', 'first-day');
export const ArrivalPhone = phone(Arrival);
/** A new account that came with a calendar and a team: today's calls and the team arrive as rows too. */
export const ArrivalWithACalendarAndATeam = page('/ready', 'busy');
/** Escape opens Home straight away, and the tour starts, since this browser hasn't seen it. */
export const IntoTheTour = page('/ready', 'first-day', {
  play: async ({ userEvent, step }) => {
    await step('Press Escape. The arch opens into Home, and the tour starts', async () => {
      await screen.findByText(/Signed in as/, {}, { timeout: 8000 });
      await userEvent.keyboard('{Escape}');
      await screen.findByRole('dialog', {}, { timeout: 10000 });
    });
  }
});
/** The tour of Home, taken again from Settings: a card beside what it's about, and the page dimmed around it. Notes for your calls points at Calls. */
export const TheTour = page('/settings', 'busy', { play: tour });
/** Take the tour from your menu, at the top right of every page. */
export const TheTourFromYourMenu = page('/home', 'busy', {
  play: async ({ userEvent, step }) => {
    await step('Click your face, at the top right, then Take the tour. The tour goes through Home', async () => {
      await userEvent.click(await screen.findByRole('button', { name: /^Art Vandelay, your menu/ }, { timeout: 8000 }));
      await userEvent.click(await within(await screen.findByRole('dialog', { name: 'Your menu' }, { timeout: 8000 })).findByRole('button', { name: 'Take the tour' }));
      await screen.findByRole('dialog', { name: 'Start or schedule a call' }, { timeout: 8000 });
    });
  }
});
/** A call about to start: one more stop, at the line on Home that offers it, with Join. */
export const TheTourWithACallAboutToStart = page('/settings', 'call-soon', {
  play: async (ctx) => {
    await tour(ctx);
    await ctx.step('Show me the call. The card moves to the line with Join', async () => {
      await ctx.userEvent.click(await screen.findByRole('button', { name: 'Show me the call' }, { timeout: 8000 }));
      await screen.findByRole('dialog', { name: 'Join a call' }, { timeout: 8000 });
    });
  }
});
export const TheTourPhone = phone(TheTour);
/** The tour's last slide: You're ready. */
export const TheTourEnd = page('/settings', 'busy', {
  play: async (ctx) => {
    await tour(ctx);
    await ctx.step('Go through it with the arrow key, to the last slide', async () => {
      const steps = await screen.findByRole('img', { name: /^Step \d+ of \d+$/ });
      const slides = Number(/of (\d+)$/.exec(steps.getAttribute('aria-label') ?? '')?.[1] ?? 1);
      for (let i = 1; i < slides; i++) {
        await ctx.userEvent.keyboard('{ArrowRight}');
        await screen.findByRole('img', { name: `Step ${i + 1} of ${slides}` });
      }
    });
  }
});
