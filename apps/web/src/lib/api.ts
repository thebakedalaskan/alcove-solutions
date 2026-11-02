/**
 * The one place the app decides which backend it talks to.
 * Everything else imports `api` and only sees the AlcoveApi contract from @alcove/api.
 */
import type { AlcoveApi } from '@alcove/api';
import { createHttpApi } from '@alcove/api-http';
import { ScenarioSchema, createMockApi, type MockControls } from '@alcove/api-mock';

const mode: 'mock' | 'http' = import.meta.env.VITE_ALCOVE_API === 'http' ? 'http' : 'mock';

function build(): { api: AlcoveApi; mock: MockControls | null } {
  if (mode === 'http') {
    return { api: createHttpApi({ baseUrl: import.meta.env.VITE_ALCOVE_API_URL ?? 'http://localhost:8787' }), mock: null };
  }
  const { api, controls } = createMockApi();
  // Mock only: ?scenario=demo | fresh | signed-out loads that account state, handy for demos and screenshots.
  if (typeof window !== 'undefined') {
    const wanted = new URLSearchParams(window.location.search).get('scenario');
    const parsed = ScenarioSchema.safeParse(wanted);
    if (parsed.success) controls.setScenario(parsed.data);
  }
  return { api, mock: controls };
}

const built = build();
export const api: AlcoveApi = built.api;
/** Present only when running against the mock. Drives the dev panel. */
export const mockControls: MockControls | null = built.mock;
export const apiMode = mode;
