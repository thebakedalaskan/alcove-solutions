import { NOTES_LABEL, type MeetingNotesSetting, type NotesMode } from '@alcove/api';
import { Icon, cn } from '@alcove/ui';

/** How a meeting's notes setting reads in lists. Green when notes will run. */
export function NotesChip({ notes, className, iconOnly }: { notes: MeetingNotesSetting; className?: string; iconOnly?: boolean }) {
  const on = notes === 'full' || notes === 'notes';
  return (
    <span title={NOTES_LABEL[notes]} className={cn('inline-flex items-center gap-[5px] whitespace-nowrap text-[12.5px] font-semibold', on ? 'text-ok' : 'text-ink-3', className)}>
      <Icon name={notes === 'off' ? 'x' : 'notes'} className="size-3.5" />{!iconOnly && NOTES_LABEL[notes]}
    </span>
  );
}

export const NOTE_OPTIONS: { value: MeetingNotesSetting; title: string; description: string }[] = [
  { value: 'full', title: 'Notes + transcript', description: 'Summary, decisions, actions and every line' },
  { value: 'notes', title: 'Notes only', description: 'Transcript deleted once notes are written' },
  { value: 'off', title: 'No notes', description: 'Nothing is recorded' },
  { value: 'ask', title: 'Ask at start', description: 'Decide when you join' }
];

/** The same options without "ask", for when notes must be decided now. */
export const NOTE_MODE_OPTIONS: { value: NotesMode; title: string; description: string }[] =
  NOTE_OPTIONS.flatMap((o) => (o.value === 'ask' ? [] : [{ ...o, value: o.value }]));
