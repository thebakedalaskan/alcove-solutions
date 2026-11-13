/*
 * WsDiscardAsk: the one ask before what didn't save goes, on a workspace popover. The keyboard starts on Keep it, so Enter
 * twice loses nothing. On a document that's gone, there's nothing for it to carry on from, and it doesn't say there is.
 */
import { WsDiscardAsk } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PopSurface, did } from '../../../../src/component';

const meta = {
  title: 'Components/Workspace/Unsaved/WsDiscardAsk',
  component: WsDiscardAsk,
  args: { onDiscard: did('discard'), onKeep: did('keep it'), gone: false },
  argTypes: { onDiscard: { control: false }, onKeep: { control: false } },
  render: (args) => <PopSurface ws><WsDiscardAsk {...args} /></PopSurface>
} satisfies Meta<typeof WsDiscardAsk>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The document carries on from what Alcove has. */
export const OnTheDocument: Story = {};
export const DocumentGone: Story = { args: { gone: true } };
