/*
 * Asking replaces the list with the answer: ← Results (PaletteBack), the answer beside the Ask mark (PaletteAnswer), with
 * dots and "Reading your notes" while it's written, then "From your notes" and the moments it comes from, as moment rows
 * under their calls. The preview shows the lit moment. Editing the line, or Escape, goes back to the results.
 */
import { PaletteAnswer, PaletteBack, PaletteGroup, PaletteMomentLine, PaletteCallHead } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { did } from '../../../src/component';
import { NOTE_COUNT, PRICING, Row, STANDUP, clock, coverOf, first, marked } from './parts';

const WORDS = ['onboarding', 'ships'];
const ANSWER = 'The new onboarding ships behind a flag on 12 November, and support gets the help article first. The launch itself moves to the 18th, so the flag has a week to settle, and the monthly option stays behind a flag until then. The 12 November date is still waiting for someone to confirm it.';

/** The list pane of the window, on its own. */
const Pane = ({ children }: { children: ReactNode }) => <div className="sbc-pane">{children}</div>;

const meta = {
  title: 'Components/Search/Answer',
  parameters: { layout: 'centered' }
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Reading: the dots while the answer is written in confidential compute. */
export const Reading: Story = {
  render: () => (
    <Pane>
      <PaletteBack onClick={did('results')}>Results</PaletteBack>
      <PaletteAnswer reading>Reading your notes</PaletteAnswer>
    </Pane>
  )
};

/** Written: the answer, then the moments it comes from under their calls, the first lit. */
export const Written: Story = {
  render: () => {
    const cited = [STANDUP.said.find((l) => l.at === 195), STANDUP.said.find((l) => l.at === 362)].flatMap((l) => (l ? [l] : []));
    const later = PRICING.said.find((l) => l.at === 1695);
    return (
      <Pane>
        <PaletteBack onClick={did('results')}>Results</PaletteBack>
        <PaletteAnswer>{ANSWER}</PaletteAnswer>
        <div role="listbox" aria-label="From your notes">
          <PaletteGroup label="From your notes" count="3 moments">
            <PaletteCallHead cover={coverOf(STANDUP)} title={STANDUP.title} meta={STANDUP.day} />
            {cited.map((l, i) => (
              <Row key={l.at} kind="moment" lit={i === 0}>
                <PaletteMomentLine person={l.person} name={first(l.person)} made={l.made} time={clock(l.at)}>{marked(l.text, WORDS)}</PaletteMomentLine>
              </Row>
            ))}
            <PaletteCallHead cover={coverOf(PRICING)} title={PRICING.title} meta={PRICING.day} />
            {later && (
              <Row kind="moment">
                <PaletteMomentLine person={later.person} name={first(later.person)} time={clock(later.at)}>{later.text}</PaletteMomentLine>
              </Row>
            )}
          </PaletteGroup>
        </div>
      </Pane>
    );
  }
};

/** When no note says: the answer says so, and what it read. */
export const NoNoteSays: Story = {
  name: 'No note says',
  render: () => (
    <Pane>
      <PaletteBack onClick={did('results')}>Results</PaletteBack>
      <PaletteAnswer>None of your notes say. The answer reads every note you have, all {NOTE_COUNT} of them.</PaletteAnswer>
    </Pane>
  )
};
