/*
 * Stands in for apps/web/src/lib/api.ts in Storybook (.storybook/main.ts points every import of it here): the app's one
 * way to its backend, which here answers from the story's scenario, unless the story's world says a part of it goes wrong
 * (trouble.ts), and its check of what the server runs on, here with Storybook's own anchors (attestation.ts). Like the
 * real module, it gives the browser logger somewhere to report to.
 */
import type { AlcoveApi } from '@alcove/api';
import { setLogReporter } from '~/lib/log';
import { standIn } from './standin';
import { withTrouble } from './trouble';

export const api: AlcoveApi = withTrouble(standIn);
export { checkServer } from './attestation';
setLogReporter((entries) => api.diagnostics.report(entries));
