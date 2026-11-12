/*
 * YouMenu: what your face at the top right opens. You, standing on the horizon in the last of the light (Settings' moment,
 * in small), your name and address beside you, then its rows: Pause notifications (YouPause), whose choices open in place
 * under it and which, once paused, says until when with Resume at its end; Theme (YouTheme), the three small evenings; a
 * hairline (YouRule); Settings, a link (YouLink), and Take the tour (YouRow); a hairline; Sign out. When signing out would
 * delete something on this device, its question takes the rows' place (YouAsk), with Stay signed in the filled one. ↓ and
 * ↑ move between everything in it, and Escape steps back one thing at a time. A popover under your face on a wide screen;
 * on a phone the same menu fills the kit's Sheet (`sheet`), rising from the foot of the window. Each story changes as it's
 * pressed.
 */
import { Popover, Sheet, YouAsk, YouButton, YouLink, YouMenu, YouPause, YouRow, YouRule, YouTheme, type AvatarPerson, type ThemeChoice } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState, type ReactElement } from 'react';
import { PopSurface, did } from '../../../src/component';
import { ART } from '../../../src/world/people';

/** It's 16:12, so an hour's pause ends at 17:12. */
const CHOICES: readonly { id: string; label: string; ends: string }[] = [
  { id: 'm30', label: 'For 30 minutes', ends: '16:42' },
  { id: 'h1', label: 'For 1 hour', ends: '17:12' },
  { id: 'tomorrow', label: 'Until tomorrow', ends: '9:00' }
];
/** Until when a choice pauses, as the row says it. */
const until = (id: string): string => (id === 'tomorrow' ? 'tomorrow 9:00' : CHOICES.find((c) => c.id === id)?.ends ?? '17:12');

/** What would be deleted: recordings on this device that haven't uploaded, something written that hasn't reached Alcove, or both. */
type Waiting = 'recordings' | 'words' | 'both';
const STAY_RECORDINGS = 'Stay signed in and they upload by themselves once you’re online, then the notes are written.';
const STAY_WORDS = 'Stay signed in and it stays here until it can go, or copy it first: only your own words come with it.';
/** What signing out asks, in the words Settings' sky uses (features/settings/SignOut.tsx). */
const ASKS: Record<Waiting, { says: string; lines: readonly string[]; signOutLabel: string }> = {
  recordings: { says: '2 recordings on this device haven’t uploaded. Signing out deletes them.', lines: [STAY_RECORDINGS], signOutLabel: 'Sign out and delete them' },
  words: { says: 'Something you wrote hasn’t reached Alcove yet. Signing out deletes it from this browser.', lines: [STAY_WORDS], signOutLabel: 'Sign out and delete it' },
  both: { says: '2 recordings on this device haven’t uploaded, and something you wrote hasn’t reached Alcove. Signing out deletes them.', lines: [STAY_RECORDINGS, STAY_WORDS], signOutLabel: 'Sign out and delete them' }
};

/** Someone whose name and address are longer than the menu. */
const LONG: AvatarPerson = { ...ART, name: 'Art Vandelay-Featherstonehaugh', email: 'art.vandelay-featherstonehaugh@vandelay-import-export.industries' };

/** How a story's menu opens: the pause's choices open, or paused; a theme; what's waiting when Sign out is pressed, and asking. */
interface Start {
  pause?: 'open' | 'h1' | 'tomorrow' | undefined;
  theme?: ThemeChoice | undefined;
  waiting?: Waiting | undefined;
  asking?: boolean | undefined;
  copying?: boolean | undefined;
  signingOut?: boolean | undefined;
}

/**
 * The menu as the app puts it together, changing as it's pressed: pausing and resuming, the theme, and Sign out, which asks
 * when something is waiting on this device. Back from the question, focus goes to Sign out. With it, what the popover or
 * sheet round it takes, as the app gives them: `open` and `onOpenChange`, so it holds still while signing out and opens on
 * its rows with the choices shut, and `onEscapeKeyDown`, so Escape steps back one thing at a time before it closes
 * (signing out, nothing; asking, back to the rows; the choices open, shut).
 */
