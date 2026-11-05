/*
 * FlowNote: something to know, in place in the call modal: `caution` for what needs an answer or went wrong, `info` for
 * the rest. `actions` are what can be done about it, as links at its end. A save that didn't go through sits above the
 * foot, with its reference to quote.
 */
import { MAX_CALL_DOCUMENTS, MAX_GUESTS } from '@alcove/api';
import { Button, FlowBody, FlowFoot, FlowNote, FlowRow, FlowSteps, FlowView, ICON_NAMES, Icon, PersonToken, RequestRef, type IconName } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { ModalFrame, did } from '../../../src/component';
import { MANY } from '../../../src/world/people';

const STEPS = ['Who', 'When', 'Details'] as const;
const TOO_MANY = 312;

/** A view of the call modal, at a step, with the note in place. */
function InView({ at, children, foot }: { at: number; children: ReactNode; foot: ReactNode }) {
  return (
    <ModalFrame>
      <FlowView>
        <FlowSteps steps={STEPS} at={at} onBack={did('onBack')} onClose={did('onClose')} />
        {children}
        {foot}
      </FlowView>
    </ModalFrame>
  );
}
/** Who, with a pasted list in the field. */
function Who({ children, over = false }: { children: ReactNode; over?: boolean | undefined }) {
  return (
    <InView at={0} foot={<FlowFoot><Button variant="primary" disabled={over} onClick={did('onNext')}>Find a time</Button></FlowFoot>}>
      <FlowBody>
        <h2>Who’s it with?</h2>
        <div className="cf-field">
          <PersonToken people={MANY.slice(0, 4).map((c) => c.person)} label="Pasted list" count={over ? TOO_MANY : 6} removeLabel="Remove Pasted list" onRemove={did('onRemove')} />
          <input type="text" aria-label="Add people" placeholder="Add someone else" autoComplete="off" spellCheck={false} />
        </div>
        {children}
      </FlowBody>
    </InView>
  );
}
/** A document the call is bringing. */
function Doc({ icon, name, by }: { icon: IconName; name: string; by: string }) {
  return (
    <button type="button" className="cf-doc on" aria-pressed="true" onClick={did('onToggle')}>
      <span className="tick"><Icon name="check" size={14} /></span>
      <span className="cf-tile"><Icon name={icon} size={17} /></span>
      <span className="min-w-0"><b className="ac-clamp-1">{name}</b><small>{by}’s</small></span>
      <span className="when">Today</span>
    </button>
  );
}

const meta = {
  title: 'Components/Starting a call/FlowNote',
  component: FlowNote,
  args: {
    tone: 'caution',
    icon: 'people',
    children: `A call can invite ${MAX_GUESTS} people at most, and this is ${TOO_MANY}. Remove the pasted list and paste a shorter one to go on.`
  },
  argTypes: {
    tone: { control: 'inline-radio', options: ['caution', 'info'] },
    icon: { control: 'select', options: ICON_NAMES },
    children: { control: 'text' },
    actions: { control: false },
    className: { control: false }
  },
  render: (args) => <Who over><FlowNote {...args} /></Who>
} satisfies Meta<typeof FlowNote>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Something that needs an answer before going on: too many people, so Find a time waits. */
export const Caution: Story = {};
/** Something to know, nothing wrong: the most documents a call can bring are picked. */
export const Info: Story = {
  args: { tone: 'info', icon: 'fileText', children: `A call can bring ${MAX_CALL_DOCUMENTS} documents at most.` },
  render: (args) => (
    <InView at={2} foot={<FlowFoot summary="The notes can read them too. Anyone who can’t open one is told, without seeing its name."><Button variant="primary" onClick={did('onBring')}>Bring {MAX_CALL_DOCUMENTS}</Button></FlowFoot>}>
      <FlowBody>
        <h2>Bring documents</h2>
        <p className="cf-sub">From the Product workspace</p>
        <FlowNote {...args} />
        <div className="cf-docs" role="group" aria-label="Documents">
          <Doc icon="fileText" name="Launch plan" by="Priya" />
          <Doc icon="table" name="Launch checklist" by="Maya" />
        </div>
      </FlowBody>
    </InView>
  )
};
/** With what can be done about it: an address that isn't finished, put right or left out. */
export const WithActions: Story = {
  name: 'With actions',
  args: {
    icon: 'mail',
    children: 'sam@vandelay needs its ending. Did you mean .industries?',
    actions: (
      <>
        <button type="button" className="lk" onClick={did('onUseIt')}>Use it</button>
        <button type="button" className="lk" onClick={did('onLeaveOut')}>Leave out</button>
      </>
    )
  },
  render: (args) => <Who><FlowNote {...args} /></Who>
};
/** A save that didn't go through: in place above the foot, with the reference to quote. What was being saved stays as it was. */
export const FailedSave: Story = {
  name: 'A failed save',
  args: { icon: 'alert', children: 'Can’t reach Alcove. Check your connection.', actions: <RequestRef id="sb-req-7f3a9c" />, className: 'cf-fail' },
  render: (args) => (
    <InView at={2} foot={<><FlowNote {...args} /><FlowFoot summary="2 people get an invitation."><Button variant="primary" onClick={did('onSchedule')}>Schedule</Button></FlowFoot></>}>
      <FlowBody>
        <input className="cf-title" type="text" aria-label="Name the call" defaultValue="Design sync" autoComplete="off" />
        <div className="cf-rows" style={{ marginTop: 14 }}>
          <FlowRow icon="cal" title="Thu 5 Nov, 14:00 – 14:30" sub="Doesn’t repeat" onClick={did('onWhen')} />
          <FlowRow icon="people" title="Priya and Kofi" sub="2 people" onClick={did('onWho')} />
        </div>
      </FlowBody>
    </InView>
  )
};
