/*
 * RingCard: someone ringing you, on whatever page you have open, over a window too. It drops in at the top right without
 * taking the focus, so someone typing keeps typing: the arch ripples, Join answers it, and Can't now opens three answers
 * in the same card. Every card sits in the RingShelf, fixed above everything else, which holds as many rings as there
 * are. It renders in the page's theme; `night` is for the pages on the night stage (a call, a pre-join, the recorder).
 */
import type { RingReply } from '@alcove/api';
import { RingCard, RingShelf, type RingAnswer } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did, onStage } from '../../../src/component';
import { KOFI, PRIYA } from '../../../src/world/people';

const ANSWERS: RingAnswer<Exclude<RingReply, 'join'>>[] = [
  { value: 'in-5', icon: 'clock', label: 'In 5 minutes' },
  { value: 'in-15', icon: 'hourglass', label: 'In 15 minutes' },
  { value: 'no', icon: 'x', label: 'Not this time' }
];

const meta = {
  title: 'Components/Ringing and waiting/RingCard',
  component: RingCard,
  subcomponents: { RingShelf },
  parameters: { layout: 'fullscreen' },
  args: { person: PRIYA, title: 'Priya is ringing you', line: 'Design sync · you get the notes', answers: ANSWERS, night: false, onJoin: did('onJoin'), onAnswer: did('onAnswer') },
  argTypes: { person: { control: false }, answers: { control: false }, title: { control: 'text' }, line: { control: 'text' } },
  render: (args) => <RingShelf><RingCard key="priya" {...args} /></RingShelf>
} satisfies Meta<typeof RingCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Press Can't now: the three answers open in the card. */
export const OnAPage: Story = { name: 'On a page' };
/** A call without notes says only its name. */
export const WithoutNotes: Story = { name: 'Without notes', args: { line: 'Design sync' } };
/** Over the night stage: you're in a call, or on your way into one, and someone else rings. */
export const OverTheCall: Story = { ...onStage, name: 'Over the call', args: { night: true } };
/** Two people ringing at once: the shelf holds both, newest last. */
export const TwoAtOnce: Story = {
  name: 'Two at once',
  render: (args) => (
    <RingShelf>
      <RingCard key="priya" {...args} />
      <RingCard key="kofi" {...args} person={KOFI} title="Kofi is ringing you" line="Harbourline prep · you get the notes" />
    </RingShelf>
  )
};
/** On a phone the card runs the width of the screen. */
export const Phone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };
