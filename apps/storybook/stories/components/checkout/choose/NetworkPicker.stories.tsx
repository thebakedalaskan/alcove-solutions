import { NetworkPicker } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../../src/component';
import { NETWORKS, Step } from '../parts';

/** Pay with USDC on: a tile for each network with its mark, and its least where that's more than the others'. None is chosen for you. */
const meta = {
  title: 'Components/Checkout/Choose/NetworkPicker', component: NetworkPicker, parameters: { layout: 'centered' },
  args: { options: NETWORKS, value: null, onChange: did('onChange') },
  decorators: [(Story) => <Step><Story /></Step>],
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <NetworkPicker {...args} onChange={(id) => { args.onChange(id); update({ value: id }); }} />;
  }
} satisfies Meta<typeof NetworkPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NoneChosen: Story = {};
export const Base: Story = { args: { value: 'base' } };
export const Ethereum: Story = { args: { value: 'eth' } };
export const Phone: Story = { args: { value: 'base' }, globals: { viewport: { value: 'phone' } } };
export const Night: Story = { args: { value: 'base' }, globals: { theme: 'dark' } };
