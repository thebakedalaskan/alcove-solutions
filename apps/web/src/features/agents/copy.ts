/* Copying what an agent needs (Alcove's address, a command, a token, a question) and saying so. */
import { useToast } from '@alcove/ui';
import { useState } from 'react';
import { log } from '~/lib/log';

const copyLog = log.child({ component: 'agents' });

/**
 * Copies a value and says so (`said`, in a toast, when there's something to say). When the browser won't, `problem` says
 * what to do instead (`otherwise`), until the next copy works. Resolves with whether it did.
 */
export function useCopy() {
  const toast = useToast();
  const [problem, setProblem] = useState<string>();
  const copy = async (value: string, said: string | undefined, otherwise: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(value);
      setProblem(undefined);
      if (said) toast(said, { icon: 'check' });
      return true;
    } catch (e) {
      copyLog.info('the browser didn’t copy', { reason: e instanceof Error ? e.name : 'unknown' });
      setProblem(otherwise);
      return false;
    }
  };
  return { copy, problem };
}
