/** Account activity uses the same private, fenced OS delivery owner as active calls. No push service is used. */
import { type NoteStatus, type NotificationPrefs, type OpenAction } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { dueFrom, dueOf } from '~/features/home/day';
import { log } from '~/lib/log';
import { notificationPreferenceIntent, watchNotificationPreferences } from '~/lib/notification-preference-channel';
import { useNotificationPreferences } from '~/lib/notification-preferences';
import { q } from '~/lib/queries';
import { closeOwnerNotifications, removeNotificationSource, updateNotificationSource, type BrowserAlert, type BrowserAlertKind } from './notification-delivery';
import { useNotificationNavigation } from './notification-navigation';
import { useNotifyPermission } from './notification-permission';
import { watchNotificationViews } from './notification-views';

const nlog = log.child({ component: 'account-notifications' });
const POLL = { refetchInterval: 30_000, refetchIntervalInBackground: true };
const HOUR = 60 * 60_000;
/** Web Locks avoids duplicate polling. Atomic receipts remain authoritative when Web Locks are unavailable. */
function useNotifier(able: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!able) return;
    if (!navigator.locks) { setHeld(true); return () => setHeld(false); }
    const controller = new AbortController();
    let release = () => {};
    const wait = new Promise<void>((resolve) => { release = resolve; });
    void navigator.locks.request('alcove.notify', { signal: controller.signal }, () => { setHeld(true); return wait; })
      .catch((error: unknown) => { if (!controller.signal.aborted) { nlog.debug('notifier lock unavailable; atomic receipts coordinate delivery', { err: error }); setHeld(true); } });
    return () => { controller.abort(); release(); setHeld(false); };
  }, [able]);
  return held;
}
/** A note in a focused window is the notification itself, including when another tab receives the update. */
export function useNoteOnScreen(noteId: string) {
  const owner = useQuery(q.session()).data?.ownerId;
  useEffect(() => owner ? watchNotificationViews(() => [`${owner}:note:${noteId}`]) : undefined, [owner, noteId]);
}
function category(prefs: NotificationPrefs, kind?: BrowserAlertKind): boolean {
  if (!prefs.enabled) return false;
  if (!kind) return true;
  switch (kind) {
    case 'call': return prefs.beforeCall > 0;
    case 'ready': return prefs.notesReady;
    case 'shared': return prefs.sharedWithYou;
    case 'due': return prefs.followUpDue;
    case 'tagged': return prefs.tagged;
    case 'plan': return prefs.plan;
    default: return prefs[kind];
  }
}
function dueAlerts(action: OpenAction, owner: string): BrowserAlert[] {
  if (!action.takenOn || action.done) return [];
  const said = dueFrom(action);
  const due = dueOf(action.due, said);
  if (due?.kind !== 'day' || due.words !== undefined) return [];
  const from = new Date(due.at); from.setHours(9, 0, 0, 0);
  const until = new Date(due.at); until.setHours(24, 0, 0, 0);
  if (Date.parse(said) >= from.getTime()) return [];
  return [{ key: `due:${action.noteId}:${action.id}:${from.getTime()}`, kind: 'due', context: `${owner}:home`, raisedAt: from.getTime(), expiresAt: until.getTime(), open: { to: 'note', noteId: action.noteId } }];
}
export function useNotifications() {
  const prefs = useNotificationPreferences();
  const permission = useNotifyPermission();
  const owner = prefs.ownerId;
  const enabled = prefs.ready && owner !== null && prefs.prefs.enabled && permission === 'granted';
  const held = useNotifier(enabled);
  const allowed = enabled && held;
  const go = useNotificationNavigation();
  const toast = useToast();
  const here = useRouterState({ select: (state) => state.location.pathname });
  useQuery({ ...q.session(), enabled: allowed, ...POLL });
  useQuery({ ...q.prefs(), enabled: allowed, ...POLL });
  const calls = useQuery({ ...q.upcoming(), enabled: allowed && prefs.prefs.beforeCall > 0, ...POLL }).data;
  const inbox = useQuery({ ...q.inbox(), enabled: allowed && prefs.prefs.followUpDue, ...POLL }).data;
  const mentions = useQuery({ ...q.mentions(), enabled: allowed, ...POLL });
  const notes = useQuery({ ...q.notes(), enabled: allowed, ...POLL });
  const plan = useQuery({ ...q.plan(), enabled: allowed && prefs.prefs.plan, ...POLL }).data;
  const [tab] = useState(() => crypto.randomUUID());
  const token = useRef({});
  const context = useRef({ prefs, permission, allowed, go, toast });
  context.current = { prefs, permission, allowed, go, toast };
  const noteEvents = useRef(new Map<string, BrowserAlert>());
  const previous = useRef<Map<string, NoteStatus> | null>(null);
  const seenMentions = useRef<Set<string> | null>(null);
  const mentionEvents = useRef(new Map<string, BrowserAlert>());
  const began = useRef(Date.now());
  const [tick, paint] = useState(0);
  const scope = owner ? `account:${owner}:${tab}` : '';
  useEffect(() => {
    noteEvents.current.clear(); previous.current = null; seenMentions.current = null; mentionEvents.current.clear(); began.current = Date.now();
    token.current = {};
    const owned = token.current;
    if (!scope || !allowed) return;
    return () => removeNotificationSource(scope, owned);
  }, [scope, allowed]);
  useEffect(() => {
    if (prefs.ready && owner !== null && (!prefs.prefs.enabled || permission !== 'granted')) void closeOwnerNotifications(owner, () => { const latest = context.current; const chosen = { ...latest.prefs.prefs, ...notificationPreferenceIntent(owner) }; return latest.prefs.ownerId === owner && (!chosen.enabled || latest.permission !== 'granted'); });
  }, [owner, prefs.ready, prefs.prefs.enabled, permission]);
  useEffect(() => {
    if (!owner) return;
    return watchNotificationViews(() => {
      if (here === '/home') return [`${owner}:home`];
      // Settings shows the plan's notices at the top of Plan.
      if (here === '/settings') return [`${owner}:plan`];
      const parts = here.split('/');
      return parts[1] === 'drive' && parts[2] && parts[3] ? [`${owner}:document:${parts[2]}:${parts[3]}`] : [];
    });
  }, [owner, here]);
  useEffect(() => watchNotificationPreferences((signal) => {
    if (signal.ownerId !== owner) return;
    const chosen = { ...context.current.prefs.prefs, ...notificationPreferenceIntent(owner) };
    for (const [id, event] of noteEvents.current) if (!category(chosen, event.kind)) noteEvents.current.delete(id);
    if (!chosen.enabled || !chosen.tagged) mentionEvents.current.clear();
  }), [owner]);
  useEffect(() => {
    if (!allowed) return;
    const timer = setInterval(() => paint((version) => version + 1), 15_000);
    return () => clearInterval(timer);
  }, [allowed]);
  useEffect(() => {
    if (!owner || !allowed) return;
    const now = Date.now();
    const list = notes.isPlaceholderData || notes.dataUpdatedAt < began.current ? undefined : notes.data;
    if (list) {
      const before = previous.current;
      previous.current = new Map(list.map((note) => [note.id, note.status]));
      if (before) for (const note of list) {
        const was = before.get(note.id);
        if (prefs.prefs.notesReady && note.status === 'ready' && was !== undefined && was !== 'ready') noteEvents.current.set(`ready:${note.id}`, {
          key: `ready:${note.id}`, kind: 'ready', context: `${owner}:note:${note.id}`, raisedAt: now, expiresAt: now + HOUR, open: { to: 'note', noteId: note.id }
        });
        else if (prefs.prefs.sharedWithYou && was === undefined && note.received?.role === 'shared' && now - Date.parse(note.received.at) < HOUR) noteEvents.current.set(`shared:${note.id}`, {
          key: `shared:${note.id}`, kind: 'shared', context: `${owner}:note:${note.id}`, raisedAt: Date.parse(note.received.at), expiresAt: Date.parse(note.received.at) + HOUR, open: { to: 'note', noteId: note.id }
        });
      }
      for (const [key, event] of noteEvents.current) if (!category(prefs.prefs, event.kind) || event.expiresAt <= now || !list.some((note) => event.open.to === 'note' && note.id === event.open.noteId && (event.kind !== 'ready' || note.status === 'ready'))) noteEvents.current.delete(key);
    }
    const tagged = mentions.isPlaceholderData || mentions.dataUpdatedAt < began.current ? undefined : mentions.data;
    if (tagged) {
      const before = seenMentions.current;
      seenMentions.current = new Set(tagged.map((mention) => mention.id));
      if (before && prefs.prefs.tagged) for (const mention of tagged) if (!before.has(mention.id)) mentionEvents.current.set(mention.id, {
        key: `tagged:${mention.id}`, kind: 'tagged', context: `${owner}:document:${mention.workspaceId}:${mention.document}`, raisedAt: Date.parse(mention.at), expiresAt: Date.parse(mention.at) + HOUR,
        open: { to: 'document', workspaceId: mention.workspaceId, documentId: mention.document, block: mention.block }
      });
      for (const [id, event] of mentionEvents.current) if (!prefs.prefs.tagged || event.expiresAt <= now || !tagged.some((mention) => mention.id === id)) mentionEvents.current.delete(id);
    }
    const alerts: BrowserAlert[] = [...noteEvents.current.values(), ...mentionEvents.current.values()];
    if (prefs.prefs.beforeCall) for (const meeting of calls ?? []) {
      if (meeting.status !== 'scheduled' || here === `/join/${meeting.code}` || here === `/call/${meeting.code}`) continue;
      const starts = Date.parse(meeting.startsAt);
      alerts.push({ key: `call:${meeting.id}:${meeting.startsAt}`, kind: 'call', context: `${owner}:meeting:${meeting.id}`, raisedAt: starts - prefs.prefs.beforeCall * 60_000, expiresAt: starts, open: { to: 'call', code: meeting.code, event: null } });
    }
    alerts.push(...(inbox?.followUps ?? []).flatMap((action) => dueAlerts(action, owner)));
    // What the plan's owner is told and hasn't dismissed, for an hour after it happened. The words never say an amount or a date.
    if (prefs.prefs.plan) for (const notice of plan?.notices ?? []) {
      const at = Date.parse(notice.at);
      alerts.push({ key: `plan:${notice.id}`, kind: 'plan', context: `${owner}:plan`, raisedAt: at, expiresAt: at + HOUR, open: { to: 'plan' } });
    }
    const owned = token.current;
    updateNotificationSource({ token: owned, scope, owner, ownerId: owner, alerts,
      allowed: (kind) => {
        const latest = context.current;
        const chosen = { ...latest.prefs.prefs, ...notificationPreferenceIntent(owner) };
        return latest.allowed && latest.prefs.ownerId === owner && category(chosen, kind);
      },
      notificationsPauseEnd: () => context.current.prefs.notificationsPauseEnd,
      open: (data) => context.current.go(data),
      failed: () => context.current.toast('Browser notifications couldn’t be shown. Unread messages and outstanding actions stay in Alcove.', { icon: 'bellOff' })
    });
  }, [owner, allowed, prefs.prefs, prefs.notificationsPauseEnd, calls, inbox, plan, mentions.data, mentions.dataUpdatedAt, mentions.isPlaceholderData, notes.data, notes.dataUpdatedAt, notes.isPlaceholderData, here, scope, tick]);
}
