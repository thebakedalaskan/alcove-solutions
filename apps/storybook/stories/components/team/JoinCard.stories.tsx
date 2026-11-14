/*
 * JoinCard: an invitation to a team, or anything about joining one, as one card. On a page of its own it stands on the
 * team's evening (JoinEvening, with Alcove's mark at its top left): the invite page, and stopping invitation emails. On the
 * Team page it's a section's card among the page's own (`level` 2). The team's people in their arches, who asked, who's on
 * it, Not now and Join; before joining while you're on another team, what that asks takes Join's place (`ask`), and an
 * admin with others on their team can't join yet (`note`, in Join's place). What went wrong is said in caution (`problem`).
 * On the Team page its title is in the face you read; on a page of its own, in the display face.
 */
import { Button, JoinCard, JoinEvening, ProviderButton, TeamAsk, buttonClass } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { JONAS } from '../../../src/world/people';
import { AIKO, KOFI, MAYA, PRIYA, TeamEvening } from './parts';

const WHAT = 'Alcove is for calls: each one gets its notes and a workspace of its own.';
const JOIN = (label = 'Join Vandelay Industries') => <><Button variant="quiet" onClick={did('onNotNow')}>Not now</Button><Button variant="primary" onClick={did('onJoin')}>{label}</Button></>;
const OPEN = <a href="#open" className={buttonClass()} onClick={(e) => { e.preventDefault(); did('onOpen')(); }}>Open Alcove</a>;

