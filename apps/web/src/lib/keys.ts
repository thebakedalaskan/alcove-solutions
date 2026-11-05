/*
 * App shortcuts take ⌘ on a Mac and Ctrl elsewhere, never both: on a Mac, Ctrl+K in a text field still
 * deletes to the end of the line.
 */
const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** Whether `e` holds this platform's shortcut key (⌘ on a Mac, Ctrl elsewhere) and no other modifier. */
export const withMod = (e: KeyboardEvent): boolean => (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey;
/** The same with Shift held too. */
export const withModShift = (e: KeyboardEvent): boolean => (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && e.shiftKey;
/** A shortcut as its hint shows it: "⌘K" on a Mac, "Ctrl K" elsewhere. */
export const shortcut = (key: string): string => (mac ? `⌘${key}` : `Ctrl ${key}`);
/** The same shortcut for `aria-keyshortcuts`: "Meta+K" or "Control+K". */
export const ariaShortcut = (key: string): string => `${mac ? 'Meta' : 'Control'}+${key}`;

/** A key pressed while typing into a field, a select or editable text: single-key shortcuts leave it alone. */
export const typing = (t: EventTarget | null): boolean => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable="true"]');
/** A dialog, a menu or a list of choices is open: shortcuts leave the page alone, and nothing opens on top. */
export const overlayOpen = (): boolean => !!document.querySelector('[role="dialog"], [role="listbox"], [role="menu"]');
