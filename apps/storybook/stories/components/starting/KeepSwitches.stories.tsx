/*
 * KeepSwitches: what a call's notes keep, each a switch with what it means (the transcript, the recording, shared screens),
 * then who writes the notes. Under Write notes on a scheduled call's card (NotesSwitches), and in the organizer's lobby,
 * where What the notes keep opens it in place under Notes, on the night stage (Calls/Lobby and waiting).
 */
import type { NotesChoices } from '@alcove/api';
import { KeepSwitches } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { Box, did } from '../../../src/component';

const KEEP_ALL: NotesChoices = { keepTranscript: true, keepRecording: true, allowScreens: true };

const meta = {
  title: 'Components/Starting a call/KeepSwitches',
  component: KeepSwitches,
  args: { choices: KEEP_ALL, onChoices: did('onChoices') },
  argTypes: { choices: { control: 'object' } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <Box width={380} height="auto">
        <div><KeepSwitches {...args} onChoices={(choices) => { args.onChoices(choices); update({ choices }); }} /></div>
      </Box>
    );
  }
} satisfies Meta<typeof KeepSwitches>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Keeping everything: the transcript, the recording, and what's shared on screen. */
export const KeepingEverything: Story = {};
/** Keeping only the notes: the transcript is used to write them, then deleted, and the recording goes when the call ends. */
export const KeepingOnlyTheNotes: Story = { name: 'Keeping only the notes', args: { choices: { keepTranscript: false, keepRecording: false, allowScreens: false } } };
/** The organizer's AI model runs outside a secure enclave: the line under the switches says so. */
export const UnencryptedModel: Story = { name: 'Unencrypted AI model', args: { modelPrivate: false } };
