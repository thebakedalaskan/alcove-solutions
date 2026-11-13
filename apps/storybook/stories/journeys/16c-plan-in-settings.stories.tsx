/*
 * Your plan in the side panel and in Settings › Plan (docs/product/user-flows.md › 16. Plans and checkout), from the canvas's
 * Side and Settings boards (docs/design/canvas/plans/). Paying happens in checkout, which other journeys of the section
 * play; the server's side (a payment arriving, Pro renewing at the end of its month, Pro ending) is played by the stand-in,
 * and the page picks it up as it does from Alcove: a payment on its way is checked every half minute, the plan every minute.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { current } from '../../src/api/state';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { receiveTopUp, settlePurchase } from '../../src/world/payments';
import { proHasEnded, renewedFromBalance } from '../../src/world/plans';
import { LAPTOP, LATER, SOON } from './play';

const meta = { title: 'Journeys/16 Your plan', ...pages, globals: LAPTOP } satisfies Meta<PageArgs>;
export default meta;

/** Settings › Plan. */
const plan = () => screen.findByRole('region', { name: 'Plan' }, LATER);
/** A row of a panel, by its label. */
const row = (name: string | RegExp) => screen.findByRole('group', { name }, LATER);
/** Long enough for Alcove to check on a payment on its way (every half minute) or read the plan again (every minute). */
const POLL = { timeout: 70_000 };

/** From any page, you at the top right open Settings; the index goes to Plan. */
const toPlan = async (click: (el: Element) => Promise<void>) => {
  await click(await screen.findByRole('link', { name: 'Art Vandelay, settings' }, LATER));
  await click(within(await screen.findByRole('navigation', { name: 'Settings' }, LATER)).getByRole('link', { name: 'Plan' }));
  await plan();
};

export const YourPlanInTheSidePanel: PageStory = {
  name: '16.7 Your plan in the side panel',
  ...page('/home', 'plan-buying-pro'),
  play: async ({ userEvent, step }) => {
    await step('A payment for a year of Pro is on its way. Under the check, the side panel says what it’s waiting for, and its row opens it again', async () => {
      await screen.findByText('Waiting for 192 USDC', {}, LATER);
      await screen.findByRole('button', { name: /^Pro, 12 months/ }, SOON);
    });
    await step('The payment arrives, and Pro is bought from it in the same go. Alcove checks on a payment every half minute: the foot becomes Pro’s own row, its small sun up, and until when', async () => {
      const w = current();
      const t = w.payments.topUps[0];
      if (t) settlePurchase(w, t.id);
      await screen.findByRole('link', { name: /^Pro\s*Until/ }, POLL);
    });
    await step('Click it. Settings opens at your plan: Pro until a year on, and the payment that bought it, with its receipt', async () => {
      await userEvent.click(screen.getByRole('link', { name: /^Pro\s*Until/ }));
      await within(await plan()).findByRole('button', { name: /^Receipt for Pro, 12 months/ }, SOON);
    });
    await step('Click See plans. Plans opens, and in the side panel the row is the place you’re on', async () => {
      await userEvent.click(within(await plan()).getByRole('link', { name: 'See plans' }));
      await screen.findByRole('heading', { name: 'Plans', level: 1 }, SOON);
    });
  }
};

export const RenewRefundAndYourPayments: PageStory = {
  name: '16.8 Renew, refund and your payments',
  ...page('/settings#plan', 'plan-pro'),
  play: async ({ userEvent, step }) => {
    await step('On Pro, Plan says until when, with Extend. Under it: the balance, renewing from it, the months to refund, and every payment', async () => {
      await row('Renew from balance');
      await within(await plan()).findByText('Payments', {}, SOON);
    });
    await step('Turn on Renew from balance. It’s kept, and Saved shows beside it', async () => {
      await userEvent.click(within(await row('Renew from balance')).getByRole('switch', { name: 'Renew from balance' }));
      await within(await row('Renew from balance')).findByText('Saved', {}, SOON);
    });
    await step('Press Refund ($40.00). It asks in place: what goes back to the balance, and when Pro ends then', async () => {
      await userEvent.click(within(await plan()).getByRole('button', { name: 'Refund ($40.00)' }));
      await screen.findByText('Refund 2 months of Pro?', {}, SOON);
    });
    await step('Refund $40.00. The two months go back to the balance, and the refund is first in the payments', async () => {
      await userEvent.click(within(await plan()).getByRole('button', { name: 'Refund $40.00' }));
      await within(await plan()).findByText('Pro refunded, 2 months', {}, SOON);
    });
    await step('Press its Receipt. The receipt opens over the page, as paper, to print', async () => {
      await userEvent.click(within(await plan()).getByRole('button', { name: /^Receipt for Pro refunded, 2 months/ }));
      await screen.findByRole('dialog', { name: 'Receipt' }, SOON);
    });
    await step('Close it', async () => {
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Receipt' }, SOON)).getByRole('button', { name: 'Close' }));
    });
  }
};

