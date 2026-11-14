/*
 * Timer for everyone, the popover the call timer's button opens (call/call-timer.tsx; the button is CallTimerButton): as
 * the host sees it before one runs (CallTimerLength) and while it runs (CallTimerRun), and as everyone else reads it. Always
 * night: it lives on the stage.
 */
import { CallTimerCard, CallTimerLength, CallTimerRun, timerClock } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { PopSurface, did, onStage } from '../../../src/component';

const meta = {
  title: 'Components/In a call/CallTimerCard', component: CallTimerCard, ...onStage,
  args: { time: '3:42', tone: 'running' },
  render: (args) => <PopSurface width={300}><CallTimerCard {...args} /></PopSurface>
} satisfies Meta<typeof CallTimerCard>;
export default meta;
type Story = StoryObj<typeof meta>;

function Choosing({ starting = false, disabled = false }: { starting?: boolean; disabled?: boolean }) {
  const [minutes, setMinutes] = useState(5);
  return (
    <PopSurface width={300}>
      <CallTimerCard time={timerClock(minutes * 60)} tone="ready">
        <CallTimerLength minutes={minutes} max={1440} onMinutes={setMinutes} onStart={did('start')} starting={starting} disabled={disabled} />
        {disabled && <p className="ac-timer-note">Reconnecting. You can change the timer once you’re back.</p>}
      </CallTimerCard>
    </PopSurface>
  );
}
/** The host, before one runs: the usual lengths, a minute less or more, and Start. */
export const Choose: Story = { render: () => <Choosing /> };
export const Starting: Story = { render: () => <Choosing starting /> };
export const ChooseWhileReconnecting: Story = { name: 'Choose, while reconnecting', render: () => <Choosing disabled /> };
const run = { onPause: did('pause'), onResume: did('resume'), onAddMinute: did('add a minute'), onStop: did('stop') };
/** The host, while it runs: Pause, +1 min and Stop. */
export const Running: Story = { render: () => <PopSurface width={300}><CallTimerCard time="3:42" tone="running"><CallTimerRun paused={false} {...run} /></CallTimerCard></PopSurface> };
export const Paused: Story = { render: () => <PopSurface width={300}><CallTimerCard time="2:45" tone="paused" status="Paused"><CallTimerRun paused {...run} /></CallTimerCard></PopSurface> };
export const NearTheEnd: Story = { render: () => <PopSurface width={300}><CallTimerCard time="0:18" tone="warning"><CallTimerRun paused={false} {...run} /></CallTimerCard></PopSurface> };
export const OverTime: Story = { render: () => <PopSurface width={300}><CallTimerCard time="+0:45" tone="overtime" status="Over time"><CallTimerRun paused={false} {...run} /></CallTimerCard></PopSurface> };
/** Everyone else reads the same countdown. */
export const ReadOnly: Story = { name: 'Read only', render: () => <PopSurface width={300}><CallTimerCard time="3:42" tone="running"><p className="ac-timer-note">Only the host can change it.</p></CallTimerCard></PopSurface> };
