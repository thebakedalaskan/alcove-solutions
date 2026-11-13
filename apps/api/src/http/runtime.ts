import type { Deps } from '../context';
import type { Attester } from '../tee';
import { createHttpContext } from './context';
import { createHttpLimits } from './limits';

/** One set of budgets per app, including the allowances shared by calls, notes and recordings, and its one attestation token. */
export function createHttpRuntime(d: Deps, stopping: AbortSignal | undefined, attester: Attester) {
  return { d, stopping, attester, context: createHttpContext(d), limits: createHttpLimits() };
}
export type HttpRuntime = ReturnType<typeof createHttpRuntime>;
