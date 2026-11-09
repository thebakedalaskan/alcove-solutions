/*
 * Equal choices in a row inside a menu over the call (components/call.tsx): on your own tile's ⋯, the time a status is for
 * (none chosen until one is) and where you see yourself. Always night: the menus open over the stage.
 */
import { CallMenuChips } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { PopSurface, did, onStage } from '../../../src/component';

const meta = {
  title: 'Components/In a call/CallMenuChips', component: CallMenuChips, ...onStage,
  args: { label: 'Back in', options: [{ value: '2', label: '2 min' }, { value: '5', label: '5 min' }, { value: '10', label: '10 min' }], chosen: null, onPick: did('pick') },
  render: (args) => <PopSurface width={288}><CallMenuChips {...args} /></PopSurface>
} satisfies Meta<typeof CallMenuChips<string>>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Back in, before a time is chosen. */
export const NoneChosen: Story = {};
/** Back in 5 minutes. */
export const OneChosen: Story = { args: { chosen: '5' } };

function SeeYourself() {
  const [where, setWhere] = useState<'grid' | 'corner' | 'hidden'>('corner');
  return (
    <PopSurface width={288}>
      <CallMenuChips label="See yourself" options={[{ value: 'grid', label: 'Grid' }, { value: 'corner', label: 'Corner' }, { value: 'hidden', label: 'Hidden' }]} chosen={where} onPick={setWhere} />
    </PopSurface>
  );
}
/** Where you see yourself: one is always chosen, and pressing another chooses it. */
export const SeeYourselfChoice: Story = { name: 'See yourself', render: () => <SeeYourself /> };
