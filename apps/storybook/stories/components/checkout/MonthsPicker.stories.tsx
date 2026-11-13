import { MonthsPicker } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';
import { LENGTHS, Step } from './parts';

/**
 * How long: Pro's lengths up to the most one purchase buys, each with its total and what that is a month, and a bracket
 * over those at the lower price. Another length opens a stepper. On a phone the cards stack, each at the lower price saying so.
 */
const meta = {
  title: 'Components/Checkout/MonthsPicker', component: MonthsPicker, parameters: { layout: 'centered' },
  args: { options: LENGTHS, value: 12, offLabel: '20% off', onChange: did('onChange'), other: { open: false, max: 12, price: '$192, 20% off', onOpen: did('onOpen'), onStep: did('onStep') } },
  argTypes: { value: { control: { type: 'number', min: 1, max: 12 } }, offLabel: { control: 'text' }, label: { control: 'text' } },
  decorators: [(Story) => <Step><Story /></Step>],
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <MonthsPicker {...args} onChange={(months) => { args.onChange(months); update({ value: months, other: { ...args.other, open: false } }); }}
        other={{ ...args.other, onOpen: () => { args.other.onOpen(); update({ value: Math.min(12, args.value + 1), other: { ...args.other, open: true } }); }, onStep: (months) => { args.other.onStep(months); update({ value: months }); } }} />
    );
  }
} satisfies Meta<typeof MonthsPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A year, at 20% off: where checkout starts when there's a yearly price. */
export const AYear: Story = {};
/** A month, as Plans' Monthly opens it. */
export const AMonth: Story = { args: { value: 1 } };
/** Another length, at 8 months: no card is ticked. */
export const AnotherLength: Story = { args: { value: 8, other: { open: true, max: 12, price: '$160', onOpen: did('onOpen'), onStep: did('onStep') } } };
/** Extending: the same choice, asked as how much longer. */
export const HowMuchLonger: Story = { args: { label: 'How much longer' } };
/** No lower price on offer: no bracket. */
export const NoLowerPrice: Story = { args: { offLabel: null, options: LENGTHS.map((o) => ({ ...o, total: `$${o.months * 20}`, each: '$20 a month', off: false })) } };
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };
export const Night: Story = { globals: { theme: 'dark' } };
