/*
 * WsPickDocument: the page beside the list when nothing's open in a workspace that has things in it. Someone who can make
 * documents there gets New document as the page's one filled button; a reader is told to open something to read it.
 */
import { WsPickDocument } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentProps } from 'react';
import { Box, did } from '../../../../src/component';

const making: ComponentProps<typeof WsPickDocument> = { onDocument: did('new document') };

const meta = {
  title: 'Components/Workspace/No document/WsPickDocument',
  component: WsPickDocument,
  args: making,
  argTypes: { onDocument: { control: false } },
  render: (args) => <Box width="min(760px, 100%)" height={480}><WsPickDocument {...args} /></Box>
} satisfies Meta<typeof WsPickDocument>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CanMakeDocuments: Story = {};
export const Reading: Story = { args: { onDocument: undefined } };
