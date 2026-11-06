/*
 * Field: a labelled text input, for the rare places that need one, such as the work email single sign-on asks for.
 * The label sits above it, and a hint under it when the input needs explaining. A dialog asks one thing at a time:
 * several questions are steps of one modal, never a stack of fields.
 */
import { Field } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';

const meta = {
  title: 'Components/Forms/Field',
  component: Field,
  parameters: { layout: 'centered' },
  args: { label: 'Work email', type: 'email', placeholder: 'you@example.com', value: '', disabled: false },
  argTypes: {
    label: { control: 'text' }, hint: { control: 'text' }, placeholder: { control: 'text' }, value: { control: 'text' },
    disabled: { control: 'boolean' }, type: { control: 'inline-radio', options: ['email', 'text'] }
  },
  decorators: [(Story) => <div style={{ width: 'min(360px, 90vw)' }}><Story /></div>],
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <Field {...args} autoComplete="off" spellCheck={false} onChange={(e) => update({ value: e.target.value })} />;
  }
} satisfies Meta<typeof Field>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing typed: the placeholder shows what goes in. */
export const Empty: Story = {};
/** A hint under it, when the input needs explaining. */
export const WithAHint: Story = { name: 'With a hint', args: { hint: 'To try single sign-on, use any address at example.com.' } };
export const Filled: Story = { args: { value: 'art@vandelay.industries' } };
/** Held while what was typed is being used: here, while single sign-on signs you in. */
export const Disabled: Story = { args: { value: 'art@vandelay.industries', disabled: true } };
