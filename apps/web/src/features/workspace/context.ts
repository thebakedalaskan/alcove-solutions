/* What the list and the page of a workspace share, and what `<Workspace />` takes from whatever it's in. */
import type { PersonIds } from './ids';
import type { CallPresent, ItemPlace, Person, WorkspaceHere, WorkspaceItem, WorkspaceTree, WorkspaceWhere } from '@alcove/api';
import type { WsMenuRow, WsToastData } from '@alcove/ui';
import { createContext, useContext, type ReactNode, type RefObject } from 'react';
import type { Doc } from 'yjs';
import type { Pictures } from './pictures';
import type { VideoPlay } from './editor/types';
import type { Following, StopFollowing } from './follow';
import type { Someone } from './presence';
import type { EditorHandle } from './editor/types';
import type { LiveCall, LivePageId, LivePut } from './live/types';
import type { Tree } from './tree';

/** Where in the list something was opened from, in a call: a document brought to it is in both. */
export type WorkspaceArea = 'pins' | 'tree';
/**
 * What's on the page beside the list. `home`: nothing chosen, so the workspace picks. `block` lands on a line, and comes
 * from the link's hash. `live` is one of a call's own pages, and `line` a moment of its transcript.
 */
export type WorkspacePlace = { kind: 'home' } | { kind: 'document'; id: string; block?: string | undefined; area?: WorkspaceArea | undefined } | { kind: 'trash' } | { kind: 'live'; page: LivePageId; line?: string | undefined };

/** Someone in the call: `id` is their connection, the same as `callIdentity` among who's here, and `seat` is what's shared with. */
export interface CallPerson { id: string; seat: string; person: Person; isMe: boolean }
/** What the tiles show of people working together, by connection. `followable`: they're in the workspace, so Follow is on offer. */
export interface CallTogether {
  followable: readonly string[]; following: string | null; writing: readonly string[];
  /** Where each is, in words: what's named is only ever what you can open. */
  where: Readonly<Record<string, string>>;
  /** Who's in a document you can open, so Go there is on offer. */
  reachable: readonly string[];
}
/**
 * What the call can ask of the workspace: follow someone or stop, go to where they are, and tag them in the document
 * open here, which `canTag` says you can now (one is open, and you can write in it).
 */
export interface WorkspaceTogether { follow: (connection: string) => void; stop: () => void; go: (connection: string) => void; tag: (connection: string) => void; canTag: () => boolean }

/**
 * Presenting, in a call (features/call/workspace/presenting.ts). `present` is what the call says is presented where you are; `watching`:
 * the page is the presentation, because you're presenting it or watching it rather than working on your own (`away`).
 * `section` is the one on screen, which moves at once for whoever presses Next. `inSight`: the workspace isn't closed or
 * behind something it takes turns with, so its keys are awake.
 */
export interface WorkspacePresenting {
  present: CallPresent | null;
  /** Whoever's presenting, as the call shows them. */
  presenter: Person | null;
  watching: boolean;
  away: boolean;
  section: number;
  inSight: boolean;
  /** Presents the workspace to everyone in this part of the call. */
  start: () => void;
  /** Whoever's presenting, or the organizer: moves everyone to a section. */
  move: (section: number) => void;
  /** Whoever's presenting, or the organizer: stops it for everyone. */
  stop: () => void;
  /** Work on my own, and Back to the presentation. */
  setAway: (away: boolean) => void;
}

/** A video playing for everyone, in a call (features/call/playback/PlayTogether.tsx). */
export interface WorkspacePlaying {
  /** What's playing where you are: its document, and what a block holding it shows. Null when nothing is. */
  now: { documentId: string; video: VideoPlay } | null;
  /** Plays a video in a document for everyone, from the start. Left out while someone else is playing something. */
  start?: ((documentId: string, mediaId: string) => void) | undefined;
}

/**
 * What the name at the top of the list knows when someone opens it: the workspace it names, and what's there about it
 * (`about`: its people, renaming it). `close` puts the menu away.
 */
