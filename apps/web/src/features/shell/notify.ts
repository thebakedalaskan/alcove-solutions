/*
 * Browser notifications, while Alcove is open in a tab and someone is signed in: a call you organize about to start,
 * notes that are ready, notes shared with you, a follow-up due today, someone tagging you in a document, and someone
 * asking for notes in a call you organize. Each follows its switch in Settings and the browser's permission, which only
 * Settings asks for, on a press.
 *
 * One tab in the browser notifies: it holds a Web Lock (`alcove.notify`) until it closes, and the next tab takes over
 * then. Only that tab reads for them; asks for notes come from the call's own tab. They're made from what the app
 * already loads and shown by the browser on this device only: no push service, nothing new sent to Alcove. They may
 * say a title or a name. Each shows once (notified.ts), and counts as shown once the browser has it. Several at once (a
 * computer waking, a connection coming back) become one.
 *
 * They go through the app's service worker, the only way some browsers (Chrome on Android) show them; a development
 * build has none, and shows them from the page. Clicking one brings a window forward, and that window goes to the
 * call's join page, the note, Notes or Home itself, so leaving a call or a recording still asks first (public/sw.js).
 */
import { WorkerMessageSchema, firstName, notesAreOn, type CallState, type Meeting, type MentionNotice, type NoteStatus, type NotificationOpen, type NotificationPrefs, type OpenAction } from '@alcove/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { askerOf } from '~/features/call/notes/Capture';
import { dueFrom, dueOf } from '~/features/home/day';
import { log } from '~/lib/log';
import { callName } from '~/lib/people';
import { q } from '~/lib/queries';
import { hm, minutesUntil, untilLabel } from '~/lib/time';
import { remember, wasShown } from './notified';

const nlog = log.child({ component: 'notify' });

/** How often the notes are read again: while one waits for the notes service, and otherwise. */
const PENDING_MS = 15_000;
const NOTES_MS = 60_000;
/** Follow-ups change rarely; their time is the morning they're due. */
const INBOX_MS = 5 * 60_000;
/**
 * Times are looked at again at least this often, and whenever the tab is shown again: a computer that slept wakes to
 * timers that may not have counted the sleep, and a reminder's minute must not pass meanwhile.
 */
const RECHECK_MS = 30_000;
/** A follow-up is due at this hour, local time, on its day. */
const DUE_HOUR = 9;
/** A share this old that only now reaches the tab (a connection that came back) isn't news. */
const SHARE_FRESH_MS = 60 * 60_000;

/* ---------- the browser's permission ---------- */

/** What the browser allows. `unsupported`: it can't show notifications from a page at all. */
export type NotifyPermission = NotificationPermission | 'unsupported';
const supported = () => typeof window !== 'undefined' && 'Notification' in window;
const permissionNow = (): NotifyPermission => (supported() ? Notification.permission : 'unsupported');

const listeners = new Set<() => void>();
const changed = () => { for (const f of listeners) f(); };
let watching = false;
/** It can change in the browser's site settings while Alcove is open, or in another tab. */
function watchPermission() {
  if (watching || !supported()) return;
  watching = true;
  document.addEventListener('visibilitychange', changed);
  navigator.permissions?.query({ name: 'notifications' })
    .then((s) => s.addEventListener('change', changed), (e: unknown) => nlog.debug('notification permission not watched', { err: e }));
}
const subscribe = (f: () => void) => { watchPermission(); listeners.add(f); return () => { listeners.delete(f); }; };
export const useNotifyPermission = (): NotifyPermission => useSyncExternalStore(subscribe, permissionNow, () => 'default');

/** Asks the browser to allow notifications. Only ever on a press: Turn on, in Settings. */
export async function askToNotify(): Promise<NotifyPermission> {
  if (!supported()) return 'unsupported';
  try {
    await Notification.requestPermission();
  } catch (e) {
    nlog.warn('notification permission not asked', { err: e });
  }
  changed();
  const now = permissionNow();
  nlog.info('notification permission asked', { permission: now });
  return now;
}

/* ---------- one tab notifies ---------- */

const lockManager = (): LockManager | undefined => (typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : undefined);
const NOTIFIER = 'alcove.notify';
const ON_SCREEN = 'alcove.onScreen.';

/**
 * Whether this tab is the one that notifies: the first that can holds the lock until it closes or can't any more,
 * and the next one waiting takes over then. Without Web Locks every tab notifies, each event still once.
 */
