/*
 * Where a call's things are, for someone reading its note (`NoteHome`): the call's home, the workspace its organizer chose or
 * the one made for it, and this run of the call's folder in it. Worked out on every read, for each reader, and kept nowhere:
 * someone who isn't in that workspace now (invited to a call whose home the organizer chose, or given the notes afterwards)
 * gets null, and learns nothing of it; so does anyone once it's gone. A room recording has no call, so no home. The home is the
 * meeting's, in the organizer's vault, read after the note's own access check (`locate`).
 */
import type { NoteHome } from '@alcove/api';
import type { Owner } from '../../context';
import { NotFoundError } from '../../errors';
import { accountReader, trashOf, workspaceFor, type Workspace } from '../workspaces/access';

/** The folder this run of the call made in its home, and its note goes to: one whose call is this note, and not in Trash. */
const folderOf = (w: Workspace, noteId: string): string | null =>
  Object.entries(w.state.items).find(([id, x]) => x.kind === 'folder' && x.call?.noteId === noteId && !trashOf(w.state, id))?.[0] ?? null;

/** The call's home for `o` to open, from its meeting's `workspaceId`, when they're in that workspace now. */
export async function homeFor(o: Owner, noteId: string, workspaceId: string | null): Promise<NoteHome | null> {
  if (!workspaceId) return null;
  let w: Workspace;
  try {
    w = await workspaceFor(o, await accountReader(o), workspaceId);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
  // Something shared with them from it isn't the workspace: only someone in it opens it.
  if (w.role === null) return null;
  return { workspaceId, folderId: folderOf(w, noteId) };
}
