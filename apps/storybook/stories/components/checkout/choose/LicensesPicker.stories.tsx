import { LicensesPicker, type LicensesTerm } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../../src/component';
import { MORE_LICENSES, Step, UPGRADE_LICENSES } from '../parts';

/**
 * How many licenses: Team's cards, each with its total and what that number is for (beside the people on a free team without
 * one when it's upgraded, beside who's waiting when its admin buys more), under the price of one, which is where checkout
 * says how long a license runs. Another number opens a stepper from 1 to the most one purchase buys. In a narrower window the
 * cards go two to a row, and on a phone they stack. While a year is offered, How long comes first: Monthly, or Yearly · 20%
 * off, on the kit's Segmented.
 */
const meta = {
  title: 'Components/Checkout/Choose/LicensesPicker', component: LicensesPicker, parameters: { layout: 'centered' },
  args: {
    hint: '$40 each, one person for 30 days', options: UPGRADE_LICENSES, value: 3, onChange: did('onChange'),
    other: { open: false, max: 500, price: '$120', onOpen: did('onOpen'), onStep: did('onStep') }
  },
  argTypes: { value: { control: { type: 'number', min: 1, max: 500 } }, hint: { control: 'text' }, label: { control: 'text' } },
  decorators: [(Story) => <Step><Story /></Step>],
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    /* A license is $40 for 30 days, or $384 for a year. */
    const each = (year: boolean) => (year ? 384 : 40);
    const year = args.term?.value === 'year';
    const priced = (n: number, y = year) => `$${(n * each(y)).toLocaleString('en-US')}`;
    const was = args.term;
    const term: LicensesTerm | undefined = was && {
      ...was,
      onChange: (v) => {
        was.onChange(v);
        const y = v === 'year';
        update({
          term: { ...was, value: v }, hint: y ? '$384 each, one person for a year' : '$40 each, one person for 30 days',
          options: args.options.map((o) => ({ ...o, total: priced(o.count, y) })), other: { ...args.other, price: priced(args.value, y) }
        });
      }
    };
    return (
      <LicensesPicker {...args} term={term} onChange={(count) => { args.onChange(count); update({ value: count, other: { ...args.other, open: false, price: priced(count) } }); }}
        other={{
          ...args.other,
          onOpen: () => { args.other.onOpen(); update({ value: Math.min(500, args.value + 1), other: { ...args.other, open: true, price: priced(args.value + 1) } }); },
          onStep: (count) => { args.other.onStep(count); update({ value: count, other: { ...args.other, price: priced(count) } }); }
        }} />
    );
  }
} satisfies Meta<typeof LicensesPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Upgrading Vandelay's free team: three, for the three on it without one, where checkout starts. */
export const Upgrading: Story = {};
export const UpgradingNight: Story = { globals: { theme: 'dark' } };
/** Another number, at 7: no card is ticked. */
export const AnotherNumber: Story = { args: { value: 7, other: { open: true, max: 500, price: '$280', onOpen: did('onOpen'), onStep: did('onStep') } } };
/** Its admin buying more, with all five taken and Maya waiting: what's spare after Maya's. */
export const BuyingMore: Story = { args: { options: MORE_LICENSES, value: 3, other: { open: false, max: 500, price: '$120', onOpen: did('onOpen'), onStep: did('onStep') } } };
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };

/** Three for a year: $384 each, one person for a year, with How long over them. */
const YEAR_LICENSES = UPGRADE_LICENSES.map((o) => ({ ...o, total: `$${(o.count * 384).toLocaleString('en-US')}` }));
export const ForAYear: Story = {
  args: {
    hint: '$384 each, one person for a year', options: YEAR_LICENSES, term: { value: 'year', onChange: did('term'), off: '20% off' },
    other: { open: false, max: 500, price: '$1,152', onOpen: did('onOpen'), onStep: did('onStep') }
  }
};
export const ForAYearNight: Story = { ...ForAYear, globals: { theme: 'dark' } };
export const ForAYearPhone: Story = { ...ForAYear, globals: { viewport: { value: 'phone' } } };
