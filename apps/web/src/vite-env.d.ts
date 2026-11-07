/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Base URL of the Alcove API. Defaults to /api, which Vite proxies to the local server in development. */
  readonly VITE_ALCOVE_API_URL?: string;
  /**
   * `on` where the listener service runs (development only, for now): only then is the listener the server names left
   * off the screen. Elsewhere, anyone holding the call's keys whom the server doesn't name as a person shows as
   * "Someone", whatever the server says, until browsers check a listener's attestation themselves.
   */
  readonly VITE_ALCOVE_LISTENERS?: string;
}

/*
 * Document Picture-in-Picture (WICG; Chrome and Edge 116+, Firefox 151+): an always-on-top window the page fills
 * itself. Not in TypeScript's DOM types yet. A share can open in one (features/call/screen-sharing/popOut.ts).
 */
interface DocumentPictureInPictureOptions { width?: number; height?: number; disallowReturnToOpener?: boolean; preferInitialWindowPlacement?: boolean }
interface DocumentPictureInPicture extends EventTarget {
  /** The window open now, if any. */
  readonly window: Window | null;
  /** Opens the window (closing one already open); needs a click or key press. */
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
}
interface Window { readonly documentPictureInPicture?: DocumentPictureInPicture }