function useMenu(person: AvatarPerson, sheet: boolean, start: Start): {
  menu: ReactElement; open: boolean; onOpenChange: (open: boolean) => void; onEscapeKeyDown: (e: KeyboardEvent) => void;
} {
  const [open, setOpen] = useState(true);
  const [choosing, setChoosing] = useState(start.pause === 'open');
  const [paused, setPaused] = useState<string | null>(start.pause === 'h1' || start.pause === 'tomorrow' ? until(start.pause) : null);
  const [theme, setTheme] = useState<ThemeChoice>(start.theme ?? 'system');
  const [asking, setAsking] = useState(start.asking ?? false);
  const [back, setBack] = useState(false);
  const [copying, setCopying] = useState(start.copying ?? false);
  const [pending, setPending] = useState(start.signingOut ?? false);
  // A copy pressed here takes a moment; one the story opens on stays, to be seen.
  const [copied, setCopied] = useState(0);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopying(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);
  const waiting = start.waiting ?? 'recordings';
  const stay = () => { did('onStay')(); setAsking(false); setBack(true); };
  const onOpenChange = (next: boolean) => {
    if (!next && pending) return;
    did('onOpenChange')(next);
    setOpen(next);
    setChoosing(false);
    setAsking(false);
    setBack(false);
  };
  const onEscapeKeyDown = (e: KeyboardEvent) => {
    if (pending) e.preventDefault();
    else if (asking) { e.preventDefault(); stay(); }
    else if (choosing && paused === null) { e.preventDefault(); did('onOpenChange')(false); setChoosing(false); }
  };
  const menu = asking ? (
    <YouMenu person={person} sheet={sheet}>
      <YouAsk {...ASKS[waiting]} copying={copying} pending={pending} onStay={stay}
        onCopy={waiting === 'recordings' ? undefined : () => { did('onCopy')(); setCopying(true); setCopied((n) => n + 1); }}
        onSignOut={() => { did('onSignOut')(); setPending(true); }} />
    </YouMenu>
  ) : (
    <YouMenu person={person} sheet={sheet}>
      <YouPause until={paused} open={choosing} choices={CHOICES}
        onOpenChange={(o) => { did('onOpenChange')(o); setChoosing(o); }}
        onPause={(id) => { did('onPause')(id); setPaused(until(id)); setChoosing(false); }}
        onResume={() => { did('onResume')(); setPaused(null); setChoosing(false); }} />
      <YouTheme theme={theme} onChange={(t) => { did('onTheme')(t); setTheme(t); }} />
      <YouRule />
      <YouLink icon="settings" label="Settings" link={(p) => <a href="#settings" {...p} onClick={(e) => { e.preventDefault(); did('onSettings')(); }} />} />
      <YouRow icon="compass" label="Take the tour" onClick={did('onTour')} />
      <YouRule />
      <YouRow icon="signOut" label="Sign out" autoFocus={back} onClick={() => { did('onSignOut')(); if (start.waiting) setAsking(true); }} />
    </YouMenu>
  );
  return { menu, open, onOpenChange, onEscapeKeyDown };
}

/** The menu by itself, on a popover's surface. With nothing round it to hear Escape, Stay signed in goes back to the rows. */
function Menu({ person, sheet = false, start }: { person: AvatarPerson; sheet?: boolean | undefined; start: Start }) {
  return useMenu(person, sheet, start).menu;
}

const meta = {
  title: 'Components/Settings/YouMenu',
  component: YouMenu,
  subcomponents: { YouRow, YouLink, YouRule, YouPause, YouTheme, YouAsk },
  parameters: { layout: 'centered' },
  args: { person: ART, sheet: false, children: null },
  argTypes: { person: { control: 'object' }, sheet: { control: 'boolean' }, children: { control: false } },
  render: (args) => <PopSurface><Menu person={args.person} sheet={args.sheet} start={{}} /></PopSurface>
} satisfies Meta<typeof YouMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The menu on a popover's surface, as it opens under your face, starting as `start` says. */
const opening = (start: Start): NonNullable<Story['render']> => (args) => <PopSurface><Menu person={args.person} sheet={args.sheet} start={start} /></PopSurface>;

