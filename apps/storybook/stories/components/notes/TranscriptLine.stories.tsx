/*
 * TranscriptLine: one spoken line of a note's transcript: when it was said (`time`, here a chip that plays from there),
 * the speaker's arch, their name, what they said, and `tools` for what can be done with it, which wait under the
 * pointer. The same speaker again leaves the arch's place empty and isn't named; a room recording names nobody. The
 * line being said as the note plays is lit (`is-on`). `id` makes it a place a link can go to.
 */
import { IconButton, TimeChip, TranscriptLine, Unsure, UnsureKey, cn, type AvatarPerson } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { did } from '../../../src/component';
import { ART, KOFI, PRIYA } from '../../../src/world/people';

const seek = did('onSeek');
/** "1:10" as seconds. */
const at = (mmss: string): number => {
  const [m = 0, s = 0] = mmss.split(':').map(Number);
  return m * 60 + s;
};
const time = (mmss: string) => <TimeChip seconds={at(mmss)} onSeek={seek} />;
/** What can be done with a line: correct it, or bookmark it for yourself. They wait under the pointer. */
const Tools = ({ marked = false }: { marked?: boolean | undefined }) => (
  <>
    <IconButton icon="pen" label="Correct this line" size={15} className="nd-tool" onClick={did('onCorrect')} />
    <IconButton icon={marked ? 'bookmarked' : 'bookmark'} label={marked ? 'Remove your bookmark' : 'Bookmark this line in your own notes, which only you see'} size={15} className="nd-tool" on={marked} onClick={did('onBookmark')} />
  </>
);

/** The transcript's lines, as the note's page lays them out. A room recording's name nobody (`nameless`). */
function Lines({ nameless = false, children }: { nameless?: boolean | undefined; children: ReactNode }) {
  return <div className="nd" style={{ width: 'min(720px, 100%)' }}><div className={cn('nd-lines', nameless && 'is-nameless')}>{children}</div></div>;
}
/** A line from the standup, said by someone named: `more` when they said the line before it too. */
function Line({ mmss, who, name, more = false, children }: { mmss: string; who: AvatarPerson; name: ReactNode; more?: boolean | undefined; children: ReactNode }) {
  return (
    <TranscriptLine time={time(mmss)} person={more ? undefined : who} name={more ? undefined : name} tools={<Tools />} className={cn(more && 'is-more')}>
      {children}
    </TranscriptLine>
  );
}

const meta = {
  title: 'Components/Notes and transcript/TranscriptLine',
  component: TranscriptLine,
  args: {
    time: time('1:10'),
    person: PRIYA,
    name: 'Priya',
    tools: <Tools />,
    children: 'I’d still rather not turn it on for everyone at once. If the first run breaks, it’s the first thing anyone sees.'
  },
  argTypes: {
    name: { control: 'text' }, children: { control: 'text' },
    time: { control: false }, person: { control: false }, tools: { control: false }, className: { control: false }, id: { control: false }
  },
  render: (args) => <Lines><TranscriptLine {...args} /></Lines>
} satisfies Meta<typeof TranscriptLine>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Someone's line: when, their arch and name, and what they said. Point at it for its tools. */
export const Spoken: Story = {};
/** The same speaker again: the arch's place stays empty and the name isn't said twice. */
export const SameSpeakerAgain: Story = {
  name: 'The same speaker again',
  render: () => (
    <Lines>
      <Line mmss="8:40" who={KOFI} name="Kofi">Launch checklist. Two items are still open, and I’d like someone to look before the design review.</Line>
      <Line mmss="8:58" who={ART} name="You">I can look after this.</Line>
      <Line mmss="9:20" who={KOFI} name="Kofi">Thanks. One is the empty state on the team page, the other is the flag name in the rollout plan.</Line>
      <Line mmss="10:05" who={KOFI} name="Kofi" more>I’ll put the flag in the rollout plan now, that one’s quick.</Line>
    </Lines>
  )
};
/** The line being said while the note plays is lit, its time in sun. */
export const BeingSaid: Story = { name: 'Being said', args: { className: 'is-on' } };
/** A tool that's on stays in view: a line you've bookmarked. */
export const Bookmarked: Story = { args: { tools: <Tools marked /> } };
/** A room recording names nobody: no arch, no name, only when and what was said. */
export const RoomRecording: Story = {
  name: 'A room recording',
  render: () => (
    <Lines nameless>
      <TranscriptLine time={time('11:30')} tools={<Tools />}>Most of my work has been distributed systems: consensus, storage, the boring parts.</TranscriptLine>
      <TranscriptLine time={time('38:05')} tools={<Tools />}>I want to stay close to customers, not disappear into a platform team.</TranscriptLine>
      <TranscriptLine time={time('49:20')} tools={<Tools />}>I’ll send the take-home tomorrow.</TranscriptLine>
    </Lines>
  )
};
/** What the transcript isn't sure of is dotted: words that were hard to hear, a speaker heard on two microphones. The key says so above the lines. */
export const NotSure: Story = {
  name: 'Not sure',
  render: () => (
    <div style={{ width: 'min(720px, 100%)' }}>
      <div className="nd-sh"><h2>Transcript</h2><UnsureKey words speaker className="nd-key" /></div>
      <Lines>
        <TranscriptLine time={time('0:21')} person={PRIYA} name="Priya" tools={<Tools />}>
          <Unsure of="words">The new onboarding is done. Design signed off last night and the last coffee changes went in first thing.</Unsure>
        </TranscriptLine>
        <TranscriptLine time={time('16:58')} person={KOFI} name={<Unsure of="speaker">Kofi</Unsure>} tools={<Tools />}>
          Rollout’s fine. We start with one per cent and go from there.
        </TranscriptLine>
      </Lines>
    </div>
  )
};
