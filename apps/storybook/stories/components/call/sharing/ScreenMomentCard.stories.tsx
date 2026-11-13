/*
 * ScreenMomentCard: one moment a shared screen changed, in its place among the transcript lines said while it was up.
 * Its thumbnail, what it is, whose screen and when, what it shows once the notes are written (two lines at most), and
 * how legible it was when it wasn't all. Pressing it opens the frame. Calm by design: a thumbnail beside the lines, never
 * a wall of images. In the page's theme, on a note.
 */
import { ScreenMomentCard } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { screenImage } from '../../../../src/api/media';
import { Box, did } from '../../../../src/component';
import { LAUNCH_CHECKLIST } from '../../../../src/world/notes';

/** Whose and when, as a note says it: the range kept on one line. */
const WHEN = 'Kofi’s screen · 8:52⁠–⁠10:05';
/** A frame with nothing on it that could be read. */
const BLANK = screenImage({ ...LAUNCH_CHECKLIST, title: '', text: '' });

const meta = {
  title: 'Components/In a call/Sharing/ScreenMomentCard',
  component: ScreenMomentCard,
  args: {
    src: screenImage(LAUNCH_CHECKLIST), width: LAUNCH_CHECKLIST.width, height: LAUNCH_CHECKLIST.height, title: LAUNCH_CHECKLIST.title, meta: WHEN,
    description: LAUNCH_CHECKLIST.description, onOpen: did('onOpen')
  },
  argTypes: {
    src: { control: false }, title: { control: 'text' }, meta: { control: 'text' }, description: { control: 'text' },
    legible: { control: 'inline-radio', options: ['clear', 'partly', 'unreadable', 'unread'] }, className: { control: false }
  },
  render: (args) => <Box width="min(560px, 100%)" height="auto"><ScreenMomentCard {...args} /></Box>
} satisfies Meta<typeof ScreenMomentCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Written: what it shows, tied to what was said. */
export const Written: Story = {};
/** Before the notes are written: what it is, whose and when. */
export const BeforeTheNotes: Story = { name: 'Before the notes', args: { description: undefined } };
/** Part of it couldn't be read, and the card says so. */
export const PartlyReadable: Story = { name: 'Partly readable', args: { legible: 'partly' } };
/** Nothing on it could be made out: no title, so it's "A shared screen", and nothing said about it. */
export const Unreadable: Story = { args: { src: BLANK, title: '', description: undefined, legible: 'unreadable' } };
/** The notes model couldn't read it at all. */
export const Unread: Story = { args: { src: BLANK, title: '', description: undefined, legible: 'unread' } };
/** A long title wraps to the lines it needs; a long description stops at two. */
export const Long: Story = {
  args: {
    title: 'Launch checklist: help article, rollout flag and the team page',
    description: 'Kofi’s launch checklist, with two of its items still open: the empty state on the team page, which needs one line and the arch, and the flag’s name in the rollout plan, which has to match the release notes before support hears about it.'
  }
};
