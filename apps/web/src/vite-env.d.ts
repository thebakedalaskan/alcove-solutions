/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Base URL of the Alcove API. Defaults to /api, which Vite proxies to the local server in development. */
  readonly VITE_ALCOVE_API_URL?: string;
}
