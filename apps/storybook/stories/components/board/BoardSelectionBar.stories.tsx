/*
 * BoardSelectionBar: a small bar that only appears on what's picked, over its middle and clear of the board's own bar. Its
 * colour opens a row of colours under it, More a menu, and a button shows only if it can be done to what's picked: several
 * stickies can be sorted into themes, several things tidied, and a line changes how it runs. It never leaves the sheet,
 * however near the edge the selection is. Press the colour to open its row, and pick one.
 */
import { BOARD_COLOURS, BoardDots, BoardFrame, BoardPicture, BoardSelectionBar, BoardSelectionBox, BoardSticky, type BoardSelectionBarProps } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { screenImage } from '../../../src/api/media';
import { did } from '../../../src/component';
import { PRIYAS_SCREEN } from '../../../src/world/boards';
import { A1, F1, KitSheet, RetroPiece, pickedAt, slot } from './parts';

const W = 760, H = 440;
const CAM = { x: 40, y: 110, z: 0.8 };
/** Priya's sticky, picked, where the surface would put its ring, dots and bar. */
const ONE = pickedAt(F1, CAM);

/** A sticky picked: everything the bar can offer one. */
const STICKY: BoardSelectionBarProps = {
  x: ONE.bar.x, y: ONE.bar.y, room: W, count: 1, things: 'stickies', colour: 'rose', textSize: true, picking: false,
  onColour: did('onColour'), onPick: did('onPick'), onTextSize: did('onTextSize'), onLine: did('onLine'), onDuplicate: did('onDuplicate'), onDelete: did('onDelete'), onMore: did('onMore')
};

const meta = {
  title: 'Components/Board/BoardSelectionBar',
  component: BoardSelectionBar,
  args: STICKY,
  argTypes: { colour: { control: 'select', options: BOARD_COLOURS }, things: { control: 'text' }, moreItems: { control: false }, lineStyle: { control: false } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    const bar = (
      <BoardSelectionBar {...args} onColour={() => { args.onColour(); update({ picking: !args.picking }); }}
        onPick={(colour) => { args.onPick(colour); update({ colour }); }} />
    );
    return (
      <KitSheet width={W} height={H} cam={CAM} over={<><BoardSelectionBox {...ONE.ring} /><BoardDots points={ONE.dots} />{bar}</>}>
        <RetroPiece picked="f1" colour={args.colour ?? 'rose'} />
      </KitSheet>
    );
  }
} satisfies Meta<typeof BoardSelectionBar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A sticky: its colour, its text size, a line from it, duplicate, delete and More. */
export const ASticky: Story = { name: 'A sticky' };
/** Its colour, pressed: the six colours open under the bar. */
export const PickingAColour: Story = { name: 'Picking a colour', args: { picking: true } };
/** More, pressed: what's picked can go in front of everything, or behind. */
export const More: Story = {
  args: {
    moreItems: [
      { icon: 'bringToFront', label: 'Bring to front', onPick: did('Bring to front') },
      { icon: 'sendToBack', label: 'Send to back', onPick: did('Send to back') }
    ]
  }
};

/** The nine ideas, dragged round: how many, then Sort into themes, which is written in confidential compute, and Tidy. */
const IDEAS = [
  ['Write the changelog first', 'butter', 40, 30], ['One launch calendar', 'peach', 250, 90], ['Tell support a week ahead', 'rose', 470, 26],
  ['Refresh staging every night', 'sky', 690, 120], ['Test billing with real cards', 'lilac', 900, 40], ['Dry run the day before', 'butter', 130, 300],
  ['Name an owner for every launch', 'rose', 370, 280], ['The status page gets an owner', 'sky', 620, 330], ['Keep the runbook in the workspace', 'peach', 860, 300]
] as const;
const IDEAS_CAM = { x: 18, y: 120, z: 0.6 };
const PILE = pickedAt({ x: 40, y: 26, w: 1010, h: 454 }, IDEAS_CAM);
export const SeveralStickies: Story = {
  name: 'Several stickies',
  args: { x: PILE.bar.x, y: PILE.bar.y, count: 9, colour: 'butter', textSize: false, onLine: undefined, onSort: did('onSort'), onTidy: did('onTidy') },
  render: (args) => (
    <KitSheet width={W} height={H} cam={IDEAS_CAM} over={<><BoardSelectionBox {...PILE.ring} handles={false} /><BoardSelectionBar {...args} /></>}>
      <BoardFrame id="ideas" x={0} y={0} w={1160} h={530} title="How do we launch better?" />
      {IDEAS.map(([text, colour, x, y]) => <BoardSticky key={text} id={text} x={x} y={y} w={150} h={150} colour={colour} text={text} selected />)}
    </KitSheet>
  )
};

