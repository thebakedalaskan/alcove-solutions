/* What a call gives the workspace of its notes, follow-ups and transcript, and what the side panels get back. */
import type { CallSession, LiveStore, Person, TranscriptLine } from '@alcove/api';

/** The call's own pages, at the top of the list. */
export type LivePageId = 'notes' | 'follow-ups' | 'transcript';
/** The pages that also open beside the document, as side panels. */
export type LiveBeside = 'notes' | 'transcript';

/** A follow-up on its way into a document. */
export interface FollowUpToSend { text: string; owner?: string | undefined; due?: string | undefined }

/**
 * Sending something from the call into the document you were last in, while you can edit it. It lands at the end of the
 * document: where it can be seen if that's open on the page, and with a toast that goes there if it isn't.
 */
export interface LivePut {
  /** What the document's called, for the arrows' labels. */
  target: string;
  decided: (text: string) => void;
  /** Lands as a checklist line, with who it's for and when tagged. */
  followUp: (f: FollowUpToSend) => void;
  /** Quotes a line of the transcript, with who said it and when. */
  line: (line: TranscriptLine) => void;
}

/** What the call hands the workspace. One a call has for good: it reads what changes from `session`. */
export interface LiveCall {
  session: CallSession;
  /** Who's talking now, at the end of the transcript. */
  speaking: LiveStore<Person | null>;
  /** The organizer turns notes on or off. */
  notes: (on: boolean) => void;
  /** Anyone else asks for notes, or takes the ask back. */
  ask: (up: boolean) => void;
  /** Shows Notes or the transcript as a panel beside the document. */
  beside: (view: LiveBeside) => void;
  /** Brings the workspace back, for what a toast offers while it's closed or behind a panel. */
  reveal: () => void;
  /** A panel is over the page, as it is on a phone, so nothing on it can be seen landing. */
  covered: () => boolean;
  /** Says where the side panels' arrows send things. */
  onPut: (put: LivePut | null) => void;
}
