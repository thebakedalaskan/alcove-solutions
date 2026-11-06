/*
 * What a board reaches outside its own Y.Doc, the same in a call and on its own page: its pictures, kept in its document's
 * files (docs: Data and storage › Media) and read through it, with a call's pass for a guest; and what in its workspace it
 * can link to, which is only what the person looking can open there.
 */
import type { WorkspaceItem } from '@alcove/api';
import { api } from '~/lib/api';
import type { BoardPictures } from './BoardSurface';
import type { BoardUpload } from './more/items';
import type { BoardItem } from './more/objects';

/** Reads a picture on the board, as an object URL that whatever shows it lets go of. */
export const boardPictures = (workspaceId: string, documentId: string, pass: string | undefined): BoardPictures =>
  (media, signal) => api.workspaces.media.picture(workspaceId, documentId, media, { pass, signal });

/** Keeps a picture in the board's files, with its size when that's known, and answers with what it's kept as. */
export const boardUpload = (workspaceId: string, documentId: string, pass: string | undefined): BoardUpload =>
  async (file, size) => (await api.workspaces.media.upload(workspaceId, documentId, file, { pass, width: size?.width, height: size?.height })).id;

/** What a board can link to in its workspace, as this person's tree has it: documents and boards, none in Trash. */
export const linkableIn = (items: readonly WorkspaceItem[]): BoardItem[] =>
  items.flatMap((i): BoardItem[] => (i.kind !== 'folder' && i.trashedAt === null ? [{ id: i.id, name: i.name, kind: i.kind }] : []));
