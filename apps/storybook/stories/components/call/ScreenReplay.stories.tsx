/*
 * ScreenReplay: a note's shared screens played back in step with its recording, on a black stage (night in both themes,
 * like the call). With one share its label says whose screen it is; when several were going on at once, chips switch
 * between them. While a share's picture takes a moment to load, or to get to another moment, the stage says it's
 * loading that share; when it couldn't be played, it says so with Try again. When no share in the notes covers the
 * moment, the stage says so, with when screens were shared, each going there in one press. It keeps its size whatever it
 * says. Full screen, where the browser allows it, is the button in the corner. The stand-in has no video, so the stage
 * shows a frame as the video's poster.
 */
import { ReplayScrub, ScreenReplay } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { screenImage } from '../../../src/api/media';
import { Box, did } from '../../../src/component';
import { LAUNCH_CHECKLIST, ROLLOUT_PLAN } from '../../../src/world/notes';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const video = (poster: string) => <video poster={poster} muted playsInline aria-label="Shared screen" />;

const meta = {
  title: 'Components/In a call/ScreenReplay',
  component: ScreenReplay,
  args: {
    video: video(screenImage(LAUNCH_CHECKLIST)), nothing: false, shares: [{ id: 'a', label: 'Kofi’s screen' }], current: 'a', onPick: did('onPick'), playing: false,
    state: 'shown', onRetry: did('onRetry'), onGo: did('onGo')
  },
  argTypes: {
    state: { control: 'inline-radio', options: ['loading', 'shown', 'failed'] },
    video: { control: false }, controls: { control: false }, shares: { control: false }, elsewhere: { control: false }, onPick: { control: false }, className: { control: false }
  },
  render: (args) => <Box width="min(720px, 100%)" height="auto"><ScreenReplay {...args} /></Box>
} satisfies Meta<typeof ScreenReplay>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * No share in the notes covers this moment: before the first, between them, after the last, or a share that wasn't kept.
 * The stage says so, and offers the shares there are, each going to its start in one press.
 */
export const NoSharedScreenHere: Story = {
  name: 'No shared screen here',
  args: {
    nothing: true, shares: [], current: null,
    elsewhere: [{ id: 'a', label: 'Kofi’s screen', when: '8:52⁠–⁠10:40' }, { id: 'b', label: 'Maya’s screen', when: '14:05⁠–⁠16:20' }]
  }
};
/** One share going on: its label says whose screen it is. */
export const OneShare: Story = { name: 'One share' };
/** Its picture is on its way, entering the share or going to another moment in it: once that takes a moment, the stage says so over the last picture. */
export const Loading: Story = { args: { state: 'loading' } };
/** Its picture couldn't be played: the stage says so, with Try again. */
export const CouldntBePlayed: Story = { name: 'Couldn’t be played', args: { state: 'failed' } };

const BOTH = [{ id: 'a', label: 'Kofi’s screen' }, { id: 'b', label: 'Maya’s screen' }];
/** Two shares overlapping: chips along the top switch between them. */
export const TwoShares: Story = {
  name: 'Two overlapping shares',
  render: (args) => {
    const [current, setCurrent] = useState('a');
    return (
      <Box width="min(720px, 100%)" height="auto">
        <ScreenReplay {...args} shares={BOTH} current={current} video={video(screenImage(current === 'a' ? LAUNCH_CHECKLIST : ROLLOUT_PLAN))} onPick={setCurrent} />
      </Box>
    );
  }
};
/** With controls, which show along the foot only in full screen: play, the time and a scrub bar. */
export const WithControls: Story = {
  name: 'With full screen controls',
  render: (args) => (
    <Box width="min(720px, 100%)" height="auto">
      <ScreenReplay {...args} controls={<><span>{clock(552)}</span><ReplayScrub pos={552} total={1160} format={clock} onSeek={did('onSeek')} /><span>{clock(1160)}</span></>} />
    </Box>
  )
};
