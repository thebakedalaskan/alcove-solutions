import { FollowUpSuggestions, type FollowUpReviewRow } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { Box, did } from '../../../src/component';
import { FOLLOW_UP_CHANGE, FOLLOW_UP_NEW } from '../../../src/world/follow-ups';
import { KOFI } from '../../../src/world/people';

const ROWS: FollowUpReviewRow[] = [FOLLOW_UP_NEW, FOLLOW_UP_CHANGE].map((p) => ({
  id: p.id, text: p.text, owner: p.owner ?? null, due: p.due ?? null,
  target: p.target ? { text: p.target.text, owner: KOFI.name, due: p.target.due } : null,
  evidence: <small>From the call · {p.evidence[0]?.said === 60 ? '1:00' : '2:00'}</small>, busy: false, canReview: true
}));
const meta = {
  title: 'Components/Notes and transcript/FollowUpSuggestions', component: FollowUpSuggestions,
  args: { count: 2, rows: null, waiting: 0, onOpen: did('onOpen'), onClose: did('onClose'), onReview: did('onReview') },
  argTypes: { rows: { control: false }, count: { control: 'number' }, waiting: { control: 'number' } },
  render: function Review(args) {
    const [, update] = useArgs<typeof args>();
    return <Box width={640} height="auto"><FollowUpSuggestions {...args}
      onOpen={() => { args.onOpen(); update({ rows: ROWS }); }}
      onClose={() => { args.onClose(); update({ rows: null }); }}
      onReview={(id, decision) => {
        args.onReview(id, decision);
        update({ rows: (args.rows ?? ROWS).map((row) => row.id === id ? { ...row, canReview: false, status: decision === 'dismiss' ? 'Dismissed' : row.target ? 'Change applied' : 'Added' } : row) });
      }} /></Box>;
  }
} satisfies Meta<typeof FollowUpSuggestions>;
export default meta;
type Story = StoryObj<typeof meta>;

export const QuietCount: Story = {};
export const ReviewInPlace: Story = { args: { rows: ROWS } };
export const MoreArrive: Story = { args: { rows: ROWS, count: 3, waiting: 1 } };
export const ReviewedBySomeoneElse: Story = { args: { rows: ROWS.map((r) => ({ ...r, canReview: false, status: 'Already reviewed by someone else.' })) } };
export const Stale: Story = { args: { rows: ROWS.map((r) => ({ ...r, canReview: false, status: 'Changed since you opened this. Close and review it again.' })) } };
export const ReadOnly: Story = { args: { rows: ROWS.map((r) => ({ ...r, canReview: false, status: 'You can read this suggestion.' })) } };
export const OnAPhone: Story = { args: { rows: ROWS }, globals: { viewport: { value: 'phone', isRotated: false } } };
