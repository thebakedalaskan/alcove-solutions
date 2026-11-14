/*
 * JoinFirst: Invite people, on a company page with no team, while an invitation to you waits. Inviting would start another
 * team, so it says to join that one first, in the arch of whoever invited you, with its Join at the foot.
 */
import { Button, JoinFirst } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { PRIYA } from './parts';

const meta = {
  title: 'Components/Team/JoinFirst',
  component: JoinFirst,
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div className="ac-pop tp-pop is-list sbc-pop"><Story /></div>],
  args: {
    person: PRIYA, title: 'Priya invited you to Vandelay Industries.', line: 'Join it, then invite people from its page.',
    action: <Button variant="primary" size="sm" onClick={did('onJoin')}>Join Vandelay Industries</Button>
  },
  argTypes: { title: { control: 'text' }, line: { control: 'text' }, person: { control: false }, action: { control: false }, className: { control: false } }
} satisfies Meta<typeof JoinFirst>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Priya's invitation waits: join it first, then invite people from its page. */
export const PriyasInvitation: Story = { name: 'Priya’s invitation' };
export const PriyasInvitationNight: Story = { ...PriyasInvitation, name: 'Priya’s invitation, night', globals: { theme: 'dark' } };
