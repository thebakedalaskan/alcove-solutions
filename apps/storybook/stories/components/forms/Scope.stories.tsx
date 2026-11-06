/*
 * Scope: who an action changes, beside the action. Only you for what changes only your side, such as how loud someone
 * is for you or your own notes; Everyone, in the horizon's tint, for what changes the call for everyone in it.
 */
import { Scope } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Forms/Scope',
  component: Scope,
  parameters: { layout: 'centered' },
  args: { everyone: false, children: 'Only you' },
  argTypes: { children: { control: 'text' } }
} satisfies Meta<typeof Scope>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OnlyYou: Story = { name: 'Only you' };
/** Muting someone's microphone, for everyone in the call. */
export const Everyone: Story = { args: { everyone: true, children: 'Everyone' } };
