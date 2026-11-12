/*
 * The palette's window, put together from its parts as the app puts it together: a Sheet (className="pal") over its own
 * veil (overlayClassName="pal-scrim"), solid night dimming the page without a blur. The line on the window, the list and,
 * on a wide screen, the preview of what's lit beside it, then the foot. 1000 × 640 with a preview, never taller than the
 * room under its top margin; under 1100px 680 wide with the list alone; at 860px and under the whole screen, with Cancel.
 * A window with nothing to preview (the first day, offline, Pin a note) is the narrow one.
 */
import {
  Button, PaletteAllLine, PaletteAnswer, PaletteAskLine, PaletteAskPreview, PaletteBack, PaletteBody, PaletteExcerpt, PaletteExcerptLine,
  PaletteFoot, PaletteGroup, PaletteLine, PaletteMade, PaletteMomentLine, PaletteNoteLine, PalettePeople, PalettePersonLine, PalettePersonPreview,
  PalettePin, PalettePreview, PalettePreviewHead, PaletteSummary, PaletteToken, PaletteCallHead, Sheet, type PaletteKeys
} from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { did } from '../../../src/component';
import { MAYA } from '../../../src/world/people';
import {
  ARTS_CALL, CallMoments, DESIGN, INTERVIEW, LAUNCH, Listbox, NOTES, NOTE_COUNT, Nothing, PEOPLE, PRICING, Row, SaidGroup, STANDUP, clock, coverOf,
  first, found, marked, noteLine, type Call
} from './parts';

const FIND = 'Search everything said, or ask a question';

const keys = (enter: string, tab: boolean, esc = 'Close'): PaletteKeys[] => [
  { keys: ['↑', '↓'], label: 'Move' },
  { keys: ['↵'], label: enter },
  ...(tab ? [{ keys: ['Tab'], label: 'Ask' }] : []),
  { keys: ['esc'], label: esc }
];

/** The window, open over the page, as the app opens it. */
function Window({ label = 'Search or ask', children }: { label?: string | undefined; children: ReactNode }) {
  return <Sheet open onOpenChange={did('onOpenChange')} label={label} className="pal" overlayClassName="pal-scrim">{children}</Sheet>;
}
/** The line's input. The window selects what's in it as it takes focus; the caret goes to the end, as after typing. */
const Input = ({ value, placeholder = FIND }: { value?: string | undefined; placeholder?: string | undefined }) => (
  <input className="pal-in" defaultValue={value} placeholder={placeholder} aria-label="Search or ask your notes" role="combobox" aria-expanded="true" aria-autocomplete="list" autoComplete="off" spellCheck={false}
    ref={(el) => { if (el) requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length)); }} />
);
const OnlyYou = ({ enter, tab }: { enter: string; tab: boolean }) => <PaletteFoot keys={keys(enter, tab)}>Only you can see what you search.</PaletteFoot>;
const Sealed = ({ enter = 'Ask', esc = 'Close' }: { enter?: string | undefined; esc?: string | undefined }) => (
  <PaletteFoot sealed keys={keys(enter, false, esc)}>Answers are written in confidential compute, from your notes only.</PaletteFoot>
);

/** The preview of a moment: its call, what was made there, and the transcript around it, with Open at and Play from. */
function MomentPreview({ call, at, words }: { call: Call; at: number; words: readonly string[] }) {
  const i = Math.max(0, call.said.findIndex((l) => l.at === at));
  const from = Math.max(0, Math.min(i - 1, call.said.length - 5));
  const line = call.said[i];
  return (
    <PalettePreview actions={<>
      <Button variant="primary" size="sm" kb="↵" onClick={did('open at')}>Open at {clock(at)}</Button>
      <Button size="sm" icon="play" onClick={did('play from')}>Play from {clock(at)}</Button>
    </>}>
      <PalettePreviewHead title={call.title} meta={`${call.when} · ${call.length}`} people={call.people} />
      {line?.made === 'decision' && at === 195 && (
        <PaletteMade kind="decision" text="The new onboarding ships behind a flag on 12 November." state="Waiting for you to confirm">
          <Button size="sm" onClick={did('confirm')}>Confirm</Button>
          <Button variant="quiet" size="sm" onClick={did('not decided')}>It wasn’t decided</Button>
        </PaletteMade>
      )}
      <PaletteExcerpt>
        {call.said.slice(from, from + 5).map((l) => (
          <PaletteExcerptLine key={l.at} time={clock(l.at)} person={l.person} name={first(l.person)} lit={l.at === at}>{marked(l.text, words)}</PaletteExcerptLine>
        ))}
      </PaletteExcerpt>
    </PalettePreview>
  );
}

