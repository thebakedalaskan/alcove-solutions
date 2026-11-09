/*
 * LinkRow: a call's link, shown without its https://, with Copy beside it. Pressing Copy puts the link on the clipboard,
 * and the tick says so for a couple of seconds. On a page in the page's theme (a link whose time is already picked),
 * and on the night stage (the call while you're on your own in it). A link too long for the row is cut short; Copy always
 * copies all of it.
 */
import { LinkRow } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, did, onStage } from '../../../src/component';

/** Puts the whole link on the clipboard, as the app does. */
const toClipboard = (link: string) => { void navigator.clipboard?.writeText(`https://${link}`).catch(() => undefined); };

const meta = {
  title: 'Components/Actions/LinkRow',
  component: LinkRow,
  args: { link: 'alcove.solutions/join/art-call-now', onCopy: did('onCopy') },
  argTypes: { className: { control: false } },
  render: (args) => <Box width="min(420px, 100%)" height="auto"><LinkRow {...args} onCopy={() => { args.onCopy(); toClipboard(args.link); }} /></Box>
} satisfies Meta<typeof LinkRow>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Press Copy: the link goes on the clipboard, and the tick says Copied. */
export const OnAPage: Story = { name: 'On a page' };
/** On the night stage, as in the call while you're on your own in it. */
export const OnTheStage: Story = {
  ...onStage,
  name: 'On the stage',
  render: (args) => <Box width="min(400px, 100%)" height="auto"><LinkRow {...args} onCopy={() => { args.onCopy(); toClipboard(args.link); }} /></Box>
};
/** Narrower than the link: it's cut short, and Copy keeps its room. */
export const Narrow: Story = {
  render: (args) => <Box width={260} height="auto"><LinkRow {...args} onCopy={() => { args.onCopy(); toClipboard(args.link); }} /></Box>
};
