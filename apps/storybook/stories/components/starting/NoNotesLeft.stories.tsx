/*
 * NoNotesLeft: no notes left this period, said where a call with notes on is started or scheduled (docs/product/user-flows.md 16.10):
 * until when they come back, in caution, and under it what to do about it, Get Pro and a way on without notes. Under a Notes
 * switch it says "None left until…"; on its own, under the ways to start, it names them, with its mark, as a note.
 */
import { Button, FlowHead, FlowView, NoNotesLeft, Switch, WayCard } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentProps } from 'react';
import { ModalFrame, did } from '../../../src/component';

/** Start a call's first question, with the note under its ways. */
function UnderTheWays(args: ComponentProps<typeof NoNotesLeft>) {
  return (
    <ModalFrame>
      <FlowView>
        <FlowHead title="Start a call" onClose={did('onClose')} />
        <div className="cf-ways">
          <WayCard art="now" title="Start now" kbd="↵" onClick={did('Start now')}>Ring your team in, or share a link.</WayCard>
          <WayCard art="later" title="Schedule for later" kbd="S" onClick={did('Schedule for later')}>Find a time that works for everyone.</WayCard>
        </div>
        <NoNotesLeft {...args} />
      </FlowView>
    </ModalFrame>
  );
}

const meta = {
  title: 'Components/Starting a call/NoNotesLeft',
  component: NoNotesLeft,
  args: {
    until: '20 November',
    alone: false,
    children: <><Button size="sm" variant="secondary" onClick={did('Get Pro')}>Get Pro</Button><Button size="sm" variant="quiet" onClick={did('Start without notes')}>Start without notes</Button></>
  },
  argTypes: { until: { control: 'text' }, alone: { control: 'boolean' }, children: { control: false }, className: { control: false } }
} satisfies Meta<typeof NoNotesLeft>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Under the Notes switch, as scheduling has it: the switch stays on, since notes may be back by the time the call starts. */
export const UnderTheSwitch: Story = {
  name: 'Under the notes switch',
  args: { children: <Button size="sm" variant="secondary" onClick={did('Get Pro')}>Get Pro</Button> },
  render: (args) => (
    <ModalFrame>
      <div style={{ padding: '18px 20px', display: 'grid', gap: 10 }}>
        <div className="cf-sw"><span><b>Notes</b><small>Everyone invited gets them</small></span><Switch checked label="Notes" onChange={did('onNotes')} /></div>
        <NoNotesLeft {...args} />
      </div>
    </ModalFrame>
  )
};
/** On its own under Start now and Schedule for later: Get Pro, or Start without notes. */
export const UnderTheWaysToStart: Story = {
  name: 'Under the ways to start',
  args: { alone: true },
  render: (args) => <UnderTheWays {...args} />
};
/** On a phone the note stacks: the words, then the ways on. */
export const UnderTheWaysToStartPhone: Story = { ...UnderTheWaysToStart, name: 'Under the ways to start, on a phone', globals: { viewport: { value: 'phone', isRotated: false } } };
/** On a paid plan, getting Pro doesn't help: more hours for this period do. */
export const OnAPaidPlan: Story = {
  name: 'On a paid plan',
  args: { alone: true, children: <><Button size="sm" variant="secondary" onClick={did('Add 10 hours')}>Add 10 hours · $15</Button><Button size="sm" variant="quiet" onClick={did('Start without notes')}>Start without notes</Button></> },
  render: (args) => <UnderTheWays {...args} />
};
