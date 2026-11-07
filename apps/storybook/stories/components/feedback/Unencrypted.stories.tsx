/*
 * Unencrypted: a small badge for a model that doesn't run in a secure enclave. Caution text with an icon; hovering or
 * focusing it says why. Compact is for a tight row, like a model list.
 */
import { Unencrypted } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row } from '../../../src/component';

const meta = {
  title: 'Components/Feedback/Unencrypted',
  component: Unencrypted,
  parameters: { layout: 'centered' },
  args: { compact: false },
  argTypes: { compact: { control: 'boolean' }, className: { control: false } }
} satisfies Meta<typeof Unencrypted>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** Tighter, for a row in a list. */
export const Compact: Story = { args: { compact: true } };
/** Both sizes side by side. */
export const BothSizes: Story = {
  name: 'Both sizes',
  render: () => (
    <Row>
      <Unencrypted />
      <Unencrypted compact />
    </Row>
  )
};
