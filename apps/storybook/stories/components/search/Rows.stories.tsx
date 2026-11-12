/*
 * The palette's rows. Each is the app's own element (a link, or a `div role="option"`) with className={paletteRow(kind,
 * lit)} and one row part inside it: Ask "…" (PaletteAskLine), someone whose name has the words (PalettePersonLine), a
 * moment under its call (PaletteCallHead, PaletteMomentLine), the rest of a call's moments (PaletteMoreLine), a note
 * (PaletteNoteLine), and See all (PaletteAllLine). The lit row sits on sunk; ↑ and ↓ move it, the pointer moves it, and
 * Enter does what it says. Rows come in labelled groups (PaletteGroup), and before anything's typed the people you meet
 * most come first, as arches (PalettePeople).
 */
import {
  PaletteAllLine, PaletteAskLine, PaletteGroup, PaletteMomentLine, PaletteMoreLine, PaletteNoteLine, PalettePeople, PalettePersonLine, PalettePin
} from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { Stack, did } from '../../../src/component';
import { AIKO, MAYA } from '../../../src/world/people';
import {
  CallMoments, DESIGN, HARBOURLINE, INTERVIEW, Listbox, NOTES, PEOPLE, PRICING, Row, SaidGroup, STANDUP, clock, coverOf, first, marked, noteLine
} from './parts';

/** The list pane of the window, on its own. */
const Pane = ({ label, children }: { label: string; children: ReactNode }) => <div className="sbc-pane"><Listbox label={label}>{children}</Listbox></div>;

