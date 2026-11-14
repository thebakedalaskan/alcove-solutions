/*
 * Workspaces' data: your workspaces and what you can bring to a call from them, each one's people, tree, items, files, tags,
 * documents' sharing and versions, previews, Trash and what it's for, the boards the board picker offers, and the changes
 * made to all of these, in a call (with its pass), beside the Drive's tree and full screen.
 */
import { AlcoveApiError, MAX_SORT_STICKIES, MAX_SORT_STICKY, SORT_TOO_FEW, SORT_TOO_MANY, errorCode, type DocumentLibrary, type DocumentRole, type ISODate, type ItemInput, type ItemPlace, type MentionBody, type PresenterFrameNotes, type ShareTarget, type TeamAccess, type WorkspaceRole, type WorkspaceSummary, type WorkspaceTree } from '@alcove/api';
import { queryOptions, useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { accountQueries } from '~/features/account/queries';
import { accountKeys } from '~/features/account/queryKeys';
import { announceMentionsRead } from '~/features/notifications/attentionChannel';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import { readWorkspaces, renameWorkspaceOptions } from '~/lib/queryWrites';
import { workspaceKeys } from './queryKeys';

/** A saved board someone could bring to a call: where it is, what it's called, whose it is, and when it was last changed. */
export interface BoardToBring { workspaceId: string; workspace: string | null; id: string; name: string; by: string | null; editedAt: ISODate }
/** How many of the newest workspaces the board picker looks in: a call's home is new, so what a team has is across the Drive. */
const BOARD_SPACES = 12;
/**
 * Every board you could bring from the newest of `spaces` (your Drive, as `workspaceQueries.workspaces` lists it), the most
 * recently changed first. One that can't be read now is left out.
 */
async function boardsToBring(spaces: readonly WorkspaceSummary[]): Promise<BoardToBring[]> {
  const trees = await Promise.all(spaces.slice(0, BOARD_SPACES).map((w) => api.workspaces.get(w.id).catch((e: unknown) => {
    log.child({ component: 'boards' }).info('a workspace’s boards couldn’t be read for the board picker', { workspaceId: w.id, code: errorCode(e) });
    return null;
  })));
  return trees.flatMap((t) => (t ? t.items.flatMap((i): BoardToBring[] => (i.kind === 'board' && i.trashedAt === null && i.role === 'edit'
    ? [{ workspaceId: t.id, workspace: t.name, id: i.id, name: i.name, by: i.by?.name ?? null, editedAt: i.editedAt }] : [])) : []))
    .sort((a, b) => b.editedAt.localeCompare(a.editedAt));
}

/** The keys a workspace's rename projects over (lib/queryWrites.ts), and whose session owns it. */
const renameKeys = { session: accountKeys.session, workspaces: workspaceKeys.workspaces };

export const workspaceQueries = {
  workspaces: () => queryOptions({ queryKey: workspaceKeys.workspaces, queryFn: ({ client }) => readWorkspaces(api, client) }),
  /** What you can bring to a call. */
  documents: () => queryOptions({ queryKey: workspaceKeys.documents, queryFn: () => api.documents.list(), staleTime: 60_000, retry: false }),
  /** Who's in a workspace, for anyone in it. */
  workspacePeople: (id: string) => queryOptions({ queryKey: workspaceKeys.workspacePeople(id), queryFn: () => api.workspaces.people(id) }),
  /** The IDs a workspace's documents know these people by (features/workspace/sharing/ids.ts). An ID never changes. */
  personIds: (id: string, emails: readonly string[], pass?: string | undefined) => queryOptions({ queryKey: workspaceKeys.personIds(id, emails), queryFn: () => api.workspaces.ids(id, [...emails], pass ? { pass } : undefined), staleTime: Infinity }),
  /** What you've been tagged in and haven't seen, anywhere. */
  mentions: () => queryOptions({ queryKey: workspaceKeys.mentions, queryFn: () => api.workspaces.mentions() }),
  /** The tab indicator never uses a previous account's cached notices or a result arriving after a switch. */
  attentionMentions: (owner: string) => queryOptions({
    queryKey: [...workspaceKeys.mentions, owner],
    queryFn: async () => {
      if ((await api.auth.getSession())?.ownerId !== owner) return [];
      const notices = await api.workspaces.mentions();
      return (await api.auth.getSession())?.ownerId === owner ? notices : [];
    },
    retry: false, refetchInterval: 15_000, refetchIntervalInBackground: true, staleTime: 0
  }),
  /** Who has a document, for the Share sheet. Someone else may have changed it, so it's read each time the sheet opens. */
  documentShare: (id: string, documentId: string, pass?: string | undefined) => queryOptions({ queryKey: workspaceKeys.documentShare(id, documentId), queryFn: () => api.workspaces.share.list(id, documentId, pass ? { pass } : undefined), staleTime: 0 }),
  /** What History lists, read afresh each time it opens. `pass`: a guest's. */
  documentVersions: (id: string, documentId: string, pass?: string | undefined) => queryOptions({ queryKey: workspaceKeys.documentVersions(id, documentId), queryFn: () => api.workspaces.versions(id, documentId, pass ? { pass } : undefined), staleTime: 0 }),
  /** A version never changes, so what's read stays good for as long as it's being looked at, and goes soon after. */
  documentVersion: (id: string, documentId: string, version: string, pass?: string | undefined) => queryOptions({ queryKey: workspaceKeys.documentVersion(id, documentId, version), queryFn: () => api.workspaces.version(id, documentId, version, pass ? { pass } : undefined), staleTime: Infinity, gcTime: 60_000 }),
  /** Your notes beside each frame of a board, by frame. */
  presenterFrameNotes: (id: string, boardId: string, pass?: string | undefined) => queryOptions({ queryKey: workspaceKeys.presenterFrameNotes(id, boardId), queryFn: () => api.workspaces.presenterNotes.frames(id, boardId, pass ? { pass } : undefined), staleTime: Infinity }),
  /** One document or folder as you see it: what it's called now, and what you can do with it. */
  workspaceItem: (id: string, itemId: string) => queryOptions({ queryKey: workspaceKeys.workspaceItem(id, itemId), queryFn: () => api.workspaces.items.get(id, itemId), retry: false }),
  /**
   * A workspace as you see it: what's in it that you can open, by your own name for each. What a board links to is named from
   * it, and what you can link to is listed from it. Someone else may rename or move something, so it's good for half a minute.
   * `pass`: in a call, the call's.
   */
  workspaceTree: (id: string, pass?: string | undefined) => queryOptions({ queryKey: workspaceKeys.workspaceTree(id), queryFn: () => api.workspaces.get(id, pass ? { pass } : undefined), staleTime: 30_000, retry: false }),
  /**
   * Every file you can reach in a workspace, the newest first, with the documents you reach each through: what the picker
   * offers to reuse, and how a file block knows its file was deleted for good. A guest reads it with their pass.
   */
  workspaceMedia: (id: string, pass?: string | undefined) => queryOptions({ queryKey: workspaceKeys.workspaceMedia(id), queryFn: () => api.workspaces.media.list(id, { pass }), staleTime: 30_000 }),
  /**
   * The boards the board picker offers to bring from `spaces`, your Drive's workspaces as `workspaces` reads them: the boards in
   * the newest, read as it opens, and good for half a minute.
   */
  boardsToBring: (spaces: readonly WorkspaceSummary[]) => queryOptions({
    queryKey: [...workspaceKeys.boardsToBring, spaces.slice(0, BOARD_SPACES).map((w) => w.id).join(' ')], queryFn: () => boardsToBring(spaces), staleTime: 30_000
  }),
  /** What documents say at the top, for their cards in the Drive: read from each as it is, and kept only in this tab's memory. */
  previews: (id: string, ids: readonly string[]) => queryOptions({ queryKey: workspaceKeys.previews(id, ids), queryFn: () => api.workspaces.previews(id, [...ids]), staleTime: 30_000, enabled: ids.length > 0 }),
  /** One Trash for every workspace you can open something in. */
  trashed: () => queryOptions({ queryKey: workspaceKeys.trashed, queryFn: () => api.workspaces.trashed() }),
  /** Read from each document as it is, for whoever can open it: a few at a time, for the cards on a workspace's Home. */
  workspacePreviews: (id: string, items: readonly string[]) => queryOptions({ queryKey: workspaceKeys.workspacePreviews(id, items), queryFn: () => api.workspaces.previews(id, [...items]), staleTime: 30_000 }),
  workspaceAbout: (id: string) => queryOptions({ queryKey: workspaceKeys.workspaceAbout(id), queryFn: () => api.workspaces.about(id) })
};

/** Makes a workspace. On a team, while licensed, `access` says who's in it: the whole team, or only the people added. */
export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, access }: { name: string; access?: TeamAccess | undefined }) => api.workspaces.create(name, { access }),
    onSuccess: () => qc.invalidateQueries({ queryKey: workspaceKeys.workspaces, exact: true })
  });
}
/** Admins of a team's workspace: who's in it, the whole team or only the people added. */
export function useSetTeamAccess(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (access: TeamAccess) => api.workspaces.setTeamAccess(workspaceId, access),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: workspaceKeys.workspaceTree(workspaceId) });
      void qc.invalidateQueries({ queryKey: workspaceKeys.workspacePeople(workspaceId) });
      void qc.invalidateQueries({ queryKey: workspaceKeys.workspaces, exact: true });
    }
  });
}
export function useRenameWorkspace() {
  const qc = useQueryClient();
  return useMutation(renameWorkspaceOptions(api, qc, renameKeys));
}
/**
 * Only the requested name overlays the live tree. Once that stream acknowledges it, later people’s renames own it. The list of
 * workspaces is read only while a rename of this one is on its way, so somewhere that only shows the name, such as a call
 * screen, never lists them all.
 */
