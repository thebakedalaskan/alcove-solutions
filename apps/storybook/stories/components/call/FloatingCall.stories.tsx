/*
 * FloatingCall is the compact call's real presentation, without a browser window or a second call session. Its picture
 * is a drawn camera frame or shared screen here. Native opening, window close and automatic PiP belong to the browser;
 * Calls/Floating call leaves the real call ready for that hand-off instead of replacing the browser's API.
 */
import { CallTimerButton, FloatingCall, PortraitArt, ScreenShot, type FloatingCallProps } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { useArgs } from 'storybook/preview-api';
import { LeaveSheet } from '~/features/call/session/LeaveSheet';
import { screenImage } from '../../../src/api/media';
import { Box, did, onStage } from '../../../src/component';
import { LAUNCH_CHECKLIST } from '../../../src/world/notes';
import { AIKO, INES, KOFI, PRIYA } from '../../../src/world/people';

/** The demo world's illustrated person standing in for a camera picture; it never opens a camera. */
const speakerPicture = PRIYA.portrait ? (
  <svg viewBox="0 20 200 220" preserveAspectRatio="xMidYMax meet" role="img" aria-label="Priya’s illustrated camera picture" style={{ width: '100%', height: '100%', background: PRIYA.portrait.bg }}>
    <PortraitArt p={PRIYA.portrait} />
  </svg>
) : null;
const sharedPicture = <ScreenShot src={screenImage(LAUNCH_CHECKLIST)} alt="The drawn launch checklist, shared by Priya" width={LAUNCH_CHECKLIST.width} height={LAUNCH_CHECKLIST.height} />;

/** The call's own question, in its inline child-document mode. No call is ended by a component story. */
function ConfirmationPreview(args: FloatingCallProps) {
  const [open, setOpen] = useState(true);
  return (
    <Box width="min(400px, 100%)" height={420}>
      <FloatingCall {...args} onLeave={() => { args.onLeave(); setOpen(true); }}>
        {open && <LeaveSheet inline open onOpenChange={setOpen} title={args.title} elapsed={720} hosting organizer standingInFor={null}
          next={[{ id: 'preview-priya', person: PRIYA }, { id: 'preview-kofi', person: KOFI }]} notes locked={false} others={3}
          getting={[PRIYA, KOFI, AIKO]} leaving={args.busy} ended={null}
          onEnd={did('End call for everyone')} onHandOff={did('Leave and keep it going')} onRead={did('Read notes')} onHome={did('Home')} />}
      </FloatingCall>
    </Box>
  );
}

