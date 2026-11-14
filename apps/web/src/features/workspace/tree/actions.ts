/*
 * What pressing things in the list does: each change shows at once through `change`, goes to Alcove, and says how it went
 * in the canvas's words. The stream brings it to everyone else.
 */
import { errorCode, errorMessage, type ItemPlace, type Person, type WorkspaceItem } from '@alcove/api';
import { wsToast, type WsToastData } from '@alcove/ui';
import { useMemo, useRef, type RefObject } from 'react';
import type { Doc } from 'yjs';
import { useItemChanges } from '~/features/workspace/queries';
import type { TreeChange } from './changes';
import type { TreeActions, WorkspacePlace } from '../context';
import { withDocument } from '../session';
import { stemOf, uploadInto } from '../uploads/uploads';
import { folderName, foldersAbove, isWithin, nameFrom, nameOf, nextDocument, placeOf, samePlace, type Tree } from './tree';

/** Everything `useTreeActions` works with. It reads the latest of these whenever something's pressed. */
export interface ActionsInput {
  workspaceId: string;
  pass: string | undefined;
  owner: string | null;
  tree: Tree;
  at: WorkspacePlace;
  me: Person | null;
  spaceName: string;
  /** In a call, the folder of the call you're in, which the list shows as This call. */
  callFolder: string | null;
  change: <T>(c: TreeChange, work: () => Promise<T>) => Promise<T>;
  go: (to: WorkspacePlace, how?: { replace?: boolean | undefined }) => void;
  say: (toast: WsToastData) => void;
  openFolders: (ids: string[]) => void;
  justMade: RefObject<string | null>;
  openDoc: RefObject<{ id: string; doc: Doc } | null>;
}

const titleModule = () => import('../editor/title');

