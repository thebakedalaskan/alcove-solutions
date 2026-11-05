/*
 * EmptyArch: the empty arch with the sun low behind the horizon, for a list with nothing in it yet. EmptyState draws it
 * at 66px; `size` is its width in px, and the height follows. Drawn from the tokens, so it suits either theme.
 */
import { EmptyArch } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row } from '../../../src/component';

const meta = {
  title: 'Components/Feedback/EmptyArch',
  component: EmptyArch,
  parameters: { layout: 'centered' },
  args: { size: 66 },
  argTypes: { size: { control: { type: 'range', min: 32, max: 200, step: 2 } } }
} satisfies Meta<typeof EmptyArch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** 44, 66 (the default), 96 and 140. */
export const Sizes: Story = {
  render: () => (
    <Row>
      <EmptyArch size={44} />
      <EmptyArch size={66} />
      <EmptyArch size={96} />
      <EmptyArch size={140} />
    </Row>
  )
};
