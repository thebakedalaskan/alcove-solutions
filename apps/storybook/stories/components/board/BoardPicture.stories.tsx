/*
 * BoardPicture: a picture on the board. A moment of someone's screen is framed, with whose screen and when under it, and the
 * person sharing is told it's there. An image added from More is the picture alone. Until it has loaded, it's an empty ground
 * of its size.
 */
import { BoardFrame, BoardPicture } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { screenImage } from '../../../src/api/media';
import { PRIYAS_SCREEN } from '../../../src/world/boards';
import { KitSheet } from './parts';

const meta = {
  title: 'Components/Board/BoardPicture',
  component: BoardPicture,
  args: { id: 'shot1', x: 20, y: 20, w: 320, h: 228, shot: true, caption: 'Priya’s screen, 10:42', src: screenImage(PRIYAS_SCREEN) },
  argTypes: { src: { control: false }, caption: { control: 'text' } },
  render: (args) => (
    <KitSheet width={480} height={360} cam={{ x: 50, y: 56, z: 1 }}>
      <BoardFrame id="fix" x={0} y={0} w={360} h={268} title="Could improve" sub="1" />
      <BoardPicture {...args} />
    </KitSheet>
  )
} satisfies Meta<typeof BoardPicture>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A picture of Priya's screen, taken from her share, in Could improve. */
export const APictureOfAScreen: Story = { name: 'A picture of a screen' };
/** An image, added from More. */
export const AnImage: Story = { name: 'An image', args: { shot: false, caption: undefined } };
/** Still loading: an empty ground of its size, so nothing jumps when it arrives. */
export const Loading: Story = { args: { src: undefined } };
