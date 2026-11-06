import { ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
/*
 * Room recordings kept on this device until they upload, as the browser's IndexedDB holds them
 * (apps/web/src/features/record/offline.ts). Whatever is readable (the name, the audio, the speech) is sealed with
 * AES-GCM under a key made on this device that can't be exported, with a fresh IV each time, bound to where it
 * belongs. In the clear: opaque IDs, times, lengths, sizes and the codec.
 */
export const DeviceSealedSchema = z.object({ iv: z.instanceof(ArrayBuffer), data: z.instanceof(ArrayBuffer) });

export type DeviceSealed = z.infer<typeof DeviceSealedSchema>;

/**
 * `recording`: a recorder has it, or had it until its tab closed. `finished`: it waits to upload. `discarded`: it was
 * thrown away, and whatever reached Alcove of it is deleted when there's a connection.
 */
export const KeptStateSchema = z.enum(['recording', 'finished', 'discarded']);

export type KeptState = z.infer<typeof KeptStateSchema>;

export const KeptRecordingSchema = z.object({
  id: z.string().min(1).max(100),
  /** The account it was recorded under. Only that account uploads it or sees it here. */
  owner: z.string().min(1).max(100),
  /** When it started, to the millisecond: it uploads as starting then (RoomRecordingInput.startedAt). */
  startedAt: ISODateSchema,
  state: KeptStateSchema,
  /** How long it is, as far as this device knows. */
  seconds: z.number().min(0),
  /** The audio and speech kept here, in bytes. */
  bytes: z.number().int().min(0),
  /** The recording it began as on Alcove, once it had one. */
  server: z.string().max(100).nullable(),
  /** Alcove was asked to start it at least once: it may be there even if the answer never came. */
  tried: z.boolean(),
  /** Something kept of it won't open on this device any more (its key is gone): it's never uploaded, only deleted. */
  unreadable: z.boolean(),
  /** Why Alcove refused it the last time it tried, as Alcove said it. */
  problem: z.string().max(500).nullable(),
  title: DeviceSealedSchema
});

export type KeptRecording = z.infer<typeof KeptRecordingSchema>;

/** A piece of a kept recording's audio, exactly as it would have been sent (AudioPiece). */
export const KeptPieceSchema = z.object({
  rec: z.string().min(1).max(100), segment: z.number().int().min(0), seq: z.number().int().min(0), at: z.number().min(0),
  durationMs: z.number().min(0), mimeType: z.string().max(100), sealed: DeviceSealedSchema
});

export type KeptPiece = z.infer<typeof KeptPieceSchema>;

/** A clip of a kept recording's speech, waiting to be transcribed (TranscriptClip), found by where it starts. */
export const KeptClipSchema = z.object({
  rec: z.string().min(1).max(100), segment: z.number().int().min(0), atMs: z.number().int().min(0), at: z.number().min(0),
  durationMs: z.number().min(0), sealed: DeviceSealedSchema
});

export type KeptClip = z.infer<typeof KeptClipSchema>;
