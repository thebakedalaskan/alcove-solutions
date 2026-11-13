/*
 * A note's transcript: one spoken line (TranscriptLine), what the transcript can't vouch for in it (Unsure), and the quiet
 * key under a transcript that says what its dotted marks mean (UnsureKey). The line is styled in note.css (`nd-l`), the
 * marks in foundation/kit.css (`ac-unsure`).
 */
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { cn } from '../foundation/cn';
import { Tooltip } from '../foundation/overlay';
import { Avatar, type AvatarPerson } from '../foundation/people';

/** What in a line has a press, or a tip, of its own: its time, its tools, a marker. Words it isn't sure of are still words. */
const OWN_PRESS = 'a, button, input, textarea, select, label, [role="button"], .nd-lx, [tabindex]:not(.ac-unsure)';
/** How long a press on a line's words waits for a second click, which selects a word to copy instead. */
const SECOND_CLICK_MS = 250;
/** Whether some words on the page are selected, to copy. */
function selecting(): boolean {
  const picked = getSelection();
  return !!picked && !picked.isCollapsed && picked.toString().trim() !== '';
}

/**
 * One spoken line of a note's transcript: when, the speaker's arch, their name, what they said, and `tools` for what can
 * be done with it, which wait under the pointer. Without a person (the same speaker again, or a room recording) the arch's
 * place stays empty. `id` makes it a place a link can go to. With `onPress`, pressing the line does what its time does,
 * anywhere but on something with a press or a tip of its own, and not when the press ends selecting its words, so they can
 * still be copied: it waits a quarter of a second, and a double or triple click (a word or the line, selected) calls it
 * off. Its time goes at once. It takes no tab stop, since its time is the keyboard's way in.
 */
export function TranscriptLine({ time, person, name, tools, children, className, id, onPress }: {
  time: ReactNode; person?: AvatarPerson | undefined; name?: ReactNode; tools?: ReactNode; children: ReactNode; className?: string | undefined; id?: string | undefined;
  onPress?: (() => void) | undefined;
}) {
  /* The press waiting for a second click, if there is one: this line owns its timer, and it goes with the line. */
  const waiting = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(waiting.current), []);
  const press = onPress && ((e: MouseEvent<HTMLDivElement>) => {
    // What opens from the line (a tool's menu, over the page) passes its presses through it too: they aren't on it.
    if (!(e.target instanceof Element) || !e.currentTarget.contains(e.target)) return;
    const own = e.target.closest(OWN_PRESS);
    if (own && e.currentTarget.contains(own)) return;
    // A second or third click selects a word, or the line, to copy: the first one's press doesn't happen.
    window.clearTimeout(waiting.current);
    waiting.current = undefined;
    if (e.detail > 1 || selecting()) return;
    waiting.current = window.setTimeout(() => {
      waiting.current = undefined;
      if (!selecting()) onPress();
    }, SECOND_CLICK_MS);
  });
  return (
    <div id={id} className={cn('nd-l', onPress && 'is-press', className)} onClick={press}>
      {time}
      <span className="nd-la">{person && <Avatar person={person} size={24} />}</span>
      <div className="nd-lb">{name && <p className="nd-ln">{name}</p>}<p className="nd-lp">{children}</p></div>
      <div className="nd-lx">{tools}</div>
    </div>
  );
}

/** What the transcript can't vouch for in a line: words that were hard to hear, or who said them. */
export type UnsureOf = 'words' | 'speaker';
const UNSURE: Record<UnsureOf, { tip: string; said: string }> = {
  words: { tip: 'Hard to hear. It may not be exactly what was said.', said: 'hard to hear, may not be exact' },
  speaker: { tip: 'Heard on more than one microphone. Someone else may have said it.', said: 'may have been someone else' }
};
/**
 * Something in a transcript it can't vouch for: a dotted underline (never colour alone), the reason on hover or focus,
 * and in words for screen readers. Calm on purpose: it says the transcript isn't sure, not that anything is wrong.
 */
export function Unsure({ of, children, className }: { of: UnsureOf; children: ReactNode; className?: string | undefined }) {
  return (
    <Tooltip label={UNSURE[of].tip}>
      <span tabIndex={0} className={cn('ac-unsure', className)}>{children}<span className="sr-only"> ({UNSURE[of].said})</span></span>
    </Tooltip>
  );
}
/** One quiet line under a transcript saying what its dotted marks mean, for the kinds it has; nothing when it has none. */
export function UnsureKey({ words, speaker, className }: { words: boolean; speaker: boolean; className?: string | undefined }) {
  if (!words && !speaker) return null;
  return (
    <p className={cn('ac-unsure-key', className)}>
      {words && <><span className="ac-unsure">Dotted</span> words were hard to hear and may not be exact. </>}
      {speaker && <>A <span className="ac-unsure">dotted</span> name was heard on more than one microphone.</>}
    </p>
  );
}