/** Open on its rows. Pause notifications opens its choices, an evening changes the theme, and nothing here is waiting, so Sign out doesn't ask. */
export const Open: Story = {};
export const OpenNight: Story = { ...Open, name: 'Open, night', globals: { theme: 'dark' } };
/** The pause's choices, open in place under it, each with the time it ends. Pick one: the row says until when. */
export const Pausing: Story = { render: opening({ pause: 'open' }) };
export const PausingNight: Story = { ...Pausing, name: 'Pausing, night', globals: { theme: 'dark' } };
/** Paused for an hour: the bell crossed out, until when, and Resume, which ends it at once. */
export const Paused: Story = { render: opening({ pause: 'h1' }) };
export const PausedNight: Story = { ...Paused, name: 'Paused, night', globals: { theme: 'dark' } };
/** Paused until tomorrow at 9:00. */
export const PausedUntilTomorrow: Story = { name: 'Paused until tomorrow', render: opening({ pause: 'tomorrow' }) };
/** Light chosen: its evening ringed, and the page light. */
export const LightChosen: Story = { name: 'Light chosen', render: opening({ theme: 'light' }) };
/** Dark chosen: its evening ringed, and the page dark. */
export const DarkChosen: Story = { name: 'Dark chosen', globals: { theme: 'dark' }, render: opening({ theme: 'dark' }) };
/** Two recordings on this device haven't uploaded: Sign out asks in place of the rows. Stay signed in goes back to them, as Escape does under your face. */
export const AskingWithRecordings: Story = { name: 'Asking, with recordings', render: opening({ waiting: 'recordings', asking: true }) };
export const AskingWithRecordingsNight: Story = { ...AskingWithRecordings, name: 'Asking, with recordings, night', globals: { theme: 'dark' } };
/** Something written hasn't reached Alcove: Copy what you wrote comes between staying and going. */
export const AskingWithWords: Story = { name: 'Asking, with words', render: opening({ waiting: 'words', asking: true }) };
export const AskingWithWordsNight: Story = { ...AskingWithWords, name: 'Asking, with words, night', globals: { theme: 'dark' } };
/** Both waiting. */
export const AskingWithBoth: Story = { name: 'Asking, with both', render: opening({ waiting: 'both', asking: true }) };
/** Copying what was written: it says so with a spinner, and pressing it again does nothing. */
export const Copying: Story = { render: opening({ waiting: 'words', asking: true, copying: true }) };
export const CopyingNight: Story = { ...Copying, name: 'Copying, night', globals: { theme: 'dark' } };
/** Signing out: it says so with a spinner; nothing else can be pressed, and focus stays where it was. */
export const SigningOut: Story = { name: 'Signing out', render: opening({ waiting: 'recordings', asking: true, signingOut: true }) };
export const SigningOutNight: Story = { ...SigningOut, name: 'Signing out, night', globals: { theme: 'dark' } };
/** A long name and address end in an ellipsis; hover either for the whole of it. */
export const ALongName: Story = { name: 'A long name and address', args: { person: LONG } };
export const ALongNameNight: Story = { ...ALongName, name: 'A long name and address, night', globals: { theme: 'dark' } };

/**
 * Under your face, as the app opens it: a popover aligned to its right edge, with a caret. Escape steps back one thing at a
 * time, then closes it, as a press outside does; your face opens it again.
 */
function FromYourFace({ person }: { person: AvatarPerson }) {
  const you = useMenu(person, false, { waiting: 'recordings' });
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', width: 'min(640px, 100%)', minHeight: 480 }}>
      <Popover open={you.open} onOpenChange={you.onOpenChange} onEscapeKeyDown={you.onEscapeKeyDown} align="end" caret label="Your menu"
        anchor={<YouButton person={person} />}>
        {you.menu}
      </Popover>
    </div>
  );
}
export const UnderYourFace: Story = { name: 'Under your face', parameters: { layout: 'padded' }, render: (args) => <FromYourFace person={args.person} /> };
export const UnderYourFaceNight: Story = { ...UnderYourFace, name: 'Under your face, night', globals: { theme: 'dark' } };

/** On a phone: the same menu in the kit's Sheet, rising from the foot of the window over a veil, with a grab handle. */
function OnAPhone({ person }: { person: AvatarPerson }) {
  const you = useMenu(person, true, { waiting: 'recordings' });
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', padding: 12 }}>
      <YouButton person={person} size={34} aria-expanded={you.open} onClick={() => you.onOpenChange(true)} />
      <Sheet open={you.open} onOpenChange={you.onOpenChange} onEscapeKeyDown={you.onEscapeKeyDown} label="Your menu">
        {you.menu}
      </Sheet>
    </div>
  );
}
export const AsASheet: Story = { name: 'As a sheet', parameters: { layout: 'fullscreen' }, globals: { viewport: { value: 'phone' } }, render: (args) => <OnAPhone person={args.person} /> };
export const AsASheetNight: Story = { ...AsASheet, name: 'As a sheet, night', globals: { theme: 'dark', viewport: { value: 'phone' } } };