export function useWorkspaceName(id: string, liveName: string, signedIn: boolean) {
  const changes = useMutationState({ filters: { mutationKey: ['workspaces', 'rename'] }, select: (mutation) => {
    const v = mutation.state.variables;
    return v && typeof v === 'object' && 'id' in v && v.id === id && 'name' in v && typeof v.name === 'string'
      ? { name: v.name, status: mutation.state.status, n: mutation.mutationId } : null;
  } }).filter((change) => change !== null);
  const latest = changes.at(-1);
  const caught = useRef(0);
  useEffect(() => { if (latest?.status === 'success' && latest.name === liveName) caught.current = latest.n; }, [latest?.n, latest?.name, latest?.status, liveName]);
  const pending = changes.some((change) => change.status === 'pending');
  const waiting = latest?.status === 'success' && latest.n > caught.current && latest.name !== liveName;
  const list = useQuery({ ...workspaceQueries.workspaces(), enabled: signedIn && (pending || waiting) }).data;
  const name = (pending || waiting) ? list?.find((space) => space.id === id)?.name ?? liveName : liveName;
  return { name, state: pending ? 'saving' : latest?.status === 'error' ? 'failed' : latest?.status === 'success' ? 'saved' : 'quiet' } as const;
}
/**
 * Renames a board open in a call, for anyone who can change it: the call reads its new name from the workspace. What names
 * boards outside the call takes the new name at once, so nothing brings the old one back: the board's workspace as the call
 * reads it (which a saved board open just for you is named from), the item, the board picker's Your team's boards and the
 * Drive's library, each read again too. `pass`: the call's.
 */
