import { type AlcoveApi, DriveCallExportsSchema, DriveConnectSchema, DriveExportJobSchema, DriveFolderSchema, DriveSettingsSchema } from '@alcove/api';
import { z } from 'zod';
import { type HttpTransport } from '../transport/http';

export function createDriveApi(t: HttpTransport): Pick<AlcoveApi, 'drive'> {
  const { req } = t;
  return {
    drive: {
      get: () => req(DriveSettingsSchema, 'GET', '/drive'),
      connect: () => req(DriveConnectSchema, 'POST', '/drive/connect'),
      pickFolder: () => req(DriveConnectSchema, 'POST', '/drive/pick-folder'),
      disconnect: () => req(DriveSettingsSchema, 'DELETE', '/drive'),
      folders: () => req(z.array(DriveFolderSchema), 'GET', '/drive/folders'),
      update: (input) => req(DriveSettingsSchema, 'PUT', '/drive', input),
      jobs: () => req(z.array(DriveExportJobSchema), 'GET', '/drive/jobs'),
      forNote: (noteId) => req(DriveCallExportsSchema, 'GET', `/drive/notes/${encodeURIComponent(noteId)}`),
      setForNote: (noteId, input) => req(DriveCallExportsSchema, 'PUT', `/drive/notes/${encodeURIComponent(noteId)}`, input),
      retry: (jobId) => req(DriveExportJobSchema, 'POST', `/drive/jobs/${encodeURIComponent(jobId)}/retry`)
    }
  };
}
