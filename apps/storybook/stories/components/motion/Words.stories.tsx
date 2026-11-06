/*
 * Words: text that writes itself in, a word at a time, each rising a little 70ms after the last. `from` waits that many
 * milliseconds before the first. For a line that arrives, such as a summary as it's written. Play again writes it again.
 */
import { Button, Words } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Stack } from '../../../src/component';

const meta = {
  title: 'Components/Motion/Words',
  component: Words,
  args: {
    text: 'Kofi walks through the sidebar in both themes, and it reads better dark. The team agrees on one filled button per view, and Aiko finds three on the pricing page.',
    from: 0
  },
  argTypes: { text: { control: 'text' }, from: { control: { type: 'number', min: 0, step: 100 } }, className: { control: false } },
  render: function Render(args) {
    const [round, setRound] = useState(0);
    return (
      <Stack>
        <Button size="sm" icon="reset" onClick={() => setRound(round + 1)}>Play again</Button>
        <p className="ac-body-l max-w-[560px] text-ink"><Words key={round} {...args} /></p>
      </Stack>
    );
  }
} satisfies Meta<typeof Words>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Design review's summary, written in a word at a time. */
export const WritingIn: Story = { name: 'Writing in' };
/** `from`: the first word waits 600ms, for a line that follows another. */
export const AfterAWait: Story = { name: 'After a wait', args: { text: 'One filled button per view from now on.', from: 600 } };
