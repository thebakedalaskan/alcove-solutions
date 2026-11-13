/*
 * When a link can't take someone into a call: a code that leads nowhere, a call that's over, a join that was refused,
 * or Alcove out of reach. Each says what happened and what to do next; a failed request's reference finds its lines
 * in the server's log, and says nothing about anyone.
 */
import { errorMessage, errorRequestId } from '@alcove/api';
import { Icon, Notice, RequestRef, type IconName } from '@alcove/ui';
import type { ReactNode } from 'react';

/** The whole page, in place of the pre-join: nothing to join here. */
export function JoinProblem({ icon, title, children, error, action }: { icon: IconName; title: string; children: ReactNode; error?: unknown; action?: ReactNode }) {
  const id = error === undefined ? undefined : errorRequestId(error);
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="wait-in pj-problem" role="status">
        <Icon name={icon} size={22} />
        <b>{title}</b>
        <p>{children}</p>
        {id && <RequestRef id={id} />}
        {action}
      </div>
    </div>
  );
}

/** A join that was refused or failed, under the button: what happened, and its reference. */
export function JoinRefused({ error }: { error: unknown }) {
  const id = errorRequestId(error);
  return (
    <Notice tone="caution" icon="x" className="pj-refused">
      <span>{errorMessage(error)}</span>
      {id && <RequestRef id={id} />}
    </Notice>
  );
}
