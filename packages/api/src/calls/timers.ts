import { ISODateSchema, IDSchema } from '../shared/ids';
import { z } from '../shared/zod';

export const CallTimerSegmentSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  label: z.string().trim().min(1).max(120),
  durationSeconds: z.number().int().min(1).max(86_400),
  presenter: z.string().trim().min(1).max(120).nullable()
});
export type CallTimerSegment = z.infer<typeof CallTimerSegmentSchema>;
const Segments = z.array(CallTimerSegmentSchema).min(1).max(50).refine((segments) => new Set(segments.map((s) => s.id)).size === segments.length, 'Timer segments need distinct IDs.');
/** The timer is call-wide. Time keeps running beyond zero until the host explicitly advances. */
export const CallTimerSequenceSchema = z.object({
  revision: z.number().int().nonnegative(), segments: Segments,
  activeIndex: z.number().int().nonnegative(), status: z.enum(['ready', 'running', 'paused', 'finished']),
  /** Milliseconds already elapsed before startedAt, excluding pauses. */
  elapsedMs: z.number().nonnegative(),
  /** Server milliseconds since epoch, or null while ready, paused or finished. */
  startedAt: z.number().nonnegative().nullable(), addedSeconds: z.number().int().nonnegative()
}).refine((s) => s.activeIndex < s.segments.length && (s.status === 'running') === (s.startedAt !== null), 'Timer state must name its current segment and clock.');
export type CallTimerSequence = z.infer<typeof CallTimerSequenceSchema>;
export const CallTimerSequenceInputSchema = z.object({ expectedRevision: z.number().int().nonnegative().nullable(), segments: Segments });
export type CallTimerSequenceInput = z.infer<typeof CallTimerSequenceInputSchema>;
export const CallTimerControlSchema = z.discriminatedUnion('action', [
  z.object({ expectedRevision: z.number().int().nonnegative(), action: z.enum(['start', 'pause', 'resume', 'restart', 'advance', 'skip']) }),
  z.object({ expectedRevision: z.number().int().nonnegative(), action: z.literal('add-time'), seconds: z.number().int().min(1).max(86_400) })
]);
export type CallTimerControl = z.infer<typeof CallTimerControlSchema>;
export const CallTimerPresetInputSchema = z.object({ name: z.string().trim().min(1).max(120), segments: Segments });
export type CallTimerPresetInput = z.infer<typeof CallTimerPresetInputSchema>;
export const CallTimerPresetUpdateSchema = CallTimerPresetInputSchema.extend({ expectedRevision: z.number().int().nonnegative() });
export type CallTimerPresetUpdate = z.infer<typeof CallTimerPresetUpdateSchema>;
export const CallTimerPresetSchema = CallTimerPresetInputSchema.extend({ id: IDSchema, revision: z.number().int().nonnegative(), createdAt: ISODateSchema, updatedAt: ISODateSchema });
export type CallTimerPreset = z.infer<typeof CallTimerPresetSchema>;
export const CallTimerCuePreferenceSchema = z.boolean();
export interface CallTimerPresetsApi {
  list(): Promise<CallTimerPreset[]>;
  create(input: CallTimerPresetInput): Promise<CallTimerPreset>;
  update(id: string, input: CallTimerPresetUpdate): Promise<CallTimerPreset>;
  remove(id: string): Promise<void>;
}