function useNotifier(able: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!able) return;
    const locks = lockManager();
    if (!locks) { setHeld(true); return () => setHeld(false); }
    const stop = new AbortController();
    let release = () => {};
    const kept = new Promise<void>((r) => { release = () => r(); });
    void locks.request(NOTIFIER, { signal: stop.signal }, () => { setHeld(true); nlog.debug('this tab notifies'); return kept; })
      .catch((e: unknown) => {
        if (stop.signal.aborted) return;
        nlog.warn('no notifier lock; this tab notifies', { err: e });
        setHeld(true);
      });
    return () => { stop.abort(); release(); setHeld(false); };
  }, [able]);
  return held;
}

/** While a note's page is on screen in a tab, "The notes are ready" for it isn't shown: the page shows it. */
export function useNoteOnScreen(noteId: string) {
  useEffect(() => {
    const locks = lockManager();
    if (!locks) return;
    let release: (() => void) | null = null;
    const hold = () => {
      if (release || document.visibilityState !== 'visible') return;
      const kept = new Promise<void>((r) => { release = () => r(); });
      void locks.request(`${ON_SCREEN}${noteId}`, { mode: 'shared' }, () => kept).catch((e: unknown) => nlog.debug('note not marked on screen', { err: e }));
    };
    const letGo = () => { release?.(); release = null; };
    const seen = () => (document.visibilityState === 'visible' ? hold() : letGo());
    hold();
    document.addEventListener('visibilitychange', seen);
    return () => { document.removeEventListener('visibilitychange', seen); letGo(); };
  }, [noteId]);
}
/** The notes whose page is on screen in some tab of this browser. */
async function notesOnScreen(): Promise<Set<string>> {
  try {
    const held = (await lockManager()?.query())?.held ?? [];
    return new Set(held.flatMap((l) => (l.name?.startsWith(ON_SCREEN) ? [l.name.slice(ON_SCREEN.length)] : [])));
  } catch (e) {
    nlog.debug('notes on screen not known', { err: e });
    return new Set();
  }
}

/* ---------- showing each once ---------- */

type Kind = 'call' | 'ready' | 'shared' | 'asked' | 'due' | 'notes' | 'followUps' | 'tagged';
interface Alert { key: string; kind: Kind; title: string; body: string; open: NotificationOpen }
type Go = (o: NotificationOpen) => void;

/**
 * Puts one up, the key as its tag, and says whether the browser has it. The service worker handles a click on it; the
 * page does where there's no worker.
 */
async function notify(a: Alert, go: Go): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.active) {
      // Another tab's is still showing.
      if ((await reg.getNotifications({ tag: a.key })).length) return true;
      await reg.showNotification(a.title, { body: a.body, tag: a.key, data: { open: a.open } });
    } else {
      const n = new Notification(a.title, { body: a.body, tag: a.key });
      n.onclick = () => { window.focus(); n.close(); go(a.open); };
    }
    nlog.info('notification shown', { kind: a.kind, worker: Boolean(reg?.active) });
    return true;
  } catch (e) {
    nlog.warn('notification not shown', { kind: a.kind, err: e });
    return false;
  }
}
/** On their way to the browser, by account and key: a look meanwhile doesn't put them up again. */
const showing = new Set<string>();
/**
 * Shows the ones not shown before, once each: one by one, or as one `summary` when there are more than `most`. Each
 * is remembered only once the browser has it, so one that fails can show at the next look.
 */
function showOnce(owner: string, alerts: readonly Alert[], go: Go, most = Infinity, summary?: (many: Alert[]) => Alert) {
  const fresh = alerts.filter((a) => !showing.has(`${owner} ${a.key}`) && !wasShown(owner, a.key));
  const put = (shown: Alert, covers: readonly Alert[]) => {
    for (const a of covers) showing.add(`${owner} ${a.key}`);
    void notify(shown, go).then((ok) => {
      for (const a of covers) {
        showing.delete(`${owner} ${a.key}`);
        if (ok) remember(owner, a.key);
      }
    });
  };
  if (summary && fresh.length > most) put(summary(fresh), fresh);
  else for (const a of fresh) put(a, [a]);
}

