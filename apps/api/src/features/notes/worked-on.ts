/*
 * What a note says was worked on in its call. The note keeps IDs and who changed them, sealed; each person reading it is told
 * only what they can open now, by the name it has now, so a note says nothing about anything they couldn't open. Who changed
 * it is kept as the workspace knows them (`personIn`), so the reader is found among them the same way, and told it's them.
 *
 * A board open in the call is here too, with the part of the call it was open in, and the notes of that part read it
 * (features/notes/writer.ts) when everyone the note went to can open it: one summary goes to everyone, so a board someone couldn't
 * open stays out of it, and the note says which boards everyone can open.
 */
import { MAIN_PLACE, type NoteWorkedOn } from '@alcove/api';
import type { Deps, Owner } from '../../context';
import { NotFoundError } from '../../errors';
import { log } from '../../log';
import type { WorkedDocument } from '../calls/space-state';
import { portraitFor } from '../account/portraits';
import { accountReader, cantOpen, emailIndex, personIn, roleOf, serverWorkspace, trashOf, workspaceFor, type HeldWorkspace, type Reader, type Workspace } from '../workspaces/access';
import { readDocument } from '../workspaces/documents';

const wlog = log.child({ component: 'worked-on' });

async function opened(o: Owner, reader: Reader, workspaceId: string): Promise<Workspace | undefined> {
  try {
    return await workspaceFor(o, reader, workspaceId);
  } catch (e) {
    if (e instanceof NotFoundError) return undefined;
    throw e;
  }
}

const keyOf = (x: { workspaceId: string; documentId: string }): string => `${x.workspaceId}/${x.documentId}`;

/**
 * The boards among these that everyone at `emails` can open now, as the server holds each workspace, whoever's asking: it's
 * about them, not the reader. One gone, in Trash, or closed to any of them isn't, and neither is anything that isn't a board.
 */
async function openToAll(d: Deps, worked: readonly WorkedDocument[], emails: readonly string[]): Promise<Map<string, { w: HeldWorkspace; name: string }>> {
  const people = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].map((email) => ({ who: { email, principals: [emailIndex(d, email)] } }));
  const held = new Map<string, HeldWorkspace | undefined>();
  const out = new Map<string, { w: HeldWorkspace; name: string }>();
  for (const x of worked) {
    if (x.kind !== 'board') continue;
    const w = held.has(x.workspaceId) ? held.get(x.workspaceId) : await serverWorkspace(d, x.workspaceId);
    held.set(x.workspaceId, w);
    const item = w?.state.items[x.documentId];
    if (!w || !item || trashOf(w.state, x.documentId)) continue;
    if (!(await cantOpen(w, d.pool, x.documentId, people)).length) out.set(keyOf(x), { w, name: item.name });
  }
  return out;
}

/** What a note says was worked on, for `o` to read: `emails` are everyone the note went to, for what boards say of them. */
export async function workedOnFor(o: Owner, worked: WorkedDocument[], emails: readonly string[]): Promise<NoteWorkedOn[]> {
  if (!worked.length) return [];
  const reader = await accountReader(o);
  const workspaces = new Map<string, Workspace | undefined>();
  const out: NoteWorkedOn[] = [];
  const shown: WorkedDocument[] = [];
  for (const x of worked) {
    const w = workspaces.has(x.workspaceId) ? workspaces.get(x.workspaceId) : await opened(o, reader, x.workspaceId);
    workspaces.set(x.workspaceId, w);
    const item = w?.state.items[x.documentId];
    if (!w || !item || trashOf(w.state, x.documentId) || !roleOf(reader, w, x.documentId, item)) continue;
    const me = personIn(w.owner, reader).id;
    shown.push(x);
    out.push({
      workspaceId: x.workspaceId, id: x.documentId, kind: x.kind, name: item.name, by: x.by.map((e) => ({ name: e.name, portrait: e.portrait ?? portraitFor(e.id), isMe: e.id === me })),
      workspace: w.role === null ? null : w.state.name, room: x.open === null || x.open === MAIN_PLACE ? null : x.open, everyone: false
    });
  }
  const all = await openToAll(o, shown, emails);
  return out.map((x) => (all.has(keyOf({ workspaceId: x.workspaceId, documentId: x.id })) ? { ...x, everyone: true } : x));
}

/** A board as a part of the notes reads it: its name, its words, and the stickies in its Actions frames. */
export interface BoardRead { place: string; name: string; text: string; followUps: { id: string; text: string }[] }

/** How much of one board the notes read: its words, and the stickies in its Actions frames, each cut to so many characters. */
const BOARD_READ = { chars: 12_000, max: 20, each: 300 } as const;

/**
 * The boards the notes read, with the part of the call each was open in for everyone (`main`, or a breakout room's ID): those
 * everyone the note went to (`emails`) can open now, because one summary goes to all of them. A board only changed from the
 * list moved nobody else, so it isn't read. One that can't be read now is left out, and the notes are written without it.
 */
export async function boardsToRead(d: Deps, worked: readonly WorkedDocument[], emails: readonly string[], ctx: Record<string, string | number>): Promise<BoardRead[]> {
  const open = worked.filter((x) => x.kind === 'board' && x.open !== null);
  if (!open.length) return [];
  const all = await openToAll(d, open, emails);
  const out: BoardRead[] = [];
  for (const x of open) {
    const found = all.get(keyOf(x));
    if (!found || x.open === null) continue;
    try {
      const read = await readDocument(found.w, x.documentId, 'boardNotes', BOARD_READ);
      out.push({ place: x.open, name: found.name, ...read });
    } catch (e) {
      wlog.warn('a board wasn’t read for the notes; they’re written without it', { ...ctx, workspaceId: x.workspaceId, documentId: x.documentId, err: e });
    }
  }
  wlog.info('boards read for the notes', { ...ctx, open: open.length, read: out.length, left: open.length - out.length });
  return out;
}
