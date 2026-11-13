/*
 * EmptyWeek: a week, drawn: three days. `blocks` says what's in them: a few meetings tinted as calls, decisions and now are
 * (Home's Upcoming shows it over Connect Google Calendar, before there's a calendar); your own time, hatched, when every
 * event in the week has only you on it; or nothing, when the week is clear. Drawn from the tokens, so it suits either theme.
 */
import { EmptyWeek } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Feedback/EmptyWeek',
  component: EmptyWeek,
  argTypes: { blocks: { control: 'inline-radio', options: ['calls', 'own', 'none'] } },
  parameters: { layout: 'centered' }
} satisfies Meta<typeof EmptyWeek>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Before there's a calendar: a few meetings, as they'll look. */
export const Default: Story = {};
/** A week of only your own events: hatched, as scheduling hatches the time you're busy. */
export const YourOwnTime: Story = { name: 'Your own time', args: { blocks: 'own' } };
/** A clear week: nothing on any day. */
export const Clear: Story = { args: { blocks: 'none' } };
