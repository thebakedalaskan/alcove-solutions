import { z } from '../shared/zod';
import { DeviceSealedSchema } from '../recordings/offline';
/* ---------- this browser's devices ---------- */

/** The most camera video someone sends: 720p (standard), 1080p (HD), or 360p to save data. */
export const VideoSendSchema = z.enum(['standard', 'hd', 'saver']);

export type VideoSend = z.infer<typeof VideoSendSchema>;

/** Others' cameras as someone receives them: as sharp as each tile needs, capped low to save data, or none. */
export const VideoReceiveSchema = z.enum(['auto', 'saver', 'off']);

export type VideoReceive = z.infer<typeof VideoReceiveSchema>;

/** The pictures that come with Alcove to show behind someone. */
export const BACKGROUND_SCENES = ['balloons', 'beach', 'office'] as const;

export const BackgroundSceneSchema = z.enum(BACKGROUND_SCENES);

export type BackgroundScene = z.infer<typeof BackgroundSceneSchema>;

/** Stable picture colors, shared by the picker and the local camera compositor; never a person's page theme. */
export const BACKGROUND_COLORS = ['slate', 'sand', 'rose'] as const;
export const BackgroundColorSchema = z.enum(BACKGROUND_COLORS);
export type BackgroundColor = z.infer<typeof BackgroundColorSchema>;
export const BlurStrengthSchema = z.enum(['mild', 'strong']);
export type BlurStrength = z.infer<typeof BlurStrengthSchema>;

/**
 * What shows behind someone on camera: what's really there, the same blurred, one of Alcove's pictures, or one of
 * their own (kept sealed in their browser, by its ID there).
 */
export const CameraBackgroundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('blur'), strength: BlurStrengthSchema.default('strong') }),
  z.object({ kind: z.literal('color'), id: BackgroundColorSchema }),
  z.object({ kind: z.literal('scene'), id: BackgroundSceneSchema }),
  z.object({ kind: z.literal('custom'), id: z.uuid() })
]);

export type CameraBackground = z.infer<typeof CameraBackgroundSchema>;

/**
 * The microphone, camera and speaker someone chose, whether the browser should reduce noise, what shows behind them on
 * camera, and the video they send and see: remembered in their browser only, never sent anywhere. A browser that kept
 * `blur: true` from before there were backgrounds keeps its blur.
 */
export const DevicePrefsSchema = z.preprocess(
  (v) => (typeof v === 'object' && v !== null && 'blur' in v && v.blur === true && !('background' in v) ? { ...v, background: { kind: 'blur' } } : v),
  z.object({
    mic: z.string().max(300).optional(), cam: z.string().max(300).optional(), speaker: z.string().max(300).optional(),
    noiseReduction: z.boolean().optional(), background: CameraBackgroundSchema.optional(),
    sendVideo: VideoSendSchema.optional(), receiveVideo: VideoReceiveSchema.optional()
  })
);

export type DevicePrefs = z.infer<typeof DevicePrefsSchema>;

/** An opaque browser-storage revision, changed when locally kept data is deleted. Never key material. */
export const DeviceGenerationSchema = z.uuid();

/** An account's picture-storage fence: null after sign-out, or its opaque active generation. */
export const KeptBackgroundAccessSchema = z.string().min(1).max(100).nullable();

/** A picture someone added to show behind them on camera: a JPEG sealed in their browser for their account, never sent. */
export const KeptBackgroundSchema = z.object({ owner: z.string().min(1), id: z.uuid(), at: z.number().min(0), sealed: DeviceSealedSchema });

export type KeptBackground = z.infer<typeof KeptBackgroundSchema>;
