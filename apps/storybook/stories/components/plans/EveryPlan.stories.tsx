/*
 * EveryPlan: what every plan has, under the plans: its heading, then one row of chips, each with its icon. Plans only change
 * how much you get, so Free shows the whole product. Centred on the water; on a phone, from the left.
 */
import { EveryPlan, type IconName } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { onTheWater } from './parts';

const EVERY: { icon: IconName; text: string }[] = [
  { icon: 'video', text: 'Calls up to 10 hours, 100 people' },
  { icon: 'presentation', text: 'A workspace and board per call' },
  { icon: 'ask', text: 'Ask across your notes' },
  { icon: 'sealed', text: 'Confidential compute' },
  { icon: 'people', text: 'Invitees get the notes free' }
];

const meta = {
  title: 'Components/Plans/EveryPlan',
  component: EveryPlan,
  decorators: [onTheWater],
  parameters: { layout: 'fullscreen' },
  args: { items: EVERY },
  argTypes: { title: { control: 'text' }, items: { control: 'object' }, className: { control: false } }
} satisfies Meta<typeof EveryPlan>;
export default meta;
type Story = StoryObj<typeof meta>;

/** On every plan, as Plans has it. */
export const OnEveryPlan: Story = { name: 'On every plan' };