/** "Weekly product call and Pricing workshop", "Weekly product call, Pricing workshop and 2 more" */
function titlesOf(titles: readonly string[]): string {
  const [a = '', b = ''] = titles;
  if (titles.length <= 1) return a;
  return titles.length === 2 ? `${a} and ${b}` : `${a}, ${b} and ${titles.length - 2} more`;
}
const severalNotes = (many: Alert[]): Alert => {
  const ready = many.filter((a) => a.kind === 'ready').length;
  const n = many.length;
  return {
    key: `notes:${Date.now()}`, kind: 'notes',
    title: ready === n ? `${n} notes are ready` : ready === 0 ? `${n} notes were shared with you` : `${n} notes are ready or shared with you`,
    body: titlesOf(many.map((a) => a.title)), open: { to: 'notes' }
  };
};
const severalDue = (many: Alert[]): Alert => ({
  key: `followUps:${Date.now()}`, kind: 'followUps', title: `${many.length} follow-ups are due today`, body: titlesOf(many.map((a) => a.title)), open: { to: 'home' }
});

/** Opens where a notification leads, through the router (a call or a recording asks first, as leaving one always does). */
function useGo(): Go {
  const router = useRouter();
  return useCallback((o: NotificationOpen) => {
    if (o.to === 'note') void router.navigate({ to: '/notes/$noteId', params: { noteId: o.noteId } });
    else if (o.to === 'notes') void router.navigate({ to: '/notes' });
    else if (o.to === 'home') void router.navigate({ to: '/home' });
    else if (o.to === 'document') void router.navigate({ to: '/drive/$workspaceId/$documentId', params: { workspaceId: o.workspaceId, documentId: o.documentId }, ...(o.block ? { hash: o.block } : {}) });
    else {
      // Already at the call: the window coming forward is all it takes.
      const at = router.state.location.pathname;
      if (at !== `/join/${o.code}` && at !== `/call/${o.code}`) void router.navigate({ to: '/join/$code', params: { code: o.code } });
    }
  }, [router]);
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/* ---------- what the app loads ---------- */

/** Something to show from a moment (`from`) until it no longer makes sense (`until`). */
interface Timed { from: number; until: number; alert: (now: number) => Alert }

/** The reminder before a call you organize that hasn't begun, unless you're on its join page. */
function beforeCall(m: Meeting, minutes: number, here: string): Timed[] {
  // One that's going has you in it already.
  if (m.status !== 'scheduled' || here === `/join/${m.code}` || here === `/call/${m.code}`) return [];
  const starts = new Date(m.startsAt).getTime();
  return [{
    from: starts - minutes * 60_000, until: starts,
    alert: (now) => ({
      key: `call:${m.id}:${m.startsAt}`, kind: 'call', title: m.title,
      body: `Starts ${untilLabel(minutesUntil(m.startsAt, now))}, at ${hm(m.startsAt)}.`, open: { to: 'call', code: m.code }
    })
  }];
}

/**
 * A follow-up you've taken on, at 09:00 on its day, through the end of that day, for every due Home shows as a day
 * (home/day.ts): not a span ("Next week"), which shows as its words, or words with no date in them ("ASAP").
 */
function followUpDue(a: OpenAction): Timed[] {
  if (!a.takenOn || a.done) return [];
  const said = dueFrom(a);
  const due = dueOf(a.due, said);
  if (due?.kind !== 'day' || due.words !== undefined) return [];
  const from = new Date(due.at);
  from.setHours(DUE_HOUR, 0, 0, 0);
  // Said after that (made due today at noon, or in a call that ended this afternoon): whoever said it knows.
  if (Date.parse(said) >= from.getTime()) return [];
  const until = new Date(due.at);
  until.setHours(24, 0, 0, 0);
  return [{
    from: from.getTime(), until: until.getTime(),
    alert: () => ({ key: `due:${a.noteId}:${a.id}:${dayKey(due.at)}`, kind: 'due', title: a.text, body: `Due today, from ${a.noteTitle}.`, open: { to: 'note', noteId: a.noteId } })
  }];
}

/** Someone tagging you, wherever you are in the app. A workspace that's in front of you has said so by then, and it isn't here. */
const tagAlert = (m: MentionNotice): Alert => ({
  key: `tagged:${m.id}`, kind: 'tagged', title: `${firstName(m.by.name)} tagged you`, body: m.name || 'Untitled',
  open: { to: 'document', workspaceId: m.workspaceId, documentId: m.document, block: m.block }
});

const NONE: NotificationPrefs = { replyAlerts: false, mentionAlerts: false, beforeCall: 0, notesReady: false, sharedWithYou: false, notesRequested: false, followUpDue: false, tagged: false };
/** A tab that notifies can sit hidden for days with nothing else reading: what it depends on it reads by itself. */
const KEEP_READING = { refetchInterval: NOTES_MS, refetchIntervalInBackground: true };

/**
 * Calls, notes and follow-ups, for whoever is signed in. Mounted once, at the root, so it carries on in a call or a
 * recording too. It reads only in the tab that notifies, while the browser allows it and the switches are on.
 */
export function useNotifications() {
  const owner = useQuery(q.session()).data?.ownerId;
  const permission = useNotifyPermission();
  const able = permission === 'granted' && owner !== undefined;
  const notifier = useNotifier(able);
  const allowed = able && notifier;
  // A switch changed in another tab or on another device, or someone else signing in, reaches this tab within a minute.
  useQuery({ ...q.session(), enabled: allowed, ...KEEP_READING });
  const prefs = useQuery({ ...q.prefs(), enabled: allowed, ...KEEP_READING }).data?.notifications;
  // A tab that takes over asks who's signed in before it shows anything: the tab before it may have just signed out,
  // which forgets what's been shown, so everything would look new here.
  const qc = useQueryClient();
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!allowed) { setSure(false); return; }
    let on = true;
    const done = () => { if (on) setSure(true); };
    void qc.fetchQuery({ ...q.session(), staleTime: 0 }).then(done, done);
    return () => { on = false; };
  }, [allowed, qc]);
  const want = allowed && sure && prefs ? prefs : NONE;
  const go = useGo();
  const here = useRouterState({ select: (s) => s.location.pathname });

  // A click on a notification, in any tab, this one notifying or not: the service worker asks where this window is
  // (it only knows the page it loaded), then may bring it forward and say where to go.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const worker = navigator.serviceWorker;
    const heard = (e: MessageEvent<unknown>) => {
      const m = WorkerMessageSchema.safeParse(e.data);
      if (!m.success) return;
      if (m.data.type === 'alcove.where') e.ports[0]?.postMessage(location.pathname);
      else go(m.data.open);
    };
    worker.addEventListener('message', heard);
    return () => worker.removeEventListener('message', heard);
  }, [go]);

  const calls = useQuery({ ...q.upcoming(), enabled: want.beforeCall > 0, refetchIntervalInBackground: true }).data;
  const inbox = useQuery({ ...q.inbox(), enabled: want.followUpDue, refetchInterval: INBOX_MS, refetchIntervalInBackground: true }).data;
  const tags = useQuery({ ...q.mentions(), enabled: want.tagged, refetchInterval: NOTES_MS, refetchIntervalInBackground: true }).data;
  useEffect(() => { if (owner !== undefined && tags) showOnce(owner, tags.map(tagAlert), go); }, [owner, tags, go]);
  const reading = want.notesReady || want.sharedWithYou;
  const list = useQuery({
    ...q.notes(), enabled: reading, refetchIntervalInBackground: true,
    // Quicker while a note waits for the notes service. One still recording (a call, an interrupted room recording)
    // can stay that way for hours; the usual read sees it move on to waiting.
    refetchInterval: (query) => (query.state.data?.some((n) => n.status === 'pending') ? PENDING_MS : NOTES_MS)
  });
  // What the list shows while an account's first read is on its way is the last account's.
  const notes = list.isPlaceholderData ? undefined : list.data;

  // Notes ready and shared with you are changes to the notes list, from the first read after this tab starts reading it
  // for the account. A list it already had may be days old, and all that's happened since would look new.
  const seen = useRef<Map<string, NoteStatus> | null>(null);
  const since = useRef(0);
  useEffect(() => { since.current = Date.now(); seen.current = null; }, [reading, owner]);
  useEffect(() => {
    if (!notes || owner === undefined || !reading || list.dataUpdatedAt < since.current) return;
    const before = seen.current;
    seen.current = new Map(notes.map((n) => [n.id, n.status]));
    if (!before) return;
    const now = Date.now();
    const found: { noteId: string; alert: Alert }[] = [];
    for (const n of notes) {
      const was = before.get(n.id);
      const got = n.received;
      if (was === undefined && got?.role === 'shared') {
        if (want.sharedWithYou && now - Date.parse(got.at) < SHARE_FRESH_MS) {
          found.push({ noteId: n.id, alert: { key: `shared:${n.id}`, kind: 'shared', title: n.title, body: `${callName(got.by)} shared it with ${got.group ?? 'you'}.`, open: { to: 'note', noteId: n.id } } });
        }
      } else if (n.status === 'ready' && was !== 'ready' && want.notesReady) {
        found.push({ noteId: n.id, alert: { key: `ready:${n.id}`, kind: 'ready', title: n.title, body: 'The notes are ready.', open: { to: 'note', noteId: n.id } } });
      }
    }
    if (!found.length) return;
    void notesOnScreen().then((open) => {
      // A note's page on screen shows the notes arriving: telling it again would only repeat that.
      const onScreen = (f: { noteId: string; alert: Alert }) => f.alert.kind === 'ready' && open.has(f.noteId);
      for (const f of found) if (onScreen(f)) remember(owner, f.alert.key);
      showOnce(owner, found.filter((f) => !onScreen(f)).map((f) => f.alert), go, 2, severalNotes);
    });
  }, [notes, list.dataUpdatedAt, reading, owner, want.sharedWithYou, want.notesReady, go]);

  // Before a call and follow-ups due are times: shown once theirs comes, looked at again often and on waking.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const look = () => setTick((n) => n + 1);
    document.addEventListener('visibilitychange', look);
    return () => document.removeEventListener('visibilitychange', look);
  }, []);
  useEffect(() => {
    if (owner === undefined) return;
    const now = Date.now();
    const reminders = want.beforeCall > 0 ? (calls ?? []).flatMap((m) => beforeCall(m, want.beforeCall, here)) : [];
    const dues = want.followUpDue ? (inbox?.followUps ?? []).flatMap(followUpDue) : [];
    const come = (ts: readonly Timed[]) => ts.filter((t) => now >= t.from && now < t.until).map((t) => t.alert(now));
    showOnce(owner, come(reminders), go);
    // Several due the same morning are one notification.
    showOnce(owner, come(dues), go, 1, severalDue);
    const next = Math.min(...[...reminders, ...dues].map((t) => t.from).filter((f) => f > now));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(next - now, RECHECK_MS) + 250);
    return () => clearTimeout(timer);
  }, [calls, inbox, want.beforeCall, want.followUpDue, here, go, owner, tick]);
}

