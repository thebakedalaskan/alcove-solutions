/*
 * FlowRow: a line of a call in the call modal: an icon, what it says, and what's at its end (`end`, such as who's
 * invited). As a button it opens: with `expanded` for what opens in place under it, or a chevron for what steps to
 * another view. `on` lights its icon. Without `onClick` it's only read; `disabled` holds it while something saves.
 */
import type { NotesChoices, NotesSetting } from '@alcove/api';
import { Faces, FlowBody, FlowRow, FlowView, ICON_NAMES, NotesSwitches } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { useArgs } from 'storybook/preview-api';
import { ModalFrame, did } from '../../../src/component';
import { AIKO, KOFI, PRIYA } from '../../../src/world/people';

const press = did('onClick');

/** The rows of a view of the call modal, between hairlines. */
const rows: Decorator = (Story) => (
  <ModalFrame>
    <FlowView>
      <FlowBody>
        <div className="cf-rows"><Story /></div>
      </FlowBody>
    </FlowView>
  </ModalFrame>
);

/** The Notes row and what it opens in place: whether the call writes notes, and what they keep. Its words follow the switches. */
function NotesRow({ row, onPress }: { row: ComponentProps<typeof FlowRow>; onPress: () => void }) {
  const [notes, setNotes] = useState<NotesSetting>('on');
  const [choices, setChoices] = useState<NotesChoices>({ keepTranscript: true, keepRecording: true, allowScreens: true });
  const title = notes === 'off' ? 'No notes' : choices.keepTranscript ? 'Notes and transcript' : 'Notes only';
  return (
    <>
      <FlowRow {...row} title={title} sub={notes === 'on' ? 'Everyone invited gets them' : 'Nothing is recorded'} on={notes === 'on'} onClick={onPress} />
      {row.expanded && <div className="cf-more"><NotesSwitches notes={notes} choices={choices} onNotes={setNotes} onChoices={setChoices} /></div>}
    </>
  );
}

const meta = {
  title: 'Components/Starting a call/FlowRow',
  component: FlowRow,
  decorators: [rows],
  args: { icon: 'cal', title: 'Thu 5 Nov, 14:00 – 14:30', sub: 'Doesn’t repeat', on: false, chevron: true, disabled: false },
  argTypes: {
    icon: { control: 'select', options: ICON_NAMES },
    title: { control: 'text' }, sub: { control: 'text' },
    on: { control: 'boolean' }, expanded: { control: 'boolean' }, chevron: { control: 'boolean' }, disabled: { control: 'boolean' },
    end: { control: false }, onClick: { control: false }, id: { control: false }
  }
} satisfies Meta<typeof FlowRow>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A button that steps on to another view, with a chevron: here, back to When. */
export const StepsOn: Story = { name: 'Steps on', args: { onClick: press } };
/** Who's coming at its end: the arches of the people invited. */
export const WithFaces: Story = {
  name: 'With faces',
  args: { icon: 'people', title: '3 invited', sub: '2 coming, 1 hasn’t answered', end: <Faces people={[PRIYA, KOFI, AIKO]} size={24} max={4} />, onClick: press }
};
/**
 * Opens in place (`expanded`): pressing it opens what the call's notes keep under it, and the chevron turns. `on`
 * lights its icon while notes are on.
 */
export const OpensInPlace: Story = {
  name: 'Opens in place',
  args: { icon: 'notes', title: 'Notes and transcript', sub: 'Everyone invited gets them', on: true, expanded: false },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <NotesRow row={args} onPress={() => { press(); update({ expanded: !args.expanded }); }} />;
  }
};
/** Lit (`on`): notes are on for this call. */
export const On: Story = { args: { icon: 'notes', title: 'Notes and transcript', sub: 'Everyone invited gets them', on: true, onClick: press } };
/** Only read, without `onClick`: no chevron, nothing to press. Here, the times offered to a guest. */
export const ReadOnly: Story = { name: 'Read only', args: { icon: 'calClock', title: 'Times offered', sub: 'Thu 5 Nov, 14:00 · Fri 6 Nov, 11:00' } };
/** Held while the call saves (`disabled`). */
export const Disabled: Story = {
  args: { icon: 'people', title: 'Priya and Kofi', sub: '2 people', end: <Faces people={[PRIYA, KOFI]} size={24} max={4} />, disabled: true, onClick: press }
};
