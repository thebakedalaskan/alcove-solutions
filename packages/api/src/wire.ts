/*
 * HTTP wire shapes shared by @alcove/api-http and the server. These are transport details, not
 * domain types: the app never sees them.
 */
import { z } from 'zod';
import { RootSourceSchema } from './types';

const b64url = z.string().regex(/^[A-Za-z0-9_-]*$/);
const transport = z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);

/** A WebAuthn registration result as produced by PublicKeyCredential#toJSON(). */
export const RegistrationCredentialSchema = z.object({
  id: b64url,
  rawId: b64url,
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  response: z.object({
    clientDataJSON: b64url,
    attestationObject: b64url,
    authenticatorData: b64url.optional(),
    transports: z.array(transport).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: b64url.optional()
  }),
  clientExtensionResults: z.object({})
});
export type RegistrationCredential = z.infer<typeof RegistrationCredentialSchema>;

/** A WebAuthn assertion as produced by PublicKeyCredential#toJSON(). */
export const AssertionCredentialSchema = z.object({
  id: b64url,
  rawId: b64url,
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  response: z.object({
    clientDataJSON: b64url,
    authenticatorData: b64url,
    signature: b64url,
    userHandle: b64url.optional()
  }),
  clientExtensionResults: z.object({})
});
export type AssertionCredential = z.infer<typeof AssertionCredentialSchema>;

/** Options handed to the browser, plus the server-side challenge they belong to. */
export const CeremonyStartSchema = z.object({ challengeId: z.string(), options: z.record(z.string(), z.unknown()) });
export type CeremonyStart = z.infer<typeof CeremonyStartSchema>;

/**
 * `secret` is 32 bytes (base64url) that only this passkey can produce: its PRF output, or a
 * device-held secret when the authenticator lacks PRF. The server uses it to wrap and unwrap the
 * owner root and never stores it.
 */
const secret = b64url.length(43);
export const RegisterStartBodySchema = z.object({ name: z.string().trim().min(1).max(80) });
export const RegisterFinishBodySchema = z.object({ challengeId: z.string(), credential: RegistrationCredentialSchema, secret, rootSource: RootSourceSchema, deviceName: z.string().max(80) });
export const UnlockFinishBodySchema = z.object({ challengeId: z.string(), credential: AssertionCredentialSchema, secret, rootSource: RootSourceSchema });
export const AddPasskeyFinishBodySchema = RegisterFinishBodySchema.omit({});

/** Fixed PRF input. Every Alcove passkey evaluates PRF over this salt. */
export const PRF_SALT_LABEL = 'MVP/passkey-prf/v1';

/** One state change in a call, sent as POST /calls/:id/actions. The server answers with the new CallState. */
export const CallActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mic'), on: z.boolean() }),
  z.object({ type: z.literal('cam'), on: z.boolean() }),
  z.object({ type: z.literal('hand'), up: z.boolean() }),
  z.object({ type: z.literal('sharing'), on: z.boolean(), title: z.string().max(120).optional() }),
  z.object({ type: z.literal('chat'), text: z.string().trim().min(1).max(4000) }),
  z.object({ type: z.literal('notes-start'), mode: z.enum(['full', 'notes']) }),
  z.object({ type: z.literal('notes-pause') }),
  z.object({ type: z.literal('notes-resume') }),
  z.object({ type: z.literal('notes-stop') }),
  z.object({ type: z.literal('dismiss'), id: z.string() })
]);
export type CallAction = z.infer<typeof CallActionSchema>;

export const RecordingActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rename'), title: z.string().trim().min(1).max(160) }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') })
]);
export type RecordingAction = z.infer<typeof RecordingActionSchema>;

/** Audio pieces travel as raw bytes with their position in these headers. */
export const AUDIO_HEADERS = { segment: 'x-alcove-segment', seq: 'x-alcove-seq', duration: 'x-alcove-duration-ms' } as const;
/** Mutations carry an operation ID so a retried request never applies twice (docs: Network and API contract). */
export const OPERATION_HEADER = 'x-alcove-operation';
export const MAX_AUDIO_PIECE_BYTES = 2 * 1024 * 1024;
