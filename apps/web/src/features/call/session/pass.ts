/*
 * This tab's last pass for a call, so coming back after a reload doesn't mean asking to be let in again
 * (the API checks the pass, and lets in again only someone it let in before). sessionStorage: this tab only,
 * gone when it closes.
 */
import { CallPassStoredSchema } from '@alcove/api';
import { log } from '~/lib/log';

const plog = log.child({ component: 'call-pass' });
const key = (code: string) => `alcove.call-pass.${code}`;

export function lastPass(code: string): string | undefined {
  try {
    const r = CallPassStoredSchema.safeParse(sessionStorage.getItem(key(code)));
    return r.success ? r.data : undefined;
  } catch (e) {
    plog.debug('call pass not readable', { err: e });
    return undefined;
  }
}

export function rememberPass(code: string, pass: string): void {
  try {
    sessionStorage.setItem(key(code), pass);
  } catch (e) {
    // Private browsing and the like: after a reload this tab just asks again.
    plog.debug('call pass not kept', { err: e });
  }
}
