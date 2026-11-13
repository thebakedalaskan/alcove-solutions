/*
 * RowMenu: ⋯ on a call, in a fixed column at the row's end, with what that call allows. What takes something away comes last,
 * after a hairline, in caution; what opens elsewhere (`href`) opens in a new tab. A question it asks first is a step in the
 * same popover, in place of the items (RowAsk): what will happen, then the answers, the one that loses nothing first; one that
 * needs more room, such as who to share the notes with, is `wide`. No window opens over another. Up, Down, Home and End move
 * through the items.
 */
import { Button, RowAsk, RowMenu, type RowMenuItem } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';

/** An Alcove call you run. */
const YOURS: RowMenuItem[] = [
  { id: 'move', label: 'Change the time', icon: 'cal', onSelect: did('change the time') },
  { id: 'copy', label: 'Copy link', icon: 'link', onSelect: did('copy link') },
  { id: 'cancel', label: 'Cancel this call', icon: 'trash', tone: 'caution', separatorBefore: true, onSelect: did('cancel') }
];
/** A call of a series you run. */
const SERIES: RowMenuItem[] = [
  { id: 'move', label: 'Change the time', icon: 'cal', onSelect: did('change the time') },
  { id: 'skip', label: 'Skip this one', icon: 'x', onSelect: did('skip') },
  { id: 'copy', label: 'Copy link', icon: 'link', onSelect: did('copy link') },
  { id: 'end', label: 'Cancel the series', icon: 'trash', tone: 'caution', separatorBefore: true, onSelect: did('cancel the series') }
];
/** A meeting on your calendar that you run. */
const CALENDAR: RowMenuItem[] = [
  { id: 'google', label: 'Open in Google Calendar', icon: 'external', href: '#google-calendar' },
  { id: 'alcove', label: 'Use Alcove instead', icon: 'video', onSelect: did('use Alcove instead') }
];

const meta = {
  title: 'Components/Calls/RowMenu',
  component: RowMenu,
  parameters: { layout: 'centered' },
  args: { label: 'More for Design sync', open: true, items: YOURS, onOpenChange: did('onOpenChange') },
  argTypes: { open: { control: 'boolean' }, wide: { control: 'boolean' }, items: { control: false }, step: { control: false } },
  // Pressing ⋯ or outside the menu moves the open control too.
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <div style={{ display: 'grid', justifyItems: 'end', width: 320, height: 300 }}>
        <RowMenu {...args} onOpenChange={(open) => { args.onOpenChange(open); update({ open }); }} />
      </div>
    );
  }
} satisfies Meta<typeof RowMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A call you run: Change the time, Copy link, then Cancel this call, apart. */
export const YourCall: Story = { name: 'Your call' };
/** A series' call: Skip this one, and Cancel the series last. */
export const ASeriesCall: Story = { name: 'A series’ call', args: { label: 'More for Team standup', items: SERIES } };
/** A meeting from your calendar: it opens there, or moves to Alcove. */
export const ACalendarMeeting: Story = { name: 'A calendar meeting', args: { label: 'More for Supplier check-in', items: CALENDAR } };

/** Cancel asks first, in the same popover: what happens, then Keep it, which loses nothing, filled. */
export const AskingFirst: Story = {
  name: 'Asking first',
  args: {
    step: (
      <RowAsk title="Cancel Design sync?" actions={<><Button variant="primary" size="sm" onClick={did('keep it')}>Keep it</Button><Button size="sm" onClick={did('cancel the call')}>Cancel the call</Button></>}>
        <span>It comes off your calendar, and everyone invited is told.</span>
      </RowAsk>
    )
  }
};

/** Skip this one, on a series' call: which call, and that it comes off the calendar, then Keep it or Skip it. */
export const SkippingOne: Story = {
  name: 'Skipping one',
  args: {
    label: 'More for Team standup', items: SERIES,
    step: (
      <RowAsk title="Skip this one?" actions={<><Button variant="primary" size="sm" onClick={did('keep it')}>Keep it</Button><Button size="sm" onClick={did('skip it')}>Skip it</Button></>}>
        <span>Team standup, tomorrow 09:00. It comes off your calendar, and everyone invited is told.</span>
      </RowAsk>
    )
  }
};
