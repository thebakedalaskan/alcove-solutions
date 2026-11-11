/*
 * WeekGrid: a week to pick a time in, beside the call modal's three times when Pick another time widens it: a column
 * for each working day, with what's already in it. Your own events say what they are (`mine`); other people's
 * calendars only say they're busy. The whole day, 00 to 24, every hour line labelled; nine in the morning is the top of
 * the view as it opens. Every half hour can be picked, except those already gone, and the pick shows its time. Tab
 * reaches the grid once and the arrow keys move around it.
 */
import { FlowBody, FlowView, IconButton, WeekGrid, type WeekDay, type WeekEvent } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { ModalFrame, did } from '../../../src/component';
import { on } from '../../../src/world/clock';

/** Five working days from today, Wednesday 4 November: the rest of this week, then Monday and Tuesday. */
const DATES = [0, 1, 2, 5, 6].map((d) => on(d, 0));
const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const shortDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const DAYS: WeekDay[] = DATES.map((d, i) => ({ weekday: weekday.format(d), date: d.getDate(), today: i === 0, label: shortDay.format(d) }));

/** What's in the week, in hours from midnight: your own calls and events, then when Priya and Kofi are busy. */
const EVENTS: WeekEvent[] = [
  { day: 0, from: 9, to: 9 + 20 / 60, kind: 'mine', title: 'Team standup' },
  { day: 0, from: 17.5, to: 18, kind: 'mine', title: 'Design sync' },
  { day: 1, from: 11, to: 11.75, kind: 'mine', title: 'Harbourline proposal' },
  { day: 1, from: 15.5, to: 16, kind: 'mine', title: '1:1 with Maya' },
  { day: 1, from: 18.25, to: 21, kind: 'mine', title: 'Focus time' },
  { day: 1, from: 6.5, to: 7.25, kind: 'mine', title: 'Sydney office sync' },
  { day: 2, from: 22, to: 23.5, kind: 'mine', title: 'Release window' },
  { day: 2, from: 10, to: 10.5, kind: 'mine', title: 'Product sync' },
  { day: 3, from: 18.25, to: 21, kind: 'mine', title: 'Focus time' },
  { day: 0, from: 13, to: 14.5, kind: 'busy' },
  { day: 1, from: 9, to: 10.5, kind: 'busy' },
  { day: 1, from: 13, to: 14, kind: 'busy' },
  { day: 2, from: 14, to: 15.5, kind: 'busy' },
  { day: 3, from: 9.5, to: 12, kind: 'busy' },
  { day: 3, from: 13, to: 15, kind: 'busy' },
  { day: 4, from: 10, to: 12, kind: 'busy' },
  { day: 4, from: 16, to: 17, kind: 'busy' }
];
const isBusy = (day: number, hour: number) => EVENTS.some((e) => e.day === day && e.from <= hour && e.to > hour);
/** A half hour that's already gone can't be picked: on Wednesday, everything before now. */
const isPast = (day: number, hour: number) => {
  const d = DATES[day];
  return !d || new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(hour), hour % 1 ? 30 : 0).getTime() <= Date.now();
};
const clock = (hour: number) => `${String(Math.floor(hour)).padStart(2, '0')}:${hour % 1 ? '30' : '00'}`;

const meta = {
  title: 'Components/Starting a call/WeekGrid',
  component: WeekGrid,
  args: { days: DAYS, events: EVENTS, pick: null, from: 0, to: 24, isBusy, isPast, onPick: did('onPick'), label: 'Pick a time' },
  argTypes: {
    pick: { control: 'object' },
    from: { control: { type: 'number', min: 0, max: 12, step: 1 } },
    to: { control: { type: 'number', min: 13, max: 24, step: 1 } },
    label: { control: 'text' },
    days: { control: false }, events: { control: false }, isBusy: { control: false }, isPast: { control: false }, onPick: { control: false }
  },
  /* Picking a half hour makes it the pick: a 30-minute call from there. */
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    const first = DATES[0];
    const last = DATES.at(-1);
    const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
    return (
      <ModalFrame>
        <FlowView>
          <FlowBody>
            <div className="cf-wk">
              <div className="cf-wk-top">
                <span>{first && last ? `${dayMonth.format(first)} – ${dayMonth.format(last)}` : ''}</span>
                <span className="cf-wk-nav">
                  <IconButton icon="left" size={16} label="Earlier days" disabled />
                  <IconButton icon="right" size={16} label="Later days" onClick={did('onLater')} />
                </span>
              </div>
              <WeekGrid {...args} onPick={(day, hour) => { args.onPick(day, hour); update({ pick: { day, from: hour, to: hour + 0.5, label: clock(hour) } }); }} />
            </div>
          </FlowBody>
        </FlowView>
      </ModalFrame>
    );
  }
} satisfies Meta<typeof WeekGrid>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The week as it stands: your events by name, other people's busy times, and today in sun. Press a half hour to pick it. */
export const ThisWeek: Story = { name: 'This week' };
/** A time picked: Thursday at 14:00, for half an hour. */
export const Picked: Story = { args: { pick: { day: 1, from: 14, to: 14.5, label: '14:00' } } };
/** An hour picked, early: the view starts at the pick when it's before nine. */
export const EarlyHour: Story = { name: 'An early hour', args: { pick: { day: 2, from: 8, to: 9, label: '08:00' } } };
/** A late hour picked, from a card or typed: the view scrolls just far enough to show it. */
export const LateHour: Story = { name: 'A late hour', args: { pick: { day: 2, from: 21, to: 22, label: '21:00' } } };
/** Scrolled to the top of the day: the first hour's label, 00, reads in full under the days, on its line like the others. */
export const TopOfTheDay: Story = {
  name: 'The top of the day',
  play: async ({ canvasElement, step }) => {
    await step('Scroll the week to the top', async () => {
      const week = canvasElement.querySelector('.wk-scroll');
      if (week) week.scrollTop = 0;
    });
  }
};
/** Scrolled to the end of the day: the last line is labelled 24, so the grid doesn't look as if it stops an hour early. */
export const EndOfTheDay: Story = {
  name: 'The end of the day',
  play: async ({ canvasElement, step }) => {
    await step('Scroll the week to the end', async () => {
      const week = canvasElement.querySelector('.wk-scroll');
      if (week) week.scrollTop = week.scrollHeight;
    });
  }
};
