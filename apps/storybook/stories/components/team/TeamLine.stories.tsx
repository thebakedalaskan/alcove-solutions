/*
 * TeamLine: the team on the horizon. Everyone stands in their arch with their feet on the horizon, their name under it on
 * the water and, on Team, their license under that: "Until 12 Dec", "Waiting" in caution, "Ended" quiet. On a free team
 * only someone new has a line ("Joined today", "Started today" for its admin). Past ten, an empty arch at the end says how
 * many more. After the team, whoever's invited stands in a dashed arch, "Invited" under it, and on a company's team the
 * colleagues not on it stand further back, smaller and in the haze until you reach for them. `arch` makes each arch something
 * to press (the app opens their popover from it).
 */
import { Popover, TeamLine, type TeamLinePerson } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { did } from '../../../src/component';
import { DIEGO, INES, SAM } from '../../../src/world/people';
import { AIKO, LINE, MAYA, onTheHorizon } from './parts';

/** Art's free team the day Art invited Diego and Sam: Art, Priya and Kofi, then Diego and Sam invited, then Maya, Ines and Aiko further back. */
const FIRST_INVITES: TeamLinePerson[] = [
  ...LINE.slice(0, 3).map((p) => ({ ...p, license: p.key === 'art' ? 'Started today' : undefined, tone: 'none' as const })),
  { key: 'diego', person: DIEGO, name: 'Diego', license: 'Invited', tone: 'none', ghost: true, label: 'Diego Ruiz, invited' },
  { key: 'sam', person: SAM, name: 'Sam', license: 'Invited', tone: 'none', ghost: true, label: 'Sam Ortiz, invited' },
  ...[MAYA, INES, AIKO].map((person): TeamLinePerson => ({ key: person.email, person, name: person.name.split(' ')[0] ?? person.name, tone: 'none', back: true, label: `${person.name}, not on Vandelay Industries` }))
];

const meta = {
  title: 'Components/Team/TeamLine',
  component: TeamLine,
  decorators: [onTheHorizon],
  parameters: { layout: 'fullscreen' },
  args: { people: LINE, label: 'People on Vandelay Industries', more: 0 },
  argTypes: { more: { control: { type: 'number', min: 0 } }, label: { control: 'text' }, people: { control: false }, arch: { control: false }, className: { control: false } }
} satisfies Meta<typeof TeamLine>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Vandelay's team: four licensed, Maya's ended, Aiko waiting for one. */
export const TheTeam: Story = { name: 'The team' };
/** A free team: nobody's license is said, and Kofi, who joined today, says so. */
export const OnFree: Story = {
  name: 'On Free',
  args: { people: LINE.slice(0, 3).map((p) => ({ ...p, license: p.key === 'kofi' ? 'Joined today' : undefined, tone: 'none' as const })) }
};
/** A team of one: its admin, before anyone else has joined. */
export const JustYou: Story = { name: 'Just you', args: { people: LINE.slice(0, 1) } };
/** More than stand on the line: an empty arch at its end says how many more. */
export const More: Story = { name: 'More than fit', args: { more: 12 } };
/** Invited, then further back: the horizon a company's page had stays peopled once it's the team's. */
export const InvitedAndFurtherBack: Story = {
  name: 'Invited, and further back',
  args: { people: FIRST_INVITES, label: 'People on Vandelay Industries' },
  /* Five at full size and three further back: the line is about seven and a half places wide, as the page works it out. */
  parameters: { places: 7.63 }
};
export const InvitedAndFurtherBackNight: Story = { ...InvitedAndFurtherBack, name: 'Invited, and further back, night', globals: { theme: 'dark' } };

/** Something to press: each arch opens what's about them. */
function Pressable(args: Parameters<typeof TeamLine>[0]) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <TeamLine {...args} arch={(p, button) => (
      <Popover open={open === p.key} onOpenChange={(on) => { setOpen(on ? p.key : null); if (on) did('onOpen')(p.key); }} side="bottom" align="center" caret label={p.label ?? p.person.name} anchor={button}>
        <p style={{ padding: 16, margin: 0 }}>{p.label ?? p.person.name}</p>
      </Popover>
    )} />
  );
}
export const ToPress: Story = { name: 'To press', render: (args) => <Pressable {...args} /> };
