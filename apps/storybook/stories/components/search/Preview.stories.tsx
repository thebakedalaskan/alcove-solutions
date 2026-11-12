/*
 * The palette's preview: beside the list on a wide screen, it shows what the lit row is (PalettePreview), and scrolls,
 * with what to do pinned at its foot, the one filled button first with ↵ on it. A moment: its call (PalettePreviewHead),
 * the decision or follow-up made there (PaletteMade), and the transcript around it, the moment warm (PaletteExcerpt,
 * PaletteExcerptLine). Someone: PalettePersonPreview. A note: its head and summary (PaletteSummary). Ask: the question
 * (PaletteAskPreview). See all: the words, and what Notes will show (PaletteAllPreview).
 */
import {
  Button, PaletteAllPreview, PaletteAskPreview, PaletteExcerpt, PaletteExcerptLine, PaletteMade, PalettePersonPreview, PalettePreview,
  PalettePreviewHead, PaletteSummary
} from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { did } from '../../../src/component';
import { KOFI, MAYA } from '../../../src/world/people';
import { ARTS_CALL, NOTE_COUNT, PRICING, STANDUP, clock, first, marked, type Call } from './parts';

/** The preview pane of the window, on its own. */
const Pane = ({ children }: { children: ReactNode }) => <div className="sbc-pane is-preview">{children}</div>;

/** The transcript around the moment at `at`: one line before it, the moment, three after. */
function Around({ call, at, words }: { call: Call; at: number; words: readonly string[] }) {
  const i = Math.max(0, call.said.findIndex((l) => l.at === at));
  const from = Math.max(0, Math.min(i - 1, call.said.length - 5));
  return (
    <PaletteExcerpt>
      {call.said.slice(from, from + 5).map((l) => (
        <PaletteExcerptLine key={l.at} time={clock(l.at)} person={l.person} name={first(l.person)} lit={l.at === at}>{marked(l.text, words)}</PaletteExcerptLine>
      ))}
    </PaletteExcerpt>
  );
}

/** Open at and Play from, for a moment: the one filled button, with ↵ on it. */
const momentActions = (at: number) => (
  <>
    <Button variant="primary" size="sm" kb="↵" onClick={did('open at')}>Open at {clock(at)}</Button>
    <Button size="sm" icon="play" onClick={did('play from')}>Play from {clock(at)}</Button>
  </>
);

