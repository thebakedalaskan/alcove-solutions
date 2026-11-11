/*
 * BoardBar: everything about the board that isn't a tool, in one line along the top of the sheet. The board's name opens
 * rename, where it's saved and closing it; the seal says it's sealed, or what's wrong, and opens who can see it. Then undo
 * and redo, the zoom and how near you are, Show the whole board (also ⇧1), the map, and in a call a vote and More.
 * On a narrow sheet a long name gives way first, and the seal stays whole.
 */
import { BoardBar, ICON_NAMES } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { BAR, KitSheet, RetroPiece } from './parts';

const meta = {
  title: 'Components/Board/BoardBar',
  component: BoardBar,
  args: { name: 'Launch retro', seal: 'Sealed', sealIcon: 'sealed', zoom: 0.8, canUndo: true, canRedo: false, editable: true, acts: true, mapOn: false, ...BAR },
  argTypes: { name: { control: 'text' }, seal: { control: 'text' }, sealIcon: { control: 'select', options: ICON_NAMES }, zoom: { control: { type: 'range', min: 0.1, max: 4, step: 0.05 } } },
  parameters: { width: 1000 },
  render: (args, { parameters }) => {
    const width: unknown = parameters['width'];
    return (
      <KitSheet width={typeof width === 'number' ? width : 1000} height={300} cam={{ x: 40, y: 96, z: args.zoom }} over={<BoardBar {...args} />}>
        <RetroPiece />
      </KitSheet>
    );
  }
} satisfies Meta<typeof BoardBar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** In a call: the whole bar, with what runs a session at its end. */
export const InTheCall: Story = { name: 'In the call' };
/** On the board's own page there's no session to run, so no Vote. Following someone hides it too. */
export const OnItsPage: Story = { name: 'On its page', args: { acts: false } };
/** For someone given view access: no undo, and the seal says View only. Off a call there's no session to run. */
export const ViewOnly: Story = { name: 'View only', args: { editable: false, acts: false, seal: 'View only', sealIcon: 'eye' } };
/**
 * For someone given view access in a call: Vote is where it always is, disabled, and its tip says why. More is theirs, as
 * nothing in it changes the board.
 */
export const ViewOnlyInACall: Story = { name: 'View only, in a call', args: { editable: false, canAct: false, seal: 'View only', sealIcon: 'eye' } };
/** A room's board, sealed to that room until rooms close. */
export const InARoom: Story = { name: 'In a room', args: { name: 'Comms board', seal: 'Sealed to this room', canUndo: false } };
/** The connection dropped: the seal says so, and the pill under the bar says what it means. */
export const Reconnecting: Story = { args: { seal: 'Reconnecting', sealIcon: 'wifiOff' } };
/** Changes couldn't be saved: the seal says Not saved until they are. */
export const NotSaved: Story = { name: 'Not saved', args: { seal: 'Not saved', sealIcon: 'cloudOff' } };
/** The map is open, so its button is pressed. */
export const MapOn: Story = { name: 'Map on', args: { mapOn: true } };
/** On a sheet 640 pixels wide, as beside a shared screen: the name gives way and the seal stays whole, with every button still there. */
export const Narrow: Story = { args: { name: 'Comms board', seal: 'Sealed to this room' }, parameters: { width: 640 } };
/** A phone's width: undo, the zoom and the map give way to a pinch, and Show the whole board stays, so all of it is a press away. */
export const OnAPhone: Story = { name: 'On a phone', args: { name: 'Comms board' }, parameters: { width: 390 }, globals: { viewport: { value: 'phone', isRotated: false } } };
