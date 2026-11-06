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
  z.object({ to: z.literal('call'), code: CallCodeSchema }),
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
  z.object({ type: z.literal('alcove.notification'), open: NotificationOpenSchema })
]);
