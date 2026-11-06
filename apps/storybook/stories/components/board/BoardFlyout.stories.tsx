/*
 * BoardFlyout: a tool's options, beside the rail and level with that tool, at night as the rail is. The sticky's six
 * colours, the shapes, how a line runs, the pen and highlighter and eraser, and More, which keeps the rail short. Each is
 * drawn with what the design canvas's Tools sheet puts beside it. Pick one and it's the one that's on.
 */
import { route, shapePath } from '@alcove/board';
import { BOARD_COLOURS, BOARD_MORE, BoardFlyout, BoardLine, BoardLines, BoardRail, BoardShape, BoardSticky, BoardStroke, type BoardCamera, type BoardFlyoutProps, type BoardLineStyle, type BoardTool } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { useArgs } from 'storybook/preview-api';
import { did, onStage } from '../../../src/component';
import { KitSheet, RetroPiece } from './parts';

/** The rail with `tool` on, or More open, and the sheet beside it with the flyout over it. */
function WithRail({ tool = 'select', more = false, cam, flyout, children }: { tool?: BoardTool | undefined; more?: boolean | undefined; cam?: BoardCamera | undefined; flyout: ReactNode; children: ReactNode }) {
  return (
    <KitSheet width={820} height={460} cam={cam} rail={<BoardRail tool={tool} moreOpen={more} onTool={did('onTool')} onMore={did('onMore')} />} over={flyout}>
      {children}
    </KitSheet>
  );
}

const STALE = { x: 330, y: 190, w: 82, h: 82 }, REFRESH = { x: 516, y: 152, w: 82, h: 82 };
const LINES: Record<BoardLineStyle, { d: string; head: string }> = { elbow: route(STALE, REFRESH, 'elbow'), straight: route(STALE, REFRESH, 'straight'), curve: route(STALE, REFRESH, 'curve') };

/** The flyout `args` say, beside its tool, with what the Tools sheet puts beside it. Picking an option makes it the one that's on. */
function Picking({ args, update }: { args: BoardFlyoutProps; update: (args: Partial<BoardFlyoutProps>) => void }) {
  switch (args.kind) {
    case 'note':
      return (
        <WithRail tool="note" flyout={<BoardFlyout {...args} onColour={(colour) => { args.onColour(colour); update({ colour }); }} />}>
          <BoardSticky id="t1" x={330} y={170} w={118} h={118} size="s" colour={args.colour} text="Staging data was stale" />
          <BoardSticky id="t2" x={460} y={170} w={118} h={118} size="s" colour="sky" text="Refresh it nightly" />
        </WithRail>
      );
    case 'shape':
      return (
        <WithRail tool="shape" flyout={<BoardFlyout {...args} onShape={(shape) => { args.onShape(shape); update({ shape }); }} />}>
          <BoardShape id="s1" x={330} y={190} w={104} h={66} path={shapePath('rect', 104, 66)} text="Step" />
          <BoardShape id="s2" x={452} y={174} w={104} h={100} path={shapePath('diamond', 104, 100)} colour="butter" text="Choice" />
          <BoardShape id="s3" x={566} y={198} w={62} h={50} path={shapePath('pill', 62, 50)} colour="sky" />
        </WithRail>
      );
    case 'line': {
      const drawn = LINES[args.line];
      return (
        <WithRail tool="line" flyout={<BoardFlyout {...args} onLine={(line) => { args.onLine(line); update({ line }); }} />}>
          <BoardLines><BoardLine id="l1" d={drawn.d} head={drawn.head || undefined} /></BoardLines>
          <BoardSticky id="t1" {...STALE} size="s" colour="rose" text="Stale data" />
          <BoardSticky id="t2" {...REFRESH} size="s" colour="sky" text="Refresh it" />
        </WithRail>
      );
    }
    case 'pen':
      return (
        <WithRail tool="pen" flyout={<BoardFlyout {...args} onPen={(pen) => { args.onPen(pen); update({ pen }); }} />}>
          <BoardLines>
            <BoardStroke d="M330 236C360 186 390 276 424 220S480 182 504 226S566 258 590 198" />
            <BoardStroke d="M336 268C400 258 480 272 590 258" colour="sun" marker />
          </BoardLines>
        </WithRail>
      );
    case 'more':
      return (
        <WithRail more cam={{ x: 250, y: 40, z: 0.6 }} flyout={<BoardFlyout {...args} />}>
          <RetroPiece />
        </WithRail>
      );
  }
}

const meta = {
  title: 'Components/Board/BoardFlyout',
  component: BoardFlyout,
  ...onStage,
  args: { kind: 'note', colour: 'butter', onColour: did('onColour') },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <Picking args={args} update={update} />;
  }
} satisfies Meta<typeof BoardFlyout>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Six colours from the sunrise, each a small dawn of its own. The one picked is the colour of the next sticky. */
export const StickyColours: Story = { name: 'Sticky colours', args: { kind: 'note', colour: 'butter', onColour: did('onColour') }, argTypes: { colour: { control: 'select', options: BOARD_COLOURS } } };
/** Rectangle, ellipse, diamond and pill. Drag to size, click once for a standard one, and type straight onto it. */
export const Shapes: Story = { args: { kind: 'shape', shape: 'rect', onShape: did('onShape') }, argTypes: { shape: { control: 'inline-radio', options: ['rect', 'ellipse', 'diamond', 'pill'] } } };
/** How a line runs. Lines attach to what they join, and find a clean route again when either end moves. */
export const Lines: Story = { args: { kind: 'line', line: 'elbow', onLine: did('onLine') }, argTypes: { line: { control: 'inline-radio', options: ['elbow', 'straight', 'curve'] } } };
/** For circling, underlining and quick sketches. Strokes smooth out as you draw; the highlighter is wide and see-through. */
export const Pen: Story = { args: { kind: 'pen', pen: 'pen', onPen: did('onPen') }, argTypes: { pen: { control: 'inline-radio', options: ['pen', 'marker', 'eraser'] } } };
/** Everything else, one click further away, so the rail stays short. Comment has its own key, K. */
export const More: Story = { args: { kind: 'more', items: BOARD_MORE, onMore: did('onMore') } };
/** More holds only what it can do where it is: on a board's own page, for now, that's Comment. */
export const MoreWithLess: Story = { name: 'More, with only Comment', args: { kind: 'more', items: ['comment'], onMore: did('onMore') } };
