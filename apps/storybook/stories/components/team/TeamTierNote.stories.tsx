/*
 * TeamTierNote: what a free team's tier means, said once at the top of its water, with what you can do about it at its
 * end: Upgrade for the admin (the page's one Upgrade, filled once someone else is on the team), Ask Priya to upgrade for
 * everyone else, or that they've been asked (`done`, said as it changes). While someone has asked its admin, it says who.
 */
import { Button, TeamTierNote } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { onTheWater } from './parts';

const LINE = 'Upgrading gives everyone on it a license: the team’s notes and workspaces open to everyone, and storage is pooled.';

const meta = {
  title: 'Components/Team/TeamTierNote',
  component: TeamTierNote,
  decorators: [onTheWater()],
  parameters: { layout: 'fullscreen' },
  args: { title: 'Vandelay Industries is on Free.', line: LINE, action: <Button size="sm" onClick={did('onUpgrade')}>Upgrade</Button> },
  argTypes: { title: { control: 'text' }, line: { control: 'text' }, done: { control: 'text' }, action: { control: false }, className: { control: false } }
} satisfies Meta<typeof TeamTierNote>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Its admin: Upgrade opens checkout on Team for it. */
export const ForTheAdmin: Story = { name: 'For the admin' };
/** Someone else is on it: Upgrade is the page's filled button. */
export const ForTheAdminFilled: Story = { name: 'For the admin, someone else on it', args: { action: <Button variant="primary" size="sm" onClick={did('onUpgrade')}>Upgrade</Button> } };
/** Kofi asked its admin to upgrade it: the note says who, beside Upgrade. */
export const AskedByKofi: Story = { name: 'Kofi asked', args: { title: 'Kofi asked you to upgrade.', action: <Button variant="primary" size="sm" onClick={did('onUpgrade')}>Upgrade</Button> } };
export const ForTheAdminNight: Story = { ...ForTheAdmin, name: 'For the admin, night', globals: { theme: 'dark' } };
export const ForTheAdminPhone: Story = { ...ForTheAdmin, name: 'For the admin, phone', globals: { viewport: { value: 'phone' } } };
/** Everyone else: ask the admin, who's told once. */
export const ForAMember: Story = { name: 'For a member', args: { action: <Button size="sm" onClick={did('onAsk')}>Ask Priya to upgrade</Button> } };
/** Asked: for a week it says so in the button's place. */
export const Asked: Story = { args: { done: 'Priya’s been asked' } };
/** Its licenses have ended: what it shared waits for it. */
export const LicensesEnded: Story = { name: 'Its licenses ended', args: { line: 'What it shared opens again when it’s upgraded.' } };
