/*
 * PersonToken: someone, a group or a pasted list in Who, on the scheduler: one token, however many people it stands for.
 * A person shows their arch; a group or a list a small square of arches and how many (`count`). Someone from outside,
 * whose calendar can't be read, goes by their whole name beside where they are, once that's been said (`state`,
 * `outside`). In an empty field the first Backspace holds the last token (`held`), and the second takes it out; so does
 * its ×. Without `onRemove` it's only read: who's on a call being moved, and what they've said.
 */
import { PersonToken, cn } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { did } from '../../../src/component';
import { AIKO, INES, JONAS, KOFI, MANY, MAYA, PRIYA } from '../../../src/world/people';

/** Who, on the scheduler: the field people are added in, or (`fixed`) who's on a call being moved. */
function Who({ fixed = false, children }: { fixed?: boolean | undefined; children: ReactNode }) {
  return (
    <section className="sc-sec" style={{ width: 'min(372px, 100%)' }}>
      <h3>Who</h3>
      <div className={cn('cf-field sc-field', fixed && 'is-fixed')}>
        {children}
        {!fixed && <input type="text" aria-label="Add people" placeholder="Add someone else" autoComplete="off" spellCheck={false} />}
      </div>
    </section>
  );
}

const meta = {
  title: 'Components/People/PersonToken',
  component: PersonToken,
  args: { people: [PRIYA], label: 'Priya', title: PRIYA.email, held: false, outside: false, onRemove: did('onRemove'), removeLabel: `Remove ${PRIYA.name}` },
  argTypes: {
    label: { control: 'text' }, count: { control: { type: 'number', min: 0, step: 1 } }, title: { control: 'text' }, state: { control: 'text' },
    outside: { control: 'boolean' }, held: { control: 'boolean' }, removeLabel: { control: 'text' }, people: { control: false }, onRemove: { control: false }
  },
  render: (args) => <Who><PersonToken {...args} /></Who>
} satisfies Meta<typeof PersonToken>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Someone: their arch and first name, their address on hover. */
export const Person: Story = {};
/** A group: its people in a small square, and how many. */
export const Group: Story = { args: { people: [PRIYA, KOFI, AIKO, MAYA], label: 'Product', count: 4, title: undefined, removeLabel: 'Remove Product' } };
/** A pasted list stays one token, however long. */
export const PastedList: Story = { name: 'A pasted list', args: { people: MANY.slice(0, 12).map((c) => c.person), label: 'Pasted list', count: 12, title: undefined, removeLabel: 'Remove Pasted list' } };
/** Held by the first Backspace: one more takes it out. */
export const Held: Story = { args: { held: true } };
/** Someone from outside the company, once you've said where they are: their whole name, and how far their clock is from yours. */
export const FromOutside: Story = {
  name: 'From outside',
  args: { people: [JONAS], label: JONAS.name, title: JONAS.email, state: 'Berlin, 1 h ahead', outside: true, removeLabel: `Remove ${JONAS.name}` }
};
/** Several in the field, the last one held. */
export const Several: Story = {
  render: () => (
    <Who>
      <PersonToken people={[PRIYA]} label="Priya" title={PRIYA.email} removeLabel={`Remove ${PRIYA.name}`} onRemove={did('onRemove')} />
      <PersonToken people={[PRIYA, KOFI, AIKO, MAYA]} label="Product" count={4} removeLabel="Remove Product" onRemove={did('onRemove')} />
      <PersonToken people={MANY.slice(0, 12).map((c) => c.person)} label="Pasted list" count={12} held removeLabel="Remove Pasted list" onRemove={did('onRemove')} />
    </Who>
  )
};
/** Who's on a call being moved: read only, each with what they've said. Nothing here changes. */
export const OnACallBeingMoved: Story = {
  name: 'On a call being moved',
  render: () => (
    <Who fixed>
      <PersonToken people={[INES]} label="Ines" title={INES.email} state="Going" />
      <PersonToken people={[AIKO]} label="Aiko" title={AIKO.email} state="No answer yet" />
    </Who>
  )
};
