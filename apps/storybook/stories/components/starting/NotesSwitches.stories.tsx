/*
 * NotesSwitches: whether a call writes notes, and what they keep, changed on the Notes view of a scheduled call's card.
 * Off, nothing else matters, so only Write notes shows. On, the transcript and the recording can each be kept or deleted,
 * and shared screens can be read. Scheduling a call sets the same things under Notes, on the scheduler.
 */
import type { NotesChoices } from '@alcove/api';
import { Button, FlowBody, FlowFoot, FlowHead, FlowView, NotesSwitches } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { ModalFrame, did } from '../../../src/component';

const KEEP_ALL: NotesChoices = { keepTranscript: true, keepRecording: true, allowScreens: true };

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
          <FlowHead title="Notes" onClose={did('onClose')} />
          <FlowBody>
            <div>
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
export const KeepingOnlyTheNotes: Story = { name: 'Keeping only the notes', args: { choices: { keepTranscript: false, keepRecording: false, allowScreens: false } } };
/** The organizer's AI model runs outside a secure enclave: the line under the switches says so. */
export const UnencryptedModel: Story = { name: 'Unencrypted AI model', args: { modelPrivate: false } };
