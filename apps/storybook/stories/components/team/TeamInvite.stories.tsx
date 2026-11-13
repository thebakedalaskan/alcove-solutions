/*
 * TeamInvite: inviting someone to the team with a one-time link that works for a day. Make an invite link, then the link with
 * Copy, until when it works, and Make another. On the Team page it's a card beside the people (`card`); in checkout's Done,
 * once a team is bought, it's part of the step, in its own words. The app's useInvite() gives exactly what it takes:
 * `<TeamInvite {...useInvite()} />`.
 */
import { TeamInvite } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';
import { onTheWater } from './parts';

const MADE = { link: 'https://alcove.solutions/team/join#VandelayInviteStorybook0001', until: 'tomorrow 16:12' };

const meta = {
  title: 'Components/Team/TeamInvite',
  component: TeamInvite,
  decorators: [onTheWater(true)],
  parameters: { layout: 'fullscreen' },
  args: { made: null, making: false, copied: false, card: true, onMake: did('onMake'), onCopy: did('onCopy') },
  argTypes: {
    making: { control: 'boolean' }, copied: { control: 'boolean' }, card: { control: 'boolean' }, title: { control: 'text' }, hint: { control: 'text' },
    made: { control: false }, onMake: { control: false }, onCopy: { control: false }, className: { control: false }
  },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <TeamInvite {...args} onMake={() => { update({ made: MADE, copied: false }); args.onMake(); }} onCopy={() => { update({ copied: true }); args.onCopy(); }} />;
  }
} satisfies Meta<typeof TeamInvite>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Before a link is made. */
export const BeforeALink: Story = { name: 'Before a link' };
/** A link is being made. */
export const Making: Story = { args: { making: true } };
/** The link, with Copy, until when it works, and Make another. */
export const Made: Story = { args: { made: MADE } };
/** Just copied. */
export const Copied: Story = { args: { made: MADE, copied: true } };
/** In checkout's Done, once a team is bought: part of the step, in its own words. */
export const InCheckout: Story = {
  name: 'In checkout’s Done',
  args: { card: false, title: 'Invite your team', hint: 'Each link lets one person join, for a day. A license is taken when they next open Alcove.' },
  decorators: [(Story) => <div style={{ maxWidth: 520 }}><Story /></div>]
};
