import { z } from '../shared/zod';
/* ---------- this browser's devices ---------- */

/** The most camera video someone sends: 720p (standard), 1080p (HD), or 360p to save data. */
export const VideoSendSchema = z.enum(['standard', 'hd', 'saver']);

export type VideoSend = z.infer<typeof VideoSendSchema>;

/** Others' cameras as someone receives them: as sharp as each tile needs, capped low to save data, or none. */
export const VideoReceiveSchema = z.enum(['auto', 'saver', 'off']);

export type VideoReceive = z.infer<typeof VideoReceiveSchema>;

/**
 * The microphone, camera and speaker someone chose, whether the browser should reduce noise and blur their
 * background, and the video they send and see: remembered in their browser only, never sent anywhere.
 */
export const DevicePrefsSchema = z.object({
  mic: z.string().max(300).optional(), cam: z.string().max(300).optional(), speaker: z.string().max(300).optional(),
  noiseReduction: z.boolean().optional(), blur: z.boolean().optional(),
  sendVideo: VideoSendSchema.optional(), receiveVideo: VideoReceiveSchema.optional()
});

export type DevicePrefs = z.infer<typeof DevicePrefsSchema>;
