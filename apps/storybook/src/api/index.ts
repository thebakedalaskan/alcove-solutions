/*
 * Stands in for apps/web/src/lib/api.ts in Storybook (.storybook/main.ts points every import of it here): the app's one
 * way to its backend, which here answers from the story's scenario. Like the real module, it gives the browser logger
 * somewhere to report to.
 */
import type { AlcoveApi } from '@alcove/api';
import { setLogReporter } from '~/lib/log';
import { standIn } from './standin';

export const api: AlcoveApi = standIn;
setLogReporter((entries) => api.diagnostics.report(entries));