const meta = {
  title: 'Components/In a call/FloatingCall',
  component: FloatingCall,
  ...onStage,
  args: {
    title: 'Launch review', picture: speakerPicture, person: PRIYA, label: 'Priya', connection: 'connected',
    mic: { on: true, pending: false, problem: null }, cam: { on: false, pending: false, problem: null },
    hand: false, handPending: false, busy: false, soundBlocked: false,
    attention: { hands: 0, questions: 0, waiting: 0, chat: 0 }, error: null,
    onMic: did('Microphone'), onCam: did('Camera'), onHand: did('Hand'), onLeave: did('Leave'), onReturn: did('Return'),
    onAttention: did('Open attention in the call'), onSound: did('Enable sound')
  },
  argTypes: {
    picture: { control: false }, person: { control: false }, children: { control: false },
    connection: { control: 'select', options: ['connecting', 'connected', 'reconnecting', 'ended'] },
    mic: { control: 'object' }, cam: { control: 'object' }, attention: { control: 'object' }
  },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <Box width="min(400px, 100%)" height={420}>
        <FloatingCall {...args}
          onMic={() => { args.onMic(); if (!args.mic.pending) update({ mic: { ...args.mic, on: !args.mic.on, problem: null } }); }}
          onCam={() => { args.onCam(); if (!args.cam.pending) update({ cam: { ...args.cam, on: !args.cam.on, problem: null } }); }}
          onHand={() => { args.onHand(); if (!args.handPending) update({ hand: !args.hand }); }} />
      </Box>
    );
  }
} satisfies Meta<typeof FloatingCall>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A settled speaker's camera picture, with no audio or media ownership in this component. */
export const Speaker: Story = {};
/** The selected live share occupies the same picture. It carries no share zoom, mark or history controls. */
export const SharedScreen: Story = { name: 'Shared screen', args: { picture: sharedPicture, label: 'Priya’s screen' } };
/** A speaker whose camera is off stays in their arch. */
export const CameraOff: Story = { name: 'Camera off', args: { picture: null } };
export const Initial: Story = { args: { picture: null, person: INES, label: 'Ines' } };
export const NobodyElse: Story = { name: 'Nobody else here', args: { picture: null, person: null, label: 'You’re the only one here' } };
export const DevicesOff: Story = { name: 'Devices off', args: { mic: { on: false, pending: false, problem: null }, cam: { on: false, pending: false, problem: null } } };
export const MicrophonePending: Story = { name: 'Microphone pending', args: { mic: { on: false, pending: true, problem: null } } };
export const CameraPending: Story = { name: 'Camera pending', args: { cam: { on: false, pending: true, problem: null } } };
export const MicrophoneFailed: Story = { name: 'Microphone failed', args: { mic: { on: false, pending: false, problem: 'Couldn’t turn on your microphone. Try again.' } } };
export const CameraFailed: Story = { name: 'Camera failed', args: { cam: { on: false, pending: false, problem: 'Couldn’t turn on your camera. Try again.' } } };
export const HandRaised: Story = { name: 'Hand raised', args: { hand: true } };
export const HandPending: Story = { name: 'Hand pending', args: { handPending: true } };
export const Connecting: Story = { args: { connection: 'connecting', picture: null } };
/** A transient reconnect keeps the picture and the call open. */
export const Reconnecting: Story = { args: { connection: 'reconnecting' } };
/** Only counts appear: personal notes and message bodies never enter the compact component. */
export const Attention: Story = { args: { attention: { hands: 2, questions: 3, waiting: 1, chat: 3 } } };
/** Q&A has a separate persistent count and returns to its own full-call tab. */
export const Questions: Story = { args: { attention: { hands: 0, questions: 2, waiting: 0, chat: 0 } } };
export const ManyWaiting: Story = { name: 'Many waiting', args: { attention: { hands: 12, questions: 12, waiting: 12, chat: 120 } } };
export const SoundBlocked: Story = { name: 'Sound blocked', args: { soundBlocked: true } };
export const Leaving: Story = { args: { busy: true } };
export const DepartureFailed: Story = { name: 'Departure failed', args: { error: 'Couldn’t leave the call. Try again.' } };
/** Leave replaces the picture and controls with the same question the full call uses. Stay returns to the picture. */
export const LeaveConfirmation: Story = { name: 'Leave confirmation', render: (args) => <ConfirmationPreview {...args} /> };
/** A failed departure retains the question and its retry/stay controls inside the compact presentation. */
export const ConfirmationFailed: Story = { name: 'Confirmation failed', args: { error: 'Couldn’t leave the call. Try again.' }, render: (args) => <ConfirmationPreview {...args} /> };
export const ConfirmationPending: Story = { name: 'Confirmation pending', args: { busy: true }, render: (args) => <ConfirmationPreview {...args} /> };
export const Ended: Story = { args: { connection: 'ended', picture: null } };
/** A resized native window can be narrower than a phone. */
export const Narrow: Story = {
  args: { picture: sharedPicture, label: 'Priya’s screen', attention: { hands: 2, questions: 3, waiting: 1, chat: 3 } },
  render: (args) => <Box width={280} height={380}><FloatingCall {...args} /></Box>
};
export const Wide: Story = { render: (args) => <Box width="min(640px, 100%)" height={440}><FloatingCall {...args} /></Box> };
/** The call remains night when the browser's main tab uses the light theme. */
export const LightTheme: Story = { name: 'Light theme', globals: { theme: 'light' } };
export const DarkTheme: Story = { name: 'Dark theme', globals: { theme: 'dark' } };

export const SharedTimer: Story = { args: { timer: <CallTimerButton time="1:24" label="Proposal" status="Running" tone="running" on={false} onClick={did('Return and open timer')} /> } };
export const TimerOverTime: Story = { args: { timer: <CallTimerButton time="+0:24" label="Your time is up" status="Over time" tone="overtime" on={false} onClick={did('Return and open timer')} /> } };
