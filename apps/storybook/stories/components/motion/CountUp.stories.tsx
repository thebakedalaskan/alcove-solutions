/*
 * CountUp: a number that counts to `value` from wherever it last was, easing out over `duration` seconds, in tabular
 * figures so the digits don't jostle. `format` says how it reads (whole numbers with thousands by default). Under
 * reduced motion it's simply the number. Press a button, or change `value` in Controls, and it counts there.
 */
import { Button, CountUp } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { Row, Stack } from '../../../src/component';

/** "1 h 12 min", as durations read. */
const hoursAndMinutes = (v: number) => {
  const m = Math.round(v);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

const meta = {
  title: 'Components/Motion/CountUp',
  component: CountUp,
  parameters: { layout: 'centered' },
  args: { value: 1240, duration: 1.2 },
  argTypes: {
    value: { control: { type: 'number', min: 0, step: 10 } },
    duration: { control: { type: 'range', min: 0.2, max: 4, step: 0.1 } },
    format: { control: false }, className: { control: false }
  },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <Stack>
        <div className="grid gap-1">
          <span className="text-[44px] leading-none font-semibold tracking-[-0.02em]"><CountUp {...args} /></span>
          <span className="text-[13.5px] text-ink-3">Minutes of notes written this month</span>
        </div>
        <Row>
          {[86, 1240, 4800].map((value) => <Button key={value} size="sm" onClick={() => update({ value })}>Count to {value.toLocaleString('en-US')}</Button>)}
        </Row>
      </Stack>
    );
  }
} satisfies Meta<typeof CountUp>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Counts up from nothing as it opens, then from wherever it is to each new value. */
export const Counting: Story = {};
/** With a `format`: minutes, read as hours and minutes. */
export const AsHoursAndMinutes: Story = { name: 'As hours and minutes', args: { value: 72, format: hoursAndMinutes } };
