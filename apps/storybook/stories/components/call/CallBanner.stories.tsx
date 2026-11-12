/*
 * CallBanner: something about the whole call that stays until its × is pressed, dropped from the top of the stage, centred,
 * always at night. Caution for what has stopped, information for what's coming. Its ways on sit in a row under the words:
 * when the organizer's notes run out, Get Pro (filled) and more hours for this period, which open checkout over the call
 * (the plans spec's doors, 4; the canvas's CallOut).
 */
import { Button, CallBanner } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did, onStage } from '../../../src/component';

const meta = {
  title: 'Components/In a call/CallBanner',
  component: CallBanner,
  ...onStage,
  args: {
    icon: 'notesPen', tone: 'caution', title: 'Notes stopped at this period’s 5 hours', onClose: did('onClose'),
    children: 'The call carries on. Notes start again the moment you have more.',
    actions: <><Button size="sm" variant="primary" onClick={did('Get Pro')}>Get Pro</Button><Button size="sm" variant="secondary" onClick={did('Add 10 hours')}>Add 10 hours · $15</Button></>
  },
  argTypes: {
    tone: { control: 'inline-radio', options: ['caution', 'info'] },
    icon: { control: false }, actions: { control: false }, title: { control: 'text' }, children: { control: 'text' }
  },
  render: (args) => <div className="ic-limits" style={{ top: 24 }}><CallBanner {...args} /></div>
} satisfies Meta<typeof CallBanner>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The organizer's notes for the period ran out, on Free: the two ways to more under the words. */
export const NotesStopped: Story = { name: 'Notes stopped, for the organizer' };
/** On a phone, the same, the length of the stage. */
export const NotesStoppedPhone: Story = { name: 'Notes stopped, on a phone', globals: { viewport: { value: 'phone', isRotated: false } } };
/** Their storage filled instead: Get Pro, and Make room in the Drive. */
export const StorageFull: Story = {
  name: 'Storage full, for the organizer',
  args: {
    title: 'Notes stopped: your storage is full', children: 'The call carries on. Notes start again the moment you have room.',
    actions: <><Button size="sm" variant="primary" onClick={did('Get Pro')}>Get Pro</Button><Button size="sm" variant="secondary" onClick={did('Make room')}>Make room</Button></>
  }
};
/** Everyone else is told whose notes ran out, with nothing to buy: a call's notes are on its organizer's plan. */
export const NotesStoppedForEveryoneElse: Story = {
  name: 'Notes stopped, for everyone else',
  args: { title: 'Notes stopped', children: 'Priya’s notes for this period are used up, and the call carries on. What was written before stays.', actions: undefined }
};
/** The organizer alone, about 5 minutes before notes would stop at this call's pace. */
export const RunningOut: Story = {
  name: 'Notes running out',
  args: { icon: 'clock', tone: 'info', title: 'About 5 minutes of notes left', children: 'At this call’s pace. Notes stop then, and the call goes on.', actions: undefined }
};
/** Everyone, 5 minutes before the call reaches its longest. */
export const EndsSoon: Story = {
  name: 'The call ends soon',
  args: { icon: 'clock', tone: 'info', title: 'This call ends at 14:30', children: 'A call runs for up to 10 hours. Its notes are written once it ends.', actions: undefined }
};
