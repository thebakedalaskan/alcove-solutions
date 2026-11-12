/*
 * What the plans' stories share: what each plan brings, worded as Plans words the stand-in's offers (src/world/plans.ts:
 * 5 hours of notes, 10 GB and 512 MB on Free; 50 hours and 100 GB on Pro; the same for each person on Team, its storage
 * shared), and the evening they stand on, as the page has it: the plans' moment, with the last sliver of the sun on its
 * horizon.
 */
import { Horizon, PlanSunset, type PlanFact } from '@alcove/ui';
import type { Decorator } from '@storybook/react-vite';
import type { ReactNode } from 'react';

export const FREE_FACTS: PlanFact[] = [
  { icon: 'notes', text: 'About 5 hours of notes a month', sub: 'Back to 5 hours on the 1st of each period' },
  { icon: 'hardDrive', text: '10 GB of storage' },
  { icon: 'file', text: 'Files up to 512 MB' }
];
export const PRO_FACTS: PlanFact[] = [
  { icon: 'notes', text: 'About 50 hours of notes a month' },
  { icon: 'hardDrive', text: '100 GB of storage' },
  { icon: 'file', text: 'Files up to 512 MB' }
];
export const TEAM_FACTS: PlanFact[] = [
  { icon: 'notes', text: 'About 50 hours of notes each' },
  { icon: 'hardDrive', text: '100 GB each, shared by the team' },
  { icon: 'file', text: 'Files up to 512 MB' },
  { icon: 'people', text: 'Notes and workspaces the team shares' }
];
/** Free's last line, while more notes are offered. */
export const MORE_NOTES = 'Out of notes before the period ends? 10 more hours are $15.';
/** Team's last line. */
export const LICENSES_TAKEN = 'A license is taken when someone next opens Alcove. Ones nobody takes can be refunded.';

/** The last of the sun, as Plans draws it on its sky. */
export const SUNSET = <PlanSunset />;

/**
 * The plans' evening in a box: the sky `sky` tall, with the sun's last sliver on its horizon, and the sea under it. What's
 * given stands on the sky, its foot `above` over the horizon, or on the water when `water`.
 */
export function PlansEvening({ sky = 150, above = 52, water = false, children }: { sky?: number; above?: number; water?: boolean; children: ReactNode }) {
  return (
    <div className="relative isolate overflow-hidden rounded-[var(--radius-lg)]" style={{ '--hz': `${sky}px` }}>
      <Horizon moment="plans" only={{ kind: null }} sky={SUNSET} />
      {water
        ? <div className="px-5 pb-10 min-[861px]:px-8" style={{ paddingTop: sky + 34 }}><div className="mx-auto max-w-[1120px]">{children}</div></div>
        : <div className="grid items-end justify-items-center" style={{ height: sky, paddingBottom: above, marginBottom: 56 }}>{children}</div>}
    </div>
  );
}

/** The cards on the water, under the plans' sky, at the page's width. */
export const onTheWater: Decorator = (Story) => <PlansEvening sky={110} water><Story /></PlansEvening>;
