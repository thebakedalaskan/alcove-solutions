/**
 * Holds the page at its own scale on iOS. There, focusing a field whose text is under 16px zooms the page in and leaves it
 * zoomed, a little larger than the screen, so it slides sideways under a finger and runs off both edges: in a call that's
 * Chat's message box (14px), Notes, Ask and finding someone, and most of the app's fields are 13–15px. A maximum scale stops
 * that zoom. People can still pinch to zoom, since iOS lets them zoom whatever a page says. Everywhere else the viewport is
 * left as it is, so nothing stops anyone zooming.
 */
export function holdScaleOnIos(): void {
  // Only WebKit on iOS and iPadOS has the long-press callout, whichever browser it's in.
  if (typeof CSS === 'undefined' || !CSS.supports('-webkit-touch-callout', 'none')) return;
  const meta = document.querySelector('meta[name="viewport"]');
  const content = meta?.getAttribute('content');
  if (!meta || content == null || content.includes('maximum-scale')) return;
  meta.setAttribute('content', `${content}, maximum-scale=1`);
}
