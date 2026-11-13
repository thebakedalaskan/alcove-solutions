/*
 * Sharing a note: its links, sharing it with people or a group, making it visible to your team, and exporting notes to
 * Google Drive (the connection, the folder, and each note's export).
 */
import type { DriveExportInput, Group } from '@alcove/api';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { teamKeys } from '~/features/team/queryKeys';
import { api } from '~/lib/api';
import { noteChanged, noteGone } from '../queries';
import { noteKeys } from '../queryKeys';

export const sharingQueries = {
  /** The links to a note that still work, read fresh whenever Share opens. */
  noteLinks: (id: string) => queryOptions({ queryKey: noteKeys.noteLinks(id), queryFn: () => api.notes.links(id), staleTime: 0, retry: false }),
  drive: () => queryOptions({ queryKey: noteKeys.drive, queryFn: () => api.drive.get(), retry: false }),
  driveFolders: () => queryOptions({ queryKey: noteKeys.driveFolders, queryFn: () => api.drive.folders(), staleTime: 0, retry: false }),
  driveJobs: () => queryOptions({ queryKey: noteKeys.driveJobs, queryFn: () => api.drive.jobs(), refetchInterval: 10_000, retry: false }),
  // Read again every 10 s, and every 2 s while a file is on its way, so a press shows Uploading, then its link, within seconds.
  driveNote: (id: string) => queryOptions({
    queryKey: noteKeys.driveNote(id), queryFn: () => api.drive.forNote(id), retry: false,
    refetchInterval: (query) => (query.state.data?.jobs.some((job) => job.status === 'uploading' || (job.status === 'pending' && job.reason === null)) ? 2_000 : 10_000)
  })
};

/** Makes a note you organized visible to your team, or stops it being: the note and the team's notes are read again. */
export function useSetTeamVisible(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (visible: boolean) => api.notes.setTeamVisible(noteId, visible),
    onSettled: () => { for (const queryKey of [noteKeys.note(noteId), ['notes', 'list'], teamKeys.teamNotes]) void qc.invalidateQueries({ queryKey }); }
  });
}
/** Makes a link to a note. Its secret is in the answer, said once, for showing where it was made; the list is read again. */
export function useCreateNoteLink(noteId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.notes.createLink(noteId), onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.noteLinks(noteId) }), onError: (e) => noteGone(qc, e) });
}
/** Revokes a link to a note: the answer is the links that still work. */
export function useRevokeNoteLink(noteId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (linkId: string) => api.notes.revokeLink(noteId, linkId), onSuccess: (links) => qc.setQueryData(noteKeys.noteLinks(noteId), links), onError: (e) => noteGone(qc, e) });
}
/**
 * Opens a link for the account signed in, only once they've pressed Open the notes on the link's page (it names the
 * account, since everyone with the notes will see it): its notes join theirs, so the lists are read again.
 */
export function useClaimNoteLink() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (secret: string) => api.notes.claimLink(secret), onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.notes }) });
}
/**
 * Shares a note with people, by address, and with one of your groups, under its name (everyone it reaches sees that
 * it came to them as that group): the group first, then anyone else. The answer is the note as it is now.
 */
export function useShareNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; emails: string[]; group?: Group | undefined }) => {
      const viaGroup = v.group && await api.notes.share(v.id, { emails: v.group.emails, group: v.group.name });
      return viaGroup && !v.emails.length ? viaGroup : api.notes.share(v.id, { emails: v.emails });
    },
    onSuccess: (n) => noteChanged(qc, n),
    // A group's share may have gone through before the rest failed: the note is read again either way.
    onError: (_e, v) => { void qc.invalidateQueries({ queryKey: noteKeys.note(v.id) }); }
  });
}

/** Drive credentials stay on the server; the browser receives only a one-time consent destination. */
export function useConnectDrive() {
  return useMutation({ gcTime: 0, mutationFn: () => api.drive.connect() });
}
export function usePickDriveFolder() {
  return useMutation({ gcTime: 0, mutationFn: () => api.drive.pickFolder() });
}
export function useDisconnectDrive() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.drive.disconnect(), onSuccess: async (settings) => {
    qc.setQueryData(noteKeys.drive, settings);
    await qc.invalidateQueries({ queryKey: noteKeys.drive });
  } });
}
export function useUpdateDrive() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: DriveExportInput) => api.drive.update(input), onSuccess: async (settings) => {
    qc.setQueryData(noteKeys.drive, settings);
    await qc.invalidateQueries({ queryKey: noteKeys.drive });
  } });
}
export function useDriveNote(noteId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: DriveExportInput | null) => api.drive.setForNote(noteId, input), onSuccess: async (choice) => {
    qc.setQueryData(noteKeys.driveNote(noteId), choice);
    await qc.invalidateQueries({ queryKey: noteKeys.driveJobs });
  } });
}
export function useRetryDriveExport() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.drive.retry(id), onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.drive }) });
}
