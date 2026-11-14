/*
 * The doors into checkout that sit inside other places (docs/product/user-flows.md 16.9–16.13): what ran out, said where it
 * matters, with the one thing that fixes it. Stateless: the app says when and passes the
 * ways on.
 */
import type { ReactNode } from 'react';
import { cn } from '../foundation/cn';
import { Icon } from '../foundation/icon';

/**
 * No notes left this period, where a call with notes on is started or scheduled: until when, in caution, and under it what to
 * do about it (`children`: Get Pro, Start without notes). Under a Notes switch it says "None left until 1 December"; `alone`,
 * with nothing beside it about notes (Start now), it names them, with its mark, as a note of its own.
 */
export function NoNotesLeft({ until, alone = false, children, className }: {
  /** When notes come back, as a sentence says it: "1 December". */
  until: string; alone?: boolean | undefined; children?: ReactNode; className?: string | undefined;
}) {
  return (
    <div className={cn('pd-none', alone && 'is-alone', className)} role="status">
      <p className="pd-none-t">{alone && <Icon name="alert" size={15} />}{alone ? 'No notes left' : 'None left'} until {until}</p>
      {children !== undefined && children !== null && children !== false && <div className="pd-none-a">{children}</div>}
    </div>
  );
}
