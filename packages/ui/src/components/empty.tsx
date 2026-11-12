import type { ReactNode } from 'react';
import { cn } from '../cn';
import { EmptyArch } from './illustrations';

/**
 * What a list or page shows before there's anything in it: the empty arch, a title that says what will appear, one line, and
 * the way forward. `role="status"` when it says something went wrong, so it's read out as it appears.
 */
export function EmptyState({ title, children, action, art = <EmptyArch />, className, role }: {
  title: string; children?: ReactNode; action?: ReactNode; art?: ReactNode; className?: string; role?: 'status' | undefined;
}) {
  return (
    <div className={cn('ac-empty', className)} role={role}>
      {art}
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action && <div className="ac-empty-act">{action}</div>}
    </div>
  );
}
