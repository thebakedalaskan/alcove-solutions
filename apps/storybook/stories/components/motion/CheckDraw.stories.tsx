/*
 * CheckDraw: a check mark that draws itself when `done` turns on, over `duration` seconds, and fades when it turns
 * off. It's drawn in the text's colour at `size` pixels. Check, the to-do box, draws its tick with it.
 */
import { Button, Check, CheckDraw } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { Row } from '../../../src/component';

const meta = {
  title: 'Components/Motion/CheckDraw',
  component: CheckDraw,
  parameters: { layout: 'centered' },
  args: { done: true, size: 40, duration: 0.36 },
  argTypes: {
    size: { control: { type: 'range', min: 10, max: 96, step: 2 } },
    duration: { control: { type: 'range', min: 0.1, max: 2, step: 0.02 } },
    className: { control: false }
  },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <Row>
        <span className="grid size-[72px] place-items-center rounded-[var(--radius-md)] bg-sun-soft text-sun-text"><CheckDraw {...args} /></span>
        <Check checked={args.done} label="Cut the pricing page to one filled button" onChange={(done) => update({ done })} />
        <Button size="sm" onClick={() => update({ done: !args.done })}>{args.done ? 'Mark not done' : 'Mark done'}</Button>
      </Row>
    );
  }
} satisfies Meta<typeof CheckDraw>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Done: drawn. Mark not done, then done again, to see it draw. */
export const Done: Story = {};
/** Not done yet: nothing is drawn. */
export const NotDone: Story = { name: 'Not done', args: { done: false } };
/** Drawn slowly, over a second and a half. */
export const Slow: Story = { args: { done: false, duration: 1.5 } };
