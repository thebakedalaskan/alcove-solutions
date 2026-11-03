/**
 * The one place the app decides which backend it talks to. Everything else imports `api` and only
 * sees the AlcoveApi contract from @alcove/api. In development Vite proxies /api to the local server.
 */
import type { AlcoveApi } from '@alcove/api';
import { createHttpApi } from '@alcove/api-http';
import { installGlobalLogging, log, setLogReporter } from './log';

const apiLog = log.child({ component: 'api' });
export const api: AlcoveApi = createHttpApi({
  baseUrl: import.meta.env.VITE_ALCOVE_API_URL ?? '/api',
  onEvent: (e) => apiLog.at(e.level, e.msg, e.context)
});
setLogReporter((entries) => api.diagnostics.report(entries));
installGlobalLogging();
