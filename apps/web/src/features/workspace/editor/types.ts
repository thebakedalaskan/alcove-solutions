/*
 * The Editor's whole surface: what it's given and what it gives back. Everything here is a plain value or a
 * handler, so screens wire it up without touching ProseMirror or knowing how a block is drawn.
 */
import type { Person } from '@alcove/api';
import type { IconName } from '@alcove/ui';
import type { ReactNode, Ref } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { Doc } from 'yjs';

/** A block or inline piece as plain data: ProseMirror's JSON for the nodes in schema.ts. */
export interface BlockJSON {
  type: string;
  attrs?: Record<string, unknown> | undefined;
  content?: BlockJSON[] | undefined;
  marks?: { type: string; attrs?: Record<string, unknown> | undefined }[] | undefined;
  text?: string | undefined;
}

/** Where blocks go. `replace` takes the place of that block; `all` takes the place of every block, leaving the title. */
export type InsertAt = { after: string } | { before: string } | { replace: string } | 'start' | 'end' | 'caret' | 'all';

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
  send: (message: { by: string; name: string; text: string }) => string;
  cancel: () => void;
}

/** Someone pressed Ask on the selection. */
export interface AskDraft {
  text: string;
  block: string;
  rect: Rect;
  /** Puts `blocks` where the selection was. */
  replace: (blocks: BlockJSON[]) => void;
}

/** The `/` items that need more than the editor has. `at` is where what they make should go, for `insertBlocks`. */
export interface MediaPick {
  kind: 'photo' | 'video' | 'file';
  /** A photo opens an empty gallery straight away; this is its ID. Null for a video or a file, which appear once picked. */
  block: string | null;
  at: InsertAt;
  rect: Rect | null;
}

/** A line of the transcript, for Quote what was said. */
export interface MomentLine { id: string; person: Person | null; name: string; at: string; text: string }

/** One line a `live` block shows. */
export interface LiveLine { text: string; at: string; person?: string | null | undefined; name?: string | undefined; due?: string | undefined }

export type LiveWhat = 'decided' | 'followups';

/** What a document knows about the call it's open in. Without it, From the call isn't offered. */
export interface EditorCall {
  /** Notes are on for this call. */
  notes: boolean;
  /** The last few lines of the transcript, newest first. */
  recent: () => MomentLine[];
  /** A `live` block was just added: fill it with `setLiveLines`. */
  onLive?: ((what: LiveWhat, block: string) => void) | undefined;
  /** Hear it, on a quote. */
  onHear?: ((moment: { line: string | null; at: string }) => void) | undefined;
}

/** A video playing for everyone, for the block it's in. */
export interface VideoPlay { block: string; seconds: number; total: number }

/** What photos, videos and files need from outside. */
export interface MediaHandlers {
  /** Where a stored file can be read, or a local preview while it uploads. Undefined until there's something to show. */
  url: (media: string) => string | undefined;
  /** Try again, on a block that couldn't upload. */
  onRetry?: ((block: string) => void) | undefined;
  /** The download on a file block. */
  onOpenFile?: ((file: { media: string; name: string }) => void) | undefined;
  /** Play for everyone. Without it, a video shows no button. */
  onPlay?: ((block: string) => void) | undefined;
  /** The video playing for everyone now, if it's in this document. */
  playing?: VideoPlay | null | undefined;
}

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
  /** Files were dropped on the page or pasted. `at` is where the line showed. */
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
  /** Sits between the title and the first block: who wrote this and when. */
  byline?: ReactNode | undefined;
  /** Sits under the last block, above the space that adds a line: what a new document can start from. */
  below?: ReactNode | undefined;
  /** Where the caret starts when the document opens. */
  autoFocus?: 'title' | 'end' | undefined;
  ref?: Ref<EditorHandle> | undefined;
}

/** What screens can do to an open document. */
export interface EditorHandle {
  /** Puts the caret in the title, or at the start or end of the blocks. */
  focus: (where?: 'title' | 'start' | 'end') => void;
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
  /** Writes what every `live` block of this kind shows. Only writes if it changed, so any browser in the call can do this. */
  setLiveLines: (what: LiveWhat, lines: LiveLine[]) => void;
  /** Opens `/` or `@` at the caret, for a phone's keyboard bar. */
  openSlash: () => void;
  openMention: () => void;
  /** Bold, italic and so on, for a phone's keyboard bar. */
  toggleMark: (mark: 'bold' | 'italic' | 'strike' | 'inlineCode' | 'highlight') => void;
  /** Turns the block the caret is in into another kind, for a phone's keyboard bar. */
  turnInto: (kind: BlockKind) => void;
}

/** The kinds of text block, as Turn into and `/` name them. */
export type BlockKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'todo' | 'toggle' | 'quote' | 'callout' | 'code';
