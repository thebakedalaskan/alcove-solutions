import type { Deps } from '../context';
import { createHttpContext } from './context';
import { createHttpLimits } from './limits';

/** One set of budgets per app, including the allowances shared by calls, notes and recordings. */
export function createHttpRuntime(d: Deps, stopping?: AbortSignal | undefined) {
  return { d, stopping, context: createHttpContext(d), limits: createHttpLimits() };
}
export type HttpRuntime = ReturnType<typeof createHttpRuntime>;
