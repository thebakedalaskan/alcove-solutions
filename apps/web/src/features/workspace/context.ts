/* What the list and the page of a workspace share, and what `<Workspace />` takes from whatever it's in. */
import type { ItemPlace, Person, WorkspaceHere, WorkspaceItem, WorkspaceTree } from '@alcove/api';
import type { WsToastData } from '@alcove/ui';
import { createContext, useContext, type ReactNode, type RefObject } from 'react';
import type { Doc } from 'yjs';
import type { EditorHandle } from './editor/types';
import type { Tree } from './tree';

/** Where in the list something was opened from, in a call: a document brought to it is in both. */
export type WorkspaceArea = 'pins' | 'tree';
/**
 * What's on the page beside the list. `home`: nothing chosen, so the workspace picks. `block` lands on a line, and comes
 * from the link's hash.
 */
export type WorkspacePlace = { kind: 'home' } | { kind: 'document'; id: string; block?: string | undefined; area?: WorkspaceArea | undefined } | { kind: 'trash' };

/** What a call adds to the workspace. Left out in the app. */
export interface WorkspaceCall {
  /** The first rows under This call: the live pages. */
  top?: ReactNode;
  /** What's been brought to the call, in order, by its ID in this workspace. */
  documents: readonly string[];
  /** Brings a document to the call, or takes it off. It's in every document's menu. */
  onBring: (id: string, brought: boolean) => void;
  /** What the name at the top of the list opens. Left out, it says which workspace this is, and who chooses it (`chooser`). */
  picker?: ReactNode;
  /** The first name of who chooses the workspace, for anyone else. */
  chooser?: string | undefined;
  /** Just the document, at the far right of a document's head. */
  zen?: { on: boolean; onToggle: () => void } | undefined;
  /** Whether the list shows, which is the call's to say (panels.ts): `off`, or only over the page for now (`peek`). */
  list: { off: boolean; peek: boolean; onToggle: () => void };
  /** Where what the workspace says goes: a call has one place for toasts. */
  say: (toast: WsToastData) => void;
  /** Closed, and kept as it was for next time: its keys sleep. */
  closed: boolean;
  /** ⌘K in the call asked for Find, which opens the workspace first if it's closed. `onFinding` says it's been heard. */
  finding: boolean;
  onFinding: () => void;
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
  newFolder: (parent: string | null, name: string) => void;
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

export interface Ws {
  mode: WorkspaceProps['mode'];
  workspaceId: string;
  pass: string | undefined;
  call: WorkspaceCall | undefined;
  /** The tree as the stream last sent it. */
  sent: WorkspaceTree;
  /** Who's in the workspace now. */
  here: readonly WorkspaceHere[];
  /** Everything in it, with what's on its way laid over. */
  items: readonly WorkspaceItem[];
  tree: Tree;
  at: WorkspacePlace;
  go: WorkspaceProps['onGo'];
  switchTo: WorkspaceProps['onSwitch'];
  /** The signed-in account, if there is one: a guest in a call has none. */
  owner: string | null;
  me: Person | null;
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
  /** The document open on the page, so naming it in the list reaches its title, and its editor once it's drawn. */
  openDoc: RefObject<{ id: string; doc: Doc; editor: EditorHandle | null } | null>;
  /** Find, from the magnifier. ⌘K does the same. */
  openFind: () => void;
}

export const WsContext = createContext<Ws | null>(null);
export function useWs(): Ws {
  const ws = useContext(WsContext);
  if (!ws) throw new Error('This belongs inside <Workspace />.');
  return ws;
}
