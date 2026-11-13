/*
 * Being rung while Alcove isn't in front: a browser notification that names nobody, raised through the shared delivery
 * owner (features/notifications/delivery.ts, which owns its words, receipts and handles) for each ring whose card is
 * up in this tab, once browser notifications are on, the browser allows them and rings are ticked. Receipts show a ring
 * once across tabs, and none shows while an Alcove tab of the same account is focused, where the card is in front. It
 * closes when the ring ends: answered here or anywhere, declined, or run out. Pressing it brings Alcove forward, where the
 * card is (`open: { to: 'ring' }` leads nowhere else).
 */
import { RING_SECONDS, type IncomingRing, type NotificationPrefs } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import { notificationPreferenceIntent } from '~/features/notifications/preferenceChannel';
import { useNotificationPreferences } from '~/features/notifications/preferences';
import { removeNotificationSource, updateNotificationSource, type BrowserAlert } from '~/features/notifications/delivery';
import { routeBrowserNotification } from '~/features/notifications/navigation';
import { useNotifyPermission } from '~/features/notifications/permission';
import { watchNotificationViews } from '~/features/notifications/views';

const ringsReach = (prefs: NotificationPrefs): boolean => prefs.enabled && prefs.ringing;
const RING_MS = RING_SECONDS * 1000;
/**
 * When a ring began and ends by this browser's clock, as the ring store bounds its card (packages/api-http/src/calls/rings.ts):
 * the time the server says is left, but at most a ring's length from now. A card that's up is ringing, so a clock running
 * ahead never ends its alert early; the alert goes with the card.
 */
function spanOf(r: IncomingRing, now: number): { raisedAt: number; expiresAt: number } {
  const left = Date.parse(r.expiresAt) - now;
  const expiresAt = now + (left > 0 && left < RING_MS ? left : RING_MS);
  return { raisedAt: expiresAt - RING_MS, expiresAt };
}

/** `cards`: the rings this tab shows a card for, each known by `keyOf` (rung again later, it's a new ring). */
export function useRingAlerts(cards: readonly IncomingRing[], keyOf: (r: IncomingRing) => string): void {
  const preferences = useNotificationPreferences();
  const permission = useNotifyPermission();
  const toast = useToast();
  const ownerId = preferences.ownerId;
  const [tab] = useState(() => crypto.randomUUID());
  const scope = ownerId ? `ring:${ownerId}:${tab}` : '';
  const context = ownerId ? `${ownerId}:rings` : '';
  const lifetime = useRef({ scope, token: {} });
  const latest = useRef({ preferences, permission });
  latest.current = { preferences, permission };
  // A focused tab has the card in front of whoever is rung, so no tab says it again.
  useEffect(() => context ? watchNotificationViews(() => [context]) : undefined, [context]);
  useEffect(() => {
    const token = {};
    lifetime.current = { scope, token };
    return () => removeNotificationSource(scope, token);
  }, [scope]);
  const rung = cards.map(keyOf).join(' ');
  useEffect(() => {
    if (!ownerId) return;
    const token = lifetime.current.token;
    const now = Date.now();
    const alerts = cards.map((r): BrowserAlert => ({ key: `ring:${keyOf(r)}`, kind: 'ringing', context, ...spanOf(r, now), open: { to: 'ring' } }));
    updateNotificationSource({ token, scope, owner: ownerId, ownerId, alerts,
      allowed: (kind) => {
        const current = latest.current;
        const chosen = { ...current.preferences.prefs, ...notificationPreferenceIntent(ownerId) };
        return lifetime.current.token === token && current.preferences.ready && current.preferences.ownerId === ownerId && current.permission === 'granted'
          && ringsReach(chosen) && (kind === undefined || kind === 'ringing');
      },
      notificationsPauseEnd: () => latest.current.preferences.notificationsPauseEnd,
      open: routeBrowserNotification,
      failed: () => toast('Browser notifications couldn’t be shown. Calls still ring in Alcove.', { icon: 'bellOff' })
    });
  }, [rung, ownerId, scope, context, preferences.prefs, preferences.notificationsPauseEnd, preferences.ready, permission, toast]);
}
