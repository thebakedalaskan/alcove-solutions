/*
 * CallsWeek: the week on the Calls page, Monday to Sunday, 08:00 to 19:00, weekdays wide and the weekend narrow. Browsing,
 * it shows what happened (filled, with what waits on you: a rose diamond for a decision to confirm, a blue dot for a
 * follow-up) and what's ahead: Alcove calls with a sun edge, meetings from your calendar outlined, an invitation dashed in
 * rose, a time held for a guest dashed. The sun on a line is now. Pressing a call opens it; pointing at a free time shows a
 * new call there, and pressing or dragging across it starts scheduling. While scheduling, the same week dims under the call
 * being made: other people's busy times hatched, the hours outside the working day greyed, the suggested times glowing, the
 * call itself solid with a grip to drag where it ends, and, moving a call, where it is now dashed. On a phone it's today
 * and the next two days. Tab reaches its half hours once and the arrow keys move around them.
 */
import { CallsWeek, type CallsWeekBlock, type CallsWeekBusy, type CallsWeekDay, type CallsWeekKeyItem, type CallsWeekProps, type CallsWeekSuggestion } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';
import { on } from '../../../src/world/clock';

/** The demo week, Monday 2 to Sunday 8 November: today is Wednesday 4, a little after half past twelve. */
const DATES = [-2, -1, 0, 1, 2, 3, 4].map((d) => on(d, 0));
const TODAY = 2;
const NOW = { day: TODAY, at: 12 + 33 / 60 };
const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const whole = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const DAYS: CallsWeekDay[] = DATES.map((d, i) => ({ weekday: weekday.format(d), date: d.getDate(), label: whole.format(d), today: i === TODAY, weekend: i > 4 }));

/** What happened and what's ahead, as the Calls page's week shows it. */
const BLOCKS: CallsWeekBlock[] = [
  { id: 'n2-mon', day: 0, start: 9, end: 9.25, title: 'Team standup', kind: 'past' },
  { id: 'n6', day: 0, start: 10.5, end: 11.7, title: 'Site visit, Harbourline', kind: 'past' },
  { id: 'n5', day: 0, start: 14.17, end: 15.03, title: 'Interview: Jonas Weber', kind: 'past' },
  { id: 'n2-tue', day: 1, start: 9, end: 9.3, title: 'Team standup', kind: 'past' },
  { id: 'n4', day: 1, start: 11, end: 11.75, title: 'Design review', kind: 'past' },
  { id: 'n3', day: 1, start: 15, end: 15.53, title: 'Pricing sync', kind: 'past', wait: 'fu' },
  { id: 'n2', day: 2, start: 9, end: 9.33, title: 'Team standup', kind: 'past', wait: 'dec' },
  { id: 'n1', day: 2, start: 11.97, end: 12.2, title: 'Moving the warehouse', kind: 'past', wait: 'dec' },
  { id: 'h1', day: 2, start: 16, end: 16.5, title: 'Harbourline weekly', kind: 'cal' },
  { id: 'u1', day: 2, start: 17.5, end: 18, title: 'Launch check-in', kind: 'soon' },
  { id: 's1n', day: 3, start: 9, end: 9.33, title: 'Team standup', kind: 'soon' },
  { id: 'u2', day: 3, start: 10, end: 10.75, title: 'Hiring sync', kind: 'soon' },
  { id: 'dc', day: 3, start: 14, end: 15, title: 'Design crit', kind: 'invite' },
  { id: 'fri-standup', day: 4, start: 9, end: 9.33, title: 'Team standup', kind: 'soon' },
  { id: 'jw', day: 4, start: 11, end: 11.75, title: 'Held for Jonas', kind: 'hold' }
];
const BROWSE_KEY: CallsWeekKeyItem[] = [
  { kind: 'past', label: 'Past, with notes' }, { kind: 'soon', label: 'An Alcove call' }, { kind: 'cal', label: 'From your calendar' },
  { kind: 'invite', label: 'Waiting for your answer' }, { kind: 'hold', label: 'Held until a guest picks' }
];

/** Scheduling a call with Priya and Kofi: when they're busy (never what), and three times all three of you are free. */
const BUSY: CallsWeekBusy[] = [
  { day: 2, start: 13, end: 15 }, { day: 2, start: 15, end: 16 },
  { day: 3, start: 12, end: 14 }, { day: 3, start: 16.5, end: 17.5 },
  { day: 4, start: 11, end: 12.5 }, { day: 4, start: 13, end: 16 }
];
const SUGGESTIONS: CallsWeekSuggestion[] = [{ day: 3, start: 11, end: 11.75 }, { day: 4, start: 10, end: 10.75 }];
const SCHEDULE_KEY: CallsWeekKeyItem[] = [{ kind: 'busy', label: 'Priya and Kofi busy' }, { kind: 'suggestion', label: 'Free for all of you' }, { kind: 'pick', label: 'This call' }];
const busyAt = (day: number, start: number, end: number) => BUSY.some((z) => z.day === day && z.start < end && z.end > start);
const ghostNote = (day: number, start: number, end: number) => (busyAt(day, start, end) ? 'Priya or Kofi busy' : 'All 3 free');

/** The week while scheduling: pressing a time, dragging across one or dragging the call's end moves the call. */
function picking(args: CallsWeekProps) {
  // A story's render function, not a component: Storybook's own hooks work here.
  const [, update] = useArgs<CallsWeekProps>();
  const pick = args.pick ?? null;
  return (
    <CallsWeek {...args}
      onPick={(day, start) => { args.onPick?.(day, start); update({ pick: { day, start, end: start + (pick ? pick.end - pick.start : 0.75), title: pick?.title } }); }}
      onDrag={(day, start, end) => { args.onDrag?.(day, start, end); update({ pick: { day, start, end, title: pick?.title } }); }}
      onEnd={(end) => { args.onEnd?.(end); if (pick) update({ pick: { ...pick, end } }); }} />
  );
}

