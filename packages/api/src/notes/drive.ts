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
/**
 * One file's export. `pending` waits to upload; with a `reason`, it went wrong in a way that may pass (Google busy, the
 * network) and is tried again at `nextAt`. `nextAt` is only for a pending one.
 */
export const DriveExportJobSchema = z.object({
  id: IDSchema,
  noteId: IDSchema,
  format: DriveExportFormatSchema,
  status: z.enum(['pending', 'uploading', 'uploaded', 'failed', 'reconnect']),
  reason: z.string().nullable(),
  fileUrl: z.string().url().nullable(),
  updatedAt: ISODateSchema,
  nextAt: ISODateSchema.nullable()
});
export type DriveExportJob = z.infer<typeof DriveExportJobSchema>;
/**
 * Whether someone's automatic exports cover a call, by the rule the exports themselves follow: `on`, they're on and the
 * call ended after they were turned on (or hasn't ended yet); `before`, it ended before they were turned on, so it goes
 * only if it's exported on its own; `off`, they're off, or have no folder or files.
 */
export const DriveAutomaticSchema = z.enum(['on', 'before', 'off']);
export type DriveAutomatic = z.infer<typeof DriveAutomaticSchema>;
export const DriveCallExportsSchema = z.object({
  noteId: IDSchema,
  override: DriveExportChoiceSchema.nullable(),
  effective: DriveExportChoiceSchema,
  automatic: DriveAutomaticSchema,
  jobs: z.array(DriveExportJobSchema)
});
export type DriveCallExports = z.infer<typeof DriveCallExportsSchema>;
export const DriveConnectSchema = z.object({ url: z.string().url() });
export const DriveConnectResultSchema = z.enum(['connected', 'cancelled', 'failed']);
/** How Google's way back from connecting Drive went, as Settings' address says it (`?drive=`). */
export type DriveConnectResult = z.infer<typeof DriveConnectResultSchema>;