const meta = {
  title: 'Components/Search/Rows',
  parameters: { layout: 'centered' }
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Ask "…": first whenever something's typed. When what's typed reads as a question it's lit, and ↵ asks; otherwise the
 * first thing found is lit and Tab asks.
 */
export const Ask: Story = {
  render: () => (
    <Pane label="Ask">
      <Row kind="ask"><PaletteAskLine text="flag" keyLabel="Tab" /></Row>
      <Row kind="ask" lit><PaletteAskLine text="When does onboarding ship?" keyLabel="↵" /></Row>
    </Pane>
  )
};

/** Someone whose name has the words: the match marked, their title and how many calls you've had. Enter makes them the token. */
export const Person: Story = {
  render: () => (
    <Pane label="People">
      <PaletteGroup label="People">
        <Row kind="person" lit><PalettePersonLine person={MAYA} name={marked(MAYA.name, ['maya'])} meta="Finance · 4 calls" /></Row>
        <Row kind="person"><PalettePersonLine person={AIKO} name={marked(AIKO.name, ['ai'])} meta="Engineering · 2 calls" /></Row>
      </PaletteGroup>
    </Pane>
  )
};

/**
 * What was said: each call's head (its sky, its title, its day), then its moments in time order: who said it, Decision
 * (rose) or Follow-up (horizon) when a decision or follow-up rests on the line, the words with the match marked, and when,
 * as a moment chip. "3 more in Team standup" opens the rest of that call in place.
 */
export const Moments: Story = {
  render: () => (
    <Pane label="What was said">
      <SaidGroup label="What was said" calls={[STANDUP, PRICING]} words={['flag']}>
        <CallMoments call={STANDUP} words={['flag']} lit={195} shown={3} />
        <CallMoments call={PRICING} words={['flag']} />
      </SaidGroup>
    </Pane>
  )
};

/** Decision and Follow-up beside the name: the line a decision or a follow-up in the notes rests on, lit and not. */
export const DecisionsAndFollowUps: Story = {
  name: 'Decisions and follow-ups',
  render: () => {
    const lines = STANDUP.said.filter((l) => l.made);
    return (
      <Pane label="What was said">
        {lines.map((l, i) => (
          <Row key={l.at} kind="moment" lit={i === 0}>
            <PaletteMomentLine person={l.person} name={first(l.person)} made={l.made} time={clock(l.at)}>{l.text}</PaletteMomentLine>
          </Row>
        ))}
      </Pane>
    );
  }
};

/** Someone's words, the token's: "What Maya said", with no words typed, newest call first. */
export const WhatSomeoneSaid: Story = {
  name: 'What someone said',
  render: () => {
    const said = (c: typeof STANDUP) => ({ ...c, said: c.said.filter((l) => l.person === MAYA) });
    return (
      <Pane label="What Maya said">
        <PaletteGroup label="What Maya said" count="6 moments in 2 calls">
          <CallMoments call={said(STANDUP)} words={[]} lit={156} />
          <CallMoments call={said(PRICING)} words={[]} shown={2} />
        </PaletteGroup>
      </Pane>
    );
  }
};

/** The rest of a call's moments, folded away; lit, Enter shows them in place. */
export const More: Story = {
  render: () => (
    <Pane label="More">
      <Row kind="more"><PaletteMoreLine>3 more in Team standup</PaletteMoreLine></Row>
      <Row kind="more" lit><PaletteMoreLine>1 more in Pricing sync</PaletteMoreLine></Row>
    </Pane>
  )
};

/** A note: its sky (an arch with the moon for one recorded in the room), its title and what it is. */
export const Notes: Story = {
  render: () => (
    <Pane label="Notes">
      <PaletteGroup label="Recent notes">
        {NOTES.slice(0, 5).map((n, i) => (
          <Row key={n.id} kind="note" lit={i === 0}><PaletteNoteLine cover={coverOf(n)} room={n.room} title={n.title} meta={noteLine(n)} /></Row>
        ))}
      </PaletteGroup>
    </Pane>
  )
};

/** Notes that have the words only in their title, summary, decisions or follow-ups: no line of what was said. */
export const NotesByTheirWords: Story = {
  name: 'Notes by their words',
  render: () => (
    <Pane label="Notes">
      <PaletteGroup label="Notes" count="2 notes">
        <Row kind="note" lit><PaletteNoteLine cover={coverOf(HARBOURLINE)} title={marked(HARBOURLINE.title, ['harbourline'])} meta={noteLine(HARBOURLINE)} /></Row>
        <Row kind="note"><PaletteNoteLine cover={coverOf(DESIGN)} title={DESIGN.title} meta={noteLine(DESIGN)} /></Row>
      </PaletteGroup>
    </Pane>
  )
};

/** See all, at the end of the list: "See all 9 moments in Notes", lit here, or "Open these in Notes" when nothing is hidden. */
export const SeeAll: Story = {
  name: 'See all',
  render: () => (
    <Stack>
      <Pane label="The end of the list">
        <CallMoments call={DESIGN} words={['flag']} />
        <Row kind="all" lit><PaletteAllLine>See all 9 moments in Notes</PaletteAllLine></Row>
      </Pane>
      <Pane label="The end of the list">
        <CallMoments call={DESIGN} words={['flag']} />
        <Row kind="all"><PaletteAllLine>Open these in Notes</PaletteAllLine></Row>
      </Pane>
    </Stack>
  )
};

/** Before anything's typed: the five people you have most calls with, as arches, then your recent notes, the newest lit. */
export const BeforeYouType: Story = {
  name: 'Before you type',
  render: () => (
    <div className="sbc-pane">
      <PalettePeople label="People" people={PEOPLE.map((p) => ({ person: p, first: first(p), onPick: did(`pick ${first(p)}`) }))} />
      <Listbox label="Recent notes">
        <PaletteGroup label="Recent notes">
          {NOTES.slice(0, 5).map((n, i) => (
            <Row key={n.id} kind="note" lit={i === 0}><PaletteNoteLine cover={coverOf(n)} room={n.room} title={n.title} meta={noteLine(n)} /></Row>
          ))}
        </PaletteGroup>
      </Listbox>
    </div>
  )
};

/**
 * Pin a note: the same rows with the pin at their end, in sun-text when it's pinned; the lit row says what Enter does.
 * With as many pinned as there can be, the others are greyed.
 */
export const PinANote: Story = {
  name: 'Pin a note',
  render: () => (
    <Pane label="Notes">
      <PaletteGroup label="Pinned">
        <Row kind="note" lit><PaletteNoteLine cover={coverOf(STANDUP)} title={STANDUP.title} meta={noteLine(STANDUP)} end={<PalettePin pinned label="Unpin" />} /></Row>
      </PaletteGroup>
      <PaletteGroup label="Recent notes">
        <Row kind="note"><PaletteNoteLine cover={coverOf(PRICING)} title={PRICING.title} meta={noteLine(PRICING)} end={<PalettePin pinned={false} label="Pin" />} /></Row>
        <Row kind="note"><PaletteNoteLine cover={coverOf(INTERVIEW)} room title={INTERVIEW.title} meta={noteLine(INTERVIEW)} end={<PalettePin pinned={false} label="Pin" />} /></Row>
      </PaletteGroup>
    </Pane>
  )
};

/** A long title and a long line: one line for a title, two for what was said, never wider than the list. */
export const LongWords: Story = {
  name: 'Long words',
  render: () => (
    <Pane label="Long words">
      <Row kind="note"><PaletteNoteLine cover={coverOf(DESIGN)} title="Quarterly planning with the whole design, research and engineering group, and the agencies" meta="Yesterday · Shared by Priya" /></Row>
      <Row kind="moment" lit>
        <PaletteMomentLine person={MAYA} name="Maya" made="follow-up" time="1:02:48">
          {marked('…we keep the monthly option behind a flag until the launch, and the yearly one stays as it is for every team that already pays for it, whatever the seats', ['flag'])}
        </PaletteMomentLine>
      </Row>
      <Row kind="ask"><PaletteAskLine text="What did Maya and Priya agree about the trial numbers and the twelfth, and who is closing the month?" keyLabel="↵" /></Row>
    </Pane>
  )
};
