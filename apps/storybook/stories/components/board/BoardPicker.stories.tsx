/*
 * BoardPicker: Board, at the top right of the call, opens it under itself. What's picked opens on your screen until you present
 * it, and everyone in the call can edit it. The board the call has comes first, then a new one from Blank, Retro, Ideas or Flow,
 * then the team's boards. A saved board some people here can't open asks first, in the picker's place. While someone presents
 * a board, or for a guest, a new one waits, and it says why. In a breakout room a new board is only that room's, and the saved
 * boards stay in the main room. Share › A board shows the same picker as its step.
 */
import { BoardPickerThumb, BoardPicker, CallTopButton, CallTopGroup, CallTopRule, cn, Popover } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import '../../../src/board.css';
import { did, onStage } from '../../../src/component';

const RECENTS = {
  workspace: 'Product',
  boards: [
    { id: 'retro', name: 'Launch retro', by: 'Priya', when: 'Today', thumb: <BoardPickerThumb kind="columns" /> },
    { id: 'september', name: 'September retro', by: 'Art', when: '2 Oct', thumb: <BoardPickerThumb kind="columns" /> }
  ]
};

/** Under 600px the call is a phone's: Board is in More there, and what it opens is a sheet. */
const onAPhone = (): boolean => typeof window !== 'undefined' && window.matchMedia('(max-width: 599px)').matches;

const meta = {
  title: 'Components/Board/BoardPicker',
  component: BoardPicker,
  ...onStage,
  args: { recents: RECENTS, inRoom: false, busy: false, onTemplate: did('onTemplate'), onRecent: did('onRecent') },
  argTypes: { recents: { control: false }, inCall: { control: false }, access: { control: false }, step: { control: false }, blocked: { control: 'text' } },
  render: function Render(args) {
    const [open, setOpen] = useState(true);
    return (
      <div className="sbb-top">
        <CallTopGroup label="On your screen">
          <Popover open={open} onOpenChange={setOpen} side="bottom" align="end" label="Open a board" className={cn('bl', onAPhone() && 'is-sheet')}
            anchor={<CallTopButton icon="presentation" word="Board" label="Board" on={open} />}>
            <BoardPicker {...args} />
          </Popover>
          <CallTopButton icon="folderOpen" word="Workspace" label="Workspace" />
          <CallTopRule />
          <CallTopButton icon="notesPen" word="Notes" label="Notes" />
          <CallTopButton icon="chat" word="Chat" label="Chat" />
        </CallTopGroup>
      </div>
    );
  }
} satisfies Meta<typeof BoardPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A new board, or one of the team's recent ones from Product, on your screen until you present it. */
export const Plain: Story = {};
/** Theo and Sam can't open the September retro: let everyone here edit it, and open it, or not now. */
export const SomeoneCantOpenIt: Story = {
  name: 'Someone can’t open it',
  args: { access: { names: ['Theo', 'Sam'], board: 'September retro', letIn: true, onOpen: did('Open it'), onNotNow: did('Not now') } }
};
/** The same, when it isn't yours to share: it opens anyway, for whoever can open it, or not now. */
export const SomeoneCantOpenItNotYours: Story = {
  name: 'Someone can’t open it, and it isn’t yours to share',
  args: { access: { names: ['Theo'], board: 'September retro', letIn: false, onOpen: did('Open it anyway'), onNotNow: did('Not now') } }
};
/** The call has a board Priya brought: it's first, to open again. */
export const InThisCall: Story = { name: 'In this call', args: { inCall: { name: 'Launch retro', by: 'Priya · brought it', onOpen: did('Launch retro') } } };
/** You present the call's board. */
export const YourePresentingIt: Story = { name: 'You’re presenting it', args: { inCall: { name: 'Launch retro', by: 'You’re presenting it', onOpen: did('Launch retro') } } };
/** Priya presents the call's board: it's first, to join, and a new board waits until she stops. */
export const SomeonePresentingIt: Story = {
  name: 'Someone presenting it',
  args: { inCall: { name: 'Launch retro', by: 'Priya is presenting it', onOpen: did('Launch retro') }, blocked: 'Priya is presenting a board. You can start one once they stop.' }
};
/** A guest can open the board the call has, but can't start one, and has no team boards. */
export const Guest: Story = {
  args: { recents: undefined, inCall: { name: 'Launch retro', by: 'Priya · brought it', onOpen: did('Launch retro') }, blocked: 'Guests can’t start a board here.' }
};
/** In a breakout room: only that room sees a new board, and it comes back when rooms close. Saved boards stay in the main room. */
export const InARoom: Story = { name: 'In a room', args: { inRoom: true } };
/** Nobody on the team has made a board yet: only the templates. */
export const NoRecents: Story = { name: 'No recents', args: { recents: undefined } };
