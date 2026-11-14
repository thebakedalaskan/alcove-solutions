/*
 * When someone counts as coming back to Alcove, for the reads that ask to be read again then (`refetchOnWindowFocus`, which
 * is off unless a read says otherwise): its tab coming back into view, as TanStack Query has it by itself, and also its
 * window coming to the front while it was in view already, as when two windows sit side by side and a press goes from one
 * into the other. Prerendering has no window, and listens for nothing.
 */
import { focusManager } from '@tanstack/react-query';

export function watchWindowFocus(): void {
  focusManager.setEventListener((handleFocus) => {
    if (typeof window === 'undefined') return undefined;
    const back = () => handleFocus();
    window.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    return () => {
      window.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
    };
  });
}
