/*
 * BoardRail: the tools, as the call's dock turned on its side, just off the sheet. One is always on, Select by default, and
 * each one's key is in its tip; More opens images, the workspace, tables, comments and templates beside it (BoardFlyout).
 * M, V and C stay the call's, which is why Select is Esc. Press a tool and it's the one that's on.
 */
import { BoardRail, type BoardTool } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did, onStage } from '../../../src/component';
import { KitSheet, RetroPiece } from './parts';

const TOOLS: BoardTool[] = ['select', 'note', 'text', 'shape', 'line', 'pen', 'frame'];

const meta = {
  title: 'Components/Board/BoardRail',
  component: BoardRail,
  args: { tool: 'select', moreOpen: false, faded: false, onTool: did('onTool'), onMore: did('onMore') },
  argTypes: { tool: { control: 'select', options: TOOLS } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <BoardRail {...args} onTool={(tool) => { args.onTool(tool); update({ tool }); }} onMore={() => { args.onMore(); update({ moreOpen: !args.moreOpen }); }} />;
  }
} satisfies Meta<typeof BoardRail>;
export default meta;
type Story = StoryObj<typeof meta>;

/** In a call, at night, as the dock is: Select is on. */
export const InTheCall: Story = { name: 'In the call', ...onStage };
/** Sticky is on: a click adds one. */
export const StickyOn: Story = { name: 'Sticky on', ...onStage, args: { tool: 'note' } };
/** Frame is on, the last tool before More: its fill keeps the same gap to the rail as Select's does at the top. */
export const FrameOn: Story = { name: 'Frame on', ...onStage, args: { tool: 'frame' } };
/** On the board's own page it takes the page's surface instead of the night, beside the sheet. */
export const OnItsPage: Story = {
  name: 'On its page',
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <KitSheet page width={900} height={480} cam={{ x: 40, y: 34, z: 0.75 }}
        rail={<BoardRail {...args} onTool={(tool) => { args.onTool(tool); update({ tool }); }} onMore={() => { args.onMore(); update({ moreOpen: !args.moreOpen }); }} />}>
        <RetroPiece />
      </KitSheet>
    );
  }
};
