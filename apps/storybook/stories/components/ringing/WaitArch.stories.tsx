/*
 * WaitArch: the empty arch someone is awaited in, with their face in it, on the night stage. It ripples while they're
 * being rung, twice every 2.4 seconds, and holds still (`still`) once they've answered. Under reduced motion it holds a
 * plain ring. A waiting tile and the ring card both use it.
 */
import { WaitArch } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row, onStage } from '../../../src/component';
import { INES, PRIYA } from '../../../src/world/people';

const meta = {
  title: 'Components/Ringing and waiting/WaitArch',
  component: WaitArch,
  ...onStage,
  args: { person: PRIYA, size: 60, still: false },
  argTypes: { person: { control: false }, size: { control: { type: 'range', min: 28, max: 120, step: 2 } }, className: { control: false } }
} satisfies Meta<typeof WaitArch>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Being rung: the arch ripples. */
export const Ringing: Story = {};
/** They've answered: the arch holds still. */
export const Still: Story = { args: { still: true } };
/** Someone without a portrait: their initial. */
export const WithoutAPortrait: Story = { name: 'Without a portrait', args: { person: INES } };
/** 36 in a narrow tile, 46 on the ring card, 60 in a tile on the stage, and larger: held still, so they compare. */
export const Sizes: Story = {
  args: { still: true },
  render: (args) => (
    <Row>
      <WaitArch {...args} size={36} />
      <WaitArch {...args} size={46} />
      <WaitArch {...args} size={60} />
      <WaitArch {...args} size={88} />
    </Row>
  )
};
