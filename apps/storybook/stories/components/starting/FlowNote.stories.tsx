/*
 * FlowNote: something to know, in place, on the scheduler or a call's card: `caution` for what needs an answer or went
 * wrong, `info` for the rest. `actions` are what can be done about it, as links at its end. A save that didn't go through
 * sits above the foot, with its reference to quote.
 */
import { MAX_CALL_DOCUMENTS, MAX_GUESTS } from '@alcove/api';
import { Button, FlowBody, FlowFoot, FlowHead, FlowNote, FlowView, ICON_NAMES, Icon, PersonToken, RequestRef, SchedField, SchedFoot, SchedGroup, SchedNote, SchedPanel, SchedRow, type IconName } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { ModalFrame, did } from '../../../src/component';
import { KOFI, MANY, PRIYA } from '../../../src/world/people';

const TOO_MANY = 312;

/** The scheduler's editor, on its sheet: what's in it, then its foot. */
function Scheduler({ children, foot }: { children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="sc-sheet" style={{ margin: 0, width: 'min(356px, 100%)', height: 560, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <SchedPanel kicker="New call" label="Schedule a call" onClose={did('onClose')} foot={foot}>{children}</SchedPanel>
    </div>
  );
}
/** Who, on the scheduler, with a pasted list in the field, and the note under it. */
function Who({ children, over = false }: { children: ReactNode; over?: boolean | undefined }) {
  return (
    <Scheduler>
      <SchedGroup label="Who">
        <SchedRow icon="people">
          <SchedField>
            <PersonToken people={MANY.slice(0, 4).map((c) => c.person)} label="Pasted list" count={over ? TOO_MANY : 6} removeLabel="Remove Pasted list" onRemove={did('onRemove')} />
            <input type="text" aria-label="Add people" placeholder="Add someone" autoComplete="off" spellCheck={false} />
          </SchedField>
        </SchedRow>
        <SchedNote>{children}</SchedNote>
      </SchedGroup>
    </Scheduler>
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

/** Something that needs an answer before going on: too many people, so Schedule waits. */
export const Caution: Story = {};
/** Something to know, nothing wrong: the most documents a call can bring are picked, on a call's card. */
export const Info: Story = {
  args: { tone: 'info', icon: 'fileText', className: undefined, children: `A call can bring ${MAX_CALL_DOCUMENTS} documents at most.` },
  render: (args) => (
    <ModalFrame>
      <FlowView>
        <FlowHead title="Bring documents" onClose={did('onClose')} />
        <FlowBody>
          <p className="cf-sub">From the Product workspace</p>
          <FlowNote {...args} />
          <div className="cf-docs" role="group" aria-label="Documents">
            <Doc icon="fileText" name="Launch plan" by="Priya" />
            <Doc icon="table" name="Launch checklist" by="Maya" />
          </div>
        </FlowBody>
        <FlowFoot summary="The notes can read them too. Anyone who can’t open one is told, without seeing its name.">
          <Button variant="primary" onClick={did('onBring')}>Bring {MAX_CALL_DOCUMENTS}</Button>
        </FlowFoot>
      </FlowView>
    </ModalFrame>
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
/** A save that didn't go through: in place above the scheduler's foot, with the reference to quote. Nothing chosen is lost. */
export const FailedSave: Story = {
  name: 'A failed save',
  args: { icon: 'alert', children: 'Can’t reach Alcove. Check your connection.', actions: <RequestRef id="sb-req-7f3a9c" /> },
  render: (args) => (
    <Scheduler foot={(
      <SchedFoot notice={<FlowNote {...args} />} line="Google Calendar invites Priya and Kofi.">
        <Button variant="quiet" onClick={did('onCancel')}>Cancel</Button>
        <Button variant="primary" onClick={did('onSchedule')}>Schedule</Button>
      </SchedFoot>
    )}>
      <SchedGroup label="Who">
        <SchedRow icon="people">
          <SchedField>
            <PersonToken people={[PRIYA]} label="Priya" title={PRIYA.email} onRemove={did('onRemove')} />
            <PersonToken people={[KOFI]} label="Kofi" title={KOFI.email} onRemove={did('onRemove')} />
            <input type="text" aria-label="Add people" placeholder="Add someone" autoComplete="off" spellCheck={false} />
          </SchedField>
        </SchedRow>
      </SchedGroup>
    </Scheduler>
  )
};
