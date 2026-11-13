import { Avatar, PlanWindow } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row } from '../../../src/component';
import { AIKO, KOFI, PRIYA } from '../../../src/world/people';

/**
 * A plan's small arched window, a moment of the evening drawn flat: Pro's sunset, Team's with its people on the horizon,
 * more notes' last light. Its sun rises as a payment lands: on the horizon, its glow breathing, while it's awaited; lifting
 * once it's seen; clear of the horizon, the sky warming, once it's bought. `sm` is the phone's one line.
 */
const meta = {
  title: 'Components/Checkout/PlanWindow', component: PlanWindow, parameters: { layout: 'centered' },
  args: { art: 'pro', rise: 'rest', size: 'md' },
  argTypes: {
    art: { control: 'inline-radio', options: ['pro', 'team', 'hours'] },
    rise: { control: 'inline-radio', options: ['rest', 'waiting', 'seen', 'done'] },
    size: { control: 'inline-radio', options: ['md', 'sm'] }
  },
  render: (args) => <div style={{ width: args.size === 'sm' ? 44 : 296 }}><PlanWindow {...args} /></div>
} satisfies Meta<typeof PlanWindow>;
export default meta;
type Story = StoryObj<typeof meta>;

const TEAM = [{ who: PRIYA, size: 18 }, { who: KOFI, size: 20 }, { who: AIKO, size: 17 }].map(({ who, size }) => <Avatar key={who.id} person={who} size={size} />);

export const Pro: Story = {};
export const ProNight: Story = { globals: { theme: 'dark' } };
export const Team: Story = { args: { art: 'team', people: TEAM } };
export const MoreNotes: Story = { args: { art: 'hours' }, globals: { theme: 'dark' } };
/** Waiting for a payment: the sun on its horizon, its glow breathing. */
export const Waiting: Story = { args: { rise: 'waiting' } };
/** The payment is seen: the sun lifts. */
export const Seen: Story = { args: { rise: 'seen' } };
/** Bought: the sun clears the horizon, the sky warms, the glints widen. */
export const Done: Story = { args: { rise: 'done' }, globals: { theme: 'dark' } };
/** Every stage side by side, at night. */
export const Stages: Story = {
  globals: { theme: 'dark' },
  render: (args) => <Row>{(['rest', 'waiting', 'seen', 'done'] as const).map((r) => <div key={r} style={{ width: 220 }}><PlanWindow {...args} rise={r} /></div>)}</Row>
};
/** The phone's one line. */
export const Small: Story = { args: { size: 'sm' } };