/** Sort into themes, waiting for its answer from confidential compute: it says Sorting… and can't be pressed again. */
export const Sorting: Story = { ...SeveralStickies, name: 'Sorting', args: { ...SeveralStickies.args, sorting: true } };

/** A line, picked: how it runs, and delete. Joined at both ends, it has nothing to copy. The bar sits over its middle. */
const LINE_MIDDLE = { x: CAM.x + ((F1.x + F1.w / 2 + A1.x + A1.w / 2) / 2) * CAM.z, y: Math.max(66, CAM.y + ((F1.y + F1.h / 2 + A1.y + A1.h / 2) / 2) * CAM.z - 52) };
export const ALine: Story = {
  name: 'A line',
  args: { ...LINE_MIDDLE, colour: null, textSize: false, lineStyle: 'elbow', onLineStyle: did('onLineStyle'), onLine: undefined, onDuplicate: undefined, onMore: undefined },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <KitSheet width={W} height={H} cam={CAM} over={<BoardSelectionBar {...args} onLineStyle={(lineStyle) => { args.onLineStyle?.(lineStyle); update({ lineStyle }); }} />}>
        <RetroPiece line={args.lineStyle} lineSelected />
      </KitSheet>
    );
  }
};

/** A picture of someone's screen has no colour to change, so the bar has none. */
const SHOT = { x: 420, y: 190, w: 320, h: 228 };
const SHOT_CAM = { x: -150, y: 40, z: 0.8 };
const SHOT_PICKED = pickedAt(SHOT, SHOT_CAM);
export const APicture: Story = {
  name: 'A picture of a screen',
  args: { x: SHOT_PICKED.bar.x, y: SHOT_PICKED.bar.y, colour: null, textSize: false },
  render: (args) => (
    <KitSheet width={W} height={H} cam={SHOT_CAM} over={<><BoardSelectionBox {...SHOT_PICKED.ring} /><BoardDots points={SHOT_PICKED.dots} /><BoardSelectionBar {...args} /></>}>
      <BoardFrame id="fix" x={400} y={0} w={360} h={530} title="Could improve" sub="1" />
      <BoardPicture id="shot" {...SHOT} shot caption="Priya’s screen, 10:42" src={screenImage(PRIYAS_SCREEN)} selected />
    </KitSheet>
  )
};

/** Picked at the sheet's right edge: the bar stays on the sheet, and so does its row of colours. */
const EDGE_CAM = { x: 290, y: 110, z: 0.8 };
const EDGE = pickedAt(slot(400, 0, 0), EDGE_CAM);
export const AtTheEdge: Story = {
  name: 'At the edge',
  args: { x: EDGE.bar.x, y: EDGE.bar.y, colour: 'sky', picking: true },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <KitSheet width={W} height={H} cam={EDGE_CAM}
        over={<><BoardSelectionBox {...EDGE.ring} /><BoardDots points={EDGE.dots} /><BoardSelectionBar {...args} onColour={() => update({ picking: !args.picking })} onPick={(colour) => update({ colour })} /></>}>
        <RetroPiece picked="a1" colour={args.colour ?? 'sky'} />
      </KitSheet>
    );
  }
};
