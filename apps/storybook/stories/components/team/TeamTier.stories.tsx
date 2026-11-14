/*
 * TeamTier: under a team's name in the sky, its tier, then how many are on it and what else is worth a glance. Free plainly;
 * Team with a paid plan's small sun beside its word.
 */
import { TeamTier } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Team/TeamTier',
  component: TeamTier,
  decorators: [(Story) => <div className="tq-hero" style={{ padding: 24 }}><Story /></div>],
  parameters: { layout: 'centered' },
  args: { tier: 'free', children: '3 people' },
  argTypes: { tier: { control: 'inline-radio', options: ['free', 'team'] }, children: { control: 'text' }, className: { control: false } }
} satisfies Meta<typeof TeamTier>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A free team: everyone on their own plan. */
export const Free: Story = {};
export const FreeNight: Story = { ...Free, globals: { theme: 'dark' } };
/** On Team, as its admin sees it: who has a license, and how many are left. */
export const OnTeam: Story = { name: 'On Team, its admin', args: { tier: 'team', children: '6 people · 5 with a license · 3 licenses left' } };
export const OnTeamNight: Story = { ...OnTeam, name: 'On Team, its admin, night', globals: { theme: 'dark' } };
/** On Team, as a member sees it: who its admin is. */
export const OnTeamMember: Story = { name: 'On Team, a member', args: { tier: 'team', children: '6 people · Priya is its admin' } };
