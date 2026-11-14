/*
 * InvitationRow: an invitation, as a row on the water, over the team's hairlines. Someone asked to join your team, on its
 * Invited list: an empty arch with their initial (they're not on it yet), who invited them and when, and in its last week
 * when it runs out, with Resend and Cancel for whoever invited them and the admin, Cancel asked in place under the row. Or
 * an invitation of yours put aside, with Join still there.
 */
import { Button, InvitationRow, TeamAsk, TeamRows, TeamSection } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { JONAS, LENA, SAM } from '../../../src/world/people';
import { onTheWater } from './parts';

const MANAGE = <><Button variant="quiet" size="sm" onClick={did('onResend')}>Resend</Button><Button variant="quiet" size="sm" onClick={did('onCancel')}>Cancel</Button></>;

const meta = {
  title: 'Components/Team/InvitationRow',
  component: InvitationRow,
  decorators: [(Story) => <TeamSection title="Invited"><TeamRows><Story /></TeamRows></TeamSection>, onTheWater()],
  parameters: { layout: 'fullscreen' },
  args: { person: LENA, ghost: true, title: 'Lena Fischer', line: 'Invited by Priya · 26 days ago · Runs out in 4 days', actions: MANAGE },
  argTypes: { title: { control: 'text' }, line: { control: 'text' }, ghost: { control: 'boolean' }, person: { control: false }, actions: { control: false }, children: { control: false }, className: { control: false } }
} satisfies Meta<typeof InvitationRow>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Someone invited, in its last week: Resend and Cancel. */
export const Invited: Story = {};
export const InvitedNight: Story = { ...Invited, globals: { theme: 'dark' } };
export const InvitedPhone: Story = { ...Invited, globals: { viewport: { value: 'phone' } } };
/** Sent again today: Resend waits until tomorrow, quiet in its place. */
export const SentToday: Story = {
  name: 'Sent today',
  args: { person: SAM, title: 'Sam Ortiz', line: 'Invited 2 days ago · Sent again today', actions: <><Button variant="quiet" size="sm" disabled>Sent today</Button><Button variant="quiet" size="sm" onClick={did('onCancel')}>Cancel</Button></> }
};
/** Sent 3 times in its 30 days: the most it's sent. */
export const SentThreeTimes: Story = {
  name: 'Sent 3 times',
  args: { person: SAM, title: 'Sam Ortiz', line: 'Invited 12 days ago · Sent again yesterday', actions: <><Button variant="quiet" size="sm" disabled>Sent 3 times</Button><Button variant="quiet" size="sm" onClick={did('onCancel')}>Cancel</Button></> }
};
/** Someone else's invitation, for a member: nothing to press. */
export const SomeoneElses: Story = { name: 'Someone else’s', args: { actions: undefined } };
/** Cancel, asked in place under the row: Keep it is the filled answer. */
export const CancelAsked: Story = {
  name: 'Cancel, asked',
  args: {
    actions: undefined,
    children: <TeamAsk title="Cancel Lena’s invitation?" text="Their link stops working." confirm="Cancel invitation" keep="Keep it" onConfirm={did('onConfirm')} onKeep={did('onKeep')} />
  }
};
/** An invitation of yours put aside: quiet, with Join still there until it runs out. */
export const PutAside: Story = {
  name: 'Put aside',
  decorators: [(Story) => <TeamSection title="Put aside"><TeamRows><Story /></TeamRows></TeamSection>, onTheWater()],
  args: { person: JONAS, ghost: false, title: 'Jonas invited you to join Weber Design', line: 'Put aside · Runs out on 2 Dec', actions: <Button variant="secondary" size="sm" onClick={did('onJoin')}>Join</Button> }
};
