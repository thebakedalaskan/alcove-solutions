/*
 * Icon: one of the app's icons, by name. Lucide, one stroke family at 1.8 with round caps and joins, in the colour of
 * the text around it and sized by whoever draws it (18 by default). Play, stop and the dot are drawn filled. Every
 * name is in Foundations › Icons; add one to the map rather than drawing an SVG.
 */
import { ICON_NAMES, Icon } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row } from '../../../src/component';

const meta = {
  title: 'Components/Icons and marks/Icon',
  component: Icon,
  parameters: { layout: 'centered' },
  args: { name: 'video', size: 18 },
  argTypes: {
    name: { control: 'select', options: ICON_NAMES },
    size: { control: { type: 'range', min: 12, max: 48, step: 1 } }
  }
} satisfies Meta<typeof Icon>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Pick any name and size in Controls. */
export const Default: Story = {};
/** 13 and 15 beside small print, 16 to 18 in buttons and rows, 22 on its own, and 28. The stroke stays 1.8. */
export const Sizes: Story = {
  render: (args) => (
    <Row>
      {[13, 15, 16, 18, 22, 28].map((size) => <Icon key={size} {...args} size={size} />)}
    </Row>
  )
};
/** The three drawn filled. */
export const Filled: Story = {
  render: (args) => (
    <Row>
      <Icon {...args} name="play" />
      <Icon {...args} name="stop" />
      <Icon {...args} name="dot" />
    </Row>
  )
};
