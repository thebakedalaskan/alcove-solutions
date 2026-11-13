/*
 * SwitchLine: a switch with what it does: the title, a line under it when that needs saying, and the Switch itself
 * (`control`) at its end. What a call's notes keep is a few of these, on the Notes view of a scheduled call's page
 * (`NotesSwitches`).
 */
import { Switch, SwitchLine } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

/** As wide as the Notes view of a scheduled call's page, where a call's switches are. */
const opened: Decorator = (Story) => <div style={{ width: 'min(372px, 100%)' }}><Story /></div>;

const meta = {
  title: 'Components/Forms/SwitchLine',
  component: SwitchLine,
  decorators: [opened],
  args: { title: 'Keep the recording', sub: 'Play back any moment from the notes', control: null },
  argTypes: { title: { control: 'text' }, sub: { control: 'text' }, control: { control: false } },
  /* The switch turns when it's pressed. */
  render: function Render(args) {
    const [on, setOn] = useState(true);
    return <SwitchLine {...args} control={<Switch label={typeof args.title === 'string' ? args.title : 'Switch'} checked={on} onChange={setOn} />} />;
  }
} satisfies Meta<typeof SwitchLine>;
export default meta;
type Story = StoryObj<typeof meta>;

/** What it does, a line under it, and the switch. */
export const On: Story = {};
/** Just what it does, when nothing more needs saying. */
export const WithoutALine: Story = { name: 'Without a line under it', args: { title: 'Read shared screens', sub: undefined } };
/** The line under it follows the switch: kept, or used and then deleted. */
export const SaysWhatItDoes: Story = {
  name: 'Says what it does',
  args: { title: 'Keep the transcript' },
  render: function Render(args) {
    const [on, setOn] = useState(false);
    return (
      <SwitchLine {...args} sub={on ? 'Who said what, and anyone invited can correct it' : 'Used to write the notes, then deleted'}
        control={<Switch label="Keep the transcript" checked={on} onChange={setOn} />} />
    );
  }
};
