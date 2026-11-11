/*
 * Spinner: something is on its way. It sits where an icon would, in a button that's busy or before a line that says
 * what's being waited for, and takes the colour of the text around it. With reduced motion it doesn't turn: it stands as
 * if caught mid-turn and fades slowly in and out, so it never rests as an open ring that looks like a broken icon (to see
 * it, emulate `prefers-reduced-motion: reduce` in the browser's rendering settings).
 */
import { Button, Spinner } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Feedback/Spinner',
  component: Spinner,
  parameters: { layout: 'centered' }
} satisfies Meta<typeof Spinner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** Before the line that says what's being waited for, in that line's colour. */
export const BeforeALine: Story = {
  name: 'Before a line',
  render: () => <p className="flex items-center gap-2.5 text-ink-2"><Spinner />Asked to join. Waiting for Art to let you in.</p>
};
/** In a busy button, where its icon was: the label says what's happening. */
export const InABusyButton: Story = {
  name: 'In a busy button',
  render: () => <Button variant="primary" loading>Finishing</Button>
};
/** In a note's Play button while the recording is on its way, in the button's own colours. */
export const InThePlayButton: Story = {
  name: 'In the Play button',
  render: () => <span className="nd-play" role="img" aria-label="Play, waiting for the recording"><Spinner /></span>
};
