/*
 * RevealGroup: each child rises into place in turn, 0.12 seconds apart, the first time the group scrolls into view. For
 * things that arrive together: a page's cards, a list's rows. Under reduced motion they're simply there. Play again
 * mounts the group afresh, so it plays again.
 */
import { ArchThumb, Button, Card, RevealGroup, coverFor } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Stack } from '../../../src/component';

/** Three of the demo world's notes, each a card. */
const NOTES = [
  { id: 'n2', title: 'Team standup', when: 'Today · 20 min', said: 'The new onboarding ships behind a flag on 12 November, and support gets the help article first.' },
  { id: 'n4', title: 'Design review', when: 'Yesterday · 45 min', said: 'The sidebar reads better dark. One filled button per view from now on.' },
  { id: 'n3', title: 'Pricing sync', when: 'Yesterday · 32 min', said: 'The team plan gets a monthly option. Free minutes stay as they are.' }
];

const CARDS = NOTES.map((n) => (
  <Card key={n.id}>
    <div className="flex gap-3.5">
      <ArchThumb cover={coverFor(n.id)} width={30} />
      <div className="grid min-w-0 gap-1">
        <b className="text-[15px] font-semibold">{n.title}</b>
        <small className="text-[12.5px] text-ink-3">{n.when}</small>
        <p className="mt-1 text-[14px] leading-[1.45] text-ink-2">{n.said}</p>
      </div>
    </div>
  </Card>
));

const meta = {
  title: 'Components/Motion/RevealGroup',
  component: RevealGroup,
  args: { className: 'grid w-[min(520px,100%)] gap-3', children: CARDS },
  argTypes: { children: { control: false }, className: { control: false } },
  render: function Render(args) {
    const [round, setRound] = useState(0);
    return (
      <Stack>
        <Button size="sm" icon="reset" onClick={() => setRound(round + 1)}>Play again</Button>
        <RevealGroup key={round} {...args} />
      </Stack>
    );
  }
} satisfies Meta<typeof RevealGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Three notes rise in turn. */
export const Staggered: Story = {};
