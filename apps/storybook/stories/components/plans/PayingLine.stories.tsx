/*
 * PayingLine: how paying works, in one line under everything on Plans, with the wallet it's paid from. What's bought and
 * how many months at a time come from the offers; nothing renews by itself.
 */
import { PayingLine } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { onTheWater } from './parts';

const meta = {
  title: 'Components/Plans/PayingLine',
  component: PayingLine,
  decorators: [onTheWater],
  parameters: { layout: 'fullscreen' },
  args: {
    children: <><b>Pay in USDC</b> from any wallet or exchange, for 1 to 12 months at a time. Nothing renews by itself, and when a plan ends you’re back on Free with nothing lost.</>
  },
  argTypes: { children: { control: false }, className: { control: false } }
} satisfies Meta<typeof PayingLine>;
export default meta;
type Story = StoryObj<typeof meta>;

/** As Plans says it, with Pro bought 1 to 12 months at a time. */
export const AsOnPlans: Story = { name: 'As on Plans' };
