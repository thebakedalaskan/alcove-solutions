/*
 * WsCantOpen: a document or workspace this person can't open: deleted, or not shared with them any more. When this browser
 * holds words they wrote in it that didn't reach Alcove, it says so, and offers them where it was (WsRescue).
 */
import { Button, WsCantOpen, WsDiscardAsk, WsRescue } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, did } from '../../src/component';

const meta = {
  title: 'Components/WsCantOpen',
  component: WsCantOpen,
  args: { what: 'document', unsent: false, action: <Button size="sm" onClick={did('back')}>Back to Product</Button> },
  argTypes: { what: { control: 'inline-radio', options: ['document', 'workspace'] }, action: { control: false } },
  render: (args) => <Box width="min(760px, 100%)" height={520}><WsCantOpen {...args} /></Box>
} satisfies Meta<typeof WsCantOpen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ADocument: Story = {};
export const AWorkspace: Story = { args: { what: 'workspace', action: <Button size="sm" onClick={did('back')}>Back to your workspaces</Button> } };
/** Words this browser holds for a document that's gone: offered where it was, only the person's own. */
export const WordsKept: Story = {
  args: {
    unsent: true,
    action: <WsRescue onCopy={did('copy text')} onSaveAsNew={did('save as new document')} discard={{ open: false, onOpenChange: did('discard'), content: <WsDiscardAsk gone onDiscard={did('discard')} onKeep={did('keep it')} /> }} />
  }
};
