/*
 * PlanSunset: the last sliver of the sun on the horizon, and its long glow over the sky. The plans' moment has no sun of its
 * own, so Plans draws this one on the evening (`Evening`'s `sky`), at the middle of the horizon: behind the clouds and
 * everything that passes through, so a boat crossing the horizon goes in front of it, never behind. Decorative: hidden from
 * screen readers. On a phone the glow is narrower.
 */
import { Horizon, PlanSunset } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Plans/PlanSunset',
  component: PlanSunset,
  parameters: { layout: 'padded' },
  argTypes: { className: { control: false } },
  render: (args) => (
    <div className="relative isolate h-[420px] overflow-hidden rounded-[var(--radius-lg)]" style={{ '--hz': '262px' }}>
      <Horizon moment="plans" only={{ kind: null }} sky={<PlanSunset {...args} />} />
    </div>
  )
} satisfies Meta<typeof PlanSunset>;
export default meta;
type Story = StoryObj<typeof meta>;

/** On the plans' evening, as the page has it. */
export const OnTheEvening: Story = { name: 'On the evening' };
/** A sailing boat crosses the horizon, five times as fast as on the page: it goes in front of the sun. */
export const ABoatPasses: Story = {
  name: 'A boat passes',
  render: (args) => (
    <div className="relative isolate h-[420px] overflow-hidden rounded-[var(--radius-lg)]" style={{ '--hz': '262px' }}>
      <Horizon moment="plans" only={{ kind: 'sail', pace: 5 }} sky={<PlanSunset {...args} />} />
    </div>
  )
};
