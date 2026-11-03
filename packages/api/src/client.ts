import type { CallSession, NoteProgress, RoomRecording } from './live';
import type { ClientLogEntry, DemoProvider } from './wire';
import type {
  AnswerPart, Calendar, CreditBalance, ID, InstantCallInput, Meeting, MeetingInput, Note, NoteKind, NoteSummary, NotesSetting, OpenAction, PersonSuggestion,
  Preferences, Session, SignInResult, Team
} from './types';

/** A partial update: any field may be missing or explicitly undefined. */
export type Patch<T> = { [K in keyof T]?: T[K] | undefined };

/** Everything the frontend can ask of the backend. */
export interface AlcoveApi {
  auth: {
    /** The signed-in session, or null when signed out. */
    getSession(): Promise<Session | null>;
    /**
     * Where the browser goes to sign in with Google. Google sends it back to the API, which opens
     * the session and returns to the app: /ready for a new account, /home otherwise, or
     * /welcome?signin=<reason> when it didn't work.
     */
    signInUrl(provider: 'google'): string;
    /** Signs in a demo identity with Microsoft or single sign-on (`email` picks who). */
    signIn(provider: DemoProvider, opts?: { email?: string | undefined }): Promise<SignInResult>;
    /** Ends this session. */
    signOut(): Promise<void>;
  };
  account: {
    preferences(): Promise<Preferences>;
    updatePreferences(patch: Patch<Preferences>): Promise<Preferences>;
  };
  people: {
    /** Colleagues, people you've had calls with, and any email address typed in full. */
    search(query: string): Promise<PersonSuggestion[]>;
    /** Your company and who in it uses Alcove; null for personal accounts. */
    team(): Promise<Team | null>;
    /** Invites colleagues to Alcove. */
    inviteToTeam(emails: string[]): Promise<Team>;
  };
  meetings: {
    upcoming(): Promise<Meeting[]>;
    past(): Promise<Meeting[]>;
    get(id: ID): Promise<Meeting>;
    byCode(code: string): Promise<Meeting | null>;
    /** Schedules a call. With Google Calendar connected it goes on the calendar, which sends everyone invited an invitation. */
    create(input: MeetingInput): Promise<Meeting>;
    /** Changes a call; a connected calendar sends everyone the update. */
    update(id: ID, input: Patch<MeetingInput>): Promise<Meeting>;
    /** Cancels a call; a connected calendar tells everyone. */
    cancel(id: ID): Promise<void>;
  };
  calendar: {
    /** The coming week's other calendar events, beside Alcove's own calls. */
    get(): Promise<Calendar>;
    /** Where the browser goes to give Alcove access to the Google Calendar of the account it's signed in with. */
    connectUrl(): string;
    /** Makes one of your own calendar events an Alcove call: the event gets the Alcove link, and everyone invited is told. */
    adopt(eventId: ID, notes?: NotesSetting | undefined): Promise<Meeting>;
  };
  calls: {
    /** Creates a call that starts now and returns its code. */
    startNow(input?: InstantCallInput): Promise<{ code: string }>;
    /** Joins one of your calls by code. Notes are on if the call was set up with them. */
    join(code: string, opts: { mic: boolean; cam: boolean }): Promise<CallSession>;
  };
  recordings: {
    start(title?: string): Promise<RoomRecording>;
  };
  notes: {
    list(query?: { kind?: NoteKind | undefined; text?: string | undefined }): Promise<NoteSummary[]>;
    get(id: ID): Promise<Note>;
    progress(id: ID): AsyncIterable<NoteProgress>;
    /** URL that streams one decrypted audio segment to a signed-in browser. */
    audioUrl(id: ID, segment: number): string;
    setActionDone(noteId: ID, actionId: ID, done: boolean): Promise<void>;
    openActions(): Promise<OpenAction[]>;
    ask(noteId: ID, question: string): AsyncIterable<AnswerPart>;
    /** Shares the notes with more people, by email. They find them in Alcove when they sign in. */
    share(id: ID, emails: string[]): Promise<Note>;
    /** Deletes your own notes for everyone, or removes someone else's from your notes. */
    delete(id: ID): Promise<void>;
  };
  credits: {
    balance(): Promise<CreditBalance>;
  };
  diagnostics: {
    /** Sends browser warnings and errors to the server log. Best effort: never throws, never reports itself. */
    report(entries: ClientLogEntry[]): Promise<void>;
  };
}

export type AlcoveErrorCode =
  | 'unauthenticated' | 'not-found' | 'forbidden' | 'invalid' | 'insufficient-credits' | 'conflict' | 'unavailable'
  | 'key-unavailable' | 'network' | 'unknown';

/** Where a failed request went, for logs and bug reports. `requestId` matches the server's log lines. */
export interface ErrorDetails { requestId?: string | undefined; status?: number | undefined; method?: string | undefined; path?: string | undefined; cause?: unknown }

export class AlcoveApiError extends Error {
  readonly requestId: string | undefined;
  readonly status: number | undefined;
  readonly method: string | undefined;
  readonly path: string | undefined;
  constructor(public readonly code: AlcoveErrorCode, message: string, details: ErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'AlcoveApiError';
    this.requestId = details.requestId;
    this.status = details.status;
    this.method = details.method;
    this.path = details.path;
  }
}
/** The server's request ID behind an error, if it has one: quote it when reporting a problem. */
export const errorRequestId = (e: unknown): string | undefined => (e instanceof AlcoveApiError ? e.requestId : undefined);

export const ALCOVE_ERROR_CODES: readonly AlcoveErrorCode[] = ['unauthenticated', 'not-found', 'forbidden', 'invalid', 'insufficient-credits', 'conflict', 'unavailable', 'key-unavailable', 'network', 'unknown'];
export const isAlcoveErrorCode = (v: unknown): v is AlcoveErrorCode => typeof v === 'string' && ALCOVE_ERROR_CODES.some((c) => c === v);

/** A user-facing message for anything thrown. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Something went wrong. Try again.';
}
export const errorCode = (e: unknown): AlcoveErrorCode => (e instanceof AlcoveApiError ? e.code : 'unknown');