const meta = {
  title: 'Components/Search/Preview',
  parameters: { layout: 'centered' }
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A moment where a decision was made that's still waiting: the call, the decision with Confirm and It wasn't decided, and
 * the transcript around it with the moment lit. Open at 3:15 and Play from 3:15 are pinned at the foot.
 */
export const MomentWithADecision: Story = {
  name: 'Moment, with a decision',
  render: () => (
    <Pane>
      <PalettePreview actions={momentActions(195)}>
        <PalettePreviewHead title={STANDUP.title} meta={`${STANDUP.when} · ${STANDUP.length}`} people={STANDUP.people} />
        <PaletteMade kind="decision" text="The new onboarding ships behind a flag on 12 November." state="Waiting for you to confirm">
          <Button size="sm" onClick={did('confirm')}>Confirm</Button>
          <Button variant="quiet" size="sm" onClick={did('not decided')}>It wasn’t decided</Button>
        </PaletteMade>
        <Around call={STANDUP} at={195} words={['flag']} />
      </PalettePreview>
    </Pane>
  )
};

/** A moment a follow-up rests on: whose it is and when it's due, with nothing to confirm. */
export const MomentWithAFollowUp: Story = {
  name: 'Moment, with a follow-up',
  render: () => (
    <Pane>
      <PalettePreview actions={momentActions(380)}>
        <PalettePreviewHead title={STANDUP.title} meta={`${STANDUP.when} · ${STANDUP.length}`} people={STANDUP.people} />
        <PaletteMade kind="follow-up" text="Write the help article for support" state="Priya’s, due Friday" />
        <Around call={STANDUP} at={380} words={['article']} />
      </PalettePreview>
    </Pane>
  )
};

/** A confirmed decision: who confirmed it, and nothing to do. */
export const MomentConfirmed: Story = {
  name: 'Moment, decision confirmed',
  render: () => (
    <Pane>
      <PalettePreview actions={momentActions(768)}>
        <PalettePreviewHead title={PRICING.title} meta={`${PRICING.when} · ${PRICING.length}`} people={PRICING.people} />
        <PaletteMade kind="decision" text="The team plan gets a monthly option." state="Confirmed by Maya" />
        <Around call={PRICING} at={768} words={['monthly']} />
      </PalettePreview>
    </Pane>
  )
};

/** A moment that's just a line: the call and the transcript around it. Without the audio, only Open at. */
export const Moment: Story = {
  render: () => (
    <Pane>
      <PalettePreview actions={<Button variant="primary" size="sm" kb="↵" onClick={did('open at')}>Open at {clock(156)}</Button>}>
        <PalettePreviewHead title={STANDUP.title} meta={`${STANDUP.when} · ${STANDUP.length}`} people={STANDUP.people} />
        <Around call={STANDUP} at={156} words={[]} />
      </PalettePreview>
    </Pane>
  )
};

/** Someone: their arch, name and title, your calls together, and the latest they said, with the call and when. */
export const Person: Story = {
  render: () => (
    <Pane>
      <PalettePreview actions={<>
        <Button variant="primary" size="sm" kb="↵" onClick={did('what maya said')}>What Maya said</Button>
        <Button size="sm" onClick={did('calls with maya')}>Calls with Maya</Button>
      </>}>
        <PalettePersonPreview person={MAYA} title="Finance" meta="4 calls together, most recently today" saidLabel="Latest from Maya"
          said={STANDUP.said.filter((l) => l.person === MAYA).map((l) => ({ key: `${STANDUP.id}-${l.at}`, call: STANDUP.title, time: clock(l.at), text: l.text }))} />
      </PalettePreview>
    </Pane>
  )
};

/** Someone who hasn't said anything in your notes yet: only your calls together. */
export const PersonWhoHasntSpoken: Story = {
  name: 'Person, nothing said yet',
  render: () => (
    <Pane>
      <PalettePreview actions={<>
        <Button variant="primary" size="sm" kb="↵" onClick={did('what kofi said')}>What Kofi said</Button>
        <Button size="sm" onClick={did('calls with kofi')}>Calls with Kofi</Button>
      </>}>
        <PalettePersonPreview person={KOFI} title="Design lead" meta="1 call together, on Monday" saidLabel="Latest from Kofi" said={[]} />
      </PalettePreview>
    </Pane>
  )
};

/** A note: its title, when and how long, its people, its summary, and what's waiting in it. */
export const Note: Story = {
  render: () => (
    <Pane>
      <PalettePreview actions={<Button variant="primary" size="sm" kb="↵" onClick={did('open notes')}>Open notes</Button>}>
        <PalettePreviewHead title={ARTS_CALL.title} meta={`${ARTS_CALL.when} · ${ARTS_CALL.length}`} people={ARTS_CALL.people} />
        <PaletteSummary confirm={ARTS_CALL.confirm} followUps={ARTS_CALL.followUps}>{ARTS_CALL.summary}</PaletteSummary>
      </PalettePreview>
    </Pane>
  )
};

/** Ask: the question, and where the answer comes from. ↵ asks when it's lit, Tab when it isn't. */
export const Ask: Story = {
  render: () => (
    <Pane>
      <PalettePreview actions={<Button variant="primary" size="sm" kb="↵" onClick={did('ask')}>Ask</Button>}>
        <PaletteAskPreview question="When does onboarding ship?">The answer reads all {NOTE_COUNT} of your notes, and points to the moments it comes from.</PaletteAskPreview>
      </PalettePreview>
    </Pane>
  )
};

/** See all: the words, and what Notes shows for them. */
export const SeeAll: Story = {
  name: 'See all',
  render: () => (
    <Pane>
      <PalettePreview actions={<Button variant="primary" size="sm" kb="↵" onClick={did('see all')}>See all in Notes</Button>}>
        <PaletteAllPreview words="flag">9 moments in 4 calls, each under its note. Notes can narrow them to someone, or to calls, the room and what was shared with you.</PaletteAllPreview>
      </PalettePreview>
    </Pane>
  )
};
