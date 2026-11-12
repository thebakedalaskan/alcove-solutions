/*
 * ScopeBar: in a series, which calls a change is for: this call, or this and later calls. It sits above the foot when a
 * repeating call is changed.
 */
import { Button, FlowBody, FlowFoot, FlowHead, FlowView, ScopeBar } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { ModalFrame, did } from '../../../src/component';

const meta = {
  title: 'Components/Forms/ScopeBar',
  component: ScopeBar,
  args: { value: 'this', label: 'Change', onChange: did('onChange') },
  argTypes: { value: { control: 'inline-radio', options: ['this', 'following'] } },
  /* A repeating call, its time being changed. */
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <ModalFrame>
        <FlowView>
          <FlowHead title="Team standup" onClose={did('onClose')} />
          <FlowBody><p className="ac-body">Every weekday at 09:00. Moving to 09:30.</p></FlowBody>
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
