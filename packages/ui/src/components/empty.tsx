import type { ReactNode } from 'react';
import { cn } from '../cn';
import { EmptyArch } from './illustrations';

/** What a list or page shows before there's anything in it: a picture, one line, and the way forward. */
export function EmptyState({ title, children, action, art = <EmptyArch />, className }: {
  title: string; children?: ReactNode; action?: ReactNode; art?: ReactNode; className?: string;
}) {
  return (
    <div className={cn('empty', className)}>
      {art}
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
