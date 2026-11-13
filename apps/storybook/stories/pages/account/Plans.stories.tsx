/*
 * Plans: the last of the sunset, with the plans on the water under it (user-flows 16, the canvas's Plans board). Free, Pro and
 * Team side by side, their rows lined up, priced for a year (Yearly · 20% off, the default) or month by month; Pro lifted with a
 * warm edge, its button the page's one filled button on Free and while Pro is ending. Team is licenses, $32 a person a month for
 * a year or $40 a month at a time: Start a team off one, Buy licenses for its admin, and who buys them for a member; while a
 * team license is yours, Pro isn't sold, and says so. Get Pro, Extend, Start a team and Buy licenses open checkout over the
 * page, on a year when Yearly is chosen. The prices wait in place while
 * they're on their way, and say so when they don't come. The plan choice (16.20) is Plans opened by itself once, in Home's
 * place: a head of its own, and the plan you're on leads straight on.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, waitFor, within } from 'storybook/test';
import { setOnline } from '../../../src/browser';
import { phone } from '../../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../../src/page';
import { noTeamYear, paymentsOff } from '../../../src/world/plans/payments';
import { carriedOverInGrace } from '../../../src/world/plans/plans';
import { troubled } from '../changes';

const meta = { title: 'Pages/Account/Plans', ...pages } satisfies Meta<PageArgs>;
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
/**
 * Art on Free, as Plans opens: priced for a year, Free's button area says it's Art's plan, and Get Pro is the one filled button.
 * Team is $32 a person a month, $384 a person for 12 months.
 */
export const Free = page('/plans', 'busy');
export const FreeNight = night(Free);
export const FreePhone = phone(Free);
export const FreePhoneNight = night(phone(Free));
/**
 * Month by month: Pro's $20 a month, for as many months as you choose, or $16 for a year or more; Team's $40 a person, each
 * license one person for 30 days, or $32 a month for a year.
 */
export const FreeMonthly = page('/plans', 'busy', { play: monthByMonth });
export const FreeMonthlyNight = night(FreeMonthly);
export const FreeMonthlyPhone = phone(FreeMonthly);

/* ------------------------------------------------------------------ Pro */
/** On Pro: Pro says it's your plan, Extend is a second choice, and Free is where you're back to if a plan ends. Nothing is filled. */
export const Pro = page('/plans', 'plan-pro');
export const ProNight = night(Pro);
export const ProPhone = phone(Pro);
/** Pro ends in 6 days and won't renew: it says so beside its name, and Extend is the one filled button. */
export const ProEnding = page('/plans', 'plan-pro-ending');
export const ProEndingNight = night(ProEnding);
export const ProEndingPhone = phone(ProEnding);

/* ------------------------------------------------------------------ Team */
/*
 * Team is licenses, a person for a period at a time or for a year at the lower price, as the sky says, with the people at the end
 * of its name's row: off a team (every story above), the people at Vandelay on Alcove and Start a team.
 */
/** Start a team, on Team's card, on Yearly: checkout opens over Plans on starting one, with licenses for a year. */
export const StartATeam = page('/plans', 'payments', {
  play: async ({ canvas, userEvent, step }) => {
    await step('Press Start a team, on Team’s card', async () => {
      await userEvent.click(await canvas.findByRole('button', { name: 'Start a team' }, { timeout: 8000 }));
    });
  }
});
export const StartATeamNight = night(StartATeam);
/** Monthly, then Start a team: checkout opens on licenses a period at a time, $40 each. */
export const StartATeamMonthly = page('/plans', 'payments', {
  play: async (context) => {
    await monthByMonth(context);
    await context.step('Press Start a team, on Team’s card', async () => {
      await context.userEvent.click(await context.canvas.findByRole('button', { name: 'Start a team' }, { timeout: 8000 }));
    });
  }
});
/**
 * Back from signing in with the welcome page's Start a team (`/plans?checkout=team`): checkout is open over Plans on starting
 * one as the page opens, and the address forgets it.
 */
