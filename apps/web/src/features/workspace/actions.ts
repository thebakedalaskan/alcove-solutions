/*
 * What pressing things in the list does: each change shows at once through `change`, goes to Alcove, and says how it went
 * in the canvas's words. The stream brings it to everyone else.
 */
import { errorCode, errorMessage, type ItemPlace, type Person, type WorkspaceItem } from '@alcove/api';
import { wsToast, type WsToastData } from '@alcove/ui';
import { useMemo, useRef, type RefObject } from 'react';
import type { Doc } from 'yjs';
import { useItemChanges } from '~/lib/queries';
import type { TreeChange } from './changes';
import type { TreeActions, WorkspacePlace } from './context';
import { withDocument } from './session';
import { stemOf, uploadInto } from './uploads';
import { foldersAbove, isWithin, nameFrom, nameOf, nextDocument, placeOf, samePlace, type Tree } from './tree';

/** Everything `useTreeActions` works with. It reads the latest of these whenever something's pressed. */
export interface ActionsInput {
  workspaceId: string;
  pass: string | undefined;
  owner: string | null;
  tree: Tree;
  at: WorkspacePlace;
  me: Person | null;
  spaceName: string;
  change: <T>(c: TreeChange, work: () => Promise<T>) => Promise<T>;
  go: (to: WorkspacePlace, how?: { replace?: boolean | undefined }) => void;
  say: (toast: WsToastData) => void;
  openFolders: (ids: string[]) => void;
  justMade: RefObject<string | null>;
  openDoc: RefObject<{ id: string; doc: Doc } | null>;
}

const titleModule = () => import('./editor/title');

/** Puts the keyboard on a row of the list, once it's on the page. */
export const focusRow = (id: string) => { requestAnimationFrame(() => { document.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"] .wt-open`)?.focus(); }); };

export function useTreeActions(input: ActionsInput): TreeActions {
  const changes = useItemChanges(input.workspaceId, input.pass);
  const latest = useRef({ ...input, changes });
  latest.current = { ...input, changes };

  return useMemo(() => {
    const s = () => latest.current;
    const failed = (e: unknown) => { s().say(wsToast.failed(errorMessage(e))); };
    /** Shows something new in the list before the stream brings it. */
    const arrived = (item: WorkspaceItem, place: ItemPlace) => { void s().change({ kind: 'add', item, place }, () => Promise.resolve()); };
    const made = (id: string, kind: WorkspaceItem['kind'], name: string, parent: string | null): WorkspaceItem => {
      const at = new Date().toISOString();
      const { me } = s();
      return { id, kind, name, parent, by: me?.portrait ? { name: me.name, portrait: me.portrait } : null, createdAt: at, editedAt: at, trashedAt: null, trashedBy: null, restricted: false, role: 'edit', call: null };
    };
    /** Makes a document's title say `name`, on the page if it's open, and otherwise opened just for that. */
    const writeTitle = async (id: string, name: string) => {
      const { setTitle } = await titleModule();
      const open = s().openDoc.current;
      if (open?.id === id) { setTitle(open.doc, name); return; }
      await withDocument(s().workspaceId, id, s().owner, s().pass, (doc) => { setTitle(doc, name); });
    };
    let making = false;
    const place = (id: string, to: ItemPlace) => s().change({ kind: 'move', id, to }, () => s().changes.move.mutateAsync({ id, to })).catch(failed);
    const restored = (id: string) => s().change({ kind: 'restore', id }, () => s().changes.restore.mutateAsync(id));

    return {
      newDocument: (parent) => {
        // One press, one document, however quick the second press.
        if (making) return;
        making = true;
        s().changes.create.mutateAsync({ kind: 'document', parent }).then(({ id }) => {
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
        s().changes.create.mutateAsync({ kind: 'document', name, parent }).then(({ id }) => {
          arrived(made(id, 'document', name, parent), { parent });
          /* Several files make a document with no name: the caret's in its title, as for a new document. */
          if (!name) s().justMade.current = id;
          if (parent) s().openFolders([parent]);
          s().go({ kind: 'document', id });
          return uploadInto({ workspaceId: s().workspaceId, documentId: id, owner: s().owner, pass: s().pass }, files, name || null);
        }).catch(failed).finally(() => { making = false; });
      },
      newFolder: (parent, name) => {
        s().changes.create.mutateAsync({ kind: 'folder', name, parent }).then(({ id }) => {
          arrived(made(id, 'folder', name, parent), { parent });
          s().openFolders(parent ? [parent, id] : [id]);
          // Named with Enter, the field's gone and the keyboard with it. Someone who clicked away has what they clicked.
          if (document.activeElement === document.body) focusRow(id);
        }, failed);
      },
      rename: (id, name) => {
        const item = s().tree.all.get(id);
        const to = name.trim();
        if (!item || !to || to === item.name) return;
        void s().change({ kind: 'name', id, name: to }, () => s().changes.rename.mutateAsync({ id, name: to }))
          .then(() => (item.kind === 'document' ? writeTitle(id, to) : undefined))
          .catch(failed);
      },
      titled: (id, title) => {
        const name = nameFrom(title);
        // Offline the title is typed all the same: the page says so, and the list catches up when it's back.
        void s().change({ kind: 'name', id, name }, () => s().changes.rename.mutateAsync({ id, name })).catch((e: unknown) => { if (errorCode(e) !== 'network') failed(e); });
      },
      move: (id, to) => {
        const { tree, spaceName } = s();
        if (samePlace(tree, id, to)) return;
        const back = placeOf(tree, id);
        const into = to.parent === null ? undefined : tree.all.get(to.parent);
        void place(id, to);
        if (to.parent) s().openFolders([to.parent, ...foldersAbove(tree, to.parent).map((f) => f.id)]);
        s().say(wsToast.moved(into ? nameOf(into) : spaceName, () => { void place(id, back); }));
      },
      duplicate: (id) => {
        const item = s().tree.all.get(id);
        if (!item) return;
        const name = item.name ? `${item.name} copy` : '';
        s().changes.duplicate.mutateAsync(id).then(({ id: copy }) => {
          arrived(made(copy, item.kind, name, item.parent), { parent: item.parent, after: id });
          if (name && item.kind === 'document') writeTitle(copy, name).catch(failed);
        }, failed);
      },
      trash: (id) => {
        const { tree, at, me } = s();
        const item = tree.all.get(id);
        if (!item) return;
        const here = at.kind === 'document' && isWithin(tree, at.id, id) ? at.id : null;
        const next = here === null ? null : nextDocument(tree, id);
        void s().change({ kind: 'trash', id, at: new Date().toISOString(), by: me?.name ?? '' }, () => s().changes.trash.mutateAsync(id)).catch(failed);
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
        const item = s().tree.all.get(id);
        if (!item) return;
        s().change({ kind: 'delete', id }, () => s().changes.deleteForever.mutateAsync(id)).then(() => { s().say(wsToast.deleted(nameOf(item))); }, failed);
      },
      copyLink: (id, block) => {
        const url = `${location.origin}/drive/${s().workspaceId}/${id}${block ? `#${block}` : ''}`;
        navigator.clipboard.writeText(url).then(() => { s().say(wsToast.linkCopied()); }, failed);
      }
    };
  }, []);
}
