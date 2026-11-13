/*
 * When the palette has nothing to list: the kit's EmptyState with the palette's art (a dashed arch around an icon) and
 * className="pal-none", a title, one line, and the way on.
 * Nothing matches, with Ask lit above it; someone in the line who said nothing you can read, with their calls in Calls;
 * the first day, before any call with notes; a search that didn't go through, in caution, with Try again; and offline.
 * While a search has no list yet to keep dimmed, dots (PaletteWaiting).
 */
import { Button, PaletteAskLine, PaletteWaiting } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { did } from '../../../src/component';
import { NOTE_COUNT, Nothing, Row } from './parts';

/** The list pane of the window, on its own. */
const Pane = ({ children }: { children: ReactNode }) => <div className="sbc-pane">{children}</div>;

const meta = {
  title: 'Components/Search/Empty states',
  parameters: { layout: 'centered' }
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing has the word: it says what it looked through, and Ask is lit above it. */
export const NothingMatches: Story = {
  name: 'Nothing matches',
  render: () => (
    <Pane>
      <Row kind="ask" lit><PaletteAskLine text="cake" keyLabel="↵" /></Row>
      <Nothing icon="search" title="Nothing matches “cake”">
        Search looked through the names, titles, summaries, decisions, follow-ups and everything said in all {NOTE_COUNT} of your notes.
      </Nothing>
    </Pane>
  )
};

/** Someone in the line who said nothing you can read: no list, and Calls with Theo opens Calls with the calls you’re both on. */
export const SomeoneWhoSaidNothing: Story = {
  name: 'Someone who said nothing',
  render: () => (
    <Pane>
      <Nothing icon="quote" title="Nothing Theo said is in your notes" action={<Button variant="quiet" size="sm" onClick={did('calls with theo')}>Calls with Theo</Button>}>
        Calls with Theo lists the calls you’re both on.
      </Nothing>
    </Pane>
  )
};

/** The first day: nothing to search yet. */
export const FirstDay: Story = {
  name: 'First day',
  render: () => (
    <Pane>
      <Nothing icon="mic" title="Nothing to search yet">After your first call with notes on, everything said in it can be found here: who said it, and when.</Nothing>
    </Pane>
  )
};

/** The search didn't go through: caution, Try again, and Ask still works. */
export const Failed: Story = {
  render: () => (
    <Pane>
      <Row kind="ask" lit><PaletteAskLine text="flag" keyLabel="↵" /></Row>
      <Nothing caution icon="alert" title="The search didn’t go through" action={<Button size="sm" icon="retry" onClick={did('try again')}>Try again</Button>}>
        Try again, or ask instead.
      </Nothing>
    </Pane>
  )
};

/** Offline: search needs a connection. */
export const Offline: Story = {
  render: () => (
    <Pane>
      <Nothing icon="wifiOff" title="You’re offline">Search needs a connection. It works again as soon as you’re back.</Nothing>
    </Pane>
  )
};

/** Searching, with no list yet to keep dimmed. */
export const Searching: Story = {
  render: () => <Pane><PaletteWaiting label="Searching" /></Pane>
};
