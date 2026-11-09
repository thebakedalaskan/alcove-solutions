/*
 * The call timer's button in the top bar (components/call-timer.tsx), in every tone: Timer for the host before one runs, then
 * the countdown, paused, near the end and over time; and compact, its icon and time alone on a phone. It opens Timer for
 * everyone (CallTimerCard). Always night: it lives on the stage.
 */
import { CallTimerButton } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row, Stack, did, onStage } from '../../../src/component';

const meta = {
  title: 'Components/In a call/CallTimerButton', component: CallTimerButton, ...onStage,
  args: { time: '3:42', label: 'Timer: 3:42 left', tone: 'running', onClick: did('open') }
} satisfies Meta<typeof CallTimerButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};
/** Each tone: Timer for the host before one runs, then the countdown, paused, near the end, over time; and compact, on a phone. */
export const Tones: Story = {
  render: () => (
    <Stack>
      <Row>
        <CallTimerButton time={null} label="Timer for everyone" tone="ready" onClick={did('open')} />
        <CallTimerButton time="3:42" label="Timer: 3:42 left" tone="running" onClick={did('open')} />
        <CallTimerButton time="2:45" label="Timer: 2:45 left, paused" tone="paused" onClick={did('open')} />
        <CallTimerButton time="0:18" label="Timer: 0:18 left" tone="warning" onClick={did('open')} />
        <CallTimerButton time="+0:45" label="Timer: +0:45 over time" tone="overtime" onClick={did('open')} />
      </Row>
      <Row>
        <CallTimerButton time={null} label="Timer for everyone" tone="ready" compact onClick={did('open')} />
        <CallTimerButton time="3:42" label="Timer: 3:42 left" tone="running" compact onClick={did('open')} />
        <CallTimerButton time="1:05:00" label="Timer: 1:05:00 left" tone="running" compact onClick={did('open')} />
      </Row>
    </Stack>
  )
};
