import { CheckoutTick } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../../src/component';
import { Step } from '../parts';

/**
 * Something buying it does as well, ticked or not: upgrading a team, Buy a license for each person who joins, starting as
 * the team has it, and set with the purchase as it goes through.
 */
const meta = {
  title: 'Components/Checkout/Choose/CheckoutTick', component: CheckoutTick, parameters: { layout: 'centered' },
  args: {
    checked: true, onChange: did('onChange'), label: 'Buy a license for each person who joins',
    hint: 'From your balance, when someone needs one and none is left. You can turn it off on Team or in Settings.'
  },
  argTypes: { checked: { control: 'boolean' }, disabled: { control: 'boolean' }, label: { control: 'text' }, hint: { control: 'text' } },
  decorators: [(Story) => <Step><Story /></Step>],
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <CheckoutTick {...args} onChange={(on) => { args.onChange(on); update({ checked: on }); }} />;
  }
} satisfies Meta<typeof CheckoutTick>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ticked: Story = {};
export const TickedNight: Story = { globals: { theme: 'dark' } };
export const Unticked: Story = { args: { checked: false } };
