/**
 * The one place the app decides which backend it talks to, and which server it trusts. Everything else imports `api`
 * (and `checkServer`) and only sees the AlcoveApi contract from @alcove/api. In development Vite proxies /api to the
 * local server.
 */
import type { AlcoveApi, Attestation, Trust } from '@alcove/api';
import { createHttpApi, verifyServer } from '@alcove/api-http';
import { installGlobalLogging, log, setLogReporter } from './log';

const apiLog = log.child({ component: 'api' });
const baseUrl = import.meta.env.VITE_ALCOVE_API_URL ?? '/api';
export const api: AlcoveApi = createHttpApi({
  baseUrl,
  onEvent: (e) => apiLog.at(e.level, e.msg, e.context)
});
/**
 * What to make of what the API says it runs on (`api.trust.attestation()`): checked against the production pins, with
 * the token made for the API this app was built to talk to.
 */
export const checkServer = (a: Attestation): Promise<Trust> => verifyServer(a, { audience: new URL(baseUrl, location.href).href });
setLogReporter((entries) => api.diagnostics.report(entries));
installGlobalLogging();
