/*
 * PlaceTree: a rail of places beside the sheet they open, as Calls has it. Each place (PlaceRow) is its icon, its name and, at
 * its end, a count (in sun when something's happening now) or a few words (`trail`, a series' next call); `depth` 1 sits under
 * the place before it, and the one you're on is lit. A heading (PlaceHead) goes over some of them, and the foot (PlaceFoot)
 * says what's connected and opens where it's managed. Narrower, the counts step back and the trails stay. On a phone there's no
 * room for a rail: the places are chips at the top of the sheet (PlaceChips).
 */
import { PlaceChips, PlaceFoot, PlaceHead, PlaceRow, PlaceTree, type LinkRender } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

const stay = (e: { preventDefault: () => void }) => e.preventDefault();
const to = (where: string, go?: () => void): LinkRender => (p) => <a href={`#${where}`} {...p} onClick={(e) => { stay(e); go?.(); }} />;

/** Calls' rail, with the place you press lit. */
function Rail({ at: start, foot = true, series = true }: { at: string; foot?: boolean; series?: boolean }) {
  const [at, setAt] = useState(start);
  const place = (id: string) => ({ current: at === id, link: to(id, () => setAt(id)) });
  return (
    <div style={{ display: 'grid', width: 248, height: 560 }}>
      <PlaceTree label="Your calls" foot={foot ? <PlaceFoot icon="cal" title="Google Calendar" detail="Connected" link={to('settings')} /> : undefined}>
        <PlaceRow icon="calls" label="All calls" {...place('all')} />
        <PlaceRow icon="cal" label="Coming up" count={11} {...place('soon')} />
        <PlaceRow icon="clock" label="Past calls" {...place('past')} />
        <PlaceRow icon="mic" label="In the room" count={2} depth={1} {...place('room')} />
        <PlaceRow icon="share" label="Shared with you" count={2} depth={1} {...place('shared')} />
        {series && (
          <>
            <PlaceHead>Series</PlaceHead>
            <PlaceRow icon="repeat" label="Team standup" trail="Tomorrow 09:00" {...place('standup')} />
            <PlaceRow icon="repeat" label="Pricing sync" trail="Fri 15:00" {...place('pricing')} />
            <PlaceRow icon="repeat" label="Launch check-in" trail="Wed 11 Nov" {...place('launch')} />
          </>
        )}
      </PlaceTree>
    </div>
  );
}

const meta = {
  title: 'Components/Calls/PlaceTree',
  component: PlaceTree,
  parameters: { layout: 'centered' }
} satisfies Meta<typeof PlaceTree>;
export default meta;
type Story = StoryObj<typeof meta>;

/** All calls lit: the places, how many are coming up and in each, each series with its next call, and the calendar at the foot. */
export const Calls: Story = { args: { label: 'Your calls', children: null }, render: () => <Rail at="all" /> };
/** A series lit. */
export const ASeries: Story = { name: 'A series', args: Calls.args, render: () => <Rail at="standup" /> };
/** No series, and no calendar connected: no heading and no foot. */
export const NoSeriesNoCalendar: Story = { name: 'No series, no calendar', args: Calls.args, render: () => <Rail at="soon" foot={false} series={false} /> };

/** The places on a phone, as chips at the top of the sheet: All, Coming up, Past and Series. */
function Chips() {
  const [at, setAt] = useState('soon');
  const chip = (key: string, label: string) => ({ key, label, current: at === key, link: to(key, () => setAt(key)) });
  return <PlaceChips label="Your calls" chips={[chip('all', 'All'), chip('soon', 'Coming up'), chip('past', 'Past'), chip('series', 'Series')]} />;
}
export const OnAPhone: Story = { name: 'On a phone', args: Calls.args, globals: { viewport: { value: 'phone' } }, render: () => <Chips /> };
