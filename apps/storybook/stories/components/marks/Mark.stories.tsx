/*
 * Mark: the brand's mark, an arched window with the sun coming up over the horizon, drawn the same in both themes. It's
 * branding, never state. `size` is its height in px; the width follows. Logo puts the wordmark beside it.
 */
import { Mark } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row } from '../../../src/component';

const meta = {
  title: 'Components/Icons and marks/Mark',
  component: Mark,
  parameters: { layout: 'centered' },
  args: { size: 26 },
  argTypes: { size: { control: { type: 'range', min: 16, max: 160, step: 1 } } }
} satisfies Meta<typeof Mark>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** 22, 26 (the default), 40, 64 and 96. */
export const Sizes: Story = {
  render: () => (
    <Row>
      <Mark size={22} />
      <Mark size={26} />
      <Mark size={40} />
      <Mark size={64} />
      <Mark size={96} />
    </Row>
  )
};
