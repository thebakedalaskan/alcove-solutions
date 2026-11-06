/*
 * Fold: a part of a page that opens and closes in place, closed until someone opens it. The whole heading row is what
 * you press, and what it holds opens under it. It's the browser's own details element, so the keyboard and screen
 * readers work as they expect. `open` starts it open; after that it stays as the reader left it. Folds one after
 * another sit close together, like a call's breakout rooms on its note.
 */
import { Faces, Fold, type AvatarPerson } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ART, KOFI, MAYA, PRIYA } from '../../../src/world/people';

/** A breakout room's heading: who was in it, what it was for, and how long it ran. */
function Room({ people, name, minutes }: { people: AvatarPerson[]; name: string; minutes: number }) {
  return (
    <>
      <Faces people={people} size={24} max={3} />
      <b style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{name}</b>
      <small style={{ fontSize: 13, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{minutes} min</small>
    </>
  );
}
const Said = ({ children }: { children: string }) => <p className="ac-summary">{children}</p>;

const meta = {
  title: 'Components/Layout/Fold',
  component: Fold,
  args: {
    summary: <Room people={[PRIYA, MAYA]} name="Support handover" minutes={4} />,
    children: <Said>Support is happy as long as the help article comes first. Priya writes it by Friday.</Said>,
    open: false
  },
  argTypes: { summary: { control: false }, children: { control: false }, open: { control: 'boolean' }, className: { control: false }, id: { control: false } },
  render: (args) => <div style={{ width: 'min(560px, 100%)' }}><Fold {...args} /></div>
} satisfies Meta<typeof Fold>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Closed until someone opens it: only the heading row shows, with the chevron pointing down. */
export const Closed: Story = {};
/** Open: what it holds shows under the heading, and the chevron turns over. */
export const Open: Story = { args: { open: true } };
/** Folds one after another sit close together: the standup's two breakout rooms. */
export const Stacked: Story = {
  args: { open: true },
  render: (args) => (
    <div style={{ width: 'min(560px, 100%)' }}>
      <Fold {...args} />
      <Fold summary={<Room people={[KOFI, ART]} name="Rollout" minutes={4} />}>
        <Said>The rollout starts with one per cent and goes from there. Kofi adds the flag to the rollout plan.</Said>
      </Fold>
    </div>
  )
};
