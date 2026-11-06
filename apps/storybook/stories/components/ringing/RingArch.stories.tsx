/*
 * RingArch: one person to ring, in the organizer's lobby before they join the call, on the night stage. Pressing picks
 * them (the sun's ring and a tick) or takes them off. Someone busy in another call is dimmed, and can still be picked.
 * The lobby shows a few, free people first, then the Add arch for anyone else, and says who hears a ring.
 */
import { firstName, type Person } from '@alcove/api';
import { RingAddArch, RingArch } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { useArgs } from 'storybook/preview-api';
import { did, onStage } from '../../../src/component';
import { AIKO, KOFI, MAYA, PRIYA } from '../../../src/world/people';

const meta = {
  title: 'Components/Ringing and waiting/RingArch',
  component: RingArch,
  ...onStage,
  args: { person: PRIYA, name: 'Priya', picked: false, busy: false, onToggle: did('onToggle') },
  argTypes: { person: { control: false }, name: { control: 'text' } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <RingArch {...args} onToggle={() => { args.onToggle(); update({ picked: !args.picked }); }} />;
  }
} satisfies Meta<typeof RingArch>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Press to pick them; press again to take them off. */
export const NotPicked: Story = { name: 'Not picked' };
export const Picked: Story = { args: { picked: true } };
/** In another call right now: dimmed, and still there to pick. */
export const Busy: Story = { args: { busy: true } };
/** Busy, and picked anyway: picking brings them back to full strength. */
export const BusyAndPicked: Story = { name: 'Busy and picked', args: { busy: true, picked: true } };

/** Who hears a ring, in a sentence under the row. */
function ringLine(picked: readonly Person[]): string {
  const names = picked.map((p) => firstName(p.name));
  if (!names.length) return 'Pick who to ring, or join and share the link.';
  const list = names.length === 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
  return `${list} ${names.length === 1 ? 'hears' : 'hear'} a ring when you join.`;
}
const LOBBY: readonly Person[] = [PRIYA, KOFI, MAYA, AIKO];
const toggled = did('onToggle');

/** The lobby's row: Priya picked already, Aiko busy, then Add. Pick and unpick, and the line under it follows. */
export const InTheLobby: Story = {
  name: 'In the lobby',
  render: function Render() {
    const [picked, setPicked] = useState<readonly Person[]>([PRIYA]);
    const toggle = (p: Person) => setPicked((now) => (now.includes(p) ? now.filter((x) => x !== p) : [...now, p]));
    return (
      <div style={{ width: 'min(400px, 100%)' }}>
        <div className="rg-k">Ring</div>
        <div className="rg-arches">
          {LOBBY.map((p) => <RingArch key={p.email} person={p} name={firstName(p.name)} picked={picked.includes(p)} busy={p === AIKO} onToggle={() => { toggled(p.name); toggle(p); }} />)}
          <RingAddArch aria-label="Add someone else to ring" onClick={did('add')} />
        </div>
        <p className="rg-line" aria-live="polite">{ringLine(picked)}</p>
      </div>
    );
  }
};
