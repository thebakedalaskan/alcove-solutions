/*
 * QuadFaces: a few people in one small square of arches, for a group or a list: beside a group's name in the people under
 * Who, on the scheduler, and small in a group's token in the Who field. Up to four show; with fewer, the square's other
 * places stay empty.
 */
import { Icon, QuadFaces } from '@alcove/ui';
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
/** Under Who, on the scheduler: beside a group's name and how many are in it. */
export const InTheList: Story = {
  name: 'In the list',
  parameters: { layout: 'padded' },
  args: { size: 14 },
  render: (args) => (
    <section className="sc-sec" style={{ width: 'min(372px, 100%)' }}>
      <h3>Who</h3>
      <div className="cf-field sc-field is-focus">
        <input type="text" aria-label="Add people" placeholder="Add people, a group or an email" autoComplete="off" spellCheck={false} />
      </div>
      <p className="sc-lab">Often with you</p>
      <div role="listbox" aria-label="People to add" className="sc-pps">
        <button type="button" role="option" aria-selected={false} className="sc-pp" onClick={did('onAdd')}>
          <span className="sc-pp-f"><QuadFaces {...args} /></span>
          <span className="min-w-0"><b className="ac-clamp-1">Product</b><small className="ac-clamp-1">Group · {args.people.length} {args.people.length === 1 ? 'person' : 'people'}</small></span>
          <Icon name="plus" size={16} />
        </button>
        <button type="button" role="option" aria-selected={false} className="sc-pp" onClick={did('onAdd')}>
          <span className="sc-pp-f"><QuadFaces people={[PRIYA, KOFI, INES]} size={args.size} /></span>
          <span className="min-w-0"><b className="ac-clamp-1">Leads</b><small className="ac-clamp-1">Group · 3 people</small></span>
          <Icon name="plus" size={16} />
        </button>
      </div>
    </section>
  )
};
