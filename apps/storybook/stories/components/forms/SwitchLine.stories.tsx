/*
 * SwitchLine: a switch with what it does, in the call modal: the title, a line under it when that needs saying, and
 * the Switch itself (`control`) at its end. What the call's notes keep is a few of these, and a big call's setup is one.
 */
import { FlowBody, FlowRow, FlowView, Switch, SwitchLine } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { ModalFrame, did } from '../../../src/component';

/** Opened in place under a row of the call modal, as the switches are: a big call's setup, or (`row: 'notes'`) its notes. */
const opened: Decorator = (Story, ctx) => (
  <ModalFrame>
    <FlowView>
      <FlowBody>
        <div className="cf-rows">
          {ctx.parameters['row'] === 'notes'
            ? <FlowRow icon="notes" on title="Notes and transcript" sub="Everyone invited gets them" expanded onClick={did('onRow')} />
            : <FlowRow icon="megaphone" title="Set up for a big call" sub="Everyone joins muted." expanded onClick={did('onRow')} />}
          <div className="cf-more"><Story /></div>
        </div>
      </FlowBody>
    </FlowView>
  </ModalFrame>
);

const meta = {
  title: 'Components/Forms/SwitchLine',
  component: SwitchLine,
  decorators: [opened],
  args: { title: 'Everyone joins muted, cameras off', control: null },
  argTypes: { title: { control: 'text' }, sub: { control: 'text' }, control: { control: false } },
  /* The switch turns when it's pressed. */
  render: function Render(args) {
    const [on, setOn] = useState(true);
    return <SwitchLine {...args} control={<Switch label={typeof args.title === 'string' ? args.title : 'Switch'} checked={on} onChange={setOn} />} />;
  }
} satisfies Meta<typeof SwitchLine>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Just what it does, and the switch. */
export const On: Story = {};
/** A line under the title, when what it does needs saying. */
export const WithASub: Story = { name: 'With a line under it', parameters: { row: 'notes' }, args: { title: 'Keep the recording', sub: 'Play back any moment from the notes' } };
/** The line under it follows the switch: kept, or used and then deleted. */
export const SaysWhatItDoes: Story = {
  name: 'Says what it does',
  parameters: { row: 'notes' },
  args: { title: 'Keep the transcript' },
  render: function Render(args) {
    const [on, setOn] = useState(false);
    return (
      <SwitchLine {...args} sub={on ? 'Who said what, and anyone invited can correct it' : 'Used to write the notes, then deleted'}
        control={<Switch label="Keep the transcript" checked={on} onChange={setOn} />} />
    );
  }
};
