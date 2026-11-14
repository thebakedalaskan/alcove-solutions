import { type Patch } from '../client';
import { type InvitePeek } from '../teams/schema';
import { type InviteLink } from './invite-links';
import { type PersonSuggestion, type Team } from './people';
import { type Preferences } from './preferences';
import { type Session, type SignInResult } from './session';
import { type DemoProvider } from './wire';
export interface AuthApi {
  /** The signed-in session, or null when signed out. */
  getSession(): Promise<Session | null>;
  /**
   * Says someone is using Alcove: the app sends it when it loads and when a tab comes back after 30 minutes or more
   * away, never from polling. On a team, a visit takes a license for a member without a live one.
   */
  visit(): Promise<void>;
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
  /**
   * Your company and who in it uses Alcove; null for personal accounts. `members[].invited`: there's a live invitation for
   * them to the team you're on.
   */
  team(): Promise<Team | null>;
  /**
   * Your own invite link, the same every time until you make a new one: what Copy link copies. Whoever opens it can join your
   * team. Refused for someone with neither a company page nor a team.
   */
  inviteLink(): Promise<InviteLink>;
  /** A new invite link in place of yours: the one you've sent leads nowhere from then on. */
  newInviteLink(): Promise<InviteLink>;
  /**
   * What a secret after `/invite#` says, signed in or not: an invitation's own link or someone's invite link, who it's from,
   * the team it joins, and whether it's your own link. Anything that leads nowhere (made up, used, cancelled, run out, made
   * again since, or its sender gone) is the same `not-found`.
   */
  peekInvite(secret: string): Promise<InvitePeek>;
  /**
   * Stops Alcove's invitation emails to the address a token after `/stop-email#` was sent to, signed in or not: from then on its
   * invitations are still made, and shown in the app, but never emailed. Nobody is told. The same answer for any token.
   */
  stopEmails(token: string): Promise<void>;
}