/** Puts the keyboard on a row of the list, once it's on the page. */
export const focusRow = (id: string) => { requestAnimationFrame(() => { document.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"] .wt-open`)?.focus(); }); };

export function useTreeActions(input: ActionsInput): TreeActions {
  const changes = useItemChanges();
  const latest = useRef({ ...input, changes });
  latest.current = { ...input, changes };

  return useMemo(() => {
    const s = () => latest.current;
    const target = (source: ActionsInput) => ({ workspaceId: source.workspaceId, pass: source.pass });
    const failed = (e: unknown) => { s().say(wsToast.failed(errorMessage(e))); };
    /** Shows something new in the list before the stream brings it. */
    const arrived = (item: WorkspaceItem, place: ItemPlace) => { void s().change({ kind: 'add', item, place }, () => Promise.resolve()); };
    const made = (id: string, kind: WorkspaceItem['kind'], name: string, parent: string | null): WorkspaceItem => {
      const at = new Date().toISOString();
      const { me } = s();
      return { id, kind, name, parent, by: me?.portrait ? { name: me.name, portrait: me.portrait } : null, mine: true, createdAt: at, editedAt: at, trashedAt: null, trashedBy: null, restricted: false, role: 'edit', call: null };
    };
    /** Makes a document's title say `name`, on the page if it's open, and otherwise opened just for that. */
    const writeTitle = async (id: string, name: string, source: ActionsInput) => {
      const { setTitle } = await titleModule();
      const open = source.openDoc.current;
      if (open?.id === id) { setTitle(open.doc, name); return; }
      await withDocument(source.workspaceId, id, source.owner, source.pass, (doc) => { setTitle(doc, name); });
    };
    /** One press, one document or board, however quick the second press. */
    let making = false;
    const place = (id: string, to: ItemPlace) => {
      const source = s(); const request = { ...target(source), id, to: { ...to } };
      return source.change({ kind: 'move', id, to: request.to }, () => source.changes.move.mutateAsync(request)).catch(failed);
    };
    const restored = (id: string) => {
      const source = s(); const request = { ...target(source), id };
      return source.change({ kind: 'restore', id }, () => source.changes.restore.mutateAsync(request));
    };

    return {
      newDocument: (parent) => {
        if (making) return;
        making = true;
        s().changes.create.mutateAsync({ ...target(s()), input: { kind: 'document', parent } }).then(({ id }) => {
          arrived(made(id, 'document', '', parent), { parent });
          s().justMade.current = id;
          if (parent) s().openFolders([parent]);
          s().go({ kind: 'document', id });
        }, failed).finally(() => { making = false; });
      },
      uploadFiles: (parent, files) => {
        if (making || files.length === 0) return;
        making = true;
        const one = files.length === 1 ? files[0] : undefined;
        const name = one ? nameFrom(stemOf(one.name)) : '';
        s().changes.create.mutateAsync({ ...target(s()), input: { kind: 'document', name, parent } }).then(({ id }) => {
          arrived(made(id, 'document', name, parent), { parent });
          /* Several files make a document with no name: the caret's in its title, as for a new document. */
          if (!name) s().justMade.current = id;
          if (parent) s().openFolders([parent]);
          s().go({ kind: 'document', id });
          return uploadInto({ workspaceId: s().workspaceId, documentId: id, owner: s().owner, pass: s().pass }, files, name || null);
        }).catch(failed).finally(() => { making = false; });
      },
      newBoard: (parent, how) => {
        if (making) return Promise.resolve(null);
        making = true;
        const name = 'Untitled board';
        return s().changes.create.mutateAsync({ ...target(s()), input: { kind: 'board', name, parent } }).then(({ id }) => {
          arrived(made(id, 'board', name, parent), { parent });
          if (parent) s().openFolders([parent]);
          if (!how?.stay) s().go({ kind: 'document', id });
          return id;
        }, (e: unknown) => { failed(e); return null; }).finally(() => { making = false; });
      },
      newFolder: (parent, name) => {
        s().changes.create.mutateAsync({ ...target(s()), input: { kind: 'folder', name, parent } }).then(({ id }) => {
          arrived(made(id, 'folder', name, parent), { parent });
          s().openFolders(parent ? [parent, id] : [id]);
          // Named with Enter, the field's gone and the keyboard with it. Someone who clicked away has what they clicked.
          if (document.activeElement === document.body) focusRow(id);
        }, failed);
      },
      rename: (id, name) => {
        const source = s();
        const item = source.tree.all.get(id);
        const to = name.trim();
        if (!item || !to || to === item.name) return;
        const request = { ...target(source), id, name: to };
        void source.change({ kind: 'name', id, name: to }, () => source.changes.rename.mutateAsync(request))
          .then(() => (item.kind === 'document' ? writeTitle(id, to, source) : undefined))
          .catch(failed);
      },
      titled: (id, title) => {
        const source = s();
        const name = nameFrom(title);
        // Offline the title is typed all the same: the page says so, and the list catches up when it's back.
        const request = { ...target(source), id, name };
        void source.change({ kind: 'name', id, name }, () => source.changes.rename.mutateAsync(request)).catch((e: unknown) => { if (errorCode(e) !== 'network') failed(e); });
      },
      move: (id, to) => {
        const { tree, spaceName, callFolder } = s();
        if (samePlace(tree, id, to)) return;
        const back = placeOf(tree, id);
        const into = to.parent === null ? undefined : tree.all.get(to.parent);
        void place(id, to);
        if (to.parent) s().openFolders([to.parent, ...foldersAbove(tree, to.parent).map((f) => f.id)]);
        s().say(wsToast.moved(into ? folderName(into, callFolder) : spaceName, () => { void place(id, back); }));
      },
      duplicate: (id) => {
        const source = s();
        const item = source.tree.all.get(id);
        if (!item) return;
        const name = item.name ? `${item.name} copy` : '';
        source.changes.duplicate.mutateAsync({ ...target(source), id }).then(({ id: copy }) => {
          arrived(made(copy, item.kind, name, item.parent), { parent: item.parent, after: id });
          if (name && item.kind === 'document') writeTitle(copy, name, source).catch(failed);
        }, failed);
      },
      trash: (id) => {
        const source = s();
        const { tree, at, me } = source;
        const item = tree.all.get(id);
        if (!item) return;
        const here = at.kind === 'document' && isWithin(tree, at.id, id) ? at.id : null;
        const next = here === null ? null : nextDocument(tree, id);
        const request = { ...target(source), id };
        void source.change({ kind: 'trash', id, at: new Date().toISOString(), by: me?.name ?? '' }, () => source.changes.trash.mutateAsync(request)).catch(failed);
        if (here !== null) s().go(next ? { kind: 'document', id: next } : { kind: 'home' }, { replace: true });
        s().say(wsToast.trashed(nameOf(item), () => {
          restored(id).catch(failed);
          if (here !== null) s().go({ kind: 'document', id: here }, { replace: true });
        }));
      },
      restore: (id) => {
        restored(id).then(() => { s().say(wsToast.restored()); }, failed);
      },
      deleteForever: (id) => {
        const source = s();
        const item = source.tree.all.get(id);
        if (!item) return;
        source.changes.deleteForever.mutateAsync({ ...target(source), id }).then(() => source.change({ kind: 'delete', id }, () => Promise.resolve()))
          .then(() => { s().say(wsToast.deleted(nameOf(item))); }, failed);
      },
      copyLink: (id, block) => {
        const url = `${location.origin}/drive/${s().workspaceId}/${id}${block ? `#${block}` : ''}`;
        navigator.clipboard.writeText(url).then(() => { s().say(wsToast.linkCopied()); }, failed);
      }
    };
  }, []);
}
