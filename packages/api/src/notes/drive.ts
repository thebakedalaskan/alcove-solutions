import { z } from '../shared/zod';
import { IDSchema, ISODateSchema } from '../shared/ids';

/** Provider references travel in request bodies, never in Alcove URLs. */
export const DriveFolderIdSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/);
export const DriveFolderSchema = z.object({
  id: DriveFolderIdSchema,
  name: z.string().max(1000),
  driveId: z.string().nullable()
});
export type DriveFolder = z.infer<typeof DriveFolderSchema>;

/** Recordings retain their original, playable segments in a ZIP archive. */
export const DriveExportFormatSchema = z.enum(['notes-markdown', 'transcript-text', 'recording-zip']);
export type DriveExportFormat = z.infer<typeof DriveExportFormatSchema>;
export const DriveExportInputSchema = z.object({
  enabled: z.boolean(),
  destinationId: DriveFolderIdSchema.nullable(),
  formats: z.array(DriveExportFormatSchema).max(3)
});
export type DriveExportInput = z.infer<typeof DriveExportInputSchema>;
export const DriveExportChoiceSchema = z.object({
  enabled: z.boolean(),
  destination: DriveFolderSchema.nullable(),
  formats: z.array(DriveExportFormatSchema).max(3)
});
export type DriveExportChoice = z.infer<typeof DriveExportChoiceSchema>;
export const DriveSettingsSchema = DriveExportChoiceSchema.extend({
  connection: z.object({
    status: z.enum(['disconnected', 'connected', 'reconnect']),
    email: z.string().nullable()
  })
});
export type DriveSettings = z.infer<typeof DriveSettingsSchema>;
export const DriveExportJobSchema = z.object({
  id: IDSchema,
  noteId: IDSchema,
  format: DriveExportFormatSchema,
  status: z.enum(['pending', 'uploading', 'uploaded', 'failed', 'reconnect']),
  reason: z.string().nullable(),
  fileUrl: z.string().url().nullable(),
  updatedAt: ISODateSchema
});
export type DriveExportJob = z.infer<typeof DriveExportJobSchema>;
export const DriveCallExportsSchema = z.object({
  noteId: IDSchema,
  override: DriveExportChoiceSchema.nullable(),
  effective: DriveExportChoiceSchema,
  jobs: z.array(DriveExportJobSchema)
});
export type DriveCallExports = z.infer<typeof DriveCallExportsSchema>;
export const DriveConnectSchema = z.object({ url: z.string().url() });
export const DriveConnectResultSchema = z.enum(['connected', 'cancelled', 'failed']);
