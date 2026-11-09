/*
 * GuestCard: a public page with one card on it, in the visitor's own theme, with no account and no camera. It's what a
 * call's link shows while it offers times: who it's with, each time in the visitor's own zone (TimeChoice), what the
 * notes will be, and one button that says the time. Once picked, a DoneTick and Add to my calendar. If someone picked
 * first, it says which time was taken and gives the link. The card rises 8px as it opens.
 */
import { Avatar, Button, DoneTick, GuestCard, Icon, LinkRow, TimeChoice, buttonClass } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { did } from '../../../src/component';
import { ART, ZARA } from '../../../src/world/people';

/** The times Zara offered, as a visitor in London reads them. */
const TIMES = [
  { when: 'Thu 5 Nov, 10:30', time: '10:30', day: 'Thu 5 Nov · London time' },
  { when: 'Thu 5 Nov, 14:00', time: '14:00', day: 'Thu 5 Nov · London time' },
  { when: 'Fri 6 Nov, 11:00', time: '11:00', day: 'Fri 6 Nov · London time' }
] as const;
/** The link only knows the organizer's name, so the visitor sees their initial. */
const ORGANIZER = { name: ZARA.name };
const picked = did('pick');
const confirmed = did('confirm');
const toCalendar = did('add to my calendar');

/** The visitor's calendar has the call: the tick draws in. */
const OnTheCalendar = ({ when }: { when: string }) => (
  <>
    <DoneTick />
    <h1>You’re on Zara’s calendar</h1>
    <p>{when} London time. Come back to this link to join.</p>
    <Button size="lg" icon="cal" onClick={toCalendar}>Add to my calendar</Button>
  </>
);

/** Picking a time with Zara: pick one, and the button says it; confirm it, and the card says it's done. */
function PickATime() {
  const [chosen, setChosen] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (done && chosen) return <OnTheCalendar when={chosen} />;
  return (
    <>
      <Avatar person={ORGANIZER} size={56} />
      <h1>Pick a time with Zara</h1>
      <p>Launch campaign · 30 min</p>
      <div className="rg-times">
        {TIMES.map((t) => <TimeChoice key={t.when} time={t.time} day={t.day} picked={chosen === t.when} onPick={() => { picked(t.when); setChosen(t.when); }} />)}
      </div>
      <p className="rg-sealed"><Icon name="sealed" size={14} />This call has notes. You get them after.</p>
      <Button variant="primary" size="lg" disabled={!chosen} onClick={() => { confirmed(chosen); setDone(true); }}>{chosen ? `Confirm ${chosen}` : 'Pick a time'}</Button>
    </>
  );
}

const meta = {
  title: 'Components/People/GuestCard',
  component: GuestCard,
  parameters: { layout: 'fullscreen' },
  args: { children: <PickATime /> },
  argTypes: { children: { control: false } }
} satisfies Meta<typeof GuestCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Pick a time, then confirm it: the card says you're on Zara's calendar. */
export const PickingATime: Story = { name: 'Picking a time' };
/** A time is picked: the tick draws in, and the call can go on the visitor's own calendar. */
export const Picked: Story = { args: { children: <OnTheCalendar when={TIMES[0].when} /> } };
/** Someone picked first: the time that was taken, and the call's link. */
export const AlreadyPicked: Story = {
  name: 'Already picked',
  args: {
    children: (
      <>
        <Avatar person={ORGANIZER} size={56} />
        <h1>Someone already picked a time</h1>
        <p>Launch campaign is on Thu 5 Nov, 10:30 London time. Here’s its link.</p>
        <LinkRow link="alcove.solutions/join/lch-camp-zra" onCopy={did('onCopy')} />
      </>
    )
  }
};
/** The organizer on their own link while it offers times: the times, read-only, and the link to send. */
export const WaitingForThemToPick: Story = {
  name: 'Waiting for them to pick',
  args: {
    children: (
      <>
        <Avatar person={ART} size={56} />
        <h1>Waiting for Jonas to pick</h1>
        <p>Take-home review. Nobody can join until a time is picked.</p>
        <div className="rg-times">{TIMES.map((t) => <TimeChoice key={t.when} time={t.time} day={t.day} picked={false} />)}</div>
        <Button size="lg" icon="link" onClick={did('copy link')}>Copy link</Button>
        <a href="#home" className={buttonClass({ variant: 'quiet' })}>Go home</a>
      </>
    )
  }
};
/** Every time offered has gone by. */
export const TimesPassed: Story = {
  name: 'Times passed',
  args: {
    children: (
      <>
        <Avatar person={ORGANIZER} size={56} />
        <h1>These times have passed</h1>
        <p>Ask Zara for some new ones.</p>
      </>
    )
  }
};
/** Picking a time on a phone. */
export const Phone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };
