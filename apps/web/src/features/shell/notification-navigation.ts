/** Revalidates every click and hands an exact original live target to its owning call screen. */
import { BrowserNotificationDataSchema, WorkerMessageSchema, type BrowserNotificationData, type CallNotificationTarget, type CallSession, type NotificationOpen } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useRef } from 'react';
import { q } from '~/lib/queries';
import { accountGeneration, signedOut } from '~/lib/signedOut';
import { log } from '~/lib/log';

const nlog = log.child({ component: 'notification-navigation' });
interface DestinationOwner { readonly token: object; readonly session: CallSession; readonly ownerId: string | null; available(): boolean; open(target: CallNotificationTarget): void }
const calls = new Map<string, DestinationOwner>();
let navigation: ((data: BrowserNotificationData) => void) | null = null;
export function routeBrowserNotification(data: BrowserNotificationData): void { navigation?.(data); }
export function registerNotificationCall(session: CallSession, ownerId: string | null, open: (target: CallNotificationTarget) => void): () => void {
  const token = {};
  const original = ownerId === null ? null : accountGeneration(ownerId);
  calls.set(session.ticket.callId, { token, session, ownerId, available: () => ownerId === null || (original !== null && !signedOut(ownerId) && accountGeneration(ownerId) === original), open });
  return () => { if (calls.get(session.ticket.callId)?.token === token) calls.delete(session.ticket.callId); };
}
function bounded<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new DOMException('Access could not be checked.', 'TimeoutError')), ms);
    void task.then((value) => { clearTimeout(timeout); resolve(value); }, (error: unknown) => { clearTimeout(timeout); reject(error); });
  });
}
export function useNotificationNavigation(): (data: BrowserNotificationData) => void {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, []);
  const go = useCallback((open: NotificationOpen) => {
    if (open.to === 'note') void router.navigate({ to: '/notes/$noteId', params: { noteId: open.noteId } });
    else if (open.to === 'notes') void router.navigate({ to: '/notes' });
    else if (open.to === 'home') void router.navigate({ to: '/home' });
    else if (open.to === 'document') void router.navigate({ to: '/drive/$workspaceId/$documentId', params: { workspaceId: open.workspaceId, documentId: open.documentId }, ...(open.block ? { hash: open.block } : {}) });
    // A ring's card is on whatever page is open: bringing Alcove forward was all it took.
    else if (open.to === 'ring') return;
    else {
      const at = router.state.location.pathname;
      if (at !== `/join/${open.code}` && at !== `/call/${open.code}`) void router.navigate({ to: '/join/$code', params: { code: open.code } });
    }
  }, [router]);
  const open = useCallback((data: BrowserNotificationData) => {
    const version = ++revision.current;
    const generation = data.ownerId === null ? null : accountGeneration(data.ownerId);
    const validAccount = () => data.ownerId === null || (generation !== null && !signedOut(data.ownerId) && accountGeneration(data.ownerId) === generation);
    void (async () => {
      try {
        if (!validAccount()) { toast('This notification belongs to an account that signed out.', { icon: 'lock' }); return; }
        const current = await bounded(qc.fetchQuery({ ...q.session(), staleTime: 0, retry: false, networkMode: 'always' }), 10_000);
        if (version !== revision.current) return;
        if ((current?.ownerId ?? null) !== data.ownerId || !validAccount()) {
          toast('This notification is no longer available for the current account.', { icon: 'lock' }); return;
        }
        const target = data.open;
        if (target.to !== 'call' || target.event === null) { go(target); return; }
        const original = target.event;
        const owner = calls.get(original.callId);
        if (!owner || owner.ownerId !== data.ownerId || !owner.available() || owner.session.ticket.identity !== original.connection) {
          go({ to: 'call', code: target.code, event: null });
          toast('This call action is no longer available in its original session. Private history ends with that session.', { icon: 'lock' }); return;
        }
        await bounded(owner.session.refresh({ call: true, log: true }), 10_000);
        if (version !== revision.current || calls.get(original.callId)?.token !== owner.token || !owner.available() || !validAccount() || (qc.getQueryData(q.session().queryKey)?.ownerId ?? null) !== data.ownerId) return;
        const snapshot = owner.session.notifications.getSnapshot();
        const exact = snapshot.candidates.find((candidate) => candidate.destination.eventId === original.eventId && JSON.stringify(candidate.destination) === JSON.stringify(original));
        // Delivery freshness expires separately; an unread, still-authorized target remains navigable.
        if (!snapshot.ready || !exact) {
          toast('This call action was handled or is no longer available.', { icon: 'lock' }); return;
        }
        owner.open(exact.destination.target);
      } catch (error) {
        nlog.info('notification destination not opened', { code: error instanceof DOMException ? error.name : 'unavailable' });
        if (version === revision.current) toast('Alcove couldn’t check this notification. Open the call or unread items once you’re connected.', { icon: 'lock' });
      }
    })();
  }, [go, qc, toast]);
  useEffect(() => { navigation = open; return () => { if (navigation === open) navigation = null; }; }, [open]);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const worker = navigator.serviceWorker;
    const heard = (event: MessageEvent<unknown>) => {
      if (!(event.source instanceof ServiceWorker) || new URL(event.source.scriptURL).origin !== location.origin) return;
      const message = WorkerMessageSchema.safeParse(event.data);
      if (!message.success) return;
      if (message.data.type === 'alcove.where') event.ports[0]?.postMessage({ path: location.pathname, ownerId: qc.getQueryData(q.session().queryKey)?.ownerId ?? null,
        calls: [...calls.values()].map((owner) => ({ callId: owner.session.ticket.callId, identity: owner.session.ticket.identity })).slice(0, 5) });
      else if (message.data.type === 'alcove.notification') {
        const data = BrowserNotificationDataSchema.parse({ v: 1, instance: crypto.randomUUID(), source: 'worker', key: 'worker-click', ownerId: message.data.ownerId, open: message.data.open });
        open(data);
      }
    };
    worker.addEventListener('message', heard);
    const ready = () => worker.controller?.postMessage({ type: 'alcove.ready' });
    ready(); worker.addEventListener('controllerchange', ready);
    return () => { worker.removeEventListener('message', heard); worker.removeEventListener('controllerchange', ready); };
  }, [open, qc]);
  return open;
}
