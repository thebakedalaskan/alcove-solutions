import { type ClientLogEntry } from './wire';
export interface DiagnosticsApi {
  /** Sends browser warnings and errors to the server log. Best effort: never throws, never reports itself. */
  report(entries: ClientLogEntry[]): Promise<void>;
}
