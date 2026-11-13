/*
 * EmptyRows: a few rows not filled in yet, in the colours they'll have (a decision's rose diamond, a follow-up's dashed box,
 * words and an answer), on a faint panel. Home's For you shows it before there are notes. `ticks`: boxes to tick and a day
 * instead, for its Follow-ups. Drawn from the tokens, so it suits either theme.
 */
import { EmptyRows } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row } from '../../../src/component';

const meta = {
  title: 'Components/Feedback/EmptyRows',
  component: EmptyRows,
  parameters: { layout: 'centered' },
  args: { ticks: false },
  argTypes: { ticks: { control: 'boolean' } }
} satisfies Meta<typeof EmptyRows>;
export default meta;
type Story = StoryObj<typeof meta>;

/** What's to answer: decisions and follow-ups. */
export const Default: Story = {};
/** Follow-ups: boxes to tick, and when each is due. */
export const Ticks: Story = { args: { ticks: true } };
/** Both, as For you's two tabs have them. */
export const Both: Story = { render: () => <Row><EmptyRows /><EmptyRows ticks /></Row> };
