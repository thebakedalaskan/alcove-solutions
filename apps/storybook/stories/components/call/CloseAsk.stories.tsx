/*
 * CloseAsk: Close's question while you present a board or the workspace, always at night. For you: you go back to the
 * people and everyone else keeps it open, on their own. For everyone: it closes for everyone in the call. It opens under
 * Close ▾ on the frame's bar; on a phone it's a sheet from the bottom.
 */
import { Button, CloseAsk } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did, onStage } from '../../../src/component';

const meta = {
  title: 'Components/In a call/CloseAsk',
  component: CloseAsk,
  ...onStage,
  args: {
    open: true, title: 'Close Launch review · 4 Nov', phone: false, tip: 'Close it for you, or for everyone',
    anchor: <Button variant="secondary" size="sm" icon="x" iconRight="down">Close</Button>,
    onOpenChange: did('onOpenChange'), onMe: did('For you'), onEveryone: did('For everyone')
  },
  argTypes: { anchor: { control: false }, tip: { control: 'text' } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', width: '100%', minHeight: 'calc(100vh - 80px)' }}>
        <CloseAsk {...args} onOpenChange={(open) => { args.onOpenChange(open); update({ open }); }} />
      </div>
    );
  }
} satisfies Meta<typeof CloseAsk>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Under Close ▾, at the top right of what you present. */
export const Wide: Story = {};
/** On a phone it rises from the bottom as a sheet, over the call. */
export const PhoneSheet: Story = { name: 'Phone sheet', args: { phone: true }, globals: { viewport: { value: 'phone', isRotated: false } } };
