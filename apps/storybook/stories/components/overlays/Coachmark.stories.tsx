/*
 * Coachmark: points at one part of the interface, in two lines at most: a title, then a line. It's inverted, like a
 * tooltip, and its caret points up from below. Give the target the `ac-spot` class, and a sun ring marks it.
 */
import { Coachmark, NavItemContent, Segmented, SidebarNav } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

const stay = (e: { preventDefault: () => void }) => e.preventDefault();

/** Settings' choice of notes for new calls, standing in as a target. */
function NotesForNewCalls() {
  const [notes, setNotes] = useState<'on' | 'off'>('on');
  return <Segmented label="Notes for new calls" value={notes} onChange={setNotes} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} className="ac-spot" />;
}

const meta = {
  title: 'Components/Overlays/Coachmark',
  component: Coachmark,
  parameters: { layout: 'centered' },
  args: { title: 'Record in the room', children: 'Meeting in person? Record on your phone, even offline.' },
  argTypes: { title: { control: 'text' }, children: { control: 'text' }, className: { control: false } },
  render: (args) => (
    <div className="grid w-[240px] gap-[18px]">
      <SidebarNav>
        <a href="#home" className="ac-nav-item" aria-current="page" onClick={stay}><NavItemContent icon="home" label="Home" /></a>
        <a href="#calls" className="ac-nav-item" onClick={stay}><NavItemContent icon="calls" label="Calls" /></a>
        <a href="#record" className="ac-nav-item ac-spot" onClick={stay}><NavItemContent icon="room" label="Record" /></a>
      </SidebarNav>
      <Coachmark {...args} />
    </div>
  )
} satisfies Meta<typeof Coachmark>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Under a side item, its caret pointing up at it. */
export const UnderASideItem: Story = { name: 'Under a side item' };
/** Under a setting: whether new calls have notes. */
export const UnderASetting: Story = {
  name: 'Under a setting',
  args: { title: 'Notes for new calls', children: 'You can still choose for each call when you schedule it.' },
  render: (args) => (
    <div className="grid justify-items-start gap-[18px]">
      <NotesForNewCalls />
      <Coachmark {...args} />
    </div>
  )
};
