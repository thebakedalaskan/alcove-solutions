/*
 * BoardMenu: Board, at the top right of the call, opens it under itself. A new board from Blank, Retro, Ideas or Flow, and the
 * team's recent boards from the workspace. If some people here can't open a saved board, whoever opens it decides first:
 * let them in for this call, or open it without them. In a breakout room a new board is only for that room. Press Board
 * to close it and open it again.
 */
import { BoardMenu, BoardMenuThumb, CallTopButton, CallTopGroup, CallTopRule } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import '../../../src/board.css';
import { did, onStage } from '../../../src/component';

const RECENTS = {
  workspace: 'Product',
  boards: [
    { id: 'onboarding', name: 'Onboarding flow', by: 'Aiko', when: 'Mon', thumb: <BoardMenuThumb kind="flow" /> },
    { id: 'september', name: 'September retro', by: 'Art', when: '2 Oct', thumb: <BoardMenuThumb kind="columns" /> }
  ]
};

const meta = {
  title: 'Components/Board/BoardMenu',
  component: BoardMenu,
  subcomponents: { BoardMenuThumb },
  ...onStage,
  args: {
    open: true, inRoom: false, recents: RECENTS, anchor: <CallTopButton icon="presentation" word="Board" label="Board" on />,
    onOpenChange: did('onOpenChange'), onTemplate: did('onTemplate'), onRecent: did('onRecent')
  },
  argTypes: { anchor: { control: false }, recents: { control: false }, access: { control: false } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <div className="sbb-top">
        <CallTopGroup label="Just for you">
          <BoardMenu {...args} onOpenChange={(open) => { args.onOpenChange(open); update({ open }); }} />
          <CallTopButton icon="folderOpen" word="Workspace" label="Workspace" />
          <CallTopRule />
          <CallTopButton icon="notesPen" word="Notes" label="Notes" />
          <CallTopButton icon="chat" word="Chat" label="Chat" />
        </CallTopGroup>
      </div>
    );
  }
} satisfies Meta<typeof BoardMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A new board for everyone here, or one of the team's recent ones from Product. */
export const OpenABoard: Story = { name: 'Open a board' };
/** Theo and Sam can't open the onboarding flow: Aiko decides before it opens. */
export const SomeoneCantOpenIt: Story = {
  name: 'Someone can’t open it',
  args: { access: { names: ['Theo', 'Sam'], board: 'Onboarding flow', where: 'Aiko’s workspace', onLetIn: did('Let them in for this call'), onWithout: did('Open without them') } }
};
/** In a breakout room: only that room sees a new board, and it comes back when rooms close. Saved boards stay in the main room. */
export const InARoom: Story = { name: 'In a room', args: { inRoom: true } };
/** Nobody on the team has made a board yet: only the templates. */
export const NoRecentBoards: Story = { name: 'No recent boards', args: { recents: undefined } };
