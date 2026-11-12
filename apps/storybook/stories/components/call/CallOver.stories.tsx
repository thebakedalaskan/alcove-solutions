/*
 * CallOver: the page a call leaves you on, on the call's own night in both themes (Horizon moment `after`, the welcome page's
 * cove as its land). Who was in the call, or who's still in it, the title, one line, the notes and the buttons, the first one
 * filled; it never moves on by itself (docs/design/pages.md › After the call). A story per row of user-flows 7's table
 * (docs/product/user-flows.md › 7), with the notes as you left a call that goes on (on, paused or off), then the notes
 * turning and the page turning while you're on it, arriving from the call, a phone and the light theme. The app shows it in
 * place of the call, in Calls › Leaving and Journeys › 7.
 */
import { Button, CallOver, type CallOverNotes } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useArgs } from 'storybook/preview-api';
import { screen } from 'storybook/test';
import { did } from '../../../src/component';
import { AIKO, ART, DIEGO, ELENA, KOFI, LENA, MAYA, NADIA, OMAR, PRIYA, SAM, THEO } from '../../../src/world/people';

const TITLE = 'Team standup';
const EVERYONE = [ART, PRIYA, KOFI, MAYA];
const STILL = [PRIYA, KOFI, MAYA];
const TRUST = 'Confidential compute · verified';

const WRITING: CallOverNotes = { kind: 'writing', step: 'Writing the summary, decisions and follow-ups', who: 'Priya, Kofi, Maya and you get them.', faces: [PRIYA, KOFI, MAYA, ART] };
const WRITING_THEM: CallOverNotes = { kind: 'writing', step: 'Writing the summary, decisions and follow-ups', who: 'Everyone invited gets them, you included.', faces: [PRIYA, KOFI, MAYA, ART] };
const READY: CallOverNotes = {
  kind: 'ready', decided: 2, followUps: 3,
  summary: 'The new onboarding ships behind a flag on 12 November, and support gets the help article first. Kofi flagged two items still open on the launch checklist.'
};

/* The buttons, as the app gives them: large, the first one filled. */
const home = <Button variant="secondary" size="lg" icon="home" onClick={did('Go to Home')}>Go to Home</Button>;
const openNotes = <><Button variant="primary" size="lg" icon="notesPen" onClick={did('Open the notes')}>Open the notes</Button>{home}</>;
const readNotes = <><Button variant="primary" size="lg" icon="notesPen" onClick={did('Read the notes')}>Read the notes</Button>{home}</>;
const goHome = <Button variant="primary" size="lg" icon="home" onClick={did('Go to Home')}>Go to Home</Button>;
const rejoinOnly = <Button variant="primary" size="lg" icon="video" kb="J" onClick={did('Rejoin')}>Rejoin</Button>;
const rejoin = <>{rejoinOnly}{home}</>;

const meta = {
  title: 'Components/In a call/CallOver',
  component: CallOver,
  parameters: { layout: 'fullscreen' },
  args: {
    title: `${TITLE} has ended`, meta: '20 min with Priya, Kofi and Maya', people: EVERYONE, notes: WRITING, modelPrivate: true, trust: TRUST,
    actions: openNotes, entering: false, leaving: false, onEntered: did('onEntered'), onGone: did('onGone')
  },
  argTypes: {
    people: { control: false }, actions: { control: false }, notes: { control: 'object' },
    clock: { control: 'text' }, turn: { control: 'text' }, onEntered: { control: false }, onGone: { control: false }
  }
} satisfies Meta<typeof CallOver>;
export default meta;
type Story = StoryObj<typeof meta>;

/** You ended it, and notes were on: they're being written, the step they're on and who gets them. Open the notes is filled. */
export const EndedNotesWriting: Story = { name: 'You ended it, notes being written' };
/** Then they're written: the summary's first lines, what was decided and the follow-ups. Read the notes. */
export const EndedNotesReady: Story = { name: 'You ended it, notes written', args: { notes: READY, actions: readNotes } };
/** You ended it, and notes were never on: nothing to open, so Go to Home is the filled button. */
export const EndedNoNotes: Story = { name: 'You ended it, no notes', args: { notes: { kind: 'none' }, actions: goHome } };
/**
 * Whoever hosts ended it for everyone, and you get the notes. The line is the one you get when you end it, how long and who
 * with: the app can't tell who or what ended a call, so it never names anyone.
 */
