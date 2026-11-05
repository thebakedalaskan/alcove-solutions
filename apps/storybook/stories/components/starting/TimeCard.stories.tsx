/*
 * TimeCard: a time to pick in the call modal's When: the day, the time, and a line under it when it doesn't suit
 * everyone. It fills when it's picked, and its tick pops in. While calendars are being read, TimeCardWaiting keeps each
 * card's place. Three sit in a row; on a phone they stack, with the time on the right.
 */
import { Button, FlowBody, FlowFoot, FlowSteps, FlowView, TimeCard, TimeCardWaiting } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { useArgs } from 'storybook/preview-api';
import { ModalFrame, did } from '../../../src/component';

/** When, in the call modal. */
function When({ sub, children, foot }: { sub: string; children: ReactNode; foot: ReactNode }) {
  return (
    <ModalFrame>
      <FlowView>
        <FlowSteps steps={['Who', 'When', 'Details']} at={1} onBack={did('onBack')} onClose={did('onClose')} />
        <FlowBody>
          <h2>When works for everyone?</h2>
          <p className="cf-sub">{sub}</p>
          {children}
        </FlowBody>
        {foot}
      </FlowView>
    </ModalFrame>
  );
}

/** Three times, the best first, with how many are free when not everyone is. */
const TIMES = [
  { id: 'thu-14', day: 'Tomorrow', time: '14:00', note: '', short: 'Thu 14:00' },
  { id: 'thu-1630', day: 'Tomorrow', time: '16:30', note: '3 of 4 free', short: 'Thu 16:30' },
  { id: 'fri-11', day: 'Fri 6 Nov', time: '11:00', note: '3 of 4 free', short: 'Fri 11:00' }
] as const;

const meta = {
  title: 'Components/Starting a call/TimeCard',
  component: TimeCard,
  subcomponents: { TimeCardWaiting },
  parameters: { layout: 'centered' },
  args: { day: 'Tomorrow', time: '14:00', picked: false, onClick: did('onClick') },
  argTypes: { day: { control: 'text' }, time: { control: 'text' }, note: { control: 'text' }, picked: { control: 'boolean' } },
  /* Pressing it picks it; pressing it again lets it go, as when times are offered. */
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    /* A grid, as the row of three is, so the card takes the width it's given. */
    return <div style={{ display: 'grid', width: 180 }}><TimeCard {...args} onClick={(e) => { args.onClick?.(e); update({ picked: !args.picked }); }} /></div>;
  }
} satisfies Meta<typeof TimeCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NotPicked: Story = { name: 'Not picked' };
/** Picked: it fills with sun, and its tick pops in. */
export const Picked: Story = { args: { picked: true } };
/** A line under it when not everyone is free. */
export const WithANote: Story = { name: 'With a note', args: { time: '16:30', note: '3 of 4 free' } };
/** While calendars are being read, each card's place is kept. */
export const Waiting: Story = { parameters: { controls: { disable: true } }, render: () => <div style={{ display: 'grid', width: 180 }}><TimeCardWaiting /></div> };
/** Three in a row, as When shows them, the best already picked: pressing another picks it, and the button follows. */
export const ThreeTimes: Story = {
  name: 'Three times',
  parameters: { layout: 'padded', controls: { disable: true } },
  render: function Render() {
    const [picked, setPicked] = useState<string>(TIMES[0].id);
    const chosen = TIMES.find((t) => t.id === picked) ?? TIMES[0];
    return (
      <When sub="Most of you are free at these times." foot={<FlowFoot><Button variant="primary" onClick={did('onNext')}>Use {chosen.short}</Button></FlowFoot>}>
        <div className="cf-times">
          {TIMES.map((t) => <TimeCard key={t.id} day={t.day} time={t.time} note={t.note} picked={t.id === picked} onClick={() => setPicked(t.id)} />)}
        </div>
      </When>
    );
  }
};
/** Reading calendars: three waiting cards hold the row's place, and the button waits. */
export const ReadingCalendars: Story = {
  name: 'Reading calendars',
  parameters: { layout: 'padded', controls: { disable: true } },
  render: () => (
    <When sub="Reading calendars…" foot={<FlowFoot><Button variant="primary" disabled>Pick a time</Button></FlowFoot>}>
      <div className="cf-times" aria-busy="true">{[0, 1, 2].map((i) => <TimeCardWaiting key={i} />)}</div>
    </When>
  )
};
