/*
 * HTTP wire shapes shared by @alcove/api-http and the server. These are transport details, not
 * domain types: the app never sees them.
 */
import { z } from 'zod';
/**
 * Providers that still sign in a demo identity until they're connected: Microsoft is always Art
 * Vandelay, and single sign-on is whoever's work email is typed. Google is real: the browser goes
 * to `AlcoveApi.auth.signInUrl('google')` instead.
 */
export const DemoProviderSchema = z.enum(['microsoft', 'sso']);
export type DemoProvider = z.infer<typeof DemoProviderSchema>;

export const SignInBodySchema = z.object({
  provider: DemoProviderSchema,
  /** The work email typed for single sign-on. */
  email: z.string().trim().max(254).optional()
});
export type SignInBody = z.infer<typeof SignInBodySchema>;

/** Search terms travel in a POST body so they never appear in URLs or access logs. */
export const PeopleSearchBodySchema = z.object({ query: z.string().max(200) });
export const TeamInviteBodySchema = z.object({ emails: z.array(z.string().trim().toLowerCase().max(254)).min(1).max(50) });
export const ShareBodySchema = z.object({ emails: z.array(z.string().trim().toLowerCase().max(254)).min(1).max(50) });

/** One state change in a call, sent as POST /calls/:id/actions. The server answers with the new CallState. */
export const CallActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mic'), on: z.boolean() }),
  z.object({ type: z.literal('cam'), on: z.boolean() }),
  z.object({ type: z.literal('hand'), up: z.boolean() }),
  z.object({ type: z.literal('sharing'), on: z.boolean(), title: z.string().max(120).optional() }),
  z.object({ type: z.literal('chat'), text: z.string().trim().min(1).max(4000) }),
  z.object({ type: z.literal('notes'), on: z.boolean() }),
  z.object({ type: z.literal('dismiss'), id: z.string() })
]);
export type CallAction = z.infer<typeof CallActionSchema>;

export const RecordingActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rename'), title: z.string().trim().min(1).max(160) }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') })
]);
export type RecordingAction = z.infer<typeof RecordingActionSchema>;

/**
 * Audio pieces and transcript clips travel as raw bytes with their position in these headers: a
 * piece by its sequence number, a clip by where it starts in its segment.
 */
export const AUDIO_HEADERS = { segment: 'x-alcove-segment', seq: 'x-alcove-seq', start: 'x-alcove-start-ms', duration: 'x-alcove-duration-ms' } as const;
/** Mutations carry an operation ID so a retried request never applies twice (docs: Network and API contract). */
export const OPERATION_HEADER = 'x-alcove-operation';
export const MAX_AUDIO_PIECE_BYTES = 2 * 1024 * 1024;
/** A transcript clip: at most 30 seconds of 16 kHz mono 16-bit WAV. */
export const MAX_TRANSCRIPT_CLIP_MS = 30_000;
export const MAX_TRANSCRIPT_CLIP_BYTES = 44 + MAX_TRANSCRIPT_CLIP_MS * 32;
/** Asking about a call: the question travels in the body. */
export const AskBodySchema = z.object({ question: z.string().trim().min(1).max(500) });
/** Catching up during a call: how far back to read, or the whole call. */
export const CatchUpBodySchema = z.object({ minutes: z.number().int().min(1).max(600).optional() });

/* ---------- logging ---------- */
/** Every response carries this header; error bodies repeat it as `requestId`. Quote it when reporting a problem. */
export const REQUEST_ID_HEADER = 'x-request-id';
const ClientLogValueSchema = z.union([z.string().max(300), z.number(), z.boolean(), z.null()]);
/**
 * A warning or error the browser reports so it lands in the server log next to the request it came
 * from. Codes, names, sizes and states only: never titles, names, chat, notes or keys.
 */
export const ClientLogEntrySchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']),
  msg: z.string().min(1).max(200),
  at: z.string().max(40),
  context: z.record(z.string().max(40), ClientLogValueSchema).refine((r) => Object.keys(r).length <= 30, 'Too many fields.').default({})
});
export type ClientLogEntry = z.infer<typeof ClientLogEntrySchema>;
export const ClientLogBatchSchema = z.object({ entries: z.array(ClientLogEntrySchema).min(1).max(20) });
