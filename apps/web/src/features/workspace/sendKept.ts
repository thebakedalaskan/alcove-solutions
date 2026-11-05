/*
 * Edits kept on this device go to Alcove whenever there's a connection, whether or not anyone opens their document again:
 * as the app opens, and when the connection comes back. Each document is opened just long enough. The one on the page
 * sends its own, and anything that can't go yet stays kept for next time. Nothing here ever lets go of an edit: only Alcove
 * having it does, or someone choosing to on the document's page. Words that can't get there by themselves (a document that
 * refuses them, or one that's gone) are said once, with the way to them.
 */
import type { DocSession, DocStatus } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
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

/** Whether what's kept for a document can't get there by itself: not a moment's trouble, which the next try gets past. */
const stuck = (s: DocStatus): boolean => s.unsent && (s.refused !== null || s.closed === 'access' || s.closed === 'deleted');

interface Place { workspace: string; document: string }
/** Documents someone's been told about since the page loaded: once is enough. */
const told = new Set<string>();

let sending = false;
async function sendKept(owner: string, tell: (where: Place) => void): Promise<void> {
  if (sending || !navigator.onLine) return;
  sending = true;
  try {
    for (const where of await keptDocuments(owner)) {
      const { workspace, document } = where;
      if (location.pathname.endsWith(`/${document}`)) continue;
      const session = await openDocument(workspace, document, owner, undefined);
      await sent(session);
      const s = session.getSnapshot();
      session.close();
      if (!stuck(s)) { klog.info('sent the edits kept for a document', { workspace, document, status: s.status }); continue; }
      klog.warn('edits kept on this device can’t reach their document', { workspace, document, refused: s.refused, closed: s.closed });
      if (!told.has(`${workspace}/${document}`)) { told.add(`${workspace}/${document}`); tell(where); }
    }
  } catch (e) {
    klog.warn('couldn’t send the edits kept on this device', { err: e });
  } finally {
    sending = false;
  }
}

export function useKeptEdits(owner: string | null) {
  const toast = useToast();
  const navigate = useNavigate();
  useEffect(() => {
    if (!owner) return undefined;
    const tell = ({ workspace, document }: Place) => {
      toast('Something you wrote didn’t reach its document. It’s safe in this browser.', {
        icon: 'alert', ms: 12_000,
        action: { label: 'Show it', onClick: () => { void navigate({ to: '/drive/$workspaceId/$documentId', params: { workspaceId: workspace, documentId: document } }); } }
      });
    };
    const send = () => { void sendKept(owner, tell); };
    send();
    addEventListener('online', send);
    return () => removeEventListener('online', send);
  }, [owner, toast, navigate]);
}