export const ProEndingRenewedEnded: PageStory = {
  name: '16.14 Pro ending, renewed, ended',
  ...page('/home', 'plan-pro-ending'),
  play: async ({ userEvent, step }) => {
    const sheet = () => screen.findByRole('dialog', { name: 'Add money' }, SOON);
    await step('Three days before Pro ends, without renewing, the side panel’s small sun is half set: Ends in 3 days · Extend, which opens checkout', async () => {
      await screen.findByRole('button', { name: /Ends in 3 days · Extend/ }, LATER);
    });
    await step('Open Settings at your plan. It says when Pro ends, and Extend is the one filled button', async () => {
      await toPlan((el) => userEvent.click(el));
      await within(await plan()).findByText(/^Ends in 3 days, on/, {}, SOON);
    });
    await step('Turn on Renew from balance instead. $5 doesn’t buy a month, so it says Pro won’t renew', async () => {
      await userEvent.click(within(await row('Renew from balance')).getByRole('switch', { name: 'Renew from balance' }));
      await within(await row('Renew from balance')).findByText(/^Your balance is short of a month/, {}, SOON);
    });
    await step('Add money: $20 in USDC on Base, the network picked under Pay with USDC. Get an address, and send it', async () => {
      await userEvent.click(within(await row('Balance')).getByRole('button', { name: 'Add money' }));
      await userEvent.click(within(await sheet()).getByRole('button', { name: /^Network:/ }));
      await userEvent.click(within(await screen.findByRole('listbox', { name: 'Network' }, SOON)).getByRole('option', { name: 'Base' }));
      await userEvent.click(within(await sheet()).getByRole('button', { name: 'Get an address' }));
      await within(await sheet()).findByText('Waiting for your payment', {}, SOON);
    });
    await step('It arrives. Renewing will keep Pro going now, so the plan says it renews, and the side panel’s sun is up again', async () => {
      const w = current();
      const t = w.payments.topUps[0];
      if (t) receiveTopUp(w, t.id, 'credited');
      await within(await sheet()).findByText('It’s in your balance now.', {}, LATER);
      await userEvent.click(within(await sheet()).getByRole('button', { name: 'Done' }));
      await within(await plan()).findByText(/It renews from your balance before it ends\.$/, {}, LATER);
    });
    await step('At the end of the month a month is bought from the balance. When Alcove next reads your plan, it says so at the top, and the side panel says it under the check', async () => {
      const w = current();
      w.plan = renewedFromBalance(w.plan);
      await within(await plan()).findByText('Pro renewed from your balance, for another month.', {}, POLL);
    });
    await step('Dismiss it. It goes from the side panel too', async () => {
      await userEvent.click(within(await plan()).getByRole('button', { name: 'Dismiss this notice' }));
    });
    await step('A month on, with renewing off, Pro ends. You’re back on Free with nothing deleted, said at the top until you dismiss it, and Get Pro again', async () => {
      await userEvent.click(within(await row('Renew from balance')).getByRole('switch', { name: 'Renew from balance' }));
      const w = current();
      w.plan = proHasEnded({ ...w.plan, pro: { ...w.plan.pro, renew: false } });
      await within(await plan()).findByRole('button', { name: 'Get Pro again' }, POLL);
    });
  }
};
