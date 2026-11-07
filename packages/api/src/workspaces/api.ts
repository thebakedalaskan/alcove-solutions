import { type ID } from '../shared/ids';
import { type BoardSortBody, type BoardThemes, type DocAskBody, type DocAskPart, type DocSession, type DocSessionOptions, type DocVersion, type DocVersionSummary, type PresenterFrameNotes, type SearchDoc } from './documents';
import { type DocumentLibrary } from './library';
import { type MediaPictureOptions, type MediaUploadOptions, type WorkspaceMedia } from './media';
import { type DocumentRole, type DocumentShare, type ItemInput, type ItemPlace, type MentionBody, type MentionNotice, type ShareTarget, type WorkspaceItem, type WorkspaceLive, type WorkspacePerson, type WorkspaceReadOptions, type WorkspaceRole, type WorkspaceSummary, type WorkspaceTree } from './schema';
export interface DocumentsApi {
  /** What you can bring to a call: every document and board you can open, by workspace. */
  list(): Promise<DocumentLibrary>;
}

export interface WorkspacesApi {
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
    list(id: ID, documentId: ID, opts?: WorkspaceReadOptions): Promise<DocumentShare>;
    /**
     * Opens a document for everyone in `to`, all of them or none, or changes what they can do with it. Sharing with a
     * seat takes the pass of the call it's in, and ends with the call.
     */
    set(id: ID, documentId: ID, to: ShareTarget[], role: DocumentRole, opts?: WorkspaceReadOptions): Promise<void>;
    /** Takes someone off. From a call, with its pass, the call is told at once, as it is of anything here. */
    remove(id: ID, documentId: ID, entryId: ID, opts?: WorkspaceReadOptions): Promise<void>;
    /** Restricts a document to its creator and the people it's shared with, or opens it to the workspace again. Whoever restricts it keeps it. */
    restrict(id: ID, documentId: ID, restricted: boolean, opts?: WorkspaceReadOptions): Promise<void>;
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
    /**
     * A picture's small preview, for a picker, as an object URL like `picture`'s, for anyone who can read the picture. Null
     * for one uploaded before previews, which has none: draw that from `picture` instead.
     */
    preview(id: ID, documentId: ID, mediaId: ID, opts?: MediaPictureOptions): Promise<string | null>;
    /** Reuses a file you can reach in another document of the same workspace, for anyone who can edit that one. */
    attach(id: ID, documentId: ID, mediaId: ID, opts?: WorkspaceReadOptions): Promise<void>;
    /** Every file you can reach in a workspace, the newest first, each with the documents you can reach it through. */
    list(id: ID, opts?: WorkspaceReadOptions): Promise<WorkspaceMedia[]>;
    /**
     * Deletes a file for good, for everyone, or takes back an upload that hasn't finished: for anyone who can edit every
     * document that has it, beyond a seat in a call, whether they can open it or not, or it's `forbidden`, in words that
     * name no document. Older versions and any other document that had it get `not-found` from then on, which is the
     * app's cue to show it as removed.
     */
    remove(id: ID, documentId: ID, mediaId: ID, opts?: WorkspaceReadOptions): Promise<void>;
  };
  /**
   * Tells someone you tagged them in a document you can edit. It gives them nothing: someone who can't open it isn't told,
   * and the answer doesn't say which. They hear on the workspace's stream, or whenever they're next here.
   */
  mention(id: ID, documentId: ID, tag: MentionBody, opts?: WorkspaceReadOptions): Promise<void>;
  /**
   * The IDs this workspace's documents know people by, for what a tag, a quote or a follow-up carries: the ID a member of it
   * has, keyed under the workspace's own keys, so one in a document says nothing about an address. Anyone in the workspace
   * may ask about any address; someone here only through a call, about the people who've been in it. The answer, by address
   * lower-cased, leaves out the rest.
   */
  ids(id: ID, emails: string[], opts?: WorkspaceReadOptions): Promise<Record<string, string>>;
  /** What you've been tagged in and haven't seen, in every workspace, the newest first: only what you can open now. */
  mentions(): Promise<MentionNotice[]>;
  /** You've heard about this tag, so it isn't kept any more. A tag that's gone is fine. */
  mentionSeen(id: ID, mentionId: ID, opts?: WorkspaceReadOptions): Promise<void>;
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
  /** What you keep beside each frame of a board for presenting it: yours alone, under your own account, whoever else can open it. */
  presenterNotes: {
    /** Yours beside each of a board's frames, by frame. */
    frames(id: ID, boardId: ID, opts?: WorkspaceReadOptions): Promise<PresenterFrameNotes>;
    /** One frame's. Empty text deletes them. */
    setFrame(id: ID, boardId: ID, frame: string, text: string, opts?: WorkspaceReadOptions): Promise<void>;
  };
  /**
   * The format bar's Make this shorter and Turn this into a checklist: what's selected goes to the notes model in confidential
   * compute, and what comes back is for the person asking to put in the document. Needs `edit`. Nothing is kept, and in a
   * call it waits while notes are paused, like everything that reaches the AI.
   */
  ask(id: ID, documentId: ID, body: DocAskBody, opts?: WorkspaceReadOptions): AsyncIterable<DocAskPart>;
  /**
   * A board's Sort into themes: the stickies picked go to the notes model in confidential compute, which names a few themes
   * and says which stickies go in each, for the person asking to put on the board in one step. Needs `edit`. Nothing is
   * kept. It works whether notes are on or off; in a call, with its pass, it's refused while the call is paused, like
   * everything that reaches the AI.
   */
  sortStickies(id: ID, documentId: ID, body: BoardSortBody, opts?: WorkspaceReadOptions): Promise<BoardThemes>;
}