export function useRenameBoard(pass: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { workspaceId: string; id: string; name: string }) => api.workspaces.items.rename(v.workspaceId, v.id, v.name, pass ? { pass } : undefined),
    onSuccess: (_, v) => {
      qc.setQueryData<WorkspaceTree>(workspaceKeys.workspaceTree(v.workspaceId), (t) => t && { ...t, items: t.items.map((i) => (i.id === v.id ? { ...i, name: v.name } : i)) });
      qc.setQueriesData<BoardToBring[]>({ queryKey: workspaceKeys.boardsToBring }, (list) => list?.map((b) => (b.workspaceId === v.workspaceId && b.id === v.id ? { ...b, name: v.name } : b)));
      qc.setQueryData<DocumentLibrary>(workspaceKeys.documents, (lib) => lib && { workspaces: lib.workspaces.map((w) => (w.id !== v.workspaceId ? w : { ...w, documents: w.documents.map((d) => (d.id === v.id ? { ...d, name: v.name } : d)) })) });
      for (const queryKey of [workspaceKeys.workspaceTree(v.workspaceId), workspaceKeys.workspaceItem(v.workspaceId, v.id), workspaceKeys.boardsToBring, workspaceKeys.documents]) void qc.invalidateQueries({ queryKey });
    }
  });
}
/**
 * Sort into themes on a board: what the stickies picked say goes to confidential compute through the board's document, and
 * nothing of it is kept. A blank sticky has nothing to sort by and stays where it is, and each is cut to what the notes model
 * takes. Fewer than two with words, or more than it takes at once, is refused here in the server's own words, without asking it.
 * `pass`: the call's, in a call, where the server refuses while notes are paused.
 */
