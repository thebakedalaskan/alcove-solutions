import { type FollowUpReview } from './follow-ups';
import type { DriveCallExports, DriveExportInput, DriveExportJob, DriveFolder, DriveSettings } from './drive';
import { type ID } from '../shared/ids';
import { type PersonalApi, type PromoteBody, type PromotionPreview } from './personal';
import { type NoteProgress } from './progress';
import { type AnswerPart, type Inbox, type Note, type NoteFound, type NoteKind } from './schema';
import { type Series, type SeriesAnswerPart } from './series';
import { type ActionPatch, type ActionProposal, type DecisionPatch, type DecisionProposal, type LinePatch, type QuestionPatch, type RevisitPatch } from './wire';
export interface NotesApi {
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
   * URL that streams one segment of a kept share's video (a `ScreenShare`'s, in `segment`) to a signed-in browser that
   * has the note, with ranges, so replay can seek.
   */
  screenVideoUrl(id: ID, share: ID, segment: number): string;
  /**
   * Adds a decision the notes didn't hear, proposed by you, in your exact words. Anyone who has the notes can. Sending
   * the same words again adds nothing.
   */
  proposeDecision(noteId: ID, proposal: DecisionProposal): Promise<Note>;
  /** Adds an actual task in your exact words. The assigned person accepts responsibility separately. */
  proposeAction(noteId: ID, proposal: ActionProposal): Promise<Note>;
  /** Confirms a decision, says it wasn't decided, reopens or rewords it, as far as `grants.ts` lets you. */
  updateDecision(noteId: ID, decisionId: ID, patch: DecisionPatch): Promise<Note>;
  /** Takes on or turns down (the person it's for), gives, rewords, dates or ticks a follow-up, as far as `grants.ts` lets you. */
  updateAction(noteId: ID, actionId: ID, patch: ActionPatch): Promise<Note>;
  reviewAction(noteId: ID, review: FollowUpReview): Promise<Note>;
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
   * decisions, open questions and follow-ups someone has already confirmed or changed stay as they are. With
   * `model` (an ID from `models.list()`, or null for the default model), the notes are written again with it.
   */
  rewrite(noteId: ID, o?: { model?: string | null | undefined }): Promise<Note>;
  /**
   * Stops the notes being written again, the organizer's alone: they stay as they were, with the AI model they had.
   * Anything already being written is thrown away. With nothing being written again, nothing changes. The first
   * notes for a call can't be stopped (`conflict`).
   */
  cancelRewrite(noteId: ID): Promise<Note>;
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
}

export interface SeriesApi {
  /** A series as you see it: what carries over from the newest 24 calls in it whose notes you have, and only those. */
  get(id: ID): Promise<Series>;
  /**
   * Asks across the calls in a series whose notes you have, with the calls and moments the answer
   * comes from. `timeZone` is where the asker is, as an IANA name such as "Europe/London": the
   * calls' dates are read in it, so they're the days the asker sees.
   */
  ask(id: ID, question: string, timeZone: string): AsyncIterable<SeriesAnswerPart>;
}

/** Explicitly authorized readable copies in a person's chosen Google Drive folder. */
export interface DriveApi {
  get(): Promise<DriveSettings>;
  connect(): Promise<{ url: string }>;
  pickFolder(): Promise<{ url: string }>;
  disconnect(): Promise<DriveSettings>;
  folders(): Promise<DriveFolder[]>;
  update(input: DriveExportInput): Promise<DriveSettings>;
  jobs(): Promise<DriveExportJob[]>;
  forNote(noteId: ID): Promise<DriveCallExports>;
  setForNote(noteId: ID, input: DriveExportInput | null): Promise<DriveCallExports>;
  retry(jobId: ID): Promise<DriveExportJob>;
}
