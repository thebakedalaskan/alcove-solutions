/*
 * TeamLine: the team on the horizon. Everyone stands in their arch with their feet on the horizon, their name under it on
 * the water and their license under that: "Until 12 Dec", "Waiting" in caution, "Ended" quiet. Past ten, an empty arch
 * at the end says how many more. `arch` makes each arch something to press (the app opens their popover from it).
 */
import { Popover, TeamLine } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { did } from '../../../src/component';
import { LINE, onTheHorizon } from './parts';

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
/** A team of one: its admin, before anyone else has joined. */
export const JustYou: Story = { name: 'Just you', args: { people: LINE.slice(0, 1) } };
/** More than stand on the line: an empty arch at its end says how many more. */
export const More: Story = { name: 'More than fit', args: { more: 12 } };

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