export const StartATeamFromTheWelcomePage = page('/plans?checkout=team', 'payments');
export const StartATeamFromTheWelcomePagePhone = phone(StartATeamFromTheWelcomePage);
/**
 * Vandelay's admin, licensed: Team is Art's plan, with Buy licenses. Pro isn't sold while the license lasts, and its card says so
 * where Get Pro would be. Nothing is filled.
 */
export const TeamAdmin = page('/plans', 'team-admin');
export const TeamAdminNight = night(TeamAdmin);
export const TeamAdminPhone = phone(TeamAdmin);
/** Month by month, as Vandelay's admin: $40 a person, or $32 a month for a year. */
export const TeamAdminMonthly = page('/plans', 'team-admin', { play: monthByMonth });
/**
 * No license for a year on offer (as it ships at first): Team is $40 a person on Yearly too, with nothing about a year, while Pro
 * keeps its yearly price; Start a team opens checkout on a period's licenses.
 */
export const TeamYearOff = page('/plans', 'payments', { beforeEach: changing(noTeamYear) });
export const TeamYearOffNight = night(TeamYearOff);
/** On Priya's team, licensed: Team is Art's plan, Priya buys its licenses, and Pro says not while Art is on the team's plan. */
export const TeamMember = page('/plans', 'team-member');
export const TeamMemberNight = night(TeamMember);
export const TeamMemberPhone = phone(TeamMember);
/** On Priya's team with no license to take: Art is on Free meanwhile, so Team isn't Art's plan yet, and Priya buys its licenses. */
export const TeamMemberWithoutALicense = page('/plans', 'team-member-unlicensed');

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

/* ------------------------------------------------------------------ the plan choice */
/*
 * Plans opened by itself once, in Home's place, while the plans haven't been shown to the account (user-flows 16.20): its head
 * a short title and one line, the plan you're on leading straight on, and checkout over it for the rest. Every story opens
 * Home, as the app does.
 */
/** A plan's card on the page, by its name. */
const card = (name: string) => screen.findByRole('article', { name }, { timeout: 8000 });
/** What the checkout window says, once it says it. */
const windowSays = async (text: string | RegExp, timeout = 8000) => within(await screen.findByRole('dialog', {}, { timeout: 8000 })).findByText(text, {}, { timeout });

/** A new account: Choose a plan, what every plan has and what they differ in. Continue on Free leads on; Get Pro is the one filled button. */
export const PlanChoice = page('/home', 'plan-choice');
export const PlanChoiceNight = night(PlanChoice);
export const PlanChoicePhone = phone(PlanChoice);
export const PlanChoicePhoneNight = night(phone(PlanChoice));
/** Month by month, on the plan choice's sky too. */
export const PlanChoiceMonthly = page('/home', 'plan-choice', { play: monthByMonth });
/** An account from before plans: Alcove has plans now, and Art is on Free, with what it brings in the server's numbers. */
export const PlanChoiceFromBeforePlans = page('/home', 'plan-choice-before');
export const PlanChoiceFromBeforePlansNight = night(PlanChoiceFromBeforePlans);
export const PlanChoiceFromBeforePlansPhone = phone(PlanChoiceFromBeforePlans);
/** From before plans, over Free's storage as they began: everything works as before until the grace ends, and it says when. */
export const PlanChoiceInGrace = page('/home', 'plan-choice-before', { beforeEach: changing((w) => { w.plan = carriedOverInGrace(); }) });
/** On a team license from before plans: Team is Art's plan and leads on, and Pro isn't sold while the license lasts. */
export const PlanChoiceOnATeam = page('/home', 'team-member', { beforeEach: changing((w) => { w.plan = { ...w.plan, choose: true }; }) });
export const PlanChoiceOnATeamPhone = phone(PlanChoiceOnATeam);

