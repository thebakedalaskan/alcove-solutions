import type { NotesSetting } from '@alcove/api';
import { Chip, useToast } from '@alcove/ui';

export const joinUrl = (code: string) => `${location.origin}/join/${code}`;

/** Copies a call's link and says so. */
export function useCopyLink() {
  const toast = useToast();
  return (code: string) => {
    void navigator.clipboard?.writeText(joinUrl(code)).catch(() => undefined);
    toast(<>Link copied <span className="ac-mono opacity-60">{joinUrl(code).replace(/^https?:\/\//, '')}</span></>, { icon: 'link' });
  };
}

/** Whether a call has notes, as a chip: chosen (sun) or switched off (outline). */
export function NotesFlag({ notes, className }: { notes: NotesSetting; className?: string }) {
  return notes === 'on'
    ? <Chip tone="sun" icon="notes" className={className}>Notes</Chip>
    : <Chip tone="outline" className={className}>No notes</Chip>;
}
