import type { DriveExportChoice, DriveExportJob, DriveFolder, DriveSettings } from '@alcove/api';
import type { World } from './index';
import { iso } from './clock';

export interface DriveWorld {
  settings: DriveSettings;
  folders: DriveFolder[];
  jobs: DriveExportJob[];
  overrides: Record<string, DriveExportChoice>;
}
export const disconnectedDrive = (): DriveWorld => ({
  settings: { connection: { status: 'disconnected', email: null }, enabled: false, destination: null, formats: [] }, folders: [], jobs: [], overrides: {}
});
export const DRIVE_FOLDERS: DriveFolder[] = [
  { id: 'vandelay_call_notes', name: 'Call notes', driveId: null },
  { id: 'vandelay_product_review', name: 'Product / Call exports', driveId: 'vandelay_product_shared_drive' },
  { id: 'vandelay_research', name: 'Research interviews', driveId: 'vandelay_research_shared_drive' }
];
/** The Google account and folders are made-up. No provider page, credentials or real file is involved. */
export function withDriveExports(w: World) {
  const folder = DRIVE_FOLDERS[0];
  if (!folder) return;
  w.drive = {
    settings: { connection: { status: 'connected', email: 'art@vandelay.industries' }, enabled: true, destination: folder, formats: ['notes-markdown', 'transcript-text'] },
    folders: structuredClone(DRIVE_FOLDERS), overrides: {},
    jobs: [
      { id: 'drive-notes-uploaded', noteId: 'n2', format: 'notes-markdown', status: 'uploaded', reason: null, fileUrl: 'https://drive.google.com/file/d/preview_alcove_notes/view', updatedAt: iso(0, 9, 35) },
      { id: 'drive-transcript-uploading', noteId: 'n2', format: 'transcript-text', status: 'uploading', reason: null, fileUrl: null, updatedAt: iso(0, 16, 12) },
      { id: 'drive-recording-pending', noteId: 'n2', format: 'recording-zip', status: 'pending', reason: null, fileUrl: null, updatedAt: iso(0, 16, 12) },
      { id: 'drive-recording-failed', noteId: 'n4', format: 'recording-zip', status: 'failed', reason: 'The destination folder is unavailable. Choose a folder you can write to, then retry.', fileUrl: null, updatedAt: iso(-1, 12, 0) }
    ]
  };
}
export function withDriveReconnect(w: World) {
  withDriveExports(w);
  w.drive.settings.connection.status = 'reconnect';
  w.drive.jobs = w.drive.jobs.map((job) => job.status === 'uploaded' ? job : { ...job, status: 'reconnect', reason: 'Google access has ended. Reconnect Google Drive to try again.' });
}

/** Art can read Maya's call and exports only the shared notes and transcript to Art's own Drive. */
export function withSharedCallExports(w: World) {
  withDriveExports(w);
  w.drive.settings.formats = ['notes-markdown', 'transcript-text', 'recording-zip'];
  w.drive.jobs = w.drive.jobs.filter((job) => job.format !== 'recording-zip').map((job) => ({ ...job, noteId: 'n3' }));
}
