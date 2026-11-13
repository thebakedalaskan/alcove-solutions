/*
 * PersonToken: someone, a group or a pasted list in Who, on the scheduler: one token, however many people it stands for.
 * A person shows their arch; a group or a list a small square of arches and how many (`count`). Someone from outside,
 * whose calendar can't be read, says on their token where they are (`place`): Where? until it's been said, which lists the
 * places. In an empty field the first Backspace holds the last token (`held`), and the second takes it out; so does its ×.
 * Without `onRemove` it's only read: who's on a call being moved, and what they've said (`state`).
 */
import { PersonToken, SchedField, SchedGroup, SchedRow } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { did } from '../../../src/component';
import { AIKO, INES, JONAS, KOFI, MANY, MAYA, PRIYA } from '../../../src/world/people';

/** Who, on the scheduler: the field people are added in, or (`fixed`) who's on a call being moved. */
function Who({ fixed = false, children }: { fixed?: boolean | undefined; children: ReactNode }) {
  return (
    <div className="sc-body" style={{ width: 'min(356px, 100%)' }}>
      <SchedGroup label="Who">
        <SchedRow icon="people">
          <SchedField fixed={fixed}>
            {children}
            {!fixed && <input type="text" aria-label="Add people" placeholder="Add someone" autoComplete="off" spellCheck={false} />}
          </SchedField>
        </SchedRow>
      </SchedGroup>
    </div>
  );
}

const meta = {
  title: 'Components/People/PersonToken',
  component: PersonToken,
  args: { people: [PRIYA], label: 'Priya', title: PRIYA.email, held: false, onRemove: did('onRemove'), removeLabel: `Remove ${PRIYA.name}` },
  argTypes: {
    label: { control: 'text' }, count: { control: { type: 'number', min: 0, step: 1 } }, title: { control: 'text' }, state: { control: 'text' },
    held: { control: 'boolean' }, removeLabel: { control: 'text' }, people: { control: false }, place: { control: false }, onRemove: { control: false }
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
/** Someone from outside the company: where they are sits on their token, Where? until it's been said. */
export const FromOutside: Story = {
  name: 'From outside',
  args: {
    people: [JONAS], label: 'Jonas', title: JONAS.email, removeLabel: `Remove ${JONAS.name}`,
    place: <button type="button" className="sc-where is-unsaid" aria-label="Where Jonas is">Where?</button>
  }
};
/** Once you've said where they are: the place, which their times then go by ("12:30 for Jonas"). */
export const FromOutsideSaid: Story = {
  name: 'From outside, where they are said',
  args: {
    people: [JONAS], label: 'Jonas', title: JONAS.email, removeLabel: `Remove ${JONAS.name}`,
    place: <button type="button" className="sc-where" aria-label="Where Jonas is: Berlin">Berlin</button>
  }
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
