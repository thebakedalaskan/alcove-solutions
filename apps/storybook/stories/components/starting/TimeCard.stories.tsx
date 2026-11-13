/*
 * TimeCard: a time to pick in When, on the scheduler: the day, the time, and a line under it when it doesn't suit everyone,
 * when someone asked for it, or what a guest's clock says then. It fills when it's picked, and its tick pops in. Letting a
 * guest pick, the times are tick boxes instead (`box`): each ticked one is offered. While calendars are being read,
 * TimeCardWaiting keeps each card's place. Three sit in a row; on a phone they stack, with the time on the right.
 */
import { TimeCard, TimeCardWaiting } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';

/** When, on the scheduler: who's free, then the times. */
function When({ free, children }: { free: string; children: ReactNode }) {
  return (
    <section className="sc-sec" style={{ width: 'min(372px, 100%)' }}>
      <h3>When</h3>
      <p className="sc-free">{free}</p>
      {children}
    </section>
  );
}

/** Three times, the best first, with how many are free when not everyone is. */
const TIMES = [
  { id: 'thu-14', day: 'Tomorrow', time: '14:00', note: '' },
  { id: 'thu-1630', day: 'Tomorrow', time: '16:30', note: '3 of 4 free' },
  { id: 'fri-11', day: 'Fri 6 Nov', time: '11:00', note: '3 of 4 free' }
] as const;
/** Free on your calendar, offered to Jonas in Berlin, an hour ahead. */
const OFFERED = [
  { id: 'thu-14', day: 'Tomorrow', time: '14:00', note: '15:00 for Jonas' },
  { id: 'thu-1630', day: 'Tomorrow', time: '16:30', note: '17:30 for Jonas' },
  { id: 'fri-11', day: 'Fri 6 Nov', time: '11:00', note: '12:00 for Jonas' }
] as const;

const meta = {
  title: 'Components/Starting a call/TimeCard',
  component: TimeCard,
  subcomponents: { TimeCardWaiting },
  parameters: { layout: 'centered' },
  args: { day: 'Tomorrow', time: '14:00', picked: false, box: false, onClick: did('onClick') },
  argTypes: { day: { control: 'text' }, time: { control: 'text' }, note: { control: 'text' }, picked: { control: 'boolean' }, box: { control: 'boolean' } },
  /* Pressing it picks it; pressing a tick box again lets it go. */
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    /* A grid, as the row of three is, so the card takes the width it's given. */
    return <div style={{ display: 'grid', width: 120 }}><TimeCard {...args} onClick={(e) => { args.onClick?.(e); update({ picked: args.box ? !args.picked : true }); }} /></div>;
  }
} satisfies Meta<typeof TimeCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NotPicked: Story = { name: 'Not picked' };
/** Picked: it fills with sun, and its tick pops in. */
export const Picked: Story = { args: { picked: true } };
/** A line under it when not everyone is free. */
export const WithANote: Story = { name: 'With a note', args: { time: '16:30', note: '3 of 4 free' } };
/** Someone on the call asked for this time: moving it, their ask comes first. */
export const Asked: Story = { args: { time: '11:00', note: 'Aiko asked' } };
/** A tick box, letting a guest pick: empty, it isn't offered. */
export const ATickBox: Story = { name: 'A tick box', args: { box: true, note: '15:00 for Jonas' } };
/** Ticked: it's one of the times the guest picks from. */
export const Ticked: Story = { args: { box: true, picked: true, note: '15:00 for Jonas' } };
/** While calendars are being read, each card's place is kept. */
export const Waiting: Story = { parameters: { controls: { disable: true } }, render: () => <div style={{ display: 'grid', width: 120 }}><TimeCardWaiting /></div> };
/** Three in a row, as When shows them, the best already picked: pressing another picks it. */
export const ThreeTimes: Story = {
  name: 'Three times',
  parameters: { layout: 'padded', controls: { disable: true } },
  render: function Render() {
    const [picked, setPicked] = useState<string>(TIMES[0].id);
    return (
      <When free="Most of you are free at these times.">
        <div className="cf-times sc-cards" role="group" aria-label="Times that work">
          {TIMES.map((t) => <TimeCard key={t.id} day={t.day} time={t.time} note={t.note} picked={t.id === picked} onClick={() => setPicked(t.id)} />)}
        </div>
      </When>
    );
  }
};
/** Letting Jonas pick: all three are offered at first, each with what his clock says; pressing one leaves it out. */
export const ThreeToOffer: Story = {
  name: 'Three to offer',
  parameters: { layout: 'padded', controls: { disable: true } },
  render: function Render() {
    const [left, setLeft] = useState<readonly string[]>([]);
    return (
      <When free="Free on your calendar. Tick the ones Jonas can pick from; they see them in their own time.">
        <div className="cf-times sc-cards" role="group" aria-label="Times to offer">
          {OFFERED.map((t) => (
            <TimeCard key={t.id} box day={t.day} time={t.time} note={t.note} picked={!left.includes(t.id)}
              onClick={() => setLeft((l) => (l.includes(t.id) ? l.filter((x) => x !== t.id) : [...l, t.id]))} />
          ))}
        </div>
      </When>
    );
  }
};
/** Reading calendars: three waiting cards hold the row's place. */
export const ReadingCalendars: Story = {
  name: 'Reading calendars',
  parameters: { layout: 'padded', controls: { disable: true } },
  render: () => (
    <When free="Reading calendars…">
      <div className="cf-times sc-cards" aria-busy="true">{[0, 1, 2].map((i) => <TimeCardWaiting key={i} />)}</div>
    </When>
  )
};
