/*
 * Edits kept on this device go to Alcove whenever there's a connection, whether or not anyone opens their document again:
 * as the app opens, and when the connection comes back. Each document is opened just long enough. The one on the page
 * sends its own, and anything that can't go yet stays kept for next time.
 */
import type { DocSession } from '@alcove/api';
import { useEffect } from 'react';
import { log } from '~/lib/log';
import { keptDocuments } from './keep';
import { openDocument } from './session';

const klog = log.child({ component: 'workspace-keep' });
/** How long one document gets before it waits for next time. */
const WAIT_MS = 20_000;

/** Resolves once Alcove has everything from `session`, or it can't, or it's been long enough. */
function sent(session: DocSession): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, WAIT_MS);
    const off = session.subscribe(check);
    function done() { clearTimeout(timer); off(); resolve(); }
    function check() {
      const s = session.getSnapshot();
      if (s.closed || s.status === 'failed' || (s.status === 'saved' && s.role !== null)) done();
    }
    check();
  });
}

let sending = false;
async function sendKept(owner: string): Promise<void> {
  if (sending || !navigator.onLine) return;
  sending = true;
  try {
    for (const { workspace, document } of await keptDocuments(owner)) {
      if (location.pathname.endsWith(`/${document}`)) continue;
      const session = openDocument(workspace, document, owner, undefined);
      await sent(session);
      session.close();
      klog.info('sent the edits kept for a document', { workspace, document });
    }
  } catch (e) {
    klog.warn('couldn’t send the edits kept on this device', { err: e });
  } finally {
    sending = false;
  }
}

export function useKeptEdits(owner: string | null) {
  useEffect(() => {
    if (!owner) return;
    const send = () => { void sendKept(owner); };
    send();
    addEventListener('online', send);
    return () => removeEventListener('online', send);
  }, [owner]);
}
