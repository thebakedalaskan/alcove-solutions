/*
 * NoteCard: a note in a row of cards, as Home's Recent notes has them. Its cover is its own small sunset (a sky, a sun on
 * a band of sea, two glints), one of six, which `coverFor(id)` picks the same every time. The people on the call stand on
 * the cover's lower edge (the first two), or an arch with a microphone for a recording in the room, or a camera for a call
 * with nobody else on it. Then the title, which is the link and takes the whole card, and when and how long. `tag` says
 * something on the cover; while the notes are being written the cover breathes.
 */
import { COVERS, Dots, NoteCard, RecDot, coverFor } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { KOFI, MAYA, PRIYA, THEO } from '../../../src/world/people';

const open = did('open');
const link = (title: string) => <a href={`#${title}`} onClick={(e) => { e.preventDefault(); open(title); }}>{title}</a>;

const meta = {
  title: 'Components/Notes and transcript/NoteCard',
  component: NoteCard,
  args: { cover: coverFor('n2'), people: [PRIYA, KOFI, MAYA], title: link('Team standup'), when: 'Today · 20 min', room: false, writing: false },
  argTypes: {
    cover: { control: 'inline-radio', options: COVERS }, room: { control: 'boolean' }, writing: { control: 'boolean' }, tag: { control: 'text' },
    people: { control: false }, title: { control: false }, when: { control: false }, className: { control: false }
  },
  render: (args) => <div style={{ width: 210 }}><NoteCard {...args} /></div>
} satisfies Meta<typeof NoteCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The standup: two of the people on it, standing on the cover's edge. */
export const Default: Story = {};
/** The six covers, each a moment of the same sky. */
export const EveryCover: Story = {
  name: 'Every cover',
  render: (args) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 196px)', gap: 14, width: 'min(860px, 100%)' }}>
      {COVERS.map((cover) => <NoteCard key={cover} {...args} cover={cover} title={link(cover)} />)}
    </div>
  )
};
/** A recording in the room: a microphone's arch where the faces would be. */
export const InTheRoom: Story = { name: 'In the room', args: { room: true, people: [], title: link('Interview: Jonas Weber'), when: 'Mon · 52 min' } };
/** A call with nobody else on it. */
export const OnlyYou: Story = { name: 'Only you', args: { people: [], title: link('Art’s call'), when: 'Today · 6 min' } };
/** Its notes are being written: the dots, and the cover breathes. */
export const BeingWritten: Story = { name: 'Being written', args: { writing: true, people: [MAYA], title: link('Pricing follow-up'), when: <>Being written<Dots /></> } };
/** A recording still going on another device. */
export const StillRecording: Story = { name: 'Still recording', args: { writing: true, room: true, people: [], title: link('Harbourline walkthrough'), when: <><RecDot />Still recording</> } };
/** The example note, before you have notes of your own: Example on its cover. */
export const Example: Story = { args: { tag: 'Example', people: [THEO, PRIYA], title: link('Weekly product call'), when: 'Example · 24 min' } };
/** A long title takes two lines, then ends in an ellipsis. */
export const LongTitle: Story = {
  name: 'Long title',
  args: { people: [MAYA, KOFI], title: link('Quarterly planning: what goes into the first quarter of next year, and what waits until the summer'), when: 'Mon · 1 h 12 min' }
};
