/*
 * TeamNotesList: the notes people on the team made visible to it, newest first, under the team's people: who made each
 * visible and when, each opening its note. With none, it says what will show here, or why nothing does.
 */
import { Button, ShowMore, TeamNotesList } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { NOTES, onTheWater } from './parts';

const meta = {
  title: 'Components/Team/TeamNotesList',
  component: TeamNotesList,
  decorators: [onTheWater()],
  parameters: { layout: 'fullscreen' },
  args: {
    notes: NOTES,
    link: (n, row) => <a href={`#${n.id}`} onClick={(e) => { e.preventDefault(); did('onOpen')(n.id); }}>{row}</a>,
    empty: { title: 'Nothing visible to the team yet', line: 'On a note you organized, open Share and turn on Visible to team.' }
  },
  argTypes: { notes: { control: false }, link: { control: false }, empty: { control: false }, foot: { control: false }, title: { control: 'text' }, aside: { control: 'text' }, className: { control: false } }
} satisfies Meta<typeof TeamNotesList>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Three notes made visible to the team. */
export const Visible: Story = {};
/** More than five: Show more under them. */
export const More: Story = { name: 'Show more', args: { foot: <ShowMore all={false} more={4} onToggle={did('onToggle')} className="tq-more" /> } };
/** Nobody has made a note visible yet: how to. */
export const NoneYet: Story = { name: 'None yet', args: { notes: [] } };
/** Without a license, as the team's admin: not open to you yet. */
export const NotOpen: Story = { name: 'Not open yet', args: { notes: [], empty: { title: 'Not open to you yet', line: 'The notes people here make visible open while you have a license.' } } };
/** They didn't load: why, and Try again. */
export const DidntLoad: Story = {
  name: 'Didn’t load',
  args: { notes: [], empty: { title: 'These didn’t load', line: 'Alcove couldn’t answer just now. Try again in a moment.', action: <Button size="sm" icon="retry" onClick={did('onRetry')}>Try again</Button> } }
};
