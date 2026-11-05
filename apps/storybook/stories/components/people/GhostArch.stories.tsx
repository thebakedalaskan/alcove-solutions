/*
 * GhostArch: an empty arch where a person will be. A dashed outline the size and shape of an Avatar of the same `size`,
 * for the people who aren't here yet beside the ones who are: someone not on Alcove, someone invited by address. It
 * shows the first letter of `initial` (a name or an address), or "+n" for `more` people. It's decoration: the words
 * next to it say who.
 */
import { Avatar, GhostArch } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row } from '../../../src/component';
import { JONAS, KOFI, LENA, PRIYA } from '../../../src/world/people';

const meta = {
  title: 'Components/People/GhostArch',
  component: GhostArch,
  parameters: { layout: 'centered' },
  args: { size: 44, initial: LENA.name },
  argTypes: {
    initial: { control: 'text' },
    more: { control: { type: 'number', min: 0 } },
    size: { control: { type: 'range', min: 20, max: 96, step: 2 } },
    className: { control: false }
  }
} satisfies Meta<typeof GhostArch>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Lena isn't on Alcove yet: the first letter of her name. */
export const FromAName: Story = { name: 'From a name' };
/** Someone invited by address: its first letter. */
export const FromAnAddress: Story = { name: 'From an address', args: { initial: JONAS.email } };
/** Three more people who aren't here yet. */
export const More: Story = { args: { initial: undefined, more: 3 } };
/** The same size and shape as the arches of the people who are here. */
export const BesideAvatars: Story = {
  name: 'Beside avatars',
  render: (args) => (
    <Row>
      <Avatar person={PRIYA} size={args.size ?? 44} />
      <Avatar person={KOFI} size={args.size ?? 44} />
      <GhostArch {...args} />
      <GhostArch size={args.size} more={3} />
    </Row>
  )
};
/** Sizes, from a row in a list to a lobby. */
export const Sizes: Story = {
  render: (args) => (
    <Row>
      {[28, 36, 44, 64, 88].map((size) => <GhostArch key={size} {...args} size={size} />)}
    </Row>
  )
};
