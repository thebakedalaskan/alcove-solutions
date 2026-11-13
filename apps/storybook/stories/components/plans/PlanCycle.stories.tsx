/*
 * PlanCycle: Monthly or Yearly, on the plans' sky, centred over the plans, with the last sliver of the sun on the horizon
 * under it. Each plan then shows one price. Beside Yearly, what a year or more saves, worked out from the two prices
 * ("20% off", in horizon). Plans shows it only when a year or more costs less, and opens on Yearly.
 */
import { PlanCycle } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';
import { PlansEvening } from './parts';

const meta = {
  title: 'Components/Plans/PlanCycle',
  component: PlanCycle,
  decorators: [(Story) => <PlansEvening sky={170}><Story /></PlansEvening>],
  parameters: { layout: 'padded' },
  args: { value: 'year', off: '20% off', onChange: did('onChange') },
  argTypes: { value: { control: 'inline-radio', options: ['month', 'year'] }, off: { control: 'text' }, month: { control: 'text' }, year: { control: 'text' } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <PlanCycle {...args} onChange={(value) => { args.onChange(value); update({ value }); }} />;
  }
} satisfies Meta<typeof PlanCycle>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Yearly, as Plans opens: 20% off beside it. */
export const Yearly: Story = {};
/** Monthly chosen. */
export const Monthly: Story = { args: { value: 'month' } };
/** A lower price from 6 months rather than a year: the choice says the months it takes. */
export const FromSixMonths: Story = { name: 'From six months', args: { year: '6 months', off: '10% off' } };
