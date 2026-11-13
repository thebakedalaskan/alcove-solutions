/*
 * CaptureSign: the notes sign, in the same place for everyone in a call, and in the pre-join and the call's own
 * "What's captured". On is the crimson sign with its pulsing dot; paused shows the pause mark; unavailable (notes are on,
 * but the browser taking them can't capture anything) the caution mark; off is quiet, or says Notes requested while
 * someone in the call has asked for them. Pausing… is the organizer's own while their pause is on its way. Notes stopped
 * is off because the organizer's plan ran out of notes or storage, a problem, in caution. It renders in the page's theme,
 * and `stage` is for the night call stage.
 */
import type { CaptureMode } from '@alcove/api';
import { CaptureSign } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row, onStage } from '../../../src/component';

const MODES = ['on', 'paused', 'unavailable', 'off'] as const satisfies readonly CaptureMode[];

/** Every sign side by side: each mode, then Notes requested, Pausing… and Notes stopped. */
const Every = ({ stage }: { stage: boolean }) => (
  <Row>
    {MODES.map((mode) => <CaptureSign key={mode} mode={mode} stage={stage} />)}
    <CaptureSign mode="off" requested stage={stage} />
    <CaptureSign mode="on" pausing stage={stage} />
    <CaptureSign mode="off" stopped stage={stage} />
  </Row>
);

const meta = {
  title: 'Components/Notes and transcript/CaptureSign',
  component: CaptureSign,
  parameters: { layout: 'centered' },
  args: { mode: 'on', requested: false, pausing: false, stopped: false, stage: false },
  argTypes: { mode: { control: 'inline-radio', options: MODES }, className: { control: false } }
} satisfies Meta<typeof CaptureSign>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Notes on and capturing: the only crimson there is. */
export const On: Story = {};
/** The organizer paused notes: nothing is captured until they resume. */
export const Paused: Story = { args: { mode: 'paused' } };
/** Notes are on, but the browser taking them can't record or listen right now. */
export const Unavailable: Story = { args: { mode: 'unavailable' } };
export const Off: Story = { args: { mode: 'off' } };
/** Notes are off, and someone in the call has asked the organizer for them. */
export const Requested: Story = { args: { mode: 'off', requested: true } };
/** The organizer pressed Pause: their browser has stopped capturing, and the sign breathes until the call answers. */
export const Pausing: Story = { args: { pausing: true } };
/** The organizer's plan ran out of notes or storage: notes are off for everyone, in caution, and the call goes on. */
export const Stopped: Story = { args: { mode: 'off', stopped: true } };
/** Stopped, on the night stage, in the call's top bar. */
export const StoppedOnTheStage: Story = { ...onStage, name: 'Stopped, on the stage', args: { mode: 'off', stopped: true, stage: true } };
export const AllOfThem: Story = { name: 'All of them', render: (args) => <Every stage={args.stage === true} /> };
/** On the night stage, in the call's top bar. */
export const OnTheStage: Story = { ...onStage, name: 'On the stage', args: { stage: true }, render: (args) => <Every stage={args.stage === true} /> };
