/*
 * A call's page in the demo world: where each call's things are kept (its home, as the API works it out: the workspace whose
 * folder is the call's, for someone in it), and a call made ready before it starts, as the API makes it ready: its home
 * settled, made for it when it has none, with an agenda, a board or a document for files at the top, brought to the call.
 */
import { AlcoveApiError, type CallAheadHome, type CallAheadMake, type Meeting, type Note } from '@alcove/api';
import { createItem } from '../api/workspaces';
import type { Space, World } from './index';
import { HIRING_SYNC, withHiringSync } from './scheduling';

/** Each note's home, from the workspaces: the one whose call folder is the note's, when you're in it. */
export function homesOn(notes: Note[], spaces: readonly Space[]): void {
  for (const n of notes) {
    const space = spaces.find((s) => s.role !== null && s.items.some((x) => x.kind === 'folder' && x.call?.noteId === n.id));
    const folder = space?.items.find((x) => x.kind === 'folder' && x.call?.noteId === n.id && x.trashedAt === null);
    n.home = space ? { workspaceId: space.id, folderId: folder?.id ?? null } : null;
  }
}

/** Calls an invited person has made ready: the home the organizer's call has, which their own copy of it doesn't name. */
const homesOfInvited = new WeakMap<World, Map<string, string>>();

/** A home made for a call before it starts: named after it and its day, with everyone invited in it. */
function homeFor(w: World, m: Meeting): string {
  const id = `ws-${m.id}`;
  const day = new Date(m.startsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  w.workspaces.push({ id, name: `${m.title} · ${day}`, role: m.isOrganizer ? 'admin' : 'edit', inCall: false, people: m.guestCount + 1, items: [], createdAt: new Date().toISOString(), call: { title: m.title, at: m.startsAt } });
  return id;
}

/** `calls.ready`, as the API answers it, in the story's world. */
export function readyIn(w: World, meetingId: string, make: CallAheadMake, named = ''): CallAheadHome {
  const m = w.meetings.find((x) => x.id === meetingId);
  if (!m) throw new AlcoveApiError('not-found', 'That meeting isn’t here.');
  if (m.status !== 'scheduled') throw new AlcoveApiError('conflict', 'This call has started. Its workspace opens in the call.');
  const theirs = homesOfInvited.get(w) ?? new Map<string, string>();
  homesOfInvited.set(w, theirs);
  const had = m.isOrganizer ? m.workspaceId : theirs.get(m.id) ?? null;
  const workspaceId = had && w.workspaces.some((s) => s.id === had) ? had : homeFor(w, m);
  if (m.isOrganizer) w.meetings = w.meetings.map((x) => (x.id === m.id ? { ...x, workspaceId } : x));
  else theirs.set(m.id, workspaceId);
  const name = make === 'agenda' ? 'Agenda' : make === 'board' ? 'Board' : named;
  const { id: itemId } = createItem(workspaceId, { kind: make === 'board' ? 'board' : 'document', name, parent: null });
  const me = w.session?.user.name.split(' ')[0] ?? null;
  const brought = { id: `${workspaceId}.${itemId}`, kind: make === 'board' ? 'board' : 'doc', by: me, name } as const;
  w.meetings = w.meetings.map((x) => (x.id === m.id ? { ...x, documents: [brought, ...x.documents] } : x));
  return { workspaceId, itemId };
}

/** Art's hiring sync with an agenda Art added before it, as Add an agenda makes one: in a home made for the call, brought to it. */
export function withAnAgenda(w: World): void {
  withHiringSync(w);
  readyIn(w, HIRING_SYNC.id, 'agenda');
}