/** Pro bought from the plan choice: checkout over it, a year paid with USDC on Base, and Done. Pressing Done goes on to Home. */
export const PlanChoiceProBought = page('/home', 'plan-choice', {
  play: async ({ userEvent, step }) => {
    await step('Press Get Pro, on Pro’s card', async () => {
      await userEvent.click(await within(await card('Pro')).findByRole('button', { name: 'Get Pro' }, { timeout: 8000 }));
    });
    await step('Choose Base, and get the address', async () => {
      await userEvent.click(within(await screen.findByRole('radiogroup', { name: 'Pay with USDC on' }, { timeout: 8000 })).getByRole('radio', { name: /^Base/ }));
      await userEvent.click(within(await screen.findByRole('dialog', {}, { timeout: 8000 })).getByRole('button', { name: 'Get the address' }));
    });
    await step('The payment arrives, and Pro is bought with it', async () => {
      await windowSays('You’re on Pro', 30000);
    });
  }
});
/** Payments off: Get Pro opens checkout, which says paying with USDC isn't available right now. Close, and the plans are still there. */
export const PlanChoicePaymentsOff = page('/home', 'plan-choice', {
  beforeEach: changing((w) => { w.payments = paymentsOff(); }),
  play: async ({ userEvent, step }) => {
    await step('Press Get Pro, on Pro’s card', async () => {
      await userEvent.click(await within(await card('Pro')).findByRole('button', { name: 'Get Pro' }, { timeout: 8000 }));
      await windowSays('Paying with USDC isn’t available right now. Try again later.');
    });
  }
});

/** A place in the frame by its name, as it's on screen: the side panel's row, or the tab bar's on a phone. */
const place = (name: string) => waitFor(() => {
  const link = screen.queryAllByRole('link', { name: new RegExp(`^${name}`) }).find((l) => l.getClientRects().length > 0 && !l.closest('[inert]'));
  if (!link) throw new Error(`${name} isn’t in the frame yet.`);
  return link;
}, { timeout: 8000 });

/**
 * Telling the server the plans were seen fails, quietly, and is tried again in the background. Continue on Free, then Calls and
 * back to Home: Home is Home, since the plans were seen in this tab. A later visit shows them again.
 */
export const PlanChoiceNotMarkedSeen = page('/home', 'plan-choice', {
  beforeEach: changing(troubled({ 'plans.chose': 'failed' })),
  play: async ({ userEvent, step }) => {
    await step('Continue on Free, on Free’s card: Home opens', async () => {
      await userEvent.click(await within(await card('Free')).findByRole('button', { name: 'Continue on Free' }, { timeout: 8000 }));
      await screen.findByRole('region', { name: 'Start your first call' }, { timeout: 8000 });
    });
    await step('Calls, then Home again, from the side panel (the tab bar on a phone): still Home', async () => {
      await userEvent.click(await place('Calls'));
      await screen.findByRole('heading', { name: 'Calls', level: 1 }, { timeout: 8000 });
      await userEvent.click(await place('Home'));
      await screen.findByRole('region', { name: 'Start your first call' }, { timeout: 8000 });
    });
  }
});

/** The prices on their way: the cards wait in place, and Free's already leads on. */
export const PlanChoiceLoading = page('/home', 'plan-choice', { beforeEach: changing(troubled({ 'plans.offers': 'hold' })) });
export const PlanChoiceLoadingNight = night(PlanChoiceLoading);
export const PlanChoiceLoadingPhone = phone(PlanChoiceLoading);
/** The offers didn't load: Try again, with Continue on Free beside it. */
export const PlanChoiceOffersFailed = page('/home', 'plan-choice', { beforeEach: changing(troubled({ 'plans.offers': 'failed' })) });
/** The connection went before the prices came: they show once it's back, and Continue on Free still leads on. */
export const PlanChoiceOffline = page('/home', 'plan-choice', {
  beforeEach: changing(troubled({ 'plans.offers': 'hold' })),
  play: async ({ step }) => {
    await step('The connection drops while the prices are on their way', async () => {
      await card('Pro');
      setOnline(false);
    });
  }
});
export const PlanChoiceOfflineNight = night(PlanChoiceOffline);
export const PlanChoiceOfflinePhone = phone(PlanChoiceOffline);