/**
 * In a call you organize: someone asking for notes, once each, while the call isn't in front of you (when it is, the
 * call says so itself). It comes from the call's own tab, whichever tab notifies the rest. Clicking it brings the call
 * forward.
 */
export function useNotesAskedNotifications(state: CallState) {
  const permission = useNotifyPermission();
  const owner = useQuery(q.session()).data?.ownerId;
  const allowed = state.isOrganizer && permission === 'granted' && owner !== undefined;
  const on = useQuery({ ...q.prefs(), enabled: allowed, ...KEEP_READING }).data?.notifications.notesRequested === true;
  const go = useGo();
  const latest = useRef(state);
  latest.current = state;
  const { mode } = state.capture;
  // The asks by ID: the state is a new snapshot whenever anything in the call changes.
  const asks = state.capture.requests.map((r) => r.id).join(' ');
  useEffect(() => {
    if (!allowed || owner === undefined || !on || !asks || notesAreOn(mode)) return;
    const s = latest.current;
    const alerts = s.capture.requests.map((r): Alert => ({
      key: `asked:${r.id}`, kind: 'asked', title: `${callName(askerOf(s, r))} asked for notes`,
      body: `Notes are ${mode === 'paused' ? 'paused' : 'off'} in ${s.title}.`, open: { to: 'call', code: s.code }
    }));
    const away = document.visibilityState === 'hidden' || !document.hasFocus();
    // Seen in the call as it came: not shown again later.
    if (!away) { for (const a of alerts) if (!wasShown(owner, a.key)) remember(owner, a.key); return; }
    showOnce(owner, alerts, go);
  }, [allowed, owner, on, asks, mode, go]);
}

/** Chat tags share the Tagged preference. The OS never receives a person's name or message preview. */
export function useChatMentionNotifications(state: CallState, unread: readonly string[]) {
  const permission = useNotifyPermission();
  const owner = useQuery(q.session()).data?.ownerId;
  const allowed = state.phase === 'in-call' && permission === 'granted' && owner !== undefined;
  const on = useQuery({ ...q.prefs(), enabled: allowed, ...KEEP_READING }).data?.notifications.tagged === true;
  const go = useGo();
  useEffect(() => {
    if (!allowed || owner === undefined || !on || !unread.length) return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    const alerts = unread.map((id): Alert => ({ key: `chat-tag:${state.callId}:${id}`, kind: 'tagged', title: 'You were mentioned in chat',
      body: 'Open Alcove to read the message.', open: { to: 'call', code: state.code } }));
    showOnce(owner, alerts, go, 1, (many) => ({ key: `chat-tags:${state.callId}:${Date.now()}`, kind: 'tagged', title: 'You have unread chat mentions',
      body: `${many.length} messages mention you.`, open: { to: 'call', code: state.code } }));
  }, [allowed, owner, on, unread, state.callId, state.code, go]);
}
