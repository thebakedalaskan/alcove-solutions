/*
 * EmptyWeek: a week, drawn: three days with a few meetings in them, tinted as calls, decisions and now are. Home's
 * Upcoming shows it over Connect Google Calendar, before there's a calendar. Drawn from the tokens, so it suits either theme.
 */
import { EmptyWeek } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Feedback/EmptyWeek',
  component: EmptyWeek,
  parameters: { layout: 'centered' }
} satisfies Meta<typeof EmptyWeek>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
