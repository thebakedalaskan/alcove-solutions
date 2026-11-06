export interface HttpOptions {
  /** e.g. "/api" behind the web app's proxy, or https://api.alcove.solutions */
  baseUrl: string;
  fetch?: typeof fetch;
  /**
   * Diagnostics: every request (debug) and failure (warn/error). Fields are methods, paths,
   * statuses, codes, durations and request IDs; never bodies.
   */
  onEvent?: (e: ClientEvent) => void;
  /** How often a call checks for keys and people while nothing nudges it, in ms (default 1500). Tests go faster. */
  callPollMs?: number | undefined;
  /** How often a browser showing the live notes says so, in ms (default 5000). Tests go faster. */
  callNotesMs?: number | undefined;
  /** How often a browser with a call's board open looks for ideas from the call, in ms (default 15 s; the server reads at most once a minute). Tests go faster. */
  callIdeasMs?: number | undefined;
  /** How long a browser waits after the call's keys move on before it sends with its new one, in ms (default 2000). */
  callKeySwitchMs?: number | undefined;
  /** How often the host's browser moves the call's keys on when nobody comes or goes, in ms (default 10 minutes). */
  callRekeyMs?: number | undefined;
  /**
   * How long a stream of rings may say nothing before it's given up on, in ms (default 50 s: the server says something
   * every 20). A laptop waking up can hold a connection that's dead without knowing it. Tests go faster.
   */
  ringSilenceMs?: number | undefined;
  /** How long an upload keeps trying through a lost connection or a busy server, in ms (default 5 minutes). */
  mediaPatienceMs?: number | undefined;
  /** How long a live stream can say nothing before it's taken for gone and opened again, in ms (default a minute). */
  liveQuietMs?: number | undefined;
  /** How often an open workspace says this browser is still there, in ms (default 10 seconds). */
  livePresenceMs?: number | undefined;
}

export interface ClientEvent {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  context: Record<string, string | number | boolean | null>;
}
