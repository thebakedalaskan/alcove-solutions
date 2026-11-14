/*
 * The cases held back from whoever tunes the notes prompt. They're scored with the rest, and never read while tuning,
 * so a change that only fits the cases it was tuned on shows a gain on the others and none on these.
 *
 * Holding them back has to be done by where they live, not by asking nicely: they're in a file outside the
 * repository (~/.alcove-eval/heldout.json, or NOTES_EVAL_HELDOUT), with their judge-check plants, and a run's full
 * record of one goes beside that file (HELDOUT_RUNS), never into the eval's folder. Reports show their numbers only.
 * Without the file, the eval runs the cases in the repository alone.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { CASES, EvalCaseSchema, type EvalCase } from './cases';
import { PlantSchema, type Plant } from './plants';

export const HELDOUT_FILE = process.env['NOTES_EVAL_HELDOUT'] ?? join(homedir(), '.alcove-eval', 'heldout.json');
/** Where held-back runs' records go, by the folder name the eval or judge check gave its own results. */
export const HELDOUT_RUNS = join(dirname(HELDOUT_FILE), 'runs');

const HeldoutFile = z.object({ cases: z.array(EvalCaseSchema), plants: z.record(z.string(), z.array(PlantSchema)) });

function load(): { cases: EvalCase[]; plants: Record<string, Plant[]> } {
  if (!existsSync(HELDOUT_FILE)) return { cases: [], plants: {} };
  const raw: unknown = JSON.parse(readFileSync(HELDOUT_FILE, 'utf8'));
  const parsed = HeldoutFile.safeParse(raw);
  if (!parsed.success) throw new Error(`${HELDOUT_FILE} isn't a held-back case file: ${parsed.error.issues[0]?.message ?? ''}`);
  const twice = parsed.data.cases.filter((c) => CASES.some((x) => x.id === c.id)).map((c) => c.id);
  if (twice.length) throw new Error(`held back and in the repository both: ${twice.join(', ')}`);
  return parsed.data;
}

export const HELD = load();
/** Every case the eval runs: the repository's, then the held-back ones. */
export const EVERY_CASE: EvalCase[] = [...CASES, ...HELD.cases];
export const isHeld = (id: string) => HELD.cases.some((c) => c.id === id);
