/*
 * The Editor's whole surface: what it's given and what it gives back. Everything here is a plain value or a
 * handler, so screens wire it up without touching ProseMirror or knowing how a block is drawn.
 */
import type { DocAskPart, Person } from '@alcove/api';
import type { IconName } from '@alcove/ui';
import type { ReactNode, Ref } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { Doc } from 'yjs';
import type { DocSection } from './sections';

/** A block or inline piece as plain data: ProseMirror's JSON for the nodes in schema.ts. */
export interface BlockJSON {
  type: string;
  attrs?: Record<string, unknown> | undefined;
  content?: BlockJSON[] | undefined;
  marks?: { type: string; attrs?: Record<string, unknown> | undefined }[] | undefined;
  text?: string | undefined;
}

/**
 * Where blocks go. `replace` takes the place of that block; `all` takes the place of every block, leaving the title;
 * `tail` goes at the end, in place of an empty last line.
 */
export type InsertAt = { after: string } | { before: string } | { replace: string } | 'start' | 'end' | 'tail' | 'caret' | 'all';

/** A point in the window, from a pointer. */
export interface Point { x: number; y: number }

/** A place to anchor something: where it is in the window, as `getBoundingClientRect` gives it. */
export type Rect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>;

/** One thing `@` can tag. */
export type MentionItem =
  | { kind: 'person'; person: Person; sub?: string | undefined }
  | { kind: 'document'; id: string; name: string }
  /** `date` is YYYY-MM-DD. */
  | { kind: 'date'; date: string; label: string };

/** A headed part of the `@` list, in the order it shows. */
export interface MentionSection { title: string; items: MentionItem[] }

/** What Copy, Move to… and a drop on the document list hand over: the block itself and its ID here. */
export interface MovingBlock { id: string; block: BlockJSON; label: string }

/**
 * A place outside the page a block can be dropped on, like a document in the list. `over` runs as the block moves:
 * return true when what's under the pointer takes it, and light it up; no landing line shows then. `drop` runs on
 * letting go over a target; resolve true once the block is safely in its new document and it leaves this one.
 * `leave` runs when the pointer moves off, or the drag stops, so a lit-up target can go dark.
 */
export interface BlockDropTarget {
  over: (at: Point, block: MovingBlock) => boolean;
  drop: (at: Point, block: MovingBlock) => boolean | Promise<boolean>;
  leave: () => void;
}

/** Someone asked for a comment on the selection. The words stay marked until one of these runs. */
export interface CommentDraft {
  /** The words selected. */
  quote: string;
  block: string;
  rect: Rect;
  /** Marks the words and starts the thread with its first message. Returns the thread's ID. */
  send: (message: { by: string; name: string; text: string; tags?: { id: string; name: string }[] | undefined }) => string;
  cancel: () => void;
}

/**
 * Someone pressed Ask on the selection. The words stay marked, and held by what they are, until `done`: whatever others type
 * meanwhile, what comes back goes where they are by then.
 */
export interface AskDraft {
  /** The words selected, with tags spelled out, as they go to Alcove. */
  text: string;
  block: string;
  rect: Rect;
  /** Alcove's writing: the caret steps off the words, so typing on can't replace them, and dots show beside them. */
  wait: () => void;
  /**
   * Puts in what came back, as it comes: words take the selection's place, and each line of a checklist follows the one before.
   * If someone changed the words meanwhile, those stay, and this goes under them.
   */
  write: (part: DocAskPart) => void;
  /** Lets go of the words, whether or not anything came. */
  done: () => void;
}

/** The `/` items that need more than the editor has. `at` is where what they make should go, for `insertBlocks`. */
export interface MediaPick {
  kind: 'photo' | 'video' | 'file';
  /** A photo opens an empty gallery straight away; this is its ID. Null for a video or a file, which appear once picked. */
  block: string | null;
  at: InsertAt;
  rect: Rect | null;
}

/** A line of the transcript, for Quote what was said. `at`: when, as an ISO time. `note`: the notes it'll be in, by ID, so whoever has them can hear it. */
export interface MomentLine { id: string; person: Person | null; name: string; at: string; text: string; note: string | null }

