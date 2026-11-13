/*
 * WsUnsavedBar: what's typed isn't reaching Alcove, and why, across the top of a document. Where the words may not get there
 * by themselves, it holds WsRescue, and says only what that offers: copy them, or save them as a new document too.
 */
import { WsDiscardAsk, WsRescue, WsUnsavedBar, type WsUnsaved } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../../src/component';

/** The reasons that offer the words back: the document won't take them, or won't by itself. */
const STUCK: readonly WsUnsaved[] = ['rejected', 'too-large', 'read-only'];

const meta = {
  title: 'Components/Workspace/Unsaved/WsUnsavedBar',
  component: WsUnsavedBar,
  args: { why: 'rejected', saveable: true },
  argTypes: {
    why: { control: 'select', options: ['rejected', 'too-large', 'read-only', 'unavailable', 'signed-out', 'call-ended'] },
    children: { control: false }
  },
  render: ({ why, saveable }) => (
    <WsUnsavedBar why={why} saveable={saveable}>
      {why !== null && STUCK.includes(why) && (
        <WsRescue onCopy={did('copy text')} onSaveAsNew={saveable ? did('save as new document') : undefined}
          discard={{ open: false, onOpenChange: did('discard'), content: <WsDiscardAsk onDiscard={did('discard')} onKeep={did('keep it')} /> }} />
      )}
    </WsUnsavedBar>
  )
} satisfies Meta<typeof WsUnsavedBar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Alcove couldn't take the last edits: copy them, save them as a new document, or discard them. */
export const Rejected: Story = {};
/** For someone who can't make a document here, it says only what's there. */
export const RejectedCopyOnly: Story = { args: { saveable: false } };
/** More than one document holds: delete something, or send a block to another document, and it saves. */
export const TooLarge: Story = { args: { why: 'too-large' } };
/** Made a reader with words not yet saved. */
export const ReadOnly: Story = { args: { why: 'read-only', saveable: false } };
/** It can't be opened right now, and opens again by itself: nothing to do. */
export const Unavailable: Story = { args: { why: 'unavailable' } };
/** The session ended by itself: the words save when they sign in again. */
export const SignedOut: Story = { args: { why: 'signed-out' } };
/** A guest, once the call has ended. */
export const CallEnded: Story = { args: { why: 'call-ended' } };
