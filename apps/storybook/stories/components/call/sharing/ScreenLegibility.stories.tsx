/*
 * ScreenLegibility: how well a frame of a shared screen could be read, when it wasn't all of it. Said calmly, so nothing
 * on it is taken for more than it shows: partly readable and couldn't be read are cautions, and not read (the notes
 * model couldn't read it at all) is an outline. A frame that could be read in full says nothing. In the page's theme,
 * on a note's shared screens and in the frame's viewer.
 */
import { ScreenLegibility } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/In a call/Sharing/ScreenLegibility',
  component: ScreenLegibility,
  parameters: { layout: 'centered' },
  args: { legible: 'partly' },
  argTypes: { legible: { control: 'inline-radio', options: ['clear', 'partly', 'unreadable', 'unread'] }, className: { control: false } }
} satisfies Meta<typeof ScreenLegibility>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Read in full: it renders nothing, so this story is empty on purpose. */
export const Clear: Story = { args: { legible: 'clear' } };
/** Some of it was too small, blurred or cut off, so the notes only use what could be read. */
export const Partly: Story = {};
/** None of it could be made out, so the notes don't say what it showed. */
export const Unreadable: Story = { args: { legible: 'unreadable' } };
/** The notes model couldn't read it at all, so nothing is said about it. */
export const Unread: Story = { args: { legible: 'unread' } };
