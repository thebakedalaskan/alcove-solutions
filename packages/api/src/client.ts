import type { CallCard, CallSession, NoteProgress, RoomRecording } from './live';
import type { CallMoveIn } from './moves';
import type { ActionPatch, ClientLogEntry, DecisionPatch, DemoProvider, LinePatch, QuestionPatch } from './wire';
import type {
  AnswerPart, Attestation, Calendar, CreditBalance, ID, ISODate, InstantCallInput, Meeting, MeetingInput, Note, NoteKind, NoteSummary, NotesSetting, OpenAction, PersonSuggestion,
  Preferences, Series, SeriesAnswerPart, Session, SignInResult, Team
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
     * /welcome?signin=<reason> when it didn't work. `next: '/move'` comes back to a move being made instead.
     */
    signInUrl(provider: 'google', opts?: { next?: '/move' | undefined }): string;
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
    /**
     * Schedules the next call in a call's series, starting the series if it isn't in one: the same
     * title, people, length and notes setting, at `startsAt`, which must be still to come and after the
     * call. The app sends the same clock time a week on where the person is (the first such time still
     * to come), so it doesn't move an hour when the clocks change. Not for an occurrence of a recurring
     * Google Calendar event, whose next one is on the calendar already.
     */
    scheduleNext(id: ID, startsAt: ISODate): Promise<Meeting>;
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
    /** What a call's link says before joining, for anyone, signed in or not: its title and organizer, whether notes are on, and where you stand. */
    card(code: string): Promise<CallCard>;
    /**
     * Joins a call by its link. The organizer hosts; invited people join with their accounts; anyone else asks to
     * join: signed in, under their account, otherwise with `name` (1–60 characters). Refused until the organizer is
     * there, while the call is locked, and once it has ended.
     */
    join(code: string, opts: { mic: boolean; cam: boolean; name?: string | undefined; previous?: string | undefined }): Promise<CallSession>;
    /**
     * Opens a move link on this device, with the code from the link's fragment. The code works once: from now on
     * this device holds the move (and the other device sees it was opened). Refused once the code has run out or
     * been used.
     */
    openMove(code: string): Promise<CallMoveIn>;
    /** Picks up a move this tab opened before it went to sign in, by the claim it kept (in this tab's sessionStorage). */
    resumeMove(claim: string): Promise<CallMoveIn>;
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
    /** URL of one shared-screen frame of a note (a `ScreenMoment`'s image), for a signed-in browser that has the note. */
    screenUrl(id: ID, frameId: ID): string;
    /** Confirms a decision, says it wasn't decided, reopens or rewords it. Anyone who has the notes can. */
    updateDecision(noteId: ID, decisionId: ID, patch: DecisionPatch): Promise<Note>;
    /** Takes on (owner only), gives, rewords, dates or ticks a follow-up. */
    updateAction(noteId: ID, actionId: ID, patch: ActionPatch): Promise<Note>;
    /** Says an open question was answered, opens it again, or rewords it. Anyone who has the notes can. */
    updateQuestion(noteId: ID, questionId: ID, patch: QuestionPatch): Promise<Note>;
    /**
     * Corrects a line of a written note's transcript: its words, who said it, or that it's right as heard. The
     * organizer can correct any line; anyone else who has the notes, the words of their own lines.
     */
    correctLine(noteId: ID, lineId: ID, patch: LinePatch): Promise<Note>;
    /**
     * Writes the notes again from the transcript as it is now, corrections included. The organizer's alone. The
     * decisions, open questions and follow-ups someone has already confirmed or changed stay as they are.
     */
    rewrite(noteId: ID): Promise<Note>;
    openActions(): Promise<OpenAction[]>;
    ask(noteId: ID, question: string): AsyncIterable<AnswerPart>;
    /** Shares the notes with more people, by email. They find them in Alcove when they sign in. */
    share(id: ID, emails: string[]): Promise<Note>;
    /** Deletes your own notes for everyone, or removes someone else's from your notes. */
    delete(id: ID): Promise<void>;
  };
  series: {
    /** A series as you see it: what carries over from the newest 24 calls in it whose notes you have, and only those. */
    get(id: ID): Promise<Series>;
    /**
     * Asks across the calls in a series whose notes you have, with the calls and moments the answer
     * comes from. `timeZone` is where the asker is, as an IANA name such as "Europe/London": the
     * calls' dates are read in it, so they're the days the asker sees.
     */
    ask(id: ID, question: string, timeZone: string): AsyncIterable<SeriesAnswerPart>;
  };
  credits: {
    balance(): Promise<CreditBalance>;
  };
  trust: {
    /** What the API is running on, attested inside a TEE, for a nonce of 32 random bytes in hex. */
    attestation(nonce: string): Promise<Attestation>;
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
