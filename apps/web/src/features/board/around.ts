/*
 * What a board reaches outside its own Y.Doc, the same in a call and on its own page: its pictures, kept in its document's
 * files (docs: Data and storage › Media) and read through it, with a call's pass for a guest; and what in its workspace it
 * can link to, which is only what the person looking can open there.
 */
import type { WorkspaceItem } from '@alcove/api';
import { StorageFullError, type StorageRefusal } from '~/features/plans/storageFull';
import { api } from '~/lib/api';
import type { BoardPictures } from './BoardSurface';
import type { BoardUpload } from './more/items';
import type { BoardItem } from './more/objects';

/** Reads a picture on the board, as an object URL that whatever shows it lets go of. */
export const boardPictures = (workspaceId: string, documentId: string, pass: string | undefined): BoardPictures =>
  (media, signal) => api.workspaces.media.picture(workspaceId, documentId, media, { pass, signal });

/**
 * Keeps a picture in the board's files, with its size when that's known, and answers with what it's kept as. Refused because
 * the storage it counts against is full, it says so as the doors do (`refused`), with what helps.
 */
export const boardUpload = (workspaceId: string, documentId: string, pass: string | undefined, refused?: StorageRefusal | undefined): BoardUpload =>
  async (file, size) => {
    try {
      return (await api.workspaces.media.upload(workspaceId, documentId, file, { pass, width: size?.width, height: size?.height })).id;
    } catch (e) {
      const said = refused ? await refused(e, file.size) : null;
      throw said ? new StorageFullError(said) : e;
    }
  };

/** What a board can link to in its workspace, as this person's tree has it: documents and boards, none in Trash. */
export const linkableIn = (items: readonly WorkspaceItem[]): BoardItem[] =>
  items.flatMap((i): BoardItem[] => (i.kind !== 'folder' && i.trashedAt === null ? [{ id: i.id, name: i.name, kind: i.kind }] : []));