export interface SpaceHead { workspaceId: string; name: string; people: number | null; about: WsMenuRow[]; close: () => void }

/** What a call adds to the workspace. Left out in the app. */
export interface WorkspaceCall {
  /**
   * The first rows under This call: the call's own pages. The list leaves them out where it shows the call's folder, which
   * holds them; someone who can't see that folder, such as a guest shared one document, still has them here.
   */
  top?: ReactNode;
  /**
   * What the call puts at the foot of the list, under Trash: the organizer's link for anyone to ask to join, while they're on
   * their own. In the list's own flow it covers none of it, where over the stage it would cover the list.
   */
  foot?: ReactNode;
  /** The call's home, where its notes go and its folder is, if you can open anything in it. */
  home: string | null;
  /** What's been brought to the call, in order, by its ID in this workspace. */
  documents: readonly string[];
  /** Brings a document to the call, or takes it off. It's in every document's menu. */
  onBring: (id: string, brought: boolean) => void;
  /**
   * What the name at the top of the list opens, for whoever chooses the call's workspace: their workspaces, and a new one.
   * Left out, it says which workspace this is, and who chooses it (`chooser`).
   */
  picker?: ((head: SpaceHead) => ReactNode) | undefined;
  /** The first name of who chooses the workspace, for anyone else. */
  chooser?: string | undefined;
  /** Just the document, at the far right of a document's head. */
  zen?: { on: boolean; onToggle: () => void } | undefined;
  /**
   * Whether the list shows, which is the call's to say (panels.ts): `off`, or only over the page for now (`peek`). `onToggle` is
   * the list's button. `onShow` is for whatever needs the list showing, such as naming a folder: it never hides it. `wanted`
   * goes up each time something outside the workspace needs the list, such as someone asking to see it: a phone shows it too.
   */
  list: { off: boolean; peek: boolean; onToggle: () => void; onShow: () => void; wanted: number };
  /** Where what the workspace says goes: a call has one place for toasts. */
  say: (toast: WsToastData) => void;
  /** Out of sight, and kept as it was for next time: closed, or behind something it's taking turns with. Its keys sleep. */
  closed: boolean;
  /** On its way out: the call's workspace changed, so this one is fading from the panel. */
  leaving?: boolean | undefined;
  /** Who's in the call, and who's invited, if you can know: first in `@`. */
  people: readonly CallPerson[];
  invited: readonly Person[];
  /** Tells the tiles what to show. */
  onTogether: (together: CallTogether) => void;
  /** Someone in the call was just tagged: their tile lights up. */
  onTagged: (connection: string) => void;
  /** Where the call reaches the workspace, for Follow on a tile. */
  together: RefObject<WorkspaceTogether | null>;
  /** The call's notes, follow-ups and transcript, for its pages and for what a document takes from them. */
  live: LiveCall;
  /** ⌘K in the call asked for Find, which opens the workspace first if it's closed. `onFinding` says it's been heard. */
  finding: boolean;
  onFinding: () => void;
  /** Presenting in this call. */
  presenting: WorkspacePresenting;
  /** Playing a video for everyone. */
  playing: WorkspacePlaying;
}

export interface WorkspaceProps {
  /** `page`: a page of the app, in the person's theme. `call`: a panel in a call, inside the call's `.stage`, so it's night. */
  mode: 'page' | 'call';
  workspaceId: string;
  at: WorkspacePlace;
  /** Go somewhere in this workspace. The app changes the address; a call keeps it in its own state. */
  onGo: (to: WorkspacePlace, how?: { replace?: boolean | undefined }) => void;
  /** Open another workspace. */
  onSwitch: (workspaceId: string) => void;
  /** Leave a workspace that can't be opened any more. */
  onLeave: () => void;
  /** A guest's call pass. */
  pass?: string | undefined;
  call?: WorkspaceCall | undefined;
}

