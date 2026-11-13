/*
 * AgentDid: one thing an agent did, on the water: a mark tinted by what it's about (reading is quiet, a booked call takes
 * the colour of time, a follow-up horizon, a decision rose), a sentence with what it was about a link to it, a quiet
 * second line, and the time in a fixed column. AgentDay holds a day of them under its name.
 */
import { AgentDay, AgentDid } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { iso } from '../../../src/world/clock';
import { onTheWater } from './frames';

const link = (title: string) => <a className="ag-obj" href="#note">{title}</a>;

const meta = {
  title: 'Components/Agents/AgentDid',
  component: AgentDid,
  decorators: [onTheWater],
  args: { icon: 'calCheck', tone: 'time', at: iso(0, 16, 8), time: '16:08', sub: 'Tue 10 Nov, 11:00 · with Priya and Kofi · notes on', children: <><b>Claude</b> booked {link('Onboarding review')}</> },
  argTypes: { tone: { control: 'inline-radio', options: ['quiet', 'time', 'follow', 'decision'] }, children: { control: false } },
  render: (args) => <AgentDay day="Today"><AgentDid {...args} /></AgentDay>
} satisfies Meta<typeof AgentDid>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A call it booked: the colour of time. */
export const BookedACall: Story = { name: 'Booked a call' };
/** Reading is quiet. */
export const Read: Story = { args: { icon: 'book', tone: 'quiet', time: '16:07', sub: 'Tue 27 Oct', children: <><b>Claude</b> read {link('Launch planning')}</> } };
/** A follow-up: horizon. */
export const AFollowUp: Story = { name: 'A follow-up', args: { icon: 'circleCheck', tone: 'follow', time: '11:40', sub: '11:58', children: <><b>Claude</b> added a follow-up to {link('Art’s call')}</> } };
/** A decision for you to confirm: rose. */
export const ADecision: Story = { name: 'A decision', args: { icon: 'badgeCheck', tone: 'decision', time: '10:02', sub: 'For you to confirm', children: <><b>Claude</b> proposed a decision in {link('Team standup')}</> } };
/** What it found, counted. */
export const Counted: Story = { args: { icon: 'search', tone: 'quiet', time: '16:06', sub: '3 notes', children: <><b>Claude</b> looked through your notes</> } };
/** A note deleted since: no title, and nothing to open. */
export const Gone: Story = { args: { icon: 'book', tone: 'quiet', time: '10:30', sub: 'Not there any more', children: <><b>Claude</b> read a note</> } };
/** A day of them, newest first. */
export const ADay: Story = {
  name: 'A day',
  render: () => (
    <AgentDay day="Today">
      <AgentDid icon="calCheck" tone="time" at={iso(0, 16, 8)} time="16:08" sub="Tue 10 Nov, 11:00 · with Priya and Kofi · notes on"><b>Claude</b> booked {link('Onboarding review')}</AgentDid>
      <AgentDid icon="clock" at={iso(0, 16, 7)} time="16:07" sub="3 people"><b>Claude</b> checked when people are free</AgentDid>
      <AgentDid icon="book" at={iso(0, 16, 7)} time="16:07" sub="Tue 27 Oct"><b>Claude</b> read {link('Launch planning')}</AgentDid>
      <AgentDid icon="circleCheck" tone="follow" at={iso(0, 11, 40)} time="11:40" sub="11:58"><b>Claude</b> added a follow-up to {link('Art’s call')}</AgentDid>
      <AgentDid icon="badgeCheck" tone="decision" at={iso(0, 10, 2)} time="10:02" sub="For you to confirm"><b>Claude</b> proposed a decision in {link('Team standup')}</AgentDid>
    </AgentDay>
  )
};
export const ADayPhone: Story = { ...ADay, name: 'A day, phone', globals: { viewport: { value: 'phone', isRotated: false } } };
