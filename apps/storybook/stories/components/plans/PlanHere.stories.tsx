/*
 * PlanHere: where a plan's button would be, on the plan you're on: "Your plan" with a warm tick in an outline the height of
 * a button, and nothing to press. `quiet`: a line of its own, no outline, as Free says it while you're on another plan.
 */
import { PlanHere } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Plans/PlanHere',
  component: PlanHere,
  decorators: [(Story) => <div className="mx-auto w-[314px] rounded-[var(--radius-lg)] bg-surface p-6 shadow-[0_0_0_1px_var(--line)]"><Story /></div>],
  parameters: { layout: 'centered' },
  args: { quiet: false },
  argTypes: { quiet: { control: 'boolean' }, children: { control: 'text' } }
} satisfies Meta<typeof PlanHere>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Free, the plan you're on. */
export const YourPlan: Story = { name: 'Your plan' };
/** Free while you're on Pro. */
export const Quiet: Story = { args: { quiet: true, children: 'Where you’re back to if a plan ends' } };
