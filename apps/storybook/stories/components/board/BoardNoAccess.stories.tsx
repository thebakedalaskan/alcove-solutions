/*
 * BoardNoAccess: in the board's place, for someone in the call it wasn't opened to. It says who brought it, to ask them to
 * let you in, and nothing about what's on it, not even its name, and offers to ask them for access while they're in the call.
 * At night, as the call is.
 */
import { BoardNoAccess } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import '../../../src/board.css';
import { did, onStage } from '../../../src/component';

const onAPhone = (viewport: unknown): boolean => typeof viewport === 'object' && viewport !== null && 'value' in viewport && viewport.value === 'phone';

const meta = {
  title: 'Components/Board/BoardNoAccess',
  component: BoardNoAccess,
  ...onStage,
  args: { who: 'Aiko', onAsk: did('onAsk') },
  argTypes: { who: { control: 'text' } },
  render: (args, { globals }) => <div className={onAPhone(globals['viewport']) ? 'sbb-call is-phone' : 'sbb-call'}><BoardNoAccess {...args} /></div>
} satisfies Meta<typeof BoardNoAccess>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Aiko opened the onboarding flow, which is in her workspace, without Theo. */
export const InTheCall: Story = { name: 'In the call' };
/** On a phone, in the space between the faces and the dock. */
export const OnAPhone: Story = { name: 'On a phone', globals: { viewport: { value: 'phone', isRotated: false } } };
/** Whoever brought it has left the call: it says to ask whoever brought it, with nobody here to ask. */
export const TheyveLeft: Story = { name: 'They’ve left', args: { who: null } };
