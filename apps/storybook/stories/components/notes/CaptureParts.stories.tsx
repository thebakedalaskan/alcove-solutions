/*
 * CaptureParts: each kind of capture in a call (the recording, the transcript, AI notes and shared screens), what it
 * does right now, and whether it's on, paused, unavailable or off. It's in the call's "What's captured", in the page's
 * theme. The words follow the call: whose browser takes the notes (`taker`), what that browser can't capture now, AI
 * notes still reading what was transcribed once notes are off, shared screens while they're read, and a breakout room,
 * where nothing is recorded.
 */
import type { CaptureMode, CapturePart, CaptureState, RoomCapture } from '@alcove/api';
import { CaptureParts } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, onStage } from '../../../src/component';
import { iso } from '../../../src/world/clock';
import { ART } from '../../../src/world/people';

const SINCE = iso(0, 16, 2);
const part = (mode: CaptureMode): CapturePart => (mode === 'off' ? { mode, since: null, by: null } : { mode, since: SINCE, by: { kind: 'schedule', name: ART.name } });
interface Parts { recording?: CaptureMode; transcript?: CaptureMode; ai?: CaptureMode; screen?: CaptureMode }
/** What a call captures: all of it (`mode`), each kind the same unless said, and shared screens not read. */
function captured(mode: CaptureMode, p: Parts = {}): CaptureState {
  return {
    mode, recording: part(p.recording ?? mode), transcript: part(p.transcript ?? mode), ai: part(p.ai ?? (mode === 'unavailable' ? 'on' : mode)),
    screen: part(p.screen ?? 'off'), gaps: [], requests: [], asked: null, room: null, away: false, model: null, modelPrivate: true, allowScreens: true
  };
}
/** In a breakout room, what's captured is the room's: never recorded, and heard by one browser there, its scribe. */
function inARoom(transcript: CaptureMode): CaptureState {
  const room: RoomCapture = {
    id: 'room-rollout', mode: transcript === 'unavailable' ? 'unavailable' : 'on', recording: part('off'), transcript: part(transcript), ai: part('on'),
    screen: part('off'), gaps: [], scribe: transcript === 'unavailable' ? null : 'p-kofi'
  };
  return { ...captured('on'), mode: room.mode, recording: room.recording, transcript: room.transcript, ai: room.ai, screen: room.screen, room };
}

const meta = {
  title: 'Components/Notes and transcript/CaptureParts',
  component: CaptureParts,
  args: { capture: captured('on'), taker: 'the organizer', stage: false },
  argTypes: {
    capture: { control: false },
    taker: { control: 'inline-radio', options: ['the organizer', 'the host', 'you', 'Priya'] },
    className: { control: false }
  },
  render: (args) => <Box width="min(360px, 100%)" height="auto"><CaptureParts {...args} /></Box>
} satisfies Meta<typeof CaptureParts>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Notes on, through the organizer's browser; shared screens aren't read. */
export const NotesOn: Story = { name: 'Notes on' };
export const Paused: Story = { args: { capture: captured('paused') } };
/** Notes turned off after they were on: nothing new is recorded or transcribed, and AI notes still read what was. */
export const OffAfterBeingOn: Story = { name: 'Off after being on', args: { capture: captured('off', { ai: 'on' }) } };
/** The browser taking the notes can't record right now, and still transcribes. */
export const CantRecord: Story = { name: 'Can’t record', args: { capture: captured('on', { recording: 'unavailable' }) } };
/** It can't listen right now, so nothing is transcribed, and it still records. */
export const CantListen: Story = { name: 'Can’t listen', args: { capture: captured('on', { transcript: 'unavailable' }) } };
/** It can neither record nor listen. */
export const Unavailable: Story = { args: { capture: captured('unavailable') } };
/** The organizer turned on reading shared screens: what anyone shares is read for the notes, never cameras. */
export const ScreensRead: Story = { name: 'Screens read', args: { capture: captured('on', { screen: 'on' }) } };
/** Your browser takes the notes: you organized the call, or you're hosting it. */
export const YouTakeThem: Story = { name: 'You take them', args: { taker: 'you' } };
/** Priya's browser takes them, standing in for the organizer. */
export const PriyaTakesThem: Story = { name: 'Priya takes them', args: { taker: 'Priya' } };
/** In a breakout room: nothing is recorded or read from shared screens, and one browser there hears it for the room's notes. */
export const InABreakoutRoom: Story = { name: 'In a breakout room', args: { capture: inARoom('on') } };
/** In a breakout room where nobody's browser can transcribe right now. */
export const InARoomNobodyHears: Story = { name: 'In a room nobody hears', args: { capture: inARoom('unavailable') } };
/** On the night stage. */
export const OnTheStage: Story = { ...onStage, name: 'On the stage', args: { stage: true } };
