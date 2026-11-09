import { CryptoMark } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const names = ['USDC', 'USDT', 'near', 'eth', 'base', 'arb', 'sol', 'pol', 'bsc', 'op', 'avax', 'tron'];
const meta = {
  title: 'Components/Icons and marks/CryptoMark', component: CryptoMark,
  parameters: { layout: 'centered' }, args: { name: 'USDC' },
  argTypes: { name: { control: 'select', options: [...names, 'unknown'] } }
} satisfies Meta<typeof CryptoMark>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Stablecoin: Story = {};
export const Network: Story = { args: { name: 'base' } };
export const Unknown: Story = { args: { name: 'unknown' } };
/** Every shipped logo beside its name; toolbar theme changes preserve the providers' own colours. */
export const All: Story = {
  render: () => <div className="grid grid-cols-3 gap-6">{names.map((name) => <span key={name} className="flex items-center gap-2"><CryptoMark name={name} />{name}</span>)}</div>
};
