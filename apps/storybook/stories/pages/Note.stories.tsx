/* A note: the call as its horizon, then what it decided, what's still open, what's next, and what was said (user-flows 8). */
import type { Meta } from '@storybook/react-vite';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';

const meta = { title: 'Pages/A note', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** The team standup, written out in full: decisions, a question, follow-ups, a shared screen and your own notes. */
export const Standup = page('/notes/n2', 'busy');
/** Art's call this morning: everything in it still waits on Art. */
export const WaitingOnYou = page('/notes/n1', 'busy');
/** Someone else's call you were invited to. */
export const Invited = page('/notes/n3', 'busy');
/** A recording made in the room: nobody's name on the lines. */
export const RoomRecording = page('/notes/n6', 'busy');
/** The pricing follow-up just ended: its notes are written while you watch. */
export const BeingWritten = page('/notes/n0', 'writing');
/** The example note a first day opens. */
export const Example = page('/notes/example', 'first-day');
/** A note that isn't there any more. */
export const Gone = page('/notes/n-gone', 'busy');

/** Scrolls to what was worked on in the call. */
const toWorkedOn: PageStory['play'] = async ({ canvas }) => { (await canvas.findByText('Worked on in this call')).scrollIntoView({ block: 'center' }); };
/** The design review's note, at what was worked on in it: each document someone changed during the call, and who, opening in the Drive. */
export const WorkedOn = page('/notes/n4', 'busy', { play: toWorkedOn });
export const WorkedOnNight = page('/notes/n4', 'busy', { play: toWorkedOn, globals: { theme: 'dark' } });
