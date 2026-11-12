/*
 * Plans: the last of the sunset, with the plans on the water under it (user-flows 16, the canvas's Plans board). Free and Pro
 * side by side, their rows lined up, priced for a year (Yearly · 20% off, the default) or month by month; Pro lifted with a
 * warm edge, its button the page's one filled button on Free and while Pro is ending. Get Pro and Extend open checkout over
 * the page. The prices wait in place while they're on their way, and say so when they don't come.
 */
import type { Meta } from '@storybook/react-vite';
import { setOnline } from '../../src/browser';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { troubled } from './changes';

const meta = { title: 'Pages/Plans', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** The same story at night. */
const night = (story: PageStory): PageStory => ({ ...story, globals: { ...story.globals, theme: 'dark' } });

/** Monthly, on the sky: each plan's price a month at a time, and what a year or more costs instead. */
const monthByMonth: NonNullable<PageStory['play']> = async ({ canvas, userEvent, step }) => {
  await step('Press Monthly, on the sky', async () => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Monthly' }, { timeout: 8000 }));
  });
};

/* ------------------------------------------------------------------ Free */
/** Art on Free, as Plans opens: priced for a year, Free's button area says it's his plan, and Get Pro is the one filled button. */
export const Free = page('/plans', 'busy');
export const FreeNight = night(Free);
export const FreePhone = phone(Free);
export const FreePhoneNight = night(phone(Free));
/** Month by month: Pro's $20 a month, for as many months as you choose, or $16 for a year or more. */
export const FreeMonthly = page('/plans', 'busy', { play: monthByMonth });
export const FreeMonthlyNight = night(FreeMonthly);
export const FreeMonthlyPhone = phone(FreeMonthly);

/* ------------------------------------------------------------------ Pro */
/** On Pro: Pro says it's your plan, Extend is a second choice, and Free is where you're back to if a plan ends. Nothing is filled. */
export const Pro = page('/plans', 'plan-pro');
export const ProNight = night(Pro);
export const ProPhone = phone(Pro);
/** Pro ends in 3 days and won't renew: it says so beside its name, and Extend is the one filled button. */
export const ProEnding = page('/plans', 'plan-pro-ending');
export const ProEndingNight = night(ProEnding);
export const ProEndingPhone = phone(ProEnding);

/* ------------------------------------------------------------------ on their way, or not */
/** The prices are on their way: the cards wait in place, their names and who they're for already there. */
export const Loading = page('/plans', 'busy', { beforeEach: changing(troubled({ 'plans.offers': 'hold' })) });
export const LoadingNight = night(Loading);
export const LoadingPhone = phone(Loading);
/** The offers didn't load: why, where the plans would be, and Try again. */
export const OffersFailed = page('/plans', 'busy', { beforeEach: changing(troubled({ 'plans.offers': 'failed' })) });
export const OffersFailedNight = night(OffersFailed);
export const OffersFailedPhone = phone(OffersFailed);
/** The connection went before the prices came: they show when it's back. */
export const OfflineBeforeTheyLoaded = page('/plans', 'busy', {
  beforeEach: changing(troubled({ 'plans.offers': 'hold' })),
  play: async ({ canvas, step }) => {
    await step('The connection drops while the prices are on their way', async () => {
      await canvas.findByRole('article', { name: 'Pro' }, { timeout: 8000 });
      setOnline(false);
    });
  }
});
