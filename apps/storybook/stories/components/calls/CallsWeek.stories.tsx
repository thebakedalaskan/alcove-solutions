/*
 * CallsWeek and its head, CallsWeekHead: the week on the Calls page, and the week a call is scheduled on. A box of all 24
 * hours that scrolls, ten of them filling it and 08:00 at its top to start, the day row staying above them; every block says
 * its time first, its name only when a whole line of it fits, and blocks that overlap stand side by side.
 *
 * Browsing (Monday to Sunday): what happened (filled and faded, with what waits on you: a rose diamond for a decision to
 * confirm, a blue dot for a follow-up), Alcove calls with a sun edge, the calendar's meetings outlined, an invitation dashed
 * in rose, a time held for a guest dashed, and the key under the week. Pressing a block opens it; pointing at a free time
 * shows a new call there, and pressing it or dragging across free time starts scheduling. On a phone, today and the next
 * two days.
 *
 * Scheduling (seven days from today): your blocks neutral, the hours outside the working day greyed, Priya's and Kofi's busy
 * time hatched with whose it is, the past veiled, and the call solid with a grip on its foot (a caution ring when it
 * clashes). Pressing anywhere free or inside the call starts it at that half hour; dragging carries it to any day, or held at
 * the edge of the days into the next week; the grip sets its end; dragging across free time gives it that stretch. Letting
 * a guest pick, the offered times are numbered: the active one solid, the others outlined, one left out dashed. With little
 * room, only Monday to Friday. Tab reaches the half hours once; the arrow keys move around them.
 */
import { CallsWeek, CallsWeekHead, type CallsWeekBlock, type CallsWeekBusy, type CallsWeekCall, type CallsWeekDay, type CallsWeekFree, type CallsWeekKeyItem, type CallsWeekProps } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type CSSProperties } from 'react';
import { did } from '../../../src/component';
import { on } from '../../../src/world/clock';

