/* What the list and the page of a workspace share, and what `<Workspace />` takes from whatever it's in. */
import type { ItemPlace, Person, WorkspaceHere, WorkspaceItem, WorkspaceTree } from '@alcove/api';
import type { WsToastData } from '@alcove/ui';
import { createContext, useContext, type ReactNode, type RefObject } from 'react';
import type { Doc } from 'yjs';
import type { Tree } from './tree';

/**
 * What's on the page beside the list. `home`: nothing chosen, so the workspace picks. `block` lands on a line, and comes
 * from the link's hash.
 */
export type WorkspacePlace = { kind: 'home' } | { kind: 'document'; id: string; block?: string | undefined } | { kind: 'trash' };

/** What a call adds to the workspace. Left out in the app. */
export interface WorkspaceCall {
  /** Rows above Documents: This call, and the live pages. */
  top?: ReactNode;
  /** Whether a document is in this call, which puts Bring to this call in its menu. */
  brought?: ((id: string) => boolean) | undefined;
  onBring?: ((id: string, brought: boolean) => void) | undefined;
  /** What the name at the top of the list opens, in place of the app's picker. */
  picker?: ReactNode;
  /** Just the document, at the far right of a document's head. */
  zen?: { on: boolean; onToggle: () => void } | undefined;
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
  /** The document open on the page, so naming it in the list reaches its title. */
  openDoc: RefObject<{ id: string; doc: Doc } | null>;
}

export const WsContext = createContext<Ws | null>(null);
export function useWs(): Ws {
  const ws = useContext(WsContext);
  if (!ws) throw new Error('This belongs inside <Workspace />.');
  return ws;
}
