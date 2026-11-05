import type { CallCard, CallSession, LiveStore, NoteProgress, RoomRecording, RoomRecordingInput } from './live';
import type { MediaPictureOptions, MediaUploadOptions, WorkspaceMedia } from './media';
import type { CallMoveIn } from './moves';
import type { PersonalApi, PromoteBody, PromotionPreview } from './personal';
import type { IncomingRing, RingReply } from './rings';
import type { ActionPatch, ActionProposal, ClientLogEntry, DecisionPatch, DecisionProposal, DemoProvider, LinePatch, QuestionPatch, RevisitPatch } from './wire';
import type { DocAskBody, DocAskPart, DocSession, DocSessionOptions, DocVersion, DocVersionSummary, PresenterNotes, SearchDoc } from './workspaceDocuments';
import type { DocumentRole, DocumentShare, ItemInput, ItemPlace, ShareTarget, WorkspaceItem, WorkspaceLive, WorkspacePerson, WorkspaceReadOptions, WorkspaceRole, WorkspaceSummary, WorkspaceTree } from './workspaces';
import type {
  AnswerPart, Attestation, Busy, Calendar, ChangeScope, CreditBalance, DocumentLibrary, ID, ISODate, InstantCallInput, Meeting, MeetingInput, Note, NoteFound, NoteKind, NotesSetting, Inbox,
  PersonSuggestion, Preferences, Rsvp, Series, SeriesAnswerPart, Session, SignInResult, Team
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
    /**
     * Deletes the account for good, with everything it owns: the notes it organized (for everyone, audio
     * included), its recordings, meetings, groups and pins, its Google connection and every session. It's
     * taken off the notes other people gave it. Signing in again starts a new account.
     */
    delete(): Promise<void>;
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
    /** Your calls still to come, and the calls you're invited to, soonest first. */
    upcoming(): Promise<Meeting[]>;
    past(): Promise<Meeting[]>;
    /** One of your calls, or one you're invited to that hasn't ended. */
    get(id: ID): Promise<Meeting>;
    byCode(code: string): Promise<Meeting | null>;
    /**
     * Schedules a call, or with `repeat` a series of them, with one link. With Google Calendar connected it goes on the
     * calendar, which sends everyone invited one invitation. With `offer` it goes on no calendar until a time is picked.
     */
    create(input: MeetingInput): Promise<Meeting>;
    /**
     * Changes a call; a connected calendar sends everyone the update. In a series, `scope: 'following'` changes this
     * call and every later one too, and moving them says how with `repeat`, whose occurrences start at this call.
     * `repeat` on a call that doesn't repeat makes it a series.
     */
    update(id: ID, input: Patch<MeetingInput>, opts?: { scope?: ChangeScope | undefined }): Promise<Meeting>;
    /** Cancels a call; a connected calendar tells everyone. In a series, `scope: 'following'` cancels this call and every later one. */
    cancel(id: ID, opts?: { scope?: ChangeScope | undefined }): Promise<void>;
    /** Says whether you're coming to a call you're invited to. Your organizer sees the answer; Google Calendar doesn't hear about it. */
    answer(id: ID, answer: Rsvp): Promise<Meeting>;
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
    /** When you and these people are busy between two times, from what's readable: see `Busy`. */
    busy(emails: string[], range: { from: ISODate; to: ISODate }): Promise<Busy>;
    /** Where the browser goes to give Alcove access to the Google Calendar of the account it's signed in with. */
    connectUrl(): string;
    /** Forgets the Google connection: Alcove's stored access is deleted and scheduling no longer touches Google. Connect again from `connectUrl()`. */
    disconnect(): Promise<Calendar>;
    /** Makes one of your own calendar events an Alcove call: the event gets the Alcove link, and everyone invited is told. */
    adopt(eventId: ID, notes?: NotesSetting | undefined): Promise<Meeting>;
  };
  calls: {
    /** Creates a call that starts now and returns its code. */
    startNow(input?: InstantCallInput): Promise<{ code: string }>;
    /** What a call's link says before joining, for anyone, signed in or not: its title and organizer, whether notes are on, and where you stand. */
    card(code: string): Promise<CallCard>;
    /**
     * Settles a call that offers times on one of them, for anyone with its link, signed in or not. It goes on the organizer's
     * calendar then. Picking again once it's settled is refused.
     */
    pick(code: string, at: ISODate): Promise<CallCard>;
    /**
     * What carries over into a call, for someone signed in: its series as you see it, from the earlier notes you have
     * now, before joining and during the call. Null when the call isn't in a series, or you aren't its organizer and
     * have no notes from it: being invited to this call opens nothing from the others.
     */
    series(code: string): Promise<Series | null>;
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
  rings: {
    /**
     * Who's ringing you now, pushed as it changes for as long as it's open. It reconnects by itself; `close` ends it.
     * A browser opens one and the whole app reads it.
     */
    live(): LiveStore<IncomingRing[]> & { close(): void };
    /**
     * Answers a ring, which leaves `live()` at once: `join` takes it off your screen on the way to the call; the others
     * tell the organizer, and `in-5` and `in-15` ring you again then. `not-found` once the ring is gone: it was stopped,
     * or the call ended.
     */
    answer(id: ID, reply: RingReply): Promise<void>;
  };
  documents: {
    /** What you can bring to a call: every document and board you can open, by workspace. */
    list(): Promise<DocumentLibrary>;
  };
  recordings: {
    /**
     * Starts recording in the room: now, or at `startedAt` for a recording made without a connection
     * and uploaded later. Its pieces and clips say where they fall, so the note keeps the recording's
     * own times. Starting again from the same `startedAt` carries on with that recording.
     */
    start(input?: RoomRecordingInput): Promise<RoomRecording>;
  };
  notes: {
    /**
     * Every note you have, newest first, or the ones a search finds (`searchOf` says how `text` is read). A found note
     * says what was said that matched, from what you may read of it.
     */
    list(query?: { kind?: NoteKind | undefined; text?: string | undefined }): Promise<NoteFound[]>;
    get(id: ID): Promise<Note>;
    progress(id: ID): AsyncIterable<NoteProgress>;
    /**
     * URL of the first `pieces` of one decrypted audio segment, for a signed-in browser's audio element: it answers byte
     * ranges, so it starts at once and goes to any moment. A browser holds a URL to the length it first said, so a
     * recording that has grown is read at a new URL.
     */
    audioUrl(id: ID, segment: number, pieces: number): string;
    /** The same audio whole, for a browser that can't go to a moment by range. */
    audio(id: ID, segment: number, pieces: number, signal?: AbortSignal | undefined): Promise<Blob>;
    /** URL of one shared-screen frame of a note (a `ScreenMoment`'s image), for a signed-in browser that has the note. */
    screenUrl(id: ID, frameId: ID): string;
    /**
     * Adds a decision the notes didn't hear, proposed by you, in your exact words. Anyone who has the notes can. Sending
     * the same words again adds nothing.
     */
    proposeDecision(noteId: ID, proposal: DecisionProposal): Promise<Note>;
    /** Adds a follow-up the notes didn't hear, as `proposeDecision` does. It's only a suggestion until whoever it's for takes it on. */
    proposeAction(noteId: ID, proposal: ActionProposal): Promise<Note>;
    /** Confirms a decision, says it wasn't decided, reopens or rewords it, as far as `grants.ts` lets you. */
    updateDecision(noteId: ID, decisionId: ID, patch: DecisionPatch): Promise<Note>;
    /** Takes on or turns down (the person it's for), gives, rewords, dates or ticks a follow-up, as far as `grants.ts` lets you. */
    updateAction(noteId: ID, actionId: ID, patch: ActionPatch): Promise<Note>;
    /** Says an open question was answered, opens it again, or rewords it. Anyone who has the notes can. */
    updateQuestion(noteId: ID, questionId: ID, patch: QuestionPatch): Promise<Note>;
    /**
     * Says the notes got it wrong: a later call (this note) didn't replace that decision or answer that question
     * (`Series` gives the revisit's ID), or takes that back. Everyone with both notes sees who said so, and writing the
     * notes again doesn't change it. Needs both calls' notes, and for a decision, what `mayDecide` asks of saying it stopped holding.
     */
    updateRevisit(noteId: ID, revisitId: ID, patch: RevisitPatch): Promise<Note>;
    /** Follow-ups for you that aren't done, taken on or only suggested, and decisions nobody has confirmed, from every note you have. */
    inbox(): Promise<Inbox>;
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
    /** Answers a question about one written note from its transcript, or from the notes once that's deleted, citing moments in it and the shared screens it read. */
    ask(noteId: ID, question: string): AsyncIterable<AnswerPart>;
    /**
     * Answers a question from every note you have, your own and ones shared with you, citing the notes
     * and moments it comes from. With no written notes to go on, it says so and asks no model.
     */
    askAll(question: string): AsyncIterable<AnswerPart>;
    /**
     * Shares the notes with more people, by email. For one of your groups, send its addresses and its
     * name: everyone it reaches sees who shared the notes and with which group. They find them in
     * Alcove when they sign in.
     */
    share(id: ID, to: { emails: string[]; group?: string | undefined }): Promise<Note>;
    /** Your own notes on these notes: only ever yours, whoever else has them. */
    personal(id: ID): PersonalApi;
    /** What adding one of your own entries to the shared notes would do: exactly what goes, where, and who gets it. Sends nothing. */
    previewAddition(id: ID, entryId: ID): Promise<PromotionPreview>;
    /** Adds it, as previewed, for everyone with the notes. Refused if the people or the moments changed since the preview. */
    addToShared(id: ID, entryId: ID, body: PromoteBody): Promise<Note>;
    /** Takes something added to the shared notes out of them, for good: your own addition, or any on your own notes. */
    takeBack(id: ID, additionId: ID): Promise<Note>;
    /**
     * Deletes your own notes for everyone, with everyone's own notes on them; or removes someone else's from your notes,
     * with your own notes on them. What you added to the shared notes stays with them.
     */
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
  workspaces: {
    /** Every workspace you're in, then each one you only have documents in. */
    list(): Promise<WorkspaceSummary[]>;
    /** Makes a workspace with you as its admin. */
    create(name: string): Promise<{ id: ID }>;
    /** A workspace as you see it. Anyone who can't open it gets the same `not-found` as for a workspace that doesn't exist. */
    get(id: ID, opts?: WorkspaceReadOptions): Promise<WorkspaceTree>;
    /** Admins only. */
    rename(id: ID, name: string): Promise<void>;
    /** Deletes a workspace for good, for everyone, with everything in it. Admins only. */
    remove(id: ID): Promise<void>;
    /** Everyone in a workspace, for anyone in it. */
    people(id: ID): Promise<WorkspacePerson[]>;
    /** Adds someone by address, whether or not they use Alcove yet, or sets their role if they're in it. Admins only. */
    addPerson(id: ID, email: string, role: WorkspaceRole): Promise<{ id: ID }>;
    /** Admins only, and a workspace always keeps an admin. */
    setRole(id: ID, personId: ID, role: WorkspaceRole): Promise<void>;
    /** Takes someone out: an admin can anyone, and anyone can themselves. A workspace always keeps an admin. */
    removePerson(id: ID, personId: ID): Promise<void>;
    items: {
      /** One document, board or folder, if you can open it. */
      get(id: ID, itemId: ID, opts?: WorkspaceReadOptions): Promise<WorkspaceItem>;
      /** Makes one, last in `parent` (the top when left out) unless `after` says otherwise. */
      create(id: ID, input: ItemInput): Promise<{ id: ID }>;
      /** Anyone who can edit it, so a document's title can follow what's typed. */
      rename(id: ID, itemId: ID, name: string, opts?: WorkspaceReadOptions): Promise<void>;
      /** Moves it to another folder or another place among its siblings. A folder can't go inside itself. */
      move(id: ID, itemId: ID, to: ItemPlace): Promise<void>;
      /** A copy just after it, with everything you can open inside a folder. A copy isn't shared with anyone, and a copy of something restricted is restricted, to you. */
      duplicate(id: ID, itemId: ID): Promise<{ id: ID }>;
      /** Moves it to Trash, for everyone, for 30 days. A folder takes what's in it, except anything you can't open, which stays in the tree. */
      trash(id: ID, itemId: ID): Promise<void>;
      /** Brings it back, to the top if its folder isn't in the tree any more. Anyone who can edit it. */
      restore(id: ID, itemId: ID, opts?: WorkspaceReadOptions): Promise<void>;
      /** Deletes something in Trash for good, for everyone. */
      deleteForever(id: ID, itemId: ID): Promise<void>;
    };
    share: {
      /** Who has a document: for people in the workspace who can edit it, like everything else here. */
      list(id: ID, documentId: ID): Promise<DocumentShare>;
      /**
       * Opens a document for everyone in `to`, all of them or none, or changes what they can do with it. Sharing with a
       * seat takes the pass of the call it's in, and ends with the call.
       */
      set(id: ID, documentId: ID, to: ShareTarget[], role: DocumentRole, opts?: WorkspaceReadOptions): Promise<void>;
      remove(id: ID, documentId: ID, entryId: ID): Promise<void>;
      /** Restricts a document to its creator and the people it's shared with, or opens it to the workspace again. Whoever restricts it keeps it. */
      restrict(id: ID, documentId: ID, restricted: boolean): Promise<void>;
    };
    /**
     * Files in a workspace's documents and boards. A file is reached through a document that has it: whoever can open
     * that document can read it, and nobody else. Taking a block out of a document leaves the file there, for a version or
     * for reuse: it goes when every document that has it is deleted for good, or when someone deletes it (`remove`).
     */
    media: {
      /**
       * Keeps a file in a document, for anyone who can edit it, a piece at a time. A piece that fails is tried again, and
       * through a lost connection or a busy server it keeps trying for minutes, so what's stored isn't lost to a Wi-Fi
       * handover. Pictures, video and audio are shown in place; anything else is served as a download. If it fails for good
       * it rejects and leaves nothing behind. What's allowed changes without a release, so the refusal says what it is: a file
       * over the limit in force, 512 MiB unless it's changed and never more than `MAX_MEDIA_BYTES`, is `invalid` at the start,
       * "This file is bigger than 512 MiB, the most a file can be.", and a full workspace or a day's uploads used up is
       * `conflict`, with a message that says which. With a limit at zero, it's "Files can’t be uploaded right now." Show the
       * message: it's written for the person uploading.
       */
      upload(id: ID, documentId: ID, file: File, opts?: MediaUploadOptions): Promise<WorkspaceMedia>;
      /**
       * Where to read a file through a document, for an `<img>`, a player or a download: it answers `Range`, and lasts 12
       * hours. It says only who's asking and is no reason to let them: each request looks again, so someone who loses the
       * document gets `not-found`, however good the URL. Someone signed in reads it only with their own session; for a
       * guest the URL is all there is, so never log one or put one anywhere it could be read. For a player or a download:
       * a picture goes through `picture`. A read can be refused for a moment when too many are going on.
       */
      url(id: ID, documentId: ID, mediaId: ID, opts?: WorkspaceReadOptions): Promise<string>;
      /**
       * A picture, for an `<img>`, as an object URL: everything a board or a document shows goes through this, so a whole
       * call opening the same board at once all see it. A browser reads a few at a time, and one the server's too busy for
       * tries again, for minutes, until it's read or `signal` stops it. `not-found` is at once, and means it's been removed.
       * The URL is yours: call `URL.revokeObjectURL` when the picture leaves the page, or its bytes stay in the browser's
       * memory. Video and audio stay on `url`, which a player can read by range.
       */
      picture(id: ID, documentId: ID, mediaId: ID, opts?: MediaPictureOptions): Promise<string>;
      /** Reuses a file you can reach in another document of the same workspace, for anyone who can edit that one. */
      attach(id: ID, documentId: ID, mediaId: ID, opts?: WorkspaceReadOptions): Promise<void>;
      /** Every file you can reach in a workspace, the newest first, each with the documents you can reach it through. */
      list(id: ID, opts?: WorkspaceReadOptions): Promise<WorkspaceMedia[]>;
      /**
       * Deletes a file for good, for everyone, or takes back an upload that hasn't finished: for anyone who can edit a
       * document that has it, beyond a seat in a call, and every other document they can open that has it, or it's
       * `forbidden`. Older versions and any other document that had it get `not-found` from then on, which is the app's cue
       * to show it as removed.
       */
      remove(id: ID, documentId: ID, mediaId: ID, opts?: WorkspaceReadOptions): Promise<void>;
    };
    /** A workspace kept up to date until `close()`, or until you lose it (`status: 'closed'`). */
    live(id: ID, opts?: WorkspaceReadOptions): WorkspaceLive;
    /**
     * One document or board, worked on together until `close()`, or until you lose it (`closed` in its status). It starts at
     * once, and stays up through dropped connections and restarts: what's typed meanwhile sends when it can, and with `keep`
     * survives a reload.
     */
    document(id: ID, documentId: ID, opts?: DocSessionOptions): Promise<DocSession>;
    /**
     * Makes a new document or board of a state, such as one made of what `DocSession.unsentCopy` gave, for words that couldn't reach the one they were
     * written in. Made like any other, by anyone who can make one, and nothing's left behind if it can't be.
     */
    saveCopy(id: ID, input: ItemInput & { state: Uint8Array }): Promise<{ id: ID }>;
    /** What a document looked like: the versions kept of it, the newest first. For anyone who can open it. */
    versions(id: ID, documentId: ID, opts?: WorkspaceReadOptions): Promise<DocVersionSummary[]>;
    /** One version with its whole state, for showing it. */
    version(id: ID, documentId: ID, versionId: ID, opts?: WorkspaceReadOptions): Promise<DocVersion>;
    /**
     * Makes a document as it was in a version, for everyone, as an edit like any other. What it says now is kept as a
     * version first, so nothing is lost. Anyone who can edit it.
     */
    restoreVersion(id: ID, documentId: ID, versionId: ID, opts?: WorkspaceReadOptions): Promise<void>;
    /** Every document you can open here as blocks of words, for searching in this browser: nothing you type in a search reaches Alcove. */
    searchText(id: ID, opts?: WorkspaceReadOptions): AsyncIterable<SearchDoc>;
    /** What you keep beside a document for presenting it: yours alone, under your own account, whoever else can open it. */
    presenterNotes: {
      get(id: ID, documentId: ID, opts?: WorkspaceReadOptions): Promise<PresenterNotes>;
      /** Empty text deletes them. */
      set(id: ID, documentId: ID, text: string, opts?: WorkspaceReadOptions): Promise<void>;
    };
    /**
     * The format bar's Make this shorter and Turn this into a checklist: what's selected goes to the notes model in confidential
     * compute, and what comes back is for the person asking to put in the document. Needs `edit`. Nothing is kept, and in a
     * call it waits while notes are paused, like everything that reaches the AI.
     */
    ask(id: ID, documentId: ID, body: DocAskBody, opts?: WorkspaceReadOptions): AsyncIterable<DocAskPart>;
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
  | 'key-unavailable' | 'too-large' | 'network' | 'unknown';

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

export const ALCOVE_ERROR_CODES: readonly AlcoveErrorCode[] = ['unauthenticated', 'not-found', 'forbidden', 'invalid', 'insufficient-credits', 'conflict', 'unavailable', 'key-unavailable', 'too-large', 'network', 'unknown'];
export const isAlcoveErrorCode = (v: unknown): v is AlcoveErrorCode => typeof v === 'string' && ALCOVE_ERROR_CODES.some((c) => c === v);

/** A user-facing message for anything thrown. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Something went wrong. Try again.';
}
export const errorCode = (e: unknown): AlcoveErrorCode => (e instanceof AlcoveApiError ? e.code : 'unknown');