/** One line a `live` block shows. `at` is when, as an ISO time, and `due` the words it was said in: each reader reads them their way. */
export interface LiveLine { text: string; at: string; person?: string | null | undefined; name?: string | undefined; due?: string | undefined }

export type LiveWhat = 'decided' | 'followups';

/** What a document knows about the call it's open in. Without it, From the call isn't offered. */
export interface EditorCall {
  /** Which call. A `live` block belongs to the call it was added in, and stays as it was once that's over. */
  id: string;
  /** Notes are on for this call. */
  notes: boolean;
  /** The last few lines of the transcript, newest first. */
  recent: () => MomentLine[];
  /** A `live` block was just added: fill it with `setLiveLines`. */
  onLive?: ((what: LiveWhat, block: string) => void) | undefined;
}

/** Where a video playing for everyone is, in seconds, and how long it is: 0 until that's known. */
export interface VideoClock { seconds: number; total: number }

/**
 * A video playing for everyone in the call, for the blocks that hold it. It plays once, in the call, whether or not anyone
 * has its document open: a block holding it shows the picture everyone's watching, with where it's got to.
 */
export interface VideoPlay {
  /** The file playing, as a video block's `media` names it. */
  media: string;
  /** Read with `useSyncExternalStore`: it moves on every second or so, and nothing else has to draw again for it. */
  clock: { subscribe: (listener: () => void) => () => void; getSnapshot: () => VideoClock };
  /** Puts the picture in a block, until what it returns is called. The last block to ask has it. */
  show: (into: HTMLElement) => () => void;
}

/**
 * A stored file as this browser has it. `ready` holds a picture to show, which the handlers own and let go of themselves;
 * `gone` is a file someone deleted for good, which shows as deleted, in older versions too.
 */
export type MediaState = { kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'gone' } | { kind: 'failed' };

/** Stored files, as blocks show them: everything here is read while drawing, and `changes` says when to draw again. */
export interface MediaHandlers {
  /** A picture that's here: what `state` says when it's ready, for what only wants a picture. */
  url: (media: string) => string | undefined;
  /** A stored picture as it stands. A block asks for it with `hold` while it's on the page. */
  state?: ((media: string) => MediaState) | undefined;
  /** Reads a stored picture for as long as a block shows it; what it returns lets go. */
  hold?: ((media: string) => () => void) | undefined;
  /** Whether a stored file that isn't a picture has been deleted for good: a file block's or a video's. */
  gone?: ((media: string) => boolean) | undefined;
  /** Keeps an eye on whether a stored file that isn't a picture is still there, while a block shows it; what it returns stops. */
  watch?: ((media: string) => () => void) | undefined;
  /** Counts every change to what the handlers say. Read it with `useSyncExternalStore`. */
  changes?: { subscribe: (listener: () => void) => () => void; getSnapshot: () => number } | undefined;
  /** The file this browser is sending into a block, at its place in the block, to show while it goes. */
  preview?: ((block: string, index: number) => string | undefined) | undefined;
  /** A block says it's uploading, and nobody is any more: it shows as failed, with only Delete. */
  stalled?: ((block: string) => boolean) | undefined;
  /** Try again, on a block that couldn't upload: only where this browser still has what it was sending. */
  onRetry?: ((block: string) => void) | undefined;
  canRetry?: ((block: string) => boolean) | undefined;
  /** Where a player reads a video from, asked for afresh. Rejects for one that's gone. */
  stream?: ((media: string) => Promise<string>) | undefined;
  /** A video found out how long it is: for a block that didn't say. */
  onDuration?: ((block: string, seconds: number) => void) | undefined;
  /** The download on a file block. */
  onOpenFile?: ((file: { media: string; name: string }) => void) | undefined;
  /** A press on an empty Photos block: offer the picker again, against it. */
  onChoose?: ((block: string, rect: Rect) => void) | undefined;
  /** Delete for good, from a block's menu: the files in the block, for everyone, and everywhere they are. */
  onDeleteFiles?: ((files: MediaDeletion) => void) | undefined;
  /** Play for everyone, on a video: its block, and its file as `media` names it. Without it, a video shows no button. */
  onPlay?: ((video: { block: string; media: string }) => void) | undefined;
  /** The video playing for everyone now, if it's in this document. */
  playing?: VideoPlay | null | undefined;
}

