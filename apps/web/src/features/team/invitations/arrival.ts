/*
 * What a new account is told once its arrival is done (features/onboarding/store.ts), when it came with a team: "You're on
 * Vandelay Industries." The invite page keeps it as the account joins the team, before the arrival starts; the frame says it
 * once Home is in view. In memory only: a reload, which lands on Home like any other visit, says nothing.
 */
import { useToast } from '@alcove/ui';
import { useEffect } from 'react';
import { useArrival } from '~/features/onboarding/store';

let joining: string | null = null;

/** The account being made is on `team` now: said once its arrival is done. */
export function sayOnArrival(team: string): void { joining = team; }

/** Says it, once the arrival no longer covers the page. Owns nothing that needs undoing. */
export function useSaidOnArrival(): void {
  const toast = useToast();
  const { stage } = useArrival();
  useEffect(() => {
    if (stage !== 'none' || joining === null) return;
    const team = joining;
    joining = null;
    toast(`You’re on ${team}.`, { icon: 'people', ms: 7000 });
  }, [stage, toast]);
}
