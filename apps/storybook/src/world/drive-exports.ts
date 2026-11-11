import type { DriveExportChoice, DriveExportJob, DriveFolder, DriveSettings } from '@alcove/api';
import type { World } from './index';
import { iso } from './clock';

export interface DriveWorld {
  settings: DriveSettings;
  folders: DriveFolder[];
  jobs: DriveExportJob[];
  overrides: Record<string, DriveExportChoice>;
  /** When automatic exports were last turned on (empty if they never were): they cover calls that end after it. */
  enabledAt: string;
}
export const disconnectedDrive = (): DriveWorld => ({
  settings: { connection: { status: 'disconnected', email: null }, enabled: false, destination: null, formats: [] }, folders: [], jobs: [], overrides: {}, enabledAt: ''
});
export const DRIVE_FOLDERS: DriveFolder[] = [
  { id: 'vandelay_call_notes', name: 'Call notes', driveId: null },
  { id: 'vandelay_product_review', name: 'Product / Call exports', driveId: 'vandelay_product_shared_drive' },
  { id: 'vandelay_research', name: 'Research interviews', driveId: 'vandelay_research_shared_drive' }
];
/**
 * The Google account and folders are made-up. No provider page, credentials or real file is involved. Automatic exports
 * went on on Monday morning, so the calls since are covered and Launch planning, the week before, isn't. The standup's
 * recording went wrong in a way that may pass, and waits to be tried again.
 */
export function withDriveExports(w: World) {
  const folder = DRIVE_FOLDERS[0];
  if (!folder) return;
  w.drive = {
    settings: { connection: { status: 'connected', email: 'art@vandelay.industries' }, enabled: true, destination: folder, formats: ['notes-markdown', 'transcript-text'] },
    folders: structuredClone(DRIVE_FOLDERS), overrides: {}, enabledAt: iso(-2, 9, 0),
    jobs: [
      { id: 'drive-notes-uploaded', noteId: 'n2', format: 'notes-markdown', status: 'uploaded', reason: null, fileUrl: 'https://drive.google.com/file/d/preview_alcove_notes/view', updatedAt: iso(0, 9, 35), nextAt: null },
      { id: 'drive-transcript-uploading', noteId: 'n2', format: 'transcript-text', status: 'uploading', reason: null, fileUrl: null, updatedAt: iso(0, 16, 12), nextAt: null },
      { id: 'drive-recording-pending', noteId: 'n2', format: 'recording-zip', status: 'pending', reason: 'Google Drive could not confirm the upload. It will be checked before trying again.', fileUrl: null, updatedAt: iso(0, 16, 12), nextAt: iso(0, 16, 52) },
      { id: 'drive-recording-failed', noteId: 'n4', format: 'recording-zip', status: 'failed', reason: 'The destination folder is unavailable. Choose a folder you can write to, then retry.', fileUrl: null, updatedAt: iso(-1, 12, 0), nextAt: null }
    ]
  };
}
/**
 * Back from Google with Drive just connected: Art's account and the folders it let Alcove use, Notes and Transcript ticked
 * as the server ticks them for a new connection, no folder yet, so nothing exports and nothing has gone.
 */
export function withDriveJustConnected(w: World) {
  w.drive = {
    settings: { connection: { status: 'connected', email: 'art@vandelay.industries' }, enabled: false, destination: null, formats: ['notes-markdown', 'transcript-text'] },
    folders: structuredClone(DRIVE_FOLDERS), jobs: [], overrides: {}, enabledAt: ''
  };
}
export function withDriveReconnect(w: World) {
  withDriveExports(w);
  w.drive.settings.connection.status = 'reconnect';
  w.drive.jobs = w.drive.jobs.map((job) => job.status === 'uploaded' ? job : { ...job, status: 'reconnect', reason: 'Google access has ended. Reconnect Google Drive to try again.', nextAt: null });
}

/** Art can read Maya's call and exports only the shared notes and transcript to Art's own Drive. */
export function withSharedCallExports(w: World) {
  withDriveExports(w);
  w.drive.settings.formats = ['notes-markdown', 'transcript-text', 'recording-zip'];
  w.drive.jobs = w.drive.jobs.filter((job) => job.format !== 'recording-zip').map((job) => ({ ...job, noteId: 'n3' }));
}
