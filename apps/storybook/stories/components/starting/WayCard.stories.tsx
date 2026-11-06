/*
 * WayCard: one of the two ways to start a call, on the call modal's first view. `now` shows the sun coming up behind an
 * arch, `later` the night before it; pointed at, or reached with the keyboard, the sun rises a little. `kbd` is the key
 * that picks it (Enter, or S), which a phone doesn't show.
 */
import { FlowHead, FlowView, WayCard } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ModalFrame, did } from '../../../src/component';

const meta = {
  title: 'Components/Starting a call/WayCard',
  component: WayCard,
  parameters: { layout: 'centered' },
  args: { art: 'now', title: 'Start now', children: 'Ring your team in, or share a link.', kbd: '↵', onClick: did('onClick') },
  argTypes: { art: { control: 'inline-radio', options: ['now', 'later'] }, title: { control: 'text' }, children: { control: 'text' }, kbd: { control: 'text' } },
  render: (args) => <div style={{ width: 'min(280px, 90vw)' }}><WayCard {...args} /></div>
} satisfies Meta<typeof WayCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Start now: the sun coming up. Enter picks it. */
export const Now: Story = {};
/** Schedule for later: the night before. S picks it. */
export const Later: Story = { args: { art: 'later', title: 'Schedule for later', children: 'Find a time that works for everyone.', kbd: 'S' } };
/** Reached with the keyboard, as the modal opens with Start now in focus: the sun rises a little, and focus rings it. Pointing does the same. */
export const Pointing: Story = { args: { autoFocus: true } };
/** Both, as the first view has them, for a team. */
export const BothWays: Story = {
  name: 'Both ways',
  parameters: { layout: 'padded' },
  render: () => (
    <ModalFrame>
      <FlowView>
        <FlowHead title="Start a call" onClose={did('onClose')} />
        <div className="cf-ways">
          <WayCard art="now" title="Start now" kbd="↵" onClick={did('onNow')}>Ring your team in, or share a link.</WayCard>
          <WayCard art="later" title="Schedule for later" kbd="S" onClick={did('onLater')}>Find a time that works for everyone.</WayCard>
        </div>
      </FlowView>
    </ModalFrame>
  )
};
/** Someone on their own, starting a call with someone they've picked: the same two ways, said for people they meet. */
export const OnTheirOwn: Story = {
  name: 'On their own',
  parameters: { layout: 'padded' },
  render: () => (
    <ModalFrame>
      <FlowView>
        <FlowHead title="Start a call with Jonas" onClose={did('onClose')} />
        <div className="cf-ways">
          <WayCard art="now" title="Start now" kbd="↵" onClick={did('onNow')}>Get a link to send to anyone.</WayCard>
          <WayCard art="later" title="Schedule for later" kbd="S" onClick={did('onLater')}>Pick a time and invite people.</WayCard>
        </div>
      </FlowView>
    </ModalFrame>
  )
};
