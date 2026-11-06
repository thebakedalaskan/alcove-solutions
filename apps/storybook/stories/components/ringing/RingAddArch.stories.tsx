/*
 * RingAddArch: the dashed arch at the end of the lobby's row of people to ring, on the night stage. It finds anyone else
 * to ring: in the lobby it opens a people picker, and the people added join the row, picked.
 */
import { RingAddArch, RingArch } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did, onStage } from '../../../src/component';
import { KOFI, MAYA, PRIYA } from '../../../src/world/people';

const meta = {
  title: 'Components/Ringing and waiting/RingAddArch',
  component: RingAddArch,
  ...onStage,
  args: { 'aria-label': 'Add someone else to ring', onClick: did('onClick') },
  argTypes: { className: { control: false } }
} satisfies Meta<typeof RingAddArch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Add: Story = {};
/** At the end of the row, after the people the lobby shows. */
export const AfterThePeople: Story = {
  name: 'After the people',
  render: (args) => (
    <div className="rg-arches">
      <RingArch person={PRIYA} name="Priya" picked onToggle={did('onToggle')} />
      <RingArch person={KOFI} name="Kofi" picked={false} onToggle={did('onToggle')} />
      <RingArch person={MAYA} name="Maya" picked={false} onToggle={did('onToggle')} />
      <RingAddArch {...args} />
    </div>
  )
};
