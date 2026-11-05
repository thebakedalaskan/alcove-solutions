/*
 * IconButton: a 36px round button with one icon, for tile and toolbar actions, never a text label. Its `label` is what a
 * screen reader says and, as `title`, the browser's own tooltip; as the anchor of a Popover with a `tip`, pass
 * `title={undefined}` so only the tip shows. `on` marks a tool that's switched on, in the sun's soft tint. `size` is
 * the icon's: the button stays 36px unless a screen makes it smaller.
 */
import { ICON_NAMES, IconButton } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row, did } from '../../../src/component';

const meta = {
  title: 'Components/Actions/IconButton',
  component: IconButton,
  parameters: { layout: 'centered' },
  args: { icon: 'more', label: 'More', size: 18, on: false, disabled: false, onClick: did('onClick') },
  argTypes: {
    icon: { control: 'select', options: ICON_NAMES },
    size: { control: { type: 'range', min: 12, max: 28, step: 1 } }
  }
} satisfies Meta<typeof IconButton>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Hover it: the label shows as the browser's tooltip. */
export const Default: Story = {};
/** A tool that's switched on: captions are showing. */
export const On: Story = { args: { icon: 'captions', label: 'Hide captions', on: true } };
export const Disabled: Story = { args: { icon: 'screen', label: 'Share your screen', disabled: true } };
/** The icon at 15, 17 and 18 (the default) and 22. The button around it stays the same. */
export const Sizes: Story = {
  args: { icon: 'mic', label: 'Mute' },
  render: (args) => (
    <Row>
      <IconButton {...args} size={15} />
      <IconButton {...args} size={17} />
      <IconButton {...args} size={18} />
      <IconButton {...args} size={22} />
    </Row>
  )
};
