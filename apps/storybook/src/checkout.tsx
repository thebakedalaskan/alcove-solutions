/*
 * Checkout over the real app, for its stories and journeys: the app at an address, as a page story has it, with the app's
 * own checkout window (CheckoutHost) opened over it on what the story says, as a door opens it (Plans' Get Pro, Settings'
 * Extend, the side panel's Open, a call's Add 10 hours). It shares the app's query client, so what it buys shows on the
 * page behind it at once. Closed, it's gone, as in the app; the story's Controls open it again.
 *
 *   const meta = { title: 'Pages/Checkout', ...checkouts } satisfies Meta<CheckoutArgs>;
 *   export const Choose = checkout('/home', 'payments', { plan: 'pro' });
 *   export const Waiting = checkout('/settings#plan', 'plan-waiting', { plan: 'pro', topUpId: PREVIEW_TOP_UP });
 */
import { ThemeProvider, ToastProvider, TooltipProvider } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import type { CheckoutFrom, CheckoutOpen } from '~/features/plans/checkout';
import { CheckoutHost } from '~/features/plans/CheckoutHost';
import { SCENARIO_NAMES } from './api/scenarios';
import { routerAt } from './app';
import type { PageArgs } from './page';

export interface CheckoutArgs extends PageArgs {
  /** What it opens on: Pro, more notes for this period, or Team (starting one, or its admin buying licenses). */
  plan: 'pro' | 'hours' | 'team';
  /** The months of Pro it starts on (Plans' Monthly opens on 1); none: the yearly length when there is one. */
  months?: number | undefined;
  /** The packs of notes it starts on. */
  packs?: number | undefined;
  /** Team's licenses it starts on. */
  licenses?: number | undefined;
  /** Where it's opened from: Done says Back to the call from a call, and Compare plans shows away from Plans. */
  from: CheckoutFrom;
  /** A payment on its way, to open on (the side panel's Open): none opens on choosing, or on one already on its way. */
  topUpId?: string | undefined;
}

const FROM: CheckoutFrom[] = ['plans', 'settings', 'side', 'call', 'door', 'welcome', 'team'];

/** What a door opens checkout on, from the story's args. */
function openFrom(a: CheckoutArgs): CheckoutOpen {
  const what = a.plan === 'pro' ? { plan: 'pro' as const, months: a.months } : a.plan === 'team' ? { plan: 'team' as const, licenses: a.licenses } : { plan: 'hours' as const, packs: a.packs };
  return { what, from: a.from, topUpId: a.topUpId ?? null };
}

/** The app at `path`, with checkout open over it as `open` says, until it's closed. */
function CheckoutOver({ path, open }: { path: string; open: CheckoutOpen }) {
  const [router] = useState(() => routerAt(path));
  const [shown, setShown] = useState<CheckoutOpen | null>(open);
  return (
    <>
      <RouterProvider router={router} />
      <QueryClientProvider client={router.options.context.queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <ToastProvider>
              {shown && <CheckoutHost open={shown} onClose={() => setShown(null)} onCompare={() => { setShown(null); router.history.push('/plans'); }} />}
            </ToastProvider>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </>
  );
}

export const checkouts = {
  render: (a) => <CheckoutOver key={JSON.stringify(a)} path={a.path} open={openFrom(a)} />,
  parameters: { layout: 'fullscreen', page: true },
  argTypes: {
    path: { control: 'text', description: 'Where the app opens, behind checkout' },
    scenario: { control: 'select', options: SCENARIO_NAMES, description: 'The world the stand-in serves' },
    plan: { control: 'inline-radio', options: ['pro', 'hours', 'team'], description: 'What checkout opens on' },
    months: { control: 'number', description: 'The months of Pro it starts on' },
    packs: { control: 'number', description: 'The packs of notes it starts on' },
    from: { control: 'select', options: FROM, description: 'Where it was opened from' },
    topUpId: { control: 'text', description: 'A payment on its way, to open on' }
  }
} satisfies Meta<CheckoutArgs>;

export type CheckoutStory = StoryObj<CheckoutArgs>;

/** A checkout story: the app at `path` on `scenario`, with checkout open over it on `open`, and anything else a story needs. */
export const checkout = (path: string, scenario: PageArgs['scenario'], open: Omit<CheckoutArgs, 'path' | 'scenario' | 'from'> & { from?: CheckoutFrom }, more: Omit<CheckoutStory, 'args'> = {}): CheckoutStory =>
  ({ ...more, args: { path, scenario, from: 'side', ...open } });
