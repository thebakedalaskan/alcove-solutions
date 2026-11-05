/*
 * ShowMore: "Show 4 more" under a list that's longer than its first few, and "Show fewer" once it's open. A quiet link
 * centred under the list it opens, as Home's cards have it. A list shows it only when more than one more would show, so
 * it never says "Show 1 more".
 */
import { Card, ShowMore } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';

/** What's waiting on you, from the demo world's notes. */
const FOLLOW_UPS = [
  'Book the movers for the 14th',
  'List which suppliers move with us',
  'Update the delivery times on the order page',
  'Review the launch checklist',
  'Write the help article for support',
  'Add the flag to the rollout plan',
  'Send Kofi the pricing draft'
];
const FIRST = 3;

const meta = {
  title: 'Components/Actions/ShowMore',
  component: ShowMore,
  args: { all: false, more: FOLLOW_UPS.length - FIRST, onToggle: did('onToggle') },
  argTypes: { more: { control: { type: 'number', min: 2 } } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    const rows = args.all ? FOLLOW_UPS : FOLLOW_UPS.slice(0, FIRST);
    return (
      <Card title="Follow-ups" style={{ maxWidth: 520 }}>
        <ul style={{ display: 'grid', gap: 10, margin: '4px 0 8px' }}>{rows.map((r) => <li key={r} className="ac-body">{r}</li>)}</ul>
        <ShowMore {...args} onToggle={() => { args.onToggle(); update({ all: !args.all }); }} />
      </Card>
    );
  }
} satisfies Meta<typeof ShowMore>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The list shows its first few, and says how many more there are. */
export const Closed: Story = {};
/** Open: everything shows, and the link folds it away again. */
export const Open: Story = { args: { all: true } };
