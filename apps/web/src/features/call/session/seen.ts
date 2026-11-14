/*
 * Notices this tab has shown for a call ("Notes are on…"), so coming back after a reload doesn't say them again, and whether
 * it closed "Just you so far". sessionStorage: this tab only, gone when it closes; a new device shows the latest once. Only
 * random IDs.
 */
import { CallNoticesSeenSchema, type CallNotice, type CallSession, type CallState } from '@alcove/api';
import type { ToastOptions, useToast } from '@alcove/ui';
import { useEffect, useRef } from 'react';
import { log } from '~/lib/log';

const slog = log.child({ component: 'call-notices' });
const key = (callId: string) => `alcove.call-seen.${callId}`;

export function seenNotices(callId: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(key(callId)) ?? '[]');
    const r = CallNoticesSeenSchema.safeParse(raw);
    return new Set(r.success ? r.data : []);
  } catch (e) {
    slog.debug('seen notices not readable', { err: e });
    return new Set();
  }
}

export function keepSeen(callId: string, seen: Set<string>): void {
  try { sessionStorage.setItem(key(callId), JSON.stringify([...seen].slice(-50))); } catch (e) { slog.debug('seen notices not kept', { err: e }); }
}

/** "Just you so far", closed in this tab: it stays closed for the rest of this call, through a reload. Only the call's random ID. */
const aloneKey = (callId: string) => `alcove.call-alone.${callId}`;

export function aloneClosed(callId: string): boolean {
  try { return sessionStorage.getItem(aloneKey(callId)) === '1'; } catch (e) { slog.debug('closed alone card not readable', { err: e }); return false; }
}

export function closeAlone(callId: string): void {
  try { sessionStorage.setItem(aloneKey(callId), '1'); } catch (e) { slog.debug('closed alone card not kept', { err: e }); }
}

/**
 * What the call says happened ("Notes are on…") arrives once, as a toast, and the call is told it's been said. Joining shows only
 * the latest: the rest is history. Once each, in this tab: a reload doesn't say them again. Notes on again because the
 * organizer's plan has more are said as what came (`notesBack`, PlanStop.tsx).
 */
export function useCallNotices({ notices, callId, session, toast, notesBack }: {
  notices: CallState['notices'];
  callId: string;
  session: CallSession;
  toast: ReturnType<typeof useToast>;
  notesBack: (n: CallNotice) => { text: string; options: ToastOptions } | null;
}): void {
  const shown = useRef<Set<string> | null>(null);
  useEffect(() => {
    shown.current ??= new Set([...seenNotices(callId), ...notices.slice(0, -1).map((n) => n.id)]);
    const seen = shown.current;
    let fresh = false;
    for (const n of notices) {
      if (seen.has(n.id)) { session.dismissNotice(n.id); continue; }
      seen.add(n.id);
      fresh = true;
      const back = notesBack(n);
      if (back) toast(back.text, back.options);
      else toast(n.text, { icon: n.kind === 'notes' ? 'notesPen' : n.kind === 'people' ? 'people' : 'screen', ms: 3200 });
      session.dismissNotice(n.id);
    }
    if (fresh) keepSeen(callId, seen);
  }, [notices, callId, session, toast, notesBack]);
}
