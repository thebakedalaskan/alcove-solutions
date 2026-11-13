/*
 * JoinCard: joining a team by its link, as one card on the team's evening (JoinEvening, with Alcove's mark at its top left).
 * The team's people in their arches (whoever is known), a tick once you've joined, what it asks or says in the display face,
 * a line, what joining gives you in a well, what to do, and a quiet foot.
 */
import { Button, JoinCard, JoinEvening, buttonClass, type JoinFact } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { AIKO, KOFI, LENA, MAYA, PRIYA } from './parts';

const FACTS: JoinFact[] = [
  { icon: 'notes', text: 'About 50 hours of notes a month, your own' },
  { icon: 'people', text: 'The notes and workspaces the team shares' },
  { icon: 'upload', text: 'Storage shared by everyone on it' }
];
const OPEN = <a href="#open" className={buttonClass({ variant: 'primary' })} onClick={(e) => { e.preventDefault(); did('onOpen')(); }}>Open Alcove</a>;

const meta = {
  title: 'Components/Team/JoinCard',
  component: JoinCard,
  decorators: [(Story) => <JoinEvening><Story /></JoinEvening>],
  parameters: { layout: 'fullscreen' },
  args: {
    faces: [PRIYA], title: 'Join Vandelay Industries?', facts: FACTS,
    line: 'Priya invited you to their team on Alcove. Joining takes one of its licenses, so you have:',
    actions: <><Button variant="quiet" onClick={did('onNotNow')}>Not now</Button><Button variant="primary" onClick={did('onJoin')}>Join Vandelay Industries</Button></>,
    foot: 'Nothing happens until you join. You can leave the team later, from Team.'
  },
  argTypes: { title: { control: 'text' }, line: { control: 'text' }, foot: { control: 'text' }, done: { control: 'boolean' }, faces: { control: false }, facts: { control: false }, actions: { control: false }, className: { control: false } }
} satisfies Meta<typeof JoinCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Signed in: whose team, what joining gives you, Not now and Join. */
export const Asks: Story = {};
/** Signed out: sign in first. */
export const SignInFirst: Story = {
  name: 'Sign in first',
  args: {
    faces: [], title: 'Join a team?', line: 'Someone invited you to their team on Alcove. Sign in first, then join.',
    actions: <Button variant="primary" onClick={did('onGoogle')}>Continue with Google</Button>, foot: 'The invite waits in this tab while you sign in.'
  }
};
/** Joined, with one of its licenses: the team's people, and the tick. */
export const Joined: Story = {
  args: {
    faces: [PRIYA, KOFI, LENA, MAYA, AIKO], done: true, title: 'You’re on Vandelay Industries', facts: [],
    line: 'Your license runs to 12 December. The notes and workspaces the team shares are yours to open now.', actions: OPEN, foot: 'Your own notes and calls stay yours.'
  }
};
/** Joined with none of its licenses left. */
export const JoinedWithoutALicense: Story = {
  name: 'Joined, without a license',
  args: {
    ...Joined.args, foot: undefined,
    line: 'None of its licenses was left, so you’re on your own plan for now. Priya has been told, and one is yours the next time you open Alcove after they buy more.'
  }
};
/** Used, or a day has passed. */
export const Used: Story = {
  args: {
    faces: [], title: 'This invite can’t be used', facts: [], foot: undefined,
    line: 'It’s been used, or a day has passed since it was made. Each invite works once. Ask whoever sent it for a new one.',
    actions: <a href="#open" className={buttonClass()} onClick={(e) => { e.preventDefault(); did('onOpen')(); }}>Open Alcove</a>
  }
};
/** On another team already. */
export const OnAnotherTeam: Story = {
  name: 'On another team',
  args: {
    ...Used.args, faces: [PRIYA], title: 'You’re on a team already',
    line: 'You can be on one team at a time. To join Vandelay Industries, leave Harbourline first, from Team, then open this invite again while it lasts.'
  }
};
