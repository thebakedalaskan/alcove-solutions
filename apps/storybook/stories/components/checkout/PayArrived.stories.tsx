import { PayArrived } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Step } from './parts';

/** "192.00 USDC arrived on Base": the amount counts up as it lands (the kit's CountUp, 0.65 s) when it's seen while you watch. */
const meta = {
  title: 'Components/Checkout/PayArrived', component: PayArrived, parameters: { layout: 'centered' },
  args: { amount: '192.00', value: 192, chainName: 'Base', count: false, pm: 1 },
  argTypes: { pm: { control: { type: 'range', min: 1, max: 8, step: 1 }, description: 'Slows the count by this much' } },
  decorators: [(Story) => <Step><Story /></Step>]
} satisfies Meta<typeof PayArrived>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Reopened later: simply there. */
export const Arrived: Story = {};
/** Seen while you watch: it counts up. Change a control to count it again. */
export const CountingUp: Story = { args: { count: true }, render: (args) => <PayArrived key={JSON.stringify(args)} {...args} /> };
export const Night: Story = { args: { count: true }, globals: { theme: 'dark' }, render: (args) => <PayArrived key={JSON.stringify(args)} {...args} /> };
