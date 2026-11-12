/*
 * Your menu: what your face opens, at the top right of every page, in the phone's top bar, and on a workspace's bar. You,
 * standing on the horizon in the last of the light, then what you reach for from any page: Pause notifications, the theme,
 * Settings, the tour, and Sign out, which asks in place when something on this device would be lost, as Settings' sky does
 * (features/settings/SignOut.tsx decides for both). A popover under your face on a wide screen, a sheet from the bottom on a
 * phone. Settings and the tour close it; the theme and pausing don't. Escape steps back one thing at a time: Sign out's
 * question back to the rows, the pause's choices shut, then the menu, focus going back to your face.
 */
import type { AvatarPerson } from '@alcove/ui';
import { Popover, Sheet, Spinner, YouAsk, YouButton, YouLink, YouMenu, YouPause, YouRow, YouRule, YouTheme, useTheme } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { arrival } from '~/features/onboarding/store';
import { useSigningOut } from '~/features/settings/SignOut';
import { useMedia } from '~/lib/live';
import { q } from '~/lib/queries';
import { usePause } from './pause';

/**
 * The menu and what opens it: you, and until when notifications are paused (null while they aren't), for your face. It
 * lives as long as your face's place on the page does, not only while the menu's open, so signing out carries on to the
 * welcome page whatever closes meanwhile.
 */
function useYourMenu(sheet: boolean): {
  me: AvatarPerson | null; until: string | null; open: boolean; onOpenChange: (open: boolean) => void; onEscapeKeyDown: (e: KeyboardEvent) => void; menu: ReactNode;
} {
  const me = useQuery(q.session()).data?.user ?? null;
  const pause = usePause();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  /** Pause notifications' choices, open in place under it. */
  const [choosing, setChoosing] = useState(false);
  // A pause that holds, made here or on another device, shuts them, so they don't open again by themselves when it ends.
  if (choosing && pause.until !== null) setChoosing(false);
  /** Sign out's row, which focus goes back to as its question closes: the rows come back in the question's place first. */
  const outRow = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const out = useSigningOut({ back: () => { refocus.current = true; }, holding: () => open });
  const asking = out.question !== null;
  useLayoutEffect(() => {
    if (asking || !refocus.current) return;
    refocus.current = false;
    outRow.current?.focus();
  }, [asking]);

  // Signing out, it holds still until the welcome page. It always opens on its rows, with the pause's choices shut.
  const onOpenChange = (next: boolean) => {
    if (!next && out.pending) return;
    setOpen(next);
    setChoosing(false);
    out.dismiss();
  };
  // Escape steps back one thing at a time before it closes the menu, for the popover and the sheet alike: signing out, it
  // does nothing; asking, it stays signed in, back on the rows; with the pause's choices open, it shuts them.
  const onEscapeKeyDown = (e: KeyboardEvent) => {
    if (out.pending) e.preventDefault();
    else if (asking) { e.preventDefault(); out.stay(); }
    else if (choosing) { e.preventDefault(); setChoosing(false); }
  };

  const menu = me && (
    <YouMenu person={me} sheet={sheet}>
      {out.question ? (
        <YouAsk says={out.question.says} lines={out.question.lines} signOutLabel={out.question.signOutLabel} onStay={out.stay} onSignOut={out.signOut}
          onCopy={out.question.words ? out.copy : undefined} copying={out.copying} pending={out.pending} />
      ) : (
        <>
          <YouPause until={pause.until} open={choosing} onOpenChange={setChoosing} choices={pause.choices} pending={pause.pending}
            onResume={() => { setChoosing(false); pause.resume(); }}
            onPause={(id) => { pause.pause(id); setChoosing(false); }} />
          <YouTheme theme={theme} onChange={setTheme} />
          <YouRule />
          {/* A link, so it opens in a new tab too. Only a plain click goes there in this tab, as the router has it, and closes the menu. */}
          <YouLink icon="settings" label="Settings" link={(p) => (
            <Link to="/settings" {...p} onClick={(e) => { if (e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) onOpenChange(false); }} />
          )} />
          <YouRow icon="compass" label="Take the tour" onClick={() => { onOpenChange(false); arrival.askTour(); }} />
          <YouRule />
          {/* aria-disabled, not disabled, while signing out: focus stays on the row pressed. */}
          <YouRow ref={outRow} icon="signOut" label="Sign out" end={out.pending ? <Spinner /> : undefined} aria-disabled={out.pending || undefined}
            onClick={() => { if (!out.pending) out.press(); }} />
        </>
      )}
    </YouMenu>
  );
  return { me, until: pause.until, open, onOpenChange, onEscapeKeyDown, menu };
}

/** The phone's width, as the shell has it (styles/shell.css): your face is in the top bar, and your menu rises as a sheet. */
const PHONE = '(max-width: 860px)';

/**
 * Your face, at the top right of every page, in a phone's top bar and on a workspace's bar, with the menu it opens: under it
 * with a caret on a wide screen, rising from the bottom as a sheet on a phone. `className` is for the page round it, as
 * Settings' sky hides the top right's (`top-me`). The shell keeps a face for each width and shows the one that fits, so
 * when the window crosses from one to the other the menu closes rather than hang from a face that's gone.
 */
export function YourFace({ size, className }: { size: number; className?: string | undefined }) {
  const phone = useMedia(PHONE);
  const you = useYourMenu(phone);
  const [was, setWas] = useState(phone);
  if (was !== phone) {
    setWas(phone);
    if (you.open) you.onOpenChange(false);
  }
  if (!you.me) return null;
  const face = { className, size, person: you.me, until: you.until };
  return phone ? (
    <>
      <YouButton {...face} aria-expanded={you.open} onClick={() => you.onOpenChange(true)} />
      <Sheet open={you.open} onOpenChange={you.onOpenChange} onEscapeKeyDown={you.onEscapeKeyDown} label="Your menu">{you.menu}</Sheet>
    </>
  ) : (
    <Popover open={you.open} onOpenChange={you.onOpenChange} onEscapeKeyDown={you.onEscapeKeyDown} align="end" caret label="Your menu"
      anchor={<YouButton {...face} />}>
      {you.menu}
    </Popover>
  );
}
