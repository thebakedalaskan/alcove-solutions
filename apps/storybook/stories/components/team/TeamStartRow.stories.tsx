/*
 * TeamStartRow: a quiet row on a company's Team page, while you're on no team: what a team is, and Start a team, which opens
 * checkout on Team.
 */
import { TeamStartRow } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { onTheWater } from './parts';

const meta = {
  title: 'Components/Team/TeamStartRow',
  component: TeamStartRow,
  decorators: [onTheWater()],
  parameters: { layout: 'fullscreen' },
  args: { line: 'A license for each person: $40 for 30 days. Share notes and workspaces with everyone on it.', onStart: did('onStart') },
  argTypes: { title: { control: 'text' }, line: { control: 'text' }, onStart: { control: false }, className: { control: false } }
} satisfies Meta<typeof TeamStartRow>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Under a company's page. */
export const Default: Story = {};