/** A block's files, on their way to being deleted for good. `what` names them: a file's name, or how many photos. */
export interface MediaDeletion { block: string; media: string[]; what: 'photo' | 'photos' | 'video' | 'file'; name: string; rect: Rect }

/** A word on the page, for the caller to show as a toast. */
export interface EditorToast { icon: IconName; text: string; label?: string | undefined; run?: (() => void) | undefined }

/** Where the writer is, for presence. `typing` holds for 1.5 s after a keystroke. */
export interface EditorPresence { block: string | null; typing: boolean }

export interface EditorProps {
  /** Mount once the first sync is in: every document holds its title and first line from the moment the server makes it. */
  doc: Doc;
  /** Each state may hold `user: { id, name }`; `id` is looked up in `people` for the face. */
  awareness: Awareness;
  readOnly?: boolean | undefined;
  /** What the title says while nobody has written one: a document can be made with a name and an empty title. */
  titleHint?: string | undefined;
  /** Everyone who may show up in this document, for faces on carets, tags, quotes and live lines. */
  people?: readonly Person[] | undefined;
  /** What `@` offers for what's been typed after it. With `docsOnly`, just documents, for Link to a document. */
  onMention?: ((query: string, options: { docsOnly: boolean }) => MentionSection[]) | undefined;
  /** A document's name, for this reader. Undefined means they can't open it, and it's never named. */
  documentName?: ((id: string) => string | undefined) | undefined;
  /** A tag or a link to another document was pressed. */
  onOpenDocument?: ((id: string) => void) | undefined;
  /** A person's name in the text was pressed. */
  onOpenPerson?: ((id: string, rect: Rect) => void) | undefined;
  /** Someone was just tagged: tell them, or ask before sharing. */
  onTagged?: ((person: Person, block: string, rect: Rect | null) => void) | undefined;
  /** Files were dropped on the page or pasted. `at` is where the line showed, or the empty Photos block they landed on. */
  onUpload?: ((files: File[], at: InsertAt) => void) | undefined;
  /** Photos, Video or File was picked from `/`. */
  onPick?: ((pick: MediaPick) => void) | undefined;
  /**
   * A `gallery`, `file` or `video` arrived by paste or drop holding a stored file this document doesn't use yet, so it
   * came from another document: attach it to this one on the server. Once per file, for each file in the block.
   */
  onAttachMedia?: ((mediaId: string) => void) | undefined;
  media?: MediaHandlers | undefined;
  call?: EditorCall | undefined;
  /** Hear it, on a quote, in a call or not: what plays that moment, for someone who has the notes it's in. It draws nothing for anyone else. */
  hear?: ((moment: { note: string; line: string }) => ReactNode) | undefined;
  /** Comment was pressed, or ⌘⇧M, with words selected. Without it, there's no Comment button. */
  onComment?: ((draft: CommentDraft) => void) | undefined;
  /** Words with a comment on them, or the count in the margin, were pressed. */
  onOpenThread?: ((id: string, rect: Rect) => void) | undefined;
  /** Ask was pressed with words selected. Without it, there's no Ask button. */
  onAsk?: ((ask: AskDraft) => void) | undefined;
  /** The title changed here, 300 ms after the last key, so the list can follow. */
  onTitle?: ((title: string) => void) | undefined;
  onPresence?: ((presence: EditorPresence) => void) | undefined;
  /** Copy link, in a block's menu. Without it, the item isn't offered. */
  onCopyBlockLink?: ((block: string) => void) | undefined;
  /** The documents a block can go to, for Move to… in its menu. Without it, the item isn't offered. */
  moveTargets?: (() => { id: string; name: string }[]) | undefined;
  /** A block was sent to another document from its menu. Resolve true once it's there and it leaves this one. */
  onMoveBlock?: ((block: MovingBlock, to: string) => boolean | Promise<boolean>) | undefined;
  blockDrop?: BlockDropTarget | undefined;
  onToast?: ((toast: EditorToast) => void) | undefined;
  /** Blocks to tint, by ID: what changed in a version of the document. */
  changed?: ReadonlySet<string> | undefined;
  /** Sits between the title and the first block: who wrote this and when. */
  byline?: ReactNode | undefined;
  /** Sits under the last block, above the space that adds a line. */
  below?: ReactNode | undefined;
  /** Takes `below`'s place while nothing is written under the title: what a new document can start from. */
  whenBlank?: ReactNode | undefined;
  /** Where the caret starts when the document opens. */
  autoFocus?: 'title' | 'end' | undefined;
  /**
   * The audience's view of a presentation: only this section (sections.ts), and the title only with the first. Pass
   * `readOnly` with it. A number past the last section shows the last.
   */
  section?: number | null | undefined;
  /** The document's sections, now and whenever they change, for presenting it. */
  onSections?: ((sections: readonly DocSection[]) => void) | undefined;
  ref?: Ref<EditorHandle> | undefined;
}