const meta = {
  title: 'Components/Team/JoinCard',
  component: JoinCard,
  /* On a page of its own, on the team's evening; on the Team page (`parameters.inline`), among the page's own. */
  decorators: [(Story, c) => (c.parameters['inline'] === true ? <Story /> : <JoinEvening><Story /></JoinEvening>)],
  parameters: { layout: 'fullscreen' },
  args: {
    faces: [PRIYA, KOFI, AIKO, MAYA], title: 'Priya invited you to join Vandelay Industries', line: 'Kofi, Aiko and 2 others are on it.', actions: JOIN()
  },
  argTypes: {
    title: { control: 'text' }, line: { control: 'text' }, note: { control: 'text' }, problem: { control: 'text' }, foot: { control: 'text' }, done: { control: 'boolean' },
    level: { control: 'inline-radio', options: [1, 2] }, faces: { control: false }, facts: { control: false }, actions: { control: false }, ask: { control: false }, className: { control: false }
  }
} satisfies Meta<typeof JoinCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** An invitation's own link, signed in: the team's faces, who's on it, Not now and Join. */
export const Invited: Story = {};
export const InvitedNight: Story = { ...Invited, globals: { theme: 'dark' } };
export const InvitedPhone: Story = { ...Invited, globals: { viewport: { value: 'phone' } } };
/** Signed out: the same card, with what Alcove is for and the ways in. */
export const SignedOut: Story = {
  name: 'Signed out',
  args: {
    line: `Kofi, Aiko and 2 others are on it. ${WHAT}`,
    actions: <ProviderButton provider="google" onClick={did('onGoogle')}>Continue with Google</ProviderButton>,
    foot: <a href="#welcome" className={buttonClass({ variant: 'quiet', size: 'sm' })} onClick={(e) => { e.preventDefault(); did('onWelcome')(); }}>See what Alcove does</a>
  }
};
/** A team's link: anyone on it may have shared it, so it names the team. */
export const ATeamsLink: Story = { name: 'A team’s link', args: { title: 'Join Vandelay Industries on Alcove', line: 'Priya, Kofi and 2 others are on it.' } };
/** The link of someone on no team yet: joining starts one, with them as its admin. */
export const SomeonesLink: Story = { name: 'Someone’s link', args: { faces: [JONAS], title: 'Jonas asked you to join them on Alcove', line: undefined, actions: JOIN('Join Jonas') } };
/** On another team: joining asks in place first, the answer that loses nothing filled. */
export const LeaveFirst: Story = {
  name: 'Leave first',
  args: {
    ask: <TeamAsk title="Joining Vandelay Industries takes you off Weber Design." text="Notes you made visible to Weber Design stay visible to it."
      confirm="Leave Weber Design and join" keep="Stay" onConfirm={did('onLeave')} onKeep={did('onStay')} />
  }
};
/** Alone on your own team, its admin: joining deletes it. */
export const DeleteFirst: Story = {
  name: 'Delete first',
  args: {
    ask: <TeamAsk title="Joining Vandelay Industries deletes Weber Design, which only you are on, and its invitations." text="Its workspaces stop being the team’s."
      confirm="Delete Weber Design and join" keep="Stay" onConfirm={did('onDelete')} onKeep={did('onKeep')} />
  }
};
/** Two teams of one name: the one you'd join is named by who invited you, and yours is "yours". */
export const DeleteYoursFirst: Story = {
  name: 'Delete yours first',
  args: {
    ask: <TeamAsk title="Joining Priya’s Vandelay Industries deletes yours, which only you are on, and its invitations." text="Its workspaces stop being the team’s."
      confirm="Delete yours and join" keep="Stay" onConfirm={did('onDelete')} onKeep={did('onKeep')} />
  }
};
/** The admin of a team others are on: not until they're the only one left, said in Join's place. */
export const CantJoinYet: Story = {
  name: 'Can’t join yet',
  args: {
    note: 'You admin Weber Design, and 3 others are on it. You can join Vandelay Industries once you’re the only one left.',
    actions: <Button variant="secondary" onClick={did('onNotNow')}>Not now</Button>
  }
};
/** Your team's own link, opened signed in: Copy link, and the way to Team. */
export const YourTeamsLink: Story = {
  name: 'Your team’s link',
  args: {
    title: 'This is your team’s invite link', line: 'Send it to someone you’d like on Vandelay Industries.',
    actions: <><a href="#team" className={buttonClass({ variant: 'quiet' })} onClick={(e) => e.preventDefault()}>Go to Team</a><Button variant="primary" icon="link" onClick={did('onCopy')}>Copy link</Button></>
  }
};
/** An invitation to the team you're on already: nothing to join, and the way to it. */
export const OnItAlready: Story = {
  name: 'On it already',
  args: { title: 'You’re on Vandelay Industries already', actions: <a href="#team" className={buttonClass({ variant: 'primary' })} onClick={(e) => e.preventDefault()}>Go to Team</a> }
};
/** Used, cancelled, run out, or replaced. */
export const Ended: Story = { args: { faces: [], title: 'This invitation has ended', line: 'Ask Priya to invite you again.', actions: OPEN } };
/** Stopping invitation emails, from an email's foot: one button, then what it did, with its tick. */
export const StopEmails: Story = {
  name: 'Stop invitation emails',
  args: {
    faces: [], title: 'Stop invitation emails?', line: 'Alcove won’t email this address invitations to join a team any more. Any you’re sent still show in Alcove.',
    actions: <Button variant="primary" onClick={did('onStop')}>Stop invitation emails</Button>
  }
};
export const EmailsStopped: Story = { name: 'Emails stopped', args: { faces: [], done: true, title: 'Alcove won’t email you invitations again.', line: 'Any you’re sent still show in Alcove, on Team.', actions: OPEN } };
/** Something went wrong: said in caution, with its mark, as it happens, over Try again. */
export const StopEmailsFailed: Story = {
  name: 'Stop invitation emails, failed',
  args: {
    ...StopEmails.args,
    problem: 'You’re offline. Check this device’s connection, then try again.',
    actions: <Button variant="primary" icon="retry" onClick={did('onRetry')}>Try again</Button>
  }
};
export const StopEmailsFailedNight: Story = { ...StopEmailsFailed, name: 'Stop invitation emails, failed, night', globals: { theme: 'dark' } };
/** On the Team page: a card among the page's own, on its evening. */
export const OnTheTeamPage: Story = {
  name: 'On the Team page',
  args: { level: 2 },
  parameters: { inline: true },
  decorators: [(Story) => <TeamEvening sky={420}><div className="ti-cards" style={{ paddingInline: 16 }}><Story /></div></TeamEvening>]
};
