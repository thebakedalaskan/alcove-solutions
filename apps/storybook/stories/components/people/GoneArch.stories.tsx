/*
 * GoneArch: an arch's dashed outline with nothing in it, for what's left after something is deleted, such as notes
 * that aren't there any more. 72 by 80, drawn from the tokens; a screen can draw it smaller.
 */
import { GoneArch } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/People/GoneArch',
  component: GoneArch,
  parameters: { layout: 'centered' }
} satisfies Meta<typeof GoneArch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** Where a note was, as the notes list's preview says it's gone. */
export const WhereANoteWas: Story = {
  name: 'Where a note was',
  render: () => (
    <div className="nt-pv-gone">
      <GoneArch />
      <b>These notes aren’t here any more</b>
      <p>They were deleted, or taken out of your notes.</p>
    </div>
  )
};
