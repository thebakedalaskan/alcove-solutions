import { type Patch } from '../client';
import { type PersonSuggestion, type Team } from './people';
import { type Preferences } from './preferences';
import { type Session, type SignInResult } from './session';
import { type DemoProvider } from './wire';
export interface AuthApi {
  /** The signed-in session, or null when signed out. */
  getSession(): Promise<Session | null>;
  /**
       * Where the browser goes to sign in with Google. Google sends it back to the API, which opens
       * the session and returns to the app: /ready for a new account, /home otherwise, or
       * /welcome?signin=<reason> when it didn't work. `next: '/move'` comes back to a move being made instead.
       * `popup` returns only the outcome to /welcome in that popup, for its waiting tab to pick up.
       */
  signInUrl(provider: 'google', opts?: { next?: '/move' | undefined; popup?: string | undefined }): string;

  /** Signs in a demo identity with Microsoft or single sign-on (`email` picks who). */
  signIn(provider: DemoProvider, opts?: { email?: string | undefined }): Promise<SignInResult>;
  /** Ends this session. */
  signOut(): Promise<void>;
}

export interface AccountApi {
  preferences(): Promise<Preferences>;
  updatePreferences(patch: Patch<Preferences>): Promise<Preferences>;
  /**
   * Deletes the account for good, with everything it owns: the notes it organized (for everyone, audio
   * included), its recordings, meetings, groups and pins, its Google connection and every session. It's
   * taken off the notes other people gave it. Signing in again starts a new account.
   */
  delete(): Promise<void>;
}

export interface PeopleApi {
  /** Colleagues, people you've had calls with, and any email address typed in full. */
  search(query: string): Promise<PersonSuggestion[]>;
  /** Your company and who in it uses Alcove; null for personal accounts. */
  team(): Promise<Team | null>;
  /** Invites colleagues to Alcove. */
  inviteToTeam(emails: string[]): Promise<Team>;
}
