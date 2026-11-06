/*
 * A document's sections, for presenting it: what the editor reports (plugins/reading.ts has the rule), and what's shown when
 * a section is asked for. Light enough to use outside the editor, which loads with a document.
 */

/** A part of a document shown on its own: its name, and its blocks by ID, in order. `name` is empty for an unnamed heading or title. */
export interface DocSection { name: string; blocks: readonly string[] }

/** Which section is shown when `asked` is: the last one, if the document has fewer than that now. */
export const sectionAt = (sections: readonly DocSection[], asked: number): number => Math.max(0, Math.min(asked, sections.length - 1));

/** Whether two lists of sections say the same thing, so nobody's told twice. */
export const sameSections = (a: readonly DocSection[], b: readonly DocSection[]): boolean =>
  a.length === b.length && a.every((s, i) => s.name === b[i]?.name && s.blocks.join() === b[i]?.blocks.join());