const H = (h: number, m = 0) => h * 60 + m;
const short = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const month = new Intl.DateTimeFormat('en-GB', { month: 'short' });
const whole = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
/** A day on the week; `today`, its index when it's on it. */
const dayOf = (d: Date, i: number, today: number | null): CallsWeekDay => ({
  weekday: short.format(d), date: d.getDate(), label: whole.format(d), today: i === today, weekend: d.getDay() === 0 || d.getDay() === 6,
  short: i === today ? 'Today' : today !== null && i === today + 1 ? 'Tomorrow' : `${short.format(d)} ${d.getDate()} ${month.format(d)}`
});
/** "4 – 10 Nov", "25 Nov – 1 Dec". */
const span = (a: Date, b: Date) => (a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${month.format(b)}` : `${a.getDate()} ${month.format(a)} – ${b.getDate()} ${month.format(b)}`);

/* ---------- browsing: Monday 2 to Sunday 8 November, today Wednesday 4, a little after half past twelve ---------- */
const WEEK = [-2, -1, 0, 1, 2, 3, 4].map((d, i) => dayOf(on(d, 0), i, 2));
const NOW = { day: 2, minute: H(12, 33) };
const BLOCKS: CallsWeekBlock[] = [
  { id: 'n2-mon', day: 0, start: H(9), end: H(9, 15), title: 'Team standup', kind: 'past' },
  { id: 'n6', day: 0, start: H(10, 30), end: H(11, 42), title: 'Site visit, Harbourline', kind: 'past' },
  { id: 'n5', day: 0, start: H(14, 10), end: H(15, 2), title: 'Interview: Jonas Weber', kind: 'past' },
  { id: 'n2-tue', day: 1, start: H(9), end: H(9, 18), title: 'Team standup', kind: 'past' },
  { id: 'n4', day: 1, start: H(11), end: H(11, 45), title: 'Design review', kind: 'past' },
  { id: 'n3', day: 1, start: H(15), end: H(15, 32), title: 'Pricing sync', kind: 'past', wait: 'fu' },
  { id: 'n2', day: 2, start: H(9), end: H(9, 20), title: 'Team standup', kind: 'past', wait: 'dec' },
  { id: 'n1', day: 2, start: H(11, 0), end: H(12, 10), title: 'Moving the warehouse', kind: 'past', wait: 'dec' },
  { id: 'h1', day: 2, start: H(16), end: H(16, 30), title: 'Harbourline weekly', kind: 'cal' },
  { id: 'u1', day: 2, start: H(17, 30), end: H(18), title: 'Launch check-in', kind: 'soon' },
  { id: 's1n', day: 3, start: H(9), end: H(9, 20), title: 'Team standup', kind: 'soon' },
  { id: 'u2', day: 3, start: H(10), end: H(10, 45), title: 'Hiring sync', kind: 'soon' },
  { id: 'dc', day: 3, start: H(14), end: H(15), title: 'Design crit', kind: 'invite' },
  { id: 'fri-standup', day: 4, start: H(9), end: H(9, 20), title: 'Team standup', kind: 'soon' },
  { id: 'jw', day: 4, start: H(11), end: H(11, 45), title: 'Held for Jonas', kind: 'hold' },
  { id: 'fresh', day: 4, start: H(15), end: H(16), title: 'Office move', kind: 'fresh' }
];
const KEY: CallsWeekKeyItem[] = [
  { kind: 'past', label: 'Past, with notes' }, { kind: 'soon', label: 'Alcove call' }, { kind: 'cal', label: 'From your calendar' },
  { kind: 'invite', label: 'Waiting for your answer' }, { kind: 'hold', label: 'Held until a guest picks' }
];

/* ---------- scheduling: Wednesday 4 to Tuesday 10 November, today the first of them ---------- */
const SEVEN = [0, 1, 2, 3, 4, 5, 6].map((d, i) => dayOf(on(d, 0), i, 0));
const SNOW = { day: 0, minute: H(12, 33) };
const MINE: CallsWeekBlock[] = [
  { id: 'm1', day: 0, start: H(9), end: H(9, 20), title: 'Team standup', kind: 'past' },
  { id: 'm2', day: 0, start: H(16), end: H(16, 30), title: 'Harbourline weekly', kind: 'cal' },
  { id: 'm3', day: 1, start: H(9), end: H(9, 15), title: 'Team standup', kind: 'soon' },
  { id: 'm4', day: 1, start: H(10), end: H(10, 45), title: 'Hiring sync', kind: 'soon' },
  { id: 'm5', day: 1, start: H(14), end: H(15), title: 'Design crit', kind: 'invite' },
  { id: 'm6', day: 2, start: H(9), end: H(9, 15), title: 'Team standup', kind: 'soon' },
  { id: 'm7', day: 5, start: H(9), end: H(9, 15), title: 'Team standup', kind: 'soon' },
  { id: 'm8', day: 5, start: H(11), end: H(12), title: 'Launch planning', kind: 'soon' },
  { id: 'm9', day: 6, start: H(10, 30), end: H(11, 30), title: 'Design review', kind: 'cal' }
];
const PRIYA: CallsWeekBusy[] = [
  { day: 0, start: H(13), end: H(15), who: 'Priya' }, { day: 1, start: H(11), end: H(12, 30), who: 'Priya' }, { day: 5, start: H(14), end: H(15), who: 'Priya' }
];
const KOFI: CallsWeekBusy[] = [
  { day: 0, start: H(14), end: H(16), who: 'Kofi' }, { day: 1, start: H(16), end: H(17), who: 'Kofi' }, { day: 6, start: H(13), end: H(14, 30), who: 'Kofi' }
];
/** Their busy time merged into bands, each saying whose it is. */
const BANDS: CallsWeekBusy[] = [
  { day: 0, start: H(13), end: H(16), who: 'Priya, Kofi' }, { day: 1, start: H(11), end: H(12, 30), who: 'Priya' }, { day: 1, start: H(16), end: H(17), who: 'Kofi' },
  { day: 5, start: H(14), end: H(15), who: 'Priya' }, { day: 6, start: H(13), end: H(14, 30), who: 'Kofi' }
];
const over = <T extends { day: number; start: number; end: number }>(list: readonly T[], day: number, start: number, end: number): T[] => list.filter((x) => x.day === day && x.start < end && x.end > start);
const free = (day: number, start: number, end: number): CallsWeekFree => {
  const mine = over(MINE, day, start, end)[0];
  if (mine) return { text: mine.title, busy: true };
  const who = [...over(PRIYA, day, start, end).length ? ['Priya'] : [], ...over(KOFI, day, start, end).length ? ['Kofi'] : []];
  return who.length ? { text: `${who.join(' and ')} busy`, busy: true } : { text: 'All 3 free', busy: false };
};
const freeForJonas = (day: number, start: number, end: number): CallsWeekFree => {
  const mine = over(MINE, day, start, end)[0];
  return mine ? { text: mine.title, busy: true } : { text: 'Free on your calendar', busy: false };
};

/** The week while scheduling, as the scheduler keeps it: pressing, dragging and the grip move the call; the edge turns the week. */
function Scheduling(args: CallsWeekProps) {
  /* The calls keep their days counted from today; the week shows them on whichever page they're on. */
  const [calls, setCalls] = useState<readonly CallsWeekCall[]>(args.calls ?? []);
  const [page, setPage] = useState(0);
  const days = page ? SEVEN.map((_, i) => dayOf(on(page * 7 + i, 0), i, null)) : SEVEN;
  const set = (patch: (c: CallsWeekCall) => CallsWeekCall) => setCalls((list) => list.map((c) => (c.active ? patch(c) : c)));
  const shown = calls.map((c) => ({ ...c, day: c.day - page * 7 }));
  return (
    <div className="cw-sheet">
      <CallsWeekHead title={span(on(page * 7, 0), on(page * 7 + 6, 0))} canGoBack={page > 0} onBefore={() => setPage((p) => Math.max(0, p - 1))}
        onAfter={() => setPage((p) => p + 1)} onToday={page ? () => setPage(0) : undefined} />
      <CallsWeek {...args} days={days} now={{ day: -7 * page, minute: SNOW.minute }} calls={shown} canGoBack={page > 0}
        busy={page ? [] : args.busy} blocks={page ? [] : args.blocks} free={page ? () => ({ text: 'All 3 free', busy: false }) : args.free}
        onPick={(day, start) => { args.onPick?.(day, start); set((c) => ({ ...c, day: day + page * 7, start, end: Math.min(1440, start + (c.end - c.start)) })); }}
        onRange={(day, start, end) => { args.onRange?.(day, start, end); set((c) => ({ ...c, day: day + page * 7, start, end })); }}
        onResize={(end) => { args.onResize?.(end); set((c) => ({ ...c, end })); }}
        onSelect={(i) => { args.onSelect?.(i); setCalls((list) => list.map((c, k) => ({ ...c, active: k === i }))); }}
        onTurn={(step) => { args.onTurn?.(step); setPage((p) => Math.max(0, p + step)); }} />
    </div>
  );
}

/** Calls' own week, with its head: the days, ‹ and ›, and List and Week at its end. */
function Browsing(args: CallsWeekProps) {
  return (
    <div className="cw-sheet">
      <CallsWeekHead title="2 – 8 Nov" onBefore={did('onBefore')} onAfter={did('onAfter')} />
      <CallsWeek {...args} />
    </div>
  );
}

/** A narrower sheet, as on a phone or beside a wide editor. */
const narrow = (width: number): CSSProperties => ({ width, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' });

const meta = {
  title: 'Components/Calls/CallsWeek',
  component: CallsWeek,
  args: { days: WEEK, blocks: BLOCKS, now: NOW, legend: KEY, label: '2 – 8 Nov', onBlock: did('onBlock'), onPick: did('onPick'), onRange: did('onRange') },
  argTypes: {
    mode: { control: 'inline-radio', options: ['browse', 'schedule'] },
    days: { control: false }, blocks: { control: false }, busy: { control: false }, calls: { control: false }, legend: { control: false }, free: { control: false },
    onBlock: { control: false }, onPick: { control: false }, onRange: { control: false }, onResize: { control: false }, onSelect: { control: false }, onTurn: { control: false }
  },
  render: Browsing,
  decorators: [(Story) => <div style={{ height: 720, maxWidth: 1080, display: 'flex', flexDirection: 'column', borderRadius: 18, background: 'var(--surface)', boxShadow: 'inset 0 0 0 1px var(--line)' }}><Story /></div>]
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
      const slot = canvasElement.querySelector('.cw-slot[data-d="3"][data-s="31"]');
      if (!(slot instanceof HTMLElement)) return;
      const r = slot.getBoundingClientRect();
      await userEvent.pointer({ target: slot, coords: { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 } });
    });
  }
};

/** Last week: every day has gone, so nothing in it can be pressed, and there's no now on it. */
export const LastWeek: Story = {
  name: 'Last week',
  args: { now: { day: 9, minute: H(12, 33) }, blocks: BLOCKS.filter((b) => b.kind === 'past').map((b) => ({ ...b, wait: undefined })) }
};

/** A week with nothing in it yet. */
export const Empty: Story = { name: 'Nothing this week', args: { blocks: [], now: { day: -5, minute: H(9) } } };

/** A meeting on your calendar at the time of an Alcove call: they stand side by side, not on each other. */
export const Overlapping: Story = {
  name: 'Overlapping calls',
  args: { blocks: [...BLOCKS, { id: 'clash', day: 3, start: H(10, 15), end: H(11), title: 'Vendor call', kind: 'cal' }, { id: 'clash-2', day: 3, start: H(10, 30), end: H(11, 30), title: 'Office move', kind: 'invite' }] }
};

/** On a phone: today and the next two days. */
export const Phone: Story = {
  name: 'On a phone',
  globals: { viewport: { value: 'phone', isRotated: false } }
};

const SCHEDULE = {
  mode: 'schedule', days: SEVEN, now: SNOW, label: 'Pick a time', work: { from: H(9), to: H(17) }, blocks: MINE, busy: BANDS, free, legend: undefined,
  onResize: did('onResize'), onSelect: did('onSelect'), onTurn: did('onTurn')
} satisfies Partial<CallsWeekProps>;

/**
 * Scheduling with Priya and Kofi: their busy time hatched with whose it is, the hours outside the working day greyed, the
 * morning veiled, and the call solid with its grip. Press, drag, or hold it at the right edge to carry it into next week.
 */
export const Schedule: Story = {
  name: 'Scheduling',
  args: { ...SCHEDULE, calls: [{ day: 0, start: H(16, 30), end: H(17, 15), active: true, title: 'Call with Priya and Kofi' }] },
  render: Scheduling
};

/** The call over Priya's and Kofi's afternoon: a caution ring, and the band's label moves to the first spot the call doesn't cover. */
export const Clash: Story = {
  name: 'A clash',
  args: { ...SCHEDULE, calls: [{ day: 0, start: H(14), end: H(14, 45), active: true, clash: true, title: 'Call with Priya and Kofi' }] },
  render: Scheduling
};

/** Letting Jonas pick: three times offered, numbered; the second is the one the week moves, and the third is left out. */
export const LettingAGuestPick: Story = {
  name: 'Letting a guest pick',
  args: {
    ...SCHEDULE, busy: [], free: freeForJonas,
    calls: [
      { day: 1, start: H(11, 30), end: H(12, 15), n: 1, active: false },
      { day: 2, start: H(11, 30), end: H(12, 15), n: 2, active: true },
      { day: 5, start: H(11, 30), end: H(12, 15), n: 3, active: false, off: true }
    ]
  },
  render: Scheduling
};

/** Moving Hiring sync: where it is now is dashed, and where it's going solid. */
export const MovingACall: Story = {
  name: 'Moving a call',
  args: {
    ...SCHEDULE, blocks: MINE.filter((b) => b.id !== 'm4'), was: { day: 1, start: H(10), end: H(10, 45), label: 'Now 10:00' },
    calls: [{ day: 1, start: H(15, 30), end: H(16, 15), active: true, title: 'Hiring sync' }]
  },
  render: Scheduling
};

/** A short call: its time alone, on one line. */
export const AShortCall: Story = {
  name: 'A short call',
  args: { ...SCHEDULE, calls: [{ day: 2, start: H(10), end: H(10, 15), active: true, title: 'Call with Priya and Kofi' }] },
  render: Scheduling
};

/** The call late at night, below the hours in view: the pill says where it is, and takes you there. */
export const OutOfView: Story = {
  name: 'Out of view',
  args: { ...SCHEDULE, calls: [{ day: 1, start: H(21), end: H(21, 45), active: true, title: 'Call with Priya and Kofi' }] },
  render: Scheduling,
  play: async ({ canvasElement, step }) => {
    await step('Scroll back to the morning', async () => {
      canvasElement.querySelector('.cw-box')?.scrollTo({ top: 0 });
    });
  }
};

/** With little room, only Monday to Friday of the seven days. */
export const OnlyWeekdays: Story = {
  name: 'Only weekdays',
  args: { ...SCHEDULE, calls: [{ day: 0, start: H(16, 30), end: H(17, 15), active: true, title: 'Call with Priya and Kofi' }] },
  render: Scheduling,
  decorators: [(Story) => <div style={narrow(470)}><Story /></div>]
};

/** The end moved from the keyboard: Shift and the down arrow, twice, on the call's first half hour, make it end at 17:45. */
export const ChangingTheEnd: Story = {
  name: 'Changing the end',
  args: { ...SCHEDULE, calls: [{ day: 0, start: H(16, 30), end: H(17, 15), active: true, title: 'Call with Priya and Kofi' }] },
  render: Scheduling,
  play: async ({ canvas, userEvent, step }) => {
    await step('Go to the call’s half hour, and press Shift and the down arrow twice', async () => {
      (await canvas.findByRole('button', { name: /16:30 to 17:15, Call with Priya and Kofi/ })).focus();
      await userEvent.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
    });
  }
};
