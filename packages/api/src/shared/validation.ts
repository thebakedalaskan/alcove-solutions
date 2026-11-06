import { z } from './zod';
/**
 * Words people type for a note: on one line, whitespace collapsed, so nothing typed can pass for another line of a
 * transcript or a list where a prompt reads it.
 */
export const oneLine = (max: number) => z.string().transform((s) => s.replace(/\s+/g, ' ').trim()).pipe(z.string().min(1).max(max));
