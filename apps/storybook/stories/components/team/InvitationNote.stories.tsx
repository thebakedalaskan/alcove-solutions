/*
 * InvitationNote: an invitation to another team, said once at the top of your own team's water. Who sent it in their arch,
 * what it is, who's on it, and Not now and Join at its end. Before joining, leaving the team you're on is asked in their
 * place (`ask`); an admin with others on their team can't join yet, and it says why (`note`).
 */
import { Button, InvitationNote, TeamAsk } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { JONAS } from '../../../src/world/people';
import { onTheWater } from './parts';

const ACTIONS = <><Button variant="quiet" size="sm" onClick={did('onNotNow')}>Not now</Button><Button variant="primary" size="sm" onClick={did('onJoin')}>Join Weber Design</Button></>;

const meta = {
  title: 'Components/Team/InvitationNote',
  component: InvitationNote,
  decorators: [onTheWater()],
  parameters: { layout: 'fullscreen' },
  args: { person: JONAS, title: 'Jonas invited you to join Weber Design.', line: 'Lotte and Malik are on it.', actions: ACTIONS },
  argTypes: { title: { control: 'text' }, line: { control: 'text' }, note: { control: 'text' }, person: { control: false }, actions: { control: false }, ask: { control: false }, className: { control: false } }
} satisfies Meta<typeof InvitationNote>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Invited: Story = {};
export const InvitedNight: Story = { ...Invited, globals: { theme: 'dark' } };
export const InvitedPhone: Story = { ...Invited, globals: { viewport: { value: 'phone' } } };
/** Join pressed, as a member of Vandelay Industries: leaving it is asked first, in place. */
export const LeaveFirst: Story = {
  name: 'Leave first',
  args: {
    ask: <TeamAsk title="Joining Weber Design takes you off Vandelay Industries." text="Your license on Vandelay Industries isn’t refunded, and notes you made visible to it stay visible."
      confirm="Leave Vandelay Industries and join" keep="Stay" onConfirm={did('onLeave')} onKeep={did('onStay')} />
  }
};
/** The admin of a team others are on: no Join until they're the only one left, said in its place. */
export const CantJoinYet: Story = {
  name: 'Can’t join yet',
  args: {
    note: 'You admin Vandelay Industries, and 5 others are on it. You can join Weber Design once you’re the only one left.',
    actions: <Button variant="quiet" size="sm" onClick={did('onNotNow')}>Not now</Button>
  }
};
