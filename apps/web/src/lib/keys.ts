/*
 * App shortcuts take ⌘ on a Mac and Ctrl elsewhere, never both: on a Mac, Ctrl+K in a text field still
 * deletes to the end of the line.
 */
const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** Whether `e` holds this platform's shortcut key (⌘ on a Mac, Ctrl elsewhere) and no other modifier. */
export const withMod = (e: KeyboardEvent): boolean => (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey;
/** A shortcut as its hint shows it: "⌘K" on a Mac, "Ctrl K" elsewhere. */
export const shortcut = (key: string): string => (mac ? `⌘${key}` : `Ctrl ${key}`);
/** The same shortcut for `aria-keyshortcuts`: "Meta+K" or "Control+K". */
export const ariaShortcut = (key: string): string => `${mac ? 'Meta' : 'Control'}+${key}`;
