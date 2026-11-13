/*
 * What the team's component stories share: Vandelay's team as the canvas's TeamPlan board has it (you, Priya, Kofi, Lena,
 * Maya and Aiko, Maya's license ended and Aiko waiting for one), its notes made visible to it, and the evening they stand
 * on: the team's moment, with its people on the horizon, or its water for what sits on it.
 */
import { Horizon, type TeamLinePerson, type TeamNote } from '@alcove/ui';
import type { Decorator } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { AIKO, ART, KOFI, LENA, MAYA, PRIYA } from '../../../src/world/people';

export { AIKO, ART, KOFI, LENA, MAYA, PRIYA };

/** The team on the horizon, each under their license. */
export const LINE: TeamLinePerson[] = [
  { key: 'art', person: ART, name: 'You', license: 'Until 12 Dec', tone: 'live', label: 'You, Art Vandelay' },
  { key: 'priya', person: PRIYA, name: 'Priya', license: 'Until 12 Dec', tone: 'live' },
  { key: 'kofi', person: KOFI, name: 'Kofi', license: 'Until 3 Dec', tone: 'live' },
  { key: 'lena', person: LENA, name: 'Lena', license: 'Until 28 Nov', tone: 'live' },
  { key: 'maya', person: MAYA, name: 'Maya', license: 'Ended', tone: 'ended' },
  { key: 'aiko', person: AIKO, name: 'Aiko', license: 'Waiting', tone: 'waiting' }
];

/** The notes people on the team made visible to it, newest first. */
export const NOTES: TeamNote[] = [
  { id: 'tn-standup', title: 'Team standup', by: PRIYA, byName: 'Priya', when: 'Today' },
  { id: 'tn-pricing', title: 'Pricing sync', by: MAYA, byName: 'Maya', when: 'Yesterday' },
  { id: 'tn-launch', title: 'Launch planning', by: LENA, byName: 'Lena', when: 'Tue 27 Oct' }
];

/** The team's evening in a box, its horizon `sky` down: what's given stands on the horizon, its names on the water under it. */
export function TeamEvening({ sky = 170, children }: { sky?: number; children: ReactNode }) {
  return (
    <div className="tq relative isolate overflow-hidden rounded-[var(--radius-lg)]" style={{ '--hz': `${sky}px`, '--tq-n': LINE.length, paddingBottom: 72 }}>
      <Horizon moment="team" only={{ kind: null }} />
      <div className="flex flex-col justify-end" style={{ height: sky }}>{children}</div>
    </div>
  );
}

/** Stands the story on the team's horizon. */
export const onTheHorizon: Decorator = (Story) => <TeamEvening><Story /></TeamEvening>;

/** The team's water, at the width of the page's main column, or of its side column (`side`). */
export const onTheWater = (side = false): Decorator => function Water(Story) {
  return (
    <div className="relative isolate overflow-hidden rounded-[var(--radius-lg)]" style={{ '--hz': '-160px' }}>
      <Horizon moment="team" only={{ kind: null }} />
      <div className="px-5 py-8 min-[861px]:px-8">
        <div className="mx-auto" style={{ maxWidth: side ? 340 : 760 }}><Story /></div>
      </div>
    </div>
  );
};
