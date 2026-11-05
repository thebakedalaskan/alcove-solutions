/*
 * CaptureModeMark: on, paused, unavailable or off, as a small mark beside each kind of capture (the recording, the
 * transcript, AI notes and shared screens). On carries the notes' crimson dot, paused the pause mark, unavailable the
 * caution mark, and off is an outline. It renders in the page's theme, and `stage` is for the night call stage.
 */
import type { CaptureMode } from '@alcove/api';
import { CaptureModeMark } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row, onStage } from '../../../src/component';

const MODES = ['on', 'paused', 'unavailable', 'off'] as const satisfies readonly CaptureMode[];
const Every = ({ stage }: { stage: boolean }) => <Row>{MODES.map((mode) => <CaptureModeMark key={mode} mode={mode} stage={stage} />)}</Row>;

const meta = {
  title: 'Components/Notes and transcript/CaptureModeMark',
  component: CaptureModeMark,
  parameters: { layout: 'centered' },
  args: { mode: 'on', stage: false },
  argTypes: { mode: { control: 'inline-radio', options: MODES } }
} satisfies Meta<typeof CaptureModeMark>;
export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = {};
export const Paused: Story = { args: { mode: 'paused' } };
/** The browser taking the notes can't do this one right now. */
export const Unavailable: Story = { args: { mode: 'unavailable' } };
export const Off: Story = { args: { mode: 'off' } };
export const AllOfThem: Story = { name: 'All of them', render: (args) => <Every stage={args.stage === true} /> };
/** On the night stage, beside each kind of capture before joining. */
export const OnTheStage: Story = { ...onStage, name: 'On the stage', args: { stage: true }, render: (args) => <Every stage={args.stage === true} /> };
