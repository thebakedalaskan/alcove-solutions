/*
 * What the Agents kit's stories share: a slice of the Agents page's evening, the horizon a little way down, for what
 * stands on it (windows, the line, you and an agent) and what opens from it; and the water under it, for what your
 * agents did and things to ask them. The parts only draw, so a story gives each the data and handlers the page would.
 */
import { Horizon } from '@alcove/ui';
import type { Decorator } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { PopSurface } from '../../../src/component';

/**
 * The evening, with what the story draws standing on the horizon (`--hz` from the top), its names on the water. The page
 * sets where the sun stands from the line's width; here it stands just past a line of `places`.
 */
export function OnTheHorizon({ hz = 220, places = 8.5, below = 260, children }: { hz?: number | undefined; places?: number | undefined; below?: number | undefined; children: ReactNode }) {
  return (
    <div className="ag" style={{ position: 'relative', isolation: 'isolate', overflow: 'hidden', minHeight: hz + below, '--hz': `${hz}px`, '--ag-w': places, '--ag-sun': places / 2 + 0.62 }}>
      <Horizon moment="agents" only={{ kind: null }} />
      <div className="ag-sky" style={{ justifyContent: 'flex-end', padding: '30px 24px 0', height: hz }}>{children}</div>
    </div>
  );
}
export const onTheHorizon: Decorator = (Story) => <OnTheHorizon><Story /></OnTheHorizon>;
/** The sky taller, for the question an agent asks. */
export const onTheSky: Decorator = (Story) => <OnTheHorizon hz={560} below={120}><Story /></OnTheHorizon>;

/** The water under the horizon: the page's own column for what your agents did, on the ground. */
export const onTheWater: Decorator = (Story) => <div className="ag" style={{ maxWidth: 720, margin: '0 auto', padding: '24px' }}><Story /></div>;

/** An agent's popover without the popover, standing in the page: for the parts that don't need one open. */
export const inAPopover: Decorator = (Story) => <PopSurface className="ag-pop"><Story /></PopSurface>;
