/*
 * NotesSwitches: whether a call writes notes, and what they keep, as it's set when a call is scheduled. Off, nothing
 * else matters, so only Write notes shows. On, the transcript and the recording can each be kept or deleted, and shared
 * screens can be read. It opens under the Notes row in Details, and on its own view of a scheduled call's card.
 */
import type { NotesChoices } from '@alcove/api';
import { Button, FlowBody, FlowFoot, FlowRow, FlowSteps, FlowView, NotesSwitches } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { ModalFrame, did } from '../../../src/component';

const KEEP_ALL: NotesChoices = { keepTranscript: true, keepRecording: true, readScreens: true };

const meta = {
  title: 'Components/Starting a call/NotesSwitches',
  component: NotesSwitches,
  args: { notes: 'on', choices: KEEP_ALL, onNotes: did('onNotes'), onChoices: did('onChoices') },
  argTypes: { notes: { control: 'inline-radio', options: ['on', 'off'] }, choices: { control: 'object' } },
  /* The card's Notes view: a scheduled call's notes, changed on their own. */
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <ModalFrame>
        <FlowView>
          <FlowSteps steps={[]} at={0} onBack={did('onBack')} onClose={did('onClose')} />
          <FlowBody>
            <h2>Notes</h2>
            <div className="cf-rows" style={{ borderTop: 0 }}>
              <NotesSwitches {...args} onNotes={(notes) => { args.onNotes(notes); update({ notes }); }} onChoices={(choices) => { args.onChoices(choices); update({ choices }); }} />
            </div>
          </FlowBody>
          <FlowFoot summary="Everyone invited hears about the change."><Button variant="primary">Save</Button></FlowFoot>
        </FlowView>
      </ModalFrame>
    );
  }
} satisfies Meta<typeof NotesSwitches>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Notes on, keeping everything: the transcript, the recording, and what's shared on screen. */
export const On: Story = {};
/** Off: nothing is recorded, so the other switches go. */
export const Off: Story = { args: { notes: 'off' } };
/** On, keeping only the notes: the transcript and the recording are deleted once they've done their job. */
export const KeepingOnlyTheNotes: Story = { name: 'Keeping only the notes', args: { choices: { keepTranscript: false, keepRecording: false, readScreens: false } } };
/** Under the Notes row in Details, the last step of scheduling, where it opens in place. */
export const InDetails: Story = {
  name: 'Under its row in Details',
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    const on = args.notes === 'on';
    return (
      <ModalFrame>
        <FlowView>
          <FlowSteps steps={['Who', 'When', 'Details']} at={2} onBack={did('onBack')} onClose={did('onClose')} />
          <FlowBody>
            <h2>Design review</h2>
            <div className="cf-rows">
              <FlowRow icon="notes" on={on} title={on ? 'Notes on' : 'Notes off'} sub={on ? 'Everyone invited gets them' : 'Nothing is recorded'} expanded onClick={did('onRow')} />
              <div className="cf-more">
                <NotesSwitches {...args} onNotes={(notes) => { args.onNotes(notes); update({ notes }); }} onChoices={(choices) => { args.onChoices(choices); update({ choices }); }} />
              </div>
            </div>
          </FlowBody>
          <FlowFoot summary="Priya and Kofi get an invitation."><Button variant="primary" icon="cal">Schedule</Button></FlowFoot>
        </FlowView>
      </ModalFrame>
    );
  }
};
