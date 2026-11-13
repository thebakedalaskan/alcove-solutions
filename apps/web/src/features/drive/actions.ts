/*
 * What pressing things in the Drive does. Opening a document or a board shows it beside the tree (full screen on a phone),
 * and ⤢ takes it full screen, in the workspace it lives in; making one makes it where you are, or where you pick, and opens it. Renaming a document renames its title too, as
 * the workspace's own list does. Sending one to Trash says so, with Undo. Each change reads again what the Drive shows of
 * it (`useDriveItems`). Nothing about what anything says or is called is logged: IDs and codes only.
 */
import { errorCode, errorMessage, type WorkspaceRole } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useRef } from 'react';
import { stemOf, uploadInto } from '~/features/workspace/uploads/uploads';
import { withDocument } from '~/features/workspace/session';
import { log } from '~/lib/log';
import { accountQueries } from '~/features/account/queries';
import { useCreateWorkspace, useDriveItems } from '~/features/workspace/queries';
import { fileName, type DriveAt, type DriveFile } from './places';

const dlog = log.child({ component: 'drive' });
/** What writes a document's title: Yjs comes with the first document anyone opens, and stays out of the Drive till then. */
const titleModule = () => import('~/features/workspace/editor/title');

/** Where something new goes: a workspace, and a folder in it, or its top. */
export interface Target { workspaceId: string; folder: string | null }
/** What can be made. */
export type Making = 'document' | 'board' | 'upload';
/** Where the frame becomes a phone's, with no room beside anything. */
export const PHONE = '(max-width: 860px)';
/** Whether a role makes things and renames them. */
export const canEdit = (role: WorkspaceRole | null | undefined): boolean => role === 'admin' || role === 'edit';

export function useDriveActions() {
  const navigate = useNavigate();
  const say = useToast();
  const owner = useQuery(accountQueries.session()).data?.ownerId ?? null;
  const items = useDriveItems();
  const createWorkspace = useCreateWorkspace();
  /** One press, one new thing, however quick the second press. */
  const making = useRef(false);

  const failed = useCallback((e: unknown) => {
    dlog.info('a change in the Drive didn’t go through', { code: errorCode(e) });
    say(errorMessage(e), { icon: 'alert' });
  }, [say]);
  const go = useCallback((to: DriveAt, how: { replace?: boolean } = {}) => {
    void navigate({ to: '/drive', search: to, replace: how.replace === true });
  }, [navigate]);
  const openFull = useCallback((workspaceId: string, documentId?: string | undefined) => {
    if (documentId) void navigate({ to: '/drive/$workspaceId/$documentId', params: { workspaceId, documentId } });
    else void navigate({ to: '/drive/$workspaceId', params: { workspaceId } });
  }, [navigate]);

  /** A document or board, beside the tree; on a phone, where there's no room beside anything, full screen. */
  const open = useCallback((f: Pick<DriveFile, 'workspaceId' | 'id'>) => {
    if (matchMedia(PHONE).matches) openFull(f.workspaceId, f.id);
    else go({ ws: f.workspaceId, doc: f.id });
  }, [go, openFull]);

  const make = useCallback(async (kind: Making, to: Target, files: readonly File[] = []) => {
    if (making.current || (kind === 'upload' && files.length === 0)) return;
    making.current = true;
    try {
      const one = files.length === 1 ? files[0] : undefined;
      const name = kind === 'board' ? 'Untitled board' : one ? stemOf(one.name).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
      const { id } = await items.create.mutateAsync({ workspaceId: to.workspaceId, input: { kind: kind === 'board' ? 'board' : 'document', name, parent: to.folder } });
      open({ workspaceId: to.workspaceId, id });
      if (kind === 'upload') await uploadInto({ workspaceId: to.workspaceId, documentId: id, owner, pass: undefined }, files, name || null);
    } catch (e) {
      failed(e);
    } finally {
      making.current = false;
    }
  }, [failed, items.create, open, owner]);

  /** A new workspace, named: it opens on the sheet, empty, ready for something to go in it. `then`: make that in it straight away. */
  const newWorkspace = useCallback(async (name: string, then?: { kind: Making; files: readonly File[] } | undefined) => {
    try {
      const { id } = await createWorkspace.mutateAsync({ name });
      if (then) await make(then.kind, { workspaceId: id, folder: null }, then.files);
      else go({ ws: id });
    } catch (e) {
      failed(e);
    }
  }, [createWorkspace, failed, go, make]);

  const copyLink = useCallback((f: Pick<DriveFile, 'workspaceId' | 'id'>) => {
    navigator.clipboard.writeText(`${location.origin}/drive/${f.workspaceId}/${f.id}`)
      .then(() => { say('Link copied. It only opens for people with access.', { icon: 'link' }); }, failed);
  }, [failed, say]);

  const rename = useCallback((f: DriveFile, name: string) => {
    const to = name.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!to || to === f.name) return;
    items.rename.mutateAsync({ workspaceId: f.workspaceId, id: f.id, name: to })
      .then(async () => {
        // A document's title is its name, as the workspace's list has it: it follows, for everyone.
        if (f.kind !== 'doc') return;
        const { setTitle } = await titleModule();
        await withDocument(f.workspaceId, f.id, owner, undefined, (doc) => { setTitle(doc, to); });
      })
      .catch(failed);
  }, [failed, items.rename, owner]);

  const restore = useCallback((f: Pick<DriveFile, 'workspaceId' | 'id'>, name: string) => {
    items.restore.mutateAsync({ workspaceId: f.workspaceId, id: f.id })
      .then(() => { say(`${name} is back where it was`, { icon: 'check' }); }, failed);
  }, [failed, items.restore, say]);

  const trash = useCallback((f: DriveFile) => {
    const name = fileName(f.kind, f.name);
    items.trash.mutateAsync({ workspaceId: f.workspaceId, id: f.id })
      .then(() => { say(`${name} moved to Trash`, { icon: 'trash', action: { label: 'Undo', onClick: () => restore(f, name) } }); }, failed);
  }, [failed, items.trash, restore, say]);

  return useMemo(() => ({ go, open, openFull, make, newWorkspace, copyLink, rename, trash, restore, busy: createWorkspace.isPending }),
    [go, open, openFull, make, newWorkspace, copyLink, rename, trash, restore, createWorkspace.isPending]);
}
export type DriveActions = ReturnType<typeof useDriveActions>;