export function useSortStickies(pass?: string | undefined) {
  return useMutation({
    mutationFn: async (v: { workspaceId: string; documentId: string; stickies: readonly { id: string; text: string }[] }) => {
      const stickies = v.stickies.flatMap((s) => {
        const text = s.text.trim().slice(0, MAX_SORT_STICKY).trim();
        return text ? [{ id: s.id, text }] : [];
      });
      if (stickies.length < 2) throw new AlcoveApiError('invalid', SORT_TOO_FEW);
      if (stickies.length > MAX_SORT_STICKIES) throw new AlcoveApiError('invalid', SORT_TOO_MANY);
      return (await api.workspaces.sortStickies(v.workspaceId, v.documentId, { stickies }, pass ? { pass } : undefined)).themes;
    }
  });
}
/** A document in a workspace made a moment ago, before anything in it is on screen: a call's new workspace starts with one. `pass`: the call's. */
export function useFirstDocument(pass: string | undefined) {
  return useMutation({ mutationFn: (workspaceId: string) => api.workspaces.items.create(workspaceId, { kind: 'document' }, pass ? { pass } : undefined) });
}
/**
 * Changes to a workspace's tree. Nothing's cached: what changed reaches the list on the workspace's stream. What can be brought
 * to a call is read again after each, as it lists these documents. `pass`: the call's, in a call, where it lets anyone in the
 * call change what's in the workspace it uses; deleting for good is never the pass's.
 */
export function useItemChanges() {
  const qc = useQueryClient();
  const w = api.workspaces;
  type Target = { workspaceId: string; pass: string | undefined };
  const as = (target: Target) => target.pass ? { pass: target.pass } : undefined;
  const library = () => qc.invalidateQueries({ queryKey: workspaceKeys.documents });
  return {
    create: useMutation({ mutationFn: (v: Target & { input: ItemInput }) => w.items.create(v.workspaceId, v.input, as(v)), onSuccess: library }),
    // The live owner orders work; explicit targets survive an observer's options changing during navigation.
    rename: useMutation({ mutationFn: (v: Target & { id: string; name: string }) => w.items.rename(v.workspaceId, v.id, v.name, as(v)), onSuccess: library }),
    move: useMutation({ mutationFn: (v: Target & { id: string; to: ItemPlace }) => w.items.move(v.workspaceId, v.id, v.to, as(v)), onSuccess: library }),
    duplicate: useMutation({ mutationFn: (v: Target & { id: string }) => w.items.duplicate(v.workspaceId, v.id, as(v)), onSuccess: library }),
    trash: useMutation({ mutationFn: (v: Target & { id: string }) => w.items.trash(v.workspaceId, v.id, as(v)), onSuccess: library }),
    restore: useMutation({ mutationFn: (v: Target & { id: string }) => w.items.restore(v.workspaceId, v.id, as(v)), onSuccess: library }),
    deleteForever: useMutation({ mutationFn: (v: Target & { id: string }) => w.items.deleteForever(v.workspaceId, v.id), onSuccess: library })
  };
}
/** Tells someone they were tagged. `pass`: someone in a call. */
export function useMention(workspaceId: string, pass?: string | undefined) {
  return useMutation({ mutationFn: (v: MentionBody & { document: string }) => api.workspaces.mention(workspaceId, v.document, { to: v.to, block: v.block }, pass ? { pass } : undefined) });
}
/** You've heard about a tag. */
export function useMentionSeen() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { workspaceId: string; mention: string }) => api.workspaces.mentionSeen(v.workspaceId, v.mention), onSuccess: () => {
    const owner = qc.getQueryData(accountQueries.session().queryKey)?.ownerId;
    if (owner) announceMentionsRead(owner);
    return qc.invalidateQueries({ queryKey: workspaceKeys.mentions });
  } });
}
/** Keeps your notes beside one frame of a board: what's kept is what the board's notes say from then on. Empty text takes them away. */
export function useSavePresenterFrameNote(workspaceId: string, boardId: string, pass?: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ frame, text }: { frame: string; text: string }) => api.workspaces.presenterNotes.setFrame(workspaceId, boardId, frame, text, pass ? { pass } : undefined),
    onSuccess: (_: void, { frame, text }: { frame: string; text: string }) => qc.setQueryData(workspaceKeys.presenterFrameNotes(workspaceId, boardId), (was: PresenterFrameNotes | undefined) => {
      const { [frame]: _gone, ...rest } = was?.frames ?? {};
      return { frames: text ? { ...rest, [frame]: text } : rest };
    })
  });
}
/** Makes a new document of words that didn't reach the one they were written in (`DocSession.unsentCopy`). */
export function useSaveCopy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { workspaceId: string; input: ItemInput & { state: Uint8Array } }) => api.workspaces.saveCopy(v.workspaceId, v.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: workspaceKeys.documents })
  });
}
/**
 * A workspace's files: reusing one in another document, and deleting one for good, everywhere. Each reads the list of files
 * again after, as uploads do.
 */
