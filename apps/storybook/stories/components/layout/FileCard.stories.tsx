/*
 * FileCard: a file as a large preview, on a call's page (what was shared and made in it), the Drive's sheet and a
 * workspace's home. Its picture is drawn by kind (Thumb): a document's first lines with its to-dos, a board's stickies, a
 * PDF's page, photos, or a shared screen at night with play over it. Under it the name, and one line of who made it and
 * when, after where it is when that isn't where you are. The whole card opens it; a menu can sit over the picture's corner.
 */
import { FileCard, IconButton, type ThumbLine } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { did } from '../../../src/component';

const CHECKLIST: ThumbLine[] = [
  { text: 'Status page: Kofi, from now on', mark: 'done' },
  { text: 'Help article before the flag goes on', mark: 'done' },
  { text: 'Changelog before the launch post', mark: 'todo' },
  { text: 'Flag on for everyone: 12 Nov', mark: 'todo' }
];
const MOVE_PLAN: ThumbLine[] = [
  { text: 'Movers come on the 14th', mark: 'dot' },
  { text: 'Orders before the 14th ship from the old site', mark: 'dot' },
  { text: 'Order page shows new delivery times', mark: 'dot' },
  { text: 'Tell suppliers by Friday', mark: 'dot' }
];

/** Cards side by side, as a page lays them out: `min` is the narrowest a card gets. */
const Grid = ({ min, children }: { min: number; children: ReactNode }) => (
  <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: '16px 14px', maxWidth: 920, padding: 8 }}>{children}</div>
);

const meta = {
  title: 'Components/Layout/FileCard',
  component: FileCard,
  args: { kind: 'doc', name: 'Launch checklist', by: 'Kofi edited at 10:12', thumb: { lines: CHECKLIST }, onOpen: did('onOpen'), size: 'md' },
  argTypes: {
    kind: { control: 'inline-radio', options: ['doc', 'board', 'pdf', 'photos', 'share'] },
    size: { control: 'inline-radio', options: ['md', 'lg'] },
    menu: { control: false }, thumb: { control: false }
  },
  render: (args) => <Grid min={args.size === 'lg' ? 220 : 160}><FileCard {...args} /></Grid>
} satisfies Meta<typeof FileCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A document made in a call: its first lines, the to-dos ticked as they are in it. */
export const ADocument: Story = { name: 'A document' };
/** A document whose first lines are bullets. */
export const Bullets: Story = { args: { name: 'Move plan', by: 'You edited at 12:10', thumb: { lines: MOVE_PLAN } } };
/** A board: a few stickies, drawn. */
export const ABoard: Story = { name: 'A board', args: { kind: 'board', name: 'Standup board', by: 'Priya edited at 09:20', thumb: undefined } };
/** A PDF someone uploaded. */
export const APdf: Story = { name: 'A PDF', args: { kind: 'pdf', name: 'floor-plan.pdf', by: 'Ines added it at 12:02', thumb: undefined } };
/** Photos, with how many there are. */
export const Photos: Story = { args: { kind: 'photos', name: 'Handover photos', by: 'You added them on Monday', thumb: { count: 12 } } };
/** A screen shared in a call: night, with play, and the moment it started on its chip. Pressing it plays it from there. */
export const ASharedScreen: Story = {
  name: 'A shared screen',
  args: { kind: 'share', name: 'Kofi’s screen', at: '8:10', by: '2 min 30 s', label: 'Play Kofi’s screen from 8:10', thumb: undefined }
};
/** Playing on the call's stage now. */
export const Playing: Story = { args: { ...ASharedScreen.args, current: true } };
/** An agenda written before a call: its title on its page, then its lines. */
export const AnAgenda: Story = {
  name: 'An agenda',
  args: { name: 'Agenda', by: 'Priya, 10:40', thumb: { title: 'Agenda', lines: [{ text: 'Where the launch checklist stands' }, { text: 'Press list for the 18th' }, { text: 'Status page: who watches it' }] } }
};
/** A new page with nothing in it yet. */
export const Empty: Story = { args: { name: 'Untitled', by: 'You, just now', thumb: { lines: [] } } };
/** A long name and long lines end at a word, with an ellipsis. */
export const LongWords: Story = {
  args: {
    name: 'Quarterly operations review for the Harbourline pilot, second draft',
    by: 'Ines edited it yesterday at 16:40, after the review',
    thumb: { lines: [{ text: 'Every handover at both sites is recorded and kept for the review', mark: 'dot' }, { text: 'Notes needed in Portuguese for the second site', mark: 'dot' }] }
  }
};

/** On the Drive: larger, with where each is and a menu over its corner, shown on hover and focus. */
export const OnTheDrive: Story = {
  name: 'On the Drive',
  args: { size: 'lg' },
  render: (args) => (
    <Grid min={220}>
      <FileCard {...args} kind="doc" name="Launch plan" where="In Launch" by="Priya edited at 08:40" thumb={{ lines: [{ text: 'Launch: Wednesday 18 November' }, { text: 'Onboarding behind a flag first' }, { text: 'Status page owned by Kofi' }, { text: 'Press list: Ines' }] }}
        menu={<IconButton icon="more" label="More for Launch plan" size={16} onClick={did('onMenu')} />} />
      <FileCard {...args} kind="doc" name="Launch checklist" where="From Team standup" by="Kofi edited at 10:12" thumb={{ lines: CHECKLIST }}
        menu={<IconButton icon="more" label="More for Launch checklist" size={16} onClick={did('onMenu')} />} />
      <FileCard {...args} kind="board" name="Plans board" where="From Pricing sync" by="Maya edited yesterday" thumb={undefined}
        menu={<IconButton icon="more" label="More for Plans board" size={16} onClick={did('onMenu')} />} />
      <FileCard {...args} kind="photos" name="Handover photos" where="In Harbourline" by="You, Monday" thumb={{ count: 12 }}
        menu={<IconButton icon="more" label="More for Handover photos" size={16} onClick={did('onMenu')} />} />
    </Grid>
  )
};

/** On a call's page: its shared screens first, then what it made. */
export const OnACall: Story = {
  name: 'On a call',
  render: (args) => (
    <Grid min={160}>
      <FileCard {...args} kind="share" name="Kofi’s screen" at="8:10" by="2 min 30 s" label="Play Kofi’s screen from 8:10" thumb={undefined} />
      <FileCard {...args} kind="doc" name="Launch checklist" by="Kofi edited at 10:12" thumb={{ lines: CHECKLIST }} />
      <FileCard {...args} kind="board" name="Standup board" by="Priya edited at 09:20" thumb={undefined} />
    </Grid>
  )
};
