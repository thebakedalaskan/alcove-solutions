import { HoursPicker } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../../src/component';
import { Step } from '../parts';

/** How many hours of notes for this period: one pack, two, and the most one purchase buys, with the price of an hour. */
const meta = {
  title: 'Components/Checkout/Choose/HoursPicker', component: HoursPicker, parameters: { layout: 'centered' },
  args: {
    value: 1, hint: '$1.50 an hour', onChange: did('onChange'),
    options: [
      { packs: 1, hours: '10 hours', price: '$15', sub: '10 hour-long calls' },
      { packs: 2, hours: '20 hours', price: '$30', sub: '20 hour-long calls' },
      { packs: 5, hours: '50 hours', price: '$75', sub: '50 hour-long calls' }
    ]
  },
  decorators: [(Story) => <Step><Story /></Step>],
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <HoursPicker {...args} onChange={(packs) => { args.onChange(packs); update({ value: packs }); }} />;
  }
} satisfies Meta<typeof HoursPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const TenHours: Story = {};
export const FiftyHours: Story = { args: { value: 5 } };
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };
export const Night: Story = { globals: { theme: 'dark' } };
