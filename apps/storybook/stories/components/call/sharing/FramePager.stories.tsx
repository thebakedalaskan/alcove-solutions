/*
 * FramePager: whoever presents a board steps through its frames from the frame's foot, and everyone following them moves
 * with them, always at night. Back and Next stay pressable at either end, so the arrow keys keep working there; they just
 * do nothing. The notebook opens the presenter's own notes, only theirs, lit while they're open.
 */
import { FramePager } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did, onStage } from '../../../../src/component';

const FRAMES = ['Went well', 'Could improve', 'Actions'];

const meta = {
  title: 'Components/In a call/Sharing/FramePager',
  component: FramePager,
  ...onStage,
  args: { at: 1, total: 3, part: 'Went well', onBack: did('Back a frame'), onNext: did('Next frame'), notes: { on: false, onToggle: did('Your notes') } },
  argTypes: { notes: { control: false } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    const go = (at: number) => update({ at, part: FRAMES[at - 1] ?? args.part });
    const notes = args.notes;
    return (
      <FramePager {...args}
        onBack={() => { args.onBack(); if (args.at > 1) go(args.at - 1); }}
        onNext={() => { args.onNext(); if (args.at < args.total) go(args.at + 1); }}
        notes={notes && { on: notes.on, onToggle: () => { notes.onToggle(); update({ notes: { ...notes, on: !notes.on } }); } }} />
    );
  }
} satisfies Meta<typeof FramePager>;
export default meta;
type Story = StoryObj<typeof meta>;

/** On the first frame: Back is there, dimmed, and does nothing. */
export const First: Story = {};
export const Middle: Story = { args: { at: 2, part: 'Could improve' } };
/** On the last frame: Next is there, dimmed, and does nothing. */
export const Last: Story = { args: { at: 3, part: 'Actions' } };
/** Your notes are open in your side. */
export const NotesOpen: Story = { name: 'Notes open', args: { at: 2, part: 'Could improve', notes: { on: true, onToggle: did('Your notes') } } };
/** Without an account there are no notes of your own to keep. */
export const WithoutNotes: Story = { name: 'Without notes', args: { notes: null } };
