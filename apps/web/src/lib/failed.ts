/*
 * A failure said in a toast: the error's own words, with the cross, and Copy reference when Alcove answered, which puts the
 * request's ID on the clipboard for whoever reports the problem to quote. The ID finds that request's lines in the
 * server's log and says nothing about anyone; where a failure stays on screen, `RequestRef` shows the same ID. A request
 * that never reached Alcove (no connection) has none, so its toast has no action.
 */
import { errorMessage, errorRequestId } from '@alcove/api';
import type { useToast } from '@alcove/ui';
import { log } from './log';

/** What `useToast()` gives a screen. */
type Toast = ReturnType<typeof useToast>;

const flog = log.child({ component: 'failed' });
/** Long enough to read what went wrong and press Copy reference. */
const FAILED_MS = 8000;

/**
 * Says `e` in a toast for eight seconds, with Copy reference when it carries a request ID. `what` says what didn't work,
 * before the error's own words, where they alone wouldn't ("Couldn’t undo that.").
 */
export function toastFailure(toast: Toast, e: unknown, what?: string): void {
  const id = errorRequestId(e);
  toast(what ? `${what} ${errorMessage(e)}` : errorMessage(e), {
    icon: 'x', ms: FAILED_MS,
    action: id ? { label: 'Copy reference', onClick: () => copyReference(toast, id) } : undefined
  });
}

/** Puts the reference on the clipboard and says so. Where it can't, it says the reference itself, to copy by hand. */
function copyReference(toast: Toast, id: string): void {
  const couldnt = (reason: string) => {
    flog.info('reference not copied', { reason, requestId: id });
    toast(`Couldn’t copy the reference. It’s ${id}.`, { icon: 'x', ms: 12_000 });
  };
  // Without a secure page there's no clipboard to write to.
  const writing: Promise<void> | undefined = navigator.clipboard?.writeText(id);
  if (!writing) { couldnt('no clipboard'); return; }
  void writing.then(() => toast('Reference copied'), (err: unknown) => couldnt(err instanceof Error ? err.name : 'unknown'));
}
