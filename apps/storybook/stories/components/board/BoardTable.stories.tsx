/*
 * BoardTable: a table from More, in board units. Its rows and columns share its size by their own sizes, and its first row
 * reads as its heads. While it's picked it offers a row at the bottom and a column at the right. The cell being typed in holds
 * the board's own field in its place; a cell nobody has typed in is empty.
 */
import { BoardEdit, BoardTable, type BoardTableLine } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { KitSheet } from './parts';

const COLS: BoardTableLine[] = [{ id: 'c1', size: 160 }, { id: 'c2', size: 160 }, { id: 'c3', size: 160 }];
const ROWS: BoardTableLine[] = [{ id: 'r1', size: 48 }, { id: 'r2', size: 48 }, { id: 'r3', size: 48 }];
const CELLS: Record<string, string> = { 'r1:c1': 'Owner', 'r1:c2': 'Due', 'r1:c3': 'Status', 'r2:c1': 'Priya', 'r2:c2': 'Friday', 'r2:c3': 'Started', 'r3:c1': 'Kofi', 'r3:c2': 'Monday' };

const meta = {
  title: 'Components/Board/BoardTable',
  component: BoardTable,
  args: { id: 'table1', x: 20, y: 20, w: 480, h: 144, cols: COLS, rows: ROWS, cells: CELLS, onAddRow: did('onAddRow'), onAddCol: did('onAddCol') },
  argTypes: { cols: { control: false }, rows: { control: false }, cells: { control: false }, editing: { control: false } },
  render: (args) => (
    <KitSheet width={600} height={260} cam={{ x: 40, y: 50, z: 1 }}>
      <BoardTable {...args} />
    </KitSheet>
  )
} satisfies Meta<typeof BoardTable>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Who does what by when: three by three, its heads in the first row. */
export const ATable: Story = { name: 'A table' };
/** Just added from More: three by three where you're looking, nothing in it yet. */
export const New: Story = { args: { cells: {} } };
/** Picked: + at the bottom adds a row, and + at the right a column. */
export const Picked: Story = { args: { selected: true } };
/** Typing in a cell: the board's field sits in its place, and Tab goes on to the next. */
export const Typing: Story = { args: { selected: true, editing: { key: 'r3:c3', editor: <BoardEdit label="Status" defaultValue="Not yet" /> } } };
