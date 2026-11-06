/*
 * PersonToken: someone, a group or a pasted list in the call modal's Who field: one token, however many people it
 * stands for. A person shows their arch; a group or a list a small square of arches and how many (`count`). In an empty
 * field the first Backspace holds the last token (`held`), and the second takes it out; so does its ×.
 */
import { FlowBody, FlowView, PersonToken } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { ModalFrame, did } from '../../../src/component';
import { AIKO, KOFI, MANY, MAYA, PRIYA } from '../../../src/world/people';

/** The Who field, in the call modal, holding the tokens. */
function Field({ children }: { children: ReactNode }) {
  return (
    <ModalFrame>
      <FlowView>
        <FlowBody>
          <h2>Who’s it with?</h2>
          <div className="cf-field">
            {children}
            <input type="text" aria-label="Add people" placeholder="Add someone else" autoComplete="off" spellCheck={false} />
          </div>
        </FlowBody>
      </FlowView>
    </ModalFrame>
  );
}

const meta = {
  title: 'Components/People/PersonToken',
  component: PersonToken,
  args: { people: [PRIYA], label: 'Priya', title: PRIYA.email, held: false, onRemove: did('onRemove'), removeLabel: `Remove ${PRIYA.name}` },
  argTypes: {
    label: { control: 'text' }, count: { control: { type: 'number', min: 0, step: 1 } }, title: { control: 'text' }, held: { control: 'boolean' }, removeLabel: { control: 'text' },
    people: { control: false }, onRemove: { control: false }
  },
  render: (args) => <Field><PersonToken {...args} /></Field>
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
/** Several in the field, the last one held. */
export const Several: Story = {
  render: () => (
    <Field>
      <PersonToken people={[PRIYA]} label="Priya" title={PRIYA.email} removeLabel={`Remove ${PRIYA.name}`} onRemove={did('onRemove')} />
      <PersonToken people={[PRIYA, KOFI, AIKO, MAYA]} label="Product" count={4} removeLabel="Remove Product" onRemove={did('onRemove')} />
      <PersonToken people={MANY.slice(0, 12).map((c) => c.person)} label="Pasted list" count={12} held removeLabel="Remove Pasted list" onRemove={did('onRemove')} />
    </Field>
  )
};
