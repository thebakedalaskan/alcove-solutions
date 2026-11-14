/*
 * Widget: one card on a page's water, the way Home holds For you and Upcoming. Its head: an icon in a tile, the title,
 * then `end`, what the head holds after it (tabs, or a quiet button at its end). Its body. And, only while the list in it
 * is longer than it shows, a foot with Show N more; `footEnd` sits at that foot's end, and keeps the foot once everything
 * shows. `foot` sits at the card's foot, under the body. `bare` leaves the card out: the head and what's under it sit on the
 * page, as Home's Recent notes does. `id` lets a link name it, and `landed` says one just did.
 */
import { EmptyRows, Hatch, Icon, NoteCard, Widget, coverFor } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { KOFI, MAYA, PRIYA } from '../../../src/world/people';

const open = did('open');
const ROWS = ['Design sync · Today 17:30', 'Harbourline proposal · Thu 11:00', '1:1 with Maya · Thu 15:30', 'Product sync · Fri 10:00'];
/** A list as a widget holds one: rows on hairlines, padded to the head's edge. */
const list = (rows: readonly string[]) => (
  <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
    {rows.map((r, i) => <li key={r} className="ac-body" style={{ padding: '14px 18px', borderTop: i ? '1px solid var(--line)' : undefined }}>{r}</li>)}
  </ul>
);

const meta = {
  title: 'Components/Layout/Widget',
  component: Widget,
  args: { icon: 'cal', title: 'Upcoming', children: list(ROWS) },
  argTypes: {
    title: { control: 'text' }, bare: { control: 'boolean' }, landed: { control: 'boolean' }, id: { control: false },
    icon: { control: false }, end: { control: false }, foot: { control: false }, footEnd: { control: false }, more: { control: false }, body: { control: false },
    headingRef: { control: false }, className: { control: false }, children: { control: false }
  },
  render: (args) => <div style={{ width: 'min(520px, 100%)' }}><Widget {...args} /></div>
} satisfies Meta<typeof Widget>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A list, and a quiet button at the end of its head. */
export const Default: Story = {
  args: { end: <a href="#settings" className="ac-icon-btn" style={{ marginLeft: 'auto' }} aria-label="Calendar settings" title="Calendar settings" onClick={(e) => { e.preventDefault(); open('settings'); }}><Icon name="settings" size={17} /></a> }
};
/** Longer than it shows: Show 3 more at its foot. Once everything shows, the foot goes. */
export const ShowMore: Story = { name: 'Show more', args: { children: list(ROWS.slice(0, 3)), more: { count: 3, onShow: did('onShow') } } };
/**
 * Something at the end of the foot, after Show 3 more: Upcoming's count of the events with only you on them, a quiet toggle.
 * The foot stays for it once everything shows.
 */
export const FootEnd: Story = {
  name: 'Foot end',
  args: {
    children: list(ROWS.slice(0, 3)), more: { count: 3, onShow: did('onShow') },
    footEnd: <button type="button" className="hm-solo" aria-pressed={false} onClick={() => open('solo')}><Hatch />2 with only you</button>
  }
};
/** Something at the card's foot, under the body: what's missing, and the way to it. */
export const WithAFoot: Story = {
  name: 'With a foot',
  args: {
    foot: <div className="ac-body-s" style={{ padding: '14px 18px', borderTop: '1px solid var(--line)', color: 'var(--ink-2)' }}>See your other meetings here</div>
  }
};
/**
 * Landed on: a link named it, as Home's count in the side panel names For you. A ring in the horizon's blue goes round it and
 * fades over 1.8s as the eye finds it, with reduced motion too. Switch `landed` off and on to see it again.
 */
export const Landed: Story = { args: { icon: 'inbox', title: 'For you', id: 'for-you', landed: true } };
/** Nothing in it yet: a small drawing, a title and one line, in the middle of the body. */
export const Empty: Story = {
  args: {
    icon: 'inbox', title: 'For you',
    children: (
      <div style={{ display: 'grid', justifyItems: 'center', gap: 4, padding: '36px 20px', textAlign: 'center' }}>
        <span style={{ marginBottom: 16 }}><EmptyRows /></span>
        <b style={{ font: '600 15px/1.3 var(--font-sans)' }}>Nothing to answer yet</b>
        <p className="ac-body-s" style={{ color: 'var(--ink-2)' }}>Decisions to confirm and follow-ups from your calls show up here.</p>
      </div>
    )
  }
};
/** Bare: no card. A row of note cards under a head of its own, with View all at its end. */
export const Bare: Story = {
  args: {
    bare: true, icon: 'notes', title: 'Recent notes',
    end: <a href="#notes" className="ac-body-s" style={{ marginLeft: 'auto', color: 'var(--ink-2)' }} onClick={(e) => { e.preventDefault(); open('notes'); }}>View all</a>,
    children: (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
        <NoteCard cover={coverFor('n2')} people={[PRIYA, KOFI]} title={<a href="#n2" onClick={(e) => { e.preventDefault(); open('n2'); }}>Team standup</a>} when="Today · 20 min" />
        <NoteCard cover={coverFor('n3')} people={[MAYA]} title={<a href="#n3" onClick={(e) => { e.preventDefault(); open('n3'); }}>Pricing sync</a>} when="Yesterday · 32 min" />
      </div>
    )
  }
};