export function useMediaChanges(workspaceId: string, pass?: string | undefined) {
  const qc = useQueryClient();
  const reread = () => qc.invalidateQueries({ queryKey: workspaceKeys.workspaceMedia(workspaceId) });
  const m = api.workspaces.media;
  return {
    attach: useMutation({ mutationFn: (v: { documentId: string; media: string }) => m.attach(workspaceId, v.documentId, v.media, { pass }), onSettled: reread }),
    remove: useMutation({ mutationFn: (v: { documentId: string; media: string }) => m.remove(workspaceId, v.documentId, v.media, { pass }), onSettled: reread })
  };
}

/** Who has a document: adding someone, taking them off, and closing it to the workspace. */
export function useDocumentShare(workspaceId: string, documentId: string, pass?: string | undefined) {
  const qc = useQueryClient();
  const reread = () => qc.invalidateQueries({ queryKey: workspaceKeys.documentShare(workspaceId, documentId) });
  const s = api.workspaces.share;
  return {
    set: useMutation({ mutationFn: (v: { to: ShareTarget[]; role: DocumentRole }) => s.set(workspaceId, documentId, v.to, v.role, pass ? { pass } : undefined), onSuccess: reread }),
    remove: useMutation({ mutationFn: (entry: string) => s.remove(workspaceId, documentId, entry, pass ? { pass } : undefined), onSuccess: reread }),
    restrict: useMutation({ mutationFn: (restricted: boolean) => s.restrict(workspaceId, documentId, restricted, pass ? { pass } : undefined), onSuccess: reread })
  };
}
/** Putting a document back to a version, for everyone. What it said is kept as a version first, so the list has one more. */
export function useRestoreVersion(workspaceId: string, documentId: string, pass?: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (version: string) => {
      await api.workspaces.restoreVersion(workspaceId, documentId, version, pass ? { pass } : undefined);
      return qc.fetchQuery({ ...workspaceQueries.documentVersions(workspaceId, documentId, pass), staleTime: 0 });
    }
  });
}
/** Who's in a workspace: adding someone, changing what they can do, and taking them out, or yourself. */
export function useWorkspacePeople(workspaceId: string) {
  const qc = useQueryClient();
  const reread = () => qc.invalidateQueries({ queryKey: workspaceKeys.workspacePeople(workspaceId) });
  const w = api.workspaces;
  return {
    add: useMutation({ mutationFn: (v: { email: string; role: WorkspaceRole }) => w.addPerson(workspaceId, v.email, v.role), onSuccess: reread }),
    setRole: useMutation({ mutationFn: (v: { id: string; role: WorkspaceRole }) => w.setRole(workspaceId, v.id, v.role), onSuccess: reread }),
    remove: useMutation({ mutationFn: (id: string) => w.removePerson(workspaceId, id), onSuccess: reread })
  };
}

/**
 * What the Drive changes in a workspace: making something, renaming it, sending it to Trash and bringing it back. Each reads
 * again what the Drive shows of it: the library Recent is made of, the workspace's tree, and one Trash.
 */
export function useDriveItems() {
  const qc = useQueryClient();
  const w = api.workspaces;
  const reread = (v: { workspaceId: string }) => Promise.all([workspaceKeys.documents, workspaceKeys.trashed, workspaceKeys.workspaceTree(v.workspaceId)].map((queryKey) => qc.invalidateQueries({ queryKey })));
  return {
    create: useMutation({ mutationFn: (v: { workspaceId: string; input: ItemInput }) => w.items.create(v.workspaceId, v.input), onSuccess: (_, v) => reread(v) }),
    rename: useMutation({ mutationFn: (v: { workspaceId: string; id: string; name: string }) => w.items.rename(v.workspaceId, v.id, v.name), onSuccess: (_, v) => reread(v) }),
    trash: useMutation({ mutationFn: (v: { workspaceId: string; id: string }) => w.items.trash(v.workspaceId, v.id), onSuccess: (_, v) => reread(v) }),
    restore: useMutation({ mutationFn: (v: { workspaceId: string; id: string }) => w.items.restore(v.workspaceId, v.id), onSuccess: (_, v) => reread(v) })
  };
}

/** Says what a workspace is for: the line shows at once, and goes back to what it was if Alcove doesn't take it. */
export function useSetWorkspaceAbout(id: string) {
  const qc = useQueryClient();
  const key = workspaceQueries.workspaceAbout(id).queryKey;
  return useMutation({
    mutationFn: (about: string) => api.workspaces.setAbout(id, about),
    onMutate: async (about) => {
      await qc.cancelQueries({ queryKey: key });
      const was = qc.getQueryData(key);
      qc.setQueryData(key, about.replace(/\s+/g, ' ').trim());
      return { was };
    },
    onError: (_e, _about, context) => { if (context) qc.setQueryData(key, context.was); },
    onSettled: () => qc.invalidateQueries({ queryKey: key })
  });
}
