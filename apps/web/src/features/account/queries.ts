/*
 * The account's data: who's signed in here, which every page reads, and their preferences, with the writes that change
 * them. Preference writes share one ordered queue (lib/queryWrites.ts): Settings, pins, groups and pausing notifications
 * land in the order they were made.
 */
import { AlcoveApiError, errorCode, type Group } from '@alcove/api';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { readSessionWithPictureAccess } from '~/features/call/media/backgrounds/backgrounds';
import { announceNotificationPreferences, settleNotificationPreferences } from '~/features/notifications/preferenceChannel';
import { api } from '~/lib/api';
import { preferenceOptions, readPreferences, type PreferenceChange } from '~/lib/queryWrites';
import { accountGeneration } from '~/lib/signedOut';
import { accountKeys } from './queryKeys';

export const accountQueries = {
  session: () => queryOptions({ queryKey: accountKeys.session, queryFn: () => readSessionWithPictureAccess(() => api.auth.getSession()), staleTime: 60_000 }),
  prefs: () => queryOptions({ queryKey: accountKeys.prefs, queryFn: ({ client }) => readPreferences(api, client), refetchInterval: 30_000, refetchIntervalInBackground: true })
};

/** Each channel hint belongs to its exact immutable query command, including after this hook re-renders. */
const notificationWrites = new WeakMap<object, { owner: string; generation: string; nonce: string }>();
/** Reversible preference fields show at once; the same query owner reconciles serial writes and current reads. */
export function usePreferences() {
  const qc = useQueryClient();
  const options = preferenceOptions(api, qc, accountKeys, (p: PreferenceChange) => p);
  return useMutation({
    ...options,
    onMutate: async (patch, context) => {
      const session = qc.getQueryData(accountQueries.session().queryKey);
      const generation = session ? accountGeneration(session.ownerId) : null;
      const owned = await options.onMutate?.(patch, context);
      if (!owned) throw new AlcoveApiError('unauthenticated', 'Sign in again to save your preferences.');
      const changes = owned.fields.notifications;
      if (session && generation !== null && owned.account.valid() && accountGeneration(session.ownerId) === generation && changes && Object.keys(changes).length) {
        notificationWrites.set(owned.entry, { owner: session.ownerId, generation, nonce: announceNotificationPreferences(session.ownerId, changes) });
      }
      return owned;
    },
    onError: (error, patch, ctx, context) => {
      options.onError?.(error, patch, ctx, context);
      const intent = ctx ? notificationWrites.get(ctx.entry) : undefined;
      if (!ctx?.account.valid() || !intent || accountGeneration(intent.owner) !== intent.generation) return;
      const current = qc.getQueryData(accountQueries.prefs().queryKey);
      if (current) settleNotificationPreferences(intent.owner, intent.nonce, current.notifications, 'rollback');
    },
    onSuccess: (data, patch, ctx, context) => {
      options.onSuccess?.(data, patch, ctx, context);
      const intent = notificationWrites.get(ctx.entry);
      if (!ctx.account.valid() || !intent || accountGeneration(intent.owner) !== intent.generation) return;
      const current = qc.getQueryData(accountQueries.prefs().queryKey);
      if (current) settleNotificationPreferences(intent.owner, intent.nonce, current.notifications, 'confirmed');
    }
  });
}
/** Pinning is a preference change too, in the same ordered queue as Settings and groups. */
export function usePins() {
  const qc = useQueryClient();
  const options = preferenceOptions(api, qc, accountKeys, (pinned: string[]) => ({ pinned }));
  return useMutation({ ...options, onError: (e, pinned, ctx, context) => {
    options.onError?.(e, pinned, ctx, context);
    if (errorCode(e) === 'not-found') void qc.invalidateQueries({ queryKey: ['notes', 'list'] });
  } });
}
/** Groups share that queue, including changes made from another component while one is pending. */
export function useGroups() {
  return useMutation(preferenceOptions(api, useQueryClient(), accountKeys, (groups: Group[]) => ({ groups })));
}
/**
 * Pausing notifications until a time (an ISO date-time), or resuming them (`until: null`), shares that queue too: shown at
 * once, and put back if it's refused. features/notifications/usePause.ts's `usePause` is how the app asks.
 */
export function usePauseNotifications() {
  return useMutation(preferenceOptions(api, useQueryClient(), accountKeys, ({ until }: { until: string | null }) => ({ notificationsPausedUntil: until })));
}
