import { z } from '../shared/zod';
import { IDSchema } from '../shared/ids';
import { type LiveStore } from '../shared/live';
import { CallIdentity } from './wire';
import { CallPlaceSchema } from './state';

/** Uncompressed P-256 public key. Private keys never leave the active browser session. */
export const DirectPublicKeySchema = z.string().regex(/^B[A-Za-z0-9_-]{86}$/);
export const DirectKeyAnnouncementSchema = z.object({ key: DirectPublicKeySchema, generation: z.number().int().nonnegative(), place: CallPlaceSchema });
export type DirectKeyAnnouncement = z.infer<typeof DirectKeyAnnouncementSchema>;
export const DIRECT_MESSAGE_MAX = 4000;
export const DirectTextSchema = z.object({ text: z.string().trim().min(1).max(DIRECT_MESSAGE_MAX) });
export const DirectSendSchema = z.object({
  id: IDSchema, to: CallIdentity, place: CallPlaceSchema, generation: z.number().int().nonnegative(),
  fromKey: DirectPublicKeySchema, toKey: DirectPublicKeySchema,
  nonce: z.string().regex(/^[A-Za-z0-9_-]{16}$/), ciphertext: z.string().regex(/^[A-Za-z0-9_-]+$/).min(24).max(24_000)
});
export type DirectSend = z.infer<typeof DirectSendSchema>;
export const DirectEnvelopeSchema = DirectSendSchema.extend({ from: CallIdentity, at: z.number().nonnegative(), order: z.number().int().nonnegative(), delivered: z.boolean() });
export type DirectEnvelope = z.infer<typeof DirectEnvelopeSchema>;
export const DirectSyncSchema = z.object({ peers: z.array(CallIdentity), messages: z.array(DirectEnvelopeSchema).max(100), delivered: z.array(IDSchema).max(500), after: z.number().int().nonnegative(), more: z.boolean() });
export type DirectSync = z.infer<typeof DirectSyncSchema>;
export const DirectAckSchema = z.object({ ids: z.array(IDSchema).max(100), after: z.number().int().nonnegative() });
export interface DirectMessage {
  id: string; from: string; to: string; place: string; generation: number; text: string; at: number; order: number;
  state: 'sending' | 'sent' | 'delivered' | 'failed'; error: string | null;
}
export interface DirectMessagesState { ready: boolean; peers: string[]; messages: DirectMessage[]; unread: string[] }
export interface DirectMessagesApi extends LiveStore<DirectMessagesState> {
  /** An exact current connection, never a display name or a replacement participant. */
  send(to: string, text: string): Promise<void>;
  /** Reuses the original envelope and ID. It never changes its audience. */
  retry(id: string): Promise<void>;
  read(ids: readonly string[]): void;
}
