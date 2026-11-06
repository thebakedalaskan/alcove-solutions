/*
 * Reveal: rises into place the first time it scrolls into view, and only that once. `lift` is for a large frame or
 * picture, which comes up from further and grows slightly as it does. Under reduced motion it's simply there. Here
 * Play again mounts it afresh, so it rises again; scrolled into view is the third story.
 */
import { ArchThumb, Button, Card, Reveal } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Stack } from '../../../src/component';

/** What Design review decided, as a note shows it. */
const DECIDED = (
  <Card title="Decisions" className="w-[min(440px,100%)]">
    <ul className="grid gap-2 pt-1 text-[14.5px] leading-[1.45] text-ink-2">
      <li>One filled button per view from now on.</li>
      <li>The sidebar stays dark in both themes.</li>
    </ul>
  </Card>
);

const meta = {
  title: 'Components/Motion/Reveal',
  component: Reveal,
  args: { lift: false, children: DECIDED },
  argTypes: { children: { control: false }, className: { control: false } },
  render: function Render(args) {
    const [round, setRound] = useState(0);
    return (
      <Stack>
        <Button size="sm" icon="reset" onClick={() => setRound(round + 1)}>Play again</Button>
        <Reveal key={round} {...args} />
      </Stack>
    );
  }
} satisfies Meta<typeof Reveal>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A card rises 36px into place. */
export const Rise: Story = {};
/** `lift`: a large picture comes up from further and grows slightly. */
export const Lift: Story = { args: { lift: true, children: <ArchThumb cover="dawn" width={180} /> } };
/** Scroll down: it rises the first time it comes into view, and stays put after that. */
export const WhenScrolledIntoView: Story = {
  name: 'When scrolled into view',
  render: (args) => (
    <div>
      <p className="text-[14px] text-ink-3">Scroll down. The card below rises the first time it comes into view.</p>
      <div className="h-[110vh]" />
      <Reveal {...args} />
      <div className="h-[40vh]" />
    </div>
  )
};