const meta = {
  title: 'Components/Calls/CallsWeek',
  component: CallsWeek,
  args: { days: DAYS, blocks: BLOCKS, now: NOW, legend: BROWSE_KEY, label: 'This week', onBlock: did('onBlock'), onPick: did('onPick'), onDrag: did('onDrag'), onEnd: did('onEnd') },
  argTypes: {
    mode: { control: 'inline-radio', options: ['browse', 'schedule'] },
    days: { control: false }, blocks: { control: false }, busy: { control: false }, suggestions: { control: false }, legend: { control: false },
    ghostNote: { control: false }, isPast: { control: false }, onBlock: { control: false }, onPick: { control: false }, onDrag: { control: false }, onEnd: { control: false }
  },
  decorators: [(Story) => <div style={{ maxWidth: 1040, padding: '8px 4px' }}><Story /></div>]
} satisfies Meta<typeof CallsWeek>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The week as the Calls page shows it: what happened, what's ahead, and now. Press a call, or point at a free time. */
export const ThisWeek: Story = { name: 'This week' };

/** Pointing at a free time on Thursday afternoon: a new call there, ready to schedule. */
export const NewCallHere: Story = {
  name: 'A new call, pointed at',
  play: async ({ canvasElement, userEvent, step }) => {
    await step('Point at Thursday 15:30', async () => {
      const slot = canvasElement.querySelector('[data-at="3-15"]');
      if (slot) await userEvent.hover(slot);
    });
  }
};

/** Last week: every day has gone, so nothing in it can be picked, and there's no now. */
export const LastWeek: Story = {
  name: 'Last week',
  args: { now: null, isPast: () => true, blocks: BLOCKS.filter((b) => b.kind === 'past').map((b) => ({ ...b, wait: undefined })) }
};

/** A week with nothing in it yet. */
export const Empty: Story = { name: 'Nothing this week', args: { blocks: [], now: null, isPast: () => false } };

/** A meeting on your calendar at the time of an Alcove call: they stand side by side, not on each other. */
export const Overlapping: Story = {
  name: 'Overlapping calls',
  args: { blocks: [...BLOCKS, { id: 'clash', day: 3, start: 10.25, end: 11, title: 'Vendor call', kind: 'cal' }, { id: 'clash-2', day: 3, start: 10.5, end: 11.5, title: 'Office move', kind: 'invite' }] }
};

/**
 * Scheduling: the week dims under the call being made. Priya's and Kofi's busy times are hatched, the hours outside the
 * working day greyed, the times that suit all three of you glow, and the call itself is solid, with a grip on its foot.
 * Pointing at a free time says who's free then; pressing it moves the call there.
 */
export const Scheduling: Story = {
  args: {
    mode: 'schedule', label: 'Pick a time', work: { from: 9, to: 17 }, busy: BUSY, suggestions: SUGGESTIONS, legend: SCHEDULE_KEY, ghostNote,
    pick: { day: 3, start: 11, end: 11.75, title: 'Call with Priya and Kofi' }
  },
  render: picking
};

/** Letting a guest pick: the times offered are ticked, and nothing is picked until the guest does. */
export const LettingAGuestPick: Story = {
  name: 'Letting a guest pick',
  args: {
    mode: 'schedule', label: 'Pick a time', work: { from: 9, to: 17 }, legend: [{ kind: 'suggestion', label: 'Times Jonas can pick from' }],
    suggestions: [{ day: 3, start: 11, end: 11.75, ticked: true }, { day: 4, start: 10, end: 10.75, ticked: true }], pick: null, ghostNote: () => 'Free on your calendar'
  }
};

/** Moving Hiring sync: where it is now is dashed, and where it's going solid. */
export const MovingACall: Story = {
  name: 'Moving a call',
  args: {
    mode: 'schedule', label: 'Pick a time', work: { from: 9, to: 17 }, busy: BUSY.slice(2), suggestions: [], legend: [{ kind: 'busy', label: 'Ines and Aiko busy' }, { kind: 'was', label: 'Where it is now' }, { kind: 'pick', label: 'Where it’s going' }],
    blocks: BLOCKS.filter((b) => b.id !== 'u2'), was: { day: 3, start: 10, end: 10.75, label: 'Now 10:00' }, pick: { day: 3, start: 15.5, end: 16.25, title: 'Hiring sync' },
    ghostNote: (day, start, end) => (BUSY.slice(2).some((z) => z.day === day && z.start < end && z.end > start) ? 'Ines or Aiko busy' : 'Both free')
  }
};

/** A short call picked: its time alone, on one line. */
export const AShortCall: Story = {
  name: 'A short call',
  args: { mode: 'schedule', label: 'Pick a time', work: { from: 9, to: 17 }, busy: BUSY, suggestions: SUGGESTIONS, legend: SCHEDULE_KEY, ghostNote, pick: { day: 4, start: 15, end: 15.5 } }
};

/** The end of the call being made, moved from the keyboard: Shift and the down arrow, twice, on its half hour make it end at 12:15. */
export const ChangingTheEnd: Story = {
  name: 'Changing the end',
  args: { ...Scheduling.args, pick: { day: 3, start: 11, end: 11.75, title: 'Call with Priya and Kofi' } },
  render: picking,
  play: async ({ canvas, userEvent, step }) => {
    await step('Go to the call’s half hour, and press Shift and the down arrow twice', async () => {
      (await canvas.findByRole('button', { name: /this call/ })).focus();
      await userEvent.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
    });
  }
};
