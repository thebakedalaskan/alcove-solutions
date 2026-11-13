/*
 * The notes' query keys: lists and searches of notes, one note with your own notes on it and its links, the inbox, series,
 * the models that write notes, and exports to Google Drive. Keys import nothing, so a write in any feature can say which of
 * these to read again.
 */
import type { NoteKind } from '@alcove/api';

export const noteKeys = {
  notes: ['notes'] as const,
  /** A list of notes, or a search of them: its words, and whose lines it looks in (`by`, an address, which stays in memory). */
  noteList: (kind?: NoteKind, text?: string, by?: string) => ['notes', 'list', kind ?? 'all', text ?? '', by?.toLowerCase() ?? ''] as const,
  note: (id: string) => ['notes', 'one', id] as const,
  /** Your own notes on a note: never anyone else's, so nothing here is ever shown to someone who signs in after you (signing in starts the cache over). */
  personal: (id: string) => ['notes', 'personal', id] as const,
  addition: (id: string, entryId: string) => ['notes', 'addition', id, entryId] as const,
  sharedAudience: (id: string) => ['notes', 'shared-audience', id] as const,
  noteLinks: (id: string) => ['notes', 'links', id] as const,
  inbox: ['notes', 'inbox'] as const,
  /** Everything about series: what carries over changes whenever a note or a call in one does. */
  allSeries: ['series'] as const,
  series: (id: string) => ['series', id] as const,
  callSeries: (code: string) => ['series', 'call', code] as const,
  visionModels: ['models', 'vision'] as const,
  drive: ['google-drive'] as const,
  driveFolders: ['google-drive', 'folders'] as const,
  driveJobs: ['google-drive', 'jobs'] as const,
  driveNote: (id: string) => ['google-drive', 'note', id] as const
};