export const EndedByHost: Story = { name: 'Whoever hosts ended it', args: { notes: WRITING_THEM } };
/** A guest, when whoever hosts ends it: no notes and nowhere to go, so nothing to press. */
export const EndedForAGuest: Story = { name: 'Ended, for a guest', args: { people: STILL, meta: 'Priya can share the notes with you.', notes: undefined, actions: undefined } };
/** You left, and it goes on: who's still in it, how long it's run (ticking), and Rejoin (J) straight back in. Notes were on. */
export const LeftItGoesOn: Story = {
  name: 'You left, it goes on',
  args: { title: `You left ${TITLE}`, meta: 'Priya, Kofi and Maya are still in it', people: STILL, notes: { kind: 'going', mode: 'on' }, actions: rejoin },
  render: function Render(args) { return <CallOver {...args} clock={useTicking(19 * 60 + 42)} />; }
};
/** Notes were paused as you left: you get what was written when it ends. */
export const LeftNotesPaused: Story = { ...LeftItGoesOn, name: 'You left, notes paused', args: { ...LeftItGoesOn.args, notes: { kind: 'going', mode: 'paused' } } };
/** Notes were on earlier and off as you left: you get what was written when it ends. */
export const LeftNotesOff: Story = { ...LeftItGoesOn, name: 'You left, notes off', args: { ...LeftItGoesOn.args, notes: { kind: 'going', mode: 'off' } } };
/** You hosted, and left it with Kofi: he hosts until you're back. */
export const LeftWithSomeone: Story = {
  name: 'You hosted, and left it with someone',
  args: { title: `You left ${TITLE}`, meta: 'Kofi is hosting until you’re back', people: STILL, notes: { kind: 'going', mode: 'on' }, actions: rejoin },
  render: function Render(args) { return <CallOver {...args} clock={useTicking(19 * 60 + 42)} />; }
};
/** You left, and it ended while you were on its page: the notes are being written. */
export const LeftThenEnded: Story = { name: 'You left, and it ended', args: { meta: 'It ended after you left.', notes: WRITING_THEM } };
/** The notes take long, or their progress can't be followed: they'll be in Calls. */
export const NotesSlow: Story = { name: 'The notes take long', args: { notes: { kind: 'slow' } } };
/** A guest who left: who's still in it, and Rejoin. A guest gets no notes and has no Home. */
export const GuestLeft: Story = {
  name: 'A guest left',
  args: { title: `You left ${TITLE}`, meta: 'Priya, Kofi and Maya are still in it', people: STILL, notes: undefined, actions: rejoinOnly },
  render: function Render(args) { return <CallOver {...args} clock={useTicking(19 * 60 + 42)} />; }
};

/** The notes written while you're on the page: the panel rises in again as what it says changes. */
export const NotesWritten: Story = {
  name: 'The notes are written while you wait',
  render: function Render(args) {
    const done = useLater(3200);
    return <CallOver {...args} notes={done ? READY : WRITING} actions={done ? readNotes : openNotes} />;
  }
};
/** The call you left ends while you're on its page: the page turns, and what it says rises in again. */
export const TurnsWhenItEnds: Story = {
  name: 'It ends while you’re here',
  args: { title: `You left ${TITLE}`, meta: 'Priya, Kofi and Maya are still in it', people: STILL, notes: { kind: 'going', mode: 'on' }, actions: rejoin },
  render: function Render(args) {
    const ended = useLater(3600);
    const clock = useTicking(19 * 60 + 42);
    return ended
      ? <CallOver {...args} turn="ended" title={`${TITLE} has ended`} meta="It ended after you left." people={EVERYONE} notes={WRITING_THEM} actions={openNotes} />
      : <CallOver {...args} turn="left" clock={clock} />;
  }
};
/** Arriving from the call: the night settles, the top fades in, and the words, the notes and the buttons rise in. Then onEntered. */
export const Arriving: Story = { name: 'Arriving from the call', args: { entering: true } };
/** Going on: Go to Home fades the page before the app moves on, which it does on onGone. */
export const GoingOn: Story = {
  name: 'Going on to Home',
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <CallOver {...args} actions={<>
        <Button variant="primary" size="lg" icon="notesPen" onClick={did('Open the notes')}>Open the notes</Button>
        <Button variant="secondary" size="lg" icon="home" onClick={() => { did('Go to Home')(); update({ leaving: true }); }}>Go to Home</Button>
      </>} />
    );
  },
  play: async ({ userEvent }) => {
    await new Promise((done) => { setTimeout(done, 1400); });
    await userEvent.click(await screen.findByRole('button', { name: 'Go to Home' }));
  }
};

/** The notes written by a model outside a secure enclave say so, with the Unencrypted badge. */
export const Unencrypted: Story = { name: 'An unencrypted model', args: { modelPrivate: false } };
/** Written by it. */
export const UnencryptedReady: Story = { name: 'An unencrypted model, written', args: { modelPrivate: false, notes: READY, actions: readNotes } };
/** A big call: the arches stop at eight, the last a count of the rest. A long title wraps. */
export const ABigCall: Story = {
  name: 'A big call',
  args: {
    title: 'Quarterly planning with product, design and engineering has ended', meta: '1 h 12 min with Priya, Kofi, Maya and 9 others',
    people: [ART, PRIYA, KOFI, MAYA, AIKO, LENA, SAM, DIEGO, THEO, NADIA, OMAR, ELENA]
  }
};

/** On a phone: one column at the top, the buttons across the foot in reach of a thumb. */
export const Phone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };
/** On a phone, written. */
export const PhoneReady: Story = { name: 'Phone, written', args: { notes: READY, actions: readNotes }, globals: { viewport: { value: 'phone', isRotated: false } } };
/** On a phone, after leaving: Rejoin across the foot. */
export const PhoneLeft: Story = {
  name: 'Phone, you left',
  args: { title: `You left ${TITLE}`, meta: 'Priya, Kofi and Maya are still in it', people: STILL, notes: { kind: 'going', mode: 'on' }, actions: rejoin },
  globals: { viewport: { value: 'phone', isRotated: false } },
  render: function Render(args) { return <CallOver {...args} clock={useTicking(19 * 60 + 42)} />; }
};
/** The light theme: the page stays night, as the call does. */
export const LightTheme: Story = { name: 'Light theme', globals: { theme: 'light' } };
/** The dark theme. */
export const DarkTheme: Story = { name: 'Dark theme', globals: { theme: 'dark' } };

/** How long the call has run, ticking from `from` seconds, as the app's clock reads it. */
function useTicking(from: number): string {
  const [s, setS] = useState(from);
  useEffect(() => {
    const t = setInterval(() => setS((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m % 60)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

/** True once `ms` have gone by since the story opened. */
function useLater(ms: number): boolean {
  const [now, setNow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setNow(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return now;
}