/** What screens can do to an open document. */
export interface EditorHandle {
  /** Puts the caret in the title, or at the start or end of the blocks. */
  focus: (where?: 'title' | 'start' | 'end') => void;
  /** Gives the keyboard back to the text, with the caret at the end of whatever was selected. */
  resume: () => void;
  focusBlock: (id: string, at?: 'start' | 'end') => void;
  /** Brings a block into view, 110 px from the top. `flash` makes it glow for 1.6 s, `smooth` takes 420 ms. */
  scrollToBlock: (id: string, options?: { smooth?: boolean | undefined; flash?: boolean | undefined }) => void;
  flashBlock: (id: string) => void;
  /** Adds blocks, with fresh IDs, and returns them. `focus` puts the caret at the end of the last one, `flash` makes them glow, `appear` fades them in together. */
  insertBlocks: (blocks: BlockJSON[], at: InsertAt, options?: { focus?: boolean | undefined; flash?: boolean | undefined; appear?: boolean | undefined }) => string[];
  /** Changes a block's attributes. Keep `history` false for what the writer didn't do, like upload progress. */
  updateBlock: (id: string, attrs: Record<string, unknown>, options?: { history?: boolean | undefined }) => void;
  removeBlock: (id: string) => void;
  /** The block the caret is in, or null with the caret outside the blocks. */
  selectionBlock: () => string | null;
  /** A block as plain data, for sending it somewhere else. */
  blockJSON: (id: string) => BlockJSON | null;
  /** Where a block is now, to put it back there: after the block before it, or at the start. */
  placeOf: (id: string) => InsertAt;
  /** What every block with text in it says now, for looking through without waiting on Alcove. */
  blockWords: () => { id: string; text: string }[];
  /** Writes what every `live` block of this kind in this call shows. Only writes if it changed, so any browser in the call can do this. */
  setLiveLines: (what: LiveWhat, lines: LiveLine[]) => void;
  /** Whether this document has a `live` block of this call. */
  hasLive: () => boolean;
  /** Opens `/` or `@` at the caret, for a phone's keyboard bar. */
  openSlash: () => void;
  openMention: () => void;
  /** Tag someone in this document: their name on the last line, or a new one, with the caret after it. */
  tag: (person: Person) => void;
  /** Bold, italic and so on, for a phone's keyboard bar. */
  toggleMark: (mark: 'bold' | 'italic' | 'strike' | 'inlineCode' | 'highlight') => void;
  /** Turns the block the caret is in into another kind, for a phone's keyboard bar. */
  turnInto: (kind: BlockKind) => void;
}

/** The kinds of text block, as Turn into and `/` name them. */
export type BlockKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'todo' | 'toggle' | 'quote' | 'callout' | 'code';
