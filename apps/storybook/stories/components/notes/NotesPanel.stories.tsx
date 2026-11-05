/*
 * NotesPanel: a call's notes in one panel: a head with the title and when it was (and anything for its end), labelled
 * sections (NotesSection), and a foot. Each row is a NoteRow: a decision gets a tick, a follow-up the arch and first
 * name of whoever has it. New rows rise in as the notes are written during the call.
 */
import { Faces, NoteRow, NotesPanel, NotesSection, SealedBadge } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { ART, KOFI, MAYA, PRIYA } from '../../../src/world/people';

/** What the standup decided, and who's doing what. */
function Standup({ arriving = false }: { arriving?: boolean | undefined }) {
  return (
    <>
      <NotesSection label="Decided">
        <NoteRow>The new onboarding ships behind a flag on 12 November.</NoteRow>
        <NoteRow>Support gets the help article before the flag goes on.</NoteRow>
      </NotesSection>
      <NotesSection label="Follow-ups">
        <NoteRow owner={PRIYA}>Write the help article for support · Fri</NoteRow>
        <NoteRow owner={KOFI}>Add the flag to the rollout plan</NoteRow>
        {arriving ? <Arriving /> : <NoteRow owner={ART}>Review the launch checklist · Today</NoteRow>}
      </NotesSection>
    </>
  );
}

/** A follow-up that's just been said: it rises in, and here it comes again every few seconds. */
function Arriving() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), 2400);
    return () => clearInterval(t);
  }, []);
  return n % 2 === 1 ? <NoteRow key={n} owner={ART} isNew>Review the launch checklist · Today</NoteRow> : null;
}

const meta = {
  title: 'Components/Notes and transcript/NotesPanel',
  component: NotesPanel,
  subcomponents: { NotesSection, NoteRow },
  args: {
    title: 'Team standup',
    meta: 'Today · 09:00 · 20 min',
    end: <Faces people={[ART, PRIYA, KOFI, MAYA]} size={22} />,
    children: <Standup />,
    foot: <SealedBadge inline title="Written in confidential compute" />
  },
  argTypes: {
    title: { control: 'text' }, meta: { control: 'text' },
    end: { control: false }, children: { control: false }, foot: { control: false }, className: { control: false }
  },
  decorators: [(Story) => <div style={{ width: 'min(420px, 100%)' }}><Story /></div>]
} satisfies Meta<typeof NotesPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A call's notes: what was decided, what's to do and who has it, and how they were written. */
export const CallNotes: Story = { name: 'A call’s notes' };
/** During the call: a follow-up lands in the notes and rises into place. */
export const ANewRow: Story = { name: 'A new row', args: { children: <Standup arriving /> } };
/** A recording made in the room, only yours: its summary, and what's yours to do. */
export const RoomRecording: Story = {
  name: 'A room recording',
  args: {
    title: 'Site visit, Harbourline',
    meta: 'Mon 2 Nov · 10:30 · 72 min · Only you',
    end: undefined,
    children: (
      <>
        <NotesSection label="Summary">
          <p className="ac-summary">The Harbourline team records every handover on the floor, shift to shift. Half the crew reads Portuguese, so they need notes in Portuguese.</p>
        </NotesSection>
        <NotesSection label="Follow-ups">
          <NoteRow owner={ART}>Send Harbourline notes in Portuguese</NoteRow>
        </NotesSection>
      </>
    ),
    foot: <SealedBadge inline title="Only you can read these notes" />
  }
};
