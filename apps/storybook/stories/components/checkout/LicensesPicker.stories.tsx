import { LicensesPicker } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';
import { MORE_LICENSES, START_LICENSES, Step } from './parts';

/**
 * How many licenses: Team's cards, each with its total and what that number is for (beside the people the app knows of when
 * a team is started, beside who's waiting when its admin buys more), under the price of one. Another number opens a stepper
 * from 1 to the most one purchase buys. In a narrower window the cards go two to a row, and on a phone they stack.
 */
const meta = {
  title: 'Components/Checkout/LicensesPicker', component: LicensesPicker, parameters: { layout: 'centered' },
  args: {
    hint: '$40 each, one person for 30 days', options: START_LICENSES, value: 6, onChange: did('onChange'),
    other: { open: false, max: 500, price: '$240', onOpen: did('onOpen'), onStep: did('onStep') }
  },
  argTypes: { value: { control: { type: 'number', min: 1, max: 500 } }, hint: { control: 'text' }, label: { control: 'text' } },
  decorators: [(Story) => <Step><Story /></Step>],
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    const priced = (n: number) => `$${(n * 40).toLocaleString('en-US')}`;
    return (
      <LicensesPicker {...args} onChange={(count) => { args.onChange(count); update({ value: count, other: { ...args.other, open: false, price: priced(count) } }); }}
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

/** Starting a team: six, for the six people at Vandelay on Alcove, where checkout starts. */
export const StartingATeam: Story = {};
export const StartingATeamNight: Story = { globals: { theme: 'dark' } };
/** Another number, at 7: no card is ticked. */
export const AnotherNumber: Story = { args: { value: 7, other: { open: true, max: 500, price: '$280', onOpen: did('onOpen'), onStep: did('onStep') } } };
/** Its admin buying more, with all five taken and Maya waiting: what's spare after hers. */
export const BuyingMore: Story = { args: { options: MORE_LICENSES, value: 3, other: { open: false, max: 500, price: '$120', onOpen: did('onOpen'), onStep: did('onStep') } } };
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };
