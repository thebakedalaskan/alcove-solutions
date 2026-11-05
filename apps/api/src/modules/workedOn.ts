/*
 * What a note says was worked on in its call. The note keeps IDs and who changed them, sealed; each person reading it is told
 * only what they can open now, by the name it has now, so a note says nothing about anything they couldn't open.
 */
import type { NoteWorkedOn } from '@alcove/api';
import type { Owner } from '../context';
import { NotFoundError } from '../errors';
import type { WorkedDocument } from './callSpace';
import { portraitFor } from './portraits';
import { accountReader, roleOf, trashOf, workspaceFor, type Reader, type Workspace } from './workspaceAccess';

async function opened(o: Owner, reader: Reader, workspaceId: string): Promise<Workspace | undefined> {
  try {
    return await workspaceFor(o, reader, workspaceId);
  } catch (e) {
    if (e instanceof NotFoundError) return undefined;
    throw e;
  }
}

export async function workedOnFor(o: Owner, worked: WorkedDocument[]): Promise<NoteWorkedOn[]> {
  if (!worked.length) return [];
  const reader = await accountReader(o);
  const workspaces = new Map<string, Workspace | undefined>();
  const out: NoteWorkedOn[] = [];
  for (const x of worked) {
    const w = workspaces.has(x.workspaceId) ? workspaces.get(x.workspaceId) : await opened(o, reader, x.workspaceId);
    workspaces.set(x.workspaceId, w);
    const item = w?.state.items[x.documentId];
    if (!w || !item || trashOf(w.state, x.documentId) || !roleOf(reader, w, x.documentId, item)) continue;
    out.push({ workspaceId: x.workspaceId, id: x.documentId, kind: x.kind, name: item.name, by: x.by.map((e) => ({ name: e.name, portrait: e.portrait ?? portraitFor(e.id) })) });
  }
  return out;
}
