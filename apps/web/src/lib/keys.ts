/*
 * App shortcuts take ⌘ on a Mac and Ctrl elsewhere, never both: on a Mac, Ctrl+K in a text field still
 * deletes to the end of the line.
 */
const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** Whether `e` holds this platform's shortcut key (⌘ on a Mac, Ctrl elsewhere), with Shift or without, and no other modifier: what ⌘Z and ⇧⌘Z share. */
export const withShortcutKey = (e: KeyboardEvent): boolean => (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey;
/** Whether `e` holds this platform's shortcut key and no other modifier. */
export const withMod = (e: KeyboardEvent): boolean => withShortcutKey(e) && !e.shiftKey;
/** The same with Shift held too. */
export const withModShift = (e: KeyboardEvent): boolean => withShortcutKey(e) && e.shiftKey;
/** A shortcut as its hint shows it: "⌘K" on a Mac, "Ctrl K" elsewhere. */
export const shortcut = (key: string): string => (mac ? `⌘${key}` : `Ctrl ${key}`);
/** The same shortcut for `aria-keyshortcuts`: "Meta+K" or "Control+K". */
export const ariaShortcut = (key: string): string => `${mac ? 'Meta' : 'Control'}+${key}`;

/** Something keys type into: a field, a select or editable text. */
export const editable = (t: EventTarget | null): boolean => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable="true"]');

/**
 * How long single-key shortcuts sleep after a key goes into something editable. Whoever's typing keeps typing for a moment
 * whatever happens on screen, and what held their caret can go, under a presentation or with the workspace switching:
 * the rest of their sentence must never mute them, or make a document somewhere else.
 */
const TYPING_MS = 1500;
let typedAt = Number.NEGATIVE_INFINITY;
/** What keys last went into, since whoever's here last clicked, tapped or tabbed away: where they're typing, if anywhere. */
let typedIn: Element | null = null;
/**
 * Their caret was taken from under them, by what held it going inert or away, and they haven't chosen anything since: shortcuts
 * sleep until they click or tap, or move on with Tab or Escape, whatever has focus meanwhile.
 */
let stranded = false;
const lost = (e: Element | null): boolean => e !== null && (!e.isConnected || e.closest('[inert]') !== null);
if (typeof window !== 'undefined') {
  /* Before anything else hears the key. */
  addEventListener('keydown', (e) => {
    if (e.target instanceof Element && editable(e.target)) {
      typedAt = performance.now();
      typedIn = e.target;
      stranded = false;
    } else if (e.key === 'Tab' || e.key === 'Escape') {
      stranded = false;
      typedIn = null;
    } else if ((e.target === document.body || e.target === document.documentElement) && lost(typedIn)) stranded = true;
  }, true);
  addEventListener('pointerdown', () => { stranded = false; typedIn = null; }, true);
}

/**
 * Moves focus out of `from`, which is about to go inert or away, to `to`: somewhere nothing happens on a key, such as the
 * document taking its place, and never anything editable, where the rest of a sentence would land. Someone who was typing
 * in it is mid-sentence, so single-key shortcuts sleep until they choose something.
 */
export function moveFocusOut(from: Element | null, to: HTMLElement | null): void {
  if (!from) return;
  const at = document.activeElement;
  const typingHere = typedIn !== null && from.contains(typedIn);
  if (!(at !== null && from.contains(at)) && !(typingHere && (at === null || at === document.body))) return;
  if (typingHere) stranded = true;
  if (to && !editable(to)) to.focus({ preventScroll: true });
  else if (at instanceof HTMLElement) at.blur();
}

/**
 * A key pressed while typing, which single-key shortcuts leave alone: into a field, a select or editable text, or a moment
 * after one was, or since whoever was typing lost their caret to the page going inert.
 */
export const typing = (t: EventTarget | null): boolean => editable(t) || performance.now() - typedAt < TYPING_MS || stranded;
/**
 * Whoever was typing lost their caret to the page going inert or away, and hasn't clicked, tapped, or moved on with Tab or
 * Escape since: the rest of their sentence may still be coming. `typing` without its moment's pause, for keys that may act at
 * once after typing but never on what someone typed into a field they lost.
 */
export const caretTaken = (): boolean => stranded;
/** A dialog, a menu or a list of choices is open: shortcuts leave the page alone, and nothing opens on top. */
export const overlayOpen = (): boolean => !!document.querySelector('[role="dialog"], [role="listbox"], [role="menu"]');
