/*
 * BoardText: text straight on the board, with no box round it. Three sizes, enough for titles and labels, on purpose: a
 * title, a heading for labelling, and body text.
 */
import { BoardText } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { KitSheet } from './parts';

const meta = {
  title: 'Components/Board/BoardText',
  component: BoardText,
  args: { id: 't1', x: 0, y: 0, w: 290, h: 34, text: 'What should change?', size: 'title' },
  argTypes: { text: { control: 'text' }, size: { control: 'inline-radio', options: ['title', 'heading', 'body'] }, editor: { control: false } },
  render: (args) => (
    <KitSheet width={400} height={160} cam={{ x: 40, y: 50, z: 1 }}>
      <BoardText {...args} />
    </KitSheet>
  )
} satisfies Meta<typeof BoardText>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A title. */
export const Title: Story = {};
/** A heading, for labelling a part of the board. */
export const Heading: Story = { args: { text: 'Who does what next?', size: 'heading', h: 24 } };
/** Body text, for a line or two. */
export const Body: Story = { args: { text: 'Text sits straight on the board, with no box round it.', size: 'body', h: 58 } };
/** The three together, as the Tools sheet shows them. */
export const AllThree: Story = {
  name: 'All three',
  render: () => (
    <KitSheet width={400} height={220} cam={{ x: 40, y: 40, z: 1 }}>
      <BoardText id="t1" x={0} y={0} w={290} h={34} text="What should change?" />
      <BoardText id="t2" x={0} y={52} w={290} h={24} size="heading" text="Who does what next?" />
      <BoardText id="t3" x={0} y={92} w={290} h={58} size="body" text="Text sits straight on the board, with no box round it." />
    </KitSheet>
  )
};
