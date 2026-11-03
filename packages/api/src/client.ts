import type { CallSession, NoteProgress, RoomRecording } from './live';
import type { ClientLogEntry } from './wire';
import type {
  AnswerPart, CallLink, CreditBalance, CreditEvent, CreditPack,
  ID, Meeting, MeetingInput, MeetingNotesSetting, Note, NoteKind, NoteSummary, NotesAudience, NotesMode, OpenAction, Passkey,
  Preferences, Session, SetupStep, WeekStats
} from './types';

/** A partial update: any field may be missing or explicitly undefined. */
export type Patch<T> = { [K in keyof T]?: T[K] | undefined };

/** Everything the frontend can ask of the backend. */
export interface AlcoveApi {
  auth: {
    /** The unlocked session, or null when signed out or locked. */
    getSession(): Promise<Session | null>;
    /** Creates an account protected by a new passkey and unlocks it. */
    createAccount(name: string): Promise<Session>;
    /** Unlocks with an existing passkey on this device. */
    unlock(): Promise<Session>;
    /** Ends the session. The server drops the owner root immediately. */
    lock(): Promise<void>;
  };
  account: {
    preferences(): Promise<Preferences>;
    updatePreferences(patch: Patch<Preferences>): Promise<Preferences>;
    rename(name: string): Promise<Session>;
    passkeys(): Promise<Passkey[]>;
    /** Registers another passkey for this account (e.g. on a second device). Asks for an existing passkey first. */
    addPasskey(): Promise<Passkey>;
    /** Removes a passkey. Asks for an existing passkey first; the last passkey can't be removed. */
    removePasskey(id: ID): Promise<void>;
    setupSteps(): Promise<SetupStep[]>;
  };
  meetings: {
    upcoming(): Promise<Meeting[]>;
    past(): Promise<Meeting[]>;
    get(id: ID): Promise<Meeting>;
    byCode(code: string): Promise<Meeting | null>;
    create(input: MeetingInput): Promise<Meeting>;
    update(id: ID, input: Patch<MeetingInput>): Promise<Meeting>;
    setNotes(id: ID, notes: MeetingNotesSetting): Promise<Meeting>;
    cancel(id: ID): Promise<void>;
  };
  links: {
    create(notes: MeetingNotesSetting): Promise<CallLink>;
  };
  calls: {
    /** Joins one of your calls by code. `notes` decides notes at join time for `ask` meetings. */
    join(code: string, opts: { mic: boolean; cam: boolean; notes?: NotesMode | undefined; audience?: NotesAudience | undefined }): Promise<CallSession>;
    /** Creates a new call to start right away and returns its code. */
    createInstant(): Promise<{ code: string }>;
  };
  recordings: {
    start(title?: string): Promise<RoomRecording>;
  };
  notes: {
    list(query?: { kind?: NoteKind | undefined; text?: string | undefined }): Promise<NoteSummary[]>;
    get(id: ID): Promise<Note>;
    progress(id: ID): AsyncIterable<NoteProgress>;
    /** Same-origin URL that streams one decrypted audio segment while the session is unlocked. */
    audioUrl(id: ID, segment: number): string;
    setActionDone(noteId: ID, actionId: ID, done: boolean): Promise<void>;
    openActions(): Promise<OpenAction[]>;
    ask(noteId: ID, question: string): AsyncIterable<AnswerPart>;
    delete(id: ID): Promise<void>;
  };
  credits: {
    balance(): Promise<CreditBalance>;
    history(): Promise<CreditEvent[]>;
    packs(): Promise<CreditPack[]>;
    purchase(packId: ID): Promise<CreditBalance>;
  };
  stats: {
    week(): Promise<WeekStats>;
  };
  diagnostics: {
    /** Sends browser warnings and errors to the server log. Best effort: never throws, never reports itself. */
    report(entries: ClientLogEntry[]): Promise<void>;
  };
}

export type AlcoveErrorCode =
  | 'unauthenticated' | 'locked' | 'not-found' | 'forbidden' | 'invalid' | 'insufficient-credits' | 'conflict' | 'unavailable'
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

export const ALCOVE_ERROR_CODES: readonly AlcoveErrorCode[] = ['unauthenticated', 'locked', 'not-found', 'forbidden', 'invalid', 'insufficient-credits', 'conflict', 'unavailable', 'key-unavailable', 'network', 'unknown'];
export const isAlcoveErrorCode = (v: unknown): v is AlcoveErrorCode => typeof v === 'string' && ALCOVE_ERROR_CODES.some((c) => c === v);

/** A user-facing message for anything thrown. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Something went wrong. Try again.';
}
export const errorCode = (e: unknown): AlcoveErrorCode => (e instanceof AlcoveApiError ? e.code : 'unknown');
