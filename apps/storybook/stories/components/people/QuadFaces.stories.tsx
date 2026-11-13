/*
 * QuadFaces: a few people in one small square of arches, for a group or a list: small in its token in the Who field, on
 * the scheduler. Up to four show; with fewer, the square's other places stay empty. (The people under the field show a
 * group as two of its faces.)
 */
import { PersonToken, QuadFaces, SchedField, SchedGroup, SchedRow } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { AIKO, INES, KOFI, MAYA, PRIYA } from '../../../src/world/people';

/** The Product group, as the busy afternoon has it. */
const PRODUCT = [PRIYA, KOFI, AIKO, MAYA];

const meta = {
  title: 'Components/People/QuadFaces',
  component: QuadFaces,
  parameters: { layout: 'centered' },
  args: { people: PRODUCT, size: 18 },
  argTypes: { people: { control: false }, size: { control: { type: 'number', min: 8, max: 48, step: 1 } } }
} satisfies Meta<typeof QuadFaces>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Four: Product. */
export const Four: Story = {};
/** Three: Leads. Someone without a portrait shows their initial. */
export const Three: Story = { args: { people: [PRIYA, KOFI, INES] } };
export const Two: Story = { args: { people: [PRIYA, KOFI] } };
export const One: Story = { args: { people: [MAYA] } };
/** In the Who field, on the scheduler: a group's token, with how many are in it. */
export const InAToken: Story = {
  name: 'In a token',
  parameters: { layout: 'padded' },
  render: (args) => (
    <div className="sc-body" style={{ width: 'min(356px, 100%)' }}>
      <SchedGroup label="Who">
        <SchedRow icon="people">
          <SchedField>
            <PersonToken people={args.people} label="Product" count={args.people.length} removeLabel="Remove Product" onRemove={did('onRemove')} />
            <PersonToken people={[PRIYA, KOFI, INES]} label="Leads" count={3} removeLabel="Remove Leads" onRemove={did('onRemove')} />
            <input type="text" aria-label="Add people" placeholder="Add someone" autoComplete="off" spellCheck={false} />
          </SchedField>
        </SchedRow>
      </SchedGroup>
    </div>
  )
};
