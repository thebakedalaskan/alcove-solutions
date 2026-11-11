/*
 * MonthGrid: a month to pick a day from, as `@` then Pick a date… opens it in a document, in the list's place, and as
 * pressing a date tag does, to change it. Six weeks, Monday first, the days of the months either side quiet, today in the
 * warm colour of now, and the day picked marked as WeekGrid marks its pick. Any day can be picked, past ones too. The arrow
 * keys move a day (a week up and down), Home and End go to the week's ends, Page Up and Page Down a month (with Shift, a
 * year), Enter picks and Esc goes back. Stories start on Wednesday 4 November 2026, the demo day.
 */
import { MonthGrid } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { PopSurface, did } from '../../../src/component';

const meta = {
  title: 'Components/Forms/MonthGrid',
  component: MonthGrid,
  args: { value: null, today: '2026-11-04', label: 'Pick a date', autoFocus: false, onPick: did('onPick'), onCancel: did('onCancel') },
  argTypes: {
    value: { control: 'text' }, today: { control: 'text' }, label: { control: 'text' }, autoFocus: { control: 'boolean' },
    onPick: { control: false }, onCancel: { control: false }
  },
  /* On the popover it opens in, as wide as the `@` list. Picking a day makes it the one picked, as the tag it writes says. */
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <PopSurface ws width={288}><div className="wm"><MonthGrid {...args} onPick={(date) => { args.onPick(date); update({ value: date }); }} /></div></PopSurface>;
  }
} satisfies Meta<typeof MonthGrid>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing picked yet: it opens on this month, with today marked. */
export const NothingPicked: Story = { name: 'Nothing picked' };
/** A date tag's own day, when it's pressed to change it: Friday the 13th. */
export const Picked: Story = { args: { value: '2026-11-13' } };
/** A day in another year opens on its own month. */
export const AnotherYear: Story = { name: 'Another year', args: { value: '2027-02-05' } };
export const Night: Story = { args: { value: '2026-11-13' }, globals: { theme: 'dark' } };
export const Phone: Story = { args: { value: '2026-11-13' }, globals: { viewport: { value: 'phone', isRotated: false } } };
/** It has the keyboard as it opens, on the day picked: the arrow keys move from there, one ringed day at a time. */
export const FromTheKeyboard: Story = {
  name: 'From the keyboard', args: { value: '2026-11-13', autoFocus: true },
  play: async ({ userEvent, step }) => {
    await step('Two days on, then a week down. Enter would pick Sunday 22 November', async () => {
      await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowDown}');
    });
  }
};
