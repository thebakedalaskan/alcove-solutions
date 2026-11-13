/*
 * SwitchLine: a switch with what it does: the title, a line under it when that needs saying, and the Switch itself
 * (`control`) at its end. What a call's notes keep is a few of these, opened under Notes on the scheduler, and on the
 * Notes view of a scheduled call's card.
 */
import { Icon, Switch, SwitchLine } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { did } from '../../../src/component';

/** Opened in place under Notes, in the scheduler's Details: What the notes keep. */
const opened: Decorator = (Story) => (
  <section className="sc-sec" style={{ width: 'min(372px, 100%)' }}>
    <h3>Details</h3>
    <div className="sc-row is-switch">
      <Icon name="notes" size={17} className="is-rec" />
      <span className="min-w-0"><b>Notes</b><small>Everyone invited gets them</small></span>
      <Switch checked label="Notes" onChange={did('onNotes')} />
    </div>
    <button type="button" className="sc-more" aria-expanded onClick={did('onWhatTheyKeep')}>What the notes keep<Icon name="chevron" size={14} /></button>
    <div className="sc-keep"><Story /></div>
  </section>
);

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
