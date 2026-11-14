/** Manual browser evidence, outside the product UI. It observes the actual native constructor and public event projection. */
import type { CallSession } from '@alcove/api';
import { Button, Card } from '@alcove/ui';
import { useEffect, useState } from 'react';
import { recentLogs } from '~/lib/log';
import { useLive } from '~/lib/live';
import { sessions } from '~/features/call/session/handoff';
import { hasNotificationWorker, openShownNotification, shown, startNotificationWorker, stopNotificationWorker } from './browser';
function Report({ session }: { session: CallSession }) {
  const events = useLive(session.notifications);
  const [, paint] = useState(0);
  const [worker, setWorker] = useState(hasNotificationWorker);
  const [failure, setFailure] = useState('');
  const [hidden, setHidden] = useState(false);
  useEffect(() => { const timer = setInterval(() => paint((n) => n + 1), 1000); return () => clearInterval(timer); }, []);
  if (hidden) return <Button style={{ position: 'fixed', right: 12, bottom: 86, zIndex: 200 }} size="sm" variant="secondary" onClick={() => setHidden(false)}>Show delivery report</Button>;
  return <Card style={{ position: 'fixed', right: 12, bottom: 86, width: 300, maxHeight: 320, overflow: 'auto', zIndex: 200, padding: 16 }}>
    <b>Manual browser delivery</b><p className="ac-caption">Real browser notifications; synthetic call and devices. Switch tabs before the scripted activity starts.</p>
    <p>Window: {document.visibilityState} · {document.hasFocus() ? 'focused' : 'not focused'}</p>
    <p>Authorized projection: {events?.ready ? 'ready' : 'waiting'} · {events?.candidates.length ?? 0} current actions · {events?.candidates.filter((event) => event.fresh).length ?? 0} fresh</p>
    {shown.map((item, index) => <div key={index} style={{ marginTop: 12 }}><b>{item.title}</b><p>{item.body}</p><p className="ac-caption">{item.transport} · {item.delivery} · {item.closed ? 'closed' : 'open'} · {item.silent ? 'silent' : 'browser sound'}</p>{item.transport !== 'worker' && <Button size="sm" variant="quiet" onClick={() => { openShownNotification(index); setHidden(true); }}>Open delivered alert {index + 1}</Button>}</div>)}
    {recentLogs().filter((entry) => entry.context['component'] === 'notification-delivery' || entry.context['component'] === 'call-notifications').slice(-6).map((entry, index) => <p className="ac-caption" key={`trace-${index}`}>{entry.msg} · {JSON.stringify(entry.context)}</p>)}
    <Button size="sm" variant="secondary" onClick={() => { void (worker ? stopNotificationWorker() : startNotificationWorker()).then(() => { setWorker(hasNotificationWorker()); setFailure(''); }, () => setFailure('The development worker could not be opened.')); }}>{worker ? 'Stop development worker' : 'Use development worker'}</Button>
    {failure && <p role="status">{failure}</p>}
  </Card>;
}
export function NotificationReport() { const session = sessions.call?.session; return session ? <Report session={session} /> : null; }