/** What a word finds: Ask first, then every moment with it, call by call, then See all. */
function WordFound({ words, lit }: { words: readonly string[]; lit: number }) {
  const calls = [STANDUP, PRICING, DESIGN, LAUNCH].filter((c) => found(c, words).length > 0);
  return (
    <Listbox label="Results">
      <Row kind="ask"><PaletteAskLine text={words.join(' ')} keyLabel="Tab" /></Row>
      <SaidGroup label="What was said" calls={calls} words={words}>
        {calls.map((c, i) => <CallMoments key={c.id} call={c} words={words} lit={i === 0 ? lit : undefined} shown={i === 0 ? 3 : 2} />)}
      </SaidGroup>
      <Row kind="all"><PaletteAllLine>See all {calls.reduce((n, c) => n + found(c, words).length, 0)} moments in Calls</PaletteAllLine></Row>
    </Listbox>
  );
}

const meta = {
  title: 'Components/Search/Window',
  parameters: { layout: 'fullscreen' }
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** A word: each match is a moment, who said it and when; the lit one is a decision still waiting, beside its transcript. */
export const AWord: Story = {
  name: 'A word',
  render: () => (
    <Window>
      <PaletteLine onCancel={did('cancel')}><Input value="flag" /></PaletteLine>
      <PaletteBody preview={<MomentPreview call={STANDUP} at={195} words={['flag']} />}><WordFound words={['flag']} lit={195} /></PaletteBody>
      <OnlyYou enter="Open" tab />
    </Window>
  )
};

/** Before you type: the people you meet most, then your recent notes, the newest lit and previewed. */
export const BeforeYouType: Story = {
  name: 'Before you type',
  render: () => (
    <Window>
      <PaletteLine onCancel={did('cancel')}><Input /></PaletteLine>
      <PaletteBody preview={
        <PalettePreview actions={<Button variant="primary" size="sm" kb="↵" onClick={did('open notes')}>Open notes</Button>}>
          <PalettePreviewHead title={ARTS_CALL.title} meta={`${ARTS_CALL.when} · ${ARTS_CALL.length}`} people={ARTS_CALL.people} />
          <PaletteSummary confirm={ARTS_CALL.confirm} followUps={ARTS_CALL.followUps}>{ARTS_CALL.summary}</PaletteSummary>
        </PalettePreview>
      }>
        <PalettePeople label="People" people={PEOPLE.map((p) => ({ person: p, first: first(p), onPick: did(`pick ${first(p)}`) }))} />
        <Listbox label="Recent notes"><RecentNotes /></Listbox>
      </PaletteBody>
      <OnlyYou enter="Open" tab={false} />
    </Window>
  )
};
function RecentNotes() {
  return (
    <PaletteGroup label="Recent notes">
      {NOTES.slice(0, 5).map((n, i) => <Row key={n.id} kind="note" lit={i === 0}><PaletteNoteLine cover={coverOf(n)} room={n.room} title={n.title} meta={noteLine(n)} /></Row>)}
    </PaletteGroup>
  );
}

/** A name: Maya first, as someone, then every moment she spoke; her preview shows the latest she said. */
export const AName: Story = {
  name: 'A name',
  render: () => {
    const hers = (c: Call): Call => ({ ...c, said: c.said.filter((l) => l.person === MAYA) });
    return (
      <Window>
        <PaletteLine onCancel={did('cancel')}><Input value="maya" /></PaletteLine>
        <PaletteBody preview={
          <PalettePreview actions={<>
            <Button variant="primary" size="sm" kb="↵" onClick={did('what maya said')}>What Maya said</Button>
            <Button size="sm" onClick={did('calls with maya')}>Calls with Maya</Button>
          </>}>
            <PalettePersonPreview person={MAYA} title="Finance" meta="4 calls together, most recently today" saidLabel="Latest from Maya"
              said={hers(STANDUP).said.map((l) => ({ key: `${l.at}`, call: STANDUP.title, time: clock(l.at), text: l.text }))} />
          </PalettePreview>
        }>
          <Listbox label="Results">
            <Row kind="ask"><PaletteAskLine text="maya" keyLabel="Tab" /></Row>
            <PaletteGroup label="People">
              <Row kind="person" lit><PalettePersonLine person={MAYA} name={marked(MAYA.name, ['maya'])} meta="Finance · 4 calls" /></Row>
            </PaletteGroup>
            <PaletteGroup label="What was said" count="6 moments in 2 calls">
              <CallMoments call={hers(STANDUP)} words={[]} shown={3} markName />
              <CallMoments call={hers(PRICING)} words={[]} shown={2} />
            </PaletteGroup>
          </Listbox>
        </PaletteBody>
        <OnlyYou enter="Pick" tab />
      </Window>
    );
  }
};

/** Someone's words: Maya's token in the line, and only what she said, a word narrowing it. */
export const SomeonesWords: Story = {
  name: 'Someone’s words',
  render: () => {
    const hers = (c: Call): Call => ({ ...c, said: c.said.filter((l) => l.person === MAYA) });
    return (
      <Window>
        <PaletteLine token={<PaletteToken person={MAYA} name="Maya" clearLabel="Show everyone" onClear={did('clear')} />} onCancel={did('cancel')}>
          <Input placeholder="Search what Maya said" />
        </PaletteLine>
        <PaletteBody preview={<MomentPreview call={STANDUP} at={156} words={[]} />}>
          <Listbox label="What Maya said">
            <PaletteGroup label="What Maya said" count="6 moments in 2 calls">
              <CallMoments call={hers(STANDUP)} words={[]} lit={156} />
              <CallMoments call={hers(PRICING)} words={[]} shown={2} />
            </PaletteGroup>
          </Listbox>
        </PaletteBody>
        <OnlyYou enter="Open" tab={false} />
      </Window>
    );
  }
};

/** A question: Ask is lit, so Enter asks; the moments with its words follow. The foot says where answers are written. */
export const AQuestion: Story = {
  name: 'A question',
  render: () => (
      <Window>
        <PaletteLine ask onCancel={did('cancel')}><Input value="When does onboarding ship?" /></PaletteLine>
        <PaletteBody preview={
          <PalettePreview actions={<Button variant="primary" size="sm" kb="↵" onClick={did('ask')}>Ask</Button>}>
            <PaletteAskPreview question="When does onboarding ship?">The answer reads all {NOTE_COUNT} of your notes, and points to the moments it comes from.</PaletteAskPreview>
          </PalettePreview>
        }>
          <Listbox label="Results">
            <Row kind="ask" lit><PaletteAskLine text="When does onboarding ship?" keyLabel="↵" /></Row>
            <SaidGroup label="Moments with these words" calls={[STANDUP, LAUNCH]} words={['onboarding']}>
              <CallMoments call={STANDUP} words={['onboarding']} />
              <CallMoments call={LAUNCH} words={['onboarding']} />
            </SaidGroup>
            <Row kind="all"><PaletteAllLine>Open these in Calls</PaletteAllLine></Row>
          </Listbox>
        </PaletteBody>
        <Sealed />
      </Window>
  )
};

/** Answered: the answer in place of the list, the moments it comes from under their calls, the lit one beside it. */
export const Answered: Story = {
  render: () => {
    const words = ['onboarding', 'ships'];
    const cited = STANDUP.said.filter((l) => l.at === 195 || l.at === 362);
    const later = PRICING.said.find((l) => l.at === 1695);
    return (
      <Window>
        <PaletteLine ask onCancel={did('cancel')}><Input value="When does onboarding ship?" /></PaletteLine>
        <PaletteBody preview={<MomentPreview call={STANDUP} at={195} words={words} />}>
          <PaletteBack onClick={did('results')}>Results</PaletteBack>
          <PaletteAnswer>The new onboarding ships behind a flag on 12 November, and support gets the help article first. The launch itself moves to the 18th, so the flag has a week to settle, and the monthly option stays behind a flag until then. The 12 November date is still waiting for someone to confirm it.</PaletteAnswer>
          <Listbox label="From your notes">
            <PaletteGroup label="From your notes" count="3 moments">
              <PaletteCallHead cover={coverOf(STANDUP)} title={STANDUP.title} meta={STANDUP.day} />
              {cited.map((l, i) => (
                <Row key={l.at} kind="moment" lit={i === 0}><PaletteMomentLine person={l.person} name={first(l.person)} made={l.made} time={clock(l.at)}>{marked(l.text, words)}</PaletteMomentLine></Row>
              ))}
              <PaletteCallHead cover={coverOf(PRICING)} title={PRICING.title} meta={PRICING.day} />
              {later && <Row kind="moment"><PaletteMomentLine person={later.person} name={first(later.person)} time={clock(later.at)}>{later.text}</PaletteMomentLine></Row>}
            </PaletteGroup>
          </Listbox>
        </PaletteBody>
        <Sealed enter="Open" esc="Back" />
      </Window>
    );
  }
};

/** Reading: the dots while the answer is written. */
export const Asking: Story = {
  render: () => (
    <Window>
      <PaletteLine ask onCancel={did('cancel')}><Input value="When does onboarding ship?" /></PaletteLine>
      <PaletteBody>
        <PaletteBack onClick={did('results')}>Results</PaletteBack>
        <PaletteAnswer reading>Reading your notes</PaletteAnswer>
      </PaletteBody>
      <Sealed esc="Back" />
    </Window>
  )
};

/** Nothing matches: it says what it looked through, and Ask is lit above it. */
export const NothingMatches: Story = {
  name: 'Nothing matches',
  render: () => (
    <Window>
      <PaletteLine ask onCancel={did('cancel')}><Input value="cake" /></PaletteLine>
      <PaletteBody preview={
        <PalettePreview actions={<Button variant="primary" size="sm" kb="↵" onClick={did('ask')}>Ask</Button>}>
          <PaletteAskPreview question="cake">The answer reads all {NOTE_COUNT} of your notes, and points to the moments it comes from.</PaletteAskPreview>
        </PalettePreview>
      }>
        <Listbox label="Results"><Row kind="ask" lit><PaletteAskLine text="cake" keyLabel="↵" /></Row></Listbox>
        <Nothing icon="search" title="Nothing matches “cake”">Search looked through the names, titles, summaries, decisions, follow-ups and everything said in all {NOTE_COUNT} of your notes.</Nothing>
      </PaletteBody>
      <Sealed />
    </Window>
  )
};

/** The search didn't go through: caution, Try again, and Ask still works. */
export const Failed: Story = {
  render: () => (
    <Window>
      <PaletteLine ask onCancel={did('cancel')}><Input value="flag" /></PaletteLine>
      <PaletteBody preview={
        <PalettePreview actions={<Button variant="primary" size="sm" kb="↵" onClick={did('ask')}>Ask</Button>}>
          <PaletteAskPreview question="flag">The answer reads all {NOTE_COUNT} of your notes, and points to the moments it comes from.</PaletteAskPreview>
        </PalettePreview>
      }>
        <Listbox label="Results"><Row kind="ask" lit><PaletteAskLine text="flag" keyLabel="↵" /></Row></Listbox>
        <Nothing caution icon="alert" title="The search didn’t go through" action={<Button size="sm" icon="retry" onClick={did('try again')}>Try again</Button>}>Try again, or ask instead.</Nothing>
      </PaletteBody>
      <Sealed />
    </Window>
  )
};

/** The first day: the narrow window, with nothing to search yet. */
export const FirstDay: Story = {
  name: 'First day',
  render: () => (
    <Window>
      <PaletteLine onCancel={did('cancel')}><Input /></PaletteLine>
      <PaletteBody>
        <Nothing icon="mic" title="Nothing to search yet">After your first call with notes on, everything said in it can be found here: who said it, and when.</Nothing>
      </PaletteBody>
      <OnlyYou enter="Open" tab={false} />
    </Window>
  )
};

/** Offline: the narrow window. */
export const Offline: Story = {
  render: () => (
    <Window>
      <PaletteLine onCancel={did('cancel')}><Input value="flag" /></PaletteLine>
      <PaletteBody>
        <Nothing icon="wifiOff" title="You’re offline">Search needs a connection. It works again as soon as you’re back.</Nothing>
      </PaletteBody>
      <OnlyYou enter="Open" tab={false} />
    </Window>
  )
};

/** Pin a note: the narrow window, with its own line, rows and foot. */
export const PinANote: Story = {
  name: 'Pin a note',
  render: () => {
    return (
      <Window label="Pin a note">
        <PaletteLine icon="pin" onCancel={did('cancel')}><Input placeholder="Find a note to pin" /></PaletteLine>
        <PaletteBody>
          <div role="listbox" aria-label="Notes" aria-multiselectable="true">
            <PaletteGroup label="Pinned">
              <Row kind="note"><PaletteNoteLine cover={coverOf(STANDUP)} title={STANDUP.title} meta={noteLine(STANDUP)} end={<PalettePin pinned label="Unpin" />} /></Row>
            </PaletteGroup>
            <PaletteGroup label="Recent notes">
              {[ARTS_CALL, PRICING, DESIGN, INTERVIEW].map((n, i) => (
                <Row key={n.id} kind="note" lit={i === 0}><PaletteNoteLine cover={coverOf(n)} room={n.room} title={n.title} meta={noteLine(n)} end={<PalettePin pinned={false} label="Pin" />} /></Row>
              ))}
            </PaletteGroup>
          </div>
        </PaletteBody>
        <PaletteFoot icon="pin" action={<Button variant="primary" size="sm" onClick={did('done')}>Done</Button>}>Pinned notes stay in the side panel, in the order you pin them.</PaletteFoot>
      </Window>
    );
  }
};

/** A tablet: the same word, the list alone, 680 wide. */
export const OnATablet: Story = {
  ...AWord,
  name: 'A word, on a tablet',
  globals: { viewport: { value: 'tablet', isRotated: false } }
};

/** A phone: the window takes the screen, Cancel replaces esc, and there are no keys. */
export const OnAPhone: Story = {
  ...AWord,
  name: 'A word, on a phone',
  globals: { viewport: { value: 'phone', isRotated: false } }
};
