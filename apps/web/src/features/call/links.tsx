import type { NotesSetting } from '@alcove/api';
import { Icon, cn, useToast } from '@alcove/ui';

export const joinUrl = (code: string) => `${location.origin}/join/${code}`;

/** Copies a call's link and says so. */
export function useCopyLink() {
  const toast = useToast();
  return (code: string) => {
    void navigator.clipboard?.writeText(joinUrl(code)).catch(() => undefined);
    toast(<>Link copied <span className="mono opacity-60">{joinUrl(code).replace(/^https?:\/\//, '')}</span></>, { icon: 'link' });
  };
}

/** Whether a call has notes, as a quiet label. */
export function NotesFlag({ notes, className }: { notes: NotesSetting; className?: string }) {
  return notes === 'on'
    ? <span className={cn('nflag', className)}><Icon name="pen" size={15} />Notes</span>
    : <span className={cn('nflag off', className)}>No notes</span>;
}
