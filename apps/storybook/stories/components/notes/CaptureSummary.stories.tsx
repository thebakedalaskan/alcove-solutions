/*
 * CaptureSummary: what a call captures, for someone about to join it, beside their preview on the night stage. The
 * notes sign, what happens to what they say, each kind of capture once the call has started, what the call won't keep,
 * and who gets the notes. Before the organizer starts the call it says what will happen. It never names anyone, and
 * never says anything that was said.
 */
import type { CaptureMode, CapturePart, CaptureState, NotesChoices } from '@alcove/api';
import { CaptureSummary } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, onStage } from '../../../src/component';
import { iso } from '../../../src/world/clock';

const SINCE = iso(0, 16, 2);
/** Someone asking to join isn't told who changed what. */
const part = (mode: CaptureMode): CapturePart => (mode === 'off' ? { mode, since: null, by: null } : { mode, since: SINCE, by: { kind: 'schedule' } });
interface Parts { recording?: CaptureMode; transcript?: CaptureMode; ai?: CaptureMode; screen?: CaptureMode }
/** What a call captures: all of it (`mode`), each kind the same unless said, and shared screens not read. */
function captured(mode: CaptureMode, p: Parts = {}, away = false): CaptureState {
  return {
    mode, recording: part(p.recording ?? mode), transcript: part(p.transcript ?? mode), ai: part(p.ai ?? (mode === 'unavailable' ? 'on' : mode)),
    screen: part(p.screen ?? 'off'), gaps: [], requests: [], asked: null, room: null, away, model: null, modelPrivate: true, allowScreens: true
  };
}
const KEEPS_ALL: NotesChoices = { keepTranscript: true, keepRecording: true, allowScreens: false };

const meta = {
  title: 'Components/Notes and transcript/CaptureSummary',
  component: CaptureSummary,
  ...onStage,
  args: { notes: 'on', choices: KEEPS_ALL, capture: null, taker: 'the organizer' },
  argTypes: {
    notes: { control: 'inline-radio', options: ['on', 'off'] },
    choices: { control: 'object' },
    capture: { control: false },
    who: { control: 'text' },
    taker: { control: 'inline-radio', options: ['the organizer', 'the host'] },
    className: { control: false }
  },
  render: (args) => <Box width="min(400px, 100%)" height="auto"><CaptureSummary {...args} /></Box>
} satisfies Meta<typeof CaptureSummary>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The call hasn't started, and it's set to have notes: what will happen once it does. */
export const BeforeItStarts: Story = { name: 'Before it starts' };
/** The call hasn't started, and it isn't set to have notes. */
export const BeforeItStartsNotesOff: Story = { name: 'Before it starts, notes off', args: { notes: 'off' } };
export const NotesOn: Story = { name: 'Notes on', args: { capture: captured('on') } };
/** Notes on, with an AI model outside a secure enclave: the line about confidential compute says so instead. */
export const UnencryptedModel: Story = { name: 'Unencrypted AI model', args: { capture: { ...captured('on'), modelPrivate: false } } };
/** Notes on, and the organizer has shared screens read for them too. */
export const ScreensRead: Story = { name: 'Screens read', args: { capture: captured('on', { screen: 'on' }) } };
/** Notes on, but the browser taking them can't record right now: what's said is still transcribed. */
export const CantRecord: Story = { name: 'Can’t record', args: { capture: captured('on', { recording: 'unavailable' }) } };
/** Notes on, but the browser taking them can't listen right now: what's said is still recorded. */
export const CantListen: Story = { name: 'Can’t listen', args: { capture: captured('on', { transcript: 'unavailable' }) } };
export const Paused: Story = { args: { capture: captured('paused') } };
/** Notes on, but the browser taking them can neither record nor listen, so nothing is captured. */
export const Unavailable: Story = { args: { capture: captured('unavailable') } };
/** The organizer's browser has left the call (its connection dropped, or it's reloading): nothing is captured until it's back. */
export const BrowserAway: Story = { name: 'Browser away', args: { capture: captured('unavailable', {}, true) } };
/** Nothing said is captured, and what anyone shares on screen is still read. */
export const UnavailableWithAScreenShared: Story = { name: 'Unavailable, with a screen shared', args: { capture: captured('unavailable', { screen: 'on' }) } };
export const AwayWithAScreenShared: Story = { name: 'Away, with a screen shared', args: { capture: captured('unavailable', { screen: 'on' }, true) } };
/** The call started without notes: nothing to keep, so nothing more is said. */
export const Off: Story = { args: { capture: captured('off') } };
/** The call doesn't keep the transcript or the recording: said before anyone decides to join. */
export const KeepsLess: Story = { name: 'Keeps less', args: { capture: captured('on'), choices: { keepTranscript: false, keepRecording: false, allowScreens: false } } };
/** Who gets the notes, said for someone invited. */
export const YoureInvited: Story = { name: 'You’re invited', args: { capture: captured('on'), who: 'You’re invited, so you get them.' } };
/** Who gets the notes, said for someone asking to join. */
export const AskingToJoin: Story = { name: 'Asking to join', args: { capture: captured('on'), who: 'Once Priya lets you in, you’re added to the invite and get them.' } };
/** Someone hosts while the organizer is away, so it's the host's browser that takes the notes. */
export const WhileSomeoneHosts: Story = { name: 'While someone hosts', args: { capture: captured('unavailable'), taker: 'the host' } };
