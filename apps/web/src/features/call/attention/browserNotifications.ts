/** Owns one call's OS delivery projection and exact existing-chat/action navigation registration. */
import { CallNotificationCategorySchema, type CallCrypto, type CallNotificationCategory, type CallNotificationTarget, type CallSession, type CallState, type DirectMessagesState, type NotificationPrefs } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useEffect, useRef } from 'react';
import { notificationPreferenceIntent, watchNotificationPreferences } from '~/features/notifications/preferenceChannel';
import { useNotificationPreferences } from '~/features/notifications/preferences';
import { log } from '~/lib/log';
import { useLive } from '~/lib/live';
import { closeOwnerNotifications, removeNotificationSource, updateNotificationSource, type BrowserAlert, type BrowserAlertKind } from '~/features/notifications/delivery';
import { registerNotificationCall, routeBrowserNotification } from '~/features/notifications/navigation';
import { useNotifyPermission } from '~/features/notifications/permission';
import { watchNotificationViews } from '~/features/notifications/views';

const nlog = log.child({ component: 'call-notifications' });
interface Baseline { scope: string; active: boolean; ids: Set<string>; allowed: Map<string, CallNotificationCategory> }
const messageKey = (target: CallNotificationTarget) => target.type === 'private' ? `private:${target.message}` : target.type === 'thread' || target.type === 'chat' ? `room:${target.message}` : null;
/** Whether an alert is one of the call's own kinds: the only ones this source raises, so the account's never reach it. */
const isCallCategory = (kind: BrowserAlertKind): kind is CallNotificationCategory => CallNotificationCategorySchema.safeParse(kind).success;
function permits(prefs: NotificationPrefs, kind?: BrowserAlertKind): boolean {
  return prefs.enabled && (kind === undefined || (isCallCategory(kind) && prefs[kind]));
}
export function useCallBrowserNotifications({ session, state, crypto, direct, active, foreground, onOpen }: {
  session: CallSession; state: CallState; crypto: CallCrypto; direct: DirectMessagesState; active: boolean; foreground: boolean; onOpen: (target: CallNotificationTarget) => void;
}) {
  const snapshot = useLive(session.notifications);
  const preferences = useNotificationPreferences();
  const permission = useNotifyPermission();
  const toast = useToast();
  const ownerId = preferences.ownerId;
  const owner = ownerId ?? `guest:${session.ticket.identity}`;
  const original = `${state.generation}:${crypto.place}`;
  const scope = `call:${state.callId}:${session.ticket.identity}:${original}:${owner}`;
  const lifetime = useRef({ scope, token: {} });
  const trace = useRef('');
  const baseline = useRef<Baseline>({ scope, active: false, ids: new Set(), allowed: new Map() });
  const latest = useRef({ preferences, permission, active, foreground, scope, snapshot, onOpen, state });
  latest.current = { preferences, permission, active, foreground, scope, snapshot, onOpen, state };
  useEffect(() => registerNotificationCall(session, ownerId, (target) => latest.current.onOpen(target)), [session, ownerId]);
  useEffect(() => {
    const token = {};
    lifetime.current = { scope, token };
    return () => removeNotificationSource(scope, token);
  }, [session, scope]);
  useEffect(() => watchNotificationViews(() => latest.current.foreground && latest.current.active ? [`${owner}:call:${state.callId}`, ...(ownerId ? [`${ownerId}:meeting:${state.meetingId}`] : [])] : []), [owner, ownerId, state.callId, state.meetingId]);
  useEffect(() => watchNotificationPreferences((signal) => {
    if (signal.ownerId !== latest.current.preferences.ownerId) return;
    for (const [id, category] of baseline.current.allowed) if (signal.patch.enabled === false || signal.patch[category] === false) baseline.current.allowed.delete(id);
  }), []);
  useEffect(() => {
    if (preferences.ready && (!preferences.prefs.enabled || permission !== 'granted')) void closeOwnerNotifications(ownerId, () => { const current = latest.current; const chosen = { ...current.preferences.prefs, ...notificationPreferenceIntent(ownerId) }; return current.preferences.ownerId === ownerId && (!chosen.enabled || current.permission !== 'granted'); });
  }, [ownerId, preferences.ready, preferences.prefs.enabled, permission]);
  useEffect(() => {
    const token = lifetime.current.token;
    const prefs = { ...preferences.prefs, ...notificationPreferenceIntent(ownerId) };
    const ids = new Set<string>();
    // Every confirmed incoming source is observed, including currently irrelevant replies and disabled categories.
    for (const message of crypto.chat) if (!message.isMe && !message.sending && !message.failed && message.place === crypto.place) ids.add(`room:${message.id}`);
    for (const message of direct.messages) if (message.to === session.ticket.identity && message.from !== session.ticket.identity && message.state !== 'sending' && message.state !== 'failed' && message.place === crypto.place && message.generation === state.generation) ids.add(`private:${message.id}`);
    for (const candidate of snapshot.candidates) if (messageKey(candidate.destination.target) === null) ids.add(`event:${candidate.destination.eventId}`);
    const before = baseline.current;
    const ready = active && snapshot.ready && preferences.ready;
    if (before.scope !== scope || !ready || !before.active) baseline.current = { scope, active: ready, ids, allowed: new Map() };
    else {
      for (const candidate of snapshot.candidates) {
        const id = messageKey(candidate.destination.target) ?? `event:${candidate.destination.eventId}`;
        if (!before.ids.has(id) && candidate.fresh && permission === 'granted' && permits(prefs, candidate.category)) before.allowed.set(candidate.destination.eventId, candidate.category);
      }
      before.ids = ids;
      for (const [id, category] of before.allowed) if (!permits(prefs, category) || !snapshot.candidates.some((candidate) => candidate.destination.eventId === id && candidate.fresh)) before.allowed.delete(id);
    }
    const chosen = baseline.current;
    const details = { active, projectionReady: snapshot.ready, preferencesReady: preferences.ready, permission, enabled: prefs.enabled, observed: chosen.ids.size, allowed: chosen.allowed.size };
    const signature = JSON.stringify(details);
    if (trace.current !== signature) { trace.current = signature; nlog.debug('call notification eligibility', details); }
    const alerts: BrowserAlert[] = snapshot.candidates.filter((candidate) => chosen.allowed.has(candidate.destination.eventId)).map((candidate) => ({
      key: candidate.destination.eventId, kind: candidate.category, context: `${owner}:call:${state.callId}`, raisedAt: candidate.raisedAt, expiresAt: candidate.expiresAt,
      open: { to: 'call', code: state.code, event: candidate.destination }
    }));
    updateNotificationSource({ token, scope, owner, ownerId, alerts,
      allowed: (kind, key) => {
        const current = latest.current;
        const currentPrefs = { ...current.preferences.prefs, ...notificationPreferenceIntent(ownerId) };
        return lifetime.current.scope === scope && lifetime.current.token === token && current.scope === scope && current.active && current.snapshot.ready && current.preferences.ready && current.preferences.ownerId === ownerId
          && current.permission === 'granted' && permits(currentPrefs, kind) && (key === undefined || baseline.current.allowed.has(key));
      },
      notificationsPauseEnd: () => latest.current.preferences.notificationsPauseEnd,
      open: routeBrowserNotification,
      failed: () => toast('Browser notifications couldn’t be shown. Unread messages and outstanding call actions stay in Alcove.', { icon: 'bellOff' })
    });
  }, [session, state, crypto, direct, snapshot, preferences.prefs, preferences.notificationsPauseEnd, preferences.ready, owner, ownerId, scope, active, permission, toast]);
}
