/*
 * An answer from every note, in place of the list: ← Results, the answer beside the Ask mark ("Reading your notes" until
 * its first words), then the moments it comes from as rows under their calls (rows.ts › citedOf), which ↑ and ↓ move
 * through and the preview shows. Escape, Results, or editing the line goes back to what was found.
 */
import { PaletteAnswer, PaletteBack, Words } from '@alcove/ui';
import type { Answer } from '~/features/notes/answer';
import type { Cited } from './rows';
import { Sections, type RowsProps } from './Results';

export function Answered({ answer, cited, listId, onBack, ...rows }: RowsProps & {
  answer: Answer;
  cited: Cited;
  /** The listbox's ID, which the line controls. */
  listId: string;
  onBack: () => void;
}) {
  return (
    <>
      <PaletteBack onClick={onBack}>Results</PaletteBack>
      <PaletteAnswer reading={!answer.text && !answer.done}>
        {answer.done ? <Words text={answer.text} /> : answer.text || 'Reading your notes'}
      </PaletteAnswer>
      {cited.sections.length > 0 && (
        <div role="listbox" id={listId} aria-label="From your notes">
          <Sections sections={cited.sections} {...rows} />
        </div>
      )}
    </>
  );
}
