import { NotificationPrefsSchema } from './preferences';
import { CallNotificationDestinationSchema } from '../calls/notifications';
import { CallCodeSchema } from '../calls/entry';
import { IDSchema } from '../shared/ids';
import { z } from '../shared/zod';
/**
 * The browser notifications shown for an account in this browser, oldest first, so no tab shows one again: each
 * event's key, made of its kind and the IDs it's about (`call:<meetingId>:<startsAt>`, `ready:<noteId>`), never a
 * title or a name, and when it showed (ms since the epoch). Kept in localStorage for the account
 * (`alcove.notified.<ownerId>`) for a day or until someone signs out here, never sent anywhere.
 */
export const NotifiedStoredSchema = z.array(z.object({ key: z.string().max(300), at: z.number() })).max(500);


/**
 * Where clicking a browser notification leads: a call (its join page, or the call itself for whoever is in it), a
 * note, Notes or Home. It travels on the notification, so the page parses what the service worker hands back.
 */
export const NotificationOpenSchema = z.discriminatedUnion('to', [
  z.object({ to: z.literal('call'), code: CallCodeSchema, event: CallNotificationDestinationSchema.nullable().default(null) }),
  z.object({ to: z.literal('note'), noteId: IDSchema }),
  z.object({ to: z.literal('notes') }),
  z.object({ to: z.literal('home') }),
  /** A line in a document, for someone tagged in it. */
  z.object({ to: z.literal('document'), workspaceId: IDSchema, documentId: IDSchema, block: z.string().nullable() })
]);

export type NotificationOpen = z.infer<typeof NotificationOpenSchema>;

/**
 * What the service worker (apps/web/public/sw.js) posts to the app's windows when a notification is clicked: it asks
 * each where it is, answered on the port it sends, then tells the one it brought forward where the notification leads.
 */
export const WorkerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('alcove.where') }),
  z.object({ type: z.literal('alcove.notification'), open: NotificationOpenSchema, ownerId: IDSchema.nullable().default(null) }),
  z.object({ type: z.literal('alcove.ready') })
]);

/** Minimal OS data; keys, scope and destinations are opaque IDs, never previews or access-bearing links. */
export const BrowserNotificationDataSchema = z.object({
  v: z.literal(1), ownerId: IDSchema.nullable(), source: z.string().min(1).max(300), key: z.string().min(1).max(500), open: NotificationOpenSchema
});
export type BrowserNotificationData = z.infer<typeof BrowserNotificationDataSchema>;
/** Atomic browser-only claims, retained only until the corresponding alert can no longer be delivered. */
export const NotificationReceiptSchema = z.object({
  id: z.string().max(850), owner: z.string().max(200), key: z.string().max(500), token: z.string().max(100),
  state: z.enum(['pending', 'shown']), at: z.number(), until: z.number(), lease: z.number()
});
export type NotificationReceipt = z.infer<typeof NotificationReceiptSchema>;
export const NotificationViewSignalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('view'), tab: z.string().max(100), contexts: z.array(z.string().max(300)).max(10), at: z.number() }),
  z.object({ type: z.literal('gone'), tab: z.string().max(100) }),
  z.object({ type: z.literal('look') })
]);
export type NotificationViewSignal = z.infer<typeof NotificationViewSignalSchema>;
/** A worker may prefer the tab holding the exact original call connection; these IDs grant no access. */
export const NotificationWindowSchema = z.object({
  path: z.string().max(1000), ownerId: IDSchema.nullable(),
  calls: z.array(z.object({ callId: IDSchema, identity: z.string().max(100) })).max(5)
});
/** Boolean choices only; an explicit local change reaches other tabs before their next background poll. */
export const NotificationPreferenceSignalSchema = z.object({
  ownerId: IDSchema.nullable(), nonce: z.string().max(100), at: z.number(), prefs: NotificationPrefsSchema
});
export type NotificationPreferenceSignal = z.infer<typeof NotificationPreferenceSignalSchema>;
