/*
 * Checkout, opened from anywhere (docs/design/pages.md › Checkout): the Plans page, Settings ›
 * Plan, the side panel's foot, a call's banner, a door. It is one window over wherever you are, so the call goes on behind
 * it. This file is who can open it and what with; the window itself is CheckoutHost.tsx, rendered by the provider at the
 * app's root.
 */
import { ThemeScope, useTheme } from '@alcove/ui';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** What checkout opens on: Pro (to start, or to extend when on Pro), with the months to begin on; or more notes for this period. */
export type CheckoutFor = { plan: 'pro'; months?: number | undefined } | { plan: 'hours'; packs?: number | undefined }
  /**
   * Team: starting one (its name, then its first licenses) when you're on none, or its admin buying more. `yearly`: licenses
   * for a year to begin on, as Plans' Yearly opens it; otherwise a period at a time.
   */
  | { plan: 'team'; licenses?: number | undefined; yearly?: boolean | undefined };
/** Where it was opened from: Done says "Back to the call" from a call, and Compare plans shows away from Plans. */
export type CheckoutFrom = 'plans' | 'settings' | 'side' | 'call' | 'door' | 'welcome' | 'team';
/** What's open: a fresh checkout, or one on a payment already on its way (`topUpId`), reopened from its row. */
export interface CheckoutOpen { what: CheckoutFor; from: CheckoutFrom; topUpId: string | null }

export interface CheckoutControls {
  /**
   * Opens checkout on `what`. A payment for it already on its way opens instead of a new one. `back` is where closing it goes
   * back to, when it was opened from a window that can't stay open under it (only one window shows at a time), such as Start
   * a call: that window opens again, as it was, once checkout closes. Leaving it for Plans (Compare plans) doesn't go back.
   */
  open: (what: CheckoutFor, from: CheckoutFrom, back?: (() => void) | undefined) => void;
  /** Opens checkout on a payment already on its way. */
  reopen: (topUpId: string, what: CheckoutFor, from: CheckoutFrom) => void;
  close: () => void;
  /** What's open now, or null. */
  current: CheckoutOpen | null;
}

const NONE: CheckoutControls = { open: () => undefined, reopen: () => undefined, close: () => undefined, current: null };
const CheckoutContext = createContext<CheckoutControls>(NONE);

/** Opens and closes checkout. Outside the provider (a lone story) it does nothing. */
export function useCheckout(): CheckoutControls {
  return useContext(CheckoutContext);
}

/**
 * Holds what checkout is open on, for every page beneath it. `window` draws it (CheckoutHost.tsx), given what's open, how to
 * close it (back to the window it was opened from, if any) and how to leave it for another page (not back). Each opening is
 * a window of its own, from its first step, even over one already open. It's in your own theme wherever it opens: over a
 * call, which keeps the whole page night, too.
 */
export function CheckoutProvider({ children, window }: {
  children: ReactNode; window?: ((open: CheckoutOpen, close: () => void, leave: () => void) => ReactNode) | undefined;
}) {
  const [shown, setShown] = useState<{ open: CheckoutOpen; n: number; back: (() => void) | null } | null>(null);
  const current = shown?.open ?? null;
  const back = shown?.back ?? null;
  const { resolved } = useTheme();
  const controls = useMemo<CheckoutControls>(() => ({
    open: (what, from, then) => setShown((was) => ({ open: { what, from, topUpId: null }, n: (was?.n ?? 0) + 1, back: then ?? null })),
    reopen: (topUpId, what, from) => setShown((was) => ({ open: { what, from, topUpId }, n: (was?.n ?? 0) + 1, back: null })),
    close: () => { setShown(null); back?.(); },
    current
  }), [current, back]);
  const leave = () => setShown(null);
  return (
    <CheckoutContext.Provider value={controls}>
      {children}
      {shown && window ? <ThemeScope key={shown.n} theme={resolved}>{window(shown.open, controls.close, leave)}</ThemeScope> : null}
    </CheckoutContext.Provider>
  );
}
