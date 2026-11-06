/* What lands in a document when something's sent from the call: blocks as plain data, for the editor or a document that isn't open. */
import type { BlockJSON, MomentLine } from '../editor/types';

const words = (text: string): BlockJSON => ({ type: 'text', text });

/** Something decided, said to be: a line of text. */
export const decidedBlock = (text: string): BlockJSON => ({
  type: 'line',
  content: [{ type: 'text', text: 'Decided:', marks: [{ type: 'bold' }] }, words(` ${text}`)]
});

/** Who a follow-up tags, and when: a date tag when it names a day, and otherwise the words as they were said. */
export interface FollowUpLine { text: string; who: { id: string; name: string } | null; owner: string | undefined; date: string | null; due: string | undefined }

/** A follow-up as a checklist line. With a person and a date tagged, it's one of the call's follow-ups in its own right. */
export function followUpBlock({ text, who, owner, date, due }: FollowUpLine): BlockJSON {
  const content: BlockJSON[] = [words(text)];
  if (who) content.push(words(' '), { type: 'mention', attrs: { id: who.id, name: who.name } });
  else if (owner) content.push(words(` (${owner})`));
  if (date) content.push(words(' '), { type: 'dateChip', attrs: { date } });
  else if (due) content.push(words(`, ${due}`));
  return { type: 'line', attrs: { kind: 'todo', done: false }, content };
}

/** A line of the transcript, quoted, with a line under it to carry on from. */
export const quoteBlocks = (l: MomentLine): BlockJSON[] => [
  { type: 'moment', attrs: { person: l.person?.id ?? null, name: l.person?.name ?? l.name, at: l.at, text: l.text, line: l.id, note: l.note } },
  { type: 'line' }
];