/** Everything someone can do to the tree. Each shows at once, says how it went in a toast, and offers Undo where the canvas does. */
export interface TreeActions {
  newDocument: (parent: string | null) => void;
  /** Upload files: a new document in this folder holding them, named after the file when there's one. */
  uploadFiles: (parent: string | null, files: readonly File[]) => void;
  newFolder: (parent: string | null, name: string) => void;
  /**
   * A board, called Untitled board, in `parent`: opened on the page, unless `stay`. Resolves with its ID, or null when it
   * couldn't be made, which has been said.
   */
  newBoard: (parent: string | null, how?: { stay?: boolean | undefined }) => Promise<string | null>;
  /** Naming something in the list: a document's title follows. */
  rename: (id: string, name: string) => void;
  /** The title was typed on the page: the list follows. */
  titled: (id: string, title: string) => void;
  move: (id: string, to: ItemPlace) => void;
  duplicate: (id: string) => void;
  trash: (id: string) => void;
  restore: (id: string) => void;
  deleteForever: (id: string) => void;
  copyLink: (id: string, block?: string | undefined) => void;
}

/** A folder being made, named in the list before it exists. */
export interface FolderDraft { parent: string | null }

/** The page, for what's outside it: tagging someone from their card. */
export interface OpenPage { canTag: boolean; tag: (person: Person) => void }

export interface Ws {
  mode: WorkspaceProps['mode'];
  workspaceId: string;
  pass: string | undefined;
  call: WorkspaceCall | undefined;
  /** The tree as the stream last sent it. */
  sent: WorkspaceTree;
  /** Who's in the workspace now, a connection each. */
  here: readonly WorkspaceHere[];
  /** Everyone else here, each once. */
  others: readonly Someone[];
  /** Says where this browser is. */
  present: (where: WorkspaceWhere) => void;
  /** Who you're following, if anyone. */
  following: Following | null;
  follow: (person: string) => void;
  stopFollowing: (how?: StopFollowing) => void;
  /** Everything in it, with what's on its way laid over. */
  items: readonly WorkspaceItem[];
  tree: Tree;
  at: WorkspacePlace;
  go: WorkspaceProps['onGo'];
  switchTo: WorkspaceProps['onSwitch'];
  /** The signed-in account, if there is one: a guest in a call has none. */
  owner: string | null;
  me: Person | null;
  /** You, as this workspace knows you: what a comment or a tag goes by. */
  self: Person | null;
  actions: TreeActions;
  say: (toast: WsToastData) => void;
  /** Whether someone can add to the tree, move things in it and send them to Trash. */
  canChange: boolean;
  /** What the workspace is called here. */
  spaceName: string;
  /** The folders open in the list. */
  open: ReadonlySet<string>;
  setOpen: (id: string, open: boolean) => void;
  /** Rows that glow, 1.4 s: just made, or just moved. */
  glowing: ReadonlySet<string>;
  /** The document a block is being dragged onto, which lights up. */
  blockInto: string | null;
  setBlockInto: (id: string | null) => void;
  draft: FolderDraft | null;
  setDraft: (draft: FolderDraft | null) => void;
  renaming: string | null;
  setRenaming: (id: string | null) => void;
  listOff: boolean;
  toggleList: () => void;
  /** The document just made here, whose page opens with the caret in its title. */
  justMade: RefObject<string | null>;
  /** The document open on the page, so naming it in the list reaches its title, what's sent from a call lands where it can be seen, and its editor once it's drawn. */
  openDoc: RefObject<{ id: string; doc: Doc; editor: EditorHandle | null } | null>;
  page: RefObject<OpenPage | null>;
  /** Where what's sent from the call goes, while there's somewhere you can edit. */
  put: LivePut | null;
  /** The document you were last in, while a live page has its place. */
  lastDocument: string | null;
  /** Find, from the magnifier. ⌘K does the same. */
  openFind: () => void;
  /** The workspace's stored pictures, read for whatever shows them. */
  pictures: Pictures;
  /** Who's who in documents here: IDs the server keys, never anyone's address (ids.ts). */
  ids: PersonIds;
}

export const WsContext = createContext<Ws | null>(null);
export function useWs(): Ws {
  const ws = useContext(WsContext);
  if (!ws) throw new Error('This belongs inside <Workspace />.');
  return ws;
}
