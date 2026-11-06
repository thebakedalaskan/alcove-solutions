import { type HttpTransport } from './http';
import { type AlcoveApi } from '@alcove/api';

export function createDiagnosticsApi(t: HttpTransport): Pick<AlcoveApi, 'diagnostics'> {
  const { base, f } = t;
  return {
    diagnostics: {
      // Straight to fetch, not through send(): a failed report must not produce another report.
      report: async (entries) => {
        if (!entries.length) return;
        await f(`${base}/telemetry`, { method: 'POST', credentials: 'include', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries: entries.slice(0, 20) }) }).catch(() => undefined);
      }
    }
  };
}
