/*
 * Documents people bring to calls. Real workspaces don't exist yet (#81): a demo account gets a made-up catalog from
 * ../demo.ts, and everyone else has none. A call keeps only the IDs, and each person is told what they may know of them.
 */
import type { CallDocument, DocumentLibrary } from '@alcove/api';
import type { Owner } from '../context';
import { sampleDocument, sampleLibrary } from '../demo';
import { ValidationError } from '../errors';
import { profile } from './account';

/** Who's looking: enough to tell which documents they have. */
interface Reader { name: string; email: string; sample: boolean }
const libraryOf = (who: Reader): DocumentLibrary => (who.sample ? { source: 'sample', workspaces: sampleLibrary(who, new Date()) } : { source: 'none', workspaces: [] });

/** The documents someone can bring to a call. */
export const library = async (o: Owner): Promise<DocumentLibrary> => libraryOf(await profile(o));

/** Refuses anything but documents from the organizer's own library, each once. */
export function validDocuments(ids: string[], organizer: Reader): void {
  const theirs = new Set(libraryOf(organizer).workspaces.flatMap((w) => w.documents.map((d) => d.id)));
  const unknown = ids.filter((id) => !theirs.has(id)).length;
  if (unknown || new Set(ids).size !== ids.length) throw new ValidationError('Bring documents from your own library, each once.', { context: { documents: ids.length, unknown } });
}

/** What a call's documents say to someone: a name only for those who can open one. A document that's no longer in the catalog isn't listed. */
export function documentsFor(ids: string[], viewer: { email: string; sample: boolean }): CallDocument[] {
  return ids.flatMap((id) => { const d = sampleDocument(id, viewer); return d ? [d] : []; });
}
