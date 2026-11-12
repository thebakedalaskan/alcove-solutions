/*
 * FlowView: one view of the call modal, Start a call's choice. Its head stays put: FlowHead, one heading and the way out.
 * Under it, the two ways to start.
 */
import { FlowHead, FlowView, WayCard } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ModalFrame, did } from '../../../src/component';

const close = did('onClose');

const meta = {
  title: 'Components/Starting a call/FlowView',
  component: FlowView,
  subcomponents: { FlowHead },
  args: { children: null },
  parameters: { controls: { disable: true } }
} satisfies Meta<typeof FlowView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The first view: one heading and the way out (FlowHead), then the two ways to start. */
export const WithAHead: Story = {
  name: 'With a head',
  render: () => (
    <ModalFrame>
      <FlowView>
        <FlowHead title="Start a call" onClose={close} />
        <div className="cf-ways">
          <WayCard art="now" title="Start now" kbd="↵" onClick={did('onNow')}>Ring your team in, or share a link.</WayCard>
          <WayCard art="later" title="Schedule for later" kbd="S" onClick={did('onLater')}>Find a time that works for everyone.</WayCard>
        </div>
      </FlowView>
    </ModalFrame>
  )
};
