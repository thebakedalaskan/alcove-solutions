/*
 * TeamPersonRow: someone on the team, as a row on the water. Their arch, their name with Admin beside the admin's, and a line
 * under it: on Team, their license, in caution while they wait for one and quiet once it has ended; on a free team, when they
 * joined. Remove sits in the row's last column for the team's admin, and what it asks (a TeamAsk) opens under the row, in
 * place. Rows stand in a TeamSection's TeamRows,
 * with a TeamFoot under them.
 */
import { Button, TeamAsk, TeamFoot, TeamPersonRow, TeamRows, TeamSection } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { AIKO, ART, KOFI, MAYA, PRIYA, onTheWater } from './parts';

const meta = {
  title: 'Components/Team/TeamPersonRow',
  component: TeamPersonRow,
  decorators: [(Story) => <TeamSection title="People on Vandelay Industries"><TeamRows><Story /></TeamRows></TeamSection>, onTheWater()],
  parameters: { layout: 'fullscreen' },
  args: { person: PRIYA, name: 'Priya Raman', line: 'Licensed until 12 Dec', tone: 'live', removeLabel: 'Remove Priya Raman' },
  argTypes: {
    tone: { control: 'inline-radio', options: ['live', 'waiting', 'ended', 'none'] },
    name: { control: 'text' }, line: { control: 'text' }, admin: { control: 'boolean' },
    person: { control: false }, onRemove: { control: false }, removeLabel: { control: false }, removeRef: { control: false }, children: { control: false }, className: { control: false }
  }
} satisfies Meta<typeof TeamPersonRow>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Remove, for the team's admin. */
const REMOVE = { onRemove: did('onRemove') };

/** Someone licensed, with Remove for the admin. */
export const Licensed: Story = { args: REMOVE };
/** On a free team: nobody hears about licenses, and someone new says so. */
export const JoinedToday: Story = { name: 'Joined today, on Free', args: { ...REMOVE, person: KOFI, name: 'Kofi Asante', line: 'Joined today', tone: 'none', removeLabel: 'Remove Kofi Asante' } };
/** You, the team's admin: Admin beside your name, and nothing to remove. */
export const YouTheAdmin: Story = { name: 'You, the admin', args: { person: ART, name: 'Art Vandelay (you)', admin: true } };
/** Waiting for a license: none was left when they opened Alcove. */
export const Waiting: Story = { args: { ...REMOVE, person: AIKO, name: 'Aiko Tanaka', line: 'Waiting for a license', tone: 'waiting', removeLabel: 'Remove Aiko Tanaka' } };
/** Their license ended: a new one is taken when they next open Alcove. */
const MAYA_ENDED = { person: MAYA, name: 'Maya Chen', line: 'License ended 9 Nov. A new one is taken when they next open Alcove.', tone: 'ended', removeLabel: 'Remove Maya Chen' } as const;
export const Ended: Story = { args: { ...REMOVE, ...MAYA_ENDED } };
/** Never had one. */
export const NoLicenseYet: Story = { name: 'No license yet', args: { ...REMOVE, person: KOFI, name: 'Kofi Asante', line: 'No license yet', tone: 'none', removeLabel: 'Remove Kofi Asante' } };
/** A member's view: nobody's row has Remove. */
export const AsAMember: Story = { name: 'As a member' };
/** Remove, asked in place under the row: Keep Maya is the filled answer. */
export const RemoveAsked: Story = {
  name: 'Remove, asked',
  args: {
    ...MAYA_ENDED,
    children: <TeamAsk title="Remove Maya?" text="They leave the team, and its invite link changes, so share the new one with anyone still to join. Their license isn’t refunded."
      confirm="Remove Maya" keep="Keep Maya" onConfirm={did('onConfirm')} onKeep={did('onKeep')} />
  }
};
/** The foot under the rows: Leave team, for a member, and what it means. */
export const WithItsFoot: Story = {
  name: 'With its foot',
  decorators: [(Story) => (
    <TeamSection title="People on Vandelay Industries" foot={<TeamFoot action={<Button variant="quiet" size="sm" onClick={did('onLeave')}>Leave team</Button>}>Your license isn’t refunded, and you go back to Free.</TeamFoot>}>
      <TeamRows><Story /></TeamRows>
    </TeamSection>
  ), onTheWater()]
};
