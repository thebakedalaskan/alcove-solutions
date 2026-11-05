/*
 * PointerTag: whose a pointer or a mark on a shared screen is, on the call stage. Their face in the arch and their first
 * name ("You" for your own), on a ring of white so it reads on any picture, and never told apart by colour alone. A name
 * too long for the tag is cut short (type one into Controls).
 */
import { PointerTag } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row, onStage } from '../../../src/component';
import { ART, INES, KOFI, PRIYA } from '../../../src/world/people';

const meta = {
  title: 'Components/In a call/PointerTag',
  component: PointerTag,
  ...onStage,
  args: { person: PRIYA, name: 'Priya' },
  argTypes: { person: { control: false }, name: { control: 'text' }, style: { control: false }, className: { control: false } }
} satisfies Meta<typeof PointerTag>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Someone: Story = {};
/** Your own pointer or mark. */
export const You: Story = { args: { person: ART, name: 'You' } };
/** Someone without a portrait: their initial in the arch. */
export const WithoutAPortrait: Story = { name: 'Without a portrait', args: { person: INES, name: 'Ines' } };
/** Several people pointing at once. */
export const Several: Story = {
  render: () => (
    <Row>
      <PointerTag person={PRIYA} name="Priya" />
      <PointerTag person={KOFI} name="Kofi" />
      <PointerTag person={INES} name="Ines" />
      <PointerTag person={ART} name="You" />
    </Row>
  )
};
