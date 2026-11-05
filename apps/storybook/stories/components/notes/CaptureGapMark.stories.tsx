/*
 * CaptureGapMark: where nothing was captured, in its place between the lines of a transcript (in the call's panel and
 * on a note) or between a note's chapters. It says what the gap was and when (a pause, notes turned off, the host's
 * browser offline), and that nothing was recorded, or isn't being while the gap lasts. In the page's theme.
 */
import { CaptureGapMark } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '../../../src/component';

const meta = {
  title: 'Components/Notes and transcript/CaptureGapMark',
  component: CaptureGapMark,
  args: { label: 'Paused 16:20–16:24', detail: 'Nothing was recorded' },
  argTypes: { className: { control: false } },
  render: (args) => <Box width="min(560px, 100%)" height="auto"><CaptureGapMark {...args} /></Box>
} satisfies Meta<typeof CaptureGapMark>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The organizer paused notes for four minutes. */
export const Paused: Story = {};
/** A pause that's still going, in the call. */
export const StillPaused: Story = { name: 'Still paused', args: { label: 'Paused since 16:20', detail: 'Nothing is being recorded' } };
/** A pause that started and ended within a minute. */
export const ShortPause: Story = { name: 'Short pause', args: { label: 'Paused at 16:20' } };
export const NotesOff: Story = { name: 'Notes off', args: { label: 'Notes off 16:31–16:35' } };
/** The host's browser was out of the call, so nothing was captured until it was back. */
export const HostOffline: Story = { name: 'Host offline', args: { label: 'Host offline 16:40–16:41' } };
/** In a narrow column the label stays whole and what follows it is cut short. */
export const Narrow: Story = { render: (args) => <Box width={236} height="auto"><CaptureGapMark {...args} /></Box> };
