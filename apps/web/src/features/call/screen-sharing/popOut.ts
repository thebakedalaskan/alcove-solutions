/*
 * A share in its own window, to put on another screen or keep in view over other apps. Only you see it, and it shows
 * only what's already shared with you.
 *
 * Document Picture-in-Picture where the browser has it (Chrome and Edge 116+, Firefox 151+): an always-on-top window
 * this page fills itself, which LiveKit counts as on screen even while the call's own tab is in the background. On a
 * computer without it (Safari), a popup window, which can go on another screen and full screen; LiveKit pauses its
 * picture while the call's tab is hidden, as it does every video in the call. Phones and tablets show shares in the
 * call only. The window gets the app's own stylesheets, so it looks like the call.
 */

export type PopKind = 'pip' | 'window';

/** How this browser can show a share in its own window, or null where it can't (phones and tablets). */
export function popKind(): PopKind | null {
  if (typeof window === 'undefined') return null;
  if (window.documentPictureInPicture) return 'pip';
  return matchMedia('(hover: none), (pointer: coarse)').matches ? null : 'window';
}

/** The window's own bar, above the share. */
export const POP_HEADER = 52;

/** About as big as the share reads well, within the screen. */
function sizeFor(aspect: number): { width: number; height: number } {
  const a = Number.isFinite(aspect) && aspect > 0.3 && aspect < 4 ? aspect : 1.6;
  const width = Math.round(Math.min(960, (screen.availWidth || 1280) * 0.6));
  const height = Math.round(Math.min(width / a + POP_HEADER + 10, (screen.availHeight || 800) * 0.8));
  return { width, height };
}

/**
 * Opens the window, from the click that asked for it: browsers open neither kind without one. Null when the browser
 * wouldn't (a popup blocker); rejects when Document Picture-in-Picture refuses.
 */
export async function openPop(kind: PopKind, title: string, aspect: number): Promise<Window | null> {
  const { width, height } = sizeFor(aspect);
  let win: Window | null;
  if (kind === 'pip') {
    const pip = window.documentPictureInPicture;
    if (!pip) return null;
    win = await pip.requestWindow({ width, height });
  } else {
    // A new name each time, so a window left from before is never reused.
    win = window.open('', `alcove-share-${Date.now().toString(36)}`, `popup,width=${width},height=${height}`);
  }
  if (!win) return null;
  dress(win, title);
  return win;
}

/**
 * The window looks like the call: the app's stylesheets (and so its fonts), its theme, night. The window is a blank page
 * that carries the call's own CSP, whose `base-uri 'none'` refuses a `<base>`, so each stylesheet is linked by its full
 * address (the fonts in it resolve against that) rather than by the path the call's page uses.
 */
function dress(win: Window, title: string) {
  const doc = win.document;
  doc.title = title;
  doc.documentElement.lang = document.documentElement.lang;
  doc.documentElement.className = document.documentElement.className;
  const scheme = doc.createElement('meta');
  scheme.name = 'color-scheme';
  scheme.content = 'dark';
  const sheets = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((el): Node => {
    if (!(el instanceof HTMLLinkElement)) return el.cloneNode(true);
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = el.href;
    if (el.media) link.media = el.media;
    return link;
  });
  doc.head.append(scheme, ...sheets);
  doc.body.className = 'ic-popbody';
}
