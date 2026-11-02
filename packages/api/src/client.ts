import type { CallSession, NoteProgress, RoomRecording } from './live';
import type {
  AnswerPart, AuthProvider, CalendarConnection, CalendarProvider, CallLink, CreditBalance, CreditEvent, CreditPack,
  ID, Meeting, MeetingInput, MeetingNotesSetting, Note, NoteKind, NoteSummary, NotesAudience, NotesMode, OpenAction, Passkey,
  Preferences, Session, SetupStep, WeekStats
} from './types';

/** Everything the frontend can ask of the backend. */
export interface AlcoveApi {
  auth: {
    getSession(): Promise<Session | null>;
    /** Runs the provider's sign-in. The real client redirects; the mock resolves after a short delay. */
    signIn(provider: AuthProvider, email?: string): Promise<Session>;
    createPasskey(): Promise<Passkey>;
    signOut(): Promise<void>;
  };
  account: {
    preferences(): Promise<Preferences>;
    updatePreferences(patch: Partial<Preferences>): Promise<Preferences>;
    passkeys(): Promise<Passkey[]>;
    addPasskey(): Promise<Passkey>;
    calendars(): Promise<CalendarConnection[]>;
    setCalendar(provider: CalendarProvider, connected: boolean): Promise<CalendarConnection[]>;
    setupSteps(): Promise<SetupStep[]>;
  };
  meetings: {
    upcoming(): Promise<Meeting[]>;
    past(): Promise<Meeting[]>;
    get(id: ID): Promise<Meeting>;
    byCode(code: string): Promise<Meeting | null>;
    create(input: MeetingInput): Promise<Meeting>;
    update(id: ID, input: Partial<MeetingInput>): Promise<Meeting>;
    setNotes(id: ID, notes: MeetingNotesSetting): Promise<Meeting>;
    resendInvite(id: ID, email: string): Promise<void>;
    cancel(id: ID): Promise<void>;
  };
  links: {
    create(notes: MeetingNotesSetting): Promise<CallLink>;
  };
  calls: {
    /**
     * Joins a call by code. `name` is required for guests without a session.
     * Hosts pass `notes` to decide notes at join time when the meeting is set to `ask`.
     */
    join(code: string, opts: { name?: string | undefined; mic: boolean; cam: boolean; notes?: NotesMode | undefined; audience?: NotesAudience | undefined; instant?: boolean | undefined }): Promise<CallSession>;
    /** Starts a brand new call and returns its code. */
    createInstant(): Promise<{ code: string }>;
  };
  recordings: {
    start(title?: string): Promise<RoomRecording>;
  };
  notes: {
    list(query?: { kind?: NoteKind | undefined; text?: string | undefined }): Promise<NoteSummary[]>;
    get(id: ID): Promise<Note>;
    progress(id: ID): AsyncIterable<NoteProgress>;
    setActionDone(noteId: ID, actionId: ID, done: boolean): Promise<void>;
    openActions(): Promise<OpenAction[]>;
    ask(noteId: ID, question: string): AsyncIterable<AnswerPart>;
    shareLink(noteId: ID): Promise<string>;
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
}

export type AlcoveErrorCode =
  | 'unauthenticated' | 'not-found' | 'forbidden' | 'invalid' | 'insufficient-credits' | 'conflict' | 'network' | 'unknown';

export class AlcoveApiError extends Error {
  constructor(public readonly code: AlcoveErrorCode, message: string) {
    super(message);
    this.name = 'AlcoveApiError';
  }
}

export const ALCOVE_ERROR_CODES: readonly AlcoveErrorCode[] = ['unauthenticated', 'not-found', 'forbidden', 'invalid', 'insufficient-credits', 'conflict', 'network', 'unknown'];
export const isAlcoveErrorCode = (v: unknown): v is AlcoveErrorCode => typeof v === 'string' && ALCOVE_ERROR_CODES.some((c) => c === v);

/** A user-facing message for anything thrown. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Something went wrong. Try again.';
}
export const errorCode = (e: unknown): AlcoveErrorCode => (e instanceof AlcoveApiError ? e.code : 'unknown');
