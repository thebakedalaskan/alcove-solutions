/*
 * Kbd: a key to press, after the label of what it does: N to start a call, ⌘K to search or ask, esc to close the
 * palette. Digits and symbols keep in step.
 */
import { Kbd } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Actions/Kbd',
  component: Kbd,
  parameters: { layout: 'centered' },
  args: { children: 'N' },
  argTypes: { children: { control: 'text' } }
} satisfies Meta<typeof Kbd>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** With a modifier, as Search or ask shows it on a Mac (Ctrl K elsewhere). */
export const WithAModifier: Story = { name: 'With a modifier', args: { children: '⌘K' } };
/** A key that has a name. */
export const AWord: Story = { name: 'A word', args: { children: 'esc' } };
/** In a line of help, as the call's view menu says what the keys do. */
export const InALine: Story = {
  name: 'In a line',
  render: () => (
    <p className="ac-body-s max-w-md text-ink-2">
      On a tile: <Kbd>P</Kbd> pin, <Kbd>⇧←</Kbd> <Kbd>⇧→</Kbd> move, <Kbd>+</Kbd> <Kbd>−</Kbd> size, <Kbd>↵</Kbd> more. <Kbd>Esc</Kbd> unpins everyone.
    </p>
  )
};
