/*
 * Card: the container for one thing on a page: the surface, with a line for its edge. A `title` heading can have an
 * `aside` on its right: a count, or a link to what the card lists. Without a title, `label` names it for screen
 * readers. Cards never nest: what's inside is rows, with space between them.
 */
import { Card, Icon, Meter, NoteRow } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { ART, KOFI, PRIYA } from '../../../src/world/people';

const open = did('onOpen');

const meta = {
  title: 'Components/Layout/Card',
  component: Card,
  args: {
    title: 'Team standup',
    aside: <span>Today, 09:00</span>,
    children: <p className="ac-summary">The new onboarding ships behind a flag on 12 November, and support gets the help article first.</p>
  },
  argTypes: {
    title: { control: 'text' }, label: { control: 'text' },
    aside: { control: false }, children: { control: false }, className: { control: false }, style: { control: false }
  },
  render: (args) => <div style={{ width: 'min(520px, 100%)' }}><Card {...args} /></div>
} satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A heading, with when it was on its right. */
export const TitleAndAside: Story = { name: 'Title and aside' };
/** Rows inside, never cards in cards: what's still to do from the standup, with who has each. */
export const WithRows: Story = {
  name: 'With rows',
  args: {
    title: 'Follow-ups',
    aside: <span>3 open</span>,
    children: (
      <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
        <NoteRow owner={ART}>Review the launch checklist · Today</NoteRow>
        <NoteRow owner={PRIYA}>Write the help article for support · Fri</NoteRow>
        <NoteRow owner={KOFI}>Add the flag to the rollout plan</NoteRow>
      </div>
    )
  }
};
/** A link as the aside: it belongs to what the card lists. */
export const LinkAside: Story = {
  name: 'A link as the aside',
  args: {
    title: 'Decided this week',
    aside: <a href="#notes" onClick={(e) => { e.preventDefault(); open('notes'); }}>All notes<Icon name="right" size={14} /></a>,
    children: (
      <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
        <NoteRow>The new onboarding ships behind a flag on 12 November.</NoteRow>
        <NoteRow>The team plan gets a monthly option.</NoteRow>
      </div>
    )
  }
};
/** No title: `label` names it for screen readers instead. */
export const WithoutATitle: Story = {
  name: 'Without a title',
  args: {
    title: undefined,
    aside: undefined,
    label: 'Notes left',
    children: (
      <div style={{ display: 'grid', gap: 10 }}>
        <span style={{ font: '600 21px/28px var(--font-sans)', fontVariantNumeric: 'tabular-nums' }}>2 h 40 min</span>
        <Meter value={0.4} />
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>of notes left this month</span>
      </div>
    )
  }
};
