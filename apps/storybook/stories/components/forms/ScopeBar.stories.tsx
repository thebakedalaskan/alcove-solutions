/*
 * ScopeBar: in a series, which calls a change is for: this call, or this and later calls. It sits above the foot when a
 * repeating call's card is changed, and inside the question when one is cancelled ("Cancel").
 */
import { Button, FlowBody, FlowFoot, FlowSteps, FlowView, ScopeBar } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { ModalFrame, did } from '../../../src/component';

const meta = {
  title: 'Components/Forms/ScopeBar',
  component: ScopeBar,
  args: { value: 'this', label: 'Change', onChange: did('onChange') },
  argTypes: { value: { control: 'inline-radio', options: ['this', 'following'] } },
  /* A repeating call's card, its time being changed. */
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <ModalFrame>
        <FlowView>
          <FlowSteps steps={[]} at={0} onBack={did('onBack')} onClose={did('onClose')} />
          <FlowBody><h2>Team standup</h2><p className="ac-body">Every weekday at 09:00. Moving to 09:30.</p></FlowBody>
          <ScopeBar {...args} onChange={(value) => { args.onChange(value); update({ value }); }} />
          <FlowFoot summary="Everyone invited hears about the change."><Button variant="primary">Save</Button></FlowFoot>
        </FlowView>
      </ModalFrame>
    );
  }
} satisfies Meta<typeof ScopeBar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Only this call changes. */
export const ThisCall: Story = { name: 'This call' };
/** This call and every one after it. */
export const ThisAndLater: Story = { name: 'This and later calls', args: { value: 'following' } };
/** Cancelling a repeating call asks which in place, inside the question. */
export const Cancelling: Story = {
  args: { label: 'Cancel' },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <ModalFrame>
        <FlowView>
          <FlowSteps steps={[]} at={0} onBack={did('onBack')} onClose={did('onClose')} />
          <FlowBody><h2>Team standup</h2></FlowBody>
          <div className="cf-confirm">
            <span>Cancel {args.value === 'following' ? 'this and later calls' : 'this call'}? {args.value === 'following' ? 'They come' : 'It comes'} off your calendar, and everyone invited is told.</span>
            <ScopeBar {...args} onChange={(value) => { args.onChange(value); update({ value }); }} />
            <span className="row"><span className="acts"><Button variant="quiet" size="sm">Keep it</Button><Button size="sm">Cancel the call</Button></span></span>
          </div>
        </FlowView>
      </ModalFrame>
    );
  }
};
