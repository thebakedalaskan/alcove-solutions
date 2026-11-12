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
/** Where a note was, as a call that's gone says so. */
export const WhereANoteWas: Story = {
  name: 'Where a note was',
  render: () => (
    <div className="grid justify-items-center gap-2 px-2 pt-8 pb-4 text-center">
      <GoneArch />
      <b className="text-[16px] leading-[1.3] font-semibold text-ink">These notes aren’t here any more</b>
      <p className="max-w-[34ch] text-[13.5px] leading-[1.5] text-ink-3">They were deleted, or taken out of your notes.</p>
    </div>
  )
};
